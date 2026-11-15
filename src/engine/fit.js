/* =========================================================================
 * fit.js — turning flattened polylines back into circles, arcs and splines
 *
 * The whole pipeline works in polylines, because that is the only
 * representation a planar arrangement, a rasteriser and a triangulator can all
 * agree on. But a polyline is a poor thing to hand a CAD package: a 220-sided
 * polygon that was a circle three steps ago imports as a 220-sided polygon,
 * and every downstream fillet, offset and toolpath inherits the facets.
 *
 * So the curves are recovered at *export* time. Nothing upstream changes; the
 * exporters ask for a list of primitives instead of a list of points.
 *
 *   fitPath(pts, closed, opts) -> { circle } | { segs: [...] }
 *
 * where each seg is { type:'line', a, b }
 *                or { type:'arc',  a, b, c, r, sweep, bulge }
 *                or { type:'spline', pts, ctrl, knots, degree }
 *
 * The tolerance is a real geometric guarantee: every original vertex lies
 * within `tol` of the emitted primitive. Nothing is smoothed *past* the
 * tolerance, so a fitted export is never a different part from the polyline
 * one — it is the same part described better.
 * =======================================================================*/

const TAU = Math.PI * 2;

/* ------------------------------------------------------------------ *
 * Circle through three points, and least-squares circle through many
 * ------------------------------------------------------------------ */

/** Exact circle through three points, or null if they are collinear. */
function circle3(p, q, s) {
  const ax = p[0], ay = p[1], bx = q[0], by = q[1], cx = s[0], cy = s[1];
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-12) return null;
  const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx * cx + cy * cy;
  const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
  const uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
  const r = Math.hypot(ax - ux, ay - uy);
  if (!isFinite(r) || r <= 0) return null;
  return { c: [ux, uy], r };
}

/**
 * Kåsa algebraic least-squares circle. Used only as a first guess for the
 * whole-contour circle test, where a three-point fit through an unlucky
 * triple would be noticeably off.
 */
function circleLSQ(pts) {
  const n = pts.length;
  if (n < 3) return null;
  let mx = 0, my = 0;
  for (const p of pts) { mx += p[0]; my += p[1]; }
  mx /= n; my /= n;
  let Suu = 0, Suv = 0, Svv = 0, Suuu = 0, Svvv = 0, Suvv = 0, Svuu = 0;
  for (const p of pts) {
    const u = p[0] - mx, v = p[1] - my;
    Suu += u * u; Svv += v * v; Suv += u * v;
    Suuu += u * u * u; Svvv += v * v * v;
    Suvv += u * v * v; Svuu += v * u * u;
  }
  const det = 2 * (Suu * Svv - Suv * Suv);
  if (Math.abs(det) < 1e-12) return null;
  const b1 = Suuu + Suvv, b2 = Svvv + Svuu;
  const uc = (Svv * b1 - Suv * b2) / det;
  const vc = (Suu * b2 - Suv * b1) / det;
  const c = [uc + mx, vc + my];
  let r = 0;
  for (const p of pts) r += Math.hypot(p[0] - c[0], p[1] - c[1]);
  return { c, r: r / n };
}

/**
 * Walk a run around a candidate centre and report the signed total sweep, the
 * largest angular step, and whether the turning ever reverses.
 *
 * These three numbers are what separates a flattened curve from a polygon,
 * and the distinction cannot be made from distances alone: the four corners
 * of a square are exactly concyclic, so *any* test based only on how far the
 * vertices sit from a circle will happily report that a square is an arc. A
 * square's angular step is 90°; a flattened arc's is a couple of degrees.
 * Reversal catches the other false positive — a zig-zag whose vertices happen
 * to alternate either side of a circle.
 */
function walkAbout(pts, c) {
  let total = 0, maxStep = 0, reversed = false, sign = 0;
  const steps = [];
  let prev = Math.atan2(pts[0][1] - c[1], pts[0][0] - c[0]);
  for (let i = 1; i < pts.length; i++) {
    const a = Math.atan2(pts[i][1] - c[1], pts[i][0] - c[0]);
    let d = a - prev;
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    total += d;
    const ad = Math.abs(d);
    steps.push(ad);
    if (ad > maxStep) maxStep = ad;
    if (ad > 1e-9) {
      const sg = d > 0 ? 1 : -1;
      if (sign === 0) sign = sg;
      else if (sg !== sign) reversed = true;
    }
    prev = a;
  }
  const sorted = steps.slice().sort((x, y) => x - y);
  const median = sorted.length ? sorted[sorted.length >> 1] : 0;
  return { total, maxStep, median, reversed };
}

