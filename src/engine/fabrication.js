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
      // Rectangle with a half-ellipse crown, fitted to W x H. The crown's
      // vertical radius is capped by the height so a wide, short arch still
      // fits its box instead of overflowing the top edge.
      const ry = Math.min(hw, H);
      const base = hh - ry;
      const pts = [[-hw, -hh], [hw, -hh]];
      const n = FRAME_SEGS / 2;
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI;
        pts.push([hw * Math.cos(a), base + ry * Math.sin(a)]);
      }
      return closedDedupe(pts);
    }
    case 'shield': {
      // Straight-sided top third, then a half-ellipse sweeping down to the
      // bottom edge. Built without repeating the first vertex — a duplicated
      // closing point is a zero-length edge, which the inset offsetter turns
      // into a spike that swallowed the entire pattern.
      const top = hh * 0.35;
      const ry = top + hh;
      const pts = [[hw, hh], [-hw, hh]];
      const n = FRAME_SEGS / 2;
      for (let i = 0; i <= n; i++) {
        const a = Math.PI + (i / n) * Math.PI;   // pi -> 2pi: left, bottom, right
        pts.push([hw * Math.cos(a), top + ry * Math.sin(a)]);
      }
      return closedDedupe(pts);
    }
    case 'rect':
    default: return rectPts(-hw, -hh, W, H);
  }
}

/** Drop consecutive duplicate vertices, including a repeated closing vertex. */
function closedDedupe(pts, eps = 1e-9) {
  const out = dedupe(pts, eps);
  while (out.length > 3 && dist(out[0], out[out.length - 1]) < eps) out.pop();
  return out;
}

/**
 * Build the frame geometry (outer + inner loop) plus mounting features.
 * Returns { paths, inner } where `inner` is the clip boundary for the pattern.
 */
export function buildFrame(F, W, H) {
  const warnings = [];
  if (!F.shape || F.shape === 'none') return { paths: [], inner: null, warnings };
  const outer = frameOutline(F.shape, W, H, F.radius);
  const bandW = Math.max(0.2, F.band);
  const inner = shrinkConvex(outer, bandW);
  const paths = [
    region(outer, { layer: 'frame', tag: 'frame-outer' }),
  ];
  if (inner) paths.push(region(inner, { layer: 'frame', tag: 'frame-inner' }));
  else warnings.push('Frame band is wider than the frame itself — the frame is drawn as a solid plate. Reduce the band width.');

  // Mounting features live inside the band. A hole wider than the band would
  // break through into the pattern (or past the outer edge), so clamp it and
  // say so.
  const maxFeature = bandW * 0.8;

  // hanger keyhole at top centre, sized to sit inside the band
  let hangerAt = null, hangerR = 0;
  if (F.hanger) {
    const topY = Math.max(...outer.map((p) => p[1]));
    const R = Math.min(Math.max(1, (F.holeDia || 5) / 2), bandW * 0.3);
    if (R < 0.5) {
      warnings.push('Hanger skipped — the frame band is too narrow to hold a keyhole.');
    } else {
      const r = R * 0.55, L = R * 1.2;
      const mid = topY - bandW / 2;
      const cy0 = mid - (L + r - R) / 2;          // big (entry) circle
      const cy1 = cy0 + L;                          // slot top
      const a = Math.acos(r / R);
      const pts = [];
      const nBig = 40, nSmall = 20;
      for (let i = 0; i <= nBig; i++) {
        const t = (Math.PI - a) + (i / nBig) * (Math.PI + 2 * a);
        pts.push([R * Math.cos(t), cy0 + R * Math.sin(t)]);
      }
      for (let i = 0; i <= nSmall; i++) {
        const t = (i / nSmall) * Math.PI;
        pts.push([r * Math.cos(t), cy1 + r * Math.sin(t)]);
      }
      paths.push(region(closedDedupe(pts), { layer: 'frame', tag: 'hanger' }));
      hangerAt = [0, (cy0 + cy1) / 2];
      hangerR = (L + R + r) / 2;
    }
  }

  // mounting holes, evenly spaced along the band's centreline
  if (F.holes > 0 && F.holeDia > 0) {
    let dia = F.holeDia;
    if (dia > maxFeature) {
      dia = maxFeature;
      warnings.push(`Mounting holes reduced to ${dia.toFixed(1)} mm so they stay inside the ${bandW.toFixed(1)} mm frame band.`);
    }
    const n = Math.max(1, F.holes | 0);
    const ring = shrinkConvex(outer, bandW / 2);
    if (ring && ring.length > 2 && dia >= 0.2) {
      const total = polylineLength(ring, true);
      const cum = [0];
      for (let i = 1; i <= ring.length; i++) cum.push(cum[i - 1] + dist(ring[i - 1], ring[i % ring.length]));
      let skipped = 0;
      for (let k = 0; k < n; k++) {
        const s = ((k + 0.5) / n) * total;
        let idx = 1;
        while (idx < cum.length - 1 && cum[idx] < s) idx++;
        const t = (s - cum[idx - 1]) / ((cum[idx] - cum[idx - 1]) || 1);
        const p = lerp(ring[idx - 1], ring[idx % ring.length], t);
        if (hangerAt && dist(p, hangerAt) < hangerR + dia / 2 + 1) { skipped++; continue; }
        paths.push(region(circlePts(p[0], p[1], dia / 2), { layer: 'frame', tag: 'mount-hole' }));
      }
      if (skipped) warnings.push(`${skipped} mounting hole${skipped === 1 ? '' : 's'} skipped where ${skipped === 1 ? 'it' : 'they'} would overlap the hanger.`);
    }
  }
  return { paths, inner, warnings };
}

