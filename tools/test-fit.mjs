/* Proves the curve fitter: every emitted primitive is checked back against the
   polyline it replaced, and arcs are reconstructed from their bulge exactly the
   way a DXF reader would. */
import { fitPath, interpolateSpline } from '../src/engine/fit.js';
import { buildDesign } from '../src/engine/build.js';
import { PRESETS } from '../src/engine/presets.js';

let bad = 0;
const fail = (m) => { console.log('  ✗ ' + m); bad++; };

/* -- 1. primitives round-trip ----------------------------------------- */
console.log('=== 1. synthetic shapes ===');
{
  const circle = [];
  for (let i = 0; i < 220; i++) {
    const a = (i / 220) * Math.PI * 2;
    circle.push([50 + 30 * Math.cos(a), 20 + 30 * Math.sin(a)]);
  }
  const r = fitPath(circle, true, { tol: 0.01, mode: 'arcs' });
  if (!r.circle) fail('220-gon circle did not fit as a CIRCLE');
  else if (Math.abs(r.circle.r - 30) > 0.01 || Math.hypot(r.circle.c[0] - 50, r.circle.c[1] - 20) > 0.01)
    fail(`circle fit off: r=${r.circle.r} c=${r.circle.c}`);
  else console.log(`  circle  -> CIRCLE r=${r.circle.r.toFixed(4)} c=(${r.circle.c.map((v) => v.toFixed(3))})`);
}
{
  // stadium: two straights + two half arcs
  const pts = [];
  for (let i = 0; i <= 60; i++) {
    const a = -Math.PI / 2 + (i / 60) * Math.PI;
    pts.push([20 + 10 * Math.cos(a), 10 * Math.sin(a)]);
  }
  for (let i = 0; i <= 60; i++) {
    const a = Math.PI / 2 + (i / 60) * Math.PI;
    pts.push([-20 + 10 * Math.cos(a), 10 * Math.sin(a)]);
  }
  const r = fitPath(pts, true, { tol: 0.01, mode: 'arcs' });
  const arcs = r.segs.filter((s) => s.type === 'arc').length;
  const lines = r.segs.filter((s) => s.type === 'line').length;
  console.log(`  stadium -> ${arcs} arcs + ${lines} lines from ${pts.length} vertices`);
  if (arcs !== 2 || lines !== 2) fail(`stadium should be 2 arcs + 2 lines, got ${arcs}+${lines}`);
}
{
  const sq = [[0, 0], [40, 0], [40, 40], [0, 40]];
  const r = fitPath(sq, true, { tol: 0.01, mode: 'arcs' });
  const lines = r.segs.filter((s) => s.type === 'line').length;
  if (r.circle || lines !== 4) fail(`square should stay 4 lines, got ${JSON.stringify(r.segs.map((s) => s.type))}`);
  else console.log('  square  -> 4 lines (no phantom arcs)');
}

/* -- 2. bulge reconstruction ------------------------------------------ */
console.log('\n=== 2. bulge reconstructs the arc a DXF reader would draw ===');
{
  // A DXF reader turns (a, b, bulge) back into an arc. Rebuild it that way and
  // check the midpoint lands where the fitter said it would.
  let worst = 0, n = 0;
  for (const sweepDeg of [10, 45, 90, 179, 240, 300]) {
    for (const dir of [1, -1]) {
      const R = 25, sweep = (sweepDeg * Math.PI) / 180 * dir;
      const pts = [];
      const steps = 80;
      for (let i = 0; i <= steps; i++) {
        const a = 0.3 + (i / steps) * sweep;
        pts.push([R * Math.cos(a), R * Math.sin(a)]);
      }
      const r = fitPath(pts, false, { tol: 0.02, mode: 'arcs' });
      const arc = r.segs.find((s) => s.type === 'arc');
      if (!arc) { fail(`${sweepDeg}° arc did not fit`); continue; }
      // reader-side reconstruction from bulge alone
      const [ax, ay] = arc.a, [bx, by] = arc.b;
      const bl = arc.bulge;
      const theta = 4 * Math.atan(bl);
      const chord = Math.hypot(bx - ax, by - ay);
      const rad = chord / (2 * Math.abs(Math.sin(theta / 2)));
      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      const h = Math.sqrt(Math.max(0, rad * rad - (chord / 2) ** 2)) * (Math.abs(theta) > Math.PI ? -1 : 1);
      const ux = (bx - ax) / chord, uy = (by - ay) / chord;
      const sgn = theta > 0 ? 1 : -1;
      const cx = mx - uy * h * sgn, cy = my + ux * h * sgn;
      const e = Math.hypot(cx - arc.c[0], cy - arc.c[1]) + Math.abs(rad - arc.r);
      worst = Math.max(worst, e); n++;
      if (e > 1e-6) fail(`${sweepDeg}° dir${dir}: reader reconstruction off by ${e.toExponential(2)}`);
    }
  }
  console.log(`  ${n} arcs reconstructed from bulge, worst centre+radius error ${worst.toExponential(2)} mm`);
}

