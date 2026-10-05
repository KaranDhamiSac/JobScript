// Background script: runs the fill for the popup button and the Alt+Shift+F shortcut.
// Chrome loads it as a service worker, Firefox as an event page (see manifest.json).
//
// New features (e.g. a future job-description match score) can add their own message
// types to the onMessage router below. Every handler must go through isTrustedSender().

// Chrome runs this file as a service worker and loads helpers with importScripts; Firefox lists
// them before this file in manifest.json "background.scripts".
if (typeof importScripts === 'function') importScripts('lib/storage.js', 'lib/ai.js');

const CONTENT_FILES = ['lib/storage.js', 'lib/fieldMap.js', 'lib/dateRules.js', 'content/panel.js', 'content/bank.js', 'content/autofill.js'];
const CONTENT_CSS = ['content/autofill.css'];

// Calls the fill in every frame that has the content script. Frames without it return null.
// Runs `fn` (by name, on globalThis) in every frame that has the content script.
async function callInFrames(tabId, allFrames, fnName, arg) {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames },
    func: (name, a) => (typeof globalThis[name] === 'function' ? globalThis[name](a) : null),
    args: [fnName, arg === undefined ? null : arg],
  });
  return (results || []).map((r) => r && r.result).filter(Boolean);
}

// Same as callInFrames, but on sites without the built-in content script, injects it first
// (top frame only) using the temporary activeTab grant from your click or shortcut.
async function callWithInjection(tabId, fnName, arg) {
  let frames = await callInFrames(tabId, true, fnName, arg);
  if (!frames.length) {
    await chrome.scripting.insertCSS({ target: { tabId }, files: CONTENT_CSS });
    await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_FILES });
    frames = await callInFrames(tabId, false, fnName, arg);
  }
  return frames;
}

// opts.tailoredId: attach that tailored resume instead of the master.
async function fillTab(tabId, opts) {
  let frames;
  try {
    // Frames on the job sites in the manifest already have the content script (including
    // Greenhouse and iCIMS forms embedded in an iframe on a company's careers page).
    frames = await callWithInjection(tabId, '__jobscriptFill', opts || null);
  } catch (err) {
    return { ok: false, error: 'JobScript cannot run on this page.' };
  }

  if (!frames.length) {
    return { ok: false, error: 'No application form found on this page.' };
  }
  const failed = frames.find((f) => !f.ok);
  const done = frames.filter((f) => f.ok);
  if (!done.length) return failed;

  const summary = done.reduce(
    (acc, f) => ({
      ok: true,
      site: acc.site || f.site,
      filled: acc.filled + f.filled,
      suggested: acc.suggested + (f.suggested || 0),
      total: acc.total + f.total,
      needsAttention: acc.needsAttention + f.needsAttention,
      alreadyFilled: acc.alreadyFilled + f.alreadyFilled,
    }),
    { ok: true, site: '', filled: 0, suggested: 0, total: 0, needsAttention: 0, alreadyFilled: 0 }
  );

  await grantAiAllowance(tabId);

  // Application tracker: one entry per job (same URL updates the existing entry).
  const withJob = done.find((f) => f.company || f.jobTitle) || done[0];
  const tailored = opts && opts.tailoredId ? await JobScriptStorage.getTailored(opts.tailoredId) : null;
  await JobScriptStorage.upsertApplication({
    url: withJob.url,
    company: withJob.company,
    title: withJob.jobTitle,
    site: summary.site,
    tailoredId: tailored ? opts.tailoredId : '',
    tailoredFileName: tailored ? tailored.name : '',
    folder: opts && opts.folder,
  });

  // Tab-scoped badge; the browser clears it when the tab navigates.
  await chrome.action.setBadgeBackgroundColor({ tabId, color: summary.needsAttention ? '#ca8a04' : '#16a34a' });
  await chrome.action.setBadgeText({ tabId, text: String(summary.filled) });
  return summary;
}

async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab && tab.id;
}

