# Platform research

One doc per job platform, researched on 2026-10-04 from public pages, vendor docs, the vendors' own public JS bundles and open-source autofill projects. Each claim in a doc is marked **[verified-live]**, **[code]**, **[docs]** or **[unverified]** with a source link. No logins were used, so any step behind a sign-in is built from code and docs only. Each doc lists these gaps under "Open questions".

| Doc | Platform | Difficulty |
|---|---|---|
| [greenhouse.md](greenhouse.md) | Greenhouse (job-boards, embedded iframe) | medium (already supported) |
| [lever.md](lever.md) | Lever | low–medium (already supported) |
| [ashby.md](ashby.md) | Ashby | medium |
| [workday.md](workday.md) | Workday Recruiting | high |
| [icims.md](icims.md) | iCIMS (classic and Jibe career sites) | high |
| [smartrecruiters.md](smartrecruiters.md) | SmartRecruiters (oneclick-ui) | high |
| [successfactors.md](successfactors.md) | SAP SuccessFactors (CSB + classic portal) | high |
| [taleo.md](taleo.md) | Oracle Taleo, plus Oracle Recruiting Cloud (ORC) | medium-high / high |
| [ukg.md](ukg.md) | UKG Pro Recruiting, UKG Ready | medium / low-medium |
| [handshake.md](handshake.md) | Handshake | medium |
| [linkedin.md](linkedin.md) | LinkedIn Easy Apply | high |

## At a glance

| Platform | Rendering | Steps | Account to apply | Frame / shadow | Stable anchor | Public form schema | Bot protection |
|---|---|---|---|---|---|---|---|
| Greenhouse | React (Remix) | 1 page | No | Cross-origin iframe on company sites (`#grnhse_iframe`) | `id` (no `name`) | Yes, boards-api `?questions=true` | Invisible reCAPTCHA, 8-digit email code fallback |
| Lever | Server HTML + jQuery | 1 page | No | Rarely framed | `name` (`cards[<uuid>][fieldN]`) | Per-card `baseTemplate` JSON in the page | Invisible hCaptcha |
| Ashby | React, no `<form>` | 1 page | No | Embed script (`ashby_jid`) | `_systemfield_*` / UUID `id` | Yes, `ApiJobPosting` GraphQL | reCAPTCHA Enterprise |
| Workday | React (Canvas Kit) | 6–8, same URL | Yes, per tenant | Neither (`X-Frame-Options: DENY`) | `data-automation-id`, path ids | Job info via CXS API; questions not public | Cloudflare; honeypot on sign-up |
| iCIMS | Server HTML + jQuery | Several, full reloads | Usually (email first, then password) | **Always** in `iframe#icims_content_iframe` | `name` (`PersonProfileFields.*`, `rcfNNNN`) | No | Invisible hCaptcha |
| SmartRecruiters | Angular + Lit `spl-*` | 2 | No | **Nested open shadow roots** | `data-test`, `formcontrolname` | Partly (`/config` per posting) | DataDome |
| SuccessFactors | Legacy JUIC widgets | Varies per tenant | Usually | Hand-off from company domain | Colon ids (`52:_input`) | No | Unknown |
| Taleo | JSF/FTL postbacks | Several, full reloads | Yes, or guest | Usually unframeable | `dv_cs_<entity>_<Field>` id suffix | No | Session timeout (60 min) |
| ORC | Oracle JET + Knockout | Configurable sections | Email + one-time code | No | `cx-select` etc. | Yes, `recruitingCEApplyFlows` | Honeypot, code lockout |
| UKG Pro | ASP.NET + Knockout + web components | Several | Yes (Auth0) | Some shadow roots on Ignite buttons | `data-automation` | No | Unknown |
| UKG Ready | React | Modal or wizard | No (guest) | Optional iframe (`InFrameset=1`) | `name`, `data-test` | Public REST API | Unknown |
| Handshake | React (styled-components) | 1 modal | Yes (school SSO) | No | `data-hook` | No | Cloudflare |
| LinkedIn | Ember + SDUI | Several, in a modal | Yes | Open shadow root `#interop-outlet` on new layout | `data-test-form-element`, `fb-dash-*` | No | Account restrictions for automation |

## What the platforms share

