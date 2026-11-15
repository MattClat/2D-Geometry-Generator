/* =========================================================================
 * patterns/index.js — engine registry
 * =======================================================================*/
import { kagome, waves, plait } from './weaves.js';
import { chainmail } from './lattice.js';
import { encaustic, herringbone, brickwork } from './tiles.js';
import { memphis, isocubes, opart } from './retro.js';
import { truchet, maze, isolines, voronoi } from './organic.js';
import { sacred } from './sacred.js';

export const ENGINES = [
  kagome, chainmail, waves, plait,
  encaustic, herringbone, brickwork,
  memphis, isocubes, opart,
  truchet, maze, isolines, voronoi,
  sacred,
];

/**
 * Fill rule an engine's output is designed around.
 * Most engines draw strokes and solids that should *union*, so nonzero is
 * right. Encaustic medallions are built the classical way — overlapping
 * circles and petals whose intersections are meant to punch back out — so
 * they need even-odd.
 */
export const engineFillRule = (id) => (ENGINE_BY_ID[id] && ENGINE_BY_ID[id].fillRule) || 'nonzero';

export const ENGINE_BY_ID = Object.fromEntries(ENGINES.map((e) => [e.id, e]));

export const CATEGORIES = ENGINES.reduce((acc, e) => {
  (acc[e.category] = acc[e.category] || []).push(e);
  return acc;
}, {});

/** Default parameter block for an engine. */
export function defaultParams(engineId) {
  const eng = ENGINE_BY_ID[engineId];
  if (!eng) return {};
  const P = {};
  for (const p of eng.params) P[p.key] = p.def;
  return P;
}

/** Clamp/repair a parameter block against its schema (used when loading JSON). */
export function sanitizeParams(engineId, P) {
  const eng = ENGINE_BY_ID[engineId];
  if (!eng) return {};
  const out = {};
  for (const p of eng.params) {
    let v = P && P[p.key] !== undefined ? P[p.key] : p.def;
    if (p.type === 'range') {
      v = Number(v);
      if (!isFinite(v)) v = p.def;
      v = Math.max(p.min, Math.min(p.max, v));
      if (p.int) v = Math.round(v);
    } else if (p.type === 'toggle') v = !!v;
    else if (p.type === 'select' && !p.options.some((o) => o.v === v)) v = p.def;
    out[p.key] = v;
  }
  return out;
}
