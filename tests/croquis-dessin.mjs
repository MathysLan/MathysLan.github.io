// Croquis — le module de dessin (games/croquis/dessin.js), sans navigateur.
//
//   node tests/croquis-dessin.mjs
//
// Conversion écran ↔ logique, bornes 0..1000 / 0..750, redimensionnement sans
// déplacement, index de palette et de taille (ceux du protocole de
// croquis-server), historique (annuler, effacer), limites (150 traits,
// 1 000 points), et la règle de lissage partagée par l'auteur et les devineurs.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const D = require('../games/croquis/dessin.js');

let ok = 0, ko = 0;
const t = (name, cond, detail) => {
  if (cond) { ok++; console.log('OK   ' + name); }
  else { ko++; console.log('KO   ' + name + (detail ? ' — ' + detail : '')); }
};
const rect = (left, top, width) => ({ left, top, width, height: width * 3 / 4 });

// ============================================================ conversion
{
  const r = rect(10, 20, 400);         // 400 × 300 à l'écran
  t('coin haut-gauche → (0, 0)', JSON.stringify(D.versLogique(10, 20, r)) === '{"x":0,"y":0}');
  t('coin bas-droit → (1000, 750)', JSON.stringify(D.versLogique(410, 320, r)) === '{"x":1000,"y":750}');
  t('centre → (500, 375)', JSON.stringify(D.versLogique(210, 170, r)) === '{"x":500,"y":375}');
  t('coordonnées entières (arrondi au plus proche)', JSON.stringify(D.versLogique(10 + 0.21, 20 + 0.21, r)) === '{"x":1,"y":1}');
  const e = D.versEcran(250, 600, r);
  t('logique → écran', e.x === 10 + 100 && e.y === 20 + 240);
  let pire = 0;
  for (let x = 0; x <= 1000; x += 37) for (let y = 0; y <= 750; y += 29) {
    const s = D.versEcran(x, y, r);
    const l = D.versLogique(s.x, s.y, r);
    pire = Math.max(pire, Math.abs(l.x - x), Math.abs(l.y - y));
  }
  t('aller-retour logique → écran → logique : exact sur toute la feuille', pire === 0);
  // Sous le doigt : l'écart écran entre le doigt et le point tracé ne dépasse
  // pas un demi-pas logique (≤ 0,2 px à 390 px de large).
  let ecart = 0;
  const tel = rect(12, 80, 366);
  for (let k = 0; k < 500; k++) {
    const cx = 12 + Math.random() * 366, cy = 80 + Math.random() * 274.5;
    const l = D.versLogique(cx, cy, tel);
    const s = D.versEcran(l.x, l.y, tel);
    ecart = Math.max(ecart, Math.hypot(s.x - cx, s.y - cy));
  }
  t(`pas de décalage sous le doigt : au pire ${ecart.toFixed(3)} px à 366 px de large`, ecart <= 0.5 * Math.SQRT2 * 366 / 1000 + 1e-9);
}

// ================================================================ bornes
{
  const r = rect(0, 0, 400);
  const hors = [[-50, -50], [9999, 9999], [-1, 150], [450, 150], [200, -3], [200, 400]];
  t('hors de la feuille : ramené dans 0..1000 × 0..750', hors.every(([x, y]) => {
    const l = D.versLogique(x, y, r);
    return l.x >= 0 && l.x <= 1000 && l.y >= 0 && l.y <= 750 && Number.isInteger(l.x) && Number.isInteger(l.y);
  }));
  t('sorti à gauche → x = 0, sorti en bas → y = 750', D.versLogique(-10, 100, r).x === 0 && D.versLogique(100, 999, r).y === 750);
  t('les quatre bords exacts restent atteignables', D.versLogique(0, 0, r).x === 0 && D.versLogique(400, 300, r).x === 1000 && D.versLogique(400, 300, r).y === 750);
}

