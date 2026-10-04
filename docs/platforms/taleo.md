# Oracle Taleo (Enterprise) + Oracle Recruiting Cloud (ORC)

> Summary: **Taleo Enterprise** career sections (`<tenant>.taleo.net/careersection/...` or a custom domain serving `/careersection/`) are legacy server-rendered JSF/FTL pages. Applying needs a sign-in (username/password, or "Apply as Guest" / LinkedIn where the tenant allows it). It then runs as a multi-page flow (`flow.jsf`) with Save and Continue full-page postbacks, long auto-generated JSF ids (`et-ef-content-ftf-gp-j_id_id16pc9-page_N-...-dv_cs_<entity>_<Field>`), an optional resume-parse page first, and a 60-minute session timeout. Native inputs and selects make filling easy once the right page is detected, but ids change per page and per flow. Difficulty: **medium-high**.
> **ORC (Oracle Recruiting Cloud "Candidate Experience")**, where many Taleo customers have moved, is an Oracle JET + Knockout SPA at `<pod>.fa.<dc>.oraclecloud.com/hcmUI/CandidateExperience/...` (or a custom domain). It is email/phone-first with a 6-digit one-time code, has a **honeypot input**, uses custom `cx-select` pill and combobox widgets plus tile-based experience/education editors, and runs a configurable multi-section flow whose block list is readable as public JSON. Difficulty: **high**.
> Last researched: 2026-10-04

## 1. Detection

### Taleo Enterprise

| Case | Pattern | Evidence |
|---|---|---|
| Job detail | `^https://([a-z0-9-]+)\.taleo\.net/careersection/([^/]+)/jobdetail\.ftl\?(?=.*\bjob=([^&]+))` | [verified-live] [T1]; [docs] [T2] |
| Job search | `/careersection/<cs>/jobsearch\.ftl` (may redirect to `moresearch.ftl`) | [verified-live] [T1] |
| Apply entry | `/careersection/<cs>/jobapply\.ftl\?job=<id>&lang=<l>` | [docs] [T2]; [verified-live] [T3] |
| Login (IAM) | `/careersection/iam/accessmanagement/login\.jsf\?lang=..&redirectionURI=...` | [verified-live] [T3] |
| Application pages | `/careersection/application\.jss`, `/careersection/flow\.jsf` (also `/<cs>/...`) | [code] [T10] |
| Custom domain | any host serving `/careersection/<cs>/(jobdetail\|jobsearch\|jobapply)\.ftl` (e.g. `jobs.dubaicareers.ae`, `*.burnsmcd.com`, `talentacquisition.3ds.com`) | [verified-live] `jobs.dubaicareers.ae/careersection/ext/jobsearch.ftl` returned 200; [code] [T10] |
| Taleo Business Edition (different product) | `*.tbe.taleo.net/<code>/ats/careers/...` | [code] [T10]. Not researched further. [unverified] |

- `<cs>` (career section) is a number (`2`) or a code (`ex`, `ext`, `jobsearch`). [verified-live]
- DOM signatures: `form#ftlform[name=ftlform]` with hidden `ftlpageid` (e.g. `requisitionDescriptionPage`, `unavaibleRequisitionPage` [sic]), `ftlstate`, `ftlhistory`, `jsfCmdId`, `pSessionTimeout`, `pBeaconBeat`. Container ids `requisitionDescriptionInterface.*` (detail) and `requisitionListInterface.*` (search). [verified-live] [T1]
- Assets: `/careersection/<release>/js/ftlallc.js` (release string such as `2026PRD.1.4.14.3.0`), `/careersection/<release>/css/webcentric_jobboard.css`, `UIStyleSheet.dcss?styleSheet=FTLTaleo-1`. On the login page: `akira/pub/js/akira-corec.js`, `js/integration/iframes_communication.js`, `js/integration/candidate_data_handler.js`, `iam/js/iamuser.js`. [verified-live] [T1][T3]
- Application-page signature: element ids starting `et-ef-content-ftf-` (or `editTemplateMultipart-editForm-content-ftf-` on pages with file upload). [code] [T7][T8]
- An unavailable career section serves `<title>Career Section Unavailable</title>` (`#maintenanceTitle`). [verified-live] (`kp.taleo.net`, `capps.taleo.net`)

### ORC

