// Faux Témoin — la page du jeu (« l'Interrogatoire ») : salon, rôle, scène,
// interrogatoire, débat, vote, verdict, dernière chance, révélation,
// classement.
//
// AUCUNE règle de jeu ici : temoin-server tire la scène, les questions,
// l'ordre de parole et le Faux Témoin, tient les phases et leurs minuteries,
// compte les votes et TOUS les points (README du serveur). Cette page envoie
// des intentions (« j'ai répondu », « prêt à voter », « je vote pour Bob »,
// « c'est la version 2 ») et montre ce qui arrive. Les réponses, elles, se
// disent à voix haute (Discord) : le serveur n'en voit aucune.
//
// LA SCÈNE NE RESTE PAS : elle n'est montrée que pendant le flash (message
// `scene`), puis oubliée — comme un vrai témoin, on s'en souvient ou pas.
// Elle revient pour tous à la révélation (`reveal.scene`).
//
// Game Hub : le handoff de Croq.ios (games/shared/hub-handoff.js), « lancé
// par le Hub » plus bas ; sans billet, rien ne change. Le jeu est hors du Hub
// (data/games.js) tant que Mathys ne l'y remet pas.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const SC = window.TemoinScene;
  const AVATARS = ['🕵️', '🦊', '🐼', '😎', '🤖', '👻', '🔥', '⚡', '🎭', '🍕', '🐙', '🪖'];
  const DEFAUT = '🕵️';
  const SCREENS = ['home', 'lobby', 'play', 'end', 'lost'];
  const PHASES = ['role', 'flash', 'question', 'debate', 'vote', 'verdict', 'guess', 'reveal'];
  const PANNEAUX = { role: 'p-role', flash: 'p-flash', question: 'p-question', debate: 'p-debat', vote: 'p-vote', verdict: 'p-verdict', guess: 'p-guess', reveal: 'p-reveal' };
  const NOMS_PHASE = {
    role: 'Ton rôle', flash: 'La scène', question: 'L’interrogatoire', debate: 'Le débat',
    vote: 'Le vote', verdict: 'Le verdict', guess: 'Dernière chance', reveal: 'La révélation',
  };
  const MEDAILLES = ['🥇', '🥈', '🥉'];
  const place = (rank) => (rank >= 1 && rank <= 3 ? MEDAILLES[rank - 1] : rank + 'e');
  const show = (id) => {
    SCREENS.forEach((s) => { $(s).hidden = s !== id; });
    document.body.classList.toggle('en-partie', id === 'play');
  };
  const showError = (m) => { $('error').textContent = m ? '> ' + m : ''; };
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };

  // ------------------------------------------------------------ état reçu
  let myId = null, isHost = false;
  let roster = new Map();      // id → { name, avatar, left }
  let scores = new Map();      // id → { score, left } — TELS QUE LE SERVEUR LES ENVOIE
  let manche = null;           // { roundId, rounds, title }
  let role = null;             // 'witness' | 'liar' — le mien, à moi seul
  let etat = null;             // le dernier état public de la phase (message `phase`)
  let scene = null;            // la scène du flash (témoin seulement), oubliée après
  let options = null;          // les 4 versions (Faux Témoin démasqué seulement)
  let monPret = false, monVote = null, monChoix = null;
  let derniere = null;         // la phase déjà dessinée (pour le focus, une fois)
  let nbJoueurs = 0, minJoueurs = 3;
  let reglages = { rounds: 3, flashMs: 8000 };

  const nomDe = (id) => (roster.get(id) || {}).name || 'quelqu’un';
  const avatarDe = (id) => (roster.get(id) || {}).avatar;
  const presents = () => [...scores.keys()].filter((id) => !(scores.get(id) || {}).left);
  const phase = () => (etat ? etat.phase : null);

  // ------------------------------------------------------------ affichage
  function bandeau() {
    const b = $('bandeau');
    if (!manche) { b.textContent = 'La partie commence…'; $('moi').textContent = ''; return; }
    b.textContent = `Manche ${manche.roundId}/${manche.rounds} · ${NOMS_PHASE[phase()] || ''}`;
    // Mon rôle, rappelé toute la manche (pas à la révélation : tout est dit).
    const moi = $('moi');
    moi.classList.toggle('is-menteur', role === 'liar');
    moi.textContent = !role || phase() === 'reveal' ? ''
      : role === 'liar' ? `🎭 Tu es le Faux Témoin · le lieu : ${manche.title}` : '👁️ Tu es témoin';
  }

  function panneaux() {
    const ph = phase();
    for (const p of PHASES) $(PANNEAUX[p]).hidden = p !== ph;
  }

  function majRole() {
    const menteur = role === 'liar';
    $('carte-role').classList.toggle('is-menteur', menteur);
    $('role-emoji').textContent = !role ? '' : menteur ? '🎭' : '👁️';
    $('role-titre').textContent = !role ? '…' : menteur ? 'Tu es le FAUX TÉMOIN' : 'Tu es témoin';
    $('role-texte').textContent = !role ? ''
      : menteur ? 'Tu ne verras pas la scène, seulement le nom du lieu. Réponds comme si tu y étais, et ne te fais pas démasquer.'
        : 'Une scène va s’afficher quelques secondes. Regarde bien : ensuite, il faudra en parler.';
  }

  function majFlash() {
    const menteur = role === 'liar';
    const box = $('flash-scene');
    // Témoin : la scène reçue (rien d'autre). Faux Témoin : le lieu (public).
    box.hidden = menteur || !scene;
    $('flash-menteur').hidden = !menteur;
    $('flash-lieu').textContent = manche ? manche.title : '';
    if (!menteur && scene && !box.firstChild) {
      box.append(SC.dessiner(scene, { id: 'flash' }));
      box.classList.add('flash-anim');
    }
    if (!scene || phase() !== 'flash') { box.replaceChildren(); box.classList.remove('flash-anim'); }
  }

  function majQuestion() {
    const q = etat && etat.question;
    if (!q) return;
    $('q-num').textContent = `Question ${q.index + 1}/${q.count}`;
    $('q-texte').textContent = q.text;
    const moi = q.speaker === myId;
    const parole = $('q-parole');
    parole.replaceChildren();
    parole.classList.toggle('is-moi', moi);
    if (q.speaker) {
      parole.append(GameAvatar.node(avatarDe(q.speaker), DEFAUT, 'sm'), document.createTextNode(moi ? 'À toi ! Réponds à voix haute.' : `${nomDe(q.speaker)} répond…`));
    }
    $('repondu').hidden = !moi;
    $('repondu').disabled = !NET.connected();
    $('q-conseil').textContent = moi
      ? (role === 'liar' ? 'Reste crédible : ni trop précis, ni trop vague.' : 'Dis ce que TU as vu. Pas besoin d’être précis… et attention à ne pas trop en souffler.')
      : 'Écoute bien : qui hésite, qui en dit trop peu ?';
    const ol = $('q-ordre');
    ol.replaceChildren();
    q.order.forEach((id, i) => {
      const fait = q.answered.includes(id) || (q.order.indexOf(q.speaker) > i);
      const li = el('li', (id === q.speaker ? 'is-actuel' : fait ? 'is-fait' : '') + ((roster.get(id) || {}).left ? ' is-parti' : ''));
      li.dataset.id = id;
      li.append(GameAvatar.node(avatarDe(id), DEFAUT), document.createTextNode(nomDe(id) + (id === myId ? ' (toi)' : '')));
      ol.append(li);
    });
  }

  function majDebat() {
    const ul = $('posees');
    ul.replaceChildren();
    for (const t of (etat && etat.asked) || []) ul.append(el('li', null, t));
    const pret = $('pret');
    pret.setAttribute('aria-pressed', String(monPret));
    pret.textContent = monPret ? '✓ Prêt à voter (annuler)' : 'Prêt à voter';
    pret.disabled = !NET.connected();
    const n = (etat && etat.ready || []).length;
    $('debat-etat').textContent = `${n}/${presents().length} prêts à voter. Le vote commence quand tout le monde l’est.`;
  }

  function majVote() {
    const box = $('vote-cartes');
    box.replaceChildren();
    for (const id of presents()) {
      if (id === myId) continue;
      const b = el('button');
      b.type = 'button';
      b.dataset.id = id;
      b.setAttribute('aria-pressed', String(monVote === id));
      b.setAttribute('aria-label', `Accuser ${nomDe(id)}`);
      b.disabled = !NET.connected();
      b.append(GameAvatar.node(avatarDe(id), DEFAUT, 'md'), el('span', 'nom', nomDe(id)));
      b.addEventListener('click', () => voter(id));
      box.append(b);
    }
    const n = (etat && etat.voted || []).length;
    $('vote-etat').textContent = `${monVote ? `Tu accuses ${nomDe(monVote)}. ` : ''}${n}/${presents().length} ont voté.`;
  }

  function majVerdict() {
    const v = etat && etat.verdict;
    if (!v) return;
    let titre, texte;
    if (!v.accused) {
      titre = v.tie ? 'Égalité : personne n’est accusé.' : 'Personne n’a voté.';
      texte = 'Le Faux Témoin passe entre les gouttes…';
    } else if (v.caught) {
      titre = `${nomDe(v.accused)} est accusé… et c’était le Faux Témoin !`;
      texte = 'Il lui reste une dernière chance.';
    } else {
      titre = `${nomDe(v.accused)} est accusé… mais c’était un vrai témoin.`;
      texte = 'Le vrai Faux Témoin s’en tire.';
    }
    $('verdict-titre').textContent = titre;
    $('verdict-texte').textContent = texte;
  }

  function majGuess() {
    const liar = etat && etat.liar;
    const moi = liar === myId;
    $('guess-titre').textContent = moi ? 'Démasqué ! Dernière chance.' : `${nomDe(liar)} est démasqué.`;
    $('guess-texte').textContent = moi
      ? 'Laquelle est la vraie scène ? D’après ce que les autres ont dit… Trouve-la : +2.'
      : 'Il cherche la vraie scène parmi 4 versions, grâce à ce que vous avez dit.';
    const box = $('guess-versions');
    box.hidden = !moi || !options;
    if (moi && options && box.childElementCount !== options.length) {
      box.replaceChildren();
      options.forEach((o, i) => {
        const b = el('button');
        b.type = 'button';
        b.dataset.i = String(i);
        b.append(SC.dessiner(o, { id: `opt${i}`, label: `Version ${i + 1} : ${SC.decrire(o)}` }), el('span', null, `Version ${i + 1}`));
        b.addEventListener('click', () => choisir(i));
        box.append(b);
      });
    }
    for (const b of box.children) {
      b.setAttribute('aria-pressed', String(monChoix === Number(b.dataset.i)));
      b.disabled = monChoix != null || !NET.connected();
    }
    $('guess-etat').textContent = moi && monChoix != null ? `Tu as choisi la version ${monChoix + 1}.` : '';
  }

  function majReveal() {
    const r = etat && etat.reveal;
    if (!r) return;
    const liar = nomDe(r.liar);
    const caught = !!(r.verdict && r.verdict.caught);
    let titre, texte = '';
    if (r.aborted) {
      titre = `${liar} était le Faux Témoin… et il est parti.`;
      texte = 'Manche annulée : personne ne marque.';
    } else if (!caught) {
      titre = `${liar} était le Faux Témoin, et il s’en tire !`;
    } else if (r.guess != null && r.guess === r.answer) {
      titre = `${liar} était le Faux Témoin : démasqué… mais il a retrouvé la scène !`;
    } else {
      titre = `${liar} était le Faux Témoin : démasqué !`;
      texte = r.guess == null ? 'Il n’a pas choisi de scène à temps.' : `Il a choisi la version ${r.guess + 1}, la bonne était la ${r.answer + 1}.`;
    }
    $('rev-titre').textContent = titre;
    $('rev-texte').textContent = texte;
    const box = $('rev-scene');
    box.replaceChildren(SC.dessiner(r.scene, { id: 'rev', label: `La vraie scène : ${SC.decrire(r.scene)}` }));

    const votes = $('rev-votes');
    votes.replaceChildren();
    for (const v of r.votes) {
      const li = el('li');
      li.dataset.id = v.id;
      const cible = el('span', v.target === r.liar ? 'is-menteur' : null, nomDe(v.target));
      li.append(GameAvatar.node(avatarDe(v.id), DEFAUT), document.createTextNode(`${nomDe(v.id)} → `), cible);
      votes.append(li);
    }
    if (!r.votes.length) votes.append(el('li', null, 'Aucun vote.'));

    const pts = $('rev-points');
    pts.replaceChildren();
    for (const p of r.points.filter((x) => x.points > 0)) {
      const li = el('li', p.id === r.liar ? 'is-menteur' : null);
      li.dataset.id = p.id;
      li.append(GameAvatar.node(avatarDe(p.id), DEFAUT), el('span', null, nomDe(p.id) + (p.id === r.liar ? ' (Faux Témoin)' : '')), el('span', 'pts', `+${p.points}`));
      pts.append(li);
    }
    if (!pts.childElementCount) pts.append(el('li', null, 'Personne ne marque.'));

    const derniereManche = manche && manche.roundId >= manche.rounds;
    $('suivante').hidden = !isHost;
    $('suivante').textContent = derniereManche ? 'Voir le classement ▶' : 'Manche suivante ▶';
    $('suivante').disabled = !NET.connected();
    $('rev-attente').hidden = isHost;
  }

  // Les scores (totaux du serveur) et, selon la phase, qui a fait quoi.
  function ligneJoueur(id, ...fin) {
    const s = scores.get(id) || {};
    const li = el('li', 'ligne-joueur' + (id === myId ? ' is-moi' : '') + (s.left ? ' is-parti' : ''));
    li.dataset.id = id;
    li.append(GameAvatar.node(avatarDe(id), DEFAUT, 'sm'), el('span', 'nom', nomDe(id) + (id === myId ? ' (toi)' : '')), ...fin);
    return li;
  }
  function majScores(liste) {
    for (const p of liste || []) {
      const s = scores.get(p.id) || { score: 0, left: false };
      if (Number.isFinite(p.score)) s.score = p.score;
      if (typeof p.left === 'boolean') s.left = p.left;
      scores.set(p.id, s);
      const r = roster.get(p.id);
      if (r && typeof p.left === 'boolean') r.left = p.left;
    }
  }
  function majTableau() {
    const ol = $('tableau');
    ol.replaceChildren();
    const ids = [...scores.keys()].sort((a, b) => scores.get(b).score - scores.get(a).score);
    const ph = phase();
    for (const id of ids) {
      const s = scores.get(id);
      const m = s.left ? 'parti'
        : ph === 'debate' && etat.ready.includes(id) ? '✓ prêt'
          : ph === 'vote' && etat.voted.includes(id) ? '✓ a voté'
            : ph === 'question' && etat.question && etat.question.speaker === id ? '🎙️ répond' : '';
      ol.append(ligneJoueur(id, el('span', 'marque', m), el('span', 'total', `${s.score} pts`)));
    }
  }

  function majTout() {
    bandeau();
    panneaux();
    const ph = phase();
    if (ph === 'role') majRole();
    majFlash();
    if (ph === 'question') majQuestion();
    if (ph === 'debate') majDebat();
    if (ph === 'vote') majVote();
    if (ph === 'verdict' || ph === 'guess') majVerdict();
    if (ph === 'guess') majGuess();
    if (ph === 'reveal') majReveal();
    majTableau();
    // Le focus suit l'écran, une fois par phase (sans faire défiler).
    if (ph !== derniere) {
      derniere = ph;
      $('action-etat').textContent = '';
      if (ph === 'verdict') $('verdict-titre').focus({ preventScroll: true });
      if (ph === 'reveal') $('rev-titre').focus({ preventScroll: true });
    }
    if (ph === 'question' && etat.question && etat.question.speaker === myId && document.activeElement !== $('repondu')) {
      $('repondu').focus({ preventScroll: true });
    }
  }

  // ------------------------------------------------------------ intentions
  const envoyer = (action, extra) => NET.send({ action, roundId: manche && manche.roundId, ...extra });
  $('repondu').addEventListener('click', () => {
    if (!etat || !etat.question || etat.question.speaker !== myId) return;
    $('repondu').disabled = true;
    envoyer('answered');
  });
  $('pret').addEventListener('click', () => {
    monPret = !monPret;
    envoyer('ready', { ready: monPret });
    majDebat();
  });
  function voter(id) {
    monVote = id;
    envoyer('vote', { target: id });
    majVote();
  }
  function choisir(i) {
    if (monChoix != null) return;
    monChoix = i;
    envoyer('guess', { option: i });
    majGuess();
  }
  $('suivante').addEventListener('click', () => { $('suivante').disabled = true; NET.send({ action: 'next' }); });

  // --------------------------------------------------------------- chrono
  let finLocale = 0, horloge = 0;
  function armerChrono(remainingMs) {
    finLocale = Number.isFinite(remainingMs) ? performance.now() + remainingMs : 0;
    tic();
    if (!horloge) horloge = setInterval(tic, 250);
  }
  function tic() {
    const c = $('chrono');
    const s = finLocale ? Math.max(0, Math.ceil((finLocale - performance.now()) / 1000)) : null;
    const actif = s !== null && !!manche && !$('play').hidden;
    c.textContent = actif ? `${s} s` : '';
    c.classList.toggle('vite', !!actif && s <= 5);
  }

  // --------------------------------------------------------------- accueil
  let myAvatar = GameProfile.startEmoji(AVATARS);
  for (const em of AVATARS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'avatar-pick' + (em === myAvatar ? ' picked' : '');
    b.textContent = em;
    b.setAttribute('aria-pressed', String(em === myAvatar));
    b.addEventListener('click', () => {
      myAvatar = em;
      document.querySelectorAll('#avatar-row .avatar-pick').forEach((x) => {
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
      if (lien && viaHub && !myId) { viaHub = false; lien.failed('UNREACHABLE', err.message); }
    }
  }
  $('host').addEventListener('click', () => enter());
  $('join').addEventListener('click', () => enter($('code-input').value));
  $('code-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') enter($('code-input').value); });

  // ------------------------------------------------------- lancé par le Hub
  // Même montage que Croq.ios. Sans billet, `lien` vaut null et la page
  // marche exactement comme hors Hub.
  let viaHub = false;
  let partirSansAttendre = false;
  const lien = window.HubHandoff ? HubHandoff.start({
    gameId: 'temoin',
    join: (code) => {
      viaHub = true;
      if (!$('name-input').value.trim()) $('name-input').value = GameProfile.load().name || '';
      enter(code || undefined);
    },
    onUpdate: (i) => attente(i),
  }) : null;

  function attente(i) {
    const n = i && i.launch.stage === 'join' ? i.waitingIds.length : 0;
    const bloque = isHost && n > 0 && !partirSansAttendre;
    $('start').disabled = bloque || nbJoueurs < minJoueurs;
    $('start').textContent = bloque ? `En attente de ${i.waiting}…` : 'Lancer la partie';
    $('start-anyway').hidden = !bloque;
  }

  // --- connexion perdue (games/shared/game-net.js) -------------------------
  const perte = GameNet.surPerte(NET, {
    dansRoom: () => !!myId,
    enPartie: () => !$('play').hidden,
    code: () => $('room-code').textContent.trim(),
    quitter: () => { myId = null; manche = null; etat = null; $('to-hub').hidden = true; showError(''); },
    revenir: (code) => { if (lien) viaHub = true; enter(code); },
    show, hub: !!lien,
  });
  NET.on('lost', () => { if (manche) majTout(); });

  $('room-code').addEventListener('click', async () => {
    const hint = $('code-hint');
    try { await navigator.clipboard.writeText($('room-code').textContent.trim()); hint.textContent = 'code copié ✔'; }
    catch (_) { hint.textContent = 'copie impossible — recopie le code à la main'; }
    setTimeout(() => { hint.textContent = 'clique sur le code pour le copier'; }, 2000);
  });

  // ------------------------------------------------------------------ salon
  $('start').addEventListener('click', () => NET.send({ action: 'start' }));
  $('start-anyway').addEventListener('click', () => { partirSansAttendre = true; NET.send({ action: 'start' }); });
  $('revanche').addEventListener('click', () => NET.send({ action: 'start' }));
  $('vers-salon').addEventListener('click', () => NET.send({ action: 'lobby' }));
  // Les réglages : l'hôte demande, le serveur valide et rediffuse le salon.
  document.querySelectorAll('.nb-manches').forEach((b) => b.addEventListener('click', () => {
    NET.send({ action: 'settings', rounds: Number(b.dataset.rounds) });
  }));
  document.querySelectorAll('.nb-flash').forEach((b) => b.addEventListener('click', () => {
    NET.send({ action: 'settings', flashMs: Number(b.dataset.flash) });
  }));

  function renderLobby(m) {
    const ul = $('players');
    ul.replaceChildren();
    for (const p of m.players) {
      const li = el('li', 'g-player');
      li.append(GameAvatar.node(p.avatar, DEFAUT, 'sm'), el('span', 'g-player-name', p.name + (p.id === myId ? ' (toi)' : '')));
      if (p.host) li.append(el('span', 'tag', 'hôte'));
      ul.append(li);
    }
    $('lobby-count').textContent = `${m.players.length} / ${m.max || 16}`;
    $('host-config').hidden = !isHost;
    nbJoueurs = m.players.length;
    minJoueurs = m.min || 3;
    reglages = { rounds: m.rounds || reglages.rounds, flashMs: m.flashMs || reglages.flashMs };
    document.querySelectorAll('.nb-manches').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.rounds) === reglages.rounds)));
    document.querySelectorAll('.nb-flash').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.flash) === reglages.flashMs)));
    $('lobby-info').textContent = `${reglages.rounds} manches · scène montrée ${reglages.flashMs / 1000} s · en vocal, chacun sur son écran.`;
    attente(lien && lien.info());
    $('need-players').textContent = isHost
      ? (nbJoueurs < minJoueurs ? `Il faut au moins ${minJoueurs} joueurs.` : '')
      : 'En attente de l’hôte…';
  }

  // ---------------------------------------------------------- les messages
  NET.on('you', (m) => {
    myId = m.id;
    isHost = m.host;
    perte.retour();
    $('room-code').textContent = m.code;
    show('lobby');
    // Lancé par le Hub : SA place (l'id Faux Témoin, jamais celui du Hub).
    if (lien) { viaHub = false; lien.roomReady(m.code, m.id); attente(lien.info()); }
  });

  NET.on('lobby', (m) => {
    isHost = m.players.some((p) => p.id === myId && p.host);
    if (m.phase === 'end') { majFin(); return; }
    manche = null; etat = null;
    renderLobby(m);
    show('lobby');
  });

  function identites(liste) {
    roster = new Map(liste.map((p) => [p.id, { name: p.name, avatar: p.avatar, left: false }]));
    scores = new Map(liste.map((p) => [p.id, { score: 0, left: false }]));
  }

  // Le lancement : les identités, une fois.
  NET.on('game', (m) => {
    isHost = m.host === myId;
    identites(m.identities);
    manche = null; etat = null; derniere = null;
    show('play');
    bandeau();
    majTableau();
  });

  // Une nouvelle manche : tout ce qui concernait la précédente est oublié.
  NET.on('round', (m) => {
    if (lien && isHost && m.roundId === 1) lien.started();
    manche = { roundId: m.roundId, rounds: m.rounds, title: m.title };
    role = null; scene = null; options = null; etat = null; derniere = null;
    monPret = false; monVote = null; monChoix = null;
    // Les dessins de la manche passée (révélation, versions) s'en vont aussi :
    // un panneau caché garde ses enfants.
    $('rev-scene').replaceChildren();
    $('guess-versions').replaceChildren();
    majScores(m.players);
    show('play');
    bandeau();
    majTableau();
  });

  // Mon rôle : à moi seul (le serveur ne l'envoie à personne d'autre).
  NET.on('role', (m) => {
    if (!manche || m.roundId !== manche.roundId) return;
    role = m.role === 'liar' ? 'liar' : 'witness';
    if (etat) majTout(); else { bandeau(); majRole(); }
  });

  NET.on('phase', (m) => {
    if (!manche || m.roundId !== manche.roundId) return;
    const avant = phase();
    etat = m;
    if (m.phase !== avant) {
      if (m.phase === 'debate') monPret = false;
      if (m.phase === 'vote') monVote = null;
      if (m.phase !== 'flash') scene = null;          // la scène ne reste pas
    }
    majScores(m.players);
    armerChrono(m.remainingMs);
    majTout();
  });

  // La scène : à moi seul, au flash (`scene: null` pour le Faux Témoin).
  NET.on('scene', (m) => {
    if (!manche || m.roundId !== manche.roundId) return;
    scene = m.scene || null;
    majFlash();
  });

  // Les 4 versions : au seul Faux Témoin démasqué.
  NET.on('options', (m) => {
    if (!manche || m.roundId !== manche.roundId || !Array.isArray(m.options)) return;
    options = m.options;
    if (phase() === 'guess') majGuess();
  });

  NET.on('ready', (m) => {
    if (!etat || m.roundId !== etat.roundId) return;
    etat.ready = m.ready;
    if (phase() === 'debate') { majDebat(); majTableau(); }
  });

  NET.on('voted', (m) => {
    if (!etat || m.roundId !== etat.roundId) return;
    etat.voted = m.voted;
    if (phase() === 'vote') { majVote(); majTableau(); }
  });

  NET.on('left', (m) => {
    const r = roster.get(m.id);
    if (r) r.left = true;
    isHost = m.host === myId;
    majScores(m.players);
    if (monVote === m.id) monVote = null;
    if (etat) majTout(); else majTableau();
  });

  // L'état complet, à la demande : il REMPLACE ce que la page croyait savoir.
  NET.on('snapshot', (m) => {
    isHost = m.host === myId;
    identites(m.identities);
    majScores(m.players);
    if (m.phase === 'end') return m.ranking && afficherFin({ complete: m.complete, host: m.host, ranking: m.ranking });
    manche = { roundId: m.roundId, rounds: m.rounds, title: m.title };
    role = m.role ? m.role.role : null;
    scene = m.scene || null;
    options = m.options || null;
    etat = m;
    show('play');
    armerChrono(m.remainingMs);
    majTout();
  });

  // Fin de partie : le classement du serveur, tel quel.
  function afficherFin(m) {
    const ol = $('classement');
    ol.replaceChildren();
    for (const r of m.ranking) {
      const li = el('li', 'ligne-joueur' + (r.rank <= 3 && r.score > 0 ? ' is-podium' : '') + (r.id === myId ? ' is-moi' : '') + (r.left ? ' is-parti' : ''));
      li.dataset.id = r.id;
      const rang = el('span', 'rang', place(r.rank));
      rang.setAttribute('aria-hidden', 'true');
      li.append(rang, GameAvatar.node(r.avatar, DEFAUT, 'sm'), el('span', 'nom', r.name + (r.id === myId ? ' (toi)' : '') + (r.left ? ' · parti' : '')), el('span', 'score', `${r.score} pts`));
      li.setAttribute('aria-label', `${r.rank === 1 ? '1er' : r.rank + 'e'} : ${r.name}, ${r.score} points`);
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

  NET.on('results', (m) => {
    isHost = m.host === myId;
    manche = null; etat = null;
    finLocale = 0;
    afficherFin(m);
    if (lien) {
      // Score de soirée : le classement du SERVEUR, transmis au Hub (l'hôte du
      // lancement seulement, une fois — hub-handoff.js filtre), AVANT ended().
      // Une partie interrompue n'est pas classée : ended() seul.
      if (m.complete && lien.results) lien.results(rangs(m.ranking));
      lien.ended();
      if (HubHandoff.endActions) HubHandoff.endActions($('to-hub'), $('revanche'));
      else $('to-hub').hidden = false;
    }
  });

  // Le classement tel que le SERVEUR l'a calculé (rang ex æquo compris, score
  // de la partie) : rien n'est recalculé ici.
  function rangs(ranking) {
    return ranking.map((r) => ({ gamePlayerId: r.id, rank: r.rank, points: r.score }));
  }

  // Un refus, à moi seul : on remet l'action à disposition et on dit pourquoi.
  NET.on('refused', (m) => {
    if (!manche || (m.roundId != null && m.roundId !== manche.roundId)) return;
    if (m.action === 'vote') monVote = null;
    if (m.action === 'ready') monPret = false;
    if (m.action === 'guess' && m.reason !== 'ALREADY_GUESSED') monChoix = null;
    if (etat) majTout();
    $('action-etat').textContent = `Refusé : ${m.message}.`;
  });

  NET.on('error', (m) => {
    showError(m.message);
    perte.refus(m.message);
    if (lien && viaHub && !myId) { viaHub = false; lien.failed('JOIN', m.message); }
  });

  // Le profil : préremplir le pseudo.
  if (!$('name-input').value.trim()) $('name-input').value = GameProfile.load().name || '';
})();
