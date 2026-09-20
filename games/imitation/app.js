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
let lastPlayers = [];     // dernier état connu des joueurs (pour nommer qui on attend)

// Le catalogue (videos/videos.json) ne donne QUE l'id : le front construit
// l'URL du bucket R2, comme le Jeu du Ban. Convention : <id>.mp4 à la racine.
// Une entrée peut toujours forcer une `url` à elle (exception ponctuelle).
// ?cdn=... pour tester contre un autre hébergement.
const CDN = (new URLSearchParams(location.search).get('cdn')
  || 'https://pub-ba7b84ba31b243b18264ea0403fd75fa.r2.dev').replace(/\/$/, '');
const videoUrl = (id) => `${CDN}/${id}.mp4`;

const $ = (id) => document.getElementById(id);

// --- test micro (lobby) -----------------------------------------------------
// Autant vérifier son micro AVANT de jouer : un flux dédié, un niveau en direct,
// et on relâche tout dès qu'on arrête (pas de micro ouvert en fond).
const MICTEST = (() => {
  let stream = null, ctx = null, an = null, raf = 0, peak = 0;
  const buf = new Uint8Array(1024);
  function paint() {
    an.getByteTimeDomainData(buf);
    let p = 0;
    for (const v of buf) p = Math.max(p, Math.abs(v - 128) / 128);
    peak = Math.max(peak, p);
    $('mic-level').style.width = Math.min(100, p * 260).toFixed(1) + '%';
    if (peak > 0.04) { $('mic-hint').textContent = 'micro OK, on t\'entend ✔'; $('mic-hint').className = 'ok'; }
    raf = requestAnimationFrame(paint);
  }
  async function start() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') await ctx.resume();
      an = ctx.createAnalyser(); an.fftSize = 2048;
      ctx.createMediaStreamSource(stream).connect(an);   // analyse seule : aucun retour dans les enceintes
      peak = 0;
      $('mic-hint').textContent = 'parle : la barre doit bouger'; $('mic-hint').className = '';
      $('mic-btn').textContent = 'arrêter'; $('mic-btn').classList.add('on');
      paint();
      return true;
    } catch (e) {
      $('mic-hint').textContent = 'micro refusé ou introuvable — vérifie les autorisations';
      $('mic-hint').className = 'ko';
      stop();
      return false;
    }
  }
  function stop() {
    if (raf) cancelAnimationFrame(raf); raf = 0;
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
    if (ctx) { try { ctx.close(); } catch (_) {} ctx = null; }
    an = null;
    $('mic-level').style.width = '0%';
    $('mic-btn').textContent = 'tester'; $('mic-btn').classList.remove('on');
  }
  return { toggle() { raf ? stop() : start(); }, stop, running: () => !!raf };
})();
$('mic-btn').addEventListener('click', () => MICTEST.toggle());
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
// Deux analyseurs : `refAnalyser` reçoit TOUJOURS le son de la vidéo (référence),
// `analyser` reçoit la source dynamique (micro pendant la prise, lecteur en écoute).
// Le son de la vidéo passe par `videoGain` : à 0 pendant la prise, la vidéo est
// INAUDIBLE (le micro ne la capte pas) mais reste analysable → on peut afficher
// son waveform. (Muter l'élément couperait aussi l'analyse : vérifié.)

let actx = null, analyser = null, refAnalyser = null;
let micNode = null, playbackNode = null, videoNode = null, videoGain = null;
let vizOn = false;

function ensureAudioGraph() {
  if (!actx) {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = actx.createAnalyser(); analyser.fftSize = 1024;
    refAnalyser = actx.createAnalyser(); refAnalyser.fftSize = 1024;

    playbackNode = actx.createMediaElementSource($('playback'));
    playbackNode.connect(actx.destination); // l'imitation écoutée sort toujours

    videoNode = actx.createMediaElementSource($('ref-video'));
    videoGain = actx.createGain();
    videoNode.connect(videoGain).connect(actx.destination); // sortie audible pilotée
    videoNode.connect(refAnalyser);                          // analyse toujours dispo
  }
  if (actx.state === 'suspended') actx.resume();
}

