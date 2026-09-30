// All field-matching rules live here. Edit this file to teach JobScript new sites or fields.
//
// How matching works (see content/autofill.js):
//   Every form field gets a set of descriptor strings: its label text, aria-label, placeholder,
//   name and id. Each string is normalised first: camelCase is split, punctuation like _ - [ ] ( )
//   becomes a space, and everything is lowercased. So name="urls[LinkedIn]" becomes "urls linked in"
//   and id="first_name" becomes "first name".
//
//   For each rule below:
//     keywords      plain phrases, matched as whole words against the normalised text
//     patterns      regexes, tested against the normalised text
//     autocomplete  exact values of the HTML autocomplete attribute (strongest signal)
//     exclude       regexes; if any matches the label/name/id, this rule is skipped
//     type          'text' (default) | 'bool' (yes/no) | 'choice' | 'date' | 'file' | 'long'
//     value         optional function(profile or entry) returning the value to fill;
//                   defaults to profile[key]
//
//   The longest keyword/pattern match wins, so "first name" beats a bare "name".
(function () {
  const DECLINE_ALIASES = [
    /decline/i,
    /prefer not/i,
    /(don'?t|do not) wish/i,
    /(don'?t|do not) want/i,
    /not (to )?(say|disclose|answer|specify|self identify)/i,
    /choose not/i,
    /rather not/i,
    /i don'?t know/i,
  ];

  const MONTHS = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december',
  ];

  const US_STATES = {
    AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
    CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
    FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana',
    IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
    MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
    MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
    NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
    OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
    SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
    VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
    PR: 'Puerto Rico',
  };

  function currentJob(p) {
    return p.workHistory.find((j) => j.current) || p.workHistory[0] || null;
  }

  // Total months worked across work history, counting overlapping jobs once.
  function totalMonths(jobs) {
    const toIndex = (ym) => {
      const m = /^(\d{4})-(\d{2})/.exec(ym || '');
      return m ? Number(m[1]) * 12 + Number(m[2]) - 1 : null;
    };
    const now = new Date();
    const ranges = (jobs || [])
      .map((j) => [toIndex(j.startDate), j.current ? now.getFullYear() * 12 + now.getMonth() : toIndex(j.endDate)])
      .filter(([a, b]) => a !== null && b !== null && b >= a)
      .sort((x, y) => x[0] - y[0]);
    let total = 0;
    let end = -Infinity;
    for (const [a, b] of ranges) {
      const start = Math.max(a, end + 1);
      if (b >= start) total += b - start + 1;
      end = Math.max(end, b);
    }
    return total;
  }

  const FieldMap = {
    // Site-specific settings. `hosts` are matched against location.hostname.
    // `formSelectors` narrow scanning to the application form when one of them exists.
    sites: [
      {
        name: 'Greenhouse',
        hosts: [/^(boards|job-boards|job-boards\.eu)\.greenhouse\.io$/i],
        formSelectors: ['#application-form', '#application_form', 'form#application', '.application--form'],
        jobDescriptionSelectors: ['.job__description', '[class*="job__description"]', '#content .job-post', '#content'],
      },
      {
        name: 'Lever',
        hosts: [/^jobs(\.eu)?\.lever\.co$/i],
        formSelectors: ['form#application-form', 'form[action*="apply"]', '.application-form'],
        jobDescriptionSelectors: ['[data-qa="job-description"]', '.posting-page .section-wrapper', '.content .section-wrapper'],
      },
    ],

    // Top-level profile fields.
    fields: {
      firstName: {
        keywords: ['first name', 'given name', 'fname', 'forename', 'preferred name', 'what would you like us to call you'],
        patterns: [/\bfirst\b.*\bname\b/],
        autocomplete: ['given-name'],
        exclude: [/supervisor|manager|reference|emergency|school|company/i],
      },
      lastName: {
        keywords: ['last name', 'family name', 'surname', 'lname'],
        patterns: [/\blast\b.*\bname\b/],
        autocomplete: ['family-name'],
        exclude: [/supervisor|manager|reference|emergency|school|company/i],
      },
      fullName: {
        keywords: ['full name', 'legal name', 'your name', 'name'],
        autocomplete: ['name'],
        exclude: [
          /first|last|middle|given|family|sur|nick|preferred|user|file|company|employer|organi[sz]ation|school|university|college|supervisor|manager|reference|emergency|referr|recruiter|signature|degree|job|position|project/i,
        ],
        value: (p) => [p.firstName, p.lastName].filter(Boolean).join(' '),
      },
      email: {
        keywords: ['email', 'e mail', 'email address'],
        autocomplete: ['email'],
        exclude: [/supervisor|manager|reference|emergency|referr/i],
      },
      phone: {
        keywords: ['phone', 'phone number', 'mobile', 'cell', 'telephone', 'contact number'],
        autocomplete: ['tel', 'tel-national'],
        exclude: [/supervisor|manager|reference|emergency|country code|extension|\bext\b|type/i],
      },
      address: {
        keywords: ['street address', 'address line 1', 'address 1', 'street', 'mailing address', 'home address', 'address'],
        autocomplete: ['street-address', 'address-line1'],
        exclude: [/e ?mail|web|url|\bip\b|line 2|address 2|city|state|zip|postal|country/i],
      },
      city: {
        keywords: ['city', 'town'],
        autocomplete: ['address-level2'],
        exclude: [/school|company|employer|birth/i],
      },
      state: {
        type: 'choice',
        keywords: ['state', 'province', 'region'],
        patterns: [/\bstate\b/],
        autocomplete: ['address-level1'],
        exclude: [/statement|status|united states|school|company|employer|birth/i],
      },
      zip: {
        keywords: ['zip', 'zip code', 'postal code', 'postcode', 'postal'],
        autocomplete: ['postal-code'],
      },
      country: {
        type: 'choice',
        keywords: ['country', 'country of residence'],
        autocomplete: ['country', 'country-name'],
        exclude: [/code|citizenship|phone|birth/i],
      },
      location: {
        keywords: ['location', 'current location', 'where are you located', 'city and state', 'candidate location'],
        exclude: [/school|company|employer|job location|office|preferred|relocat|work location/i],
        value: (p) => [p.city, p.state].filter(Boolean).join(', '),
      },
      linkedin: {
        type: 'text',
        patterns: [/\blinked ?in\b/],
      },
      github: {
        patterns: [/\bgit ?hub\b/],
      },
      portfolio: {
        keywords: ['portfolio', 'personal website', 'website', 'personal site', 'other website', 'personal url', 'blog'],
        exclude: [/linked ?in|git ?hub|company|twitter|facebook|instagram/i],
      },
      currentCompany: {
        keywords: ['current company', 'current employer', 'most recent employer', 'most recent company', 'org'],
        patterns: [/^(urls? )?org$/],
        value: (p) => currentJob(p)?.employer || '',
      },
      currentTitle: {
        keywords: ['current title', 'current job title', 'current position', 'current role', 'most recent title'],
        value: (p) => currentJob(p)?.title || '',
      },
      workAuthorized: {
        type: 'bool',
        keywords: ['authorized to work', 'authorised to work', 'eligible to work', 'legally authorized', 'work authorization', 'right to work'],
        patterns: [/\b(legally )?(authori[sz]ed|eligible|permitted|able) to work\b/],
      },
      requiresSponsorship: {
        type: 'bool',
        keywords: ['sponsorship', 'require sponsorship', 'visa sponsorship', 'sponsor'],
        patterns: [/\b(require|need)\b.{0,60}\bsponsor/],
        exclude: [/without.{0,30}sponsor/i],
      },
      willingToRelocate: {
        type: 'bool',
        keywords: ['relocate', 'relocation', 'willing to relocate', 'open to relocation'],
        patterns: [/\brelocat/],
      },
      gender: {
        type: 'choice',
        keywords: ['gender', 'gender identity', 'sex'],
        exclude: [/transgender|pronoun|orientation/i],
      },
      hispanic: {
        type: 'choice',
        keywords: ['hispanic', 'latino', 'latina', 'latinx', 'hispanic ethnicity'],
        value: (p) => {
          if (p.race === 'Hispanic or Latino') return 'yes';
          if (!p.race || p.race === JobScriptStorage.DECLINE) return JobScriptStorage.DECLINE;
          return 'no';
        },
      },
      race: {
        type: 'choice',
        keywords: ['race', 'ethnicity', 'race ethnicity', 'racial'],
        exclude: [/hispanic|latino/i],
      },
      veteran: {
        type: 'choice',
        keywords: ['veteran', 'veteran status', 'protected veteran', 'military'],
      },
      disability: {
        type: 'choice',
        keywords: ['disability', 'disability status', 'disabled'],
        exclude: [/signature|\bdate\b|\bname\b/i],
      },
      // Lookups from your profile/resume rather than a single stored answer, so they are only
      // suggested (confidence: 'medium'), never filled automatically.
      skills: {
        type: 'long',
        confidence: 'medium',
        keywords: ['skills', 'technical skills', 'key skills', 'technologies', 'programming languages', 'tech stack', 'tools you use'],
        exclude: [/language skill|years|rate|level|proficien|spoken/i],
      },
      yearsExperience: {
        confidence: 'medium',
        keywords: ['years of experience', 'years of professional experience', 'years of relevant experience', 'years of work experience', 'how many years'],
        // "years of experience with Python" is skill-specific; leave that for you (or the AI fallback).
        exclude: [/\b(with|using|in|of)\s+(?!total|professional|relevant|industry|work|the field|experience)[a-z]/i],
        value: (p) => {
          const months = totalMonths(p.workHistory);
          return months >= 12 ? String(Math.floor(months / 12)) : months > 0 ? '0' : '';
        },
      },
      resume: {
        type: 'file',
        keywords: ['resume', 'résumé', 'cv', 'curriculum vitae'],
        exclude: [/cover/i],
      },
    },

    // Repeating sections. A field belongs to a section when its name/id, an ancestor's id/class,
    // or the nearest heading above it matches the section's `attrPatterns` / `headings`.
    // `anchor` is the sub-field used to count how many entries are already on the page.
    // `addButton` matches the text of the site's "Add another" button inside that section.
    // Sub-fields with `standalone: true` may also match when no section is detected
    // (for forms that ask a single "School" question without a heading).
    sections: {
      workHistory: {
        headings: [/employment/i, /work (history|experience)/i, /\bexperience\b/i, /previous (jobs|employers)/i],
        attrPatterns: [/employment|work[\s_-]?history|experience/i],
        anchor: 'employer',
        addButton: [/^\+?\s*add\s*(another|more|additional|an?|new)?\s*(job|position|employer|employment|work experience|experience|role)?\s*\+?$/i],
        fields: {
          employer: {
            keywords: ['company', 'company name', 'employer', 'employer name', 'organization', 'organisation'],
          },
          title: {
            keywords: ['title', 'job title', 'position', 'position title', 'role'],
            exclude: [/current(ly)?|still/i],
          },
          location: {
            keywords: ['location', 'city', 'job location', 'company location'],
          },
          startDate: {
            type: 'date',
            keywords: ['start date', 'start', 'from', 'date started', 'start month', 'start year'],
            exclude: [/end|to\b|finish/i],
          },
          endDate: {
            type: 'date',
            keywords: ['end date', 'end', 'to', 'date ended', 'end month', 'end year'],
            exclude: [/start|from\b/i],
            value: (e) => (e.current ? '' : e.endDate),
          },
          current: {
            type: 'bool',
            keywords: ['current role', 'current position', 'currently work', 'i currently work', 'current job', 'present', 'still work'],
            value: (e) => (e.current ? 'yes' : ''),
          },
          supervisorName: {
            keywords: ['supervisor', 'supervisor name', 'manager name', 'manager', 'reports to'],
            exclude: [/phone|tel|email|title|contact number/i],
          },
          supervisorPhone: {
            keywords: ['supervisor phone', 'manager phone', 'supervisor telephone'],
            patterns: [/(supervisor|manager).*(phone|tel)/],
          },
          description: {
            type: 'long',
            keywords: ['description', 'responsibilities', 'duties', 'summary', 'accomplishments', 'what did you do'],
          },
        },
      },
      education: {
        headings: [/education/i, /academic/i, /schools?/i],
        attrPatterns: [/educat/i],
        anchor: 'school',
        addButton: [/^\+?\s*add\s*(another|more|additional|an?|new)?\s*(school|education|degree)?\s*\+?$/i],
        fields: {
          school: {
            keywords: ['school', 'school name', 'university', 'college', 'institution'],
            standalone: true,
          },
          degree: {
            type: 'choice',
            keywords: ['degree', 'degree type', 'level of education'],
            exclude: [/major|field|discipline/i],
            standalone: true,
          },
          major: {
            keywords: ['major', 'discipline', 'field of study', 'area of study', 'concentration', 'program'],
            standalone: true,
          },
          gpa: {
            keywords: ['gpa', 'grade point average', 'grades'],
            standalone: true,
          },
          location: {
            keywords: ['location', 'city', 'school location'],
          },
          startDate: {
            type: 'date',
            keywords: ['start date', 'start', 'from', 'date started', 'start month', 'start year'],
            exclude: [/end|to\b|grad/i],
          },
          gradDate: {
            type: 'date',
            keywords: ['graduation date', 'graduation', 'grad date', 'end date', 'end', 'to', 'expected graduation', 'end month', 'end year'],
            exclude: [/start|from\b/i],
            standalone: true,
          },
        },
      },
    },

    // Alternative wordings for stored answers, used when choosing a <select> option,
    // radio button or dropdown item. Keys are the exact values stored in the profile.
    valueAliases: {
      'Decline to answer': DECLINE_ALIASES,
      'United States': [/^united states( of america)?\b/i, /^u\.?s\.?a?\.?$/i],
      Male: [/^male$/i, /^man$/i, /^male\b/i],
      Female: [/^female$/i, /^woman$/i, /^female\b/i],
      'Non-binary': [/non[\s-]?binary/i, /gender ?queer/i],
      'Hispanic or Latino': [/hispanic|latin[oax]/i],
      White: [/^white\b/i],
      'Black or African American': [/black|african american/i],
      Asian: [/^asian\b/i],
      'Native Hawaiian or Other Pacific Islander': [/hawaiian|pacific islander/i],
      'American Indian or Alaska Native': [/american indian|alaska(n)? native|native american/i],
      'Two or More Races': [/two or more|multiracial|multiple races/i],
      'I am not a protected veteran': [/not a (protected )?veteran/i, /i am not/i, /^no\b/i],
      'I identify as a protected veteran': [/identify as (one or more|a protected)/i, /i am a (protected )?veteran/i, /^yes\b/i],
      'Yes, I have a disability': [/^yes\b/i, /yes,? i have/i],
      'No, I do not have a disability': [/^no\b/i, /(do not|don'?t) have a disability/i],
    },

    // Degree matching for the education "Degree" field. Both your saved degree and each option
    // are parsed into a level (first match wins) and an optional field. "BS", "B.S.", "BSc" and
    // "Bachelor of Science" all parse to bachelor/science, so they pick the same option.
    // An option with the same level and field wins, then same level with no field
    // ("Bachelor's Degree"), then same level with a different field.
    // `search` is what gets typed into searchable dropdowns to find the level.
    degrees: {
      levels: [
        { level: 'high school', search: 'High School', patterns: [/high school|secondary school|\bged\b/i] },
        {
          level: 'professional',
          search: 'Doctor',
          patterns: [/\bj\.?\s?d\.?(?![a-z])|juris doctor/i, /\bm\.?\s?d\.?(?![a-z])|doctor of medicine/i, /\bd\.?\s?d\.?\s?s\.?(?![a-z])|pharm\.?\s?d/i],
        },
        { level: 'doctorate', search: 'Doctor', patterns: [/\bdoctor(ate|al)?\b/i, /\bph\.?\s?d\.?(?![a-z])/i, /\bed\.?\s?d\.?(?![a-z])/i] },
        { level: 'master', search: 'Master', patterns: [/\bmaster'?s?\b/i, /\bm\.?\s?(sc|s|a|eng|e|fa|ba|ph|ed|pa|sw)\.?(?![a-z])/i] },
        {
          level: 'bachelor',
          search: 'Bachelor',
          patterns: [/\bbachelor'?s?\b/i, /\bbaccalaureate\b/i, /\bundergrad/i, /\bb\.?\s?(sc|s|a|eng|e|fa|ba|com|arch)\.?(?![a-z])/i],
        },
        { level: 'associate', search: 'Associate', patterns: [/\bassociate'?s?\b/i, /\ba\.?\s?a\.?\s?s\.?(?![a-z])/i, /\ba\.\s?[as]\.(?![a-z])/i, /^\s*a\.?\s?[as]\.?\s*$/i] },
      ],
      fields: [
        { field: 'fine arts', patterns: [/fine arts?/i, /\b[bm]\.?\s?f\.?\s?a\.?(?![a-z])/i] },
        { field: 'business', patterns: [/business administration/i, /\b[bm]\.?\s?b\.?\s?a\.?(?![a-z])/i] },
        { field: 'engineering', patterns: [/\bof engineering\b/i, /\b[bm]\.?\s?(eng|e)\.?(?![a-z])/i] },
        { field: 'science', patterns: [/\bof science\b/i, /\b[bm]\.?\s?sc?\.?(?![a-z])/i] },
        { field: 'arts', patterns: [/\bof arts?\b/i, /\b[bm]\.?\s?a\.?(?![a-z])/i] },
      ],
    },

    // How yes/no answers are recognised in option text. Negatives are checked first,
    // because "I am not ..." also starts with "I am".
    boolAliases: {
      no: [/^\s*no\b/i, /^\s*n$/i, /^\s*false\b/i, /\b(i am not|i'?m not|i do not|i don'?t|i will not|i won'?t|not authori[sz]ed)\b/i],
      yes: [/^\s*yes\b/i, /^\s*y$/i, /^\s*true\b/i, /\b(i am|i'?m|i do|i will|i have)\b/i],
    },

    // Option text that means "nothing chosen yet".
    placeholderOptions: [/^\s*$/, /^\s*(-+|select|choose|please select|please choose|--.*--)\b/i, /^\s*select\.{3}/i],

    // How a date sub-field is recognised as a month / year / day part.
    dateParts: {
      month: /\bmonth\b|\bmm\b/i,
      year: /\byear\b|\byyyy\b|\byy\b/i,
      day: /\bday\b|\bdd\b/i,
    },

    // Side-panel categories. A matched field takes its category from its profile key or section;
    // anything else is classified by its label (first pattern that matches), else "custom".
    categories: {
      order: ['contact', 'links', 'work', 'education', 'auth', 'eeo', 'custom'],
      labels: {
        contact: 'Contact',
        links: 'Links',
        work: 'Work history',
        education: 'Education',
        auth: 'Work authorization',
        eeo: 'Voluntary self-ID',
        custom: 'Custom questions',
      },
      byKey: {
        firstName: 'contact', lastName: 'contact', fullName: 'contact', email: 'contact', phone: 'contact',
        address: 'contact', city: 'contact', state: 'contact', zip: 'contact', country: 'contact',
        location: 'contact', resume: 'contact',
        linkedin: 'links', github: 'links', portfolio: 'links',
        currentCompany: 'work', currentTitle: 'work', skills: 'work', yearsExperience: 'work',
        workAuthorized: 'auth', requiresSponsorship: 'auth', willingToRelocate: 'auth',
        gender: 'eeo', hispanic: 'eeo', race: 'eeo', veteran: 'eeo', disability: 'eeo',
      },
      bySection: { workHistory: 'work', education: 'education' },
      labelPatterns: [
        ['eeo', /gender|\brace\b|ethnic|hispanic|latin[oax]|veteran|disab|lgbt|sexual orientation|pronoun/i],
        ['auth', /authori[sz]|sponsor|\bvisa\b|relocat|citizen|eligible to work|right to work|work permit/i],
        ['links', /linked ?in|git ?hub|portfolio|website|\burl\b/i],
        ['education', /school|university|college|degree|\bgpa\b|major|graduat/i],
        ['work', /employer|company|job title|work experience|supervisor/i],
        ['contact', /\bname\b|e-?mail|phone|address|\bcity\b|\bzip\b|postal|location|country|resume|\bcv\b/i],
      ],
    },

    // Questions JobScript never saves to your bank and never sends to the AI fallback.
    sensitiveLabel: /\bssn\b|social security|date of birth|\bdob\b|birth ?date|passport|driver'?s? licen[cs]e|\bbank\b|routing|account number|credit card|card number|\bcvv\b|password|maiden name|tax id|\bein\b|\bitin\b|criminal|convict|arrest/i,

    // Text that marks a field as required when the input itself has no `required` attribute.
    requiredMarkers: [/\*/, /✱/, /\(required\)/i],

    MONTHS,
    US_STATES,
  };

  globalThis.FieldMap = FieldMap;
})();
