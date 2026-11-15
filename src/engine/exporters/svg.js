/* =========================================================================
 * svg.js — SVG export
 *
 * Emits one compound <path> per fabrication layer so a cutter or plotter
 * imports three clean objects (frame / cut / score) instead of thousands of
 * loose fragments. Coordinates are true millimetres at 1:1 scale; the Y axis
 * is flipped from CAD (Y-up) to SVG (Y-down).
 * =======================================================================*/
import { LAYERS } from './layers.js';
import { fitPath, sampleSpline } from '../fit.js';

/** True when a CAD-space contour is wound counter-clockwise. */
function ccw(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  }
  return a > 0;
}

const f = (n) => {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? 0 : r;
};

/**
 * One path as an SVG `d` string, with true arcs where the geometry has them.
 *
 * Y is flipped from CAD (Y-up) to SVG (Y-down), which reverses the sense of
 * rotation — so a counter-clockwise arc in the design is a clockwise arc on
 * screen, and the sweep flag has to be inverted to match. Getting that
 * backwards produces an arc bulging the wrong way, which looks like a
 * completely different part rather than a subtle error.
 */
function pathToD(p, ox, yTop, fitOpts) {
  const pts = p.pts;
  if (!pts || pts.length < 2) return '';
  const X = (q) => f(q[0] - ox);
  const Y = (q) => f(yTop - q[1]);
  const r = fitPath(pts, p.closed, fitOpts);

  if (r.circle) {
    // SVG has no single-command full circle; two half arcs make one. The
    // direction has to match the contour's winding — a hole drawn the same way
    // round as a boundary stops being a hole under the nonzero fill rule and
    // fills in solid.
    const { c, r: rad } = r.circle;
    const a = [c[0] - rad, c[1]], b = [c[0] + rad, c[1]];
    const fl = ccw(pts) ? 0 : 1;      // same flip as the arc case above
    return `M${X(a)} ${Y(a)}A${f(rad)} ${f(rad)} 0 0 ${fl} ${X(b)} ${Y(b)}` +
           `A${f(rad)} ${f(rad)} 0 0 ${fl} ${X(a)} ${Y(a)}Z`;
  }

  const segs = r.segs;
  if (!segs.length) return '';
  // a spline seg carries its geometry in `fit`, not in a/b
  const start = segs[0].type === 'spline' ? sampleSpline(segs[0])[0] : segs[0].a;
  let d = `M${X(start)} ${Y(start)}`;
  for (const s of segs) {
    if (s.type === 'arc') {
      const large = Math.abs(s.sweep) > Math.PI ? 1 : 0;
      // Y is flipped between CAD and SVG, so the angle a point subtends at the
      // arc centre runs the other way: a sweep of +θ in the design is a sweep
      // of −θ in SVG user space, and SVG's sweep-flag names the sign of that.
      const sweepFlag = s.sweep > 0 ? 0 : 1;
      d += `A${f(s.r)} ${f(s.r)} 0 ${large} ${sweepFlag} ${X(s.b)} ${Y(s.b)}`;
    } else if (s.type === 'spline') {
      // SVG path syntax has no B-spline, so the curve is *evaluated* and
      // emitted densely. Joining its fit points with straight lines instead
      // would draw chords across every arc the spline replaced.
      const sm = sampleSpline(s);
      for (let i = 1; i < sm.length; i++) d += `L${X(sm[i])} ${Y(sm[i])}`;
    } else {
      d += `L${X(s.b)} ${Y(s.b)}`;
    }
  }
  if (p.closed) d += 'Z';
  return d;
}

export function pathsToCompoundD(paths, ox, oy, flipH) {
  const parts = [];
  for (const p of paths) {
    const pts = p.pts;
    if (!pts || pts.length < 2) continue;
    let d = `M${f(pts[0][0] - ox)} ${f(flipH - (pts[0][1] - oy))}`;
    for (let i = 1; i < pts.length; i++) {
      d += `L${f(pts[i][0] - ox)} ${f(flipH - (pts[i][1] - oy))}`;
    }
    if (p.closed) d += 'Z';
    parts.push(d);
  }
  return parts.join('');
}

