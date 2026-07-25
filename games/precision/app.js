// UI du Party Game de Précision. Le serveur génère les cibles, tient les timers
// de phase (c'est ça, la difficulté) et calcule TOUTES les précisions.
// Cette page ne fait qu'afficher et envoyer une tentative.
//   memorize : on montre la cible (pour `time`, juste la consigne)
//   play     : l'UI repart de ZÉRO, on reproduit, on valide
//   reveal   : cible + valeurs de tout le monde (superposition)
//
// Debug console : ouvre F12 et renvoie-moi les lignes [prec].

let you = null, isHost = false, myAvatar = null;
let phase = 'lobby', game = null;
let submitted = false;
let barTimer = 0, chronoRaf = 0, chronoStart = 0, chronoHideAt = 0, timeGoal = 0;

const DEBUG = true;
const dbg = (m, o) => { if (DEBUG) console.log('[prec] ' + m, o !== undefined ? o : ''); };

const $ = (id) => document.getElementById(id);
const show = (id) => { for (const s of document.querySelectorAll('main > section')) s.hidden = s.id !== id; };
const showError = (m) => { $('error').textContent = m ? '> ' + m : ''; };
const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// ============================================================ SHAPE
const SHAPE = (() => {
  let x = 50, y = 50, scale = 1, rot = 0, live = false;
  const tri = () => $('tri');
  function paint() {
    tri().setAttribute('transform', `translate(${x} ${y}) rotate(${rot}) scale(${scale})`);
    $('sh-scale-v').textContent = scale.toFixed(2);
    $('sh-rot-v').textContent = Math.round(rot) + '°';
  }
  function setGhost(t) {
    const g = $('tri-ghost');
    if (!t) { g.style.display = 'none'; return; }
    g.style.display = 'block';
    g.setAttribute('transform', `translate(${t.x} ${t.y}) rotate(${t.rotation}) scale(${t.scale})`);
  }
  function fromPointer(e) {
    const r = $('shape-board').getBoundingClientRect();
    x = clamp(((e.clientX - r.left) / r.width) * 100, 0, 100);
    y = clamp(((e.clientY - r.top) / r.height) * 100, 0, 100);
    paint();
  }
  const board = () => $('shape-board');
  let dragging = false;
  function wire() {
    const b = board();
    if (b.dataset.wired) return; b.dataset.wired = '1';
    b.addEventListener('pointerdown', (e) => { if (!live) return; dragging = true; try { b.setPointerCapture(e.pointerId); } catch (_) {} fromPointer(e); });
    b.addEventListener('pointermove', (e) => { if (live && dragging) fromPointer(e); });
    b.addEventListener('pointerup', () => { dragging = false; });
    b.addEventListener('pointercancel', () => { dragging = false; });
    $('sh-scale').addEventListener('input', (e) => { if (!live) return; scale = +e.target.value; paint(); });
    $('sh-rot').addEventListener('input', (e) => { if (!live) return; rot = +e.target.value; paint(); });
  }
  return {
    showTarget(t) {   // memorize : on montre la cible, contrôles gelés
      wire(); live = false; setGhost(null);
      x = t.x; y = t.y; scale = t.scale; rot = t.rotation;
      $('sh-scale').value = scale; $('sh-rot').value = rot;
      paint();
    },
    reset() {         // play : tout revient au neutre
      wire(); live = true; setGhost(null);
      x = 50; y = 50; scale = 1; rot = 0;
      $('sh-scale').value = 1; $('sh-rot').value = 0;
      paint();
    },
    freeze() { live = false; },
    data() { return { x: +x.toFixed(2), y: +y.toFixed(2), scale: +scale.toFixed(3), rotation: +rot.toFixed(1) }; },
    // reveal : la cible en pointillés + ma tentative pleine
    compare(target, mine) {
      wire(); live = false; setGhost(target);
      if (mine) { x = mine.x; y = mine.y; scale = mine.scale; rot = mine.rotation; }
      paint();
    },
  };
})();

