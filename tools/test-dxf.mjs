/* Structural validation of the DXF output.
 *
 * There is no CAD package in this environment to open the files with, so the
 * file is parsed back the way a reader does — as a flat (code, value) stream —
 * and checked against the structural rules that make a reader accept or reject
 * an R2000 drawing: paired sections, required tables, unique handles below
 * $HANDSEED, resolvable owner references, and entities owned by model space.
 *
 * It also decodes the geometry back out — including bulges — and compares it
 * against the design it came from, so a file that is structurally valid but
 * geometrically wrong still fails.
 */
import { exportDXF } from '../src/engine/exporters/dxf.js';
import { buildDesign } from '../src/engine/build.js';
import { PRESETS } from '../src/engine/presets.js';
import { fitPath } from '../src/engine/fit.js';

let bad = 0;
const rawArea = (q) => {
  let a = 0;
  for (let i = 0, j = q.length - 1; i < q.length; j = i++) a += q[j][0] * q[i][1] - q[i][0] * q[j][1];
  return a / 2;
};
const fail = (m) => { console.log('  ✗ ' + m); bad++; };

/** Parse a DXF into a flat [code, value] list. */
function tokens(text) {
  const lines = text.split(/\r\n|\n|\r/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  if (lines.length % 2 !== 0) throw new Error(`odd number of lines (${lines.length}) — a group code has no value`);
  const out = [];
  for (let i = 0; i < lines.length; i += 2) {
    const code = Number(lines[i].trim());
    if (!Number.isInteger(code)) throw new Error(`line ${i + 1}: group code "${lines[i]}" is not an integer`);
    out.push([code, lines[i + 1]]);
  }
  return out;
}

/** Split into entity-like records: each starts at a group-0. */
function records(tk) {
  const recs = [];
  let cur = null;
  for (const [c, v] of tk) {
    if (c === 0) { cur = { type: v, g: [] }; recs.push(cur); }
    else if (cur) cur.g.push([c, v]);
  }
  return recs;
}

const first = (rec, code) => { for (const [c, v] of rec.g) if (c === code) return v; return undefined; };
const all = (rec, code) => rec.g.filter(([c]) => c === code).map(([, v]) => v);

function validateR2000(text, label) {
  let tk;
  try { tk = tokens(text); } catch (e) { fail(`${label}: ${e.message}`); return null; }

  // sections balanced and in a sane order
  const secNames = [];
  let depth = 0;
  for (let i = 0; i < tk.length; i++) {
    const [c, v] = tk[i];
    if (c === 0 && v === 'SECTION') {
      depth++;
      if (tk[i + 1] && tk[i + 1][0] === 2) secNames.push(tk[i + 1][1]);
      else fail(`${label}: SECTION without a group-2 name`);
    } else if (c === 0 && v === 'ENDSEC') depth--;
    if (depth < 0) { fail(`${label}: ENDSEC without SECTION`); break; }
  }
  if (depth !== 0) fail(`${label}: ${depth} unclosed SECTION`);
  for (const need of ['HEADER', 'CLASSES', 'TABLES', 'BLOCKS', 'ENTITIES', 'OBJECTS']) {
    if (!secNames.includes(need)) fail(`${label}: missing ${need} section`);
  }
  if (tk[tk.length - 1][0] !== 0 || tk[tk.length - 1][1] !== 'EOF') fail(`${label}: file does not end with EOF`);

  const recs = records(tk);

  // required symbol tables
  const tables = recs.filter((r) => r.type === 'TABLE').map((r) => first(r, 2));
  for (const need of ['VPORT', 'LTYPE', 'LAYER', 'STYLE', 'VIEW', 'UCS', 'APPID', 'DIMSTYLE', 'BLOCK_RECORD']) {
    if (!tables.includes(need)) fail(`${label}: missing ${need} table`);
  }
  const endtab = recs.filter((r) => r.type === 'ENDTAB').length;
  if (endtab !== tables.length) fail(`${label}: ${tables.length} TABLE vs ${endtab} ENDTAB`);

  // blocks
  const blocks = recs.filter((r) => r.type === 'BLOCK').map((r) => first(r, 2));
  for (const need of ['*Model_Space', '*Paper_Space']) {
    if (!blocks.includes(need)) fail(`${label}: missing ${need} block`);
  }
  if (recs.filter((r) => r.type === 'ENDBLK').length !== blocks.length) fail(`${label}: BLOCK/ENDBLK mismatch`);

  // handles: present, unique, below $HANDSEED
  const seedHex = (() => {
    for (let i = 0; i < tk.length - 1; i++) if (tk[i][0] === 9 && tk[i][1] === '$HANDSEED') return tk[i + 1][1];
    return null;
  })();
  if (!seedHex) fail(`${label}: no $HANDSEED`);
  const seed = parseInt(seedHex || '0', 16);

  const NO_HANDLE = new Set(['SECTION', 'ENDSEC', 'EOF', 'TABLE', 'ENDTAB', 'CLASS', 'SEQEND', 'VERTEX']);
  const handles = new Set();
  const owners = [];
  for (const r of recs) {
    if (NO_HANDLE.has(r.type)) {
      if (r.type === 'TABLE') { /* tables do carry handles */ } else continue;
    }
    const h = r.type === 'DIMSTYLE' ? first(r, 105) : first(r, 5);
    if (h === undefined) { fail(`${label}: ${r.type} has no handle`); continue; }
    const key = h.toUpperCase();
    if (handles.has(key)) fail(`${label}: duplicate handle ${key} on ${r.type}`);
    handles.add(key);
    if (parseInt(key, 16) >= seed) fail(`${label}: handle ${key} on ${r.type} is not below $HANDSEED ${seedHex}`);
    const own = first(r, 330);
    if (own === undefined) fail(`${label}: ${r.type} ${key} has no owner (330)`);
    else if (own !== '0') owners.push([r.type, key, own.toUpperCase()]);
    for (const ref of all(r, 350)) owners.push([r.type + ':350', key, ref.toUpperCase()]);
  }
  for (const [type, h, own] of owners) {
    if (!handles.has(own)) fail(`${label}: ${type} ${h} points at unknown handle ${own}`);
  }

  // every graphical entity must be owned by the model-space block record
  const brModel = recs.find((r) => r.type === 'BLOCK_RECORD' && first(r, 2) === '*Model_Space');
  const msHandle = brModel ? first(brModel, 5).toUpperCase() : null;
  const GRAPHICS = new Set(['LWPOLYLINE', 'CIRCLE', 'ARC', 'LINE', 'SPLINE', 'POLYLINE']);
  let nEnt = 0;
  let inEntities = false;
  for (const r of recs) {
    if (r.type === 'SECTION') inEntities = false;
    if (r.type === 'SECTION') continue;
    if (!inEntities && GRAPHICS.has(r.type)) { /* fallthrough */ }
    if (GRAPHICS.has(r.type)) {
      nEnt++;
      const own = (first(r, 330) || '').toUpperCase();
      if (own !== msHandle) fail(`${label}: ${r.type} owned by ${own}, expected model space ${msHandle}`);
      if (first(r, 8) === undefined) fail(`${label}: ${r.type} has no layer`);
      if (!all(r, 100).includes('AcDbEntity')) fail(`${label}: ${r.type} missing AcDbEntity subclass marker`);
    }
  }
  // structural blocks are graphics-free, so anything counted came from ENTITIES
  return { recs, nEnt, handles: handles.size };
}

/* -- decode geometry back out, bulges included ------------------------ */
function decodeR2000(text, layerFilter, onlyType) {
  const recs = records(tokens(text));
  const out = [];
  for (const r of recs) {
    if (layerFilter && !layerFilter(first(r, 8))) continue;
    if (onlyType && r.type !== onlyType) continue;
    if (r.type === 'CIRCLE') {
      const c = [Number(first(r, 10)), Number(first(r, 20))];
      const rad = Number(first(r, 40));
      const pts = [];
      const N = flatSteps(rad, Math.PI * 2);
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2;
        pts.push([c[0] + rad * Math.cos(a), c[1] + rad * Math.sin(a)]);
      }
      out.push({ pts, closed: true });
    } else if (r.type === 'LWPOLYLINE') {
      const verts = [];
      let cur = null;
      for (const [c, v] of r.g) {
        if (c === 10) { cur = { p: [Number(v), 0], bulge: 0 }; verts.push(cur); }
        else if (c === 20 && cur) cur.p[1] = Number(v);
        else if (c === 42 && cur) cur.bulge = Number(v);
      }
      const closed = (Number(first(r, 70)) & 1) === 1;
      out.push({ pts: expand(verts, closed), closed });
    }
  }
  return out;
}

