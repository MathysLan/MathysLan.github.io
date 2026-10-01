// Page /games/ : le point d'entrée du Game Hub.
//
//   profil local (game-profile.js) ─┐
//                                   ├─ cette page ─ affichage (game-avatar.js)
//   client du Hub (game-hub.js) ────┘
//
// Cette page ne parle PAS au WebSocket elle-même : elle appelle le client
// (create / join / leave / prefs / caps / draw…) et redessine à chaque état
// reçu. Elle ne lance aucun jeu : cette phase s'arrête au jeu tiré.
//
// ⚠️ LA PAGE NE DÉCIDE RIEN. Ce qui est possible, les chances, le jeu tiré :
// tout vient de `session.pool` et `session.draw`, calculés par le serveur. La
// page affiche, et la caisse (hub-crate.js) met en scène le résultat reçu.
//
// ⚠️ Rien de ce qui vient du réseau ne passe par innerHTML : les cartes joueurs
// sont construites nœud par nœud, les avatars par GameAvatar.node().
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const AVATARS = ['🦊', '🐼', '😎', '🤖', '👻', '🐸', '🔥', '⚡', '🎯', '🎧', '🍕', '🚀'];
  // Le code de la session de CET onglet : un rechargement la reprend (même
  // player.id, donc le serveur rend sa place au joueur au lieu d'en créer un
  // second). sessionStorage, pas localStorage : deux onglets = deux histoires.
  const RESUME = 'mathys_hub_session';
  const HUB_URL = GameHub.hubUrl(location.search);
  const hub = GameHub.createClient({ url: HUB_URL });
  // Un classement ou une fin de partie que la page du jeu n'a pas pu livrer
  // (socket Hub coupé au mauvais moment) est gardé dans l'onglet : c'est ce
  // client-ci qui le livre au retour (voir « livraison » dans hub-handoff.js).
  HubHandoff.attach(hub);

  // Un profil jamais enregistré reçoit ici son id, une fois pour toutes (voir
  // load() dans game-profile.js) : c'est lui qui permet de se reconnecter.
  GameProfile.load();

  const store = {
    get() { try { return sessionStorage.getItem(RESUME); } catch (_) { return null; } },
    set(c) { try { sessionStorage.setItem(RESUME, c); } catch (_) { /* reprise perdue au rechargement, pas plus */ } },
    clear() { try { sessionStorage.removeItem(RESUME); } catch (_) {} },
  };

  // Le score de la soirée est un panneau à part : il n'existe qu'avec le salon.
  // Le débrief de soirée (#hub-recap) ne s'affiche qu'en sortant d'une session,
  // AU-DESSUS de l'entrée (voir leave) : tout autre écran le range.
  // Le salon, ce sont TROIS blocs frères : #lobby (joueurs, action, caisse),
  // #hub-score, puis #hub-lobby-games (catalogue, actions secondaires).
  // Hors du salon, le panneau « ton profil » n'a plus d'objet : il se ferme.
  const show = (id) => { if (id !== 'lobby') fermerProfil();
    $('entry').hidden = id !== 'entry'; $('lobby').hidden = id !== 'lobby'; $('hub-score').hidden = id !== 'lobby';
    $('hub-lobby-games').hidden = id !== 'lobby'; $('hub-recap').hidden = true; };
  const say = (t) => { $('hub-state').textContent = t || ''; };
  const warn = (t) => { $('hub-msg').textContent = t ? '> ' + t : ''; };

  // ------------------------------------------------------------- ton profil
  const profil = GameProfile.load();
  for (const em of AVATARS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'avatar-pick' + (em === profil.avatar.emoji ? ' picked' : '');
    b.textContent = em;
    b.setAttribute('aria-pressed', String(em === profil.avatar.emoji));
    b.setAttribute('aria-label', 'icône ' + em);
    // game-profile.js enregistre le choix (délégation sur #avatar-row) ; ici on
    // ne fait que refléter la sélection et rafraîchir la carte.
    b.addEventListener('click', () => {
      document.querySelectorAll('#avatar-row .avatar-pick').forEach((x) => {
        x.classList.toggle('picked', x === b);
        x.setAttribute('aria-pressed', String(x === b));
      });
      setTimeout(renderMe, 0);
    });
    $('avatar-row').appendChild(b);
  }

  // Le pseudo tapé mais pas encore « validé » (pas de sortie du champ) compte.
  function flushName() {
    const v = GameProfile.cleanName($('name-input').value);
    if (v && v !== GameProfile.load().name) GameProfile.setName(v);
    if (v && $('name-input').value !== v) $('name-input').value = v;
  }

  function renderMe() {
    const p = GameProfile.load();
    // Ce qui SERA enregistré (invisibles et espaces en trop retirés, 16 unités) :
    // la carte n'affiche jamais un pseudo que le profil refuserait.
    const typed = GameProfile.cleanName($('name-input').value);
    const name = typed || p.name;
    $('me-avatar').replaceChildren(GameAvatar.node(p.avatar, undefined, 'lg'));
    $('me-name').textContent = name || 'sans pseudo';
    $('me-note').textContent = !name ? 'choisis un pseudo pour entrer'
      : p.avatar.kind === 'image' ? 'avec ta photo de profil' : 'avec ton icône';
    const ok = !!name;
    $('hub-create').disabled = !ok || hub.status === 'connecting';
    $('hub-join').disabled = !ok || hub.status === 'connecting';
  }

  let poll = 0;
  function openEditor(open) {
    $('identity').hidden = !open;
    $('identity-toggle').setAttribute('aria-expanded', String(open));
    $('identity-toggle').textContent = open ? 'fermer' : 'modifier';
    // La photo se choisit de façon asynchrone (canvas) : tant que l'éditeur est
    // ouvert, la carte suit.
    clearInterval(poll);
    if (open) poll = setInterval(renderMe, 400);
    else { flushName(); renderMe(); }
  }
  $('identity-toggle').addEventListener('click', () => openEditor($('identity').hidden));
  $('identity-done').addEventListener('click', () => openEditor(false));
  $('name-input').addEventListener('input', renderMe);

  // --------------------------------------------------------- créer / rejoindre
  async function enter(kind) {
    flushName();
    const p = GameProfile.load();
    if (!p.name) { openEditor(true); warn('Choisis un pseudo avant de continuer.'); $('name-input').focus(); return; }
    warn('');
    const code = $('hub-code-input').value;
    if (kind === 'join' && !GameHub.normalizeCode(code)) { warn(GameHub.errorText('BAD_CODE')); return; }
    say('Connexion au Hub… (s\'il dormait, il met ~30 s à se réveiller)');
    renderMe();
    try {
      const player = GameHub.playerFrom(p);
      if (kind === 'create') await hub.create(player);
      else await hub.join(code, player);
      say('');
    } catch (e) {
      say('');
      warn(e.message);
    }
    renderMe();
  }
  $('hub-create').addEventListener('click', () => enter('create'));
  $('hub-join').addEventListener('click', () => enter('join'));
  $('hub-code-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') enter('join'); });
  $('hub-code-input').addEventListener('input', () => {
    const el = $('hub-code-input');
    el.value = el.value.toUpperCase();
  });

  // -------------------------------------------------------------------- salon
  function tag(text, cls) {
    const s = document.createElement('span');
    s.className = 'hub-tag ' + cls;
    s.textContent = text;
    return s;
  }

  function renderLobby(session, you) {
    $('hub-code').textContent = session.code;          // le code DU SERVEUR, tel quel
    const n = session.players.length;
    const absents = session.players.filter((p) => !p.connected).length;
    $('hub-count').textContent = `${n} joueur${n > 1 ? 's' : ''} dans la session`;
    $('hub-count-sub').textContent = (absents ? `${absents} absent${absents > 1 ? 's' : ''} · ` : '') + `${session.maxPlayers} max`;

    const list = $('hub-players');
    // Le bouton « ton profil » est UN élément, déplacé dans ta carte à chaque
    // rendu : recréé, il perdait le focus clavier à chaque état reçu du Hub
    // (un joueur qui arrive, un veto…) — le focus retombait sur <body>.
    const avaitFocus = document.activeElement === boutonProfil;
    list.replaceChildren(...session.players.map((p) => {
      const li = document.createElement('li');
      li.className = 'hub-card' + (p.id === you ? ' is-me' : '') + (p.connected ? '' : ' is-away');
      li.dataset.player = p.id;
      const name = document.createElement('span');
      name.className = 'hub-card-name';
      name.textContent = p.name;
      const tags = document.createElement('span');
      tags.className = 'hub-tags';
      if (p.host) tags.appendChild(tag('hôte', 'host'));
      if (p.id === you) tags.appendChild(tag('toi', 'me'));
      if (!p.connected) tags.appendChild(tag('absent', 'away'));
      li.append(GameAvatar.node(p.avatar, undefined, 'lg'), name);
      if (tags.childNodes.length) li.appendChild(tags);   // pas de ligne vide réservée
      if (p.id === you) li.appendChild(boutonProfil);
      return li;
    }));
    if (avaitFocus && boutonProfil.isConnected) boutonProfil.focus({ preventScroll: true });
    if (dlgProfil.open) remplirProfil(session, you);
  }

  // ------------------------------------------------------------ ton profil
  // Dans le salon, le profil se CONSULTE : c'est l'identité de la soirée, telle
  // que le Hub la connaît (session.players), qui est affichée — jamais le
  // profil local à sa place. Trois niveaux, qui ne se mélangent pas :
  //   profil local (game-profile.js)  préférence du joueur, dans CE navigateur ;
  //   identité de session             ce que le Hub a reçu au `join` (reprise
  //                                   comprise) et montre à tous ;
  //   serveur                         seule autorité : hôte, score, résultats.
  // On ne le modifie pas pendant une soirée (choix du lot G) : l'éditeur est à
  // l'accueil. Si le profil local a changé entre-temps (autre onglet, page de
  // jeu), on le DIT : le Hub le reprendra à la prochaine connexion, puisqu'il
  // relit l'identité à chaque `join` (game-hub-server, hub.js).
  const boutonProfil = document.createElement('button');
  boutonProfil.type = 'button';
  boutonProfil.className = 'ghost hub-card-profile';
  boutonProfil.id = 'hub-profile-btn';
  boutonProfil.textContent = '👤 ton profil';
  boutonProfil.setAttribute('aria-haspopup', 'dialog');
  boutonProfil.setAttribute('aria-controls', 'profile-dialog');
  const dlgProfil = $('profile-dialog');
  // Le profil survit-il à cette visite ? (navigation privée, stockage bloqué :
  // non — le Hub marche quand même, l'id ne vaut que pour la page.)
  const garde = () => { try { return localStorage.getItem(GameProfile.KEY) !== null; } catch (_) { return false; } };
  const memeAvatar = (a, b) => !!a && !!b && a.kind === b.kind && a.emoji === b.emoji && (a.kind !== 'image' || a.src === b.src);
  function remplirProfil(session, you) {
    const moi = session.players.find((p) => p.id === you);
    if (!moi) return;
    const av = GameAvatar.node(moi.avatar, undefined, 'lg');
    av.setAttribute('aria-hidden', 'true');
    $('profile-avatar').replaceChildren(av);
    $('profile-name').textContent = moi.name;
    const photo = moi.avatar && moi.avatar.kind === 'image';
    $('profile-kind').textContent = photo ? 'avec ta photo de profil' : 'avec ton icône';
    $('profile-session').textContent = `Les autres te voient ainsi dans cette soirée (session ${session.code}). `
      + 'Pseudo et icône se modifient à l\'accueil, hors session.';
    const local = GameProfile.load();
    const joue = GameHub.playerFrom(local);
    const change = joue.name !== moi.name || !memeAvatar(joue.avatar, moi.avatar);
    $('profile-local').hidden = !change;
    $('profile-local').textContent = change
      ? `Ton profil enregistré a changé depuis ton entrée (« ${joue.name || 'sans pseudo'} », ${joue.avatar.kind === 'image' ? 'avec une photo' : 'avec ' + joue.avatar.emoji}) : `
        + 'le Hub le prendra à ta prochaine connexion (rechargement, retour d\'une partie).'
      : '';
    $('profile-where').textContent = garde()
      ? 'Enregistré dans ce navigateur, sans compte : tu le retrouves en revenant.'
      : 'Ce navigateur ne garde pas ton profil (navigation privée ?) : il ne vaut que pour cette visite.';
  }
  boutonProfil.addEventListener('click', () => {
    if (!current || typeof dlgProfil.showModal !== 'function') return;
    remplirProfil(current.session, current.you);
    ouvrirStats();
    dlgProfil.showModal();                     // focus sur « Fermer », le seul bouton ; Échap ferme
  });

  // ---------------------------------------------------- tes statistiques
  // ⚠️ AUCUN CALCUL ICI. Les chiffres viennent du Hub (message `stats`,
  // game-hub-server → stats.js), qui les tire des classements qu'IL a
  // acceptés. Définitions (lot H) : victoire = 1er devant au moins un joueur
  // (ni un solo ni un nul du Morpion) ; podium = dans les 3 premiers, à deux ou
  // plus ; meilleure place = à deux ou plus. Demandées à CHAQUE ouverture.
  const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`;
  function noteStats(texte) {
    $('profile-stats-note').hidden = false;
    $('profile-stats-note').textContent = texte;
    $('profile-figures').hidden = true;
    $('profile-games-title').hidden = true;
    $('profile-games').hidden = true;
    $('profile-records').hidden = true;
    $('profile-ach').hidden = true;
  }
  function ouvrirStats() {
    $('profile-stats-live').textContent = '';
    if (hub.requestStats()) { noteStats('Chargement de tes statistiques…'); $('profile-stats').setAttribute('aria-busy', 'true'); return; }
    noteStats('Ce Hub ne garde pas encore de statistiques.');
    $('profile-stats').removeAttribute('aria-busy');
    $('profile-stats-live').textContent = 'Ce Hub ne garde pas encore de statistiques.';
  }
  function figure(n, mot, detail) {
    const d = el('div', 'profile-figure');
    const dd = document.createElement('dd');
    dd.append(el('b', null, String(n)), el('small', null, detail));
    d.append(el('dt', null, mot), dd);
    return d;
  }
  function afficherStats(r) {
    $('profile-stats').removeAttribute('aria-busy');
    const s = r.stats;
    let dit;
    if (!s) {
      dit = r.reason === 'UNVERIFIED' ? 'Pas de statistiques pour ce profil dans ce navigateur.'
        : 'Statistiques indisponibles pour l\'instant. Réessaie un peu plus tard.';
      noteStats(dit);
    } else if (!s.played) {
      dit = 'Aucune partie jouée pour l\'instant. Tes parties classées dans le Game Hub apparaîtront ici.';
      noteStats(dit);
    } else {
      const toutSolo = s.solo === s.played;
      const chiffres = [figure(s.played, s.played > 1 ? 'parties' : 'partie', toutSolo ? 'en solo' : s.solo ? `dont ${s.solo} en solo` : 'classées')];
      if (!toutSolo) {
        chiffres.push(
          figure(s.wins, s.wins > 1 ? 'victoires' : 'victoire', 'fois 1er, devant au moins un joueur'),
          figure(s.podiums, s.podiums > 1 ? 'podiums' : 'podium', 'fois dans les 3 premiers'),
          figure(s.best ? HubRecap.ordinal(s.best) : '—', 'meilleure place', 'à plusieurs'));
      }
      $('profile-figures').replaceChildren(...chiffres);
      $('profile-figures').hidden = false;
      // Que du solo : on le dit, sans « 0 victoire » (il n'y avait personne à battre).
      $('profile-stats-note').hidden = !toutSolo;
      $('profile-stats-note').textContent = toutSolo ? 'En solo, ni victoire ni podium : il n\'y a personne à battre.' : '';
      $('profile-games').replaceChildren(...s.games.map((g) => {
        const jeu = info(g.gameId);
        const li = el('li', 'profile-game');
        li.dataset.game = g.gameId;
        const em = el('span', 'profile-game-emoji', jeu.emoji);
        em.setAttribute('aria-hidden', 'true');
        const txt = el('span', 'profile-game-text');
        const nom = el('span', 'profile-game-name', jeu.title);
        nom.title = jeu.title;
        const meta = g.solo === g.played ? `${pluriel(g.played, 'partie')} en solo`
          : `${pluriel(g.played, 'partie')}${g.solo ? ` (${g.solo} en solo)` : ''} · ${pluriel(g.wins, 'victoire')} · ${pluriel(g.podiums, 'podium')}`
            + (g.best ? ` · meilleure place : ${HubRecap.ordinal(g.best)}` : '');
        txt.append(nom, el('span', 'profile-game-meta', meta));
        li.append(em, txt);
        return li;
      }));
      $('profile-games-title').hidden = !s.games.length;
      $('profile-games').hidden = !s.games.length;
      dit = toutSolo ? `${pluriel(s.played, 'partie')} en solo.`
        : `${pluriel(s.played, 'partie')}, ${pluriel(s.wins, 'victoire')}, ${pluriel(s.podiums, 'podium')}`
          + (s.best ? `, meilleure place : ${HubRecap.ordinal(s.best)}.` : '.');
    }
    if (s && 'records' in s) dit += ' ' + afficherRecords(s.records);
    if (s && 'achievements' in s) dit += ' ' + afficherSucces(s.achievements);
    // Annoncé une fois arrivé (le panneau est déjà ouvert, le focus sur « Fermer »).
    $('profile-stats-live').textContent = dit;
  }

  // ------------------------------------------------------ tes records (lot I)
  // ⚠️ AUCUN CALCUL ICI NON PLUS : `stats.records` vient du Hub (stats.js →
  // records()), dérivé des mêmes parties. Un record absent vaut null et n'est
  // pas montré (pas de « 0 victoire » en record) ; une égalité arrive avec TOUS
  // les jeux à égalité et on les montre tous — au-delà de trois, « 4 jeux à
  // égalité » (le détail est dans « Par jeu », juste au-dessus). Rend la phrase
  // annoncée. Un Hub d'avant le lot I n'envoie pas `records` : rien n'est montré.
  const liste = (mots) => (mots.length < 2 ? mots.join('') : mots.slice(0, -1).join(', ') + ' et ' + mots[mots.length - 1]);
  function jeuxRecord(ids) {
    const b = el('b');
    if (ids.length > 3) { b.textContent = `${ids.length} jeux`; return b; }
    ids.forEach((id, i) => {
      // Séparateurs pour le lecteur d'écran seulement : à l'écran, un jeu par ligne.
      if (i) b.append(el('span', 'sr-only', i === ids.length - 1 ? ' et ' : ', '));
      const n = el('span', 'profile-record-game', info(id).title);
      n.title = info(id).title;
      b.append(n);
    });
    return b;
  }
  function record(cle, emoji, mot, valeur, detail) {
    const d = el('div', 'profile-figure profile-record');
    d.dataset.record = cle;
    const dt = document.createElement('dt');
    const em = el('span', null, emoji + ' ');
    em.setAttribute('aria-hidden', 'true');
    dt.append(em, mot);
    const dd = document.createElement('dd');
    dd.append(typeof valeur === 'string' ? el('b', null, valeur) : valeur, el('small', null, detail));
    d.append(dt, dd);
    return d;
  }
  function afficherRecords(r) {
    const note = $('profile-records-note'), dl = $('profile-records-list');
    $('profile-records').hidden = false;
    const noter = (texte) => { note.hidden = !texte; note.textContent = texte || ''; };
    if (!r) { noter('Pas encore de record.'); dl.hidden = true; return 'Pas encore de record.'; }
    const cartes = [];
    if (r.best) cartes.push(record('best', '🥇', 'Meilleure place', HubRecap.ordinal(r.best), 'à plusieurs, tous jeux'));
    if (r.wins) cartes.push(record('wins', '🏆', r.wins > 1 ? 'Victoires' : 'Victoire', String(r.wins), '1er devant au moins un joueur'));
    // Meilleure place et victoires sont déjà dans la phrase des statistiques :
    // l'annonce ne dit que les jeux en tête.
    const dits = [];
    const enTete = (t, cle, n, mot, un, plusieurs) => {
      if (!t) return;
      const egal = t.games.length > 1;
      cartes.push(record(cle, cle === 'mostPlayed' ? '🎮' : '🏅', egal ? plusieurs : un, jeuxRecord(t.games),
        egal ? `à égalité · ${pluriel(n, mot)} chacun` : pluriel(n, mot)));
      dits.push(`${(egal ? plusieurs : un).toLowerCase()} : ${liste(t.games.map((id) => info(id).title))} (${pluriel(n, mot)}${egal ? ' chacun, à égalité' : ''})`);
    };
    if (r.mostPlayed) enTete(r.mostPlayed, 'mostPlayed', r.mostPlayed.played, 'partie', 'Jeu le plus joué', 'Jeux les plus joués');
    if (r.mostWins) enTete(r.mostWins, 'mostWins', r.mostWins.wins, 'victoire', 'Meilleur jeu', 'Meilleurs jeux');
    // Que du solo : pas de meilleure place à plusieurs, donc rien de compétitif.
    const solo = !r.best;
    noter(solo ? 'Aucun record compétitif pour l\'instant.' : '');
    dl.replaceChildren(...cartes);
    dl.hidden = !cartes.length;
    return (solo ? 'Aucun record compétitif pour l\'instant. ' : '') + (dits.length ? 'Records : ' + dits.join(' ; ') + '.' : '');
  }
  // ------------------------------------------------------- tes succès (lot J)
  // ⚠️ LE HUB DÉCIDE (game-hub-server, achievements.js) : la page ne connaît que
  // les TEXTES. Un code que le Hub envoie sans texte ici est ignoré ; un texte
  // sans code côté Hub reste verrouillé (un test compare les deux listes).
  const SUCCES = [
    { code: 'first-win', emoji: '🥇', name: 'Première victoire', desc: 'Gagne une partie à plusieurs.' },
    { code: 'explorer', emoji: '🧭', name: 'Touche-à-tout', desc: 'Joue à 5 jeux différents (le solo compte).' },
    { code: 'stalemate', emoji: '✖️', name: 'Pat', desc: 'Fais 3 matchs nuls au Morpion.' },
    { code: 'shared-throne', emoji: '🤝', name: 'Partage du trône', desc: 'Termine 1er ex æquo, devant au moins un joueur.' },
    { code: 'versatile', emoji: '🔀', name: 'Polyvalent', desc: 'Gagne à 3 jeux différents.' },
    { code: 'marathon', emoji: '🏃', name: 'Marathon', desc: 'Joue 10 parties à plusieurs dans une même soirée.' },
    { code: 'night-owl', emoji: '🌙', name: 'Oiseau de nuit', desc: 'Termine une partie à plusieurs entre minuit et 5 h (heure de Paris).' },
    { code: 'hat-trick', emoji: '🔥', name: 'Hat-trick', desc: 'Gagne 3 parties d\'affilée dans une même soirée.' },
    { code: 'crowd-king', emoji: '👑', name: 'Roi de la foule', desc: 'Gagne une partie à 6 joueurs ou plus.' },
    { code: 'grand-slam', emoji: '💎', name: 'Grand Chelem', desc: 'Gagne au moins une fois à chacun des 7 jeux en ligne.' },
  ];
  const succesDe = (code) => SUCCES.find((x) => x.code === code) || null;
  const DATE = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  // Débloqué pendant CETTE soirée : sa partie est dans l'historique de la session.
  const deCeSoir = (drawId) => !!drawId && !!current && current.session.history.games.some((g) => g.drawId === drawId);
  function afficherSucces(list) {
    const par = new Map(list.map((a) => [a.code, a]));
    const lignes = SUCCES.map((x) => ({ ...x, etat: par.get(x.code) || { unlocked: false } }));
    const obtenus = lignes.filter((l) => l.etat.unlocked);
    // Obtenus d'abord (ordre du catalogue), puis verrouillés.
    $('profile-ach-list').replaceChildren(...[...obtenus, ...lignes.filter((l) => !l.etat.unlocked)].map((l) => {
      const ok = l.etat.unlocked;
      const li = el('li', 'profile-ach-item ' + (ok ? 'is-unlocked' : 'is-locked'));
      li.dataset.code = l.code;
      const em = el('span', 'profile-ach-emoji', l.emoji);
      em.setAttribute('aria-hidden', 'true');
      const txt = el('span', 'profile-ach-text');
      const nom = el('span', 'profile-ach-name', l.name);
      if (ok && deCeSoir(l.etat.drawId)) nom.append(el('span', 'profile-ach-new', 'Nouveau'));
      const etat = el('span', 'profile-ach-state');
      const signe = el('span', null, ok ? '✓ ' : '🔒 ');
      signe.setAttribute('aria-hidden', 'true');
      etat.append(signe, ok ? (l.etat.at ? `Obtenu le ${DATE.format(new Date(l.etat.at))}` : 'Obtenu') : 'Verrouillé');
      txt.append(nom, el('span', 'profile-ach-desc', l.desc), etat);
      li.append(em, txt);
      return li;
    }));
    $('profile-ach-count').textContent = `· ${obtenus.length}/${SUCCES.length}`;
    $('profile-ach').hidden = false;
    return `Succès : ${obtenus.length} sur ${SUCCES.length}.`;
  }

  // « 🏆 Succès débloqué » : le Hub envoie les succès débloqués PAS ENCORE
  // notifiés (au retour d'une partie, ou tout de suite si l'on est déjà ici).
  // On les montre UN PAR UN, puis on dit au Hub « affiché » (achievementsSeen) :
  // il ne les renverra plus — ni au rechargement, ni à la reconnexion, ni dans
  // un autre onglet. Garde-fou d'AFFICHAGE en plus (ne débloque rien) : les
  // codes déjà montrés dans ce navigateur ne sont pas rejoués si l'accusé s'est
  // perdu dans une coupure ; on les accuse à nouveau, sans les montrer.
  const TOAST_MS = 5000, TOAST_SORTIE_MS = 300, TOAST_ECART_MS = 350, TOAST_ARRIVEE_MS = 700;
  const VUS_KEY = 'mathys_hub_ach_shown';
  const vusIci = () => {
    try { const v = JSON.parse(localStorage.getItem(VUS_KEY) || 'null'); return v && current && v.id === current.you && Array.isArray(v.codes) ? v.codes : []; }
    catch (_) { return []; }
  };
  const noteVu = (code) => {
    try { localStorage.setItem(VUS_KEY, JSON.stringify({ id: current.you, codes: [...new Set([...vusIci(), code])] })); } catch (_) { /* stockage bloqué */ }
  };
  const fileSucces = [];
  const montres = new Set();          // ce chargement de page
  let toastActif = false, attente = false, numero = 0;   // numero : rang dans la salve en cours
  hub.on('achievement', (list) => {
    const deja = vusIci();
    const relus = [];
    for (const u of list) {
      if (!succesDe(u.code)) continue;                       // code inconnu de cette page : rien à montrer
      if (deja.includes(u.code) || montres.has(u.code)) { relus.push(u.code); continue; }
      if (fileSucces.some((x) => x.code === u.code)) continue;
      fileSucces.push(u);
    }
    if (relus.length) hub.achievementsSeen(relus);
    if (!fileSucces.length) return;
    // Une salve qui commence : un court délai, le temps que la carte Résultat
    // arrive et prenne le focus. Pendant une salve, la file s'allonge seulement.
    if (!toastActif && !attente) { attente = true; setTimeout(pompe, TOAST_ARRIVEE_MS); }
  });
  // Attendre : une fenêtre ouverte (profil, fin de soirée), ou l'onglet caché —
  // une notification que personne ne voit ne doit pas être « affichée ».
  const bloque = () => !!document.querySelector('dialog[open]') || document.visibilityState === 'hidden';
  function pompe() {
    if (toastActif) return;
    if (!fileSucces.length) { attente = false; numero = 0; return; }
    if (bloque()) { setTimeout(pompe, 400); return; }
    const u = fileSucces.shift();
    const x = succesDe(u.code);
    toastActif = true;
    numero++;
    montres.add(u.code);
    noteVu(u.code);
    hub.achievementsSeen([u.code]);
    const total = numero + fileSucces.length;
    $('ach-toast-icon').textContent = x.emoji;
    $('ach-toast-n').textContent = total > 1 ? `· ${numero}/${total}` : '';
    $('ach-toast-name').textContent = x.name;
    $('ach-toast-desc').textContent = x.desc;
    $('ach-live').textContent = `Succès débloqué : ${x.name}. ${x.desc}`;
    const t = $('ach-toast');
    t.dataset.code = u.code;
    t.hidden = false;
    void t.offsetWidth;                                       // la transition part de l'état caché
    t.classList.add('is-in');
    let reste = TOAST_MS, depuis = Date.now();
    let minuterie = setTimeout(sortie, reste);
    // Pause au survol (souris) : on a le temps de lire.
    t.onmouseenter = () => { clearTimeout(minuterie); reste -= Date.now() - depuis; };
    t.onmouseleave = () => { depuis = Date.now(); minuterie = setTimeout(sortie, Math.max(reste, 1200)); };
    function sortie() {
      t.onmouseenter = t.onmouseleave = null;
      t.classList.remove('is-in');
      setTimeout(() => {
        t.hidden = true;
        delete t.dataset.code;
        toastActif = false;
        setTimeout(pompe, TOAST_ECART_MS);
      }, reduced() ? 0 : TOAST_SORTIE_MS);
    }
  }

  hub.on('stats', (r) => { if (dlgProfil.open) afficherStats(r); });
  $('profile-close').addEventListener('click', () => dlgProfil.close());
  // Le focus revient au bouton qui a ouvert — même s'il a changé de carte
  // pendant que le panneau était ouvert (un état du Hub est arrivé).
  dlgProfil.addEventListener('close', () => {
    const a = document.activeElement;
    if (boutonProfil.isConnected && !$('lobby').hidden && (!a || a === document.body || !a.isConnected)) boutonProfil.focus({ preventScroll: true });
  });
  function fermerProfil() { try { if (dlgProfil.open) dlgProfil.close(); } catch (_) {} }

  // ------------------------------------------------------------ catalogue
  // Pour l'AFFICHAGE seulement (titre, emoji, fourchettes) : data/games.js, la
  // source du manifest que lit le serveur. La liste des jeux, leur éligibilité
  // et leurs chances viennent du serveur.
  const INFO = {};
  if (typeof GAMES !== 'undefined') GAMES.forEach((g) => { INFO[g.id] = g; });
  const info = (id) => {
    const g = INFO[id] || {};
    return { emoji: g.emoji || '🎮', title: g.title || id, accent: g.accent, tagline: g.tagline || '', hub: g.hub || null };
  };
  // « du Passeur », « d'Imitation », « d'Alice », « de Bruno » : game-hub.js
  // (la même règle que les raisons d'exclusion). « à Le Passeur » → « au Passeur ».
  const de = GameHub.de;
  const au = (t) => (/^Le /.test(t) ? 'au ' + t.slice(3) : /^Les /.test(t) ? 'aux ' + t.slice(4) : 'à ' + t);
  // Termine une phrase par un point, sauf si le titre porte déjà sa ponctuation (« Qui Ment ? »).
  const point = (t) => (/[?!.…]$/.test(t) ? t : t + '.');
  const range = (r, unit) => (!r ? '—' : (r.min === r.max ? String(r.min) : `${r.min}–${r.max}`) + (unit ? ' ' + unit : ''));

  // ⚠️ Plus d'écran « Ce que tu apportes » : micro et avertissement sont acquis
  // d'office (game-hub-server, session.js). Le Hub n'a jamais testé ces
  // capacités — c'est le jeu qui demande le micro à l'entrée, et l'avertissement
  // est affiché sur sa page. La règle NEEDS existe toujours côté serveur, et son
  // libellé aussi (game-hub.js, reasonText) : si un besoin redevient un jour un
  // filtre, il s'affichera dans la raison du jeu, sans interface à refaire.

  const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; } };
  const nameOf = (session, id) => (session.players.find((p) => p.id === id) || {}).name || '?';
  const mine = (session, you) => session.players.find((p) => p.id === you) || { caps: {}, love: [], veto: [] };

  // La caisse de CE tirage a-t-elle déjà été ouverte dans cet onglet ? Un
  // rechargement ne rejoue pas l'animation (et ne redemande RIEN au serveur).
  const SEEN = 'mathys_hub_seen';
  const seen = {
    get() { try { return sessionStorage.getItem(SEEN); } catch (_) { return null; } },
    set(id) { try { sessionStorage.setItem(SEEN, id); } catch (_) {} },
  };
  let current = null;          // dernier { session, you } reçu
  let animating = null;        // id du tirage en cours d'animation
  let reelFor = null;          // id du tirage que la bande affiche
  let montre = null;           // id du tirage déjà amené à l'écran

  // Un tirage démarre : la caisse vient à l'écran, chez TOUT le monde. Sans
  // ça, l'hôte qui clique « Tirer » en bas de la liste des jeux voyait la
  // caisse s'ouvrir… hors de l'écran (vu au téléphone). Une seule fois par
  // tirage, pour ne pas ramener de force quelqu'un qui fait défiler.
  function amene(d) {
    if (montre === d.id) return;
    montre = d.id;
    $('hub-draw').scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' });
  }

  function render(session, you) {
    current = { session, you };
    renderLobby(session, you);
    const ok = !!session.pool;          // null = serveur d'avant le randomizer
    $('hub-pool').hidden = !ok;
    if (ok) renderPool(session, you);
    // Le résultat de la partie qu'on vient de jouer (null hors debrief classé).
    const round = HubRecap.lastResult(session, you, info);
    renderScore(session, you, round);
    renderRound(session, you, round);
    renderDraw(session, you, round);
    renderLaunch(session, you);
    renderFoot(session, you);
  }

  // ------------------------------------------------------ score de la soirée
  // ⚠️ AUCUN CALCUL DE POINTS ICI. `session.scores` est tenu par le Hub, qui le
  // tire des classements rendus par les jeux (game-hub-server, scores.js). La
  // page trie, met en forme, et c'est tout.
  //
  // Une ligne par joueur de la session (0 tant qu'il n'a rien marqué), les
  // meilleurs d'abord. Au-delà de 6, on garde les 5 premiers + TOI si tu es
  // plus bas : le bloc reste compact, et chacun y trouve toujours sa ligne.
  const MEDAILLES = HubRecap.MEDAILLES;
  const SCORE_MAX = 6;
  function renderScore(session, you, round) {
    const jeux = session.history.games || [];
    const derniere = jeux[jeux.length - 1] || null;
    const gain = {};
    if (derniere) derniere.results.forEach((r) => { gain[r.playerId] = r.points; });
    // Rang « de compétition » (50, 40, 40, 10 → 1, 2, 2, 4) : la même règle que
    // le débrief de soirée, dans hub-recap.js. `p` = le joueur, pour la suite.
    const lignes = HubRecap.ranking(session).map((l) => Object.assign(l, { p: session.players.find((x) => x.id === l.id) }));
    const personne = lignes.every((l) => l.pts === 0);

    let vues = lignes;
    if (lignes.length > SCORE_MAX) {
      vues = lignes.slice(0, SCORE_MAX - 1);
      const moi = lignes.find((l) => l.p.id === you);
      vues.push(moi && !vues.includes(moi) ? moi : lignes[SCORE_MAX - 1]);
    }
    $('hub-score-list').replaceChildren(...vues.map((l) => {
      const li = document.createElement('li');
      li.className = 'hub-score-row' + (l.p.id === you ? ' is-me' : '') + (l.p.connected ? '' : ' is-away');
      li.dataset.player = l.p.id;
      li.dataset.points = String(l.pts);
      const rang = document.createElement('span');
      rang.setAttribute('aria-hidden', 'true');
      // Pas de médaille tant que personne n'a marqué : tout le monde serait 🥇.
      const medaille = !personne && l.pts > 0 && l.rank <= 3;
      rang.className = 'hub-score-rank' + (medaille ? '' : ' is-num');
      rang.textContent = medaille ? MEDAILLES[l.rank - 1] : (personne ? '·' : l.rank + '.');
      const nom = document.createElement('span');
      nom.className = 'hub-score-name';
      nom.textContent = l.p.name + (l.p.id === you ? ' (toi)' : '');
      nom.title = l.p.name;
      const pts = document.createElement('span');
      pts.className = 'hub-score-pts';
      if (gain[l.p.id]) {
        const d = document.createElement('span');
        // TON gain de la partie qu'on vient de finir : une pastille, pour qu'on
        // voie qu'il vient d'entrer dans ce total (la carte Résultat le dit aussi).
        d.className = 'hub-score-delta' + (round && l.p.id === you ? ' is-fresh' : '');
        d.textContent = '+' + gain[l.p.id];
        pts.appendChild(d);
      }
      pts.append(String(l.pts));
      const u = document.createElement('small');
      u.textContent = 'pts';
      pts.appendChild(u);
      li.setAttribute('aria-label', (personne ? '' : (l.rank === 1 ? '1er' : l.rank + 'e') + ' : ') + l.p.name
        + (l.p.id === you ? ' (toi)' : '') + ', ' + l.pts + ' point' + (l.pts > 1 ? 's' : '')
        + (gain[l.p.id] ? ', dont ' + gain[l.p.id] + ' à la dernière partie' : ''));
      // Le même avatar que sur les cartes joueurs (photo ou emoji). Décoratif :
      // l'aria-label de la ligne dit déjà qui c'est.
      const av = GameAvatar.node(l.p.avatar, undefined, 'sm');
      av.setAttribute('aria-hidden', 'true');
      li.append(rang, av, nom, pts);
      return li;
    }));
    const caches = lignes.length - vues.length;
    // Aucune partie classée : pas de liste de zéros (elle repoussait le reste),
    // une ligne. Les lignes existent quand même dans le DOM, masquées.
    $('hub-score').classList.toggle('is-empty', !jeux.length);
    $('hub-score-note').textContent = !jeux.length
      ? 'Aucune partie jouée — les points tombent à la fin de chaque partie lancée depuis le Hub.'
      : `après ${jeux.length} partie${jeux.length > 1 ? 's' : ''} · dernière : ${info(derniere.gameId).title}`
        + (caches ? ` · +${caches} autre${caches > 1 ? 's' : ''}` : '');
  }

  // ------------------------------------------------------------- les jeux
  let sansJeu = null;          // aucun jeu possible au dernier rendu ?
  function renderPool(session, you) {
    const pool = session.pool;
    const moi = mine(session, you);
    const isHost = session.hostId === you;
    const max = session.constraints.maxMinutes;

    $('hub-dur-host').hidden = !isHost;
    const sel = $('hub-max-min');
    if (max && ![...sel.options].some((o) => o.value === String(max))) sel.add(new Option(max + ' min', String(max)));
    sel.value = max ? String(max) : '';
    sel.disabled = session.state === 'drawing';
    $('hub-dur-guest').textContent = isHost ? '' : (max ? `durée max : ${max} min · réglée par l'hôte` : 'durée : sans limite');

    const none = $('hub-none');
    if (pool.catalog !== 'ready') {
      $('hub-games-ok').replaceChildren();
      $('hub-games-out').replaceChildren();
      $('hub-out').hidden = true;
      $('hub-elig-count').textContent = '';
      none.hidden = false;
      none.textContent = pool.catalog === 'error'
        ? 'Le Hub n\'arrive pas à lire le catalogue des jeux. Il réessaiera au prochain tirage.'
        : 'Chargement du catalogue des jeux…';
      return;
    }
    const total = pool.eligible.reduce((s, id) => s + (pool.weights[id] || 0), 0);
    $('hub-elig-count').textContent = `· ${pool.eligible.length} possible${pool.eligible.length > 1 ? 's' : ''} sur ${pool.games.length}`;

    const fiches = pool.games.map((id) => {
      const g = info(id);
      const ok = pool.eligible.includes(id);
      const li = document.createElement('li');
      li.className = 'hub-game' + (ok ? '' : ' is-out');
      li.dataset.game = id;
      li.dataset.eligible = String(ok);

      const em = document.createElement('span');
      em.className = 'hub-game-emoji';
      em.setAttribute('aria-hidden', 'true');
      em.textContent = g.emoji;

      const main = document.createElement('div');
      main.className = 'hub-game-main';
      const t = document.createElement('p');
      t.className = 'hub-game-title';
      t.textContent = g.title;
      const meta = document.createElement('p');
      meta.className = 'hub-game-meta';
      meta.textContent = g.hub ? `${range(g.hub.players, 'joueurs')} · ${range(g.hub.minutes, 'min')}` : '';
      const st = document.createElement('p');
      st.className = 'hub-game-state';
      if (ok) {
        const pct = total > 0 ? Math.round((pool.weights[id] / total) * 100) : 0;
        st.textContent = `possible · chance ≈ ${pct} %` + (pool.health[id] === 'checking' ? ' · serveur en réveil…' : '');
      } else {
        // « se joue seul » dit déjà tout : inutile d'ajouter « 1 joueur maximum ».
        const why = pool.why[id] || [];
        const local = why.some((r) => r.code === 'LOCAL_ONLY');
        st.textContent = why.filter((r) => !(local && r.code === 'TOO_MANY'))
          .map((r) => GameHub.reasonText(r, (pid) => nameOf(session, pid))).join(' · ');
      }
      main.append(t, meta, st);
      const fans = session.players.filter((p) => p.love.includes(id)).map((p) => p.name);
      if (fans.length) {
        const lv = document.createElement('p');
        lv.className = 'hub-game-loves';
        lv.textContent = '❤️ ' + fans.join(', ');
        main.appendChild(lv);
      }

      const prefs = document.createElement('div');
      prefs.className = 'hub-game-prefs';
      const pref = (kind, emoji, label, on) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ghost hub-pref ' + kind;
        b.dataset.pref = kind;
        b.dataset.game = id;
        b.textContent = emoji;
        b.setAttribute('aria-pressed', String(on));
        b.setAttribute('aria-label', `${label} ${g.title}`);
        b.title = label + ' ' + g.title;
        return b;
      };
      prefs.append(pref('love', '❤️', 'J\'aime', moi.love.includes(id)), pref('veto', '🚫', 'Veto sur', moi.veto.includes(id)));
      li.append(em, main, prefs);
      return li;
    });
    // Les possibles d'abord, dans l'ordre du catalogue ; les autres dans un
    // <details> qui dit combien — ouvert, chaque fiche garde sa raison et ses
    // boutons ❤️ / 🚫 (c'est là qu'on lève son propre veto).
    const ok = fiches.filter((li) => li.dataset.eligible === 'true');
    const out = fiches.filter((li) => li.dataset.eligible !== 'true');
    $('hub-games-ok').replaceChildren(...ok);
    $('hub-games-out').replaceChildren(...out);
    const det = $('hub-out');
    det.hidden = !out.length;
    const miens = out.filter((li) => moi.veto.includes(li.dataset.game)).length;
    $('hub-out-sum').textContent = `${out.length} jeu${out.length > 1 ? 'x' : ''} indisponible${out.length > 1 ? 's' : ''} ce soir — pourquoi ?`
      + (miens ? ` (dont ${miens} par ton veto)` : '');
    // Plus AUCUN jeu possible : les raisons deviennent l'information principale,
    // on déplie (une fois, au passage à zéro — sans forcer qui l'a refermé).
    if (!ok.length && sansJeu !== true) det.open = true;
    sansJeu = !ok.length;

    none.hidden = pool.eligible.length > 0;
    none.textContent = pool.eligible.length ? '' : 'Aucun jeu possible pour ce groupe. Chaque jeu dit pourquoi dans la liste des indisponibles : '
      + 'un veto ne se lève que par la personne qui l\'a posé' + (max ? ', et l\'hôte peut relâcher la durée max' : '') + '.';
  }
  // ❤️ / 🚫 : on n'envoie que SES propres listes, relues dans l'état serveur.
  $('hub-games').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pref]');
    if (!b || !current) return;
    const id = b.dataset.game;
    const moi = mine(current.session, current.you);
    let love = moi.love.slice(), veto = moi.veto.slice();
    const bascule = (list, x) => (list.includes(x) ? list.filter((v) => v !== x) : list.concat(x));
    if (b.dataset.pref === 'love') { love = bascule(love, id); veto = veto.filter((v) => v !== id); }
    else { veto = bascule(veto, id); love = love.filter((v) => v !== id); }
    hub.setPrefs(love, veto);
  });
  $('hub-max-min').addEventListener('change', (e) => {
    const v = e.target.value;
    hub.setConstraints(v ? Number(v) : null);
  });

  // ----------------------------------------------------------------- caisse
  // ⚠️ Les classes de MISE EN SCÈNE d'un tirage (ouverte, révélée, un seul jeu,
  // lancement) ne doivent pas survivre à ce tirage. `is-launching` masque la
  // bande (display: none) : restée posée après un lancement annulé ou échoué,
  // le tirage suivant tournait sur une bande NON RENDUE — aucune transition,
  // cible calculée à 0 px, la bande apparaissait figée à la révélation.
  const MISE_EN_SCENE = ['is-pending', 'is-open', 'is-revealed', 'is-single', 'is-launching'];
  function renderDraw(session, you, round) {
    const d = session.draw;
    const stage = $('hub-draw');
    const actif = ['drawing', 'debrief', 'launching', 'inGame'].includes(session.state) && d;
    const hist = session.history.played;
    $('hub-history').textContent = hist.length ? 'Tirés ce soir : ' + hist.map((id, i) => `${i + 1}. ${info(id).title}`).join(' · ') : '';
    if (!actif) {
      if (!animating) { stage.hidden = true; stage.classList.remove(...MISE_EN_SCENE); }
      return;
    }
    stage.hidden = false;
    if (animating) return;                   // l'animation se termine, puis re-rend

    if (d.status === 'pending') {
      amene(d);
      stage.classList.remove(...MISE_EN_SCENE);
      stage.classList.add('is-pending');
      $('hub-result').hidden = true;
      HubCrate.reset($('hub-reel'));
      reelFor = null;
      $('hub-draw-status').textContent = 'La caisse est secouée… le Hub prépare le tirage.';
      return;
    }
    // Retour d'une partie classée : la carte Résultat prend la place de la
    // caisse, qui ne montrerait plus que le tirage d'AVANT la partie. La fiche
    // du jeu est tout de même tenue à jour (#hub-ready, lu par les tests et
    // par qui rechargerait), et la caisse ne rejoue jamais ce tirage.
    if (round) {
      seen.set(d.id);
      showResult(session, you, d);
      stage.hidden = true;
      return;
    }
    if (d.gameId && seen.get() !== d.id) return animate(d);
    showResult(session, you, d);
  }

  // ------------------------------------------------------ résultat de partie
  // ⚠️ AUCUN CALCUL ICI non plus : `round` sort de HubRecap.lastResult(), qui
  // relit la dernière entrée de history.games (rangs, points de partie, points
  // de soirée : ceux du Hub). null = pas de partie classée → pas de carte.
  //
  // L'arrivée (animation + focus sur le titre) n'a lieu qu'UNE fois par
  // partie et par onglet : au retour du jeu, ou quand le résultat tombe sous
  // les yeux de qui est resté au Hub. Un rechargement la retrouve telle quelle,
  // sans rien rejouer — même principe que `seen` pour la caisse.
  const ROUND_SEEN = 'mathys_hub_round';
  const roundSeen = {
    get() { try { return sessionStorage.getItem(ROUND_SEEN); } catch (_) { return null; } },
    set(id) { try { sessionStorage.setItem(ROUND_SEEN, id); } catch (_) {} },
  };
  let roundShown = null;       // drawId du résultat affiché dans cette page
  function renderRound(session, you, round) {
    const card = $('hub-round');
    const btn = $('hub-draw-btn');
    const barre = $('hub-act');
    // La carte Résultat porte sa propre suite (Tirage suivant / attente) : la
    // barre d'action, juste au-dessus, se tait pendant ce temps.
    barre.hidden = !!round;
    if (!round) {
      card.hidden = true;
      card.classList.remove('is-new');
      roundShown = null;
      // « Tirer » retourne à sa place, dans la barre d'action sous les joueurs.
      if (btn.parentNode !== barre) barre.insertBefore(btn, barre.firstChild);
      return;
    }
    const isHost = session.hostId === you;
    const host = session.players.find((p) => p.host);
    card.hidden = false;
    card.classList.toggle('is-solo', round.solo);
    card.dataset.game = round.gameId;
    card.dataset.draw = round.drawId;
    $('round-kicker').textContent = `Partie ${round.n} · terminée`;
    $('round-game').textContent = round.title;

    const me = $('round-me');
    me.replaceChildren();
    me.classList.toggle('is-out', !round.me);
    if (!round.me) me.textContent = 'Tu n\'as pas été classé dans cette partie.';
    else {
      me.append(round.solo ? 'Partie terminée · ' : `Tu termines ${HubRecap.ordinal(round.me.rank)}${round.me.tie ? ' ex æquo' : ''} · `,
        el('span', 'round-gain', `+${round.me.points} pts`));
    }

    $('round-list').replaceChildren(...round.rows.map((r) => {
      const li = el('li', 'round-row' + (r.me ? ' is-me' : ''));
      li.dataset.player = r.id;
      li.dataset.rank = String(r.rank);
      li.dataset.points = String(r.points);
      const medaille = r.rank >= 1 && r.rank <= 3;
      const rang = el('span', 'round-rank' + (medaille ? '' : ' is-num'), medaille ? MEDAILLES[r.rank - 1] : r.rank + '.');
      rang.setAttribute('aria-hidden', 'true');
      const av = GameAvatar.node(r.avatar, undefined, 'md');
      av.setAttribute('aria-hidden', 'true');
      const qui = el('span', 'round-who');
      const nom = el('span', 'round-name', r.name);
      if (r.me) nom.appendChild(el('small', 'hub-tag me', 'toi'));
      if (r.gone) nom.appendChild(el('small', 'hub-tag away', 'parti'));
      qui.appendChild(nom);
      if (round.gamePoints && r.gamePoints != null) qui.appendChild(el('span', 'round-game-pts', `${r.gamePoints} pts de partie`));
      const gain = el('span', 'round-gain-col');
      gain.append(el('b', null, '+' + r.points), el('small', null, 'pts de soirée'));
      li.setAttribute('aria-label', (round.solo ? '' : `${HubRecap.ordinal(r.rank)}${r.tie ? ' ex æquo' : ''} : `)
        + r.name + (r.me ? ' (toi)' : '') + (r.gone ? ' (parti)' : '')
        + (round.gamePoints && r.gamePoints != null ? `, ${r.gamePoints} points de partie` : '')
        + `, plus ${r.points} points de soirée`);
      li.append(rang, av, qui, gain);
      return li;
    }));

    $('round-total').textContent = round.me
      ? `Ajouté au score de la soirée : tu as maintenant ${round.total} pts.`
      : `Ton score de la soirée : ${round.total} pts.`;

    // La suite, juste sous le résultat : le VRAI bouton de tirage chez l'hôte
    // (même élément, même écouteur, affiché ou non par renderFoot), l'attente
    // chez les autres.
    const actions = $('round-actions');
    if (isHost) { if (btn.parentNode !== actions) actions.insertBefore(btn, actions.firstChild); }
    else if (btn.parentNode !== barre) barre.insertBefore(btn, barre.firstChild);
    $('round-wait').hidden = isHost;
    $('round-wait').textContent = isHost ? '' : `En attente ${host ? de(host.name) : 'de l\'hôte'} pour le tirage suivant.`;

    if (roundShown === round.drawId) return;
    roundShown = round.drawId;
    const neuf = roundSeen.get() !== round.drawId;
    card.classList.remove('is-new');
    if (!neuf) return;
    roundSeen.set(round.drawId);
    void card.offsetWidth;                     // relance l'animation si une carte précédente l'avait
    card.classList.add('is-new');
    // Le focus va au titre (annoncé avec la phrase du joueur, aria-describedby).
    // Saut immédiat : un défilement animé avalerait le clic suivant (voir showRecap).
    // ⚠️ Un tour plus tard : au retour du jeu, ce premier rendu a lieu AVANT
    // show('lobby') — le salon est encore caché, et un élément caché ne prend
    // pas le focus.
    setTimeout(() => {
      if (card.hidden || $('lobby').hidden) return;
      card.scrollIntoView({ block: 'start', behavior: 'instant' });
      $('round-title').focus({ preventScroll: true });
    }, 0);
  }

  // Le serveur a tiré : on déroule la bande jusqu'à SON jeu, puis on révèle.
  // Un seul jeu possible (HubCrate.single) : pas de bande, pas de faux
  // suspense — la caisse s'ouvre directement sur lui. Le jeu reste celui que
  // le serveur a tiré ; seule la mise en scène change.
  let revele = null;           // id du tirage qui vient d'être révélé ICI (arrivée animée une fois)
  function animate(d) {
    const stage = $('hub-draw');
    const seul = HubCrate.single(d.eligible, d.gameId);
    animating = d.id;
    amene(d);
    // ⚠️ Un seul jeu : la fiche arrive TOUT DE SUITE, alors que le défilement
    // doux lancé pendant « pending » court encore. « Continuer » bougerait sous
    // le doigt et le clic tomberait à côté (le piège de showRecap, attrapé par
    // handoff-play.mjs) : un saut immédiat interrompt ce défilement.
    if (seul) $('hub-draw').scrollIntoView({ block: 'start', behavior: 'instant' });
    stage.classList.remove(...MISE_EN_SCENE);
    stage.classList.add('is-open');
    stage.classList.toggle('is-single', seul);
    $('hub-result').hidden = true;
    $('hub-draw-status').textContent = seul ? 'Un seul jeu possible pour ce groupe : pas de tirage à faire.' : 'La caisse s\'ouvre…';
    reelFor = d.id;
    HubCrate.spin($('hub-reel'), { eligible: d.eligible, winnerId: d.gameId, info, reduced: reduced() }).then(() => {
      seen.set(d.id);
      animating = null;
      revele = d.id;
      if (current) render(current.session, current.you);
      const c = $('hub-continue');
      if (!c.hidden && !$('hub-result').hidden) c.focus();
    });
  }

  function showResult(session, you, d) {
    const stage = $('hub-draw');
    const seul = HubCrate.single(d.eligible, d.gameId);
    stage.classList.remove('is-pending');
    stage.classList.add('is-open', 'is-revealed');
    stage.classList.toggle('is-single', seul);
    // Pendant le lancement, la fiche se resserre : le bloc « Ouvrir /
    // Rejoindre » juste dessous devient l'information principale.
    stage.classList.toggle('is-launching', session.state === 'launching' || session.state === 'inGame');
    // Rechargement : la bande n'a pas été déroulée ici, on la pose à l'arrivée.
    if (reelFor !== d.id) {
      HubCrate.spin($('hub-reel'), { eligible: d.eligible, winnerId: d.gameId, info, reduced: true });
      reelFor = d.id;
    }
    const g = info(d.gameId);
    $('result-emoji').textContent = g.emoji;
    $('result-title').textContent = g.title;
    $('result-tag').textContent = g.tagline;
    $('result-players').textContent = g.hub ? range(g.hub.players) : '—';
    $('result-minutes').textContent = g.hub ? range(g.hub.minutes, 'min') : '—';
    // 🎲 et pas 🎯 : 🎯 est l'emoji de Précision ET du Demi-Cercle — au-dessus
    // de leur fiche, on lisait deux fois la même cible. Le dé est celui du
    // bouton « 🎲 Tirer un jeu ». Un seul jeu possible : rien n'a été tiré, pas de dé.
    $('result-kicker').textContent = seul ? 'Seul jeu possible ce soir' : '🎲 Jeu tiré';
    const res = $('hub-result');
    res.hidden = false;
    res.dataset.game = d.gameId;
    // L'arrivée (courte, jamais bloquante) : seulement juste après la caisse,
    // pas au rechargement ni aux rendus suivants.
    res.classList.remove('is-new');
    if (revele === d.id) { revele = null; void res.offsetWidth; res.classList.add('is-new'); }
    // Dit une fois pour les lecteurs d'écran ; à l'écran, le titre suffit
    // (la ligne est masquée visuellement une fois le jeu révélé).
    const dit = point(seul ? `Seul jeu possible : ${g.title}` : `Jeu tiré : ${g.title}`);
    if ($('hub-draw-status').textContent !== dit) $('hub-draw-status').textContent = dit;

    const isHost = session.hostId === you;
    const host = session.players.find((p) => p.host);
    const drawn = d.status === 'drawn';
    const lancable = !!(g.hub && g.hub.handoff);
    $('hub-continue').hidden = !(drawn && isHost);
    $('hub-continue').textContent = lancable ? `▶ Continuer — lancer ${g.title}` : 'Continuer';
    $('hub-continue-wait').textContent = drawn && !isHost
      ? point(`⏳ En attente ${host ? de(host.name) : 'de l\'hôte'} pour ${lancable ? 'lancer ' + g.title : 'continuer'}`) : '';
    // Après « continuer » : le bloc de lancement prend le relais pour un jeu
    // lançable ; sinon (ou une fois la partie finie) on le dit ici.
    const l = session.launch;
    const fini = l && l.drawId === d.id && l.stage === 'ended';
    $('hub-ready').hidden = drawn || session.state !== 'debrief';
    $('hub-ready').textContent = fini ? `✅ Partie ${de(g.title)} terminée. Prochain tirage quand l'hôte veut.`
      : `✅ ${g.title} est retenu. Ce jeu ne se lance pas encore depuis le Hub : ouvrez-le depuis le portfolio.`;
  }

  // ------------------------------------------------------------ lancement
  // Le jeu tiré se lance : l'hôte ouvre le jeu (qui crée la room), puis chacun
  // clique « Rejoindre ». La page n'envoie RIEN au Hub ici : elle écrit un
  // billet (sessionStorage) et navigue — c'est la page du jeu, reconnectée au
  // Hub avec le même player.id, qui déclare la room (hub-handoff.js).
  let compte = 0;
  let montreLancement = null;
  // « À toi » : le titre de l'onglet le dit aussi (utile quand on a quitté
  // l'onglet des yeux pendant que l'hôte créait la partie). Rendu tel quel dès
  // qu'il n'y a plus rien à faire.
  const TITRE_PAGE = document.title;
  const onglet = (action) => {
    const t = action ? `▶ ${action} · Game Hub` : TITRE_PAGE;
    if (document.title !== t) document.title = t;
  };
  let focusLancement = null;   // « tirage:étape » pour lequel le focus a déjà été amené
  function renderLaunch(session, you) {
    const l = session.launch;
    const g = l ? info(l.gameId) : null;
    const isHost = session.hostId === you;
    const echec = $('hub-failed');
    echec.hidden = !(l && l.stage === 'failed' && session.state === 'lobby');
    if (!echec.hidden) {
      // Une annulation voulue n'est pas un échec (« a échoué : l'hôte a annulé
      // le lancement » disait deux fois la même chose, et de travers).
      echec.textContent = (l.reason === 'CANCELLED'
        ? `Lancement ${de(g.title)} annulé${isHost ? '' : ' par l\'hôte'}. `
        : `Le lancement ${de(g.title)} a échoué : ${GameHub.launchFailureText(l.reason)}. `)
        + (isHost ? 'Tu peux relancer un tirage.' : 'L\'hôte peut relancer un tirage.');
    }
    const box = $('hub-launch');
    const actif = l && ['create', 'join', 'playing'].includes(l.stage) && ['launching', 'inGame'].includes(session.state);
    box.hidden = !actif;
    clearInterval(compte);
    if (!actif) { box.classList.remove('is-your-turn'); onglet(null); return; }

    const hote = l.hostId === you;
    const hostName = nameOf(session, l.hostId);
    const dedans = l.entered.includes(you);
    let titre = '', texte = '', bouton = null;
    if (l.stage === 'create') {
      titre = hote ? `À toi de créer la partie : ${g.title}` : `${hostName} crée la partie ${g.title}…`;
      texte = hote ? 'Ouvre le jeu : la partie se crée toute seule, et ton groupe reçoit son code.'
        : 'Le bouton pour rejoindre apparaît dès que la partie existe.';
      if (hote) bouton = `▶ Ouvrir ${g.title}`;
    } else if (l.stage === 'join') {
      titre = `${g.title} est prêt — code ${l.roomCode}`;
      if (dedans) { texte = 'Tu es dans la partie.'; bouton = `Revenir ${au(g.title)}`; }
      else if (l.failed[you]) { texte = `Tu n'as pas pu entrer : ${l.failed[you]}.`; bouton = 'Réessayer'; }
      else { texte = 'À toi : clique pour rejoindre la partie de ton groupe.'; bouton = `▶ Rejoindre ${g.title}`; }
    } else {
      titre = `Partie ${de(g.title)} en cours — code ${l.roomCode}`;
      if (dedans) { bouton = `Revenir ${au(g.title)}`; }
      else texte = l.missed.includes(you) ? 'La partie a commencé sans toi. Tu joueras au prochain tirage.' : '';
    }
    // #launch-title est role="status" : on ne le réécrit que s'il change, pour
    // qu'un rendu identique (chaque état du Hub) ne soit pas ré-annoncé.
    if ($('launch-title').textContent !== titre) $('launch-title').textContent = titre;
    const go = $('launch-go');
    go.hidden = !bouton;
    if (bouton && go.textContent !== bouton) go.textContent = bouton;
    // L'action attendue DE CE JOUEUR (ouvrir, rejoindre, réessayer) — pas
    // « Revenir », qui n'est qu'un raccourci.
    const aToi = !!bouton && !dedans && (l.stage === 'create' || l.stage === 'join');
    box.classList.toggle('is-your-turn', aToi);
    onglet(aToi ? bouton.replace(/^▶ /, '') : null);
    $('launch-end').hidden = !((hote || isHost) && l.stage !== 'create');
    $('launch-cancel').hidden = !((hote || isHost) && (l.stage === 'create' || l.stage === 'join'));

    // Le délai restant, pour qu'on sache que rien n'est bloqué.
    const t0 = Date.now();
    const majTexte = () => {
      const reste = l.expiresInMs == null ? null : Math.max(0, Math.round((l.expiresInMs - (Date.now() - t0)) / 1000));
      $('launch-text').textContent = texte + (reste != null && l.stage !== 'playing'
        ? ` (${l.stage === 'create' ? 'annulé' : 'lancé sans les retardataires'} dans ${reste} s)` : '');
    };
    majTexte();
    if (l.expiresInMs != null) compte = setInterval(majTexte, 1000);

    // Qui est où.
    $('launch-list').replaceChildren(...l.expected.map((id) => {
      const li = document.createElement('li');
      li.dataset.player = id;
      const p = session.players.find((x) => x.id === id);
      const nom = document.createElement('span');
      nom.textContent = p ? p.name : '?';
      const tg = document.createElement('span');
      const etat = l.entered.includes(id) ? ['dans la partie', 'in'] : l.failed[id] ? ['échec', 'out']
        : l.missed.includes(id) ? ['manqué', 'out'] : ['attendu', 'wait'];
      tg.className = 'launch-tag ' + etat[1];
      tg.textContent = etat[0];
      li.append(GameAvatar.node(p ? p.avatar : null, undefined, 'sm'), nom, tg);
      return li;
    }));

    // Le code vient d'arriver : on amène le bouton « Rejoindre » à l'écran.
    if (l.stage === 'join' && !dedans && montreLancement !== l.drawId) {
      montreLancement = l.drawId;
      box.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' });
    }
    // Le focus rejoint le bouton qui attend CE joueur — une fois par étape, et
    // seulement s'il n'était nulle part (ou sur « Continuer », qui vient de
    // disparaître) : on ne l'arrache jamais à quelqu'un qui fait autre chose.
    const cle = l.drawId + ':' + l.stage;
    if (aToi && focusLancement !== cle) {
      focusLancement = cle;
      const a = document.activeElement;
      if (!a || a === document.body || a === $('hub-continue') || a.closest('[hidden]')) {
        // Un tour plus tard : au premier rendu d'une reprise, le salon est encore caché.
        setTimeout(() => {
          if (go.hidden || box.hidden || $('lobby').hidden) return;
          const r = go.getBoundingClientRect();
          // Hors de l'écran (l'hôte, au téléphone) : saut immédiat, pas animé —
          // un défilement doux avale le clic qui suit (voir showRecap).
          if (r.top < 0 || r.bottom > innerHeight) go.scrollIntoView({ block: 'center', behavior: 'instant' });
          go.focus({ preventScroll: true });
        }, 0);
      }
    }
  }

  // Ouvrir / rejoindre : un billet, puis la page du jeu, DANS CET ONGLET. Le
  // billet ne porte que ce qu'il faut pour se reconnecter au Hub et retrouver
  // CE lancement ; le rôle n'est qu'une indication — c'est le Hub qui décide
  // qui peut déclarer un code (l'hôte du lancement, par son socket).
  $('launch-go').addEventListener('click', () => {
    if (!current) return;
    const { session, you } = current;
    const l = session.launch;
    if (!l || !l.url) return;
    HubHandoff.write({ hub: HUB_URL, session: session.code, playerId: you, drawId: l.drawId, gameId: l.gameId,
      role: l.hostId === you ? 'host' : 'guest' });
    location.href = new URL('../' + l.url, location.href).href;
  });
  $('launch-cancel').addEventListener('click', () => {
    if (current && current.session.launch) hub.abort(current.session.launch.drawId, 'CANCELLED');
  });
  $('launch-end').addEventListener('click', () => {
    if (current && current.session.launch) hub.ended(current.session.launch.drawId);
  });

  // ----------------------------------------------- action principale + pied
  function renderFoot(session, you) {
    const isHost = session.hostId === you;
    // Un invité n'a pas de bouton : sa phrase prend la place, en encart.
    $('hub-act').classList.toggle('is-waiting', !isHost);
    const host = session.players.find((p) => p.host);
    const hostName = host ? host.name : 'l\'hôte';
    const btn = $('hub-draw-btn');
    const pool = session.pool;
    if (!pool) {
      btn.hidden = true;
      $('hub-wait').textContent = 'Le Hub en ligne n\'a pas encore le tirage des jeux : il arrive avec sa prochaine mise à jour.';
      return;
    }
    const libre = session.state === 'lobby' || session.state === 'debrief';
    btn.hidden = !isHost || !libre;
    // Terminer la soirée (pour TOUT le monde) : l'hôte seul, au salon seulement
    // — le serveur refuse aussi pendant un tirage, un lancement ou une partie.
    $('hub-finish').hidden = !isHost || !libre;
    if (session.state === 'launching' || session.state === 'inGame') {
      const g = session.launch ? info(session.launch.gameId).title : 'le jeu';
      $('hub-wait').textContent = session.state === 'launching' ? `Lancement ${de(g)} en cours.` : `Partie ${de(g)} en cours.`;
      return;
    }
    btn.textContent = session.history.played.length ? '🎲 Tirage suivant' : '🎲 Tirer un jeu';
    $('hub-finish').disabled = false;
    btn.disabled = pool.catalog !== 'ready' || !pool.eligible.length;
    if (session.state === 'drawing') {
      // Une fois le jeu révélé, l'encart ne dit plus « tirage en cours » : la
      // suite est dans la fiche du jeu, juste en dessous.
      const tire = session.draw && session.draw.status === 'drawn';
      $('hub-wait').textContent = tire ? (isHost ? 'Jeu tiré : la suite est juste en dessous.' : `${hostName} a tiré le jeu de la soirée.`)
        : isHost ? 'Tirage en cours.' : `${hostName} a lancé le tirage.`;
    } else if (isHost) {
      $('hub-wait').textContent = pool.eligible.length ? 'Tu es l\'hôte : c\'est toi qui tires.' : 'Tu es l\'hôte. Aucun jeu n\'est possible pour l\'instant.';
    } else {
      $('hub-wait').textContent = `⏳ En attente ${host ? de(host.name) : 'de l\'hôte'} — c'est l'hôte qui tire le jeu.`;
    }
  }

  $('hub-draw-btn').addEventListener('click', () => { $('hub-lobby-msg').textContent = ''; hub.draw(); });
  $('hub-continue').addEventListener('click', () => hub.confirm());

  hub.on('session', ({ session, you }) => {
    store.set(session.code);
    render(session, you);
    show('lobby');
  });

  hub.on('status', (s) => {
    const c = $('hub-conn');
    c.classList.toggle('is-away', s === 'reconnecting');
    c.classList.toggle('is-off', s === 'ended' || s === 'idle');
    c.textContent = s === 'reconnecting' ? 'connexion perdue — reconnexion…'
      : s === 'in-session' ? 'connecté' : 'déconnecté';
    renderMe();
  });

  // La session est finie pour ce client : disparue pendant une reprise,
  // reprise dans un autre onglet (REPLACED), ou réseau définitivement perdu.
  hub.on('ended', (err) => {
    // Pendant une reconnexion, la soirée a été terminée : le refus porte le podium.
    if (err && err.finale) return showFinale(err.finale, GameProfile.load().id);
    store.clear();
    show('entry');
    say('');
    warn(err && err.text ? err.text : 'Session terminée.');
    renderMe();
  });

  hub.on('error', (err) => {
    // Une erreur hors create/join (un tirage refusé, par exemple) : on la dit
    // là où l'on est. Pour « aucun jeu possible », la liste dit déjà pourquoi.
    if (!$('lobby').hidden) $('hub-lobby-msg').textContent = '> ' + err.text;
    else warn(err.text);
  });

  $('hub-leave').addEventListener('click', () => {
    // Le débrief est construit sur le DERNIER état reçu du Hub, avant de le
    // lâcher. Rien n'est redemandé au serveur, et le départ reste un leave.
    const recap = current ? HubRecap.build(current.session, current.you, info) : null;
    hub.leave();
    store.clear();
    current = null;
    $('hub-lobby-msg').textContent = '';
    show('entry');
    warn('');
    say('Tu as quitté la session.');
    renderMe();
    if (recap) showRecap(recap, 'leave');
  });

  // ---------------------------------------------------- terminer la soirée
  // L'hôte termine la soirée pour tout le monde : confirmation obligatoire
  // (un <dialog> natif : focus piégé, Échap = annuler). Le serveur répond par
  // la finale, à tous — c'est elle qui ouvre le podium, pas ce clic.
  const dlg = $('finish-dialog');
  $('hub-finish').addEventListener('click', () => {
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else if (window.confirm('Terminer la soirée ? Tous les joueurs verront le podium final et la session ne pourra plus continuer.')) confirmerFin();
  });
  $('finish-cancel').addEventListener('click', () => dlg.close());
  function confirmerFin() {
    $('hub-finish').disabled = true;            // un seul envoi ; le serveur est idempotent de toute façon
    if (!hub.finish()) {
      $('hub-finish').disabled = false;
      $('hub-lobby-msg').textContent = '> Connexion au Hub perdue : réessaie dans un instant.';
    }
  }
  $('finish-confirm').addEventListener('click', () => { dlg.close(); confirmerFin(); });

  // La finale : en direct (message du serveur), après un rechargement ou en
  // revenant (refus SESSION_CLOSED qui porte le podium). Toujours le podium
  // FIGÉ par le Hub, jamais recalculé ici.
  function showFinale(finale, you) {
    store.clear();
    current = null;
    try { if (dlg.open) dlg.close(); } catch (_) {}
    show('entry');
    $('entry').hidden = true;                   // le podium d'abord ; l'accueil après
    warn(''); say('');
    showRecap(HubRecap.fromFinale(finale, you, info), 'finale');
  }
  hub.on('finale', ({ finale, you }) => showFinale(finale, you));
  $('recap-home').addEventListener('click', () => {
    clearReveal();
    show('entry');
    say('La soirée est terminée. À la prochaine !');
    renderMe();
    $('hub-create').focus();
  });

  // ------------------------------------------------------ débrief de soirée
  // Affiché en quittant une session où au moins une partie a été classée, au-
  // dessus de l'écran d'entrée : la suite (créer, rejoindre) est juste dessous.
  // Tout vient de HubRecap.build(), donc du Hub ; rien n'est recalculé ici.
  // La RÉVÉLATION du podium final : « Soirée terminée », un temps, puis la
  // marche du 3e, du 2e, du 1er (par RANG : des ex æquo partagent leur marche
  // et apparaissent ensemble ; un rang absent — 1, 1, 3 — n'a pas de marche,
  // il est simplement sauté), puis le reste. Tout est déjà dans le DOM : une
  // connexion lente n'y change rien, seule la mise en scène attend (~3 s en
  // tout). Mouvement réduit : tout est là tout de suite, rien n'est retenu.
  const REVEAL_FIRST = 900, REVEAL_STEP = 850;
  let revealTimers = [];
  function clearReveal() {
    revealTimers.forEach(clearTimeout);
    revealTimers = [];
    $('hub-recap').classList.remove('is-revealing');
    $('recap-ranking').removeAttribute('aria-busy');
  }
  // La phrase des lecteurs d'écran, à la fin : le collectif, puis toi.
  function annonceFinale(r) {
    const tops = r.ranking.filter((l) => l.rank === 1 && l.pts > 0).map((l) => l.name);
    const p = r.place;
    const toi = p && !r.solo && tops.length ? ` Ta place finale : ${HubRecap.ordinal(p.rank)}${p.tie ? ' ex æquo' : ''} sur ${p.of}, ${nbPts(p.pts)}.` : '';
    return (!tops.length ? 'Aucun point marqué ce soir.'
      : (tops.length > 1 ? 'Vainqueurs de la soirée, à égalité : ' : 'Vainqueur de la soirée : ') + tops.join(', ') + '.') + toi;
  }
  function reveler(r) {
    const sec = $('hub-recap');
    const marches = [...sec.querySelectorAll('#recap-ranking .recap-step')];
    const rows = [...sec.querySelectorAll('#recap-ranking .recap-row')];
    const reste = [...sec.querySelectorAll('#recap-ranking .recap-rest, .recap-later')];
    const annonce = () => { $('recap-live').textContent = annonceFinale(r); };
    if (reduced()) { annonce(); return; }
    sec.classList.add('is-revealing');
    $('recap-ranking').setAttribute('aria-busy', 'true');
    [...marches, ...rows, ...reste].forEach((x) => x.classList.remove('is-shown'));
    // Une marche se montre avec ses joueurs (les lignes portent aussi la
    // classe : c'est elles que les tests et la transition regardent).
    const montre = (m) => { m.classList.add('is-shown'); m.querySelectorAll('.recap-row').forEach((x) => x.classList.add('is-shown')); };
    let t = REVEAL_FIRST;
    for (const k of [3, 2, 1]) {
      const groupe = marches.filter((x) => Number(x.dataset.rank) === k);
      if (!groupe.length) continue;
      revealTimers.push(setTimeout(() => groupe.forEach(montre), t));
      t += REVEAL_STEP;
    }
    revealTimers.push(setTimeout(() => {
      [...marches, ...rows, ...reste].forEach((x) => x.classList.add('is-shown'));
      clearReveal();
      annonce();
    }, t));
  }
  const nbPts = (n) => `${n} point${n > 1 ? 's' : ''}`;

  const el = (tagName, cls, text) => {
    const n = document.createElement(tagName);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  //   mode 'leave'  : ton récap, en quittant (l'entrée reste juste dessous) ;
  //   mode 'finale' : la soirée terminée par l'hôte, pour tous — révélée.
  function showRecap(r, mode) {
    const finale = mode === 'finale';
    clearReveal();
    $('hub-recap').classList.toggle('is-final', finale);
    $('recap-code').textContent = r.code;
    $('recap-title').textContent = finale ? '🏆 Soirée terminée' : '📋 Ton récap de soirée';
    const moi = r.ranking.find((l) => l.me);
    $('recap-sub').textContent = finale
      ? (r.by && moi && r.by === moi.id ? 'Tu as terminé la soirée. Voici le podium final.' : `${r.byName || 'L\'hôte'} a terminé la soirée. Voici le podium final.`)
      : r.othersOnline
        ? 'Tu as quitté la session — elle continue pour les autres. Classement au moment de ton départ.'
        : `Tu as quitté la session. ${r.facts.count} partie${r.facts.count > 1 ? 's' : ''} au compteur. Merci d'avoir joué !`;
    $('recap-next').hidden = finale;
    $('recap-home').hidden = !finale;
    $('recap-live').textContent = '';

    const personne = r.ranking.every((l) => l.pts === 0);
    // Une ligne joueur : médaille, avatar, nom, points. La même dans le récap
    // (liste) et dans la finale (sur sa marche) ; seule la mise en page change.
    const ligne = (l, taille) => {
      const li = el('li', 'recap-row' + (l.me ? ' is-me' : '') + (l.rank === 1 && !personne ? ' is-top' : ''));
      li.dataset.player = l.id;
      li.dataset.rank = String(l.rank);
      li.dataset.points = String(l.pts);
      const medaille = !personne && l.pts > 0 && l.rank <= 3;
      const rang = el('span', 'recap-rank' + (medaille ? '' : ' is-num'), medaille ? MEDAILLES[l.rank - 1] : l.rank + '.');
      rang.setAttribute('aria-hidden', 'true');
      const av = GameAvatar.node(l.avatar, undefined, taille);
      av.setAttribute('aria-hidden', 'true');
      const nom = el('span', 'recap-name', l.name);
      if (l.me) nom.appendChild(el('small', 'hub-tag me', 'toi'));
      if (l.gone) nom.appendChild(el('small', 'hub-tag away', 'parti'));
      const pts = el('span', 'recap-pts', String(l.pts));
      pts.appendChild(el('small', null, 'pts'));
      const egal = r.ranking.filter((x) => x.rank === l.rank).length > 1;
      li.setAttribute('aria-label', `${HubRecap.ordinal(l.rank)}${egal ? ' ex æquo' : ''} : ${l.name}${l.me ? ' (toi)' : ''}${l.gone ? ' (parti)' : ''}, ${nbPts(l.pts)}`);
      li.append(rang, av, nom, pts);
      return li;
    };
    const liste = $('recap-ranking');
    const marches = finale && r.podium ? r.podium.steps : [];
    liste.classList.toggle('is-podium', marches.length > 0);
    // Des ex æquo sur une marche : au téléphone, les marches s'empilent.
    liste.classList.toggle('is-crowded', marches.some((s) => s.players.length > 1));
    if (marches.length) {
      // LA FINALE : une marche par rang (ordre du DOM = ordre des rangs, lu
      // tel quel sans CSS ; c'est le CSS qui pose le 2e à gauche, le 1er au
      // centre, le 3e à droite). Le socle est décoratif : chaque ligne dit son
      // rang (aria-label), la médaille et la couleur ne portent rien seules.
      liste.setAttribute('aria-label', 'podium final de la soirée');
      const items = marches.map((s) => {
        const li = el('li', 'recap-step' + (s.tie ? ' is-tie' : ''));
        li.dataset.rank = String(s.rank);
        li.style.setProperty('--n', String(s.players.length));   // une marche s'élargit avec ses ex æquo
        const socle = el('p', 'recap-plinth');
        socle.setAttribute('aria-hidden', 'true');
        socle.append(el('span', 'recap-plinth-n', HubRecap.ordinal(s.rank)));
        if (s.tie) socle.append(el('small', 'recap-plinth-tie', 'ex æquo'));
        const qui = el('ul', 'recap-step-players');
        qui.append(...s.players.map((l) => ligne(l, s.rank === 1 ? 'lg' : 'md')));
        li.append(socle, qui);
        return li;
      });
      if (r.podium.rest.length) {
        const reste = el('li', 'recap-rest');
        const ul = el('ul', 'recap-rest-list');
        ul.setAttribute('aria-label', 'la suite du classement');
        ul.append(...r.podium.rest.map((l) => ligne(l, 'sm')));
        reste.append(ul);
        items.push(reste);
      }
      liste.replaceChildren(...items);
    } else {
      liste.setAttribute('aria-label', 'classement de la soirée');
      liste.replaceChildren(...r.ranking.map((l) => ligne(l, l.rank === 1 && !personne ? 'lg' : 'md')));
    }

    // TA place finale (finale seulement) : après le podium collectif, avant
    // les chiffres. Pas en solo (« 1er sur 1 » n'apprend rien), pas si
    // personne n'a marqué.
    const p = finale && !r.solo && !personne ? r.place : null;
    $('recap-me').hidden = !p;
    if (p) {
      $('recap-me-rank').textContent = HubRecap.ordinal(p.rank) + (p.tie ? ' ex æquo' : '');
      $('recap-me-of').textContent = `sur ${p.of}`;
      $('recap-me-pts').textContent = String(p.pts);
      $('recap-me').classList.toggle('is-first', p.rank === 1);
    }

    const f = r.facts;
    $('recap-count').textContent = String(f.count);
    // Finale : le chiffre PUIS son libellé, lus comme une phrase (« 1 partie
    // jouée ») ; récap : un intitulé de colonne, au-dessus du chiffre.
    $('recap-count-label').textContent = !finale ? 'Parties jouées' : f.count > 1 ? 'parties jouées' : 'partie jouée';
    $('recap-last').textContent = f.last ? `${f.last.emoji} ${f.last.title}` : '—';
    $('recap-gain').textContent = f.lastGain == null ? '—' : '+' + f.lastGain + ' pts';

    $('hub-recap').classList.toggle('is-solo', r.solo);
    const aucune = !r.games.length;
    $('recap-empty').hidden = !aucune;
    document.querySelectorAll('#hub-recap .recap-games-head, #hub-recap .recap-game-cols').forEach((x) => { x.hidden = aucune; });
    $('recap-games').hidden = aucune;
    $('recap-games').replaceChildren(...r.games.map((g) => {
      const li = el('li', 'recap-game');
      li.dataset.game = g.gameId;
      li.dataset.n = String(g.n);
      const jeu = el('span', 'recap-game-title');
      jeu.append(el('span', 'recap-game-n', g.n + '.'), el('span', 'recap-game-emoji', g.emoji), el('span', null, g.title));
      jeu.querySelector('.recap-game-emoji').setAttribute('aria-hidden', 'true');
      const gagne = el('span', 'recap-game-win', g.winners.length ? '🏆 ' + g.winners.map((w) => w.name + (w.me ? ' (toi)' : '')).join(', ') : 'personne de classé');
      const toi = el('span', 'recap-game-me', g.me ? HubRecap.place(g.me.rank) : '—');
      toi.title = g.me ? 'ta place' : 'pas classé';
      const pts = el('span', 'recap-game-pts', g.me ? '+' + g.me.points : '');
      li.append(jeu, gagne, toi, pts);
      return li;
    }));

    $('hub-recap').hidden = false;
    if (finale) reveler(r);
    // Un changement d'écran, pas un déplacement dans la page : saut immédiat.
    // (Animé, le défilement continuait sous le doigt de qui cliquait déjà
    // « Créer une session » juste dessous — mesuré par tests/hub-score.mjs.)
    // ⚠️ 'instant' et pas 'auto' : 'auto' suit le `scroll-behavior: smooth` de
    // tf2.css, donc reste animé.
    $('hub-recap').scrollIntoView({ block: 'start', behavior: 'instant' });
    // Le bouton cliqué (Quitter, Terminer) vient de disparaître avec le salon :
    // sans ça le focus retombait sur <body>. Le titre est annoncé à sa place.
    $('recap-title').focus({ preventScroll: true });
  }

  // Copier le code : exactement celui reçu du serveur.
  $('hub-code').addEventListener('click', async () => {
    const hint = $('hub-code-hint');
    const back = () => setTimeout(() => { hint.textContent = 'clique sur le code pour le copier'; }, 2000);
    try {
      await navigator.clipboard.writeText(hub.code || $('hub-code').textContent.trim());
      hint.textContent = 'code copié ✔';
    } catch (_) {
      hint.textContent = 'copie impossible — recopie le code à la main';
    }
    back();
  });

  // ----------------------------------------------------------------- démarrage
  renderMe();
  if (!GameProfile.load().name) openEditor(true);

  // Un rechargement dans une session en cours : on reprend sa place.
  const resume = store.get();
  if (resume && GameProfile.load().name) {
    say('Reprise de ta session ' + resume + '…');
    hub.join(resume, GameHub.playerFrom(GameProfile.load())).then(() => say(''), (e) => {
      store.clear();
      say('');
      // Soirée terminée pendant qu'on n'était pas là (ou rechargement juste
      // après) : pas de reprise, mais le podium, si on en faisait partie.
      if (e.finale) return showFinale(e.finale, GameProfile.load().id);
      warn(e.code === 'SESSION_NOT_FOUND' || e.code === 'SESSION_CLOSED'
        ? 'Ta session précédente n\'existe plus.' : e.message);
      renderMe();
    });
  }
})();
