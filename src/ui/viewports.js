/* =========================================================================
 * viewports.js — the 2D CAD viewport and the 3D material viewport
 * =======================================================================*/
import h, { cx, useRef, useEffect, useState, useCallback } from '../lib/h.js';
import { drawDesign, fitView, THEMES } from '../render/canvas2d.js';
import { Viewer3D, MATERIALS, MATERIAL_BY_ID } from '../render/webgl3d.js';
import { extrudeShapes } from '../engine/triangulate.js';
import { SegmentedControl, Toggle, Select, IconButton } from './widgets.js';

/* ------------------------------------------------------------------ *
 * 2D CAD viewport — pan, zoom, and direct-manipulation warp brushes
 * ------------------------------------------------------------------ */
export function Viewport2D({ design, opts, onOptsChange, brushMode, brushRadius, brushStrength, onBrush, onCommitBrush }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const viewRef = useRef({ cx: 0, cy: 0, scale: 1, width: 100, height: 100, dpr: 1 });
  const dragRef = useRef(null);
  const [cursor, setCursor] = useState(null);
  const [, force] = useState(0);
  const fittedFor = useRef(null);

  const redraw = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv || !design) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = cv.clientWidth, hh = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(hh * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(hh * dpr);
    }
    const v = viewRef.current;
    v.width = w; v.height = hh; v.dpr = dpr;
    drawDesign(cv.getContext('2d'), design, v, {
      ...opts,
      brush: cursor && brushMode !== 'off'
        ? { show: true, x: cursor[0], y: cursor[1], radius: brushRadius }
        : null,
    });
  }, [design, opts, cursor, brushMode, brushRadius]);

  // fit once per new part footprint
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !design) return;
    const key = design.bbox.map((n) => Math.round(n)).join(',');
    if (fittedFor.current !== key && cv.clientWidth > 10) {
      if (fittedFor.current === null || opts.autoFit) {
        Object.assign(viewRef.current, fitView(design.bbox, cv.clientWidth, cv.clientHeight, 0.86));
      }
      fittedFor.current = key;
    }
    redraw();
  }, [design, redraw, opts.autoFit]);

  useEffect(() => {
    const ro = new ResizeObserver(() => redraw());
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [redraw]);

  useEffect(() => { redraw(); }, [redraw]);

  const toWorld = (ev) => {
    const cv = canvasRef.current;
    const r = cv.getBoundingClientRect();
    const v = viewRef.current;
    return [
      v.cx + (ev.clientX - r.left - r.width / 2) / v.scale,
      v.cy - (ev.clientY - r.top - r.height / 2) / v.scale,
    ];
  };

  const onPointerDown = (ev) => {
    ev.currentTarget.setPointerCapture(ev.pointerId);
    const w = toWorld(ev);
    if (brushMode !== 'off' && ev.button === 0 && !ev.shiftKey) {
      dragRef.current = { kind: 'brush', last: w, start: w };
      onBrush({ type: brushMode, x: w[0], y: w[1], radius: brushRadius, strength: brushStrength, dx: 0, dy: 0 });
    } else {
      dragRef.current = { kind: 'pan', sx: ev.clientX, sy: ev.clientY, cx: viewRef.current.cx, cy: viewRef.current.cy };
    }
  };

  const onPointerMove = (ev) => {
    const w = toWorld(ev);
    setCursor(w);
    const d = dragRef.current;
    if (!d) return;
    if (d.kind === 'pan') {
      const v = viewRef.current;
      v.cx = d.cx - (ev.clientX - d.sx) / v.scale;
      v.cy = d.cy + (ev.clientY - d.sy) / v.scale;
      redraw();
    } else if (d.kind === 'brush') {
      onBrush({
        type: brushMode, x: d.start[0], y: d.start[1], radius: brushRadius,
        strength: brushStrength, dx: w[0] - d.start[0], dy: w[1] - d.start[1],
      });
    }
  };

  const onPointerUp = () => {
    if (dragRef.current && dragRef.current.kind === 'brush') onCommitBrush();
    dragRef.current = null;
  };

  const onWheel = (ev) => {
    ev.preventDefault();
    const v = viewRef.current;
    const before = toWorld(ev);
    v.scale = Math.max(0.05, Math.min(80, v.scale * Math.exp(-ev.deltaY * 0.0016)));
    const after = toWorld(ev);
    v.cx += before[0] - after[0];
    v.cy += before[1] - after[1];
    redraw();
  };

  const zoomFit = () => {
    const cv = canvasRef.current;
    Object.assign(viewRef.current, fitView(design.bbox, cv.clientWidth, cv.clientHeight, 0.86));
    redraw();
  };

  return h('div', { className: 'viewport', ref: wrapRef },
    h('canvas', {
      ref: canvasRef,
      className: cx('vp-canvas', brushMode !== 'off' && 'is-brush'),
      onPointerDown, onPointerMove, onPointerUp, onPointerLeave: () => setCursor(null),
      onWheel,
    }),
    h('div', { className: 'vp-toolbar' },
      h(SegmentedControl, {
        value: opts.mode,
        options: [
          { v: 'solid', label: 'Solid' },
          { v: 'wireframe', label: 'Toolpath' },
          { v: 'xray', label: 'X-ray' },
        ],
        onChange: (v) => onOptsChange({ ...opts, mode: v }),
      }),
      h('div', { className: 'vp-tool-group' },
        h(IconButton, { title: 'Zoom to fit', onClick: zoomFit, children: '⤢' }),
        h(IconButton, {
          title: 'Toggle nodes', active: opts.nodes,
          onClick: () => onOptsChange({ ...opts, nodes: !opts.nodes }), children: '⋯',
        }),
        h(IconButton, {
          title: 'Toggle grid', active: opts.grid,
          onClick: () => onOptsChange({ ...opts, grid: !opts.grid }), children: '#',
        }),
        h(IconButton, {
          title: 'Highlight floating islands', active: opts.showIslands,
          onClick: () => onOptsChange({ ...opts, showIslands: !opts.showIslands }), children: '⚠',
        }),
      ),
    ),
    h('div', { className: 'vp-corner' },
      cursor ? `${cursor[0].toFixed(1)}, ${cursor[1].toFixed(1)} mm` : `${design.canvas.W} × ${design.canvas.H} mm`,
    ),
  );
}

