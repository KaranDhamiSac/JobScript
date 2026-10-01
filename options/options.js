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
      { key: 'bullets', label: 'Bullet points, one per line (your master list)', type: 'lines', wide: true },
    ],
  },
  projects: {
    blank: S.blankProject,
    title: (e) => [e.name, e.subtitle].filter(Boolean).join(' | ') || 'New project',
    fields: [
      { key: 'name', label: 'Project name' },
      { key: 'subtitle', label: 'Short description', placeholder: 'Hiking route planner' },
      { key: 'tech', label: 'Technologies', placeholder: 'Next.js, FastAPI, PostgreSQL' },
      { key: 'link', label: 'Link', type: 'url' },
      { key: 'startDate', label: 'Start date', type: 'month' },
      { key: 'endDate', label: 'End date', type: 'month' },
      { key: 'bullets', label: 'Bullet points, one per line', type: 'lines', wide: true },
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
  references: {
    blank: S.blankReference,
    max: S.MAX_REFERENCES,
    title: (e) => [e.name, e.company].filter(Boolean).join(', ') || 'New reference',
    fields: [
      { key: 'name', label: 'Contact person' },
      { key: 'company', label: 'Company' },
      { key: 'relationship', label: 'Relationship to you', placeholder: 'Manager' },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'phone', label: 'Phone number', type: 'tel' },
      { key: 'yearsKnown', label: 'Years known' },
      { key: 'mayContact', label: 'May employers contact them?', type: 'select', options: [['yes', 'Yes'], ['no', 'No'], ['', 'Not set']] },
    ],
  },
  customAnswers: {
    blank: S.blankCustomAnswer,
    title: (e) => e.question || 'New question',
    fields: [
      { key: 'question', label: 'Question', wide: true },
      { key: 'answer', label: 'Answer', type: 'textarea', wide: true },
      { key: 'dateRule', label: 'For date questions', type: 'select', options: dateRuleOptions },
    ],
  },
};

// Saved date answers can follow a rule (lib/dateRules.js) instead of a fixed date.
function dateRuleOptions(entry) {
  const D = globalThis.JobScriptDates;
  const rules = [...D.PRESETS];
  if (entry.dateRule && D.isRule(entry.dateRule) && !rules.includes(entry.dateRule)) rules.push(entry.dateRule);
  return [['', 'Use the answer above'], ...rules.map((r) => [r, D.describe(r)])];
}

let profile = null;
let dirty = false;

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
      if (field.type === 'select') {
        input = document.createElement('select');
        const options = typeof field.options === 'function' ? field.options(entry) : field.options;
        for (const [value, text] of options) input.append(new Option(text, value));
        input.value = entry[field.key] ?? '';
      } else if (field.type === 'textarea' || field.type === 'lines') {
        input = document.createElement('textarea');
        input.value = field.type === 'lines' ? (entry[field.key] || []).join('\n') : entry[field.key] || '';
        if (field.type === 'lines') input.rows = 5;
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
        entry[field.key] =
          field.type === 'checkbox' ? input.checked : field.type === 'lines' ? input.value.split('\n') : input.value;
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
    const max = LISTS[listKey].max;
    if (max && profile[listKey].length >= max) {
      alert(`You can save up to ${max}.`);
      return;
    }
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
const aiImportBtn = document.getElementById('resume-import-ai');
const aiImportNote = document.getElementById('import-ai-note');
const importStatus = document.getElementById('import-status');
const reviewBox = document.getElementById('import-review');

function formatSize(bytes) {
  return bytes >= 1024 * 1024 ? (bytes / 1024 / 1024).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB';
}

async function renderResume() {
  const [resume, key] = await Promise.all([S.getResume(), S.getApiKey()]);
  aiImportBtn.hidden = aiImportNote.hidden = !(resume && key);
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
  } catch (err) {
    alert('Could not save the resume: ' + (err.message || err));
    renderResume();
    return;
  }
  await renderResume();
  if (await S.getApiKey()) {
    // With a key saved, reading the resume with Claude is your choice; nothing is sent yet.
    try {
      await readResumeLines();
    } catch (err) {
      /* reported when you import */
    }
    importStatus.textContent = 'Resume saved. Click Import with Claude to have Claude read it, or Import on this device.';
  } else {
    importOnDevice();
  }
});

resumeRemove.addEventListener('click', async () => {
  if (!confirm('Remove the saved resume and its imported text?')) return;
  await S.clearResume();
  linesCache = null;
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
    // The resume line this entry was read from, so mistakes are easy to spot.
    h('p', { class: 'source', text: entry.source ? `From your resume: “${entry.source}”` : 'Couldn’t match this to a line in your resume; check it carefully.' }),
  ]);
  const grid = h('div', { class: 'grid' });
  const inputs = {};
  for (const f of fields) {
    let input;
    if (f.type === 'textarea') input = h('textarea', { value: entry[f.key] || '' });
    else if (f.type === 'lines') input = h('textarea', { value: (entry[f.key] || []).join('\n'), rows: '5' });
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
    for (const f of fields) {
      const input = inputs[f.key];
      out[f.key] = f.type === 'checkbox' ? input.checked
        : f.type === 'lines' ? input.value.split('\n').map((l) => l.trim()).filter(Boolean)
        : input.value.trim();
    }
    return out;
  };
}

