"""Render hollow-hat outline regressions with the real application shaders.

Requires Node, Pillow and the same Linux/WSL Mesa EGL/GLES libraries as
render-capture.py. No physical GPU is required. Example:

    python3 qa/check-hat-outline-render.py --baseline /path/to/v3.1/checkout

The optional baseline is a source checkout, not a standalone HTML file.
Raw traces and screenshots are written under output/hat-outline by default.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import subprocess

from PIL import Image, ImageDraw, ImageFont


HERE = Path(__file__).resolve().parent


def hem_pixels(path):
    """Measure this controlled green-hat/pink-body fixture, not arbitrary art.

    A detached shell has pink pixels between the last green hem pixel and the
    dark stroke. Restrict the check to the central 60% of the hat to avoid side
    silhouettes, and require stroke coverage separately so hiding it cannot pass.
    """
    image = Image.open(path).convert('RGB')
    points = []
    for x in range(image.width):
        green = []
        for y in range(image.height // 2):
            red, g, blue = image.getpixel((x, y))
            if g > red + 20 and g > blue + 12:
                green.append(y)
        if green:
            points.append((x, max(green), min(green)))
    if not points:
        raise AssertionError('No green hat pixels in the controlled fixture')
    left, right = points[0][0], points[-1][0]
    interior = [(x, y) for x, y, _ in points
                if left + (right-left)*.2 <= x <= right - (right-left)*.2]
    detached = 0
    strokes = 0
    gap_pixels = 0
    for x, y in interior:
        dark = []
        for yy in range(y+1, min(y+13, image.height)):
            color = image.getpixel((x, yy))
            if all(abs(a-b) <= 2 for a, b in zip(color, (14, 19, 23))):
                dark.append(yy)
        if not dark:
            continue
        strokes += 1
        pink = []
        for yy in range(y+1, min(dark)):
            red, g, blue = image.getpixel((x, yy))
            if red > g*1.4 and red > blue*1.1:
                pink.append(yy)
        if pink:
            detached += 1
            gap_pixels += len(pink)
    return {
        'columns': len(interior), 'strokeColumns': strokes,
        'detachedColumns': detached, 'pinkGapPixels': gap_pixels,
        'hatBounds': [left, min(p[2] for p in points), right+1,
                      max(p[1] for p in points)+1],
    }


def interior_outline_pixels(path, bounds):
    """Count dark cuff fragments surrounded by green in the beanie fixture.

    The old micro-notch exposed a dotted backside strip inside the painted
    cuff. Require green on all four sides and a component disconnected from
    the silhouette. A curved, connected rim can also have green nearby on all
    sides; flood filling the stroke distinguishes that from an interior dot.
    The eight-pixel search radius is specific to the fixed 500x424 capture;
    this is not a general image metric.
    """
    image = Image.open(path).convert('RGB')
    left, top, right, bottom = bounds

    def green(x, y):
        red, g, blue = image.getpixel((x, y))
        return g > red + 20 and g > blue + 12

    def dark(x, y):
        color = image.getpixel((x, y))
        return all(abs(a-b) <= 2 for a, b in zip(color, (14, 19, 23)))

    points = []
    for y in range(top, bottom):
        for x in range(left, right):
            if not dark(x, y):
                continue
            directions = [
                ((xx, y) for xx in range(max(0, x-8), x)),
                ((xx, y) for xx in range(x+1, min(image.width, x+9))),
                ((x, yy) for yy in range(max(0, y-8), y)),
                ((x, yy) for yy in range(y+1, min(image.height, y+9))),
            ]
            if all(any(green(xx, yy) for xx, yy in direction)
                   for direction in directions):
                points.append([x, y])
    component_is_interior = {}
    for x, y in points:
        if (x, y) in component_is_interior:
            continue
        visited = {(x, y)}
        pending = [(x, y)]
        while pending:
            px, py = pending.pop()
            for dx, dy in ((-1, -1), (0, -1), (1, -1), (-1, 0),
                           (1, 0), (-1, 1), (0, 1), (1, 1)):
                q = (px+dx, py+dy)
                if (0 <= q[0] < image.width and 0 <= q[1] < image.height
                        and q not in visited and dark(*q)):
                    visited.add(q)
                    pending.append(q)
        interior = all(left <= px < right and top <= py < bottom
                       for px, py in visited)
        for point in visited:
            component_is_interior[point] = interior
    return [p for p in points if component_is_interior[tuple(p)]]


def comparison(output, width):
    """Nearest-neighbor enlargement preserves the actual regression pixels."""
    names = [f'before-beanie-front-{width}', f'after-beanie-front-{width}']
    if not all((output/(name+'.png')).exists() for name in names):
        return None
    images = [Image.open(output/(name+'.png')).convert('RGB') for name in names]
    bounds = [hem_pixels(output/(name+'.png'))['hatBounds'] for name in names]
    crop = [max(0, min(b[0] for b in bounds)-10),
            max(0, min(b[1] for b in bounds)-8),
            min(images[0].width, max(b[2] for b in bounds)+10),
            min(images[0].height, max(b[3] for b in bounds)+16)]
    panels = [im.crop(crop) for im in images]
    panels = [im.resize((im.width*3, im.height*3), Image.Resampling.NEAREST)
              for im in panels]
    try:
        font = ImageFont.truetype('DejaVuSans.ttf', 18)
    except OSError:
        font = ImageFont.load_default()
    sheet = Image.new('RGB', (panels[0].width*2+16, panels[0].height+38), '#f3f1eb')
    draw = ImageDraw.Draw(sheet)
    for i, (panel, label) in enumerate(zip(panels, ['V3.1: detached rim', 'V3.1.1: connected rim'])):
        x = i*(panel.width+16)
        draw.text((x+8, 9), label, fill='#172129', font=font)
        sheet.paste(panel, (x, 38))
    path = output/f'beanie-hem-before-after-{width}.png'
    sheet.save(path)
    return path.name


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline', type=Path)
    parser.add_argument('--output', type=Path, default=HERE.parent/'output/hat-outline')
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    command = ['node', str(HERE/'capture-hat-outline.mjs'), '--output', str(output)]
    if args.baseline:
        command += ['--baseline', str(args.baseline.resolve())]
    subprocess.run(command, check=True)

    spec = importlib.util.spec_from_file_location('render_capture', HERE/'render-capture.py')
    render_module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(render_module)
    manifest = json.loads((output/'manifest.json').read_text(encoding='utf-8'))
    rows = []
    failures = []
    renderers = {}
    renderer_info = None
    try:
        for case in manifest['cases']:
            trace = json.loads((output/(case['name']+'.trace.json')).read_text(encoding='utf-8'))
            size = (trace['width'], trace['height'])
            if size not in renderers:
                renderers[size] = render_module.EGLRenderer(*size)
            renderer = renderers[size]
            renderer.draw_report = []
            renderer.compile_report = []
            image_path = output/(case['name']+'.png')
            report = renderer.render(trace, image_path)
            renderer_info = report['renderer']
            errors = [error for draw in report['draws'] for error in draw['errors']]
            row = {**case, 'drawCalls': report['draw_calls'],
                   'indexedDrawCalls': report['indexed_draw_calls'], 'glErrors': errors}
            if 'hat' in case:
                row.update(hem_pixels(image_path))
                if case['hat'] == 'beanie':
                    row['interiorOutlinePixels'] = interior_outline_pixels(image_path, row['hatBounds'])
            if errors:
                failures.append(case['name']+': GL errors')
            if case['version'] == 'after':
                expected = 4 if case['name'] == 'final-gallery' else 3
                if report['draw_calls'] != expected or report['indexed_draw_calls'] != 2:
                    failures.append(case['name']+': character passes are not one fill and one outline')
                # Any visible stroke must remain attached across the controlled
                # hat/view cases. The head can legitimately hide a lower contour
                # from below. Preserve full coverage in the reference, side and
                # shallow low-angle views, plus a visible hem from underneath.
                if 'hat' in case:
                    if row['detachedColumns'] or row['pinkGapPixels']:
                        failures.append(case['name']+': detached pink gap remains')
                if case.get('hat') == 'beanie':
                    if row['interiorOutlinePixels']:
                        failures.append(case['name']+': isolated dark cuff fragments remain')
                    full_hem = ((case['view'] in ('front', 'side') and case['width'] >= 2.2)
                                or (case['view'] == 'below' and case['width'] == 4))
                    if full_hem and row['strokeColumns'] != row['columns']:
                        failures.append(case['name']+': lower outline is missing')
                    if case['view'] == 'under' and case['width'] == 4 and row['strokeColumns'] == 0:
                        failures.append(case['name']+': underside hem was completely hidden')
            rows.append(row)
            print(json.dumps({k: row[k] for k in ('name', 'drawCalls', 'glErrors', 'detachedColumns', 'pinkGapPixels', 'strokeColumns') if k in row}), flush=True)
    finally:
        for renderer in renderers.values():
            renderer.close()

    if args.baseline:
        before = next(row for row in rows if row['name'] == 'before-beanie-front-2.2')
        if before['detachedColumns'] == 0:
            failures.append('The supplied baseline did not reproduce the screenshot defect')
    proofs = [name for width in (2.2, 4) if (name := comparison(output, width))]
    summary = {
        'passed': not failures, 'failures': failures, 'seed': manifest['seed'],
        'recipe': manifest['recipe'], 'renderer': renderer_info,
        'verificationScope': 'Actual application shader and index-buffer replay on software GLES; not browser interaction or hardware performance.',
        'metricScope': 'Controlled green-hat/pink-body screenshot fixture. Every final hat/view case requires zero pink gaps; the beanie also requires zero isolated dark cuff fragments surrounded by green. The beanie front and side checks require full stroke coverage at default and maximum widths, as does the shallow low-angle view at maximum width. Its underside contour can be partially occluded by the head but must remain visible at maximum width.',
        'sourceHashes': next(row['sourceHashes'] for row in rows if row['name'] == 'final-gallery'),
        'proofImages': proofs, 'cases': rows,
    }
    (output/'hat-outline-render-report.json').write_text(json.dumps(summary, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({'passed': summary['passed'], 'cases': len(rows), 'failures': failures, 'output': str(output)}))
    if failures:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
