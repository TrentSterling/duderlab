# Duder Lab

An offline WebGL2 workbench for parametric bean characters, wearable meshes, procedural skins, animation, and rigid-body ragdolls. Current version: **V3.1.1 — Connected Hat Outlines**.

![The reported beanie outline before and after the V3.1.1 repair](docs/media/v3-1-1-hat-outline-comparison.png)

## Run

Download this repository and open **`static.html`** in a browser with WebGL2 enabled. It works directly from `file://`; the page contains its JavaScript, physics engine, shaders, and glyph atlas. No server, package installation, CDN, or network request is required.

The editable implementation is in `src/`. `static.html` is the built, self-contained distribution.

## Controls

| Control | Action |
| --- | --- |
| `M` | Open Idle, Walk, Wave, and Dance animations |
| `B` | Drop a pile of beans; choose 4, 8, 12, or 16 in Physics |
| `P` | Release the current animation to a ragdoll, or pause active physics |
| `S` | Start the two-duder sumo demo |
| Space | Pause or resume animation/physics |
| Left-drag a body | Grab; release to throw |
| Right-drag | Orbit the camera |
| Mouse wheel | Zoom |
| `X` / `O` | Toggle rig overlay / shell outlines |
| `D` / `K` | Drop or refill / kick |
| `G` / `F` | Switch Gallery/Focus / frame the view |
| `R` / Shift+`R` | Reroll one duder / restore the original collection |

## Rebuild

Python 3 is the only build dependency:

```sh
python3 build.py
```

On Windows, `py -3 build.py` works with the Python launcher. The script writes `static.html`, `duder-lab-v3-1-1.html`, and `dist/index.html`. UTF-8 is explicit, and the output directory is created automatically.

## V3.1.1: connected hat outlines

The pink duder with a green beanie, seed `1702468274`, exposed a defect that closed-mesh topology checks did not catch: a detached dark stroke below the hat hem, with pink body pixels visible between them.

- The beanie crown and folded cuff now form **one continuous closed surface**, while the darker cuff tint is preserved. Two microscopic reentrant notches at the join are removed so their back faces cannot poke through the shell as dark dots. A gently tapered extrusion at the bottom crease prevents the narrow bevel from folding over at thick outline settings.
- All five hollow main hat shapes keep their **inner/contact loops unexpanded**. Only exterior vertices move outward. The underside triangles stretch between those loops, maintaining coverage beneath the visible hem.
- The cap visor uses the same fixed contact arc, including its shared tapered endpoints, so its underside stays connected at the maximum outline width.
- Outline weight is interpolated across those triangles. A flat per-face value could discard a whole bridging triangle based on its last vertex.
- Anchored vertices also retain their original depth; the shell depth bias applies to expanded vertices. This prevents the head from occluding a thin contact strip at low viewing angles.
- The existing indexed fill and outline batches are retained: **four total draws**, or five with the rig overlay. No render pass, texture, or buffer was added for this repair.

The new rendered regression uses the exact reported recipe and checks for pink pixels between the green hem and dark stroke. It also checks that the stroke remains present. Geometry verification now explicitly requires a single connected beanie and matching outline weights at its color seams.

## Smooth shading and welded geometry

- Smooth shading is enabled by default for the body and all gear. The Preview toggle still provides flat shading.
- Coincident positions are canonicalized before shared normals are calculated. Accessories use angle-weighted normals across adjacent faces and color boundaries; the body retains its SDF gradient normals.
- Compatible vertex records are welded into indexed buffers. Both the fill and outline use `drawElements` on the same character batch. Color, material, and skinning boundaries keep any distinct attributes they need, while matching positions and smooth normals stay aligned.
- The cap visor now tapers to exact shared endpoints, closing the gaps at its two ends. Solid sunglass lenses now include their missing perimeter walls. Revolved seams and poles use exact shared coordinates.
- GLB export also welds matching position, normal, and color records and writes an indexed mesh. The current shading choice and posed shape are preserved.

For the [default 16-duder gallery](docs/media/v3-1-1-gallery.png), the same V3.1.1 mesh has the following storage cost:

| Geometry layout | Vertex records | Geometry buffer bytes |
| --- | ---: | ---: |
| Expanded triangle layout | 84,408 | 9,453,696 |
| Indexed normal rendering | 14,470 | 1,784,632 |

