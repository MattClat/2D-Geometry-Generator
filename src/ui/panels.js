/* =========================================================================
 * panels.js — parameter panels, fabrication HUD, export bay, preset gallery
 * =======================================================================*/
import h, { cx, useState, useEffect, useMemo, useRef } from '../lib/h.js';
import { Slider, Toggle, Select, Section, Button, IconButton, Stat, SchemaControl, SegmentedControl, Notice } from './widgets.js';
import { ENGINES, CATEGORIES, ENGINE_BY_ID } from '../engine/patterns/index.js';
import { MODIFIER_SCHEMA } from '../engine/modifiers.js';
import { FRAME_SHAPES } from '../engine/fabrication.js';
import { PRESETS } from '../engine/presets.js';
import { buildDesign } from '../engine/build.js';
import { thumbnailSVG, exportSVG } from '../engine/exporters/svg.js';
import { exportDXF } from '../engine/exporters/dxf.js';
import { fitStats } from '../engine/fit.js';
import { exportSTL } from '../engine/exporters/stl.js';

/* ------------------------------------------------------------------ *
 * Engine picker
 * ------------------------------------------------------------------ */
export function EnginePicker({ engine, onEngine }) {
  return h('div', { className: 'engine-picker' },
    Object.entries(CATEGORIES).map(([cat, list]) =>
      h('div', { className: 'engine-cat', key: cat },
        h('div', { className: 'engine-cat-name' }, cat),
        h('div', { className: 'engine-list' },
          list.map((e) => h('button', {
            key: e.id, type: 'button',
            className: cx('engine-chip', engine === e.id && 'is-active'),
            onClick: () => onEngine(e.id),
            title: e.blurb,
          }, e.name)),
        ),
      ),
    ),
  );
}

/* ------------------------------------------------------------------ *
 * Pattern parameters (schema-driven)
 * ------------------------------------------------------------------ */
export function PatternPanel({ engine, params, onParam }) {
  const eng = ENGINE_BY_ID[engine];
  if (!eng) return null;
  // Controls that cannot affect the current mode are hidden outright — a
  // dead slider is worse than no slider.
  const visible = eng.params.filter((p) => !p.when || p.when(params));
  const toggles = visible.filter((p) => p.type === 'toggle');
  const rest = visible.filter((p) => p.type !== 'toggle');
  const manyToggles = toggles.length > 4;
  return h('div', null,
    h('p', { className: 'blurb' }, eng.blurb),
    rest.map((p) => h('div', { key: p.key },
      h(SchemaControl, { spec: p, value: params[p.key], onChange: (v) => onParam(p.key, v) }))),
    manyToggles
      ? h('div', { className: 'toggle-grid' },
          toggles.map((p) => h('button', {
            key: p.key, type: 'button',
            className: cx('chip-toggle', params[p.key] && 'is-on'),
            onClick: () => onParam(p.key, !params[p.key]),
          }, p.label)))
      : toggles.map((p) => h('div', { key: p.key },
          h(SchemaControl, { spec: p, value: params[p.key], onChange: (v) => onParam(p.key, v) }))),
  );
}

/* ------------------------------------------------------------------ *
 * Modifier stack
 * ------------------------------------------------------------------ */
export function ModifierPanel({ mods, onMod, onResetGroup }) {
  return h('div', null,
    MODIFIER_SCHEMA.map((group) =>
      h(Section, {
        key: group.group, title: group.group, defaultOpen: group.group !== 'Line Weight & Profile',
        right: h('button', {
          className: 'mini-link', type: 'button',
          onClick: () => onResetGroup(group),
        }, 'reset'),
      },
        group.items
          .filter((it) => !it.when || it.when(mods))
          .map((it) => h('div', { key: it.key },
            h(SchemaControl, { spec: it, value: mods[it.key], onChange: (v) => onMod(it.key, v) }))),
      ),
    ),
  );
}

/* ------------------------------------------------------------------ *
 * Fabrication panel
 * ------------------------------------------------------------------ */
