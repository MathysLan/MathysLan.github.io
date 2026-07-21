// UI du jeu d'imitation. Le serveur ordonne les phases, cette page obéit :
// elle affiche l'état reçu, capture le micro quand on le lui demande, transmet les notes.
//
// v2 : la vidéo tourne (muette) pendant l'enregistrement pour rester synchro,
// on peut refaire sa prise tant que la fenêtre est ouverte (⏺ / ⏹), la notation
// se fait pendant l'écoute (👍×2 / 👍 / 👎) avec la vidéo rejouée en fond,
// et le scoreboard vit sur le côté.

let you = null;
let micStream = null;
let MIME = '';
let pendingListen = null; // méta 'listen' en attente de sa frame binaire
let inEndScreen = false;
let countdownTimer = null;
let activeRec = null;     // MediaRecorder en cours, sinon null
let recStopTimer = null;

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

// --- enregistrement : ⏺ / ⏹, refaisable tant que la fenêtre est ouverte ----

$('rec-btn').addEventListener('click', () => (activeRec ? stopTake() : startTake()));
$('ref-video').addEventListener('ended', () => stopTake()); // fin du clip = fin de la prise

function startTake() {
  const v = $('ref-video');
  v.muted = true;          // la vidéo tourne pour la synchro, mais en silence :
  v.currentTime = 0;       // ton micro n'enregistre que toi
  v.play().catch(() => {});

  const rec = new MediaRecorder(micStream, MIME ? { mimeType: MIME, audioBitsPerSecond: 48000 } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  rec.onstop = async () => {
    activeRec = null;
    v.pause();
    setRecBtn(false);
    const blob = new Blob(chunks, { type: rec.mimeType });
    if (!blob.size) return;
    try {
      await NET.sendAudio(blob); // le serveur remplace l'ancienne prise par celle-ci
      $('rec-status').textContent = 'prise envoyée ✔ — re-clique sur ⏺ pour la refaire';
    } catch { showError("échec d'envoi de la prise"); }
  };
  rec.onerror = () => { activeRec = null; setRecBtn(false); showError('enregistrement impossible'); };
  rec.start();
  activeRec = rec;
  setRecBtn(true);
  $('rec-status').textContent = 'ça tourne… imite le son de la vidéo !';
}

function stopTake() {
  if (activeRec) { try { activeRec.stop(); } catch { /* déjà stoppé */ } }
}

function setRecBtn(recording) {
  const btn = $('rec-btn');
  btn.textContent = recording ? '⏹ stop' : '⏺ enregistrer';
  btn.classList.toggle('armed', recording);
}

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
  renderScoreboard(msg.players);
  if (msg.phase === 'lobby' && !inEndScreen) show('lobby');
});

NET.on('scores', (msg) => renderScoreboard(msg.scores));
NET.on('error', (msg) => showError(msg.message));
NET.on('closed', () => { if (you) showError('connexion au serveur perdue'); });
NET.on('listen', (msg) => { pendingListen = msg; });

// La frame binaire qui suit un 'listen' : on rejoue la vidéo (muette) + la prise par-dessus.
NET.onBinary = (buf) => {
  if (!pendingListen) return;
  const msg = pendingListen;
  pendingListen = null;

  hideAll();
  $('listen-box').hidden = false;
  const mine = msg.player === you;
  setStage('🎧 notation', mine ? 'ta prise passe - les autres notent' : 'note cette imitation');
  $('listen-name').textContent = mine ? `${esc(msg.name)} (toi)` : esc(msg.name);
  $('listen-count').textContent = `imitation ${msg.idx}/${msg.of}`;
  for (const b of document.querySelectorAll('.rate')) b.disabled = mine;

  const v = $('ref-video');
  v.hidden = false;
  v.muted = true;          // l'image du clip, mais le son : c'est l'imitation
  v.currentTime = 0;
  v.play().catch(() => {});

  const url = URL.createObjectURL(new Blob([buf], { type: msg.mime }));
  const player = $('playback');
  player.src = url;
  player.onended = () => URL.revokeObjectURL(url);
  player.play().catch(() => {});
  countdown(msg.deadline);
};

for (const btn of document.querySelectorAll('.rate')) {
  btn.addEventListener('click', () => {
    NET.send({ action: 'rate', value: +btn.dataset.v });
    for (const b of document.querySelectorAll('.rate')) b.disabled = true;
  });
}

NET.on('phase', (msg) => { (PHASES[msg.phase] || (() => {}))(msg); });

const PHASES = {
  watching(msg) {
    inEndScreen = false;
    show('game');
    hideAll();
    setStage(`round ${msg.round}/${msg.of}`, 'regarde (et écoute) bien…');
    const v = $('ref-video');
    v.hidden = false;
    v.muted = false;                        // premier visionnage : avec le son
    v.src = 'videos/' + msg.video + '.mp4';
    v.currentTime = 0;
    v.play().catch(() => {});               // autoplay bloqué → l'utilisateur a les contrôles
    countdown(msg.deadline);
  },

  recording(msg) {
    hideAll();
    $('ref-video').hidden = false;          // la vidéo reste à l'écran, prête à tourner
    $('rec-box').hidden = false;
    setStage('🎙 à toi', 'clique sur ⏺ : la vidéo repart et tu imites en rythme');
    $('rec-status').textContent = 'tu peux refaire ta prise autant de fois que tu veux';
    countdown(msg.deadline);
    // À la deadline, une prise en cours est stoppée (et donc envoyée) automatiquement.
    clearTimeout(recStopTimer);
    recStopTimer = setTimeout(stopTake, Math.max(0, msg.deadline - Date.now() - 600));
  },

  rating(msg) {
    stopTake();
    hideAll();
    setStage('🎧 notation', `les ${msg.count} imitations arrivent…`);
    countdown(null);
  },

  results(msg) {
    hideAll();
    $('scores').hidden = false;
    setStage('résultats', 'les points du round');
    renderScoreboard(msg.scores);
    $('scores').innerHTML = msg.scores
      .map((p) => `<li>${esc(p.name)} <span class="pts">${p.score} pt${p.score > 1 ? 's' : ''}</span></li>`)
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

function renderScoreboard(list) {
  const sorted = [...list].sort((a, b) => b.score - a.score);
  $('scores-live').innerHTML = sorted
    .map((p) => `<li>${esc(p.name)}<span class="pts">${p.score}</span></li>`)
    .join('');
}

function setStage(title, sub) {
  $('stage-title').textContent = title;
  $('stage-sub').textContent = sub;
}

function hideAll() {
  const v = $('ref-video');
  v.pause();
  v.hidden = true;
  $('rec-box').hidden = true;
  $('listen-box').hidden = true;
  $('scores').hidden = true;
  $('back-lobby').hidden = true;
  $('rec-status').textContent = '';
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
