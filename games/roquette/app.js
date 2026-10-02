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
  let roster = new Map();          // id → { name, avatar } (reçu au countdown)
  let order = [], vies = 3, rythme = 'normal';
  let etat = new Map();            // id → { lives, out, left, rank, words }
  let tour = null;                 // { turnId, holder, prompt }
  let phase = 'home';              // countdown | turn | boom | end
  let debutTour = 0;
  let okJusqua = 0;                // le mot accepté reste affiché un instant
  let decompte = null, boucleDanger = null;
  const cards = new Map();         // id → { li, av, nom, vies, etat }
  let tailleAv = null;
  const rocket = Rocket.create($('rocket'));
  const nomDe = (id) => (roster.get(id) || {}).name || 'quelqu’un';

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
      document.querySelectorAll('.avatar-pick').forEach((x) => {
        x.classList.toggle('picked', x === b);
        x.setAttribute('aria-pressed', String(x === b));
      });
    });
    $('avatar-row').appendChild(b);
  }

  async function enter(code) {
    showError('');
    Sons.init();                              // le geste qui autorise le son
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

  const perte = GameNet.surPerte(NET, {
    dansRoom: () => !!myId,
    enPartie: () => !$('play').hidden,
    code: () => $('room-code').textContent.trim(),
    quitter: () => { myId = null; arreter(); showError(''); },
    revenir: (code) => enter(code),
    show, hub: false,
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
  $('rocket').addEventListener('rocket:whoosh', () => Sons.play('whoosh'));

  // ----------------------------------------------------------------- salon
  const lancer = () => {
    vies = +$('vies-select').value;
    rythme = $('rythme-select').value;
    NET.send({ action: 'start', vies, rythme });
  };
  $('start').addEventListener('click', lancer);
  $('again').addEventListener('click', () => NET.send({ action: 'start', vies, rythme }));
  $('to-lobby').addEventListener('click', () => NET.send({ action: 'lobby' }));

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
    const form = $('saisie').offsetHeight + 14;
    let H = etroit ? Math.min(W * 1.12, vh - form - 30) : Math.min(W * 0.64, 640, Math.max(400, vh - form - 120));
    H = Math.max(etroit ? 250 : 380, Math.round(H));
    arena.style.setProperty('--arena-h', H + 'px');
    // Périmètre de l'ellipse (Ramanujan) → place de chaque carte.
    const a = W / 2, b = H / 2;
    const P = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
    const cw = Math.round(Math.max(46, Math.min(112, (P / N) * 0.8)));
    const compact = cw < 76;
    $('ring').classList.toggle('is-compact', compact);
    const taille = cw >= 84 ? 'md' : 'sm';
    if (taille !== tailleAv) {
      tailleAv = taille;
      for (const [id, c] of cards) {
        const r = roster.get(id) || {};
        if (c.g) c.g.remove();
        c.g = GameAvatar.node(r.avatar, DEFAUT, taille);
        c.av.prepend(c.g);
      }
    }
    const premiere = cards.values().next().value;
    const ch = premiere ? premiere.li.offsetHeight || (compact ? 58 : 86) : 80;
    // Marges : le viseur déborde un peu de la carte ; en compact, le nom de la
    // carte du bas (soi) s'écrit dessous. La carte s'accroche par son avatar
    // (--ay, plus bas) : elle s'étend de ay au-dessus du point de l'anneau et de
    // ch − ay en dessous — c'est le plus grand des deux qui borne ry (compact :
    // ay = ch / 2, rien ne change).
    const g1 = premiere && premiere.g;
    const ay = g1 && g1.offsetHeight ? premiere.av.offsetTop + g1.offsetTop + g1.offsetHeight / 2 : ch / 2;
    const rx = a - cw / 2 - 6, ry = b - Math.max(ay, ch - ay) - (compact ? 14 : 6);
    const base = Math.max(0, order.indexOf(myId));          // soi en bas, près de la saisie
    order.forEach((id, i) => {
      const th = (90 + (i - base) * 360 / N) * Math.PI / 180;
      const c = cards.get(id);
      c.li.style.setProperty('--cw', cw + 'px');
      c.li.style.setProperty('--x', (a + rx * Math.cos(th)).toFixed(1) + 'px');
      c.li.style.setProperty('--y', (b + ry * Math.sin(th)).toFixed(1) + 'px');
      // Le point de l'anneau est le centre de l'AVATAR (la cible visée) : la
      // carte s'accroche par lui (offsets : insensibles aux animations).
      if (c.g && c.g.offsetHeight) c.li.style.setProperty('--ay', (c.av.offsetTop + c.g.offsetTop + c.g.offsetHeight / 2).toFixed(1) + 'px');
    });
    // Le centre : la roquette et le prompt, dans l'ellipse intérieure.
    const innerW = 2 * (rx - cw / 2), innerH = 2 * (ry - ch / 2);
    let rk = Math.round(Math.max(110, Math.min(330, innerW * 0.8, (innerH - 52) / 0.9)));
    const poser = () => {
      arena.style.setProperty('--rk', rk + 'px');
      arena.style.setProperty('--pf', Math.round(Math.max(28, Math.min(62, rk * 0.21))) + 'px');
    };
    poser();
    // Le pivot est au centre de l'arène et le texte (bannière, prompt, saisie
    // en direct) se range dessous : il doit finir avant l'avatar du bas (son
    // viseur compris : 5 de marge intérieure + 7 de respiration). Mesuré, pas
    // estimé. Le texte rétrécit avec --rk (le prompt en suit 0,21) : le
    // débord baisse de 0,32 à 0,62 px par px de --rk ; un pas de débord / 0,62
    // n'en fait donc jamais trop, et converge en quelques passes.
    const g0 = premiere && premiere.g;
    const bas = ry - (g0 && g0.offsetHeight ? g0.offsetHeight / 2 : 24) - 12;
    for (let k = 0; k < 5 && rk > 110 && $('centre').offsetHeight; k++) {
      const deborde = 0.32 * rk + ($('centre').offsetHeight - 0.64 * rk) - bas;
      if (deborde <= 0) break;
      rk = Math.max(110, Math.floor(rk - Math.max(1, deborde / 0.62)));
      poser();
    }
    // La roquette se règle sur la place réelle : avatars et bannière hors de sa flamme.
    rocket.fit([...[...cards.values()].map((c) => c.g), $('cible')]);
    rocket.refit();
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
  const cadrer = () => {
    if ($('play').hidden || $('arena').clientWidth >= 560 || document.activeElement !== $('mot')) return;
    const vv = window.visualViewport;
    const top = $('arena').getBoundingClientRect().top + window.scrollY - 4 - (vv ? vv.offsetTop : 0);
    window.scrollTo({ top, behavior: 'instant' });
  };
  $('mot').addEventListener('focus', () => setTimeout(cadrer, 60));
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
  const viser = (id, instant) => { const c = cards.get(id); if (c && c.g) rocket.aimAt(c.g, { instant }); };

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
  });

  NET.on('lobby', (m) => {
    isHost = m.players.some((p) => p.id === myId && p.host);
    if (m.phase === 'end') { majFinHote(); return; }   // écran de fin : seul l'hôte a pu changer
    phase = 'lobby';
    arreter();
    renderLobby(m.players);
    show('lobby');
  });

  NET.on('countdown', (m) => {
    arreter();
    phase = 'countdown';
    order = m.order.slice();
    vies = m.vies;
    rythme = m.rythme;
    roster = new Map(m.players.map((p) => [p.id, { name: p.name, avatar: p.avatar }]));
    etat = new Map();
    appliquer(m.players);
    isHost = m.players.some((p) => p.id === myId && p.host);
    tour = { turnId: 0, holder: order[0], prompt: '' };
    $('feed').replaceChildren();
    retour('');
    show('play');
    $('play').dataset.phase = 'countdown';
    construireAnneau();
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
    let fait = false;
    const impact = () => {
      if (fait) return;
      fait = true;
      appliquer(m.players);
      majCartes();
      if (c) {
        c.li.classList.add('is-hit');
        setTimeout(() => c.li.classList.remove('is-hit'), 1100);
        if (!reduit()) eclat(c);
      }
      Sons.play('impact');
      Sons.play('explosion');
    };
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
  const ECLAT = '<svg viewBox="-50 -50 100 100"><path d="M0,-46 L11,-18 L40,-30 L22,-6 L47,6 L18,12 L28,40 L4,20 L-10,46 L-14,18 L-42,30 L-24,6 L-48,-8 L-20,-12 L-32,-40 L-6,-20 Z" fill="#fd8a0a" stroke="#000" stroke-width="5" stroke-linejoin="round"/><path d="M0,-26 L7,-10 L24,-16 L13,-3 L27,4 L10,7 L15,22 L2,11 L-6,25 L-8,10 L-23,16 L-13,3 L-26,-5 L-11,-7 L-18,-22 L-3,-11 Z" fill="#ffd28f"/><circle r="7" fill="#ffff3a"/></svg>';
  function eclat(c) {
    const ar = $('arena').getBoundingClientRect(), r = c.g.getBoundingClientRect();
    const b = el('div', 'boum');
    b.innerHTML = ECLAT;                         // gabarit fixe, aucune donnée réseau
    b.style.left = (r.left + r.width / 2 - ar.left) + 'px';
    b.style.top = (r.top + r.height / 2 - ar.top) + 'px';
    $('fx').append(b);
    b.addEventListener('animationend', () => b.remove(), { once: true });
    setTimeout(() => b.remove(), 900);
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
    const moi = ranking.find((r) => r.id === myId);
    annonce(`Partie terminée. ${vainqueur ? vainqueur.name + ' gagne.' : ''}${moi ? ` Tu finis ${rang(moi.rank)}.` : ''}`);
  });

  NET.on('error', (m) => {
    showError(m.message);
    perte.refus(m.message);
  });
})();
