// Faux Témoin — le dessin des suspects et les mots pour les dire. Aucune règle
// ici : le tapissage, le coupable et les fragments viennent de temoin-server.
// Ce module ne fait que DESSINER un suspect décrit par ses attributs (le même
// vocabulaire fermé que le serveur) et nommer ces attributs en français.
//
// Dessin maison en SVG, aplats + contour sombre, aucun asset. Construit par
// createElementNS : aucune donnée du réseau ne passe par innerHTML, et une
// valeur inconnue (serveur plus récent) dessine simplement « rien ».
(function (root) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';

  // Les libellés : attribut, puis valeur (forme courte, pour un bouton) et
  // forme longue (pour une phrase : « chapeau melon », « manteau rouge »).
  const LIBELLES = {
    chapeau: { nom: 'Chapeau', valeurs: {
      aucun: ['Aucun', 'sans chapeau'], melon: ['Melon', 'chapeau melon'], casquette: ['Casquette', 'casquette'],
      bonnet: ['Bonnet', 'bonnet'], 'haut-de-forme': ['Haut-de-forme', 'haut-de-forme'] } },
    manteau: { nom: 'Manteau', valeurs: {
      rouge: ['Rouge', 'manteau rouge'], bleu: ['Bleu', 'manteau bleu'], vert: ['Vert', 'manteau vert'],
      jaune: ['Jaune', 'manteau jaune'], violet: ['Violet', 'manteau violet'] } },
    visage: { nom: 'Visage', valeurs: {
      rien: ['Rien', 'rien au visage'], lunettes: ['Lunettes', 'lunettes'], moustache: ['Moustache', 'moustache'],
      barbe: ['Barbe', 'barbe'], 'cache-oeil': ['Cache-œil', 'cache-œil'] } },
    objet: { nom: 'Objet', valeurs: {
      rien: ['Rien', 'mains vides'], parapluie: ['Parapluie', 'parapluie'], valise: ['Valise', 'valise'],
      journal: ['Journal', 'journal'], canne: ['Canne', 'canne'] } },
    carrure: { nom: 'Carrure', valeurs: {
      mince: ['Mince', 'mince'], moyenne: ['Moyenne', 'carrure moyenne'], costaud: ['Costaud', 'costaud'] } },
  };
  const ORDRE = ['chapeau', 'manteau', 'visage', 'objet', 'carrure'];

  const nomAttr = (a) => (LIBELLES[a] || {}).nom || a;
  const court = (a, v) => (((LIBELLES[a] || {}).valeurs || {})[v] || [v])[0];
  const long = (a, v) => (((LIBELLES[a] || {}).valeurs || {})[v] || [null, v])[1];
  // « chapeau melon, manteau rouge, lunettes, parapluie, costaud »
  const decrire = (s) => ORDRE.filter((a) => s && s[a] != null).map((a) => long(a, s[a])).join(', ');

  // Les teintes des manteaux : distinctes en luminance autant qu'en teinte
  // (jamais la seule couleur pour dire quelque chose : le nom est toujours
  // écrit dans l'aria-label, l'infobulle et la fiche du suspect).
  const MANTEAUX = { rouge: '#b33a3a', bleu: '#3c6fb0', vert: '#4d8a3a', jaune: '#e0b83a', violet: '#7a4f9e' };
  const LARGEUR = { mince: 0.8, moyenne: 1, costaud: 1.24 };
  const TRAIT = '#1b140c';
  const PEAU = '#e2b68c';

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, String(v));
    if (parent) parent.appendChild(e);
    return e;
  }
  const trait = (extra) => ({ stroke: TRAIT, 'stroke-width': 2.2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', ...extra });

  // Un suspect, pieds en bas, dans une boîte 100 × 140. `s` : { chapeau,
  // manteau, visage, objet, carrure } (valeurs du vocabulaire du serveur).
  function dessiner(s, opts) {
    const o = opts || {};
    const svg = el('svg', { viewBox: '0 0 100 140', class: 'suspect-svg', 'aria-hidden': 'true', focusable: 'false' });
    const k = LARGEUR[s.carrure] || 1;
    const cx = 50;
    const g = el('g', {}, svg);

    // Jambes et chaussures.
    el('rect', { x: cx - 9 * k, y: 108, width: 7 * k, height: 26, fill: '#2d2a28', ...trait({ 'stroke-width': 1.6 }) }, g);
    el('rect', { x: cx + 2 * k, y: 108, width: 7 * k, height: 26, fill: '#2d2a28', ...trait({ 'stroke-width': 1.6 }) }, g);
    el('path', { d: `M${cx - 11 * k} 134 h${10 * k} v4 h${-12 * k} z`, fill: '#140f0a' }, g);
    el('path', { d: `M${cx + 1 * k} 134 h${10 * k} l2 4 h${-12 * k} z`, fill: '#140f0a' }, g);

    // Le manteau : épaules à 58, ourlet à 114 ; la carrure élargit tout.
    const coul = MANTEAUX[s.manteau] || '#8a8070';
    const ep = 17 * k, bas = 21 * k;
    el('path', { d: `M${cx - ep} 60 Q${cx} 52 ${cx + ep} 60 L${cx + bas} 114 L${cx - bas} 114 Z`, fill: coul, ...trait() }, g);
    // Bras le long du corps.
    el('path', { d: `M${cx - ep} 61 L${cx - ep - 6} 100 L${cx - ep - 1} 102 L${cx - ep + 4} 68 Z`, fill: coul, ...trait() }, g);
    el('path', { d: `M${cx + ep} 61 L${cx + ep + 6} 100 L${cx + ep + 1} 102 L${cx + ep - 4} 68 Z`, fill: coul, ...trait() }, g);
    // Revers, boutons.
    el('path', { d: `M${cx - 6} 56 L${cx} 74 L${cx + 6} 56`, fill: 'none', ...trait({ 'stroke-width': 1.8 }) }, g);
    el('line', { x1: cx, y1: 74, x2: cx, y2: 112, ...trait({ 'stroke-width': 1.4 }) }, g);
    for (const y of [82, 94]) el('circle', { cx: cx + 3, cy: y, r: 1.4, fill: TRAIT }, g);
    // Mains.
    el('circle', { cx: cx - ep - 4, cy: 103, r: 3.6, fill: PEAU, ...trait({ 'stroke-width': 1.6 }) }, g);
    const main = { x: cx + ep + 4, y: 103 };

    // Cou et tête.
    el('rect', { x: cx - 4, y: 48, width: 8, height: 9, fill: PEAU, ...trait({ 'stroke-width': 1.6 }) }, g);
    el('circle', { cx, cy: 38, r: 13, fill: PEAU, ...trait() }, g);
    // Yeux (sous les accessoires), bouche.
    el('circle', { cx: cx - 4.5, cy: 37, r: 1.3, fill: TRAIT }, g);
    el('circle', { cx: cx + 4.5, cy: 37, r: 1.3, fill: TRAIT }, g);
    el('path', { d: `M${cx - 3} 45 Q${cx} 46.5 ${cx + 3} 45`, fill: 'none', ...trait({ 'stroke-width': 1.3 }) }, g);

    visage(g, s.visage, cx);
    chapeau(g, s.chapeau, cx);
    objet(g, s.objet, main);
    el('circle', { cx: main.x, cy: main.y, r: 3.6, fill: PEAU, ...trait({ 'stroke-width': 1.6 }) }, g);

    if (o.titre) { const t = el('title', {}, svg); t.textContent = o.titre; }
    return svg;
  }

  function visage(g, v, cx) {
    if (v === 'lunettes') {
      el('circle', { cx: cx - 5, cy: 37, r: 4, fill: 'rgba(200,225,240,.35)', ...trait({ 'stroke-width': 1.8 }) }, g);
      el('circle', { cx: cx + 5, cy: 37, r: 4, fill: 'rgba(200,225,240,.35)', ...trait({ 'stroke-width': 1.8 }) }, g);
      el('line', { x1: cx - 1, y1: 37, x2: cx + 1, y2: 37, ...trait({ 'stroke-width': 1.6 }) }, g);
    } else if (v === 'moustache') {
      el('path', { d: `M${cx} 42 C${cx - 3} 40 ${cx - 8} 41 ${cx - 9} 44 C${cx - 6} 43.5 ${cx - 3} 44.5 ${cx} 43.2 C${cx + 3} 44.5 ${cx + 6} 43.5 ${cx + 9} 44 C${cx + 8} 41 ${cx + 3} 40 ${cx} 42 Z`, fill: '#3a2414', ...trait({ 'stroke-width': 1 }) }, g);
    } else if (v === 'barbe') {
      el('path', { d: `M${cx - 12} 40 C${cx - 12} 52 ${cx - 6} 57 ${cx} 57 C${cx + 6} 57 ${cx + 12} 52 ${cx + 12} 40 C${cx + 8} 46 ${cx + 4} 43 ${cx} 44 C${cx - 4} 43 ${cx - 8} 46 ${cx - 12} 40 Z`, fill: '#5a3a1e', ...trait({ 'stroke-width': 1.6 }) }, g);
    } else if (v === 'cache-oeil') {
      el('line', { x1: cx - 13, y1: 31, x2: cx + 12, y2: 40, ...trait({ 'stroke-width': 1.4 }) }, g);
      el('ellipse', { cx: cx + 5, cy: 37.5, rx: 4.6, ry: 3.8, fill: TRAIT }, g);
    }
  }

  function chapeau(g, v, cx) {
    if (v === 'melon') {
      el('path', { d: `M${cx - 11} 30 C${cx - 11} 17 ${cx + 11} 17 ${cx + 11} 30 Z`, fill: '#26201b', ...trait() }, g);
      el('rect', { x: cx - 16, y: 29, width: 32, height: 4, rx: 2, fill: '#26201b', ...trait({ 'stroke-width': 1.8 }) }, g);
    } else if (v === 'casquette') {
      el('path', { d: `M${cx - 12} 31 C${cx - 12} 19 ${cx + 12} 19 ${cx + 12} 31 Z`, fill: '#6b5b45', ...trait() }, g);
      el('path', { d: `M${cx + 4} 31 L${cx + 21} 31 L${cx + 19} 34 L${cx + 2} 34 Z`, fill: '#4e4232', ...trait({ 'stroke-width': 1.8 }) }, g);
    } else if (v === 'bonnet') {
      el('path', { d: `M${cx - 13} 33 C${cx - 14} 15 ${cx + 14} 15 ${cx + 13} 33 Z`, fill: '#2f5a6a', ...trait() }, g);
      el('rect', { x: cx - 14, y: 29, width: 28, height: 6, fill: '#244652', ...trait({ 'stroke-width': 1.8 }) }, g);
      el('circle', { cx, cy: 15, r: 3.6, fill: '#e8e0cf', ...trait({ 'stroke-width': 1.6 }) }, g);
    } else if (v === 'haut-de-forme') {
      el('rect', { x: cx - 9, y: 6, width: 18, height: 24, fill: '#1e1a17', ...trait() }, g);
      el('rect', { x: cx - 9, y: 23, width: 18, height: 4, fill: '#7a2a2a' }, g);
      el('rect', { x: cx - 16, y: 29, width: 32, height: 4, rx: 2, fill: '#1e1a17', ...trait({ 'stroke-width': 1.8 }) }, g);
    } else {
      // Sans chapeau : des cheveux.
      el('path', { d: `M${cx - 13} 36 C${cx - 14} 22 ${cx + 14} 22 ${cx + 13} 36 C${cx + 9} 29 ${cx - 9} 29 ${cx - 13} 36 Z`, fill: '#4a3220', ...trait({ 'stroke-width': 1.6 }) }, g);
    }
  }

  function objet(g, v, m) {
    if (v === 'parapluie') {
      // Fermé, tenu à côté du corps, pointe au sol : la toile bien visible.
      const x = m.x + 5;
      el('line', { x1: x, y1: m.y - 4, x2: x, y2: 137, ...trait({ 'stroke-width': 2 }) }, g);
      el('path', { d: `M${x} ${m.y - 4} q0 -7 -6 -6`, fill: 'none', ...trait({ 'stroke-width': 2.4 }) }, g);
      el('path', { d: `M${x} ${m.y + 2} L${x + 6.5} ${m.y + 26} L${x} ${m.y + 32} L${x - 6.5} ${m.y + 26} Z`, fill: '#3f4f78', ...trait({ 'stroke-width': 1.8 }) }, g);
      el('line', { x1: x, y1: m.y + 4, x2: x, y2: m.y + 30, stroke: '#8fa3cf', 'stroke-width': 1.2 }, g);
    } else if (v === 'valise') {
      el('rect', { x: m.x - 9, y: m.y + 5, width: 20, height: 15, fill: '#8a5a2b', ...trait() }, g);
      el('path', { d: `M${m.x - 3} ${m.y + 5} v-3 h8 v3`, fill: 'none', ...trait({ 'stroke-width': 1.8 }) }, g);
      el('line', { x1: m.x - 9, y1: m.y + 11, x2: m.x + 11, y2: m.y + 11, ...trait({ 'stroke-width': 1.2 }) }, g);
    } else if (v === 'journal') {
      el('rect', { x: m.x - 3, y: m.y - 16, width: 12, height: 18, fill: '#ece5d2', ...trait({ 'stroke-width': 1.6 }), transform: `rotate(12 ${m.x} ${m.y})` }, g);
      for (const d of [-12, -8, -4]) el('line', { x1: m.x - 1, y1: m.y + d, x2: m.x + 7, y2: m.y + d, stroke: '#6a6250', 'stroke-width': 1.2, transform: `rotate(12 ${m.x} ${m.y})` }, g);
    } else if (v === 'canne') {
      el('line', { x1: m.x + 1, y1: m.y - 4, x2: m.x + 4, y2: 136, stroke: '#5a3a1e', 'stroke-width': 3, 'stroke-linecap': 'round' }, g);
      el('path', { d: `M${m.x + 1} ${m.y - 4} q-1 -7 -7 -6`, fill: 'none', stroke: '#5a3a1e', 'stroke-width': 3, 'stroke-linecap': 'round' }, g);
    }
  }

  root.TemoinSuspects = { dessiner, decrire, nomAttr, court, long, ORDRE, LIBELLES, MANTEAUX };
})(typeof window !== 'undefined' ? window : globalThis);