// Rend la vidéo audible (visionnage) ou non (prise / écoute d'imitation).
function setVideoAudible(on) {
  ensureAudioGraph();
  videoGain.gain.value = on ? 1 : 0;
}

const plug = (node, on) => {
  if (!node) return;
  try { node.disconnect(analyser); } catch { /* pas branché */ }
  if (on) node.connect(analyser);
};
function vizMic(on) {
  ensureAudioGraph();
  if (on && !micNode) micNode = actx.createMediaStreamSource(micStream);
  plug(micNode, on);
}
const vizPlayback = (on) => { ensureAudioGraph(); plug(playbackNode, on); };

// Le tracé garde TOUT l'historique : plus ça avance, plus on « dézoome » pour
// voir le waveform en entier. `vizFrozen` fige le tracé quand la source se termine
// (au lieu de tracer du silence). Une ou deux pistes selon la phase : en prise,
// piste 1 = son de la vidéo (référence, ambre), piste 2 = ta voix (violet), les
// deux superposées et défilant ensemble pour te caler dessus.
let vizFrozen = false;
let vizTracks = []; // [{ an, hist, color, fill }]
const vizTmp = new Uint8Array(1024);

function startViz(trackDefs) {
  vizTracks = trackDefs.map((t) => ({ ...t, hist: [] }));
  vizFrozen = false;
  $('wave').hidden = false;
  if (vizOn) return;
  vizOn = true;
  const cv = $('wave');
  const ctx = cv.getContext('2d');
  (function frame() {
    if (!vizOn) return;
    requestAnimationFrame(frame);
    if (!vizFrozen) {
      for (const t of vizTracks) {
        t.an.getByteTimeDomainData(vizTmp);
        let peak = 0;
        for (const v of vizTmp) peak = Math.max(peak, Math.abs(v - 128) / 128);
        t.hist.push(peak);
        if (t.hist.length > 6000) t.hist.shift();
      }
    }
    cv.width = cv.clientWidth;   // suit la largeur réelle (responsive)
    const mid = cv.height / 2;
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (const t of vizTracks) { // dans l'ordre : la référence d'abord (fond), la voix par-dessus
      const n = t.hist.length || 1;
      const step = cv.width / n;
      const w = t.fill ? Math.max(1, step) : Math.max(1, Math.min(2, step * 0.7));
      ctx.fillStyle = t.color;
      t.hist.forEach((p, i) => {
        const h = Math.max(2, p * cv.height);
        ctx.fillRect(i * step, mid - h / 2, w, h);
      });
    }
  })();
}

const freezeViz = () => { vizFrozen = true; };

function stopViz() {
  vizOn = false;
  vizTracks = [];
  $('wave').hidden = true;
}