// Fields a resume can't answer, asked after every import. EEO answers keep your current choice,
// which defaults to "Decline to answer".
const QUESTIONNAIRE = [
  ['workAuthorized', 'Authorized to work in the US?'],
  ['requiresSponsorship', 'Require visa sponsorship?'],
  ['willingToRelocate', 'Willing to relocate?'],
  ['gender', 'Gender'],
  ['race', 'Race / ethnicity'],
  ['veteran', 'Veteran status'],
  ['disability', 'Disability status'],
];

function showReview(parsed, source) {
  reviewBox.replaceChildren();
  reviewBox.hidden = false;
  const origin = source === 'Claude' ? 'Read by Claude from your resume.' : 'Parsed on this device from your resume.';
  reviewBox.append(
    h('h2', { text: 'Review imported info' }),
    h('p', {
      class: 'muted',
      text: `${origin} Check what to keep and fix anything that looks wrong. Nothing is saved until you click Apply and then Save profile.`,
    })
  );

  const getters = { contact: [], workHistory: [], projects: [], education: [], skills: null, questionnaire: [] };

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
    ['projects', 'Projects', (e) => e.name || 'Project', ['name']],
    ['education', 'Education', (e) => e.school || e.degree || 'School', ['school', 'degree']],
  ];
  for (const [key, title, heading, dupKeys] of lists) {
    if (!(parsed[key] || []).length) continue;
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

  const found = getters.contact.length + getters.workHistory.length + getters.projects.length + getters.education.length + (getters.skills ? 1 : 0);
  if (!found) reviewBox.append(h('p', { text: 'JobScript couldn’t pick out any details. You can still fill your profile by hand.' }));

  reviewBox.append(
    h('h3', { text: 'A few things a resume can’t tell us' }),
    h('p', { class: 'muted', text: 'Self-identification answers default to “Decline to answer”. Change them only if you want to.' })
  );
  const qGrid = h('div', { class: 'grid' });
  for (const [key, label] of QUESTIONNAIRE) {
    // Reuse the options from the main form's own select, without its data-key binding.
    const select = document.querySelector(`#profile-form [data-key="${key}"]`).cloneNode(true);
    select.removeAttribute('data-key');
    select.value = profile[key] || '';
    qGrid.append(h('label', {}, [document.createTextNode(label), select]));
    getters.questionnaire.push(() => [key, select.value]);
  }
  reviewBox.append(qGrid);

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
    for (const [key, dateKey] of [['workHistory', 'startDate'], ['projects', 'startDate'], ['education', 'gradDate']]) {
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
    for (const get of getters.questionnaire) {
      const [key, value] = get();
      profile[key] = value;
    }
    renderBasics();
    Object.keys(LISTS).forEach(renderList);
    closeReview();
    setDirty(true);
    importStatus.textContent = 'Applied. Review your profile below, then click Save profile.';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  reviewBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Text of the saved resume, extracted on this device with pdf.js. The text is also saved for
// AI answers, which read the resume; it is derived from the resume you already saved.
let linesCache = null; // { savedAt, lines }

async function readResumeLines() {
  const resume = await S.getResume();
  if (!resume) return null;
  if (linesCache && linesCache.savedAt === resume.savedAt) return linesCache.lines;
  const { extractResumeLines } = await import('./resume-import.js');
  const lines = await extractResumeLines(resume.data);
  linesCache = { savedAt: resume.savedAt, lines };
  if (lines.length) await S.saveResumeText(lines.join('\n'));
  return lines;
}

const NO_TEXT = 'No text found in this PDF. It may be a scanned image; fill your profile by hand.';

function setImportBusy(busy, message) {
  importBtn.disabled = aiImportBtn.disabled = busy;
  if (message !== undefined) importStatus.textContent = message;
}

// Local fallback: pattern-based parsing, nothing leaves this device.
async function importOnDevice() {
  setImportBusy(true, 'Reading your resume on this device…');
  try {
    const lines = await readResumeLines();
    if (!lines) return;
    if (!lines.length) return void (importStatus.textContent = NO_TEXT);
    importStatus.textContent = '';
    showReview(parseResume(lines), 'this device');
  } catch (err) {
    importStatus.textContent = 'Could not read this PDF: ' + (err.message || err);
  } finally {
    setImportBusy(false);
  }
}

// Extract the text here, then have Claude (via background.js, which holds the key) structure it.
async function importWithClaude() {
  setImportBusy(true, 'Reading your resume…');
  try {
    const lines = await readResumeLines();
    if (!lines) return;
    if (!lines.length) return void (importStatus.textContent = NO_TEXT);
    importStatus.textContent = 'Claude is reading your resume…';
    const res = await chrome.runtime.sendMessage({ type: 'ai-parse-resume', text: lines.join('\n') });
    if (!res || !res.ok) {
      importStatus.textContent = `Claude couldn’t read it: ${(res && res.error) || 'unknown error.'} You can use Import on this device instead.`;
      return;
    }
    importStatus.textContent = '';
    showReview(res.draft, 'Claude');
  } catch (err) {
    importStatus.textContent = 'Could not import with Claude: ' + (err.message || err);
  } finally {
    setImportBusy(false);
  }
}

importBtn.addEventListener('click', importOnDevice);
aiImportBtn.addEventListener('click', () => {
  // Ask for access within the click itself; browsers only allow permission prompts then.
  // Resolves immediately when access was already granted.
  chrome.permissions.request(ANTHROPIC_ORIGIN).then((granted) => {
    if (granted) importWithClaude();
    else importStatus.textContent = 'Import with Claude needs access to api.anthropic.com.';
  });
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

// ---------------------------------------------------------------------------
// Saving answers

const autoSave = document.getElementById('auto-save');
S.getAnswerSettings().then((s) => {
  autoSave.checked = s.autoSave;
});
autoSave.addEventListener('change', () => S.saveAnswerSettings({ autoSave: autoSave.checked }));

// Sites with saved answers or learned steps. Labels and answers come from web pages, so
// everything is shown with textContent.
function make(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

async function forgetSite(origin) {
  await S.deleteSiteAnswers(origin);
  try {
    await chrome.scripting.unregisterContentScripts({ ids: ['site:' + origin] });
  } catch (e) {
    /* wasn't registered */
  }
  try {
    await chrome.permissions.remove({ origins: [origin + '/*'] });
  } catch (e) {
    /* Greenhouse and Lever access is built in */
  }
}

async function renderSites() {
  const sites = Object.entries(await S.getAllSiteAnswers()).sort((a, b) => String(b[1].updatedAt).localeCompare(String(a[1].updatedAt)));
  const box = document.getElementById('sites');
  document.getElementById('sites-empty').hidden = sites.length > 0;
  box.replaceChildren();
  for (const [origin, site] of sites) {
    const fields = Object.entries(site.fields || {});
    const steps = site.steps || [];
    const card = make('div', 'site');
    const head = make('div', 'site-head');
    head.append(make('strong', '', new URL(origin).host));
    const bits = [`${fields.length} answer${fields.length === 1 ? '' : 's'}`];
    if (steps.length) bits.push(`${steps.length} learned step${steps.length === 1 ? '' : 's'}`);
    if (site.learning) bits.push('learning now');
    head.append(make('span', 'muted small', ' · ' + bits.join(' · ')));
    const spacer = make('span', 'spacer');
    const toggle = make('button', 'secondary', 'Show');
    toggle.type = 'button';
    const forget = make('button', 'secondary danger', 'Forget site');
    forget.type = 'button';
    forget.addEventListener('click', async () => {
      if (!confirm(`Forget everything JobScript saved for ${new URL(origin).host}?`)) return;
      await forgetSite(origin);
      renderSites();
    });
    head.append(spacer, toggle, forget);
    const detail = make('div', 'site-detail');
    detail.hidden = true;
    toggle.addEventListener('click', () => {
      detail.hidden = !detail.hidden;
      toggle.textContent = detail.hidden ? 'Show' : 'Hide';
    });
    if (steps.length) {
      const ol = make('ol', 'steps');
      for (const st of steps) ol.append(make('li', '', `${st.title || 'Untitled step'} (${st.keys.length} field${st.keys.length === 1 ? '' : 's'})`));
      detail.append(ol);
    }
    const table = make('table', 'site-fields');
    for (const [key, f] of fields) {
      const tr = make('tr');
      tr.append(make('td', '', f.label || key.split('|')[1] || key));
      tr.append(make('td', 'muted', f.profileKey ? `${f.answer} (from your profile)` : f.answer));
      const td = make('td');
      const del = make('button', 'link', 'Delete');
      del.type = 'button';
      del.addEventListener('click', async () => {
        await S.deleteSiteAnswers(origin, key);
        renderSites();
      });
      td.append(del);
      tr.append(td);
      table.append(tr);
    }
    detail.append(table);
    card.append(head, detail);
    box.append(card);
  }
}

renderSites();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.siteAnswers) renderSites();
});

async function renderAi(message) {
  const [settings, key] = await Promise.all([S.getAiSettings(), S.getApiKey()]);
  aiEnabled.checked = settings.enabled;
  aiModel.value = settings.model;
  aiKey.value = '';
  aiKey.placeholder = key ? `Saved key ending in …${key.slice(-4)}` : 'sk-ant-…';
  aiKeyRemove.hidden = !key;
  aiStatus.textContent = message || (settings.enabled && !key ? 'Add your API key to use AI answers.' : '');
  renderResume(); // Import with Claude appears once a key is saved
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
