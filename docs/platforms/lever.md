# Lever

> Summary: Lever's hosted application is a server-rendered, jQuery-enhanced, single-page form at `jobs.lever.co/<site>/<uuid>/apply` (EU: `jobs.eu.lever.co`). It uses plain `name` attributes (`name`, `email`, `phone`, `org`, `location`, `urls[LinkedIn]`, `cards[<uuid>][fieldN]`, `eeo[...]`, `surveysResponses[...]`). Each custom-question card embeds its own JSON schema in a hidden `cards[<uuid>][baseTemplate]` input, so an adapter can read exact question text, types and options straight from the page. The tricky parts:
> - "Current location" is a jQuery typeahead that searches on **keydown** and **clears itself on blur** unless a suggestion is picked.
> - Resume upload calls `/parseResume` and **overwrites any field not marked as touched**.
> - EEO/diversity surveys show and hide by candidate location.
> - hCaptcha (invisible) guards submit.
> Overall difficulty: **low–medium**.
> Last researched: 2026-10-04

## 1. Detection

| Signal | Value | Marker |
|---|---|---|
| Posting page | `^https://jobs(\.eu)?\.lever\.co/([^/]+)/([0-9a-f-]{36})/?$` | [verified-live] (src 1) |
| Application page | `^https://jobs(\.eu)?\.lever\.co/([^/]+)/([0-9a-f-]{36})/apply` | [verified-live] |
| Postings API | `https://api.lever.co/v0/postings/<site>?mode=json` / `https://api.eu.lever.co/v0/postings/<site>` | [verified-live] (global), [docs] (EU, src 6) |
| Postings list iframe (company sites) | `https://api.lever.co/v0/postings/<site>?mode=iframe&resize=...` (**list only**; apply links go to `jobs.lever.co`) | [docs] (src 6) |
| DOM: form | `form#application-form[enctype="multipart/form-data"][method=POST]`, containing several `div.section.application-form` blocks | [verified-live] |
| DOM: questions | `li.application-question` > `label` > `div.application-label` + `div.application-field` (standard); `li.application-question.custom-question` (cards) | [verified-live] |
| `data-qa` hooks | `name-input`, `email-input`, `phone-input`, `org-input`, `location-input`, `input-resume`, `btn-submit`, `additional-cards`, `card-name`, `multiple-choice`, `checkboxes`, `structured-contact-location-question`, `opportunity-location-select`, `candidate-location-select`, `eeo-section`, `consent-section`, `candidatePronounsCheckboxes` | [verified-live] |
| Scripts | `/js/jquery-3.6.1.min.js`, `/js/application.js`, `/js/parseResume.js`, `/js/retrieveLocations.js`, `/js/hideAndShowSurveys.js` (when surveys exist), `/js/debounce.min.js`, `https://js.hcaptcha.com/1/secure-api.js?host=jobs.lever.co` | [verified-live] |
| `<title>` | `<Company> - <Job title>` (e.g. "Palantir Technologies - Administrative Business Partner") | [verified-live] |
| Meta | `og:title`/`twitter:title` = `<Company> - <Title>`, `og:url` = page URL, `og:description` = description text. **No JSON-LD.** | [verified-live] |
| Hidden inputs | `accountId`, `linkedInData`, `origin`, `referer`, `timezone#applicant-timezone`, `socialReferralKey`, `socialSource`, `source`, `resumeStorageId`, `h-captcha-response#hcaptchaResponseInput` | [verified-live] |

Already in JobScript: host regex `^jobs(\.eu)?\.lever\.co$` (lib/fieldMap.js:87), form selectors (lib/fieldMap.js:88), description selectors (lib/fieldMap.js:89-90), manifest matches with `all_frames` (manifest.json:18-19, 56-57, 70).

## 2. Application flow

