/* =========================================================================
 * boolean.js — planar arrangement / self-union
 *
 * Turns a soup of overlapping closed contours into the *same filled region*
 * expressed as non-overlapping closed contours: outer boundaries wound CCW,
 * holes wound CW, every edge appearing exactly once. That is what a CAD
 * package, a laser controller and a CAM post all want — no double cuts, no
 * stray internal segments, no coincident duplicates.
 *
 * Method (a standard planar-overlay pipeline):
 *   1. quantise every coordinate onto a fine grid so vertices match exactly
 *   2. split every segment at every intersection, T-junction and collinear
 *      overlap with every other segment
 *   3. collapse coincident sub-segments into single undirected edges
 *   4. classify each edge by probing the fill rule just off each side
 *   5. keep only edges whose two sides disagree, oriented material-on-left
 *   6. walk the resulting half-edge graph, always taking the first turn
 *      clockwise from the reverse of the arriving edge, to trace faces
 *
 * Fill rule is `nonzero` by default: overlapping ribbons union together while
 * properly nested contours (wound the other way) still cut holes.
 * =======================================================================*/
import { polygonArea, simplify, dist } from './geom.js';

const TAU = Math.PI * 2;

/* ------------------------------------------------------------------ *
 * Fill oracle
 *
 * Answers "is this point material?" for the whole input at once. Every edge
 * of every source contour is bucketed into horizontal bands, so a query only
 * inspects the handful of edges that can possibly cross the ray leaving the
 * probe point. Without this the probe walks entire 600-point circles and the
 * trim becomes quadratic on dense designs.
 * ------------------------------------------------------------------ */
function makeFillOracle(loops, bbox, rule) {
  const [x0, y0, x1, y1] = bbox;
  const h = Math.max(1e-9, y1 - y0);
  let nEdge = 0;
  for (const L of loops) nEdge += L.pts.length;
  const rows = Math.max(16, Math.min(1024, Math.round(Math.sqrt(nEdge) * 1.5) || 16));
  const rowH = h / rows;
  const bands = new Array(rows);
  for (let i = 0; i < rows; i++) bands[i] = [];

  // flat edge arrays keep this cache-friendly
  const EAX = [], EAY = [], EBX = [], EBY = [];
  for (const L of loops) {
    const p = L.pts, n = p.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const a = p[j], b = p[i];
      if (a[1] === b[1]) continue;              // horizontal edges never cross the ray
      const id = EAX.length;
      EAX.push(a[0]); EAY.push(a[1]); EBX.push(b[0]); EBY.push(b[1]);
      const lo = Math.max(0, Math.min(rows - 1, Math.floor((Math.min(a[1], b[1]) - y0) / rowH)));
      const hi = Math.max(0, Math.min(rows - 1, Math.floor((Math.max(a[1], b[1]) - y0) / rowH)));
      for (let r = lo; r <= hi; r++) bands[r].push(id);
    }
  }
  const evenodd = rule === 'evenodd';
  return (px, py) => {
    const r = Math.floor((py - y0) / rowH);
    if (r < 0 || r >= rows) return false;
    const band = bands[r];
    let wind = 0, cnt = 0;
    for (let k = 0; k < band.length; k++) {
      const e = band[k];
      const ay = EAY[e], by = EBY[e];
      if ((ay <= py) === (by <= py)) continue;
      const ax = EAX[e], bx = EBX[e];
      const x = ax + ((py - ay) * (bx - ax)) / (by - ay);
      if (x >= px) continue;                    // only count crossings to the left
      cnt++;
      wind += by > ay ? 1 : -1;
    }
    return evenodd ? (cnt & 1) === 1 : wind !== 0;
  };
}

