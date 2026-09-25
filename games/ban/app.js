// UI du Jeu du Ban. Le serveur arbitre TOUT ; le MJ pilote le rythme (lance la
// vidéo, passe, avance). Cette page obéit et affiche.
//   preview : le MJ lance la découverte (startAt → le mot), timecode visible
//   turn    : le JOUEUR ACTIF lance sa vidéo, AUCUN timer affiché (instinct) ;
//             seul lui peut STOP ; sinon fin de vidéo = dépassement
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
let nbJoueurs = 0;            // taille du salon, pour « Lancer la partie »

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
  // AU MOMENT DU JEU, aucun timer : on joue à l'instinct. Le timecode ne tourne
  // qu'en découverte (et s'affiche figé en résultats).
  if (rafMode !== 'turn') $('timecode').textContent = fmtClock(t);
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
  $('timecode').hidden = p !== 'preview';   // timer visible en découverte SEULEMENT (pas pendant le jeu)
  $('live-ruler').hidden = !inGame;
  $('results-view').hidden = p !== 'results';
  $('scores').hidden = p !== 'end';
}
function hideHostBtns() { $('play-btn').hidden = true; $('host-skip').hidden = true; $('host-next').hidden = true; }
function showHostBtn(id, label) { const b = $(id); b.hidden = !(isHost && label); if (label) b.textContent = label; }

// --- ordre de passage ------------------------------------------------------
function ensureColors(list) { list.forEach((o, i) => { if (!colorById[o.id]) colorById[o.id] = PALETTE[Object.keys(colorById).length % PALETTE.length]; nameById[o.id] = o.name; }); }
function renderOrder(order) {
  curOrder = order; ensureColors(order);
  $('order-chips').innerHTML = order.map((o) => {
    let cls = 'chip'; if (o.active) cls += ' active'; else if (o.skipped) cls += ' skip'; else if (o.overshoot) cls += ' over'; else if (o.done) cls += ' done';
    const tc = o.done ? (o.skipped ? 'passé' : (o.time == null ? '—' : fmtClock(o.time))) : '';
    return `<span class="${cls}"><span class="num">${o.n}.</span>${GameAvatar.slot(o.avatar, undefined, 'sm')} ${esc(o.name)}${tc ? ` <span class="tc">(${tc})</span>` : ''}</span>`;
  }).join('');
  GameAvatar.fill($('order-chips'));
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
    return `<div class="res-row" style="--g-av-ring:${colorById[r.id] || '#fff'}"><span class="rn g-player" style="color:${colorById[r.id] || '#fff'}">${GameAvatar.slot(r.avatar, undefined, 'md')}<span class="g-player-name">${esc(r.name)}</span></span>`
      + `<span class="rd">${d}</span><span class="rp ${cls(r.points)}">${r.points > 0 ? '+' : ''}${r.points}</span></div>`;
  }).join('');
  GameAvatar.fill($('res-table'));
}

// --- accueil ---------------------------------------------------------------
const AVATARS = ['😎', '🤐', '🙊', '🤫', '🦊', '🐼', '🔥', '⚡', '🎬', '🎧', '🍿', '🚫'];
myAvatar = GameProfile.startEmoji(AVATARS); // profil local, sinon un repli stable
for (const em of AVATARS) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'avatar-pick' + (em === myAvatar ? ' picked' : ''); b.textContent = em; b.setAttribute('aria-pressed', String(em === myAvatar));
  b.addEventListener('click', () => { myAvatar = em; document.querySelectorAll('.avatar-pick').forEach((x) => { x.classList.toggle('picked', x === b); x.setAttribute('aria-pressed', String(x === b)); }); });
  $('avatar-row').appendChild(b);
}
// Avertissement : on ne peut créer/rejoindre qu'après avoir coché la case.
// Le choix est retenu localement pour ne pas le redemander à chaque partie.
const TW_KEY = 'ban-tw-ok';
// Entrée venue du Game Hub, suspendue à la case (voir plus bas) : { code }.
let entreeEnAttente = null;
function applyTw(ok) {
  $('host').disabled = !ok;
  $('join').disabled = !ok;
  $('tw-check').checked = ok;
}
$('tw-check').addEventListener('change', (e) => {
  const ok = e.target.checked;
  applyTw(ok);
  try { ok ? localStorage.setItem(TW_KEY, '1') : localStorage.removeItem(TW_KEY); } catch (_) {}
  // Case cochée : l'entrée demandée par le Hub reprend là où elle attendait.
  if (ok && entreeEnAttente) { const e2 = entreeEnAttente; entreeEnAttente = null; enter(e2.code); }
});
applyTw((() => { try { return localStorage.getItem(TW_KEY) === '1'; } catch (_) { return false; } })());

