// UI du Party Game de Précision. Le serveur génère les cibles, tient les timers
// et calcule TOUTES les précisions. Cette page affiche et envoie une tentative.
//
// RÈGLE DE DESIGN : on ne montre JAMAIS la réponse en clair.
//   · son     → aucune fréquence affichée pendant la mémorisation : tu l'entends,
//               puis tu retrouves la hauteur en tirant l'onde (le son suit en direct)
//   · couleur → les barres n'apparaissent QU'EN phase de jeu
//   · timing  → un tempo sonore régulier t'aide à compter, le chrono se cache
//   · forme   → on attrape la forme (déplacer) et ses poignées (tourner / agrandir)
//
// Debug console : ouvre F12 et renvoie-moi les lignes [prec].

let you = null, isHost = false, myAvatar = null;
let phase = 'lobby', game = null, submitted = false, lastRound = null;

const DEBUG = true;
const dbg = (m, o) => { if (DEBUG) console.log('[prec] ' + m, o !== undefined ? o : ''); };

const $ = (id) => document.getElementById(id);
const show = (id) => { for (const s of document.querySelectorAll('main > section')) s.hidden = s.id !== id; };
const showError = (m) => { $('error').textContent = m ? '> ' + m : ''; };
const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
// `hidden` est une propriété de HTMLElement, PAS de SVGElement : sur un <svg>,
// `el.hidden = false` ne retire pas l'attribut. On passe donc par l'attribut.
const setHidden = (el, on) => { on ? el.setAttribute('hidden', '') : el.removeAttribute('hidden'); };

// ============================================================ SON (SFX + tons)
// Tout est synthétisé : aucun fichier audio à héberger.
const AUDIO = (() => {
  let actx = null;
  function ctx() {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    return actx;
  }
  // petit bip enveloppé (les « clics » de l'interface)
  function blip(freq, dur = 0.08, type = 'sine', vol = 0.13, delay = 0) {
    const c = ctx(), t0 = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(c.destination);
    o.start(t0); o.stop(t0 + dur + 0.03);
  }
  const seq = (notes, type = 'sine', vol = 0.12) =>
    notes.forEach(([f, t, d]) => blip(f, d || 0.09, type, vol, t));

  return {
    resume() { try { ctx(); } catch (_) {} },
    // --- SFX d'interface ---
    click() { blip(520, 0.05, 'square', 0.06); },
    pick() { blip(760, 0.06, 'triangle', 0.09); },
    join() { seq([[440, 0], [660, 0.08]], 'triangle'); },
    start() { seq([[392, 0], [523, 0.09], [659, 0.18], [784, 0.27]], 'triangle', 0.11); },
    memorize() { seq([[880, 0], [1174, 0.1]], 'sine', 0.10); },
    go() { seq([[660, 0], [990, 0.07]], 'square', 0.09); },
    submit() { seq([[784, 0], [1046, 0.08]], 'triangle', 0.12); },
    reveal() { seq([[523, 0], [659, 0.1], [784, 0.2]], 'sine', 0.11); },
    great() { seq([[784, 0], [988, 0.09], [1318, 0.18], [1568, 0.28]], 'triangle', 0.12); },
    meh() { seq([[392, 0], [330, 0.12]], 'sine', 0.10); },
    end() { seq([[523, 0], [659, 0.11], [784, 0.22], [1046, 0.33], [1318, 0.44]], 'triangle', 0.12); },
    tick(strong) { blip(strong ? 1200 : 800, 0.045, 'square', strong ? 0.11 : 0.06); },
    error() { blip(180, 0.16, 'sawtooth', 0.09); },

    // --- ton continu (jeu du son) : on l'entend pendant qu'on cherche ---
    tone: (() => {
      let osc = null, gain = null;
      return {
        start(f) {
          const c = ctx();
          if (osc) this.stop();
          osc = c.createOscillator(); gain = c.createGain();
          osc.type = 'sine'; osc.frequency.setValueAtTime(f, c.currentTime);
          gain.gain.setValueAtTime(0.0001, c.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.16, c.currentTime + 0.06);
          osc.connect(gain).connect(c.destination); osc.start();
        },
        set(f) { if (osc) osc.frequency.setTargetAtTime(f, ctx().currentTime, 0.015); },
        stop() {
          if (!osc) return;
          const c = ctx(), o = osc, g = gain; osc = null; gain = null;
          try { g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.08); o.stop(c.currentTime + 0.12); } catch (_) {}
        },
        playing() { return !!osc; },
      };
    })(),
  };
})();

// ============================================================ FAB (bouton rond)
const ICON = {
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l6 6L20 6"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  dots: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>',
};
function setFab(mode) {
  const b = $('fab');
  b.dataset.mode = mode || '';
  if (!mode) { b.hidden = true; return; }
  b.hidden = false;
  b.classList.toggle('wait', mode === 'wait');
  b.innerHTML = mode === 'submit' ? ICON.check : mode === 'next' ? ICON.arrow : mode === 'lobby' ? ICON.home : ICON.dots;
}
$('fab').addEventListener('click', () => {
  const mode = $('fab').dataset.mode;
  if (mode === 'submit') doSubmit();
  else if (mode === 'next') { AUDIO.click(); NET.send({ action: 'next' }); }
  else if (mode === 'lobby') { AUDIO.click(); phase = 'lobby'; show('lobby'); }
});

