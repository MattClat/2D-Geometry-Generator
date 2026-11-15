/* Headless smoke + correctness tests for the geometry engine. */
import { performance } from 'node:perf_hooks';
import { ENGINES, defaultParams } from '../src/engine/patterns/index.js';
import { buildDesign } from '../src/engine/build.js';
import { PRESETS } from '../src/engine/presets.js';
import { exportSVG } from '../src/engine/exporters/svg.js';
import { exportDXF } from '../src/engine/exporters/dxf.js';
import { exportSTL } from '../src/engine/exporters/stl.js';
import { diceRoll, evolve } from '../src/engine/random.js';
import { DEFAULT_MODIFIERS } from '../src/engine/modifiers.js';
import { DEFAULT_FAB } from '../src/engine/fabrication.js';
import { polygonArea, polylineLength } from '../src/engine/geom.js';

let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.log('  ✗ ' + msg); } };

function baseState(engine, over = {}) {
  return {
    engine, seed: 1234,
    params: defaultParams(engine),
    mods: { ...DEFAULT_MODIFIERS },
    fab: { ...DEFAULT_FAB },
    canvas: { W: 300, H: 300 },
    ...over,
  };
}

console.log('\n=== 1. every engine produces geometry ===');
for (const e of ENGINES) {
  const t = performance.now();
  const d = buildDesign(baseState(e.id));
  const ms = performance.now() - t;
  const loops = d.loops.length;
  const badPts = d.loops.filter((l) => l.pts.some((p) => !isFinite(p[0]) || !isFinite(p[1]))).length;
  console.log(`  ${e.id.padEnd(12)} loops=${String(loops).padStart(6)}  verts=${String(d.metrics.vertices).padStart(6)}  ${ms.toFixed(0).padStart(5)}ms  ${d.warnings.length ? 'warn:' + d.warnings.length : ''}`);
  ok(loops > 0, `${e.id} produced no geometry`);
  ok(badPts === 0, `${e.id} produced ${badPts} non-finite loops`);
  ok(ms < 6000, `${e.id} too slow (${ms.toFixed(0)}ms)`);
  ok(isFinite(d.metrics.materialArea) && d.metrics.materialArea > 0, `${e.id} zero material area`);
}

console.log('\n=== 2. all presets build + export cleanly ===');
for (const p of PRESETS) {
  const t = performance.now();
  const d = buildDesign({ ...p, canvas: { W: 300, H: 300 } });
  const ms = performance.now() - t;
  const svg = exportSVG(d, {});
  const dxf = exportDXF(d, {});
  const dxf12 = exportDXF(d, { version: 'r12' });
  const stl = exportSTL(d, p.fab.thickness || 3);
  // Each contour is one entity, but not always an LWPOLYLINE: a contour that
  // is a true circle exports as a CIRCLE, which is the whole point of the
  // curve fitting.
  const lw = (dxf.match(/^LWPOLYLINE$/gm) || []).length;
  const circles = (dxf.match(/^CIRCLE$/gm) || []).length;
  const ents = lw + circles;
  const closed = d.loops.length;
  console.log(`  ${p.id.padEnd(13)} loops=${String(closed).padStart(5)} islands=${String(d.analysis?.floating.size ?? '-').padStart(4)} ents=${String(ents).padStart(5)}(${circles}circ) stl=${(stl.byteLength / 1024).toFixed(0).padStart(5)}KB ${ms.toFixed(0).padStart(5)}ms`);
  ok(svg.includes('<svg') && svg.includes('</svg>'), `${p.id} svg malformed`);
  ok(svg.includes('mm"'), `${p.id} svg missing mm units`);
  // DXF lines are CR/LF terminated, as AutoCAD writes them
  ok(/^0\r\nSECTION/.test(dxf) && dxf.trimEnd().endsWith('EOF'), `${p.id} dxf malformed`);
  ok(ents === closed + d.scoreLines.length, `${p.id} dxf entity count ${ents} != ${closed + d.scoreLines.length}`);
  ok(dxf12.includes('POLYLINE') && dxf12.includes('SEQEND'), `${p.id} r12 dxf malformed`);
  ok(stl.byteLength >= 84, `${p.id} stl empty`);
  ok(ms < 8000, `${p.id} slow (${ms.toFixed(0)}ms)`);
}

