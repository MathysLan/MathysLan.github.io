// UI du Jeu du Ban. Le serveur arbitre TOUT ; le MJ pilote le rythme (lance la
// vidéo, passe, avance). Cette page obéit et affiche.
//   preview : découverte de startAt jusqu'au mot (auto)
//   turn    : le MJ lance la vidéo ; seul l'actif peut STOP ; sinon fin auto = dépassement
//   results : timeline zoomée sur le mot + classement (écarts)
//   end     : podium
//
// Debug console : ouvre F12 et renvoie-moi les lignes [ban].

let you = null, isHost = false, myAvatar = null;
let phase = 'lobby';
let youActive = false, turnStopped = false, turnPlaying = false;
let curVideoId = null, curFrom = 0, curActive = null, previewUntil = 0;
let curOrder = [];
let rafId = 0, rafMode = null;

const DEBUG = true;
const dbg = (m, o) => { if (DEBUG) console.log('[ban] ' + m, o !== undefined ? o : ''); };

// Le serveur ne connaît que l'id ; le front en déduit l'URL du CDN. ?cdn= pour tester.
const CDN = (new URLSearchParams(location.search).get('cdn')
  || 'https://pub-427c946793104d1f8e39fbf6d5584ba9.r2.dev').replace(/\/$/, '');
const videoUrl = (id) => `${CDN}/${id}.mp4`;

const PALETTE = ['#ef4444', '#f59e0b', '#34d399', '#38bdf8', '#f472b6', '#facc15', '#a3e635', '#c084fc', '#22d3ee', '#fb7185'];
const colorById = {}, nameById = {};

const $ = (id) => document.getElementById(id);
const show = (id) => { for (const s of document.querySelectorAll('main > section')) s.hidden = s.id !== id; };
const showError = (m) => { $('error').textContent = m ? '> ' + m : ''; };
const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const status = (s) => { $('status-bar').textContent = s || ''; };

// --- formats de temps ------------------------------------------------------
function fmtClock(t) { t = Math.max(0, t); const m = Math.floor(t / 60); return m + ':' + (t - m * 60).toFixed(3).padStart(6, '0'); }
function fmtClock2(t) { t = Math.max(0, t); const m = Math.floor(t / 60); return String(m).padStart(2, '0') + ':' + (t - m * 60).toFixed(3).padStart(6, '0'); }
function fmtDelta(d) { const s = d < 0 ? '-' : (d > 0 ? '+' : ' '); return s + fmtClock2(Math.abs(d)); }

// --- lecteur vidéo ---------------------------------------------------------
const V = () => $('ban-video');
function loadVideo(id) { const v = V(); if (curVideoId !== id) { curVideoId = id; v.src = videoUrl(id); v.load(); } }
function stopRaf() { if (rafId) cancelAnimationFrame(rafId); rafId = 0; rafMode = null; }
function startRaf(mode) { rafMode = mode; if (rafId) cancelAnimationFrame(rafId); const loop = () => { tickRaf(); rafId = requestAnimationFrame(loop); }; rafId = requestAnimationFrame(loop); }
function tickRaf() {
  const v = V(), t = v.currentTime;
  $('timecode').textContent = fmtClock(t);
  updatePlayhead(t);
  if (rafMode === 'preview' && t >= previewUntil) { v.pause(); dbg('preview coupée au mot', { at: +t.toFixed(3) }); rafMode = 'held'; }
}
function updatePlayhead(t) {
  const dur = V().duration;
  if (!isFinite(dur) || dur <= curFrom) return;
  const pct = Math.max(0, Math.min(1, (t - curFrom) / (dur - curFrom))) * 100;
  $('live-playhead').style.left = pct + '%';
}
function tryPlay() { V().play().catch(() => dbg('autoplay bloqué (clique la vidéo)')); }

