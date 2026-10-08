// Tests for lib/canonical.js. Run with: node dev/test-canonical.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../lib/canonical.js');
const C = globalThis.JobScriptCanonical;

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log('ok -', name);
};
const keyOf = (w, o) => {
  const c = C.classify(w, o);
  return c ? `${c.type}:${c.key}` : null;
};

test('different wordings of the same question share a key', () => {
  for (const w of ['Expected graduation date', 'When do you graduate?', 'Graduation year', 'Anticipated Graduation Date *', 'Class of', 'Expected completion date']) {
    assert.equal(keyOf(w), 'generic:education.gradDate', w);
  }
  for (const w of ['How did you hear about us?', 'How did you hear about this job?', 'Where did you find this posting?', 'Referral source', 'How did you learn about this opportunity?']) {
    assert.equal(keyOf(w), 'generic:general.howHeard', w);
  }
  for (const w of ['Are you legally authorized to work in the United States?', 'Are you eligible to work in the US?', 'Do you have the right to work in the UK?']) {
    assert.equal(keyOf(w), 'generic:auth.workAuthorized', w);
  }
  assert.equal(keyOf('Will you now or in the future require visa sponsorship?'), 'generic:auth.sponsorship');
  assert.equal(keyOf('What is your major?'), 'generic:education.major');
  assert.equal(keyOf('Field of study'), 'generic:education.major');
  assert.equal(keyOf('Cumulative GPA'), 'generic:education.gpa');
});

test('changing questions', () => {
  for (const w of ['Available start date', 'When can you start?', 'Earliest start date', 'Date available']) assert.equal(keyOf(w), 'changing:changing.startDate', w);
  for (const w of ['Desired salary', 'What are your salary expectations?', 'Expected compensation', 'Pay expectations']) assert.equal(keyOf(w), 'changing:changing.salary', w);
  assert.equal(keyOf('What is your notice period?'), 'changing:changing.noticePeriod');
});

test('job-specific questions are never generic', () => {
  for (const w of ['Why do you want to work here?', 'Why this role?', 'Why are you interested in this position?', 'Tell us about a project you are proud of', 'Describe a time you led a team', 'In 200 words, what draws you to us?', 'Cover letter', 'What excites you about Discord?', 'Is there anything else you would like us to know?']) {
    assert.equal(C.classify(w).type, 'job', w);
  }
  assert.equal(C.classify('What do you know about Example Co?', { company: 'Example Co' }).type, 'job');
  // "Why" about relocation is still about you, but anything "why…here" is job-specific.
  assert.equal(keyOf('Are you willing to relocate?'), 'generic:auth.relocation');
});

test('wordings you answered before are recognized, exactly or closely', () => {
  const learned = [{ key: 'custom.do-you-speak-spanish', type: 'generic', wordings: ['Do you speak Spanish?'] }];
  assert.equal(keyOf('Do you speak Spanish?', { learned }), 'generic:custom.do-you-speak-spanish');
  assert.equal(keyOf('Do you speak Spanish fluently?', { learned }), 'generic:custom.do-you-speak-spanish');
  assert.equal(keyOf('Favorite color?', { learned }), null);
});

test('one stored date, many formats', () => {
  assert.equal(C.formatDate('2027-05', 'mm/yyyy'), '05/2027');
  assert.equal(C.formatDate('2027-05', 'year'), '2027');
  assert.equal(C.formatDate('2027-05', 'month'), '05');
  assert.equal(C.formatDate('2027-05', 'text'), 'May 2027');
  assert.equal(C.formatDate('2027-05', 'full'), '2027-05-01');
  assert.equal(C.formatDate('2027-05-15', 'mm/dd/yyyy'), '05/15/2027');
});

test('what you typed is stored in one form', () => {
  assert.equal(C.parseAnswer('date', 'May 2027'), '2027-05');
  assert.equal(C.parseAnswer('date', '05/2027'), '2027-05');
  assert.equal(C.parseAnswer('date', '5/15/2027'), '2027-05-15');
  assert.equal(C.parseAnswer('date', '2027-5'), '2027-05');
  assert.equal(C.parseAnswer('bool', 'Yes, I am'), 'yes');
  assert.equal(C.parseAnswer('bool', 'No'), 'no');
  assert.equal(C.parseAnswer('text', '  LinkedIn '), 'LinkedIn');
});

test('profile paths read and write one fact', () => {
  const p = { education: [] };
  C.writeProfile(p, 'education.0.gradDate', '2027-05', { education: () => ({ school: '', gradDate: '' }) });
  assert.deepEqual(p.education, [{ school: '', gradDate: '2027-05' }]);
  assert.equal(C.readProfile(p, 'education.0.gradDate'), '2027-05');
  assert.equal(C.readProfile(p, 'education.3.school'), '');
  C.writeProfile(p, 'phone', '555-0100');
  assert.equal(C.readProfile(p, 'phone'), '555-0100');
});

console.log(`\n${passed} tests passed`);
