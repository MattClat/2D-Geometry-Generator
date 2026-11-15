/* =========================================================================
 * modifiers.js — parametric modification & distortion stack
 *
 * Every engine's raw output passes through this pipeline:
 *
 *   motif  ->  symmetry / tiling array  ->  deformation fields  ->  profile
 *
 * Deformation is applied per-point, so paths are re-sampled first: a straight
 * line through a bulge field must become a curve, not stay straight.
 * =======================================================================*/
import {
  add, sub, mul, rot, len, dist, norm, clamp, lerp, TAU, EPS,
  resample, densify, fillet, simplify, regularPolygonPts, clipPolygonToConvex,
  clipPolylineToPolygon, pointInPolygon, polygonArea,
} from './geom.js';

export const SYMMETRY_MODES = [
  { v: 'none', label: 'Single field' },
  { v: 'cartesian', label: 'Cartesian X × Y' },
  { v: 'polar', label: 'Polar radial (n-fold)' },
  { v: 'hex', label: 'Hexagonal' },
  { v: 'tri', label: 'Triangular' },
  { v: 'brick', label: 'Half-drop brick' },
];

/**
 * Domain the engine should draw into, given the symmetry settings.
 * Returns { w, h, clip } where `clip` (optional) is a convex boundary polygon.
 */
export function motifDomain(M, W, H) {
  switch (M.symmetry) {
    case 'cartesian':
    case 'brick': {
      const nx = Math.max(1, M.tileX | 0), ny = Math.max(1, M.tileY | 0);
      const cw = W / nx, ch = H / ny;
      // clip to the cell so an engine's own internal tiling cannot bleed into
      // the neighbouring copies of the motif
      return { w: cw, h: ch, clip: [[-cw / 2, -ch / 2], [cw / 2, -ch / 2], [cw / 2, ch / 2], [-cw / 2, ch / 2]] };
    }
    case 'polar': {
      const n = Math.max(1, M.fold | 0);
      const R = Math.min(W, H) / 2;
      const half = Math.PI / n;
      const clip = [
        [0, 0],
        [Math.cos(-half) * R * 1.6, Math.sin(-half) * R * 1.6],
        [R * 1.7, 0],
        [Math.cos(half) * R * 1.6, Math.sin(half) * R * 1.6],
      ];
      return { w: R * 2.2, h: R * 2.2, clip: n >= 3 ? clip : null, polarR: R };
    }
    case 'hex': {
      const s = M.hexSize;
      return { w: s * 2, h: s * 2, clip: regularPolygonPts(0, 0, s, 6, Math.PI / 6) };
    }
    case 'tri': {
      const s = M.hexSize;
      return { w: s * 2, h: s * 2, clip: regularPolygonPts(0, 0, s, 3, Math.PI / 2) };
    }
    default:
      return { w: W, h: H, clip: null };
  }
}

/** Clip a path list to a convex boundary (regions are clipped, lines split). */
function clipPaths(paths, boundary) {
  if (!boundary) return paths;
  const out = [];
  for (const p of paths) {
    if (p.kind === 'region' || p.closed) {
      const c = clipPolygonToConvex(p.pts, boundary);
      if (c.length >= 3) out.push({ ...p, pts: c });
    } else {
      for (const run of clipPolylineToPolygon(p.pts, boundary)) {
        if (run.length > 1) out.push({ ...p, pts: run });
      }
    }
  }
  return out;
}

const xfPath = (p, fn) => ({ ...p, pts: p.pts.map(fn) });

