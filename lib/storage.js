// Profile schema and chrome.storage.local helpers.
// Loaded as a plain script by the options page, the popup and the content script,
// so everything hangs off globalThis.JobScriptStorage.
(function () {
  const PROFILE_KEY = 'profile';
  const RESUME_KEY = 'resume';
  const RESUME_TEXT_KEY = 'resumeText'; // plain text of the resume, saved when you import it
  // Optional AI fallback. Kept apart from the profile so export/import never touch them.
  // Only background.js reads the API key.
  const AI_SETTINGS_KEY = 'aiSettings';
  // Application tracker, and tailored resumes saved with applications ("tailored:<id>").
  const APPS_KEY = 'applications';
  const TAILORED_PREFIX = 'tailored:';
  // "Filled" = JobScript filled the form; "Applied" = you submitted it. Later statuses imply applied.
  const STATUSES = ['Filled', 'Applied', 'Interviewing', 'Rejected', 'Offer'];
  const MAX_TAILORED = 60;
  const TRACKER_SETTINGS_KEY = 'trackerSettings';
  const DEFAULT_DAILY_GOAL = 5;
  const API_KEY_KEY = 'anthropicApiKey';
  // Answers saved for one site's exact fields, so a multi-step portal you've filled once fills
  // the same way next time. "siteAnswers": origin -> { fields, steps, learning, updatedAt }.
  // Learn mode records the steps of a site's form in order (steps: [{ title, keys }]) while
  // learning is true.
  const SITE_ANSWERS_KEY = 'siteAnswers';
  const MAX_SITES = 100;
  const MAX_SITE_FIELDS = 300;
  const MAX_SITE_STEPS = 30;
  // { autoSave }: save answers as you give them, without asking. Off unless you turn it on.
  const ANSWER_SETTINGS_KEY = 'answerSettings';
  // { autoShow }: open the side panel by itself on application pages. Off unless you turn it on;
  // the floating JobScript button is always there.
  const PANEL_SETTINGS_KEY = 'panelSettings';
  const AI_MODELS = [
    { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (recommended)' },
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 (fastest, cheapest)' },
    { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (best drafts, highest cost)' },
  ];
  const EXPORT_VERSION = 1;

  const DECLINE = 'Decline to answer';

  const DEFAULT_PROFILE = {
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    state: '',
    zip: '',
    country: 'United States',
    linkedin: '',
    github: '',
    portfolio: '',
    workAuthorized: '', // 'yes' | 'no' | ''
    requiresSponsorship: '',
    willingToRelocate: '',
    gender: DECLINE,
    race: DECLINE,
    veteran: DECLINE,
    disability: DECLINE,
    skills: '', // comma-separated
    workHistory: [],
    education: [],
    projects: [],
    references: [], // up to MAX_REFERENCES
    customAnswers: [],
  };

  function blankWorkEntry() {
    return {
      employer: '',
      title: '',
      location: '',
      startDate: '', // YYYY-MM
      endDate: '', // YYYY-MM, ignored when current is true
      current: false,
      supervisorName: '',
      supervisorPhone: '',
      bullets: [], // the master list of this job's bullet points
      description: '', // bullets joined with newlines; kept for forms that ask for a description
    };
  }

  function blankProject() {
    return {
      name: '',
      subtitle: '', // e.g. "Hiking Route Planner"
      tech: '', // comma-separated
      link: '',
      startDate: '', // YYYY-MM
      endDate: '', // YYYY-MM
      bullets: [],
    };
  }

  const MAX_REFERENCES = 3;

  function blankReference() {
    return {
      name: '', // the contact person
      company: '',
      relationship: '', // e.g. "Manager"
      email: '',
      phone: '',
      yearsKnown: '',
      mayContact: 'yes', // 'yes' | 'no' | ''
    };
  }

  function toBullets(list, text) {
    const lines = Array.isArray(list) ? list : String(text || '').split('\n');
    return lines.map((b) => String(b || '').replace(/^\s*[•●▪◦‣∙·*–-]\s*/, '').trim()).filter(Boolean);
  }

  function blankEducationEntry() {
    return {
      school: '',
      degree: '',
      major: '',
      gpa: '',
      location: '',
      startDate: '', // YYYY-MM
      gradDate: '', // YYYY-MM
    };
  }

  // dateRule (see lib/dateRules.js), when set, is used instead of answer for date questions.
  function blankCustomAnswer() {
    return { question: '', answer: '', dateRule: '' };
  }

  // Add or update saved answers, matched by question wording.
  async function saveCustomAnswers(list) {
    const profile = await getProfile();
    for (const { question, answer, dateRule } of list) {
      const q = String(question || '').trim();
      if (!q) continue;
      const entry = { question: q, answer: String(answer || ''), dateRule: String(dateRule || '') };
      const existing = profile.customAnswers.find((a) => a.question.trim().toLowerCase() === q.toLowerCase());
      if (existing) Object.assign(existing, entry);
      else if (profile.customAnswers.length < MAX_CUSTOM_ANSWERS) profile.customAnswers.push(entry);
    }
    await saveProfile(profile);
  }

  function saveCustomAnswer(entry) {
    return saveCustomAnswers([entry]);
  }

  // profileKey: the profile entry the field showed (e.g. "email"), so learned sites use your
  // current profile value rather than the one you had when learning.
  function blankSiteField() {
    return { label: '', kind: '', answer: '', dateRule: '', profileKey: '', savedAt: '' };
  }

  function blankSite() {
    return { fields: {}, steps: [], learning: false, updatedAt: '' };
  }

  async function getAllSiteAnswers() {
    const data = await chrome.storage.local.get(SITE_ANSWERS_KEY);
    const all = data[SITE_ANSWERS_KEY];
    return all && typeof all === 'object' ? all : {};
  }

  async function getSiteAnswers(origin) {
    const site = (await getAllSiteAnswers())[origin];
    return Object.assign(blankSite(), site && site.fields ? site : {});
  }

  // Read-modify-write of one site's record, one at a time: two saves started together (an answer
  // and a step, say) would otherwise each overwrite the other. Keeps the most recently used sites.
  let siteQueue = Promise.resolve();

  function updateSite(origin, fn) {
    const run = siteQueue.then(() => writeSite(origin, fn));
    siteQueue = run.catch(() => {});
    return run;
  }

  async function writeSite(origin, fn) {
    const all = await getAllSiteAnswers();
    const site = Object.assign(blankSite(), all[origin] && all[origin].fields ? all[origin] : {});
    fn(site);
    site.updatedAt = new Date().toISOString();
    all[origin] = site;
    const sites = Object.keys(all).sort((a, b) => String(all[b].updatedAt).localeCompare(String(all[a].updatedAt)));
    for (const o of sites.slice(MAX_SITES)) delete all[o];
    await chrome.storage.local.set({ [SITE_ANSWERS_KEY]: all });
  }

  // Start (clearing any steps recorded before) or stop learning a site.
  function setSiteLearning(origin, on) {
    return updateSite(origin, (site) => {
      site.learning = !!on;
      if (on) site.steps = [];
    });
  }

  // step: { title, keys: [field keys] }
  function addSiteStep(origin, step) {
    return updateSite(origin, (site) => {
      if (site.steps.length >= MAX_SITE_STEPS) return;
      site.steps.push({ title: cleanText(step.title, 120), keys: (step.keys || []).slice(0, 100).map((k) => cleanText(k, 300)) });
    });
  }

  // entries: [{ key, label, kind, answer, dateRule, profileKey }]
  function saveSiteAnswers(origin, entries) {
    return updateSite(origin, (site) => {
      const now = new Date().toISOString();
      for (const e of entries) {
        if (!e || !e.key) continue;
        site.fields[String(e.key).slice(0, 300)] = Object.assign(cleanObject(e, blankSiteField()), { savedAt: now });
      }
      const keys = Object.keys(site.fields);
      for (const k of keys.slice(0, Math.max(0, keys.length - MAX_SITE_FIELDS))) delete site.fields[k];
    });
  }

  // Remove one saved field, or the whole site when key is omitted or nothing is left.
  function deleteSiteAnswers(origin, key) {
    const run = siteQueue.then(async () => {
      const all = await getAllSiteAnswers();
      if (!all[origin]) return;
      if (key) delete all[origin].fields[key];
      const empty = !Object.keys(all[origin].fields).length && !(all[origin].steps || []).length;
      if (!key || empty) delete all[origin];
      await chrome.storage.local.set({ [SITE_ANSWERS_KEY]: all });
    });
    siteQueue = run.catch(() => {});
    return run;
  }

  function sanitizeSiteAnswers(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object') return out;
    for (const [origin, site] of Object.entries(raw).slice(0, MAX_SITES)) {
      if (!/^https?:\/\/[^/\s]+$/.test(origin) || !site || typeof site.fields !== 'object') continue;
      const fields = {};
      for (const [k, v] of Object.entries(site.fields).slice(0, MAX_SITE_FIELDS)) fields[k.slice(0, 300)] = cleanObject(v, blankSiteField());
      const steps = (Array.isArray(site.steps) ? site.steps : []).slice(0, MAX_SITE_STEPS).map((st) => ({
        title: cleanText(st && st.title, 120),
        keys: (st && Array.isArray(st.keys) ? st.keys : []).slice(0, 100).map((k) => cleanText(k, 300)),
      }));
      out[origin] = { fields, steps, learning: false, updatedAt: cleanText(site.updatedAt, 40) };
    }
    return out;
  }

  // Fill in any keys missing from an older or imported profile.
  function withDefaults(profile) {
    const p = Object.assign({}, DEFAULT_PROFILE, profile || {});
    p.workHistory = (Array.isArray(p.workHistory) ? p.workHistory : []).map((e) => {
      const job = Object.assign(blankWorkEntry(), e);
      job.bullets = toBullets(e && e.bullets, e && e.description); // older profiles only had description
      job.description = job.bullets.join('\n');
      return job;
    });
    p.references = (Array.isArray(p.references) ? p.references : []).slice(0, MAX_REFERENCES).map((e) => Object.assign(blankReference(), e));
    p.projects = (Array.isArray(p.projects) ? p.projects : []).map((e) => {
      const project = Object.assign(blankProject(), e);
      project.bullets = toBullets(e && e.bullets);
      return project;
    });
    p.education = (Array.isArray(p.education) ? p.education : []).map((e) =>
      Object.assign(blankEducationEntry(), e)
    );
    p.customAnswers = (Array.isArray(p.customAnswers) ? p.customAnswers : []).map((e) =>
      Object.assign(blankCustomAnswer(), e)
    );
    return p;
  }

  async function getProfile() {
    const data = await chrome.storage.local.get(PROFILE_KEY);
    return withDefaults(data[PROFILE_KEY]);
  }

  async function saveProfile(profile) {
    await chrome.storage.local.set({ [PROFILE_KEY]: withDefaults(profile) });
  }

  // Resume is stored separately so reading the profile stays cheap.
  // Shape: { name, type, size, data (base64, no data: prefix), savedAt }
  async function getResume() {
    const data = await chrome.storage.local.get(RESUME_KEY);
    return data[RESUME_KEY] || null;
  }

  async function saveResume(resume) {
    await chrome.storage.local.set({ [RESUME_KEY]: resume });
  }

  async function clearResume() {
    await chrome.storage.local.remove([RESUME_KEY, RESUME_TEXT_KEY]);
  }

  async function getAiSettings() {
    const data = await chrome.storage.local.get(AI_SETTINGS_KEY);
    const s = data[AI_SETTINGS_KEY] || {};
    const model = AI_MODELS.some((m) => m.id === s.model) ? s.model : AI_MODELS[0].id;
    return { enabled: s.enabled === true, model };
  }

  async function saveAiSettings(settings) {
    const clean = { enabled: settings.enabled === true, model: settings.model };
    if (!AI_MODELS.some((m) => m.id === clean.model)) clean.model = AI_MODELS[0].id;
    await chrome.storage.local.set({ [AI_SETTINGS_KEY]: clean });
  }

  async function getApiKey() {
    const data = await chrome.storage.local.get(API_KEY_KEY);
    return typeof data[API_KEY_KEY] === 'string' ? data[API_KEY_KEY] : '';
  }

  async function saveApiKey(key) {
    await chrome.storage.local.set({ [API_KEY_KEY]: String(key || '').trim().slice(0, 300) });
  }

  async function clearApiKey() {
    await chrome.storage.local.remove(API_KEY_KEY);
  }

  // Same job, same entry: ignore query strings, trailing slashes and Lever's /apply suffix.
  function applicationKey(url) {
    try {
      const u = new URL(url);
      return (u.origin + u.pathname).replace(/\/apply\/?$/, '').replace(/\/+$/, '').toLowerCase();
    } catch (e) {
      return String(url || '').toLowerCase();
    }
  }

  // The posting's ID from its URL: Greenhouse /jobs/123 or ?gh_jid=123, Workday requisitions
  // (_JR-0107491, _R4046019-2), LinkedIn, Handshake, SmartRecruiters, Taleo and Oracle job
  // numbers, Lever and Ashby UUIDs, common query parameters, else the last path segment with a
  // long number in it. See docs/platforms/<platform>.md, section 8.
  function jobIdFromUrl(url) {
    let u;
    try {
      u = new URL(url);
    } catch (e) {
      return '';
    }
    const path = u.pathname;
    const host = u.hostname;
    const params = ['gh_jid', 'ashby_jid', 'career_job_req_id', 'opportunityId', 'ShowJob', 'currentJobId', 'jobId', 'job_id', 'jid', 'requisitionId', 'req', 'jobid'];
    const param = params.map((k) => u.searchParams.get(k)).find(Boolean);
    let m = path.match(/\/jobs\/(\d{4,})/);
    if (/greenhouse\.io$/.test(host) && m) return m[1];
    if (/greenhouse\.io$/.test(host) && /\/embed\//.test(path) && /^\d+$/.test(u.searchParams.get('token') || '')) return u.searchParams.get('token');
    if (/\.myworkday(jobs|site)\.com$/.test(host)) {
      // The slug ends in _<requisition>, plus -<n> when the job is posted on several sites.
      m = path.replace(/\/apply(\/.*)?$/, '').match(/\/job\/(?:[^/]+\/)?[^/]*_([A-Za-z0-9][A-Za-z0-9-]*?)(?:-\d{1,2})?\/?$/);
      if (m) return m[1];
    }
    if (/(^|\.)linkedin\.com$/.test(host)) {
      m = path.match(/\/jobs\/view\/(?:[^/?#]*-)?(\d{6,})/);
      if (m) return m[1];
    }
    if (/(^|\.)joinhandshake\.com$/.test(host)) {
      m = path.match(/\/(?:jobs|job-search(?:-new)?)\/(\d+)/);
      if (m) return m[1];
    }
    if (/smartrecruiters\.com$/.test(host)) {
      m = path.match(/\/(\d{6,})(?:-|\/|$)/);
      if (m) return m[1];
    }
    // Taleo's ?job= holds the requisition or contest number; elsewhere "job" is too generic.
    if ((/\.taleo\.net$/.test(host) || /\/careersection\//.test(path)) && u.searchParams.get('job')) return u.searchParams.get('job').slice(0, 80);
    m = path.match(/\/CandidateExperience\/.*\/job\/(\d+)/i);
    if (m) return m[1];
    if (param) return param.slice(0, 80);
    m = path.match(/\/jobs\/(\d{4,})/);
    if (m) return m[1];
    m = path.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    if (m) return m[0];
    m = path.match(/_((?:JR|REQ|R)[-_]?\d{3,})/i);
    if (m) return m[1];
    const seg = path.split('/').reverse().find((x) => /\d{4,}/.test(x));
    return seg ? seg.slice(0, 80) : '';
  }

  async function getApplications() {
    const data = await chrome.storage.local.get(APPS_KEY);
    const list = Array.isArray(data[APPS_KEY]) ? data[APPS_KEY] : [];
    // Entries from before "Filled" existed were logged as applied when filled.
    for (const app of list) {
      if (!STATUSES.includes(app.status)) app.status = STATUSES[0];
      if (app.status !== 'Filled' && !app.appliedAt) app.appliedAt = app.createdAt;
      if (app.jobId === undefined) app.jobId = jobIdFromUrl(app.url);
    }
    return list;
  }

  async function saveApplications(list) {
    await chrome.storage.local.set({ [APPS_KEY]: list });
  }

  // Adds an application, or updates the existing one for the same job (never a duplicate).
  async function upsertApplication({ url, company, title, site, tailoredId, tailoredFileName, folder }) {
    const list = await getApplications();
    const key = applicationKey(url);
    let app = list.find((a) => a.key === key);
    const now = new Date().toISOString();
    if (!app) {
      app = { id: String(Date.now()) + Math.random().toString(36).slice(2, 7), key, url: String(url).slice(0, 2000), jobId: jobIdFromUrl(url), createdAt: now, status: STATUSES[0] };
      list.push(app);
    }
    app.company = cleanText(company || app.company || '', 200);
    app.title = cleanText(title || app.title || '', 300);
    app.site = cleanText(site || app.site || '', 100);
    app.lastFilledAt = now;
    if (tailoredId) {
      app.tailoredId = tailoredId;
      app.tailoredFileName = cleanText(tailoredFileName, 200);
    }
    if (folder) app.folder = cleanText(folder, 300); // Downloads/<folder>, where its files were saved
    await saveApplications(list);
    return app;
  }

  async function setApplicationStatus(id, status) {
    if (!STATUSES.includes(status)) return;
    const list = await getApplications();
    const app = list.find((a) => a.id === id);
    if (app) {
      app.status = status;
      // Record the day you applied the first time it's marked applied (or later).
      if (status === 'Filled') delete app.appliedAt;
      else if (!app.appliedAt) app.appliedAt = new Date().toISOString();
      await saveApplications(list);
    }
  }

  // { dailyGoal } for the tracker page: whole number, 1 to 100.
  async function getTrackerSettings() {
    const s = (await chrome.storage.local.get(TRACKER_SETTINGS_KEY))[TRACKER_SETTINGS_KEY] || {};
    const goal = Math.round(Number(s.dailyGoal));
    return { dailyGoal: goal >= 1 && goal <= 100 ? goal : DEFAULT_DAILY_GOAL };
  }

  async function saveTrackerSettings({ dailyGoal }) {
    const goal = Math.min(100, Math.max(1, Math.round(Number(dailyGoal)) || DEFAULT_DAILY_GOAL));
    await chrome.storage.local.set({ [TRACKER_SETTINGS_KEY]: { dailyGoal: goal } });
    return { dailyGoal: goal };
  }

  async function getAnswerSettings() {
    const s = (await chrome.storage.local.get(ANSWER_SETTINGS_KEY))[ANSWER_SETTINGS_KEY] || {};
    return { autoSave: s.autoSave === true };
  }

  async function saveAnswerSettings({ autoSave }) {
    await chrome.storage.local.set({ [ANSWER_SETTINGS_KEY]: { autoSave: autoSave === true } });
  }

  async function getPanelSettings() {
    const s = (await chrome.storage.local.get(PANEL_SETTINGS_KEY))[PANEL_SETTINGS_KEY] || {};
    return { autoShow: s.autoShow === true };
  }

  async function savePanelSettings({ autoShow }) {
    await chrome.storage.local.set({ [PANEL_SETTINGS_KEY]: { autoShow: autoShow === true } });
  }

  async function getTailored(id) {
    const key = TAILORED_PREFIX + id;
    return (await chrome.storage.local.get(key))[key] || null;
  }

  // record: { name, data (base64 PDF), createdAt, company, title, url, content }
  async function saveTailored(id, record) {
    await chrome.storage.local.set({ [TAILORED_PREFIX + id]: record });
    // Keep storage bounded: drop the oldest tailored resumes beyond the limit.
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all).filter((k) => k.startsWith(TAILORED_PREFIX));
    if (keys.length > MAX_TAILORED) {
      keys.sort((a, b) => String(all[a].createdAt).localeCompare(String(all[b].createdAt)));
      await chrome.storage.local.remove(keys.slice(0, keys.length - MAX_TAILORED));
    }
  }

  // ---------------------------------------------------------------------------
  // Job and company research, and cover letters.
  //   posting:<application key>  the full job posting, saved with each tracker entry so it
  //                              survives the posting being taken down
  //   jobParse:<job key>         Claude's breakdown of that posting (cached per job ID)
  //   company:<company key>      a company profile: mission, values, products, news, culture,
  //                              each item with the URL it came from (or added by you)
  //   letter:<application key>   the cover letter written for that application
  const POSTING_PREFIX = 'posting:';
  const JOB_PARSE_PREFIX = 'jobParse:';
  const COMPANY_PREFIX = 'company:';
  const LETTER_PREFIX = 'letter:';
  const MAX_POSTINGS = 300;
  const MAX_JOB_PARSES = 300;
  const MAX_COMPANIES = 200;
  const MAX_LETTERS = 150;
  const MAX_POSTING_CHARS = 30000;
  const RESEARCH_SETTINGS_KEY = 'researchSettings';
  const RESEARCH_MODES = ['website', 'search'];
  const LETTER_TONES = ['professional', 'warm', 'concise'];
  const LETTER_LENGTHS = ['short', '250', 'full'];
  const COMPANY_SECTIONS = ['mission', 'values', 'products', 'news', 'culture'];

  // Drop the oldest records under a prefix beyond `max`, by their `field` timestamp.
  async function prune(prefix, max, field) {
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all).filter((k) => k.startsWith(prefix));
    if (keys.length <= max) return;
    keys.sort((a, b) => String(all[a][field]).localeCompare(String(all[b][field])));
    await chrome.storage.local.remove(keys.slice(0, keys.length - max));
  }

  // The same job on the same site, however its URL is spelled: host + job ID when there is one.
  function jobKey(url) {
    const id = jobIdFromUrl(url);
    try {
      if (id) return new URL(url).hostname.toLowerCase() + ':' + id;
    } catch (e) {
      /* fall through */
    }
    return applicationKey(url);
  }

  // "Acme, Inc." and "ACME Inc" are the same company.
  function companyKey(name) {
    return String(name || '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[,.]?\s*\b(inc|incorporated|llc|ltd|limited|corp|corporation|co|company|plc|gmbh)\b\.?/g, ' ')
      .replace(/[^a-z0-9]+/g, '')
      .slice(0, 80);
  }

  function cleanUrl(v) {
    const u = cleanText(v, 1000).trim();
    return /^https?:\/\/[^\s]+$/i.test(u) ? u : '';
  }

  async function getPosting(url) {
    const key = POSTING_PREFIX + applicationKey(url);
    return (await chrome.storage.local.get(key))[key] || null;
  }

  // Saves the posting for this application. A shorter re-scrape (a page that changed or was
  // taken down) never replaces a fuller copy.
  async function savePosting(posting) {
    if (!posting || !posting.url) return null;
    const existing = await getPosting(posting.url);
    const description = cleanText(posting.description, MAX_POSTING_CHARS);
    if (existing && existing.description.length > description.length * 1.2) return existing;
    const record = {
      url: cleanText(posting.url, 2000),
      title: cleanText(posting.title, 300),
      company: cleanText(posting.company, 200),
      companyDomain: cleanText(posting.companyDomain, 200),
      site: cleanText(posting.site, 100),
      description,
      savedAt: new Date().toISOString(),
    };
    await chrome.storage.local.set({ [POSTING_PREFIX + applicationKey(posting.url)]: record });
    await prune(POSTING_PREFIX, MAX_POSTINGS, 'savedAt');
    return record;
  }

  async function getJobParse(url) {
    const key = JOB_PARSE_PREFIX + jobKey(url);
    return (await chrome.storage.local.get(key))[key] || null;
  }

  async function saveJobParse(url, parsed) {
    const record = Object.assign({}, parsed, { parsedAt: new Date().toISOString() });
    await chrome.storage.local.set({ [JOB_PARSE_PREFIX + jobKey(url)]: record });
    await prune(JOB_PARSE_PREFIX, MAX_JOB_PARSES, 'parsedAt');
    return record;
  }

  function blankCompany(name) {
    const c = { key: companyKey(name), name: cleanText(name, 200), domain: '', mode: '', updatedAt: '', editedAt: '' };
    for (const sec of COMPANY_SECTIONS) c[sec] = [];
    return c;
  }

  // Items are { text, source, byYou }: source is the page it came from; byYou marks what you
  // added or changed yourself.
  function cleanCompany(raw) {
    const c = blankCompany(raw && raw.name);
    if (raw && raw.key) c.key = companyKey(raw.key) || c.key;
    c.domain = cleanText(raw && raw.domain, 200).toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    c.mode = RESEARCH_MODES.includes(raw && raw.mode) ? raw.mode : '';
    c.updatedAt = cleanText(raw && raw.updatedAt, 40);
    c.editedAt = cleanText(raw && raw.editedAt, 40);
    for (const sec of COMPANY_SECTIONS) {
      c[sec] = (raw && Array.isArray(raw[sec]) ? raw[sec] : [])
        .slice(0, 20)
        .map((it) => ({ text: cleanText(it && it.text, 600).trim(), source: cleanUrl(it && it.source), byYou: !!(it && it.byYou) }))
        .filter((it) => it.text && (it.source || it.byYou));
    }
    return c;
  }

  async function getCompany(name) {
    const key = COMPANY_PREFIX + companyKey(name);
    const raw = (await chrome.storage.local.get(key))[key];
    return raw ? cleanCompany(raw) : null;
  }

  async function saveCompany(profile) {
    const c = cleanCompany(profile);
    if (!c.key) return null;
    await chrome.storage.local.set({ [COMPANY_PREFIX + c.key]: c });
    await prune(COMPANY_PREFIX, MAX_COMPANIES, 'updatedAt');
    return c;
  }

  // record: { text, tone, length, flags, pdf: { name, data (base64) }, createdAt, title, company }
  async function getLetter(url) {
    const key = LETTER_PREFIX + applicationKey(url);
    return (await chrome.storage.local.get(key))[key] || null;
  }

  async function saveLetter(url, record) {
    const r = Object.assign({}, record, { savedAt: new Date().toISOString() });
    await chrome.storage.local.set({ [LETTER_PREFIX + applicationKey(url)]: r });
    await prune(LETTER_PREFIX, MAX_LETTERS, 'savedAt');
    // The tracker shows which applications have one.
    const list = await getApplications();
    const app = list.find((a) => a.key === applicationKey(url));
    if (app) {
      app.coverLetterAt = r.savedAt;
      await saveApplications(list);
    }
    return r;
  }

  // { mode: 'website' | 'search', tone, length } for company research and cover letters.
  async function getResearchSettings() {
    const s = (await chrome.storage.local.get(RESEARCH_SETTINGS_KEY))[RESEARCH_SETTINGS_KEY] || {};
    return {
      mode: RESEARCH_MODES.includes(s.mode) ? s.mode : 'website',
      tone: LETTER_TONES.includes(s.tone) ? s.tone : 'professional',
      length: LETTER_LENGTHS.includes(s.length) ? s.length : '250',
    };
  }

  async function saveResearchSettings(settings) {
    const next = Object.assign(await getResearchSettings(), settings || {});
    const clean = {
      mode: RESEARCH_MODES.includes(next.mode) ? next.mode : 'website',
      tone: LETTER_TONES.includes(next.tone) ? next.tone : 'professional',
      length: LETTER_LENGTHS.includes(next.length) ? next.length : '250',
    };
    await chrome.storage.local.set({ [RESEARCH_SETTINGS_KEY]: clean });
    return clean;
  }

  async function getResumeText() {
    const data = await chrome.storage.local.get(RESUME_TEXT_KEY);
    return typeof data[RESUME_TEXT_KEY] === 'string' ? data[RESUME_TEXT_KEY] : '';
  }

  async function saveResumeText(text) {
    await chrome.storage.local.set({ [RESUME_TEXT_KEY]: cleanText(text, MAX_RESUME_TEXT) });
  }

  async function exportAll() {
    return {
      app: 'JobScript',
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      profile: await getProfile(),
      resume: await getResume(),
      resumeText: await getResumeText(),
      siteAnswers: await getAllSiteAnswers(),
    };
  }

  // Keeps storage.local (10 MB in Chrome) comfortably within quota once base64-encoded.
  const MAX_RESUME_BYTES = 5 * 1024 * 1024;
  const MAX_TEXT_LENGTH = 20000;
  const MAX_LIST_LENGTH = 50;
  const MAX_CUSTOM_ANSWERS = 500;
  const MAX_RESUME_TEXT = 100000;

  function cleanText(v, max) {
    return typeof v === 'string' ? v.slice(0, max || MAX_TEXT_LENGTH) : '';
  }

  // Copy only the keys we know, with the types we expect, from an untrusted object.
  function cleanObject(src, template) {
    const out = {};
    for (const [key, def] of Object.entries(template)) {
      const v = src && typeof src === 'object' ? src[key] : undefined;
      if (typeof def === 'boolean') out[key] = v === true;
      else if (typeof def === 'string') out[key] = v === undefined ? def : cleanText(v);
      else if (Array.isArray(def)) out[key] = (Array.isArray(v) ? v : []).slice(0, 40).map((x) => cleanText(x, 1000)).filter(Boolean);
    }
    return out;
  }

  function cleanList(list, template, max) {
    return (Array.isArray(list) ? list : []).slice(0, max || MAX_LIST_LENGTH).map((e) => cleanObject(e, template));
  }

  function sanitizeProfile(raw) {
    const p = cleanObject(raw, DEFAULT_PROFILE);
    p.workHistory = cleanList(raw && raw.workHistory, blankWorkEntry());
    p.education = cleanList(raw && raw.education, blankEducationEntry());
    p.projects = cleanList(raw && raw.projects, blankProject());
    p.references = cleanList(raw && raw.references, blankReference(), MAX_REFERENCES);
    p.customAnswers = cleanList(raw && raw.customAnswers, blankCustomAnswer(), MAX_CUSTOM_ANSWERS);
    return p;
  }

  // Returns a clean resume record, or throws if it isn't a reasonable PDF.
  function sanitizeResume(raw) {
    if (!raw || typeof raw.name !== 'string' || typeof raw.data !== 'string') throw new Error('Resume is missing.');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw.data)) throw new Error('Resume data is not valid.');
    const size = Math.floor((raw.data.length * 3) / 4);
    if (size > MAX_RESUME_BYTES) throw new Error('Resume is larger than 5 MB.');
    if (!atob(raw.data.slice(0, 8)).startsWith('%PDF')) throw new Error('Resume is not a PDF.');
    return {
      name: raw.name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 200) || 'resume.pdf',
      type: 'application/pdf',
      size,
      data: raw.data,
      savedAt: typeof raw.savedAt === 'string' ? raw.savedAt.slice(0, 40) : new Date().toISOString(),
    };
  }

  // Accepts the object produced by exportAll(). Throws on anything unrecognisable.
  async function importAll(data) {
    if (!data || typeof data !== 'object' || !data.profile || typeof data.profile !== 'object') {
      throw new Error('This file is not a JobScript profile export.');
    }
    const resume = data.resume ? sanitizeResume(data.resume) : null;
    await saveProfile(sanitizeProfile(data.profile));
    if (resume) await saveResume(resume);
    if (typeof data.resumeText === 'string') await saveResumeText(data.resumeText);
    if (data.siteAnswers) await chrome.storage.local.set({ [SITE_ANSWERS_KEY]: sanitizeSiteAnswers(data.siteAnswers) });
  }

  globalThis.JobScriptStorage = {
    DECLINE,
    DEFAULT_PROFILE,
    blankWorkEntry,
    blankEducationEntry,
    blankProject,
    blankReference,
    MAX_REFERENCES,
    blankCustomAnswer,
    saveCustomAnswer,
    saveCustomAnswers,
    getAnswerSettings,
    saveAnswerSettings,
    getPanelSettings,
    savePanelSettings,
    getAllSiteAnswers,
    getSiteAnswers,
    saveSiteAnswers,
    setSiteLearning,
    addSiteStep,
    deleteSiteAnswers,
    withDefaults,
    getProfile,
    saveProfile,
    MAX_RESUME_BYTES,
    sanitizeResume,
    getResume,
    saveResume,
    clearResume,
    getResumeText,
    saveResumeText,
    AI_MODELS,
    STATUSES,
    applicationKey,
    jobIdFromUrl,
    getApplications,
    upsertApplication,
    setApplicationStatus,
    getTailored,
    saveTailored,
    COMPANY_SECTIONS,
    LETTER_TONES,
    LETTER_LENGTHS,
    jobKey,
    companyKey,
    getPosting,
    savePosting,
    getJobParse,
    saveJobParse,
    blankCompany,
    cleanCompany,
    getCompany,
    saveCompany,
    getLetter,
    saveLetter,
    getResearchSettings,
    saveResearchSettings,
    getTrackerSettings,
    saveTrackerSettings,
    getAiSettings,
    saveAiSettings,
    getApiKey,
    saveApiKey,
    clearApiKey,
    exportAll,
    importAll,
  };
})();
