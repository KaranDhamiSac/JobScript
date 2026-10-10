// Background script: runs the fill for the popup button and the Alt+Shift+F shortcut.
// Chrome loads it as a service worker, Firefox as an event page (see manifest.json).
//
// New features (e.g. a future job-description match score) can add their own message
// types to the onMessage router below. Every handler must go through isTrustedSender().

// Chrome runs this file as a service worker and loads helpers with importScripts; Firefox lists
// them before this file in manifest.json "background.scripts".
if (typeof importScripts === 'function') importScripts('lib/storage.js', 'lib/ai.js', 'lib/agent.js', 'lib/research.js', 'lib/letterCheck.js', 'lib/canonical.js', 'lib/eligibility.js', 'lib/jobDetect.js');

const CONTENT_FILES = ['lib/storage.js', 'lib/fieldMap.js', 'lib/dateRules.js', 'lib/canonical.js', 'lib/jobDetect.js', 'content/panel.js', 'content/bank.js', 'content/autofill.js', 'content/agent.js', 'content/jobtab.js'];
// What job boards JobScript only reads (LinkedIn, Indeed, Glassdoor) get: the Job tab, no fill.
const JOB_FILES = ['lib/storage.js', 'lib/jobDetect.js', 'content/panel.js', 'content/jobtab.js'];
const CONTENT_CSS = ['content/autofill.css'];

// Calls the fill in every frame that has the content script. Frames without it return null.
// Runs `fn` (by name, on globalThis) in every frame that has the content script.
async function callInFrames(tabId, allFrames, fnName, arg) {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames },
    func: (name, a) => (typeof globalThis[name] === 'function' ? globalThis[name](a) : null),
    args: [fnName, arg === undefined ? null : arg],
  });
  return (results || []).map((r) => r && r.result).filter(Boolean);
}

// Same as callInFrames, but on sites without the built-in content script, injects it first
// (top frame only) using the temporary activeTab grant from your click or shortcut.
async function callWithInjection(tabId, fnName, arg) {
  let frames = await callInFrames(tabId, true, fnName, arg);
  if (!frames.length) {
    // On a board JobScript only reads, only the Job tab's read-only scripts go in.
    if (await onReadOnlyBoard(tabId)) {
      await chrome.scripting.executeScript({ target: { tabId }, files: JOB_FILES });
    } else {
      await chrome.scripting.insertCSS({ target: { tabId }, files: CONTENT_CSS });
      await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_FILES });
    }
    frames = await callInFrames(tabId, false, fnName, arg);
  }
  return frames;
}

// LinkedIn, Indeed and Glassdoor: JobScript reads their job pages and never fills, clicks or
// runs the agent there.
async function onReadOnlyBoard(tabId) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  return !!(tab && tab.url && JobScriptDetect.isReadOnlyBoard(tab.url));
}

const READ_ONLY_ERROR = 'JobScript only reads job pages on LinkedIn, Indeed and Glassdoor. Apply on the employer’s site, where it can fill the form.';

// opts.tailoredId: attach that tailored resume instead of the master.
async function fillTab(tabId, opts) {
  if (await onReadOnlyBoard(tabId)) return { ok: false, error: READ_ONLY_ERROR };
  let frames;
  try {
    // Frames on the job sites in the manifest already have the content script (including
    // Greenhouse and iCIMS forms embedded in an iframe on a company's careers page).
    frames = await callWithInjection(tabId, '__jobscriptFill', opts || null);
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

  await grantAiAllowance(tabId);

  // Application tracker: one entry per job (same URL updates the existing entry).
  const withJob = done.find((f) => f.company || f.jobTitle) || done[0];
  // Tailor & Fill's resume, or one made for this job earlier that the fill found and attached.
  const tailoredId = (opts && opts.tailoredId) || (done.find((f) => f.tailoredId) || {}).tailoredId || '';
  const tailored = tailoredId ? await JobScriptStorage.getTailored(tailoredId) : null;
  const app = await JobScriptStorage.upsertApplication({
    url: withJob.url,
    company: withJob.company,
    title: withJob.jobTitle,
    site: summary.site,
    tailoredId: tailored ? tailoredId : '',
    tailoredFileName: tailored ? tailored.name : '',
    folder: opts && opts.folder,
  });
  // A confirmation page in this tab soon after marks this application Applied.
  await chrome.storage.session.set({ ['filled:' + tabId]: { appId: app.id, at: Date.now() } });
  // Keep the full posting with the entry, in case it's taken down later. Not awaited: reading
  // the posting can take a moment and the popup is waiting for this summary.
  savePostingFor(tabId, withJob.url).catch(() => {});

  // Tab-scoped badge; the browser clears it when the tab navigates.
  await chrome.action.setBadgeBackgroundColor({ tabId, color: summary.needsAttention ? '#ca8a04' : '#16a34a' });
  await chrome.action.setBadgeText({ tabId, text: String(summary.filled) });
  return summary;
}

// The posting in this tab (the frame with the form first, then the longest description), saved
// under the application's address.
async function readPosting(tabId) {
  const postings = await callWithInjection(tabId, '__jobscriptJobPosting');
  if (!postings.length) return null;
  return postings.sort((a, b) => (b.hasForm - a.hasForm) || b.description.length - a.description.length)[0];
}

async function savePostingFor(tabId, appUrl) {
  const posting = await readPosting(tabId);
  if (!posting || !posting.description) return null;
  return JobScriptStorage.savePosting(Object.assign({}, posting, { url: appUrl || posting.url }));
}

async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab && tab.id;
}

// Only our own extension pages (popup, options, tailor) may send these commands. A content
// script's sender.url is the web page's address, so it can't pass; neither can another
// extension. Pages opened in a tab (options, tailor) must be showing an extension page there.
function isTrustedSender(sender, pagePath) {
  const ownPage = (url) => typeof url === 'string' && url.startsWith(chrome.runtime.getURL(pagePath));
  return sender.id === chrome.runtime.id && ownPage(sender.url) && (!sender.tab || ownPage(sender.tab.url));
}

// ---------------------------------------------------------------------------
// AI fallback. A content script may ask for answers only for a tab where you started a fill
// in the last few minutes, and only a few times per fill. The allowance lives in
// storage.session, which content scripts can't read or write.

// Every Claude call counts toward this month's spend, and none is made once the monthly cap
// (set on the options page) is reached.
JobScriptAI.setHooks({
  beforeCall: async () => {
    const [{ monthlyCap }, spend] = await Promise.all([JobScriptStorage.getAgentSettings(), JobScriptStorage.getAiSpend()]);
    if (monthlyCap > 0 && spend.cost >= monthlyCap) {
      return `You’ve reached this month’s Claude spending cap ($${monthlyCap.toFixed(2)}). Raise it on the options page to continue.`;
    }
    return '';
  },
  onUsage: (model, usage) => JobScriptStorage.addAiSpend(JobScriptAI.costOf(model, usage)),
});

