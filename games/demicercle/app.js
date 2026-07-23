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
const liveGuesses = {};       // (côté Guide) id -> valeur live des devineurs
let lastMoveSent = 0;

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
    const t = mk('text', { x: lx.toFixed(1), y: ly.toFixed(1), fill: '#e7e5f4', 'font-size': 13, 'text-anchor': 'middle' });
    t.textContent = e.avatar || '•';
    g.appendChild(t);
  }
}
const clearNeedles = () => { $('dial-needles').innerHTML = ''; };

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
$('start').addEventListener('click', () => NET.send({ action: 'start', rounds: +$('rounds-select').value }));
$('room-code').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('room-code').textContent.trim()); $('code-hint').textContent = 'code copié ✔'; setTimeout(() => { $('code-hint').textContent = 'clique sur le code pour le copier'; }, 1500); } catch (_) {} });
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
  if (msg.phase === 'lobby') { phase = 'lobby'; show('lobby'); }
});

NET.on('error', (msg) => showError(msg.message));
NET.on('closed', () => { if (you) showError('connexion au serveur perdue'); });

// curseur live d'un devineur → seul le Guide reçoit ce message
NET.on('move', (msg) => {
  if (!iAmGuide || phase !== 'guessing') return;
  liveGuesses[msg.id] = msg.value;
  drawNeedles(Object.entries(liveGuesses).map(([id, value]) => ({ id, value, avatar: '' })));
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
    show('game'); iAmGuide = msg.guide === you; resetStage(); setPoles(msg.theme);
    if (iAmGuide) myTarget = msg.target;
    const who = iAmGuide ? 'À toi de guider' : `${esc(msg.guideName)} est le Guide`;
    setStage(`Manche ${msg.round}/${msg.of} — 🎯 ${esc(msg.theme.label)}`, `${who} · ${esc(msg.theme.low)} ⇄ ${esc(msg.theme.high)}`);
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
      .map((g) => `<li><span class="pp" style="color:${colorById[g.id] || '#fff'}">${esc(g.avatar || '🙂')}</span>${esc(g.name)} <span class="pts">${g.value} → +${g.points}</span></li>`).join('');
    hostControls(msg, '⏭ Manche suivante');
  },

  end(msg) {
    show('game'); resetStage();
    const medals = ['🥇', '🥈', '🥉'];
    setStage('🏆 Fin de partie', 'le podium');
    renderScores(msg.podium);
    $('scores').hidden = false;
    $('scores').innerHTML = msg.podium.map((p, i) => `<li>${medals[i] || '·'} <span class="pp">${esc(p.avatar || '🙂')}</span>${esc(p.name)} <span class="pts">${p.score} pts</span></li>`).join('');
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

let lastScores = [];
function resetStage() {
  clearTarget(); clearNeedles(); hidePointer();
  for (const k in liveGuesses) delete liveGuesses[k];
  $('clue-row').hidden = true; $('guess-send').hidden = true; $('scores').hidden = true;
  $('next-btn').hidden = true; $('wait-host').hidden = true;
  armDial(false); dragging = false; locked = false;
}
function renderScores(list) { lastScores = [...list]; renderScoresLive(); }
function renderScoresLive() {
  $('scores-live').innerHTML = [...lastScores].sort((a, b) => b.score - a.score).map((p) =>
    `<li><span class="pp" style="color:${colorById[p.id] || '#fff'}">${esc(p.avatar || '🙂')}</span>${esc(p.name)}${readyIds.has(p.id) ? '<span class="rd">✔</span>' : ''}<span class="pts">${p.score}</span></li>`).join('');
}