/** Symmetry / tiling array. */
export function applySymmetry(paths, M, W, H, domain) {
  const out = [];
  const push = (fn) => { for (const p of paths) out.push(xfPath(p, fn)); };

  switch (M.symmetry) {
    case 'cartesian':
    case 'brick': {
      const nx = Math.max(1, M.tileX | 0), ny = Math.max(1, M.tileY | 0);
      const cw = W / nx, ch = H / ny;
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const halfDrop = M.symmetry === 'brick' && j % 2 ? cw / 2 : 0;
          const mx = M.mirrorX && i % 2 ? -1 : 1;
          const my = M.mirrorY && j % 2 ? -1 : 1;
          const ox = -W / 2 + (i + 0.5) * cw + halfDrop;
          const oy = -H / 2 + (j + 0.5) * ch;
          for (const p of paths) {
            const pts = p.pts.map(([x, y]) => {
              let q = [x * mx, y * my];
              return [q[0] + ox, q[1] + oy];
            });
            out.push({ ...p, pts: (mx * my < 0) ? pts.slice().reverse() : pts });
          }
        }
      }
      // wrap the half-drop row back into the sheet
      if (M.symmetry === 'brick') {
        for (let j = 1; j < ny; j += 2) {
          const cwj = W / nx;
          for (const p of paths) {
            const oy = -H / 2 + (j + 0.5) * ch;
            out.push(xfPath(p, ([x, y]) => [x - W / 2 - cwj / 2 + cwj * 0.5, y + oy]));
          }
        }
      }
      return out;
    }
    case 'polar': {
      const n = Math.max(1, M.fold | 0);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * TAU + (M.rotate * Math.PI) / 180;
        push(([x, y]) => rot([x, y], a));
        if (M.mirrorX) {
          for (const p of paths) {
            const pts = p.pts.map(([x, y]) => rot([x, -y], a + TAU / n));
            out.push({ ...p, pts: pts.slice().reverse() });
          }
        }
      }
      return out;
    }
    case 'hex': {
      const s = M.hexSize;
      const dx = s * Math.sqrt(3), dy = s * 1.5;
      const nx = Math.ceil(W / dx) + 1, ny = Math.ceil(H / dy) + 1;
      for (let j = -ny; j <= ny; j++) {
        for (let i = -nx; i <= nx; i++) {
          const ox = i * dx + (j % 2 ? dx / 2 : 0);
          const oy = j * dy;
          if (Math.abs(ox) > W / 2 + dx || Math.abs(oy) > H / 2 + dy) continue;
          push(([x, y]) => [x + ox, y + oy]);
        }
      }
      return out;
    }
    case 'tri': {
      const s = M.hexSize;
      const hgt = s * 1.5;
      const dx = s * Math.sqrt(3);
      const nx = Math.ceil(W / dx) + 1, ny = Math.ceil(H / hgt) + 1;
      for (let j = -ny; j <= ny; j++) {
        for (let i = -nx; i <= nx; i++) {
          const ox = i * dx + (j % 2 ? dx / 2 : 0);
          const oy = j * hgt;
          if (Math.abs(ox) > W / 2 + dx || Math.abs(oy) > H / 2 + hgt) continue;
          for (const flip of [0, 1]) {
            const a = flip ? Math.PI : 0;
            const shift = flip ? dx / 2 : 0;
            push(([x, y]) => {
              const q = rot([x, y], a);
              return [q[0] + ox + shift, q[1] + oy];
            });
          }
        }
      }
      return out;
    }
    default:
      return paths.slice();
  }
}

/* ------------------------------------------------------------------ *
 * Deformation fields
 * ------------------------------------------------------------------ */
export function buildDeformer(M, W, H, noise) {
  const R = Math.max(W, H) / 2;
  const active =
    Math.abs(M.bulge) > 1e-4 ||
    Math.abs(M.twirl) > 1e-4 ||
    M.turbulence > 1e-4 ||
    Math.abs(M.shearX) > 1e-4 ||
    Math.abs(M.shearY) > 1e-4 ||
    Math.abs(M.perspective) > 1e-4 ||
    Math.abs(M.wave) > 1e-4;
  if (!active) return null;

  return ([x, y]) => {
    let px = x, py = y;

    // --- spherical bulge / pinch (Vasarely) ---
    if (Math.abs(M.bulge) > 1e-4) {
      const r = Math.hypot(px, py);
      if (r > 1e-6) {
        const t = clamp(r / (R * M.fieldRadius), 0, 1);
        const k = 1 + M.bulge * (1 - t * t) * (1 - t * t);
        px *= k; py *= k;
      }
    }

    // --- twirl / vortex ---
    if (Math.abs(M.twirl) > 1e-4) {
      const r = Math.hypot(px, py);
      const t = clamp(1 - r / (R * M.fieldRadius), 0, 1);
      const a = M.twirl * TAU * t * t;
      const c = Math.cos(a), s = Math.sin(a);
      const nx = px * c - py * s, ny = px * s + py * c;
      px = nx; py = ny;
    }

    // --- perlin turbulence ---
    if (M.turbulence > 1e-4 && noise) {
      const f = M.turbFreq * 0.01;
      px += noise.fbm(px * f, py * f, 3) * M.turbulence;
      py += noise.fbm(px * f + 31.7, py * f - 12.3, 3) * M.turbulence;
    }

    // --- sinusoidal wave warp ---
    if (Math.abs(M.wave) > 1e-4) {
      const k = (M.waveFreq * TAU) / Math.max(W, H);
      px += Math.sin(py * k) * M.wave;
      py += Math.sin(px * k * 0.83) * M.wave * 0.5;
    }

    // --- shear + fake perspective ---
    if (Math.abs(M.shearX) > 1e-4) px += py * M.shearX;
    if (Math.abs(M.shearY) > 1e-4) py += px * M.shearY;
    if (Math.abs(M.perspective) > 1e-4) {
      const d = 1 + (M.perspective * py) / (H / 2);
      const s = 1 / Math.max(0.15, d);
      px *= s;
      py = (py * s + (H / 2) * (1 - s) * Math.sign(M.perspective) * 0);
    }
    return [px, py];
  };
}

