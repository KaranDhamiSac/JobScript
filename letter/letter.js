// Cover letter page: letter/letter.html?url=<application address>&tab=<tab id>
// Opened from the side panel ("Write cover letter"), the Tailor & Fill review page and the
// tracker. Shows the job breakdown and company profile it writes from, asks Claude (through
// background.js, which holds the API key) for a letter, re-checks it against its sources as you
// edit, then saves it with the application as text and as a PDF with your resume's header.
import { buildCoverLetterPdf, contactParts } from '../tailor/resume-pdf.js';

const S = JobScriptStorage;
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const url = params.get('url') || '';
const tabId = Number(params.get('tab')) || null;
const ANTHROPIC = { origins: ['https://api.anthropic.com/*'] };

let profile = null;
let posting = null;
let parsed = null;
let company = null;
let used = [];
let checkTimer = null;

function h(tag, props, children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'text') n.textContent = v;
    else if (k === 'class') n.className = v;
    else n.setAttribute(k, v);
  }
  for (const c of children || []) if (c) n.append(c);
  return n;
}

function setStatus(text) {
  $('status').textContent = text;
}

function fullName() {
  return [profile.firstName, profile.lastName].filter(Boolean).join(' ');
}

function fileName() {
  const part = (s) => String(s || '').replace(/[^A-Za-z0-9]+/g, '');
  return [part(profile.firstName), part(profile.lastName), part(posting.company), 'Cover_Letter'].filter(Boolean).join('_') + '.pdf';
}

function chips(id, list) {
  $(id).replaceChildren(...list.map((t) => h('span', { class: 'chip', text: t })));
}

function renderJob() {
  if (!parsed) return;
  $('job-summary').textContent = parsed.roleSummary || 'No summary.';
  chips('job-required', parsed.requiredSkills || []);
  chips('job-preferred', parsed.preferredSkills || []);
  chips('job-keywords', parsed.keywords || []);
  $('job-meta').textContent = `Seniority: ${parsed.seniority || 'unknown'} · read ${new Date(parsed.parsedAt).toLocaleDateString()} by Claude Haiku`;
  $('job-detail').hidden = false;
}

function companyItems() {
  return S.COMPANY_SECTIONS.flatMap((sec) => company[sec].map((it, i) => ({ id: `${sec}.${i}`, sec, ...it })));
}

function renderCompany() {
  const box = $('company-summary');
  const items = companyItems();
  const link = $('company-link');
  link.href = `../company/company.html?name=${encodeURIComponent(posting.company || '')}&domain=${encodeURIComponent(posting.companyDomain || company.domain || '')}`;
  if (!items.length) {
    box.replaceChildren(h('p', { class: 'muted', text: `No company profile for ${posting.company || 'this company'} yet. Without one, the letter connects to the role instead of the company. Research it from the company profile, then write again.` }));
    link.textContent = 'Research the company';
    return;
  }
  link.textContent = 'Open company profile';
  const first = (sec) => company[sec][0] && company[sec][0].text;
  const lines = [];
  if (first('mission')) lines.push(h('p', { class: 'company-item', text: 'Mission: ' + first('mission') }));
  if (company.values.length) lines.push(h('p', { class: 'company-item', text: 'Values: ' + company.values.map((v) => v.text).join(' · ') }));
  const nouns = { products: ['product or service', 'products or services'], news: ['news item', 'news items'], culture: ['note on culture', 'notes on culture'] };
  const counts = ['products', 'news', 'culture'].filter((s) => company[s].length).map((s) => `${company[s].length} ${nouns[s][company[s].length === 1 ? 0 : 1]}`);
  if (counts.length) lines.push(h('p', { class: 'company-item muted', text: 'Also: ' + counts.join(', ') }));
  if (company.updatedAt) lines.push(h('p', { class: 'muted small', text: `Last updated ${new Date(company.updatedAt).toLocaleDateString()}` }));
  box.replaceChildren(...lines);
}

function renderSignoff() {
  $('signoff').textContent = `Ends with “Sincerely,” and ${fullName() || 'your name'}. The PDF starts with the same header as your resume.`;
}

