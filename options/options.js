// Loaded as a module (see options.html) so it can import the resume parser and pdf.js.
import { parseResume } from './resume-parser.js';

const S = JobScriptStorage;

// Field definitions for the repeatable lists. `type` is an <input> type, 'textarea' or 'checkbox'.
const LISTS = {
  workHistory: {
    blank: S.blankWorkEntry,
    title: (e) => [e.title, e.employer].filter(Boolean).join(' at ') || 'New job',
    fields: [
      { key: 'employer', label: 'Employer' },
      { key: 'title', label: 'Job title' },
      { key: 'location', label: 'Location' },
      { key: 'startDate', label: 'Start date', type: 'month' },
      { key: 'endDate', label: 'End date', type: 'month' },
      { key: 'current', label: 'I currently work here', type: 'checkbox' },
      { key: 'supervisorName', label: 'Supervisor name' },
      { key: 'supervisorPhone', label: 'Supervisor phone', type: 'tel' },
      { key: 'description', label: 'Description', type: 'textarea', wide: true },
    ],
  },
  education: {
    blank: S.blankEducationEntry,
    title: (e) => e.school || 'New school',
    fields: [
      { key: 'school', label: 'School' },
      { key: 'degree', label: 'Degree', placeholder: "Bachelor's" },
      { key: 'major', label: 'Major' },
      { key: 'gpa', label: 'GPA' },
      { key: 'location', label: 'Location' },
      { key: 'startDate', label: 'Start date', type: 'month' },
      { key: 'gradDate', label: 'Graduation date', type: 'month' },
    ],
  },
  customAnswers: {
    blank: S.blankCustomAnswer,
    title: (e) => e.question || 'New question',
    fields: [
      { key: 'question', label: 'Question', wide: true },
      { key: 'answer', label: 'Answer', type: 'textarea', wide: true },
    ],
  },
};

let profile = null;
let dirty = false;
// Resume text from an import you applied; written to storage only when you click Save.
let pendingResumeText = null;

const saveBtn = document.getElementById('save');
const saveStatus = document.getElementById('save-status');

function setDirty(value) {
  dirty = value;
  saveStatus.textContent = dirty ? 'Unsaved changes' : '';
}

// ---------------------------------------------------------------------------
// Basic fields

function renderBasics() {
  for (const el of document.querySelectorAll('[data-key]')) {
    el.value = profile[el.dataset.key] ?? '';
  }
}

document.getElementById('profile-form').addEventListener('input', (e) => {
  const key = e.target.dataset && e.target.dataset.key;
  if (!key) return;
  profile[key] = e.target.value;
  setDirty(true);
});

// ---------------------------------------------------------------------------
// Repeatable lists

function iconButton(text, title, onClick, disabled) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'icon';
  b.textContent = text;
  b.title = title;
  b.setAttribute('aria-label', title);
  b.disabled = !!disabled;
  b.addEventListener('click', onClick);
  return b;
}

function moveEntry(listKey, from, to) {
  const arr = profile[listKey];
  const [item] = arr.splice(from, 1);
  arr.splice(to, 0, item);
  setDirty(true);
  renderList(listKey);
}

