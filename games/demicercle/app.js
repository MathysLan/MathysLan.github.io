// UI du Jeu du Demi-Cercle. Le serveur ordonne les phases, cette page obéit :
// elle affiche l'état reçu, laisse placer le curseur, transmet indice/vote.
// AUCUNE règle ni score ici — le serveur est la seule autorité.

let you = null, isHost = false, myAvatar = null;
let phase = 'lobby';
let guessVal = 50;          // position courante du curseur (0..100)
let iAmGuide = false;
let countdownTimer = null;

const $ = (id) => document.getElementById(id);
const show = (id) => { for (const s of document.querySelectorAll('main > section')) s.hidden = s.id !== id; };
const showError = (m) => { $('error').textContent = m ? '> ' + m : ''; };
const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

// --- géométrie du cadran ---------------------------------------------------
const SVGNS = 'http://www.w3.org/2000/svg';
const CX = 200, CY = 200, R = 185;
const valToAngle = (v) => Math.PI * (1 - v / 100);      // v=0 → π (gauche), v=100 → 0 (droite)
const polar = (v, r) => [CX + r * Math.cos(valToAngle(v)), CY - r * Math.sin(valToAngle(v))];

function bandPath(va, vb, r) { // secteur (part de tarte) du centre, entre les valeurs va et vb
  const [x1, y1] = polar(va, r), [x2, y2] = polar(vb, r);
  return `M ${CX} ${CY} L ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r} ${r} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z`;
}
function mk(tag, attrs) { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; }

// Dessine les bandes de score autour de la cible (du plus large au plus étroit).
const SCORE_BANDS = [
  { d: 20, color: 'rgba(52,211,153,.18)' },
  { d: 12, color: 'rgba(52,211,153,.32)' },
  { d: 6,  color: 'rgba(52,211,153,.55)' },
  { d: 2,  color: 'rgba(52,211,153,.95)' },
];
function drawTarget(target) {
  const g = $('dial-bands'); g.innerHTML = '';
  for (const b of SCORE_BANDS) {
    const va = Math.max(0, target - b.d), vb = Math.min(100, target + b.d);
    g.appendChild(mk('path', { d: bandPath(va, vb, R - 6), fill: b.color }));
  }
  // trait fin sur la cible exacte
  const [tx, ty] = polar(target, R - 6);
  g.appendChild(mk('line', { x1: CX, y1: CY, x2: tx.toFixed(1), y2: ty.toFixed(1), stroke: '#fff', 'stroke-width': 2, 'stroke-dasharray': '4 3', opacity: .8 }));
}
const clearTarget = () => { $('dial-bands').innerHTML = ''; };

// Aiguilles des votes (phase results)
function drawNeedles(guesses) {
  const g = $('dial-needles'); g.innerHTML = '';
  for (const gu of guesses) {
    const [x, y] = polar(gu.value, R - 24);
    g.appendChild(mk('line', { x1: CX, y1: CY, x2: x.toFixed(1), y2: y.toFixed(1), stroke: '#f59e0b', 'stroke-width': 3, 'stroke-linecap': 'round', opacity: .85 }));
    const [lx, ly] = polar(gu.value, R - 6);
    const t = mk('text', { x: lx.toFixed(1), y: ly.toFixed(1), fill: '#e7e5f4', 'font-size': 13, 'text-anchor': 'middle' });
    t.textContent = gu.avatar || '•';
    g.appendChild(t);
  }
}
const clearNeedles = () => { $('dial-needles').innerHTML = ''; };

// Curseur du joueur (aiguille violette)
function setPointer(v) {
  guessVal = Math.max(0, Math.min(100, Math.round(v)));
  const [x, y] = polar(guessVal, R - 10);
  const p = $('dial-pointer');
  p.setAttribute('x2', x.toFixed(1)); p.setAttribute('y2', y.toFixed(1));
  p.style.display = 'block';
  $('guess-val').textContent = 'ton curseur : ' + guessVal;
}
const hidePointer = () => { $('dial-pointer').style.display = 'none'; $('guess-val').textContent = ''; };

