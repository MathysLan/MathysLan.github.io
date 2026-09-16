// Modale « description d'objet » : ce qui s'ouvre quand on clique une case du
// sac à dos. Elle affiche le descriptif complet du projet, sa stack en attributs
// d'arme, le lien GitHub et un accès aux captures (qui passe la main à la
// lightbox existante).
//
// Le contenu est lu dans PROJECTS au moment de l'ouverture, jamais recopié :
// changer de langue re-rend la grille sans rien invalider ici.
(function () {
  let modal, panel, closeBtn;
  let opener = null;   // la case d'où l'on vient, pour lui rendre le focus

  const t = (fr, en) => (window.LANG === 'en' ? en : fr);

  function build() {
    modal = document.getElementById('item-modal');
    panel = modal.querySelector('.im-panel');
    closeBtn = modal.querySelector('.im-close');

    // Le fond ferme au mousedown (une sélection de texte relâchée sur le fond ne
    // doit pas fermer). La croix, elle, écoute « click » : c'est le seul
    // événement qu'Entrée et Espace déclenchent sur un bouton. Au mousedown,
    // elle était inutilisable au clavier.
    modal.querySelector('.im-backdrop').addEventListener('mousedown', close);
    closeBtn.addEventListener('click', close);
    document.addEventListener('keydown', onKeys);
  }

  function onKeys(e) {
    if (!isOpen()) return;
    // La lightbox s'ouvre PAR-DESSUS la fiche : tant qu'elle est là, c'est elle
    // qui répond au clavier. Deux gardes, parce que l'ordre des écouteurs n'est
    // pas garanti : touche déjà traitée (la lightbox fait preventDefault sur
    // Échap, puis se ferme), ou lightbox encore ouverte (Tab). Sans eux, Échap
    // fermait les deux d'un coup et Tab tournait dans la fiche cachée dessous.
    if (e.defaultPrevented) return;
    if (window.isLightboxOpen && window.isLightboxOpen()) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    // Piège à focus : tant que la modale est ouverte, Tab tourne à l'intérieur.
    // Sans ça on tabule derrière la modale, sur une page qu'on ne voit plus.
    if (e.key !== 'Tab') return;
    const focusables = panel.querySelectorAll(
      'button, a[href], input, textarea, select, [tabindex]:not([tabindex="-1"])');
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  const isOpen = () => modal && !modal.hidden;

  function open(index, from) {
    const p = PROJECTS[index];
    if (!p) return;
    if (!modal) build();
    opener = from || null;
    const q = p.quality || 'normal';

    // data-q sur le panneau : sa bordure prend la couleur de la qualité, comme
    // la case de la grille. C'est ce qui relie visuellement les deux.
    panel.setAttribute('data-q', q);
    modal.querySelector('.im-quality').className = 'q-badge im-quality';
    modal.querySelector('.im-quality').setAttribute('data-q', q);
    modal.querySelector('.im-quality').textContent =
      '★ ' + (q === 'collectors' ? "Collector's" : q);
    modal.querySelector('.im-badge').textContent = tr(p, 'badge');
    modal.querySelector('.im-title').textContent = tr(p, 'title');
    modal.querySelector('.im-desc').textContent = tr(p, 'desc');

    const conf = modal.querySelector('.im-conf');
    conf.hidden = !p.confidential;
    conf.textContent = t('confidentiel', 'confidential');

    // La stack en attributs d'arme, une ligne par techno.
    modal.querySelector('.im-stack').innerHTML =
      p.stack.map((s) => `<li>${s}</li>`).join('');

    // Vignette : la même que la case, ou l'initiale en repli.
    const thumb = modal.querySelector('.im-thumb');
    thumb.innerHTML = p.cover
      ? `<img src="${p.cover}" alt="" class="im-img${p.coverFit === 'contain' ? ' is-contain' : ''}">`
      : `<span class="bp-noimg font-display" aria-hidden="true">${tr(p, 'title').charAt(0)}</span>`;

    // Captures : la modale passe la main à la lightbox, qui sait déjà tout faire.
    const shots = modal.querySelector('.im-shots');
    shots.hidden = !p.images.length;
    if (p.images.length) {
      shots.textContent = `${p.images.length} ${t('captures', 'screenshots')}`;
      shots.onclick = () => openLightbox(localizedImages(p), 0);
    }

    const gh = modal.querySelector('.im-gh');
    gh.hidden = !p.github;
    if (p.github) gh.href = p.github;

    modal.hidden = false;
    document.body.classList.add('modal-open');
    closeBtn.focus();
  }

  function close() {
    if (!isOpen()) return;
    modal.hidden = true;
    document.body.classList.remove('modal-open');
    // Rendre le focus à la case d'où l'on vient : sans ça, il repart en haut de
    // page et on perd sa place dans la grille.
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
      if (cell) open(+cell.dataset.index, cell);
    });
  });

  window.openItemModal = open;
})();
