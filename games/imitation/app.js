// UI du jeu d'imitation. Le serveur ordonne les phases, cette page obéit :
// elle affiche l'état reçu, capture le micro quand on le lui demande, et transmet les votes.

let you = null;
let micStream = null;
let MIME = '';
let pendingListen = null; // méta 'listen' en attente de sa frame binaire
let inEndScreen = false;
let countdownTimer = null;

const $ = (id) => document.getElementById(id);
const show = (id) => {
  for (const s of document.querySelectorAll('main > section')) s.hidden = s.id !== id;
};
const showError = (msg) => { $('error').textContent = msg ? '> ' + msg : ''; };

// --- micro -----------------------------------------------------------------

// Demandé sur le clic host/join : geste utilisateur = autorisation propre, une seule fois.
async function initMic() {
  if (micStream) return;
  micStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
  });
  // audio/mp4 (AAC) d'abord : le seul format que tout le monde sait relire.
  MIME = ['audio/mp4', 'audio/webm;codecs=opus']
    .find((m) => MediaRecorder.isTypeSupported(m)) || '';
}

// Enregistre jusqu'à la deadline serveur, moins une marge pour l'upload.
function recordUntil(deadline) {
  return new Promise((resolve, reject) => {
    const ms = Math.max(500, deadline - Date.now() - 500);
    const rec = new MediaRecorder(micStream, MIME ? { mimeType: MIME, audioBitsPerSecond: 48000 } : undefined);
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = () => resolve(new Blob(chunks, { type: rec.mimeType }));
    rec.onerror = (e) => reject(e.error || new Error('enregistrement impossible'));
    rec.start();
    setTimeout(() => rec.stop(), ms);
  });
}

// --- accueil ---------------------------------------------------------------

$('host').addEventListener('click', () => enter());
$('join').addEventListener('click', () => enter($('code-input').value));
$('code-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') enter($('code-input').value);
});

async function enter(code) {
  const name = $('name-input').value.trim();
  if (!name) return showError('il te faut un pseudo');
  if (code !== undefined && !code.trim()) return showError('rentre un code de room');
  showError('');
  try {
    await initMic();
    await NET.connect();
    NET.send(code === undefined ? { action: 'join', name } : { action: 'join', name, code });
  } catch (err) {
    showError(err.name === 'NotAllowedError' ? 'accès micro refusé - le jeu en a besoin' : err.message);
  }
}

$('start').addEventListener('click', () => NET.send({ action: 'start' }));
$('back-lobby').addEventListener('click', () => { inEndScreen = false; show('lobby'); });

// --- messages serveur ------------------------------------------------------

NET.on('room', (msg) => {
  you = msg.you;
  $('room-code').textContent = msg.code;
  const me = msg.players.find((p) => p.id === you);
  $('players').innerHTML = msg.players
    .map((p) => `<li>${esc(p.name)}${p.host ? ' <span class="tag">host</span>' : ''}<span class="pts">${p.score} pt${p.score > 1 ? 's' : ''}</span></li>`)
    .join('');
  $('start').hidden = !(me && me.host);
  $('need-players').hidden = msg.players.length >= 2;
  if (msg.phase === 'lobby' && !inEndScreen) show('lobby');
});

NET.on('error', (msg) => showError(msg.message));
NET.on('closed', () => { if (you) showError('connexion au serveur perdue'); });
NET.on('listen', (msg) => { pendingListen = msg; });

NET.onBinary = (buf) => {
  if (!pendingListen) return;
  const url = URL.createObjectURL(new Blob([buf], { type: pendingListen.mime }));
  const player = $('playback');
  player.src = url;
  player.onended = () => URL.revokeObjectURL(url);
  player.play().catch(() => {}); // les contrôles restent visibles si l'autoplay bloque
  $('listen-name').textContent = pendingListen.name;
  pendingListen = null;
};

NET.on('phase', (msg) => { (PHASES[msg.phase] || (() => {}))(msg); });

const PHASES = {
  watching(msg) {
    inEndScreen = false;
    show('game');
    setStage(`round ${msg.round}/${msg.of}`, 'regarde (et écoute) bien…');
    hideAll();
    const v = $('ref-video');
    v.hidden = false;
    v.src = 'videos/' + msg.video + '.mp4';
    v.play().catch(() => {}); // autoplay bloqué → l'utilisateur a les contrôles
    countdown(msg.deadline);
  },

  async recording(msg) {
    hideAll();
    $('rec-dot').hidden = false;
    setStage('🎙 enregistrement', 'imite le son de la vidéo, maintenant !');
    countdown(msg.deadline);
    try {
      const blob = await recordUntil(msg.deadline);
      await NET.sendAudio(blob);
      setStage('🎙 enregistrement', 'prise envoyée ✔ en attente des autres…');
    } catch (err) { showError(err.message); }
  },

  broadcasting(msg) {
    hideAll();
    $('listen-box').hidden = false;
    setStage('🎧 écoute', `les ${msg.count} imitations, une par une`);
    countdown(null);
  },

  voting(msg) {
    hideAll();
    $('vote-box').hidden = false;
    setStage('🗳 vote', 'la meilleure imitation ?');
    $('vote-box').innerHTML = '';
    for (const c of msg.candidates) {
      if (c.id === you) continue; // le serveur refuserait de toute façon
      const btn = document.createElement('button');
      btn.className = 'vote-btn';
      btn.textContent = c.name;
      btn.addEventListener('click', () => {
        NET.send({ action: 'vote', for: c.id });
        for (const b of $('vote-box').children) b.disabled = true;
      });
      $('vote-box').appendChild(btn);
    }
    countdown(msg.deadline);
  },

  results(msg) {
    hideAll();
    $('scores').hidden = false;
    setStage('résultats', 'les points du round');
    const votesOf = (id) => (msg.votes.find((v) => v.id === id) || { votes: 0 }).votes;
    $('scores').innerHTML = msg.scores
      .map((p) => `<li>${esc(p.name)} <span class="pts">+${votesOf(p.id)} → ${p.score} pt${p.score > 1 ? 's' : ''}</span></li>`)
      .join('');
    countdown(msg.deadline);
  },

  end(msg) {
    inEndScreen = true;
    hideAll();
    show('game');
    $('scores').hidden = false;
    $('back-lobby').hidden = false;
    const medals = ['🥇', '🥈', '🥉'];
    setStage('fin de partie', 'le podium');
    $('scores').innerHTML = msg.podium
      .map((p, i) => `<li>${medals[i] || '·'} ${esc(p.name)} <span class="pts">${p.score} pt${p.score > 1 ? 's' : ''}</span></li>`)
      .join('');
    countdown(null);
  },
};

// --- helpers d'affichage ---------------------------------------------------

function setStage(title, sub) {
  $('stage-title').textContent = title;
  $('stage-sub').textContent = sub;
}

function hideAll() {
  const v = $('ref-video');
  v.pause();
  v.hidden = true;
  $('rec-dot').hidden = true;
  $('listen-box').hidden = true;
  $('vote-box').hidden = true;
  $('scores').hidden = true;
  $('back-lobby').hidden = true;
}

// Compte à rebours purement visuel : la vraie deadline est côté serveur.
function countdown(deadline) {
  clearInterval(countdownTimer);
  if (!deadline) { $('timer').textContent = ''; return; }
  const tick = () => {
    const s = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    $('timer').textContent = s + ' s';
    if (s === 0) clearInterval(countdownTimer);
  };
  tick();
  countdownTimer = setInterval(tick, 250);
}

const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
