# V3.2.1 verification — soft elbows and an A bind pose

This release fixes the sharp inside-elbow notch shown in the reference screenshot. The character now starts from a straight, open A bind pose, and each arm's elbow weights change along its length instead of following the relative distances to two overlapping capsule ends. The wave is solved again for that bind pose so the mitten still faces the viewer beside the head.

The body lattice is also finer at all three detail settings. This reduces the long underarm outline tails caused by a coarse posed triangle and its smooth extrusion normals disagreeing. The existing smooth, welded surface and wearable-outline behavior remain in place. The physical rig still contains **seven bodies and six joints per duder**, with no additional body, wrist joint, rendering pass, or pose-texture allocation.

The lower legs have adaptive clearance for narrow bodies with large feet. Because the blend slider now affects that clearance and the hip positions, it is included in the animation rig cache key. The elbow-weight frame cache is keyed by the generated primitive array.

## Evidence and attribution

The JSON reports in this directory record the checked cases and their limits. Reports with `sourceHashes` identify the production source they loaded. Before/after render reports intentionally contain both the frozen V3.2 baseline hashes and the V3.2.1 hashes; their `before` cases are historical controls.

| Report | Coverage and result |
| --- | --- |
| [bind-pose-report.json](bind-pose-report.json) | 1,024 parameter corners, 2,048 straight elbow frames, and 96 warm-cache versus fresh-cache animation comparisons. Hinge axes were finite, normalized, and perpendicular to the straight arm segments. Cached poses and weight results matched fresh results exactly. |
| [elbow-deformation-report.json](elbow-deformation-report.json) | Exact screenshot seed `1702468274`, all three detail levels, and nine wave phases: 27 cases. No local elbow triangle reversal exceeded the test's stated threshold. Independent posed-field alignment and area ratios are retained as diagnostics; the numerical test does not replace the visual captures. |
| [dual-quaternion-report.json](dual-quaternion-report.json) | 180 rigid-transform cases, 288 quaternion-sign cases, 128 cross-section samples, and 12 posed mesh bakes. Actual production GLSL transform feedback compared **27,288 posed vertices** with the CPU bake. Maximum position difference was **1.36 × 10⁻⁶**; maximum normal-vector difference was **below 2.25 × 10⁻⁵**. Coincident indexed vertices remained coincident in the CPU bake. |
| [wave-handoff-report.json](wave-handoff-report.json) | 672 poses checked through the actual cannon-es constraints and 70 one-second wave-to-ragdoll releases. No initial forearm/torso collider contacts were found. Maximum transform difference at handoff was `2.38 × 10⁻⁷`; maximum joint gap during the sampled releases was **3.43 mm**. Shoulder swing, transported twist, and elbow stops remained within their defined limits. |
| [physics-report.json](physics-report.json) | Four shape-specific drops, grab/release/kick interaction, sumo contact, timeout, and round restart. The largest observed joint gap was **4.11 mm** in the grab/kick case. |
| [pile-report.json](pile-report.json) | Eight- and 16-duder piles, pile grab/release/kick, pause/refill behavior, and handoff from idle, walk, wave, and dance. The largest observed pile joint gap was **15.73 mm**, within the existing 50 mm gate. No stability thresholds were relaxed. |
| [leg-clearance-report.json](leg-clearance-report.json) | 288 recipes and 72,576 field samples; 48 mesh recipes, 240 posed bakes, and 960 mesh slices. The minimum measured mesh gap was **0.12539 scene units**. Seventy blend-cache cases matched their fresh rig definitions exactly. This check covers neutral and mild idle poses. |
| [welded-mesh-report.json](welded-mesh-report.json) | 102 closed-gear checks and four GLB export cases. Compatible welded records reduced the test set's expanded vertex count by **83.08%**, with zero normal differences across the checked smooth seams. Final source hashes were stable during the run. |
| [build-report.json](build-report.json) | Eleven embedded modules match the release source byte for byte after the HTML script escaping is reversed. The three standalone outputs are identical. No external resource attributes, CSS resources, or runtime network API calls were found by the build audit. |

### General animation suite

`check-animation.mjs` covers idle, walk, wave, and dance with 768 rigid pose samples and 48 mesh bakes. Its greeting checks use 24 recipes, 4,680 numeric wave samples, and 1,968 held-wave samples at amplitudes 0, 1, and 1.25. It checks joint continuity, fixed arm lengths, grounding, loop seams, hand/face clearance, an upright forearm, and a visibly moving hand with a quiet elbow. The final source-attributed run measured no exact loop-seam discontinuity and a minimum held forearm-up component of **0.952**. See [animation-report.json](animation-report.json) for the measured extrema.

## Actual shader rendering

The render captures replay the production indexed buffers, textures, uniforms, and GLSL using Mesa EGL/GLES. The wave study contains **19 still cases**: four frozen-baseline views, four current held-pose views, eight wave frames, and three rig views. Those captures completed with no GL errors and exactly two indexed character draws in each case. Scene-only views use three draws including the stage; adding the rig uses four. The ordinary application adds its batched GPU UI draw, giving **four draws**, or five with the rig overlay.

The release media also includes eight leg-comparison frames and a 192-frame wave video with three synchronized views. These are rendered evidence from the implementation. They are not new concept art or a browser interaction test. The source hashes and rendering details remain in the corresponding render reports archived with this release.

The shader and transform-feedback checks use software GLES. Their timings are not hardware FPS measurements, and successful shader execution alone does not establish visual quality. The fixed-camera close-ups and wave extremes were inspected separately.

## Visual result and practical limits

The deep V-shaped pinch in the supplied front-view reference is removed. The open bind pose and longitudinal weights avoid folding that already bent rest elbow into the greeting. The finer body tessellation improves the long side-view outline tail without introducing a special outline-discard shader or an additional pass. The renderer's executable behavior is unchanged from V3.2.

Very large close-ups, particularly at the lowest detail setting, can still expose short underarm contour endpoints. The detailed visual review records these residual strokes; this release does not claim that every possible camera and ragdoll pose is artifact-free. The reported lower-leg gap applies to neutral and mild idle poses; arbitrary collision poses can naturally bring the legs together.

Smooth normals and matching welded positions are retained across compatible mesh records. Intentional material boundaries may still use separate vertex records at the same position. Gear remains rigid, and the posed GLB export remains a static mesh rather than an exported animation skeleton or physics rig.

## Standalone artifact

`static.html`, `duder-lab-v3-2-1.html`, and `dist/index.html` are **626,447 bytes** each and have the same SHA256:

```text
d425cab8e4ba531094f326b4e962df5d4cc3a6e0e6d240216f8460a2e01a78e0
```

The build audit independently compared all eleven embedded modules with `src/`, checked their hashes against `build-report.json`, and compared the output files with one another. The HTML includes its character code, physics code, GPU UI, and font data and has no runtime CDN dependency.

## Reproducing the focused checks

Run from the repository root:

```sh
node qa/check-bind-pose.mjs
node qa/check-elbow-deformation.mjs
node qa/check-leg-clearance.mjs
node qa/check-welded-mesh.mjs
node qa/check-dual-quaternion.mjs
node qa/check-animation.mjs
node qa/check-wave-handoff.mjs
node qa/check-physics.mjs
node qa/check-pile.mjs
python3 qa/check-build.py
```

The GPU parity and render helpers require a working EGL/GLES runtime. Historical V3.2 reports and media remain in their versioned directories; they should not be substituted for the V3.2.1 source-attributed reports.
