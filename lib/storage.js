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
  // Answers saved for one site's exact fields ("siteAnswers": origin -> { fields, updatedAt }),
  // so a multi-step portal you've filled once fills the same way next time.
  const SITE_ANSWERS_KEY = 'siteAnswers';
  const MAX_SITES = 100;
  const MAX_SITE_FIELDS = 300;
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

  function blankSiteField() {
    return { label: '', kind: '', answer: '', dateRule: '', savedAt: '' };
  }

  async function getAllSiteAnswers() {
    const data = await chrome.storage.local.get(SITE_ANSWERS_KEY);
    const all = data[SITE_ANSWERS_KEY];
    return all && typeof all === 'object' ? all : {};
  }

  // { fields: { [fieldKey]: { label, kind, answer, dateRule, savedAt } }, updatedAt }
  async function getSiteAnswers(origin) {
    const site = (await getAllSiteAnswers())[origin];
    return site && site.fields ? site : { fields: {}, updatedAt: '' };
  }

  // entries: [{ key, label, kind, answer, dateRule }]. Keeps the most recently used sites.
  async function saveSiteAnswers(origin, entries) {
    const all = await getAllSiteAnswers();
    const site = all[origin] && all[origin].fields ? all[origin] : { fields: {} };
    const now = new Date().toISOString();
    for (const e of entries) {
      if (!e || !e.key) continue;
      site.fields[String(e.key).slice(0, 300)] = Object.assign(cleanObject(e, blankSiteField()), { savedAt: now });
    }
    const keys = Object.keys(site.fields);
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_SITE_FIELDS))) delete site.fields[k];
    site.updatedAt = now;
    all[origin] = site;
    const sites = Object.keys(all).sort((a, b) => String(all[b].updatedAt).localeCompare(String(all[a].updatedAt)));
    for (const o of sites.slice(MAX_SITES)) delete all[o];
    await chrome.storage.local.set({ [SITE_ANSWERS_KEY]: all });
  }

  async function deleteSiteAnswers(origin, key) {
    const all = await getAllSiteAnswers();
    if (!all[origin]) return;
    if (key) delete all[origin].fields[key];
    if (!key || !Object.keys(all[origin].fields).length) delete all[origin];
    await chrome.storage.local.set({ [SITE_ANSWERS_KEY]: all });
  }

  function sanitizeSiteAnswers(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object') return out;
    for (const [origin, site] of Object.entries(raw).slice(0, MAX_SITES)) {
      if (!/^https?:\/\/[^/\s]+$/.test(origin) || !site || typeof site.fields !== 'object') continue;
      const fields = {};
      for (const [k, v] of Object.entries(site.fields).slice(0, MAX_SITE_FIELDS)) fields[k.slice(0, 300)] = cleanObject(v, blankSiteField());
      out[origin] = { fields, updatedAt: cleanText(site.updatedAt, 40) };
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

  // The posting's ID from its URL: Greenhouse /jobs/123 or ?gh_jid=123, Lever and Ashby
  // UUIDs, Workday requisition numbers (_R12345), common query parameters, else the last
  // path segment with a long number in it.
  function jobIdFromUrl(url) {
    let u;
    try {
      u = new URL(url);
    } catch (e) {
      return '';
    }
    const path = u.pathname;
    const param = ['gh_jid', 'jobId', 'job_id', 'jid', 'requisitionId', 'req', 'jobid'].map((k) => u.searchParams.get(k)).find(Boolean);
    let m = path.match(/\/jobs\/(\d{4,})/);
    if (/greenhouse\.io$/.test(u.hostname) && m) return m[1];
    if (/greenhouse\.io$/.test(u.hostname) && /\/embed\//.test(path) && /^\d+$/.test(u.searchParams.get('token') || '')) return u.searchParams.get('token');
    if (param) return param.slice(0, 80);
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
    getAllSiteAnswers,
    getSiteAnswers,
    saveSiteAnswers,
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
