/* Landing illustrations (presentation only, no network): the checksum flip, the sink table, the erase scene, the code tabs.
 * Everything here is drawn in the browser from SAMPLE numbers and says so on screen. The real call is the flight section (landing.js). */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------------------------------------------------------------- Verhoeff
  var D = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
  var P = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
  var INV = [0,4,3,2,1,5,6,7,8,9];
  function verhoeffValid(s) { if (!/^\d{12}$/.test(s)) return false; var c = 0, d = s.split('').reverse(); for (var i = 0; i < d.length; i++) c = D[c][P[i % 8][+d[i]]]; return c === 0; }
  function verhoeffCheck(body) { var c = 0, d = body.split('').reverse(); for (var i = 0; i < d.length; i++) c = D[c][P[(i + 1) % 8][+d[i]]]; return String(INV[c]); }
  function rnd(n) { return Math.floor(Math.random() * n); }
  function sampleAadhaar() { var b = String(2 + rnd(8)); for (var i = 0; i < 10; i++) b += rnd(10); return b + verhoeffCheck(b); }
  // an illustration token: 12 digits that can never pass the checksum (the property Aran's real Aadhaar tokens have)
  function seeded(seed) { var h = 2166136261; for (var i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); } return function () { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return (h >>> 0) / 4294967296; }; }
  function illustrationToken(number, sink) {
    var r = seeded(number + '|' + sink), t;
    do { t = ''; for (var i = 0; i < 12; i++) t += Math.floor(r() * 10); } while (verhoeffValid(t));
    return t;
  }
  var group = function (s) { return s.replace(/(\d{4})(?=\d)/g, '$1 '); };

  // ---------------------------------------------------------------- guilloche rosette (hypotrochoid, 10 rotated copies)
  function rosette(svg, R, r, d, copies) {
    function gcd(a, b) { return b ? gcd(b, a % b) : a; }
    var turns = r / gcd(R, r), path = '';
    for (var i = 0; i <= 720; i++) {
      var t = (i / 720) * Math.PI * 2 * turns;
      var x = (R - r) * Math.cos(t) + d * Math.cos(((R - r) / r) * t), y = (R - r) * Math.sin(t) - d * Math.sin(((R - r) / r) * t);
      path += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
    }
    var NS = 'http://www.w3.org/2000/svg';
    for (var k = 0; k < copies; k++) { var p = document.createElementNS(NS, 'path'); p.setAttribute('d', path); p.setAttribute('transform', 'rotate(' + (360 / copies) * k + ')'); svg.appendChild(p); }
  }
  $$('[data-rosette]').forEach(function (s) { rosette(s, 220, 71, 150, 10); });
  function band(svg) {
    var NS = 'http://www.w3.org/2000/svg';
    for (var k = 0; k < 5; k++) { var d = ''; for (var x = 0; x <= 600; x += 4) d += (x ? 'L' : 'M') + x + ' ' + (17 + 11 * Math.sin((x / 600) * Math.PI * 6 + k * 0.9)).toFixed(1); var p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); svg.appendChild(p); }
  }
  $$('[data-band]').forEach(band);

  // ---------------------------------------------------------------- 1. the checksum flip
  var plate = $('#plate');
  if (plate) {
    var input = $('#digits'), verdict = $('#verdict'), sinkRow = $('#sinks'), protectBtn = $('#protectBtn'), newBtn = $('#newBtn'), label = $('#plateLabel'), sinkName = $('#plateSink');
    var state = { raw: '', protected: false, sink: 'kyc-archive', timer: null };

    function stamp(kind, text) {
      var good = kind === 'good';
      verdict.className = 'stamp ' + (good ? 'good' : kind === 'bad' ? 'bad' : 'plain');
      verdict.innerHTML = (kind === 'plain' ? '' : '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">' + (good ? '<path d="M2.5 8.5l3.5 3.5 7.5-8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>' : '<path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>') + '</svg>') + '<span></span>';
      verdict.querySelector('span').textContent = text;
    }
    function showRaw() {
      state.protected = false; plate.classList.remove('protected'); plate.classList.remove('rolling');
      label.textContent = 'What your app receives'; sinkName.textContent = '';
      var digits = input.value.replace(/\D/g, '');
      state.raw = digits;
      if (digits.length === 12 && verhoeffValid(digits)) { stamp('bad', 'Passes the Verhoeff checksum: a usable Aadhaar'); protectBtn.disabled = false; }
      else if (digits.length === 12) { stamp('plain', 'Not a valid Aadhaar: the last digit is a checksum'); protectBtn.disabled = true; }
      else { stamp('plain', 'Type 12 digits, or press Try another'); protectBtn.disabled = true; }
      sinkRow.setAttribute('aria-hidden', 'true'); $$('button', sinkRow).forEach(function (b) { b.disabled = true; b.tabIndex = -1; });
    }
    function setNumber(s) { input.value = group(s); showRaw(); }
    function roll(to, done) {
      clearInterval(state.timer);
      if (reduce) { input.value = group(to); done(); return; }
      var t0 = Date.now(), total = 900;
      state.timer = setInterval(function () {
        var p = (Date.now() - t0) / total, out = '';
        for (var i = 0; i < 12; i++) out += (p >= (i + 1) / 13) ? to[i] : String(rnd(10));
        input.value = group(out);
        if (p >= 1) { clearInterval(state.timer); input.value = group(to); done(); }
      }, 40);
    }
    function protect(sink) {
      state.sink = sink; var tok = illustrationToken(state.raw, sink);
      plate.classList.add('rolling'); protectBtn.disabled = true; input.readOnly = true;
      roll(tok, function () {
        plate.classList.remove('rolling'); plate.classList.add('protected'); state.protected = true; input.readOnly = false;
        label.textContent = 'What your database holds'; sinkName.textContent = sink;
        stamp('good', 'Fails the Verhoeff checksum: cannot be an Aadhaar');
        sinkRow.removeAttribute('aria-hidden'); $$('button', sinkRow).forEach(function (b) { b.disabled = false; b.tabIndex = 0; b.setAttribute('aria-pressed', b.getAttribute('data-s') === sink); });
        protectBtn.disabled = true;
        var cur = $('button[aria-pressed=true]', sinkRow); if (cur) cur.focus();
      });
    }
    input.addEventListener('focus', function () { input.select(); });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); protectBtn.click(); } });
    input.addEventListener('input', function () { if (state.protected) { state.protected = false; } showRaw(); });
    protectBtn.addEventListener('click', function () { if (!state.protected && state.raw.length === 12 && verhoeffValid(state.raw)) protect(state.sink); });
    newBtn.addEventListener('click', function () { clearInterval(state.timer); input.readOnly = false; state.sink = 'kyc-archive'; $$('button', sinkRow).forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-s') === 'kyc-archive'); }); setNumber(sampleAadhaar()); });
    $$('button', sinkRow).forEach(function (b) {
      b.addEventListener('click', function () {
        if (!state.protected) return;
        var s = b.getAttribute('data-s'); if (s === state.sink) return;
        $$('button', sinkRow).forEach(function (o) { o.setAttribute('aria-pressed', o === b); });
        protect(s);
      });
    });
    $$('button', sinkRow).forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-s') === 'kyc-archive'); });
    setNumber(sampleAadhaar());
  }

  // ---------------------------------------------------------------- 4. same person, different tokens (illustration)
  var ptab = $('#tokens-body');
  if (ptab) {
    var shared = sampleAadhaar(), sinks = ['kyc-archive', 'crm', 'loan-vendor', 'log-platform'];
    $('#tokens-real').textContent = group(shared);
    sinks.forEach(function (s) {
      var tr = document.createElement('tr'), a = document.createElement('td'), b = document.createElement('td'), pill = document.createElement('span'), chip = document.createElement('code');
      pill.className = 'pill'; pill.textContent = s; a.appendChild(pill);
      chip.className = 'tokchip'; chip.textContent = group(illustrationToken(shared, s)); b.className = 'num'; b.appendChild(chip);
      tr.appendChild(a); tr.appendChild(b); ptab.appendChild(tr);
    });
  }

  // ---------------------------------------------------------------- 3. erase and certificate (illustration)
  var erase = $('#erase');
  if (erase) {
    var btn = $('#shredBtn'), cert = $('#cert'), rows = $$('.tk', erase), status = $('#shredStatus');
    var tokens = ['kyc-archive', 'crm', 'loan-vendor', 'log-platform'].map(function (s) { return group(illustrationToken('sample-erase', s)); });
    rows.forEach(function (r, i) { r.textContent = tokens[i]; });
    function reset() { rows.forEach(function (r, i) { r.classList.remove('gone'); r.textContent = tokens[i]; }); cert.classList.remove('stamped', 'shake'); btn.disabled = false; btn.textContent = 'Crypto-shred purpose key'; status.textContent = ''; }
    function finish() { cert.classList.add('stamped'); if (!reduce) { cert.classList.add('shake'); setTimeout(function () { cert.classList.remove('shake'); }, 420); } status.textContent = 'All 4 sample tokens are now unreadable.'; btn.disabled = false; btn.textContent = 'Replay'; btn.setAttribute('data-done', '1'); }
    btn.addEventListener('click', function () {
      if (btn.getAttribute('data-done')) { btn.removeAttribute('data-done'); reset(); return; }
      btn.disabled = true; status.textContent = 'Shredding the sample key…';
      rows.forEach(function (r, i) { setTimeout(function () { r.classList.add('gone'); r.textContent = 'unreadable'; }, reduce ? 0 : i * 240); });
      setTimeout(finish, reduce ? 0 : rows.length * 240 + 500);
    });
  }

  // ---------------------------------------------------------------- 2. the flight overlay (reads the DOM that landing.js already painted; no network)
  var fBefore = $('#demo-before'), fAfter = $('#demo-after'), fMeta = $('#demo-meta'), gate = $('.boundary .gate');
  if (fBefore && fAfter && fMeta) {
    var running = false;
    function fly() {
      if (reduce || running || window.innerWidth < 640) return;
      var raws = $$('.raw', fBefore), toks = $$('.tok', fAfter);
      if (!raws.length || !toks.length) return;
      running = true; var boundaryX = (gate || fAfter).getBoundingClientRect(); var done = 0;
      raws.forEach(function (r, i) {
        var a = r.getBoundingClientRect(), t = toks[Math.min(i, toks.length - 1)].getBoundingClientRect();
        var chip = document.createElement('span'); chip.className = 'flychip'; chip.textContent = r.textContent; chip.setAttribute('aria-hidden', 'true');
        chip.style.left = '0px'; chip.style.top = '0px'; document.body.appendChild(chip);
        var sx = a.left + scrollX, sy = a.top + scrollY, mx = boundaryX.left + scrollX + 11, my = (a.top + t.top) / 2 + scrollY - 40, tx = t.left + scrollX, ty = t.top + scrollY;
        var flipAt = Math.max(0.35, Math.min(0.65, (mx - sx) / Math.max(1, tx - sx)));
        var anim = chip.animate([
          { transform: 'translate(' + sx + 'px,' + sy + 'px)', offset: 0 },
          { transform: 'translate(' + mx + 'px,' + my + 'px)', offset: flipAt },
          { transform: 'translate(' + tx + 'px,' + ty + 'px)', offset: 1 }
        ], { duration: 1100, delay: i * 140, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'both' });
        setTimeout(function () { chip.classList.add('tokenised'); if (gate) { gate.classList.remove('pulse'); void gate.offsetWidth; gate.classList.add('pulse'); } }, 1100 * flipAt + i * 140);
        anim.onfinish = function () { chip.remove(); if (++done === raws.length) running = false; };
      });
    }
    // run the flight once the token text has finished arriving (the token count stops changing)
    var settle = null, last = -1;
    new MutationObserver(function () {
      clearTimeout(settle);
      settle = setTimeout(function () { var n = $$('.tok', fAfter).length; if (n && n === last) return; last = n; if (n) fly(); }, 450);
    }).observe(fAfter, { childList: true, subtree: true });
    $('#demo-run') && $('#demo-run').addEventListener('click', function () { last = -1; });
  }

  // ---------------------------------------------------------------- code tabs
  var tabs = $$('[data-codetab]');
  tabs.forEach(function (t, i) { t.tabIndex = i === 0 ? 0 : -1; t.addEventListener('keydown', function (e) { if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); var h = e.key === 'Home' ? tabs[0] : tabs[tabs.length - 1]; h.focus(); h.click(); return; } var k = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (k) { var n = tabs[(i + k + tabs.length) % tabs.length]; n.focus(); n.click(); } }); });
  tabs.forEach(function (t) {
    t.addEventListener('click', function () {
      tabs.forEach(function (o) { o.setAttribute('aria-selected', o === t); });
      $$('[data-codepane]').forEach(function (p) { p.hidden = p.getAttribute('data-codepane') !== t.getAttribute('data-codetab'); });
      $('[data-copy-code]').setAttribute('data-copy', 'snip-' + t.getAttribute('data-codetab'));
      $$('[data-codetab]').forEach(function (o) { o.tabIndex = o === t ? 0 : -1; });
    });
  });
})();
