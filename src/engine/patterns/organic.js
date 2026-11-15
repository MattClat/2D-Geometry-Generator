/* =========================================================================
 * organic.js — D. Organic, maze & bio-algorithmic engines
 *
 *   truchet   Multi-scale Truchet arc / diagonal tilings
 *   maze      90° meandering ribbon mazes & filleted circuit-board traces
 *   isolines  Reaction-diffusion style isolines + differential line growth
 *   voronoi   Lloyd-relaxed centroidal Voronoi cells with structural webs
 * =======================================================================*/
import {
  add, sub, mul, dist, dist2, norm, len, lerp, clamp, TAU, EPS,
  circlePts, arcPts, rectPts, regularPolygonPts,
  centerline, region, dedupe, fillet, offsetPolyline, polygonArea, polygonCentroid,
  resample,
} from '../geom.js';
import { R, I, T, S, gridCells, poissonDisk, smoothClosed, chaikin } from './common.js';

/* ------------------------------------------------------------------ *
 * 10. TRUCHET — multi-scale arc / diagonal tiles
 * ------------------------------------------------------------------ */
export const truchet = {
  id: 'truchet',
  category: 'Organic & Maze',
  name: 'Truchet Labyrinth',
  blurb: 'Multi-scale Truchet tiles — quarter-arcs, diagonals and triangles that self-assemble into endless labyrinths.',
  params: [
    S('tile', 'Tile set', [
      { v: 'arcs', label: 'Quarter arcs' },
      { v: 'diagonals', label: 'Diagonals' },
      { v: 'mixed', label: 'Arcs + diagonals' },
      { v: 'triangles', label: 'Filled triangles' },
      { v: 'quads', label: 'Nested quarter rings' },
    ], 'arcs'),
    R('cell', 'Base cell', 4, 80, 22, 0.5, 'mm'),
    R('stroke', 'Line width', 0.4, 14, 3, 0.1, 'mm'),
    I('subdiv', 'Multi-scale depth', 0, 3, 1),
    R('subdivRate', 'Subdivide chance', 0, 1, 0.42, 0.01),
    I('lanes', 'Lanes per tile', 1, 5, 1),
    R('laneGap', 'Lane gap', 0.05, 0.45, 0.2, 0.01, '×'),
  ],
  generate(P, rng, ctx) {
    const { w, h } = ctx;
    const out = [];
    const emitTile = (x, y, s, depth) => {
      if (depth < P.subdiv && rng() < P.subdivRate) {
        const hs = s / 2;
        emitTile(x, y, hs, depth + 1);
        emitTile(x + hs, y, hs, depth + 1);
        emitTile(x, y + hs, hs, depth + 1);
        emitTile(x + hs, y + hs, hs, depth + 1);
        return;
      }
      const flip = rng.bool();
      const kind = P.tile === 'mixed' ? (rng.bool() ? 'arcs' : 'diagonals') : P.tile;
      const lanes = Math.max(1, P.lanes | 0);
      const lw = P.stroke * (s / P.cell);

      if (kind === 'triangles') {
        const c = [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];
        const k = rng.int(0, 3);
        out.push(region([c[k], c[(k + 1) % 4], c[(k + 2) % 4]], { layer: 'cut' }));
        return;
      }
      if (kind === 'quads') {
        const k = rng.int(0, 3);
        const corners = [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];
        const c = corners[k];
        for (let i = 1; i <= lanes; i++) {
          const r = (s * i) / (lanes + 1);
          const a0 = (k * Math.PI) / 2;
          out.push(centerline(arcPts(c[0], c[1], r, a0, a0 + Math.PI / 2), { width: lw }));
        }
        return;
      }
      if (kind === 'diagonals') {
        for (let i = 0; i < lanes; i++) {
          const o = lanes === 1 ? 0 : (i / (lanes - 1) - 0.5) * s * P.laneGap * 2;
          if (flip) out.push(centerline([[x + o, y], [x + s, y + s - o]], { width: lw }));
          else out.push(centerline([[x, y + s + o], [x + s - o, y]], { width: lw }));
        }
        return;
      }
      /* arcs: two opposite quarter circles */
      const pairs = flip
        ? [[[x, y], 0], [[x + s, y + s], Math.PI]]
        : [[[x + s, y], Math.PI / 2], [[x, y + s], -Math.PI / 2]];
      for (const [c, a0] of pairs) {
        for (let i = 0; i < lanes; i++) {
          const frac = lanes === 1 ? 0.5 : 0.5 + (i / (lanes - 1) - 0.5) * P.laneGap * 2;
          out.push(centerline(arcPts(c[0], c[1], s * frac, a0, a0 + Math.PI / 2), { width: lw }));
        }
      }
    };

    const nx = Math.ceil(w / P.cell) + 2;
    const ny = Math.ceil(h / P.cell) + 2;
    // guard: multi-scale subdivision is exponential — cap the tile budget
    const budget = 9000 / Math.max(1, Math.pow(4, P.subdiv | 0) * P.subdivRate + 1);
    const stride = Math.max(1, Math.ceil(Math.sqrt((nx * ny) / Math.max(1, budget))));
    for (let j = 0; j < ny; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        if (stride > 1 && (i % stride || j % stride)) continue;
        const s = P.cell * stride;
        emitTile((i - nx / 2) * P.cell, (j - ny / 2) * P.cell, s, 0);
      }
    }
    return out;
  },
};

