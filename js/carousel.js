// Carousel 3D « coverflow » des jeux : les cartes tournent autour d'un point fixe.
// La carte au centre est nette et opaque ; les latérales reculent, tournent et
// s'estompent ; la plus lointaine passe derrière avant de revenir. On peut faire
// glisser à la souris/au doigt (suivi en direct puis snap). Rendu depuis data/games.js.
(function () {
  let index = 0;       // carte cible (entier)
  let autoTimer = null;
  const AUTO_MS = 4500;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Réglages visuels du coverflow
  const SPACING = 84;   // écartement horizontal par cran (% de largeur de carte) — le « rayon »
  const DEPTH = 210;    // recul en profondeur par cran (px)
  const ROT = 46;       // rotation Y par cran (deg)
  const FADE = 0.58;    // vitesse d'estompage des cartes latérales

  const trAcc = { violet: 'text-violet-400', amber: 'text-amber-300', mint: 'text-emerald-300' };
  const g = (obj, f) => (window.LANG === 'en' && obj[f + '_en'] !== undefined ? obj[f + '_en'] : obj[f]);

  function slideHTML(game) {
    const en = window.LANG === 'en';
    const accent = trAcc[game.accent] || 'text-violet-400';
    const tags = (g(game, 'tags') || []).map((t) =>
      `<span class="font-mono text-[11px] px-2.5 py-1 rounded-full chip">${t}</span>`).join('');
    const stack = (game.stack || []).map((s) =>
      `<span class="font-mono text-[11px] px-2.5 py-1 rounded-md chip">${s}</span>`).join('');

    let cta;
    if (game.status === 'soon') {
      cta = `<span class="game-cta game-cta-soon font-mono text-sm">
               <span class="live-dot inline-block w-2 h-2 rounded-full bg-emerald-400"></span>
               ${en ? 'coming soon' : 'bientôt'}
             </span>`;
    } else if (game.href) {
      cta = `<a href="${game.href}" class="game-cta btn-glow inline-flex items-center gap-2 text-white font-semibold">
               ${en ? 'Play' : 'Jouer'}
               <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
             </a>`;
    } else {
      cta = `<button data-action="${game.action}" class="game-cta btn-glow inline-flex items-center gap-2 text-white font-semibold">
               ${en ? 'Play' : 'Jouer'} ▸
             </button>`;
    }

    return `
    <div class="game-slide" role="group" aria-roledescription="${en ? 'slide' : 'diapositive'}" aria-label="${g(game, 'title')}">
      <div class="glass rounded-3xl p-7 md:p-9 h-full flex flex-col">
        <div class="flex items-start justify-between gap-4 mb-4">
          <div class="game-emoji">${game.emoji}</div>
          <span class="font-mono text-xs ${accent} tracking-widest uppercase">${g(game, 'tagline')}</span>
        </div>
        <h3 class="font-display text-2xl md:text-3xl font-bold heading mb-3">${g(game, 'title')}</h3>
        <p class="muted text-sm leading-relaxed game-desc">${g(game, 'desc')}</p>
        <div class="flex flex-wrap gap-2 mt-4">${tags}</div>
        ${stack ? `<div class="flex flex-wrap gap-2 mt-2 opacity-80">${stack}</div>` : ''}
        <div class="mt-6">${cta}</div>
      </div>
    </div>`;
  }

  function render() {
    const track = document.getElementById('games-track');
    const dots = document.getElementById('games-dots');
    if (!track) return;
    const en = window.LANG === 'en';
    track.innerHTML = GAMES.map(slideHTML).join('');
    dots.innerHTML = GAMES.map((_, i) =>
      `<button class="game-dot" data-i="${i}" aria-label="${(en ? 'Game ' : 'Jeu ') + (i + 1)}"></button>`).join('');
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
    document.querySelectorAll('#games-dots .game-dot').forEach((d, i) =>
      d.classList.toggle('active', i === activeDot));
  }

  const update = () => applyLayout(index);
  const go = (i) => { index = (i + GAMES.length) % GAMES.length; update(); };
  const next = () => go(index + 1);
  const prev = () => go(index - 1);

  function restartAuto() {
    if (reduceMotion) return;
    clearInterval(autoTimer);
    autoTimer = setInterval(next, AUTO_MS);
  }

  function init() {
    const root = document.getElementById('games-carousel');
    if (!root || typeof GAMES === 'undefined') return;
    render();

    document.getElementById('games-prev').addEventListener('click', () => { prev(); restartAuto(); });
    document.getElementById('games-next').addEventListener('click', () => { next(); restartAuto(); });

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
    });

    // clavier quand le carousel a le focus
    root.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') { prev(); restartAuto(); }
      else if (e.key === 'ArrowRight') { next(); restartAuto(); }
    });

    // pause l'auto-rotation au survol / focus
    root.addEventListener('mouseenter', () => clearInterval(autoTimer));
    root.addEventListener('mouseleave', restartAuto);
    root.addEventListener('focusin', () => clearInterval(autoTimer));
    root.addEventListener('focusout', restartAuto);

    restartAuto();
  }

  // rerender quand la langue change (applyLang déclenche renderGames)
  window.renderGames = render;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
