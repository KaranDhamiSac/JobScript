# JobScript Privacy Policy

_Last updated: 2026-09-29_

JobScript is a browser extension that fills job application forms with information you save in it. This policy explains what happens to that information.

## What JobScript stores

JobScript stores the details you enter on its options page:

- contact details, links, skills and work-eligibility answers
- optional demographic (EEO) answers, which default to "Decline to answer"
- work history, education and your saved question-and-answer pairs (your "bank")
- your resume PDF, and its plain text if you use **Import info from resume**
- if you turn on AI answers: your Anthropic API key and your chosen model

## Where it is stored

Everything is stored locally, in your browser's extension storage (`chrome.storage.local`), on your own device. JobScript doesn't use browser sync, so nothing copies to your other devices.

This storage is not encrypted. Anyone with access to your browser profile could read it, including your API key if you saved one.

Resume import runs entirely on your device, using a copy of pdf.js bundled inside the extension.

## What JobScript sends, and to whom

**By default, nothing.** JobScript has no servers and no analytics or tracking. With AI answers off, it makes no network requests.

Your information leaves your device in two ways.

### 1. Into the job application you fill

When you click **Fill this page** or press the shortcut, JobScript puts your information into that form on the job site, the same as if you typed it yourself.

- The job site, and the employer it serves, can read what is in its form fields, even before you submit.
- Some sites, including Lever, upload and read your resume as soon as it is attached.
- For searchable fields such as school or location, JobScript types into the site's search box to find the matching option, so the site's own search receives that text.

JobScript never submits an application for you.

### 2. To Anthropic, only if you turn on AI answers

AI answers are **off by default**. If you turn them on and add your own Anthropic API key, then each time you click Fill, JobScript sends these to Anthropic's API (`api.anthropic.com`) to ask Claude to suggest answers:

- the questions JobScript couldn't answer, with their answer options
- your profile: name, city, links, work authorization, skills, work history, education and saved answers
- your resume text, with email addresses, phone numbers and street addresses removed
- the job title and description from the page

JobScript never sends your email, phone number, street address, ZIP code or self-identification (EEO) answers. It also never asks the AI questions about consent, signatures, SSN, date of birth or similar sensitive topics.

The request is authenticated with your API key and billed to your Anthropic account. Anthropic's commercial terms and privacy policy govern how Anthropic handles it. JobScript uses no intermediary server; the request goes straight from your browser to Anthropic.

Claude's answers only appear as suggestions in JobScript's side panel. None are typed into the form until you click Accept or Insert. You can turn AI answers off at any time, which also removes the extension's permission to contact Anthropic.

## What JobScript does not do

- It does not sell, rent or share your data with anyone.
- It does not use your data for advertising, profiling or any purpose other than filling forms you choose to fill.
- It does not collect browsing history. It runs only on Greenhouse and Lever application pages, or on another page when you explicitly click Fill there.

## Your control

- Edit or delete any field on the options page at any time.
- **Export** saves your profile, resume and resume text to a JSON file you choose. It never includes your API key. **Import** loads one back.
- **Remove key** deletes your saved API key.
- Uninstalling JobScript deletes all of its stored data from your browser.

## Contact

Questions: open an issue at https://github.com/KaranDhamiSac/JobScript/issues