export function FabricationPanel({ fab, onFab, design, canvas, onCanvas }) {
  const islands = design.analysis ? design.analysis.floating.size : 0;
  return h('div', null,
    h(Section, { title: 'Sheet & part' },
      h(Slider, { label: 'Design width', value: canvas.W, min: 40, max: 900, step: 5, unit: 'mm', onChange: (v) => onCanvas({ ...canvas, W: v }) }),
      h(Slider, { label: 'Design height', value: canvas.H, min: 40, max: 900, step: 5, unit: 'mm', onChange: (v) => onCanvas({ ...canvas, H: v }) }),
      h(Slider, { label: 'Stock thickness', value: fab.thickness, min: 0.2, max: 30, step: 0.1, unit: 'mm', onChange: (v) => onFab('thickness', v) }),
      h(Slider, { label: 'Sheet width', value: fab.sheetW, min: 50, max: 3000, step: 10, unit: 'mm', onChange: (v) => onFab('sheetW', v) }),
      h(Slider, { label: 'Sheet height', value: fab.sheetH, min: 50, max: 3000, step: 10, unit: 'mm', onChange: (v) => onFab('sheetH', v) }),
    ),
    h(Section, { title: 'Frame & mounting' },
      h(Select, { label: 'Frame shape', value: fab.shape, options: FRAME_SHAPES, onChange: (v) => onFab('shape', v) }),
      fab.shape !== 'none' ? h(Slider, { label: 'Frame band', value: fab.band, min: 1, max: 60, step: 0.5, unit: 'mm', onChange: (v) => onFab('band', v) }) : null,
      fab.shape === 'roundrect' ? h(Slider, { label: 'Corner radius', value: fab.radius, min: 0, max: 80, step: 1, unit: 'mm', onChange: (v) => onFab('radius', v) }) : null,
      fab.shape !== 'none' ? h(Slider, { label: 'Mounting holes', value: fab.holes, min: 0, max: 16, step: 1, int: true, onChange: (v) => onFab('holes', v) }) : null,
      fab.shape !== 'none' && fab.holes > 0 ? h(Slider, { label: 'Hole diameter', value: fab.holeDia, min: 1, max: 20, step: 0.1, unit: 'mm', onChange: (v) => onFab('holeDia', v) }) : null,
      fab.shape !== 'none' ? h(Toggle, { label: 'Keyhole hanger tab', value: fab.hanger, onChange: (v) => onFab('hanger', v) }) : null,
    ),
    h(Section, { title: 'Kerf & tool offset' },
      h(Slider, {
        label: 'Kerf / tool Ø compensation', value: fab.kerf, min: -3, max: 3, step: 0.01, unit: 'mm',
        onChange: (v) => onFab('kerf', v),
      }),
      h('p', { className: 'hint' },
        'Positive grows material by half the value on every contour — dial in laser beam width, plasma arc width or endmill diameter. ',
        h('em', null, 'CO₂ laser ≈ 0.15 mm · fibre ≈ 0.10 mm · plasma ≈ 1.5 mm · 3 mm endmill = 3.0.'),
      ),
    ),
    h(Section, { title: 'Structural integrity' },
      h('div', { className: cx('integrity', islands ? 'is-bad' : 'is-good') },
        h('span', { className: 'integrity-dot' }),
        islands
          ? `${islands} floating island${islands === 1 ? '' : 's'} — fallout will drop out of the sheet`
          : 'All geometry is one connected body',
      ),
      h(Slider, { label: 'Minimum web / bridge width', value: fab.bridgeWidth, min: 0.3, max: 12, step: 0.1, unit: 'mm', onChange: (v) => onFab('bridgeWidth', v) }),
      h(Toggle, { label: 'Auto-bridge fallout to frame', value: fab.autoBridge, onChange: (v) => onFab('autoBridge', v) }),
      design.bridgeReport && design.bridgeReport.bridged
        ? h('p', { className: 'hint' }, `${design.bridgeReport.bridged} tether${design.bridgeReport.bridged === 1 ? '' : 's'} injected` +
            (design.bridgeReport.failed ? `, ${design.bridgeReport.failed} could not be reached` : '') + '.')
        : null,
      h(Slider, { label: 'Minimum feature width', value: fab.minWeb, min: 0.2, max: 12, step: 0.1, unit: 'mm', onChange: (v) => onFab('minWeb', v) }),
    ),
    h(Section, { title: 'Clean CAD output' },
      h('div', { className: cx('integrity', fab.trim ? 'is-good' : 'is-warn') },
        h('span', { className: 'integrity-dot' }),
        fab.trim
          ? (design.trimStats && design.trimStats.out !== undefined
            ? `Trimmed: ${design.trimStats.in} contours → ${design.trimStats.out}, no overlaps`
            : 'Overlaps resolved into clean contours')
          : 'Raw contours — shapes may overlap and double-cut',
      ),
      h(Toggle, { label: 'Trim overlaps into clean contours', value: fab.trim, onChange: (v) => onFab('trim', v) }),
      h('p', { className: 'hint' },
        'Resolves the whole design into non-overlapping closed contours: crossings are split, ',
        'coincident and duplicate edges collapse, and interior segments are removed. ',
        'What lands in your CAD package is exactly the outline of the material and nothing else.',
      ),
      design.trimStats && design.trimStats.tooBig
        ? h('p', { className: 'hint' }, `Too complex to trim (${design.trimStats.segments.toLocaleString()} segments). Reduce tiling density or feature count.`)
        : null,
    ),
  );
}

