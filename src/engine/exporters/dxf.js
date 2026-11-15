/* =========================================================================
 * dxf.js — AutoCAD DXF export
 *
 * Two flavours, both true 1:1 millimetre geometry on separate layers:
 *
 *   'r14'  AC1015 (AutoCAD 2000) — LWPOLYLINE with bulges, CIRCLE, SPLINE.
 *          What LightBurn, Fusion 360, SolidWorks and Vectric prefer.
 *   'r12'  AC1009 — POLYLINE / VERTEX / SEQEND with bulges, and CIRCLE.
 *          The maximum-compatibility fallback for older CAM posts.
 *
 * ---------------------------------------------------------------------------
 * Why this file is long
 *
 * R12 is forgiving: a HEADER, a LAYER table and some entities is a valid file.
 * R13 and later are not. A DXF from AC1013 onward is a serialisation of an
 * object database, and a reader is entitled to reject one whose database does
 * not hold together. In particular it needs:
 *
 *   - a handle (group 5, or 105 for DIMSTYLE) on *every* table, table record,
 *     block and entity, all unique, all below $HANDSEED;
 *   - an owner back-reference (group 330) on each of those;
 *   - the full set of symbol tables — VPORT, LTYPE, LAYER, STYLE, VIEW, UCS,
 *     APPID, DIMSTYLE, BLOCK_RECORD — even where a table is empty;
 *   - AcDbSymbolTable / AcDbSymbolTableRecord subclass markers on them;
 *   - a BLOCKS section defining *Model_Space and *Paper_Space, whose
 *     BLOCK_RECORD entries the model-space entities are owned by;
 *   - an OBJECTS section containing at least the root dictionary.
 *
 * The previous version of this exporter wrote an AC1014 header, a LAYER table
 * with no handles, no BLOCK_RECORD table, no BLOCKS section and no OBJECTS
 * section. Every one of those omissions is on its own enough for a strict
 * reader to call the file corrupt, which is exactly what happened — while the
 * R12 output, held to almost no structural requirements, opened fine.
 * ---------------------------------------------------------------------------
 */
import { LAYERS } from './layers.js';
import { fitPath } from '../fit.js';

const f = (n) => {
  const r = Math.round(n * 1e6) / 1e6;
  return (Object.is(r, -0) ? 0 : r).toFixed(6);
};

class DxfWriter {
  constructor() {
    this.buf = [];
    this.h = 0x30;                 // first free handle; 0x1–0x2F left for fixtures
  }
  g(code, value) { this.buf.push(String(code)); this.buf.push(String(value)); }
  handle() { return (this.h++).toString(16).toUpperCase(); }
  toString() { return this.buf.join('\r\n') + '\r\n'; }
}

function collectByLayer(design) {
  const out = new Map();
  for (const L of LAYERS) out.set(L.key, []);
  for (const p of design.loops) out.get(p.layer === 'frame' ? 'frame' : 'cut').push(p);
  for (const p of design.scoreLines) out.get('score').push(p);
  return out;
}

/**
 * @param {object} design
 * @param {{version?:'r12'|'r14', fit?:'off'|'arcs'|'splines', fitTol?:number}} opts
 */
export function exportDXF(design, opts = {}) {
  const version = opts.version === 'r12' ? 'r12' : 'r14';
  const fitOpts = { mode: opts.fit || 'arcs', tol: opts.fitTol ?? 0.02 };
  // A SPLINE cannot live inside a polyline, so a contour containing one has to
  // be broken into several entities. R12 has no SPLINE at all.
  if (version === 'r12' && fitOpts.mode === 'splines') fitOpts.mode = 'arcs';
  return version === 'r12' ? writeR12(design, fitOpts) : writeR2000(design, fitOpts);
}

/* ==================================================================== *
 * Shared: turn one path into a list of drawable primitives
 * ==================================================================== */
