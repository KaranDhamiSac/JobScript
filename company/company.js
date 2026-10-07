// Company profile page: company/company.html?name=<company>&domain=<site>
// Shows the saved profile for a company (mission, values, products, news, culture, each item
// with its source), lets you edit and add items, and refreshes it with Claude in the research
// mode you choose. Opened from the side panel, the tracker and the cover letter page.
const S = JobScriptStorage;
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const ANTHROPIC = 'https://api.anthropic.com/*';
const SECTION_TITLES = {
  mission: 'Mission',
  values: 'Values',
  products: 'Products and services',
  news: 'Recent news',
  culture: 'Culture',
};

let profile = null;
let anthropicGranted = false;
let estimate = null;
let dirty = false;

function h(tag, props, children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'text') n.textContent = v;
    else if (k === 'class') n.className = v;
    else if (k === 'value') n.value = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of children || []) if (c) n.append(c);
  return n;
}

function setStatus(text) {
  $('status').textContent = text;
}

function setDirty(on) {
  dirty = on;
  $('save').disabled = !on;
  $('save-status').textContent = on ? 'Unsaved changes' : '';
}

function mode() {
  return document.querySelector('input[name="mode"]:checked').value;
}

function domain() {
  return $('domain').value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
}

function siteOrigins() {
  const d = domain();
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d) ? [`https://${d}/*`, `https://www.${d}/*`] : null;
}

function renderButton() {
  const m = mode();
  const has = profile && profile.updatedAt;
  if (m === 'search') {
    $('research').textContent = (has ? 'Refresh with web search' : 'Research with web search') + (estimate ? ` (${estimate.text})` : '');
    $('estimate').hidden = !estimate;
    if (estimate) {
      $('estimate').textContent = `Estimated cost: ${estimate.text}, for up to ${estimate.searches} web searches ($0.01 each) plus Claude Haiku reading the results. It’s charged to your Anthropic account when you click.`;
    }
  } else {
    $('research').textContent = (has ? 'Refresh from ' : 'Read ') + (domain() || 'the website');
    $('estimate').hidden = true;
  }
}

function renderUpdated() {
  if (!profile || !profile.updatedAt) {
    $('updated').textContent = 'Not researched yet.';
    return;
  }
  const how = profile.mode === 'search' ? 'web search' : 'its website';
  $('updated').textContent = `Last updated ${new Date(profile.updatedAt).toLocaleDateString()} from ${how}` + (profile.editedAt ? `; edited ${new Date(profile.editedAt).toLocaleDateString()}` : '');
}

function renderSections() {
  const box = $('sections');
  box.replaceChildren();
  for (const sec of S.COMPANY_SECTIONS) {
    const section = h('section', { 'aria-labelledby': 'h-' + sec });
    section.append(h('h2', { id: 'h-' + sec, text: SECTION_TITLES[sec] }));
    const list = h('div', { class: 'items' });
    const items = profile[sec];
    items.forEach((it, i) => {
      const text = h('textarea', { rows: '2', 'aria-label': `${SECTION_TITLES[sec]} item ${i + 1}`, value: it.text });
      text.addEventListener('input', () => {
        it.text = text.value;
        it.byYou = true; // you've vouched for it now
        row.classList.add('mine');
        setDirty(true);
      });
      const remove = h('button', { type: 'button', class: 'secondary', text: 'Remove', 'aria-label': `Remove ${SECTION_TITLES[sec]} item ${i + 1}` });
      remove.addEventListener('click', () => {
        items.splice(i, 1);
        setDirty(true);
        renderSections();
      });
      const source = h('div', { class: 'source' });
      if (it.source) {
        source.append('Source: ', h('a', { href: it.source, target: '_blank', rel: 'noopener noreferrer', text: it.source }));
        if (it.byYou) source.append(' · edited by you');
      } else {
        source.append('Added by you');
      }
      const row = h('div', { class: 'item' + (it.byYou ? ' mine' : '') }, [text, remove, source]);
      list.append(row);
    });
    if (!items.length) list.append(h('p', { class: 'empty-note', text: 'Nothing yet.' }));
    const add = h('button', { type: 'button', class: 'secondary', text: 'Add', 'aria-label': `Add a ${SECTION_TITLES[sec]} item` });
    add.addEventListener('click', () => {
      items.push({ text: '', source: '', byYou: true });
      setDirty(true);
      renderSections();
      const boxes = document.querySelectorAll(`[aria-labelledby="h-${sec}"] textarea`);
      if (boxes.length) boxes[boxes.length - 1].focus();
    });
    section.append(list, h('div', { class: 'row' }, [add]));
    box.append(section);
  }
}

