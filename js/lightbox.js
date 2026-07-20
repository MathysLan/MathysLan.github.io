// Lightbox plein écran pour les galeries de projets.
(function () {
  let gallery = [];
  let index = 0;

  const box = document.getElementById('lightbox');
  const img = document.getElementById('lightbox-img');
  const cap = document.getElementById('lightbox-cap');
  const count = document.getElementById('lightbox-count');

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
    render();
    box.classList.add('open');
    document.body.style.overflow = 'hidden';
  };

  function close() {
    box.classList.remove('open');
    document.body.style.overflow = '';
  }
  function next() { index = (index + 1) % gallery.length; render(); }
  function prev() { index = (index - 1 + gallery.length) % gallery.length; render(); }

  document.getElementById('lightbox-close').addEventListener('click', close);
  document.getElementById('lightbox-next').addEventListener('click', next);
  document.getElementById('lightbox-prev').addEventListener('click', prev);
  box.addEventListener('click', (e) => { if (e.target === box) close(); });
  document.addEventListener('keydown', (e) => {
    if (!box.classList.contains('open')) return;
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowRight') next();
    if (e.key === 'ArrowLeft') prev();
  });
})();
