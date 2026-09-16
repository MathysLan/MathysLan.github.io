// Carousel 3D « coverflow » des jeux : les cartes tournent autour d'un point fixe.
// La carte au centre est nette et opaque ; les latérales reculent, tournent et
// s'estompent ; la plus lointaine passe derrière avant de revenir. On peut faire
// glisser à la souris/au doigt (suivi en direct puis snap). Rendu depuis data/games.js.
(function () {
  let index = 0;       // carte cible (entier)
  let autoTimer = null;
  const AUTO_MS = 4500;
  let paused = false;   // pause demandée par le bouton : prime sur tout le reste
  let inView = false;   // pas de rotation hors écran : travail inutile

  // Réglages visuels du coverflow
  const SPACING = 84;   // écartement horizontal par cran (% de largeur de carte) — le « rayon »
  const DEPTH = 210;    // recul en profondeur par cran (px)
  const ROT = 46;       // rotation Y par cran (deg)
  const FADE = 0.58;    // vitesse d'estompage des cartes latérales

  // Le balisage d'une carte vit dans js/templates.js (gameSlideHTML), partagé
  // avec le pré-rendu de tools/build.mjs.
  const g = (obj, f) => trLang(obj, f, window.LANG);

  function render() {
    const track = document.getElementById('games-track');
    const dots = document.getElementById('games-dots');
    if (!track) return;
    const en = window.LANG === 'en';
    // Pré-rendu déjà dans la bonne langue : on garde les cartes telles quelles.
    if (track.dataset.lang !== window.LANG) {
      track.innerHTML = GAMES.map((game, i) => gameSlideHTML(game, i, window.LANG)).join('');
      track.dataset.lang = window.LANG;
    }
    // Les points portent le nom du jeu : « Jeu 4 » ne disait rien à l'oreille.
    dots.innerHTML = GAMES.map((game, i) =>
      `<button type="button" class="game-dot" data-i="${i}" aria-label="${g(game, 'title')}"></button>`).join('');
    dots.querySelectorAll('.game-dot').forEach((d) =>
      d.addEventListener('click', () => { go(+d.dataset.i); restartAuto(); }));

    index = Math.min(index, GAMES.length - 1);
    update();
  }

  // Place les cartes pour une position `p` (fractionnaire pendant un glissement).
  function applyLayout(p) {
    const track = document.getElementById('games-track');
    if (!track) return;
    const slides = track.querySelectorAll('.game-slide');
    const N = slides.length;

    slides.forEach((slide, i) => {
      let o = ((i - p) % N + N) % N;   // 0..N
      if (o > N / 2) o -= N;           // -N/2 .. N/2
      const a = Math.abs(o);
      const aCap = Math.min(a, 2);

      const x = Math.sign(o) * Math.min(a, 1.5) * SPACING; // écartement, plafonné
      const z = -aCap * DEPTH;                              // recul
      const ry = -Math.max(-2, Math.min(2, o)) * ROT;
      const s = 1 - aCap * 0.13;
      const op = Math.max(0.08, 1 - a * FADE);             // le centre ressort

      slide.style.transform =
        `translateX(calc(-50% + ${x}%)) translateY(-50%) translateZ(${z}px) rotateY(${ry}deg) scale(${s})`;
      slide.style.opacity = op;
      slide.style.zIndex = 200 - Math.round(a * 10);
      slide.classList.toggle('is-active', a < 0.5);
    });

    const activeDot = ((Math.round(p) % N) + N) % N;
    document.querySelectorAll('#games-dots .game-dot').forEach((d, i) => {
      d.classList.toggle('active', i === activeDot);
      if (i === activeDot) d.setAttribute('aria-current', 'true');
      else d.removeAttribute('aria-current');
    });
  }

  const update = () => applyLayout(index);
  const go = (i) => { index = (i + GAMES.length) % GAMES.length; update(); };
  const next = () => go(index + 1);
  const prev = () => go(index - 1);

  function restartAuto() {
    clearInterval(autoTimer);
    if (paused || !inView || prefersReducedMotion()) return;
    autoTimer = setInterval(next, AUTO_MS);
  }

  function setPaused(p) {
    paused = p;
    const btn = document.getElementById('games-pause');
    const dict = I18N[window.LANG] || I18N.fr;
    btn.setAttribute('aria-pressed', String(p));
    btn.setAttribute('aria-label', dict[p ? 'a11y.play' : 'a11y.pause']);
    btn.dataset.i18nAria = p ? 'a11y.play' : 'a11y.pause';
    btn.classList.toggle('is-paused', p);
    restartAuto();
  }

  function init() {
    const root = document.getElementById('games-carousel');
    if (!root || typeof GAMES === 'undefined') return;
    render();

    document.getElementById('games-prev').addEventListener('click', () => { prev(); restartAuto(); });
    document.getElementById('games-next').addEventListener('click', () => { next(); restartAuto(); });
    const pauseBtn = document.getElementById('games-pause');
    pauseBtn.addEventListener('click', () => setPaused(!paused));
    // En mouvement réduit il n'y a pas de rotation : le bouton n'aurait rien à mettre en pause.
    pauseBtn.hidden = prefersReducedMotion();

    // Rotation seulement quand le carousel est à l'écran.
    new IntersectionObserver((entries) => {
      inView = entries[0].isIntersecting;
      restartAuto();
    }, { threshold: 0.2 }).observe(root);

    const track = document.getElementById('games-track');
    const vp = document.getElementById('games-viewport');

    // --- glisser (souris + tactile via Pointer Events), suivi en direct puis snap ---
    // On ne DÉMARRE le drag (et ne capture le pointeur) qu'après un vrai seuil de
    // déplacement : un simple clic ne capture rien → le lien « Jouer » fonctionne.
    let down = false, drag = false, suppressClick = false, x0 = 0, posStart = 0, pid = null;
    const unit = () => vp.clientWidth * 0.55; // pixels pour avancer d'une carte
    const DRAG_THRESHOLD = 6;

    vp.addEventListener('pointerdown', (e) => {
      down = true; drag = false; suppressClick = false; x0 = e.clientX; posStart = index; pid = e.pointerId;
    });
    vp.addEventListener('pointermove', (e) => {
      if (!down) return;
      const dx = e.clientX - x0;
      if (!drag) {
        if (Math.abs(dx) < DRAG_THRESHOLD) return; // pas encore un glissement : laisse passer les clics
        drag = true;
        clearInterval(autoTimer);
        root.classList.add('dragging');            // coupe les transitions pour un suivi direct
        try { vp.setPointerCapture(pid); } catch (_) { /* ok */ }
      }
      applyLayout(posStart - dx / unit());          // glissement fluide
    });
    function endDrag(e) {
      if (!down) return;
      down = false;
      if (drag) { // c'était un vrai glissement → snap, et on avale le clic parasite
        root.classList.remove('dragging');
        const dx = (e.clientX ?? x0) - x0;
        suppressClick = true;
        setTimeout(() => { suppressClick = false; }, 350); // filet : ne bloque que le clic parasite immédiat
        index = ((Math.round(posStart - dx / unit()) % GAMES.length) + GAMES.length) % GAMES.length;
        update();
        restartAuto();
      }
      drag = false;
      // simple clic (pas de glissement) : on ne fait rien ici → le clic natif suit son cours
    }
    vp.addEventListener('pointerup', endDrag);
    vp.addEventListener('pointercancel', endDrag);

    // avale le clic parasite émis juste après un glissement (capture, avant les liens)
    track.addEventListener('click', (e) => {
      if (suppressClick) { suppressClick = false; e.preventDefault(); e.stopPropagation(); }
    }, true);

    // clic simple (pas un glissement) : carte latérale → au centre ; carte active → ses liens
    track.addEventListener('click', (e) => {
      const slide = e.target.closest('.game-slide');
      if (!slide) return;
      const i = [...track.children].indexOf(slide);
      if (i !== index) { e.preventDefault(); go(i); restartAuto(); return; }
      const action = e.target.closest('[data-action="connect4"]');
      if (action) window.launchConnect4 && window.launchConnect4();
      // Bouton « Architecture » : la fiche technique du jeu, en modale.
      const arch = e.target.closest('[data-arch]');
      if (arch && window.openGameSheet) window.openGameSheet(+arch.dataset.arch, arch);
    });

    // clavier quand le carousel a le focus
    root.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') { prev(); restartAuto(); }
      else if (e.key === 'ArrowRight') { next(); restartAuto(); }
      // Comme la sélection de classe dans TF2 : une touche = un jeu. Le numéro
      // affiché sur chaque carte n'est donc pas décoratif.
      else if (/^[1-9]$/.test(e.key)) {
        const i = +e.key - 1;
        if (i < GAMES.length) { e.preventDefault(); go(i); restartAuto(); }
      }
    });

    // pause l'auto-rotation au survol / focus
    root.addEventListener('mouseenter', () => clearInterval(autoTimer));
    root.addEventListener('mouseleave', restartAuto);
    root.addEventListener('focusin', (e) => {
      clearInterval(autoTimer);
      // Tab sur le lien d'une carte latérale (presque transparente) : la carte
      // vient au centre, sinon le focus est sur quelque chose qu'on ne voit pas.
      const slide = e.target.closest && e.target.closest('.game-slide');
      if (slide) {
        const i = [...track.children].indexOf(slide);
        if (i !== -1 && i !== index) go(i);
      }
    });
    root.addEventListener('focusout', (e) => {
      if (!root.contains(e.relatedTarget)) restartAuto();
    });
  }

  // rerender quand la langue change (applyLang déclenche renderGames)
  window.renderGames = render;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
