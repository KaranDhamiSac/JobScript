// Test harness for the Job tab: stands in for background.js's job-* messages with scripted
// answers, so the tab can be checked on a local page. window.__jobMessages records what the tab
// sent. Load after dev/stub.js and before content/jobtab.js.
(function () {
  window.__jobMessages = [];
  const analysis = {
    ok: true, analyzed: true, cost: 0.004, month: 'This month: $0.42 of your $10.00 cap.',
    roleSummary: 'Run events and social channels for a small consultancy.',
    matching: ['Google Analytics', 'Writing', 'Event planning'],
    missing: ['HubSpot', 'Canva'],
    warnings: [
      { level: 'warn', text: 'Asks for 2+ years of experience (“2+ years in marketing”); your resume shows about 1.3 (internships included).' },
      { level: 'info', text: 'Onsite in Denver, CO; you’re in Sacramento, CA (you’re open to relocating).' },
    ],
    score: { score: 72, reason: 'Strong writing and analytics; light on marketing tools like HubSpot.', items: [], stale: false },
  };
  const answers = {
    'job-detected': () => ({ ok: true, aiReady: true, duplicate: window.__jobDuplicate || null, hasLetter: false, school: 'California State University, Sacramento' }),
    'job-analyze': () => new Promise((r) => setTimeout(() => r(analysis), 600)),
    'job-save': () => ({ ok: true, created: true, status: 'Saved' }),
    'job-open': () => ({ ok: true }),
    'job-apply': () => ({ ok: true }),
    'open-options': () => ({ ok: true }),
  };
  window.chrome.runtime = window.chrome.runtime || {};
  // Other messages go to whatever answered them before (dev/agent-harness.js in the bundle).
  const previous = window.chrome.runtime.sendMessage;
  window.chrome.runtime.sendMessage = async (msg) => {
    const fn = answers[msg && msg.type];
    if (!fn) return previous ? previous(msg) : { ok: false, error: 'Not in the test harness.' };
    window.__jobMessages.push(msg);
    return fn(msg);
  };
})();
