/* =========================================================================
 * fabrication.js — CNC & 3D fabrication structural integrity engine
 *
 *  • Frame / boundary generator with mounting holes and hanger tabs
 *  • Kerf & tool-offset compensation (laser beam, plasma arc, endmill Ø)
 *  • Topological floating-island detection (raster connected components)
 *  • Auto-bridging: real keyhole merges that tether fallout to the body
 *  • Live fabrication metrics: toolpath length, cut time, material yield
 * =======================================================================*/
import {
  add, sub, mul, dist, dist2, norm, len, lerp, clamp, TAU, EPS,
  circlePts, arcPts, rectPts, roundedRectPts, regularPolygonPts,
  polygonArea, polygonCentroid, pointInPolygon, interiorPoint, bboxOfPaths,
  offsetPolyline, polylineLength, resample, dedupe, region, centerline,
  clipPolygonToConvex, clipPolylineToPolygon, buildShapeTree,
} from './geom.js';

/* ------------------------------------------------------------------ *
 * Frames
 * ------------------------------------------------------------------ */
export const FRAME_SHAPES = [
  { v: 'none', label: 'No frame (open field)' },
  { v: 'rect', label: 'Square / rectangle' },
  { v: 'roundrect', label: 'Rounded rectangle' },
  { v: 'circle', label: 'Circle' },
  { v: 'hex', label: 'Hexagon' },
  { v: 'octagon', label: 'Octagon' },
  { v: 'arch', label: 'Arch' },
  { v: 'shield', label: 'Shield' },
];

/** Outer boundary polygon for a frame shape (convex by construction). */
export function frameOutline(shape, W, H, radius) {
  const hw = W / 2, hh = H / 2;
  // The frame is also the clip boundary for the whole pattern, and clipping
  // costs O(subject x boundary) — so cap its resolution. At 360 segments a
  // 150 mm circle is within 6 microns of true, far below any machine.
  const FRAME_SEGS = 360;
  switch (shape) {
    case 'circle': return circlePts(0, 0, Math.min(hw, hh), FRAME_SEGS);
    case 'hex': return regularPolygonPts(0, 0, Math.min(hw, hh), 6, Math.PI / 2);
    case 'octagon': return regularPolygonPts(0, 0, Math.min(hw, hh), 8, Math.PI / 8);
    case 'roundrect': return roundedRectPts(-hw, -hh, W, H, radius, Math.max(8, Math.round(FRAME_SEGS / 8)));
    case 'arch': {
      const r = hw;
      const straight = Math.max(0, H - r);
      return dedupe([
        [-hw, -hh], [hw, -hh], [hw, -hh + straight],
        ...arcPts(0, -hh + straight, r, 0, Math.PI, FRAME_SEGS / 2),
        [-hw, -hh + straight],
      ]);
    }
    case 'shield': {
      const r = hw;
      return dedupe([
        [-hw, hh * 0.35], [-hw, hh],
        [hw, hh], [hw, hh * 0.35],
        ...arcPts(0, hh * 0.35, r, 0, -Math.PI, FRAME_SEGS / 2).map((p) => [p[0], p[1] * 1.0]),
      ]);
    }
    case 'rect':
    default: return rectPts(-hw, -hh, W, H);
  }
}

/**
 * Build the frame geometry (outer + inner loop) plus mounting features.
 * Returns { paths, inner } where `inner` is the clip boundary for the pattern.
 */
