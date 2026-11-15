# Tessellate CAD — Development Log

A record of how this project was built: what was asked for, what was delivered,
every bug that was found along the way, and what each one turned out to be.

`README.md` documents the *finished system* — what it does and why it is built
the way it is. This file documents the *journey*, and in particular the bug
ledger, which is the part that is easy to lose and expensive to rediscover.

- **Built:** August 2026, over five working rounds
- **Stack:** React + Vite, no runtime dependencies beyond React
- **Output:** SVG, DXF (AutoCAD 2000 and R12), binary STL, JSON presets
- **Scale:** 10,200 lines across 31 source files (11,600 with the tooling), 6 test suites, 23 presets

---

## The constraint that shaped everything

The environment this was built in had **no access to npm, PyPI or any package
CDN** — every registry returned 403 or was unreachable. That ruled out the three
libraries named in the original brief (Paper.js, Maker.js, Three.js) and
essentially every other dependency.

Rather than stub them out, the project builds what it needs:

| Needed | Normally | Here |
| --- | --- | --- |
| 2D vector CAD kernel | Paper.js / Maker.js | `src/engine/geom.js` — offsets, ribbons, fillets, nesting, clipping |
| Boolean operations | Paper.js / Clipper | `src/engine/boolean.js` — planar arrangement / self-union |
| 3D preview | Three.js | `src/render/webgl3d.js` — orbit camera, 3-point lighting, procedural materials |
| Triangulation | earcut | `src/engine/triangulate.js` — ear clipping with hole elimination |
| Bundling | Vite / Rollup | `tools/bundle.mjs` — micro CommonJS loader wrapping React 19 CJS |

This was disclosed at the time rather than papered over. It turned out to be a
net positive for the deliverable: the single-file `dist/tessellate-cad.html`
runs offline with no server, no npm and no internet, which is a nicer artifact
to hand someone than a build that needs a toolchain.

One structural consequence worth knowing: the UI is written with an `h()`
hyperscript helper instead of JSX, so the exact same source runs under Vite, in
the hand-rolled bundle, and directly in node for the headless tests.

---

## Round 1 — the studio

**Asked for:** a procedural pattern design studio that is both a generative
playground and a precision vector generator, producing production-clean SVG and
DXF for laser, plasma, router, plotter and 3D printing. Seven detailed sections:
playground UX, four families of pattern engine, a modifier stack, a CNC
integrity engine, eight showcase presets, the export formats, and "no
placeholder math".

**Delivered:** 13 engines in four families, the modifier stack (symmetry arrays,
deformation fields, canvas brushes, line profile), the fabrication integrity
engine (floating-island detection, auto-bridging, kerf, frames), a live 2D
canvas and a 3D material viewport, eight presets, and all four export formats.

Two bugs from this round are worth recording because both were invisible until
something specific was tried:

- **React hooks leaking between components.** Components were being called as
  plain functions — `Slider({...})` rather than `h(Slider, {...})` — which puts
  their hooks into the *parent's* hook list. Everything worked until a
  conditional render changed the hook order, and then the app died with
  `Cannot read properties of null (reading 'inst')`. Fixed across 78 call sites.
- **`offsetPolyline` had no miter case.** Inward offsets produced bowtie
  polygons, so the frame's inner boundary was garbage and clipped the entire
  pattern away. Rewritten with an arc join on the outward side and a mitered
  join (with limit and bevel fallback) on the inward side.

---

## Round 2 — trimming, sacred geometry, and cutting dead weight

**Asked for:** three things. The patterns overlapped instead of producing clean
non-overlapping shapes for CAD; add a sacred-geometry engine; and remove the
machine-time / run-time estimator, which was no longer wanted.

**Delivered:** the boolean trim (`src/engine/boolean.js`), the sacred geometry
engine, and the estimator removed.

The trim is the heart of the project. It resolves the whole design into a planar
arrangement and re-emits it as non-overlapping closed contours — outer
boundaries CCW, holes CW, every edge appearing exactly once.

**Four root causes of incorrect trimming**, all found by a raster-diff harness
rather than by reading the code:

1. `resample()` was being used where `densify()` was needed. Resampling slides
   corners off their original positions; contours that must share a vertex
   exactly then no longer do.
