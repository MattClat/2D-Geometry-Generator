/* =========================================================================
 * geom.js — 2D vector CAD kernel
 *
 * Everything in this application is ultimately a list of *polylines*:
 *
 *   Path = {
 *     pts:    [[x,y], ...]      // millimetres, Y-up (CAD convention)
 *     closed: boolean
 *     kind:   'centerline' | 'region'
 *     layer:  'cut' | 'score' | 'frame'
 *     width:  number            // ribbon width when kind === 'centerline'
 *     taper:  number            // 0 = uniform, >0 = variable-width ribbon
 *   }
 *
 * Curves are flattened to polylines at a controlled chord tolerance, which
 * is exactly what a laser/plasma/router controller consumes anyway, and it
 * makes DXF LWPOLYLINE export lossless.
 * =======================================================================*/

export const TAU = Math.PI * 2;
export const EPS = 1e-9;

/* ---------------------------------------------------------------- *
 * Vector helpers (plain arrays: [x, y])
 * ---------------------------------------------------------------- */
export const v = (x, y) => [x, y];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
export const mul = (a, s) => [a[0] * s, a[1] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
export const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
export const len = (a) => Math.hypot(a[0], a[1]);
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
export const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };
export const perp = (a) => [-a[1], a[0]];
export const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
export const rot = (a, ang) => {
  const c = Math.cos(ang), s = Math.sin(ang);
  return [a[0] * c - a[1] * s, a[0] * s + a[1] * c];
};
export const rotAbout = (a, c, ang) => add(rot(sub(a, c), ang), c);
export const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
export const mix = (a, b, t) => a + (b - a) * t;
export const smoothstep = (t) => t * t * (3 - 2 * t);

/* ---------------------------------------------------------------- *
 * Path construction helpers
 * ---------------------------------------------------------------- */
export function path(pts, opts = {}) {
  return {
    pts,
    closed: opts.closed !== false,
    kind: opts.kind || 'centerline',
    layer: opts.layer || 'cut',
    width: opts.width,
    taper: opts.taper || 0,
    tag: opts.tag,
  };
}
export const centerline = (pts, opts = {}) => path(pts, { closed: false, kind: 'centerline', ...opts });
export const region = (pts, opts = {}) => path(pts, { closed: true, kind: 'region', ...opts });

/** Flattened circle. */
export function circlePts(cx, cy, r, segs = 0) {
  const n = segs || Math.max(12, Math.ceil(TAU * r / 0.35));
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    out[i] = [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  }
  return out;
}

/** Flattened circular arc from a0 to a1 (radians, CCW if a1 > a0). */
export function arcPts(cx, cy, r, a0, a1, segs = 0) {
  const sweep = a1 - a0;
  const n = segs || Math.max(2, Math.ceil(Math.abs(sweep) * r / 0.35));
  const out = new Array(n + 1);
  for (let i = 0; i <= n; i++) {
    const a = a0 + sweep * (i / n);
    out[i] = [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  }
  return out;
}

export function regularPolygonPts(cx, cy, r, sides, phase = 0) {
  const out = [];
  for (let i = 0; i < sides; i++) {
    const a = phase + (i / sides) * TAU;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

export function rectPts(x, y, w, h) {
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
}

export function roundedRectPts(x, y, w, h, r, maxCornerSegs = 0) {
  r = Math.min(r, Math.min(w, h) / 2);
  if (r <= EPS) return rectPts(x, y, w, h);
  const out = [];
  const c = [
    [x + w - r, y + r, -Math.PI / 2, 0],
    [x + w - r, y + h - r, 0, Math.PI / 2],
    [x + r, y + h - r, Math.PI / 2, Math.PI],
    [x + r, y + r, Math.PI, Math.PI * 1.5],
  ];
  for (const [ccx, ccy, a0, a1] of c) out.push(...arcPts(ccx, ccy, r, a0, a1, maxCornerSegs));
  return dedupe(out);
}

/** Star / cog outline, alternating outer and inner radii. */
export function starPts(cx, cy, rOuter, rInner, points, phase = 0) {
  const out = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? rOuter : rInner;
    const a = phase + (i / (points * 2)) * TAU;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

/** Cubic Bezier flattened adaptively. */
export function bezierPts(p0, p1, p2, p3, segs = 24) {
  const out = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, u = 1 - t;
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
  return out;
}

/** Catmull-Rom spline through points -> smooth flattened polyline. */
export function splinePts(pts, closed = false, samplesPerSeg = 10, tension = 0.5) {
  const n = pts.length;
  if (n < 3) return pts.slice();
  const out = [];
  const at = (i) => (closed ? pts[(i % n + n) % n] : pts[clamp(i, 0, n - 1)]);
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    for (let s = 0; s < samplesPerSeg; s++) {
      const t = s / samplesPerSeg, t2 = t * t, t3 = t2 * t;
      const c0 = -tension * t3 + 2 * tension * t2 - tension * t;
      const c1 = (2 - tension) * t3 + (tension - 3) * t2 + 1;
      const c2 = (tension - 2) * t3 + (3 - 2 * tension) * t2 + tension * t;
      const c3 = tension * t3 - tension * t2;
      out.push([
        c0 * p0[0] + c1 * p1[0] + c2 * p2[0] + c3 * p3[0],
        c0 * p0[1] + c1 * p1[1] + c2 * p2[1] + c3 * p3[1],
      ]);
    }
  }
  if (!closed) out.push(pts[n - 1]);
  return out;
}

/* ---------------------------------------------------------------- *
 * Polyline measurement / cleanup
 * ---------------------------------------------------------------- */
export function dedupe(pts, tol = 1e-6) {
  const out = [];
  for (const p of pts) {
    if (!out.length || dist2(out[out.length - 1], p) > tol * tol) out.push(p);
  }
  return out;
}

export function polylineLength(pts, closed) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]);
  if (closed && pts.length > 2) L += dist(pts[pts.length - 1], pts[0]);
  return L;
}

