# JobScript Privacy Policy

_Last updated: 2026-09-29_

JobScript is a browser extension that fills job application forms with information you save in it. This policy explains what happens to that information.

## What JobScript stores

JobScript stores the details you enter on its options page:

- contact details, links, skills and work-eligibility answers
- optional demographic (EEO) answers, which default to "Decline to answer"
- work history, education and your saved question-and-answer pairs (your "bank"), including date rules such as "2 weeks from today"
- answers you save for a specific site's fields, and for sites you teach with Learn mode, the order of the form's steps and which fields each step has. These are stored per site address (for example `https://portal.example.edu`); you can see and delete them under "Saving answers" on the options page
- up to three references: their name, company, relationship to you, email, phone, years known and whether employers may contact them. JobScript only puts these into application forms you fill; it never sends them to Claude
- your resume PDF, and its plain text (extracted on your device when you upload it)
- if you use the Claude features: your Anthropic API key and your chosen model
- your application tracker (company, job title, job ID, page address, the dates you filled and applied, and the status of each application) and your daily application goal
- resumes you upload for a specific job, or tailored resumes you approve, saved with their application (the most recent 60)

## Where it is stored

Everything is stored locally, in your browser's extension storage (`chrome.storage.local`), on your own device. JobScript doesn't use browser sync, so nothing copies to your other devices.

This storage is not encrypted. Anyone with access to your browser profile could read it, including your API key if you saved one.

Reading text out of your resume PDF always happens on your device, using a copy of pdf.js bundled inside the extension. **Import on this device** also turns that text into a draft profile on your device.

## Files saved to your computer

If you choose to, the **Job description** page saves the job description and the resume you used into `Downloads/JobScript/<Company>/<Job title>/` on your computer. This uses the browser's "downloads" permission, which JobScript asks for the first time you save and which you can revoke in your browser's extension settings. The files stay on your computer.

## What JobScript sends, and to whom

**By default, nothing.** JobScript has no servers and no analytics or tracking. Unless you click **Import with Claude** or **Tailor & Fill**, or turn on AI answers, it makes no network requests.

Your information leaves your device in four ways.

### 1. Into the job application you fill

When you click **Fill this page** or press the shortcut, JobScript puts your information into that form on the job site, the same as if you typed it yourself.

- The job site, and the employer it serves, can read what is in its form fields, even before you submit.
- Some sites, including Lever, Ashby, Workday and iCIMS, upload and read your resume as soon as it is attached. iCIMS reloads the page to do so.
- For searchable fields such as school or location, JobScript types into the site's search box to find the matching option, so the site's own search receives that text.

JobScript never submits an application for you.

### 2. To Anthropic, only if you click Import with Claude

With an API key saved, the options page shows **Import with Claude**. Clicking it sends your resume's text to Anthropic's API, so Claude can turn it into a draft profile for you to review. The text includes everything on your resume, **including your name, email, phone number and address**, because those are the details being imported. Nothing is sent when you upload a resume; only when you click that button. **Import on this device** reads the resume without sending anything.

### 3. To Anthropic, only if you click Tailor & Fill

**Tailor & Fill** sends Anthropic your master resume (jobs, projects, bullet points, skills and education, without your name or contact details) and the job posting from the page, so Claude can pick, reorder and reword your existing bullets for that job. The tailored PDF is then built on your device with a bundled PDF library, and nothing is used until you approve it.

### 4. To Anthropic, only if you turn on AI answers

AI answers are **off by default**. If you turn them on and add your own Anthropic API key, then each time you click Fill, JobScript sends these to Anthropic's API (`api.anthropic.com`) to ask Claude to suggest answers:

- the questions JobScript couldn't answer, with their answer options
- your profile: name, city, links, work authorization, skills, work history, education and saved answers
- your full resume text, with email addresses, phone numbers and street addresses removed
- the job title and description from the page

When answering questions, JobScript never sends your email, phone number, street address, ZIP code or self-identification (EEO) answers. It also never asks the AI questions about consent, signatures, SSN, date of birth or similar sensitive topics.

Requests to Anthropic (both features) are authenticated with your API key and billed to your Anthropic account. Anthropic's commercial terms and privacy policy govern how Anthropic handles it. JobScript uses no intermediary server; requests go straight from your browser to Anthropic.

Claude's answers only appear as suggestions in JobScript's side panel. None are typed into the form until you click Accept or Insert. You can turn AI answers off at any time, which also removes the extension's permission to contact Anthropic.

## What JobScript does not do

- It does not sell, rent or share your data with anyone.
- It does not use your data for advertising, profiling or any purpose other than filling forms you choose to fill.
- It does not collect browsing history. It runs only on the job sites listed in its manifest (Greenhouse, Lever, Ashby, Workday, iCIMS, SmartRecruiters, SuccessFactors, Taleo, Oracle Recruiting, UKG and Handshake), on another page when you explicitly click Fill there, and on sites you chose to teach with Learn mode and gave access to (one site at a time, asked for when you click "Learn this site's steps"). On those sites it only reads the form and shows its panel or its floating button; it fills nothing until you click.
- It never puts your profile data in the page's DOM attributes or JavaScript globals. The panel and its button live in a closed shadow root that page scripts can't open; the panel's summary line shows field labels from the form, not your answers.
- Learn mode and saving answers never record uploads, checkboxes, demographic or reference questions, or sensitive questions (such as Social Security number or date of birth).

## Your control

- Edit or delete any field on the options page at any time.
- **Export** saves your profile, resume, resume text and site answers to a JSON file you choose. It never includes your API key. **Import** loads one back.
- **Forget site**, under "Saving answers" on the options page, deletes what JobScript saved for a site and removes the access you gave it.
- **Remove key** deletes your saved API key.
- Uninstalling JobScript deletes all of its stored data from your browser.

## Contact

Questions: open an issue at https://github.com/KaranDhamiSac/JobScript/issues
