// Tailor & Fill review page. Opened by background.js with ?sid=<session>; the session (in
// storage.session) holds the job posting and the tab to fill.
//
// 1. Ask Claude (via background.js, which holds the API key) for a tailored version of the
//    master resume. background.js has already enforced the hard rules on every line.
// 2. Show original vs tailored side by side; every line is editable, nothing is used yet.
// 3. On approve: build the PDF here (pdf-lib), save it with the application, and fill the
//    job tab with it attached.
import { buildResumePdf, contactParts } from './resume-pdf.js';

const S = JobScriptStorage;
const ANTHROPIC_ORIGIN = { origins: ['https://api.anthropic.com/*'] };
const sid = new URLSearchParams(location.search).get('sid') || '';

const $ = (id) => document.getElementById(id);
const statusEl = $('status');
let profile = null;
let session = null;
let tailored = null;

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

function setStatus(text) {
  statusEl.textContent = text;
}

function month(ym) {
  const m = /^(\d{4})-(\d{2})/.exec(ym || '');
  return m ? new Date(Number(m[1]), Number(m[2]) - 1).toLocaleString('en-US', { month: 'short' }) + ' ' + m[1] : '';
}

function dateRange(start, end, current) {
  const a = month(start);
  const b = current ? 'Present' : month(end);
  return a && b ? `${a} - ${b}` : a || b;
}

function fileName() {
  const part = (s) => String(s || '').replace(/[^A-Za-z0-9]+/g, '');
  const parts = [part(profile.firstName), part(profile.lastName), part(session.posting.company)].filter(Boolean);
  return (parts.join('_') || 'Resume') + '.pdf';
}

function contactLine() {
  return contactParts(profile).join('  |  ');
}

// ---------------------------------------------------------------------------
// Review screen. Each entry keeps getters so the approved resume is read back from the inputs.

const entryGetters = { jobs: [], projects: [], education: [] };

// A locked bullet stays exactly as in your master resume, here and every time you tailor.
function lockButton(row, text, original, locked) {
  const btn = h('button', { type: 'button', class: 'secondary lock', 'aria-pressed': String(!!locked) });
  const show = (on) => {
    btn.textContent = on ? '🔒 Locked' : 'Lock';
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-label', on ? 'Unlock this bullet' : 'Lock this bullet: keep it exactly as in your master resume');
    row.classList.toggle('locked', on);
    text.readOnly = on;
    if (on) text.value = original;
  };
  show(!!locked);
  btn.addEventListener('click', async () => {
    const on = btn.getAttribute('aria-pressed') !== 'true';
    show(on);
    await chrome.runtime.sendMessage({ type: 'tailor-lock', text: original, locked: on }).catch(() => {});
  });
  return btn;
}

function bulletRows(container, bullets) {
  container.append(h('div', { class: 'cols' }, [h('span', { text: '' }), h('span', { text: 'Your master bullet' }), h('span', { text: 'Tailored (editable)' })]));
  const rows = [];
  const addRow = (b) => {
    const include = h('input', { type: 'checkbox', checked: b.include !== false, 'aria-label': 'Include this bullet' });
    const text = h('textarea', { value: b.text, rows: '2', 'aria-label': 'Tailored bullet' });
    const cls = b.note && b.note.startsWith('Kept original') ? 'reverted' : b.text !== b.original ? 'changed' : '';
    const row = h('div', { class: 'bullet ' + cls }, [
      include,
      h('div', { class: 'original', text: b.original }),
      text,
      b.note ? h('div', { class: 'note', text: b.note }) : null,
    ]);
    row.append(lockButton(row, text, b.original, b.locked));
    include.addEventListener('change', () => row.classList.toggle('excluded', !include.checked));
    if (!include.checked) row.classList.add('excluded');
    container.append(row);
    rows.push(() => (include.checked && text.value.trim() ? text.value.trim() : null));
  };
  bullets.forEach(addRow);
  return { rows, addRow };
}

