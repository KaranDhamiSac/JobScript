# Greenhouse

> Summary: Every hosted Greenhouse form is now the React/Remix "job-boards" renderer on `job-boards.greenhouse.io` (old `boards.greenhouse.io` URLs 301 there). Inputs have stable `id`s but **no `name` attributes**. Every dropdown, including EEO and education, is a react-select combobox with a "Toggle flyout" button. Location and school are remote-search comboboxes. Many company career pages embed the same form in a cross-origin iframe (`#grnhse_app` / `#grnhse_iframe`). The public Job Board API (`?questions=true`) returns the full question schema, including option lists, so an adapter can map every field before touching the DOM. Spam protection is invisible reCAPTCHA Enterprise, with an 8-digit emailed security code as the fallback. JobScript already handles most of this. Remaining gaps: multi-selects, the phone-country picker, and the optional schema prefetch.
> Overall difficulty: **medium** (react-select everywhere; otherwise one predictable single-page form).
> Last researched: 2026-10-04

## 1. Detection

| Signal | Value | Marker |
|---|---|---|
| Hosted job page / form | `^https://job-boards(\.eu)?\.greenhouse\.io/([^/]+)/jobs/(\d+)` | [verified-live] (src 1, 2) |
| Legacy host | `^https://boards(\.eu)?\.greenhouse\.io/...` now **301-redirects** to `job-boards.greenhouse.io` (seen for `/figma/jobs/5426468004`, `/cloudflare/jobs/7695702`, `/embed/job_app?...`) | [verified-live] (src 3) |
| Embedded form (iframe src) | `^https://job-boards(\.eu)?\.greenhouse\.io/embed/job_app\?for=<board>&token=<jobId>` (plus `validityToken`, `gh_src`, etc.) | [verified-live] (src 4, 5) |
| Embed loader script on company site | `https://boards.greenhouse.io/embed/job_board/js?for=<board>` (served directly, no redirect); creates `iframe#grnhse_iframe` inside `div#grnhse_app` | [verified-live] (src 5, 6) |
| Company-site job URL | any host with `?gh_jid=<id>` (e.g. `careers.<co>.com/positions/<id>?gh_jid=<id>`, `.../jobs/search?gh_jid=`) | [verified-live] (API `absolute_url` values, src 7) |
| Custom `absolute_url` | for boards whose `absolute_url` is a company site, `job-boards.greenhouse.io/<board>/jobs/<id>` **302s to the company site** (e.g. `stripe` → `stripe.com/jobs/search?gh_jid=`), so the only Greenhouse-hosted form left is the `/embed/job_app` one | [verified-live] (src 8) |
| DOM: form | `form#application-form.application--form` (method="get", `data-discover="true"`) | [verified-live] |
| DOM: page | `window.__remixContext`, `window.__remixRouteModules`, `window.ENV` (contains `JBEN_URL`, `GOOGLE_RECAPTCHA_INVISIBLE_KEY`, `JOB_SEEKERS_URL=https://my.greenhouse.io`) | [verified-live] |
| Assets | `https://job-boards.cdn.greenhouse.io/assets/entry.client-*.js`, `embed.job_app-*.js`, `root-*.js`, `vendor-*.js` (hashed, will change) | [verified-live] |
| `<title>` | `Job Application for <Title> at <Company>` (both hosted and embed) | [verified-live] |
| Meta | `og:title` = job title, `og:description` = location, `og:url` = canonical job-boards URL. **No JSON-LD.** | [verified-live] |
| Description container | `.job__description`, `.job__title`, `.job__location`, `.job__header` | [verified-live] |
| Legacy (pre-2024) form | `form#application_form`, inputs named `job_application[first_name]`, `job_application[answers_attributes][N][text_value]`, `urls[GitHub]`, `job_application[gender]`… Legacy selectors appear **stale**: every legacy URL tested redirects to the new renderer. | [code] (src 12, last pushed 2022) |

Already in JobScript: host regex `^(boards|job-boards|job-boards\.eu)\.greenhouse\.io$` (lib/fieldMap.js:81), form selectors `#application-form, #application_form, form#application, .application--form` (lib/fieldMap.js:82), manifest host permissions and content-script matches for all three hosts with `all_frames: true` (manifest.json:15-17, 53-55, 70).

