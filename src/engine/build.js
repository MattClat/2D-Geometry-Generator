/* =========================================================================
 * build.js — the deterministic pipeline that turns a parameter block into
 * production geometry.
 *
 *   engine ▸ symmetry array ▸ deformation ▸ interactive brushes ▸ profile
 *          ▸ frame clip ▸ ribbon outlines ▸ kerf ▸ integrity ▸ metrics
 *
 * The whole thing is a pure function of `state`, so identical inputs always
 * produce byte-identical DXF output.
 * =======================================================================*/
import { makeRng, makeNoise } from './rng.js';
import { ENGINE_BY_ID, sanitizeParams, engineFillRule } from './patterns/index.js';
import {
  motifDomain, applySymmetry, buildDeformer, applyDeformation, applyProfile,
  DEFAULT_MODIFIERS,
} from './modifiers.js';
import {
  buildFrame, kerfCompensate, kerfOffsetClean, analyseConnectivity, analyseBodies,
  autoBridge, computeMetrics, minWebViolations, DEFAULT_FAB, depthMap,
} from './fabrication.js';
import {
  ribbon, simplify, simplifyClosed, resample, densify, rectPts, clipPolygonToConvex, clipPolylineToPolygon,
  bboxOfPaths, buildShapeTree, polygonArea, dist, clamp, TAU, region, centerline,
} from './geom.js';
import { trimOverlaps, normaliseWindings } from './boolean.js';
import {
  sanitizeMods, sanitizeFab, sanitizeCanvas, sanitizeBrushes, sanitizeSeed, isEngineId,
} from './sanitize.js';

export const DEFAULT_CANVAS = { W: 300, H: 300 };

/** Interactive canvas brushes: local ripple / pinch / magnet / twist. */
export function applyBrushes(paths, brushes) {
  if (!brushes || !brushes.length) return paths;
  const warp = ([x, y]) => {
    let px = x, py = y;
    for (const b of brushes) {
      const dx = px - b.x, dy = py - b.y;
      const r = Math.hypot(dx, dy);
      if (r > b.radius || r < 1e-9) continue;
      const t = 1 - r / b.radius;
      const fall = t * t * (3 - 2 * t);
      switch (b.type) {
        case 'ripple': {
          const k = 1 + (b.strength * fall * Math.sin((r / b.radius) * TAU * 2)) / 3;
          px = b.x + dx * k; py = b.y + dy * k;
          break;
        }
        case 'pinch': {
          const k = 1 - b.strength * fall;
          px = b.x + dx * k; py = b.y + dy * k;
          break;
        }
        case 'magnet': {
          px += b.dx * fall * b.strength;
          py += b.dy * fall * b.strength;
          break;
        }
        case 'twist':
        default: {
          const a = b.strength * fall * 1.6;
          const c = Math.cos(a), s = Math.sin(a);
          px = b.x + dx * c - dy * s;
          py = b.y + dx * s + dy * c;
          break;
        }
      }
    }
    return [px, py];
  };
  // Only paths that actually pass through a brush need densifying; doing it
  // to every path multiplied the vertex count of a whole dense tiling for the
  // sake of one small ripple, bypassing the detail budget.
  const touches = (pts) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const q of pts) {
      if (q[0] < x0) x0 = q[0];
      if (q[1] < y0) y0 = q[1];
      if (q[0] > x1) x1 = q[0];
      if (q[1] > y1) y1 = q[1];
    }
    return brushes.some((b) => b.x + b.radius >= x0 && b.x - b.radius <= x1
      && b.y + b.radius >= y0 && b.y - b.radius <= y1);
  };
  return paths.map((p) => {
    if (p.pts.length < 2 || !touches(p.pts)) return p;
    return { ...p, pts: densify(p.pts, 1.6, p.closed).map(warp) };
  });
}

const PATH_BUDGET = 26000;
// Vertices, not paths. Comfortably above the densest preset (a few tens of
// thousands) and above the boolean trim's own 140,000-segment ceiling, so it
// only ever catches runaway combinations.
const VERTEX_BUDGET = 700000;

