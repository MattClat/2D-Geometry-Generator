/* =========================================================================
 * lattice.js — A. Overlapping ring lattice / chainmail strapwork
 *
 * Rings of equal radius laid on a triangular or square lattice, overlapping
 * their neighbours, optionally interlaced over-under into strapwork. It is the
 * family that contains chainmail, Japanese *shippō* (seven treasures), Celtic
 * ring knots and — at the specific ratio where a ring's radius equals the
 * lattice pitch — the Flower of Life.
 *
 * The patch *grows outward* from the centre in whole lattice rings, so the
 * silhouette is the scalloped hexagon, triangle, rhombus or disc formed by the
 * union of the outermost circles, rather than a rectangle of pattern chopped
 * off at the frame.
 *
 * Two things here are worth knowing before changing anything:
 *
 *  1. The over-under weave needs a *proper 3-colouring* of the lattice, so
 *     that no two touching rings share a colour and colour k can consistently
 *     pass over colour k+1 with no contradiction. A 2-colouring cannot do it:
 *     with only two classes you would need 0 over 1 and 1 over 0 at once.
 *  2. A strand's cut interval is found by testing its centreline against the
 *     other ring's *annulus*, not by estimating an arc length from the
 *     crossing angle. Two rings can meet at any angle from a near-tangency
 *     upward, and the arc-length estimate falls apart exactly at the shallow
 *     crossings, leaving either a nicked strap or a severed one.
 * =======================================================================*/
import { dist, TAU, circlePts, centerline, clamp } from '../geom.js';
import { R, I, T, S, cutCenterline, strapIntervals } from './common.js';

/* ------------------------------------------------------------------ *
 * Lattice construction
 * ------------------------------------------------------------------ */

/**
 * Ring centres for one lattice/silhouette combination.
 * Returns [{ x, y, order }] where `order` is a proper 3-colouring: no two
 * neighbours share a value, so cyclic over-under dominance is consistent.
 */
