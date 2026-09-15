// ============ Rendu des cartes projets depuis data/projects.js ============
function githubIcon() {
  return `<svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.57.1.78-.25.78-.55 0-.27-.01-1-.02-1.96-3.2.7-3.87-1.54-3.87-1.54-.53-1.33-1.29-1.69-1.29-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.56-.29-5.26-1.28-5.26-5.71 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.47.11-3.06 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.64 1.59.24 2.77.12 3.06.74.8 1.18 1.83 1.18 3.09 0 4.44-2.7 5.42-5.28 5.7.42.36.78 1.07.78 2.16 0 1.56-.02 2.82-.02 3.2 0 .31.21.67.79.55A10.51 10.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z"/></svg>`;
}

// Renvoie le champ dans la langue active, avec repli sur le français
function tr(obj, field) {
  if (window.LANG === 'en' && obj[field + '_en']) return obj[field + '_en'];
  return obj[field];
}

// Images d'un projet avec la légende dans la langue active
function localizedImages(p) {
  return p.images.map(img => ({ src: img.src, cap: tr(img, 'cap') }));
}

// Le nom de qualité tel que les joueurs le lisent : il reste en anglais dans
// les deux langues (« un Strange », pas « un Étrange »).
function qualityLabel(q) {
  if (q === 'collectors') return "Collector's";
  return q;
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
  const grid = document.getElementById('projects-grid');
  grid.innerHTML = PROJECTS.map((p, i) => {
    const q = p.quality || 'normal';
    // Un vrai <button> : focus clavier, Entrée et Espace viennent du navigateur.
    // aria-haspopup="dialog" annonce qu'il ouvre une fenêtre, pas une page.
    // Pas de visuel ? L'initiale en filigrane, comme un objet sans icône dans
    // l'inventaire — jamais une case vide. Décorative, donc aria-hidden.
    const thumb = p.cover
      ? `<img src="${p.cover}" alt="" loading="lazy"
              class="bp-img ${p.coverFit === 'contain' ? 'is-contain' : ''}">`
      : `<span class="bp-noimg font-display" aria-hidden="true">${tr(p, 'title').charAt(0)}</span>`;

    return `
    <button type="button" class="reveal is-visible item bp-cell" data-q="${q}" data-index="${i}"
            aria-haspopup="dialog">
      <span class="bp-thumb panel-inset">
        ${thumb}
        <span class="q-badge bp-q" data-q="${q}">★ ${qualityLabel(q)}</span>
        ${p.confidential ? '<span class="bp-lock" aria-hidden="true">🔒</span>' : ''}
      </span>
      <span class="item-label bp-name">${tr(p, 'title')}</span>
    </button>`;
  }).join('');
}

