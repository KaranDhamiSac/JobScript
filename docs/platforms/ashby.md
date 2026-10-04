# Ashby

> Summary: Ashby's hosted application is a client-rendered React SPA at `jobs.ashbyhq.com/<org>/<uuid>/application`. **There is no `<form>` element.** Fields are keyed by a "path": system fields are `_systemfield_name`, `_systemfield_email`, `_systemfield_resume` and `_systemfield_location`; custom fields use a UUID. The path appears as `id`/`name` on most inputs, but not on the location combobox or the date picker. Booleans are Yes/No `<button aria-pressed>` pairs over a hidden checkbox. Multi-selects are checkbox groups whose `name` is the option label. Location is a floating-ui combobox backed by a GraphQL geo search. An "Autofill from resume" uploader re-renders the form from a parsed resume. The full form schema is readable through the public `ApiJobPosting` GraphQL query, and the page carries schema.org JobPosting JSON-LD. Spam checks use reCAPTCHA Enterprise scoring with per-board thresholds.
> Not supported by JobScript today: no host permission, no site entry.
> Overall difficulty: **medium**.
> Last researched: 2026-10-04

## 1. Detection

| Signal | Value | Marker |
|---|---|---|
| Posting page | `^https://jobs\.ashbyhq\.com/([^/]+)/([0-9a-f-]{36})/?$` | [verified-live] |
| Application tab | `^https://jobs\.ashbyhq\.com/([^/]+)/([0-9a-f-]{36})/application` (SPA tabs "Overview" / "Application": `.ashby-job-posting-right-pane-overview-tab` / `-application-tab`) | [verified-live] |
| Board | `https://jobs.ashbyhq.com/<org>` (org slug is case-insensitive: `Ashby` / `ashby`) | [verified-live] |
| Posting API | `GET https://api.ashbyhq.com/posting-api/job-board/<org>?includeCompensation=true` → `{apiVersion, jobs[]}`. A bare Python-urllib UA got **403**; a browser UA got 200 | [verified-live] + [docs] (src 3) |
| Embed on company site | `<div id="ashby_embed" [data-jid] [data-tab="application"] [data-noChrome="true"]>` + script `https://jobs.ashbyhq.com/<org>/embed` → `iframe#ashby_embed_iframe` with src `https://jobs.ashbyhq.com/<org>/<jid>[/application]?embed=js[&noChrome=true]`. The parent page URL carries `?ashby_jid=<uuid>` | [verified-live] (src 4) + [docs] (src 5) |
| DOM | `#form` root > `.ashby-application-form-container` > `.ashby-application-form-section-container` > `.ashby-application-form-field-entry`; survey block `.ashby-survey-form-container`; submit `button.ashby-application-form-submit-button` ("Submit Application") | [verified-live] |
| Page globals | `window.__appData` = `{organization, posting, jobBoard, recaptchaPublicSiteKey, recaptchaUniversalPublicSiteKey, ...}` (posting only, **no form**) | [verified-live] |
| Assets | `https://cdn.ashbyprd.com/frontend_non_user/<sha>/assets/index-*.js` (one large Vite bundle) | [verified-live] |
| `<title>` | `<Job title> @ <Org name>`; `og:title` = job title; `og:url` = posting URL (without `/application`) | [verified-live] |
| JSON-LD | `<script type="application/ld+json">` schema.org `JobPosting` (title, description, …) | [verified-live] |
| Custom domains | companies may host their own careers page with the embed (any host + `ashby_jid`). Ashby-hosted boards live only on `jobs.ashbyhq.com` | [docs] (src 5); [unverified] whether vanity domains exist |

## 2. Application flow

- **Single page** inside an SPA. Overview and Application are client-side tabs (route `/application`, no reload). There are no steps and no review page. Submission is a GraphQL mutation (`ApiSubmitSingleApplicationFormAction`, plus `ApiSubmitSurveyFormAction` / `ApiSubmitMultipleFormsAction`), and the page then shows a success state in place. [verified-live] (op names in bundle)
- **No login.**
- **"Autofill from resume"** box at the top of the Application tab (`.ashby-application-form-autofill-uploader`, title "Autofill from resume", "Upload your resume here to autofill key application fields."). It has its own `input[type=file]` **without an id** and an "Upload file" button. Flow:
  1. `ApiCreateFileUploadHandle` (upload, `sizeLimit` 6 MB in the autofill path).
  2. reCAPTCHA execute.
  3. `ApiAutofillApplicationFormWithUploadedResume(organizationHostedJobsPageName, …, recaptchaToken, formDefinitionIdentifier)` returns a **`formRender`**, meaning the whole form state comes back from the server.
  - Fields seen: `_systemfield_pre_parsed_resume` exists.
  - [verified-live] (bundle strings, src 2). Whether it overwrites values already typed is [inferred: likely, since it returns a full form render] and needs a live test.
