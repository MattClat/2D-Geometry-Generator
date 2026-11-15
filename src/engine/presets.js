/* =========================================================================
 * presets.js — the curated Showcase Gallery
 * Each entry is a complete, production-ready starting point.
 * =======================================================================*/
import { DEFAULT_MODIFIERS } from './modifiers.js';
import { DEFAULT_FAB } from './fabrication.js';
import { defaultParams } from './patterns/index.js';

const mk = (id, name, engine, params, mods = {}, fab = {}, seed = 1337, note = '') => ({
  id, name, engine, seed, note,
  params: { ...defaultParams(engine), ...params },
  mods: { ...DEFAULT_MODIFIERS, ...mods },
  fab: { ...DEFAULT_FAB, ...fab },
});

export const PRESETS = [
  mk('ribbon-waves', 'Flowing Ribbon Waves', 'waves',
    { streams: 30, amp: 20, freq: 1.35, phase: 0.22, strand: 3.2, sBend: true, ampDrift: 0.3, cluster: 1 },
    { weightScale: 1 },
    { shape: 'roundrect', band: 10, radius: 18, thickness: 3, holes: 0 },
    20260815, 'Sleek parallel meanders with rhythmic river bends.'),

  mk('kagome', 'Kagome Triaxial Weave', 'kagome',
    { mode: 'rings', pitch: 26, strand: 3.4, gap: 2.0, ringRatio: 0.62 },
    {},
    { shape: 'circle', band: 9, thickness: 3, holes: 2, holeDia: 5 },
    77003, 'Interlocking 3-way circular ring lattice.'),

  mk('encaustic', 'Mid-Century Encaustic Tile', 'encaustic',
    { motif: 'quatrefoil', cell: 100, scale: 1.0, border: 0.05, detail: true, fillet: 2, patchwork: 'none' },
    { symmetry: 'cartesian', tileX: 3, tileY: 3, mirrorX: true, mirrorY: true },
    { shape: 'rect', band: 10, thickness: 4 },
    5150, '4-fold Moroccan scalloped petal medallion with dual cut-and-score layers.'),

  mk('memphis', 'Memphis Playground', 'memphis',
    { density: 26, size: 0.66, sizeVar: 0.5, stroke: 2.4, outlineOnly: true, cr: true },
    {},
    { shape: 'roundrect', band: 8, radius: 26, thickness: 3, autoBridge: true, bridgeWidth: 3 },
    808080, 'Balanced procedural scatter of retro 80s squiggles, pills and diamonds.'),

  mk('vasarely', 'Vasarely 3D Bulge', 'opart',
    { mode: 'grid', cell: 13, alternate: true },
    { bulge: 1.15, fieldRadius: 1.05, twirl: 0 },
    { shape: 'circle', band: 11, thickness: 3, autoBridge: false, bridgeWidth: 2.4 },
    424242, 'High-contrast square grid warped across an optical spherical hemisphere.'),

  mk('circuit', 'Circuit Labyrinth', 'maze',
    { mode: 'circuit', cell: 15, stroke: 3, fillet: 5, straightness: 0.8, padSize: 6, density: 0.9 },
    {},
    { shape: 'rect', band: 9, thickness: 3 },
    31337, 'Clean rounded 90° routing traces with terminal dot nodes.'),

  mk('isocubes', 'Isometric Tumbling Cubes', 'isocubes',
    { mode: 'cubes', size: 30, inset: 0.07, scoreFaces: true },
    {},
    { shape: 'hex', band: 10, thickness: 4 },
    606060, '3D optical cube lattice with alternating scored faces.'),

  mk('voronoi', 'Bio-Cellular Voronoi', 'voronoi',
    { sites: 170, relax: 6, wall: 3.6, round: 2.4, style: 'web', jitter: 1 },
    {},
    { shape: 'circle', band: 10, thickness: 4 },
    987654, 'Relaxed organic cell matrix with thick, laser-ready structural webs.'),

  /* --- extra starting points --- */
  mk('celtic', 'Celtic Plait Panel', 'plait',
    { mode: 'celtic', pitch: 30, strand: 8, gap: 2.4, amp: 0.85 },
    {},
    { shape: 'roundrect', band: 10, radius: 14, thickness: 3 },
    112358, 'Continuous over-under diagonal plait with automatic crossing gaps.'),

  mk('herringbone', 'Herringbone Parquet', 'herringbone',
    { mode: 'herringbone', plankL: 56, plankW: 20, gap: 2.6, angle: 45, fillet: 2, style: 'tiles' },
    {},
    { shape: 'rect', band: 10, thickness: 3, autoBridge: true, bridgeWidth: 3 },
    24680, 'Parametric interlocking planks on a true herringbone lattice.'),

  mk('truchet', 'Truchet Labyrinth', 'truchet',
    { tile: 'arcs', cell: 46, stroke: 7, subdiv: 1, subdivRate: 0.16, lanes: 2, laneGap: 0.32 },
    {},
    { shape: 'circle', band: 10, thickness: 3 },
    13579, 'Multi-scale quarter-arc tiles assembling into an endless maze.'),

  mk('fingerprint', 'Organic Fingerprint', 'isolines',
    { mode: 'iso', scale: 0.0065, levels: 11, stroke: 2.6, octaves: 2, warp: 0.9, res: 1.6 },
    {},
    { shape: 'roundrect', band: 9, radius: 22, thickness: 3 },
    99991, 'Smooth meandering isolines from a domain-warped noise field.'),

  mk('rosette', 'Andalusian Rosette', 'encaustic',
    { motif: 'star8', cell: 150, scale: 1.0, border: 0, detail: true },
    { symmetry: 'polar', fold: 8, mirrorX: false },
    { shape: 'octagon', band: 10, thickness: 3, holes: 4, holeDia: 5 },
    8888, 'Andalusian 8-point star strapwork radiating in 8-fold symmetry.'),

  mk('flower-of-life', 'Flower of Life', 'sacred',
    { figure: 'flower', radius: 132, stroke: 2.4, layers: 4, ratio: 0.5, boundary: true, detail: true },
    {},
    { shape: 'circle', band: 9, thickness: 3, holes: 2, holeDia: 5 },
    108108, 'The classical hexagonal lattice of circles with its petal ring and double boundary.'),

  mk('metatron', "Metatron's Cube", 'sacred',
    { figure: 'metatron', radius: 128, stroke: 2.2, fold: 6, layers: 4, ratio: 0.5, boundary: true },
    {},
    { shape: 'circle', band: 10, thickness: 3 },
    131313, 'Thirteen Fruit-of-Life circles joined by the complete graph on their centres.'),

  mk('chainmail', 'Chainmail Rosette', 'chainmail',
    { lattice: 'tri', silhouette: 'hex', growth: 3, pitch: 38, ratio: 0.8, strand: 3,
      weave: 'over3', relief: 0.9, inner: false, hub: false, rim: false },
    {},
    { shape: 'none', band: 0, thickness: 3, autoBridge: true, bridgeWidth: 2.4 },
    606060, 'Overlapping rings on a triangular lattice, grown three rings outward and interlaced over-under.'),

  mk('strapwork', 'Woven Ring Strapwork', 'chainmail',
    { lattice: 'tri', silhouette: 'hex', growth: 3, pitch: 34, ratio: 0.72, strand: 3.8,
      render: 'outline', lineW: 1, weave: 'over3', relief: 0,
      inner: false, hub: false, rim: false },
    {},
    { shape: 'none', band: 0, thickness: 3, autoBridge: false },
    202511, 'Interlaced ring strapwork drawn the draughtsman\'s way: both edges of every band, with the under-band\'s edges trimmed where they pass beneath.'),

  mk('shippo', 'Seven Treasures Wreath', 'chainmail',
    { lattice: 'tri', silhouette: 'ring', growth: 4, hollow: 0.5, pitch: 30, ratio: 0.72,
      strand: 2.4, weave: 'over3', relief: 0.7, inner: true, innerRatio: 0.5, rim: true },
    {},
    { shape: 'none', band: 0, thickness: 3, autoBridge: true, bridgeWidth: 2 },
    777, 'An open wreath of interlaced rings with concentric inners, ringed by a rim that ties every strand end in.'),

  mk('rose-window', 'Rose Window', 'sacred',
    { figure: 'mandala', radius: 132, stroke: 2.4, fold: 8, layers: 6, ratio: 0.4,
      coreSize: 0.26, core: 'rosette', variety: 6, spokes: 0, twist: 0, bulge: 0.7,
      boundary: true, detail: true },
    {},
    { shape: 'circle', band: 9, thickness: 3, holes: 2, holeDia: 5 },
    424242, 'Six concentric registers composed from the band vocabulary, around a lotus rosette.'),

  mk('kaleidoscope', 'Kaleidoscope Compass', 'sacred',
    { figure: 'mandala', radius: 134, stroke: 2, fold: 16, layers: 8, ratio: 0.7,
      coreSize: 0.18, core: 'star', variety: 9, spokes: 2, twist: 30, bulge: 0.7,
      boundary: true, detail: true },
    {},
    { shape: 'circle', band: 10, thickness: 3 },
    301301, 'Sixteen-fold mandala with staggered registers and a star boss at the centre.'),

  mk('maurer-rose', 'Maurer Rose', 'sacred',
    { figure: 'rose', radius: 136, stroke: 1.5, fold: 9, dstep: 97, layers: 1,
      ratio: 0.5, boundary: true, detail: true },
    {},
    { shape: 'circle', band: 9, thickness: 3 },
    7007, 'The rose r = sin(9θ) walked in 97° steps — straight chords weaving a lace around a solid hub.'),

  mk('sri-yantra', 'Sri Yantra', 'sacred',
    { figure: 'yantra', radius: 138, stroke: 1.9, spread: 1, fold: 8, layers: 9, detail: true, bhupura: false, boundary: true },
    {},
    { shape: 'circle', band: 9, thickness: 3 },
    999, 'Nine interlocking triangles, twin lotus rings and the central bindu.'),

  mk('sunburst', 'Op-Art Sunburst', 'opart',
    { mode: 'sunburst', sectors: 28, rings: 6, radius: 130, twist: 0.35, gamma: 1.15, alternate: true },
    {},
    { shape: 'circle', band: 10, thickness: 3, autoBridge: false },
    246810, 'Concentric alternating sectors spiralling into a vortex.'),
];

export const PRESET_BY_ID = Object.fromEntries(PRESETS.map((p) => [p.id, p]));
