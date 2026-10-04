// Test safety net: block every non-GET request from the page so nothing can be submitted or uploaded.
// The proxy can allow named read-only POSTs (window.__jsAllowPost, a regex on the URL).
(function () {
  window.__blockedRequests = [];
  const allow = window.__jsAllowPost ? new RegExp(window.__jsAllowPost) : null;
  const ok = (m, url) => !m || /^(GET|HEAD|OPTIONS)$/i.test(m) || (/^POST$/i.test(m) && !!allow && allow.test(String(url)));
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const method = (init && init.method) || (input && input.method) || 'GET';
    if (!ok(method, input && input.url ? input.url : input)) {
      window.__blockedRequests.push(method + ' ' + (input && input.url ? input.url : input));
      return Promise.reject(new TypeError('Blocked by JobScript test guard'));
    }
    return origFetch.apply(this, arguments);
  };
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) { this.__jsBlocked = !ok(method, url); this.__jsDesc = method + ' ' + url; return origOpen.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () {
    if (this.__jsBlocked) { window.__blockedRequests.push(this.__jsDesc); this.abort(); return; }
    return origSend.apply(this, arguments);
  };
  navigator.sendBeacon = function (url) { window.__blockedRequests.push('BEACON ' + url); return true; };
  document.addEventListener('submit', (e) => { e.preventDefault(); e.stopImmediatePropagation(); window.__blockedRequests.push('FORM SUBMIT'); }, true);
})();