function primitives(path, fitOpts) {
  const pts = dedupeForDxf(path.pts, path.closed);
  if (pts.length < 2) return null;
  const r = fitPath(pts, path.closed, fitOpts);
  return { pts, ...r };
}

/* ==================================================================== *
 * AC1015 — AutoCAD 2000
 * ==================================================================== */
function writeR2000(design, fitOpts) {
  const w = new DxfWriter();
  const byLayer = collectByLayer(design);
  const [x0, y0, x1, y1] = design.bbox;
  const used = LAYERS.filter((L) => (byLayer.get(L.key) || []).length);

  // Fixed handles for the structural objects, so the owner references below
  // can be written without a second pass.
  const H = {
    root: '1', group: '2', mlineStyle: '3',
    tabVport: '8', tabLtype: '5', tabLayer: '6', tabStyle: '7',
    tabView: '9', tabUcs: 'A', tabAppid: 'B', tabDimstyle: 'C', tabBlockRec: 'D',
    brModel: '1F', brPaper: '20',
    blkModel: '21', endModel: '22', blkPaper: '23', endPaper: '24',
    ltByBlock: '14', ltByLayer: '15', ltCont: '16',
    vportActive: '17', styleStd: '18', appidAcad: '19', dimStd: '1A',
    layer0: '1B',
  };
  const layerHandles = {};
  let lh = 0x25;
  for (const L of used) layerHandles[L.dxf] = (lh++).toString(16).toUpperCase();

  /* ---------------- HEADER ---------------- */
  w.g(0, 'SECTION'); w.g(2, 'HEADER');
  w.g(9, '$ACADVER'); w.g(1, 'AC1015');
  w.g(9, '$HANDSEED'); w.g(5, 'FFFFF');
  w.g(9, '$INSUNITS'); w.g(70, 4);            // 4 = millimetres
  w.g(9, '$MEASUREMENT'); w.g(70, 1);         // metric
  w.g(9, '$LUNITS'); w.g(70, 2);
  w.g(9, '$LUPREC'); w.g(70, 4);
  w.g(9, '$CLAYER'); w.g(8, '0');
  w.g(9, '$CELTYPE'); w.g(6, 'ByLayer');
  w.g(9, '$CECOLOR'); w.g(62, 256);
  w.g(9, '$LTSCALE'); w.g(40, f(1));
  w.g(9, '$PDMODE'); w.g(70, 0);
  w.g(9, '$EXTMIN'); w.g(10, f(x0)); w.g(20, f(y0)); w.g(30, f(0));
  w.g(9, '$EXTMAX'); w.g(10, f(x1)); w.g(20, f(y1)); w.g(30, f(0));
  w.g(9, '$LIMMIN'); w.g(10, f(x0)); w.g(20, f(y0));
  w.g(9, '$LIMMAX'); w.g(10, f(x1)); w.g(20, f(y1));
  w.g(0, 'ENDSEC');

  /* ---------------- CLASSES (may be empty, must be present) ------ */
  w.g(0, 'SECTION'); w.g(2, 'CLASSES');
  w.g(0, 'ENDSEC');

  /* ---------------- TABLES ---------------- */
  w.g(0, 'SECTION'); w.g(2, 'TABLES');

  // VPORT
  tableHead(w, 'VPORT', H.tabVport, 1);
  w.g(0, 'VPORT'); w.g(5, H.vportActive); w.g(330, H.tabVport);
  w.g(100, 'AcDbSymbolTableRecord'); w.g(100, 'AcDbViewportTableRecord');
  w.g(2, '*Active'); w.g(70, 0);
  w.g(10, f(0)); w.g(20, f(0));
  w.g(11, f(1)); w.g(21, f(1));
  w.g(12, f((x0 + x1) / 2)); w.g(22, f((y0 + y1) / 2));
  w.g(13, f(0)); w.g(23, f(0));
  w.g(14, f(10)); w.g(24, f(10));
  w.g(15, f(10)); w.g(25, f(10));
  w.g(16, f(0)); w.g(26, f(0)); w.g(36, f(1));
  w.g(17, f(0)); w.g(27, f(0)); w.g(37, f(0));
  w.g(40, f(Math.max(1, y1 - y0))); w.g(41, f(1.6)); w.g(42, f(50));
  w.g(43, f(0)); w.g(44, f(0)); w.g(50, f(0)); w.g(51, f(0));
  w.g(71, 0); w.g(72, 100); w.g(73, 1); w.g(74, 3);
  w.g(75, 0); w.g(76, 0); w.g(77, 0); w.g(78, 0);
  w.g(0, 'ENDTAB');

  // LTYPE — ByBlock and ByLayer must exist before CONTINUOUS
  tableHead(w, 'LTYPE', H.tabLtype, 3);
  ltype(w, H.ltByBlock, H.tabLtype, 'ByBlock');
  ltype(w, H.ltByLayer, H.tabLtype, 'ByLayer');
  ltype(w, H.ltCont, H.tabLtype, 'Continuous', 'Solid line');
  w.g(0, 'ENDTAB');

  // LAYER — layer "0" always, then ours
  tableHead(w, 'LAYER', H.tabLayer, used.length + 1);
  layerRec(w, H.layer0, H.tabLayer, '0', 7);
  for (const L of used) layerRec(w, layerHandles[L.dxf], H.tabLayer, L.dxf, L.aci);
  w.g(0, 'ENDTAB');

  // STYLE
  tableHead(w, 'STYLE', H.tabStyle, 1);
  w.g(0, 'STYLE'); w.g(5, H.styleStd); w.g(330, H.tabStyle);
  w.g(100, 'AcDbSymbolTableRecord'); w.g(100, 'AcDbTextStyleTableRecord');
  w.g(2, 'Standard'); w.g(70, 0);
  w.g(40, f(0)); w.g(41, f(1)); w.g(50, f(0));
  w.g(71, 0); w.g(42, f(2.5)); w.g(3, 'txt'); w.g(4, '');
  w.g(0, 'ENDTAB');

  // VIEW and UCS — empty, but the tables themselves are required
  tableHead(w, 'VIEW', H.tabView, 0); w.g(0, 'ENDTAB');
  tableHead(w, 'UCS', H.tabUcs, 0); w.g(0, 'ENDTAB');

  // APPID
  tableHead(w, 'APPID', H.tabAppid, 1);
  w.g(0, 'APPID'); w.g(5, H.appidAcad); w.g(330, H.tabAppid);
  w.g(100, 'AcDbSymbolTableRecord'); w.g(100, 'AcDbRegAppTableRecord');
  w.g(2, 'ACAD'); w.g(70, 0);
  w.g(0, 'ENDTAB');

  // DIMSTYLE — the one table whose header carries an extra subclass, and whose
  // records take their handle in group 105 rather than 5.
  w.g(0, 'TABLE'); w.g(2, 'DIMSTYLE'); w.g(5, H.tabDimstyle); w.g(330, '0');
  w.g(100, 'AcDbSymbolTable'); w.g(70, 1); w.g(100, 'AcDbDimStyleTable'); w.g(71, 0);
  w.g(0, 'DIMSTYLE'); w.g(105, H.dimStd); w.g(330, H.tabDimstyle);
  w.g(100, 'AcDbSymbolTableRecord'); w.g(100, 'AcDbDimStyleTableRecord');
  w.g(2, 'Standard'); w.g(70, 0);
  w.g(0, 'ENDTAB');

  // BLOCK_RECORD
  tableHead(w, 'BLOCK_RECORD', H.tabBlockRec, 2);
  blockRecord(w, H.brModel, H.tabBlockRec, '*Model_Space');
  blockRecord(w, H.brPaper, H.tabBlockRec, '*Paper_Space');
  w.g(0, 'ENDTAB');

  w.g(0, 'ENDSEC');

  /* ---------------- BLOCKS ---------------- */
  w.g(0, 'SECTION'); w.g(2, 'BLOCKS');
  blockDef(w, H.blkModel, H.endModel, H.brModel, '*Model_Space');
  blockDef(w, H.blkPaper, H.endPaper, H.brPaper, '*Paper_Space');
  w.g(0, 'ENDSEC');

  /* ---------------- ENTITIES ---------------- */
  w.g(0, 'SECTION'); w.g(2, 'ENTITIES');
  for (const L of used) {
    for (const p of byLayer.get(L.key)) {
      const prim = primitives(p, fitOpts);
      if (!prim) continue;
      if (prim.circle) { circleEnt(w, H.brModel, L.dxf, prim.circle); continue; }
      emitSegs2000(w, H.brModel, L.dxf, prim.segs, p.closed);
    }
  }
  w.g(0, 'ENDSEC');

  /* ---------------- OBJECTS ---------------- */
  w.g(0, 'SECTION'); w.g(2, 'OBJECTS');
  w.g(0, 'DICTIONARY'); w.g(5, H.root); w.g(330, '0');
  w.g(100, 'AcDbDictionary'); w.g(281, 1);
  w.g(3, 'ACAD_GROUP'); w.g(350, H.group);
  w.g(3, 'ACAD_MLINESTYLE'); w.g(350, H.mlineStyle);
  w.g(0, 'DICTIONARY'); w.g(5, H.group); w.g(330, H.root);
  w.g(100, 'AcDbDictionary'); w.g(281, 1);
  w.g(0, 'DICTIONARY'); w.g(5, H.mlineStyle); w.g(330, H.root);
  w.g(100, 'AcDbDictionary'); w.g(281, 1);
  w.g(0, 'ENDSEC');

  w.g(0, 'EOF');
  return w.toString();
}

