# SAP SuccessFactors Recruiting

> Summary: Two front ends work together. **Career Site Builder (CSB / "jobs2web/RMK")** is a jQuery/Bootstrap job-ad site on the customer's own domain (`careers.<company>.com/job/...`). Its Apply button hands off to the **classic SuccessFactors career portal** at `career<N>.successfactors.{com,eu}` / `career<N>.sapsf.{com,eu}` (`/career?company=…&career_job_req_id=…`). That portal **usually requires a candidate account**. Some tenants instead show an inline guest form that creates the account during apply. The application form is built from SAP's legacy **JUIC** widget library (`SFComboBox`, `SFTextField`, `SFDatePickerWidget`, ids like `52:_input`). Despite expectations, it is **not** SAPUI5 `sap.m.*` controls with `__xmlview0--` ids: UI5 1.142 is loaded only for the page shell. Picklists are custom comboboxes. The resume file input is created lazily. Field layout varies per tenant (configurable templates). A newer "Reimagined Candidate Experience" runs on the CSB domain; I could not observe it live. Difficulty: **high**.
> Last researched: 2026-10-04

## 1. Detection

| Signal | Value | Marker |
|---|---|---|
| Classic portal host | `^career\d*\.successfactors\.(com\|eu)$`; also `career\d*\.sapsf\.(com\|eu)` (e.g. `career55.sapsf.eu`) | [verified-live] career5.successfactors.eu [1]; sapsf [code] [6] [7] |
| Classic URLs | `/career?company=<CompanyId>&career_ns=job_listing&career_job_req_id=<n>` (job), `/careers?company=<id>` (sign-in), `/career?…&login_ns=register&career_ns=job_application&career_job_req_id=<n>&jobPipeline=Direct&clientId=jobs2web&brandUrl=<brand>` (register for an application) | [verified-live] [1] |
| Company id | `company=` query param (e.g. `EYHRISPRD1`, `yashtechnoP`); CSB exposes it as `j2w.init({ssoCompanyId:'…', ssoUrl:'https://career10.successfactors.com'})` | [verified-live] [1] [2] |
| CSB job-ad URLs | `https://<customer-domain>/job/<Slug>/<jobId>/` or `/<brand>/job/<Slug>/<jobId>/`; apply link `/talentcommunity/apply/<jobId>/?locale=en_US` | [verified-live] [2] [3] |
| CSB DOM/assets | `/platform/js/j2w/min/j2w.core.min.js`, `/platform/csb/css/...`, `rmkcdn.successfactors.com/<hash>/…css`, jQuery from `performancemanager<N>.successfactors.com/verp/vmod_v1/ui/extlib/jquery_3.5.1/`, `body.coreCSB`, `.jobDisplayShell[itemtype="http://schema.org/JobPosting"]`, `[data-careersite-propertyid=title|city|date|customfieldN|description]`, `a.dialogApplyBtn` ("Apply now »"), `.social-apply-button-container` (Apply with LinkedIn), `form#emailsubscribe[action^="/talentcommunity/subscribe/"]` | [verified-live] [2] [3] |
| Classic portal DOM/assets | `/verp/vmod_v1/ui/juic/js/…`, `/ui/rcmcommon/js/rcmThemeable_*.js`, `/verp/vmod_v1/ui/widget-loader/…`, globals `juic`, `surj`, `SFComboBox`, `SFTextField`, `SFDatePickerWidget`, `j2w`; `form#careerform`; hidden inputs `career_job_req_id`, `career_job_req_sec_key`, `career_ns`; title prefix "Career Opportunities: …" | [verified-live] [1] |
| UI5 | `sap.ui.version` = `1.142.3`; loaded libs `sap.ui.core, sap.m, sap.sf, sap.sf.surj.shell`; **0** `[data-sap-ui]` elements on the job, sign-in and register pages | [verified-live] [1] |

## 2. Application flow