/** Largest distance from any point to the circle. */
function circleError(pts, C) {
  let e = 0;
  for (const p of pts) {
    const d = Math.abs(Math.hypot(p[0] - C.c[0], p[1] - C.c[1]) - C.r);
    if (d > e) e = d;
  }
  return e;
}

/** Largest distance from any point to the segment a→b. */
function lineError(pts, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L2 = dx * dx + dy * dy;
  let e = 0;
  for (const p of pts) {
    let d;
    if (L2 < 1e-18) d = Math.hypot(p[0] - a[0], p[1] - a[1]);
    else {
      let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      d = Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t));
    }
    if (d > e) e = d;
  }
  return e;
}

/* ------------------------------------------------------------------ *
 * Arc / line fitting
 * ------------------------------------------------------------------ */

/**
 * Can pts[i..j] be represented by one circular arc within tol?
 * Returns the arc, or null.
 */
function tryArc(pts, i, j, tol, maxStep) {
  // Four points minimum, so the circle through three of them is checked
  // against at least one it did not define.
  if (j - i < 3) return null;
  const run = pts.slice(i, j + 1);
  const mid = pts[(i + j) >> 1];
  const C = circle3(pts[i], mid, pts[j]) || circleLSQ(run);
  if (!C) return null;
  // An arc whose radius dwarfs the run is a straight line with rounding noise;
  // emitting it as an arc gives CAD a wildly distant centre point.
  const chord = Math.hypot(pts[j][0] - pts[i][0], pts[j][1] - pts[i][1]);
  if (C.r > chord * 400 + 1e6) return null;
  if (circleError(run, C) > tol) return null;
  const wk = walkAbout(run, C.c);
  if (wk.reversed || wk.maxStep > maxStep) return null;
  // Steps must be *uniform*, not merely small.
  //
  // A flattening lays vertices down at a near-constant angular pitch, so a run
  // that really came from a curve has steps that all look alike. A run that
  // mixes a finely flattened fillet with one long straight edge does not — and
  // a circle can be threaded through those points that stays within tolerance
  // of every vertex while bowing millimetres away from the straight edge
  // between two of them. That is how a straight circuit trace turned into a
  // lens. Distance to the vertices cannot see it; the step profile can.
  if (wk.maxStep > wk.median * 3.2 + 1e-9) return null;
  const sweep = wk.total;
  // Keep well clear of a full turn: at |sweep| → 2π the bulge blows up and
  // the two endpoints coincide, which is a circle, not an arc.
  if (Math.abs(sweep) < 1e-6 || Math.abs(sweep) > Math.PI * 1.9) return null;
  return {
    type: 'arc', a: pts[i], b: pts[j], c: C.c, r: C.r, sweep,
    bulge: Math.tan(sweep / 4),
  };
}

/** Can pts[i..j] be represented by one straight segment within tol? */
function tryLine(pts, i, j, tol) {
  if (lineError(pts.slice(i, j + 1), pts[i], pts[j]) > tol) return null;
  return { type: 'line', a: pts[i], b: pts[j] };
}

/**
 * Longest run starting at i that `test` accepts, by exponential search then
 * bisection. A linear scan re-verifies the whole run at every step, which
 * makes fitting one 3,000-point contour quadratic; this is O(L log L).
 */
function longestRun(pts, i, last, test, minSpan = 2) {
  let good = null, goodJ = -1;
  let step = minSpan;
  let j = i + minSpan;
  while (j <= last) {
    const r = test(i, j);
    if (!r) break;
    good = r; goodJ = j;
    step *= 2;
    j = i + step;
  }
  let lo = goodJ > 0 ? goodJ : i + minSpan - 1;
  let hi = Math.min(last, j);
  while (lo + 1 < hi) {
    const m = (lo + hi) >> 1;
    const r = test(i, m);
    if (r) { good = r; goodJ = m; lo = m; } else hi = m;
  }
  return goodJ > 0 ? { seg: good, j: goodJ } : null;
}