// ============================================================ COLOR
const COLOR = (() => {
  let h = 180, s = 60, l = 50, live = false;
  const knobs = { h: 'knob-h', s: 'knob-s', l: 'knob-l' };
  function paint() {
    $('bar-s').style.background = `linear-gradient(to bottom, hsl(${h} 100% 50%), hsl(${h} 0% 50%))`;
    $('bar-l').style.background = `linear-gradient(to bottom, hsl(${h} ${s}% 100%), hsl(${h} ${s}% 50%), hsl(${h} ${s}% 0%))`;
    $('color-preview').style.background = `hsl(${h} ${s}% ${l}%)`;
    place('h', h / 360); place('s', 1 - s / 100); place('l', 1 - l / 100);
  }
  function place(k, frac) { $(knobs[k]).style.top = (clamp(frac, 0, 1) * 100) + '%'; }
  function wireBar(id, setter) {
    const el = $(id);
    if (el.dataset.wired) return; el.dataset.wired = '1';
    const grab = (e) => {
      if (!live) return;
      const r = el.getBoundingClientRect();
      setter(clamp((e.clientY - r.top) / r.height, 0, 1));
      paint();
    };
    el.addEventListener('pointerdown', (e) => { if (!live) return; try { el.setPointerCapture(e.pointerId); } catch (_) {} el.dataset.drag = '1'; grab(e); });
    el.addEventListener('pointermove', (e) => { if (el.dataset.drag === '1') grab(e); });
    el.addEventListener('pointerup', () => { el.dataset.drag = ''; });
    el.addEventListener('pointercancel', () => { el.dataset.drag = ''; });
  }
  function wire() {
    wireBar('bar-h', (f) => { h = f * 360; });
    wireBar('bar-s', (f) => { s = (1 - f) * 100; });
    wireBar('bar-l', (f) => { l = (1 - f) * 100; });
  }
  return {
    showTarget(t) { wire(); live = false; h = t.h; s = t.s; l = t.l; paint(); },
    reset() { wire(); live = true; h = 180; s = 50; l = 50; paint(); },
    freeze() { live = false; },
    data() { return { h: +h.toFixed(1), s: +s.toFixed(1), l: +l.toFixed(1) }; },
  };
})();

// ============================================================ SOUND
const SOUND = (() => {
  // slider 0..1000 → 150..1200 Hz en LOG (l'oreille est logarithmique)
  const F_MIN = 150, F_MAX = 1200;
  const toFreq = (v) => F_MIN * Math.pow(F_MAX / F_MIN, v / 1000);
  const toSlider = (f) => 1000 * Math.log(f / F_MIN) / Math.log(F_MAX / F_MIN);
  const NOTES = ['do', 'do#', 're', 're#', 'mi', 'fa', 'fa#', 'sol', 'sol#', 'la', 'la#', 'si'];
  const noteOf = (f) => { const n = Math.round(12 * Math.log2(f / 440)) + 9; return NOTES[((n % 12) + 12) % 12]; };

  let actx = null, osc = null, gain = null, freq = 440, live = false, raf = 0, phaseAcc = 0;
  function ensure() {
    if (!actx) { actx = new (window.AudioContext || window.webkitAudioContext)(); }
    if (actx.state === 'suspended') actx.resume();
  }
  function tone(f, ms = 1200) {
    ensure(); stopTone();
    osc = actx.createOscillator(); gain = actx.createGain();
    osc.type = 'sine'; osc.frequency.value = f;
    gain.gain.setValueAtTime(0.0001, actx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18, actx.currentTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + ms / 1000);
    osc.connect(gain).connect(actx.destination);
    osc.start(); osc.stop(actx.currentTime + ms / 1000 + 0.05);
  }
  function stopTone() { if (osc) { try { osc.stop(); } catch (_) {} osc = null; } }
  function draw() {
    const cv = $('sound-canvas'); const ctx = cv.getContext('2d');
    cv.width = cv.clientWidth; cv.height = cv.clientHeight;
    const w = cv.width, hgt = cv.height, mid = hgt / 2;
    ctx.clearRect(0, 0, w, hgt);
    const cycles = 2 + (freq - F_MIN) / 90;             // plus aigu = plus d'ondulations
    for (let layer = 0; layer < 5; layer++) {
      ctx.beginPath();
      const amp = (hgt * 0.32) * (1 - layer * 0.16);
      for (let px = 0; px <= w; px++) {
        const u = px / w;
        const yy = mid + Math.sin(u * cycles * Math.PI * 2 + phaseAcc + layer * 0.5) * amp * Math.sin(u * Math.PI);
        px === 0 ? ctx.moveTo(px, yy) : ctx.lineTo(px, yy);
      }
      ctx.strokeStyle = `hsla(${185 + layer * 14} 85% 62% / ${0.85 - layer * 0.14})`;
      ctx.lineWidth = 2 - layer * 0.28;
      ctx.stroke();
    }
    phaseAcc += 0.05;
  }
  function loop() { draw(); raf = requestAnimationFrame(loop); }
  function startViz() { if (!raf) loop(); }
  function stopViz() { if (raf) cancelAnimationFrame(raf); raf = 0; }
  function paint() {
    $('freq-big').innerHTML = freq.toFixed(2) + '<small>Hz</small>';
    $('sn-note').textContent = noteOf(freq);
    $('sn-freq').value = Math.round(toSlider(freq));
  }
  function wire() {
    const sl = $('sn-freq');
    if (sl.dataset.wired) return; sl.dataset.wired = '1';
    sl.addEventListener('input', (e) => { if (!live) return; freq = toFreq(+e.target.value); paint(); });
    sl.addEventListener('change', () => { if (live) tone(freq, 700); });
    $('sn-listen').addEventListener('click', () => tone(freq, 1200));
  }
  return {
    showTarget(t) {                       // memorize : on ENTEND la cible
      wire(); live = false; freq = t.frequency; paint(); startViz();
      $('sn-listen').hidden = true; $('sn-freq').disabled = true;
      tone(freq, 1600);
    },
    reset() {                             // play : slider au milieu, à l'oreille
      wire(); live = true; freq = 440; paint(); startViz();
      $('sn-listen').hidden = false; $('sn-freq').disabled = false;
    },
    freeze() { live = false; stopTone(); },
    stop() { stopViz(); stopTone(); },
    data() { return { frequency: +freq.toFixed(2) }; },
    play(f, ms) { tone(f, ms); },
    label(f) { return f.toFixed(2) + ' Hz (' + noteOf(f) + ')'; },
  };
})();

