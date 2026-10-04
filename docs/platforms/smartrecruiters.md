# SmartRecruiters

> Summary: The apply form is a separate Angular app ("oneclick-ui", served at `jobs.smartrecruiters.com/oneclick-ui/company/<Company>/publication/<uuid>`). It is built almost entirely from Lit web components (`spl-*`) that use **open shadow roots, often nested 2-3 deep**. A plain `document.querySelectorAll('input')` finds 1 input out of about 20. The adapter needs a shadow-piercing walker. It must write to the inner native `<input>` and dispatch `input`, which makes the host fire its own `spl-change` event for Angular. Typeahead fields (city, job title, company, school, screening dropdowns) only commit when an `spl-select-option` is chosen. The flow has 2 pages (profile, then screening questions) and has no login. The app is behind DataDome bot protection. Difficulty: **high**: shadow DOM, autocomplete commits, and DataDome.
> Last researched: 2026-10-04

## 1. Detection

| Signal | Value | Marker |
|---|---|---|
| Job ad URL | `^https://jobs\.smartrecruiters\.com/([^/?#]+)/(\d{6,})(?:-[^/?#]*)?` (e.g. `/Ubisoft2/744000153262644-gestionnaire-...`) | [verified-live] [1] |
| Apply app URL | `^https://jobs\.smartrecruiters\.com/oneclick-ui/company/([^/]+)/publication/([0-9a-f-]{36})` (query `?dcr_ci=<Company>`) | [verified-live] [2] |
| Apply URL from API | `applyUrl` = job ad URL + `?oga=true`. The page then routes to oneclick-ui | [verified-live] [3] |
| Referral URL | `jobs.smartrecruiters.com/external-referrals/company/<c>/publication/<uuid>` | [verified-live] [3] |
| Company career page | `careers.smartrecruiters.com/<Company>` (old XHTML page, returns 200) | [verified-live] [1] |
| Short links | `smartr.me/*` returns 302 to `www.smartr.me` | [verified-live]; listed as a SmartRecruiters domain in [12] |
| Job-ad DOM | `meta[name="sr:job-ad-id"]`, `link[rel=canonical]`, `[itemtype="http://schema.org/JobPosting"]` microdata (no JSON-LD), CSS `c.smartrecruiters.com/sr-jobad/static/<ver>/css/jobad.css`, apply anchors `a.js-oneclick[data-sr-track="apply"]`, `#st-apply` | [verified-live] [1] |
| Apply-app DOM | root `oc-app-root` / `oc-web`; components `oc-oneclick-form`, `oc-personal-information`, `oc-experience`, `oc-education`, `oc-resume-upload`; title starts "Easy apply"/"Postuler facilement - <job> - <company>" | [verified-live] [2] |
| Apply-app assets | `js-www.smartrecruiters.com/oneclick-ui/static/{runtime,polyfills,vendor,main}.<hash>.js`, `js-www.smartrecruiters.com/@sr/spl-core-components@2.209.2/…`, `js-www.smartrecruiters.com/datadome/dd-tags.js` | [verified-live] [2] |

Custom domains: companies with their own career sites (built on the Posting API) usually **link out** to `jobs.smartrecruiters.com`. I saw no case where the oneclick form is iframed on a customer domain [unverified]. Some customers submit through the Application API from their own form. In that case no SmartRecruiters DOM exists at all and the generic heuristics apply [docs] [4].

Ownership note: SAP's learning portal runs a "SmartRecruiters for SAP SuccessFactors Academy", which suggests SAP acquired SmartRecruiters (announced 2025) [docs] [13]. Expect the two products to converge over time [unverified].

## 2. Application flow