/**
 * Inset a convex polygon by `d` (used for the frame band): the intersection
 * of every edge's half-plane moved `d` inward. Unlike a vertex-offset this
 * cannot fold over itself near a corner, and it comes back empty — null —
 * when the band is wider than the shape, rather than a reflected polygon.
 */
function shrinkConvex(poly, d) {
  const src = polygonArea(poly) > 0 ? poly : poly.slice().reverse();
  const n = src.length;
  let out = src.map((p) => [p[0], p[1]]);
  for (let i = 0; i < n && out.length >= 3; i++) {
    const a = src[i], b = src[(i + 1) % n];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const L = Math.hypot(ex, ey);
    if (L < 1e-12) continue;
    // inward normal of a CCW edge is its left-hand perpendicular
    const nx = -ey / L, ny = ex / L;
    const c = nx * a[0] + ny * a[1] + d;          // keep points with n.p >= c
    const next = [];
    for (let k = 0; k < out.length; k++) {
      const p = out[k], q = out[(k + 1) % out.length];
      const sp = nx * p[0] + ny * p[1] - c, sq = nx * q[0] + ny * q[1] - c;
      if (sp >= 0) next.push(p);
      if ((sp >= 0) !== (sq >= 0)) {
        const t = sp / (sp - sq);
        next.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    }
    out = next;
  }
  out = closedDedupe(out, 1e-9);
  if (out.length < 3 || polygonArea(out) < 1e-6) return null;
  return out;
}


/* ------------------------------------------------------------------ *
 * Centreline -> ribbon conversion + kerf compensation
 * ------------------------------------------------------------------ */
export function kerfCompensate(loops, kerf) {
  if (Math.abs(kerf) < 1e-4) return loops;
  // Approximate path for contours that may still overlap (trim switched off):
  // nesting depth decides which side is material, which is only reliable when
  // contours do not cross. The trimmed path uses kerfOffsetClean instead.
  const tree = depthMap(loops);
  const out = [];
  loops.forEach((L, i) => {
    const ccw = tree[i] % 2 === 0;
    const src = (polygonArea(L.pts) > 0) === ccw ? L.pts : L.pts.slice().reverse();
    const off = offsetContour(src, kerf);
    if (off) out.push({ ...L, pts: off });
  });
  return out;
}

/**
 * Kerf compensation for clean, non-overlapping contours wound material-on-
 * the-left (outers CCW, holes CW) — exactly what the boolean trim produces.
 * Every contour moves half a kerf away from the material, so solids grow and
 * holes shrink; contours that collapse entirely are dropped (a hole narrower
 * than the beam closes up, a sliver thinner than it burns away).
 */
export function kerfOffsetClean(loops, kerf) {
  if (Math.abs(kerf) < 1e-4) return loops;
  const out = [];
  for (const L of loops) {
    const off = offsetContour(L.pts, kerf);
    if (off) out.push({ ...L, pts: off });
  }
  return out;
}

function offsetContour(src, kerf) {
  const a0 = polygonArea(src);
  const off = offsetPolyline(src, -kerf / 2, true);
  if (!off || off.length < 3) return null;
  const a1 = polygonArea(off);
  // a sign flip, or a contour that should have shrunk but grew, is a collapse
  if (Math.sign(a1) !== Math.sign(a0) || Math.abs(a1) < 1e-4) return null;
  const grows = kerf > 0 === a0 > 0;
  if (!grows && Math.abs(a1) > Math.abs(a0)) return null;
  return off;
}

/**
 * Exact body count for clean (trimmed) contours. Each even-depth contour is
 * the outline of one physical piece; the largest is the part, every other
 * one is fallout. No rasterising, so thin rings and annuli are never missed.
 */
export function analyseBodies(loops) {
  const depth = depthMap(loops);
  let mainIdx = -1, mainArea = -1;
  const bodies = [];
  loops.forEach((L, i) => {
    if (depth[i] % 2 !== 0) return;
    bodies.push(i);
    const a = Math.abs(polygonArea(L.pts));
    if (a > mainArea) { mainArea = a; mainIdx = i; }
  });
  const floating = new Set(bodies.filter((i) => i !== mainIdx));
  const compOfLoop = new Array(loops.length).fill(-1);
  bodies.forEach((i, k) => { compOfLoop[i] = k; });
  return {
    floating, compOfLoop, components: bodies.length,
    mainId: mainIdx >= 0 ? compOfLoop[mainIdx] : -1,
    sizes: bodies.map((i) => Math.abs(polygonArea(loops[i].pts))),
    mask: null, meta: null, depth, exact: true,
  };
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
    // Probe for a filled cell that lies inside this contour. The centroid is
    // not enough: for a ring it sits in the hole, which reads as empty and
    // let every annulus-shaped island go unreported.
    const id = probeLabel(L.pts, label, mask, nx, ny, ox, oy, sx, sy);
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

function probeLabel(pts, label, mask, nx, ny, ox, oy, sx, sy) {
  const at = (p) => {
    const gx = Math.floor((p[0] - ox) / sx);
    const gy = Math.floor((p[1] - oy) / sy);
    if (gx < 0 || gy < 0 || gx >= nx || gy >= ny) return -1;
    const k = gx + gy * nx;
    return mask[k] ? label[k] : -1;
  };
  const c = interiorPoint(pts);
  let id = at(c);
  if (id >= 0) return id;
  const n = pts.length;
  const stride = Math.max(1, Math.floor(n / 96));
  const step = Math.max(sx, sy) * 0.75;
  for (let i = 0; i < n; i += stride) {
    const a = pts[i], b = pts[(i + 1) % n];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L = Math.hypot(dx, dy);
    if (L < 1e-12) continue;
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    for (const sgn of [1, -1]) {
      const q = [m[0] - (dy / L) * step * sgn, m[1] + (dx / L) * step * sgn];
      if (!pointInPolygon(q, pts)) continue;
      id = at(q);
      if (id >= 0) return id;
    }
  }
  return -1;
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
  const hw = w / 2;

  const areaA = Math.abs(polygonArea(a));
  const areaB = Math.abs(polygonArea(b));
  const target = mode === 'hole' ? areaA - areaB : areaA + areaB;

  // The host keeps its own winding — it decides whether the merged loop adds
  // material or cuts it. The guest is oriented to match: the same way round
  // for a union of two solids, the opposite way for an island inside a hole.
  // Trying all four combinations and keeping the best |area| match let the
  // "both reversed" variant win, which flipped the host and turned a frame
  // into a hole the size of the part.
  const sgnA = Math.sign(polygonArea(a)) || 1;
  const sgnB = Math.sign(polygonArea(b)) || 1;
  const wantB = mode === 'hole' ? -sgnA : sgnA;
  const B2 = sgnB === wantB ? b : b.slice().reverse();
  const sA2 = nearestArc(a, a[bi]);
  const sB2 = nearestArc(B2, b[bj]);
  // Both rings are walked the *long* way round, skipping a 2×hw window at
  // the tie point. The two gaps between the slice ends form the bridge.
  const segA = arcSlice(a, sA2 + hw, sA2 - hw);
  const segB = arcSlice(B2, sB2 + hw, sB2 - hw);
  if (segA.length < 2 || segB.length < 2) return null;
  const loop = dedupe(segA.concat(segB), 1e-6);
  if (loop.length < 6) return null;
  const signed = polygonArea(loop);
  if (Math.sign(signed) !== sgnA) return null;
  const err = Math.abs(Math.abs(signed) - target) / (target || 1);
  if (err > 0.08) return null;
  return loop;
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
  // immediate enclosing loop, computed on demand (smallest container one
  // level up). Bridged hosts keep their outline, so this stays valid.
  const parentMemo = new Map();
  const parentOf = (i) => {
    if (parentMemo.has(i)) return parentMemo.get(i);
    let par = -1, parA = Infinity;
    if (depth[i] > 0) {
      const p = interiorPoint(loops[i].pts);
      for (let k = 0; k < loops.length; k++) {
        if (depth[k] !== depth[i] - 1) continue;
        const b = bbox[k];
        if (p[0] < b[0] || p[0] > b[2] || p[1] < b[1] || p[1] > b[3]) continue;
        const a = Math.abs(polygonArea(loops[k].pts));
        if (a < parA && pointInPolygon(p, loops[k].pts)) { parA = a; par = k; }
      }
    }
    parentMemo.set(i, par);
    return par;
  };
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
      // Only two partners are topologically valid: the void wall directly
      // around the island, or a solid sharing that same void. Anything else
      // means the bridge crosses another contour — a union with the frame's
      // outer edge from inside the frame's hole flipped the whole part.
      const isEnclosing = depth[k] === depth[idx] - 1 && parentOf(idx) === k;
      const isSolid = depth[k] === depth[idx] && parentOf(k) === parentOf(idx);
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
  // A web is a strip of material whose two edges face each other closer than
  // `minWeb`. Two samples count only if the chord between them crosses
  // material and runs roughly square to both edges — otherwise every concave
  // corner where two ribbons meet would be flagged as a "neck".
  const bad = [];
  const m2 = minWeb * minWeb;
  for (let i = 0; i < loops.length; i++) {
    const src = loops[i].pts;
    const ccw = polygonArea(src) > 0;
    const pts = resample(src, sampleStep, true);
    const n = pts.length;
    if (n < 4) continue;
    const tan = pts.map((p, k) => norm(sub(pts[(k + 1) % n], pts[(k - 1 + n) % n])));
    const skip = Math.max(3, Math.round(minWeb / sampleStep) + 2);
    let hit = false;
    for (let a = 0; a < n && !hit; a++) {
      for (let b = a + skip; b <= a + n - skip && b < n; b++) {
        const d2 = dist2(pts[a], pts[b]);
        if (d2 >= m2 || d2 < 1e-12) continue;
        const d = Math.sqrt(d2);
        const ux = (pts[b][0] - pts[a][0]) / d, uy = (pts[b][1] - pts[a][1]) / d;
        if (Math.abs(ux * tan[a][0] + uy * tan[a][1]) > 0.35) continue;
        if (Math.abs(ux * tan[b][0] + uy * tan[b][1]) > 0.35) continue;
        const mid = lerp(pts[a], pts[b], 0.5);
        if (pointInPolygon(mid, src) !== ccw) continue;   // gap, not a web
        hit = true; break;
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
  minWeb: 1.0,
  bridgeWidth: 2.5,
  autoBridge: false,
  showIslands: true,
  trim: true,
  sheetW: 600,
  sheetH: 400,
  thickness: 3,
};
