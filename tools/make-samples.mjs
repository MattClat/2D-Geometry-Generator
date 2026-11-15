/* Regenerates samples/ — example exports for checking against real CAD
   readers. `node tools/make-samples.mjs` */
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildDesign } from '../src/engine/build.js';
import { PRESETS } from '../src/engine/presets.js';
import { exportDXF } from '../src/engine/exporters/dxf.js';
import { exportSVG } from '../src/engine/exporters/svg.js';

const OUT = fileURLToPath(new URL('../samples/', import.meta.url));
mkdirSync(OUT, { recursive: true });
const build = (id) => buildDesign({ ...PRESETS.find((p) => p.id === id), canvas: { W: 300, H: 300 } });

const fingerprint = build('fingerprint');
writeFileSync(OUT + 'sample-autocad2000-arcs.dxf', exportDXF(fingerprint, { version: 'r14', fit: 'arcs' }));
writeFileSync(OUT + 'sample-autocad2000-splines.dxf', exportDXF(fingerprint, { version: 'r14', fit: 'splines' }));
writeFileSync(OUT + 'sample-r12-arcs.dxf', exportDXF(fingerprint, { version: 'r12', fit: 'arcs' }));

const strap = build('strapwork');
writeFileSync(OUT + 'woven-ring-strapwork.dxf', exportDXF(strap, { version: 'r14', fit: 'arcs' }));
writeFileSync(OUT + 'woven-ring-strapwork.svg', exportSVG(strap, { fit: 'arcs' }));
console.log('samples written to', OUT);
