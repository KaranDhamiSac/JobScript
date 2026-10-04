# LinkedIn Easy Apply

> Summary: Easy Apply is a multi-step form inside linkedin.com, behind a login. It has no public form schema, so every selector here comes from open-source bots and extensions, plus one captured modal fixture from September 2026. As of Sept-Oct 2026 at least three DOM variants are live at once: (1) the classic Ember `artdeco-modal.jobs-easy-apply-modal` in the light DOM, (2) a modal mounted inside an open shadow root at `div#interop-outlet` on the new `/jobs/search-results/` layout, and (3) an SDUI page at `/jobs/view/<id>/apply/?openSDUIApplyFlow=true` that uses hashed classes. Field markup has lasted longer than the containers: `[data-test-form-element]`, `fb-dash-form-element*` and the `...-formElement-urn-li-jobs-applyformcommon-easyApplyFormElement-<jobId>-<n>-<kind>` ids. An adapter must find the active root (document, shadow root or SDUI page), fill one step at a time and re-scan after each Next. It must never click Review or Submit. LinkedIn's User Agreement and help pages ban extensions that automate activity, so even user-triggered autofill carries account risk.
> Difficulty: **high**, because the DOM churns often, three layouts run in parallel, typeaheads need extra steps, the platform is hostile to automation and nothing can be tested without an account.
> Last researched: 2026-10-04

## 1. Detection

| Signal | Value | Marker |
|---|---|---|
| Host | `www.linkedin.com` (also seen: country subdomains like `uk.linkedin.com` on guest pages) | [verified-live] [1] |
| Job view URL | `^https://www\.linkedin\.com/jobs/view/(?:[^/?#]*-)?(\d+)/?` (canonical is `/jobs/view/<slug>-<id>`, and `/jobs/view/<id>/` also works) | [verified-live] [1] |
| Search / list URLs (job pane on right) | `/jobs/search/?currentJobId=<id>` (classic), `/jobs/search-results/?currentJobId=<id>` (2026 SDUI "AI search"), `/jobs/collections/<name>/?currentJobId=<id>` (login required, 302 to `/uas/login`) | [verified-live] [1], [code] [10][12] |
| SDUI Easy Apply route | `^/jobs/view/(\d+)/apply/?\?.*openSDUIApplyFlow=true` (returns 404 when logged out) | [verified-live] [1], [code] [3][10][11][14] |
| External redirect wrapper | `linkedin.com/redir/redirect/?url=<encoded ATS url>` sometimes used for off-site apply | [unverified] [15] |
| Easy Apply button (classic) | `button#jobs-apply-button-id.jobs-apply-button[data-job-id][data-live-test-job-apply-button]`, `aria-label="Easy Apply to <title> at <company>"`, inner text "Easy Apply", LinkedIn-bug icon `svg[data-test-icon="linkedin-bug-xxsmall"]`. Container `.jobs-apply-button--top-card` | [code] [3] (fixture `04_apply_button.html`, Sept 2026) |
| Easy Apply control (SDUI) | `<a href=".../jobs/view/<id>/apply/?openSDUIApplyFlow=true">` (measured 2026-09-14), or `button/a[aria-label="Easy Apply to this job"]` (2026-09-26). Do not match the filter chip `div[role=radio][aria-label="Filter by Easy Apply"]` | [code] [10][11][14] |
| External "Apply" | Same `.jobs-apply-button` without "Easy" in label/text, with an off-site icon. Clicking it opens a new tab, or a "Share your profile?" dialog first whose Continue does the redirect. One bot notes LinkedIn **counts that click as an apply** | [code] [3][10], [unverified] [15] |
| Easy Apply vs external on guest page | Guest top-card button `data-tracking-control-name="public_jobs_apply-link-onsite"` = Easy Apply. `public_jobs_apply-link-offsite` plus icon `apply-button__offsite-apply-icon-svg` = external ATS | [verified-live] [1][2] |
| Modal root (classic) | `div[role="dialog"][data-test-modal].artdeco-modal.jobs-easy-apply-modal[aria-labelledby="jobs-apply-header"]`, header `h2#jobs-apply-header` "Apply to <Company>" | [code] [3] fixture |
| Modal root (interop shadow) | `document.getElementById('interop-outlet')` (also `[data-testid="interop-shadowdom"]`), `.shadowRoot` (open), then `[role="dialog"]` | [code] [11][12][13][15] |
| Other 2026 modal anchors | `[data-test-modal-id="easy-apply-modal"]`, `[data-test-jobs-easy-apply-modal]`, `dialog[open]`, `[data-live-test-easy-apply-next-button]`, `[data-live-test-easy-apply-submit-button]` | [code] [11][14] |
| SDUI page markers | `data-sdui-screen="com.linkedin.sdui.flagshipnav.jobs.JobDetails"` (standalone) / `...SemanticJobDetails` (search-results), `componentkey="JobDetails_AboutTheJob_<id>"`, `div[data-testid="lazy-column"]`, job cards `div[componentkey^="job-card-component-ref-<id>"][role=button]` | [code] [12][11] |
| Guest page meta | `<meta name="pageKey" content="d_jobs_guest_details">`, `og:title` "<Company> hiring <Title> in <Location> \| LinkedIn", canonical link with slug-id. **No JSON-LD JobPosting** in guest HTML today | [verified-live] [1] |