/* Legacy bbox index, retained for the loop-level helpers below. */
function makeLoopIndex(loops, bbox, cells = 64) {
  const [x0, y0, x1, y1] = bbox;
  const w = Math.max(1e-6, x1 - x0), h = Math.max(1e-6, y1 - y0);
  const sx = w / cells, sy = h / cells;
  const grid = new Map();
  const key = (i, j) => i * 100003 + j;
  loops.forEach((L, idx) => {
    let a0 = Infinity, b0 = Infinity, a1 = -Infinity, b1 = -Infinity;
    for (const p of L.pts) {
      if (p[0] < a0) a0 = p[0];
      if (p[1] < b0) b0 = p[1];
      if (p[0] > a1) a1 = p[0];
      if (p[1] > b1) b1 = p[1];
    }
    const i0 = Math.max(0, Math.floor((a0 - x0) / sx));
    const i1 = Math.min(cells, Math.floor((a1 - x0) / sx));
    const j0 = Math.max(0, Math.floor((b0 - y0) / sy));
    const j1 = Math.min(cells, Math.floor((b1 - y0) / sy));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = key(i, j);
        let arr = grid.get(k);
        if (!arr) { arr = []; grid.set(k, arr); }
        arr.push(idx);
      }
    }
  });
  return (p) => {
    const i = Math.max(0, Math.min(cells, Math.floor((p[0] - x0) / sx)));
    const j = Math.max(0, Math.min(cells, Math.floor((p[1] - y0) / sy)));
    return grid.get(key(i, j)) || EMPTY;
  };
}
const EMPTY = [];

/** Winding number contribution of one closed polygon at point p. */
function windingOf(p, pts) {
  let wn = 0;
  const px = p[0], py = p[1];
  for (let i = 0, n = pts.length; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    if (a[1] <= py) {
      if (b[1] > py && ((b[0] - a[0]) * (py - a[1]) - (px - a[0]) * (b[1] - a[1])) > 0) wn++;
    } else if (b[1] <= py && ((b[0] - a[0]) * (py - a[1]) - (px - a[0]) * (b[1] - a[1])) < 0) wn--;
  }
  return wn;
}

/** Even–odd crossing parity of one closed polygon at point p. */
function parityOf(p, pts) {
  let inside = 0;
  const px = p[0], py = p[1];
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[j], b = pts[i];
    if ((b[1] > py) !== (a[1] > py) &&
        px < ((a[0] - b[0]) * (py - b[1])) / (a[1] - b[1]) + b[0]) inside ^= 1;
  }
  return inside;
}

/* ------------------------------------------------------------------ *
 * Main entry
 * ------------------------------------------------------------------ */
/**
 * @param {Array<{pts:Array, layer?:string}>} loops closed contours
 * @param {object} opts { rule: 'nonzero'|'evenodd', eps, simplifyTol, maxSegments }
 * @returns {{ loops, stats }}
 */
