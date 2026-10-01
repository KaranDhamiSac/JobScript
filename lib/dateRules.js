// Relative date answers, such as "Available start date: two weeks from today". A saved date
// answer can keep a rule instead of a fixed date, so it stays right on later applications.
// Rules are short strings:
//   "today"      today
//   "+14d"       14 days from today
//   "+2w"        2 weeks from today
//   "next-mon"   the next Monday after today (sun, mon, tue, wed, thu, fri, sat)
// Loaded by the content script, the options page and Node tests (dev/test-date-rules.mjs).
(function () {
  const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  // Offered when you save a date answer.
  const PRESETS = ['today', '+1d', '+7d', '+14d', '+30d', 'next-mon'];

  function parse(rule) {
    const r = String(rule || '').trim().toLowerCase();
    if (r === 'today') return { days: 0 };
    let m = /^\+(\d{1,3})([dw])$/.exec(r);
    if (m) return { days: Number(m[1]) * (m[2] === 'w' ? 7 : 1) };
    m = /^next-(sun|mon|tue|wed|thu|fri|sat)$/.exec(r);
    if (m) return { weekday: DAYS.indexOf(m[1]) };
    return null;
  }

  function isRule(rule) {
    return parse(rule) !== null;
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  // YYYY-MM-DD in local time.
  function toKey(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  // The date a rule means on the given day (default: now), as YYYY-MM-DD; '' if it isn't a rule.
  function resolve(rule, now) {
    const p = parse(rule);
    if (!p) return '';
    const base = now ? new Date(now) : new Date();
    // Noon, so adding days across a daylight saving change stays on the right date.
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 12);
    if (p.weekday !== undefined) {
      const ahead = (p.weekday - d.getDay() + 7) % 7 || 7;
      d.setDate(d.getDate() + ahead);
    } else {
      d.setDate(d.getDate() + p.days);
    }
    return toKey(d);
  }

  function describe(rule) {
    const p = parse(rule);
    if (!p) return '';
    if (p.weekday !== undefined) return `Next ${DAY_NAMES[p.weekday]}`;
    if (p.days === 0) return 'Today';
    if (p.days === 1) return 'Tomorrow';
    const r = String(rule).trim().toLowerCase();
    if (r.endsWith('w')) {
      const w = p.days / 7;
      return `${w} week${w === 1 ? '' : 's'} from today`;
    }
    return `${p.days} days from today`;
  }

  // The rule for "N days from today", for a custom number typed in.
  function daysFromToday(n) {
    const days = Math.max(0, Math.min(365, Math.round(Number(n) || 0)));
    return days === 0 ? 'today' : `+${days}d`;
  }

  globalThis.JobScriptDates = { PRESETS, isRule, resolve, describe, daysFromToday, toKey };
})();
