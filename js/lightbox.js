// Lightbox plein écran pour les galeries de projets.
//
// Accessibilité : à l'ouverture le focus entre sur « Fermer », Tab tourne entre
// les trois boutons, Échap ferme, et le focus revient à l'élément d'où l'on
// vient (le bouton « captures » de la fiche d'objet). Fermée, elle est masquée
// en visibility (voir #lightbox dans style.css) : ses boutons ne sont plus
// atteignables au clavier ni lus, alors qu'une simple opacité les laissait là.
(function () {
  let gallery = [];
  let index = 0;
  let opener = null;

  const box = document.getElementById('lightbox');
  const img = document.getElementById('lightbox-img');
  const cap = document.getElementById('lightbox-cap');
  const count = document.getElementById('lightbox-count');
  const closeBtn = document.getElementById('lightbox-close');
  const buttons = [closeBtn, document.getElementById('lightbox-prev'), document.getElementById('lightbox-next')];

  const isOpen = () => box.classList.contains('open');
  window.isLightboxOpen = isOpen;

  function render() {
    const item = gallery[index];
    img.src = item.src;
    img.alt = item.cap || '';
    cap.textContent = item.cap || '';
    count.textContent = `${index + 1} / ${gallery.length}`;
  }

  window.openLightbox = function (images, start = 0) {
    if (!images || !images.length) return;
    gallery = images;
    index = start;
    opener = document.activeElement;
    render();
    box.classList.add('open');
    document.body.style.overflow = 'hidden';
    closeBtn.focus();
  };

  function close() {
    if (!isOpen()) return;
    box.classList.remove('open');
    document.body.style.overflow = '';
    if (opener && document.contains(opener)) opener.focus();
    opener = null;
  }
  function next() { index = (index + 1) % gallery.length; render(); }
  function prev() { index = (index - 1 + gallery.length) % gallery.length; render(); }

  closeBtn.addEventListener('click', close);
  buttons[2].addEventListener('click', next);
  buttons[1].addEventListener('click', prev);
  box.addEventListener('click', (e) => { if (e.target === box) close(); });
  document.addEventListener('keydown', (e) => {
    if (!isOpen()) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'ArrowRight') next();
    if (e.key === 'ArrowLeft') prev();
    if (e.key === 'Tab') {
      const i = buttons.indexOf(document.activeElement);
      e.preventDefault();
      buttons[(i + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus();
    }
  });
})();
