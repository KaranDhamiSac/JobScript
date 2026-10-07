// Tests for the job/company research and cover letter storage in lib/storage.js, against an
// in-memory chrome.storage. Run with: node dev/test-research-storage.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const store = {};
globalThis.chrome = {
  storage: {
    local: {
      async get(key) {
        if (key === null) return structuredClone(store);
        return key in store ? { [key]: structuredClone(store[key]) } : {};
      },
      async set(obj) {
        Object.assign(store, structuredClone(obj));
      },
      async remove(keys) {
        for (const k of [].concat(keys)) delete store[k];
      },
    },
  },
};
const require = createRequire(import.meta.url);
require('../lib/storage.js');
const S = globalThis.JobScriptStorage;

let passed = 0;
const test = async (name, fn) => {
  await fn();
  passed++;
  console.log('ok -', name);
};

await test('company names with different suffixes share a key', () => {
  assert.equal(S.companyKey('Acme, Inc.'), 'acme');
  assert.equal(S.companyKey('ACME Inc'), 'acme');
  assert.equal(S.companyKey('Northwind Logistics LLC'), 'northwindlogistics');
  assert.equal(S.companyKey('Ben & Jerry’s'), 'benandjerrys');
});

await test('job key uses the job ID, so /apply and the posting match', () => {
  const a = S.jobKey('https://jobs.lever.co/example/0a1b2c3d-1111-2222-3333-444455556666');
  const b = S.jobKey('https://jobs.lever.co/example/0a1b2c3d-1111-2222-3333-444455556666/apply?lever-source=x');
  assert.equal(a, b);
});

await test('a shorter re-scrape never replaces a fuller posting', async () => {
  const url = 'https://boards.greenhouse.io/example/jobs/123';
  await S.savePosting({ url, title: 'Analyst', company: 'Example', description: 'x'.repeat(5000) });
  await S.savePosting({ url: url + '?gh_src=1', title: 'Analyst', company: 'Example', description: 'This job is no longer available.' });
  assert.equal((await S.getPosting(url)).description.length, 5000);
  await S.savePosting({ url, description: 'y'.repeat(6000) });
  assert.equal((await S.getPosting(url)).description[0], 'y');
});

await test('company profiles keep only sourced or your own items', async () => {
  await S.saveCompany({
    name: 'Example Co',
    domain: 'https://www.example.com/about',
    mission: [
      { text: 'Make shipping simple.', source: 'https://www.example.com/about' },
      { text: 'Invented fact with no source.' },
      { text: 'Bad source', source: 'javascript:alert(1)' },
      { text: 'Added by me', byYou: true },
    ],
    news: 'not a list',
  });
  const c = await S.getCompany('Example Co.');
  assert.equal(c.domain, 'www.example.com');
  assert.deepEqual(c.mission.map((m) => m.text), ['Make shipping simple.', 'Added by me']);
  assert.deepEqual(c.news, []);
});

await test('research settings default to website mode, professional, 250 words', async () => {
  assert.deepEqual(await S.getResearchSettings(), { mode: 'website', tone: 'professional', length: '250' });
  await S.saveResearchSettings({ tone: 'warm', mode: 'nope' });
  assert.deepEqual(await S.getResearchSettings(), { mode: 'website', tone: 'warm', length: '250' });
});

await test('a saved cover letter is marked on its tracker entry', async () => {
  const url = 'https://jobs.lever.co/example/abc-123';
  await S.upsertApplication({ url, company: 'Example', title: 'Analyst', site: 'Lever' });
  await S.saveLetter(url + '/apply', { text: 'Dear team', tone: 'warm', length: 'short' });
  assert.equal((await S.getLetter(url)).text, 'Dear team');
  assert.ok((await S.getApplications())[0].coverLetterAt);
});

await test('job descriptions are cached per job', async () => {
  const url = 'https://boards.greenhouse.io/example/jobs/98765';
  await S.saveJobParse(url, { roleSummary: 'Do data things' });
  assert.equal((await S.getJobParse(url + '?gh_jid=98765')).roleSummary, 'Do data things');
});

console.log(`\n${passed} tests passed`);