// ============================================================ TIME
const TIME = (() => {
  function fmt(ms) { return (ms / 1000).toFixed(3); }
  return {
    showTarget(t) {                       // memorize : la consigne
      timeGoal = t.target_ms; chronoHideAt = t.hide_after_ms;
      $('time-goal').textContent = `arrête le chrono à ${fmt(t.target_ms)} s`;
      $('chrono').textContent = fmt(0); $('chrono').classList.remove('hidden-run');
    },
    reset() {                             // play : le chrono tourne puis se cache
      $('time-goal').textContent = `objectif : ${fmt(timeGoal)} s`;
      chronoStart = performance.now();
      $('chrono').classList.remove('hidden-run');
      const loop = () => {
        const el = performance.now() - chronoStart;
        if (el < chronoHideAt) { $('chrono').textContent = fmt(el); }
        else { $('chrono').textContent = '· · ·'; $('chrono').classList.add('hidden-run'); }
        chronoRaf = requestAnimationFrame(loop);
      };
      chronoRaf = requestAnimationFrame(loop);
    },
    freeze() { if (chronoRaf) cancelAnimationFrame(chronoRaf); chronoRaf = 0; },
    data() { return { ms: Math.round(performance.now() - chronoStart) }; },
    fmt,
  };
})();

const GAMES = { shape: SHAPE, color: COLOR, sound: SOUND, time: TIME };
const GAME_INFO = {
  shape: { icon: '△', name: 'Forme', memo: 'mémorise la position, la taille et l\'angle', play: 'replace le triangle au même endroit' },
  color: { icon: '🎨', name: 'Couleur', memo: 'mémorise cette couleur exacte', play: 'retrouve la teinte, la saturation et la luminosité' },
  sound: { icon: '🔊', name: 'Son', memo: 'écoute bien cette fréquence', play: 'retrouve la même hauteur à l\'oreille' },
  time: { icon: '⏱', name: 'Timing', memo: 'retiens le temps à atteindre', play: 'le chrono se cache — valide au bon moment' },
};

function showStage(g) {
  for (const k of Object.keys(GAMES)) $('stage-' + k).hidden = (k !== g);
  $('reveal-view').hidden = true;
}
function freezeAll() { for (const k of Object.keys(GAMES)) if (GAMES[k].freeze) GAMES[k].freeze(); }

// barre de temps : le serveur donne la durée, on l'anime
function runBar(ms) {
  clearTimeout(barTimer);
  const fill = $('timefill');
  fill.style.transition = 'none'; fill.style.width = '100%';
  requestAnimationFrame(() => {
    fill.style.transition = `width ${ms}ms linear`;
    fill.style.width = '0%';
  });
}
function stopBar() { const f = $('timefill'); f.style.transition = 'none'; f.style.width = '100%'; }

