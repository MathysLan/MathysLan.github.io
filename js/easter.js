// Konami code + petits secrets. Rien d'obligatoire, rien de lourd.
(function () {
  // --- Konami : ↑ ↑ ↓ ↓ ← → ← → B A ---
  const SEQ = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
  let idx = 0;

  document.addEventListener('keydown', (e) => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    idx = k === SEQ[idx] ? idx + 1 : (k === SEQ[0] ? 1 : 0);
    if (idx === SEQ.length) { idx = 0; accessGranted(); }
  });

  function accessGranted() {
    document.body.classList.add('crt');
    toast('ACCESS GRANTED — GRANT PLAY ON jeux TO visiteur;');
    setTimeout(() => document.body.classList.remove('crt'), 3200);
    setTimeout(() => window.launchConnect4 && window.launchConnect4(), 900);
  }

  function toast(msg) {
    const el = document.createElement('div');
    el.className = 'crt-toast';
    el.textContent = '> ' + msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  // --- Le Spy crabe (footer) ---
  // Clic sur le masque : le Spy arrive en crabe, s'arrête au milieu et déterre
  // la fiche du projet abandonné. OK ou Échap : la fiche se ferme, le focus
  // revient au masque, et il repart par la gauche. Les étapes s'enchaînent sur
  // animationend (voir .spycrab dans style.css) ; en mouvement réduit il n'y a
  // pas d'animation, donc on saute directement d'un état à l'autre.
  const trigger = document.getElementById('spy-trigger');
  const crab = document.getElementById('spycrab');
  const note = document.getElementById('secret-note');
  if (trigger && crab && note) {
    const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let busy = false;

    const openNote = () => {
      crab.classList.remove('is-entering', 'is-walking');
      crab.classList.add('is-idle');
      note.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      note.querySelector('.secret-ok').focus();
    };
    const reset = () => {
      crab.hidden = true;
      crab.className = 'spycrab';
      busy = false;
    };
    const closeNote = () => {
      if (note.hidden) return;
      note.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      trigger.focus();
      if (reduced()) { reset(); return; }
      crab.classList.remove('is-idle');
      crab.classList.add('is-leaving', 'is-walking');
    };

    trigger.addEventListener('click', () => {
      if (busy) return;              // un seul Spy à la fois
      busy = true;
      crab.hidden = false;
      if (reduced()) { openNote(); return; }
      crab.classList.add('is-entering', 'is-walking');
    });
    // animationend remonte depuis les membres (dont les boucles infinies ne
    // finissent jamais) : on ne garde que les deux trajets du crabe lui-même.
    crab.addEventListener('animationend', (e) => {
      if (e.target !== crab) return;
      if (e.animationName === 'crab-in') openNote();
      if (e.animationName === 'crab-out') reset();
    });
    note.querySelector('.secret-ok').addEventListener('click', closeNote);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeNote(); });
  }

  // --- Console : pour ceux qui ouvrent F12 (les meilleurs) ---
  // Couleurs alignées sur la palette Mann Co. (l'ancien violet/menthe traînait).
  const mono = 'font-family:monospace';
  console.log("%cSQL> %cSELECT * FROM opportunites WHERE profil = 'data' AND bullshit = 0;",
    'color:#8cbb96;' + mono, 'color:#e8913f;' + mono);
  console.log('%c1 row selected. → mathys.langiny@gmail.com', 'color:#c6b99b;' + mono);
  console.log('%cIndices : Ctrl+K ouvre la palette. Le vieux code des salles d\'arcade ouvre autre chose. Et un Spy se cache en bas de page.',
    'color:#a99c7f;font-size:11px;' + mono);
})();