1. **CSB job page** (customer domain) -> "Apply now »" (`a.dialogApplyBtn`). It may open an apply-options dropdown ("Apply Now", "Start apply with LinkedIn"). [verified-live] [2] [3]
2. `/talentcommunity/apply/<jobId>/` -> **full page load** to `career<N>.successfactors.eu/careers?company=<id>`: a "Sign In" page with native `#username` and `#password` fields, and "Create an account" -> register page (`login_ns=register`). The register form has native fields `fbclc_userName`, `fbclc_emailConf`, `fbclc_pwd`, `fbclc_pwdConf`, `fbclc_fName`, `fbclc_lName`, `select#fbclc_ituCode`, `fbclc_phoneNumber`, `select#fbclc_country`, and checkboxes `fbclc_emailEnabled` / `fbclc_campaignEmailEnabled`. [verified-live] [1] (EY tenant; account creation was not performed)
   - Hitting `/talentcommunity/apply/<id>/` directly without the job-page session redirected to the site home. A content script should not navigate there itself. [verified-live] [3]
3. Classic job page `career?career_ns=job_listing&…` shows `button#applyButton_top` / `#applyButton_bottom` ("Apply") and a top-bar "Sign In" link. [verified-live] [1]
4. **Guest-apply variant (tenant-configurable):** on some tenants, clicking Apply reveals the application **inline** on the same page. It combines self-registration fields (`fbclc_*` email/password/name/phone), resume and cover letter, the questionnaire and EEO. The final button is `button#fbqa_apply` inside `span#qaApplyBtnWrapper` (clicking the wrapper does nothing). A privacy notice link `a#dataPrivacyId` opens a `[role=dialog]` that needs "Acknowledge". [code] [6]
5. **Signed-in application form:** a sectioned form (`div.rcmFormSection`, headers `button.rcmFormSectionTopBar`). Wizard variants use `span[role=button][id*=nextBtn]` / `[id*=submitBtn]`; single-page variants use `button[name=fbja_apply]`. Success shows `#applyConfirmMsg` / `#success_message` ("Thank you"). [code] [5]
6. **Reimagined Candidate Experience** (newer, needs CSB + Mobile Apply + DPCS 2.0): applying happens **on the career-site domain**. It is wizard-based if the template has more than 2 sections, otherwise form-based. Resume parsing prefills sections. Business rules show and hide fields dynamically. An account is still required. [docs] [9]. The recipe in [5] contains Fiori Fundamentals selectors (`fd-panel__title`, `fd-input`, `th.formFieldLabel`), which likely belong to this UI [unverified].
7. Session expiry: one bot reports the SF session expires quickly and fails silently (picklists stop opening) [code] [6].

## 3. Field structure

Classic form (signed-in), from [5] [6]:
- Each field is a `div.RCMFormField` with `label.rcmFormFieldLabel` (or `.rcmFormQuestionLabel`) and a sibling `div.fieldComponentInput` (or `.attachmentComponentInput`). Labels are **siblings**; `for` is not reliable. [code] [5]
- JUIC ids contain colons: `<n>:_txtFld` (text), `<n>:_input` + `<n>:_selectButton` (picklist), `<n>:_attachIcon` / `<n>:_attachLabel` (attachment). `juic._idCharacter === ":"`, verified live. Escape the colons in CSS selectors (`CSS.escape`), or use `getElementById`. [verified-live] separator [1]; ids [code] [6]
- Backing values: picklist hidden inputs have `name`s like `tor__f<FieldId>` (e.g. `tor__fcustUKEthnicity` -> numeric option id), `tor__fcellPhone`, `tor__fcust_Signature`. [code] [5] [6]
- Questionnaire items use `span.questionFieldLabel` with radio/checkbox spans `span[role=radio]`. [code] [5]
- Required: a `*` in the label text plus `aria-required="true"` on the combobox input (rendered by `SFComboBox._renderInput`). [verified-live] source [1]
- After a failed save, a top banner reads "Please complete all required fields and re-submit. The following fields require a valid input: …". [code] [6]

