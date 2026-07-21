// UI du jeu d'imitation. Le serveur ordonne les phases, cette page obéit :
// elle affiche l'état reçu, capture le micro quand on le lui demande, transmet les notes.
//
// v3 : plus aucun timer - le HOST pilote la partie avec un bouton « suivant »
// (les autres voient « en attente du host »). Un waveform temps réel (Web Audio)
// s'affiche sous la vidéo pendant ta prise et pendant l'écoute des autres.

let you = null;
let isHost = false;
let currentPhase = 'lobby';
let micStream = null;
let MIME = '';
let pendingListen = null; // méta 'listen' en attente de sa frame binaire
let inEndScreen = false;
let activeRec = null;     // MediaRecorder en cours, sinon null

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

// --- waveform (Web Audio) --------------------------------------------------
// Un seul canvas, deux sources possibles : le micro (pendant ta prise) ou le
// lecteur audio (pendant l'écoute). Le micro n'est branché sur l'analyseur que
// pendant l'enregistrement, sinon il polluerait le tracé de l'écoute.

let actx = null, analyser = null, micNode = null, playbackNode = null;
let vizOn = false;
const history = [];

function ensureAudioGraph() {
  if (!actx) {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = actx.createAnalyser();
    analyser.fftSize = 1024;
    playbackNode = actx.createMediaElementSource($('playback'));
    playbackNode.connect(actx.destination); // sinon l'audio ne sort plus
  }
  if (actx.state === 'suspended') actx.resume();
}

function vizMic(on) {
  ensureAudioGraph();
  if (on) {
    if (!micNode) micNode = actx.createMediaStreamSource(micStream);
    micNode.connect(analyser);
  } else if (micNode) {
    try { micNode.disconnect(analyser); } catch { /* déjà débranché */ }
  }
}

function vizPlayback(on) {
  ensureAudioGraph();
  if (on) playbackNode.connect(analyser);
  else { try { playbackNode.disconnect(analyser); } catch { /* déjà débranché */ } }
}

function startViz() {
  $('wave').hidden = false;
  history.length = 0;
  if (vizOn) return;
  vizOn = true;
  const data = new Uint8Array(analyser.fftSize);
  const cv = $('wave');
  const ctx = cv.getContext('2d');
  (function frame() {
    if (!vizOn) return;
    requestAnimationFrame(frame);
    cv.width = cv.clientWidth;   // suit la largeur réelle (responsive)
    analyser.getByteTimeDomainData(data);
    let peak = 0;
    for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128);
    history.push(peak);
    const bars = Math.floor(cv.width / 3);
    if (history.length > bars) history.splice(0, history.length - bars);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = '#8b5cf6';
    const mid = cv.height / 2;
    history.forEach((p, i) => {
      const h = Math.max(2, p * cv.height);
      ctx.fillRect(i * 3, mid - h / 2, 2, h);
    });
  })();
}

function stopViz() {
  vizOn = false;
  $('wave').hidden = true;
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
    ensureAudioGraph(); // créé sur le geste utilisateur, comme le micro
    await NET.connect();
    NET.send(code === undefined ? { action: 'join', name } : { action: 'join', name, code });
  } catch (err) {
    showError(err.name === 'NotAllowedError' ? 'accès micro refusé - le jeu en a besoin' : err.message);
  }
}

$('start').addEventListener('click', () => NET.send({ action: 'start' }));
$('back-lobby').addEventListener('click', () => { inEndScreen = false; show('lobby'); });
$('next-btn').addEventListener('click', () => NET.send({ action: 'next' }));

// --- enregistrement : ⏺ / ⏹, refaisable tant que le host n'a pas clôturé ----

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
    vizMic(false);
    const blob = new Blob(chunks, { type: rec.mimeType });
    if (!blob.size) return;
    try {
      await NET.sendAudio(blob); // le serveur remplace l'ancienne prise par celle-ci
      $('rec-status').textContent = 'prise envoyée ✔ — re-clique sur ⏺ pour la refaire';
    } catch { showError("échec d'envoi de la prise"); }
  };
  rec.onerror = () => { activeRec = null; setRecBtn(false); vizMic(false); showError('enregistrement impossible'); };
  rec.start();
  activeRec = rec;
  setRecBtn(true);
  vizMic(true);
  startViz();
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

// --- contrôles du host -----------------------------------------------------

const NEXT_LABELS = {
  watching: '→ passer à l\'enregistrement',
  recording: '→ tout le monde a fini',
  rating: '→ passer cette imitation',
  results: '→ round suivant',
};