const AI_ALLOWANCE_MS = 10 * 60 * 1000;
const AI_CALLS_PER_FILL = 3;
const ANTHROPIC_ORIGIN = 'https://api.anthropic.com/*';

async function grantAiAllowance(tabId) {
  await chrome.storage.session.set({ ['aiAllowance:' + tabId]: { expires: Date.now() + AI_ALLOWANCE_MS, remaining: AI_CALLS_PER_FILL } });
}

async function takeAiAllowance(tabId) {
  const key = 'aiAllowance:' + tabId;
  const a = (await chrome.storage.session.get(key))[key];
  if (!a || a.expires < Date.now() || a.remaining < 1) return false;
  await chrome.storage.session.set({ [key]: { expires: a.expires, remaining: a.remaining - 1 } });
  return true;
}

async function answerWithAi(msg, sender) {
  const settings = await JobScriptStorage.getAiSettings();
  if (!settings.enabled) return { ok: false, error: 'AI answers are turned off.' };
  const apiKey = await JobScriptStorage.getApiKey();
  if (!apiKey) return { ok: false, error: 'Add your Anthropic API key on the options page.' };
  if (!(await chrome.permissions.contains({ origins: [ANTHROPIC_ORIGIN] }))) {
    return { ok: false, error: 'Turn AI answers off and on again on the options page to grant access to Anthropic.' };
  }
  const request = JobScriptAI.sanitizeRequest(msg.request);
  if (!request) return { ok: false, error: 'No questions to answer.' };
  if (!(await takeAiAllowance(sender.tab.id))) return { ok: false, error: 'Click Fill this page again to ask Claude.' };
  const [profile, resumeText] = await Promise.all([JobScriptStorage.getProfile(), JobScriptStorage.getResumeText()]);
  return JobScriptAI.answerQuestions({ apiKey, model: settings.model, profile, resumeText, request });
}

// Resume import with Claude, requested from the options page when you click "Import with Claude".
// Needs a saved key and the api.anthropic.com permission, not the form-answers toggle.
async function parseResumeWithAi(msg) {
  const apiKey = await JobScriptStorage.getApiKey();
  if (!apiKey) return { ok: false, error: 'Add your Anthropic API key first.' };
  if (!(await chrome.permissions.contains({ origins: [ANTHROPIC_ORIGIN] }))) {
    return { ok: false, error: 'JobScript needs permission to reach api.anthropic.com.' };
  }
  const text = typeof msg.text === 'string' ? msg.text : '';
  // Contact details found on your device, to take out of the text before it's sent.
  const contact = {};
  for (const k of JobScriptAI.CONTACT_KEYS) if (msg.contact && typeof msg.contact[k] === 'string') contact[k] = msg.contact[k].slice(0, 300);
  const settings = await JobScriptStorage.getAiSettings();
  return JobScriptAI.parseResume({ apiKey, model: settings.model, text, contact });
}

// ---------------------------------------------------------------------------
// Tailor & Fill: scrape the posting, then open the review page in a new tab. The review page
// asks Claude for a tailored version, you approve it, and it comes back here to fill the tab.

// page: 'tailor' (Claude tailoring) or 'job' (job description + your own resume).
async function startTailor(tabId, page) {
  const target = page === 'job' ? 'job/job.html' : 'tailor/tailor.html';
  let posting;
  try {
    posting = await readPosting(tabId);
  } catch (err) {
    return { ok: false, error: 'JobScript cannot read this page.' };
  }
  if (!posting) return { ok: false, error: 'No job posting found on this page.' };
  JobScriptStorage.savePosting(posting).catch(() => {});
  const sid = crypto.randomUUID();
  await chrome.storage.session.set({ ['tailor:' + sid]: { tabId, posting, createdAt: Date.now() } });
  const tab = await chrome.tabs.get(tabId);
  await chrome.tabs.create({ url: chrome.runtime.getURL(target + '?sid=' + sid), index: tab.index + 1, openerTabId: tabId });
  return { ok: true };
}

async function tailorSession(sid) {
  const key = 'tailor:' + String(sid || '');
  return (await chrome.storage.session.get(key))[key] || null;
}

async function tailorWithAi(msg) {
  const session = await tailorSession(msg.sid);
  if (!session) return { ok: false, error: 'This tailoring session expired. Click Tailor & Fill again.' };
  const apiKey = await JobScriptStorage.getApiKey();
  if (!apiKey) return { ok: false, error: 'Add your Anthropic API key on the options page first.' };
  if (!(await chrome.permissions.contains({ origins: [ANTHROPIC_ORIGIN] }))) {
    return { ok: false, error: 'JobScript needs permission to reach api.anthropic.com.' };
  }
  const [settings, profile] = await Promise.all([JobScriptStorage.getAiSettings(), JobScriptStorage.getProfile()]);
  // The job breakdown (read once per job, with Haiku) steers the tailoring; the company profile,
  // if you've researched it, may shape the summary. Tailoring still works without either.
  const job = await ensureJobParse(session.posting.url, false, session.posting);
  const [company, locks] = await Promise.all([JobScriptStorage.getCompany(session.posting.company), JobScriptStorage.getTailorLocks()]);
  const res = await JobScriptAI.tailorResume({ apiKey, model: settings.model, profile, posting: session.posting, parsed: job.ok ? job.parsed : null, company, locks });
  if (res.ok && job.ok && job.cost) res.cost = (res.cost || 0) + job.cost;
  return res;
}

// The match score before and after tailoring, for the review screen: "before" is your master
// resume's score for this job (cached, or scored now), "after" scores the resume as it is on
// screen. Both with Haiku, against the same requirements.
async function tailorScore(msg) {
  const session = await tailorSession(msg.sid);
  if (!session) return { ok: false, error: 'This tailoring session expired.' };
  const resume = msg.resume && typeof msg.resume === 'object' ? msg.resume : null;
  if (!resume) return { ok: false, error: 'Nothing to score.' };
  const url = session.posting.url;
  const job = await ensureJobParse(url, false, session.posting);
  if (!job.ok) return job;
  const access = await aiAccess();
  if (!access.ok) return access;
  const profile = await JobScriptStorage.getProfile();
  const hash = resumeHash(profile);
  let cost = job.cost || 0;
  let before = await JobScriptStorage.getJobScore(url);
  if (!before || before.resumeHash !== hash) {
    const res = await JobScriptAI.scoreMatch({ apiKey: access.apiKey, profile, parsed: job.parsed, posting: session.posting });
    if (!res.ok) return res;
    cost += res.cost || 0;
    before = await JobScriptStorage.saveJobScore(url, { resumeHash: hash, score: res.score, reason: res.reason, items: res.items, model: res.model || '' });
  }
  const after = await JobScriptAI.scoreMatch({ apiKey: access.apiKey, profile, parsed: job.parsed, posting: session.posting, resume: JSON.parse(JSON.stringify(resume).slice(0, 60000)) });
  if (!after.ok) return after;
  cost += after.cost || 0;
  return { ok: true, before: before.score, beforeReason: before.reason, after: after.score, afterReason: after.reason, cost };
}