| Standard field | Selector / identifier | Marker |
|---|---|---|
| First name | `#fbclc_fName` (register/guest), `input[name=firstName]` (profile) | [verified-live] fbclc [1]; [code] [5] |
| Last name | `#fbclc_lName`, `input[name=lastName]` | same |
| Email | `#fbclc_userName` (+ `#fbclc_emailConf`), `input[name=contactEmail]` | same |
| Phone | `#fbclc_phoneNumber` + `select#fbclc_ituCode` (native select of ITU codes); `input[name=cellPhone]`/`#tor__fcellPhone` | same |
| Country of residence | `select#fbclc_country` (native); in form: label "Country" -> `.fieldComponentInput input[role=combobox]` | same |
| City / zip / address | `input[name=city]`, `input[name=zip]`, `input[name=address\|addressLine1\|addressLine2]` | [code] [5] |
| Resume / cover letter | label "Resume"/"Cover Letter" -> `.attachmentComponentInput` -> `div.attachmentLabel` / `span[id$=":_attachIcon"]` | [code] [5] [6] |
| Signature | `input[name=tor__fcust_Signature]` | [code] [5] |
| Today's date | `input[placeholder="MM/DD/YYYY"][aria-label="Today's Date Required"]` | [code] [5] |
| EEO (gender/ethnicity/veteran/disability) | label text -> `.fieldComponentInput input[role=combobox]`; some tenants `select[name=gender]` | [code] [5] |

Tenants configure field sets per job application template. Expect custom `tor__fcust*` fields and localized labels.

## 4. Widgets

| Widget | Build | Registering a value | Marker |
|---|---|---|---|
| Native text inputs (`fbclc_*`, `#username`) | plain `<input class="form-control">` | Set `.value`, then dispatch `input`, `change` and `blur`. | [verified-live] markup [1]; [code] [6] |
| Native selects (`fbclc_ituCode`, `fbclc_country`) | `<select>` | Set `.value` and dispatch `change`. | [verified-live] [1]; [code] [6] |
| `SFTextField` | JUIC; `<n>:_txtFld` | Has `_handleChange`/`_handleInput`/`handleOnkeyup` wired as inline handlers. `input` + `change` + `blur` should register [unverified]. | [verified-live] prototype [1] |
| `SFComboBox` (picklists, the main pain point) | JUIC string-rendered `<input type="text" role="combobox\|listbox" autocomplete="off" aria-required …>` with **inline** `oninput`, `onkeydown`, `onkeyup`, `onblur`, `onmousedown` attributes (`_getInputEventFireCodes`) + toggle `button#<n>:_selectButton`; popup list `li[role=option]` | `_onInput` runs on a `setTimeout(0)`, reads `input.value`, compares it with the previous filter, then shows or hides the popup (respecting `_minimumFilterSize`). The value commits only in `_onItemSelected`, which calls `_commitValue()` and dispatches `itemSelected`. Recipe: focus, set value, dispatch `input` (plus keydown/keyup), wait about 1-1.5 s, click the `li[role=option]` whose text **exactly** matches, then **re-read `input.value`**. Long lists (country, ethnicity) are virtualized and asynchronous; a fuzzy fallback **committed the wrong neighboring option** in one bot run. Committing one picklist can **re-render and blank other already-filled picklists or radios**, so do a final sweep. | [verified-live] source [1]; behavior [code] [6] |
| `SFDatePickerWidget` | Loaded via `WidgetUtil.getWidget("xweb/calendar-widget")`; the element is found by `[data-testid=datePicker]` inside its root; events use the UI5-style `getParameter("value")` / `actionCommand: "fieldChange"` | The widget fires `change` itself. The likely recipe is to set the value on the `[data-testid=datePicker]` element and fire its change event [unverified]. Whether that element is a UI5 web component with a shadow root was **not observed**. | [verified-live] source [1] |
| Radios / checkboxes (questionnaire) | `span[role=radio]`, native checkbox/radio in labels | Click the label or span. | [code] [5] |
| `SFRadioGroup`, `SFCheckboxMultiSelect`, `SFAutoComplete`, `SFTextArea` | JUIC globals present | not examined | [verified-live] globals [1] |

