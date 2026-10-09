// Agent mode, the page side. background.js runs the Claude loop (lib/agent.js); this script
// describes the form to it (a text snapshot) and carries out its tool calls with the fill's own
// code (content/autofill.js, through globalThis.JobScriptFill).
//
// The rules live here, where the clicks happen, so no reply from Claude can get around them:
// - buttons that submit, apply, send or finish are never pressed; Continue / Next wait for your
//   approval unless you allow them for this run
// - passwords, card numbers and government ID numbers are never typed
// - voluntary self-identification and consent boxes are left to you
// - answers follow the canonical rules: a generic answer is saved (with Undo), a changing one
//   asks you for a rule, a job-specific one is a draft you approve
// - Stop works at once: every later call is refused, and a pending question is dropped
(function () {
  if (globalThis.JobScriptAgentUI) return;
  const F = globalThis.JobScriptFill;
  if (!F) return;
  const { S, C, FM, clean, norm, sleep } = F;

  const MAX_OPTIONS = 40;
  const MAX_BUTTONS = 40;
  const MAX_LOG = 150;
  const ASK_TIMEOUT_MS = 4 * 60 * 1000;

  // Pressing these submits or ends the application, or throws work away. Never pressed.
  const BLOCKED_BUTTON = /\b(submit|apply|send|finish|complete|confirm|done|sign|e-?sign|place order|pay|purchase|withdraw|delete|remove|discard|cancel|log ?out|sign ?out)\b/i;
  // Moving between steps: only with your approval (or "Allow Continue / Next" for this run).
  const NAV_BUTTON = /\b(continue|next|proceed|save (and|&) continue|review|back|previous|prev)\b/i;
  // Never typed, whatever the field.
  const SSN_RE = /\b\d{3}[- ]?\d{2}[- ]?\d{4}\b/;
  const CARD_RE = /\b(?:\d[ -]?){13,19}\b/;
  const SENSITIVE_AUTOCOMPLETE = /^(cc-|one-time-code|current-password|new-password)/;
  const COVER_LETTER_RE = /cover\s*letter|letter of (interest|intent)|motivation(al)? letter/i;

  // ---------------------------------------------------------------------------
  // State

  let settings = { aiEnabled: false, autoRun: false };
  let run = null; // { id, stopped, allowNav, startedAt }
  // What the panel shows; kept after a run ends until you close it.
  const ui = { visible: false, running: false, status: '', log: [], usage: '', prompt: null };
  let pendingPrompt = null; // { resolve } for the question or approval on screen

  async function loadSettings() {
    try {
      const [ai, agent] = await Promise.all([S.getAiSettings(), S.getAgentSettings()]);
      settings = { aiEnabled: ai.enabled, autoRun: agent.autoRun };
    } catch (e) {
      /* keep the defaults */
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.aiSettings || changes.agentSettings)) loadSettings().then(redraw);
  });

  function redraw() {
    if (F.getSession()) F.renderPanel();
    else if (globalThis.JobScriptPanel.isOpen()) F.renderIdle();
  }

  function log(text, kind) {
    ui.log.push({ text, kind: kind || 'action' });
    if (ui.log.length > MAX_LOG) ui.log.splice(0, ui.log.length - MAX_LOG);
    redraw();
  }

  // ---------------------------------------------------------------------------
  // Snapshot: the form as compact text, with a ref for each field and button.

  let fieldsByRef = new Map();
  let buttonsByRef = new Map();
  const buttonIds = new WeakMap();
  let nextButtonId = 1;

  function buttonRef(el) {
    let id = buttonIds.get(el);
    if (!id) {
      id = nextButtonId++;
      buttonIds.set(el, id);
    }
    return 'b' + id;
  }

  function quote(text, max) {
    const t = clean(text);
    const cut = t.length > max ? t.slice(0, max - 1) + '…' : t;
    return '"' + cut.replace(/"/g, "'") + '"';
  }

  function labelOf(el) {
    return clean(el.textContent) || clean(el.value) || clean(el.getAttribute('aria-label')) || clean(el.getAttribute('title'));
  }

  // 'blocked', 'nav' or 'ok'.
  function buttonKind(el) {
    const text = labelOf(el);
    if (BLOCKED_BUTTON.test(text)) return 'blocked';
    if (NAV_BUTTON.test(text)) return 'nav';
    const type = (el.getAttribute('type') || (el.tagName === 'BUTTON' ? 'submit' : '')).toLowerCase();
    // A plain submit button inside a form sends it, whatever it says.
    if (type === 'submit' && el.form) return 'blocked';
    if (el.tagName === 'A') {
      try {
        if (new URL(el.href, location.href).hostname !== location.hostname) return 'blocked';
      } catch (e) {
        return 'blocked';
      }
    }
    return 'ok';
  }

  // Validation messages tied to a field: aria-errormessage / aria-describedby, or an error
  // element in the field's own container.
  function fieldError(f) {
    const el = f.groupInputs ? f.groupInputs[0] : f.el;
    const ids = [el.getAttribute('aria-errormessage'), el.getAttribute('aria-describedby')].filter(Boolean).join(' ').split(/\s+/);
    const root = el.getRootNode();
    for (const id of ids) {
      const n = id && root.getElementById && root.getElementById(id);
      const t = n && F.isVisible(n) ? clean(n.textContent) : '';
      if (t && /error|required|invalid|must|please|enter|select/i.test(t + ' ' + n.className)) return t;
    }
    const invalid = (f.groupInputs || [el]).some((e) => e.getAttribute('aria-invalid') === 'true');
    let box = el.parentElement;
    for (let d = 0; box && d < 4; d++, box = box.parentElement) {
      if (box.querySelectorAll('input:not([type="hidden"]), select, textarea').length > (f.groupInputs ? f.groupInputs.length : 1) + 1) break;
      const err = [...box.querySelectorAll('[class*="error" i], [role="alert"]')].find((n) => F.isVisible(n) && clean(n.textContent));
      if (err) return clean(err.textContent);
    }
    return invalid ? 'marked invalid' : '';
  }

  function pageErrors() {
    const seen = new Set();
    for (const n of F.deepQueryAll(document.body, '[role="alert"], [aria-live="assertive"], [class*="error-summary" i], [class*="errorSummary"]')) {
      const t = clean(n.textContent);
      if (t && t.length <= 300 && F.isVisible(n)) seen.add(t);
      if (seen.size >= 4) break;
    }
    return [...seen];
  }

  function isSensitiveField(f) {
    const el = f.el;
    const ac = (el.getAttribute('autocomplete') || '').toLowerCase();
    return el.type === 'password' || SENSITIVE_AUTOCOMPLETE.test(ac) || FM.sensitiveLabel.test(f.label || '');
  }

  function isWidgetButton(el) {
    return (
      el.hasAttribute('aria-pressed') ||
      !!F.closestDeep(el, '[role="listbox"], [role="combobox"], [role="option"], [class*="select__"], [class*="datepicker" i], [class*="calendar" i], jobscript-panel')
    );
  }

  function collectButtons(root) {
    const seen = new Set();
    const list = [];
    const take = (scope) => {
      for (const el of F.deepQueryAll(scope, 'button, [role="button"], input[type="submit"], input[type="button"], a[role="button"]')) {
        if (seen.has(el) || list.length >= MAX_BUTTONS) continue;
        seen.add(el);
        if (el.disabled || !F.isVisible(el) || isWidgetButton(el) || !labelOf(el)) continue;
        list.push(el);
      }
    };
    take(root);
    if (root !== document.body) take(document.body); // Next / Continue often sit outside the form
    return list;
  }

  // The fields as the panel knows them when it does (their status and saving state), else fresh.
  function currentFields() {
    const session = F.getSession();
    const profile = session ? session.profile : {};
    const fresh = F.analyze(F.findRoot().root, profile);
    return fresh.map((f) => {
      const known = F.registry.get(f.id);
      return known && known.el === f.el ? known : f;
    });
  }

  function describeField(f) {
    const bits = [`[f${f.id}] ${f.kind} ${quote(f.label, 160)}`];
    if (f.required) bits.push('required');
    if (f.category === 'eeo') bits.push('voluntary self-ID: leave for the user');
    else if (isSensitiveField(f)) bits.push('sensitive: leave for the user');
    const value = F.currentValueText(f);
    bits.push(value ? 'value ' + quote(value, 120) : 'empty');
    if (f.status === 'suggested') bits.push('a suggestion is waiting for the user to accept');
    if (f.options && f.options.length) {
      const shown = f.options.slice(0, MAX_OPTIONS).map((o) => clean(o).slice(0, 80));
      const more = f.options.length > MAX_OPTIONS ? ` | …${f.options.length - MAX_OPTIONS} more` : '';
      bits.push('options: ' + shown.join(' | ') + more);
    } else if (['combobox', 'listbox', 'prompt'].includes(f.kind)) {
      bits.push('options: searchable list (use select_option with the text you want)');
    }
    if (f.kind === 'text' && f.el.maxLength > 0 && f.el.maxLength < 10000) bits.push(`max ${f.el.maxLength} chars`);
    const err = fieldError(f);
    if (err) bits.push('error: ' + quote(err, 160));
    return bits.join(' · ');
  }

  function snapshot() {
    const { root } = F.findRoot();
    const fields = currentFields();
    fieldsByRef = new Map(fields.map((f) => ['f' + f.id, f]));
    const buttons = collectButtons(root);
    buttonsByRef = new Map(buttons.map((b) => [buttonRef(b), b]));
    const headings = F.deepQueryAll(root, 'h1, h2, h3, legend, [role="heading"]')
      .filter((h) => F.isVisible(h))
      .map((h) => clean(h.textContent))
      .filter((t) => t && t.length <= 100);
    const lines = [`Page: ${location.hostname}${location.pathname}`];
    const step = F.stepTitleNow();
    if (step) lines.push('Step: ' + quote(step, 100));
    if (headings.length) lines.push('Headings: ' + [...new Set(headings)].slice(0, 8).map((h) => quote(h, 80)).join(' · '));
    const errors = pageErrors();
    if (errors.length) lines.push('Messages on the page: ' + errors.map((e) => quote(e, 200)).join(' · '));
    lines.push(`Fields (${fields.length}):`);
    for (const f of fields) lines.push(describeField(f));
    if (!fields.length) lines.push('(no form fields found)');
    lines.push(`Buttons (${buttons.length}):`);
    for (const b of buttons) {
      const kind = buttonKind(b);
      const note = kind === 'blocked' ? ' · blocked: the user presses this' : kind === 'nav' ? ' · moves to another step: needs the user’s approval' : '';
      lines.push(`[${buttonRef(b)}] ${quote(labelOf(b), 80)}${note}`);
    }
    return { text: lines.join('\n'), fieldCount: fields.length };
  }

  // ---------------------------------------------------------------------------
  // Asking you, in the panel

  function askInPanel(prompt) {
    return new Promise((resolve) => {
      let timer = null;
      const finish = (value) => {
        clearTimeout(timer);
        if (pendingPrompt && pendingPrompt.resolve === finish) pendingPrompt = null;
        ui.prompt = null;
        redraw();
        resolve(value);
      };
      timer = setTimeout(() => finish(null), ASK_TIMEOUT_MS);
      pendingPrompt = { resolve: finish };
      ui.prompt = Object.assign({}, prompt, { onAnswer: finish });
      globalThis.JobScriptPanel.open();
      redraw();
    });
  }

  // ---------------------------------------------------------------------------
  // Answers the agent writes follow the canonical rules.

  function fieldOf(ref) {
    const f = fieldsByRef.get(String(ref || ''));
    if (!f) return { error: `Unknown field ${ref}. Call read_snapshot for current refs.` };
    if (!f.el.isConnected) return { error: `Field ${ref} is no longer on the page. Call read_snapshot.` };
    return { f };
  }

  function register(f) {
    if (!F.registry.has(f.id)) F.registry.set(f.id, f);
    globalThis.JobScriptBank.unwatch(f);
  }

  function looksLikeSecret(value) {
    const digits = String(value).replace(/\D/g, '');
    return SSN_RE.test(value) || (CARD_RE.test(value) && digits.length >= 13 && luhn(digits));
  }

  function luhn(digits) {
    let sum = 0;
    for (let i = 0; i < digits.length; i++) {
      let d = Number(digits[digits.length - 1 - i]);
      if (i % 2) {
        d *= 2;
        if (d > 9) d -= 9;
      }
      sum += d;
    }
    return sum % 10 === 0;
  }

  // Refusals that apply to every way of writing into a field.
  function refuseWrite(f, value) {
    if (isSensitiveField(f)) return 'This field asks for a password, card, bank or government ID detail. JobScript never fills those; leave it for the user.';
    if (f.category === 'eeo') return 'Voluntary self-identification questions are the user’s to answer. Leave it.';
    if (f.kind === 'file') return 'Use upload_document for file fields.';
    if (value !== undefined && looksLikeSecret(String(value))) return 'That value looks like a card or Social Security number. JobScript never types those.';
    return '';
  }

  async function classify(f) {
    if (f.section) return { type: 'section' }; // a fact in a repeating section: your nth job, school…
    if (f.cls) return f.cls;
    const ruled = F.classifyWording(f.desc.labelRaw);
    if (ruled) return (f.cls = ruled);
    return (await F.classifyForLearning(f)) || { type: 'unknown' };
  }

  // The saved answer for a canonical question, if there is one.
  async function savedCanonValue(key) {
    const q = C.get(key);
    const session = F.getSession();
    if (q && q.profile && session) return C.readProfile(session.profile, q.profile) || '';
    const entry = (await S.getCanonAnswers())[key];
    return entry ? entry.rule || entry.value || '' : '';
  }

  // Puts the agent's answer in, or offers it, by question type. shown: the answer as text.
  // Returns the tool result text.
  async function placeAnswer(f, shown, apply, verb) {
    const cls = await classify(f);
    register(f);
    const label = quote(f.label, 80);
    if (cls.type === 'job' || cls.type === 'unknown') {
      const essay = f.kind === 'textarea' || shown.length > 120;
      F.suggest(f, shown, apply, essay ? { draft: true, detail: 'Draft by the agent' } : { source: 'agent' });
      F.renderPanel();
      log(`Drafted ${label} for your approval`, 'info');
      return `Not filled: ${cls.type === 'job' ? 'this question is about this job' : 'JobScript couldn’t tell what kind of question this is'}, so your answer is shown to the user as a draft to approve. Don't fill it again.`;
    }
    if (cls.type === 'changing') {
      // Changing answers (start date, salary) are suggestions; once you accept one, you're
      // asked how to save it (a date can be saved as a rule like "2 weeks from today").
      F.suggest(f, shown, async () => {
        const ok = (await apply()) === true;
        if (ok) setTimeout(() => F.openReview([{ f, value: F.currentValueText(f) }], 'Save this answer for next time?'), 0);
        return ok;
      }, { source: 'agent' });
      F.renderPanel();
      log(`Suggested ${quote(shown, 60)} for ${label}; accept it in the panel`, 'info');
      return 'This answer changes over time (like a start date or salary), so it is shown to the user as a suggestion to accept. Don\'t fill it again.';
    }
    let ok = false;
    try {
      ok = (await apply()) === true;
    } catch (e) {
      ok = false;
    }
    if (!ok) return null;
    const now = F.currentValueText(f);
    if (cls.type === 'generic' && F.saveable(f)) {
      const key = cls.key || C.customKey(f.label);
      const saved = await savedCanonValue(key);
      if (saved && norm(saved) !== norm(now)) {
        F.setStatus(f, 'filled', F.preview(now) + ' · by the agent · differs from your saved answer, which was kept');
      } else if (!saved) {
        const undo = await F.storeGeneric(f, key, now);
        f.cls = Object.assign({}, cls, { key });
        F.setStatus(f, 'filled', F.preview(now) + ' · by the agent · saved for next time');
        globalThis.JobScriptBank.toast(F.highlightTarget(f), 'Saved', async () => {
          await undo();
          F.setStatus(f, 'filled', F.preview(now) + ' · by the agent · not saved', { noHighlight: true });
          F.renderPanel();
        });
      } else {
        F.setStatus(f, 'filled', F.preview(now) + ' · by the agent');
      }
    } else {
      F.setStatus(f, 'filled', F.preview(now) + ' · by the agent');
    }
    F.renderPanel();
    log(verb);
    return `OK. ${label} now shows ${quote(now, 120)}.`;
  }

  // ---------------------------------------------------------------------------
  // Tools

  async function newFieldsNote(before) {
    await sleep(400);
    const after = currentFields().length;
    return after > before ? ` ${after - before} new field${after - before === 1 ? '' : 's'} appeared; call read_snapshot.` : '';
  }

  const tools = {
    read_snapshot() {
      return { text: snapshot().text };
    },

    async fill_field({ ref, value }) {
      const { f, error } = fieldOf(ref);
      if (error) return { error };
      const text = String(value == null ? '' : value);
      const refusal = refuseWrite(f, text);
      if (refusal) return { refused: refusal, label: f.label };
      if (!text.trim()) return { error: 'Empty value. To leave a field blank, just skip it.' };
      if (f.kind === 'checkbox') return { error: 'Use check for a checkbox.' };
      const before = fieldsByRef.size;
      const result = await placeAnswer(f, text, () => F.applyValue(f, { text, hint: {} }, { allowWeak: false }), `Filled ${quote(f.label, 80)}`);
      if (result === null) return { error: `Couldn't fill ${quote(f.label, 80)} with that value.${f.options && f.options.length ? ' Use select_option with one of its options.' : ''}` };
      return { text: result + (await newFieldsNote(before)) };
    },

    async select_option({ ref, option }) {
      const { f, error } = fieldOf(ref);
      if (error) return { error };
      const text = String(option == null ? '' : option);
      const refusal = refuseWrite(f, text);
      if (refusal) return { refused: refusal, label: f.label };
      if (f.kind === 'checkbox') return { error: 'Use check for a checkbox.' };
      let weak = '';
      const apply = async () => {
        const r = await F.applyValue(f, { text, hint: {} }, { allowWeak: false });
        if (r && r.weakPick) weak = r.weakPick;
        return r === true;
      };
      // A multi-select keeps adding: check the option isn't there already.
      const before = fieldsByRef.size;
      const result = await placeAnswer(f, text, apply, `Selected ${quote(text, 60)} for ${quote(f.label, 80)}`);
      if (result === null) {
        return { error: weak ? `No option matches exactly. The closest is ${quote(weak, 80)}; call select_option with an option's exact text.` : `Couldn't select ${quote(text, 80)} in ${quote(f.label, 80)}.` };
      }
      return { text: result + (await newFieldsNote(before)) };
    },

    async check({ ref, checked }) {
      const { f, error } = fieldOf(ref);
      if (error) return { error };
      if (f.kind !== 'checkbox') return { error: 'check is for a single checkbox. Use select_option for a group of boxes.' };
      if (F.AI_EXCLUDE_LABEL.test(f.label) || isSensitiveField(f)) {
        return { refused: 'Consent, agreement and attestation boxes are the user’s to tick. Leave it.', label: f.label };
      }
      const want = checked === true;
      if (f.el.checked !== want) f.el.click();
      await sleep(100);
      if (f.el.checked !== want) return { error: `Couldn't ${want ? 'check' : 'uncheck'} ${quote(f.label, 80)}.` };
      register(f);
      F.setStatus(f, 'filled', (want ? 'Checked' : 'Left unchecked') + ' by the agent', want ? undefined : { noHighlight: true });
      F.renderPanel();
      log(`${want ? 'Checked' : 'Unchecked'} ${quote(f.label, 80)}`);
      return { text: `OK. ${quote(f.label, 80)} is ${want ? 'checked' : 'unchecked'}.` };
    },

    async click({ ref }) {
      const el = buttonsByRef.get(String(ref || ''));
      if (!el) return { error: `Unknown button ${ref}. Call read_snapshot for current refs.` };
      if (!el.isConnected || !F.isVisible(el)) return { error: `Button ${ref} is no longer on the page. Call read_snapshot.` };
      const label = quote(labelOf(el), 80);
      const kind = buttonKind(el);
      if (kind === 'blocked') {
        return { refused: `JobScript never presses ${label}: it could submit, send or end the application, or throw away work. The user presses it.`, label: labelOf(el) };
      }
      if (kind === 'nav' && !run.allowNav) {
        const answer = await askInPanel({
          text: `The agent wants to press ${label}.`,
          detail: 'This moves the form to another step.',
          options: [
            { label: 'Allow once', value: 'once', primary: true },
            { label: 'Allow for this run', value: 'run' },
            { label: 'Don’t', value: 'no' },
          ],
        });
        if (!run || run.stopped) return { stopped: true };
        if (answer === 'run') run.allowNav = true;
        if (answer !== 'once' && answer !== 'run') {
          log(`You declined: ${label}`, 'refused');
          return { text: `The user declined pressing ${label}. Don't press it again; finish what you can on this step, then call done.` };
        }
      }
      const before = currentFields().length;
      const urlBefore = location.href;
      el.click();
      log(`Pressed ${label}`);
      await sleep(900);
      const after = snapshot();
      const changed = location.href !== urlBefore || after.fieldCount !== before;
      return { text: `Pressed ${label}.${changed ? ' The page changed. Current form:' : ' Current form:'}\n${after.text}` };
    },

    async upload_document({ ref, documentType }) {
      const { f, error } = fieldOf(ref);
      if (error) return { error };
      if (f.kind !== 'file') return { error: `${ref} isn't a file upload.` };
      const session = F.getSession();
      if (documentType === 'cover_letter') {
        const letter = await S.getLetter(location.href);
        if (!letter || !letter.pdf || !letter.pdf.data) {
          return { text: 'No cover letter is saved for this job. Leave this upload for the user; they can write one with "Write cover letter" in the panel.' };
        }
        const ok = F.attachFile(f.el, { name: letter.pdf.name, type: 'application/pdf', data: letter.pdf.data });
        if (!ok) return { error: 'Couldn’t attach the cover letter.' };
        register(f);
        F.setStatus(f, 'filled', `Your cover letter (${letter.pdf.name}) · by the agent`);
        F.renderPanel();
        log(`Attached your cover letter to ${quote(f.label, 80)}`);
        return { text: `OK. Attached the cover letter ${quote(letter.pdf.name, 80)}.` };
      }
      if (documentType !== 'resume') return { error: 'documentType must be "resume" or "cover_letter".' };
      if (COVER_LETTER_RE.test(f.label)) return { error: 'That field asks for a cover letter. Use documentType "cover_letter".' };
      // Only a resume made for this job is sent; your master resume only fills in your details.
      let tailoredId = session && session.tailoredId;
      if (!tailoredId) {
        const key = S.applicationKey(location.href);
        const app = (await S.getApplications()).find((a) => S.applicationKey(a.url) === key);
        tailoredId = app && app.tailoredId;
      }
      const tailored = tailoredId ? await S.getTailored(tailoredId) : null;
      if (!tailored) {
        register(f);
        F.askForJobResume(f, await S.getResume());
        F.renderPanel();
        log(`Left ${quote(f.label, 80)} for you: pick a resume for this job in the panel`, 'info');
        return { text: 'No resume made for this job is saved. The panel now asks the user to make one or choose their master resume. Don\'t upload anything here.' };
      }
      const ok = F.attachFile(f.el, tailored);
      if (!ok) return { error: 'Couldn’t attach the resume.' };
      register(f);
      F.setStatus(f, 'filled', `${tailored.name} · by the agent`);
      F.renderPanel();
      log(`Attached ${quote(tailored.name, 60)} to ${quote(f.label, 80)}`);
      return { text: `OK. Attached the resume made for this job, ${quote(tailored.name, 80)}. The site may refill fields from it; call read_snapshot.` };
    },

    scroll_to({ ref }) {
      const r = String(ref || '');
      const el = r.startsWith('b') ? buttonsByRef.get(r) : fieldsByRef.has(r) ? F.highlightTarget(fieldsByRef.get(r)) : null;
      if (!el || !el.isConnected) return { error: `Unknown ref ${ref}. Call read_snapshot.` };
      el.scrollIntoView({ block: 'center' });
      return { text: 'OK.' };
    },

    async ask_user({ question, options }) {
      const q = String(question || '').slice(0, 500);
      if (!q) return { error: 'Ask a question.' };
      const opts = (Array.isArray(options) ? options : []).map((o) => String(o).slice(0, 120)).filter(Boolean).slice(0, 8);
      log(`Asked you: ${q}`, 'info');
      const answer = await askInPanel({
        text: q,
        options: [...opts.map((o, i) => ({ label: o, value: o, primary: i === 0 })), { label: 'Skip', value: '' }],
        freeText: true,
      });
      if (!run || run.stopped) return { stopped: true };
      if (answer === null) return { text: 'The user didn’t answer in time. Leave that question and go on.' };
      if (!answer) return { text: 'The user skipped this question. Leave it for them and go on.' };
      log(`You answered: ${answer}`, 'info');
      return { text: `The user answered: ${quote(answer, 500)}` };
    },

    // The summary is shown when the run ends (background.js sends it with the cost).
    done() {
      return { text: 'OK.', done: true };
    },
  };

  // One tool call from background.js. Returns { text, isError, done, url }.
  async function runTool(name, input) {
    if (!run || run.stopped) return { text: 'Stopped by the user.', isError: true, stopped: true };
    const tool = Object.prototype.hasOwnProperty.call(tools, name) ? tools[name] : null;
    if (!tool) return { text: `Unknown tool ${name}.`, isError: true };
    let res;
    try {
      res = await tool(input && typeof input === 'object' ? input : {});
    } catch (e) {
      res = { error: 'That action failed on this page.' };
    }
    if (!run || run.stopped || res.stopped) return { text: 'Stopped by the user.', isError: true, stopped: true };
    if (res.refused) {
      log(`Refused: ${quote(res.label || name, 60)}`, 'refused');
      return { text: 'Refused. ' + res.refused, isError: true, url: location.href };
    }
    if (res.error) {
      log(res.error, 'error');
      return { text: res.error, isError: true, url: location.href };
    }
    return { text: res.text, done: !!res.done, url: location.href };
  }

  // ---------------------------------------------------------------------------
  // Starting and stopping

  function hasUnfilled() {
    const session = F.getSession();
    if (!session) return true; // a page the fill didn't recognize
    const fields = [...F.registry.values()].filter((f) => f.el.isConnected);
    return !fields.length || fields.some((f) => !f.prefilled && f.status === 'needs');
  }

  async function start() {
    if (run || F.isRunning()) return;
    run = { id: crypto.randomUUID(), stopped: false, allowNav: false, startedAt: Date.now() };
    Object.assign(ui, { visible: true, running: true, status: 'Reading the form…', log: [], usage: '', prompt: null });
    await F.ensureSession();
    redraw();
    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: 'agent-start', runId: run.id, job: F.jobInfo(), snapshot: snapshot().text });
    } catch (e) {
      res = { ok: false, error: /context invalidated/i.test(String(e && e.message)) ? 'JobScript was updated since this page loaded. Refresh the page and try again.' : 'Couldn’t reach JobScript.' };
    }
    if (!res || !res.ok) finish((res && res.error) || 'The agent couldn’t start.', true);
    else {
      ui.status = `Working (${res.model})…`;
      redraw();
    }
  }

  function stop() {
    if (!run || run.stopped) return;
    run.stopped = true;
    if (pendingPrompt) pendingPrompt.resolve(null);
    chrome.runtime.sendMessage({ type: 'agent-stop', runId: run.id }).catch(() => {});
    finish('Stopped. Nothing else will be changed.', false);
  }

  function finish(status, isError) {
    if (isError && status) ui.log.push({ text: status, kind: 'error' });
    ui.running = false;
    ui.prompt = null;
    ui.status = status;
    if (run) run.stopped = true;
    run = null;
    redraw();
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || sender.id !== chrome.runtime.id || sender.tab) return false; // only from background.js
    if (msg.type === 'agent-tool') {
      if (!run || msg.runId !== run.id) {
        sendResponse({ text: 'No agent run on this page.', isError: true, stopped: true });
        return false;
      }
      runTool(msg.name, msg.input).then(sendResponse);
      return true;
    }
    if (msg.type === 'agent-event' && run && msg.runId === run.id) {
      if (msg.usage) ui.usage = msg.usage;
      if (msg.status) ui.status = msg.status;
      if (msg.log) ui.log.push({ text: msg.log, kind: msg.kind || 'info' });
      if (msg.end) finish(msg.end, !!msg.isError);
      else redraw();
      return false;
    }
    return false;
  });

  globalThis.JobScriptAgentUI = {
    // The panel's "Agent: finish this step" button, when it makes sense.
    toolbarAction() {
      if (!settings.aiEnabled || run || !hasUnfilled()) return null;
      return { label: 'Agent: finish this step', ariaLabel: 'Let the agent finish this step with Claude. It never submits.', onClick: start };
    },
    panelState() {
      if (!ui.visible) return null;
      return {
        title: 'Agent',
        running: ui.running,
        status: ui.status,
        log: ui.log,
        usage: ui.usage,
        prompt: ui.prompt,
        allowNav: !!(run && run.allowNav),
        onAllowNav: (on) => {
          if (run) run.allowNav = on;
        },
        onStop: stop,
        onClose: () => {
          ui.visible = false;
          redraw();
        },
      };
    },
    // After a fill: runs the agent by itself when you turned that on. True when it started.
    afterFill() {
      if (!settings.aiEnabled || !settings.autoRun || run || !hasUnfilled()) return false;
      start();
      return true;
    },
    _test: { snapshot, runTool, buttonKind, looksLikeSecret, tools, start, stop, state: () => ({ run, ui }) },
  };

  loadSettings();
})();