- **No account and no login.** The form is anonymous. Both public pages loaded without cookies. [verified-live] [2]
- **Page 1 (profile):** "Easy apply" choices at the top: `oc-apply-with-resume` (resume parse), `oc-apply-with-linked-in` (LinkedIn widget script `linkedin.com/talentwidgets/extensions/apply-with-linkedin-widget-v3`), `oc-apply-with-indeed` (button "Apply via Indeed"). Below them: Personal information, Experience, Education, Web profiles, Resume, Message to hiring team. Footer button: `oc-button[data-test="footer-next"]` (Next). [verified-live] [2]
- **Page 2 (screening/EEO questions):** rendered inside `sr-screening-questions-form` (its own shadow root), with `div[data-test="question-container"]` per question. Final button: `oc-button[data-test="footer-submit"]`; back button `footer-back`. Success: `h2[data-test="success-page-confirmation"]`. [code] [5] [6]
- **Step changes:** SPA (Angular router; `router-outlet` present). The URL path stays the same and the DOM is swapped. A content script must watch for mutations, not page loads. [verified-live] [2]
- **Per-posting config** comes from a GET to `/oneclick-ui/api/company/<companyId(24-hex)>/publication/<uuid>/config`, which returns `fieldSets` with `required`/`visible` flags: `firstAndLastName`, `email`, `placeOfResidence{configuration.locationType:"CITY"}`, `phoneNumber`, `experience`, `education{institution,educationDates}`, `socialProfiles{linkedIn,website,facebook,x}`, `resume`, `messageToHiringManager`, `easyApply{easyApplyResumeParsing,easyApplyIndeed,easyApplyLinkedIn,easyApplySeek,easyApplyPitchYou,easyApplyLineLogin}`. An adapter can read it (same origin) to learn which sections are required. [verified-live] [2]
- Feature flags: `/oneclick-ui/api/companies/feature-access?companyId=…&feature=DISABLE_MANUAL_LOCATION_INPUT_ONECLICK` and `ONECLICK_UI_RESUME_IMPROVEMENTS`. The first one means some tenants **forbid free-text city**, so the autocomplete selection is mandatory. [verified-live] [2]
- No separate review page. Submit is on page 2. JobScript never clicks it.

## 3. Field structure

Labels live **inside the shadow root** of each `spl-*` host as `<label for="<id>" id="<id>-label">` inside `spl-internal-form-field`. The light DOM has no `<label>`. The label text is also on the host's `label` attribute, which is the easiest thing to read. The host and the inner native input **share the same `id`**. [verified-live] [2]

Required marker: the host has a `required` attribute. The inner input has `aria-required="true"`, and the label has `span.c-spl-form-field-required-mark` ("*"). Native `required` is **not** set on the input. [verified-live] [2]

Angular wrapper elements (light DOM) carry the stable hooks: `oc-input[formcontrolname][data-test][attrid]`.

| Profile field | Light-DOM wrapper | Host -> inner element | Marker |
|---|---|---|---|
| First name | `oc-input[formcontrolname=firstName][data-test=personal-info-first-name-input]` | `spl-input#first-name-input` -> `input#first-name-input[autocomplete=given-name]` | [verified-live] [2] |
| Last name | `oc-input[formcontrolname=lastName][data-test=personal-info-last-name-input]` | `spl-input#last-name-input` -> `input[autocomplete=family-name]` | [verified-live] [2] |
| Email | `oc-input[formcontrolname=email][data-test=personal-info-email-input]` | `spl-input#email-input` -> `input[type=email]` | [verified-live] [2] |
| Confirm email | `oc-input[formcontrolname=emailConfirmation][data-test=personal-info-email-confirm-input]` | `spl-input#confirm-email-input` | [verified-live] [2] |
| City (residence) | `oc-location-autocomplete` | `spl-autocomplete[data-test=location-autocomplete][minquerylength=3]#spl-form-element_N` -> shadow `spl-input#spl-form-element_N` -> shadow `input[role=combobox]` | [verified-live] [2] |
| Phone | `oc-phone-number` | `spl-phone-field[autocomplete=tel][value='{"country":"CA"}']` -> shadow: `spl-select` (country, `value="CA"`) + `spl-dropdown-search` + `spl-input` -> `input[type=tel]` | [verified-live] [2] |
| LinkedIn / Facebook / X / Website | `oc-input[formcontrolname=linkedIn\|facebook\|twitter\|website][data-test=web-profiles-*]` | `spl-input#linkedin-input` / `#facebook-input` / `#twitter-input` / `#website-input` | [verified-live] [2] |
| Resume | `div[data-test=resume-upload-container]` | `spl-dropzone[data-test=resume-upload]` -> shadow `input#file-input[type=file]` | [verified-live] [2] |
| Message to hiring team | `oc-textarea[formcontrolname=message][data-test=hiring-manager-message-text]` | `spl-textarea#hiring-manager-message-input` -> `textarea` | [verified-live] [2] |
| Avatar photo | `oc-avatar` | light-DOM `input[type=file][name^=file-upload-]` (images only) | [verified-live] [2] |

