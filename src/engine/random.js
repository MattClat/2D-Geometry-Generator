/* =========================================================================
 * random.js — the Dice Roll
 *
 * A naive uniform randomiser produces mush. This one keeps every parameter
 * inside *harmonious* bounds: counts snap to musically-related integers,
 * ratios land on small rational numbers, deformations stay in the range where
 * geometry remains cuttable, and stroke weights stay proportional to feature
 * pitch so the result is always physically manufacturable.
 * =======================================================================*/
import { makeRng } from './rng.js';
import { ENGINES, ENGINE_BY_ID, defaultParams } from './patterns/index.js';
import { DEFAULT_MODIFIERS } from './modifiers.js';
import { DEFAULT_FAB, FRAME_SHAPES } from './fabrication.js';

/** Small rationals + Fibonacci-ish counts read as "designed", not random. */
const NICE_COUNTS = [3, 4, 5, 6, 8, 10, 12, 13, 16, 20, 21, 24, 32];
const NICE_RATIOS = [0.25, 0.333, 0.382, 0.5, 0.618, 0.667, 0.75, 0.809, 1];

function harmoniousValue(p, rng) {
  if (p.type === 'toggle') return rng.bool(0.55);
  if (p.type === 'select') return rng.pick(p.options).v;
  const span = p.max - p.min;
  if (p.int) {
    const nice = NICE_COUNTS.filter((n) => n >= p.min && n <= p.max);
    if (nice.length && rng.bool(0.7)) return rng.pick(nice);
    return Math.round(p.min + span * (0.15 + rng() * 0.7));
  }
  // stay away from the degenerate extremes of each slider
  if (p.unit === '×' && p.min >= 0 && p.max <= 1.5 && rng.bool(0.5)) {
    const r = rng.pick(NICE_RATIOS);
    return Math.max(p.min, Math.min(p.max, r));
  }
  const t = 0.12 + Math.pow(rng(), 1.15) * 0.72;
  const v = p.min + span * t;
  return Math.round(v / p.step) * p.step;
}

/**
 * Keep feature density sane. A 4 mm cell across a 300 mm field is 5,000 tiles
 * — the result is mud, it is not cuttable, and it stalls the interactive
 * rebuild. Roughly 16 features across is the busiest that still reads.
 */
const NOMINAL_FIELD = 300;
function capDensity(engineId, P) {
  const eng = ENGINE_BY_ID[engineId];
  if (!eng) return P;
  for (const key of ['cell', 'pitch', 'density', 'brickW', 'plankL', 'repel']) {
    if (P[key] === undefined) continue;
    const schema = eng.params.find((q) => q.key === key);
    if (!schema) continue;
    const floor = Math.min(schema.max, NOMINAL_FIELD / 16);
    if (P[key] < floor) P[key] = Math.max(schema.min, floor);
  }
  if (P.sites !== undefined) P.sites = Math.min(P.sites, 320);
  if (P.streams !== undefined) P.streams = Math.min(P.streams, 48);
  if (P.levels !== undefined) P.levels = Math.min(P.levels, 26);
  if (P.subdiv !== undefined) P.subdiv = Math.min(P.subdiv, 2);
  if (P.lobes !== undefined) P.lobes = Math.min(P.lobes, 16);
  return P;
}

/** Keep line weight sane relative to the dominant pitch of the engine. */
function balanceStrokes(engineId, P, rng) {
  const pitchKeys = ['pitch', 'cell', 'density', 'plankW', 'brickH', 'repel'];
  const strokeKeys = ['strand', 'stroke', 'wall'];
  let pitch = null;
  for (const k of pitchKeys) if (P[k] !== undefined) { pitch = P[k]; break; }
  if (pitch == null) return P;
  const eng = ENGINE_BY_ID[engineId];
  for (const k of strokeKeys) {
    if (P[k] === undefined) continue;
    const schema = eng.params.find((p) => p.key === k);
    if (!schema) continue;
    // drawn from the seeded stream so the same seed always rolls the same design
    const target = pitch * (0.09 + rng() * 0.16);
    P[k] = Math.max(schema.min, Math.min(schema.max, Math.min(P[k], target)));
  }
  return P;
}

export function randomizeParams(engineId, seed) {
  const rng = makeRng(seed);
  const eng = ENGINE_BY_ID[engineId];
  if (!eng) return {};
  const P = {};
  for (const p of eng.params) P[p.key] = harmoniousValue(p, rng);
  return balanceStrokes(engineId, capDensity(engineId, P), rng);
}

