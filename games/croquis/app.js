// Croquis — l'atelier : la feuille et les outils, en LOCAL (lot front 1).
//
// Aucun réseau, aucune partie : on dessine, c'est tout. Toute la règle du trait
// (coordonnées, limites, lissage, index du protocole) est dans dessin.js ; ce
// fichier ne fait que brancher le DOM dessus.
//
// Deux canvas superposés, de la même taille :
//   #base    — les traits finis (retracés en entier seulement au resize, à
//              l'annulation et à l'effacement) ;
//   #vivant  — le trait en cours, retracé à chaque image ; c'est lui qui reçoit
//              les Pointer Events. Au lâcher, le trait passe sur #base.
// Le dessin vit en unités logiques (1000 × 750) : un redimensionnement ne
// recopie jamais de pixels, il retrace — d'où aucune déformation.
(function () {
  'use strict';
  const D = window.CroquisDessin;
  const $ = (id) => document.getElementById(id);

  const dessin = D.creerDessin();
  const etat = { couleur: 0, taille: 1, gomme: false };
  const feuille = $('feuille');
  const base = $('base');
  const vivant = $('vivant');
  const cb = base.getContext('2d');
  const cv = vivant.getContext('2d');

  let actif = null;        // le SEUL pointeur qui dessine (pointerId)
  let ignorer = false;     // ce pointeur ne trace plus (feuille pleine, trait annulé en cours)
  let image = 0;           // requestAnimationFrame du trait en cours

  // ------------------------------------------------------------- la feuille
  function dimensionner() {
    const r = feuille.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const L = Math.max(1, Math.round(r.width * dpr));
    const H = Math.max(1, Math.round(r.height * dpr));
    for (const c of [base, vivant]) if (c.width !== L || c.height !== H) { c.width = L; c.height = H; }
    // (changer width/height remet le contexte à zéro : la matrice après)
    cb.setTransform(...D.matrice(L, H));
    cv.setTransform(...D.matrice(L, H));
    retracer();
  }

  function retracer() {
    D.tracerTout(cb, dessin.traits.filter((t) => t !== dessin.ouvert));
    tracerVivant();
  }

  function tracerVivant() {
    image = 0;
    cv.clearRect(0, 0, D.LARGEUR, D.HAUTEUR);
    if (dessin.ouvert) D.tracer(cv, dessin.ouvert);
  }
  const planifier = () => { if (!image) image = requestAnimationFrame(tracerVivant); };

  // Le trait en cours est fini : il passe sur la couche du dessous.
  function poser(t) { if (t) D.tracer(cb, t); }

  function finirTrait() {
    const t = dessin.ouvert;
    dessin.finir();
    poser(t);
    if (image) { cancelAnimationFrame(image); image = 0; }
    cv.clearRect(0, 0, D.LARGEUR, D.HAUTEUR);
    majEtat();
  }

  // ------------------------------------------------------------- le pointeur
  // Souris, doigt, stylet : les mêmes Pointer Events. Un seul pointeur à la
  // fois ; les autres doigts sont ignorés jusqu'au lâcher du premier.
  vivant.addEventListener('pointerdown', (e) => {
    if (actif !== null) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    actif = e.pointerId;
    ignorer = false;
    try { vivant.setPointerCapture(e.pointerId); } catch (_) { /* pointeur déjà parti */ }
    const p = D.versLogique(e.clientX, e.clientY, vivant.getBoundingClientRect());
    const { c, w } = D.encre(etat);
    if (!dessin.commencer(c, w, p.x, p.y)) {
      ignorer = true;
      annoncer(`Feuille pleine (${D.MAX_TRAITS} traits) : annule ou efface pour continuer.`);
      return;
    }
    planifier();
    majEtat();
  });

  vivant.addEventListener('pointermove', (e) => {
    if (e.pointerId !== actif || ignorer) return;
    // Hors de la feuille, le pointeur capturé continue d'arriver : versLogique
    // le ramène sur le bord. Les événements fusionnés gardent les tracés rapides.
    const rect = vivant.getBoundingClientRect();
    const lot = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    for (const ev of (lot.length ? lot : [e])) {
      const avant = dessin.ouvert;
      const p = D.versLogique(ev.clientX, ev.clientY, rect);
      const r = dessin.prolonger(p.x, p.y);
      if (r === 'coupe') { poser(avant); majEtat(); }
      else if (r === 'plein') {
        poser(avant);
        ignorer = true;
        annoncer(`Feuille pleine (${D.MAX_TRAITS} traits) : annule ou efface pour continuer.`);
        majEtat();
        break;
      }
    }
    planifier();
  });

  function relacher(e) {
    if (e.pointerId !== actif) return;
    actif = null;
    if (!ignorer) finirTrait();
    ignorer = false;
  }
  vivant.addEventListener('pointerup', relacher);
  vivant.addEventListener('pointercancel', relacher);
  vivant.addEventListener('lostpointercapture', relacher);
  // Un appui long ne doit ouvrir ni menu ni loupe.
  vivant.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---------------------------------------------------------------- outils
  const palette = $('palette');
  const tailles = $('tailles');
  const btnGomme = $('gomme');
  const btnAnnuler = $('annuler');
  const btnEffacer = $('effacer');

  // Les boutons sont construits depuis dessin.js : une seule source pour les
  // couleurs et leur index (celui du protocole).
  D.PALETTE.forEach((col, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pastille';
    b.dataset.couleur = String(i);
    b.style.setProperty('--sw', col.hex);
    // Coche lisible sur une couleur claire comme foncée.
    if (clair(col.hex)) b.classList.add('is-clair');
    b.setAttribute('aria-label', col.nom);
    b.title = col.nom;
    palette.appendChild(b);
  });
  D.TAILLES.forEach((t, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'outil taille';
    b.dataset.taille = String(i);
    b.style.setProperty('--d', `${Math.max(4, Math.round(t.largeur * 0.9))}px`);
    b.setAttribute('aria-label', `trait ${t.nom}`);
    b.title = `trait ${t.nom}`;
    b.innerHTML = '<span class="rond" aria-hidden="true"></span>';
    tailles.appendChild(b);
  });

  function clair(hex) {
    const n = parseInt(hex.slice(1), 16);
    const r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    return 0.299 * r + 0.587 * g + 0.114 * b > 150;
  }

  palette.addEventListener('click', (e) => {
    const b = e.target.closest('.pastille');
    if (!b) return;
    etat.couleur = Number(b.dataset.couleur);
    etat.gomme = false;               // choisir une couleur, c'est reprendre le crayon
    majOutils();
  });
  tailles.addEventListener('click', (e) => {
    const b = e.target.closest('.taille');
    if (!b) return;
    etat.taille = Number(b.dataset.taille);
    majOutils();
  });
  btnGomme.addEventListener('click', () => { etat.gomme = !etat.gomme; majOutils(); });
  btnAnnuler.addEventListener('click', annuler);

  function annuler() {
    const t = dessin.annuler();
    if (!t) return;
    if (actif !== null) ignorer = true;  // le trait en cours vient d'être retiré : ce doigt ne trace plus
    retracer();
    majEtat();
    annoncer('Dernier trait annulé.');
  }

  // Tout effacer : deux appuis (le second dans les 3 s), pas d'annulation.
  let arme = 0;
  function desarmer() {
    clearTimeout(arme);
    arme = 0;
    btnEffacer.classList.remove('is-arme');
    btnEffacer.querySelector('.lib').textContent = 'Effacer';
    btnEffacer.setAttribute('aria-label', 'tout effacer');
  }
  btnEffacer.addEventListener('click', () => {
    if (!dessin.traits.length) return;
    if (!arme) {
      arme = setTimeout(desarmer, 3000);
      btnEffacer.classList.add('is-arme');
      btnEffacer.querySelector('.lib').textContent = 'Sûr ?';
      btnEffacer.setAttribute('aria-label', 'confirmer : tout effacer');
      annoncer('Appuie encore pour tout effacer (impossible à annuler).');
      return;
    }
    desarmer();
    dessin.effacer();
    if (actif !== null) ignorer = true;
    retracer();
    majEtat();
    annoncer('Feuille effacée.');
  });

  // Ctrl+Z / Cmd+Z : annuler.
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      annuler();
    }
  });

  // ------------------------------------------------------------ affichage
  function majOutils() {
    palette.querySelectorAll('.pastille').forEach((b) => b.setAttribute('aria-pressed', String(!etat.gomme && Number(b.dataset.couleur) === etat.couleur)));
    tailles.querySelectorAll('.taille').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.taille) === etat.taille)));
    btnGomme.setAttribute('aria-pressed', String(etat.gomme));
    const { c, w } = D.encre(etat);
    feuille.style.setProperty('--encre', D.hexDe(c));
    $('outil-actuel').textContent = `${etat.gomme ? 'Gomme' : `Crayon ${D.PALETTE[c].nom}`} · ${D.TAILLES[w].nom}`;
  }

  function majEtat() {
    const n = dessin.traits.length;
    $('compte').textContent = `${n} / ${D.MAX_TRAITS} traits`;
    $('compte').classList.toggle('is-plein', dessin.plein());
    btnAnnuler.disabled = n === 0;
    btnEffacer.disabled = n === 0;
    if (!n && arme) desarmer();
  }

  function annoncer(txt) { $('statut').textContent = txt; }

  // ------------------------------------------------------------- démarrage
  majOutils();
  majEtat();
  dimensionner();
  // La feuille suit sa boîte : rotation, fenêtre, zoom. On retrace à la
  // nouvelle taille, une fois par image au plus.
  let attente = 0;
  const auResize = () => { if (!attente) attente = requestAnimationFrame(() => { attente = 0; dimensionner(); }); };
  if (typeof ResizeObserver === 'function') new ResizeObserver(auResize).observe(feuille);
  window.addEventListener('resize', auResize);

  // Pour les tests (tests/croquis-atelier.mjs) : l'état, en lecture.
  window.__croquis = { dessin, etat };
})();
