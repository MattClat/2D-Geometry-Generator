/* =========================================================================
 * retro.js — C. Retro, Memphis & modernist geometry
 *
 *   memphis   80s Memphis / Bauhaus procedural scatter (collision-free)
 *   isocubes  Isometric tumbling cubes, stepped pyramids, hex prisms
 *   opart     Radial sunbursts, vortex pinwheels, moiré webs, warp grids
 * =======================================================================*/
import {
  add, sub, mul, rot, lerp, TAU, clamp,
  circlePts, arcPts, rectPts, roundedRectPts, regularPolygonPts, starPts,
  centerline, region, dedupe, fillet,
} from '../geom.js';
import { R, I, T, S, poissonDisk, gridCells, chaikin } from './common.js';

/* ------------------------------------------------------------------ *
 * 7. MEMPHIS — procedural field scatter with collision avoidance
 * ------------------------------------------------------------------ */
const MEMPHIS_SHAPES = [
  'square', 'circle', 'triangle', 'pill', 'squiggle', 'arc',
  'zigzag', 'diamond', 'halfdisc', 'rings', 'cross', 'star',
];

export const memphis = {
  id: 'memphis',
  category: 'Retro & Modernist',
  name: 'Memphis Playground',
  blurb: '80s Memphis / Bauhaus scatter — squiggles, pills, arcs and primitives distributed by blue-noise so nothing ever collides.',
  params: [
    R('density', 'Spacing', 6, 90, 22, 0.5, 'mm'),
    R('size', 'Shape size', 0.15, 0.95, 0.62, 0.01, '×'),
    R('sizeVar', 'Size variation', 0, 1, 0.45, 0.01),
    R('stroke', 'Line width', 0.4, 10, 2, 0.1, 'mm'),
    R('rotVar', 'Rotation spread', 0, 1, 1, 0.01),
    T('outlineOnly', 'Outlines (no solids)', true),
    T('sq', 'Squares', true),
    T('ci', 'Circles', true),
    T('tr', 'Triangles', true),
    T('pi', 'Pills', true),
    T('sg', 'Squiggles', true),
    T('ar', 'Arcs', true),
    T('zz', 'Zig-zags', true),
    T('di', 'Diamonds', true),
    T('hd', 'Half discs', true),
    T('ri', 'Ring stacks', true),
    T('cr', 'Crosses', false),
    T('st', 'Stars', false),
  ],
  generate(P, rng, ctx) {
    const { w, h } = ctx;
    const enabled = [];
    const map = { sq: 'square', ci: 'circle', tr: 'triangle', pi: 'pill', sg: 'squiggle', ar: 'arc', zz: 'zigzag', di: 'diamond', hd: 'halfdisc', ri: 'rings', cr: 'cross', st: 'star' };
    for (const k in map) if (P[k]) enabled.push(map[k]);
    if (!enabled.length) enabled.push('square');

    const pts = poissonDisk(w, h, P.density, rng);
    const out = [];
    for (const p of pts) {
      const kind = rng.pick(enabled);
      const base = P.density * P.size;
      const s = base * (1 - P.sizeVar * 0.5 + rng() * P.sizeVar);
      const a = rng() * TAU * P.rotVar;
      const xf = (q) => add(rot(q, a), p);
      const solid = !P.outlineOnly && rng.bool(0.34);
      const emitRegion = (poly) => out.push(region(poly.map(xf), { layer: 'cut' }));
      const emitLine = (poly, closed = false) =>
        out.push(centerline(closed ? poly.concat([poly[0]]).map(xf) : poly.map(xf), { width: P.stroke }));

      switch (kind) {
        case 'square': {
          const poly = roundedRectPts(-s / 2, -s / 2, s, s, s * 0.12);
          solid ? emitRegion(poly) : emitLine(poly, true);
          break;
        }
        case 'circle': {
          const poly = circlePts(0, 0, s / 2);
          solid ? emitRegion(poly) : emitLine(poly, true);
          break;
        }
        case 'triangle': {
          const poly = regularPolygonPts(0, 0, s / 2, 3, Math.PI / 2);
          solid ? emitRegion(fillet(poly, s * 0.08, true)) : emitLine(poly, true);
          break;
        }
        case 'diamond': {
          const poly = regularPolygonPts(0, 0, s / 2, 4, Math.PI / 4);
          solid ? emitRegion(poly) : emitLine(poly, true);
          break;
        }
        case 'star': {
          const poly = starPts(0, 0, s / 2, s / 2 * 0.45, rng.int(5, 8), Math.PI / 2);
          solid ? emitRegion(poly) : emitLine(poly, true);
          break;
        }
        case 'pill': {
          const L = s, W2 = s * rng.float(0.28, 0.5);
          const poly = roundedRectPts(-L / 2, -W2 / 2, L, W2, W2 / 2);
          solid ? emitRegion(poly) : emitLine(poly, true);
          break;
        }
        case 'halfdisc': {
          const poly = dedupe([...arcPts(0, 0, s / 2, 0, Math.PI), [-s / 2, 0]]);
          solid ? emitRegion(poly) : emitLine(poly, true);
          break;
        }
        case 'rings': {
          const n = rng.int(2, 4);
          for (let i = 0; i < n; i++) emitLine(circlePts(0, 0, (s / 2) * (1 - i / (n + 0.6))), true);
          break;
        }
        case 'cross': {
          const t = s * 0.28;
          emitLine([[-s / 2, 0], [s / 2, 0]]);
          emitLine([[0, -s / 2], [0, s / 2]]);
          break;
        }
        case 'arc': {
          const n = rng.int(1, 3);
          for (let i = 0; i < n; i++) {
            const r = (s / 2) * (1 - i * 0.3);
            emitLine(arcPts(0, 0, r, 0, Math.PI * rng.float(0.5, 1.2)));
          }
          break;
        }
        case 'zigzag': {
          const n = rng.int(3, 6);
          const poly = [];
          for (let i = 0; i <= n; i++) poly.push([-s / 2 + (s * i) / n, (i % 2 ? 1 : -1) * s * 0.22]);
          emitLine(poly);
          break;
        }
        case 'squiggle': {
          const n = 40;
          const cycles = rng.float(1.2, 2.6);
          const poly = [];
          for (let i = 0; i <= n; i++) {
            const t = i / n;
            poly.push([-s / 2 + s * t, Math.sin(t * TAU * cycles) * s * 0.22]);
          }
          emitLine(chaikin(poly, 1));
          break;
        }
      }
    }
    return out;
  },
};

