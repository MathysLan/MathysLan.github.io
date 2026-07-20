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
          <span class="font-mono text-xs px-3 py-1 rounded-full badge-violet">${tr(p, 'badge')}</span>
          <div class="flex items-center gap-3">${confBadge}${ghLink}</div>
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
    heroTitle.style.setProperty('--mx', `${e.clientX - r.left}px`);
    heroTitle.style.setProperty('--my', `${e.clientY - r.top}px`);
  });

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