1. **Labels are findable.** Every platform links labels to inputs through `<label for>`, `aria-labelledby` or a wrapping element. JobScript's existing label matching (`lib/fieldMap.js`) carries over. The differences are in *where* the field lives and *how a value commits*.
2. **Custom comboboxes are the main obstacle.** Greenhouse (react-select), Workday (listbox and `multiSelectContainer` with portal options), iCIMS (hidden `<select>` behind a fake list), SmartRecruiters (`spl-autocomplete`), SuccessFactors (`SFComboBox`), ORC (`cx-select`), Ashby (floating-ui location box) and LinkedIn typeaheads all follow the same pattern: open, type, wait for options (often rendered in a portal outside the field), choose with mousedown/click or Enter, then confirm through a visible "selected" node. The input's own `value` is not proof of a commit on several of them (Greenhouse `.select__single-value`, Workday `selectedItem` chip).
3. **React-style value setting.** Plain `el.value = x` is ignored by React, Angular and Lit. The native setter plus `input`, `change` and `blur` works on Workday, Greenhouse, Ashby and LinkedIn text fields. SmartRecruiters needs it on the *inner* input inside the shadow root.
4. **Split dates.** Workday (`dateSectionMonth/Day/Year-input`), iCIMS (month/day/year selects), Taleo (0-based month selects) and Ashby ("Pick date..." picker) all split dates, which JobScript already partly supports.
5. **Resume parsing runs before or over autofill.** Lever (`/parseResume` overwrites untouched fields), iCIMS (upload submits and redraws the page), Workday ("Autofill with Resume" pre-fills entries), Ashby ("Autofill from resume" re-renders), Taleo and ORC (parse page first). **Rule: attach the resume first, wait for the form to settle, then fill.**
6. **Multi-step without URL changes.** Workday, LinkedIn, SmartRecruiters, ORC and UKG swap steps in place. iCIMS and Taleo reload the page or frame. The panel's existing "new step" detection and Learn mode cover both cases if step identity comes from the adapter instead of the URL.
7. **Repeaters only render after "Add".** Workday, SmartRecruiters, ORC (tiles with per-entry Save), UKG Pro, Taleo (Add reloads the page) and Greenhouse education/employment all create entry inputs only after the Add click, with indexes that aren't always sequential (Workday). Lever and Handshake have no repeaters.
8. **Things JobScript must never touch:** final Submit/Review buttons, LinkedIn "Submit application", Handshake **Quick apply** (submits with no form), password and account-creation fields (iCIMS profile, Workday sign-up), and honeypots (Workday `beecatcher` / `name=website`, ORC honeypot input). Captchas are always left to the user.
9. **Job IDs are cheap almost everywhere:** URL paths or params on all of them, plus public JSON (Greenhouse, Lever, Ashby, Workday CXS, SmartRecruiters, UKG Ready, ORC) and JSON-LD on some. `jobIdFromUrl` in `lib/storage.js` needs widening for Workday req ids (`JR-0107491`, `R4046019`, `_R12345-1`), `ashby_jid`, `career_job_req_id`, `opportunityId` and Taleo's `job=`.

## What's unique to each

- **Greenhouse:** no `name` attributes. Forms embedded on company sites live in a cross-origin iframe. The public API gives the whole schema, including option lists, before touching the DOM.
- **Lever:** the location typeahead searches on keydown and clears itself on blur unless an option is chosen with mousedown. Card schemas are embedded as JSON in hidden inputs.
- **Ashby:** Yes/No answers are `aria-pressed` buttons over a hidden checkbox, so the button has to be clicked. A multi-select's `name` is the option text, not the question.
- **Workday:** tenant sign-in on every application. A `click_filter` overlay sits over buttons. Options render in a portal. Much of the open-source selector lore is stale against the 2026.40 bundle; the doc's id list comes from the live bundle.
- **iCIMS:** the frame is mandatory, and loading the frame URL as the top page redirects back to the wrapper. Uploading a resume redraws the form, wiping filled values.
- **SmartRecruiters:** the only platform where shadow DOM is unavoidable. Hosts and inner inputs share ids. DataDome is in front.
- **SuccessFactors:** two IDs (CSB jobId ≠ `career_job_req_id`). Uses JUIC rather than SAPUI5. The resume input is created lazily.
- **Taleo / ORC:** Taleo has very long generated JSF ids (match on the suffix, use `getElementById` because of colons). ORC exposes its flow structure as public JSON and runs Oracle's chat assistant with its own inputs, which must be excluded.
- **UKG:** two unrelated products. Pro has clean `data-automation` hooks but needs an account. Ready allows guest apply and may be framed.
- **Handshake:** most data is sent from the profile automatically. The work is choosing documents from the library and answering radios, and the inputs are hidden behind labels.
- **LinkedIn:** three DOM variants at once. The User Agreement prohibits automation tools, so even user-triggered fill carries account risk.