function renderList(listKey) {
  const def = LISTS[listKey];
  const container = document.getElementById('list-' + listKey);
  const entries = profile[listKey];
  container.replaceChildren();

  if (!entries.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'None yet.';
    container.appendChild(p);
    return;
  }

  entries.forEach((entry, index) => {
    const card = document.createElement('div');
    card.className = 'entry';

    const head = document.createElement('div');
    head.className = 'entry-head';
    const title = document.createElement('span');
    title.className = 'entry-title';
    title.textContent = `${index + 1}. ${def.title(entry)}`;
    head.append(
      title,
      iconButton('↑', 'Move up', () => moveEntry(listKey, index, index - 1), index === 0),
      iconButton('↓', 'Move down', () => moveEntry(listKey, index, index + 1), index === entries.length - 1),
      iconButton('Delete', 'Delete entry', () => {
        if (!confirm(`Delete "${def.title(entry)}"?`)) return;
        entries.splice(index, 1);
        setDirty(true);
        renderList(listKey);
      })
    );
    head.lastChild.classList.add('danger');

    const grid = document.createElement('div');
    grid.className = 'grid';
    const inputs = {};

    for (const field of def.fields) {
      const label = document.createElement('label');
      if (field.wide) label.classList.add('wide');
      let input;
      if (field.type === 'textarea') {
        input = document.createElement('textarea');
        input.value = entry[field.key] || '';
      } else if (field.type === 'checkbox') {
        label.classList.add('check');
        input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = !!entry[field.key];
      } else {
        input = document.createElement('input');
        input.type = field.type || 'text';
        input.value = entry[field.key] || '';
        if (field.type === 'month') input.placeholder = 'YYYY-MM';
      }
      if (field.placeholder) input.placeholder = field.placeholder;
      inputs[field.key] = input;

      input.addEventListener('input', () => {
        entry[field.key] = field.type === 'checkbox' ? input.checked : input.value;
        if (field.key === 'current' && inputs.endDate) inputs.endDate.disabled = input.checked;
        title.textContent = `${index + 1}. ${def.title(entry)}`;
        setDirty(true);
      });

      if (field.type === 'checkbox') label.append(input, document.createTextNode(field.label));
      else label.append(document.createTextNode(field.label), input);
      grid.appendChild(label);
    }
    if (inputs.endDate && entry.current) inputs.endDate.disabled = true;

    card.append(head, grid);
    container.appendChild(card);
  });
}

for (const btn of document.querySelectorAll('[data-add]')) {
  btn.addEventListener('click', () => {
    const listKey = btn.dataset.add;
    profile[listKey].push(LISTS[listKey].blank());
    setDirty(true);
    renderList(listKey);
    const cards = document.querySelectorAll(`#list-${listKey} .entry`);
    const last = cards[cards.length - 1];
    if (last) {
      last.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const first = last.querySelector('input, textarea');
      if (first) first.focus({ preventScroll: true });
    }
  });
}

// ---------------------------------------------------------------------------
// Save

async function save() {
  await S.saveProfile(profile);
  if (pendingResumeText !== null) {
    await S.saveResumeText(pendingResumeText);
    pendingResumeText = null;
  }
  setDirty(false);
  saveStatus.textContent = 'Saved';
  setTimeout(() => {
    if (!dirty) saveStatus.textContent = '';
  }, 2000);
}

saveBtn.addEventListener('click', save);

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    save();
  }
});

window.addEventListener('beforeunload', (e) => {
  if (dirty) e.preventDefault();
});

// ---------------------------------------------------------------------------
// Resume

const resumeStatus = document.getElementById('resume-status');
const resumeInput = document.getElementById('resume-input');
const resumeChoose = document.getElementById('resume-choose');
const resumeRemove = document.getElementById('resume-remove');
const importBtn = document.getElementById('resume-import');
const importStatus = document.getElementById('import-status');
const reviewBox = document.getElementById('import-review');

function formatSize(bytes) {
  return bytes >= 1024 * 1024 ? (bytes / 1024 / 1024).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB';
}

async function renderResume() {
  const resume = await S.getResume();
  if (resume) {
    const when = new Date(resume.savedAt).toLocaleDateString();
    resumeStatus.textContent = `${resume.name} (${formatSize(resume.size)}, saved ${when})`;
    resumeChoose.textContent = 'Replace PDF';
    resumeRemove.hidden = false;
    importBtn.hidden = false;
  } else {
    resumeStatus.textContent = 'No resume saved.';
    resumeChoose.textContent = 'Upload PDF';
    resumeRemove.hidden = true;
    importBtn.hidden = true;
  }
}

function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