export function buildFrame(F, W, H) {
  if (!F.shape || F.shape === 'none') return { paths: [], inner: null };
  const outer = frameOutline(F.shape, W, H, F.radius);
  const bandW = Math.max(0.2, F.band);
  const inner = shrinkConvex(outer, bandW);
  const paths = [
    region(outer, { layer: 'frame', tag: 'frame-outer' }),
  ];
  if (inner && inner.length >= 3) paths.push(region(inner, { layer: 'frame', tag: 'frame-inner' }));

  // mounting holes, inset into the band
  if (F.holes > 0 && F.holeDia > 0) {
    const n = Math.max(1, F.holes | 0);
    const rIn = bandW / 2;
    const ring = shrinkConvex(outer, bandW / 2);
    if (ring && ring.length > 2) {
      const total = polylineLength(ring, true);
      const cum = [0];
      for (let i = 1; i <= ring.length; i++) cum.push(cum[i - 1] + dist(ring[i - 1], ring[i % ring.length]));
      for (let k = 0; k < n; k++) {
        const s = ((k + 0.5) / n) * total;
        let idx = 1;
        while (idx < cum.length - 1 && cum[idx] < s) idx++;
        const t = (s - cum[idx - 1]) / ((cum[idx] - cum[idx - 1]) || 1);
        const p = lerp(ring[idx - 1], ring[idx % ring.length], t);
        paths.push(region(circlePts(p[0], p[1], F.holeDia / 2), { layer: 'frame', tag: 'mount-hole' }));
      }
    }
  }

  // hanger tab (keyhole slot) at top centre
  if (F.hanger) {
    const topY = Math.max(...outer.map((p) => p[1]));
    const cy = topY - bandW / 2;
    const d = Math.max(2, F.holeDia || 5);
    const slot = dedupe([
      ...arcPts(0, cy, d / 2, -Math.PI, 0),
      ...arcPts(0, cy - d * 0.9, d / 3.4, 0, Math.PI),
    ]);
    paths.push(region(slot, { layer: 'frame', tag: 'hanger' }));
  }
  return { paths, inner: inner && inner.length >= 3 ? inner : null };
}

/** Inset a convex polygon by `d` (used for the frame band). */
function shrinkConvex(poly, d) {
  const c = polygonCentroid(poly);
  const out = offsetPolyline(polygonArea(poly) > 0 ? poly : poly.slice().reverse(), d, true);
  if (out.length < 3) return null;
  // guard against inversion on thin frames
  if (Math.abs(polygonArea(out)) > Math.abs(polygonArea(poly))) return null;
  return out;
}

/* ------------------------------------------------------------------ *
 * Centreline -> ribbon conversion + kerf compensation
 * ------------------------------------------------------------------ */
export function kerfCompensate(loops, kerf) {
  if (Math.abs(kerf) < 1e-4) return loops;
  const tree = depthMap(loops);
  return loops.map((L, i) => {
    // Normalise winding so "left of travel" is always the material side, then
    // offset outward by half the kerf: the beam eats that back off again.
    const ccw = tree[i] % 2 === 0;
    const src = (polygonArea(L.pts) > 0) === ccw ? L.pts : L.pts.slice().reverse();
    const off = offsetPolyline(src, -kerf / 2, true);
    if (off.length < 3) return L;
    // reject degenerate collapses
    if (Math.sign(polygonArea(off)) !== Math.sign(polygonArea(src))) return L;
    return { ...L, pts: off };
  });
}

/**
 * Even-odd nesting depth for every closed loop.
 * Loops are sorted large-to-small; a loop can only be contained by a larger
 * one, and a bounding-box reject makes the common (disjoint) case near-linear.
 */
export function depthMap(loops) {
  const n = loops.length;
  const items = new Array(n);
  for (let i = 0; i < n; i++) {
    const pts = loops[i].pts;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) {
      if (p[0] < x0) x0 = p[0];
      if (p[1] < y0) y0 = p[1];
      if (p[0] > x1) x1 = p[0];
      if (p[1] > y1) y1 = p[1];
    }
    items[i] = { i, pts, area: Math.abs(polygonArea(pts)), bb: [x0, y0, x1, y1], probe: null };
  }
  items.sort((a, b) => b.area - a.area);
  const depth = new Array(n).fill(0);
  for (let a = 0; a < items.length; a++) {
    const it = items[a];
    const p = it.probe || (it.probe = interiorPoint(it.pts));
    let d = 0;
    for (let b = 0; b < a; b++) {
      const c = items[b];
      if (p[0] < c.bb[0] || p[0] > c.bb[2] || p[1] < c.bb[1] || p[1] > c.bb[3]) continue;
      if (pointInPolygon(p, c.pts)) d++;
    }
    depth[it.i] = d;
  }
  return depth;
}