## 2. Application flow

- **Single page.** Job description, then `form#application-form`, then a submit button `button[type=submit].btn.btn--rounded` with text "Submit application". There are no steps. Submission is a JS POST, and the page then routes to a confirmation path. [verified-live] (DOM). The confirmation route is [inferred] from `confirmationPath` in the `embed.job_app` route module.
- **No login required.** The "MyGreenhouse" / **Quick Apply** CTA is optional. It opens a login window to `my.greenhouse.io/users/sign_in?initiator=autofill&source=quick_apply&...` and then autofills from the candidate's Greenhouse profile (`QuickApplyAutofillSuccess` event; there are separate employment and education autofillers). [verified-live] (strings in `entry.client-*.js`)
  - On embedded boards, `grnh.js` listens for a `message` from `trustedAutofillUrl = https://job-boards.greenhouse.io` and shows an "Autofilled from …" notice on the parent page. [verified-live] (src 6)
  - The bundle also contains `application.quick_apply.apply_with_seek` (SEEK profile apply). [verified-live] (string only)
- **Resume parse:** the hosted form has no resume parse-and-prefill (unlike Lever and Ashby). Prefill only comes through MyGreenhouse Quick Apply. [verified-live] (no parse endpoint in bundle; the "Attach / Dropbox / Google Drive / Enter manually" buttons only attach)
- **Email verification step:** if invisible reCAPTCHA scores the submit low, the server replies `code: "captcha-failed"` with `security_code_recipient`. The form then shows `fieldset#email-verification` with **8 single-character inputs** `#security-input-0` … `#security-input-7` (paste is supported). The resubmit sends `security_code`. Related error ids: `#email-verification-error`, `#invalid-security-code`. [verified-live] (bundle); [docs] (src 10)
- **Review page:** none.

## 3. Field structure

- **Labelling:** `<label id="<id>-label" for="<id>">` plus `aria-label` on text inputs. Comboboxes have `aria-labelledby="<id>-label"`. Help and error text live in `#<id>-description`, `#<id>-help` and `#<id>-error`. [verified-live]
- **Required:** `aria-required="true"` on the input, and `<span class="required">*</span>` / `aria-hidden` asterisk in the label. Every required react-select also gets a sibling `<input required tabindex="-1" aria-hidden="true" class="remix-css-…-requiredInput">`. [verified-live]
- **No `name` attributes** on new-renderer text, select or file inputs. Only checkbox groups have `name` (`question_<id>[]`). Matching must use `id`, label or aria. [verified-live] (0 `name=` on inputs, Discord page)
- **Custom questions:** `id="question_<numericId>"`. The numeric id equals the API `fields[].name`. [verified-live]
- **Sections:** `div#demographic-section.demographic--container` (company "Voluntary Self Identification"), the EEOC compliance block (US), `.education--container`, `.employment--container`, and GDPR consent checkboxes (`#gdpr_consent_given`, `#gdpr_processing_consent_given`, `#gdpr_retention_consent_given`, `#gdpr_demographic_data_consent_given`). [verified-live] (bundle ids)