/* ------------------------------------------------------------------ *
 * 3D material viewport
 * ------------------------------------------------------------------ */
export function Viewport3D({ design, thickness, materialId, onMaterial, autoRotate, onAutoRotate }) {
  const canvasRef = useRef(null);
  const viewerRef = useRef(null);
  const [err, setErr] = useState(null);
  const [tris, setTris] = useState(0);
  const dragRef = useRef(null);

  useEffect(() => {
    const v = new Viewer3D(canvasRef.current);
    if (v.failed) { setErr(v.failed); return; }
    viewerRef.current = v;
    let raf, last = performance.now();
    const loop = (t) => {
      v.render(t - last);
      last = t;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); v.dispose(); viewerRef.current = null; };
  }, []);

  useEffect(() => {
    const v = viewerRef.current;
    if (!v || !design) return;
    const mesh = extrudeShapes(design.shapes, Math.max(0.2, thickness));
    v.setMesh(mesh, design.bbox);
    v.frameCamera();
    setTris(mesh.triangleCount);
  }, [design, thickness]);

  useEffect(() => {
    const v = viewerRef.current;
    if (!v) return;
    v.material = MATERIAL_BY_ID[materialId] || MATERIALS[0];
    v.thickness = thickness;
    v.autoRotate = autoRotate;
  }, [materialId, thickness, autoRotate]);

  const onPointerDown = (ev) => {
    ev.currentTarget.setPointerCapture(ev.pointerId);
    dragRef.current = { x: ev.clientX, y: ev.clientY, pan: ev.button === 2 || ev.shiftKey };
  };
  const onPointerMove = (ev) => {
    const d = dragRef.current, v = viewerRef.current;
    if (!d || !v) return;
    const dx = ev.clientX - d.x, dy = ev.clientY - d.y;
    d.x = ev.clientX; d.y = ev.clientY;
    if (d.pan) v.pan(dx, dy); else v.orbit(dx, dy);
  };

  return h('div', { className: 'viewport viewport-3d' },
    h('canvas', {
      ref: canvasRef, className: 'vp-canvas',
      onPointerDown, onPointerMove,
      onPointerUp: () => { dragRef.current = null; },
      onContextMenu: (e) => e.preventDefault(),
      onWheel: (e) => { e.preventDefault(); viewerRef.current && viewerRef.current.zoom(e.deltaY); },
    }),
    err ? h('div', { className: 'vp-error' }, 'WebGL unavailable — ', err) : null,
    h('div', { className: 'vp-toolbar' },
      h('div', { className: 'vp-material' },
        h(Select, {
          value: materialId,
          options: MATERIALS.map((m) => ({ v: m.id, label: m.label })),
          onChange: onMaterial,
        }),
      ),
      h(IconButton, {
        title: 'Auto-rotate', active: autoRotate,
        onClick: () => onAutoRotate(!autoRotate), children: '↻',
      }),
    ),
    h('div', { className: 'vp-corner' }, `${tris.toLocaleString()} triangles · ${thickness} mm stock`),
  );
}
