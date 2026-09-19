// Page /games/ : le point d'entrée du Game Hub.
//
//   profil local (game-profile.js) ─┐
//                                   ├─ cette page ─ affichage (game-avatar.js)
//   client du Hub (game-hub.js) ────┘
//
// Cette page ne parle PAS au WebSocket elle-même : elle appelle le client
// (create / join / leave) et redessine à chaque événement. Elle ne lance aucun
// jeu : cette phase s'arrête au salon.
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
  const hub = GameHub.createClient({ url: GameHub.hubUrl(location.search) });

  // Un profil jamais enregistré reçoit ici son id, une fois pour toutes (voir
  // load() dans game-profile.js) : c'est lui qui permet de se reconnecter.
  GameProfile.load();

  const store = {
    get() { try { return sessionStorage.getItem(RESUME); } catch (_) { return null; } },
    set(c) { try { sessionStorage.setItem(RESUME, c); } catch (_) { /* reprise perdue au rechargement, pas plus */ } },
    clear() { try { sessionStorage.removeItem(RESUME); } catch (_) {} },
  };

  const show = (id) => { $('entry').hidden = id !== 'entry'; $('lobby').hidden = id !== 'lobby'; };
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

    const host = session.players.find((p) => p.host);
    $('hub-wait').textContent = (host && host.id === you ? 'Tu es l\'hôte de la session.'
      : host ? `${host.name} est l'hôte de la session.` : '')
      + ' La sélection des jeux arrive à la prochaine étape.';
  }

  hub.on('session', ({ session, you }) => {
    store.set(session.code);
    renderLobby(session, you);
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
    store.clear();
    show('entry');
    say('');
    warn(err && err.text ? err.text : 'Session terminée.');
    renderMe();
  });

  hub.on('error', (err) => {
    // Une erreur hors create/join (rare) : on la dit là où l'on est.
    if (!$('lobby').hidden) $('hub-code-hint').textContent = err.text;
    else warn(err.text);
  });

  $('hub-leave').addEventListener('click', () => {
    hub.leave();
    store.clear();
    show('entry');
    warn('');
    say('Tu as quitté la session.');
    renderMe();
  });

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
      warn(e.code === 'SESSION_NOT_FOUND' || e.code === 'SESSION_CLOSED'
        ? 'Ta session précédente n\'existe plus.' : e.message);
      renderMe();
    });
  }
})();
