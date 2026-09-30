// Turns resume text lines into a draft profile. Pure functions, no browser APIs, so it can be
// unit-tested in Node. Heuristic by nature: the options page always shows the result for
// review before anything is saved.
//
// parseResume(lines) -> { contact, workHistory, education, skills }
// Degree patterns come from lib/fieldMap.js (globalThis.FieldMap.degrees) when it is loaded.

const MON = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';
const DATE = `(?:${MON}\\s*,?\\s*\\d{4}|\\d{1,2}\\/\\d{4}|\\d{4})`;
const END = `(?:${DATE}|present|current|now|today)`;
const RANGE_RE = new RegExp(`(${DATE})\\s*(?:-|–|—|to|until)\\s*(${END})`, 'i');
const SINGLE_DATE_RE = new RegExp(`(${MON}\\s*,?\\s*\\d{4}|\\d{1,2}\\/\\d{4})`, 'i');
const YEAR_RE = /\b(19[5-9]\d|20\d\d)\b/;

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/;
const LINKEDIN_RE = /(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[A-Za-z0-9_%-]+\/?/i;
const GITHUB_RE = /(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9_-]+\/?/i;
const URL_RE = /\b(?:https?:\/\/)?(?:[a-z0-9-]+\.)+(?:com|dev|io|me|net|org|app|site|xyz|co|ai|tech|page)(?:\/[^\s|,]*)?/gi;
const CITY_STATE_RE = /\b([A-Z][A-Za-z.' -]{1,40}?),\s*([A-Z]{2})\b(?:\s+(\d{5})(?:-\d{4})?)?/;
const STREET_RE = /\b\d{1,6}\s+[A-Za-z0-9.' -]{2,40}?\s(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|way|court|ct|place|pl|circle|cir|parkway|pkwy|terrace|ter)\b\.?(?:\s*(?:apt|unit|#)\s*[\w-]+)?/i;
const BULLET_RE = /^[•●▪◦‣∙·*–-]\s*/;
const SEPARATOR_RE = /\s+[|•·]\s+|\s+[–—-]\s+|\t+|\s{3,}/;

const SECTION_HEADINGS = {
  work: ['experience', 'work experience', 'professional experience', 'employment', 'employment history',
    'relevant experience', 'work history', 'career history', 'internships', 'internship experience'],
  education: ['education', 'academic background', 'education and training', 'academics', 'education & training'],
  skills: ['skills', 'technical skills', 'skills and interests', 'skills & interests', 'core competencies',
    'technologies', 'tools', 'skills and tools', 'technical proficiencies', 'languages and tools', 'skills & tools'],
  other: ['projects', 'personal projects', 'academic projects', 'certifications', 'certificates', 'awards',
    'honors', 'honors and awards', 'leadership', 'activities', 'volunteer', 'volunteer experience',
    'publications', 'interests', 'summary', 'objective', 'profile', 'about me', 'coursework',
    'relevant coursework', 'references', 'extracurricular activities', 'involvement'],
};

const TITLE_WORDS = /\b(engineer|developer|intern|internship|manager|analyst|assistant|associate|specialist|coordinator|designer|consultant|director|lead|scientist|technician|representative|tutor|researcher|administrator|officer|cashier|sales|teacher|volunteer|architect|programmer|clerk|advisor|aide|fellow|president|founder|owner|head|supervisor|agent|editor|writer|instructor|mentor|ambassador|barista|server)\b/i;
const SCHOOL_WORDS = /\b(university|college|institute|school|academy|polytechnic|conservatory)\b/i;

function clean(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function stripBullet(s) {
  return clean(s.replace(BULLET_RE, ''));
}

function titleCase(s) {
  return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

function headingKind(line) {
  const t = clean(line).toLowerCase().replace(/[:：]$/, '').replace(/[^a-z& ]/g, '').trim();
  if (!t || t.length > 40) return null;
  for (const [kind, names] of Object.entries(SECTION_HEADINGS)) if (names.includes(t)) return kind;
  return null;
}

// "May 2026" / "05/2026" / "2026" -> "2026-05". fallbackMonth is used when only a year is known.
function toYearMonth(token, fallbackMonth) {
  if (!token) return '';
  const t = token.toLowerCase();
  let m = t.match(/^(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[2]}-${m[1].padStart(2, '0')}`;
  m = t.match(/([a-z]+)\.?\s*,?\s*(\d{4})/);
  if (m) {
    const idx = MONTHS.indexOf(m[1].slice(0, 3));
    if (idx >= 0) return `${m[2]}-${String(idx + 1).padStart(2, '0')}`;
  }
  m = t.match(/(\d{4})/);
  return m ? `${m[1]}-${fallbackMonth}` : '';
}

function isPresent(token) {
  return /present|current|now|today/i.test(token || '');
}

function splitParts(line) {
  return line
    .split(SEPARATOR_RE)
    .map((p) => clean(p).replace(/^[,|•·–—-]+|[,|•·–—-]+$/g, '').trim())
    .filter(Boolean);
}

function stateAbbr(name) {
  const states = (globalThis.FieldMap && globalThis.FieldMap.US_STATES) || {};
  const hit = Object.entries(states).find(([, full]) => full.toLowerCase() === name.toLowerCase());
  return hit ? hit[0] : '';
}

function findLocation(text) {
  const m = text.match(CITY_STATE_RE);
  if (m) return { city: clean(m[1]), state: m[2], zip: m[3] || '', match: m[0] };
  const states = (globalThis.FieldMap && globalThis.FieldMap.US_STATES) || {};
  for (const full of Object.values(states)) {
    const re = new RegExp(`\\b([A-Z][A-Za-z.' -]{1,40}?),\\s*${full}\\b`);
    const hit = text.match(re);
    if (hit) return { city: clean(hit[1]), state: stateAbbr(full), zip: '', match: hit[0] };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Contact

function parseContact(headerLines, allText) {
  const contact = {};
  const email = allText.match(EMAIL_RE);
  if (email) contact.email = email[0];
  const withoutEmail = allText.replace(new RegExp(EMAIL_RE.source, 'gi'), ' ');
  const phone = withoutEmail.match(PHONE_RE);
  if (phone) contact.phone = clean(phone[0]);
  const li = allText.match(LINKEDIN_RE);
  if (li) contact.linkedin = li[0].replace(/^(?!https?:\/\/)/, 'https://').replace(/\/$/, '');
  const gh = allText.match(GITHUB_RE);
  if (gh) contact.github = gh[0].replace(/^(?!https?:\/\/)/, 'https://').replace(/\/$/, '');

  const header = headerLines.join('\n');
  const headerNoEmail = header.replace(new RegExp(EMAIL_RE.source, 'gi'), ' ');
  const urls = (headerNoEmail.match(URL_RE) || []).filter((u) => !/linkedin\.com|github\.com/i.test(u));
  if (urls.length) contact.portfolio = urls[0].replace(/^(?!https?:\/\/)/, 'https://').replace(/\/$/, '');

  for (const line of headerLines.slice(0, 6)) {
    const t = clean(line);
    if (!t || /[@\d]|resume|curriculum/i.test(t) || headingKind(t)) continue;
    const words = t.split(' ');
    if (words.length < 2 || words.length > 4) continue;
    if (!words.every((w) => /^[A-Za-z][A-Za-z.'-]*$/.test(w))) continue;
    const name = t === t.toUpperCase() ? titleCase(t) : t;
    const parts = name.split(' ');
    contact.firstName = parts[0];
    contact.lastName = parts[parts.length - 1];
    break;
  }

  const street = header.match(STREET_RE);
  if (street) contact.address = clean(street[0]);
  const loc = findLocation(headerNoEmail);
  if (loc) {
    contact.city = loc.city.replace(/^.*\d+\s+[A-Za-z .]+\s(st|ave|rd|blvd|dr|ln|way|ct|pl)\.?\s*,?\s*/i, '');
    contact.state = loc.state;
    if (loc.zip) contact.zip = loc.zip;
  }
  return contact;
}

// ---------------------------------------------------------------------------
// Sections

function splitSections(lines) {
  const sections = { header: [], work: [], education: [], skills: [], other: [] };
  let current = 'header';
  for (const line of lines) {
    const kind = headingKind(line);
    if (kind) {
      current = kind;
      continue;
    }
    sections[current].push(line);
  }
  return sections;
}

// Groups lines into { head: [...non-bullet lines], body: [...bullet lines] } blocks.
function blocks(lines) {
  const out = [];
  let cur = null;
  for (const raw of lines) {
    const line = String(raw || '').trim();
    if (!line) continue;
    const bullet = BULLET_RE.test(line);
    const continuation = cur && cur.body.length && /^[a-z(]/.test(line);
    if (bullet || continuation) {
      if (!cur) cur = { head: [], body: [] };
      if (continuation && !bullet) cur.body[cur.body.length - 1] += ' ' + clean(line);
      else cur.body.push(stripBullet(line));
    } else {
      if (!cur || cur.body.length) {
        cur = { head: [], body: [] };
        out.push(cur);
      }
      cur.head.push(line);
    }
  }
  if (cur && !out.includes(cur)) out.push(cur);
  return out;
}

function parseWork(lines) {
  const entries = [];
  for (const block of blocks(lines)) {
    // A head with several date ranges holds several roles; split after each dated line.
    const groups = [];
    let group = [];
    for (const line of block.head) {
      group.push(line);
      if (RANGE_RE.test(line)) {
        groups.push(group);
        group = [];
      }
    }
    // Lines after the last date that read like sentences are description, not header.
    const prose = [];
    while (groups.length && group.length && (/\.$/.test(clean(group[group.length - 1])) || clean(group[group.length - 1]).length > 70)) {
      prose.unshift(clean(group.pop()));
    }
    if (group.length) {
      if (groups.length) groups[groups.length - 1].push(...group);
      else groups.push(group);
    }
    block.body.unshift(...prose);

    groups.forEach((head, gi) => {
      const entry = { employer: '', title: '', location: '', startDate: '', endDate: '', current: false, supervisorName: '', supervisorPhone: '', description: '' };
      const parts = [];
      for (const line of head) {
        let rest = line;
        const range = line.match(RANGE_RE);
        if (range) {
          entry.startDate = toYearMonth(range[1], '01');
          entry.current = isPresent(range[2]);
          entry.endDate = entry.current ? '' : toYearMonth(range[2], '12');
          rest = rest.replace(range[0], ' ');
        }
        const loc = rest.match(CITY_STATE_RE) || rest.match(/\bremote\b/i);
        if (loc && !entry.location) {
          entry.location = clean(loc[0]);
          rest = rest.replace(loc[0], ' ');
        }
        for (const p of splitParts(rest)) {
          const at = p.match(/^(.+?)\s+at\s+(.+)$/i);
          if (at) parts.push(at[1], at[2]);
          else parts.push(...p.split(/,\s+(?=[A-Z])/).map(clean));
        }
      }
      const useful = parts.filter((p) => p && !/^[,|•·–—-]+$/.test(p));
      const titleIdx = useful.findIndex((p) => TITLE_WORDS.test(p));
      if (titleIdx >= 0) entry.title = useful[titleIdx];
      entry.employer = useful.find((p, i) => i !== titleIdx) || '';
      if (!entry.title && useful.length > 1) entry.title = useful.find((p) => p !== entry.employer) || '';
      if (gi === groups.length - 1) entry.description = block.body.join('\n');
      if (entry.employer || entry.title) entries.push(entry);
    });
  }
  return entries;
}

function degreeInfo(line) {
  const levels = globalThis.FieldMap && globalThis.FieldMap.degrees ? globalThis.FieldMap.degrees.levels : [];
  for (const level of levels) {
    for (const re of level.patterns) {
      const m = line.match(re);
      if (!m) continue;
      let start = m.index;
      let degree = m[0];
      // Expand "Bachelor" to "Bachelor of Science" and "Master's" to "Master's Degree".
      const after = line.slice(start + degree.length);
      const ext = after.match(/^('?s)?(\s+of\s+(fine arts|business administration|science|arts|engineering|education|public health|social work|laws))?(\s+degree)?/i);
      if (ext) degree += ext[0];
      degree = clean(degree);
      let rest = clean(line.slice(start + degree.length).replace(/^[,:|–—-]?\s*(in\s+)?/i, ''));
      rest = rest.replace(RANGE_RE, '').replace(SINGLE_DATE_RE, '').replace(/\bgpa\b.*$/i, '');
      rest = rest.replace(/[,;]?\s*minor\b.*$/i, '').replace(/\bexpected\b.*$/i, '').replace(YEAR_RE, '');
      const major = clean(splitParts(rest)[0] || '').replace(/[,.;]$/, '');
      return { degree, major: major.length <= 60 ? major : '' };
    }
  }
  return null;
}

function parseEducation(lines) {
  const entries = [];
  let cur = null;
  const blank = () => ({ school: '', degree: '', major: '', gpa: '', location: '', startDate: '', gradDate: '' });
  for (const raw of lines) {
    const spaced = String(raw || '').replace(BULLET_RE, '').trim();
    const line = clean(spaced);
    if (!line) continue;
    const parts = splitParts(spaced);
    const schoolPart = parts.find((p) => SCHOOL_WORDS.test(p));
    if (schoolPart && (!cur || cur.school)) {
      cur = blank();
      entries.push(cur);
    }
    if (!cur) {
      cur = blank();
      entries.push(cur);
    }
    if (schoolPart && !cur.school) cur.school = schoolPart.replace(CITY_STATE_RE, '').replace(/[,–—-]\s*$/, '').trim();
    const deg = !cur.degree && degreeInfo(line);
    if (deg) {
      cur.degree = deg.degree;
      if (deg.major) cur.major = deg.major;
    }
    const gpa = line.match(/\bgpa\b[:\s]*([0-4]\.\d{1,2})/i) || line.match(/\b([0-4]\.\d{1,2})\s*\/\s*4\.0+\b/);
    if (gpa && !cur.gpa) cur.gpa = gpa[1];
    const locPart = parts.find((p) => p !== schoolPart && CITY_STATE_RE.test(p));
    const loc = (locPart || (parts.length === 1 ? '' : line)).match(CITY_STATE_RE);
    if (loc && !cur.location) cur.location = clean(loc[0].replace(/\s+\d{5}.*/, ''));
    const range = line.match(RANGE_RE);
    if (range) {
      cur.startDate = toYearMonth(range[1], '08');
      if (!isPresent(range[2])) cur.gradDate = toYearMonth(range[2], '05');
    } else if (!cur.gradDate) {
      const single = line.match(SINGLE_DATE_RE);
      if (single) cur.gradDate = toYearMonth(single[1], '05');
      else if (deg || schoolPart) {
        const year = line.match(YEAR_RE);
        if (year) cur.gradDate = `${year[1]}-05`;
      }
    }
  }
  return entries.filter((e) => e.school || e.degree);
}

function parseSkills(lines) {
  const seen = new Set();
  const out = [];
  for (const raw of lines) {
    const line = stripBullet(raw).replace(/^[A-Za-z &/]{2,30}:\s*/, '');
    for (const piece of line.split(/[,•|;·]|\s{2,}/)) {
      const s = clean(piece).replace(/\.$/, '');
      if (!s || s.length > 40) continue;
      const key = s.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s);
    }
  }
  return out.slice(0, 60).join(', ');
}

export function parseResume(lines) {
  const cleanLines = lines.map((l) => String(l || '').replace(/ /g, ' ').trimEnd());
  const sections = splitSections(cleanLines);
  const allText = cleanLines.join('\n');
  const headerLines = sections.header.length ? sections.header.slice(0, 10) : cleanLines.slice(0, 10);
  return {
    contact: parseContact(headerLines, allText),
    workHistory: parseWork(sections.work),
    education: parseEducation(sections.education),
    skills: parseSkills(sections.skills),
  };
}

export const _test = { toYearMonth, headingKind, degreeInfo, splitParts, RANGE_RE };
