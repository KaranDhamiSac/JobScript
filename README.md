# JobScript

A Chrome/Firefox extension (Manifest V3) that autofills job applications on Greenhouse and Lever from a saved profile. It never submits; you review and submit yourself.

## Testing

The `dev/` folder holds test-only tools. The extension never loads anything from it. If you zip the extension for the Chrome Web Store or Firefox Add-ons, leave `dev/` out.

| File | Purpose |
|---|---|
| `dev/mock-form.html` | A local application form with a fake profile, repeating sections, a degree dropdown, and fields that appear late. |
| `dev/stub.js` | Fake `chrome.storage` holding a fake profile and resume. Edit it to change the test data. |
| `dev/build.sh` | Builds `dev/bundle.js` (stub + extension scripts + CSS) for injecting into real pages. `bundle.js` is gitignored. |
| `dev/proxy.py` | Serves a real job site from `127.0.0.1` with its Content-Security-Policy removed, so the bundle can be loaded. Forwards GET requests only. |
| `dev/guard.js` | Injected by the proxy before the site's own scripts. Blocks every POST/PUT/PATCH/DELETE, beacon and form submit, and logs them to `window.__blockedRequests`. |

### Mock form

From the repo root:

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

Open `http://127.0.0.1:8765/dev/mock-form.html`, then run `await __jobscriptFill()` in the DevTools console.

### Real Greenhouse or Lever pages

These sites block injected scripts, so tests go through the proxy:

```sh
dev/build.sh
python3 dev/proxy.py 8766 job-boards.greenhouse.io Greenhouse
python3 dev/proxy.py 8767 jobs.lever.co Lever
```

Open a posting through the proxy, for example `http://127.0.0.1:8767/<company>/<posting-id>/apply`. Then run this in the console:

```js
await new Promise((r) => { const s = document.createElement('script'); s.src = '/__js/bundle.js'; s.onload = r; document.head.appendChild(s); });
await __jobscriptFill();
```

Filled fields turn green and unfilled required fields turn yellow. `window.__blockedRequests` shows what the guard stopped. Rerun `dev/build.sh` after changing the extension code.

Notes:
- The proxy only passes GET requests, and the guard blocks everything else, so nothing can be submitted. Some site features, like Lever's resume parsing, won't work through it.
- Use the fake profile in `stub.js`, not real personal details.
- This tests the fill logic. It doesn't test the popup, keyboard shortcut or badge; for those, load the unpacked extension.