// pointeur → valeur, quand on clique/glisse dans le cadran
function pointerToVal(e) {
  const svg = $('dial'); const r = svg.getBoundingClientRect();
  const px = ((e.clientX - r.left) / r.width) * 400;   // coord viewBox
  const py = ((e.clientY - r.top) / r.height) * 226;
  const ang = Math.atan2(CY - py, px - CX);            // 0 = droite, π = gauche
  const clamped = Math.max(0, Math.min(Math.PI, ang));
  return (1 - clamped / Math.PI) * 100;
}

let dragging = false;
function armDial(on) {
  const svg = $('dial');
  svg.style.pointerEvents = on ? 'auto' : 'none';
  if (on && !svg.dataset.bound) {
    svg.dataset.bound = '1';
    svg.addEventListener('pointerdown', (e) => { if (!canGuess()) return; dragging = true; svg.setPointerCapture(e.pointerId); setPointer(pointerToVal(e)); });
    svg.addEventListener('pointermove', (e) => { if (dragging) setPointer(pointerToVal(e)); });
    svg.addEventListener('pointerup', () => { dragging = false; });
  }
}
const canGuess = () => phase === 'guessing' && !iAmGuide && !$('guess-send').hidden;

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
  try {
    await NET.connect();
    NET.send(code === undefined ? { action: 'join', name, avatar: myAvatar } : { action: 'join', name, code, avatar: myAvatar });
  } catch (err) { showError(err.message); }
}

$('start').addEventListener('click', () => NET.send({ action: 'start', rounds: +$('rounds-select').value }));
$('room-code').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('room-code').textContent.trim()); $('code-hint').textContent = 'code copié ✔'; setTimeout(() => { $('code-hint').textContent = 'clique sur le code pour le copier'; }, 1500); } catch (_) {}
});

