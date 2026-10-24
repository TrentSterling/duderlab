from pathlib import Path
import re

ROOT=Path(__file__).resolve().parent
files=['font-data.js','vendor-cannon.js','core.js','shell.js','geometry.js','collision-shapes.js','physics.js','animation.js','renderer.js','ui.js','app.js']
header='''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark"><meta name="description" content="Duder Lab V3.2.1: offline parametric beans, smooth welded geometry, closed wearable meshes, SDF shell outlines, rigid-body ragdolls, sumo, bean piles, friendly procedural waves, and posed GLB export.">
<meta name="theme-color" content="#14171a"><title>Duder Lab V3.2.1 — Soft Elbows</title>
<style>*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#14171a}#duder{width:100%;height:100%;display:block;touch-action:none;outline:none}#fallback{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);background:#161c20;color:#eef1dc;padding:24px;max-width:580px;border:1px solid #55613f;border-radius:12px;font:16px/1.5 system-ui,sans-serif}#fallback[hidden]{display:none}</style>
</head><body><canvas id="duder" tabindex="0" role="application" aria-label="Duder Lab V3.2.1 interactive 3D bean generator and physics playground. B starts a bean pile, M opens animation, S starts sumo, P releases to ragdoll, Space pauses motion, left drag grabs, right drag orbits, X shows the rig, O toggles shell outlines. G gallery, F frame, R reroll, question mark help."></canvas><div id="fallback">Preparing the duder workshop…</div>
<!-- This file is completely self-contained: no imports, CDNs, fetches, or external assets.
Original rendering/character UI: Duder Lab, made for Trent Sterling.
SDF blend-shell projection adapted from https://github.com/TrentSterling/critters .
Technique inspiration credited by Critters: GOOBERS by u/AntiqueFeedback7447; visual prior art RujiK.
The live connected shell is sampled from an SDF union and projected in the vertex shader;
Vertices are bone-driven; SDF corrections are bounded to blended joint regions.
Physics uses embedded cannon-es 0.20.0 (MIT license included in vendor source).
GLB bakes the current polygonal pose and accessories. It does not export runtime constraints or a glTF skeleton.
The embedded UI glyph atlas uses DejaVu Sans. See https://dejavu-fonts.github.io/License.html .
-->
'''
parts=[header]
for f in files:
    src=(ROOT/'src'/f).read_text(encoding='utf-8')
    parts.append('<script>\n'+src.replace('</script','<\\/script')+'\n</script>\n')
parts.append('</body></html>')
text=''.join(parts)
(ROOT/'dist').mkdir(parents=True, exist_ok=True)
(ROOT/'dist'/'index.html').write_text(text, encoding='utf-8')
(ROOT/'static.html').write_text(text, encoding='utf-8')
(ROOT/'duder-lab-v3-2-1.html').write_text(text, encoding='utf-8')
print(f'duder-lab-v3-2-1.html: {len(text.encode()):,} bytes, {len(files)} embedded modules, no runtime dependencies')