That is **82.9% fewer vertex records** and **81.1% less GPU geometry-buffer storage**, including the index buffer. This comparison excludes textures and UI buffers. Wireframe mode lazily uploads an additional expanded copy because barycentric wire edges require per-triangle attributes. These are storage measurements, not hardware FPS claims.

The body and wearables remain separate, closed components where appropriate. The beanie crown and cuff are one continuous surface; other trim, cap brims, and the body retain their separate components. The complete duder is not a single watertight CAD object.

The [cap comparison](docs/media/v3-1-cap-comparison.png) and [bucket-hat comparison](docs/media/v3-1-bucket-comparison.png) show V3 above V3.1 from three angles.

## Implementation

- A connected Surface Nets body follows seven bones. Bounded SDF correction repairs blended joint regions without accumulating projection drift.
- Procedural skin patterns sample rest-space coordinates.
- Each ragdoll has seven bodies and six joints. Cannon-es runs at a fixed 120 Hz simulation step.
- Pile mode uses smaller collision proxies and staggered spawns; its optional 16-bean setting has 112 rigid bodies and 96 joints.
- Shell outlines use shared smooth extrusion normals after geometry assembly. Fill and outline geometry share the indexed render path.
- Bodies, eyes, and accessories share one fill draw. The stage, outline, and GPU glyph UI bring the total to four draws. The optional rig overlay adds one. More beans still increase physics and triangle work.
- JSON exports retain editable recipes. GLB exports bake the current pose into one static mesh/material; runtime joints and a glTF skeleton are not exported.

## Verification

The JavaScript checks use Node's built-in modules, with no npm dependencies:

```sh
node qa/check-app-events.mjs
node qa/check-shell.mjs
node qa/check-animation.mjs
node qa/check-physics.mjs
node qa/check-pile.mjs
node qa/check-outline-weld.mjs
node qa/check-hat-topology.mjs
node qa/check-hat-contact-outline.mjs
node qa/check-welded-mesh.mjs
node qa/check-ui-v3.mjs
```

Current repair results are in `docs/verification/v3-1-1/`, with earlier results retained in `docs/verification/v3-1/` and `docs/verification/v3/`. V3.1.1 verification includes 43 application interactions, 46 hat-contact geometry cases, 45 hat topology variants, 102 gear/dimension combinations and indexed GLB reconstruction, and 53 actual GLES renders covering the reported outline defect, every hat style, and the complete gallery. Earlier animation, physics, and responsive UI reports remain available. The interaction harness mocks DOM/WebGL transport; it does not replace a browser test. Software GLES rendering separately validates the actual shaders, element buffers, and visible outline behavior.

[Watch or download the V3 motion proof](docs/media/duder-v3-motion.mp4). It replays actual application shaders and simulation using software GLES. It is not a hardware FPS benchmark.

### Optional software rendering

The still-image regression uses Node, Python with Pillow, and Linux/WSL Mesa EGL/GLES (`libEGL.so.1`). It renders the actual shaders and checks the reported hat-outline defect without a physical GPU:

```sh
python3 qa/check-hat-outline-render.py
```

Pass `--baseline /path/to/v3.1/checkout` to also reproduce the old defect and create before/after images. The baseline must contain the editable source and QA tools, not just the standalone HTML.

The motion-video workflow additionally requires FFmpeg with libx264:

```sh
python3 qa/render-motion.py output/pile.mp4 --mode pile --frames 108 --fps 12 --width 960 --height 720
```

Supported modes: `idle`, `walk`, `wave`, `dance`, `ragdoll`, `sumo`, and `pile`. Raw captures and temporary render output are intentionally ignored by Git.

## Credits and bundled notices

- SDF blend-shell technique adapted from [Trent Sterling's Critters](https://github.com/TrentSterling/critters), with its GOOBERS / u/AntiqueFeedback7447 and RujiK provenance retained in the source.
- [Cannon-es](https://github.com/pmndrs/cannon-es), version 0.20.0: its MIT license is included in `src/vendor-cannon.js` and the generated HTML.
- [DejaVu Sans](https://dejavu-fonts.github.io/): font notices are included in `src/font-data.js` and the generated HTML.

No project-wide open-source license has been assigned. The bundled third-party notices continue to apply to their respective components.