// ================================================= resize sans déplacement
{
  // Le MÊME geste (mêmes fractions de la feuille) à trois tailles d'écran
  // donne les mêmes points logiques : le dessin ne dépend pas de la taille.
  const fractions = [[0.1, 0.2], [0.5, 0.5], [0.93, 0.07], [1, 1], [0, 0.66]];
  const aTaille = (w) => fractions.map(([fx, fy]) => { const r = rect(30, 40, w); return D.versLogique(30 + fx * r.width, 40 + fy * r.height, r); });
  const a = JSON.stringify(aTaille(366)), b = JSON.stringify(aTaille(900)), c = JSON.stringify(aTaille(1180));
  t('même geste à 366, 900 et 1180 px → mêmes points logiques', a === b && b === c);
  // Retracé à une autre taille : la matrice ne fait que changer d'échelle, le
  // point logique (500, 375) tombe toujours au centre des pixels.
  for (const [L, H] of [[732, 549], [1800, 1350], [640, 480]]) {
    const [sx, , , sy] = D.matrice(L, H);
    t(`matrice ${L} × ${H} : (500, 375) au centre, (1000, 750) au coin, même échelle en x et y`,
      500 * sx === L / 2 && 375 * sy === H / 2 && 1000 * sx === L && 750 * sy === H && Math.abs(sx - sy) < 1e-9);
  }
}

// ======================================================= palette et taille
t('12 couleurs, gomme = 12, 3 tailles', D.PALETTE.length === 12 && D.GOMME === 12 && D.TAILLES.length === 3);
t('palette : l ordre du protocole (noir 0, blanc 2, rouge 3, marron 11)',
  D.PALETTE[0].nom === 'noir' && D.PALETTE[2].nom === 'blanc' && D.PALETTE[3].nom === 'rouge' && D.PALETTE[11].nom === 'marron');
t('chaque couleur choisie → son index', D.PALETTE.every((_, i) => D.encre({ couleur: i, taille: 1, gomme: false }).c === i));
t('chaque taille choisie → son index', [0, 1, 2].every((w) => D.encre({ couleur: 3, taille: w, gomme: false }).w === w));
t('gomme → c = 12, la taille est gardée', JSON.stringify(D.encre({ couleur: 5, taille: 2, gomme: true })) === '{"c":12,"w":2}');
t('valeurs hors protocole ramenées (jamais un index que le serveur refuserait)',
  [[-1, 9], [99, -4], [2.5, 1.5], ['3', null]].every(([c, w]) => { const e = D.encre({ couleur: c, taille: w }); return e.c >= 0 && e.c <= 11 && e.w >= 0 && e.w <= 2; }));
t('gomme = couleur du fond (blanc cassé), différente du blanc', D.hexDe(12) === D.FOND && D.FOND !== D.PALETTE[2].hex);
t('épaisseurs croissantes, en unités logiques', D.largeurDe(0) < D.largeurDe(1) && D.largeurDe(1) < D.largeurDe(2));

// ================================================================ historique
{
  const d = D.creerDessin();
  const t1 = d.commencer(0, 1, 10, 10);
  t('un trait a la forme d un message stroke : { s, c, w, p }', Object.keys(t1).join() === 's,c,w,p' && t1.s === 1 && t1.p.join() === '10,10');
  t('point trop proche (< 2) : ignoré', d.prolonger(11, 10) === 'ignore' && t1.p.length === 2);
  t('point assez loin : ajouté', d.prolonger(12, 10) === 'ajoute' && t1.p.join() === '10,10,12,10');
  d.finir();
  t('après finir : plus de trait en cours, prolonger ignoré', d.ouvert === null && d.prolonger(50, 50) === 'ignore');
  const t2 = d.commencer(3, 0, 100, 100); d.prolonger(200, 200); d.finir();
  const t3 = d.commencer(12, 2, 300, 300); d.finir();
  t('ids croissants', t2.s === 2 && t3.s === 3);
  t('annuler retire le DERNIER trait', d.annuler() === t3 && d.traits.map((x) => x.s).join() === '1,2');
  t('annuler encore', d.annuler() === t2 && d.traits.map((x) => x.s).join() === '1');
  const t4 = d.commencer(4, 1, 5, 5);
  t('un nouveau trait après annulation ne réutilise pas d id', t4.s === 4);
  t('annuler pendant le trait : il est retiré ET n est plus en cours', d.annuler() === t4 && d.ouvert === null && d.prolonger(60, 60) === 'ignore');
  t('annuler jusqu au bout puis sur une feuille vide : null', d.annuler() === t1 && d.annuler() === null && d.traits.length === 0);
  d.commencer(0, 0, 1, 1); d.finir(); d.commencer(0, 0, 2, 2);
  t('effacer : tout, trait en cours compris', d.effacer() === 2 && d.traits.length === 0 && d.ouvert === null);
  t('effacer n est pas annulable', d.annuler() === null);
  t('commencer ferme le trait précédent laissé ouvert', (() => { const a = d.commencer(0, 0, 0, 0); d.commencer(0, 0, 9, 9); return d.ouvert !== a && d.traits.length === 2; })());
}

