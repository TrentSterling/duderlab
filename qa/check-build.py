#!/usr/bin/env python3
"""Verify the offline distribution contains the exact editable sources."""
import hashlib
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parent.parent


def digest(data):
    return hashlib.sha256(data).hexdigest()


def main():
    subprocess.run(['python3', str(ROOT / 'build.py')], check=True)
    html = (ROOT / 'static.html').read_text(encoding='utf-8')
    scripts = re.findall(r'<script>\n(.*?)\n</script>', html, re.S)
    files = ['font-data.js', 'vendor-cannon.js', 'core.js', 'shell.js',
             'geometry.js', 'collision-shapes.js', 'physics.js', 'animation.js',
             'renderer.js', 'ui.js', 'app.js']
    assert len(scripts) == len(files), 'Embedded module count changed'
    modules = []
    for name, embedded in zip(files, scripts):
        source = (ROOT / 'src' / name).read_text(encoding='utf-8')
        assert embedded == source.replace('</script', '<\\/script'), name + ' is stale'
        subprocess.run(['node', '--check'], input=embedded, text=True, check=True,
                       stdout=subprocess.DEVNULL)
        modules.append({'file': name, 'bytes': len(source.encode()),
                        'sha256': digest(source.encode()), 'exactEmbedding': True})
    paths = ['static.html', 'duder-lab-v3-4-4.html', 'dist/index.html']
    outputs = []
    for path in paths:
        data = (ROOT / path).read_bytes()
        assert data == html.encode('utf-8'), path + ' differs'
        outputs.append({'path': path, 'bytes': len(data), 'sha256': digest(data),
                        'identical': True})
    external = re.findall(r'<(?:script|link|img|iframe|source|video|audio)\b[^>]*\b(?:src|href)\s*=\s*["\'](?:https?:)?//[^"\']+', html, re.I)
    css = re.findall(r'url\(\s*["\']?(?:https?:)?//[^)]+', html, re.I)
    network = re.findall(r'\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|importScripts)\s*\(', '\n'.join(scripts))
    assert not (external or css or network), 'Distribution depends on external resources'
    assert 'V3.4.4' in html and "version:'3.4.4'" in html
    report = {'passed': True, 'version': '3.4.4', 'moduleCount': len(files),
              'modules': modules, 'outputs': outputs, 'externalResourceAttributes': external,
              'externalCssResources': css, 'networkApiMatches': network,
              'releaseSourceHashes': {x['file']: x['sha256'] for x in modules},
              'verificationScope': 'Exact source embedding, JavaScript parsing, identical standalone outputs and external resource/API audit. Application behavior and actual GLSL rendering are checked separately.'}
    output = ROOT / 'qa' / 'build-report.json'
    output.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'passed': True, 'bytes': len(html.encode()), 'sha256': digest(html.encode()), 'modules': len(files)}))


if __name__ == '__main__':
    main()
