// Offscreen page: builds a resume or cover letter PDF from pasted text, for background.js
// (chrome.offscreen). pdf-lib is an ES module, which the service worker can't load. Everything
// here stays on this device; the page has no network access (see offscreen.html).
import { buildResumePdf, buildCoverLetterPdf, contactParts } from '../tailor/resume-pdf.js';

const T = globalThis.JobScriptResumeText;
const MAX_TEXT = 30000;

function toBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function fullName(profile) {
  return [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim();
}

async function build(msg) {
  const profile = msg.profile || {};
  const posting = msg.posting || {};
  const text = String(msg.text || '').slice(0, MAX_TEXT);
  const name = fullName(profile);
  if (!name) return { ok: false, error: 'Add your name on the options page first; the PDF puts it on top.' };
  const subject = [posting.title, posting.company].filter(Boolean).join(' at ');

  if (msg.kind === 'resume') {
    const { sections } = T.parseResume(text);
    if (!sections.length) return { ok: false, error: 'No resume text found. Paste the whole resume, headings and all.' };
    const content = { name, contact: contactParts(profile), sections };
    const out = await buildResumePdf(content, { subject });
    if (out.overflow) return { ok: false, error: 'Longer than one page even after dropping some bullets. Shorten it and paste again.' };
    return { ok: true, data: toBase64(out.bytes), size: out.bytes.length, trimmed: out.trimmed, content };
  }

  if (msg.kind === 'letter') {
    const { greeting, paragraphs } = T.parseLetter(text);
    if (!paragraphs.length) return { ok: false, error: 'No letter text found.' };
    const out = await buildCoverLetterPdf(
      {
        name,
        contact: contactParts(profile),
        date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
        recipient: ['Hiring Team', posting.company].filter(Boolean),
        greeting,
        paragraphs,
      },
      { subject }
    );
    if (out.overflow) return { ok: false, error: 'The letter is longer than one page. Shorten it and paste again.' };
    // The same text shape letter/letter.js saves, so a cover letter box gets the sign-off too.
    const full = [greeting, ...paragraphs, 'Sincerely,\n' + name].join('\n\n');
    return { ok: true, data: toBase64(out.bytes), size: out.bytes.length, text: full };
  }
  return { ok: false, error: 'Unknown document.' };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen' || msg.type !== 'build-pdf') return false;
  if (sender.id !== chrome.runtime.id || sender.tab) return false; // only the background script
  build(msg).then(sendResponse, (e) => sendResponse({ ok: false, error: e.message || String(e) }));
  return true;
});
