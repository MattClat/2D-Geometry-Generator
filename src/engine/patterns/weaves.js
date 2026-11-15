/* =========================================================================
 * weaves.js — A. Woven strands, ribbons & interlocking weaves
 *
 *   kagome   Triaxial / hexagonal weaves + 3-way circular ring chain
 *   waves    Meandering parallel wave strands (topographic river contours)
 *   plait    Over-under Celtic plaits and basket weaves
 * =======================================================================*/
import {
  add, sub, mul, dist, norm, len, cross, lerp, TAU, circlePts, arcPts,
  centerline, region, resample, splinePts,
} from '../geom.js';
import { R, I, T, S, lineIsect, cutCenterline, arcLengthAt, triLattice, findCrossings, strapIntervals } from './common.js';

/* ------------------------------------------------------------------ *
 * 1. KAGOME  — triaxial interlock lattice & circular ring mesh
 * ------------------------------------------------------------------ */
export const kagome = {
  id: 'kagome',
  category: 'Woven Strands',
  name: 'Kagome Triaxial Weave',
  blurb: 'Three families of strands at 60° interlocking in a cyclic over-under, or a 3-way circular chain mesh.',
  params: [
    S('mode', 'Weave type', [
      { v: 'triaxial', label: 'Triaxial strands' },
      { v: 'rings', label: 'Circular chain mesh' },
      { v: 'hexlattice', label: 'Hex + triangle lattice' },
    ], 'triaxial'),
    R('pitch', 'Strand pitch', 6, 60, 18, 0.5, 'mm'),
    R('strand', 'Strand width', 0.6, 14, 3.6, 0.1, 'mm'),
    R('gap', 'Over/under gap', 0, 6, 1.6, 0.05, 'mm'),
    R('skew', 'Family skew', -20, 20, 0, 0.5, '°'),
    R('ringRatio', 'Ring radius', 0.3, 1.1, 0.62, 0.01),
    T('doubleLine', 'Split strands', false),
  ],
  generate(P, rng, ctx) {
    const { w, h } = ctx;
    const diag = Math.hypot(w, h) * 0.75;
    const out = [];

    if (P.mode === 'rings') {
      const pitch = P.pitch;
      const r = pitch * P.ringRatio;
      const W = P.strand;
      const gap = Math.max(0, P.gap);
      const nodes = triLattice(w + pitch * 2, h + pitch * 2, pitch);
      const circles = nodes.map((n, i) => ({
        c: [n.x, n.y], r, order: (n.i + n.j * 2) % 3, id: i,
      }));
      // A union has no over and no under. At gap 0 the honest answer is to
      // leave the rings whole and let them merge into one mesh — cutting
      // anything at all can only take away material the crossing ring does not
      // put back, which shows up as a nick, not as a weave.
      const weaving = gap > 1e-9;
      for (const A of circles) {
        const cuts = [];
        const ptsA = circlePts(A.c[0], A.c[1], A.r);
        const closed = ptsA.concat([ptsA[0]]);
        if (weaving) {
          for (const B of circles) {
            if (B === A) continue;
            const d = dist(A.c, B.c);
            if (d > A.r + B.r + W || d < 1e-6) continue;
            // cyclic dominance: order k goes over order (k+1)%3
            const under = (A.order + 1) % 3 === B.order;
            if (!under) continue;
            // Where A actually runs inside B's strap, found by walking A —
            // exact at any crossing angle. The old code estimated the arc from
            // the crossing points and always removed a full strand width more
            // than the crossing strand covers, so even a gap of zero left a
            // visible break at every crossing.
            const pad = gap + W / 2;
            for (const iv of strapIntervals(closed, B.c[0], B.c[1], B.r, W / 2)) {
              cuts.push([iv[0] - pad, iv[1] + pad]);
            }
          }
        }
        // cutCenterline returns the whole ring when there is nothing to cut,
        // so this one call covers both cases — emitting it again separately
        // just wrote every uncut ring into the design twice.
        for (const rr of cutCenterline(closed, cuts)) {
          out.push(centerline(rr, { width: W, closed: !cuts.length }));
        }
      }
      return out;
    }

    if (P.mode === 'hexlattice') {
      // Trihexagonal (Kagome) net drawn as edges of the tiling itself.
      const pitch = P.pitch;
      const dy = pitch * Math.sqrt(3) / 2;
      const seen = new Set();
      const nodes = triLattice(w + pitch * 3, h + pitch * 3, pitch);
      const key = (a, b) => `${a[0].toFixed(3)},${a[1].toFixed(3)}|${b[0].toFixed(3)},${b[1].toFixed(3)}`;
      for (const n of nodes) {
        // midpoints of triangle edges form the Kagome lattice
        const p = [n.x, n.y];
        const neigh = [
          [pitch, 0], [pitch / 2, dy], [-pitch / 2, dy],
        ];
        for (const d of neigh) {
          const q = [p[0] + d[0], p[1] + d[1]];
          const m1 = lerp(p, q, 0.5);
          for (const d2 of [[pitch, 0], [pitch / 2, dy], [-pitch / 2, dy], [-pitch, 0], [-pitch / 2, -dy], [pitch / 2, -dy]]) {
            const q2 = [p[0] + d2[0], p[1] + d2[1]];
            const m2 = lerp(p, q2, 0.5);
            if (dist(m1, m2) < 1e-6) continue;
            if (dist(m1, m2) > pitch * 0.75) continue;
            const k = key(m1, m2), k2 = key(m2, m1);
            if (seen.has(k) || seen.has(k2)) continue;
            seen.add(k);
            out.push(centerline([m1, m2], { width: P.strand }));
          }
        }
      }
      return out;
    }

    /* --- triaxial: three families of parallel straight strands --- */
    const skew = (P.skew * Math.PI) / 180;
    const families = [0, 1, 2].map((k) => {
      const ang = (k * TAU) / 3 / 2 + skew * (k - 1); // 0°, 60°, 120°
      return { k, dir: [Math.cos(ang), Math.sin(ang)], nrm: [-Math.sin(ang), Math.cos(ang)] };
    });
    const lines = [];
    const count = Math.ceil((diag * 2) / P.pitch);
    for (const f of families) {
      for (let i = -count; i <= count; i++) {
        const o = mul(f.nrm, i * P.pitch);
        const a = add(o, mul(f.dir, -diag));
        const b = add(o, mul(f.dir, diag));
        lines.push({ f: f.k, dir: f.dir, a, b, idx: i });
      }
    }
    const cutHalf = P.strand / 2 + P.gap;
    for (const L of lines) {
      const pts = [L.a, L.b];
      const cuts = [];
      for (const M of lines) {
        if (M.f === L.f) continue;
        // cyclic over-under: family k passes over family (k+1) % 3
        const under = (L.f + 1) % 3 === M.f;
        if (!under) continue;
        const r = sub(L.b, L.a), s = sub(M.b, M.a);
        const hit = lineIsect(L.a, r, M.a, s);
        if (!hit) continue;
        const [t, u] = hit;
        if (t < 0 || t > 1 || u < 0 || u > 1) continue;
        const sArc = t * len(r);
        cuts.push([sArc - cutHalf, sArc + cutHalf]);
      }
      const runs = cutCenterline(pts, cuts);
      for (const rr of runs) {
        if (P.doubleLine) {
          const d = norm(sub(rr[rr.length - 1], rr[0]));
          const n2 = [-d[1], d[0]];
          const o = P.strand * 0.62;
          out.push(centerline(rr.map((p) => add(p, mul(n2, o))), { width: P.strand * 0.42 }));
          out.push(centerline(rr.map((p) => sub(p, mul(n2, o))), { width: P.strand * 0.42 }));
        } else {
          out.push(centerline(rr, { width: P.strand }));
        }
      }
    }
    return out;
  },
};