async function fillWithTailored(msg) {
  const session = await tailorSession(msg.sid);
  if (!session) return { ok: false, error: 'This tailoring session expired. Click Tailor & Fill again.' };
  const tailored = typeof msg.tailoredId === 'string' ? await JobScriptStorage.getTailored(msg.tailoredId) : null;
  if (!tailored) return { ok: false, error: 'Tailored resume not found.' };
  // From a job board (or a job page with no form): keep the resume with the job's tracker entry,
  // so it's attached when you fill the employer's application.
  const p = session.posting;
  const tab = await chrome.tabs.get(session.tabId).catch(() => null);
  if (!tab || JobScriptDetect.isReadOnlyBoard(tab.url || p.url) || msg.saveOnly) {
    await JobScriptStorage.saveJob({ url: p.url, company: p.company, title: p.title, site: p.site, jobId: p.jobId });
    await JobScriptStorage.updateApplication(p.url, { tailoredId: msg.tailoredId, tailoredFileName: tailored.name });
    return { ok: true, saved: true, name: tailored.name };
  }
  await chrome.tabs.update(tab.id, { active: true });
  return fillTab(tab.id, { tailoredId: msg.tailoredId, folder: typeof msg.folder === 'string' ? msg.folder : '' });
}

// ---------------------------------------------------------------------------
// Job and company research, for tailoring and cover letters. Requested from JobScript's own
// pages (company, letter, tailor), never from web pages.

async function aiAccess() {
  const apiKey = await JobScriptStorage.getApiKey();
  if (!apiKey) return { ok: false, error: 'Add your Anthropic API key on the options page first.' };
  if (!(await chrome.permissions.contains({ origins: [ANTHROPIC_ORIGIN] }))) {
    return { ok: false, error: 'JobScript needs permission to reach api.anthropic.com.', needsPermission: true };
  }
  return { ok: true, apiKey, settings: await JobScriptStorage.getAiSettings() };
}

// The parsed job description for an application, from the cache unless refresh is set.
// fallback: a posting to save first if none is saved yet (Tailor & Fill has it in its session).
async function ensureJobParse(url, refresh, fallback) {
  let posting = await JobScriptStorage.getPosting(url);
  if (!posting && fallback) posting = await JobScriptStorage.savePosting(fallback);
  if (!posting) return { ok: false, error: 'No job description is saved for this application yet. Fill the application page first.' };
  const cached = !refresh && (await JobScriptStorage.getJobParse(url));
  if (cached) return { ok: true, parsed: cached, posting, cached: true };
  const access = await aiAccess();
  if (!access.ok) return access;
  const res = await JobScriptAI.parseJob({ apiKey: access.apiKey, posting });
  if (!res.ok) return res;
  const parsed = await JobScriptStorage.saveJobParse(url, Object.assign(res.parsed, { model: res.model }));
  return { ok: true, parsed, posting, cached: false, cost: res.cost };
}

function siteOrigins(domain) {
  const host = String(domain || '').toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) ? [`https://${host}/*`, `https://www.${host}/*`] : null;
}

// Research a company in the chosen mode and merge it into its saved profile: researched items
// are replaced section by section where the new run found some, and your own additions and
// edits are always kept.
async function researchCompany(msg) {
  const name = String(msg.name || '').trim().slice(0, 200);
  if (!name) return { ok: false, error: 'Enter the company name first.' };
  const mode = msg.mode === 'search' ? 'search' : 'website';
  const domain = String(msg.domain || '').trim().slice(0, 200);
  const access = await aiAccess();
  if (!access.ok) return access;

  let res;
  let pagesRead = [];
  if (mode === 'website') {
    const origins = siteOrigins(domain);
    if (!origins) return { ok: false, error: 'Enter the company’s website, like example.com.' };
    if (!(await chrome.permissions.contains({ origins: [origins[0]] }))) {
      return { ok: false, error: `Allow JobScript to read ${domain} first.`, needsSitePermission: true };
    }
    try {
      const pages = await JobScriptResearch.fetchCompanyPages(domain);
      pagesRead = pages.map((p) => p.url);
      res = await JobScriptAI.summarizeCompanyPages({ apiKey: access.apiKey, company: name, domain, pages });
    } finally {
      // Access was only for this research. Keep it if you also taught JobScript this site.
      const learned = (await chrome.scripting.getRegisteredContentScripts()).some((s) => origins.some((o) => s.matches.includes(o)));
      if (!learned) await chrome.permissions.remove({ origins }).catch(() => {});
    }
  } else {
    res = await JobScriptAI.researchCompanyWeb({ apiKey: access.apiKey, company: name, domain });
  }
  if (!res.ok) return res;

  const existing = (await JobScriptStorage.getCompany(name)) || JobScriptStorage.blankCompany(name);
  const merged = Object.assign({}, existing, { name, domain: domain || existing.domain, mode, updatedAt: new Date().toISOString() });
  for (const sec of JobScriptStorage.COMPANY_SECTIONS) {
    // A section this run found nothing for keeps what earlier research found.
    const researched = res.items[sec].length ? res.items[sec] : existing[sec].filter((it) => !it.byYou);
    merged[sec] = [...existing[sec].filter((it) => it.byYou), ...researched];
  }
  const profile = await JobScriptStorage.saveCompany(merged);
  return { ok: true, profile, dropped: res.dropped, cost: res.cost, searches: res.searches || 0, pagesRead };
}

// A cover letter for an application: parses the job if needed, uses the saved company profile
// (empty if you haven't researched the company), and flags anything that doesn't trace back.
async function writeLetter(msg) {
  const url = String(msg.url || '');
  const job = await ensureJobParse(url, false);
  if (!job.ok) return job;
  const access = await aiAccess();
  if (!access.ok) return access;
  const [profile, settings] = await Promise.all([JobScriptStorage.getProfile(), JobScriptStorage.getResearchSettings()]);
  const company = (await JobScriptStorage.getCompany(job.posting.company)) || JobScriptStorage.blankCompany(job.posting.company);
  const tone = JobScriptStorage.LETTER_TONES.includes(msg.tone) ? msg.tone : settings.tone;
  const length = JobScriptStorage.LETTER_LENGTHS.includes(msg.length) ? msg.length : settings.length;
  const res = await JobScriptAI.writeCoverLetter({ apiKey: access.apiKey, model: access.settings.model, profile, posting: job.posting, parsed: job.parsed, company, tone, length });
  if (!res.ok) return res;
  const text = [res.letter.greeting, ...res.letter.paragraphs].join('\n\n');
  const flags = JobScriptLetterCheck.check(text, {
    profile, company, companyName: job.posting.company, role: job.posting.title,
    jobText: [job.posting.description, JSON.stringify(job.parsed)].join('\n'),
  });
  return { ok: true, text, letter: res.letter, flags, model: res.model, cost: (res.cost || 0) + (job.cost || 0), tone, length, companyResearched: !!company.updatedAt || JobScriptStorage.COMPANY_SECTIONS.some((s) => company[s].length) };
}