Note that `spl-form-element_N` ids are **sequential and unstable**. Key on `data-test` or the `label` attribute instead.

Screening questions (page 2): an EEO/diversity block (gender, race/ethnicity, Hispanic, veteran, disability) plus custom questions. All are `spl-autocomplete` / `spl-radio` / `spl-checkbox` inside `sr-screening-questions-form`'s shadow root. Labels are in `span[slot="label-content"]`, and the host has an `aria-label`. [code] [5] One bot reports that each question's full definition (type, required, options with label/value) is a JSON **`definition` attribute** on the question host, which is easier to use than parsing rendered text. [code] [6] I could not verify this live because page 2 needs page 1 to be valid. The Application API docs say that `complianceType: "DIVERSITY"` questions are shown last, in the order given. [docs] [4]

## 4. Widgets

All `spl-*` elements are **Lit** custom elements (host has `renderRoot`, `_$…` Lit internals, `isUpdatePending`). Shadow roots are **open**, with `delegatesFocus: true`. Angular binds through `spl-change`, `spl-clear`, `spl-touched` and `spl-untouched` CustomEvents on the host (seen as zone.js listener keys on the host). [verified-live] [2]

| Widget | How it registers a value | Marker |
|---|---|---|
| `spl-input` / `spl-textarea` | The inner `<input>` has Lit `@input` and `@change` handlers that call `handleChange(input.value)`, which sets `host.value`, runs validation and dispatches `spl-change` with `detail.value`. **Recipe:** `inner.value = v; inner.dispatchEvent(new Event('input', {bubbles:true, composed:true}))`, then `inner.dispatchEvent(new Event('blur'))` (or `focusout`) so `markAsTouched` fires `spl-touched`. No React native-setter trick is needed. | [verified-live] [2] (read from component source in the page) |
| Setting `host.value` directly | The Lit property setter only calls `requestUpdate`. It **does not** emit `spl-change`, so Angular's FormControl stays empty while the field *looks* filled. Avoid this. A bot hit exactly this problem. | [verified-live] [2], [code] [6] |
| `spl-autocomplete` (city, job title, company, institution, screening dropdowns) | Typing (input event on the nested inner input) calls `handleSearchInputChange`, then `handleQueryChange`, which fetches options **asynchronously** (min query length 2-3) and opens `spl-dropdown`. The value commits only in `handleOptionSelect(e)`, which looks up `optionsDictionary[e.detail.value]`, calls `handleChange` and then `setQuery(label)`. `spl-select-option.click()` is defined as `this.handleSelect()`, which dispatches the select event, so a programmatic `.click()` on the **option host** should commit. Bots report mixed results with JS clicks; one only succeeded with a trusted (Playwright) mouse click on the city option, another with keyboard Enter on a screening dropdown. Recommended: type, wait for `spl-select-option` nodes inside the autocomplete's shadow root, call `.click()` on the best-matching option host, then **verify** that the host `value` is non-empty and no error message renders. Fall back to ArrowDown and Enter keydown on the inner input. Options are under `spl-autocomplete` shadow -> `spl-dropdown` -> `spl-select-option[value][label]`; their text is in `div.c-spl-autocomplete-option-content`. City option values look like `GB_ENG_CITY_london`. `allowcustomvalues` is set on job title, company and institution (free text is accepted) but **not** on location. | [verified-live] [2]; [code] [5] [6] |
| `spl-phone-field` | A country `spl-select` (button `role=combobox`, options `spl-select-option[value=ISO2][label=Country]`) plus a `spl-input[type=tel]` for the national number. Pick the country by clicking the option host, then fill the number. | [verified-live] [2], [code] [5] |
| `spl-date-field` (experience/education From/To) | `spl-date-field[type=month-year]` -> shadow `spl-date-picker[allowinput]` -> shadow **flatpickr** `input.flatpickr-input[data-input]` (monthSelect plugin; locale e.g. `fr_ca`), so the input is 3 shadow levels down. `allowinput` means typed text is parsed. Likely recipe: set the value on the flatpickr input, dispatch `input` and `change`, then blur; alternatively open the picker and click the month cell. **Not verified (no typing allowed).** | [verified-live] structure [2]; recipe [unverified] |
| `spl-checkbox` (`current` job/school, consents) | Host plus a nested native `input[type=checkbox]` that shares the id. Calling `.click()` on the inner input works per [6]. | [verified-live] structure [2]; [code] [6] |
| `spl-radio` (screening Yes/No) | No native radio. Calling `.click()` on the `spl-radio` host toggles it (`c-spl-radio--checked`). | [code] [6] |
| `spl-button` | The real `<button>` is inside the shadow root. `oc-button > spl-button` host `.click()` works. | [verified-live] [2] (Add buttons opened via shadow button) |

