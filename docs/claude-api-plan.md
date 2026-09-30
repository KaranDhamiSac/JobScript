# Plan: optional Claude API features (bring your own key)

Not built yet. This is the plan for adding features such as a job-description match score or resume import without weakening JobScript's privacy and permission model.

## Key handling

- The user pastes their own Anthropic API key on the options page. JobScript never ships, hardcodes or proxies a key.
- Store it in `chrome.storage.local` under a separate `settings` key, not inside `profile`:
  - **Export** never includes the key, so a shared backup can't leak it.
  - Import ignores any key it finds.
- The input is `type="password"`. After saving, show only the last 4 characters, and offer **Remove key**.
- Never log the key, never put it in a URL, and never send it to a content script or page. Only `background.js` reads it.
- Note in the UI that browser extension storage is not encrypted.

## Network access

- Call the API only from `background.js`, never from content scripts or pages.
- Declare `https://api.anthropic.com/*` under `optional_host_permissions`, not `host_permissions`. Request it with `chrome.permissions.request` when the user turns the feature on. Users who never enable it never grant it.
- Browser calls need the `anthropic-dangerous-direct-browser-access: true` header. The key goes in `x-api-key`.
- Add `https://api.anthropic.com` to `connect-src` in the extension-page CSP only when this ships.
- Use the current recommended model ID at build time. Keep the model ID in one constant.

## Consent and data minimisation

- Every feature is off by default and has its own toggle.
- Before the first call, show exactly what will be sent: for example, the job description text plus a summary of your skills. EEO answers, phone, address and the resume file are not sent unless a feature clearly needs them and says so.
- Nothing is sent automatically. Each call starts from a click.
- Update PRIVACY.md, and both store listings' data disclosures, before release.

## Messaging

- New background message types go through `isTrustedSender()` in `background.js`, which accepts only our own extension pages.
- Page-derived text (job descriptions) is treated as untrusted. Insert results with `textContent`, never HTML, and never follow instructions found in page text.