function tableHead(w, name, handle, count) {
  w.g(0, 'TABLE'); w.g(2, name); w.g(5, handle); w.g(330, '0');
  w.g(100, 'AcDbSymbolTable'); w.g(70, count);
}

function ltype(w, handle, owner, name, desc = '') {
  w.g(0, 'LTYPE'); w.g(5, handle); w.g(330, owner);
  w.g(100, 'AcDbSymbolTableRecord'); w.g(100, 'AcDbLinetypeTableRecord');
  w.g(2, name); w.g(70, 0); w.g(3, desc);
  w.g(72, 65); w.g(73, 0); w.g(40, f(0));
}

function layerRec(w, handle, owner, name, aci) {
  w.g(0, 'LAYER'); w.g(5, handle); w.g(330, owner);
  w.g(100, 'AcDbSymbolTableRecord'); w.g(100, 'AcDbLayerTableRecord');
  w.g(2, name); w.g(70, 0); w.g(62, aci); w.g(6, 'Continuous');
  w.g(370, -3);                      // lineweight: by default
}

function blockRecord(w, handle, owner, name) {
  w.g(0, 'BLOCK_RECORD'); w.g(5, handle); w.g(330, owner);
  w.g(100, 'AcDbSymbolTableRecord'); w.g(100, 'AcDbBlockTableRecord');
  w.g(2, name); w.g(70, 0);
}

