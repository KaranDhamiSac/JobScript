// Side panel shown on the page after a fill. It lives in a *closed* shadow root on a custom element,
// so page scripts can't reach its contents (host.shadowRoot is null for them) and page CSS can't
// style it. Everything is built with createElement/textContent, never HTML strings, because
// labels come from the page.
//
// Usage from content/autofill.js:
//   JobScriptPanel.render({ summary, note, items, onSelect })
//   items: [{ id, category, label, status: 'filled'|'suggested'|'needs', detail, required,
//             draft, actions: [{ label, primary, onClick }] }]
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
    .toolbar { display: flex; gap: 8px; align-items: center; padding: 6px 12px; border-bottom: 1px solid var(--border); color: var(--muted); }
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
  `;

  let host = null;
  let shadow = null;
  let state = null;
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
    if (host && host.isConnected) return;
    host = document.createElement('jobscript-panel');
    // CSSOM (not a style attribute) so strict page CSPs don't block it; !important beats page CSS.
    const pin = { all: 'initial', position: 'fixed', top: '12px', right: '12px', 'z-index': '2147483647', display: 'block' };
    for (const [k, v] of Object.entries(pin)) host.style.setProperty(k, v, 'important');
    shadow = host.attachShadow({ mode: 'closed' });
    applyStyles(shadow);
    document.documentElement.appendChild(host);
  }

  function close() {
    if (host) host.remove();
    host = null;
    shadow = null;
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
      el('button', { class: 'label', text: item.label, title: item.label, onclick: trusted(() => state.onSelect(item.id)) })
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
        const b = el('button', { class: 'btn' + (a.primary ? ' primary' : ''), text: a.label });
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
    if (!state) return;
    ensureHost();
    const FM = globalThis.FieldMap;
    const items = state.items;
    const counts = { filled: 0, suggested: 0, needs: 0 };
    for (const it of items) counts[it.status] = (counts[it.status] || 0) + 1;

    const panel = el('div', { class: 'panel' + (ui.collapsed ? ' collapsed' : '') });
    panel.appendChild(
      el('header', null, [
        el('h1', { text: 'JobScript' }),
        el('button', {
          class: 'icon',
          text: ui.collapsed ? '▸' : '▾',
          title: ui.collapsed ? 'Expand' : 'Collapse',
          onclick: trusted(() => { ui.collapsed = !ui.collapsed; draw(); }),
        }),
        el('button', { class: 'icon', text: '×', title: 'Close', onclick: trusted(close) }),
      ])
    );

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
    body.appendChild(el('div', { class: 'note', text: state.note || '' }));

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
      const b = el('button', { class: 'btn' + (a.primary ? ' primary' : ''), text: a.label });
      b.addEventListener('click', trusted(async () => { b.disabled = true; try { await a.onClick(); } finally { b.disabled = false; } }));
      toolbar.appendChild(b);
    }
    body.appendChild(toolbar);

    const list = el('div', { class: 'list' });
    const visible = items.filter((it) => !(ui.hideFilled && it.status === 'filled'));
    if (!visible.length) list.appendChild(el('div', { class: 'empty', text: items.length ? 'Everything is filled.' : 'No fields found.' }));
    for (const cat of FM.categories.order) {
      const catItems = visible.filter((it) => it.category === cat);
      if (!catItems.length) continue;
      const open = !ui.closedCats.has(cat);
      const section = el('div', { class: 'cat' });
      section.appendChild(
        el('button', {
          onclick: trusted(() => { open ? ui.closedCats.add(cat) : ui.closedCats.delete(cat); draw(); }),
        }, [el('span', { class: 'caret', text: open ? '▾' : '▸' }), document.createTextNode(`${FM.categories.labels[cat]} (${catItems.length})`)])
      );
      if (open) for (const it of catItems) section.appendChild(renderItem(it));
      list.appendChild(section);
    }
    body.appendChild(list);
    panel.appendChild(body);

    // Re-rendering rebuilds the list; keep the user's scroll position.
    const oldList = shadow.querySelector('.list');
    const scrollTop = oldList ? oldList.scrollTop : 0;
    shadow.replaceChildren(panel);
    list.scrollTop = scrollTop;
    if (!shadow.adoptedStyleSheets || !shadow.adoptedStyleSheets.length) {
      if (!shadow.querySelector('style')) shadow.prepend(el('style', { text: CSS }));
    }
  }

  globalThis.JobScriptPanel = {
    render(next) {
      state = next;
      draw();
    },
    isOpen() {
      return !!(host && host.isConnected);
    },
    close,
  };
})();