/** Index of the sharpest corner, used as the seam of a closed contour. */
function sharpestVertex(pts) {
  const n = pts.length;
  let best = 0, bestTurn = -1;
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n], b = pts[i], c = pts[(i + 1) % n];
    const v1x = b[0] - a[0], v1y = b[1] - a[1];
    const v2x = c[0] - b[0], v2y = c[1] - b[1];
    const l1 = Math.hypot(v1x, v1y), l2 = Math.hypot(v2x, v2y);
    if (l1 < 1e-12 || l2 < 1e-12) continue;
    const cosT = (v1x * v2x + v1y * v2y) / (l1 * l2);
    const turn = 1 - Math.max(-1, Math.min(1, cosT));
    if (turn > bestTurn) { bestTurn = turn; best = i; }
  }
  return best;
}

/* ------------------------------------------------------------------ *
 * Cubic B-spline interpolation (The NURBS Book, algorithm A9.1)
 * ------------------------------------------------------------------ */

/**
 * Clamped B-spline interpolation through every point — The NURBS Book,
 * algorithm A9.1. Centripetal parameterisation, averaged knot vector, and a
 * banded solve of the collocation matrix N·P = Q.
 *
 * No pivoting: a B-spline collocation matrix built from an averaged knot
 * vector is totally positive, so the diagonal never vanishes. The result is
 * still *verified* against the input before it is used — a silently wrong
 * knot vector produces a curve that looks plausible in the file and cuts the
 * wrong shape, which is worse than not fitting at all.
 */
export function interpolateSpline(Q, tol) {
  const n = Q.length - 1;
  const degree = 3;
  if (n < degree) return null;

  // centripetal parameterisation: steadier than uniform where spacing varies
  const u = new Array(n + 1).fill(0);
  const d = new Array(n + 1).fill(0);
  let total = 0;
  for (let i = 1; i <= n; i++) {
    d[i] = Math.sqrt(Math.hypot(Q[i][0] - Q[i - 1][0], Q[i][1] - Q[i - 1][1]));
    total += d[i];
  }
  if (total < 1e-12) return null;
  for (let i = 1; i <= n; i++) u[i] = u[i - 1] + d[i] / total;
  u[n] = 1;

  // averaged knot vector (A9.1 eq. 9.8) — guarantees the collocation matrix
  // is nonsingular
  const nk = n + degree + 2;
  const knots = new Array(nk).fill(0);
  for (let i = 0; i <= degree; i++) knots[i] = 0;
  for (let i = n + 1; i < nk; i++) knots[i] = 1;
  for (let j = 1; j <= n - degree; j++) {
    let s = 0;
    for (let i = j; i <= j + degree - 1; i++) s += u[i];
    knots[j + degree] = s / degree;
  }

  // banded collocation matrix, at most degree+1 non-zeros per row
  const N = [];
  for (let i = 0; i <= n; i++) N.push(basisRow(knots, degree, n + 1, u[i]));
  const P = solveBanded(N, Q, degree);
  if (!P) return null;

  // Verify at the data points and again between them, so a curve that hits
  // every knot but bulges in the gaps is rejected too.
  for (let i = 0; i <= n; i++) {
    const p = evalBSpline(P, knots, degree, u[i]);
    if (Math.hypot(p[0] - Q[i][0], p[1] - Q[i][1]) > tol) return null;
  }
  for (let i = 0; i < n; i++) {
    const p = evalBSpline(P, knots, degree, (u[i] + u[i + 1]) / 2);
    const seg = Math.hypot(Q[i + 1][0] - Q[i][0], Q[i + 1][1] - Q[i][1]);
    const q = [(Q[i][0] + Q[i + 1][0]) / 2, (Q[i][1] + Q[i + 1][1]) / 2];
    if (Math.hypot(p[0] - q[0], p[1] - q[1]) > tol + seg * 0.5) return null;
  }
  return { type: 'spline', degree, ctrl: P, knots, fit: Q };
}

