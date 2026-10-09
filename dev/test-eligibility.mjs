// Tests for lib/eligibility.js. Run with: node dev/test-eligibility.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../lib/eligibility.js');
const E = globalThis.JobScriptEligibility;

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log('ok -', name);
};

const NOW = new Date(2026, 9, 9); // Oct 2026
const profile = {
  city: 'Sacramento', state: 'CA', willingToRelocate: 'no', workAuthorized: 'yes', requiresSponsorship: 'no',
  workHistory: [
    { startDate: '2025-06', current: true }, // 17 months
    { startDate: '2024-06', endDate: '2024-08' }, // 3 months
    { startDate: '2025-06', endDate: '2025-08' }, // overlaps the first: not counted twice
  ],
  education: [{ school: 'California State University, Sacramento', degree: 'B.S.', major: 'Computer Science', gradDate: '2027-05' }],
};
const none = { minYears: 0, degree: 'none', clearance: 'none', citizenship: 'none', workplace: 'unknown', workLocations: [] };
const texts = (list) => list.map((w) => `${w.level}: ${w.text}`);

test('years of experience merges overlapping jobs', () => {
  assert.equal(E.yearsOfExperience(profile, NOW), 1.7);
  assert.equal(E.yearsOfExperience({ workHistory: [] }, NOW), 0);
});

test('degree levels from how people write them', () => {
  assert.equal(E.degreeLevel('B.S.'), 'bachelor');
  assert.equal(E.degreeLevel('Bachelor of Arts'), 'bachelor');
  assert.equal(E.degreeLevel('MS'), 'master');
  assert.equal(E.degreeLevel('MBA'), 'master');
  assert.equal(E.degreeLevel('Ph.D.'), 'doctorate');
  assert.equal(E.degreeLevel('A.A.'), 'associate');
  assert.equal(E.degreeLevel('Certificate'), 'none');
});

test('nothing stated, nothing to warn about', () => {
  assert.deepEqual(E.check(none, profile, NOW), []);
});

test('years, master’s, clearance and citizenship warnings', () => {
  const w = E.check({ ...none, minYears: 3, yearsText: '3+ years with Python', degree: 'master', degreeRequired: true, clearance: 'required', citizenship: 'us_citizen' }, profile, NOW);
  assert.deepEqual(texts(w), [
    'warn: Asks for 3+ years of experience (“3+ years with Python”); your resume shows about 1.7 (internships included).',
    'warn: Requires a master’s degree; your profile doesn’t list one.',
    'warn: Requires an active security clearance.',
    'warn: Requires U.S. citizenship.',
  ]);
});

test('a bachelor’s in progress is a note, not a warning', () => {
  const w = E.check({ ...none, degree: 'bachelor', degreeRequired: true }, profile, NOW);
  assert.deepEqual(texts(w), ['info: Requires a bachelor’s degree; yours is expected May 2027. Check the posting accepts students.']);
});

test('sponsorship only warns when you need it', () => {
  assert.deepEqual(E.check({ ...none, citizenship: 'no_sponsorship' }, profile, NOW), []);
  const w = E.check({ ...none, citizenship: 'no_sponsorship' }, { ...profile, requiresSponsorship: 'yes' }, NOW);
  assert.equal(w.length, 1);
  assert.match(w[0].text, /need sponsorship/);
});

test('onsite elsewhere warns; your state is a note; your city or remote is fine; relocating softens it', () => {
  const far = { ...none, workplace: 'onsite', workLocations: ['Fresno, CA', 'Austin, TX'] };
  assert.deepEqual(texts(E.check(far, profile, NOW)), ['info: Onsite in Fresno, CA; Austin, TX; you’re in Sacramento, CA.'], 'Fresno is in your state: a note');
  assert.deepEqual(E.check({ ...far, workLocations: ['Austin, TX', 'Sacramento, CA'] }, profile, NOW), [], 'one of the places is your city');
  const tx = { ...none, workplace: 'hybrid', workLocations: ['Austin, TX'] };
  assert.deepEqual(texts(E.check(tx, profile, NOW)), ['warn: Hybrid in Austin, TX; you’re in Sacramento, CA.']);
  assert.equal(E.check(tx, { ...profile, willingToRelocate: 'yes' }, NOW)[0].level, 'info');
  assert.deepEqual(E.check({ ...none, workplace: 'onsite', workLocations: ['Sacramento, California'] }, { ...profile, state: 'California' }, NOW), []);
  assert.deepEqual(E.check({ ...none, workplace: 'remote', workLocations: ['Anywhere'] }, profile, NOW), []);
});

console.log(`\n${passed} tests passed`);
