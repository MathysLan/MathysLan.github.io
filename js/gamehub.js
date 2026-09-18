// Hub de jeux : deux entrées amusantes vers les jeux déjà présents.
//   1. « Je joue à quoi ? » — une caisse Mann Co. qui tire un jeu au sort ;
//   2. « Trouver une partie » — un faux matchmaking, pour le plaisir du HUD.
//
// Ce module est POSÉ SUR l'existant, il ne le modifie pas : il lit data/games.js
// et n'utilise que des primitives déjà là (.panel, .item, .tf-btn, --q-*). Si ce
// fichier n'est pas chargé, la section Jeux fonctionne exactement comme avant —
// les deux boutons sont en .js-only, donc invisibles sans JavaScript.
//
// Une seule source de vérité pour « à quoi peut-on jouer » : playable(). Le
// randomizer ET le matchmaking passent par elle, donc aucun des deux ne peut
// proposer « La suite » (status: 'soon') ou un jeu sans moyen de le lancer.
(function () {
  // HUB vient de js/i18n.js. Déclaré en `const` au premier niveau d'un script
  // classique, il est global mais PAS une propriété de window : on le teste
  // donc avec typeof, pas avec window.HUB (qui vaut toujours undefined).
  const dict = () => (typeof HUB === 'undefined' ? {} : (HUB[window.LANG] || HUB.fr));
  const reduced = () => (typeof prefersReducedMotion === 'function' ? prefersReducedMotion() : false);
  const rand = (n) => Math.floor(Math.random() * n);
  const pick = (arr) => arr[rand(arr.length)];

  // --------------------------------------------------------------- données
  // Jouable = annoncé en ligne ET réellement lançable (une page ou une action
  // dans le navigateur). C'est volontairement plus strict que `status`.
  function playable() {
    if (typeof GAMES === 'undefined') return [];
    return GAMES.filter((g) => g.status === 'live' && (g.href || g.action));
  }

  // Titre dans la langue courante, en réutilisant le repli de js/templates.js.
  const titleOf = (g) => (typeof trLang === 'function' ? trLang(g, 'title', window.LANG) : g.title);
  const taglineOf = (g) => (typeof trLang === 'function' ? trLang(g, 'tagline', window.LANG) : g.tagline);
  const qualityOf = (g) =>
    (typeof GAME_QUALITY !== 'undefined' && GAME_QUALITY[g.accent]) || 'normal';

  // Lancer un jeu, quel que soit son mode : une page pour les jeux en ligne,
  // une fonction déjà exposée pour ceux qui tournent dans cette page.
  function launch(g) {
    if (!g) return;
    if (g.href) { window.location.href = g.href; return; }
    if (g.action === 'connect4' && typeof window.launchConnect4 === 'function') {
      close();
      window.launchConnect4();
    }
  }

  // --------------------------------------------------- coquille de fenêtre
  // Un seul dialogue partagé par les deux fonctionnalités : role="dialog"
  // aria-modal, Échap, piège à focus, focus rendu à l'élément d'origine,
  // défilement de la page bloqué. Même comportement que la fiche d'objet, en
  // plus petit — on ne réutilise pas js/itemmodal.js, qui rend des PROJETS et
  // des architectures, pas des écrans arbitraires.
  let root = null, opener = null, onClose = null;

  function isOpen() { return !!root; }

  // trigger : l'élément à qui rendre le focus. On ne se fie PAS à
  // document.activeElement — un clic programmé (ou un navigateur qui ne donne
  // pas le focus au bouton cliqué) laisserait le focus sur <body>, et la
  // fermeture le renverrait en haut de page.
  function open({ label, onEscape, trigger }) {
    close();
    opener = trigger || document.activeElement;
    onClose = onEscape || null;
    root = document.createElement('div');
    root.className = 'hub-overlay';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', label);
    root.innerHTML = '<div class="hub-backdrop"></div><div class="hub-panel panel"></div>';
    root.querySelector('.hub-backdrop').addEventListener('mousedown', close);
    document.body.appendChild(root);
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeys);
    return root.querySelector('.hub-panel');
  }

  function close() {
    if (!root) return;
    const cb = onClose;
    document.removeEventListener('keydown', onKeys);
    root.remove();
    root = null;
    onClose = null;
    document.body.style.overflow = '';
    if (opener && document.contains(opener)) opener.focus();
    opener = null;
    if (cb) cb();
  }

  function onKeys(e) {
    if (!isOpen() || e.defaultPrevented) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key !== 'Tab') return;
    const f = [...root.querySelectorAll('button, a[href], [tabindex]:not([tabindex="-1"])')]
      .filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  // Petit utilitaire : un bouton TF2, sans passer par innerHTML pour le texte.
  function btn(text, cls, fn) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tf-btn ' + (cls || '');
    b.textContent = text;
    b.addEventListener('click', fn);
    return b;
  }

  // Zone d'annonce : ce que le visuel raconte, écrit pour les lecteurs d'écran.
  function liveRegion(panel) {
    const el = document.createElement('p');
    el.className = 'hub-live sr-only';
    el.setAttribute('role', 'status');
    panel.appendChild(el);
    return el;
  }

  // ====================================================== 1. Caisse Mann Co.
  // Le gagnant est tiré AVANT l'animation : la roulette ne fait que le mettre
  // en scène. Conséquence utile — en mouvement réduit on saute directement à la
  // révélation sans changer le résultat, et un test peut forcer le tirage.
  function openCrate(trigger) {
    const D = dict();
    const games = playable();
    const panel = open({ label: D.crateTitle, trigger });

    const head = document.createElement('div');
    head.className = 'hub-head';
    head.innerHTML = `<p class="hub-kicker font-mono">${D.crateTitle}</p>`;
    panel.appendChild(head);

    if (!games.length) {                       // ceinture : données absentes
      const p = document.createElement('p');
      p.className = 'hub-empty muted';
      p.textContent = D.empty;
      panel.appendChild(p);
      const b = btn(D.close, 'tf-btn-sm', close);
      panel.appendChild(b);
      b.focus();
      return;
    }

    const winner = window.__hubForcedGame
      ? games.find((g) => g.id === window.__hubForcedGame) || pick(games)
      : pick(games);

    const crate = document.createElement('div');
    crate.className = 'hub-crate';
    crate.setAttribute('aria-hidden', 'true');   // décor : le texte est plus bas
    crate.innerHTML = `
      <div class="crate-lid"></div>
      <div class="crate-body"><span class="crate-mark">MANN CO.</span></div>
      <div class="crate-glow"></div>
      <div class="crate-reel"><div class="crate-strip"></div></div>`;
    panel.appendChild(crate);

    const hint = document.createElement('p');
    hint.className = 'hub-hint muted font-mono';
    hint.textContent = D.crateHint;
    panel.appendChild(hint);

    const result = document.createElement('div');
    result.className = 'hub-result';
    panel.appendChild(result);

    const actions = document.createElement('div');
    actions.className = 'hub-actions';
    panel.appendChild(actions);

    const live = liveRegion(panel);

    const strip = crate.querySelector('.crate-strip');
    const openBtn = btn(D.crateOpen, 'tf-btn-buy', roll);
    actions.appendChild(openBtn);
    actions.appendChild(btn(D.close, 'tf-btn-sm', close));
    openBtn.focus();

    function roll() {
      openBtn.disabled = true;
      live.textContent = D.crateRolling;
      crate.classList.add('is-open');

      if (reduced() || games.length === 1) { reveal(); return; }

      // La bande : ~24 vignettes tirées au hasard, le gagnant à l'avant-dernière
      // place (la dernière sert de marge pour le freinage).
      const cells = [];
      for (let i = 0; i < 24; i++) cells.push(pick(games));
      cells[22] = winner;
      strip.innerHTML = cells.map((g) =>
        `<span class="crate-cell" data-q="${qualityOf(g)}">${g.emoji} ${escapeHTML(titleOf(g))}</span>`).join('');

      // Une seule transition, pilotée par transform : pas de boucle JS.
      const cell = 64;                       // hauteur d'une vignette, en px
      strip.style.transition = 'none';
      strip.style.transform = 'translateY(0)';
      // reflow forcé, sinon la transition ne part pas
      void strip.offsetHeight;
      strip.style.transition = 'transform 2.4s cubic-bezier(.12,.72,.16,1)';
      strip.style.transform = `translateY(-${22 * cell}px)`;
      strip.addEventListener('transitionend', reveal, { once: true });
      // Filet : si la transition ne se déclenche pas (onglet en arrière-plan,
      // moteur qui l'avale), on révèle quand même.
      setTimeout(() => { if (!result.childElementCount) reveal(); }, 3200);
    }

    function reveal() {
      if (result.childElementCount) return;    // une seule fois
      crate.classList.add('is-done');
      result.innerHTML = `
        <div class="item hub-item" data-q="${qualityOf(winner)}">
          <div class="hub-item-emoji">${winner.emoji}</div>
          <p class="hub-item-got font-mono muted">${escapeHTML(D.crateGot)}</p>
          <h3 class="hub-item-name">${escapeHTML(titleOf(winner))}</h3>
          <p class="hub-item-tag font-mono">${escapeHTML(taglineOf(winner) || '')}</p>
        </div>`;
      live.textContent = `${D.crateGot} ${titleOf(winner)}`;
      actions.textContent = '';
      const playBtn = btn(D.play, 'tf-btn-buy', () => launch(winner));
      actions.appendChild(playBtn);
      const again = opener;   // capturé avant la fermeture, qui remet opener à null
      actions.appendChild(btn(D.crateAgain, 'tf-btn-sm', () => { close(); openCrate(again); }));
      actions.appendChild(btn(D.close, 'tf-btn-sm', close));
      playBtn.focus();
    }
  }

  // =================================================== 2. Trouver une partie
  // Faux matchmaking, et c'est annoncé en toutes lettres dans l'écran : aucun
  // serveur n'est interrogé. L'architecture laisse la porte ouverte — remplacer
  // buildMatch() par un vrai appel réseau suffirait, le reste ne bouge pas.
  function buildMatch(D, games) {
    const g = pick(games);
    const max = /4/.test(String(g.tags)) ? 4 : 6;
    return {
      game: g,
      map: pick(D.maps),
      players: `${2 + rand(Math.max(1, max - 2))}/${max}`,
      ping: `${18 + rand(40)} ms`,
      server: pick(['eu-west-3', 'fra1-mannco', 'reims-lan', 'render-free-tier']),
    };
  }

  function openMatchmaking(trigger) {
    const D = dict();
    const games = playable();
    const panel = open({ label: D.mmTitle, trigger });

    const head = document.createElement('div');
    head.className = 'hub-head';
    head.innerHTML = `<p class="hub-kicker font-mono">${D.mmTitle}</p>`;
    panel.appendChild(head);

    const log = document.createElement('ul');
    log.className = 'hub-log font-mono';
    panel.appendChild(log);

    const card = document.createElement('div');
    card.className = 'hub-match';
    panel.appendChild(card);

    const actions = document.createElement('div');
    actions.className = 'hub-actions';
    panel.appendChild(actions);

    const live = liveRegion(panel);

    if (!games.length) {                       // ceinture : aucune donnée
      const li = document.createElement('li');
      li.textContent = D.empty;
      log.appendChild(li);
      live.textContent = D.empty;
      const b = btn(D.close, 'tf-btn-sm', close);
      actions.appendChild(b);
      b.focus();
      return;
    }

    const cancel = btn(D.close, 'tf-btn-sm', close);
    actions.appendChild(cancel);
    cancel.focus();

    const t0 = Date.now();
    const timers = [];
    search();

    function search() {
      log.textContent = '';
      card.textContent = '';
      live.textContent = D.mmSteps[0];
      // En mouvement réduit on ne fait pas mijoter : les étapes s'affichent
      // d'un coup et le match tombe tout de suite.
      const step = reduced() ? 0 : 420;
      D.mmSteps.forEach((s, i) => {
        timers.push(setTimeout(() => {
          const li = document.createElement('li');
          li.className = 'hub-log-line';
          li.textContent = s;
          log.appendChild(li);
        }, step * i));
      });
      timers.push(setTimeout(found, step * (D.mmSteps.length + 0.6)));
    }

    function found() {
      const m = buildMatch(D, games);
      const secs = ((Date.now() - t0) / 1000).toFixed(1).replace('.', ',');
      const row = (k, v) => `<div class="hub-row"><dt>${escapeHTML(k)}</dt><dd>${escapeHTML(v)}</dd></div>`;
      card.innerHTML = `
        <p class="hub-found font-tf">${escapeHTML(D.mmFound)}</p>
        <dl class="hub-facts">
          ${row(D.mmGame, titleOf(m.game))}
          ${row(D.mmMap, m.map)}
          ${row(D.mmPlayers, m.players)}
          ${row(D.mmPing, m.ping)}
          ${row(D.mmServer, m.server)}
          ${row(D.mmElapsed, secs + ' s')}
        </dl>
        <p class="hub-fake muted font-mono">${escapeHTML(D.mmFake)}</p>`;
      live.textContent = `${D.mmFound} — ${titleOf(m.game)}, ${m.map}`;
      actions.textContent = '';
      const join = btn(D.mmJoin, 'tf-btn-buy', () => launch(m.game));
      actions.appendChild(join);
      // La blague : « bannir » relance simplement une recherche.
      actions.appendChild(btn(D.mmBan, 'tf-btn-sm', () => {
        live.textContent = D.mmBanned;
        actions.textContent = '';
        actions.appendChild(cancel);
        cancel.focus();
        search();
      }));
      actions.appendChild(btn(D.close, 'tf-btn-sm', close));
      join.focus();
    }

    // Les minuteries ne doivent pas survivre à la fermeture.
    onClose = () => timers.forEach(clearTimeout);
  }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ------------------------------------------------------------- branchement
  // Les libellés des deux boutons sont posés par data-i18n / data-i18n-aria,
  // comme le reste de la page : rien à ré-étiqueter au changement de langue.
  // Seuls les textes DES ÉCRANS vivent dans HUB, parce qu'ils sont construits
  // à l'ouverture — rouvrir après un passage en anglais suffit.
  document.addEventListener('DOMContentLoaded', () => {
    const crateBtn = document.getElementById('crate-btn');
    const mmBtn = document.getElementById('mm-btn');
    if (crateBtn) crateBtn.addEventListener('click', () => openCrate(crateBtn));
    if (mmBtn) mmBtn.addEventListener('click', () => openMatchmaking(mmBtn));
  });

  // Exposé pour les tests et la palette Ctrl+K.
  window.gameHub = { openCrate, openMatchmaking, playable, close, isOpen };
})();