// --- visibilité des blocs selon la phase -----------------------------------
function parts(p) {
  const inGame = (p === 'preview' || p === 'turn');
  $('order-panel').hidden = !inGame;
  $('video-box').hidden = !inGame;
  $('timecode').hidden = !inGame;
  $('live-ruler').hidden = !inGame;
  $('results-view').hidden = p !== 'results';
  $('scores').hidden = p !== 'end';
}
function hideHostBtns() { $('host-play').hidden = true; $('host-skip').hidden = true; $('host-next').hidden = true; }
function showHostBtn(id, label) { const b = $(id); b.hidden = !(isHost && label); if (label) b.textContent = label; }

// --- ordre de passage ------------------------------------------------------
function ensureColors(list) { list.forEach((o, i) => { if (!colorById[o.id]) colorById[o.id] = PALETTE[Object.keys(colorById).length % PALETTE.length]; nameById[o.id] = o.name; }); }
function renderOrder(order) {
  curOrder = order; ensureColors(order);
  $('order-chips').innerHTML = order.map((o) => {
    let cls = 'chip'; if (o.active) cls += ' active'; else if (o.skipped) cls += ' skip'; else if (o.overshoot) cls += ' over'; else if (o.done) cls += ' done';
    const tc = o.done ? (o.skipped ? 'passé' : (o.time == null ? '—' : fmtClock(o.time))) : '';
    return `<span class="${cls}"><span class="num">${o.n}.</span> ${esc(o.name)}${tc ? ` <span class="tc">(${tc})</span>` : ''}</span>`;
  }).join('');
}

// --- résultats : timeline zoomée sur le mot + table ------------------------
const RES_HALF = 0.5;   // fenêtre = mot ± 0,5 s (au-delà : flèche sur le côté)
function renderResults(msg) {
  const fatal = msg.fatal, lo = fatal - RES_HALF, hi = fatal + RES_HALF, span = hi - lo;
  $('res-left').textContent = fmtClock2(lo);
  $('res-right').textContent = fmtClock2(hi);
  $('res-fatal').style.left = '50%';
  $('res-fatal').querySelector('.flag').textContent = '🎯 ' + fmtClock2(fatal);

  const marks = $('res-marks'); marks.innerHTML = '';
  let outCount = 0, inCount = 0;
  msg.ranking.forEach((r) => {
    if (r.time == null) return;                       // passé : pas de trait
    const x = (r.time - lo) / span;
    const col = colorById[r.id] || '#fff';
    if (x < 0 || x > 1) {                             // hors fenêtre → flèche sur le bord
      const el = document.createElement('div'); el.className = 'res-out';
      el.style.top = (8 + outCount * 20) + 'px';
      el.style[x < 0 ? 'left' : 'right'] = '6px';
      el.style.color = col;
      el.textContent = (x < 0 ? '← ' : '→ ') + r.name + ' ' + fmtDelta(r.delta);
      marks.appendChild(el); outCount++;
      return;
    }
    const el = document.createElement('div'); el.className = 'res-mark';
    el.style.left = (x * 100) + '%'; el.style.background = col;
    const lbl = document.createElement('span'); lbl.className = 'lbl';
    lbl.style.color = col; lbl.style.top = (inCount % 2 ? -32 : -16) + 'px';
    lbl.textContent = r.name;
    el.appendChild(lbl); marks.appendChild(el); inCount++;
  });

  const cls = (pts) => pts > 0 ? 'pos' : (pts < 0 ? 'neg' : 'zero');
  $('res-table').innerHTML = msg.ranking.map((r) => {
    const d = r.skipped ? 'passé' : (r.time == null ? '—' : fmtDelta(r.delta));
    return `<div class="res-row"><span class="rn" style="color:${colorById[r.id] || '#fff'}">${esc(r.name)}</span>`
      + `<span class="rd">${d}</span><span class="rp ${cls(r.points)}">${r.points > 0 ? '+' : ''}${r.points}</span></div>`;
  }).join('');
}

// --- accueil ---------------------------------------------------------------
const AVATARS = ['😎', '🤐', '🙊', '🤫', '🦊', '🐼', '🔥', '⚡', '🎬', '🎧', '🍿', '🚫'];
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
$('start').addEventListener('click', () => NET.send({ action: 'start', videos: +$('videos-select').value }));
$('room-code').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('room-code').textContent.trim()); $('code-hint').textContent = 'code copié ✔'; setTimeout(() => { $('code-hint').textContent = 'clique sur le code pour le copier'; }, 1500); } catch (_) {} });
$('to-lobby').addEventListener('click', () => { phase = 'lobby'; show('lobby'); });