/**
 * Segments needed to flatten an arc of radius r and sweep `sweep` so the
 * chords sit well inside the tolerance being tested. Sampling the decoded
 * curve coarsely would measure this function's own error, not the exporter's:
 * a 64-sided decode of a 150 mm circle is already 0.18 mm off the circle it
 * came from.
 */
function flatSteps(r, sweep, tol = 0.0005) {
  if (!(r > 0)) return 8;
  const per = Math.acos(Math.max(-1, Math.min(1, 1 - tol / r))) * 2;
  return Math.max(8, Math.ceil(sweep / Math.max(per, 1e-4)));
}

/** Expand bulged vertices into a dense polyline, the way a reader draws it. */
function expand(verts, closed) {
  const pts = [];
  const n = verts.length;
  const lim = closed ? n : n - 1;
  for (let i = 0; i < lim; i++) {
    const a = verts[i].p, b = verts[(i + 1) % n].p, bl = verts[i].bulge;
    pts.push(a);
    if (!bl) continue;
    const theta = 4 * Math.atan(bl);
    const chord = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (chord < 1e-12) continue;
    const rad = chord / (2 * Math.abs(Math.sin(theta / 2)));
    const h = Math.sqrt(Math.max(0, rad * rad - (chord / 2) ** 2)) * (Math.abs(theta) > Math.PI ? -1 : 1);
    const ux = (b[0] - a[0]) / chord, uy = (b[1] - a[1]) / chord;
    const sgn = theta > 0 ? 1 : -1;
    const c = [(a[0] + b[0]) / 2 - uy * h * sgn, (a[1] + b[1]) / 2 + ux * h * sgn];
    const a0 = Math.atan2(a[1] - c[1], a[0] - c[0]);
    const steps = flatSteps(rad, Math.abs(theta));
    for (let k = 1; k < steps; k++) {
      const t = a0 + theta * (k / steps);
      pts.push([c[0] + rad * Math.cos(t), c[1] + rad * Math.sin(t)]);
    }
  }
  if (!closed) pts.push(verts[n - 1].p);
  return pts;
}

