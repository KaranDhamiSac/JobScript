// Background script: runs the fill for the popup button and the Alt+Shift+F shortcut.
// Chrome loads it as a service worker, Firefox as an event page (see manifest.json).
//
// New features (e.g. a future job-description match score) can add their own message
// types to the onMessage router below. Every handler must go through isTrustedSender().

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
  return false;
});
