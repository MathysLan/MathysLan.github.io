// Croquis — le salon et UN TOUR JOUABLE (lot gameplay 1).
//
// AUCUNE règle de jeu ici : croquis-server dit qui dessine, quels mots sont
// proposés (au seul dessinateur), quand le dessin commence et finit, qui a
// trouvé, quelles lettres sont révélées. Cette page transmet des intentions
// (« je prends le 2e mot », « voici un trait », « je propose chapeau ») et
// montre ce qui arrive. Le tour :
//   choix (3 mots au dessinateur, compte à rebours pour tous ; tirage auto à
//   l'échéance) → dessin (mot au dessinateur, gabarit aux autres) →
//   devinettes (fil : mauvaises réponses publiques, « a trouvé » sans le mot,
//   « presque » / refus à l'auteur seul) → indices → fin du tour (motif).
// Pas encore : score affiché, classement, écran de fin, Hub.
//
// Pipeline du dessin (lot réseau 1, inchangé) : Pointer Event → dessin local
// immédiat (app.js) → `stroke` (sync.js) → serveur → les autres.
//
// `?atelier` : l'atelier libre, sans réseau (le lot front 1).
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const AVATARS = ['🎨', '🦊', '🐼', '😎', '🤖', '👻', '🔥', '⚡', '🎭', '🍕', '🐙', '🪖'];
  const DEFAUT = '🙂';
  const SCREENS = ['home', 'lobby', 'play', 'end', 'lost'];
  const MEDAILLES = ['🥇', '🥈', '🥉'];
  const place = (rank) => (rank >= 1 && rank <= 3 ? MEDAILLES[rank - 1] : rank + 'e');
  const show = (id) => { SCREENS.forEach((s) => { $(s).hidden = s !== id; }); };
  const showError = (m) => { $('error').textContent = m ? '> ' + m : ''; };
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const pointeurFin = () => window.matchMedia('(pointer: fine)').matches;

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
  let monMot = null;           // le mot, au SEUL dessinateur (`drawing`, `snapshot`)
  let gabarit = '';            // le gabarit public (`_ _ _`, lettres révélées par `hint`)
  let lettres = 0;
  let trouve = false;          // J'AI trouvé ce tour-ci (le serveur l'a dit par `found`)
  let monEssai = '';           // ma dernière devinette (pour « presque » et « tu as trouvé »)
  let motif = null;            // raison de la fin du tour (`stop`)
  let motFinal = null;         // le mot, public à `turn-end`
  let finLocale = 0;           // échéance de la phase, en temps LOCAL (remainingMs + maintenant)
  let ordre = [];              // l'ordre de passage (snapshot) : l'ordre d'affichage à égalité
  // Les totaux de la partie, TELS QUE LE SERVEUR LES ENVOIE (turn, turn-end,
  // left) : aucun point n'est calculé ici. id → { score, left }
  let scores = new Map();
  let trouveurs = new Set();   // qui a trouvé CE tour (pour le tableau)
  let dernierFin = null;       // le dernier `turn-end` du tour en cours (la révélation)
  const nomDe = (id) => (roster.get(id) || {}).name || 'quelqu’un';
  const estDessinateur = () => !!tour && tour.drawer === myId;
  const jeDessine = () => estDessinateur() && phase === 'drawing' && NET.connected();
  const duTour = (m) => !!tour && m.turnId === tour.turnId;   // un message d'un autre tour ne touche à rien

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

  // ------------------------------------------------------------ affichage
  function bandeau(txt) { $('bandeau').textContent = txt; }

  const MOTIFS = {
    'all-found': () => 'Tout le monde a trouvé !',
    time: () => 'Temps écoulé !',
    'drawer-left': () => `${nomDe(tour && tour.drawer)} a quitté la partie : tour terminé.`,
    abandon: () => 'Partie interrompue.',
  };

  function majPlay() {
    const moi = estDessinateur();
    document.body.classList.toggle('spectateur', !moi);
    $('outils').hidden = !moi || phase === 'end' || phase === 'reveal';
    // Pendant son choix, le dessinateur n'a rien à lire ici (panneau vide) ;
    // pendant la révélation, le panneau des points prend la place.
    $('devinettes').hidden = phase === 'end' || !tour || (moi && phase === 'choosing') || phase === 'reveal';
    $('revele').hidden = phase !== 'reveal' || !dernierFin;
    $('tableau-panneau').hidden = !tour || phase === 'end';
    $('choix').hidden = !(moi && phase === 'choosing');
    majGabarit();
    majDevine();
    majTableau();
    if (phase === 'end') return bandeau('Partie terminée.');
    if (!tour) return bandeau('La partie commence…');
    const manche = `Manche ${tour.round}/${tour.rounds} · `;
    if (phase === 'choosing') return bandeau(manche + (moi ? 'Choisis ton mot' : `${nomDe(tour.drawer)} choisit un mot…`));
    if (phase === 'drawing') {
      if (moi) return bandeau(manche + `À toi de dessiner : « ${monMot} »`);
      return bandeau(manche + (trouve ? 'Tu as trouvé ! Les autres cherchent…' : `${nomDe(tour.drawer)} dessine`));
    }
    const pourquoi = motif && MOTIFS[motif] ? MOTIFS[motif]() : 'Tour terminé.';
    return bandeau(manche + pourquoi + (motFinal ? ` Le mot était « ${motFinal} ».` : ''));
  }

  // Le gabarit : une case par lettre, les lettres révélées en évidence ; les
  // espaces, tirets et apostrophes visibles d'emblée. Au dessinateur : son mot.
  function majGabarit() {
    const g = $('gabarit');
    g.replaceChildren();
    g.classList.remove('mot');
    let info = '';
    if (estDessinateur() && monMot && (phase === 'drawing' || phase === 'pause')) {
      g.classList.add('mot');
      g.textContent = monMot;
      info = 'ton mot — les autres voient des cases vides';
    } else if (motFinal && phase === 'reveal') {
      g.classList.add('mot');
      g.textContent = motFinal;
    } else if (gabarit && (phase === 'drawing' || phase === 'pause')) {
      for (const c of Array.from(gabarit)) {
        if (c === '_') g.append(el('span', 'l', ' '));
        else if (/\p{L}/u.test(c)) g.append(el('span', 'l revele', c));
        else g.append(el('span', 'sep', c === ' ' ? ' ' : c));
      }
      const vues = Array.from(gabarit).filter((c) => /\p{L}/u.test(c)).length;
      info = `${lettres} lettre${lettres > 1 ? 's' : ''}` + (vues ? ` · ${vues} révélée${vues > 1 ? 's' : ''}` : '');
    } else if (phase === 'choosing') {
      info = estDessinateur() ? '' : 'le mot arrive…';
    }
    $('gabarit-info').textContent = info;
    // Pour les lecteurs d'écran (le gabarit lui-même est aria-hidden), les
    // cases se lisent en clair — hors de l'écran.
    if (gabarit && !estDessinateur() && phase === 'drawing') {
      $('gabarit-info').append(el('span', 'sr-only', ` : ${Array.from(gabarit).map((c) => (c === '_' ? 'vide' : c === ' ' ? 'espace' : c)).join(' ')}`));
    }
  }

  // Le champ de réponse : aux devineurs, pendant le dessin. Après avoir
  // trouvé, il sert à écrire aux autres trouveurs (le serveur trie).
  function majDevine() {
    const peut = phase === 'drawing' && !estDessinateur() && NET.connected();
    $('devine-form').hidden = estDessinateur() || !tour || phase === 'end';
    $('devine').disabled = !peut;
    $('devine-envoyer').disabled = !peut;
    $('devine').placeholder = !peut ? (phase === 'choosing' ? 'attends le dessin…' : 'tour terminé')
      : trouve ? 'un mot aux autres trouveurs…' : 'ta réponse';
  }

  // Le fil du tour : il repart de zéro à chaque tour.
  function fil(li) {
    const ol = $('fil');
    ol.append(li);
    while (ol.children.length > 80) ol.firstElementChild.remove();
    ol.scrollTop = ol.scrollHeight;
  }
  const ligne = (cls, ...parts) => { const li = el('li', cls); li.append(...parts); return li; };

  // ---------------------------------------------------------------- scores
  // Une ligne de joueur : avatar, nom, puis ce qu'on veut à droite. La donnée
  // du réseau ne passe jamais par innerHTML (textContent, GameAvatar.node).
  function ligneJoueur(id, ...droite) {
    const r = roster.get(id) || {};
    const li = el('li', 'ligne-joueur');
    li.dataset.id = id;
    if (id === myId) li.classList.add('is-moi');
    if (r.left || (scores.get(id) || {}).left) li.classList.add('is-parti');
    li.append(GameAvatar.node(r.avatar, DEFAUT, 'sm'), el('span', 'nom', (r.name || '?') + (id === myId ? ' (toi)' : '')), ...droite);
    return li;
  }
  // Meilleurs d'abord ; à égalité, l'ordre de passage (aucun départage inventé).
  const parScore = (a, b) => (scores.get(b) || {}).score - (scores.get(a) || {}).score || ordre.indexOf(a) - ordre.indexOf(b);

  function majScores(liste) {
    for (const p of liste || []) {
      const s = scores.get(p.id) || { score: 0, left: false };
      if (Number.isFinite(p.score)) s.score = p.score;
      if (typeof p.left === 'boolean') s.left = p.left;
      scores.set(p.id, s);
    }
  }

  // Le tableau de la partie : totaux, qui dessine, qui a trouvé, qui est parti.
  function majTableau() {
    const ol = $('tableau');
    ol.replaceChildren();
    for (const id of [...scores.keys()].sort(parScore)) {
      const s = scores.get(id);
      const etat = s.left ? 'parti' : tour && id === tour.drawer && phase !== 'end' ? '✏️' : trouveurs.has(id) ? '✓' : '';
      ol.append(ligneJoueur(id, el('span', 'etat', etat), el('span', 'total', `${s.score} pts`)));
    }
  }

  // La révélation : le mot, le motif, les gains de CHAQUE joueur présent (0
  // pour qui n'a pas trouvé), le dessinateur repéré, et les nouveaux totaux.
  // Valeurs du serveur, telles quelles (`gains`, `scores` du turn-end).
  function afficherRevele(m) {
    $('revele-mot').textContent = `Le mot était « ${m.word} »`;
    $('revele-motif').textContent = MOTIFS[m.reason] ? MOTIFS[m.reason]() : 'Tour terminé.';
    const gains = new Map(m.gains.map((g) => [g.id, g]));
    const ol = $('revele-gains');
    ol.replaceChildren();
    const ids = [...new Set([...m.gains.map((g) => g.id), ...[...scores.keys()].filter((id) => !(scores.get(id) || {}).left)])];
    ids.sort((a, b) => ((gains.get(b) || {}).points || 0) - ((gains.get(a) || {}).points || 0) || ordre.indexOf(a) - ordre.indexOf(b));
    for (const id of ids) {
      const g = gains.get(id);
      const pts = g ? g.points : 0;
      const dessinateur = (g && g.drawer) || (tour && id === tour.drawer);
      const li = ligneJoueur(id,
        el('span', 'gain' + (pts ? '' : ' zero'), `+${pts}`),
        el('span', 'total', `${(scores.get(id) || {}).score || 0} pts`));
      if (dessinateur) {
        const role = el('span', 'role', ' ✏️');
        role.setAttribute('aria-hidden', 'true');
        li.querySelector('.nom').append(role, el('span', 'sr-only', ', dessinateur'));
      }
      ol.append(li);
    }
  }

  // La fin de partie : le classement du serveur (rang, score, mots trouvés),
  // tel quel. Revanche et retour au salon : à l'hôte.
  let classementFinal = null;
  function afficherFin(m) {
    classementFinal = m;
    const ol = $('classement');
    ol.replaceChildren();
    for (const r of m.ranking) {
      const li = el('li', 'ligne-joueur' + (r.rank <= 3 && r.score > 0 ? ' is-podium' : '') + (r.id === myId ? ' is-moi' : '') + (r.left ? ' is-parti' : ''));
      li.dataset.id = r.id;
      const nom = el('span', 'nom', r.name + (r.id === myId ? ' (toi)' : ''));
      nom.append(el('span', 'detail', `${r.found} mot${r.found > 1 ? 's' : ''} trouvé${r.found > 1 ? 's' : ''} · ${r.drawn} dessin${r.drawn > 1 ? 's' : ''}${r.left ? ' · parti' : ''}`));
      const rang = el('span', 'rang', place(r.rank));
      rang.setAttribute('aria-label', r.rank === 1 ? '1er' : `${r.rank}e`);
      li.append(rang, GameAvatar.node(r.avatar, DEFAUT, 'sm'), nom, el('span', 'score', `${r.score} pts`));
      li.setAttribute('aria-label', `${r.rank === 1 ? '1er' : r.rank + 'e'} : ${r.name}, ${r.score} points, ${r.found} mots trouvés`);
      ol.append(li);
    }
    const premiers = m.ranking.filter((r) => r.rank === 1);
    $('end-meta').textContent = m.complete ? 'Fin de partie' : 'Partie interrompue';
    $('end-title').textContent = !m.complete ? 'Pas assez de joueurs pour continuer.'
      : premiers.length > 1 ? `Égalité : ${premiers.map((r) => r.name).join(' et ')} !`
        : `${premiers[0].name} gagne !`;
    majFin();
    show('end');
    $('end-title').focus();
  }
  function majFin() {
    $('revanche').hidden = !isHost;
    $('vers-salon').hidden = !isHost;
    $('attente-hote').hidden = isHost;
  }

  // --------------------------------------------------------------- chrono
  // Le serveur donne un TEMPS RESTANT (jamais une heure) ; on le décompte ici.
  let horloge = 0;
  function armerChrono(remainingMs) {
    finLocale = Number.isFinite(remainingMs) ? performance.now() + remainingMs : 0;
    tic();
    if (!horloge) horloge = setInterval(tic, 250);
  }
  function tic() {
    const c = $('chrono');
    const s = finLocale ? Math.max(0, Math.ceil((finLocale - performance.now()) / 1000)) : null;
    const actif = s !== null && (phase === 'choosing' || phase === 'drawing' || phase === 'reveal');
    c.textContent = actif ? `${s} s` : '';
    c.classList.toggle('vite', actif && s <= 10);
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
  NET.on('lost', () => { majDevine(); });

  $('room-code').addEventListener('click', async () => {
    const hint = $('code-hint');
    try { await navigator.clipboard.writeText($('room-code').textContent.trim()); hint.textContent = 'code copié ✔'; }
    catch (_) { hint.textContent = 'copie impossible — recopie le code à la main'; }
    setTimeout(() => { hint.textContent = 'clique sur le code pour le copier'; }, 2000);
  });

  // ------------------------------------------------------------------ salon
  $('start').addEventListener('click', () => NET.send({ action: 'start' }));
  // Fin de partie (hôte) : la revanche relance une partie dans la même room ;
  // le retour au salon y ramène tout le monde.
  $('revanche').addEventListener('click', () => NET.send({ action: 'start' }));
  $('vers-salon').addEventListener('click', () => NET.send({ action: 'lobby' }));

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

  // ------------------------------------------------------- le choix du mot
  // Trois boutons, un seul choix : le premier clic part, les autres sont
  // éteints. Le serveur peut aussi tirer au sort (échéance) : `drawing` arrive
  // alors directement, et le panneau se range.
  function afficherChoix(turnId, words) {
    const box = $('choix-mots');
    box.replaceChildren();
    words.forEach((w, i) => {
      const b = el('button');
      b.type = 'button';
      b.dataset.index = String(i);
      b.append(el('span', 'mot', w.word), el('span', 'niveau', w.level || ''));
      b.setAttribute('aria-label', `${w.word}${w.level ? ' (' + w.level + ')' : ''}`);
      b.addEventListener('click', () => {
        if (!duTour({ turnId }) || phase !== 'choosing') return;
        box.querySelectorAll('button').forEach((x) => { x.disabled = true; });
        b.classList.add('is-choisi');
        NET.send({ action: 'choose', turnId, index: i });
      });
      box.append(b);
    });
    majPlay();
    const premier = box.querySelector('button');
    if (premier && pointeurFin()) premier.focus();
  }

  // ------------------------------------------------------------ devinettes
  // Le serveur accepte 3 devinettes par seconde : un envoi éteint le bouton
  // un court instant (le serveur reste l'arbitre : TOO_FAST est affiché).
  let pause = 0;
  $('devine-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const champ = $('devine');
    const texte = champ.value.trim();
    if (!texte || !tour || phase !== 'drawing' || estDessinateur() || pause) return;
    monEssai = texte.slice(0, 40);
    NET.send({ action: 'guess', turnId: tour.turnId, text: monEssai });
    champ.value = '';
    $('devine-retour').textContent = '';
    pause = setTimeout(() => { pause = 0; }, 350);
  });

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
    if (m.phase === 'end') { majFin(); return; }   // écran de fin : seul l'hôte a pu changer
    phase = 'lobby';
    tour = null;
    envoi.oublier();
    atelier.arreter();
    renderLobby(m.players);
    show('lobby');
  });

  // Le début d'un tour (ou un état reçu en entier) : tout ce qui concerne le
  // tour d'avant est oublié.
  function nouveauTour() {
    trouve = false;
    monEssai = '';
    motif = null;
    motFinal = null;
    gabarit = '';
    lettres = 0;
    $('fil').replaceChildren();
    $('devine-retour').textContent = '';
    $('devine').value = '';
    trouveurs = new Set();
    dernierFin = null;
  }

  // L'état complet : au lancement, ou à la demande (resynchronisation). Il
  // REMPLACE tout ce que la page croyait savoir.
  NET.on('snapshot', (m) => {
    roster = new Map(m.players.map((p) => [p.id, { name: p.name, avatar: p.avatar, left: p.left }]));
    isHost = m.host === myId;
    const autreTour = !tour || tour.turnId !== m.turnId;
    phase = m.phase;
    tour = m.phase === 'end' ? null : { turnId: m.turnId, drawer: m.drawer, round: m.round, rounds: m.rounds };
    if (autreTour) nouveauTour();
    monMot = m.drawer === myId ? m.word : null;
    gabarit = m.pattern || '';
    lettres = m.letters || 0;
    trouve = Array.isArray(m.found) && m.found.includes(myId);
    if (m.phase === 'reveal') { motif = m.reason; motFinal = m.word; }
    ordre = m.order || ordre;
    scores = new Map();
    majScores(m.players);
    trouveurs = new Set(m.found || []);
    if (m.phase === 'reveal' && m.gains) { dernierFin = { word: m.word, reason: m.reason, gains: m.gains }; afficherRevele(dernierFin); }
    envoi.oublier();
    recevoir(m);
    show('play');
    if (m.words && m.drawer === myId && m.phase === 'choosing') afficherChoix(m.turnId, m.words);
    armerChrono(m.remainingMs);
    majPlay();
    atelier.dimensionner();
    if (m.phase === 'end' && m.ranking) afficherFin({ complete: m.complete, host: m.host, ranking: m.ranking });
  });

  NET.on('turn', (m) => {
    phase = 'choosing';
    tour = { turnId: m.turnId, drawer: m.drawer, round: m.round, rounds: m.rounds };
    monMot = null;
    nouveauTour();
    $('choix-mots').replaceChildren();
    envoi.oublier();
    atelier.arreter();
    majScores(m.players);            // les totaux du serveur, gardés d'un tour à l'autre
    recevoir(m);                     // un autre tour : la feuille repart de zéro
    show('play');
    armerChrono(m.remainingMs);
    majPlay();
  });

  // Les trois propositions : au SEUL dessinateur (le serveur ne les envoie à
  // personne d'autre).
  NET.on('choices', (m) => {
    if (!duTour(m) || !estDessinateur()) return;
    afficherChoix(m.turnId, m.words);
    armerChrono(m.remainingMs);
  });

  NET.on('drawing', (m) => {
    if (!tour || m.turnId !== tour.turnId) {
      tour = { turnId: m.turnId, drawer: m.drawer, round: tour ? tour.round : 1, rounds: tour ? tour.rounds : 1 };
      nouveauTour();
    }
    phase = 'drawing';
    monMot = m.drawer === myId ? m.word : null;
    gabarit = m.pattern || '';
    lettres = m.letters || 0;
    recevoir(m);
    armerChrono(m.remainingMs);
    if (m.auto) fil(ligne('sys', 'Mot tiré au sort.'));
    majPlay();
    if (!estDessinateur() && pointeurFin()) $('devine').focus();
  });

  // Les traits des AUTRES. Le dessinateur ne reçoit jamais les siens (le
  // serveur ne les lui renvoie pas) ; s'il en arrivait, on les ignorerait :
  // son trait local est déjà la vérité de son écran. Un ancien turnId est
  // écarté par sync.js.
  for (const type of ['stroke', 'undo', 'clear']) {
    NET.on(type, (m) => {
      if (estDessinateur()) return;
      recevoir(m);
    });
  }

  NET.on('hint', (m) => {
    if (!duTour(m) || phase !== 'drawing') return;
    gabarit = m.pattern;
    fil(ligne('sys', 'Indice : une lettre de plus.'));
    majGabarit();
  });

  // Une mauvaise réponse (à tous), ou un mot entre trouveurs (aux trouveurs et
  // au dessinateur). Jamais une bonne réponse : le serveur ne la relaie pas.
  NET.on('chat', (m) => {
    if (!duTour(m)) return;
    const qui = el('span', 'qui', nomDe(m.id) + (m.id === myId ? ' (toi)' : '') + ' : ');
    const li = ligne(m.scope === 'found' ? 'entre' : '', qui, el('span', 'txt', m.text));
    if (m.scope === 'found') li.prepend(el('span', 'sys', '[trouveurs] '));
    fil(li);
  });

  NET.on('found', (m) => {
    if (!duTour(m)) return;
    trouveurs.add(m.id);
    if (m.id === myId) {
      trouve = true;
      fil(ligne('ok', `✓ Tu as trouvé : « ${monEssai} »`));
      $('devine-retour').textContent = '';
    } else {
      fil(ligne('ok', `✓ ${nomDe(m.id)} a trouvé !`));
    }
    majPlay();
  });

  // À l'auteur seul : « presque » et les refus.
  NET.on('close', (m) => {
    if (!duTour(m)) return;
    $('devine-retour').textContent = `« ${monEssai} » : presque !`;
  });

  // Le dessin s'arrête (tous trouvé, chrono, dessinateur parti).
  NET.on('stop', (m) => {
    if (!duTour(m)) return;
    phase = 'pause';
    motif = m.reason;
    envoi.oublier();
    atelier.arreter();
    $('choix').hidden = true;
    majPlay();
  });

  NET.on('turn-end', (m) => {
    if (!duTour(m)) return;
    phase = 'reveal';
    motif = m.reason;
    motFinal = m.word;
    majScores(m.scores);             // les nouveaux totaux, ceux du serveur
    dernierFin = m;
    afficherRevele(m);
    armerChrono(m.remainingMs);
    majPlay();
  });

  NET.on('skipped', (m) => {
    fil(ligne('sys', `${nomDe(m.drawer)} est parti pendant son choix : tour sauté.`));
  });

  NET.on('left', (m) => {
    const r = roster.get(m.id);
    if (r) r.left = true;
    isHost = m.host === myId;
    majScores(m.players);
    if (tour) fil(ligne('sys', `${nomDe(m.id)} a quitté la partie.`));
    majPlay();
  });

  NET.on('results', (m) => {
    phase = 'end';
    isHost = m.host === myId;
    envoi.oublier();
    atelier.arreter();
    majPlay();
    afficherFin(m);
  });

  // Un refus, à moi seul. Un trait refusé : la feuille du dessinateur ne
  // correspond plus à celle du serveur, qui est l'autorité : on lui redemande
  // l'état. Une devinette refusée : on dit pourquoi, sous le champ.
  const REFUS_SANS_SUITE = new Set(['NOT_DRAWING', 'STALE_TURN', 'NOT_PLAYING', 'NOT_DRAWER']);
  NET.on('refused', (m) => {
    if (['stroke', 'undo', 'clear'].includes(m.action) && !REFUS_SANS_SUITE.has(m.reason)) {
      atelier.annoncer(`Le serveur a refusé un trait (${m.message}) : dessin resynchronisé.`);
      NET.send({ action: 'snapshot' });
    } else if (m.action === 'guess' && (m.turnId == null || duTour(m))) {
      $('devine-retour').textContent = m.reason === 'WITHHELD' ? `« ${monEssai} » : écris juste le mot.` : `Refusé : ${m.message}.`;
    } else if (m.action === 'choose' && duTour(m)) {
      $('choix-mots').querySelectorAll('button').forEach((x) => { x.disabled = false; });
      atelier.annoncer(`Choix refusé : ${m.message}.`);
    }
  });

  NET.on('error', (m) => {
    showError(m.message);
    perte.refus(m.message);
  });

  // Le profil : préremplir le pseudo.
  if (!$('name-input').value.trim()) $('name-input').value = GameProfile.load().name || '';
})();