export function trimOverlaps(loops, opts = {}) {
  const rule = opts.rule || 'nonzero';
  const eps = opts.eps || 1e-3;   // 1 micron grid — far finer than any machine
  const K = 1 / eps;
  const t0 = now();

  const src = [];
  for (const L of loops) {
    // Decimating here is off by default and should stay that way: contours
    // that share vertices exactly must keep sharing them, and simplifying two
    // coincident outlines independently pulls them apart.
    const tol = opts.simplifyTol ?? 0;
    const pts = tol > 0 ? simplify(L.pts, tol) : L.pts;
    if (pts.length < 3) continue;
    src.push({ pts, layer: L.layer || 'cut' });
  }
  if (!src.length) return { loops: [], stats: { segments: 0, edges: 0, out: 0, ms: 0 } };

  /* -- 0. bbox + quantise ------------------------------------------- */
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const L of src) for (const p of L.pts) {
    if (p[0] < x0) x0 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[0] > x1) x1 = p[0];
    if (p[1] > y1) y1 = p[1];
  }
  const bbox = [x0, y0, x1, y1];
  const qi = (v) => Math.round(v * K);
  const un = (v) => v / K;

  /* -- 1. segments --------------------------------------------------- */
  // stored as flat arrays of quantised integer coordinates
  const ax = [], ay = [], bx = [], by = [], seglayer = [];
  for (const L of src) {
    const n = L.pts.length;
    for (let i = 0; i < n; i++) {
      const p = L.pts[i], q = L.pts[(i + 1) % n];
      const pxq = qi(p[0]), pyq = qi(p[1]), qxq = qi(q[0]), qyq = qi(q[1]);
      if (pxq === qxq && pyq === qyq) continue;
      ax.push(pxq); ay.push(pyq); bx.push(qxq); by.push(qyq);
      seglayer.push(L.layer);
    }
  }
  // Fill queries must be answered against the *quantised* geometry, otherwise
  // a probe point a micron off an edge can land on the wrong side of the
  // original float edge and flip the classification.
  const qsrc = src.map((L) => {
    const out = [];
    for (const p of L.pts) {
      const x = qi(p[0]), y = qi(p[1]);
      const last = out[out.length - 1];
      if (last && last[0] === x && last[1] === y) continue;
      out.push([x, y]);
    }
    if (out.length > 1) {
      const a = out[0], b = out[out.length - 1];
      if (a[0] === b[0] && a[1] === b[1]) out.pop();
    }
    return { pts: out.map((q) => [un(q[0]), un(q[1])]) };
  }).filter((L) => L.pts.length >= 3);

  const nSeg = ax.length;
  const maxSeg = opts.maxSegments ?? 260000;
  if (nSeg > maxSeg) {
    return { loops: null, stats: { segments: nSeg, tooBig: true, limit: maxSeg, ms: now() - t0 } };
  }

  /* -- 2. find split parameters -------------------------------------- */
  const splits = new Array(nSeg);
  for (let i = 0; i < nSeg; i++) splits[i] = null;
  // Each intersection is rounded to the grid ONCE and that same integer point
  // is inserted into both segments. Rounding the two parameters independently
  // is what tears a planar arrangement apart: the two copies of one crossing
  // land a quantum away from each other and the graph never closes.
  let splitCount = 0;
  const addSplit = (i, t, x, y) => {
    if (t <= 1e-9 || t >= 1 - 1e-9) return;
    splitCount++;
    (splits[i] || (splits[i] = [])).push([t, x, y]);
  };

  // uniform grid over segments
  const spanX = Math.max(1, qi(x1) - qi(x0));
  const spanY = Math.max(1, qi(y1) - qi(y0));
  const cellsTarget = Math.max(8, Math.min(420, Math.round(Math.sqrt(nSeg))));
  const csx = spanX / cellsTarget, csy = spanY / cellsTarget;
  const buckets = new Map();
  const bkey = (i, j) => i * 1000003 + j;
  const gx0 = qi(x0), gy0 = qi(y0);
  // Per-segment cell ranges are kept so a pair can be tested in exactly one
  // cell (see below); a long chord spans hundreds of cells and would otherwise
  // be re-tested against the same partner once per shared cell.
  const ci0 = new Int32Array(nSeg), ci1 = new Int32Array(nSeg);
  const cj0 = new Int32Array(nSeg), cj1 = new Int32Array(nSeg);
  for (let s = 0; s < nSeg; s++) {
    const i0 = Math.floor((Math.min(ax[s], bx[s]) - gx0) / csx);
    const i1 = Math.floor((Math.max(ax[s], bx[s]) - gx0) / csx);
    const j0 = Math.floor((Math.min(ay[s], by[s]) - gy0) / csy);
    const j1 = Math.floor((Math.max(ay[s], by[s]) - gy0) / csy);
    ci0[s] = i0; ci1[s] = i1; cj0[s] = j0; cj1[s] = j1;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = bkey(i, j);
        let arr = buckets.get(k);
        if (!arr) { arr = []; buckets.set(k, arr); }
        arr.push(s);
      }
    }
  }

  // Pair de-duplication without a hash set: two segments that share any cell
  // also share the low corner of the intersection of their cell ranges, and
  // that corner is unique to the pair. Test there and nowhere else. This keeps
  // splitCount an honest count of real crossings — which matters, because the
  // safety guard below is expressed in those units.
  const epsQ = 1.0; // one quantisation unit, in integer space
  const maxSplits = opts.maxSplits ?? 900000;
  // Wall-clock guard: a pathological arrangement can spend tens of seconds in
  // pair tests before the split budget trips. Check the clock every few
  // thousand pairs and give up early with the same fallback.
  const maxMs = opts.maxMs ?? Infinity;
  let pairTests = 0, timedOut = false;
  let overBudget = false;
  for (const [k, arr] of buckets) {
    const ci = Math.floor(k / 1000003), cj = k - ci * 1000003;
    const m = arr.length;
    for (let a = 0; a < m; a++) {
      if (overBudget || splitCount > maxSplits) { overBudget = true; break; }
      const s = arr[a];
      for (let b = a + 1; b < m; b++) {
        const t = arr[b];
        // owning cell = low corner of the overlap of the two cell ranges
        if ((ci0[s] > ci0[t] ? ci0[s] : ci0[t]) !== ci) continue;
        if ((cj0[s] > cj0[t] ? cj0[s] : cj0[t]) !== cj) continue;
        if ((++pairTests & 8191) === 0 && now() - t0 > maxMs) { timedOut = true; overBudget = true; break; }
        intersectPair(s, t);
        nearTouch(s, t);
        nearTouch(t, s);
      }
    }
    if (overBudget) break;
  }
  // A figure of a few hundred long mutually-crossing chords generates
  // hundreds of thousands of splits. Bail out rather than grind: the design
  // falls back to raw contours with a visible warning.
  if (timedOut) {
    return { loops: null, stats: { segments: nSeg, splits: splitCount, tooBig: true, timedOut: true, limit: maxSeg, ms: now() - t0 } };
  }
  if (splitCount > maxSplits) {
    return { loops: null, stats: { segments: nSeg, splits: splitCount, tooBig: true, limit: maxSplits, ms: now() - t0 } };
  }

  /* -- 2b. near-touch T-junctions -------------------------------------- */
  // Two contours can pass within a quantum of each other without formally
  // intersecting — offset outlines and filleted cells do it constantly. If a
  // vertex of `s` sits that close to the interior of `t`, treat it as a real
  // junction and split `t` there, otherwise the arrangement is left torn.
  //
  // Runs inside the pair loop above, on the same once-per-pair schedule. It
  // used to be a separate all-pairs-per-bucket sweep with a string-keyed Set,
  // which on figures of a few hundred long mutually-crossing chords cost
  // ~56 seconds on its own.
  function nearTouch(s, t) {
    const NEAR_TOL = 2;                      // quanta
    const dx = bx[t] - ax[t], dy = by[t] - ay[t];
    const L2 = dx * dx + dy * dy;
    if (!L2) return;
    for (let which = 0; which < 2; which++) {
      const vx = which ? bx[s] : ax[s];
      const vy = which ? by[s] : ay[s];
      const u = ((vx - ax[t]) * dx + (vy - ay[t]) * dy) / L2;
      if (u <= 1e-9 || u >= 1 - 1e-9) continue;
      const px = ax[t] + dx * u, py = ay[t] + dy * u;
      if (Math.abs(px - vx) > NEAR_TOL || Math.abs(py - vy) > NEAR_TOL) continue;
      addSplit(t, u, vx, vy);
    }
  }

  function intersectPair(s, t) {
    const p0x = ax[s], p0y = ay[s], rX = bx[s] - ax[s], rY = by[s] - ay[s];
    const q0x = ax[t], q0y = ay[t], sX = bx[t] - ax[t], sY = by[t] - ay[t];
    const denom = rX * sY - rY * sX;
    const qpX = q0x - p0x, qpY = q0y - p0y;
    if (Math.abs(denom) > 1e-9) {
      const tt = (qpX * sY - qpY * sX) / denom;
      const uu = (qpX * rY - qpY * rX) / denom;
      if (tt > -1e-9 && tt < 1 + 1e-9 && uu > -1e-9 && uu < 1 + 1e-9) {
        // If the crossing lands on an existing endpoint, adopt that endpoint
        // verbatim instead of re-rounding it to a neighbouring grid cell.
        let ix, iy;
        if (uu < 1e-7) { ix = q0x; iy = q0y; }
        else if (uu > 1 - 1e-7) { ix = q0x + sX; iy = q0y + sY; }
        else if (tt < 1e-7) { ix = p0x; iy = p0y; }
        else if (tt > 1 - 1e-7) { ix = p0x + rX; iy = p0y + rY; }
        else { ix = Math.round(p0x + rX * tt); iy = Math.round(p0y + rY * tt); }
        addSplit(s, tt, ix, iy);
        addSplit(t, uu, ix, iy);
      }
      return;
    }
    // parallel — collinear overlap?
    const cross = qpX * rY - qpY * rX;
    const rLen = Math.hypot(rX, rY) || 1;
    if (Math.abs(cross) / rLen > epsQ) return;
    const rr = rX * rX + rY * rY;
    const ss = sX * sX + sY * sY;
    // Collinear overlap: the split points are the *other* segment's endpoints,
    // which are already exact grid vertices.
    if (rr > 0) {
      addSplit(s, (qpX * rX + qpY * rY) / rr, q0x, q0y);
      addSplit(s, ((q0x + sX - p0x) * rX + (q0y + sY - p0y) * rY) / rr, q0x + sX, q0y + sY);
    }
    if (ss > 0) {
      addSplit(t, ((p0x - q0x) * sX + (p0y - q0y) * sY) / ss, p0x, p0y);
      addSplit(t, ((p0x + rX - q0x) * sX + (p0y + rY - q0y) * sY) / ss, p0x + rX, p0y + rY);
    }
  }

  /* -- 3. split into sub-segments ------------------------------------- */
  // Every sub-segment endpoint is an exact grid vertex that both participating
  // segments agree on, so the pieces stitch back together with no gaps.
  const rawA = [], rawB = [], rawFrame = [];
  const pushRaw = (x1i, y1i, x2i, y2i, layer) => {
    if (x1i === x2i && y1i === y2i) return;
    rawA.push(x1i, y1i); rawB.push(x2i, y2i);
    rawFrame.push(layer === 'frame');
  };
  for (let s = 0; s < nSeg; s++) {
    const ts = splits[s];
    if (!ts) { pushRaw(ax[s], ay[s], bx[s], by[s], seglayer[s]); continue; }
    ts.sort((p, q) => p[0] - q[0]);
    let px = ax[s], py = ay[s];
    for (let i = 0; i < ts.length; i++) {
      const nx = ts[i][1], ny = ts[i][2];
      if (nx === px && ny === py) continue;
      pushRaw(px, py, nx, ny, seglayer[s]);
      px = nx; py = ny;
    }
    pushRaw(px, py, bx[s], by[s], seglayer[s]);
  }

  /* -- 3b. intern vertices --------------------------------------------- */
  // Coordinates are already exact integers agreed on by every segment that
  // touches them, so interning by key is all the "snapping" that is needed.
  const SNAP = opts.snap ?? 1;                 // tolerance for T-junction repair only
  const canon = new Map();
  const snapGrid = new Map();
  const cellOf = (x, y) => Math.floor(x / 64) * 1000003 + Math.floor(y / 64);
  const snapVert = (x, y) => {
    const kk = x + ',' + y;
    let v = canon.get(kk);
    if (v) return v;
    v = [x, y];
    canon.set(kk, v);
    const ck = cellOf(x, y);
    let arr = snapGrid.get(ck);
    if (!arr) { arr = []; snapGrid.set(ck, arr); }
    arr.push(v);
    return v;
  };

  const vKey = (x, y) => x * 8388608 + y;
  const vertX = new Map();   // key -> [x, y] in integer space
  const edgeMap = new Map(); // key -> { u, v, frameOnly }
  const addEdge = (A, B, isFrame) => {
    if (A[0] === B[0] && A[1] === B[1]) return;
    const k1 = vKey(A[0], A[1]), k2 = vKey(B[0], B[1]);
    if (!vertX.has(k1)) vertX.set(k1, A);
    if (!vertX.has(k2)) vertX.set(k2, B);
    const ek = k1 < k2 ? k1 + '|' + k2 : k2 + '|' + k1;
    const prev = edgeMap.get(ek);
    if (prev) { prev.frameOnly = prev.frameOnly && isFrame; return; }
    edgeMap.set(ek, { u: k1 < k2 ? k1 : k2, v: k1 < k2 ? k2 : k1, frameOnly: isFrame });
  };

  // Every T-junction is already an exact shared vertex: when a crossing lands
  // on a segment endpoint the intersection routine adopts that endpoint
  // verbatim and inserts it as a split on the other segment. So no separate
  // repair pass is needed — the edges go straight into the graph.
  for (let i = 0; i < rawFrame.length; i++) {
    const A = snapVert(rawA[i * 2], rawA[i * 2 + 1]);
    const B = snapVert(rawB[i * 2], rawB[i * 2 + 1]);
    addEdge(A, B, rawFrame[i]);
  }

  /* -- 4. build the full half-edge graph ------------------------------ */
  // Two half-edges per undirected edge. Faces lie to the LEFT of each
  // half-edge, so walking the successor relation enumerates every face of the
  // arrangement — material and void alike.
  const HE_FROM = [], HE_TO = [], HE_ANG = [], HE_FRAME = [];
  const edgeList = [...edgeMap.values()];
  for (const e of edgeList) {
    const A = vertX.get(e.u), B = vertX.get(e.v);
    const ang = Math.atan2(B[1] - A[1], B[0] - A[0]);
    HE_FROM.push(e.u, e.v);
    HE_TO.push(e.v, e.u);
    HE_ANG.push(ang, ang > 0 ? ang - Math.PI : ang + Math.PI);
    HE_FRAME.push(e.frameOnly, e.frameOnly);
  }
  const nHE = HE_FROM.length;
  const twin = (i) => i ^ 1;

  const outgoing = new Map();
  for (let i = 0; i < nHE; i++) {
    let arr = outgoing.get(HE_FROM[i]);
    if (!arr) { arr = []; outgoing.set(HE_FROM[i], arr); }
    arr.push(i);
  }
  for (const arr of outgoing.values()) arr.sort((a, b) => HE_ANG[a] - HE_ANG[b]);

  // successor = first outgoing half-edge clockwise from the reverse of the
  // arriving one. On a complete half-edge set this is exactly the "next edge
  // of the face on the left", and it is a bijection — so the half-edges
  // partition perfectly into closed face cycles with no torn walks possible.
  const successor = new Int32Array(nHE).fill(-1);
  for (let i = 0; i < nHE; i++) {
    const arr = outgoing.get(HE_TO[i]);
    if (!arr || !arr.length) continue;
    const back = HE_ANG[i] > 0 ? HE_ANG[i] - Math.PI : HE_ANG[i] + Math.PI;
    let best = -1, bestD = Infinity;
    for (const j of arr) {
      let d = back - HE_ANG[j];
      d = ((d % TAU) + TAU) % TAU;
      if (d < 1e-12) d = TAU;                     // folding straight back is last resort
      if (d < bestD) { bestD = d; best = j; }
    }
    successor[i] = best;
  }

  /* -- 5. enumerate faces and classify each ONCE ----------------------- */
  // Classifying per face rather than per edge is what makes this robust: a
  // face is either material or void, so two edges of the same face can never
  // disagree, and vertex degrees stay balanced by construction even when the
  // arrangement contains micron-scale slivers.
  const faceOf = new Int32Array(nHE).fill(-1);
  const faces = [];
  for (let s = 0; s < nHE; s++) {
    if (faceOf[s] >= 0) continue;
    const id = faces.length;
    const cycle = [];
    let cur = s, guard = 0;
    while (cur >= 0 && faceOf[cur] < 0 && guard++ <= nHE) {
      faceOf[cur] = id;
      cycle.push(cur);
      cur = successor[cur];
    }
    faces.push(cycle);
  }

  const fillAt2 = makeFillOracle(qsrc, bbox, rule);

  const faceFill = new Uint8Array(faces.length);
  for (let f = 0; f < faces.length; f++) {
    const cycle = faces[f];
    if (cycle.length < 2) continue;
    const ring = cycle.map((i) => {
      const c = vertX.get(HE_FROM[i]);
      return [un(c[0]), un(c[1])];
    });
    const area = polygonArea(ring);
    // Probe just inside the face, off the midpoint of its longest edges.
    // Longest first so the offset is always small relative to the feature.
    const order = cycle.map((i, k) => {
      const A = vertX.get(HE_FROM[i]), B = vertX.get(HE_TO[i]);
      return [k, Math.hypot(B[0] - A[0], B[1] - A[1])];
    }).sort((a, b) => b[1] - a[1]);
    let probe = null, fallback = null;
    for (let t = 0; t < Math.min(24, order.length); t++) {
      const k = order[t][0];
      const i = cycle[k];
      const A = vertX.get(HE_FROM[i]), B = vertX.get(HE_TO[i]);
      const ax2 = un(A[0]), ay2 = un(A[1]), bx2 = un(B[0]), by2 = un(B[1]);
      const dx = bx2 - ax2, dy = by2 - ay2;
      const L = Math.hypot(dx, dy);
      if (L < eps) continue;
      // Stay *just* inside the face. The oracle is evaluated against the same
      // quantised geometry, so a couple of microns is unambiguous — while a
      // large offset can hop clean across a thin face and misclassify it.
      const d = Math.max(2 * eps, Math.min(L / 4, 4 * eps));
      const p = [(ax2 + bx2) / 2 - (dy / L) * d, (ay2 + by2) / 2 + (dx / L) * d];
      if (!fallback) fallback = p;
      // the point must actually be in this face: inside the ring for a
      // positively-wound cycle, outside it for a negatively-wound one
      if (ring.length >= 3 && pointInRing(p, ring) !== (area > 0)) continue;
      probe = p;
      break;
    }
    // Never silently default to "void": on a self-touching cycle the
    // containment check can reject every candidate, and defaulting would
    // delete a whole region of the part.
    const use = probe || fallback;
    faceFill[f] = use ? (fillAt2(use[0], use[1]) ? 1 : 0) : 0;
  }

  /* -- 6. keep material→void boundaries and trace them ------------------ */
  const keep = new Int32Array(nHE).fill(-1);
  const kept = [];
  for (let i = 0; i < nHE; i++) {
    const f = faceOf[i], g = faceOf[twin(i)];
    if (f < 0 || g < 0) continue;
    if (faceFill[f] && !faceFill[g]) { keep[i] = kept.length; kept.push(i); }
  }

  const outAdj = new Map();
  for (const i of kept) {
    let arr = outAdj.get(HE_FROM[i]);
    if (!arr) { arr = []; outAdj.set(HE_FROM[i], arr); }
    arr.push(i);
  }
  for (const arr of outAdj.values()) arr.sort((a, b) => HE_ANG[a] - HE_ANG[b]);

  const succ2 = new Map();
  for (const i of kept) {
    const arr = outAdj.get(HE_TO[i]);
    if (!arr || !arr.length) continue;
    const back = HE_ANG[i] > 0 ? HE_ANG[i] - Math.PI : HE_ANG[i] + Math.PI;
    let best = -1, bestD = Infinity;
    for (const j of arr) {
      let d = back - HE_ANG[j];
      d = ((d % TAU) + TAU) % TAU;
      if (d < 1e-12) d = TAU;
      if (d < bestD) { bestD = d; best = j; }
    }
    succ2.set(i, best);
  }

  const used = new Set();
  const outLoops = [];
  let openChains = 0, openEdges = 0;
  const minArea = opts.minArea ?? 1e-4;
  for (const s of kept) {
    if (used.has(s)) continue;
    const chain = [];
    // A contour stays on the frame layer only if every one of its edges came
    // from frame geometry. The moment the frame merges with the pattern they
    // are one physical body, so the whole thing belongs on the cut layer.
    let frameOnly = true;
    let cur = s, guard = 0, closed = false;
    while (cur !== undefined && cur >= 0 && guard++ <= kept.length + 2) {
      if (used.has(cur)) { closed = cur === s; break; }
      used.add(cur);
      chain.push(HE_FROM[cur]);
      if (!HE_FRAME[cur]) frameOnly = false;
      cur = succ2.get(cur);
      if (cur === s) { closed = true; break; }
    }
    if (!closed) { openChains++; openEdges += chain.length; continue; }
    if (chain.length < 3) continue;
    const pts = chain.map((k) => { const c = vertX.get(k); return [un(c[0]), un(c[1])]; });
    if (Math.abs(polygonArea(pts)) < minArea) continue;
    outLoops.push({ pts, closed: true, kind: 'region', layer: frameOnly ? 'frame' : 'cut' });
  }

  // A vertex where the material/void classification is inconsistent leaves a
  // boundary edge with no successor, and the walk from it dies in mid-air.
  // A handful of those is survivable — they are dropped and the region is off
  // by slivers. A large fraction is not: the traced result can come back as a
  // single outer contour with a solid interior, which looks like a black disc
  // and would be cut as one. Refuse to return that; the caller falls back to
  // the untrimmed contours and says so.
  if (kept.length && openEdges / kept.length > 0.25) {
    return {
      loops: null,
      stats: { segments: nSeg, edges: nHE / 2, faces: faces.length, torn: true,
               openChains, openEdges, boundary: kept.length, ms: now() - t0 },
    };
  }

  return {
    loops: outLoops,
    stats: {
      segments: nSeg,
      edges: edgeMap.size,
      faces: faces.length,
      boundary: kept.length,
      openChains,
      openEdges,
      in: loops.length,
      out: outLoops.length,
      ms: now() - t0,
      splits: splitCount,
    },
  };
}

/** Even–odd point-in-polygon on a raw point ring. */
function pointInRing(p, ring) {
  let inside = false;
  const x = p[0], y = p[1];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/**
 * Normalise contour windings from even-odd nesting to nonzero:
 * even depth -> CCW (adds material), odd depth -> CW (subtracts).
 * After this, overlapping ribbons union instead of cancelling, while nested
 * rings still cut holes.
 */
export function normaliseWindings(loops, depth) {
  return loops.map((L, i) => {
    // Ribbon outlines already know which way round they go; nesting depth is
    // only a reliable guide for contours that are genuinely nested.
    if (L.fixedWinding) return L;
    const ccw = (depth[i] % 2) === 0;
    const isCcw = polygonArea(L.pts) > 0;
    return isCcw === ccw ? L : { ...L, pts: L.pts.slice().reverse() };
  });
}
