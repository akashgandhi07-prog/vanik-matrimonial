/**
 * Makes the 1200x675 image for each guide (public/images/guides/<slug>.png), used for social
 * previews and the Article structured data. Re-run after adding a guide or changing a heading or
 * topic, then commit the PNGs:
 *
 *   npm run guide-images
 *
 * Needs Google Chrome (set CHROME_PATH if it isn't in the usual macOS place) and the SSR bundle
 * from `vite build --ssr src/entry-server.tsx --outDir dist-ssr`, which the npm script builds first.
 * The mandala is taken from the rendered homepage so it always matches the site.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const outDir = path.join(root, 'public', 'images', 'guides');
const chrome = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!fs.existsSync(chrome)) throw new Error(`guide-images: Chrome not found at ${chrome}; set CHROME_PATH`);

const ssr = await import(pathToFileURL(path.join(root, 'dist-ssr', 'entry-server.js')).href);
const { render, GUIDES } = ssr;

const homepage = render('/');
const mandala = /<svg viewBox="0 0 440 440"[\s\S]*?<\/svg>/.exec(homepage)?.[0];
if (!mandala) throw new Error('guide-images: could not find the mandala in the homepage');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function page(guide) {
  const size = guide.heading.length > 60 ? 54 : guide.heading.length > 42 ? 60 : 68;
  return `<!doctype html>
<html><head><meta charset="utf-8" />
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT@9..144,500..700,0..100&family=Source+Sans+3:wght@400;600;700&display=block" rel="stylesheet" />
<style>
  * { box-sizing: border-box; margin: 0; }
  html, body { width: 1200px; height: 675px; overflow: hidden; }
  body {
    position: relative;
    font-family: 'Source Sans 3', sans-serif;
    color: #2b2421;
    background:
      radial-gradient(circle at 88% 45%, rgba(199, 148, 51, 0.22), transparent 38%),
      linear-gradient(135deg, #f6ecd8 0%, #f6f1e9 60%);
  }
  .band { position: absolute; left: 0; top: 0; bottom: 0; width: 14px; background: #7b2e3b; }
  .art { position: absolute; right: -220px; top: 50%; width: 600px; height: 600px; transform: translateY(-50%); opacity: 0.95; }
  .art svg { width: 100%; height: 100%; }
  .text { position: absolute; left: 84px; top: 64px; bottom: 60px; width: 640px; display: flex; flex-direction: column; }
  .brand { display: flex; align-items: center; gap: 14px; font-weight: 700; font-size: 24px; }
  .brand svg { width: 44px; height: 44px; }
  .topic { margin-top: auto; display: flex; align-items: center; gap: 14px; font-weight: 700; font-size: 20px; letter-spacing: 0.12em; text-transform: uppercase; color: #7a5410; }
  .topic::before { content: ''; width: 36px; height: 2px; background: #b07d2b; }
  h1 {
    margin: 18px 0 auto;
    font-family: 'Fraunces', serif; font-weight: 600; font-variation-settings: 'SOFT' 60;
    font-size: ${size}px; line-height: 1.08; letter-spacing: -0.02em;
  }
  .foot { font-size: 21px; color: #6b6159; }
  .foot strong { color: #7b2e3b; }
</style></head>
<body>
  <div class="band"></div>
  <div class="art">${mandala}</div>
  <div class="text">
    <div class="brand">
      <svg viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#7b2e3b"/><path d="M9.5 9.5 16 22.5 22.5 9.5" fill="none" stroke="#c79433" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
      Vanik Matrimonial Register
    </div>
    <p class="topic">${esc(guide.topic || 'Guide')}</p>
    <h1>${esc(guide.heading)}</h1>
    <p class="foot"><strong>A guide from our volunteers</strong> &middot; Registered charity 1137083</p>
  </div>
</body></html>`;
}

fs.mkdirSync(outDir, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'guide-images-'));
for (const guide of GUIDES) {
  const html = path.join(tmp, `${guide.slug}.html`);
  const png = path.join(outDir, `${guide.slug}.png`);
  fs.writeFileSync(html, page(guide));
  execFileSync(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--window-size=1200,675',
    '--virtual-time-budget=8000',
    `--screenshot=${png}`,
    pathToFileURL(html).href,
  ], { stdio: 'ignore' });
  console.log(`guide-images: ${path.relative(root, png)}`);
}
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(0);
