# UKG (UKG Pro Recruiting / UltiPro, and UKG Ready)

> Summary: UKG has **two unrelated recruiting front ends**. **UKG Pro Recruiting** (formerly UltiPro) is at `recruiting.ultipro.com/<TENANT>/JobBoard/<boardGuid>/…`. It is server-rendered ASP.NET MVC with **Knockout 3.4** view models, newer React islands, and UKG "Ignite" web components (`ukg-button` etc. with shadow roots). Apply **requires an account**, with sign-in on an Auth0 universal login at `signin-us.ultipro.com`. The apply form is multi-step with stable `data-automation` hooks and native inputs/selects. **UKG Ready** (formerly Kronos Workforce Ready) is at `secure<N>.saashr.com/ta/<companyId>.careers?…`. It is a React SPA backed by a public JSON REST API. Depending on tenant settings it offers either a **guest "Apply for Job" modal** (name/email/phone/resume) or a guest multi-step wizard ("Use my resume" / "Type it in myself"). Fields have random ids but stable `name` and `data-test` attributes. Difficulty: Pro **medium** (blocked by login, but has clean hooks); Ready **low-medium**.
> Last researched: 2026-10-04

## 1. Detection

### UKG Pro Recruiting
| Signal | Value | Marker |
|---|---|---|
| Host | `recruiting.ultipro.com`, `recruiting2.ultipro.com`; also `*.ultipro.ca`, `*.rec.pro.ukg.net` | [verified-live] recruiting.ultipro.com [1]; others [code] [6] [8] |
| Job board | `^https://[^/]+/([A-Za-z0-9]+)/JobBoard/([0-9a-f-]{36})/?(\?.*)?$` (tenant alias like `SER1005SEIU`, `DAN1006DMT`) | [verified-live] [1] [2] |
| Job detail | `…/JobBoard/<guid>/OpportunityDetail\?opportunityId=([0-9a-f-]{36})`. Links in the wild sometimes have a double slash `//OpportunityDetail` | [verified-live] [1]; double slash seen in listings [code] [9] |
| Apply | `…/JobBoard/<guid>/OpportunityApply?opportunityId=<guid>`. Unauthenticated requests get a 302 to `…/Account/Login?redirectUrl=…`, which leads to `signin-us.ultipro.com/u/login?state=…` (Auth0) | [verified-live] [1] |
| Other routes | `QuickApply?opportunityId=` (returned 404 to a plain GET), `JobBoardView/LoadSearchResults` (POST), `JobBoardView/GetFilters`, `AnonymousSessionCheck`, `Locations/Suggest`, `Styles/BrandingSettings?brandId=` | [verified-live] [1] [2] |
| Assets | `rec-cdn-prod.cdn.ultipro.com/rec-web/<sha>/{jqueryBundle.min.js,reactBundle.js,react-components.min.js,site.min.js,siteBundle.js}`, `ignite.cdn.ultipro.com/dls-cdn/ignite/v7.18.0/web-components/ignite/ignite.esm.js` | [verified-live] [1] |
| DOM | `data-bind="…"` (Knockout), `[data-automation]` everywhere (`opportunity-title`, `requisition-number`, `apply-now-button`, `awli-widget-container`, `job-description`), custom elements `ukg-ignite-shell`, `react-ko-bridge`, `ukg-button`, `ukg-menu`, `jobboard-filter-panel`, `calcite-button`; `window.ko.version === "3.4.0"`; inline `new US.Opportunity.CandidateOpportunityDetail({...})` | [verified-live] [1] |