| Profile field | Selector / id | API `fields[].name` / type | Marker |
|---|---|---|---|
| First name | `#first_name` (`autocomplete="given-name"`) | `first_name` / input_text | [verified-live] |
| Last name | `#last_name` | `last_name` / input_text | [verified-live] |
| Preferred first name | `#preferred_name` (when enabled) | n/a | [verified-live] |
| Email | `#email` (`autocomplete="email"`, type=text) | `email` / input_text | [verified-live] |
| Phone country | `fieldset.phone-input #country` (react-select, flag + dial code) | n/a | [verified-live] |
| Phone | `#phone` (type=tel) | `phone` / input_text | [verified-live] |
| Location (city) | `#candidate-location` (react-select, async) plus a "Locate me" `button.btn--tertiary` | `location` / input_text, plus hidden `latitude`/`longitude` (`location_questions`) | [verified-live] |
| Resume | `input#resume[type=file].visually-hidden` (accept `.pdf,.doc,.docx,.txt,.rtf`) | `resume` / input_file + `resume_text` / textarea | [verified-live] |
| Resume as text | `#resume_text` (shown after "Enter manually", `data-testid="resume-text"`) | `resume_text` | [verified-live] |
| Cover letter | `input#cover_letter[type=file]`, `#cover_letter_text` | `cover_letter`, `cover_letter_text` | [verified-live] |
| LinkedIn / website / etc. | `#question_<id>` (custom question, labelled "LinkedIn Profile" etc.) | `question_<id>` / input_text | [verified-live] |
| Single-select custom question | `#question_<id>` (react-select) | multi_value_single_select | [verified-live] |
| Multi-select custom question | `fieldset.checkbox#question_<id>[]` > `input[type=checkbox][name="question_<id>[]"][id="question_<id>[]_<optionId>"]` + `label[for]`, `legend.checkbox__description` | multi_value_multi_select | [verified-live] |
| Long text | `textarea#question_<id>.input__multi-line` | textarea | [verified-live] |
| EEOC gender / Hispanic / race / veteran / disability | `#gender`, `#hispanic_ethnicity`, (`#race` revealed conditionally), `#veteran_status`, `#disability_status` (react-select) | `compliance[].questions[].fields[].name` (`gender`, `race`, `veteran_status`…) | [verified-live] (ids on page + API); `#race`/`#disability_status` [inferred] from API names |
| Demographic (company survey) | `#<numericQuestionId>` (e.g. `#4033064002`), react-select | `demographic_questions.questions[].id`, `answer_options[]` with `free_form` and `decline_to_answer` flags | [verified-live] |
| Education | `#school--0`, `#degree--0`, `#discipline--0`, `#start-month--0`, `#start-year--0`, `#end-month--0`, `#end-year--0` | `education: "education_optional" \| "education_required"` | [verified-live] (school/degree in DOM; the rest from bundle) |
| Employment | `#company-name-0`, `#title-0`, `#start-date-month-0`, `#start-date-year-0`, `#end-date-month-0`, `#end-date-year-0`, `#current-role-0` (single dash) | n/a | [verified-live] (bundle: `j=w=>\`${w}-${f.key}\``) |

**API schema (src 7, [docs] src 9):** `GET https://boards-api.greenhouse.io/v1/boards/<board>/jobs/<id>?questions=true` returns `questions[]`, `location_questions[]`, `compliance[]` (EEOC, by type), `demographic_questions{header,description,questions[]}`, `data_compliance[]` (GDPR flags), `education` (`education_optional`/`education_required`/absent), plus `id`, `internal_job_id`, `requisition_id`, `title`, `company_name`, `absolute_url`, `content` (HTML-escaped description). Field types seen across 48 live postings from 16 boards: `input_text` 396, `multi_value_single_select` 281, `textarea` 110, `input_file` 91, `input_hidden` 78, `multi_value_multi_select` 22. [verified-live]
Education option lists come from `GET https://boards-api.greenhouse.io/v1/boards/<board>/education/{schools,degrees,disciplines}?term=<q>&page=<n>` → `{items:[{id,text}], meta:{total_count,per_page:100}}`. [verified-live] (schools `term=Stanford` returned 1 item; degrees returned the full list)

## 4. Widgets

