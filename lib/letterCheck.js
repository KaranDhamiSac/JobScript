// Checks a cover letter against its sources, like the resume tailoring rules in lib/ai.js:
// experience and numbers may only come from your master resume, and facts about the company
// only from its company profile (items with a source, or added by you). Anything that doesn't
// trace back is flagged for you to fix; nothing is changed silently.
//
// Loaded by background.js (to flag a fresh letter) and the cover letter page (to re-check as
// you edit), and by Node tests.
(function () {
  const STOP = new Set(('a an and are as at be been but by for from has have i in into is it its me my of on or our so that the their them they this to us was we were what when which who will with you your i\'m i\'ve i\'d about also am can could would should more most very just than then there these those through while where how why all any each other such only own same too both few many much some over under again further once here out up down off above below between during before after because until against among per via within without across'
  ).split(/\s+/));

  // Words that are capitalized in letters without naming anything.
  const LETTER_WORDS = new Set(('dear hiring manager team sincerely regards best thank thanks kind warm respectfully yours i monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december'
  ).split(/\s+/));

  // Experience claims: "I built…", "my work on…".
  const EXPERIENCE_CUE = /\b(i|i've|i have|i've been|my)\b[^.?!]*\b(built|build|led|lead|created|developed|managed|designed|analy[sz]ed|improved|reduced|increased|launched|wrote|worked|implemented|automated|delivered|shipped|maintained|trained|taught|organized|experience|internship|role as|project)\b/i;
  // Statements about the company: its mission, values, products, news or culture.
  const COMPANY_CUE = /\b(mission|values?|believe|believes|products?|platform|services?|launch(ed|es)?|recent(ly)?|announce(d|ment)|news|culture|committed|commitment|customers|award|growth|grow(ing|n)|raised|acquired|founded|expan(ded|sion|ding)|serves?|serving|focus on|known for|dedicat(ed|ion)|approach)\b/i;

  function norm(s) {
    return String(s || '').toLowerCase().replace(/[’']/g, "'");
  }

  function contentWords(text, extraStop) {
    return [...new Set((norm(text).match(/[a-z0-9][a-z0-9'+#.-]*[a-z0-9+#]|[a-z0-9]/g) || [])
      .filter((w) => w.length > 2 && !STOP.has(w) && !(extraStop && extraStop.has(w))))];
  }

  // Share of a sentence's content words that appear in the source (0 to 1).
  function support(sentence, source, extraStop) {
    const words = contentWords(sentence, extraStop);
    if (!words.length) return 1;
    const src = norm(source);
    return words.filter((w) => src.includes(w.replace(/s$/, ''))).length / words.length;
  }

  function sentences(text) {
    return String(text || '')
      .split(/\n+/)
      .flatMap((p) => p.split(/(?<=[.!?])\s+(?=[A-Z“"(])/))
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // Numbers that make a claim: counts, percentages, amounts. Years and small spelled-out-ish
  // numbers like "one" aren't digits and aren't checked.
  function metrics(text) {
    return (String(text).match(/[$€£]?\d[\d,.]*\s?(%|\+|x\b|k\b|m\b|million|billion)?/gi) || [])
      .map((m) => m.toLowerCase().replace(/\s+/g, '').replace(/[.,]$/, ''))
      .filter((m) => !/^(19|20)\d\d$/.test(m));
  }

  function hasTerm(text, term) {
    const escaped = norm(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, 'i').test(norm(text));
  }

  // Words that might name a tool, product, place or organisation: tech-looking tokens anywhere,
  // and capitalized words that don't start a sentence.
  function namedTerms(sentence) {
    const words = sentence.match(/[A-Za-z][A-Za-z0-9.+#/&'’-]*/g) || [];
    const out = [];
    words.forEach((raw, i) => {
      const w = raw.replace(/[.'’/-]+$/, '').replace(/['’]s$/, '');
      if (!w || LETTER_WORDS.has(w.toLowerCase())) return;
      const techy = /[A-Z].*[A-Z]|[0-9+#]|\.[a-z]{2,}$/.test(w) || /^[A-Z][a-z]+[A-Z]/.test(w);
      const proper = i > 0 && /^[A-Z]/.test(w);
      if ((techy || proper) && !out.includes(w)) out.push(w);
    });
    return out;
  }

  // Plain text of everything in your master resume (never contact details).
  function resumeCorpus(profile) {
    const p = profile || {};
    return [
      ...(p.workHistory || []).flatMap((j) => [j.employer, j.title, j.location, ...(j.bullets || [])]),
      ...(p.projects || []).flatMap((x) => [x.name, x.subtitle, x.tech, ...(x.bullets || [])]),
      ...(p.education || []).flatMap((e) => [e.school, e.degree, e.major]),
      p.skills,
    ].filter(Boolean).join('\n');
  }

  function companyCorpus(company) {
    const c = company || {};
    return ['mission', 'values', 'products', 'news', 'culture'].flatMap((sec) => (c[sec] || []).map((it) => it.text)).join('\n');
  }

  // ctx: { profile, company, companyName, role, jobText }
  // Returns [{ type: 'number' | 'term' | 'company' | 'experience', text, sentence, message }].
  function check(letter, ctx) {
    const resume = resumeCorpus(ctx.profile);
    const companyText = companyCorpus(ctx.company);
    const companyName = String(ctx.companyName || '').trim();
    const role = String(ctx.role || '');
    const jobText = String(ctx.jobText || '');
    const nameWords = new Set(contentWords(companyName + ' ' + role));
    const companyItems = ['mission', 'values', 'products', 'news', 'culture'].flatMap((sec) => (ctx.company && ctx.company[sec]) || []);
    const flags = [];
    const seen = new Set();
    const flag = (f) => {
      const key = f.type + '|' + f.text;
      if (seen.has(key)) return;
      seen.add(key);
      flags.push(f);
    };

    for (const s of sentences(letter)) {
      for (const m of metrics(s)) {
        const bare = m.replace(/[$€£,+%]/g, '');
        if (metrics(resume).some((r) => r.replace(/[$€£,+%]/g, '') === bare)) continue;
        if (metrics(companyText).some((r) => r.replace(/[$€£,+%]/g, '') === bare)) continue;
        flag({ type: 'number', text: m, sentence: s, message: `“${m}” isn’t in your master resume or the company profile.` });
      }

      for (const t of namedTerms(s)) {
        if (hasTerm(resume, t) || hasTerm(companyText, t) || hasTerm(companyName, t) || hasTerm(role, t)) continue;
        flag({
          type: 'term',
          text: t,
          sentence: s,
          message: hasTerm(jobText, t)
            ? `“${t}” comes from the posting but isn’t in your resume. Make sure the letter doesn’t claim you have it.`
            : `“${t}” isn’t in your resume, the company profile or the posting.`,
        });
      }

      const aboutCompany = (companyName && hasTerm(s, companyName)) || /\byour (company|team|mission|values|work|product|platform|customers)\b/i.test(s);
      if (aboutCompany && COMPANY_CUE.test(s)) {
        const best = companyItems.reduce((m, it) => Math.max(m, support(s, it.text, nameWords)), 0);
        if (best < 0.35) {
          flag({ type: 'company', text: s, sentence: s, message: `This says something about ${companyName || 'the company'} that isn’t in its company profile.` });
        }
      }

      if (EXPERIENCE_CUE.test(s) && !aboutCompany && support(s, resume + '\n' + role, nameWords) < 0.3) {
        flag({ type: 'experience', text: s, sentence: s, message: 'This experience doesn’t clearly come from your master resume.' });
      }
    }
    return flags;
  }

  globalThis.JobScriptLetterCheck = { check, resumeCorpus, companyCorpus, sentences, metrics, namedTerms, support };
})();
