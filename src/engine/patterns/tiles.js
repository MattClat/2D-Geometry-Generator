/* =========================================================================
 * tiles.js — B. Architectural tiles & modern encaustic
 *
 *   encaustic    Moroccan / cement-tile medallions (quatrefoil, 8-point star
 *                strapwork, petal circles, gothic tracery, rosette)
 *   herringbone  Herringbone / chevron / parquet plank fields
 *   brickwork    Running-bond, stack, basketweave & subway masonry
 * =======================================================================*/
import {
  add, sub, mul, dist, norm, len, lerp, rot, TAU, EPS,
  circlePts, arcPts, starPts, rectPts, roundedRectPts, regularPolygonPts,
  centerline, region, fillet, dedupe, clamp,
} from '../geom.js';
import { R, I, T, S, gridCells } from './common.js';

/* ---------- motif primitives (local coords, cell centred on origin) ------ */

/** Lens / petal built from two circular arcs meeting at tip and base. */
function petalPts(cx, cy, ang, length, width) {
  // control the bulge: two arcs of radius rr through the two endpoints
  const tip = [cx + Math.cos(ang) * length, cy + Math.sin(ang) * length];
  const base = [cx, cy];
  const d = length;
  const bulge = Math.max(width, 1e-3) / 2;
  const rr = (bulge * bulge + (d * d) / 4) / (2 * bulge);
  const mid = lerp(base, tip, 0.5);
  const nrm = [-Math.sin(ang), Math.cos(ang)];
  const out = [];
  for (const s of [1, -1]) {
    const c = [mid[0] - nrm[0] * s * (rr - bulge), mid[1] - nrm[1] * s * (rr - bulge)];
    const a0 = Math.atan2(base[1] - c[1], base[0] - c[0]);
    const a1 = Math.atan2(tip[1] - c[1], tip[0] - c[0]);
    let sweep = a1 - a0;
    while (sweep > Math.PI) sweep -= TAU;
    while (sweep < -Math.PI) sweep += TAU;
    const seg = arcPts(c[0], c[1], rr, a0, a0 + sweep, Math.max(6, Math.ceil(Math.abs(sweep) * rr / 0.3)));
    out.push(...(s === 1 ? seg : seg.slice().reverse()));
  }
  return dedupe(out, 1e-5);
}

/** Scalloped (cloud) square — the signature encaustic border. */
function scallopedSquare(s, lobes, depth) {
  const half = s / 2;
  const out = [];
  const per = Math.max(1, lobes | 0);
  for (let side = 0; side < 4; side++) {
    const a = rot([-half, -half], (side * Math.PI) / 2);
    const b = rot([half, -half], (side * Math.PI) / 2);
    for (let k = 0; k < per; k++) {
      const p0 = lerp(a, b, k / per);
      const p1 = lerp(a, b, (k + 1) / per);
      const chord = dist(p0, p1);
      const bulge = chord * depth;
      const rr = (bulge * bulge + (chord * chord) / 4) / (2 * bulge || EPS);
      const mid = lerp(p0, p1, 0.5);
      const dir = norm(sub(p1, p0));
      const nrm = [-dir[1], dir[0]];
      const c = [mid[0] + nrm[0] * (rr - bulge), mid[1] + nrm[1] * (rr - bulge)];
      const a0 = Math.atan2(p0[1] - c[1], p0[0] - c[0]);
      const a1 = Math.atan2(p1[1] - c[1], p1[0] - c[0]);
      let sweep = a1 - a0;
      while (sweep > Math.PI) sweep -= TAU;
      while (sweep < -Math.PI) sweep += TAU;
      out.push(...arcPts(c[0], c[1], rr, a0, a0 + sweep).slice(0, -1));
    }
  }
  return out;
}

