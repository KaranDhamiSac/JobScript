// Profile schema and chrome.storage.local helpers.
// Loaded as a plain script by the options page, the popup and the content script,
// so everything hangs off globalThis.JobScriptStorage.
(function () {
  const PROFILE_KEY = 'profile';
  const RESUME_KEY = 'resume';
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
    workHistory: [],
    education: [],
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
      description: '',
    };
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
    p.workHistory = (Array.isArray(p.workHistory) ? p.workHistory : []).map((e) =>
      Object.assign(blankWorkEntry(), e)
    );
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
    await chrome.storage.local.remove(RESUME_KEY);
  }

  async function exportAll() {
    return {
      app: 'JobScript',
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      profile: await getProfile(),
      resume: await getResume(),
    };
  }

  // Keeps storage.local (10 MB in Chrome) comfortably within quota once base64-encoded.
  const MAX_RESUME_BYTES = 5 * 1024 * 1024;
  const MAX_TEXT_LENGTH = 20000;
  const MAX_LIST_LENGTH = 50;

  function cleanText(v) {
    return typeof v === 'string' ? v.slice(0, MAX_TEXT_LENGTH) : '';
  }

  // Copy only the keys we know, with the types we expect, from an untrusted object.
  function cleanObject(src, template) {
    const out = {};
    for (const [key, def] of Object.entries(template)) {
      const v = src && typeof src === 'object' ? src[key] : undefined;
      if (typeof def === 'boolean') out[key] = v === true;
      else if (typeof def === 'string') out[key] = v === undefined ? def : cleanText(v);
    }
    return out;
  }

  function cleanList(list, template) {
    return (Array.isArray(list) ? list : []).slice(0, MAX_LIST_LENGTH).map((e) => cleanObject(e, template));
  }

  function sanitizeProfile(raw) {
    const p = cleanObject(raw, DEFAULT_PROFILE);
    p.workHistory = cleanList(raw && raw.workHistory, blankWorkEntry());
    p.education = cleanList(raw && raw.education, blankEducationEntry());
    p.customAnswers = cleanList(raw && raw.customAnswers, blankCustomAnswer());
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
  }

  globalThis.JobScriptStorage = {
    DECLINE,
    DEFAULT_PROFILE,
    blankWorkEntry,
    blankEducationEntry,
    blankCustomAnswer,
    withDefaults,
    getProfile,
    saveProfile,
    MAX_RESUME_BYTES,
    sanitizeResume,
    getResume,
    saveResume,
    clearResume,
    exportAll,
    importAll,
  };
})();