/** Gaussian elimination exploiting the (degree+1)-wide band of N. */
function solveBanded(N, Q, degree) {
  const m = N.length;
  const A = N.map((r) => r.slice());
  const B = Q.map((q) => [q[0], q[1]]);
  for (let k = 0; k < m; k++) {
    const piv = A[k][k];
    if (Math.abs(piv) < 1e-13) return null;
    const hi = Math.min(m - 1, k + degree);
    for (let i = k + 1; i <= hi; i++) {
      const fct = A[i][k] / piv;
      if (fct === 0) continue;
      const jhi = Math.min(m - 1, k + degree);
      for (let j = k; j <= jhi; j++) A[i][j] -= fct * A[k][j];
      B[i][0] -= fct * B[k][0];
      B[i][1] -= fct * B[k][1];
    }
  }
  const P = new Array(m);
  for (let i = m - 1; i >= 0; i--) {
    let sx = B[i][0], sy = B[i][1];
    const jhi = Math.min(m - 1, i + degree);
    for (let j = i + 1; j <= jhi; j++) { sx -= A[i][j] * P[j][0]; sy -= A[i][j] * P[j][1]; }
    if (Math.abs(A[i][i]) < 1e-13) return null;
    P[i] = [sx / A[i][i], sy / A[i][i]];
  }
  return P;
}

/** Cox-de Boor evaluation of a B-spline at parameter u. */
function evalBSpline(ctrl, knots, degree, u) {
  const n = ctrl.length - 1;
  let span = degree;
  while (span < n && u >= knots[span + 1]) span++;
  const N = new Array(degree + 1).fill(0);
  N[0] = 1;
  const left = new Array(degree + 1).fill(0);
  const right = new Array(degree + 1).fill(0);
  for (let j = 1; j <= degree; j++) {
    left[j] = u - knots[span + 1 - j];
    right[j] = knots[span + j] - u;
    let saved = 0;
    for (let r = 0; r < j; r++) {
      const den = right[r + 1] + left[j - r];
      const temp = Math.abs(den) < 1e-14 ? 0 : N[r] / den;
      N[r] = saved + right[r + 1] * temp;
      saved = left[j - r] * temp;
    }
    N[j] = saved;
  }
  let x = 0, y = 0;
  for (let i = 0; i <= degree; i++) {
    x += N[i] * ctrl[span - degree + i][0];
    y += N[i] * ctrl[span - degree + i][1];
  }
  return [x, y];
}

