/* =========================================================================
 * sacred.js — E. Sacred geometry
 *
 * Two things live here:
 *
 *   1. A *compositional mandala builder*. A mandala is read as a stack of
 *      concentric bands, each carrying one motif from a vocabulary of
 *      sixteen (petals, star polygons, scallops, interlaced rings, meanders,
 *      spirals, lattices, …). Symmetry order, layer count, radial falloff,
 *      per-layer twist and band variety are all live controls, so every
 *      slider visibly reshapes the figure and the seed browses a genuinely
 *      unbounded space of designs.
 *
 *   2. The classical constructions — Flower and Seed of Life, Metatron's
 *      Cube, Vesica lattices, Sri Yantra, golden spiral, {n/k} star
 *      polygons, Tree of Life, Platonic wireframes, rose curves and the
 *      Rodin torus circuit — each built from its defining rule and each
 *      opened up to the same shared controls, so `fold`, `layers`, `ratio`
 *      and `twist` mean something everywhere rather than in one figure.
 * =======================================================================*/
import {
  add, sub, mul, dist, norm, lerp, rot, clamp, TAU, EPS,
  circlePts, arcPts, regularPolygonPts, starPts, rectPts,
  centerline, region, dedupe,
} from '../geom.js';
import { R, I, T, S } from './common.js';

const PHI = (1 + Math.sqrt(5)) / 2;

/* ------------------------------------------------------------------ *
 * primitives — segment counts are capped so dense mandalas stay light
 * ------------------------------------------------------------------ */
const circ = (cx, cy, r) => circlePts(cx, cy, r, clamp(Math.ceil(r * 1.6), 24, 220));
const arcSeg = (cx, cy, r, a0, a1) =>
  arcPts(cx, cy, r, a0, a1, clamp(Math.ceil(Math.abs(a1 - a0) * r * 0.5), 4, 120));

/** Closed ring as a polyline (first point repeated so it reads as a loop). */
function ringPts(cx, cy, r) {
  const c = circ(cx, cy, r);
  return c.concat([c[0]]);
}

/**
 * Vesica-style petal spanning a radial band: two circular arcs bowing out
 * from the inner radius to the outer one. `bulge` sets how fat it is.
 */
function petal(r0, r1, ang, halfAngle, bulge) {
  const tip = [Math.cos(ang) * r1, Math.sin(ang) * r1];
  const base = [Math.cos(ang) * r0, Math.sin(ang) * r0];
  const span = Math.max(1e-4, halfAngle * bulge);
  const mid = (r0 + r1) / 2;
  const out = [];
  for (const s of [1, -1]) {
    const pts = [];
    const steps = 22;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      // sine profile: zero width at both ends, widest in the middle
      const w = Math.sin(t * Math.PI) * span;
      const rr = r0 + (r1 - r0) * t;
      pts.push([Math.cos(ang + w * s) * rr, Math.sin(ang + w * s) * rr]);
    }
    out.push(s === 1 ? pts : pts.reverse());
  }
  return dedupe(out[0].concat(out[1]).concat([out[0][0]]), 1e-6);
}

/**
 * Largest star skip ≤ `want` whose {n/k} chords stay outside `inner` (given as
 * a fraction of the star's circumradius). The chord of a {n/k} star passes at
 * cos(kπ/n) of the radius, so this is a direct solve, clamped to ≥ 2 so the
 * result is still a star and not a plain polygon.
 */
function fitSkip(n, want, inner) {
  const kMax = Math.floor((Math.acos(clamp(inner, 0, 0.999)) * n) / Math.PI);
  return Math.max(2, Math.min(Math.max(1, want | 0), kMax, Math.floor((n - 1) / 2)));
}

/**
 * Element count for one band. The symmetry order `n` is the answer unless the
 * band's proportions make it plainly wrong, in which case step once to n/2 or
 * 2n. The bias towards n is deliberate: a free fit to whatever count makes
 * cells square ignores `n` almost entirely, and then the symmetry-order slider
 * stops changing the picture — which is the complaint this rewrite exists to
 * answer. `ideal` is the count that would make each cell square.
 */
function fitCount(n, ideal) {
  if (ideal > n * 1.9) return n * 2;
  if (ideal < n * 0.55 && n % 2 === 0 && n / 2 >= 3) return n / 2;
  if (ideal < n * 0.4) return Math.max(3, Math.round(n / 2));
  return n;
}

/**
 * Split a polyline into the runs that lie outside a circle of radius `r`
 * centred on the origin, clipping the crossing segments exactly at the circle.
 * Runs shorter than two points are dropped.
 */
function outsideCircle(pts, r) {
  if (!(r > 0)) return [pts];
  const r2 = r * r;
  const outside = (p) => p[0] * p[0] + p[1] * p[1] >= r2;
  // parameters where segment a→b meets the circle, ascending, within (0,1)
  const hits = (a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const A = dx * dx + dy * dy;
    if (A < 1e-18) return [];
    const B = 2 * (a[0] * dx + a[1] * dy);
    const C = a[0] * a[0] + a[1] * a[1] - r2;
    const disc = B * B - 4 * A * C;
    if (disc <= 0) return [];
    const sq = Math.sqrt(disc);
    return [(-B - sq) / (2 * A), (-B + sq) / (2 * A)].filter((t) => t > 0 && t < 1);
  };
  const at = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const runs = [];
  let cur = outside(pts[0]) ? [pts[0]] : null;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    let last = 0;
    for (const t of hits(a, b)) {
      const p = at(a, b, t);
      if (cur) { cur.push(p); if (cur.length > 1) runs.push(cur); cur = null; }
      else cur = [p];
      last = t;
    }
    void last;
    if (cur) cur.push(b);
    else if (outside(b)) cur = [b];
  }
  if (cur && cur.length > 1) runs.push(cur);
  return runs.filter((run) => run.length > 1);
}