2. Each intersection was rounded to the grid *twice*, once per segment. The two
   copies landed a quantum apart and the arrangement never closed. Fixed by
   rounding once and inserting the same integer point into both segments.
3. Classification was per-edge rather than per-face, which unbalanced vertex
   degrees and broke the walks.
4. Decimation was running *after* the frame clip, pulling coincident contours
   apart. Moved to before anything creates shared vertices.

**Other bugs from this round:**

- **RDP collapsed every closed ring to two points.** Ramer–Douglas–Peucker on a
  ring whose ends coincide has a zero-length baseline, so every point is
  "within tolerance" of it. This silently destroyed every closed centreline in
  every engine. Fixed with `simplifyClosed()`, which splits the ring at two
  well-separated anchors first. One engine went from 131 to 1,222 loops.
- **`interiorPoint()` hung** on a self-intersecting 180,000-point outline —
  O(n) point-in-polygon per edge is ~32 billion operations. Capped to 64 probes.
- **A T-junction repair pass** scanning 0.025 mm cells took 3.9 s on one preset.
  Removed as redundant once vertices were exact.
- **A python heredoc patch silently did nothing** because the source text didn't
  match, and I believed the fix was applied. Caught only because the verify
  numbers came back byte-identical. Every patch has been grep-verified since.

---

## Round 3 — making the sacred geometry actually good

**Asked for:** "the sacred geometry section doesn't work that good. its like the
options don't change the design, and if they do, its hard to get a good result."

This was a design-quality complaint, and the diagnosis had three parts.

**Why the controls felt dead:**

- Band element counts were fitted to whatever made cells square, which ignored
  the symmetry order almost entirely — `fold` 5 and `fold` 18 drew nearly the
  same picture.
- `twist` was an absolute rotation. Every band is n-fold symmetric, so rotating
  by anything near 360/n puts it straight back where it started. It is now a
  *stagger*, measured in fractions of each band's own angular cell.
- The classical figures each responded to only a subset of the sliders. Controls
  are now filtered by a `when` predicate so the panel only shows sliders that
  will change what you are looking at.

**Why good results were hard to get:** the mandala's radial spacing was a power
law that starved the inner bands until they fused into a black dot, and the core
motif took its detail straight from `fold` — 18 elements in a 25 mm disc. Bands
are now sized from normalised weights, and the core steps its symmetry order
down to what the space can hold.

**Three real bugs:**

- **Metatron's Cube truncated its centre list mid-ring** to cap the chord count,
  leaving a lopsided figure with a wedge of missing circles. It now drops whole
  rings.
- **Maurer roses went solid black** at the default line width, because the chord
  count ignored it. Chords are now budgeted against line width, so thinning the
  line is what buys detail.
- **`r = sin(kθ)` is exactly zero at a whole family of sample angles**, so 300+
  ribbon edges piled onto the origin and the trim returned one contour with a
  solid interior — a black disc where the lace should be. The lace is now
  clipped out of a small hub.

The trim also gained a **torn-arrangement guard**: if more than a quarter of the
boundary ends in dead-end chains, it refuses the result rather than returning a
single outer contour with a solid interior.

**Unrelated find:** profiling the rose turned up a 56-second near-touch pass in
the boolean. Long segments were being re-tested against the same partner once
per shared grid cell. Pairs now test exactly once, in their lowest shared cell.
That case went **56 s → 0.6 s**, and the worst random dice roll went 3.3 s → 1.9 s.

---

## Round 4 — the overlapping ring lattice

**Asked for:** a chainmail / overlapping-ring lattice that grows outward, given a
reference image and a description mentioning triangular grids, Flower-of-Life
geometry and trefoil strapwork.

**Answered honestly first:** the existing Kagome engine had a "circular chain
mesh" mode that was structurally related, but at its defaults it shattered into
1,045 floating fragments, filled a rectangle with no way to grow outward, and
estimated its cut intervals from arc length. So: a new engine.

**Delivered:** `src/engine/patterns/lattice.js`. Unlike every other engine it
grows outward — `Rings outward` steps whole lattice rings from the centre, and
the silhouette is the scalloped shape the outermost circles happen to form.

Two things needed getting right rather than approximating:

