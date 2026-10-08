// Tests for the canonical answer store in lib/storage.js, against an in-memory chrome.storage.
// Run with: node dev/test-canon-storage.mjs
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

await test('saving an answer records its wording and dates; Undo restores', async () => {
  const before = await S.saveCanonAnswer({ key: 'general.howHeard', type: 'generic', kind: 'choice', label: 'How did you hear about us?', value: 'LinkedIn', wording: 'How did you hear about us?' });
  assert.equal(before, null);
  let a = (await S.getCanonAnswers())['general.howHeard'];
  assert.equal(a.value, 'LinkedIn');
  assert.ok(a.updatedAt);
  const prev = await S.saveCanonAnswer({ key: 'general.howHeard', value: 'Handshake', wording: 'Where did you find this job?' });
  a = (await S.getCanonAnswers())['general.howHeard'];
  assert.equal(a.value, 'Handshake');
  assert.deepEqual(a.wordings, ['Where did you find this job?', 'How did you hear about us?']);
  await S.restoreCanonAnswer('general.howHeard', prev);
  assert.equal((await S.getCanonAnswers())['general.howHeard'].value, 'LinkedIn');
});

await test('a wording alone does not change the updated date', async () => {
  const at = (await S.getCanonAnswers())['general.howHeard'].updatedAt;
  await new Promise((r) => setTimeout(r, 5));
  await S.saveCanonAnswer({ key: 'general.howHeard', wording: 'Referral source' });
  const a = (await S.getCanonAnswers())['general.howHeard'];
  assert.equal(a.updatedAt, at);
  assert.equal(a.wordings[0], 'Referral source');
});

await test('last used dates and deleting', async () => {
  await S.touchCanonAnswers(['general.howHeard', 'nope']);
  assert.ok((await S.getCanonAnswers())['general.howHeard'].lastUsedAt);
  await S.deleteCanonAnswer('general.howHeard');
  assert.equal((await S.getCanonAnswers())['general.howHeard'], undefined);
});

await test('question classifications are cached per wording', async () => {
  await S.saveQuestionClass('Do you speak Spanish?', { type: 'generic', key: 'custom.do-you-speak-spanish', by: 'claude' });
  assert.equal((await S.getQuestionClass('do you speak spanish')).key, 'custom.do-you-speak-spanish');
  await S.saveQuestionClass('Weird', { type: 'bogus', key: 'x' });
  assert.equal((await S.getQuestionClass('Weird')).type, 'job');
});

await test('custom answers get a saved date; import cleans canonical answers', async () => {
  await S.saveCustomAnswers([{ question: 'Referral', answer: 'Friend' }]);
  assert.ok((await S.getProfile()).customAnswers[0].savedAt);
  await S.importAll({ profile: {}, canonAnswers: { 'general.languages': { value: 'Spanish', type: 'weird', wordings: ['Languages?'] }, 'bad key!': { value: 'x' } } });
  const all = await S.getCanonAnswers();
  assert.deepEqual(Object.keys(all), ['general.languages']);
  assert.equal(all['general.languages'].type, 'generic');
});

await test('a fill records wordings and use, creating entries for profile facts', async () => {
  await S.noteCanonUse([{ key: 'education.gradDate', label: 'Graduation date', type: 'generic', kind: 'date', wording: 'When do you graduate?' }]);
  await S.noteCanonUse([{ key: 'education.gradDate', wording: 'Graduation year' }, { key: 'education.gradDate', wording: 'graduation YEAR' }]);
  const e = (await S.getCanonAnswers())['education.gradDate'];
  assert.deepEqual(e.wordings, ['Graduation year', 'When do you graduate?']);
  assert.equal(e.kind, 'date');
  assert.ok(e.lastUsedAt && !e.updatedAt);
  assert.equal(S.questionWordingKey('Do you speak Spanish?'), 'do you speak spanish');
  assert.ok((await S.getQuestionClasses())['do you speak spanish']);
});

console.log(`\n${passed} tests passed`);
