# V3.4.5 arm study verification

- `arm-influence-report.json`: eight body recipes; isolated arm transforms; nine wave phases; protected torso and near-underarm diagnostics; finite normalized weights; infinitesimal continuity; welded records; 27 triangle-orientation cases. Includes the recovered V3.4.4 baseline.
- `dual-quaternion-report.json`: CPU/GPU pose agreement using actual production GLSL transform feedback, plus rigid-motion and volume checks.
- `animation-report.json`: clip continuity, fixed bone lengths, joint limits, hand direction, clearance, and wave readability.
- `arm-study-report.json`: 20 matched surface, influence-map, and wave keyframe captures with source hashes and GLES validation.
- `arm-wave-video-report.json`: a four-second, 64-frame A/B wave rendered at matching times.
- `arm-study-view-report.json`: eight application checks covering study startup, saved-collection isolation, keyboard/button toggles, unchanged pose and geometry, resource allocations, and draw counts.
- `app-events-report.json`: 43 existing application checks covering navigation, editing, physics, animation, and downloads.
- `live-arm-weights-report.json`: the enabled live weight view and Motion UI replayed through unmodified production shaders, with shader compilation/linking and GL error results.
- `build-report.json`: exact embedding of all eleven source modules, offline resource checks, and the startup-flag-only difference in the study download.

The [arm study](../../arm-study.md) explains the method, source recovery, accepted change, rejected experiments, and remaining underarm crease. Media is in `docs/media/v3-4-5-*`. Software shader replay and application event harnesses are not browser hardware performance measurements.