$('clue-send').addEventListener('click', sendClue);
$('clue-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendClue(); });
function sendClue() {
  const text = $('clue-input').value.trim();
  if (!text) return showError('indice vide');
  NET.send({ action: 'clue', text });
  $('clue-row').hidden = true;
  $('stage-sub').textContent = 'indice envoyé ✔ — les autres cherchent…';
}
$('guess-send').addEventListener('click', () => {
  NET.send({ action: 'guess', value: guessVal });
  $('guess-send').hidden = true;
  $('stage-sub').textContent = 'curseur validé ✔ — en attente des autres…';
  armDial(false);
});

// --- messages serveur ------------------------------------------------------
NET.on('room', (msg) => {
  you = msg.you;
  $('room-code').textContent = msg.code;
  const me = msg.players.find((p) => p.id === you);
  isHost = !!(me && me.host);
  $('players').innerHTML = msg.players.map((p) =>
    `<li><span class="pp">${esc(p.avatar || '🙂')}</span>${esc(p.name)}${p.host ? ' <span class="tag">host</span>' : ''}</li>`).join('');
  $('host-config').hidden = !isHost;
  $('start').disabled = msg.players.length < 2;
  $('need-players').hidden = msg.players.length >= 2;
  renderScores(msg.players);
  if (msg.phase === 'lobby') { phase = 'lobby'; show('lobby'); }
});

NET.on('error', (msg) => showError(msg.message));
NET.on('closed', () => { if (you) showError('connexion au serveur perdue'); });
NET.on('guessed', (msg) => { if (iAmGuide || phase === 'guessing') $('stage-sub').textContent = `${msg.count}/${msg.of} ont placé leur curseur`; });

NET.on('phase', (msg) => { phase = msg.phase; (PHASES[msg.phase] || (() => {}))(msg); });

const PHASES = {
  setup(msg) {
    show('game');
    iAmGuide = msg.guide === you;
    resetStage();
    setPoles(msg.theme);
    const who = iAmGuide ? 'À toi de guider' : `${esc(msg.guideName)} guide`;
    setStage(`Manche ${msg.round}/${msg.of} — 🎯 ${msg.theme.label}`, `${who} · ${esc(msg.theme.low)} ⇄ ${esc(msg.theme.high)}`);
    countdown(msg.deadline);
  },

  clue(msg) {
    iAmGuide = msg.guide === you;
    resetStage();
    setPoles(msg.theme);
    if (iAmGuide) {
      drawTarget(msg.target);                 // le Guide voit la cible + les bandes de score
      setStage('🎯 Trouve ton indice', `${esc(msg.theme.low)} ⇄ ${esc(msg.theme.high)} · vise la cible verte`);
      $('clue-row').hidden = false;
      $('clue-input').value = ''; $('clue-input').focus();
    } else {
      setStage('🤔 ' + esc(msg.guideName) + ' réfléchit', 'il cherche un indice qui vise la cible…');
    }
    countdown(msg.deadline);
  },

  guessing(msg) {
    iAmGuide = msg.guide === you;
    resetStage();
    setPoles(msg.theme);
    if (iAmGuide) {
      drawTarget(msg.target === undefined ? null : msg.target); // (le Guide n'a plus la cible ici, mais on garde l'API)
      setStage('🎧 « ' + esc(msg.clue) + ' »', 'les autres placent leur curseur…');
    } else {
      setStage('🎯 « ' + esc(msg.clue) + ' »', 'place ton curseur là où tu penses que ça se situe, puis valide');
      guessVal = 50; setPointer(50);
      $('guess-send').hidden = false;
      armDial(true);
    }
    countdown(msg.deadline);
  },

  results(msg) {
    iAmGuide = msg.guide === you;
    resetStage();
    setPoles(msg.theme);
    drawTarget(msg.target);
    drawNeedles(msg.guesses);
    const mine = msg.guesses.find((g) => g.id === you);
    const gained = iAmGuide ? `+${msg.guidePoints} (Guide)` : (mine ? `+${mine.points}` : '—');
    setStage(`🎯 Cible : ${msg.target} · « ${esc(msg.clue)} »`, `tu marques ${gained}`);
    renderScores(msg.scores);
    $('scores').hidden = false;
    $('scores').innerHTML = msg.guesses
      .sort((a, b) => b.points - a.points)
      .map((g) => `<li><span class="pp">${esc(g.avatar || '🙂')}</span>${esc(g.name)} <span class="pts">${g.value} → +${g.points}</span></li>`).join('');
    countdown(msg.deadline);
  },

  end(msg) {
    show('game');
    resetStage();
    const medals = ['🥇', '🥈', '🥉'];
    setStage('🏆 Fin de partie', 'le podium');
    renderScores(msg.podium);
    $('scores').hidden = false;
    $('scores').innerHTML = msg.podium.map((p, i) =>
      `<li>${medals[i] || '·'} <span class="pp">${esc(p.avatar || '🙂')}</span>${esc(p.name)} <span class="pts">${p.score} pts</span></li>`).join('');
    countdown(null);
  },
};

// --- helpers d'affichage ---------------------------------------------------
function setStage(title, sub) { $('stage-title').innerHTML = title; $('stage-sub').innerHTML = sub; }
function setPoles(theme) { if (theme) { $('pole-low').innerHTML = '◀ <b>' + esc(theme.low) + '</b>'; $('pole-high').innerHTML = '<b>' + esc(theme.high) + '</b> ▶'; } }

function resetStage() {
  clearTarget(); clearNeedles(); hidePointer();
  $('clue-row').hidden = true; $('guess-send').hidden = true; $('scores').hidden = true;
  armDial(false); dragging = false;
}

function renderScores(list) {
  const guideId = list.__guide;
  $('scores-live').innerHTML = [...list].sort((a, b) => b.score - a.score)
    .map((p) => `<li><span class="pp">${esc(p.avatar || '🙂')}</span>${esc(p.name)}<span class="pts">${p.score}</span></li>`).join('');
}

function countdown(deadline) {
  clearInterval(countdownTimer);
  if (!deadline) { $('timer').textContent = ''; return; }
  const tick = () => {
    const s = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    $('timer').textContent = s + ' s';
    if (s === 0) clearInterval(countdownTimer);
  };
  tick(); countdownTimer = setInterval(tick, 250);
}
