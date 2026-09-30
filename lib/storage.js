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
  const STATUSES = ['Applied', 'Interviewing', 'Rejected', 'Offer'];
  const MAX_TAILORED = 60;
  const API_KEY_KEY = 'anthropicApiKey';
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

  function blankCustomAnswer() {
    return { question: '', answer: '' };
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

  async function getApplications() {
    const data = await chrome.storage.local.get(APPS_KEY);
    return Array.isArray(data[APPS_KEY]) ? data[APPS_KEY] : [];
  }

  async function saveApplications(list) {
    await chrome.storage.local.set({ [APPS_KEY]: list });
  }

  // Adds an application, or updates the existing one for the same job (never a duplicate).
  async function upsertApplication({ url, company, title, site, tailoredId, tailoredFileName }) {
    const list = await getApplications();
    const key = applicationKey(url);
    let app = list.find((a) => a.key === key);
    const now = new Date().toISOString();
    if (!app) {
      app = { id: String(Date.now()) + Math.random().toString(36).slice(2, 7), key, url: String(url).slice(0, 2000), createdAt: now, status: STATUSES[0] };
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
    await saveApplications(list);
    return app;
  }

  async function setApplicationStatus(id, status) {
    if (!STATUSES.includes(status)) return;
    const list = await getApplications();
    const app = list.find((a) => a.id === id);
    if (app) {
      app.status = status;
      await saveApplications(list);
    }
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
  }

  globalThis.JobScriptStorage = {
    DECLINE,
    DEFAULT_PROFILE,
    blankWorkEntry,
    blankEducationEntry,
    blankProject,
    blankCustomAnswer,
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
    getApplications,
    upsertApplication,
    setApplicationStatus,
    getTailored,
    saveTailored,
    getAiSettings,
    saveAiSettings,
    getApiKey,
    saveApiKey,
    clearApiKey,
    exportAll,
    importAll,
  };
})();