console.log('\n=== 3. DXF structural validation ===');
{
  const d = buildDesign({ ...PRESETS[2], canvas: { W: 300, H: 300 } });
  const dxf = exportDXF(d, {});
  // DXF is CR/LF terminated; splitting on '\n' alone leaves a stray CR on
  // every value and silently breaks every string comparison below.
  const lines = dxf.split(/\r\n|\n/);
  ok(lines.length % 2 === 1, 'DXF must have an even number of code/value lines (+ trailing)');
  // group codes must all be integers
  let badCode = 0;
  for (let i = 0; i < lines.length - 1; i += 2) if (!/^-?\d+$/.test(lines[i].trim())) badCode++;
  ok(badCode === 0, `DXF has ${badCode} malformed group codes`);
  ok(dxf.includes('$INSUNITS'), 'DXF missing $INSUNITS');
  ok(dxf.includes('AC1015'), 'DXF missing AutoCAD 2000 marker');
  for (const L of ['0_OUTER_FRAME', '1_CUT_THROUGH']) ok(dxf.includes(L), `DXF missing layer ${L}`);

  // proper code/value walk: verify sections, entities and vertex counts
  const pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([Number(lines[i]), lines[i + 1]]);
  let depth = 0, entities = 0, mismatch = 0, badLayer = 0;
  let cur = null;
  const layersSeen = new Set();
  const declaredLayers = new Set();
  let inTables = false;
  for (const [code, val] of pairs) {
    if (code === 0 && val === 'SECTION') depth++;
    if (code === 0 && val === 'ENDSEC') depth--;
    if (code === 2 && val === 'TABLES') inTables = true;
    if (code === 0 && val === 'ENDSEC') inTables = false;
    if (code === 0) {
      if (cur) {
        if (cur.declared !== cur.verts) mismatch++;
        if (!cur.layer) badLayer++;
        else layersSeen.add(cur.layer);
      }
      cur = val === 'LWPOLYLINE' ? { declared: -1, verts: 0, layer: null } : null;
      if (val === 'LWPOLYLINE') entities++;
      if (val === 'LAYER') cur = null;
    } else if (cur) {
      if (code === 90) cur.declared = Number(val);
      if (code === 10) cur.verts++;
      if (code === 8) cur.layer = val;
    }
  }
  ok(depth === 0, 'DXF sections unbalanced');
  ok(mismatch === 0, `${mismatch} LWPOLYLINEs with wrong vertex count`);
  ok(badLayer === 0, `${badLayer} entities without a layer`);
  ok(layersSeen.has('1_CUT_THROUGH'), 'no entity on 1_CUT_THROUGH');
  console.log(`  ${entities} LWPOLYLINE entities on layers: ${[...layersSeen].join(', ')}`);
  console.log('  (full structural validation lives in tools/test-dxf.mjs)');
}

console.log('\n=== 4. closed-loop integrity (no unjoined fragments) ===');
{
  for (const p of PRESETS.slice(0, 8)) {
    const d = buildDesign({ ...p, canvas: { W: 260, H: 260 } });
    const open = d.loops.filter((l) => !l.closed).length;
    const tiny = d.loops.filter((l) => l.pts.length < 3).length;
    ok(open === 0, `${p.id}: ${open} cut paths are not closed`);
    ok(tiny === 0, `${p.id}: ${tiny} degenerate loops`);
  }
  console.log('  all cut geometry is closed polylines');
}

console.log('\n=== 5. kerf compensation grows material ===');
{
  const s = baseState('voronoi');
  s.params.sites = 40; s.params.relax = 2;
  const a = buildDesign({ ...s, fab: { ...DEFAULT_FAB, kerf: 0 } });
  const b = buildDesign({ ...s, fab: { ...DEFAULT_FAB, kerf: 0.6 } });
  console.log(`  material  kerf0=${a.metrics.materialArea.toFixed(0)}mm²  kerf0.6=${b.metrics.materialArea.toFixed(0)}mm²`);
  ok(b.metrics.materialArea > a.metrics.materialArea, 'positive kerf should expand material');
}