/* ------------------------------------------------------------------ *
 * 11. MAZE — 90° meandering ribbon mazes & circuit traces
 * ------------------------------------------------------------------ */
export const maze = {
  id: 'maze',
  category: 'Organic & Maze',
  name: 'Circuit Labyrinth',
  blurb: 'Spanning-tree mazes rendered as filleted 90° routing traces with terminal pads — clean, continuous, and always one connected body.',
  params: [
    S('mode', 'Style', [
      { v: 'circuit', label: 'Circuit traces' },
      { v: 'maze', label: 'Ribbon maze' },
      { v: 'greek', label: 'Greek key meander' },
    ], 'circuit'),
    R('cell', 'Routing pitch', 3, 50, 12, 0.5, 'mm'),
    R('stroke', 'Trace width', 0.3, 12, 2.4, 0.1, 'mm'),
    R('fillet', 'Corner radius', 0, 12, 3, 0.1, 'mm'),
    R('straightness', 'Straight bias', 0, 1, 0.72, 0.01),
    R('padSize', 'Pad diameter', 0, 14, 4.4, 0.1, 'mm'),
    R('density', 'Trace density', 0.15, 1, 0.85, 0.01),
    I('meanderTurns', 'Meander depth', 1, 6, 3),
  ],
  generate(P, rng, ctx) {
    const { w, h } = ctx;
    const out = [];
    const c = P.cell;
    const nx = Math.max(3, Math.ceil(w / c));
    const ny = Math.max(3, Math.ceil(h / c));
    const X = (i) => (i - (nx - 1) / 2) * c;
    const Y = (j) => (j - (ny - 1) / 2) * c;

    if (P.mode === 'greek') {
      // Greek-key / meander border band, repeated across the field
      const t = Math.max(1, P.meanderTurns | 0);
      const unit = c * (t * 2 + 1);
      const rows = Math.ceil(h / (c * (t + 1))) + 1;
      const cols = Math.ceil(w / unit) + 1;
      for (let r = -rows; r <= rows; r++) {
        for (let k = -cols; k <= cols; k++) {
          const ox = k * unit, oy = r * c * (t + 1.6);
          const pts = [[ox, oy]];
          let x = ox, y = oy;
          for (let i = 0; i < t; i++) { x += c; pts.push([x, y]); y += c; pts.push([x, y]); }
          for (let i = 0; i < t; i++) { x += c; pts.push([x, y]); y -= c; pts.push([x, y]); }
          x += c; pts.push([x, y]);
          out.push(centerline(P.fillet > 0 ? fillet(pts, P.fillet, false) : pts, { width: P.stroke }));
        }
      }
      return out;
    }

    /* --- spanning-tree maze (randomised DFS) --- */
    const visited = new Uint8Array(nx * ny);
    const edges = [];
    const stack = [[rng.int(0, nx - 1), rng.int(0, ny - 1)]];
    visited[stack[0][0] + stack[0][1] * nx] = 1;
    let lastDir = null;
    while (stack.length) {
      const [i, j] = stack[stack.length - 1];
      const cands = [];
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (const d of dirs) {
        const ni = i + d[0], nj = j + d[1];
        if (ni < 0 || nj < 0 || ni >= nx || nj >= ny) continue;
        if (visited[ni + nj * nx]) continue;
        cands.push([ni, nj, d]);
      }
      if (!cands.length) { stack.pop(); continue; }
      // straight bias produces long clean runs like real PCB routing
      let choice = cands[0];
      if (lastDir && rng() < P.straightness) {
        const straight = cands.find((cd) => cd[2][0] === lastDir[0] && cd[2][1] === lastDir[1]);
        choice = straight || rng.pick(cands);
      } else choice = rng.pick(cands);
      lastDir = choice[2];
      visited[choice[0] + choice[1] * nx] = 1;
      edges.push([[i, j], [choice[0], choice[1]]]);
      stack.push([choice[0], choice[1]]);
    }

    // stitch collinear edges into long polylines (fewer, cleaner toolpaths)
    const adj = new Map();
    const key = (i, j) => i + ',' + j;
    for (const [a, b] of edges) {
      if (rng() > P.density) continue;
      for (const [p, q] of [[a, b], [b, a]]) {
        const k = key(p[0], p[1]);
        if (!adj.has(k)) adj.set(k, []);
        adj.get(k).push(q);
      }
    }
    const used = new Set();
    const ekey = (a, b) => (key(a[0], a[1]) < key(b[0], b[1]) ? key(a[0], a[1]) + '|' + key(b[0], b[1]) : key(b[0], b[1]) + '|' + key(a[0], a[1]));
    const walk = (start, first) => {
      const chain = [start, first];
      used.add(ekey(start, first));
      let prev = start, cur = first;
      for (let guard = 0; guard < 4000; guard++) {
        const nbrs = (adj.get(key(cur[0], cur[1])) || []).filter((q) => !used.has(ekey(cur, q)));
        if (!nbrs.length) break;
        // prefer to continue straight
        const dir = [cur[0] - prev[0], cur[1] - prev[1]];
        const straight = nbrs.find((q) => q[0] - cur[0] === dir[0] && q[1] - cur[1] === dir[1]);
        const next = straight || nbrs[0];
        used.add(ekey(cur, next));
        chain.push(next);
        prev = cur; cur = next;
      }
      return chain;
    };
    const chains = [];
    for (const [k, nbrs] of adj) {
      const [i, j] = k.split(',').map(Number);
      for (const q of nbrs) {
        if (used.has(ekey([i, j], q))) continue;
        chains.push(walk([i, j], q));
      }
    }
    for (const ch of chains) {
      let pts = ch.map(([i, j]) => [X(i), Y(j)]);
      pts = dedupe(pts, 1e-6);
      if (pts.length < 2) continue;
      if (P.fillet > 0) pts = fillet(pts, Math.min(P.fillet, c / 2 - 1e-3), false);
      out.push(centerline(pts, { width: P.stroke }));
      if (P.mode === 'circuit' && P.padSize > 0) {
        for (const end of [ch[0], ch[ch.length - 1]]) {
          out.push(region(circlePts(X(end[0]), Y(end[1]), P.padSize / 2), { layer: 'cut' }));
        }
      }
    }
    return out;
  },
};