/* ------------------------------------------------------------------ *
 * Fabrication HUD
 * ------------------------------------------------------------------ */
export function FabricationHUD({ design, units, onUnits, trimmed }) {
  const m = design.metrics;
  const imperial = units === 'in';
  const D = (mm) => (imperial ? (mm / 25.4).toFixed(2) + '"' : mm.toFixed(1));
  const A = (mm2) => (imperial
    ? (mm2 / 645.16).toFixed(1)
    : mm2 > 10000 ? (mm2 / 100).toFixed(0) : mm2.toFixed(0));
  const islands = design.analysis ? design.analysis.floating.size : 0;

  return h('div', { className: 'hud' },
    h(Stat, { label: 'Part size', value: `${D(m.width)} × ${D(m.height)}`, unit: imperial ? '' : 'mm' }),
    h(Stat, { label: 'Material area', value: A(m.materialArea), unit: imperial ? 'in²' : 'cm²' }),
    h(Stat, { label: 'Material yield', value: m.yieldPct.toFixed(1), unit: '%' }),
    h(Stat, { label: 'Fallout waste', value: m.wastePct.toFixed(1), unit: '%' }),
    h(Stat, { label: 'Sheet used', value: m.sheetUsePct.toFixed(1), unit: '%', tone: m.fitsSheet ? null : 'bad' }),
    h(Stat, { label: 'Islands', value: islands, tone: islands ? 'bad' : 'good' }),
    h(Stat, { label: 'Contours', value: design.loops.length.toLocaleString() }),
    h(Stat, { label: 'Vertices', value: m.vertices.toLocaleString() }),
    h(Stat, {
      label: 'Overlaps',
      value: trimmed ? 'trimmed' : 'raw',
      tone: trimmed ? 'good' : 'bad',
    }),
    h('div', { className: 'hud-spacer' }),
    h(SegmentedControl, {
      value: units,
      options: [{ v: 'mm', label: 'mm' }, { v: 'in', label: 'in' }],
      onChange: onUnits,
      className: 'hud-units',
    }),
  );
}

/* ------------------------------------------------------------------ *
 * Export bay
 * ------------------------------------------------------------------ */
