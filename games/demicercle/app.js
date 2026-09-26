// UI du Jeu du Demi-Cercle. Le serveur ordonne les phases, cette page obéit :
// aucune règle ni score ici — le serveur est la seule autorité.
// Pas de timer : le MJ (host) fait avancer, les devineurs valident (prêt).

let you = null, isHost = false, myAvatar = null;
let phase = 'lobby';
let iAmGuide = false;
let myTarget = null;          // le Guide mémorise SA cible (le serveur ne la renvoie pas en guessing)
let guessVal = 50;
let locked = false;           // ai-je validé mon vote ?
const colorById = {};         // id joueur -> couleur (assignée à la réception 'room')
const avatarById = {};        // id joueur -> avatar
const nameById = {};          // id joueur -> pseudo
const liveGuesses = {};       // (côté Guide) id -> valeur live des devineurs
let lastMoveSent = 0;
// Le podium est affiché. ⚠️ Le serveur envoie `phase:end` PUIS un `room` en
// phase lobby (endGame) : sans ce drapeau, le second effaçait le podium dans la
// milliseconde. Le joueur revient au salon quand il veut (#back-lobby).
let inEndScreen = false;
let nbJoueurs = 0;            // taille du salon, pour « Lancer la partie »

const PALETTE = ['#8b5cf6', '#f59e0b', '#34d399', '#38bdf8', '#f472b6', '#facc15', '#fb7185', '#a3e635', '#c084fc', '#22d3ee'];

const $ = (id) => document.getElementById(id);
const show = (id) => { for (const s of document.querySelectorAll('main > section')) s.hidden = s.id !== id; };
const showError = (m) => { $('error').textContent = m ? '> ' + m : ''; };
const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

// --- géométrie du cadran ---------------------------------------------------
const SVGNS = 'http://www.w3.org/2000/svg';
const CX = 200, CY = 200, R = 185;
const valToAngle = (v) => Math.PI * (1 - v / 100);
const polar = (v, r) => [CX + r * Math.cos(valToAngle(v)), CY - r * Math.sin(valToAngle(v))];
const mk = (tag, a) => { const e = document.createElementNS(SVGNS, tag); for (const k in a) e.setAttribute(k, a[k]); return e; };

function bandPath(va, vb, r) {
  const [x1, y1] = polar(va, r), [x2, y2] = polar(vb, r);
  return `M ${CX} ${CY} L ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r} ${r} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z`;
}

const SCORE_BANDS = [
  { d: 20, color: 'rgba(52,211,153,.18)' },
  { d: 12, color: 'rgba(52,211,153,.32)' },
  { d: 6,  color: 'rgba(52,211,153,.55)' },
  { d: 2,  color: 'rgba(52,211,153,.95)' },
];
function drawTarget(target) {
  const g = $('dial-bands'); g.innerHTML = '';
  if (target === null || target === undefined || Number.isNaN(+target)) return;
  for (const b of SCORE_BANDS) {
    g.appendChild(mk('path', { d: bandPath(Math.max(0, target - b.d), Math.min(100, target + b.d), R - 6), fill: b.color }));
  }
  const [tx, ty] = polar(target, R - 6);
  g.appendChild(mk('line', { x1: CX, y1: CY, x2: tx.toFixed(1), y2: ty.toFixed(1), stroke: '#fff', 'stroke-width': 2, 'stroke-dasharray': '4 3', opacity: .85 }));
}
const clearTarget = () => { $('dial-bands').innerHTML = ''; };

// Aiguilles (results OU curseurs live chez le Guide), une couleur par joueur.
function drawNeedles(entries) {
  const g = $('dial-needles'); g.innerHTML = '';
  for (const e of entries) {
    const col = colorById[e.id] || '#f59e0b';
    const [x, y] = polar(e.value, R - 24);
    g.appendChild(mk('line', { x1: CX, y1: CY, x2: x.toFixed(1), y2: y.toFixed(1), stroke: col, 'stroke-width': 3.5, 'stroke-linecap': 'round', opacity: .9 }));
    const [lx, ly] = polar(e.value, R - 6);
    g.appendChild(needleTip(e.avatar, lx, ly, col));
  }
}
const clearNeedles = () => { $('dial-needles').innerHTML = ''; };