Gotchas:
- **Duplicate ids across shadow levels.** `spl-autocomplete#X` > `spl-input#X` > `input#X`. A recursive "first match by id" returns the outer host. Always descend to the native `INPUT`/`TEXTAREA`. [verified-live] [2], [code] [6]
- The UI is localized (labels in French on a French-Canadian posting), so label-text matching must handle multiple locales. Prefer `data-test`/`formcontrolname`/`autocomplete`. [verified-live] [2]
- `spl-input` also supports `validators`, `asyncvalidationenabled` and `validatetld` (the email TLD check). [verified-live] [2]

## 5. Repeating sections

- Experience: `oc-button[data-test=add-experience]` (aria-label "Add experience entry") inserts `oc-experience-entry[data-test=experience-entry] > oc-experience-edit-form` **inline** (no modal). Fields: `spl-autocomplete[data-test=job-title-autocomplete]` (Title, `allowcustomvalues`), `spl-autocomplete[data-test=company-autocomplete]`, `oc-location-autocomplete-wrapper[data-test=experience-form-location]`, `oc-textarea[data-test=experience-description]`, `oc-datepicker[data-test=experience-date-from|to][formcontrolname=startDate|endDate]`, `oc-checkbox[data-test=experience-current][formcontrolname=current]`. Buttons: `oc-button[data-test=experience-save|experience-cancel]`. [verified-live] [2]
- Education: `oc-button[data-test=add-education]` creates `oc-education-entry` (note: its `data-test="experience-entry"` is copy-pasted). Fields: `spl-autocomplete[data-test=institution-autocomplete]` (required by config), `oc-input[formcontrolname=major][data-test=education-major]`, `oc-input[formcontrolname=degree][data-test=education-degree]` (free text), `oc-location-autocomplete-wrapper[data-test=education-form-location]`, `oc-textarea[data-test=education-description]`, `oc-datepicker[data-test=education-date-from|to]`, `oc-checkbox[data-test=education-current]`, and save/cancel buttons `education-save|education-cancel`. `oc-education-connecticut-disclaimer` is present. [verified-live] [2]
- Entry inner ids include a UUID per entry (`exp-desc-<uuid>`, `edu-major-<uuid>`). New entries are inserted at the **top**: the bot recipe uses `reverse: true` and targets the first `oc-experience-entry`. Each entry must be **saved** before the next is added. [verified-live] ids [2]; [code] [5]
- Resume parse (`oc-apply-with-resume`, `spl-dropzone[data-test=apply-with-resume-container]`) prefills personal info and experience/education, then shows `oc-prefill-success-banner`. Running autofill **after** the parse can create duplicate entries. The adapter should check for existing `oc-experience-entry` elements before adding. [verified-live] component presence [2]; collision [unverified]