/** Regular {n/k} star polygon as one or more closed circuits. */
function starCircuits(r, n, k, phase) {
  const kk = Math.max(1, Math.min(Math.floor((n - 1) / 2), k));
  const out = [];
  const visited = new Uint8Array(n);
  for (let s = 0; s < n; s++) {
    if (visited[s]) continue;
    const chain = [];
    let cur = s;
    do {
      visited[cur] = 1;
      const a = phase + (cur / n) * TAU;
      chain.push([Math.cos(a) * r, Math.sin(a) * r]);
      cur = (cur + kk) % n;
    } while (cur !== s);
    chain.push(chain[0]);
    if (chain.length > 3) out.push(chain);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Band vocabulary
 *
 * Each entry draws one concentric band. Signature:
 *   (r0, r1, n, phase, P) -> array of polylines
 * ------------------------------------------------------------------ */
const BANDS = {
  rings: (r0, r1) => [ringPts(0, 0, r0), ringPts(0, 0, r1)],

  petals: (r0, r1, n, ph, P) => {
    const half = Math.PI / n;
    const out = [];
    for (let i = 0; i < n; i++) out.push(petal(r0, r1, ph + (i / n) * TAU, half, P.bulge));
    return out;
  },

  circles: (r0, r1, n, ph) => {
    const rm = (r0 + r1) / 2;
    const rad = Math.min((r1 - r0) / 2, (Math.PI * rm) / n) * 0.98;
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = ph + (i / n) * TAU;
      out.push(ringPts(Math.cos(a) * rm, Math.sin(a) * rm, rad));
    }
    return out;
  },

  interlace: (r0, r1, n, ph) => {
    // overlapping circles on the mid-radius — the Flower-of-Life ring
    const rm = (r0 + r1) / 2;
    const rad = Math.min((r1 - r0) / 2 + ((Math.PI * rm) / n) * 0.55, (r1 - r0) * 0.72);
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = ph + (i / n) * TAU;
      out.push(ringPts(Math.cos(a) * rm, Math.sin(a) * rm, rad));
    }
    return out;
  },

  // A {n/k} star's chords dip to r·cos(kπ/n) at their closest approach to the
  // centre. Left unchecked, a star drawn on a band's outer circle slices
  // straight across every band inside it — the single worst offender in the
  // old mandalas. Pick the largest k whose chords stay in the annulus.
  star: (r0, r1, n, ph, P) => starCircuits(r1, n, fitSkip(n, P.skip, r0 / r1), ph),

  starPair: (r0, r1, n, ph, P) => {
    const rm = (r0 + r1) / 2;
    return [
      ...starCircuits(r1, n, fitSkip(n, P.skip, r0 / r1), ph),
      ...starCircuits(rm, n, fitSkip(n, P.skip, r0 / rm), ph + Math.PI / n),
    ];
  },

  polygon: (r0, r1, n, ph) => {
    const p = regularPolygonPts(0, 0, r1, n, ph);
    return [p.concat([p[0]])];
  },

  polyNest: (r0, r1, n, ph) => {
    const a = regularPolygonPts(0, 0, r1, n, ph);
    const b = regularPolygonPts(0, 0, r0, n, ph + Math.PI / n);
    return [a.concat([a[0]]), b.concat([b[0]])];
  },

  rays: (r0, r1, n, ph) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = ph + (i / n) * TAU;
      out.push([[Math.cos(a) * r0, Math.sin(a) * r0], [Math.cos(a) * r1, Math.sin(a) * r1]]);
    }
    return out;
  },

  scallops: (r0, r1, n, ph) => {
    // lotus petals: arcs bowing outward from the inner radius
    const out = [];
    const rad = (Math.PI * r0) / n;
    for (let i = 0; i < n; i++) {
      const a = ph + (i / n) * TAU;
      const cx = Math.cos(a) * r0, cy = Math.sin(a) * r0;
      out.push(arcSeg(cx, cy, Math.min(rad, r1 - r0), a - Math.PI * 0.62, a + Math.PI * 0.62));
    }
    return out;
  },

  scallopsIn: (r0, r1, n, ph) => {
    const out = [];
    const rad = (Math.PI * r1) / n;
    for (let i = 0; i < n; i++) {
      const a = ph + (i / n) * TAU;
      const cx = Math.cos(a) * r1, cy = Math.sin(a) * r1;
      out.push(arcSeg(cx, cy, Math.min(rad, r1 - r0), a + Math.PI * 0.38, a + Math.PI * 1.62));
    }
    return out;
  },

  triangles: (r0, r1, n, ph) => {
    const out = [];
    const half = Math.PI / n;
    for (let i = 0; i < n; i++) {
      const a = ph + (i / n) * TAU;
      out.push([
        [Math.cos(a) * r1, Math.sin(a) * r1],
        [Math.cos(a - half) * r0, Math.sin(a - half) * r0],
        [Math.cos(a + half) * r0, Math.sin(a + half) * r0],
        [Math.cos(a) * r1, Math.sin(a) * r1],
      ]);
    }
    return out;
  },

  lattice: (r0, r1, n, ph) => {
    // chords crossing both ways -> a woven diamond band
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = ph + (i / n) * TAU;
      const b = a + TAU / n;
      out.push([[Math.cos(a) * r0, Math.sin(a) * r0], [Math.cos(b) * r1, Math.sin(b) * r1]]);
      out.push([[Math.cos(b) * r0, Math.sin(b) * r0], [Math.cos(a) * r1, Math.sin(a) * r1]]);
    }
    return out;
  },

  spiral: (r0, r1, n, ph, P) => {
    const out = [];
    const turn = (Math.PI / n) * 2.4 * (1 + P.bulge);
    for (let i = 0; i < n; i++) {
      const a0 = ph + (i / n) * TAU;
      const pts = [];
      for (let s = 0; s <= 24; s++) {
        const t = s / 24;
        const rr = r0 + (r1 - r0) * t;
        const aa = a0 + turn * t;
        pts.push([Math.cos(aa) * rr, Math.sin(aa) * rr]);
      }
      out.push(pts);
    }
    return out;
  },

  chevrons: (r0, r1, n, ph) => {
    const out = [];
    const half = Math.PI / n;
    const rm = (r0 + r1) / 2;
    for (let i = 0; i < n; i++) {
      const a = ph + (i / n) * TAU;
      out.push([
        [Math.cos(a - half) * r0, Math.sin(a - half) * r0],
        [Math.cos(a) * rm, Math.sin(a) * rm],
        [Math.cos(a + half) * r0, Math.sin(a + half) * r0],
      ]);
      out.push([
        [Math.cos(a - half) * rm, Math.sin(a - half) * rm],
        [Math.cos(a) * r1, Math.sin(a) * r1],
        [Math.cos(a + half) * rm, Math.sin(a + half) * rm],
      ]);
    }
    return out;
  },

  dots: (r0, r1, n, ph) => {
    const rm = (r0 + r1) / 2;
    const rad = Math.min((r1 - r0) * 0.3, ((Math.PI * rm) / n) * 0.5);
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = ph + (i / n) * TAU;
      out.push(ringPts(Math.cos(a) * rm, Math.sin(a) * rm, rad));
    }
    return out;
  },

  meander: (r0, r1, n, ph) => {
    // Greek-key band wrapped around the annulus
    const out = [];
    const rm = (r0 + r1) / 2, hw = (r1 - r0) / 2;
    for (let i = 0; i < n; i++) {
      const a = ph + (i / n) * TAU;
      const step = TAU / n;
      const P4 = (t, rr) => [Math.cos(a + step * t) * rr, Math.sin(a + step * t) * rr];
      out.push([
        P4(0, rm - hw), P4(0.75, rm - hw), P4(0.75, rm + hw * 0.35),
        P4(0.25, rm + hw * 0.35), P4(0.25, rm + hw), P4(1, rm + hw),
      ]);
    }
    return out;
  },

  zigzag: (r0, r1, n, ph) => {
    const pts = [];
    for (let i = 0; i <= n * 2; i++) {
      const a = ph + (i / (n * 2)) * TAU;
      const rr = i % 2 ? r1 : r0;
      pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
    }
    pts.push(pts[0]);
    return [pts];
  },
};

