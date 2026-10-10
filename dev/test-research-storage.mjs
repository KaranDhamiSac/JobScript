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
        const out = {};
        for (const k of [].concat(key)) if (k in store) out[k] = structuredClone(store[k]);
        return out;
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

await test('saving a job makes a Saved entry; a fill later makes it Filled, never a duplicate', async () => {
  const url = 'https://www.indeed.com/viewjob?jk=abc123def4567890';
  const { app, created } = await S.saveJob({ url, company: 'Fabrikam', title: 'Engineer', site: 'Indeed', extra: { score: 87.4, scoreReason: 'Strong SQL match' } });
  assert.equal(created, true);
  assert.equal(app.status, 'Saved');
  assert.equal(app.score, 87);
  assert.equal((await S.saveJob({ url: url + '&from=serp', company: 'Fabrikam', title: 'Engineer' })).created, false);
  await S.upsertApplication({ url, company: 'Fabrikam', title: 'Engineer', site: 'Indeed' });
  const mine = (await S.getApplications()).filter((a) => a.key === S.applicationKey(url));
  assert.equal(mine.length, 1);
  assert.equal(mine[0].status, 'Filled');
  assert.equal(mine[0].score, 87);
  await S.setApplicationStatus(mine[0].id, 'Applied');
  await S.setApplicationStatus(mine[0].id, 'Saved');
  assert.equal((await S.getApplications()).find((a) => a.id === mine[0].id).appliedAt, undefined);
});

await test('postings saved under the old key (query string dropped) are still found', async () => {
  store['posting:https://careers.example.com/open-roles'] = { url: 'https://careers.example.com/open-roles?gh_jid=111', description: 'old copy' };
  assert.equal((await S.getPosting('https://careers.example.com/open-roles?gh_jid=111')).description, 'old copy');
});

await test('duplicates: same job, then job ID at the same company, then company and title', async () => {
  await S.saveJob({ url: 'https://job-boards.greenhouse.io/northwind/jobs/4012345007', company: 'Northwind, Inc.', title: 'Data Analyst II (Remote)', jobId: '4012345007' });
  assert.equal((await S.findDuplicate({ url: 'https://job-boards.greenhouse.io/northwind/jobs/4012345007?src=li' })).by, 'this job');
  assert.equal((await S.findDuplicate({ url: 'https://northwind.example/careers?gh_jid=4012345007', jobId: '4012345007', company: 'Northwind' })).by, 'job ID');
  assert.equal((await S.findDuplicate({ url: 'https://www.linkedin.com/jobs/view/999/', jobId: '999', company: 'NORTHWIND', title: 'data analyst ii - remote' })).by, 'company and title');
  assert.equal(await S.findDuplicate({ url: 'https://www.linkedin.com/jobs/view/998/', jobId: '998', company: 'Northwind', title: 'Data Engineer' }), null);
});

await test('match scores are cached per job', async () => {
  await S.saveJobScore('https://www.indeed.com/viewjob?jk=aaa111&from=serp', { resumeHash: 'h1', score: 71 });
  assert.equal((await S.getJobScore('https://www.indeed.com/viewjob?jk=aaa111')).score, 71);
  assert.equal(await S.getJobScore('https://www.indeed.com/viewjob?jk=bbb222'), null);
});

await test('a posting keeps location, pay, job ID and apply link, and a re-scrape without them keeps the old ones', async () => {
  const url = 'https://www.indeed.com/viewjob?jk=ccc333';
  await S.savePosting({ url, title: 'Engineer', company: 'Fabrikam', description: 'x'.repeat(500), location: 'Fresno, CA', pay: '$70,000 a year', jobId: 'ccc333', applyUrl: 'https://jobs.lever.co/fabrikam/abc' });
  await S.savePosting({ url, title: 'Engineer', company: 'Fabrikam', description: 'x'.repeat(520) });
  const p = await S.getPosting(url);
  assert.equal(p.location, 'Fresno, CA');
  assert.equal(p.applyUrl, 'https://jobs.lever.co/fabrikam/abc');
});

await test('documents made for a job are found from its employer page, by company and title', async () => {
  const li = 'https://www.linkedin.com/jobs/view/4055555555/';
  await S.saveJob({ url: li, company: 'Contoso', title: 'QA Analyst', jobId: '4055555555' });
  await S.updateApplication(li, { tailoredId: 't1', tailoredFileName: 'Testy_McTestface_Contoso.pdf' });
  store['tailored:t1'] = { name: 'Testy_McTestface_Contoso.pdf', data: 'JVBERi0=', type: 'application/pdf' };
  await S.saveLetter(li, { text: 'Dear team' });
  const docs = await S.jobDocuments({ url: 'https://jobs.lever.co/contoso/11111111-2222-3333-4444-555555555555/apply', company: 'Contoso', title: 'QA Analyst' });
  assert.equal(docs.by, 'company and title');
  assert.equal(docs.tailored.name, 'Testy_McTestface_Contoso.pdf');
  assert.equal(docs.letter.text, 'Dear team');
  const none = await S.jobDocuments({ url: 'https://jobs.lever.co/contoso/x', company: 'Contoso', title: 'Data Engineer' });
  assert.equal(none.tailored, null);
  assert.equal(none.letter, null);
  assert.deepEqual(await S.getFillSettings(), { resumeFallback: 'master', keepDocuments: true });
});

console.log(`\n${passed} tests passed`);