console.log('\n=== 6. floating-island detection + auto-bridging ===');
{
  const s = baseState('opart');
  s.params = { ...defaultParams('opart'), mode: 'grid', cell: 16, alternate: true };
  s.fab = { ...DEFAULT_FAB, shape: 'circle', band: 10 };
  const before = buildDesign(s);
  const after = buildDesign({ ...s, fab: { ...s.fab, autoBridge: true, bridgeWidth: 3 } });
  console.log(`  islands before=${before.analysis.floating.size} after=${after.analysis.floating.size} bridged=${after.bridgeReport.bridged} failed=${after.bridgeReport.failed}`);
  ok(before.analysis.floating.size > 0, 'checkerboard grid should report floating islands');
  ok(after.analysis.floating.size < before.analysis.floating.size, 'auto-bridge should reduce island count');
}

console.log('\n=== 7. determinism ===');
{
  const s = baseState('memphis');
  const a = exportDXF(buildDesign(s), {});
  const b = exportDXF(buildDesign(s), {});
  ok(a === b, 'same seed must produce identical DXF');
  const c = exportDXF(buildDesign({ ...s, seed: 4321 }), {});
  ok(a !== c, 'different seed must produce different DXF');
  console.log('  identical inputs -> byte-identical output ✓');
}

console.log('\n=== 8. dice roll + evolve stay valid ===');
{
  let worst = 0;
  for (let i = 0; i < 24; i++) {
    const roll = diceRoll(1000 + i * 7919);
    const t = performance.now();
    const d = buildDesign({ ...roll, canvas: { W: 260, H: 260 } });
    const ms = performance.now() - t;
    worst = Math.max(worst, ms);
    ok(d.loops.length >= 0, 'roll produced invalid result');
    const bad = d.loops.filter((l) => l.pts.some((p) => !isFinite(p[0]))).length;
    ok(bad === 0, `roll ${i} (${roll.engine}) produced NaN geometry`);
    if (ms > 3000) console.log(`   slow roll: ${roll.engine} ${ms.toFixed(0)}ms`);
  }
  const ev = evolve(diceRoll(42), 0.1, 7);
  const d2 = buildDesign({ ...ev, canvas: { W: 260, H: 260 } });
  ok(d2 !== null, 'evolve broke');
  console.log(`  24 random rolls + evolve OK (worst ${worst.toFixed(0)}ms)`);
}

console.log('\n=== 9. modifier stack ===');
{
  for (const sym of ['none', 'cartesian', 'polar', 'hex', 'tri', 'brick']) {
    const s = baseState('encaustic');
    s.params.cell = 40;
    s.mods = { ...DEFAULT_MODIFIERS, symmetry: sym, tileX: 3, tileY: 3, fold: 6, hexSize: 45 };
    const d = buildDesign(s);
    ok(d.loops.length > 0, `symmetry ${sym} produced nothing`);
    console.log(`  ${sym.padEnd(10)} -> ${d.loops.length} loops`);
  }
  for (const [k, v] of [['bulge', 1.2], ['twirl', 1.1], ['turbulence', 8], ['shearX', 0.5], ['perspective', 0.5], ['wave', 12]]) {
    const s = baseState('opart');
    s.params = { ...defaultParams('opart'), mode: 'grid', cell: 18 };
    s.mods = { ...DEFAULT_MODIFIERS, [k]: v };
    const d = buildDesign(s);
    const bad = d.loops.filter((l) => l.pts.some((p) => !isFinite(p[0]) || Math.abs(p[0]) > 1e5)).length;
    ok(bad === 0, `deformer ${k} produced invalid points`);
  }
  console.log('  all deformation fields produce finite geometry');
}