/** Pointed gothic arch outline (two arcs + jambs). */
function gothicArch(w, h, riseRatio = 0.62) {
  const half = w / 2;
  const springY = -h / 2 + h * (1 - riseRatio);
  const r = w; // equilateral arch
  const apexY = springY + Math.sqrt(Math.max(0, r * r - w * w)) || springY + h * riseRatio;
  const left = arcPts(half, springY, r, Math.PI, Math.PI - Math.acos(clamp((half) / r, -1, 1)) * 0 - 0, 1);
  // build explicitly: right arc centred at (-half, springY), left arc centred at (half, springY)
  const apex = [0, springY + Math.sqrt(Math.max(1e-6, r * r - half * half))];
  const aR0 = Math.atan2(0 - springY, half - (-half));
  const arcR = arcPts(-half, springY, r,
    Math.atan2(springY - springY, half - (-half)),
    Math.atan2(apex[1] - springY, apex[0] + half));
  const arcL = arcPts(half, springY, r,
    Math.atan2(apex[1] - springY, apex[0] - half),
    Math.PI);
  return dedupe([
    [-half, -h / 2], [half, -h / 2], [half, springY],
    ...arcR, ...arcL,
    [-half, springY],
  ], 1e-5);
}

/* ---------------- motif generators ---------------- */
const MOTIFS = {
  quatrefoil(s, P, rng) {
    const cut = [], score = [];
    const half = s / 2;
    const r = s * 0.26 * P.scale;
    const d = s * 0.19 * P.scale;
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * TAU + Math.PI / 4;
      cut.push(circlePts(Math.cos(a) * d, Math.sin(a) * d, r));
    }
    cut.push(circlePts(0, 0, r * 0.55));
    if (P.border > 0) {
      cut.push(rectPts(-half, -half, s, s));
      cut.push(rectPts(-half + s * P.border, -half + s * P.border, s * (1 - 2 * P.border), s * (1 - 2 * P.border)));
    }
    if (P.detail) {
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * TAU;
        score.push([[Math.cos(a) * half * 0.9, Math.sin(a) * half * 0.9], [Math.cos(a) * d * 0.4, Math.sin(a) * d * 0.4]]);
      }
    }
    return { cut, score };
  },

  star8(s, P, rng) {
    const cut = [], score = [];
    const half = s / 2;
    const R = half * 0.94 * P.scale;
    const inner = R * 0.7654;
    cut.push(starPts(0, 0, R, inner, 8, Math.PI / 8));
    cut.push(starPts(0, 0, R * 0.62, inner * 0.62, 8, Math.PI / 8));
    cut.push(regularPolygonPts(0, 0, R * 0.3, 8, Math.PI / 8));
    // Andalusian strapwork: interlaced band segments between star points
    if (P.detail) {
      for (let k = 0; k < 8; k++) {
        const a0 = Math.PI / 8 + (k / 8) * TAU;
        const a1 = a0 + TAU / 8;
        const p0 = [Math.cos(a0) * R, Math.sin(a0) * R];
        const p1 = [Math.cos(a1) * R, Math.sin(a1) * R];
        score.push([p0, p1]);
      }
    }
    if (P.border > 0) {
      cut.push(rectPts(-half, -half, s, s));
      cut.push(rectPts(-half + s * P.border, -half + s * P.border, s * (1 - 2 * P.border), s * (1 - 2 * P.border)));
    }
    return { cut, score };
  },

  petals(s, P, rng) {
    const cut = [], score = [];
    const half = s / 2;
    const n = Math.max(3, P.lobes | 0);
    const L = half * 0.9 * P.scale;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU + Math.PI / 2;
      cut.push(petalPts(0, 0, a, L, L * 0.5));
    }
    cut.push(circlePts(0, 0, L * 0.17));
    if (P.detail) {
      for (let k = 0; k < n; k++) {
        const a = (k / n) * TAU + Math.PI / 2 + Math.PI / n;
        cut.push(petalPts(0, 0, a, L * 0.5, L * 0.24));
      }
    }
    if (P.border > 0) cut.push(scallopedSquare(s * (1 - P.border), Math.max(1, (P.lobes / 2) | 0), 0.16));
    return { cut, score };
  },

  rosette(s, P, rng) {
    const cut = [], score = [];
    const half = s / 2;
    const n = Math.max(4, P.lobes | 0);
    const R = half * 0.95 * P.scale;
    cut.push(circlePts(0, 0, R));
    cut.push(circlePts(0, 0, R * 0.9));
    // outer scallop ring
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU;
      cut.push(circlePts(Math.cos(a) * R * 0.74, Math.sin(a) * R * 0.74, R * Math.PI / n * 0.62));
    }
    // inner petal ring
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU + Math.PI / n;
      cut.push(petalPts(0, 0, a, R * 0.55, R * 0.2));
    }
    cut.push(circlePts(0, 0, R * 0.16));
    if (P.detail) {
      for (let k = 0; k < n * 2; k++) {
        const a = (k / (n * 2)) * TAU;
        score.push([[Math.cos(a) * R * 0.92, Math.sin(a) * R * 0.92], [Math.cos(a) * R * 0.78, Math.sin(a) * R * 0.78]]);
      }
    }
    return { cut, score };
  },

  tracery(s, P, rng) {
    const cut = [], score = [];
    const half = s / 2;
    const w = s * 0.86 * P.scale;
    cut.push(gothicArch(w, s * 0.94 * P.scale, 0.6));
    cut.push(gothicArch(w * 0.62, s * 0.68 * P.scale, 0.62).map((p) => [p[0], p[1] - s * 0.06]));
    const lobes = Math.max(2, (P.lobes / 2) | 0);
    for (let k = 0; k < lobes; k++) {
      const a = Math.PI * (0.15 + 0.7 * (lobes === 1 ? 0.5 : k / (lobes - 1)));
      cut.push(circlePts(Math.cos(a) * w * 0.24, s * 0.18 + Math.sin(a) * w * 0.12, w * 0.1));
    }
    if (P.border > 0) {
      cut.push(rectPts(-half, -half, s, s));
      cut.push(rectPts(-half + s * P.border, -half + s * P.border, s * (1 - 2 * P.border), s * (1 - 2 * P.border)));
    }
    return { cut, score };
  },

  pinwheel(s, P, rng) {
    const cut = [], score = [];
    const half = s / 2;
    const n = Math.max(3, P.lobes | 0);
    const R = half * 0.98 * P.scale;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU;
      const p0 = [0, 0];
      const p1 = [Math.cos(a) * R, Math.sin(a) * R];
      const p2 = [Math.cos(a + TAU / n) * R, Math.sin(a + TAU / n) * R];
      const mid = [Math.cos(a + TAU / n / 2) * R * 1.32, Math.sin(a + TAU / n / 2) * R * 1.32];
      if (k % 2 === 0) cut.push([p0, p1, mid, p2]);
    }
    cut.push(circlePts(0, 0, R * 0.22));
    if (P.border > 0) cut.push(rectPts(-half, -half, s, s));
    return { cut, score };
  },
};