## Recommended adapter interface

Keep `lib/fieldMap.js` as the one place for per-site config, and turn each `sites[]` entry into an adapter. Everything is optional: a site that only sets `hosts` and `formSelectors` keeps today's generic behaviour.

```js
{
  name: 'Workday',

  // Detection
  hosts: [/\.myworkdayjobs\.com$/i, /^wd\d+\.myworkdaysite\.com$/i],
  detect(doc) {},             // optional DOM check for custom domains (e.g. iCIMS frame, Jibe, Taleo /careersection/)
  frames: false,              // true when the form lives in a frame (iCIMS, Greenhouse embed, UKG Ready)
  shadow: false,              // true to walk open shadow roots (SmartRecruiters, LinkedIn interop, UKG Ignite)

  // Where the form is, and which step it is on
  roots(doc) {},              // form containers to scan, including shadow roots
  step(doc) {},               // { key: 'applyFlowMyExpPage', label: 'My Experience', index, total } or null
  isFinalStep(doc) {},        // review/submit page: fill nothing, just highlight

  // Fields
  fieldSelectors: [],         // extra field wrappers, e.g. '[data-automation-id^="formField-"]'
  label(field) {},            // override label lookup when it isn't for/aria/wrapping
  never: [],                  // honeypots, password, submit and quick-apply controls; never filled or clicked

  // Values: one per widget kind; fall back to the shared helpers below
  widgets: {
    select:   async (el, value) => {},
    combobox: async (el, value) => {},
    date:     async (el, isoDate) => {},
    yesNo:    async (el, bool) => {},
  },

  // Repeating sections
  repeaters: {
    work:      { section, addButton, entries(root) {}, save(entry) {} },
    education: { section, addButton, entries(root) {}, save(entry) {} },
  },

  // Resume
  upload: { input(root, kind) {}, parses: true, settle(doc) {} },  // parses: attach first, await settle(), then fill

  // Job info for the tracker
  jobId(url, doc) {},
  jobInfo(doc) {},            // { title, company, description }
  schema: async (url) => {},  // optional public form schema (Greenhouse API, Lever baseTemplate, Ashby GraphQL, ORC apply flow)
}
```

Shared helpers to build once in `content/autofill.js` and reuse across adapters:

- `setNativeValue(el, v)`: prototype setter, then `input`, `change` and `blur`.
- `deepQueryAll(root, sel)`: recurses into open `shadowRoot`s.
- `commitOption(trigger, text, { optionSelector, portal, confirm })`: the shared open/type/wait/choose/confirm sequence for all comboboxes. It retries once and reports failure instead of guessing.
- `attachFile(input, file)`: `DataTransfer` plus `change`, then wait for any parse to settle.
- `waitForStep(doc, adapter)`: a MutationObserver keyed on `adapter.step()`, for in-place step swaps.

### Suggested order

1. **Ashby:** single page, public schema, no login, and mostly gaps in widgets JobScript already has.
2. **Greenhouse / Lever fixes** from their docs: multi-select, phone country, attach the resume before filling on Lever.
3. **Workday:** the most applications by volume. Needs `step()`, portal comboboxes and repeaters, which unlock most of the others.
4. **iCIMS:** reuses the frame support plus `*.icims.com` permissions; needs resume-first ordering.
5. **SmartRecruiters:** needs `deepQueryAll` and inner-input writes.
6. **UKG Ready**, then **UKG Pro**, **ORC/Taleo**, **SuccessFactors**.
7. **Handshake** and **LinkedIn** last. Both are login-only and untestable without the user's account. Make LinkedIn opt-in, with a warning about its terms and no default host permission.

The best way to close the logged-in gaps is a sanitized fixture of each step, recorded with Learn mode on the user's own session and stored in `dev/` with all personal values replaced.