### UKG Ready
| Signal | Value | Marker |
|---|---|---|
| Host | `^secure\d*\.saashr\.com$` (seen secure, secure3, secure4, secure6, secure7, secure10, secure60) | [verified-live] secure6, secure7 [3] [4]; others [code] [10] |
| Career URLs | `/ta/<companyId>.careers?CareersSearch=&lang=en-US` (list), `/ta/<companyId>.careers?ShowJob=<reqId>` (job); optional `ein_id=`, `career_portal_id=`, `InFrameset=1&HostedBy=<domain>` (embedded) | [verified-live] [3] [4]; InFrameset [code] [10] |
| Page | title `<companyId>:Career Search`; scripts `/ta/client/jobs-*.js`, `vendors_*.dll.js`; React (`__reactFiber$…` on inputs), styled-components (`data-styled`); CSS classes `c-button m-rounded m-primary`, `c-applicant-header-login-link` | [verified-live] [3] [4] |
| REST | `/ta/rest/ui/recruitment/companies/%7C<companyId>/job-requisitions?offset=1&size=20&sort=desc&lang=en-US`, `…/job-requisitions/<id>?lang=en-US`, `…/job-search/config`, `/ta/rest/v2/companies/%7C<id>/lookup/job-req/job-locations` | [verified-live] [3] |

## 2. Application flow

### UKG Pro
- Detail page: `ukg-button[data-automation=apply-now-button]` with `data-bind="click: function(){ window.location = $parent.opportunityApplyRedirectUrl }"`. The view model also has `isQuickApplyEnabled`, `QuickApplyLink` (`…/QuickApply?opportunityId=`), `showQuickApply`, `applyWithLinkedInWidget`, `applyOptionsApplyAsMyself`, `applyOptionsApplyOnBehalf` and `applyMode`. So an **apply-options modal** (apply as myself / LinkedIn / quick apply) can appear first, depending on tenant flags. [verified-live] [2]
- **Account required:** both tenants checked redirected Apply to Login. The login is Auth0 universal login (`/u/login?state=…`; fields `#username`, `#password`; "Don't have an account? Sign up"). The legacy `…/Account/Register` route returns **404** now. Recipes matching `Account/Register*` are **stale**. [verified-live] [1]
- Feature flags on the page include `EnableRegisterSecurityControl`, `EnableApplicationSecurityControl` and `EnableIpBlocking` (bot or abuse controls exist; I could not tell what they render). [verified-live] [1]
- After login, `OpportunityApply` is a multi-step form. Next is `ukg-button[data-automation=btn-next]` (older: `input[type=submit][value*=Next]`). Submit is `ukg-button[data-automation=btn-submit]` or `input[type=submit][value="Submit Application"]`. Success shows "Thanks for applying" / "application was submitted". There is also a `quick-apply-success-banner`. [code] [6]; [verified-live] banner element [1]
- Step transitions: likely server round-trips or Knockout template swaps; not observed [unverified].

### UKG Ready
- The job page has a primary `button.c-button.m-primary` "Apply" and a "Log in" link (`a.c-applicant-header-login-link`). [verified-live] [3]
- **Variant A, Quick apply modal** (tenant 6187871): `[role=dialog]` titled "Apply for Job" with First Name, Last Name, Email, Phone, Resume ("Add Resume" plus "Sample Format"), Other Documents, and tenant custom fields (e.g. `custom_field_7` "Desired Salary"). Buttons: Cancel and Apply. **No account needed.** [verified-live] [3]
- **Variant B, Wizard** (tenant 6000630, `has_questionnaire:true`): "Hello, let's start your application. What's the best way to get your info?" with **"Use my resume"** (parse) or **"Type it in myself"**, plus "Applied here before? Log in". The next step showed "Your Name" (First, Last) and "Email" (Personal Email), with Back and Continue buttons. Steps are swapped in place (same URL, React re-render). [verified-live] [4]
- The REST field `has_questionnaire` predicts the wizard and questionnaire variant. [verified-live] [3] [4]

## 3. Field structure

### UKG Pro (application form; from [6], MIT recipe updated 2026-09-24; not live-verified because login is needed)
Labels: Bootstrap `div.form-group > label` (or `legend` for radio groups). Sections are panels with `data-automation` attributes.