export const encaustic = {
  id: 'encaustic',
  category: 'Architectural Tiles',
  name: 'Moroccan / Encaustic Tile',
  // Classical medallions are drawn as overlapping circles and petals whose
  // intersections punch back out — that is even-odd, not union.
  fillRule: 'evenodd',
  blurb: 'Cement-tile medallions: scalloped quatrefoils, Andalusian 8-point strapwork, petal circles, gothic tracery and rosettes.',
  params: [
    S('motif', 'Medallion', [
      { v: 'quatrefoil', label: 'Quatrefoil' },
      { v: 'star8', label: 'Andalusian star' },
      { v: 'petals', label: 'Petal circles' },
      { v: 'rosette', label: 'Rosette mandala' },
      { v: 'tracery', label: 'Gothic tracery' },
      { v: 'pinwheel', label: 'Pinwheel' },
    ], 'quatrefoil'),
    R('cell', 'Tile size', 12, 160, 52, 1, 'mm'),
    R('scale', 'Motif scale', 0.4, 1.3, 0.94, 0.01, '×'),
    I('lobes', 'Lobe count', 3, 24, 8),
    R('border', 'Border inset', 0, 0.22, 0.06, 0.005, '×'),
    R('fillet', 'Corner radius', 0, 8, 0, 0.1, 'mm'),
    T('detail', 'Score detail lines', true),
    S('patchwork', 'Cell variation', [
      { v: 'none', label: 'Uniform' },
      { v: 'rot', label: 'Random rotation' },
      { v: 'quarter', label: '4-way quarter-turn' },
      { v: 'mirror', label: 'Book-match mirror' },
    ], 'none'),
  ],
  generate(P, rng, ctx) {
    const { w, h } = ctx;
    const s = P.cell;
    const cells = gridCells(w, h, s, 1);
    const motif = MOTIFS[P.motif] || MOTIFS.quatrefoil;
    const out = [];
    for (const c of cells) {
      const { cut, score } = motif(s, P, rng);
      let ang = 0, mx = 1, my = 1;
      if (P.patchwork === 'rot') ang = rng.int(0, 3) * (Math.PI / 2);
      else if (P.patchwork === 'quarter') ang = ((c.i + c.j) % 4) * (Math.PI / 2);
      else if (P.patchwork === 'mirror') { mx = c.i % 2 ? -1 : 1; my = c.j % 2 ? -1 : 1; }
      const xf = (p) => {
        let q = [p[0] * mx, p[1] * my];
        if (ang) q = rot(q, ang);
        return [q[0] + c.x, q[1] + c.y];
      };
      for (const poly of cut) {
        let pts = poly.map(xf);
        if (P.fillet > 0) pts = fillet(pts, P.fillet, true);
        out.push(region(pts, { layer: 'cut' }));
      }
      for (const poly of score) {
        out.push(centerline(poly.map(xf), { layer: 'score', width: 0.6 }));
      }
    }
    return out;
  },
};

