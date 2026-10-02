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
(function () {
  'use strict';

  // Contour noir épais : chaque pièce est d'abord tracée en noir, plus large
  // (couche .r-ink), puis remplie par-dessus — le contour extérieur reste, les
  // jointures se recouvrent, et les traits intérieurs sont posés à la fin.
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

  var SVG = ''
    + '<svg class="r-svg" viewBox="-128 -46 250 92" aria-hidden="true" focusable="false">'
    + '<defs>'
    + '<linearGradient id="r-acier" x1="0" y1="-1" x2="0" y2="1" gradientUnits="objectBoundingBox" gradientTransform="translate(0 .5) scale(1 .5)">'
    + '<stop offset="0" stop-color="#5e5e5e"/><stop offset=".2" stop-color="#a9a9a9"/><stop offset=".42" stop-color="#cfcfcf"/>'
    + '<stop offset=".6" stop-color="#bcbcbc"/><stop offset=".8" stop-color="#8f8f8f"/><stop offset="1" stop-color="#555"/></linearGradient>'
    // L'ogive : des BANDES nettes de gris le long de l'axe (pas un dégradé
    // doux), plus sombre vers le nez — c'est ce qui lui donne son air de pièce
    // usinée, facettée.
    + '<linearGradient id="r-ogive" x1="-6" y1="0" x2="60" y2="0" gradientUnits="userSpaceOnUse">'
    + '<stop offset="0" stop-color="#6a6a6a"/><stop offset=".3" stop-color="#6a6a6a"/>'
    + '<stop offset=".3" stop-color="#625f61"/><stop offset=".58" stop-color="#625f61"/>'
    + '<stop offset=".58" stop-color="#737373"/><stop offset=".8" stop-color="#737373"/>'
    + '<stop offset=".8" stop-color="#4b4b4b"/><stop offset="1" stop-color="#4b4b4b"/></linearGradient>'
    + '<linearGradient id="r-ombre" x1="0" y1="-22" x2="0" y2="22" gradientUnits="userSpaceOnUse">'
    + '<stop offset="0" stop-color="#fff" stop-opacity=".10"/><stop offset=".5" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".38"/></linearGradient>'
    + '<linearGradient id="r-collier" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0" stop-color="#6e655f"/><stop offset=".45" stop-color="#5a524d"/><stop offset="1" stop-color="#3e3834"/></linearGradient>'
    + '<radialGradient id="r-chaleur"><stop offset="0" stop-color="#ff5a1f" stop-opacity=".75"/><stop offset="1" stop-color="#ff5a1f" stop-opacity="0"/></radialGradient>'
    + '<filter id="r-flou" x="-50%" y="-200%" width="200%" height="500%"><feGaussianBlur stdDeviation="1.6"/></filter>'
    + '</defs>'
    // fumée (danger) et chaleur, derrière tout. La fumée reste DANS la portée
    // de la flamme (voir EMPRISE) : elle ne doit rien allonger.
    + '<g class="r-fumee">'
    + '<circle cx="-78" cy="-8" r="9"/><circle cx="-92" cy="5" r="11"/><circle cx="-105" cy="-4" r="9"/>'
    + '</g>'
    + '<ellipse class="r-chaleur" cx="6" cy="0" rx="80" ry="40" fill="url(#r-chaleur)"/>'
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
    + '<rect x="-51" y="-17" width="11" height="34" fill="url(#r-collier)"/>'
    + '<rect x="-41" y="-15.5" width="27" height="31" fill="url(#r-acier)"/>'
    + '<rect x="-39" y="-10" width="23" height="3.5" fill="#f4f4f4" opacity=".55" filter="url(#r-flou)"/>'
    + '<rect x="-15" y="-18" width="10" height="36" fill="url(#r-collier)"/>'
    + '<path d="' + TETE + '" fill="url(#r-ogive)"/>'
    + '<path d="' + TETE + '" fill="url(#r-ombre)"/>'
    + '<path d="M-2,-16 L29,-16 L45,-10" fill="none" stroke="#efefef" stroke-width="3.6" stroke-linecap="round" opacity=".55" filter="url(#r-flou)"/>'
    // traits intérieurs : sections lisibles (colliers, et la bague de l'ogive)
    + '<g class="r-traits">'
    + '<path d="M-51,-17 V17 M-40,-15.5 V15.5 M-15,-15.5 V15.5 M-5,-18 V18"/>'
    + '<path d="M38,-19 V19" stroke-width="2.8"/>'
    + '<path d="M-46,-17 V17" stroke-width="1.2" opacity=".45"/>'
    + '</g>'
    + '</svg>';

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
    host.innerHTML = '<div class="r-aim"><div class="r-fly"><div class="r-bob">' + SVG + '</div></div></div>';   // gabarit fixe, aucune donnée réseau
    var aim = host.querySelector('.r-aim');
    var fly = host.querySelector('.r-fly');
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

    function annuler() {
      gen++;
      fly.getAnimations().forEach(function (a) { a.cancel(); });
      host.classList.remove('is-locked', 'is-gone');
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
        var vol = fly.animate([                                            // 3-4. départ, avec accélération
          { transform: 'translateX(-7%)' }, { transform: 'translateX(' + pct.toFixed(1) + '%)' },
        ], { duration: 340, easing: 'cubic-bezier(.55, 0, .9, .35)', fill: 'forwards' });
        prep.cancel();
        return vol.finished.then(function () {
          if (g !== gen) return;
          host.classList.add('is-gone');                                   // 5. impact
          host.classList.remove('is-locked');
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
      aimAt: aimAt, fit: fit, refit: refit, setDanger: setDanger, validate: validate, boom: boom, annuler: annuler,
      get angle() { return angle; },
      get cible() { return cible; },
    };
  }

  window.Rocket = { create: create, ecart: ecart, PIVOT: PIVOT, NEZ: NEZ, EMPRISE: EMPRISE };
})();