// From the side panel: open the cover letter page or the company profile for this tab's job.
// The posting is saved first, so both pages have it even before a fill.
async function openResearchPage(sender, page) {
  const tab = sender.tab;
  let posting = null;
  try {
    posting = await savePostingFor(tab.id, tab.url);
  } catch (e) {
    /* the page may still open with what's saved */
  }
  posting = posting || (await JobScriptStorage.getPosting(tab.url));
  if (!posting) return { ok: false, error: 'No job posting found on this page.' };
  const target = page === 'company'
    ? `company/company.html?name=${encodeURIComponent(posting.company || '')}&domain=${encodeURIComponent(posting.companyDomain || '')}`
    : `letter/letter.html?url=${encodeURIComponent(tab.url)}&tab=${tab.id}`;
  await chrome.tabs.create({ url: chrome.runtime.getURL(target), index: tab.index + 1, openerTabId: tab.id });
  return { ok: true };
}

// "Add to application" on the cover letter page: the application's tab (the one the page was
// opened from, if it's still on that application) gets the letter in its cover letter field.
async function letterIntoTab(msg) {
  const key = JobScriptStorage.applicationKey(String(msg.url || ''));
  let tab = null;
  if (Number.isInteger(msg.tabId)) tab = await chrome.tabs.get(msg.tabId).catch(() => null);
  if (!tab || JobScriptStorage.applicationKey(tab.url || '') !== key) {
    const tabs = await chrome.tabs.query({});
    tab = tabs.find((t) => JobScriptStorage.applicationKey(t.url || '') === key) || null;
  }
  if (!tab) return { ok: false, error: 'Open the application page first, then try again.' };
  let frames;
  try {
    frames = await callWithInjection(tab.id, '__jobscriptCoverLetter');
  } catch (e) {
    return { ok: false, error: 'JobScript cannot run on the application page.' };
  }
  const done = frames.filter((f) => f && f.ok);
  if (!done.length) return { ok: false, error: 'This application has no cover letter field on the current page.' };
  await chrome.tabs.update(tab.id, { active: true });
  return { ok: true, attached: done.reduce((n, f) => n + f.attached, 0), pasted: done.reduce((n, f) => n + f.pasted, 0) };
}

// A question the keyword rules couldn't classify, asked by the content script when you answer
// it. Only with AI answers turned on; each wording is asked about once (cached in storage).
async function classifyQuestion(msg) {
  const wording = String(msg.wording || '').trim().slice(0, 500);
  if (!wording) return { ok: false, error: 'No question.' };
  const cached = await JobScriptStorage.getQuestionClass(wording);
  if (cached) return { ok: true, type: cached.type, key: cached.key, cached: true };
  const settings = await JobScriptStorage.getAiSettings();
  if (!settings.enabled) return { ok: false, error: 'AI answers are off.' };
  const access = await aiAccess();
  if (!access.ok) return access;
  const canonical = JobScriptCanonical.QUESTIONS.map((q) => ({ key: q.key, label: q.label, type: q.type }));
  const options = Array.isArray(msg.options) ? msg.options.map(String) : [];
  const res = await JobScriptAI.classifyQuestion({ apiKey: access.apiKey, wording, options, canonical });
  if (!res.ok) return res;
  // A generic or changing question outside the built-in list gets its own canonical key.
  const key = res.type === 'job' ? '' : res.key || JobScriptCanonical.customKey(res.label || wording);
  await JobScriptStorage.saveQuestionClass(wording, { type: res.type, key, by: 'claude' });
  return { ok: true, type: res.type, key, label: res.label, cost: res.cost };
}

// ---------------------------------------------------------------------------
// Confirmation pages: when a tab where JobScript filled an application in the last few hours
// shows "Thank you for applying" (or the site's confirmation address), that application is
// marked Applied. Only that tab's own fill counts, so a page can't mark anything else.

const CONFIRM_WINDOW_MS = 3 * 60 * 60 * 1000;

async function applicationConfirmed(sender) {
  const key = 'filled:' + sender.tab.id;
  const rec = (await chrome.storage.session.get(key))[key];
  if (!rec || Date.now() - rec.at > CONFIRM_WINDOW_MS) return { ok: false };
  const app = (await JobScriptStorage.getApplications()).find((a) => a.id === rec.appId);
  await chrome.storage.session.remove(key);
  if (!app) return { ok: false };
  const was = app.status;
  if (JobScriptStorage.NOT_APPLIED.has(was)) await JobScriptStorage.setApplicationStatus(app.id, 'Applied');
  return { ok: true, marked: JobScriptStorage.NOT_APPLIED.has(was), status: JobScriptStorage.NOT_APPLIED.has(was) ? 'Applied' : was, title: app.title, company: app.company };
}

chrome.tabs.onRemoved.addListener((tabId) => chrome.storage.session.remove('filled:' + tabId).catch(() => {}));

// ---------------------------------------------------------------------------
// The Job tab (content/jobtab.js): the posting on the page you're viewing, its match score and
// eligibility, and buttons to save, tailor, write a letter or apply. Pages only send what they
// read; everything about you is looked up here.

function httpUrl(v) {
  try {
    const u = new URL(String(v || ''));
    return /^https?:$/.test(u.protocol) ? u.href : '';
  } catch (e) {
    return '';
  }
}

// What a page sent as its posting, trimmed to known fields.
function cleanPosting(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const str = (v, n) => String(v || '').slice(0, n);
  const url = httpUrl(r.url);
  if (!url || !str(r.title, 300).trim()) return null;
  return {
    url,
    title: str(r.title, 300),
    company: str(r.company, 200),
    location: str(r.location, 200),
    pay: str(r.pay, 120),
    jobId: str(r.jobId, 80),
    description: str(r.description, 30000),
    applyUrl: httpUrl(r.applyUrl),
    applyHere: r.applyHere === true,
    site: str(r.site, 100),
    readOnly: JobScriptDetect.isReadOnlyBoard(url),
  };
}

// A short fingerprint of your master resume, so a score made from an older version shows as stale.
function resumeHash(profile) {
  const text = JSON.stringify(JobScriptAI.masterForAi(profile));
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(36);
}