export function buildDesign(state) {
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const warnings = [];
  if (!state || !isEngineId(state.engine)) {
    const c = sanitizeCanvas(state && state.canvas);
    return emptyResult(c.W, c.H, ['Unknown engine: ' + (state && state.engine)]);
  }
  // Every numeric input is clamped to its slider range here, so a hand-edited
  // preset or an imported file can never ask for a 5000 x 5000 tiling.
  const { W, H } = sanitizeCanvas(state.canvas);
  const eng = ENGINE_BY_ID[state.engine];
  const mods = { ...DEFAULT_MODIFIERS, ...sanitizeMods(state.mods) };
  const fab = { ...DEFAULT_FAB, ...sanitizeFab(state.fab) };
  const P = sanitizeParams(state.engine, state.params);
  const seed = sanitizeSeed(state.seed);
  const rng = makeRng(seed);
  const noise = makeNoise(seed);
  const fillRule = engineFillRule(state.engine);

  /* 1 ▸ motif ------------------------------------------------------- */
  const domain = motifDomain(mods, W, H);
  let paths = [];
  try {
    paths = eng.generate(P, rng, { w: domain.w, h: domain.h, noise, seed }) || [];
  } catch (err) {
    warnings.push('Engine error: ' + (err && err.message ? err.message : err));
    return emptyResult(W, H, warnings);
  }
  paths = paths.filter((p) => p && p.pts && p.pts.length > 1);

  /* 2 ▸ clip the motif to its symmetry cell -------------------------- */
  if (domain.clip) paths = clipToBoundary(paths, domain.clip);

  /* 3 ▸ symmetry / tiling array -------------------------------------- */
  paths = applySymmetry(paths, mods, W, H, domain);
  if (paths.length > PATH_BUDGET) {
    warnings.push(`Path budget reached (${paths.length.toLocaleString()}); output truncated. Increase feature size or reduce tiling.`);
    paths = paths.slice(0, PATH_BUDGET);
  }
  // Counting paths is not enough. A few dozen heavily turbulent strands
  // replicated across a hex tiling is a small number of paths carrying
  // millions of points, which sails past the path budget and then spends
  // several seconds in the offsetter — long enough that a dice roll looks
  // like the app has hung. Cap the vertices as well.
  {
    let verts = 0, keep = paths.length;
    for (let i = 0; i < paths.length; i++) {
      verts += paths[i].pts.length;
      if (verts > VERTEX_BUDGET) { keep = i; break; }
    }
    if (keep < paths.length) {
      warnings.push(`Detail budget reached (${verts.toLocaleString()}+ points); output truncated. Reduce turbulence, stream count or tiling.`);
      paths = paths.slice(0, Math.max(1, keep));
    }
  }

  /* 4 ▸ global deformation + interactive brushes --------------------- */
  const deform = buildDeformer(mods, W, H, noise);
  if (deform) {
    // Deformation resamples every path so that straight edges can bend. That
    // is a fixed step, so on a dense tiling it multiplies the vertex count by
    // an order of magnitude — 170,000 points became 2.3 million on one dice
    // roll, and the ribbon offsetter then took seconds. Coarsen the step just
    // enough to stay inside the budget rather than dropping paths: a slightly
    // flatter curve everywhere beats losing a third of the pattern.
    const base = Math.max(0.8, Math.min(W, H) / 260);
    let total = 0;
    for (const p of paths) {
      for (let i = 1; i < p.pts.length; i++) total += dist(p.pts[i - 1], p.pts[i]);
    }
    const step = Math.max(base, total / VERTEX_BUDGET);
    paths = applyDeformation(paths, deform, step);
  }
  paths = applyBrushes(paths, sanitizeBrushes(state.brushes));

  /* 5 ▸ line weight & corner profile --------------------------------- */
  paths = applyProfile(paths, mods);

  /* 5b ▸ decimate, before anything creates shared vertices ------------- */
  // This is the only safe place to simplify. Engine motifs are still
  // independent here; from the frame clip onwards contours start sharing
  // vertices exactly, and decimating either side of that independently pulls
  // them apart — which the boolean trim then sees as a torn arrangement.
  const tol = Math.max(0.004, Math.min(W, H) / 20000);
  paths = paths.map((p) => {
    if (p.pts.length < 5) return p;
    const a = p.pts[0], b = p.pts[p.pts.length - 1];
    // A centreline whose ends coincide is a ring; so is any closed region.
    // Both must use the ring-aware variant, or RDP's zero-length baseline
    // collapses them to a two-point stub.
    const ring = dist(a, b) < 1e-9;
    if (ring) {
      const s2 = simplifyClosed(p.pts.slice(0, -1), tol);
      return s2.length >= 3 ? { ...p, pts: s2.concat([s2[0]]) } : p;
    }
    if (p.closed) {
      const s2 = simplifyClosed(p.pts, tol);
      return s2.length >= 3 ? { ...p, pts: s2 } : p;
    }
    const s2 = simplify(p.pts, tol);
    return s2.length >= 2 ? { ...p, pts: s2 } : p;
  });

  /* 6 ▸ frame + clip the field to the working boundary ---------------- */
  const frame = buildFrame(fab, W, H);
  const clipBoundary = frame.inner || rectPts(-W / 2, -H / 2, W, H);
  paths = clipToBoundary(paths, clipBoundary);

  /* 7 ▸ centrelines -> real cuttable ribbon outlines ------------------ */
  const loops = [];
  const scoreLines = [];
  const defaultWidth = 1.2 * (mods.weightScale || 1);
  for (const p of paths) {
    if (p.layer === 'score') {
      scoreLines.push({ ...p, kind: 'centerline' });
      continue;
    }
    if (p.kind === 'region' || (p.closed && p.width === undefined)) {
      if (p.pts.length >= 3) loops.push({ ...p, closed: true, kind: 'region' });
      continue;
    }
    const wdt = p.width !== undefined ? p.width : defaultWidth;
    // A centreline is a closed loop if it says so, or if its ends coincide.
    //
    // Both conventions are in use: most engines close a ring by repeating the
    // first point, but an engine can equally hand over a bare cycle and set
    // `closed`. Inferring it *only* from coincident endpoints silently treated
    // those bare cycles as open strands, and an open ribbon stops at the last
    // point — leaving every ring with a chord-long notch, capped at both ends,
    // at the same angle on every ring in the design.
    const a = p.pts[0], b = p.pts[p.pts.length - 1];
    const endsMeet = p.pts.length > 6 && dist(a, b) < Math.max(1e-4, wdt * 0.05);
    const isRing = endsMeet || (p.closed === true && p.pts.length > 2);
    const src = endsMeet ? p.pts.slice(0, -1) : p.pts;
    for (const r of ribbon(src, wdt, isRing, isRing ? 0 : p.taper)) {
      if (r.pts.length >= 3) loops.push({ pts: r.pts, closed: true, kind: 'region', layer: p.layer || 'cut', fixedWinding: r.fixedWinding });
    }
  }

  /* 8 ▸ tidy: drop slivers ------------------------------------------- */
  // Decimation is deliberately deferred until *after* the boolean trim.
  // Simplifying now would perturb contours that currently share vertices
  // exactly — the pattern is clipped to the frame's inner boundary, so the two
  // are coincident there, and pulling them apart by even a hair turns a clean
  // shared edge into a chain of alternating slivers.
  let cutLoops = [];
  for (const L of loops) {
    if (L.pts.length < 3) continue;
    if (Math.abs(polygonArea(L.pts)) < 0.02) continue;
    cutLoops.push(L);
  }

  /* 9 ▸ frame geometry ------------------------------------------------- */
  // The frame is clipped against exactly like the pattern, so the two share
  // vertices on the inner boundary. Neither is decimated from here on.
  for (const w of frame.warnings || []) warnings.push(w);
  const frameLoops = frame.paths.map((p) => ({ ...p, closed: true, kind: 'region' }));
  let allLoops = frameLoops.concat(cutLoops);

  /* 10 ▸ winding normalisation ----------------------------------------- */
  // Even nesting depth -> CCW (adds material), odd -> CW (cuts a hole). With
  // that in place the NONZERO rule governs everywhere: overlapping ribbons
  // merge into one body instead of cancelling, nested rings still cut holes.
  if (fillRule === 'nonzero' && allLoops.length && allLoops.length < 12000) {
    allLoops = normaliseWindings(allLoops, depthMap(allLoops));
  }

  /* 11 ▸ trim: resolve every overlap into clean, non-overlapping contours */
  // Trim comes first: kerf, island detection and bridging all need to know
  // which side of each contour is material, and that is only well defined once
  // overlapping ribbons have been merged into clean outlines.
  const trimOpts = {
    rule: fillRule,
    eps: 1e-3,
    simplifyTol: 0,
    // keeps the interactive rebuild responsive; very dense fields fall back
    // to raw contours with a visible warning rather than stalling the UI
    maxSegments: 140000,
    maxMs: 6000,
    minArea: Math.max(1e-4, tol * tol * 4),
  };
  let trimStats = null;
  let clean = false;
  if (fab.trim && allLoops.length) {
    const res = trimOverlaps(allLoops, trimOpts);
    trimStats = res.stats;
    if (res.loops) {
      allLoops = res.loops;
      clean = true;
    } else {
      warnings.push(
        res.stats.timedOut
          ? 'Trim skipped — resolving this many overlaps would take too long. Reduce tiling density, the symmetry order or the line count.'
          : res.stats.torn
          ? 'Trim skipped — too many lines meet at the same points for the trim to resolve reliably. Nudge the line width, the symmetry order or the radius slightly.'
          : res.stats.splits
            ? `Trim skipped — this figure self-crosses ${res.stats.splits.toLocaleString()} times, past the safe limit. Lower the symmetry order or the sample step.`
            : `Trim skipped — ${res.stats.segments.toLocaleString()} segments exceeds the ${res.stats.limit.toLocaleString()} limit. Reduce tiling density or feature count.`,
      );
    }
  }

  /* 12 ▸ kerf / tool offset -------------------------------------------- */
  if (Math.abs(fab.kerf) > 1e-4 && allLoops.length) {
    if (clean) {
      const census = (Ls) => {
        let solids = 0, holes = 0;
        for (const L of Ls) if (polygonArea(L.pts) > 0) solids++; else holes++;
        return [solids, holes];
      };
      const [s0, h0] = census(allLoops);
      allLoops = kerfOffsetClean(allLoops, fab.kerf);
      // Growing solids by half a kerf can make neighbours touch; re-trim so
      // they merge instead of overlapping.
      const res = trimOverlaps(allLoops, { ...trimOpts, rule: 'nonzero' });
      if (res.loops) {
        allLoops = res.loops;
        const [s1, h1] = census(allLoops);
        const lost = Math.max(0, s0 - s1) + Math.max(0, h0 - h1);
        if (lost > 0) {
          warnings.push(`A ${fab.kerf} mm kerf is wider than some gaps or features in this design — ${lost} contour${lost === 1 ? '' : 's'} closed up or merged. Widen the gaps or reduce the kerf.`);
        }
      }
      else warnings.push('Kerf offset made some contours overlap and they could not be re-trimmed.');
    } else {
      allLoops = kerfCompensate(allLoops, fab.kerf);
      warnings.push('Kerf compensation is approximate while contours overlap — turn on Trim for an exact offset.');
    }
  }

  /* 13 ▸ structural integrity ------------------------------------------ */
  const bbox = bboxOfPaths(allLoops.length ? allLoops : [{ pts: rectPts(-W / 2, -H / 2, W, H) }]);
  const analyse = (L) => (clean ? analyseBodies(L) : analyseConnectivity(L, bbox, 420, fillRule));
  let analysis = null;
  let bridgeReport = { bridged: 0, failed: 0 };
  if (allLoops.length && allLoops.length < 9000) {
    analysis = analyse(allLoops);
    if (fab.autoBridge && analysis.floating.size) {
      // Several passes: each one lets fallout clusters chain a little further
      // outward until they reach the frame or the main body.
      for (let pass = 0; pass < 4 && analysis.floating.size; pass++) {
        const res = autoBridge(allLoops, analysis, Math.max(0.3, fab.bridgeWidth));
        bridgeReport.failed = res.failed;
        if (!res.bridged) break;
        allLoops = res.loops;
        bridgeReport.bridged += res.bridged;
        if (clean) {
          // A bridge can clip a neighbouring contour on its way across.
          // Re-trim so the output stays strictly non-overlapping.
          const rt = trimOverlaps(allLoops, { ...trimOpts, rule: 'nonzero' });
          if (rt.loops) allLoops = rt.loops;
        }
        analysis = analyse(allLoops);
      }
    }
  } else if (allLoops.length) {
    warnings.push('Connectivity check skipped — too many contours. Simplify the design to re-enable island detection.');
  }

  /* 13b ▸ minimum web ---------------------------------------------------- */
  if (fab.minWeb > 0 && allLoops.length && allLoops.length < 1500) {
    let pts = 0;
    for (const L of allLoops) pts += L.pts.length;
    if (pts < 60000) {
      const thin = minWebViolations(allLoops, fab.minWeb, Math.max(0.5, fab.minWeb / 2));
      if (thin.length) {
        warnings.push(`${thin.length} contour${thin.length === 1 ? ' has' : 's have'} features narrower than the ${fab.minWeb} mm minimum web — they may burn through or snap.`);
      }
    }
  }

  /* 14 ▸ metrics + 3D shape tree --------------------------------------- */
  const exportPaths = allLoops.concat(scoreLines);
  const metrics = computeMetrics(exportPaths, fab);
  const shapes = allLoops.length < 6000 ? buildShapeTree(allLoops) : [];
  const depth = analysis ? analysis.depth : depthMap(allLoops);

  const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  if (analysis && analysis.floating.size) {
    warnings.push(`${analysis.floating.size} floating island${analysis.floating.size === 1 ? '' : 's'} detected — this fallout will drop out of the sheet.`);
  }
  if (!metrics.fitsSheet) warnings.push('Part exceeds the configured sheet size.');

  return {
    loops: allLoops,
    scoreLines,
    exportPaths,
    shapes,
    depth,
    analysis,
    metrics,
    fillRule: clean ? 'nonzero' : fillRule,
    bridgeReport,
    trimStats,
    warnings,
    bbox,
    canvas: { W, H },
    buildMs: ms,
  };
}