| Widget | Build | What registers a value | Marker |
|---|---|---|---|
| Text, textarea | React-controlled inputs | native value setter, then `input` (+ `change`/blur) | [verified-live] structure; [code] JobScript fillText |
| Single select (all dropdowns incl. EEO, demographic, education, phone country) | **react-select** inside `.select__container > .select-shell > .select__control > .select__value-container > .select__input-container > input.select__input[role=combobox][aria-haspopup=true]`, with `button.icon-button[aria-label="Toggle flyout"]` in `.select__indicators` | The menu won't open on a plain `focus()` from an unfocused page. `mousedown` on `.select__control` or a click on "Toggle flyout" opens it. Pick the option by `mousedown`/`click` on `[class*="__option"]` / `[role=option]`, or type to filter and press Enter. **The chosen value shows in `.select__single-value`; `input.value` stays `""`**, and the toggle is replaced by `button[aria-label="Clear selections"][data-testid="clear-selection"]` | [verified-live] (DOM); [code] (src 13, dated 2026) |
| Phone country | react-select `#country` showing `.iti__flag` + "+1". Starts pre-selected; keeps "Toggle flyout" while set | as above | [code] (src 13) |
| Location | async react-select `#candidate-location`. Typing triggers a geocode search (CSP `connect-src` allows `api-geocode-earth-proxy.greenhouse.io` and `api.geocode.earth`). "Locate me" uses browser geolocation (iframe `allow="geolocation"`) | type text → wait for remote options → click option. Hidden `latitude`/`longitude` are filled from the option | [verified-live] (DOM, CSP, grnh.js); remote timing [unverified] |
| School / degree / discipline | react-select backed by `/education/<type>?term=` (paged, 100 per page) | type → wait → click | [verified-live] |
| Multi-select question | native checkboxes in `fieldset.checkbox` | `click()` each | [verified-live] |
| Demographic multi-select (e.g. "Race or Ethnicity (optional)", API `multi_value_multi_select`) | react-select rendered with Toggle flyout (probably `isMulti`) | one option per open/select cycle; values show as `[class*="multi-value"]` | [verified-live] DOM; multi behaviour [inferred] |
| Employment "current role" | react-select `isMulti` checkbox-like single option (`#current-role-N`) | n/a | [verified-live] (bundle) |
| Month/year | react-select with month names; year is a text input or select | n/a | [verified-live] (bundle labels) [unverified] exact year widget |

Gotchas:
- Treat a react-select as filled when `.select__single-value` or `.select__multi-value` has text, not when `input.value` is non-empty.
- The hidden `requiredInput` sibling must be skipped; it isn't a field.
- Text matching on option labels: EEO options are long sentences ("I identify as one or more of the classifications of a protected veteran"). API `answer_options[].decline_to_answer=true` marks the decline option. [verified-live]

## 5. Repeating sections

- **Education** (`.education--container`, header `<p class="body body--medium">Education</p>`, **not an h-tag**). Entries are `#<field>--<key>` with key 0,1,… "Add another" is `button.add-another-button`. Entries other than the first have a remove button. [verified-live]
- **Employment** (`.employment--container > .employment-form`). Ids are `<field>-<key>`. There is an "Add another" button (`employment.add_another`) and a "Remove employment" button (shown when there is more than one entry). [verified-live] (bundle)
- There is no resume-parse prefill, so nothing collides. MyGreenhouse Quick Apply fills employment and education itself, so if the user ran it, JobScript should skip already-filled entries. [inferred]

## 6. Resume upload