// contrôles MJ
$('host-play').addEventListener('click', () => NET.send({ action: 'play' }));
$('host-skip').addEventListener('click', () => NET.send({ action: 'skip' }));
$('host-next').addEventListener('click', () => NET.send({ action: 'next' }));
// STOP (joueur actif) ou fin de vidéo
$('stop-btn').addEventListener('click', () => sendStop(V().currentTime, 'clic'));
function sendStop(t, cause) {
  if (turnStopped || phase !== 'turn' || !youActive || !turnPlaying) return;
  turnStopped = true;
  const time = +Number(t).toFixed(3);
  V().pause(); $('stop-btn').hidden = true;
  NET.send({ action: 'stop', time });
  dbg('STOP envoyé', { time, cause });
}

// logs vidéo
(function wireVideoDebug() {
  const v = V();
  v.addEventListener('loadedmetadata', () => dbg('vidéo chargée', { duration: +v.duration.toFixed(3), src: v.currentSrc }));
  v.addEventListener('error', () => dbg('ERREUR vidéo', { code: v.error && v.error.code, src: v.currentSrc }));
})();

// --- messages serveur ------------------------------------------------------
NET.on('room', (msg) => {
  you = msg.you;
  $('room-code').textContent = msg.code;
  msg.players.forEach((p) => { if (!colorById[p.id]) colorById[p.id] = PALETTE[Object.keys(colorById).length % PALETTE.length]; nameById[p.id] = p.name; });
  const me = msg.players.find((p) => p.id === you);
  isHost = !!(me && me.host);
  $('players').innerHTML = msg.players.map((p) =>
    `<li><span class="pp">${esc(p.avatar || '🙂')}</span>${esc(p.name)}${p.host ? ' <span class="tag">MJ</span>' : ''}</li>`).join('');
  $('host-config').hidden = !isHost;
  $('start').disabled = msg.players.length < 2;
  $('need-players').hidden = msg.players.length >= 2;
  if (msg.phase === 'lobby' && phase === 'lobby') show('lobby');
});

NET.on('error', (msg) => showError(msg.message));
NET.on('closed', () => { if (you) showError('connexion au serveur perdue'); });

// le MJ a lancé la vidéo du tour
NET.on('play', () => {
  dbg('play reçu (MJ lance)');
  turnPlaying = true;
  $('video-box').classList.add('live');
  $('host-play').hidden = true;
  const v = V();
  v.currentTime = curFrom || 0; v.muted = false; tryPlay();
  startRaf('turn');
  if (youActive) {
    $('stop-btn').hidden = false;
    status('⏹ STOP au bon moment !');
    v.addEventListener('ended', () => sendStop(V().currentTime, 'fin de vidéo'), { once: true });
  } else {
    status('regarde ' + (nameById[curActive] || '') + '…');
  }
});

NET.on('stopped', (msg) => {
  dbg('stopped', msg);
  const o = curOrder.find((x) => x.id === msg.id);
  if (o) { o.done = true; o.time = msg.time; o.overshoot = !!msg.overshoot; o.skipped = !!msg.skipped; o.active = false; }
  renderOrder(curOrder);
  if (msg.id === curActive) { turnStopped = true; stopRaf(); V().pause(); }
  $('stop-btn').hidden = true;
  $('video-box').classList.remove('live');
  $('phase-badge').textContent = msg.skipped ? '⏭ passé' : (msg.overshoot ? '💥 mot lâché' : '✅ stoppé');
  const who = msg.id === you ? 'Toi' : esc(msg.name);
  status(msg.skipped ? `${who} passé` : (msg.overshoot ? `💥 ${who} a lâché le mot` : `✅ ${who} a stoppé à ${fmtClock(msg.time)}`));
  if (isHost) {
    const allDone = curOrder.every((x) => x.done);
    $('host-play').hidden = true; $('host-skip').hidden = true;
    showHostBtn('host-next', allDone ? '→ Résultats' : '→ Joueur suivant');
  }
});