- An **application-limits** callout may appear ("This job has application limits", `posting.applicationLimitCalloutHtml`). [verified-live]
- Consent extras per posting: `shouldAskForTextingConsent`, `shouldAskForWhatsAppConsent` (`_systemfield_texting_consent`, `_systemfield_whatsapp_consent`), and `_systemfield_recording_consent`. [verified-live] (`__appData` keys, bundle enum)

## 3. Field structure

- **Labelling:** `label.ashby-application-form-question-title[for="<path>"]` is the first child of `.ashby-application-form-field-entry`. A required field adds the `_required_*` class (hashed CSS module) to the label and `required` to the input. For text, email, tel and textarea the input has `id=name=<path>`. **The location combobox and the date input have no id or name, so `label[for]` resolves to nothing.** The label is the preceding sibling of the input container. The Yes/No hidden checkbox has `name=<path>` but no id. [verified-live]
- `.ashby-application-form-field-entry` carries `data-field-path="<path>"`. [code] (src 7). Not checked live.
- Descriptions: `.ashby-application-form-question-description`.
- **Stable class hooks** (`ashby-*`, unhashed): `-input-text`, `-input-textarea`, `-input-file`, `-input-file-dropzone(-upload|-instructions)`, `-input-autocomplete`, `-input-date`, `-input-yesno` / `-input-yesno-option`, `-input-radio-group(-option(-radio|-label))`, `-input-checkbox-group(-option(-checkbox|-label))`, `-section-header(-title|-description)`, `ashby-survey-form-container`. Other classes are hashed CSS modules (`_input_80epu_28`, …) and are **unstable**. [verified-live]

**Schema** (public, read-only GraphQL the page itself uses): `POST https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobPosting`. Query `jobPosting(organizationHostedJobsPageName, jobPostingId) { applicationForm { sections { title fieldEntries { ... on FormFieldEntry { id field isRequired descriptionHtml isHidden } } } } surveyForms { … } }`. `field` is JSON: `{path, title, type, selectableValues[{label,value}], isNullable, …}`. Field `type` counts across 27 postings from 9 orgs: `String` 109, `Boolean` 42, `LongText` 33, `File` 28, `Email` 27, `Location` 12, `ValueSelect` 12, `Phone` 11, `MultiValueSelect` 10, `Date` 2, `Number` (Ramp). Survey questions use `ValueSelect`/`MultiValueSelect`. System paths: `_systemfield_name`, `_systemfield_email`, `_systemfield_resume` (on every posting), `_systemfield_location` (12/24). [verified-live] (src 6). Note that `fieldType` is not a valid field; use `field.type`.