// ============================================================ accueil
const AVATARS = ['😎', '🤖', '👻', '🐸', '🦊', '🐼', '🔥', '⚡', '🎯', '🎧', '🍕', '🚀'];
myAvatar = AVATARS[Math.floor(Math.random() * AVATARS.length)];
for (const em of AVATARS) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'avatar-pick' + (em === myAvatar ? ' picked' : ''); b.textContent = em;
  b.addEventListener('click', () => { myAvatar = em; document.querySelectorAll('.avatar-pick').forEach((x) => x.classList.toggle('picked', x === b)); });
  $('avatar-row').appendChild(b);
}
$('host').addEventListener('click', () => enter());
$('join').addEventListener('click', () => enter($('code-input').value));
$('code-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') enter($('code-input').value); });
async function enter(code) {
  const name = $('name-input').value.trim();
  if (!name) return showError('il te faut un pseudo');
  if (code !== undefined && !code.trim()) return showError('rentre un code de room');
  showError('');
  try { await NET.connect(); NET.send(code === undefined ? { action: 'join', name, avatar: myAvatar } : { action: 'join', name, code, avatar: myAvatar }); }
  catch (err) { showError(err.message); }
}
$('start').addEventListener('click', () => NET.send({
  action: 'start', rounds: +$('rounds-select').value,
  difficulty: $('diff-select').value, game: $('game-select').value || undefined,
}));
$('room-code').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('room-code').textContent.trim()); $('code-hint').textContent = 'code copié ✔'; setTimeout(() => { $('code-hint').textContent = 'clique sur le code pour le copier'; }, 1500); } catch (_) {} });
$('next-btn').addEventListener('click', () => NET.send({ action: 'next' }));
$('to-lobby').addEventListener('click', () => { phase = 'lobby'; show('lobby'); });

$('submit-btn').addEventListener('click', () => {
  if (submitted || phase !== 'play' || !game) return;
  const data = GAMES[game].data();
  submitted = true;
  $('submit-btn').hidden = true;
  freezeAll();
  NET.send({ action: 'submit', type: game, data });
  dbg('tentative envoyée', { game, data });
  $('phase-sub').textContent = 'validé ✔ — en attente des autres…';
});

// ============================================================ serveur
NET.on('room', (msg) => {
  you = msg.you;
  $('room-code').textContent = msg.code;
  const me = msg.players.find((p) => p.id === you);
  isHost = !!(me && me.host);
  $('players').innerHTML = msg.players.map((p) =>
    `<li><span class="pp">${esc(p.avatar || '🙂')}</span>${esc(p.name)}${p.host ? ' <span class="tag">MJ</span>' : ''}</li>`).join('');
  $('host-config').hidden = !isHost;
  $('need-players').textContent = msg.players.length < 2 ? 'ça marche aussi en solo, mais c\'est plus drôle à plusieurs' : '';
  if (msg.phase === 'lobby' && phase === 'lobby') show('lobby');
});

NET.on('error', (msg) => showError(msg.message));
NET.on('closed', () => { if (you) showError('connexion au serveur perdue'); });
NET.on('ready', (msg) => { $('ready-line').textContent = `${msg.ids.length}/${msg.of} ont validé`; });

NET.on('phase', (msg) => { phase = msg.phase; dbg('phase → ' + msg.phase, msg); (PHASES[msg.phase] || (() => {}))(msg); });

const PHASES = {
  // --- on montre la cible ---
  memorize(msg) {
    show('game'); game = msg.game; submitted = false;
    $('hud-round').textContent = `${msg.round} / ${msg.of}`;
    $('hud-diff').textContent = String(msg.difficulty || '').toUpperCase();
    const gi = GAME_INFO[game];
    $('phase-title').textContent = `${gi.icon} ${gi.name} — mémorise !`;
    $('phase-sub').textContent = gi.memo;
    showStage(game);
    $('submit-btn').hidden = true; $('next-btn').hidden = true; $('to-lobby').hidden = true;
    $('scores').hidden = true; $('ready-line').textContent = '';
    GAMES[game].showTarget(msg.target);
    runBar(msg.ms);
  },

  // --- l'UI repart de zéro : à toi de reproduire ---
  play(msg) {
    show('game'); game = msg.game; submitted = false;
    const gi = GAME_INFO[game];
    $('phase-title').textContent = `${gi.icon} ${gi.name} — reproduis !`;
    $('phase-sub').textContent = gi.play;
    showStage(game);
    GAMES[game].reset();
    $('submit-btn').hidden = false; $('next-btn').hidden = true;
    $('ready-line').textContent = '';
    runBar(msg.ms);
  },

  // --- cible + valeurs de tout le monde ---
  reveal(msg) {
    show('game'); stopBar(); freezeAll();
    if (game === 'time') TIME.freeze();
    $('phase-title').textContent = `🏁 Résultats — manche ${msg.round}/${msg.of}`;
    $('phase-sub').textContent = '';
    $('submit-btn').hidden = true; $('ready-line').textContent = '';
    renderReveal(msg);
    $('next-btn').hidden = !isHost;
    $('next-btn').textContent = msg.round >= msg.of ? '→ Podium' : '→ Manche suivante';
    $('scores').hidden = false;
    $('scores').innerHTML = msg.scores.map((p, i) =>
      `<li>${i + 1}. <span class="pp">${esc(p.avatar || '🙂')}</span>${esc(p.name)}<span class="pts">${p.score}</span></li>`).join('');
  },

  end(msg) {
    show('game'); stopBar(); freezeAll(); SOUND.stop();
    showStage(null); $('reveal-view').hidden = true;
    $('phase-title').textContent = '🏆 Fin de partie';
    $('phase-sub').textContent = 'le podium';
    $('submit-btn').hidden = true; $('next-btn').hidden = true; $('to-lobby').hidden = false;
    const medals = ['🥇', '🥈', '🥉'];
    $('scores').hidden = false;
    $('scores').innerHTML = msg.podium.map((p, i) =>
      `<li>${medals[i] || '·'} <span class="pp">${esc(p.avatar || '🙂')}</span>${esc(p.name)}<span class="pts">${p.score} pts</span></li>`).join('');
  },
};