| Case | Pattern | Evidence |
|---|---|---|
| Job detail | `^https://[a-z0-9-]+\.fa\.(?:[a-z0-9]+\.)?oraclecloud\.com/hcmUI/CandidateExperience/([a-z]{2}(?:-[A-Z]{2})?)/sites/([^/]+)/job/(\d+)` | [verified-live] [O1] |
| Apply steps | `.../sites/<site>/job/<id>/apply/email`, then `/apply/section/<n>` (and `/apply/pin`/verification, per [O8]) | [verified-live] `/apply/email` [O1]; [code] sections [O8] |
| Custom domain | e.g. `https://careers.oracle.com/en/sites/jobsearch/job/<id>` (no `/hcmUI/CandidateExperience` prefix; the app and REST still on the `oraclecloud.com` pod) | [verified-live] [O2] |
| Hosts | `*.fa.us2.oraclecloud.com`, `*.fa.ocs.oraclecloud.com` (e.g. `fa-xxxx-saasfaprod1.fa.ocs.oraclecloud.com`) | [verified-live] [O1]; [code] [O9] |

- Signatures: `<script src="https://static.oracle.com/cdn/fa/oj-hcm-ce/<ver>/js/main-minimal.js">`, `oj-redwood-min.css` from `static.oracle.com/cdn/jet/<ver>/`, `/hcmUI/CandExpStatic/css/ce-custom.css?...siteNumber=CX_...`, favicon `/hcmRestApi/CandidateExperience/siteFavicon/...?siteNumber=CX_NNN`. Site numbers look like `CX_1`, `CX_45001`, `CX_1001`. [verified-live] [O1]
- DOM: Knockout custom elements `apply-flow-header`, `quick-email-verification-form`, `legal-disclaimer`, `form-element-label`, `session-expire`, `oj-dialog`. Classes `.input-row`, `.apply-flow-*`. Many `[data-bind]` attributes. [verified-live] [O1]

## 2. Application flow

### Taleo Enterprise

1. **Job detail** (`jobdetail.ftl`): "Apply Online" buttons `#requisitionDescriptionInterface.UP_APPLY_ON_REQ.row1` and `#...BOTTOM_APPLY_ON_REQ.row1`. They are JS (`requisition_applyOnRequisition(...)`), not links. Navigating to `jobapply.ftl?job=<id>&lang=en` directly does the same. [verified-live] [T1][T3]
2. **Login** (`login.jsf`, form `#dialogTemplate-dialogForm`): `#dialogTemplate-dialogForm-login-name1` (User Name), `#dialogTemplate-dialogForm-login-password`, buttons `-login-defaultCmd` (Login), `-login-register` (New User) and `-login-guestapply` (**Apply as Guest**, if the tenant enables it). It loads the LinkedIn "apply-with-linkedin-widget-v3" script. No captcha was seen on this tenant. [verified-live] [T3]
   - Apply as Guest: email only. A candidate record is created and credentials are offered at the end, or later by an emailed access code. A returning email must sign in. Setting: "Allow new users to register in the system" = With Username / With Username and as Guest / No. [docs] [T4]
3. **Application flow** = a tenant-configured sequence of pages, each holding blocks. [docs] [T5] Blocks include: Resume Upload (must be alone on its page, **before** the personal info, education, work experience and attachments blocks; with Resume Parsing on, "upload to fill"), Candidate Personal Information, Basic Profile, Work Experience, Education, Certifications, References, Attachments, Cover Letter / Plain Text Resume, Prescreening Questionnaire, Disqualification Questions (alone on a page; can end the flow), Diversity (EEO1/EEO2a/EEO2b forms), Background Check blocks, Work Conditions / Shift Availability Grid (hourly), Job Sourcing Tracking, eSignature, then a review page and Thank You. [docs] [T5]
4. Navigation: **Save and Continue** (`#et-ef-content-ftf-saveContinueCmdBottom`) is a full-page JSF postback to the next page. The final page has `#et-ef-content-ftf-submitCmdBottom`. [code] [T8][T7] A progress bar can be configured. [docs] [T6]
5. Every submission updates the candidate's **general profile**, and later applications pre-fill from it ("Autofill After Initial Submission"). So returning users see values already in place. [docs] [T5]

### ORC