function blockDef(w, hBlk, hEnd, hOwner, name) {
  w.g(0, 'BLOCK'); w.g(5, hBlk); w.g(330, hOwner);
  w.g(100, 'AcDbEntity'); w.g(8, '0'); w.g(100, 'AcDbBlockBegin');
  w.g(2, name); w.g(70, 0);
  w.g(10, f(0)); w.g(20, f(0)); w.g(30, f(0));
  w.g(3, name); w.g(1, '');
  w.g(0, 'ENDBLK'); w.g(5, hEnd); w.g(330, hOwner);
  w.g(100, 'AcDbEntity'); w.g(8, '0'); w.g(100, 'AcDbBlockEnd');
}

function circleEnt(w, owner, layer, C) {
  w.g(0, 'CIRCLE'); w.g(5, w.handle()); w.g(330, owner);
  w.g(100, 'AcDbEntity'); w.g(8, layer); w.g(100, 'AcDbCircle');
  w.g(10, f(C.c[0])); w.g(20, f(C.c[1])); w.g(30, f(0));
  w.g(40, f(C.r));
}

/**
 * Write a run of primitives. Lines and arcs go into one LWPOLYLINE, arcs
 * carried as bulges, so the contour stays a single closed entity — which is
 * what a CAM post wants to see. A SPLINE cannot be expressed inside a
 * polyline, so it interrupts the run: the polyline so far is flushed, the
 * spline is written as its own entity sharing endpoints exactly, and a new
 * polyline starts after it.
 */
