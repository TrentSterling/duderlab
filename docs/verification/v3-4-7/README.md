# V3.4.7 shoulder validation

The accepted local shoulder loop passes the final scoped geometry check: **five bind cases and 45 posed body cases**. The five recipes are the reported seed, Mint Bucket, Teal Bowler, Cyan Static, and the thin-short extreme. These reports do not claim a final all-preset or 24-case pass.

## Evidence

| File | Scope |
| --- | --- |
| `shoulder-reference.json` | Seed 1702468274, facets 12: bind plus identity and eight wave samples. |
| `shoulder-regressions.json` | Mint Bucket, Teal Bowler, Cyan Static, and thin-short: four bind cases plus 36 posed cases. |
| `shoulder-locality.json` | Exact study fixture against V3.4.5 (`15172b8`): original positions, weights, metadata, held-wave positions, distant normals and triangle identity, and accessory attributes. |
| `inherited-thin-long.json` | Historical baseline control: the same original buried face exists at wave 2.82s in V3.4.5 and the intermediate no-elbow candidate, with bit-identical posed coordinates. This is not a final-source thin-long retest. |
| `shoulder-validation-summary.json` | Aggregate results, exact source hashes, candidate-to-production byte identity, coverage and limitations. |
| `dual-quaternion-report.json` | Actual GLES/CPU agreement for 31,092 vertices; maximum position error 0.00000136 world units. |
| `arm-study-view-report.json` | Eight application startup, storage, input, and draw-submission checks. |
| `build-report.json` | Eleven exact embedded modules, matching offline outputs, and no runtime network dependencies. |
| `shoulder-closeups-report.json` | Ten production surface/wire captures, with exact final source hashes. |
| `arm-study-report.json` / `arm-wave-video-report.json` | Matched views and a four-second, 64-frame wave comparison; no reported GL errors. |

The reports retain their original temporary `sourceRoot` values. The summary verifies that `core.js`, `shell.js`, `geometry.js`, `animation.js`, and `renderer.js` in the tested local-snap candidate are byte-identical to the final production files. The source hashes in the raw reports were not rewritten after integration.

## What the checks establish

The tested shells and rendered bodies are closed, connected, consistently wound meshes with sphere topology. Their skin weights are finite and normalized, retain seven bones, agree at coincident vertices, and preserve the authored neutral export. All sampled poses preserve coincident seams. Faces flagged by normal disagreement are separately checked using generalized winding and proper intersections with nonadjacent triangles. There are no facing failures in the five final cases.

A transported bind normal omits the weight gradient, and a shading normal is not a surface-orientation oracle. Their disagreement remains diagnostic. Intersection checks exclude shared-vertex contacts and coplanar overlaps and are not a proof that every possible self intersection is absent.

Each recipe is checked at identity and wave times **0, 0.8, 1.16, 1.88, 2.38, 2.82, 3.2, and 3.76 seconds**. The randomized reported-wave recipe has a sunhat and a color pattern, but this QA isolates its body and suppresses color subdivision during deformation checks. The locality and triangle-budget comparison uses the visible study appearance: solid color, no outfit, beanie, no glasses.

## Locality and budget

For the exact study fixture, all **1,090 original vertices** keep the same positions, skin weights, metadata and held-wave positions. The loop adds **43 shared vertices and 86 triangles**. Total triangles rise from **3,232 to 3,318**, including the unchanged accessories and eyes; body triangles rise from **2,176 to 2,262**.

Only the 50 original vertices in the replaced shoulder strip receive changed normals. Distant normals remain exact, all **2,009 wholly distant original triangles** retain their identity, and accessory attributes are byte-identical. The allowed strip is derived from the original triangles actually replaced by the contour split, rather than an anatomical distance mask. Obsolete snapshots of historical face IDs were omitted from the saved locality report; all locality checks and results are preserved.

The inherited thin-long limitation is documented separately. An earlier broader investigation found it on the same original face in the baseline, and it was not treated as a new shoulder-loop regression. The final acceptance is deliberately limited to the five recipes listed above.

## Reproduction

From the repository root, the existing structural checker reproduces each final case:

```sh
node qa/check-shoulder-manifold.mjs --source . --case reported-wave --check-facing --report /tmp/shoulder-reference.json
node qa/check-shoulder-manifold.mjs --source . --case Mint --check-facing --report /tmp/shoulder-mint.json
node qa/check-shoulder-manifold.mjs --source . --case Teal --check-facing --report /tmp/shoulder-teal.json
node qa/check-shoulder-manifold.mjs --source . --case Cyan --check-facing --report /tmp/shoulder-cyan.json
node qa/check-shoulder-manifold.mjs --source . --case thin-short --check-facing --report /tmp/shoulder-thin-short.json
```

Visual captures, GPU parity, app events, and build evidence are maintained alongside these reports by the release integration workflow; they are separate from this scoped geometry acceptance.