/* ------------------------------------------------------------------ *
 * 12. ISOLINES — reaction-diffusion isolines & differential growth
 * ------------------------------------------------------------------ */
export const isolines = {
  id: 'isolines',
  category: 'Organic & Maze',
  name: 'Organic Isolines & Growth',
  blurb: 'Fingerprint-like meandering contours from a layered noise field, or a true differential-growth simulation of a rippling closed loop.',
  params: [
    S('mode', 'Method', [
      { v: 'iso', label: 'Noise isolines (fingerprint)' },
      { v: 'growth', label: 'Differential line growth' },
      { v: 'topo', label: 'Topographic contours' },
    ], 'iso'),
    R('scale', 'Field scale', 0.002, 0.09, 0.008, 0.001),
    I('levels', 'Contour count', 1, 60, 12),
    R('stroke', 'Line width', 0.3, 10, 1.8, 0.05, 'mm'),
    I('octaves', 'Noise octaves', 1, 6, 3),
    R('warp', 'Domain warp', 0, 3, 0.8, 0.01),
    I('iterations', 'Growth steps', 40, 900, 340),
    R('repel', 'Repulsion radius', 1, 20, 6, 0.1, 'mm'),
    R('res', 'Field resolution', 0.8, 6, 2, 0.1, 'mm'),
  ],
  generate(P, rng, ctx) {
    const { w, h, noise } = ctx;
    const out = [];

    if (P.mode === 'growth') {
      /* Differential growth: a closed loop that inserts nodes where it
         stretches and pushes itself apart — produces brain-coral ripples. */
      let pts = [];
      const n0 = 60, r0 = Math.min(w, h) * 0.16;
      for (let i = 0; i < n0; i++) {
        const a = (i / n0) * TAU;
        pts.push([Math.cos(a) * r0, Math.sin(a) * r0]);
      }
      const maxEdge = P.repel * 0.85;
      const minEdge = P.repel * 0.42;
      const bound = [w / 2 - P.stroke, h / 2 - P.stroke];
      const iters = P.iterations | 0;
      for (let it = 0; it < iters && pts.length < 2600; it++) {
        const n = pts.length;
        const force = new Array(n);
        // spatial hash for repulsion
        const cell = P.repel;
        const grid = new Map();
        const gk = (p) => Math.floor(p[0] / cell) + ',' + Math.floor(p[1] / cell);
        pts.forEach((p, i) => {
          const k = gk(p);
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k).push(i);
        });
        for (let i = 0; i < n; i++) {
          const p = pts[i];
          let fx = 0, fy = 0;
          const gx = Math.floor(p[0] / cell), gy = Math.floor(p[1] / cell);
          for (let yy = gy - 1; yy <= gy + 1; yy++) {
            for (let xx = gx - 1; xx <= gx + 1; xx++) {
              const arr = grid.get(xx + ',' + yy);
              if (!arr) continue;
              for (const j of arr) {
                if (j === i) continue;
                const d2 = dist2(p, pts[j]);
                if (d2 > P.repel * P.repel || d2 < 1e-9) continue;
                const d = Math.sqrt(d2);
                const f = (P.repel - d) / P.repel;
                fx += ((p[0] - pts[j][0]) / d) * f;
                fy += ((p[1] - pts[j][1]) / d) * f;
              }
            }
          }
          // spring toward neighbours keeps the curve smooth
          const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
          fx += ((a[0] + b[0]) / 2 - p[0]) * 0.45;
          fy += ((a[1] + b[1]) / 2 - p[1]) * 0.45;
          // outward growth pressure modulated by noise
          const nx2 = noise ? noise.noise2(p[0] * P.scale * 3, p[1] * P.scale * 3) : 0;
          fx += nx2 * 0.12; fy += nx2 * 0.12;
          force[i] = [fx, fy];
        }
        for (let i = 0; i < n; i++) {
          let x = pts[i][0] + force[i][0] * 0.42;
          let y = pts[i][1] + force[i][1] * 0.42;
          pts[i] = [clamp(x, -bound[0], bound[0]), clamp(y, -bound[1], bound[1])];
        }
        // resample: split long edges, drop short ones
        const next = [];
        for (let i = 0; i < n; i++) {
          const p = pts[i], q = pts[(i + 1) % n];
          const d = dist(p, q);
          if (d < minEdge && next.length) continue;
          next.push(p);
          if (d > maxEdge) next.push(lerp(p, q, 0.5));
        }
        pts = next.length > 8 ? next : pts;
      }
      out.push(centerline(smoothClosed(pts, 2).concat([pts[0]]), { width: P.stroke }));
      return out;
    }

    /* --- marching-squares isolines over a warped fbm field --- */
    const res = P.res;
    const gw = Math.ceil(w / res) + 1;
    const gh = Math.ceil(h / res) + 1;
    const field = new Float32Array(gw * gh);
    const S1 = P.scale;
    for (let j = 0; j < gh; j++) {
      for (let i = 0; i < gw; i++) {
        const x = -w / 2 + i * res, y = -h / 2 + j * res;
        let px = x, py = y;
        if (P.warp > 0 && noise) {
          const wx = noise.fbm(x * S1 * 0.7 + 11.3, y * S1 * 0.7 - 4.1, 2);
          const wy = noise.fbm(x * S1 * 0.7 - 7.7, y * S1 * 0.7 + 2.9, 2);
          px += wx * P.warp / S1 * 0.06;
          py += wy * P.warp / S1 * 0.06;
        }
        field[i + j * gw] = noise ? noise.fbm(px * S1, py * S1, P.octaves | 0) : Math.sin(px * S1 * 8) * Math.cos(py * S1 * 8);
      }
    }
    const levels = Math.max(1, P.levels | 0);
    const isTopo = P.mode === 'topo';
    for (let L = 0; L < levels; L++) {
      const thr = -0.8 + (1.6 * (L + 0.5)) / levels;
      const segs = marchingSquares(field, gw, gh, res, thr, -w / 2, -h / 2);
      const loops = linkSegments(segs, res * 0.35);
      for (const lp of loops) {
        if (lp.pts.length < 4) continue;
        const sm = chaikin(lp.pts, 2, lp.closed);
        out.push(centerline(lp.closed ? sm.concat([sm[0]]) : sm, {
          width: isTopo ? P.stroke * (0.6 + 0.5 * (L / levels)) : P.stroke,
        }));
      }
    }
    return out;
  },
};