function renderEntry(container, { left, right, sub, subRight, bullets, unused, titlePick }) {
  const include = h('input', { type: 'checkbox', checked: true });
  const leftIn = h('input', { type: 'text', value: left });
  const rightIn = h('input', { type: 'text', value: right || '' });
  const subIn = h('input', { type: 'text', value: sub || '' });
  const card = h('div', { class: 'entry' }, [h('div', { class: 'entry-head' }, [include, leftIn, rightIn]), h('div', { class: 'entry-sub' }, [subIn])]);
  // Your title and the posting's wording side by side; yours stays unless you pick the other.
  if (titlePick) {
    const use = h('button', { type: 'button', class: 'secondary', text: `Use “${titlePick.suggested}”` });
    const pick = h('div', { class: 'title-pick', role: 'group', 'aria-label': 'Job title' }, [
      h('span', { text: `Your title: ${titlePick.original}` }),
      h('span', { class: 'muted', text: `Posting’s wording: ${titlePick.suggested}` }),
      use,
    ]);
    let usingSuggested = false;
    use.addEventListener('click', () => {
      usingSuggested = !usingSuggested;
      const [from, to] = usingSuggested ? [titlePick.original, titlePick.suggested] : [titlePick.suggested, titlePick.original];
      if (leftIn.value.startsWith(from)) leftIn.value = to + leftIn.value.slice(from.length);
      use.textContent = usingSuggested ? `Use “${titlePick.original}”` : `Use “${titlePick.suggested}”`;
    });
    card.append(pick);
  }
  include.addEventListener('change', () => card.classList.toggle('excluded', !include.checked));
  const list = h('div');
  card.append(list);
  const { rows, addRow } = bulletRows(list, bullets);
  if (unused && unused.length) {
    const select = h('select', {}, [h('option', { value: '', text: 'Add a bullet you have that Claude left out…' })]);
    unused.forEach((u, i) => select.append(h('option', { value: String(i), text: u.original.slice(0, 120) })));
    select.addEventListener('change', () => {
      const u = unused[Number(select.value)];
      if (!u) return;
      addRow({ original: u.original, text: u.original, note: 'Added back by you' });
      select.selectedOptions[0].remove();
      select.value = '';
    });
    card.append(h('div', { class: 'row' }, [select]));
  }
  container.append(card);
  return () =>
    include.checked
      ? { left: leftIn.value.trim(), right: rightIn.value.trim(), sub: subIn.value.trim(), subRight: subRight || '', bullets: rows.map((r) => r()).filter(Boolean) }
      : null;
}

function renderJob(t) {
  const j = profile.workHistory[t.index];
  entryGetters.jobs.push(
    renderEntry($('jobs'), {
      left: [j.title, j.employer].filter(Boolean).join(', '),
      right: dateRange(j.startDate, j.endDate, j.current),
      sub: j.location,
      bullets: t.bullets,
      unused: t.unused,
      titlePick: t.titleSuggestion && j.title ? { original: j.title, suggested: t.titleSuggestion } : null,
    })
  );
}

function renderProject(t) {
  const p = profile.projects[t.index];
  entryGetters.projects.push(
    renderEntry($('projects'), {
      left: [p.name, p.subtitle].filter(Boolean).join(' | '),
      right: dateRange(p.startDate, p.endDate, false),
      sub: p.tech,
      bullets: t.bullets,
      unused: t.unused,
    })
  );
}

function renderReview() {
  $('review').hidden = false;
  $('actions').hidden = false;
  $('file-name').textContent = 'Saves as ' + fileName();

  for (const k of tailored.keywords) {
    const missing = tailored.missingKeywords.includes(k);
    $(missing ? 'kw-missing' : 'kw-found').append(h('span', { class: 'chip', text: k }));
  }

  $('r-name').value = [profile.firstName, profile.lastName].filter(Boolean).join(' ');
  $('r-contact').value = contactLine();

  tailored.jobs.forEach(renderJob);
  tailored.projects.forEach(renderProject);

  // Projects Claude didn't pick can be added back, with their original bullets.
  const chosen = new Set(tailored.projects.map((p) => p.index));
  const others = profile.projects.map((p, i) => ({ p, i })).filter(({ i }) => !chosen.has(i));
  const select = $('add-project');
  select.append(h('option', { value: '', text: others.length ? 'Projects Claude left out…' : 'No other projects' }));
  for (const { p, i } of others) select.append(h('option', { value: String(i), text: p.name }));
  $('add-project-btn').disabled = !others.length;
  $('add-project-btn').addEventListener('click', () => {
    const i = Number(select.value);
    if (select.value === '' || !profile.projects[i]) return;
    renderProject({ index: i, bullets: profile.projects[i].bullets.map((b) => ({ original: b, text: b, note: 'Added back by you' })), unused: [] });
    select.selectedOptions[0].remove();
  });

  for (const e of profile.education) {
    entryGetters.education.push(
      renderEntry($('education'), {
        left: e.school,
        right: month(e.gradDate),
        sub: [[e.degree, e.major].filter(Boolean).join(', '), e.gpa ? `GPA: ${e.gpa}` : ''].filter(Boolean).join(' | '),
        bullets: [],
      })
    );
  }

  $('skills').value = tailored.skills.join(', ');
  $('summary').value = tailored.summary || '';
  $('summary-note').textContent = tailored.summaryNote || '';
}