// Only our own extension pages (popup, options, tailor) may send these commands. A content
// script's sender.url is the web page's address, so it can't pass; neither can another
// extension. Pages opened in a tab (options, tailor) must be showing an extension page there.
function isTrustedSender(sender, pagePath) {
  const ownPage = (url) => typeof url === 'string' && url.startsWith(chrome.runtime.getURL(pagePath));
  return sender.id === chrome.runtime.id && ownPage(sender.url) && (!sender.tab || ownPage(sender.tab.url));
}

// ---------------------------------------------------------------------------
// AI fallback. A content script may ask for answers only for a tab where you started a fill
// in the last few minutes, and only a few times per fill. The allowance lives in
// storage.session, which content scripts can't read or write.

const AI_ALLOWANCE_MS = 10 * 60 * 1000;
const AI_CALLS_PER_FILL = 3;
const ANTHROPIC_ORIGIN = 'https://api.anthropic.com/*';

async function grantAiAllowance(tabId) {
  await chrome.storage.session.set({ ['aiAllowance:' + tabId]: { expires: Date.now() + AI_ALLOWANCE_MS, remaining: AI_CALLS_PER_FILL } });
}

async function takeAiAllowance(tabId) {
  const key = 'aiAllowance:' + tabId;
  const a = (await chrome.storage.session.get(key))[key];
  if (!a || a.expires < Date.now() || a.remaining < 1) return false;
  await chrome.storage.session.set({ [key]: { expires: a.expires, remaining: a.remaining - 1 } });
  return true;
}

async function answerWithAi(msg, sender) {
  const settings = await JobScriptStorage.getAiSettings();
  if (!settings.enabled) return { ok: false, error: 'AI answers are turned off.' };
  const apiKey = await JobScriptStorage.getApiKey();
  if (!apiKey) return { ok: false, error: 'Add your Anthropic API key on the options page.' };
  if (!(await chrome.permissions.contains({ origins: [ANTHROPIC_ORIGIN] }))) {
    return { ok: false, error: 'Turn AI answers off and on again on the options page to grant access to Anthropic.' };
  }
  const request = JobScriptAI.sanitizeRequest(msg.request);
  if (!request) return { ok: false, error: 'No questions to answer.' };
  if (!(await takeAiAllowance(sender.tab.id))) return { ok: false, error: 'Click Fill this page again to ask Claude.' };
  const [profile, resumeText] = await Promise.all([JobScriptStorage.getProfile(), JobScriptStorage.getResumeText()]);
  return JobScriptAI.answerQuestions({ apiKey, model: settings.model, profile, resumeText, request });
}

// Resume import with Claude, requested from the options page when you click "Import with Claude".
// Needs a saved key and the api.anthropic.com permission, not the form-answers toggle.
async function parseResumeWithAi(msg) {
  const apiKey = await JobScriptStorage.getApiKey();
  if (!apiKey) return { ok: false, error: 'Add your Anthropic API key first.' };
  if (!(await chrome.permissions.contains({ origins: [ANTHROPIC_ORIGIN] }))) {
    return { ok: false, error: 'JobScript needs permission to reach api.anthropic.com.' };
  }
  const text = typeof msg.text === 'string' ? msg.text : '';
  const settings = await JobScriptStorage.getAiSettings();
  return JobScriptAI.parseResume({ apiKey, model: settings.model, text });
}

// ---------------------------------------------------------------------------
// Tailor & Fill: scrape the posting, then open the review page in a new tab. The review page
// asks Claude for a tailored version, you approve it, and it comes back here to fill the tab.