- **Single page, single POST** (full page load to a thank-you page). There are no steps and no review page. The visible submit is `button#btn-submit[data-qa=btn-submit][type=button]`, which runs the hCaptcha flow and then clicks the hidden `button#hcaptchaSubmitBtn[type=submit]`. [verified-live]
- **No login or account.** [verified-live]
- **Apply with LinkedIn:** some accounts show an "Apply with LinkedIn" (AWLI) widget (`.awli-button`, `AwliWidget` from `linkedin.com/talentwidget`). The result goes into hidden `linkedInData`. [verified-live] (Shield AI posting)
- **Resume parse-first:** attaching a file to `#resume-upload-input` POSTs it to same-origin `/parseResume` (`FormData{resume, accountId}`). On success it fills `name`, `email`, `phone`, `org` (from `position`), `location` + `selectedLocation`, `urls[LinkedIn|Twitter|Quora|GitHub|Other]`, `residentialLocation[*]`, and `resumeStorageId`. Status spans: `.resume-upload-working` "Analyzing resume...", `.resume-upload-success` "Success!", `.resume-upload-failure` "Couldn't auto-read resume.", `.resume-upload-oversize`. Max 100 MB (`MAX_FILE_SIZE = 100*1000*1000`). [verified-live] (src 3)
- **Overwrite rule (important):** the parse calls `updateIfUntouched`. A field counts as user-touched only after a **`change` or `paste`** event on it *and* when it has a value. Untouched fields are overwritten with the parsed value, or with `''` if the parse returned nothing. [verified-live] (src 3)

## 3. Field structure

- **Standard fields:** the `<label>` **wraps** the title div and the input (`label > div.application-label + div.application-field > input`). There is no `for`/`id`. The required marker is `<span class="required">✱</span>` in the title, plus a `required` attribute. [verified-live]
- **Custom cards:** `input[type=hidden][name="cards[<cardUuid>][baseTemplate]"]` holds HTML-escaped JSON `{text, instructions, type:"posting", fields:[{type, text, required, options:[{text, optionId}]}], id, accountId, secret}`. Field types seen: `multiple-choice` (radios), `multiple-select` (checkboxes), `dropdown` (native select), `text`, `textarea`. Inputs are named `cards[<cardUuid>][field<N>]`, with N the index into `fields[]`. Text/textarea cards have **no `<label>`**. Question text is in the sibling `div.application-label > div.text`, and the placeholder is a generic "Type your response". [verified-live] (src 2); [code] (src 9 notes the same)
- **Surveys (diversity, per location):** `surveysResponses[<uuid>][baseTemplate]` (JSON), `[surveyId]`, `[candidateSelectedLocation]`, `[responses][field<N>]` (radios/checkboxes). Wrappers are `[id*='countrySurvey']`, `[id*='all-candidate-locations']`, `[id*='all-opportunity-locations']`. Inputs carry `data-name="surveysResponses[...]"`. `hideAndShowSurveys.js` swaps which survey's inputs have a real `name`, based on `.candidate-location` / `.opportunity-location` changes. [verified-live] (Spotify, src 4)
- **US EEO section:** `div.section.eeo-section#eeoSurvey_<uuid>[data-qa=eeo-section]`, heading "U.S. Equal Employment Opportunity information". [verified-live] (Shield AI)

