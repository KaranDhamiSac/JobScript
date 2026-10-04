# iCIMS

> Summary: The iCIMS apply form is server-rendered HTML (jQuery + iCIMS scripts, no SPA) inside `iframe#icims_content_iframe` on `*.icims.com`. Each step (email/consent, candidate profile, questions, EEO, submit) is a full page load inside that frame. The adapter has to run in that frame (`all_frames`, host permission `*.icims.com`). It must also handle iCIMS's custom dropdown (a hidden native `<select>` plus a fake `<a>`/`<ul>` list), work and education sections that are pre-rendered but hidden, and a resume upload that submits the page and re-parses everything on its own. Login is email-first with a GDPR checkbox and invisible hCaptcha. Most tenants also make the candidate set a password on the profile page, which JobScript must leave to the user. Field names are stable (`PersonProfileFields.*`, `CandProfileFields.*`, `rcfNNNN`) but custom questions are per-tenant `rcf` numbers. Difficulty: **high** (iframe, multi-page, resume reflow, captcha, tenant variance).
> Last researched: 2026-10-04

## 1. Detection

**Hostnames / URL regexes**

| Case | Pattern | Evidence |
|---|---|---|
| Classic portal (job page) | `^https://([a-z0-9-]+)\.icims\.com/jobs/(\d+)/[^/]+/job` | [verified-live] [S1] |
| Search page | `^https://[a-z0-9-]+\.icims\.com/jobs/search` | [verified-live] [S1] |
| Login / email step | `^https://[a-z0-9-]+\.icims\.com/jobs/(\d+)/[^/]+/login` (also `/jobs/(\d+)/login` without slug) | [verified-live] [S2], [S5] |
| Apply entry link | `.../job?mode=apply&apply=yes&in_iframe=1&hashed=-NNN` | [verified-live] [S1] |
| Candidate profile step | `.../jobs/(\d+)/[^/]+/candidate?from=login&...` (`&uploadResume=1` after resume upload) | [code] [S12], [unverified] tracker URLs in public repos [S13] |
| Shared iCIMS account sign-in | `login.icims.com` (username page, then password page) | [code] [S8] |
| Frame-content URL | any of the above with `in_iframe=1` | [verified-live] [S1] |

- Subdomain conventions: `careers-<tenant>`, `uscareers-<tenant>`, `technicalcareers-<tenant>`, `campus-<tenant>`, `intranet-<tenant>`, `<tenant>`. The tenant's admin host is `<tenant>.icims.com` (seen in `og:image` `.../icims2/servlet/icims2?module=AppInert...`). [verified-live] [S1]; `careers-pepsico.icims.com` redirected to `uscareers-pepsico.icims.com` [verified-live] [S5]
- Suggested detection regex: `/^([a-z0-9-]+)\.icims\.com$/` on the frame's hostname, plus a path check for `^/jobs/`.
- **Custom/branded domains:** the employer page (e.g. `careers.<company>.com` or a Jibe-hosted site) wraps an `<iframe id="icims_content_iframe" name="icims_content_iframe" src="https://careers-x.icims.com/...?...in_iframe=1">`. The iframe is created by script inside `<span id="icims_iframe_span">`. A `<noscript>` copy uses `id="noscript_icims_content_iframe"`. [verified-live] [S1]
- **iCIMS Career Sites / Jibe (iCIMS Attract)** front ends: branded hosts (e.g. `careers.costco.com`) that load `app.jibecdn.com/prod/...` and `assets.jibecdn.com/prod/<client>/...` and set `window._jibe = {cid: ...}`. The job page is `/jobs/<reqId>?lang=en-us`. **Apply leaves Jibe** for the classic portal: the public `/api/jobs` JSON gives `apply_url: https://careers-<client>.icims.com/jobs/<id>/login` and `ats_code: "icims"`. [verified-live] [S3] Jibe sites can also wrap the iframe themselves (a 2023 Wipro page had `window._jibe` plus `icims_content_iframe`). [code] [S13]

**DOM signatures (inside the frame)**

