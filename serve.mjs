import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const port = 4173;
const files = new Map([
  ['/', ['index.html', 'text/html']],
  ['/index.html', ['index.html', 'text/html']],
  ['/styles.css', ['styles.css', 'text/css']],
  ['/app.js', ['app.js', 'text/javascript']],
]);

createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const file = files.get(pathname);
  if (!file) {
    res.writeHead(404).end('Not found.');
    return;
  }

  try {
    const [name, contentType] = file;
    const data = await readFile(new URL(`./dist/${name}`, import.meta.url));
    res.writeHead(200, { 'Content-Type': `${contentType}; charset=utf-8`, 'Cache-Control': 'no-store' }).end(data);
  } catch {
    res.writeHead(500).end('Build the site with npm run build.');
  }
}).listen(port, '127.0.0.1', () => console.log(`Local: http://127.0.0.1:${port}`));
