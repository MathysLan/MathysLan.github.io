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
  const show = (id) => { $('entry').hidden = id !== 'entry'; $('lobby').hidden = id !== 'lobby'; $('hub-score').hidden = id !== 'lobby';
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
    const v = $('name-input').value.trim();
    if (v && v !== GameProfile.load().name) GameProfile.setName(v);
  }

  function renderMe() {
    const p = GameProfile.load();
    const typed = $('name-input').value.trim();
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
      return li;
    }));

  }

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
  // « de Le Passeur » → « du Passeur », « à Le Passeur » → « au Passeur ».
  const de = (t) => (/^Le /.test(t) ? 'du ' + t.slice(3) : /^Les /.test(t) ? 'des ' + t.slice(4) : 'de ' + t);
  const au = (t) => (/^Le /.test(t) ? 'au ' + t.slice(3) : /^Les /.test(t) ? 'aux ' + t.slice(4) : 'à ' + t);
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
  function renderDraw(session, you, round) {
    const d = session.draw;
    const stage = $('hub-draw');
    const actif = ['drawing', 'debrief', 'launching', 'inGame'].includes(session.state) && d;
    const hist = session.history.played;
    $('hub-history').textContent = hist.length ? 'Tirés ce soir : ' + hist.map((id, i) => `${i + 1}. ${info(id).title}`).join(' · ') : '';
    if (!actif) {
      if (!animating) { stage.hidden = true; stage.classList.remove('is-pending', 'is-open'); }
      return;
    }
    stage.hidden = false;
    if (animating) return;                   // l'animation se termine, puis re-rend

    if (d.status === 'pending') {
      amene(d);
      stage.classList.add('is-pending');
      stage.classList.remove('is-open');
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
    $('round-wait').textContent = isHost ? '' : `En attente de ${host ? host.name : 'l\'hôte'} pour le tirage suivant.`;

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
  function animate(d) {
    const stage = $('hub-draw');
    animating = d.id;
    amene(d);
    stage.classList.remove('is-pending');
    stage.classList.add('is-open');
    $('hub-result').hidden = true;
    $('hub-draw-status').textContent = 'La caisse s\'ouvre…';
    reelFor = d.id;
    HubCrate.spin($('hub-reel'), { eligible: d.eligible, winnerId: d.gameId, info, reduced: reduced() }).then(() => {
      seen.set(d.id);
      animating = null;
      if (current) render(current.session, current.you);
      const c = $('hub-continue');
      if (!c.hidden && !$('hub-result').hidden) c.focus();
    });
  }

  function showResult(session, you, d) {
    const stage = $('hub-draw');
    stage.classList.remove('is-pending');
    stage.classList.add('is-open');
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
    $('hub-result').hidden = false;
    $('hub-result').dataset.game = d.gameId;
    $('hub-draw-status').textContent = `Jeu choisi : ${g.title}.`;

    const isHost = session.hostId === you;
    const host = session.players.find((p) => p.host);
    const drawn = d.status === 'drawn';
    const lancable = !!(g.hub && g.hub.handoff);
    $('hub-continue').hidden = !(drawn && isHost);
    $('hub-continue').textContent = lancable ? `Continuer — lancer ${g.title}` : 'Continuer';
    $('hub-continue-wait').textContent = drawn && !isHost ? `En attente de ${host ? host.name : 'l\'hôte'} pour continuer.` : '';
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
  function renderLaunch(session, you) {
    const l = session.launch;
    const g = l ? info(l.gameId) : null;
    const isHost = session.hostId === you;
    const echec = $('hub-failed');
    echec.hidden = !(l && l.stage === 'failed' && session.state === 'lobby');
    if (!echec.hidden) {
      echec.textContent = `Le lancement ${de(g.title)} a échoué : ${GameHub.launchFailureText(l.reason)}. `
        + (isHost ? 'Tu peux relancer un tirage.' : 'L\'hôte peut relancer un tirage.');
    }
    const box = $('hub-launch');
    const actif = l && ['create', 'join', 'playing'].includes(l.stage) && ['launching', 'inGame'].includes(session.state);
    box.hidden = !actif;
    clearInterval(compte);
    if (!actif) return;

    const hote = l.hostId === you;
    const hostName = nameOf(session, l.hostId);
    const dedans = l.entered.includes(you);
    let titre = '', texte = '', bouton = null;
    if (l.stage === 'create') {
      titre = hote ? `À toi de créer la partie : ${g.title}` : `${hostName} crée la partie ${g.title}…`;
      texte = hote ? 'Ouvre le jeu : la partie se crée toute seule, et ton groupe reçoit son code.'
        : 'Le bouton pour rejoindre apparaît dès que la partie existe.';
      if (hote) bouton = `Ouvrir ${g.title}`;
    } else if (l.stage === 'join') {
      titre = `${g.title} est prêt — code ${l.roomCode}`;
      if (dedans) { texte = 'Tu es dans la partie.'; bouton = `Revenir ${au(g.title)}`; }
      else if (l.failed[you]) { texte = `Tu n'as pas pu entrer : ${l.failed[you]}.`; bouton = 'Réessayer'; }
      else { texte = 'Clique pour rejoindre la partie de ton groupe.'; bouton = `Rejoindre ${g.title}`; }
    } else {
      titre = `Partie ${de(g.title)} en cours — code ${l.roomCode}`;
      if (dedans) { bouton = `Revenir ${au(g.title)}`; }
      else texte = l.missed.includes(you) ? 'La partie a commencé sans toi. Tu joueras au prochain tirage.' : '';
    }
    $('launch-title').textContent = titre;
    const go = $('launch-go');
    go.hidden = !bouton;
    if (bouton) go.textContent = bouton;
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
      $('hub-wait').textContent = isHost ? 'Tirage en cours.' : `${hostName} a lancé le tirage.`;
    } else if (isHost) {
      $('hub-wait').textContent = pool.eligible.length ? 'Tu es l\'hôte : c\'est toi qui tires.' : 'Tu es l\'hôte. Aucun jeu n\'est possible pour l\'instant.';
    } else {
      $('hub-wait').textContent = `⏳ En attente de ${hostName} — c'est l'hôte qui tire le jeu.`;
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
  // La RÉVÉLATION du podium final : « La soirée est terminée », un temps, puis
  // le 3e, le 2e, le 1er (par RANG : des ex æquo apparaissent ensemble, et un
  // rang absent — 1, 1, 3 — est simplement sauté), puis le reste. Tout est déjà
  // dans le DOM : une connexion lente n'y change rien, seule la mise en scène
  // attend. Mouvement réduit : tout est là tout de suite.
  const REVEAL_FIRST = 1100, REVEAL_STEP = 950;
  let revealTimers = [];
  function clearReveal() {
    revealTimers.forEach(clearTimeout);
    revealTimers = [];
    $('hub-recap').classList.remove('is-revealing');
    $('recap-ranking').removeAttribute('aria-busy');
  }
  function reveler(r) {
    const sec = $('hub-recap');
    const rows = [...document.querySelectorAll('#recap-ranking .recap-row')];
    const later = [...sec.querySelectorAll('.recap-later')];
    const tops = r.ranking.filter((l) => l.rank === 1).map((l) => l.name);
    const annonce = () => { $('recap-live').textContent = (tops.length > 1 ? 'Vainqueurs de la soirée, à égalité : ' : 'Vainqueur de la soirée : ') + tops.join(', ') + '.'; };
    if (reduced()) { annonce(); return; }
    sec.classList.add('is-revealing');
    $('recap-ranking').setAttribute('aria-busy', 'true');
    [...rows, ...later].forEach((x) => x.classList.remove('is-shown'));
    let t = REVEAL_FIRST;
    for (const k of [3, 2, 1]) {
      const groupe = rows.filter((x) => Number(x.dataset.rank) === k);
      if (!groupe.length) continue;
      revealTimers.push(setTimeout(() => groupe.forEach((x) => x.classList.add('is-shown')), t));
      t += REVEAL_STEP;
    }
    revealTimers.push(setTimeout(() => {
      [...rows, ...later].forEach((x) => x.classList.add('is-shown'));
      clearReveal();
      annonce();
    }, t));
  }

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
    $('recap-ranking').replaceChildren(...r.ranking.map((l) => {
      const li = el('li', 'recap-row' + (l.me ? ' is-me' : '') + (l.rank === 1 && !personne ? ' is-top' : ''));
      li.dataset.player = l.id;
      li.dataset.rank = String(l.rank);
      li.dataset.points = String(l.pts);
      const medaille = !personne && l.pts > 0 && l.rank <= 3;
      const rang = el('span', 'recap-rank' + (medaille ? '' : ' is-num'), medaille ? MEDAILLES[l.rank - 1] : l.rank + '.');
      rang.setAttribute('aria-hidden', 'true');
      const av = GameAvatar.node(l.avatar, undefined, l.rank === 1 && !personne ? 'lg' : 'md');
      av.setAttribute('aria-hidden', 'true');
      const nom = el('span', 'recap-name', l.name);
      if (l.me) nom.appendChild(el('small', 'hub-tag me', 'toi'));
      if (l.gone) nom.appendChild(el('small', 'hub-tag away', 'parti'));
      const pts = el('span', 'recap-pts', String(l.pts));
      pts.appendChild(el('small', null, 'pts'));
      li.setAttribute('aria-label', `${l.rank === 1 ? '1er' : l.rank + 'e'} : ${l.name}${l.me ? ' (toi)' : ''}, ${l.pts} point${l.pts > 1 ? 's' : ''}`);
      li.append(rang, av, nom, pts);
      return li;
    }));

    const f = r.facts;
    $('recap-count').textContent = String(f.count);
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
