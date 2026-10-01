// Tests for lib/dateRules.js. Run with: node dev/test-date-rules.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../lib/dateRules.js');
const D = globalThis.JobScriptDates;

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log('ok -', name);
};

const wed = new Date(2026, 8, 30, 9); // Wednesday, September 30, 2026

test('today and day offsets', () => {
  assert.equal(D.resolve('today', wed), '2026-09-30');
  assert.equal(D.resolve('+1d', wed), '2026-10-01');
  assert.equal(D.resolve('+14d', wed), '2026-10-14');
  assert.equal(D.resolve('+2w', wed), '2026-10-14');
});

test('next weekday is always after today', () => {
  assert.equal(D.resolve('next-mon', wed), '2026-10-05');
  assert.equal(D.resolve('next-wed', wed), '2026-10-07');
  assert.equal(D.resolve('next-thu', wed), '2026-10-01');
});

test('late at night and across daylight saving', () => {
  assert.equal(D.resolve('today', new Date(2026, 8, 30, 23, 59)), '2026-09-30');
  assert.equal(D.resolve('+3d', new Date(2026, 9, 30, 0, 30)), '2026-11-02'); // US clocks change Nov 1
});

test('not a rule', () => {
  for (const r of ['', '2026-10-15', 'soon', '+d', 'next-monday', '+1000d']) {
    assert.equal(D.isRule(r), false, r);
    assert.equal(D.resolve(r, wed), '');
  }
});

test('descriptions', () => {
  assert.deepEqual(
    ['today', '+1d', '+14d', '+2w', '+1w', 'next-mon'].map(D.describe),
    ['Today', 'Tomorrow', '14 days from today', '2 weeks from today', '1 week from today', 'Next Monday']
  );
});

test('custom number of days', () => {
  assert.equal(D.daysFromToday(0), 'today');
  assert.equal(D.daysFromToday('10'), '+10d');
  assert.equal(D.daysFromToday(9999), '+365d');
  assert.equal(D.daysFromToday('x'), 'today');
});

console.log(`\n${passed} tests passed`);