resumeInput.addEventListener('change', async () => {
  const file = resumeInput.files[0];
  resumeInput.value = '';
  if (!file) return;
  if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
    alert('Please choose a PDF file.');
    return;
  }
  if (file.size > S.MAX_RESUME_BYTES) {
    alert('That PDF is larger than 5 MB. Please choose a smaller file.');
    return;
  }
  resumeStatus.textContent = 'Saving…';
  try {
    await S.saveResume(
      S.sanitizeResume({ name: file.name, data: await readAsBase64(file), savedAt: new Date().toISOString() })
    );
    importStatus.textContent = 'Saved. Click "Import info from resume" to fill your profile from it.';
  } catch (err) {
    alert('Could not save the resume: ' + (err.message || err));
  }
  renderResume();
});

resumeRemove.addEventListener('click', async () => {
  if (!confirm('Remove the saved resume and its imported text?')) return;
  await S.clearResume();
  pendingResumeText = null;
  closeReview();
  renderResume();
});

// ---------------------------------------------------------------------------
// Import info from resume: parse locally, review, then apply to the form (still unsaved).

const CONTACT_FIELDS = [
  ['firstName', 'First name'], ['lastName', 'Last name'], ['email', 'Email'], ['phone', 'Phone'],
  ['address', 'Street address'], ['city', 'City'], ['state', 'State'], ['zip', 'ZIP'],
  ['linkedin', 'LinkedIn URL'], ['github', 'GitHub URL'], ['portfolio', 'Portfolio URL'],
];

function h(tag, props, children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'text') n.textContent = v;
    else if (k === 'class') n.className = v;
    else if (k === 'checked' || k === 'value') n[k] = v;
    else n.setAttribute(k, v);
  }
  for (const c of children || []) if (c) n.append(c);
  return n;
}

function closeReview() {
  reviewBox.hidden = true;
  reviewBox.replaceChildren();
}

function sameEntry(a, b, keys) {
  return keys.every((k) => String(a[k] || '').trim().toLowerCase() === String(b[k] || '').trim().toLowerCase());
}

// One checkbox + editable fields per parsed list entry. Returns a getter for the edited entry.
function reviewEntry(container, entry, fields, checked, heading) {
  const box = h('input', { type: 'checkbox', checked });
  const card = h('div', { class: 'entry' }, [
    h('label', { class: 'check' }, [box, document.createTextNode(heading)]),
  ]);
  const grid = h('div', { class: 'grid' });
  const inputs = {};
  for (const f of fields) {
    let input;
    if (f.type === 'textarea') input = h('textarea', { value: entry[f.key] || '' });
    else if (f.type === 'checkbox') input = h('input', { type: 'checkbox', checked: !!entry[f.key] });
    else input = h('input', { type: f.type || 'text', value: entry[f.key] || '' });
    inputs[f.key] = input;
    grid.append(
      f.type === 'checkbox'
        ? h('label', { class: 'check' }, [input, document.createTextNode(f.label)])
        : h('label', { class: f.wide ? 'wide' : '' }, [document.createTextNode(f.label), input])
    );
  }
  card.append(grid);
  container.append(card);
  return () => {
    if (!box.checked) return null;
    const out = {};
    for (const f of fields) out[f.key] = f.type === 'checkbox' ? inputs[f.key].checked : inputs[f.key].value.trim();
    return out;
  };
}