/**
 * @param {object} design  result of buildDesign()
 * @param {object} opts    { filled, strokeWidth, background, margin }
 */
export function exportSVG(design, opts = {}) {
  const margin = opts.margin ?? 0;
  const [x0, y0, x1, y1] = design.bbox;
  const W = Math.max(0.001, x1 - x0) + margin * 2;
  const H = Math.max(0.001, y1 - y0) + margin * 2;
  const ox = x0 - margin;
  const oy = y0 - margin;
  const flipH = H + (y0 - margin) - (y0 - margin); // = H, kept explicit
  const yTop = y1 + margin;

  const groups = [];
  const byLayer = {
    frame: design.loops.filter((p) => p.layer === 'frame'),
    cut: design.loops.filter((p) => p.layer !== 'frame'),
    score: design.scoreLines,
  };

  const fitOpts = { mode: opts.fit || 'arcs', tol: opts.fitTol ?? 0.02 };
  const toD = (paths) => {
    const parts = [];
    for (const p of paths) {
      const d = pathToD(p, ox, yTop, fitOpts);
      if (d) parts.push(d);
    }
    return parts.join('');
  };

  if (opts.filled) {
    // Frame and cut geometry are one physical body — fill them as a single
    // compound path so nesting resolves correctly under the nonzero rule.
    const solid = toD(byLayer.frame.concat(byLayer.cut));
    if (solid) {
      groups.push(`  <g id="MATERIAL">\n    <path fill="${opts.fill || '#111827'}" fill-rule="${design.fillRule || 'nonzero'}" stroke="none" d="${solid}"/>\n  </g>`);
    }
    const sc = toD(byLayer.score);
    if (sc) {
      groups.push(`  <g id="2_SCORE_ENGRAVE">\n    <path fill="none" stroke="${LAYERS[2].stroke}" stroke-width="${opts.strokeWidth ?? 0.4}" d="${sc}"/>\n  </g>`);
    }
  } else {
    for (const L of LAYERS) {
      const paths = byLayer[L.key] || [];
      if (!paths.length) continue;
      const d = toD(paths);
      if (!d) continue;
      groups.push(
        `  <g id="${L.dxf}" inkscape:label="${L.dxf}" inkscape:groupmode="layer">\n` +
        `    <path fill="none" stroke="${L.stroke}" stroke-width="${opts.strokeWidth ?? 0.1}" vector-effect="non-scaling-stroke" d="${d}"/>\n  </g>`,
      );
    }
  }

  const bg = opts.background
    ? `  <rect x="0" y="0" width="${f(W)}" height="${f(H)}" fill="${opts.background}"/>\n`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
     width="${f(W)}mm" height="${f(H)}mm" viewBox="0 0 ${f(W)} ${f(H)}"
     data-generator="Tessellate CAD" data-units="mm">
${bg}${groups.join('\n')}
</svg>
`;
}

/** Small inline SVG used for gallery thumbnails (filled, dark on light). */
export function thumbnailSVG(design, size = 120, fg = '#111', bg = 'none') {
  const rule = design.fillRule || 'nonzero';
  const [x0, y0, x1, y1] = design.bbox;
  const w = Math.max(1e-3, x1 - x0), h = Math.max(1e-3, y1 - y0);
  const s = size / Math.max(w, h);
  const ox = x0 - (Math.max(w, h) - w) / 2;
  const yTop = y1 + (Math.max(w, h) - h) / 2;
  const parts = [];
  for (const p of design.loops) {
    const pts = p.pts;
    if (!pts || pts.length < 3) continue;
    let d = `M${f((pts[0][0] - ox) * s)} ${f((yTop - pts[0][1]) * s)}`;
    for (let i = 1; i < pts.length; i++) d += `L${f((pts[i][0] - ox) * s)} ${f((yTop - pts[i][1]) * s)}`;
    parts.push(d + 'Z');
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    (bg !== 'none' ? `<rect width="${size}" height="${size}" fill="${bg}"/>` : '') +
    `<path fill="${fg}" fill-rule="${rule}" d="${parts.join('')}"/></svg>`;
}
