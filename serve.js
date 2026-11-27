// Zero-dependency static server. Usage: node serve.js [port]
// Serves on http://localhost:<port> — localhost counts as a secure context,
// so Chrome allows microphone / line-in access.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.argv[2]) || 8080;
const ROOT = __dirname;

// The demo track isn't committed (5 MB); build it once if it's missing.
if (!fs.existsSync(path.join(ROOT, 'demo', 'demo.wav'))) {
  console.log('Generating demo/demo.wav (first run only)…');
  require('child_process').execFileSync(process.execPath, [path.join(ROOT, 'tools', 'make-demo-track.js')], { stdio: 'inherit' });
}
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
};

// Only answer requests addressed to this machine by name: blocks DNS-rebinding pages from reading files.
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

http.createServer((req, res) => {
  if (!LOCAL_HOST.test(req.headers.host || '')) { res.writeHead(403); return res.end(); }
  let urlPath;
  try { urlPath = decodeURIComponent(req.url.split('?')[0]); } catch (e) { res.writeHead(400); return res.end(); }   // malformed %-escape: never crash the server
  if (urlPath.endsWith('/')) urlPath += 'index.html';
  const file = path.resolve(ROOT, '.' + path.posix.normalize('/' + urlPath));
  // inside ROOT only (not a sibling folder that shares its name prefix), and no dot folders / files (.git, .claude)
  const rel = path.relative(ROOT, file);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || rel.split(path.sep).some((p) => p.startsWith('.'))) {
    res.writeHead(404); return res.end('Not found');
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}).listen(PORT, '127.0.0.1', () => {
  console.log(`PS1 visualizer running at http://localhost:${PORT}`);
});
