/* =========================================================================
 * canvas2d.js — the 2D CAD viewport renderer
 *
 * Draw modes:
 *   solid      filled material (what the part looks like)
 *   wireframe  hairline toolpaths only (what the machine actually does)
 *   xray       both — translucent material under the toolpath
 *
 * Overlays: node visualiser, layer colouring, floating-island highlighting
 * in bright red, sheet outline, rulers and the interactive brush cursor.
 * =======================================================================*/

export const THEMES = {
  studio: {
    id: 'studio', label: 'Studio dark',
    bg: '#0e0f13', grid: '#1b1d24', gridMajor: '#262933',
    material: '#e9e6df', materialEdge: '#0e0f13',
    cut: '#f05252', frame: '#4d8bff', score: '#3ddc84',
    node: '#ffd166', island: '#ff2d55', sheet: '#3a3f4b', text: '#8b90a0',
  },
  blueprint: {
    id: 'blueprint', label: 'Blueprint',
    bg: '#0b2340', grid: '#14335a', gridMajor: '#1b4272',
    material: '#dce9ff', materialEdge: '#0b2340',
    cut: '#ffffff', frame: '#8ec5ff', score: '#7ef0b2',
    node: '#ffd166', island: '#ff5c73', sheet: '#2c5f9e', text: '#8fb4e0',
  },
  paper: {
    id: 'paper', label: 'Paper light',
    bg: '#f6f4ef', grid: '#e6e2d8', gridMajor: '#d7d2c4',
    material: '#1c1d22', materialEdge: '#f6f4ef',
    cut: '#d92d20', frame: '#1d4ed8', score: '#059669',
    node: '#b45309', island: '#ff1744', sheet: '#c9c3b4', text: '#6b6558',
  },
};