/** Apply the deformation field, re-sampling first so curves survive. */
export function applyDeformation(paths, deform, detail = 1.4) {
  if (!deform) return paths;
  return paths.map((p) => {
    // densify, never resample: original vertices must survive so that shapes
    // sharing a corner still share it after the field is applied
    const dense = p.pts.length > 1 ? densify(p.pts, detail, p.closed) : p.pts;
    return { ...p, pts: dense.map(deform) };
  });
}

/* ------------------------------------------------------------------ *
 * Line weight & corner profile
 * ------------------------------------------------------------------ */
export function applyProfile(paths, M) {
  return paths.map((p) => {
    let pts = p.pts;
    if (M.corner > 0 && pts.length > 2) pts = fillet(pts, M.corner, p.closed);
    const width = p.width !== undefined ? p.width * M.weightScale : undefined;
    return { ...p, pts, width, taper: Math.max(p.taper || 0, M.taper || 0) };
  });
}

export const DEFAULT_MODIFIERS = {
  symmetry: 'none',
  tileX: 3,
  tileY: 3,
  fold: 8,
  hexSize: 40,
  mirrorX: false,
  mirrorY: false,
  rotate: 0,
  bulge: 0,
  twirl: 0,
  turbulence: 0,
  turbFreq: 1.2,
  wave: 0,
  waveFreq: 2,
  shearX: 0,
  shearY: 0,
  perspective: 0,
  fieldRadius: 1,
  weightScale: 1,
  taper: 0,
  corner: 0,
};

export const MODIFIER_SCHEMA = [
  { group: 'Grid & Symmetry', items: [
    { key: 'symmetry', label: 'Tiling mode', type: 'select', options: SYMMETRY_MODES, def: 'none' },
    { key: 'tileX', label: 'Tiles X', type: 'range', min: 1, max: 12, step: 1, int: true, def: 3, when: (M) => M.symmetry === 'cartesian' || M.symmetry === 'brick' },
    { key: 'tileY', label: 'Tiles Y', type: 'range', min: 1, max: 12, step: 1, int: true, def: 3, when: (M) => M.symmetry === 'cartesian' || M.symmetry === 'brick' },
    { key: 'fold', label: 'Radial fold', type: 'range', min: 2, max: 32, step: 1, int: true, def: 8, when: (M) => M.symmetry === 'polar' },
    { key: 'hexSize', label: 'Cell size', type: 'range', min: 8, max: 120, step: 0.5, def: 40, unit: 'mm', when: (M) => M.symmetry === 'hex' || M.symmetry === 'tri' },
    { key: 'mirrorX', label: 'Mirror alternate', type: 'toggle', def: false, when: (M) => M.symmetry !== 'none' },
    { key: 'mirrorY', label: 'Mirror rows', type: 'toggle', def: false, when: (M) => M.symmetry === 'cartesian' || M.symmetry === 'brick' },
    { key: 'rotate', label: 'Array rotation', type: 'range', min: -180, max: 180, step: 1, def: 0, unit: '°', when: (M) => M.symmetry === 'polar' },
  ] },
  { group: 'Deformation Fields', items: [
    { key: 'bulge', label: 'Spherical bulge / pinch', type: 'range', min: -0.9, max: 1.6, step: 0.01, def: 0 },
    { key: 'twirl', label: 'Twirl / vortex', type: 'range', min: -2, max: 2, step: 0.01, def: 0, unit: 'turns' },
    { key: 'turbulence', label: 'Perlin turbulence', type: 'range', min: 0, max: 40, step: 0.2, def: 0, unit: 'mm' },
    { key: 'turbFreq', label: 'Turbulence scale', type: 'range', min: 0.1, max: 8, step: 0.05, def: 1.2 },
    { key: 'wave', label: 'Wave warp', type: 'range', min: -40, max: 40, step: 0.5, def: 0, unit: 'mm' },
    { key: 'waveFreq', label: 'Wave frequency', type: 'range', min: 0.2, max: 12, step: 0.1, def: 2 },
    { key: 'shearX', label: 'Shear X', type: 'range', min: -1.2, max: 1.2, step: 0.01, def: 0 },
    { key: 'shearY', label: 'Shear Y', type: 'range', min: -1.2, max: 1.2, step: 0.01, def: 0 },
    { key: 'perspective', label: 'Perspective', type: 'range', min: -0.9, max: 0.9, step: 0.01, def: 0 },
    { key: 'fieldRadius', label: 'Field radius', type: 'range', min: 0.3, max: 2.5, step: 0.01, def: 1, unit: '×' },
  ] },
  { group: 'Line Weight & Profile', items: [
    { key: 'weightScale', label: 'Stroke weight', type: 'range', min: 0.15, max: 4, step: 0.01, def: 1, unit: '×' },
    { key: 'taper', label: 'Variable width', type: 'range', min: 0, max: 1, step: 0.01, def: 0 },
    { key: 'corner', label: 'Corner fillet', type: 'range', min: 0, max: 12, step: 0.1, def: 0, unit: 'mm' },
  ] },
];
