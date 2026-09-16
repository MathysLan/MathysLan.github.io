// Modale « description d'objet ». Elle affiche deux sortes de fiches avec le
// même comportement :
//   - un PROJET (clic sur une case du sac à dos) : objectif, ma part, résultat,
//     équipe, puis le récit complet, la stack, GitHub et les captures ;
//   - l'ARCHITECTURE d'un jeu (bouton « Architecture » d'une carte du carousel) :
//     les points techniques, la stack et le lien vers le code.
//
// Le contenu est lu dans PROJECTS / GAMES au moment de l'ouverture, jamais
// recopié : changer de langue re-rend la page sans rien invalider ici.
//
// Accessibilité : role="dialog" aria-modal, focus sur la croix à l'ouverture,
// Tab qui tourne dans la fiche, Échap qui ferme, focus rendu à l'élément
// d'origine. Le fond ferme au mousedown (une sélection de texte relâchée sur le
// fond ne doit pas fermer) ; la croix écoute « click », seul événement
// qu'Entrée et Espace déclenchent sur un bouton.
(function () {
  let modal, panel, closeBtn;
  let opener = null;   // l'élément d'où l'on vient, pour lui rendre le focus

  const t = (fr, en) => (window.LANG === 'en' ? en : fr);

  function build() {
    modal = document.getElementById('item-modal');
    panel = modal.querySelector('.im-panel');
    closeBtn = modal.querySelector('.im-close');
    modal.querySelector('.im-backdrop').addEventListener('mousedown', close);
    closeBtn.addEventListener('click', close);
    document.addEventListener('keydown', onKeys);
  }

  function onKeys(e) {
    if (!isOpen()) return;
    // La lightbox s'ouvre PAR-DESSUS la fiche : tant qu'elle est là, c'est elle
    // qui répond au clavier. Deux gardes, parce que l'ordre des écouteurs n'est
    // pas garanti : touche déjà traitée (la lightbox fait preventDefault sur
    // Échap, puis se ferme), ou lightbox encore ouverte (Tab).
    if (e.defaultPrevented) return;
    if (window.isLightboxOpen && window.isLightboxOpen()) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    // Piège à focus : tant que la modale est ouverte, Tab tourne à l'intérieur.
    if (e.key !== 'Tab') return;
    const focusables = [...panel.querySelectorAll(
      'button, a[href], input, textarea, select, [tabindex]:not([tabindex="-1"])')]
      .filter((el) => !el.closest('[hidden]'));
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  const isOpen = () => modal && !modal.hidden;

  // Affiche une fiche normalisée : { quality, badge, title, facts (HTML),
  // desc, detailsLabel, list, thumb (HTML), confidential, images, link }.
  function show(sheet, from) {
    if (!modal) build();
    opener = from || null;
    const q = sheet.quality || 'normal';

    // data-q sur le panneau : sa bordure prend la couleur de la qualité, comme
    // la case ou la carte d'où l'on vient.
    panel.setAttribute('data-q', q);
    const badge = modal.querySelector('.im-quality');
    badge.setAttribute('data-q', q);
    badge.textContent = '★ ' + qualityLabel(q);
    modal.querySelector('.im-badge').textContent = sheet.badge || '';
    modal.querySelector('.im-title').textContent = sheet.title;

    modal.querySelector('.im-facts').innerHTML = sheet.facts || '';
    const descLabel = modal.querySelector('.im-desc-label');
    descLabel.hidden = !(sheet.facts && sheet.desc);
    descLabel.textContent = sheet.detailsLabel || '';
    const desc = modal.querySelector('.im-desc');
    desc.hidden = !sheet.desc;
    desc.textContent = sheet.desc || '';

    const conf = modal.querySelector('.im-conf');
    conf.hidden = !sheet.confidential;
    conf.textContent = t('confidentiel', 'confidential');

    // Attributs d'arme : la stack d'un projet, ou les points d'architecture
    // puis la stack d'un jeu.
    modal.querySelector('.im-stack').innerHTML =
      (sheet.list || []).map((s) => `<li>${esc(s)}</li>`).join('');

    modal.querySelector('.im-thumb').innerHTML = sheet.thumb || '';

    // Captures : la modale passe la main à la lightbox, qui sait déjà tout faire.
    const shots = modal.querySelector('.im-shots');
    const images = sheet.images || [];
    shots.hidden = !images.length;
    if (images.length) {
      shots.textContent = `${images.length} ${t('captures', 'screenshots')}`;
      shots.onclick = () => openLightbox(images, 0);
    }

    const gh = modal.querySelector('.im-gh');
    gh.hidden = !sheet.link;
    if (sheet.link) { gh.href = sheet.link; gh.textContent = sheet.linkLabel || 'GitHub'; }

    modal.hidden = false;
    document.body.classList.add('modal-open');
    closeBtn.focus();
  }

  function openProject(index, from) {
    const p = PROJECTS[index];
    if (!p) return;
    show({
      quality: p.quality,
      badge: tr(p, 'badge'),
      title: tr(p, 'title'),
      facts: projectFactsHTML(p, window.LANG),
      desc: tr(p, 'desc'),
      detailsLabel: sheetLabels(window.LANG).details,
      list: p.stack,
      confidential: p.confidential,
      // Vignette : la même que la case, ou l'initiale en repli.
      thumb: p.cover
        ? `<img src="${p.cover}" alt="" class="im-img${p.coverFit === 'contain' ? ' is-contain' : ''}">`
        : `<span class="bp-noimg font-display" aria-hidden="true">${tr(p, 'title').charAt(0)}</span>`,
      images: localizedImages(p),
      link: p.github,
    }, from);
  }

  function openGame(index, from) {
    const g = GAMES[index];
    if (!g) return;
    const L = sheetLabels(window.LANG);
    show({
      quality: GAME_QUALITY[g.accent],
      badge: `${L.arch} · ${tr(g, 'tagline')}`,
      title: tr(g, 'title'),
      // Les points d'architecture en tête, la stack dessous : deux natures
      // d'information, deux blocs (dans une seule liste on ne les distinguait pas).
      facts: `<ul class="attr-list im-arch">${(tr(g, 'arch') || []).map((a) => `<li>${esc(a)}</li>`).join('')}</ul>`,
      desc: '',
      list: g.stack,
      thumb: `<span class="im-emoji" aria-hidden="true">${g.emoji}</span>`,
      link: g.code,
      linkLabel: `${L.code} (GitHub)`,
    }, from);
  }

  function close() {
    if (!isOpen()) return;
    modal.hidden = true;
    document.body.classList.remove('modal-open');
    // Rendre le focus à l'élément d'origine : sans ça, il repart en haut de
    // page et on perd sa place.
    if (opener && document.contains(opener)) opener.focus();
    opener = null;
  }

  document.addEventListener('DOMContentLoaded', () => {
    const grid = document.getElementById('projects-grid');
    if (!grid) return;
    // Délégation : la grille est re-rendue à chaque changement de langue, donc
    // on n'attache rien aux cases elles-mêmes.
    grid.addEventListener('click', (e) => {
      const cell = e.target.closest('.bp-cell');
      if (cell) openProject(+cell.dataset.index, cell);
    });
  });

  window.openItemModal = openProject;
  window.openGameSheet = openGame;
})();