/** Classic marching squares -> unordered line segments. */
function marchingSquares(field, gw, gh, res, thr, ox, oy) {
  const segs = [];
  const at = (i, j) => field[i + j * gw];
  const ipt = (x1, y1, v1, x2, y2, v2) => {
    const t = (thr - v1) / ((v2 - v1) || EPS);
    return [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t];
  };
  for (let j = 0; j < gh - 1; j++) {
    for (let i = 0; i < gw - 1; i++) {
      const x0 = ox + i * res, y0 = oy + j * res, x1 = x0 + res, y1 = y0 + res;
      const v00 = at(i, j), v10 = at(i + 1, j), v11 = at(i + 1, j + 1), v01 = at(i, j + 1);
      let code = 0;
      if (v00 > thr) code |= 1;
      if (v10 > thr) code |= 2;
      if (v11 > thr) code |= 4;
      if (v01 > thr) code |= 8;
      if (code === 0 || code === 15) continue;
      const B = () => ipt(x0, y0, v00, x1, y0, v10); // bottom
      const Rr = () => ipt(x1, y0, v10, x1, y1, v11); // right
      const Tt = () => ipt(x0, y1, v01, x1, y1, v11); // top
      const Ll = () => ipt(x0, y0, v00, x0, y1, v01); // left
      switch (code) {
        case 1: case 14: segs.push([Ll(), B()]); break;
        case 2: case 13: segs.push([B(), Rr()]); break;
        case 3: case 12: segs.push([Ll(), Rr()]); break;
        case 4: case 11: segs.push([Rr(), Tt()]); break;
        case 6: case 9: segs.push([B(), Tt()]); break;
        case 7: case 8: segs.push([Ll(), Tt()]); break;
        case 5: segs.push([Ll(), B()], [Rr(), Tt()]); break;
        case 10: segs.push([B(), Rr()], [Ll(), Tt()]); break;
      }
    }
  }
  return segs;
}

