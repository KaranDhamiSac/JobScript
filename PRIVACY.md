# JobScript Privacy Policy

_Last updated: 2026-09-29_

JobScript is a browser extension that fills job application forms with information you save in it. This policy explains what happens to that information.

## What JobScript stores

The details you enter on JobScript's options page:

- contact details, links and work-eligibility answers
- optional demographic (EEO) answers, which default to "Decline to answer"
- work history, education and your saved question-and-answer pairs
- your resume PDF

## Where it is stored

Everything is stored locally, in your browser's extension storage (`chrome.storage.local`), on your own device. JobScript doesn't use browser sync, so your data doesn't copy to your other devices.

This storage is not encrypted. Anyone with access to your browser profile could read it.

## What JobScript sends

Nothing. JobScript has no servers and no analytics or tracking, and it never makes network requests.

Your information leaves your device only when you ask JobScript to fill a form. It is then placed into that form on the job site, the same as if you typed it yourself:

- The job site (and the employer it serves) can read what is in its form fields, including before you submit. Some sites, including Lever, upload and read your resume as soon as it is attached.
- For searchable fields such as school or location, JobScript types into the site's search box to find the matching option, so the site's own search sees that text.

JobScript only fills a page when you click **Fill this page** or press the keyboard shortcut. It never submits an application for you.

## What JobScript does not do

- It does not sell, rent or share your data with anyone.
- It does not use your data for advertising, profiling or any purpose other than filling forms you choose to fill.
- It does not collect browsing history. It runs only on Greenhouse and Lever application pages, or on another page when you explicitly click Fill there.

## Your control

- Edit or delete any field on the options page at any time.
- **Export** saves a JSON copy of your data to a file you choose; **Import** loads one back.
- Uninstalling JobScript deletes all of its stored data from your browser.

## Future features

If optional AI features are added later (for example, reading a job description), they will be off by default and will use an API key you supply yourself. Turning such a feature on would send the specific text needed for it to that provider. This policy will be updated before any such feature ships.

## Contact

Questions: open an issue at https://github.com/KaranDhamiSac/JobScript/issues