- `div.iCIMS_MainWrapper` (with classes `iCIMS_JobPage`, `iCIMS_Desktop`, ...), `.iCIMS_Header`, `.iCIMS_JobContent`, `.iCIMS_JobHeaderTag`, `a.iCIMS_ApplyOnlineButton`, `.iCIMS_PrimaryButton`, `form#enterEmailForm.iCIMS_SignIn`, `form#profileForm`. [verified-live] [S1][S2]; `profileForm` [code] [S13]
- Field rows: `div.iCIMS_TableRow.iCIMS_FieldRow_<fieldName>`, `.iCIMS_InfoField` (label cell), `.iCIMS_InfoData` (control cell). [code] [S13]
- Scripts (versioned path): `cdn02.icims.com/a/images.icims.com/content/platform_<ver>/script/common/icims.js`, `.../script/icims.application.js`, `.../script/common/icimsDropdown.js`, `.../script/portal/login.js`, `.../script/portal/gdpr.js`, `.../script/portal/field.js`. Version seen today: `platform_183.7.1.260925-...`. [verified-live] [S2]
- Meta: `og:site_name` = "<Company> Career Portal". The meta keywords contain `iCIMS`. `<meta http-equiv="Refresh" content="0;URL=/jsDisabledError.jsp">` sits inside a noscript. [verified-live] [S1]
- Parent page: `#icims_content_iframe` and the `icims_handlePostMessage` listener (it accepts only `event.origin` containing `icims.com`). [verified-live] [S1]

## 2. Application flow

Multi-step, server-rendered. Every step is a **full page load inside the iframe**, with a form POST to the next URL. There is no SPA routing. The parent page's URL is updated through `parent.updateUrl()` / `history.replaceState` when it is same-origin. [verified-live] [S1]

1. **Job page** `.../job` → "Apply for this job online" (`a.iCIMS_ApplyOnlineButton`, href `?mode=apply&apply=yes&in_iframe=1&hashed=...`). [verified-live] [S1]
2. **Enter Your Information (email-first)**: this redirected to `.../login?in_iframe=1`. It is `form#enterEmailForm.iCIMS_SignIn` POSTing to `.../login?step=email&in_iframe=1&hashed=...`. Fields: `input#email[name=css_loginName][type=email][autocomplete=email]`, a GDPR consent `input#accept_gdpr[name=accept_gdpr]` (label "I agree", `aria-required=true`) and the submit `input#enterEmailSubmitButton[value=Next]`. An **invisible hCaptcha** is injected into this form (`div#h-captcha.h-captcha[data-size=invisible]`, plus a hidden captcha-token input). [verified-live] [S2]
3. Depending on the tenant and whether the email is known: an emailed one-time code ("verification code"), Google SSO, or the shared **`login.icims.com`** account (username page, then password page; one account works across all iCIMS employers). [code] [S7][S8], [unverified] login.js resource strings mention SSO and password reset [S2]
4. **Candidate Profile** (`.../candidate?from=login&csrf=...&hashed=...`): resume upload, contact info, address, education, work history, custom `rcf` questions. For new candidates it often includes **Login / Password / Password (Re-enter)** fields (`PersonProfileFields.Login`, `PersonProfileFields.Password`, `PersonProfileFields.Password_Confirm`). Submit button: `input#cp_form_submit_i[name=profileButton]`. There is also a "save" button `cp_form_save_i`, referenced in `icimsDisableSaveAndSubmitButtons(...)`. [code] [S13]
5. **Candidate Questions / Job Specific Questions** page(s), with text such as "Please answer the following questions". [code] [S9]
6. **EEO / voluntary self-identification** page (gender, race, veteran, disability), using `CandProfileFields.Gender/Race/Veteran/Disability` and some tenant `icims_f_*` names. [code] [S10]
7. Final submit → confirmation text like "Thank you for applying", "You are currently submitted to this job". [code] [S9]; `.iCIMS_ThankYou` [code] [S11]

- No visible progress bar was observed in the 2023 snapshot. The page header (`h1.iCIMS_Header`) names the step. [code] [S13]
- "Apply with Indeed / LinkedIn" icons exist on the profile page (`indeed-icon.svg` asset, LinkedIn resource strings). iCIMS's 2025 "Apply Network" also lets candidates apply on Indeed (LinkedIn "coming soon") without visiting the portal. [code] [S13], [docs] [S15]
- iCIMS is also rolling out a conversational/"Digital Assistant" chat apply (2026). Tenants using it will not show the classic form. [docs] [S15]
- **JobScript implication:** the adapter fills only the current page. The user clicks Next/Submit. After each full reload the content script runs again in the frame (`document_idle`), so "Fill" must be re-triggered or auto-offered on each step. Learn mode's step recording fits this well.