async function save() {
  profile.name = $('name').value.trim() || profile.name;
  profile.domain = domain();
  profile.editedAt = new Date().toISOString();
  const saved = await S.saveCompany(profile);
  if (saved) profile = saved;
  setDirty(false);
  $('save-status').textContent = 'Saved';
  renderSections();
  renderUpdated();
}

$('save').addEventListener('click', save);
$('name').addEventListener('input', () => setDirty(true));
$('domain').addEventListener('input', () => {
  setDirty(true);
  renderButton();
});
for (const r of document.querySelectorAll('input[name="mode"]')) {
  r.addEventListener('change', () => {
    S.saveResearchSettings({ mode: mode() });
    renderButton();
  });
}

$('research').addEventListener('click', () => {
  const name = $('name').value.trim();
  if (!name) return setStatus('Enter the company name first.');
  const m = mode();
  const origins = [];
  if (m === 'website') {
    const site = siteOrigins();
    if (!site) return setStatus('Enter the company’s website, like example.com.');
    origins.push(...site);
  }
  if (!anthropicGranted) origins.push(ANTHROPIC);
  // Permission prompts only work straight from a click, so ask before anything else.
  const ask = origins.length ? chrome.permissions.request({ origins }) : Promise.resolve(true);
  ask.then(async (granted) => {
    if (!granted) {
      setStatus(m === 'website' ? `Research needs permission to read ${domain()} (and to reach Anthropic).` : 'Research needs permission to reach Anthropic.');
      return;
    }
    anthropicGranted = true;
    if (dirty) await save();
    $('research').disabled = true;
    setStatus(m === 'website' ? `Reading ${domain()}…` : 'Searching the web…');
    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: 'company-research', name, domain: domain(), mode: m });
    } catch (e) {
      res = { ok: false, error: String(e.message || e) };
    } finally {
      $('research').disabled = false;
    }
    if (!res || !res.ok) {
      setStatus('Research failed: ' + ((res && res.error) || 'unknown error'));
      return;
    }
    profile = res.profile;
    const parts = [m === 'website' ? `Read ${res.pagesRead.length} page${res.pagesRead.length === 1 ? '' : 's'}` : `Ran ${res.searches} web search${res.searches === 1 ? '' : 'es'}`];
    parts.push(`cost about $${res.cost.toFixed(3)}`);
    if (res.dropped) parts.push(`left out ${res.dropped} item${res.dropped === 1 ? '' : 's'} that didn’t trace back to a source`);
    setStatus(parts.join(' · ') + '.');
    renderSections();
    renderUpdated();
    renderButton();
  });
});

window.addEventListener('beforeunload', (e) => {
  if (dirty) e.preventDefault();
});

async function init() {
  const name = params.get('name') || '';
  const [saved, settings, est] = await Promise.all([
    name ? S.getCompany(name) : null,
    S.getResearchSettings(),
    chrome.runtime.sendMessage({ type: 'research-estimate' }).catch(() => null),
  ]);
  anthropicGranted = await chrome.permissions.contains({ origins: [ANTHROPIC] });
  estimate = est && est.ok ? est.estimate : null;
  profile = saved || S.blankCompany(name);
  $('name').value = profile.name || name;
  $('domain').value = profile.domain || params.get('domain') || '';
  document.querySelector(`input[name="mode"][value="${settings.mode}"]`).checked = true;
  $('title').textContent = profile.name ? `${profile.name}` : 'Company profile';
  document.title = `${profile.name || 'Company'} profile`;
  renderSections();
  renderUpdated();
  renderButton();
  if (!(await S.getApiKey())) setStatus('Research uses Claude. Add your Anthropic API key in Options first.');
}

init();