async function aiReady() {
  const [key, granted] = await Promise.all([JobScriptStorage.getApiKey(), chrome.permissions.contains({ origins: [ANTHROPIC_ORIGIN] })]);
  return !!key && granted;
}

function scoreView(record, hash) {
  if (!record) return null;
  return { score: record.score, reason: record.reason, items: record.items || [], stale: record.resumeHash !== hash, scoredAt: record.scoredAt };
}

// The posting was found on a page: save it, and say what JobScript already knows about it.
async function jobDetected(msg) {
  const posting = cleanPosting(msg.posting);
  if (!posting) return { ok: false, error: 'No job posting.' };
  await JobScriptStorage.savePosting(posting);
  const [profile, parsed, score, dup, letter, ready] = await Promise.all([
    JobScriptStorage.getProfile(),
    JobScriptStorage.getJobParse(posting.url),
    JobScriptStorage.getJobScore(posting.url),
    JobScriptStorage.findDuplicate(posting),
    JobScriptStorage.getLetter(posting.url),
    aiReady(),
  ]);
  const view = { ok: true, aiReady: ready, duplicate: dupView(dup), hasLetter: !!(letter && letter.text), school: firstSchool(profile) };
  if (parsed && parsed.eligibility) Object.assign(view, analysisView(profile, parsed, scoreView(score, resumeHash(profile))));
  return view;
}

function firstSchool(profile) {
  const e = (profile.education || []).find((x) => x.school);
  return e ? e.school : '';
}

function dupView(dup) {
  if (!dup) return null;
  const a = dup.app;
  return { by: dup.by, status: a.status, title: a.title, company: a.company, appliedAt: a.appliedAt || '', createdAt: a.createdAt, url: a.url, tailoredFileName: a.tailoredFileName || '' };
}

// Score, matching skills, missing keywords and eligibility warnings, from the breakdown.
function analysisView(profile, parsed, score) {
  const coverage = JobScriptAI.keywordCoverage(profile, parsed);
  const metSkills = (score ? score.items : []).filter((i) => i.status === 'met' && i.text.length <= 40).map((i) => i.text);
  const matching = [...new Set([...coverage.found, ...metSkills])].slice(0, 20);
  return {
    analyzed: true,
    roleSummary: parsed.roleSummary,
    seniority: parsed.seniority,
    matching,
    missing: coverage.missing.slice(0, 20),
    warnings: JobScriptEligibility.check(parsed.eligibility, profile),
    score,
  };
}

// Parses the job (cached per job) and scores it against your master resume (cached per job and
// resume version), with Haiku. refresh: score again even if a current score is cached.
async function jobAnalyze(msg) {
  const url = httpUrl(msg.url);
  if (!url) return { ok: false, error: 'No job.' };
  const posting = await JobScriptStorage.getPosting(url);
  if (!posting) return { ok: false, error: 'Open the job page again so JobScript can read it.' };
  // Breakdowns saved before eligibility was read are read again, once.
  const cachedParse = await JobScriptStorage.getJobParse(url);
  const job = await ensureJobParse(url, !!msg.refreshParse || !!(cachedParse && !cachedParse.eligibility), posting);
  if (!job.ok) return job;
  const profile = await JobScriptStorage.getProfile();
  const hash = resumeHash(profile);
  let cost = job.cost || 0;
  let record = await JobScriptStorage.getJobScore(url);
  if (!record || record.resumeHash !== hash || msg.refresh) {
    const access = await aiAccess();
    if (!access.ok) return access;
    const res = await JobScriptAI.scoreMatch({ apiKey: access.apiKey, profile, parsed: job.parsed, posting });
    if (!res.ok) return res;
    cost += res.cost || 0;
    record = await JobScriptStorage.saveJobScore(url, { resumeHash: hash, score: res.score, reason: res.reason, items: res.items, model: res.model || '' });
  }
  // Keep the score with the tracker entry, if the job is in your tracker.
  if (Number.isFinite(record.score)) {
    await JobScriptStorage.updateApplication(url, { score: record.score, scoreReason: String(record.reason || '').slice(0, 300) });
  }
  return Object.assign({ ok: true, cost, month: await monthText() }, analysisView(profile, job.parsed, scoreView(record, hash)));
}

async function jobSave(msg) {
  const url = httpUrl(msg.url);
  const posting = url && (await JobScriptStorage.getPosting(url));
  if (!posting) return { ok: false, error: 'Open the job page again so JobScript can read it.' };
  const score = await JobScriptStorage.getJobScore(url);
  const { app, created } = await JobScriptStorage.saveJob({
    url, company: posting.company, title: posting.title, site: posting.site, jobId: posting.jobId,
    extra: { score: score ? score.score : undefined, scoreReason: score ? score.reason : '', location: posting.location, pay: posting.pay },
  });
  return { ok: true, created, status: app.status };
}

// Tailor, cover letter, company profile or job description pages for the job on this tab, from
// the posting saved when the page was read (no need to read the tab again).
async function jobOpen(msg, sender) {
  const url = httpUrl(msg.url);
  const posting = url && (await JobScriptStorage.getPosting(url));
  if (!posting) return { ok: false, error: 'Open the job page again so JobScript can read it.' };
  const tab = sender.tab;
  if (msg.page === 'tailor' || msg.page === 'job') {
    const sid = crypto.randomUUID();
    await chrome.storage.session.set({ ['tailor:' + sid]: { tabId: tab.id, posting, createdAt: Date.now() } });
    const target = msg.page === 'job' ? 'job/job.html' : 'tailor/tailor.html';
    await chrome.tabs.create({ url: chrome.runtime.getURL(target + '?sid=' + sid), index: tab.index + 1, openerTabId: tab.id });
    return { ok: true };
  }
  const target = msg.page === 'company'
    ? `company/company.html?name=${encodeURIComponent(posting.company || '')}&domain=${encodeURIComponent(posting.companyDomain || '')}`
    : msg.page === 'tracker' ? 'tracker/tracker.html'
      : `letter/letter.html?url=${encodeURIComponent(url)}&tab=${tab.id}`;
  await chrome.tabs.create({ url: chrome.runtime.getURL(target), index: tab.index + 1, openerTabId: tab.id });
  return { ok: true };
}

