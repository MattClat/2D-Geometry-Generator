/* =========================================================================
 * stl.js — binary STL export of the extruded solid
 *
 * Uses the same triangulated extrusion that drives the 3D viewport, so what
 * you see in the material preview is exactly what lands in the slicer.
 * =======================================================================*/
import { extrudeShapes } from '../triangulate.js';

export function buildMesh(design, thickness) {
  return extrudeShapes(design.shapes, Math.max(0.05, thickness));
}

/** @returns {ArrayBuffer} binary STL */
export function exportSTL(design, thickness, title = 'Tessellate CAD export') {
  const mesh = buildMesh(design, thickness);
  const n = mesh.triangleCount;
  const buf = new ArrayBuffer(84 + n * 50);
  const view = new DataView(buf);
  const header = new Uint8Array(buf, 0, 80);
  const txt = title.slice(0, 79);
  for (let i = 0; i < txt.length; i++) header[i] = txt.charCodeAt(i) & 0x7f;
  view.setUint32(80, n, true);

  let off = 84;
  const P = mesh.positions, N = mesh.normals;
  for (let t = 0; t < n; t++) {
    const b = t * 9;
    view.setFloat32(off, N[b], true);
    view.setFloat32(off + 4, N[b + 1], true);
    view.setFloat32(off + 8, N[b + 2], true);
    off += 12;
    for (let k = 0; k < 9; k++) { view.setFloat32(off, P[b + k], true); off += 4; }
    view.setUint16(off, 0, true);
    off += 2;
  }
  return buf;
}

/** ASCII STL — handy for eyeballing / diffing small parts. */
export function exportSTLAscii(design, thickness, name = 'tessellate') {
  const mesh = buildMesh(design, thickness);
  const out = [`solid ${name}`];
  const P = mesh.positions, N = mesh.normals;
  for (let t = 0; t < mesh.triangleCount; t++) {
    const b = t * 9;
    out.push(`facet normal ${N[b]} ${N[b + 1]} ${N[b + 2]}`);
    out.push('  outer loop');
    for (let k = 0; k < 3; k++) {
      out.push(`    vertex ${P[b + k * 3]} ${P[b + k * 3 + 1]} ${P[b + k * 3 + 2]}`);
    }
    out.push('  endloop');
    out.push('endfacet');
  }
  out.push(`endsolid ${name}`);
  return out.join('\n');
}
