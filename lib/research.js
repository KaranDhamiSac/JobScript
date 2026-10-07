// Company research, website mode: reads a company's own About, Mission, Values, Careers and
// Culture pages so Claude can summarize them. Loaded by background.js (and Node tests); the
// service worker has no DOMParser, so text and links are pulled out of the HTML here.
//
// Pages are fetched only with the optional host permission you grant for that one company's
// site (asked for on the company page), without cookies, and only from that site.
(function () {
  const MAX_PAGES = 8;
  const MAX_HTML_BYTES = 600000;
  const MAX_PAGE_CHARS = 12000;
  const FETCH_TIMEOUT_MS = 12000;

  // Tried in this order after the home page; nav links that look like these come first.
  const COMMON_PATHS = [
    '/about', '/about-us', '/company', '/mission', '/our-mission', '/values', '/our-values',
    '/culture', '/careers', '/who-we-are', '/our-story', '/about/mission', '/company/about',
  ];
  const TOPIC_RE = /\b(about|mission|values?|culture|careers?|who[- ]we[- ]are|our[- ]story|purpose|principles)\b/i;

  const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', mdash: '—', ndash: '–', hellip: '…' };

  function decode(text) {
    return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    });
  }

  // Readable text of a page: no scripts, styles, navigation chrome or footers; block elements
  // become line breaks.
  function htmlToText(html) {
    let s = String(html || '');
    s = s.replace(/<!--[\s\S]*?-->/g, ' ');
    s = s.replace(/<(script|style|noscript|template|svg|head|nav|footer|form|iframe)\b[\s\S]*?<\/\1\s*>/gi, ' ');
    s = s.replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/section|\/article|\/tr)\b[^>]*>/gi, '\n');
    s = s.replace(/<li\b[^>]*>/gi, '\n- ');
    s = s.replace(/<[^>]+>/g, ' ');
    s = decode(s);
    return s
      .split('\n')
      .map((l) => l.replace(/[ \t\r\f\v]+/g, ' ').trim())
      .filter(Boolean)
      .join('\n')
      .slice(0, MAX_PAGE_CHARS);
  }

  function titleOf(html) {
    const m = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(String(html || ''));
    return m ? decode(m[1]).replace(/\s+/g, ' ').trim().slice(0, 200) : '';
  }

  function sameSite(host, domain) {
    const h = host.toLowerCase().replace(/^www\./, '');
    const d = domain.toLowerCase().replace(/^www\./, '');
    return h === d;
  }

  // Links on the page to the same site whose text or path looks like About/Mission/Values/…
  function topicLinks(html, baseUrl, domain) {
    const out = [];
    const re = /<a\b[^>]*\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = re.exec(String(html || '')))) {
      const href = decode(m[2] ?? m[3] ?? m[4] ?? '');
      const text = decode(m[5].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
      let u;
      try {
        u = new URL(href, baseUrl);
      } catch (e) {
        continue;
      }
      if (!/^https?:$/.test(u.protocol) || !sameSite(u.hostname, domain)) continue;
      if (!TOPIC_RE.test(text) && !TOPIC_RE.test(u.pathname)) continue;
      u.hash = '';
      u.search = '';
      if (!out.includes(u.href)) out.push(u.href);
    }
    return out;
  }

  // Fetches one page; null unless it's HTML from the same site.
  async function fetchPage(fetchImpl, url, domain) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetchImpl(url, { credentials: 'omit', redirect: 'follow', signal: controller.signal, headers: { accept: 'text/html' } });
      if (!res.ok) return null;
      const finalUrl = res.url || url;
      if (!sameSite(new URL(finalUrl).hostname, domain)) return null; // redirected off-site
      const type = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
      if (type && !/html/i.test(type)) return null;
      const html = (await res.text()).slice(0, MAX_HTML_BYTES);
      return { url: finalUrl, html };
    } catch (e) {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  // Reads the home page, then topic links from it, then common paths, up to MAX_PAGES pages
  // with real text. Returns [{ url, title, text }].
  async function fetchCompanyPages(domain, fetchImpl) {
    const f = fetchImpl || fetch;
    const host = String(domain || '').toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) return [];
    const pages = [];
    const seen = new Set();
    const add = (page) => {
      const text = htmlToText(page.html);
      if (text.length < 200) return;
      pages.push({ url: page.url, title: titleOf(page.html), text });
    };
    const home = (await fetchPage(f, `https://${host}/`, host)) || (await fetchPage(f, `https://www.${host}/`, host));
    if (!home) return [];
    seen.add(home.url.replace(/\/$/, ''));
    add(home);
    const base = new URL(home.url);
    const queue = [...topicLinks(home.html, home.url, host), ...COMMON_PATHS.map((p) => base.origin + p)];
    for (const url of queue) {
      if (pages.length >= MAX_PAGES) break;
      const key = url.replace(/\/$/, '');
      if (seen.has(key)) continue;
      seen.add(key);
      const page = await fetchPage(f, url, host);
      if (!page) continue;
      const finalKey = page.url.replace(/\/$/, '');
      if (finalKey !== key && seen.has(finalKey)) continue; // e.g. /about redirected home
      seen.add(finalKey);
      add(page);
    }
    return pages;
  }

  globalThis.JobScriptResearch = { htmlToText, titleOf, topicLinks, fetchCompanyPages, MAX_PAGES };
})();
