// Finds the job posting on the page you're viewing: title, company, location, pay (if shown),
// job ID, URL, full description and where to apply. Reads the page only: it never clicks,
// scrolls, types or navigates, which matters on LinkedIn and Indeed.
//
// Order: the site's own layout (LinkedIn, Indeed, Glassdoor, Handshake, Greenhouse, Lever,
// Workday, Ashby, iCIMS, SmartRecruiters), then schema.org JobPosting JSON-LD, then page
// heuristics (a heading, a long description with job sections, and an apply link).
//
// JobScriptDetect.detect(doc, url) -> posting or null
//   posting: { title, company, location, pay, jobId, url, description, applyUrl, applyHere,
//              site, source: 'site' | 'jsonld' | 'heuristic', readOnly }
//   readOnly: a job board JobScript only reads (LinkedIn, Indeed, Glassdoor); applying happens
//             on the employer's site.
(function () {
  if (globalThis.JobScriptDetect) return;

  const MAX_DESCRIPTION = 30000;

  function clean(s) {
    return String(s || '').replace(/\s+/g, ' ').trim();
  }

  // Block text with its line breaks, without runs of blank lines.
  function blockText(node) {
    if (!node) return '';
    const text = node.innerText !== undefined && node.innerText !== '' ? node.innerText : node.textContent || '';
    return String(text).replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function first(doc, selectors) {
    for (const sel of selectors) {
      let node = null;
      try {
        node = doc.querySelector(sel);
      } catch (e) {
        continue; // a selector this browser doesn't support
      }
      if (node && clean(node.textContent)) return node;
    }
    return null;
  }

  function firstText(doc, selectors) {
    const node = first(doc, selectors);
    return clean(node && node.textContent);
  }

  function nonEmpty(obj) {
    return Object.fromEntries(Object.entries(obj || {}).filter(([, v]) => v));
  }

  // The longest matching block, so a short header that shares a class doesn't win.
  function longestText(doc, selectors) {
    let best = '';
    for (const sel of selectors) {
      let nodes = [];
      try {
        nodes = doc.querySelectorAll(sel);
      } catch (e) {
        continue;
      }
      for (const node of nodes) {
        if (node.querySelector && node.querySelector('input:not([type=hidden]), select, textarea')) continue; // a form, not the posting
        const text = blockText(node);
        if (text.length > best.length) best = text;
      }
      if (best.length > 200) return best;
    }
    return best;
  }

  function absoluteUrl(href, base) {
    try {
      const u = base ? new URL(href, base) : new URL(href);
      return /^https?:$/.test(u.protocol) ? u.href : '';
    } catch (e) {
      return '';
    }
  }

  // A job board's redirect wrapper (linkedin.com/redir/redirect/?url=…) to the address inside.
  function unwrapRedirect(href) {
    try {
      const u = new URL(href);
      const inner = u.searchParams.get('url') || u.searchParams.get('dest') || u.searchParams.get('target');
      if (inner && /\/redir|\/rc\/clk|\/redirect|\/applystart|\/partner\/joblisting/i.test(u.pathname)) return absoluteUrl(inner) || href;
    } catch (e) {
      /* keep it */
    }
    return href;
  }

  function hostOf(url) {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch (e) {
      return '';
    }
  }

  // Pay ranges as written on the page: "$120,000 - $150,000", "$45/hr", "$90K–$110K a year".
  // "$75K/yr - $95K/yr" puts the unit after each number.
  const PAY_NUM = String.raw`(?:US)?\$\s?\d[\d,]*(?:\.\d+)?\s?[kK]?(?:\s?\/\s?(?:hr|hour|yr|year))?`;
  const PAY_RE = new RegExp(`${PAY_NUM}(?:\\s?(?:-|–|—|to)\\s?${PAY_NUM.replace('\\$', '\\$?')})?(?:\\s?(?:\\/|per|an?)\\s?(?:hour|hr|year|yr|annum|month|mo|week|wk)\\b)?`);

  function payIn(text) {
    const m = String(text || '').match(PAY_RE);
    return m ? clean(m[0]) : '';
  }

  function payFrom(text) {
    const lines = String(text || '').split('\n');
    // A line that talks about pay first ("Salary: $X - $Y"), then any range in the text.
    for (const line of lines) {
      if (!/salary|compensation|pay range|pay rate|base pay|hourly|wage|\$\s?\d/i.test(line)) continue;
      const m = line.match(PAY_RE);
      if (m && /\d{2}/.test(m[0]) && (/[-–—]|to|\/|per|an? (hour|year)|[kK]\b/.test(m[0]) || /salary|compensation|pay/i.test(line))) return clean(m[0]);
    }
    return '';
  }

  // ---------------------------------------------------------------------------
  // schema.org JobPosting JSON-LD

  function jsonLdPostings(doc) {
    const out = [];
    for (const node of doc.querySelectorAll('script[type="application/ld+json"]')) {
      let data;
      try {
        data = JSON.parse(node.textContent);
      } catch (e) {
        continue;
      }
      const all = [].concat(data, (data && data['@graph']) || []);
      for (const d of all) {
        const type = d && d['@type'];
        if (type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'))) out.push(d);
      }
    }
    return out;
  }

  // JSON-LD descriptions are HTML, sometimes escaped twice (&lt;p&gt;); decoded until plain.
  function htmlToText(html, doc, depth) {
    const withBreaks = String(html || '').replace(/<br\s*\/?>|<\/(p|li|h\d|div|ul|ol)>/gi, '$&\n');
    let text;
    try {
      const parsed = new DOMParser().parseFromString(withBreaks, 'text/html');
      text = (parsed.body.textContent || '').replace(/[ \t\u00a0]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    } catch (e) {
      text = withBreaks.replace(/<[^>]+>/g, ' ');
    }
    return !depth && /<\/?(p|li|ul|br|div|strong|b)\b[^>]*>/i.test(text) ? htmlToText(text, doc, 1) : text;
  }

  function ldLocation(p) {
    if (/telecommute/i.test(p.jobLocationType || '')) return 'Remote';
    const locs = [].concat(p.jobLocation || []);
    const parts = locs.map((l) => {
      const a = (l && l.address) || {};
      if (typeof a === 'string') return a;
      return [a.addressLocality, a.addressRegion, a.addressCountry && typeof a.addressCountry === 'object' ? a.addressCountry.name : a.addressCountry]
        .filter(Boolean).join(', ');
    }).filter(Boolean);
    return [...new Set(parts)].slice(0, 3).join('; ');
  }

  function ldPay(p) {
    const s = p.baseSalary || p.estimatedSalary;
    if (!s || typeof s !== 'object') return '';
    const v = s.value && typeof s.value === 'object' ? s.value : s;
    const cur = s.currency === 'USD' || !s.currency ? '$' : s.currency + ' ';
    const fmt = (n) => (n == null || n === '' ? '' : cur + Number(n).toLocaleString('en-US'));
    const unit = v.unitText ? ' per ' + String(v.unitText).toLowerCase() : '';
    if (v.minValue != null && v.maxValue != null && v.minValue !== v.maxValue) return `${fmt(v.minValue)} - ${fmt(v.maxValue)}${unit}`;
    const one = v.value != null ? v.value : v.minValue != null ? v.minValue : v.maxValue;
    return typeof one === 'number' || /^\d/.test(String(one || '')) ? fmt(one) + unit : '';
  }

  function fromJsonLd(doc, url) {
    const p = jsonLdPostings(doc)[0];
    if (!p) return null;
    const org = p.hiringOrganization;
    const id = p.identifier && typeof p.identifier === 'object' ? p.identifier.value : p.identifier;
    return {
      title: clean(p.title),
      company: clean(org && typeof org === 'object' ? org.name : org),
      location: ldLocation(p),
      pay: ldPay(p),
      jobId: clean(id).slice(0, 80),
      description: htmlToText(p.description, doc),
      applyUrl: p.url && p.directApply !== false ? absoluteUrl(p.url, url) : '',
    };
  }

  // ---------------------------------------------------------------------------
  // Sites. Each: hosts, and read(doc, url) returning the fields it can find. Missing fields are
  // filled from JSON-LD and the page afterwards.

  const APPLY_TEXT = /^(apply|apply now|apply for this (job|position|role)|apply on company (site|website)|apply externally|i'?m interested|start application|submit (your )?application)\b/i;

  // An "Apply" link on the page (a link, never a button: JobScript only follows an address).
  function applyLink(doc, url, selectors) {
    for (const sel of selectors || []) {
      let node = null;
      try {
        node = doc.querySelector(sel);
      } catch (e) {
        continue;
      }
      const href = node && (node.getAttribute('href') || node.getAttribute('data-href'));
      const abs = href ? absoluteUrl(href, url) : '';
      if (abs) return unwrapRedirect(abs);
    }
    for (const a of doc.querySelectorAll('a[href]')) {
      const text = clean(a.textContent || a.getAttribute('aria-label'));
      if (!APPLY_TEXT.test(text) || text.length > 60) continue;
      const abs = absoluteUrl(a.getAttribute('href'), url);
      if (abs && abs !== url && !/^javascript:/i.test(a.getAttribute('href'))) return unwrapRedirect(abs);
    }
    return '';
  }

  const SITES = [
    {
      name: 'LinkedIn',
      readOnly: true,
      hosts: /(^|\.)linkedin\.com$/,
      // A job page, or search results with a job open beside them.
      match: (u) => /^\/jobs\/(view|search|search-results|collections)\b/.test(u.pathname),
      canonical: (u, id) => (id ? `https://www.linkedin.com/jobs/view/${id}/` : ''),
      read(doc) {
        const title = firstText(doc, [
          '.job-details-jobs-unified-top-card__job-title h1', '.job-details-jobs-unified-top-card__job-title',
          '.jobs-unified-top-card__job-title', '.top-card-layout__title', '.topcard__title', 'h1',
        ]);
        const company = firstText(doc, [
          '.job-details-jobs-unified-top-card__company-name a', '.job-details-jobs-unified-top-card__company-name',
          '.jobs-unified-top-card__company-name a', '.jobs-unified-top-card__company-name',
          'a.topcard__org-name-link', '.topcard__org-name-link', '[data-tracking-control-name="public_jobs_topcard-org-name"]',
        ]);
        const location = firstText(doc, [
          '.job-details-jobs-unified-top-card__primary-description-container .tvm__text',
          '.job-details-jobs-unified-top-card__bullet', '.jobs-unified-top-card__bullet',
          '.topcard__flavor--bullet', '.top-card-layout__second-subline .topcard__flavor:not(.topcard__flavor--metadata)',
        ]);
        const pay = payIn(firstText(doc, ['.job-details-preferences-and-skills', '.job-details-jobs-unified-top-card__job-insight--highlight', '.compensation__salary', '.salary.compensation__salary']));
        const description = longestText(doc, [
          '.jobs-description__content', '#job-details', '[componentkey^="JobDetails_AboutTheJob"]',
          '.show-more-less-html__markup', '.description__text', '.jobs-box__html-content',
        ]);
        // Off-site Apply on the guest page is a real link; on the signed-in page it's a button
        // with no address, so you press it yourself.
        const applyUrl = applyLink(doc, doc.URL, ['a[data-tracking-control-name="public_jobs_apply-link-offsite"]', 'a.jobs-apply-button[href^="http"]']);
        const fromTitle = clean(doc.title).match(/^(?:\(\d+\)\s*)?(.+?) \| (.+?) \| LinkedIn$/);
        const og = doc.querySelector('meta[property="og:title"]');
        const fromOg = og && clean(og.content).match(/^(.+?) hiring (.+?) in (.+?) \| LinkedIn$/);
        return {
          title: title || (fromTitle && fromTitle[1]) || (fromOg && fromOg[2]) || '',
          company: company || (fromTitle && fromTitle[2]) || (fromOg && fromOg[1]) || '',
          location: location || (fromOg && fromOg[3]) || '',
          pay,
          description,
          applyUrl,
        };
      },
    },
    {
      name: 'Indeed',
      readOnly: true,
      hosts: /(^|\.)indeed\.[a-z.]+$/,
      match: (u) => /^\/(viewjob|jobs|q-|m\/viewjob|cmp\/[^/]+\/jobs)/.test(u.pathname) || u.searchParams.has('vjk') || u.searchParams.has('jk'),
      canonical: (u, id) => (id ? `${u.origin}/viewjob?jk=${id}` : ''),
      read(doc, url) {
        const title = firstText(doc, [
          '[data-testid="jobsearch-JobInfoHeader-title"]', 'h1.jobsearch-JobInfoHeader-title', '.jobsearch-JobInfoHeader-title', 'h2.jobsearch-JobInfoHeader-title',
        ]).replace(/\s*-\s*job post$/i, '');
        const company = firstText(doc, [
          '[data-testid="inlineHeader-companyName"] a', '[data-testid="inlineHeader-companyName"]', '[data-company-name="true"]',
          '.jobsearch-CompanyInfoContainer a', '.jobsearch-InlineCompanyRating > div:first-child',
        ]);
        const location = firstText(doc, ['[data-testid="inlineHeader-companyLocation"]', '[data-testid="job-location"]', '#jobLocationText', '.jobsearch-JobInfoHeader-subtitle > div:last-child']);
        const pay = firstText(doc, ['#salaryInfoAndJobType [class*="salary"]', '#salaryInfoAndJobType span:first-child', '[data-testid="jobsearch-OtherJobDetailsContainer"] [aria-label*="Pay" i]', '[aria-label="Pay"]']);
        const description = longestText(doc, ['#jobDescriptionText', '.jobsearch-jobDescriptionText', '[data-testid="jobsearch-JobComponent-description"]']);
        // "Apply on company site" is a link to the employer (through Indeed's redirect);
        // "Apply now" (Indeed Apply) stays on Indeed, so there's no link to follow.
        const applyUrl = applyLink(doc, url, ['#applyButtonLinkContainer a[href]', '#applyButtonLinkContainer [href]', 'a[href*="/applystart"]', 'a[aria-label*="company site" i]']);
        return { title, company, location, pay: payIn(pay), description, applyUrl };
      },
    },
    {
      name: 'Glassdoor',
      readOnly: true,
      hosts: /(^|\.)glassdoor\.[a-z.]+$/,
      match: (u) => /\/(job-listing|Job)\b/i.test(u.pathname) || u.searchParams.has('jl'),
      read(doc, url) {
        return {
          title: firstText(doc, ['[data-test="job-title"]', '[data-test="jobTitle"]', 'h1']),
          company: firstText(doc, ['[data-test="employer-name"]', '[data-test="employerName"]', '[class*="EmployerProfile_employerName"]']).replace(/\s*\d\.\d\s*★?$/, ''),
          location: firstText(doc, ['[data-test="location"]', '[data-test="emp-location"]']),
          pay: firstText(doc, ['[data-test="detailSalary"]', '[data-test="salary-estimate"]', '[class*="SalaryEstimate"]']),
          description: longestText(doc, ['[class*="JobDetails_jobDescription"]', '[data-test="jobDescriptionContent"]', '.jobDescriptionContent', '#JobDescriptionContainer']),
          applyUrl: applyLink(doc, url, ['a[data-test="applyButton"]', '[data-test="apply-button"] a', 'a[data-test="job-apply-button"]']),
        };
      },
    },
    {
      name: 'Handshake',
      hosts: /(^|\.)joinhandshake\.com$/,
      match: (u) => /^\/(?:stu\/)?(?:jobs|job-search(?:-new)?)\/\d+/.test(u.pathname),
      read(doc, url) {
        const root = first(doc, ['[data-hook="job-details-page"]', '[data-hook="job-details"]', 'main']) || doc;
        return {
          title: firstText(root, ['h1', '[data-hook="job-title"]']),
          company: firstText(root, ['a[href*="/e/"]', 'a[href*="/employers/"]', '[data-hook="employer-name"]']),
          location: firstText(root, ['[data-hook="job-location"]', 'a[href*="/locations/"]']),
          pay: '',
          description: longestText(doc, ['[data-hook="job-description"]', '[data-hook="job-details"]', '[class*="description"]']),
          applyUrl: '',
        };
      },
    },
    {
      name: 'Greenhouse',
      hosts: /(^|\.)greenhouse\.io$/,
      match: (u) => /\/jobs\/\d+/.test(u.pathname) || /\/embed\/job_app/.test(u.pathname),
      read(doc, url) {
        const m = clean(doc.title).match(/^Job Application for (.+?) at (.+)$/i);
        const hasForm = !!doc.querySelector('#application-form, #application_form, form#application, [id^="application"] input');
        return {
          title: firstText(doc, ['.job__title h1', 'h1.app-title', '.job__title', 'h1.section-header', 'h1']) || (m && m[1]) || '',
          company: (m && m[2]) || firstText(doc, ['.company-name', '.logo-container img[alt]']).replace(/\s*logo$/i, ''),
          location: firstText(doc, ['.job__location', '.location', '.job__header .location']),
          pay: firstText(doc, ['.pay-range', '.job__pay-range', '[class*="pay-range"]']),
          description: longestText(doc, ['.job__description', '[class*="job__description"]', '#content .job-post', '#content']),
          applyUrl: hasForm ? '' : applyLink(doc, url, ['a[href*="#app"]', 'a.btn--apply']),
          applyHere: hasForm,
        };
      },
    },
    {
      name: 'Lever',
      hosts: /(^|\.)lever\.co$/,
      match: (u) => /^\/[^/]+\/[0-9a-f-]{36}/i.test(u.pathname),
      read(doc, url) {
        const m = clean(doc.title).match(/^(.+?)\s+-\s+(.+)$/);
        const apply = /\/apply\/?$/.test(new URL(url).pathname);
        const descParts = [...doc.querySelectorAll('.section-wrapper.page-full-width .section, [data-qa="job-description"], [data-qa="closing-description"]')].map(blockText).filter(Boolean);
        return {
          title: firstText(doc, ['.posting-headline h2', '.posting-header h2']) || (m && m[2]) || '',
          company: (m && m[1]) || '',
          location: firstText(doc, ['.posting-categories .location', '.posting-category.location', '.sort-by-time']),
          pay: firstText(doc, ['.posting-categories .compensation', '[data-qa="salary-range"]', '.salary-range']),
          description: descParts.join('\n\n') || longestText(doc, ['.section-wrapper.page-full-width', '.posting-page']),
          applyUrl: apply ? '' : applyLink(doc, url, ['a.postings-btn[href*="/apply"]', '.postings-btn-wrapper a[href*="/apply"]', 'a[data-qa="btn-apply-bottom"]']),
          applyHere: apply,
        };
      },
    },
    {
      name: 'Ashby',
      hosts: /(^|\.)ashbyhq\.com$/,
      match: (u) => /^\/[^/]+\/[0-9a-f-]{36}/i.test(u.pathname),
      read(doc, url) {
        const m = clean(doc.title).match(/^(.+?) @ (.+)$/);
        const apply = /\/application\/?$/.test(new URL(url).pathname);
        const leftPane = [...doc.querySelectorAll('[class*="_section_"], .ashby-job-posting-left-pane > div')].map((n) => ({ h: clean((n.querySelector('h2') || {}).textContent), t: clean(n.textContent) }));
        const pick = (re) => {
          const hit = leftPane.find((x) => re.test(x.h));
          return hit ? clean(hit.t.replace(hit.h, '')) : '';
        };
        return {
          title: firstText(doc, ['.ashby-job-posting-heading', 'h1']) || (m && m[1]) || '',
          company: (m && m[2]) || '',
          location: pick(/^location$/i),
          pay: pick(/^compensation$/i),
          description: longestText(doc, ['.ashby-job-posting-right-pane-overview-tab', '[class*="_descriptionText_"]', '#overview']),
          applyUrl: apply ? '' : url.replace(/\/?(\?.*)?$/, '/application'),
          applyHere: apply,
        };
      },
    },
    {
      name: 'Workday',
      hosts: /\.myworkday(jobs|site)\.com$/,
      match: (u) => /\/job\//.test(u.pathname),
      read(doc, url) {
        const apply = /\/apply(\/|$)/.test(new URL(url).pathname);
        return {
          title: firstText(doc, ['[data-automation-id="jobPostingHeader"]', 'h2[data-automation-id="jobPostingHeader"]', 'h1']),
          company: '',
          location: firstText(doc, ['[data-automation-id="locations"] dd', '[data-automation-id="locations"]']).replace(/^locations\s*/i, ''),
          pay: '',
          description: longestText(doc, ['[data-automation-id="jobPostingDescription"]']),
          applyUrl: apply ? '' : applyLink(doc, url, ['a[data-automation-id="adventureButton"]', 'a[data-uxi-element-id="Apply_adventureButton"]']),
          applyHere: apply,
        };
      },
    },
    {
      name: 'iCIMS',
      hosts: /(^|\.)icims\.com$/,
      match: (u) => /\/jobs\/\d+/.test(u.pathname),
      read(doc, url) {
        // The posting is often in a same-site iframe inside the careers page.
        const frame = doc.querySelector('#icims_content_iframe');
        let inner = null;
        try {
          inner = frame && frame.contentDocument;
        } catch (e) {
          inner = null;
        }
        const d = inner && inner.body ? inner : doc;
        return {
          title: firstText(d, ['.iCIMS_Header h1', 'h1.iCIMS_Header', '.iCIMS_JobHeaderTitle', 'h1']),
          company: '',
          location: firstText(d, ['.iCIMS_JobHeaderTag .iCIMS_JobHeaderData', '.header.left span:not(.field-label)']),
          pay: '',
          description: longestText(d, ['.iCIMS_JobContent', '.iCIMS_InfoMsg_Job', '.iCIMS_Expandable_Text']),
          applyUrl: applyLink(d, url, ['a.iCIMS_ApplyOnlineButton', 'a[href*="mode=apply"]', 'a[title*="Apply" i]']),
        };
      },
    },
    {
      name: 'SmartRecruiters',
      hosts: /(^|\.)smartrecruiters\.com$/,
      match: (u) => /^\/[^/]+\/\d{6,}/.test(u.pathname),
      read(doc, url) {
        return {
          title: firstText(doc, ['h1.job-title', '[itemprop="title"]', 'h1']),
          company: firstText(doc, ['[itemprop="hiringOrganization"] [itemprop="name"]', '.header-logo img[alt]']) ||
            clean((doc.querySelector('meta[itemprop="name"]') || {}).content),
          location: firstText(doc, ['[itemprop="jobLocation"]', '.job-detail-location', 'spl-job-location']),
          pay: '',
          description: longestText(doc, ['[itemprop="description"]', '.job-sections', 'main']),
          applyUrl: applyLink(doc, url, ['a#st-apply', 'a.js-oneclick', 'a[href*="oneclick-ui"]']),
        };
      },
    },
  ];

  // ---------------------------------------------------------------------------
  // Heuristics for a company's own careers page with no JSON-LD.

  const SECTION_WORDS = /\b(responsibilities|requirements|qualifications|what you('|’)ll do|what we('|’)re looking for|about the (role|job|position|team)|who you are|minimum qualifications|preferred qualifications|benefits|job description|duties)\b/gi;
  const JOBBY_URL = /\b(jobs?|careers?|positions?|openings?|opportunit(y|ies)|requisitions?|vacanc(y|ies)|postings?)\b/i;

  function heuristic(doc, url) {
    const h1 = doc.querySelector('h1');
    const title = clean(h1 && h1.textContent);
    if (!title || title.length > 140) return null;
    const main = doc.querySelector('main, [role="main"], article') || doc.body;
    if (!main) return null;
    // The block under the heading with the most job-section words.
    let best = null;
    for (const node of [main, ...main.querySelectorAll('section, article, div')]) {
      const text = blockText(node);
      if (text.length < 400 || text.length > 60000) continue;
      const sections = new Set((text.match(SECTION_WORDS) || []).map((w) => w.toLowerCase())).size;
      if (sections < 2) continue;
      // Prefer the smallest block that still has the sections (not the whole page).
      if (!best || sections > best.sections || (sections === best.sections && text.length < best.text.length)) best = { text, sections };
    }
    if (!best) return null;
    const applyUrl = applyLink(doc, url);
    const applyHere = !!doc.querySelector('form input[type="file"], form input[type="email"]');
    if (!applyUrl && !applyHere && !JOBBY_URL.test(new URL(url).pathname)) return null;
    const og = doc.querySelector('meta[property="og:site_name"]');
    return {
      title,
      company: clean(og && og.content),
      location: locationNear(h1),
      pay: '',
      description: best.text,
      applyUrl,
      applyHere,
    };
  }

  // A short line just under the heading that names a place: "Denver, CO · Full-time", "Remote".
  const PLACE_RE = /\b([A-Z][a-zA-Z.'-]+(?: [A-Z][a-zA-Z.'-]+)*, (?:[A-Z]{2}|[A-Z][a-z]+)(?: \d{5})?|Remote(?: \([^)]{2,30}\))?|Hybrid|On-?site)\b/;

  function locationNear(h1) {
    let node = h1;
    for (let i = 0; i < 3 && node; i++) {
      node = node.nextElementSibling;
      const text = clean(node && node.textContent);
      if (!text || text.length > 120) continue;
      const m = text.match(PLACE_RE);
      if (m) return m[1];
    }
    return '';
  }

  // ---------------------------------------------------------------------------

  function jobIdOf(url) {
    const S = globalThis.JobScriptStorage;
    return S && S.jobIdFromUrl ? S.jobIdFromUrl(url) : '';
  }

  function companyFromHost(url) {
    const host = hostOf(url).replace(/^(www|careers?|jobs|apply|work|join)\./, '');
    const name = host.split('.')[0] || '';
    return name ? name.charAt(0).toUpperCase() + name.slice(1) : '';
  }

  function detect(doc, rawUrl) {
    doc = doc || document;
    const url = rawUrl || (doc.location && doc.location.href) || '';
    let u;
    try {
      u = new URL(url);
    } catch (e) {
      return null;
    }
    const site = SITES.find((s) => s.hosts.test(u.hostname.toLowerCase()));
    if (site && !site.match(u)) return null; // a search or profile page with no job open
    const fromSite = site ? site.read(doc, url) : null;
    const fromLd = fromJsonLd(doc, url);
    let source = fromSite && fromSite.title && fromSite.description ? 'site' : fromLd ? 'jsonld' : '';
    // The site's own layout wins where it found something; JSON-LD fills the gaps.
    let posting = Object.assign({}, fromLd, nonEmpty(fromSite));
    if (!source && !site) {
      const h = heuristic(doc, url);
      if (h) {
        posting = h;
        source = 'heuristic';
      }
    }
    if (!source || !posting.title) return null;

    const description = String(posting.description || '').slice(0, MAX_DESCRIPTION);
    if (description.length < 100) return null; // a heading with nothing under it yet (still loading)
    // On a read-only board, only an address off the board is worth opening (the employer's site).
    if (site && site.readOnly && posting.applyUrl && site.hosts.test(hostOf(posting.applyUrl))) posting.applyUrl = '';
    const jobId = jobIdOf(url) || posting.jobId || '';
    const canonical = site && site.canonical ? site.canonical(u, jobIdOf(url)) : '';
    return {
      title: clean(posting.title).slice(0, 300),
      company: clean(posting.company).slice(0, 200) || (site ? '' : companyFromHost(url)),
      location: clean(posting.location).slice(0, 200),
      pay: clean(posting.pay).slice(0, 120) || payFrom(description),
      jobId: String(jobId).slice(0, 80),
      url: canonical || url,
      description,
      applyUrl: posting.applyUrl || '',
      applyHere: !!posting.applyHere,
      site: site ? site.name : u.hostname,
      source,
      readOnly: !!(site && site.readOnly),
    };
  }

  // Read-only job boards: JobScript reads their job pages and never fills, clicks or navigates there.
  function isReadOnlyBoard(url) {
    const host = hostOf(url);
    return SITES.some((s) => s.readOnly && s.hosts.test(host));
  }

  globalThis.JobScriptDetect = { detect, isReadOnlyBoard, payFrom, _test: { fromJsonLd, heuristic, PAY_RE } };
})();
