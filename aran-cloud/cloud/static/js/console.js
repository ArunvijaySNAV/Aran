/* Aran console helpers: theme, key storage, API calls, small DOM utilities. No dependencies. */
(function () {
  'use strict';
  var A = (window.A = {});

  // ---- theme
  function applyTheme(t) {
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
  }
  A.theme = function () { try { return localStorage.getItem('aran_theme') || ''; } catch (e) { return ''; } };
  applyTheme(A.theme());
  A.toggleTheme = function () {
    var cur = document.documentElement.getAttribute('data-theme') ||
      (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    var next = cur === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try { localStorage.setItem('aran_theme', next); } catch (e) {}
    document.querySelectorAll('[data-theme-btn]').forEach(function (b) { b.setAttribute('aria-pressed', next === 'dark'); });
  };
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-theme-btn]');
    if (b) A.toggleTheme();
  });

  // ---- key storage (sessionStorage only; never in URLs)
  A.getKey = function () { try { return sessionStorage.getItem('aran_key') || ''; } catch (e) { return ''; } };
  A.setKey = function (k) { try { sessionStorage.setItem('aran_key', k); } catch (e) {} };
  A.clearKey = function () { try { sessionStorage.removeItem('aran_key'); } catch (e) {} };

  // ---- DOM
  A.esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); };
  A.$ = function (sel, root) { return (root || document).querySelector(sel); };
  A.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  A.h = function (tag, attrs) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (k === 'class') el.className = v; else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
    });
    function add(c) {
      if (c == null || c === false) return;
      if (Array.isArray(c)) { c.forEach(add); return; }
      el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    }
    for (var i = 2; i < arguments.length; i++) add(arguments[i]);
    return el;
  };

  // ---- formatting
  A.num = function (n) { return n == null ? '–' : Number(n).toLocaleString('en-IN'); };
  A.ms = function (n) { return n == null ? '–' : (Number(n) < 10 ? Number(n).toFixed(2) : Number(n).toFixed(1)) + ' ms'; };
  A.when = function (ts) {
    if (!ts) return '–';
    var d = new Date(typeof ts === 'number' ? ts * 1000 : String(ts).replace(' ', 'T') + 'Z');
    if (isNaN(d)) return String(ts);
    var diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + ' min ago';
    if (diff < 86400) return Math.floor(diff / 3600) + ' h ago';
    return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  };

  // ---- toasts
  A.toast = function (msg, kind) {
    var box = A.$('.toasts');
    if (!box) { box = A.h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.appendChild(box); }
    var t = A.h('div', { class: 'toast' + (kind === 'bad' ? ' bad' : '') }, msg);
    box.appendChild(t);
    setTimeout(function () { t.remove(); }, kind === 'bad' ? 6000 : 3200);
  };

  // ---- clipboard
  A.copy = function (text, btn) {
    function done() { A.toast('Copied'); if (btn) { var o = btn.textContent; btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = o; }, 1400); } }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, fail); else fail();
    function fail() {
      var ta = A.h('textarea', { style: 'position:fixed;opacity:0' }); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { A.toast('Copy failed: select the text and copy it', 'bad'); }
      ta.remove();
    }
  };
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-copy]');
    if (!b) return;
    var src = b.getAttribute('data-copy');
    var el = src && document.getElementById(src);
    A.copy(el ? el.textContent : src, b);
  });

  // ---- API
  A.api = function (path, opts) {
    opts = opts || {};
    var key = opts.key !== undefined ? opts.key : A.getKey();
    var headers = { Accept: 'application/json' };
    if (key) headers['X-API-Key'] = key;
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    return fetch(path, { method: opts.method || (opts.body !== undefined ? 'POST' : 'GET'), headers: headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined })
      .then(function (res) {
        return res.text().then(function (t) {
          var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) { j = { detail: t.slice(0, 200) }; }
          if (!res.ok) {
            var d = j && j.detail;
            var err = new Error(typeof d === 'string' ? d : 'Request failed (' + res.status + ')');
            err.status = res.status; err.retryAfter = res.headers.get('Retry-After'); throw err;
          }
          return j;
        });
      }, function () { var e = new Error('Cannot reach Aran Cloud. Check your connection.'); e.status = 0; throw e; });
  };

  // ---- view states
  A.skeleton = function (n) { var f = document.createDocumentFragment(); for (var i = 0; i < (n || 3); i++) f.appendChild(A.h('div', { class: 'skel block', 'aria-hidden': 'true', style: 'margin-bottom:12px' })); return f; };
  A.empty = function (title, text) { return A.h('div', { class: 'state' }, A.h('strong', { text: title }), text || ''); };
  A.errorState = function (err, retry) {
    var d = A.h('div', { class: 'state error', role: 'alert' }, A.h('strong', { text: 'Could not load this' }), err.message || String(err));
    if (retry) { d.appendChild(document.createElement('br')); d.appendChild(A.h('button', { class: 'btn sm', style: 'margin-top:12px', onclick: retry }, 'Try again')); }
    return d;
  };
  /** Load into `el`: skeleton, then render(data) or an error state with retry. */
  A.load = function (el, loader, render) {
    function go() {
      el.setAttribute('aria-busy', 'true'); el.replaceChildren(A.skeleton(2));
      return loader().then(function (d) { el.replaceChildren(); render(d, el); }, function (e) {
        if (e.status === 401) { A.clearKey(); location.hash = ''; location.reload(); return; }
        el.replaceChildren(A.errorState(e, go));
      }).then(function () { el.removeAttribute('aria-busy'); });
    }
    return go();
  };

  // ---- sample snippets shared by connect + docs (placeholders only: the real key is shown once at signup)
  A.snippets = function (baseUrl) {
    return {
      ts: "import { Aran } from '@aran/sdk';\n\nconst aran = new Aran({ apiKey: process.env.ARAN_APP_KEY!, baseUrl: '" + baseUrl + "' });\n\n// in a server action / route handler (never in the browser)\nconst tokens = await aran.protectFields({\n  fields: { name, mobile, aadhaar, pan },\n  customerRef: 'CUS-000123', purpose: 'KYC', sink: 'kyc-archive',\n}); // throws if anything is left unprotected: write nothing\nawait db.insert(customers).values({ customerRef: 'CUS-000123', ...tokens });",
      py: "import os, requests\n\nr = requests.post('" + baseUrl + "/v1/protect',\n    headers={'X-API-Key': os.environ['ARAN_APP_KEY']},\n    json={'text': f'Aadhaar {aadhaar}, mobile {mobile}', 'customer_ref': 'CUS-000123',\n          'purpose': 'KYC', 'sink': 'kyc-archive'}, timeout=4)\nr.raise_for_status()          # fail closed: store nothing if this raises\nsafe_text = r.json()['after']  # tokens, not the original values",
      curl: "curl -sS -X POST " + baseUrl + "/v1/protect \\\n  -H \"X-API-Key: $ARAN_APP_KEY\" -H 'Content-Type: application/json' \\\n  -d '{\"text\":\"Aadhaar 341777631706\",\"customer_ref\":\"CUS-000123\",\"purpose\":\"KYC\",\"sink\":\"kyc-archive\"}'"
    };
  };
})();