1. Job page → Apply → `/apply/email`: "You don't need to have an account." Fields: `input#primary-email-1[name=primary-email][type=email][autocomplete=email]`, a link to switch to phone ("communicate by phone instead"), `#legal-disclaimer-checkbox` (it opens a terms dialog with an **Agree** button), and **Next**/Cancel (`.apply-flow-pagination__button`). [verified-live] [O1]
2. A 6-digit one-time code is sent by email (or SMS). The code is entered as `#pin-code-1`…`#pin-code-6`. Five wrong attempts lock the user out for 30 minutes. Returning candidates may be asked to confirm a phone number on file. [docs] [O4][O5]; [code] six inputs [O7]; [verified-live] bundle registers `pin-code-verification`, `pin-form-element`, `apply-flow-pin-verification` [O3]
3. Multi-section flow, defined per requisition and readable without auth (with header `ora-irc-language: en`):
   `GET /hcmRestApi/resources/latest/recruitingCEApplyFlows?finder=findByRequisitionNumber;RequisitionNumber="<id>"&expand=sections.pages.blocks&onlyData=true` [verified-live] [O1]
   Example (Oracle's own flow "Oracle JSA External", today): **Personal Info** [ORA_PROFILE_IMPORT, ORA_NAME_CONTACT_INFO, ORA_ADDRESS] → **Experience** [ORA_EDUCATION, ORA_EXPERIENCE, ORA_LICENSE_CERTIFICATES, ORA_SKILL, ORA_DOCUMENTS, ORA_MISC_DOCUMENTS] → **More About You** [ORA_JA_EXTRA_INFO, ORA_DQ_QUESTIONS, ORA_DIVERSITY, ORA_VETERAN, ORA_DISABILITY] → **Summary** [ORA_SUMMARY]. Flags: `LegalEnabledFlag`, `EsignEnabledFlag`, `QuickApplyEnabledFlag`, `SingleClickApplyFlag`, `ProfileVersion`. [verified-live] [O1]
   An adapter can call this from the page origin to learn which sections exist before the user reaches them.
4. Navigation is **SPA route changes** (`/apply/section/<n>`) with "Next" (`.apply-flow-pagination__button.theme-color-1`). The final submit is `button.apply-flow-pagination__submit-button`. [code] [O7][O8] There is a draft-saving indicator (`apply-flow-draft-saving-indicator`) and a navigation train (`apply-flow-navigation-train`). [verified-live] bundle [O3]
5. **Profile import** (ORA_PROFILE_IMPORT): LinkedIn (provider `AWLI`), Indeed OAuth (`job_seeker.resume.read`), and `RESUME_PARSER` (inactive on Oracle's own site). `GET /hcmRestApi/resources/latest/recruitingCEProfileImportConfigs?onlyData=true`. [verified-live] [O1]
6. After submit the user is routed to `/sites/<site>/my-profile` ("Thank you for your job application"). [code] [O8]

## 3. Field structure

### Taleo Enterprise

- **Id grammar** (JSF, `:` mostly flattened to `-`): `et-ef-content-ftf-gp-j_id_id16pc9-page_<P>-<block>-<sub>-frm-dv_cs_<entity>_<Field>`, where
  - `et-ef` = editTemplate-editForm (`editTemplateMultipart-editForm-...` on upload pages, with `j_id_id16pc8`)
  - `page_<P>` = 0-based page index within the flow. **It shifts if the tenant reorders pages.**
  - block keys: `cpi-cfrmsub` (candidate personal info), `we-wei-<k>` (work experience entry k), `csef-efi-<k>` (education entry k), `careerSectionMultipleCustomForm-cfrm-cfrmsub` (custom/work conditions), `diversityBlock-...`, `preq-...` (prescreening), `eSignatureBlock-cfrmsub`, `shiftAvailabilityBlock`, `AttachedFilesBlock`
  - `dv_cs_<entity>_<Field>`: data-view field name. `UDF...` marks a user-defined field (`_32_` encodes a space, e.g. `UDFCandidatePersonalInfo_Preferred_32_Name`).
  - Some ids keep a colon (`...-we-wei-0-frm:dv_cs_experience_CurrentEmployer`), so use `getElementById`, not CSS. [code] [T7][T8]
- `j_id_id16pc9` is a JSF auto-id. It is identical across the two independent repos (2022 and 2023), which suggests a stable template, but treat it as volatile. **Match on the suffix `dv_cs_<entity>_<Field>`** (e.g. `[id$="dv_cs_candidate_personal_info_FirstName"]`) and use `page_\d+` only for scoping. [code] [T7][T8], inference [unverified]
- Labels: not captured from a live application page. Login-page labels use `label[for]` with ". Required" appended as hidden text ("User Name. Required"). [verified-live] [T3]
- Questions: prescreening radios have ids `...-qr_com.taleo.functionalcomponent.prescreening.entity.question.PossibleAnswer__<answerId>`. Diversity radios: `...-questionRadio_com.taleo.systemcomponent.question.entity.RegulationPossibleAnswer__<answerId>`. Answer ids are numeric and per tenant, so match on the label text. [code] [T8]

| Field | id suffix (`[id$=...]`) | Control | Source |
|---|---|---|---|
| First / Last name | `dv_cs_candidate_personal_info_FirstName`, `..._LastName` | text | [code] [T7][T8] |
| Preferred name (UDF) | `dv_cs_candidate_personal_info_UDFCandidatePersonalInfo_Preferred_32_Name` | text | [code] [T8] |
| Address / City / Zip | `..._Address`, `..._City`, `..._ZipCode` | text | [code] [T7] |
| Phones | `..._HomePhone`, `..._MobilePhone`, `..._PreferredPhone` (select) | text/select | [code] [T7] |
| Country / State / City (residence) | `..._ResidenceLocation-0`, `-1`, `-2` | cascading selects | [code] [T7][T8] |
| Work: employer / title / function | `dv_cs_experience_Employer`, `..._JobFunction`, `..._UDFExperience_JobTitleUDF`, `..._UDFExperience_Title` | text | [code] [T7] |
| Work: current job | `frm:dv_cs_experience_CurrentEmployer` | checkbox | [code] [T7] |
| Work: start / end | `dv_cs_experience_BeginDate.month`, `.year`; `..._EndDate.month`, `.year` | selects (month value is **0-based**) | [code] [T7] |
| Work: description | `dv_cs_experience_Responsibility` | textarea | [code] [T7] |
| Education | `dv_cs_education_Institution`, `_Program`, `_StudyLevel`, `_OtherInstitutionCity`, `_gpa`, `_gpaRange`, `_startDate`, `_graduationDate` | mixed | [code] [T7] |
| Work conditions (hourly) | `dv_cs_workcondition_HoursPerWeekWilling`, `_HoursPerWeekPreferred`, `_IsAvailableHolidays` | select | [code] [T8] |
| eSignature | `eSignatureBlock-cfrmsub-frm-dv_cs_esignature_FullName` | text | [code] [T8] |
| Resume upload | `AttachedFilesBlock-uploadedFile` (file), `AttachedFilesBlock-attachFileCommand` (button) | file + button | [code] [T8] |

### ORC

- Rows: `div.input-row` (`.input-row--text`, `--focused`, `--filled`, `--invalid`), with `label.input-row__label` (`--required`) bound via `<form-element-label params="element: element, forId: attributes.id">`. The control is `.input-row__control`, validation text is `.input-row__validation`. Ids follow `<name>-<n>` (e.g. `primary-email-1`, `honey-pot-0`). [verified-live] [O1]; numbering scheme [unverified, inferred]
- Field components in the bundle: `text-form-element`, `textarea-form-element`, `cx-select-form-element`, `cx-autosuggest-form-element`, `cx-datepicker-form-element`, `cx-phone-form-element`, `cx-multi-select-pill-form-element`, `checkbox-form-element`, `radio-form-element`, `file-form-element`, `pin-form-element`, `geo-hierarchy-*-form-element`, `masked-text-form-element`. [verified-live] bundle [O3]
- **Honeypot:** on the email step, `input#honey-pot-0[name=honey-pot][aria-label=honeypot][aria-hidden=true][tabindex=-1]` inside `div.input-row--invisible` (height 0, `overflow:hidden`). `offsetParent` is **non-null**, so naive visibility checks treat it as visible. **Never fill it.** JobScript's current skip of `aria-hidden="true"` + `tabIndex=-1` (content/autofill.js) already excludes it. Keep that rule and add an explicit `/honey-?pot/` block. [verified-live] [O1]; [code] [O7]
- Section data and metadata endpoints per block (all need a verified candidate session; 401 when anonymous): contact `recruitingCEContactInformationMetadata`, questions `recruitingCEQuestions?finder=RowFinder;RequisitionNumber=..`, EEO `recruitingCERegulatoryConfigs?...AFBlockCode=ORA_DIVERSITY|ORA_VETERAN`, disability `recruitingCESecuredRegulatoryConfigs`. [verified-live] [O1]
- Known ids from one bot: diversity `#IN-STANDARD-ORA_GENDER-STANDARD-7` (pattern `<country>-STANDARD-<code>-STANDARD-<n>`), DOB `#month-…`, `#day-…`, `#year-…` plus `-toggle-button`, e-signature `#fullName-5`. [code] [O8] (country- and index-dependent)

## 4. Widgets

### Taleo Enterprise
- Plain native `<input>`, `<select>`, `<textarea>`, checkbox and radio. Setting `.value` and dispatching `input` + `change` (bubbling) works. One extension did exactly this (2023). [code] [T7]
- **Cascading selects** (ResidenceLocation country → state → city) repopulate by AJAX after `change`. Wait about 1 s (the example waited 800 ms) before setting the child. [code] [T7]
- Dates are split month and year selects (`.month` 0-based, `.year`). [code] [T7]
- Some tenants use Taleo "selector" popups (lookup lists) for fields like institution or program. The block property "For selection fields, force the user to specify a value from the selector" exists. Exact markup not captured. [docs] [T5]

### ORC
- **cx-select** (React component bridged into Knockout): classes `cx-select`, `cx-select-input--auto-suggest`, `cx-select-dropdown--open`, `cx-select-input--active-option`. [verified-live] bundle [O3] Reported working approach: focus, type a prefix, wait, then ArrowDown/Enter or click the `[role=gridcell]`/`[role=option]`. A plain `.fill()` does not commit the value. [code] [O8]
- **Pill choices** (Yes/No questions etc.): `.cx-select-pills-container > button.cx-select-pill-section`, selected state `cx-select-pill-section--selected`. These are `<button>`s, so an input-only scan misses them. [code] [O7]; class names [verified-live] bundle [O3]
- **Oracle JET** controls: `oj-select-single`, `oj-combobox-one`, `oj-input-text`, `oj-text-area`. Options are `.oj-listbox-result` / `[role=option]` in a `.oj-listbox-drop`. [code] [O7]; `oj-*` classes [verified-live] bundle [O3]
- **Dates**: `cx-datepicker-form-element` with month/day/year toggle buttons (`[id*=month-…][id*=toggle]`) opening gridcell overlays. [code] [O8]
- **Checkbox**: `input.input-row__hidden-control` (visually hidden, `data-bind="checked: ..."`). Click the label or row instead of setting `.checked`. The legal checkbox opens a modal that must be agreed. [verified-live] [O1]; modal [code] [O8]
- Knockout observables update on `input`/`change` for plain text controls. Committing an experience/education tile needs the tile's Save button. One bot reached into `ko` context (`doneProfileItem`) when synthetic clicks failed. That is too invasive for JobScript. [code] [O8]
- False errors: the hidden Oracle Digital Assistant (`#oda-chat-*`, `#oda-work-summary-text-area`) sits in the DOM with its own textarea and file input. Exclude `[id^=oda-]` from field scans and file-input picks. [verified-live] [O1]; [code] [O7]

## 5. Repeating sections

### Taleo Enterprise
- Work experience entries are indexed `we-wei-<k>` and education entries `csef-efi-<k>` (0-based). "Add work experience" is `[id$="-we-lblAddWorkExperience"]`. **Clicking it triggers a postback/page reload**, after which entry `k+1` exists. The extension example saved state in `sessionStorage` to resume after the reload. [code] [T7]
- Block properties set the minimum number of entries (0–10) for education and certifications. [docs] [T5]
- Resume parsing (Resume Upload block) fills the general profile before the personal, work and education pages. The adapter should fill only empty fields and never overwrite parsed values without the user confirming. Taleo asks users to verify the parsed data. [docs] [T5]; [unverified] [T12]

### ORC
- Experience, education, skills, licenses and languages are **tiles** (`apply-flow-profile-item-tile`, `beautiful-timeline-item`, `work-and-education-timeline`) with add buttons (`.apply-flow-profile-item-button`, `.work-and-education-timeline-add-button`, "ADD SKILL"). Editing happens in a dialog (`.app-dialog`) or inline (tenant `CX_1001`), and each tile has Save/Cancel. [code] [O7][O8]; component names [verified-live] bundle [O3]
- Resume/LinkedIn/Indeed import pre-creates tiles that often have gaps ("Fields to fix: 1", missing degree, certificate type pill unselected). The adapter has to open each tile, fill only the gaps and save. [code] [O8]
- Block metadata says which are required (e.g. ORA_EXPERIENCE `IsRequired=true`, ORA_LICENSE_CERTIFICATES `IsRequired=false`). [verified-live] [O1]

## 6. Resume upload

### Taleo Enterprise
- Upload sits on its own page (Resume Upload block) or in the Attachments block: `input[type=file][id$="AttachedFilesBlock-uploadedFile"]` plus an "Attach" button `[id$="AttachedFilesBlock-attachFileCommand"]`. The upload is committed by the **button postback**, not by `change`. [code] [T8] With a DataTransfer-set file, the user (or adapter) clicks Attach. That is a non-final step, but it is a server write, so JobScript should leave it to the user or ask first.
- Attachments block: candidates tick "Relevant Files" and "Resume" checkboxes per file. [docs] [T5]
- Limits (tenant config, defaults): **Attached File Maximum Size 1,048,576 bytes (1 MB)**, maximum 10 files. When filtered, allowed formats are .doc/.docx, .pdf, .rtf, .txt, .htm/.html, .odt, .wpd, .xls/.xlsx, .zip. [docs] [T9]
- "Plain Text Resume" and "Cover Letter (plain text)" blocks offer paste-in textareas. [docs] [T5]

### ORC
- Resume import at the top of Personal Info: `input[type=file].apply-flow-profile-import-awli__file-upload` / `#quickProfileImport`, with success text "Profile successfully imported." [code] [O7][O8]
- Documents block (ORA_DOCUMENTS, `IRC_CANDIDATE_RESUME_REQUIRED=true` on Oracle's flow [verified-live] [O1]): file inputs are `input.file-form-element__input.upload-button` with ids `attachment-upload-N`. The slot is identified by the **host custom element**: `resume-upload-button`, `cover-letter-upload-button`, `attachment-upload-button` (misc). Success state: `.attachment-upload-button--filled` / `--saved`. [code] [O7]; component names [verified-live] bundle [O3]
- Exclude the ODA chat's hidden `input[type=file]`. [verified-live] [O1]

## 7. iframes / shadow DOM

### Taleo Enterprise
- Native pages are top-level. Some employers embed career sections in an iframe on their own site. Taleo ships `js/integration/iframes_communication.js` for this. [verified-live] script presence [T3]; embedding practice [unverified]
- CU's tenant sends `Content-Security-Policy: frame-ancestors 'self'`, so it cannot be framed cross-origin. The header is tenant-configurable. [verified-live] [T1]
- Host permissions needed: `https://*.taleo.net/*` plus custom domains, handled by path detection under the optional `https://*/*`. No shadow DOM. [verified-live]
- Session: hidden `pSessionTimeout=3600000` (60 min) and a keep-alive beacon `pBeaconBeat=300000` (5 min). The login form carries `expiredSessionUrl`. Long fill sessions can expire, so warn the user and avoid idle waits. [verified-live] [T1][T3]

### ORC
- Top-level SPA. `X-Frame-Options: SAMEORIGIN` and `frame-ancestors 'self' https://<pod>` mean no cross-origin embedding. [verified-live] [O1]
- Custom domains (careers.oracle.com) serve the app shell and pull assets and REST from the pod origin. A content script must match the custom host too, so detect by the `static.oracle.com/cdn/fa/oj-hcm-ce/` script or `CandExpStatic`. [verified-live] [O2]
- No shadow roots (`shadowRoot` count 0). Oracle JET custom elements are light DOM. [verified-live] [O1]
- A `session-expire` component shows "End Session / Continue Working". [verified-live] [O1]

## 8. Job / requisition ID

### Taleo Enterprise

| Source | Regex / selector | Evidence |
|---|---|---|
| URL | `[?&]job=([^&#]+)` (accepts the contest number **or** the requisition id) | [docs] [T2]; [verified-live] [T1] |
| Title | `document.title` = `Job Description - <Title> (<id>)` → `/\(([^)]+)\)\s*$/` | [verified-live] [T1] |
| DOM | `#requisitionDescriptionInterface\.reqContestNumberValue\.row1` (text `41299`); title `#requisitionDescriptionInterface\.reqTitleLinkAction\.row1` | [verified-live] [T1] |
| Search list | `#requisitionListInterface\.reqTitleLinkAction\.row<N>`; "Requisition ID: <id>" text | [verified-live] [T1] |
| JSON-LD | none on `jobdetail.ftl` (CU tenant) | [verified-live] [T1] |
| Meta | `<meta name="title" content="<Job title>">` | [verified-live] [T1] |

### ORC

| Source | Regex / selector | Evidence |
|---|---|---|
| URL | `/job/(\d+)(?:/|$|\?)` (the requisition **number**, e.g. `344707`) | [verified-live] [O1] |
| REST | `GET /hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=ById;Id="<id>",siteNumber=<CX_..>` → `Id`, `Title`, `RequisitionId` (internal long, e.g. `302969248103347`), `ExternalPostedStartDate`, `PrimaryLocation`, `ExternalDescriptionStr` | [verified-live] [O1] |
| List | `recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations&finder=findReqs;siteNumber=<CX>,limit=..,sortBy=POSTING_DATES_DESC` | [verified-live] [O1] |
| Meta | `og:title` = job title. No JSON-LD in the shell. | [verified-live] [O1] |

## 9. Automation restrictions

- Oracle.com Terms of Use, which ORC's legal disclaimer links: users agree "not to use any robot, spider, scraper or other automated means" without written permission. [docs] [O6] Taleo career sections show tenant-specific legal statements. A Taleo-wide candidate ToS was not found. [unverified]
- Taleo anti-bot: none seen on the login page (no captcha). An "SD0714 - Security Message on the Career Section" support article exists (content behind login). [verified-live] [T3]; [unverified] [T11]
- ORC anti-bot: the **honeypot** field (a filled honeypot is reported to make the application drop silently [code] [O7]). The bundle includes **hCaptcha and reCAPTCHA** support (`apply-flow-summary-captcha`, `captchaToken`), tenant-enabled. Email/SMS one-time code with lockout after 5 tries. [verified-live] [O1][O3]; [docs] [O4]
- The open-source Taleo bots found are mass fake-application tools (SeanDaBlack/ChangeisBrewing and Starbusting flooded one employer's Taleo with generated applications in 2022). That is the opposite of JobScript's model. JobScript fills only the user's own data in the user's own session and never clicks Save and Continue, Submit, Attach, or Agree on terms on its own. It never fills login, password, PIN or honeypot fields.
- No account-ban reports specific to Taleo or ORC were found. [unverified]

## 10. Sources

**Taleo**
- T1. https://cu.taleo.net/careersection/2/jobdetail.ftl?job=41299&lang=en and `/careersection/2/jobsearch.ftl?lang=en` (→ `moresearch.ftl`), plus https://nato.taleo.net/careersection/2/jobdetail.ftl?job=251490&lang=en (expired job): [verified-live] ftlform hidden fields, session timeout and beacon, Apply Online ids, req id element, title format, no JSON-LD, CSP `frame-ancestors 'self'`, release asset paths.
- T2. https://docs.oracle.com/en/cloud/saas/taleo-enterprise/21b/otrdc/deep-linking-configuration.html: [docs] jobdetail/jobapply/jobsearch URL templates; `job=` takes contest number or requisition id.
- T3. https://cu.taleo.net/careersection/2/jobapply.ftl?job=41299&lang=en → `/careersection/iam/accessmanagement/login.jsf` (GET only, nothing typed): [verified-live] login form ids, Apply as Guest button, LinkedIn widget, scripts, hidden JSF state.
- T4. https://cu.taleo.net/careersection/2026PRD.1.4.14.3.0/help/Output/careersection/careersectiondoc/c_19d_applyasguest.html: [docs] Apply as Guest behaviour and setting values.
- T5. https://cu.taleo.net/careersection/2026PRD.1.4.14.3.0/help/Output/careersection/careersectiondoc/block/r_applicationflowblocks.html (and `applicationflow/startshere_applicationflow.html`): [docs] application flow and block catalogue (Resume Upload ordering, Disqualification, Diversity, eSignature, Attachments, min entries).
- T6. `.../help/Output/careersection/careersectiondoc/applicationflow/startshere_progressbar.html`: [docs] progress bar.
- T7. rpeng220/kaleidoscope `taleo.js`: https://github.com/rpeng220/kaleidoscope (no license; last push 2023-02): [code] `et-ef-content-ftf-...dv_cs_*` ids, 0-based month selects, cascading ResidenceLocation selects with delays, Add Work Experience reload, login ids. May be stale.
- T8. SeanDaBlack/ChangeisBrewing `constants/xPaths.py`, `constants/elementIds.py`: https://github.com/SeanDaBlack/ChangeisBrewing (GPL-3.0; 2022): [code] id grammar for personal info, work, education, work conditions, diversity and prescreening radios, eSignature, `saveContinueCmdBottom`/`submitCmdBottom`, `AttachedFilesBlock` upload. Mass-application bot. Use for selectors only. May be stale.
- T9. https://docs.oracle.com/en/cloud/saas/taleo-enterprise/22d/otrcg/c-attachmentpermissionsandsettings.html: [docs] attachment size and count defaults, allowed formats.
- T10. Jobright-derived site registry in fkabaalkhail/Applypilot: https://github.com/fkabaalkhail/Applypilot (no license): [code] Taleo apply URL patterns (`application.jss`, `flow.jsf`, `jobapply`, `ats/careers`), custom domains, ORC patterns.
- T11. https://support.oracle.com/knowledge/Oracle%20Cloud/1045908_1.html: [unverified] title only (login required).
- T12. https://enhancv.com/blog/how-does-taleo-work/: [unverified] parse-then-verify candidate experience.

**ORC**
- O1. https://eeho.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_45001/job/344707 and `/apply/email` (rendered in browser, nothing typed), plus REST `recruitingCEJobRequisitions`, `recruitingCEJobRequisitionDetails`, `recruitingCEApplyFlows`, `recruitingCEProfileImportConfigs` (GET): [verified-live] email step DOM, honeypot, legal checkbox, Knockout/JET markers, flow sections and blocks, profile-import providers, 401 on candidate-scoped metadata, response headers.
- O2. https://careers.oracle.com/en/sites/jobsearch/job/344707: [verified-live] custom-domain ORC shell loading from the `eeho` pod.
- O3. https://static.oracle.com/cdn/fa/oj-hcm-ce/2607.26.262300322/js/main-minimal.js: [verified-live] registered component names (`*-form-element`, pin/captcha/upload components), `cx-select*` / `oj-*` / `input-row__*` classes, REST finders, hCaptcha/reCAPTCHA strings, honeypot element factory.
- O4. https://docs.oracle.com/en/cloud/saas/readiness/hcm/25b/recr-25b/25B-recruiting-wn-f37048.htm and https://docs.oracle.com/en/cloud/saas/readiness/hcm/24b/recr-24b/24B-recruiting-wn-f32343.htm: [docs] email/phone verification for returning candidates, PIN challenge, lockout (via search summary).
- O5. https://docs.oracle.com/en/cloud/saas/talent-management/24a/faimh/email-and-sms-for-candidate-identity-verification-and.html: [docs] email and SMS identity verification.
- O6. https://www.oracle.com/legal/terms/: [docs] robot/spider/scraper clause (read in browser).
- O7. usama-sh/fastapply `src/engine/selectors.ts`: https://github.com/usama-sh/fastapply (MIT; 2026-08): [code] ORC selector vocabulary: pin-code inputs, honeypot blocklist, pills, JET options, upload host elements, ODA exclusion, Agree dialog.
- O8. callitask/Universal-Autonomous-Career-Agent `docs/ORACLE_HCM_ATS_DEEP_DIVE.md`: https://github.com/callitask/Universal-Autonomous-Career-Agent (license NOASSERTION; 2026-09): [code] section routes, tile editing traps, diversity and DOB ids, submit button, post-submit route, Knockout context workaround. Agent doc, single-tenant (`CX_1001`, Bristlecone).
- O9. darischen/career-ops `.playwright-mcp` console logs: https://github.com/darischen/career-ops: [code] `fa-exvu-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/<id>` host form. License not checked.

## Open questions

- **Taleo application pages were not observed live**, because that needs sign-in or Apply as Guest, which creates a candidate record. Unconfirmed: label markup, required markers, selector-popup widgets, the exact URL (`flow.jsf` vs `application.jss`), whether `j_id_id16pc9` is stable in 2026, and how resume parsing presents ("upload to fill" page UI).
- Whether Save and Continue validation messages render inline (field ids) or in a top error list.
- How common iframe-embedded Taleo still is, given that CSP `frame-ancestors 'self'` was seen on one tenant.
- How many Taleo tenants still enable Apply as Guest or LinkedIn apply. That needs sampling.
- ORC: the actual DOM of the contact, address, question and EEO sections. Only the email step was rendered. Ids such as `#fullName-5` and `#IN-STANDARD-ORA_GENDER-STANDARD-7` come from one bot's tenant.
- ORC: which events commit `cx-select` values without real keystrokes, and whether `input`/`change` alone updates Knockout for `text-form-element`.
- ORC: whether a captcha is shown on submit for typical tenants (support exists in the bundle; not seen on the email step).
- ORC custom-domain prevalence and patterns beyond careers.oracle.com.