// --- affichage des résultats ------------------------------------------------
const accClass = (a) => a >= 80 ? 'a-hi' : (a >= 45 ? 'a-mid' : 'a-lo');

function deltaText(g, r) {
  if (!r.submitted) return 'pas validé';
  const d = r.deltas || {};
  if (g === 'shape') return `pos ${d.pos}  ·  taille ${d.scale}  ·  angle ${d.rot}°`;
  if (g === 'color') return `teinte ${d.h}°  ·  sat ${d.s}  ·  lum ${d.l}`;
  if (g === 'sound') return `${d.hz > 0 ? '+' : ''}${d.hz} Hz  (${Math.round(d.cents)} cents)`;
  return `${d.ms > 0 ? '+' : ''}${d.ms} ms`;
}

function renderReveal(msg) {
  const g = msg.game, t = msg.target;
  const mine = msg.results.find((r) => r.id === you);
  showStage(null);
  $('reveal-view').hidden = false;
  const cmp = $('rv-compare'); cmp.innerHTML = '';
  $('rv-canvas').hidden = true;

  if (g === 'color') {
    const sw = (col, lbl) => `<div><div class="swatch" style="background:${col}"></div><p class="rv-lbl">${lbl}</p></div>`;
    cmp.innerHTML = sw(`hsl(${t.h} ${t.s}% ${t.l}%)`, 'la cible')
      + (mine && mine.data ? sw(`hsl(${mine.data.h} ${mine.data.s}% ${mine.data.l}%)`, 'ta couleur') : '');
  } else if (g === 'shape') {
    // on réaffiche le plateau : cible en pointillés + ta forme
    $('stage-shape').hidden = false;
    $('reveal-view').hidden = false;
    SHAPE.compare(t, mine && mine.data);
    cmp.innerHTML = '<p class="rv-lbl">— pointillés : la cible · plein : ta forme —</p>';
  } else if (g === 'sound') {
    cmp.innerHTML = `<div><p class="rv-lbl">cible</p><b>${SOUND.label(t.frequency)}</b></div>`
      + (mine && mine.data ? `<div><p class="rv-lbl">toi</p><b>${SOUND.label(mine.data.frequency)}</b></div>` : '');
    const btn = document.createElement('button');
    btn.className = 'ghost'; btn.textContent = '🔊 réécouter la cible';
    btn.addEventListener('click', () => SOUND.play(t.frequency, 1200));
    cmp.appendChild(btn);
  } else {
    cmp.innerHTML = `<div><p class="rv-lbl">cible</p><b>${TIME.fmt(t.target_ms)} s</b></div>`
      + (mine && mine.data ? `<div><p class="rv-lbl">toi</p><b>${TIME.fmt(mine.data.ms)} s</b></div>` : '');
  }

  $('rv-list').innerHTML = msg.results.map((r, i) =>
    `<div class="rv-row${r.id === you ? ' me' : ''}">`
    + `<span class="rk">${i + 1}</span>`
    + `<span><span class="pp">${esc(r.avatar || '🙂')}</span>${esc(r.name)}<br><span class="rd">${deltaText(g, r)}</span></span>`
    + `<span></span><span class="ra ${accClass(r.accuracy)}">${r.accuracy.toFixed(1)} %</span></div>`).join('');
}