export function drawDesign(ctx, design, view, opts) {
  const T = THEMES[opts.theme] || THEMES.studio;
  const RULE = design.fillRule || 'nonzero';
  const { width: cw, height: ch, dpr } = view;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = T.bg;
  ctx.fillRect(0, 0, cw, ch);

  // world -> screen: CAD Y-up, screen Y-down
  const S = view.scale;
  const toScreen = (p) => [cw / 2 + (p[0] - view.cx) * S, ch / 2 - (p[1] - view.cy) * S];

  if (opts.grid) drawGrid(ctx, T, view, cw, ch);

  const { W, H } = design.canvas;
  // sheet / stock outline
  if (opts.sheet && opts.sheetW && opts.sheetH) {
    const a = toScreen([-opts.sheetW / 2, -opts.sheetH / 2]);
    const b = toScreen([opts.sheetW / 2, opts.sheetH / 2]);
    ctx.save();
    ctx.strokeStyle = T.sheet;
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 1;
    ctx.strokeRect(a[0], b[1], b[0] - a[0], a[1] - b[1]);
    ctx.restore();
  }

  const floating = design.analysis ? design.analysis.floating : new Set();
  const showIslands = opts.showIslands !== false;

  const buildPath = (paths, filter) => {
    const p2 = new Path2D();
    paths.forEach((L, i) => {
      if (filter && !filter(L, i)) return;
      const pts = L.pts;
      if (!pts || pts.length < 2) return;
      const s0 = toScreen(pts[0]);
      p2.moveTo(s0[0], s0[1]);
      for (let k = 1; k < pts.length; k++) {
        const s = toScreen(pts[k]);
        p2.lineTo(s[0], s[1]);
      }
      if (L.closed) p2.closePath();
    });
    return p2;
  };

  /* ---- material fill (even-odd) ---- */
  if (opts.mode !== 'wireframe') {
    const solid = buildPath(design.loops);
    ctx.globalAlpha = opts.mode === 'xray' ? 0.34 : 1;
    ctx.fillStyle = T.material;
    ctx.fill(solid, RULE);
    ctx.globalAlpha = 1;
  }

  /* ---- toolpaths ---- */
  if (opts.mode !== 'solid') {
    const lw = Math.max(0.6, Math.min(2.2, S * 0.35));
    ctx.lineWidth = lw;
    ctx.lineJoin = 'round';

    ctx.strokeStyle = T.cut;
    ctx.stroke(buildPath(design.loops, (L, i) => L.layer !== 'frame' && !(showIslands && floating.has(i))));
    ctx.strokeStyle = T.frame;
    ctx.lineWidth = lw * 1.3;
    ctx.stroke(buildPath(design.loops, (L, i) => L.layer === 'frame' && !(showIslands && floating.has(i))));
    ctx.lineWidth = lw;
  }

  /* ---- score / engrave lines always drawn as single strokes ---- */
  if (design.scoreLines.length) {
    ctx.strokeStyle = T.score;
    ctx.lineWidth = Math.max(0.7, Math.min(2, S * 0.4));
    ctx.setLineDash(opts.mode === 'solid' ? [] : [4, 3]);
    ctx.stroke(buildPath(design.scoreLines));
    ctx.setLineDash([]);
  }

  /* ---- floating islands in bright red ---- */
  if (showIslands && floating.size) {
    const isl = buildPath(design.loops, (L, i) => floating.has(i));
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = T.island;
    ctx.fill(isl, RULE);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = T.island;
    ctx.lineWidth = Math.max(1.2, S * 0.5);
    ctx.stroke(isl);
    ctx.restore();
  }

  /* ---- node visualiser ---- */
  if (opts.nodes) {
    ctx.fillStyle = T.node;
    let n = 0;
    const stride = Math.max(1, Math.ceil(totalPts(design) / 5000));
    for (const L of design.loops) {
      for (let i = 0; i < L.pts.length; i++) {
        if (n++ % stride) continue;
        const s = toScreen(L.pts[i]);
        if (s[0] < -8 || s[1] < -8 || s[0] > cw + 8 || s[1] > ch + 8) continue;
        ctx.fillRect(s[0] - 1.2, s[1] - 1.2, 2.4, 2.4);
      }
    }
  }

  /* ---- brush cursor ---- */
  if (opts.brush && opts.brush.show) {
    const c = toScreen([opts.brush.x, opts.brush.y]);
    ctx.save();
    ctx.strokeStyle = T.node;
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(c[0], c[1], opts.brush.radius * S, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();
}

function totalPts(design) {
  let n = 0;
  for (const L of design.loops) n += L.pts.length;
  return n;
}

function drawGrid(ctx, T, view, cw, ch) {
  const S = view.scale;
  // choose a grid step that stays between 12 and 120 screen px
  let step = 1;
  const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
  for (const s of steps) { step = s; if (s * S >= 16) break; }
  const x0 = view.cx - cw / (2 * S), x1 = view.cx + cw / (2 * S);
  const y0 = view.cy - ch / (2 * S), y1 = view.cy + ch / (2 * S);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.strokeStyle = T.grid;
  for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
    if (Math.abs(x % (step * 5)) < 1e-6) continue;
    const sx = cw / 2 + (x - view.cx) * S;
    ctx.moveTo(sx, 0); ctx.lineTo(sx, ch);
  }
  for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) {
    if (Math.abs(y % (step * 5)) < 1e-6) continue;
    const sy = ch / 2 - (y - view.cy) * S;
    ctx.moveTo(0, sy); ctx.lineTo(cw, sy);
  }
  ctx.stroke();
  ctx.beginPath();
  ctx.strokeStyle = T.gridMajor;
  const major = step * 5;
  for (let x = Math.ceil(x0 / major) * major; x <= x1; x += major) {
    const sx = cw / 2 + (x - view.cx) * S;
    ctx.moveTo(sx, 0); ctx.lineTo(sx, ch);
  }
  for (let y = Math.ceil(y0 / major) * major; y <= y1; y += major) {
    const sy = ch / 2 - (y - view.cy) * S;
    ctx.moveTo(0, sy); ctx.lineTo(cw, sy);
  }
  ctx.stroke();
}

/** Fit the design bbox into the viewport. */
export function fitView(bbox, cw, ch, pad = 0.9) {
  const w = Math.max(1e-3, bbox[2] - bbox[0]);
  const h = Math.max(1e-3, bbox[3] - bbox[1]);
  const scale = Math.min(cw / w, ch / h) * pad;
  return { cx: (bbox[0] + bbox[2]) / 2, cy: (bbox[1] + bbox[3]) / 2, scale };
}
