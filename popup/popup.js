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
// Applications (tracker)

const tabs = { fill: document.getElementById('tab-fill'), apps: document.getElementById('tab-apps') };
function showTab(name) {
  for (const [key, btn] of Object.entries(tabs)) {
    btn.classList.toggle('active', key === name);
    btn.setAttribute('aria-selected', String(key === name));
    document.getElementById('panel-' + key).hidden = key !== name;
  }
  if (name === 'apps') renderApps();
}
tabs.fill.addEventListener('click', () => showTab('fill'));
tabs.apps.addEventListener('click', () => showTab('apps'));

function el(tag, props, children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'text') n.textContent = v;
    else if (k === 'class') n.className = v;
    else n.setAttribute(k, v);
  }
  for (const c of children || []) if (c) n.append(c);
  return n;
}

function safeHttpUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : '';
  } catch (e) {
    return '';
  }
}

async function downloadTailored(id) {
  const t = await JobScriptStorage.getTailored(id);
  if (!t) return;
  const bin = atob(t.data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const a = el('a', { href: url, download: t.name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function renderApps() {
  const list = (await JobScriptStorage.getApplications()).slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const ul = document.getElementById('apps');
  ul.replaceChildren();
  document.getElementById('apps-count').textContent = list.length ? `${list.length} application${list.length === 1 ? '' : 's'}` : 'No applications yet. They appear here when you fill one.';
  for (const app of list) {
    const href = safeHttpUrl(app.url);
    const title = el(href ? 'a' : 'span', href ? { href, target: '_blank', rel: 'noopener', text: app.title || app.url } : { text: app.title || app.url });
    const status = el('select', { 'aria-label': 'Status' });
    for (const s of JobScriptStorage.STATUSES) {
      const o = el('option', { value: s, text: s });
      if (s === app.status) o.selected = true;
      status.append(o);
    }
    status.addEventListener('change', () => JobScriptStorage.setApplicationStatus(app.id, status.value));
    const meta = el('div', { class: 'app-meta' }, [
      el('span', { class: 'muted', text: new Date(app.createdAt).toLocaleDateString() + (app.site ? ' · ' + app.site : '') }),
    ]);
    if (app.tailoredId) {
      const dl = el('button', { class: 'link', type: 'button', text: app.tailoredFileName || 'Tailored resume' });
      dl.addEventListener('click', () => downloadTailored(app.tailoredId));
      meta.append(dl);
    }
    ul.append(el('li', { class: 'app' }, [
      el('div', { class: 'app-main' }, [el('strong', { text: app.company || 'Unknown company' }), title]),
      status,
      meta,
    ]));
  }
}

// CSV cells that start with = + - @ could run as formulas in a spreadsheet; prefix them.
function csvCell(v) {
  let s = String(v == null ? '' : v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

document.getElementById('export-csv').addEventListener('click', async () => {
  const list = (await JobScriptStorage.getApplications()).slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const rows = [['Date', 'Company', 'Job title', 'URL', 'Site', 'Status', 'Tailored resume']];
  for (const a of list) rows.push([a.createdAt, a.company, a.title, a.url, a.site, a.status, a.tailoredFileName || '']);
  const csv = rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = el('a', { href: url, download: `jobscript-applications-${new Date().toISOString().slice(0, 10)}.csv` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
});

showProfileStatus();
showShortcut();
