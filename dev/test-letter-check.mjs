// Tests for lib/letterCheck.js. Run with: node dev/test-letter-check.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../lib/letterCheck.js');
const L = globalThis.JobScriptLetterCheck;

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log('ok -', name);
};

// A made-up applicant; no real resume details.
const profile = {
  firstName: 'Testy', lastName: 'McTestface', email: 'testy@example.com', phone: '916-555-0100',
  skills: 'SQL, Python, Tableau, Excel',
  workHistory: [{ employer: 'Northwind Logistics', title: 'Operations Analyst Intern', bullets: ['Built a Tableau dashboard that cut weekly reporting time by 40%', 'Wrote SQL queries to track 1,200 daily deliveries'] }],
  projects: [{ name: 'Trailmix', tech: 'Python, Flask', bullets: ['Built a route planner for hiking groups in Python'] }],
  education: [{ school: 'Sample State University', degree: 'BS', major: 'Business Analytics' }],
};
const company = {
  name: 'Example Co',
  mission: [{ text: 'Make local delivery simple, reliable and fair for small businesses and their drivers.', source: 'https://example-co.test/about-us' }],
  values: [{ text: 'Customers first: listen before building.', source: 'https://example-co.test/about-us' }],
  products: [], news: [{ text: 'Expanded to three new states in August 2026.', source: 'https://news.example.test/x' }], culture: [],
};
const ctx = { profile, company, companyName: 'Example Co', role: 'Data Analyst', jobText: 'Required: SQL, Python. Preferred: dbt, Airflow, Kubernetes.' };

test('a letter that sticks to the sources has no flags', () => {
  const letter = `Dear Hiring Manager,

I’m applying for the Data Analyst role at Example Co because your mission to make local delivery simple and fair for small businesses is one I care about.

At Northwind Logistics I built a Tableau dashboard that cut weekly reporting time by 40%, and I wrote SQL queries to track 1,200 daily deliveries. In my Trailmix project I built a route planner in Python.

Thank you for your time. I’d welcome the chance to talk.`;
  assert.deepEqual(L.check(letter, ctx), []);
});

test('numbers not in the resume are flagged', () => {
  const flags = L.check('I cut reporting time by 60% at Northwind Logistics.', ctx);
  assert.deepEqual(flags.map((f) => [f.type, f.text]), [['number', '60%']]);
});

test('tools from the posting but not the resume are flagged as possible claims', () => {
  const flags = L.check('I have deployed services on Kubernetes and scheduled jobs with Airflow.', ctx);
  assert.deepEqual(flags.filter((f) => f.type === 'term').map((f) => f.text), ['Kubernetes', 'Airflow']);
  assert.match(flags[0].message, /comes from the posting/);
});

test('company claims not in the profile are flagged; ones that are pass', () => {
  const bad = L.check('I admire how Example Co recently raised a Series C and launched a drone product.', ctx);
  assert.ok(bad.some((f) => f.type === 'company'));
  const good = L.check('I was glad to read that Example Co recently expanded to three new states.', ctx);
  assert.ok(!good.some((f) => f.type === 'company'));
});

test('experience that is not in the resume is flagged', () => {
  const flags = L.check('I led a team of engineers migrating payroll systems to a new vendor.', ctx);
  assert.ok(flags.some((f) => f.type === 'experience'));
});

test('resume corpus never includes contact details', () => {
  const corpus = L.resumeCorpus(profile);
  assert.ok(!/testy@example|555-0100|McTestface/.test(corpus));
});

test('years and greetings are not flagged', () => {
  assert.deepEqual(L.check('Dear Hiring Team,\nSince 2024 I have wanted to work in logistics.\nSincerely,', ctx), []);
});

console.log(`\n${passed} tests passed`);