## 3. Field structure

- **Label attachment:** a `<label for="<id>">` sits in a sibling cell (`.iCIMS_InfoField`) next to the control cell (`.iCIMS_InfoData`) inside `div.iCIMS_TableRow`. Label ids are `label_<fieldName>`. **Required** marker: `<span class="Field_Required"><span class="Field_RequiredStar">* </span></span>`, plus `aria-required="true"`, a nonstandard `i_required="true"` and the class `iCIMS_Forms_RequiredField` on the control. [code] [S13]
- **ids equal names.** They contain dots, so CSS needs escaping: `#PersonProfileFields\.FirstName`. `getElementById` is simpler.
- **Repeating-group prefix:** `-1_`, `-2_`, ... for collection rows (e.g. `-1_PersonProfileFields.AddressStreet1`). [code] [S13]
- **Field families:** `PersonProfileFields.*` (person-level), `CandProfileFields.*` (candidate-level: education, EEO, birth date, salary), `PortalProfileFields.*` (resume), `rcfNNNN` (tenant-defined custom fields, numbers vary by tenant). Work history is itself an `rcf` collection on many tenants (`rcf3212..rcf3219`, `rcf3268`). The numbers repeated across tenants in our sources (Wipro 2023, and BT's 2026 adapter on another tenant), which suggests iCIMS-default custom fields, but **do not hard-code rcf numbers**; match on labels. [code] [S9][S13]
- **Dates** are split into three controls: `<name>_Month` (select, class `iCIMS_Forms_MonthInput`), `<name>_Date` (select, `iCIMS_Forms_DayInput`) and `<name>_Year` (text, `iCIMS_Forms_YearInput`). [code] [S13]
- `autocomplete` attributes are present on some fields (`email` on the login page [verified-live], `tel-national` on the phone number [code] [S13]). Other recipes also key on `given-name`/`family-name`. [code] [S10]
- Hidden helper inputs: `portalLabel<Collection>-N` (collection labels). `dropdown-search` text inputs are part of the dropdown widget and must be skipped as standalone fields. [code] [S13]

**Standard fields (candidate profile; 2023 Wipro snapshot [S13] unless noted)**

| Profile field | name / id | Control |
|---|---|---|
| Resume | `PortalProfileFields.Resume_File` (file). Hidden: `PortalProfileFields.Resume`, `_FileName`, `_URL` | file, auto-submits form |
| Cover letter / extra doc | `rcfNNNN_File` (e.g. `rcf3145_File`) | file |
| Login / password (account creation) | `PersonProfileFields.Login`, `PersonProfileFields.Password`, `PersonProfileFields.Password_Confirm` | text / password. **JobScript must not fill these** |
| Salutation | `rcf2043` (tenant) | iCIMS dropdown |
| First / Middle / Last name | `PersonProfileFields.FirstName`, `.MiddleName`, `.LastName` | text |
| Preferred name | tenant `rcf` (e.g. `rcf2521`) | text |
| Email | `PersonProfileFields.Email` (type=email) | text |
| Phone type / number | `-1_PersonProfileFields.PhoneType` (select), `-1_PersonProfileFields.PhoneNumber` | select + text |
| Address type | `-1_PersonProfileFields.AddressType` | select |
| Street 1 / 2 | `-1_PersonProfileFields.AddressStreet1`, `-1_PersonProfileFields.AddressStreet2` | text (some tenants turn Street1 into an address-search dropdown [code] [S10]) |
| City | `-1_PersonProfileFields.AddressCity` | text |
| Country / State | `-1_PersonProfileFields.AddressCountry`, `-1_PersonProfileFields.AddressState` | iCIMS dropdown (State depends on Country) |
| Zip | `-1_PersonProfileFields.AddressZip` | text |
| Birth date | `CandProfileFields.BirthDate_Month/_Date/_Year` | split date |
| Source ("How did you hear") | tenant `rcf` (e.g. `rcf3048`, with a dependent `rcf3049` that has a `rcf3049_Text` search box) | AJAX dropdown |
| Education | `-N_CandProfileFields.Degree`, `.School`, `.Major`, `.Minor`, `.IsGraduated`, `.GraduationDate_*`, `.EducationCountry/State/City`, `.GPA` [S10], `.OtherSchool` [S10] | School/Major are AJAX dropdowns |
| Work history | `-N_PersonProfileFields.rcf3212` Employer, `rcf3213` Title, `rcf3216` City, `rcf3217` State, `rcf3218` Country, `rcf3214_*` Start, `rcf3215_*` End, `rcf3219` Description, `rcf3268` Reason for leaving, `rcf3269` May we contact [S9] | mixed |
| Salary | `CandProfileFields.Salary`, `_Currency`, `_Timeframe` | text + selects |
| Work authorization / sponsorship | tenant `rcf` selects | dropdown |
| EEO | `CandProfileFields.Gender`, `.Race`, `.Veteran`, `.Disability` (some tenants: `icims_f_Gender`, `icims_f_Race`, `icims_f_Veteran`, `icims_f_Disability` radios) | select/radio [code] [S10] |

Older/other templates seen in recipes: `icims_f_firstName`, `icims_f_lastName`, `icims_f_email`, `icims_f_curStreet`, `icims_f_curCity`, `icims_f_curState`, `icims_f_curZip`, `icims_f_mobilePhone`, `icims_f_homePhone`, `icims_<N>_School`, `icims_<N>_emplName`. [code] [S10]. These look like legacy or custom-form names (undated). Treat them as fallbacks.

- Section containers: `div.iCIMS_CollectionContainer` with `fieldset.iCIMS_CollectionGroup` and `<legend><span class="iCIMS_LabelText">` holding the group label (e.g. "Addresses", "Education"). Use the legend text for section context (education vs work). [code] [S13]

## 4. Widgets

**iCIMS dropdown (`icimsDropdown.js`)** [verified-live script S4]; markup [code] [S13]
- The real `<select id="X">` stays in the DOM but is hidden. The script adds `a.dropdown-select#X_icimsDropdown` (fake select, keyboard and toggle), `div.dropdown-container#X_icimsDropdown_ctnr`, a search box `input.dropdown-search` and `ul#X_dropdown-results.dropdown-results[role=listbox]` with `li.dropdown-result.result-selectable[role=option][dropdown-index=N][title="<text>"]`. The `-1` entry is the placeholder "— Make a Selection —", which has value `-999`.
- Selection path: a click on the `ul` is delegated and calls `optionSelected(word)` → `updateSelected` (sets `list.selectedIndex`), then the `onchange(list, word)` callback, then `onchangefinished()`. Dependent fields (Country → State) are driven by these callbacks.
- **Static dropdowns** (all options in the native select): option `<li>`s are pre-rendered even while the list is closed, so a direct `li.click()` works. [code] [S7] Setting `select.value` alone updates what gets POSTed but **not** the visible fake label and not dependent fields. So prefer clicking the `li`, or set the value, dispatch `change`, and refresh.
- **AJAX dropdowns** (School, Major, Source "specify further", sometimes address search): the native select has only 1 option (`options.length === 1`), so assigning a value cannot work. Results load on `keyup` in the search box when the text differs from the last query. One recipe reports that synthetic `input`/`keyup`/`KeyboardEvent` did **not** filter and real keystrokes were needed. [code] [S7] Another recipe types into the search input and then clicks the `li` by `title`. [code] [S10] The two disagree; needs live testing.
- Native `<select>`s without the iCIMS wrapper (e.g. salary currency with class `form-control`) accept `.value` plus `input`/`change`. [code] [S7]

**Text inputs/textarea**: plain inputs. Many have inline `onchange="pageDirtyFlag=true; ..."` handlers. Setting `.value` and dispatching `input`/`change` (bubbling) is enough. There is no React. [code] [S7][S13]

**Radios/checkboxes**: native inputs (e.g. EEO `icims_f_Gender` radio by `value`). [code] [S10]

**Dates**: split month/day selects plus a year text box (see §3). Month option values are not confirmed. Match on option text.

**Gotchas**
- `aria-required="true"` empty-check audit: a clean profile page still shows Password, Password (Re-enter) and a captcha field as empty required fields. [code] [S7]
- Inline `onchange` handlers set `pageDirtyFlag`, and leaving the page shows an "unsaved changes" prompt. The resume input explicitly sets `onbeforeunload = null` before submitting.

## 5. Repeating sections

- Collections (Phones, Addresses, Education, Work history) are **pre-rendered hidden** groups `-1`, `-2`, ... . "Add More (Phones)" is `a#PersonProfileFields.PhonesButton_-1[role=button]` with `onclick="showGroup('PersonProfileFields.Phones','-1','-2',2,'recruit')"`, and it reveals the next hidden group. No server round-trip is needed. [code] [S13] Container classes are `PersonProfileFields.Addresses-1-Container` and similar. Button rows are `div.iCIMS_CollectionButtonsRow` (hidden ones have `iCIMS_NoDisplay`). [code] [S10][S13]
- Index mapping: entry *k* (0-based) → prefix `-(k+1)_`. Before filling entry *k*, click the "Add More" link in the last visible `iCIMS_CollectionButtonsRow` of that container, then wait for the `-(k+1)_` fields to become visible. [code] [S10]
- Remove links exist ("Remove", 3 occurrences in the snapshot). Their exact selector is not captured.
- Edits happen in place. There are no modals.
- **Resume parsing collides with autofill:** uploading a resume submits the page (`&uploadResume=1`), re-parses the file and **re-renders the whole form**. That wipes typed values (address, zip, education, screener dropdowns) and rebuilds work-experience blocks from the parsed text. **Order: upload the resume first, wait for reload, then fill.** [code] [S7][S13]

## 6. Resume upload

- `input[type=file]#PortalProfileFields.Resume_File` sits inside `div#PortalProfileFields.Resume_Content`. It has `tabindex=-1` and is visually hidden behind a "My Computer" button block. Another source is "Google Drive" (`button.iCIMS_googleDriveButton`, popup), and an Indeed icon asset is present. [code] [S13]
- Its inline `onchange` calls `icims_setFileFieldValue('PortalProfileFields.Resume', ...)` and then appends `&uploadResume=1` to `form.action` and calls `this.form.submit()`. **A `change` event triggers an immediate full-page submit and parse.** [code] [S13]
- DataTransfer approach: construct the `DataTransfer`/`File` **in the iframe's realm** (content script running in the frame is fine), assign `input.files`, then dispatch `input` and `change` (bubbling). Skipping `change` leaves the file client-side only, and the server answers "Please upload your resume (Max size: 5 MB): required". [code] [S7]
- Max size: 5 MB, per that error string. [code] [S7] Accepted types: not captured. [unverified]
- If a resume is already on file, buttons "Replace Resume" / "Upload New Resume" appear before the input shows up. [code] [S9]
- Cover letter and other docs are separate `rcfNNNN_File` inputs with the same `_File/_FileName/_URL` pattern. [code] [S13]

## 7. iframes / shadow DOM

- The form always lives in `iframe#icims_content_iframe` (`name=icims_content_iframe`, `title="iCIMS Content iFrame"`), on the tenant's `*.icims.com` origin. It is **cross-origin** whenever the wrapper is on a company domain. [verified-live] [S1]
- **Content script:** needs `all_frames: true` (JobScript already uses it) and a match / host permission for `https://*.icims.com/*`. The current manifest has only Greenhouse/Lever hosts plus the optional `https://*/*`. Add `*.icims.com` to the matches, or inject on demand with `scripting.executeScript({allFrames:true})` after the optional permission is granted. The top-frame panel cannot read the iframe DOM, so the panel either runs in the frame or talks to it through `chrome.runtime` messaging.
- **Same-origin wrapper (`careers-x.icims.com/jobs/...` without `in_iframe`):** the frame page checks `window.top.location`. If the top URL has `in_iframe=1`, it **redirects the top window** to the stripped URL, so opening `?in_iframe=1` directly as a top-level page bounces back to the wrapper. If top is cross-origin, the check throws and is skipped. [verified-live] [S1]. A bot author reports the same. [code] [S8]
- The frame posts `{height}`, `{pageTitle}` and scroll `{x,y}` to the parent via `postMessage`. The wrapper resizes the iframe and calls `top.scrollTo` (not relevant to filling). [verified-live] [S1]
- Cookies are `JSESSIONID ... SameSite=None; Secure`. In a third-party iframe, browsers that block third-party cookies may break the session. That would be a user-facing issue, not an adapter one. [verified-live headers]; impact [unverified, inferred]
- No `X-Frame-Options`/CSP `frame-ancestors` was sent on the frame pages tested. [verified-live]
- Shadow DOM: none observed. [verified-live]

## 8. Job / requisition ID

| Source | Example / regex | Evidence |
|---|---|---|
| URL path (system id) | `/jobs/(\d+)(?:/[^/?#]+)?/(?:job\|login\|candidate)` → `75314` | [verified-live] [S1] |
| Header "ID" display (req number) | `.iCIMS_JobHeaderTag` with label "ID" and value `2026-75314` → `/^(\d{4})-(\d+)$/` (year prefix + system id) | [verified-live] [S1] |
| JSON-LD | `<script type="application/ld+json">` `JobPosting` in the **frame** page (`title`, `datePosted`, `validThrough`, `hiringOrganization`, `jobLocation`, `url`, `directApply: true`). It has no `identifier`, so take the id from `url` | [verified-live] [S1] |
| Meta | `og:url` = `.../jobs/<id>/<slug>/job?mobile=true&needsRedirect=false` | [verified-live] [S1] |
| Jibe JSON | `GET https://<jibe-host>/api/jobs?page=1&limit=N` → `jobs[].data.req_id`, `slug`, `apply_url` | [verified-live] [S3] |
| iCIMS API | Job Portal API `GET /customers/{customerId}/search/portals/{portalIdOrName}` (partner credentials; not usable by an extension) | [docs/forum] [S16] |

## 9. Automation restrictions

- iCIMS website Terms of Use (covers icims.com, not necessarily each customer portal): users may not "Use any robot, spider or other automatic device, process, or means to access the Website". [docs] [S14] The customer portals mostly link the **employer's** own terms and privacy pages instead. [verified-live] [S1]
- Anti-bot: **invisible hCaptcha** on the email step (2026) [verified-live] [S2]. **reCAPTCHA Enterprise invisible** (`grecaptcha.enterprise.execute(..., {action:"candidateProfile"})`) on profile submit (2023 snapshot) [code] [S13]. A visible hCaptcha before "Submit Profile" is reported. [code] [S7] Email one-time codes on some tenants. [code] [S8]
- Rate limiting / CDN protection per domain is reported for scrapers. [unverified] [S17]
- JobScript fills fields in the user's own session and the user solves captchas and clicks Next/Submit. That stays clear of the captcha and OTP walls that auto-submit bots try to get around (the referenced bots stop at them for this reason). Never fill `Password`/`Password_Confirm`/`Login`, and never touch hCaptcha/reCAPTCHA elements or `g-recaptcha-response`.
- No account-ban reports specific to iCIMS were found. [unverified]

## 10. Sources

1. https://careers-gdms.icims.com/jobs/75314/advanced-software-engineer/job (and `?in_iframe=1`, `/jobs/search?ss=1&in_iframe=1`): [verified-live] wrapper and iframe creation, top-redirect script, postMessage, JSON-LD, apply link, header ID, CSS classes, meta tags.
2. https://careers-gdms.icims.com/jobs/75314/advanced-software-engineer/login?in_iframe=1 (reached via the apply link, GET only): [verified-live] `enterEmailForm`, `css_loginName`, `accept_gdpr`, invisible hCaptcha, script list, platform version.
3. https://careers.costco.com/api/jobs?page=1&limit=2 and https://careers.costco.com/jobs/67761?lang=en-us: [verified-live] Jibe front end signatures (`jibecdn`, `window._jibe`), `apply_url` to `careers-costco.icims.com/jobs/<id>/login`, `req_id`.
4. https://cdn02.icims.com/a/images.icims.com/content/platform_183.7.1.260925-90d88066668-11-0/script/common/icimsDropdown.js: [verified-live] dropdown DOM ids and classes, delegated click, keyup search, `optionSelected`/`updateSelected` logic.
5. https://uscareers-pepsico.icims.com/jobs/search?ss=1&in_iframe=1: [verified-live] alternate subdomain (`uscareers-`) and redirect.
6. Response headers of sources 1 and 2 (curl -D): [verified-live] no `X-Frame-Options`/`frame-ancestors`, `JSESSIONID` `SameSite=None; Secure`, `icimsCookiesEnabledCheck` cookie on `.icims.com`.
7. qwistaycat/claude-apply-skill `references/ats-recipes.md`: https://github.com/qwistaycat/claude-apply-skill (MIT): [code] upload resume first (form re-render), dispatch `change` on the file input, pre-rendered `li.dropdown-result`, AJAX dropdowns need real keystrokes, password and hCaptcha blockers, 5 MB message.
8. christopherdraper/linkedin-easy-apply `ats_handlers/icims.py`: https://github.com/christopherdraper/linkedin-easy-apply (no license): [code] content frame, `in_iframe=1` top-level redirect, shared `login.icims.com` account (dated 2026-09-30).
9. glinerosuarez/BT `job_hunter/apply/adapters/icims.py`: https://github.com/glinerosuarez/BT (no license): [code] step detection texts (Candidate Profile / Candidate Questions / Job Specific Questions), `rcf3214..3269` work-history names, Replace Resume buttons, hCaptcha detection, confirmation markers.
10. kensac/job-scripts `extension/adapters/recipes/ICIMS.json`: https://github.com/kensac/job-scripts (MIT): [code] selector recipes: `icims_f_*` ids, `CandProfileFields.*` EEO/education, `_icimsDropdown`/`dropdown-results` interaction, collection Add More paths, `PortalProfileFields.Resume_Content`.
11. maazin/Zipply `src/content/adapters/icims.ts`: https://github.com/maazin/Zipply (MIT): [code] detection and field-name suffix mapping, `.iCIMS_ThankYou` confirmation.
12. Jobright-derived site registry in fkabaalkhail/Applypilot `docs/superpowers/reference/jobright-site-registry.json`: https://github.com/fkabaalkhail/Applypilot (no license): [code] iCIMS treated as `iframeOnly`, path `^/jobs/\d+(?!.*/job$)`.
13. Shakil-Ahmed-Sk/Portfolio, a saved iCIMS "Candidate Profile" page (Wipro, Jibe wrapper, Dec 2023): https://github.com/Shakil-Ahmed-Sk/Portfolio/tree/HEAD/assets/images (GPL-3.0): [code] full candidate-profile form markup: field names/ids, label/required markup, collections and `showGroup`, resume `onchange` auto-submit, reCAPTCHA Enterprise. Only structure was read. The page contains a third party's data, which is not reproduced.
14. https://www.icims.com/legal/terms-of-use/: [docs] robot/spider clause.
15. https://www.icims.com/company/newsroom/winterrelease2025/ (search summary) and iCIMS release notes: [docs] Apply Network (Indeed/LinkedIn apply), conversational apply, Digital Assistant.
16. https://developer-community.icims.com/comment/2526 (search summary), https://developer.icims.com/: [docs] Job Portal API endpoints; partner-gated.
17. https://jobspipe.dev/sources/icims.md: [unverified] partner-only API, per-domain rate limiting and CDN protection, subdomain conventions.
18. Other adapters seen but not relied on: athervvidhate/avid-autofill (MIT), abhay-codes07/AI-powered-job-application-automation-chrome-extension (MIT), chiragdhunna/AutoVault (no license), feranicus/jobhuntwow.com `agent/flows/icims.py` (MIT; reports hCaptcha + email OTP + Google SSO on an Atlassian tenant), Masterjx9/OpenPostings (no license, scraper).

## Open questions

- Exact candidate-profile markup in **2026**: the full form structure here comes from a Dec 2023 snapshot plus 2026 bot code. Class names may have changed. Note that today's login page already differs: invisible hCaptcha instead of reCAPTCHA.
- Whether synthetic `keyup` on `input.dropdown-search` loads AJAX results. The sources disagree. Needs testing on a live profile page (requires a candidate email).
- Which tenants send an email OTP versus redirect to `login.icims.com` versus allow a passwordless profile. That depends on tenant config and whether the email is known.
- The selector for "Remove" in collections, and whether `showGroup` has a maximum count.
- The structure of the Questions and EEO pages (field naming beyond `CandProfileFields.*`/`icims_f_*`) and whether they use the same `iCIMS_TableRow` layout.
- Accepted resume file types. Whether the 5 MB limit is global or per tenant.
- Behavior of the new "Apply Flow" (`isApplyFlowJob` flag in Jibe JSON) and the conversational apply. Neither was observed.
- Whether the iframe session survives with third-party cookies blocked (Firefox ETP, Safari).
