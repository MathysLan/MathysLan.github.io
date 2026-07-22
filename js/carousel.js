// Carousel 3D « coverflow » des jeux : les cartes tournent autour d'un point fixe.
// La carte au centre est nette et opaque ; les latérales reculent, tournent et
// s'estompent ; la plus lointaine passe derrière le centre avant de revenir.
// Rendu depuis data/games.js. Flèches, points, clavier, swipe, auto-rotation.
(function () {
  let index = 0;
  let autoTimer = null;
  const AUTO_MS = 4500;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Réglages visuels du coverflow
  const SPACING = 60;   // décalage horizontal par cran (% de largeur de carte)
  const DEPTH = 190;    // recul en profondeur par cran (px)
  const ROT = 42;       // rotation Y par cran (deg)

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
      <div class="glass rounded-3xl p-8 md:p-10 h-full flex flex-col">
        <div class="flex items-start justify-between gap-4 mb-5">
          <div class="game-emoji">${game.emoji}</div>
          <span class="font-mono text-xs ${accent} tracking-widest uppercase">${g(game, 'tagline')}</span>
        </div>
        <h3 class="font-display text-3xl md:text-4xl font-bold heading mb-3">${g(game, 'title')}</h3>
        <p class="muted text-sm md:text-base leading-relaxed flex-1">${g(game, 'desc')}</p>
        <div class="flex flex-wrap gap-2 mt-5">${tags}</div>
        ${stack ? `<div class="flex flex-wrap gap-2 mt-3 opacity-80">${stack}</div>` : ''}
        <div class="mt-7">${cta}</div>
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

  // Place chaque carte sur l'anneau selon son écart circulaire à la carte active.
  function update() {
    const track = document.getElementById('games-track');
    if (!track) return;
    const slides = track.querySelectorAll('.game-slide');
    const N = slides.length;

    slides.forEach((slide, i) => {
      let o = ((i - index) % N + N) % N;   // 0..N-1
      if (o > N / 2) o -= N;               // ramène dans [-N/2, N/2]
      const a = Math.abs(o);
      const backmost = (N % 2 === 0) && (a === N / 2); // pile derrière le centre

      let x, z, ry, s, op, zi;
      if (backmost) {
        x = 0; z = -DEPTH * 2.4; ry = 0; s = 0.78; op = 0.12; zi = 1;
      } else {
        const oc = Math.max(-2, Math.min(2, o)); // borne l'écartement visuel
        x = oc * SPACING;
        z = -Math.abs(oc) * DEPTH;
        ry = -oc * ROT;
        s = 1 - Math.abs(oc) * 0.13;
        op = a === 0 ? 1 : (a === 1 ? 0.55 : 0.25);
        zi = 100 - a;
      }

      slide.style.transform =
        `translateX(calc(-50% + ${x}%)) translateY(-50%) translateZ(${z}px) rotateY(${ry}deg) scale(${s})`;
      slide.style.opacity = op;
      slide.style.zIndex = zi;
      slide.classList.toggle('is-active', o === 0);
      slide.setAttribute('aria-hidden', o === 0 ? 'false' : 'true');
    });

    document.querySelectorAll('#games-dots .game-dot').forEach((d, i) =>
      d.classList.toggle('active', i === index));
  }

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

    // Clic sur une carte : si elle n'est pas au centre, on la ramène au centre
    // (et on bloque son lien) ; au centre, ses boutons/liens fonctionnent.
    const track = document.getElementById('games-track');
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

    // swipe tactile
    let x0 = null;
    const vp = document.getElementById('games-viewport');
    vp.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
    vp.addEventListener('touchend', (e) => {
      if (x0 === null) return;
      const dx = e.changedTouches[0].clientX - x0;
      if (Math.abs(dx) > 40) { dx < 0 ? next() : prev(); restartAuto(); }
      x0 = null;
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