/** Join loose segments into ordered polylines (closed where possible). */
function linkSegments(segs, tol) {
  const key = (p) => `${Math.round(p[0] / tol)},${Math.round(p[1] / tol)}`;
  const map = new Map();
  segs.forEach((s, i) => {
    for (const p of s) {
      const k = key(p);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(i);
    }
  });
  const used = new Uint8Array(segs.length);
  const loops = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    let chain = segs[i].slice();
    // extend both ends
    for (const dirEnd of [1, 0]) {
      for (let guard = 0; guard < 100000; guard++) {
        const endPt = dirEnd ? chain[chain.length - 1] : chain[0];
        const cand = (map.get(key(endPt)) || []).find((j) => !used[j]);
        if (cand === undefined) break;
        used[cand] = 1;
        const s = segs[cand];
        const near = dist2(s[0], endPt) <= dist2(s[1], endPt) ? s[1] : s[0];
        if (dirEnd) chain.push(near); else chain.unshift(near);
      }
    }
    const closed = dist2(chain[0], chain[chain.length - 1]) < tol * tol * 4 && chain.length > 3;
    if (closed) chain.pop();
    if (chain.length > 2) loops.push({ pts: chain, closed });
  }
  return loops;
}

/* ------------------------------------------------------------------ *
 * 13. VORONOI — Lloyd-relaxed centroidal cells
 * ------------------------------------------------------------------ */