export function polygonArea(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2; // signed: >0 CCW
}

export function polygonCentroid(pts) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    const f = p[0] * q[1] - q[0] * p[1];
    a += f; cx += (p[0] + q[0]) * f; cy += (p[1] + q[1]) * f;
  }
  if (Math.abs(a) < EPS) {
    let sx = 0, sy = 0;
    for (const p of pts) { sx += p[0]; sy += p[1]; }
    return [sx / pts.length, sy / pts.length];
  }
  a *= 0.5;
  return [cx / (6 * a), cy / (6 * a)];
}

export function ensureWinding(pts, ccw = true) {
  return (polygonArea(pts) > 0) === ccw ? pts : pts.slice().reverse();
}

export function bboxOf(pts, box) {
  const b = box || [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of pts) {
    if (p[0] < b[0]) b[0] = p[0];
    if (p[1] < b[1]) b[1] = p[1];
    if (p[0] > b[2]) b[2] = p[0];
    if (p[1] > b[3]) b[3] = p[1];
  }
  return b;
}

export function bboxOfPaths(paths) {
  let b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of paths) b = bboxOf(p.pts, b);
  if (!isFinite(b[0])) return [0, 0, 0, 0];
  return b;
}

/** Even–odd point-in-polygon (ray casting). */
export function pointInPolygon(pt, poly) {
  let inside = false;
  const x = pt[0], y = pt[1];
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi + EPS) + xi) inside = !inside;
  }
  return inside;
}

/** Uniform arc-length resampling (keeps geometry well-conditioned for offsets). */
export function resample(pts, step, closed = false) {
  if (pts.length < 2) return pts.slice();
  const src = closed ? pts.concat([pts[0]]) : pts;
  const out = [src[0]];
  let carry = 0;
  for (let i = 1; i < src.length; i++) {
    const a = src[i - 1], b = src[i];
    let d = dist(a, b);
    if (d < EPS) continue;
    let t = (step - carry) / d;
    while (t <= 1) {
      out.push(lerp(a, b, t));
      t += step / d;
    }
    carry = (1 - (t - step / d)) * d;
  }
  if (!closed) {
    const last = src[src.length - 1];
    if (dist(out[out.length - 1], last) > step * 0.35) out.push(last);
  } else if (dist(out[out.length - 1], out[0]) < step * 0.35) {
    out.pop();
  }
  return out.length >= 2 ? out : pts.slice();
}

/**
 * Subdivide every segment so no piece is longer than `maxSeg`, **keeping every
 * original vertex exactly**.
 *
 * This matters enormously downstream: `resample` walks a uniform arc length
 * and therefore slides corners around, so two shapes that shared a corner
 * before resampling no longer share it afterwards. The boolean trim then sees
 * a torn planar graph and merges faces that should have stayed separate.
 * Anything feeding geometry into deformation or clipping must use this.
 */
