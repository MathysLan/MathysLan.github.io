// UI du Jeu du Ban. Le serveur ordonne les phases et arbitre TOUT (rythme,
// scoring, timeout d'un joueur inactif) ; cette page ne fait qu'obéir et
// afficher. Elle ne connaît JAMAIS le `fatal` avant la phase results — donc
// aucun moyen de tricher côté front.
//
//   preview      : on lit le contexte JUSQU'AU mot (coupe pile au fatal, auto)
//   player_turn  : la vidéo tourne LIBREMENT ; seul le joueur actif peut STOP.
//                  s'il ne clique pas, la vidéo va au bout → stop auto (dépassement)
//   stopped      : issue d'un tour (temps/points, mot lâché ou pas)
//   results      : le `fatal` est révélé + classement de la vidéo
//   end          : podium

let you = null, isHost = false, myAvatar = null;
let phase = 'lobby';
let youActive = false;
let turnStopped = false;      // ai-je déjà envoyé mon stop pour ce tour ?
let curVideoId = null;
let rafId = 0;

// Debug console : ouvre la console (F12) et renvoie-moi les lignes [ban].
const DEBUG = true;
const dbg = (msg, obj) => { if (DEBUG) console.log('[ban] ' + msg, obj !== undefined ? obj : ''); };

// Le serveur ne connaît que l'id ; le front en déduit l'URL du CDN.
// ?cdn=... permet de tester en local (défaut : le bucket R2 de prod).
const CDN = (new URLSearchParams(location.search).get('cdn')
  || 'https://pub-427c946793104d1f8e39fbf6d5584ba9.r2.dev').replace(/\/$/, '');
const videoUrl = (id) => `${CDN}/${id}.mp4`;

const PALETTE = ['#ef4444', '#f59e0b', '#34d399', '#38bdf8', '#f472b6', '#facc15', '#a3e635', '#c084fc', '#22d3ee', '#fb7185'];
const colorById = {};

const $ = (id) => document.getElementById(id);
const show = (id) => { for (const s of document.querySelectorAll('main > section')) s.hidden = s.id !== id; };
const showError = (m) => { $('error').textContent = m ? '> ' + m : ''; };
const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const setStage = (t, s) => { $('stage-title').innerHTML = t; $('stage-sub').innerHTML = s; };

// --- lecteur vidéo ---------------------------------------------------------
const V = () => $('ban-video');
function loadVideo(id) {
  const v = V();
  if (curVideoId !== id) { curVideoId = id; v.src = videoUrl(id); v.load(); }
}
function stopRaf() { if (rafId) cancelAnimationFrame(rafId); rafId = 0; }

// autoplay bloqué (rare après un clic) : on laisse toucher la vidéo pour lancer
function tryPlay() {
  V().play().catch(() => {
    $('big-timer').textContent = '▶ touche la vidéo';
    const v = V();
    const once = () => { v.removeEventListener('click', once); v.play().catch(() => {}); };
    v.addEventListener('click', once);
  });
}

function resetStage() {
  $('stop-btn').hidden = true; $('to-lobby').hidden = true; $('wait-turn').hidden = true; $('scores').hidden = true;
  $('video-box').classList.remove('live');
  $('big-timer').textContent = '';   // aucun chrono : c'est un jeu d'instinct
}

// Envoi du stop (clic OU fin de vidéo). On envoie NOTRE currentTime ; le serveur
// le recoupe à son horloge (anti-triche). Un seul stop par tour.
function sendStop(t, cause) {
  if (turnStopped || phase !== 'player_turn' || !youActive) return;
  turnStopped = true;
  const time = +Number(t).toFixed(3);
  V().pause(); stopRaf();
  $('stop-btn').hidden = true;
  NET.send({ action: 'stop', time });
  dbg('STOP envoyé', { time, cause });
  setStage('✋ Stop !', 'on regarde si tu as tenu…');
}

