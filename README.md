# Tessellate CAD

A procedural pattern design studio: a generative art playground on one side, a
precision vector generator on the other. Every design is a pure function of a
parameter block and a seed, and every design exports as production-clean
geometry for laser cutting, plasma cutting, CNC routing, pen plotting and 3D
printing.

---

## Run it

**Zero install (recommended for a quick look)**

Open `dist/tessellate-cad.html` by double-clicking it. That single file contains
the whole application — React, the geometry engine, the WebGL renderer and the
stylesheet — and works offline with no server, no npm and no internet.

**As a project**

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # dist/ with hashed assets
npm run build:single # dist/index.html as one self-contained file
```

Useful extras:

```bash
npm test             # geometry engine, curve fitting and DXF structure
npm run verify       # trim is region-exact; fitted curves render identically
npm run bundle       # rebuild dist/tessellate-cad.html without a bundler
npm run sheet        # render a PNG contact sheet of every preset
```

---

## Keyboard

| Key | Action |
| --- | --- |
| `R` | Surprise me — randomise everything |
| `Space` | Reroll the current engine only |
| `E` | Evolve ±10% |
| `G` | Toggle the showcase gallery |
| `1` `2` `3` | 2D / 3D / split viewport |
| `⌘Z` `⇧⌘Z` | Undo / redo |

Scroll to zoom, drag to pan. In the 3D viewport drag to orbit, shift-drag or
right-drag to pan.

---

## How a design is built

Everything is a pure pipeline. Same inputs in, byte-identical DXF out.

```
engine ▸ symmetry array ▸ deformation fields ▸ canvas brushes ▸ line profile
       ▸ frame clip ▸ ribbon outlines ▸ kerf offset ▸ integrity
       ▸ boolean trim ▸ metrics