| Profile field | Selector | Marker |
|---|---|---|
| Full name (single field) | `input[name=name][data-qa=name-input]` | [verified-live] |
| Email | `input[name=email][type=email]` | [verified-live] |
| Phone | `input[name=phone]` (type=text) | [verified-live] |
| Current company | `input[name=org][data-qa=org-input]` | [verified-live] |
| Current location | `input#location-input.location-input[name=location]` + hidden `input#selected-location[name=selectedLocation]` (JSON of the chosen suggestion) | [verified-live] |
| LinkedIn / GitHub / Portfolio / Twitter / Other | `input[name="urls[LinkedIn]"]`, `urls[GitHub]`, `urls[Portfolio]`, `urls[Twitter]`, `urls[Other]` (the set is per account; label text is the key) | [verified-live] |
| Resume | `input#resume-upload-input[name=resume][type=file].invisible-resume-upload` | [verified-live] |
| Cover letter / additional info | `textarea#additional-information[name=comments]` | [verified-live] |
| Pronouns | `input[type=checkbox][name=pronouns].standardPronounsOption`, `#useNameOnlyPronounsOption`, `#customPronounsOption` + `#customPronounsTextField` | [verified-live] |
| Office location preference | `select[name=opportunityLocationId][data-qa=opportunity-location-select]` | [verified-live] |
| Marketing consent | `input[type=checkbox][name="consent[marketing]"]` (+ hidden `0`) | [verified-live] |
| EEO gender | `select[name="eeo[gender]"]` (Male / Female / Decline to self-identify) | [verified-live] |
| EEO race | `input[type=radio][name="eeo[race]"]` (e.g. "Hispanic or Latino", "Asian (Not Hispanic or Latino)", "Decline to self-identify") | [verified-live] |
| EEO veteran | `select[name="eeo[veteran]"]` | [verified-live] |
| EEO disability | `select#disabilitySelectElement[name="eeo[disability]"]`. Choosing any value reveals `#disabilitySignatureSection` with `eeo[disabilitySignature]` (placeholder "Enter your full name") and `eeo[disabilitySignatureDate]` (placeholder "MM/DD/YYYY"), which become `required` | [verified-live] (src 5) |
| Residential address | `[name^="residentialLocation["]` (some accounts) | [verified-live] (named in parseResume.js); DOM [unverified] |

## 4. Widgets

| Widget | Build | What registers a value | Marker |
|---|---|---|---|
| Text/email/textarea | native, no framework | set `.value`. Fire `change` so parseResume treats the field as touched | [verified-live] |
| Dropdowns (`dropdown` cards, EEO gender/veteran/disability, `opportunityLocationId`) | **native `<select>`**. Card placeholder options can be long, e.g. `<option value="">Click Here (If you encounter an issue…)</option>` | set `selectedIndex` + `change` (disability needs `change` to reveal the signature section) | [verified-live] |
| Radios / checkboxes | native inputs wrapped in `<label>` with `span.application-answer-alternative` text | `click()`. Required checkbox groups toggle `required` off once one is checked (application.js) | [verified-live] |
| Current location typeahead | jQuery handlers on `input.location-input`. `input` shows `.dropdown-container`. **`keydown`** (any key except arrows/Enter) runs a debounced (500 ms) `GET /searchLocations?text=<q>`. Results render as `div.dropdown-location#location-<i>` inside `.dropdown-results`. `.dropdown-no-results` / `.dropdown-loading-results` show status. Arrow keys plus Enter pick; **`mousedown` on `.dropdown-location`** picks and fills hidden `#selected-location` with JSON. **On `blur` with the dropdown open and nothing picked, it clears both `location` and `selectedLocation`.** Max query 100 chars | dispatch `input` and then `keydown` with a key, wait more than 500 ms plus network time, then `mousedown` the option | [verified-live] (src 3); `/searchLocations` returned "Forbidden" to bare curl, so it likely needs session cookies or a referer [unverified] |
| Pronouns | checkboxes with mutually exclusive JS (standard vs "Use name only" vs custom) | `click()` | [verified-live] |
| Date | only the EEO signature date, a free-text `MM/DD/YYYY` | text | [verified-live] |

Gotchas:
- Location is server-validated against `selectedLocation`. Typed text without a picked suggestion fails on submit ("Please select a location from the dropdown menu…" per src 9 [code]).
- `required` attributes on checkbox groups are adjusted dynamically.

## 5. Repeating sections

- **None** in the standard form: no work-history or education repeaters. Lever collects history only through the resume and custom cards. [verified-live] (3 postings: Palantir, Spotify, Shield AI)
- Multiple surveys with identical questions can coexist (one per country or location). Only the one matching the selected location is active; the others' inputs keep only a `data-name`. [verified-live] (Spotify had 4 diversity surveys)
- **Resume parse collision:** see §2. Two safe orders:
  1. Attach the resume first, wait for `.resume-upload-success` or `.resume-upload-failure` to become visible, then fill text fields.
  2. Fill fields with a `change` event first (they then count as touched), then attach.
  - In both cases, re-check `location`/`selectedLocation`: the parse may set the location text without the user having picked it.

