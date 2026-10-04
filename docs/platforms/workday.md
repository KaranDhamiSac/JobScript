# Workday

> Summary: Workday Recruiting is a React single-page app with 6 to 8 steps, behind a per-tenant candidate account (sign-in or Create Account is always the first step). The field layout comes from the server, and fields are tagged with `data-automation-id="formField-<metadataId>"` wrappers, `<label for>`, and ids built from the field path (`name--legalName--firstName`, `workExperience-<n>--jobTitle`). An adapter must handle: listbox buttons and search-prompt multiselects whose options render in a portal; Month/Day/Year spinbutton date fields; "Add" repeaters whose inputs only exist after a click; resume parsing that pre-fills (and sometimes corrupts) entries; and a step change that swaps the DOM without changing the URL. Much of the open-source selector lore (`legalNameSection_firstName`, `bottom-navigation-next-button`, `workExperienceSection`) is stale against the 2026.40 bundle. The job and requisition IDs are easy to get from the public CXS JSON API.
> **Difficulty: high.**
> Last researched: 2026-10-04 (live bundle version `2026.40.17` on wd5)

---

## 1. Detection

### Hostnames / URL patterns

| Pattern | Example | Notes |
|---|---|---|
| `^https://([\w-]+)\.(wd\d+)\.myworkdayjobs\.com/(?:[a-z]{2}-[A-Z]{2}/)?([^/?#]+)` | `nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/...` | Groups: tenant, data-center shard (`wd1`, `wd3`, `wd5` seen live; others such as `wd2`/`wd10x`/`wd50x` **[unverified]**, so match `wd\d+`), site id. Locale segment is optional. **[verified-live]** [1] |
| `^https://(wd\d+)\.myworkdaysite\.com/(?:[a-z]{2}-[A-Z]{2}/)?recruiting/([^/]+)/([^/?#]+)` | `wd5.myworkdaysite.com/en-US/recruiting/workday/Workday/...` | Path-style host: `/recruiting/<tenant>/<site>`. Same SPA and the same CXS API under `/wday/cxs/<tenant>/<site>`. **[verified-live]** [4][8] |
| `^https://([\w-]+)\.(wd\d+)\.myworkdayjobs-impl\.com/` | `enercity1.wd3.myworkdayjobs-impl.com/...` | Implementation/sandbox tenants. Same app. **[code]** [33] |
| `wd\d+\.myworkday\.com` | `wd5.myworkday.com` | `clientOrigin` for assets/SSO/logging. Not where candidates apply. **[verified-live]** [1] |
| `wd\d+\.myworkdaycdn\.com/wday/asset/...` | `cx-jobs.min.js`, `candidate-experience-apply-flow.min.js` | Script assets. **[verified-live]** [5][6] |

Apply-flow route suffixes (all client-side routes under the job URL) **[verified-live]** [7][9]:
- `/job/<location?>/<slug>_<REQID>` is the posting. The location segment is optional; the canonical link omits it.
- `/job/.../apply` opens the "Start Your Application" chooser (`applyAdventurePage`).
- `/job/.../apply/autofillWithResume`, `/apply/applyManually`, `/apply/useMyLastApplication` start the flow.
- `/<site>/login`, `/<site>/userHome` (Candidate Home) **[code]** [6]. The older `/<site>/details/<slug>` link form is rewritten to `/job/` by the SPA **[code]** [5].

Regex for "this is an apply page":
`/\/(?:recruiting\/[^/]+\/)?[^/]+\/job\/.+\/apply(?:\/(autofillWithResume|applyManually|useMyLastApplication))?\/?(?:[?#]|$)/`

### DOM / script signatures (no URL needed, e.g. on a custom domain)
- `window.workday = { tenant, siteId, locale, clientOrigin, cdnEndpoint, appName: "cxs", isExternal, allowedFileTypes, blockedFileTypes, branding:{..., embedded:false}, ... }` is an inline script in the static HTML **[verified-live]** [1]. This is the strongest signal. A content script cannot read page JS globals, so read it from the inline `<script>` text, or match the asset URLs.
- The body is just `<div id="root"></div>`. Scripts load from `/wday/asset/uic-shared-vendors/shared-vendors.min.js` and then `/wday/asset/candidate-experience-jobs/cx-jobs.min.js` **[verified-live]** [1].
- Rendered DOM: `[data-automation-id="applyFlowPage"]`, `[data-automation-id="progressBar"]`, `[data-automation-id="jobPostingPage"]`, `[data-uxi-widget-type]`, and Canvas Kit CSS vars (`--cnvs-sys-*`) **[verified-live]** [6][7].
- Footer text "© 2026 Workday, Inc. All rights reserved" (`data-automation-id="logo"`) **[verified-live]** [7].
- Cookies: `PLAY_SESSION`, `CALYPSO_CSRF_TOKEN`, `CALYPSO_SESSION`, `wd-browser-id`, `wday_vps_cookie` **[verified-live]** [11].

### Custom domains / embedding
- Career sites are served with `x-frame-options: DENY` **[verified-live]** [11], so company sites cannot iframe the apply flow. Companies link out to `*.myworkdayjobs.com` instead. The `branding.embedded` / `features.embedded` flag exists in the bundle **[code]** [5], but what it does was not confirmed.
- No company-domain (CNAME) hosting was observed. **[unverified]** Treat Workday as always on the Workday hosts above.

---

## 2. Application flow

### Start chooser (`/apply`) **[verified-live]** [7][8]