## 6. Resume upload

- `spl-dropzone[data-test=resume-upload]` -> shadow -> `input#file-input[type=file][tabindex=-1]` with `label[for=file-input]` ("Select a file or drop it here"). The limit is **10 MB**. `accept` is a very long list (`.pdf, .doc, .docx, .rtf, .odt, .txt, .pages, images, …`). [verified-live] [2]
- **Two** `input#file-input` exist (the parse dropzone at the top and the resume field), each in its own shadow root. Target by the host's `data-test`, not by id. [verified-live] [2], [code] [6]
- DataTransfer approach: `const dt=new DataTransfer(); dt.items.add(file); inner.files=dt.files; inner.dispatchEvent(new Event('change',{bubbles:true,composed:true}))` is expected to work because the input is a normal open-shadow native input [unverified]. Bots used Playwright `setInputFiles` successfully [code] [6].
- Cover letter: no dedicated field on the observed posting. The "Message to the hiring team" textarea serves as one. [verified-live] [2]

## 7. iframes / shadow DOM

- **Shadow DOM is the main issue.** JobScript's current `content/autofill.js` does no shadow traversal (no `shadowRoot` references). A SmartRecruiters adapter needs a `deepQueryAll(root)` that recurses into `el.shadowRoot`. All roots seen were `open`; I found no closed roots. `event.composedPath()` is needed if listening for focus or input from the page. [verified-live] [2]
- 38 shadow hosts on page 1 before adding entries: `spl-icon, spl-wrapper, spl-typography-*, spl-form-field, spl-dropzone, spl-divider, spl-input, spl-autocomplete, spl-phone-field, spl-button, spl-textarea, spl-toaster`. The job ad page also uses a few `spl-*` web components (`spl-icon`, `spl-job-location`), but they are display-only. [verified-live] [1] [2]
- iframes: OneTrust and Cloudflare insert hidden frames, and the LinkedIn widget may frame. The form itself is **top-level** on `jobs.smartrecruiters.com`. `all_frames` is not needed for the form. Host permission needed: `https://jobs.smartrecruiters.com/*`. [verified-live] [2]

## 8. Job / requisition ID

| Source | Pattern | Marker |
|---|---|---|
| Job ad URL | `/([^/]+)/(\d{6,})(?:-|$)`: company identifier + numeric posting id (e.g. `744000153262644`) | [verified-live] [1] |
| Apply URL | `/publication/([0-9a-f-]{36})` = posting `uuid` | [verified-live] [2] |
| Posting API | `GET https://api.smartrecruiters.com/v1/companies/<c>/postings/<id or uuid>` (no auth; both id and uuid return 200) gives `id`, `uuid`, `jobId`, `jobAdId`, `refNumber` (customer req, e.g. `REF32029Q`), `postingUrl`, `applyUrl`, `customField[]` | [verified-live] [3] |
| Postings list | `GET …/companies/<c>/postings?limit=N`. An unknown company returns `totalFound:0` | [verified-live] [3] |
| Meta | `meta[name="sr:job-ad-id"]` = `jobAdId` (UUID); `og:url`/canonical contains the numeric id | [verified-live] [1] |

## 9. Automation restrictions

- **DataDome**: `curl` on the oneclick-ui URL returns **403** with a `geo.captcha-delivery.com` interstitial ("Please enable JS and disable any ad blocker"). A real browser passes, and `datadome/dd-tags.js` is loaded in the app. The page also uses the Cloudflare challenge platform `cdn-cgi/challenge-platform`. User-assisted autofill inside the user's own browser session is unaffected, but **rapid scripted DOM events or headless use may trigger a captcha**. [verified-live] [2]
- The job ad page and the Posting API returned 200 via curl. [verified-live] [1] [3]
- Candidate Terms of Use (last modified May 14, 2019) prohibit using "automatic means to access content or data from other users". That targets scraping other users' data, not filling your own application. [docs] [7]
- I found no account-ban reports for user-side autofill. Bots in [6] submitted real applications successfully. JobScript (fills only, never submits) is in a much lower-risk category than these auto-submit bots.

