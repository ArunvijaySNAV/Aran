/* Aran dashboard: hash-routed tabs over the real /v1 API. Every number comes from an API response. */
(function () {
  'use strict';
  var h = A.h, $ = A.$;
  var TABS = [
    ['overview', 'Overview', 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z'],
    ['flows', 'Data flows', 'M13 2L3 14h9l-1 8 10-12h-9l1-8z'],
    ['keys', 'API keys', 'M12.65 10A6 6 0 1 0 12.65 14H17v4h4v-4h2v-4H12.65zM7 14a2 2 0 1 1 0-4 2 2 0 0 1 0 4z'],
    ['trace', 'Trace', 'M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z'],
    ['receipts', 'Erasure & receipts', 'M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z'],
    ['audit', 'Audit', 'M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm2 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z'],
    ['playground', 'Playground', 'M8 5v14l11-7z']
  ];
  var PRESETS = {
    app: { label: 'App server', scopes: ['protect', 'gateway', 'trace'], help: 'Your backend: protect data, redact AI prompts, trace leaks. Cannot reveal or erase.' },
    compliance: { label: 'Compliance officer', scopes: ['detokenise', 'erase', 'verify', 'dashboard'], help: 'Reveal values (audited), erase customers, verify receipts, read the dashboard.' },
    readonly: { label: 'Read-only dashboard', scopes: ['dashboard'], help: 'See the dashboard, trace and verify receipts. Cannot protect, reveal or erase.' }
  };
  var ALL_SCOPES = ['protect', 'gateway', 'trace', 'detokenise', 'erase', 'verify', 'dashboard', 'admin'];
  var D = { dash: null, scopes: [] };
  var view = $('#view');

  // ------------------------------------------------------------ boot / auth
  function has(scope) { return D.scopes.indexOf('admin') >= 0 || D.scopes.indexOf(scope) >= 0; }
  function boot() {
    if (!A.getKey()) { $('#signin').hidden = false; $('#app').hidden = true; return; }
    $('#signin').hidden = true; $('#app').hidden = false;
    buildNav(); route();
    pollHealth(); setInterval(pollHealth, 15000);
  }
  $('#signin-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var k = $('#key').value.trim(), err = $('#key-err');
    if (!k) { err.textContent = 'Paste your API key.'; return; }
    err.textContent = '';
    A.api('/v1/dashboard', { key: k }).then(function () { A.setKey(k); boot(); }, function (ex) {
      err.textContent = ex.status === 401 ? 'That key was not accepted. Check it, or create a new workspace.'
        : ex.status === 403 ? 'This key has no dashboard scope. Use a dashboard or admin key.' : ex.message;
    });
  });
  $('#signout').addEventListener('click', function () { A.clearKey(); location.hash = ''; location.reload(); });

  function buildNav() {
    var nav = $('#nav'); nav.replaceChildren();
    TABS.forEach(function (t) {
      var a = h('a', { class: 'item', href: '#' + t[0], 'data-tab': t[0] });
      a.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="' + t[2] + '"/></svg>';
      a.appendChild(h('span', { text: t[1] }));
      nav.appendChild(a);
    });
  }
  function pollHealth() {
    A.api('/v1/health', { key: '' }).then(function (d) {
      $('#health').replaceChildren(h('span', { class: 'dot ' + (d.status === 'ok' ? 'ok' : 'bad'), 'aria-hidden': 'true' }),
        h('span', { class: 'small ' + (d.status === 'ok' ? 'muted' : ''), text: d.status === 'ok' ? 'Aran engine healthy' : 'Aran engine degraded' }));
    }, function () { $('#health').replaceChildren(h('span', { class: 'dot bad' }), h('span', { class: 'small', text: 'Cannot reach Aran' })); });
  }

  // ------------------------------------------------------------ router
  function route() {
    var tab = (location.hash || '#overview').slice(1).split('?')[0];
    if (!TABS.some(function (t) { return t[0] === tab; })) tab = 'overview';
    A.$$('#nav a').forEach(function (a) { if (a.getAttribute('data-tab') === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    var title = TABS.filter(function (t) { return t[0] === tab; })[0][1];
    $('#view-title').textContent = title; document.title = title + ': Aran Cloud';
    view.replaceChildren(A.skeleton(3));
    // always have fresh scopes/tenant before drawing
    A.api('/v1/dashboard').then(function (d) {
      D.dash = d; D.scopes = d.tenant.scopes || [];
      $('#ws-line').textContent = d.tenant.name + ' · ' + (d.tenant.plan || 'free') + ' plan · ' + A.num(d.metrics.requests_this_month) + ' of ' + A.num(d.metrics.plan_limit) + ' calls this month';
      view.replaceChildren(); VIEWS[tab](view);
    }, function (e) {
      if (e.status === 401) { A.clearKey(); location.hash = ''; location.reload(); return; }
      view.replaceChildren(e.status === 403
        ? h('div', { class: 'state error', role: 'alert' }, h('strong', { text: 'This key cannot open the dashboard' }), 'It needs the dashboard scope. Sign out and use a dashboard or admin key.')
        : A.errorState(e, route));
    });
  }
  window.addEventListener('hashchange', function () { route(); var t = $('#view-title'); if (t) t.focus(); });

  // ------------------------------------------------------------ helpers
  function card(title, body, extra) { return h('section', { class: 'card' + (extra ? ' ' + extra : '') }, title ? h('h3', { text: title }) : null, body); }
  function stat(label, value, sub, kind) { return h('div', { class: 'card stat' }, h('span', { class: 'v', text: value, style: kind === 'bad' ? 'color:var(--bad)' : '' }), h('span', { class: 'l', text: label }), sub ? h('span', { class: 'small muted', text: sub }) : null); }
  function table(cols, rows, opts) {
    opts = opts || {};
    var thead = h('thead', {}, h('tr', {}, cols.map(function (c) { return h('th', { class: c.num ? 'num' : '', scope: 'col', text: c.label }); })));
    var tbody = h('tbody');
    rows.forEach(function (r) {
      var tr = h('tr', opts.onrow ? { class: 'clickable', tabindex: '0', onclick: function () { opts.onrow(r, tr); }, onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); opts.onrow(r, tr); } } } : {});
      cols.forEach(function (c) {
        var v = c.render ? c.render(r) : r[c.key];
        tr.appendChild(h('td', { class: c.num ? 'num' : '' }, v instanceof Node ? v : String(v == null ? '–' : v)));
      });
      tbody.appendChild(tr);
    });
    return h('div', { class: 'table-wrap' }, h('table', { 'aria-label': opts.label || null }, thead, tbody));
  }
  function bars(items, max) {
    var box = h('div');
    var m = max || Math.max.apply(null, items.map(function (i) { return i.value; }).concat([1]));
    items.forEach(function (i) {
      box.appendChild(h('div', { class: 'hbar' }, h('span', { text: i.label, title: i.label, style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }),
        h('div', { class: 'track', 'aria-hidden': 'true' }, h('div', { class: 'fill', style: 'width:' + Math.max(2, Math.round(i.value / m * 100)) + '%' })),
        h('span', { class: 'mono', style: 'text-align:right', text: A.num(i.value) })));
    });
    return box;
  }
  function openDialog(content) {
    var dlg = $('#dlg'); $('#dlg-body').replaceChildren(content);
    if (!dlg.open) dlg.showModal();
    return dlg;
  }
  function closeDialog() { var d = $('#dlg'); if (d.open) d.close(); }
  function scopeChips(list) { return h('div', { class: 'scope-chips' }, (list || []).map(function (s) { return h('span', { class: 'pill' + (s === 'admin' ? ' accent' : ''), text: s }); })); }
  function noAccess(scope, what) {
    return h('div', { class: 'banner warn', role: 'note' }, h('span', {}, 'This key has no ', h('code', { text: scope }), ' scope, so you can see this but not ' + what + '. Sign in with an admin or compliance key.'));
  }

  // ------------------------------------------------------------ views
  var VIEWS = {};

  VIEWS.overview = function (el) {
    var m = D.dash.metrics, hourly = D.dash.hourly || [];
    if (!m.requests_this_month) {
      el.appendChild(h('div', { class: 'state' }, h('strong', { text: 'No events yet' }), 'Connect your app or try the Playground to see numbers appear here. ', h('a', { href: '/connect', text: 'Connect your app' }), ' · ', h('a', { href: '#playground', text: 'Open the playground' })));
      return;
    }
    var unprot = m.passed_unprotected;
    el.appendChild(h('div', { class: 'grid cols-4' },
      stat('Values protected', A.num(m.identifiers_protected), 'tokenised before storage'),
      stat('Left unprotected', A.num(unprot), unprot ? 'detected but passed through: investigate' : 'nothing slipped through', unprot ? 'bad' : ''),
      stat('Ignored: not valid IDs', A.num(m.not_valid_ids_ignored), 'looked like an ID, failed the checksum'),
      stat('API calls', A.num(m.requests_this_month), 'p50 ' + A.ms(m.p50_ms) + ' · p95 ' + A.ms(m.p95_ms))));
    if (unprot) el.appendChild(h('div', { class: 'banner bad', role: 'alert', style: 'margin-top:16px' }, h('span', {}, h('strong', { text: 'Unprotected values were seen. ' }), 'Aran detected sensitive data in ' + unprot + ' place(s) where it was not tokenised (for example a sink in monitor-only mode). Check Data flows.')));

    var maxP = Math.max.apply(null, hourly.map(function (b) { return b.protected; }).concat([1]));
    var total24 = hourly.reduce(function (s, b) { return s + b.protected; }, 0);
    var chart = h('div', { class: 'bars', role: 'img', 'aria-label': 'Values protected per hour over the last 24 hours, total ' + total24 });
    hourly.forEach(function (b) { chart.appendChild(h('div', { class: 'bar' + (b.protected ? '' : ' zero'), style: 'height:' + Math.max(2, Math.round(b.protected / maxP * 100)) + '%', title: new Date(b.hour_start * 1000).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) + ': ' + b.protected + ' protected, ' + b.requests + ' calls' })); });
    var det = h('details', { style: 'margin-top:8px' }, h('summary', { class: 'small', text: 'Show as table' }),
      table([{ label: 'Hour starting', render: function (r) { return new Date(r.hour_start * 1000).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } }, { label: 'Calls', key: 'requests', num: true }, { label: 'Protected', key: 'protected', num: true }, { label: 'Unprotected', key: 'unprotected', num: true }],
        hourly.filter(function (b) { return b.requests; }).reverse(), { label: 'Hourly activity' }));
    el.appendChild(h('div', { style: 'margin-top:16px' }, card('Last 24 hours: values protected per hour', h('div', {}, chart, h('div', { class: 'axis' }, h('span', { text: '24 h ago' }), h('span', { text: 'now' })), det))));

    var types = Object.keys(m.by_type || {}).map(function (k) { return { label: k, value: m.by_type[k] }; }).sort(function (a, b) { return b.value - a.value; });
    var sinks = (D.dash.sinks || []).map(function (s) { return { label: s.sink, value: s.protected }; }).sort(function (a, b) { return b.value - a.value; });
    el.appendChild(h('div', { class: 'grid cols-2', style: 'margin-top:16px' },
      card('By identifier type', types.length ? bars(types) : A.empty('Nothing protected yet')),
      card('By sink', sinks.length ? bars(sinks) : A.empty('No sinks yet'))));
    el.appendChild(h('p', { class: 'small muted', style: 'margin-top:16px', text: 'Latency is the engine time measured by Aran for each call. ' + D.dash.isolation }));
  };

  VIEWS.flows = function (el) {
    var sinks = D.dash.sinks || [];
    if (!sinks.length) { el.appendChild(h('div', { class: 'state' }, h('strong', { text: 'No data flows yet' }), 'A flow appears here the first time you call Aran with a sink name such as kyc-archive, log-platform, crm, loan-vendor or ai-gateway.')); return; }
    var drawer = h('div', { 'aria-live': 'polite' });
    el.appendChild(h('p', { class: 'muted small', text: 'One row per destination. Select a row to see recent redacted payloads sent there.' }));
    el.appendChild(table([
      { label: 'Sink', render: function (r) { return h('code', { text: r.sink }); } },
      { label: 'Calls', key: 'events', num: true },
      { label: 'Values protected', render: function (r) { return A.num(r.protected); }, num: true },
      { label: 'Unprotected', render: function (r) { return r.unprotected ? h('span', { class: 'pill bad', text: r.unprotected }) : h('span', { class: 'pill ok', text: '0' }); }, num: true },
      { label: 'Last event', render: function (r) { return A.when(r.last_at); } }
    ], sinks, { label: 'Data flows by sink', onrow: function (r) { openSamples(r.sink, drawer); } }));
    el.appendChild(drawer);
  };
  function openSamples(sink, drawer) {
    drawer.className = 'drawer';
    A.load(drawer, function () { return A.api('/v1/samples?sink=' + encodeURIComponent(sink)); }, function (d, box) {
      box.appendChild(h('h3', { text: 'Recent redacted payloads: ' + sink }));
      if (!d.samples.length) { box.appendChild(A.empty('No samples held', 'Samples are kept in memory only and only when nothing was left raw. Send an event to this sink, or the service restarted since.')); return; }
      d.samples.forEach(function (s) { box.appendChild(h('div', { style: 'margin-bottom:10px' }, h('div', { class: 'small muted', text: A.when(s.at) + ' · ' + s.protected + ' values protected' }), h('pre', { text: s.redacted, style: 'white-space:pre-wrap;word-break:break-word' }))); });
      box.appendChild(h('p', { class: 'small muted', text: d.note }));
    });
    drawer.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
  }

  // ---- API keys
  VIEWS.keys = function (el) {
    var canAdmin = D.scopes.indexOf('admin') >= 0;
    var listBox = h('div');
    if (!canAdmin) el.appendChild(noAccess('admin', 'create or revoke keys'));

    var form = h('form', { novalidate: true, class: 'stack' });
    var presetSel = h('div', { role: 'radiogroup', 'aria-label': 'Key preset', class: 'stack' });
    Object.keys(PRESETS).concat(['custom']).forEach(function (k, i) {
      var p = PRESETS[k];
      presetSel.appendChild(h('label', { class: 'check' }, h('input', { type: 'radio', name: 'preset', value: k, checked: i === 0, disabled: !canAdmin }),
        h('span', {}, h('strong', { text: p ? p.label : 'Custom' }), h('span', { class: 'hint', style: 'display:block', text: p ? p.help + ' (' + p.scopes.join(', ') + ')' : 'Pick scopes yourself.' }))));
    });
    var custom = h('div', { class: 'row', hidden: true, id: 'custom-scopes' }, ALL_SCOPES.filter(function (s) { return s !== 'admin'; }).map(function (s) { return h('label', { class: 'check', style: 'font-weight:500' }, h('input', { type: 'checkbox', value: s }), s); }));
    var label = h('input', { type: 'text', id: 'key-label', placeholder: 'e.g. Tessera Bank app server', maxlength: '60', disabled: !canAdmin });
    var err = h('div', { class: 'hint', role: 'alert', style: 'color:var(--bad)' });
    form.append(h('div', { class: 'field' }, h('label', { for: 'key-label', text: 'Label' }), label), presetSel, custom, err, h('button', { class: 'btn primary', type: 'submit', disabled: !canAdmin }, 'Create key'));
    form.addEventListener('change', function () { custom.hidden = form.elements.preset.value !== 'custom'; });
    form.addEventListener('submit', function (e) {
      e.preventDefault(); err.textContent = '';
      var p = form.elements.preset.value, scopes = p === 'custom' ? A.$$('input[type=checkbox]:checked', custom).map(function (c) { return c.value; }) : PRESETS[p].scopes;
      if (!label.value.trim()) { err.textContent = 'Give the key a label so you can recognise it later.'; label.focus(); return; }
      if (!scopes.length) { err.textContent = 'Pick at least one scope.'; return; }
      A.api('/v1/keys', { body: { label: label.value.trim(), scopes: scopes } }).then(function (k) {
        label.value = '';
        var box = h('div', { class: 'stack' }, h('h2', { id: 'dlg-title', style: 'font-size:1.2rem', text: 'Key created' }),
          h('div', { class: 'banner warn' }, 'Copy it now. It is shown once and stored only as a hash.'),
          h('div', { class: 'keybox' }, h('code', { id: 'newkey', text: k.api_key }), h('button', { class: 'btn sm', 'data-copy': 'newkey', type: 'button' }, 'Copy')),
          scopeChips(k.scopes), h('button', { class: 'btn primary', onclick: closeDialog }, 'Done'));
        openDialog(box); loadKeys();
      }, function (ex) { err.textContent = ex.status === 403 ? 'Only admin keys can create keys.' : ex.message; });
    });

    function loadKeys() {
      A.load(listBox, function () { return A.api('/v1/keys'); }, function (d, box) {
        if (!d.keys.length) { box.appendChild(A.empty('No keys')); return; }
        box.appendChild(table([
          { label: 'Prefix', render: function (r) { return h('code', { text: r.prefix + '…' }); } },
          { label: 'Label', key: 'label' },
          { label: 'Scopes', render: function (r) { return scopeChips(r.scopes); } },
          { label: 'Created', render: function (r) { return A.when(r.created_at); } },
          { label: 'Last used', render: function (r) { return A.when(r.last_used); } },
          { label: 'Status', render: function (r) { return h('span', { class: 'pill ' + (r.revoked ? 'bad' : 'ok'), text: r.revoked ? 'revoked' : 'active' }); } },
          { label: '', render: function (r) { return r.revoked || !canAdmin ? '' : h('button', { class: 'btn sm danger', onclick: function () { confirmRevoke(r); } }, 'Revoke'); } }
        ], d.keys, { label: 'API keys' }));
      });
    }
    function confirmRevoke(k) {
      var box = h('div', { class: 'stack' }, h('h2', { id: 'dlg-title', style: 'font-size:1.2rem', text: 'Revoke "' + k.label + '"?' }),
        h('p', { class: 'muted', text: 'Anything using ' + k.prefix + '… stops working immediately. This cannot be undone.' }),
        h('div', { class: 'row' }, h('button', { class: 'btn', onclick: closeDialog }, 'Cancel'), h('button', { class: 'btn danger', onclick: function () {
          A.api('/v1/keys/' + k.id, { method: 'DELETE' }).then(function () { closeDialog(); A.toast('Key revoked'); loadKeys(); }, function (ex) { A.toast(ex.message, 'bad'); });
        } }, 'Revoke key')));
      openDialog(box);
    }
    el.appendChild(h('div', { class: 'grid cols-2' }, card('Create a key', form), card('Keys in this workspace', listBox)));
    loadKeys();
  };

  // ---- Trace
  VIEWS.trace = function (el) {
    var ta = h('textarea', { id: 'dump', placeholder: 'Paste the leaked dump here. Aran looks for its own tokens in it.', 'aria-label': 'Leaked dump' });
    var out = h('div', { 'aria-live': 'polite', style: 'margin-top:16px' });
    var go = h('button', { class: 'btn primary', type: 'button' }, 'Trace this dump');
    var sample = h('button', { class: 'btn', type: 'button' }, 'Use my latest tokens as a sample');
    sample.addEventListener('click', function () {
      A.api('/v1/demo/sample-dump').then(function (d) {
        if (!d.token_count) A.toast('No tokens in this workspace yet. Protect something first.', 'bad'); else ta.value = d.sample;
      }, function (e) { A.toast(e.message, 'bad'); });
    });
    go.addEventListener('click', function () {
      if (!ta.value.trim()) { ta.focus(); A.toast('Paste a dump first', 'bad'); return; }
      go.disabled = true; out.replaceChildren(A.skeleton(1));
      A.api('/v1/trace', { body: { dump: ta.value } }).then(function (r) {
        out.replaceChildren();
        var head = r.matched ? h('div', { class: 'banner ok' }, h('span', {}, h('strong', { text: 'Source: ' + r.top.sink + '. ' }), r.matched + ' of ' + r.candidates + ' candidate values are tokens issued to this sink.'))
          : h('div', { class: 'banner' }, h('span', {}, r.candidates ? 'None of the ' + r.candidates + ' candidate values is a token issued by this workspace.' : 'No token-like values found in this text.'));
        out.appendChild(head);
        if (r.raw_identifiers_in_dump) out.appendChild(h('div', { class: 'banner bad', style: 'margin-top:12px', role: 'alert' }, h('span', {}, h('strong', { text: r.raw_identifiers_in_dump + ' raw identifier(s) ' }), 'in this dump were never tokenised.')));
        if (r.ranking.length) out.appendChild(h('div', { style: 'margin-top:12px' }, card('Which sink', bars(r.ranking.map(function (x) { return { label: x.sink, value: x.tokens }; })))));
        if (r.items.length) out.appendChild(h('div', { style: 'margin-top:12px' }, table([{ label: 'Value', render: function (i) { return h('code', { class: 'mono', text: i.value }); } }, { label: 'Sink', render: function (i) { return i.sink || 'not ours'; } }, { label: 'How', render: function (i) { return i.how || '–'; } }], r.items.slice(0, 100), { label: 'Candidates' })));
      }, function (e) { out.replaceChildren(A.errorState(e)); }).then(function () { go.disabled = false; });
    });
    el.appendChild(card('Trace a leaked dump', h('div', { class: 'stack' }, h('p', { class: 'muted small', text: 'Each destination gets different tokens for the same value, so a leaked set of tokens identifies the sink it came from. Only tokens issued to your workspace are matched.' }), ta, h('div', { class: 'row' }, go, sample)), ''));
    el.appendChild(out);
  };

  // ---- Receipts
  VIEWS.receipts = function (el) {
    var recs = D.dash.receipts || [];
    var canErase = has('erase');
    var form = h('form', { class: 'stack', novalidate: true });
    var ref = h('input', { type: 'text', id: 'er-ref', placeholder: 'CUS-000123', maxlength: '64', disabled: !canErase });
    var purpose = h('select', { id: 'er-pur', disabled: !canErase }, ['KYC', 'Loans', 'Service', 'Marketing'].map(function (p) { return h('option', { value: p, text: p }); }));
    var er = h('div', { class: 'hint', role: 'alert', style: 'color:var(--bad)' });
    form.append(h('div', { class: 'field' }, h('label', { for: 'er-ref', text: 'Customer reference' }), ref), h('div', { class: 'field' }, h('label', { for: 'er-pur', text: 'Purpose to erase' }), purpose), er,
      h('button', { class: 'btn danger', type: 'submit', disabled: !canErase }, 'Erase…'));
    form.addEventListener('submit', function (e) {
      e.preventDefault(); er.textContent = '';
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(ref.value.trim())) { er.textContent = 'Use letters, numbers, dashes or underscores (up to 64).'; ref.focus(); return; }
      var cust = ref.value.trim(), pur = purpose.value;
      openDialog(h('div', { class: 'stack' }, h('h2', { id: 'dlg-title', style: 'font-size:1.2rem', text: 'Erase ' + cust + ' for ' + pur + '?' }),
        h('p', { class: 'muted', text: 'This destroys the key. Every token of this customer for this purpose becomes permanently unreadable. It cannot be undone.' }),
        h('div', { class: 'row' }, h('button', { class: 'btn', onclick: closeDialog }, 'Cancel'), h('button', { class: 'btn danger', onclick: function () {
          A.api('/v1/erase', { body: { customer_ref: cust, purpose: pur } }).then(function () { closeDialog(); A.toast('Erased. Receipt issued.'); ref.value = ''; route(); }, function (ex) {
            closeDialog(); er.textContent = ex.status === 403 ? 'This key cannot erase.' : ex.message.indexOf('no such') >= 0 ? 'No such customer or purpose in this workspace.' : ex.message;
          });
        } }, 'Erase permanently'))));
    });

    var listBox = h('div');
    if (!recs.length) listBox.appendChild(A.empty('No erasures yet', 'When a customer is erased, a signed receipt appears here that anyone can verify.'));
    else listBox.appendChild(table([
      { label: 'Customer', key: 'customer_ref' }, { label: 'Purpose', key: 'purpose' }, { label: 'When', render: function (r) { return A.when(r.at); } },
      { label: 'Signature', render: function (r) { return h('span', { class: 'pill', text: r.alg }); } },
      { label: '', render: function (r) {
        var res = h('div', { 'aria-live': 'polite', class: 'small', style: 'margin-top:6px' });
        var vb = h('button', { class: 'btn sm', onclick: function () {
          vb.disabled = true; res.textContent = 'Verifying…';
          A.api('/v1/receipts/verify', { body: r.raw_receipt }).then(function (v) {
            res.replaceChildren(h('span', { class: 'pill ' + (v.valid ? 'ok' : 'bad'), text: v.valid ? 'Valid' : 'Invalid' }), ' ' + (v.valid ? 'Ed25519 signature ✓ · ' + (v.post_quantum_valid ? 'ML-DSA-65 ✓ · ' : '') + 'in Merkle log ✓' : (v.error || 'signature or log check failed')));
          }, function (e) { res.textContent = e.message; }).then(function () { vb.disabled = false; });
        } }, 'Verify');
        var dl = h('button', { class: 'btn sm', onclick: function () {
          var blob = new Blob([JSON.stringify(r.raw_receipt, null, 2)], { type: 'application/json' });
          var a = h('a', { href: URL.createObjectURL(blob), download: 'aran-receipt-' + r.customer_ref + '-' + r.purpose + '.json' }); document.body.appendChild(a); a.click(); a.remove();
        } }, 'Download JSON');
        return h('div', {}, h('div', { class: 'row' }, vb, dl), res);
      } }
    ], recs, { label: 'Erasure receipts' }));

    el.appendChild(h('div', { class: 'grid cols-2' }, card('Erase a customer', h('div', { class: 'stack' }, canErase ? null : noAccess('erase', 'erase customers'), form)), card('Receipts', listBox)));
  };

  // ---- Audit
  VIEWS.audit = function (el) {
    var result = h('div', { 'aria-live': 'polite', style: 'margin-bottom:12px' });
    var vb = h('button', { class: 'btn primary', type: 'button' }, 'Verify chain');
    vb.addEventListener('click', function () {
      vb.disabled = true; result.replaceChildren(A.skeleton(1));
      A.api('/v1/audit/verify').then(function (v) {
        result.replaceChildren(h('div', { class: 'banner ' + (v.valid ? 'ok' : 'bad'), role: v.valid ? 'status' : 'alert' }, h('span', {}, v.valid ? h('span', {}, h('strong', { text: 'Chain intact. ' }), v.total_rows + ' entries, head ' + v.latest_hash.slice(0, 16) + '…') : h('span', {}, h('strong', { text: 'Chain broken. ' }), v.error))));
      }, function (e) { result.replaceChildren(A.errorState(e)); }).then(function () { vb.disabled = false; });
    });
    var box = h('div');
    el.appendChild(h('div', { class: 'row between', style: 'margin-bottom:12px' }, h('p', { class: 'muted small', style: 'margin:0;max-width:640px', text: 'Every reveal attempt, including refusals and unknown tokens, in a hash chain. Any edit or deletion makes verification fail.' }), vb));
    el.appendChild(result); el.appendChild(box);
    A.load(box, function () { return A.api('/v1/audit'); }, function (d, b) {
      if (!d.audit.length) { b.appendChild(A.empty('No reveals yet', 'When a key with the detokenise scope reveals a value, it is logged here.')); return; }
      var kind = { ok: 'ok', erased: 'warn', unknown: '', denied: 'bad' };
      b.appendChild(table([
        { label: 'When', render: function (r) { return A.when(r.at); } }, { label: 'Key', render: function (r) { return r.key_label || ('#' + r.key_id); } },
        { label: 'Token', render: function (r) { return h('code', { text: r.token.length > 24 ? r.token.slice(0, 24) + '…' : r.token }); } },
        { label: 'Purpose', key: 'purpose' }, { label: 'Result', render: function (r) { return h('span', { class: 'pill ' + (kind[r.result] || ''), text: r.result }); } },
        { label: 'Entry hash', render: function (r) { return h('code', { text: (r.entry_hash || '').slice(0, 12) + '…' }); } }
      ], d.audit, { label: 'Reveal audit log' }));
    });
  };

  // ---- Playground
  VIEWS.playground = function (el) {
    var ta = h('textarea', { id: 'pg', placeholder: 'Paste text that contains an Aadhaar, card, mobile, PAN, UPI or name.', 'aria-label': 'Text to protect', maxlength: '4000' });
    var out = h('div', { 'aria-live': 'polite', style: 'margin-top:16px' });
    var go = h('button', { class: 'btn primary', type: 'button' }, 'Protect this text');
    var sample = h('button', { class: 'btn', type: 'button' }, 'Insert a generated sample');
    sample.addEventListener('click', function () { A.api('/v1/public/demo', { key: '' }).then(function (d) { ta.value = d.before; }, function (e) { A.toast(e.message, 'bad'); }); });
    go.addEventListener('click', function () {
      if (!ta.value.trim()) { ta.focus(); A.toast('Paste some text first', 'bad'); return; }
      go.disabled = true; out.replaceChildren(A.skeleton(1));
      A.api('/v1/playground', { body: { text: ta.value } }).then(function (r) {
        out.replaceChildren();
        var after = h('pre', { style: 'white-space:pre-wrap;word-break:break-word' });
        var toks = r.findings.filter(function (f) { return f.protected && f.token; }).map(function (f) { return f.token; });
        var rest = r.after;
        if (toks.length) {
          var rx = new RegExp('(' + toks.map(function (t) { return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|') + ')', 'g');
          r.after.split(rx).forEach(function (part) { after.appendChild(toks.indexOf(part) >= 0 ? h('span', { class: 'tok', text: part }) : document.createTextNode(part)); });
        } else after.textContent = rest;
        out.appendChild(card('Redacted output', after));
        out.appendChild(h('div', { class: 'row small muted', style: 'margin:8px 0' }, h('span', { class: 'pill', text: 'engine ' + A.ms(r.latency_ms) }), h('span', { text: 'Playground tokens are not stored for reveal: nothing reversible is kept.' })));
        if (r.findings.length) out.appendChild(table([{ label: 'Type', key: 'type' }, { label: 'Result', render: function (f) { return h('span', { class: 'pill ' + (f.protected ? 'ok' : 'bad'), text: f.protected ? 'protected' : 'NOT protected' }); } }, { label: 'Confidence', render: function (f) { return (f.p * 100).toFixed(1) + '%'; }, num: true }], r.findings, { label: 'Findings' }));
        else out.appendChild(h('div', { class: 'banner' }, 'No sensitive values found in this text.'));
        r.notes.forEach(function (n) { out.appendChild(h('div', { class: 'banner', style: 'margin-top:8px' }, n)); });
      }, function (e) { out.replaceChildren(e.status === 429 ? h('div', { class: 'banner bad', role: 'alert' }, 'Rate limit reached. Try again in ' + (e.retryAfter || 'a moment') + ' seconds.') : A.errorState(e)); }).then(function () { go.disabled = false; });
    });
    el.appendChild(card('Try it', h('div', { class: 'stack' }, ta, h('div', { class: 'row' }, go, sample))));
    el.appendChild(out);
  };

  boot();
})();