const BAND_KEYS = Object.keys(BANDS);

/* ------------------------------------------------------------------ *
 * Core motifs for the middle of a mandala
 * ------------------------------------------------------------------ */
/* The core sits in the smallest area of the whole figure, so it takes the
 * *least* detail, not the most. Driving it straight off `fold` — 12, 18,
 * 24 elements crammed into a 25 mm disc — is what turned the middle of every
 * mandala into a solid dot. `coreN` steps the symmetry order down to
 * something the space can actually hold. */
const coreN = (n) => (n <= 8 ? Math.max(3, n) : n % 2 === 0 ? n / 2 : Math.max(5, Math.round(n / 2)));

const CORES = {
  none: () => [],
  bindu: (r) => [ringPts(0, 0, r * 0.55), ringPts(0, 0, r)],
  seed: (r, n) => {
    // Classical Seed of Life: circles of radius r/2 on a ring of radius r/2,
    // so neighbours meet at each other's centres and the vesicas stay open.
    const k = coreN(n);
    const rr = r / 2;
    const out = [ringPts(0, 0, r), ringPts(0, 0, rr)];
    for (let i = 0; i < k; i++) {
      const a = (i / k) * TAU + Math.PI / 2;
      out.push(ringPts(Math.cos(a) * rr, Math.sin(a) * rr, rr));
    }
    return out;
  },
  hexagram: (r, n) => [
    ...starCircuits(r, Math.max(5, coreN(n)), 2, Math.PI / 2),
    ringPts(0, 0, r),
  ],
  star: (r, n, P) => {
    const k = Math.max(5, coreN(n));
    return [...starCircuits(r, k, fitSkip(k, P.skip, 0), Math.PI / 2), ringPts(0, 0, r)];
  },
  flower: (r, n) => {
    const out = [ringPts(0, 0, r)];
    const k = coreN(n);
    const rr = r / 2;
    for (let i = 0; i < k; i++) {
      const a = (i / k) * TAU + Math.PI / 2;
      out.push(ringPts(Math.cos(a) * rr, Math.sin(a) * rr, rr));
    }
    out.push(ringPts(0, 0, rr));
    return out;
  },
  rosette: (r, n, P) => {
    const out = [ringPts(0, 0, r)];
    const k = Math.max(4, coreN(n));
    for (let i = 0; i < k; i++) out.push(petal(r * 0.18, r * 0.94, (i / k) * TAU + Math.PI / 2, Math.PI / k, P.bulge));
    return out;
  },
};

