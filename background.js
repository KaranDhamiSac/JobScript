// Background script: runs the fill for the popup button and the Alt+Shift+F shortcut.
// Chrome loads it as a service worker, Firefox as an event page (see manifest.json).
//
// New features (e.g. a future job-description match score) can add their own message
// types to the onMessage router below. Every handler must go through isTrustedSender().

// Chrome runs this file as a service worker and loads helpers with importScripts; Firefox lists
// them before this file in manifest.json "background.scripts".
if (typeof importScripts === 'function') importScripts('lib/storage.js', 'lib/ai.js');

const CONTENT_FILES = ['lib/storage.js', 'lib/fieldMap.js', 'content/panel.js', 'content/bank.js', 'content/autofill.js'];
const CONTENT_CSS = ['content/autofill.css'];

// Calls the fill in every frame that has the content script. Frames without it return null.
async function callFill(tabId, allFrames) {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames },
    func: () => (typeof globalThis.__jobscriptFill === 'function' ? globalThis.__jobscriptFill() : null),
  });
  return (results || []).map((r) => r && r.result).filter(Boolean);
}

async function fillTab(tabId) {
  let frames;
  try {
    // Greenhouse and Lever frames already have the content script (including Greenhouse
    // forms embedded in an iframe on a company's careers page).
    frames = await callFill(tabId, true);
    if (!frames.length) {
      // Any other site: inject on demand into the top frame only. This relies on the temporary
      // activeTab grant from the click or shortcut, so no broad host permission is needed.
      await chrome.scripting.insertCSS({ target: { tabId }, files: CONTENT_CSS });
      await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_FILES });
      frames = await callFill(tabId, false);
    }
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

  // Tab-scoped badge; the browser clears it when the tab navigates.
  await chrome.action.setBadgeBackgroundColor({ tabId, color: summary.needsAttention ? '#ca8a04' : '#16a34a' });
  await chrome.action.setBadgeText({ tabId, text: String(summary.filled) });
  return summary;
}

async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab && tab.id;
}

// Only our own extension pages (the popup) may send commands. Messages from content scripts
// arrive with sender.tab set and are rejected, as is anything from another extension.
function isTrustedSender(sender, pagePath) {
  return (
    sender.id === chrome.runtime.id &&
    !sender.tab &&
    typeof sender.url === 'string' &&
    sender.url.startsWith(chrome.runtime.getURL(pagePath))
  );
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