/* ------------------------------------------------------------------ *
 * 5. HERRINGBONE / CHEVRON / PARQUET
 * ------------------------------------------------------------------ */
export const herringbone = {
  id: 'herringbone',
  category: 'Architectural Tiles',
  name: 'Herringbone / Chevron / Parquet',
  blurb: 'Parametric interlocking plank fields — true herringbone lattice, mitred chevrons and block parquet.',
  params: [
    S('mode', 'Layout', [
      { v: 'herringbone', label: 'Herringbone' },
      { v: 'chevron', label: 'Chevron (mitred)' },
      { v: 'parquet', label: 'Block parquet' },
      { v: 'stepped', label: 'Stepped zig-zag' },
    ], 'herringbone'),
    R('plankL', 'Plank length', 8, 140, 48, 1, 'mm'),
    R('plankW', 'Plank width', 3, 60, 16, 0.5, 'mm'),
    R('gap', 'Joint gap', 0, 8, 1.4, 0.05, 'mm'),
    R('angle', 'Field rotation', -90, 90, 45, 1, '°'),
    R('chevAngle', 'Chevron angle', 15, 75, 45, 1, '°'),
    I('block', 'Planks per block', 2, 8, 4),
    R('fillet', 'Corner radius', 0, 10, 1, 0.1, 'mm'),
    S('style', 'Output', [
      { v: 'tiles', label: 'Plank outlines' },
      { v: 'grout', label: 'Joint lines only' },
    ], 'tiles'),
  ],
  generate(P, rng, ctx) {
    const { w, h } = ctx;
    const A = (P.angle * Math.PI) / 180;
    const diag = Math.hypot(w, h) * 0.85;
    const out = [];
    const L = P.plankL, W = P.plankW, g = P.gap;
    const xf = (p) => rot(p, A);
    const emit = (corners) => {
      let pts = corners;
      if (P.style === 'grout') {
        for (let i = 0; i < pts.length; i++) {
          out.push(centerline([xf(pts[i]), xf(pts[(i + 1) % pts.length])], { width: Math.max(0.4, g) }));
        }
      } else {
        if (P.fillet > 0) pts = fillet(pts, P.fillet, true);
        out.push(region(pts.map(xf), { layer: 'cut' }));
      }
    };
    const plank = (x, y, pw, ph) => {
      const ix = x + g / 2, iy = y + g / 2, iw = pw - g, ih = ph - g;
      if (iw <= 0 || ih <= 0) return;
      emit(rectPts(ix, iy, iw, ih));
    };

    if (P.mode === 'herringbone') {
      // lattice vectors derived so the two-plank motif tiles the plane exactly
      const a = [L + W, W];
      const b = [W - L, W];
      const n = Math.ceil(diag / Math.min(L, W)) + 2;
      for (let i = -n; i <= n; i++) {
        for (let j = -n; j <= n; j++) {
          const ox = i * a[0] + j * b[0];
          const oy = i * a[1] + j * b[1];
          if (Math.abs(ox) > diag + L * 2 || Math.abs(oy) > diag + L * 2) continue;
          plank(ox, oy, L, W);              // horizontal
          plank(ox + L, oy, W, L);          // vertical, butting its right end
        }
      }
      return out;
    }

    if (P.mode === 'chevron') {
      const th = (P.chevAngle * Math.PI) / 180;
      const dx = W / Math.sin(th);
      const rowH = L * Math.sin(th);
      const cols = Math.ceil(diag / dx) + 2;
      const rows = Math.ceil(diag / rowH) + 2;
      for (let r = -rows; r <= rows; r++) {
        for (let c = -cols; c <= cols; c++) {
          for (const side of [-1, 1]) {
            const shear = 1 / Math.tan(th) * side;
            const x0 = c * dx + (side < 0 ? -diag * 0 : 0);
            const y0 = r * rowH;
            const pts = [
              [x0 + g / 2, y0 + g / 2],
              [x0 + dx - g / 2, y0 + g / 2],
              [x0 + dx - g / 2 + shear * (rowH - g), y0 + rowH - g / 2],
              [x0 + g / 2 + shear * (rowH - g), y0 + rowH - g / 2],
            ].map((p) => [side > 0 ? p[0] : -p[0], p[1]]);
            const cx = pts.reduce((s2, p) => s2 + p[0], 0) / 4;
            if (side > 0 ? cx < -g : cx > g) continue;
            emit(pts);
          }
        }
      }
      return out;
    }

    if (P.mode === 'stepped') {
      const step = W;
      const cols = Math.ceil(diag / (W * 2)) + 2;
      const rows = Math.ceil(diag / W) + 2;
      for (let r = -rows; r <= rows; r++) {
        for (let c = -cols; c <= cols; c++) {
          const off = ((r % 8) + 8) % 8;
          const zig = off < 4 ? off : 8 - off;
          plank(c * L + zig * step, r * W, L, W);
        }
      }
      return out;
    }

    /* parquet: alternating blocks of parallel planks */
    const k = Math.max(1, P.block | 0);
    const blockSize = k * W;
    const nb = Math.ceil(diag / blockSize) + 2;
    for (let bj = -nb; bj <= nb; bj++) {
      for (let bi = -nb; bi <= nb; bi++) {
        const bx = bi * blockSize, by = bj * blockSize;
        const horiz = ((bi + bj) & 1) === 0;
        for (let m = 0; m < k; m++) {
          if (horiz) plank(bx, by + m * W, blockSize, W);
          else plank(bx + m * W, by, W, blockSize);
        }
      }
    }
    return out;
  },
};