function clipToBoundary(paths, boundary) {
  const out = [];
  for (const p of paths) {
    if (p.closed && p.kind !== 'centerline') {
      const c = clipPolygonToConvex(p.pts, boundary);
      if (c.length >= 3) out.push({ ...p, pts: c });
      continue;
    }
    if (p.closed && p.kind === 'centerline' && p.pts.length > 2) {
      // A closed centreline is a *cycle*, so the edge from the last point back
      // to the first has to be clipped along with the rest — and if nothing was
      // cut away, it has to come out the far side still marked closed.
      //
      // Sending it down the open-polyline branch instead loses both: the
      // closing edge is never considered, and every run is stamped
      // `closed: false`. A ring that never came near the boundary would arrive
      // at the ribbon stage as an open strand and be built with two round caps
      // and a chord-sized notch between them — at the same angle on every ring
      // in the design, because that is where each ring's point list starts.
      const cycle = p.pts.concat([p.pts[0]]);
      const runs = clipPolylineToPolygon(cycle, boundary);
      const whole = runs.length === 1 && runs[0].length > 3 &&
        dist(runs[0][0], runs[0][runs[0].length - 1]) < 1e-9;
      if (whole) {
        out.push({ ...p, pts: runs[0].slice(0, -1), closed: true });
      } else {
        for (const run of runs) if (run.length > 1) out.push({ ...p, pts: run, closed: false });
      }
      continue;
    }
    for (const run of clipPolylineToPolygon(p.pts, boundary)) {
      if (run.length > 1) out.push({ ...p, pts: run, closed: false });
    }
  }
  return out;
}

function emptyResult(W, H, warnings) {
  return {
    loops: [], scoreLines: [], exportPaths: [], shapes: [], depth: [],
    analysis: null,
    metrics: computeMetrics([], DEFAULT_FAB),
    bridgeReport: { bridged: 0, failed: 0 }, trimStats: null, fillRule: 'nonzero',
    warnings, bbox: [-W / 2, -H / 2, W / 2, H / 2], canvas: { W, H }, buildMs: 0,
  };
}