export function densify(pts, maxSeg, closed = false) {
  if (pts.length < 2 || maxSeg <= 0) return pts.slice();
  const out = [];
  const n = pts.length;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    out.push(a);
    const d = dist(a, b);
    if (d <= maxSeg) continue;
    const k = Math.ceil(d / maxSeg);
    for (let s = 1; s < k; s++) out.push(lerp(a, b, s / k));
  }
  if (!closed) out.push(pts[n - 1]);
  return out;
}

/**
 * Ramer–Douglas–Peucker for a *closed* ring.
 *
 * Plain RDP anchors the first and last point, so running it on a ring whose
 * ends coincide gives a zero-length baseline: every point measures zero
 * deviation from it and the whole ring collapses to two points. Splitting the
 * ring at two well-separated anchors first fixes that.
 *
 * `pts` must NOT repeat the first point at the end.
 */
export function simplifyClosed(pts, tol) {
  if (pts.length < 5 || tol <= 0) return pts;
  let far = 1, best = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = dist2(pts[0], pts[i]);
    if (d > best) { best = d; far = i; }
  }
  const a = simplify(pts.slice(0, far + 1), tol);
  const b = simplify(pts.slice(far).concat([pts[0]]), tol);
  const out = a.slice(0, -1).concat(b.slice(0, -1));
  return out.length >= 3 ? out : pts;
}

/** Ramer–Douglas–Peucker simplification. Keeps files small without visible loss. */
export function simplify(pts, tol) {
  if (pts.length < 3 || tol <= 0) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let maxD = -1, idx = -1;
    const a = pts[s], b = pts[e];
    const ab = sub(b, a), abl = len(ab) || 1;
    for (let i = s + 1; i < e; i++) {
      const d = Math.abs(cross(ab, sub(pts[i], a))) / abl;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol && idx > 0) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  const out = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
  return out;
}

/* ---------------------------------------------------------------- *
 * Corner filleting — sharp corners -> tangent arcs.
 * Essential for router work (an endmill cannot cut an inside sharp corner)
 * and for the "soft" visual language of modern encaustic / Memphis tiles.
 * ---------------------------------------------------------------- */
export function fillet(pts, radius, closed) {
  if (radius <= EPS || pts.length < 3) return pts;
  const n = pts.length;
  const out = [];
  const start = closed ? 0 : 1;
  const end = closed ? n : n - 1;
  if (!closed) out.push(pts[0]);
  for (let i = start; i < end; i++) {
    const p = pts[i];
    const a = pts[(i - 1 + n) % n];
    const b = pts[(i + 1) % n];
    const d1 = sub(a, p), d2 = sub(b, p);
    const l1 = len(d1), l2 = len(d2);
    if (l1 < EPS || l2 < EPS) { out.push(p); continue; }
    const u1 = mul(d1, 1 / l1), u2 = mul(d2, 1 / l2);
    let cosT = clamp(dot(u1, u2), -1, 1);
    const theta = Math.acos(cosT);
    if (theta < 0.02 || Math.PI - theta < 0.02) { out.push(p); continue; }
    const tanHalf = Math.tan(theta / 2);
    let r = Math.min(radius, (Math.min(l1, l2) * 0.5) * tanHalf);
    const tLen = r / tanHalf;
    const t1 = add(p, mul(u1, tLen));
    const t2 = add(p, mul(u2, tLen));
    // centre lies along the angle bisector
    const bis = norm(add(u1, u2));
    const cDist = r / Math.sin(theta / 2);
    const c = add(p, mul(bis, cDist));
    let a0 = Math.atan2(t1[1] - c[1], t1[0] - c[0]);
    let a1 = Math.atan2(t2[1] - c[1], t2[0] - c[0]);
    let sweep = a1 - a0;
    while (sweep > Math.PI) sweep -= TAU;
    while (sweep < -Math.PI) sweep += TAU;
    const segs = Math.max(2, Math.ceil(Math.abs(sweep) * r / 0.3));
    for (let s = 0; s <= segs; s++) {
      const ang = a0 + sweep * (s / segs);
      out.push([c[0] + r * Math.cos(ang), c[1] + r * Math.sin(ang)]);
    }
  }
  if (!closed) out.push(pts[n - 1]);
  return dedupe(out, 1e-5);
}

/* ---------------------------------------------------------------- *
 * Offsetting
 * ---------------------------------------------------------------- */

