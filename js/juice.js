'use strict';

/** Juice layer: non-invasive visual feedback on top of the Angular game.
 *  Reads live state from window.PC (exposed by app.js). Never mutates game
 *  logic — it only owns the stat-value spans and spawns transient FX nodes.
 */
(function () {
  var PC = window.PC;
  if (!PC) { return; }
  var fmt = Helpers.formatNumberPostfix;

  /* ---------------------------------------------------------------- *
   *  Count-up: ease the displayed stat numbers toward their target.  *
   * ---------------------------------------------------------------- */
  var fields = [
    { id: 'val-data',       prefix: '',    get: function () { return PC.lab.state.data; } },
    { id: 'val-reputation', prefix: '',    get: function () { return PC.lab.state.reputation; } },
    { id: 'val-funding',    prefix: 'CHF ', get: function () { return PC.lab.state.money; } }
  ];
  var disp = {};

  function tickStats() {
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      var el = document.getElementById(f.id);
      if (!el) { continue; }
      var target = f.get();
      if (!(f.id in disp)) { disp[f.id] = target; }
      var cur = disp[f.id];
      var diff = target - cur;
      if (Math.abs(diff) < 0.5) {
        cur = target;
      } else {
        cur += diff * 0.16;            // exponential ease toward target
        el.classList.add('is-counting');
      }
      if (cur === target) { el.classList.remove('is-counting'); }
      disp[f.id] = cur;
      el.textContent = f.prefix + fmt(Math.round(cur));
    }
  }

  /* ---------------------------------------------------------------- *
   *  Affordability: fill disabled buy buttons by have/cost ratio.    *
   * ---------------------------------------------------------------- */
  function tickAfford() {
    var btns = document.querySelectorAll('.afford-btn');
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      var cost = parseFloat(b.getAttribute('data-cost'));
      if (!cost || cost <= 0) { b.style.setProperty('--p', '1'); continue; }
      var have = b.getAttribute('data-res') === 'data'
        ? PC.lab.state.data
        : PC.lab.state.money;
      var p = Math.max(0, Math.min(1, have / cost));
      b.style.setProperty('--p', p.toFixed(3));
    }
  }

  function update() {
    tickStats();
    tickAfford();
  }
  function loop() {
    update();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
  // Safety net: keep stats live even when rAF is paused (background tab).
  setInterval(update, 250);

  /* ---------------------------------------------------------------- *
   *  Detector click: bounce + ripple ring + floating "+N".           *
   * ---------------------------------------------------------------- */
  var det = document.getElementById('detector-events');
  var holder = document.getElementById('detector');

  function spawn(e) {
    if (!holder) { return; }
    var rect = det.getBoundingClientRect();
    var x = e.clientX - rect.left;
    var y = e.clientY - rect.top;

    // squash-and-stretch bounce (restart animation via reflow)
    holder.classList.remove('det-bounce');
    void holder.offsetWidth;
    holder.classList.add('det-bounce');

    var ripple = document.createElement('div');
    ripple.className = 'det-ripple';
    ripple.style.left = x + 'px';
    ripple.style.top = y + 'px';
    holder.appendChild(ripple);
    setTimeout(function () { ripple.remove(); }, 600);

    var float = document.createElement('div');
    float.className = 'click-float';
    float.textContent = '+' + fmt(PC.lab.state.detector);
    float.style.left = x + 'px';
    float.style.top = y + 'px';
    holder.appendChild(float);
    setTimeout(function () { float.remove(); }, 750);
  }

  if (det && holder) {
    det.addEventListener('mousedown', spawn);
    det.addEventListener('touchstart', function (e) {
      if (e.touches && e.touches.length) { spawn(e.touches[0]); }
    }, { passive: true });
  }
})();