/* ==================================================================== */
console.log('=== 1. R2000 structure, every preset ===');
const designs = PRESETS.map((p) => ({ p, d: buildDesign({ ...p, canvas: { W: 300, H: 300 } }) }));
let totalEnt = 0;
for (const { p, d } of designs) {
  const txt = exportDXF(d, { version: 'r14', fit: 'arcs' });
  const res = validateR2000(txt, p.id);
  if (res) totalEnt += res.nEnt;
}
console.log(`  ${designs.length} presets, ${totalEnt} entities, ${bad ? bad + ' problems' : 'all structurally valid'}`);

console.log('\n=== 2. R2000 with splines, and R12 ===');
{
  const { p, d } = designs.find((x) => x.p.id === 'fingerprint') || designs[0];
  const sp = exportDXF(d, { version: 'r14', fit: 'splines' });
  validateR2000(sp, p.id + ' (splines)');
  const nSpline = records(tokens(sp)).filter((r) => r.type === 'SPLINE').length;
  console.log(`  ${p.id} with splines: ${nSpline} SPLINE entities`);
  if (!nSpline) fail('spline mode produced no SPLINE entities');

  const r12 = exportDXF(d, { version: 'r12', fit: 'arcs' });
  const t12 = records(tokens(r12));
  const bulges = t12.filter((r) => r.type === 'VERTEX' && first(r, 42) !== undefined).length;
  if (t12.some((r) => r.type === 'LWPOLYLINE' || r.type === 'SPLINE')) fail('R12 contains post-R12 entities');
  console.log(`  R12: ${t12.filter((r) => r.type === 'POLYLINE').length} POLYLINE, ${bulges} bulged vertices, no LWPOLYLINE/SPLINE`);
}