| Field | Selector | Marker |
|---|---|---|
| First / middle / last name | `#FirstName`, `#MiddleName` / `[data-automation=middle-name-textbox]`, `#FamilyName` (skip if `[readonly]`, which is prefilled from the account) | [code] [6] |
| Email / phone | `#Email` (readonly when from account), `#Phone` | [code] [6] |
| Address | `#AddressLine1`, `#AddressLine2`, `#City`, `select#State`, `#PostalCode`, `select#Country` | [code] [6] |
| Links | `#LinkedIn`, `#GitHub`, `#Portfolio`, `#Website`, `#Twitter`, `#Behance`, `#Dribbble`; panel `[data-automation=links-panel]` with its own `save-button` | [code] [6] |
| Resume | `[data-automation=application-documents] input[type=file]` | [code] [6] |
| EEO | `select#Gender`, `select#HispanicOrigin`, `select[id*=Ethnic]`, `select#USFederalContractor` / `[id*=Veteran]`, `select[id*=Disability]` or radios `input[data-automation="disability-status-<value>"]`; signature `#YourName` | [code] [6] |
| Screening questions | `div.form-group` (excluding the experience/education/skills/links panels) with `label`/`legend` + native `select` / `textarea` / `input[type=radio\|checkbox]` (option text in the following `span`); hidden variants wrapped in `[style*="display: none"]` | [code] [6] |

Detail-page Knockout bindings use `$.t('…')` i18n keys. The form is probably Knockout-bound as well (`data-bind="value: …"`) [unverified].

### UKG Ready (verified live, Variant A/B)
| Field | Selector | Notes |
|---|---|---|
| First name | `input[name=first_name]` / `[data-test="first_name--form-control__tag"]` | id is random (`kbMTEOx8…`); `label[for]` works |
| Last name | `input[name=last_name]` / `[data-test="last_name--form-control__tag"]` | |
| Email | `input[type=email][name=email]` | label "Email" or "Personal Email" |
| Phone | `input[name=phone]` | |
| Custom | `input[name^=custom_field_]` with `aria-label` = question text | |
| Resume | `input#_file_input_0[type=file][name=file]` (display:none) behind `button[aria-label="Upload File"]` "Add Resume" | |

Required: `aria-required="true"` (native `required` is false). Pattern: `[data-test="<name>--form-control__tag"]`. [verified-live] [3] [4]

## 4. Widgets

| Widget | Platform | Behavior / recipe | Marker |
|---|---|---|---|
| Native `input`/`select`/`textarea` | Pro | Knockout `value` bindings update on `change` by default (or `input` with `textInput`/`valueUpdate`). Set `.value`, then dispatch `input`, `change` and `blur`. Selects: set `.value` + `change`. The recipe uses its "default" method with no special handling. | [code] [6]; KO semantics [unverified] |
| Typeahead (job title/company/school in experience) | Pro | Recipe adds a 500 ms delay after typing title and school (suggestion lists) | [code] [6] |
| Skills tag input | Pro | `input[aria-label=Skills]`, then `button[data-automation=item-add-button]` | [code] [6] |
| `ukg-button` (Ignite web component) | Pro | Has an **open shadow root**; the click handler is a Knockout `click` binding on the host, so `host.click()` works. Ignite is a Stencil-style design system (`ignite.esm.js`) [unverified]. | [verified-live] shadowRoot [2] |
| React controlled inputs | Ready | Inputs have `__reactProps$…`. Use the **native value setter** (`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,v)`), then dispatch `input` with `bubbles`. Plain `el.value=` is overwritten. Same approach as Greenhouse/Lever React forms. | [verified-live] React presence [3]; recipe [unverified] |
| Month/year dates | Pro (experience) | `select[data-automation=from-month-dropdown]` + `input[data-automation=from-year-textbox]` (and `to-*`): plain native fields | [code] [6] |

## 5. Repeating sections