// ============================================================ SHAPE
// On attrape la forme pour la déplacer, la poignée du haut pour tourner,
// celle du coin pour agrandir. Aucun slider.
const SHAPE = (() => {
  const R = 10;                       // « rayon » de la forme à l'échelle 1
  const GAP = 7;                      // les poignées se posent HORS de la figure
  let x = 50, y = 50, scale = 1, rot = 0, live = false, mode = null, kind = 'triangle';
  let grabAng = 0, grabRot = 0;

  // Géométrie de chaque forme, centrée sur l'origine (chemin SVG en unités locales).
  const poly = (n, r = R, turn = -90) => {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (turn + i * 360 / n) * Math.PI / 180;
      pts.push(`${(Math.cos(a) * r).toFixed(2)},${(Math.sin(a) * r).toFixed(2)}`);
    }
    return 'M' + pts.join('L') + 'Z';
  };
  const rect = (w, h) => `M${-w},${-h}L${w},${-h}L${w},${h}L${-w},${h}Z`;
  const oval = (rx, ry) => `M${-rx},0a${rx},${ry} 0 1,0 ${rx * 2},0a${rx},${ry} 0 1,0 ${-rx * 2},0`;
  const PATHS = {
    triangle: poly(3), pentagone: poly(5), hexagone: poly(6),
    carre: rect(7.07, 7.07), rectangle: rect(9, 5),
    cercle: oval(R, R), ovale: oval(12.5, 7),
  };
  const pathFor = (k) => PATHS[k] || PATHS.triangle;
  // « demi-hauteur » visuelle de la forme, pour poser les poignées juste dehors
  const REACH = { rectangle: 10.3, ovale: 12.5, carre: 10, cercle: 10 };
  const reachOf = (k) => REACH[k] || R;

  const svg = () => $('shape-svg');
  function toSvg(e) {
    const r = svg().getBoundingClientRect();
    return { px: ((e.clientX - r.left) / r.width) * 100, py: ((e.clientY - r.top) / r.height) * 100 };
  }
  // position des poignées, en unités du viewBox (0..100)
  let hRot = { x: 0, y: 0 }, hScale = { x: 0, y: 0 };
  function paint() {
    const t = $('tri');
    t.setAttribute('d', pathFor(kind));
    t.setAttribute('transform', `translate(${x} ${y}) rotate(${rot}) scale(${scale})`);
    const wrap = $('tri-handles'), link = $('h-link');
    setHidden(wrap, !live);
    link.style.display = live ? 'block' : 'none';
    if (!live) return;
    const rad = (a) => (a - 90) * Math.PI / 180;
    const rr = rad(rot), rs = rad(rot + 135);
    // les DEUX poignées sont posées à l'extérieur de la figure (jamais dessus)
    const out = reachOf(kind) * scale + GAP;
    hRot = { x: x + Math.cos(rr) * out, y: y + Math.sin(rr) * out };
    hScale = { x: x + Math.cos(rs) * out, y: y + Math.sin(rs) * out };
    // les poignées sont en HTML : on les place en % (même repère que le viewBox)
    $('h-rot').style.left = hRot.x + '%'; $('h-rot').style.top = hRot.y + '%';
    $('h-scale').style.left = hScale.x + '%'; $('h-scale').style.top = hScale.y + '%';
    link.setAttribute('x1', x); link.setAttribute('y1', y);
    link.setAttribute('x2', hRot.x); link.setAttribute('y2', hRot.y);
  }
  function setGhost(t) {
    const g = $('tri-ghost');
    if (!t) { g.style.display = 'none'; return; }
    g.style.display = 'block';
    g.setAttribute('d', pathFor(t.kind || kind));
    g.setAttribute('transform', `translate(${t.x} ${t.y}) rotate(${t.rotation}) scale(${t.scale})`);
  }
  const angleTo = (px, py) => Math.atan2(py - y, px - x) * 180 / Math.PI + 90;

  function wire() {
    const b = $('shape-board');
    if (b.dataset.wired) return; b.dataset.wired = '1';
    b.addEventListener('pointerdown', (e) => {
      if (!live) return;
      const { px, py } = toSvg(e);
      // hit-test en PIXELS : le viewBox est étiré, une distance en unités
      // viewBox ne correspondrait pas à ce qu'on voit à l'écran.
      const r = svg().getBoundingClientRect();
      const nearPx = (h) => Math.hypot(
        e.clientX - (r.left + h.x / 100 * r.width),
        e.clientY - (r.top + h.y / 100 * r.height)) < 24;
      if (nearPx(hRot)) { mode = 'rot'; grabAng = angleTo(px, py); grabRot = rot; }
      else if (nearPx(hScale)) mode = 'scale';
      else mode = 'move';
      AUDIO.click();
      try { b.setPointerCapture(e.pointerId); } catch (_) {}
      apply(px, py);
    });
    b.addEventListener('pointermove', (e) => { if (live && mode) { const p = toSvg(e); apply(p.px, p.py); } });
    const up = () => { mode = null; };
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
  }
  function apply(px, py) {
    if (mode === 'move') { x = clamp(px, 0, 100); y = clamp(py, 0, 100); }
    // la poignée est décalée de GAP vers l'extérieur : on l'enlève avant de convertir
    else if (mode === 'scale') { scale = clamp((Math.hypot(px - x, py - y) - GAP) / reachOf(kind), 0.3, 2); }
    else if (mode === 'rot') { rot = ((grabRot + (angleTo(px, py) - grabAng)) % 360 + 360) % 360; }
    paint();
  }
  return {
    showTarget(t) { wire(); live = false; setGhost(null); kind = t.kind || 'triangle'; x = t.x; y = t.y; scale = t.scale; rot = t.rotation; paint(); },
    reset(k) { wire(); live = true; setGhost(null); $('tri').style.display = 'block'; if (k) kind = k; x = 50; y = 50; scale = 1; rot = 0; paint(); },
    freeze() { live = false; mode = null; paint(); },
    data() { return { x: +x.toFixed(2), y: +y.toFixed(2), scale: +scale.toFixed(3), rotation: +rot.toFixed(1) }; },
    // résultats : la cible en pointillés + TA forme pleine, sur la même grille
    compare(t, mine) {
      wire(); live = false; mode = null;
      kind = t.kind || kind;
      setGhost(t);
      const m = mine || t;
      x = m.x; y = m.y; scale = m.scale; rot = m.rotation;
      $('tri').style.display = mine ? 'block' : 'none';
      paint();
    },
    path: pathFor,
  };
})();