// Logs des événements vidéo (chargement, seek, erreurs, fin) — pour le debug.
(function wireVideoDebug() {
  const v = V();
  v.addEventListener('loadedmetadata', () => dbg('vidéo chargée', { duration: +v.duration.toFixed(3), src: v.currentSrc }));
  v.addEventListener('seeked', () => dbg('seek ok', { currentTime: +v.currentTime.toFixed(3) }));
  v.addEventListener('ended', () => dbg('vidéo terminée', { at: +v.currentTime.toFixed(3) }));
  v.addEventListener('error', () => dbg('ERREUR vidéo', { code: v.error && v.error.code, src: v.currentSrc }));
})();

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
// depuis le podium : on revient au lobby (le serveur y est déjà, prêt à relancer)
$('to-lobby').addEventListener('click', () => { phase = 'lobby'; show('lobby'); });

// STOP : seul le joueur actif, pendant player_turn.
$('stop-btn').addEventListener('click', () => sendStop(V().currentTime, 'clic'));

// --- messages serveur ------------------------------------------------------
NET.on('room', (msg) => {
  you = msg.you;
  $('room-code').textContent = msg.code;
  msg.players.forEach((p, i) => { if (!colorById[p.id]) colorById[p.id] = PALETTE[i % PALETTE.length]; });
  const me = msg.players.find((p) => p.id === you);
  isHost = !!(me && me.host);
  $('players').innerHTML = msg.players.map((p) =>
    `<li><span class="pp">${esc(p.avatar || '🙂')}</span>${esc(p.name)}${p.host ? ' <span class="tag">MJ</span>' : ''}</li>`).join('');
  $('host-config').hidden = !isHost;
  $('start').disabled = msg.players.length < 2;
  $('need-players').hidden = msg.players.length >= 2;
  renderScores(msg.players);
  // On n'affiche le lobby QUE si on n'est pas déjà en jeu ou sur le podium :
  // en fin de partie, le serveur renvoie un état 'lobby' juste après le 'end',
  // et on ne veut pas écraser le podium (le joueur y revient via le bouton).
  if (msg.phase === 'lobby' && phase === 'lobby') show('lobby');
});

NET.on('error', (msg) => showError(msg.message));
NET.on('closed', () => { if (you) showError('connexion au serveur perdue'); });

NET.on('stopped', (msg) => {
  dbg('reçu stopped', msg);
  stopRaf(); V().pause();
  $('stop-btn').hidden = true; $('wait-turn').hidden = true;
  $('video-box').classList.remove('live');
  $('phase-badge').textContent = msg.overshoot ? '💥 mot lâché' : '✅ stoppé';
  const who = msg.id === you ? 'Toi' : esc(msg.name);
  setStage(
    msg.overshoot ? `💥 ${who} a laissé sortir le mot` : `✅ ${who} a stoppé à ${msg.time}s`,
    `${msg.points >= 0 ? '+' : ''}${msg.points} pts · au suivant…`,
  );
});

NET.on('phase', (msg) => { phase = msg.phase; dbg('phase → ' + msg.phase, msg); (PHASES[msg.phase] || (() => {}))(msg); });