/* ------------------------------------------------------------------ *
 * 2. WAVES — meandering parallel strands / topographic river contours
 * ------------------------------------------------------------------ */
export const waves = {
  id: 'waves',
  category: 'Woven Strands',
  name: 'Flowing Ribbon Waves',
  blurb: 'Parallel sinusoidal streams with phase drift, clustering and turbulence — the classic modern wall-panel look.',
  params: [
    I('streams', 'Stream count', 3, 90, 26),
    R('amp', 'Amplitude', 0, 60, 14, 0.5, 'mm'),
    R('freq', 'Frequency', 0.2, 8, 1.6, 0.05),
    R('phase', 'Phase drift / stream', -1, 1, 0.16, 0.01),
    R('strand', 'Strand width', 0.3, 12, 2.4, 0.1, 'mm'),
    R('turbulence', 'Turbulence', 0, 30, 0, 0.5, 'mm'),
    I('cluster', 'Cluster size', 1, 10, 1),
    R('clusterGap', 'Cluster gap', 0, 4, 1.6, 0.05, '×'),
    R('ampDrift', 'Amplitude drift', 0, 1, 0.25, 0.01),
    T('vertical', 'Vertical flow', false),
    T('sBend', 'S-bend (square wave)', false),
    R('taper', 'Width taper', 0, 1, 0, 0.01),
  ],
  generate(P, rng, ctx) {
    const { w, h, noise } = ctx;
    const vert = P.vertical;
    const spanA = vert ? h : w;       // along the stream
    const spanB = vert ? w : h;       // across the streams
    const n = Math.max(2, P.streams | 0);

    // cluster-aware cross-axis positions
    const positions = [];
    const cl = Math.max(1, P.cluster | 0);
    let unit = 0;
    for (let i = 0; i < n; i++) unit += (i > 0 && i % cl === 0) ? 1 + P.clusterGap : 1;
    const pitch = spanB / (unit || 1);
    let acc = 0;
    for (let i = 0; i < n; i++) {
      if (i > 0) acc += (i % cl === 0) ? (1 + P.clusterGap) * pitch : pitch;
      positions.push(-spanB / 2 + acc + pitch * 0.5);
    }

    const out = [];
    const steps = Math.max(48, Math.ceil(spanA / 1.2));
    for (let k = 0; k < n; k++) {
      const base = positions[k];
      const ph = P.phase * k * Math.PI;
      const ampK = P.amp * (1 - P.ampDrift * 0.5 * (1 + Math.sin(k * 0.7 + 1.3)));
      const pts = [];
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const along = -spanA / 2 + t * spanA;
        const u = (along / spanA) * TAU * P.freq;
        let off = P.sBend
          ? ampK * Math.tanh(2.6 * Math.sin(u + ph))
          : ampK * Math.sin(u + ph);
        if (P.turbulence > 0 && noise) {
          off += P.turbulence * noise.fbm(along * 0.012, base * 0.012 + k * 0.6, 3);
        }
        pts.push(vert ? [base + off, along] : [along, base + off]);
      }
      out.push(centerline(pts, { width: P.strand, taper: P.taper }));
    }
    return out;
  },
};

