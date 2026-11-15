/* Renders every preset (and every engine default) to a PNG contact sheet
   so the geometry can be eyeballed without a browser. */
// sharp and playwright are only needed by the preview/screenshot tooling, not
// by the app or the geometry tests. They were installed globally in the
// environment this was built in; after `npm i -D sharp playwright` change
// this to the bare specifier 'sharp' / 'playwright'.
import { writeFileSync, mkdirSync } from 'node:fs';
import sharp from '/home/claude/.npm-global/lib/node_modules/sharp/lib/index.js';
import { buildDesign } from '../src/engine/build.js';
import { PRESETS } from '../src/engine/presets.js';
import { ENGINES, defaultParams } from '../src/engine/patterns/index.js';
import { DEFAULT_MODIFIERS } from '../src/engine/modifiers.js';
import { DEFAULT_FAB } from '../src/engine/fabrication.js';
import { exportSVG } from '../src/engine/exporters/svg.js';

// Resolved from this file, not hardcoded, so the project still works
// wherever it is unzipped.
const OUT = new URL('../preview/gallery/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const which = process.argv[2] || 'presets';
let items;
if (which === 'engines') {
  items = ENGINES.map((e) => ({
    id: e.id, name: e.name, engine: e.id, seed: 1234,
    params: defaultParams(e.id), mods: { ...DEFAULT_MODIFIERS },
    fab: { ...DEFAULT_FAB, shape: 'roundrect', band: 8, radius: 14 },
  }));
} else {
  items = PRESETS;
}

const CELL = 340;
const cols = 4;
const rows = Math.ceil(items.length / cols);
const tiles = [];

for (let i = 0; i < items.length; i++) {
  const p = items[i];
  const d = buildDesign({ ...p, canvas: { W: 300, H: 300 } });
  const svg = exportSVG(d, { filled: true, background: '#f5f2ec', margin: 4 });
  const png = await sharp(Buffer.from(svg), { density: 300 })
    .resize(CELL - 16, CELL - 40, { fit: 'contain', background: '#f5f2ec' })
    .png().toBuffer();
  tiles.push({ png, name: p.name || p.id, i });
  console.log(`${p.id.padEnd(14)} loops=${String(d.loops.length).padStart(5)} islands=${String(d.analysis?.floating.size ?? 0).padStart(4)} verts=${d.metrics.vertices}`);
}

const W = cols * CELL, H = rows * CELL;
const labelSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
<rect width="${W}" height="${H}" fill="#1b1b1f"/>
${tiles.map((t) => {
  const cx = (t.i % cols) * CELL, cy = Math.floor(t.i / cols) * CELL;
  return `<text x="${cx + CELL / 2}" y="${cy + CELL - 12}" fill="#e8e6e1" font-family="sans-serif" font-size="15" text-anchor="middle">${t.name.replace(/&/g, '&amp;')}</text>`;
}).join('\n')}
</svg>`;

const composite = tiles.map((t) => ({
  input: t.png,
  left: (t.i % cols) * CELL + 8,
  top: Math.floor(t.i / cols) * CELL + 8,
}));

await sharp(Buffer.from(labelSvg))
  .composite(composite)
  .png()
  .toFile(`${OUT}/sheet-${which}.png`);

console.log('wrote', `${OUT}/sheet-${which}.png`);