/**
 * Offset an open or closed polyline by `d` (left-positive) using round joins.
 * Round joins keep the result artefact-free on tight curvature, which matters
 * because ribbon widths here can approach the local radius of curvature.
 */
export function offsetPolyline(pts, d, closed, miterLimit = 4) {
  if (Math.abs(d) < 1e-7 || pts.length < 2) return pts.slice();
  const p = dedupe(pts, 1e-7);
  const n = p.length;
  if (n < 2) return pts.slice();
  const m = closed ? n : n - 1;
  if (m < 1) return pts.slice();

  // unit direction + left normal of every segment
  const dir = new Array(m), nrm = new Array(m);
  for (let i = 0; i < m; i++) {
    const a = p[i], b = p[(i + 1) % n];
    const dd = norm(sub(b, a));
    dir[i] = dd;
    nrm[i] = [-dd[1], dd[0]];
  }

  const out = [];
  const arcJoin = (c, from, to) => {
    const r = Math.abs(d);
    let a0 = Math.atan2(from[1], from[0]);
    let a1 = Math.atan2(to[1], to[0]);
    let sweep = a1 - a0;
    while (sweep > Math.PI) sweep -= TAU;
    while (sweep < -Math.PI) sweep += TAU;
    const segs = Math.max(1, Math.ceil(Math.abs(sweep) / 0.3));
    for (let s = 0; s <= segs; s++) {
      const ang = a0 + sweep * (s / segs);
      out.push([c[0] + r * Math.cos(ang), c[1] + r * Math.sin(ang)]);
    }
  };

  if (!closed) out.push(add(p[0], mul(nrm[0], d)));

  const vStart = closed ? 0 : 1;
  const vEnd = closed ? n : n - 1;
  for (let i = vStart; i < vEnd; i++) {
    const iPrev = ((i - 1) % m + m) % m;   // segment ending at vertex i
    const iNext = i % m;                   // segment starting at vertex i
    const np = nrm[iPrev], nn = nrm[iNext];
    const turn = cross(dir[iPrev], dir[iNext]);
    const P = p[i % n];
    const A = add(P, mul(np, d));
    const B = add(P, mul(nn, d));

    if (Math.abs(turn) < 1e-9) { out.push(A); continue; }

    // On the side the offset moves *away* from, the two offset segments open a
    // wedge -> fill it with an arc. On the other side they overlap -> miter.
    const outward = (d > 0) === (turn < 0);
    if (outward) {
      arcJoin(P, mul(np, d), mul(nn, d));
    } else {
      // intersect the two offset lines
      const denom = cross(dir[iPrev], dir[iNext]);
      const t = cross(sub(B, A), dir[iNext]) / denom;
      const X = add(A, mul(dir[iPrev], t));
      const miterLen = dist(X, P);
      if (miterLen > Math.abs(d) * miterLimit) { out.push(A); out.push(B); }
      else out.push(X);
    }
  }
  if (!closed) out.push(add(p[n - 1], mul(nrm[m - 1], d)));

  return dedupe(out, 1e-7);
}

/**
 * Build a closed ribbon (a real, cuttable outline) around a centerline.
 *  - open centerline  -> single closed loop with round caps
 *  - closed centerline-> two concentric loops (outer + inner); even-odd fill
 *    renders the annulus and the shape-tree turns it into a solid with a hole.
 * `taper` (0..1) modulates width along the run for calligraphic strands.
 */
export function ribbon(pts, width, closed, taper = 0, capRound = true) {
  const hw = width / 2;
  if (pts.length < 2 || hw <= 0) return [];
  if (closed) {
    // Two concentric loops. Their winding is decided HERE, by comparing
    // areas, and flagged as fixed: inferring it later from nesting depth is
    // wrong the moment two rings overlap, which turns the hole of an annulus
    // into solid material.
    const a = offsetPolyline(pts, hw, true);
    const b = offsetPolyline(pts, -hw, true);
    if (a.length < 3 || b.length < 3) return [];
    const outer = Math.abs(polygonArea(a)) >= Math.abs(polygonArea(b)) ? a : b;
    const inner = outer === a ? b : a;
    return [
      { pts: ensureWinding(outer, true), closed: true, fixedWinding: true },
      { pts: ensureWinding(inner, false), closed: true, fixedWinding: true },
    ];
  }
  if (taper > 0) return [{ pts: ensureWinding(taperedRibbon(pts, width, taper, capRound), true), closed: true, fixedWinding: true }];
  const left = offsetPolyline(pts, hw, false);
  const right = offsetPolyline(pts, -hw, false);
  const loop = left.slice();
  if (capRound) {
    const e = pts[pts.length - 1];
    const a0 = Math.atan2(left[left.length - 1][1] - e[1], left[left.length - 1][0] - e[0]);
    loop.push(...arcPts(e[0], e[1], hw, a0, a0 - Math.PI).slice(1, -1));
  }
  loop.push(...right.slice().reverse());
  if (capRound) {
    const s = pts[0];
    const a0 = Math.atan2(right[0][1] - s[1], right[0][0] - s[0]);
    loop.push(...arcPts(s[0], s[1], hw, a0, a0 - Math.PI).slice(1, -1));
  }
  return [{ pts: ensureWinding(dedupe(loop, 1e-6), true), closed: true, fixedWinding: true }];
}

