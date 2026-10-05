// La roquette : le dessin (SVG maison), la visée, et ses états. Aucune règle de
// jeu ici — elle ne sait ni qui joue, ni quand elle explosera : app.js lui dit
// qui viser, et le serveur dit quand elle a explosé.
//
// Le dessin est une création originale, dans l'esprit de la roquette du
// Soldier de TF2 (aucun asset, aucune coordonnée reprise) : silhouette trapue,
// ogive massive et facettée plus large que le corps, corps d'acier brossé,
// deux colliers brun-gris, gros contour noir, grande flamme en trois couches.
// Pas d'ailettes (V1). Elle est dessinée À L'HORIZONTALE, nez vers la droite,
// autour de son pivot (0, 0) : viser = tourner ce repère.
//
// Les états :
//   idle        légère animation (flamme qui vacille, petit balancement) ;
//   visée       rotation par le chemin le plus court vers l'avatar visé ;
//   danger 0-3  fumée, chaleur, flamme plus forte, vibration — piloté par le
//               temps ÉCOULÉ depuis le début du tour (public), jamais par le
//               temps restant, que personne ne connaît ici ;
//   validation  recul, éclat, réarmement ;
//   explosion   verrouillage → préparation → départ vers l'avatar → impact →
//               retour au centre. L'animation ne décide de rien : la vie est
//               déjà perdue quand elle commence (message `boom` du serveur).
// Mouvement réduit : aucune rotation animée, aucune vibration, aucune
// trajectoire, aucun flash — le sens reste porté par le texte (app.js).
//
// LES SKINS (cosmétiques) : un dessin par arme, dans la MÊME enveloppe — même
// viewBox, même pivot (0, 0), nez à +60, et rien plus loin du pivot que
// l'arrière de la roquette au plus fort du danger (EMPRISE). La taille posée
// par fit() ne dépend donc jamais de l'arme. Les crochets du danger sont
// communs (.r-flamme, .r-fumee, .r-chaleur, data-danger) : chaque arme les
// fournit, le CSS de la page les pilote. Le skin affiché est celui du joueur
// VISÉ (app.js) ; un id inconnu ou absent donne la roquette.
(function () {
  'use strict';

  // Contour noir épais : chaque pièce est d'abord tracée en noir, plus large
  // (couche .r-ink), puis remplie par-dessus — le contour extérieur reste, les
  // jointures se recouvrent, et les traits intérieurs sont posés à la fin.
  // Les id de dégradés sont préfixés (`{p}`) : un aperçu du salon et l'arme de
  // l'arène coexistent dans la page sans se prendre leurs dégradés.
  var TETE = 'M-6,-22 L30,-22 L50,-14 L60,-8 L60,8 L50,14 L30,22 L-6,22 Z';
  var FLAMME = 'M0,-12 C-9,-21 -27,-19 -28,-9 L-41,-12 L-36,-3.5 L-68,2 L-36,6 L-42,13.5 L-25,10.5 C-17,19 -3,17 0,12 Z';
  var FLAMME_MI = 'M0,-8 C-6,-14 -18,-13 -19,-6 L-28,-7 L-25,-2 L-46,2 L-25,4.5 L-29,9 L-17,7 C-11,13 -2,11.5 0,8 Z';
  var FLAMME_CO = 'M0,-4.5 C-4,-7 -10,-6.5 -11,-3 L-22,1 L-11,3 C-9,6.5 -3,6.5 0,4.5 Z';
  var FLAMME_K = 0.8;

  // L'EMPRISE : jusqu'où la roquette s'étend DERRIÈRE son pivot, flamme au
  // plus fort (danger 3 : --f = 1.12 dans index.html) et contour noir (3,5)
  // compris, en unités du dessin : tuyère à -56, flamme de 68 de long.
  // C'est la flamme qui touchait les avatars et la bannière : la visée la
  // tourne à l'opposé de la cible, donc vers n'importe quel autre joueur.
  var EMPRISE = (56 + 68 * FLAMME_K * 1.12 + 3.5) / 250;
  var TAILLE_MAX = 0.9;          // en fraction du disque (--rk) : jamais plus
  var TAILLE_MIN = 0.6;          // ni moins — en dessous, elle cesse de se lire
  var MARGE = 6;                 // px, pour le balancement et la vibration

  var ROQUETTE = ''
    + '<svg class="r-svg" viewBox="-128 -46 250 92" aria-hidden="true" focusable="false">'
    + '<defs>'
    + '<linearGradient id="{p}-acier" x1="0" y1="-1" x2="0" y2="1" gradientUnits="objectBoundingBox" gradientTransform="translate(0 .5) scale(1 .5)">'
    + '<stop offset="0" stop-color="#5e5e5e"/><stop offset=".2" stop-color="#a9a9a9"/><stop offset=".42" stop-color="#cfcfcf"/>'
    + '<stop offset=".6" stop-color="#bcbcbc"/><stop offset=".8" stop-color="#8f8f8f"/><stop offset="1" stop-color="#555"/></linearGradient>'
    // L'ogive : des BANDES nettes de gris le long de l'axe (pas un dégradé
    // doux), plus sombre vers le nez — c'est ce qui lui donne son air de pièce
    // usinée, facettée.
    + '<linearGradient id="{p}-ogive" x1="-6" y1="0" x2="60" y2="0" gradientUnits="userSpaceOnUse">'
    + '<stop offset="0" stop-color="#6a6a6a"/><stop offset=".3" stop-color="#6a6a6a"/>'
    + '<stop offset=".3" stop-color="#625f61"/><stop offset=".58" stop-color="#625f61"/>'
    + '<stop offset=".58" stop-color="#737373"/><stop offset=".8" stop-color="#737373"/>'
    + '<stop offset=".8" stop-color="#4b4b4b"/><stop offset="1" stop-color="#4b4b4b"/></linearGradient>'
    + '<linearGradient id="{p}-ombre" x1="0" y1="-22" x2="0" y2="22" gradientUnits="userSpaceOnUse">'
    + '<stop offset="0" stop-color="#fff" stop-opacity=".10"/><stop offset=".5" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".38"/></linearGradient>'
    + '<linearGradient id="{p}-collier" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0" stop-color="#6e655f"/><stop offset=".45" stop-color="#5a524d"/><stop offset="1" stop-color="#3e3834"/></linearGradient>'
    + '<radialGradient id="{p}-chaleur"><stop offset="0" stop-color="#ff5a1f" stop-opacity=".75"/><stop offset="1" stop-color="#ff5a1f" stop-opacity="0"/></radialGradient>'
    + '<filter id="{p}-flou" x="-50%" y="-200%" width="200%" height="500%"><feGaussianBlur stdDeviation="1.6"/></filter>'
    + '</defs>'
    // fumée (danger) et chaleur, derrière tout. La fumée reste DANS la portée
    // de la flamme (voir EMPRISE) : elle ne doit rien allonger.
    + '<g class="r-fumee">'
    + '<circle cx="-78" cy="-8" r="9"/><circle cx="-92" cy="5" r="11"/><circle cx="-105" cy="-4" r="9"/>'
    + '</g>'
    + '<ellipse class="r-chaleur" cx="6" cy="0" rx="80" ry="40" fill="url(#{p}-chaleur)"/>'
    // flamme : contour, puis trois couches — à 80 % de son dessin d'origine
    // (FLAMME_K), même forme, pour raccourcir l'arrière sans toucher au corps.
    + '<g transform="translate(-56 0) scale(' + FLAMME_K + ')"><g class="r-flamme">'
    + '<path class="r-ink" d="' + FLAMME + '"/>'
    + '<path d="' + FLAMME + '" fill="#fd8a0a"/>'
    + '<path d="' + FLAMME_MI + '" fill="#ffd28f"/>'
    + '<path d="' + FLAMME_CO + '" fill="#ffff3a"/>'
    + '</g></g>'
    // le contour noir de toute la roquette
    + '<g class="r-ink">'
    + '<rect x="-57" y="-12" width="8" height="24"/>'
    + '<rect x="-51" y="-17" width="11" height="34"/>'
    + '<rect x="-41" y="-15.5" width="27" height="31"/>'
    + '<rect x="-15" y="-18" width="10" height="36"/>'
    + '<path d="' + TETE + '"/>'
    + '</g>'
    // les pièces : tuyère, collier arrière, corps, collier avant, ogive
    + '<rect x="-57" y="-12" width="8" height="24" fill="#2f2a27"/>'
    + '<rect x="-51" y="-17" width="11" height="34" fill="url(#{p}-collier)"/>'
    + '<rect x="-41" y="-15.5" width="27" height="31" fill="url(#{p}-acier)"/>'
    + '<rect x="-39" y="-10" width="23" height="3.5" fill="#f4f4f4" opacity=".55" filter="url(#{p}-flou)"/>'
    + '<rect x="-15" y="-18" width="10" height="36" fill="url(#{p}-collier)"/>'
    + '<path d="' + TETE + '" fill="url(#{p}-ogive)"/>'
    + '<path d="' + TETE + '" fill="url(#{p}-ombre)"/>'
    + '<path d="M-2,-16 L29,-16 L45,-10" fill="none" stroke="#efefef" stroke-width="3.6" stroke-linecap="round" opacity=".55" filter="url(#{p}-flou)"/>'
    // traits intérieurs : sections lisibles (colliers, et la bague de l'ogive)
    + '<g class="r-traits">'
    + '<path d="M-51,-17 V17 M-40,-15.5 V15.5 M-15,-15.5 V15.5 M-5,-18 V18"/>'
    + '<path d="M38,-19 V19" stroke-width="2.8"/>'
    + '<path d="M-46,-17 V17" stroke-width="1.2" opacity=".45"/>'
    + '</g>'
    + '</svg>';

  // Une étoile à n branches (rayons R et r), centrée sur (0, 0).
  function etoile(n, R, r) {
    var d = '';
    for (var i = 0; i < 2 * n; i++) {
      var a = Math.PI * i / n - Math.PI / 2, k = i % 2 ? r : R;
      d += (i ? 'L' : 'M') + (Math.cos(a) * k).toFixed(1) + ',' + (Math.sin(a) * k).toFixed(1);
    }
    return d + 'Z';
  }

  // « La Pétoire de Secours » : une cartouche de détresse, création maison dans
  // l'esprit du pistolet de détresse du Pyro (aucun asset repris) — tube fin de
  // carton rouge, culot de laiton, magnésium qui brûle À L'AVANT (blanc, rose),
  // et un pochoir maison. Ses crochets : la flamme est la lueur du nez
  // (.r-flamme, gonflée par le danger autour de son centre), la fumée rose monte
  // du nez, les étincelles (.p-etinc) ne s'allument qu'aux crans 2 et 3, la
  // traînée (.p-trainee) n'existe qu'en vol. Dessinée petite puis agrandie de
  // 25 % (un tube fin se lit mal à 140 px) et reculée pour que son nez reste à
  // +60 (NEZ) ; le contour est compensé dans le CSS (même trait que la
  // roquette). Au plus fort, rien ne dépasse ~100 unités du pivot : en deçà
  // d'EMPRISE (la flamme arrière de la roquette).
  var SERTI = 'M42,-11 L50,-7 L50,7 L42,11 Z';
  var MAGNESIUM = 'M49,-7 L56,-7 Q61,-7 61,0 Q61,7 56,7 L49,7 Z';
  var LUEUR = etoile(9, 17, 8), LUEUR_MI = etoile(9, 11, 5.5);
  var PETOIRE = ''
    + '<svg class="r-svg" viewBox="-128 -46 250 92" aria-hidden="true" focusable="false">'
    + '<defs>'
    + '<linearGradient id="{p}-carton" x1="0" y1="-11" x2="0" y2="11" gradientUnits="userSpaceOnUse">'
    + '<stop offset="0" stop-color="#6e1212"/><stop offset=".18" stop-color="#c22a22"/><stop offset=".4" stop-color="#ff5b45"/>'
    + '<stop offset=".58" stop-color="#e0352b"/><stop offset=".85" stop-color="#a11c18"/><stop offset="1" stop-color="#5e0f0f"/></linearGradient>'
    + '<linearGradient id="{p}-laiton" x1="0" y1="-14" x2="0" y2="14" gradientUnits="userSpaceOnUse">'
    + '<stop offset="0" stop-color="#5a4114"/><stop offset=".2" stop-color="#b48c2e"/><stop offset=".42" stop-color="#f4d98c"/>'
    + '<stop offset=".62" stop-color="#c49b45"/><stop offset=".85" stop-color="#86661f"/><stop offset="1" stop-color="#4c3711"/></linearGradient>'
    + '<linearGradient id="{p}-serti" x1="0" y1="-11" x2="0" y2="11" gradientUnits="userSpaceOnUse">'
    + '<stop offset="0" stop-color="#4f0c0c"/><stop offset=".5" stop-color="#9c1b17"/><stop offset="1" stop-color="#430a0a"/></linearGradient>'
    + '<radialGradient id="{p}-chaleur"><stop offset="0" stop-color="#ff7ab5" stop-opacity=".8"/><stop offset="1" stop-color="#ff4f9a" stop-opacity="0"/></radialGradient>'
    + '<linearGradient id="{p}-trainee" x1="-210" y1="0" x2="-52" y2="0" gradientUnits="userSpaceOnUse">'
    + '<stop offset="0" stop-color="#f7bfd3" stop-opacity="0"/><stop offset="1" stop-color="#f7bfd3" stop-opacity=".9"/></linearGradient>'
    + '<filter id="{p}-flou" x="-50%" y="-200%" width="200%" height="500%"><feGaussianBlur stdDeviation="1.6"/></filter>'
    + '</defs>'
    + '<g transform="translate(-14 0) scale(1.25)">'
    // la traînée de fumée rose : en vol seulement (.is-flying), derrière tout
    + '<g class="p-trainee">'
    + '<path d="M-52,-8 C-90,-15 -122,2 -152,-6 C-174,-12 -192,-3 -210,-5 L-210,6 C-188,10 -168,1 -146,10 C-116,17 -86,4 -52,9 Z" fill="url(#{p}-trainee)"/>'
    + '<circle cx="-96" cy="1" r="9" fill="#f7bfd3" opacity=".55"/><circle cx="-136" cy="4" r="11" fill="#f7bfd3" opacity=".4"/>'
    + '<circle cx="-176" cy="-1" r="9" fill="#f7bfd3" opacity=".25"/>'
    + '</g>'
    // fumée (danger) : elle monte du nez ; chaleur : la lueur rose autour du nez
    + '<g class="r-fumee"><circle cx="36" cy="-24" r="6"/><circle cx="22" cy="-31" r="7"/><circle cx="6" cy="-27" r="6"/></g>'
    + '<ellipse class="r-chaleur" cx="48" cy="0" rx="36" ry="26" fill="url(#{p}-chaleur)"/>'
    // le contour noir de toute la cartouche
    + '<g class="r-ink">'
    + '<rect x="-53" y="-14" width="10" height="28"/><rect x="-44" y="-11.5" width="15" height="23"/>'
    + '<rect x="-30" y="-11" width="73" height="22"/><path d="' + SERTI + '"/><path d="' + MAGNESIUM + '"/>'
    + '</g>'
    // culot (bourrelet, corps), tube, reflet, étiquette, sertissage, magnésium
    + '<rect x="-53" y="-14" width="10" height="28" fill="url(#{p}-laiton)"/>'
    + '<rect x="-44" y="-11.5" width="15" height="23" fill="url(#{p}-laiton)"/>'
    + '<rect x="-30" y="-11" width="73" height="22" fill="url(#{p}-carton)"/>'
    + '<rect x="-28" y="-8.5" width="69" height="2.6" fill="#fff" opacity=".45" filter="url(#{p}-flou)"/>'
    + '<rect x="-21" y="-6.5" width="54" height="13" fill="#efe0bf"/>'
    + '<path d="M-21,-6.5 H33 M-21,6.5 H33" stroke="#2a1a10" stroke-width="1"/>'
    + '<text x="6" y="3" text-anchor="middle" font-family="\'TF2 Build\', \'Arial Narrow\', sans-serif" font-size="7.5" fill="#2a1a10"'
    + ' textLength="48" lengthAdjust="spacingAndGlyphs">PAS UN JOUET</text>'
    + '<path d="' + SERTI + '" fill="url(#{p}-serti)"/>'
    + '<path d="' + MAGNESIUM + '" fill="#ffe8f1"/>'
    // traits intérieurs : culot, sertissage, et la gorge du bourrelet
    + '<g class="r-traits">'
    + '<path d="M-44,-11.5 V11.5 M-30,-11 V11 M42,-11 V11 M50,-7 V7"/>'
    + '<path d="M44,-8 L48,-5.5 M44,8 L48,5.5 M44.5,0 H48.5" opacity=".6"/>'
    + '<path d="M-48,-14 V14" opacity=".45"/>'
    + '</g>'
    // le feu À L'AVANT : la lueur du magnésium (contour, rose, rose pâle, cœur blanc)
    + '<g transform="translate(62 0)"><g class="r-flamme">'
    + '<path class="r-ink" d="' + LUEUR + '"/>'
    + '<path d="' + LUEUR + '" fill="#ff4f9a"/>'
    + '<path d="' + LUEUR_MI + '" fill="#ffc6de"/>'
    + '<circle r="4.5" fill="#fff"/>'
    + '</g></g>'
    // les étincelles (danger 2 et 3)
    + '<g class="p-etinc" fill="#fff4b0"><circle cx="82" cy="-14" r="1.8"/><circle cx="88" cy="5" r="1.5"/>'
    + '<circle cx="76" cy="16" r="1.6"/><circle cx="91" cy="-4" r="1.3"/><circle cx="70" cy="-19" r="1.4"/></g>'
    + '</g>'
    + '</svg>';

  // La table des armes. `depart` / `impact` : leurs sons propres (sound.js) —
  // tic, validation et explosion restent communs. `feu` : l'impact met le feu
  // à la carte touchée avant l'étoile commune (app.js).
  var SKINS = {
    roquette: { nom: 'La Roquette', court: 'Roquette', dessin: ROQUETTE, depart: 'whoosh', impact: 'impact', feu: false },
    petoire: { nom: 'La Pétoire de Secours', court: 'Pétoire', dessin: PETOIRE, depart: 'fusee', impact: 'crepitement', feu: true },
  };
  var DEFAUT = 'roquette';
  // Le seul filtre côté page : un id inconnu, absent ou mal formé → la roquette.
  var skinId = function (v) { return typeof v === 'string' && Object.prototype.hasOwnProperty.call(SKINS, v) ? v : DEFAUT; };
  var dessin = function (id, prefixe) { return SKINS[skinId(id)].dessin.replace(/\{p\}/g, prefixe); };
  var info = function (id) {
    var k = skinId(id), s = SKINS[k];
    return { id: k, nom: s.nom, court: s.court, depart: s.depart, impact: s.impact, feu: s.feu };
  };

  var reduit = function () {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  };
  // Le pivot (x = 0 du dessin) est à 128/250 de la largeur : le nez n'est pas au
  // milieu. Toute visée se calcule depuis CE point, sur la boîte non tournée.
  var PIVOT = 128 / 250;
  var NEZ = 60 / 250;            // distance pivot → nez, en largeur de roquette
  var pivot = function (host) {
    var r = host.getBoundingClientRect();
    return { x: r.left + r.width * PIVOT, y: r.top + r.height / 2 };
  };
  var centre = function (el) {
    var r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  // L'écart d'angle ramené dans ]-180, 180] : le chemin le plus court.
  var ecart = function (de, vers) {
    var d = ((vers - de) % 360 + 540) % 360 - 180;
    return d === -180 ? 180 : d;
  };

  function create(host) {
    host.classList.add('rocket');
    host.innerHTML = '<div class="r-aim"><div class="r-fly"><div class="r-bob">' + dessin(DEFAUT, 'r') + '</div></div></div>';   // gabarit fixe, aucune donnée réseau
    var aim = host.querySelector('.r-aim');
    var fly = host.querySelector('.r-fly');
    var bob = host.querySelector('.r-bob');
    var skin = DEFAUT;
    host.dataset.skin = skin;
    var angle = 0;          // angle CUMULÉ (pas modulo 360 : sinon un 350° → 10° ferait le tour)
    var cible = null;
    var gen = 0;            // une explosion en cours est annulée par un nouveau tour

    function poser(a, instant) {
      aim.classList.toggle('is-instant', !!instant || reduit());
      aim.style.transform = 'rotate(' + a.toFixed(2) + 'deg)';
    }

    // Vise le CENTRE de l'élément (l'avatar de la cible).
    function aimAt(el, opts) {
      cible = el || null;
      if (!el) return angle;
      var p = pivot(host), q = centre(el);
      var voulu = Math.atan2(q.y - p.y, q.x - p.x) * 180 / Math.PI;
      angle = angle + ecart(angle, voulu);
      poser(angle, opts && opts.instant);
      return angle;
    }
    // La taille : la plus grande (jusqu'à TAILLE_MAX du disque) dont l'arrière
    // ne touche AUCUN des obstacles donnés (avatars, bannière), quelle que
    // soit la visée — un cercle autour du pivot, de rayon EMPRISE × largeur.
    // Le disque, lui, ne change pas : prompt et cartes restent où ils sont.
    function fit(obstacles) {
      var d = host.parentNode.getBoundingClientRect();
      if (!d.width) return;
      var px = d.left + d.width / 2, py = d.top + d.height / 2;
      var place = Infinity;
      (obstacles || []).forEach(function (el) {
        if (!el) return;
        var r = el.getBoundingClientRect();
        if (!r.width && !r.height) return;
        var dx = Math.max(r.left - px, 0, px - r.right), dy = Math.max(r.top - py, 0, py - r.bottom);
        place = Math.min(place, Math.hypot(dx, dy));
      });
      var w = Math.min(d.width * TAILLE_MAX, (place - MARGE) / EMPRISE);
      host.style.width = Math.round(Math.max(d.width * TAILLE_MIN, w)) + 'px';
    }
    // Après un redimensionnement : même cible, nouvel angle, sans animation.
    function refit() { if (cible) aimAt(cible, { instant: true }); }

    function setDanger(n) { host.dataset.danger = String(Math.max(0, Math.min(3, n | 0))); }

    // L'arme montrée (celle du joueur visé). Seul le DESSIN change : visée,
    // taille, danger et animation en cours restent ceux du moment.
    function setSkin(id) {
      id = skinId(id);
      if (id === skin) return;
      skin = id;
      bob.innerHTML = dessin(id, 'r');      // gabarit fixe, aucune donnée réseau (l'id est filtré)
      host.dataset.skin = id;
    }

    function annuler() {
      gen++;
      fly.getAnimations().forEach(function (a) { a.cancel(); });
      host.classList.remove('is-locked', 'is-gone', 'is-flying');
      fly.style.transform = '';
    }

    // Mot validé : recul le long de l'axe et retour (réarmement).
    function validate() {
      if (reduit()) return;
      fly.animate([
        { transform: 'translateX(0)' },
        { transform: 'translateX(-9%)', offset: .35 },
        { transform: 'translateX(2%)', offset: .75 },
        { transform: 'translateX(0)' },
      ], { duration: 320, easing: 'ease-out' });
    }

    // L'explosion sur `el`. Rend une promesse résolue à l'IMPACT (pour l'effet
    // sur la carte), puis la roquette revient au centre d'elle-même.
    function boom(el, onImpact) {
      annuler();
      var g = gen;
      cible = el;
      host.dataset.danger = '0';
      if (reduit() || !el) {
        if (el) aimAt(el, { instant: true });
        if (onImpact) onImpact();
        return Promise.resolve();
      }
      aimAt(el, { instant: false });
      host.classList.add('is-locked');                                    // 1. verrouillage
      var p = pivot(host), q = centre(el);
      var portee = Math.hypot(q.x - p.x, q.y - p.y);
      var largeur = host.getBoundingClientRect().width || 1;      // boîte NON tournée
      // La roquette est dans un repère tourné : un translateX la porte le long
      // de son axe, droit sur la cible. On amène le NEZ sur l'avatar (un peu
      // dedans). Le pourcentage est relatif à sa propre largeur.
      var pct = Math.max(0, (portee - largeur * NEZ + largeur * .04) / largeur * 100);
      var prep = fly.animate([                                             // 2. préparation
        { transform: 'translateX(0)' }, { transform: 'translateX(-7%)' },
      ], { duration: 260, delay: 160, easing: 'ease-out', fill: 'forwards' });
      return prep.finished.then(function () {
        if (g !== gen) return;
        host.dispatchEvent(new CustomEvent('rocket:whoosh'));
        host.classList.add('is-flying');                                   // la traînée d'une arme qui en a une
        var vol = fly.animate([                                            // 3-4. départ, avec accélération
          { transform: 'translateX(-7%)' }, { transform: 'translateX(' + pct.toFixed(1) + '%)' },
        ], { duration: 340, easing: 'cubic-bezier(.55, 0, .9, .35)', fill: 'forwards' });
        prep.cancel();
        return vol.finished.then(function () {
          if (g !== gen) return;
          host.classList.add('is-gone');                                   // 5. impact
          host.classList.remove('is-locked', 'is-flying');
          if (onImpact) onImpact();
          vol.cancel();
          fly.style.transform = 'translateX(0)';
          return new Promise(function (res) { setTimeout(res, 420); });
        }).then(function () {
          if (g !== gen) return;
          host.classList.remove('is-gone');                                // 8. retour au centre
          fly.animate([{ transform: 'scale(.4)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }],
            { duration: 260, easing: 'ease-out' });
        });
      }).catch(function () { /* animation annulée par un nouveau tour */ });
    }

    host.dataset.danger = '0';
    return {
      aimAt: aimAt, fit: fit, refit: refit, setDanger: setDanger, setSkin: setSkin, validate: validate, boom: boom, annuler: annuler,
      get angle() { return angle; },
      get cible() { return cible; },
      get skin() { return skin; },
    };
  }

  window.Rocket = {
    create: create, ecart: ecart, PIVOT: PIVOT, NEZ: NEZ, EMPRISE: EMPRISE,
    SKINS: Object.keys(SKINS), DEFAUT: DEFAUT, skinId: skinId, dessin: dessin, info: info,
  };
})();