// The resume on screen in the shape Claude scores (ids like the master resume's), for the
// "after" score. Contact details aren't part of it.
function resumeForScore() {
  const entries = (getters, prefix) => getters.map((g) => g()).filter(Boolean).map((e, i) => ({
    id: prefix + i,
    heading: e.left,
    dates: e.right,
    detail: e.sub,
    bullets: e.bullets.map((text, bi) => ({ id: `${prefix}${i}b${bi}`, text })),
  }));
  return {
    summary: $('summary').value.trim(),
    jobs: entries(entryGetters.jobs, 'j'),
    projects: entries(entryGetters.projects, 'p'),
    skills: $('skills').value.split(/,(?![^(]*\))/).map((x) => x.trim()).filter(Boolean),
    education: profile.education.map((e) => ({ school: e.school, degree: e.degree, major: e.major })),
  };
}

function showScore(el, value, better) {
  el.textContent = Number.isFinite(value) ? String(value) : '–';
  el.classList.toggle('up', !!better);
}

async function scoreBeforeAfter() {
  const btn = $('rescore');
  btn.disabled = true;
  $('score-status').textContent = 'Scoring with Claude Haiku…';
  let res;
  try {
    res = await chrome.runtime.sendMessage({ type: 'tailor-score', sid, resume: resumeForScore() });
  } catch (err) {
    res = { ok: false, error: String(err.message || err) };
  }
  btn.disabled = false;
  if (!res || !res.ok) {
    $('score-status').textContent = 'Couldn’t score: ' + ((res && res.error) || 'unknown error');
    return;
  }
  showScore($('score-before'), res.before, false);
  showScore($('score-after'), res.after, Number.isFinite(res.after) && Number.isFinite(res.before) && res.after > res.before);
  $('score-status').textContent = res.cost ? `about $${res.cost.toFixed(3)}` : '';
  $('score-reason').textContent = res.afterReason || res.beforeReason || '';
}

$('rescore').addEventListener('click', scoreBeforeAfter);

// The resume exactly as approved on screen.
function approvedResume() {
  const collect = (getters) => getters.map((g) => g()).filter(Boolean);
  return {
    name: $('r-name').value.trim(),
    contact: $('r-contact').value.split('|').map((s) => s.trim()).filter(Boolean),
    sections: [
      { heading: 'Summary', lines: [$('summary').value.trim()] },
      { heading: 'Education', entries: collect(entryGetters.education) },
      { heading: 'Technical Skills', lines: [$('skills').value.trim()] },
      { heading: 'Experience', entries: collect(entryGetters.jobs) },
      { heading: 'Projects', entries: collect(entryGetters.projects) },
    ],
  };
}

function toBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function buildPdf() {
  const out = await buildResumePdf(approvedResume(), { subject: `${session.posting.title} at ${session.posting.company}` });
  const notes = [];
  if (out.trimmed) notes.push(`Dropped ${out.trimmed} lowest-priority bullet${out.trimmed === 1 ? '' : 's'} to fit one page.`);
  if (out.overflow) notes.push('Still longer than one page; untick some bullets.');
  return { ...out, notes };
}

$('preview').addEventListener('click', async () => {
  const out = await buildPdf();
  setStatus(out.notes.join(' ') || `Preview at ${out.fontSize} pt, one page.`);
  const url = URL.createObjectURL(new Blob([out.bytes], { type: 'application/pdf' }));
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
});