```

Geometry is represented throughout as *polylines in millimetres, Y-up* (CAD
convention). Curves are flattened to a chord tolerance up front, which is what
a machine controller consumes anyway and makes DXF export lossless.

### Pattern engines (14)

| Group | Engine | What it does |
| --- | --- | --- |
| **Woven strands** | Kagome triaxial weave | Three strand families at 60° in a cyclic over-under, a 3-way circular chain mesh, or the trihexagonal net |
| | Overlapping ring lattice | Equal rings overlapping on a triangular or square lattice, grown outward ring by ring, interlaced over-under into chainmail strapwork |
| | Flowing ribbon waves | Parallel sinusoidal streams with phase drift, clustering, S-bends and turbulence |
| | Celtic & basket weave | Orthogonal basket masonry, diagonal Celtic plaits and 2/2 twill, with automatic crossing gaps |
| **Architectural tiles** | Moroccan / encaustic | Quatrefoils, Andalusian 8-point strapwork, petal circles, rosette mandalas, gothic tracery, pinwheels |
| | Herringbone / chevron / parquet | A true herringbone lattice, mitred chevrons, block parquet, stepped zig-zags |
| | Modular block & brickwork | Running, stack, Flemish, basketweave and random-ashlar bonds with corner fillets |
| **Retro & modernist** | Memphis playground | Blue-noise scatter of squiggles, pills, arcs, half-discs and primitives — collision-free by construction |
| | Isometric tumbling cubes | Necker-cube lattice, stepped pyramids, hex prisms, isometric zig-zag |
| | Op-art radial & grid | Sector sunbursts, vortex pinwheels, concentric rings, moiré interference, Vasarely warp grids |
| **Organic & maze** | Truchet labyrinth | Multi-scale quarter-arc, diagonal, triangle and nested-ring tile sets |
| | Circuit labyrinth | Spanning-tree mazes as filleted 90° routing traces with terminal pads; Greek-key meanders |
| | Organic isolines & growth | Marching-squares contours over a domain-warped fbm field, plus a real differential-growth simulation |
| | Bio-cellular Voronoi | Lloyd-relaxed centroidal Voronoi with controllable web thickness and corner rounding |
| **Sacred geometry** | Sacred geometry | A compositional mandala builder (below) plus the classical constructions — Flower and Seed of Life, Metatron's Cube, Vesica lattices, Sri Yantra, golden spiral, {n/k} star polygons, Tree of Life, Platonic wireframes, Maurer roses and times-table circuits |

#### The overlapping ring lattice

Rings of equal radius on a triangular or square lattice, overlapping their
neighbours. It is the family that contains chainmail, Japanese *shippō* (seven
treasures), Celtic ring knots and — at the one ratio where a ring's radius
equals the lattice pitch — the Flower of Life.

Unlike the other engines it **grows outward** rather than filling the sheet:
`Rings outward` sets how many whole lattice rings step out from the centre, and
the silhouette is the scalloped hexagon, disc, rhombus or open wreath formed by
the union of the outermost circles. `Fill the sheet` is still there when you
want the classic wallpaper.

`Ring radius` is the control that changes the character most: 0.5 is circles
just touching, ~0.68 the classic chainmail overlap, 1.0 puts every circle
through its neighbours' centres.

Two details do the real work:

* **The weave needs a proper 3-colouring of the lattice**, so colour *k* can
  pass over colour *k+1* everywhere with no contradiction. Two classes cannot
  do it — you would need 0 over 1 and 1 over 0 at the same time. `(q − r) mod 3`
  serves on the triangular lattice and `(i + 2j) mod 3` on the square one; in
  both, every neighbour shifts the value, so no two touching rings match.
* **A strand's cut interval is measured against the other ring's annulus**, by
  walking its own centreline and testing the distance-to-centre predicate —
  not by estimating an arc length from the crossing angle. Rings meet at every
  angle from a near-tangency upward, and the arc-length estimate fails exactly
  at the shallow crossings, leaving a strap either nicked or severed.
* **Cut endpoints are interpolated, not snapped to the nearest vertex.**
  Snapping quantises every cut to one flattening segment — a couple of
  millimetres — which is coarse enough that a gap slider can be dragged through
  most of its range without any vertex changing sides, so the control appears
  dead.

#### Solid straps vs. outlined strapwork

`Strand style` picks between two fundamentally different ways of drawing the
same lattice, and the difference is worth understanding because it decides what
the interlacing can look like.

**Solid straps** are a union. At a crossing the two bands merge into one body,
so the only way to show which passes over is to leave a physical gap — see
`Weave gap` below.

**Outlined strapwork** is the draughtsman's answer, and it is how every
hand-drawn Celtic knot and chainmail plate has ever been done: draw *both edges*
of every band, then **trim the under-band's edges where they run beneath the
over-band**, leaving the over-band's edges to pass straight through. Nothing is
removed from the shape — the trimmed line ends stop on the crossing line, so
what you get is a clean T-junction and an interlacing that reads perfectly with
no gap anywhere. The whole drawing stays one connected body, which is why the
`Woven Ring Strapwork` preset reports zero floating islands.

One detail matters in that trim, and getting it wrong is very visible: the cut
must stop exactly at the crossing band's edge, which is where the crossing
*line* is centred. The trimmed end's own round cap then reaches half a line
weight further and lands flush on the far side of that line. Stop any later and
the cap pokes out the other side — which reads as a bead threaded onto every
single crossing in the design.

`Weave gap` applies to solid straps. It is the width of the visible break the
under-strand leaves, measured to the edge of the strand crossing over it. **A
gap of 0 turns the weave off** rather than producing a hairline, and that is not a shortcut — a
union cannot represent an over-under. Anything cut out of the under-strand is
either covered by the over-strand, in which case the merged outline is
unchanged, or it is not, in which case the result is a nibbled notch rather
than a weave. So zero means no cut, and picking "no gap" gives back exactly the
merged web.

The cost of a real gap is that any arc with no over-crossing of its own becomes
a separate piece; auto-bridge reattaches them, the `Rim` option ties every
strand end into one border, and 0 is always there when a guaranteed single body
matters more than the illusion.

#### The mandala composer

A mandala reads as a stack of concentric **registers**: a core motif, a few
annular bands each with its own character, thin divider rings between them, and
a heavy outer border. The composer builds exactly that. Each band draws one
motif from a vocabulary of eighteen — petals, interlaced rings, star polygons,
scallops, lotus, meanders, spirals, lattices, chevrons, zig-zags — chosen per
band from a seed-shuffled palette, never the same style twice running.

What makes the result read as composed rather than scribbled is that the band
geometry is *fitted to the space it has*, and three rules do most of that work:

* **Band thicknesses come from normalised weights, not a power law.** A power
  law starves the inner bands until they fuse into a black dot. `Radial
  falloff` tilts the weights instead, so below 0.5 the inner registers are the
  wide ones and above it the outer ones are.
* **Motifs stay inside their annulus.** A {n/k} star's chords dip to
  `r·cos(kπ/n)` at their closest approach to the centre, so a star drawn on a
  band's outer circle slices straight across every band inside it. The skip is
  solved per band to the largest value whose chords clear the inner radius.
* **The core takes the *least* detail, not the most.** It occupies the smallest
  area in the figure, so driving its symmetry straight off `fold` — 18 elements
  crammed into a 25 mm disc — turns the middle into a solid dot. The core steps
  the order down to what the space can hold.

`Layer twist` is a *stagger* measured in fractions of each band's own angular
cell, not an absolute rotation: every band is n-fold symmetric, so rotating one
by anything near 360/n puts it straight back where it started. Radial spokes
are short ticks straddling each divider rather than lines running the whole
radius, which would cut a crude cross through every register.

Every control is filtered to the construction it actually affects — the panel
only shows sliders that will change what you are looking at.

### Modifier stack

* **Grid & symmetry** — Cartesian X×Y, polar radial *n*-fold with mirrors,
  hexagonal, triangular, half-drop brick. The engine draws one motif into the
  symmetry cell and the array replicates it, so tiling stays crisp.
* **Deformation fields** — spherical bulge/pinch, twirl/vortex, Perlin
  turbulence, sinusoidal wave warp, shear, perspective. Paths are re-sampled
  before deformation so straight lines correctly become curves.
* **Line weight & profile** — stroke weight scaling, variable-width (tapered)
  ribbons, corner filleting.
* **Canvas brushes** — drag directly on the 2D viewport to apply local ripple,
  pinch, magnet or twist warps. Each drag is committed as a stacked warp you
  can clear later.

### Boolean trim — clean, non-overlapping output

Pattern engines draw the way a designer thinks: ribbons cross, tiles butt up
against each other, circles overlap. Sent to CAD raw, that means duplicated
edges, contours crossing mid-span and the same line cut twice.

The trim resolves the whole design into a planar arrangement and re-emits it
as **non-overlapping closed contours** — outer boundaries wound CCW, holes CW,
every edge appearing exactly once:

1. every coordinate is snapped to a 1 µm grid, and each intersection is
   rounded **once** and shared by both segments, so the pieces stitch back
   together with no gaps;
2. segments are split at every crossing, T-junction and collinear overlap, and
   coincident sub-segments collapse into a single edge;
3. every *face* of the arrangement is classified once (not every edge), which
   is what keeps vertex degrees balanced and the walks closed even when the
   arrangement contains micron-scale slivers;
4. only material→void boundaries survive, oriented material-on-left, and are
   traced into closed loops.

The fill rule is nonzero, so overlapping ribbons union rather than cancelling,
while properly nested contours still cut holes. Encaustic medallions opt into
even-odd instead, because that is how those classical motifs are constructed.

`npm run verify` rasterises every engine and preset before and after the trim
and asserts the filled region is **identical** and the output has **zero**
self-intersections. `npm test` additionally parses the exported DXF back in
and checks for duplicate and crossing edges. Both are part of the suite.

It can be switched off (Fabrication ▸ Clean CAD output, or the button in the
Export tab) if you want the raw contours.

**When it refuses.** Two situations are reported rather than guessed at, and in
both the design falls back to raw contours with a visible warning:

* *Too many crossings.* A few hundred long mutually-crossing chords generate
  hundreds of thousands of intersections, and the arrangement cost grows with
  the square. Figures that can hit this — Maurer roses, times-table circuits —
  budget their chord count up front so they normally stay well clear.
* *A torn arrangement.* Where dozens of lines meet at one exact point, the
  material/void classification around that vertex can come out inconsistent,
  leaving boundary edges with no successor. A few of those are survivable and
  are dropped. If more than a quarter of the boundary ends up in dead-end
  chains the trim refuses the result outright, because what it would otherwise
  return is a single outer contour with a solid interior — a black disc that
  would be cut as one.

Two things reduce how often the second case arises at all. Ribbon decimation is
ring-aware: running plain Ramer–Douglas–Peucker on a closed contour whose ends
coincide gives it a zero-length baseline, and it collapses to two points, so
closed rings are split at two well-separated anchors first. And figures that
converge on the origin — `r = sin(kθ)` is exactly zero at a whole family of
sample angles — are clipped out of a small central hub and the hub drawn as its
own ring, so the chords meet a circle at distinct points instead of meeting
each other at one.

### Fabrication integrity engine

* **Floating-island detection.** The even-odd fill is rasterised and its
  connected components are labelled; any material component not attached to the
  main body is flagged in **bright red** and counted in the HUD. That's the
  fallout that drops through your laser bed.
* **Auto-bridging.** Real *keyhole merges*: two contours are opened at their
  nearest point pair and stitched into one closed loop with a bridge of the
  chosen width. Islands chain outward toward the body over several passes, and
  every merge is area-validated before it is accepted — so the result is still
  a single closed polyline with no overlapping double-cuts.
* **Kerf / tool offset.** Winding is normalised so "left of travel" is always
  the material side, then every contour is offset outward by half the kerf.
  Positive values grow material: dial in laser beam width (CO₂ ≈ 0.15 mm,
  fibre ≈ 0.10 mm), plasma arc width (≈ 1.5 mm) or an endmill diameter.
* **Frames.** Rectangle, rounded rectangle, circle, hexagon, octagon, arch and
  shield, with a parametric band width, evenly distributed mounting holes and
  an optional keyhole hanger tab. The pattern is clipped to the frame's inner
  boundary.
* **Live HUD.** Part bounding box, material area, material yield vs. fallout
  waste, sheet utilisation, island count, contour and vertex counts, and
  whether the output is trimmed or raw.

---

## Export

| Format | Notes |
| --- | --- |
| **DXF** | `AutoCAD 2000` (AC1015) writes closed `LWPOLYLINE` with bulges, plus `CIRCLE` and `SPLINE`; `R12` (AC1009) writes `POLYLINE`/`VERTEX`/`SEQEND`, bulges included, for older CAM posts. True 1:1 mm (`$INSUNITS = 4`), with layers `0_OUTER_FRAME`, `1_CUT_THROUGH`, `2_SCORE_ENGRAVE`. |
| **SVG** | One merged compound `<path>` per layer with real `A` arc commands, `mm` document units, hairline stroke or filled even-odd. Layers carry Inkscape group labels. |
| **STL** | Binary, extruded to the stock thickness from the same triangulated mesh the 3D viewport renders. |
| **JSON** | The full parametric preset — engine, seed, every slider, modifiers and frame. Reproduces byte-identically. |

### Curve fitting — circles and arcs, not 220-gons

Everything upstream works in polylines, because that is the only representation
the planar arrangement, the rasteriser and the triangulator can all agree on.
But a polyline is a poor thing to hand a CAD package: a circle that was
flattened to 220 segments imports as a 220-sided polygon, and every fillet,
offset and toolpath downstream inherits the facets.

So the curves are recovered at **export time**. Nothing in the pipeline
changes; the exporters ask for primitives instead of points, and runs of
vertices lying on a common circle come back out as `CIRCLE` entities, as arcs
carried in `LWPOLYLINE` bulges, or — in spline mode — as interpolating cubic
`SPLINE` entities. A ring exports as a ring.

Typical effect across the gallery: **209,728 vertices become 39,081 entities**,
and one preset's DXF went from 204 KB to 28 KB.

The tolerance is a real guarantee: every original vertex stays within it of the
emitted primitive, so a fitted export is the same part described better, never
a different part. Three rules keep it honest, and each exists because its
absence produced a specific wrong answer:

* **Angular steps must be small.** The four corners of a square are exactly
  concyclic, so no test based on how far vertices sit from a circle can tell a
  square from a coarse arc — a square's step is 90°, a flattened curve's is a
  couple of degrees.
* **Angular steps must be *uniform*.** A run that mixes a finely flattened
  fillet with one long straight edge admits a circle that passes within
  tolerance of every vertex while bowing millimetres away from the straight
  edge between two of them. That is how a straight circuit trace became a lens.
* **Splines are fitted to the source vertices and then verified against them.**
  Interpolating the arc endpoints alone says almost nothing about the curve
  between them, and a spline that passes through its own fit points can still
  wander. Any spline that fails the check is discarded and its arcs kept.

`npm run verify` renders every preset's SVG with fitting on and off and
compares them pixel by pixel — the test that catches a fitted curve which is
near every vertex but wrong between them, an inverted SVG sweep flag, or a
circle drawn against its winding so a hole fills in solid. `npm test` parses
the DXF back as a reader does and checks structure and geometry both.

### What made R14 DXF files unopenable

R12 is forgiving: a header, a layer table and some entities is a valid file.
R13 and later are not — a modern DXF is a serialisation of an object database,
and a reader may reject one whose database does not hold together. It needs a
unique handle on every table, table record, block and entity; an owner
back-reference on each; the full set of symbol tables including the ones that
are empty; a `BLOCKS` section defining `*Model_Space` and `*Paper_Space` for
the entities to belong to; and an `OBJECTS` section with the root dictionary.

The old exporter wrote an AC1014 header, a `LAYER` table with no handles, no
`BLOCK_RECORD` table, no `BLOCKS` section and no `OBJECTS` section. Any one of
those is enough for a strict reader to call the file corrupt — which is exactly
what every CAD package did, while the R12 output, held to almost no structural
requirements, opened fine.

---

## Source layout

```
src/
  engine/
    rng.js            seeded PRNG + simplex/fbm noise
    geom.js           the 2D CAD kernel (offsets, ribbons, fillets, nesting, clipping)
    fit.js            arc / circle / B-spline recovery from polylines
    triangulate.js    ear clipping with holes + extrusion to a mesh
    modifiers.js      symmetry arrays and deformation fields
    fabrication.js    frames, kerf, connectivity analysis, keyhole bridging, metrics
    boolean.js        planar arrangement / self-union — the trim
    build.js          the deterministic pipeline
    random.js         harmonious dice roll + evolve
    presets.js        the showcase gallery
    patterns/         the 14 engines, grouped by family
    exporters/        svg.js · dxf.js · stl.js · layers.js
  render/
    canvas2d.js       2D viewport renderer + themes
    webgl3d.js        WebGL material viewport
  ui/                 React components (App, panels, viewports, widgets)
  lib/h.js            React element helper