$('host').addEventListener('click', () => enter());
$('join').addEventListener('click', () => enter($('code-input').value));
$('code-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') enter($('code-input').value); });
async function enter(code) {
  const name = $('name-input').value.trim();
  if (!name) return showError('il te faut un pseudo');
  if (code !== undefined && !code.trim()) return showError('rentre un code de room');
  showError('');
  // L'avatar complet : la photo du profil s'il y en a une, l'emoji toujours.
  const avatar = GameProfile.joinAvatar(myAvatar);
  try { await NET.connect(); NET.send(code === undefined ? { action: 'join', name, avatar } : { action: 'join', name, code, avatar }); }
  catch (err) {
    showError(err.message);
    // Entrée lancée par le Hub et ratée : on le dit, sinon le groupe attend un
    // joueur qui n'arrivera jamais.
    if (lien && viaHub && !you) { viaHub = false; lien.failed('UNREACHABLE', err.message); }
  }
}

// --- lancé par le Game Hub -------------------------------------------------
// Si la page a été ouverte par le Hub, un billet dit si l'on CRÉE la partie
// (l'hôte du lancement) ou si l'on REJOINT le code du groupe. Dans les deux cas
// on passe par `enter()`, le chemin normal de cette page : aucun second système
// de création ni de join.
// ⚠️ L'avertissement se demande à l'ENTRÉE, comme à la main : `enter()` ne
// regarde pas la case (ce sont les boutons désactivés qui la font respecter),
// donc une entrée venue du Hub attend qu'elle soit cochée. Déjà acceptée
// (`ban-tw-ok`) : on entre tout de suite. Une fois dans le salon, plus jamais
// redemandée — ni aux changements de phase, ni au retour au salon.
// ⚠️ Sans billet, `lien` vaut null et la page marche exactement comme avant.
let viaHub = false;            // le join en cours vient du Hub
let partirSansAttendre = false;
let codeDeclare = null;        // le code déjà annoncé au Hub (une seule fois)
const lien = window.HubHandoff ? HubHandoff.start({
  gameId: 'ban',
  join: (code) => {
    viaHub = true;
    if (!$('name-input').value.trim()) $('name-input').value = GameProfile.load().name || '';
    if ($('tw-check').checked) return enter(code || undefined);
    entreeEnAttente = { code: code || undefined };
    showError('coche l\'avertissement ci-dessus pour rejoindre la partie de ton groupe');
    $('tw-check').focus();
  },
  onUpdate: attente,
}) : null;

// L'hôte ne lance pas tant que le groupe n'est pas dans la room : ban-server
// refuse un join quand la phase n'est plus `lobby` (« partie en cours »), donc un
// invité en retard serait laissé dehors. Il peut partir sans eux — explicitement.
// Hors Hub, seule la règle habituelle s'applique : au moins 2 joueurs.
function attente(i) {
  const n = i && i.launch.stage === 'join' ? i.waitingIds.length : 0;
  const bloque = isHost && n > 0 && !partirSansAttendre;
  $('start').disabled = bloque || nbJoueurs < 2;
  $('start').textContent = bloque ? `En attente de ${i.waiting}…` : 'Lancer la partie';
  $('start-anyway').hidden = !bloque;
}

const lancer = () => NET.send({ action: 'start', videos: +$('videos-select').value });
$('start').addEventListener('click', lancer);
$('start-anyway').addEventListener('click', () => { partirSansAttendre = true; lancer(); });
$('room-code').addEventListener('click', async () => {
  const hint = $('code-hint');
  const back = () => setTimeout(() => { hint.textContent = 'clique sur le code pour le copier'; }, 2000);
  try {
    await navigator.clipboard.writeText($('room-code').textContent.trim());
    hint.textContent = 'code copié ✔';
  } catch (_) {
    // Presse-papiers refusé (permission, page non sécurisée) : on ne fait pas
    // semblant, le joueur doit savoir qu'il faut lire le code à la main.
    hint.textContent = 'copie impossible — recopie le code à la main';
  }
  back();
});
$('to-lobby').addEventListener('click', () => { phase = 'lobby'; show('lobby'); });

