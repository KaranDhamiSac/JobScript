// Date math for the tracker page. Pure functions over the applications list, all in the
// browser's local time zone. No DOM, so dev/test-tracker-stats.mjs can test it in Node.
(function () {
  // "YYYY-MM-DD" for a Date in local time.
  function dayKey(date) {
    const d = date instanceof Date ? date : new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // Local midnight for a "YYYY-MM-DD" key.
  function fromKey(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function addDays(date, n) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
  }

  // { applied: Map(dayKey -> count), filled: Map(dayKey -> count) }
  // applied: entries marked Applied (or later), on the day they were marked.
  // filled:  entries still at "Filled", on the day JobScript filled them. Saved jobs count as neither.
  function countsByDay(apps) {
    const applied = new Map();
    const filled = new Map();
    const bump = (map, iso) => {
      if (!iso) return;
      const key = dayKey(iso);
      map.set(key, (map.get(key) || 0) + 1);
    };
    for (const app of apps) {
      if (app.status === 'Saved') continue; // saved from a job page, not applied to yet
      if (app.status === 'Filled') bump(filled, app.createdAt);
      else bump(applied, app.appliedAt || app.createdAt);
    }
    return { applied, filled };
  }

  // Applications for one local day: applied that day, plus filled-but-not-applied that day.
  function appsOnDay(apps, key) {
    return apps.filter((app) =>
      app.status === 'Saved' ? false
        : app.status === 'Filled' ? dayKey(app.createdAt) === key : dayKey(app.appliedAt || app.createdAt) === key
    );
  }

  // Current streak: consecutive days meeting the goal, ending today, or yesterday if today
  // isn't met yet (so the streak isn't "broken" until the day is over).
  // Longest: the best run on record.
  function streaks(applied, goal, today) {
    const met = (date) => (applied.get(dayKey(date)) || 0) >= goal;
    let current = 0;
    let day = met(today) ? today : addDays(today, -1);
    while (met(day)) {
      current++;
      day = addDays(day, -1);
    }
    let longest = 0;
    let run = 0;
    const keys = [...applied.keys()].sort();
    if (keys.length) {
      for (let d = fromKey(keys[0]); d <= today; d = addDays(d, 1)) {
        run = met(d) ? run + 1 : 0;
        longest = Math.max(longest, run);
      }
    }
    return { current, longest: Math.max(longest, current) };
  }

  function sumRange(applied, start, endExclusive) {
    let total = 0;
    for (let d = start; d < endExclusive; d = addDays(d, 1)) total += applied.get(dayKey(d)) || 0;
    return total;
  }

  // Weeks start on Sunday, matching the calendar grid.
  function weekTotal(applied, today) {
    const start = addDays(today, -today.getDay());
    return sumRange(applied, start, addDays(start, 7));
  }

  function monthTotal(applied, today) {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    return sumRange(applied, start, new Date(today.getFullYear(), today.getMonth() + 1, 1));
  }

  // Heatmap shade 0-4, relative to the daily goal.
  function level(count, goal) {
    if (!count) return 0;
    const g = Math.max(goal, 1);
    if (count < g / 2) return 1;
    if (count < g) return 2;
    if (count < g * 2) return 3;
    return 4;
  }

  // Weeks (Sunday first) covering the month; days outside it are null.
  function monthGrid(year, month) {
    const first = new Date(year, month, 1);
    const days = new Date(year, month + 1, 0).getDate();
    const cells = Array(first.getDay()).fill(null);
    for (let d = 1; d <= days; d++) cells.push(new Date(year, month, d));
    while (cells.length % 7) cells.push(null);
    const weeks = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    return weeks;
  }

  // Columns of 7 days (Sunday-Saturday) for the 53 weeks ending with the week of `today`.
  function heatmapWeeks(today) {
    const end = addDays(today, 6 - today.getDay());
    const start = addDays(end, -(53 * 7) + 1);
    const weeks = [];
    for (let w = 0; w < 53; w++) {
      const col = [];
      for (let d = 0; d < 7; d++) {
        const date = addDays(start, w * 7 + d);
        col.push(date > today ? null : date);
      }
      weeks.push(col);
    }
    return weeks;
  }

  globalThis.TrackerStats = { dayKey, fromKey, addDays, countsByDay, appsOnDay, streaks, weekTotal, monthTotal, level, monthGrid, heatmapWeeks };
})();
