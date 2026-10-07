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

console.log(`\n${passed} tests passed`);
