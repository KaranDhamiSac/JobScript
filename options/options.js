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
  } else {
    resumeStatus.textContent = 'No resume saved.';
    resumeChoose.textContent = 'Upload PDF';
    resumeRemove.hidden = true;
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
  }
  renderResume();
});

resumeRemove.addEventListener('click', async () => {
  if (!confirm('Remove the saved resume?')) return;
  await S.clearResume();
  renderResume();
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
  setDirty(false);
}

load();
