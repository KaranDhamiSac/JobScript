#!/usr/bin/env python3
"""Build store-ready zips containing only the extension's runtime files.

Usage: python3 scripts/package.py
Output: dist/jobscript-chrome-<version>.zip and dist/jobscript-firefox-<version>.zip

Only the paths in INCLUDE are packaged, so dev/, scripts/, docs and anything else
in the repo can never end up in a store upload. Vendored READMEs are skipped; licenses ship.
"""
import json
import pathlib
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
DIST = ROOT / 'dist'

# Runtime files only. Add new extension folders here (e.g. "icons") when they exist.
INCLUDE = ['background.js', 'lib', 'content', 'popup', 'options', 'tailor', 'job']


def browser_manifest(manifest, browser):
    m = json.loads(json.dumps(manifest))
    if browser == 'chrome':
        m['background'].pop('scripts', None)  # Chrome uses the service worker
        m.pop('browser_specific_settings', None)  # Firefox-only
    else:
        m['background'].pop('service_worker', None)  # Firefox uses an event page
    return m


def collect_files():
    files = []
    for entry in INCLUDE:
        path = ROOT / entry
        if path.is_file():
            files.append(path)
        elif path.is_dir():
            files.extend(
                p for p in sorted(path.rglob('*'))
                if p.is_file() and not p.name.startswith('.') and p.name != 'README.md'
            )
        else:
            raise SystemExit(f'Missing extension path: {entry}')
    return files


def main():
    manifest = json.loads((ROOT / 'manifest.json').read_text())
    version = manifest['version']
    files = collect_files()
    DIST.mkdir(exist_ok=True)
    for browser in ('chrome', 'firefox'):
        out = DIST / f'jobscript-{browser}-{version}.zip'
        with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
            z.writestr('manifest.json', json.dumps(browser_manifest(manifest, browser), indent=2) + '\n')
            for f in files:
                z.write(f, f.relative_to(ROOT).as_posix())
        print(f'{out.relative_to(ROOT)}  ({len(files) + 1} files)')


if __name__ == '__main__':
    main()
