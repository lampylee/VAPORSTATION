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

http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath.endsWith('/')) urlPath += 'index.html';
  const file = path.normalize(path.join(ROOT, urlPath));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
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
