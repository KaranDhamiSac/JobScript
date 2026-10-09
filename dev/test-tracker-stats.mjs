// Tests for tracker/stats.js. Run with: node dev/test-tracker-stats.mjs
// (Set TZ to try other time zones, e.g. TZ=Asia/Kolkata node dev/test-tracker-stats.mjs.)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../tracker/stats.js');
const T = globalThis.TrackerStats;

// ISO timestamp for a local date and time.
const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).toISOString();
let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log('ok -', name);
};

test('dayKey uses local time, not UTC', () => {
  assert.equal(T.dayKey(new Date(2026, 8, 30, 23, 30)), '2026-09-30');
  assert.equal(T.dayKey(new Date(2026, 9, 1, 0, 5)), '2026-10-01');
});

test('countsByDay splits applied and filled; saved jobs count as neither', () => {
  const apps = [
    { status: 'Applied', createdAt: at(2026, 9, 28), appliedAt: at(2026, 9, 29) },
    { status: 'Interviewing', createdAt: at(2026, 9, 29), appliedAt: at(2026, 9, 29, 23) },
    { status: 'Filled', createdAt: at(2026, 9, 29) },
    { status: 'Filled', createdAt: at(2026, 9, 30) },
    { status: 'Saved', createdAt: at(2026, 9, 29) },
  ];
  const { applied, filled } = T.countsByDay(apps);
  assert.equal(applied.get('2026-09-29'), 2);
  assert.equal(applied.get('2026-09-28'), undefined);
  assert.equal(filled.get('2026-09-29'), 1);
  assert.equal(filled.get('2026-09-30'), 1);
  assert.equal(T.appsOnDay(apps, '2026-09-29').length, 3);
});

test('streaks: current counts back from today, longest is the best run', () => {
  const goal = 2;
  const applied = new Map([
    ['2026-09-20', 2], ['2026-09-21', 3], ['2026-09-22', 2], ['2026-09-23', 2], // run of 4
    ['2026-09-24', 1], // breaks it
    ['2026-09-28', 2], ['2026-09-29', 5],
  ]);
  // Today (30th) not met yet: the streak still counts through yesterday.
  assert.deepEqual(T.streaks(applied, goal, new Date(2026, 8, 30)), { current: 2, longest: 4 });
  applied.set('2026-09-30', 2);
  assert.deepEqual(T.streaks(applied, goal, new Date(2026, 8, 30)), { current: 3, longest: 4 });
  assert.deepEqual(T.streaks(new Map(), goal, new Date(2026, 8, 30)), { current: 0, longest: 0 });
});

test('week (Sunday start) and month totals', () => {
  const applied = new Map([['2026-09-26', 4], ['2026-09-27', 1], ['2026-09-30', 2], ['2026-10-04', 9], ['2026-08-31', 7]]);
  const today = new Date(2026, 8, 30); // Wednesday
  assert.equal(T.weekTotal(applied, today), 3); // Sun 27 + Wed 30
  assert.equal(T.monthTotal(applied, today), 7); // 26 + 27 + 30
});

test('heatmap levels scale with the goal', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 9, 10].map((n) => T.level(n, 5)), [0, 1, 1, 2, 2, 3, 3, 4]);
});

test('month grid starts on Sunday and pads with nulls', () => {
  const weeks = T.monthGrid(2026, 8); // September 2026 starts on a Tuesday
  assert.equal(weeks[0][0], null);
  assert.equal(weeks[0][2].getDate(), 1);
  assert.ok(weeks.every((w) => w.length === 7));
  assert.equal(weeks.flat().filter(Boolean).length, 30);
});

test('heatmap covers 53 weeks ending with this week, future days empty', () => {
  const today = new Date(2026, 8, 30);
  const weeks = T.heatmapWeeks(today);
  assert.equal(weeks.length, 53);
  const last = weeks[52];
  assert.equal(T.dayKey(last[3]), '2026-09-30');
  assert.equal(last[4], null);
});

test('daylight saving change keeps one key per day', () => {
  // US clocks change on 2026-11-01; adding days must not skip or repeat a date.
  const keys = [];
  for (let d = new Date(2026, 9, 30); d < new Date(2026, 10, 4); d = T.addDays(d, 1)) keys.push(T.dayKey(d));
  assert.deepEqual(keys, ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03']);
});

console.log(`\n${passed} tests passed (TZ=${Intl.DateTimeFormat().resolvedOptions().timeZone})`);