// ============================================================ COLOR
// Les barres n'existent QU'EN phase de jeu : en mémorisation, on ne voit que
// la couleur en plein écran (sinon la position des curseurs vend la réponse).
const COLOR = (() => {
  let h = 180, s = 60, l = 50, live = false;
  function paint() {
    $('bar-s').style.background = `linear-gradient(to bottom, hsl(${h} 100% 50%), hsl(${h} 0% 50%))`;
    $('bar-l').style.background = `linear-gradient(to bottom, hsl(${h} ${s}% 100%), hsl(${h} ${s}% 50%), hsl(${h} ${s}% 0%))`;
    $('color-preview').style.background = `hsl(${h} ${s}% ${l}%)`;
    $('knob-h').style.top = (h / 360 * 100) + '%';
    $('knob-s').style.top = ((1 - s / 100) * 100) + '%';
    $('knob-l').style.top = ((1 - l / 100) * 100) + '%';
  }
  function wireBar(id, setter) {
    const el = $(id);
    if (el.dataset.wired) return; el.dataset.wired = '1';
    const grab = (e) => {
      if (!live) return;
      const r = el.getBoundingClientRect();
      setter(clamp((e.clientY - r.top) / r.height, 0, 1)); paint();
    };
    el.addEventListener('pointerdown', (e) => { if (!live) return; AUDIO.click(); try { el.setPointerCapture(e.pointerId); } catch (_) {} el.dataset.drag = '1'; grab(e); });
    el.addEventListener('pointermove', (e) => { if (el.dataset.drag === '1') grab(e); });
    const up = () => { el.dataset.drag = ''; };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  }
  const wire = () => {
    wireBar('bar-h', (f) => { h = f * 360; });
    wireBar('bar-s', (f) => { s = (1 - f) * 100; });
    wireBar('bar-l', (f) => { l = (1 - f) * 100; });
  };
  const bars = (on) => $('color-bars').classList.toggle('on', on);
  return {
    showTarget(t) { wire(); live = false; bars(false); h = t.h; s = t.s; l = t.l; paint(); },
    reset() { wire(); live = true; bars(true); h = 180; s = 50; l = 50; paint(); },
    freeze() { live = false; },
    data() { return { h: +h.toFixed(1), s: +s.toFixed(1), l: +l.toFixed(1) }; },
    preview(t) { bars(false); $('color-preview').style.background = `hsl(${t.h} ${t.s}% ${t.l}%)`; },
  };
})();

