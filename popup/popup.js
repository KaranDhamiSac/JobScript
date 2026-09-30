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

showProfileStatus();
showShortcut();