tools/
  test-engine.mjs     headless correctness suite
  verify-trim.mjs     proves the trim is region-exact and clean
  test-ui.mjs         headless browser test of the real interface
  bundle.mjs          builds the single-file HTML
  render-sheet.mjs    PNG contact sheets
```

Adding an engine means dropping one object into `src/engine/patterns/` — a
`params` schema (which auto-generates its control panel) and a `generate()`
that returns paths. Everything downstream is shared. Set `fillRule:
'evenodd'` on the engine if its motifs are built from overlapping shapes whose
intersections are meant to punch back out.

One rule worth knowing if you extend the pipeline: **never decimate geometry
before the trim.** Contours that touch share their vertices exactly, and
simplifying either side independently pulls them apart — which turns a clean
shared edge into a chain of alternating slivers. `densify()` (which preserves
every original vertex) exists for that reason; `resample()` must not be used
on anything heading for the boolean.

---

## Two implementation notes

**3D renderer.** The 3D viewport is a purpose-built WebGL renderer
(`src/render/webgl3d.js`) rather than Three.js: it was written in an
environment with no package-registry access, so the dependency could not be
installed or tested. It does what's needed here — orbit camera, three-point
studio rig, procedural wood grain / brushed-metal anisotropy / edge-lit acrylic
/ FDM layer lines, and a contact-shadow ground. Swapping in Three.js is a
single-file change: `Viewport3D` only calls `setMesh`, `orbit`, `pan`, `zoom`
and `render`, and the mesh it receives is already a plain positions/normals
`Float32Array` pair.

**Styling.** `src/styles.css` is a hand-authored design system for the same
reason. It is themed with CSS custom properties, so the whole interface
re-skins from the tokens at the top of the file. If you want Tailwind, add it
as a normal Vite plugin — nothing here conflicts with it.

**UI without JSX.** The React components are written with a small `h()`
hyperscript helper instead of JSX. That is deliberate: it lets the exact same
source files run under Vite, inside the no-build single-file bundle, and in
node for testing, with no transpiler in the loop.
