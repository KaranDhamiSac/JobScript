// Background script: runs the fill for the popup button and the Alt+Shift+F shortcut.
// Chrome loads it as a service worker, Firefox as an event page (see manifest.json).
//
// New features (e.g. a future job-description match score) can add their own message
// types to the onMessage router below.

async function fillTab(tabId) {
  let results;
  try {
    // The content script is already loaded in every frame of supported sites; this just calls it.
    // allFrames covers Greenhouse forms embedded in an iframe on a company's careers page.
    results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => (typeof globalThis.__jobscriptFill === 'function' ? globalThis.__jobscriptFill() : null),
    });
  } catch (err) {
    return { ok: false, error: 'JobScript cannot run on this page.' };
  }

  const frames = (results || []).map((r) => r && r.result).filter(Boolean);
  if (!frames.length) {
    return { ok: false, error: 'No application form found. Open a Greenhouse or Lever application page.' };
  }
  const failed = frames.find((f) => !f.ok);
  const done = frames.filter((f) => f.ok);
  if (!done.length) return failed;

  const summary = done.reduce(
    (acc, f) => ({
      ok: true,
      site: acc.site || f.site,
      filled: acc.filled + f.filled,
      total: acc.total + f.total,
      needsAttention: acc.needsAttention + f.needsAttention,
      alreadyFilled: acc.alreadyFilled + f.alreadyFilled,
    }),
    { ok: true, site: '', filled: 0, total: 0, needsAttention: 0, alreadyFilled: 0 }
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

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'fill-page') return;
  const tabId = (tab && tab.id) || (await activeTabId());
  if (tabId) await fillTab(tabId);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'fill-tab') {
    fillTab(msg.tabId).then(sendResponse);
    return true; // keep the channel open for the async response
  }
  return false;
});
