# V3.4.6 shoulder-loop verification

This release replaces the shoulder attachment geometry. Review the [surface and wireframe comparison](../../media/v3-4-6-shoulder-closeup.png) and [wave video](../../media/v3-4-6-shoulder-wave.mp4) alongside the [topology notes](../../shoulder-topology.md).

- `shoulder-validation-summary.json`: structural-check scope and provenance, including the final bind scan and the two thin-arm regressions.
- `baseline-shoulder-topology.json`: the prior V3.4.5 reference web, including actual edge stretch, positions, and weights. Its old SDF surface comparison is a baseline diagnostic, not the target shape of the new ring mesh.
- `dual-quaternion-report.json`: actual GLES transform-feedback agreement with CPU export, rigid-motion checks, and posed bake continuity.
- `arm-study-view-report.json`: eight application checks for study startup, saved-collection isolation, weight-view controls, and unchanged resources/draw count when toggling the view.
- `build-report.json`: all eleven modules embedded exactly, standalone outputs, study startup flag, JavaScript parsing, and offline dependency checks.
- `arm-study-report.json`: twenty matched surface, diagnostic weight, and wave-keyframe captures.
- `arm-wave-video-report.json`: the matched four-second, 64-frame motion proof.
- `shoulder-closeups-report.json`: ten production-shader closeups including actual wireframe, with the same camera and pose for each before/after pair.

Skinning a normal by bone rotations omits the spatial weight gradient. Negative alignment with that approximation is recorded as a shading diagnostic; it is not automatically a folded mesh. Targeted intersection and generalized-winding checks adjudicate suspect faces. Those checks exclude shared-vertex and coplanar contacts and do not claim to prove that every possible pose is free of self-intersection.

Rendering is software GLES replay of the actual application buffers and shaders. It is not a browser/hardware frame-rate benchmark. A small local shading crease remains at strong shoulder bends, as shown in the surface proof.
