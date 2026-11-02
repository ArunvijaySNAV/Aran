(function () {
  'use strict';
  var before = A.$('#demo-before'), after = A.$('#demo-after'), meta = A.$('#demo-meta'), btn = A.$('#demo-run');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var timer = null;

  function words(s) { return s.split(/(\s+|[,:;])/); }
  function paint(el, text, others, cls) {
    el.replaceChildren();
    words(text).forEach(function (w) {
      if (!w.trim() || /^[,:;]$/.test(w) || others.has(w)) el.appendChild(document.createTextNode(w));
      else el.appendChild(A.h('span', { class: cls }, w));
    });
  }
  function run() {
    clearInterval(timer);
    btn.disabled = true; btn.textContent = 'Running…';
    before.textContent = ''; after.textContent = ''; meta.textContent = '';
    before.appendChild(A.h('div', { class: 'skel', style: 'height:90px', 'aria-hidden': 'true' }));
    A.api('/v1/public/demo', { key: '' }).then(function (d) {
      var bw = new Set(words(d.before)), aw = new Set(words(d.after));
      paint(before, d.before, aw, 'raw');
      if (reduce) paint(after, d.after, bw, 'tok');
      else {
        after.textContent = '';
        var toks = words(d.after), i = 0;
        timer = setInterval(function () {
          i = Math.min(toks.length, i + 2);
          var part = toks.slice(0, i).join('');
          paint(after, part, bw, 'tok');
          if (i >= toks.length) clearInterval(timer);
        }, 45);
      }
      var prot = d.findings.filter(function (f) { return f.protected; }).length;
      meta.replaceChildren(
        A.h('span', { class: 'pill ok' }, prot + ' of ' + d.findings.length + ' values protected'),
        A.h('span', { class: 'pill' }, 'engine time ' + A.ms(d.latency_ms)),
        A.h('span', { class: 'pill' }, 'types: ' + d.findings.map(function (f) { return f.type; }).join(', '))
      );
    }).catch(function (e) {
      before.replaceChildren(); after.replaceChildren();
      var msg = e.status === 429 ? 'Demo limit reached. Try again in ' + (e.retryAfter || 'a few') + ' seconds.' : e.message;
      after.appendChild(A.h('div', { class: 'banner bad', role: 'alert' }, msg));
    }).then(function () { btn.disabled = false; btn.textContent = 'Run again'; });
  }
  btn.addEventListener('click', run);
  run();
})();