- `input#resume[type=file]` (class `visually-hidden`) sits inside `div.file-upload[role=group][aria-labelledby=upload-label-resume][data-allow-s3]`. Visible buttons: "Attach" (`button.btn--rounded`), "Dropbox" (`data-testid=resume-dropbox`), "Google Drive", "Enter manually" (`data-testid=resume-text`). Accepted file types text: `#accepted-filetypes`. [verified-live]
- Set `input.files` via `DataTransfer` and dispatch `change`. [code] (JobScript attachFile; React's onChange listens to native `change`) [unverified] live.
- After attaching, the widget shows the filename and a remove control. [inferred]
- `data-allow-s3="false"` was seen. The S3 upload path when true is [unverified].
- Max size: not found in bundle [unverified].
- Cover letter: same widget with the `cover_letter` / `cover_letter_text` ids.

## 7. iframes / shadow DOM

- Company sites load `boards.greenhouse.io/embed/job_board/js?for=<board>` (`grnh.js`). It builds `iframe#grnhse_iframe` (title "Greenhouse Job Board", `allow="geolocation"`, `scrolling="no"`) in `div#grnhse_app`. It reads `gh_jid` (job) and `gh_src` (source) from the parent URL, and resizes and scrolls via `postMessage`. [verified-live] (src 6; Airbnb careers page loads `.../embed/job_board/js?for=airbnb` and has `#grnhse_app`, src 11)
- Iframe origin is `https://job-boards.greenhouse.io` (or `job-boards.eu.greenhouse.io`). Response CSP is `frame-ancestors *`. [verified-live]
- Content script needs `all_frames: true` plus a host match on the **iframe** origin. That is enough: the parent page needs no permission. JobScript already does this (manifest.json:53-57, 70; background.js:41-42 comment).
- No shadow DOM. react-select menus render inline, not in portals. [verified-live] (menu container is the `select-shell` parent per src 13) [unverified] for all boards.
- `boards.greenhouse.io/robots.txt` disallows `/embed/`. That matters for crawlers, not for a user-driven extension. [verified-live]

## 8. Job / requisition ID

| Where | Regex / path | Marker |
|---|---|---|
| Hosted URL | `/jobs/(\d+)` on `*.greenhouse.io` | [verified-live] |
| Embed URL | `[?&]token=(\d+)` with `for=<board>` | [verified-live] |
| Company site | `[?&]gh_jid=(\d+)` | [verified-live] |
| API | `id` (job post id, matches the URL), `internal_job_id` (job, shared across posts), `requisition_id` (free text, e.g. "7109", "See Opening ID") | [verified-live] |
| Board token | first path segment, or `for=` | [verified-live] |

Already in JobScript: lib/storage.js:333-348 (`/jobs/(\d{4,})` on greenhouse.io, `gh_jid` param, embed `token` param).

## 9. Automation restrictions

- **ToS:** Greenhouse's public legal page lists a privacy policy, a Master Subscription Agreement (customers) and similar documents. **No candidate- or visitor-facing terms of use were found**, so there is no anti-automation clause to quote for job seekers. [docs] (src 14)
- **Anti-bot:** invisible reCAPTCHA Enterprise (`grecaptcha.enterprise.execute(key,{action:"apply_to_job"})` on submit, loaded from `www.recaptcha.net/recaptcha/enterprise.js`). Score thresholds are per board ("spam sensitivity"). A low score triggers the emailed code. Greenhouse says reCAPTCHA "analyzes activity on a job post, like mouse movements and typing patterns" (src 10). [verified-live] + [docs]
- **Implication for JobScript:** synthetic fills with no real typing or mouse activity could lower the score and cause more email-code prompts. The user still submits manually and can enter the code. JobScript must **never** fill `#security-input-*`.
- Rate limits: no published limit for the public GET API. [docs] (src 9)
- `POST` to the API needs the company's Basic-auth API key, so it isn't available to candidates. [docs] (src 9)
- No account-ban reports found for user-assisted autofill. Auto-submit bots exist in the wild (src 12, 13); JobScript differs because it never submits.

## JobScript coverage (current code)

| Quirk | Handled? | Where |
|---|---|---|
| Host detection incl. EU + legacy | yes | lib/fieldMap.js:79-84 |
| Embedded iframe on company sites | yes (manifest `all_frames`, iframe-origin matches) | manifest.json:53-57,70; background.js:41-42 |
| react-select open without page focus, "Toggle flyout" fallback | yes | content/autofill.js:1074-1095 |
| Option lookup via `aria-controls` or `[class*="__option"]` in the control's parent | yes | content/autofill.js:165-169, 974-983 |
| Skip hidden `requiredInput` twin | yes | content/autofill.js:292-293 |
| Filled-state via `.single-value`/`.multi-value` | yes | content/autofill.js:404-408, 664-668 |
| Remote-search comboboxes (location, school): type then wait up to 2.5 s | yes | content/autofill.js:1189-1205 |
| Degree search by level instead of "BS" | yes | content/autofill.js:1192-1194 |
| Education/employment sections via ancestor class (`education--container` matches `/educat/`, `employment--container` matches `/employment/`) | yes (heuristic) | content/autofill.js:360-376; lib/fieldMap.js:254-256, 334-336 |
| "Add another" for education/employment | yes (text `Add another` matches addButton regex) | content/autofill.js:727-773; lib/fieldMap.js:258, 338 |
| Multi-select checkbox fieldset (`question_<id>[]`) | yes (checkboxGroup + legend) | content/autofill.js:300-305, 234-251 |
| File input via DataTransfer + change | yes | content/autofill.js:1222-1234 |
| Title/company from `Job Application for X at Y` | yes | content/autofill.js:2054-2057 |
| Job ID from URL / gh_jid / embed token | yes | lib/storage.js:333-348 |
| **Gap:** react-select multi (demographic race multi, `current-role`): only one option is picked | no | n/a |
| **Gap:** phone country `#country` could be matched by the generic `country` rule (lib/fieldMap.js:147-150) and set to a flag/dial-code option | unverified | needs live test |
| **Gap:** no use of `?questions=true` schema (exact option lists, required flags, `decline_to_answer`) | no | n/a |
| **Gap:** month/year selects in employment use month names; `FM.MONTHS` search exists (content/autofill.js:1195) but is untested here | partial | n/a |
| **Gap:** detect `#email-verification` and tell the user to enter the code | no | n/a |
| **Gap:** `.education--header` is a `<p>`, so heading-based detection misses it (attr fallback covers it) | n/a | n/a |

## 10. Sources

1. https://job-boards.greenhouse.io/discord/jobs/8806482002 — [verified-live] form DOM: ids, react-select, demographic section, "Locate me", no `name` attrs, title/meta.
2. https://job-boards.greenhouse.io/gitlab/jobs/8860302002 — [verified-live] hosted page, 200 with no redirect.
3. https://boards.greenhouse.io/figma/jobs/5426468004 → 301 to job-boards — [verified-live] legacy host redirect.
4. https://job-boards.greenhouse.io/embed/job_app?for=stripe&token=8172487 — [verified-live] embed form with education (`school--0`, `degree--0`, `add-another-button`), checkbox multi-select, CSP `frame-ancestors *`.
5. https://boards.greenhouse.io/embed/job_board/js?for=gitlab — [verified-live] `grnh.js`: `grnhse_app`, `grnhse_iframe`, `gh_jid`, `gh_src`, `validityToken`, `trustedAutofillUrl`.
6. Same as 5 — [verified-live] postMessage resize, scroll and autofill-notice handlers.
7. https://boards-api.greenhouse.io/v1/boards/{gitlab,stripe,discord,airbnb,…}/jobs/<id>?questions=true — [verified-live] question schema, field-type counts across 16 boards × 3 jobs, demographic/compliance/education keys.
8. https://job-boards.greenhouse.io/stripe/jobs/8172487 → 302 stripe.com — [verified-live] custom `absolute_url` redirect.
9. https://docs.greenhouse.io/job-board.html (redirected from developers.greenhouse.io) — [docs] endpoints, field types, POST needs Basic auth API key.
10. https://support.greenhouse.io/hc/en-us/articles/115005448066 — [docs] invisible reCAPTCHA, spam sensitivity, email verification code.
11. https://careers.airbnb.com/positions/8184174?gh_jid=8184174 — [verified-live] company page loading the Greenhouse embed script and `#grnhse_app`.
12. https://github.com/jeffistyping/workpls/blob/master/providers/greenhouse.js — [code] legacy `job_application[...]` names (Apache-2.0, last push 2022-09; **stale**).
13. https://github.com/joeyspagnoli/agentic-job-applier/blob/main/.research/greenhouse-widget-anatomy/findings.md — [code] react-select anatomy, `.select__single-value`, "Clear selections" swap, phone `#country` (MIT, 2026).
14. https://www.greenhouse.com/legal — [docs] list of legal docs (no candidate ToS).
15. https://job-boards.cdn.greenhouse.io/assets/entry.client-D-8RNsZm.js — [verified-live] (vendor bundle, read only): security-code flow (`#security-input-0..7`, 8 digits), employment/education ids, Quick Apply/MyGreenhouse, recaptcha action `apply_to_job`, education API path.
16. https://boards-api.greenhouse.io/v1/boards/stripe/education/schools?term=Stanford — [verified-live] education lookup endpoint.

## Open questions

- Exact event sequence that commits a react-select option on the live form from a background content script (mousedown on option vs Enter). Needs live testing; JobScript's current approach is reported working.
- Whether the demographic `multi_value_multi_select` renders as react-select `isMulti` or as checkboxes on every board.
- Whether attaching a file via `DataTransfer` triggers the React upload handler and filename display on every board, and the max file size.
- Whether `job-boards.eu.greenhouse.io` and `boards-api.eu.greenhouse.io` behave identically. No EU board was found to test; the EU API host didn't resolve (curl exit 6).
- The employment year widget type (text vs select) and the `discipline--N` / date fields on boards that enable them.
- The reCAPTCHA score impact of programmatic fills, and how often the email code appears for JobScript users.
