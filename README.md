# JobScript

A Chrome/Firefox extension (Manifest V3) that works in a side panel on whatever job page you're viewing, like Jobright's extension: a match score against your master resume, eligibility warnings, a tailored resume, a cover letter and referral searches for the job, then autofill on the employer's application (Greenhouse, Lever, Ashby, Workday, iCIMS, SmartRecruiters, SuccessFactors, Taleo, Oracle Recruiting, UKG and Handshake). It reads LinkedIn, Indeed and Glassdoor job pages but never clicks or fills there. It never submits; you review and submit yourself. There's no job database or background job search: everything starts from the page you're on.

## The Job tab

- **Job detection:** on LinkedIn, Indeed, Glassdoor, Handshake, Greenhouse, Lever, Workday, Ashby, iCIMS and SmartRecruiters job pages (each site's own layout), then any page with schema.org `JobPosting` JSON-LD, then page heuristics (a heading, a description with job sections, an apply link). It reads the title, company, location, pay if shown, job ID, URL, full description and the apply link (`lib/jobDetect.js`). On one-page sites (LinkedIn's and Indeed's search results with a job open beside them) it follows the job you click. Company careers pages on other sites work when you turn on **Find job postings on every site** on the options page (it asks for access to all sites).
- **LinkedIn, Indeed and Glassdoor are read-only:** JobScript reads their job pages and never clicks, scrolls, navigates, fills or runs the agent there. **Apply** opens the employer's application link when the page has one (unwrapping the board's redirect); otherwise press the board's own Apply button.
- **The floating JobScript button** (bottom left) appears when a job is found and opens the side panel on the **Job** tab:
  - **Match score** 0 to 100 against your master resume, with a one-line reason. Claude Haiku 4.5 rates each requirement from the job breakdown met, partial or missing; code weighs them (required counts twice). The score is cached per job and per version of your resume, so revisiting is free; after you edit your resume it shows as changed, with **Rescore**.
  - **Matching skills** and **missing keywords** from the breakdown, checked locally against your resume.
  - **Eligibility warnings**, checked on your device (`lib/eligibility.js`): required years of experience (overlapping jobs counted once), degree (an in-progress one noted), security clearance, U.S. citizenship or no sponsorship, and onsite or hybrid location against yours.
  - **Duplicate warning** when the job is already in your tracker: the same job, then the same job ID at the same company, then the same company and title.
  - **Apply** (fills the form if it's on this page, or opens the application in a new tab), **Save to tracker** (status Saved), **Tailor resume**, **Write cover letter** and **Find referrals**.
  - **Find referrals:** two LinkedIn people searches you open yourself (your school's alumni at the company, and people in the role at the company) and a short outreach note to copy. JobScript never opens, reads or automates LinkedIn for this.

## Features

- **Fill:** click **Fill this page** or press **Alt+Shift+F** on an application page. JobScript never submits.
- **Supported sites:** Greenhouse, Lever, Ashby, Workday, iCIMS (including forms embedded on company sites), SmartRecruiters, SuccessFactors, Taleo, Oracle Recruiting Cloud, UKG Pro and Ready, and Handshake are built in (`lib/fieldMap.js`, `sites`). Each site entry knows where the form is, what to leave alone (sign-in forms, honeypot fields, a site's own resume parser) and how to read the job title. Research behind each one is in [docs/platforms](docs/platforms/README.md). Any other page works too when you click Fill there.
- **Side panel:** lists every field by category, marked filled (green), suggested (purple) or needs you (yellow). Click an item to jump to its field. A plain-text line on top sums up the fill ("Filled 12 of 15. Needs you: Why do you want to work here?, Referral"), using field labels only.
- **Works without the popup:** on supported sites, a floating **JobScript** button at the bottom left of application pages (clear of reCAPTCHA badges and other extensions' panels) opens the side panel, which has every popup action: Fill this page, Fill this step, Save all answers, Job description, Tailor & Fill, Write cover letter, Company profile and Open tracker. All buttons have text labels and aria-labels, so a browser agent like Claude in Chrome (which can click the page but not the popup or Alt+Shift+F) or a screen reader can find them. The button and panel live in a closed shadow root and put themselves back if the page rebuilds itself (Greenhouse's React app does). On the options page you can hide the button, or have the panel open by itself on application pages (off by default). Learn mode still starts from the popup, since it may ask for site access.
- **Load check:** each supported page logs one console line, `[JobScript] loaded on Greenhouse` (the platform, or the site's host), with nothing from your profile.
- **Other autofill extensions:** if another one's panel is on the page (Jobright, Simplify, Teal and others), the side panel warns that it may change fields JobScript fills.
- **Confidence:** each match gets a score. High-confidence matches fill automatically, medium ones are suggestions you accept, and low ones stay yellow. Thresholds live in `lib/fieldMap.js` (`confidence`).
- **Info bank:** import your profile from your resume PDF (parsed locally, reviewed before saving). When you answer a question JobScript left empty, **Save to bank** keeps the answer for next time, both by question wording (matched loosely on other sites) and for that site's exact field. Dates can be saved as a rule ("2 weeks from today", "Next Monday") instead of a fixed date. **Save answers** in the side panel saves a whole step from a review list. Auto-save is available on the options page, off by default.
- **Answer once, reuse everywhere:** every question is classified as **generic** (contact, education, work authorization, EEO, how you heard, years of experience, languages, certifications), **changing** (start date, salary, notice period) or **job-specific** ("Why do you want to work here?", essays). Different wordings map to one canonical question (`lib/canonical.js`): "Expected graduation date", "When do you graduate?" and "Graduation year" are all your graduation date, stored once and formatted per field (MM/YYYY, "May 2027", a year or month dropdown). Generic answers fill automatically; changing ones are suggested from a saved rule (like "+14 days" or a salary range); job-specific ones are never reused (the AI draft still applies if it's on). When you answer a generic question yourself it's saved with a "Saved. Undo" note, and if you change an auto-filled one your saved answer follows ("Updated. Undo"); a changing one asks for a rule; a job-specific one is never saved. Keyword rules come first; with AI answers on, Claude Haiku classifies wordings the rules don't know, once each. If two saved answers disagree, the newest is used and the side panel flags it so you can pick one. Review everything under **Saved answers** on the options page.
- **Custom widgets:** fills Material UI-style dropdowns (`role="combobox"` divs that open a separate option list), date pickers (the `mm/dd/yyyy` text box, Month/Day/Year sections and Workday's split date inputs), Workday's search prompts, Yes/No toggle buttons (Ashby), selects hidden behind a styled stand-in (iCIMS, Select2), and fields inside web components' shadow roots (SmartRecruiters).
- **A resume for each job:** when an application asks for a resume, JobScript attaches the one you made for that job (Tailor resume, or the job description page), even if you made it on the job's LinkedIn or Indeed page; its cover letter goes into the cover letter field the same way. Without one it attaches your master resume and says so in the panel, or, with **Ask me first** under "Resume uploads" on the options page, offers **Make one for this job**, **Tailor with Claude** or **Use master resume**. The resume goes in before anything else, since Lever, Ashby, Workday and iCIMS read an uploaded resume and refill the form from it.
- **Needs your info:** each field JobScript couldn't fill has **Answer here** in the panel: an input of the field's kind (text, long text, date, or the field's own options) and where to save the answer (all sites, this site, or nowhere). Answers about this particular job are never saved.
- **Check before submit:** reads the form and lists required fields still empty, whether the resume and cover letter for this job are attached, placeholder text left in (like `[Company]` or `{{name}}`), and answers that differ from your profile. JobScript never presses Submit.
- **Multi-step forms:** on portals that swap in the next step when you press Continue (Sac State's UEI, for one), the side panel notices the new step and offers **Fill this step**. JobScript never presses Continue, and skips an upload when the page already shows an attached file.
- **Learn mode:** **Learn this site's steps** in the popup records a multi-step form while you fill it once: each step in order and your answers. Afterwards the panel opens on each step ("Step 2 of 9 (Documents)") and **Fill this step** fills it the way you did, using your current profile for fields that came from it. On sites it doesn't have built-in access to, it asks for access to that one site so it can follow steps that load a new page. Learned sites are listed, and can be forgotten, on the options page.
- **Master resume:** your profile holds every job (as bullet lists), project and skill. Import it from your resume PDF with Claude or on your device, and review each parsed entry next to the resume line it came from.
- **Job description & my resume:** on a job page, open the full job description (title, company and link on top) and copy it in one click to tailor your resume however you like. Upload the resume you made for that job, and JobScript attaches it, fills the rest of the form from your profile, and optionally saves the description and resume to `Downloads/JobScript/<Company>/<Job title>/`.
- **Tailor & Fill (optional):** on a job page, Claude picks and rewords your most relevant bullets and projects and orders your skills for that posting, led by the job breakdown's required skills and keywords. It also writes a short summary, which the company profile may shape in a few words (never the bullets). JobScript enforces the rules in code: every number matches the source bullet exactly, no skill or tool outside your master resume, bullets you **lock** always stay as written, and employers, titles, dates and education never change by themselves (a title in the posting's wording for the same role is shown beside yours to pick). The review screen shows original vs tailored side by side, the posting's missing keywords, and the **match score before and after** tailoring. On approval it builds a one-page ATS-friendly PDF locally (`FirstName_LastName_Company.pdf`), attaches it and fills the form; from LinkedIn, Indeed or Glassdoor it saves the PDF with the job's tracker entry for when you apply on the employer's site.
- **Job descriptions:** every fill saves the full posting with its tracker entry, so you keep it if the posting comes down (download it from the tracker). When you tailor or write a cover letter, Claude Haiku breaks it down into a role summary, responsibilities, required and preferred skills, keywords and seniority, cached per job.
- **Company profiles (optional):** from the side panel or tracker, research a company's mission, values, products, recent news and culture, either from **its own website** (JobScript asks to read that one site, reads its About, Mission, Values, Careers and Culture pages, then gives the access back) or by **web search** (Claude's web search tool; the estimated cost is shown before it runs). Every item links to its source; items that don't trace back to one are dropped. Profiles are cached per company with a "last updated" date, a refresh button, and full editing.
- **Cover letters (optional):** **Write cover letter** in the side panel or on the Tailor & Fill page writes a letter from the job breakdown, the company profile and your master resume, in the tone (professional, warm, concise) and length (short, about 250 words, full page) you choose. An opening ties the role to the company's mission or a value, then one or two paragraphs link your real experience to the top requirements, then a closing. JobScript checks it in code like the resume: numbers and experience must come from your master resume and company facts from the company profile, and anything that doesn't trace back is flagged as you edit. Save it as a PDF with your resume's header, or **Copy text** to paste it into a text box; it's attached to cover letter uploads (or pasted into cover letter boxes) when you fill, and kept with the tracker entry. Your name and contact details are added locally, never sent.
- **Model use:** Claude Haiku 4.5 reads, summarizes and scores (job breakdowns, match scores, company research); Claude Sonnet 5.5 writes (tailoring, cover letters), or Opus if you picked it. System prompts and your master resume are sent as cached blocks (prompt caching), so tailoring, letters and scores share one cached copy of your resume per model. Haiku 4.5 only caches prompts of 4,096 tokens or more, so most score requests aren't cached; Sonnet 5.5 caches from 512. Every call counts toward this month's spend and the monthly cap on the options page. Everything from a web page is passed to Claude in labeled tags with instructions to treat it as data, never as instructions. Your name, email, phone, address, city and links are never sent to Claude (the agent sees placeholders like `{{email}}` that the page fills in).
- **Applications tracker:** save a job from its page before applying (status Saved); every fill is logged once per job (Filled), and when the site shows its confirmation page ("Thank you for applying", Greenhouse's /confirmation, Lever's /thanks) in the tab JobScript filled, the entry is marked Applied. Statuses: Saved, Filled, Applied, Interviewing, Rejected, Offer. Each entry keeps the job description, the tailored resume, the cover letter and the match score. Open it from the popup for a full page with a GitHub-style yearly heatmap, a month calendar of applied and filled counts (click a day for its company, role, job ID, status and link), a daily goal with today's progress, current and longest streaks, and weekly and monthly totals. Dates use your local time zone. Exportable as CSV.
- **Agent mode (optional, off by default):** for fields a fill left over, the **Agent** button lets Claude finish the step with a text snapshot of the form and seven tools: fill_field, select_option, check, click, upload_document, ask_user and done. `click` refuses Submit, Apply, Send, Finish and similar buttons, and Continue / Next wait for your approval. A run takes at most 20 actions, every action shows in a live log, and **Stop** ends it at once.
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
| `dev/mock-wordings-a.html`, `dev/mock-wordings-b.html` | The same questions (graduation date, how you heard, work authorization, languages, salary, start date) worded and formatted differently, plus a job-specific question each. No JobScript scripts inside: fill them with the extension to test canonical answers. |
| `dev/mock-workday-form.html` | Workday's logged-in widgets, rebuilt from `docs/platforms/workday.md`: listbox buttons with portal options, search prompts, Month/Year date inputs, Add buttons with non-sequential entry ids, and the sign-in honeypot. |
| `dev/mock-icims-form.html` | iCIMS's candidate profile page, rebuilt from `docs/platforms/icims.md`: selects hidden behind iCIMS's stand-in dropdowns (Country fills in State), hidden education groups behind "Add More", a split graduation date, and an account sign-in name that must stay empty. |
| `dev/mock-shadow-form.html` | A form built from web components with open shadow roots, like SmartRecruiters': labels inside the components, a nested city autocomplete, and an Add button that opens experience entries. Uses the profile in `dev/stub.js`; `window.__committed` shows what the page registered. |
| `dev/stub.js` | Fake `chrome.storage` holding a fake profile and resume. Edit it to change the test data. |
| `dev/build.sh` | Builds `dev/bundle.js` (stub + extension scripts + CSS) for injecting into real pages. `bundle.js` is gitignored. |
| `dev/proxy.py` | Serves a real job site from `127.0.0.1` with its Content-Security-Policy removed, so the bundle can be loaded. Forwards GET requests only, plus any read-only POSTs named by an optional regex (Ashby loads its form through GraphQL). |
| `dev/guard.js` | Injected by the proxy before the site's own scripts. Blocks every POST/PUT/PATCH/DELETE, beacon and form submit, and logs them to `window.__blockedRequests`. |
| `dev/fixtures/` | Static, fake job pages for each detected site: LinkedIn (signed-in, guest and search-results layouts), Indeed (job page and search with a job open), Glassdoor, Handshake, Greenhouse, Lever, Ashby, Workday, iCIMS, SmartRecruiters, a careers page with JSON-LD, one found by heuristics, and two pages that must not be detected. Each file's comment gives the real URL it stands for. |
| `dev/test-detect.html` | Runs `lib/jobDetect.js` on every fixture (in an iframe, so text lays out as on the site) with its real URL and checks every field. |
| `dev/mock-job-page.html`, `dev/job-harness.js` | A careers page with the real detector, panel and Job tab; the harness answers the Job tab's background messages with scripted results. |
| `dev/tailor-harness.html` | Opens the real tailoring review screen with a fake chrome API and scripted Claude answers (score before and after, locks, title suggestions). |
| `dev/mock-confirmation.html` | A confirmation page after submitting, for checking it's recognized. |

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
node dev/test-canonical.mjs
node dev/test-canon-storage.mjs
node dev/test-eligibility.mjs
node dev/test-job-background.mjs
node dev/test-pay.mjs
```

`test-job-background.mjs` loads `background.js` with a fake chrome API and a fake Claude API and drives the Job tab's messages: saving a detected job, parsing and scoring with Haiku (and the cache that makes revisits free), duplicates, Apply never opening a LinkedIn, Indeed or Glassdoor address, fill and agent refusing those boards, confirmation pages marking Applied, and the every-site setting.

Job detection runs in the browser: serve the repo root (below) and open `http://127.0.0.1:8765/dev/test-detect.html`; `window.__results` has the outcome.

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

Filled fields turn green and unfilled required fields turn yellow. `window.__blockedRequests` shows what the guard stopped. Rerun `dev/build.sh` after changing the extension code. On a posting page the bundle also runs job detection with the site's layout and shows the Job tab (`JobScriptJobTab.current()`), with `dev/job-harness.js` standing in for background.js; `JobScriptFill.preSubmitCheck()` runs the pre-submit checklist.

Notes:
- The proxy only passes GET requests, and the guard blocks everything else, so nothing can be submitted. Some site features, like Lever's resume parsing, won't work through it.
- Use the fake profile in `stub.js`, not real personal details.
- This tests the fill logic. It doesn't test the popup, keyboard shortcut or badge; for those, load the unpacked extension.
