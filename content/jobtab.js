// The Job tab: on any page with a job posting (lib/jobDetect.js), the floating JobScript button
// opens the side panel on this tab. It shows the job, its match score against your master
// resume, matching skills, missing keywords, eligibility warnings and whether it's already in
// your tracker, with buttons to save it, tailor your resume, write a cover letter, find
// referrals and apply.
//
// On LinkedIn, Indeed and Glassdoor it only reads the page: no clicks, scrolling or navigation
// there. Referral searches are links you open yourself; JobScript never reads LinkedIn results.
(function () {
  if (globalThis.JobScriptJobTab) return;
  if (window.top !== window) return; // the posting and the panel belong to the top page
  const D = globalThis.JobScriptDetect;
  const P = globalThis.JobScriptPanel;
  const S = globalThis.JobScriptStorage;
  if (!D || !P || !S) return;

  const SCAN_MS = 1500;
  const SCAN_WINDOW_MS = 30000; // keep looking this long after a load or URL change (React pages)
  const DEFAULT_SCHOOL = 'California State University, Sacramento';

  let current = null; // { key, posting, info, analysis, busy, note, referrals, saved }
  let lastHref = '';
  let lookUntil = 0;
  let buttonOn = true;
  let autoShow = false;

  // After JobScript is updated or reloaded, scripts already on open pages lose their link to it.
  async function ask(message) {
    try {
      return (await chrome.runtime.sendMessage(message)) || { ok: false, error: 'No answer from JobScript.' };
    } catch (e) {
      return {
        ok: false,
        error: /context invalidated/i.test(String(e && e.message)) ? 'JobScript was updated since this page loaded. Refresh the page and try again.' : 'Couldn’t reach JobScript.',
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Finding the job

  function keyOf(p) {
    return p.url + '|' + p.title;
  }

  async function scan() {
    let posting = null;
    try {
      posting = D.detect(document, location.href);
    } catch (e) {
      posting = null;
    }
    if (!posting) {
      if (current && Date.now() > lookUntil) clear();
      return;
    }
    if (current && current.key === keyOf(posting)) {
      // The same job, still loading its description: keep the fuller copy.
      if (posting.description.length > current.posting.description.length * 1.2) {
        current.posting = posting;
        ask({ type: 'job-detected', posting });
      }
      return;
    }
    current = { key: keyOf(posting), posting, info: null, analysis: null, busy: false, note: '', referrals: false, saved: '' };
    const mine = current;
    render();
    const info = await ask({ type: 'job-detected', posting });
    if (current !== mine) return; // you moved to another job meanwhile
    mine.info = info && info.ok ? info : null;
    if (mine.info && mine.info.analyzed) mine.analysis = mine.info;
    if (mine.info && mine.info.duplicate && mine.info.duplicate.by === 'this job') mine.saved = mine.info.duplicate.status;
    if (buttonOn) P.showLauncher(onOpen, 'job');
    render();
    if (autoShow && !P.isOpen()) {
      P.openTab('job');
      onOpen();
    } else if (P.isOpen() && P.activeTab() === 'job') {
      onOpen();
    }
  }

  function clear() {
    current = null;
    P.hideLauncher('job');
    P.renderJob(null);
  }

  // The panel opened on this job: score it if it hasn't been (once per job and resume version).
  function onOpen() {
    render();
    const c = current;
    if (!c || c.busy || !c.info || !c.info.aiReady) return;
    if (!c.analysis || !c.analysis.score) analyze(false);
  }

  async function analyze(refresh) {
    const c = current;
    if (!c || c.busy) return;
    c.busy = true;
    c.note = '';
    render();
    const res = await ask({ type: 'job-analyze', url: c.posting.url, refresh });
    c.busy = false;
    if (res.ok) {
      c.analysis = res;
      if (res.cost) c.note = `Scored with Claude Haiku for about $${res.cost.toFixed(3)}. ${res.month || ''}`.trim();
    } else {
      c.note = 'Couldn’t score this job: ' + (res.error || 'no answer.');
    }
    if (current === c) render();
  }

  // ---------------------------------------------------------------------------
  // Buttons

  async function save() {
    const c = current;
    const res = await ask({ type: 'job-save', url: c.posting.url });
    if (res.ok) {
      c.saved = res.status;
      c.note = res.created ? 'Saved to your tracker.' : `Already in your tracker (${res.status}); updated its details.`;
    } else {
      c.note = 'Couldn’t save: ' + res.error;
    }
    render();
  }

  async function open(page) {
    const res = await ask({ type: 'job-open', page, url: current.posting.url });
    if (!res.ok) {
      current.note = 'Couldn’t open it: ' + res.error;
      render();
    }
  }

  // Fills the form if it's on this page; otherwise opens the application's link in a new tab.
  async function apply() {
    const c = current;
    const p = c.posting;
    // The form is on this page (Greenhouse, a careers page): fill it here. On a page without the
    // fill loaded, JobScript loads it first.
    if (p.applyHere && !p.readOnly) {
      P.openTab('apply');
      const res = await ask({ type: 'fill-self' });
      if (!res.ok) {
        c.note = 'Couldn’t fill: ' + res.error;
        P.openTab('job');
        render();
      }
      return;
    }
    if (p.applyUrl) {
      const res = await ask({ type: 'job-apply', url: p.url });
      c.note = res.ok ? 'Opened the application in a new tab. JobScript fills it there; it never submits.' : 'Couldn’t open it: ' + res.error;
    } else if (p.readOnly) {
      c.note = `This posting’s Apply button has no link JobScript can open. Press ${p.site}’s Apply button yourself; JobScript never clicks on ${p.site}.`;
    } else {
      c.note = 'No application link found on this page. Use the page’s Apply button, then JobScript can fill the form.';
    }
    render();
  }

  // ---------------------------------------------------------------------------
  // Referrals: LinkedIn people searches you open yourself, and a short note to copy.

  const SENIORITY_WORDS = /\b(senior|sr\.?|junior|jr\.?|lead|principal|staff|associate|entry[- ]level|new grad(uate)?|intern(ship)?|i{1,3}|iv|\d)\b/gi;

  function roleWords(title) {
    return String(title || '').replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').split(/\s[-–|,@]\s|,/)[0]
      .replace(SENIORITY_WORDS, ' ').replace(/\s+/g, ' ').trim() || String(title || '').trim();
  }

  function schoolShort(school) {
    if (/sacramento/i.test(school) && /state/i.test(school)) return 'Sac State';
    return school;
  }

  function referralBlocks() {
    const p = current.posting;
    const school = (current.info && current.info.school) || DEFAULT_SCHOOL;
    const company = p.company || '';
    const role = roleWords(p.title);
    const search = (q) => 'https://www.linkedin.com/search/results/people/?keywords=' + encodeURIComponent(q) + '&origin=GLOBAL_SEARCH_HEADER';
    const links = company
      ? [
        { label: `${schoolShort(school)} alumni at ${company}`, href: search(`"${school}" "${company}"`) },
        { label: `${role} people at ${company}`, href: search(`"${company}" ${role}`) },
      ]
      : [];
    const message = [
      'Hi [first name],',
      `I’m a ${schoolShort(school)} student applying for the ${p.title} role at ${company || 'your company'}.`,
      `I’d love to hear what working on the team is like. If it seems like a fit, would you be open to referring me? Thanks!`,
    ].join(' ');
    return [
      company ? { kind: 'links', title: 'Find referrals on LinkedIn', items: links } : { kind: 'note', text: 'No company name found on this page, so there’s nothing to search for.' },
      { kind: 'copy', title: `Outreach note (${message.length} characters; LinkedIn invitations allow 300)`, text: message },
      { kind: 'note', text: 'These are links you open yourself. JobScript never opens, reads or automates LinkedIn for you.' },
    ];
  }

  // ---------------------------------------------------------------------------
  // Drawing the tab

  function fmtDate(iso) {
    const d = iso ? new Date(iso) : null;
    return d && !isNaN(d) ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  }

  function duplicateWarning(dup) {
    if (!dup) return null;
    const applied = !S.NOT_APPLIED.has(dup.status);
    const when = fmtDate(dup.appliedAt || dup.createdAt);
    if (dup.by === 'this job') {
      if (applied) return { level: 'warn', text: `You already applied to this job${when ? ` on ${when}` : ''} (${dup.status}).` };
      if (dup.status === 'Filled') return { level: 'info', text: `JobScript filled this application${when ? ` on ${when}` : ''}. Mark it Applied in the tracker once you submit.` };
      return { level: 'info', text: `Saved to your tracker${when ? ` on ${when}` : ''}.` };
    }
    const same = dup.by === 'job ID' ? 'the same job ID' : 'the same company and title';
    return {
      level: applied ? 'warn' : 'info',
      text: `Looks like a job already in your tracker (${same}): ${dup.title || 'a job'} at ${dup.company || 'this company'}, ${dup.status}${when ? ` ${when}` : ''}.`,
    };
  }

  function scoreBlock(c) {
    const a = c.analysis;
    if (c.busy) return { kind: 'score', value: a && a.score ? a.score.score : null, busy: true, label: 'Match score', reason: 'Scoring with Claude Haiku against your master resume…' };
    if (a && a.score) {
      const s = a.score;
      return {
        kind: 'score',
        value: Number.isFinite(s.score) ? s.score : null,
        label: s.stale ? 'Match score (your resume changed since)' : 'Match score',
        reason: s.reason || '',
      };
    }
    if (c.info && !c.info.aiReady) return { kind: 'score', value: null, label: 'Match score', reason: 'Add your Anthropic API key on the options page to score jobs against your master resume.' };
    return { kind: 'score', value: null, label: 'Match score', reason: c.info ? 'Not scored yet.' : 'Reading the job…' };
  }

  function render() {
    const c = current;
    if (!c) return;
    const p = c.posting;
    const a = c.analysis;
    const warnings = [duplicateWarning(c.info && c.info.duplicate), ...((a && a.warnings) || [])].filter(Boolean);
    const blocks = [
      {
        kind: 'title',
        title: p.title,
        subtitle: p.company,
        meta: [[p.location, p.pay].filter(Boolean).join(' · '), [p.site, p.jobId ? 'Job ID ' + p.jobId : ''].filter(Boolean).join(' · ')],
      },
      { kind: 'warnings', title: 'Before you apply', items: warnings },
      scoreBlock(c),
      { kind: 'chips', title: 'Matching skills', items: (a && a.matching) || [], tone: 'good' },
      { kind: 'chips', title: 'Missing keywords', items: (a && a.missing) || [], tone: 'missing' },
      {
        kind: 'buttons',
        items: [
          { label: 'Apply', ariaLabel: p.applyHere ? 'Fill the application on this page' : 'Open the application in a new tab', primary: true, onClick: apply },
          c.saved
            ? { label: `In tracker: ${c.saved}`, ariaLabel: 'Open the applications tracker', onClick: () => open('tracker') }
            : { label: 'Save to tracker', ariaLabel: 'Save this job to your tracker', onClick: save },
          { label: 'Tailor resume', ariaLabel: 'Tailor your resume to this job with Claude', onClick: () => open('tailor') },
          { label: 'Write cover letter', ariaLabel: 'Write a cover letter for this job', onClick: () => open('letter') },
          { label: c.referrals ? 'Hide referrals' : 'Find referrals', ariaLabel: 'Find people to ask for a referral', onClick: () => { c.referrals = !c.referrals; render(); } },
        ],
      },
    ];
    if (c.referrals) blocks.push(...referralBlocks());
    const more = [];
    if (a && a.score && !c.busy) more.push({ label: a.score.stale ? 'Rescore' : 'Score again', ariaLabel: 'Score this job again with Claude', onClick: () => analyze(true) });
    if (c.info && !c.info.aiReady) more.push({ label: 'Options', ariaLabel: 'Open JobScript options', onClick: () => ask({ type: 'open-options' }) });
    more.push({ label: 'Company profile', ariaLabel: 'Open the company profile for this job', onClick: () => open('company') });
    blocks.push({ kind: 'buttons', title: 'More', items: more });
    if (a && a.roleSummary) blocks.push({ kind: 'note', title: 'About the role', text: a.roleSummary });
    if (c.note) blocks.push({ kind: 'note', text: c.note });
    if (p.readOnly) blocks.push({ kind: 'note', text: `JobScript only reads this page. It never clicks, scrolls or navigates on ${p.site}.` });
    P.renderJob({ blocks, applyFallback: applyBlocks(c) });
  }

  // The Apply tab on a page with no form to fill.
  function applyBlocks(c) {
    const p = c.posting;
    if (typeof globalThis.__jobscriptFill === 'function' && !p.readOnly) return null; // the fill has its own Apply tab
    const text = p.readOnly
      ? `${p.site} is a job board: JobScript fills applications on the employer’s site. ${p.applyUrl ? 'Apply opens it in a new tab.' : `Press ${p.site}’s Apply button yourself.`}`
      : 'Open the application and JobScript fills it there. It never submits.';
    return [{ kind: 'note', text }, { kind: 'buttons', items: [{ label: 'Apply', primary: true, onClick: apply }] }, ...(c.note ? [{ kind: 'note', text: c.note }] : [])];
  }

  // ---------------------------------------------------------------------------
  // Settings and the scan loop

  async function loadSettings() {
    try {
      const s = await S.getPanelSettings();
      buttonOn = s.showButton;
      autoShow = s.autoShow;
    } catch (e) {
      /* keep the defaults */
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.panelSettings) {
      loadSettings().then(() => {
        if (!buttonOn) P.hideLauncher('job');
        else if (current) P.showLauncher(onOpen, 'job');
      });
    }
    // A score or your profile changed elsewhere (another tab, the options page).
    if (current && (changes.profile || changes.applications)) {
      ask({ type: 'job-detected', posting: current.posting }).then((info) => {
        if (!current || !info || !info.ok) return;
        current.info = info;
        if (info.analyzed) current.analysis = info;
        current.saved = info.duplicate && info.duplicate.by === 'this job' ? info.duplicate.status : '';
        render();
      });
    }
  });

  function tick() {
    if (location.href !== lastHref) {
      lastHref = location.href;
      lookUntil = Date.now() + SCAN_WINDOW_MS;
      scan();
    } else if (Date.now() < lookUntil) {
      scan();
    }
  }

  // For background.js (the popup's Tailor & Fill on a board, where the fill isn't loaded).
  if (typeof globalThis.__jobscriptJobPosting !== 'function') {
    globalThis.__jobscriptJobPosting = async () => {
      const p = D.detect(document, location.href);
      return p ? { title: p.title, company: p.company, url: p.url, site: p.site, companyDomain: '', description: p.description, location: p.location, pay: p.pay, jobId: p.jobId, applyUrl: p.applyUrl, hasForm: false } : null;
    };
  }

  globalThis.JobScriptJobTab = { scan, current: () => current };

  (async () => {
    if (!document.body) await new Promise((r) => document.addEventListener('DOMContentLoaded', r, { once: true }));
    await loadSettings();
    tick();
    setInterval(tick, SCAN_MS);
  })();
})();
