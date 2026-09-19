// « Je joue à quoi ? » : un tirage SOLO, sur cette page, sans session.
//
// ⚠️ DEUX TIRAGES, DEUX USAGES — ils ne se contredisent pas :
//   - ici, une caisse Mann Co. tire un jeu pour TOI, tout de suite, dans le
//     navigateur. Aucun groupe, aucun serveur : c'est une idée de jeu ;
//   - le mode GROUPE est le Game Hub (games/) : une vraie session, et c'est le
//     serveur du Hub qui tire, selon les joueurs présents, leurs vetos, leurs
//     micros et la santé des serveurs. La caisse d'ici y renvoie par un lien.
// (L'ancien « Trouver une partie » — un faux matchmaking qui affichait un
// « match trouvé » sans aucun serveur — a été retiré : il prétendait trouver
// un groupe, ce qu'il ne faisait pas. Le vrai mode groupe existe maintenant.)
//
// Ce module est POSÉ SUR l'existant, il ne le modifie pas : il lit data/games.js
// et n'utilise que des primitives déjà là (.panel, .item, .tf-btn, --q-*). Si ce
// fichier n'est pas chargé, la section Jeux fonctionne exactement comme avant —
// le bouton est en .js-only, donc invisible sans JavaScript.
//
// Une seule source de vérité pour « à quoi peut-on jouer » ici : playable().
// Elle ne peut pas proposer « La suite » (status: 'soon') ni un jeu sans moyen
// de le lancer.
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

    // Le mode groupe n'est pas ici : on y renvoie, franchement.
    const group = document.createElement('a');
    group.className = 'hub-group-link';
    group.href = 'games/';
    group.textContent = D.crateGroup;
    panel.appendChild(group);

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

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ------------------------------------------------------------- branchement
  // Le libellé du bouton est posé par data-i18n / data-i18n-aria, comme le
  // reste de la page : rien à ré-étiqueter au changement de langue. Seuls les
  // textes DE L'ÉCRAN vivent dans HUB, parce qu'il est construit à l'ouverture
  // — rouvrir après un passage en anglais suffit.
  document.addEventListener('DOMContentLoaded', () => {
    const crateBtn = document.getElementById('crate-btn');
    if (crateBtn) crateBtn.addEventListener('click', () => openCrate(crateBtn));
  });

  // Exposé pour les tests et la palette Ctrl+K.
  window.gameHub = { openCrate, playable, close, isOpen };
})();