/* ------------------------------------------------------------------ *
 * 8. ISOCUBES — isometric tumbling blocks / stepped pyramids / prisms
 * ------------------------------------------------------------------ */
export const isocubes = {
  id: 'isocubes',
  category: 'Retro & Modernist',
  name: 'Isometric Tumbling Cubes',
  blurb: 'The classic Necker-cube optical lattice, plus stepped pyramids and hexagonal prism fields with scored faces.',
  params: [
    S('mode', 'Solid', [
      { v: 'cubes', label: 'Tumbling cubes' },
      { v: 'pyramid', label: 'Stepped pyramids' },
      { v: 'prisms', label: 'Hex prisms' },
      { v: 'zigzag', label: 'Isometric zig-zag' },
    ], 'cubes'),
    R('size', 'Cube size', 6, 90, 26, 0.5, 'mm'),
    R('inset', 'Face inset', 0, 0.35, 0.06, 0.005, '×'),
    I('steps', 'Steps / rings', 1, 6, 3),
    T('scoreFaces', 'Score one face per cube', true),
    T('dropout', 'Random dropout', false),
    R('dropRate', 'Dropout rate', 0, 0.7, 0.18, 0.01),
  ],
  generate(P, rng, ctx) {
    const { w, h } = ctx;
    const s = P.size;
    const out = [];
    // isometric basis
    const ex = [Math.cos(-Math.PI / 6) * s, Math.sin(-Math.PI / 6) * s];
    const ey = [Math.cos(-Math.PI * 5 / 6) * s, Math.sin(-Math.PI * 5 / 6) * s];
    const ez = [0, s];
    const hexR = s;
    const dy = hexR * 1.5;
    const dx = hexR * Math.sqrt(3);
    const nx = Math.ceil(w / dx) + 2;
    const ny = Math.ceil(h / dy) + 2;
    const insetPoly = (poly, k) => {
      if (k <= 0) return poly;
      const c = poly.reduce((a, p) => [a[0] + p[0] / poly.length, a[1] + p[1] / poly.length], [0, 0]);
      return poly.map((p) => lerp(c, p, 1 - k));
    };

    for (let j = -ny; j <= ny; j++) {
      for (let i = -nx; i <= nx; i++) {
        const cx = i * dx + (j % 2 ? dx / 2 : 0);
        const cy = j * dy;
        if (Math.abs(cx) > w / 2 + s * 1.6 || Math.abs(cy) > h / 2 + s * 1.6) continue;
        if (P.dropout && rng() < P.dropRate) continue;

        if (P.mode === 'prisms') {
          const hexPts = regularPolygonPts(cx, cy, hexR * 0.94, 6, Math.PI / 6);
          out.push(region(hexPts, { layer: 'cut' }));
          if (P.scoreFaces) {
            for (let k = 0; k < 3; k++) {
              const a = Math.PI / 6 + (k * TAU) / 3;
              out.push(centerline([[cx, cy], [cx + Math.cos(a) * hexR * 0.94, cy + Math.sin(a) * hexR * 0.94]], { layer: 'score', width: 0.6 }));
            }
          }
          continue;
        }

        if (P.mode === 'pyramid') {
          const n = Math.max(1, P.steps | 0);
          for (let k = 0; k < n; k++) {
            const r = hexR * (1 - k / (n + 0.3));
            out.push(region(regularPolygonPts(cx, cy, r, 6, Math.PI / 6), { layer: k === 0 ? 'cut' : 'score' }));
          }
          continue;
        }

        if (P.mode === 'zigzag') {
          const r = hexR * 0.96;
          const hex = regularPolygonPts(cx, cy, r, 6, Math.PI / 6);
          for (let k = 0; k < 6; k += 2) {
            out.push(region([hex[k], hex[(k + 1) % 6], [cx, cy]], { layer: 'cut' }));
          }
          continue;
        }

        /* --- tumbling cube: a hexagon split into three rhombi --- */
        const hex = regularPolygonPts(cx, cy, hexR, 6, Math.PI / 6);
        const C = [cx, cy];
        const faces = [
          [hex[0], hex[1], C, hex[5]],
          [hex[1], hex[2], hex[3], C],
          [hex[3], hex[4], hex[5], C],
        ];
        faces.forEach((f, fi) => {
          const poly = insetPoly(f, P.inset);
          if (P.scoreFaces && fi === 2) out.push(region(poly, { layer: 'score' }));
          else out.push(region(poly, { layer: 'cut' }));
        });
      }
    }
    return out;
  },
};