// ============================================================ SOUND
// On N'AFFICHE PAS la fréquence cible : on l'entend. En jeu, on tire l'onde
// (haut = plus aigu) et le son suit en DIRECT pour se caler à l'oreille.
const SOUND = (() => {
  const F_MIN = 130, F_MAX = 1400;
  const NOTES = ['do', 'do#', 're', 're#', 'mi', 'fa', 'fa#', 'sol', 'sol#', 'la', 'la#', 'si'];
  const noteOf = (f) => { const n = Math.round(12 * Math.log2(f / 440)) + 9; return NOTES[((n % 12) + 12) % 12]; };
  let freq = 440, live = false, raf = 0, ph = 0, dragging = false, lastY = 0;

  function draw() {
    const cv = $('sound-canvas'); const ctx = cv.getContext('2d');
    const w = cv.width = cv.clientWidth, hgt = cv.height = cv.clientHeight;
    ctx.clearRect(0, 0, w, hgt);
    const mid = w / 2;
    const cycles = 3 + (Math.log2(freq / F_MIN) * 3.2);     // plus aigu = plus serré
    for (let layer = 0; layer < 16; layer++) {
      ctx.beginPath();
      const amp = (w * 0.20) * (1 - layer / 18);
      for (let py = 0; py <= hgt; py += 3) {
        const u = py / hgt;
        const env = Math.sin(u * Math.PI);
        const xx = mid + Math.sin(u * cycles * Math.PI * 2 + ph + layer * 0.22) * amp * env;
        py === 0 ? ctx.moveTo(xx, py) : ctx.lineTo(xx, py);
      }
      const hue = 170 + layer * 6;
      ctx.strokeStyle = `hsla(${hue} 80% 65% / ${0.55 - layer * 0.028})`;
      ctx.lineWidth = 1.3;
      ctx.stroke();
    }
    ph += 0.035;
  }
  function loop() { draw(); raf = requestAnimationFrame(loop); }
  function startViz() { if (!raf) loop(); }
  function stopViz() { if (raf) cancelAnimationFrame(raf); raf = 0; }
  function paintNum(visible) {
    $('freq-big').hidden = !visible;
    if (visible) $('freq-big').innerHTML = freq.toFixed(2) + '<small>Hz</small>';
  }
  function wire() {
    const cv = $('sound-canvas');
    if (cv.dataset.wired) return; cv.dataset.wired = '1';
    cv.addEventListener('pointerdown', (e) => {
      if (!live) return;
      dragging = true; lastY = e.clientY;
      try { cv.setPointerCapture(e.pointerId); } catch (_) {}
    });
    cv.addEventListener('pointermove', (e) => {
      if (!live || !dragging) return;
      const dy = e.clientY - lastY; lastY = e.clientY;
      freq = clamp(freq * Math.pow(2, -dy / 260), F_MIN, F_MAX);   // vers le haut = plus aigu
      AUDIO.tone.set(freq); paintNum(true);
    });
    const up = () => { dragging = false; };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  }
  return {
    showTarget(t) {                     // on ENTEND la cible, aucun chiffre
      wire(); live = false; freq = t.frequency; startViz(); paintNum(false);
      AUDIO.tone.start(freq);
    },
    reset() {                           // à toi de retrouver la hauteur
      wire(); live = true; freq = 440; startViz(); paintNum(true);
      AUDIO.tone.start(freq);
    },
    freeze() { live = false; dragging = false; AUDIO.tone.stop(); },
    stop() { stopViz(); AUDIO.tone.stop(); paintNum(false); },
    data() { return { frequency: +freq.toFixed(2) }; },
    label(f) { return f.toFixed(2) + ' Hz · ' + noteOf(f); },
    preview(f, ms) { AUDIO.tone.start(f); setTimeout(() => AUDIO.tone.stop(), ms || 1200); },
  };
})();