## 6. Resume upload

- `input#resume-upload-input` (class `invisible-resume-upload`, `tabindex=-1`) inside `a.visible-resume-upload` ("ATTACH RESUME/CV"), inside the wrapping `<label>`. [verified-live]
- `application.js` listens for `change`: it shows the filename in `.filename` and adds `.has-file`. `parseResume.js` also listens for `change` (§2). Both are jQuery handlers, so a dispatched native `change` after setting `files` via `DataTransfer` triggers them. [verified-live] (handler code) [unverified] live run.
- Accepted types: no `accept` attribute. Max 100 MB (client check), and the server returns `PayloadTooLargeError`. [verified-live]
- The cover letter is a textarea (`comments`), not a file. [verified-live]

## 7. iframes / shadow DOM

- The hosted apply page sends no `X-Frame-Options` or CSP frame-ancestors, so companies *can* iframe it. Lever's documented embed is the postings **list** iframe at `api.lever.co/...mode=iframe`, and the apply links lead to `jobs.lever.co` top-level. [verified-live] (headers) + [docs] (src 6)
- If a company does iframe `jobs.lever.co`, JobScript's `all_frames` content script already matches. [code] (manifest.json:56-57, 70)
- There is no shadow DOM. The hCaptcha widget is a cross-origin iframe (`.h-captcha`) and must be left alone.

## 8. Job / requisition ID

| Where | Regex | Marker |
|---|---|---|
| URL | `jobs(?:\.eu)?\.lever\.co/([^/]+)/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})` → site, posting id | [verified-live] |
| API | `id`, `hostedUrl`, `applyUrl` (= hostedUrl + `/apply`), `categories{location,commitment,team,department,allLocations}`, `workplaceType`, `country`. **The API returns no question schema.** | [verified-live] |
| Title | some companies embed a req number in the title, e.g. "(R5732)" (`\((R\d+)\)`) | [verified-live] (Shield AI), company-specific |
| DOM | `input[name=accountId]` (Lever account), card uuids | [verified-live] |

Already in JobScript: lib/storage.js:323-328 (strips `/apply` for the same-job key), :333-353 (UUID from path).

## 9. Automation restrictions

- **ToS:** Lever's Terms of Service apply to **customers** (Order Form holders). They forbid things like reverse engineering and service-bureau use (src 7). There are no candidate-facing terms. The job-seeker page only says Lever "is not a job board" (src 8). [docs]
- `jobs.lever.co/robots.txt`: `Allow: /`, `Crawl-delay: 1`. [verified-live]
- **Anti-bot:** hCaptcha `secure-api.js` with a site key in the page (`data-sitekey`). It runs on submit, usually invisible, and the token goes into `h-captcha-response`. A visible challenge can appear. [verified-live]; "usually invisible" [code] (src 9)
- **API rate limit:** application POSTs (customer API key) are limited to about 2/s, returning 429. Postings GET has no documented limit. [docs] (src 6)
- **Distinction:** open-source bots auto-submit through these forms (src 9 records a live submission). JobScript only fills and leaves hCaptcha and submit to the user. No ban reports found.

## JobScript coverage (current code)