/* ------------------------------------------------------------------ *
 * Topological connectivity — raster connected components
 * ------------------------------------------------------------------ */
/**
 * Rasterise the even-odd fill of all closed loops, label connected material
 * components, and report which loops belong to components that are NOT
 * attached to the main body. Those are the pieces that fall out of a laser
 * bed and land in the slag tray.
 */
export function analyseConnectivity(loops, bbox, gridN = 420, rule = 'nonzero') {
  const [x0, y0, x1, y1] = bbox;
  const W = Math.max(1e-3, x1 - x0), H = Math.max(1e-3, y1 - y0);
  const pad = Math.max(W, H) * 0.01;
  const ox = x0 - pad, oy = y0 - pad;
  const ww = W + pad * 2, hh = H + pad * 2;
  const nx = Math.max(32, Math.min(gridN, Math.round(gridN * Math.sqrt(ww / hh))));
  const ny = Math.max(32, Math.round((nx * hh) / ww));
  const sx = ww / nx, sy = hh / ny;

  const mask = new Uint8Array(nx * ny);
  // scanline fill using the NONZERO winding rule, so overlapping ribbons
  // read as one solid body rather than cancelling each other out
  const xs = [];
  for (let j = 0; j < ny; j++) {
    const y = oy + (j + 0.5) * sy;
    xs.length = 0;
    for (const L of loops) {
      const pts = L.pts;
      const n = pts.length;
      for (let i = 0, k = n - 1; i < n; k = i++) {
        const a = pts[k], b = pts[i];
        if ((a[1] > y) !== (b[1] > y)) {
          xs.push([a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1] || EPS), b[1] > a[1] ? 1 : -1]);
        }
      }
    }
    if (xs.length < 2) continue;
    xs.sort((p, q) => p[0] - q[0]);
    let wind = 0, par = 0;
    for (let i = 0; i + 1 < xs.length; i++) {
      wind += xs[i][1]; par ^= 1;
      if (!(rule === 'evenodd' ? par : wind !== 0)) continue;
      let ia = Math.ceil((xs[i][0] - ox) / sx - 0.5);
      let ib = Math.floor((xs[i + 1][0] - ox) / sx - 0.5);
      ia = Math.max(0, ia); ib = Math.min(nx - 1, ib);
      for (let i2 = ia; i2 <= ib; i2++) mask[i2 + j * nx] = 1;
    }
  }

  // connected components (4-neighbour flood fill)
  const label = new Int32Array(nx * ny).fill(-1);
  const sizes = [];
  const stack = new Int32Array(nx * ny);
  let next = 0;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || label[start] >= 0) continue;
    const id = next++;
    let sp = 0, count = 0;
    stack[sp++] = start;
    label[start] = id;
    while (sp > 0) {
      const c = stack[--sp];
      count++;
      const cx = c % nx, cy = (c / nx) | 0;
      if (cx > 0 && mask[c - 1] && label[c - 1] < 0) { label[c - 1] = id; stack[sp++] = c - 1; }
      if (cx < nx - 1 && mask[c + 1] && label[c + 1] < 0) { label[c + 1] = id; stack[sp++] = c + 1; }
      if (cy > 0 && mask[c - nx] && label[c - nx] < 0) { label[c - nx] = id; stack[sp++] = c - nx; }
      if (cy < ny - 1 && mask[c + nx] && label[c + nx] < 0) { label[c + nx] = id; stack[sp++] = c + nx; }
    }
    sizes.push(count);
  }
  if (!sizes.length) {
    return { floating: new Set(), components: 0, mainId: -1, mask: null, meta: null };
  }
  let mainId = 0;
  for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[mainId]) mainId = i;

  const depth = depthMap(loops);
  const floating = new Set();
  const compOfLoop = new Array(loops.length).fill(-1);
  loops.forEach((L, i) => {
    if (depth[i] % 2 !== 0) return;  // holes are voids, not islands
    const p = interiorPoint(L.pts);
    const gx = Math.floor((p[0] - ox) / sx);
    const gy = Math.floor((p[1] - oy) / sy);
    if (gx < 0 || gy < 0 || gx >= nx || gy >= ny) return;
    const id = label[gx + gy * nx];
    compOfLoop[i] = id;
    if (id >= 0 && id !== mainId) floating.add(i);
  });

  return {
    floating,
    compOfLoop,
    components: sizes.length,
    mainId,
    sizes,
    mask,
    meta: { nx, ny, ox, oy, sx, sy },
    depth,
  };
}

