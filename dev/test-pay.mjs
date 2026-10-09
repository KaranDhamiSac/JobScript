// Tests for reading pay in lib/jobDetect.js. Run with: node dev/test-pay.mjs
// (Page detection itself is tested in the browser: dev/test-detect.html.)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

globalThis.chrome = { storage: { local: {} } };
const require = createRequire(import.meta.url);
require('../lib/storage.js');
require('../lib/jobDetect.js');
const { payFrom } = globalThis.JobScriptDetect;

const cases = [
  ['Salary: $28.50 - $34.75 per hour', '$28.50 - $34.75 per hour'],
  ['Pay: $45/hr. Onsite in San Francisco.', '$45/hr'],
  ['Pay range: $72,000 - $90,000 annually.', '$72,000 - $90,000'],
  ['The base pay range for this role is $75K/yr - $95K/yr.', '$75K/yr - $95K/yr'],
  ['Compensation: US$90,000 to US$110,000', 'US$90,000 to US$110,000'],
  // Dollar amounts that aren't pay.
  ['We automate how over $200B in annualized spend flows through payments.', ''],
  ['Fertility HRA (up to $10,000 per year)', ''],
  ['We raised $50M last year to grow the team.', ''],
];
for (const [text, want] of cases) assert.equal(payFrom(text), want, text);
console.log(`ok - ${cases.length} pay cases`);