/* ------------------------------------------------------------------ *
 * 9. OPART — radial sunbursts, vortex pinwheels, moiré, warp grids
 * ------------------------------------------------------------------ */
export const opart = {
  id: 'opart',
  category: 'Retro & Modernist',
  name: 'Op-Art Radial & Grid',
  blurb: 'Concentric alternating sector rings, spiralling vortex pinwheels, moiré interference webs and Vasarely warp grids.',
  params: [
    S('mode', 'Field', [
      { v: 'sunburst', label: 'Sector sunburst' },
      { v: 'vortex', label: 'Vortex pinwheel' },
      { v: 'rings', label: 'Concentric rings' },
      { v: 'moire', label: 'Moiré interference' },
      { v: 'grid', label: 'Square warp grid' },
      { v: 'target', label: 'Checker target' },
    ], 'sunburst'),
    I('sectors', 'Sectors', 4, 96, 24),
    I('rings', 'Rings', 1, 40, 8),
    R('radius', 'Outer radius', 10, 220, 132, 1, 'mm'),
    R('twist', 'Spiral twist', -4, 4, 0, 0.01, 'turns'),
    R('cell', 'Grid cell', 3, 60, 12, 0.5, 'mm'),
    R('stroke', 'Line width', 0.3, 10, 1.6, 0.05, 'mm'),
    R('gamma', 'Radial easing', 0.3, 3, 1, 0.01),
    T('alternate', 'Alternate solids', true),
    R('offset2', 'Moiré offset', 0, 40, 8, 0.5, 'mm'),
  ],
  generate(P, rng, ctx) {
    const { w, h } = ctx;
    const out = [];
    const Rmax = P.radius;
    const nS = Math.max(2, P.sectors | 0);
    const nR = Math.max(1, P.rings | 0);
    const rAt = (k) => Rmax * Math.pow(k / nR, P.gamma);

    if (P.mode === 'grid') {
      const cells = gridCells(w, h, P.cell, 1);
      for (const c of cells) {
        if (P.alternate && ((c.i + c.j) & 1)) continue;
        out.push(region(rectPts(c.x - P.cell / 2, c.y - P.cell / 2, P.cell, P.cell), { layer: 'cut' }));
      }
      if (!P.alternate) {
        // pure line grid
        out.length = 0;
        const nx = Math.ceil(w / P.cell) + 1, ny = Math.ceil(h / P.cell) + 1;
        for (let i = -nx; i <= nx; i++) out.push(centerline([[i * P.cell, -h / 2], [i * P.cell, h / 2]], { width: P.stroke }));
        for (let j = -ny; j <= ny; j++) out.push(centerline([[-w / 2, j * P.cell], [w / 2, j * P.cell]], { width: P.stroke }));
      }
      return out;
    }

    if (P.mode === 'moire') {
      const n = Math.ceil(Rmax / P.cell) + 2;
      for (const cx of [-P.offset2 / 2, P.offset2 / 2]) {
        for (let i = 1; i <= n; i++) {
          out.push(centerline(circlePts(cx, 0, i * P.cell).concat([[cx + i * P.cell, 0]]), { width: P.stroke, closed: false }));
        }
      }
      return out;
    }

    if (P.mode === 'rings') {
      for (let k = 1; k <= nR; k++) {
        const r = rAt(k);
        if (P.alternate && (k & 1)) {
          out.push(region(circlePts(0, 0, r), { layer: 'cut' }));
          out.push(region(circlePts(0, 0, rAt(k - 1)), { layer: 'cut' }));
        } else if (!P.alternate) {
          out.push(centerline(circlePts(0, 0, r).concat([[r, 0]]), { width: P.stroke, closed: false }));
        }
      }
      return out;
    }

    if (P.mode === 'target') {
      for (let k = 1; k <= nR; k++) {
        const r0 = rAt(k - 1), r1 = rAt(k);
        for (let s = 0; s < nS; s++) {
          if ((s + k) & 1) continue;
          const a0 = (s / nS) * TAU + P.twist * TAU * (r0 / Rmax);
          const a1 = ((s + 1) / nS) * TAU + P.twist * TAU * (r1 / Rmax);
          const poly = [
            ...arcPts(0, 0, r1, a0, a1),
            ...arcPts(0, 0, r0, a1, a0),
          ];
          out.push(region(dedupe(poly), { layer: 'cut' }));
        }
      }
      return out;
    }

    if (P.mode === 'vortex') {
      for (let s = 0; s < nS; s++) {
        const a0 = (s / nS) * TAU;
        const steps = 90;
        const inner = [], outer = [];
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          const r = Math.max(0.6, Rmax * Math.pow(t, P.gamma));
          const a = a0 + P.twist * TAU * t;
          const half = (TAU / nS) * 0.5 * (P.alternate ? 0.5 : 0.42);
          inner.push([Math.cos(a - half) * r, Math.sin(a - half) * r]);
          outer.push([Math.cos(a + half) * r, Math.sin(a + half) * r]);
        }
        out.push(region(inner.concat(outer.reverse()), { layer: 'cut' }));
      }
      return out;
    }

    /* sunburst: alternating sectors per ring */
    for (let k = 1; k <= nR; k++) {
      const r0 = rAt(k - 1), r1 = rAt(k);
      for (let s = 0; s < nS; s++) {
        if (P.alternate && (s & 1)) continue;
        const tw0 = P.twist * TAU * (r0 / Rmax) + (k * TAU) / (nS * 2) * (P.alternate ? 1 : 0);
        const tw1 = P.twist * TAU * (r1 / Rmax) + (k * TAU) / (nS * 2) * (P.alternate ? 1 : 0);
        const a0 = (s / nS) * TAU;
        const a1 = ((s + 0.5) / nS) * TAU;
        const poly = [
          ...arcPts(0, 0, r1, a0 + tw1, a1 + tw1),
          ...arcPts(0, 0, r0, a1 + tw0, a0 + tw0),
        ];
        out.push(region(dedupe(poly), { layer: 'cut' }));
      }
    }
    return out;
  },
};