export function randomizeModifiers(seed) {
  const rng = makeRng(seed ^ 0x5bf03635);
  const M = { ...DEFAULT_MODIFIERS };
  const sym = rng.pick(['none', 'none', 'cartesian', 'polar', 'hex', 'brick']);
  M.symmetry = sym;
  M.tileX = rng.pick([1, 2, 2, 3, 3, 4, 5]);
  M.tileY = M.tileX;
  M.fold = rng.pick([4, 5, 6, 8, 8, 10, 12, 16]);
  M.hexSize = Math.round(rng.float(24, 70));
  M.mirrorX = rng.bool(0.5);
  M.mirrorY = rng.bool(0.35);
  // deformations: mostly subtle, occasionally dramatic
  const wild = rng.bool(0.3);
  M.bulge = rng.bool(0.45) ? rng.float(-0.45, wild ? 1.3 : 0.7) : 0;
  M.twirl = rng.bool(0.3) ? rng.float(-0.6, 0.6) * (wild ? 2 : 1) : 0;
  M.turbulence = rng.bool(0.35) ? rng.float(0.5, wild ? 14 : 6) : 0;
  M.turbFreq = rng.float(0.4, 2.6);
  M.wave = rng.bool(0.25) ? rng.float(-12, 12) : 0;
  M.waveFreq = rng.float(0.6, 4);
  M.shearX = rng.bool(0.2) ? rng.float(-0.4, 0.4) : 0;
  M.perspective = rng.bool(0.15) ? rng.float(-0.35, 0.35) : 0;
  M.weightScale = rng.float(0.7, 1.5);
  M.corner = rng.bool(0.4) ? rng.float(0.4, 3) : 0;
  M.taper = rng.bool(0.2) ? rng.float(0.15, 0.6) : 0;
  return M;
}

export function randomizeFrame(seed, prev) {
  const rng = makeRng(seed ^ 0x27d4eb2f);
  const F = { ...DEFAULT_FAB, ...(prev || {}) };
  F.shape = rng.pick(['rect', 'roundrect', 'circle', 'circle', 'hex', 'octagon', 'arch', 'shield', 'none']);
  F.band = Math.round(rng.float(6, 14));
  F.radius = Math.round(rng.float(6, 30));
  F.holes = rng.bool(0.4) ? rng.pick([1, 2, 4]) : 0;
  F.hanger = rng.bool(0.15);
  return F;
}

/** Full dice roll. `lockEngine` keeps the current engine and only rerolls it. */
export function diceRoll(seed, lockEngine) {
  const rng = makeRng(seed);
  const engine = lockEngine || rng.pick(ENGINES).id;
  return {
    engine,
    seed: (rng() * 0xffffffff) >>> 0,
    params: randomizeParams(engine, (rng() * 0xffffffff) >>> 0),
    mods: randomizeModifiers((rng() * 0xffffffff) >>> 0),
    fab: randomizeFrame((rng() * 0xffffffff) >>> 0),
  };
}

/**
 * Evolve: nudge every numeric parameter by ±`amount` of its range, keeping the
 * design recognisably the same while letting it drift somewhere new.
 */
export function evolve(state, amount = 0.1, seed = Date.now()) {
  const rng = makeRng(seed >>> 0);
  const eng = ENGINE_BY_ID[state.engine];
  const params = { ...state.params };
  if (eng) {
    for (const p of eng.params) {
      if (p.type === 'range') {
        const span = (p.max - p.min) * amount;
        let v = (params[p.key] ?? p.def) + rng.gauss(0, span * 0.6);
        v = Math.max(p.min, Math.min(p.max, v));
        params[p.key] = p.int ? Math.round(v) : Math.round(v / p.step) * p.step;
      } else if (p.type === 'toggle' && rng.bool(amount * 0.8)) {
        params[p.key] = !params[p.key];
      } else if (p.type === 'select' && rng.bool(amount * 0.5)) {
        params[p.key] = rng.pick(p.options).v;
      }
    }
  }
  const params2 = capDensity(state.engine, params);
  const mods = { ...state.mods };
  for (const k of ['bulge', 'twirl', 'turbulence', 'wave', 'shearX', 'shearY', 'perspective', 'weightScale', 'corner']) {
    if (typeof mods[k] === 'number') mods[k] = mods[k] + rng.gauss(0, amount * (k === 'weightScale' ? 0.3 : 1.2));
  }
  mods.weightScale = Math.max(0.15, Math.min(4, mods.weightScale));
  mods.corner = Math.max(0, Math.min(12, mods.corner));
  mods.bulge = Math.max(-0.9, Math.min(1.6, mods.bulge));
  mods.twirl = Math.max(-2, Math.min(2, mods.twirl));
  mods.turbulence = Math.max(0, Math.min(40, mods.turbulence));
  return { ...state, params: params2, mods, seed: (state.seed + rng.int(1, 9999)) >>> 0 };
}
