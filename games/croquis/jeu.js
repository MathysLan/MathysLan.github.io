// Croquis — le salon et la SYNCHRONISATION du dessin (lot réseau 1).
//
// AUCUNE règle de jeu ici : croquis-server dit qui dessine, quel tour, quand
// le dessin commence et finit. Ce lot ne branche que le pipeline du dessin :
//   Pointer Event → dessin local immédiat (app.js) → `stroke` (sync.js, par
//   lots de ~50 ms) → serveur → les autres, qui le tracent avec la même règle.
// Pas encore de choix de mot (le serveur tire au sort à l'échéance), ni de
// devinettes, d'indices, de score, de révélation ni de classement.
//
// `?atelier` : l'atelier libre, sans réseau (le lot front 1).
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const AVATARS = ['🎨', '🦊', '🐼', '😎', '🤖', '👻', '🔥', '⚡', '🎭', '🍕', '🐙', '🪖'];
  const DEFAUT = '🙂';
  const SCREENS = ['home', 'lobby', 'play', 'lost'];
  const show = (id) => { SCREENS.forEach((s) => { $(s).hidden = s !== id; }); };
  const showError = (m) => { $('error').textContent = m ? '> ' + m : ''; };
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };

  // ------------------------------------------------------- l'atelier libre
  if (new URLSearchParams(location.search).has('atelier')) {
    show('play');
    CroquisAtelier.creer();
    bandeau('Atelier libre : dessine, rien n’est envoyé.');
    return;
  }

  // ------------------------------------------------------------ état reçu
  let myId = null, isHost = false;
  let roster = new Map();      // id → { name, avatar, left } (reçu au snapshot)
  let phase = 'home';          // lobby | choosing | drawing | pause | reveal | end
  let tour = null;             // { turnId, drawer, round, rounds }
  let monMot = null;           // le mot, au SEUL dessinateur (message `drawing`)
  const nomDe = (id) => (roster.get(id) || {}).name || 'quelqu’un';
  const jeDessine = () => !!tour && tour.drawer === myId && phase === 'drawing' && NET.connected();

  const envoi = CroquisSync.creerEnvoi({ envoyer: (m) => NET.send(m) });
  const atelier = CroquisAtelier.creer({
    peutDessiner: jeDessine,
    quand: {
      commence: (t) => envoi.commencer(tour.turnId, t),
      point: (t, x, y) => envoi.point(t, x, y),
      fini: (t) => envoi.finir(t),
      annule: () => envoi.annuler(tour.turnId),
      efface: () => envoi.effacer(tour.turnId),
    },
  });
  // L'état de la synchro : la feuille de l'atelier et le tour qu'elle montre.
  const synchro = { dessin: atelier.dessin, turnId: null };
  const recevoir = (m) => atelier.appliquer(CroquisSync.recevoir(synchro, m));

  // ------------------------------------------------------------- bandeau
  function bandeau(txt) { $('bandeau').textContent = txt; }
  function majPlay() {
    const moi = !!tour && tour.drawer === myId;
    document.body.classList.toggle('spectateur', !moi);
    $('outils').hidden = !moi && phase !== 'end';
    $('fin').hidden = phase !== 'end';
    $('retour-salon').hidden = !(phase === 'end' && isHost);
    if (phase === 'end') return bandeau('Partie terminée.');
    if (!tour) return bandeau('La partie commence…');
    const manche = `Manche ${tour.round}/${tour.rounds} · `;
    if (phase === 'choosing') return bandeau(manche + (moi ? 'Ton mot va être tiré au sort…' : `${nomDe(tour.drawer)} reçoit son mot…`));
    if (phase === 'drawing') return bandeau(manche + (moi ? `À toi de dessiner : « ${monMot} »` : `${nomDe(tour.drawer)} dessine`));
    return bandeau(manche + 'Tour terminé.');
  }

  // ---------------------------------------------------------------- accueil
  let myAvatar = GameProfile.startEmoji(AVATARS);
  for (const em of AVATARS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'avatar-pick' + (em === myAvatar ? ' picked' : '');
    b.textContent = em;
    b.setAttribute('aria-pressed', String(em === myAvatar));
    b.addEventListener('click', () => {
      myAvatar = em;
      document.querySelectorAll('.avatar-pick').forEach((x) => {
        x.classList.toggle('picked', x === b);
        x.setAttribute('aria-pressed', String(x === b));
      });
    });
    $('avatar-row').appendChild(b);
  }

  async function enter(code) {
    showError('');
    try {
      await NET.connect();
      NET.send({ action: 'join', name: $('name-input').value, avatar: GameProfile.joinAvatar(myAvatar), code: code || undefined });
    } catch (err) {
      showError(err.message);
      perte.refus(err.message);
    }
  }
  $('host').addEventListener('click', () => enter());
  $('join').addEventListener('click', () => enter($('code-input').value));
  $('code-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') enter($('code-input').value); });

  // --- connexion perdue (games/shared/game-net.js) -------------------------
  // Pas de reprise en pleine partie (V1) : au salon, on revient par le join
  // normal ; en pleine partie, elle continue sans nous.
  const perte = GameNet.surPerte(NET, {
    dansRoom: () => !!myId,
    enPartie: () => !$('play').hidden,
    code: () => $('room-code').textContent.trim(),
    quitter: () => { myId = null; tour = null; phase = 'home'; envoi.oublier(); atelier.arreter(); showError(''); },
    revenir: (code) => enter(code),
    show, hub: false,
  });

  $('room-code').addEventListener('click', async () => {
    const hint = $('code-hint');
    try { await navigator.clipboard.writeText($('room-code').textContent.trim()); hint.textContent = 'code copié ✔'; }
    catch (_) { hint.textContent = 'copie impossible — recopie le code à la main'; }
    setTimeout(() => { hint.textContent = 'clique sur le code pour le copier'; }, 2000);
  });

  // ------------------------------------------------------------------ salon
  $('start').addEventListener('click', () => NET.send({ action: 'start' }));
  $('retour-salon').addEventListener('click', () => NET.send({ action: 'lobby' }));

  function renderLobby(players) {
    const ul = $('players');
    ul.replaceChildren();
    for (const p of players) {
      const li = el('li', 'g-player');
      li.append(GameAvatar.node(p.avatar, DEFAUT, 'sm'), el('span', 'g-player-name', p.name + (p.id === myId ? ' (toi)' : '')));
      if (p.host) li.append(el('span', 'tag', 'hôte'));
      ul.append(li);
    }
    $('lobby-count').textContent = `${players.length} / 16`;
    $('host-config').hidden = !isHost;
    $('start').disabled = players.length < 2;
    $('need-players').textContent = isHost
      ? (players.length < 2 ? 'Il faut au moins 2 joueurs.' : '')
      : 'En attente de l’hôte…';
  }

  // ---------------------------------------------------------- les messages
  NET.on('you', (m) => {
    myId = m.id;
    isHost = m.host;
    perte.retour();
    $('room-code').textContent = m.code;
    show('lobby');
  });

  NET.on('lobby', (m) => {
    isHost = m.players.some((p) => p.id === myId && p.host);
    if (m.phase === 'end') { majPlay(); return; }   // écran de fin : seul l'hôte a pu changer
    phase = 'lobby';
    tour = null;
    envoi.oublier();
    atelier.arreter();
    renderLobby(m.players);
    show('lobby');
  });

  // L'état complet : au lancement, ou à la demande (resynchronisation). Il
  // REMPLACE tout ce que la page croyait savoir du dessin.
  NET.on('snapshot', (m) => {
    roster = new Map(m.players.map((p) => [p.id, { name: p.name, avatar: p.avatar, left: p.left }]));
    isHost = m.host === myId;
    phase = m.phase;
    tour = m.phase === 'end' ? null : { turnId: m.turnId, drawer: m.drawer, round: m.round, rounds: m.rounds };
    monMot = m.drawer === myId ? m.word : null;
    envoi.oublier();
    recevoir(m);
    show('play');
    majPlay();
    atelier.dimensionner();
  });

  NET.on('turn', (m) => {
    phase = 'choosing';
    tour = { turnId: m.turnId, drawer: m.drawer, round: m.round, rounds: m.rounds };
    monMot = null;
    envoi.oublier();
    atelier.arreter();
    recevoir(m);                     // un autre tour : la feuille repart de zéro
    show('play');
    majPlay();
  });

  // Les propositions arrivent au seul dessinateur. Ce lot ne les montre pas :
  // le serveur tire le mot au sort à l'échéance.
  NET.on('choices', () => {});

  NET.on('drawing', (m) => {
    if (!tour || m.turnId !== tour.turnId) tour = { turnId: m.turnId, drawer: m.drawer, round: tour ? tour.round : 1, rounds: tour ? tour.rounds : 1 };
    phase = 'drawing';
    monMot = m.drawer === myId ? m.word : null;
    recevoir(m);
    majPlay();
  });

  // Les traits des AUTRES. Le dessinateur ne reçoit jamais les siens (le
  // serveur ne les lui renvoie pas) ; s'il en arrivait, on les ignorerait :
  // son trait local est déjà la vérité de son écran.
  for (const type of ['stroke', 'undo', 'clear']) {
    NET.on(type, (m) => {
      if (tour && tour.drawer === myId) return;
      recevoir(m);
    });
  }

  // Le dessin s'arrête (tous trouvé, chrono, dessinateur parti).
  NET.on('stop', (m) => {
    if (!tour || m.turnId !== tour.turnId) return;
    phase = 'pause';
    envoi.oublier();
    atelier.arreter();
    majPlay();
  });
  NET.on('turn-end', (m) => {
    if (!tour || m.turnId !== tour.turnId) return;
    phase = 'reveal';
    majPlay();
  });

  NET.on('left', (m) => {
    const r = roster.get(m.id);
    if (r) r.left = true;
    isHost = m.host === myId;
    majPlay();
  });

  NET.on('results', (m) => {
    phase = 'end';
    isHost = m.host === myId;
    envoi.oublier();
    atelier.arreter();
    majPlay();
  });

  // Un trait refusé : la feuille du dessinateur ne correspond plus à celle du
  // serveur. Le serveur est l'autorité : on lui redemande l'état.
  const REFUS_SANS_SUITE = new Set(['NOT_DRAWING', 'STALE_TURN', 'NOT_PLAYING', 'NOT_DRAWER']);
  NET.on('refused', (m) => {
    if (['stroke', 'undo', 'clear'].includes(m.action) && !REFUS_SANS_SUITE.has(m.reason)) {
      atelier.annoncer(`Le serveur a refusé un trait (${m.message}) : dessin resynchronisé.`);
      NET.send({ action: 'snapshot' });
    }
  });

  NET.on('error', (m) => {
    showError(m.message);
    perte.refus(m.message);
  });

  // Le profil : préremplir le pseudo.
  if (!$('name-input').value.trim()) $('name-input').value = GameProfile.load().name || '';
})();
