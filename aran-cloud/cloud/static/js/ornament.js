/* Presentation only: draws the guilloche rosette and the sine-interlace band (DESIGN.md section 5). No network, no storage. */
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  function gcd(a, b) { return b ? gcd(b, a % b) : a; }
  function rosette(svg, R, r, d, copies) {
    var turns = r / gcd(R, r), path = '';
    for (var i = 0; i <= 720; i++) {
      var t = (i / 720) * Math.PI * 2 * turns;
      var x = (R - r) * Math.cos(t) + d * Math.cos(((R - r) / r) * t), y = (R - r) * Math.sin(t) - d * Math.sin(((R - r) / r) * t);
      path += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
    }
    for (var k = 0; k < copies; k++) { var p = document.createElementNS(NS, 'path'); p.setAttribute('d', path); p.setAttribute('transform', 'rotate(' + (360 / copies) * k + ')'); svg.appendChild(p); }
  }
  function band(svg) {
    for (var k = 0; k < 5; k++) { var d = ''; for (var x = 0; x <= 600; x += 4) d += (x ? 'L' : 'M') + x + ' ' + (17 + 11 * Math.sin((x / 600) * Math.PI * 6 + k * 0.9)).toFixed(1); var p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); svg.appendChild(p); }
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-rosette]'), function (s) { if (!s.firstChild) rosette(s, 220, 71, 150, 10); });
  Array.prototype.forEach.call(document.querySelectorAll('[data-band]'), function (s) { if (!s.firstChild) band(s); });
})();