- **The over-under weave needs a proper 3-colouring** of the lattice so colour
  *k* passes over *k+1* everywhere without contradiction. Two classes cannot do
  it — you would need 0 over 1 and 1 over 0 simultaneously. `(q − r) mod 3` on
  the triangular lattice, `(i + 2j) mod 3` on the square one. On the triangular
  lattice this works out to a true alternating over-under-over-under around
  every ring, which is the real chainmail weave.
- **Each cut is measured against the other ring's annulus**, by walking the
  strand's own centreline. Rings meet at every angle from a near-tangency
  upward, and the arc-length estimate fails precisely at the shallow crossings —
  which is where Kagome's fragments came from.

---

## Round 5 — DXF that opens, and real curves

**Asked for:** two things. R14/2000 DXF files were rejected as corrupt by every
CAD program (R12 opened fine), and the output was all line segments where it
should have been circles, arcs and splines.

### Why R14 files were unopenable

R12 is forgiving: a header, a layer table and some entities is a valid file.
R13 and later are not — a modern DXF is a serialisation of an object database,
and a reader may reject one whose database does not hold together. The old
exporter was missing almost all of the scaffolding: no handles on the layer
table, no `BLOCK_RECORD` table, no `BLOCKS` section defining `*Model_Space` for
entities to belong to, no `OBJECTS` section with the root dictionary. Any one of
those is enough to be called corrupt.

It now writes a complete AC1015 document: unique handles below `$HANDSEED`,
owner back-references, all nine symbol tables including the empty ones, both
block definitions, the root dictionary, and CRLF line endings.

Since there was no CAD package in the environment to test with, `tools/test-dxf.mjs`
parses the file back the way a reader does and checks every one of those rules.

### Curve fitting

Curves are recovered at **export time**, so nothing in the pipeline changes —
the trim and the mesher still see polylines, but the exporters ask for
primitives. Across the gallery: **226,361 vertices → 44,228 entities** in arcs
mode, 41,249 with splines enabled. One
preset's DXF went from 204 KB to 28 KB.

**Three findings, each caught by a test rather than by reading the code:**

- **A square's four corners are exactly concyclic**, so no distance-based test
  can tell a square from a coarse arc. The discriminator is angular step — 90°
  versus a couple of degrees.
- **Steps also have to be *uniform*.** A run mixing a finely-flattened fillet
  with one long straight edge admits a circle passing within tolerance of every
  vertex while bowing millimetres off the straight edge between two of them. A
  straight circuit trace was becoming a lens; only a rendered pixel diff showed
  it. (`docs/images/studies/bug-arc-fit-lens.jpg`)
- **In SVG, a circle drawn without regard to its winding** stops being a hole
  under the nonzero fill rule and fills in solid.

---

## Round 6 — the zero-gap bug

**Reported:** selecting "Interlacing — None" still produced a gap at one point
on every circle, and the Kagome chain mesh did the same at 0 mm gap.

This turned out to be **three** separate bugs.

- **A notch at one point on every ring**, unrelated to interlacing. The
  frame-clip stage decided whether a path was a closed loop by checking whether
  its first and last points coincided, ignoring the path's own `closed` flag.
  The ring lattice hands over a bare cycle and sets the flag, so the clip treated
  it as an open strand: it never considered the edge from the last point back to
  the first, and stamped every result `closed: false`. The ribbon builder then
  capped both ends, leaving a chord-sized gap at the same angle on every ring.
  (`docs/images/studies/bug-ring-seam-gap.jpg`)
- **Kagome at 0 mm.** The cut length was `(strand + gap)/2 + strand/2`, so even
  at gap 0 it removed a full strand width more arc than the crossing strand
  covers.
- **Cut endpoints were snapped to the nearest polyline vertex** — about 3 mm —
  so the gap slider could be dragged across most of its range without any vertex
  changing sides. Relief 0 and relief 0.9 produced pixel-identical output.

**The design decision that came out of it:** a gap of 0 now switches the weave
off entirely rather than cutting a hairline. A union cannot represent an
over-under — anything cut from the under-strand is either covered by the
over-strand (so the merged outline is unchanged) or it isn't (so you get a
nibbled notch, not a weave). Zero means no cut. This is locked down by test
section 12, which asserts that chainmail at gap 0 is pixel-identical to
`Interlacing: None`.