function emitSegs2000(w, owner, layer, segs, closed) {
  let run = [];
  const flush = (isClosed) => {
    if (run.length >= 2) lwpolyline(w, owner, layer, run, isClosed);
    run = [];
  };
  const hasSpline = segs.some((s) => s.type === 'spline');
  for (const s of segs) {
    if (s.type === 'spline') {
      flush(false);
      splineEnt(w, owner, layer, s);
      continue;
    }
    const bulge = s.type === 'arc' ? s.bulge : 0;
    if (!run.length) run.push({ p: s.a, bulge });
    else run[run.length - 1].bulge = bulge;
    run.push({ p: s.b, bulge: 0 });
  }
  if (!hasSpline && closed && run.length >= 3) {
    // the closing vertex is implied by flag 70 = 1
    const a = run[0].p, b = run[run.length - 1].p;
    if (Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9) {
      const last = run.pop();
      run[run.length - 1].bulge = last.bulge || run[run.length - 1].bulge;
    }
    flush(true);
    return;
  }
  flush(false);
}

function lwpolyline(w, owner, layer, run, closed) {
  w.g(0, 'LWPOLYLINE'); w.g(5, w.handle()); w.g(330, owner);
  w.g(100, 'AcDbEntity'); w.g(8, layer); w.g(100, 'AcDbPolyline');
  w.g(90, run.length);
  w.g(70, closed ? 1 : 0);
  w.g(43, f(0));
  for (const v of run) {
    w.g(10, f(v.p[0])); w.g(20, f(v.p[1]));
    if (v.bulge) w.g(42, f(v.bulge));
  }
}

function splineEnt(w, owner, layer, s) {
  w.g(0, 'SPLINE'); w.g(5, w.handle()); w.g(330, owner);
  w.g(100, 'AcDbEntity'); w.g(8, layer); w.g(100, 'AcDbSpline');
  w.g(210, f(0)); w.g(220, f(0)); w.g(230, f(1));   // normal — planar in XY
  w.g(70, 8);                                       // 8 = planar
  w.g(71, s.degree);
  w.g(72, s.knots.length);
  w.g(73, s.ctrl.length);
  w.g(74, 0);
  // knot / control-point tolerances; f() rounds to 6 dp, which would print
  // 0.000000 — a zero tolerance some readers reject
  w.g(42, '0.0000001'); w.g(43, '0.0000001');
  for (const k of s.knots) w.g(40, f(k));
  for (const c of s.ctrl) { w.g(10, f(c[0])); w.g(20, f(c[1])); w.g(30, f(0)); }
}

/* ==================================================================== *
 * AC1009 — R12
 * ==================================================================== */
