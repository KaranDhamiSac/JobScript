// Eligibility warnings for a job: compares the job breakdown's eligibility facts (lib/ai.js,
// parseJob) with your profile, on your device. Your location, work authorization and education
// never go to Claude for this.
//
// JobScriptEligibility.check(eligibility, profile, now) -> [{ text, level: 'warn' | 'info' }]
// JobScriptEligibility.yearsOfExperience(profile, now) -> years (one decimal)
(function () {
  const DEGREE_RANK = { none: 0, high_school: 1, associate: 2, bachelor: 3, master: 4, doctorate: 5 };
  const DEGREE_NAME = { high_school: 'a high school diploma', associate: 'an associate degree', bachelor: 'a bachelor’s degree', master: 'a master’s degree', doctorate: 'a doctorate' };

  const STATES = {
    AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
    DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
    KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
    MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
    NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
    PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
    VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  };

  function monthIndex(ym) {
    const m = /^(\d{4})-(\d{2})/.exec(ym || '');
    return m ? Number(m[1]) * 12 + Number(m[2]) - 1 : null;
  }

  // Months worked, counting overlapping jobs once. Internships count; the warning says so.
  function yearsOfExperience(profile, now) {
    const today = now || new Date();
    const nowIdx = today.getFullYear() * 12 + today.getMonth();
    const spans = (profile.workHistory || [])
      .map((j) => [monthIndex(j.startDate), j.current ? nowIdx : monthIndex(j.endDate)])
      .filter(([a, b]) => a !== null && b !== null && b >= a)
      .sort((x, y) => x[0] - y[0]);
    let months = 0;
    let end = -Infinity;
    for (const [a, b] of spans) {
      const start = Math.max(a, end + 1);
      if (b >= start) months += b - start + 1;
      end = Math.max(end, b);
    }
    return Math.round((months / 12) * 10) / 10;
  }

  function degreeLevel(text) {
    const t = String(text || '').toLowerCase();
    if (/\bph\.?\s?d\b|doctor|\bd\.?sc\b|\bed\.?d\b/.test(t)) return 'doctorate';
    if (/master|\bm\.?\s?s\.?(c)?\b|\bm\.?\s?a\.?\b|\bmba\b|\bm\.?\s?eng\b|\bmfa\b|\bmph\b/.test(t)) return 'master';
    if (/bachelor|\bb\.?\s?s\.?(c)?\b|\bb\.?\s?a\.?\b|\bb\.?\s?eng\b|\bbfa\b|\bbba\b/.test(t)) return 'bachelor';
    if (/associate|\ba\.?\s?a\.?\b|\ba\.?\s?s\.?\b/.test(t)) return 'associate';
    if (/high school|diploma|\bged\b/.test(t)) return 'high_school';
    return 'none';
  }

  // Your highest degree: { level, done, gradDate }. A degree with a graduation date still ahead
  // is in progress.
  function highestDegree(profile, now) {
    const nowIdx = (now || new Date()).getFullYear() * 12 + (now || new Date()).getMonth();
    let best = { level: 'none', done: true, gradDate: '' };
    for (const e of profile.education || []) {
      const level = degreeLevel(e.degree);
      const g = monthIndex(e.gradDate);
      const done = g === null || g <= nowIdx;
      if (DEGREE_RANK[level] > DEGREE_RANK[best.level] || (level === best.level && done && !best.done)) best = { level, done, gradDate: e.gradDate || '' };
    }
    return best;
  }

  function monthName(ym) {
    const m = /^(\d{4})-(\d{2})/.exec(ym || '');
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' }) : '';
  }

  // How close a job location is to you: 'city' (names your city, or anywhere/remote), 'state'
  // ("Fresno, CA" when you're in Sacramento, CA), or '' (elsewhere).
  function nearYou(location, profile) {
    const loc = String(location || '').toLowerCase();
    if (!loc) return '';
    if (/\b(remote|anywhere|united states|us only|usa)\b/.test(loc) && !/,/.test(loc)) return 'city';
    const city = String(profile.city || '').trim().toLowerCase();
    if (city && loc.includes(city)) return 'city';
    const st = String(profile.state || '').trim();
    const abbr = st.length === 2 ? st.toUpperCase() : Object.keys(STATES).find((k) => STATES[k].toLowerCase() === st.toLowerCase());
    if (!abbr || !STATES[abbr]) return '';
    return new RegExp(`(^|[^a-z])${abbr.toLowerCase()}([^a-z]|$)`).test(loc) || loc.includes(STATES[abbr].toLowerCase()) ? 'state' : '';
  }

  function check(elig, profile, now) {
    const e = elig || {};
    const p = profile || {};
    const out = [];
    const quote = (t) => (t ? ` (“${String(t).slice(0, 140)}”)` : '');

    if (e.minYears > 0) {
      const have = yearsOfExperience(p, now);
      if (have < e.minYears) {
        out.push({ level: 'warn', text: `Asks for ${e.minYears}+ years of experience${quote(e.yearsText)}; your resume shows about ${have} (internships included).` });
      }
    }

    if (e.degree && e.degree !== 'none') {
      const mine = highestDegree(p, now);
      const want = DEGREE_RANK[e.degree];
      const have = DEGREE_RANK[mine.level];
      const name = DEGREE_NAME[e.degree];
      if (have < want) {
        out.push({ level: e.degreeRequired ? 'warn' : 'info', text: `${e.degreeRequired ? 'Requires' : 'Prefers'} ${name}${quote(e.degreeText)}; your profile doesn’t list one.` });
      } else if (!mine.done && e.degreeRequired && DEGREE_RANK[mine.level] === want) {
        out.push({ level: 'info', text: `Requires ${name}; yours is expected ${monthName(mine.gradDate) || 'later'}. Check the posting accepts students.` });
      }
    }

    if (e.clearance === 'required') out.push({ level: 'warn', text: `Requires an active security clearance${quote(e.clearanceText)}.` });
    else if (e.clearance === 'obtainable') out.push({ level: 'info', text: `You must be able to obtain a security clearance${quote(e.clearanceText)}; that usually means U.S. citizenship.` });
    else if (e.clearance === 'preferred') out.push({ level: 'info', text: `A security clearance is preferred${quote(e.clearanceText)}.` });

    if (e.citizenship === 'us_citizen') out.push({ level: 'warn', text: `Requires U.S. citizenship${quote(e.citizenshipText)}.` });
    else if (e.citizenship === 'us_person') out.push({ level: 'warn', text: `Requires U.S. person status (citizen or green card holder)${quote(e.citizenshipText)}.` });
    else if (e.citizenship === 'no_sponsorship' && p.requiresSponsorship === 'yes') {
      out.push({ level: 'warn', text: `Doesn’t sponsor visas${quote(e.citizenshipText)}, and your profile says you’ll need sponsorship.` });
    } else if (e.citizenship === 'authorized' && p.workAuthorized === 'no') {
      out.push({ level: 'warn', text: `Requires work authorization${quote(e.citizenshipText)}, and your profile says you aren’t authorized.` });
    }

    if (e.workplace === 'onsite' || e.workplace === 'hybrid') {
      const places = (e.workLocations || []).filter(Boolean);
      const where = places.slice(0, 3).join('; ');
      const here = [p.city, p.state].filter(Boolean).join(', ');
      const near = places.map((l) => nearYou(l, p));
      if (places.length && here && !near.includes('city')) {
        const kind = e.workplace === 'onsite' ? 'Onsite' : 'Hybrid';
        const relocating = p.willingToRelocate === 'yes';
        out.push({
          level: relocating || near.includes('state') ? 'info' : 'warn',
          text: `${kind} in ${where}; you’re in ${here}${relocating ? ' (you’re open to relocating)' : ''}.`,
        });
      }
    }
    return out;
  }

  globalThis.JobScriptEligibility = { check, yearsOfExperience, highestDegree, degreeLevel, nearYou };
})();
