// Croquis — le DESSIN, sans DOM ni réseau.
//
// Ce module est la règle du trait côté client : ce qu'est un trait, comment un
// point d'écran devient un point logique, comment un trait se trace. Il est
// pur (aucun DOM, aucun réseau) : le même fichier tourne dans la page et dans
// tests/croquis-dessin.mjs.
//
// ⚠️ LES INDEX SONT CEUX DU PROTOCOLE de croquis-server (server.js) :
//   couleur `c` 0–11 = PALETTE, 12 = la gomme (la couleur du fond) ;
//   taille `w` 0–2 = TAILLES ; coordonnées entières dans 1000 × 750 ;
//   150 traits par dessin, 1 000 points par trait.
// Un trait a déjà la forme d'un message `stroke` : { s, c, w, p: [x, y, …] }.
// Le jour du réseau, on enverra ces traits tels quels, et les devineurs les
// traceront avec `tracer()` — la même fonction, donc le même rendu au pixel.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CroquisDessin = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LARGEUR = 1000;
  const HAUTEUR = 750;
  const MAX_TRAITS = 150;
  const MAX_POINTS_TRAIT = 1000;
  // Un déplacement de moins de 2 unités logiques ne fait pas de point : le
  // trait reste léger (et la règle est la même partout, voir lot 0).
  const PAS_MIN = 2;
  const FOND = '#f7f3e8';                // blanc cassé : la feuille, et la gomme

  // L'ordre EST le protocole : ne jamais réordonner, seulement ajouter à la fin
  // (et le serveur avec).
  const PALETTE = [
    { nom: 'noir', hex: '#1d1a17' },
    { nom: 'gris', hex: '#8a8580' },
    { nom: 'blanc', hex: '#ffffff' },
    { nom: 'rouge', hex: '#d1302c' },
    { nom: 'orange', hex: '#ee7d22' },
    { nom: 'jaune', hex: '#f4cc2b' },
    { nom: 'vert', hex: '#3d9a46' },
    { nom: 'bleu clair', hex: '#4fb6e3' },
    { nom: 'bleu', hex: '#2052b8' },
    { nom: 'violet', hex: '#7a3db0' },
    { nom: 'rose', hex: '#ef86b8' },
    { nom: 'marron', hex: '#7a4a24' },
  ];
  const GOMME = PALETTE.length;          // 12
  // Épaisseurs en unités LOGIQUES (sur 1000 de large) : elles grossissent et
  // rapetissent avec la feuille, comme le reste du dessin.
  const TAILLES = [
    { nom: 'fin', largeur: 5 },
    { nom: 'moyen', largeur: 12 },
    { nom: 'gros', largeur: 28 },
  ];

  const borne = (v, min, max) => (v < min ? min : v > max ? max : v);

  // ------------------------------------------------------------ coordonnées
  // `rect` : la boîte de la feuille À L'ÉCRAN (getBoundingClientRect). Le
  // point est ramené dans la feuille (un doigt qui sort trace sur le bord, pas
  // au-delà), puis arrondi : le protocole ne connaît que des entiers.
  function versLogique(clientX, clientY, rect) {
    const x = ((clientX - rect.left) / rect.width) * LARGEUR;
    const y = ((clientY - rect.top) / rect.height) * HAUTEUR;
    return { x: borne(Math.round(x), 0, LARGEUR), y: borne(Math.round(y), 0, HAUTEUR) };
  }
  // L'inverse : où tombe un point logique dans cette boîte.
  function versEcran(x, y, rect) {
    return { x: rect.left + (x / LARGEUR) * rect.width, y: rect.top + (y / HAUTEUR) * rect.height };
  }
  // La matrice d'un canvas de `pxL × pxH` pixels réels : ctx.setTransform(...)
  // et tout se trace en unités logiques. C'est ce qui rend le redimensionnement
  // sans déformation : on ne recopie jamais de pixels, on retrace.
  function matrice(pxL, pxH) {
    return [pxL / LARGEUR, 0, 0, pxH / HAUTEUR, 0, 0];
  }

  // ----------------------------------------------------------------- outils
  // L'outil choisi → l'encre d'un trait, en index du protocole.
  //   etat : { couleur: 0–11, taille: 0–2, gomme: bool }
  function encre(etat) {
    const couleur = Number.isInteger(etat.couleur) ? borne(etat.couleur, 0, PALETTE.length - 1) : 0;
    const taille = Number.isInteger(etat.taille) ? borne(etat.taille, 0, TAILLES.length - 1) : 1;
    return { c: etat.gomme ? GOMME : couleur, w: taille };
  }
  const hexDe = (c) => (c === GOMME ? FOND : (PALETTE[c] || PALETTE[0]).hex);
  const largeurDe = (w) => (TAILLES[w] || TAILLES[1]).largeur;

  // ----------------------------------------------------------------- dessin
  // L'état local d'une feuille : les traits finis, le trait en cours. Mêmes
  // limites que le serveur, appliquées AVANT d'envoyer quoi que ce soit.
  function creerDessin() {
    const d = {
      traits: [],         // dans l'ordre de tracé ; le dernier peut être `ouvert`
      ouvert: null,
      prochainS: 1,       // id du prochain trait (`s` du protocole)

      plein() { return d.traits.length >= MAX_TRAITS; },

      // Un nouveau trait au point (x, y), ou null si la feuille est pleine.
      commencer(c, w, x, y) {
        d.finir();
        if (d.plein()) return null;
        const t = { s: d.prochainS++, c, w, p: [x, y] };
        d.traits.push(t);
        d.ouvert = t;
        return t;
      },

      // Le point suivant du trait en cours. Rend :
      //   'ajoute'  — le point est dans le trait ;
      //   'ignore'  — trop près du précédent (ou pas de trait en cours) ;
      //   'coupe'   — le trait avait ses 1 000 points : il est clos, et un
      //               nouveau trait, même encre, repart de son dernier point ;
      //   'plein'   — le trait avait ses 1 000 points et la feuille ses 150
      //               traits : le trait est clos, le point perdu.
      prolonger(x, y) {
        const t = d.ouvert;
        if (!t) return 'ignore';
        const n = t.p.length;
        const lx = t.p[n - 2], ly = t.p[n - 1];
        if (Math.hypot(x - lx, y - ly) < PAS_MIN) return 'ignore';
        if (n / 2 >= MAX_POINTS_TRAIT) {
          d.finir();
          if (d.plein()) return 'plein';
          const suite = d.commencer(t.c, t.w, lx, ly);
          suite.p.push(x, y);
          return 'coupe';
        }
        t.p.push(x, y);
        return 'ajoute';
      },

      finir() { d.ouvert = null; },

      // Retire le dernier trait (même celui en cours) : c'est le `undo` du
      // serveur, qui retire le dernier trait du dessin.
      annuler() {
        const t = d.traits.pop() || null;
        if (t && t === d.ouvert) d.ouvert = null;
        return t;
      },

      // Vide la feuille. Pas d'annulation (le serveur n'en a pas).
      effacer() {
        const n = d.traits.length;
        d.traits = [];
        d.ouvert = null;
        return n;
      },
    };
    return d;
  }

  // ------------------------------------------------------------------ tracé
  // LA règle de lissage, la même pour l'auteur et pour ceux qui reçoivent le
  // trait : des courbes quadratiques passant par les MILIEUX des segments, en
  // prenant chaque point reçu comme point de contrôle. Rend une liste de
  // commandes (testable sans canvas) en unités logiques.
  //   1 point  → un disque (un simple appui laisse une trace) ;
  //   2 points → un segment ;
  //   n points → M p0, Q p1 → milieu(p1, p2), …, L p(n-1).
  function commandes(t) {
    const p = t.p, n = p.length / 2;
    if (n === 1) return [['point', p[0], p[1]]];
    const cmd = [['M', p[0], p[1]]];
    if (n === 2) { cmd.push(['L', p[2], p[3]]); return cmd; }
    for (let i = 1; i < n - 1; i++) {
      const x = p[2 * i], y = p[2 * i + 1];
      const mx = (x + p[2 * i + 2]) / 2, my = (y + p[2 * i + 3]) / 2;
      cmd.push(['Q', x, y, mx, my]);
    }
    cmd.push(['L', p[2 * n - 2], p[2 * n - 1]]);
    return cmd;
  }

  // Trace un trait sur un contexte 2D déjà mis en unités logiques (matrice()).
  function tracer(ctx, t) {
    const couleur = hexDe(t.c);
    const largeur = largeurDe(t.w);
    const cmd = commandes(t);
    if (cmd[0][0] === 'point') {
      ctx.fillStyle = couleur;
      ctx.beginPath();
      ctx.arc(cmd[0][1], cmd[0][2], largeur / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.strokeStyle = couleur;
    ctx.lineWidth = largeur;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (const c of cmd) {
      if (c[0] === 'M') ctx.moveTo(c[1], c[2]);
      else if (c[0] === 'L') ctx.lineTo(c[1], c[2]);
      else ctx.quadraticCurveTo(c[1], c[2], c[3], c[4]);
    }
    ctx.stroke();
  }

  // Toute la feuille : le fond, puis chaque trait dans l'ordre.
  function tracerTout(ctx, traits) {
    ctx.fillStyle = FOND;
    ctx.fillRect(0, 0, LARGEUR, HAUTEUR);
    for (const t of traits) tracer(ctx, t);
  }

  return {
    LARGEUR, HAUTEUR, MAX_TRAITS, MAX_POINTS_TRAIT, PAS_MIN, FOND, PALETTE, GOMME, TAILLES,
    versLogique, versEcran, matrice, encre, hexDe, largeurDe, creerDessin, commandes, tracer, tracerTout,
  };
});
