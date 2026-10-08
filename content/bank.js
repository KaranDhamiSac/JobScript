// "Save to bank": after a fill, when you answer a field JobScript left for you, a small prompt
// offers to save that question and answer to your custom answers.
//
// - Only reacts to trusted events (your typing/clicking), never to events a page script
//   dispatches or to JobScript's own fills.
// - The prompt lives in a closed shadow DOM, and saving requires a real click on it.
// - Sensitive questions (SSN, date of birth, …), EEO questions and uploads are never offered.
(function () {
  if (globalThis.JobScriptBank) return;

  const HIDE_AFTER_MS = 15000;

  const CSS = `
    :host { all: initial; }
    .bubble {
      display: flex; align-items: center; gap: 6px; padding: 6px 6px 6px 10px;
      background: #111827; color: #f9fafb; border-radius: 8px; box-shadow: 0 6px 18px rgba(0,0,0,.25);
      font: 12px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    button { font: inherit; cursor: pointer; border-radius: 6px; border: none; padding: 4px 8px; }
    select { font: inherit; max-width: 220px; border-radius: 6px; border: 1px solid #374151; background: #1f2937; color: #f9fafb; padding: 3px 4px; }
    .save { background: #2563eb; color: #fff; font-weight: 600; }
    .close { background: none; color: #9ca3af; font-size: 14px; padding: 2px 6px; }
  `;

  let host = null;
  let shadow = null;
  let hideTimer = null;
  let active = null; // { f, getValue, onSaved, anchorEl }
  const watched = new Map(); // field id -> [cleanup functions]

  function ensureHost() {
    if (host && host.isConnected) return;
    host = document.createElement('jobscript-bank');
    const pin = { all: 'initial', position: 'fixed', 'z-index': '2147483647', display: 'block' };
    for (const [k, v] of Object.entries(pin)) host.style.setProperty(k, v, 'important');
    shadow = host.attachShadow({ mode: 'closed' });
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
      shadow.adoptedStyleSheets = [sheet];
    } catch (e) {
      const style = document.createElement('style');
      style.textContent = CSS;
      shadow.appendChild(style);
    }
    document.documentElement.appendChild(host);
  }

  function hide() {
    clearTimeout(hideTimer);
    if (host) host.remove();
    host = null;
    shadow = null;
    active = null;
  }

  function position(anchor) {
    const r = anchor.getBoundingClientRect();
    const top = Math.min(window.innerHeight - 44, Math.max(4, r.bottom + 6));
    const left = Math.min(window.innerWidth - 220, Math.max(4, r.left));
    host.style.setProperty('top', `${top}px`, 'important');
    host.style.setProperty('left', `${left}px`, 'important');
  }

  function button(cls, text, onClick) {
    const b = document.createElement('button');
    b.className = cls;
    b.textContent = text;
    b.addEventListener('click', (e) => {
      if (!e.isTrusted) return;
      e.stopPropagation();
      onClick();
    });
    return b;
  }

  function show(entry, anchor) {
    ensureHost();
    active = Object.assign(entry, { anchorEl: anchor });
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    // Dates: choose whether to keep this exact date or a rule like "2 weeks from today".
    let rule = null;
    const choices = entry.dateChoices && entry.dateChoices(entry.getValue());
    if (choices) {
      rule = document.createElement('select');
      rule.title = 'How to answer this next time';
      for (const c of choices.choices) rule.append(new Option(c.label, c.rule, false, c.rule === choices.selected));
      rule.addEventListener('focus', () => clearTimeout(hideTimer));
      bubble.append(rule);
    }
    const save = button('save', 'Save to bank', async () => {
      const value = entry.getValue();
      if (!value) return hide();
      save.disabled = true;
      await entry.save(value, rule ? rule.value : '');
      save.textContent = 'Saved ✓';
      if (entry.onSaved) entry.onSaved(value);
      clearTimeout(hideTimer);
      hideTimer = setTimeout(hide, 1200);
    });
    bubble.append(save, button('close', '×', hide));
    save.title = `Save your answer to “${entry.f.label}” for future applications`;
    shadow.replaceChildren(bubble);
    position(anchor);
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, HIDE_AFTER_MS);
  }

  function eligible(f) {
    const FM = globalThis.FieldMap;
    if (f.kind === 'file' || f.kind === 'checkbox') return false;
    if (f.category === 'eeo' || f.category === 'references') return false;
    if (FM.sensitiveLabel.test(f.label)) return false;
    return f.label && f.label !== '(unlabeled field)';
  }

  // Watch a field JobScript couldn't fill. getValue() returns its current value as text;
  // anchor() returns the element to place the prompt under; save(value, dateRule) stores it.
  // dateChoices(value), for date fields, returns { choices: [{ rule, label }], selected }.
  function watch(f, { getValue, anchor, save, dateChoices, onUserValue, onSaved }) {
    if (!eligible(f)) return;
    unwatch(f);
    const cleanups = [];
    watched.set(f.id, cleanups);
    const els = f.groupInputs || [f.el];
    const container = f.kind === 'combobox' ? anchor() : null;
    const handler = (e) => {
      if (!e.isTrusted) return;
      // Let the page's own handlers (e.g. react-select) update the value first.
      setTimeout(() => {
        const value = getValue();
        if (!value) return;
        // onUserValue returns true when it saved the answer itself (auto-save is on).
        // onUserValue returns true (or a promise of true) when it took care of the answer itself,
        // e.g. saved it automatically; otherwise the "Save to bank" prompt appears.
        const handled = onUserValue ? onUserValue(value) : false;
        const prompt = () => show({ f, getValue, save, dateChoices, onSaved }, anchor());
        if (handled === true) return;
        if (handled && typeof handled.then === 'function') {
          handled.then((done) => done !== true && prompt(), prompt);
          return;
        }
        prompt();
      }, 0);
    };
    const targets = container ? [container] : els;
    const types = ['text', 'textarea', 'combobox', 'listbox', 'prompt', 'datetext', 'datesections'].includes(f.kind) ? ['change', 'focusout']
      : f.kind === 'yesno' ? ['click'] : ['change'];
    for (const t of targets) {
      for (const type of types) {
        t.addEventListener(type, handler, true);
        cleanups.push(() => t.removeEventListener(type, handler, true));
      }
    }
  }

  // Stop offering to save a field (e.g. once JobScript has filled it).
  function unwatch(f) {
    for (const c of watched.get(f.id) || []) c();
    watched.delete(f.id);
    if (active && active.f.id === f.id) hide();
  }

  function reset() {
    for (const list of watched.values()) for (const c of list) c();
    watched.clear();
    hide();
  }

  // Keep the prompt next to its field while the page scrolls.
  window.addEventListener('scroll', () => {
    if (active && host && active.anchorEl.isConnected) position(active.anchorEl);
  }, { passive: true, capture: true });

  // A short note under a field after JobScript saved your answer on its own ("Saved", "Updated"),
  // with Undo. undo() resolves when the previous answer is back.
  function toast(anchor, text, undo) {
    if (!anchor || !anchor.isConnected) return;
    ensureHost();
    active = { f: { id: -1 }, anchorEl: anchor };
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.setAttribute('role', 'status');
    const label = document.createElement('span');
    label.textContent = text;
    bubble.append(label);
    if (undo) {
      const b = button('save', 'Undo', async () => {
        b.disabled = true;
        await undo();
        label.textContent = 'Undone';
        b.remove();
        clearTimeout(hideTimer);
        hideTimer = setTimeout(hide, 1500);
      });
      b.setAttribute('aria-label', `Undo: ${text}`);
      bubble.append(b);
    }
    bubble.append(button('close', '×', hide));
    shadow.replaceChildren(bubble);
    position(anchor);
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, 8000);
  }

  globalThis.JobScriptBank = { watch, unwatch, reset, toast };
})();
