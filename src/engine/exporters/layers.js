/* Fabrication layer definitions shared by every exporter and the 2D viewport. */
export const LAYERS = [
  { key: 'frame', dxf: '0_OUTER_FRAME',   aci: 5, stroke: '#3b82f6', fill: '#1d4ed8', label: 'Outer frame' },
  { key: 'cut',   dxf: '1_CUT_THROUGH',   aci: 1, stroke: '#ef4444', fill: '#111827', label: 'Cut through' },
  { key: 'score', dxf: '2_SCORE_ENGRAVE', aci: 3, stroke: '#22c55e', fill: 'none',    label: 'Score / engrave' },
];

export const LAYER_BY_KEY = Object.fromEntries(LAYERS.map((l) => [l.key, l]));