function download(name, data, mime) {
  const blob = data instanceof ArrayBuffer ? new Blob([data], { type: mime }) : new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function ExportPanel({ design, state, onLoadPreset, onTrim }) {
  const [dxfVer, setDxfVer] = useState('r14');
  const [svgFilled, setSvgFilled] = useState(false);
  const [fit, setFit] = useState('arcs');
  const [fitTol, setFitTol] = useState(0.02);
  const fitOpts = { mode: fit, tol: fitTol };
  const stats = useMemo(
    () => fitStats(design.loops.concat(design.scoreLines), fitOpts),
    [design, fit, fitTol],
  );
  const fileRef = useRef(null);
  const base = `${state.engine}-${state.seed}`;

  const saveJson = () => {
    const doc = {
      format: 'tessellate-cad/preset', version: 1,
      engine: state.engine, seed: state.seed,
      params: state.params, mods: state.mods, fab: state.fab, canvas: state.canvas,
      brushes: state.brushes || [],
      savedAt: new Date().toISOString(),
    };
    download(`${base}.json`, JSON.stringify(doc, null, 2), 'application/json');
  };

  const loadJson = (ev) => {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try { onLoadPreset(JSON.parse(r.result)); }
      catch (e) { alert('Could not read that preset: ' + e.message); }
    };
    r.readAsText(f);
    ev.target.value = '';
  };

  const trimmed = !!state.fab.trim;
  return h('div', null,
    h(Section, { title: 'Clean output' },
      h('div', { className: cx('integrity', trimmed ? 'is-good' : 'is-warn') },
        h('span', { className: 'integrity-dot' }),
        trimmed
          ? (design.trimStats && design.trimStats.out !== undefined
            ? `Non-overlapping: ${design.trimStats.in} → ${design.trimStats.out} contours`
            : 'Non-overlapping contours')
          : 'Contours may overlap — exports will double-cut'),
      h(Button, {
        variant: trimmed ? 'ghost' : 'primary', size: 'lg',
        onClick: () => onTrim(!trimmed),
        children: trimmed ? 'Disable trimming (raw contours)' : 'Trim overlaps now',
      }),
    ),
    h(Section, { title: 'Curve fitting' },
      h(Select, {
        label: 'Recover curves',
        value: fit,
        options: [
          { v: 'arcs', label: 'Circles & arcs (recommended)' },
          { v: 'splines', label: 'Circles, arcs & splines' },
          { v: 'off', label: 'Off — straight segments only' },
        ],
        onChange: setFit,
      }),
      fit !== 'off' && h(Slider, {
        label: 'Fitting tolerance', value: fitTol, min: 0.002, max: 0.25, step: 0.002,
        unit: 'mm', onChange: setFitTol,
      }),
      h('div', { className: cx('integrity', 'is-good') },
        h('span', { className: 'integrity-dot' }),
        fit === 'off'
          ? `${stats.before.toLocaleString()} straight segments`
          : `${stats.before.toLocaleString()} points → ${stats.circles} circles, ` +
            `${stats.arcs.toLocaleString()} arcs, ${stats.splines.toLocaleString()} splines, ` +
            `${stats.lines.toLocaleString()} lines`),
      h('p', { className: 'hint' },
        'Every curve is flattened to polylines internally, because that is what the ' +
        'boolean trim and the mesher can both work on. Fitting runs at export: ' +
        'runs of points that lie on a common circle come back out as true ' +
        'CIRCLE and arc geometry, so a ring imports as a ring rather than a ' +
        '220-sided polygon. Every original point stays within the tolerance above.'),
    ),
    h(Section, { title: 'Vector output' },
      h('div', { className: 'export-row' },
        h(Button, {
          variant: 'primary', size: 'lg',
          onClick: () => download(`${base}.dxf`, exportDXF(design, { version: dxfVer, fit, fitTol }), 'application/dxf'),
          children: 'Download DXF',
        }),
        h(Select, {
          value: dxfVer,
          options: [
            { v: 'r14', label: 'AutoCAD 2000 · LWPOLYLINE' },
            { v: 'r12', label: 'R12 · POLYLINE' },
          ],
          onChange: setDxfVer,
        }),
      ),
      h('p', { className: 'hint' },
        'True 1:1 mm geometry, closed polylines, split across ',
        h('code', null, '0_OUTER_FRAME'), ' / ', h('code', null, '1_CUT_THROUGH'), ' / ',
        h('code', null, '2_SCORE_ENGRAVE'), '. Opens cleanly in LightBurn, Fusion 360, SolidWorks, Aspire and AutoCAD.',
      ),
      h('div', { className: 'export-row' },
        h(Button, {
          variant: 'primary', size: 'lg',
          onClick: () => download(`${base}.svg`, exportSVG(design, { filled: svgFilled, margin: 2, fit, fitTol }), 'image/svg+xml'),
          children: 'Download SVG',
        }),
        h(Toggle, { label: 'Filled compound paths', value: svgFilled, onChange: setSvgFilled }),
      ),
    ),
    h(Section, { title: '3D output' },
      h(Button, {
        variant: 'primary', size: 'lg',
        onClick: () => download(`${base}.stl`, exportSTL(design, state.fab.thickness, base), 'model/stl'),
        children: 'Download binary STL',
      }),
      h('p', { className: 'hint' }, `Extruded to the ${state.fab.thickness} mm stock thickness — the same mesh shown in the 3D viewport.`),
    ),
    h(Section, { title: 'Parametric preset' },
      h('div', { className: 'export-row' },
        h(Button, { onClick: saveJson, children: 'Save .json' }),
        h(Button, { onClick: () => fileRef.current && fileRef.current.click(), children: 'Load .json' }),
        h('input', { type: 'file', accept: '.json,application/json', ref: fileRef, onChange: loadJson, style: { display: 'none' } }),
      ),
      h('p', { className: 'hint' }, 'Every slider, the seed and the frame settings — shareable and reproducible byte-for-byte.'),
    ),
  );
}