// A resume you dropped on the Job tab: kept with this job's tracker entry, so a fill of its
// application attaches it (on Handshake, through your Handshake documents).
async function jobResume(msg) {
  const url = httpUrl(msg.url);
  const posting = url && (await JobScriptStorage.getPosting(url));
  if (!posting) return { ok: false, error: 'Open the job page again so JobScript can read it.' };
  let record;
  try {
    record = JobScriptStorage.sanitizeResume({ name: String(msg.name || ''), data: msg.data, savedAt: new Date().toISOString() });
  } catch (e) {
    return { ok: false, error: e.message };
  }
  const id = String(Date.now()) + Math.random().toString(36).slice(2, 7);
  await JobScriptStorage.saveTailored(id, {
    ...record, createdAt: new Date().toISOString(), company: posting.company, title: posting.title, url: posting.url, uploaded: true,
  });
  await JobScriptStorage.saveJob({ url: posting.url, company: posting.company, title: posting.title, site: posting.site, jobId: posting.jobId });
  await JobScriptStorage.updateApplication(posting.url, { tailoredId: id, tailoredFileName: record.name });
  return { ok: true, tailoredId: id, name: record.name };
}

// "Remove" on the notice after JobScript kept a resume you uploaded: forget it, and unlink it
// from the job if it's still the one linked there.
async function jobResumeRemove(msg) {
  const id = typeof msg.tailoredId === 'string' ? msg.tailoredId : '';
  if (!id || !(await JobScriptStorage.getTailored(id))) return { ok: false, error: 'Already removed.' };
  await chrome.storage.local.remove('tailored:' + id);
  const url = httpUrl(msg.url);
  const dup = url && (await JobScriptStorage.findDuplicate({ url, jobId: JobScriptStorage.jobIdFromUrl(url) }));
  if (dup && dup.app.tailoredId === id) await JobScriptStorage.updateApplication(dup.app.url, { tailoredId: '', tailoredFileName: '' });
  return { ok: true };
}

// Apply: opens the application's address (read from the posting) in a new tab beside this one.
// Never one on LinkedIn, Indeed or Glassdoor: there you press their Apply button yourself.
async function jobApply(msg, sender) {
  const url = httpUrl(msg.url);
  const posting = url && (await JobScriptStorage.getPosting(url));
  const target = posting && httpUrl(posting.applyUrl);
  if (!target) return { ok: false, error: 'No application link on this page.' };
  if (JobScriptDetect.isReadOnlyBoard(target)) return { ok: false, error: 'That link stays on the job board; use its Apply button yourself.' };
  await chrome.tabs.create({ url: target, index: sender.tab.index + 1, openerTabId: sender.tab.id });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Agent mode (lib/agent.js runs the loop; content/agent.js runs the tools and enforces the rules).
// A run belongs to one frame of one tab, started from the panel there, and is locked to that
// frame's site: if the frame or the tab leaves it, or the tab closes, the run stops.

const agentRuns = new Map(); // tabId -> { runId, frameId, host, tabHost, controller, stopReason }

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch (e) {
    return '';
  }
}

function stopAgent(tabId, reason) {
  const run = agentRuns.get(tabId);
  if (!run) return;
  if (!run.stopReason) run.stopReason = reason;
  run.controller.abort();
}

function sendToRun(tabId, run, message) {
  return chrome.tabs.sendMessage(tabId, Object.assign({ runId: run.runId }, message), { frameId: run.frameId });
}

async function monthText() {
  const [{ monthlyCap }, spend] = await Promise.all([JobScriptStorage.getAgentSettings(), JobScriptStorage.getAiSpend()]);
  return monthlyCap > 0 ? `This month: $${spend.cost.toFixed(2)} of your $${monthlyCap.toFixed(2)} cap.` : `This month: $${spend.cost.toFixed(2)}.`;
}

async function startAgent(msg, sender) {
  const tabId = sender.tab.id;
  if (JobScriptDetect.isReadOnlyBoard(sender.tab.url || '')) return { ok: false, error: READ_ONLY_ERROR };
  if (typeof msg.runId !== 'string' || !msg.runId) return { ok: false, error: 'Bad request.' };
  if (agentRuns.has(tabId)) return { ok: false, error: 'The agent is already running in this tab.' };
  const aiSettings = await JobScriptStorage.getAiSettings();
  if (!aiSettings.enabled) return { ok: false, error: 'Turn on AI features on the options page first.' };
  const access = await aiAccess();
  if (!access.ok) return access;
  const host = hostOf(sender.url);
  const tabHost = hostOf(sender.tab.url);
  if (!host) return { ok: false, error: 'The agent can’t run on this page.' };
  const [settings, profile, canonAnswers, saved] = await Promise.all([
    JobScriptStorage.getAgentSettings(),
    JobScriptStorage.getProfile(),
    JobScriptStorage.getCanonAnswers(),
    JobScriptStorage.getPosting(sender.tab.url),
  ]);
  const spend = await JobScriptStorage.getAiSpend();
  if (settings.monthlyCap > 0 && spend.cost >= settings.monthlyCap) {
    return { ok: false, error: `You’ve reached this month’s Claude spending cap ($${settings.monthlyCap.toFixed(2)}). Raise it on the options page to continue.` };
  }
  const page = msg.job && typeof msg.job === 'object' ? msg.job : {};
  const job = saved && saved.description
    ? { title: saved.title, company: saved.company, description: saved.description }
    : { title: String(page.jobTitle || ''), company: String(page.company || ''), description: String(page.jobDescription || '') };

  const run = { runId: msg.runId, frameId: sender.frameId || 0, host, tabHost, controller: new AbortController(), stopReason: '' };
  agentRuns.set(tabId, run);
  const notify = (e) => sendToRun(tabId, run, Object.assign({ type: 'agent-event' }, e)).catch(() => {});

  const execute = async (name, input) => {
    if (name === 'screenshot') return settings.screenshots ? screenshotTab(tabId) : { text: 'Screenshots are turned off.', isError: true };
    let res;
    try {
      res = await sendToRun(tabId, run, { type: 'agent-tool', name, input });
    } catch (e) {
      return { text: 'The page stopped responding.', isError: true, stop: 'The page reloaded or closed, so the agent stopped. Run it again on the new page.' };
    }
    if (!res) return { text: 'The page stopped responding.', isError: true, stop: 'The page stopped responding, so the agent stopped.' };
    if (res.stopped) return Object.assign({}, res, { stop: 'Stopped by you.' });
    if (res.url && hostOf(res.url) !== host) {
      return { text: 'The page left the site.', isError: true, stop: `The page left ${host}, so the agent stopped.` };
    }
    return res;
  };

  JobScriptAgent.run({
    apiKey: access.apiKey,
    model: settings.model,
    signal: run.controller.signal,
    profile,
    canonAnswers,
    canonical: JobScriptCanonical.QUESTIONS.map((q) => ({ key: q.key, label: q.label })),
    job,
    snapshot: String(msg.snapshot || '').slice(0, 60000),
    screenshots: settings.screenshots,
    execute,
    onEvent: notify,
  })
    .catch(() => ({ ok: false, error: 'Something went wrong in the agent.', usageText: '' }))
    .then(async (res) => {
      agentRuns.delete(tabId);
      const text = res.ok
        ? 'Done. ' + (res.summary || 'Check the form before you submit.')
        : run.stopReason || res.error || 'The agent stopped.';
      const usage = [res.usageText, await monthText()].filter(Boolean).join(' · ');
      await notify({ usage, end: text, isError: !res.ok && !res.stopped && !run.stopReason.startsWith('Stopped by you') });
    });

  return { ok: true, model: (JobScriptStorage.AGENT_MODELS.find((m) => m.id === settings.model) || {}).label || settings.model };
}