/* ------------------------------------------------------------------ *
 * Auto-bridging — keyhole merge
 * ------------------------------------------------------------------ */
/** Cumulative arc lengths of a closed polyline (length n+1, last = perimeter). */
function cumArc(pts) {
  const n = pts.length;
  const cum = new Array(n + 1);
  cum[0] = 0;
  for (let i = 1; i <= n; i++) cum[i] = cum[i - 1] + dist(pts[i - 1], pts[i % n]);
  return cum;
}

/** Point on a closed polyline at arc-length s (wrapping). */
function ptAtArc(pts, s, cum) {
  const n = pts.length;
  cum = cum || cumArc(pts);
  const total = cum[n];
  s = ((s % total) + total) % total;
  let i = 1;
  while (i <= n && cum[i] < s) i++;
  if (i > n) i = n;
  const seg = cum[i] - cum[i - 1] || 1;
  return lerp(pts[i - 1], pts[i % n], (s - cum[i - 1]) / seg);
}

/** Sub-path of a closed polyline walking forward from arc-length a to b. */
function arcSlice(pts, a, b) {
  const n = pts.length;
  const cum = cumArc(pts);
  const total = cum[n];
  const wrap = (s) => ((s % total) + total) % total;
  a = wrap(a); b = wrap(b);
  const span = wrap(b - a) || total;
  const mids = [];
  for (let k = 0; k < n; k++) {
    const rel = wrap(cum[k] - a);
    if (rel > 1e-9 && rel < span - 1e-9) mids.push([rel, pts[k]]);
  }
  mids.sort((p, q) => p[0] - q[0]);
  const out = [ptAtArc(pts, a, cum)];
  for (const m of mids) out.push(m[1]);
  out.push(ptAtArc(pts, b, cum));
  return dedupe(out, 1e-7);
}

/**
 * Merge two closed loops with a bridge of width `w`.
 * `mode` = 'union' (two separate solids) or 'hole' (island inside a hole).
 * Returns the merged loop, or null if no valid result could be produced.
 */
export function keyholeMerge(A, B, w, mode) {
  const a = resample(A, Math.max(0.25, w / 3), true);
  const b = resample(B, Math.max(0.25, w / 3), true);
  if (a.length < 4 || b.length < 4) return null;

  // nearest vertex pair
  let bi = 0, bj = 0, best = Infinity;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      const d = dist2(a[i], b[j]);
      if (d < best) { best = d; bi = i; bj = j; }
    }
  }
  const cumA = [0]; for (let i = 1; i <= a.length; i++) cumA.push(cumA[i - 1] + dist(a[i - 1], a[i % a.length]));
  const cumB = [0]; for (let i = 1; i <= b.length; i++) cumB.push(cumB[i - 1] + dist(b[i - 1], b[i % b.length]));
  const sA = cumA[bi], sB = cumB[bj];
  const hw = w / 2;

  const areaA = Math.abs(polygonArea(a));
  const areaB = Math.abs(polygonArea(b));
  const target = mode === 'hole' ? areaA - areaB : areaA + areaB;

  const orients = [
    [a, b], [a, b.slice().reverse()],
    [a.slice().reverse(), b], [a.slice().reverse(), b.slice().reverse()],
  ];
  let bestLoop = null, bestErr = Infinity;
  for (const [A2, B2] of orients) {
    const sA2 = nearestArc(A2, a[bi]);
    const sB2 = nearestArc(B2, b[bj]);
    // Both rings are walked the *long* way round, skipping a 2×hw window at
    // the tie point. The two gaps between the slice ends form the bridge.
    const segA = arcSlice(A2, sA2 + hw, sA2 - hw);
    const segB = arcSlice(B2, sB2 + hw, sB2 - hw);
    if (segA.length < 2 || segB.length < 2) continue;
    const loop = dedupe(segA.concat(segB), 1e-6);
    if (loop.length < 6) continue;
    const err = Math.abs(Math.abs(polygonArea(loop)) - target) / (target || 1);
    if (err < bestErr) { bestErr = err; bestLoop = loop; }
  }
  if (!bestLoop || bestErr > 0.08) return null;
  return bestLoop;
}

