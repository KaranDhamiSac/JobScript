// Test safety net: block every non-GET request from the page so nothing can be submitted or uploaded.
(function () {
  window.__blockedRequests = [];
  const ok = (m) => !m || /^(GET|HEAD|OPTIONS)$/i.test(m);
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const method = (init && init.method) || (input && input.method) || 'GET';
    if (!ok(method)) {
      window.__blockedRequests.push(method + ' ' + (input && input.url ? input.url : input));
      return Promise.reject(new TypeError('Blocked by JobScript test guard'));
    }
    return origFetch.apply(this, arguments);
  };
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) { this.__jsBlocked = !ok(method); this.__jsDesc = method + ' ' + url; return origOpen.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () {
    if (this.__jsBlocked) { window.__blockedRequests.push(this.__jsDesc); this.abort(); return; }
    return origSend.apply(this, arguments);
  };
  navigator.sendBeacon = function (url) { window.__blockedRequests.push('BEACON ' + url); return true; };
  document.addEventListener('submit', (e) => { e.preventDefault(); e.stopImmediatePropagation(); window.__blockedRequests.push('FORM SUBMIT'); }, true);
})();