/** Orthographic wireframe of a Platonic solid. */
function platonicEdges(kind) {
  let V = [];
  if (kind === 'tetra') V = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]];
  else if (kind === 'cube') {
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) V.push([x, y, z]);
  } else if (kind === 'octa') V = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  else if (kind === 'icosa') {
    for (const s1 of [-1, 1]) for (const s2 of [-1, 1]) {
      V.push([0, s1, s2 * PHI], [s1, s2 * PHI, 0], [s2 * PHI, 0, s1]);
    }
  } else {
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) V.push([x, y, z]);
    const ip = 1 / PHI;
    for (const s1 of [-1, 1]) for (const s2 of [-1, 1]) {
      V.push([0, s1 * ip, s2 * PHI], [s1 * ip, s2 * PHI, 0], [s2 * PHI, 0, s1 * ip]);
    }
  }
  const uniq = [];
  for (const v of V) {
    if (!uniq.some((u) => Math.hypot(u[0] - v[0], u[1] - v[1], u[2] - v[2]) < 1e-6)) uniq.push(v);
  }
  let min = Infinity;
  for (let i = 0; i < uniq.length; i++) {
    for (let j = i + 1; j < uniq.length; j++) {
      const d = Math.hypot(uniq[i][0] - uniq[j][0], uniq[i][1] - uniq[j][1], uniq[i][2] - uniq[j][2]);
      if (d < min - 1e-9) min = d;
    }
  }
  const edges = [];
  for (let i = 0; i < uniq.length; i++) {
    for (let j = i + 1; j < uniq.length; j++) {
      const d = Math.hypot(uniq[i][0] - uniq[j][0], uniq[i][1] - uniq[j][1], uniq[i][2] - uniq[j][2]);
      if (Math.abs(d - min) < 1e-6) edges.push([i, j]);
    }
  }
  return { verts: uniq, edges };
}

/**
 * Complete graph on a point set — the construction behind Metatron's Cube.
 * Chords passing through a third centre are skipped: they draw exactly the
 * same ink as the two shorter chords they contain, and emitting all three
 * would stack three identical ribbons on top of each other.
 */
function completeGraph(pts, tol = 1e-6) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const a = pts[i], b = pts[j];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const L2 = dx * dx + dy * dy;
      let split = false;
      for (let k = 0; k < pts.length && !split; k++) {
        if (k === i || k === j) continue;
        const c = pts[k];
        const t = ((c[0] - a[0]) * dx + (c[1] - a[1]) * dy) / L2;
        if (t <= 1e-6 || t >= 1 - 1e-6) continue;
        const px = a[0] + dx * t, py = a[1] + dy * t;
        if (Math.hypot(px - c[0], py - c[1]) < Math.sqrt(L2) * 1e-6 + tol) split = true;
      }
      if (!split) out.push([a, b]);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Parameter visibility — a control that cannot affect the current
 * construction should not be on screen at all.
 * ------------------------------------------------------------------ */
const usesFold = ['mandala', 'seed', 'metatron', 'star', 'rose', 'vesica', 'flower', 'torus'];
const usesLayers = ['mandala', 'flower', 'seed', 'vesica', 'star', 'golden', 'yantra', 'rose', 'torus'];
const usesSkip = ['mandala', 'star', 'torus'];
const usesRatio = ['mandala', 'flower', 'seed', 'vesica', 'star', 'rose', 'tree', 'metatron'];
const usesTwist = ['mandala', 'star', 'rose', 'flower', 'seed', 'metatron', 'vesica'];
const has = (list) => (P) => list.indexOf(P.figure) >= 0;

