/* Presenter mode (presentation only). Active only when the page URL has ?present=1.
   Adds: arrow-key navigation between a fixed list of existing pages, a progress marker, 125% type, a cursor that hides after 3 s idle.
   It makes no requests, reads and writes no storage, and does not touch any other script. */
(function () {
  if (new URLSearchParams(location.search).get('present') !== '1') return;
  var PAGES = ['/', '/signup', '/connect', '/dashboard'];
  var here = location.pathname.replace(/\/+$/, '') || '/';
  var i = PAGES.indexOf(here); if (i < 0) return;
  var root = document.documentElement; root.classList.add('present');

  var marker = document.createElement('div');
  marker.className = 'present-marker'; marker.setAttribute('role', 'status');
  marker.textContent = 'Presenter ' + (i + 1) + ' / ' + PAGES.length + ' · ← → to move · Esc to exit';
  document.body.appendChild(marker);

  function go(n) { if (n >= 0 && n < PAGES.length) location.href = PAGES[n] + '?present=1'; }
  function typing(el) { return el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable || el.getAttribute('role') === 'tab'); }
  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); go(i + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(i - 1); }
    else if (e.key === 'Escape') { location.href = here; }
  });

  var t; function wake() { root.classList.remove('present-idle'); clearTimeout(t); t = setTimeout(function () { root.classList.add('present-idle'); }, 3000); }
  document.addEventListener('mousemove', wake); wake();
})();