NET.on('phase', (msg) => { phase = msg.phase; dbg('phase → ' + msg.phase, msg); (PHASES[msg.phase] || (() => {}))(msg); });

const PHASES = {
  preview(msg) {
    show('game'); parts('preview'); stopRaf();
    curFrom = msg.from || 0; previewUntil = msg.until; curActive = null; turnStopped = false; turnPlaying = false;
    loadVideo(msg.videoId); renderOrder(msg.order || []);
    $('turn-title').innerHTML = `👀 Découverte — vidéo ${msg.round}/${msg.of}`;
    $('phase-badge').textContent = '👀 découverte';
    $('video-box').classList.remove('live');
    hideHostBtns(); $('stop-btn').hidden = true; $('wait-turn').hidden = true; $('to-lobby').hidden = true;
    const v = V();
    const start = () => { v.currentTime = curFrom; v.muted = false; tryPlay(); startRaf('preview'); dbg('preview start', { from: curFrom, until: previewUntil }); };
    if (v.readyState >= 1) start(); else v.addEventListener('loadedmetadata', start, { once: true });
    showHostBtn('host-next', '▶ Commencer les passages');
    status(isHost ? 'à toi de lancer les passages quand tu veux' : 'le MJ prépare les passages…');
  },

  turn(msg) {
    show('game'); parts('turn'); stopRaf();
    curFrom = msg.from || 0; curActive = msg.active; youActive = !!msg.youActive; turnStopped = false; turnPlaying = false;
    loadVideo(msg.videoId); renderOrder(msg.order || []);
    $('turn-title').innerHTML = `tour de <b>${esc(msg.activeName)}</b>`;
    $('phase-badge').textContent = '⏸ prêt';
    $('video-box').classList.remove('live');
    $('stop-btn').hidden = true; $('wait-turn').hidden = true; $('to-lobby').hidden = true;
    const v = V();
    const seek = () => { v.currentTime = curFrom; v.pause(); $('timecode').textContent = fmtClock(curFrom); updatePlayhead(curFrom); };
    if (v.readyState >= 1) seek(); else v.addEventListener('loadedmetadata', seek, { once: true });
    if (isHost) { showHostBtn('host-play', '▶ Lancer la vidéo'); showHostBtn('host-skip', '⏭ Passer'); $('host-next').hidden = true; }
    else hideHostBtns();
    status(youActive ? 'prépare-toi… le MJ va lancer la vidéo' : (isHost ? 'lance la vidéo quand tu veux' : `au tour de ${esc(msg.activeName)}`));
  },

  results(msg) {
    show('game'); parts('results'); stopRaf(); V().pause();
    $('turn-title').innerHTML = `🏁 RÉSULTATS — round ${msg.round}`;
    $('phase-badge').textContent = '🏁';
    $('video-box').classList.remove('live');
    renderResults(msg);
    hideHostBtns(); $('stop-btn').hidden = true; $('wait-turn').hidden = true; $('to-lobby').hidden = true;
    showHostBtn('host-next', msg.round >= msg.of ? 'TERMINER LA PARTIE' : 'TERMINER LE ROUND');
    status(isHost ? 'clique pour la suite' : 'en attente du MJ…');
  },

  end(msg) {
    show('game'); parts('end'); stopRaf(); V().pause();
    $('turn-title').innerHTML = '🏆 Fin de partie';
    $('order-panel').hidden = true; $('phase-badge').textContent = '';
    hideHostBtns(); $('stop-btn').hidden = true;
    const medals = ['🥇', '🥈', '🥉'];
    $('scores').innerHTML = msg.podium.map((p, i) =>
      `<li>${medals[i] || '·'} <span class="pp">${esc(p.avatar || '🙂')}</span>${esc(p.name)} <span class="pts">${p.score} pts</span></li>`).join('');
    $('to-lobby').hidden = false;
    status('bien joué');
  },
};