// contrôles MJ
$('play-btn').addEventListener('click', () => NET.send({ action: 'play' }));
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
  // Lancé par le Hub : on lui dit dans quelle room on est. L'hôte y déclare le
  // code (le seul qu'il croira), les invités confirment y être entrés. ⚠️ `room`
  // arrive à CHAQUE changement du salon : une seule annonce.
  if (lien && !codeDeclare) { codeDeclare = msg.code; viaHub = false; lien.roomReady(msg.code); }
  nbJoueurs = msg.players.length;
  msg.players.forEach((p) => { if (!colorById[p.id]) colorById[p.id] = PALETTE[Object.keys(colorById).length % PALETTE.length]; nameById[p.id] = p.name; });
  const me = msg.players.find((p) => p.id === you);
  isHost = !!(me && me.host);
  $('players').innerHTML = msg.players.map((p) =>
    `<li class="g-player">${GameAvatar.slot(p.avatar, undefined, 'md')}<span class="g-player-name">${esc(p.name)}${p.host ? ' <span class="tag">MJ</span>' : ''}</span></li>`).join('');
  GameAvatar.fill($('players'));
  $('host-config').hidden = !isHost;
  attente(lien && lien.info());
  $('need-players').hidden = msg.players.length >= 2;
  // Retour au salon, SAUF derrière le podium : le serveur envoie `phase:end`
  // PUIS un `room` en phase lobby, qui ne doit pas l'effacer (#to-lobby y
  // ramène). Tout autre `room` lobby est un retour forcé (« plus assez de
  // joueurs ») : avant, la garde `phase === 'lobby'` laissait le joueur coincé
  // sur l'écran de jeu, sans aucun bouton pour en sortir.
  if (msg.phase === 'lobby' && phase !== 'end') {
    phase = 'lobby';
    show('lobby');
  }
});

NET.on('error', (msg) => {
  showError(msg.message);
  // Le serveur refuse d'entrer (code inconnu, room pleine, partie en cours) :
  // le Hub est prévenu, pour que le groupe le sache au lieu d'attendre.
  if (lien && viaHub && !you) { viaHub = false; lien.failed('JOIN', msg.message); }
});
NET.on('closed', () => { if (you) showError('connexion au serveur perdue'); });

// lancement de la vidéo : découverte (MJ) ou tour (joueur actif)
NET.on('play', () => {
  dbg('play reçu', { phase });
  const v = V();
  $('play-btn').hidden = true;
  v.currentTime = curFrom || 0; v.muted = false; tryPlay();

  if (phase === 'preview') {                       // découverte : coupe au mot
    $('phase-badge').textContent = '👀 découverte';
    startRaf('preview');
    status(isHost ? 'ensuite : lance les passages' : 'découverte en cours…');
    return;
  }

  // tour : la vidéo tourne librement, AUCUN timer affiché (instinct)
  turnPlaying = true;
  $('video-box').classList.add('live');
  $('phase-badge').textContent = '🔴 en jeu';
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
  $('stop-btn').hidden = true; $('play-btn').hidden = true; $('host-skip').hidden = true;
  $('video-box').classList.remove('live');
  $('phase-badge').textContent = msg.skipped ? '⏭ passé' : (msg.overshoot ? '💥 mot lâché' : '✅ stoppé');
  const who = msg.id === you ? 'Toi' : esc(msg.name);
  status(msg.skipped ? `${who} passé` : (msg.overshoot ? `💥 ${who} a lâché le mot` : `✅ ${who} a stoppé à ${fmtClock(msg.time)}`));
  if (isHost) {
    const allDone = curOrder.every((x) => x.done);
    showHostBtn('host-next', allDone ? '→ Résultats' : '→ Joueur suivant');
  }
});

NET.on('phase', (msg) => { phase = msg.phase; dbg('phase → ' + msg.phase, msg); (PHASES[msg.phase] || (() => {}))(msg); });

