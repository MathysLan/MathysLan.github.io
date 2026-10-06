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

  // « Le Grenade Launcher » (id marmite) : le lance-grenades du DEMOMAN (référence
  // unique, Dossier Grenade Launcher validé : profil du modèle mesuré colonne par
  // colonne, puis ramené au repère du jeu). Dessin maison : aucun asset, aucune
  // géométrie de modèle reprise, des aplats et le contour du jeu. Canon de 17 u
  // (D) sur l'axe du pivot, bouche à +60 (NEZ), talon à -110,7 : 10 D de long,
  // longueur / hauteur ≈ 3,2 ; crosse 41 % · cage 24 % · canon 35 %. Deux calques :
  //   - l'ARME (svg .p-arme), de profil : la CAGE grise du barillet (.m-cage, 4
  //     vis, sangle haute, ferrure basse .m-ferrure), plus haute que le canon des
  //     deux côtés et surtout dessous, ses deux chambres en tubes (.m-barillet) ;
  //     le long CANON noir (.m-canon) qui sort du HAUT du barillet ; le collier
  //     gris (.m-collier) et la HAUSSE à échelle (.m-hausse), ~1 D derrière la
  //     bouche, 1,8 D au-dessus du canon ; le GARDE-MAIN en bois sous le canon
  //     (.m-garde-main) ; la CROSSE de fusil en bois orangé (.m-crosse) à
  //     poignée pistolet et plaque de couche noire ; pontet (.m-pontet), chien
  //     (.m-chien). Hausse et pontet ont un contour fin : celui de 7 en ferait un
  //     poteau et boucherait l'anneau.
  //     Au tir : éclair orange-jaune ROND (~2 D, .p-eclair), quelques étincelles
  //     (.p-gerbe), une brume claire (.p-bouffee), recul court autour de la main.
  //   - le PROJECTILE (.r-proj > svg .p-grenade) : la grenade, une pilule de 24 u
  //     (culot à rebord, bande et ogive rouges lumineuses, corps sombre), chargée
  //     DANS le canon (culot à +34, ogive à +58) et INVISIBLE tant qu'elle y est.
  //     En vol (CSS, .is-flying) : elle CULBUTE bout par-dessus bout (.m-tourne,
  //     animation CSS : purement visuelle, la trajectoire reste celle de tirer()),
  //     dans un halo rouge cerné d'un anneau (.m-halo), suivie d'une fine traînée
  //     rouge continue (.m-trainee). Ni flamme, ni bouffées, ni traînée rose.
  // Impact : l'explosion standard de TF2, rien de propre à l'arme — l'étoile
  // commune seule (couche: null). Au plus loin, le talon : 114,5 u du pivot
  // contour compris, sous EMPRISE (120,4) ; rien ne sort de la boîte du dessin.
  var GL_CROSSE = 'M-110.7,3 L-80,3.6 C-75,4.2 -72,8.4 -69,8.2 C-65,8 -60,2.5 -55.5,1 L-40,-2 L-40,11.8 L-48,10.5 C-53,11.5 -56,13 -58,13.5 C-62,15 -66,22 -70,25 C-73,25.6 -76,22.5 -80,21.2 C-88,20.2 -97,23 -106.7,24.5 L-108.7,18.6 L-110.7,8.8 Z';
  var GL_PLAQUE = 'M-110.7,3 L-107.6,3 L-105.4,24.6 L-106.7,24.5 L-108.7,18.6 L-110.7,8.8 Z';
  var GL_CHIEN = 'M-55.5,1 L-53.8,-2.3 L-51.8,-4.2 L-45.9,-5.6 L-42,-8.8 L-40,-14.1 L-40,-2 Z';
  var GL_CAGE = 'M-40,-14.1 L-36.1,-19.3 L-20.4,-18.6 L-18.5,-16 L-16.5,-14.7 L1.2,-13.4 L3.1,-8.5 L3.1,10.1 L1.2,30.4 L-0.8,31.7 L-2.8,34.3 L-12.6,34.3 L-16.5,32.4 L-20.4,30.4 L-36.1,30.4 L-40,29.8 Z';
  var GL_FERRURE = 'M-21.7,27 H3 L1.2,30.4 L-0.8,31.7 L-2.8,34.3 L-12.6,34.3 L-16.5,32.4 L-20.4,30.4 Z';
  var GL_CANON = 'M1.2,-8.5 H60 V8.5 H1.2 Z';
  var GL_GARDE = 'M5.1,8.5 L50.2,8.5 L48.2,12.1 L46.3,19.3 L5.1,19.6 Z';
  var GL_PONTET = 'M-54.7,16.3 a6.5,6.5 0 1,0 13,0 a6.5,6.5 0 1,0 -13,0 Z M-52.2,16.3 a4,4 0 1,0 8,0 a4,4 0 1,0 -8,0 Z';
  var GL_ECLAIR = etoile(10, 17, 11), GL_ECLAIR_MI = etoile(10, 10, 6.5);
  var GL_ARME = ''
    + '<svg class="r-svg p-arme" viewBox="-128 -46 250 92" aria-hidden="true" focusable="false">'
    + '<defs>'
    + '<linearGradient id="{p}-gl-bois" x1="0" y1="-6" x2="0" y2="26" gradientUnits="userSpaceOnUse">'
    + '<stop offset="0" stop-color="#6e3c22"/><stop offset=".2" stop-color="#a8643f"/><stop offset=".45" stop-color="#925439"/>'
    + '<stop offset=".75" stop-color="#7a4430"/><stop offset="1" stop-color="#5a311d"/></linearGradient>'
    + '<linearGradient id="{p}-gl-garde" x1="0" y1="8.5" x2="0" y2="19.6" gradientUnits="userSpaceOnUse">'
    + '<stop offset="0" stop-color="#4f3523"/><stop offset=".3" stop-color="#7c4a2f"/><stop offset=".6" stop-color="#65462e"/><stop offset="1" stop-color="#4a3020"/></linearGradient>'
    + '<linearGradient id="{p}-gl-canon" x1="0" y1="-8.5" x2="0" y2="8.5" gradientUnits="userSpaceOnUse">'
    + '<stop offset="0" stop-color="#141510"/><stop offset=".2" stop-color="#3f4038"/><stop offset=".36" stop-color="#4f5047"/>'
    + '<stop offset=".6" stop-color="#31322b"/><stop offset=".85" stop-color="#23241e"/><stop offset="1" stop-color="#121310"/></linearGradient>'
    + '<linearGradient id="{p}-gl-acier" x1="0" y1="-19" x2="0" y2="34" gradientUnits="userSpaceOnUse">'
    + '<stop offset="0" stop-color="#43423e"/><stop offset=".18" stop-color="#7a7972"/><stop offset=".45" stop-color="#6a6963"/>'
    + '<stop offset=".7" stop-color="#62615b"/><stop offset="1" stop-color="#44433f"/></linearGradient>'
    + '<linearGradient id="{p}-gl-clair" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0" stop-color="#5b5a54"/><stop offset=".25" stop-color="#9a998f"/><stop offset=".55" stop-color="#7f7f76"/><stop offset="1" stop-color="#56554f"/></linearGradient>'
    + '<linearGradient id="{p}-gl-tube" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0" stop-color="#1c1d18"/><stop offset=".3" stop-color="#55564f"/><stop offset=".55" stop-color="#3a3b36"/><stop offset="1" stop-color="#16170f"/></linearGradient>'
    + '<linearGradient id="{p}-gl-argent" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0" stop-color="#8d8d8d"/><stop offset=".4" stop-color="#e2e2e2"/><stop offset=".7" stop-color="#b5b5b5"/><stop offset="1" stop-color="#6f6f6f"/></linearGradient>'
    + '<radialGradient id="{p}-gl-chaleur"><stop offset="0" stop-color="#ff6a3a" stop-opacity=".75"/><stop offset="1" stop-color="#e0301e" stop-opacity="0"/></radialGradient>'
    + '<filter id="{p}-gl-flou" x="-50%" y="-200%" width="200%" height="500%"><feGaussianBlur stdDeviation="1.4"/></filter>'
    + '</defs>'
    // danger : fumée et lueur à la bouche (la grenade chargée reste invisible)
    + '<g class="r-fumee"><circle cx="70" cy="-16" r="6"/><circle cx="64" cy="-25" r="7"/><circle cx="56" cy="-31" r="5"/></g>'
    + '<ellipse class="r-chaleur" cx="62" cy="0" rx="26" ry="20" fill="url(#{p}-gl-chaleur)"/>'
    // le contour noir de toute l'arme ; hausse et pontet au trait fin (le trou du pontet reste ouvert)
    + '<g class="r-ink" fill-rule="evenodd">'
    + '<path d="' + GL_CROSSE + '"/><path d="' + GL_CHIEN + '"/><path d="' + GL_CAGE + '"/>'
    + '<path d="' + GL_GARDE + '"/><path d="' + GL_CANON + '"/><rect x="38" y="-11" width="9" height="20.2"/>'
    + '<rect x="42.8" y="-39.6" width="3.6" height="28.8" stroke-width="3"/><rect x="41.6" y="-41.6" width="6" height="2.6" stroke-width="2.4"/>'
    + '<rect x="39.2" y="-27.4" width="3.6" height="3.6" stroke-width="2"/>'
    + '<path d="' + GL_PONTET + '" stroke-width="2.5"/>'
    + '</g>'
    // la crosse de fusil en bois, sa plaque de couche noire, le chien
    + '<path class="m-crosse" d="' + GL_CROSSE + '" fill="url(#{p}-gl-bois)"/>'
    + '<path d="M-107,6.4 L-81,6.9 C-76,7.4 -73,10.6 -69.6,10.5" fill="none" stroke="#c98a5e" stroke-width="1.6" stroke-linecap="round" opacity=".7"/>'
    + '<path d="' + GL_PLAQUE + '" fill="#24221e"/>'
    + '<path class="m-chien" d="' + GL_CHIEN + '" fill="url(#{p}-gl-acier)"/>'
    // le pontet et sa détente
    + '<path class="m-pontet" d="' + GL_PONTET + '" fill="url(#{p}-gl-argent)" fill-rule="evenodd"/>'
    + '<path d="M-49.6,11.6 Q-49.4,15.6 -46.6,17.2" fill="none" stroke="#000" stroke-width="3" stroke-linecap="round"/>'
    + '<path d="M-49.6,11.6 Q-49.4,15.6 -46.6,17.2" fill="none" stroke="#cfcfcf" stroke-width="1.4" stroke-linecap="round"/>'
    // la cage grise du barillet : plaques, sangle, ferrure, et ses deux chambres en tubes
    + '<path class="m-cage" d="' + GL_CAGE + '" fill="url(#{p}-gl-acier)"/>'
    + '<g class="m-barillet">'
    + '<rect x="-35.1" y="-8.8" width="28.4" height="17.6" rx="3" fill="url(#{p}-gl-tube)"/>'
    + '<rect x="-35.1" y="9.2" width="28.4" height="17.6" rx="3" fill="url(#{p}-gl-tube)"/>'
    + '<rect x="-33" y="-5.6" width="24" height="2.2" fill="#8a8b82" opacity=".45" filter="url(#{p}-gl-flou)"/>'
    + '<rect x="-33" y="12.4" width="24" height="2.2" fill="#8a8b82" opacity=".45" filter="url(#{p}-gl-flou)"/>'
    + '</g>'
    + '<rect x="-6.7" y="-13.6" width="9.8" height="43.6" fill="url(#{p}-gl-clair)"/>'
    + '<rect x="-37.4" y="-19" width="18.6" height="4.3" fill="url(#{p}-gl-clair)"/>'
    + '<path class="m-ferrure" d="' + GL_FERRURE + '" fill="#55544e"/>'
    + '<g fill="url(#{p}-gl-argent)" stroke="#000" stroke-width=".8">'
    + '<circle cx="-37.6" cy="-11.6" r="1.7"/><circle cx="-37.6" cy="27.4" r="1.7"/><circle cx="-1.8" cy="-10.4" r="1.7"/><circle cx="-1.8" cy="27.8" r="1.7"/></g>'
    // le long canon noir (reflet), le garde-main en bois dessous
    + '<path class="m-canon" d="' + GL_CANON + '" fill="url(#{p}-gl-canon)"/>'
    + '<rect x="4" y="-5.6" width="54" height="2.2" fill="#fff" opacity=".22" filter="url(#{p}-gl-flou)"/>'
    + '<path class="m-garde-main" d="' + GL_GARDE + '" fill="url(#{p}-gl-garde)"/>'
    // le collier gris et la hausse à échelle (molette sur le côté)
    + '<rect class="m-collier" x="38" y="-11" width="9" height="20.2" fill="url(#{p}-gl-clair)"/>'
    + '<circle cx="42.5" cy="4.6" r="1.3" fill="url(#{p}-gl-argent)" stroke="#000" stroke-width=".7"/>'
    + '<g class="m-hausse" fill="#6a6963">'
    + '<rect x="42.8" y="-39.6" width="3.6" height="28.8"/><rect x="41.6" y="-41.6" width="6" height="2.6"/>'
    + '<rect x="39.2" y="-27.4" width="3.6" height="3.6" fill="url(#{p}-gl-argent)"/>'
    + '<path d="M44,-38 V-13" stroke="#9a998f" stroke-width=".9"/></g>'
    // traits intérieurs : plaques de la cage, sangle, chambres, bouche, garde-main
    + '<g class="r-traits"><path d="M-35.1,-14.4 V28 M-6.7,-13.6 V27 M-37.4,-14.7 H-18.8 M-35.1,9 H-6.7 M60,-8.5 V8.5 M5.1,8.5 H50.2 M3.1,-8.5 V8.5"/>'
    + '<path d="M-13.2,-8.8 V26.8" stroke-width="1.2" opacity=".55"/></g>'
    // au tir : la brume claire, les étincelles, l'éclair rond
    + '<g class="p-bouffee" fill="#dcd8cf"><circle cx="72" cy="-2" r="8" opacity=".75"/><circle cx="80" cy="3" r="6" opacity=".6"/><circle cx="66" cy="6" r="5" opacity=".65"/></g>'
    + '<g class="p-gerbe" fill="none" stroke="#ffd84a" stroke-width="1.4" stroke-linecap="round">'
    + '<path d="M66,-3 L76,-9 M67,2 L80,4 M65,5 L73,13 M64,-6 L69,-14"/>'
    + '<circle cx="83" cy="-5" r="1.1" fill="#ffd84a" stroke="none"/><circle cx="78" cy="12" r="1" fill="#ffd84a" stroke="none"/></g>'
    + '<g class="p-eclair" transform="translate(70 0)"><path class="r-ink" d="' + GL_ECLAIR + '"/>'
    + '<path d="' + GL_ECLAIR + '" fill="#ffb43c"/><path d="' + GL_ECLAIR_MI + '" fill="#ffe680"/><circle r="3.6" fill="#fff"/></g>'
    + '</svg>';

  // La grenade : culot à +34, ogive à +58 (cachée dans le canon, qui va de +1 à
  // +60 et fait 17 u de haut pour 13 u de grenade). Le halo et la traînée sont
  // HORS du groupe qui culbute : seul le corps de la grenade tourne.
  var GRENADE = ''
    + '<svg class="r-svg p-grenade" viewBox="-128 -46 250 92" aria-hidden="true" focusable="false">'
    + '<defs>'
    + '<linearGradient id="{p}-gl-trainee" x1="-96" y1="0" x2="34" y2="0" gradientUnits="userSpaceOnUse">'
    + '<stop offset="0" stop-color="#d0201a" stop-opacity="0"/><stop offset="1" stop-color="#e0281c" stop-opacity=".75"/></linearGradient>'
    + '<radialGradient id="{p}-gl-halo"><stop offset="0" stop-color="#ff3b2a" stop-opacity=".6"/><stop offset=".72" stop-color="#e0201a" stop-opacity=".32"/>'
    + '<stop offset="1" stop-color="#e0201a" stop-opacity="0"/></radialGradient>'
    + '<linearGradient id="{p}-gl-corps" x1="0" y1="-6.2" x2="0" y2="6.2" gradientUnits="userSpaceOnUse">'
    + '<stop offset="0" stop-color="#1f1d19"/><stop offset=".35" stop-color="#4a463e"/><stop offset=".6" stop-color="#35322c"/><stop offset="1" stop-color="#1a1815"/></linearGradient>'
    + '<radialGradient id="{p}-gl-ogive" cx=".3" cy=".4" r=".8"><stop offset="0" stop-color="#ff7a5a"/><stop offset=".45" stop-color="#ff2a18"/><stop offset="1" stop-color="#c40000"/></radialGradient>'
    + '</defs>'
    // en vol : la fine traînée rouge continue, derrière la grenade (.is-flying)
    + '<rect class="m-trainee" x="-96" y="-1.6" width="130" height="3.2" fill="url(#{p}-gl-trainee)"/>'
    // le halo rouge et son anneau, autour de la grenade
    + '<g class="m-halo"><circle cx="46" cy="0" r="16" fill="url(#{p}-gl-halo)"/>'
    + '<circle cx="46" cy="0" r="13.5" fill="none" stroke="#ff9a7a" stroke-width="1.2" opacity=".8"/></g>'
    // la grenade, qui culbute : contour, culot, bande, corps, ogive
    + '<g class="m-tourne"><g class="m-grenade">'
    + '<g fill="#000" stroke="#000" stroke-width="2.5" stroke-linejoin="round">'
    + '<path d="M34,-4.7 L34.3,-6.3 L34.6,-6.5 L36.1,-6.5 L36.4,-6.2 L36.4,6.2 L36.1,6.5 L34.6,6.5 L34.3,6.3 L34,4.7 Z"/>'
    + '<path d="M36.4,-5.8 H40.65 V5.8 H36.4 Z M40.65,-6.2 L54.2,-5.1 L54.2,5.1 L40.65,6.2 Z"/>'
    + '<path d="M54.2,-5.1 C56.2,-4.8 57.8,-3.4 58.1,-1.2 L58.1,1.2 C57.8,3.4 56.2,4.8 54.2,5.1 Z"/></g>'
    + '<path d="M34,-4.7 L34.3,-6.3 L34.6,-6.5 L36.1,-6.5 L36.4,-6.2 L36.4,6.2 L36.1,6.5 L34.6,6.5 L34.3,6.3 L34,4.7 Z" fill="#35342c"/>'
    + '<path class="m-bande" d="M36.4,-5.8 H40.65 V5.8 H36.4 Z" fill="#d0100c"/>'
    + '<path d="M40.65,-6.2 L54.2,-5.1 L54.2,5.1 L40.65,6.2 Z" fill="url(#{p}-gl-corps)"/>'
    + '<path d="M41.5,-2.4 L53.6,-2 M41.5,2.6 L53.6,2.2" stroke="#000" stroke-width=".5" opacity=".45"/>'
    + '<path class="m-ogive" d="M54.2,-5.1 C56.2,-4.8 57.8,-3.4 58.1,-1.2 L58.1,1.2 C57.8,3.4 56.2,4.8 54.2,5.1 Z" fill="url(#{p}-gl-ogive)"/>'
    + '</g></g>'
    + '</svg>';

  // Le dessin du Grenade Launcher : la grenade d'abord (dessous), l'arme par-dessus.
  var MARMITE = '<div class="r-proj">' + GRENADE + '</div>' + GL_ARME;

  // « Le Huntsman » (id huntsman) : l'arc du SNIPER (référence unique, Dossier
  // Huntsman validé : profil de l'arc et de la flèche mesurés sur les planches du
  // wiki, puis ramenés au repère du jeu à 0,58 u par pixel). Dessin maison :
  // aucun asset, des courbes tracées par les points relevés, des aplats et le
  // contour du jeu. La première arme plus HAUTE que longue : arc de 151 u
  // (pointes à -72 et +80 de l'axe : la flèche passe au-dessus du milieu), flèche
  // de 103 u, profondeur corde → dos de la poignée 23 %. Deux calques :
  //   - l'ARC (svg .p-arme), de profil, corde à gauche : le « D » en bois brun
  //     (.h-bois) ; les EMBOUTS gris très foncé recourbés vers l'avant
  //     (.h-embout-haut, .h-embout-bas), la corde bouclée dessus ; le RUBAN
  //     noir ASYMÉTRIQUE — une bande courte en haut (.h-ruban-haut), un long
  //     manchon en bas (.h-ruban-bas), deux bandes serrées à la poignée, de part
  //     et d'autre de la flèche (.h-ruban-poignee) ; la poignée en bloc et ses
  //     deux plaques grises à vis (.h-plaque) ; la CORDE fine kaki (.h-corde),
  //     dessinée par rocket.js (sa tension suit le danger, voir tendre()).
  //   - le PROJECTILE (.r-proj > svg .p-fleche) : la flèche, VISIBLE encochée au
  //     repos (marqueur n° 4 du dossier : c'est l'écart déclaré au montage des
  //     autres armes) — pointe de chasse grise (.h-pointe), ligature noire
  //     (.h-ligature), fût brun (.h-fut), bague noire (.h-bague), plumes crème
  //     (.h-plume), encoche (.h-encoche-bout). Le groupe .h-encoche recule avec
  //     la corde. En vol : pointe devant, ni culbute, ni traînée, ni flamme.
  // Le danger est la TENSION de la corde (pur habillage : aucun calcul ne
  // change) : repos, peu tendue, mi-bande, bande complète (pointe contre la
  // poignée) et, au cran 3 seulement, un tremblement fin (les 5 s de TF2).
  // Ni lueur, ni fumée, ni étincelles : rien de tout ça n'existe sur un arc.
  // Tir : la corde claque, la flèche part, l'arc ne fait qu'un sursaut ; aucun
  // éclair. Impact : la flèche se plante dans la carte (couche huntsman-impact,
  // app.js), puis l'étoile commune. Au plus loin, à bande complète : l'encoche,
  // ~104 u du pivot contour compris, sous EMPRISE (120,4).
  var HU_CORPS = 'M-31.6,-71.8 C-31,-71.7 -30,-71.1 -29.6,-70.4 C-29.2,-69.7 -29.2,-68.4 -29.3,-67.6 C-29.4,-66.8 -30.1,-66.4 -30.5,-65.8 '
    + 'C-30.9,-65.2 -31.3,-64.7 -31.8,-64.1 C-32.3,-63.5 -33.3,-62.7 -33.6,-62 C-33.9,-61.3 -33.5,-60.8 -33.6,-60 C-33.7,-59.2 -34,-58.2 -34.1,-57.1 '
    + 'C-34.2,-56 -34.5,-54.8 -34.4,-53.6 C-34.3,-52.5 -34,-51.4 -33.4,-50.2 C-32.8,-49.1 -31.5,-47.9 -30.5,-46.7 C-29.5,-45.5 -28.8,-44.6 -27.6,-43.2 '
    + 'C-26.4,-41.9 -24.8,-40.2 -23.5,-38.6 C-22.2,-37 -21.1,-35.4 -20,-33.9 C-18.9,-32.4 -18.1,-30.9 -17.1,-29.3 C-16.1,-27.8 -15.1,-26.2 -14.2,-24.6 '
    + 'C-13.3,-23.1 -12.5,-21.4 -11.9,-20 C-11.3,-18.6 -10.9,-17.4 -10.4,-16 C-9.9,-14.6 -9.5,-13.2 -9.2,-11.5 C-8.8,-9.8 -8.5,-7.9 -8.3,-6 '
    + 'C-8.1,-4.1 -8,-2.3 -7.9,0 C-7.8,2.3 -7.8,5.6 -7.9,8 C-8,10.4 -8.4,12.5 -8.7,14.5 C-9,16.5 -9.4,18 -9.8,20 C-10.2,22 -10.8,24.6 -11.4,26.4 '
    + 'C-12.1,28.2 -12.9,29.4 -13.7,31 C-14.5,32.5 -15.1,34.2 -16,35.7 C-16.9,37.2 -17.8,38.8 -18.9,40.3 C-20,41.8 -21.6,43.3 -22.9,44.9 '
    + 'C-24.1,46.5 -25,48 -26.4,49.6 C-27.8,51.2 -29.6,52.7 -31.1,54.2 C-32.6,55.7 -34.4,57.3 -35.4,58.6 C-36.4,59.9 -36.6,60.6 -36.9,62 '
    + 'C-37.2,63.4 -37,65.6 -37,67 C-37,68.4 -37.1,69.6 -36.8,70.6 C-36.5,71.6 -35.9,72.2 -35.4,73 C-34.9,73.8 -34.3,74.5 -34,75.3 '
    + 'C-33.7,76.1 -33.5,76.9 -33.6,77.6 C-33.7,78.3 -34.1,79.2 -34.5,79.7 C-34.9,80.2 -35.4,80.4 -35.9,80.4 C-36.4,80.4 -37.1,80.1 -37.7,79.6 '
    + 'C-38.3,79.1 -39,78.2 -39.5,77.4 C-40,76.6 -40.4,75.6 -40.7,74.6 C-41,73.6 -41.3,72.8 -41.5,71.4 C-41.7,70 -41.7,67.7 -41.7,66 '
    + 'C-41.7,64.3 -41.5,62.7 -41.3,61.4 C-41.1,60.1 -40.8,59.4 -40.3,58.4 C-39.8,57.4 -39.3,56.2 -38.5,55.2 C-37.7,54.2 -36.4,53 -35.4,52.1 '
    + 'C-34.4,51.2 -33.9,50.8 -32.8,49.6 C-31.7,48.4 -30,46.5 -28.7,44.9 C-27.4,43.3 -25.9,41.8 -24.7,40.3 C-23.4,38.8 -22.3,37.2 -21.2,35.7 '
    + 'C-20.1,34.2 -19.2,32.5 -18.3,31 C-17.4,29.4 -16.6,27.9 -16,26.4 C-15.3,24.9 -14.7,23.4 -14.4,21.8 C-14.1,20.2 -13.9,18.7 -14,17.1 '
    + 'C-14.1,15.5 -14.5,13.8 -14.7,12 C-14.9,10.2 -15.2,8 -15.3,6 C-15.4,4 -15.4,2 -15.4,0 C-15.4,-2 -15.3,-4 -15.2,-6 C-15.1,-8 -14.8,-10.1 -14.7,-12 '
    + 'C-14.5,-13.9 -14.2,-16.3 -14.3,-17.6 C-14.4,-18.9 -14.7,-18.8 -15.4,-20 C-16.1,-21.2 -17.2,-23.1 -18.3,-24.6 C-19.4,-26.2 -20.6,-27.8 -21.8,-29.3 '
    + 'C-23,-30.9 -24.1,-32.4 -25.3,-33.9 C-26.6,-35.4 -28,-37 -29.3,-38.6 C-30.6,-40.2 -32.1,-41.9 -33.4,-43.2 C-34.6,-44.5 -36,-45.5 -36.8,-46.6 '
    + 'C-37.6,-47.7 -38,-48.5 -38.3,-49.6 C-38.6,-50.7 -38.5,-51.8 -38.6,-53 C-38.7,-54.2 -38.6,-55.8 -38.6,-57.1 C-38.6,-58.4 -38.6,-59.5 -38.5,-60.6 '
    + 'C-38.4,-61.7 -38.2,-62.6 -37.9,-63.6 C-37.5,-64.6 -36.9,-65.6 -36.4,-66.6 C-35.9,-67.6 -35.3,-68.6 -34.8,-69.4 C-34.3,-70.2 -33.8,-70.9 -33.3,-71.3 '
    + 'C-32.8,-71.7 -32.2,-71.9 -31.6,-71.8 Z';
  // Les embouts : ce qui, du corps, est au-delà d'une coupe biaise (perpendiculaire à la branche).
  var HU_EMBOUT_HAUT = 'M-50,-80 H-20 V-53 L-33.2,-50.6 L-38.2,-47.5 L-50,-43.5 Z';
  var HU_EMBOUT_BAS = 'M-20,50 L-30.4,53 L-39.9,56.7 L-50,60 V90 H-20 Z';
  // Les plaques de la poignée, côté corde : plus larges que le bois, une en haut, une en bas.
  var HU_PLAQUE_HAUT = 'M-16,-16.2 L-11,-16.2 L-10,-15.6 L-9.4,-13 L-9.1,-10.7 L-18.4,-10.7 L-19.6,-12.6 L-19.3,-14.2 L-17.8,-15.6 Z';
  var HU_PLAQUE_BAS = 'M-17.8,7.6 L-8.1,7.6 L-8.1,12 L-8.6,15.4 L-9.2,16.9 L-14.8,16.9 L-17.6,16.2 L-19.6,14.8 L-20.2,13.2 L-19.6,10.4 L-18.6,8.6 Z';
  // La corde : bouclée sur chaque embout (parties fixes), puis droite jusqu'à
  // l'encoche, en x = HU_ENCOCHE - recul. Au repos, presque droite (léger biais
  // du relevé). Le recul par cran de danger : repos, peu tendue, mi-bande, bande
  // complète — la pointe de la flèche vient alors contre le dos de la poignée.
  var HU_CORDE_HAUT = '-33.9,-71.4 -36.9,-67 -38.5,-61.5 -39.3,-56 -39.6,-50.6';
  var HU_CORDE_BAS = '-42.1,58.6 -42.3,64 -41.7,70 -40,75.4 -37.6,79.8';
  var HU_ENCOCHE = -40.8;
  var HU_BANDE = [0, 12, 33, 60];
  var cordePoints = function (recul) { return HU_CORDE_HAUT + ' ' + (HU_ENCOCHE - recul).toFixed(2) + ',0 ' + HU_CORDE_BAS; };
  var HU_ARC = ''
    + '<svg class="r-svg p-arme" viewBox="-128 -46 250 92" aria-hidden="true" focusable="false">'
    + '<defs>'
    + '<linearGradient id="{p}-hu-bois" x1="0" y1="-72" x2="0" y2="80" gradientUnits="userSpaceOnUse">'
    + '<stop offset="0" stop-color="#8a6b4c"/><stop offset=".3" stop-color="#795e43"/><stop offset=".7" stop-color="#6a523b"/><stop offset="1" stop-color="#5c4937"/></linearGradient>'
    + '<linearGradient id="{p}-hu-embout" x1="-43" y1="0" x2="-29" y2="0" gradientUnits="userSpaceOnUse">'
    + '<stop offset="0" stop-color="#2f2e2c"/><stop offset=".45" stop-color="#55534f"/><stop offset=".7" stop-color="#454341"/><stop offset="1" stop-color="#2f2e2c"/></linearGradient>'
    + '<linearGradient id="{p}-hu-plaque" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0" stop-color="#2a2928"/><stop offset=".35" stop-color="#4a4946"/><stop offset=".6" stop-color="#393836"/><stop offset="1" stop-color="#262524"/></linearGradient>'
    + '<clipPath id="{p}-hu-corps"><path d="' + HU_CORPS + '"/></clipPath>'
    + '<clipPath id="{p}-hu-poignee"><path d="' + HU_CORPS + '"/><path d="' + HU_PLAQUE_HAUT + '"/><path d="' + HU_PLAQUE_BAS + '"/></clipPath>'
    + '</defs>'
    // le contour noir : corps et plaques, plus fin que celui des armes à feu
    // (les branches ne font que 4 à 6 u de large : un contour de 7 les noircirait)
    + '<g class="r-ink" stroke-width="3.6"><path d="' + HU_CORPS + '"/><path d="' + HU_PLAQUE_HAUT + '"/><path d="' + HU_PLAQUE_BAS + '"/></g>'
    // le bois, et un reflet le long du dos de la branche du haut
    + '<path class="h-bois" d="' + HU_CORPS + '" fill="url(#{p}-hu-bois)"/>'
    + '<path d="M-30.4,-47.2 C-25,-41.5 -18.6,-33 -14.6,-25.4 C-12.4,-21.4 -10.6,-16 -9.6,-11" fill="none" stroke="#a8865f" stroke-width="1.3" stroke-linecap="round" opacity=".7"/>'
    // embouts et ruban, découpés dans le corps
    + '<g clip-path="url(#{p}-hu-corps)">'
    + '<path class="h-embout h-embout-haut" d="' + HU_EMBOUT_HAUT + '" fill="url(#{p}-hu-embout)"/>'
    + '<path class="h-embout h-embout-bas" d="' + HU_EMBOUT_BAS + '" fill="url(#{p}-hu-embout)"/>'
    + '<path class="h-ruban h-ruban-haut" d="M-26.5,-38.7 L-22.6,-33.8" fill="none" stroke="#242424" stroke-width="22"/>'
    + '<path class="h-ruban h-ruban-bas" d="M-12.8,24.4 L-15.9,30.8 L-18.6,35.7 L-21.8,40.3 L-25.4,44.1" fill="none" stroke="#242424" stroke-width="22" stroke-linejoin="bevel"/>'
    + '</g>'
    // les plaques de la poignée et leurs vis, puis les deux bandes, de part et d'autre de la flèche
    + '<path class="h-plaque h-plaque-haut" d="' + HU_PLAQUE_HAUT + '" fill="url(#{p}-hu-plaque)"/>'
    + '<path class="h-plaque h-plaque-bas" d="' + HU_PLAQUE_BAS + '" fill="url(#{p}-hu-plaque)"/>'
    + '<g fill="#8a8781" stroke="#000" stroke-width=".6"><circle cx="-16.8" cy="-13.4" r="1.1"/><circle cx="-12" cy="-13.4" r="1.1"/>'
    + '<circle cx="-17" cy="12.4" r="1.1"/><circle cx="-11.8" cy="12.4" r="1.1"/></g>'
    + '<g class="h-ruban h-ruban-poignee" clip-path="url(#{p}-hu-poignee)" fill="#242424">'
    + '<rect x="-22" y="-10.7" width="15" height="4.6"/><rect x="-22" y="2.6" width="15" height="4.7"/></g>'
    + '<path d="M-14.6,-2.8 V-6.1 M-14.6,2.6 V5.6" stroke="#000" stroke-width="1" opacity=".5"/>'
    // la corde, par-dessus tout : un trait sombre, puis le fil kaki
    + '<polyline class="h-corde h-corde-trait" points="' + cordePoints(0) + '" fill="none" stroke="#000" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>'
    + '<polyline class="h-corde h-corde-fil" points="' + cordePoints(0) + '" fill="none" stroke="#9a9378" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/>'
    + '</svg>';

  // La flèche (103,2 u), pointe sur +60 (NEZ), encoche à -43,2 : la corde passe
  // dans son encoche. Proportions du relevé : pointe 11 % (large de 8 u, plus
  // large à l'arrière), ligature noire jusqu'à 20 %, fût de 2,2 u, bague à 82 %,
  // plumes de 83 à 97 %, coupées droit. Contour fin (un contour de 7 en ferait
  // un bâton). Aucune traînée : elle n'existe, dans TF2, que pour les critiques.
  var HU_PLUME_HAUT = 'M-39.6,-1.1 L-39.6,-5.3 L-30.6,-5.3 L-26.9,-1.1 Z';
  var HU_PLUME_BAS = 'M-39.6,1.1 L-39.6,4.9 L-31,4.9 L-27.3,1.1 Z';
  var HU_LIGATURE = 'M40.2,-1.6 H49.6 V1.6 H40.2 Z M46,-1.6 L47.6,-2.9 L48.6,-1.6 Z M46,1.6 L47.6,2.9 L48.6,1.6 Z';
  var HU_POINTE = 'M49.4,-1.6 L51.2,-4 L60,0 L51.2,4 L49.4,1.6 Z';
  var HU_FLECHE = ''
    + '<svg class="r-svg p-fleche" viewBox="-128 -46 250 92" aria-hidden="true" focusable="false">'
    + '<defs>'
    + '<linearGradient id="{p}-hu-fut" x1="0" y1="-1.1" x2="0" y2="1.1" gradientUnits="userSpaceOnUse">'
    + '<stop offset="0" stop-color="#8a735a"/><stop offset=".45" stop-color="#675543"/><stop offset="1" stop-color="#463a2d"/></linearGradient>'
    + '<linearGradient id="{p}-hu-pointe" x1="0" y1="-4" x2="0" y2="4" gradientUnits="userSpaceOnUse">'
    + '<stop offset="0" stop-color="#6a6c66"/><stop offset=".5" stop-color="#41433f"/><stop offset=".52" stop-color="#363834"/><stop offset="1" stop-color="#2a2b28"/></linearGradient>'
    + '</defs>'
    + '<g class="h-encoche" transform="translate(0 0)"><g class="h-fleche">'
    + '<g fill="#000" stroke="#000" stroke-width="1.6" stroke-linejoin="round">'
    + '<rect x="-43.2" y="-1.2" width="83.6" height="2.4"/><path d="' + HU_PLUME_HAUT + '"/><path d="' + HU_PLUME_BAS + '"/>'
    + '<path d="' + HU_LIGATURE + '"/><path d="' + HU_POINTE + '"/></g>'
    + '<path class="h-plume h-plume-haut" d="' + HU_PLUME_HAUT + '" fill="#ddd3b3"/>'
    + '<path class="h-plume h-plume-bas" d="' + HU_PLUME_BAS + '" fill="#b3ab92"/>'
    + '<path d="M-38.6,-3.2 H-31.4 M-38.6,3 H-31.6" stroke="#888375" stroke-width=".6"/>'
    + '<rect class="h-fut" x="-40.2" y="-1.1" width="80.6" height="2.2" fill="url(#{p}-hu-fut)"/>'
    + '<rect class="h-encoche-bout" x="-43.2" y="-1.2" width="3" height="2.4" fill="#5c4937"/>'
    + '<rect class="h-bague" x="-26.4" y="-1.6" width="1.6" height="3.2" fill="#1d1d1d"/>'
    + '<path class="h-ligature" d="' + HU_LIGATURE + '" fill="#222"/>'
    + '<path class="h-pointe" d="' + HU_POINTE + '" fill="url(#{p}-hu-pointe)"/>'
    + '</g></g>'
    + '</svg>';

  // Le dessin du Huntsman : la flèche d'abord (dessous : la poignée la couvre),
  // l'arc par-dessus (la corde passe dans l'encoche).
  var HUNTSMAN = '<div class="r-proj">' + HU_FLECHE + '</div>' + HU_ARC;

  // La flèche PLANTÉE (couche d'impact du Huntsman, app.js) : la même flèche,
  // pointe enfoncée (non dessinée), empennage dehors, l'impact en (0, 0) ; app.js
  // l'oriente dans l'axe du tir. Aplats seuls : aucun id (plusieurs couches
  // peuvent coexister dans la page).
  var PLANTEE = '<g transform="translate(-52 0)">'
    + '<g fill="#000" stroke="#000" stroke-width="1.6" stroke-linejoin="round">'
    + '<rect x="-43.2" y="-1.2" width="85" height="2.4"/><path d="' + HU_PLUME_HAUT + '"/><path d="' + HU_PLUME_BAS + '"/>'
    + '<path d="M40.2,-1.6 H50 V1.6 H40.2 Z M46,-1.6 L47.6,-2.9 L48.6,-1.6 Z M46,1.6 L47.6,2.9 L48.6,1.6 Z"/></g>'
    + '<path class="hi-plume" d="' + HU_PLUME_HAUT + '" fill="#ddd3b3"/><path d="' + HU_PLUME_BAS + '" fill="#b3ab92"/>'
    + '<rect class="hi-fut" x="-40.2" y="-1.1" width="80.6" height="2.2" fill="#675543"/>'
    + '<rect x="-43.2" y="-1.2" width="3" height="2.4" fill="#5c4937"/><rect x="-26.4" y="-1.6" width="1.6" height="3.2" fill="#1d1d1d"/>'
    + '<path class="hi-ligature" d="M40.2,-1.6 H50 V1.6 H40.2 Z M46,-1.6 L47.6,-2.9 L48.6,-1.6 Z M46,1.6 L47.6,2.9 L48.6,1.6 Z" fill="#222"/>'
    + '</g>';

  // Le recul au tir d'une arme à projectile (depuis la position calée) : la
  // Pétoire part en arrière et relève franchement le canon ; le Grenade
  // Launcher, plus lourd, recule court et ne se relève que de quelques degrés
  // (le dossier ne le montre qu'à la première personne).
  var RECUL_PETOIRE = { ms: 650, images: [
    { transform: 'translateX(-8%) rotate(-24deg)', offset: .22 },
    { transform: 'translateX(-2%) rotate(-10deg)', offset: .6 },
  ] };
  var RECUL_MARMITE = { ms: 460, images: [
    { transform: 'translateX(-4%) rotate(-7deg)', offset: .18 },
    { transform: 'translateX(-1%) rotate(-2deg)', offset: .55 },
  ] };
  // Le Huntsman : pas de recul d'arme à feu, un sursaut minimal de l'arc vers
  // l'avant quand la corde claque (le dossier ne relève pas mieux).
  var RECUL_HUNTSMAN = { ms: 300, images: [
    { transform: 'translateX(1.2%)', offset: .2 },
    { transform: 'translateX(-.3%)', offset: .6 },
  ] };

  // La table des armes. `depart` / `impact` : leurs sons propres (sound.js) —
  // tic, validation et explosion restent communs. `couche` : la classe de la
  // couche d'impact propre à l'arme, posée sur la carte touchée AVANT l'étoile
  // commune (app.js) ; null = l'étoile seule. `projectile` : l'arme
  // reste au centre et c'est son projectile (.r-proj) qui part (tirer()) ;
  // sans, c'est toute l'arme qui vole (la roquette). `recul` : le recul de
  // l'arme au tir (une arme à projectile). `calee` : sa mise en place avant le
  // tir (sinon CALEE). `corde` : une corde dont la tension montre le danger.
  var SKINS = {
    roquette: { nom: 'La Roquette', court: 'Roquette', dessin: ROQUETTE, depart: 'whoosh', impact: 'impact', couche: null },
    petoire: { nom: 'La Pétoire de Secours', court: 'Pétoire', dessin: PETOIRE, depart: 'fusee', impact: 'crepitement', couche: 'scorch-impact', projectile: true, recul: RECUL_PETOIRE },
    // Nom affiché PROVISOIRE, choisi par Mathys (2026-10-05).
    marmite: { nom: 'Le Grenade Launcher', court: 'Grenade Launcher', dessin: MARMITE, depart: 'tube', impact: 'impact', couche: null, projectile: true, recul: RECUL_MARMITE },
    // Nom affiché choisi par Mathys (2026-10-06), comme celui du Grenade Launcher.
    huntsman: { nom: 'Le Huntsman', court: 'Huntsman', dessin: HUNTSMAN, depart: 'corde', impact: 'plante', couche: 'huntsman-impact', projectile: true, corde: true, calee: 'none', recul: RECUL_HUNTSMAN },
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
  var CALEE = 'translateX(-3%) rotate(3deg)';     // l'arme à feu se cale avant le tir
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
    // La corde d'une arme qui en a une (le Huntsman) : son recul actuel (en
    // unités du dessin), celui qu'elle vise, l'image en cours, et le tir en
    // cours (pendant lequel le danger ne la commande plus).
    var tension = 0, visee = 0, raf = 0, tir = false;

    function poser(a, instant) {
      aim.classList.toggle('is-instant', !!instant || reduit());
      aim.style.transform = 'rotate(' + a.toFixed(2) + 'deg)';
      // Visée vers la GAUCHE : une arme qui n'est pas symétrique (la Pétoire,
      // le Grenade Launcher, le Huntsman et son ruban asymétrique) se retourne
      // pour garder la crosse — le manchon de l'arc — en bas (CSS, `scale` : il
      // se compose avec les transform du balancement, du recul et du vol). La
      // roquette, symétrique, n'a pas de règle pour cette classe.
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

    // La corde : la polyligne (trait et fil) et la flèche encochée, reculées de `d`.
    function poserTension(d) {
      tension = d;
      bob.querySelectorAll('.h-corde').forEach(function (c) { c.setAttribute('points', cordePoints(d)); });
      var e = bob.querySelector('.h-encoche');
      if (e) e.setAttribute('transform', 'translate(' + (-d).toFixed(2) + ' 0)');
    }
    // Amène la corde au recul `vers` en `ms` (décélération) ; en mouvement
    // réduit, ou sans durée, tout de suite.
    function tendre(vers, ms) {
      visee = vers;
      cancelAnimationFrame(raf);
      if (!SKINS[skin].corde) return;
      if (!ms || reduit()) { poserTension(vers); return; }
      var de = tension, t0 = performance.now();
      (function pas(now) {
        var k = Math.max(0, Math.min(1, (now - t0) / ms));
        poserTension(de + (vers - de) * (1 - Math.pow(1 - k, 3)));
        if (k < 1) raf = requestAnimationFrame(pas);
      })(t0);
    }

    // Le danger (0 à 3). Pour une arme à corde, il la tend — sauf pendant un tir.
    function setDanger(n) {
      n = Math.max(0, Math.min(3, n | 0));
      host.dataset.danger = String(n);
      if (SKINS[skin].corde && !tir && visee !== HU_BANDE[n]) tendre(HU_BANDE[n], 380);
    }

    // L'arme montrée (celle du joueur visé). Seul le DESSIN change : visée,
    // taille, danger et animation en cours restent ceux du moment.
    function setSkin(id) {
      id = skinId(id);
      if (id === skin) return;
      skin = id;
      bob.innerHTML = dessin(id, 'r');      // gabarit fixe, aucune donnée réseau (l'id est filtré)
      host.dataset.skin = id;
      cancelAnimationFrame(raf);
      tension = 0;
      visee = SKINS[id].corde ? HU_BANDE[+host.dataset.danger || 0] : 0;
      if (SKINS[id].corde) poserTension(visee);
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
      // La corde n'est plus tenue par le tir : le prochain danger la reprend.
      tir = false;
      visee = null;
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

    // Le tir d'une arme à PROJECTILE (la Pétoire, le Grenade Launcher, le
    // Huntsman). L'arme reste au centre ; seul le projectile (.r-proj, calque à
    // part) part, droit sur la cible, dans le MÊME minutage que la roquette —
    // l'impact tombe au même instant :
    //   1. verrouillage (160 ms) ;  2. l'arme se cale (260 ms) — l'arc, lui, se
    //      bande à fond pendant ces 420 ms ;
    //   3. le tir : son, éclair de bouche (.is-firing, 140 ms : une arme à feu
    //      seulement, l'arc n'en a pas), gerbe d'étincelles, bouffée (fumée
    //      rouge, brume claire), recul de l'arme (SKINS[].recul) ; la corde de
    //      l'arc claque (60 ms) ;
    //   4. le vol du projectile (340 ms) : la fusée et la grenade ne sont
    //      VISIBLES que pendant .is-flying (la fusée : tête devant, fumée rouge ;
    //      la grenade : elle culbute, halo et traînée rouges — CSS seulement) ;
    //      la flèche, déjà visible, file pointe devant, sans rien derrière ;
    //   5. l'impact : le projectile disparaît (.is-shot), l'arme reste ;
    //   6. 420 ms plus tard, l'arme est de nouveau chargée (projectile invisible ;
    //      une nouvelle flèche encochée sur l'arc).
    function tirer(el, onImpact, g) {
      var arme = bob.querySelector('.p-arme'), proj = bob.querySelector('.r-proj');
      var s = SKINS[skin], recul = s.recul || RECUL_PETOIRE, calee = s.calee || CALEE;
      aimAt(el, { instant: false });
      host.classList.add('is-locked');                                    // 1. verrouillage
      tir = true;
      if (s.corde) tendre(HU_BANDE[3], 420);                              // 1-2. l'arc se bande
      var p = pivot(host), q = centre(el);
      var portee = Math.hypot(q.x - p.x, q.y - p.y);
      var largeur = host.getBoundingClientRect().width || 1;      // boîte NON tournée
      // Le calque du projectile a la largeur de l'arme : même calcul que la
      // roquette, son nez (+60) arrive sur l'avatar (un peu dedans).
      var pct = Math.max(0, (portee - largeur * NEZ + largeur * .04) / largeur * 100);
      var prep = arme.animate([{ transform: 'none' }, { transform: calee }],     // 2. l'arme se cale
        { duration: 260, delay: 160, easing: 'ease-out', fill: 'forwards' });
      return prep.finished.then(function () {
        if (g !== gen) return;
        host.dispatchEvent(new CustomEvent('rocket:whoosh'));            // 3. le tir
        host.classList.add('is-firing', 'is-flying');
        setTimeout(function () { if (g === gen) host.classList.remove('is-firing'); }, 140);
        if (s.corde) tendre(0, 60);                                        // la corde claque
        // Le recul : l'arme part en arrière et le canon se relève (rotation
        // autour de la main, voir le CSS), puis revient.
        arme.animate([{ transform: calee }].concat(recul.images, [{ transform: 'none' }]), { duration: recul.ms, easing: 'ease-out' });
        prep.cancel();
        // La gerbe d'étincelles et la bouffée (de fumée, de brume), à la bouche.
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
          tir = false;
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
      get tension() { return tension; },
      get cible() { return cible; },
      get skin() { return skin; },
    };
  }

  window.Rocket = {
    create: create, ecart: ecart, PIVOT: PIVOT, NEZ: NEZ, EMPRISE: EMPRISE,
    SKINS: Object.keys(SKINS), DEFAUT: DEFAUT, skinId: skinId, dessin: dessin, info: info,
    BANDE: HU_BANDE.slice(), PLANTEE: PLANTEE,
  };
})();