export const voronoi = {
  id: 'voronoi',
  category: 'Organic & Maze',
  name: 'Bio-Cellular Voronoi',
  blurb: 'Centroidal Voronoi diagram (Lloyd relaxation) with controllable web thickness and corner rounding — organic and laser-ready.',
  params: [
    I('sites', 'Cell count', 8, 700, 150),
    I('relax', 'Lloyd relaxation', 0, 12, 5),
    R('wall', 'Web thickness', 0.4, 16, 3, 0.1, 'mm'),
    R('round', 'Corner radius', 0, 14, 2, 0.1, 'mm'),
    R('jitter', 'Site jitter', 0, 1, 1, 0.01),
    S('style', 'Output', [
      { v: 'cells', label: 'Cell islands' },
      { v: 'web', label: 'Web / lattice' },
    ], 'web'),
    R('shrink', 'Cell shrink', 0, 0.4, 0.06, 0.005, '×'),
    T('gradient', 'Density gradient', false),
  ],
  generate(P, rng, ctx) {
    const { w, h } = ctx;
    const N = Math.max(3, P.sites | 0);
    const bbox = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
    let sites = [];
    for (let i = 0; i < N; i++) {
      let x = rng.float(-w / 2, w / 2), y = rng.float(-h / 2, h / 2);
      if (P.gradient) {
        // bias toward the centre for a graded cell-size field
        x *= Math.pow(rng(), 0.55) * rng.sign() > 0 ? 1 : 1;
        x = x * (0.35 + 0.65 * Math.pow(rng(), 0.5));
        y = y * (0.35 + 0.65 * Math.pow(rng(), 0.5));
      }
      if (P.jitter < 1) {
        const cols = Math.ceil(Math.sqrt(N * (w / h)));
        const rows = Math.ceil(N / cols);
        const gi = i % cols, gj = Math.floor(i / cols);
        const gxp = -w / 2 + ((gi + 0.5) * w) / cols;
        const gyp = -h / 2 + ((gj + 0.5) * h) / rows;
        x = lerp([gxp, gyp], [x, y], P.jitter)[0];
        y = lerp([gxp, gyp], [x, y], P.jitter)[1];
        x = gxp + (x - gxp) * P.jitter;
        y = gyp + (y - gyp) * P.jitter;
      }
      sites.push([x, y]);
    }

    let cells = [];
    for (let it = 0; it <= (P.relax | 0); it++) {
      cells = voronoiCells(sites, bbox);
      if (it < P.relax) {
        sites = cells.map((c, i) => (c && c.length > 2 ? polygonCentroid(c) : sites[i]));
      }
    }

    const out = [];
    if (P.style === 'cells') {
      for (const c of cells) {
        if (!c || c.length < 3) continue;
        const ctr = polygonCentroid(c);
        let poly = c.map((p) => lerp(ctr, p, 1 - P.shrink));
        // Inset by half the web on each side, so neighbouring islands end up a
        // full `wall` apart. On a CCW polygon a positive offset is inward — the
        // web branch below punches its holes the same way. The sign here used
        // to be negative, which grew every cell into its neighbours and fused
        // the whole field into one blob that got *bigger* as the web thickened.
        poly = offsetPolyline(ensureCCW(poly), P.wall / 2, true);
        if (poly.length < 3 || polygonArea(poly) <= 0) continue;     // collapsed / inverted
        if (P.round > 0) poly = fillet(poly, P.round, true);
        out.push(region(poly, { layer: 'cut' }));
      }
      return out;
    }

    /* Web / lattice: emit the field as one solid plate and punch each cell out
       as a hole. Even-odd fill then leaves exactly the structural web — a
       single connected body with no overlapping double-cuts. */
    out.push(region([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]], { layer: 'cut' }));
    for (const c of cells) {
      if (!c || c.length < 3) continue;
      const ctr = polygonCentroid(c);
      const shrunk = P.shrink > 0 ? c.map((p) => lerp(ctr, p, 1 - P.shrink)) : c;
      let hole = offsetPolyline(ensureCCW(shrunk), P.wall / 2, true);
      if (hole.length < 3 || Math.abs(polygonArea(hole)) < P.wall * P.wall) continue;
      if (polygonArea(hole) < 0) continue;               // collapsed / inverted
      if (P.round > 0) {
        const f2 = fillet(hole, P.round, true);
        if (f2.length >= 3 && polygonArea(f2) > 0) hole = f2;
      }
      out.push(region(hole, { layer: 'cut' }));
    }
    return out;
  },
};

