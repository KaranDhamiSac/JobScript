// Tests for jobIdFromUrl in lib/storage.js. Run with: node dev/test-job-ids.mjs
// Example URLs follow each platform's public URL shape (docs/platforms/<platform>.md, section 8).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

globalThis.chrome = { storage: { local: {} } };
const require = createRequire(import.meta.url);
require('../lib/storage.js');
const { jobIdFromUrl } = globalThis.JobScriptStorage;

const cases = [
  ['https://job-boards.greenhouse.io/northwind/jobs/4012345007', '4012345007'],
  ['https://careers.example.com/open-roles?gh_jid=4012345007', '4012345007'],
  ['https://jobs.lever.co/northwind/0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0/apply', '0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0'],
  ['https://jobs.ashbyhq.com/northwind/0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0/application', '0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0'],
  ['https://www.example.com/careers?ashby_jid=0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0', '0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0'],
  ['https://northwind.wd5.myworkdayjobs.com/en-US/External/job/Fresno-CA/Data-Analyst_JR2026417', 'JR2026417'],
  ['https://northwind.wd1.myworkdayjobs.com/External/job/Remote/Data-Analyst_JR-0107491/apply/applyManually', 'JR-0107491'],
  ['https://northwind.wd3.myworkdayjobs.com/External/job/UK---IE-_R4046019-2', 'R4046019'],
  ['https://wd5.myworkdaysite.com/en-US/recruiting/northwind/External/job/Fresno/Analyst_26WD101356', '26WD101356'],
  ['https://careers-northwind.icims.com/jobs/75314/data-analyst/job?in_iframe=1', '75314'],
  ['https://jobs.smartrecruiters.com/Northwind/744000153262644-data-analyst', '744000153262644'],
  ['https://jobs.smartrecruiters.com/oneclick-ui/company/Northwind/publication/0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0', '0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0'],
  ['https://career4.successfactors.com/career?company=northwind&career_job_req_id=1738189', '1738189'],
  ['https://northwind.taleo.net/careersection/ext/jobdetail.ftl?job=41299&lang=en', '41299'],
  ['https://eabc.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/344707', '344707'],
  ['https://recruiting.ultipro.com/NOR1000NWND/JobBoard/11111111-2222-3333-4444-555555555555/OpportunityDetail?opportunityId=0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0', '0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0'],
  ['https://secure7.saashr.com/ta/6123456.careers?ShowJob=738638679', '738638679'],
  ['https://app.joinhandshake.com/job-search/12345678', '12345678'],
  ['https://www.linkedin.com/jobs/view/data-analyst-at-northwind-4012345678', '4012345678'],
  ['https://www.linkedin.com/jobs/search-results/?currentJobId=4012345678', '4012345678'],
  ['not a url', ''],
];

for (const [url, want] of cases) assert.equal(jobIdFromUrl(url), want, url);
console.log(`ok - ${cases.length} job ID cases`);
