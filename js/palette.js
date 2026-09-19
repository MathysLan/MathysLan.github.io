// Command palette (Ctrl+K / Cmd+K) - navigation instantanée, zéro dépendance.
// Le DOM n'est construit qu'à la première ouverture : coût nul pour qui ne s'en sert pas.
(function () {
  let overlay = null, dialog, input, list, items = [], active = 0;
  let opener = null;   // l'élément qui avait le focus, rendu à la fermeture

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
      { icon: '▶', label: t('Ouvrir le Game Hub (jouer entre amis)', 'Open the Game Hub (play with friends)'), hint: 'hub', run: () => { window.location.href = 'games/'; } },
      { icon: '●', label: t('Lancer le Puissance 4', 'Launch Connect 4'), hint: 'jeu', run: () => window.launchConnect4 && window.launchConnect4() },
    ];
  }

  function build() {
    overlay = document.createElement('div');
    overlay.id = 'cmdk-overlay';
    // Motif « combobox + listbox » : le focus reste dans le champ, la commande
    // active est annoncée via aria-activedescendant.
    overlay.innerHTML = '<div id="cmdk" role="dialog" aria-modal="true">'
      + '<input type="text" autocomplete="off" spellcheck="false" role="combobox"'
      + ' aria-expanded="true" aria-controls="cmdk-list" aria-autocomplete="list">'
      + '<div id="cmdk-list" role="listbox"></div></div>';
    document.body.appendChild(overlay);
    dialog = overlay.querySelector('#cmdk');
    input = overlay.querySelector('input');
    list = overlay.querySelector('#cmdk-list');
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    input.addEventListener('input', () => render(input.value));
    input.addEventListener('keydown', onKeys);
  }

  function open() {
    if (!overlay) build();
    if (!isOpen()) opener = document.activeElement;
    input.value = '';
    input.placeholder = t('Tape une commande…', 'Type a command…');
    dialog.setAttribute('aria-label', t('Palette de commandes', 'Command palette'));
    input.setAttribute('aria-label', t('Rechercher une commande', 'Search a command'));
    overlay.classList.add('open');
    render('');
    input.focus();
  }

  function close() {
    if (!isOpen()) return;
    overlay.classList.remove('open');
    // preventScroll : une commande « Aller à » vient de faire défiler la page,
    // rendre le focus ne doit pas la ramener en arrière.
    if (opener && document.contains(opener) && opener !== document.body) opener.focus({ preventScroll: true });
    opener = null;
  }
  const isOpen = () => overlay && overlay.classList.contains('open');

  function render(filter) {
    const f = filter.trim().toLowerCase();
    items = commands().filter((c) => c.label.toLowerCase().includes(f));
    active = 0;
    list.innerHTML = '';
    if (!items.length) {
      input.removeAttribute('aria-activedescendant');
      list.innerHTML = '<p class="cmdk-empty" role="status">' + t('0 rows selected.', '0 rows selected.') + '</p>';
      return;
    }
    items.forEach((c, i) => {
      const el = document.createElement('div');
      el.className = 'cmdk-item' + (i === 0 ? ' active' : '');
      el.id = 'cmdk-opt-' + i;
      el.setAttribute('role', 'option');
      el.setAttribute('aria-selected', String(i === 0));
      el.innerHTML = '<span aria-hidden="true">' + c.icon + '</span><span>' + c.label + '</span>'
        + (c.hint ? '<span class="k">' + c.hint + '</span>' : '');
      el.addEventListener('click', () => { close(); c.run(); });
      el.addEventListener('mousemove', () => setActive(i));
      list.appendChild(el);
    });
    input.setAttribute('aria-activedescendant', 'cmdk-opt-0');
  }

  function setActive(i) {
    active = i;
    [...list.children].forEach((el, j) => {
      el.classList.toggle('active', j === i);
      el.setAttribute('aria-selected', String(j === i));
    });
    input.setAttribute('aria-activedescendant', 'cmdk-opt-' + i);
    const el = list.children[i];
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }

  function onKeys(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (items.length) setActive((active + 1) % items.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (items.length) setActive((active - 1 + items.length) % items.length); }
    else if (e.key === 'Enter') { e.preventDefault(); const c = items[active]; if (c) { close(); c.run(); } }
    // preventDefault : Échap est « consommé », les autres fenêtres ouvertes
    // dessous (fiche d'objet) ne doivent pas se fermer avec.
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
    // Le champ est le seul élément focusable de la palette : Tab ne doit pas
    // partir sur la page cachée derrière le voile.
    else if (e.key === 'Tab') e.preventDefault();
  }

  function jump(sel) {
    close();
    const el = document.querySelector(sel);
    if (el) el.scrollIntoView({ behavior: scrollBehavior() });
  }

  function copyMail() {
    // Même logique que le bouton du guichet (main.js) : repli et filet d'1 s
    // compris. En cas d'échec on affiche l'adresse plutôt qu'un faux succès.
    const done = (ok) => {
      open();
      input.placeholder = ok ? t('email copié ✔', 'email copied ✔')
                             : 'mathys.langiny@gmail.com — ' + t('copie impossible', 'copy failed');
    };
    if (window.copyEmailAddress) window.copyEmailAddress(done);
    else done(false);
  }

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      isOpen() ? close() : open();
    }
  });
})();