/* ------------------------------------------------------------------ *
 * 3. PLAIT — over/under Celtic plaits and basket weaves
 * ------------------------------------------------------------------ */
export const plait = {
  id: 'plait',
  category: 'Woven Strands',
  name: 'Celtic & Basket Weave',
  blurb: 'Continuous over-under ribbons: rectangular basket masonry or a diagonal Celtic plait with automatic crossing gaps.',
  params: [
    S('mode', 'Weave', [
      { v: 'basket', label: 'Basket (orthogonal)' },
      { v: 'celtic', label: 'Celtic plait (diagonal)' },
      { v: 'twill', label: 'Twill (2/2 diagonal shift)' },
    ], 'basket'),
    R('pitch', 'Band pitch', 5, 60, 16, 0.5, 'mm'),
    R('strand', 'Band width', 0.6, 20, 6, 0.1, 'mm'),
    R('gap', 'Crossing gap', 0, 6, 1.4, 0.05, 'mm'),
    I('group', 'Bands per group', 1, 6, 1),
    R('amp', 'Plait amplitude', 0, 1.4, 0.7, 0.01, '×'),
    R('rotate', 'Rotation', -90, 90, 0, 1, '°'),
  ],
  generate(P, rng, ctx) {
    const { w, h } = ctx;
    const diag = Math.hypot(w, h) * 0.72;
    const out = [];
    const rotA = (P.rotate * Math.PI) / 180;
    const rotP = (p) => [
      p[0] * Math.cos(rotA) - p[1] * Math.sin(rotA),
      p[0] * Math.sin(rotA) + p[1] * Math.cos(rotA),
    ];

    if (P.mode === 'celtic' || P.mode === 'twill') {
      // Two families of sine strands at +45 / -45 with checkerboard over-under.
      const pitch = P.pitch;
      const cnt = Math.ceil((diag * 2) / pitch);
      const amp = pitch * 0.5 * P.amp;
      const fams = [Math.PI / 4, -Math.PI / 4].map((ang) => ({
        ang, dir: [Math.cos(ang), Math.sin(ang)], nrm: [-Math.sin(ang), Math.cos(ang)],
      }));
      const strands = [];
      fams.forEach((f, fi) => {
        for (let i = -cnt; i <= cnt; i++) {
          const o = mul(f.nrm, i * pitch);
          const pts = [];
          const steps = Math.ceil((diag * 2) / 1.5);
          for (let s = 0; s <= steps; s++) {
            const t = -diag + (s / steps) * diag * 2;
            const wob = amp * Math.sin((t / pitch) * Math.PI + (fi ? Math.PI / 2 : 0));
            pts.push(add(add(o, mul(f.dir, t)), mul(f.nrm, wob)));
          }
          strands.push({ fi, fam: fi, i, pts });
        }
      });
      const cutHalf = P.strand / 2 + P.gap;
      const cutsFor = strands.map(() => []);
      for (const hit of findCrossings(strands, Math.max(2, pitch))) {
        const X = hit.p;
        // checkerboard dominance: parity of the crossing cell decides who dives
        const cellParity = (Math.round(X[0] / pitch) + Math.round(X[1] / pitch)) & 1;
        const shift = P.mode === 'twill' ? (Math.round(X[1] / pitch) & 1) : 0;
        const underFam = (cellParity ^ shift) ? 1 : 0;
        const idx = strands[hit.a].fi === underFam ? hit.a : strands[hit.b].fi === underFam ? hit.b : -1;
        if (idx < 0) continue;
        const { s: sArc } = arcLengthAt(strands[idx].pts, X);
        cutsFor[idx].push([sArc - cutHalf, sArc + cutHalf]);
      }
      strands.forEach((A, i) => {
        for (const rr of cutCenterline(A.pts, cutsFor[i])) {
          out.push(centerline(rr.map(rotP), { width: P.strand }));
        }
      });
      return out;
    }

    /* --- basket weave: orthogonal bands in groups --- */
    const g = Math.max(1, P.group | 0);
    const pitch = P.pitch;
    const cnt = Math.ceil(diag / pitch) + 2;
    const bands = [];
    for (let axis = 0; axis < 2; axis++) {
      for (let i = -cnt; i <= cnt; i++) {
        const o = i * pitch;
        const pts = axis === 0
          ? [[-diag, o], [diag, o]]
          : [[o, -diag], [o, diag]];
        bands.push({ axis, i, pts });
      }
    }
    const cutHalf = P.strand / 2 + P.gap;
    for (const A of bands) {
      const cuts = [];
      for (const B of bands) {
        if (B.axis === A.axis) continue;
        const p = A.pts[0], r = sub(A.pts[1], p);
        const q = B.pts[0], s2 = sub(B.pts[1], q);
        const hit = lineIsect(p, r, q, s2);
        if (!hit) continue;
        const [t, u] = hit;
        if (t < 0 || t > 1 || u < 0 || u > 1) continue;
        // group-parity basket weave
        const ga = Math.floor((A.i + 1e4 * g) / g);
        const gb = Math.floor((B.i + 1e4 * g) / g);
        const under = A.axis === 0 ? ((ga + gb) & 1) === 0 : ((ga + gb) & 1) === 1;
        if (!under) continue;
        cuts.push([t * len(r) - cutHalf, t * len(r) + cutHalf]);
      }
      for (const rr of cutCenterline(A.pts, cuts)) {
        out.push(centerline(rr.map(rotP), { width: P.strand }));
      }
    }
    return out;
  },
};
