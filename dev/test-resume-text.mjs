// Tests for lib/resumeText.js. Run with: node dev/test-resume-text.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../lib/resumeText.js');
const T = globalThis.JobScriptResumeText;

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log('ok -', name);
};

const PASTED = `Testy McTestface
Sacramento, CA | (916) 555-0100 | testy@example.com | linkedin.com/in/testy-example

EDUCATION
California State University, Sacramento\tExpected May 2027
B.S. Computer Science, GPA 3.6

EXPERIENCE
Software Engineering Intern    June 2025 – Present
Example Corp, Sacramento, CA
• Built an internal tool used by 40 engineers, cutting release time by 30%
• Wrote integration tests in Python and pytest

Student Assistant – Campus IT, Sep 2023 - May 2025
- Resolved 500+ help desk tickets

PROJECTS
**JobScript** (Chrome extension) 2026
- Autofills job applications with vanilla JS

TECHNICAL SKILLS
Languages: Python, JavaScript, SQL
Tools: Git, Docker`;

test('sections, entries, dates and bullets from a typical paste', () => {
  const { sections, skippedHeader } = T.parseResume(PASTED);
  assert.deepEqual(skippedHeader, ['Testy McTestface', 'Sacramento, CA | (916) 555-0100 | testy@example.com | linkedin.com/in/testy-example']);
  assert.deepEqual(sections.map((s) => s.heading), ['EDUCATION', 'EXPERIENCE', 'PROJECTS', 'TECHNICAL SKILLS']);
  const [edu, exp, proj, skills] = sections;
  assert.deepEqual(edu.entries, [{ left: 'California State University, Sacramento', right: 'Expected May 2027', sub: 'B.S. Computer Science, GPA 3.6', subRight: '', bullets: [] }]);
  assert.equal(exp.entries.length, 2);
  assert.deepEqual(exp.entries[0], {
    left: 'Software Engineering Intern', right: 'June 2025 – Present', sub: 'Example Corp, Sacramento, CA', subRight: '',
    bullets: ['Built an internal tool used by 40 engineers, cutting release time by 30%', 'Wrote integration tests in Python and pytest'],
  });
  assert.deepEqual(exp.entries[1], { left: 'Student Assistant – Campus IT', right: 'Sep 2023 - May 2025', sub: '', subRight: '', bullets: ['Resolved 500+ help desk tickets'] });
  assert.deepEqual(proj.entries, [{ left: 'JobScript (Chrome extension)', right: '2026', sub: '', subRight: '', bullets: ['Autofills job applications with vanilla JS'] }]);
  assert.deepEqual(skills.lines, ['Languages: Python, JavaScript, SQL', 'Tools: Git, Docker']);
});

test('markdown headings and bold from a chat answer', () => {
  const { sections } = T.parseResume('# Jane Doe\njane@example.com\n\n## Summary\nEngineer with **3 years** of backend work.\n\n## Work Experience\n**Backend Engineer** — Acme (2022 – 2024)\n* Shipped the billing service');
  assert.deepEqual(sections.map((s) => s.heading), ['Summary', 'Work Experience']);
  assert.deepEqual(sections[0].lines, ['Engineer with 3 years of backend work.']);
  assert.equal(sections[1].entries[0].left, 'Backend Engineer — Acme (2022 – 2024)');
  assert.deepEqual(sections[1].entries[0].bullets, ['Shipped the billing service']);
});

test('a summary paragraph above the first heading is kept', () => {
  const { sections } = T.parseResume('Jane Doe\njane@example.com\nResults-driven engineer who has shipped three products to millions of users.\n\nSKILLS\nPython');
  assert.equal(sections[0].heading, 'Summary');
  assert.equal(sections[0].lines[0], 'Results-driven engineer who has shipped three products to millions of users.');
});

test('no headings at all still gives one section with every line', () => {
  const { sections } = T.parseResume('Acme Corp 2020-2022\n- did things\n- did more');
  assert.equal(sections.length, 1);
  assert.equal(sections[0].heading, 'Resume');
  assert.deepEqual(sections[0].entries[0], { left: 'Acme Corp', right: '2020-2022', sub: '', subRight: '', bullets: ['did things', 'did more'] });
});

test('empty and junk input give no sections', () => {
  assert.deepEqual(T.parseResume('').sections, []);
  assert.deepEqual(T.parseResume('\n\n  \n').sections, []);
});

test('headings with decoration and unknown capitalised headings', () => {
  assert.deepEqual(T._test.headingOf('--- Experience ---'), { key: 'experience', text: 'Experience' });
  assert.deepEqual(T._test.headingOf('Skills & Tools:'), { key: 'skills', text: 'Skills & Tools' });
  assert.deepEqual(T._test.headingOf('RESEARCH'), { key: 'other', text: 'RESEARCH' });
  assert.equal(T._test.headingOf('Built a thing for the team'), null);
  assert.equal(T._test.headingOf('BUILT A THING FOR THE WHOLE TEAM'), null);
});

test('cover letter: greeting found, date and sign-off dropped', () => {
  const { greeting, paragraphs } = T.parseLetter('October 27, 2026\n\nHiring Team\nDiscord\n\nDear Hiring Team,\n\nI am writing about the Software Engineer role.\nIt fits my work on realtime systems.\n\nThank you for your time.\n\nSincerely,\nTesty McTestface');
  assert.equal(greeting, 'Dear Hiring Team,');
  assert.deepEqual(paragraphs, ['I am writing about the Software Engineer role. It fits my work on realtime systems.', 'Thank you for your time.']);
});

test('cover letter: greeting on the same block as the first paragraph; no greeting at all', () => {
  assert.deepEqual(T.parseLetter('Dear Ms. Lee,\nI would love to join.\n\nBest regards,\n\nTesty'), { greeting: 'Dear Ms. Lee,', paragraphs: ['I would love to join.'] });
  assert.deepEqual(T.parseLetter('I would love to join your team.\n\nSincerely, Testy McTestface'), { greeting: 'Dear Hiring Team,', paragraphs: ['I would love to join your team.'] });
});

console.log(`\n${passed} tests passed`);
