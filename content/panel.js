// Side panel shown on the page after a fill. It lives in a *closed* shadow root on a custom element,
// so page scripts can't reach its contents (host.shadowRoot is null for them) and page CSS can't
// style it. Everything is built with createElement/textContent, never HTML strings, because
// labels come from the page.
//
// Usage from content/autofill.js:
//   JobScriptPanel.render({ summary, note, items, onSelect })
//   items: [{ id, category, label, status: 'filled'|'suggested'|'needs', detail, required,
//             draft, actions: [{ label, primary, onClick }] }]
//   emptyText (optional): shown instead of "No fields found." when items is empty
//   details (optional): { title, lines: [strings] }, a short read-only block (the company)
//   warning (optional): one line shown above everything else, e.g. another autofill extension
//   footerActions (optional): [{ label, ariaLabel, onClick }], shown as links under the list
//   agent (optional): agent mode's run, shown above the list (see drawAgent)
//     { running, title, status, log: [{ text, kind: 'action'|'info'|'error'|'refused' }],
//       usage: text, allowNav, onAllowNav(bool), onStop, onClose,
//       prompt: { text, detail, options: [{ label, value, primary }], freeText, onAnswer(value) } }
//   review (optional, replaces the list): { title, rows, onSave, onCancel }
//     rows: [{ id, label, value, checked, note, dateChoices: { choices: [{ rule, label }], selected } }]
//     onSave([{ id, dateRule }]) gets the ticked rows.
//
// The Job tab (content/jobtab.js), shown when the page has a job posting:
//   JobScriptPanel.renderJob({ blocks, applyFallback }) or renderJob(null) to remove it
//   blocks: [{ kind, ... }], drawn in order:
//     title    { title, subtitle, meta: [strings] }
//     score    { value (0-100 or null), label, reason, busy }
//     warnings { items: [{ text, level: 'warn' | 'info' }] }
//     chips    { title, items: [strings], tone: 'good' | 'missing' }
//     list     { title, items: [strings] }
//     note     { text, tone: 'muted' | 'warn' }
//     buttons  { items: [{ label, ariaLabel, primary, disabled, onClick }] }
//     links    { title, items: [{ label, href }] }   (open in a new tab)
//     copy     { title, text }                      (read-only text with a Copy button)
//   applyFallback (optional): blocks for the Apply tab on pages without a form to fill
//   JobScriptPanel.openTab('job' | 'apply') opens the panel on that tab.
(function () {
  if (globalThis.JobScriptPanel) return;

  const STATUS_TEXT = { filled: 'Filled', suggested: 'Suggested', needs: 'Needs you' };

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .panel {
      --bg: #ffffff; --fg: #111827; --muted: #6b7280; --border: #e5e7eb; --hover: #f3f4f6;
      --filled: #16a34a; --suggested: #7c3aed; --needs: #ca8a04; --accent: #2563eb;
      width: 340px; max-height: calc(100vh - 24px); display: flex; flex-direction: column;
      background: var(--bg); color: var(--fg); border: 1px solid var(--border); border-radius: 12px;
      box-shadow: 0 12px 32px rgba(0,0,0,.18); overflow: hidden;
      font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    @media (prefers-color-scheme: dark) {
      .panel { --bg: #111827; --fg: #f3f4f6; --muted: #9ca3af; --border: #374151; --hover: #1f2937;
               --filled: #4ade80; --suggested: #a78bfa; --needs: #facc15; --accent: #60a5fa; }
    }
    header { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--border); }
    header h1 { flex: 1; margin: 0; font-size: 14px; font-weight: 700; }
    button { font: inherit; cursor: pointer; }
    .icon { background: none; border: none; color: var(--muted); font-size: 16px; line-height: 1; padding: 2px 6px; border-radius: 6px; }
    .icon:hover { background: var(--hover); color: var(--fg); }
    .summary { display: flex; gap: 10px; padding: 8px 12px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
    .count { display: inline-flex; align-items: center; gap: 5px; font-weight: 600; }
    .note { padding: 8px 12px; border-bottom: 1px solid var(--border); color: var(--muted); }
    .note:empty { display: none; }
    .fill-summary { color: var(--fg); font-weight: 600; }
    .warning { padding: 6px 12px; border-bottom: 1px solid var(--border); color: var(--needs); font-size: 12px; font-weight: 600; }
    .details { padding: 8px 12px; border-bottom: 1px solid var(--border); font-size: 12px; }
    .details h2 { margin: 0 0 4px; font-size: 12px; font-weight: 700; }
    .details p { margin: 2px 0; color: var(--muted); overflow-wrap: anywhere; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 6px 8px; align-items: center; padding: 6px 12px; border-bottom: 1px solid var(--border); color: var(--muted); }
    .toolbar label { display: inline-flex; gap: 5px; align-items: center; cursor: pointer; }
    .toolbar .spacer { flex: 1; }
    .body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
    .list { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 4px 0 8px; }
    .cat { margin-top: 4px; }
    .cat > button { width: 100%; display: flex; align-items: center; gap: 6px; padding: 6px 12px; background: none; border: none; color: var(--muted); font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; text-align: left; }
    .cat > button:hover { color: var(--fg); }
    .cat .caret { width: 10px; }
    .item { display: grid; grid-template-columns: 10px 1fr; gap: 2px 8px; padding: 6px 12px 6px 14px; border-left: 3px solid transparent; }
    .item:hover { background: var(--hover); }
    .dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 5px; }
    .item.filled .dot { background: var(--filled); }
    .item.suggested { border-left-color: var(--suggested); }
    .item.suggested .dot { background: var(--suggested); }
    .item.needs .dot { background: var(--needs); }
    .label { background: none; border: none; padding: 0; color: var(--fg); text-align: left; font-weight: 500; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .label:hover { text-decoration: underline; }
    .detail { grid-column: 2; color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
    .req { color: var(--needs); font-weight: 600; }
    .draft { grid-column: 2; margin-top: 4px; padding: 8px; max-height: 180px; overflow-y: auto; white-space: pre-wrap; border: 1px solid var(--border); border-radius: 6px; font-size: 12px; }
    .actions { grid-column: 2; display: flex; gap: 6px; margin-top: 4px; flex-wrap: wrap; }
    .btn { padding: 3px 9px; border-radius: 6px; border: 1px solid var(--border); background: none; color: var(--fg); font-size: 12px; }
    .btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
    .btn:disabled { opacity: .5; cursor: default; }
    .collapsed .body { display: none; }
    .empty { padding: 12px; color: var(--muted); }
    .launcher {
      display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border: none; border-radius: 999px;
      background: #2563eb; color: #fff; font: 600 13px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      box-shadow: 0 6px 18px rgba(0,0,0,.25); cursor: pointer;
    }
    .launcher:hover { background: #1d4ed8; }
    .footer { display: flex; flex-wrap: wrap; gap: 4px 12px; padding: 8px 12px; border-top: 1px solid var(--border); }
    .footer button { background: none; border: none; padding: 0; color: var(--accent); font-size: 12px; }
    .footer button:hover { text-decoration: underline; }
    .review { flex: 1; min-height: 0; display: flex; flex-direction: column; }
    .review-title { padding: 8px 12px 2px; font-weight: 600; }
    .row { display: grid; grid-template-columns: 18px 1fr; gap: 2px 6px; padding: 6px 12px; }
    .row:hover { background: var(--hover); }
    .row input { margin: 2px 0 0; }
    .row .value { grid-column: 2; color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
    .agent { border-bottom: 1px solid var(--border); padding: 8px 12px; display: flex; flex-direction: column; gap: 6px; }
    .agent-head { display: flex; align-items: center; gap: 8px; }
    .agent-head strong { flex: 1; font-size: 12px; }
    .agent-status { color: var(--muted); font-size: 12px; }
    .agent-log { margin: 0; padding: 0; list-style: none; max-height: 150px; overflow-y: auto; overscroll-behavior: contain; font-size: 12px; border: 1px solid var(--border); border-radius: 6px; }
    .agent-log li { padding: 3px 8px; border-bottom: 1px solid var(--border); overflow-wrap: anywhere; }
    .agent-log li:last-child { border-bottom: none; }
    .agent-log .info { color: var(--muted); }
    .agent-log .error, .agent-log .refused { color: var(--needs); }
    .agent-usage { color: var(--muted); font-size: 11px; }
    .agent-prompt { border: 1px solid var(--accent); border-radius: 6px; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
    .agent-prompt p { margin: 0; font-weight: 600; overflow-wrap: anywhere; }
    .agent-prompt .muted { font-weight: 400; color: var(--muted); font-size: 12px; }
    .agent-prompt .choices { display: flex; flex-wrap: wrap; gap: 6px; }
    .agent-prompt input[type=text] { font: inherit; font-size: 12px; padding: 3px 6px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--fg); }
    .btn.stop { border-color: var(--needs); color: var(--needs); font-weight: 600; }
    .agent label { display: inline-flex; gap: 5px; align-items: center; font-size: 12px; color: var(--muted); cursor: pointer; }
    .row select { grid-column: 2; margin-top: 3px; font: inherit; font-size: 12px; max-width: 100%; color: var(--fg); background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 2px 4px; }
    .tabs { display: flex; border-bottom: 1px solid var(--border); }
    .tabs button { flex: 1; padding: 7px 0; background: none; border: none; border-bottom: 2px solid transparent; color: var(--muted); font-weight: 600; }
    .tabs button[aria-selected="true"] { color: var(--fg); border-bottom-color: var(--accent); }
    .job { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 4px 0 10px; }
    .blk { padding: 8px 12px; }
    .blk + .blk { border-top: 1px solid var(--border); }
    .blk h2 { margin: 0 0 4px; font-size: 12px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
    .job-title { margin: 0; font-size: 15px; font-weight: 700; overflow-wrap: anywhere; }
    .job-sub { margin: 2px 0 0; font-weight: 600; }
    .job-meta { margin: 2px 0 0; color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
    .score { display: flex; gap: 10px; align-items: center; }
    .score-num { min-width: 52px; height: 52px; border-radius: 50%; display: grid; place-items: center; font-size: 17px; font-weight: 800; border: 4px solid var(--border); }
    .score-num.hi { border-color: var(--filled); } .score-num.mid { border-color: var(--needs); } .score-num.lo { border-color: #dc2626; }
    .score-text { flex: 1; min-width: 0; }
    .score-text strong { display: block; }
    .score-text span { color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
    .chips { display: flex; flex-wrap: wrap; gap: 4px; }
    .chip { padding: 1px 8px; border-radius: 999px; font-size: 12px; border: 1px solid var(--filled); color: var(--filled); }
    .chips.missing .chip { border-color: var(--needs); color: var(--needs); }
    .warns { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }
    .warns li { padding: 4px 8px; border-radius: 6px; font-size: 12px; border-left: 3px solid var(--needs); background: var(--hover); overflow-wrap: anywhere; }
    .warns li.info { border-left-color: var(--accent); }
    .blk ul.plain { margin: 0; padding-left: 16px; font-size: 12px; }
    .blk .muted { color: var(--muted); font-size: 12px; margin: 0; overflow-wrap: anywhere; }
    .blk .warntext { color: var(--needs); font-size: 12px; margin: 0; font-weight: 600; }
    .btns { display: flex; flex-wrap: wrap; gap: 6px; }
    .btns .btn { padding: 5px 10px; }
    .links a { display: block; color: var(--accent); font-size: 12px; margin: 2px 0; overflow-wrap: anywhere; }
    .copybox { width: 100%; min-height: 110px; font: inherit; font-size: 12px; padding: 6px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--fg); resize: vertical; }
  `;

  let host = null;
  let shadow = null;
  let state = null; // the Apply tab (the fill), from content/autofill.js
  let jobView = null; // the Job tab, from content/jobtab.js
  let activeTab = 'apply';
  let mode = null; // 'panel' | 'launcher' | null (nothing on the page)
  // What the floating button does, by tab: set by showLauncher(onOpen, 'job' | 'apply').
  const launchers = {};
  let dismissed = false; // you closed the panel; updates wait until you open it again
  const ui = { collapsed: false, hideFilled: false, closedCats: new Set() };

  function el(tag, props, children) {
    const n = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (k === 'text') n.textContent = v;
        else if (k === 'class') n.className = v;
        else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
        else n.setAttribute(k, v);
      }
    }
    for (const c of children || []) if (c) n.appendChild(c);
    return n;
  }

  function applyStyles(root) {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
      root.adoptedStyleSheets = [sheet];
    } catch (e) {
      root.appendChild(el('style', { text: CSS }));
    }
  }

  function ensureHost() {
    if (!host) {
      host = document.createElement('jobscript-panel');
      shadow = host.attachShadow({ mode: 'closed' });
      applyStyles(shadow);
      keepAttached();
    }
    if (!host.isConnected) document.documentElement.appendChild(host);
    // CSSOM (not a style attribute) so strict page CSPs don't block it; !important beats page CSS.
    // The panel sits top right, the floating button bottom left: bottom right is where
    // reCAPTCHA's badge and other extensions' panels (Jobright, for one) usually are.
    const pin = { all: 'initial', position: 'fixed', 'z-index': '2147483647', display: 'block' };
    Object.assign(pin, mode === 'launcher'
      ? { bottom: '16px', left: '16px', top: 'auto', right: 'auto' }
      : { top: '12px', right: '12px', bottom: 'auto', left: 'auto' });
    for (const [k, v] of Object.entries(pin)) host.style.setProperty(k, v, 'important');
  }

  function remove() {
    if (host) host.remove();
    host = null;
    shadow = null;
    mode = null;
  }

  // Some sites rebuild the whole page after it loads: Greenhouse's React app, for one,
  // re-renders <html> when hydration fails, which throws away anything an extension added.
  // Put the panel (or the floating button) back, contents and all, whenever that happens.
  let watcher = null;
  let watchedRoot = null;
  let reattachTimer = null;

  function keepAttached() {
    if (watcher) return;
    const check = () => {
      if (watchedRoot !== document.documentElement) observeRoot();
      if (!host || host.isConnected || reattachTimer) return;
      reattachTimer = setTimeout(() => {
        reattachTimer = null;
        if (host && !host.isConnected && document.documentElement) document.documentElement.appendChild(host);
      }, 50);
    };
    watcher = new MutationObserver(check);
    const observeRoot = () => {
      watcher.disconnect();
      watchedRoot = document.documentElement;
      watcher.observe(document, { childList: true });
      if (watchedRoot) watcher.observe(watchedRoot, { childList: true });
    };
    observeRoot();
    // Belt and braces for pages that swap nodes in ways the observer above doesn't see.
    setInterval(check, 1000);
  }

  function hasLauncher() {
    return !!(launchers.job || launchers.apply);
  }

  // Closing the panel leaves the floating button, if there is one.
  function close() {
    dismissed = true;
    if (hasLauncher()) drawLauncher();
    else remove();
  }

  // The floating "JobScript" button. A real button with a text label, so you, a screen reader
  // or a browser agent can find it by reading the page.
  function drawLauncher() {
    mode = 'launcher';
    ensureHost();
    const b = el('button', { class: 'launcher', type: 'button', text: 'JobScript', 'aria-label': 'Open JobScript panel', title: 'Open JobScript panel' });
    b.addEventListener('click', trusted(() => {
      dismissed = false;
      // On a job page the panel opens on the Job tab.
      activeTab = launchers.job && jobView ? 'job' : 'apply';
      if (launchers.job) launchers.job();
      if (launchers.apply) launchers.apply();
      if (!launchers.apply) draw();
    }));
    shadow.replaceChildren(b);
    ensureStyles();
  }

  // Only react to real clicks from the user, never to events a page script dispatched.
  function trusted(fn) {
    return (e) => {
      if (!e.isTrusted) return;
      e.stopPropagation();
      fn(e);
    };
  }

  function renderItem(item) {
    const node = el('div', { class: 'item ' + item.status });
    node.appendChild(el('span', { class: 'dot', title: STATUS_TEXT[item.status] || '' }));
    node.appendChild(
      el('button', { class: 'label', text: item.label, title: item.label, 'aria-label': 'Go to field: ' + item.label, onclick: trusted(() => state.onSelect(item.id)) })
    );
    const detailBits = [STATUS_TEXT[item.status]];
    if (item.detail) detailBits.push(item.detail);
    const detail = el('div', { class: 'detail' }, [document.createTextNode(detailBits.join(' · '))]);
    if (item.status === 'needs' && item.required) {
      detail.appendChild(document.createTextNode(' · '));
      detail.appendChild(el('span', { class: 'req', text: 'Required' }));
    }
    node.appendChild(detail);
    if (item.draft) node.appendChild(el('div', { class: 'draft', text: item.draft }));
    if (item.actions && item.actions.length) {
      const bar = el('div', { class: 'actions' });
      for (const a of item.actions) {
        const b = el('button', { class: 'btn' + (a.primary ? ' primary' : ''), text: a.label, 'aria-label': `${a.label}: ${item.label}` });
        b.addEventListener(
          'click',
          trusted(async () => {
            b.disabled = true;
            try {
              await a.onClick();
            } finally {
              b.disabled = false;
            }
          })
        );
        bar.appendChild(b);
      }
      node.appendChild(bar);
    }
    return node;
  }

  function draw() {
    if (!state && !jobView) return;
    if (!jobView) activeTab = 'apply';
    mode = 'panel';
    ensureHost();
    const panel = el('div', { class: 'panel' + (ui.collapsed ? ' collapsed' : ''), role: 'complementary', 'aria-label': 'JobScript' });
    panel.appendChild(drawHeader());
    if (jobView) panel.appendChild(drawTabs());
    if (activeTab === 'job' || !state) {
      const body = el('div', { class: 'body' });
      const blocks = activeTab === 'job' ? jobView.blocks
        : jobView.applyFallback || [{ kind: 'note', text: 'Nothing filled on this page yet. Press Apply on the Job tab, or Fill this page in the toolbar popup.' }];
      body.appendChild(drawBlocks(blocks || [], activeTab === 'job' ? 'Job' : 'Apply'));
      panel.appendChild(body);
      const old = shadow.querySelector('.job');
      const scrollTop = old && old.dataset.tab === activeTab ? old.scrollTop : 0;
      shadow.replaceChildren(panel);
      const fresh = shadow.querySelector('.job');
      if (fresh) fresh.scrollTop = scrollTop;
      ensureStyles();
      return;
    }
    drawApply(panel);
  }

  function drawHeader() {
    return el('header', null, [
      el('h1', { text: 'JobScript' }),
      el('button', {
        class: 'icon',
        text: ui.collapsed ? '▸' : '▾',
        title: ui.collapsed ? 'Expand' : 'Collapse',
        'aria-label': ui.collapsed ? 'Expand JobScript panel' : 'Collapse JobScript panel',
        'aria-expanded': String(!ui.collapsed),
        onclick: trusted(() => { ui.collapsed = !ui.collapsed; draw(); }),
      }),
      el('button', { class: 'icon', text: '×', title: 'Close', 'aria-label': 'Close JobScript panel', onclick: trusted(close) }),
    ]);
  }

  function drawTabs() {
    const bar = el('div', { class: 'tabs', role: 'tablist', 'aria-label': 'JobScript' });
    for (const [id, label] of [['job', 'Job'], ['apply', 'Apply']]) {
      bar.appendChild(el('button', {
        type: 'button', role: 'tab', text: label, 'aria-selected': String(activeTab === id),
        onclick: trusted(() => { activeTab = id; draw(); }),
      }));
    }
    return bar;
  }

  // The Apply tab: the fill's field list (content/autofill.js).
  function drawApply(panel) {
    const FM = globalThis.FieldMap;
    const items = state.items;
    const counts = { filled: 0, suggested: 0, needs: 0 };
    for (const it of items) counts[it.status] = (counts[it.status] || 0) + 1;

    const summary = el('div', { class: 'summary' });
    for (const s of ['filled', 'suggested', 'needs']) {
      const c = el('span', { class: 'count item ' + s });
      c.style.padding = '0';
      c.style.border = 'none';
      c.style.display = 'inline-flex';
      c.appendChild(el('span', { class: 'dot' }));
      c.appendChild(document.createTextNode(`${counts[s] || 0} ${STATUS_TEXT[s].toLowerCase()}`));
      summary.appendChild(c);
    }
    panel.appendChild(summary);

    const body = el('div', { class: 'body' });
    if (state.warning) body.appendChild(el('div', { class: 'warning', role: 'note', text: state.warning }));
    // Plain-text result of the last fill ("Filled 12 of 15. Needs you: …"), read aloud on change.
    body.appendChild(el('div', { class: 'note fill-summary', role: 'status', 'aria-live': 'polite', text: state.summaryText || '' }));
    body.appendChild(el('div', { class: 'note', text: state.note || '' }));
    if (state.agent) body.appendChild(drawAgent(state.agent));
    if (state.details && state.details.lines.length) {
      body.appendChild(
        el('section', { class: 'details', 'aria-label': state.details.title }, [
          el('h2', { text: state.details.title }),
          ...state.details.lines.map((line) => el('p', { text: line })),
        ])
      );
    }
    if (state.review) {
      body.appendChild(drawReview(state.review));
      panel.appendChild(body);
      shadow.replaceChildren(panel);
      ensureStyles();
      return;
    }

    const toolbar = el('div', { class: 'toolbar' });
    const hide = el('input', { type: 'checkbox' });
    hide.checked = ui.hideFilled;
    hide.addEventListener('change', (e) => {
      if (!e.isTrusted) return;
      ui.hideFilled = hide.checked;
      draw();
    });
    toolbar.appendChild(el('label', null, [hide, document.createTextNode('Hide filled')]));
    toolbar.appendChild(el('span', { class: 'spacer' }));
    for (const a of state.toolbarActions || []) {
      const b = el('button', { class: 'btn' + (a.primary ? ' primary' : ''), text: a.label, 'aria-label': a.ariaLabel || a.label });
      b.addEventListener('click', trusted(async () => { b.disabled = true; try { await a.onClick(); } finally { b.disabled = false; } }));
      toolbar.appendChild(b);
    }
    body.appendChild(toolbar);

    const list = el('div', { class: 'list' });
    const visible = items.filter((it) => !(ui.hideFilled && it.status === 'filled'));
    const emptyText = items.length ? 'Everything is filled.' : state.emptyText || 'No fields found.';
    if (!visible.length) list.appendChild(el('div', { class: 'empty', text: emptyText }));
    for (const cat of FM.categories.order) {
      const catItems = visible.filter((it) => it.category === cat);
      if (!catItems.length) continue;
      const open = !ui.closedCats.has(cat);
      const section = el('div', { class: 'cat' });
      section.appendChild(
        el('button', {
          'aria-expanded': String(open),
          'aria-label': `${FM.categories.labels[cat]} (${catItems.length} fields)`,
          onclick: trusted(() => { open ? ui.closedCats.add(cat) : ui.closedCats.delete(cat); draw(); }),
        }, [el('span', { class: 'caret', text: open ? '▾' : '▸' }), document.createTextNode(`${FM.categories.labels[cat]} (${catItems.length})`)])
      );
      if (open) for (const it of catItems) section.appendChild(renderItem(it));
      list.appendChild(section);
    }
    body.appendChild(list);
    if (state.footerActions && state.footerActions.length) {
      const footer = el('div', { class: 'footer' });
      for (const a of state.footerActions) {
        const b = el('button', { type: 'button', text: a.label, 'aria-label': a.ariaLabel || a.label });
        b.addEventListener('click', trusted(() => a.onClick()));
        footer.appendChild(b);
      }
      body.appendChild(footer);
    }
    panel.appendChild(body);

    // Re-rendering rebuilds the list; keep the user's scroll position.
    const oldList = shadow.querySelector('.list');
    const scrollTop = oldList ? oldList.scrollTop : 0;
    shadow.replaceChildren(panel);
    list.scrollTop = scrollTop;
    ensureStyles();
  }

  // The Job tab, and the Apply tab on pages with nothing to fill: generic blocks (see the top).
  function drawBlocks(blocks, tab) {
    const wrap = el('div', { class: 'job', role: 'tabpanel', 'aria-label': tab });
    wrap.dataset.tab = activeTab;
    for (const b of blocks) {
      const node = drawBlock(b);
      if (node) wrap.appendChild(node);
    }
    return wrap;
  }

  function actionButton(a) {
    const b = el('button', { type: 'button', class: 'btn' + (a.primary ? ' primary' : ''), text: a.label, 'aria-label': a.ariaLabel || a.label });
    if (a.disabled) b.disabled = true;
    b.addEventListener('click', trusted(async () => {
      b.disabled = true;
      try {
        await a.onClick();
      } finally {
        if (b.isConnected) b.disabled = !!a.disabled;
      }
    }));
    return b;
  }

  function drawBlock(b) {
    const sec = (children, label) => el('section', { class: 'blk', 'aria-label': label || b.title || b.kind }, children);
    const heading = b.title && b.kind !== 'title' ? el('h2', { text: b.title }) : null;
    switch (b.kind) {
      case 'title':
        return sec([
          el('p', { class: 'job-title', text: b.title || 'Job' }),
          b.subtitle ? el('p', { class: 'job-sub', text: b.subtitle }) : null,
          ...(b.meta || []).filter(Boolean).map((m) => el('p', { class: 'job-meta', text: m })),
        ], 'Job');
      case 'score': {
        const v = Number.isFinite(b.value) ? Math.round(b.value) : null;
        const tone = v === null ? '' : v >= 75 ? ' hi' : v >= 50 ? ' mid' : ' lo';
        return sec([el('div', { class: 'score' }, [
          el('div', { class: 'score-num' + tone, role: 'img', 'aria-label': v === null ? 'No match score yet' : `Match score ${v} out of 100`, text: v === null ? (b.busy ? '…' : '–') : String(v) }),
          el('div', { class: 'score-text', role: 'status', 'aria-live': 'polite' }, [el('strong', { text: b.label || 'Match score' }), b.reason ? el('span', { text: b.reason }) : null]),
        ])], 'Match score');
      }
      case 'warnings':
        if (!b.items || !b.items.length) return null;
        return sec([heading, el('ul', { class: 'warns' }, b.items.map((w) => el('li', { class: w.level === 'info' ? 'info' : 'warn', text: w.text })))], b.title || 'Warnings');
      case 'chips':
        if (!b.items || !b.items.length) return null;
        return sec([heading, el('div', { class: 'chips' + (b.tone === 'missing' ? ' missing' : '') }, b.items.map((t) => el('span', { class: 'chip', text: t })))]);
      case 'list':
        if (!b.items || !b.items.length) return null;
        return sec([heading, el('ul', { class: 'plain' }, b.items.map((t) => el('li', { text: t })))]);
      case 'note':
        return sec([heading, el('p', { class: b.tone === 'warn' ? 'warntext' : 'muted', role: 'status', text: b.text })]);
      case 'buttons':
        return sec([heading, el('div', { class: 'btns' }, (b.items || []).map(actionButton))], b.title || 'Actions');
      case 'links':
        return sec([heading, el('div', { class: 'links' }, (b.items || []).map((l) =>
          el('a', { href: l.href, target: '_blank', rel: 'noopener noreferrer', text: l.label, onclick: (e) => { if (!e.isTrusted) e.preventDefault(); } })
        ))]);
      case 'copy': {
        const box = el('textarea', { class: 'copybox', readonly: 'readonly', 'aria-label': b.title || 'Text to copy' });
        box.value = b.text || '';
        const copy = el('button', { type: 'button', class: 'btn', text: 'Copy', 'aria-label': 'Copy: ' + (b.title || 'text') });
        copy.addEventListener('click', trusted(async () => {
          try {
            await navigator.clipboard.writeText(box.value);
            copy.textContent = 'Copied ✓';
          } catch (e) {
            box.select();
            copy.textContent = 'Press Ctrl+C / ⌘C';
          }
          setTimeout(() => { if (copy.isConnected) copy.textContent = 'Copy'; }, 1500);
        }));
        return sec([heading, box, el('div', { class: 'btns' }, [copy])]);
      }
      default:
        return null;
    }
  }

  // Without constructable stylesheets the <style> element is replaced along with the content.
  function ensureStyles() {
    if (!shadow.adoptedStyleSheets || !shadow.adoptedStyleSheets.length) {
      if (!shadow.querySelector('style')) shadow.prepend(el('style', { text: CSS }));
    }
  }

  // Agent mode: what it's doing, a log of every action, its cost, and a Stop button that works
  // at once. A question or an approval request from the agent waits here for your answer.
  function drawAgent(agent) {
    const box = el('section', { class: 'agent', 'aria-label': 'JobScript agent' });
    const head = el('div', { class: 'agent-head' }, [el('strong', { text: agent.title || 'Agent' })]);
    if (agent.running) {
      head.appendChild(el('button', { class: 'btn stop', type: 'button', text: 'Stop', 'aria-label': 'Stop the agent now', onclick: trusted(() => agent.onStop()) }));
    } else if (agent.onClose) {
      head.appendChild(el('button', { class: 'icon', type: 'button', text: '×', title: 'Hide the agent log', 'aria-label': 'Hide the agent log', onclick: trusted(() => agent.onClose()) }));
    }
    box.appendChild(head);
    if (agent.status) box.appendChild(el('div', { class: 'agent-status', role: 'status', 'aria-live': 'polite', text: agent.status }));
    if (agent.running && agent.onAllowNav) {
      const nav = el('input', { type: 'checkbox' });
      nav.checked = !!agent.allowNav;
      nav.addEventListener('change', (e) => {
        if (e.isTrusted) agent.onAllowNav(nav.checked);
      });
      box.appendChild(el('label', { title: 'The agent never presses Submit or Apply' }, [nav, document.createTextNode('Allow Continue / Next for this run')]));
    }
    if (agent.prompt) box.appendChild(drawAgentPrompt(agent.prompt));
    if (agent.log && agent.log.length) {
      const list = el('ul', { class: 'agent-log', 'aria-label': 'Agent actions' });
      for (const entry of agent.log) list.appendChild(el('li', { class: entry.kind || 'action', text: entry.text }));
      box.appendChild(list);
      // Newest at the bottom, in view.
      requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
    }
    if (agent.usage) box.appendChild(el('div', { class: 'agent-usage', text: agent.usage }));
    return box;
  }

  function drawAgentPrompt(prompt) {
    const wrap = el('div', { class: 'agent-prompt', role: 'group', 'aria-label': 'The agent is asking you' });
    wrap.appendChild(el('p', { text: prompt.text }));
    if (prompt.detail) wrap.appendChild(el('p', { class: 'muted', text: prompt.detail }));
    const choices = el('div', { class: 'choices' });
    let answered = false;
    const answer = (value) => {
      if (answered) return;
      answered = true;
      prompt.onAnswer(value);
    };
    for (const o of prompt.options || []) {
      choices.appendChild(el('button', { class: 'btn' + (o.primary ? ' primary' : ''), type: 'button', text: o.label, onclick: trusted(() => answer(o.value)) }));
    }
    if (prompt.freeText) {
      const input = el('input', { type: 'text', 'aria-label': 'Your answer', placeholder: 'Or type an answer' });
      // Kept on the prompt, so a redraw of the panel doesn't lose what you've typed.
      input.value = prompt.draft || '';
      input.addEventListener('input', () => { prompt.draft = input.value; });
      const send = el('button', { class: 'btn primary', type: 'button', text: 'Send', onclick: trusted(() => input.value.trim() && answer(input.value.trim())) });
      input.addEventListener('keydown', (e) => {
        if (e.isTrusted && e.key === 'Enter' && input.value.trim()) answer(input.value.trim());
      });
      wrap.append(choices, input, send);
    } else {
      wrap.appendChild(choices);
    }
    return wrap;
  }

  // A list of answers to tick before saving them.
  function drawReview(review) {
    const wrap = el('div', { class: 'review' });
    const bar = el('div', { class: 'toolbar' });
    const list = el('div', { class: 'list' });
    const rows = [];
    for (const r of review.rows) {
      const box = el('input', { type: 'checkbox', 'aria-label': r.label });
      box.checked = !!r.checked;
      const row = el('label', { class: 'row' }, [box, el('span', { class: 'label', text: r.label, title: r.label })]);
      row.appendChild(el('span', { class: 'value', text: r.value + (r.note ? ' · ' + r.note : '') }));
      let select = null;
      if (r.dateChoices) {
        select = el('select', { 'aria-label': 'How to answer “' + r.label + '” next time' });
        for (const c of r.dateChoices.choices) select.append(new Option(c.label, c.rule, false, c.rule === r.dateChoices.selected));
        row.appendChild(select);
      }
      rows.push({ id: r.id, box, select });
      list.appendChild(row);
    }
    if (!rows.length) list.appendChild(el('div', { class: 'empty', text: 'No answers to save on this step.' }));
    const save = el('button', { class: 'btn primary', text: 'Save selected', 'aria-label': 'Save the selected answers' });
    save.addEventListener('click', trusted(async () => {
      save.disabled = true;
      try {
        await review.onSave(rows.filter((r) => r.box.checked).map((r) => ({ id: r.id, dateRule: r.select ? r.select.value : '' })));
      } finally {
        save.disabled = false;
      }
    }));
    bar.appendChild(el('span', { text: `${review.rows.length} answer${review.rows.length === 1 ? '' : 's'}` }));
    bar.appendChild(el('span', { class: 'spacer' }));
    bar.appendChild(el('button', { class: 'btn', text: 'Cancel', 'aria-label': 'Cancel saving answers', onclick: trusted(() => review.onCancel()) }));
    bar.appendChild(save);
    wrap.append(el('div', { class: 'review-title', text: review.title }), bar, list);
    return wrap;
  }

  function redraw() {
    if (dismissed && hasLauncher()) {
      if (mode !== 'launcher') drawLauncher();
      return;
    }
    // Before you open it, the Job tab only updates its content; it doesn't pop the panel open.
    if (mode === 'panel') draw();
  }

  globalThis.JobScriptPanel = {
    // Updates the Apply tab. After you close the panel, the update waits behind the button.
    render(next) {
      state = next;
      if (dismissed && hasLauncher()) {
        if (mode !== 'launcher') drawLauncher();
        return;
      }
      draw();
    },
    // Updates the Job tab (null removes it), without opening the panel.
    renderJob(view) {
      jobView = view;
      if (!view && !state) {
        if (mode === 'panel') close();
        return;
      }
      redraw();
    },
    // Opens the panel even if you closed it (you asked for a fill, say).
    open() {
      dismissed = false;
      draw();
    },
    // Opens the panel on one tab.
    openTab(tab) {
      dismissed = false;
      activeTab = tab === 'job' ? 'job' : 'apply';
      draw();
    },
    activeTab() {
      return activeTab;
    },
    // Puts the floating button on the page; onOpen runs when you click it. which: 'job' for the
    // job posting (the button then opens the Job tab), 'apply' (default) for the form.
    showLauncher(onOpen, which) {
      launchers[which === 'job' ? 'job' : 'apply'] = onOpen;
      if (mode !== 'panel') drawLauncher();
    },
    // Takes the floating button away (you turned it off, or the job left the page); an open
    // panel stays open. Without `which`, both.
    hideLauncher(which) {
      if (which) delete launchers[which];
      else for (const k of Object.keys(launchers)) delete launchers[k];
      if (mode === 'launcher' && !hasLauncher()) remove();
    },
    isOpen() {
      return mode === 'panel' && !!(host && host.isConnected);
    },
    close,
  };
})();