**Also caught:** a "Surprise me" roll could freeze the app for ~7 seconds. The
budget only counted paths, and the deformation stage's fixed resample step
turned 170,000 points into 2.3 million. That step now adapts to a vertex budget.
Worst roll ~5 s — improved, not solved; that configuration is genuinely enormous.

---

## Round 7 — outlined strapwork

**Asked for:** an exact reproduction of a reference image — an interlaced ring
pattern — with instructions to fully analyse what gets trimmed and what doesn't.

**The analysis.** Every ring is a band drawn as *two* curves, its outer and
inner edge. At a crossing, the band going under has **both of its edge curves
trimmed for the full width of the band crossing over it**, while the over-band's
two edges run straight through unbroken. The trimmed ends stop exactly *on* the
over-band's edge line, making a clean T-junction with no gap.

Nothing is removed from the *shape*, only from the *line work*. It is hidden-line
removal — how every hand-drawn Celtic knot and chainmail plate has been done for
centuries — and it was a different operation from anything the app had.

This is also precisely why a zero gap has to mean no weave for *solid* straps,
and why outlined strapwork sidesteps that: because you are drawing edges rather
than filling regions, the interlacing reads perfectly at zero gap.

**Delivered:** a `Strand style` control — *Solid straps* or *Outlined strapwork
(line art)* — and the **Woven Ring Strapwork** preset reproducing the reference:
triangular lattice, hexagonal patch 3 rings out, radius 0.72 × pitch, 3.8 mm
bands, 1 mm lines, over-under 3-cycle. 362 entities, **zero floating islands** —
one connected body, because every trimmed line end butts into the line crossing it.

**One bug:** the first version trimmed half a line weight *past* the crossing
line, so each trimmed end's round cap poked out the far side. The result was a
bead threaded onto every crossing in the design.
(`docs/images/studies/bug-strapwork-beads.jpg`)

---

## Round 8 — review pass and GitHub release prep

A full review of the engine, patterns, exporters and UI before publishing to
<https://github.com/MattClat/2D-Geometry-Generator>. The biggest finding was
structural rather than a single bug.

### The pipeline order was wrong

Kerf, winding normalisation, island detection and auto-bridging all ran on the
*untrimmed*, overlapping contours, and the boolean trim came last. Every one of
those steps needs to know which side of a contour is material, and that is only
well defined once overlaps are resolved. Symptoms: kerf grew some ribbons and
shrank others, the frame was never kerfed at all, and auto-bridging on a
circle frame could flip the frame into a hole (material 14,391 → 70,331 mm²).

The trim now runs first. Kerf is applied to the clean contours (material is
always on the left, so every contour moves the same way) and re-trimmed;
islands are counted exactly — one body per outer contour — instead of by
raster; bridges are re-trimmed so they cannot clip a neighbour.

### Fixed

- **keyholeMerge** tried all four orientation pairs and kept the closest area
  match, so "both reversed" could win and flip the host's winding. The host
  now keeps its winding, the guest is oriented to match, and a bridge may only
  join an island to its own enclosing void or a sibling in that void.
- **Shield frame deleted the whole pattern.** Its outline repeated its first
  vertex; the zero-length edge became a spike in the inset and the clip
  boundary collapsed. Arch and shield are now ellipses fitted to W × H.
- **Frame band inset** is a half-plane intersection, so it cannot fold over at
  corners, and a band wider than the frame is reported.
- **Mounting holes** larger than the band are clamped; the **hanger** was a
  bow-tie and is now a real keyhole inside the band.
- **Minimum web** slider did nothing — the check existed but was never called.
  Wired up, with wrap-around and concave-corner false positives fixed.
