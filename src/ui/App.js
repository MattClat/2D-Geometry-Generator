/* =========================================================================
 * App.js — application shell
 * =======================================================================*/
import h, { cx, useState, useEffect, useRef, useMemo, useCallback } from '../lib/h.js';
import { Button, IconButton, Slider, Toggle, Select, Section, SegmentedControl, Notice } from './widgets.js';
import { EnginePicker, PatternPanel, ModifierPanel, FabricationPanel, FabricationHUD, ExportPanel, Gallery } from './panels.js';
import { Viewport2D, Viewport3D } from './viewports.js';
import { buildDesign, DEFAULT_CANVAS } from '../engine/build.js';
import { defaultParams, ENGINE_BY_ID } from '../engine/patterns/index.js';
import { sanitizeState, sanitizeSeed, isEngineId } from '../engine/sanitize.js';
import { PRESETS } from '../engine/presets.js';
import { diceRoll, evolve, randomizeParams } from '../engine/random.js';
import { THEMES } from '../render/canvas2d.js';

const initialState = () => {
  const p = PRESETS[0];
  return {
    engine: p.engine, seed: p.seed,
    params: { ...p.params }, mods: { ...p.mods }, fab: { ...p.fab },
    canvas: { ...DEFAULT_CANVAS },
    presetId: p.id,
    brushes: [],
  };
};

/* Debounced, self-pacing rebuild: slider drags stay smooth even when a
   design takes 300 ms to generate, because the delay adapts to how long the
   last build actually took. */
function useDesign(state) {
  const [design, setDesign] = useState(() => buildDesign(state));
  const [busy, setBusy] = useState(false);
  const lastMs = useRef(0);
  const key = useMemo(() => JSON.stringify(state), [state]);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setBusy(true);
    const delay = Math.min(240, Math.max(0, lastMs.current - 8));
    let raf = 0;
    const timer = setTimeout(() => {
      raf = requestAnimationFrame(() => {
        const d = buildDesign(state);
        lastMs.current = d.buildMs;
        setDesign(d);
        setBusy(false);
      });
    }, delay);
    return () => { clearTimeout(timer); cancelAnimationFrame(raf); };
  }, [key]);

  return [design, busy];
}