function writeR12(design, fitOpts) {
  const w = new DxfWriter();
  const byLayer = collectByLayer(design);
  const [x0, y0, x1, y1] = design.bbox;
  const used = LAYERS.filter((L) => (byLayer.get(L.key) || []).length);

  w.g(0, 'SECTION'); w.g(2, 'HEADER');
  w.g(9, '$ACADVER'); w.g(1, 'AC1009');
  w.g(9, '$INSUNITS'); w.g(70, 4);
  w.g(9, '$MEASUREMENT'); w.g(70, 1);
  w.g(9, '$LUNITS'); w.g(70, 2);
  w.g(9, '$EXTMIN'); w.g(10, f(x0)); w.g(20, f(y0)); w.g(30, f(0));
  w.g(9, '$EXTMAX'); w.g(10, f(x1)); w.g(20, f(y1)); w.g(30, f(0));
  w.g(0, 'ENDSEC');

  w.g(0, 'SECTION'); w.g(2, 'TABLES');
  w.g(0, 'TABLE'); w.g(2, 'LTYPE'); w.g(70, 1);
  w.g(0, 'LTYPE'); w.g(2, 'CONTINUOUS'); w.g(70, 0);
  w.g(3, 'Solid line'); w.g(72, 65); w.g(73, 0); w.g(40, f(0));
  w.g(0, 'ENDTAB');
  w.g(0, 'TABLE'); w.g(2, 'LAYER'); w.g(70, used.length + 1);
  w.g(0, 'LAYER'); w.g(2, '0'); w.g(70, 0); w.g(62, 7); w.g(6, 'CONTINUOUS');
  for (const L of used) {
    w.g(0, 'LAYER'); w.g(2, L.dxf); w.g(70, 0); w.g(62, L.aci); w.g(6, 'CONTINUOUS');
  }
  w.g(0, 'ENDTAB');
  w.g(0, 'ENDSEC');

  w.g(0, 'SECTION'); w.g(2, 'ENTITIES');
  for (const L of used) {
    for (const p of byLayer.get(L.key)) {
      const prim = primitives(p, fitOpts);
      if (!prim) continue;
      if (prim.circle) {
        w.g(0, 'CIRCLE'); w.g(8, L.dxf);
        w.g(10, f(prim.circle.c[0])); w.g(20, f(prim.circle.c[1])); w.g(30, f(0));
        w.g(40, f(prim.circle.r));
        continue;
      }
      writePolyline12(w, L.dxf, prim.segs, p.closed);
    }
  }
  w.g(0, 'ENDSEC');
  w.g(0, 'EOF');
  return w.toString();
}

/** R12 POLYLINE. Vertices carry the same bulge values as the R2000 form. */
function writePolyline12(w, layer, segs, closed) {
  const run = [];
  for (const s of segs) {
    const bulge = s.type === 'arc' ? s.bulge : 0;
    if (!run.length) run.push({ p: s.a, bulge });
    else run[run.length - 1].bulge = bulge;
    run.push({ p: s.b, bulge: 0 });
  }
  if (closed && run.length >= 3) {
    const a = run[0].p, b = run[run.length - 1].p;
    if (Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9) {
      const last = run.pop();
      run[run.length - 1].bulge = last.bulge || run[run.length - 1].bulge;
    }
  }
  if (run.length < 2) return;
  w.g(0, 'POLYLINE'); w.g(8, layer);
  w.g(66, 1); w.g(70, closed ? 1 : 0);
  w.g(10, f(0)); w.g(20, f(0)); w.g(30, f(0));
  for (const v of run) {
    w.g(0, 'VERTEX'); w.g(8, layer);
    w.g(10, f(v.p[0])); w.g(20, f(v.p[1])); w.g(30, f(0));
    if (v.bulge) w.g(42, f(v.bulge));
    w.g(70, 0);
  }
  w.g(0, 'SEQEND'); w.g(8, layer);
}

/** Drop duplicate vertices and a repeated closing vertex. */
function dedupeForDxf(pts, closed) {
  const out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[0] - p[0]) < 1e-7 && Math.abs(last[1] - p[1]) < 1e-7) continue;
    out.push(p);
  }
  if (closed && out.length > 2) {
    const a = out[0], b = out[out.length - 1];
    if (Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7) out.pop();
  }
  return out;
}