// Bout d'aiguille : l'emoji du joueur, ou sa photo (un <image> SVG, pas du
// HTML), cerclée de sa couleur. Une photo qui ne se charge pas redevient
// l'emoji, sur place.
function needleTip(avatar, x, y, col) {
  const a = GameAvatar.normalize(avatar, '•');
  const emoji = () => {
    const t = mk('text', { x: x.toFixed(1), y: (y + 2).toFixed(1), fill: '#e7e5f4', 'font-size': 18, 'text-anchor': 'middle' });
    t.textContent = a.emoji;
    return t;
  };
  if (a.kind !== 'image') return emoji();
  const S = 26;   // unités du cadran (400 de large) : ~30 px à l'écran
  const tip = mk('g', { class: 'needle-img' });
  const img = mk('image', { x: (x - S / 2).toFixed(1), y: (y - S / 2 - 6).toFixed(1), width: S, height: S, preserveAspectRatio: 'xMidYMid slice' });
  img.setAttribute('href', a.src);
  img.addEventListener('error', () => tip.replaceWith(emoji()), { once: true });
  tip.appendChild(img);
  tip.appendChild(mk('rect', { x: (x - S / 2).toFixed(1), y: (y - S / 2 - 6).toFixed(1), width: S, height: S, fill: 'none', stroke: col, 'stroke-width': 2.5 }));
  return tip;
}

// curseur du joueur (aiguille)
function setPointer(v) {
  guessVal = Math.max(0, Math.min(100, Math.round(v)));
  const [x, y] = polar(guessVal, R - 10);
  const p = $('dial-pointer');
  p.setAttribute('x2', x.toFixed(1)); p.setAttribute('y2', y.toFixed(1));
  p.style.display = 'block';
  $('guess-val').textContent = 'ton curseur : ' + guessVal;
}
const hidePointer = () => { $('dial-pointer').style.display = 'none'; $('guess-val').textContent = ''; };

function pointerToVal(e) {
  const svg = $('dial'); const r = svg.getBoundingClientRect();
  const px = ((e.clientX - r.left) / r.width) * 400;
  const py = ((e.clientY - r.top) / r.height) * 226;
  const ang = Math.max(0, Math.min(Math.PI, Math.atan2(CY - py, px - CX)));
  return (1 - ang / Math.PI) * 100;
}

let dragging = false;
const canGuess = () => phase === 'guessing' && !iAmGuide && !locked;
function armDial(on) {
  const svg = $('dial');
  svg.style.pointerEvents = on ? 'auto' : 'none';
  if (on && !svg.dataset.bound) {
    svg.dataset.bound = '1';
    svg.addEventListener('pointerdown', (e) => { if (!canGuess()) return; dragging = true; try { svg.setPointerCapture(e.pointerId); } catch (_) {} onMove(e); });
    svg.addEventListener('pointermove', (e) => { if (dragging) onMove(e); });
    svg.addEventListener('pointerup', () => { dragging = false; });
  }
  function onMove(e) {
    setPointer(pointerToVal(e));
    const now = Date.now();
    if (now - lastMoveSent > 70) { lastMoveSent = now; NET.send({ action: 'move', value: guessVal }); } // curseur live vers le Guide
  }
}