// A screenshot of the visible part of the tab, for pages whose snapshot is clearly missing
// something. Captured only while the tab is in front; scaled down to keep it cheap.
const SCREENSHOT_MAX_WIDTH = 1280;

async function screenshotTab(tabId) {
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch (e) {
    return { text: 'The tab is gone.', isError: true };
  }
  if (!tab.active) return { text: 'The tab isn’t in front, so no screenshot was taken. Work from the snapshot.', isError: true };
  let dataUrl;
  try {
    dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 60 });
  } catch (e) {
    return { text: 'JobScript isn’t allowed to take screenshots of this page. Work from the snapshot.', isError: true };
  }
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const bitmap = await createImageBitmap(blob);
    if (bitmap.width > SCREENSHOT_MAX_WIDTH) {
      const scale = SCREENSHOT_MAX_WIDTH / bitmap.width;
      const canvas = new OffscreenCanvas(SCREENSHOT_MAX_WIDTH, Math.round(bitmap.height * scale));
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const small = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.6 });
      const bytes = new Uint8Array(await small.arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      return { image: btoa(bin), mediaType: 'image/jpeg' };
    }
  } catch (e) {
    /* send it at full size */
  }
  return { image: dataUrl.slice(dataUrl.indexOf(',') + 1), mediaType: 'image/jpeg' };
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  const run = agentRuns.get(tabId);
  if (run && changeInfo.url && hostOf(changeInfo.url) !== run.tabHost) stopAgent(tabId, `The tab left ${run.tabHost}, so the agent stopped.`);
});
chrome.tabs.onRemoved.addListener((tabId) => stopAgent(tabId, 'The tab was closed.'));

// ---------------------------------------------------------------------------
// Learn mode. On a site you let JobScript run on (an optional permission for just that site,
// asked for from the popup), the content script is registered to load with every page, so the
// panel can follow a multi-step form even when each step loads a new page.

function siteScriptId(origin) {
  return 'site:' + origin;
}

// Whether a manifest match pattern such as "https://*.icims.com/*" covers an origin.
function patternCovers(pattern, origin) {
  const m = /^(\w+):\/\/(\*\.)?([^/*]+)\/\*$/.exec(pattern);
  if (!m) return false;
  const u = new URL(origin);
  if (u.protocol !== m[1] + ':') return false;
  return m[2] ? u.hostname === m[3] || u.hostname.endsWith('.' + m[3]) : u.hostname === m[3];
}

// The job sites in the manifest (Greenhouse, Lever, Workday, ...) already get the content script.
function hasBuiltInScript(origin) {
  return chrome.runtime.getManifest().content_scripts.some((cs) => cs.matches.some((p) => patternCovers(p, origin)));
}

async function registerSiteScript(origin) {
  if (hasBuiltInScript(origin)) return;
  const id = siteScriptId(origin);
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
  if (existing.length) return;
  await chrome.scripting.registerContentScripts([
    { id, matches: [origin + '/*'], js: CONTENT_FILES, css: CONTENT_CSS, runAt: 'document_idle' },
  ]);
}

async function unregisterSiteScript(origin) {
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [siteScriptId(origin)] });
  } catch (e) {
    /* wasn't registered */
  }
}

// Re-register after an update or restart: learned sites whose permission you still grant.
async function syncSiteScripts() {
  const sites = await JobScriptStorage.getAllSiteAnswers();
  for (const [origin, site] of Object.entries(sites)) {
    if (!site.learning && !(site.steps && site.steps.length)) continue;
    if (await chrome.permissions.contains({ origins: [origin + '/*'] })) await registerSiteScript(origin).catch(() => {});
  }
}

async function learnTab(tabId) {
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch (e) {
    return { ok: false, error: 'No active tab.' };
  }
  let origin;
  try {
    origin = new URL(tab.url).origin;
  } catch (e) {
    return { ok: false, error: 'JobScript cannot run on this page.' };
  }
  if (!/^https?:/.test(origin)) return { ok: false, error: 'JobScript cannot run on this page.' };
  const persistent = await chrome.permissions.contains({ origins: [origin + '/*'] });
  if (persistent) await registerSiteScript(origin).catch(() => {});
  const res = await fillTab(tabId, { learn: true });
  return Object.assign({}, res, { persistent });
}

chrome.permissions.onRemoved.addListener(({ origins }) => {
  for (const pattern of origins || []) {
    const m = /^(https?:\/\/[^/]+)\/\*$/.exec(pattern);
    if (m) unregisterSiteScript(m[1]);
  }
});

// "Find job postings on every site": the Job tab's read-only scripts on every https page the
// manifest doesn't already cover, while the setting is on and access to all sites is granted.
const ANY_SITE_ID = 'jobs:any-site';
const ALL_SITES = 'https://*/*';

async function syncAnySiteScript() {
  const [{ anySite }, granted, existing] = await Promise.all([
    JobScriptStorage.getPanelSettings(),
    chrome.permissions.contains({ origins: [ALL_SITES] }),
    chrome.scripting.getRegisteredContentScripts({ ids: [ANY_SITE_ID] }),
  ]);
  const want = anySite && granted;
  if (want && !existing.length) {
    const builtIn = chrome.runtime.getManifest().content_scripts.flatMap((cs) => cs.matches);
    await chrome.scripting.registerContentScripts([{ id: ANY_SITE_ID, matches: [ALL_SITES], excludeMatches: builtIn, js: JOB_FILES, runAt: 'document_idle', allFrames: false }]);
  } else if (!want && existing.length) {
    await chrome.scripting.unregisterContentScripts({ ids: [ANY_SITE_ID] });
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.panelSettings) syncAnySiteScript().catch(() => {});
});
if (chrome.permissions.onAdded) chrome.permissions.onAdded.addListener(() => syncAnySiteScript().catch(() => {}));
chrome.permissions.onRemoved.addListener(() => syncAnySiteScript().catch(() => {}));

chrome.runtime.onInstalled.addListener(() => {
  syncSiteScripts();
  syncAnySiteScript().catch(() => {});
});
chrome.runtime.onStartup.addListener(() => {
  syncSiteScripts();
  syncAnySiteScript().catch(() => {});
});

