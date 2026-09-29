// tiny static server mounting dist/ at /pdf-studio/ for local verification
const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = '/home/hatch/workspace/pdfstudio/dist';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm', '.mjs': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (!p.startsWith('/pdf-studio/')) { res.writeHead(404); res.end(); return; }
  p = p.slice('/pdf-studio/'.length) || 'index.html';
  let f = path.join(ROOT, p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(ROOT, 'index.html');
  const ext = path.extname(f);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(8901, '127.0.0.1', () => console.log('serving dist at http://127.0.0.1:8901/pdf-studio/'));
