// Tests for resume tailoring in lib/ai.js: the job breakdown feeding keywords, and the summary
// the company profile may shape (never the bullets). Fake fetch, no network.
// Run with: node dev/test-tailoring.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../lib/ai.js');
const AI = globalThis.JobScriptAI;

let passed = 0;
const test = async (name, fn) => {
  await fn();
  passed++;
  console.log('ok -', name);
};

function mockApi(reply) {
  const requests = [];
  globalThis.fetch = async (url, opts) => {
    requests.push(JSON.parse(opts.body));
    return { ok: true, status: 200, json: async () => ({ model: 'claude-sonnet-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(reply) }], usage: { input_tokens: 3000, output_tokens: 800 } }) };
  };
  return requests;
}

// Made-up applicant; no real resume details.
const profile = {
  firstName: 'Testy', lastName: 'McTestface', email: 'testy@example.com', skills: 'SQL, Python, Tableau',
  workHistory: [{ employer: 'Northwind Logistics', title: 'Operations Analyst Intern', startDate: '2025-06', endDate: '2025-12', bullets: ['Built a Tableau dashboard that cut weekly reporting time by 40%', 'Wrote SQL queries to track 1,200 daily deliveries'] }],
  projects: [], education: [{ school: 'Sample State University', degree: 'BS', major: 'Business Analytics' }],
};
const posting = { title: 'Data Analyst', company: 'Example Co', description: 'SQL, Python, dbt required.' };
const parsed = { requiredSkills: ['SQL', 'Python', 'dbt'], keywords: ['dashboards', 'Airflow'], roleSummary: 'Analyst' };
const company = { name: 'Example Co', mission: [{ text: 'Make local delivery simple and fair.', source: 'https://example-co.test/about' }], values: [], products: [], news: [], culture: [] };
const base = {
  jobKeywords: ['SQL'],
  jobs: [{ id: 'j0', bullets: [{ sourceId: 'j0b1', text: 'Wrote SQL queries to track 1,200 daily deliveries' }, { sourceId: 'j0b0', text: 'Built a Tableau dashboard for Example Co’s mission that cut weekly reporting time by 40%' }] }],
  projects: [],
  skills: ['SQL', 'Tableau', 'Python'],
};

await test('breakdown and company go in tagged blocks, on Sonnet', async () => {
  const reqs = mockApi({ ...base, summary: 'Analytics intern who builds Tableau dashboards and SQL reporting, eager to help make local delivery simple and fair.' });
  const res = await AI.tailorResume({ apiKey: 'k', model: 'claude-haiku-4-5', profile, posting, parsed, company });
  assert.equal(res.ok, true);
  assert.equal(reqs[0].model, 'claude-sonnet-5-5');
  const msg = reqs[0].messages[0].content;
  assert.match(msg, /<job_posting title="Data Analyst" company="Example Co">/);
  assert.match(msg, /<job_breakdown>[\s\S]*"dbt"[\s\S]*<\/job_breakdown>/);
  assert.match(msg, /<company_profile>[\s\S]*mission\.0[\s\S]*<\/company_profile>/);
  assert.doesNotMatch(JSON.stringify(reqs[0]), /McTestface|testy@example/);
  assert.equal(res.tailored.summary.startsWith('Analytics intern'), true);
  assert.equal(res.usedBreakdown && res.usedCompany, true);
});

await test('breakdown keywords count toward missing keywords', async () => {
  mockApi({ ...base, summary: '' });
  const res = await AI.tailorResume({ apiKey: 'k', model: 'claude-sonnet-5-5', profile, posting, parsed, company: null });
  assert.ok(res.tailored.keywords.includes('dbt') && res.tailored.missingKeywords.includes('dbt'));
  assert.ok(res.tailored.missingKeywords.includes('Airflow'));
  assert.ok(!res.tailored.missingKeywords.includes('SQL'));
});

await test('the company profile never gets into bullets', async () => {
  mockApi({ ...base, summary: '' });
  const res = await AI.tailorResume({ apiKey: 'k', model: 'claude-sonnet-5-5', profile, posting, parsed, company });
  const b = res.tailored.jobs[0].bullets.find((x) => x.sourceId === 'j0b0');
  assert.equal(b.text, 'Built a Tableau dashboard that cut weekly reporting time by 40%');
  assert.match(b.note, /Kept original/);
});

await test('a summary with a made-up number or a skill you lack is left out', async () => {
  mockApi({ ...base, summary: 'Analyst who cut reporting time by 75% with dbt.' });
  const res = await AI.tailorResume({ apiKey: 'k', model: 'claude-sonnet-5-5', profile, posting, parsed, company });
  assert.equal(res.tailored.summary, '');
  assert.match(res.tailored.summaryNote, /75%/);
  mockApi({ ...base, summary: 'Analyst with dbt and Airflow experience.' });
  const res2 = await AI.tailorResume({ apiKey: 'k', model: 'claude-sonnet-5-5', profile, posting, parsed, company });
  assert.equal(res2.tailored.summary, '');
  assert.match(res2.tailored.summaryNote, /dbt|Airflow/);
});

await test('without a breakdown or company profile, tailoring still works', async () => {
  const reqs = mockApi({ ...base, summary: 'Analytics intern skilled in SQL and Tableau.' });
  const res = await AI.tailorResume({ apiKey: 'k', model: 'claude-sonnet-5-5', profile, posting });
  assert.equal(res.ok, true);
  assert.doesNotMatch(reqs[0].messages[0].content, /job_breakdown|company_profile/);
  assert.equal(res.tailored.summary, 'Analytics intern skilled in SQL and Tableau.');
});

await test('validator: metrics must match, no tools outside your resume, locked bullets stay, titles stay', () => {
  const T = AI._test;
  const json = {
    jobKeywords: ['dbt'], skills: ['Python', 'Kubernetes', 'SQL'], summary: '',
    jobs: [{ id: 'j0', title: 'Operations Data Analyst Intern', bullets: [
      { sourceId: 'j0b0', text: 'Built Tableau dashboards that cut weekly reporting time by 45%' },
      { sourceId: 'j0b1', text: 'Wrote SQL and dbt models to track 1,200 daily deliveries' },
    ] }],
    projects: [],
  };
  const t = T.enforceTailoring(profile, json, { parsed, role: 'Data Analyst' });
  const [b0, b1] = t.jobs[0].bullets;
  assert.equal(b0.text, profile.workHistory[0].bullets[0]);
  assert.match(b0.note, /number changed/);
  assert.equal(b1.text, profile.workHistory[0].bullets[1]);
  assert.match(b1.note, /dbt/);
  assert.ok(!t.skills.includes('Kubernetes'), 'skills only from the master list');
  assert.equal(t.jobs[0].title, 'Operations Analyst Intern', 'the title never changes by itself');

  const locked = T.enforceTailoring(profile, { ...json, jobs: [{ id: 'j0', title: '', bullets: [{ sourceId: 'j0b1', text: 'Queried 1,200 daily deliveries with SQL' }] }] }, { locks: [profile.workHistory[0].bullets[1]] });
  assert.equal(locked.jobs[0].bullets[0].text, profile.workHistory[0].bullets[1]);
  assert.equal(locked.jobs[0].bullets[0].locked, true);
  assert.match(locked.jobs[0].bullets[0].note, /you locked/);
});

await test('title suggestions: the posting’s words for the same role only', () => {
  const { titleSuggestion } = AI._test;
  assert.equal(titleSuggestion('Software Engineering Intern', 'Software Engineer Intern', 'Software Engineer Intern'), 'Software Engineer Intern');
  assert.equal(titleSuggestion('Software Engineering Intern', 'Software Engineer', 'Software Engineer'), '', 'dropping "Intern" raises the level');
  assert.equal(titleSuggestion('Analyst Intern', 'Senior Analyst', 'Senior Data Analyst'), '');
  assert.equal(titleSuggestion('Software Engineer', 'Data Engineer', 'Software Engineer'), '', '"Data" is in neither title');
  assert.equal(titleSuggestion('Student Assistant', 'Student Assistant', 'Help Desk Assistant'), '', 'same title: nothing to suggest');
});

console.log(`\n${passed} tests passed`);