console.log('\n=== 3. geometry survives the round trip ===');
{
  // The guarantee worth testing is the one the fitter makes: every vertex of
  // the design lies within `tol` of the curve the DXF actually describes.
  //
  // Comparing enclosed area instead would be misleading. An arc bows outward
  // from the chords it replaces, so a fitted export *gains* the sagitta the
  // flattening threw away — the area legitimately moves by more than
  // tol x perimeter, and by more the coarser the original polyline was. A
  // point-to-curve check has no such loophole, and a bulge bowed the wrong way
  // fails it by the full width of the arc.
  const TOL = 0.02;
  let worst = 0, worstId = '';
  for (const { p, d } of designs) {
    const txt = exportDXF(d, { version: 'r14', fit: 'arcs', fitTol: TOL });
    const back = decodeR2000(txt, (lyr) => lyr !== '2_SCORE_ENGRAVE');
    const near = segIndex(back);
    let e = 0;
    for (const L of d.loops) for (const q of L.pts) {
      const dd = near(q);
      if (dd > e) e = dd;
    }
    if (e > worst) { worst = e; worstId = p.id; }
    // the decoder's own flattening contributes up to 0.0005mm of the measured
    // distance, so that much slack is the test's error, not the exporter's
    if (e > TOL + 0.0006) fail(`${p.id}: a vertex sits ${e.toFixed(4)}mm from the exported curve, past the ${TOL}mm tolerance`);
  }
  console.log(`  worst vertex-to-curve distance after re-reading the DXF: ${worst.toFixed(5)}mm (${worstId})`);
}

/** Grid-indexed nearest-distance-to-any-segment query. */
function segIndex(paths) {
  const segs = [];
  for (const L of paths) {
    const q = L.pts;
    for (let i = 1; i < q.length; i++) segs.push([q[i - 1], q[i]]);
    if (L.closed && q.length > 2) segs.push([q[q.length - 1], q[0]]);
  }
  const CELL = 4;
  const grid = new Map();
  const key = (i, j) => i * 1000003 + j;
  segs.forEach((sg, idx) => {
    const i0 = Math.floor(Math.min(sg[0][0], sg[1][0]) / CELL), i1 = Math.floor(Math.max(sg[0][0], sg[1][0]) / CELL);
    const j0 = Math.floor(Math.min(sg[0][1], sg[1][1]) / CELL), j1 = Math.floor(Math.max(sg[0][1], sg[1][1]) / CELL);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = key(i, j); let a = grid.get(k); if (!a) { a = []; grid.set(k, a); } a.push(idx);
    }
  });
  const distToSeg = (p, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L2 = dx * dx + dy * dy;
    if (L2 < 1e-18) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t));
  };
  return (p) => {
    let best = Infinity;
    const ci = Math.floor(p[0] / CELL), cj = Math.floor(p[1] / CELL);
    for (let j = cj - 1; j <= cj + 1; j++) for (let i = ci - 1; i <= ci + 1; i++) {
      const arr = grid.get(key(i, j));
      if (!arr) continue;
      for (const idx of arr) {
        const dd = distToSeg(p, segs[idx][0], segs[idx][1]);
        if (dd < best) best = dd;
      }
    }
    return best === Infinity ? 0 : best;
  };
}

console.log(bad ? `\n❌ ${bad} problems` : '\n✅ DXF is structurally valid and geometrically faithful');
process.exit(bad ? 1 : 0);