The brief's expectation of `sap.m.Input` / `ComboBox` / `DatePicker` with `__xmlview0--…` ids was **not confirmed** on the classic portal. Those ids would only appear in the UI5 shell, or possibly in the Reimagined Candidate Experience. Keep a UI5 code path as a fallback: `sap.ui.getCore().byId(id).setValue(v)` followed by `fireChange({value:v})` works only from the page's main world, not from the isolated world [unverified].

## 5. Repeating sections

- Classic: sections such as "Work Experience"/"Employment", "Education", "Languages" and "Skills/Assignments/Projects" are `div.rcmFormSection` with a header `button.rcmFormSectionTopBar`. Rows are `div.rcmSectionComponent`. Add with `div[role=button][title="Add new row"]` or `span.addIcon`. Rows are indexed by position. [code] [5]
- Alternate layouts: `div.sfCollapse[aria-label*=Experience] div.bgFieldsLayout` (profile), and Fiori `span.fd-panel__title` -> `div.fd-panel__content table` (new UI). Language uses `a[role=button][aria-label^=Add]`. [code] [5]
- **Candidate profile reuse:** once signed in, the profile (name, email, phone, resume, background sections) carries over to later applications on the same tenant. Signing in mid-form **replaced a guest-uploaded CV with the stored one**. Autofill should check existing values before overwriting. [code] [6]
- Resume parse (Reimagined CE) prefills sections. Collision behavior is unknown. [docs] [9]

## 6. Resume upload

- Classic: **no `input[type=file]` exists until** a click on the attach control, `span#<n>:_attachIcon` (role=button, plus glyph; a pencil glyph `glyphicon-pencil addAttachments` when a file already exists). Clicking `div#<n>:_attachLabel` ("Upload a Resume") does nothing per [6], though [5] clicks the label. The click creates `input[name="fileData1"]` (or `input.fileUpload` / `input[type=file][name*=fileData]` inside an `sfPanelComponent` titled "Upload Resume"). Some variants need an **Upload** button (`button[title=Upload]`) after choosing the file, and confirm with `span.important-focus-msg` "resume has been uploaded". [code] [5] [6]
- One bot says this requires a *trusted* click on the icon [code] [6]. A synthetic `.click()` from an extension may not work. Fallback: highlight the control and ask the user to click, then set `files` via DataTransfer on the new input and dispatch `change` [unverified].
- CSB "Apply with resume"/LinkedIn options exist on the job-ad dropdown. [verified-live] [3]

## 7. iframes / shadow DOM

- Classic portal: no form iframes. The only frame seen was the CSB cookie-manager iframe `/widgets/cookiemanageriframe/`, which overlays clicks until consent is given. No shadow roots in the classic form. [verified-live] [1]
- Cross-origin hand-off: CSB (customer domain) and the portal (`career*.successfactors.*`) are separate top-level navigations, not frames. The adapter needs host permissions for `https://*.successfactors.com/*`, `https://*.successfactors.eu/*`, `https://*.sapsf.com/*`, `https://*.sapsf.eu/*`, plus the **customer CSB domain** for job capture (unknown in advance, so use `optional_host_permissions` / activeTab). [verified-live] [1] [2]
- Some customers embed or iframe the career site in their corporate site [unverified].

## 8. Job / requisition ID

| Source | Pattern | Marker |
|---|---|---|
| Classic URL | `[?&]career_job_req_id=(\d+)` (e.g. `1738189`); hidden `input#career_job_req_id` | [verified-live] [1] |
| Page title | `Career Opportunities: <Title> \((\d+)\)$` | [verified-live] [1] |
| CSB URL | `/job/[^/]+/(\d+)/?` is the **CSB jobId** (e.g. `1429226433`), which is **not** the SF req id | [verified-live] [3] |
| CSB DOM | "Requisition ID" in `.joblayouttoken-label` + `[data-careersite-propertyid=customfieldN]` (tenant-specific; EY shows its own id `1738189`, which matched the SF req id here) | [verified-live] [3] |
| Register URL | `career_job_req_id=` is preserved through the login/registration hand-off | [verified-live] [1] |

## 9. Automation restrictions

