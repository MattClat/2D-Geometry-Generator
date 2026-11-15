/* =========================================================================
 * common.js — shared primitives used by several pattern engines
 * =======================================================================*/
import {
  add, sub, mul, dist, lerp, norm, len, cross, TAU, EPS, resample,
} from '../geom.js';

/**
 * Parameter descriptor helpers (drive the auto-generated control panel).
 * The trailing `extra` object can carry `when(params) => boolean`, which
 * hides a control that cannot affect the current settings — an engine with
 * several modes should never show sliders that do nothing.
 */
export const R = (key, label, min, max, def, step = 0.01, unit = '', extra) =>
  ({ key, label, type: 'range', min, max, def, step, unit, ...extra });
export const I = (key, label, min, max, def, unit = '', extra) =>
  ({ key, label, type: 'range', min, max, def, step: 1, int: true, unit, ...extra });
export const T = (key, label, def, extra) => ({ key, label, type: 'toggle', def, ...extra });
export const S = (key, label, options, def, extra) => ({ key, label, type: 'select', options, def, ...extra });

/** Infinite-line intersection. Returns [t, u] parameters or null when parallel. */
export function lineIsect(p, r, q, s) {
  const rxs = cross(r, s);
  if (Math.abs(rxs) < 1e-12) return null;
  const qp = sub(q, p);
  return [cross(qp, s) / rxs, cross(qp, r) / rxs];
}

/**
 * Remove arc-length intervals from an open polyline, returning the surviving
 * runs. This is how over/under weave crossings and stencil bridges are made:
 * the strand that goes *under* simply stops short of the crossing.
 */
/**
 * Arc-length intervals of `pts` that lie inside the annular strap of the
 * circle (cx, cy, r) with half-width `halfWidth`.
 *
 * Endpoints are interpolated to where the boundary is actually crossed, not
 * snapped to whichever vertex happened to be nearest. Snapping quantises every
 * cut to one flattening segment — a couple of millimetres — which is coarse
 * enough that a gap slider can be dragged through most of its range without
 * any vertex changing sides, so the control appears to do nothing at all.
 */
export function strapIntervals(pts, cx, cy, r, halfWidth) {
  const dev = (p) => Math.abs(Math.hypot(p[0] - cx, p[1] - cy) - r) - halfWidth;
  const out = [];
  let s = 0, start = null;
  let prev = dev(pts[0]);
  if (prev <= 0) start = 0;
  for (let i = 1; i < pts.length; i++) {
    const seg = dist(pts[i - 1], pts[i]);
    const cur = dev(pts[i]);
    if ((cur <= 0) !== (prev <= 0) && seg > 0) {
      // linear crossing of the strap boundary within this segment
      const t = prev / (prev - cur);
      const at = s + seg * Math.max(0, Math.min(1, t));
      if (cur <= 0) start = at;
      else { out.push([start === null ? 0 : start, at]); start = null; }
    }
    s += seg;
    prev = cur;
  }
  if (start !== null) out.push([start, s]);
  return out;
}

export function cutCenterline(pts, intervals) {
  if (!intervals.length) return [pts];
  // cumulative arc length
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
  const total = cum[cum.length - 1];
  const iv = intervals
    .map(([a, b]) => [Math.max(0, Math.min(a, b)), Math.min(total, Math.max(a, b))])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  // merge overlaps
  const merged = [];
  for (const seg of iv) {
    if (merged.length && seg[0] <= merged[merged.length - 1][1] + 1e-9) {
      merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], seg[1]);
    } else merged.push(seg.slice());
  }
  const at = (s) => {
    if (s <= 0) return pts[0];
    if (s >= total) return pts[pts.length - 1];
    let lo = 0, hi = cum.length - 1;
    while (lo < hi - 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid; }
    const seg = cum[hi] - cum[lo] || 1;
    return lerp(pts[lo], pts[hi], (s - cum[lo]) / seg);
  };
  const runs = [];
  let cursor = 0;
  for (const [a, b] of merged) {
    if (a > cursor + 1e-6) runs.push([cursor, a]);
    cursor = b;
  }
  if (cursor < total - 1e-6) runs.push([cursor, total]);

  return runs.map(([a, b]) => {
    const out = [at(a)];
    for (let i = 0; i < pts.length; i++) {
      if (cum[i] > a + 1e-9 && cum[i] < b - 1e-9) out.push(pts[i]);
    }
    out.push(at(b));
    return out;
  }).filter((r) => r.length > 1 && len(sub(r[r.length - 1], r[0])) > 1e-6);
}

/** Arc-length position of point index along a polyline. */
export function arcLengths(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
  return cum;
}

/** Arc-length of the point on `pts` closest to `q`. */
export function arcLengthAt(pts, q) {
  const cum = arcLengths(pts);
  let best = Infinity, bestS = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const ab = sub(b, a), L2 = ab[0] * ab[0] + ab[1] * ab[1] || 1;
    let t = ((q[0] - a[0]) * ab[0] + (q[1] - a[1]) * ab[1]) / L2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const p = lerp(a, b, t);
    const d = dist(p, q);
    if (d < best) { best = d; bestS = cum[i - 1] + t * Math.sqrt(L2); }
  }
  return { s: bestS, d: best };
}

/** Rectangular lattice of cell centres covering [-w/2,w/2] x [-h/2,h/2]. */
export function gridCells(w, h, cell, pad = 1) {
  const nx = Math.ceil(w / cell) + pad * 2;
  const ny = Math.ceil(h / cell) + pad * 2;
  const out = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      out.push({
        i, j,
        x: (i - nx / 2 + 0.5) * cell,
        y: (j - ny / 2 + 0.5) * cell,
      });
    }
  }
  return out;
}

