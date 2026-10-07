# JobScript

A Chrome/Firefox extension (Manifest V3) that autofills job applications from a saved profile on Greenhouse, Lever, Ashby, Workday, iCIMS, SmartRecruiters, SuccessFactors, Taleo, Oracle Recruiting, UKG and Handshake, and on LinkedIn Easy Apply if you choose to. It never submits; you review and submit yourself.

## Features

- **Fill:** click **Fill this page** or press **Alt+Shift+F** on an application page. JobScript never submits.
- **Supported sites:** Greenhouse, Lever, Ashby, Workday, iCIMS (including forms embedded on company sites), SmartRecruiters, SuccessFactors, Taleo, Oracle Recruiting Cloud, UKG Pro and Ready, and Handshake are built in (`lib/fieldMap.js`, `sites`). Each site entry knows where the form is, what to leave alone (sign-in forms, honeypot fields, a site's own resume parser) and how to read the job title. Research behind each one is in [docs/platforms](docs/platforms/README.md). Any other page works too when you click Fill there.
- **LinkedIn Easy Apply (opt-in):** JobScript has no built-in access to LinkedIn and fills there only when you press Fill. LinkedIn's User Agreement doesn't allow tools that automate activity on LinkedIn and LinkedIn can restrict accounts, so the panel says so every time.
- **Side panel:** lists every field by category, marked filled (green), suggested (purple) or needs you (yellow). Click an item to jump to its field. A plain-text line on top sums up the fill ("Filled 12 of 15. Needs you: Why do you want to work here?, Referral"), using field labels only.
- **Works without the popup:** on supported sites, a floating **JobScript** button at the bottom left of application pages (clear of reCAPTCHA badges and other extensions' panels) opens the side panel, which has every popup action: Fill this page, Fill this step, Save all answers, Job description, Tailor & Fill, Write cover letter, Company profile and Open tracker. All buttons have text labels and aria-labels, so a browser agent like Claude in Chrome (which can click the page but not the popup or Alt+Shift+F) or a screen reader can find them. The button and panel live in a closed shadow root and put themselves back if the page rebuilds itself (Greenhouse's React app does). On the options page you can hide the button, or have the panel open by itself on application pages (off by default). Learn mode still starts from the popup, since it may ask for site access.
- **Load check:** each supported page logs one console line, `[JobScript] loaded on Greenhouse` (the platform, or the site's host), with nothing from your profile.
- **Other autofill extensions:** if another one's panel is on the page (Jobright, Simplify, Teal and others), the side panel warns that it may change fields JobScript fills.
- **Confidence:** each match gets a score. High-confidence matches fill automatically, medium ones are suggestions you accept, and low ones stay yellow. Thresholds live in `lib/fieldMap.js` (`confidence`).
- **Info bank:** import your profile from your resume PDF (parsed locally, reviewed before saving). When you answer a question JobScript left empty, **Save to bank** keeps the answer for next time, both by question wording (matched loosely on other sites) and for that site's exact field. Dates can be saved as a rule ("2 weeks from today", "Next Monday") instead of a fixed date. **Save answers** in the side panel saves a whole step from a review list. Auto-save is available on the options page, off by default.
- **Custom widgets:** fills Material UI-style dropdowns (`role="combobox"` divs that open a separate option list), date pickers (the `mm/dd/yyyy` text box, Month/Day/Year sections and Workday's split date inputs), Workday's search prompts, Yes/No toggle buttons (Ashby), selects hidden behind a styled stand-in (iCIMS, Select2), and fields inside web components' shadow roots (SmartRecruiters).
- **A resume for each job:** your master resume fills in your details, but JobScript doesn't send it. When an application asks for a resume, the panel offers **Make one for this job** (opens the job description so you can make and upload a resume for this posting, which is then attached), **Tailor with Claude** when AI is on, or **Use master resume**. A resume you attach this way goes in before anything else, since Lever, Ashby, Workday and iCIMS read an uploaded resume and refill the form from it.
- **Multi-step forms:** on portals that swap in the next step when you press Continue (Sac State's UEI, for one), the side panel notices the new step and offers **Fill this step**. JobScript never presses Continue, and skips an upload when the page already shows an attached file.
- **Learn mode:** **Learn this site's steps** in the popup records a multi-step form while you fill it once: each step in order and your answers. Afterwards the panel opens on each step ("Step 2 of 9 (Documents)") and **Fill this step** fills it the way you did, using your current profile for fields that came from it. On sites it doesn't have built-in access to, it asks for access to that one site so it can follow steps that load a new page. Learned sites are listed, and can be forgotten, on the options page.
- **Master resume:** your profile holds every job (as bullet lists), project and skill. Import it from your resume PDF with Claude or on your device, and review each parsed entry next to the resume line it came from.
- **Job description & my resume:** on a job page, open the full job description (title, company and link on top) and copy it in one click to tailor your resume however you like. Upload the resume you made for that job, and JobScript attaches it, fills the rest of the form from your profile, and optionally saves the description and resume to `Downloads/JobScript/<Company>/<Job title>/`.
- **Tailor & Fill (optional):** on a job page, Claude picks and rewords your most relevant bullets and projects and orders your skills for that posting, led by the job breakdown's required skills and keywords. It also writes a short summary, which the company profile may shape in a few words (never the bullets). JobScript enforces the rules in code (no new skills, tools or metrics; numbers kept exactly) and shows original vs tailored side by side with the posting's missing keywords. On approval it builds a one-page ATS-friendly PDF locally (`FirstName_LastName_Company.pdf`), attaches it and fills the form.
- **Job descriptions:** every fill saves the full posting with its tracker entry, so you keep it if the posting comes down (download it from the tracker). When you tailor or write a cover letter, Claude Haiku breaks it down into a role summary, responsibilities, required and preferred skills, keywords and seniority, cached per job.
- **Company profiles (optional):** from the side panel or tracker, research a company's mission, values, products, recent news and culture, either from **its own website** (JobScript asks to read that one site, reads its About, Mission, Values, Careers and Culture pages, then gives the access back) or by **web search** (Claude's web search tool; the estimated cost is shown before it runs). Every item links to its source; items that don't trace back to one are dropped. Profiles are cached per company with a "last updated" date, a refresh button, and full editing.
- **Cover letters (optional):** **Write cover letter** in the side panel or on the Tailor & Fill page writes a letter from the job breakdown, the company profile and your master resume, in the tone (professional, warm, concise) and length (short, about 250 words, full page) you choose. An opening ties the role to the company's mission or a value, then one or two paragraphs link your real experience to the top requirements, then a closing. JobScript checks it in code like the resume: numbers and experience must come from your master resume and company facts from the company profile, and anything that doesn't trace back is flagged as you edit. Save it as a PDF with your resume's header; it's attached to cover letter uploads (or pasted into cover letter boxes) when you fill, and kept with the tracker entry. Your name and contact details are added locally, never sent.
- **Model use:** Claude Haiku reads and summarizes (job breakdowns, company research); Claude Sonnet writes (tailoring, cover letters), or Opus if you picked it. Everything from a web page is passed to Claude in labeled tags with instructions to treat it as data, never as instructions.
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
| `dev/mock-workday-form.html` | Workday's logged-in widgets, rebuilt from `docs/platforms/workday.md`: listbox buttons with portal options, search prompts, Month/Year date inputs, Add buttons with non-sequential entry ids, and the sign-in honeypot. |
| `dev/mock-icims-form.html` | iCIMS's candidate profile page, rebuilt from `docs/platforms/icims.md`: selects hidden behind iCIMS's stand-in dropdowns (Country fills in State), hidden education groups behind "Add More", a split graduation date, and an account sign-in name that must stay empty. |
| `dev/mock-shadow-form.html` | A form built from web components with open shadow roots, like SmartRecruiters': labels inside the components, a nested city autocomplete, and an Add button that opens experience entries. Uses the profile in `dev/stub.js`; `window.__committed` shows what the page registered. |
| `dev/stub.js` | Fake `chrome.storage` holding a fake profile and resume. Edit it to change the test data. |
| `dev/build.sh` | Builds `dev/bundle.js` (stub + extension scripts + CSS) for injecting into real pages. `bundle.js` is gitignored. |
| `dev/proxy.py` | Serves a real job site from `127.0.0.1` with its Content-Security-Policy removed, so the bundle can be loaded. Forwards GET requests only, plus any read-only POSTs named by an optional regex (Ashby loads its form through GraphQL). |
| `dev/guard.js` | Injected by the proxy before the site's own scripts. Blocks every POST/PUT/PATCH/DELETE, beacon and form submit, and logs them to `window.__blockedRequests`. |

### Unit tests

```sh
node dev/test-tracker-stats.mjs
TZ=Asia/Kolkata node dev/test-tracker-stats.mjs
node dev/test-date-rules.mjs
node dev/test-site-answers.mjs
node dev/test-job-ids.mjs
node dev/test-research-storage.mjs
node dev/test-research-pages.mjs
node dev/test-ai-research.mjs
node dev/test-tailoring.mjs
node dev/test-letter-check.mjs
```

Checks the tracker's date math (local-time days, streaks, week and month totals, heatmap levels and calendar grids), relative date rules for saved answers, per-site answer storage (learned steps, concurrent saves, imports), and job IDs taken from each platform's URLs. The research tests cover saved postings, company profiles and letters; reading company sites (with a fake fetch); the Claude requests for job parsing, research, tailoring and cover letters (with a fake API, no key or network); source checks; and the cover letter rule checker.

### Mock form

From the repo root:

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

Open `http://127.0.0.1:8765/dev/mock-form.html`, then run `await __jobscriptFill()` in the DevTools console.

### Real job sites

These sites block injected scripts, so tests go through the proxy:

```sh
dev/build.sh
python3 dev/proxy.py 8766 job-boards.greenhouse.io Greenhouse
python3 dev/proxy.py 8767 jobs.lever.co Lever
python3 dev/proxy.py 8768 jobs.ashbyhq.com Ashby 'op=Api(JobPosting|OrganizationFromHostedJobsPageName|AutocompleteGeoLocation)$'
python3 dev/proxy.py 8769 secure6.saashr.com 'UKG Ready'
```

SmartRecruiters (behind DataDome) and the signed-in steps of Workday, iCIMS, Taleo, SuccessFactors, Handshake and LinkedIn can't be served this way. The `dev/mock-*.html` forms rebuild their widgets from the research in `docs/platforms/`.

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