$('approve').addEventListener('click', async () => {
  const btn = $('approve');
  btn.disabled = true;
  try {
    const out = await buildPdf();
    if (out.overflow) {
      setStatus(out.notes.join(' '));
      return;
    }
    const id = String(Date.now()) + Math.random().toString(36).slice(2, 7);
    const name = fileName();
    await S.saveTailored(id, {
      name,
      type: 'application/pdf',
      size: out.bytes.length,
      data: toBase64(out.bytes),
      savedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      company: session.posting.company,
      title: session.posting.title,
      url: session.posting.url,
      content: approvedResume(),
    });
    setStatus(`Saved ${name}. Filling the application…`);
    const res = await chrome.runtime.sendMessage({ type: 'tailor-fill', sid, tailoredId: id });
    if (!res || !res.ok) {
      setStatus(`Saved ${name}, but filling failed: ${(res && res.error) || 'unknown error'}`);
      return;
    }
    if (res.saved) {
      // Tailored from a job board or a page without the form: kept with the job in your tracker.
      $('status-box').classList.add('done');
      setStatus(`Saved ${name} with this job in your tracker. Press Apply on the job page; JobScript attaches it when it fills the employer’s application.`);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    $('status-box').classList.add('done');
    setStatus(`Done. Filled ${res.filled} of ${res.total} fields with ${name} attached. ${out.notes.join(' ')} Review the application tab before you submit; it's also in your Applications list.`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    setStatus('Something went wrong: ' + (err.message || err));
  } finally {
    btn.disabled = false;
  }
});

// ---------------------------------------------------------------------------

async function runTailor() {
  $('allow').hidden = true;
  $('retry').hidden = true;
  setStatus('Claude is tailoring your resume to this job…');
  let res;
  try {
    res = await chrome.runtime.sendMessage({ type: 'ai-tailor', sid });
  } catch (err) {
    res = { ok: false, error: String(err.message || err) };
  }
  if (!res || !res.ok) {
    setStatus('Couldn’t tailor: ' + ((res && res.error) || 'unknown error'));
    $('retry').hidden = false;
    return;
  }
  tailored = res.tailored;
  const used = [res.usedBreakdown ? 'the job breakdown' : '', res.usedCompany ? 'the company profile (summary only)' : ''].filter(Boolean);
  if (used.length) $('sent-note').textContent += ` This time it also used ${used.join(' and ')}.`;
  const reverted = [...tailored.jobs, ...tailored.projects].flatMap((e) => e.bullets).filter((b) => b.note.startsWith('Kept original')).length;
  setStatus(
    `Tailored by ${res.model}${res.cost ? ` (about $${res.cost.toFixed(3)})` : ''}. Review every line, then approve.` +
      (reverted ? ` ${reverted} rewrite${reverted === 1 ? '' : 's'} broke a rule and ${reverted === 1 ? 'was' : 'were'} put back to your original (highlighted).` : '')
  );
  renderReview();
  scoreBeforeAfter();
}

$('allow').addEventListener('click', () => {
  // Permission prompts are only allowed inside a click.
  chrome.permissions.request(ANTHROPIC_ORIGIN).then((granted) => {
    if (granted) runTailor();
    else setStatus('Tailoring needs access to api.anthropic.com.');
  });
});
$('retry').addEventListener('click', runTailor);

// The cover letter page for the same application, next to this tab.
$('letter').addEventListener('click', async () => {
  const here = await chrome.tabs.getCurrent();
  const params = new URLSearchParams({ url: session.posting.url, tab: String(session.tabId) });
  chrome.tabs.create({ url: chrome.runtime.getURL('letter/letter.html?' + params), index: here ? here.index + 1 : undefined });
});

async function init() {
  const key = 'tailor:' + sid;
  session = (await chrome.storage.session.get(key))[key];
  if (!session) {
    setStatus('This tailoring session expired. Go back to the job tab and click Tailor & Fill again.');
    return;
  }
  profile = await S.getProfile();
  $('job-line').textContent = [session.posting.title, session.posting.company].filter(Boolean).join(' at ');
  // From LinkedIn, Indeed or Glassdoor there's no form to fill here: approving saves the resume
  // with the job, for when you apply on the employer's site.
  if (JobScriptDetect.isReadOnlyBoard(session.posting.url)) $('approve').textContent = 'Approve & save for this job';
  document.title = `Tailor: ${session.posting.company || 'Resume'}`;
  if (!profile.workHistory.length && !profile.projects.length) {
    setStatus('Your master resume is empty. Import your resume in Options first.');
    return;
  }
  if (!(await S.getApiKey())) {
    setStatus('Tailoring uses Claude. Add your Anthropic API key in Options, then click Tailor & Fill again.');
    return;
  }
  if (!(await chrome.permissions.contains(ANTHROPIC_ORIGIN))) {
    setStatus('JobScript needs permission to reach api.anthropic.com.');
    $('allow').hidden = false;
    return;
  }
  runTailor();
}

init();
