// Autofill content script. Runs in every frame on supported job sites, but does nothing until
// background.js calls globalThis.__jobscriptFill() (popup button or Alt+Shift+F).
// It never submits the form.
(function () {
  if (globalThis.__jobscriptFill) return;

  const FM = globalThis.FieldMap;
  const S = globalThis.JobScriptStorage;

  const FILLED_CLASS = 'jobscript-filled';
  const NEEDS_CLASS = 'jobscript-needs';
  const SUGGESTED_CLASS = 'jobscript-suggested';
  const FLASH_CLASS = 'jobscript-flash';
  const SKIP_INPUT_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image', 'password', 'search']);
  const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6, legend, [role="heading"]';
  const STOPWORDS = new Set([
    'the', 'a', 'an', 'you', 'your', 'are', 'do', 'to', 'of', 'in', 'for', 'is', 'and', 'or',
    'with', 'this', 'that', 'have', 'be', 'we', 'our', 'what', 'how', 'if', 'please', 'on', 'at',
    'did', 'does', 'tell', 'me', 'my', 'would', 'can', 'us',
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

  // Crude stemming so "heard"/"hear" and "relocating"/"relocate" line up.
  function stem(t) {
    return t.length > 4 ? t.replace(/(ing|ed|es|s|d|e)$/, '') : t;
  }

  function tokens(s) {
    return norm(s)
      .split(' ')
      .filter((t) => t.length > 1 && !STOPWORDS.has(t))
      .map(stem);
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
        if (t && t.length <= 500) return t;
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
      if (el.disabled) continue;
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (el.tagName === 'INPUT' && SKIP_INPUT_TYPES.has(type)) continue;
      if (el.readOnly && type !== 'file' && !isCombobox(el)) continue;
      // react-select's hidden "requiredInput" twin of each dropdown; the dropdown itself is handled.
      if (el.getAttribute('aria-hidden') === 'true' && el.tabIndex === -1) continue;

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

    return out.filter((f) => {
      if (f.kind === 'text' || f.kind === 'textarea' || f.kind === 'select' || f.kind === 'date' || f.kind === 'month') {
        return isReallyVisible(f.el);
      }
      return (f.groupInputs || [f.el]).some((e) => isVisible(e) || isVisible(e.closest('label') || e.parentElement));
    });
  }

  // Stricter check for fields that receive typed profile data, so a page can't collect it through
  // fields you can't see (transparent, tiny, or positioned off-screen).
  function isReallyVisible(el) {
    if (!isVisible(el)) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    if (r.right + window.scrollX <= 0 || r.bottom + window.scrollY <= 0) return false;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      if (parseFloat(getComputedStyle(n).opacity) < 0.05) return false;
    }
    return true;
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

  // Confidence tiers (see FM.confidence): high fills automatically, medium is suggested,
  // low is left for you.
  function tierOf(conf) {
    return conf >= FM.confidence.high ? 'high' : conf >= FM.confidence.medium ? 'medium' : 'low';
  }

  // { score, conf }: score ranks rules against each other; conf (0-1) says how sure the match is.
  function scoreRule(c, d) {
    const none = { score: 0, conf: 0 };
    const all = [d.label, d.aria, d.placeholder, d.attrs].join(' | ');
    if (c.exclude.some((re) => re.test(all))) return none;
    if (d.autocomplete && c.autocomplete.includes(d.autocomplete)) return { score: 1000, conf: 1 };

    // Questions and upload widgets tend to have long labels ("Resume/CV ATTACH Analyzing resume...").
    const loose = c.type === 'bool' || c.type === 'choice' || c.type === 'file';
    let best = 0;
    let conf = 0;
    const sources = [[d.label, 3], [d.aria, 3], [d.placeholder, 2], [d.attrs, 2], [d.context, 1]];
    for (const [text, weight] of sources) {
      if (!text) continue;
      for (const [res, isPattern] of [[c.keywordRes, false], [c.patternRes, true]]) {
        for (const re of res) {
          const m = text.match(re);
          if (!m) continue;
          const len = m[0].length;
          const coverage = len / text.length;
          // A short keyword buried in a long question is probably a coincidence.
          const strong = isPattern || len >= 10 || coverage >= 0.3;
          if (!strong && !loose) continue;
          best = Math.max(best, weight * (10 + len));
          // Upload widgets are unambiguous once "resume" appears, however noisy the label.
          let matchConf = isPattern || len >= 10 || coverage >= 0.5 ? 0.92 : strong ? 0.88 : c.type === 'file' ? 0.9 : 0.7;
          if (weight === 1) matchConf = Math.min(matchConf, 0.85); // matched only on surrounding markup
          conf = Math.max(conf, matchConf);
        }
      }
    }
    return { score: best, conf };
  }

  function bestRule(rules, d, kind) {
    let best = null;
    for (const c of rules) {
      if (!compatible(c.type, kind)) continue;
      const r = scoreRule(c, d);
      if (r.score > 0 && (!best || r.score > best.score)) best = { c, score: r.score, conf: r.conf };
    }
    return best;
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

  function withConfidence(match, conf) {
    match.confidence = Math.round(conf * 100) / 100;
    match.tier = tierOf(conf);
    return match;
  }

  function matchField(f, profile) {
    const d = f.desc;
    const custom = f.kind === 'file' ? null : bestCustomAnswer(d.labelRaw, profile.customAnswers);
    if (custom && custom.score >= 0.9) {
      return withConfidence({ source: 'saved answer', type: 'text', raw: custom.answer }, 0.95);
    }

    let hit = f.section ? bestRule(SECTION_RULES[f.section], d, f.kind) : null;
    let standalone = false;
    if (!hit) hit = bestRule(TOP_RULES, d, f.kind);
    if (!hit && !f.section) {
      hit = bestRule(STANDALONE_RULES, d, f.kind);
      standalone = !!hit;
    }
    if (hit) {
      const c = hit.c;
      let conf = hit.conf;
      if (c.rule.confidence === 'medium') conf = Math.min(conf, 0.7); // lookups, e.g. skills
      if (standalone) conf = Math.min(conf, 0.75); // "School" with no Education section around it
      const match = c.section
        ? { source: c.section + '.' + c.key, c, type: c.type, section: c.section, key: c.key }
        : { source: c.key, c, type: c.type, key: c.key, raw: c.type === 'file' ? 'resume' : valueFor(c, profile) };
      return withConfidence(match, conf);
    }

    if (custom && custom.score >= 0.6) {
      // Similar, not identical, question: 0.6 -> 0.60, 0.9 -> 0.75.
      return withConfidence({ source: 'saved answer', type: 'text', raw: custom.answer }, 0.6 + (custom.score - 0.6) * 0.5);
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Scanner: per-field metadata for the side panel. IDs live only in this script's memory,
  // never in DOM attributes.

  const fieldIds = new WeakMap();
  let nextFieldId = 1;

  function idFor(el) {
    let id = fieldIds.get(el);
    if (!id) {
      id = nextFieldId++;
      fieldIds.set(el, id);
    }
    return id;
  }

  function displayLabel(f) {
    let raw = clean(f.desc.labelRaw);
    // Lever-style labels wrap the whole widget, status text included; prefer the title element.
    const wrap = f.groupInputs ? null : f.el.closest('label');
    const title = wrap && wrap.querySelector('[class*="label"], [class*="question"], [class*="title"]');
    if (title && clean(title.textContent)) raw = clean(title.textContent);
    // Upload widgets are often labelled by their button ("Attach"); the question sits above it.
    if (f.kind === 'file' && /^(attach|upload|browse|choose( a)? file|select( a)? file)$/i.test(raw)) {
      const parent = f.el.parentElement;
      raw = clean(nearbyText(parent && parent.parentElement ? parent.parentElement : f.el)) || raw;
    }
    raw = raw.replace(/\s*[*✱]+\s*$/, '').replace(/\s*\(required\)\s*$/i, '');
    return raw || clean(f.el.getAttribute('placeholder') || f.el.getAttribute('aria-label') || f.el.name) || '(unlabeled field)';
  }

  function optionTexts(f) {
    if (f.kind === 'select') {
      return [...f.el.options].map((o) => clean(o.textContent)).filter((t) => t && !isPlaceholderOption(t));
    }
    if (f.groupInputs) return f.groupInputs.map(optionLabel).filter(Boolean);
    return [];
  }

  function categoryOf(f) {
    const C = FM.categories;
    if (f.match && f.match.section) return C.bySection[f.match.section] || 'custom';
    if (f.match && f.match.key && C.byKey[f.match.key]) return C.byKey[f.match.key];
    const text = f.desc.labelRaw || f.el.getAttribute('placeholder') || f.el.name || '';
    for (const [cat, re] of C.labelPatterns) if (re.test(text)) return cat;
    return 'custom';
  }

  // What the field currently holds, as display text.
  function currentValueText(f) {
    const el = f.el;
    switch (f.kind) {
      case 'radio':
      case 'checkboxGroup':
        return f.groupInputs.filter((i) => i.checked).map(optionLabel).join(', ');
      case 'checkbox':
        return el.checked ? 'Checked' : '';
      case 'file':
        return el.files && el.files[0] ? el.files[0].name : '';
      case 'select': {
        const opt = el.options[el.selectedIndex];
        return opt && !isPlaceholderOption(clean(opt.textContent)) ? clean(opt.textContent) : '';
      }
      case 'combobox': {
        const c = comboContainer(el);
        const chosen = c && c.querySelector('[class*="single-value"], [class*="multi-value"]');
        return chosen ? clean(chosen.textContent) : clean(el.value);
      }
      default:
        return clean(el.value);
    }
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
      f.id = idFor(f.el);
      f.label = displayLabel(f);
      f.options = optionTexts(f);
      f.category = categoryOf(f);

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

  function parseDegree(text) {
    const lvl = FM.degrees.levels.find((l) => l.patterns.some((re) => re.test(text)));
    const fld = FM.degrees.fields.find((f) => f.patterns.some((re) => re.test(text)));
    return { level: lvl ? lvl.level : null, search: lvl ? lvl.search : null, field: fld ? fld.field : null };
  }

  // { i, strong } for the option whose degree level (and ideally field) matches; i is -1 if none.
  // A same-level option with a different field (B.A. for a B.S.) is a weak pick.
  function pickDegree(cands, value) {
    const want = parseDegree(value);
    if (!want.level) return { i: -1, strong: false };
    let best = null;
    for (const o of cands) {
      const got = parseDegree(o.text);
      if (got.level !== want.level) continue;
      const score = !want.field || !got.field ? 2 : want.field === got.field ? 3 : 1;
      if (!best || score > best.score) best = { i: o.i, score };
    }
    return best ? { i: best.i, strong: best.score >= 2 } : { i: -1, strong: false };
  }

  // options: [{ text, value }]. Returns the index of the best option, or -1.
  // { index, strong }. Strong picks are exact, alias, prefix or degree-level matches;
  // weak ones (substring or word-overlap guesses) become suggestions instead of fills.
  function pickOptionDetailed(options, value, hint) {
    const cands = options
      .map((o, i) => ({ i, text: clean(o.text), nt: norm(o.text), nv: norm(o.value) }))
      .filter((o) => o.text && !isPlaceholderOption(o.text));
    const target = norm(value);
    const tests = []; // [predicate, strong]

    if (hint.bool) tests.push([(o) => classifyBool(o.text) === hint.bool, true]);
    if (hint.month) {
      const forms = monthForms(hint.month);
      tests.push([(o) => forms.has(o.nt) || forms.has(o.nv), true]);
    }
    if (hint.key === 'state') {
      const forms = stateForms(value);
      tests.push([(o) => forms.has(o.nt) || forms.has(o.nv), true]);
    }
    for (const re of FM.valueAliases[value] || []) tests.push([(o) => re.test(o.text), true]);
    tests.push([(o) => o.nt === target || o.nv === target, true]);
    if (hint.key === 'degree') {
      const d = pickDegree(cands, value);
      tests.push([(o) => o.i === d.i, d.strong]);
    }
    tests.push([(o) => target.length >= 2 && o.nt.startsWith(target), true]);
    tests.push([(o) => o.nt.length >= 3 && target.startsWith(o.nt), true]);
    tests.push([(o) => target.length >= 3 && o.nt.includes(target), false]);

    for (const [test, strong] of tests) {
      const hit = cands.find(test);
      if (hit) return { index: hit.i, strong };
    }

    let best = null;
    for (const o of cands) {
      const s = similarity(o.text, value);
      if (s >= 0.5 && (!best || s > best.s)) best = { i: o.i, s };
    }
    return best ? { index: best.i, strong: false } : { index: -1, strong: false };
  }

  // "Sacramento, CA" -> "sacramento california", for matching location search results.
  function expandStates(text) {
    return norm(text)
      .split(' ')
      .map((t) => (t.length === 2 && FM.US_STATES[t.toUpperCase()] ? norm(FM.US_STATES[t.toUpperCase()]) : t))
      .join(' ');
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

  // Fill functions return true (filled), false (couldn't), or { weakPick } when the only
  // matching option is a guess; that becomes a suggestion unless allowWeak is set.
  function fillSelect(el, value, allowWeak) {
    const options = [...el.options].map((o) => ({ text: o.textContent, value: o.value }));
    const pick = pickOptionDetailed(options, value.text, value.hint);
    const idx = pick.index;
    if (idx < 0) return false;
    if (!pick.strong && !allowWeak) return { weakPick: clean(options[idx].text) };
    el.selectedIndex = idx;
    fireEvents(el);
    return true;
  }

  function fillChoiceGroup(f, value, allowWeak) {
    const options = f.groupInputs.map((i) => ({ text: optionLabel(i), value: i.value }));
    const pick = pickOptionDetailed(options, value.text, value.hint);
    const idx = pick.index;
    if (idx < 0) return false;
    if (!pick.strong && !allowWeak) return { weakPick: options[idx].text };
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

  // Best search result for a typed value. Location/school searches often return
  // "Sacramento, California, United States" for "Sacramento, CA", so fall back to the
  // first result that starts with the same word.
  function pickSuggestion(items, value) {
    if (!items.length) return { index: -1, strong: false };
    const pick = pickOptionDetailed(items.map((o) => ({ text: o.textContent, value: '' })), value.text, value.hint);
    if (pick.index >= 0) return pick;
    const expanded = expandStates(value.text);
    const full = items.findIndex((o) => norm(o.textContent).startsWith(expanded));
    if (full >= 0) return { index: full, strong: true };
    const firstWord = norm(value.text).split(' ')[0];
    const loose = firstWord.length >= 4 ? items.findIndex((o) => norm(o.textContent).startsWith(firstWord)) : -1;
    return { index: loose, strong: false };
  }

  // Plain text boxes with a suggestion list next to them (Lever's "Current location").
  // These often clear the text on blur unless a suggestion was picked.
  const SUGGESTION_BOX_SELECTOR = '[class*="dropdown"], [class*="autocomplete"], [class*="suggest"], [role="listbox"]';

  function suggestionBox(el) {
    const parent = el.parentElement;
    if (!parent) return null;
    // Skip form controls and anything carrying JobScript's own highlight classes
    // ("jobscript-suggested" would otherwise match [class*="suggest"]).
    return [...parent.querySelectorAll(SUGGESTION_BOX_SELECTOR)].find(
      (n) =>
        !n.contains(el) &&
        !n.matches('input, select, textarea') &&
        !(typeof n.className === 'string' && /\bjobscript-/.test(n.className))
    ) || null;
  }

  function suggestionItems(box) {
    return [...box.querySelectorAll('[role="option"], li, [class*="result"] > *, [class*="suggestion"], [class*="item"]')].filter(
      (n) =>
        isVisible(n) &&
        !n.querySelector('input') &&
        clean(n.textContent).length > 0 &&
        clean(n.textContent).length <= 150 &&
        !/no .*(found|results)|loading|searching/i.test(n.textContent)
    );
  }

  async function fillAutocompleteText(el, value, box, allowWeak) {
    el.focus();
    setNativeValue(el, value.text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    // Widgets differ on which key event starts the search (Lever uses keydown), so send both.
    const key = value.text.slice(-1);
    el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key }));
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key }));
    const items = await waitFor(() => {
      const it = suggestionItems(box);
      return it.length ? it : null;
    }, 3000);
    const pick = items ? pickSuggestion(items, value) : { index: -1, strong: false };
    if (pick.index >= 0 && !pick.strong && !allowWeak) {
      const guess = clean(items[pick.index].textContent);
      setNativeValue(el, '');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      keyEvent(el, 'Escape', 27);
      el.blur();
      return { weakPick: guess };
    }
    if (pick.index >= 0) {
      clickOption(items[pick.index]);
      await sleep(150);
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    el.blur();
    await sleep(50);
    return clean(el.value) !== '';
  }

  function comboIsOpen(el) {
    return el.getAttribute('aria-expanded') === 'true' || comboOptions(el).length > 0;
  }

  // Open a searchable dropdown without relying on page focus. When you click "Fill this page"
  // the popup has focus, so el.focus() fires no focus event, and react-select won't open on
  // mousedown alone. Greenhouse also wraps react-select with its own "Toggle flyout" button.
  async function openCombobox(el) {
    const control = el.closest('[class*="__control"], [class*="-control"]');
    el.focus();
    el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    if (control) {
      control.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, view: window }));
      await sleep(60);
      if (comboIsOpen(el)) return;
      const toggle = control.querySelector('button') || control.querySelector('[class*="dropdown-indicator"], [class*="indicator"]');
      if (toggle) {
        for (const type of ['mousedown', 'mouseup', 'click']) {
          toggle.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, view: window }));
        }
        await sleep(60);
        if (comboIsOpen(el)) return;
      }
    }
    keyEvent(el, 'ArrowDown', 40);
  }

  async function fillCombobox(f, value, allowWeak) {
    const el = f.el;
    const choose = (opts) => pickOptionDetailed(opts.map((o) => ({ text: o.textContent, value: '' })), value.text, value.hint);

    await openCombobox(el);
    let opts = await waitFor(() => { const o = comboOptions(el); return o.length ? o : null; }, 500);
    const hadInitialOptions = !!opts;
    let pick = opts ? choose(opts) : { index: -1, strong: false };

    // Not in the initial list: type to search (handles long or remotely loaded lists).
    if (pick.index < 0) {
      // Typing "BS" would filter out "Bachelor's Degree", so search degrees by level instead.
      const degreeSearch = value.hint.key === 'degree' && parseDegree(value.text).search;
      const search = value.hint.month ? FM.MONTHS[value.hint.month - 1] : degreeSearch || value.text.slice(0, 40);
      setNativeValue(el, search);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      // A list that was already showing filters instantly; an empty one is probably loading remotely.
      opts = await waitFor(() => {
        const o = comboOptions(el);
        return o.length && choose(o).index >= 0 ? o : null;
      }, hadInitialOptions ? 600 : 2500);
      opts = opts || comboOptions(el);
      pick = pickSuggestion(opts, value);
    }

    const weak = pick.index >= 0 && !pick.strong && !allowWeak;
    if (pick.index < 0 || weak) {
      const guess = weak ? clean(opts[pick.index].textContent) : '';
      setNativeValue(el, '');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      keyEvent(el, 'Escape', 27);
      el.blur();
      return weak ? { weakPick: guess } : false;
    }

    clickOption(opts[pick.index]);
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

  async function applyMatch(f, resume, opts) {
    if (f.kind === 'file') return attachFile(f.el, resume);
    const value = resolveValue(f);
    if (!value) return false;
    return applyValue(f, value, opts);
  }

  // Put a resolved { text, hint } value into a field, whatever kind of widget it is.
  async function applyValue(f, value, opts) {
    const allowWeak = !!(opts && opts.allowWeak);
    switch (f.kind) {
      case 'select': return fillSelect(f.el, value, allowWeak);
      case 'radio':
      case 'checkboxGroup': return fillChoiceGroup(f, value, allowWeak);
      case 'checkbox': return fillCheckbox(f.el, value);
      case 'combobox': return fillCombobox(f, value, allowWeak);
      default: {
        const box = f.kind === 'text' && suggestionBox(f.el);
        return box ? fillAutocompleteText(f.el, value, box, allowWeak) : fillText(f.el, value.text);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Highlighting

  const STATUS_CLASS = { filled: FILLED_CLASS, needs: NEEDS_CLASS, suggested: SUGGESTED_CLASS };

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

  function unmark(f) {
    const target = highlightTarget(f);
    if (target) target.classList.remove(FILLED_CLASS, NEEDS_CLASS, SUGGESTED_CLASS);
  }

  function mark(f, cls) {
    const target = highlightTarget(f);
    if (target) target.classList.add(cls);
  }

  function clearHighlights() {
    document
      .querySelectorAll(`.${FILLED_CLASS}, .${NEEDS_CLASS}, .${SUGGESTED_CLASS}`)
      .forEach((n) => n.classList.remove(FILLED_CLASS, NEEDS_CLASS, SUGGESTED_CLASS));
  }

  // ---------------------------------------------------------------------------
  // Field status and the side panel

  // id -> field, for every field shown in the panel during the current fill session.
  const registry = new Map();
  let session = null;

  // status: 'filled' | 'suggested' | 'needs'. Only 'filled' by us and 'needs' on required
  // fields get an on-page highlight; pre-filled fields are left alone.
  function setStatus(f, status, detail, extra) {
    f.status = status;
    f.detail = detail || '';
    f.draft = (extra && extra.draft) || '';
    f.actions = (extra && extra.actions) || [];
    unmark(f);
    if (extra && extra.noHighlight) return;
    if (status === 'filled') mark(f, FILLED_CLASS);
    else if (status === 'suggested') mark(f, SUGGESTED_CLASS);
    else if (status === 'needs' && f.required) mark(f, NEEDS_CLASS);
  }

  function preview(text) {
    const t = clean(text);
    return t.length > 70 ? t.slice(0, 67) + '…' : t;
  }

  function focusField(id) {
    const f = registry.get(id);
    if (!f || !f.el.isConnected) return;
    const target = highlightTarget(f);
    // Smooth scrolling stalls in background tabs, so only animate when the page is visible.
    target.scrollIntoView({ block: 'center', behavior: document.visibilityState === 'visible' ? 'smooth' : 'auto' });
    const focusEl = f.groupInputs ? f.groupInputs[0] : f.el;
    try {
      focusEl.focus({ preventScroll: true });
    } catch (e) {
      /* some inputs can't take focus */
    }
    target.classList.remove(FLASH_CLASS);
    void target.offsetWidth; // restart the animation
    target.classList.add(FLASH_CLASS);
    setTimeout(() => target.classList.remove(FLASH_CLASS), 1600);
  }

  function counts() {
    const c = { filled: 0, suggested: 0, needs: 0, needsRequired: 0, alreadyFilled: 0 };
    for (const f of registry.values()) {
      if (!f.el.isConnected) continue;
      if (f.prefilled) {
        c.alreadyFilled++;
        continue;
      }
      c[f.status]++;
      if (f.status === 'needs' && f.required) c.needsRequired++;
    }
    return c;
  }

  function renderPanel() {
    if (!session) return;
    const fields = [...registry.values()]
      .filter((f) => f.el.isConnected)
      .sort((a, b) => (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    const hasSuggestions = fields.some((f) => f.status === 'suggested' && !f.draft);
    globalThis.JobScriptPanel.render({
      note: session.note,
      toolbarActions: hasSuggestions ? [{ label: 'Accept all', onClick: acceptAllSuggestions }] : [],
      onSelect: focusField,
      items: fields.map((f) => ({
        id: f.id,
        category: f.category,
        label: f.label,
        status: f.status,
        detail: f.detail,
        required: f.required,
        draft: f.draft,
        actions: f.actions,
      })),
    });
  }

  // ---------------------------------------------------------------------------
  // Entry point

  // The form-selector match holding the most fields. Lever, for example, has a dozen
  // ".application-form" sections inside one form#application-form.
  function findRoot() {
    const site = FM.sites.find((s) => s.hosts.some((re) => re.test(location.hostname)));
    let best = null;
    if (site) {
      for (const sel of site.formSelectors) {
        for (const node of document.querySelectorAll(sel)) {
          const count = node.querySelectorAll('input, select, textarea').length;
          if (count && (!best || count > best.count)) best = { node, count };
        }
      }
    }
    return { root: best ? best.node : document.body, site: site ? site.name : location.hostname };
  }

  // Elements already processed by a pass, so late-field passes only touch new fields.
  const handled = new WeakSet();

  // A value we're not sure enough about to type in: shown in the panel with Accept / Dismiss.
  // apply() fills the field and resolves true on success.
  function suggest(f, text, apply, opts) {
    const draft = opts && opts.draft ? text : '';
    const accept = async () => {
      let ok = false;
      try {
        ok = (await apply()) === true;
      } catch (err) {
        console.warn('[JobScript] could not apply suggestion', f.label, err);
      }
      if (ok) {
        globalThis.JobScriptBank.unwatch(f);
        setStatus(f, 'filled', preview(currentValueText(f)));
      } else setStatus(f, 'needs', 'Could not fill this automatically');
      renderPanel();
      return ok;
    };
    f.accept = accept;
    const source = opts && opts.source ? ' · ' + opts.source : '';
    setStatus(f, 'suggested', draft ? (opts.detail || 'Draft') : preview(text) + source, {
      draft,
      actions: [
        { label: draft ? 'Insert' : 'Accept', primary: true, onClick: accept },
        {
          label: 'Dismiss',
          onClick: () => {
            f.accept = null;
            setStatus(f, 'needs', 'Suggestion dismissed');
            watchBank(f);
            renderPanel();
          },
        },
      ],
    });
  }

  // Offer "Save to bank" when you answer a field JobScript left for you.
  function watchBank(f) {
    globalThis.JobScriptBank.watch(f, {
      getValue: () => currentValueText(f),
      anchor: () => highlightTarget(f),
      onUserValue: () => {
        setStatus(f, 'filled', 'Filled by you', { noHighlight: true });
        renderPanel();
      },
      onSaved: () => {
        setStatus(f, 'filled', 'Filled by you · saved to bank', { noHighlight: true });
        renderPanel();
      },
    });
  }

  async function acceptAllSuggestions() {
    for (const f of [...registry.values()]) {
      if (f.status === 'suggested' && !f.draft && f.accept && f.el.isConnected) await f.accept();
    }
  }

  // What a match would put in, for showing as a suggestion. For selects and radios that's the
  // option that would be chosen; '' when no option fits, so nothing is suggested.
  function previewValue(f) {
    if (f.kind === 'file') return f.match.raw ? 'Your resume' : '';
    const v = resolveValue(f);
    if (!v) return '';
    if (f.kind === 'select' || f.kind === 'radio' || f.kind === 'checkboxGroup') {
      const options = f.kind === 'select'
        ? [...f.el.options].map((o) => ({ text: o.textContent, value: o.value }))
        : f.groupInputs.map((i) => ({ text: optionLabel(i), value: i.value }));
      const pick = pickOptionDetailed(options, v.text, v.hint);
      return pick.index >= 0 ? clean(options[pick.index].text) : '';
    }
    return v.text;
  }

  // Fill one field and record its status.
  async function processField(f, resume) {
    f.prefilled = !f.empty;
    if (f.prefilled) {
      setStatus(f, 'filled', 'Already had a value', { noHighlight: true });
      return 'already';
    }
    const pct = f.match ? `${Math.round(f.match.confidence * 100)}% match` : '';
    if (f.match && f.match.tier === 'medium') {
      const text = previewValue(f);
      if (text) {
        suggest(f, text, () => applyMatch(f, resume, { allowWeak: true }), { source: pct });
        return 'suggested';
      }
    }
    let result = false;
    if (f.match && f.match.tier === 'high') {
      try {
        result = await applyMatch(f, resume);
      } catch (err) {
        console.warn('[JobScript] could not fill field', f.label, err);
      }
    }
    if (result && result.weakPick) {
      // Right field, but the only matching option is a guess.
      suggest(f, result.weakPick, () => applyMatch(f, resume, { allowWeak: true }), { source: 'closest option' });
      return 'suggested';
    }
    if (result === true) {
      setStatus(f, 'filled', preview(currentValueText(f)));
      return 'filled';
    }
    if (f.match && f.match.tier === 'low') {
      setStatus(f, 'needs', `Unsure (${pct}); answer this yourself`);
      watchBank(f);
      return 'needs';
    }
    if (f.kind === 'checkbox' && f.match && f.match.tier === 'high' && !f.match.raw) {
      // e.g. "Current role" on a past job: unchecked is the right answer.
      setStatus(f, 'filled', 'Left unchecked', { noHighlight: true });
      return 'filled';
    }
    const why = !f.match ? '' : !f.match.raw && f.kind !== 'file' ? 'Not in your profile'
      : f.options.length ? 'Your answer doesn’t match any option' : '';
    setStatus(f, 'needs', why);
    watchBank(f);
    return 'needs';
  }

  // One pass over the form: scan every field, then fill. With onlyNew, fields handled by an
  // earlier pass are skipped.
  async function runPass(root, profile, resume, onlyNew) {
    const fields = analyze(root, profile);
    let processed = 0;
    for (const f of fields) {
      const els = f.groupInputs || [f.el];
      if (onlyNew && els.every((e) => handled.has(e))) continue;
      els.forEach((e) => handled.add(e));
      registry.set(f.id, f);
      processed++;
      await processField(f, resume);
    }
    return { found: fields.length, processed };
  }

  function summary() {
    const c = counts();
    return {
      ok: true,
      site: session.site,
      filled: c.filled,
      suggested: c.suggested,
      needsAttention: c.needsRequired,
      alreadyFilled: c.alreadyFilled,
      total: c.filled + c.suggested + c.needs,
    };
  }

  // After a fill, keep watching for a short while for fields that show up late: conditional
  // questions revealed by an answer, sections that load after the page, or entries added by
  // "Add another". Only fields that weren't there before get filled. Each late pass that fills
  // something extends the window a little, so chains of conditional questions keep working.
  const LATE_FIELD_WINDOW_MS = 15000;
  const LATE_FIELD_EXTEND_MS = 5000;
  let stopWatching = null;

  function watchForLateFields(profile, resume) {
    if (stopWatching) stopWatching();
    let deadline = Date.now() + LATE_FIELD_WINDOW_MS;
    let debounce = null;
    let endTimer = null;

    const addsField = (records) =>
      records.some((r) =>
        [...r.addedNodes].some(
          (n) => n.nodeType === 1 && (n.matches('input, select, textarea') || n.querySelector('input, select, textarea'))
        )
      );

    const lateFill = async () => {
      if (Date.now() > deadline) return stop();
      if (running) {
        debounce = setTimeout(lateFill, 400);
        return;
      }
      running = true;
      try {
        const before = counts().filled;
        const s = await runPass(findRoot().root, profile, resume, true);
        if (!s.processed) return;
        if (counts().filled > before) deadline = Math.max(deadline, Date.now() + LATE_FIELD_EXTEND_MS);
        renderPanel();
      } finally {
        running = false;
      }
    };

    const observer = new MutationObserver((records) => {
      if (Date.now() > deadline) return stop();
      if (!addsField(records)) return;
      clearTimeout(debounce);
      debounce = setTimeout(lateFill, 400);
    });

    const tick = () => {
      if (Date.now() >= deadline) stop();
      else endTimer = setTimeout(tick, deadline - Date.now());
    };

    function stop() {
      observer.disconnect();
      clearTimeout(debounce);
      clearTimeout(endTimer);
      if (stopWatching === stop) stopWatching = null;
    }

    // Watch the whole body: React sometimes re-mounts the form root itself.
    observer.observe(document.body, { childList: true, subtree: true });
    endTimer = setTimeout(tick, LATE_FIELD_WINDOW_MS);
    stopWatching = stop;
  }

  // ---------------------------------------------------------------------------
  // AI fallback (off unless enabled on the options page). Questions JobScript couldn't answer
  // are sent, via background.js, to Claude; answers come back only as suggestions you accept.

  const DEFAULT_NOTE = 'Review every field before you submit. JobScript never submits.';
  // Never asked of the AI: consent, legal attestations and signatures are yours to give.
  const AI_EXCLUDE_LABEL = /consent|\bagree|acknowledg|certif|attest|signature|sign here|\bterms\b|privacy (policy|notice)|i understand|true and (accurate|correct)/i;

  function aiCandidates() {
    return [...registry.values()].filter(
      (f) =>
        f.el.isConnected &&
        f.status === 'needs' &&
        !['file', 'checkbox', 'date', 'month'].includes(f.kind) &&
        f.category !== 'eeo' &&
        f.label !== '(unlabeled field)' &&
        !FM.sensitiveLabel.test(f.label) &&
        !AI_EXCLUDE_LABEL.test(f.label)
    );
  }

  // Options of a searchable dropdown, read by opening it briefly.
  async function readComboOptions(f) {
    await openCombobox(f.el);
    const opts = await waitFor(() => {
      const o = comboOptions(f.el);
      return o.length ? o : null;
    }, 600);
    const texts = opts ? opts.map((o) => clean(o.textContent)).filter(Boolean).slice(0, 100) : [];
    keyEvent(f.el, 'Escape', 27);
    f.el.blur();
    return texts;
  }

  async function aiQuestion(f) {
    let kind = 'short';
    let options = [];
    if (f.kind === 'select' || f.kind === 'radio') {
      kind = 'choice';
      options = f.options;
    } else if (f.kind === 'checkboxGroup') {
      kind = 'multi';
      options = f.options;
    } else if (f.kind === 'combobox') {
      kind = 'choice';
      options = await readComboOptions(f);
    } else if (f.kind === 'textarea' || f.el.maxLength > 300) {
      kind = 'essay';
    }
    if ((kind === 'choice' || kind === 'multi') && !options.length) return null;
    f.aiKind = kind;
    return { id: String(f.id), question: f.label, kind, options, required: f.required };
  }

  async function prepareAiQuestions() {
    const settings = await S.getAiSettings();
    if (!settings.enabled) return null;
    const questions = [];
    for (const f of aiCandidates().slice(0, 25)) {
      const q = await aiQuestion(f);
      if (q) questions.push(q);
    }
    return questions.length ? questions : null;
  }

  function jobInfo() {
    const site = FM.sites.find((s) => s.hosts.some((re) => re.test(location.hostname)));
    let description = '';
    for (const sel of (site && site.jobDescriptionSelectors) || []) {
      const node = document.querySelector(sel);
      if (node && clean(node.innerText).length > 200) {
        description = node.innerText;
        break;
      }
    }
    if (!description) description = document.body.innerText;
    const h1 = document.querySelector('h1, h2');
    return {
      jobTitle: h1 ? clean(h1.textContent) : document.title,
      company: decodeURIComponent(location.pathname.split('/')[1] || location.hostname),
      jobDescription: description.replace(/\n{3,}/g, '\n\n').slice(0, 15000),
    };
  }

  async function askAi(questions) {
    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: 'ai-answer', request: { questions, ...jobInfo() } });
    } catch (e) {
      res = { ok: false, error: 'Could not reach JobScript’s background script.' };
    }
    if (!session) return;
    if (!res || !res.ok) {
      session.note = 'Claude: ' + ((res && res.error) || 'no answer.');
      renderPanel();
      return;
    }
    let count = 0;
    for (const a of res.answers) {
      const f = registry.get(Number(a.id));
      if (!f || f.status !== 'needs' || !f.el.isConnected) continue;
      if (a.insufficient || (!a.answer && !a.choices.length)) {
        setStatus(f, 'needs', 'Claude: not enough in your profile to answer');
        continue;
      }
      if (a.confidence === 'low') {
        setStatus(f, 'needs', 'Claude was unsure; answer this yourself');
        continue;
      }
      const source = `Claude (${a.confidence})` + (a.basis ? ': ' + a.basis : '');
      if (f.aiKind === 'essay') {
        suggest(f, a.answer, () => applyValue(f, { text: a.answer, hint: {} }, { allowWeak: true }), { draft: true, detail: 'Draft by ' + source });
      } else if (f.aiKind === 'multi') {
        suggest(
          f,
          a.choices.join(', '),
          async () => {
            let ok = true;
            for (const c of a.choices) ok = (await applyValue(f, { text: c, hint: {} }, { allowWeak: true })) === true && ok;
            return ok;
          },
          { source }
        );
      } else {
        const text = f.aiKind === 'choice' ? a.choices[0] : a.answer;
        suggest(f, text, () => applyValue(f, { text, hint: {} }, { allowWeak: true }), { source });
      }
      count++;
    }
    session.note = count
      ? `Claude suggested ${count} answer${count === 1 ? '' : 's'}. Check each one before accepting; they come only from your profile and resume.`
      : 'Claude didn’t find answers in your profile or resume.';
    renderPanel();
  }

  // Returns null when this frame has no form fields, so background.js can ignore it.
  async function fillPage() {
    if (running) return { ok: false, error: 'A fill is already running on this page.' };
    running = true;
    let aiQuestions = null;
    try {
      const [profile, resume] = await Promise.all([S.getProfile(), S.getResume()]);
      const { root, site } = findRoot();
      clearHighlights();
      registry.clear();
      globalThis.JobScriptBank.reset();
      session = { site, note: DEFAULT_NOTE };
      await ensureEntries(root, profile);

      // Start watching before the pass, so fields revealed by our own answers
      // (e.g. a follow-up question) are caught too. Late passes wait until this one finishes.
      watchForLateFields(profile, resume);

      const s = await runPass(root, profile, resume, false);
      if (!s.found) {
        if (stopWatching) stopWatching();
        session = null;
        return null;
      }
      renderPanel();
      aiQuestions = await prepareAiQuestions();
      if (aiQuestions) {
        session.note = `Asking Claude about ${aiQuestions.length} question${aiQuestions.length === 1 ? '' : 's'}…`;
        renderPanel();
      }
      return summary();
    } finally {
      running = false;
      // The API call can take a while; don't hold up the popup. Answers arrive as suggestions.
      if (aiQuestions) askAi(aiQuestions);
    }
  }

  globalThis.__jobscriptFill = fillPage;
})();
