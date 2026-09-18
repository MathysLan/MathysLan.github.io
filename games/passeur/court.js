// Le terrain du Passeur — un SVG en fausse 3D, construit À PARTIR DE LA SCÈNE
// envoyée par le serveur. Ce fichier ne connaît aucune situation en
// particulier, et AUCUNE RÈGLE DE VOLLEY : il sait dessiner une rotation, une
// réception, un bloc et cinq options, et c'est tout. Qui a le droit de faire
// quoi est décidé par rules.js, côté serveur, et arrive déjà résolu.
//
// Les zones ne savent pas non plus laquelle est la bonne. Le terrain est un
// moyen de CHOISIR, pas une source d'information sur le barème.
//
// ---------------------------------------------------------------------------
// LE « 2.5D », EN TROIS IDÉES — c'est tout, il n'y a pas de moteur 3D ici.
//
//  1. UNE PROJECTION À UN POINT DE FUITE. Le terrain est décrit en coordonnées
//     de MONDE : `wx` va de -1 (ligne de touche gauche) à +1 (droite), et la
//     profondeur est donnée directement par l'ordonnée écran `y` — plus c'est
//     haut, plus c'est loin. La demi-largeur du terrain rétrécit linéairement
//     avec la profondeur (`hw`), donc le terrain est un trapèze. Six lignes.
//
//  2. L'ÉCHELLE SE PROPAGE. `sc(y)` sert à TOUT : un joueur au fond est posé
//     avec `scale(sc(y))`, donc il est automatiquement plus petit ; le ballon,
//     les numéros de zone et les silhouettes héritent de la même règle. C'est
//     ça qui fait la profondeur — pas les ombres, qui ne font que la confirmer.
//
//  3. L'ORDRE DE TRACÉ EST L'ORDRE DE PROFONDEUR. Camp adverse, bloc, filet,
//     zones, nos joueurs, ballon. Un contreur ne peut pas passer devant la
//     bande du filet, ni un joueur du fond devant un joueur du premier plan.
//
// Le filet est à profondeur constante : c'est donc un vrai rectangle à
// l'écran, sans déformation à gérer (maillage en `<pattern>`, bande, poteaux).
// ---------------------------------------------------------------------------
//
// LA MISE EN SITUATION. Une manche commence par ~2,5 s où l'on REGARDE :
// service, réception, le passeur qui monte au filet, le bloc qui se replace.
// Puis le serveur dit « à toi » et seulement là les zones s'activent.
//
// C'est du SMIL (`animateMotion`, `animateTransform`, `set`), pas une boucle
// JS : le navigateur s'en occupe, et surtout le rendu de la position FINALE est
// le même code que celui de l'animation — d'où l'absence de branche spéciale
// pour le mouvement réduit, où l'on dessine simplement l'état d'arrivée.
//
// Deux partis pris d'accessibilité, parce qu'un SVG est muet par défaut :
//   1. les cinq zones sont de vrais éléments interactifs (`role="button"`,
//      `tabindex`, `aria-pressed`), et l'anneau de focus est DESSINÉ dans le
//      SVG — un `outline` sur un `<g>` n'est pas rendu de la même façon
//      partout, et ici on ne peut pas se le permettre ;
//   2. la scène est aussi écrite en toutes lettres dans un texte masqué, pour
//      qui ne peut pas lire le dessin. Ce texte est généré des mêmes données,
//      donc il ne peut pas se désynchroniser du terrain.
(function (root) {
  const VIEW = { w: 200, h: 140 };
  const NEAR_Y = 132, FAR_Y = 22;     // fond de notre camp → fond du leur
  const NEAR_HW = 95, FAR_HW = 38;    // demi-largeur du terrain à ces deux bords
  const NET_Y = 58;                   // le filet, au sol
  // Les deux profondeurs d'un contreur : en attente, un pas en retrait du
  // filet ; prêt à sauter, collé au filet. Le trajet entre les deux est ce qui
  // rend le bloc lisible même quand il ne se décale pas latéralement.
  const BLOCK_WAIT_Y = NET_Y - 16;
  const BLOCK_READY_Y = NET_Y - 4;

  const hw = (y) => NEAR_HW + (y - NEAR_Y) * (FAR_HW - NEAR_HW) / (FAR_Y - NEAR_Y);
  const sc = (y) => hw(y) / NEAR_HW;  // échelle des tailles à cette profondeur
  const px = (wx, y) => 100 + wx * hw(y);
  const n = (v) => Number(v).toFixed(1);
  const pt = (wx, y) => `${n(px(wx, y))},${n(y)}`;
  const quad = (x0, x1, yt, yb) => `${pt(x0, yt)} ${pt(x1, yt)} ${pt(x1, yb)} ${pt(x0, yb)}`;

  // Les cinq choix, posés DANS le terrain. L'ordre est celui de la lecture — de
  // gauche à droite, puis l'arrière — et il fixe les raccourcis 1 à 5.
  //
  // ⚠️ Les largeurs ne sont pas cosmétiques : la perspective écrase les cibles
  // tactiles, et « 2e main » est la plus étroite. Elle a été élargie aux dépens
  // de ses voisines pour qu'AUCUNE zone ne passe sous 44 px à 390 px de large.
  // Vérifié par tests/games.html — ne pas rééquilibrer à l'œil.
  // `lines` = ce qui est ÉCRIT dans la zone, en une ou deux lignes. Avant, on
  // n'affichait que le chiffre et un sous-titre de jargon (« poste 4 ») en tout
  // petit : on ne comprenait pas ce qu'on choisissait. Le nom passe donc devant,
  // le chiffre devient un simple rappel du raccourci clavier.
  const Y_FRONT_T = 60, Y_FRONT_B = 92, Y_BACK_T = 95, Y_BACK_B = 125;
  const ZONES = [
    { id: 'gauche', key: '1', x0: -1.00, x1: -0.46, yt: Y_FRONT_T, yb: Y_FRONT_B,
      label: 'Aile gauche', lines: ['AILE', 'GAUCHE'], sub: 'poste 4' },
    { id: 'courte', key: '2', x0: -0.42, x1: 0.02, yt: Y_FRONT_T, yb: Y_FRONT_B,
      label: 'Rapide au centre', lines: ['RAPIDE'], sub: 'au centre' },
    { id: 'deuxieme', key: '3', x0: 0.06, x1: 0.46, yt: Y_FRONT_T, yb: Y_FRONT_B,
      label: 'Deuxième main', lines: ['2E', 'MAIN'], sub: 'tu la joues' },
    { id: 'droite', key: '4', x0: 0.50, x1: 1.00, yt: Y_FRONT_T, yb: Y_FRONT_B,
      label: 'Aile droite', lines: ['AILE', 'DROITE'], sub: 'poste 2' },
    // `subX` décale les textes hors du centre : la zone arrière est large, et
    // son centre est occupé par le réceptionneur.
    { id: 'arriere', key: '5', x0: -0.78, x1: 0.78, yt: Y_BACK_T, yb: Y_BACK_B, subX: -0.44,
      label: 'Attaque arrière', lines: ['ARRIÈRE'], sub: 'la pipe' },
  ];

  // Où chaque joueur ATTAQUE, une fois que tout le monde a bougé. Le passeur
  // est dans la zone « deuxième main » : c'est lui, la deuxième main.
  const SPOT = {
    gauche: { x: -0.72, y: 70 },
    courte: { x: -0.20, y: 68 },
    deuxieme: { x: 0.26, y: 71 },
    droite: { x: 0.75, y: 70 },
    arriere: { x: -0.42, y: 108 },
  };

  // Où chaque joueur SE TIENT AU SERVICE, par numéro de position (FIVB 7.4) :
  // P4 P3 P2 devant, P5 P6 P1 derrière. C'est la seule chose qui doive être
  // légale à cet instant — ensuite tout le monde se déplace (7.6).
  const SERVICE = {
    4: { x: -0.62, y: 68 }, 3: { x: 0.00, y: 66 }, 2: { x: 0.62, y: 68 },
    5: { x: -0.68, y: 112 }, 6: { x: 0.00, y: 118 }, 1: { x: 0.68, y: 112 },
  };

  // Où la réception est jouée, selon d'où vient le service, et d'où le serveur
  // adverse frappe (son côté à lui, donc en miroir du nôtre).
  const RECEPT = {
    left: { x: -0.48, y: 106 }, center: { x: 0.04, y: 110 }, right: { x: 0.52, y: 106 },
  };
  const SERVER_SPOT = {
    left: { x: 0.45, y: 26 }, center: { x: 0.00, y: 26 }, right: { x: -0.45, y: 26 },
  };

  // Le camp adverse a SIX joueurs lui aussi (FIVB 7.3). Trois devant — ce sont
  // eux, et eux seuls, qui peuvent contrer (14.6.2) — et trois derrière, en
  // défense. Ces positions sont du DÉCOR : elles ne sont pas dans la scène,
  // parce que le serveur n'a rien à en dire. Ce qui compte, le nombre de
  // contreurs et leur cible, vient bien de lui.
  const OPP_FRONT_BASE = [-0.40, 0.00, 0.40];   // leurs avants, avant lecture
  const OPP_BACK = [-0.58, 0.04, 0.62];         // leurs arrières, en défense
  const OPP_BACK_Y = 31;

  // Ce qu'on dit de chaque état, au dessin et au texte masqué. Une seule source
  // pour les deux : le terrain et la description ne peuvent pas diverger.
  const STATE = {
    ready: { tag: '', say: 'prêt', pose: 'idle' },
    running: { tag: 'lancé', say: 'déjà lancé', pose: 'run' },
    free: { tag: 'libre', say: 'libre de bloc', pose: 'attack' },
    marked: { tag: 'marqué', say: 'marqué par un contreur', pose: 'idle' },
    tired: { tag: 'fatigué', say: 'fatigué', pose: 'tired' },
    hot: { tag: 'en feu', say: 'en réussite', pose: 'attack' },
    down: { tag: 'au sol', say: 'au sol, indisponible', pose: 'down' },
  };
  const RECEPTION = {
    perfect: 'Réception parfaite',
    ok: 'Réception correcte',
    short: 'Réception courte',
    deep: 'Réception derrière toi',
    high: 'Balle très haute',
    scramble: 'Balle de secours',
  };
  const SIDE = { left: 'la gauche', center: 'le centre', right: 'la droite' };

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Lu au moment du rendu, pas au chargement : la préférence peut changer en
  // cours de partie, et c'est la règle du portfolio.
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ------------------------------------------------------------ silhouettes
  // Dessinées une fois dans un repère local — pieds en (0,0), ~20 de haut — puis
  // posées avec translate + scale(profondeur). Un joueur loin est donc plus
  // petit sans un seul calcul en plus.
  const POSE = {
    idle: '<circle cx="0" cy="-16.6" r="2.8"/>'
      + '<path d="M-3.2,-13.6 Q0,-14.6 3.2,-13.6 L2.6,-7 L-2.6,-7 Z"/>'
      + '<path class="sil-ink" d="M-2.4,-7 L-2.8,0 M2.4,-7 L2.8,0"/>'
      + '<path class="sil-ink" d="M-3.1,-12.6 L-5.2,-7.4 M3.1,-12.6 L5.2,-7.4"/>',
    run: '<circle cx="0.8" cy="-16.8" r="2.8"/>'
      + '<path d="M-2.6,-13.8 Q0.4,-14.8 3.6,-13.8 L2.8,-7.2 L-2,-7.2 Z"/>'
      + '<path class="sil-ink" d="M-1.8,-7.2 L-5,-2.4 M2.6,-7.2 L4.4,0"/>'
      + '<path class="sil-ink" d="M3.2,-12.8 L5.8,-15 M-2.6,-12.8 L-5.4,-10.4"/>',
    set: '<circle cx="0" cy="-16.6" r="2.8"/>'
      + '<path d="M-3.2,-13.6 Q0,-14.6 3.2,-13.6 L2.6,-7 L-2.6,-7 Z"/>'
      + '<path class="sil-ink" d="M-2.4,-7 L-3.2,0 M2.4,-7 L3.2,0"/>'
      + '<path class="sil-ink" d="M-3.1,-13 L-3.6,-17.6 L-1.6,-19.2 M3.1,-13 L3.6,-17.6 L1.6,-19.2"/>',
    block: '<circle cx="0" cy="-17.4" r="2.8"/>'
      + '<path d="M-3.2,-14.4 Q0,-15.4 3.2,-14.4 L2.6,-7.6 L-2.6,-7.6 Z"/>'
      + '<path class="sil-ink" d="M-2.4,-7.6 L-2.8,0 M2.4,-7.6 L2.8,0"/>'
      + '<path class="sil-ink" d="M-3,-13.8 L-4,-21.4 M3,-13.8 L4,-21.4"/>'
      + '<circle cx="-4.2" cy="-22.4" r="1.5"/><circle cx="4.2" cy="-22.4" r="1.5"/>',
    attack: '<circle cx="1" cy="-19.4" r="2.8"/>'
      + '<path d="M-2.4,-16.4 Q0.6,-17.6 3.8,-16.4 L3,-9.6 L-2,-9.6 Z"/>'
      + '<path class="sil-ink" d="M-1.8,-9.6 L-4.6,-3.4 M2.6,-9.6 L4.4,-2.6"/>'
      + '<path class="sil-ink" d="M3.4,-15.8 L5.4,-23 M-2.2,-15.4 L-5.6,-12"/>'
      + '<circle cx="5.8" cy="-24" r="1.5"/>',
    receive: '<circle cx="0" cy="-13.4" r="2.8"/>'
      + '<path d="M-3.4,-10.6 Q0,-11.6 3.4,-10.6 L2.6,-5.4 L-2.6,-5.4 Z"/>'
      + '<path class="sil-ink" d="M-2.4,-5.4 L-4.4,0 M2.4,-5.4 L4.4,0"/>'
      + '<path class="sil-ink" d="M-3,-10 L-1.2,-6.6 L1.2,-6.6 L3,-10"/>',
    serve: '<circle cx="0" cy="-17" r="2.8"/>'
      + '<path d="M-3.2,-14 Q0,-15 3.2,-14 L2.6,-7.4 L-2.6,-7.4 Z"/>'
      + '<path class="sil-ink" d="M-2.4,-7.4 L-2.8,0 M2.4,-7.4 L2.8,0"/>'
      + '<path class="sil-ink" d="M3,-13.4 L4.6,-19.8"/>',
    tired: '<circle cx="0" cy="-14.6" r="2.8"/>'
      + '<path d="M-3.2,-11.8 Q0,-12.8 3.2,-11.8 L2.6,-6.2 L-2.6,-6.2 Z"/>'
      + '<path class="sil-ink" d="M-2.4,-6.2 L-2.8,0 M2.4,-6.2 L2.8,0"/>'
      + '<path class="sil-ink" d="M-3.1,-11 L-4.4,-5.6 M3.1,-11 L4.4,-5.6"/>',
    down: '<circle cx="-4.4" cy="-3" r="2.8"/>'
      + '<path d="M-2,-5.2 Q1,-6 4.6,-4.6 L5,-1 L-1.4,-0.6 Z"/>'
      + '<path class="sil-ink" d="M4.6,-2.4 L7.4,-0.6"/>',
  };

  // Une silhouette posée sur le terrain. `poseB` + `at` décrivent un changement
  // de pose en cours de mise en situation : on empile les deux poses et on
  // bascule l'opacité au bon moment, ce qui évite de redessiner quoi que ce soit.
  function person(o) {
    const s = sc(o.y), X = px(o.x, o.y);
    // L'étiquette peut n'apparaître qu'une fois le joueur arrivé : « TOI »
    // posé sur le passeur au départ atterrit à l'autre bout du terrain, sur le
    // libellé d'une zone.
    const tag = o.tag
      ? `<text class="sil-tag" y="${o.above ? -29 : 5.8}"${o.tagAt ? ' opacity="0"' : ''}>`
        + esc(o.tag)
        + (o.tagAt ? `<set attributeName="opacity" to="1" begin="${o.tagAt}s" fill="freeze"/>` : '')
        + '</text>'
      : '';
    const poseA = POSE[o.pose] || POSE.idle;
    let bodies = `<g class="sil-body">${poseA}</g>`;
    if (o.poseB && o.at != null) {
      bodies = `<g class="sil-body sil-a">${poseA}`
        + `<set attributeName="opacity" to="0" begin="${o.at}s" fill="freeze"/></g>`
        + `<g class="sil-body sil-b" opacity="0">${POSE[o.poseB] || POSE.idle}`
        + `<set attributeName="opacity" to="1" begin="${o.at}s" fill="freeze"/></g>`;
    }
    return `<g class="${o.cls}" transform="translate(${n(X)},${n(o.y)}) scale(${s.toFixed(3)})">`
      + '<ellipse class="sil-shadow" cx="0" cy="0.6" rx="5.4" ry="1.7"/>'
      + bodies + tag + '</g>';
  }

  // Un contreur ne va pas en diagonale : il avance vers le filet, PUIS il
  // glisse latéralement vers sa cible. On suit donc un chemin en L avec
  // `animateMotion` — deux `animateTransform` enchaînés seraient plus fragiles,
  // et une simple interpolation directe donnait ce mouvement « tout droit » qui
  // ne ressemblait à rien.
  function moverL(from, to, delay, dur, inner) {
    const dx = px(to.x, to.y) - px(from.x, from.y);
    const dy = to.y - from.y;
    if (Math.abs(dx) < 0.2 && Math.abs(dy) < 0.2) return inner;
    // Le pas vers le filet occupe la première moitié, le glissement la seconde.
    const path = `M0,0 l0,${n(dy)} l${n(dx)},0`;
    return `<g class="mv mv-l">${inner}`
      + `<animateMotion begin="${delay}s" dur="${dur}s" fill="freeze"`
      + ` path="${path}" keyPoints="0;0.45;1" keyTimes="0;0.4;1" calcMode="linear"/></g>`;
  }

  // Un joueur qui se DÉPLACE : on l'enveloppe dans un groupe qui ne fait qu'une
  // translation, animée de (0,0) vers l'écart entre départ et arrivée. Le
  // groupe intérieur garde sa mise à l'échelle, donc rien à recalculer.
  function mover(from, to, delay, dur, inner) {
    const dx = px(to.x, to.y) - px(from.x, from.y);
    const dy = to.y - from.y;
    if (Math.abs(dx) < 0.2 && Math.abs(dy) < 0.2) return inner;
    return `<g class="mv" transform="translate(0,0)">${inner}`
      + '<animateTransform attributeName="transform" type="translate" from="0 0"'
      + ` to="${n(dx)} ${n(dy)}" begin="${delay}s" dur="${dur}s"`
      + ' calcMode="spline" keySplines="0.3 0 0.2 1" fill="freeze"/></g>';
  }

  // Un ballon de volley : trois coutures courbes suffisent à le rendre
  // identifiable en un coup d'œil.
  const BALL = '<circle class="ball-o" cx="0" cy="0" r="3.4"/>'
    + '<path class="ball-s" d="M-3.3,-0.8 Q0,-2.2 3.3,-0.8"/>'
    + '<path class="ball-s" d="M-1.9,-2.8 Q-0.7,0.4 -2.2,3"/>'
    + '<path class="ball-s" d="M1.9,-2.8 Q0.7,0.4 2.2,3"/>';

  function ballAt(wx, y, lift) {
    const s = sc(y), X = px(wx, y), Y = y - (lift || 0) * s;
    return '<g class="c-ball-g">'
      + `<ellipse class="ball-shadow" cx="${n(X)}" cy="${n(y)}" rx="${(3.2 * s).toFixed(2)}" ry="${(1.1 * s).toFixed(2)}"/>`
      + `<g class="c-ball" transform="translate(${n(X)},${n(Y)}) scale(${s.toFixed(3)})">${BALL}</g></g>`;
  }

  const DEFS = '<defs>'
    + '<linearGradient id="pz-depth" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0" stop-color="#000" stop-opacity=".42"/>'
    + '<stop offset="0.55" stop-color="#000" stop-opacity=".12"/>'
    + '<stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient>'
    + '<pattern id="pz-mesh" width="3.2" height="3.2" patternUnits="userSpaceOnUse">'
    + '<rect width="3.2" height="3.2" class="net-bg"/>'
    + '<path class="net-thread" d="M0,0 H3.2 M0,0 V3.2"/>'
    + '</pattern></defs>';

  // ------------------------------------------------------------ le terrain
  function floor() {
    return `<polygon class="f-them" points="${quad(-1, 1, FAR_Y, NET_Y)}"/>`
      + `<polygon class="f-us" points="${quad(-1, 1, NET_Y, NEAR_Y)}"/>`
      + `<polygon class="f-depth" points="${quad(-1, 1, FAR_Y, NEAR_Y)}"/>`
      + `<polygon class="line" points="${quad(-1, 1, FAR_Y, NEAR_Y)}"/>`
      // La ligne des 3 m, bien visible : elle sépare la zone avant de la zone
      // arrière. Mais ce n'est QU'UNE LIGNE — après le service, tout le monde
      // la franchit (FIVB 7.6), à commencer par le passeur arrière.
      + `<line class="line line-3m" x1="${n(px(-1, 93))}" y1="93" x2="${n(px(1, 93))}" y2="93"/>`
      // Les deux étiquettes vivent dans la MARGE, à gauche du terrain : posées
      // dessus, elles tombaient immanquablement sur un joueur ou sur le
      // libellé d'une zone. Alignées à droite, elles débordent vers le vide.
      + `<text class="c-zone-tag" x="${n(px(-1, 72) - 2.5)}" y="72">AVANT</text>`
      + `<text class="c-zone-tag" x="${n(px(-1, 106) - 2.5)}" y="106">ARRIÈRE</text>`
      + `<line class="line line-3m" x1="${n(px(-1, 40))}" y1="40" x2="${n(px(1, 40))}" y2="40"/>`
      + `<polygon class="net-shadow" points="${quad(-1, 1, NET_Y, NET_Y + 4.5)}"/>`;
  }

  function net() {
    const h = 27 * sc(NET_Y), top = NET_Y - h, w = hw(NET_Y);
    return '<g class="c-net">'
      + `<rect class="net-mesh" x="${n(100 - w)}" y="${n(top)}" width="${n(2 * w)}" height="${n(h)}"/>`
      + `<rect class="net-band" x="${n(100 - w)}" y="${n(top)}" width="${n(2 * w)}" height="2.6"/>`
      + `<rect class="net-band-lo" x="${n(100 - w)}" y="${n(top + 2.6)}" width="${n(2 * w)}" height="0.8"/>`
      // Les poteaux ont une face sombre : c'est ce qui leur donne du volume.
      + `<rect class="post" x="${n(100 - w - 2.6)}" y="${n(top - 2)}" width="2.6" height="${n(h + 2)}"/>`
      + `<rect class="post-lo" x="${n(100 - w - 1)}" y="${n(top - 2)}" width="1" height="${n(h + 2)}"/>`
      + `<rect class="post" x="${n(100 + w)}" y="${n(top - 2)}" width="2.6" height="${n(h + 2)}"/>`
      + `<rect class="post-lo" x="${n(100 + w + 1.6)}" y="${n(top - 2)}" width="1" height="${n(h + 2)}"/>`
      + '</g>';
  }

  // Où se placent les contreurs, selon ce qu'ils surveillent. Ils sont trois au
  // maximum : seuls les joueurs de la ligne avant peuvent contrer (FIVB 14.6.2),
  // et c'est le serveur qui fait respecter ce plafond.
  function blockXs(focus, count) {
    const anchors = {
      // `base` = là où ils se tiennent AVANT d'avoir lu la passe. C'est la
      // position de départ quand la scène ne demande pas un départ particulier.
      base: OPP_FRONT_BASE,
      spread: [-0.62, 0, 0.62], middle: [-0.24, 0.02, 0.28],
      left: [-0.72, -0.4, -0.08], right: [0.08, 0.4, 0.72], setter: [0.02, 0.3, 0.58],
    };
    const row = anchors[focus] || anchors.spread;
    if (count >= 3) return row;
    if (count === 2) return [row[0], row[2]];
    if (count === 1) return [row[1]];
    return [];
  }

  // ------------------------------------------------------------- les zones
  function zone(z, opts, opt) {
    const o = opts || {};
    const cx = (z.x0 + z.x1) / 2, cy = (z.yt + z.yb) / 2;
    const s = sc(cy);
    const state = opt && opt.state;
    const st = state && state !== 'ready' ? STATE[state] : null;
    // Une option interdite par les règles reste VISIBLE — on doit comprendre
    // qu'elle existe et pourquoi elle est fermée — mais elle n'est pas jouable.
    const illegal = !!(opt && opt.legal === false);
    const sub = illegal ? 'interdit' : z.sub + (st ? ' · ' + st.tag : '');
    const aria = illegal
      ? `${z.label} — impossible : ${opt.why}`
      : `${z.label}, ${sub} — touche ${z.key}`;
    const attrs = o.interactive
      ? ` role="button" tabindex="0" aria-pressed="false"${illegal ? ' aria-disabled="true"' : ''} aria-label="${esc(aria)}"`
      : ' aria-hidden="true"';
    // Le numéro suit le même décalage que les textes : au centre de la zone
    // arrière, il finirait derrière le réceptionneur.
    const tx = z.subX != null ? z.subX : cx;
    // Même interdite, la zone garde son NOM : il faut comprendre de quelle
    // option on est privé. C'est la mention du dessous, et le × de la pastille,
    // qui disent qu'elle est fermée.
    const lines = z.lines || [z.label.toUpperCase()];
    // ⚠️ La taille est calibrée pour le TÉLÉPHONE, pas pour le bureau. À 390 px
    // le terrain ne fait que ~316 px de large, soit 1,58 px par unité de
    // viewBox : un nom à 4,6 unités sortait à 6 px, illisible. La largeur des
    // zones laissait pourtant trois fois la place — d'où ce calibre.
    const fs = 10 * s;                        // taille du nom de la zone
    const subFs = 5 * s;
    // Le bloc de textes est calé sur le BAS de la zone : le haut est occupé par
    // l'attaquant, et on ne veut pas écrire par-dessus lui.
    const subY = z.yb - 2.5 * s;
    const lineY = (i) => subY - subFs - 1.3 * s - (lines.length - 1 - i) * (fs * 1.1);
    const keyY = z.yt + 7 * s, keyX = px(z.x0, keyY) + 6 * s;
    return `<g class="zone${st ? ' has-state' : ''}${illegal ? ' is-illegal' : ''}" data-pass="${z.id}"${attrs}>`
      + `<polygon class="z-hit" points="${quad(z.x0, z.x1, z.yt, z.yb)}"/>`
      + `<polygon class="z-focus" points="${quad(z.x0 + 0.02, z.x1 - 0.02, z.yt + 1.2, z.yb - 1.2)}"/>`
      // Le raccourci clavier, dans un pastille discrète en haut à gauche.
      + `<g class="z-keycap"><circle cx="${n(keyX)}" cy="${n(keyY - 1.5 * s)}" r="${(3.6 * s).toFixed(1)}"/>`
      + `<text class="z-key" x="${n(keyX)}" y="${n(keyY)}" font-size="${(5 * s).toFixed(1)}">${illegal ? '×' : z.key}</text></g>`
      // Le NOM de la distribution, c'est lui qui doit se lire d'abord.
      + lines.map((l, i) =>
        `<text class="z-name" x="${n(px(tx, lineY(i)))}" y="${n(lineY(i))}" font-size="${fs.toFixed(1)}">${esc(l)}</text>`).join('')
      + `<text class="z-sub" x="${n(px(tx, subY))}" y="${n(subY)}" font-size="${subFs.toFixed(1)}">${esc(sub)}</text>`
      + `<g class="z-mark"><path d="M${n(px(cx, z.yt + 6 * s) - 4.6 * s)},${n(z.yt + 6 * s)}`
      + ` l${(2.8 * s).toFixed(1)},${(2.8 * s).toFixed(1)} l${(5.8 * s).toFixed(1)},${(-6 * s).toFixed(1)}"/></g>`
      + '</g>';
  }

  // Trajectoire passeur → zone : une courbe qui MONTE, donc qui se lit comme
  // une passe et pas comme une flèche posée à plat sur le sol.
  function trajectory(id, cls) {
    const from = SPOT.deuxieme, to = SPOT[id] || SPOT.deuxieme;
    const x1 = px(from.x, from.y), y1 = from.y - 18 * sc(from.y);
    const x2 = px(to.x, to.y), y2 = to.y - 16 * sc(to.y);
    const mx = (x1 + x2) / 2;
    const my = Math.min(y1, y2) - (id === 'deuxieme' ? 5 : 22);
    return `<path class="${cls}" data-for="${id}" d="M${n(x1)},${n(y1)} Q${n(mx)},${n(my)} ${n(x2)},${n(y2)}"/>`;
  }

  // Le terrain raconté en toutes lettres, pour qui ne lit pas le dessin.
  function describe(scene) {
    const bits = [];
    const rec = scene.reception || {};
    bits.push((RECEPTION[rec.quality] || 'Réception') + ', service venu de ' + (SIDE[scene.serve] || 'le centre') + '.');
    const set = scene.setter || {};
    bits.push(set.front
      ? `Tu es passeur avant, en position ${set.pos}.`
      : `Tu es passeur arrière, en position ${set.pos} : tu montes au filet pour distribuer.`);
    const b = scene.block || {};
    bits.push(b.count
      ? `En face : ${b.count} contreur${b.count > 1 ? 's' : ''}, ${b.late ? 'encore en retard' : 'déjà en place'}.`
      : 'Aucun bloc en face.');
    ZONES.forEach((z) => {
      const o = (scene.options || {})[z.id];
      if (!o) return;
      if (o.legal === false) bits.push(`${z.label} : impossible, ${o.why}`);
      else if (o.state && o.state !== 'ready') bits.push(`${z.label} (${z.sub}) : ${STATE[o.state].say}.`);
    });
    return bits.join(' ');
  }

  // --------------------------------------------------------------- rendu
  // `animate` décide de tout : à vrai on dessine l'instant du service et on
  // laisse le SMIL emmener chacun à sa place ; à faux on dessine directement
  // l'état d'arrivée. C'est LE MÊME code — d'où l'absence de branche spéciale
  // pour le mouvement réduit.
  function paint(svg, scene, o) {
    const opts = scene.options || {};
    const rec = scene.reception || { quality: 'ok' };
    const animate = !!o.animate;
    const T = Math.max(0.8, (o.introMs || scene.introMs || 2400) / 1000);

    // Les temps de la mise en situation, en secondes. Le bloc en retard part
    // volontairement plus tard : c'est CE décalage que le joueur doit lire.
    // Chaque étape doit être VUE, donc elles se chevauchent peu : le service,
    // puis la réception, puis le passeur qui monte, puis le bloc qui se
    // replace. Un bloc « en retard » part plus tard ET met plus longtemps —
    // il est encore en train de fermer quand le joueur doit décider, et c'est
    // exactement l'information à lire.
    const tServe = T * 0.06, dServe = T * 0.30;
    const tPass = T * 0.40, dPass = T * 0.24;
    const tSetter = T * 0.14, dSetter = T * 0.40;
    const late = !!(scene.block && scene.block.late);
    const tBlock = late ? T * 0.62 : T * 0.36;
    const dBlock = late ? T * 0.48 : T * 0.34;
    const tApproach = T * 0.70, dApproach = T * 0.26;

    const recSpot = RECEPT[scene.serve] || RECEPT.center;
    const srvSpot = SERVER_SPOT[scene.serve] || SERVER_SPOT.center;
    const setStart = SERVICE[(scene.setter || {}).pos] || SERVICE[1];
    const recStart = SERVICE[rec.pos] || SERVICE[6];

    // --- nos joueurs, chacun de sa position de service vers sa zone d'attaque
    const people = [];
    ZONES.forEach((z) => {
      const opt = opts[z.id] || {};
      if (z.id === 'deuxieme') return;                 // le passeur, à part
      if (opt.by && rec.by === opt.by) return;         // le réceptionneur, à part
      const start = SERVICE[opt.pos] || SPOT[z.id];
      const end = SPOT[z.id];
      const pose = (STATE[opt.state] || STATE.ready).pose;
      const moving = animate && opt.state !== 'down';
      const body = person({
        x: (animate ? start : end).x, y: (animate ? start : end).y,
        pose: moving ? 'idle' : pose,
        poseB: moving ? pose : null, at: n(tApproach + dApproach * 0.7),
        cls: 'sil-us c-att is-' + esc(opt.state || 'ready'),
      });
      people.push(animate && opt.state !== 'down'
        ? mover(start, end, n(tApproach), n(dApproach), body) : body);
    });

    // Le réceptionneur. Attention : c'est souvent LE MÊME JOUEUR que
    // l'attaquant d'une option — le réceptionneur-attaquant arrière reçoit
    // puis vient à la pipe. On ne le dessine donc qu'une fois, mais il porte
    // les DEUX rôles : sa zone doit avoir son attaquant comme les autres.
    const recOwns = ZONES.find((z) => (opts[z.id] || {}).by === rec.by);
    const recCls = 'c-receiver'
      + (recOwns ? ' c-att is-' + esc((opts[recOwns.id] || {}).state || 'ready') : '');
    const recBody = person({
      x: (animate ? recStart : recSpot).x, y: (animate ? recStart : recSpot).y,
      pose: animate ? 'idle' : 'receive',
      poseB: animate ? 'receive' : null, at: n(tServe + dServe * 0.72),
      cls: 'sil-us ' + recCls, tag: 'réception',
    });
    people.push(animate ? mover(recStart, recSpot, n(tServe), n(dServe * 0.9), recBody) : recBody);

    // Le passeur monte au filet. Quand il est arrière, c'est exactement la
    // pénétration autorisée par 7.6 — et le terrain la MONTRE, au lieu de la
    // supposer.
    const setBody = person({
      x: (animate ? setStart : SPOT.deuxieme).x, y: (animate ? setStart : SPOT.deuxieme).y,
      pose: animate ? 'run' : 'set',
      poseB: animate ? 'set' : null, at: n(tSetter + dSetter),
      cls: 'sil-set c-setter is-' + ((scene.setter || {}).front ? 'front' : 'back'),
      tag: 'TOI', above: true, tagAt: animate ? n(tSetter + dSetter * 0.85) : null,
    });
    people.push(animate ? mover(setStart, SPOT.deuxieme, n(tSetter), n(dSetter), setBody) : setBody);

    // NOTRE SIXIÈME JOUEUR. Cinq rôles portent une option (les quatre
    // attaquants + le passeur) ; le sixième — le central de la ligne arrière —
    // n'en porte aucune, mais il est sur le terrain : une équipe compte six
    // joueurs (FIVB 7.3). Il se déduit de `lineup` moins les porteurs
    // d'options, donc AUCUN changement de protocole n'est nécessaire.
    // Il reste en défense, et il est dessiné en retrait : il n'est pas un choix.
    // Il se place en défense près de sa ligne de touche — pas sur sa position
    // de rotation : posé là, il tombait pile sur le libellé de la zone arrière.
    // Le déplacement après le service est de toute façon libre (FIVB 7.6).
    const owners = new Set(ZONES.map((z) => (opts[z.id] || {}).by).filter(Boolean));
    (scene.lineup || []).forEach((role) => {
      if (owners.has(role)) return;
      const pos = (scene.lineup || []).indexOf(role) + 1;
      const spot = SERVICE[pos];
      if (!spot) return;
      const guard = { x: spot.x <= 0 ? -0.95 : 0.95, y: 128 };
      const body = person({
        x: (animate ? spot : guard).x, y: (animate ? spot : guard).y,
        pose: 'idle', cls: 'sil-us c-extra',
      });
      people.push(animate ? mover(spot, guard, n(tServe), n(dServe), body) : body);
    });

    // --- le bloc adverse : il LIT la situation et se déplace vers sa cible.
    //
    // ⚠️ Les contreurs partent TOUJOURS en retrait du filet (BLOCK_WAIT_Y) pour
    // venir s'y coller (BLOCK_READY_Y). Sans ça, les 9 situations sur 12 où la
    // cible est la même que le départ ne produisaient AUCUN déplacement : le
    // bloc était figé, et le joueur n'avait rien à lire. Le pas vers le filet
    // se voit toujours ; l'écart latéral, lui, porte l'information tactique.
    const b = scene.block || { count: 0, start: 'spread', target: 'spread', late: false };
    const targetXs = blockXs(b.target, b.count);
    // Quand la scène ne demande pas un départ particulier, ils partent de leur
    // position d'AVANT-LECTURE (regroupés). Sans ça, `start === target` — le cas
    // de 9 situations sur 12 — ne produisait aucun déplacement du tout.
    const startXs = b.start === b.target ? blockXs('base', b.count) : blockXs(b.start, b.count);
    const wall = startXs.map((sx, i) => {
      const tx = targetXs[i] != null ? targetXs[i] : sx;
      const from = { x: sx, y: BLOCK_WAIT_Y }, to = { x: tx, y: BLOCK_READY_Y };
      // Ils ne partent pas tous en même temps : un contreur lit, puis réagit.
      const begin = tBlock + i * dBlock * 0.16;
      const body = person({
        x: (animate ? from : to).x, y: (animate ? from : to).y,
        pose: animate ? 'idle' : 'block',
        poseB: animate ? 'block' : null, at: n(begin + dBlock * 0.92),
        cls: 'sil-them c-blocker' + (b.late ? ' is-late' : ''),
      });
      return animate ? moverL(from, to, n(begin), n(dBlock), body) : body;
    }).join('');

    // Leurs trois AVANTS : ceux qui ne contrent pas restent au filet, en
    // retrait visuel. Il y a six joueurs par équipe, pas « autant que de
    // contreurs » (FIVB 7.3).
    const usedFront = targetXs.slice();
    const idleFront = OPP_FRONT_BASE.filter((x) =>
      !usedFront.some((u) => Math.abs(u - x) < 0.12)).slice(0, Math.max(0, 3 - b.count));
    const oppFront = idleFront.map((x) => person({
      x, y: BLOCK_WAIT_Y + 3, pose: 'idle', cls: 'sil-them c-extra',
    })).join('');

    // Et leurs trois ARRIÈRES, en défense. Décor, mais un terrain de volley
    // sans eux ne ressemble pas à un terrain de volley.
    const serveX = (SERVER_SPOT[scene.serve] || SERVER_SPOT.center).x;
    const oppBack = OPP_BACK.map((x) => {
      // Celui qui sert est dessiné à part, à son emplacement de service.
      if (animate && Math.abs(x - serveX) < 0.2) return '';
      return person({ x, y: OPP_BACK_Y, pose: 'idle', cls: 'sil-them c-extra' });
    }).join('');
    const note = b.count
      ? `${b.count} contreur${b.count > 1 ? 's' : ''} ${b.late ? '— EN RETARD' : 'en place'}`
      : 'aucun bloc';
    const server = animate
      ? person({ x: srvSpot.x, y: srvSpot.y, pose: 'serve', cls: 'sil-them c-server' }) : '';

    // --- le ballon : service par-dessus le filet, puis réception vers le passeur
    const netTopY = NET_Y - 27 * sc(NET_Y);
    const p0 = { x: px(srvSpot.x, srvSpot.y), y: srvSpot.y - 14 * sc(srvSpot.y) };
    const p1 = { x: px(recSpot.x, recSpot.y), y: recSpot.y - 7 * sc(recSpot.y) };
    const p2 = { x: px(SPOT.deuxieme.x, SPOT.deuxieme.y), y: SPOT.deuxieme.y - 21 * sc(SPOT.deuxieme.y) };
    // Une balle haute monte franchement, une réception courte rase le sol.
    const lift = rec.quality === 'high' ? 40 : rec.quality === 'short' ? 6 : 24;
    const passTop = Math.min(p1.y, p2.y) - lift;
    const passPath = `M${n(p1.x)},${n(p1.y)} Q${n((p1.x + p2.x) / 2)},${n(passTop)} ${n(p2.x)},${n(p2.y)}`;
    const wobbly = rec.quality === 'scramble' || rec.quality === 'short';

    let ball;
    if (animate) {
      // `animateMotion` déplace le groupe : les chemins sont donc exprimés
      // RELATIVEMENT au point de départ du ballon, pas en absolu.
      const rp = (x, y) => `${n(x - p0.x)},${n(y - p0.y)}`;
      const serveRel = `M${rp(p0.x, p0.y)} Q${rp((p0.x + p1.x) / 2, netTopY - 12)} ${rp(p1.x, p1.y)}`;
      const passRel = `M${rp(p1.x, p1.y)} Q${rp((p1.x + p2.x) / 2, passTop)} ${rp(p2.x, p2.y)}`;
      const s = sc(SPOT.deuxieme.y);
      ball = '<g class="c-ball-g">'
        + `<g class="c-ball-mover" transform="translate(${n(p0.x)},${n(p0.y)})">`
        + `<g class="c-ball" transform="scale(${s.toFixed(3)})">${BALL}</g>`
        + `<animateMotion class="c-ball-motion c-ball-serve" begin="${n(tServe)}s" dur="${n(dServe)}s" fill="freeze" path="${serveRel}"/>`
        + `<animateMotion class="c-ball-motion c-ball-pass" begin="${n(tPass)}s" dur="${n(dPass)}s" fill="freeze" path="${passRel}"/>`
        + '</g></g>';
    } else {
      ball = ballAt(SPOT.deuxieme.x, SPOT.deuxieme.y, 21);
    }

    svg.setAttribute('viewBox', `0 0 ${VIEW.w} ${VIEW.h}`);
    svg.setAttribute('class', 'court' + (o.interactive ? ' is-live' : ' is-static'));
    // Un terrain redessiné est un terrain rejouable : sans ça, le verrou posé à
    // la manche précédente survit et la manche suivante est injouable.
    svg.removeAttribute('data-locked');

    // L'ordre, c'est la profondeur. Ne pas réordonner à la légère.
    svg.innerHTML = DEFS
      + floor()
      + `<g class="c-far-side">${oppBack}${server}${oppFront}${wall}`
      + `<text class="c-far-note" x="100" y="${n(FAR_Y - 6)}">${esc(note)}</text></g>`
      + net()
      + `<g class="c-zones">${ZONES.map((z) => zone(z, o, opts[z.id])).join('')}</g>`
      + `<g class="c-players">${people.join('')}</g>`
      + `<g class="c-rec-path"><path class="c-ball-path${wobbly ? ' is-loose' : ''}" d="${passPath}"/></g>`
      + `<g class="c-traj">${ZONES.map((z) => trajectory(z.id, 'traj')).join('')}</g>`
      + '<g class="c-best-traj"></g>'
      + ball;

    // ⚠️⚠️ LE PIÈGE QUI RENDAIT TOUTE L'INTRO INVISIBLE.
    //
    // En SMIL, `begin="1.3s"` se compte sur la timeline du DOCUMENT, pas depuis
    // l'insertion de l'élément. Or quand une manche démarre, la page vit déjà
    // depuis un moment (accueil, salon, manches précédentes) : tous les `begin`
    // sont donc DÉJÀ PASSÉS, et chaque animation est figée sur son état final à
    // la milliseconde où on l'insère. Le service, la réception, le passeur qui
    // monte, le bloc qui se replace : rien ne jouait jamais.
    //
    // On remet donc la timeline du SVG à zéro à chaque manche. C'est la seule
    // animation de ce SVG, donc il n'y a rien d'autre à préserver.
    if (animate && typeof svg.setCurrentTime === 'function') {
      try { svg.setCurrentTime(0); } catch (_) { /* pas de timeline : tant pis */ }
    }
  }

  // Dessine la scène et branche les cinq zones. `onPick(passId)` est appelé au
  // clic, au tactile, à Entrée/Espace et aux touches 1 à 5 — mais seulement
  // après `arm()`, c'est-à-dire après le « à toi » du serveur.
  function render(svg, scene, opts) {
    const o = opts || {};
    const scn = scene || fallbackScene();
    // On n'anime que si on joue ET si le mouvement est autorisé. En mouvement
    // réduit, l'état final est dessiné tout de suite : rien n'est perdu, la
    // situation est entièrement lisible.
    const animate = o.animate !== false && !!o.interactive && !reducedMotion();
    paint(svg, scn, Object.assign({}, o, { animate }));

    if (o.describeInto) o.describeInto.textContent = describe(scn);
    if (!o.interactive) {
      return { zones: [], arm() {}, lock() {}, isArmed() { return false; },
        pickByKey() { return false; } };
    }

    // Tant que la mise en situation n'est pas finie, on REGARDE. Les zones sont
    // déjà là et tabulables — pour ne pas faire sauter le focus au moment du
    // « go » — mais elles ne se jouent pas.
    svg.dataset.armed = '0';
    const groups = [...svg.querySelectorAll('.zone')];
    const trajFor = (id) => svg.querySelector(`.c-traj .traj[data-for="${id}"]`);
    const playable = (g) => !g.classList.contains('is-illegal');
    const live = () => svg.dataset.armed === '1' && svg.dataset.locked !== '1';

    const hint = (id, on) => {
      const p = trajFor(id);
      if (p) p.classList.toggle('is-on', on);
    };

    const pick = (el) => {
      if (!live() || !playable(el)) return;
      const id = el.dataset.pass;
      groups.forEach((g) => {
        const on = g === el;
        g.classList.toggle('is-picked', on);
        g.setAttribute('aria-pressed', String(on));
        hint(g.dataset.pass, on);
      });
      svg.dataset.locked = '1';
      if (o.onPick) o.onPick(id);
    };

    groups.forEach((g) => {
      const id = g.dataset.pass;
      g.addEventListener('click', () => pick(g));
      g.addEventListener('mouseenter', () => { if (live() && playable(g)) hint(id, true); });
      g.addEventListener('mouseleave', () => { if (!g.classList.contains('is-picked')) hint(id, false); });
      g.addEventListener('focus', () => { if (live() && playable(g)) hint(id, true); });
      g.addEventListener('blur', () => { if (!g.classList.contains('is-picked')) hint(id, false); });
      g.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); pick(g); }
      });
    });

    return {
      zones: groups,
      // « À TOI » : c'est le serveur qui l'ordonne, jamais la fin de l'animation
      // locale. Sinon celui dont l'onglet a ramé jouerait plus longtemps.
      arm() { svg.dataset.armed = '1'; svg.classList.add('is-armed'); },
      isArmed() { return svg.dataset.armed === '1'; },
      // Les raccourcis 1 à 5 restent le chemin le plus rapide, et le chiffre
      // est écrit en grand dans chaque zone pour ne pas avoir à le deviner.
      pickByKey(k) {
        const z = ZONES.find((x) => x.key === k);
        const g = z && groups.find((x) => x.dataset.pass === z.id);
        if (g) pick(g);
        return !!(g && playable(g));
      },
      lock() { svg.dataset.locked = '1'; },
    };
  }

  // Un terrain neutre, si jamais la manche arrive sans scène (serveur pas
  // encore redéployé). Le jeu reste jouable : les cinq zones sont là, c'est le
  // décor qui est générique — et le texte de la situation, lui, s'affiche
  // toujours au-dessus.
  function fallbackScene() {
    const opt = (by, pos, front) => ({ by, pos, front, legal: true, why: null, state: 'ready' });
    return {
      lineup: ['setter', 'mb1', 'oh1', 'opp', 'mb2', 'oh2'],
      rotation: 0,
      setter: { pos: 1, front: false },
      serve: 'center',
      reception: { by: 'oh2', pos: 6, quality: 'ok' },
      block: { count: 2, start: 'spread', target: 'spread', late: false },
      options: {
        gauche: opt('oh1', 3, true), courte: opt('mb1', 2, true),
        deuxieme: opt('setter', 1, false), droite: opt('opp', 4, true),
        arriere: opt('oh2', 6, false),
      },
      introMs: 2400,
    };
  }

  // Le terrain des résultats : figé, avec le choix du joueur et le meilleur
  // choix. Les deux sont marqués par une FORME différente (coche pointillée vs
  // cadre plein), et les deux trajectoires sont tracées — c'est ce qui rend la
  // décision lisible d'un coup d'œil.
  function renderResult(svg, scene, chosen, best) {
    render(svg, scene, { interactive: false });
    svg.querySelectorAll('.zone').forEach((g) => {
      const id = g.dataset.pass;
      if (id === chosen) g.classList.add('is-chosen');
      if (id === best) g.classList.add('is-best');
    });
    const holder = svg.querySelector('.c-best-traj');
    if (holder) {
      let out = '';
      if (chosen && chosen !== best) out += trajectory(chosen, 'traj traj-chosen is-on');
      if (best) out += trajectory(best, 'traj traj-best is-on');
      holder.innerHTML = out;
    }
    const label = (id) => (ZONES.find((z) => z.id === id) || {}).label || id;
    return { chosenLabel: label(chosen), bestLabel: label(best) };
  }

  root.Court = { render, renderResult, describe, ZONES, fallbackScene };
})(window);