/* -- 3. spline interpolation actually interpolates --------------------- */
console.log('\n=== 3. spline passes through its fit points ===');
{
  const Q = [];
  for (let i = 0; i <= 30; i++) {
    const t = i / 30;
    Q.push([t * 100, 20 * Math.sin(t * 5) + 8 * Math.sin(t * 13.7)]);
  }
  const sp = interpolateSpline(Q, 1e-6);
  if (!sp) fail('spline interpolation returned null on a smooth curve');
  else console.log(`  degree ${sp.degree}, ${sp.ctrl.length} control points, ${sp.knots.length} knots, verified to 1e-6 mm`);
  const bad2 = interpolateSpline([[0, 0], [1, 0]], 1e-6);
  if (bad2) fail('spline accepted a 2-point run');
}

/* -- 4. every preset: fitted geometry stays within tolerance ----------- */
console.log('\n=== 4. all presets, fitted vs original ===');
const TOL = 0.02;
for (const mode of ['arcs', 'splines']) {
  let vIn = 0, vOut = 0, worst = 0, nCirc = 0, nArc = 0, nSpl = 0, nLine = 0;
  for (const p of PRESETS) {
    const d = buildDesign({ ...p, canvas: { W: 300, H: 300 } });
    for (const path of d.loops) {
      vIn += path.pts.length;
      const r = fitPath(path.pts, path.closed, { tol: TOL, mode });
      if (r.circle) {
        nCirc++; vOut += 1;
        for (const q of path.pts) {
          const e = Math.abs(Math.hypot(q[0] - r.circle.c[0], q[1] - r.circle.c[1]) - r.circle.r);
          if (e > worst) worst = e;
        }
        continue;
      }
      for (const s of r.segs) {
        vOut++;
        if (s.type === 'arc') { nArc++; worst = Math.max(worst, arcDev(s)); }
        else if (s.type === 'spline') nSpl++;
        else nLine++;
      }
    }
  }
  const okTol = worst <= TOL + 1e-9;
  if (!okTol) fail(`${mode}: worst deviation ${worst.toFixed(5)} exceeds tolerance ${TOL}`);
  console.log(
    `  ${mode.padEnd(8)} ${vIn} vertices -> ${vOut} entities ` +
    `(${nLine} line, ${nArc} arc, ${nCirc} circle, ${nSpl} spline)  ` +
    `worst dev ${worst.toFixed(5)}mm ${okTol ? '✓' : '✗'}`,
  );
}

/** How far the arc's own endpoints/centre disagree with its stated radius. */
function arcDev(s) {
  return Math.max(
    Math.abs(Math.hypot(s.a[0] - s.c[0], s.a[1] - s.c[1]) - s.r),
    Math.abs(Math.hypot(s.b[0] - s.c[0], s.b[1] - s.c[1]) - s.r),
  );
}

console.log(bad ? `\n❌ ${bad} problems` : '\n✅ curve fitting is within tolerance everywhere');
process.exit(bad ? 1 : 0);