/** One row of the basis functions at parameter u, over nCtrl control points. */
function basisRow(knots, degree, nCtrl, u) {
  const row = new Array(nCtrl).fill(0);
  let span = degree;
  while (span < nCtrl - 1 && u >= knots[span + 1]) span++;
  const N = new Array(degree + 1).fill(0);
  N[0] = 1;
  const left = new Array(degree + 1).fill(0);
  const right = new Array(degree + 1).fill(0);
  for (let j = 1; j <= degree; j++) {
    left[j] = u - knots[span + 1 - j];
    right[j] = knots[span + j] - u;
    let saved = 0;
    for (let r = 0; r < j; r++) {
      const den = right[r + 1] + left[j - r];
      const temp = Math.abs(den) < 1e-14 ? 0 : N[r] / den;
      N[r] = saved + right[r + 1] * temp;
      saved = left[j - r] * temp;
    }
    N[j] = saved;
  }
  for (let i = 0; i <= degree; i++) row[span - degree + i] = N[i];
  return row;
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

/**
 * @param {Array<[number,number]>} ptsIn  contour vertices
 * @param {boolean} closed
 * @param {{tol?:number, mode?:'off'|'arcs'|'splines'}} opts
 * @returns {{circle?:{c,r}, segs?:Array}}
 */
export function fitPath(ptsIn, closed, opts = {}) {
  const mode = opts.mode || 'arcs';
  const tol = opts.tol ?? 0.02;
  // Largest angular step a run may take and still count as a flattened curve
  // rather than a polygon. 30° keeps squares, hexagons and octagons as the
  // polygons they are, while a 24-sided circle at 15° comes back as a circle.
  const maxStep = ((opts.maxStepDeg ?? 30) * Math.PI) / 180;

  // strip a repeated closing vertex; `closed` already carries that information
  let pts = ptsIn;
  if (pts.length > 2) {
    const a = pts[0], b = pts[pts.length - 1];
    if (Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9) pts = pts.slice(0, -1);
  }
  if (mode === 'off' || pts.length < 4) return { segs: rawSegs(pts, closed) };

  // whole contour a circle? — the common case, and worth one CIRCLE entity
  if (closed && pts.length >= 8) {
    const C = circleLSQ(pts);
    const loop = pts.concat([pts[0]]);
    if (C && circleError(loop, C) <= tol) {
      const wk = walkAbout(loop, C.c);
      if (!wk.reversed && wk.maxStep <= maxStep && Math.abs(Math.abs(wk.total) - TAU) < 1e-6) {
        return { circle: C };
      }
    }
  }

  // Start a closed contour at its sharpest corner so a smooth arc is never
  // split across the seam.
  let work = pts;
  if (closed) {
    const k = sharpestVertex(pts);
    if (k) work = pts.slice(k).concat(pts.slice(0, k));
    work = work.concat([work[0]]);
  }

  const last = work.length - 1;
  const segs = [];
  let i = 0;
  let guard = 0;
  while (i < last && guard++ < work.length * 4) {
    const lineRun = longestRun(work, i, last, (a, b) => tryLine(work, a, b, tol));
    const arcRun = longestRun(work, i, last, (a, b) => tryArc(work, a, b, tol, maxStep), 3);
    // Prefer whichever covers more vertices; on a tie prefer the line, since a
    // straight edge described as a huge-radius arc is worse for CAM.
    let chosen = null;
    if (lineRun && (!arcRun || lineRun.j >= arcRun.j)) chosen = lineRun;
    else if (arcRun) chosen = arcRun;
    if (!chosen) {
      segs.push({ type: 'line', a: work[i], b: work[i + 1], i0: i, i1: i + 1 });
      i += 1;
      continue;
    }
    chosen.seg.i0 = i; chosen.seg.i1 = chosen.j;
    segs.push(chosen.seg);
    i = chosen.j;
  }

  if (closed) mergeSeam(segs, tol);
  if (mode === 'splines') return withSplines(work, segs, tol, closed);
  return { segs };
}

/**
 * Replace long runs of short arcs — the signature of a freeform curve being
 * approximated — with a single interpolating spline. Anything that fitted
 * cleanly as lines or as a few big arcs is left exactly as it is: a real arc
 * is better data than a spline approximating an arc.
 */
function withSplines(work, segs, tol, closed) {
  const MIN_RUN = 6;
  const MAX_CTRL = 120;
  const out = [];
  let i = 0;
  while (i < segs.length) {
    let j = i;
    while (j < segs.length && segs[j].type === 'arc') j++;
    if (j - i >= MIN_RUN) {
      // Fit the spline to the *source vertices* of the run, not to the arc
      // endpoints. Two endpoints of a 90° arc say almost nothing about the
      // curve between them, and a spline through only those wanders far
      // outside tolerance — which is why almost none used to survive the
      // check below.
      const i0 = segs[i].i0, i1 = segs[j - 1].i1;
      const src = work.slice(i0, i1 + 1);
      const stride = Math.max(1, Math.ceil(src.length / MAX_CTRL));
      const Q = [];
      for (let k = 0; k < src.length; k += stride) Q.push(src[k]);
      if (Q[Q.length - 1] !== src[src.length - 1]) Q.push(src[src.length - 1]);
      const sp = Q.length >= 5 ? interpolateSpline(Q, tol) : null;
      // Passing through its own fit points is not the same as staying within
      // tolerance of the geometry it replaces — check that separately.
      if (sp && maxDistToPolyline(src, sampleSpline(sp)) <= tol) {
        sp.fit = Q;
        out.push(sp);
        i = j;
        continue;
      }
    }
    out.push(segs[i]);
    i++;
  }
  void closed;
  return { segs: out };
}

/** Centre and radius of the arc from a to b with the given signed sweep. */
function arcFromChord(a, b, sweep) {
  const chord = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const half = Math.abs(Math.sin(sweep / 2));
  if (chord < 1e-12 || half < 1e-9) return null;
  const r = chord / (2 * half);
  const h = Math.sqrt(Math.max(0, r * r - (chord / 2) ** 2)) * (Math.abs(sweep) > Math.PI ? -1 : 1);
  const ux = (b[0] - a[0]) / chord, uy = (b[1] - a[1]) / chord;
  const sgn = sweep > 0 ? 1 : -1;
  return { c: [(a[0] + b[0]) / 2 - uy * h * sgn, (a[1] + b[1]) / 2 + ux * h * sgn], r };
}

/**
 * Rejoin the first and last primitives of a closed contour when they are two
 * halves of the same thing.
 *
 * The contour is re-rooted at its sharpest vertex so that a smooth arc is not
 * split across the seam — but a stadium, a rounded rectangle, any G1-continuous
 * outline has no sharp vertex at all, and then the seam lands wherever the
 * largest of several equal turns happened to be found. That is mid-arc, and it
 * costs an extra entity and an extra CAM lead-in for nothing.
 */
function mergeSeam(segs, tol) {
  if (segs.length < 2) return;
  const first = segs[0], last = segs[segs.length - 1];
  if (first.type === 'arc' && last.type === 'arc') {
    const dc = Math.hypot(first.c[0] - last.c[0], first.c[1] - last.c[1]);
    const sameWay = first.sweep > 0 === last.sweep > 0;
    if (dc <= tol && Math.abs(first.r - last.r) <= tol && sameWay) {
      const sweep = first.sweep + last.sweep;
      if (Math.abs(sweep) < Math.PI * 1.9) {
        // Rebuild the centre and radius from the merged endpoints and sweep —
        // the same reconstruction a DXF reader performs from the bulge —
        // rather than inheriting one half's circle. Averaging two circles a
        // tolerance apart leaves endpoints off their own stated radius.
        const m = arcFromChord(last.a, first.b, sweep);
        // the old junction must still lie on the merged arc
        if (m && Math.abs(Math.hypot(first.a[0] - m.c[0], first.a[1] - m.c[1]) - m.r) <= tol) {
          segs[0] = {
            type: 'arc', a: last.a, b: first.b, c: m.c, r: m.r,
            sweep, bulge: Math.tan(sweep / 4), i0: last.i0, i1: first.i1,
          };
          segs.pop();
        }
      }
    }
    return;
  }
  if (first.type === 'line' && last.type === 'line') {
    if (lineError([first.a], last.a, first.b) <= tol) {
      segs[0] = { type: 'line', a: last.a, b: first.b, i0: last.i0, i1: first.i1 };
      segs.pop();
    }
  }
}

/** Dense polyline for a fitted spline, at a chord tolerance of `tol`. */
export function sampleSpline(sp, steps) {
  const n = steps || Math.max(32, (sp.ctrl.length - 1) * 12);
  const out = [];
  for (let i = 0; i <= n; i++) {
    out.push(evalBSpline(sp.ctrl, sp.knots, sp.degree, i / n));
  }
  return out;
}

/** Largest distance from each of `pts` to the polyline `poly`. */
function maxDistToPolyline(pts, poly) {
  let worst = 0;
  for (const p of pts) {
    let best = Infinity;
    for (let i = 1; i < poly.length; i++) {
      const a = poly[i - 1], b = poly[i];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const L2 = dx * dx + dy * dy;
      let d;
      if (L2 < 1e-18) d = Math.hypot(p[0] - a[0], p[1] - a[1]);
      else {
        let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        d = Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t));
      }
      if (d < best) best = d;
      if (best === 0) break;
    }
    if (best > worst) worst = best;
  }
  return worst;
}

/** Untouched polyline, as line segments. */
function rawSegs(pts, closed) {
  const segs = [];
  for (let i = 1; i < pts.length; i++) segs.push({ type: 'line', a: pts[i - 1], b: pts[i] });
  if (closed && pts.length > 2) segs.push({ type: 'line', a: pts[pts.length - 1], b: pts[0] });
  return segs;
}

/** Summary counts, for the export panel. */
export function fitStats(paths, opts) {
  let lines = 0, arcs = 0, circles = 0, splines = 0, before = 0;
  for (const p of paths) {
    before += p.pts.length;
    const r = fitPath(p.pts, p.closed, opts);
    if (r.circle) { circles++; continue; }
    for (const s of r.segs) {
      if (s.type === 'arc') arcs++;
      else if (s.type === 'spline') splines++;
      else lines++;
    }
  }
  return { lines, arcs, circles, splines, before, after: lines + arcs + circles + splines };
}
