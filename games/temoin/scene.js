// Faux Témoin — le dessin d'une scène et les mots pour la dire. Aucune règle
// ici : la scène (un lieu + un élément par emplacement) vient de
// temoin-server (scenes.js), qui n'envoie que des valeurs de son vocabulaire
// FERMÉ (KINDS). Ce module ne fait que la DESSINER.
//
// Dessin maison en SVG (aplats + contour sombre, aucun asset), construit par
// createElementNS : aucune donnée du réseau ne passe par innerHTML. Un lieu,
// un emplacement ou une valeur inconnus (serveur plus récent) dessinent un
// décor neutre ou « rien », jamais une erreur.
//
// Repère : viewBox 200 × 125, horizon à y = 58. Chaque élément est dessiné
// une fois, pieds en (0, 0), puis posé (x, y) et mis à l'échelle (s) selon
// son emplacement dans son lieu (POSES) — plus petit au fond, plus grand au
// premier plan.
(function (root) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const TRAIT = '#1b140c';
  const PEAU = '#e2b68c';

  // Les couleurs du serveur : distinctes en teinte ET en luminance (les
  // questions demandent des couleurs ; le nom est aussi dans la description).
  const COULEURS = {
    rouge: '#d0392e', bleu: '#2f6fd0', jaune: '#f2c81c', vert: '#3e9b3a',
    violet: '#8a4fc0', orange: '#f08020', blanc: '#f4f1e8', noir: '#2a2522',
  };
  const NOM_COULEUR = {
    rouge: 'rouge', bleu: 'bleu', jaune: 'jaune', vert: 'vert', violet: 'violet', orange: 'orange', blanc: 'blanc', noir: 'noir',
  };
  const coul = (c, defaut) => COULEURS[c] || defaut || '#8a8070';

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, String(v));
    if (parent) parent.appendChild(e);
    return e;
  }
  const tr = (w, extra) => ({ stroke: TRAIT, 'stroke-width': w || 1, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', ...extra });

  // ------------------------------------------------------------- le décor
  const CIELS = {
    matin: ['#f6c9a8', '#fbe7cf'], midi: ['#5aa6e6', '#bfe1fb'], soir: ['#e2683a', '#f5b45a'], nuit: ['#14193a', '#2d3566'],
  };

  // Le ciel : un dégradé par moment, le soleil (bas à gauche le matin, haut à
  // midi, bas à droite le soir) ou la lune et des étoiles.
  function ciel(g, moment, p) {
    const [haut, bas] = CIELS[moment] || CIELS.midi;
    const id = `${p}-ciel`;
    const defs = el('defs', {}, g);
    const lg = el('linearGradient', { id, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    el('stop', { offset: 0, 'stop-color': haut }, lg);
    el('stop', { offset: 1, 'stop-color': bas }, lg);
    el('rect', { x: 0, y: 0, width: 200, height: 60, fill: `url(#${id})` }, g);
    if (moment === 'nuit') {
      el('circle', { cx: 165, cy: 14, r: 7, fill: '#f3ecc8' }, g);
      el('circle', { cx: 169, cy: 12, r: 6, fill: haut }, g);
      for (const [x, y] of [[20, 10], [48, 22], [80, 8], [118, 18], [140, 6], [188, 28], [100, 30]]) el('circle', { cx: x, cy: y, r: 0.9, fill: '#fff' }, g);
    } else {
      const [x, y, c] = moment === 'matin' ? [28, 40, '#fff1c0'] : moment === 'soir' ? [172, 42, '#ffd27a'] : [150, 12, '#fff6b0'];
      el('circle', { cx: x, cy: y, r: 8, fill: c, stroke: 'rgba(255,255,255,.5)', 'stroke-width': 3 }, g);
    }
  }

  // Le sol et le décor fixe de chaque lieu (rien de tiré : le tirage est dans
  // les emplacements).
  const DECORS = {
    gare(g) {
      el('rect', { x: 0, y: 50, width: 200, height: 10, fill: '#6b6258' }, g);              // voies
      for (let x = 2; x < 200; x += 8) el('rect', { x, y: 55, width: 4, height: 2, fill: '#4a4038' }, g);
      el('line', { x1: 0, y1: 54, x2: 200, y2: 54, stroke: '#a9a39a', 'stroke-width': .8 }, g);
      el('line', { x1: 0, y1: 58, x2: 200, y2: 58, stroke: '#a9a39a', 'stroke-width': .8 }, g);
      el('rect', { x: 0, y: 60, width: 200, height: 65, fill: '#a39a8c' }, g);              // quai
      el('rect', { x: 0, y: 60, width: 200, height: 3, fill: '#f2c81c' }, g);               // bande d'éveil
      el('rect', { x: 26, y: 6, width: 4, height: 54, fill: '#5a5048' }, g);                // poteau de l'auvent
      el('rect', { x: 0, y: 0, width: 200, height: 6, fill: '#5a5048' }, g);
    },
    terrasse(g) {
      el('rect', { x: 0, y: 4, width: 200, height: 56, fill: '#d9b98a' }, g);               // façade
      el('rect', { x: 14, y: 30, width: 34, height: 26, fill: '#3b4a5a', ...tr(.8) }, g);   // vitrine
      el('rect', { x: 152, y: 30, width: 34, height: 26, fill: '#3b4a5a', ...tr(.8) }, g);
      el('rect', { x: 88, y: 32, width: 24, height: 28, fill: '#5a3a22', ...tr(.8) }, g);   // porte
      el('rect', { x: 0, y: 60, width: 200, height: 65, fill: '#b9ab98' }, g);              // trottoir
      for (let x = 0; x < 200; x += 20) el('line', { x1: x, y1: 60, x2: x - 14, y2: 125, stroke: 'rgba(0,0,0,.1)', 'stroke-width': .6 }, g);
    },
    parc(g) {
      el('rect', { x: 0, y: 56, width: 200, height: 69, fill: '#6fae4c' }, g);              // pelouse
      el('path', { d: 'M86 56 L114 56 L150 125 L50 125 Z', fill: '#d9c7a0' }, g);            // allée
      el('ellipse', { cx: 18, cy: 57, rx: 26, ry: 6, fill: '#4f8a38' }, g);                  // haies du fond
      el('ellipse', { cx: 186, cy: 57, rx: 24, ry: 5, fill: '#4f8a38' }, g);
    },
    superette(g) {
      // Le mur du fond, percé d'une fenêtre (le ciel se voit à travers).
      el('path', { d: 'M0 0 H200 V62 H0 Z M108 8 H192 V30 H108 Z', fill: '#e9e2cf', 'fill-rule': 'evenodd' }, g);
      el('rect', { x: 108, y: 8, width: 84, height: 22, fill: 'none', ...tr(1) }, g);
      el('line', { x1: 150, y1: 8, x2: 150, y2: 30, ...tr(.8) }, g);
      el('rect', { x: 0, y: 62, width: 200, height: 63, fill: '#cfd3d4' }, g);              // carrelage
      for (let x = 0; x <= 200; x += 16) el('line', { x1: x, y1: 62, x2: x, y2: 125, stroke: 'rgba(0,0,0,.08)', 'stroke-width': .6 }, g);
      for (let y = 74; y < 125; y += 14) el('line', { x1: 0, y1: y, x2: 200, y2: y, stroke: 'rgba(0,0,0,.08)', 'stroke-width': .6 }, g);
    },
    plage(g) {
      el('rect', { x: 0, y: 44, width: 200, height: 18, fill: '#2f86b8' }, g);              // mer
      for (const x of [20, 70, 130, 175]) el('path', { d: `M${x} 50 q3 -2 6 0 q3 2 6 0`, fill: 'none', stroke: '#bfe3f5', 'stroke-width': .7 }, g);
      el('path', { d: 'M0 62 Q50 57 100 61 T200 60 V125 H0 Z', fill: '#ecd59c' }, g);       // sable
    },
    arret(g) {
      el('rect', { x: 0, y: 24, width: 200, height: 36, fill: '#b9a690' }, g);              // immeubles
      for (let x = 8; x < 200; x += 22) el('rect', { x, y: 30, width: 10, height: 10, fill: '#7d8a99' }, g);
      el('rect', { x: 0, y: 52, width: 200, height: 14, fill: '#55524f' }, g);              // chaussée du fond
      for (let x = 6; x < 200; x += 24) el('rect', { x, y: 58.5, width: 12, height: 1.2, fill: '#e8e2d0' }, g);
      el('rect', { x: 0, y: 66, width: 200, height: 59, fill: '#b0aaa2' }, g);              // trottoir
      el('rect', { x: 0, y: 66, width: 200, height: 2, fill: '#8a847c' }, g);
      // L'abri : un toit et deux montants.
      el('rect', { x: 12, y: 30, width: 64, height: 4, fill: '#3e4a52', ...tr(.6) }, g);
      el('rect', { x: 14, y: 34, width: 2, height: 32, fill: '#3e4a52' }, g);
      el('rect', { x: 72, y: 34, width: 2, height: 32, fill: '#3e4a52' }, g);
    },
  };

  // Où se pose chaque emplacement : x, y (les pieds) et l'échelle.
  const POSES = {
    gare: {
      train: [100, 58, .62], affiche: [46, 34, .9], banc: [42, 96, 1], voyageur: [100, 92, 1],
      quai: [160, 95, 1], bagage: [72, 118, 1], sol: [138, 118, 1.1],
    },
    terrasse: {
      enseigne: [100, 26, 1], trottoir: [130, 62, .55], 'table-gauche': [38, 98, 1], serveur: [112, 92, 1],
      'table-droite': [164, 98, 1], parasol: [70, 92, 1], pieds: [96, 119, 1.1],
    },
    parc: {
      arbre: [40, 60, .9], monument: [150, 61, .75], banc: [36, 97, 1], allee: [100, 92, 1],
      pelouse: [166, 97, 1], chemin: [72, 119, 1], sol: [138, 119, 1.1],
    },
    superette: {
      rayon: [52, 62, .95], affiche: [96, 54, .8], caisse: [32, 98, 1], client: [100, 93, 1],
      entree: [168, 97, 1], chariot: [70, 119, 1], sol: [140, 119, 1.1],
    },
    plage: {
      mer: [120, 52, .5], parasol: [26, 96, 1], serviette: [56, 99, 1], sable: [100, 104, 1],
      rivage: [148, 96, 1], promeneur: [182, 93, 1], 'ciel-bas': [100, 116, 1.1],
    },
    arret: {
      route: [110, 64, .6], abri: [44, 56, .85], banc: [40, 97, 1], attente: [100, 93, 1],
      trottoir: [164, 96, 1], chaussee: [80, 121, 1], sol: [152, 119, 1.1],
    },
  };
  // Un emplacement inconnu : la position de sa zone.
  const PAR_ZONE = { fond: [100, 58, .6], gauche: [40, 95, 1], centre: [100, 92, 1], droite: [162, 95, 1], premier: [100, 118, 1.1] };

  // ------------------------------------------------------- les éléments
  // Chacun : pieds en (0, 0), une personne debout mesure ~40.

  function tete(g, x, y, r, cheveux) {
    el('circle', { cx: x, cy: y, r, fill: PEAU, ...tr(.9) }, g);
    el('path', { d: `M${x - r} ${y - .5} C${x - r} ${y - r * 1.5} ${x + r} ${y - r * 1.5} ${x + r} ${y - .5} C${x + r * .5} ${y - r * .55} ${x - r * .5} ${y - r * .55} ${x - r} ${y - .5} Z`, fill: cheveux || '#4a3220', ...tr(.7) }, g);
  }

  function personne(g, v) {
    const c = coul(v.tenue);
    if (v.pose === 'assis') {
      // Un banc, et la personne assise dessus.
      el('rect', { x: -14, y: -14, width: 28, height: 3, fill: '#8a5a2b', ...tr(.8) }, g);
      el('rect', { x: -12, y: -11, width: 2.4, height: 11, fill: '#5a3a1e' }, g);
      el('rect', { x: 9.6, y: -11, width: 2.4, height: 11, fill: '#5a3a1e' }, g);
      el('path', { d: 'M-4 -14 h10 v2 h-2 v12 h-3 v-10 h-5 z', fill: '#34302c', ...tr(.6) }, g);   // jambes pliées
      el('path', { d: 'M-6 -14 L-5 -30 Q1 -33 7 -30 L7 -14 Z', fill: c, ...tr(1) }, g);
      tete(g, 1, -35, 5);
      objetEnMain(g, v.objet, 8, -20, c);
      return;
    }
    el('rect', { x: -4.5, y: -15, width: 3.6, height: 15, fill: '#34302c', ...tr(.6) }, g);
    el('rect', { x: 1, y: -15, width: 3.6, height: 15, fill: '#34302c', ...tr(.6) }, g);
    el('path', { d: 'M-7 -14 L-6 -31 Q0 -34 6 -31 L7 -14 Z', fill: c, ...tr(1) }, g);
    el('path', { d: 'M-6 -30 L-9 -17', ...tr(3.2, { stroke: c }) }, g);
    el('path', { d: 'M6 -30 L9 -18', ...tr(3.2, { stroke: c }) }, g);
    tete(g, 0, -36.5, 5);
    objetEnMain(g, v.objet, 9, -17, c);
  }

  // L'objet tenu, la main en (x, y).
  function objetEnMain(g, o, x, y) {
    if (o === 'parapluie') {
      el('line', { x1: x, y1: y + 1, x2: x, y2: y - 28, ...tr(1) }, g);
      el('path', { d: `M${x - 13} ${y - 26} Q${x} ${y - 40} ${x + 13} ${y - 26} Q${x + 6.5} ${y - 29} ${x} ${y - 26} Q${x - 6.5} ${y - 29} ${x - 13} ${y - 26} Z`, fill: '#33405e', ...tr(.9) }, g);
    } else if (o === 'valise') {
      el('rect', { x: x - 2, y: y + 2, width: 9, height: 12, fill: '#8a5a2b', ...tr(.9) }, g);
      el('path', { d: `M${x} ${y + 2} v-2 h5 v2`, fill: 'none', ...tr(.8) }, g);
    } else if (o === 'journal') {
      el('rect', { x: x - 6, y: y - 9, width: 9, height: 11, fill: '#f2ede0', ...tr(.8) }, g);
      for (const d of [-6, -3, 0]) el('line', { x1: x - 4.5, y1: y + d, x2: x + 1.5, y2: y + d, stroke: '#6a6250', 'stroke-width': .6 }, g);
    } else if (o === 'cafe') {
      el('path', { d: `M${x - 2} ${y - 5} h5 l-.6 6 h-3.8 z`, fill: '#f4f1e8', ...tr(.7) }, g);
      el('path', { d: `M${x - 1} ${y - 7} q1 -1.5 0 -3 M${x + 1.5} ${y - 7} q1 -1.5 0 -3`, fill: 'none', stroke: '#fff', 'stroke-width': .6 }, g);
    } else if (o === 'chien') {
      el('path', { d: `M${x} ${y} Q${x + 6} ${y + 4} ${x + 9} ${y + 9}`, fill: 'none', stroke: TRAIT, 'stroke-width': .6 }, g);
      const c = el('g', { transform: `translate(${x + 14} ${y + 17}) scale(.75)` }, g);
      chien(c, { couleur: 'brun' });
    } else if (o === 'sac') {
      el('path', { d: `M${x - 4} ${y - 12} L${x} ${y}`, ...tr(.7) }, g);
      el('rect', { x: x - 2, y: y - 1, width: 8, height: 7, fill: '#5a3a1e', ...tr(.8) }, g);
    } else if (o === 'plateau') {
      el('rect', { x: x - 4, y: y - 9, width: 12, height: 1.6, fill: '#b9bcc0', ...tr(.6) }, g);
      el('rect', { x: x - 2, y: y - 14, width: 2.4, height: 5, fill: 'rgba(220,240,255,.8)', ...tr(.5) }, g);
      el('rect', { x: x + 3, y: y - 14, width: 2.4, height: 5, fill: 'rgba(220,240,255,.8)', ...tr(.5) }, g);
      el('line', { x1: x, y1: y, x2: x + 1, y2: y - 7.5, ...tr(1.6, { stroke: PEAU }) }, g);
    } else if (o === 'panier') {
      el('path', { d: `M${x - 4} ${y + 1} h10 l-1.5 7 h-7 z`, fill: '#d0392e', ...tr(.8) }, g);
      el('path', { d: `M${x - 2} ${y + 1} q3 -5 6 0`, fill: 'none', ...tr(.7) }, g);
    } else if (o === 'telephone') {
      el('rect', { x: x - 6, y: y - 22, width: 3, height: 5.5, fill: '#1e1e22', ...tr(.5) }, g);
      el('line', { x1: x, y1: y, x2: x - 4.5, y2: y - 17, ...tr(1.6, { stroke: PEAU }) }, g);
    }
    el('circle', { cx: x, cy: y, r: 1.6, fill: PEAU, ...tr(.6) }, g);
  }

  function enfant(g, v) {
    const c = coul(v.tenue);
    el('rect', { x: -3.2, y: -10, width: 2.6, height: 10, fill: '#34302c' }, g);
    el('rect', { x: .6, y: -10, width: 2.6, height: 10, fill: '#34302c' }, g);
    el('path', { d: 'M-5 -9 L-4.5 -21 Q0 -23 4.5 -21 L5 -9 Z', fill: c, ...tr(.9) }, g);
    el('path', { d: 'M4.5 -20 L7 -12', ...tr(2.4, { stroke: c }) }, g);
    tete(g, 0, -25.5, 4.2, '#7a4a20');
    const x = 7, y = -11;
    if (v.objet === 'ballon') {
      el('circle', { cx: 9, cy: -4, r: 4, fill: '#f4f1e8', ...tr(.8) }, g);
      el('path', { d: 'M5 -4 Q9 -7 13 -4 M9 -8 Q7 -4 9 0', fill: 'none', stroke: '#d0392e', 'stroke-width': 1 }, g);
    } else if (v.objet === 'glace') {
      el('path', { d: `M${x - 1.5} ${y - 2} l1.5 5 l1.5 -5 z`, fill: '#d9a35a', ...tr(.6) }, g);
      el('circle', { cx: x, cy: y - 3.5, r: 2, fill: '#f6b3c8', ...tr(.6) }, g);
    } else if (v.objet === 'seau') {
      el('path', { d: `M${x - 2} ${y + 1} h6 l-1 6 h-4 z`, fill: '#2f6fd0', ...tr(.7) }, g);
      el('path', { d: `M${x - 2} ${y + 1} q3 -4 6 0`, fill: 'none', ...tr(.6) }, g);
    } else if (v.objet === 'cerf-volant') {
      el('path', { d: `M${x} ${y} Q${x + 8} ${y - 20} ${x + 4} ${y - 34}`, fill: 'none', stroke: TRAIT, 'stroke-width': .5 }, g);
      el('path', { d: `M${x + 4} ${y - 34} l5 -5 l-3 -8 l-6 6 z`, fill: '#e94e77', ...tr(.7) }, g);
      el('path', { d: `M${x + 4} ${y - 34} q-2 4 1 7 q-2 3 0 6`, fill: 'none', stroke: '#f2c81c', 'stroke-width': .8 }, g);
    }
    el('circle', { cx: x, cy: y, r: 1.3, fill: PEAU, ...tr(.5) }, g);
  }

  const POILS = { brun: '#8a5a2b', noir: '#2a2522', blanc: '#f4f1e8', roux: '#e0883a' };
  function chien(g, v) {
    const c = POILS[v.couleur] || '#8a5a2b';
    for (const x of [-7, -4, 4, 7]) el('rect', { x: x - .9, y: -6, width: 1.8, height: 6, fill: c, ...tr(.5) }, g);
    el('ellipse', { cx: 0, cy: -8, rx: 9, ry: 4, fill: c, ...tr(.8) }, g);
    el('path', { d: 'M-9 -9 q-4 -3 -3 -7', fill: 'none', ...tr(1.4, { stroke: c }) }, g);
    el('circle', { cx: 9, cy: -12, r: 3.6, fill: c, ...tr(.8) }, g);
    el('path', { d: 'M8 -15 q-2 3 -1 6', fill: 'none', ...tr(1.6, { stroke: v.couleur === 'noir' ? '#4a4038' : '#5a3a1e' }) }, g);
    el('circle', { cx: 10.2, cy: -12.6, r: .6, fill: TRAIT }, g);
  }
  function chat(g, v) {
    const c = POILS[v.couleur] || '#e0883a';
    el('ellipse', { cx: 0, cy: -4, rx: 6, ry: 3.6, fill: c, ...tr(.8) }, g);
    el('path', { d: 'M-6 -4 Q-11 -6 -9 -13', fill: 'none', ...tr(1.4, { stroke: c }) }, g);
    el('circle', { cx: 6, cy: -8, r: 3.2, fill: c, ...tr(.8) }, g);
    el('path', { d: 'M3.6 -10 l.8 -3.6 l2 2.4 M6.8 -10.6 l1.6 -3.2 l1 3.4', fill: c, ...tr(.6) }, g);
    el('circle', { cx: 7.2, cy: -8.4, r: .5, fill: TRAIT }, g);
  }
  function oiseaux(g, v) {
    const n = v.nombre === 3 ? 3 : 1;
    const pos = n === 3 ? [[-12, 0], [0, 1], [12, -1]] : [[0, 0]];
    for (const [x, y] of pos) {
      const o = el('g', { transform: `translate(${x} ${y})` }, g);
      if (v.espece === 'mouette') {
        // En vol, au ras du sable : ailes en « M », corps blanc.
        el('path', { d: 'M-7 -14 Q-3.5 -18 0 -14 Q3.5 -18 7 -14', fill: 'none', ...tr(1.2) }, o);
        el('ellipse', { cx: 0, cy: -13.6, rx: 2.2, ry: 1.2, fill: '#f4f1e8', ...tr(.5) }, o);
      } else {
        el('ellipse', { cx: 0, cy: -3, rx: 3.6, ry: 2.4, fill: '#8a8f9a', ...tr(.6) }, o);
        el('circle', { cx: 3, cy: -5.4, r: 1.6, fill: '#6a7080', ...tr(.5) }, o);
        el('path', { d: 'M4.4 -5.4 l1.4 .5 l-1.4 .4', fill: '#e0883a' }, o);
        el('line', { x1: -.5, y1: -.8, x2: -.5, y2: 0, ...tr(.5, { stroke: '#d0603a' }) }, o);
        el('line', { x1: 1, y1: -.8, x2: 1, y2: 0, ...tr(.5, { stroke: '#d0603a' }) }, o);
      }
    }
  }

  function roue(g, x, y, r) { el('circle', { cx: x, cy: y, r, fill: 'none', ...tr(1.2) }, g); el('circle', { cx: x, cy: y, r: .8, fill: TRAIT }, g); }
  function velo(g, v) {
    const c = coul(v.couleur);
    roue(g, -9, -5, 5); roue(g, 9, -5, 5);
    el('path', { d: 'M-9 -5 L-2 -5 L5 -13 L-4 -13 Z M-2 -5 L-5 -15 M5 -13 L9 -5 M5 -13 L4 -17', fill: 'none', ...tr(2, { stroke: c }) }, g);
    el('path', { d: 'M-7 -15.5 h4 M2 -17.5 h4', ...tr(1.2) }, g);
  }
  function trottinette(g, v) {
    const c = coul(v.couleur);
    roue(g, -8, -2.5, 2.5); roue(g, 8, -2.5, 2.5);
    el('path', { d: 'M-8 -4 H6 L8 -22 M5 -22 H11', fill: 'none', ...tr(2, { stroke: c }) }, g);
  }
  function voiture(g, v) {
    const c = coul(v.couleur);
    el('path', { d: 'M-24 -5 V-12 Q-24 -14 -21 -14 L-13 -15 L-7 -22 H8 L15 -15 L22 -14 Q24 -13 24 -10 V-5 Z', fill: c, ...tr(1) }, g);
    el('path', { d: 'M-11 -15 L-6 -20.5 H-1 V-15 Z M1 -15 V-20.5 H7 L12 -15 Z', fill: '#a9d3ee', ...tr(.6) }, g);
    roue(g, -14, -5, 4.5); roue(g, 14, -5, 4.5);
    el('circle', { cx: -14, cy: -5, r: 4.5, fill: '#2a2522' }, g);
    el('circle', { cx: 14, cy: -5, r: 4.5, fill: '#2a2522' }, g);
  }
  function bus(g, v) {
    const c = coul(v.couleur);
    el('rect', { x: -48, y: -30, width: 96, height: 25, rx: 3, fill: c, ...tr(1) }, g);
    for (let x = -42; x < 34; x += 13) el('rect', { x, y: -26, width: 10, height: 9, fill: '#a9d3ee', ...tr(.6) }, g);
    el('rect', { x: 36, y: -26, width: 8, height: 19, fill: '#a9d3ee', ...tr(.6) }, g);
    for (const x of [-32, 30]) el('circle', { cx: x, cy: -5, r: 5, fill: '#2a2522', ...tr(.6) }, g);
  }
  function train(g, v) {
    const c = coul(v.couleur);
    el('path', { d: 'M-150 -6 V-36 H120 Q150 -36 156 -12 L158 -6 Z', fill: c, ...tr(1.2) }, g);
    for (let x = -142; x < 110; x += 22) el('rect', { x, y: -31, width: 15, height: 11, fill: '#a9d3ee', ...tr(.7) }, g);
    el('rect', { x: -150, y: -16, width: 300, height: 3, fill: 'rgba(255,255,255,.55)' }, g);
    el('rect', { x: -150, y: -6, width: 308, height: 3, fill: '#2a2522' }, g);
  }
  function bateau(g, v) {
    const c = coul(v.couleur);
    el('path', { d: 'M-20 -8 H22 L16 0 H-15 Z', fill: c, ...tr(1) }, g);
    el('line', { x1: 0, y1: -8, x2: 0, y2: -40, ...tr(1.2) }, g);
    el('path', { d: 'M1 -38 L18 -10 H1 Z', fill: '#f4f1e8', ...tr(.9) }, g);
  }
  function valise(g, v) {
    const c = coul(v.couleur);
    el('rect', { x: -6, y: -15, width: 12, height: 14, rx: 1.5, fill: c, ...tr(1) }, g);
    el('path', { d: 'M-2 -15 v-3 h4 v3', fill: 'none', ...tr(.9) }, g);
    roue(g, -4, -.6, .8); roue(g, 4, -.6, .8);
  }
  function sac(g, v) {
    const c = coul(v.couleur);
    el('path', { d: 'M-6 0 L-5 -10 H5 L6 0 Z', fill: c, ...tr(1) }, g);
    el('path', { d: 'M-3 -10 Q0 -15 3 -10', fill: 'none', ...tr(.9) }, g);
  }
  function caddie(g, v) {
    const c = coul(v.couleur);
    el('path', { d: 'M-12 -20 H-8 L-5 -8 H10 L13 -18 H-7', fill: 'none', ...tr(1.6, { stroke: c }) }, g);
    for (let x = -4; x < 12; x += 3.2) el('line', { x1: x, y1: -17.5, x2: x + .2, y2: -9, stroke: c, 'stroke-width': .7 }, g);
    roue(g, -3, -2, 2); roue(g, 9, -2, 2);
  }
  function parasol(g, v) {
    const c = coul(v.couleur);
    el('line', { x1: 0, y1: 0, x2: 0, y2: -40, ...tr(1.4, { stroke: '#5a3a1e' }) }, g);
    el('path', { d: 'M-22 -36 Q0 -54 22 -36 Z', fill: c, ...tr(1) }, g);
    el('path', { d: 'M-8 -36 Q-4 -50 0 -48 Q4 -50 8 -36 Z', fill: '#f4f1e8', opacity: v.couleur === 'blanc' ? 0 : .85 }, g);
  }
  function serviette(g, v) {
    const c = coul(v.couleur);
    el('path', { d: 'M-18 -1 L-12 -9 H16 L20 -1 Z', fill: c, ...tr(1) }, g);
    el('path', { d: 'M-12 -5 H18', stroke: '#f4f1e8', 'stroke-width': 1.4 }, g);
  }
  function enseigne(g, v) {
    const c = coul(v.couleur);
    el('rect', { x: -32, y: -12, width: 64, height: 13, fill: c, ...tr(1) }, g);
    const t = el('text', { x: 0, y: -2.2, 'text-anchor': 'middle', 'font-size': 9, 'font-weight': 700, fill: v.couleur === 'blanc' || v.couleur === 'jaune' ? '#1b140c' : '#f4f1e8', 'font-family': 'Arial, sans-serif', 'letter-spacing': 2 }, g);
    t.textContent = 'CAFÉ';
  }
  function affiche(g, v) {
    el('rect', { x: -12, y: -32, width: 24, height: 32, fill: '#f4ecd8', ...tr(1) }, g);
    const m = v.motif;
    if (m === 'soleil') {
      el('rect', { x: -10, y: -30, width: 20, height: 22, fill: '#9ad0f0' }, g);
      el('circle', { cx: 0, cy: -20, r: 5, fill: '#f2c81c', ...tr(.6) }, g);
    } else if (m === 'montagne') {
      el('rect', { x: -10, y: -30, width: 20, height: 22, fill: '#bfe1fb' }, g);
      el('path', { d: 'M-10 -8 L-3 -24 L3 -14 L6 -18 L10 -8 Z', fill: '#6a7a8a', ...tr(.6) }, g);
      el('path', { d: 'M-5 -20 L-3 -24 L-1 -20 Z', fill: '#fff' }, g);
    } else if (m === 'gateau') {
      el('rect', { x: -7, y: -18, width: 14, height: 9, fill: '#f6b3c8', ...tr(.6) }, g);
      el('rect', { x: -7, y: -18, width: 14, height: 2.5, fill: '#fff' }, g);
      el('line', { x1: 0, y1: -18, x2: 0, y2: -24, ...tr(1, { stroke: '#d0392e' }) }, g);
    } else if (m === 'chat') {
      el('circle', { cx: 0, cy: -18, r: 6, fill: '#2a2522' }, g);
      el('path', { d: 'M-5 -21 l1 -6 l3 4 M5 -21 l-1 -6 l-3 4', fill: '#2a2522' }, g);
      el('circle', { cx: -2, cy: -18.5, r: .9, fill: '#f2c81c' }, g); el('circle', { cx: 2, cy: -18.5, r: .9, fill: '#f2c81c' }, g);
    } else if (m === 'concert') {
      el('rect', { x: -10, y: -30, width: 20, height: 22, fill: '#2a2140' }, g);
      el('path', { d: 'M-2 -12 V-24 L5 -26 V-14', fill: 'none', ...tr(1, { stroke: '#f2c81c' }) }, g);
      el('circle', { cx: -3.5, cy: -12, r: 2, fill: '#f2c81c' }, g); el('circle', { cx: 3.5, cy: -14, r: 2, fill: '#f2c81c' }, g);
    }
    el('rect', { x: -10, y: -6.5, width: 20, height: 3, fill: '#c9bfa8' }, g);
  }
  function arbre(g, v) {
    el('path', { d: 'M-3 0 L-2 -24 H2 L3 0 Z', fill: '#6a4a2a', ...tr(1) }, g);
    if (v.saison === 'hiver') {
      el('path', { d: 'M0 -22 L-12 -38 M0 -26 L10 -42 M-6 -30 L-10 -30 M5 -34 L12 -32 M0 -24 L1 -46', fill: 'none', ...tr(1.6, { stroke: '#6a4a2a' }) }, g);
      el('path', { d: 'M-14 -39 q2 -2 4 0 M8 -43 q2 -2 4 0 M-1 -47 q2 -2 4 0', fill: 'none', stroke: '#fff', 'stroke-width': 1.6 }, g);
      el('ellipse', { cx: 0, cy: 0, rx: 14, ry: 2, fill: '#f4f4f4' }, g);
      return;
    }
    const c = v.saison === 'automne' ? ['#e0883a', '#c8582a'] : ['#3e8a32', '#2e6e26'];
    el('circle', { cx: -8, cy: -30, r: 10, fill: c[1], ...tr(.9) }, g);
    el('circle', { cx: 8, cy: -32, r: 10, fill: c[1], ...tr(.9) }, g);
    el('circle', { cx: 0, cy: -40, r: 12, fill: c[0], ...tr(.9) }, g);
    if (v.saison === 'automne') for (const [x, y] of [[-10, -1], [7, 0], [13, -1]]) el('ellipse', { cx: x, cy: y, rx: 1.8, ry: .9, fill: '#c8582a' }, g);
  }
  function fontaine(g) {
    el('path', { d: 'M-22 0 V-7 H22 V0 Z', fill: '#a9a39a', ...tr(1) }, g);
    el('rect', { x: -3, y: -18, width: 6, height: 11, fill: '#a9a39a', ...tr(.8) }, g);
    el('path', { d: 'M0 -18 Q-10 -30 -16 -8 M0 -18 Q10 -30 16 -8 M0 -18 V-28', fill: 'none', stroke: '#5ab0e6', 'stroke-width': 1.6 }, g);
    el('rect', { x: -20, y: -8, width: 40, height: 2, fill: '#5ab0e6' }, g);
  }
  function kiosque(g) {
    el('rect', { x: -24, y: -4, width: 48, height: 4, fill: '#d9c7a0', ...tr(.9) }, g);
    for (const x of [-20, -7, 7, 20]) el('rect', { x: x - 1, y: -26, width: 2, height: 22, fill: '#f4f1e8', ...tr(.6) }, g);
    el('path', { d: 'M-28 -26 L0 -42 L28 -26 Z', fill: '#3e8a6a', ...tr(1) }, g);
    el('line', { x1: 0, y1: -42, x2: 0, y2: -47, ...tr(1) }, g);
  }
  function chateau(g) {
    const s = '#d9b870';
    el('rect', { x: -14, y: -10, width: 28, height: 10, fill: s, ...tr(.9) }, g);
    for (const x of [-14, -3, 8]) el('path', { d: `M${x} -10 V-19 h2 v2 h2 v-2 h2 V-10 Z`, fill: s, ...tr(.8) }, g);
    el('path', { d: 'M3 -30 V-22 M3 -30 l5 2 l-5 2', fill: '#d0392e', ...tr(.6) }, g);
    el('line', { x1: 3, y1: -22, x2: 3, y2: -19, ...tr(.6) }, g);
  }
  function rayon(g, v) {
    el('rect', { x: -32, y: -44, width: 64, height: 44, fill: '#b98a5a', ...tr(1) }, g);
    for (const y of [-30, -16, -2]) {
      el('rect', { x: -30, y: y - 12, width: 60, height: 12, fill: '#efe6d2' }, g);
      el('rect', { x: -32, y, width: 64, height: 2, fill: '#8a5a2b' }, g);
      for (let x = -27; x < 30; x += 7) {
        if (v.produit === 'fruits') el('circle', { cx: x + 1.5, cy: y - 3, r: 2.8, fill: ['#d0392e', '#f08020', '#3e9b3a', '#f2c81c'][((x + 27) / 7) % 4], ...tr(.5) }, g);
        else if (v.produit === 'boites') el('rect', { x: x - 1, y: y - 8, width: 5.5, height: 8, fill: ['#2f6fd0', '#d0392e', '#f2c81c'][((x + 27) / 7) % 3], ...tr(.5) }, g);
        else el('path', { d: `M${x} ${y} v-6 l1.2 -2.5 v-2 h1.6 v2 l1.2 2.5 v6 Z`, fill: ['#3e9b3a', '#8a4fc0', '#a9d3ee'][((x + 27) / 7) % 3], ...tr(.5) }, g);
      }
    }
  }

  const DESSINS = {
    personne, enfant, chien, chat, oiseaux, velo, trottinette, voiture, bus, train, bateau,
    valise, sac, caddie, parasol, serviette, enseigne, affiche, arbre, fontaine, kiosque, chateau, rayon,
  };

  // ------------------------------------------------------------ la scène
  // `scene` : { place, title, items: [{ slot, zone, item }] }. `opts.id` :
  // préfixe des id (dégradés), un par dessin visible à la fois.
  let compteur = 0;
  function dessiner(scene, opts) {
    const o = opts || {};
    const p = o.id || `sc${++compteur}`;
    const svg = el('svg', { viewBox: '0 0 200 125', class: 'scene-svg', role: 'img', focusable: 'false', preserveAspectRatio: 'xMidYMid meet' });
    svg.setAttribute('aria-label', o.label || decrire(scene));
    if (!scene || !Array.isArray(scene.items)) return svg;
    const items = scene.items.filter((x) => x && typeof x === 'object');
    const leCiel = items.find((x) => x.item && x.item.kind === 'ciel');
    const g = el('g', {}, svg);
    ciel(g, leCiel ? leCiel.item.moment : 'midi', p);
    const decor = Object.prototype.hasOwnProperty.call(DECORS, scene.place) ? DECORS[scene.place] : null;
    if (decor) decor(g);
    else el('rect', { x: 0, y: 58, width: 200, height: 67, fill: '#b0a898' }, g);
    // Du fond vers le premier plan : l'ordre de tracé EST la profondeur.
    const poses = (Object.prototype.hasOwnProperty.call(POSES, scene.place) && POSES[scene.place]) || {};
    const places = items
      .filter((x) => x.item && x.item.kind !== 'ciel' && Object.prototype.hasOwnProperty.call(DESSINS, x.item.kind))
      .map((x) => ({ x, pose: (Object.prototype.hasOwnProperty.call(poses, x.slot) && poses[x.slot]) || PAR_ZONE[x.zone] || PAR_ZONE.centre }))
      .sort((a, b) => a.pose[1] - b.pose[1]);
    for (const { x, pose } of places) {
      const [px, py, s] = pose;
      const it = el('g', { class: `it it-${x.item.kind}`, 'data-slot': String(x.slot), transform: `translate(${px} ${py}) scale(${s})` }, g);
      DESSINS[x.item.kind](it, x.item);
    }
    return svg;
  }

  // ------------------------------------------------------- les mots
  const OBJETS = {
    rien: '', parapluie: 'avec un parapluie', valise: 'avec une valise', journal: 'avec un journal', cafe: 'avec un café',
    chien: 'avec un chien', sac: 'avec un sac', plateau: 'avec un plateau', panier: 'avec un panier', telephone: 'au téléphone',
    ballon: 'avec un ballon', glace: 'avec une glace', seau: 'avec un seau', 'cerf-volant': 'avec un cerf-volant',
  };
  const fem = { rouge: 'rouge', bleu: 'bleue', jaune: 'jaune', vert: 'verte', violet: 'violette', orange: 'orange', blanc: 'blanche', noir: 'noire' };
  const ZONES = { fond: 'au fond', gauche: 'à gauche', centre: 'au centre', droite: 'à droite', premier: 'au premier plan' };
  const MOMENTS = { matin: 'le matin', midi: 'en plein jour', soir: 'le soir', nuit: 'la nuit' };

  // Un élément en mots : « une personne en rouge, assise, avec un journal ».
  function nommer(v) {
    if (!v || typeof v !== 'object') return '';
    const c = NOM_COULEUR[v.couleur] || v.couleur;
    const cf = fem[v.couleur] || v.couleur;
    switch (v.kind) {
      case 'personne': return ['une personne en ' + (NOM_COULEUR[v.tenue] || v.tenue), v.pose === 'assis' ? 'assise' : '', OBJETS[v.objet] || ''].filter(Boolean).join(', ');
      case 'enfant': return ['un enfant en ' + (NOM_COULEUR[v.tenue] || v.tenue), OBJETS[v.objet] || ''].filter(Boolean).join(', ');
      case 'chien': return `un chien ${v.couleur}`;
      case 'chat': return `un chat ${v.couleur}`;
      case 'oiseaux': return v.nombre === 3 ? `trois ${v.espece}s` : `un${v.espece === 'mouette' ? 'e' : ''} ${v.espece}`;
      case 'velo': return `un vélo ${c}`;
      case 'trottinette': return `une trottinette ${cf}`;
      case 'voiture': return `une voiture ${cf}`;
      case 'bus': return `un bus ${c}`;
      case 'train': return `un train ${c}`;
      case 'bateau': return `un bateau ${c}`;
      case 'valise': return `une valise ${cf}`;
      case 'sac': return `un sac ${c}`;
      case 'caddie': return `un caddie ${c}`;
      case 'parasol': return `un parasol ${c}`;
      case 'serviette': return `une serviette ${cf}`;
      case 'enseigne': return `une enseigne ${cf}`;
      case 'affiche': return `une affiche (${{ soleil: 'un soleil', montagne: 'une montagne', gateau: 'un gâteau', chat: 'un chat', concert: 'un concert' }[v.motif] || v.motif})`;
      case 'arbre': return `un arbre ${{ ete: "d'été", automne: "d'automne", hiver: "d'hiver" }[v.saison] || ''}`.trim();
      case 'fontaine': return 'une fontaine';
      case 'kiosque': return 'un kiosque';
      case 'chateau': return 'un château de sable';
      case 'rayon': return `un rayon de ${{ fruits: 'fruits', boites: 'boîtes', bouteilles: 'bouteilles' }[v.produit] || v.produit}`;
      default: return '';
    }
  }

  // La scène en une phrase (lecteur d'écran) : le titre, le moment, puis zone
  // par zone.
  function decrire(scene) {
    if (!scene || !Array.isArray(scene.items)) return '';
    const leCiel = scene.items.find((x) => x && x.item && x.item.kind === 'ciel');
    const parties = [];
    for (const z of ['fond', 'gauche', 'centre', 'droite', 'premier']) {
      const ici = scene.items.filter((x) => x && x.zone === z && x.item && x.item.kind !== 'ciel').map((x) => nommer(x.item)).filter(Boolean);
      if (ici.length) parties.push(`${ZONES[z]} : ${ici.join(' ; ')}`);
    }
    const tete = [scene.title || '', leCiel ? MOMENTS[leCiel.item.moment] || '' : ''].filter(Boolean).join(', ');
    return `${tete}. ${parties.join('. ')}.`;
  }

  root.TemoinScene = { dessiner, decrire, nommer, COULEURS };
})(typeof window !== 'undefined' ? window : globalThis);
