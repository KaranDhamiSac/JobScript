// Application tracker page. Reads the applications JobScript logs on every fill (see
// upsertApplication in lib/storage.js) and redraws whenever they change.
(function () {
  const S = JobScriptStorage;
  const $ = (id) => document.getElementById(id);
  let apps = [];

  function el(tag, props, children) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'text') n.textContent = v;
      else if (k === 'class') n.className = v;
      else n.setAttribute(k, v);
    }
    for (const c of children || []) if (c) n.append(c);
    return n;
  }

  function safeHttpUrl(url) {
    try {
      const u = new URL(url);
      return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : '';
    } catch (e) {
      return '';
    }
  }

  function shortDate(iso) {
    return iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  }

  function roleLink(app) {
    const href = safeHttpUrl(app.url);
    const text = app.title || app.url || 'Untitled';
    return href ? el('a', { href, target: '_blank', rel: 'noopener', text }) : el('span', { text });
  }

  function statusSelect(app) {
    const select = el('select', { 'aria-label': `Status for ${app.company || 'application'}` });
    for (const s of S.STATUSES) {
      const o = el('option', { value: s, text: s });
      if (s === app.status) o.selected = true;
      select.append(o);
    }
    select.addEventListener('change', () => S.setApplicationStatus(app.id, select.value));
    return select;
  }

  async function downloadTailored(id) {
    const t = await S.getTailored(id);
    if (!t) return;
    const bin = atob(t.data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    saveBlob(new Blob([bytes], { type: 'application/pdf' }), t.name);
  }

  function saveBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function resumeCell(app) {
    if (!app.tailoredId) return el('span', { class: 'muted small', text: 'Master' });
    const b = el('button', { class: 'link', type: 'button', text: app.tailoredFileName || 'Resume' });
    b.addEventListener('click', () => downloadTailored(app.tailoredId));
    return b;
  }

  function newestFirst(list) {
    return list.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  function renderAll() {
    const body = $('all').querySelector('tbody');
    body.replaceChildren();
    $('all-empty').hidden = apps.length > 0;
    for (const app of newestFirst(apps)) {
      body.append(
        el('tr', {}, [
          el('td', { text: shortDate(app.createdAt) }),
          el('td', { text: app.company || 'Unknown' }),
          el('td', {}, [roleLink(app)]),
          el('td', { class: 'id', text: app.jobId || '', title: app.jobId || '' }),
          el('td', {}, [statusSelect(app)]),
          el('td', {}, [resumeCell(app)]),
        ])
      );
    }
  }

  // CSV cells that start with = + - @ could run as formulas in a spreadsheet; prefix them.
  function csvCell(v) {
    let s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }

  $('export-csv').addEventListener('click', () => {
    const rows = [['Filled', 'Applied', 'Company', 'Job title', 'Job ID', 'URL', 'Site', 'Status', 'Resume']];
    for (const a of newestFirst(apps)) {
      rows.push([a.createdAt, a.appliedAt || '', a.company, a.title, a.jobId, a.url, a.site, a.status, a.tailoredFileName || 'Master']);
    }
    const csv = rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
    saveBlob(new Blob([csv], { type: 'text/csv' }), `jobscript-applications-${TrackerStats.dayKey(new Date())}.csv`);
  });

  function render() {
    renderAll();
  }

  async function load() {
    apps = await S.getApplications();
    render();
  }

  // Redraw when applications change, e.g. a fill in another tab or a status change here.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.applications) load();
  });

  load();
})();
