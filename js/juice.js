'use strict';

/** Juice layer: non-invasive visual feedback on top of the Angular game.
 *  Reads live state from window.PC (exposed by app.js). Owns the stat-value
 *  spans, the combo meter and all transient FX nodes. The only game-facing
 *  surface is window.PCJuice.combo, which DetectorController consults for
 *  the click multiplier — everything else listens to pc:* CustomEvents.
 */
(function () {
  var PC = window.PC;
  if (!PC) { return; }
  var fmt = Helpers.formatNumberPostfix;

  var REDUCED = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------------------------------------------------------- *
   *  FX budget: hard cap on live transient nodes (autoclicker guard). *
   * ---------------------------------------------------------------- */
  var FX_CAP = 48;
  var fxLive = 0;

  function addFx(node, parent, ttl) {
    if (fxLive >= FX_CAP) { return null; }
    fxLive++;
    parent.appendChild(node);
    if (ttl) {
      setTimeout(function () { removeFx(node); }, ttl);
    }
    return node;
  }
  function removeFx(node) {
    if (!node.parentNode) { return; }
    node.parentNode.removeChild(node);
    fxLive--;
  }

  /** Re-triggerable one-shot animation class. Removal is timeout-based so it
   *  also works under prefers-reduced-motion (no animationend fires there). */
  function pulseClass(el, cls, ms) {
    if (!el) { return; }
    el.classList.remove(cls);
    void el.offsetWidth;               // force reflow to restart the animation
    el.classList.add(cls);
    setTimeout(function () { el.classList.remove(cls); }, ms);
  }

  /* ---------------------------------------------------------------- *
   *  Click combo: rapid clicks heat up a 1.0x-2.0x multiplier.       *
   *  Ephemeral by design — never touches lab.state / the save game.  *
   * ---------------------------------------------------------------- */
  var COMBO_STEP = 0.07;     // heat per click -> ~14 clicks to max
  var COMBO_GRACE = 800;     // ms after a click before decay starts
  var COMBO_DECAY = 0.45;    // heat per second once decaying

  var combo = {
    _heat: 0,
    _lastClick: 0,
    heat: function () { return this._heat; },
    mult: function () { return 1 + this._heat; },
    overdrive: function () { return this._heat >= 0.95; },
    bump: function () {
      this._heat = Math.min(1, this._heat + COMBO_STEP);
      this._lastClick = performance.now();
      return this.mult();
    },
    /** Gain the NEXT bump will produce — used by the click float, which
     *  fires on mousedown, before the controller calls bump(). */
    previewGain: function () {
      var h = Math.min(1, this._heat + COMBO_STEP);
      return Math.round(PC.lab.state.detector * (1 + h));
    },
    decay: function (dt) {
      if (this._heat <= 0) { return; }
      if (performance.now() - this._lastClick < COMBO_GRACE) { return; }
      this._heat = Math.max(0, this._heat - COMBO_DECAY * dt);
    }
  };

  window.PCJuice = { combo: combo };

  /* combo meter DOM (markup lives in index.html under the detector) */
  var meter = document.getElementById('combo-meter');
  var multLabel = document.getElementById('combo-mult');
  var lastMultText = '';

  /* overdrive vignette: injected once, toggled via class */
  var vignette = document.createElement('div');
  vignette.id = 'overdrive-vignette';
  document.body.appendChild(vignette);

  function tickCombo(dt) {
    combo.decay(dt);
    if (!meter) { return; }
    var h = combo._heat;
    meter.style.setProperty('--heat', h.toFixed(3));
    meter.classList.toggle('live', h > 0.02);
    var od = combo.overdrive();
    meter.classList.toggle('overdrive', od);
    vignette.classList.toggle('on', od && !REDUCED);
    var txt = '×' + combo.mult().toFixed(1);
    if (txt !== lastMultText) {
      lastMultText = txt;
      if (multLabel) { multLabel.textContent = txt; }
    }
  }

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

  /* ---------------------------------------------------------------- *
   *  Reactive glow: detector aura brightens with the data rate and   *
   *  blends cyan -> gold as the click combo heats up.                *
   * ---------------------------------------------------------------- */
  function tickGlow() {
    if (!holder) { return; }
    var rate = 0, ws = PC.workers;
    for (var i = 0; i < ws.length; i++) {
      rate += ws[i].state.hired * ws[i].state.rate;
    }
    // log-scale: rate 1 -> ~0, 1e4 -> ~0.5, 1e8 -> 1
    var g = Math.max(0, Math.min(1, Math.log(rate + 1) / (Math.LN10 * 8)));
    var h = combo._heat;
    var r = Math.round(79 + h * (255 - 79));
    var gc = Math.round(212 + h * (196 - 212));
    var b = Math.round(255 + h * (0 - 255));
    var blur = (22 + g * 60 + h * 30).toFixed(1);
    var alpha = Math.min(0.75, 0.12 + g * 0.45 + h * 0.25).toFixed(3);
    holder.style.filter = 'drop-shadow(0 0 ' + blur + 'px rgba(' +
      r + ',' + gc + ',' + b + ',' + alpha + '))';
  }

  var lastFrame = performance.now();
  function update() {
    var now = performance.now();
    var dt = Math.min(0.3, (now - lastFrame) / 1000);  // clamp tab-resume jumps
    lastFrame = now;
    tickCombo(dt);
    tickStats();
    tickAfford();
    tickGlow();
  }
  function loop() {
    update();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
  // Safety net: keep stats live even when rAF is paused (background tab).
  setInterval(update, 250);

  /* ---------------------------------------------------------------- *
   *  Detector click: kick + ripple ring(s) + floating "+N".          *
   * ---------------------------------------------------------------- */
  var det = document.getElementById('detector-events');
  var holder = document.getElementById('detector');

  function makeRipple(x, y, cls) {
    var ripple = document.createElement('div');
    ripple.className = 'det-ripple' + (cls ? ' ' + cls : '');
    ripple.style.left = x + 'px';
    ripple.style.top = y + 'px';
    addFx(ripple, holder, 650);
  }

  function spawn(e) {
    if (!holder) { return; }
    var rect = det.getBoundingClientRect();
    var x = e.clientX - rect.left;
    var y = e.clientY - rect.top;
    var h = combo._heat;
    var crit = h > 0.3 && Math.random() < 0.08;   // purely visual flourish

    makeRipple(x, y, crit ? 'crit' : (h > 0.5 ? 'hot' : ''));
    if (combo.overdrive() && !REDUCED) {
      setTimeout(function () { makeRipple(x, y, 'hot'); }, 60);
    }

    if (!REDUCED) { pulseClass(holder, 'det-kick', 200); }

    var float = document.createElement('div');
    float.className = 'click-float' + (crit ? ' crit' : '');
    float.textContent = '+' + fmt(combo.previewGain());
    float.style.left = x + 'px';
    float.style.top = y + 'px';
    float.style.fontSize = Math.round(16 + h * 12) + 'px';
    holder.appendChild(float);                     // floats bypass the FX cap
    setTimeout(function () { float.remove(); }, 800);
  }

  if (det && holder) {
    det.addEventListener('mousedown', spawn);
    det.addEventListener('touchstart', function (e) {
      if (e.touches && e.touches.length) { spawn(e.touches[0]); }
    }, { passive: true });
  }

  /* ---------------------------------------------------------------- *
   *  Purchase feedback: button pop, card flash, resource dots flying  *
   *  to the stat tiles, tile pop on arrival.                          *
   * ---------------------------------------------------------------- */
  var COLORS = { data: '#4fd4ff', rep: '#c77dff', fund: '#ffc400' };

  function tileEl(which) {
    return document.querySelector('.status .stat-' + which);
  }

  function centerOf(el) {
    var r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  function flyDots(fromEl, which, count) {
    var tile = tileEl(which);
    if (!fromEl || !tile) { return; }
    if (REDUCED) {                                 // instant flash instead
      pulseClass(tile, 'tile-pop', 320);
      return;
    }
    var from = centerOf(fromEl);
    var to = centerOf(tile);
    var dx = to.x - from.x, dy = to.y - from.y;
    var len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    var px = -dy / len, py = dx / len;             // perpendicular for the arc
    var maxDur = 0;

    for (var i = 0; i < count; i++) {
      var dot = document.createElement('div');
      dot.className = 'fx-dot';
      dot.style.setProperty('--dotc', COLORS[which]);
      dot.style.left = from.x + 'px';
      dot.style.top = from.y + 'px';
      if (!addFx(dot, document.body)) { break; }
      var bow = (Math.random() * 2 - 1) * 40;
      var dur = 450 + Math.random() * 200;
      var delay = Math.random() * 120;
      maxDur = Math.max(maxDur, dur + delay);
      // WAAPI finish events stall in background tabs -> timeout fallback
      setTimeout(function (d) { removeFx(d); }.bind(null, dot), dur + delay + 500);
      var anim = dot.animate([
        { transform: 'translate(0,0) scale(1)', opacity: 1 },
        { transform: 'translate(' + (dx / 2 + px * bow) + 'px,' +
                     (dy / 2 + py * bow) + 'px) scale(1.1)', opacity: 1 },
        { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(0.6)', opacity: 0.9 }
      ], { duration: dur, delay: delay, easing: 'cubic-bezier(0.22,1,0.36,1)', fill: 'both' });
      anim.onfinish = (function (d) { return function () { removeFx(d); }; })(dot);
    }
    setTimeout(function () { pulseClass(tile, 'tile-pop', 320); }, Math.max(300, maxDur - 80));
  }

  var mainContent = document.getElementById('main-content');
  function shake() {
    if (REDUCED || !mainContent) { return; }
    pulseClass(mainContent, 'shake', 260);
  }

  document.addEventListener('pc:purchase', function (ev) {
    var d = ev.detail || {};
    if (d.btn) {
      pulseClass(d.btn, 'buy-pop', 340);
      var card = d.btn.closest ? d.btn.closest('.media') : null;
      if (card) { pulseClass(card, 'card-flash', 400); }
    }
    if (d.kind === 'research') {
      flyDots(d.btn, 'data', 10);
      flyDots(d.btn, 'rep', 4);
    } else {
      flyDots(d.btn, 'fund', 10);
    }
    if (d.kind === 'upgrade') { shake(); }
  });

  /* ---------------------------------------------------------------- *
   *  Achievement celebration: toast pop + confetti burst.            *
   * ---------------------------------------------------------------- */
  var CONFETTI_COLORS = ['#ffe259', '#ffc400', '#c77dff', '#4fd4ff', '#4ffb9f'];

  document.addEventListener('pc:achievement', function () {
    var container = document.getElementById('achievements-container');
    if (!container) { return; }
    var toast = container.querySelector('.alert');
    if (toast) { toast.classList.add('toast-pop'); }
    shake();
    if (REDUCED) { return; }

    var rect = container.getBoundingClientRect();
    var ox = rect.left + Math.min(rect.width, 260) / 2;
    var oy = rect.top + 30;
    for (var i = 0; i < 22; i++) {
      var c = document.createElement('div');
      c.className = 'fx-confetti';
      c.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
      c.style.left = (ox + (Math.random() * 120 - 60)) + 'px';
      c.style.top = oy + 'px';
      if (!addFx(c, document.body)) { break; }
      var fall = 150 + Math.random() * 170;
      var drift = Math.random() * 140 - 70;
      var rot = (Math.random() < 0.5 ? -1 : 1) * (360 + Math.random() * 180);
      setTimeout(function (n) { removeFx(n); }.bind(null, c), 2000);
      var anim = c.animate([
        { transform: 'translate(0,0) rotate(0deg)', opacity: 1 },
        { transform: 'translate(' + drift + 'px,' + fall + 'px) rotate(' + rot + 'deg)', opacity: 0 }
      ], { duration: 900 + Math.random() * 500, easing: 'cubic-bezier(0.3,0.7,0.5,1)', fill: 'both' });
      anim.onfinish = (function (n) { return function () { removeFx(n); }; })(c);
    }
  });

  /* ---------------------------------------------------------------- *
   *  Idle drip: soft pulse on the tiles each tick that produced      *
   *  income — the lab visibly breathes while you watch.              *
   * ---------------------------------------------------------------- */
  document.addEventListener('pc:tick', function (ev) {
    var d = ev.detail || {};
    if (d.sum > 0)   { pulseClass(tileEl('data'), 'tile-drip', 650); }
    if (d.grant > 0) { pulseClass(tileEl('fund'), 'tile-drip', 650); }
  });
})();