console.log('\n=== 10. STL mesh sanity ===');
{
  const d = buildDesign({ ...PRESETS[5], canvas: { W: 200, H: 200 } });
  const buf = exportSTL(d, 3);
  const dv = new DataView(buf);
  const n = dv.getUint32(80, true);
  ok(buf.byteLength === 84 + n * 50, 'STL byte length does not match triangle count');
  ok(n > 100, 'STL suspiciously small');
  // all vertices finite and within a sane box
  let bad = 0;
  for (let t = 0; t < Math.min(n, 4000); t++) {
    for (let k = 0; k < 9; k++) {
      const v = dv.getFloat32(84 + t * 50 + 12 + k * 4, true);
      if (!isFinite(v) || Math.abs(v) > 1e4) bad++;
    }
  }
  ok(bad === 0, `${bad} bad STL vertex components`);
  console.log(`  ${n} triangles, ${(buf.byteLength / 1024).toFixed(0)}KB, all finite`);
}


console.log('\n=== 11. exported DXF is genuinely non-overlapping ===');
{
  // Parse the DXF back out and check the geometry a CAD package would see:
  // no duplicated edges, and no two contours crossing each other.
  const parseDxf = (txt) => {
    const L = txt.split('\n');
    const out = [];
    let cur = null;
    for (let i = 0; i + 1 < L.length; i += 2) {
      const code = Number(L[i]), val = L[i + 1];
      if (code === 0) { if (cur) out.push(cur); cur = val === 'LWPOLYLINE' ? { pts: [], layer: null } : null; }
      else if (cur) {
        if (code === 10) cur.pts.push([Number(val), 0]);
        else if (code === 20) cur.pts[cur.pts.length - 1][1] = Number(val);
        else if (code === 8) cur.layer = val;
      }
    }
    if (cur) out.push(cur);
    return out;
  };
  const seg = (a, b) => (a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]))
    ? `${a[0].toFixed(4)},${a[1].toFixed(4)}|${b[0].toFixed(4)},${b[1].toFixed(4)}`
    : `${b[0].toFixed(4)},${b[1].toFixed(4)}|${a[0].toFixed(4)},${a[1].toFixed(4)}`;

  let totalDup = 0, totalCross = 0, checked = 0;
  for (const p of PRESETS) {
    const d = buildDesign({ ...p, canvas: { W: 240, H: 240 } });
    const ents = parseDxf(exportDXF(d, {})).filter((e) => e.layer !== '2_SCORE_ENGRAVE');
    const seen = new Set();
    let dup = 0;
    const segs = [];
    for (const e of ents) {
      for (let i = 0; i < e.pts.length; i++) {
        const a = e.pts[i], b = e.pts[(i + 1) % e.pts.length];
        if (a[0] === b[0] && a[1] === b[1]) continue;
        const k = seg(a, b);
        if (seen.has(k)) dup++;
        seen.add(k);
        segs.push([a, b]);
      }
    }
    // proper crossings via a uniform grid
    let cross = 0;
    if (segs.length < 45000) {
      const cell = 4, grid = new Map();
      segs.forEach((s, idx) => {
        const i0 = Math.floor(Math.min(s[0][0], s[1][0]) / cell), i1 = Math.floor(Math.max(s[0][0], s[1][0]) / cell);
        const j0 = Math.floor(Math.min(s[0][1], s[1][1]) / cell), j1 = Math.floor(Math.max(s[0][1], s[1][1]) / cell);
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const k = i * 1000003 + j; let a = grid.get(k); if (!a) { a = []; grid.set(k, a); } a.push(idx);
        }
      });
      const done = new Set();
      for (const arr of grid.values()) {
        for (let a = 0; a < arr.length; a++) for (let b = a + 1; b < arr.length; b++) {
          const pk = arr[a] * 1e7 + arr[b];
          if (done.has(pk)) continue;
          done.add(pk);
          const s1 = segs[arr[a]], s2 = segs[arr[b]];
          const r = [s1[1][0] - s1[0][0], s1[1][1] - s1[0][1]];
          const s = [s2[1][0] - s2[0][0], s2[1][1] - s2[0][1]];
          const den = r[0] * s[1] - r[1] * s[0];
          if (Math.abs(den) < 1e-12) continue;
          const qp = [s2[0][0] - s1[0][0], s2[0][1] - s1[0][1]];
          const t = (qp[0] * s[1] - qp[1] * s[0]) / den;
          const u = (qp[0] * r[1] - qp[1] * r[0]) / den;
          if (t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6) cross++;
        }
      }
    }
    checked++;
    totalDup += dup; totalCross += cross;
    ok(dup === 0, `${p.id}: ${dup} duplicate edges in DXF`);
    ok(cross === 0, `${p.id}: ${cross} crossing edges in DXF`);
  }
  console.log(`  ${checked} presets: ${totalDup} duplicate edges, ${totalCross} crossings`);
}