- **Island detection** missed ring-shaped islands (the probe point sat in the
  ring's hole).
- **Trim** could grind for 20–30 s before refusing; it now gives up after 6 s.
- **STL** was not watertight (walls kept collinear vertices the caps dropped).
  Walls are now built from the cap's boundary edges: 0 open edges across all
  presets.
- **Arc fitting** let a 16-gon become a circle 0.38 mm proud of its edges; a
  sagitta cap fixes it. Also an off-by-one in the run search, open paths with
  coincident ends losing a segment, and SPLINE tolerances printing as zero.
- **Patterns:** herringbone tiling vectors, kagome ring colouring, triaxial
  offset, Voronoi wall inset, op-art target twist, a `Math.random` that made
  dice rolls non-reproducible, and seed 0 behaving as seed 1.
- **Input sanitising:** a new `sanitize.js` clamps every value from presets,
  saved files and the UI (a hand-edited file could ask for a 5000 × 5000
  tiling).
- **UI:** toggling 2D remounted the 3D viewport and leaked a WebGL context;
  context loss now recovers; the 3D view no longer resets the camera on every
  slider tick or redraws at 60 fps while idle; wheel zoom no longer scrolls the
  page; one undo step per slider drag; brushes are saved with the design; the
  seed box no longer mangles input; shortcuts no longer fire inside controls;
  the gallery closes on Escape; accessibility labels throughout.
- **Packaging:** tools no longer hardcode paths from the build machine;
  React 19 declared to match the bundle; Vite builds to `build/` so it cannot
  wipe the committed `dist/tessellate-cad.html`; CI and GitHub Pages workflows
  added; `preview/` is now generated locally and ignored, with README
  screenshots in `docs/images/`.

### Still open

- Maurer rose resamples its chords rather than using the classical
  θᵢ = i·d° construction; rose petal phase, golden-spiral continuity and a few
  other sacred-geometry refinements are noted but unchanged.
- Circuit-maze terminal pads read as holes in the Circuit preset.
- The trim still runs on the main thread; a Web Worker would keep the UI
  responsive on the heaviest designs.

---

## Bug ledger

Every bug found and fixed, with its root cause. Ordered by how hard it was to see.

| # | Symptom | Root cause |
| --- | --- | --- |
| 1 | App crashes on conditional render | Components called as functions, leaking hooks into the parent |
| 2 | Frame clips the whole pattern away | `offsetPolyline` had no miter case; inward offsets made bowties |
| 3 | Auto-bridge never merged anything | `keyholeMerge` walked one ring the short way round |
| 4 | Trim region wrong (4 causes) | resample vs densify; double rounding; per-edge classification; decimation after clip |
| 5 | Every closed ring silently destroyed | RDP on a ring has a zero-length baseline and collapses to 2 points |
| 6 | Trim hangs | `interiorPoint` doing O(n) tests per edge on a 180k-point outline |
| 7 | Giant blue wedges in diff images | Unclosed chains emitted as polygons with a long implicit closing edge |
| 8 | Fix appeared to do nothing | A heredoc patch silently no-op'd; source text didn't match |
| 9 | Metatron lopsided, wedge missing | Centre list truncated mid-ring |
| 10 | Maurer rose solid black | Chord count ignored line width |
| 11 | Rose trims to a black disc | `sin(kθ)` is exactly 0 at many samples; 300+ edges pile on the origin |
| 12 | Boolean takes 56 s | Long segments re-tested once per shared grid cell |
| 13 | Sacred controls do nothing | Band counts ignored `fold`; `twist` landed on symmetry multiples |
| 14 | Mandala centre is a black dot | Power-law band spacing starves inner bands; core detail driven by `fold` |
| 15 | Star bands slice across the figure | {n/k} chords dip to `r·cos(kπ/n)`; skip not solved per band |
| 16 | R14 DXF rejected as corrupt | Missing handles, BLOCK_RECORD, BLOCKS and OBJECTS sections |
| 17 | Square exports as an arc | Four corners are exactly concyclic; needs an angular-step test |
| 18 | Straight trace exports as a lens | Angular steps small but not *uniform* |
| 19 | SVG holes fill in solid | Circles drawn without regard to contour winding |
| 20 | Notch at one point on every ring | Clip stage ignored the explicit `closed` flag on centrelines |
| 21 | Kagome gaps at 0 mm | Cut length hardcoded a strand width wider than the crossing strand |
| 22 | Gap slider does nothing | Cut endpoints snapped to the nearest vertex (~3 mm) |
| 23 | Bead on every crossing | Trim stopped half a line weight past the crossing line |
| 24 | "Surprise me" freezes ~7 s | Budget counted paths, not vertices; deformation multiplied points 14× |

---

## Test suites

Six suites, all headless, no browser required except the last.

| Command | What it proves |
| --- | --- |
| `node tools/test-engine.mjs` | Every engine produces geometry; presets build and export; DXF structure; closed-loop integrity; kerf; island detection and bridging; determinism; 24 random rolls; modifier stack; STL sanity; exported DXF is non-overlapping; **zero weave gap means zero gap** |
| `node tools/test-fit.mjs` | Curve fitting stays within tolerance; bulges reconstruct exactly as a DXF reader would; splines interpolate their fit points |
| `node tools/test-dxf.mjs` | DXF is structurally valid R2000 and geometrically faithful after re-reading |
| `node tools/verify-trim.mjs` | The trim is region-exact and self-intersection-free on every engine and preset |
| `node tools/test-render.mjs` | Fitted curves render pixel-identically to the polylines they replace |
| `node tools/test-ui.mjs` | The built app loads, every tab works, exports download, zero console errors |

`npm test` runs the first three; `npm run verify` runs the trim and render checks.

**Requires:** `node tools/render-sheet.mjs`, `test-render.mjs` and `test-ui.mjs`
need `sharp` and `playwright`. These were installed globally in the build
environment; see the note at the top of each file.

The most valuable of these turned out to be the two that compare *images*
(`verify-trim`, `test-render`). Bugs 17, 18, 19 and 23 were all invisible to
numeric checks and glaring in a rendered diff.

---

## Archive contents

```
README.md                 what the system does and why it is built that way
DEVELOPMENT-LOG.md        this file — the history and the bug ledger
package.json              scripts and dependencies
index.html  vite.config.js

dist/
  tessellate-cad.html     the whole app in one file; open it directly, works offline

src/
  engine/
    rng.js                seeded PRNG + simplex/fbm noise
    geom.js               the 2D CAD kernel (offsets, ribbons, fillets, nesting, clipping)
    fit.js                arc / circle / B-spline recovery from polylines
    boolean.js            planar arrangement / self-union — the trim
    triangulate.js        ear clipping with holes + extrusion to a mesh
    modifiers.js          symmetry arrays and deformation fields
    fabrication.js        frames, kerf, connectivity, keyhole bridging, metrics
    build.js              the deterministic pipeline
    random.js             harmonious dice roll + evolve
    presets.js            the showcase gallery
    patterns/             the 14 engines, grouped by family
    exporters/            svg.js · dxf.js · stl.js · layers.js
  render/                 canvas2d.js (2D viewport) · webgl3d.js (material viewport)
  ui/                     React components (App, panels, viewports, widgets)
  lib/h.js                React element helper

tools/                    the seven test suites plus bundle.mjs, render-sheet.mjs, make-samples.mjs

samples/                  example exports
  woven-ring-strapwork.dxf/.svg    the Round 7 preset
  sample-autocad2000-arcs.dxf      AC1015 with arcs
  sample-autocad2000-splines.dxf   AC1015 with splines
  sample-r12-arcs.dxf              R12 with bulged vertices

docs/images/              README screenshots

preview/                  (generated locally by render-sheet / test-ui; not committed)
```

---

## Known limitations

Recorded honestly rather than left to be rediscovered.

- **Dense random rolls are slow.** A "Surprise me" landing on a heavily
  turbulent engine under a hex tiling can take ~5 seconds. The vertex budget
  improved it from ~7 s; it is not solved. Such designs are genuinely enormous
  (over a kilometre of centreline on a 300 mm sheet) and the trim declines them
  anyway.
- **The trim declines two situations**, both reported rather than guessed at:
  figures with several hundred thousand crossings, and arrangements where
  enough lines meet at one exact point that the material/void classification
  goes inconsistent. In both the design falls back to raw contours with a
  visible warning.
- **A DXF `CIRCLE` entity carries no direction**, so a contour that fits one
  perfectly cannot express hole-vs-boundary winding in the file. Every CAD
  package resolves that by nesting, so this is correct and standard — but it is
  why the DXF test compares circles by magnitude and everything else by signed
  area.
- **Outlined strapwork produces more entities** than solid straps (two edges per
  band, each broken at every crossing). The Round 7 preset is 362 entities where
  the solid equivalent is 86.
- **No CAD package was available** in the build environment, so DXF validity is
  proven structurally rather than by opening the files. The sample exports in
  `samples/` are there to be checked against a real reader.
