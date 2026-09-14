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

function renderProjects() {
  const grid = document.getElementById('projects-grid');
  const en = window.LANG === 'en';
  grid.innerHTML = PROJECTS.map((p, i) => {
    const wide = p.size === 'lg' ? 'sm:col-span-2' : '';
    const chips = p.stack.map(s =>
      `<span class="font-mono text-[11px] px-2.5 py-1 rounded-md chip">${s}</span>`
    ).join('');
    // Estampille de qualité TF2 : le nom de qualité reste en anglais dans les
    // deux langues, c'est ainsi que les joueurs le lisent (« un Strange », pas
    // « un Étrange »).
    const quality = p.quality
      ? `<span class="q-badge" data-q="${p.quality}">★ ${p.quality === 'collectors' ? "Collector's" : p.quality}</span>`
      : '';
    const confBadge = p.confidential
      ? `<span class="font-mono text-[11px] px-2.5 py-1 rounded-full conf-badge font-medium">${en ? 'confidential' : 'confidentiel'}</span>`
      : '';
    const ghLink = p.github
      ? `<a href="${p.github}" target="_blank" rel="noopener noreferrer" aria-label="GitHub" class="muted-icon transition-colors" onclick="event.stopPropagation()">${githubIcon()}</a>`
      : '';
    const imgCount = p.images.length > 1
      ? `<span class="absolute bottom-3 right-3 font-mono text-[11px] px-2.5 py-1 rounded-full bg-black/60 backdrop-blur text-gray-200 border border-white/10">${p.images.length} captures ↗</span>`
      : '';
    const cover = p.cover ? `
      <div class="relative h-52 ${p.size === 'lg' ? 'md:h-64' : ''} overflow-hidden rounded-t-2xl cover-bg">
        <img src="${p.cover}" alt="${tr(p, 'title')}" loading="lazy"
             class="card-img w-full h-full ${p.coverFit === 'contain' ? 'object-contain p-6' : 'object-cover object-top'}">
        <div class="absolute inset-0 cover-fade"></div>
        ${imgCount}
      </div>` : '';

    return `
    <article class="reveal is-visible tilt-card glass rounded-2xl overflow-hidden ${wide} ${p.images.length ? 'cursor-pointer' : ''}"
             ${p.images.length ? `onclick="openLightbox(localizedImages(PROJECTS[${i}]), 0)" role="button" tabindex="0" aria-label="${tr(p, 'title')}"` : ''}>
      ${cover}
      <div class="p-7">
        <div class="flex items-start justify-between gap-4 mb-3">
          <div class="flex flex-wrap items-center gap-2.5">
            ${quality}
            <span class="font-mono text-[11px] muted">${tr(p, 'badge')}</span>
          </div>
          <div class="flex items-center gap-3 shrink-0">${confBadge}${ghLink}</div>
        </div>
        <h3 class="font-display text-xl md:text-2xl font-semibold mb-2 heading">${tr(p, 'title')}</h3>
        <p class="muted text-sm leading-relaxed">${tr(p, 'desc')}</p>
        <div class="flex flex-wrap gap-2 mt-5">${chips}</div>
      </div>
    </article>`;
  }).join('');

  grid.querySelectorAll('[role="button"]').forEach(el => {
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); }
    });
  });
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
    <div class="fav-game">
      <div class="fav-cover"${style}>
        <span class="fav-emoji">${g.emoji}</span>
        ${img}
      </div>
      <p class="fav-name">${tr(g, 'name')}</p>
      <p class="fav-note">${tr(g, 'note')}</p>
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

  // Barre de progression
  const progressBar = document.getElementById('progress-bar');
  function updateProgress() {
    const dh = document.documentElement.scrollHeight - window.innerHeight;
    progressBar.style.transform = `scaleX(${dh > 0 ? window.scrollY / dh : 0})`;
  }
  window.addEventListener('scroll', updateProgress, { passive: true });
  updateProgress();

  // Nav : fond au scroll
  const navbar = document.getElementById('navbar');
  function updateNavbar() {
    if (window.scrollY > 20) {
      navbar.querySelector('nav').classList.add('glass');
    } else {
      navbar.querySelector('nav').classList.remove('glass');
    }
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