function renderHostControls() {
  const label = NEXT_LABELS[currentPhase];
  $('next-btn').hidden = !(isHost && label);
  if (label) $('next-btn').textContent = label;
  $('wait-host').hidden = isHost || !label;
}

// --- messages serveur ------------------------------------------------------

NET.on('room', (msg) => {
  you = msg.you;
  $('room-code').textContent = msg.code;
  const me = msg.players.find((p) => p.id === you);
  isHost = !!(me && me.host);
  $('players').innerHTML = msg.players
    .map((p) => `<li>${esc(p.name)}${p.host ? ' <span class="tag">host</span>' : ''}<span class="pts">${p.score} pt${p.score > 1 ? 's' : ''}</span></li>`)
    .join('');
  $('start').hidden = !isHost;
  $('need-players').hidden = msg.players.length >= 2;
  renderScoreboard(msg.players);
  renderHostControls(); // le host peut changer en cours de partie (départ)
  if (msg.phase === 'lobby' && !inEndScreen) { currentPhase = 'lobby'; show('lobby'); }
});

NET.on('scores', (msg) => renderScoreboard(msg.scores));
NET.on('error', (msg) => showError(msg.message));
NET.on('closed', () => { if (you) showError('connexion au serveur perdue'); });
NET.on('hurry', () => stopTake()); // le host a clôturé : la prise en cours part telle quelle
NET.on('listen', (msg) => { pendingListen = msg; });

// La frame binaire qui suit un 'listen' : vidéo muette + la prise par-dessus + waveform.
NET.onBinary = (buf) => {
  if (!pendingListen) return;
  const msg = pendingListen;
  pendingListen = null;

  hideStage();
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
  vizPlayback(true);
  startViz();
};

for (const btn of document.querySelectorAll('.rate')) {
  btn.addEventListener('click', () => {
    NET.send({ action: 'rate', value: +btn.dataset.v });
    for (const b of document.querySelectorAll('.rate')) b.disabled = true;
  });
}

NET.on('phase', (msg) => {
  currentPhase = msg.phase;
  (PHASES[msg.phase] || (() => {}))(msg);
  renderHostControls();
});

const PHASES = {
  watching(msg) {
    inEndScreen = false;
    show('game');
    hideStage();
    setStage(`round ${msg.round}/${msg.of}`, 'regarde (et écoute) bien…');
    const v = $('ref-video');
    v.hidden = false;
    v.muted = false;                                       // premier visionnage : avec le son
    v.src = msg.url || 'videos/' + msg.video + '.mp4';     // CDN Pages, ou hébergement externe
    v.currentTime = 0;
    v.play().catch(() => {});                              // autoplay bloqué → l'utilisateur a les contrôles
  },

  recording() {
    hideStage();
    $('ref-video').hidden = false;          // la vidéo reste à l'écran, prête à tourner
    $('rec-box').hidden = false;
    setStage('🎙 à toi', 'clique sur ⏺ : la vidéo repart et tu imites en rythme');
    $('rec-status').textContent = 'tu peux refaire ta prise autant de fois que tu veux';
  },

  rating(msg) {
    stopTake();
    hideStage();
    setStage('🎧 notation', `les ${msg.count} imitations arrivent…`);
  },

  results(msg) {
    hideStage();
    $('scores').hidden = false;
    setStage('résultats', 'les points du round');
    renderScoreboard(msg.scores);
    $('scores').innerHTML = msg.scores
      .map((p) => `<li>${esc(p.name)} <span class="pts">${p.score} pt${p.score > 1 ? 's' : ''}</span></li>`)
      .join('');
  },

  end(msg) {
    inEndScreen = true;
    hideStage();
    show('game');
    $('scores').hidden = false;
    $('back-lobby').hidden = false;
    const medals = ['🥇', '🥈', '🥉'];
    setStage('fin de partie', 'le podium');
    $('scores').innerHTML = msg.podium
      .map((p, i) => `<li>${medals[i] || '·'} ${esc(p.name)} <span class="pts">${p.score} pt${p.score > 1 ? 's' : ''}</span></li>`)
      .join('');
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

function hideStage() {
  const v = $('ref-video');
  v.pause();
  v.hidden = true;
  $('rec-box').hidden = true;
  $('listen-box').hidden = true;
  $('scores').hidden = true;
  $('back-lobby').hidden = true;
  $('rec-status').textContent = '';
  vizPlayback(false);
  vizMic(false);
  stopViz();
}

const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
