# JobScript Privacy Policy

_Last updated: 2026-09-29_

JobScript is a browser extension that fills job application forms with information you save in it. This policy explains what happens to that information.

## What JobScript stores

JobScript stores the details you enter on its options page:

- contact details, links, skills and work-eligibility answers
- optional demographic (EEO) answers, which default to "Decline to answer"
- work history, education and your saved question-and-answer pairs (your "bank"), including date rules such as "2 weeks from today"
- your saved answers per canonical question (for example "how did you hear about us", languages, a salary range or start-date rule), the different wordings each was asked in and when it was last used, and how each question wording was classified (generic, changing or job-specific). Answers to job-specific questions are never saved automatically
- answers you save for a specific site's fields, and for sites you teach with Learn mode, the order of the form's steps and which fields each step has. These are stored per site address (for example `https://portal.example.edu`); you can see and delete them under "Saving answers" on the options page
- up to three references: their name, company, relationship to you, email, phone, years known and whether employers may contact them. JobScript only puts these into application forms you fill; it never sends them to Claude
- your resume PDF, and its plain text (extracted on your device when you upload it)
- if you use the Claude features: your Anthropic API key and your chosen model
- your application tracker (company, job title, job ID, page address, the dates you filled and applied, and the status of each application) and your daily application goal
- resumes you upload for a specific job, or tailored resumes you approve, saved with their application (the most recent 60)
- the full text of each job posting you fill an application for, saved with its tracker entry (the most recent 300), and Claude's breakdown of it once you tailor or write a cover letter
- company profiles you research: the company's name and website, and its mission, values, products, news and culture as found on the web, each with its source address (the most recent 200), plus anything you add
- cover letters you save, as text and PDF, with their application (the most recent 150), and your research mode and cover letter tone and length

## Where it is stored

Everything is stored locally, in your browser's extension storage (`chrome.storage.local`), on your own device. JobScript doesn't use browser sync, so nothing copies to your other devices.

This storage is not encrypted. Anyone with access to your browser profile could read it, including your API key if you saved one.

Reading text out of your resume PDF always happens on your device, using a copy of pdf.js bundled inside the extension. **Import on this device** also turns that text into a draft profile on your device.

## Files saved to your computer

If you choose to, the **Job description** page saves the job description and the resume you used into `Downloads/JobScript/<Company>/<Job title>/` on your computer. This uses the browser's "downloads" permission, which JobScript asks for the first time you save and which you can revoke in your browser's extension settings. The files stay on your computer.

## What JobScript sends, and to whom

**By default, nothing.** JobScript has no servers and no analytics or tracking. Unless you click **Import with Claude**, **Tailor & Fill**, a company research button or **Write cover letter**, or turn on AI answers, it makes no network requests. (Reading a job posting happens on the page you're on; on an /apply page JobScript also loads the posting page on the same site.)

Your information leaves your device in the ways below.

### 1. Into the job application you fill

When you click **Fill this page** or press the shortcut, JobScript puts your information into that form on the job site, the same as if you typed it yourself.

- The job site, and the employer it serves, can read what is in its form fields, even before you submit.
- Some sites, including Lever, Ashby, Workday and iCIMS, upload and read your resume as soon as it is attached. iCIMS reloads the page to do so.
- For searchable fields such as school or location, JobScript types into the site's search box to find the matching option, so the site's own search receives that text.

JobScript never submits an application for you.

### 2. To Anthropic, only if you click Import with Claude

With an API key saved, the options page shows **Import with Claude**. Clicking it reads your name, email, phone number, address and links on your device, takes them out of your resume's text, and sends the rest to Anthropic's API so Claude can turn it into a draft profile for you to review. Your contact details are filled back in on your device. Nothing is sent when you upload a resume; only when you click that button. **Import on this device** reads the resume without sending anything.

### 3. To Anthropic, only if you click Tailor & Fill

**Tailor & Fill** sends Anthropic your master resume (jobs, projects, bullet points, skills and education, without your name or contact details), the job posting from the page, Claude's breakdown of it, and the company's profile if you've researched it, so Claude can pick, reorder and reword your existing bullets for that job and write a summary. The tailored PDF is then built on your device with a bundled PDF library, and nothing is used until you approve it.

### Job and company research, and cover letters

These only run when you click their buttons.

- **Reading a job description** sends Anthropic the job posting (title, company and text). Nothing about you.
- **Company research, website mode** first asks your permission to read that one company's website, then JobScript fetches up to eight of its pages (home, About, Mission, Values, Careers, Culture) directly from the company's site, without cookies, and removes the permission again. The company's site sees an ordinary visit from your browser. The pages' text and the company's name go to Anthropic to summarize. Nothing about you.
- **Company research, web search mode** sends Anthropic the company's name and website; Claude searches the web through Anthropic's web search tool, which costs $10 per 1,000 searches on your Anthropic account (at most five per run; the estimate is shown before you click). Nothing about you.
- **Write cover letter** sends Anthropic your master resume (as for Tailor & Fill, without your name or contact details), the job breakdown and the company profile. Your name, contact line and sign-off are added on your device when the letter and PDF are built.

Text from job postings and company websites is sent to Claude inside labeled tags, with instructions to treat it as information only and to ignore any instructions it contains.

### 4. To Anthropic, only if you turn on AI answers

AI answers are **off by default**. If you turn them on and add your own Anthropic API key, then each time you click Fill, JobScript sends these to Anthropic's API (`api.anthropic.com`) to ask Claude to suggest answers:

- the questions JobScript couldn't answer, with their answer options
- your profile: country, work authorization, skills, work history, education and saved answers
- your full resume text, with your name, email addresses, phone numbers, street addresses and links removed
- the job title and description from the page

When you answer a question whose wording JobScript's rules don't recognize, and AI answers are on, it sends only that question's wording and its answer options (not your answer) to Anthropic so Claude Haiku can say whether it's generic, changing or job-specific. Each wording is sent at most once.

When answering questions, JobScript never sends your name, email, phone number, street address, city, ZIP code, profile links or self-identification (EEO) answers.

**Agent mode** (off unless you turn it on, and started by your click) sends Claude a text snapshot of the form, the job posting, and the same profile and saved answers as AI answers. Your contact details are sent only as placeholders such as `{{email}}`: when the agent fills a field with one, JobScript types the real value on your device, and your values on the page are shown to Claude as the same placeholders. Screenshots (off by default) are images of the page and can show what's typed in it. It also never asks the AI questions about consent, signatures, SSN, date of birth or similar sensitive topics.

Requests to Anthropic (all of these features) are authenticated with your API key and billed to your Anthropic account. Anthropic's commercial terms and privacy policy govern how Anthropic handles it. JobScript uses no intermediary server; requests go straight from your browser to Anthropic.

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