/** Variable-width ribbon: width follows a sine envelope along arc length. */
function taperedRibbon(pts, width, taper, capRound) {
  const rs = resample(pts, Math.max(0.4, polylineLength(pts, false) / 220), false);
  const n = rs.length;
  const hw = width / 2;
  const wAt = (t) => hw * (1 - taper * 0.9 * (0.5 - 0.5 * Math.cos(t * TAU * 1.0 + 0.6)));
  const left = [], right = [];
  for (let i = 0; i < n; i++) {
    const a = rs[Math.max(0, i - 1)], b = rs[Math.min(n - 1, i + 1)];
    const dir = norm(sub(b, a));
    const nrm = [-dir[1], dir[0]];
    const w = wAt(i / (n - 1));
    left.push([rs[i][0] + nrm[0] * w, rs[i][1] + nrm[1] * w]);
    right.push([rs[i][0] - nrm[0] * w, rs[i][1] - nrm[1] * w]);
  }
  const loop = left.concat(right.reverse());
  return dedupe(loop, 1e-6);
}

/* ---------------------------------------------------------------- *
 * Shape tree — even-odd nesting resolution.
 * Converts a flat soup of closed loops into { outer, holes } groups so the
 * 3D extruder and the STL exporter know what is material and what is void.
 * ---------------------------------------------------------------- */
export function buildShapeTree(loops) {
  const items = loops.map((L, i) => ({
    i,
    pts: L.pts,
    area: Math.abs(polygonArea(L.pts)),
    bbox: bboxOf(L.pts),
    depth: 0,
    parent: -1,
  })).filter((it) => it.area > 1e-6);
  items.sort((a, b) => b.area - a.area);

  const ptInBox = (p, b) => p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    // sample a point guaranteed to lie inside the loop
    const probe = interiorPoint(it.pts);
    for (let j = i - 1; j >= 0; j--) {
      const cand = items[j];
      if (!ptInBox(probe, cand.bbox)) continue;
      if (pointInPolygon(probe, cand.pts)) { it.parent = j; it.depth = cand.depth + 1; break; }
    }
  }
  const shapes = [];
  const byIdx = new Map();
  items.forEach((it, idx) => {
    if (it.depth % 2 === 0) {
      const s = { outer: it.pts, holes: [], _i: it.i };
      shapes.push(s);
      byIdx.set(idx, s);
    }
  });
  items.forEach((it) => {
    if (it.depth % 2 === 1 && it.parent >= 0) {
      const host = byIdx.get(it.parent);
      if (host) host.holes.push(it.pts);
    }
  });
  return shapes;
}

/**
 * A point robustly inside a simple polygon (centroid, else edge-midpoint
 * probe).
 *
 * The probe search is capped: each `pointInPolygon` costs O(n), so trying
 * every edge of a self-intersecting 100k-point outline is quadratic and will
 * hang outright. Sampling a bounded number of edges finds an interior point
 * just as reliably in practice.
 */
export function interiorPoint(pts) {
  const c = polygonCentroid(pts);
  if (pointInPolygon(c, pts)) return c;
  const MAX_PROBES = 64;
  const stride = Math.max(1, Math.floor(pts.length / MAX_PROBES));
  for (let i = 0; i < pts.length; i += stride) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const m = lerp(a, b, 0.5);
    const nrm = norm(perp(sub(b, a)));
    for (const s of [0.01, 0.05, 0.2]) {
      const p1 = [m[0] + nrm[0] * s, m[1] + nrm[1] * s];
      if (pointInPolygon(p1, pts)) return p1;
      const p2 = [m[0] - nrm[0] * s, m[1] - nrm[1] * s];
      if (pointInPolygon(p2, pts)) return p2;
    }
  }
  return c;
}

