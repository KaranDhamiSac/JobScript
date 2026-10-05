const fillBtn = document.getElementById('fill');
const resultBox = document.getElementById('result');
const profileStatus = document.getElementById('profile-status');

document.getElementById('open-options').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

function showResult(kind, title, detail) {
  resultBox.hidden = false;
  resultBox.className = 'result ' + kind;
  resultBox.replaceChildren();
  const strong = document.createElement('strong');
  strong.textContent = title;
  resultBox.appendChild(strong);
  if (detail) resultBox.appendChild(document.createTextNode(detail));
}

async function showProfileStatus() {
  const [profile, resume] = await Promise.all([JobScriptStorage.getProfile(), JobScriptStorage.getResume()]);
  const name = [profile.firstName, profile.lastName].filter(Boolean).join(' ');
  if (!name && !profile.email) {
    profileStatus.textContent = 'No profile yet. Click "Edit profile" to add your info.';
    return;
  }
  profileStatus.textContent = `${name || profile.email} · ${resume ? 'resume attached' : 'no resume saved'}`;
}

async function showShortcut() {
  if (!chrome.commands || !chrome.commands.getAll) return;
  const commands = await chrome.commands.getAll();
  const fill = commands.find((c) => c.name === 'fill-page');
  document.getElementById('shortcut').textContent = (fill && fill.shortcut) || 'not set';
}

fillBtn.addEventListener('click', async () => {
  fillBtn.disabled = true;
  fillBtn.textContent = 'Filling…';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !Number.isInteger(tab.id)) throw new Error('No active tab.');
    const res = await chrome.runtime.sendMessage({ type: 'fill-tab', tabId: tab.id });
    if (!res || !res.ok) {
      showResult('err', 'Nothing filled', (res && res.error) || 'Something went wrong.');
    } else {
      const parts = [];
      if (res.suggested) parts.push(`${res.suggested} suggestion${res.suggested === 1 ? '' : 's'} to review in the side panel.`);
      if (res.needsAttention) parts.push(`${res.needsAttention} required field${res.needsAttention === 1 ? '' : 's'} need you (yellow).`);
      if (res.alreadyFilled) parts.push(`${res.alreadyFilled} already had a value and were skipped.`);
      showResult(
        res.needsAttention ? 'warn' : 'ok',
        `Filled ${res.filled} of ${res.total} fields`,
        parts.join(' ')
      );
    }
  } catch (err) {
    showResult('err', 'Nothing filled', String(err.message || err));
  } finally {
    fillBtn.disabled = false;
    fillBtn.textContent = 'Fill this page';
  }
});

// ---------------------------------------------------------------------------
// Job description & my resume: opens the job page in a new tab (see job/job.js).

document.getElementById('job').addEventListener('click', async () => {
  const btn = document.getElementById('job');
  btn.disabled = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !Number.isInteger(tab.id)) throw new Error('No active tab.');
    const res = await chrome.runtime.sendMessage({ type: 'job-tab', tabId: tab.id });
    if (res && res.ok) window.close();
    else showResult('err', 'No job posting found', (res && res.error) || 'Something went wrong.');
  } catch (err) {
    showResult('err', 'No job posting found', String(err.message || err));
  } finally {
    btn.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// Tailor & Fill: opens the review page in a new tab (see tailor/tailor.js).

document.getElementById('tailor').addEventListener('click', async () => {
  const btn = document.getElementById('tailor');
  btn.disabled = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !Number.isInteger(tab.id)) throw new Error('No active tab.');
    const res = await chrome.runtime.sendMessage({ type: 'tailor-tab', tabId: tab.id });
    if (res && res.ok) window.close();
    else showResult('err', 'Can’t tailor here', (res && res.error) || 'Something went wrong.');
  } catch (err) {
    showResult('err', 'Can’t tailor here', String(err.message || err));
  } finally {
    btn.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// Learn mode: you fill a multi-step form once and JobScript records each step (see
// content/autofill.js). On sites JobScript doesn't have built-in access to, it asks to run on that one site,
// so the side panel can follow steps that load a new page.

const learnBtn = document.getElementById('learn');
let learnTabInfo = null; // { id, origin }, read when the popup opens

async function setUpLearn() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !Number.isInteger(tab.id) || !/^https?:/.test(tab.url || '')) return;
  const origin = new URL(tab.url).origin;
  learnTabInfo = { id: tab.id, origin };
  const site = await JobScriptStorage.getSiteAnswers(origin);
  learnBtn.textContent = site.steps.length ? `Relearn this site’s steps (${site.steps.length} learned)` : 'Learn this site’s steps';
  learnBtn.hidden = false;
}

learnBtn.addEventListener('click', async () => {
  if (!learnTabInfo) return;
  learnBtn.disabled = true;
  // Asked straight from the click: browsers only show permission prompts then. Declining still
  // lets you learn, as long as the form doesn't load a new page for each step.
  const pattern = learnTabInfo.origin + '/*';
  let granted = false;
  try {
    granted = await chrome.permissions.request({ origins: [pattern] });
  } catch (e) {
    granted = false;
  }
  try {
    const res = await chrome.runtime.sendMessage({ type: 'learn-tab', tabId: learnTabInfo.id });
    if (!res || !res.ok) {
      showResult('err', 'Couldn’t start learning', (res && res.error) || 'Something went wrong.');
    } else {
      showResult(
        'ok',
        'Learning this site',
        ' Answer each step, press Continue yourself, and press “Finish learning” in the side panel after the last one.' +
          (granted || res.persistent ? '' : ' Without permission to run on this site, keep this tab open between steps.')
      );
    }
  } catch (err) {
    showResult('err', 'Couldn’t start learning', String(err.message || err));
  } finally {
    learnBtn.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// Tracker: today's progress here, everything else on the full tracker page.

document.getElementById('open-tracker').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('tracker/tracker.html') });
  window.close();
});

async function showTodayProgress() {
  const [apps, { dailyGoal }] = await Promise.all([JobScriptStorage.getApplications(), JobScriptStorage.getTrackerSettings()]);
  const d = new Date();
  const sameDay = (iso) => {
    const x = new Date(iso);
    return x.getFullYear() === d.getFullYear() && x.getMonth() === d.getMonth() && x.getDate() === d.getDate();
  };
  const applied = apps.filter((a) => a.status !== 'Filled' && sameDay(a.appliedAt || a.createdAt)).length;
  document.getElementById('today-progress').textContent = `Today: ${applied} / ${dailyGoal} applied`;
}

showProfileStatus();
showShortcut();
setUpLearn();
showTodayProgress();
