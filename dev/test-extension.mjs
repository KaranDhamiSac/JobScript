// Loads the repo as a real unpacked extension in Playwright's Chromium (fresh temp profile, fake
// data only) and checks that it actually runs: service worker, content scripts, floating button
// and a fill. Run from dev/: `npm install && npx playwright install chromium`, then
// `npm run test:extension` (add --live to also open a live Greenhouse posting, read-only).
// Every non-GET request from the pages is aborted, so nothing can ever be submitted.
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEV = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(DEV);
const LIVE = process.argv.includes('--live');
const HEADED = process.argv.includes('--headed');
// The real content scripts only match real job boards, so the mock form is served at a fake
// path on one, from disk. Nothing for this URL ever reaches Greenhouse.
const MOCK_URL = 'https://job-boards.greenhouse.io/jobscript-test/jobs/1';
const LIVE_URL = 'https://job-boards.greenhouse.io/discord/jobs/8806163002';
// The mock form's own copy of the scripts and its chrome.storage stub are stripped, so only the
// installed extension runs on it.
const MOCK_HTML = fs.readFileSync(path.join(DEV, 'mock-form.html'), 'utf8')
  .replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<link [^>]*autofill\.css[^>]*>/, '');
const PROFILE = {
  firstName: 'Testy', lastName: 'McTestface', email: 'testy.mctestface@example.com', phone: '(916) 555-0100',
  city: 'Sacramento', state: 'CA', zip: '95819', country: 'United States',
  linkedin: 'https://www.linkedin.com/in/testy-example', workAuthorized: 'yes', requiresSponsorship: 'no',
};

const failures = [];
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(label);
};

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobscript-ext-'));
const context = await chromium.launchPersistentContext(userDataDir, {
  channel: 'chromium', // the full Chromium build: the headless shell can't run extensions
  headless: !HEADED,
  args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`],
});

try {
  const blocked = [];
  await context.route('**/*', (route) => {
    const req = route.request();
    if (!/^(GET|HEAD|OPTIONS)$/i.test(req.method())) { blocked.push(`${req.method()} ${req.url()}`); return route.abort(); }
    if (req.url().startsWith(MOCK_URL)) return route.fulfill({ contentType: 'text/html', body: MOCK_HTML });
    return route.continue();
  });

  // 1. Service worker
  const swErrors = [];
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 10000 }).catch(() => null);
  check(!!sw, 'service worker registered', sw ? sw.url() : 'no worker within 10s');
  if (!sw) throw new Error('extension did not start');
  sw.on('console', (m) => { if (m.type() === 'error') swErrors.push(m.text()); });
  const extId = new URL(sw.url()).host;
  const manifestErrors = await sw.evaluate(() => chrome.runtime.getManifest().version).then((v) => { console.log(`      extension ${extId}, version ${v}`); return null; }, (e) => e.message);
  check(!manifestErrors, 'service worker evaluates', manifestErrors || '');
  await sw.evaluate((profile) => chrome.storage.local.set({ profile }), PROFILE);

  // 2. Content scripts on a page
  async function openAndCheck(url, label) {
    const page = await context.newPage();
    const logs = [];
    const errors = [];
    page.on('console', (m) => { logs.push(m.text()); if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(url, { waitUntil: 'load', timeout: 45000 });
    const loaded = await page.waitForEvent('console', { predicate: (m) => m.text().startsWith('[JobScript] loaded'), timeout: 8000 }).then(() => true, () => logs.some((t) => t.startsWith('[JobScript] loaded')));
    check(loaded, `${label}: "[JobScript] loaded" logged`);
    const ui = await page.waitForFunction(() => [...document.documentElement.children, ...document.body.children]
      .map((e) => e.tagName.toLowerCase()).filter((t) => t.startsWith('jobscript')), null, { timeout: 5000 })
      .then((h) => h.jsonValue(), () => []);
    check(ui.length > 0, `${label}: JobScript element on the page`, ui.join(', '));
    // The site's own failed requests (and the ones the guard aborts) aren't the extension's.
    const own = errors.filter((e) => !/^Failed to load resource/.test(e) && (/jobscript|chrome-extension/i.test(e) || !/greenhouse|discord|sentry|gtag|analytics/i.test(e)));
    check(!own.length, `${label}: no extension errors in the page console`, own.slice(0, 3).join(' | '));
    return page;
  }

  const mock = await openAndCheck(MOCK_URL, 'mock form');

  // 3. Fill, through the same background path the popup button and Alt+Shift+F use
  const result = await sw.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url: url + '*' });
    return callWithInjection(tab.id, '__jobscriptFill');
  }, MOCK_URL).catch((e) => ({ error: e.message }));
  const firstName = await mock.locator('input[name*="first" i], input[id*="first" i]').first().inputValue().catch(() => '');
  check(firstName === PROFILE.firstName, 'fill puts the fake profile into the form', result && result.error ? result.error : `first name = "${firstName}"`);

  if (LIVE) await openAndCheck(LIVE_URL, 'live Greenhouse posting');

  check(!swErrors.length, 'no service worker console errors', swErrors.slice(0, 3).join(' | '));
  console.log(`      blocked ${blocked.length} non-GET request(s)`);
} catch (e) {
  check(false, 'test run', e.message);
} finally {
  await context.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
}

console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nAll checks passed');
process.exit(failures.length ? 1 : 0);
