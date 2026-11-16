import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const result = await build({ entryPoints: ['src/app.ts'], bundle: true, write: false, format: 'iife', target: 'es2022', legalComments: 'inline' });
let css = await readFile('src/style.css', 'utf8');
for (const name of ['sans', 'mono', 'light', 'hanzi']) {
  const font = await readFile(`assets/${name}.ttf`);
  css = css.replace(`FONT_${name.toUpperCase()}`, `data:font/ttf;base64,${font.toString('base64')}`);
}
const template = await readFile('src/index.html', 'utf8');
const noticeFiles = ['LICENSE.md', 'licenses/frontend-MIT.txt', 'THIRD_PARTY_NOTICES.md', 'assets/OFL.txt', 'assets/NotoSansSC-OFL.txt'];
const notices = (await Promise.all(noticeFiles.map(async path => `${path}\n${await readFile(path, 'utf8')}`))).join('\n\n');
const html = template
  .replace('<!--APP_STYLE-->', '<link rel="stylesheet" href="./styles.css">')
  .replace('<!--APP_SCRIPT-->', '<script src="./app.js" defer></script>')
  .replace('</head>', () => `<!-- Licenses and attribution\n${notices.replace(/--/g, '—')}\n-->\n</head>`);

await mkdir('dist', { recursive: true });
await Promise.all([
  writeFile('dist/index.html', html),
  writeFile('dist/styles.css', css),
  writeFile('dist/app.js', result.outputFiles[0].text),
]);
console.log('Built dist/index.html, dist/styles.css, and dist/app.js');