// page: 'tailor' (Claude tailoring) or 'job' (job description + your own resume).
async function startTailor(tabId, page) {
  const target = page === 'job' ? 'job/job.html' : 'tailor/tailor.html';
  let postings;
  try {
    postings = await callWithInjection(tabId, '__jobscriptJobPosting');
  } catch (err) {
    return { ok: false, error: 'JobScript cannot read this page.' };
  }
  if (!postings.length) return { ok: false, error: 'No job posting found on this page.' };
  // Prefer the frame with the application form, then the longest description.
  const posting = postings.sort((a, b) => (b.hasForm - a.hasForm) || b.description.length - a.description.length)[0];
  const sid = crypto.randomUUID();
  await chrome.storage.session.set({ ['tailor:' + sid]: { tabId, posting, createdAt: Date.now() } });
  const tab = await chrome.tabs.get(tabId);
  await chrome.tabs.create({ url: chrome.runtime.getURL(target + '?sid=' + sid), index: tab.index + 1, openerTabId: tabId });
  return { ok: true };
}

async function tailorSession(sid) {
  const key = 'tailor:' + String(sid || '');
  return (await chrome.storage.session.get(key))[key] || null;
}

async function tailorWithAi(msg) {
  const session = await tailorSession(msg.sid);
  if (!session) return { ok: false, error: 'This tailoring session expired. Click Tailor & Fill again.' };
  const apiKey = await JobScriptStorage.getApiKey();
  if (!apiKey) return { ok: false, error: 'Add your Anthropic API key on the options page first.' };
  if (!(await chrome.permissions.contains({ origins: [ANTHROPIC_ORIGIN] }))) {
    return { ok: false, error: 'JobScript needs permission to reach api.anthropic.com.' };
  }
  const [settings, profile] = await Promise.all([JobScriptStorage.getAiSettings(), JobScriptStorage.getProfile()]);
  return JobScriptAI.tailorResume({ apiKey, model: settings.model, profile, posting: session.posting });
}

async function fillWithTailored(msg) {
  const session = await tailorSession(msg.sid);
  if (!session) return { ok: false, error: 'This tailoring session expired. Click Tailor & Fill again.' };
  if (typeof msg.tailoredId !== 'string' || !(await JobScriptStorage.getTailored(msg.tailoredId))) {
    return { ok: false, error: 'Tailored resume not found.' };
  }
  let tab;
  try {
    tab = await chrome.tabs.get(session.tabId);
  } catch (e) {
    return { ok: false, error: 'The job tab was closed.' };
  }
  await chrome.tabs.update(tab.id, { active: true });
  return fillTab(tab.id, { tailoredId: msg.tailoredId, folder: typeof msg.folder === 'string' ? msg.folder : '' });
}

// ---------------------------------------------------------------------------
// Learn mode. On a site you let JobScript run on (an optional permission for just that site,
// asked for from the popup), the content script is registered to load with every page, so the
// panel can follow a multi-step form even when each step loads a new page.

function siteScriptId(origin) {
  return 'site:' + origin;
}

