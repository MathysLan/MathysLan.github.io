// ============ Rendu des contenus depuis data/*.js ============
// Le balisage vit dans js/templates.js, partagé avec tools/build.mjs qui le
// pré-rend dans index.html. Ici on ne fait que (re)rendre quand la langue
// change : si le conteneur porte déjà la bonne langue (data-lang posé par le
// pré-rendu), on ne touche à rien — pas de redessin ni de rechargement d'image
// au chargement de la page.

// Mouvement réduit : lu AU MOMENT de l'animation, pas une fois au chargement —
// la préférence système peut changer pendant la visite. Global : carousel.js,
// palette.js et connect4.js s'en servent aussi.
function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
// Défilement doux… sauf si la personne a demandé moins de mouvement. Le CSS
// (scroll-behavior) ne couvre pas les défilements lancés en JS.
function scrollBehavior() {
  return prefersReducedMotion() ? 'auto' : 'smooth';
}

// Champ dans la langue active, avec repli sur le français.
function tr(obj, field) {
  return trLang(obj, field, window.LANG);
}

// Images d'un projet avec la légende dans la langue active
function localizedImages(p) {
  return p.images.map(img => ({ src: img.src, cap: tr(img, 'cap') }));
}

// Remplit un conteneur pour la langue active, sauf s'il y est déjà.
function renderInto(el, html) {
  if (!el || el.dataset.lang === window.LANG) return;
  el.innerHTML = html;
  el.dataset.lang = window.LANG;
}

// La section Projets est un sac à dos : une case carrée par projet, bordure
// colorée par la qualité, nom et rareté lisibles SANS rien ouvrir — c'est ce
// qui permet de balayer les huit projets d'un coup d'œil. Le détail (descriptif,
// stack, GitHub, captures) vit dans la modale de description d'objet.
//
// La qualité n'est pas décorative et ne classe pas : elle dit la NATURE du
// projet (strange = compte des statistiques, vintage = ancien mais tient
// encore, unusual = la pièce rare). Voir data/projects.js.
function renderProjects() {
  renderInto(document.getElementById('projects-grid'),
    PROJECTS.map((p, i) => projectCellHTML(p, i, window.LANG)).join(''));
  renderInto(document.getElementById('projects-sheets'),
    PROJECTS.map((p) => projectSheetHTML(p, window.LANG)).join(''));
}

// ============ Jeux vidéo préférés (data/favgames.js) ============
function renderFavGames() {
  if (typeof FAV_GAMES === 'undefined') return;
  renderInto(document.getElementById('fav-games'),
    FAV_GAMES.map((g) => favGameHTML(g, window.LANG)).join(''));
}

