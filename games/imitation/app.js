// UI du jeu d'imitation. Le serveur ordonne les phases, cette page obéit :
// elle affiche l'état reçu, capture le micro quand on le lui demande, transmet les notes.
//
// v4 : avatars emoji, bouton « prêt » avec check, config des manches par le host,
// waveform aussi pendant le visionnage, réécoute de sa prise, code de room géant
// cliquable-pour-copier, et petits jingles synthétisés (Web Audio, zéro fichier).

let you = null;
let isHost = false;
let currentPhase = 'lobby';
let micStream = null;
let MIME = '';
let pendingListen = null; // méta 'listen' en attente de sa frame binaire
let inEndScreen = false;
let activeRec = null;     // MediaRecorder en cours, sinon null
let lastTakeUrl = null;   // blob URL de la dernière prise envoyée (pour la réécoute)
let myReady = false;
let myAvatar = null;

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

// --- Web Audio : waveform + jingles ---------------------------------------
// Un seul graphe, trois sources possibles vers l'analyseur : la vidéo (visionnage),
// le micro (ta prise), le lecteur (écoute / réécoute). On ne branche que la bonne.

let actx = null, analyser = null, micNode = null, playbackNode = null, videoNode = null;
let vizOn = false;
const history = [];

function ensureAudioGraph() {
  if (!actx) {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = actx.createAnalyser();
    analyser.fftSize = 1024;
    playbackNode = actx.createMediaElementSource($('playback'));
    playbackNode.connect(actx.destination);
    videoNode = actx.createMediaElementSource($('ref-video'));
    videoNode.connect(actx.destination); // le son de la vidéo continue de sortir normalement
  }
  if (actx.state === 'suspended') actx.resume();
}

const plug = (node, on) => {
  if (!node) return;
  if (on) node.connect(analyser);
  else { try { node.disconnect(analyser); } catch { /* déjà débranché */ } }
};
function vizMic(on) {
  ensureAudioGraph();
  if (on && !micNode) micNode = actx.createMediaStreamSource(micStream);
  plug(micNode, on);
}
const vizPlayback = (on) => { ensureAudioGraph(); plug(playbackNode, on); };
const vizVideo = (on) => { ensureAudioGraph(); plug(videoNode, on); };

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

// Jingles synthétisés : pas de fichier audio à héberger, juste des oscillateurs.
function beep(freq, t0, dur, type = 'square', gain = 0.1) {
  const o = actx.createOscillator();
  const g = actx.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(gain, actx.currentTime + t0);
  g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + t0 + dur);
  o.connect(g).connect(actx.destination);
  o.start(actx.currentTime + t0);
  o.stop(actx.currentTime + t0 + dur + 0.05);
}
const JINGLES = {
  start: () => [262, 330, 392, 523].forEach((f, i) => beep(f, i * 0.12, 0.18, 'triangle')),
  send: () => beep(660, 0, 0.12, 'sine'),
  listen: () => [392, 523].forEach((f, i) => beep(f, i * 0.1, 0.12, 'sine', 0.07)),
  results: () => [523, 392, 659, 784].forEach((f, i) => beep(f, i * 0.13, 0.2, 'triangle')),
  end: () => [392, 494, 587, 784, 988].forEach((f, i) => beep(f, i * 0.12, 0.25, 'triangle')),
  ready: () => beep(880, 0, 0.07, 'sine', 0.07),
};
function jingle(name) {
  if (actx) { try { JINGLES[name](); } catch { /* tant pis pour le son */ } }
}

// --- accueil : pseudo + avatar --------------------------------------------

const AVATARS = ['😎', '🤖', '👻', '🐸', '🦊', '🐼', '🔥', '⚡', '🎤', '🎧', '🍕', '🚀'];
myAvatar = AVATARS[Math.floor(Math.random() * AVATARS.length)];
for (const em of AVATARS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'avatar-pick' + (em === myAvatar ? ' picked' : '');
  b.textContent = em;
  b.addEventListener('click', () => {
    myAvatar = em;
    for (const x of document.querySelectorAll('.avatar-pick')) x.classList.toggle('picked', x === b);
  });
  $('avatar-row').appendChild(b);
}

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
    NET.send(code === undefined
      ? { action: 'join', name, avatar: myAvatar }
      : { action: 'join', name, code, avatar: myAvatar });
  } catch (err) {
    showError(err.name === 'NotAllowedError' ? 'accès micro refusé - le jeu en a besoin' : err.message);
  }
}

// --- lobby : prêt, config du host, code copiable ---------------------------

$('ready-btn').addEventListener('click', () => {
  myReady = !myReady;
  NET.send({ action: 'ready', ready: myReady });
  jingle('ready');
});

$('start').addEventListener('click', () => {
  NET.send({ action: 'start', rounds: +$('rounds-select').value });
});

$('room-code').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('room-code').textContent.trim());
    $('code-hint').textContent = 'code copié ✔';
    setTimeout(() => { $('code-hint').textContent = 'clique sur le code pour le copier'; }, 1500);
  } catch { /* pas de clipboard : tant pis */ }
});

$('back-lobby').addEventListener('click', () => { inEndScreen = false; show('lobby'); });
$('next-btn').addEventListener('click', () => NET.send({ action: 'next' }));

// --- enregistrement : ⏺, stop automatique à la fin du clip, réécoute -------

$('rec-btn').addEventListener('click', () => (activeRec ? stopTake() : startTake()));
$('ref-video').addEventListener('ended', () => stopTake()); // fin du clip = fin de la prise