/** Triangular (hex) lattice points — the substrate for Kagome + hex tiling. */
export function triLattice(w, h, pitch, pad = 2) {
  const dy = pitch * Math.sqrt(3) / 2;
  const nx = Math.ceil(w / pitch) + pad * 2;
  const ny = Math.ceil(h / dy) + pad * 2;
  const out = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const off = (j % 2) * pitch / 2;
      out.push({ i, j, x: (i - nx / 2) * pitch + off, y: (j - ny / 2) * dy });
    }
  }
  return out;
}

/** Poisson-ish blue-noise sampler with a hard minimum radius (collision-free scatter). */
export function poissonDisk(w, h, minDist, rng, tries = 26) {
  const cell = minDist / Math.SQRT2;
  const gw = Math.ceil(w / cell), gh = Math.ceil(h / cell);
  const grid = new Int32Array(gw * gh).fill(-1);
  const pts = [];
  const active = [];
  const idx = (x, y) => Math.floor((x + w / 2) / cell) + Math.floor((y + h / 2) / cell) * gw;
  const fits = (p) => {
    const gx = Math.floor((p[0] + w / 2) / cell), gy = Math.floor((p[1] + h / 2) / cell);
    if (gx < 0 || gy < 0 || gx >= gw || gy >= gh) return false;
    for (let y = Math.max(0, gy - 2); y <= Math.min(gh - 1, gy + 2); y++) {
      for (let x = Math.max(0, gx - 2); x <= Math.min(gw - 1, gx + 2); x++) {
        const k = grid[x + y * gw];
        if (k >= 0 && dist(pts[k], p) < minDist) return false;
      }
    }
    return true;
  };
  const seed = [rng.float(-w / 2, w / 2), rng.float(-h / 2, h / 2)];
  pts.push(seed); grid[idx(seed[0], seed[1])] = 0; active.push(0);
  while (active.length && pts.length < 4000) {
    const ai = Math.floor(rng() * active.length);
    const p = pts[active[ai]];
    let placed = false;
    for (let t = 0; t < tries; t++) {
      const ang = rng() * TAU;
      const rad = minDist * (1 + rng());
      const q = [p[0] + Math.cos(ang) * rad, p[1] + Math.sin(ang) * rad];
      if (q[0] < -w / 2 || q[0] > w / 2 || q[1] < -h / 2 || q[1] > h / 2) continue;
      if (!fits(q)) continue;
      pts.push(q); grid[idx(q[0], q[1])] = pts.length - 1; active.push(pts.length - 1);
      placed = true; break;
    }
    if (!placed) active.splice(ai, 1);
  }
  return pts;
}

/**
 * Spatial-hash crossing finder. Given polylines tagged with a family id,
 * returns every intersection between polylines of *different* families in
 * roughly linear time. Used by the Celtic plait and any weave that needs
 * automatic over/under gap placement.
 */
export function findCrossings(strands, cellSize) {
  const buckets = new Map();
  const key = (cx, cy) => cx + ',' + cy;
  const segs = [];
  strands.forEach((st, si) => {
    for (let i = 1; i < st.pts.length; i++) {
      const a = st.pts[i - 1], b = st.pts[i];
      const id = segs.length;
      segs.push({ si, a, b });
      const x0 = Math.floor(Math.min(a[0], b[0]) / cellSize);
      const x1 = Math.floor(Math.max(a[0], b[0]) / cellSize);
      const y0 = Math.floor(Math.min(a[1], b[1]) / cellSize);
      const y1 = Math.floor(Math.max(a[1], b[1]) / cellSize);
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const k = key(x, y);
          let arr = buckets.get(k);
          if (!arr) { arr = []; buckets.set(k, arr); }
          arr.push(id);
        }
      }
    }
  });
  const hits = [];
  const seen = new Set();
  for (const arr of buckets.values()) {
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const s1 = segs[arr[i]], s2 = segs[arr[j]];
        if (strands[s1.si].fam === strands[s2.si].fam) continue;
        const pk = arr[i] < arr[j] ? arr[i] * 1e7 + arr[j] : arr[j] * 1e7 + arr[i];
        if (seen.has(pk)) continue;
        seen.add(pk);
        const r = sub(s1.b, s1.a), s = sub(s2.b, s2.a);
        const res = lineIsect(s1.a, r, s2.a, s);
        if (!res) continue;
        const [t, u] = res;
        if (t < 0 || t > 1 || u < 0 || u > 1) continue;
        hits.push({ a: s1.si, b: s2.si, p: [s1.a[0] + r[0] * t, s1.a[1] + r[1] * t] });
      }
    }
  }
  return hits;
}

/** Smooth closed loop through control points (used by organic engines). */
export function smoothClosed(pts, iterations = 2) {
  let cur = pts;
  for (let it = 0; it < iterations; it++) {
    const n = cur.length;
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      const a = cur[(i - 1 + n) % n], b = cur[i], c = cur[(i + 1) % n];
      out[i] = [(a[0] + 2 * b[0] + c[0]) / 4, (a[1] + 2 * b[1] + c[1]) / 4];
    }
    cur = out;
  }
  return cur;
}

/** Chaikin corner-cutting for open polylines. */
export function chaikin(pts, iterations = 2, closed = false) {
  let cur = pts;
  for (let it = 0; it < iterations; it++) {
    const out = closed ? [] : [cur[0]];
    const n = cur.length;
    const last = closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const a = cur[i], b = cur[(i + 1) % n];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    if (!closed) out.push(cur[n - 1]);
    cur = out;
  }
  return cur;
}
