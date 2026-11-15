/* Renders every preset's SVG twice — once as plain polylines, once with curve
   fitting on — and compares the two images pixel by pixel.
   
   This is the test that catches a fitted curve which is *near every vertex* but
   wrong between them: a straight run replaced by a bulging arc, an SVG sweep
   flag inverted, a circle drawn against its winding so a hole fills in solid.
   None of those show up in a vertex-to-curve distance check; all of them are
   glaring in a rendered diff. */
// sharp is a dev dependency, only needed by the preview tooling and this
// render test — not by the app or the geometry tests.
import sharp from 'sharp';
import { buildDesign } from '../src/engine/build.js';
import { PRESETS } from '../src/engine/presets.js';
import { exportSVG } from '../src/engine/exporters/svg.js';
let worst = 0, worstId = '', bad = 0;
for (const p of PRESETS) {
  const d = buildDesign({ ...p, canvas: { W: 300, H: 300 } });
  const bufs = [];
  for (const fit of ['off', 'arcs', 'splines']) {
    const svg = exportSVG(d, { filled: true, background: '#ffffff', fit });
    bufs.push(await sharp(Buffer.from(svg), { density: 150 })
      .resize(700, 700, { fit: 'contain', background: '#ffffff' })
      .greyscale().raw().toBuffer());
  }
  for (let k = 1; k < 3; k++) {
    let diff = 0;
    for (let i = 0; i < bufs[0].length; i++) if (Math.abs(bufs[0][i] - bufs[k][i]) > 60) diff++;
    const pct = (diff / bufs[0].length) * 100;
    if (pct > worst) { worst = pct; worstId = p.id + ':' + (k === 1 ? 'arcs' : 'splines'); }
    if (pct > 0.5) { bad++; console.log('  ✗', p.id, k === 1 ? 'arcs' : 'splines', pct.toFixed(3) + '% pixels differ'); }
  }
}
console.log(`worst pixel difference between line-only and fitted SVG: ${worst.toFixed(3)}% (${worstId})`);
console.log(bad ? `\n❌ ${bad} presets render differently once fitted` : '\n✅ fitted curves render identically to the polylines they replace');
process.exit(bad ? 1 : 0);
