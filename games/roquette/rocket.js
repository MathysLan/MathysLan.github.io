// La roquette : le dessin (SVG maison), la visée, et ses états. Aucune règle de
// jeu ici — elle ne sait ni qui joue, ni quand elle explosera : app.js lui dit
// qui viser, et le serveur dit quand elle a explosé.
//
// La roquette (l'arme par défaut, antérieure à la règle des skins ci-dessous) :
// dessin maison d'après la roquette du Soldier (aucun asset) : silhouette trapue,
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
// LES SKINS (cosmétiques). Règle de DA : FIDÉLITÉ TF2 > ORIGINALITÉ > BLAGUE.
// Chaque skin adapte UNE arme de TF2 précise, qu'un joueur doit reconnaître à
// la silhouette et à ses éléments caractéristiques ; un dossier de référence
// (marqueurs, silhouette en noir uni, projectile) est validé AVANT de coder ;
// le dessin reste fait maison en SVG, sans aucun asset de Valve (ni modèle, ni
// texture, ni sprite, ni icône) ; le nom affiché reste celui de Roquette Party.
// Un dessin par arme, dans la MÊME enveloppe — même
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

  // « La Pétoire de Secours » : l'adaptation du SCORCH SHOT de TF2 (référence
  // unique, dossier validé : marqueurs, proportions et couleurs relevés sur les
  // rendus du wiki et en vidéo). Dessin maison : aucun asset, aucune géométrie
  // de modèle reprise, des aplats et le contour du jeu. Deux calques distincts :
  //   - l'ARME (svg .p-arme), de profil, bouche à +60, axe du canon sur le
  //     pivot. Canon de 26 u, ~3 diamètres, gris, droit ; son dernier tiers peint
  //     en orange au bord déchiqueté (.p-peinture) ; poignée avant noire côtelée
  //     sous le canon (.p-poignee-avant, 6 .p-cote) tenue par une goupille à
  //     l'avant (.p-goupille) ; carcasse gris foncé à rivets ; chien fin
  //     (.p-chien) ; pontet rond (.p-pontet) ; petite crosse en palette inclinée,
  //     à plaquette noire (.p-crosse). Longueur / hauteur ≈ 1,85.
  //     Au tir : éclair (.p-eclair, .is-firing), gerbe d'étincelles (.p-gerbe),
  //     bouffée de fumée rouge (.p-bouffee), recul qui relève le canon. Danger :
  //     lueur et fumée à la bouche, étincelles aux crans 2 et 3 — la fusée, elle,
  //     reste cachée ;
  //   - le PROJECTILE (.r-proj > svg .p-fusee) : la fusée, INVISIBLE tant
  //     qu'elle est chargée (CSS : visible seulement pendant .is-flying). En vol :
  //     corps anthracite (.p-corps, 17 u = 0,65 × le canon) DERRIÈRE une tête
  //     ronde incandescente (.p-tete : halo rouge, anneau, cœur blanc-orangé,
  //     ≈ 1,7 × le corps), suivie de bouffées de fumée rouge (.p-fumee-vol).
  //     Pas de flamme en langue, pas de traînée rose.
  // Le projectile est SOUS l'arme (ordre du DOM) : au départ, le canon cache le
  // corps, la tête sort par la bouche. Au plus fort, rien ne dépasse ~101 u du
  // pivot (le coin de la crosse) : en deçà d'EMPRISE.
  var CANON = 'M-19,-13 H60 V13 H-19 Z';
  var CARCASSE = 'M-55,-11 Q-55,-15 -50,-15 L-19,-15 L-19,16 L-48,17 Q-55,10 -55,0 Z';
  var CHIEN = 'M-54,-9 C-58,-12 -63,-10 -62,-5 L-56,-2 Z';
  var PONTET = 'M-45,15 C-47,47 -15,48 -16,15 Z M-40,18 C-41,39 -21,40 -21,18 Z';
  var CROSSE = 'M-47,16 C-50,30 -56,45 -58,55 Q-59,60 -65,60 L-78,60 Q-83,60 -83,55 C-81,45 -70,30 -62,17 Z';
  var PLAQUETTE = 'M-50,23 C-52,33 -56,44 -58,51 Q-59,55 -64,55 L-75,55 Q-79,55 -78,51 C-76,42 -68,32 -62,23 Z';
  // Le bord de la peinture : des dents maison, irrégulières (pas un relevé du modèle).
  var PEINTURE = 'M38,-13 H60 V13 H38 L36.5,9.5 L39.5,6 L36,2.5 L38.8,-1 L35.6,-4.5 L38.4,-8 L36.2,-10.5 Z';
  var COTES = [9.5, 17, 24.5, 32, 39.5, 47].map(function (x) {
    return '<rect class="p-cote" x="' + x + '" y="11" width="6" height="22" rx="2.5" fill="url(#{p}-sc-cotes)" stroke="#000" stroke-width="2.5"/>'
      + '<rect x="' + (x + 1.4) + '" y="13.5" width="1.4" height="17" fill="#5a5757" opacity=".8"/>';
  }).join('');
  var ECLAIR = etoile(7, 15, 6), ECLAIR_MI = etoile(7, 8, 3.5);
  var ARME = ''
    + '<svg class="r-svg p-arme" viewBox="-128 -46 250 92" aria-hidden="true" focusable="false">'
    + '<defs>'
    + '<linearGradient id="{p}-sc-canon" x1="0" y1="-13" x2="0" y2="13" gradientUnits="userSpaceOnUse">'
    + '<stop offset="0" stop-color="#5d5957"/><stop offset=".18" stop-color="#9a9693"/><stop offset=".4" stop-color="#b3afab"/>'
    + '<stop offset=".62" stop-color="#7f7b78"/><stop offset=".85" stop-color="#696564"/><stop offset="1" stop-color="#4e4a49"/></linearGradient>'
    + '<linearGradient id="{p}-sc-peinture" x1="0" y1="-13" x2="0" y2="13" gradientUnits="userSpaceOnUse">'
    + '<stop offset="0" stop-color="#8a4f2c"/><stop offset=".2" stop-color="#d48a55"/><stop offset=".42" stop-color="#dc955f"/>'
    + '<stop offset=".62" stop-color="#c87d4c"/><stop offset=".85" stop-color="#a8633a"/><stop offset="1" stop-color="#7a4424"/></linearGradient>'
    + '<linearGradient id="{p}-sc-acier" x1="0" y1="-15" x2="0" y2="20" gradientUnits="userSpaceOnUse">'
    + '<stop offset="0" stop-color="#3b3a39"/><stop offset=".3" stop-color="#6b6a6a"/><stop offset=".5" stop-color="#7d7b7a"/>'
    + '<stop offset=".8" stop-color="#4f4d4c"/><stop offset="1" stop-color="#2f2e2d"/></linearGradient>'
    + '<linearGradient id="{p}-sc-cotes" x1="0" y1="11" x2="0" y2="33" gradientUnits="userSpaceOnUse">'
    + '<stop offset="0" stop-color="#111"/><stop offset=".35" stop-color="#3a3838"/><stop offset=".55" stop-color="#262525"/><stop offset="1" stop-color="#0d0d0d"/></linearGradient>'
    + '<linearGradient id="{p}-sc-argent" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0" stop-color="#8d8d8d"/><stop offset=".4" stop-color="#e2e2e2"/><stop offset=".7" stop-color="#b5b5b5"/><stop offset="1" stop-color="#6f6f6f"/></linearGradient>'
    + '<linearGradient id="{p}-sc-plaquette" x1="-78" y1="0" x2="-50" y2="0" gradientUnits="userSpaceOnUse">'
    + '<stop offset="0" stop-color="#151514"/><stop offset=".45" stop-color="#2c2b2a"/><stop offset=".6" stop-color="#21201f"/><stop offset="1" stop-color="#121211"/></linearGradient>'
    + '<radialGradient id="{p}-sc-chaleur"><stop offset="0" stop-color="#ff6a3a" stop-opacity=".8"/><stop offset="1" stop-color="#e0301e" stop-opacity="0"/></radialGradient>'
    + '<filter id="{p}-sc-flou" x="-50%" y="-200%" width="200%" height="500%"><feGaussianBlur stdDeviation="1.6"/></filter>'
    + '</defs>'
    // danger : fumée et lueur à la bouche (la fusée chargée reste invisible)
    + '<g class="r-fumee"><circle cx="66" cy="-20" r="6"/><circle cx="57" cy="-28" r="7"/><circle cx="47" cy="-24" r="5"/></g>'
    + '<ellipse class="r-chaleur" cx="62" cy="0" rx="28" ry="22" fill="url(#{p}-sc-chaleur)"/>'
    // le contour noir de toute l'arme (le trou du pontet reste ouvert : evenodd)
    + '<g class="r-ink" fill-rule="evenodd">'
    + '<path d="' + CROSSE + '"/><path d="' + PONTET + '"/><path d="' + CARCASSE + '"/><path d="' + CHIEN + '"/>'
    + '<rect x="-9" y="13" width="8" height="7"/><rect x="3" y="12" width="7" height="8"/>'
    + '<rect x="9" y="16" width="45" height="12"/><rect x="54" y="18" width="4" height="8"/>'
    + '<rect x="-21" y="-14.5" width="4" height="29"/><path d="' + CANON + '"/>'
    + '</g>'
    // la crosse et sa plaquette noire, le pontet et la détente
    + '<path class="p-crosse" d="' + CROSSE + '" fill="url(#{p}-sc-acier)"/>'
    + '<path d="' + PLAQUETTE + '" fill="url(#{p}-sc-plaquette)"/>'
    + '<path d="M-53,27 C-55,36 -58,44 -60,50" fill="none" stroke="#4a4847" stroke-width="1.6" stroke-linecap="round"/>'
    + '<path class="p-pontet" d="' + PONTET + '" fill="url(#{p}-sc-argent)" fill-rule="evenodd"/>'
    + '<path d="M-31,18 Q-29,27 -24,29" fill="none" stroke="#000" stroke-width="4.6" stroke-linecap="round"/>'
    + '<path d="M-31,18 Q-29,27 -24,29" fill="none" stroke="#d6d6d6" stroke-width="2.4" stroke-linecap="round"/>'
    // l'ergot et la bride de la poignée avant
    + '<rect x="-9" y="13" width="8" height="7" fill="#4f4d4c"/><rect x="3" y="12" width="7" height="8" fill="#4f4d4c"/>'
    // la carcasse gris foncé, ses rivets, le chien et sa goupille
    + '<path d="' + CARCASSE + '" fill="url(#{p}-sc-acier)"/>'
    + '<circle cx="-46" cy="-9" r="1.8" fill="#d9d9d9" stroke="#000" stroke-width=".8"/><circle cx="-27" cy="-9" r="1.8" fill="#d9d9d9" stroke="#000" stroke-width=".8"/>'
    + '<path class="p-chien" d="' + CHIEN + '" fill="url(#{p}-sc-argent)"/>'
    + '<circle cx="-59" cy="-11" r="2" fill="url(#{p}-sc-argent)" stroke="#000" stroke-width="1.2"/>'
    // la bague, puis le canon gris (reflet) et sa bouche peinte en orange, avec un éclat
    + '<rect x="-21" y="-14.5" width="4" height="29" fill="#5a5655"/>'
    + '<path class="p-canon" d="' + CANON + '" fill="url(#{p}-sc-canon)"/>'
    + '<rect x="-17" y="-9.5" width="72" height="2.6" fill="#fff" opacity=".4" filter="url(#{p}-sc-flou)"/>'
    + '<path class="p-peinture" d="' + PEINTURE + '" fill="url(#{p}-sc-peinture)"/>'
    + '<path d="M50,-6 L53,-7.2 L54.2,-4 L51,-3.2 Z" fill="#8a8683"/>'
    // la poignée avant noire côtelée et sa goupille argentée
    + '<g class="p-poignee-avant">'
    + '<rect x="9" y="16" width="45" height="12" fill="url(#{p}-sc-cotes)"/>' + COTES
    + '<rect class="p-goupille" x="54" y="18" width="4" height="8" fill="url(#{p}-sc-argent)"/>'
    + '<circle cx="58" cy="22" r="2" fill="url(#{p}-sc-argent)" stroke="#000" stroke-width="1"/>'
    + '</g>'
    // traits intérieurs : bague, jonction carcasse / canon, bouche
    + '<g class="r-traits"><path d="M-19,-13 V13 M60,-13 V13"/></g>'
    // danger : étincelles à la bouche (crans 2 et 3)
    + '<g class="p-etinc" fill="#fff1a8"><circle cx="72" cy="-11" r="1.6"/><circle cx="78" cy="5" r="1.4"/>'
    + '<circle cx="70" cy="13" r="1.5"/><circle cx="82" cy="-3" r="1.2"/><circle cx="66" cy="-16" r="1.3"/></g>'
    // au tir : la bouffée de fumée rouge, la gerbe d'étincelles, l'éclair
    + '<g class="p-bouffee" fill="#c8321f"><circle cx="70" cy="-3" r="9"/><circle cx="80" cy="4" r="7" opacity=".85"/><circle cx="64" cy="7" r="6" opacity=".9"/></g>'
    + '<g class="p-gerbe" fill="none" stroke="#ffd84a" stroke-width="1.6" stroke-linecap="round">'
    + '<path d="M64,-2 L76,-12 M66,1 L84,-2 M65,3 L79,12 M63,-4 L70,-17 M64,5 L72,18"/>'
    + '<circle cx="86" cy="-6" r="1.2" fill="#ffd84a" stroke="none"/><circle cx="81" cy="15" r="1.1" fill="#ffd84a" stroke="none"/></g>'
    + '<g class="p-eclair" transform="translate(70 0)"><path class="r-ink" d="' + ECLAIR + '"/>'
    + '<path d="' + ECLAIR + '" fill="#ffe65a"/><path d="' + ECLAIR_MI + '" fill="#fff"/></g>'
    + '</svg>';

  // La fusée : corps de 24 × 17 u de x = 22 à 46, tête centrée sur 46 (rayon
  // 14,5 : son avant tombe sur la bouche, +60 = NEZ).
  var FUSEE = ''
    + '<svg class="r-svg p-fusee" viewBox="-128 -46 250 92" aria-hidden="true" focusable="false">'
    + '<defs>'
    + '<linearGradient id="{p}-sc-corps" x1="0" y1="-8.5" x2="0" y2="8.5" gradientUnits="userSpaceOnUse">'
    + '<stop offset="0" stop-color="#232324"/><stop offset=".35" stop-color="#4f4f50"/><stop offset=".6" stop-color="#3f3f40"/><stop offset="1" stop-color="#1c1c1d"/></linearGradient>'
    + '<radialGradient id="{p}-sc-halo"><stop offset="0" stop-color="#ff6a3a" stop-opacity=".95"/><stop offset=".55" stop-color="#e0301e" stop-opacity=".75"/>'
    + '<stop offset="1" stop-color="#b0180e" stop-opacity="0"/></radialGradient>'
    + '<radialGradient id="{p}-sc-coeur"><stop offset="0" stop-color="#fff"/><stop offset=".45" stop-color="#fff1c2"/>'
    + '<stop offset=".8" stop-color="#ffb04a"/><stop offset="1" stop-color="#ff7a2a"/></radialGradient>'
    + '</defs>'
    // en vol : les bouffées de fumée rouge, derrière la fusée (.is-flying)
    + '<g class="p-fumee-vol">'
    + '<circle cx="14" cy="0" r="8" fill="#c42a1c" opacity=".85"/><circle cx="-6" cy="2" r="10" fill="#c42a1c" opacity=".7"/>'
    + '<circle cx="-28" cy="-1" r="11" fill="#b02418" opacity=".55"/><circle cx="-52" cy="3" r="10" fill="#a82218" opacity=".42"/>'
    + '<circle cx="-76" cy="0" r="9" fill="#a82218" opacity=".3"/><circle cx="-98" cy="2" r="7" fill="#a82218" opacity=".2"/>'
    + '</g>'
    // le corps anthracite, puis la tête incandescente devant lui
    + '<path class="p-corps" d="M22,-7 L24,-8.5 L46,-8.5 L46,8.5 L24,8.5 L22,7 Z" fill="url(#{p}-sc-corps)" stroke="#000" stroke-width="3.5" stroke-linejoin="round"/>'
    + '<g class="p-tete" transform="translate(46 0)">'
    + '<circle r="14.5" fill="url(#{p}-sc-halo)"/>'
    + '<circle r="12" fill="none" stroke="#ffc49a" stroke-width="1.4" opacity=".75"/>'
    + '<circle r="8" fill="url(#{p}-sc-coeur)"/>'
    + '</g>'
    + '</svg>';

  // Le dessin de la Pétoire : le projectile d'abord (dessous), l'arme par-dessus.
  var PETOIRE = '<div class="r-proj">' + FUSEE + '</div>' + ARME;

  // La table des armes. `depart` / `impact` : leurs sons propres (sound.js) —
  // tic, validation et explosion restent communs. `couche` : la classe de la
  // couche d'impact propre à l'arme, posée sur la carte touchée AVANT l'étoile
  // commune (app.js) ; null = l'étoile seule. `projectile` : l'arme
  // reste au centre et c'est son projectile (.r-proj) qui part (tirer()) ;
  // sans, c'est toute l'arme qui vole (la roquette).
  var SKINS = {
    roquette: { nom: 'La Roquette', court: 'Roquette', dessin: ROQUETTE, depart: 'whoosh', impact: 'impact', couche: null },
    petoire: { nom: 'La Pétoire de Secours', court: 'Pétoire', dessin: PETOIRE, depart: 'fusee', impact: 'crepitement', couche: 'scorch-impact', projectile: true },
  };
  var DEFAUT = 'roquette';
  // Le seul filtre côté page : un id inconnu, absent ou mal formé → la roquette.
  var skinId = function (v) { return typeof v === 'string' && Object.prototype.hasOwnProperty.call(SKINS, v) ? v : DEFAUT; };
  var dessin = function (id, prefixe) { return SKINS[skinId(id)].dessin.replace(/\{p\}/g, prefixe); };
  var info = function (id) {
    var k = skinId(id), s = SKINS[k];
    return { id: k, nom: s.nom, court: s.court, depart: s.depart, impact: s.impact, couche: s.couche };
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
      // Visée vers la GAUCHE : une arme qui n'est pas symétrique (la Pétoire)
      // se retourne pour garder la crosse en bas (CSS, `scale` : il se compose
      // avec les transform du balancement, du recul et du vol). La roquette,
      // symétrique, n'a pas de règle pour cette classe.
      var n = ((a % 360) + 360) % 360;
      host.classList.toggle('is-gauche', n > 90 && n < 270);
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
      // Le tir d'une arme à projectile : ses animations à elle (recul, vol,
      // rechargement) — pas celles du CSS (flamme, vibration du danger).
      bob.querySelectorAll('.p-arme, .r-proj').forEach(function (e) {
        e.getAnimations().forEach(function (a) { if (!(a instanceof CSSAnimation) && !(a instanceof CSSTransition)) a.cancel(); });
      });
      host.classList.remove('is-locked', 'is-gone', 'is-flying', 'is-firing', 'is-shot');
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

    // Le tir d'une arme à PROJECTILE (la Pétoire). L'arme reste au centre ;
    // seul le projectile (.r-proj, calque à part) part, droit sur la cible, dans
    // le MÊME minutage que la roquette — l'impact tombe au même instant :
    //   1. verrouillage (160 ms) ;  2. l'arme se cale (260 ms) ;
    //   3. le tir : son, éclair de bouche (.is-firing, 140 ms), gerbe
    //      d'étincelles, bouffée de fumée rouge, recul qui relève le canon ;
    //   4. le vol du projectile (340 ms) : il n'est VISIBLE que pendant
    //      .is-flying — tête incandescente devant, fumée rouge derrière ;
    //   5. l'impact : le projectile disparaît (.is-shot), l'arme reste ;
    //   6. 420 ms plus tard, l'arme est de nouveau chargée (fusée invisible).
    function tirer(el, onImpact, g) {
      var arme = bob.querySelector('.p-arme'), proj = bob.querySelector('.r-proj');
      aimAt(el, { instant: false });
      host.classList.add('is-locked');                                    // 1. verrouillage
      var p = pivot(host), q = centre(el);
      var portee = Math.hypot(q.x - p.x, q.y - p.y);
      var largeur = host.getBoundingClientRect().width || 1;      // boîte NON tournée
      // Le calque du projectile a la largeur de l'arme : même calcul que la
      // roquette, son nez (+60) arrive sur l'avatar (un peu dedans).
      var pct = Math.max(0, (portee - largeur * NEZ + largeur * .04) / largeur * 100);
      var CALEE = 'translateX(-3%) rotate(3deg)';
      var prep = arme.animate([{ transform: 'none' }, { transform: CALEE }],     // 2. l'arme se cale
        { duration: 260, delay: 160, easing: 'ease-out', fill: 'forwards' });
      return prep.finished.then(function () {
        if (g !== gen) return;
        host.dispatchEvent(new CustomEvent('rocket:whoosh'));            // 3. le tir
        host.classList.add('is-firing', 'is-flying');
        setTimeout(function () { if (g === gen) host.classList.remove('is-firing'); }, 140);
        // Recul franc : l'arme part en arrière et le canon se relève (rotation
        // autour de la main, voir le CSS), puis revient en ~0,65 s.
        arme.animate([
          { transform: CALEE }, { transform: 'translateX(-8%) rotate(-24deg)', offset: .22 },
          { transform: 'translateX(-2%) rotate(-10deg)', offset: .6 }, { transform: 'none' },
        ], { duration: 650, easing: 'ease-out' });
        prep.cancel();
        // La gerbe d'étincelles et la bouffée de fumée rouge, à la bouche.
        var gerbe = arme.querySelector('.p-gerbe'), bouffee = arme.querySelector('.p-bouffee');
        if (gerbe) gerbe.animate([{ opacity: 1, transform: 'translateX(0)' }, { opacity: 0, transform: 'translateX(8px)' }], { duration: 300, easing: 'ease-out' });
        if (bouffee) bouffee.animate([
          { opacity: 0, transform: 'scale(.5)' }, { opacity: .9, transform: 'scale(1)', offset: .2 }, { opacity: 0, transform: 'scale(1.6)' },
        ], { duration: 650, easing: 'ease-out' });
        var vol = proj.animate([                                           // 4. le vol du projectile
          { transform: 'translateX(0)' }, { transform: 'translateX(' + pct.toFixed(1) + '%)' },
        ], { duration: 340, easing: 'cubic-bezier(.55, 0, .9, .35)', fill: 'forwards' });
        return vol.finished.then(function () {
          if (g !== gen) return;
          host.classList.add('is-shot');                                   // 5. impact
          host.classList.remove('is-locked', 'is-flying');
          if (onImpact) onImpact();
          vol.cancel();
          return new Promise(function (res) { setTimeout(res, 420); });
        }).then(function () {
          if (g !== gen) return;
          host.classList.remove('is-shot');                                // 6. rechargée : à nouveau invisible
        });
      }).catch(function () { /* tir annulé par un nouveau tour */ });
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
      if (SKINS[skin].projectile) return tirer(el, onImpact, g);
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
