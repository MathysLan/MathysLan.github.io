// Command palette (Ctrl+K / Cmd+K) - navigation instantanée, zéro dépendance.
// Le DOM n'est construit qu'à la première ouverture : coût nul pour qui ne s'en sert pas.
(function () {
  let overlay = null, input, list, items = [], active = 0;

  const t = (fr, en) => (window.LANG === 'en' ? en : fr);
  const click = (id) => { const el = document.getElementById(id); if (el) el.click(); };

  // Recalculées à chaque ouverture : suivent la langue courante.
  function commands() {
    return [
      { icon: '§', label: t('Aller : Projets', 'Go: Projects'), hint: '01', run: () => jump('#projects') },
      { icon: '§', label: t('Aller : Parcours', 'Go: Journey'), hint: '02', run: () => jump('#timeline') },
      { icon: '§', label: t('Aller : Assos', 'Go: Community'), hint: '03', run: () => jump('#assos') },
      { icon: '§', label: t('Aller : Passions', 'Go: Hobbies'), hint: '04', run: () => jump('#passions') },
      { icon: '§', label: t('Aller : Jeux', 'Go: Games'), hint: '05', run: () => jump('#games') },
      { icon: '§', label: t('Aller : Contact', 'Go: Contact'), hint: '06', run: () => jump('#contact') },
      { icon: '◐', label: t('Changer de thème', 'Toggle theme'), run: () => click('theme-toggle') },
      { icon: 'Ⓐ', label: t('English version', 'Version française'), run: () => click('lang-toggle') },
      { icon: '@', label: t('Copier mon email', 'Copy my email'), run: copyMail },
      { icon: '↗', label: 'GitHub', run: () => window.open('https://github.com/MathysLan', '_blank', 'noopener') },
      { icon: '↗', label: 'Twitch', run: () => window.open('https://www.twitch.tv/nimu_08', '_blank', 'noopener') },
      { icon: '●', label: t('Lancer le Puissance 4', 'Launch Connect 4'), hint: 'jeu', run: () => window.launchConnect4 && window.launchConnect4() },
    ];
  }

  function build() {
    overlay = document.createElement('div');
    overlay.id = 'cmdk-overlay';
    overlay.innerHTML = '<div id="cmdk" role="dialog" aria-label="Palette de commandes">'
      + '<input type="text" autocomplete="off" spellcheck="false">'
      + '<div id="cmdk-list"></div></div>';
    document.body.appendChild(overlay);
    input = overlay.querySelector('input');
    list = overlay.querySelector('#cmdk-list');
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    input.addEventListener('input', () => render(input.value));
    input.addEventListener('keydown', onKeys);
  }

  function open() {
    if (!overlay) build();
    input.value = '';
    input.placeholder = t('Tape une commande…', 'Type a command…');
    overlay.classList.add('open');
    render('');
    input.focus();
  }

  function close() { if (overlay) overlay.classList.remove('open'); }
  const isOpen = () => overlay && overlay.classList.contains('open');

  function render(filter) {
    const f = filter.trim().toLowerCase();
    items = commands().filter((c) => c.label.toLowerCase().includes(f));
    active = 0;
    list.innerHTML = '';
    if (!items.length) {
      list.innerHTML = '<p class="cmdk-empty">' + t('0 rows selected.', '0 rows selected.') + '</p>';
      return;
    }
    items.forEach((c, i) => {
      const el = document.createElement('div');
      el.className = 'cmdk-item' + (i === 0 ? ' active' : '');
      el.innerHTML = '<span>' + c.icon + '</span><span>' + c.label + '</span>'
        + (c.hint ? '<span class="k">' + c.hint + '</span>' : '');
      el.addEventListener('click', () => { close(); c.run(); });
      el.addEventListener('mousemove', () => setActive(i));
      list.appendChild(el);
    });
  }

  function setActive(i) {
    active = i;
    [...list.children].forEach((el, j) => el.classList.toggle('active', j === i));
    const el = list.children[i];
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }

  function onKeys(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (items.length) setActive((active + 1) % items.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (items.length) setActive((active - 1 + items.length) % items.length); }
    else if (e.key === 'Enter') { e.preventDefault(); const c = items[active]; if (c) { close(); c.run(); } }
    else if (e.key === 'Escape') close();
  }

  function jump(sel) {
    close();
    const el = document.querySelector(sel);
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  }

  function copyMail() {
    navigator.clipboard.writeText('mathys.langiny@gmail.com').then(() => {
      open();
      input.placeholder = t('email copié ✔', 'email copied ✔');
    });
  }

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      isOpen() ? close() : open();
    }
  });
})();