// ============================================================ TIME
// Un tempo sonore régulier (tic à chaque seconde) pour compter à l'oreille,
// des anneaux qui pulsent au rythme, et le chrono qui se cache en route.
const TIME = (() => {
  let goal = 0, hideAt = 0, t0 = 0, raf = 0, tickTimer = 0, running = false, beats = 0;
  // Le tempo sonore n'aide qu'en Facile/Moyen : au-dessus, on compte sans repère.
  const TICK_DIFFS = ['facile', 'moyen'];
  let withTicks = true;
  const fmt = (ms) => (ms / 1000).toFixed(3);

  function draw() {
    const cv = $('time-canvas'); const ctx = cv.getContext('2d');
    const w = cv.width = cv.clientWidth, h = cv.height = cv.clientHeight;
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2;
    const el = running ? performance.now() - t0 : 0;
    const beat = (el % 1000) / 1000;                     // 0..1 dans la seconde
    for (let i = 0; i < 14; i++) {
      const p = ((i / 14) + beat) % 1;                    // anneaux qui s'écartent
      const r = p * Math.min(w, h) * 0.46;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = `hsla(${262 + i * 4} 75% 72% / ${(1 - p) * 0.55})`;
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
    raf = requestAnimationFrame(draw);
  }
  function startViz() { if (!raf) draw(); }
  function stopViz() { if (raf) cancelAnimationFrame(raf); raf = 0; }
  function startTicks() {
    clearInterval(tickTimer); beats = 0;
    if (!withTicks) return;                       // difficulté élevée : silence, débrouille-toi
    AUDIO.tick(true);
    tickTimer = setInterval(() => { beats++; AUDIO.tick(beats % 4 === 0); }, 1000);
  }
  function stopTicks() { clearInterval(tickTimer); tickTimer = 0; }

  return {
    showTarget(t, diff) {
      goal = t.target_ms; hideAt = t.hide_after_ms; running = false;
      withTicks = TICK_DIFFS.includes(String(diff || '').toLowerCase());
      $('chrono').hidden = false; $('chrono').classList.remove('masked');
      $('chrono').textContent = fmt(goal);
      startViz(); startTicks();                       // le tempo commence dès la consigne
    },
    reset() {
      running = true; t0 = performance.now();
      $('chrono').hidden = false; $('chrono').classList.remove('masked');
      startViz(); startTicks();
      const loop = () => {
        if (!running) return;
        const el = performance.now() - t0;
        if (el < hideAt) $('chrono').textContent = fmt(el);
        else { $('chrono').textContent = '· · ·'; $('chrono').classList.add('masked'); }
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    },
    freeze() { running = false; stopTicks(); },
    stop() { running = false; stopTicks(); stopViz(); $('chrono').hidden = true; },
    data() { return { ms: Math.round(performance.now() - t0) }; },
    goal() { return goal; },
    fmt,
  };
})();

// ============================================================ REFLEX
// L'écran est rouge, puis passe au vert QUAND LE SERVEUR le dit (message `green`).
// Cliquer avant = faux départ, 0 point : on ne récompense pas l'anticipation.
const REFLEX = (() => {
  let greenAt = 0, armed = false, early = false, reacted = null;
  const zone = () => $('reflex-zone');
  function wire() {
    const z = zone();
    if (z.dataset.wired) return; z.dataset.wired = '1';
    z.addEventListener('pointerdown', () => hit());
  }
  function hit() {
    if (!armed || reacted !== null || early) return;
    if (!greenAt) {                       // pas encore vert → faux départ
      early = true;
      zone().classList.add('oops');
      $('reflex-word').textContent = 'trop tôt !';
      AUDIO.error();
      doSubmit();                          // on envoie tout de suite : le tour est joué
      return;
    }
    reacted = Math.round(performance.now() - greenAt);
    $('reflex-word').textContent = reacted + ' ms';
    AUDIO.submit();
    doSubmit();
  }
  return {
    showTarget() {                         // rien à mémoriser : juste la consigne
      wire(); armed = false; greenAt = 0; early = false; reacted = null;
      zone().classList.remove('go', 'oops');
      $('reflex-word').textContent = 'prépare-toi';
    },
    reset() {
      wire(); armed = true; greenAt = 0; early = false; reacted = null;
      zone().classList.remove('go', 'oops');
      $('reflex-word').textContent = 'attends le vert…';
    },
    green() {                              // top donné par le serveur
      if (!armed || early || reacted !== null) return;
      greenAt = performance.now();
      zone().classList.add('go');
      $('reflex-word').textContent = 'CLIQUE !';
      AUDIO.go();
    },
    freeze() { armed = false; },
    data() { return early ? { early: true } : { ms: reacted == null ? 99999 : reacted, early: false }; },
  };
})();

// ============================================================ TYPING
// Taper le plus de mots possible avant la fin du temps. Un mot validé par
// espace ou Entrée ; on ne compte que les mots EXACTS.
const TYPING = (() => {
  const PAGE = 12;                       // mots affichés d'un bloc
  let words = [], idx = 0, correct = 0, live = false;
  // Les mots restent EN PLACE : on ne fait glisser une fenêtre à chaque mot
  // (tout sautait à l'écran, désagréable). Seul le surlignage avance ; le bloc
  // n'est remplacé que lorsqu'il est entièrement tapé.
  function render() {
    const page = Math.floor(idx / PAGE);
    const start = page * PAGE;
    const here = idx - start;
    $('typing-words').innerHTML = words.slice(start, start + PAGE).map((w, i) =>
      `<span class="w ${i === here ? 'now' : (i < here ? 'done' : '')}">${esc(w)}</span>`).join(' ');
    $('typing-count').textContent = correct + (correct > 1 ? ' mots' : ' mot');
  }
  function submitWord() {
    const el = $('typing-input');
    const typed = el.value.trim();
    if (!typed) return;
    if (typed === words[idx]) { correct++; AUDIO.pick(); } else { AUDIO.error(); }
    idx++; el.value = '';
    if (idx >= words.length) idx = 0;      // liste bouclée (personne n'ira jusque-là)
    render();
  }
  function wire() {
    const el = $('typing-input');
    if (el.dataset.wired) return; el.dataset.wired = '1';
    el.addEventListener('keydown', (e) => {
      if (!live) return;
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); submitWord(); }
    });
  }
  return {
    showTarget() { wire(); live = false; words = []; idx = 0; correct = 0;
      $('typing-input').value = ''; $('typing-input').disabled = true;
      $('typing-words').innerHTML = '<span class="w now">prêt ?</span>'; $('typing-count').textContent = '';
    },
    reset(list) {
      wire(); live = true; words = list || []; idx = 0; correct = 0;
      const el = $('typing-input');
      el.value = ''; el.disabled = false; render();
      setTimeout(() => el.focus(), 30);    // le clavier tout de suite, sans clic
    },
    freeze() { live = false; $('typing-input').disabled = true; },
    data() { return { correct }; },
  };
})();

