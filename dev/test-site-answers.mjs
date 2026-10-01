// Tests for the per-site answers in lib/storage.js, against an in-memory chrome.storage.
// Run with: node dev/test-site-answers.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const store = {};
globalThis.chrome = {
  storage: {
    local: {
      async get(key) {
        return key in store ? { [key]: structuredClone(store[key]) } : {};
      },
      async set(obj) {
        Object.assign(store, structuredClone(obj));
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

const A = 'https://portal.example.edu';
const B = 'https://jobs.example.com';

await test('save and read answers for a site', async () => {
  await S.saveSiteAnswers(A, [{ key: 'listbox|referral|referral|0', label: 'Referral', kind: 'listbox', answer: 'Website', junk: 'x' }]);
  const site = await S.getSiteAnswers(A);
  assert.equal(site.fields['listbox|referral|referral|0'].answer, 'Website');
  assert.equal(site.fields['listbox|referral|referral|0'].junk, undefined);
  assert.deepEqual(site.steps, []);
  assert.equal(site.learning, false);
  assert.deepEqual((await S.getSiteAnswers(B)).fields, {});
});

await test('learning records steps in order and restarts clean', async () => {
  await S.setSiteLearning(A, true);
  await S.addSiteStep(A, { title: 'Contact', keys: ['text|first name||0'] });
  await S.addSiteStep(A, { title: 'Documents', keys: ['listbox|referral|referral|0'] });
  let site = await S.getSiteAnswers(A);
  assert.equal(site.learning, true);
  assert.deepEqual(site.steps.map((s) => s.title), ['Contact', 'Documents']);
  assert.equal(site.fields['listbox|referral|referral|0'].answer, 'Website', 'answers are kept');
  await S.setSiteLearning(A, false);
  site = await S.getSiteAnswers(A);
  assert.equal(site.learning, false);
  assert.equal(site.steps.length, 2);
  await S.setSiteLearning(A, true);
  assert.equal((await S.getSiteAnswers(A)).steps.length, 0);
});

await test('delete one field, then the whole site', async () => {
  await S.saveSiteAnswers(B, [{ key: 'a', answer: '1' }, { key: 'b', answer: '2' }]);
  await S.deleteSiteAnswers(B, 'a');
  assert.deepEqual(Object.keys((await S.getSiteAnswers(B)).fields), ['b']);
  await S.deleteSiteAnswers(B);
  assert.equal((await S.getAllSiteAnswers())[B], undefined);
});

await test('import keeps only well-formed sites and never imports learning: true', async () => {
  await S.importAll({
    profile: {},
    siteAnswers: {
      [A]: { fields: { k: { answer: 'x', label: 'L' } }, steps: [{ title: 'One', keys: ['k'] }], learning: true },
      'javascript:alert(1)': { fields: {} },
      [B]: 'nope',
    },
  });
  const all = await S.getAllSiteAnswers();
  assert.deepEqual(Object.keys(all), [A]);
  assert.equal(all[A].learning, false);
  assert.equal(all[A].steps[0].title, 'One');
});

console.log(`\n${passed} tests passed`);