function runCheck() {
  const flags = JobScriptLetterCheck.check($('letter').value, {
    profile,
    company,
    companyName: posting.company,
    role: posting.title,
    jobText: [posting.description, JSON.stringify(parsed || {})].join('\n'),
  });
  const title = $('flags-title');
  title.className = flags.length ? 'warn' : 'ok';
  title.textContent = flags.length
    ? `Check ${flags.length} thing${flags.length === 1 ? '' : 's'} that don’t trace back to your resume or the company profile`
    : 'Everything traces back to your resume and the company profile.';
  $('flags').replaceChildren(
    ...flags.map((f) => h('li', {}, [document.createTextNode(f.message), f.sentence !== f.text ? h('span', { class: 'quote', text: '“' + f.sentence + '”' }) : null]))
  );
  return flags;
}

function renderUsed() {
  const items = companyItems().filter((it) => used.includes(it.id));
  $('used-box').hidden = !items.length;
  $('used').replaceChildren(
    ...items.map((it) => h('li', {}, [document.createTextNode(it.text + ' '), it.source ? h('a', { href: it.source, target: '_blank', rel: 'noopener noreferrer', text: '(source)' }) : h('span', { class: 'muted small', text: '(added by you)' })]))
  );
}

function showLetter(text) {
  $('letter').value = text;
  $('editor-box').hidden = false;
  $('actions').hidden = false;
  $('file-name').textContent = 'Saves as ' + fileName();
  renderSignoff();
  renderUsed();
  runCheck();
}

$('letter').addEventListener('input', () => {
  clearTimeout(checkTimer);
  checkTimer = setTimeout(runCheck, 300);
});

for (const id of ['tone', 'length']) {
  $(id).addEventListener('change', () => S.saveResearchSettings({ [id]: $(id).value }));
}