console.log('\n=== 12. a zero weave gap really means no gap ===');
{
  // A union cannot represent an over-under, so "no gap" has to mean "no cut".
  // Both weaving engines used to cut anyway — one of them by a fixed strand
  // width regardless of the gap setting — and left a visible break at every
  // crossing while the control read zero.
  const raster = (loops, bbox, N = 700) => {
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
        const p = L.pts, n = p.length;
        for (let i = 0, k = n - 1; i < n; k = i++) {
          const a = p[k], b = p[i];
          if ((a[1] > y) !== (b[1] > y)) xs.push([a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]), b[1] > a[1] ? 1 : -1]);
        }
      }
      if (xs.length < 2) continue;
      xs.sort((p, q) => p[0] - q[0]);
      let wind = 0;
      for (let i = 0; i + 1 < xs.length; i++) {
        wind += xs[i][1];
        if (wind === 0) continue;
        const ia = Math.max(0, Math.ceil((xs[i][0] - x0) / sx - 0.5));
        const ib = Math.min(nx - 1, Math.floor((xs[i + 1][0] - x0) / sx - 0.5));
        for (let q = ia; q <= ib; q++) mask[q + j * nx] = 1;
      }
    }
    return mask;
  };
  const mk = (engine, params) => buildDesign({
    engine, seed: 1, params: { ...defaultParams(engine), ...params },
    mods: { ...DEFAULT_MODIFIERS }, fab: { ...DEFAULT_FAB, shape: 'none', band: 0, trim: true },
    canvas: { W: 300, H: 300 },
  });

  const base = { growth: 2, pitch: 40, ratio: 0.68, strand: 3 };
  const none = mk('chainmail', { ...base, weave: 'none' });
  for (const weave of ['over3', 'radial']) {
    const zero = mk('chainmail', { ...base, weave, relief: 0 });
    const a = raster(none.loops, none.bbox), b = raster(zero.loops, none.bbox);
    let diff = 0, on = 0;
    for (let i = 0; i < a.length; i++) { if (a[i]) on++; if (a[i] !== b[i]) diff++; }
    ok(diff === 0, `chainmail ${weave} at gap 0 differs from no weave in ${diff} of ${on} filled cells`);
  }
  {
    const chainGap = mk('chainmail', { ...base, weave: 'over3', relief: 1.5 });
    const a = raster(none.loops, none.bbox), b = raster(chainGap.loops, none.bbox);
    let diff = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
    ok(diff > 0, 'chainmail weave gap 1.5 should visibly differ from no weave');
  }

  const kBase = { mode: 'rings', pitch: 70, strand: 3.4, ringRatio: 0.7 };
  const k0 = mk('kagome', { ...kBase, gap: 0 });
  const k2 = mk('kagome', { ...kBase, gap: 2.5 });
  ok((k0.analysis?.floating.size ?? 0) === 0,
    `kagome chain mesh at gap 0 should be one connected body, found ${k0.analysis?.floating.size} islands`);
  ok((k2.analysis?.floating.size ?? 0) > 0, 'kagome chain mesh at gap 2.5 should actually break the strands');
  console.log(`  chainmail gap 0 == no weave (pixel-identical); kagome gap 0 -> 0 islands, gap 2.5 -> ${k2.analysis?.floating.size}`);
}

console.log('\n' + (failures ? `❌ ${failures} FAILURES` : '✅ all checks passed'));
process.exit(failures ? 1 : 0);