export function App() {
  const [state, setStateRaw] = useState(initialState);
  const [history, setHistory] = useState([]);
  const [future, setFuture] = useState([]);
  const [tab, setTab] = useState('pattern');
  const [layout, setLayout] = useState('split');
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [units, setUnits] = useState('mm');
  const [material, setMaterial] = useState('walnut');
  const [autoRotate, setAutoRotate] = useState(false);
  const [brushMode, setBrushMode] = useState('off');
  const [brushRadius, setBrushRadius] = useState(45);
  const [brushStrength, setBrushStrength] = useState(0.5);
  const [liveBrush, setLiveBrush] = useState(null);
  const [theme, setTheme] = useState('studio');
  const [vpOpts, setVpOpts] = useState({
    mode: 'solid', nodes: false, grid: true, showIslands: true,
    autoFit: true, sheet: true, theme: 'studio',
  });
  const [dismissed, setDismissed] = useState({});

  // State lives in a ref as well, so mutators compute the next state
  // directly instead of inside a setState updater. Updaters must be pure
  // (React may run them twice); pushing undo history from inside one did not.
  const stateRef = useRef(state);
  stateRef.current = state;
  const gestureRef = useRef({ key: null, t: 0 });
  const setState = useCallback((updater, { snapshot = true, gesture = null } = {}) => {
    const prev = stateRef.current;
    const next = typeof updater === 'function' ? updater(prev) : updater;
    if (next === prev) return;
    // A slider drag fires dozens of changes; record one undo step per gesture
    // (same control, changes less than 700 ms apart) rather than one per tick.
    const now = Date.now();
    const g = gestureRef.current;
    const continuing = gesture && g.key === gesture && now - g.t < 700;
    gestureRef.current = { key: gesture, t: now };
    if (snapshot && !continuing) {
      setHistory((hst) => [...hst.slice(-40), prev]);
      setFuture([]);
    }
    stateRef.current = next;
    setStateRaw(next);
  }, []);

  const liveState = useMemo(
    () => (liveBrush ? { ...state, brushes: [...state.brushes, liveBrush] } : state),
    [state, liveBrush],
  );
  const [design, busy] = useDesign(liveState);

  useEffect(() => { setVpOpts((o) => ({ ...o, theme, sheetW: state.fab.sheetW, sheetH: state.fab.sheetH })); },
    [theme, state.fab.sheetW, state.fab.sheetH]);

  /* ---------------- mutators ---------------- */
  const setParam = (k, v) => setState((s) => ({ ...s, params: { ...s.params, [k]: v }, presetId: null }), { gesture: 'p:' + k });
  const setMod = (k, v) => setState((s) => ({ ...s, mods: { ...s.mods, [k]: v }, presetId: null }), { gesture: 'm:' + k });
  const setFab = (k, v) => setState((s) => ({ ...s, fab: { ...s.fab, [k]: v }, presetId: null }), { gesture: 'f:' + k });
  const setCanvas = (c) => setState((s) => ({ ...s, canvas: c }), { gesture: 'canvas' });

  const pickEngine = (id) => setState((s) => ({
    ...s, engine: id, params: defaultParams(id), presetId: null,
  }));

  // Presets and loaded files go through the same sanitiser as the engine, so
  // the sliders never show a value the engine would silently clamp.
  const applyPreset = (p) => setState(() => ({
    ...sanitizeState({ ...p, brushes: p.brushes || [] }),
    presetId: p.id || null,
  }));

  const loadPresetFile = (doc) => {
    if (!doc || typeof doc !== 'object' || !isEngineId(doc.engine)) {
      alert('Not a Tessellate preset file.');
      return;
    }
    applyPreset({ ...doc, id: null });
  };

  const roll = (lockEngine) => setState((s) => {
    const r = diceRoll((Math.random() * 0xffffffff) >>> 0, lockEngine ? s.engine : null);
    return { ...s, ...r, canvas: s.canvas, presetId: null, brushes: [] };
  });

  const doEvolve = (amount) => setState((s) => evolve(s, amount, (Math.random() * 0xffffffff) >>> 0));

  const undo = () => {
    if (!history.length) return;
    const prev = history[history.length - 1];
    setFuture((f) => [stateRef.current, ...f].slice(0, 40));
    setHistory(history.slice(0, -1));
    gestureRef.current = { key: null, t: 0 };
    stateRef.current = prev;
    setStateRaw(prev);
  };
  const redo = () => {
    if (!future.length) return;
    const next = future[0];
    setHistory((hst) => [...hst, stateRef.current]);
    setFuture(future.slice(1));
    gestureRef.current = { key: null, t: 0 };
    stateRef.current = next;
    setStateRaw(next);
  };

  // The viewport hands over the exact brush it last drew, so a pointerup that
  // lands before React re-renders cannot commit a stale one.
  const commitBrush = (b) => {
    setLiveBrush(null);
    if (!b) return;
    setState((s) => ({ ...s, brushes: [...s.brushes, b] }));
  };

  /* ---------------- seed box ---------------- */
  // Edited as text and committed on Enter / blur: a number input re-parsed on
  // every keystroke mangled partial entries and silently wrapped big values.
  const [seedText, setSeedText] = useState(null);
  const commitSeed = () => {
    if (seedText === null) return;
    const v = sanitizeSeed(seedText.trim(), stateRef.current.seed);
    setSeedText(null);
    if (v !== stateRef.current.seed) setState((s) => ({ ...s, seed: v }));
  };

  /* ---------------- keyboard ---------------- */
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      if (t && (/^(input|select|textarea|button)$/i.test(t.tagName) || t.isContentEditable)) return;
      if (galleryOpen) return;                       // the gallery handles its own keys
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'y') {
        e.preventDefault(); redo(); return;
      }
      // plain single-key shortcuts only — leave browser chords like Ctrl+R alone
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      if (e.key === ' ') { e.preventDefault(); roll(true); }
      else if (e.key.toLowerCase() === 'r') roll(false);
      else if (e.key.toLowerCase() === 'e') doEvolve(0.1);
      else if (e.key.toLowerCase() === 'g') setGalleryOpen((v) => !v);
      else if (e.key === '1') setLayout('2d');
      else if (e.key === '2') setLayout('3d');
      else if (e.key === '3') setLayout('split');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const eng = ENGINE_BY_ID[state.engine];
  const warnings = design.warnings.filter((w) => !dismissed[w]);

  /* ---------------- render ---------------- */
  return h('div', { className: cx('app', `theme-${theme}`) },
    /* ---- top bar ---- */
    h('header', { className: 'topbar' },
      h('div', { className: 'brand' },
        h('span', { className: 'brand-mark' }, '◈'),
        h('span', { className: 'brand-name' }, 'Tessellate'),
        h('span', { className: 'brand-sub' }, 'CAD'),
      ),
      h('div', { className: 'topbar-group' },
        h(Button, { variant: 'dice', size: 'lg', onClick: () => roll(false), title: 'Randomise everything (R)', children: h('span', null, '⚄  Surprise me') }),
        h(Button, { onClick: () => roll(true), title: 'Reroll this engine only (Space)', children: 'Reroll' }),
        h(Button, { onClick: () => doEvolve(0.1), title: 'Mutate ±10% (E)', children: 'Evolve ±10%' }),
        h(Button, { onClick: () => doEvolve(0.28), title: 'Mutate ±28%', children: '±28%' }),
      ),
      h('div', { className: 'topbar-group seed-group' },
        h('label', { className: 'seed-label' }, 'Seed'),
        h('input', {
          className: 'seed-input', type: 'text', inputMode: 'numeric',
          'aria-label': 'Seed', spellCheck: false,
          value: seedText !== null ? seedText : String(state.seed),
          onChange: (e) => setSeedText(e.target.value.replace(/[^0-9]/g, '').slice(0, 10)),
          onBlur: commitSeed,
          onKeyDown: (e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            else if (e.key === 'Escape') { setSeedText(null); e.currentTarget.blur(); }
          },
        }),
        h(IconButton, { title: 'New seed', onClick: () => setState((s) => ({ ...s, seed: (Math.random() * 0xffffffff) >>> 0 })), children: '⟳' }),
      ),
      h('div', { className: 'topbar-group' },
        h(IconButton, { title: 'Undo (⌘Z)', onClick: undo, disabled: !history.length, children: '↶' }),
        h(IconButton, { title: 'Redo (⇧⌘Z)', onClick: redo, disabled: !future.length, children: '↷' }),
      ),
      h('div', { className: 'topbar-spacer' }),
      h(SegmentedControl, {
        value: layout,
        options: [{ v: '2d', label: '2D' }, { v: '3d', label: '3D' }, { v: 'split', label: 'Split' }],
        onChange: setLayout,
      }),
      h(Select, {
        value: theme,
        options: Object.values(THEMES).map((t) => ({ v: t.id, label: t.label })),
        onChange: setTheme,
      }),
      h(Button, { variant: 'primary', onClick: () => setGalleryOpen(true), title: 'Showcase gallery (G)', children: 'Gallery' }),
    ),

    /* ---- body ---- */
    h('div', { className: 'body' },
      h('aside', { className: 'rail' },
        h('div', { className: 'rail-title' }, 'Pattern engines'),
        h(EnginePicker, { engine: state.engine, onEngine: pickEngine }),
        h('div', { className: 'rail-title' }, 'Canvas brushes'),
        h('div', { className: 'brush-bar' },
          h(SegmentedControl, {
            value: brushMode,
            options: [
              { v: 'off', label: 'Off' },
              { v: 'ripple', label: 'Ripple' },
              { v: 'pinch', label: 'Pinch' },
              { v: 'magnet', label: 'Magnet' },
              { v: 'twist', label: 'Twist' },
            ],
            onChange: setBrushMode,
          }),
        ),
        brushMode !== 'off' ? h('div', { className: 'rail-controls' },
          h(Slider, { label: 'Brush radius', value: brushRadius, min: 5, max: 250, step: 1, unit: 'mm', onChange: setBrushRadius }),
          h(Slider, { label: 'Brush strength', value: brushStrength, min: -1.5, max: 1.5, step: 0.01, onChange: setBrushStrength }),
          h('div', { className: 'export-row' },
            h(Button, { onClick: () => setState((s) => ({ ...s, brushes: [] })), disabled: !state.brushes.length, children: `Clear ${state.brushes.length} warp${state.brushes.length === 1 ? '' : 's'}` }),
          ),
          h('p', { className: 'hint' }, 'Drag on the 2D canvas to deform the pattern locally. Shift-drag always pans.'),
        ) : null,
      ),

      h('main', { className: cx('stage', `layout-${layout}`) },
        h('div', { className: 'stage-views' },
          layout !== '3d' ? h(Viewport2D, {
            key: 'vp2d',
            design, opts: vpOpts, onOptsChange: setVpOpts,
            brushMode, brushRadius, brushStrength,
            onBrush: setLiveBrush, onCommitBrush: commitBrush,
          }) : null,
          layout !== '2d' ? h(Viewport3D, {
            key: 'vp3d',
            design, thickness: state.fab.thickness, materialId: material,
            onMaterial: setMaterial, autoRotate, onAutoRotate: setAutoRotate,
          }) : null,
        ),
        warnings.length ? h('div', { className: 'warn-stack' },
          warnings.slice(0, 3).map((w) => h('div', { key: w },
            h(Notice, {
              tone: /error/i.test(w) ? 'bad' : 'warn',
              children: w,
              onDismiss: () => setDismissed((d) => ({ ...d, [w]: true })),
            }))),
        ) : null,
        h(FabricationHUD, { design, units, onUnits: setUnits, trimmed: !!state.fab.trim }),
      ),

      h('aside', { className: 'inspector' },
        h('div', { className: 'inspector-tabs' },
          h(SegmentedControl, {
            value: tab,
            options: [
              { v: 'pattern', label: 'Pattern' },
              { v: 'modifiers', label: 'Modifiers' },
              { v: 'fab', label: 'Fabrication' },
              { v: 'export', label: 'Export' },
            ],
            onChange: setTab,
          }),
        ),
        h('div', { className: 'inspector-body' },
          tab === 'pattern' ? h('div', null,
            h('h2', { className: 'inspector-title' }, eng ? eng.name : ''),
            h(PatternPanel, { engine: state.engine, params: state.params, onParam: setParam }),
            h('div', { className: 'export-row' },
              h(Button, { onClick: () => setState((s) => ({ ...s, params: defaultParams(s.engine) })), children: 'Reset defaults' }),
              h(Button, { onClick: () => setState((s) => ({ ...s, params: randomizeParams(s.engine, (Math.random() * 0xffffffff) >>> 0) })), children: 'Randomise these' }),
            ),
          ) : null,
          tab === 'modifiers' ? h(ModifierPanel, {
            mods: state.mods, onMod: setMod,
            onResetGroup: (g) => setState((s) => {
              const m = { ...s.mods };
              for (const it of g.items) m[it.key] = it.def;
              return { ...s, mods: m };
            }),
          }) : null,
          tab === 'fab' ? h(FabricationPanel, {
            fab: state.fab, onFab: setFab, design,
            canvas: state.canvas, onCanvas: setCanvas,
          }) : null,
          tab === 'export' ? h(ExportPanel, { design, state, onLoadPreset: loadPresetFile, onTrim: (v) => setFab('trim', v) }) : null,
        ),
      ),
    ),

    busy ? h('div', { className: 'busy-pip' }, 'generating…') : null,
    h(Gallery, { open: galleryOpen, onClose: () => setGalleryOpen(false), onPick: applyPreset, activeId: state.presetId }),
  );
}
