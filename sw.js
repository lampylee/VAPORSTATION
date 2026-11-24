// Offline safety net. Network first (so edits show up straight away while developing),
// falling back to the cache when the server is gone: the node window got closed mid-gig,
// the laptop has no network, or the GitHub Pages copy is opened offline.
// The page sends the list of everything it loaded (`warm`), so every module, style and
// the demo track get cached on the first visit without a hand-kept file list.
const CACHE = 'vaporstation-v1';
const TIMEOUT = 2500;   // ms before a hanging network request gives way to the cache

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', 'index.html', 'css/style.css', 'js/main.js', 'output.html', 'js/show/output-page.js'])).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data?.type !== 'warm') return;
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    let n = 0;
    for (const url of e.data.urls) {
      if (new URL(url, self.location).origin !== self.location.origin) continue;
      if (await c.match(url, { ignoreSearch: true })) continue;
      try { const r = await fetch(url, { cache: 'no-cache' }); if (r.ok) { await c.put(url, r); n++; } } catch (err) { /* offline */ }
    }
    e.source?.postMessage({ type: 'warmed', added: n });
  })());
});

const strip = (req) => { const u = new URL(req.url); u.search = ''; return u.href; };

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  // media range requests (the <audio> player): straight to the network; offline, the cached whole file
  if (req.headers.has('range')) {
    e.respondWith(fetch(req).catch(() => caches.match(strip(req))));
    return;
  }
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const net = fetch(req).then((r) => { if (r.ok) c.put(strip(req), r.clone()); return r; });
    const timeout = new Promise((res) => setTimeout(res, TIMEOUT));
    try {
      const r = await Promise.race([net, timeout]);
      if (r) return r;
    } catch (err) { /* network down: use the cache */ }
    const hit = await c.match(strip(req));
    return hit || net;   // nothing cached: keep waiting on the network (or fail like normal)
  })());
});