function nearestArc(pts, q) {
  let best = Infinity, bs = 0, cum = 0;
  for (let i = 0; i < pts.length; i++) {
    const d = dist2(pts[i], q);
    if (d < best) { best = d; bs = cum; }
    cum += dist(pts[i], pts[(i + 1) % pts.length]);
  }
  return bs;
}

/**
 * Tether every floating island to the body. Islands sitting inside a hole are
 * keyholed to the hole boundary; free-standing solids are bridged to the
 * nearest neighbouring solid (or to the frame).
 */
export function autoBridge(loops, analysis, bridgeW, opts = {}) {
  if (!analysis || !analysis.floating.size) return { loops, bridged: 0, failed: 0 };
  const depth = analysis.depth || depthMap(loops);
  const out = loops.map((l) => ({ ...l }));
  const removed = new Set();
  let bridged = 0, failed = 0;

  // A tether must be *short*. Long tendrils flying across the part are never
  // what anyone wants, and chaining dozens of them into one host loop
  // degenerates the even-odd topology.
  const maxSpan = opts.maxSpan ?? Math.max(bridgeW * 14, 18);
  const maxPerHost = opts.maxPerHost ?? 6;
  const maxTotal = opts.maxTotal ?? 500;
  const hostUse = new Map();

  const bbox = loops.map((L) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of L.pts) {
      if (p[0] < x0) x0 = p[0];
      if (p[1] < y0) y0 = p[1];
      if (p[0] > x1) x1 = p[0];
      if (p[1] > y1) y1 = p[1];
    }
    return [x0, y0, x1, y1];
  });
  const boxGap = (a, b) => Math.hypot(
    Math.max(0, Math.max(bbox[a][0] - bbox[b][2], bbox[b][0] - bbox[a][2])),
    Math.max(0, Math.max(bbox[a][1] - bbox[b][3], bbox[b][1] - bbox[a][3])),
  );

  // smallest islands first: tiny fallout is the stuff that actually drops out
  const islands = [...analysis.floating].sort(
    (i, j) => Math.abs(polygonArea(loops[i].pts)) - Math.abs(polygonArea(loops[j].pts)),
  );

  for (const idx of islands) {
    if (removed.has(idx) || bridged >= maxTotal) continue;
    const isl = out[idx];
    if (!isl) continue;

    // pick the physically nearest partner — an enclosing void wall or a
    // neighbouring solid, whichever is actually closest
    let host = -1, bestD = Infinity, mode = 'union';
    for (let k = 0; k < out.length; k++) {
      if (k === idx || removed.has(k)) continue;
      if ((hostUse.get(k) || 0) >= maxPerHost) continue;
      const isEnclosing = depth[k] === depth[idx] - 1;
      const isSolid = depth[k] % 2 === 0;
      if (!isEnclosing && !isSolid) continue;
      // merging into an equal-or-larger neighbour lets clusters chain outward
      // toward the body instead of flinging one long tendril at the frame
      if (isSolid && analysis.floating.has(k)
        && Math.abs(polygonArea(out[k].pts)) < Math.abs(polygonArea(isl.pts))) continue;
      if (boxGap(idx, k) > maxSpan) continue;
      const d = minLoopDistance(isl.pts, out[k].pts);
      if (d < bestD) { bestD = d; host = k; mode = isEnclosing ? 'hole' : 'union'; }
    }
    if (host < 0 || bestD > maxSpan) { failed++; continue; }

    const merged = keyholeMerge(out[host].pts, isl.pts, bridgeW, mode);
    if (!merged) { failed++; continue; }
    out[host] = { ...out[host], pts: merged, tag: 'bridged' };
    hostUse.set(host, (hostUse.get(host) || 0) + 1);
    removed.add(idx);
    bridged++;
  }
  return { loops: out.filter((_, i) => !removed.has(i)), bridged, failed };
}