const PHASES = {
  preview(msg) {
    show('game'); parts('preview'); stopRaf();
    curFrom = msg.from || 0; previewUntil = msg.until; curActive = null; turnStopped = false; turnPlaying = false;
    loadVideo(msg.videoId); renderOrder(msg.order || []);
    // Première vidéo : la partie a vraiment démarré, le Hub le sait. (Le serveur
    // passe d'abord par `starting`, le temps de relire son catalogue ; il n'en
    // dit rien — c'est cette découverte qui fait foi.)
    if (msg.round === 1 && lien && isHost) lien.started();
    $('turn-title').innerHTML = `👀 Découverte — vidéo ${msg.round}/${msg.of}`;
    $('phase-badge').textContent = '👀 découverte';
    $('video-box').classList.remove('live');
    hideHostBtns(); $('stop-btn').hidden = true; $('wait-turn').hidden = true; $('to-lobby').hidden = true; $('to-hub').hidden = true;
    // PAS d'autoplay : c'est le MJ qui lance la découverte quand il veut.
    const v = V();
    const seek = () => { v.currentTime = curFrom; v.pause(); $('timecode').textContent = fmtClock(curFrom); updatePlayhead(curFrom); };
    if (v.readyState >= 1) seek(); else v.addEventListener('loadedmetadata', seek, { once: true });
    showHostBtn('play-btn', '▶ Lancer la découverte');
    showHostBtn('host-next', '⏭ Passer aux passages');
    status(isHost ? 'lance la découverte quand tout le monde est prêt' : 'le MJ va lancer la découverte…');
  },

  turn(msg) {
    show('game'); parts('turn'); stopRaf();
    curFrom = msg.from || 0; curActive = msg.active; youActive = !!msg.youActive; turnStopped = false; turnPlaying = false;
    loadVideo(msg.videoId); renderOrder(msg.order || []);
    // « C'est à qui ? » : l'avatar du joueur actif, pris dans l'ordre de passage.
    const actif = (msg.order || []).find((o) => o.active);
    $('turn-title').innerHTML = `<span class="g-player turn-who">${actif ? GameAvatar.slot(actif.avatar, undefined, 'md') : ''}`
      + `<span>tour de <b>${esc(msg.activeName)}</b></span></span>`;
    GameAvatar.fill($('turn-title'));
    $('phase-badge').textContent = '⏸ prêt';
    $('video-box').classList.remove('live');
    $('stop-btn').hidden = true; $('wait-turn').hidden = true; $('to-lobby').hidden = true; $('to-hub').hidden = true;
    const v = V();
    const seek = () => { v.currentTime = curFrom; v.pause(); updatePlayhead(curFrom); };
    if (v.readyState >= 1) seek(); else v.addEventListener('loadedmetadata', seek, { once: true });
    // C'EST LE JOUEUR ACTIF qui lance sa vidéo (le MJ peut aussi, au cas où).
    $('play-btn').hidden = !(youActive || isHost);
    $('play-btn').textContent = youActive ? '▶ Lancer MA vidéo' : '▶ Lancer la vidéo';
    $('host-skip').hidden = !isHost;
    $('host-next').hidden = true;
    status(youActive ? 'à toi : lance ta vidéo quand tu es prêt' : `au tour de ${esc(msg.activeName)}…`);
  },

  results(msg) {
    show('game'); parts('results'); stopRaf(); V().pause();
    $('turn-title').innerHTML = `🏁 RÉSULTATS — round ${msg.round}`;
    $('phase-badge').textContent = '🏁';
    $('video-box').classList.remove('live');
    renderResults(msg);
    hideHostBtns(); $('stop-btn').hidden = true; $('wait-turn').hidden = true; $('to-lobby').hidden = true; $('to-hub').hidden = true;
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
      `<li class="g-player"><span class="medal">${medals[i] || '·'}</span>${GameAvatar.slot(p.avatar, undefined, i < 3 ? 'lg' : 'md')}<span class="g-player-name">${esc(p.name)}</span> <span class="pts g-player-score">${p.score} pts</span></li>`).join('');
    GameAvatar.fill($('scores'));
    $('to-lobby').hidden = false;
    if (lien) { lien.ended(); $('to-hub').hidden = false; }
    status('bien joué');
  },
};
