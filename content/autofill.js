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
  // Shadow DOM. Web-component forms (SmartRecruiters' spl-* elements, LinkedIn's newer layout)
  // keep their inputs in open shadow roots, which querySelectorAll and closest() don't enter.

  // JobScript's own panel and prompt; their roots are closed, except in the test bundle.
  const OWN_HOSTS = /^JOBSCRIPT-/;

  // root.querySelectorAll(sel), also searching open shadow roots, in page order.
  function deepQueryAll(root, sel) {
    const out = [];
    const visit = (r) => {
      for (const el of r.querySelectorAll('*')) {
        if (el.matches(sel)) out.push(el);
        if (el.shadowRoot && !OWN_HOSTS.test(el.tagName)) visit(el.shadowRoot);
      }
    };
    visit(root);
    if (root.shadowRoot && !OWN_HOSTS.test(root.tagName)) visit(root.shadowRoot); // LinkedIn's #interop-outlet
    return out;
  }

  // The shadow host n sits under, or null. (Checked with instanceof: a detached <a> is its own
  // root node, and its .host is a URL part.)
  function shadowHost(n) {
    const root = n.getRootNode();
    return root instanceof ShadowRoot ? root.host : null;
  }

  // The parent element, stepping out of a shadow root to its host.
  function parentOf(n) {
    return n.parentElement || (n.parentNode instanceof ShadowRoot ? n.parentNode.host : null);
  }

  function closestDeep(el, sel) {
    for (let n = el; n; n = shadowHost(n)) {
      const hit = n.closest(sel);
      if (hit) return hit;
    }
    return null;
  }

  // getElementById in el's own tree (its shadow root, or the document), then in the trees
  // around it: SmartRecruiters' input points at a menu in its outer component.
  function byIdNear(el, id) {
    for (let root = el.getRootNode(); root; root = root instanceof ShadowRoot ? root.host.getRootNode() : null) {
      const hit = root.getElementById && root.getElementById(id);
      if (hit) return hit;
    }
    return null;
  }

  // The element whose text shows for an option: options rendered inside a component's shadow
  // root (a slot) have no text of their own, so step out to the host that has it.
  function optionWithText(o) {
    let n = o;
    while (!clean(n.textContent) && shadowHost(n)) n = shadowHost(n);
    return n;
  }

  // The element itself, or for one inside shadow roots the outermost host, which page CSS
  // (JobScript's highlights) can reach.
  function outerHost(el) {
    let n = el;
    while (shadowHost(n)) n = shadowHost(n);
    return n;
  }

  // The hosts around a node, outermost first, ending with the node itself.
  function hostPath(n) {
    const path = [n];
    for (let h = shadowHost(n); h; h = shadowHost(h)) path.unshift(h);
    return path;
  }

  // True when a comes before b on the page, including across shadow roots.
  function inPageOrder(a, b) {
    const pa = hostPath(a);
    const pb = hostPath(b);
    let i = 0;
    while (i < pa.length - 1 && i < pb.length - 1 && pa[i] === pb[i]) i++;
    if (pa[i] === pb[i]) return pa.length < pb.length; // a host comes before its shadow content
    return !!(pa[i].compareDocumentPosition(pb[i]) & Node.DOCUMENT_POSITION_FOLLOWING);
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

  // Dropdowns built from a div or button that opens a separate list of options (Material UI's
  // Select, Headless UI's Listbox). The hidden input some of them keep is skipped elsewhere.
  const LISTBOX_SELECTOR = '[role="combobox"]:not(input), [aria-haspopup="listbox"]:not(input)';

  function isListboxButton(el) {
    if (el.getAttribute('aria-disabled') === 'true') return false;
    // A wrapper around a real input (react-select) is handled through that input.
    return !el.querySelector('input:not([type="hidden"]):not([aria-hidden="true"]), select, textarea');
  }

  // Text shown in a listbox button; Material UI puts a zero-width space there when empty.
  function listboxText(el) {
    return clean((el.textContent || '').replace(/[\u200b\u200c\u200d\ufeff]/g, ''));
  }

  // Text boxes for a whole date, told apart by a placeholder such as "mm/dd/yyyy".
  const DATE_PLACEHOLDER = /^\s*(mm|dd|yyyy)\s*[-/.]\s*(mm|dd|yyyy)\s*[-/.]\s*(mm|dd|yyyy)\s*$/i;
  // Ashby's date questions: a react-datepicker box that says "Pick date...".
  const PICK_DATE = /^\s*pick (a )?date\b/i;

  // Date fields split into Month / Day / Year sections you type into (Material UI's newer date
  // pickers). Returns { month, day, year } section elements, or null if el isn't one.
  // Workday's version: one to three spinbutton inputs in a dateInputWrapper (MM/YYYY for jobs,
  // YYYY for school years), which may then hold only some of the parts.
  const DATE_WRAPPER = '[data-automation-id="dateInputWrapper"]';

  function dateSections(group) {
    const workday = group.matches(DATE_WRAPPER);
    const spins = [...group.querySelectorAll('[role="spinbutton"]')];
    if (workday ? !spins.length || spins.length > 3 : spins.length !== 3) return null;
    const parts = {};
    for (const s of spins) {
      const text = (s.getAttribute('aria-label') || '') + ' ' + (s.getAttribute('data-automation-id') || '');
      const part = /month/i.test(text) ? 'month' : /day/i.test(text) ? 'day' : /year/i.test(text) ? 'year' : null;
      if (!part || parts[part]) return null;
      parts[part] = s;
    }
    return workday && !parts.year ? null : parts;
  }

  // Workday's search prompts ("How did you hear about us?", school, field of study, skills): you
  // type, press Enter to search and pick a result, which shows as a pill while the box empties.
  const PROMPT_BOX = '[data-automation-id="multiSelectContainer"]';

  function promptPicks(el) {
    const box = el.closest(PROMPT_BOX);
    return box ? [...box.querySelectorAll('[data-automation-id="selectedItem"]')] : [];
  }

  // Native selects hidden behind a styled stand-in (iCIMS's icimsDropdown, Select2, Chosen): the
  // stand-in is what you see, the select is what the form sends. Returns the stand-in, or null.
  function selectProxy(el) {
    if (isVisible(el)) return null;
    const icims = el.id && byIdNear(el, el.id + '_icimsDropdown');
    if (icims) return icims;
    const next = el.nextElementSibling;
    return next && typeof next.className === 'string' && /\b(select2|chosen-container)\b/.test(next.className) ? next : null;
  }

  // Yes/No questions built from two toggle buttons (Ashby), often over a hidden checkbox that
  // only mirrors the buttons. Returns the [yes, no] buttons, or null if el isn't such a pair.
  function yesNoButtons(el) {
    const btns = [...el.children].filter((b) => b.tagName === 'BUTTON' && b.hasAttribute('aria-pressed'));
    if (btns.length !== 2) return null;
    const kinds = btns.map((b) => classifyBool(clean(b.textContent)));
    if (kinds[0] === 'yes' && kinds[1] === 'no') return btns;
    return kinds[0] === 'no' && kinds[1] === 'yes' ? [btns[1], btns[0]] : null;
  }

  function sectionEmpty(s) {
    if (s.tagName === 'INPUT') return !/\d/.test(s.value);
    return s.getAttribute('aria-valuetext') === 'Empty' || !/\d/.test(s.textContent);
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

  // Closest short bit of text sitting just before the element (or one of its ancestors). A
  // <label> a little further up wins over help text in between ("Country" / "City and country,
  // please" / input on Ashby).
  function nearbyText(el) {
    let node = el;
    for (let depth = 0; depth < 4 && node && node !== document.body; depth++) {
      let sib = node.previousElementSibling;
      let text = '';
      for (let i = 0; sib && i < 3; i++, sib = sib.previousElementSibling) {
        if (sib.matches('input, select, textarea') || sib.querySelector('input, select, textarea')) break;
        const t = clean(sib.textContent);
        if (!t || t.length > 500) continue;
        if (sib.tagName === 'LABEL') return t;
        text = text || t;
      }
      if (text) return text;
      node = node.parentElement;
    }
    return '';
  }

  function textOfIds(ids, root) {
    const scope = root && root.getElementById ? root : document;
    return (ids || '')
      .split(/\s+/)
      .map((id) => id && scope.getElementById(id))
      .filter(Boolean)
      .map((n) => n.textContent)
      .join(' ');
  }

  function labelText(el) {
    const parts = [];
    // Material UI's Select lists its own id here too, which would add the chosen option.
    const ids = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter((id) => id && id !== el.id);
    const labelledBy = textOfIds(ids.join(' '), el.getRootNode());
    if (clean(labelledBy)) parts.push(labelledBy);
    if (!parts.length && el.labels && el.labels.length) {
      for (const l of el.labels) parts.push(textWithoutControls(l));
    }
    if (!parts.length) {
      const wrap = el.closest('label');
      if (wrap) parts.push(textWithoutControls(wrap));
    }
    // Web components often carry the label on a host around the input (spl-phone-field).
    for (let n = shadowHost(el); n && !clean(parts.join('')); n = shadowHost(n)) {
      if (n.getAttribute('label')) parts.push(n.getAttribute('label'));
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
      // Ashby titles the fieldset with a plain label as its first child instead of a legend.
      const title = fieldset.querySelector(':scope > label:first-child');
      if (title && !title.querySelector('input') && clean(title.textContent)) return clean(title.textContent);
    }
    const group = first.closest('[role="radiogroup"], [role="group"]');
    if (group) {
      const t = textOfIds(group.getAttribute('aria-labelledby'), group.getRootNode()) || group.getAttribute('aria-label');
      if (clean(t)) return clean(t);
    }
    const t = nearbyText(commonAncestor(inputs));
    if (t) return t;
    return inputs.length === 1 ? optionLabel(first) : '';
  }

  function ancestorContext(el) {
    const bits = [];
    for (let n = parentOf(el), d = 0; n && d < 3; n = parentOf(n), d++) {
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
      nameRaw: el.getAttribute('name') || '',
      // iCIMS prefixes every name with a family ("CandProfileFields.Degree"); "fields" would
      // trip rules that exclude field-of-study questions.
      // Taleo's generated ids carry the field after dv_cs_ ("...-frm-dv_cs_experience_Employer").
      attrs: norm([el.name, el.id].filter(Boolean).join(' ').replace(/(Person|Cand|Portal)ProfileFields\./g, '').replace(/\S*dv_cs_/g, '')),
      autocomplete: ac === 'on' || ac === 'off' ? '' : ac,
      context: f.kind === 'file' ? norm(ancestorContext(el)) : '',
    };
  }

  // Inputs only robots fill (Workday's "beecatcher", Oracle's "honey-pot"). Filling one can get
  // an application silently dropped, so they're never touched, visible or not.
  const HONEYPOT = /honey.?pot|beecatcher|bot.?trap/i;

  function isHoneypot(el) {
    const own = [el.id, el.getAttribute('name'), el.getAttribute('aria-label'), el.getAttribute('data-automation-id')].join(' ');
    if (HONEYPOT.test(own)) return true;
    const box = el.parentElement;
    return !!box && HONEYPOT.test(box.id + ' ' + (typeof box.className === 'string' ? box.className : ''));
  }

  // Parts of a page JobScript must leave alone on this site (sign-in forms, a site's own
  // resume parser, chat widgets): the current site's `never` selectors in lib/fieldMap.js.
  function isOffLimits(el) {
    const site = currentSite();
    return isHoneypot(el) || !!(site && site.never && site.never.some((sel) => closestDeep(el, sel)));
  }

  // A fieldset holding only checkboxes is one question even when each box has its own name
  // (Ashby names every box after its option).
  function checkboxFieldset(el) {
    const fs = el.closest('fieldset');
    if (!fs) return null;
    const inputs = fs.querySelectorAll('input:not([type="hidden"]), select, textarea');
    return inputs.length > 1 && [...inputs].every((i) => i.type === 'checkbox') ? fs : null;
  }

  function collectFields(root) {
    const out = [];
    const groups = new Map();
    const yesNo = [...new Set(deepQueryAll(root, 'button[aria-pressed]').map((b) => b.parentElement))].filter(
      (p) => p && yesNoButtons(p) && !isOffLimits(p)
    );
    for (const el of yesNo) out.push({ el, kind: 'yesno' });
    for (const el of deepQueryAll(root, `input, select, textarea, [role="group"], ${DATE_WRAPPER}, ${LISTBOX_SELECTOR}`)) {
      if (el.disabled || isOffLimits(el)) continue;
      if (yesNo.some((p) => p.contains(el))) continue; // the hidden checkbox behind Yes/No buttons
      if (!/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) {
        if (el.getAttribute('role') === 'group' || el.matches(DATE_WRAPPER)) {
          if (dateSections(el)) out.push({ el, kind: 'datesections' });
        } else if (isListboxButton(el)) out.push({ el, kind: 'listbox' });
        continue;
      }
      if (el.closest(DATE_WRAPPER)) continue; // a section of a date, handled with its wrapper
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (el.tagName === 'INPUT' && SKIP_INPUT_TYPES.has(type)) continue;
      if (el.readOnly && type !== 'file' && !isCombobox(el)) continue;
      // react-select's hidden "requiredInput" twin of each dropdown; the dropdown itself is handled.
      if (el.getAttribute('aria-hidden') === 'true' && el.tabIndex === -1) continue;

      const box = type === 'checkbox' ? checkboxFieldset(el) : null;
      if ((type === 'radio' || type === 'checkbox') && (el.name || box)) {
        const gk = box ? box : type + ':' + el.name;
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
      else if (el.closest(PROMPT_BOX)) kind = 'prompt';
      else if (isCombobox(el)) kind = 'combobox';
      else if (DATE_PLACEHOLDER.test(el.getAttribute('placeholder') || '') || PICK_DATE.test(el.getAttribute('placeholder') || '')) kind = 'datetext';
      else kind = 'text';
      const f = { el, kind };
      if (kind === 'radio') f.groupInputs = [el];
      if (kind === 'select') f.proxy = selectProxy(el);
      out.push(f);
    }

    for (const f of out) {
      if (f.kind === 'checkbox' && f.groupInputs) {
        if (f.groupInputs.length > 1) f.kind = 'checkboxGroup';
        else delete f.groupInputs;
      }
    }

    return out.filter((f) => {
      if (['text', 'textarea', 'select', 'listbox', 'prompt', 'date', 'month', 'datetext', 'datesections'].includes(f.kind)) {
        return isReallyVisible(f.proxy || f.el);
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
    for (let n = el; n && n.nodeType === 1; n = parentOf(n)) {
      if (parseFloat(getComputedStyle(n).opacity) < 0.05) return false;
    }
    return true;
  }

  function headingAbove(el, headings) {
    let best = null;
    for (const h of headings) {
      if (inPageOrder(h, el)) best = h;
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
    // Numbered labels ("Reference 2 Phone") mark a section even without a heading.
    const label = labelText(el);
    for (const [key, sec] of entries) {
      if (sec.labelPatterns && sec.labelPatterns.some((re) => re.test(label))) return key;
    }
    for (let n = parentOf(el), d = 0; n && n !== root && d < 8; n = parentOf(n), d++) {
      // Strongest first: a component's tag (SmartRecruiters' oc-education-entry, whose
      // data-test says "experience-entry"), then id and class, then hooks like
      // data-test="add-experience" or Workday's section ids.
      const hooks = ['data-test', 'data-automation-id', 'aria-labelledby'].map((a) => n.getAttribute(a) || '').join(' ');
      const tag = n.localName.includes('-') ? n.localName : '';
      for (const s of [tag, (n.id || '') + ' ' + (typeof n.className === 'string' ? n.className : ''), hooks]) {
        for (const [key, sec] of entries) {
          if (s.trim() && sec.attrPatterns.some((re) => re.test(s))) return key;
        }
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
      case 'yesno':
        return !yesNoButtons(el).some((b) => b.getAttribute('aria-pressed') === 'true');
      case 'file':
        return (!el.files || el.files.length === 0) && !attachmentShown(el);
      case 'select': {
        const opt = el.options[el.selectedIndex];
        return !opt || !el.value || isPlaceholderOption(clean(opt.textContent));
      }
      case 'combobox': {
        const c = comboContainer(el);
        const chosen = c && c.querySelector('[class*="single-value"], [class*="multi-value"]');
        return !(chosen && clean(chosen.textContent)) && !clean(el.value);
      }
      case 'listbox': {
        const t = listboxText(el);
        return !t || isPlaceholderOption(t);
      }
      case 'datesections': {
        const parts = dateSections(el);
        return !parts || Object.values(parts).some(sectionEmpty);
      }
      case 'prompt':
        return !promptPicks(el).length;
      default:
        return !clean(el.value);
    }
  }

  // Many portals keep the file input after an upload (or after you come back to a step) and show
  // the attached file next to it instead: "Attached: resume.pdf  Remove".
  const ATTACHED_FILE = /[\w)\]-]\.(pdf|docx?|rtf|odt|txt|pages)\b/i;
  const REMOVE_FILE = /^(remove|delete|replace|change)( (file|attachment|resume|document))?$/i;

  function attachmentShown(input) {
    let box = input.parentElement;
    for (let d = 0; box && d < 3; d++) {
      const parent = box.parentElement;
      // Stay inside the upload widget: stop before reaching other questions.
      if (!parent || parent.querySelectorAll('input:not([type="hidden"]), select, textarea').length > 1) break;
      box = parent;
    }
    if (!box) return false;
    const text = clean(box.textContent);
    if (ATTACHED_FILE.test(text)) return true;
    return [...box.querySelectorAll('button, a, [role="button"]')].some(
      (b) => isVisible(b) && REMOVE_FILE.test(clean(b.textContent) || clean(b.getAttribute('aria-label')))
    );
  }

  function isRequired(f) {
    const els = f.groupInputs || [f.el];
    if (f.kind === 'datesections') els.push(...f.el.querySelectorAll('input'));
    if (els.some((e) => e.required || e.getAttribute('aria-required') === 'true')) return true;
    return FM.requiredMarkers.some((re) => re.test(f.desc.labelRaw));
  }

  function detectDatePart(d) {
    // iCIMS splits dates into <name>_Month, <name>_Date (the day) and <name>_Year.
    const icims = /_(Month|Date|Year)$/.exec(d.nameRaw);
    if (icims) return { Month: 'month', Date: 'day', Year: 'year' }[icims[1]];
    const text = [d.label, d.attrs, d.placeholder].join(' ');
    const parts = Object.entries(FM.dateParts).filter(([, re]) => re.test(text));
    return parts.length === 1 ? parts[0][0] : null;
  }

  // ---------------------------------------------------------------------------
  // Matching fields to profile values

  function isDateKind(kind) {
    return kind === 'date' || kind === 'month' || kind === 'datetext' || kind === 'datesections';
  }

  function compatible(ruleType, kind) {
    if (kind === 'file') return ruleType === 'file';
    if (ruleType === 'file') return false;
    if (kind === 'checkbox') return ruleType === 'bool';
    if (isDateKind(kind)) return ruleType === 'date';
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
      if (!a.question || !(a.answer || a.dateRule)) continue;
      const score = similarity(labelRaw, a.question);
      if (!best || score > best.score) best = { answer: savedValue(a), score };
    }
    return best && best.answer ? best : null;
  }

  // A saved answer's value today: a date rule ("2 weeks from today") becomes a date.
  function savedValue(a) {
    return a.dateRule && globalThis.JobScriptDates.isRule(a.dateRule) ? globalThis.JobScriptDates.resolve(a.dateRule) : a.answer;
  }

  // Answers saved for this site's exact fields (see S.getSiteAnswers), loaded at each fill.
  let siteFields = {};

  // Identifies a field on this site across visits: its kind, label, a name or id that doesn't
  // look generated, and which occurrence of that it is on the page (Reference 1 / 2 phone).
  function siteKeyBase(f) {
    const stable = (v) => (v && !/^(:r|_r_|mui-|react-select)|\d{3,}|[0-9a-f]{8}-/i.test(v) ? v : '');
    return [f.kind, norm(f.desc.labelRaw).slice(0, 120), stable(f.el.getAttribute('name')) || stable(f.el.id)].join('|');
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

  // Answers saved for this site's field come first. If the field showed a profile entry when it
  // was saved, your current profile value is used instead, when it has one.
  function matchField(f, profile) {
    const site = f.kind !== 'file' && siteFields[f.siteKey];
    if (site && site.profileKey) {
      const m = matchProfile(f, profile);
      if (m && m.source === site.profileKey && (m.section || m.raw)) return withConfidence(m, Math.max(m.confidence, 0.97));
    }
    if (site && savedValue(site)) {
      return withConfidence({ source: 'saved for this site', type: 'text', raw: savedValue(site) }, 0.97);
    }
    return matchProfile(f, profile);
  }

  function matchProfile(f, profile) {
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
    if (f.kind === 'yesno') return yesNoButtons(f.el).map((b) => clean(b.textContent));
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
      case 'yesno': {
        const on = yesNoButtons(el).find((b) => b.getAttribute('aria-pressed') === 'true');
        return on ? clean(on.textContent) : '';
      }
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
      case 'listbox': {
        const t = listboxText(el);
        return t && !isPlaceholderOption(t) ? t : '';
      }
      case 'datesections': {
        const parts = dateSections(el);
        if (!parts || Object.values(parts).some(sectionEmpty)) return '';
        return [parts.month, parts.day, parts.year].filter(Boolean).map((s) => clean(s.tagName === 'INPUT' ? s.value : s.textContent)).join('/');
      }
      case 'prompt':
        return promptPicks(el).map((p) => clean(p.textContent)).join(', ');
      default:
        return clean(el.value);
    }
  }

  function analyze(root, profile) {
    const headings = deepQueryAll(root, HEADING_SELECTOR).filter((h) => {
      const t = clean(h.textContent);
      return t && t.length <= 80;
    });
    const fields = collectFields(root);
    const counters = new Map();
    const keyCounts = new Map();
    for (const f of fields) {
      f.desc = describe(f);
      const base = siteKeyBase(f);
      const n = keyCounts.get(base) || 0;
      keyCounts.set(base, n + 1);
      f.siteKey = base + '|' + n;
      f.section = sectionOf(f.el, root, headings);
      // "Reference 2 Phone": once the section is known, the prefix is noise for matching.
      const sec = f.section && FM.sections[f.section];
      if (sec && sec.labelPatterns) for (const re of sec.labelPatterns) f.desc.label = clean(f.desc.label.replace(re, ' '));
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
    const candidates = deepQueryAll(root, 'button, a, [role="button"], input[type="button"]');
    for (const btn of candidates) {
      if (!isVisible(btn)) continue;
      // A button inside a component shows its host's text through a slot.
      const text = clean(optionWithText(btn).textContent || btn.value);
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
        const headings = deepQueryAll(root, HEADING_SELECTOR);
        const btn = findAddButton(root, sectionKey, headings);
        if (!btn) break;
        await clickAndWaitForChange(btn, root);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Value formatting and option picking

  // { y, m, d } from "2026-10-15", "2026-10" (d is null) or "10/15/2026".
  function parseDate(raw) {
    raw = String(raw || '').trim();
    let m = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/.exec(raw);
    if (m) return { y: m[1], m: Number(m[2]), d: m[3] ? Number(m[3]) : null };
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
    return m ? { y: m[3], m: Number(m[1]), d: Number(m[2]) } : null;
  }

  function formatWholeDate(ym, f) {
    const mm = String(ym.m).padStart(2, '0');
    const dd = String(ym.d || 1).padStart(2, '0');
    if (f.kind === 'date' || f.kind === 'datesections') return `${ym.y}-${mm}-${dd}`;
    if (f.kind === 'month') return `${ym.y}-${mm}`;
    const ph = f.desc.placeholderRaw.toLowerCase();
    if (DATE_PLACEHOLDER.test(ph)) return ph.replace(/\s+/g, '').replace('yyyy', ym.y).replace('mm', mm).replace('dd', dd);
    if (/yyyy[-/]mm/.test(ph)) return `${ym.y}-${mm}`;
    if (/mm[-/ ]dd[-/ ]yyyy/.test(ph)) return `${mm}/01/${ym.y}`;
    if (/mm[-/ ]yy\b/.test(ph)) return `${mm}/${ym.y.slice(2)}`;
    if (PICK_DATE.test(ph)) return `${mm}/${dd}/${ym.y}`; // react-datepicker's default format
    return `${mm}/${ym.y}`;
  }

  // Returns { text, hint } for the field, or null when there is nothing to fill.
  function resolveValue(f) {
    const raw = f.match.raw;
    if (!raw) return null;
    if (f.match.type === 'date' || isDateKind(f.kind)) {
      const ym = parseDate(raw);
      if (!ym) return f.kind === 'datetext' ? { text: raw, hint: {} } : null;
      if (f.kind === 'datesections') return { text: formatWholeDate(ym, f), hint: { date: ym } };
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
    // Day and month numbers: "01" is the option "1".
    if (/^\d{1,2}$/.test(target)) tests.push([(o) => /^\d{1,2}$/.test(o.nt) && Number(o.nt) === Number(target), true]);
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
    // "Month YYYY" or an example like "e.g. May 2027": write the month out.
    if (/\bmonth,? ?(and )?y(ea)?r|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* \d{4}\b/i.test(ph)) return C.formatDate(`${ym.y}-${mm}`, 'text');
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
    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
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
    // iCIMS's stand-in list: clicking its item also updates the shown text and dependent fields
    // (Country -> State), which setting the select alone doesn't.
    const list = el.id && byIdNear(el, el.id + '_dropdown-results');
    const item = list && [...list.querySelectorAll('li[title]')].find((li) => clean(li.title) === clean(options[idx].text));
    if (item) {
      item.click();
      if (el.selectedIndex === idx) return true;
    }
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

  async function fillYesNo(f, value, allowWeak) {
    const btns = yesNoButtons(f.el);
    const pick = pickOptionDetailed(btns.map((b) => ({ text: b.textContent, value: '' })), value.text, value.hint);
    if (pick.index < 0) return false;
    if (!pick.strong && !allowWeak) return { weakPick: clean(btns[pick.index].textContent) };
    if (btns[pick.index].getAttribute('aria-pressed') !== 'true') btns[pick.index].click();
    await sleep(50);
    return btns[pick.index].getAttribute('aria-pressed') === 'true';
  }

  function fillCheckbox(el, value) {
    if (value.hint.bool !== 'yes') return true; // "no" means leave it unchecked
    if (!el.checked) el.click();
    return el.checked;
  }

  function comboOptions(el) {
    const id = el.getAttribute('aria-controls') || el.getAttribute('aria-owns');
    const listbox = id && byIdNear(el, id);
    let opts = listbox ? [...listbox.querySelectorAll('[role="option"]')] : [];
    if (listbox && !opts.length) opts = [...new Set(deepQueryAll(listbox, '[role="option"]').map(optionWithText))];
    if (!opts.length) {
      const c = comboContainer(el);
      if (c) opts = [...c.querySelectorAll('[role="option"], [class*="__option"]')];
    }
    opts = opts.filter(isVisible);
    // A list that isn't linked to the input (SuccessFactors' picklists open one in a popup):
    // use it only when it's the one list open on the page.
    if (!opts.length && el.getAttribute('aria-expanded') === 'true') {
      const open = [...document.querySelectorAll('[role="listbox"]')].filter((l) => isVisible(l) && !l.contains(el));
      if (open.length === 1) opts = [...open[0].querySelectorAll('[role="option"]')].filter(isVisible);
    }
    return opts;
  }

  function keyEvent(el, key, keyCode) {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, keyCode, which: keyCode, bubbles: true }));
  }

  // click() rather than a dispatched click event: web components such as SmartRecruiters'
  // spl-select-option select themselves in their own click() method.
  function clickOption(opt) {
    for (const type of ['mouseover', 'mousedown', 'mouseup']) {
      opt.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
    opt.click();
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

  // The open option list of a listbox button: the one it points to, else the visible one
  // (Material UI renders it in a portal at the end of the page).
  function listboxOptions(el) {
    const id = el.getAttribute('aria-controls') || el.getAttribute('aria-owns');
    let list = id && byIdNear(el, id);
    // Workday's lists open in a portal as activeListContainer, with promptOption items.
    if (!list || !isVisible(list)) list = [...document.querySelectorAll('[role="listbox"], [data-automation-id="activeListContainer"]')].filter(isVisible).pop();
    if (!list) return [];
    const opts = [...list.querySelectorAll('[role="option"]')].filter(isVisible);
    return opts.length ? opts : [...list.querySelectorAll('[data-automation-id="promptOption"]')].filter(isVisible);
  }

  async function openListbox(el) {
    const found = () => { const o = listboxOptions(el); return o.length ? o : null; };
    if (el.getAttribute('aria-expanded') === 'true' && found()) return found();
    // Material UI opens on mousedown, Headless UI on click; neither needs page focus.
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, view: window }));
    let opts = await waitFor(found, 400);
    if (opts) return opts;
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, view: window }));
    el.click();
    opts = await waitFor(found, 400);
    if (opts) return opts;
    el.focus();
    keyEvent(el, 'ArrowDown', 40);
    return waitFor(found, 400);
  }

  function closeListbox(el) {
    const opts = listboxOptions(el);
    const list = opts.length ? opts[0].closest('[role="listbox"]') : null;
    keyEvent(list || el, 'Escape', 27);
  }

  async function fillListbox(f, value, allowWeak) {
    const el = f.el;
    const opts = await openListbox(el);
    const pick = opts
      ? pickOptionDetailed(opts.map((o) => ({ text: o.textContent, value: o.getAttribute('data-value') || '' })), value.text, value.hint)
      : { index: -1, strong: false };
    const weak = pick.index >= 0 && !pick.strong && !allowWeak;
    if (pick.index < 0 || weak) {
      if (opts) closeListbox(el);
      return weak ? { weakPick: clean(opts[pick.index].textContent) } : false;
    }
    clickOption(opts[pick.index]);
    await sleep(150);
    if (listboxOptions(el).length && el.getAttribute('aria-expanded') === 'true') closeListbox(el);
    el.blur();
    return !isEmpty(f);
  }

  async function readListboxOptions(f) {
    const opts = await openListbox(f.el);
    const texts = opts ? opts.map((o) => clean(o.textContent)).filter((t) => t && !isPlaceholderOption(t)).slice(0, 100) : [];
    if (opts) closeListbox(f.el);
    await sleep(100);
    f.el.blur();
    return texts;
  }

  // Type a date into Month / Day / Year sections one digit at a time, the way the picker expects;
  // setting a whole section at once is ignored. Sections are looked up again after each edit
  // because the picker re-renders them.
  async function fillDateSections(f, value) {
    const date = value.hint.date;
    if (!date) return false;
    const digits = { month: String(date.m).padStart(2, '0'), day: String(date.d || 1).padStart(2, '0'), year: date.y };
    for (const part of ['month', 'day', 'year']) {
      let s = dateSections(f.el)[part];
      if (!s) continue;
      // Workday's sections are inputs: set each whole, the way its own change handler reads it.
      if (s.tagName === 'INPUT') {
        s.focus();
        s.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
        setNativeValue(s, digits[part]);
        s.dispatchEvent(new Event('input', { bubbles: true }));
        s.dispatchEvent(new Event('change', { bubbles: true }));
        await sleep(80);
        continue;
      }
      s.focus();
      s.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      s.click();
      await sleep(120);
      for (const ch of digits[part]) {
        s = dateSections(f.el)[part];
        s.textContent = ch;
        s.dispatchEvent(new InputEvent('input', { bubbles: true, data: ch, inputType: 'insertText' }));
        await sleep(50);
      }
    }
    const last = document.activeElement;
    if (last && f.el.contains(last)) {
      last.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      last.blur();
    }
    await sleep(80);
    return !isEmpty(f);
  }

  function promptOptions() {
    return [...document.querySelectorAll('[data-automation-id="promptOption"]')].filter(isVisible);
  }

  async function fillPrompt(f, value, allowWeak) {
    const el = f.el;
    const degreeSearch = value.hint.key === 'degree' && parseDegree(value.text).search;
    el.focus();
    setNativeValue(el, degreeSearch || value.text.slice(0, 40));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    keyEvent(el, 'Enter', 13);
    const opts = await waitFor(() => { const o = promptOptions(); return o.length ? o : null; }, 3000);
    const pick = opts ? pickSuggestion(opts, value) : { index: -1, strong: false };
    const weak = pick.index >= 0 && !pick.strong && !allowWeak;
    if (pick.index < 0 || weak) {
      setNativeValue(el, '');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      keyEvent(el, 'Escape', 27);
      el.blur();
      return weak ? { weakPick: clean(opts[pick.index].textContent) } : false;
    }
    clickOption(opts[pick.index]);
    await waitFor(() => promptPicks(el).length > 0, 1500);
    keyEvent(el, 'Escape', 27);
    el.blur();
    return promptPicks(el).length > 0;
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
      case 'yesno': return fillYesNo(f, value, allowWeak);
      case 'combobox': return fillCombobox(f, value, allowWeak);
      case 'listbox': return fillListbox(f, value, allowWeak);
      case 'datesections': return fillDateSections(f, value);
      case 'prompt': return fillPrompt(f, value, allowWeak);
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
    return outerHost(highlightElement(f));
  }

  function highlightElement(f) {
    if (f.proxy) return f.proxy;
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

  // "Filled 12 of 15. Needs you: Why do you want to work here?, Referral." Field labels only,
  // never your answers, so it's safe to show (and for an agent to read) on the page.
  const SUMMARY_MAX_LABELS = 8;

  function fillSummaryText(fields) {
    if (!fields.length) return '';
    const c = counts();
    const total = c.filled + c.suggested + c.needs + c.alreadyFilled;
    let text = `Filled ${c.filled + c.alreadyFilled} of ${total}.`;
    // Optional self-identification questions are yours to skip; they aren't "needs you".
    const needs = fields.filter((f) => f.status === 'needs' && !f.prefilled && !(f.category === 'eeo' && !f.required)).map((f) => f.label);
    if (needs.length) {
      const shown = needs.slice(0, SUMMARY_MAX_LABELS).join(', ');
      const more = needs.length > SUMMARY_MAX_LABELS ? `, and ${needs.length - SUMMARY_MAX_LABELS} more` : '';
      text += ` Needs you: ${shown}${more}.`;
    }
    if (c.suggested) text += ` ${c.suggested} suggestion${c.suggested === 1 ? '' : 's'} to review.`;
    return text;
  }

  function renderPanel() {
    if (!session) return;
    const fields = [...registry.values()]
      .filter((f) => f.el.isConnected)
      .sort((a, b) => (inPageOrder(a.el, b.el) ? -1 : 1));
    const hasSuggestions = fields.some((f) => f.status === 'suggested' && !f.draft && f.accept);
    const actions = [];
    // The resume question comes first: pick before you go on (see askForJobResume).
    const rc = session.resumeChoice;
    if (rc && rc.f.el.isConnected && isEmpty(rc.f)) actions.push(...rc.actions);
    if (session.stepPending) actions.push({ label: 'Fill this step', ariaLabel: 'Fill this step of the form', primary: true, onClick: fillStep });
    else actions.push({ label: 'Fill this page', ariaLabel: 'Fill this page again', onClick: fillFromPanel });
    if (session.learning) {
      actions.push({ label: 'Finish learning', ariaLabel: 'Finish learning this site', onClick: finishLearning });
    } else {
      if (session.lastStep && session.lastStep.length) {
        actions.push({ label: `Save last step (${session.lastStep.length})`, onClick: () => openReview(session.lastStep, 'Save your answers from the last step') });
      }
      actions.push({ label: 'Save all answers', ariaLabel: 'Save all answers on this step', onClick: () => openReview(currentAnswers(), 'Save your answers on this step') });
    }
    if (hasSuggestions) actions.push({ label: 'Accept all', ariaLabel: 'Accept all suggestions', primary: true, onClick: acceptAllSuggestions });
    globalThis.JobScriptPanel.render({
      summaryText: fillSummaryText(fields),
      warning: conflictWarning(),
      details: companyDetails(),
      note: session.note,
      footerActions: footerActions(),
      review: session.review,
      toolbarActions: actions,
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
  // The panel's own buttons for everything the popup does, so you (or a browser agent, which
  // can click the page but not the popup) never need the toolbar icon.

  let idleNote = ''; // shown in the panel before any fill, e.g. why a fill didn't work

  function footerActions() {
    return [
      { label: 'Job description', ariaLabel: 'Open the job description and upload a resume made for this job', onClick: () => openJobPage('job') },
      { label: 'Tailor & Fill', ariaLabel: 'Tailor your resume to this job with Claude, then fill', onClick: () => openJobPage('tailor') },
      { label: 'Write cover letter', ariaLabel: 'Write a cover letter for this job', onClick: () => openPage('letter-open', 'the cover letter page') },
      { label: 'Company profile', ariaLabel: 'Open the company profile for this job', onClick: () => openPage('company-open', 'the company profile') },
      { label: 'Open tracker', ariaLabel: 'Open the applications tracker', onClick: openTracker },
    ];
  }

  async function openPage(type, what) {
    const res = await ask({ type });
    if (!res || !res.ok) showPanelMessage(`Couldn’t open ${what}: ` + ((res && res.error) || 'no answer from JobScript.'));
  }

  // The company's saved profile, shortened for the panel; edited on the company page.
  let companyProfile = null;

  function companyDetails() {
    const c = companyProfile;
    if (!c) return null;
    const lines = [];
    if (c.mission[0]) lines.push('Mission: ' + c.mission[0].text);
    if (c.values.length) lines.push('Values: ' + c.values.slice(0, 4).map((v) => v.text).join(' · '));
    if (c.news[0]) lines.push('News: ' + c.news[0].text);
    if (c.updatedAt) lines.push(`Updated ${new Date(c.updatedAt).toLocaleDateString()}. Edit it under “Company profile”.`);
    return lines.length ? { title: c.name || 'Company', lines } : null;
  }

  async function loadCompanyProfile(name) {
    companyProfile = name ? await S.getCompany(name).catch(() => null) : null;
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !session || !session.company) return;
    const key = 'company:' + S.companyKey(session.company);
    if (!changes[key]) return;
    companyProfile = changes[key].newValue ? S.cleanCompany(changes[key].newValue) : null;
    renderPanel();
  });

  // Other job-autofill extensions put their own panels on application pages, and may change the
  // fields JobScript fills (or fill them first). Their UI is found by its tag, id or class at the
  // top of the page; nothing is read from it.
  const OTHER_AUTOFILL = [
    ['Jobright', /jobright/i],
    ['Simplify', /simplify[-_]?(jobs|copilot|autofill|root|extension)|\bsimplify\b/i],
    ['Teal', /\bteal[-_]?(hq|extension|root|autofill)|tealhq/i],
    ['Huntr', /\bhuntr/i],
    ['LazyApply', /lazy[-_]?apply/i],
    ['Careerflow', /careerflow/i],
    ['JobCopilot', /job[-_]?copilot/i],
    ['an autofill extension', /\b(auto[-_]?apply|autofill[-_](extension|root|panel|widget))\b/i],
  ];

  function otherAutofill() {
    const nodes = [];
    for (const root of [document.documentElement, document.body]) if (root) nodes.push(...root.children);
    nodes.push(...document.querySelectorAll('body > div > iframe, body > iframe'));
    for (const n of nodes) {
      if (/^JOBSCRIPT-/.test(n.tagName)) continue;
      const sig = [n.tagName, n.id, typeof n.className === 'string' ? n.className : '', n.getAttribute('name') || '', n.getAttribute('title') || ''].join(' ');
      const hit = OTHER_AUTOFILL.find(([, re]) => re.test(sig));
      if (hit) return hit[0];
    }
    return '';
  }

  function conflictWarning() {
    const name = otherAutofill();
    return name ? `Another autofill extension is active${/^an /.test(name) ? '' : ` (${name})`} and may change fields JobScript fills.` : '';
  }

  // The panel before JobScript has filled anything on this page.
  function renderIdle() {
    globalThis.JobScriptPanel.render({
      note: idleNote || 'Nothing filled on this page yet. ' + siteWarning() + DEFAULT_NOTE,
      summaryText: '',
      warning: conflictWarning(),
      details: companyDetails(),
      emptyText: 'Press “Fill this page” to fill this form from your profile.',
      toolbarActions: [{ label: 'Fill this page', ariaLabel: 'Fill this page', primary: true, onClick: fillFromPanel }],
      footerActions: footerActions(),
      onSelect: () => {},
      items: [],
    });
  }

  async function openPanel() {
    globalThis.JobScriptPanel.open();
    if (session) return renderPanel();
    renderIdle();
    // Before a fill, show the company's saved profile too, once it's loaded.
    await loadCompanyProfile(titleAndCompany().company);
    if (!session && companyProfile) renderIdle();
  }

  function showPanelMessage(text) {
    if (session) {
      session.note = text + ' ' + session.note;
      renderPanel();
    } else {
      idleNote = text;
      renderIdle();
    }
  }

  // After JobScript is updated or reloaded, scripts already on open pages lose their link to it.
  async function ask(message) {
    try {
      return await chrome.runtime.sendMessage(message);
    } catch (e) {
      return {
        ok: false,
        error: /context invalidated/i.test(String(e && e.message))
          ? 'JobScript was updated since this page loaded. Refresh the page and try again.'
          : String(e && e.message),
      };
    }
  }

  // Same as the popup's "Fill this page": background.js runs the fill in every frame and logs it
  // in the tracker. The fill redraws the panel itself.
  async function fillFromPanel() {
    if (running) return;
    const res = await ask({ type: 'fill-self' });
    if (!res || !res.ok) showPanelMessage('Nothing filled: ' + ((res && res.error) || 'no answer from JobScript.'));
  }

  async function openTracker() {
    const res = await ask({ type: 'open-tracker' });
    if (!res || !res.ok) showPanelMessage('Couldn’t open the tracker: ' + ((res && res.error) || 'no answer from JobScript.'));
  }

  // ---------------------------------------------------------------------------
  // Entry point

  // The form-selector match holding the most fields. Lever, for example, has a dozen
  // ".application-form" sections inside one form#application-form.
  function findRoot() {
    const site = FM.sites.find((s) => s.hosts.some((re) => re.test(location.hostname)));
    let best = null;
    if (site) {
      for (const sel of site.formSelectors || []) {
        for (const node of document.querySelectorAll(sel)) {
          const count = deepQueryAll(node, 'input, select, textarea').length;
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

  // ---------------------------------------------------------------------------
  // Saving your answers: globally by question wording (matched loosely on other sites) and for
  // this site by field (matched exactly here).

  // The value to store for what a field shows: dates as YYYY-MM-DD, checkboxes as yes/no.
  function answerToSave(f, text) {
    if (isDateKind(f.kind)) {
      const p = parseDate(text);
      if (!p) return text;
      return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d || 1).padStart(2, '0')}`;
    }
    if (f.kind === 'checkbox') return text ? 'yes' : 'no';
    return text;
  }

  // Ways to save a date answer: the date itself, or a rule that moves with the calendar.
  // The rule that gives this same date today is preselected.
  function dateChoices(f, text) {
    if (!isDateKind(f.kind)) return null;
    const date = answerToSave(f, text);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const D = globalThis.JobScriptDates;
    const rules = [...D.PRESETS];
    const today = D.resolve('today');
    const days = Math.round((new Date(date + 'T12:00') - new Date(today + 'T12:00')) / 86400000);
    if (days > 0 && days <= 365 && !rules.some((r) => D.resolve(r) === date)) rules.push(D.daysFromToday(days));
    const choices = [{ rule: '', label: `Always ${date}` }];
    for (const r of rules) choices.push({ rule: r, label: `${D.describe(r)} (${D.resolve(r)})` });
    const match = rules.find((r) => D.resolve(r) === date);
    return { choices, selected: match || '' };
  }

  // items: [{ f, value, dateRule }], value being what the field showed.
  async function saveAnswers(items) {
    const D = globalThis.JobScriptDates;
    const rows = items.map(({ f, value, dateRule }) => {
      const answer = answerToSave(f, value);
      return { f, answer: dateRule ? D.describe(dateRule) : answer, dateRule: dateRule || '' };
    });
    const profileKey = (f) => (f.match && f.match.c ? f.match.source : '');
    // Fields that match a profile entry (name, email, …) are covered by the profile already.
    const global = rows.filter((r) => !(r.f.match && r.f.match.c));
    if (global.length) await S.saveCustomAnswers(global.map((r) => ({ question: r.f.label, answer: r.answer, dateRule: r.dateRule })));
    await S.saveSiteAnswers(
      location.origin,
      rows.map((r) => ({ key: r.f.siteKey, label: r.f.label, kind: r.f.kind, answer: r.answer, dateRule: r.dateRule, profileKey: profileKey(r.f) }))
    );
    for (const r of rows) siteFields[r.f.siteKey] = { answer: r.answer, dateRule: r.dateRule, profileKey: profileKey(r.f) };
  }

  // Fields whose answers may be saved: not uploads, checkboxes (consent is yours to give each
  // time), demographic or reference questions, or anything sensitive.
  function saveable(f) {
    return (
      f.kind !== 'file' &&
      f.kind !== 'checkbox' &&
      f.category !== 'eeo' &&
      f.category !== 'references' &&
      f.label &&
      f.label !== '(unlabeled field)' &&
      !FM.sensitiveLabel.test(f.label) &&
      !AI_EXCLUDE_LABEL.test(f.label)
    );
  }

  // [{ f, value }] for the answered, saveable fields among these.
  function answersOf(fields) {
    return fields
      .filter(saveable)
      .map((f) => ({ f, value: currentValueText(f) }))
      .filter((a) => a.value);
  }

  function currentAnswers() {
    return answersOf(analyze(findRoot().root, session.profile));
  }

  function alreadySaved(f, value) {
    const saved = siteFields[f.siteKey];
    return !!saved && norm(answerToSave(f, savedValue(saved))) === norm(answerToSave(f, value));
  }

  // With auto-save on: the answers not saved yet, dates with the rule that gives the same date
  // today (or the date itself).
  function autoSaveItems(answers) {
    return answers
      .filter((a) => !alreadySaved(a.f, a.value))
      .map((a) => {
        const dc = dateChoices(a.f, a.value);
        return Object.assign({}, a, { dateRule: dc ? dc.selected : '' });
      });
  }

  // Show the answers in the panel with a checkbox each; answers already saved for this site
  // start unticked.
  function openReview(answers, title) {
    session.review = {
      title,
      rows: answers.map((a, i) => {
        const saved = alreadySaved(a.f, a.value);
        return { id: i, label: a.f.label, value: preview(a.value), checked: !saved, note: saved ? 'already saved' : '', dateChoices: dateChoices(a.f, a.value) };
      }),
      onCancel: () => {
        session.review = null;
        renderPanel();
      },
      onSave: async (picked) => {
        await saveAnswers(picked.map((p) => Object.assign({}, answers[p.id], { dateRule: p.dateRule })));
        if (answers === session.lastStep) session.lastStep = null;
        session.review = null;
        session.note = picked.length
          ? `Saved ${picked.length} answer${picked.length === 1 ? '' : 's'} for this site and to your bank.`
          : 'Nothing saved.';
        renderPanel();
      },
    };
    renderPanel();
  }

  // Offer "Save to bank" when you answer a field JobScript left for you.
  function watchBank(f) {
    globalThis.JobScriptBank.watch(f, {
      getValue: () => currentValueText(f),
      anchor: () => highlightTarget(f),
      save: (value, dateRule) => saveAnswers([{ f, value, dateRule }]),
      dateChoices: (value) => dateChoices(f, value),
      onUserValue: (value) => {
        if (session && session.learning) {
          setStatus(f, 'filled', 'Filled by you · learned', { noHighlight: true });
          renderPanel();
          return true;
        }
        if (session && session.autoSave) {
          saveAnswers(autoSaveItems([{ f, value }])).then(() => {
            setStatus(f, 'filled', 'Filled by you · saved', { noHighlight: true });
            renderPanel();
          });
          return true;
        }
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
    if (f.kind === 'select' || f.kind === 'radio' || f.kind === 'checkboxGroup' || f.kind === 'yesno') {
      const options = f.kind === 'select'
        ? [...f.el.options].map((o) => ({ text: o.textContent, value: o.value }))
        : f.kind === 'yesno' ? f.options.map((t) => ({ text: t, value: '' }))
        : f.groupInputs.map((i) => ({ text: optionLabel(i), value: i.value }));
      const pick = pickOptionDetailed(options, v.text, v.hint);
      return pick.index >= 0 ? clean(options[pick.index].text) : '';
    }
    return v.text;
  }

  // An empty resume field: offer to make a resume for this job (the job page shows the
  // description to tailor from and attaches what you upload there; Tailor & Fill does it with
  // Claude), or to send the master resume after all.
  function askForJobResume(f, resume) {
    const actions = [{ label: 'Make a resume for this job', primary: true, onClick: () => openJobPage('job') }];
    if (session.aiEnabled) actions.push({ label: 'Tailor with Claude', onClick: () => openJobPage('tailor') });
    actions.push({
      label: 'Use master resume',
      onClick: () => {
        const ok = attachFile(f.el, resume);
        setStatus(f, ok ? 'filled' : 'needs', ok ? preview(currentValueText(f)) : 'Could not attach your resume');
        session.note = session.note.replace(RESUME_ASK, '');
        renderPanel();
      },
    });
    f.accept = null;
    session.resumeChoice = { f, actions };
    setStatus(f, 'suggested', 'Attach a resume made for this job', { actions });
    if (!session.note.includes(RESUME_ASK)) session.note = RESUME_ASK + session.note;
  }

  const RESUME_ASK = 'This application asks for a resume. Make one for this job from its description (the copy button is on the next page), or use your master resume. ';

  // Opens the job description page ('job') or Tailor & Fill ('tailor') for this tab, and says why
  // in the panel if it can't.
  async function openJobPage(page) {
    const res = await ask({ type: page === 'tailor' ? 'tailor-start' : 'job-start' });
    if (res && res.ok) return;
    const what = page === 'tailor' ? 'Tailor & Fill' : 'the job description';
    showPanelMessage(`Couldn’t open ${what}: ` + ((res && res.error) || 'no answer from JobScript.'));
  }

  // Fill one field and record its status.
  async function processField(f, resume) {
    // Tailor & Fill replaces whatever resume is attached with the tailored one.
    if (session.forceResume && f.kind === 'file' && f.match && f.match.key === 'resume') f.empty = true;
    f.prefilled = !f.empty;
    if (f.prefilled) {
      setStatus(f, 'filled', f.kind === 'file' ? 'A file is already attached' : 'Already had a value', { noHighlight: true });
      return 'already';
    }
    // Your master resume fills in your details; the resume you send is one made for this job.
    if (f.kind === 'file' && f.match && f.match.key === 'resume' && !session.tailoredId) {
      askForJobResume(f, resume);
      return 'suggested';
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
  // skip: elements already processed in this fill (the resume attached first).
  async function runPass(root, profile, resume, onlyNew, skip) {
    const fields = analyze(root, profile);
    let processed = 0;
    for (const f of fields) {
      const els = f.groupInputs || [f.el];
      if (skip && els.some((e) => skip.has(e))) continue;
      if (onlyNew && els.every((e) => handled.has(e))) continue;
      els.forEach((e) => handled.add(e));
      registry.set(f.id, f);
      processed++;
      await processField(f, resume);
    }
    return { found: fields.length, processed };
  }

  // Resolves once el's subtree has had no changes for quietMs, or after maxMs.
  function waitForQuiet(el, quietMs, maxMs) {
    return new Promise((resolve) => {
      let timer = null;
      const done = () => {
        observer.disconnect();
        clearTimeout(timer);
        clearTimeout(cap);
        resolve();
      };
      const observer = new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(done, quietMs);
      });
      observer.observe(el, { childList: true, subtree: true, attributes: true, characterData: true });
      timer = setTimeout(done, quietMs);
      const cap = setTimeout(done, maxMs);
    });
  }

  // Attach the resume before filling anything else: Lever, Ashby, iCIMS and Workday parse an
  // uploaded resume and refill or redraw the form, which would overwrite answers typed before it.
  // Returns { handled: the elements it processed, attached: whether it attached a file }.
  async function attachResumeFirst(root, profile, resume) {
    const f = analyze(root, profile).find((x) => x.kind === 'file' && x.match && x.match.key === 'resume' && x.match.tier === 'high');
    if (!f) return { handled: new Set(), attached: false };
    handled.add(f.el);
    registry.set(f.id, f);
    const attached = (await processField(f, resume)) === 'filled';
    // A site that reloads the page to read the resume (iCIMS) is gone by now anyway.
    if (attached && !(currentSite() && currentSite().resumeReloads)) await waitForQuiet(document.body, 700, 6000);
    return { handled: new Set([f.el]), attached };
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
      // For the application tracker.
      url: location.href,
      jobTitle: session.jobTitle,
      company: session.company,
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

    // Custom elements count too: their inputs may sit in a shadow root (SmartRecruiters).
    const addsField = (records) =>
      records.some((r) =>
        [...r.addedNodes].some(
          (n) =>
            n.nodeType === 1 &&
            (n.matches('input, select, textarea') || n.querySelector('input, select, textarea') ||
              (n.tagName.includes('-') && !OWN_HOSTS.test(n.tagName)))
        )
      );

    const lateFill = async () => {
      if (Date.now() > deadline) return stop();
      if (running) {
        debounce = setTimeout(lateFill, 400);
        return;
      }
      // A new step of a multi-step form waits for you to press "Fill this step".
      if (checkStepChange()) return stop();
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
  // Multi-step forms. Portals like Sac State's UEI swap in the next step when you press
  // Continue, often without loading a new page. JobScript never presses Continue; it notices
  // the new step and offers "Fill this step" in the panel.

  let stepFields = []; // the fields of the step last filled or detected
  let stepUrl = '';
  let stepWatcher = null;

  function rememberStep() {
    stepFields = analyze(findRoot().root, session.profile);
    stepUrl = location.href;
    session.stepTitle = stepTitleNow();
    if (session.learning) recordStep();
    session.stepIndex = learnedStepIndex(stepFields);
  }

  // The step's heading, e.g. "Documents"; '' if there's none.
  function stepTitleNow() {
    const h = [...findRoot().root.querySelectorAll('h1, h2, h3, h4, legend, [role="heading"]')].find(
      (n) => isVisible(n) && clean(n.textContent) && clean(n.textContent).length <= 80
    );
    return h ? clean(h.textContent) : '';
  }

  // True (once per step) when the form now shows a different step: the address changed or most
  // of the step's fields are gone, and new fields have appeared.
  function checkStepChange() {
    if (!session || session.stepPending === undefined) return false;
    const gone = stepFields.filter((f) => !f.el.isConnected).length;
    const urlChanged = location.href !== stepUrl;
    if (!urlChanged && !(stepFields.length && gone / stepFields.length >= 0.5)) return false;
    const els = stepFields.map((f) => f.el);
    const fresh = collectFields(findRoot().root).filter((f) => !els.includes(f.el));
    if (!fresh.length) return false;
    // The step that just left the page still holds what you entered; keep it for saving.
    const previous = answersOf(stepFields.filter((f) => !f.el.isConnected));
    if (session.learning) learnAnswers(previous);
    rememberStep();
    onStepChange(stepFields.length, session.learning ? [] : previous);
    return true;
  }

  function onStepChange(count, previous) {
    session.lastStep = previous;
    session.review = null;
    if (session.autoSave && previous.length) {
      const items = autoSaveItems(previous);
      session.lastStep = null;
      if (items.length) {
        saveAnswers(items).then(() => {
          session.note = `Saved ${items.length} answer${items.length === 1 ? '' : 's'} from the last step. ` + session.note;
          renderPanel();
        });
      }
    }
    if (stopWatching) stopWatching();
    for (const [id, f] of registry) {
      if (!f.el.isConnected) {
        globalThis.JobScriptBank.unwatch(f);
        registry.delete(id);
      }
    }
    session.stepPending = true;
    session.note = stepNote(count);
    renderPanel();
  }

  function stepNote(count) {
    const title = session.stepTitle ? ` (${session.stepTitle})` : '';
    if (session.learning) {
      return `Learning this site: step ${session.steps.length}${title}. Answer it, then press Continue; JobScript saves what you enter. ` +
        'Press “Finish learning” after the last step.';
    }
    if (session.stepIndex >= 0) {
      return `Step ${session.stepIndex + 1} of ${session.steps.length} you taught JobScript${title}. ` +
        'Press “Fill this step” to fill it the way you did. ' + siteWarning() + DEFAULT_NOTE;
    }
    return `New step: ${count} field${count === 1 ? '' : 's'}. Press “Fill this step” when you’re ready. ` + siteWarning() + DEFAULT_NOTE;
  }

  // ---------------------------------------------------------------------------
  // Learn mode: you fill a site's form once, step by step, and JobScript records each step and
  // your answers for that site (see S.setSiteLearning). Later, each step fills the same way.

  function sameKeys(a, b) {
    return a.length === b.length && a.every((k) => b.includes(k));
  }

  function recordStep() {
    const keys = stepFields.filter(saveable).map((f) => f.siteKey);
    if (!keys.length || session.steps.some((st) => sameKeys(st.keys, keys))) return;
    const step = { title: session.stepTitle, keys };
    session.steps.push(step);
    S.addSiteStep(location.origin, step);
  }

  // Which learned step these fields belong to: the one sharing most of its fields; -1 if none.
  function learnedStepIndex(fields) {
    const keys = new Set(fields.map((f) => f.siteKey));
    let best = -1;
    let bestShare = 0.5;
    (session.steps || []).forEach((st, i) => {
      const share = st.keys.filter((k) => keys.has(k)).length / st.keys.length;
      if (share >= bestShare) {
        best = i;
        bestShare = share;
      }
    });
    return best;
  }

  // Save every answer, replacing what was saved before; dates get the rule that gives the same
  // date today, or the date itself.
  function learnAnswers(answers) {
    const items = answers.map((a) => {
      const dc = dateChoices(a.f, a.value);
      return Object.assign({}, a, { dateRule: dc ? dc.selected : '' });
    });
    return items.length ? saveAnswers(items) : Promise.resolve();
  }

  // While learning, save each answer as you give it, so nothing is lost if the next step
  // loads a new page.
  let stopLearnWatch = null;

  function watchAnswersWhileLearning() {
    if (stopLearnWatch) return;
    let timer = null;
    const pending = new Set();
    const flush = () => {
      const fields = [...pending];
      pending.clear();
      learnAnswers(answersOf(fields.filter((f) => f.el.isConnected)));
    };
    const onEvent = (e) => {
      if (!e.isTrusted || !session || !session.learning) return;
      const t = e.target;
      const f = stepFields.find((x) => (x.groupInputs || [x.el]).some((el) => el === t || (el.contains && el.contains(t))));
      if (!f) return;
      pending.add(f);
      clearTimeout(timer);
      timer = setTimeout(flush, 300);
    };
    const onLeave = () => {
      if (session && session.learning) learnAnswers(answersOf(stepFields.filter((f) => f.el.isConnected)));
    };
    for (const type of ['change', 'focusout']) document.addEventListener(type, onEvent, true);
    window.addEventListener('pagehide', onLeave);
    stopLearnWatch = () => {
      for (const type of ['change', 'focusout']) document.removeEventListener(type, onEvent, true);
      window.removeEventListener('pagehide', onLeave);
      clearTimeout(timer);
      stopLearnWatch = null;
    };
  }

  async function finishLearning() {
    if (!session || !session.learning) return;
    await learnAnswers(answersOf(stepFields.filter((f) => f.el.isConnected)));
    await S.setSiteLearning(location.origin, false);
    session.learning = false;
    if (stopLearnWatch) stopLearnWatch();
    const n = session.steps.length;
    session.note = `Learned ${n} step${n === 1 ? '' : 's'} on this site. Next time, press “Fill this step” on each one to fill it the way you did.`;
    renderPanel();
  }

  function watchSteps() {
    if (stepWatcher) return;
    let timer = null;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!running) checkStepChange();
      }, 500);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    // pushState doesn't fire an event, so also look at the address now and then.
    const poll = setInterval(() => {
      if (location.href !== stepUrl) schedule();
    }, 700);
    stepWatcher = () => {
      observer.disconnect();
      clearInterval(poll);
      clearTimeout(timer);
      stepWatcher = null;
    };
  }

  function fillStep() {
    if (!session || running) return;
    fillPage({ tailoredId: session.tailoredId || '', step: true });
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
        f.kind !== 'file' && f.kind !== 'checkbox' && !isDateKind(f.kind) &&
        f.category !== 'eeo' &&
        f.category !== 'references' &&
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
    if (f.kind === 'select' || f.kind === 'radio' || f.kind === 'yesno') {
      kind = 'choice';
      options = f.options;
    } else if (f.kind === 'checkboxGroup') {
      kind = 'multi';
      options = f.options;
    } else if (f.kind === 'combobox') {
      kind = 'choice';
      options = await readComboOptions(f);
    } else if (f.kind === 'listbox') {
      kind = 'choice';
      options = await readListboxOptions(f);
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

  // A site's `warning` (LinkedIn's terms), shown at the top of the panel.
  function siteWarning() {
    const site = currentSite();
    return site && site.warning ? site.warning + ' ' : '';
  }

  function currentSite() {
    return FM.sites.find((s) => s.hosts.some((re) => re.test(location.hostname))) || null;
  }

  // schema.org JobPosting data that many job sites embed (Ashby, Workday, iCIMS):
  // { title, company, description } or null.
  function jsonLdPosting(doc) {
    for (const node of doc.querySelectorAll('script[type="application/ld+json"]')) {
      let data;
      try {
        data = JSON.parse(node.textContent);
      } catch (e) {
        continue;
      }
      const posting = [].concat(data, (data && data['@graph']) || []).find((d) => d && d['@type'] === 'JobPosting');
      if (!posting) continue;
      const org = posting.hiringOrganization;
      const html = String(posting.description || '').replace(/<br\s*\/?>|<\/(p|li|h\d|div)>/gi, '$&\n');
      return {
        title: clean(posting.title),
        company: clean(org && typeof org === 'object' ? org.name : org),
        description: new DOMParser().parseFromString(html, 'text/html').body.textContent || '',
      };
    }
    return null;
  }

  function descriptionFrom(doc) {
    const site = currentSite();
    for (const sel of (site && site.jobDescriptionSelectors) || []) {
      // The longest matching block, so a header that shares the class doesn't win.
      let best = '';
      for (const node of doc.querySelectorAll(sel)) {
        if (node.querySelector('input, select, textarea')) continue; // the application form, not the posting
        const text = node.innerText || node.textContent || '';
        if (clean(text).length > clean(best).length) best = text;
      }
      if (clean(best).length > 200) return best;
    }
    const ld = jsonLdPosting(doc);
    return ld && clean(ld.description).length > 200 ? ld.description : '';
  }

  // Job title and company from the page title ("Job Application for X at Y" on Greenhouse, or
  // the site's `titlePattern`), then JSON-LD and metadata, falling back to the heading and URL.
  function titleAndCompany() {
    const t = clean(document.title);
    let m = t.match(/^Job Application for (.+?) at (.+)$/i);
    if (m) return { title: m[1], company: m[2] };
    // A titlePattern may give only the title (Taleo: "Job Description - Title (123)").
    const site = currentSite();
    const tp = site && site.titlePattern;
    m = tp && t.match(tp.re);
    let fromTitle = m ? { title: clean(m[tp.title]), company: tp.company ? clean(m[tp.company]) : '' } : null;
    // Or the element showing the job title (`titleSelector`), when the page title doesn't have it.
    const titleEl = !fromTitle && site && site.titleSelector && document.querySelector(site.titleSelector);
    if (titleEl && clean(titleEl.textContent)) fromTitle = { title: clean(titleEl.textContent), company: '' };
    if (fromTitle && fromTitle.company) return fromTitle;
    const ld = jsonLdPosting(document);
    if (ld && ld.title && ld.company) return { title: fromTitle ? fromTitle.title : ld.title, company: ld.company };
    const og = document.querySelector('meta[property="og:site_name"]');
    const h1 = document.querySelector('h1, h2');
    // The first path segment often names the company (jobs.lever.co/<company>/...), but not
    // when it's a short route like UKG Ready's /ta/.
    let slug = decodeURIComponent(location.pathname.split('/')[1] || '');
    if (slug.length < 3) slug = '';
    return {
      title: fromTitle ? fromTitle.title : h1 ? clean(h1.textContent) : t,
      company: (og && clean(og.content)) || (slug ? slug.charAt(0).toUpperCase() + slug.slice(1) : location.hostname),
    };
  }

  function jobInfo() {
    const { title, company } = titleAndCompany();
    const description = descriptionFrom(document) || document.body.innerText;
    return { jobTitle: title, company, jobDescription: description.replace(/\n{3,}/g, '\n\n').slice(0, 15000) };
  }

  // The job posting for tailoring. Lever's /apply page has no description, so fetch the posting
  // page (same site) and read it from there.
  // The company's own website, for company research: the hiring organization's URL in JSON-LD,
  // else a "company website" or logo link on the posting. Job boards, social networks and the
  // ATS itself don't count. Returns a bare host like "example.com", or ''.
  const NOT_COMPANY_HOST = /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|smartrecruiters\.com|myworkdayjobs\.com|myworkdaysite\.com|workday\.com|icims\.com|successfactors\.(com|eu)|sapsf\.(com|eu)|taleo\.net|oraclecloud\.com|ultipro\.(com|ca)|saashr\.com|joinhandshake\.com|linkedin\.com|indeed\.com|glassdoor\.com|ziprecruiter\.com|twitter\.com|x\.com|facebook\.com|instagram\.com|youtube\.com|tiktok\.com|github\.com|google\.com|apple\.com|bit\.ly|medium\.com)$/i;

  function companyHost(href) {
    try {
      const u = new URL(href, location.href);
      if (!/^https?:$/.test(u.protocol) || NOT_COMPANY_HOST.test(u.hostname) || u.hostname === location.hostname) return '';
      return u.hostname.toLowerCase().replace(/^www\./, '');
    } catch (e) {
      return '';
    }
  }

  function companyDomain(doc) {
    for (const node of doc.querySelectorAll('script[type="application/ld+json"]')) {
      let data;
      try {
        data = JSON.parse(node.textContent);
      } catch (e) {
        continue;
      }
      const posting = [].concat(data, (data && data['@graph']) || []).find((d) => d && d['@type'] === 'JobPosting');
      const org = posting && posting.hiringOrganization;
      if (org && typeof org === 'object') {
        for (const href of [].concat(org.sameAs || [], org.url || [])) {
          const host = companyHost(href);
          if (host) return host;
        }
      }
    }
    for (const a of doc.querySelectorAll('a[href]')) {
      const text = clean(a.textContent) + ' ' + (a.getAttribute('aria-label') || '') + ' ' + (typeof a.className === 'string' ? a.className : '');
      const logo = a.querySelector('img[alt*="logo" i], img[class*="logo" i]');
      if (!logo && !/company (web)?site|our website|visit (our )?website|homepage|home page|\blogo\b/i.test(text)) continue;
      const host = companyHost(a.getAttribute('href'));
      if (host) return host;
    }
    // A careers page on the company's own site (careers.example.com).
    const here = location.hostname.toLowerCase();
    if (doc === document && !NOT_COMPANY_HOST.test(here) && !/^(localhost|[\d.]+)$/.test(here)) {
      return here.replace(/^(www|careers?|jobs|apply|work|join)\./, '');
    }
    return '';
  }

  async function jobPosting() {
    const { title, company } = titleAndCompany();
    let description = '';
    let domain = '';
    // On an /apply page (Ashby: /application) the posting is on the page without it; read it
    // from there first.
    if (/\/(apply|application)\/?$/.test(location.pathname)) {
      try {
        const res = await fetch(location.href.replace(/\/(apply|application)\/?(\?.*)?$/, ''), { credentials: 'same-origin' });
        const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
        description = descriptionFrom(doc);
        domain = companyDomain(doc);
      } catch (e) {
        /* fall back to this page */
      }
    }
    if (!domain) domain = companyDomain(document);
    if (!description) description = descriptionFrom(document);
    if (!description) description = document.body.innerText;
    const site = currentSite();
    return {
      title,
      company,
      url: location.href,
      site: site ? site.name : location.hostname,
      companyDomain: domain,
      description: description.replace(/\n{3,}/g, '\n\n').slice(0, 20000),
      hasForm: collectFields(findRoot().root).length > 0,
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

  // ---------------------------------------------------------------------------
  // Cover letters (written on the cover letter page, saved with the application): attached to
  // cover letter uploads as a PDF, or pasted into a cover letter text box.

  const COVER_LETTER_RE = /cover\s*letter|letter of (interest|intent)|motivation(al)? letter/i;

  // replace: put it in even if the field already has something (you asked for it).
  async function fillCoverLetter(root, profile, replace) {
    const letter = await S.getLetter(location.href);
    if (!letter || !letter.text) return { found: 0, attached: 0, pasted: 0 };
    const fields = analyze(root, profile).filter((f) => {
      const text = [f.label, f.desc.labelRaw, f.desc.attrs, f.desc.context].join(' ');
      return COVER_LETTER_RE.test(text) && (f.kind === 'file' || f.kind === 'textarea');
    });
    let attached = 0;
    let pasted = 0;
    for (const f of fields) {
      if (!replace && !isEmpty(f)) continue;
      let ok = false;
      if (f.kind === 'file' && letter.pdf && letter.pdf.data) {
        ok = attachFile(f.el, { name: letter.pdf.name, type: 'application/pdf', data: letter.pdf.data });
        if (ok) attached++;
      } else if (f.kind === 'textarea') {
        ok = fillText(f.el, letter.text);
        if (ok) pasted++;
      }
      if (ok && session) {
        const known = registry.get(f.id);
        const target = known || f;
        if (!known) registry.set(f.id, f);
        globalThis.JobScriptBank.unwatch(target);
        setStatus(target, 'filled', f.kind === 'file' ? `Your cover letter (${letter.pdf.name})` : 'Your cover letter');
      }
    }
    return { found: fields.length, attached, pasted };
  }

  // From the cover letter page's "Add to application" button, via background.js.
  async function coverLetterFromPage() {
    const res = await fillCoverLetter(findRoot().root, await S.getProfile(), true);
    if (!res.found) return null; // no cover letter field in this frame
    if (session) renderPanel();
    return { ok: true, attached: res.attached, pasted: res.pasted };
  }

  // Returns null when this frame has no form fields, so background.js can ignore it.
  // opts.tailoredId: attach that tailored resume instead of the master (replacing any file
  // already attached to the resume field).
  async function fillPage(opts) {
    if (running) return { ok: false, error: 'A fill is already running on this page.' };
    running = true;
    let aiQuestions = null;
    try {
      const tailoredId = opts && typeof opts.tailoredId === 'string' ? opts.tailoredId : '';
      const tailored = tailoredId ? await S.getTailored(tailoredId) : null;
      const [profile, master, saved, answerSettings, aiSettings] = await Promise.all([
        S.getProfile(),
        tailored ? null : S.getResume(),
        S.getSiteAnswers(location.origin),
        S.getAnswerSettings(),
        S.getAiSettings(),
      ]);
      siteFields = saved.fields;
      if (opts && opts.learn && !saved.learning) {
        await S.setSiteLearning(location.origin, true);
        Object.assign(saved, { learning: true, steps: [] });
      }
      const resume = tailored || master;
      // Pages that render their form after load (React apps) may not have fields yet.
      if (!collectFields(findRoot().root).length) await waitFor(() => collectFields(findRoot().root).length > 0, 3000);
      let { root, site } = findRoot();
      clearHighlights();
      registry.clear();
      globalThis.JobScriptBank.reset();
      // On a later step of a multi-step form, a resume attached earlier is left alone.
      const step = !!(opts && opts.step);
      session = {
        site,
        profile,
        autoSave: answerSettings.autoSave,
        learning: saved.learning,
        steps: saved.steps,
        stepIndex: -1,
        note: (tailored && !step ? `Attached your tailored resume (${tailored.name}). ` : '') + siteWarning() + DEFAULT_NOTE,
        forceResume: !!tailored && !step,
        tailoredId,
        aiEnabled: !!aiSettings.enabled,
        stepPending: false,
        lastStep: step && session ? session.lastStep : null,
        review: null,
      };
      Object.assign(session, (({ title, company }) => ({ jobTitle: title, company }))(titleAndCompany()));
      await loadCompanyProfile(session.company);
      idleNote = '';
      // You asked for this fill, so the panel opens even if you closed it; closing it again
      // leaves the floating button.
      // (Frames without a form return null below and show nothing.)
      if (collectFields(root).length) {
        offerLauncher();
        globalThis.JobScriptPanel.open();
      }
      const first = await attachResumeFirst(root, profile, resume);
      if (first.attached && currentSite() && currentSite().resumeReloads) {
        // iCIMS sends the page off to read the resume as soon as it's attached.
        session.note = 'Attached your resume. The site reloads the page to read it; press Fill this page again when it’s back.';
        renderPanel();
        return summary();
      }
      if (first.attached) root = findRoot().root; // a parsed resume may have redrawn the form
      await ensureEntries(root, profile);

      // Start watching before the pass, so fields revealed by our own answers
      // (e.g. a follow-up question) are caught too. Late passes wait until this one finishes.
      watchForLateFields(profile, resume);

      const s = await runPass(root, profile, resume, false, first.handled);
      s.found += first.handled.size;
      // A cover letter you saved for this application goes into its cover letter field.
      if (s.found) await fillCoverLetter(root, profile, false);
      if (!s.found) {
        if (stopWatching) stopWatching();
        if (stepWatcher) stepWatcher();
        session = null;
        return null;
      }
      rememberStep();
      watchSteps();
      if (session.learning) {
        watchAnswersWhileLearning();
        session.note = stepNote(s.found);
      } else if (session.stepIndex >= 0) {
        const title = session.stepTitle ? ` (${session.stepTitle})` : '';
        session.note = `Filled step ${session.stepIndex + 1} of ${session.steps.length}${title} the way you did. ` + siteWarning() + DEFAULT_NOTE;
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

  // On a site you taught JobScript, or are teaching it, show the panel when the form loads,
  // without filling anything until you press "Fill this step".
  async function autoStart() {
    let saved;
    try {
      saved = await S.getSiteAnswers(location.origin);
    } catch (e) {
      return;
    }
    if (!saved.learning && !saved.steps.length) return;
    if (!(await waitFor(() => collectFields(findRoot().root).length > 0, 8000))) return;
    const [profile, answerSettings] = await Promise.all([S.getProfile(), S.getAnswerSettings()]);
    if (session || running) return; // a fill started meanwhile
    siteFields = saved.fields;
    session = {
      site: findRoot().site,
      profile,
      autoSave: answerSettings.autoSave,
      learning: saved.learning,
      steps: saved.steps,
      stepIndex: -1,
      note: '',
      forceResume: false,
      tailoredId: '',
      stepPending: true,
      lastStep: null,
      review: null,
    };
    Object.assign(session, (({ title, company }) => ({ jobTitle: title, company }))(titleAndCompany()));
    rememberStep();
    watchSteps();
    if (session.learning) watchAnswersWhileLearning();
    session.note = stepNote(stepFields.length);
    offerLauncher();
    renderPanel();
  }

  // On the job sites JobScript runs on by itself, put the floating JobScript button on
  // application pages (a form with a few fields or an upload) and, in the top frame, on job
  // postings. With "Show panel automatically" on, application pages also open the panel, which
  // fills nothing until you press Fill.
  const LAUNCHER_WAIT_MS = 10000;

  function pageKind() {
    const fields = collectFields(findRoot().root);
    if (fields.length >= 3 || fields.some((f) => f.kind === 'file')) return 'application';
    if (window.top === window && descriptionFrom(document)) return 'posting';
    return null;
  }

  // The floating button, unless you turned it off on the options page.
  let buttonOn = true;
  let launcherWanted = false; // this page has a form or posting (or a fill ran)

  function offerLauncher() {
    launcherWanted = true;
    if (buttonOn) globalThis.JobScriptPanel.showLauncher(openPanel);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.panelSettings) return;
    buttonOn = !changes.panelSettings.newValue || changes.panelSettings.newValue.showButton !== false;
    if (!buttonOn) globalThis.JobScriptPanel.hideLauncher();
    else if (launcherWanted) offerLauncher();
  });

  async function initLauncher() {
    try {
      buttonOn = (await S.getPanelSettings()).showButton;
    } catch (e) {
      /* keep the default */
    }
    let kind = null;
    for (const end = Date.now() + LAUNCHER_WAIT_MS; !kind && Date.now() < end; ) {
      kind = pageKind();
      if (!kind) await sleep(500);
    }
    if (!kind || session) return; // a fill (or a learned site) already set up the panel
    offerLauncher();
    if (kind !== 'application') return;
    let settings;
    try {
      settings = await S.getPanelSettings();
    } catch (e) {
      return;
    }
    if (settings.autoShow && !session && !globalThis.JobScriptPanel.isOpen()) openPanel();
  }

  globalThis.__jobscriptFill = fillPage;
  globalThis.__jobscriptJobPosting = jobPosting;
  globalThis.__jobscriptCoverLetter = coverLetterFromPage;
  // One line so you can tell JobScript is running here, even with nothing else to show.
  // The platform's name or the site's host only; never anything from your profile.
  const platform = currentSite() ? currentSite().name : location.hostname;
  console.info(`[JobScript] loaded on ${platform}`);

  autoStart();
  initLauncher();
})();
