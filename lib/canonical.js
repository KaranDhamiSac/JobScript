// Canonical questions: many wordings, one answer. "Expected graduation date", "When do you
// graduate?" and "Graduation year" are all education.gradDate; the fact is stored once and
// formatted for each form.
//
// Every question is one of three types:
//   generic      stable facts (contact, education, work authorization, EEO, how you heard about
//                the job…): filled automatically from your saved answer
//   changing     facts that move (start date, salary expectations, notice period): filled from a
//                saved rule, always as a suggestion
//   job          about this job or company ("Why do you want to work here?", essays): never
//                reused; JobScript offers an AI draft or leaves it to you
//
// Keyword rules come first; questions they can't place can be classified by Claude Haiku
// (see background.js) and the result is cached per wording. Loaded by the content script, the
// options page, background.js and Node tests.
(function () {
  // profile: where the fact lives in your profile ("education.0.gradDate" is your first
  // education entry), so it's stored once. Without one, the answer lives in the saved-answers
  // store. kind: how it's formatted: text, date (YYYY-MM or YYYY-MM-DD), bool (yes/no) or choice.
  const QUESTIONS = [
    // Contact and links
    { key: 'contact.email', type: 'generic', kind: 'text', profile: 'email', label: 'Email', patterns: [/\be-?mail( address)?\b/] },
    { key: 'contact.phone', type: 'generic', kind: 'text', profile: 'phone', label: 'Phone number', patterns: [/\b(phone|mobile|cell)( number| no)?\b/] },
    { key: 'contact.address', type: 'generic', kind: 'text', profile: 'address', label: 'Street address', patterns: [/\b(street|mailing|home) address\b|\baddress( line)? ?1\b|^address$/] },
    { key: 'contact.city', type: 'generic', kind: 'text', profile: 'city', label: 'City', patterns: [/^(current )?city$|\bcity of residence\b/] },
    { key: 'contact.zip', type: 'generic', kind: 'text', profile: 'zip', label: 'ZIP code', patterns: [/\b(zip|postal)( code)?\b/] },
    { key: 'links.linkedin', type: 'generic', kind: 'text', profile: 'linkedin', label: 'LinkedIn profile', patterns: [/\blinked ?in\b/] },
    { key: 'links.github', type: 'generic', kind: 'text', profile: 'github', label: 'GitHub', patterns: [/\bgit ?hub\b/] },
    { key: 'links.portfolio', type: 'generic', kind: 'text', profile: 'portfolio', label: 'Portfolio or website', patterns: [/\bportfolio\b|\bpersonal (web)?site\b/] },

    // Education (your first education entry)
    { key: 'education.school', type: 'generic', kind: 'text', profile: 'education.0.school', label: 'School', patterns: [/\b(school|university|college|institution)( name)?$|\bwhere (do|did) you (go to|attend|study)\b|\b(which|what) (school|university|college)\b/] },
    { key: 'education.degree', type: 'generic', kind: 'choice', profile: 'education.0.degree', label: 'Degree', patterns: [/\b(degree|level of education|highest education|education level)\b(?!.*\b(field|major|subject)\b)/] },
    { key: 'education.major', type: 'generic', kind: 'text', profile: 'education.0.major', label: 'Major', patterns: [/\b(major|field of study|area of study|discipline|concentration|program of study)\b/] },
    { key: 'education.gpa', type: 'generic', kind: 'text', profile: 'education.0.gpa', label: 'GPA', patterns: [/\bgpa\b|\bgrade point average\b|\bcumulative grade\b/] },
    { key: 'education.gradDate', type: 'generic', kind: 'date', profile: 'education.0.gradDate', label: 'Graduation date', patterns: [/\bgraduat(e|ion|ing)\b|\bclass of\b|\b(expected|anticipated) (completion|degree)( date)?\b|\bdegree completion\b|\bwhen (do|will) you (finish|complete) (your )?(degree|studies|school)\b/] },

    // Work authorization
    { key: 'auth.workAuthorized', type: 'generic', kind: 'bool', profile: 'workAuthorized', label: 'Authorized to work', patterns: [/\b(legally )?(authori[sz]ed|eligible|permitted) to work\b|\bright to work\b|\bwork authori[sz]ation\b/] },
    { key: 'auth.sponsorship', type: 'generic', kind: 'bool', profile: 'requiresSponsorship', label: 'Needs visa sponsorship', patterns: [/\bsponsor(ship)?\b/] },
    { key: 'auth.relocation', type: 'generic', kind: 'bool', profile: 'willingToRelocate', label: 'Willing to relocate', patterns: [/\b(willing|open|able) to relocate\b|\brelocat(e|ion)\b(?!.*\b(date|when)\b)/] },

    // Voluntary self-identification
    { key: 'eeo.gender', type: 'generic', kind: 'choice', profile: 'gender', label: 'Gender', patterns: [/^(gender|sex)( identity)?$|\bwhat is your gender\b/] },
    { key: 'eeo.hispanic', type: 'generic', kind: 'choice', label: 'Hispanic or Latino', patterns: [/\bhispanic\b|\blatin[oxa]\b/] },
    { key: 'eeo.race', type: 'generic', kind: 'choice', profile: 'race', label: 'Race or ethnicity', patterns: [/\b(race|ethnicity|racial)\b/] },
    { key: 'eeo.veteran', type: 'generic', kind: 'choice', profile: 'veteran', label: 'Veteran status', patterns: [/\bveteran\b/] },
    { key: 'eeo.disability', type: 'generic', kind: 'choice', profile: 'disability', label: 'Disability status', patterns: [/\bdisabilit(y|ies)\b/] },

    // General, kept in the saved-answers store
    { key: 'general.howHeard', type: 'generic', kind: 'choice', label: 'How did you hear about us?', patterns: [/\bhow (did|do) you (hear|learn|find out|find)\b|\bwhere did you (hear|see|find|learn)\b|\b(referral|application|lead|candidate) source\b|^(source|referral)$|\bhow were you referred\b/] },
    { key: 'general.yearsExperience', type: 'generic', kind: 'text', label: 'Years of experience', patterns: [/\byears of (relevant |professional |total |work |industry )?experience\b(?!.*\b(with|using|in)\s+[a-z])/] },
    { key: 'general.languages', type: 'generic', kind: 'text', label: 'Languages you speak', patterns: [/\blanguages? (do you |you )?(speak|know)\b|\blanguage proficienc|\bwhat languages\b|\bfluent in\b|\bspoken languages\b/] },
    { key: 'general.certifications', type: 'generic', kind: 'text', label: 'Certifications', patterns: [/\bcertifications?\b|\blicen[cs]es? (or|and) certifications?\b|\bprofessional licen[cs]e/] },

    // Changing: a saved rule, offered as a suggestion
    { key: 'changing.startDate', type: 'changing', kind: 'date', label: 'Available start date', patterns: [/\bstart date\b|\b(available|able|ready) to start\b|\bwhen (can|could|would) you (start|begin|join)\b|\bearliest (start|available|availability)\b|\bdate (of )?availab|\bavailability date\b/] },
    { key: 'changing.salary', type: 'changing', kind: 'text', label: 'Salary expectations', patterns: [/\bsalary\b|\bcompensation\b|\b(pay|wage|rate) (expectations?|requirements?|range)\b|\b(desired|expected) (pay|wage|rate)\b|\bhourly rate\b/] },
    { key: 'changing.noticePeriod', type: 'changing', kind: 'text', label: 'Notice period', patterns: [/\bnotice period\b|\bhow much notice\b|\bnotice (do you need|required|to your (current )?employer)\b/] },
  ];

  // About this job or company: never reused automatically.
  const JOB_SPECIFIC = [
    /\bwhy (do you want|are you (interested|applying|excited)|would you (like|want)|did you apply|this (role|company|position|team|job|opportunity)|us\b|join\b|work (at|for|with|here))/,
    /\bwhy\b.*\b(work|join|apply)\b.*\b(here|us|our|this)\b/,
    /\bwhat (excites|interests|draws|attracts|motivates) you\b/,
    /\bwhat (makes|would make) you (a )?(good|great|strong|the right|ideal) (fit|candidate)\b/,
    /\b(tell us|tell me|share) (about|why|how|a time|something)\b/,
    /\bdescribe (a|an|your|how|the|one)\b/,
    /\bgive (us )?an example\b|\bwalk us through\b/,
    /\bin (\d+|a few|one|two|three) (words|sentences|paragraphs|characters)\b/,
    /\bcover letter\b|\bmotivation(al)? letter\b|\bletter of (interest|intent)\b/,
    /\b(anything|something) else (you('d| would)? like|we should know)\b|\badditional information\b/,
    /\bwhat (do you know|interests you) about (us|our|the company)\b/,
  ];

  function norm(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[’']/g, "'")
      .replace(/\*|\(required\)|\(optional\)/g, ' ')
      .replace(/[^a-z0-9'?/+ -]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[?\s]+$/, '');
  }

  const BY_KEY = new Map(QUESTIONS.map((q) => [q.key, q]));

  function tokens(text) {
    return norm(text).split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  }

  // Word overlap (0 to 1), for matching a wording you've answered before.
  function similarity(a, b) {
    const na = norm(a);
    const nb = norm(b);
    if (!na || !nb) return 0;
    if (na === nb) return 1;
    const ta = new Set(tokens(a));
    const tb = new Set(tokens(b));
    if (!ta.size || !tb.size) return 0;
    let shared = 0;
    for (const t of ta) if (tb.has(t)) shared++;
    // Every word of the shorter wording appears in the longer one: "Do you speak Spanish?" and
    // "Do you speak Spanish fluently?".
    if (shared === Math.min(ta.size, tb.size) && shared >= 2) return Math.max(0.85, shared / (ta.size + tb.size - shared));
    return shared / (ta.size + tb.size - shared);
  }

  // { type, key, by } for a question's wording, or null when the rules can't place it.
  //   learned: [{ key, type, wordings: [] }] from your saved answers, so wordings you've
  //            answered before (and new canonical questions grown from them) are recognized
  //   company: the employer's name, so "What do you know about Acme?" counts as job-specific
  function classify(wording, opts) {
    const o = opts || {};
    const text = norm(wording);
    if (!text) return null;
    if (JOB_SPECIFIC.some((re) => re.test(text))) return { type: 'job', key: '', by: 'rules' };
    const company = norm(o.company);
    if (company && company.length > 2 && text.includes(company) && /\b(why|what|how)\b/.test(text)) {
      return { type: 'job', key: '', by: 'rules' };
    }
    for (const entry of o.learned || []) {
      if ((entry.wordings || []).some((w) => norm(w) === text)) return { type: entry.type, key: entry.key, by: 'saved' };
    }
    for (const q of QUESTIONS) {
      if (q.patterns.some((re) => re.test(text))) return { type: q.type, key: q.key, by: 'rules' };
    }
    let best = null;
    for (const entry of o.learned || []) {
      for (const w of entry.wordings || []) {
        const s = similarity(text, w);
        if (s >= 0.8 && (!best || s > best.s)) best = { s, entry };
      }
    }
    return best ? { type: best.entry.type, key: best.entry.key, by: 'saved' } : null;
  }

  function get(key) {
    return BY_KEY.get(key) || null;
  }

  // A new canonical key for a question outside the built-in list ("custom.do-you-speak-spanish").
  function customKey(wording) {
    return 'custom.' + norm(wording).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  }

  // Read and write a fact at a profile path like "education.0.gradDate".
  function readProfile(profile, path) {
    let v = profile;
    for (const part of path.split('.')) {
      if (v == null) return '';
      v = v[/^\d+$/.test(part) ? Number(part) : part];
    }
    return v == null ? '' : String(v);
  }

  function writeProfile(profile, path, value, blanks) {
    const parts = path.split('.');
    let obj = profile;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      const next = parts[i + 1];
      if (/^\d+$/.test(next)) {
        if (!Array.isArray(obj[part])) obj[part] = [];
        const idx = Number(next);
        while (obj[part].length <= idx) obj[part].push(blanks && blanks[part] ? blanks[part]() : {});
        obj = obj[part][idx];
        i++;
      } else {
        if (obj[part] == null || typeof obj[part] !== 'object') obj[part] = {};
        obj = obj[part];
      }
    }
    obj[parts[parts.length - 1]] = value;
  }

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  // A stored date (YYYY-MM or YYYY-MM-DD) for one field: format is 'full' (YYYY-MM-DD),
  // 'mm/yyyy', 'mm/dd/yyyy', 'year', 'month' (number), or 'text' ("May 2027").
  function formatDate(stored, format) {
    const m = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/.exec(String(stored || ''));
    if (!m) return String(stored || '');
    const [y, mo, d] = [m[1], Number(m[2]), m[3] ? Number(m[3]) : 1];
    const mm = String(mo).padStart(2, '0');
    const dd = String(d).padStart(2, '0');
    switch (format) {
      case 'full': return `${y}-${mm}-${dd}`;
      case 'mm/dd/yyyy': return `${mm}/${dd}/${y}`;
      case 'year': return y;
      case 'month': return mm;
      case 'text': return `${MONTHS[mo - 1]} ${y}`;
      default: return `${mm}/${y}`;
    }
  }

  // What you typed, in the stored form: dates as YYYY-MM(-DD), yes/no for yes/no questions.
  function parseAnswer(kind, text) {
    const t = String(text || '').trim();
    if (kind === 'bool') {
      if (/^(y|yes|true|i am|i do|i will|authori[sz]ed)\b/i.test(t)) return 'yes';
      if (/^(n|no|false|i am not|i do not|i don't|i will not)\b/i.test(t)) return 'no';
      return t;
    }
    if (kind !== 'date') return t;
    let m = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/.exec(t);
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}` + (m[3] ? `-${m[3].padStart(2, '0')}` : '');
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
    if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    m = /^(\d{1,2})\/(\d{4})$/.exec(t);
    if (m) return `${m[2]}-${m[1].padStart(2, '0')}`;
    m = /^([a-z]+)\.? (\d{4})$/i.exec(t);
    if (m) {
      const idx = MONTHS.findIndex((name) => name.toLowerCase().startsWith(m[1].toLowerCase().slice(0, 3)));
      if (idx >= 0) return `${m[2]}-${String(idx + 1).padStart(2, '0')}`;
    }
    return t;
  }

  globalThis.JobScriptCanonical = { QUESTIONS, classify, get, customKey, readProfile, writeProfile, formatDate, parseAnswer, norm, similarity };
})();