function showReview(parsed, lines) {
  reviewBox.replaceChildren();
  reviewBox.hidden = false;
  reviewBox.append(
    h('h2', { text: 'Review imported info' }),
    h('p', {
      class: 'muted',
      text: 'Parsed on this device from your resume. Check what to keep and fix anything that looks wrong. Nothing is saved until you click Apply and then Save profile.',
    })
  );

  const getters = { contact: [], workHistory: [], education: [], skills: null };

  const contactGrid = h('div', { class: 'grid' });
  for (const [key, label] of CONTACT_FIELDS) {
    const value = parsed.contact[key];
    if (!value) continue;
    const current = profile[key] || '';
    const box = h('input', { type: 'checkbox', checked: !current });
    const input = h('input', { type: 'text', value });
    contactGrid.append(
      h('label', {}, [
        h('span', { class: 'check' }, [box, document.createTextNode(label)]),
        input,
        current ? h('span', { class: 'muted small', text: `Current: ${current}` }) : null,
      ])
    );
    getters.contact.push(() => (box.checked && input.value.trim() ? [key, input.value.trim()] : null));
  }
  if (getters.contact.length) reviewBox.append(h('h3', { text: 'Contact' }), contactGrid);

  const lists = [
    ['workHistory', 'Work history', (e) => [e.title, e.employer].filter(Boolean).join(' at ') || 'Job', ['employer', 'title']],
    ['education', 'Education', (e) => e.school || e.degree || 'School', ['school', 'degree']],
  ];
  for (const [key, title, heading, dupKeys] of lists) {
    if (!parsed[key].length) continue;
    const container = h('div', { class: 'list' });
    reviewBox.append(h('h3', { text: title }), container);
    for (const entry of parsed[key]) {
      const duplicate = profile[key].some((e) => sameEntry(e, entry, dupKeys));
      const label = heading(entry) + (duplicate ? ' (already in your profile)' : '');
      getters[key].push(reviewEntry(container, entry, LISTS[key].fields, !duplicate, label));
    }
  }

  if (parsed.skills) {
    const box = h('input', { type: 'checkbox', checked: true });
    const input = h('textarea', { value: parsed.skills });
    reviewBox.append(
      h('h3', { text: 'Skills' }),
      h('label', {}, [h('span', { class: 'check' }, [box, document.createTextNode('Add to my skills')]), input])
    );
    getters.skills = () => (box.checked ? input.value : '');
  }

  const found = getters.contact.length + getters.workHistory.length + getters.education.length + (getters.skills ? 1 : 0);
  if (!found) reviewBox.append(h('p', { text: 'JobScript couldn’t pick out any details. You can still fill your profile by hand.' }));

  const apply = h('button', { type: 'button', class: 'primary', text: 'Apply to profile' });
  const cancel = h('button', { type: 'button', class: 'secondary', text: 'Cancel' });
  reviewBox.append(h('div', { class: 'row' }, [apply, cancel]));
  cancel.addEventListener('click', closeReview);
  apply.addEventListener('click', () => {
    for (const get of getters.contact) {
      const pair = get();
      if (pair) profile[pair[0]] = pair[1];
    }
    const byRecent = (dateKey) => (a, b) =>
      (b.current ? 1 : 0) - (a.current ? 1 : 0) || String(b[dateKey] || '').localeCompare(String(a[dateKey] || ''));
    for (const [key, dateKey] of [['workHistory', 'startDate'], ['education', 'gradDate']]) {
      const added = getters[key].map((g) => g()).filter(Boolean).map((e) => Object.assign(LISTS[key].blank(), e));
      if (added.length) profile[key] = [...profile[key], ...added].sort(byRecent(dateKey));
    }
    if (getters.skills) {
      const merged = new Map();
      for (const s of [...String(profile.skills || '').split(','), ...getters.skills().split(',')]) {
        const t = s.trim();
        if (t && !merged.has(t.toLowerCase())) merged.set(t.toLowerCase(), t);
      }
      profile.skills = [...merged.values()].join(', ');
    }
    pendingResumeText = lines.join('\n');
    renderBasics();
    Object.keys(LISTS).forEach(renderList);
    closeReview();
    setDirty(true);
    importStatus.textContent = 'Applied. Review your profile below, then click Save profile.';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  reviewBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

importBtn.addEventListener('click', async () => {
  const resume = await S.getResume();
  if (!resume) return;
  importBtn.disabled = true;
  importStatus.textContent = 'Reading your resume on this device…';
  try {
    const { extractResumeLines } = await import('./resume-import.js');
    const lines = await extractResumeLines(resume.data);
    if (!lines.length) {
      importStatus.textContent = 'No text found in this PDF. It may be a scanned image; fill your profile by hand.';
      return;
    }
    importStatus.textContent = '';
    showReview(parseResume(lines), lines);
  } catch (err) {
    importStatus.textContent = 'Could not read this PDF: ' + (err.message || err);
  } finally {
    importBtn.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// AI answers (optional). Saved immediately, separately from the profile. The key is never
// shown again after saving, never exported, and only the background script sends it.

const ANTHROPIC_ORIGIN = { origins: ['https://api.anthropic.com/*'] };
const aiEnabled = document.getElementById('ai-enabled');
const aiKey = document.getElementById('ai-key');
const aiModel = document.getElementById('ai-model');
const aiKeySave = document.getElementById('ai-key-save');
const aiKeyRemove = document.getElementById('ai-key-remove');
const aiStatus = document.getElementById('ai-status');

for (const m of S.AI_MODELS) aiModel.append(new Option(m.label, m.id));

async function renderAi(message) {
  const [settings, key] = await Promise.all([S.getAiSettings(), S.getApiKey()]);
  aiEnabled.checked = settings.enabled;
  aiModel.value = settings.model;
  aiKey.value = '';
  aiKey.placeholder = key ? `Saved key ending in …${key.slice(-4)}` : 'sk-ant-…';
  aiKeyRemove.hidden = !key;
  aiStatus.textContent = message || (settings.enabled && !key ? 'Add your API key to use AI answers.' : '');
}

aiEnabled.addEventListener('change', () => {
  if (aiEnabled.checked) {
    // Must be called straight from the click; browsers only allow permission prompts then.
    chrome.permissions.request(ANTHROPIC_ORIGIN).then(async (granted) => {
      if (!granted) {
        aiEnabled.checked = false;
        aiStatus.textContent = 'AI answers stay off: access to api.anthropic.com wasn’t granted.';
        return;
      }
      await S.saveAiSettings({ enabled: true, model: aiModel.value });
      renderAi('AI answers are on.');
    });
  } else {
    S.saveAiSettings({ enabled: false, model: aiModel.value })
      .then(() => chrome.permissions.remove(ANTHROPIC_ORIGIN))
      .then(() => renderAi('AI answers are off. Nothing is sent to Anthropic.'));
  }
});

aiModel.addEventListener('change', async () => {
  const settings = await S.getAiSettings();
  await S.saveAiSettings({ enabled: settings.enabled, model: aiModel.value });
  renderAi('Model saved.');
});

aiKeySave.addEventListener('click', async () => {
  const key = aiKey.value.trim();
  if (!key) return renderAi('Paste your API key first.');
  if (!/^sk-ant-[A-Za-z0-9_-]{10,}$/.test(key)) return renderAi('That doesn’t look like an Anthropic API key (they start with sk-ant-).');
  await S.saveApiKey(key);
  renderAi('Key saved.');
});

aiKeyRemove.addEventListener('click', async () => {
  if (!confirm('Remove your saved Anthropic API key?')) return;
  await S.clearApiKey();
  renderAi('Key removed.');
});

// ---------------------------------------------------------------------------
// Export / import

document.getElementById('export').addEventListener('click', async () => {
  if (dirty) await save();
  const data = await S.exportAll();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `jobscript-profile-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

const importInput = document.getElementById('import-input');
importInput.addEventListener('change', async () => {
  const file = importInput.files[0];
  importInput.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!confirm('Replace your saved profile with this file?')) return;
    await S.importAll(data);
    await load();
    saveStatus.textContent = 'Imported';
  } catch (err) {
    alert('Import failed: ' + (err.message || err));
  }
});

// ---------------------------------------------------------------------------

async function load() {
  profile = await S.getProfile();
  renderBasics();
  Object.keys(LISTS).forEach(renderList);
  await renderResume();
  await renderAi();
  setDirty(false);
}

load();