// Couleurs des pistes
const WAVE_VOICE = '#8b5cf6';                 // ta voix / source unique (violet)
const WAVE_REF = 'rgba(245, 158, 11, 0.45)';  // référence vidéo (ambre translucide, en fond)

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
myAvatar = GameProfile.startEmoji(AVATARS); // profil local, sinon un repli stable
for (const em of AVATARS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'avatar-pick' + (em === myAvatar ? ' picked' : '');
  b.textContent = em;
  b.setAttribute('aria-pressed', String(em === myAvatar));
  b.addEventListener('click', () => {
    myAvatar = em;
    for (const x of document.querySelectorAll('.avatar-pick')) x.classList.toggle('picked', x === b);
    document.querySelectorAll('.avatar-pick').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
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
    // L'avatar complet : la photo du profil s'il y en a une, l'emoji toujours.
    const avatar = GameProfile.joinAvatar(myAvatar);
    NET.send(code === undefined
      ? { action: 'join', name, avatar }
      : { action: 'join', name, code, avatar });
  } catch (err) {
    const micro = err.name === 'NotAllowedError';
    showError(micro ? 'accès micro refusé - le jeu en a besoin' : err.message);
    // Entrée lancée par le Hub et ratée : on le dit, sinon le groupe attend un
    // joueur qui n'arrivera jamais. Le micro refusé est un échec d'ENTRÉE (le
    // jeu en a besoin), pas un serveur injoignable.
    if (lien && viaHub && !you) { viaHub = false; lien.failed(micro ? 'JOIN' : 'UNREACHABLE', micro ? 'micro refusé' : err.message); }
  }
}

// --- lancé par le Game Hub -------------------------------------------------
// Si la page a été ouverte par le Hub, un billet dit si l'on CRÉE la partie
// (l'hôte du lancement) ou si l'on REJOINT le code du groupe. Dans les deux cas
// on passe par `enter()`, le chemin normal de cette page : aucun second système
// de création ni de join, et le micro est demandé au même moment qu'à la main.
// ⚠️ Sans billet, `lien` vaut null et la page marche exactement comme avant.
let viaHub = false;            // le join en cours vient du Hub
let partirSansAttendre = false;
let codeDeclare = null;        // le code déjà annoncé au Hub (une seule fois)
const lien = window.HubHandoff ? HubHandoff.start({
  gameId: 'imitation',
  join: (code) => {
    viaHub = true;
    if (!$('name-input').value.trim()) $('name-input').value = GameProfile.load().name || '';
    enter(code || undefined);
  },
  onUpdate: attente,
}) : null;

// L'hôte ne lance pas tant que le groupe n'est pas dans la room : imitation-server
// refuse un join quand la phase n'est plus `lobby` (« partie en cours »), donc un
// invité en retard serait laissé dehors. Il peut partir sans eux — explicitement.
// Hors Hub, seule la règle habituelle s'applique : au moins 2 joueurs.
function attente(i) {
  const n = i && i.launch.stage === 'join' ? i.waitingIds.length : 0;
  const bloque = isHost && n > 0 && !partirSansAttendre;
  $('start').disabled = bloque || lastPlayers.length < 2;
  $('start').textContent = bloque ? `En attente de ${i.waiting}…` : 'Lancer la partie';
  $('start-anyway').hidden = !bloque;
}

// --- lobby : prêt, config du host, code copiable ---------------------------

// Même bouton « prêt » à deux endroits : au lobby, et pendant l'enregistrement
// (où il veut dire « j'ai fini ma prise » - le serveur le remet à zéro à chaque round).
function toggleReady() {
  myReady = !myReady;
  NET.send({ action: 'ready', ready: myReady });
  jingle('ready');
}
$('ready-btn').addEventListener('click', toggleReady);
$('rec-ready-btn').addEventListener('click', toggleReady);

$('start').addEventListener('click', () => {
  NET.send({ action: 'start', rounds: +$('rounds-select').value });
});
$('start-anyway').addEventListener('click', () => {
  partirSansAttendre = true;
  NET.send({ action: 'start', rounds: +$('rounds-select').value });
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

$('back-lobby').addEventListener('click', () => { inEndScreen = false; show('lobby'); });
$('next-btn').addEventListener('click', () => NET.send({ action: 'next' }));

// --- enregistrement : ⏺, stop automatique à la fin du clip, réécoute -------

$('rec-btn').addEventListener('click', () => (activeRec ? stopTake() : startTake()));
$('ref-video').addEventListener('ended', () => { stopTake(); freezeViz(); }); // fin du clip = fin de prise, tracé figé
$('playback').addEventListener('ended', () => { freezeViz(); vizPlayback(false); });

// Vidéo injoignable (URL R2 fausse, fichier absent, ou CORS non configuré) :
// on le DIT, au lieu d'un écran noir muet. Le waveform du visionnage exige du
// CORS propre sur l'hébergeur (crossorigin="anonymous").
$('ref-video').addEventListener('error', () => {
  const v = $('ref-video');
  if (!v.src) return; // pas de source posée : rien à signaler
  showError('vidéo injoignable — vérifie l\'URL et la config CORS de l\'hébergeur (ouvre l\'URL du clip dans un onglet pour tester)');
});

function startTake() {
  stopReplay();
  const v = $('ref-video');
  setVideoAudible(false);  // vidéo inaudible (le micro ne la capte pas) mais analysée
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
    freezeViz(); // on fige le tracé de la prise au lieu de dessiner du silence
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
  // Deux pistes superposées : référence (son vidéo, ambre en fond) + ta voix (violet).
  startViz([{ an: refAnalyser, color: WAVE_REF, fill: true }, { an: analyser, color: WAVE_VOICE }]);
  $('wave-legend').hidden = false;
  $('rec-status').textContent = 'ça tourne… cale ta voix (violet) sur la référence (ambre) — stop auto en fin de clip';
}

function stopTake() {
  if (activeRec) { try { activeRec.stop(); } catch { /* déjà stoppé */ } }
}

function setRecBtn(recording) {
  const btn = $('rec-btn');
  btn.textContent = recording ? '⏹ stop' : '⏺ enregistrer';
  btn.classList.toggle('armed', recording);
}

// Réécoute de sa propre prise (localement) : on relance AUSSI la vidéo (muette)
// pour juger la synchro, avec le double waveform référence + voix.
$('replay-btn').addEventListener('click', () => {
  if (activeRec || !lastTakeUrl) return;
  const v = $('ref-video');
  v.hidden = false;
  setVideoAudible(false);       // image de la vidéo, mais on entend la prise (pas le clip)
  v.currentTime = 0;
  v.play().catch(() => {});
  const player = $('playback');
  player.src = lastTakeUrl;
  player.currentTime = 0;
  player.play().catch(() => {});
  vizPlayback(true);
  // deux pistes : référence (son vidéo, ambre) + ta prise (violet) → tu vois le calage
  startViz([{ an: refAnalyser, color: WAVE_REF, fill: true }, { an: analyser, color: WAVE_VOICE }]);
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
  rating: '→ imitation suivante',
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
  // Lancé par le Hub : on lui dit dans quelle room on est. L'hôte y déclare le
  // code (le seul qu'il croira), les invités confirment y être entrés. ⚠️ `room`
  // arrive à CHAQUE changement du salon : une seule annonce.
  if (lien && !codeDeclare) { codeDeclare = msg.code; viaHub = false; lien.roomReady(msg.code); }
  lastPlayers = msg.players;
  const me = msg.players.find((p) => p.id === you);
  isHost = !!(me && me.host);
  if (me) myReady = !!me.ready;

  $('players').innerHTML = msg.players
    .map((p) => `<li class="g-player">${GameAvatar.slot(p.avatar, undefined, 'md')}`
      + `<span class="g-player-name">${esc(p.name)}${p.host ? ' <span class="tag">host</span>' : ''}</span>`
      + `<span class="pts">${p.ready ? '<span class="ok">✔ prêt</span>' : '·'}</span></li>`)
    .join('');
  GameAvatar.fill($('players'));

  const readyCount = msg.players.filter((p) => p.ready).length;
  $('ready-btn').textContent = myReady ? '✔ je suis prêt' : 'je suis prêt !';
  $('ready-btn').classList.toggle('is-ready', myReady);
  $('rec-ready-btn').textContent = myReady ? '✔ j\'ai fini' : 'j\'ai fini !';
  $('rec-ready-btn').classList.toggle('is-ready', myReady);
  $('host-config').hidden = !isHost;
  attente(lien && lien.info());
  // On NOMME ceux qu'on attend : « 2/4 prêts » ne dit pas après qui on poireaute.
  const waiting = msg.players.filter((p) => !p.ready).map((p) => p.name);
  $('ready-count').innerHTML = waiting.length === 0
    ? `<span class="ok">✔ tout le monde est prêt (${readyCount}/${msg.players.length})</span>`
    : `${readyCount}/${msg.players.length} prêts — on attend `
      + `<b>${waiting.map(esc).join(', ')}</b>`;
  $('need-players').hidden = msg.players.length >= 2;

  renderScoreboard(msg.players);
  renderHostControls(); // le host peut changer en cours de partie (départ)
  if (msg.phase === 'lobby' && !inEndScreen) { currentPhase = 'lobby'; show('lobby'); }
});

NET.on('scores', (msg) => renderScoreboard(msg.scores));
NET.on('error', (msg) => {
  showError(msg.message);
  // Le serveur refuse d'entrer (code inconnu, room pleine, partie en cours) :
  // le Hub est prévenu, pour que le groupe le sache au lieu d'attendre.
  if (lien && viaHub && !you) { viaHub = false; lien.failed('JOIN', msg.message); }
});
NET.on('closed', () => { if (you) showError('connexion au serveur perdue'); });
NET.on('hurry', () => stopTake()); // le host a clôturé : la prise en cours part telle quelle
NET.on('listen', (msg) => { pendingListen = msg; });

// La frame binaire qui suit un 'listen' : vidéo muette + la prise par-dessus + waveform.
// L'imitation joue jusqu'au bout - noter ne coupe rien, et « ↺ » la rejoue.
let listenUrl = null;   // blob de l'imitation en cours (gardé pour la réécoute)
let lastListen = null;  // méta de l'imitation en cours (compteur, avancement des votes)

NET.onBinary = (buf) => {
  if (!pendingListen) return;
  const msg = pendingListen;
  pendingListen = null;

  hideStage();       // nettoie l'écran (et remet lastListen à null)…
  lastListen = msg;  // …donc on mémorise la prise APRÈS, pas avant
  $('listen-box').hidden = false;
  const mine = msg.player === you;
  setStage('🎧 écoute & note', mine ? 'ta prise passe - les autres notent' : 'note cette imitation avec les boutons dessous');
  // « C'est à qui ? » : le moment où l'identité compte le plus → grand format.
  $('listen-name').innerHTML = `<span class="g-player">${GameAvatar.slot(msg.avatar, undefined, 'lg')}`
    + `<span class="g-player-name">${esc(msg.name)}${mine ? ' (toi)' : ''}</span></span>`;
  GameAvatar.fill($('listen-name'));
  renderVoteWait([], msg.player);   // personne n'a encore voté sur cette prise
  for (const b of document.querySelectorAll('.rate')) b.disabled = mine;

  if (listenUrl) URL.revokeObjectURL(listenUrl);
  listenUrl = URL.createObjectURL(new Blob([buf], { type: msg.mime }));
  playCurrentListen();
};

// (Re)joue l'imitation en cours : vidéo muette relancée + audio synchro + waveform.
function playCurrentListen() {
  const v = $('ref-video');
  v.hidden = false;
  setVideoAudible(false);  // l'image du clip, mais le son qu'on entend : c'est l'imitation
  v.currentTime = 0;
  v.play().catch(() => {});
  const player = $('playback');
  player.src = listenUrl;
  player.play().catch(() => {});
  vizPlayback(true);
  startViz([{ an: analyser, color: WAVE_VOICE }]); // waveform de l'imitation écoutée
}

$('relisten-btn').addEventListener('click', () => { if (listenUrl) playCurrentListen(); });

// Qui n'a pas encore voté ? Affiché DÈS l'arrivée de la prise (personne n'a
// voté à ce moment-là) puis à chaque vote reçu. Le propriétaire ne vote pas
// sur sa propre imitation : il ne compte jamais parmi ceux qu'on attend.
function renderVoteWait(votedIds, ownerId) {
  if (!lastListen) return;
  const owner = ownerId !== undefined ? ownerId : lastListen.player;
  const late = (lastPlayers || [])
    .filter((p) => p.id !== owner && !(votedIds || []).includes(p.id))
    .map((p) => esc(p.name));
  const head = `imitation ${lastListen.idx}/${lastListen.of}`;
  $('listen-count').innerHTML = late.length
    ? `${head} — on attend <b>${late.join(', ')}</b>`
    : `${head} — <span class="ok">✔ tout le monde a voté</span>`;
}

NET.on('rated', (msg) => renderVoteWait(msg.ids, msg.owner));

for (const btn of document.querySelectorAll('.rate')) {
  btn.addEventListener('click', () => {
    NET.send({ action: 'rate', value: +btn.dataset.v });
    for (const b of document.querySelectorAll('.rate')) b.disabled = true;
    setStage('🎧 écoute & note', 'note envoyée ✔ — le host passe à la suivante quand tout le monde a noté');
  });
}

NET.on('phase', (msg) => {
  currentPhase = msg.phase;
  (PHASES[msg.phase] || (() => {}))(msg);
  renderHostControls();
});

const PHASES = {
  watching(msg) {
    MICTEST.stop();          // la partie commence : on relâche le micro du test
    inEndScreen = false;
    show('game');
    hideStage();
    if (msg.round === 1) { jingle('start'); if (lien && isHost) lien.started(); }
    setStage(`round ${msg.round}/${msg.of} — 👀 regarde`, 'écoute bien : après, ce sera à toi de l\'imiter');
    const v = $('ref-video');
    v.hidden = false;
    setVideoAudible(true);                                 // premier visionnage : avec le son
    v.src = msg.url || videoUrl(msg.video);                // `url` en exception, sinon le bucket R2
    v.currentTime = 0;
    v.play().catch(() => {});                              // autoplay bloqué → l'utilisateur a les contrôles
    startViz([{ an: refAnalyser, color: WAVE_VOICE }]);    // waveform du son du clip
  },

  recording() {
    hideStage();
    $('ref-video').hidden = false;          // la vidéo reste à l'écran, prête à tourner
    $('rec-box').hidden = false;
    $('replay-btn').hidden = !lastTakeUrl;
    setStage('🎙 à toi', 'clique sur ⏺ : la vidéo repart et tu cales ta voix sur son waveform');
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
      .map((p) => `<li class="g-player">${GameAvatar.slot(p.avatar, undefined, 'md')}<span class="g-player-name">${esc(p.name)}</span> <span class="pts g-player-score">${p.score} pt${p.score > 1 ? 's' : ''}</span></li>`)
      .join('');
    GameAvatar.fill($('scores'));
  },

  end(msg) {
    inEndScreen = true;
    hideStage();
    show('game');
    jingle('end');
    if (lien) { lien.ended(); $('to-hub').hidden = false; }
    $('scores').hidden = false;
    $('back-lobby').hidden = false;
    const medals = ['🥇', '🥈', '🥉'];
    setStage('🏆 fin de partie', 'le podium');
    $('scores').innerHTML = msg.podium
      // Podium : les trois premiers en grand, les suivants au format liste.
      .map((p, i) => `<li class="g-player${i < 3 ? ' podium-top' : ''}"><span class="medal">${medals[i] || '·'}</span>${GameAvatar.slot(p.avatar, undefined, i < 3 ? 'lg' : 'md')}`
        + `<span class="g-player-name">${esc(p.name)}</span> <span class="pts g-player-score">${p.score} pt${p.score > 1 ? 's' : ''}</span></li>`)
      .join('');
    GameAvatar.fill($('scores'));
  },
};

// --- helpers d'affichage ---------------------------------------------------

function renderScoreboard(list) {
  const sorted = [...list].sort((a, b) => b.score - a.score);
  $('scores-live').innerHTML = sorted
    .map((p) => `<li class="g-player">${GameAvatar.slot(p.avatar, undefined, 'md')}`
      + `<span class="g-player-name">${esc(p.name)}${p.ready ? ' <span class="ok">✔</span>' : ''}</span>`
      + `<span class="pts g-player-score">${p.score}</span></li>`)
    .join('');
  GameAvatar.fill($('scores-live'));
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
  $('wave-legend').hidden = true;
  $('rec-status').textContent = '';
  if (listenUrl) { URL.revokeObjectURL(listenUrl); listenUrl = null; }
  lastListen = null;
  setVideoAudible(false);
  vizPlayback(false);
  vizMic(false);
  stopViz();
}

const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