const GAMES = { shape: SHAPE, color: COLOR, sound: SOUND, time: TIME, reflex: REFLEX, typing: TYPING };
const HINTS = {
  shape: { memo: 'Retiens la position, la taille et l\'angle', play: 'Déplace la forme · poignées pour tourner et agrandir' },
  color: { memo: 'Retiens cette couleur exacte', play: 'Retrouve la teinte, la saturation et la luminosité' },
  sound: { memo: 'Écoute bien cette hauteur', play: 'Tire l\'onde vers le haut ou le bas pour retrouver le son' },
  time: { memo: 'Retiens le temps à atteindre', play: 'Le chrono se cache — valide au bon moment' },
  reflex: { memo: 'Clique dès que l\'écran passe au vert', play: 'Attends le vert… puis clique le plus vite possible' },
  typing: { memo: 'Tape les mots le plus vite possible', play: 'Espace ou Entrée pour valider chaque mot' },
};

function showStage(g) {
  for (const k of Object.keys(GAMES)) $('stage-' + k).hidden = (k !== g);
  $('reveal-view').hidden = true;
}
function stopAll() {
  clearTimeout(autoTimer); autoTimer = 0;
  for (const k of Object.keys(GAMES)) { const m = GAMES[k]; if (m.freeze) m.freeze(); if (m.stop) m.stop(); }
  $('freq-big').hidden = true; $('chrono').hidden = true;
}

// liseré de temps en haut de la carte
function runBar(ms) {
  const f = $('timefill');
  f.style.transition = 'none'; f.style.width = '100%';
  requestAnimationFrame(() => { f.style.transition = `width ${ms}ms linear`; f.style.width = '0%'; });
}
function stopBar() { const f = $('timefill'); f.style.transition = 'none'; f.style.width = '100%'; }

// ============================================================ accueil
const AVATARS = ['😎', '🤖', '👻', '🐸', '🦊', '🐼', '🔥', '⚡', '🎯', '🎧', '🍕', '🚀'];
myAvatar = AVATARS[Math.floor(Math.random() * AVATARS.length)];
for (const em of AVATARS) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'avatar-pick' + (em === myAvatar ? ' picked' : ''); b.textContent = em;
  b.addEventListener('click', () => {
    myAvatar = em; AUDIO.pick();
    document.querySelectorAll('.avatar-pick').forEach((x) => x.classList.toggle('picked', x === b));
  });
  $('avatar-row').appendChild(b);
}
$('host').addEventListener('click', () => enter());
$('join').addEventListener('click', () => enter($('code-input').value));
$('code-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') enter($('code-input').value); });
async function enter(code) {
  const name = $('name-input').value.trim();
  if (!name) { AUDIO.error(); return showError('il te faut un pseudo'); }
  if (code !== undefined && !code.trim()) { AUDIO.error(); return showError('rentre un code de room'); }
  showError(''); AUDIO.resume(); AUDIO.click();
  try { await NET.connect(); NET.send(code === undefined ? { action: 'join', name, avatar: myAvatar } : { action: 'join', name, code, avatar: myAvatar }); }
  catch (err) { AUDIO.error(); showError(err.message); }
}
$('start').addEventListener('click', () => {
  AUDIO.start();
  NET.send({ action: 'start', rounds: +$('rounds-select').value, difficulty: $('diff-select').value, game: $('game-select').value || undefined });
});
// TIMING : on peut cliquer N'IMPORTE OÙ sur la carte pour arrêter le chrono
// (pas seulement sur le petit bouton rond). Le garde de doSubmit évite le double envoi.
$('game').addEventListener('click', () => {
  if (phase === 'play' && game === 'time') doSubmit();
});
// … et la barre d'espace, tant qu'à faire
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && phase === 'play' && game === 'time') { e.preventDefault(); doSubmit(); }
});

$('room-code').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('room-code').textContent.trim()); AUDIO.pick();
    $('code-hint').textContent = 'code copié ✔'; setTimeout(() => { $('code-hint').textContent = 'clique sur le code pour le copier'; }, 1500); } catch (_) {}
});

let autoTimer = 0;
function doSubmit(auto) {
  if (submitted || phase !== 'play' || !game) return;
  clearTimeout(autoTimer); autoTimer = 0;
  const data = GAMES[game].data();
  submitted = true;
  AUDIO.submit();
  GAMES[game].freeze();
  setFab('wait');
  NET.send({ action: 'submit', type: game, data });
  dbg(auto ? 'temps écoulé → validation automatique' : 'tentative envoyée', { game, data });
  $('phase-sub').textContent = auto ? 'temps écoulé — ta position a été prise' : 'validé — en attente des autres…';
}
// Filet : si le temps s'écoule sans qu'on ait cliqué, on envoie quand même la
// position en cours (on part un peu avant la fin pour que ça arrive à temps).
function armAutoSubmit(ms) {
  clearTimeout(autoTimer);
  autoTimer = setTimeout(() => doSubmit(true), Math.max(200, ms - 350));
}

