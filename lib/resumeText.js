// Turns pasted resume or cover letter text (from Jobright, a Claude chat, a text editor…) into
// the shapes tailor/resume-pdf.js builds PDFs from. Plain rules, no AI call, nothing sent anywhere.
//
// parseResume(text) -> { sections: [{ heading, entries: [{ left, right, sub, subRight, bullets }] }
//                                   | { heading, lines: [] }], skippedHeader: [] }
//   Lines before the first section heading are the pasted name and contact details; they're
//   dropped (the PDF gets yours from your profile) and returned in skippedHeader.
// parseLetter(text) -> { greeting, paragraphs }
//   Drops a date or address before the greeting and the sign-off after the letter; the PDF adds
//   its own.
(function () {
  if (globalThis.JobScriptResumeText) return;

  // Known headings, each as a regex on the cleaned line. Sections in LINE_SECTIONS are plain
  // lines (skills, a summary); the rest are entries with a title line and bullets.
  const HEADINGS = [
    ['summary', /^(professional |career )?(summary|profile|objective|about( me)?)$/i],
    ['education', /^education(al background)?$/i],
    ['experience', /^((work|professional|relevant|employment|industry|research) )?(experience|history)$/i],
    ['projects', /^((personal|selected|technical|academic|notable) )?projects?$/i],
    ['skills', /^((technical|core|key|relevant) )?(skills|competencies|technologies|tools|stack)( ?(&|and|\/) ?\w+)?$/i],
    ['certifications', /^(certifications?|licenses?|certificates?|credentials)( ?(&|and) ?\w+)?$/i],
    ['awards', /^(awards|honors|honours|achievements|accomplishments)( ?(&|and) ?\w+)?$/i],
    ['leadership', /^(leadership|activities|extracurriculars?|volunteer(ing)?( work)?|involvement|community)( ?(&|and) ?\w+)?$/i],
    ['publications', /^publications?$/i],
    ['languages', /^languages?$/i],
    ['interests', /^(interests|hobbies)( ?(&|and) ?\w+)?$/i],
  ];
  const LINE_SECTIONS = new Set(['summary', 'skills', 'certifications', 'awards', 'languages', 'interests', 'publications']);

  const BULLET_RE = /^\s*(?:[•\-–—*·▪◦‣○●■]|\d+[.)])\s+/;
  const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
  const DATE = `(?:${MONTH}\\s+\\d{4}|\\d{1,2}\\/\\d{4}|\\d{4})`;
  const END = '(?:present|current|now|ongoing|today)';
  // "May 2024 – Present", "2022-2026", "Expected May 2027", "May 2027 (expected)", "Summer 2025"
  const DATES_AT_END = new RegExp(
    `((?:expected|anticipated|exp\\.)\\s+${DATE}|${DATE}\\s*\\((?:expected|anticipated)\\)|(?:summer|fall|spring|winter)\\s+\\d{4}` +
      `|${DATE}\\s*(?:[-–—]|to|–)\\s*(?:${DATE}|${END})|${DATE}|${END})\\s*$`,
    'i'
  );

  // Markdown and decoration that chat output and copied PDFs carry.
  function cleanLine(raw) {
    return String(raw || '')
      .replace(/ /g, ' ')
      .replace(/^\s*#{1,6}\s+/, '')
      .replace(/\*\*|__/g, '')
      .replace(/^\s*[-=_~*]{3,}\s*$/, '')
      .replace(/\s+$/, '');
  }

  function headingOf(line) {
    const t = line.trim().replace(/^[-=—–|#* ]+|[-=—–|#*: ]+$/g, '').trim();
    if (!t || t.length > 40) return null;
    for (const [key, re] of HEADINGS) if (re.test(t)) return { key, text: t };
    // A short line in capitals, letters only: a heading we don't know by name.
    const words = t.split(/\s+/);
    if (words.length <= 4 && /^[A-Z][A-Z &/]+$/.test(t)) return { key: 'other', text: t };
    return null;
  }

  // "Software Engineer Intern    June 2025 – Present" -> left and right. A tab or a run of two
  // or more spaces splits first; otherwise dates at the end of the line move right.
  function splitRight(line) {
    const t = line.trim();
    const gap = t.split(/\t+| {2,}/).map((s) => s.trim()).filter(Boolean);
    if (gap.length >= 2) {
      const right = gap.pop();
      return { left: gap.join(' · '), right };
    }
    const m = t.match(DATES_AT_END);
    if (m && m.index > 0) {
      const left = t.slice(0, m.index).replace(/[\s,|–—-]+$/, '').trim();
      if (left) return { left, right: m[1].trim() };
    }
    return { left: t, right: '' };
  }

  function looksLikeContact(line) {
    return /@|https?:\/\/|linkedin\.com|github\.com|\(\d{3}\)|\d{3}[-. ]\d{3}[-. ]\d{4}|\bphone\b|\bemail\b/i.test(line);
  }

  function parseResume(text) {
    const lines = String(text || '').split(/\r?\n/).map(cleanLine);
    const sections = [];
    const skippedHeader = [];
    let section = null;
    let entry = null;
    let sawHeading = false;
    let preamble = [];

    const startSection = (h) => {
      section = LINE_SECTIONS.has(h.key) ? { heading: h.text, lines: [] } : { heading: h.text, entries: [] };
      sections.push(section);
      entry = null;
    };

    for (const raw of lines) {
      const line = raw.trim();
      if (!line) {
        entry = null; // a blank line ends the entry
        continue;
      }
      const h = headingOf(line);
      if (h) {
        if (!sawHeading) {
          // Everything above the first heading: your name and contact details, or a summary.
          const summary = preamble.filter((l, i) => i > 0 && !looksLikeContact(l) && l.split(/\s+/).length > 6);
          skippedHeader.push(...preamble.filter((l) => !summary.includes(l)));
          if (summary.length) sections.push({ heading: 'Summary', lines: [summary.join(' ')] });
          preamble = [];
        }
        sawHeading = true;
        startSection(h);
        continue;
      }
      if (!sawHeading) {
        preamble.push(line);
        continue;
      }
      const bullet = BULLET_RE.test(line);
      const body = line.replace(BULLET_RE, '').trim();
      if (section.lines) {
        if (body) section.lines.push(body);
        continue;
      }
      if (bullet) {
        if (!entry) {
          entry = { left: '', right: '', sub: '', subRight: '', bullets: [] };
          section.entries.push(entry);
        }
        if (body) entry.bullets.push(body);
        continue;
      }
      // A title line. The next plain line (before any bullet) is its subtitle: the company and
      // location under a job title, or the degree under a school.
      if (entry && !entry.bullets.length && entry.left && !entry.sub) {
        const s = splitRight(line);
        entry.sub = s.left;
        entry.subRight = s.right;
        continue;
      }
      const s = splitRight(line);
      entry = { left: s.left, right: s.right, sub: '', subRight: '', bullets: [] };
      section.entries.push(entry);
    }

    if (!sawHeading && preamble.length) {
      // No headings at all: keep every line, bullets and all, under one heading.
      const entries = [];
      let e = null;
      for (const line of preamble) {
        if (BULLET_RE.test(line)) {
          if (!e) entries.push((e = { left: '', right: '', sub: '', subRight: '', bullets: [] }));
          e.bullets.push(line.replace(BULLET_RE, '').trim());
        } else {
          const s = splitRight(line);
          entries.push((e = { left: s.left, right: s.right, sub: '', subRight: '', bullets: [] }));
        }
      }
      sections.push({ heading: 'Resume', entries });
    }
    // Drop entries with nothing on them, and sections left empty.
    for (const s of sections) if (s.entries) s.entries = s.entries.filter((e) => e.left || e.sub || e.bullets.length);
    return { sections: sections.filter((s) => (s.lines ? s.lines.length : s.entries.length)), skippedHeader };
  }

  // ---------------------------------------------------------------------------

  const GREETING_RE = /^(dear\b|hi\b|hello\b|to whom it may concern|hiring (team|manager),)/i;
  const SIGNOFF_RE = /^(best regards|kind regards|warm regards|yours sincerely|yours truly|all the best|thank you|sincerely|respectfully|regards|warmly|thanks|cheers|best)[,.!]?(?=\s|$)/i;
  // "Testy McTestface": up to five capitalised words, no sentence punctuation.
  const nameLike = (s) => {
    const words = s.trim().split(/\s+/);
    return words.length <= 5 && words.every((w) => /^[A-Z]/.test(w)) && !/[.!?,]$/.test(s.trim());
  };
  // "Sincerely," alone, or with the name after it on the same line or the next: not a sentence
  // that starts with the phrase ("Thank you for your time.").
  const signoff = (b) => {
    if (b.length >= 80) return false;
    const m = b.match(SIGNOFF_RE);
    if (!m) return false;
    const rest = b.slice(m[0].length).replace(/\s+/g, ' ').trim();
    return !rest || nameLike(rest);
  };

  function parseLetter(text) {
    const blocks = String(text || '')
      .replace(/ /g, ' ')
      .split(/\n\s*\n/)
      .map((b) => b.split(/\r?\n/).map(cleanLine).join('\n').trim())
      .filter(Boolean);
    let greeting = '';
    const at = blocks.findIndex((b) => GREETING_RE.test(b.split('\n')[0]));
    if (at >= 0) {
      // The greeting, and the first paragraph if it was pasted on the next line of the same block.
      const parts = blocks[at].split('\n');
      greeting = parts.shift().trim();
      blocks.splice(0, at + 1, ...(parts.join(' ').trim() ? [parts.join(' ').trim()] : []));
    } else {
      // Without a greeting, a date, an address or a "Re:" line on top still goes.
      while (blocks.length && (blocks[0].split('\n').length > 1 && blocks[0].length < 160 || /^(re|subject):/i.test(blocks[0]) || DATES_AT_END.test(blocks[0]) && blocks[0].length < 40)) blocks.shift();
    }
    // The sign-off, with the name in the same block or the one after it.
    for (let changed = true; changed && blocks.length > 1; ) {
      const last = blocks[blocks.length - 1];
      changed = signoff(last) || (!last.includes('\n') && nameLike(last) && signoff(blocks[blocks.length - 2]));
      if (changed) blocks.pop();
    }
    const paragraphs = blocks.map((b) => b.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
    // A sign-off typed as the last line of the last paragraph.
    if (paragraphs.length) {
      const l = paragraphs[paragraphs.length - 1];
      const m = l.match(/\s(sincerely|best regards|kind regards|warm regards|regards|thank you),?\s+[A-Z][a-z]+(\s[A-Z][a-z]+)*\.?$/);
      if (m) paragraphs[paragraphs.length - 1] = l.slice(0, m.index).trim();
    }
    return { greeting: greeting || 'Dear Hiring Team,', paragraphs };
  }

  globalThis.JobScriptResumeText = { parseResume, parseLetter, _test: { headingOf, splitRight, cleanLine } };
})();
