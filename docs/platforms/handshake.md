# Handshake

> Summary: Handshake (students and alumni) needs a login, usually through school SSO, and applying happens in a single React modal on `app.joinhandshake.com` (or a `<school>.joinhandshake.com` subdomain). The modal is short. It holds document slots (resume / cover letter / transcript / other) that you fill by picking from your Handshake document library or uploading a file of 1 MB or less. Below that come US work-authorization radios, optional yes/no "Screening Questions", and, for Greenhouse-integrated employers, Greenhouse custom/EEOC/demographic questions shown inside Handshake. "Apply externally" jobs use the same modal, and then "Step 2: External Application" opens the employer site. Most profile data (name, email, education) is sent automatically, so a text-field autofill has little to fill. The real work is picking documents and answering radio questions. Live DOM was not verified (login required). Route names, `data-hook` values, the 1 MB limit, question types and UI strings were verified from Handshake's public production JS bundle.
> Difficulty: **medium**. The flow is simple, but there is little open-source coverage, `data-hook` attributes are the only stable anchors (classes are styled-components hashes), and you cannot test without a student account.
> Last researched: 2026-10-04. Live checks while signed in: 2026-10-09 (see "Live findings" below)

## 1. Detection

| Signal | Value | Marker |
|---|---|---|
| Hosts | `app.joinhandshake.com`, school subdomains `<school>.joinhandshake.com` (e.g. `umich.joinhandshake.com/jobs/<id>` → 302 to that subdomain's `/login`). UK/EU: `joinhandshake.co.uk` (marketing/ToS), app hosts unconfirmed | [verified-live] [1] |
| Job routes (React router, current bundle) | `/job-search/:jobId`, `/job-search-new/:jobId`, `/jobs/:jobId`, plus list routes `/job-search`, `/jobs-home`, `/jobs-collections` | [verified-live] [2] |
| Legacy student routes | `/stu/jobs/<id>`, `/stu/postings?...` (2019-2025 scrapers), `/postings?...`, `/stu/applications`, `/stu/saved_jobs` | [verified-live] [2] (route strings), [code] [5][6][7][10] |
| URL regex | `^https://(?:app\|[a-z0-9-]+)\.joinhandshake\.com/(?:stu/)?(?:jobs\|job-search(?:-new)?)/(\d+)` | [verified-live] [1][2] (inferred combined regex) |
| Path change | 2026: `/job_search/` → `/job-search/` (old underscore path 404s) | [code] [4] |
| Logged-out | `/jobs/<id>`, `/stu/jobs/<id>` → 302 `/login` → 302 `/access`. `/job-search/*` with curl → **403 Cloudflare managed challenge** ("Just a moment...") | [verified-live] [1] |
| App shell meta | `<meta name="frontend-configuration-app_url" content="https://app.joinhandshake.com">`, `frontend-configuration-cdn_url` = `https://handshake-production-cdn.joinhandshake.com`, `frontend-configuration-marketplace_instance` (`NA`), `csrf-param` `authenticity_token` (Rails) | [verified-live] [1] |
| Scripts | `handshake-production-cdn.joinhandshake.com/dist/consumer/{runtime,vendor,common,main,ConsumerRoot}.<hash>.js` (webpack, React, styled-components "rosetta" design system), plus legacy `turbolinks` | [verified-live] [1] |
| Apply modal | `[role="dialog"][data-dialog="true"]` containing `[data-hook="apply-modal-content"]` with a `<form>`. Heading "Apply to <Employer>". Accessible label "<title> application" | [code] [4]; `apply-modal-content` + strings [verified-live] [2][3] |
| Apply button labels | "Apply", "Quick apply", "Apply externally" (aria: "Apply for <title>", "Quick apply for <title>", "Apply externally for <title>"). Applied states: "Applied", "Applied on <date>", "Applied on employer's website" | [verified-live] [3] |

Suggested detection: host matches `*.joinhandshake.com`, path matches the job regex, and a `[data-hook="apply-modal-content"]` appears (MutationObserver). Act only after the user opens the modal.

## 2. Application flow

- **Login / SSO.** You must be logged in. `/login` leads to `/access`, where the user enters an email or picks a school. Many schools sign in through the school's SSO (SAML/CAS), and some through Handshake email+password or Apple ID (`data-hook="appleid-signin"` in the bundle). Login is out of scope for JobScript [verified-live] [1][2], [code] [5].
- **Eligibility gates (no modal):** the school can block applying ("Your school has restricted your ability to apply to this job"). Other gates are "applications don't open until <date>", "Applications have closed", and "can't apply to more than 1 job attached to the same interview" [verified-live] [3].
- **Apply types** (ApplyButton logic) [verified-live] [2][3]:
  - **Quick apply**: when the user is `quickApplyEligible`, documents come from the profile. One click may submit straight away without the modal, as bots observe "No modal / instant apply" [code] [4]. **JobScript must never click Quick apply itself.** Let the user do it.
  - **Apply**: opens the modal with document slots and questions, then "Submit Application".
  - **Apply externally**: opens the same modal with work auth, screening questions and "Additional Instructions" from the employer. The button reads **"Step 2: External Application"**, which records the apply and opens `externalUrl` in a new window ("Redirecting..."). Afterwards Handshake asks "Did you apply to this job?" (confirm or withdraw the external apply) [verified-live] [2][3].
  - An experimental "HAI quick apply" flow (`experiment-hai-quick-apply-flow`) exists [verified-live] [2].
- **Single page.** No steps or progress bar. The modal is one scrolling form. Its sections, in bundle component order: Documents (`Documents.tsx`/`Attachments.tsx`/`DocumentSearch.tsx`), US or EU work authorization (`USWorkAuthForm`/`EUWorkAuthForm`), Screening Questions, Greenhouse info and questions (`GreenhouseInfo`/`GreenhouseQuestions`), then Submit (`SubmitButton.tsx`) [verified-live] [2].
- **Submit** = button text "Submit Application". Validation errors show inline: "Please answer all required questions.", 'Please answer all required questions or select "Prefer not to answer".' Bots also report the toast "Make sure all required fields are filled out." [verified-live] [3], [code] [4]. **JobScript must not click Submit.**
- **Document approval.** Some schools require career-center approval of documents ("One or more of your documents requires approval from your career center before it's submitted"). Statuses: Pending / Approved / Changes suggested / Changes required / Exempt [verified-live] [3]. A new upload may sit as "pending", which delays the application.
- **Post-apply:** "Application submitted!" and an optional profile-autofill prompt ("Great! Now let's complete your profile…", `post-apply-autofill`). Withdraw is possible ("Withdraw application") [verified-live] [3].
- No "apply with LinkedIn/Indeed". No resume-parse-first step in the apply modal (Handshake does have a separate profile autofill from resume, outside the apply flow) [verified-live] [2].

## 3. Field structure

The only stable hooks are `data-hook` attributes. Class names are styled-components hashes (older ones looked like `style__pagination___XsvKe`, `sc-kopcfN`, and are **stale**) [code] [5][7].

| Item | Selector / identifier | Marker |
|---|---|---|
| Modal content | `[data-hook="apply-modal-content"]` > `form` | [verified-live] [2], [code] [4][6] |
| Close | `[data-hook="apply-modal-close-button"]` (aria "Cancel application") | [code] [4]; string [verified-live] [3] |
| Document slot | `fieldset` with heading `h3/h4` (e.g. "Resume", "Cover Letter", "Transcript") | [code] [4][5] |
| Document library search | `[data-hook="apply-modal-document-search"]` → combobox / `input[type=search]` → `[role=listbox] [role=option]` | [verified-live] [2], [code] [4] |
| File input | `input[type=file].rosetta-file__input[name="file-<DocumentTypeName>"]` (e.g. `file-Resume`), `maxFileSizeInMB: 1` | [verified-live] [2], [code] [4] |
| Work auth: authorized | `[data-hook="authorized-in-us-radio-group"]`. Label "Are you legally authorized to work in the United States?" | [verified-live] [2][3] |
| Work auth: sponsorship | `[data-hook="requires-visa-sponsorship-radio-group"]`. Label "Will you now or in the future require visa sponsorship?" | [verified-live] [2][3] |
| Work auth: decline | `input[name="declinedToAnswer"]` (checkbox "Prefer not to answer these questions") | [verified-live] [2][3], [code] [4] |
| Work auth heading | `[data-hook="work-auth-title"]` / `work-auth-subtitle`. "Work authorization (required)" or "(optional)" | [verified-live] [2][3] |
| EU / other country | select "Are you authorized to work in <country>?" (default "Choose option") | [verified-live] [3] |
| Screening questions | heading "Screening Questions". Each is a **Yes/No radio group** (values `yes`/`no`, label = question text), stored as `screeningQuestionResponses[<questionId>]` | [verified-live] [2][3] |
| Greenhouse questions | heading "Questions from <Employer>". `atsDetail.questions[]` with `questionType` ∈ ShortText, LongText, Boolean, SingleSelect, MultiSelect, MultiValueSingleSelect, MultiValueMultiSelect, Attachment, Info and `atsQuestionCategory` ∈ Custom, Eeoc, Demographic. Stored as `ats.questionResponses[<atsQuestionId>]`. Ids containing `freeForm` render as free text. Extra prompt: share education with Greenhouse (Yes/No) | [verified-live] [2][3] |
| Required docs text | "Applying requires a <documentType>" / "a few documents" | [verified-live] [3] |

Label attachment (from captured modal HTML): radio `input`s are visually hidden, and a `label[for=<id>]` with a styled div is the visible control. Group labels come from the `fieldset` legend/heading [code] [4]. Email, name and education are **not fields**. Handshake sends "Your email address", "Your first and last name", "Your education…" from the profile (shown in the Greenhouse access notice) [verified-live] [3]. EEO only appears in Greenhouse-integrated jobs (Eeoc/Demographic categories) [verified-live] [2].

## 4. Widgets

| Widget | Build | How to set | Marker |
|---|---|---|---|
| Radio (work auth, screening, Greenhouse boolean) | Rosetta radio, a native `input[type=radio]` that is visually hidden, plus a styled label | Click the `label[for]`. Clicking the input "does nothing in React". Check with `checked` / `aria-checked="true"`. Re-find the modal after uploads, because React re-renders it | [code] [4] |
| Checkbox | native `input[name=declinedToAnswer]` + label | click label | [code] [4] |
| Document picker | combobox search (`apply-modal-document-search`) + listbox options. Pre-populated with the default resume | Type part of the document name, wait ~1.5 s, then click the matching `[role=option]` | [code] [4] |
| Select (EU work auth, Greenhouse SingleSelect) | Rosetta select. Native vs custom is unverified. Older (2024) builds used `react-select` v1 (`.Select-arrow`, `.Select-menu-outer`, `#react-select-12--option-0`) | Unverified for 2026. For react-select: mousedown on control, then click option | [code] [5] (2024, likely stale) |
| Text / textarea (Greenhouse ShortText/LongText) | Rosetta input | Native value setter + `input`/`change` (inferred, standard React) | [unverified] |
| Multi-select (Greenhouse MultiSelect) | unknown | unknown | — |

Gotcha: Submit stays disabled while an uploaded file shows "Converting..." (the client polls every 5 s) [verified-live] [2][3], [code] [4].

## 5. Repeating sections

None in the apply modal. Work history and education live on the Handshake profile and go with the application automatically [verified-live] [3]. The profile editor (`/profiles/<id>`) is a separate surface and out of scope. Post-apply "profile autofill" from resume is an experiment (`experiment-autofill-post-apply`) [verified-live] [2].

## 6. Resume upload

- Each required document type gets a `fieldset` slot. The **resume slot is pre-filled** with the user's default or most recent public resume. To use another one, clear the slot first (Remove/Delete/Clear button), otherwise an upload can land in the next empty slot [code] [4].
- Options per slot: pick from the library (`apply-modal-document-search`, which queries `currentUser.documents(documentTypes, query)` / `suggestedDocuments { resumes, coverLetters, transcripts }`), **or** upload a new file. Upload label "Upload <name>", with "or" between the two choices [verified-live] [2][3].
- **File input:** native `input[type=file]` (`rosetta-file__input`, `name="file-<Type>"`, single file). The 1 MB limit is checked client-side: "File size should be less than 1 MB" [verified-live] [2][3]. Formats: PDF preferred, DOC/DOCX (school guides) [unverified] [13]. The bundle includes msword and pdf MIME types [verified-live] [2].
- Upload flow: the client uploads to S3 and calls the `JobDetails_CreateDocument(createDocumentInput, documentS3Key)` mutation. The status moves "Uploading..." → "Converting..." → ready. A new resume may get "Make this resume visible on my profile" / "Set as default resume" toggles and a "Resume visibility" modal [verified-live] [2][3].
- DataTransfer approach: since the input is native and React reads `onChange` `e.target.files`, setting `input.files` via `DataTransfer` and dispatching a bubbling `change` should work [unverified] (inferred). Selenium `send_keys` on it works per [code] [4].
- Transcripts usually come from the school or SIS, or are uploaded PDFs. Career-center approval may apply to new uploads [verified-live] [3].
- Prefer **selecting an existing library document** over uploading. It avoids approval delays and duplicate documents.

## 7. iframes / shadow DOM

- No iframes or shadow roots were found in the apply flow. Everything is light-DOM React on the same `*.joinhandshake.com` origin [code] [4] (inferred from the absence of evidence; not live-verified).
- Host permissions: `https://app.joinhandshake.com/*` **and** `https://*.joinhandshake.com/*` (school subdomains). `all_frames` is not needed.
- SPA: job-to-job navigation is client-side (React router). Clicking cards in the search split view does not always refresh the details pane, so bots navigate to `/job-search/<id>` directly [code] [4]. Watch for the modal with a MutationObserver.
- Cloudflare bot management is on the app domain (403 challenge to non-browser clients) [verified-live] [1]. This does not affect an in-browser content script.

## 8. Job / requisition ID

| Source | Regex / location | Marker |
|---|---|---|
| URL | `/(?:stu/)?(?:jobs\|job-search(?:-new)?)/(\d+)` | [verified-live] [2], [code] [4] |
| Search list links | `a[href*="/job-search/"]`, `a[href*="/jobs/"]`. Cards `[data-hook="job-result"]`, `[data-testid="job-card"]` (2026), older `a[id^="posting"]`, `[data-hook="jobs-card"]` | [code] [4][5][6] |
| Details pane | `[data-hook="job-details"]`, title `[data-hook="job-title"]`, employer link `a[href*="/employers/"]` | [code] [4] |
| GraphQL | job `id` (numeric string) used as `jobId` in `StartApplyFlowTracking` and the apply mutation | [verified-live] [2] |
| Legacy REST | `/api/v0/jobs` and mobile `/mobile/v1|v2/...` (career fairs) | [code] [8][9] |

IDs are numeric, about 7-9 digits (e.g. a placeholder `/job-search/12345678`). The employer's own requisition ID is not shown in a fixed place. It can appear in the description text.

## 9. Automation restrictions

- **Handshake ToS** (https://joinhandshake.com/tos, last updated 2025-07-22) [docs] [11]: it does not permit bulk collection "through the use of automated scripts ("scraping")". "Creating accounts through unauthorized means, including scripts, bots, or automated crawlers is prohibited". The ToS has **no explicit clause on automating job applications** or third-party apply tools (checked; nothing found).
- **School-level student terms** (vary by school): accounts are for the owner's personal use. Letting someone else use the account to apply "may" lead to a permanent bar [unverified] [12] (one school's PDF, quoted via search).
- **Anti-bot:** Cloudflare managed challenge on `app.joinhandshake.com/job-search` for non-browser clients [verified-live] [1]. The apply flow fires tracking events (`opened-application-modal`, `job_application_start`, `applications-modal-submit-click`, `StartApplyFlowTracking`) [verified-live] [2], so bulk applying is easy to spot. I found no public reports of bans for auto-apply on Handshake.
- **Career-center visibility:** schools see student applications and can restrict applying. Mass auto-apply could draw action from the school as well as from Handshake [verified-live] [3] (restriction strings), [unverified] (consequences inferred).
- **JobScript stance:** filling the open modal (choosing documents, answering radios the user has pre-approved) without clicking Apply, Quick apply, Submit or Step 2 is user-assisted autofill. It does not scrape and does not create accounts. The bots in [4][5][6] run whole search loops and submit, which is a different category. Keep Handshake opt-in.

## Live findings (2026-10-09, signed in)

- **Job pages.** `/job-search/<id>` is a split view: the page's first `h1` is "Jobs", results are on the left, and the open job is in `[data-hook="right-content"]`. `/jobs/<id>` wraps the job in `[data-hook="job-details-page"]`. Neither has `job-details` or `job-description` hooks. The job's `h1` is inside a link to `/jobs/<id>`; the first `a[href^="/e/"]` is the logo with no text. Sections are found by their `h3`: "At a glance" (pay such as "$35/hr", "Onsite, based in San Jose, CA"), "Job description", "What they're looking for", "What this job offers", "About the employer", then "Similar Jobs". The page title is "Title | Company | Handshake" on `/jobs/<id>`, "Jobs | Handshake" in the split view. JobScript reads the pane from "At a glance" up to "Similar Jobs" (`lib/jobDetect.js`).
- **Cut-short description.** Only the first lines of the description are in the page until the "More" button (`aria-label` starting "Show more") is pressed. It expands in place; nothing loads but an analytics ping. The Job tab presses it once per button (`content/jobtab.js`).
- **Apply dialog (read 2026-10-10).** `[role=dialog].rosetta-dialog__sheet`, `aria-labelledby` an h2 "Apply to <Company>". Inside `[data-hook="apply-modal-content"]`, one `fieldset` per document, labelled by an h4 "Attach your resume" / "Attach your cover letter" (and the same for a transcript or other document). An attached document is a `[role=status].rosetta-inline-alert` with the file name in an `h5`, "Preview document", for resumes a "Set as default resume" checkbox (`name=makeNewResumePublic`), and an × `button[aria-label="Close"]` that takes it off the application (it stays in your documents). Without one: `[data-hook="apply-modal-document-search"]` with an `input[role=combobox][type=search]` ("Search your resumes") whose `[role=listbox]` of `[role=option]` documents is `hidden` until you type (repeated names get " (1)", " (2)"), then "or" and an "Upload new" `input[type=file][name="file-Resume"]` (`file-<Type>`), "Max file size: 1 MB". An empty required section shows "Please enter a valid response", and the dialog "Make sure all required fields are filled out." The job's own resume and cover letter were preselected. What an upload looks like while it runs was not seen. JobScript fills each section (`attachToDocumentLibrary` in `content/autofill.js`; mock in `dev/fixtures/handshake-apply.html`) and never presses Submit.

## 10. Sources

1. Live HTTP checks 2026-10-04: `https://app.joinhandshake.com/jobs/9000001` → 302 `/login` → 302 `/access`. `https://umich.joinhandshake.com/jobs/9000001` → 302 `umich…/login`. `https://app.joinhandshake.com/job-search/9000001` → 403 Cloudflare challenge. `/access` HTML meta + script list. **[verified-live]**
2. Handshake production bundles from `https://handshake-production-cdn.joinhandshake.com/dist/consumer/` (`ConsumerRoot.bf05e48857956f42.js` routes, lazy chunks for `/job-search/:jobId` incl. `35084.*.js`). Source paths `src/components/job-details/sections/job-controls/apply-modal/*.tsx`, `data-hook`s, GraphQL fragments, `maxFileSizeInMB:1`, `name: file-${name}`, question types. **[verified-live]** (fetched today. Proprietary code, read only, nothing copied)
3. Same CDN, locale chunks `73553.8d6a2ada9f6ce8db.js` (apply-modal en-US strings) and `62408.24a6c3fe7b361b2c.js` (job-controls strings: Apply / Quick apply / Apply externally / Applied…). **[verified-live]**
4. https://github.com/AdityaShah123/handshake_auto_apply (`HANDSHAKE_AUTOMATION.md`, `modules/handshake_apply.py`, Sept 2026). Selenium Quick Apply bot. Modal selectors from captured HTML, label-click radios, prefilled resume slot, "Converting…", `/job-search/` path change. **[code]** no license (also contains its author's personal data, which was not reproduced)
5. https://github.com/Pernell43/HandShake-QuickApply-Bot (`AutomatedHandshake.py`, 2024-09). SSO login via `#sso-name`, `data-hook` `search-results` / `apply-modal-content` / `submit-application`, `react-select` v1 dropdowns, `/stu/postings`. **[code]** no license. Classes stale
6. https://github.com/KonstantinTheRed/HandshakeScraper (2024-07). `data-hook` `jobs-card`, `search-pagination-next`, `apply-modal-content`, `submit-application`, `/stu/postings`. **[code]** no license
7. https://github.com/1tzkaos/handshake-Scraper (2025-02). Hashed `sc-*` classes (stale), `data-hook="search-pagination-next"`. **[code]** no license
8. https://github.com/Kondwanilp/Bio-Internship-Parsar (`scrapers/handshake.py`, 2026-05). `/jobs/{id}`, `/api/v0/jobs`. **[code]** no license
9. https://github.com/Windows81/Handshake-at-Stake (2025-02). Mobile API `/mobile/v1|v2/...`. **[code]** GPL-3.0
10. https://github.com/khangly/handshook (2019). `/postings`, `/users/<id>/documents`. **[code]** no license, stale
11. https://joinhandshake.com/tos (Terms of Service, last updated 2025-07-22). **[docs]**
12. https://www.uwsuper.edu/wp-content/uploads/Handshake-Terms-and-Conditions-for-Students-and-Alumni.pdf (school-specific student terms, seen via search snippet only). **[unverified]**
13. https://support.joinhandshake.com/hc/en-us/articles/218692648 (Handshake help on uploading documents; 403 to fetch, content seen via search snippet: 1 MB, PDF/DOC/DOCX, approval up to 3 business days) and https://career.fiu.edu/resources/applying-to-internship-and-job-postings-in-handshake/ . **[unverified]**

## Open questions

- The live modal DOM for 2026: does `[role=dialog][data-dialog=true]` still wrap it? Rosetta select markup (native vs custom) and the multi-select widget are unknown.
- Does a `DataTransfer` file assignment + `change` on `input[name^="file-"]` trigger Handshake's upload (S3 + CreateDocument) the same way as a user pick?
- Does Quick apply ever open a modal, or does it always submit at once? Bots saw both. JobScript must not click it either way.
- How are Greenhouse-integrated questions rendered (labels, ids)? Only the data model is known.
- Which school subdomains are still in use vs fully migrated to `app.joinhandshake.com`, and do non-US instances use other hosts (`marketplace_instance` ≠ NA)?
- Does Handshake detect extension DOM writes, and are there any reports of accounts suspended for auto-apply? None found.