function latticeCentres(P, ctx) {
  const N = Math.max(0, P.growth | 0);
  const pitch = P.pitch;
  const out = [];
  const dy = (pitch * Math.sqrt(3)) / 2;

  if (P.lattice === 'square') {
    // (i + 2j) mod 3 is a proper colouring of the square lattice: the four
    // neighbours shift it by ±1 and ±2, never by 0.
    const reach = P.silhouette === 'fill'
      ? Math.ceil(Math.max(ctx.w, ctx.h) / pitch / 2) + 2
      : N;
    for (let j = -reach; j <= reach; j++) {
      for (let i = -reach; i <= reach; i++) {
        const x = i * pitch, y = j * pitch;
        if (!keep(P, N, pitch, x, y, Math.abs(i) + Math.abs(j), Math.max(Math.abs(i), Math.abs(j)), ctx)) continue;
        out.push({ x, y, order: (((i + 2 * j) % 3) + 3) % 3 });
      }
    }
    return out;
  }

  // Triangular lattice in axial coordinates. (q - r) mod 3 is proper here for
  // the same reason: all six neighbours shift it by ±1.
  const reach = P.silhouette === 'fill'
    ? Math.ceil(Math.max(ctx.w, ctx.h) / Math.min(pitch, dy) / 2) + 2
    : N;
  for (let r = -reach; r <= reach; r++) {
    for (let q = -reach; q <= reach; q++) {
      const x = pitch * (q + r / 2);
      const y = dy * r;
      // hex distance in axial coordinates
      const hexD = (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;
      if (!keep(P, N, pitch, x, y, hexD, hexD, ctx)) continue;
      out.push({ x, y, order: (((q - r) % 3) + 3) % 3 });
    }
  }
  return out;
}

/** Silhouette test for one candidate centre. */
function keep(P, N, pitch, x, y, stepDist, ringDist, ctx) {
  switch (P.silhouette) {
    case 'fill':
      return Math.abs(x) < ctx.w / 2 + pitch * 1.6 && Math.abs(y) < ctx.h / 2 + pitch * 1.6;
    case 'disc':
      return Math.hypot(x, y) <= N * pitch * 0.94 + 1e-6;
    case 'ring':
      // annular band: an open centre reads as a wreath
      return ringDist <= N && ringDist >= Math.max(1, Math.round(N * P.hollow));
    case 'rhombus':
      // step distance, so this is a diamond on the square lattice and a
      // rhombus on the triangular one rather than a shape in raw millimetres
      return stepDist <= N;
    case 'hex':
    default:
      return ringDist <= N;
  }
}

/* ------------------------------------------------------------------ *
 * Weave
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * Engine
 * ------------------------------------------------------------------ */
export const chainmail = {
  id: 'chainmail',
  category: 'Woven Strands',
  name: 'Overlapping Ring Lattice',
  blurb:
    'Rings of equal radius overlapping on a triangular or square lattice, grown outward ring by ring and optionally interlaced over-under into chainmail strapwork. At radius = pitch it is the Flower of Life.',
  params: [
    S('lattice', 'Lattice', [
      { v: 'tri', label: 'Triangular (6-fold)' },
      { v: 'square', label: 'Square (4-fold)' },
    ], 'tri'),
    S('silhouette', 'Grow outward as', [
      { v: 'hex', label: 'Compact patch' },
      { v: 'disc', label: 'Disc' },
      { v: 'rhombus', label: 'Rhombus / diamond' },
      { v: 'ring', label: 'Open wreath' },
      { v: 'fill', label: 'Fill the sheet' },
    ], 'hex'),
    I('growth', 'Rings outward', 1, 9, 3, '', { when: (P) => P.silhouette !== 'fill' }),
    R('hollow', 'Wreath opening', 0.1, 0.9, 0.5, 0.05, '×', { when: (P) => P.silhouette === 'ring' }),

    R('pitch', 'Lattice pitch', 8, 90, 34, 0.5, 'mm'),
    // The headline control. 0.5 = circles just touching, ~0.66 = the classic
    // chainmail overlap, 1.0 = every circle through its neighbours' centres,
    // which is the Flower of Life.
    R('ratio', 'Ring radius', 0.5, 1.25, 0.68, 0.01, '× pitch'),
    R('strand', 'Strand width', 0.6, 12, 2.6, 0.1, 'mm'),

    // Solid straps are a union: at a crossing the two merge and the only way to
    // show which passes over is to leave a gap. Outlined strapwork is the
    // draughtsman's answer instead — draw both edges of every strand and
    // *trim the under-strand's edges where they run beneath the over-strand*.
    // Nothing is removed from the shape, so the interlacing reads perfectly
    // with no gap at all, which is how every hand-drawn Celtic knot and
    // chainmail plate does it.
    S('render', 'Strand style', [
      { v: 'solid', label: 'Solid straps' },
      { v: 'outline', label: 'Outlined strapwork (line art)' },
    ], 'solid'),
    R('lineW', 'Outline weight', 0.15, 3, 0.8, 0.05, 'mm', { when: (P) => P.render === 'outline' }),

    S('weave', 'Interlacing', [
      { v: 'over3', label: 'Over-under (3-cycle)' },
      { v: 'radial', label: 'Outer rings on top' },
      { v: 'none', label: 'None — merge into one web' },
    ], 'over3'),
    // The width of the visible gap the under-strand leaves, measured to the
    // edge of the strand crossing over it. 0 turns the weave off rather than
    // producing a hairline: see the note in generate().
    R('relief', 'Weave gap', 0, 5, 0.9, 0.05, 'mm',
      { when: (P) => P.weave !== 'none' }),

    T('inner', 'Concentric inner ring', false),
    R('innerRatio', 'Inner ring size', 0.2, 0.85, 0.55, 0.01, '×', { when: (P) => P.inner }),
    T('hub', 'Dot at each centre', false),
    T('rim', 'Rim around the patch', false, { when: (P) => P.silhouette !== 'fill' }),
  ],

  generate(P, rng, ctx) {
    const out = [];
    const pitch = P.pitch;
    const r = pitch * P.ratio;
    const W = P.strand;
    const relief = Math.max(0, P.relief);
    // A union cannot show an over-under. Whatever is cut out of the strand
    // going under is, at relief 0, either covered by the strand going over —
    // in which case the merged outline is unchanged — or it is not, in which
    // case the result is a nibbled notch, not a weave. So relief 0 means
    // *don't cut*: picking "no gap" gives back exactly the merged web, which
    // is what asking for no gap should give.
    // Outlined strapwork shows the weave by hidden-line trimming, so it does
    // not need a gap and defaults to none.
    const outlined = P.render === 'outline';
    const weaving = P.weave !== 'none' && (outlined || relief > 1e-9);

    const centres = latticeCentres(P, ctx).map((c) => ({ ...c, r }));
    if (!centres.length) return out;

    // Segment count scales with radius so shallow crossings still land on a
    // vertex rather than being straddled by one long chord.
    const seg = clamp(Math.ceil(r * 2.2), 48, 260);

    /** Does ring B pass over ring A? */
    const overAB = (B, A) => {
      if (P.weave === 'radial') {
        // Rings further from the centre lie on top, ties broken by colour, so
        // the patch reads as overlapping scales laid from the middle out.
        const dA = A.x * A.x + A.y * A.y, dB = B.x * B.x + B.y * B.y;
        return dB > dA + 1e-6 || (Math.abs(dB - dA) <= 1e-6 && B.order > A.order);
      }
      // cyclic: colour k passes over colour (k+1) % 3. On this lattice that
      // works out to a true alternating over-under-over-under around every
      // ring, which is the real chainmail weave rather than an approximation.
      return (A.order + 1) % 3 === B.order;
    };

    if (outlined) {
      const lw = Math.min(P.lineW, W * 0.9);
      const halfW = W / 2;
      for (const A of centres) {
        // Both edges of the strand, trimmed wherever they pass beneath another.
        for (const side of [1, -1]) {
          const rad = r + side * halfW;
          if (rad <= lw) continue;
          const nseg = clamp(Math.ceil(rad * 2.6), 60, 400);
          const edge = circlePts(A.x, A.y, rad, nseg);
          const loop = edge.concat([edge[0]]);
          const cuts = [];
          if (weaving) {
            for (const B of centres) {
              if (B === A) continue;
              const d = dist([A.x, A.y], [B.x, B.y]);
              if (d > rad + B.r + halfW || d < 1e-9) continue;
              if (!overAB(B, A)) continue;
              // Trim to exactly B's strap. The strap boundary is where B's edge
              // *line* is centred, and this edge's own round cap then reaches
              // half a line weight further — landing flush on the far side of
              // that line. Stopping any later pushes the cap out the other
              // side, which reads as a bead threaded onto every crossing.
              for (const iv of strapIntervals(loop, B.x, B.y, B.r, halfW)) {
                cuts.push([iv[0] - relief, iv[1] + relief]);
              }
            }
          }
          const usable = cuts.filter(([a, b]) => b > a);
          if (!usable.length) out.push(centerline(edge, { width: lw, closed: true }));
          else {
            for (const run of cutCenterline(loop, usable)) {
              if (run.length > 1) out.push(centerline(run, { width: lw }));
            }
          }
        }
        if (P.inner) {
          const ri = r * P.innerRatio;
          if (ri > lw) out.push(centerline(circlePts(A.x, A.y, ri, seg), { width: lw, closed: true }));
        }
        if (P.hub) {
          const rh = Math.max(lw * 1.4, pitch * 0.05);
          out.push(centerline(circlePts(A.x, A.y, rh, 40), { width: lw, closed: true }));
        }
      }
      if (P.rim && P.silhouette !== 'fill') {
        let R0 = 0;
        for (const c of centres) R0 = Math.max(R0, Math.hypot(c.x, c.y));
        out.push(centerline(circlePts(0, 0, R0 + r + halfW + lw * 2, 300), { width: lw * 1.6, closed: true }));
      }
      return out;
    }

    for (const A of centres) {
      const ring = circlePts(A.x, A.y, r, seg);
      const closed = ring.concat([ring[0]]);
      const cuts = [];

      if (weaving) {
        for (const B of centres) {
          if (B === A) continue;
          const d = dist([A.x, A.y], [B.x, B.y]);
          // no overlap, or concentric
          if (d > 2 * r + W || d < 1e-9) continue;
          if (!overAB(B, A)) continue;
          // The strand's ribbon reaches half a width past where its
          // centreline stops, so cutting back by that much again is what puts
          // the visible gap at exactly `relief`.
          const pad = relief + W / 2;
          for (const iv of strapIntervals(closed, B.x, B.y, B.r, W / 2)) {
            cuts.push([iv[0] - pad, iv[1] + pad]);
          }
        }
      }

      if (!cuts.length) {
        // Uncut ring: a true annulus, two concentric loops, so the hole in the
        // middle stays a hole.
        out.push(centerline(ring, { width: W, closed: true }));
      } else {
        for (const run of cutCenterline(closed, cuts)) {
          if (run.length > 1) out.push(centerline(run, { width: W }));
        }
      }

      if (P.inner) {
        const ri = r * P.innerRatio;
        if (ri > W) out.push(centerline(circlePts(A.x, A.y, ri, seg), { width: W * 0.8, closed: true }));
      }
      if (P.hub) {
        const rh = Math.max(W * 0.9, pitch * 0.06);
        out.push(centerline(circlePts(A.x, A.y, rh, 40), { width: W * 0.8, closed: true }));
      }
    }

    // Rim: a ring hugging the patch, which both frames the growth and ties
    // every severed strand end back into one body.
    if (P.rim && P.silhouette !== 'fill') {
      let R0 = 0;
      for (const c of centres) R0 = Math.max(R0, Math.hypot(c.x, c.y));
      const rr = R0 + r + W * 0.9;
      out.push(centerline(circlePts(0, 0, rr, 240), { width: W * 1.6, closed: true }));
    }

    return out;
  },
};
