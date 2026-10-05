// Roquette — l'affichage. AUCUNE règle de jeu ici : le serveur dit qui est
// visé, sur quel prompt, quel mot est accepté ou refusé, qui perd une vie et
// quand, et le classement. On transmet des intentions (un mot, sa saisie en
// cours) et on montre ce qui arrive.
//
// Le temps de la menace n'arrive jamais ici (le serveur ne l'envoie pas). Ce
// que la roquette montre du « danger » se calcule sur le temps ÉCOULÉ depuis
// le début du tour, mesuré par cette page — il ne dit rien de l'explosion.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const AVATARS = ['🎯', '🦊', '🐼', '😎', '🤖', '👻', '🔥', '⚡', '🎭', '🎧', '🍕', '🪖'];
  const DEFAUT = '🙂';
  const SCREENS = ['home', 'lobby', 'play', 'end', 'lost'];
  const reduit = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const show = (id) => {
    SCREENS.forEach((s) => { $(s).hidden = s !== id; });
    document.body.classList.toggle('en-jeu', id === 'play');
  };
  const showError = (m) => { $('error').textContent = m ? '> ' + m : ''; };
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const rang = (n) => (n === 1 ? '1er' : n + 'e');
  const epeler = (p) => String(p || '').toUpperCase().split('').join(' ');
  const coeurs = (n, max) => '❤️'.repeat(Math.max(0, n)) + '🖤'.repeat(Math.max(0, max - n));

  // ---------------------------------------------------------- état reçu
  let myId = null, isHost = false;
  let roster = new Map();          // id → { name, avatar, skin } (salon, message `skin`, puis countdown)
  let order = [], vies = 3, rythme = 'normal';
  let etat = new Map();            // id → { lives, out, left, rank, words }
  let tour = null;                 // { turnId, holder, prompt }
  let phase = 'home';              // countdown | turn | boom | end
  let debutTour = 0;
  let okJusqua = 0;                // le mot accepté reste affiché un instant
  let decompte = null, boucleDanger = null;
  const cards = new Map();         // id → { li, av, nom, vies, etat }
  let tailleAv = null;
  let viseId = null;          // le JOUEUR que vise la roquette (son avatar peut être remplacé par layout())
  const rocket = Rocket.create($('rocket'));
  const nomDe = (id) => (roster.get(id) || {}).name || 'quelqu’un';
  // L'arme d'un joueur, telle que le SERVEUR l'a relayée ; inconnue → la roquette.
  const skinDe = (id) => Rocket.skinId((roster.get(id) || {}).skin);

  // -------------------------------------------------------------- annonces
  // Un seul message par instant : « Bob : passion. Au tour d'Ana… » plutôt que
  // deux annonces qui se marchent dessus.
  let tampon = { polite: [], vite: [] }, vidage = null;
  function annonce(txt, vite) {
    tampon[vite ? 'vite' : 'polite'].push(txt);
    clearTimeout(vidage);
    vidage = setTimeout(() => {
      for (const [k, id] of [['polite', 'annonce'], ['vite', 'annonce-vite']]) {
        if (!tampon[k].length) continue;
        $(id).textContent = tampon[k].join(' ');
        tampon[k] = [];
      }
    }, 60);
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
      document.querySelectorAll('#avatar-row .avatar-pick').forEach((x) => {   // pas les armes du salon (même classe)
        x.classList.toggle('picked', x === b);
        x.setAttribute('aria-pressed', String(x === b));
      });
    });
    $('avatar-row').appendChild(b);
  }

  // ------------------------------------------------------------ l'arme (skin)
  // Purement cosmétique. Préférence de CE navigateur (pas le profil commun) :
  // relue au chargement, écrite à chaque choix ; inconnue ou absente → la
  // roquette. Elle part avec le join, et se change au salon seulement (action
  // `skin`). Ce que les autres voient, c'est ce que le serveur relaie.
  const CLE_SKIN = 'roquette_skin';
  let monSkin = Rocket.DEFAUT;
  try { monSkin = Rocket.skinId(localStorage.getItem(CLE_SKIN)); } catch (_) { /* stockage bloqué : la roquette */ }
  let skinsServeur = false;        // le serveur relaie-t-il les armes ? (un ancien n'en met pas dans `lobby`)
  for (const id of Rocket.SKINS) {
    const b = el('button', 'avatar-pick skin-pick');
    b.type = 'button';
    b.dataset.skin = id;
    const apercu = el('span', 'skin-apercu');
    apercu.innerHTML = Rocket.dessin(id, 'apercu-' + id);   // gabarit fixe, aucune donnée réseau
    b.append(apercu, el('span', 'skin-nom', Rocket.info(id).nom));
    b.addEventListener('click', () => choisirSkin(id));
    $('skin-row').append(b);
  }
  function majChoixSkin() {
    for (const b of $('skin-row').children) {
      const on = b.dataset.skin === monSkin;
      b.classList.toggle('picked', on);
      b.setAttribute('aria-pressed', String(on));
    }
  }
  majChoixSkin();
  // Le serveur ignore au-delà de 4 changements par seconde : on en envoie au
  // plus un toutes les 260 ms, et c'est toujours le DERNIER choix qui part.
  let skinEnvoye = 0, skinEnAttente = null;
  function choisirSkin(id) {
    monSkin = Rocket.skinId(id);
    try { localStorage.setItem(CLE_SKIN, monSkin); } catch (_) { /* tant pis : le choix vaut pour la visite */ }
    majChoixSkin();
    if (!myId || !skinsServeur) return;          // hors room : il partira avec le join
    clearTimeout(skinEnAttente);
    skinEnAttente = setTimeout(() => {
      skinEnvoye = Date.now();
      if (myId && phase === 'lobby') NET.send({ action: 'skin', skin: monSkin });
    }, Math.max(0, skinEnvoye + 260 - Date.now()));
  }

  async function enter(code) {
    showError('');
    Sons.init();                              // le geste qui autorise le son
    try {
      await NET.connect();
      NET.send({ action: 'join', name: $('name-input').value, avatar: GameProfile.joinAvatar(myAvatar), skin: monSkin, code: code || undefined });
    } catch (err) {
      showError(err.message);
      perte.refus(err.message);
      // Lancé par le Hub et serveur injoignable : le Hub est prévenu.
      if (lien && viaHub && !myId) { viaHub = false; lien.failed('UNREACHABLE', err.message); }
    }
  }
  $('host').addEventListener('click', () => enter());
  $('join').addEventListener('click', () => enter($('code-input').value));
  $('code-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') enter($('code-input').value); });

  // ------------------------------------------------------- lancé par le Hub
  // Ouverte par le Game Hub, la page a un billet (games/shared/hub-handoff.js)
  // qui dit si l'on CRÉE la partie (l'hôte du lancement) ou si l'on REJOINT le
  // code du groupe. Dans les deux cas on passe par `enter()`, le join normal de
  // cette page : aucun second système de room. Sans billet, `lien` vaut null et
  // la page marche exactement comme avant.
  let viaHub = false;          // le join en cours vient du Hub
  let partirSansAttendre = false;
  let nbJoueurs = 0;
  const lien = window.HubHandoff ? HubHandoff.start({
    gameId: 'roquette',
    join: (code) => {
      viaHub = true;
      if (!$('name-input').value.trim()) $('name-input').value = GameProfile.load().name || '';
      enter(code || undefined);
    },
    onUpdate: (i) => attente(i),
  }) : null;

  // L'hôte ne lance pas tant que le groupe n'est pas dans la room :
  // roquette-server refuse un join hors du salon (« partie déjà commencée »),
  // donc un invité en retard resterait dehors. Il peut partir sans eux —
  // explicitement. Hors Hub, seule la règle habituelle : au moins 2 joueurs.
  function attente(i) {
    const n = i && i.launch.stage === 'join' ? i.waitingIds.length : 0;
    const bloque = isHost && n > 0 && !partirSansAttendre;
    $('start').disabled = bloque || nbJoueurs < 2;
    $('start').textContent = bloque ? `En attente de ${i.waiting}…` : 'Lancer la partie';
    $('start-anyway').hidden = !bloque;
  }

  // --- connexion perdue (games/shared/game-net.js) -------------------------
  // `myId = null` (dans quitter) rend aussi sa garde à lien.failed() : un retour
  // raté depuis le Game Hub lui est bien signalé.
  const perte = GameNet.surPerte(NET, {
    dansRoom: () => !!myId,
    enPartie: () => !$('play').hidden,
    code: () => $('room-code').textContent.trim(),
    quitter: () => { myId = null; arreter(); $('to-hub').hidden = true; showError(''); },
    revenir: (code) => { if (lien) viaHub = true; enter(code); },
    show, hub: !!lien,
  });

  $('room-code').addEventListener('click', async () => {
    const hint = $('code-hint');
    try { await navigator.clipboard.writeText($('room-code').textContent.trim()); hint.textContent = 'code copié ✔'; }
    catch (_) { hint.textContent = 'copie impossible — recopie le code à la main'; }
    setTimeout(() => { hint.textContent = 'clique sur le code pour le copier'; }, 2000);
  });

  // ------------------------------------------------------------------ son
  const majSon = () => {
    $('son').setAttribute('aria-pressed', String(Sons.muet));
    $('son-icone').textContent = Sons.muet ? '🔇' : '🔊';
    $('son').querySelector('.sr-only').textContent = Sons.muet ? 'Remettre le son' : 'Couper le son';
  };
  $('son').addEventListener('click', () => { Sons.init(); Sons.setMuet(!Sons.muet); majSon(); });
  majSon();
  $('rocket').addEventListener('rocket:whoosh', () => Sons.play(Rocket.info(rocket.skin).depart));

  // ----------------------------------------------------------------- salon
  const lancer = () => {
    vies = +$('vies-select').value;
    rythme = $('rythme-select').value;
    NET.send({ action: 'start', vies, rythme });
  };
  $('start').addEventListener('click', lancer);
  $('start-anyway').addEventListener('click', () => { partirSansAttendre = true; lancer(); });
  $('again').addEventListener('click', () => NET.send({ action: 'start', vies, rythme }));
  $('to-lobby').addEventListener('click', () => NET.send({ action: 'lobby' }));

  let salon = [];                  // les joueurs du dernier `lobby` (pour redessiner après un `skin`)
  function renderLobby(players) {
    salon = players;
    const ul = $('players');
    ul.replaceChildren();
    for (const p of players) {
      const li = el('li', 'g-player');
      li.dataset.id = p.id;
      li.append(GameAvatar.node(p.avatar, DEFAUT, 'sm'), el('span', 'g-player-name', p.name + (p.id === myId ? ' (toi)' : '')));
      if (skinsServeur) li.append(el('span', 'tag-skin', Rocket.info(skinDe(p.id)).court));
      if (p.host) li.append(el('span', 'tag', 'hôte'));
      ul.append(li);
    }
    $('skin-choix').hidden = !skinsServeur;
    $('lobby-count').textContent = `${players.length} / 16`;
    $('host-config').hidden = !isHost;
    nbJoueurs = players.length;
    attente(lien && lien.info());
    $('need-players').textContent = isHost
      ? (players.length < 2 ? 'Il faut au moins 2 joueurs — donne le code.' : '')
      : 'En attente de l’hôte…';
  }

  // ----------------------------------------------------------- l'anneau
  function construireAnneau() {
    const ring = $('ring');
    ring.replaceChildren();
    cards.clear();
    tailleAv = null;
    order.forEach((id, i) => {
      const r = roster.get(id) || { name: '?', avatar: null };
      const li = el('li', 'card');
      li.dataset.id = id;
      const av = el('span', 'av');
      const viseur = el('span', 'viseur');
      const num = el('span', 'num', String(i + 1));
      const suiv = el('span', 'suiv', '▸');
      suiv.setAttribute('aria-hidden', 'true');
      av.append(viseur, num, suiv);
      const nom = el('span', 'nom', r.name);
      const v = el('span', 'vies');
      v.setAttribute('aria-hidden', 'true');
      const et = el('span', 'etat');
      li.append(av, nom, v, et);
      ring.append(li);
      cards.set(id, { li, av, nom, vies: v, etat: et, g: null });
    });
    layout();
    majCartes();
  }

  // Les tailles dépendent de la place et du nombre de joueurs : 2 joueurs
  // ont de grandes cartes, 16 tiennent en ellipse compacte (au téléphone, le
  // nom n'est écrit que pour la cible et soi ; le suivant a son badge « ▸ »).
  function layout() {
    const arena = $('arena');
    const W = arena.clientWidth;
    if (!W || !order.length) return;
    const N = order.length;
    const etroit = W < 560;
    const vv = window.visualViewport;
    const vh = vv ? vv.height : window.innerHeight;
    // La hauteur minimale d'arène : la colonne centrale au plus petit (--rk
    // 110, prompt à 28 px), pivot au milieu, texte dessous. Mesurée sur la pile
    // du moment (le prompt suit --pf, ramené à 28) — rien d'estimé.
    const centre = $('centre');
    const rk0 = parseFloat(arena.style.getPropertyValue('--rk')) || 260;
    const pf0 = parseFloat(arena.style.getPropertyValue('--pf')) || 52;
    const pile = centre.offsetHeight ? centre.offsetHeight - 0.64 * rk0 - $('prompt').offsetHeight * (1 - 28 / pf0) : 96;
    const hMin = Math.round(2 * (0.32 * 110 + pile + 8));
    // Écran très bas (clavier ouvert en paysage…) : si le formulaire complet
    // empêche l'arène d'avoir sa hauteur minimale, il se serre (label masqué
    // à l'œil seulement, statut vide replié).
    const saisie = $('saisie');
    const marge = etroit ? 30 : 24;
    saisie.classList.remove('is-serree');
    let form = saisie.offsetHeight + 14;
    if (saisie.offsetHeight && vh - form - marge < hMin) { saisie.classList.add('is-serree'); form = saisie.offsetHeight + 14; }
    let H = etroit ? Math.min(W * 1.12, vh - form - 30) : Math.min(W * 0.64, 640, Math.max(400, vh - form - 120));
    H = Math.max(etroit ? 250 : 380, Math.round(H));
    // Écran bas : la hauteur réellement visible commande, les planchers cèdent
    // (jusqu'à hMin). cadrer() amène alors l'arène et la saisie à l'écran.
    const place = Math.round(vh - form - marge);
    const coupe = place < H;
    if (coupe) H = Math.max(hMin, place);
    const parHauteur = H < (etroit ? W * 1.12 : Math.min(W * 0.64, 640)) - 1;
    arena.style.setProperty('--arena-h', H + 'px');
    // Périmètre de l'ellipse (Ramanujan) → place de chaque carte.
    const a = W / 2, b = H / 2;
    const P = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
    const cw = Math.round(Math.max(46, Math.min(112, (P / N) * 0.8)));
    let compact = cw < 76;
    $('ring').classList.toggle('is-compact', compact);
    // La taille d'avatar n'est qu'une classe (game-ui.css) : on la change sur
    // le nœud existant ; un nœud n'est créé que pour une carte qui n'en a pas.
    let taille = cw >= 84 ? 'md' : 'sm';
    const tailler = (t) => {
      taille = t;
      if (t === tailleAv && [...cards.values()].every((c) => c.g)) return;
      tailleAv = t;
      for (const [id, c] of cards) {
        if (c.g) { c.g.classList.remove('g-av--sm', 'g-av--md'); c.g.classList.add('g-av--' + t); continue; }
        const r = roster.get(id) || {};
        c.g = GameAvatar.node(r.avatar, DEFAUT, t);
        c.av.prepend(c.g);
      }
    };
    tailler(taille);
    for (const c of cards.values()) c.li.style.setProperty('--cw', cw + 'px');   // les noms s'ellipsent à cette largeur
    const premiere = cards.values().next().value;
    // Marges : le viseur déborde un peu de la carte ; en compact, le nom de la
    // carte du bas (soi) s'écrit dessous. La carte s'accroche par son avatar
    // (--ay, plus bas) : elle s'étend de ay au-dessus du point de l'anneau et de
    // ch − ay en dessous — c'est le plus grand des deux qui borne ry (compact :
    // ay = ch / 2, rien ne change).
    let ch, ay, ry;
    const mesurer = () => {
      ch = premiere ? premiere.li.offsetHeight || (compact ? 58 : 86) : 80;
      const g1 = premiere && premiere.g;
      ay = g1 && g1.offsetHeight ? premiere.av.offsetTop + g1.offsetTop + g1.offsetHeight / 2 : ch / 2;
      ry = b - Math.max(ay, ch - ay) - (compact ? 14 : 6);
    };
    mesurer();
    const rx = a - cw / 2 - 6;
    const base = Math.max(0, order.indexOf(myId));          // soi en bas, près de la saisie
    // Écran bas : les cartes à intervalles ÉGAUX le long de l'ellipse — à
    // angle égal, elles s'entassent aux deux bouts d'une ellipse aplatie.
    // Ailleurs, l'angle égal d'origine. d tourne l'anneau (en fraction de tour).
    const M = 720;
    let arc = null, arcRy = null, arcEgal = coupe, enBas = coupe;
    const table = () => {
      arc = [0];
      let px = a + rx, py = b;
      for (let k = 1; k <= M; k++) {
        const t = k / M * 2 * Math.PI, x = a + rx * Math.cos(t), y = b + ry * Math.sin(t);
        arc.push(arc[k - 1] + Math.hypot(x - px, y - py));
        px = x; py = y;
      }
      arcRy = ry;
    };
    const pos = (i, d) => {
      let t;
      if (!arcEgal) t = (90 + (i - base) * 360 / N) * Math.PI / 180 + d;
      else {
        if (arcRy !== ry) table();
        const L = arc[M];
        let s = L / 4 + ((i - base) / N + d / (2 * Math.PI)) * L;     // L / 4 : le bas de l'ellipse
        s = ((s % L) + L) % L;
        let lo = 0, hi = M;
        while (hi - lo > 1) { const m = (lo + hi) >> 1; if (arc[m] <= s) lo = m; else hi = m; }
        t = (lo + (s - arc[lo]) / ((arc[hi] - arc[lo]) || 1)) / M * 2 * Math.PI;
      }
      return [a + rx * Math.cos(t), b + ry * Math.sin(t)];
    };
    // Ce que chaque carte MONTRE (avatar, nom s'il est écrit, vies, état s'il
    // dit quelque chose), en rectangles relatifs au centre de son avatar — le
    // point de l'anneau. Mesuré sur le DOM : la largeur réelle des noms, la
    // pastille des vies en compact, le nom de la cible et le sien sous l'avatar.
    let formes;
    const mesurerFormes = () => {
      // En compact, l'étiquette du nom (cible, soi) ne dépasse pas l'écart
      // entre deux cartes de l'anneau : sinon elle couvre l'avatar voisin.
      const pr = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
      $('ring').style.setProperty('--nm', Math.max(40, Math.round(pr / N - 8)) + 'px');
      formes = order.map((id) => {
        const c = cards.get(id);
        const L = c.li.getBoundingClientRect();
        const ox = L.left + L.width / 2, oy = L.top + (c.g && c.g.offsetHeight ? c.av.offsetTop + c.g.offsetTop + c.g.offsetHeight / 2 : L.height / 2);
        return [c.av, c.nom, c.vies, c.etat]
          .filter((e) => e === c.av || (e.textContent.trim() && e.checkVisibility()))
          .map((e) => { const r = e.getBoundingClientRect(); return [r.left - ox, r.top - oy, r.right - ox, r.bottom - oy]; })
          .filter((r) => r[2] > r[0]);
      });
    };
    mesurerFormes();
    const ECART = 3;                                     // px entre deux cartes, viseur compris
    const touche = (f, x, y, g, u, v, m) => f.some((p) => g.some((q) =>
      p[0] + x < q[2] + u + m && q[0] + u < p[2] + x + m && p[1] + y < q[3] + v + m && q[1] + v < p[3] + y + m));
    const libres = (d) => {
      const P = order.map((_, i) => pos(i, d));
      for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
        if (touche(formes[i], P[i][0], P[i][1], formes[j], P[j][0], P[j][1], ECART)) return false;
      }
      return true;
    };
    // Cartes qui se recouvrent : on desserre, du plus doux au plus fort —
    // l'écart égal le long de l'ellipse (au lieu de l'angle égal, qui entasse
    // les bouts), puis le compact, puis les petits avatars. Une mise en page
    // sans recouvrement ne change pas.
    const toutesLibres = () => libres(0) && (!coupe || libres(Math.PI / N));
    if (N > 2 && !toutesLibres()) {
      arcEgal = true;
      if (!toutesLibres() && !compact) { compact = true; $('ring').classList.add('is-compact'); mesurer(); mesurerFormes(); }
      if (!toutesLibres() && taille === 'md') { tailler('sm'); mesurer(); mesurerFormes(); }
    }
    const g0 = premiere && premiere.g;
    const basCarte = ry - (g0 && g0.offsetHeight ? g0.offsetHeight / 2 : 24) - 12;
    // Le centre : la roquette et le prompt, dans l'ellipse intérieure. Écran
    // bas : la colonne se libère en tournant l'anneau (plus bas) — la place
    // entre la carte du haut et celle du bas ne borne donc plus --rk.
    const innerW = 2 * (rx - cw / 2), innerH = 2 * (ry - ch / 2);
    let rk = Math.round(Math.max(110, Math.min(330, innerW * 0.8, enBas ? Infinity : (innerH - 52) / 0.9)));
    // La colonne du texte : au moins sa largeur d'origine, et assez pour une
    // bannière entière (« 🎯 » + 16 caractères) tant que l'anneau le permet.
    const colonne = () => Math.max(1.25 * rk, Math.min(260, innerW - 8));
    const poser = () => {
      arena.style.setProperty('--rk', rk + 'px');
      arena.style.setProperty('--pf', Math.round(Math.max(28, Math.min(62, rk * 0.21))) + 'px');
      arena.style.setProperty('--cl', Math.round(colonne()) + 'px');
    };
    poser();
    // Le pivot est au centre de l'arène et le texte (bannière, prompt, saisie
    // en direct) se range dessous : il doit finir avant la limite donnée.
    // Mesuré, pas estimé. Le texte rétrécit avec --rk (le prompt en suit
    // 0,21) : le débord baisse de 0,32 à 0,62 px par px de --rk ; un pas de
    // débord / 0,62 n'en fait donc jamais trop, et converge en quelques passes.
    const sousPivot = () => 0.32 * rk + (centre.offsetHeight - 0.64 * rk);
    const ajuster = (limite) => {
      for (let k = 0; k < 5 && rk > 110 && centre.offsetHeight; k++) {
        const deborde = sousPivot() - limite();
        if (deborde <= 0) break;
        rk = Math.max(110, Math.floor(rk - Math.max(1, deborde / 0.62)));
        poser();
      }
    };
    // La colonne centrale, ligne par ligne — la bannière à la largeur de la
    // colonne, le prompt à la sienne (+ la saisie en direct si elle écrit
    // quelque chose) — contre ce que chaque carte montre. Le haut de la
    // colonne est à .32 × --rk au-dessus du pivot (= b).
    const chevauche = (d) => {
      const haut = b - 0.32 * rk, wp = $('prompt').offsetWidth + 8;
      const lignes = [[$('cible'), colonne()], [$('prompt'), wp]];
      if ($('live').textContent.trim()) lignes.push([$('live'), wp]);
      const r = lignes.map(([el, w]) => [a - w / 2, haut + el.offsetTop, a + w / 2, haut + el.offsetTop + el.offsetHeight]);
      for (let i = 0; i < N; i++) {
        const [x, y] = pos(i, d);
        if (touche(formes[i], x, y, r, 0, 0, ECART)) return true;
      }
      return false;
    };
    // Écran bas : la pile tient d'abord dans l'arène ; puis l'anneau tourne du
    // plus petit angle (un demi-pas au plus) qui laisse la colonne libre — soi
    // reste en bas, un peu de côté. Si aucun angle n'y suffit, --rk recule
    // (prompt et colonne rétrécissent) jusqu'au plancher. Ailleurs, rien ne
    // bouge : d = 0, et la limite reste la carte du bas.
    let d = 0;
    if (!enBas) {
      ajuster(() => basCarte);
      // Même --rk au plancher, la pile déborde sur la carte du bas (arène
      // bornée par la hauteur), ou une carte mord sur la colonne : on tourne
      // l'anneau, comme pour un écran coupé.
      if ((parHauteur && sousPivot() > basCarte + 1) || chevauche(0) || !libres(0)) {
        enBas = arcEgal = true;
        rk = Math.round(Math.max(110, Math.min(330, innerW * 0.8)));
        poser();
      }
    }
    arena.classList.toggle('is-bas', enBas);
    if (enBas) {
      const pas = Math.PI / N / 24;
      // Deux essais : les cartes telles quelles, puis compactes si aucun angle
      // ni --rk au plancher ne libère la colonne.
      for (let essai = 0; essai < 2; essai++) {
        ajuster(() => H - 8 - b);
        let libre = false;
        for (;;) {
          let k = 0;
          while (k <= 24 && (chevauche(k * pas) || !libres(k * pas))) k++;
          if (k <= 24) { d = k * pas; libre = true; break; }
          d = Math.PI / N;
          if (rk <= 110) break;
          rk = Math.max(110, rk - 6);
          poser();
        }
        if (libre || compact) break;
        compact = true;
        $('ring').classList.add('is-compact');
        mesurer(); mesurerFormes();
        rk = Math.round(Math.max(110, Math.min(330, innerW * 0.8)));
        poser();
      }
    }
    order.forEach((id, i) => {
      const c = cards.get(id);
      const [x, y] = pos(i, d);
      c.li.style.setProperty('--x', x.toFixed(1) + 'px');
      c.li.style.setProperty('--y', y.toFixed(1) + 'px');
      // Le point de l'anneau est le centre de l'AVATAR (la cible visée) : la
      // carte s'accroche par lui (offsets : insensibles aux animations).
      if (c.g && c.g.offsetHeight) c.li.style.setProperty('--ay', (c.av.offsetTop + c.g.offsetTop + c.g.offsetHeight / 2).toFixed(1) + 'px');
    });
    // La roquette se règle sur la place réelle : avatars et bannière hors de sa flamme.
    rocket.fit([...[...cards.values()].map((c) => c.g), $('cible')]);
    // Même cible, nouvel angle, sans animation. La cible est un JOUEUR : si
    // son avatar vient d'être remplacé (md ↔ sm, plus haut), on vise le nœud
    // actuel — l'ancien, détaché, ne mesure plus rien.
    const vise = viseId && cards.get(viseId);
    if (vise && vise.g && rocket.cible !== vise.g) rocket.aimAt(vise.g, { instant: true });
    else rocket.refit();
  }
  // La mise en page lit la place disponible (arène, zone visible, formulaire) :
  // elle est refaite après TOUT redimensionnement, à l'image suivante, quand les
  // nouvelles dimensions sont en place — un seul signal (ou un signal arrivé
  // trop tôt) laissait sinon une mise en page périmée : cartes hors de l'arène,
  // roquette et prompt gardant leur taille d'avant (vu une fois sur six en test).
  let relayoutRaf = 0;
  const relayout = () => {
    cancelAnimationFrame(relayoutRaf);
    relayoutRaf = requestAnimationFrame(() => { if ($('play').hidden) return; layout(); cadrer(); });
  };
  new ResizeObserver(relayout).observe($('arena'));
  window.addEventListener('resize', relayout);
  // Téléphone : quand le champ a le focus (clavier ouvert), l'arène est
  // calibrée sur ce qui reste visible (layout lit visualViewport) et cadrée en
  // haut — prompt, roquette, cible ET champ à l'écran. Sans ce cadrage, le
  // navigateur centre le champ et fait passer la roquette au-dessus de l'écran.
  // Écran bas (arène coupée par la hauteur visible, quelle que soit la
  // largeur) : même cadrage, sans attendre le focus. Si arène et saisie ne
  // tiennent pas ensemble, la saisie est calée en bas et l'arène montre son
  // bas — la colonne centrale (bannière, prompt) d'abord.
  const cadrer = () => {
    if ($('play').hidden) return;
    const focus = $('arena').clientWidth < 560 && document.activeElement === $('mot');
    if (!focus && !$('arena').classList.contains('is-bas')) return;
    const vv = window.visualViewport;
    const vh = vv ? vv.height : window.innerHeight, off = vv ? vv.offsetTop : 0;
    const ar = $('arena').getBoundingClientRect(), fo = $('saisie').getBoundingClientRect();
    if (ar.top >= off && fo.bottom <= off + vh) return;               // déjà tout à l'écran : on ne bouge rien
    const top = fo.bottom - ar.top + 8 <= vh
      ? ar.top + window.scrollY - 4 - off
      : fo.bottom + window.scrollY + 4 - vh - off;
    window.scrollTo({ top, behavior: 'instant' });
  };
  // Au focus, le navigateur amène lui-même le champ à l'écran — en défilement
  // doux (scroll-behavior du socle), qui finit APRÈS le premier cadrage et
  // l'écrase : on recadre aussi quand il a fini (scrollend ; sinon 500 ms).
  $('mot').addEventListener('focus', () => {
    setTimeout(cadrer, 60);
    if ('onscrollend' in window) {
      const fin = () => { clearTimeout(garde); cadrer(); };
      const garde = setTimeout(() => window.removeEventListener('scrollend', fin), 1500);
      window.addEventListener('scrollend', fin, { once: true });
    } else setTimeout(cadrer, 500);
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', relayout);
  }

  const vivantApres = (id) => {
    const i = order.indexOf(id);
    for (let k = 1; k <= order.length; k++) {
      const x = order[(i + k) % order.length];
      if (etat.get(x) && !etat.get(x).out) return x;
    }
    return null;
  };

  function majCartes() {
    const vise = tour ? tour.holder : null;
    const suivant = vise && phase === 'turn' ? vivantApres(vise) : null;
    for (const [id, c] of cards) {
      const s = etat.get(id) || { lives: vies, out: false, left: false, rank: null };
      c.vies.textContent = s.out ? '' : coeurs(s.lives, vies);
      c.etat.textContent = s.out ? (s.left ? `parti · ${rang(s.rank)}` : `💀 ${rang(s.rank)}`) : '';
      c.li.classList.toggle('is-target', id === vise);
      c.li.classList.toggle('is-next', id === suivant && suivant !== vise);
      c.li.classList.toggle('is-out', !!s.out);
      c.li.classList.toggle('is-me', id === myId);
      const nom = nomDe(id) + (id === myId ? ' (toi)' : '');
      c.li.setAttribute('aria-label', s.out
        ? `${nom}, ${s.left ? 'parti' : 'éliminé'}, ${rang(s.rank)}`
        : `${nom}, ${s.lives} vie${s.lives > 1 ? 's' : ''} sur ${vies}${id === vise ? ', visé par la roquette' : id === suivant ? ', le suivant' : ''}`);
    }
  }

  const appliquer = (players) => { for (const p of players || []) etat.set(p.id, { lives: p.lives, out: p.out, left: p.left, rank: p.rank, words: p.words }); };
  const viser = (id, instant) => { viseId = id; const c = cards.get(id); if (c && c.g) rocket.aimAt(c.g, { instant }); };

  // ---------------------------------------------------------------- saisie
  const monTour = () => phase === 'turn' && tour && tour.holder === myId;
  const moiElimine = () => { const s = etat.get(myId); return !!(s && s.out); };
  function majSaisie() {
    const mine = monTour();
    $('saisie').classList.toggle('is-mine', mine);
    $('envoyer').setAttribute('aria-disabled', String(!mine));
    let label;
    if (phase === 'countdown') label = 'La partie va commencer…';
    else if (phase === 'boom') label = `💥 ${nomDe(tour && tour.holder)}…`;
    else if (moiElimine()) label = 'Tu es éliminé — tu regardes la suite';
    else if (mine) label = `À toi ! Un mot avec ${String(tour.prompt).toUpperCase()}`;
    else label = `Au tour de ${nomDe(tour && tour.holder)}`;
    $('saisie-label').textContent = label;
    $('mot').placeholder = mine ? 'ton mot…' : '';
    if (!mine) $('mot').value = '';
  }
  const retour = (txt, faute) => { $('retour').textContent = txt || ''; $('retour').classList.toggle('is-faute', !!faute); };

  let dernierEnvoi = 0, saisieEnAttente = null;
  $('mot').addEventListener('input', () => {
    if (!monTour()) {                        // hors de son tour : rien ne s'écrit, rien ne part
      if ($('mot').value) { $('mot').value = ''; retour(moiElimine() ? 'Tu es éliminé.' : `Pas encore : au tour de ${nomDe(tour && tour.holder)}.`); }
      return;
    }
    const partir = () => {
      dernierEnvoi = Date.now();
      if (monTour()) NET.send({ action: 'typing', turnId: tour.turnId, text: $('mot').value.slice(0, 60) });
    };
    clearTimeout(saisieEnAttente);
    if (Date.now() - dernierEnvoi > 70) partir(); else saisieEnAttente = setTimeout(partir, 70);
  });
  function soumettre() {
    if (!monTour()) { retour(moiElimine() ? 'Tu es éliminé.' : `Pas encore : au tour de ${nomDe(tour && tour.holder)}.`); return; }
    const texte = $('mot').value.trim();
    if (!texte) return;
    NET.send({ action: 'submit', turnId: tour.turnId, text: texte });
  }
  // Le bouton soumet le formulaire ; Entrée est traitée ICI, sur la touche
  // elle-même : la soumission implicite d'un formulaire attend un `keypress`,
  // que tous les claviers (virtuels, ou pilotés) n'envoient pas. Le
  // preventDefault évite, sur un vrai clavier, un second envoi par le formulaire.
  $('saisie').addEventListener('submit', (e) => { e.preventDefault(); soumettre(); });
  $('mot').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); soumettre(); } });

  // Le mot, avec le prompt mis en évidence : on refait la clé lettre par
  // lettre (accents, œ…) pour retrouver le prompt dans la forme accentuée.
  const cleLettre = (c) => c.normalize('NFD').replace(/\p{Mn}/gu, '').replace(/œ/g, 'oe').replace(/Œ/g, 'OE')
    .replace(/æ/g, 'ae').replace(/Æ/g, 'AE').toLowerCase().replace(/[-'’\s]/g, '');
  function motAvecPrompt(word, prompt) {
    const frag = document.createDocumentFragment();
    const chars = Array.from(String(word));
    let cle = '';
    const pos = [];
    chars.forEach((c, i) => { const k = cleLettre(c); for (let j = 0; j < k.length; j++) pos.push(i); cle += k; });
    const at = prompt ? cle.indexOf(prompt) : -1;
    if (at < 0) { frag.append(String(word)); return frag; }
    const deb = pos[at], fin = pos[at + prompt.length - 1];
    const m = document.createElement('mark');
    m.textContent = chars.slice(deb, fin + 1).join('').toUpperCase();
    frag.append(chars.slice(0, deb).join(''), m, chars.slice(fin + 1).join(''));
    return frag;
  }

  function fil(...parts) {
    const li = el('li');
    li.append(...parts);
    const feed = $('feed');
    feed.prepend(li);
    while (feed.children.length > 6) feed.lastChild.remove();
  }

  // ------------------------------------------------------- danger (affichage)
  // Seuils FIXES sur le temps écoulé du tour : ils montrent que ça chauffe,
  // ils ne disent rien de l'instant de l'explosion (que personne ne connaît ici).
  const SEUILS = [2500, 5000, 8000];
  function danger() {
    if (phase !== 'turn') { rocket.setDanger(0); Sons.danger(-1); return; }
    const e = performance.now() - debutTour;
    const n = SEUILS.filter((s) => e >= s).length;
    rocket.setDanger(n);
    Sons.danger(n);
  }
  function arreter() {
    clearInterval(decompte); decompte = null;
    clearInterval(boucleDanger); boucleDanger = null;
    Sons.danger(-1);
    rocket.annuler();
    rocket.setDanger(0);
  }

  // ---------------------------------------------------------- les messages
  NET.on('you', (m) => {
    myId = m.id;
    isHost = m.host;
    perte.retour();
    $('room-code').textContent = m.code;
    show('lobby');
    // Lancé par le Hub : on lui dit dans quelle room on est. L'hôte y déclare
    // le code (le seul qu'il croira) ; les invités confirment y être entrés.
    // Avec SA place dans la room (m.id, l'id Roquette — jamais celui du Hub) :
    // c'est elle qui relie le classement final à son joueur du Hub. `you` ne
    // vient qu'une fois par join : une reconnexion (nouvel id) ré-annonce.
    if (lien) { viaHub = false; lien.roomReady(m.code, m.id); attente(lien.info()); }
  });

  NET.on('lobby', (m) => {
    isHost = m.players.some((p) => p.id === myId && p.host);
    if (m.phase === 'end') { majFinHote(); return; }   // écran de fin : seul l'hôte a pu changer
    phase = 'lobby';
    arreter();
    skinsServeur = m.players.some((p) => 'skin' in p);
    roster = new Map(m.players.map((p) => [p.id, { name: p.name, avatar: p.avatar, skin: Rocket.skinId(p.skin) }]));
    renderLobby(m.players);
    show('lobby');
  });

  // Un joueur a changé d'arme au salon (le serveur n'en relaie qu'au salon).
  NET.on('skin', (m) => {
    const r = roster.get(m.id);
    if (!r) return;
    r.skin = Rocket.skinId(m.skin);
    if (phase === 'lobby') renderLobby(salon);
  });

  NET.on('countdown', (m) => {
    arreter();
    phase = 'countdown';
    order = m.order.slice();
    vies = m.vies;
    rythme = m.rythme;
    roster = new Map(m.players.map((p) => [p.id, { name: p.name, avatar: p.avatar, skin: Rocket.skinId(p.skin) }]));   // figé pour la partie
    etat = new Map();
    appliquer(m.players);
    isHost = m.players.some((p) => p.id === myId && p.host);
    // La partie démarre (le décompte est sa première phase) : l'hôte le dit au
    // Hub. Une revanche dans la même room ne compte pas (hub-handoff.js filtre).
    if (lien && isHost) lien.started();
    tour = { turnId: 0, holder: order[0], prompt: '' };
    $('feed').replaceChildren();
    retour('');
    show('play');
    $('play').dataset.phase = 'countdown';
    construireAnneau();
    rocket.setSkin(skinDe(order[0]));     // l'arme montrée est celle du joueur visé
    viser(order[0], true);
    $('cible').textContent = `Premier : ${nomDe(order[0])}`;
    $('cible').classList.toggle('is-me', order[0] === myId);
    $('live').textContent = '';
    let n = m.seconds || 3;
    $('prompt').textContent = String(n);
    decompte = setInterval(() => { n -= 1; if (n > 0) $('prompt').textContent = String(n); else { clearInterval(decompte); decompte = null; } }, 1000);
    majSaisie();
    annonce(`La partie commence. Ordre : ${order.map(nomDe).join(', ')}. Premier : ${nomDe(order[0])}.`);
  });

  NET.on('turn', (m) => {
    clearInterval(decompte); decompte = null;
    const premier = phase === 'countdown';
    phase = 'turn';
    $('play').dataset.phase = 'turn';
    appliquer(m.players);
    tour = { turnId: m.turnId, holder: m.holder, prompt: m.prompt };
    debutTour = performance.now();
    rocket.annuler();
    majCartes();
    layout();                       // la place du moment (idempotent), AVANT de viser
    rocket.setSkin(skinDe(m.holder));
    viser(m.holder, premier);
    $('prompt').textContent = m.prompt.toUpperCase();
    const mine = m.holder === myId;
    $('cible').textContent = mine ? '🎯 À TOI !' : `🎯 ${nomDe(m.holder)}`;
    $('cible').classList.toggle('is-me', mine);
    if (performance.now() > okJusqua) { $('live').textContent = ''; $('live').className = ''; }
    majSaisie();
    retour('');
    if (mine) {
      const a = document.activeElement;
      if (!a || a === document.body || $('play').contains(a)) $('mot').focus({ preventScroll: true });
      annonce(`À toi ! Un mot avec ${epeler(m.prompt)}.`, true);
    } else {
      annonce(`Au tour de ${nomDe(m.holder)} : ${epeler(m.prompt)}.`);
    }
    if (!boucleDanger) boucleDanger = setInterval(danger, 200);
    danger();
  });

  NET.on('typing', (m) => {
    if (!tour || m.turnId !== tour.turnId || m.id !== tour.holder || m.id === myId) return;
    okJusqua = 0;
    $('live').className = 'is-typing';
    $('live').textContent = String(m.text || '').slice(0, 30);
  });

  NET.on('accepted', (m) => {
    const w = el('span', 'w');
    w.append(motAvecPrompt(m.word, m.prompt));
    fil('✓ ', nomDe(m.id), ' · ', w);
    $('live').className = 'is-ok';
    $('live').replaceChildren(motAvecPrompt(m.word, m.prompt));
    okJusqua = performance.now() + 900;
    rocket.validate();
    Sons.play('valide');
    if (m.id === myId) { $('mot').value = ''; retour(''); }
    annonce(`${nomDe(m.id)} : ${m.word}.`);
  });

  const RAISONS = {
    NO_PROMPT: (p) => `ne contient pas ${String(p || '').toUpperCase()}`,
    NOT_A_WORD: () => 'pas dans le dictionnaire',
    ALREADY_USED: () => 'déjà joué dans cette partie',
    TOO_SHORT: () => 'trop court',
    TOO_LONG: () => 'trop long',
    BAD_CHARS: () => 'que des lettres',
  };
  // Les refus de PROTOCOLE ne sont pas des fautes de vocabulaire.
  const PROTOCOLE = {
    NOT_YOUR_TURN: 'Ce n’est pas ton tour.',
    STALE_TURN: 'Trop tard : le tour est passé.',
    NOT_PLAYING: 'Pas maintenant.',
    TOO_LATE: 'Trop tard !',
    TOO_FAST: 'Doucement…',
    NOT_IN_GAME: 'Tu n’es pas dans cette partie.',
  };
  NET.on('rejected', (m) => {
    const prompt = tour && tour.prompt;
    if (RAISONS[m.reason]) {
      const raison = RAISONS[m.reason](prompt);
      if (m.id === myId) {
        retour(`✗ ${raison} — essaie encore`, true);
        const s = $('saisie');
        s.classList.remove('is-refus'); void s.offsetWidth; s.classList.add('is-refus');
        annonce(`Refusé : ${raison}.`, true);
      } else {
        retour(`✗ ${nomDe(m.id)} : « ${m.text || ''} » — ${raison}`, true);
      }
    } else if (m.id === myId) {
      retour(PROTOCOLE[m.reason] || m.message || 'Refusé.', false);
    }
  });

  // L'explosion : la vie est DÉJÀ perdue (le serveur l'a décidé) ; l'animation
  // ne fait que la montrer — elle met à jour la carte à l'impact (ou tout de
  // suite en mouvement réduit), avec un filet si l'animation est coupée.
  NET.on('boom', (m) => {
    phase = 'boom';
    tour = { turnId: tour ? tour.turnId : 0, holder: m.id, prompt: m.prompt };
    danger();
    majSaisie();
    $('cible').textContent = `💥 ${nomDe(m.id)}`;
    $('cible').classList.toggle('is-me', m.id === myId);
    const c = cards.get(m.id);
    const arme = Rocket.info(skinDe(m.id));     // l'arme du joueur touché
    let fait = false;
    const impact = () => {
      if (fait) return;
      fait = true;
      appliquer(m.players);
      majCartes();
      if (c) {
        c.li.classList.add('is-hit');
        setTimeout(() => c.li.classList.remove('is-hit'), 1100);
        if (!reduit()) eclat(c, arme);
      }
      // Le son d'impact de l'arme, puis l'explosion commune (après la prise de feu).
      Sons.play(arme.impact);
      if (arme.feu) setTimeout(() => Sons.play('explosion'), FEU_AVANT);
      else Sons.play('explosion');
    };
    viseId = m.id;
    rocket.setSkin(arme.id);
    rocket.boom(c && c.g, impact);
    setTimeout(impact, 1300);
    const qui = nomDe(m.id) + (m.id === myId ? ' (toi)' : '');
    fil('💥 ', qui, m.out ? ` — éliminé, ${rang(m.rank)}` : ` perd une vie (${m.lives} restante${m.lives > 1 ? 's' : ''})`);
    annonce(m.out ? `Boum ! ${qui} est éliminé, ${rang(m.rank)}.` : `Boum ! ${qui} perd une vie, ${m.lives} restante${m.lives > 1 ? 's' : ''}.`, m.id === myId);
  });

  NET.on('left', (m) => {
    appliquer(m.players);
    majCartes();
    fil('🚪 ', nomDe(m.id), ` est parti — ${rang(m.rank)}`);
    annonce(`${nomDe(m.id)} est parti.`);
  });

  // L'éclat de l'impact, posé SUR la carte touchée (pas de flash plein écran).
  // L'étoile orange est COMMUNE à toutes les armes ; une arme peut y ajouter sa
  // couche (la Pétoire : la carte prend feu, puis l'étoile).
  const ECLAT = '<svg viewBox="-50 -50 100 100"><path d="M0,-46 L11,-18 L40,-30 L22,-6 L47,6 L18,12 L28,40 L4,20 L-10,46 L-14,18 L-42,30 L-24,6 L-48,-8 L-20,-12 L-32,-40 L-6,-20 Z" fill="#fd8a0a" stroke="#000" stroke-width="5" stroke-linejoin="round"/><path d="M0,-26 L7,-10 L24,-16 L13,-3 L27,4 L10,7 L15,22 L2,11 L-6,25 L-8,10 L-23,16 L-13,3 L-26,-5 L-11,-7 L-18,-22 L-3,-11 Z" fill="#ffd28f"/><circle r="7" fill="#ffff3a"/></svg>';
  // La prise de feu de la Pétoire : un éclair blanc, trois flammes roses, des braises.
  const FLAMME = 'M0,12 C-12,10 -14,-4 -6,-14 C-6,-6 -2,-6 0,-26 C4,-10 10,-8 8,-16 C16,-4 12,10 0,12 Z';
  const FEU = '<svg viewBox="-50 -50 100 100"><circle class="flash" r="34" fill="#fff"/>'
    + [[-16, 8, 0.7], [16, 8, 0.7], [0, 4, 1]].map(([x, y, k]) => `<g transform="translate(${x} ${y}) scale(${k})"><g class="fl">`
      + `<path d="${FLAMME}" fill="#ff4f9a" stroke="#000" stroke-width="4" stroke-linejoin="round"/>`
      + `<path d="${FLAMME}" transform="translate(0 4) scale(.55)" fill="#ffd6e6"/></g></g>`).join('')
    + [[-20, -4], [-6, -16], [10, -10], [22, -2], [2, -22]].map(([x, y], i) => `<circle class="braise" style="animation-delay:${i * 70}ms" cx="${x}" cy="${y}" r="2.2" fill="#ffb347"/>`).join('')
    + '</svg>';
  const FEU_AVANT = 150;          // ms entre la prise de feu et l'étoile commune
  function poserFx(c, cls, html, vie) {
    if (!c.g) return;
    const ar = $('arena').getBoundingClientRect(), r = c.g.getBoundingClientRect();
    const b = el('div', cls);
    b.innerHTML = html;                          // gabarit fixe, aucune donnée réseau
    b.style.left = (r.left + r.width / 2 - ar.left) + 'px';
    b.style.top = (r.top + r.height / 2 - ar.top) + 'px';
    $('fx').append(b);
    b.addEventListener('animationend', (e) => { if (e.target === b) b.remove(); });
    setTimeout(() => b.remove(), vie);
  }
  function eclat(c, arme) {
    if (!arme.feu) { poserFx(c, 'boum', ECLAT, 900); return; }
    poserFx(c, 'feu', FEU, 1100);
    setTimeout(() => poserFx(c, 'boum', ECLAT, 900), FEU_AVANT);
  }

  // ------------------------------------------------------------------- fin
  function majFinHote() {
    $('again').hidden = !isHost;
    $('to-lobby').hidden = !isHost;
    $('wait-host').hidden = isHost;
  }
  NET.on('end', (m) => {
    arreter();
    phase = 'end';
    isHost = m.host === myId;
    const ranking = m.ranking.slice().sort((a, b) => a.rank - b.rank);
    const vainqueur = ranking[0];
    $('end-title').textContent = vainqueur ? `${vainqueur.name} gagne !` : 'Partie terminée';
    const podium = $('podium');
    podium.replaceChildren();
    for (const r of ranking.filter((x) => x.rank <= 3)) {
      const d = el('div', 'marche r' + r.rank);
      d.append(GameAvatar.node(r.avatar, DEFAUT, 'md'), el('span', 'nom', r.name), el('div', 'socle', rang(r.rank)));
      podium.append(d);
    }
    const ol = $('ranking');
    ol.replaceChildren();
    for (const r of ranking) {
      const li = el('li');
      li.append(el('span', 'rg', rang(r.rank)), GameAvatar.node(r.avatar, DEFAUT, 'sm'),
        el('span', '', r.name + (r.id === myId ? ' (toi)' : '')),
        el('span', 'det', (r.rank === 1 ? `dernier en vie · ${r.lives} ❤️` : r.left ? 'parti' : 'éliminé') + ` · ${r.words} mot${r.words > 1 ? 's' : ''}`));
      ol.append(li);
    }
    majFinHote();
    show('end');
    $('end-title').focus({ preventScroll: true });
    if (lien) {
      // Score de soirée : le classement du SERVEUR, transmis au Hub (l'hôte du
      // lancement seulement, une fois — hub-handoff.js filtre). Toujours AVANT
      // ended(). (garde : un hub-handoff.js resté en cache n'a pas results)
      if (lien.results) lien.results(rangs(m.ranking));
      lien.ended();
      // Mode Hub : le retour au Hub devient l'action PRINCIPALE, la revanche
      // (#again) passe au second plan (hub-handoff.js, endActions).
      if (HubHandoff.endActions) HubHandoff.endActions($('to-hub'), $('again'));
      else $('to-hub').hidden = false;
    }
    const moi = ranking.find((r) => r.id === myId);
    annonce(`Partie terminée. ${vainqueur ? vainqueur.name + ' gagne.' : ''}${moi ? ` Tu finis ${rang(moi.rank)}.` : ''}`);
  });

  NET.on('error', (m) => {
    showError(m.message);
    perte.refus(m.message);
    // Le serveur refuse d'entrer (code inconnu, partie pleine ou déjà
    // commencée) : le Hub est prévenu, pour que le groupe le sache.
    if (lien && viaHub && !myId) { viaHub = false; lien.failed('JOIN', m.message); }
  });

  // Le classement de fin → le contrat du Hub ({ gamePlayerId, rank, points }).
  // Le RANG est celui du serveur, sans recalcul : l'ordre d'élimination (le
  // premier éliminé a le rang le plus grand, le dernier en vie a 1). Roquette
  // ne compte pas de points de partie : 0, comme le Morpion — le Hub ne lit que
  // le rang pour le score de soirée.
  function rangs(ranking) {
    return ranking.map((r) => ({ gamePlayerId: r.id, rank: r.rank, points: 0 }));
  }
})();