/* ---------------------------------------------------------------- *
 * Clipping — Sutherland–Hodgman against a convex boundary, plus a
 * generic "keep what is inside" filter used to trim tiled patterns to
 * the chosen outer frame.
 * ---------------------------------------------------------------- */
export function clipPolygonToConvex(subject, clipPoly) {
  let output = subject;
  const n = clipPoly.length;
  for (let i = 0; i < n; i++) {
    const A = clipPoly[i], B = clipPoly[(i + 1) % n];
    const input = output;
    output = [];
    if (!input.length) break;
    const insideOf = (p) => cross(sub(B, A), sub(p, A)) >= -1e-9;
    const inter = (p, q) => {
      const d1 = cross(sub(B, A), sub(p, A));
      const d2 = cross(sub(B, A), sub(q, A));
      const t = d1 / (d1 - d2 || EPS);
      return lerp(p, q, t);
    };
    for (let j = 0; j < input.length; j++) {
      const cur = input[j], prv = input[(j + input.length - 1) % input.length];
      const ci = insideOf(cur), pi = insideOf(prv);
      if (ci) {
        if (!pi) output.push(inter(prv, cur));
        output.push(cur);
      } else if (pi) output.push(inter(prv, cur));
    }
  }
  return output;
}

/**
 * Exact clip of an open polyline against a **convex** boundary.
 *
 * Each segment is trimmed analytically (Cyrus–Beck against the boundary's
 * half-planes) and consecutive surviving pieces are stitched back into runs.
 * The old approach densified the polyline and kept the points that tested
 * inside, which needed hundreds of samples per long segment and still landed
 * the cut in the wrong place by up to one sample step.
 */
export function clipPolylineToPolygon(pts, boundary) {
  const n = boundary.length;
  const runs = [];
  let cur = null;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    const d = sub(b, a);
    let t0 = 0, t1 = 1, dropped = false;
    for (let e = 0; e < n && !dropped; e++) {
      const A = boundary[e], B = boundary[(e + 1) % n];
      const edge = sub(B, A);
      // inside is to the left of A->B for a CCW boundary
      const denom = cross(edge, d);
      const num = cross(edge, sub(a, A));
      if (Math.abs(denom) < 1e-12) { if (num < 0) dropped = true; continue; }
      const t = -num / denom;
      if (denom > 0) { if (t > t0) t0 = t; } else if (t < t1) t1 = t;
      if (t0 > t1) dropped = true;
    }
    if (dropped || t1 - t0 < 1e-12) { cur = null; continue; }
    const p0 = t0 <= 0 ? a : lerp(a, b, t0);
    const p1 = t1 >= 1 ? b : lerp(a, b, t1);
    if (cur && t0 <= 1e-12 && dist2(cur[cur.length - 1], p0) < 1e-18) {
      cur.push(p1);
    } else {
      cur = [p0, p1];
      runs.push(cur);
    }
    if (t1 < 1 - 1e-12) cur = null;      // left the region: start a new run next time
  }
  return runs.filter((r) => r.length > 1);
}

/* ---------------------------------------------------------------- *
 * Transform helpers
 * ---------------------------------------------------------------- */
export function transformPts(pts, fn) {
  const out = new Array(pts.length);
  for (let i = 0; i < pts.length; i++) out[i] = fn(pts[i]);
  return out;
}

export function translatePath(p, dx, dy) {
  return { ...p, pts: p.pts.map((q) => [q[0] + dx, q[1] + dy]) };
}

export function rotatePath(p, ang, cx = 0, cy = 0) {
  const c = Math.cos(ang), s = Math.sin(ang);
  return { ...p, pts: p.pts.map(([x, y]) => {
    const dx = x - cx, dy = y - cy;
    return [cx + dx * c - dy * s, cy + dx * s + dy * c];
  }) };
}

export function scalePath(p, sx, sy = sx, cx = 0, cy = 0) {
  return { ...p, pts: p.pts.map(([x, y]) => [cx + (x - cx) * sx, cy + (y - cy) * sy]) };
}

export function mirrorPath(p, axis = 'x', c = 0) {
  return { ...p, pts: p.pts.map(([x, y]) => (axis === 'x' ? [2 * c - x, y] : [x, 2 * c - y])).reverse() };
}
