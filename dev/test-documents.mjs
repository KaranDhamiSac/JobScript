// Tests for the document store in lib/storage.js (transcripts and other documents kept for
// applications), against an in-memory chrome.storage. Run with: node dev/test-documents.mjs
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

const pdf = (text) => Buffer.from('%PDF-1.4\n' + text + '\n%%EOF').toString('base64');

await test('slot labels name the kind of document', () => {
  assert.equal(S.documentKind('Unofficial Transcript'), 'transcript');
  assert.equal(S.documentKind('Transcript (required)'), 'transcript');
  assert.equal(S.documentKind('Cover Letter'), 'coverLetter');
  assert.equal(S.documentKind('Resume'), 'resume');
  assert.equal(S.documentKind('CV'), 'resume');
  assert.equal(S.documentKind('Writing Sample'), 'other');
  assert.equal(S.documentKind(''), '');
});

await test('a transcript is kept and found for any transcript slot; a newer one replaces it', async () => {
  const first = await S.saveDocument({ kind: 'transcript', label: 'Transcript', name: 'Transcript_Fall.pdf', data: pdf('fall') });
  assert.equal(first.data, undefined, 'metadata only');
  assert.equal((await S.findDocument('Unofficial Transcript')).name, 'Transcript_Fall.pdf');
  const second = await S.saveDocument({ kind: 'transcript', label: 'Unofficial Transcript', name: 'Transcript_Spring.pdf', data: pdf('spring') });
  assert.equal(second.replaced, 'Transcript_Fall.pdf');
  const list = await S.listDocuments();
  assert.deepEqual(list.map((d) => d.name), ['Transcript_Spring.pdf']);
  assert.equal(list[0].data, undefined);
  assert.equal((await S.findDocument('Transcript')).data, pdf('spring'));
});

await test('other documents are matched by their label; resumes are never found here', async () => {
  await S.saveDocument({ kind: 'other', label: 'Writing Sample', name: 'Essay.pdf', data: pdf('essay') });
  assert.equal((await S.findDocument('writing sample')).name, 'Essay.pdf');
  assert.equal(await S.findDocument('Portfolio'), null);
  assert.equal(await S.findDocument('Resume'), null);
});

await test('only PDFs up to 5 MB, and they can be removed', async () => {
  await assert.rejects(S.saveDocument({ kind: 'transcript', name: 'x.pdf', data: Buffer.from('hello').toString('base64') }), /not a PDF/);
  await assert.rejects(S.saveDocument({ kind: 'resume', name: 'x.pdf', data: pdf('x') }), /Unknown kind/);
  const essay = (await S.listDocuments()).find((d) => d.name === 'Essay.pdf');
  await S.removeDocument(essay.id);
  assert.equal(await S.findDocument('Writing Sample'), null);
});

await test('keeping uploaded documents is on unless turned off, and other settings survive', async () => {
  assert.equal((await S.getFillSettings()).keepDocuments, true);
  await S.saveFillSettings({ resumeFallback: 'ask' });
  await S.saveFillSettings({ keepDocuments: false });
  assert.deepEqual(await S.getFillSettings(), { resumeFallback: 'ask', keepDocuments: false });
});

console.log(`\n${passed} tests passed`);