| Profile field | Selector | Marker |
|---|---|---|
| Full name (single field, label varies: "Name", "Legal Name") | `input#_systemfield_name[name=_systemfield_name]` | [verified-live] |
| Email | `input#_systemfield_email[type=email]` | [verified-live] |
| Resume | `input#_systemfield_resume[type=file]` (no name, `tabindex=-1`) + `button.ashby-application-form-input-file-dropzone-upload` | [verified-live] |
| Location | `.ashby-application-form-field-entry:has(label[for=_systemfield_location]) input.ashby-application-form-input-autocomplete[role=combobox]` | [verified-live] |
| Phone | custom `type=Phone` → `input[type=tel]#<uuid>` (placeholder e.g. "1-415-555-1234...") | [verified-live] |
| LinkedIn / GitHub / website | custom `String` → `input[type=text]#<uuid>`, label text only ("LinkedIn", "LinkedIn Profile") | [verified-live] |
| Preferred name | custom `String` | [verified-live] |
| Start date | custom `Date` → react-datepicker `input.ashby-application-form-input-date[placeholder="Pick date..."]` inside `.react-datepicker__input-container` | [verified-live] |
| Yes/No questions (authorization, sponsorship, relocation) | `.ashby-application-form-input-yesno > button[data-option=yes\|no][aria-pressed]` + hidden `input[type=checkbox][name=<path>]` | [verified-live] |
| Single choice | `fieldset.ashby-application-form-input-radio-group` > `input[type=radio][name="<formId>_<path>"][id="<formId>_<path>-labeled-radio-<i>"]` + `label[for]` | [verified-live] |
| Multi choice / acknowledgements | `fieldset.ashby-application-form-input-checkbox-group` > `input[type=checkbox][id="<formId>_<path>-labeled-checkbox-<i>"][name="<option label>"]` | [verified-live] |
| US EEOC (survey) | radio groups named `<surveyFormId>__systemfield_eeoc_gender`, `__systemfield_eeoc_race`, `__systemfield_eeoc_veteran_status` (legends "Gender", "Race", "Veteran Status"), heading "U.S. EQUAL EMPLOYMENT OPPORTUNITY INFORMATION" | [verified-live] (OpenAI posting) |
| Diversity survey (custom) | radios/checkboxes in `.ashby-survey-form-container` (age, gender identity, ethnicity multi-select, communities multi-select) | [verified-live] (Ashby's own posting) |

## 4. Widgets

| Widget | Build | What registers a value | Marker |
|---|---|---|---|
| Text/email/tel/textarea | React-controlled | native value setter + `input` (+ `change`/`blur`) | [verified-live] structure; event behaviour [unverified] |
| Yes/No (`Boolean`) | two `<button>`s with `aria-pressed`, `data-option`; the hidden checkbox (`tabindex=-1`, visually hidden) mirrors state | **click the button** (`button[data-option=yes]`). Toggling the hidden checkbox is not known to update React state. Read state from `aria-pressed="true"`. Src 7 notes `aria-pressed` alone may be insufficient and checks the field-entry structure | [verified-live] DOM; [code] (src 7) |
| Location (`Location`) | floating-ui combobox: `input[role=combobox][aria-haspopup=listbox][aria-autocomplete=list]` + toggle `button`. On open, `aria-controls` points at `div[role=listbox][id=":rN:"]` (portal, absolutely positioned) | Typing triggers GraphQL `ApiAutocompleteGeoLocation`. Pick a `[role=option]` in the listbox. Opening via the toggle button shows an **empty** listbox until text is typed | [verified-live] (opened via toggle; no typing done) |
| Single select (`ValueSelect`) | rendered as a **radio fieldset** in all postings observed | `click()` radio | [verified-live]; a dropdown variant for long lists is [unverified] |
| Multi select (`MultiValueSelect`) | checkbox fieldset; **each checkbox's `name` is its option label**, ids are unique | `click()` each | [verified-live] |
| Date | react-datepicker text input, `placeholder="Pick date..."`, no id/name | type a date string and blur, or use the calendar popup. Accepted format [unverified] | [verified-live] DOM |
| File | dropzone; hidden `input[type=file]` | `DataTransfer` + `change` [unverified] | [verified-live] DOM |
| Number | `type=Number` seen in schema (Ramp). DOM not inspected | n/a | [verified-live] schema only |

## 5. Repeating sections

- **None** observed in the application form: no add-another work history or education. `_systemfield_education_history` exists in the bundle's system-field list, but no posting sampled used it. [verified-live] / [unverified] for other orgs.
- **Resume autofill collision:** the server-side `formRender` replaces form state. An adapter should run (or let the user run) "Autofill from resume" **before** JobScript fills, then fill only empty fields. [inferred]

## 6. Resume upload

- Two file inputs:
  1. The **autofill** uploader (`.ashby-application-form-autofill-input-root`; first `input[type=file]` with no id). It parses and re-renders.
  2. The **Resume field** `input#_systemfield_resume` inside `.ashby-application-form-input-file`. It only attaches.
  - JobScript should target #2 (`id=_systemfield_resume`), or deliberately #1 if it wants Ashby's parse. [verified-live]
- `accept` = `application/pdf,.pdf,application/msword,.doc,application/vnd…(docx)…`. [verified-live] (truncated in capture)
- Upload goes through `ApiCreateFileUploadHandle` (file handle), not multipart on submit. The autofill path has a 6 MB limit (`F9=6*1024*1024`). The limit for the plain field is [unverified]. The bundle has a `RejectBase64EncodedResumesFrontEnd` feature flag. [verified-live] (bundle)
- No "paste resume text" alternative observed.

## 7. iframes / shadow DOM

- The embed iframe is `https://jobs.ashbyhq.com/...?...embed=js`. Responses send both `X-Frame-Options: DENY` and CSP `frame-ancestors *`. Modern browsers let CSP `frame-ancestors` override XFO, so embedding works. [verified-live] (headers); browser precedence is [docs] (CSP3 spec).
- A content script must match `https://jobs.ashbyhq.com/*` with `all_frames: true`. Parent-page access isn't needed. JobScript's manifest has **no** Ashby entry today (manifest.json:15-19, 53-57). The per-site access flow (popup/popup.js:103-106, background.js:216-225) can register the top-level origin, but that does not cover an embedded `jobs.ashbyhq.com` iframe on a company site.
- No shadow DOM (0 shadow roots). reCAPTCHA iframes (`www.recaptcha.net/recaptcha/enterprise/anchor|bframe`) are present on the page. [verified-live]

## 8. Job / requisition ID

| Where | Regex / path | Marker |
|---|---|---|
| URL | `jobs\.ashbyhq\.com/([^/]+)/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})` | [verified-live] |
| Embed parent | `[?&]ashby_jid=([0-9a-f-]{36})` (or `data-jid` on `#ashby_embed`) | [verified-live] |
| `__appData.posting.id`, `.title`, `.departmentName`, `.locationName`, `.employmentType`, `.compensationTierSummary` | n/a | [verified-live] |
| JSON-LD `JobPosting` | in page | [verified-live] |
| Posting API | `jobs[].id`, `jobUrl`, `applyUrl` | [verified-live] |

Already in JobScript: UUID-from-path in lib/storage.js:350-351 (comment at :333 names Ashby). `ashby_jid` is **not** in the param list at lib/storage.js:344.

## 9. Automation restrictions

- **ToS:** Ashby's Terms of Service are customer terms (5.1 Acceptable Use bars circumventing "security or other technological features"). There are no candidate-facing terms. [docs] (src 8)
- `jobs.ashbyhq.com/robots.txt` disallows `/api/`, `/b/`, `/meeting/`. [verified-live]
- **Anti-bot:** reCAPTCHA Enterprise (`recaptchaPublicSiteKey`, plus a "universal" key). Tokens are attached to autofill and submit mutations, and the server error is `RECAPTCHA_SCORE_BELOW_THRESHOLD`. Admins pick a level (Strict / Less Permissive / Permissive / No Protection), and Ashby warns that stricter levels can block real candidates. [verified-live] (bundle) + [docs] (src 9)
- An Ashby "Automated Processing Legal Notice" page (`/<org>/automation-notice`) concerns AI screening of applicants, not candidate-side bots. [verified-live]
- **Distinction:** many open-source bots target Ashby (src 7, 10). JobScript never presses submit, but synthetic input may still lower the reCAPTCHA score at submit time. No ban reports found.

## JobScript coverage (current code)

| Quirk | Handled? | Where |
|---|---|---|
| Host permission / site entry for `jobs.ashbyhq.com` | **no** (only via per-site access; embedded iframe not covered) | manifest.json:15-19, 53-57; lib/fieldMap.js:77-92 |
| `findRoot` without `<form>`: falls back to `document.body` | yes (generic) | content/autofill.js:1393-1405 |
| Text, email, tel, textarea via native setter + events | yes (generic) | content/autofill.js:919-941 |
| Radio fieldsets with legend → group label | yes | content/autofill.js:234-251, 300-305 |
| Location combobox (`role=combobox`, `aria-controls` listbox, `[role=option]`) | likely (generic combobox path) | content/autofill.js:119-125, 974-983, 1181-1220 |
| Label for location/date (no id) via `nearbyText` | likely | content/autofill.js:178-190, 211 |
| Job id from UUID path | yes | lib/storage.js:350-351 |
| Single "Name" field → full name rule | yes | lib/fieldMap.js:108-117 |
| Multi-step / SPA tab change watcher | yes (generic) | content/autofill.js:1769-1958 |
| **Gap:** Yes/No buttons. Only the hidden checkbox is collected (kind `checkbox`); "No" leaves it unchecked and never presses the No button; "Yes" clicks the hidden checkbox, which probably doesn't update React | no | content/autofill.js:968-972 |
| **Gap:** multi-select checkboxes are named by option label, so each becomes its own single-checkbox "group" and the question text is lost | no | content/autofill.js:296-305 |
| **Gap:** react-datepicker (`Pick date...`) not detected as a date (DATE_PLACEHOLDER only knows mm/dd/yyyy) | no | content/autofill.js:143, 316 |
| **Gap:** title/company parse for `"<Title> @ <Org>"` | no (falls back to h1 + og:site_name/URL slug) | content/autofill.js:2054-2069 |
| **Gap:** two file inputs; the autofill uploader (no id, first in DOM) could be picked as the resume field | unverified | content/autofill.js:1222-1234 |
| **Gap:** `ashby_jid` param in the job-id extractor | no | lib/storage.js:344 |
| **Gap:** no use of the `ApiJobPosting` schema | no | n/a |

## 10. Sources

1. https://jobs.ashbyhq.com/ashby/7458d4e9-da2e-47bd-98cb-adfda43d42b2/application — [verified-live] (browser DOM): no `<form>`, system-field ids, yes/no buttons, location combobox, autofill uploader, diversity survey checkboxes named by label, reCAPTCHA iframes, title/meta/JSON-LD, `__appData` keys.
2. https://jobs.ashbyhq.com/openai/7322d344-9325-4a92-8445-0a2c4e9272f8/application and its bundle `https://cdn.ashbyprd.com/frontend_non_user/3645fac9…/assets/index-DfblJ3AD.js` — [verified-live]: phone/date/radio/checkbox fieldsets, EEOC `_systemfield_eeoc_*`, listbox `:rN:`, GraphQL op names, autofill `formRender`, 6 MB limit, recaptcha error codes (bundle read only, no code copied).
3. https://developers.ashbyhq.com/docs/public-job-posting-api + https://api.ashbyhq.com/posting-api/job-board/{ashby,linear,ramp,notion,openai} — [docs] + [verified-live] posting API fields; no form questions.
4. https://jobs.ashbyhq.com/ashby/embed — [verified-live] embed script: `ashby_embed`, `ashby_embed_iframe`, `data-jid`, `ashby_jid`, `data-tab`, `embed=js`, `noChrome`.
5. https://docs.ashbyhq.com/embedding-ashby-job-boards-in-an-external-careers-page and https://www.ashbyhq.com/job-board-embed-examples — [docs] embed options (as summarised by search; pages not fetched in full).
6. `POST https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobPosting` for 27 postings across 9 orgs — [verified-live] form schema, field types, system paths (read-only query the page itself issues).
7. https://github.com/original4422/agent-form-accelerator/blob/main/prototype/bench/ashby-yesno-state.mjs — [code] Yes/No state reading, `data-field-path` on field entries (MIT, 2026-09).
8. https://www.ashbyhq.com/terms — [docs] customer ToS §5.1.
9. https://docs.ashbyhq.com/job-board-application-spam-protection — [docs] spam protection levels (as summarised by search).
10. GitHub code search for `_systemfield_name` (e.g. https://github.com/Liam-Frost/AutoApply src/execution/ats/ashby.py, license NOASSERTION; https://github.com/kalil0321/reverse-api-engineer examples/ashby, MIT) — [code] other Ashby automations exist; not read in depth.

## Open questions

- Whether React state updates when JobScript clicks `button[data-option]` from a content script. It probably does, since it is a real click handler.
- The date format react-datepicker accepts from typed input, and whether a blur commits it.
- Location: the debounce and minimum characters for `ApiAutocompleteGeoLocation`, and whether option text is "City, Region, Country".
- Whether "Autofill from resume" overwrites fields the user or JobScript already filled, and which fields it fills (name/email/phone/links/location?).
- Whether `ValueSelect` with many options renders as a combobox instead of radios.
- Whether the resume field `input#_systemfield_resume` accepts a programmatic `DataTransfer` file (react-dropzone usually does via `change`).
- Whether Ashby offers an EU instance or vanity domains for hosted boards. None were seen.
