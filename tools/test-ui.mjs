/* Headless browser test: loads the standalone build, drives the UI and
   screenshots each state. Catches console errors and failed exports. */
// sharp and playwright are only needed by the preview/screenshot tooling, not
// by the app or the geometry tests. They were installed globally in the
// environment this was built in; after `npm i -D sharp playwright` change
// this to the bare specifier 'sharp' / 'playwright'.
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Resolved from this file, not hardcoded, so the project still works
// wherever it is unzipped.
const OUT = new URL('../preview/ui/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

// A dice roll can land on a genuinely enormous design, and those take a few
// seconds to build in software rendering. Without a raised default the suite
// fails at random depending on which seeds the clock hands it.
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(90000);

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto(new URL('../dist/tessellate-cad.html', import.meta.url).href, { waitUntil: 'load' });
await page.waitForSelector('.app', { timeout: 20000 });
await page.waitForTimeout(2500);

const shot = async (name) => {
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/ui-${name}.png` });
  console.log('  shot', name);
};

console.log('1. initial load');
await shot('01-initial');

console.log('2. HUD readout');
const hud = await page.$$eval('.stat', (els) => els.map((e) => e.textContent));
console.log('  ', hud.join(' | '));

console.log('3. gallery');
await page.click('button:has-text("Gallery")');
await page.waitForTimeout(4000);
await shot('02-gallery');
const cards = await page.$$('.gallery-card');
console.log('  ', cards.length, 'presets');
const imgs = await page.$$eval('.gallery-card img', (e) => e.length);
console.log('  ', imgs, 'thumbnails rendered');

console.log('4. pick Vasarely preset');
await page.click('.gallery-card:has-text("Vasarely")');
await page.waitForTimeout(1800);
await shot('03-vasarely');

console.log('5. 3D only + material switch');
await page.click('.topbar .seg:has-text("3D")');
await page.waitForTimeout(1200);
await page.selectOption('.viewport-3d select', 'brass');
await shot('04-3d-brass');
await page.selectOption('.viewport-3d select', 'acrylic');
await shot('05-3d-acrylic');

console.log('6. back to split + toolpath mode');
await page.click('.topbar .seg:has-text("Split")');
await page.waitForTimeout(600);
await page.click('.viewport .seg:has-text("Toolpath")');
await shot('06-toolpath');

console.log('7. modifier tab — bulge + twirl');
await page.click('.inspector .seg:has-text("Modifiers")');
await page.waitForTimeout(300);
await page.$$eval('.inspector .ctl', (els) => {
  for (const el of els) {
    const label = el.querySelector('.ctl-label');
    const rng = el.querySelector('input[type=range]');
    if (!label || !rng) continue;
    if (/Twirl/.test(label.textContent)) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(rng, '0.6');
      rng.dispatchEvent(new Event('input', { bubbles: true }));
      rng.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
});
await page.waitForTimeout(1200);
await shot('07-twirl');

console.log('7b. sacred geometry engine');
await page.click('.engine-chip:has-text("Sacred Geometry")');
await page.waitForTimeout(2200);
await shot('07b-sacred');

console.log('8. fabrication tab — enable auto-bridge');
await page.click('.inspector .seg:has-text("Fabrication")');
await page.waitForTimeout(400);
const integrity = await page.$eval('.integrity', (e) => e.textContent).catch(() => 'n/a');
console.log('   integrity:', integrity);
await page.click('.inspector .ctl-toggle:has-text("Auto-bridge") .switch');
await page.waitForTimeout(2500);
const integrity2 = await page.$eval('.integrity', (e) => e.textContent).catch(() => 'n/a');
console.log('   after bridging:', integrity2);
await shot('08-bridged');

console.log('9. dice roll x4');
for (let i = 0; i < 4; i++) {
  await page.click('button:has-text("Surprise me")');
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${OUT}/ui-09-roll${i}.png` });
}
console.log('  4 rolls done');

console.log('9b. trim toggle round-trip');
await page.click('.inspector .seg:has-text("Fabrication")');
await page.waitForTimeout(400);
const trimBefore = await page.$$eval('.stat', els => els.map(e=>e.textContent).find(t=>/OVERLAPS/i.test(t)));
await page.click('.inspector .ctl-toggle:has-text("Trim overlaps") .switch');
await page.waitForTimeout(2500);
const trimAfter = await page.$$eval('.stat', els => els.map(e=>e.textContent).find(t=>/OVERLAPS/i.test(t)));
console.log('   overlaps stat:', trimBefore, '->', trimAfter);
await page.click('.inspector .ctl-toggle:has-text("Trim overlaps") .switch');
await page.waitForTimeout(2500);
await shot('09b-trim');

console.log('10. exports');
await page.click('.inspector .seg:has-text("Export")');
await page.waitForTimeout(400);
await shot('12-export');
const results = {};
for (const [label, sel] of [['dxf', 'Download DXF'], ['svg', 'Download SVG'], ['stl', 'Download binary STL']]) {
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    page.click(`button:has-text("${sel}")`),
  ]);
  const p = await dl.path();
  const { statSync } = await import('node:fs');
  results[label] = { name: dl.suggestedFilename(), bytes: statSync(p).size };
}
console.log('  ', JSON.stringify(results));

console.log('11. paper theme');
await page.selectOption('.topbar select', 'paper');
await page.waitForTimeout(900);
await shot('10-paper');

console.log('12. brush warp interaction');
await page.selectOption('.topbar select', 'studio');
await page.click('.rail .seg:has-text("Twist")');
await page.waitForTimeout(400);
const box = await page.$eval('.viewport .vp-canvas', (e) => {
  const r = e.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
await page.mouse.move(box.x + box.w / 2, box.y + box.h / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.w / 2 + 90, box.y + box.h / 2 + 40, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(1400);
await shot('11-brush');

await browser.close();
console.log('\nconsole errors:', errors.length);
errors.slice(0, 20).forEach((e) => console.log('  !', e));
process.exit(errors.length ? 1 : 0);