/* ------------------------------------------------------------------ *
 * 6. BRICKWORK — modular block & masonry bonds
 * ------------------------------------------------------------------ */
export const brickwork = {
  id: 'brickwork',
  category: 'Architectural Tiles',
  name: 'Modular Block & Brickwork',
  blurb: 'Running-bond subway tile, stack bond, basketweave masonry and offset blocks with rounded corner fillets.',
  params: [
    S('bond', 'Bond', [
      { v: 'running', label: 'Running (subway)' },
      { v: 'stack', label: 'Stack bond' },
      { v: 'basket', label: 'Basketweave masonry' },
      { v: 'flemish', label: 'Flemish bond' },
      { v: 'randomAshlar', label: 'Random ashlar' },
    ], 'running'),
    R('brickW', 'Block length', 8, 160, 44, 1, 'mm'),
    R('brickH', 'Block height', 4, 80, 20, 0.5, 'mm'),
    R('gap', 'Mortar joint', 0.2, 10, 2, 0.05, 'mm'),
    R('offset', 'Course offset', 0, 1, 0.5, 0.01, '×'),
    R('fillet', 'Corner radius', 0, 12, 2, 0.1, 'mm'),
    R('angle', 'Field rotation', -90, 90, 0, 1, '°'),
    S('style', 'Output', [
      { v: 'tiles', label: 'Block outlines' },
      { v: 'grout', label: 'Mortar lines only' },
    ], 'tiles'),
  ],
  generate(P, rng, ctx) {
    const { w, h } = ctx;
    const A = (P.angle * Math.PI) / 180;
    const diag = Math.hypot(w, h) * 0.8;
    const out = [];
    const g = P.gap;
    const xf = (p) => rot(p, A);
    const emit = (x, y, bw, bh) => {
      const iw = bw - g, ih = bh - g;
      if (iw <= 0.2 || ih <= 0.2) return;
      if (P.style === 'grout') {
        const c = rectPts(x + g / 2, y + g / 2, iw, ih);
        for (let i = 0; i < 4; i++) out.push(centerline([xf(c[i]), xf(c[(i + 1) % 4])], { width: g }));
      } else {
        const pts = P.fillet > 0 ? roundedRectPts(x + g / 2, y + g / 2, iw, ih, P.fillet) : rectPts(x + g / 2, y + g / 2, iw, ih);
        out.push(region(pts.map(xf), { layer: 'cut' }));
      }
    };
    const rows = Math.ceil(diag / P.brickH) + 2;
    const cols = Math.ceil(diag / P.brickW) + 3;

    if (P.bond === 'basket') {
      const unit = P.brickW;
      const nH = Math.max(1, Math.round(P.brickW / P.brickH));
      const nb = Math.ceil(diag / unit) + 2;
      for (let j = -nb; j <= nb; j++) {
        for (let i = -nb; i <= nb; i++) {
          const bx = i * unit, by = j * unit;
          const horiz = ((i + j) & 1) === 0;
          for (let m = 0; m < nH; m++) {
            if (horiz) emit(bx, by + m * (unit / nH), unit, unit / nH);
            else emit(bx + m * (unit / nH), by, unit / nH, unit);
          }
        }
      }
      return out;
    }

    for (let r = -rows; r <= rows; r++) {
      const y = r * P.brickH;
      if (P.bond === 'randomAshlar') {
        let x = -diag;
        const rr = rng.fork(r + 977);
        while (x < diag) {
          const mult = rr.pick([1, 1, 1.5, 2, 2]);
          const bw = P.brickW * mult;
          emit(x, y, bw, P.brickH);
          x += bw;
        }
        continue;
      }
      let shift = 0;
      if (P.bond === 'running') shift = ((r % 2) + 2) % 2 * P.brickW * P.offset;
      else if (P.bond === 'flemish') shift = ((r % 2) + 2) % 2 * P.brickW * 0.25;
      for (let c = -cols; c <= cols; c++) {
        const x = c * P.brickW + shift;
        if (P.bond === 'flemish' && ((c + r) & 1)) {
          emit(x, y, P.brickW / 2, P.brickH);
          emit(x + P.brickW / 2, y, P.brickW / 2, P.brickH);
        } else emit(x, y, P.brickW, P.brickH);
      }
    }
    return out;
  },
};
