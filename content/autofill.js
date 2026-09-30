// Autofill content script. Runs in every frame on supported job sites, but does nothing until
// background.js calls globalThis.__jobscriptFill() (popup button or Alt+Shift+F).
// It never submits the form.
(function () {
  if (globalThis.__jobscriptFill) return;

  const FM = globalThis.FieldMap;
  const S = globalThis.JobScriptStorage;

  const FILLED_CLASS = 'jobscript-filled';
  const NEEDS_CLASS = 'jobscript-needs';
  const SKIP_INPUT_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image', 'password', 'search']);
  const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6, legend, [role="heading"]';
  const STOPWORDS = new Set([
    'the', 'a', 'an', 'you', 'your', 'are', 'do', 'to', 'of', 'in', 'for', 'is', 'and', 'or',
    'with', 'this', 'that', 'have', 'be', 'we', 'our', 'what', 'how', 'if', 'please', 'on', 'at',
  ]);

  let running = false;

  // ---------------------------------------------------------------------------
  // Text helpers

  function clean(s) {
    return String(s || '').replace(/\s+/g, ' ').trim();
  }

  // Normalised form used for all rule matching (see the header of lib/fieldMap.js).
  function norm(s) {
    return String(s || '')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_\-\[\]().:;,*?#/\\|"'’“”!✱+]+/g, ' ')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function tokens(s) {
    return norm(s)
      .split(' ')
      .filter((t) => t.length > 1 && !STOPWORDS.has(t));
  }

  function similarity(a, b) {
    const na = norm(a);
    const nb = norm(b);
    if (!na || !nb) return 0;
    if (na === nb) return 1;
    if ((na.includes(nb) || nb.includes(na)) && Math.min(na.length, nb.length) >= 12) return 0.9;
    const ta = new Set(tokens(a));
    const tb = new Set(tokens(b));
    if (!ta.size || !tb.size) return 0;
    let shared = 0;
    for (const t of ta) if (tb.has(t)) shared++;
    return shared / (ta.size + tb.size - shared);
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function waitFor(fn, timeout) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const v = fn();
      if (v) return v;
      await sleep(50);
    }
    return fn();
  }

  // ---------------------------------------------------------------------------
  // Rule compilation

  function compileRules(map, extra) {
    return Object.entries(map).map(([key, rule]) => ({
      key,
      rule,
      type: rule.type || 'text',
      keywordRes: (rule.keywords || []).map((k) => new RegExp('\\b' + escapeRegex(norm(k)) + '\\b')),
      patternRes: rule.patterns || [],
      autocomplete: rule.autocomplete || [],
      exclude: rule.exclude || [],
      ...extra,
    }));
  }

  const TOP_RULES = compileRules(FM.fields);
  const SECTION_RULES = {};
  const STANDALONE_RULES = [];
  for (const [section, def] of Object.entries(FM.sections)) {
    SECTION_RULES[section] = compileRules(def.fields, { section });
    STANDALONE_RULES.push(...SECTION_RULES[section].filter((c) => c.rule.standalone));
  }

  // ---------------------------------------------------------------------------
  // DOM inspection

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden') return false;
    return el.getClientRects().length > 0;
  }

  function isCombobox(el) {
    return (
      el.getAttribute('role') === 'combobox' ||
      ['list', 'both'].includes(el.getAttribute('aria-autocomplete')) ||
      el.getAttribute('aria-haspopup') === 'listbox'
    );
  }

  // react-select style widgets: the input sits inside a "__control" div whose parent holds the menu.
  function comboContainer(el) {
    const control = el.closest('[class*="__control"], [class*="-control"]');
    return control ? control.parentElement : el.parentElement && el.parentElement.parentElement;
  }

  function textWithoutControls(node) {
    const copy = node.cloneNode(true);
    copy.querySelectorAll('input, select, textarea, button, option, [role="listbox"], [role="option"]').forEach((n) => n.remove());
    return copy.textContent;
  }

  // Closest short bit of text sitting just before the element (or one of its ancestors).
  function nearbyText(el) {
    let node = el;
    for (let depth = 0; depth < 4 && node && node !== document.body; depth++) {
      let sib = node.previousElementSibling;
      for (let i = 0; sib && i < 3; i++, sib = sib.previousElementSibling) {
        if (sib.matches('input, select, textarea') || sib.querySelector('input, select, textarea')) break;
        const t = clean(sib.textContent);
        if (t && t.length <= 200) return t;
      }
      node = node.parentElement;
    }
    return '';
  }

  function textOfIds(ids) {
    return (ids || '')
      .split(/\s+/)
      .map((id) => id && document.getElementById(id))
      .filter(Boolean)
      .map((n) => n.textContent)
      .join(' ');
  }

  function labelText(el) {
    const parts = [];
    const labelledBy = textOfIds(el.getAttribute('aria-labelledby'));
    if (clean(labelledBy)) parts.push(labelledBy);
    if (!parts.length && el.labels && el.labels.length) {
      for (const l of el.labels) parts.push(textWithoutControls(l));
    }
    if (!parts.length) {
      const wrap = el.closest('label');
      if (wrap) parts.push(textWithoutControls(wrap));
    }
    if (!parts.length || !clean(parts.join(''))) parts.push(nearbyText(el));
    return clean(parts.join(' '));
  }

  // Text of a single radio/checkbox option.
  function optionLabel(input) {
    if (input.labels && input.labels.length) return clean(textWithoutControls(input.labels[0]));
    const wrap = input.closest('label');
    if (wrap) return clean(textWithoutControls(wrap));
    const next = input.nextElementSibling;
    if (next && clean(next.textContent)) return clean(next.textContent);
    return clean(input.value);
  }

  function commonAncestor(nodes) {
    let a = nodes[0].parentElement;
    while (a && !nodes.every((n) => a.contains(n))) a = a.parentElement;
    return a || document.body;
  }

  // The question text for a radio or checkbox group.
  function groupLabel(inputs) {
    const first = inputs[0];
    const fieldset = first.closest('fieldset');
    if (fieldset) {
      const legend = fieldset.querySelector('legend');
      if (legend && clean(legend.textContent)) return clean(legend.textContent);
    }
    const group = first.closest('[role="radiogroup"], [role="group"]');
    if (group) {
      const t = textOfIds(group.getAttribute('aria-labelledby')) || group.getAttribute('aria-label');
      if (clean(t)) return clean(t);
    }
    const t = nearbyText(commonAncestor(inputs));
    if (t) return t;
    return inputs.length === 1 ? optionLabel(first) : '';
  }

  function ancestorContext(el) {
    const bits = [];
    for (let n = el.parentElement, d = 0; n && d < 3; n = n.parentElement, d++) {
      bits.push(n.id || '');
      if (typeof n.className === 'string') bits.push(n.className);
    }
    return bits.join(' ');
  }

  function describe(f) {
    const el = f.el;
    const isGroup = f.kind === 'radio' || f.kind === 'checkboxGroup';
    const labelRaw = isGroup ? groupLabel(f.groupInputs) : labelText(el);
    const ac = (el.getAttribute('autocomplete') || '').toLowerCase().trim().split(/\s+/).pop();
    return {
      labelRaw,
      label: norm(labelRaw),
      aria: isGroup ? '' : norm(el.getAttribute('aria-label')),
      placeholder: norm(el.getAttribute('placeholder')),
      placeholderRaw: el.getAttribute('placeholder') || '',
      attrs: norm([el.name, el.id].filter(Boolean).join(' ')),
      autocomplete: ac === 'on' || ac === 'off' ? '' : ac,
      context: f.kind === 'file' ? norm(ancestorContext(el)) : '',
    };
  }

  function collectFields(root) {
    const out = [];
    const groups = new Map();
    for (const el of root.querySelectorAll('input, select, textarea')) {
      if (el.disabled || el.closest('.jobscript-toast')) continue;
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (el.tagName === 'INPUT' && SKIP_INPUT_TYPES.has(type)) continue;
      if (el.readOnly && type !== 'file' && !isCombobox(el)) continue;

      if ((type === 'radio' || type === 'checkbox') && el.name) {
        const gk = type + ':' + el.name;
        const existing = groups.get(gk);
        if (existing) {
          existing.groupInputs.push(el);
          continue;
        }
        const f = { el, kind: type, groupInputs: [el] };
        groups.set(gk, f);
        out.push(f);
        continue;
      }

      let kind;
      if (el.tagName === 'SELECT') kind = 'select';
      else if (el.tagName === 'TEXTAREA') kind = 'textarea';
      else if (type === 'file') kind = 'file';
      else if (type === 'checkbox') kind = 'checkbox';
      else if (type === 'radio') kind = 'radio';
      else if (type === 'date' || type === 'month') kind = type;
      else if (isCombobox(el)) kind = 'combobox';
      else kind = 'text';
      const f = { el, kind };
      if (kind === 'radio') f.groupInputs = [el];
      out.push(f);
    }

    for (const f of out) {
      if (f.kind === 'checkbox' && f.groupInputs) {
        if (f.groupInputs.length > 1) f.kind = 'checkboxGroup';
        else delete f.groupInputs;
      }
    }

    return out.filter((f) =>
      (f.groupInputs || [f.el]).some((e) => isVisible(e) || isVisible(e.closest('label') || e.parentElement))
    );
  }

  function headingAbove(el, headings) {
    let best = null;
    for (const h of headings) {
      if (h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) best = h;
      else break;
    }
    return best ? clean(best.textContent) : '';
  }

  function sectionOf(el, root, headings) {
    const entries = Object.entries(FM.sections);
    const attrs = (el.name || '') + ' ' + (el.id || '');
    for (const [key, sec] of entries) {
      if (sec.attrPatterns.some((re) => re.test(attrs))) return key;
    }
    for (let n = el.parentElement, d = 0; n && n !== root && d < 8; n = n.parentElement, d++) {
      const s = (n.id || '') + ' ' + (typeof n.className === 'string' ? n.className : '');
      for (const [key, sec] of entries) {
        if (sec.attrPatterns.some((re) => re.test(s))) return key;
      }
    }
    const heading = headingAbove(el, headings);
    if (heading) {
      for (const [key, sec] of entries) {
        if (sec.headings.some((re) => re.test(heading))) return key;
      }
    }
    return null;
  }

  function isPlaceholderOption(text) {
    return FM.placeholderOptions.some((re) => re.test(text));
  }

  function isEmpty(f) {
    const el = f.el;
    switch (f.kind) {
      case 'radio':
      case 'checkboxGroup':
        return !f.groupInputs.some((i) => i.checked);
      case 'checkbox':
        return !el.checked;
      case 'file':
        return !el.files || el.files.length === 0;
      case 'select': {
        const opt = el.options[el.selectedIndex];
        return !opt || !el.value || isPlaceholderOption(clean(opt.textContent));
      }
      case 'combobox': {
        const c = comboContainer(el);
        const chosen = c && c.querySelector('[class*="single-value"], [class*="multi-value"]');
        return !(chosen && clean(chosen.textContent)) && !clean(el.value);
      }
      default:
        return !clean(el.value);
    }
  }

  function isRequired(f) {
    const els = f.groupInputs || [f.el];
    if (els.some((e) => e.required || e.getAttribute('aria-required') === 'true')) return true;
    return FM.requiredMarkers.some((re) => re.test(f.desc.labelRaw));
  }

  function detectDatePart(d) {
    const text = [d.label, d.attrs, d.placeholder].join(' ');
    const parts = Object.entries(FM.dateParts).filter(([, re]) => re.test(text));
    return parts.length === 1 ? parts[0][0] : null;
  }

  // ---------------------------------------------------------------------------
  // Matching fields to profile values

  function compatible(ruleType, kind) {
    if (kind === 'file') return ruleType === 'file';
    if (ruleType === 'file') return false;
    if (kind === 'checkbox') return ruleType === 'bool';
    if (kind === 'date' || kind === 'month') return ruleType === 'date';
    return true;
  }

  function scoreRule(c, d) {
    const all = [d.label, d.aria, d.placeholder, d.attrs].join(' | ');
    if (c.exclude.some((re) => re.test(all))) return 0;
    if (d.autocomplete && c.autocomplete.includes(d.autocomplete)) return 1000;

    const loose = c.type === 'bool' || c.type === 'choice';
    let best = 0;
    const sources = [[d.label, 3], [d.aria, 3], [d.placeholder, 2], [d.attrs, 2], [d.context, 1]];
    for (const [text, weight] of sources) {
      if (!text) continue;
      for (const [res, isPattern] of [[c.keywordRes, false], [c.patternRes, true]]) {
        for (const re of res) {
          const m = text.match(re);
          if (!m) continue;
          const len = m[0].length;
          // A short keyword buried in a long question is probably a coincidence.
          const accepted = loose || isPattern || len >= 10 || len / text.length >= 0.3;
          if (accepted) best = Math.max(best, weight * (10 + len));
        }
      }
    }
    return best;
  }

  function bestRule(rules, d, kind) {
    let best = null;
    for (const c of rules) {
      if (!compatible(c.type, kind)) continue;
      const score = scoreRule(c, d);
      if (score > 0 && (!best || score > best.score)) best = { c, score };
    }
    return best && best.c;
  }

  function bestCustomAnswer(labelRaw, answers) {
    let best = null;
    for (const a of answers) {
      if (!a.question || !a.answer) continue;
      const score = similarity(labelRaw, a.question);
      if (!best || score > best.score) best = { answer: a.answer, score };
    }
    return best;
  }

  function valueFor(c, obj) {
    const v = c.rule.value ? c.rule.value(obj) : obj[c.key];
    return v == null ? '' : String(v);
  }

  function matchField(f, profile) {
    const d = f.desc;
    const custom = f.kind === 'file' ? null : bestCustomAnswer(d.labelRaw, profile.customAnswers);
    if (custom && custom.score >= 0.9) return { source: 'custom answer', type: 'text', raw: custom.answer };

    let c = f.section ? bestRule(SECTION_RULES[f.section], d, f.kind) : null;
    if (!c) c = bestRule(TOP_RULES, d, f.kind);
    if (!c && !f.section) c = bestRule(STANDALONE_RULES, d, f.kind);
    if (c) {
      if (c.section) return { source: c.section + '.' + c.key, c, type: c.type, section: c.section, key: c.key };
      return { source: c.key, c, type: c.type, key: c.key, raw: c.type === 'file' ? 'resume' : valueFor(c, profile) };
    }

    if (custom && custom.score >= 0.6) return { source: 'custom answer', type: 'text', raw: custom.answer };
    return null;
  }

  function analyze(root, profile) {
    const headings = [...root.querySelectorAll(HEADING_SELECTOR)].filter((h) => {
      const t = clean(h.textContent);
      return t && t.length <= 80;
    });
    const fields = collectFields(root);
    const counters = new Map();
    for (const f of fields) {
      f.desc = describe(f);
      f.section = sectionOf(f.el, root, headings);
      f.required = isRequired(f);
      f.empty = isEmpty(f);
      f.datePart = detectDatePart(f.desc);
      f.match = matchField(f, profile);

      // Repeating sections: the nth "School" field on the page gets profile.education[n].
      if (f.match && f.match.section) {
        const part = f.match.type === 'date' ? f.datePart || '' : '';
        const ck = [f.match.section, f.match.key, part].join('|');
        const idx = counters.get(ck) || 0;
        counters.set(ck, idx + 1);
        f.match.entryIndex = idx;
        const entry = profile[f.match.section][idx];
        f.match.raw = entry ? valueFor(f.match.c, entry) : '';
      }
    }
    return fields;
  }

  // ---------------------------------------------------------------------------
  // Repeating sections: click "Add another" until the page has as many entries as the profile.

  function findAddButton(root, sectionKey, headings) {
    const sec = FM.sections[sectionKey];
    const candidates = root.querySelectorAll('button, a, [role="button"], input[type="button"]');
    for (const btn of candidates) {
      if (!isVisible(btn)) continue;
      const text = clean(btn.textContent || btn.value);
      if (!text || text.length > 40) continue;
      if (!sec.addButton.some((re) => re.test(text))) continue;
      if (sectionOf(btn, root, headings) === sectionKey) return btn;
    }
    return null;
  }

  function clickAndWaitForChange(btn, root) {
    return new Promise((resolve) => {
      let timer = null;
      const done = () => {
        observer.disconnect();
        clearTimeout(timer);
        setTimeout(resolve, 250);
      };
      const observer = new MutationObserver(done);
      observer.observe(root, { childList: true, subtree: true });
      timer = setTimeout(done, 2000);
      btn.click();
    });
  }

  async function ensureEntries(root, profile) {
    for (const [sectionKey, sec] of Object.entries(FM.sections)) {
      const wanted = profile[sectionKey].length;
      if (!wanted) continue;
      for (let attempt = 0; attempt < wanted + 1; attempt++) {
        const fields = analyze(root, profile);
        const have = fields.filter(
          (f) => f.match && f.match.section === sectionKey && f.match.key === sec.anchor
        ).length;
        if (have >= wanted) break;
        const headings = [...root.querySelectorAll(HEADING_SELECTOR)];
        const btn = findAddButton(root, sectionKey, headings);
        if (!btn) break;
        await clickAndWaitForChange(btn, root);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Value formatting and option picking

  function parseYearMonth(raw) {
    const m = /^(\d{4})-(\d{1,2})/.exec(raw || '');
    return m ? { y: m[1], m: Number(m[2]) } : null;
  }

  function formatWholeDate(ym, f) {
    const mm = String(ym.m).padStart(2, '0');
    if (f.kind === 'date') return `${ym.y}-${mm}-01`;
    if (f.kind === 'month') return `${ym.y}-${mm}`;
    const ph = f.desc.placeholderRaw.toLowerCase();
    if (/yyyy[-/]mm/.test(ph)) return `${ym.y}-${mm}`;
    if (/mm[-/ ]dd[-/ ]yyyy/.test(ph)) return `${mm}/01/${ym.y}`;
    if (/mm[-/ ]yy\b/.test(ph)) return `${mm}/${ym.y.slice(2)}`;
    return `${mm}/${ym.y}`;
  }

  // Returns { text, hint } for the field, or null when there is nothing to fill.
  function resolveValue(f) {
    const raw = f.match.raw;
    if (!raw) return null;
    if (f.match.type === 'date' || f.kind === 'date' || f.kind === 'month') {
      const ym = parseYearMonth(raw);
      if (!ym) return null;
      if (f.datePart === 'month') {
        return { text: String(ym.m).padStart(2, '0'), hint: { month: ym.m } };
      }
      if (f.datePart === 'year') return { text: ym.y, hint: {} };
      if (f.datePart === 'day') return { text: '01', hint: {} };
      return { text: formatWholeDate(ym, f), hint: {} };
    }
    const isBool = f.match.type === 'bool' || /^(yes|no)$/i.test(raw);
    if (isBool) {
      const yes = /^y/i.test(raw);
      return { text: yes ? 'Yes' : 'No', hint: { bool: yes ? 'yes' : 'no' } };
    }
    return { text: raw, hint: { key: f.match.key } };
  }

  function classifyBool(text) {
    if (FM.boolAliases.no.some((re) => re.test(text))) return 'no';
    if (FM.boolAliases.yes.some((re) => re.test(text))) return 'yes';
    return null;
  }

  function monthForms(m) {
    const name = FM.MONTHS[m - 1];
    return new Set([name, name.slice(0, 3), String(m), String(m).padStart(2, '0')]);
  }

  function stateForms(value) {
    const forms = new Set([norm(value)]);
    for (const [abbr, name] of Object.entries(FM.US_STATES)) {
      if (norm(abbr) === norm(value) || norm(name) === norm(value)) {
        forms.add(norm(abbr));
        forms.add(norm(name));
      }
    }
    return forms;
  }

  // options: [{ text, value }]. Returns the index of the best option, or -1.
  function pickOption(options, value, hint) {
    const cands = options
      .map((o, i) => ({ i, text: clean(o.text), nt: norm(o.text), nv: norm(o.value) }))
      .filter((o) => o.text && !isPlaceholderOption(o.text));
    const target = norm(value);
    const tests = [];

    if (hint.bool) tests.push((o) => classifyBool(o.text) === hint.bool);
    if (hint.month) {
      const forms = monthForms(hint.month);
      tests.push((o) => forms.has(o.nt) || forms.has(o.nv));
    }
    if (hint.key === 'state') {
      const forms = stateForms(value);
      tests.push((o) => forms.has(o.nt) || forms.has(o.nv));
    }
    for (const re of FM.valueAliases[value] || []) tests.push((o) => re.test(o.text));
    tests.push((o) => o.nt === target || o.nv === target);
    tests.push((o) => target.length >= 2 && o.nt.startsWith(target));
    tests.push((o) => o.nt.length >= 3 && target.startsWith(o.nt));
    tests.push((o) => target.length >= 3 && o.nt.includes(target));

    for (const test of tests) {
      const hit = cands.find(test);
      if (hit) return hit.i;
    }

    let best = null;
    for (const o of cands) {
      const s = similarity(o.text, value);
      if (s >= 0.5 && (!best || s > best.s)) best = { i: o.i, s };
    }
    return best ? best.i : -1;
  }

  // ---------------------------------------------------------------------------
  // Writing values

  function setNativeValue(el, value) {
    const proto =
      el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
  }

  // React and similar frameworks only notice changes that arrive as real events.
  function fireEvents(el) {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new FocusEvent('blur'));
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  }

  function fillText(el, text) {
    setNativeValue(el, text);
    fireEvents(el);
    return clean(el.value) !== '';
  }

  function fillSelect(el, value) {
    const options = [...el.options].map((o) => ({ text: o.textContent, value: o.value }));
    const idx = pickOption(options, value.text, value.hint);
    if (idx < 0) return false;
    el.selectedIndex = idx;
    fireEvents(el);
    return true;
  }

  function fillChoiceGroup(f, value) {
    const options = f.groupInputs.map((i) => ({ text: optionLabel(i), value: i.value }));
    const idx = pickOption(options, value.text, value.hint);
    if (idx < 0) return false;
    const input = f.groupInputs[idx];
    if (!input.checked) input.click();
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    return input.checked;
  }

  function fillCheckbox(el, value) {
    if (value.hint.bool !== 'yes') return true; // "no" means leave it unchecked
    if (!el.checked) el.click();
    return el.checked;
  }

  function comboOptions(el) {
    const id = el.getAttribute('aria-controls') || el.getAttribute('aria-owns');
    const listbox = id && document.getElementById(id);
    let opts = listbox ? [...listbox.querySelectorAll('[role="option"]')] : [];
    if (!opts.length) {
      const c = comboContainer(el);
      if (c) opts = [...c.querySelectorAll('[role="option"], [class*="__option"]')];
    }
    return opts.filter(isVisible);
  }

  function keyEvent(el, key, keyCode) {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, keyCode, which: keyCode, bubbles: true }));
  }

  function clickOption(opt) {
    for (const type of ['mouseover', 'mousedown', 'mouseup', 'click']) {
      opt.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
  }

  async function fillCombobox(f, value) {
    const el = f.el;
    const choose = (opts) => pickOption(opts.map((o) => ({ text: o.textContent, value: '' })), value.text, value.hint);

    el.focus();
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    keyEvent(el, 'ArrowDown', 40);
    let opts = await waitFor(() => { const o = comboOptions(el); return o.length ? o : null; }, 800);
    let idx = opts ? choose(opts) : -1;

    // Not in the initial list: type to search (handles long or remotely loaded lists).
    if (idx < 0) {
      const search = value.hint.month ? FM.MONTHS[value.hint.month - 1] : value.text.slice(0, 40);
      setNativeValue(el, search);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      opts = await waitFor(() => {
        const o = comboOptions(el);
        return o.length && choose(o) >= 0 ? o : null;
      }, 2500);
      opts = opts || comboOptions(el);
      idx = opts.length ? choose(opts) : -1;
      if (idx < 0 && opts.length) {
        // Location/school searches often return "Sacramento, California, United States" for
        // "Sacramento, CA", so accept the first result that starts with the same word.
        const firstWord = norm(value.text).split(' ')[0];
        if (firstWord.length >= 4) idx = opts.findIndex((o) => norm(o.textContent).startsWith(firstWord));
      }
    }

    if (idx < 0) {
      setNativeValue(el, '');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      keyEvent(el, 'Escape', 27);
      el.blur();
      return false;
    }

    clickOption(opts[idx]);
    await sleep(120);
    el.blur();
    return !isEmpty(f);
  }

  function attachFile(el, resume) {
    if (!resume || !resume.data) return false;
    const bin = atob(resume.data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const file = new File([bytes], resume.name, { type: resume.type || 'application/pdf' });
    const dt = new DataTransfer();
    dt.items.add(file);
    el.files = dt.files;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return el.files.length > 0;
  }

  async function applyMatch(f, resume) {
    if (f.kind === 'file') return attachFile(f.el, resume);
    const value = resolveValue(f);
    if (!value) return false;
    switch (f.kind) {
      case 'select': return fillSelect(f.el, value);
      case 'radio':
      case 'checkboxGroup': return fillChoiceGroup(f, value);
      case 'checkbox': return fillCheckbox(f.el, value);
      case 'combobox': return fillCombobox(f, value);
      default: return fillText(f.el, value.text);
    }
  }

  // ---------------------------------------------------------------------------
  // Highlighting and on-page feedback

  function highlightTarget(f) {
    if (f.groupInputs) {
      const c = commonAncestor(f.groupInputs);
      return f.groupInputs.length === 1 ? f.groupInputs[0].closest('label') || c : c;
    }
    if (f.kind === 'combobox') {
      return f.el.closest('[class*="__control"], [class*="-control"]') || f.el;
    }
    let el = f.el;
    for (let d = 0; el && !isVisible(el) && d < 4; d++) el = el.parentElement;
    return el || f.el;
  }

  function mark(f, cls) {
    const target = highlightTarget(f);
    if (target) target.classList.add(cls);
  }

  function clearHighlights() {
    document.querySelectorAll('.' + FILLED_CLASS + ', .' + NEEDS_CLASS).forEach((n) =>
      n.classList.remove(FILLED_CLASS, NEEDS_CLASS)
    );
  }

  function toast(message) {
    document.querySelectorAll('.jobscript-toast').forEach((n) => n.remove());
    const box = document.createElement('div');
    box.className = 'jobscript-toast';
    box.textContent = message;
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 6000);
  }

  // ---------------------------------------------------------------------------
  // Entry point

  function findRoot() {
    const site = FM.sites.find((s) => s.hosts.some((re) => re.test(location.hostname)));
    if (site) {
      for (const sel of site.formSelectors) {
        const node = document.querySelector(sel);
        if (node) return { root: node, site: site.name };
      }
    }
    return { root: document.body, site: site ? site.name : location.hostname };
  }

  // Returns null when this frame has no form fields, so background.js can ignore it.
  async function fillPage() {
    if (running) return { ok: false, error: 'A fill is already running on this page.' };
    running = true;
    try {
      const [profile, resume] = await Promise.all([S.getProfile(), S.getResume()]);
      const { root, site } = findRoot();
      clearHighlights();
      await ensureEntries(root, profile);

      const fields = analyze(root, profile);
      if (!fields.length) return null;

      let filled = 0;
      let total = 0;
      let needsAttention = 0;
      let alreadyFilled = 0;
      for (const f of fields) {
        if (!f.empty) {
          alreadyFilled++;
          continue;
        }
        total++;
        let ok = false;
        if (f.match) {
          try {
            ok = await applyMatch(f, resume);
          } catch (err) {
            console.warn('[JobScript] could not fill field', f.desc.labelRaw || f.el, err);
          }
        }
        if (ok) {
          filled++;
          mark(f, FILLED_CLASS);
        } else if (f.required) {
          needsAttention++;
          mark(f, NEEDS_CLASS);
        }
      }

      const note = needsAttention ? ` · ${needsAttention} required need you` : '';
      toast(`JobScript filled ${filled} of ${total} fields${note}. Review before submitting.`);
      return { ok: true, site, filled, total, needsAttention, alreadyFilled };
    } finally {
      running = false;
    }
  }

  globalThis.__jobscriptFill = fillPage;
})();