## 10. Sources

1. https://jobs.smartrecruiters.com/Ubisoft2/744000153262644 (job ad HTML, meta, microdata, `spl-*` usage). [verified-live]
2. https://jobs.smartrecruiters.com/oneclick-ui/company/Ubisoft2/publication/7d34780e-8319-4c78-a8dd-c4707aaf7eb9?dcr_ci=Ubisoft2 (DOM/shadow walk, Lit component source for `spl-input`/`spl-autocomplete`/`spl-select-option`, config API, DataDome 403 via curl). Opened in a browser tab; nothing typed or submitted; only the "Add" buttons were clicked to reveal entry forms. [verified-live]
3. https://api.smartrecruiters.com/v1/companies/Ubisoft2/postings/744000153262644 and `…/postings?limit=2` (BoschGroup, Ubisoft2, McDonaldsCorporation). [verified-live]
4. https://developers.smartrecruiters.com/docs/application-api (Application API, `GET /postings/:uuid/configuration` screening questions, which needs auth: unauthenticated GET returned 404; DIVERSITY ordering), https://developers.smartrecruiters.com/changelog/application-api-configuration-ai-generated-field. [docs]
5. https://github.com/kensac/job-scripts/blob/main/extension/adapters/recipes/SmartRecruiters.json (recipe updated 2026-09-24: shadow-root XPath paths, `data-test` hooks, footer-next/footer-submit, `sr-screening-questions-form`, experience/education entry handling). MIT. [code]
6. https://github.com/privacydied/job-application-skill/blob/main/sites/smartrecruiters/NOTES.md (2026-08/09 field notes from an auto-submit bot: duplicate ids, host `.value` trap, autocomplete commit difficulties, `definition` attribute, `spl-radio`/`spl-checkbox`). MIT. [code]
7. https://www.smartrecruiters.com/legal/terms-of-use/ (Candidate Terms of Use). [docs]
8. https://github.com/jaydentrannnn/resumetailor (`src/resume_tailor/apply/ats/smartrecruiters_*.py`, Playwright flow; not read in depth). MIT. [code]
9. https://github.com/WhiteboxHub/project-talentscreen-autofill-extension (`smartrecruitersStrategy.js`; not read in depth). No license. [code]
10. https://github.com/tmwclaxton/autoapplycv (`tests/fixtures/form-extraction/expected/https-jobs-smartrecruiters-com-oneclick-ui-*.json`, about 45 captured oneclick forms usable as test fixtures; not read in depth). License NOASSERTION. [code]
11. https://github.com/Thiwanka-1/FastApply (`extension/public/smartrecruiters-engine.js`; not read in depth). No license. [code]
12. https://github.com/fkabaalkhail/Applypilot/blob/main/chrome-extension/src/content/siteRegistry.ts (domain registry: `smartr.me`, oneclick-ui pattern). No license. [code]
13. https://learning.sap.com/courses/smartrecruiters-for-sap-successfactors-academy/configuring-the-application-experience (SAP-hosted SmartRecruiters course; relationship to SAP). [docs]

## Open questions

- Whether `spl-select-option.click()` from an extension's isolated world reliably commits city/location (bots disagree: trusted click vs Enter). This needs live testing with test data on a real posting, without submitting.
- The exact sequence that makes the flatpickr month-year field register in Angular.
- Page-2 screening question DOM (`definition` attribute, `spl-radio` structure). This could only be reached with a valid page 1.
- Whether some tenants embed oneclick-ui in an iframe on their own domain.
- Whether DataDome challenges appear mid-form when many synthetic events fire quickly.
- How the resume-parse prefill marks entries (to dedupe against JobScript's profile entries).