| Quirk | Handled? | Where |
|---|---|---|
| Hosts incl. EU | yes | lib/fieldMap.js:86-87; manifest.json:18-19 |
| Many `.application-form` sections: pick the root with the most fields | yes | content/autofill.js:1391-1405 |
| `name="urls[LinkedIn]"` normalised to "urls linked in" for matching | yes | lib/fieldMap.js:4-7, 158-167 |
| `org` → current company | yes | lib/fieldMap.js:169-172 |
| Wrapping labels: prefer the `.application-label` title over widget status text | yes | content/autofill.js:619-624 |
| Location typeahead: send `keydown` + `keyup` after `input`, wait for suggestions, `mousedown` the option | yes | content/autofill.js:1010-1067, 989-993 |
| Card text questions without `<label>`: `nearbyText` finds `div.application-label` | likely yes | content/autofill.js:178-190, 201-216 |
| Title/company from "Company - Title" | yes | content/autofill.js:2058-2061 |
| `/apply` page has no description: fetch the posting page | yes | content/autofill.js:2077-2090 |
| Same-job key strips `/apply`; UUID job id | yes | lib/storage.js:323-353 |
| **Gap:** the parseResume overwrite race. JobScript attaches the file and fills fields in one pass; fields filled *before* the parse returns are protected only because `fireEvents` sends `change` (content/autofill.js:930-935). Fields JobScript leaves empty get parse values, which is fine, but `location` may be set by the parse with no user pick | partial | needs ordering/await on `.resume-upload-success` |
| **Gap:** the `cards[...][baseTemplate]` JSON is not used (exact question text, required flags, options) | no | n/a |
| **Gap:** a card dropdown placeholder like "Click Here (…)" is not in `placeholderOptions` (lib/fieldMap.js:437), so the panel's current-value text shows it as an answer (emptiness still works via `value=""`) | minor | content/autofill.js:399-401, 659-662 |
| **Gap:** inactive survey copies (no `name`, only `data-name`) may be scanned as unnamed radios | unverified | n/a |
| **Gap:** the EEO disability signature (name + date) appears only after a choice; the late-field watcher should catch it (content/autofill.js:1702-1766), but it is a legal attestation and should stay user-only | check | n/a |

## 10. Sources

1. https://jobs.lever.co/palantir/6ed76ce8-4156-4b60-b120-403538bd66cd/apply — [verified-live] form DOM, cards + baseTemplate JSON, hidden inputs, scripts, hCaptcha.
2. Same page — [verified-live] card types `multiple-select`, `multiple-choice`, `dropdown`, `text`, `textarea`; label-less text cards.
3. https://jobs.lever.co/js/parseResume.js, https://jobs.lever.co/js/retrieveLocations.js, https://jobs.lever.co/js/application.js — [verified-live] (Lever's own served scripts, read only): parse fields and the touched rule, location keydown/blur/mousedown, `/searchLocations`, 100 MB limit, pronouns/EEO JS.
4. https://jobs.lever.co/spotify/2193db3f-77c5-43b8-b030-8f92c9882bf1/apply + https://jobs.lever.co/js/hideAndShowSurveys.js — [verified-live] `surveysResponses`, pronouns, consent, opportunity location.
5. https://jobs.lever.co/shieldai/938a7ddf-521f-4581-b5ba-c3ba29f9308a/apply — [verified-live] US EEO section (`eeo[*]`), Apply with LinkedIn, hCaptcha sitekey.
6. https://github.com/lever/postings-api (README) — [docs] postings API, EU base `api.eu.lever.co`, apply POST needs API key, 2 req/s → 429, iframe list embed. (Repo has no license.)
7. https://www.lever.co/legal/terms-of-service — [docs] customer ToS restrictions.
8. https://www.lever.co/job-seeker-support — [docs] job-seeker notice.
9. https://github.com/privacydied/job-application-skill/blob/main/sites/lever/NOTES.md — [code] keydown-only location search, label-less cards, invisible hCaptcha, server error text (MIT, 2026-08; an auto-submitting agent).
10. https://api.lever.co/v0/postings/palantir?mode=json&limit=3 (also spotify, zoox, outreach, shieldai, veeva) — [verified-live] postings JSON keys; EEO presence check across accounts.

## Open questions

- Whether `/searchLocations` works from a content-script-triggered keydown in the page context. It should, since it is same-origin XHR with cookies, but a bare curl got 403.
- The exact timing and order to avoid the parse overwrite on a real run.
- `jobs.eu.lever.co` DOM parity. No live EU posting was found (the `mistral` EU board returned 404 "Document not found").
- Whether `residentialLocation[...]` fields render as text or selects, and on which accounts.
- How often hCaptcha shows a visible challenge to a human who used autofill.
