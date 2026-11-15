/* =========================================================================
 * sanitize.js — clamp a whole design state to what the controls allow
 *
 * Every number in a design can arrive from somewhere other than a slider: a
 * .json preset someone shared, an old save from a previous version, a typo.
 * The sliders bound what a user can *drag*; nothing bounded what a file could
 * *say*. A preset asking for 5,000 × 5,000 tiles froze the tab, one asking for
 * a hex cell of size 0 never returned, and one asking for a billion mounting
 * holes ran the page out of memory.
 *
 * So every value is clamped to the same range its control exposes, every
 * select is checked against its options, and anything unparseable falls back
 * to the default. buildDesign() runs this too, so the engine is safe even if a
 * caller forgets.
 * =======================================================================*/
import { MODIFIER_SCHEMA, DEFAULT_MODIFIERS } from './modifiers.js';
import { DEFAULT_FAB, FRAME_SHAPES } from './fabrication.js';
import { ENGINE_BY_ID, sanitizeParams } from './patterns/index.js';

/** Canvas size range, matching the "Design width / height" sliders. */
export const CANVAS_LIMITS = { min: 40, max: 900 };

/**
 * Fabrication ranges, matching the Fabrication panel. Kept here rather than
 * read from the UI so that the engine owns its own limits.
 */
export const FAB_SCHEMA = {
  shape: { type: 'select', options: FRAME_SHAPES.map((s) => s.v) },
  band: { min: 1, max: 60 },
  radius: { min: 0, max: 80 },
  holes: { min: 0, max: 16, int: true },
  holeDia: { min: 1, max: 20 },
  hanger: { type: 'toggle' },
  kerf: { min: -3, max: 3 },
  minWeb: { min: 0.2, max: 12 },
  bridgeWidth: { min: 0.3, max: 12 },
  autoBridge: { type: 'toggle' },
  showIslands: { type: 'toggle' },
  trim: { type: 'toggle' },
  sheetW: { min: 50, max: 3000 },
  sheetH: { min: 50, max: 3000 },
  thickness: { min: 0.2, max: 30 },
};

const num = (v, def, min, max, int) => {
  let x = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(x)) x = def;
  x = Math.min(max, Math.max(min, x));
  return int ? Math.round(x) : x;
};

export function sanitizeMods(m) {
  const src = m && typeof m === 'object' ? m : {};
  const out = { ...DEFAULT_MODIFIERS };
  for (const group of MODIFIER_SCHEMA) {
    for (const it of group.items) {
      const v = src[it.key];
      if (v === undefined) continue;
      if (it.type === 'range') out[it.key] = num(v, it.def, it.min, it.max, it.int);
      else if (it.type === 'toggle') out[it.key] = !!v;
      else if (it.type === 'select') {
        out[it.key] = it.options.some((o) => o.v === v) ? v : it.def;
      }
    }
  }
  return out;
}

export function sanitizeFab(f) {
  const src = f && typeof f === 'object' ? f : {};
  const out = { ...DEFAULT_FAB };
  for (const [key, s] of Object.entries(FAB_SCHEMA)) {
    const v = src[key];
    if (v === undefined) continue;
    if (s.type === 'toggle') out[key] = !!v;
    else if (s.type === 'select') out[key] = s.options.includes(v) ? v : DEFAULT_FAB[key];
    else out[key] = num(v, DEFAULT_FAB[key], s.min, s.max, s.int);
  }
  return out;
}

export function sanitizeCanvas(c, def = { W: 300, H: 300 }) {
  const src = c && typeof c === 'object' ? c : {};
  return {
    W: num(src.W, def.W, CANVAS_LIMITS.min, CANVAS_LIMITS.max),
    H: num(src.H, def.H, CANVAS_LIMITS.min, CANVAS_LIMITS.max),
  };
}

/**
 * Canvas brushes. Bounded in count and in every field, because each one adds a
 * densify-and-warp pass over the whole design.
 */
export const MAX_BRUSHES = 64;
const BRUSH_TYPES = ['ripple', 'pinch', 'magnet', 'twist'];
export function sanitizeBrushes(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const b of list.slice(0, MAX_BRUSHES)) {
    if (!b || typeof b !== 'object') continue;
    const x = Number(b.x), y = Number(b.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    out.push({
      type: BRUSH_TYPES.includes(b.type) ? b.type : 'twist',
      x: num(x, 0, -5000, 5000), y: num(y, 0, -5000, 5000),
      dx: num(b.dx, 0, -5000, 5000), dy: num(b.dy, 0, -5000, 5000),
      radius: num(b.radius, 40, 1, 2000),
      strength: num(b.strength, 0.5, -4, 4),
    });
  }
  return out;
}

/** An engine id that really is one of ours — not "constructor" or "__proto__". */
export const isEngineId = (id) => typeof id === 'string' && Object.hasOwn(ENGINE_BY_ID, id);

/** Seeds are unsigned 32-bit integers; anything else falls back. */
export function sanitizeSeed(s, def = 1) {
  const x = typeof s === 'string' && /^\d+$/.test(s.trim()) ? Number(s) : s;
  if (typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x > 0xffffffff) return def;
  return Math.floor(x);
}

/**
 * Sanitise a whole design state. Unknown engines fall back to `fallbackEngine`.
 * Keys this module does not know about are dropped.
 */
export function sanitizeState(s, fallbackEngine = 'kagome') {
  const src = s && typeof s === 'object' ? s : {};
  const engine = isEngineId(src.engine) ? src.engine : fallbackEngine;
  return {
    engine,
    seed: sanitizeSeed(src.seed, 1),
    params: sanitizeParams(engine, src.params),
    mods: sanitizeMods(src.mods),
    fab: sanitizeFab(src.fab),
    canvas: sanitizeCanvas(src.canvas),
    brushes: sanitizeBrushes(src.brushes),
  };
}