// Whether a manifest match pattern such as "https://*.icims.com/*" covers an origin.
function patternCovers(pattern, origin) {
  const m = /^(\w+):\/\/(\*\.)?([^/*]+)\/\*$/.exec(pattern);
  if (!m) return false;
  const u = new URL(origin);
  if (u.protocol !== m[1] + ':') return false;
  return m[2] ? u.hostname === m[3] || u.hostname.endsWith('.' + m[3]) : u.hostname === m[3];
}

// The job sites in the manifest (Greenhouse, Lever, Workday, ...) already get the content script.
function hasBuiltInScript(origin) {
  return chrome.runtime.getManifest().content_scripts.some((cs) => cs.matches.some((p) => patternCovers(p, origin)));
}

async function registerSiteScript(origin) {
  if (hasBuiltInScript(origin)) return;
  const id = siteScriptId(origin);
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
  if (existing.length) return;
  await chrome.scripting.registerContentScripts([
    { id, matches: [origin + '/*'], js: CONTENT_FILES, css: CONTENT_CSS, runAt: 'document_idle' },
  ]);
}

async function unregisterSiteScript(origin) {
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [siteScriptId(origin)] });
  } catch (e) {
    /* wasn't registered */
  }
}

// Re-register after an update or restart: learned sites whose permission you still grant.
async function syncSiteScripts() {
  const sites = await JobScriptStorage.getAllSiteAnswers();
  for (const [origin, site] of Object.entries(sites)) {
    if (!site.learning && !(site.steps && site.steps.length)) continue;
    if (await chrome.permissions.contains({ origins: [origin + '/*'] })) await registerSiteScript(origin).catch(() => {});
  }
}

async function learnTab(tabId) {
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch (e) {
    return { ok: false, error: 'No active tab.' };
  }
  let origin;
  try {
    origin = new URL(tab.url).origin;
  } catch (e) {
    return { ok: false, error: 'JobScript cannot run on this page.' };
  }
  if (!/^https?:/.test(origin)) return { ok: false, error: 'JobScript cannot run on this page.' };
  const persistent = await chrome.permissions.contains({ origins: [origin + '/*'] });
  if (persistent) await registerSiteScript(origin).catch(() => {});
  const res = await fillTab(tabId, { learn: true });
  return Object.assign({}, res, { persistent });
}

chrome.permissions.onRemoved.addListener(({ origins }) => {
  for (const pattern of origins || []) {
    const m = /^(https?:\/\/[^/]+)\/\*$/.exec(pattern);
    if (m) unregisterSiteScript(m[1]);
  }
});

chrome.runtime.onInstalled.addListener(() => syncSiteScripts());
chrome.runtime.onStartup.addListener(() => syncSiteScripts());

// Messages from our own content scripts carry sender.tab; page scripts can't send these at all.
function isOwnContentScript(sender) {
  return sender.id === chrome.runtime.id && !!sender.tab && Number.isInteger(sender.tab.id) && typeof sender.url === 'string';
}

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'fill-page') return;
  const tabId = (tab && tab.id) || (await activeTabId());
  if (tabId) await fillTab(tabId);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return false;
  if (msg.type === 'fill-tab') {
    if (!isTrustedSender(sender, 'popup/') || !Number.isInteger(msg.tabId)) return false;
    fillTab(msg.tabId).then(sendResponse);
    return true; // keep the channel open for the async response
  }
  if (msg.type === 'learn-tab') {
    if (!isTrustedSender(sender, 'popup/') || !Number.isInteger(msg.tabId)) return false;
    learnTab(msg.tabId).then(sendResponse, () => sendResponse({ ok: false, error: 'Could not start learning.' }));
    return true;
  }
  if (msg.type === 'tailor-tab' || msg.type === 'job-tab') {
    if (!isTrustedSender(sender, 'popup/') || !Number.isInteger(msg.tabId)) return false;
    startTailor(msg.tabId, msg.type === 'job-tab' ? 'job' : 'tailor').then(sendResponse);
    return true;
  }
  if (msg.type === 'tailor-start' || msg.type === 'job-start') {
    if (!isOwnContentScript(sender)) return false;
    startTailor(sender.tab.id, msg.type === 'job-start' ? 'job' : 'tailor').then(sendResponse);
    return true;
  }
  if (msg.type === 'ai-tailor') {
    if (!isTrustedSender(sender, 'tailor/')) return false;
    tailorWithAi(msg).then(sendResponse, () => sendResponse({ ok: false, error: 'Something went wrong asking Claude.' }));
    return true;
  }
  if (msg.type === 'tailor-fill') {
    if (!isTrustedSender(sender, 'tailor/') && !isTrustedSender(sender, 'job/')) return false;
    fillWithTailored(msg).then(sendResponse, () => sendResponse({ ok: false, error: 'Could not fill the application.' }));
    return true;
  }
  if (msg.type === 'ai-parse-resume') {
    if (!isTrustedSender(sender, 'options/')) return false;
    parseResumeWithAi(msg).then(sendResponse, () => sendResponse({ ok: false, error: 'Something went wrong asking Claude.' }));
    return true;
  }
  if (msg.type === 'ai-answer') {
    if (!isOwnContentScript(sender)) return false;
    answerWithAi(msg, sender).then(sendResponse, () => sendResponse({ ok: false, error: 'Something went wrong asking Claude.' }));
    return true;
  }
  return false;
});
