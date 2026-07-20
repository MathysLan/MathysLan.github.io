// Effet tilt 3D léger sur les cartes projets (désactivé au clavier/touch).
(function () {
  const MAX_DEG = 6;

  function attach(card) {
    let raf = null;

    card.addEventListener('mousemove', (e) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        const r = card.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        card.style.transform =
          `perspective(900px) rotateY(${px * MAX_DEG}deg) rotateX(${-py * MAX_DEG}deg)`;
        raf = null;
      });
    });

    card.addEventListener('mouseleave', () => {
      card.style.transform = '';
    });
  }

  window.initTilt = function () {
    if (window.matchMedia('(hover: none)').matches) return;
    document.querySelectorAll('.tilt-card').forEach(attach);
  };
})();
