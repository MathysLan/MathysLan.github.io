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

  // --- Console : pour ceux qui ouvrent F12 (les meilleurs) ---
  const mono = 'font-family:monospace';
  console.log("%cSQL> %cSELECT * FROM opportunites WHERE profil = 'data' AND bullshit = 0;",
    'color:#34d399;' + mono, 'color:#8b5cf6;' + mono);
  console.log('%c1 row selected. → mathys.langiny@gmail.com', 'color:#9b98ad;' + mono);
  console.log('%cIndices : Ctrl+K ouvre la palette. Le vieux code des salles d\'arcade ouvre autre chose.',
    'color:#6f6c80;font-size:11px;' + mono);
})();