function minLoopDistance(A, B) {
  const sa = A.length > 90 ? Math.ceil(A.length / 90) : 1;
  const sb = B.length > 90 ? Math.ceil(B.length / 90) : 1;
  let best = Infinity;
  for (let i = 0; i < A.length; i += sa) {
    for (let j = 0; j < B.length; j += sb) {
      const d = dist2(A[i], B[j]);
      if (d < best) best = d;
    }
  }
  return Math.sqrt(best);
}

/* ------------------------------------------------------------------ *
 * Minimum-web check — flags features thinner than the machine can hold
 * ------------------------------------------------------------------ */
export function minWebViolations(loops, minWeb, sampleStep = 2) {
  const bad = [];
  for (let i = 0; i < loops.length; i++) {
    const pts = resample(loops[i].pts, sampleStep, true);
    // self-distance: non-adjacent vertices closer than minWeb indicate a neck
    const n = pts.length;
    const skip = Math.max(3, Math.round(minWeb / sampleStep) + 2);
    let hit = false;
    for (let a = 0; a < n && !hit; a++) {
      for (let b = a + skip; b < n - (a === 0 ? skip : 0); b++) {
        if (dist2(pts[a], pts[b]) < minWeb * minWeb) { hit = true; break; }
      }
    }
    if (hit) bad.push(i);
  }
  return bad;
}

/* ------------------------------------------------------------------ *
 * Fabrication metrics
 * ------------------------------------------------------------------ */
export function computeMetrics(paths, opts) {
  const cut = paths.filter((p) => p.layer !== 'score' && p.closed);
  const bbox = bboxOfPaths(paths);
  const bw = bbox[2] - bbox[0], bh = bbox[3] - bbox[1];

  // Signed material area. With windings normalised (outers CCW, holes CW) the
  // signed sum is exact for non-overlapping geometry; overlapping contours
  // over-count, which is one more reason to trim before trusting the number.
  let material = 0;
  for (const p of cut) material += polygonArea(p.pts);
  material = Math.abs(material);

  let vertices = 0;
  for (const p of paths) vertices += p.pts.length;

  const sheetA = Math.max(1e-6, opts.sheetW * opts.sheetH);
  return {
    bbox,
    width: bw,
    height: bh,
    contours: paths.length,
    vertices,
    materialArea: material,
    boundingArea: bw * bh,
    yieldPct: bw * bh > 0 ? (material / (bw * bh)) * 100 : 0,
    wastePct: bw * bh > 0 ? 100 - (material / (bw * bh)) * 100 : 0,
    sheetUsePct: (bw * bh / sheetA) * 100,
    fitsSheet: bw <= opts.sheetW + 1e-6 && bh <= opts.sheetH + 1e-6,
  };
}

export const DEFAULT_FAB = {
  shape: 'none',
  band: 8,
  radius: 12,
  holes: 0,
  holeDia: 5,
  hanger: false,
  kerf: 0,
  minWeb: 1.5,
  bridgeWidth: 2.5,
  autoBridge: false,
  showIslands: true,
  trim: true,
  sheetW: 600,
  sheetH: 400,
  thickness: 3,
};