// Messages from our own content scripts carry sender.tab; page scripts can't send these at all.
function isOwnContentScript(sender) {
  return sender.id === chrome.runtime.id && !!sender.tab && Number.isInteger(sender.tab.id) && typeof sender.url === 'string';
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
  if (msg.type === 'learn-tab') {
    if (!isTrustedSender(sender, 'popup/') || !Number.isInteger(msg.tabId)) return false;
    learnTab(msg.tabId).then(sendResponse, () => sendResponse({ ok: false, error: 'Could not start learning.' }));
    return true;
  }
  if (msg.type === 'tailor-tab' || msg.type === 'job-tab') {
    if (!isTrustedSender(sender, 'popup/') || !Number.isInteger(msg.tabId)) return false;
    startTailor(msg.tabId, msg.type === 'job-tab' ? 'job' : 'tailor').then(sendResponse);
    return true;
  }
  // The side panel's own buttons, so everything in the popup can also be done from the page.
  if (msg.type === 'fill-self') {
    if (!isOwnContentScript(sender)) return false;
    fillTab(sender.tab.id).then(sendResponse, () => sendResponse({ ok: false, error: 'Could not fill this page.' }));
    return true;
  }
  if (msg.type === 'classify-question') {
    if (!isOwnContentScript(sender)) return false;
    classifyQuestion(msg).then(sendResponse, () => sendResponse({ ok: false, error: 'Could not classify the question.' }));
    return true;
  }
  if (msg.type === 'letter-open' || msg.type === 'company-open') {
    if (!isOwnContentScript(sender)) return false;
    openResearchPage(sender, msg.type === 'company-open' ? 'company' : 'letter').then(sendResponse, () => sendResponse({ ok: false, error: 'Could not open that page.' }));
    return true;
  }
  if (msg.type === 'open-tracker') {
    if (!isOwnContentScript(sender)) return false;
    chrome.tabs.create({ url: chrome.runtime.getURL('tracker/tracker.html'), index: sender.tab.index + 1 }).then(
      () => sendResponse({ ok: true }),
      () => sendResponse({ ok: false, error: 'Could not open the tracker.' })
    );
    return true;
  }
  if (msg.type === 'tailor-start' || msg.type === 'job-start') {
    if (!isOwnContentScript(sender)) return false;
    startTailor(sender.tab.id, msg.type === 'job-start' ? 'job' : 'tailor').then(sendResponse);
    return true;
  }
  if (msg.type === 'ai-tailor') {
    if (!isTrustedSender(sender, 'tailor/')) return false;
    tailorWithAi(msg).then(sendResponse, () => sendResponse({ ok: false, error: 'Something went wrong asking Claude.' }));
    return true;
  }
  if (msg.type === 'tailor-score') {
    if (!isTrustedSender(sender, 'tailor/')) return false;
    tailorScore(msg).then(sendResponse, () => sendResponse({ ok: false, error: 'Could not score the resume.' }));
    return true;
  }
  if (msg.type === 'tailor-lock') {
    if (!isTrustedSender(sender, 'tailor/') || typeof msg.text !== 'string') return false;
    JobScriptStorage.setTailorLock(msg.text, msg.locked === true).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === 'tailor-fill') {
    if (!isTrustedSender(sender, 'tailor/') && !isTrustedSender(sender, 'job/')) return false;
    fillWithTailored(msg).then(sendResponse, () => sendResponse({ ok: false, error: 'Could not fill the application.' }));
    return true;
  }
  if (msg.type === 'ai-parse-resume') {
    if (!isTrustedSender(sender, 'options/')) return false;
    parseResumeWithAi(msg).then(sendResponse, () => sendResponse({ ok: false, error: 'Something went wrong asking Claude.' }));
    return true;
  }
  if (msg.type === 'job-parse') {
    if (!['company/', 'letter/', 'tailor/'].some((p) => isTrustedSender(sender, p)) || typeof msg.url !== 'string') return false;
    ensureJobParse(msg.url, !!msg.refresh).then(sendResponse, () => sendResponse({ ok: false, error: 'Could not read the job description.' }));
    return true;
  }
  if (msg.type === 'letter-write') {
    if (!isTrustedSender(sender, 'letter/') || typeof msg.url !== 'string') return false;
    writeLetter(msg).then(sendResponse, () => sendResponse({ ok: false, error: 'Could not write the cover letter.' }));
    return true;
  }
  if (msg.type === 'letter-fill') {
    if (!isTrustedSender(sender, 'letter/') || typeof msg.url !== 'string') return false;
    letterIntoTab(msg).then(sendResponse, () => sendResponse({ ok: false, error: 'Could not add the letter to the application.' }));
    return true;
  }
  if (msg.type === 'company-research') {
    if (!isTrustedSender(sender, 'company/')) return false;
    researchCompany(msg).then(sendResponse, () => sendResponse({ ok: false, error: 'Company research failed.' }));
    return true;
  }
  if (msg.type === 'research-estimate') {
    if (!isTrustedSender(sender, 'company/')) return false;
    sendResponse({ ok: true, estimate: JobScriptAI.estimateWebSearchCost() });
    return false;
  }
  if (['job-detected', 'job-analyze', 'job-save', 'job-open', 'job-apply', 'job-resume', 'job-resume-remove'].includes(msg.type)) {
    if (!isOwnContentScript(sender)) return false;
    const handler = { 'job-detected': jobDetected, 'job-analyze': jobAnalyze, 'job-save': jobSave, 'job-open': jobOpen, 'job-apply': jobApply, 'job-resume': jobResume, 'job-resume-remove': jobResumeRemove }[msg.type];
    handler(msg, sender).then(sendResponse, () => sendResponse({ ok: false, error: 'Something went wrong in JobScript.' }));
    return true;
  }
  if (msg.type === 'application-confirmed') {
    if (!isOwnContentScript(sender)) return false;
    applicationConfirmed(sender).then(sendResponse, () => sendResponse({ ok: false }));
    return true;
  }
  if (msg.type === 'open-options') {
    if (!isOwnContentScript(sender)) return false;
    chrome.runtime.openOptionsPage().then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false, error: 'Could not open the options page.' }));
    return true;
  }
  if (msg.type === 'agent-start') {
    if (!isOwnContentScript(sender)) return false;
    startAgent(msg, sender).then(sendResponse, () => sendResponse({ ok: false, error: 'The agent couldn’t start.' }));
    return true;
  }
  if (msg.type === 'agent-stop') {
    if (!isOwnContentScript(sender)) return false;
    const run = agentRuns.get(sender.tab.id);
    if (run && run.runId === msg.runId) stopAgent(sender.tab.id, 'Stopped by you.');
    sendResponse({ ok: true });
    return false;
  }
  if (msg.type === 'ai-answer') {
    if (!isOwnContentScript(sender)) return false;
    answerWithAi(msg, sender).then(sendResponse, () => sendResponse({ ok: false, error: 'Something went wrong asking Claude.' }));
    return true;
  }
  return false;
});