function ensureCCW(pts) {
  return polygonArea(pts) > 0 ? pts : pts.slice().reverse();
}

/**
 * Voronoi by half-plane clipping. For each site, clip the bounding box by the
 * perpendicular bisector against every other site (nearest-first, with an
 * early exit once remaining sites cannot influence the cell).
 */
function voronoiCells(sites, bbox) {
  const n = sites.length;
  const order = sites.map((_, i) => i);
  const cells = new Array(n);
  for (let i = 0; i < n; i++) {
    const s = sites[i];
    const others = order
      .filter((j) => j !== i)
      .map((j) => ({ j, d: dist2(s, sites[j]) }))
      .sort((a, b) => a.d - b.d);
    let poly = bbox.map((p) => p.slice());
    for (const { j, d } of others) {
      // early exit: no site farther than 2*maxRadius can clip this cell
      let maxR2 = 0;
      for (const p of poly) maxR2 = Math.max(maxR2, dist2(s, p));
      if (d > 4 * maxR2) break;
      poly = clipHalfPlane(poly, s, sites[j]);
      if (poly.length < 3) break;
    }
    cells[i] = poly.length >= 3 ? poly : null;
  }
  return cells;
}

/** Keep the part of `poly` closer to `a` than to `b`. */
function clipHalfPlane(poly, a, b) {
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const nx = b[0] - a[0], ny = b[1] - a[1];
  const side = (p) => (p[0] - mid[0]) * nx + (p[1] - mid[1]) * ny;
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i], prv = poly[(i + poly.length - 1) % poly.length];
    const sc = side(cur), sp = side(prv);
    if (sc <= 0) {
      if (sp > 0) {
        const t = sp / (sp - sc);
        out.push([prv[0] + (cur[0] - prv[0]) * t, prv[1] + (cur[1] - prv[1]) * t]);
      }
      out.push(cur);
    } else if (sp <= 0) {
      const t = sp / (sp - sc);
      out.push([prv[0] + (cur[0] - prv[0]) * t, prv[1] + (cur[1] - prv[1]) * t]);
    }
  }
  return out;
}