const PHASES = {
  // Découverte : on lit de `from` (startAt) JUSQU'AU mot (`until` = fatal), puis on fige.
  preview(msg) {
    show('game'); resetStage();
    loadVideo(msg.videoId);
    const v = V();
    $('phase-badge').textContent = '👀 découverte';
    setStage(`Vidéo ${msg.round}/${msg.of} — 👀 Découverte`,
      'on regarde le contexte, jusqu\'au mot interdit');
    const start = () => {
      v.currentTime = msg.from || 0; v.muted = false; tryPlay(); guardUntil(msg.until);
      dbg('preview start', { videoId: msg.videoId, from: msg.from, until: msg.until });
    };
    if (v.readyState >= 1) start();
    else v.addEventListener('loadedmetadata', start, { once: true });
  },

  // Tour d'un joueur : la vidéo tourne LIBREMENT (aucune coupe auto). Seul l'actif
  // a le bouton STOP. S'il ne clique pas, la vidéo va au bout → stop auto = dépassement.
  player_turn(msg) {
    show('game'); resetStage();
    loadVideo(msg.videoId);
    youActive = !!msg.youActive;
    turnStopped = false;
    const v = V();
    $('phase-badge').textContent = '🔴 en jeu';
    $('video-box').classList.add('live');
    setStage(
      youActive ? '🎬 À TOI — arrête avant le mot !' : `🎬 ${esc(msg.activeName)} joue`,
      youActive ? 'clique STOP le plus tard possible… sans lâcher le mot' : 'regarde — personne d\'autre ne peut stopper',
    );
    $('stop-btn').hidden = !youActive;
    $('wait-turn').hidden = youActive;
    if (!youActive) $('wait-turn').textContent = `c'est le tour de ${esc(msg.activeName)}…`;
    // fin naturelle : si l'actif ne clique pas, la vidéo va au bout → stop auto (dépassement)
    if (youActive) v.addEventListener('ended', () => sendStop(V().currentTime, 'fin de vidéo'), { once: true });
    // pas de chrono affiché : on lit juste la vidéo, l'instinct fait le reste
    const start = () => {
      v.currentTime = msg.from || 0; v.muted = false; tryPlay();
      dbg('player_turn start', { videoId: msg.videoId, from: msg.from, youActive });
    };
    if (v.readyState >= 1) start();
    else v.addEventListener('loadedmetadata', start, { once: true });
  },

  // Résultats de la vidéo : le `fatal` est enfin révélé.
  results(msg) {
    show('game'); resetStage(); stopRaf(); V().pause();
    $('phase-badge').textContent = '🏁 résultats';
    setStage(`🏁 Vidéo ${msg.round}/${msg.of} — le mot était à ${msg.fatal}s`, 'classement de la vidéo');
    renderScores(msg.scores);
    $('scores').hidden = false;
    const medals = ['🥇', '🥈', '🥉'];
    $('scores').innerHTML = msg.ranking.map((r, i) => {
      const tag = r.overshoot ? '💥 dépassé' : `${r.time}s`;
      return `<li>${medals[i] || '·'} <span class="pp" style="color:${colorById[r.id] || '#fff'}">${esc(r.avatar || '🙂')}</span>${esc(r.name)} <span class="pts">${tag} · ${r.points >= 0 ? '+' : ''}${r.points}</span></li>`;
    }).join('');
  },

  end(msg) {
    show('game'); resetStage(); stopRaf(); V().pause();
    $('phase-badge').textContent = '🏆 fin';
    setStage('🏆 Fin de partie', 'le podium');
    renderScores(msg.podium);
    $('scores').hidden = false;
    const medals = ['🥇', '🥈', '🥉'];
    $('scores').innerHTML = msg.podium.map((p, i) =>
      `<li>${medals[i] || '·'} <span class="pp">${esc(p.avatar || '🙂')}</span>${esc(p.name)} <span class="pts">${p.score} pts</span></li>`).join('');
    $('to-lobby').hidden = false;
  },
};

// Preview : on surveille juste la lecture pour COUPER à `until` (avant le mot).
// Aucun chrono affiché — ni ici ni pendant les tours : c'est un jeu d'instinct.
function guardUntil(until) {
  stopRaf();
  const v = V();
  const loop = () => {
    if (v.currentTime >= until) { v.pause(); rafId = 0; return; }
    rafId = requestAnimationFrame(loop);
  };
  rafId = requestAnimationFrame(loop);
}

// --- scores ----------------------------------------------------------------
let lastScores = [];
function renderScores(list) { lastScores = [...list]; renderScoresLive(); }
function renderScoresLive() {
  $('scores-live').innerHTML = [...lastScores].sort((a, b) => b.score - a.score).map((p) =>
    `<li><span class="pp" style="color:${colorById[p.id] || '#fff'}">${esc(p.avatar || '🙂')}</span>${esc(p.name)}<span class="pts">${p.score}</span></li>`).join('');
}
