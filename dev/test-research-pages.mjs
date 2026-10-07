// Tests for lib/research.js: text extraction, nav links and which pages get fetched, with a fake
// fetch. Run with: node dev/test-research-pages.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../lib/research.js');
const R = globalThis.JobScriptResearch;

let passed = 0;
const test = async (name, fn) => {
  await fn();
  passed++;
  console.log('ok -', name);
};

const filler = 'We build tools that help small teams ship faster and work together. '.repeat(5);

await test('text skips scripts, styles, nav and footer, and decodes entities', () => {
  const html = `<html><head><title>About &amp; Us</title><style>p{}</style></head><body>
    <nav><a href="/x">Menu</a></nav><script>alert("x")</script>
    <h1>Our mission</h1><p>Make work&nbsp;simple &#8212; for everyone.</p><ul><li>Kindness</li><li>Craft</li></ul>
    <footer>© 2026</footer></body></html>`;
  assert.equal(R.htmlToText(html), 'Our mission\nMake work simple — for everyone.\n- Kindness\n- Craft');
  assert.equal(R.titleOf(html), 'About & Us');
});

await test('topic links stay on the company site', () => {
  const html = `<a href="/about-us">About us</a><a href="https://www.example.com/company/values">Our values</a>
    <a href="https://jobs.lever.co/example">Careers</a><a href="/pricing">Pricing</a><a href='/careers#open'>Jobs</a>`;
  assert.deepEqual(R.topicLinks(html, 'https://example.com/', 'example.com'), [
    'https://example.com/about-us',
    'https://www.example.com/company/values',
    'https://example.com/careers',
  ]);
});

function fakeFetch(site) {
  const calls = [];
  const impl = async (url, opts) => {
    calls.push({ url, credentials: opts.credentials });
    const page = site[url];
    if (!page) return { ok: false, url, headers: { get: () => 'text/html' }, text: async () => '' };
    return { ok: true, url: page.redirect || url, headers: { get: () => page.type || 'text/html' }, text: async () => page.html };
  };
  return { impl, calls };
}

await test('fetches home, its about links and common paths; never off-site', async () => {
  const site = {
    'https://example.com/': { html: `<title>Example</title><a href="/about-us">About</a><p>${filler}</p>` },
    'https://example.com/about-us': { html: `<p>Our mission is to help. ${filler}</p>` },
    'https://example.com/about': { redirect: 'https://example.com/about-us', html: `<p>${filler}</p>` },
    'https://example.com/careers': { redirect: 'https://evil.test/careers', html: `<p>${filler}</p>` },
    'https://example.com/values': { type: 'application/pdf', html: '%PDF' },
    'https://example.com/culture': { html: '<p>Too short.</p>' },
  };
  const { impl, calls } = fakeFetch(site);
  const pages = await R.fetchCompanyPages('https://www.example.com/whatever', impl);
  assert.deepEqual(pages.map((p) => p.url), ['https://example.com/', 'https://example.com/about-us']);
  assert.ok(calls.every((c) => c.credentials === 'omit'), 'no cookies');
  assert.ok(calls.every((c) => new URL(c.url).hostname.endsWith('example.com')));
});

await test('a bad domain fetches nothing', async () => {
  const { impl, calls } = fakeFetch({});
  assert.deepEqual(await R.fetchCompanyPages('not a domain', impl), []);
  assert.deepEqual(await R.fetchCompanyPages('localhost', impl), []);
  assert.equal(calls.length, 0);
});

console.log(`\n${passed} tests passed`);