UKG Pro [code] [6]:
- Work experience: `div[data-automation=work-experience-panel]`. Add with `button[data-automation=primary-action-button]`; entries are `li[data-automation=panel-list-item]`. Fields: `job-title-textbox`, `company-textbox`, `location-textbox`, `from-month-dropdown`, `from-year-textbox`, `to-month-dropdown`, `to-year-textbox`, `description-textarea`. Each entry needs `button[data-automation=save-button]`, after which it switches to `edit-button`. New items are inserted at the top (`reverse: true`).
- Education: `div[data-automation=education-panel]`, same add/save pattern, `school-textbox`, `degree-textbox` (free text, with a value map of degree names in the recipe), major etc.
- Skills: `div[data-automation=skills-panel]`; Links: `div[data-automation=links-panel]`.
- Edit happens in place inside the list item (not a modal).
- Resume parse: "Indeed resume" import flags exist (`IndeedResume…` feature toggles) [verified-live] [1]. Parse and prefill behavior is not observed.

UKG Ready: the wizard offers "Use my resume" (parse first). Repeating sections were not reached. [verified-live] [4]

## 6. Resume upload

- **Ready:** hidden `input[type=file]#_file_input_0[name=file]`, `accept="application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/rtf"`, single file; triggered by "Add Resume" (`button[aria-label="Upload File"]`). There is a separate "Other Documents" uploader. The DataTransfer approach (`input.files = dt.files` + `change`) should work because the input is in the light DOM [unverified]. [verified-live] [3]
- **Pro:** `[data-automation=application-documents] input[type=file]`, or a label "Upload Resume" with a sibling file input. [code] [6]

## 7. iframes / shadow DOM

- Pro: no form iframes on the detail page. Ignite components (`ukg-button`, `ukg-menu`, `ukg-tooltip`, `ukg-icon`) have open shadow roots; form inputs appear to be light DOM (the recipe uses plain XPath without shadow traversal). The apply-with-LinkedIn widget lives in `[data-automation=awli-widget-container]`. [verified-live] [1] [2]; [code] [6]
- Pro login is a cross-origin top-level navigation to `signin-us.ultipro.com`. JobScript must not touch it.
- Ready: no shadow roots and no iframes on the career page itself, but tenants can **embed the portal in an iframe** on their own site (`…careers?CareersSearch&InFrameset=1&HostedBy=www.example.com`). The content script then needs `all_frames: true` and a host match on `*.saashr.com`. [verified-live] [3]; InFrameset [code] [10]
- Host permissions: `https://recruiting.ultipro.com/*`, `https://recruiting2.ultipro.com/*`, `https://*.ultipro.ca/*`, `https://*.rec.pro.ukg.net/*`, `https://*.saashr.com/*`.

## 8. Job / requisition ID

| Platform | Source | Pattern | Marker |
|---|---|---|---|
| Pro | URL | `[?&]opportunityId=([0-9a-f-]{36})` | [verified-live] [1] |
| Pro | DOM | `[data-automation=requisition-number]` (`data-bind="text: RequisitionNumber()"`), e.g. `EXECU003492` | [verified-live] [1] |
| Pro | Inline JSON | `new US.Opportunity.CandidateOpportunityDetail({"Id":"<guid>","Title":…,"RequisitionNumber":"…","PostedDate":…,"Locations":[…]})` | [verified-live] [1] |
| Pro | Tenant/board | path segments `/<TENANT>/JobBoard/<boardGuid>/` | [verified-live] [1] |
| Ready | URL | `[?&]ShowJob=(\d+)` (e.g. `738638679`); company `/ta/(\d+)\.careers` | [verified-live] [3] |
| Ready | API | `GET /ta/rest/ui/recruitment/companies/%7C<cid>/job-requisitions/<id>?lang=en-US` returns JSON (`id`, `ein_id`, `job_title`, `location`, `has_questionnaire`, `job_preview`, …); the list endpoint is the same without `/<id>` | [verified-live] [3] [4] |

There is no JSON-LD on either platform (Pro detail page: none found). [verified-live] [1]

## 9. Automation restrictions