// ================================================================== limites
{
  const d = D.creerDessin();
  for (let i = 0; i < D.MAX_TRAITS; i++) { d.commencer(0, 0, i, i); d.finir(); }
  t('150 traits acceptés', d.traits.length === 150 && d.plein());
  t('le 151e : refusé (null), rien d ajouté', d.commencer(0, 0, 1, 1) === null && d.traits.length === 150);
  d.annuler();
  t('annuler libère une place', !d.plein() && d.commencer(0, 0, 1, 1) !== null && d.plein());
  d.effacer();
  t('effacer remet la capacité entière', !d.plein() && d.traits.length === 0);
}
{
  const d = D.creerDessin();
  const premier = d.commencer(1, 1, 0, 0);
  let x = 0, coupe = null;
  while (!coupe) { x += 3; const r = d.prolonger(x % 1000, Math.floor(x / 1000) * 3); if (r === 'coupe') coupe = d.ouvert; }
  t('un trait s arrête à 1 000 points', premier.p.length / 2 === D.MAX_POINTS_TRAIT);
  t('… et repart en un nouveau trait, même encre, depuis son dernier point',
    coupe !== premier && coupe.c === 1 && coupe.w === 1 && coupe.p[0] === premier.p[premier.p.length - 2] && coupe.p.length === 4);
}
{
  const d = D.creerDessin();
  for (let i = 0; i < D.MAX_TRAITS - 1; i++) { d.commencer(0, 0, i, i); d.finir(); }
  const dernier = d.commencer(0, 0, 0, 0);
  let r = 'ajoute', x = 0;
  while (r === 'ajoute' || r === 'ignore') { x += 3; r = d.prolonger(x % 1000, Math.floor(x / 1000) * 3); }
  t('feuille pleine en plein trait : « plein », le trait est clos à 1 000 points', r === 'plein' && d.ouvert === null
    && dernier.p.length / 2 === D.MAX_POINTS_TRAIT && d.traits.length === D.MAX_TRAITS);
}

// ================================================================== lissage
{
  t('1 point → un disque', JSON.stringify(D.commandes({ p: [5, 6] })) === '[["point",5,6]]');
  t('2 points → un segment', JSON.stringify(D.commandes({ p: [0, 0, 10, 10] })) === '[["M",0,0],["L",10,10]]');
  const c = D.commandes({ p: [0, 0, 10, 0, 10, 10, 20, 10] });
  t('n points → courbes par les milieux, extrémités exactes',
    JSON.stringify(c) === '[["M",0,0],["Q",10,0,10,5],["Q",10,10,15,10],["L",20,10]]');
  // Le tracé ne sort jamais de la feuille : tous les points de contrôle et
  // d'arrivée sont dans l'enveloppe des points du trait, donc dans 0..1000 × 0..750.
  const bord = { p: [0, 0, 1000, 0, 1000, 750, 0, 750, 0, 0] };
  t('lissage : aucun point de commande hors 0..1000 × 0..750',
    D.commandes(bord).every((cmd) => cmd.slice(1).every((v, i) => v >= 0 && v <= (i % 2 ? 750 : 1000))));
  // tracer() sur un faux contexte : ce qui est appelé, avec quelles valeurs.
  const appels = [];
  const ctx = new Proxy({}, { get: (_, k) => (k in ctx2 ? ctx2[k] : (...a) => appels.push([k, ...a])), set: (_, k, v) => { appels.push(['=' + k, v]); return true; } });
  const ctx2 = {};
  D.tracer(ctx, { c: 3, w: 2, p: [0, 0, 10, 0, 10, 10] });
  const affect = Object.fromEntries(appels.filter((a) => a[0][0] === '=').map((a) => [a[0].slice(1), a[1]]));
  t('tracer : couleur et épaisseur du protocole, bouts et jointures ronds',
    affect.strokeStyle === D.PALETTE[3].hex && affect.lineWidth === D.TAILLES[2].largeur && affect.lineCap === 'round' && affect.lineJoin === 'round');
  t('tracer : moveTo, quadraticCurveTo, lineTo, stroke', appels.filter((a) => a[0][0] !== '=').map((a) => a[0]).join() === 'beginPath,moveTo,quadraticCurveTo,lineTo,stroke');
}

console.log(`\n${ok} OK, ${ko} KO`);
process.exit(ko ? 1 : 0);
