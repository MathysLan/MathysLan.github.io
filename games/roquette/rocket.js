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

  // « La Pétoire de Secours » : une ARME et son PROJECTILE, deux calques
  // distincts (création maison dans l'esprit du pistolet de détresse du Pyro,
  // aucun asset repris).
  //   - l'arme (svg .p-arme) : un petit pistolet de détresse trapu — canon de
  //     métal peint en rouge, bouche de laiton, carcasse d'acier, crosse de
  //     carton rouge à rivets de laiton, et un pansement en croix sur le canon
  //     (c'est une arme… de secours). Elle reste au centre : au tir, recul et
  //     éclair de bouche (.p-eclair, .is-firing) ;
  //   - le projectile (.r-proj > svg .p-fusee) : une petite fusée éclairante,
  //     chargée dans le canon (son nez dépasse de la bouche, à +60 = NEZ). Sa
  //     tête brûle (.r-flamme) et s'intensifie avec le danger, étincelles aux
  //     crans 2 et 3 (.p-etinc). Au tir, elle part seule : flamme arrière
  //     (.p-feu-arriere) et traînée rose-orange (.p-trainee) pendant le vol.
  // Le projectile est SOUS l'arme (ordre du DOM) : la bouche couvre sa queue.
  // Fumée et chaleur sortent de la bouche (calque de l'arme). Au plus fort, rien
  // ne dépasse ~85 unités du pivot : en deçà d'EMPRISE.
  var CROSSE = 'M-24,10 L-7,10 L-11,40 L-33,40 Z';
  var PONTET = 'M-5,11 C-5,26 15,26 15,12';      // un trait ouvert (pas une forme : l'encre boucherait le trou)
  var CHIEN = 'M-24,-13 L-33,-23 L-27,-26 L-18,-14 Z';
  var ECLAIR = etoile(7, 15, 6), ECLAIR_MI = etoile(7, 8, 3.5);
  var ARME = ''
    + '<svg class="r-svg p-arme" viewBox="-128 -46 250 92" aria-hidden="true" focusable="false">'
    + '<defs>'
    + '<linearGradient id="{p}-canon" x1="0" y1="-12" x2="0" y2="12" gradientUnits="userSpaceOnUse">'
    + '<stop offset="0" stop-color="#6e1212"/><stop offset=".2" stop-color="#c42b22"/><stop offset=".42" stop-color="#ff6047"/>'
    + '<stop offset=".6" stop-color="#e0352b"/><stop offset=".85" stop-color="#a11c18"/><stop offset="1" stop-color="#5a0e0e"/></linearGradient>'
    + '<linearGradient id="{p}-laiton" x1="0" y1="-15" x2="0" y2="15" gradientUnits="userSpaceOnUse">'
    + '<stop offset="0" stop-color="#5a4114"/><stop offset=".2" stop-color="#b48c2e"/><stop offset=".42" stop-color="#f4d98c"/>'
    + '<stop offset=".62" stop-color="#c49b45"/><stop offset=".85" stop-color="#86661f"/><stop offset="1" stop-color="#4c3711"/></linearGradient>'
    + '<linearGradient id="{p}-acier" x1="0" y1="-14" x2="0" y2="26" gradientUnits="userSpaceOnUse">'
    + '<stop offset="0" stop-color="#3a3a3a"/><stop offset=".25" stop-color="#8a8a8a"/><stop offset=".45" stop-color="#b5b5b5"/>'
    + '<stop offset=".75" stop-color="#5e5e5e"/><stop offset="1" stop-color="#2c2c2c"/></linearGradient>'
    + '<linearGradient id="{p}-crosse" x1="-34" y1="0" x2="-6" y2="0" gradientUnits="userSpaceOnUse">'
    + '<stop offset="0" stop-color="#5e0f0f"/><stop offset=".4" stop-color="#b8261f"/><stop offset=".7" stop-color="#d9402f"/><stop offset="1" stop-color="#8e1b17"/></linearGradient>'
    + '<radialGradient id="{p}-chaleur"><stop offset="0" stop-color="#ff7ab5" stop-opacity=".8"/><stop offset="1" stop-color="#ff4f9a" stop-opacity="0"/></radialGradient>'
    + '<filter id="{p}-flou" x="-50%" y="-200%" width="200%" height="500%"><feGaussianBlur stdDeviation="1.6"/></filter>'
    + '</defs>'
    // fumée (danger) et chaleur : à la bouche du canon
    + '<g class="r-fumee"><circle cx="52" cy="-22" r="6"/><circle cx="40" cy="-30" r="7"/><circle cx="27" cy="-25" r="5"/></g>'
    + '<ellipse class="r-chaleur" cx="50" cy="0" rx="34" ry="26" fill="url(#{p}-chaleur)"/>'
    // le contour noir de toute l'arme
    + '<g class="r-ink">'
    + '<path d="' + CROSSE + '"/><rect x="-34" y="40" width="24" height="4"/><path d="' + CHIEN + '"/>'
    + '<rect x="-26" y="-14" width="20" height="26"/><rect x="-8" y="-12" width="46" height="24"/><rect x="36" y="-15" width="9" height="30"/>'
    + '</g>'
    // crosse et son culot, pontet, chien, carcasse, canon (reflet), bouche
    + '<path class="p-crosse" d="' + CROSSE + '" fill="url(#{p}-crosse)"/>'
    + '<rect x="-34" y="40" width="24" height="4" fill="url(#{p}-laiton)"/>'
    + '<path d="' + PONTET + '" fill="none" stroke="#000" stroke-width="8" stroke-linecap="round"/>'
    + '<path d="' + PONTET + '" fill="none" stroke="#9a9a9a" stroke-width="3" stroke-linecap="round"/>'
    + '<path d="' + CHIEN + '" fill="#3a3a3a"/>'
    + '<rect x="-26" y="-14" width="20" height="26" fill="url(#{p}-acier)"/>'
    + '<rect x="-8" y="-12" width="46" height="24" fill="url(#{p}-canon)"/>'
    + '<rect x="-6" y="-9" width="40" height="2.6" fill="#fff" opacity=".45" filter="url(#{p}-flou)"/>'
    + '<rect x="36" y="-15" width="9" height="30" fill="url(#{p}-laiton)"/>'
    // rivets de la crosse, axe de bascule, détente
    + '<circle cx="-20" cy="20" r="2" fill="#f4d98c"/><circle cx="-23" cy="32" r="2" fill="#f4d98c"/>'
    + '<circle cx="-14" cy="0" r="3.2" fill="url(#{p}-laiton)" stroke="#000" stroke-width="1.5"/>'
    + '<path d="M-1,12 Q0,17 4,18" fill="none" stroke="#000" stroke-width="2.4" stroke-linecap="round"/>'
    // le détail maison : un pansement en croix sur le canon
    + '<g transform="translate(16 0)">'
    + '<rect x="-11" y="-3.5" width="22" height="7" rx="3" fill="#e8c39a" stroke="#6b4a2a" stroke-width="1" transform="rotate(35)"/>'
    + '<rect x="-11" y="-3.5" width="22" height="7" rx="3" fill="#efcfa8" stroke="#6b4a2a" stroke-width="1" transform="rotate(-35)"/>'
    + '<rect x="-3" y="-2.5" width="6" height="5" fill="#f6e2c4"/>'
    + '</g>'
    // traits intérieurs : carcasse / canon, bouche, crosse
    + '<g class="r-traits"><path d="M-8,-12 V12 M36,-12 V12 M-26,2 H-8"/></g>'
    // l'éclair de bouche (au tir seulement : .is-firing)
    + '<g class="p-eclair" transform="translate(56 0)"><path class="r-ink" d="' + ECLAIR + '"/>'
    + '<path d="' + ECLAIR + '" fill="#ffe65a"/><path d="' + ECLAIR_MI + '" fill="#fff"/></g>'
    + '</svg>';

  var NEZ_FUSEE = 'M56,-6 L57,-6 Q61,-6 61,0 Q61,6 57,6 L56,6 Z';
  var TETE_FUSEE = etoile(8, 11, 5), TETE_FUSEE_MI = etoile(8, 7, 3.5);
  var FUSEE = ''
    + '<svg class="r-svg p-fusee" viewBox="-128 -46 250 92" aria-hidden="true" focusable="false">'
    + '<defs>'
    + '<linearGradient id="{p}-trainee" x1="-120" y1="0" x2="42" y2="0" gradientUnits="userSpaceOnUse">'
    + '<stop offset="0" stop-color="#f7bfd3" stop-opacity="0"/><stop offset=".55" stop-color="#f7a6c4" stop-opacity=".6"/>'
    + '<stop offset="1" stop-color="#ffb070" stop-opacity=".95"/></linearGradient>'
    + '<linearGradient id="{p}-tube" x1="0" y1="-6" x2="0" y2="6" gradientUnits="userSpaceOnUse">'
    + '<stop offset="0" stop-color="#7a1236"/><stop offset=".3" stop-color="#e2477e"/><stop offset=".5" stop-color="#ff7aa8"/>'
    + '<stop offset=".75" stop-color="#c2306a"/><stop offset="1" stop-color="#6a0f2e"/></linearGradient>'
    + '</defs>'
    // la traînée rose-orange : en vol seulement (.is-flying)
    + '<g class="p-trainee">'
    + '<path d="M42,-5 C20,-10 -10,2 -40,-4 C-70,-10 -95,-2 -120,-4 L-120,5 C-95,9 -70,1 -40,8 C-10,13 20,4 42,5 Z" fill="url(#{p}-trainee)"/>'
    + '<circle cx="-10" cy="1" r="7" fill="#ffc29a" opacity=".5"/><circle cx="-60" cy="3" r="8" fill="#f7bfd3" opacity=".35"/>'
    + '</g>'
    // la flamme ARRIÈRE : en vol seulement
    + '<g transform="translate(42 0) scale(.42)"><g class="p-feu-arriere">'
    + '<path class="r-ink" d="' + FLAMME + '"/><path d="' + FLAMME + '" fill="#fd8a0a"/>'
    + '<path d="' + FLAMME_MI + '" fill="#ffd28f"/><path d="' + FLAMME_CO + '" fill="#ffff3a"/>'
    + '</g></g>'
    // le tube (bague de laiton) et le nez
    + '<g class="r-ink"><rect x="42" y="-6" width="14" height="12"/><path d="' + NEZ_FUSEE + '"/></g>'
    + '<rect x="42" y="-6" width="14" height="12" fill="url(#{p}-tube)"/>'
    + '<rect x="42" y="-6" width="3" height="12" fill="#c9a14a"/>'
    + '<path d="' + NEZ_FUSEE + '" fill="#ffe8f1"/>'
    // la tête qui brûle (le crochet du danger)
    + '<g transform="translate(61 0)"><g class="r-flamme">'
    + '<path class="r-ink" d="' + TETE_FUSEE + '"/><path d="' + TETE_FUSEE + '" fill="#ff4f9a"/>'
    + '<path d="' + TETE_FUSEE_MI + '" fill="#ffc6de"/><circle r="3" fill="#fff"/>'
    + '</g></g>'
    // les étincelles (danger 2 et 3)
    + '<g class="p-etinc" fill="#fff4b0"><circle cx="74" cy="-11" r="1.6"/><circle cx="79" cy="4" r="1.4"/>'
    + '<circle cx="70" cy="12" r="1.5"/><circle cx="82" cy="-3" r="1.2"/><circle cx="66" cy="-15" r="1.3"/></g>'
    + '</svg>';

  // Le dessin de la Pétoire : le projectile d'abord (dessous), l'arme par-dessus.
  var PETOIRE = '<div class="r-proj">' + FUSEE + '</div>' + ARME;

  // La table des armes. `depart` / `impact` : leurs sons propres (sound.js) —
  // tic, validation et explosion restent communs. `feu` : l'impact met le feu
  // à la carte touchée avant l'étoile commune (app.js). `projectile` : l'arme
  // reste au centre et c'est son projectile (.r-proj) qui part (tirer()) ;
  // sans, c'est toute l'arme qui vole (la roquette).
  var SKINS = {
    roquette: { nom: 'La Roquette', court: 'Roquette', dessin: ROQUETTE, depart: 'whoosh', impact: 'impact', feu: false },
    petoire: { nom: 'La Pétoire de Secours', court: 'Pétoire', dessin: PETOIRE, depart: 'fusee', impact: 'crepitement', feu: true, projectile: true },
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
    //   3. le tir : son, éclair de bouche (.is-firing, 140 ms), recul de l'arme ;
    //   4. le vol du projectile (340 ms, flamme arrière et traînée : .is-flying) ;
    //   5. l'impact : le projectile disparaît (.is-shot), l'arme reste ;
    //   6. 420 ms plus tard, une nouvelle fusée apparaît dans le canon.
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
      var CALEE = 'translateX(-3%) rotate(2deg)';
      var prep = arme.animate([{ transform: 'none' }, { transform: CALEE }],     // 2. l'arme se cale
        { duration: 260, delay: 160, easing: 'ease-out', fill: 'forwards' });
      return prep.finished.then(function () {
        if (g !== gen) return;
        host.dispatchEvent(new CustomEvent('rocket:whoosh'));            // 3. le tir
        host.classList.add('is-firing', 'is-flying');
        setTimeout(function () { if (g === gen) host.classList.remove('is-firing'); }, 140);
        arme.animate([{ transform: CALEE }, { transform: 'translateX(-11%) rotate(-9deg)', offset: .3 }, { transform: 'none' }],
          { duration: 420, easing: 'ease-out' });
        prep.cancel();
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
          host.classList.remove('is-shot');                                // 6. rechargement
          proj.animate([{ transform: 'scale(.4)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }],
            { duration: 260, easing: 'ease-out' });
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