| Element | Selector | Notes |
|---|---|---|
| Apply button on posting | `a[data-automation-id="adventureButton"][role="button"]` (`href` ends in `/apply`) | It is an `<a role=button>`, not a `<button>`. One write-up reports that a scripted click never navigated, while reading `href` and navigating to it worked **[code]** [17] |
| Chooser page | `[data-automation-id="applyAdventurePage"]` | "Start Your Application" |
| Autofill with Resume | `a[data-automation-id="autofillWithResume"]` | Hidden when the tenant hides the Resume Parsing section **[docs]** [13] |
| Apply Manually | `a[data-automation-id="applyManually"]` | Always present |
| Use My Last Application | `a[data-automation-id="useMyLastApplication"]` | Pre-fills from the candidate's prior application on this tenant |
| Apply with LinkedIn | `iframe[data-automation-id="applyWithLinkedIn"]` | Cross-origin LinkedIn iframe. May need cookie acceptance first (`cookieAcceptanceRequiredForAWLI`) **[code]** [6] |
| Apply with SEEK | `a[data-automation-id="applyWithSeek"]` (`href` goes to `seek.com/awsk/authorize`) | Present on some tenants (Workday's own site has it) |
| Others in bundle | apply modes `applyManually`, `useMyLastApplication`, `autofillWithResume`, `LinkedIn`, `SEEK`, `usajobs`, `myWorkday`, `agency` | **[code]** [6] |

### Account requirement
- **Every tenant checked requires sign-in or account creation before step 1's form.** The first progress step is the auth step **[verified-live]** [9][10]:
  - NVIDIA: Sign In with Google, LinkedIn, or email (`GoogleSignInButton`, `LinkedInSignInButton`, `SignInWithEmailButton`).
  - Workday (myworkdaysite): Apple, Google, or email.
  - Autodesk: an inline **Create Account** form: `formField-email` / `input[data-automation-id="email"]`, `password`, `verifyPassword`, `createAccountCheckbox` (a tenant-specific "Candidate acknowledgment"), `createAccountSubmitButton`, `signInLink`, `forgotPasswordLink`.
- SSO buttons in the bundle: `AppleSignInButton`, `GoogleSignInButton`, `LinkedInSignInButton`, `OktaSignInButton`, `USAJobsSignInButton`, `SignInWithEmailButton` **[code]** [6].
- Accounts are **per tenant**. A candidate has a separate account on each company's Workday. Some tenants send an email verification. **[unverified]** [17]
- **Honeypot**: the sign-in and create-account forms contain `input[data-automation-id="beecatcher"][name="website"]`, labelled as an input for robots only **[verified-live]** [10]. JobScript must never fill it, or any `name="website"` field inside `signInFormo`.
- JobScript stance: do not fill auth forms at all, since passwords are out of scope. Detect the auth step (`[data-automation-id="signInContent"]`) and show "sign in first".

### Steps
- The step list is server-driven per job: `GET /wday/cxs/<tenant>/<site>/jobpostings/<id>/applyflowpages?applyDetail=<mode>` needs an apply session; it returned 422 without one **[verified-live]** [3]. Step count seen: **6** for Apply Manually and **7** for Autofill with Resume (NVIDIA), **7** for Apply Manually (Workday), **6** for Autodesk **[verified-live]** [9][10].
- Page markers in the **2026.40 bundle** (use these for step detection) **[code]** [6]:

| Step (typical English title, tenant-configurable) | Current marker `data-automation-id` | Legacy marker seen in older bots (stale) |
|---|---|---|
| Sign In / Create Account | `signInContent`, form `signInFormo` | `utilityButtonSignIn` flow |
| Autofill with Resume (upload) | `applyFlowAutoFillPage` | n/a |
| My Information | `applyFlowMyInfoPage` | `contactInformationPage` |
| My Experience | `applyFlowMyExpPage` | `myExperiencePage` |
| Application Questions (1 to 3 questionnaires) | `applyFlowPrimaryQuestionsPage`, `applyFlowSecondaryQuestionsPage`, `applyFlowSupplementaryQuestionsPage` | `applyFlowPrimaryQuestionsPage` (unchanged) |
| My Availability (some tenants) | `applyFlowMyAvailabilityPage` | n/a |
| Voluntary Disclosures (EEO, terms) | `applyFlowVoluntaryDisclosuresPage` | `voluntaryDisclosuresPage` |
| Self Identify (US disability CC-305) | `applyFlowSelfIdentifyPage` | `selfIdentificationPage` |
| Take Assessment (some tenants) | `takeAssessmentPage` | n/a |
| Review | `applyFlowReviewPage` | n/a |
| Already applied / unknown / loading | `alreadyAppliedPage`, `applyFlowUnknownPage`, `applyFlowLoadingPage` | n/a |

- **Step transitions do not change the URL.** It stays `/apply/applyManually`. The React tree under `applyFlowPage` is swapped. Detect steps with a `MutationObserver` on `[data-automation-id="applyFlowPage"]` and look for the marker above **[verified-live]** (URL constancy across sign-in) [9] + **[code]** [6][24]. Note from SimpleApply's notes: page-1 inputs can linger in the DOM after moving to page 2, so key on the page marker, not on field presence **[code]** [24].
- Progress bar: `ol[data-automation-id="progressBar"] > li[data-automation-id="progressBarActiveStep"|"progressBarCompletedStep"|"progressBarInactiveStep"]`. Each `<li>` has a `<label aria-live>` reading "current step 1 of 6" **[verified-live]** [9]. Step titles were not in the pre-login DOM; logged-in reports say they appear **[unverified]**. A narrow layout shows `progressBarResponsiveLabel` **[code]** [6].
- Footer navigation: `[data-automation-id="pageFooter"]`, `button[data-automation-id="pageFooterBackButton"]`, `button[data-automation-id="pageFooterNextButton"]` (label "Save and Continue", "Continue", or "Submit" on Review) **[code]** [6]. **`bottom-navigation-next-button` and `wizardNextButton` do not appear in the 2026.40 bundle, so they are stale** [14][16][26][27].
- "Save and Continue" saves the step on the server (`jobapplication/<id>/...` and `package/<id>/...` endpoints) **[code]** [6]. The draft survives a reload. JobScript must never click Next on Review, and should not click Next at all, per product rules.
- Validation errors render **inline inside each `formField-*`** ("Error: The field X is required…"). `errorMessage`, `inputAlert`, `errorHeading`, and `alertHeading` are also used **[code]** [6][17].

---

## 3. Field structure

### How labels attach **[verified-live]** [10] + **[code]** [6]

Live markup from a Create Account form (classes stripped):

```html
<div data-automation-id="formField-email">
  <label for="input-4"><span>Email Address<abbr aria-hidden="true">*</abbr></span></label>
  <div><div style="width:100%;max-width:376px;min-width:280px">
    <input type="text" data-automation-id="email" id="input-4" aria-required="true" aria-invalid="false" autocomplete="email">
  </div></div>
</div>
```

- Wrapper: `div[data-automation-id="formField-<metadataId>"]`. The bundle has `formField-${id}` and `moreInfo-${id}` helpers **[code]** [6]. Some wrappers are `formField-` with an empty id (the createAccountCheckbox wrapper) **[verified-live]** [10].
- `<label for=...>` points at the input id. **The label sits two or three ancestors above the input** (inside the wrapper, not a direct parent) **[code]** [16]. JobScript's `labelText` should take the `formField-*` wrapper's own `<label>`.
- Required: `<abbr aria-hidden="true">*</abbr>` in the label, plus `aria-required="true"` on the control **[verified-live]** [10].
- Errors: `aria-invalid`, plus `aria-describedby` pointing to `error-<n>-<inputId>` / `alert-<n>-<inputId>` elements tagged `inputAlert` **[code]** [6].
- Every field wrapper also carries **`data-fkit-id="<origin>--<metadataId>"`**, with the path segments joined by `--` **[code]** [6]. On the application steps the **input `id` follows the same path** (`name--legalName--firstName`) and `name` is the last segment(s) (`legalName--firstName`) **[code]** [24][25][17]. On the auth pages ids are auto-generated (`input-4`) **[verified-live]** [10]. **Do not rely on `input-N` ids. They are generated per render.**
- Sections: `div[role="group"][aria-labelledby="<Label-With-Hyphens>-section"]`, for example `Work-Experience-section`, `Education-section`, `Websites-section`, `Skills-section`. **The id is built from the translated label text** (`${label}-section`.replace(/ /g,"-")), so it changes with locale and tenant label overrides **[code]** [6][20].

### The two DOM generations (important)

| Concept | **Current (2025 to 2026, fkit/Canvas)** | **Legacy (2021 to 2024 bots)**: flag as stale |
|---|---|---|
| First / last name | `input[id="name--legalName--firstName"]`, `name="legalName--firstName"`, wrapper `formField-firstName`? | `input[data-automation-id="legalNameSection_firstName"]` / `_lastName` |
| Address | `input[id="address--addressLine1"]`, `address--city`, `address--postalCode`; region is a listbox button | `addressSection_addressLine1`, `addressSection_city`, `addressSection_countryRegion`, `addressSection_postalCode` |
| Phone | `input[id="phoneNumber--phoneNumber"]`; country code is a search prompt (`countryPhoneCode`); device type is a listbox | `phone-number`, `phone-device-type`, `countryPhoneCode` |
| How did you hear | `formField-source` (search-prompt multiselect, required on many tenants) | `sourceDropdown`, `source-how-did-you-hear-about-us` |
| Previous worker | `formField-candidateIsPreviousWorker`, radios `value="true"/"false"`, `name="candidateIsPreviousWorker"` | `previousWorker` |
| Next button | `pageFooterNextButton` | `bottom-navigation-next-button`, `wizardNextButton` |
| Work exp. section | `[role=group][aria-labelledby="Work-Experience-section"]` | `workExperienceSection` |
| Repeater row | `[role=group][aria-labelledby="Work-Experience-<n>-panel"]`; fields `id="workExperience-<k>--jobTitle"` | `[data-automation-id="workExperience-<n>"]` |
| Add button | `button[data-automation-id="add-button"]` (text "Add" or "Add Another") | `button[data-automation-id="Add"]`, `[data-automation-id*="add"]` |

Evidence: names marked current come from the bundle **[code]** [6] and from 2026 extension code and notes that report checking them against live DOM **[code]** [17][20][24]. The legacy ids do **not** appear as strings in `candidate-experience-apply-flow.min.js` 2026.40.17 **[verified-live grep]** [6]. A robust adapter should key on `formField-<lastSegment>` + label text first, then path ids, and keep legacy ids only as a last fallback.

### Standard fields → identifier

`metadataId` names below come from the bundle and the CXS endpoint names **[code]** [6]. The id prefix (origin) is the step's instance key: My Information uses `emailAddress`, `phoneNumber`, `source`, `previousWorker`, `country`, `name`, `address` **[code]** [6].

| Profile field | Wrapper (`data-automation-id`) | Control / id pattern | Widget |
|---|---|---|---|
| Country | `formField-country` | `country--country` | listbox button (sets address layout) |
| First / middle / last name | `formField-firstName` / `middleName` / `lastName` | `name--legalName--firstName` … | text |
| Preferred name toggle | `formField-preferredCheck` | checkbox, reveals `name--preferredName--*` | checkbox |
| Address line 1/2, city, postal | `formField-addressLine1` … | `address--addressLine1`, `address--city`, `address--postalCode` | text |
| State / region | `formField-countryRegion` | `address--countryRegion` | listbox button (options per country) |
| Email | `formField-emailAddress` (often read-only, the account email) | `emailAddress--emailAddress` | text |
| Phone device type | `formField-phoneType` | `phoneNumber--phoneType` | listbox |
| Phone country code | `formField-countryPhoneCode` | search prompt | multiselect prompt |
| Phone number / extension | `formField-phoneNumber` / `formField-extension` | `phoneNumber--phoneNumber` | text |
| WhatsApp opt-in | `phone-whatsapp-opt-in` | checkbox | some tenants **[code]** [6] |
| How did you hear | `formField-source` | `source--source` | multiselect prompt (hierarchical, `promptLeafNode`) |
| Worked here before | `formField-candidateIsPreviousWorker` | radios `value=true/false` | radio (labels not inside the input; select by value) **[code]** [17] |
| Job title / company / location / description | `formField-jobTitle`, `companyName`, `location`, `roleDescription` | `workExperience-<k>--jobTitle` … | text / textarea |
| Currently work here | `formField-currentlyWorkHere` | checkbox (hides end date) | checkbox |
| From / To (work) | `formField-startDate` / `formField-endDate` | `…--startDate-dateSectionMonth-input`, `…-dateSectionYear-input` | MM/YYYY spinbuttons |
| School | `formField-schoolName` (some tenants: `schoolItem` prompt via `schools?search=`) | `education-<k>--schoolName` | text or prompt |
| Degree | `formField-degree` | listbox (`countries/<id>/degrees`) | listbox |
| Field of study | `formField-fieldOfStudy` (legacy `field-of-study`) | prompt (`values/educations/fieldsOfStudy?search=`) | multiselect prompt |
| GPA | `formField-gradeAverage` | text | text |
| First / last year attended | `formField-firstYearAttended` / `lastYearAttended` | YYYY spinbutton only | date (year) |
| Languages / certifications | panels via `languages`, `certifications` endpoints | various | repeaters |
| Skills | `formField-skills`, `data-automation-id="skills"` (read-only list) | `skills--skills` prompt (`common/skillsearch`) | multiselect prompt (type + Enter per skill) |
| Websites / LinkedIn | `Websites-section` repeater; `formField-linkedInAccount` (`socialNetworkAccounts`) | `webAddress` text | repeater / text |
| Resume / CV | `formField-resume…` | `file-upload-input-ref` | file |
| Gender / ethnicity / Hispanic / veteran | `formField-gender`, `formField-ethnicityMulti` (or single `ethnicity`), `formField-hispanicOrLatino`, `formField-veteranStatus` | prefix `personalInfoUS--` | listbox / multiselect / checkbox |
| Terms & conditions | `formField-acceptTermsAndAgreements` | checkbox | checkbox. **Never auto-check.** |
| Disability (CC-305) | `formField-disabilityStatus` (checkbox group), `formField-name`, `formField-dateSignedOn` | prefix `selfIdentifiedDisabilityData--` | checkbox group + text + date |

Field names whose wrapper id was **not directly observed live** (behind login): every row after "Email" above, beyond the bot reports. Treat them as **[code]/[unverified]** until checked against a captured fixture.

### Custom questions (Application Questions)
- Rendered from a questionnaire definition (`questionnaire/<id>/definition?type=primary|secondary|supplementary`). The posting JSON exposes `questionnaireId` (and secondary/supplementary ids when present) **[verified-live]** [3] + **[code]** [6]. The definition endpoint needs a session (422 without one) **[verified-live]** [3].
- Question types seen in bots: single listbox (Yes/No), multiselect prompt, radio group, checkbox group (`checkboxPanel`), text, textarea, date, file attachment (`questionnaireanswer/<id>/attachments`) **[code]** [6][16].
- Label = the wrapper's `<label>` or `<legend>`. Questions can run past 300 characters (one 377-character question is reported) **[code]** [16]. Radio and checkbox group labels sit on the wrapper above `role="radiogroup"`. Do not take the first option's label as the question **[code]** [16].
- **Ids are unreliable here.** Question ids are opaque WIDs. Match by label text. JobScript's saved site answers should be keyed on normalized label + tenant.

### EEO / Voluntary Disclosures / Self Identify
- Voluntary Disclosures: `personalInfoUS` (gender, ethnicity or ethnicityMulti, hispanicOrLatino, veteranStatus, veteransPreference) only when the address country is the US (WID `bc33aa3152ec42d4995f4791a106ed09`). Other countries use other collectors (aboriginal/indigenous, regionOfBirth, and so on). Terms and conditions are usually on this page **[code]** [6].
- Self Identify: the US OFCCP form CC-305 (header "Voluntary Self-Identification of Disability") with `disabilityStatus`, signature `name`, `dateSignedOn`, and `employeeId` **[code]** [6][34].
- JobScript policy suggestion: fill EEO only from explicit profile answers ("Decline to self-identify" default), and never check terms boxes.

---

## 4. Widgets

All widgets are React (Workday Canvas Kit plus in-house "fkit" form kit) **[code]** [6]. Native `<select>` is not used.

### 4.1 Listbox button ("Select One")
- `button[aria-haspopup="listbox"]` inside `formField-*`. Text "Select One" when empty. Options render in a **portal** (popup root, `position:fixed`) as `[data-automation-id="promptOption"]` / `[role="option"]` inside `[data-automation-id="activeListContainer"]` **[code]** [6][16]. A visibility filter based on `offsetParent` drops every option, so use `getBoundingClientRect`. Popup ids include `wd-popup-*` **[code]** [6].
- Sequences that work, according to bots:
  1. Click the button, find the option by text in the portal, click it (Puppeteer and Playwright use trusted clicks) **[code]** [14][28].
  2. Click the button, type the option text (type-ahead), press Enter **[code]** [14][28].
  3. From a content script: dispatch `mousedown`/`mouseup`/`click` on the button, wait for `activeListContainer`, then dispatch `mousedown`/`mouseup`/`click` on the option. ChrisMBarr's userscript dispatches only `click` on the button and the `li`, and finds the list through the button's `aria-controls` **[code]** [15]. That is a 2024 file, so check it still works.
- Verify the result: the button's text changes away from "Select One". Close any stale open list (Escape) before opening the next one **[code]** [16].
- JobScript's existing `isListboxButton` / `clickOption` (mouseover, mousedown, mouseup, click) fits this model. It needs the portal lookup to search `document`, not the field's container.

### 4.2 Search-prompt / multiselect (`multiSelectContainer`)
Used for How did you hear, phone country code, school, field of study, skills, and multiselect questions.
- Structure **[code]** [6]: `[data-automation-id="multiSelectContainer"][data-uxi-widget-type="multiselect"]` > `multiselectInputContainer` > `input[data-automation-id="searchBox"]` (placeholder "Search"). Selected values show as pills in `ul[data-automation-id="selectedItemList"]` > `selectedItem` (remove with `DELETE_charm`). Results appear in `activeListContainer` as `promptOption` (selectable leaves are `promptLeafNode`; hierarchical categories drill in). Also `clearSearchButton`, `promptSelectionLabel`, `multiSelectMessageContainer` ("0 items selected"), and `monikerSearchBoxFullscreen` on mobile.
- Sequences:
  - **Type, then Enter (search), then Enter or click the first result (accept)**. Several bots use "fill, Enter, wait about 1 s, Enter" **[code]** [14][16][18].
  - For hierarchical lists (source: "Job Board > LinkedIn"), click the category `promptOption`, then the leaf `promptOption`. A trusted click is needed according to [17] **[code]**.
  - Enter can commit the **top** result instead of the best match. A shorter, looser query works better ("computer sci" gives "Computer and Information Sciences") **[code]** [18].
  - Verify: a new `selectedItem` pill exists. The input value is cleared after a pick, so do not read it back **[code]** [16].
- From a content script: set the search input with the native value setter, fire `input`, wait for `promptOption` nodes, then `mousedown` + `click` the chosen option. Whether a synthetic Enter `keydown` triggers the search could not be confirmed without login **[unverified]**.

### 4.3 Date fields (split spinbuttons)
- Wrapper `formField-<dateField>` > `[data-automation-id="dateInputWrapper"]` > inputs `input[role="spinbutton"]` with `data-automation-id="dateSectionMonth-input"`, `dateSectionDay-input`, `dateSectionYear-input`. Each has `aria-valuemin`/`aria-valuemax`/`aria-valuenow`/`aria-valuetext` and a sibling `…-display` div. Calendar button: `dateIcon`, popup `datePicker`/`monthPicker`, today button `datePickerSelectedToday` **[code]** [6]. **The automation id has no field prefix**: `[data-automation-id="startDate-dateSectionMonth-input"]` (used by some bots) is wrong, but the element **id** is `<fieldPath>-dateSectionMonth-input` (for example `workExperience-<k>--startDate-dateSectionMonth-input`) **[code]** [6][16][17].
- Variants: MM/YYYY (work dates), YYYY only (education years), MM/DD/YYYY (signature date, availability) **[code]** [18].
- What registers a value **[code]** [6]: the spinbutton handles `onKeyDown` (digit keys and arrows) and `onChange`, which calls `validateAndUpdate(value)`. Typing digits auto-advances to the next section.
  - Content-script approach used by 2026 extensions: **for each section: focus, native value setter, `input` event, `change`; after the last section, `blur` or `focusout`** **[code]** [20][22][23]. One report says date sections re-render on every interaction, so re-query each section by id right before writing **[code]** [17].
  - Legacy approach (2024): dispatch ArrowUp/ArrowDown `keydown` N times on the section **[code]** [15]. It is slow but triggers only key handlers.
  - Some tenants have a calendar-only date with no typeable input; drive `dateIcon` instead **[code]** [18].
- **Known data-loss bug**: entries pre-filled by Autofill with Resume reverted their dates (to month 12) on Review, even after a correct fix and save **[code]** [17] (one report). Re-check dates on Review and warn the user.

### 4.4 Radios / checkboxes
- Radios: `input[type=radio]` (Canvas `radioBtn`). Labels often sit next to the input, not around it. Group question in the wrapper label. Value `true`/`false` for Yes/No booleans **[code]** [6][17].
- Checkboxes: `input[type=checkbox]` with `aria-checked`, label `for=` **[verified-live]** [10]. Checkbox groups use `checkboxPanel` **[code]** [6]. A native `.click()` works for both (React listens to `click` on checkable inputs) **[code]** [15][20].

### 4.5 Text / textarea
- Plain React-controlled inputs: native setter + `input` + `change`, then `blur`. Workday validation clears "required" errors only on blur **[code]** [17][23]. Setting `.value` + `focusout` alone was the 2024 userscript approach **[code]** [15].

### 4.6 Buttons with overlay (`click_filter`)
- Submit-style buttons sit under an overlay: `div[data-automation-id="click_filter"][role="button"][aria-label="Create Account"]` (absolutely positioned) on top of `button[data-automation-id="createAccountSubmitButton"][aria-hidden="true"][tabindex="-2"]` **[verified-live]** [10]. This explains reports that scripted clicks on the visible `<button>` "do nothing" **[code]** [17][19]. Not relevant to JobScript (never submits), but note it in case an "Add" button ever gets the same wrapper.

### 4.7 Rich text
- `richText` appears for instructional text and job descriptions. Free-text answers seen are plain `<textarea>` (`roleDescription`) **[code]** [6].

---

## 5. Repeating sections (My Experience)

- Sections render with a heading and an **"Add"** button when empty. Once one entry exists the button reads **"Add Another"**: `button[data-automation-id="add-button"]`, a secondary button, and the same automation id in every section. **Scope the query to the section group** (`[role=group][aria-labelledby="Work-Experience-section"]`) **[code]** [6][20].
- Each entry is `[role="group"][aria-labelledby="<Section>-<n>-panel"]`, where `n` is a visible 1-based counter ("Work Experience 1"). Field ids are `workExperience-<k>--<field>`, where **`k` is a client instance counter that is not sequential per section** (for example 9, 11, 12), so it cannot be used for ordering **[code]** [20][21]. Some reports show `k` matching 1..n; do not depend on it either way **[code]** [17].
- Sections (tenant template; any can be hidden or required): Work Experience, Education, Certifications, Languages, Skills, Websites, Resume/CV, Social Network URLs **[docs]** [13] + **[code]** [6].
- Delete: a `Delete` button per panel (`panelSet.delete`) **[code]** [6].
- Entries are **inline**, not modals **[code]** [21].
- After clicking Add, React re-renders the whole section. Re-query the section and panels after every click and wait for the panel count to grow (MutationObserver) **[code]** [20][24]. JobScript's `ensureEntries`/`clickAndWaitForChange` already follows this pattern.
- **Resume-parse collision**: with Autofill with Resume or Use My Last Application, My Experience arrives **pre-filled** with parsed entries (`package/<id>/workexperiences`, `educations`, `skills`, `socials`, …) **[code]** [6]. The parsed count and order often differ from the profile. Strategy: match existing panels by company and title before adding, fill only empty fields, show a diff, and never delete parsed panels automatically. Also see the date-revert bug in §4.3.
- Education uses the same structure (`Education-section`, `education-<k>--…`). School may be a text box or a typeahead prompt depending on the tenant **[code]** [14][24].

---

## 6. Resume upload

- **Autofill with Resume step** (`applyFlowAutoFillPage`): a file widget with automationId `resumeUpload`, **maxFiles 1**, accepted MIME types `application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `application/msword`, `text/html`, `text/plain`. The file is parsed after "Continue", then My Information and My Experience are pre-filled **[code]** [6]. Posting JSON `includeResumeParsing: true` signals that parsing is available **[verified-live]** [3].
- **My Experience resume section and question attachments**: a file widget with `maxFileSize: 5242880` (5 MB), default `maxFiles` 5 **[code]** [6]. The tenant-level `window.workday.blockedFileTypes` lists executables, and `allowedFileTypes` was `[]` on NVIDIA **[verified-live]** [1]. Files are virus-scanned after upload ("infected", "containsMacros" errors) **[code]** [6].
- DOM **[code]** [6]:
  - `[data-automation-id="file-upload-drop-zone"]`: `onDrop` reads `e.dataTransfer.files`, and clicking it opens the picker.
  - `button[data-automation-id="select-files"]` ("Select files").
  - `input[type=file][data-automation-id="file-upload-input-ref"]` (hidden). `onChange` reads `e.target.files`, then **resets `value=""`**.
  - Status: `file-upload-item`, `file-loading-dots`, `file-upload-successful`, `file-upload-failed`, `delete-file`.
- Injection from a content script: build a `File`, put it in a `DataTransfer`, assign `input.files = dt.files`, and dispatch a bubbling `change` event (React's file `onChange` listens to `change`). Alternatively dispatch `drop` on the drop zone with a `DataTransfer`. Several extensions use the input approach **[code]** [20][24][26]. Confirm `file-upload-successful` appears; one report says success may show even after the input disappears **[code]** [19].
- Do not re-upload if a `file-upload-item` with the same name already exists **[code]** [19].
- Cover letter: there is no dedicated field. Tenants add it as a questionnaire attachment or a second file in the Resume/CV section **[unverified]**.
- No paste-text alternative on the external flow **[unverified]**.

---

## 7. iframes / shadow DOM

- **No shadow DOM.** Everything is light DOM under `#root` **[verified-live]** [7][10].
- **No iframe around the form.** The career site itself sends `x-frame-options: DENY` **[verified-live]** [11]. The only iframe is `applyWithLinkedIn` (cross-origin LinkedIn widget) on the chooser page **[verified-live]** [7].
- Popups and listboxes render in portals at the end of `body` (`wd-popup-*`), outside the field wrapper **[code]** [6].
- Manifest needs: `https://*.myworkdayjobs.com/*`, `https://*.myworkdaysite.com/*`, optionally `https://*.myworkdayjobs-impl.com/*`. Since the host is a wildcard per tenant, an optional-host-permission request (as JobScript's Learn mode already does) works well. `all_frames` is not needed for Workday itself.
- The content script must **watch for SPA changes** (route change on Apply and DOM swap on each step). `run_at: document_idle` fires before React renders the form, so wait for `applyFlowPage` plus a step marker.

---

## 8. Job / requisition ID

| Source | Value | Example | Marker |
|---|---|---|---|
| URL tail | `externalPath` slug ends `_<REQID>` with an optional `-<n>` per-site suffix | `…Clocks_JR2026417`, `…Canada-_26WD101356-2`, `…UK---IE-_R4046019-2` | **[verified-live]** [2][3][4] |
| CXS detail | `jobPostingInfo.jobReqId` (the requisition), `jobPostingInfo.jobPostingId` (slug), `jobPostingInfo.id` (posting WID, 32 hex) | `JR2026417` / `ASIC-Verification-Engineer---Clocks_JR2026417` / `5f6ae464…` | **[verified-live]** [3] |
| CXS list | `jobPostings[].externalPath`, `bulletFields[0]` (usually the req id, but a free-form slot) | `"/job/India-Bengaluru/..._JR2026417"`, `["JR2026417"]` | **[verified-live]** [2]; caution **[code]** [30] |
| JSON-LD | `<script type="application/ld+json">` JobPosting `identifier.value` | `JR2026417` | **[verified-live]** [1] |
| DOM (posting page) | `[data-automation-id="requisitionId"]` (text "job requisition id JR…") | n/a | **[verified-live]** [7] |
| Meta | `og:url`, `link[rel=canonical]` (canonical drops the location segment) | n/a | **[verified-live]** [1] |

Requisition formats vary by tenant: `JR2026417`, `JR-0107491`, `R4046019`, `R00264514`, `26WD101356` **[verified-live]** [2][4].

Regex for the URL (strip `/apply…` first):
`/\/job\/(?:[^/]+\/)?[^/]*_([A-Za-z0-9][A-Za-z0-9-]*?)(?:-(\d{1,2}))?\/?(?:[?#]|$)/`. Group 1 is the req id and group 2 the per-site uniquifier. It can mis-split ids that end in a short hyphenated number, so prefer `jobReqId` from the API or JSON-LD. JobScript's `jobIdFromUrl` currently matches `_R12345` only; extend it for `JR-`, alphanumeric ids, and the `-N` suffix.

### Public CXS API (no auth) **[verified-live]** [2][3][4]
- Base: `https://<tenant>.<wdN>.myworkdayjobs.com/wday/cxs/<tenant>/<site>` or `https://<wdN>.myworkdaysite.com/wday/cxs/<tenant>/<site>`.
- `POST …/jobs` with `Content-Type: application/json` and body `{"appliedFacets":{},"limit":20,"offset":0,"searchText":""}` returns `{total, jobPostings:[{title, externalPath, locationsText, postedOn, bulletFields, remoteType?, timeType?}], facets:[…]}`. `GET` returns 400. Page size is capped at 20 **[code]** [30].
- `GET …/job/<location?>/<slug>` returns `{jobPostingInfo:{id, title, jobDescription (HTML), location, postedOn, startDate, timeType, jobReqId, jobPostingId, jobPostingSiteId, country{descriptor,id,alpha2Code}, canApply, includeResumeParsing, questionnaireId, externalUrl, …}, hiringOrganization{name}, similarJobs, userAuthenticated}`. The location segment is ignored (any value or none works).
- `GET …/sidebar` returns branding/video blocks. `siteMap.xml` lists every posting (`/<site>/siteMap.xml`, also in robots.txt).
- Apply-flow endpoints (`jobapplication/*`, `package/*`, `questionnaire/*`, `schools?search=`, `values/educations/fieldsOfStudy?search=`, `countries/<id>/regions`) return **422 without an apply session** (`X-Cxs-Session-Id` header, cookies) **[verified-live]** [3] + **[code]** [6]. A content script running in the page shares the cookies, but calling these is fragile and unnecessary; read the DOM.

For JobScript's tracker: from the page URL, derive the tenant, site, and slug, then fetch `…/wday/cxs/<tenant>/<site>/job/<slug>` (same origin, so no extra permission inside the content script) to get the title, company (`hiringOrganization.name` is often a legal-entity name like "IN01 NVIDIA Graphics Bengaluru", so prefer the site branding or tenant), location, and `jobReqId`.

---

## 9. Automation restrictions

- **Workday site terms** (workday.com, the Community, and Workday APIs; last updated 2026-08-13) forbid "data mining, robots or similar data gathering or extraction methods" and bypassing robots.txt **[docs]** [12]. These terms do not explicitly cover customer career sites. Each employer's career site may link its own terms or privacy policy (NVIDIA links an applicant privacy policy) **[verified-live]** [7].
- `robots.txt` on a tenant allows `/<site>/` and disallows research/talentcommunity paths and `/refreshFacet/` **[verified-live]** [11].
- **Anti-bot:**
  - Cloudflare fronts every tenant (`server: cloudflare`, `__cf_bm`, `_cfuvid` cookies, `cf-ray`) **[verified-live]** [11]. Scrapers report cloud and datacenter IPs blocked more often than home IPs **[code]** [30].
  - Honeypot `beecatcher` input on auth forms **[verified-live]** [10].
  - `noCaptchaWrapper` + `click_filter` overlay on submit buttons **[verified-live]** [10]. No reCAPTCHA, hCaptcha, Turnstile, or Arkose strings in the apply bundle **[verified-live grep]** [6].
  - UX telemetry: `uxInsights.min.js` and `data-uxi-element-id` / `data-uxi-widget-type` attributes log interactions **[verified-live]** [1][6].
- Account-ban reports for applicants using autofill extensions: none found **[unverified]**.
- **User-assisted vs bots:** the projects in §10 that create accounts and click Submit (Puppeteer/Playwright/Selenium bots [14][27][28], agent skills [17][18]) differ from JobScript, which runs in the user's own logged-in session, fills one visible step when the user asks, never touches auth fields or the honeypot, and never clicks Save and Continue or Submit. That stays within normal candidate use. Avoid rapid-fire CXS calls (one detail fetch per page view).

---

## 10. Sources

Live (fetched 2026-10-04):
1. NVIDIA posting HTML (inline `window.workday`, JSON-LD, meta, scripts): https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/India-Bengaluru/ASIC-Verification-Engineer---Clocks_JR2026417 **[verified-live]**
2. CXS job list POST: https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/jobs **[verified-live]** (shape, `bulletFields`, `externalPath`)
3. CXS job detail: https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/job/India-Bengaluru/ASIC-Verification-Engineer---Clocks_JR2026417 and the Autodesk equivalent; apply-flow endpoints returning 422 without a session **[verified-live]**
4. CXS lists on other tenants: https://wd5.myworkdaysite.com/wday/cxs/workday/Workday/jobs, https://autodesk.wd1.myworkdayjobs.com/wday/cxs/autodesk/Ext/jobs, https://gehc.wd5.myworkdayjobs.com/wday/cxs/gehc/GEHC_ExternalSite/jobs, https://wd3.myworkdaysite.com/wday/cxs/magna/Magna/jobs **[verified-live]** (req id formats, myworkdaysite host)
5. `cx-jobs.min.js` 2026.40.17: https://wd5.myworkdaycdn.com/wday/asset/candidate-experience-jobs/2026.40.17/cx-jobs.min.js **[verified-live]** (routes, embedded flag, lazy-loaded apply-flow asset)
6. `candidate-experience-apply-flow.min.js` 2026.40.17: https://wd5.myworkdaycdn.com/wday/asset/candidate-experience-apply-flow/2026.40.17/candidate-experience-apply-flow.min.js **[verified-live]** (all automation ids, `data-fkit-id`, page markers, file limits, date spinbutton handlers, endpoints). Read with grep; Workday proprietary, nothing copied.
7. Posting and `/apply` chooser DOM (NVIDIA), read via the browser pane without interaction **[verified-live]**
8. `/apply` chooser on Workday's own site (SEEK and LinkedIn options): https://wd5.myworkdaysite.com/en-US/recruiting/workday/Workday/job/USA-NY-New-York-City/Principal-Managing-Partner---Healthcare_JR-0107491/apply **[verified-live]**
9. `/apply/applyManually` and `/apply/autofillWithResume` sign-in pages (NVIDIA, Workday): progress bar 6 and 7 steps, SSO buttons **[verified-live]**
10. `/apply/applyManually` Create Account form (Autodesk): formField markup, `beecatcher`, `click_filter`, `noCaptchaWrapper` **[verified-live]**. Nothing typed or clicked.
11. Response headers (Cloudflare, `x-frame-options: DENY`, cookies) and https://nvidia.wd5.myworkdayjobs.com/robots.txt **[verified-live]**

Docs:

12. Workday Online Terms of Service (updated 2026-08-13): https://workday.com/en-us/legal/site-terms.html **[docs]**
13. Workday Admin Guide, job application templates (sections, Autofill with Resume tied to the Resume Parsing section): https://doc.workday.com/admin-guide/en-us/human-capital-management/recruiting/job-applications/ijz1499291475964.html **[docs]**

Open-source code (read for understanding only, nothing copied):

14. ubangura/Workday-Application-Automator `apply.js`: https://github.com/ubangura/Workday-Application-Automator. **No license**. Puppeteer. Repo created 2023-09, file last touched 2026-06-15, about 78 stars. **Legacy selectors** (`legalNameSection_*`, `addressSection_*`, `bottom-navigation-next-button`, `workExperience-N` containers, `formField-skillsPrompt`). Click + type + Enter dropdown pattern. **[code]**
15. ChrisMBarr/UserScripts `src/autofill-myworkdayjobs-resume.user.js`: https://github.com/ChrisMBarr/UserScripts. **GPL-3.0**. File last changed 2024-04-27. In-page userscript: `click` events, `aria-controls` lists, ArrowUp/ArrowDown keydown for dates, `.value` + `focusout`. **Probably stale**. **[code]**
16. aomine97/rails `WORKDAY.md`, `extension/lib/workday.ts`: https://github.com/aomine97/rails. **No license**. 2026-09. Portal options, two-Enter prompts, label 2 to 3 ancestors up, long question labels. Some ids it cites (`bottom-navigation-next-button`, `*Page` markers) are legacy. **[code]**
17. privacydied/job-application-skill `sites/myworkdayjobs/NOTES.md`: https://github.com/privacydied/job-application-skill. **MIT**. 2026-09. Live run notes: `formField-source`, `candidateIsPreviousWorker` value radios, per-entry `getElementById` with `workExperience-<N>--…` ids, blur needed, honeypot, synthetic-click no-ops, resume-date revert bug, `adventureButton` href navigation. Also creates accounts and submits (bot). **[code]**
18. jomylak/EasyAPP `src/applypilot/config/known_quirks/workday.md`: https://github.com/jomylak/EasyAPP. **AGPL-3.0**. 2026-09. Three date-field patterns; field-of-study Enter picks the top result. **[code]**
19. Osmond-Xin/job-hunt `docs/workday-apply-notes.md`: https://github.com/Osmond-Xin/job-hunt. **No license**. 2026-09. Overlay role=button, date spinbuttons, upload quirks. **[code]**
20. athervvidhate/avid-autofill `src/content/workday.js`: https://github.com/athervvidhate/avid-autofill. **MIT**. 2026-09. `[role=group][aria-labelledby="Work-Experience-<n>-panel"]`, `add-button` scoped per section, `data-fkit-id` with a non-sequential instance token, date spinner fill + blur. **[code]**
21. offlyn-ai/offlyn-apply `apps/extension-chrome/src/shared/workday-handler.ts`: https://github.com/offlyn-ai/offlyn-apply. **MIT**. 2026-05. `workExperience-{hash}--{field}` ids, inline (not modal) entries. **[code]**
22. KeshavSree/charles `extension/content/engine/widgets/workday/date.ts`: https://github.com/KeshavSree/charles. **No license**. 2026-09. Fill sections, then `focusout` on the last. **[code]**
23. harsha-codetech/applyr `src/content/adapters/date.js`: https://github.com/harsha-codetech/applyr. **No license**. 2026-09. Per-section native setter + input + change, then blur. **[code]**
24. BenjaminLarger/SimpleApply `extension/utils/adapters/workday.ts`, `.context/bugs.md`: https://github.com/BenjaminLarger/SimpleApply. **No license**. 2026-04. `name="legalName--firstName"`, `id="name--legalName--firstName"`, `address--*`, `phoneNumber--phoneNumber`, `skills--skills`; page-1 inputs linger after the step change; Add-button scoping problems. **[code]**
25. blacheo/autoapply-for-firefox-android `entrypoints/workday.content/workdayApplicationForm.ts`: https://github.com/blacheo/autoapply-for-firefox-android. **GPL-3.0**. 2025-08. `getElementById("name--legalName--firstName")`. **[code]**
26. Vick1213/resumeforge `extension/src/adapters/workday.ts`: https://github.com/Vick1213/resumeforge. **MIT**. 2026-09. Mostly legacy ids (`legalNameSection_*`, `wizardNextButton`). **Stale**. **[code]**
27. Yeetogami/forgeday-workday-selenium `locators.py`: https://github.com/Yeetogami/forgeday-workday-selenium. **No license**. 2026-09 (selectors look copied from older bots; **stale**). **[code]**
28. kessenma/ai-job-bot `apps/playwright/src/apply/handlers/workday-utils.ts`: https://github.com/kessenma/ai-job-bot. **MIT**. 2026-06. Dropdown: click, type, Enter; date sections. **[code]**
29. DaKheera47/job-ops `career-boards/workday/src/workday-url-to-cxs.ts`: https://github.com/DaKheera47/job-ops. License **NOASSERTION** (custom). 2026-10. URL to CXS mapping for both host shapes. **[code]**
30. zshah101/Automated-List-Of-Summer-2027-and-Fall-2026-Tech-Internships `src/intern_engine/connectors/workday.py`: https://github.com/zshah101/Automated-List-Of-Summer-2027-and-Fall-2026-Tech-Internships. **MIT**. 2026-10. 20-per-page cap, cloud-IP blocking, `-N` per-site uniquifier, `bulletFields` caution. **[code]**
31. ci-jy/ferry `fixtures/workday/*`: https://github.com/ci-jy/ferry. **MIT**. 2026-07. **Hand-built fixture, not a live capture** (mixes legacy and current ids). Do not use as ground truth. **[code]**
32. hemnaath04/job-os `apps/extension/tests/fixtures/workday.html`: https://github.com/hemnaath04/job-os. **No license**. 2026-09. **Synthesized fixture**. Same caution. **[code]**
33. SimonSiefke/vite-app: https://github.com/SimonSiefke/vite-app. Contains a `*.wd3.myworkdayjobs-impl.com` posting URL (impl host exists). **[code]**
34. Sambhav101/workday-autofill `src/selfid.py`: https://github.com/Sambhav101/workday-autofill. **No license**. 2026-06. `formField-disabilityStatus`, `disabilityStatus-CheckboxGroup`, `formField-name`. **[code]**

## Open questions

- **Exact post-login DOM** for My Information, My Experience, Questions, Voluntary Disclosures, and Self Identify on 2026.40: the wrapper ids (`formField-firstName` vs `formField-legalName--firstName`?), whether listbox buttons carry their own `data-automation-id`, and the id/name of every input. Everything past the auth step is from the bundle and third-party code, not seen live. **Next step: capture a sanitized DOM fixture from the user's own logged-in session** (JobScript's Learn mode could record one) and replace the `[code]` rows.
- Whether a **synthetic** `keydown Enter` on `searchBox` triggers the prompt search, or whether options only load on trusted input. Also whether synthetic `mousedown`/`click` on `promptOption` registers a selection (one bot needed trusted clicks [17]).
- Whether `workExperience-<k>` instance ids restart per page load and per section (reports conflict: 1..n [17] vs 9/11/12 [21] vs random [20]).
- Whether any tenant still allows a **guest (no-account) apply**. None found. The bundle has a `createAccountLink` path and `agency` mode, but no guest mode.
- How `features.embedded` career sites behave (iframe with a different XFO, or a separate host?).
- Step-title text in the progress bar after sign-in, and whether `progressBarActiveStep` includes the title.
- Whether the resume-parse date revert [17] is reproducible or tenant-specific.
- Rate limits on CXS endpoints for one tab's worth of traffic (expected fine; scrapers report blocks only at volume [30]).