// --- accueil ---------------------------------------------------------------
const AVATARS = ['😎', '🤖', '👻', '🐸', '🦊', '🐼', '🔥', '⚡', '🎯', '🎧', '🍕', '🚀'];
myAvatar = GameProfile.startEmoji(AVATARS); // profil local, sinon un repli stable
for (const em of AVATARS) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'avatar-pick' + (em === myAvatar ? ' picked' : ''); b.textContent = em; b.setAttribute('aria-pressed', String(em === myAvatar));
  b.addEventListener('click', () => { myAvatar = em; document.querySelectorAll('.avatar-pick').forEach((x) => { x.classList.toggle('picked', x === b); x.setAttribute('aria-pressed', String(x === b)); }); });
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
  // L'avatar complet : la photo du profil s'il y en a une, l'emoji toujours.
  const avatar = GameProfile.joinAvatar(myAvatar);
  try { await NET.connect(); NET.send(code === undefined ? { action: 'join', name, avatar } : { action: 'join', name, code, avatar }); }
  catch (err) {
    showError(err.message);
    perte.refus(err.message);
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
// ⚠️ Sans billet, `lien` vaut null et la page marche exactement comme avant.
let viaHub = false;            // le join en cours vient du Hub
let partirSansAttendre = false;
let codeDeclare = null;        // le code déjà annoncé au Hub (une seule fois)
let placeDeclaree = null;      // notre id Demi-Cercle déjà annoncé au Hub (score de soirée)
const lien = window.HubHandoff ? HubHandoff.start({
  gameId: 'demicercle',
  join: (code) => {
    viaHub = true;
    if (!$('name-input').value.trim()) $('name-input').value = GameProfile.load().name || '';
    enter(code || undefined);
  },
  onUpdate: attente,
}) : null;

// L'hôte ne lance pas tant que le groupe n'est pas dans la room : demicercle-server
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

const lancer = () => NET.send({ action: 'start', rounds: +$('rounds-select').value, mode: $('mode-select').value });
$('start').addEventListener('click', lancer);
$('start-anyway').addEventListener('click', () => { partirSansAttendre = true; lancer(); });
$('back-lobby').addEventListener('click', () => { inEndScreen = false; show('lobby'); });

// --- connexion perdue (games/shared/game-net.js) ----------------------------
// Au salon (ou sur le podium), UN retour automatique par le join NORMAL, avec
// le même code ; en pleine partie, aucune reprise : on dit qu'elle a continué.
// `you = null` (dans quitter) rend aussi sa garde à lien.failed() : un retour
// raté depuis le Game Hub lui est bien signalé.
const perte = GameNet.surPerte(NET, {
  dansRoom: () => !!you,
  enPartie: () => ['setup', 'clue', 'guessing', 'results'].includes(phase),
  code: () => $('room-code').textContent.trim(),
  quitter: () => {
    you = null; phase = 'lobby'; inEndScreen = false;
    resetStage();
    $('to-hub').hidden = true; showError('');
  },
  revenir: (code) => { if (lien) viaHub = true; enter(code); },
  show, hub: !!lien,
});

$('theme-send').addEventListener('click', () => {
  const label = $('theme-label').value.trim(), low = $('theme-low').value.trim(), high = $('theme-high').value.trim();
  if (!label || !low || !high) return showError('remplis le thème et les deux extrémités');
  NET.send({ action: 'theme', label, low, high });
  $('theme-row').hidden = true;
});
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
$('next-btn').addEventListener('click', () => NET.send({ action: 'next' }));

$('clue-send').addEventListener('click', sendClue);
$('clue-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendClue(); });
function sendClue() {
  const text = $('clue-input').value.trim();
  if (!text) return showError('indice vide');
  NET.send({ action: 'clue', text });
  $('clue-row').hidden = true;
}
$('guess-send').addEventListener('click', () => {
  NET.send({ action: 'guess', value: guessVal });
  locked = true;
  $('guess-send').hidden = true;
  $('stage-sub').textContent = 'curseur validé ✔ — en attente des autres…';
  armDial(false);
});

// Le podium en rangs « de compétition » : 4, 4, 1 → 1, 1, 3. Le serveur l'envoie
// trié, mais le rang se lit sur les points, pas sur l'index.
function rangs(podium) {
  return podium.map((p) => ({
    gamePlayerId: p.id,
    rank: 1 + podium.filter((x) => x.score > p.score).length,
    points: p.score,
  }));
}

// --- messages serveur ------------------------------------------------------
NET.on('room', (msg) => {
  you = msg.you;
  perte.retour();                             // de retour dans une room
  $('room-code').textContent = msg.code;
  // Lancé par le Hub : on lui dit dans quelle room on est. L'hôte y déclare le
  // code (le seul qu'il croira), les invités confirment y être entrés. ⚠️ `room`
  // arrive à CHAQUE changement du salon : une seule annonce.
  // Avec SA place dans la room (msg.you, l'id Demi-Cercle — jamais celui du
  // Hub) : c'est elle qui relie le podium final à son joueur du Hub (score de
  // soirée). Une reconnexion donne un NOUVEL id : on ne ré-annonce que dans ce
  // cas, pour que la place suive le joueur.
  if (lien && (!codeDeclare || placeDeclaree !== msg.you)) {
    codeDeclare = codeDeclare || msg.code; placeDeclaree = msg.you; viaHub = false;
    lien.roomReady(msg.code, msg.you);
  }
  nbJoueurs = msg.players.length;
  msg.players.forEach((p, i) => { if (!colorById[p.id]) colorById[p.id] = PALETTE[i % PALETTE.length]; avatarById[p.id] = p.avatar; nameById[p.id] = p.name; });
  const me = msg.players.find((p) => p.id === you);
  isHost = !!(me && me.host);
  $('players').innerHTML = msg.players.map((p) =>
    `<li class="g-player">${GameAvatar.slot(p.avatar, undefined, 'md')}<span class="g-player-name">${esc(p.name)}${p.host ? ' <span class="tag">MJ</span>' : ''}</span></li>`).join('');
  GameAvatar.fill($('players'));
  $('host-config').hidden = !isHost;
  attente(lien && lien.info());
  $('need-players').hidden = msg.players.length >= 2;
  renderScores(msg.players);
  // Le salon est tenu à jour même derrière le podium ; on n'y bascule pas tant
  // que le joueur regarde l'écran de fin.
  if (msg.phase === 'lobby') { phase = 'lobby'; if (!inEndScreen) show('lobby'); }
});

NET.on('error', (msg) => {
  showError(msg.message);
  perte.refus(msg.message);                  // un retour dans le salon refusé : on le dit
  // Le serveur refuse d'entrer (code inconnu, room pleine, partie en cours) :
  // le Hub est prévenu, pour que le groupe le sache au lieu d'attendre.
  if (lien && viaHub && !you) { viaHub = false; lien.failed('JOIN', msg.message); }
});

// curseur live d'un devineur → seul le Guide reçoit ce message
NET.on('move', (msg) => {
  if (!iAmGuide || phase !== 'guessing') return;
  liveGuesses[msg.id] = msg.value;
  drawNeedles(Object.entries(liveGuesses).map(([id, value]) => ({ id, value, avatar: avatarById[id] })));
});

// progression des « prêts »
NET.on('ready', (msg) => {
  readyIds = new Set(msg.ids);
  renderScoresLive();
  $('stage-sub').textContent = `${msg.ids.length}/${msg.of} ont validé leur curseur`;
});
let readyIds = new Set();

NET.on('phase', (msg) => { phase = msg.phase; readyIds = new Set(); (PHASES[msg.phase] || (() => {}))(msg); });

const PHASES = {
  setup(msg) {
    inEndScreen = false;
    show('game'); iAmGuide = msg.guide === you; resetStage();
    if (iAmGuide) myTarget = msg.target;
    // Première manche : la partie a vraiment démarré, le Hub le sait.
    if (msg.round === 1 && lien && isHost) lien.started();

    // mode custom + je suis le Guide + thème pas encore défini → formulaire
    if (msg.mode === 'custom' && iAmGuide && !msg.theme) {
      setStage(`Manche ${msg.round}/${msg.of} — ✍️ Invente ton thème`, 'un sujet + les deux extrémités du spectre');
      $('theme-row').hidden = false;
      $('theme-label').value = ''; $('theme-low').value = ''; $('theme-high').value = '';
      $('theme-label').focus();
      hostControls(msg, '⏭ Passer (thème au hasard)');
      return;
    }
    setPoles(msg.theme);
    const who = iAmGuide ? 'À toi de guider' : `${esc(msg.guideName)} est le Guide`;
    const themeTxt = msg.theme ? `🎯 ${esc(msg.theme.label)}` : '⏳ le Guide prépare le thème';
    setStage(`Manche ${msg.round}/${msg.of} — ${themeTxt}`, msg.theme ? `${who} · ${esc(msg.theme.low)} ⇄ ${esc(msg.theme.high)}` : `${esc(msg.guideName)} invente le thème…`);
    hostControls(msg, '▶ Lancer l\'indice');
  },

  clue(msg) {
    iAmGuide = msg.guide === you; resetStage(); setPoles(msg.theme);
    if (iAmGuide) {
      myTarget = msg.target;
      drawTarget(myTarget);
      setStage('🎯 Trouve ton indice', `${esc(msg.theme.low)} ⇄ ${esc(msg.theme.high)} · vise la cible verte`);
      $('clue-row').hidden = false; $('clue-input').value = ''; $('clue-input').focus();
    } else {
      setStage('🤔 ' + esc(msg.guideName) + ' réfléchit', 'il cherche un indice qui vise la cible…');
    }
    hostControls(msg, '⏭ Passer (forcer l\'indice)');
  },

  guessing(msg) {
    iAmGuide = msg.guide === you; resetStage(); setPoles(msg.theme);
    if (iAmGuide) {
      drawTarget(myTarget);                       // ← FIX : le Guide garde SA cible affichée
      setStage('🎧 « ' + esc(msg.clue) + ' »', 'les autres placent leur curseur — tu les vois bouger en direct');
      showLegend(msg.guide);                       // qui est quelle couleur
    } else {
      setStage('🎯 « ' + esc(msg.clue) + ' »', 'place ton curseur, puis valide quand tu es prêt');
      guessVal = 50; locked = false; setPointer(50);
      $('guess-send').hidden = false;
      armDial(true);
      NET.send({ action: 'move', value: 50 }); // position initiale visible par le Guide
    }
    hostControls(msg, '⏭ Révéler (tout le monde a placé)');
  },

  results(msg) {
    iAmGuide = msg.guide === you; resetStage(); setPoles(msg.theme);
    drawTarget(msg.target);
    drawNeedles(msg.guesses);
    const mine = msg.guesses.find((g) => g.id === you);
    const gained = iAmGuide ? `+${msg.guidePoints} (Guide)` : (mine ? `+${mine.points}` : '—');
    setStage(`🎯 Cible : ${msg.target} · « ${esc(msg.clue)} »`, `tu marques ${gained}`);
    renderScores(msg.scores);
    $('scores').hidden = false;
    $('scores').innerHTML = [...msg.guesses].sort((a, b) => b.points - a.points)
      .map((g) => `<li class="g-player" style="--g-av-ring:${colorById[g.id] || '#fff'}">${GameAvatar.slot(g.avatar, undefined, 'md')}<span class="g-player-name">${esc(g.name)}</span> <span class="pts g-player-score">${g.value} → +${g.points}</span></li>`).join('');
    GameAvatar.fill($('scores'));
    hostControls(msg, '⏭ Manche suivante');
  },

  end(msg) {
    inEndScreen = true;
    show('game'); resetStage();
    if (lien) {
      // Score de soirée : le podium du SERVEUR, transmis tel quel au Hub
      // (l'hôte du lancement seulement, une fois — hub-handoff.js filtre). Le
      // Hub en fait des points de soirée. Toujours AVANT ended().
      // (garde : un hub-handoff.js resté en cache n'a pas encore results)
      if (lien.results) lien.results(rangs(msg.podium));
      lien.ended();
      $('to-hub').hidden = false;
    }
    $('back-lobby').hidden = false;
    const medals = ['🥇', '🥈', '🥉'];
    setStage('🏆 Fin de partie', 'le podium');
    renderScores(msg.podium);
    $('scores').hidden = false;
    $('scores').innerHTML = msg.podium.map((p, i) => `<li class="g-player" style="--g-av-ring:${colorById[p.id] || '#fff'}"><span class="medal">${medals[i] || '·'}</span>${GameAvatar.slot(p.avatar, undefined, i < 3 ? 'lg' : 'md')}<span class="g-player-name">${esc(p.name)}</span> <span class="pts g-player-score">${p.score} pts</span></li>`).join('');
    GameAvatar.fill($('scores'));
    $('wait-host').hidden = true; $('next-btn').hidden = true;
  },
};

// bouton du MJ (host) + « en attente du MJ » pour les autres
function hostControls(msg, label) {
  const host = msg.isHost;
  $('next-btn').hidden = !host; if (host) $('next-btn').textContent = label;
  $('wait-host').hidden = host;
}

// --- helpers d'affichage ---------------------------------------------------
function setStage(t, s) { $('stage-title').innerHTML = t; $('stage-sub').innerHTML = s; }
function setPoles(theme) { if (theme) { $('pole-low').innerHTML = '◀ <b>' + esc(theme.low) + '</b>'; $('pole-high').innerHTML = '<b>' + esc(theme.high) + '</b> ▶'; } }

// légende couleur → joueur (affichée chez le Guide en guessing)
function showLegend(guideId) {
  const others = lastScores.filter((p) => p.id !== guideId);
  $('dial-legend').innerHTML = others.map((p) =>
    `<span class="lg" style="--g-av-ring:${colorById[p.id] || '#fff'}"><span class="dot" style="background:${colorById[p.id] || '#fff'}"></span>${GameAvatar.slot(p.avatar, undefined, 'sm')} ${esc(p.name)}</span>`).join('');
  GameAvatar.fill($('dial-legend'));
  $('dial-legend').hidden = others.length === 0;
}

let lastScores = [];
function resetStage() {
  clearTarget(); clearNeedles(); hidePointer();
  for (const k in liveGuesses) delete liveGuesses[k];
  $('clue-row').hidden = true; $('theme-row').hidden = true; $('guess-send').hidden = true; $('scores').hidden = true;
  $('next-btn').hidden = true; $('wait-host').hidden = true; $('dial-legend').hidden = true;
  $('back-lobby').hidden = true; $('to-hub').hidden = true;
  armDial(false); dragging = false; locked = false;
}
function renderScores(list) { lastScores = [...list]; renderScoresLive(); }
function renderScoresLive() {
  $('scores-live').innerHTML = [...lastScores].sort((a, b) => b.score - a.score).map((p) =>
    `<li class="g-player" style="--g-av-ring:${colorById[p.id] || '#fff'}">${GameAvatar.slot(p.avatar, undefined, 'md')}<span class="g-player-name">${esc(p.name)}${readyIds.has(p.id) ? '<span class="rd">✔</span>' : ''}</span><span class="pts g-player-score">${p.score}</span></li>`).join('');
  GameAvatar.fill($('scores-live'));
}
