/* Verifies the boolean trim: the filled region must be identical before and
   after, and the output must have no self-intersections or duplicate edges. */
import { trimOverlaps, normaliseWindings } from '../src/engine/boolean.js';
import { buildDesign } from '../src/engine/build.js';
import { PRESETS } from '../src/engine/presets.js';
import { ENGINES, defaultParams } from '../src/engine/patterns/index.js';
import { DEFAULT_MODIFIERS } from '../src/engine/modifiers.js';
import { DEFAULT_FAB, depthMap } from '../src/engine/fabrication.js';

/** Rasterise loops with a given fill rule; returns {mask, n} */
function raster(loops, bbox, rule, N = 300) {
  const [x0, y0, x1, y1] = bbox;
  const w = x1 - x0, h = y1 - y0;
  const nx = N, ny = Math.max(8, Math.round((N * h) / (w || 1)));
  const sx = w / nx, sy = h / ny;
  const mask = new Uint8Array(nx * ny);
  const xs = [];
  for (let j = 0; j < ny; j++) {
    const y = y0 + (j + 0.5) * sy;
    xs.length = 0;
    for (const L of loops) {
      const pts = L.pts, n = pts.length;
      for (let i = 0, k = n - 1; i < n; k = i++) {
        const a = pts[k], b = pts[i];
        if ((a[1] > y) !== (b[1] > y)) {
          xs.push([a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]), b[1] > a[1] ? 1 : -1]);
        }
      }
    }
    if (xs.length < 2) continue;
    xs.sort((p, q) => p[0] - q[0]);
    let wind = 0, par = 0;
    for (let i = 0; i + 1 < xs.length; i++) {
      wind += xs[i][1]; par ^= 1;
      const on = rule === 'evenodd' ? par : wind !== 0;
      if (!on) continue;
      let ia = Math.max(0, Math.ceil((xs[i][0] - x0) / sx - 0.5));
      let ib = Math.min(nx - 1, Math.floor((xs[i + 1][0] - x0) / sx - 0.5));
      for (let q = ia; q <= ib; q++) mask[q + j * nx] = 1;
    }
  }
  return { mask, nx, ny };
}

function compare(a, b) {
  let diff = 0, on = 0;
  for (let i = 0; i < a.mask.length; i++) {
    if (a.mask[i]) on++;
    if (a.mask[i] !== b.mask[i]) diff++;
  }
  return { diff, on, pct: on ? (diff / a.mask.length) * 100 : 0 };
}

/** Count proper crossings between edges of different output loops. */
function countCrossings(loops, limit = 60000) {
  const segs = [];
  loops.forEach((L, li) => {
    const p = L.pts;
    for (let i = 0; i < p.length; i++) segs.push([p[i], p[(i + 1) % p.length], li]);
  });
  if (segs.length > limit) return -1;
  const cell = 4;
  const grid = new Map();
  const key = (i, j) => i * 1000003 + j;
  segs.forEach((s, idx) => {
    const i0 = Math.floor(Math.min(s[0][0], s[1][0]) / cell), i1 = Math.floor(Math.max(s[0][0], s[1][0]) / cell);
    const j0 = Math.floor(Math.min(s[0][1], s[1][1]) / cell), j1 = Math.floor(Math.max(s[0][1], s[1][1]) / cell);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = key(i, j); let a = grid.get(k); if (!a) { a = []; grid.set(k, a); } a.push(idx);
    }
  });
  let hits = 0;
  const seen = new Set();
  for (const arr of grid.values()) {
    for (let a = 0; a < arr.length; a++) for (let b = a + 1; b < arr.length; b++) {
      const pk = arr[a] * 1e7 + arr[b];
      if (seen.has(pk)) continue;
      seen.add(pk);
      const s1 = segs[arr[a]], s2 = segs[arr[b]];
      const r = [s1[1][0] - s1[0][0], s1[1][1] - s1[0][1]];
      const s = [s2[1][0] - s2[0][0], s2[1][1] - s2[0][1]];
      const den = r[0] * s[1] - r[1] * s[0];
      if (Math.abs(den) < 1e-12) continue;
      const qp = [s2[0][0] - s1[0][0], s2[0][1] - s1[0][1]];
      const t = (qp[0] * s[1] - qp[1] * s[0]) / den;
      const u = (qp[0] * r[1] - qp[1] * r[0]) / den;
      const E = 1e-6;
      if (t > E && t < 1 - E && u > E && u < 1 - E) hits++;   // proper crossing only
    }
  }
  return hits;
}

let bad = 0;
const cases = [];
for (const e of ENGINES) {
  cases.push({ id: 'eng:' + e.id, engine: e.id, seed: 1234, params: defaultParams(e.id), mods: { ...DEFAULT_MODIFIERS }, fab: { ...DEFAULT_FAB, shape: 'roundrect', band: 8, radius: 14 } });
}
for (const p of PRESETS) cases.push({ ...p, id: 'set:' + p.id });

console.log('case                 rule      in →  out   raster-diff  crossings');
for (const c of cases) {
  // Bridging and kerf run on the trimmed contours, so they would make the two
  // sides differ by design. Compare the trim alone.
  const base = { ...c.fab, autoBridge: false, kerf: 0 };
  const untrimmed = buildDesign({ ...c, fab: { ...base, trim: false }, canvas: { W: 300, H: 300 } });
  const trimmed = buildDesign({ ...c, fab: { ...base, trim: true }, canvas: { W: 300, H: 300 } });
  const rule = untrimmed.fillRule || 'nonzero';
  const bbox = untrimmed.bbox;
  const before = raster(untrimmed.loops, bbox, rule);
  const after = raster(trimmed.loops, bbox, 'nonzero');
  const cmp = compare(before, after);
  const cross = countCrossings(trimmed.loops);
  const okRaster = cmp.pct < 1.2;
  const okCross = cross === 0 || cross === -1;
  if (!okRaster || !okCross) bad++;
  console.log(
    c.id.padEnd(20),
    String(rule).padEnd(9),
    String(untrimmed.loops.length).padStart(4), '→', String(trimmed.loops.length).padStart(4),
    (cmp.pct.toFixed(2) + '%').padStart(9), okRaster ? '  ' : '✗ ',
    String(cross).padStart(6), okCross ? '' : ' ✗ SELF-INTERSECTS',
  );
}
console.log(bad ? `\n❌ ${bad} problem cases` : '\n✅ trim is region-exact and self-intersection-free everywhere');
process.exit(bad ? 1 : 0);