Suggested detection order: if the URL matches `/jobs/view/\d+/apply/`, treat it as the SDUI form. Otherwise, if `#interop-outlet` has a shadowRoot containing `[role=dialog]` that passes the Easy Apply fingerprint (below), use that. Otherwise use the light-DOM `.jobs-easy-apply-modal` / `[data-test-modal]`.
Easy Apply dialog fingerprint (from [11]): the class contains `easy-apply|jobs-apply`, OR it contains `[data-test-modal-id*=easy-apply]` / `button[data-live-test-easy-apply-submit-button]`, OR an h1-h3 reads "Apply to …", OR it holds a button with aria-label "Submit application" / "Review your application" / "Continue to next step". This rules out other LinkedIn dialogs that share the shadow host (share box, invite, daily-limit popup).

## 2. Application flow

- **Login required.** No guest Easy Apply. A logged-out click on Apply shows the contextual sign-in modal (`data-modal="job-details-topcard-apply-modal"`) [verified-live] [2].
- **Multi-step modal or page.** Typical steps are Contact info, then Resume, then Additional questions (one or more pages), then Work authorization/EEO/voluntary, then Review. Simple jobs submit on step 1: the Sept 2026 fixture shows Contact info, resume cards and Submit all on one step [code] [3].
- **Step change = in-place DOM swap.** The modal or page stays and the content inside `form` re-renders, with no URL change in the classic or shadow variants. Re-query the root after every Next. Bots wait 1-3 s after Next, because LinkedIn shows an empty shell with only a Next button while `artdeco-loader` runs [code] [14]. The SDUI variant navigates to `/apply/` first.
- **Footer buttons** (all `type="button"`; scope searches to the dialog, because "Next" also matches the search pagination's "View next page") [code] [3]:
  - Next: `button[aria-label="Continue to next step"]` / `[data-live-test-easy-apply-next-button]` / `[data-easy-apply-next-button]`
  - Review: `button[aria-label="Review your application"]` (text "Review")
  - Submit: `button[aria-label="Submit application"]` / `[data-live-test-easy-apply-submit-button]` (**JobScript must never click this**)
  - Close: `button[data-test-modal-close-btn][aria-label="Dismiss"].artdeco-modal__dismiss`. It brings up "Save this application?" with `button[data-control-name="discard_application_confirm_btn"]` (Discard) / Save.
  - Older bots used `.artdeco-button--primary` as "the next or submit button" (AIHawk 2024, [code] [7]). That still works but is risky, because the primary button can be Submit.
- **Progress indicator.** Classic: `div[role="region"][aria-label="Your job application progress is at N percent."]` (hashed class) [code] [3] fixture. Newer: `progress[aria-valuenow]` [code] [14]. **Stale:** wodsuz reads the percent with an absolute XPath `html/body/div[3]/.../span` and derives the page count as `floor(100/pct)-2` [code] [6].
- **Pre-modal interstitials (2026):** a "Missing required qualifications" panel on the first click, daily-limit popups ("You've reached today's Easy Apply limit"), and "You're applying quickly / Please wait" speed-limit notices. They render inside the interop shadow root, so `document.body.innerText` misses them [code] [11], [docs] [18].
- **Prefill.** LinkedIn prefills email (select of your account emails), phone, city and the last-used resume, and **saved answers** from earlier applications ("We automatically save your answers and resume…", link `/jobs/application-settings`) [code] [3], [docs] [18]. The adapter should not overwrite non-empty values unless the user asks.
- **Follow company checkbox** in the footer: `input#follow-company-checkbox` (visually-hidden, `ember-checkbox`) + `label[for=follow-company-checkbox]` "Follow <Company> to stay up to date…". It is checked by default on the review/submit step [code] [3][4][6][8].
- **Review page:** read-only summary with per-section Edit buttons, then Submit. JobScript should stop at or before Review.
- **Post-submit:** "Application sent" dialog with "Done" or Dismiss (only relevant for tracking).
- **External "Apply"** leaves LinkedIn for an ATS (Greenhouse/Lever/Workday…). JobScript's other adapters take over in the new tab. LinkedIn does not fill those forms.

## 3. Field structure

The classic modal markup below comes from the Sept 2026 fixture [code] [3]. The SDUI variant uses hashed classes, but bots report that `[data-test-form-element]` and label-for still work [code] [14].

- **Question container:** `div.fb-dash-form-element[data-test-form-element]` (paired with a random class like `oHabVZ…`). GodsScion: "`data-test-form-element` is the attribute that has survived every restyle" [code] [3].
- **Older containers (stale or legacy):** `.jobs-easy-apply-form-section__grouping` > `.jobs-easy-apply-form-element` > `.fb-form-element-label` / `.fb-single-line-text__input` / `.fb-dropdown__select` / `.fb-textarea` / `.fb-radio` (2021-22, NathanDuma [code] [5]). `.fb-text-selectable__option` and `.jobs-easy-apply-content .pb4` (2024, AIHawk [code] [7]). madingess (2025) still uses `jobs-easy-apply-form-section__grouping` for address only [code] [4].
- **Label attachment:** `label[for=<input id>]` wrapping `<span>Label</span>`. Required is marked by class `fb-dash-form-element__label-title--is-required` + `span.visually-hidden[data-test-*-required]` "Required", plus `required` / `aria-required="true"` on the control. The error slot `#<id>-error` / `[data-test-form-element-error-messages]` contains `.artdeco-inline-feedback--error .artdeco-inline-feedback__message`.
- **Radio groups:** `fieldset[data-test-form-builder-radio-button-form-component="true"]`, title `span[data-test-form-builder-radio-button-form-component__title]` (the visible text is often in a child `.visually-hidden`), options `input[type=radio]` + `label[for]` [code] [3]. Required hint `[data-test-radio-button-form-required="true"]` [code] [9].
- **Checkbox groups:** `fieldset` with `[data-test-checkbox-form-required="true"]` [code] [9].
- **Id pattern:** `<component>-formElement-urn-li-jobs-applyformcommon-easyApplyFormElement-<jobId>-<n>-<kind>`. Examples: `text-entity-list-form-component-…-5-multipleChoice` (email select), `…-9-phoneNumber-country`, `single-line-text-form-component-…-9-phoneNumber-nationalNumber`. Older ids are matched with `[id*='easyApplyFormElement'][id*='phoneNumber']`, `[id*='city-HOME-CITY']`, and the location typeahead with `[id*="location-GEO-LOCATION"]` [code] [3][8][14].
- **Component data-attrs:** `data-test-text-entity-list-form-component` (select), `data-test-single-line-text-form-component` (+ `data-live-test-…`), `data-test-single-typeahead-entity-form-component` / `-title`, `data-test-text-entity-list-form-title`, `data-test-text-entity-list-form-select` [code] [3][7][14].
- **Text input:** wrapped in `div.artdeco-text-input.artdeco-text-input--type-text` > `label.artdeco-text-input--label` + `input.artdeco-text-input--input`.
- **Custom questions:** employer "Additional questions" use the same components (text, numeric text, select, radio, checkbox, textarea, typeahead, date). They are not known before you open the modal and have no public schema.
- **EEO / voluntary:** typically radio/select for gender, race/ethnicity, veteran, disability. Bots key on label text ("gender", "veteran", "disability", "race"…) [code] [3][4].

| Standard field | Selector / identifier | Marker |
|---|---|---|
| Email | `select[data-test-text-entity-list-form-select][id*="multipleChoice"]` under label "Email" (options = account emails) | [code] [3] |
| Phone country code | `select[id*="phoneNumber-country"]` (options like "United States (+1)") | [code] [3][4][9] |
| Phone | `input[id*="phoneNumber-nationalNumber"]` | [code] [3][4][9] |
| First / Last name (when asked) | label text; ids vary (`input[id*="first"]`, `[id*="last"]`) | [code] [9] |
| City / location | `input[role="combobox"][id*="location-GEO-LOCATION"]` or label "Location (city)" (typeahead) | [code] [14] |
| Home address (street/city/state/zip) | group labels "Street", "City", "ZIP / Postal Code", "State" | [code] [4] |
| Resume | resume card list + `input[type=file][name="file"]` (§6) | [code] [3] |
| Cover letter | 2nd `input[name="file"]` whose preceding label says "cover" | [code] [4] |
| Years of experience (per skill) | single-line text, numeric. Label "How many years of work experience do you have with X?" | [code] [3] |
| Work authorization / sponsorship | radio fieldset or select. Labels "authorized to work", "require sponsorship" | [code] [3] |
| LinkedIn profile / website | single-line text with label "LinkedIn Profile", "Website" | [code] [3] |
| Salary | single-line text (numeric) | [code] [3] |
| Follow company | `#follow-company-checkbox` | [code] [3] |
| Date (start date etc.) | `input.artdeco-datepicker__input`, today button `button[aria-label*="This is today"]` | [code] [3][4][5] |

## 4. Widgets

| Widget | Build | How to set the value | Marker |
|---|---|---|---|
| Text / numeric | native `input.artdeco-text-input--input` (Ember classic, React SDUI) | Native value setter (`HTMLInputElement.prototype` descriptor) then bubbling `input` + `change`. Bots using Selenium `send_keys` also work. Numeric fields reject non-digits, and the error shows in `#<id>-error` | [code] [14][3] |
| Select | native `<select class="fb-dash-form-element__select-dropdown">`, placeholder option "Select an option" | Set `.value` to an option value, dispatch `input` + `change`. Match on visible text | [code] [14][3] |
| Radio | native `input[type=radio]` + `label[for]`. The SDUI resume picker uses `div[role=radio]` in `fieldset[role=radiogroup]` | Click the **label** (or the role=radio host). Setting `.checked` alone does not register. Check with `input.checked` / `aria-checked` | [code] [3][14] |
| Checkbox | native, sometimes visually-hidden (`follow-company-checkbox`) | Click the `label[for]` | [code] [3][6] |
| Typeahead (city/location, school, skills) | `input[role="combobox"]` with a listbox popup (`[role="listbox"] [role="option"]`) | Type the text, wait ~1-3 s, then pick the matching `[role=option]` (mousedown/click), or ArrowDown + Enter. Typed text alone fails validation. All bots use ArrowDown+Enter after a 2-3 s sleep | [code] [3][4][7][9] |
| Date picker | `input.artdeco-datepicker__input` (MM/DD/YYYY text) | Type the date and press Enter, or click `button[aria-label*="This is today"]` | [code] [3][4][5] |
| Textarea | native `textarea` (cover letter / summary) | Native setter plus input/change | [code] [3] |

Gotchas: LinkedIn renders hidden 0x0 duplicates of some controls, so always pick the visible one [code] [3]. The `interop-outlet` overlay intercepts pointer events, so plain coordinate clicks hit the host. Dispatch on the element or use `element.click()` [unverified] [15]. A required control that still has an error marker keeps Next blocked even after a value is set, so clear `artdeco-inline-feedback--error` by re-dispatching `change`/`blur` [code] [14].

## 5. Repeating sections

- Easy Apply does **not** usually ask for work-history or education entries. LinkedIn sends the member profile with the application. Some employer forms add "Work experience" or "Education" steps (rare). Bots don't handle add/remove repeaters, and there is no known selector [unverified] (inferred from the absence in all repos reviewed).
- Saved answers prefill repeated questions across applications. Treat prefilled values as user data and do not overwrite them.
- No resume parsing on upload inside Easy Apply. The uploaded file is just attached and saved for reuse [unverified] (no repo handles a parse step).

## 6. Resume upload

- **Saved resume cards** (classic, Sept 2026): `div.ui-attachment.jobs-document-upload-redesign-card__container.ui-attachment--pdf`. The selected one has `--selected` and `aria-label="Selected"`, the others `aria-label="Select this resume"`. The file name is in `h3.jobs-document-upload-redesign-card__file-name`, "105 KB · Last used on M/D/YYYY". The toggle is `input#jobsDocumentCardToggle-emberN[type=radio]` + `label.jobs-document-upload-redesign-card__toggle-label`. "Show N more resumes" is `button.jobs-document-upload__show-more-less-button`. Required marker: `.jobs-document-upload__title--is-required` [code] [3][6][7].
- **SDUI (2026) picker:** `fieldset[role="radiogroup"]` of `div[role="radio"]` cards whose text is "PDF <name> Uploaded on M/D/YYYY" [code] [14].
- **File input:** `input[type=file][name="file"].hidden`, id `jobs-document-upload-file-input-upload-resume-urn:li:fsu_jobApplicationFileUploadFormElement:urn:li:jobs_applyformcommon_easyApplyFormElement:(<jobId>,<n>,document)`. The visible trigger is `label.jobs-document-upload__upload-button[for=<that id>]` "Upload resume" [code] [3]. Older selector: `input[type=file][id*='jobs-document-upload']` [code] [8]. A cover-letter input has the same shape with a different label [code] [4].
- **Accepted:** `accept="application/msword,…wordprocessingml.document,application/pdf"`. The UI text reads "DOC, DOCX, PDF (5 MB)" (fixture) [code] [3]. An older "2 MB" limit is widely quoted [unverified].
- **Setting the file:** bots use Selenium `send_keys(path)` or Playwright `set_input_files` on the hidden input. AIHawk removes the `hidden` class first [code] [7]. For an extension, use `DataTransfer` → `input.files = dt.files` + `change` (the same approach as JobScript's existing `content/autofill.js`). This is unverified on LinkedIn [unverified] (inferred). Uploaded files land on LinkedIn's servers and appear as a new saved card.
- Picking an existing saved card (a click on the card or label) is usually enough and avoids an upload. LinkedIn stores up to a few resumes [unverified] [19].

## 7. iframes / shadow DOM

- **Open shadow root** `div#interop-outlet[data-testid="interop-shadowdom"]` hosts the Easy Apply modal on the 2026 `/jobs/search-results/` layout. It also hosts the post composer, invite dialog and limit popups [code] [11][13][15]. Content scripts can read `host.shadowRoot` (open), but `document.querySelector` does not pierce it. Use a MutationObserver on the shadow root, because the modal mounts after the click.
- `iframe[data-testid="interop-iframe"]` exists as overlay infrastructure. Some bots also watch same-origin iframes because the modal "sometimes lands there" [code] [11][12]. Its origin and contents are unverified.
- Everything is on `www.linkedin.com`, so a content script needs `https://www.linkedin.com/*` host permission. Use `all_frames: true` only if the iframe path is confirmed.
- SPA: navigation between jobs is pushState. Re-run detection on URL change and on modal mount.

## 8. Job / requisition ID

| Source | Regex / selector | Marker |
|---|---|---|
| View URL | `/jobs/view/(?:[^/?#]*-)?(\d{6,})` | [verified-live] [1] |
| Search URL | `[?&]currentJobId=(\d+)` | [verified-live] [1], [code] [8][10] |
| SDUI apply URL | `/jobs/view/(\d+)/apply/` | [code] [10] |
| Guest list cards | `data-entity-urn="urn:li:jobPosting:(\d+)"` | [verified-live] [2] |
| Apply button | `button.jobs-apply-button[data-job-id]` | [code] [3] |
| Job cards | `li[data-occludable-job-id]`, `[data-job-id]`, `[componentkey^="job-card-component-ref-"]` (digits) | [code] [3][11] |
| SDUI details | `componentkey="JobDetails_AboutTheJob_(\d+)"` | [code] [12] |
| Form ids | `easyApplyFormElement-(\d+)-` (job id embedded) | [code] [3] |
| Guest page | `<link rel="canonical" href=".../jobs/view/<slug>-(\d+)">` | [verified-live] [1] |
| Guest API | `GET /jobs-guest/jobs/api/jobPosting/<id>` (HTML fragment), `GET /jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=…&location=…&f_AL=true&start=0` (`f_AL=true` = Easy Apply filter) | [verified-live] [2] |

Title and company: on SDUI pages `document.title` is "<Title> | <Company> | LinkedIn" [code] [12]. On classic pages use `.job-details-jobs-unified-top-card__job-title` / `__company-name` [code] [3]. The guest `og:title` is "<Company> hiring <Title> in <Location> | LinkedIn" [verified-live] [1].

## 9. Automation restrictions

- **User Agreement §8.2 (Don'ts), effective 2025-11-03** [docs] [16]: item 2 bans scraping or copying with software, scripts or robots, including "browser plugins and add-ons". Item 13 bans "bots or other unauthorized automated methods to access the Services". (Short excerpts; read the full text.)
- **Help: "Prohibited software and extensions"** [docs] [17] says members who use tools that scrape, modify the look of, or automate activity on LinkedIn "risk having their accounts restricted or shut down."
- **Easy Apply limits** [docs] [18]: LinkedIn "introduced daily and speed limits on Easy Apply submissions … curbing automation and bots." Bots detect the message "exceeded the daily application limit" in `.artdeco-inline-feedback__message` [code] [3], and the shadow-root popups "reached today's Easy Apply limit" / "You're applying quickly" [code] [11]. Third-party claims put the cap at ~30-50/day (unofficial; vendor blogs) [unverified] [20].
- **Account restrictions:** vendor and SEO blogs report restrictions for auto-apply extensions (one claims 23% within 90 days, with no methodology). These sources have commercial bias [unverified] [20][21]. Bots in this list ship "anti-detection" stealth scripts, human-like delays and cookie import from a real Chrome profile [code] [8][9], which shows that detection is real. The login page has `#captcha-internal` [code] [8]. I found no GitHub issue in the main bot repos that documents bans.
- **JobScript stance:** user-triggered, one-form-at-a-time fill with no navigation, no job iteration, no Next/Review/Submit clicks and no scraping is far from what these bots do. It still falls under "browser plugins … automate activity" and "modify appearance" (any injected panel) in LinkedIn's wording, so ship LinkedIn support as opt-in with a clear warning. Do not request `linkedin.com` host permission by default. Avoid any background fetches to LinkedIn APIs (Voyager) and any DOM reads beyond the open form.

## 10. Sources

1. https://www.linkedin.com/jobs/view/4471641260/ (guest job page; canonical, og meta, `public_jobs_apply-link-onsite`, `pageKey`, no JSON-LD). `/jobs/view/<id>/apply/?openSDUIApplyFlow=true` returns 404 and `/jobs/collections/...` returns 302 to login when logged out. **[verified-live]** 2026-10-04
2. https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=software%20engineer&location=United%20States&f_AL=true&start=0 and https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/4471641260 (onsite) / …/4472640743 (offsite: `public_jobs_apply-link-offsite`, `apply-button__offsite-apply-icon-svg`, sign-in modal `job-details-topcard-apply-modal`). **[verified-live]** 2026-10-04
3. https://github.com/GodsScion/Auto_job_applier_linkedIn (`runAiBot.py`, `tests/fixtures/04_apply_button.html`, `06_easy_apply_modal.html`; last commit 2026-09-10). Selenium. The most current classic-modal selectors and a full modal fixture. **[code]** MIT
4. https://github.com/madingess/EasyApplyBot (`linkedineasyapply.py`, last push 2025-03). `fb-dash-form-element`, grouping, datepicker, phone ids, resume/cover by preceding label. **[code]** GPL-3.0
5. https://github.com/NathanDuma/LinkedIn-Easy-Apply-Bot (`linkedineasyapply.py`, 2022). **Stale** `fb-*` classes (`fb-single-line-text__input`, `fb-dropdown__select`, `fb-radio`). **[code]** no license
6. https://github.com/wodsuz/EasyApplyJobsBot (`linkedin.py`, 2026-03). Aria-label buttons, progress percent by absolute XPath (stale), `ui-attachment--pdf` resume pick, follow-company label. **[code]** NOASSERTION (custom)
7. AIHawk Easy Applier as preserved in fork https://github.com/pjpizzolato/Auto_Jobs_Applier_Fork (`src/aihawk_easy_applier.py`, 2024-10). `jobs-easy-apply-content`, `pb4`, `fb-text-selectable__option`, `data-test-text-entity-list-form-select`, "Show more resumes". The original `feder-cr/Jobs_Applier_AI_Agent_AIHawk` repo has since been repurposed (now `feder-cr/invisible_playwright_mcp`, no LinkedIn code). **[code]** MIT (fork)
8. https://github.com/joaosilvalopes/linkedin-easy-apply-bot (`selectors/index.ts`, 2025-10). Puppeteer selector table: `.jobs-easy-apply-modal footer button[aria-label*='next']`, `[id*='easyApplyFormElement'][id*='phoneNumber']`, `#captcha-internal`. **[code]** MIT
9. https://github.com/AkbarDevop/ai-job-agent (`scripts/linkedin-easy-apply.js`, 2026-04). Playwright `[role=dialog]`-scoped role queries, location `[role=option]` pick, required detection. **[code]** MIT
10. https://github.com/stickerdaniel/linkedin-mcp-server (`linkedin_mcp_server/linkedin/job_pages.py`, 2026-10). Easy Apply = `<a href=".../apply/?openSDUIApplyFlow=true">` (2026-09-14). The external-apply click counts as an apply. **[code]** Apache-2.0
11. https://github.com/Azoo92i/AutoApplyMax (`chrome-store-release/adapters/linkedin-adapter.js`, 2026-09-28). `#interop-outlet` open shadow root (Apr 2026 redesign), layout fingerprinting, EA dialog signature, `componentkey` cards, limit popups. **[code]** "Other" license (read only)
12. https://github.com/lbildzinkas/jobfit-jev (`docs/linkedin-structure.md`, 2026-09). SDUI `data-sdui-screen`, `componentkey`, `lazy-column`, `interop-iframe`, rollout varies per account. **[code]** MIT
13. https://github.com/VladyTipler/linkedin-beacon (`docs/linkedin-dom-anchors.md`, 2026-08). Same `#interop-outlet` shadow root for other modals. **[code]** MIT
14. https://github.com/tmwclaxton/autoapplycv (`extension/src/content/linkedin-auto-apply.js`, `linkedin-easy-apply-fields.js`, 2026-10). Native setter plus input/change, `progress[aria-valuenow]`, SDUI `role=radio` resume picker, `data-live-test-*` buttons, typeahead `location-GEO-LOCATION`. **[code]** "Other" license (read only)
15. https://github.com/kaialcayde/JobHunter-Public (`LEARNINGS.md`, 2026-04). Two flows (classic modal vs SDUI `/apply/`), shadow DOM since Mar 2026, pointer interception, "Share your profile?" interstitial, `/redir/redirect`. **[unverified]** (notes, no license)
16. https://www.linkedin.com/legal/user-agreement §8.2 (effective 2025-11-03). **[docs]**
17. https://www.linkedin.com/help/linkedin/answer/a1341387 "Prohibited software and extensions". **[docs]**
18. https://www.linkedin.com/help/linkedin/answer/a512348 "Apply to jobs directly on LinkedIn" (daily and speed limits, saved answers). **[docs]**
19. https://resumegenius.com/blog/resume-help/how-to-add-resume-to-linkedin (saved resumes, application settings). **[unverified]**
20. https://www.loopcv.pro/guides/linkedin-easy-apply-limit , https://blog.fastapply.co/linkedin-easy-apply-limit-how-to-apply-200-jobs-day-2026 (unofficial limit numbers; vendor blogs). **[unverified]**
21. https://resumly.ai/answers/is-auto-apply-safe , https://scale.jobs/blog/lazyapply-risk-profile-banned-linkedin , https://semafor.com/article/09/12/2024/linkedins-have-nots-and-have-bots (restriction reports, bot context). **[unverified]**

## Open questions

- Which variant (classic Ember modal, interop shadow-root modal, SDUI `/apply/` page) does a given account get? Rollout looks per account or per experiment [code] [12]. Field markup inside the SDUI `/apply/` page is barely documented. Is it still `[data-test-form-element]` + `fb-dash-*`?
- Does `DataTransfer` file assignment on the hidden `input[name=file]` register with LinkedIn's upload handler (Ember and React)? Untested.
- Does setting a select or text via native setter + `input`/`change` clear validation and enable Next in the SDUI variant, or does it need focus/blur or keyboard events?
- `iframe[data-testid="interop-iframe"]`: what is its origin, and can the apply form ever render inside it?
- Typeahead option markup in 2026 (role=option inside the shadow root?) and whether mousedown on an option is enough.
- Is the resume size limit 5 MB (fixture text) or 2 MB (widely quoted) across accounts or regions?
- Does LinkedIn detect content-script DOM writes themselves (vs click/timing patterns)? There is no public evidence either way.