// The letter as greeting + paragraphs, split back out of the text box.
function letterParts() {
  const blocks = $('letter').value.split(/\n\s*\n/).map((b) => b.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
  const greeting = /^(dear|hello|hi|to whom)\b/i.test(blocks[0] || '') ? blocks.shift() : 'Dear Hiring Manager,';
  // A sign-off typed into the box isn't repeated.
  while (blocks.length && (isSignoff(blocks[blocks.length - 1]) || blocks[blocks.length - 1] === fullName())) blocks.pop();
  return { greeting, paragraphs: blocks };
}

const SIGNOFF_RE = /^(sincerely|best|best regards|regards|kind regards|warm regards|yours truly|respectfully|thank you),?(\s|$)/i;

function isSignoff(block) {
  return block.length < 80 && SIGNOFF_RE.test(block);
}

// A saved letter ends with "Sincerely,\n<your name>"; the box shows the letter without it.
function withoutSignoff(text) {
  const blocks = String(text || '').split(/\n\s*\n/);
  while (blocks.length && isSignoff(blocks[blocks.length - 1].replace(/\s*\n\s*/g, ' ').trim())) blocks.pop();
  return blocks.join('\n\n');
}

function fullText() {
  const { greeting, paragraphs } = letterParts();
  return [greeting, ...paragraphs, 'Sincerely,\n' + fullName()].join('\n\n');
}

async function buildPdf() {
  const { greeting, paragraphs } = letterParts();
  return buildCoverLetterPdf(
    {
      name: fullName(),
      contact: contactParts(profile),
      date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      recipient: ['Hiring Team', posting.company].filter(Boolean),
      greeting,
      paragraphs,
    },
    { subject: `${posting.title} at ${posting.company}` }
  );
}

function toBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function save() {
  const out = await buildPdf();
  if (out.overflow) {
    setStatus('The letter is longer than one page. Shorten it, then save.');
    return null;
  }
  const flags = runCheck();
  await S.saveLetter(url, {
    text: fullText(),
    tone: $('tone').value,
    length: $('length').value,
    flags: flags.length,
    usedCompanyItems: used,
    title: posting.title,
    company: posting.company,
    pdf: { name: fileName(), data: toBase64(out.bytes), size: out.bytes.length },
    createdAt: new Date().toISOString(),
  });
  return out;
}

$('preview').addEventListener('click', async () => {
  const out = await buildPdf();
  setStatus(out.overflow ? 'Longer than one page; shorten it before saving.' : `Preview at ${out.fontSize} pt, one page.`);
  const blobUrl = URL.createObjectURL(new Blob([out.bytes], { type: 'application/pdf' }));
  window.open(blobUrl, '_blank');
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
});

$('save').addEventListener('click', async () => {
  if (await save()) setStatus(`Saved ${fileName()} with this application. It goes into the cover letter field the next time you fill it.`);
});

$('add').addEventListener('click', async () => {
  const btn = $('add');
  btn.disabled = true;
  try {
    if (!(await save())) return;
    const res = await chrome.runtime.sendMessage({ type: 'letter-fill', url, tabId });
    if (!res || !res.ok) {
      setStatus(`Saved ${fileName()}, but couldn’t add it: ${(res && res.error) || 'unknown error'}`);
      return;
    }
    const how = [res.attached ? 'attached the PDF' : '', res.pasted ? 'pasted the text' : ''].filter(Boolean).join(' and ');
    setStatus(`Saved and ${how} on the application. Review it there before you submit.`);
  } finally {
    btn.disabled = false;
  }
});

async function parseJob(refresh) {
  setStatus(refresh ? 'Reading the posting again…' : 'Reading the job posting…');
  let res;
  try {
    res = await chrome.runtime.sendMessage({ type: 'job-parse', url, refresh });
  } catch (e) {
    res = { ok: false, error: String(e.message || e) };
  }
  if (!res || !res.ok) {
    setStatus('Couldn’t read the job: ' + ((res && res.error) || 'unknown error'));
    return false;
  }
  parsed = res.parsed;
  posting = res.posting;
  renderJob();
  setStatus(res.cached ? '' : `Read the posting (about $${(res.cost || 0).toFixed(3)}).`);
  return true;
}

$('reparse').addEventListener('click', () => parseJob(true));

async function write() {
  const btn = $('write');
  btn.disabled = true;
  setStatus('Claude is writing your cover letter…');
  let res;
  try {
    res = await chrome.runtime.sendMessage({ type: 'letter-write', url, tone: $('tone').value, length: $('length').value });
  } catch (e) {
    res = { ok: false, error: String(e.message || e) };
  } finally {
    btn.disabled = false;
  }
  if (!res || !res.ok) {
    setStatus('Couldn’t write the letter: ' + ((res && res.error) || 'unknown error'));
    return;
  }
  // The job breakdown may have been read just now.
  parsed = (await S.getJobParse(url)) || parsed;
  renderJob();
  used = res.letter.usedCompanyItems;
  showLetter(res.text);
  $('write').textContent = 'Write again';
  setStatus(`Written by ${res.model} (about $${res.cost.toFixed(3)}). Read it, fix anything flagged, then save.` + (res.companyResearched ? '' : ' There was no company profile, so it connects to the role instead.'));
}

$('write').addEventListener('click', write);

$('allow').addEventListener('click', () => {
  chrome.permissions.request(ANTHROPIC).then((granted) => {
    if (!granted) return setStatus('Writing a cover letter needs access to api.anthropic.com.');
    $('allow').hidden = true;
    setStatus('');
  });
});

async function init() {
  [profile, posting, parsed] = await Promise.all([S.getProfile(), S.getPosting(url), S.getJobParse(url)]);
  if (!posting) {
    setStatus('No job posting is saved for this application. Fill the application page with JobScript first, then open this page again.');
    $('write').disabled = true;
    $('reparse').disabled = true;
    return;
  }
  company = (await S.getCompany(posting.company)) || S.blankCompany(posting.company);
  $('job-line').textContent = [posting.title, posting.company].filter(Boolean).join(' at ');
  document.title = `Cover letter: ${posting.company || posting.title || 'application'}`;
  const settings = await S.getResearchSettings();
  const saved = await S.getLetter(url);
  $('tone').value = (saved && saved.tone) || settings.tone;
  $('length').value = (saved && saved.length) || settings.length;
  renderJob();
  renderCompany();
  if (saved && saved.text) {
    used = saved.usedCompanyItems || [];
    showLetter(withoutSignoff(saved.text));
    $('write').textContent = 'Write again';
    setStatus(`Your saved letter from ${new Date(saved.savedAt).toLocaleDateString()}.`);
  }
  if (!(await S.getApiKey())) {
    setStatus('Writing uses Claude. Add your Anthropic API key in Options first.');
    $('write').disabled = true;
    $('reparse').disabled = true;
    return;
  }
  if (!(await chrome.permissions.contains(ANTHROPIC))) {
    $('allow').hidden = false;
    setStatus('JobScript needs permission to reach api.anthropic.com.');
  }
}

// Keep the company section current when you edit the profile in another tab.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !posting) return;
  const key = 'company:' + S.companyKey(posting.company);
  if (changes[key]) {
    company = S.cleanCompany(changes[key].newValue || S.blankCompany(posting.company));
    renderCompany();
    if (!$('editor-box').hidden) {
      renderUsed();
      runCheck();
    }
  }
});

init();