// ============================================================ serveur
NET.on('room', (msg) => {
  you = msg.you;
  $('room-code').textContent = msg.code;
  const me = msg.players.find((p) => p.id === you);
  const wasHost = isHost; isHost = !!(me && me.host);
  $('players').innerHTML = msg.players.map((p) =>
    `<li><span class="pp">${esc(p.avatar || '🙂')}</span>${esc(p.name)}${p.host ? ' <span class="tag">MJ</span>' : ''}</li>`).join('');
  $('host-config').hidden = !isHost;
  $('need-players').textContent = msg.players.length < 2 ? 'ça marche en solo, mais c\'est plus drôle à plusieurs' : '';
  if (msg.phase === 'lobby' && phase === 'lobby') { show('lobby'); if (!wasHost && !isHost) AUDIO.join(); }
});

NET.on('error', (msg) => { AUDIO.error(); showError(msg.message); });
NET.on('closed', () => { if (you) showError('connexion au serveur perdue'); });
NET.on('ready', (msg) => {
  if (phase === 'play' && submitted) $('phase-sub').textContent = `${msg.ids.length}/${msg.of} ont validé`;
});

// REFLEX : le top vert est donné par le serveur (le client ne le connaît jamais avant)
NET.on('green', () => { dbg('TOP vert'); if (phase === 'play' && game === 'reflex') REFLEX.green(); });

NET.on('phase', (msg) => { phase = msg.phase; dbg('phase → ' + msg.phase, msg); (PHASES[msg.phase] || (() => {}))(msg); });

const PHASES = {
  memorize(msg) {
    show('game'); stopAll(); game = msg.game; submitted = false; lastRound = msg;
    $('hud-round').textContent = `${msg.round} / ${msg.of}`;
    $('phase-title').textContent = HINTS[game].memo;
    $('phase-sub').textContent = 'mémorise…';
    showStage(game); setFab(null); AUDIO.memorize();
    $('score-block').hidden = true; $('reveal-view').classList.remove('sheet');
    $('score-block').classList.remove('compact'); $('shape-board').classList.remove('fit');
    GAMES[game].showTarget(msg.target, msg.difficulty);
    runBar(msg.ms);
  },

  play(msg) {
    show('game'); game = msg.game; submitted = false;
    $('phase-title').textContent = HINTS[game].play;
    $('phase-sub').textContent = 'à toi';
    showStage(game); AUDIO.go();
    $('score-block').hidden = true;
    GAMES[game].reset(game === 'typing' ? msg.words : msg.kind);   // mots (typing) / forme (shape)
    setFab('submit');
    runBar(msg.ms);
    armAutoSubmit(msg.ms);              // le temps qui s'écoule vaut validation
  },

  reveal(msg) {
    show('game'); stopBar(); stopAll();
    $('hud-round').textContent = `${msg.round} / ${msg.of}`;
    $('phase-title').textContent = 'Résultats';
    $('phase-sub').textContent = '';
    showStage(null);
    renderReveal(msg);
    setFab(isHost ? 'next' : 'wait');
    const mine = msg.results.find((r) => r.id === you);
    (mine && mine.accuracy >= 80) ? AUDIO.great() : AUDIO.reveal();
  },

  end(msg) {
    show('game'); stopBar(); stopAll(); showStage(null);
    $('phase-title').textContent = 'Fin de partie';
    $('phase-sub').textContent = '';
    $('hud-round').textContent = '🏆';
    $('score-block').hidden = true; $('reveal-view').classList.remove('sheet');
    $('score-block').classList.remove('compact'); $('shape-board').classList.remove('fit');
    $('reveal-view').hidden = false;
    $('rv-compare').innerHTML = '<p class="rv-big">🏆 Podium</p>';
    setHidden($('rv-shape'), true); $('rv-list').innerHTML = '';
    const medals = ['🥇', '🥈', '🥉'];
    $('scores').hidden = false;
    $('scores').innerHTML = msg.podium.map((p, i) =>
      `<li>${medals[i] || '·'} <span class="pp">${esc(p.avatar || '🙂')}</span>${esc(p.name)}<span class="pts">${p.score}</span></li>`).join('');
    setFab('lobby'); AUDIO.end();
  },
};