/* ------------------------------------------------------------------ *
 * Showcase gallery (thumbnails generated live from the real engines)
 * ------------------------------------------------------------------ */
export function Gallery({ open, onClose, onPick, activeId }) {
  const [thumbs, setThumbs] = useState({});

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let i = 0;
    const step = () => {
      if (cancelled || i >= PRESETS.length) return;
      const p = PRESETS[i++];
      try {
        const d = buildDesign({ ...p, canvas: { W: 200, H: 200 } });
        const svg = thumbnailSVG(d, 150, '#e9e6df');
        setThumbs((t) => ({ ...t, [p.id]: 'data:image/svg+xml;utf8,' + encodeURIComponent(svg) }));
      } catch (e) { /* keep going */ }
      setTimeout(step, 0);
    };
    step();
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return h('div', { className: 'gallery-scrim', onClick: onClose },
    h('div', {
      className: 'gallery', onClick: (e) => e.stopPropagation(),
      role: 'dialog', 'aria-modal': true, 'aria-label': 'Showcase gallery',
    },
      h('header', { className: 'gallery-head' },
        h('h2', null, 'Showcase gallery'),
        h('p', null, 'One click to a complete, production-ready starting point.'),
        h('button', { className: 'gallery-x', onClick: onClose, type: 'button', 'aria-label': 'Close gallery', autoFocus: true }, '×'),
      ),
      h('div', { className: 'gallery-grid' },
        PRESETS.map((p) => h('button', {
          key: p.id, type: 'button',
          className: cx('gallery-card', activeId === p.id && 'is-active'),
          onClick: () => { onPick(p); onClose(); },
        },
          h('div', { className: 'gallery-thumb' },
            thumbs[p.id]
              ? h('img', { src: thumbs[p.id], alt: p.name, draggable: false })
              : h('div', { className: 'gallery-skel' }),
          ),
          h('div', { className: 'gallery-name' }, p.name),
          h('div', { className: 'gallery-note' }, p.note),
        )),
      ),
    ),
  );
}
