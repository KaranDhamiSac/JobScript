# JobScript

A Chrome/Firefox extension (Manifest V3) that autofills job applications on Greenhouse and Lever from a saved profile. It never submits; you review and submit yourself.

## Features

- **Fill:** click **Fill this page** or press **Alt+Shift+F** on a Greenhouse or Lever application, or any other page. JobScript never submits.
- **Side panel:** lists every field by category, marked filled (green), suggested (purple) or needs you (yellow). Click an item to jump to its field.
- **Confidence:** each match gets a score. High-confidence matches fill automatically, medium ones are suggestions you accept, and low ones stay yellow. Thresholds live in `lib/fieldMap.js` (`confidence`).
- **Info bank:** import your profile from your resume PDF (parsed locally, reviewed before saving). When you answer a question JobScript left empty, **Save to bank** keeps the answer for next time, both by question wording (matched loosely on other sites) and for that site's exact field. Dates can be saved as a rule ("2 weeks from today", "Next Monday") instead of a fixed date. **Save answers** in the side panel saves a whole step from a review list. Auto-save is available on the options page, off by default.
- **Custom widgets:** fills Material UI-style dropdowns (`role="combobox"` divs that open a separate option list) and date pickers, both the `mm/dd/yyyy` text box and the newer Month/Day/Year sections.
- **Multi-step forms:** on portals that swap in the next step when you press Continue (Sac State's UEI, for one), the side panel notices the new step and offers **Fill this step**. JobScript never presses Continue, and skips an upload when the page already shows an attached file.
- **Learn mode:** **Learn this site's steps** in the popup records a multi-step form while you fill it once: each step in order and your answers. Afterwards the panel opens on each step ("Step 2 of 9 (Documents)") and **Fill this step** fills it the way you did, using your current profile for fields that came from it. On sites other than Greenhouse and Lever it asks for access to that one site so it can follow steps that load a new page. Learned sites are listed, and can be forgotten, on the options page.
- **Master resume:** your profile holds every job (as bullet lists), project and skill. Import it from your resume PDF with Claude or on your device, and review each parsed entry next to the resume line it came from.
- **Job description & my resume:** on a job page, open the full job description (title, company and link on top) and copy it in one click to tailor your resume however you like. Upload the resume you made for that job, and JobScript attaches it, fills the rest of the form from your profile, and optionally saves the description and resume to `Downloads/JobScript/<Company>/<Job title>/`.
- **Tailor & Fill (optional):** on a job page, Claude picks and rewords your most relevant bullets and projects and orders your skills for that posting. JobScript enforces the rules in code (no new skills, tools or metrics; numbers kept exactly) and shows original vs tailored side by side with the posting's missing keywords. On approval it builds a one-page ATS-friendly PDF locally (`FirstName_LastName_Company.pdf`), attaches it and fills the form.
- **Applications tracker:** every fill is logged once per job (status starts at Filled; mark it Applied when you submit). Open it from the popup for a full page with a GitHub-style yearly heatmap, a month calendar of applied and filled counts (click a day for its company, role, job ID, status and link), a daily goal with today's progress, current and longest streaks, and weekly and monthly totals. Dates use your local time zone. Exportable as CSV.
- **AI answers (optional, off by default):** with your own Anthropic API key, Claude suggests answers to the rest, using only facts from your profile and resume. Short answers are suggestions; essays are drafts you insert.

See [PRIVACY.md](PRIVACY.md) for what JobScript stores and sends. Everything stays local unless you turn on the optional AI answers, which send specific data to Anthropic with your own API key.

## Packaging for the stores

```sh
python3 scripts/package.py
```

This writes `dist/jobscript-chrome-<version>.zip` and `dist/jobscript-firefox-<version>.zip`. They contain only the runtime files (`manifest.json`, `background.js`, `lib/`, `content/`, `popup/`, `options/`). Each manifest is tailored to its browser: Chrome's has no Firefox-only keys, and Firefox's uses an event page. `dev/`, `docs/`, `scripts/` and the Markdown files are never included. `dist/` is gitignored.

## Testing

The `dev/` folder holds test-only tools. The extension never loads anything from it. If you zip the extension for the Chrome Web Store or Firefox Add-ons, leave `dev/` out.

| File | Purpose |
|---|---|
| `dev/mock-form.html` | A local application form with a fake profile, repeating sections, a degree dropdown, and fields that appear late. |
| `dev/stub.js` | Fake `chrome.storage` holding a fake profile and resume. Edit it to change the test data. |
| `dev/build.sh` | Builds `dev/bundle.js` (stub + extension scripts + CSS) for injecting into real pages. `bundle.js` is gitignored. |
| `dev/proxy.py` | Serves a real job site from `127.0.0.1` with its Content-Security-Policy removed, so the bundle can be loaded. Forwards GET requests only. |
| `dev/guard.js` | Injected by the proxy before the site's own scripts. Blocks every POST/PUT/PATCH/DELETE, beacon and form submit, and logs them to `window.__blockedRequests`. |

### Unit tests

```sh
node dev/test-tracker-stats.mjs
TZ=Asia/Kolkata node dev/test-tracker-stats.mjs
node dev/test-date-rules.mjs
node dev/test-site-answers.mjs
```

Checks the tracker's date math (local-time days, streaks, week and month totals, heatmap levels and calendar grids), relative date rules for saved answers, and per-site answer storage (learned steps, concurrent saves, imports).

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