// ============ Jeux vidéo préférés (data/favgames.js) ============
function renderFavGames() {
  const grid = document.getElementById('fav-games');
  if (!grid || typeof FAV_GAMES === 'undefined') return;
  grid.innerHTML = FAV_GAMES.map(g => {
    const src = g.img || (g.steam ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.steam}/header.jpg` : '');
    const style = g.bg ? ` style="background:${g.bg}"` : '';
    // L'image (object-cover) recouvre l'emoji quand elle charge ; si elle échoue,
    // onerror la retire et l'emoji reste sur le fond dégradé. Jamais de carte vide.
    const img = src
      ? `<img src="${src}" alt="${tr(g, 'name')}" loading="lazy" class="fav-img" onerror="this.remove()">`
      : '';
    return `
    <div class="item fav-game" data-q="${g.quality || 'normal'}">
      <div class="fav-cover panel-inset"${style}>
        <span class="fav-emoji">${g.emoji}</span>
        ${img}
      </div>
      <p class="fav-note">${tr(g, 'note')}</p>
      <p class="item-label fav-name">${tr(g, 'name')}</p>
    </div>`;
  }).join('');
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
  function typeLoop() {
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
    cf.addEventListener('submit', (e) => {
      e.preventDefault();
      const dict = I18N[window.LANG] || I18N.fr;
      // Via cf.elements : sur un <form>, `cf.name` renverrait l'attribut name
      // du formulaire, pas le champ qui porte ce nom.
      const name = cf.elements.name.value.trim();
      const subject = cf.elements.subject.value.trim();
      const message = cf.elements.message.value.trim();
      if (!name || !subject || !message) {
        hint.textContent = dict['contact.store.missing'];
        hint.classList.add('ac-red');
        return;
      }
      hint.classList.remove('ac-red');
      hint.textContent = dict['contact.store.sent'];
      const body = `${message}\n\n-- ${name}`;
      window.location.href = 'mailto:mathys.langiny@gmail.com'
        + `?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    });
  }

  // Barre de progression
  const progressBar = document.getElementById('progress-bar');
  function updateProgress() {
    const dh = document.documentElement.scrollHeight - window.innerHeight;
    progressBar.style.transform = `scaleX(${dh > 0 ? window.scrollY / dh : 0})`;
  }
  window.addEventListener('scroll', updateProgress, { passive: true });
  updateProgress();

  // Nav : le panneau n'apparaît qu'une fois la page descendue. En haut, la
  // barre de sélection de classe flotte directement sur l'affiche du hero.
  const navbar = document.getElementById('navbar');
  function updateNavbar() {
    navbar.querySelector('nav').classList.toggle('panel', window.scrollY > 20);
  }
  window.addEventListener('scroll', updateNavbar, { passive: true });
  updateNavbar();

  // Nav : la section en cours de lecture s'allume. Le repère est pris au tiers
  // haut de l'écran, pas en haut : une section s'allume quand on la lit vraiment.
  const navLinks = [...document.querySelectorAll('#navbar .nav-link')];
  const navTargets = navLinks.map((a) => document.querySelector(a.getAttribute('href')));
  function updateSpy() {
    const mark = window.scrollY + window.innerHeight * 0.35;
    let active = -1;
    navTargets.forEach((s, i) => { if (s && s.offsetTop <= mark) active = i; });
    // Le footer est plus court que le repère : arrivé en bas, il ne peut donc
    // jamais l'atteindre. Sans ce rattrapage, « Contact » ne s'allume jamais.
    if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2) {
      active = navTargets.length - 1;
    }
    navLinks.forEach((a, i) => a.classList.toggle('is-active', i === active));
  }
  window.addEventListener('scroll', updateSpy, { passive: true });
  updateSpy();

  // Menu mobile
  const burger = document.getElementById('burger');
  const mobileMenu = document.getElementById('mobile-menu');
  const burgerLines = document.querySelectorAll('.burger-line');
  let menuOpen = false;
  function toggleMenu() {
    menuOpen = !menuOpen;
    mobileMenu.classList.toggle('opacity-0', !menuOpen);
    mobileMenu.classList.toggle('pointer-events-none', !menuOpen);
    burgerLines[0].style.transform = menuOpen ? 'translateY(8px) rotate(45deg)' : '';
    burgerLines[1].style.opacity = menuOpen ? '0' : '1';
    burgerLines[2].style.transform = menuOpen ? 'translateY(-8px) rotate(-45deg)' : '';
    document.body.style.overflow = menuOpen ? 'hidden' : '';
  }
  burger.addEventListener('click', toggleMenu);
  document.querySelectorAll('.mobile-link').forEach(l =>
    l.addEventListener('click', () => { if (menuOpen) toggleMenu(); }));

  // Ancres avec offset
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', function (e) {
      const t = document.querySelector(this.getAttribute('href'));
      if (t) {
        e.preventDefault();
        window.scrollTo({ top: t.getBoundingClientRect().top + window.scrollY - 80, behavior: 'smooth' });
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

  // Compteurs animés
  const countObs = new IntersectionObserver((entries) => {
    entries.forEach(en => {
      if (!en.isIntersecting) return;
      countObs.unobserve(en.target);
      const el = en.target;
      const target = parseInt(el.dataset.count, 10);
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
  document.querySelectorAll('[data-count]').forEach(el => countObs.observe(el));
});
