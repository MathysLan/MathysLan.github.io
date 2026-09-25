// Qui Ment ? — l'affichage. AUCUNE règle ici : le serveur donne un rôle, on
// l'affiche ; le joueur écrit un indice ou désigne quelqu'un, on transmet
// l'intention ; le serveur renvoie les résultats, on les affiche.
//
// Ce dépôt ne contient à AUCUN moment le catalogue de mots, ni le barème, ni
// la règle qui décide si l'intrus est démasqué — tout cela vit dans
// qui-ment-server. Ici, `word` vaut simplement `null` quand on est l'intrus,
// et il n'y a rien d'autre à en savoir.
//
// Conséquence utile : ouvrir la console ou lire le trafic ne sert à rien. Ce
// n'est pas de l'obfuscation, c'est juste que l'information n'est pas là.
(function () {
  const $ = (id) => document.getElementById(id);
  const AVATARS = ['🕵️', '🦊', '🐼', '😎', '🤖', '👻', '🔥', '⚡', '🎭', '🎧', '🍕', '🚀'];

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let myId = null, isHost = false, players = [], amImpostor = false;

  const SCREENS = ['home', 'lobby', 'play', 'vote', 'guess', 'results', 'end', 'lost'];
  const show = (id) => SCREENS.forEach((s) => { $(s).hidden = s !== id; });
  const showError = (m) => { $('error').textContent = m ? '> ' + m : ''; };
  const nameOf = (id) => (players.find((p) => p.id === id) || {}).name || 'quelqu un';
  // Avatar (emoji ou photo) + pseudo d'un joueur, en nœuds DOM : la photo
  // n'est jamais une chaîne HTML. `who()` sert aux phrases et aux gabarits.
  const DEFAUT = '🕵️';
  const who = (id, size) => {
    const p = players.find((x) => x.id === id);
    const frag = document.createDocumentFragment();
    if (!p) { frag.append('—'); return frag; }
    frag.append(GameAvatar.node(p.avatar, DEFAUT, size), ' ' + p.name);
    return frag;
  };
  // Taille par défaut : « md » (48 px), celle des listes de joueurs.
  const av = (a, size = 'md') => GameAvatar.slot(a, DEFAUT, size);

  // ------------------------------------------------------------- accueil
  let myAvatar = GameProfile.startEmoji(AVATARS); // profil local, sinon un repli stable
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
      // L'avatar complet : la photo du profil s'il y en a une, l'emoji toujours.
      NET.send({ action: 'join', name: $('name-input').value, avatar: GameProfile.joinAvatar(myAvatar), code: code || undefined });
    } catch (err) { showError(err.message); perte.refus(err.message); }
  }
  $('host').addEventListener('click', () => enter());
  $('join').addEventListener('click', () => enter($('code-input').value));
  $('code-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') enter($('code-input').value); });

  // --- connexion perdue (games/shared/game-net.js) --------------------------
  // Au salon, UN retour automatique par le join NORMAL, avec le même code ; en
  // pleine partie, aucune reprise : on dit qu'elle a continué sans nous.
  const perte = GameNet.surPerte(NET, {
    dansRoom: () => !!myId,
    enPartie: () => ['play', 'vote', 'guess', 'results'].some((s) => !$(s).hidden),
    code: () => $('room-code').textContent.trim(),
    quitter: () => {
      myId = null;
      showError('');
    },
    revenir: (code) => enter(code),
    show, hub: false,
  });

  $('room-code').addEventListener('click', async () => {
    const hint = $('code-hint');
    const back = () => setTimeout(() => { hint.textContent = 'clique sur le code pour le copier'; }, 2000);
    try {
      await navigator.clipboard.writeText($('room-code').textContent.trim());
      hint.textContent = 'code copié ✔';
    } catch (_) {
      hint.textContent = 'copie impossible — recopie le code à la main';
    }
    back();
  });

  $('start').addEventListener('click', () => NET.send({ action: 'start', rounds: +$('rounds-select').value }));
  $('again').addEventListener('click', () => NET.send({ action: 'start', rounds: +$('rounds-select').value }));
  $('next').addEventListener('click', () => NET.send({ action: 'next' }));
  ['skip-clue', 'skip-vote', 'skip-guess'].forEach((id) =>
    $(id).addEventListener('click', () => NET.send({ action: 'skip' })));

  // -------------------------------------------------------------- indices
  function sendClue() {
    const text = $('clue-input').value.trim();
    if (!text) return;
    showError('');
    NET.send({ action: 'clue', text });         // une intention, rien de plus
    lockClue(true);
  }
  $('clue-send').addEventListener('click', sendClue);
  $('clue-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendClue(); });

  // On verrouille la saisie en OPTIMISTE, mais le serveur peut refuser l'indice
  // (trop long, ou il contient le mot). Dans ce cas il renvoie une erreur et on
  // rouvre la saisie — sinon le joueur resterait bloqué sur un indice refusé.
  function lockClue(locked) {
    $('clue-input').disabled = locked;
    $('clue-send').disabled = locked;
    $('clue-wait').hidden = !locked;
  }

  // Les tours d'indices déjà révélés, cumulés.
  function renderClues(target, rounds) {
    target.innerHTML = (rounds || []).map((r) => `
      <p class="turn-head">Tour ${r.turn} — les indices</p>
      ${r.clues.map((c) => `<div class="clue-row">
        <span class="who" data-who="${esc(c.id)}"></span>
        <span class="what">${esc(c.clue)}</span>
      </div>`).join('')}`).join('');
    target.querySelectorAll('[data-who]').forEach((el) => el.appendChild(who(el.dataset.who, 'sm')));
  }

  // Qui a déjà fait sa part. On n'affiche JAMAIS quoi — le serveur ne l'envoie
  // pas non plus, c'est toute la différence.
  function renderProgress(list) {
    $('play-players').innerHTML = players.map((p) => `
      <li class="g-player">${av(p.avatar)}<span class="g-player-name">${esc(p.name)}</span>
        ${p.host ? '<span class="tag">MJ</span>' : ''}
        <span class="done">${p.ready ? '✔ prêt' : '…'}</span></li>`).join('');
    GameAvatar.fill($('play-players'));
  }

  // ----------------------------------------------------------------- vote
  function renderVote() {
    const grid = $('vote-grid');
    grid.innerHTML = '';
    players.filter((p) => p.id !== myId).forEach((p) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tf-btn tf-btn-sm';
      // Voter contre quelqu'un, c'est le désigner : son visage sur le bouton.
      b.classList.add('g-player', 'vote-who');
      b.append(GameAvatar.node(p.avatar, DEFAUT, 'md'), ' ' + p.name);
      b.setAttribute('aria-label', `Voter contre ${p.name}`);
      b.addEventListener('click', () => {
        NET.send({ action: 'vote', target: p.id });
        grid.querySelectorAll('button').forEach((x) => { x.disabled = true; });
        $('vote-wait').hidden = false;
      });
      grid.appendChild(b);
    });
    $('vote-wait').hidden = true;
  }

  // ------------------------------------------------------ messages serveur
  NET.on('you', (msg) => {
    myId = msg.id;
    perte.retour();                           // de retour dans une room
    isHost = msg.host;
    $('room-code').textContent = msg.code;
    show('lobby');
  });

  NET.on('lobby', (msg) => {
    players = msg.players;
    isHost = (players.find((p) => p.id === myId) || {}).host === true;
    $('players').innerHTML = players.map((p) =>
      `<li class="g-player">${av(p.avatar)}<span class="g-player-name">${esc(p.name)}</span>${p.host ? '<span class="tag">MJ</span>' : ''}</li>`).join('');
    GameAvatar.fill($('players'));
    $('host-config').hidden = !isHost;
    $('need-players').hidden = isHost;
    if (isHost) {
      const few = players.length < 3;
      $('start').disabled = few;
      $('need-players').hidden = !few;
      $('need-players').textContent = few ? 'il faut au moins 3 joueurs' : '';
    }
    show('lobby');
  });

  // Le rôle : le seul message qui arrive joueur par joueur. `word` est null
  // quand on est l'intrus — ce n'est pas une omission d'affichage, le mot n'est
  // jamais arrivé jusqu'ici.
  NET.on('role', (msg) => {
    players = msg.players;
    amImpostor = msg.impostor;
    $('round-num').textContent = msg.round;
    $('round-of').textContent = msg.of;
    $('score').textContent = (players.find((p) => p.id === myId) || {}).score || 0;
    $('role-cat').textContent = msg.cat;
    $('role-word').textContent = msg.impostor ? 'TU ES L\'INTRUS' : msg.word;
    $('role-word').className = 'role-word' + (msg.impostor ? ' imp' : '');
    $('role-note').textContent = msg.impostor
      ? 'Tu ne connais pas le mot. Fais comme si — et écoute bien les autres.'
      : 'Donne un indice : assez clair pour les tiens, assez vague pour l\'intrus.';
    $('clue-history').innerHTML = '';
    $('turn-head').textContent = `Tour ${msg.turn} sur ${msg.turns} — ton indice`;
    $('clue-input').value = '';
    lockClue(false);
    $('skip-clue').hidden = !isHost;
    renderProgress();
    show('play');
  });

  NET.on('clues', (msg) => {
    players = msg.players;
    renderClues($('clue-history'), msg.rounds);
    $('turn-head').textContent = `Tour ${msg.turn} sur ${msg.turns} — ton indice`;
    $('clue-input').value = '';
    lockClue(false);
    renderProgress();
    show('play');
  });

  NET.on('progress', (msg) => {
    players = msg.players;
    renderProgress();
  });

  NET.on('vote', (msg) => {
    players = msg.players;
    renderClues($('vote-history'), msg.rounds);
    renderVote();
    $('skip-vote').hidden = !isHost;
    show('vote');
  });

  // Démasqué. Ce message-ci n'arrive qu'à l'intrus, avec la liste des mots.
  NET.on('guess', (msg) => {
    $('guess-intro').textContent = `Ils t'ont trouvé. Dernière chance : c'était quel mot, dans « ${msg.cat} » ?`;
    const grid = $('word-grid');
    grid.innerHTML = '';
    msg.words.forEach((w) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tf-btn tf-btn-sm';
      b.textContent = w;
      b.addEventListener('click', () => {
        NET.send({ action: 'guess', word: w });
        grid.querySelectorAll('button').forEach((x) => { x.disabled = true; });
      });
      grid.appendChild(b);
    });
    $('skip-guess').hidden = true;
    show('guess');
  });

  // …et celui-ci à tous les autres. Il ne dit pas encore QUI : le nom tombe
  // avec le mot, d'un seul bloc, dans les résultats.
  NET.on('guessing', (msg) => {
    players = msg.players;
    if (amImpostor) return;                      // lui a reçu `guess`
    $('guess-intro').textContent = "L'intrus a été démasqué. Il tente de retrouver le mot…";
    $('word-grid').innerHTML = '';
    $('skip-guess').hidden = !isHost;
    show('guess');
  });

  NET.on('results', (msg) => {
    players = msg.players;
    $('res-round').textContent = `Manche ${msg.round}/${msg.of}`;
    $('res-cat').textContent = msg.cat;
    $('res-word').textContent = msg.word;
    $('res-verdict').replaceChildren(who(msg.impostorId, 'lg'), msg.caught
      ? " était l'intrus — et vous l'avez eu."
      : " était l'intrus — et il est passé au travers.");
    $('res-guess').textContent = !msg.caught ? ''
      : msg.guess == null ? "Il n'a pas tenté de retrouver le mot."
        : msg.guessed ? `Mais il a retrouvé le mot : « ${msg.guess} ». Bien joué.`
          : `Il a proposé « ${msg.guess} ». Raté.`;

    $('res-rows').innerHTML = players.map((p) => {
      const pts = msg.points[p.id] || 0;
      const v = msg.counts[p.id] || 0;
      return `<div class="res-row">
        <span class="g-player">${av(p.avatar)}<span class="g-player-name">${esc(p.name)}${p.id === msg.impostorId ? ' — l\'intrus' : ''}</span></span>
        <span><span class="votes">${v} voix</span> &nbsp; <span class="pts">+${pts}</span></span>
      </div>`;
    }).join('');
    GameAvatar.fill($('res-rows'));

    $('next').hidden = !isHost;
    $('next').textContent = msg.last ? 'Voir le classement' : 'Manche suivante';
    $('wait-host').hidden = isHost;
    show('results');
  });

  NET.on('end', (msg) => {
    const me = msg.ranking.find((r) => r.id === myId);
    $('final-title').textContent = me ? me.title : '';
    $('ranking').innerHTML = msg.ranking.map((r, i) =>
      `<div class="rank-row"><span class="g-player"><span class="medal">${i + 1}.</span>${av(r.avatar, i < 3 ? 'lg' : 'md')}<span class="g-player-name">${esc(r.name)}</span></span><span class="avg">${r.score} pts</span></div>`).join('');
    GameAvatar.fill($('ranking'));
    $('again').hidden = !isHost;
    show('end');
  });

  NET.on('error', (msg) => {
    showError(msg.message);
    perte.refus(msg.message);                // un retour dans le salon refusé : on le dit
    // Un indice refusé doit rendre la main, sinon le joueur reste bloqué sur
    // une saisie verrouillée pour un indice que le serveur n'a pas gardé.
    if (!$('play').hidden) lockClue(false);
  });
  // (La perte de connexion : voir surPerte plus haut.)
})();