- `recruiting.ultipro.com/robots.txt`: `Disallow: /`, `Allow: */JobBoard/`, `Disallow: */JobBoardView`, `*/JobBoard/*/Styles` and `*/AnonymousSessionCheck`. This concerns crawlers, not an extension acting in the user's tab. [verified-live] [1]
- UKG website terms say users may not use "any robot, spider, scraper or other automated means" to access the site or UKG accounts. These are the ukg.com corporate site terms; the candidate portal's own terms were not found. [docs] [5]
- Pro tenant flags `EnableRegisterSecurityControl`, `EnableApplicationSecurityControl` and `EnableIpBlocking` suggest captcha or IP controls on register and apply [verified-live] flags [1]; I did not see what they render.
- No captcha on UKG Ready's guest apply modal or the first wizard step. [verified-live] [3] [4]
- Pro requires the user's own login, which JobScript must never perform. Start the adapter only on `OpportunityApply` after the user has signed in.

## 10. Sources

1. https://recruiting.ultipro.com/SER1005SEIU/JobBoard/e131b2ae-a5ce-4fb1-a93c-84c36a485721/OpportunityDetail?opportunityId=248c0a17-209f-4a46-a715-d5d46478851f, plus that board's job list, the Apply redirect, the Auth0 login page and robots.txt (Knockout version, `data-automation` list, inline JSON, 404 on `Account/Register`). Inspected in a browser tab; nothing typed. [verified-live]
2. https://recruiting.ultipro.com/DAN1006DMT/JobBoard/aab9b8ae-463c-48fc-8362-a25df8be0c77/OpportunityDetail?opportunityId=389d0800-a787-4988-8b87-14e348e21b01 (apply view-model keys: quick apply, LinkedIn, apply options; `ukg-button` shadow root). [verified-live]
3. https://secure6.saashr.com/ta/6187871.careers?ShowJob=738638679 (UKG Ready quick-apply modal fields; opened with Apply, then Cancel, nothing typed), plus the REST list endpoints for companies 6187871, 6194071, 6000630 and 6177719 (the last returned a 410 "Functionality is not available"). [verified-live]
4. https://secure6.saashr.com/ta/6000630.careers?ShowJob=755374853 (UKG Ready wizard: "Use my resume"/"Type it in myself", first step fields, REST detail with `has_questionnaire`). [verified-live]
5. https://www.ukg.com/terms-of-use (UKG website terms, automated-access clause). [docs]
6. https://github.com/kensac/job-scripts/blob/main/extension/adapters/recipes/Ultipro.json (recipe updated 2026-09-24: host patterns incl. `*.ultipro.ca`/`*.rec.pro.ukg.net`, `data-automation` hooks, field ids, panels, Next/Submit). MIT. [code]
7. https://github.com/amikai/openings-mcp (`internal/provider/ultipro/testdata/detail_rsp.html`: UltiPro detail-page scraper fixture; not read in depth). MIT. [code]
8. https://github.com/fkabaalkhail/Applypilot/blob/main/chrome-extension/src/content/siteRegistry.ts (UKG Pro URL patterns). No license. [code]
9. https://github.com/SimplifyJobs/Summer2027-Internships (job listings containing real `recruiting.ultipro.com/<TENANT>/JobBoard/<guid>//OpportunityDetail?opportunityId=` links, used to find tenants). [code]
10. GitHub code search results for `saashr.com/ta` (e.g. https://github.com/tBaxter/DSCovery showing `…careers?CareersSearch&InFrameset=1&HostedBy=…`; https://github.com/theWallProject/mono with `ein_id`/`career_portal_id`). Licenses not checked; URLs only. [code]
11. https://secure7.saashr.com/ta/6205817.careers?CareersSearch=&ein_id=118955149&career_portal_id=4489223&lang=en-US (empty board; confirms the SPA shell and REST calls). [verified-live]

## Open questions

- The UKG Pro `OpportunityApply` DOM after login: whether it is still Knockout + `data-automation` as in [6] or has moved to React or Ignite web components, how steps transition, whether a review step exists, and whether resume-parse prefill exists.
- What `EnableApplicationSecurityControl` renders (captcha?).
- When UKG Pro shows `QuickApply` (guest) instead of Login. `showQuickApply` was false on both tenants checked.
- UKG Ready wizard steps after name/email (experience/education/questionnaire/EEO) and how resume parse fills them.
- Whether UKG Ready React inputs accept the native-setter + `input` event recipe (expected, untested since typing was off-limits).