- No captcha was seen on the sign-in or registration pages (EY tenant). The CSB pages set `X-CSRF-Token` for AJAX. The password policy regex is exposed in `j2w.init` (`passwordRegEx`). [verified-live] [1] [2]
- Some customer front ends sit behind Cloudflare challenges; `jobs.sap.com` returned "Just a moment…" to curl. That site has since moved off CSB. [verified-live]
- Terms: there are no global candidate ToS. Each tenant links its own terms and privacy statement. The DPCS privacy statement must be accepted before profile creation. [docs] [10]
- JobScript never creates accounts, never enters passwords and never submits. On SuccessFactors the user must sign in or register themselves. The adapter should start only on the application form.

## 10. Sources

1. https://career5.successfactors.eu/career?career_ns=job_listing&company=EYHRISPRD1&career_job_req_id=1738189 plus the sign-in page `/careers?company=EYHRISPRD1` and the register page (`login_ns=register…`). Inspected in a browser tab (JUIC globals and prototypes, `SFComboBox` render and handlers, UI5 version); nothing typed. [verified-live]
2. https://careers.yash.com/job/Bangalore-Lead-Consultant-SAP-MDG-Job-KA/1366306566/ (CSB markup, `j2w.init` with `ssoUrl: career10.successfactors.com`, apply options incl. LinkedIn). [verified-live]
3. https://careers.ey.com/ey/job/New-Delhi-Consultant-Business-Consulting-PI-GOV-CNS-BC-Transformation-Delivery-New-Delhi-Nati-110037/1429226433/ (CSB job ad, `dialogApplyBtn`, Requisition ID token, hand-off to career5). [verified-live]
4. https://jobs.sap.com/ (Cloudflare challenge to curl; no longer CSB). [verified-live]
5. https://github.com/kensac/job-scripts/blob/main/extension/adapters/recipes/SuccessFactors.json (recipe updated 2026-09-24: `rcmFormField`, attachments, `applyButton_top`, `nextBtn`/`submitBtn`, `fbja_apply`, repeating sections, Fiori `fd-*` variants). MIT. [code]
6. https://github.com/privacydied/job-application-skill/blob/main/sites/successfactors/NOTES.md and `scripts/sf_apply.py` (2026-08 field notes: guest inline apply, `<n>:_input`, `:_attachIcon`, `fileData1`, picklist mis-commit and re-render blanking, `#fbqa_apply`, session expiry). MIT. [code]
7. https://github.com/fkabaalkhail/Applypilot/blob/main/chrome-extension/src/content/siteRegistry.ts (domains `successfactors.com`, `successfactors.eu`, `sapsf.com`). No license. [code]
8. https://github.com/tmwclaxton/autoapplycv/tree/main/tests/fixtures/form-extraction/expected (`web-career8-successfactors-com-careers-3.json`, `https-career4-successfactors-com-career.json`: captured register forms). License NOASSERTION. [code]
9. https://learning.sap.com/courses/sap-successfactors-recruiting-candidate-experience-academy/enabling-the-reimagined-candidate-experience-for-career-site-builder_b0932b6e-d62e-451b-a315-831518ee3df7 (Reimagined Candidate Experience: wizard vs form, resume parse, prerequisites). [docs]
10. https://learning.sap.com/courses/sap-successfactors-recruiting-candidate-experience-administration/working-with-data-protection-and-privacy-settings (DPCS consent before profile creation). [docs]
11. https://github.com/moudimash99/AirBusAutoApplier (Selenium for Airbus/Capgemini SF tenants; not read in depth). No license. [code]

## Open questions

- What the signed-in application form looks like live on a current tenant (JUIC vs Fiori `fd-*` vs Reimagined CE). Needs a login, which JobScript's rules forbid me from doing.
- Whether `SFComboBox` options commit from synthetic events in an extension's isolated world. The inline `on*` handlers should fire for dispatched events [unverified].
- What `xweb/calendar-widget` actually renders (UI5 web component with shadow root?) and how to set it.
- Whether the attach icon needs a trusted click to create `fileData1`.
- What the Reimagined Candidate Experience looks like: domain, DOM framework, whether UI5 `__xmlview` ids appear.
- Which tenants enable inline guest apply, and how to detect it before clicking Apply.