export const sacred = {
  id: 'sacred',
  category: 'Sacred Geometry',
  name: 'Sacred Geometry',
  blurb: 'A compositional mandala builder plus the classical constructions — Flower and Seed of Life, Metatron\'s Cube, Sri Yantra, golden spiral, star polygons, Tree of Life, Platonic wireframes and rose curves. Every control reshapes whichever figure is active.',
  params: [
    S('figure', 'Construction', [
      { v: 'mandala', label: 'Mandala composer' },
      { v: 'flower', label: 'Flower of Life' },
      { v: 'seed', label: 'Seed of Life' },
      { v: 'metatron', label: "Metatron's Cube" },
      { v: 'vesica', label: 'Vesica lattice' },
      { v: 'yantra', label: 'Sri Yantra' },
      { v: 'golden', label: 'Golden spiral' },
      { v: 'star', label: 'Star polygon {n/k}' },
      { v: 'tree', label: 'Tree of Life' },
      { v: 'platonic', label: 'Platonic wireframe' },
      { v: 'rose', label: 'Rose curve' },
      { v: 'torus', label: 'Times-table circuit' },
    ], 'mandala'),
    R('radius', 'Overall radius', 20, 260, 132, 1, 'mm'),
    R('stroke', 'Line width', 0.3, 12, 2, 0.05, 'mm'),

    I('fold', 'Symmetry order (n)', 3, 36, 12, '', { when: has(usesFold) }),
    I('layers', 'Concentric layers', 1, 12, 6, '', { when: has(usesLayers) }),
    R('ratio', 'Radial falloff', 0.2, 1, 0.5, 0.01, '', { when: has(usesRatio) }),
    R('twist', 'Layer twist', -90, 90, 0, 0.5, '°', { when: has(usesTwist) }),
    I('skip', 'Star skip (k)', 1, 16, 3, '', { when: has(usesSkip) }),
    // A Maurer rose is defined by walking the curve in steps of d degrees, and
    // the interesting values of d are large and coprime-ish with 360 (71, 29,
    // 97). Sharing the star's 1–16 skip slider hid every good rose there is.
    I('dstep', 'Chord step (d°)', 1, 179, 71, '°', { when: has(['rose']) }),

    R('coreSize', 'Core size', 0, 0.6, 0.2, 0.01, '×', { when: has(['mandala']) }),
    S('core', 'Core motif', [
      { v: 'seed', label: 'Seed of Life' },
      { v: 'flower', label: 'Flower' },
      { v: 'hexagram', label: 'Hexagram' },
      { v: 'star', label: 'Star polygon' },
      { v: 'rosette', label: 'Rosette' },
      { v: 'bindu', label: 'Bindu (dot)' },
      { v: 'none', label: 'Empty' },
    ], 'seed', { when: has(['mandala']) }),
    I('variety', 'Band variety', 1, 16, 7, '', { when: has(['mandala']) }),
    R('bulge', 'Petal fullness', 0.15, 1.4, 0.7, 0.01, '', { when: has(['mandala', 'yantra']) }),
    I('spokes', 'Radial spokes', 0, 4, 1, '×n', { when: has(['mandala']) }),

    R('spread', 'Triangle spread', 0.5, 1.4, 1, 0.01, '×', { when: has(['yantra']) }),
    T('bhupura', 'Square gate surround', false, { when: has(['yantra']) }),
    S('solid', 'Platonic solid', [
      { v: 'tetra', label: 'Tetrahedron' },
      { v: 'cube', label: 'Hexahedron' },
      { v: 'octa', label: 'Octahedron' },
      { v: 'dodeca', label: 'Dodecahedron' },
      { v: 'icosa', label: 'Icosahedron' },
    ], 'icosa', { when: has(['platonic']) }),
    R('tilt', 'View tilt', -90, 90, 24, 1, '°', { when: has(['platonic']) }),
    R('spin', 'View spin', -180, 180, 18, 1, '°', { when: has(['platonic']) }),

    T('boundary', 'Boundary rings', true),
    T('detail', 'Secondary detail', true),
  ],

  generate(P, rng, ctx) {
    const out = [];
    const Rr = Math.min(P.radius, Math.min(ctx.w, ctx.h) / 2);
    const W = P.stroke;
    const n = Math.max(3, P.fold | 0);
    const layers = Math.max(1, P.layers | 0);
    const twist = (P.twist * Math.PI) / 180;
    const line = (pts) => { if (pts && pts.length > 1) out.push(centerline(pts, { width: W })); };
    const ring = (cx, cy, r) => { if (r > EPS) line(ringPts(cx, cy, r)); };
    const boundary = () => {
      if (!P.boundary) return;
      ring(0, 0, Rr);
      ring(0, 0, Rr * 0.945);
    };

    /* ---------------- the mandala composer ----------------
     *
     * A mandala reads as a stack of concentric *registers*: a core motif, a
     * few annular bands each with its own character, thin divider rings
     * between them, and a heavy outer border. What makes one look composed
     * rather than scribbled is that every band gets enough radial room for
     * its motif, and that no motif leaks into its neighbours' room. Both of
     * those are enforced here rather than left to chance.
     */
    if (P.figure === 'mandala') {
      const rOuter = Rr * (P.boundary ? 0.9 : 0.985);
      const coreR = Rr * clamp(P.coreSize, 0.04, 0.62);
      const span = rOuter - coreR;

      // Band thicknesses come from normalised weights, not a power law. A
      // power law starves the inner bands until they fuse into a black dot —
      // which is exactly what the previous version did. `ratio` tilts the
      // weights: below 0.5 the inner bands are the wide ones, above it the
      // outer bands are.
      const bandCount = Math.max(1, Math.min(layers, Math.floor(span / (W * 2.6)) || 1));
      const tilt = (P.ratio - 0.5) * 2;               // -1 .. +1
      const wts = [];
      for (let k = 0; k < bandCount; k++) {
        const u = bandCount === 1 ? 0.5 : k / (bandCount - 1);
        wts.push(1 + tilt * (u - 0.5) * 1.3);
      }
      const wsum = wts.reduce((a, b) => a + b, 0);
      const edges = [coreR];
      for (let k = 0; k < bandCount; k++) edges.push(edges[k] + (span * wts[k]) / wsum);

      // Style per band, drawn from a shuffled palette, never twice running:
      // two identical adjacent registers read as one mushy one.
      const palette = rng.shuffle(BAND_KEYS).slice(0, clamp(P.variety | 0, 1, BAND_KEYS.length));
      const styles = [];
      for (let k = 0; k < bandCount; k++) {
        let s = rng.pick(palette);
        for (let tries = 0; tries < 6 && palette.length > 1 && s === styles[k - 1]; tries++) s = rng.pick(palette);
        styles.push(s);
      }

      for (let k = 0; k < bandCount; k++) {
        const r0 = edges[k], r1 = edges[k + 1];
        const thick = r1 - r0;
        if (thick < W * 1.6) continue;
        // Element count from arc length, so motifs come out roughly square:
        // a wide outer band wants more repeats than a narrow inner one, and
        // forcing the same `n` everywhere is what makes the middle clot.
        const rm = (r0 + r1) / 2;
        const ideal = (TAU * rm) / thick;             // count that makes cells square
        const nk = fitCount(n, ideal);
        // Twist is a *stagger*, measured in fractions of the band's own
        // angular cell, not an absolute rotation. An absolute one is invisible:
        // every band is n-fold symmetric, so rotating it by anything near
        // 360/n puts it straight back where it started.
        const phase = Math.PI / 2 + (P.twist / 45) * (Math.PI / nk) * k;
        for (const poly of BANDS[styles[k]](r0, r1, nk, phase, P)) line(poly);
        // divider ring: the register line that makes the stack legible
        if (k > 0) out.push(centerline(ringPts(0, 0, r0), { width: W * 0.75 }));
      }

      // Short radial ticks straddling each divider, rather than lines running
      // the whole radius — full-length spokes cut a crude cross through every
      // band and were the loudest thing in the old output.
      if (P.spokes > 0) {
        const m = n * (P.spokes | 0);
        for (let k = 1; k < bandCount; k++) {
          const r = edges[k];
          const t = Math.min(edges[k] - edges[k - 1], edges[k + 1] - edges[k]) * 0.42;
          for (let i = 0; i < m; i++) {
            const a = (i / m) * TAU + Math.PI / 2 + (P.twist / 45) * (Math.PI / m) * k;
            line([[Math.cos(a) * (r - t), Math.sin(a) * (r - t)],
                  [Math.cos(a) * (r + t), Math.sin(a) * (r + t)]]);
          }
        }
      }

      if (coreR > W) for (const poly of (CORES[P.core] || CORES.seed)(coreR, n, P)) line(poly);
      // Inner edge of the field, then the heavy outer border.
      out.push(centerline(ringPts(0, 0, rOuter), { width: W }));
      // One heavy border, not three: the field edge above plus the frame the
      // fabrication step adds are already two concentric circles, and a third
      // thin one between them just reads as a printing error.
      if (P.boundary) out.push(centerline(ringPts(0, 0, Rr), { width: W * 1.7 }));
      return out;
    }

    /* ---------------- Flower / Seed of Life ---------------- */
    if (P.figure === 'flower' || P.figure === 'seed') {
      // `ratio` slides the circle radius against the lattice spacing: 0.5 is
      // the textbook Flower of Life, above it the circles overlap more, below
      // they open into a lace.
      const isSeed = P.figure === 'seed';
      const rings = isSeed ? 1 : layers;
      const spacing = Rr / (rings + 1);
      const rad = spacing * (P.ratio * 2);
      if (isSeed) {
        // n-fold Seed of Life — six is classical, other orders are lovely
        ring(0, 0, rad);
        for (let i = 0; i < n; i++) {
          const a = twist + (i / n) * TAU;
          ring(Math.cos(a) * spacing, Math.sin(a) * spacing, rad);
        }
      } else {
        for (let q = -rings; q <= rings; q++) {
          for (let r = Math.max(-rings, -q - rings); r <= Math.min(rings, -q + rings); r++) {
            const x = spacing * (q + r / 2), y = spacing * (r * Math.sqrt(3) / 2);
            const p = rot([x, y], twist);
            ring(p[0], p[1], rad);
          }
        }
      }
      if (P.detail) {
        const petals = n * 2;
        for (let i = 0; i < petals; i++) {
          const a = twist + (i / petals) * TAU;
          const rr = Rr * 0.93;
          line(arcSeg(Math.cos(a) * rr, Math.sin(a) * rr, (Math.PI * rr) / petals,
            a + Math.PI * 0.55, a + Math.PI * 1.45));
        }
      }
      boundary();
      return out;
    }

    /* ---------------- Fruit of Life + Metatron's Cube ---------------- */
    if (P.figure === 'metatron') {
      // `layers` = how many concentric rings of circles; `fold` = how many
      // per ring. 2 rings of 6 is the classical Fruit of Life.
      //
      // The centre count has to be capped, because the complete graph over it
      // grows quadratically and 37 centres is 666 chords of solid black. Cap
      // it by dropping whole *rings*, never by truncating the list: chopping
      // mid-ring leaves a lopsided figure with a wedge of missing circles,
      // which is exactly what this used to do.
      const rows = clamp(Math.min(Math.round(layers / 2), Math.floor(18 / n)), 1, 3);
      const rad = (Rr / (rows * 2 + 1.4)) * (P.ratio * 2);
      const step = Rr / (rows + 0.35);
      const centres = [[0, 0]];
      for (let k = 1; k <= rows; k++) {
        for (let i = 0; i < n; i++) {
          const a = twist + (i / n) * TAU;
          centres.push([Math.cos(a) * step * k, Math.sin(a) * step * k]);
        }
      }
      for (const c of centres) ring(c[0], c[1], rad);
      for (const [a, b] of completeGraph(centres)) line([a, b]);
      boundary();
      return out;
    }

    /* ---------------- Vesica lattice ---------------- */
    if (P.figure === 'vesica') {
      const rings = layers;
      const r = (Rr / (rings + 0.5)) * (P.ratio * 2);
      const spacing = Rr / (rings + 0.5);
      const cols = Math.ceil(ctx.w / spacing) + 2;
      const rows = Math.ceil(ctx.h / (spacing * Math.sqrt(3) / 2)) + 2;
      for (let j = -rows; j <= rows; j++) {
        for (let i = -cols; i <= cols; i++) {
          const x = i * spacing + (j % 2 ? spacing / 2 : 0);
          const y = j * spacing * Math.sqrt(3) / 2;
          if (Math.hypot(x, y) > Rr + r) continue;
          const p = rot([x, y], twist);
          ring(p[0], p[1], r);
        }
      }
      boundary();
      return out;
    }

    /* ---------------- Sri Yantra ---------------- */
    if (P.figure === 'yantra') {
      const k = P.spread;
      const core = Rr * 0.62;
      const chord = (y) => Math.sqrt(Math.max(0, core * core - y * y)) * 0.985;
      // `layers` scales the classical nine triangles up or down in count
      const pairs = clamp(layers, 2, 9);
      const nUp = Math.max(1, Math.round(pairs * 4 / 9));
      const nDown = Math.max(1, pairs - nUp + 1);
      for (let i = 0; i < nUp; i++) {
        const t = nUp === 1 ? 0.5 : i / (nUp - 1);
        const ay = (0.94 - t * 0.74) * k * core;
        const by = (-0.34 - t * 0.54) * k * core;
        const hw = chord(by);
        line([[0, ay], [hw, by], [-hw, by], [0, ay]]);
      }
      for (let i = 0; i < nDown; i++) {
        const t = nDown === 1 ? 0.5 : i / (nDown - 1);
        const ay = (-0.94 + t * 0.9) * k * core;
        const by = (0.30 + t * 0.62) * k * core;
        const hw = chord(by);
        line([[0, ay], [hw, by], [-hw, by], [0, ay]]);
      }
      out.push(region(circ(0, 0, Math.max(W, core * 0.035)), { layer: 'cut' }));
      if (P.detail) {
        for (const [count, rad, size] of [[n, 0.78, 0.15], [n * 2, 0.9, 0.1]]) {
          for (let i = 0; i < count; i++) {
            const a = (i / count) * TAU;
            line(arcSeg(Math.cos(a) * Rr * rad, Math.sin(a) * Rr * rad, Rr * size,
              a + Math.PI * 0.55, a + Math.PI * 1.45));
          }
        }
      }
      boundary();
      if (P.bhupura) {
        for (let i = 0; i < 3; i++) {
          const s = Rr * (1.02 + i * 0.06);
          const g = s * 0.22;
          line([
            [-s, -s + g], [-s, -s], [-s + g, -s], [-s + g, -s - g * 0.5], [s - g, -s - g * 0.5],
            [s - g, -s], [s, -s], [s, -s + g], [s + g * 0.5, -s + g], [s + g * 0.5, s - g],
            [s, s - g], [s, s], [s - g, s], [s - g, s + g * 0.5], [-s + g, s + g * 0.5],
            [-s + g, s], [-s, s], [-s, s - g], [-s - g * 0.5, s - g], [-s - g * 0.5, -s + g],
            [-s, -s + g],
          ]);
        }
      }
      return out;
    }

    /* ---------------- Golden spiral ---------------- */
    if (P.figure === 'golden') {
      const steps = clamp(layers + 4, 4, 16);
      let a2 = 1, b2 = 1;
      const placed = [[0, 0, 1, 1]];
      let bx = 0, by = 0, bw = 1, bh = 1;
      for (let i = 1; i < steps; i++) {
        if (i > 1) { const t = a2; a2 = b2; b2 = t + b2; }
        const sz = i === 1 ? 1 : b2;
        const d = i % 4;
        let nr;
        if (d === 1) nr = [bx + bw, by, sz, sz];
        else if (d === 2) nr = [bx, by + bh, sz, sz];
        else if (d === 3) nr = [bx - sz, by + bh - sz, sz, sz];
        else nr = [bx + bw - sz, by - sz, sz, sz];
        placed.push(nr);
        const nx0 = Math.min(bx, nr[0]), ny0 = Math.min(by, nr[1]);
        bw = Math.max(bx + bw, nr[0] + nr[2]) - nx0;
        bh = Math.max(by + bh, nr[1] + nr[3]) - ny0;
        bx = nx0; by = ny0;
      }
      const sc = (2 * Rr) / Math.max(bw, bh);
      const ox = -(bx + bw / 2) * sc, oy = -(by + bh / 2) * sc;
      const M = (p) => [p[0] * sc + ox, p[1] * sc + oy];
      placed.forEach((r0, i) => {
        const [rx, ry, rw, rh] = r0;
        if (P.detail) line([M([rx, ry]), M([rx + rw, ry]), M([rx + rw, ry + rh]), M([rx, ry + rh]), M([rx, ry])]);
        const d = i % 4;
        const c = d === 1 ? [rx, ry] : d === 2 ? [rx + rw, ry] : d === 3 ? [rx + rw, ry + rh] : [rx, ry + rh];
        const a0 = d === 1 ? 0 : d === 2 ? Math.PI / 2 : d === 3 ? Math.PI : -Math.PI / 2;
        line(arcPts(0, 0, rw, a0, a0 + Math.PI / 2, 26).map((p) => M([p[0] + c[0], p[1] + c[1]])));
      });
      if (P.boundary) ring(0, 0, Rr * 1.05);
      return out;
    }

    /* ---------------- Star polygon {n/k} ---------------- */
    if (P.figure === 'star') {
      for (let L = 0; L < layers; L++) {
        const t = layers === 1 ? 0 : L / (layers - 1);
        const r = Rr * (1 - t * (1 - P.ratio));
        const phase = Math.PI / 2 + twist * L + (L * Math.PI) / n;
        for (const c of starCircuits(r, n, P.skip, phase)) line(c);
        if (P.detail) ring(0, 0, r);
      }
      boundary();
      return out;
    }

    /* ---------------- Tree of Life ---------------- */
    if (P.figure === 'tree') {
      const u = Rr / 3.2;
      const S10 = [
        [0, 3 * u], [-u, 2 * u], [u, 2 * u], [-u, u], [u, u],
        [0, 0], [-u, -u], [u, -u], [0, -2 * u], [0, -3 * u],
      ];
      const paths = [
        [0, 1], [0, 2], [1, 2], [0, 5], [1, 3], [2, 4], [1, 4], [2, 3], [3, 4],
        [3, 5], [4, 5], [3, 6], [4, 7], [5, 6], [5, 7], [6, 7], [5, 8], [6, 8],
        [7, 8], [6, 9], [7, 9], [8, 9],
      ];
      for (const [a, b] of paths) line([S10[a], S10[b]]);
      const nodeR = u * P.ratio * 0.6;
      for (const s of S10) ring(s[0], s[1], nodeR);
      if (P.detail) for (const s of S10) ring(s[0], s[1], nodeR * 0.45);
      boundary();
      return out;
    }

    /* ---------------- Platonic wireframe ---------------- */
    if (P.figure === 'platonic') {
      const { verts, edges } = platonicEdges(P.solid);
      const tx = (P.tilt * Math.PI) / 180, sp = (P.spin * Math.PI) / 180;
      let maxR = 0;
      const proj = verts.map(([x, y, z]) => {
        const x1 = x * Math.cos(sp) - y * Math.sin(sp);
        const y1 = x * Math.sin(sp) + y * Math.cos(sp);
        const y2 = y1 * Math.cos(tx) - z * Math.sin(tx);
        const p = [x1, y2];
        maxR = Math.max(maxR, Math.hypot(p[0], p[1]));
        return p;
      });
      const k = (Rr / (maxR || 1)) * 0.94;
      for (const [a, b] of edges) line([mul(proj[a], k), mul(proj[b], k)]);
      if (P.detail) for (const p of proj) ring(p[0] * k, p[1] * k, Rr * 0.035);
      boundary();
      return out;
    }

    /* ---------------- Rodin / times-table circuit ---------------- */
    if (P.figure === 'torus') {
      // m points evenly around a circle, each joined to its multiple mod m.
      // This is the times-table string figure — the multiplier alone sweeps
      // through cardioids, nephroids and every higher epicycloid.
      const m = Math.max(8, n * 2);
      const mult = Math.max(2, P.skip | 0);
      for (let L = 0; L < layers; L++) {
        const t = layers === 1 ? 0 : L / (layers - 1);
        const r = Rr * (1 - t * (1 - P.ratio));
        const ph = twist * L - Math.PI / 2;
        const pts = [];
        for (let i = 0; i < m; i++) {
          const a = ph + (i / m) * TAU;
          pts.push([Math.cos(a) * r, Math.sin(a) * r]);
        }
        for (let i = 0; i < m; i++) {
          const j = (i * mult) % m;
          if (j === i) continue;
          line([pts[i], pts[j]]);
        }
        if (P.detail) ring(0, 0, r);
      }
      boundary();
      return out;
    }

    /* ---------------- Rose curve / Maurer rose ---------------- */
    {
      // r = cos(kθ) draws k petals when k is odd and 2k when it is even, so
      // solve for k to land on exactly `fold` petals.
      const k = n % 2 ? n : n / 2;
      const step = Math.max(1, (P.dstep ?? P.skip) | 0);
      // A Maurer lace of N chords lays down roughly N · 1.2R · W of ink inside
      // a disc of area πR². Past about a third of that the figure stops being
      // lace and becomes a black disc — which is what a fixed chord count gave
      // at the default 2 mm line. Budget the chords against the line width
      // instead, so thinning the line is what buys detail. Layers share the
      // budget, and the whole thing is capped: every chord crosses nearly
      // every other, so the planar arrangement cost grows with the square.
      const layersEff = step > 1 ? Math.min(layers, 3) : layers;
      const inkChords = clamp(Math.round((0.85 * Rr) / Math.max(0.3, W)), 40, 360);
      const hub = Math.max(W * 1.8, Rr * 0.035);
      for (let L = 0; L < layersEff; L++) {
        const t = layersEff === 1 ? 0 : L / (layersEff - 1);
        const r = Rr * (1 - t * (1 - P.ratio));
        const chain = [];
        if (step > 1) {
          // Snap the count to a multiple of the rose's own petal symmetry.
          // Off a multiple, the sample angles don't map onto themselves under
          // a 1/n turn and the lace comes out visibly lopsided.
          const want = Math.max(36, Math.min(inkChords, Math.floor(420 / layersEff)));
          const SAMPLES = Math.max(n, Math.round(want / n) * n);
          for (let i = 0; i <= SAMPLES; i++) {
            const th = (i * step * (360 / SAMPLES) * Math.PI) / 180;
            const rr = r * Math.sin(k * th);
            const aa = th + twist * L;
            chain.push([rr * Math.cos(aa), rr * Math.sin(aa)]);
          }
        } else {
          const steps = 1440;
          for (let i = 0; i <= steps; i++) {
            const th = (i / steps) * TAU;
            const rr = r * Math.cos(k * th);
            const aa = th + twist * L;
            chain.push([rr * Math.cos(aa), rr * Math.sin(aa)]);
          }
        }
        // r = sin(kθ) is zero at a whole family of sample angles, so every one
        // of those chords runs exactly through the origin. Piling 300+ ribbon
        // edges onto one point inside a sub-millimetre disc gives the planar
        // arrangement a vertex it cannot classify consistently, and the trim
        // came back as a single contour with a solid interior — a black disc
        // where the lace should be. Clip the lace out of a small hub and draw
        // the hub as its own ring: the chords then meet a circle at distinct
        // points instead of meeting each other at one, and the centre of the
        // figure reads as a deliberate boss rather than an ink blot.
        if (step > 1) {
          for (const run of outsideCircle(chain, hub)) line(run);
        } else {
          line(chain);
        }
      }
      if (step > 1 && hub > EPS) ring(0, 0, hub);
      if (P.detail) {
        const outline = [];
        for (let i = 0; i <= 720; i++) {
          const th = (i / 720) * TAU;
          const rr = Rr * Math.abs(Math.cos(k * th));
          outline.push([rr * Math.cos(th), rr * Math.sin(th)]);
        }
        line(outline);
      }
      boundary();
      return out;
    }
  },
};