// --- résultats --------------------------------------------------------------
const accClass = (a) => a >= 80 ? 'a-hi' : (a >= 45 ? 'a-mid' : 'a-lo');
function deltaText(g, r) {
  if (!r.submitted) return 'pas validé';
  const d = r.deltas || {};
  // un cercle n'a pas d'angle : le serveur renvoie rot = null
  if (g === 'shape') return `pos ${d.pos} · taille ${d.scale}` + (d.rot === null ? '' : ` · angle ${d.rot}°`);
  if (g === 'color') return `teinte ${d.h}° · sat ${d.s} · lum ${d.l}`;
  if (g === 'sound') return `${d.hz > 0 ? '+' : ''}${d.hz} Hz · ${Math.round(d.cents)} cents`;
  if (g === 'reflex') return d.early ? 'parti trop tôt' : `${d.ms} ms de réaction`;
  if (g === 'typing') return `${d.correct} mots · ${d.wpm} mots/min`;
  return `${d.ms > 0 ? '+' : ''}${d.ms} ms`;
}

const QUIPS = [
  [95, 'Chirurgical.'], [85, 'Très propre.'], [70, 'Bien vu.'],
  [50, 'Pas mal.'], [30, 'Approximatif.'], [0, 'Aïe.'],
];
const quipFor = (a) => (QUIPS.find(([s]) => a >= s) || QUIPS[QUIPS.length - 1])[1];

function renderReveal(msg) {
  const g = msg.game, t = msg.target;
  const mine = msg.results.find((r) => r.id === you);
  $('reveal-view').hidden = false;
  const cmp = $('rv-compare'); cmp.innerHTML = '';
  setHidden($('rv-shape'), true); $('scores').hidden = false;

  // gros score + petite phrase (mon résultat à moi)
  const acc = mine ? mine.accuracy : 0;
  $('score-block').hidden = false;
  $('rv-score').innerHTML = acc.toFixed(1) + '<small>%</small>';
  $('rv-quip').textContent = quipFor(acc);
  $('phase-title').textContent = '';

  // Forme : on GARDE la grille et on superpose cible (pointillés) + ta forme.
  // Le classement passe alors en panneau bas pour ne pas cacher le visuel.
  const overlay = (g === 'shape');
  $('reveal-view').classList.toggle('sheet', overlay);
  $('score-block').classList.toggle('compact', overlay);
  $('shape-board').classList.toggle('fit', overlay);   // plateau replié au-dessus du classement
  if (overlay) {
    showStage('shape');
    $('reveal-view').hidden = false;
    SHAPE.compare(t, mine && mine.data);
    cmp.innerHTML = '<p class="rv-lbl">POINTILLÉS : LA CIBLE · PLEIN : TOI</p>';
  }

  if (g === 'color') {
    const sw = (c, l) => `<div><div class="swatch" style="background:${c}"></div><p class="rv-lbl">${l}</p></div>`;
    cmp.innerHTML = sw(`hsl(${t.h} ${t.s}% ${t.l}%)`, 'LA CIBLE')
      + (mine && mine.data ? sw(`hsl(${mine.data.h} ${mine.data.s}% ${mine.data.l}%)`, 'TOI') : '');
  } else if (g === 'sound') {
    cmp.innerHTML = `<div><p class="rv-lbl">LA CIBLE</p><p class="rv-big">${SOUND.label(t.frequency)}</p></div>`
      + (mine && mine.data ? `<div><p class="rv-lbl">TOI</p><p class="rv-big">${SOUND.label(mine.data.frequency)}</p></div>` : '');
    const btn = document.createElement('button');
    btn.className = 'ghost'; btn.textContent = '🔊 réécouter la cible';
    btn.addEventListener('click', () => SOUND.preview(t.frequency, 1300));
    cmp.appendChild(btn);
  } else if (g === 'reflex') {
    const d = mine && mine.deltas;
    cmp.innerHTML = `<div><p class="rv-lbl">TA RÉACTION</p><p class="rv-big">`
      + (!d ? '—' : d.early ? 'faux départ' : d.ms + ' ms') + '</p></div>';
  } else if (g === 'typing') {
    const d = mine && mine.deltas;
    cmp.innerHTML = `<div><p class="rv-lbl">TA VITESSE</p><p class="rv-big">`
      + (d ? `${d.wpm} mots/min` : '—') + '</p></div>';
  } else if (g === 'time') {
    cmp.innerHTML = `<div><p class="rv-lbl">LA CIBLE</p><p class="rv-big">${TIME.fmt(t.target_ms)} s</p></div>`
      + (mine && mine.data ? `<div><p class="rv-lbl">TOI</p><p class="rv-big">${TIME.fmt(mine.data.ms)} s</p></div>` : '');
  }

  $('rv-list').innerHTML = msg.results.map((r, i) =>
    `<div class="rv-row${r.id === you ? ' me' : ''}"><span class="rk">${i + 1}</span>`
    + `<span>${esc(r.avatar || '🙂')} ${esc(r.name)}<br><span class="rd">${deltaText(g, r)}</span></span>`
    + `<span class="ra ${accClass(r.accuracy)}">${r.accuracy.toFixed(1)}%</span></div>`).join('');

  $('scores').innerHTML = msg.scores.map((p, i) =>
    `<li>${i + 1}. <span class="pp">${esc(p.avatar || '🙂')}</span>${esc(p.name)}<span class="pts">${p.score}</span></li>`).join('');
}
