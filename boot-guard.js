/* Free GST Billing startup recovery for static hosting (including GitHub Pages). */
(function () {
  'use strict';
  if (location.protocol === 'file:') return;

  var KEY = 'fgsb-boot-retry';
  var failedScript = '';
  var policyFailure = '';

  function showFailure() {
    if (window.__fgsbBooted) return;
    var root = document.getElementById('root');
    if (!root) return;
    var details = [failedScript, policyFailure].filter(Boolean).join('\n');
    root.innerHTML = '' +
      '<main style="min-height:100vh;display:grid;place-items:center;padding:24px;background:#f0f2f5;color:#111827;font-family:system-ui,sans-serif">' +
        '<section style="max-width:620px;padding:30px;border:1px solid #fecaca;border-radius:16px;background:#fff;box-shadow:0 12px 36px rgba(15,23,42,.08)">' +
          '<h1 style="margin:0 0 10px;font-size:23px">GST Billing could not load</h1>' +
          '<p style="line-height:1.65;color:#475569">One or more application files could not be loaded. Check that the complete ZIP was uploaded to the GitHub repository root, then refresh this page. PDF, Excel and OCR tools also need an internet connection to load their browser libraries.</p>' +
          (details ? '<pre style="white-space:pre-wrap;overflow-wrap:anywhere;padding:12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;font-size:12px;color:#475569"></pre>' : '') +
          '<button id="fgsb-retry" style="margin-top:8px;padding:11px 18px;border:0;border-radius:9px;background:#2563eb;color:#fff;font-weight:700;cursor:pointer">Reload application</button>' +
        '</section>' +
      '</main>';
    var pre = root.querySelector('pre');
    if (pre) pre.textContent = details;
    var btn = document.getElementById('fgsb-retry');
    if (btn) btn.addEventListener('click', function () { location.reload(); });
  }

  function retryOnce() {
    if (window.__fgsbBooted) return;
    try {
      if (sessionStorage.getItem(KEY)) { showFailure(); return; }
      sessionStorage.setItem(KEY, '1');
    } catch (_) { showFailure(); return; }

    var appPath = new URL('.', location.href).pathname;
    var jobs = [];
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
      jobs.push(navigator.serviceWorker.getRegistrations().then(function (regs) {
        return Promise.all(regs.filter(function (reg) {
          try { return new URL(reg.scope).pathname === appPath; } catch (_) { return false; }
        }).map(function (reg) { return reg.unregister(); }));
      }));
    }
    if (window.caches && caches.keys) {
      jobs.push(caches.keys().then(function (keys) {
        return Promise.all(keys.filter(function (key) { return key.indexOf('fgsb-static-') === 0; }).map(function (key) { return caches.delete(key); }));
      }));
    }
    Promise.all(jobs).catch(function () {}).then(function () { location.reload(); });
  }

  window.addEventListener('error', function (event) {
    var target = event && event.target;
    if (target && target.tagName === 'SCRIPT' && target.type === 'module') {
      failedScript = target.src || 'Application JavaScript module';
      retryOnce();
    }
  }, true);

  window.addEventListener('securitypolicyviolation', function (event) {
    policyFailure = 'Browser security policy blocked ' + (event.blockedURI || 'an application resource') +
      ' (' + (event.violatedDirective || 'CSP') + ').';
  });

  window.addEventListener('load', function () {
    setTimeout(function () {
      if (!window.__fgsbBooted) retryOnce();
    }, 5000);
  });
})();