// ============ Interactions globales ============
document.addEventListener('DOMContentLoaded', () => {
  // Thème (persisté)
  const storedTheme = localStorage.getItem('theme') || 'dark';
  if (storedTheme === 'light') document.documentElement.classList.add('light');
  updateThemeIcon();

  document.getElementById('theme-toggle').addEventListener('click', () => {
    document.documentElement.classList.toggle('light');
    localStorage.setItem('theme', document.documentElement.classList.contains('light') ? 'light' : 'dark');
    updateThemeIcon();
  });

  function updateThemeIcon() {
    const light = document.documentElement.classList.contains('light');
    document.getElementById('icon-sun').style.display = light ? 'none' : 'block';
    document.getElementById('icon-moon').style.display = light ? 'block' : 'none';
  }

  // Langue (persistée) - applique les traductions et rend les projets
  applyLang(window.LANG);
  document.getElementById('lang-toggle').addEventListener('click', () => {
    applyLang(window.LANG === 'fr' ? 'en' : 'fr');
    setBurgerLabel();
    if (prefersReducedMotion()) showStaticTerm();
  });

  document.getElementById('year').textContent = new Date().getFullYear();

  // Spotlight du hero qui suit la souris
  const heroTitle = document.getElementById('hero-title');
  const hero = document.getElementById('hero');
  hero.addEventListener('mousemove', (e) => {
    const r = heroTitle.getBoundingClientRect();
    // Borné au titre : au-delà, la zone éclairée sort des lettres et les pleins
    // d'Anton retombent d'un bloc sur la teinte sombre du dégradé.
    const x = Math.max(0, Math.min(r.width, e.clientX - r.left));
    const y = Math.max(0, Math.min(r.height, e.clientY - r.top));
    heroTitle.style.setProperty('--mx', `${x}px`);
    heroTitle.style.setProperty('--my', `${y}px`);
  });

  // Poursuite de scène : le halo de chaque section suit le curseur. Amorti à 55 %
  // pour garder un mouvement lourd de projecteur, et réservé aux pointeurs précis
  // (au doigt il n'y a pas de survol, le halo resterait collé au dernier appui).
  const finePointer = window.matchMedia('(pointer: fine)').matches;
  const stillMode = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (finePointer && !stillMode) {
    const halos = [...document.querySelectorAll('.section-halo')];
    let queued = false, px = 0, py = 0;
    function placeHalos() {
      queued = false;
      // On lit toutes les positions AVANT d'écrire : mélanger les deux forcerait
      // un recalcul de mise en page à chaque tour de boucle.
      const visible = [];
      for (const halo of halos) {
        const r = halo.getBoundingClientRect();
        if (r.bottom > 0 && r.top < window.innerHeight) visible.push([halo, r]);
      }
      for (const [halo, r] of visible) {
        halo.style.setProperty('--hx', `${(px - (r.left + r.width / 2)) * 0.55}px`);
        halo.style.setProperty('--hy', `${(py - (r.top + r.height * 0.22)) * 0.55}px`);
      }
    }
    window.addEventListener('pointermove', (e) => {
      px = e.clientX; py = e.clientY;
      if (!queued) { queued = true; requestAnimationFrame(placeHalos); }
    }, { passive: true });
  }

  // Ligne de terminal auto-tapée (suit la langue active)
  const termEl = document.getElementById('term-line');
  let li = 0, ci = 0, deleting = false;
  // Mouvement réduit : pas de frappe, la première ligne s'affiche en entier.
  function showStaticTerm() {
    termEl.textContent = (TERM_LINES[window.LANG] || TERM_LINES.fr)[0];
    termEl.classList.remove('terminal-caret');
  }
  // Hors écran, la frappe s'arrête : elle réécrivait le terminal toutes les
  // 55 ms pendant toute la visite, même en bas de page.
  let heroInView = true, typingPaused = false;
  new IntersectionObserver((entries) => {
    heroInView = entries[0].isIntersecting;
    if (heroInView && typingPaused) { typingPaused = false; typeLoop(); }
  }).observe(document.getElementById('hero'));
  function typeLoop() {
    if (prefersReducedMotion()) { showStaticTerm(); return; }
    if (!heroInView) { typingPaused = true; return; }
    const lines = TERM_LINES[window.LANG] || TERM_LINES.fr;
    const line = lines[li % lines.length];
    if (!deleting) {
      ci++;
      if (ci >= line.length) { deleting = true; setTimeout(typeLoop, 2200); termEl.textContent = line; return; }
    } else {
      ci -= 3;
      if (ci <= 0) { ci = 0; deleting = false; li = (li + 1) % lines.length; }
    }
    termEl.textContent = line.slice(0, Math.max(0, ci));
    setTimeout(typeLoop, deleting ? 24 : 55);
  }
  typeLoop();

  // ConTracker : dépliage des contrats. L'en-tête est un <button>, donc Entrée,
  // Espace et le focus clavier sont gérés par le navigateur — il ne reste qu'à
  // basculer `hidden` et `aria-expanded`. Plusieurs contrats peuvent rester
  // ouverts : refermer celui qu'on vient de lire pour en ouvrir un autre est
  // une contrainte gratuite.
  document.querySelectorAll('.contract-head').forEach((head) => {
    head.addEventListener('click', () => {
      const body = document.getElementById(head.getAttribute('aria-controls'));
      if (!body) return;
      const open = head.getAttribute('aria-expanded') === 'true';
      head.setAttribute('aria-expanded', String(!open));
      body.hidden = open;
    });
  });

  // Guichet Mann Co. : le formulaire de contact n'envoie rien nulle part. Il
  // assemble un mailto: et laisse le client mail de la personne prendre le
  // relais - c'est la seule façon d'avoir un formulaire sur un site statique
  // sans faire transiter le message par un service tiers.
  const cf = document.getElementById('contact-form');
  if (cf) {
    const hint = document.getElementById('cf-hint');
    const capture = document.getElementById('cf-capture');
    const submit = cf.querySelector('[type="submit"]');
    cf.addEventListener('submit', (e) => {
      e.preventDefault();
      const dict = I18N[window.LANG] || I18N.fr;
      // Via cf.elements : sur un <form>, `cf.name` renverrait l'attribut name
      // du formulaire, pas le champ qui porte ce nom.
      const name = cf.elements.name.value.trim();
      const subject = cf.elements.subject.value.trim();
      const message = cf.elements.message.value.trim();
      if (!name || !subject || !message) {
        capture.hidden = true;
        hint.textContent = dict['contact.store.missing'];
        hint.classList.add('ac-red');
        return;
      }
      if (submit.disabled) return;          // une capture est déjà en cours
      hint.classList.remove('ac-red');
      hint.textContent = '';
      const body = `${message}\n\n-- ${name}`;
      const url = 'mailto:mathys.langiny@gmail.com'
        + `?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

      // La barre de capture, PUIS le client mail. Le texte ne prétend pas que
      // le message est parti : il ne part que du client mail de la personne.
      // Délai court exprès : un navigateur n'autorise l'ouverture d'un mailto:
      // que peu après le clic (activation utilisateur, ~5 s dans Chrome).
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const ms = reduced ? 0 : parseFloat(getComputedStyle(capture).getPropertyValue('--capture-ms')) || 0;
      capture.classList.remove('is-running', 'is-done');
      capture.hidden = false;
      void capture.offsetWidth;             // repart de 0 si on renvoie un second message
      capture.classList.add('is-running');
      submit.disabled = true;
      setTimeout(() => {
        capture.classList.replace('is-running', 'is-done');
        hint.textContent = dict['contact.store.sent'];
        submit.disabled = false;
        // Événement annulable juste avant l'ouverture : personne ne l'écoute sur
        // le site, mais tests/front.html l'annule pour vérifier l'URL sans
        // lancer de vrai client mail (en headless, ça bloque le navigateur).
        const go = cf.dispatchEvent(new CustomEvent('guichet:send', { detail: { url }, cancelable: true }));
        if (go) window.location.href = url;
      }, ms);
    });
  }

  // Au scroll : barre de progression, panneau de nav, section allumée.
  // Un seul écouteur, une seule passe par image (rAF), et toutes les LECTURES
  // de mise en page avant les ÉCRITURES : trois écouteurs séparés, dont un
  // lisait offsetTop juste après qu'un autre avait modifié des classes,
  // pouvaient forcer des recalculs de mise en page à chaque événement.
  const progressBar = document.getElementById('progress-bar');
  const navEl = document.querySelector('#navbar nav');
  const navLinks = [...document.querySelectorAll('#navbar .nav-link')];
  const navTargets = navLinks.map((a) => document.querySelector(a.getAttribute('href')));
  let scrollQueued = false;
  function onScrollFrame() {
    scrollQueued = false;
    // --- lectures ---
    const y = window.scrollY, vh = window.innerHeight;
    const docH = document.documentElement.scrollHeight;
    const tops = navTargets.map((s) => (s ? s.offsetTop : Infinity));
    // --- écritures ---
    progressBar.style.transform = `scaleX(${docH - vh > 0 ? y / (docH - vh) : 0})`;
    // Le panneau n'apparaît qu'une fois la page descendue : en haut, la barre
    // flotte directement sur l'affiche du hero.
    navEl.classList.toggle('panel', y > 20);
    // La section lue s'allume, repère au tiers haut de l'écran.
    const mark = y + vh * 0.35;
    let active = -1;
    tops.forEach((top, i) => { if (top <= mark) active = i; });
    // Le footer est plus court que le repère : arrivé en bas, il ne peut donc
    // jamais l'atteindre. Sans ce rattrapage, « Contact » ne s'allume jamais.
    if (y + vh >= docH - 2) active = navTargets.length - 1;
    navLinks.forEach((a, i) => a.classList.toggle('is-active', i === active));
  }
  window.addEventListener('scroll', () => {
    if (!scrollQueued) { scrollQueued = true; requestAnimationFrame(onScrollFrame); }
  }, { passive: true });
  onScrollFrame();

  // Menu mobile. Fermé, il est `inert` : ni tabulable ni lu (avant, il n'était
  // qu'invisible et ses liens restaient atteignables au clavier). Ouvert : le
  // focus entre sur le premier lien, Tab tourne entre le burger et les liens,
  // Échap ferme et rend le focus au burger.
  const burger = document.getElementById('burger');
  const mobileMenu = document.getElementById('mobile-menu');
  const burgerLines = document.querySelectorAll('.burger-line');
  const mobileLinks = [...mobileMenu.querySelectorAll('a')];
  let menuOpen = false;
  function setBurgerLabel() {
    const dict = I18N[window.LANG] || I18N.fr;
    burger.setAttribute('aria-label', dict[menuOpen ? 'a11y.menuClose' : 'a11y.menuOpen']);
  }
  function setMenu(open, returnFocus) {
    menuOpen = open;
    mobileMenu.classList.toggle('opacity-0', !open);
    mobileMenu.classList.toggle('pointer-events-none', !open);
    mobileMenu.inert = !open;
    burgerLines[0].style.transform = open ? 'translateY(8px) rotate(45deg)' : '';
    burgerLines[1].style.opacity = open ? '0' : '1';
    burgerLines[2].style.transform = open ? 'translateY(-8px) rotate(-45deg)' : '';
    document.body.style.overflow = open ? 'hidden' : '';
    burger.setAttribute('aria-expanded', String(open));
    setBurgerLabel();
    if (open) mobileLinks[0].focus();
    else if (returnFocus) burger.focus();
  }
  mobileMenu.inert = true;
  setBurgerLabel();
  burger.addEventListener('click', () => setMenu(!menuOpen, true));
  // Un lien mène ailleurs dans la page : on ferme sans ramener le focus au burger.
  mobileLinks.forEach((l) => l.addEventListener('click', () => { if (menuOpen) setMenu(false, false); }));
  document.addEventListener('keydown', (e) => {
    if (!menuOpen) return;
    if (e.key === 'Escape') { e.preventDefault(); setMenu(false, true); return; }
    if (e.key !== 'Tab') return;
    const ring = [burger, ...mobileLinks];
    const i = ring.indexOf(document.activeElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); ring[ring.length - 1].focus(); }
    else if (!e.shiftKey && (i === ring.length - 1 || i === -1)) { e.preventDefault(); ring[0].focus(); }
  });
  // Passage en largeur bureau menu ouvert (rotation, redimensionnement) : le
  // burger disparaît, le menu ne doit pas rester ouvert avec le scroll coupé.
  window.matchMedia('(min-width: 768px)').addEventListener('change', (mq) => {
    if (mq.matches && menuOpen) setMenu(false, false);
  });

  // Ancres avec offset
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', function (e) {
      const t = document.querySelector(this.getAttribute('href'));
      if (t) {
        e.preventDefault();
        window.scrollTo({ top: t.getBoundingClientRect().top + window.scrollY - 80, behavior: scrollBehavior() });
      }
    });
  });

  // Killfeed : à la première arrivée sur une section, une ligne s'affiche en
  // haut à droite puis disparaît. Une seule par section, jamais rejouée — sinon
  // ça devient du bruit à chaque aller-retour de scroll.
  const feed = document.getElementById('killfeed');
  if (feed) {
    // La clé d'arme de l'Engineer : c'est la classe qui construit et entretient.
    const wrench = '<svg class="kf-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>';
    const feedObs = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        feedObs.unobserve(en.target);
        const target = (KILLFEED[window.LANG] || KILLFEED.fr)[en.target.id];
        if (!target) return;
        const el = document.createElement('div');
        el.className = 'kf';
        const team = en.target.dataset.team || 'red';
        el.style.setProperty('--team', `var(--${team})`);          // bordure
        el.style.setProperty('--team-ink', `var(--${team}-ink)`);  // texte lisible
        el.innerHTML = `<span class="kf-who">Mathys</span>${wrench}<span class="kf-what"></span>`;
        el.querySelector('.kf-what').textContent = target;
        feed.appendChild(el);
        // En scroll rapide, plusieurs sections se déclenchent d'affilée : on
        // garde les trois dernières, au-delà ça devient un mur de texte.
        while (feed.children.length > 3) feed.firstElementChild.remove();
        setTimeout(() => {
          el.classList.add('out');
          setTimeout(() => el.remove(), 500);
        }, 4200);
      });
    }, { threshold: 0.25 });
    ['projects', 'timeline', 'assos', 'passions', 'games', 'contact']
      .forEach((id) => { const s = document.getElementById(id); if (s) feedObs.observe(s); });
  }

  // Reveal au scroll
  const obs = new IntersectionObserver((entries) => {
    entries.forEach(en => {
      if (en.isIntersecting) { en.target.classList.add('is-visible'); obs.unobserve(en.target); }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -50px 0px' });
  document.querySelectorAll('.reveal').forEach(el => obs.observe(el));

  // Ligne de timeline qui se dessine à l'entrée dans la section
  const tl = document.getElementById('timeline-line');
  if (tl) {
    new IntersectionObserver((entries, o) => {
      entries.forEach(en => {
        if (en.isIntersecting) { tl.classList.add('drawn'); o.unobserve(en.target); }
      });
    }, { threshold: 0.2 }).observe(tl.parentElement);
  }

  // Compteurs. La VRAIE valeur est dans le HTML (lecteurs d'écran, moteurs,
  // visite sans JS) ; l'animation n'est qu'une couche visuelle : on ne remet à 0
  // que si l'on va vraiment animer, et on finit toujours sur data-count.
  const counters = document.querySelectorAll('[data-count]');
  if (!prefersReducedMotion()) counters.forEach((el) => { el.textContent = '0'; });
  const countObs = new IntersectionObserver((entries) => {
    entries.forEach(en => {
      if (!en.isIntersecting) return;
      countObs.unobserve(en.target);
      const el = en.target;
      const target = parseInt(el.dataset.count, 10);
      if (prefersReducedMotion()) { el.textContent = target; return; }
      const dur = 1400;
      const t0 = performance.now();
      function tick(t) {
        const p = Math.min((t - t0) / dur, 1);
        el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
        if (p < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
  }, { threshold: 0.5 });
  counters.forEach(el => countObs.observe(el));
});