function startTake() {
  stopReplay();
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
      if (lastTakeUrl) URL.revokeObjectURL(lastTakeUrl);
      lastTakeUrl = URL.createObjectURL(blob);
      $('replay-btn').hidden = false;
      $('rec-status').textContent = 'prise envoyée ✔ — réécoute-la, ou re-clique sur ⏺ pour la refaire';
      jingle('send');
    } catch { showError("échec d'envoi de la prise"); }
  };
  rec.onerror = () => { activeRec = null; setRecBtn(false); vizMic(false); showError('enregistrement impossible'); };
  rec.start();
  activeRec = rec;
  setRecBtn(true);
  vizMic(true);
  startViz();
  $('rec-status').textContent = 'ça tourne… la prise s\'arrête toute seule à la fin du clip';
}

function stopTake() {
  if (activeRec) { try { activeRec.stop(); } catch { /* déjà stoppé */ } }
}

function setRecBtn(recording) {
  const btn = $('rec-btn');
  btn.textContent = recording ? '⏹ stop' : '⏺ enregistrer';
  btn.classList.toggle('armed', recording);
}

// Réécoute de sa propre prise (localement, sans toucher au serveur).
$('replay-btn').addEventListener('click', () => {
  if (activeRec || !lastTakeUrl) return;
  const player = $('playback');
  player.src = lastTakeUrl;
  player.onended = () => vizPlayback(false);
  player.play().catch(() => {});
  vizPlayback(true);
  startViz();
});

function stopReplay() {
  const player = $('playback');
  if (!player.paused) player.pause();
  vizPlayback(false);
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
  if (me) myReady = !!me.ready;

  $('players').innerHTML = msg.players
    .map((p) => `<li><span class="pp">${esc(p.avatar || '🙂')}</span>${esc(p.name)}`
      + `${p.host ? ' <span class="tag">host</span>' : ''}`
      + `<span class="pts">${p.ready ? '<span class="ok">✔ prêt</span>' : '·'}</span></li>`)
    .join('');

  const readyCount = msg.players.filter((p) => p.ready).length;
  $('ready-btn').textContent = myReady ? '✔ je suis prêt' : 'je suis prêt !';
  $('ready-btn').classList.toggle('is-ready', myReady);
  $('host-config').hidden = !isHost;
  $('start').disabled = msg.players.length < 2;
  $('ready-count').textContent = `${readyCount}/${msg.players.length} prêts`;
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
  setStage('🎧 écoute & note', mine ? 'ta prise passe - les autres notent' : 'note cette imitation avec les boutons dessous');
  $('listen-name').innerHTML = `<span class="pp">${esc(msg.avatar || '🙂')}</span>${esc(msg.name)}${mine ? ' (toi)' : ''}`;
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
    if (msg.round === 1) jingle('start');
    setStage(`round ${msg.round}/${msg.of} — 👀 regarde`, 'écoute bien : après, ce sera à toi de l\'imiter');
    const v = $('ref-video');
    v.hidden = false;
    v.muted = false;                                       // premier visionnage : avec le son
    v.src = msg.url || 'videos/' + msg.video + '.mp4';     // CDN Pages, ou hébergement externe
    v.currentTime = 0;
    v.play().catch(() => {});                              // autoplay bloqué → l'utilisateur a les contrôles
    vizVideo(true);                                        // le waveform suit le son du clip
    startViz();
  },

  recording() {
    hideStage();
    $('ref-video').hidden = false;          // la vidéo reste à l'écran, prête à tourner
    $('rec-box').hidden = false;
    $('replay-btn').hidden = !lastTakeUrl;
    setStage('🎙 à toi', 'clique sur ⏺ : la vidéo repart (en muet) et tu imites en rythme');
    $('rec-status').textContent = 'la prise s\'arrête toute seule à la fin du clip — refais-la autant que tu veux';
  },

  rating(msg) {
    stopTake();
    stopReplay();
    hideStage();
    jingle('listen');
    setStage('🎧 écoute & note', `les ${msg.count} imitations arrivent…`);
  },

  results(msg) {
    hideStage();
    jingle('results');
    $('scores').hidden = false;
    setStage('🏁 résultats', 'les points du round');
    renderScoreboard(msg.scores);
    $('scores').innerHTML = msg.scores
      .map((p) => `<li><span class="pp">${esc(p.avatar || '🙂')}</span>${esc(p.name)} <span class="pts">${p.score} pt${p.score > 1 ? 's' : ''}</span></li>`)
      .join('');
  },

  end(msg) {
    inEndScreen = true;
    hideStage();
    show('game');
    jingle('end');
    $('scores').hidden = false;
    $('back-lobby').hidden = false;
    const medals = ['🥇', '🥈', '🥉'];
    setStage('🏆 fin de partie', 'le podium');
    $('scores').innerHTML = msg.podium
      .map((p, i) => `<li>${medals[i] || '·'} <span class="pp">${esc(p.avatar || '🙂')}</span>${esc(p.name)} <span class="pts">${p.score} pt${p.score > 1 ? 's' : ''}</span></li>`)
      .join('');
  },
};

// --- helpers d'affichage ---------------------------------------------------

function renderScoreboard(list) {
  const sorted = [...list].sort((a, b) => b.score - a.score);
  $('scores-live').innerHTML = sorted
    .map((p) => `<li><span class="pp">${esc(p.avatar || '🙂')}</span>${esc(p.name)}`
      + `${p.ready ? ' <span class="ok">✔</span>' : ''}`
      + `<span class="pts">${p.score}</span></li>`)
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
  vizVideo(false);
  vizPlayback(false);
  vizMic(false);
  stopViz();
}

const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
