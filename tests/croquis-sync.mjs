// Croquis — la synchronisation du dessin (games/croquis/sync.js), sans
// navigateur ni serveur.
//
//   node tests/croquis-sync.mjs
//
// L'envoi : le format EXACT des messages de croquis-server (turnId, s, c, w,
// p, end), les lots, l'ordre undo / clear. La réception : traits distants,
// doublons, ancien turnId, undo par id, clear, snapshot qui remplace tout,
// nouveau tour qui vide. Puis un aller-retour complet : ce que l'auteur envoie,
// rejoué chez un autre, redonne exactement le même dessin.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const D = require('../games/croquis/dessin.js');
const S = require('../games/croquis/sync.js');

let ok = 0, ko = 0;
const t = (name, cond, detail) => {
  if (cond) { ok++; console.log('OK   ' + name); }
  else { ko++; console.log('KO   ' + name + (detail ? ' — ' + detail : '')); }
};
const json = (x) => JSON.stringify(x);

// Une minuterie à la main : on décide quand le lot part.
function horloge() {
  const file = [];
  return {
    planifier: (f) => { file.push(f); return file.length; },
    deplanifier: (h) => { file[h - 1] = null; },
    tourner: () => { const fs = file.splice(0); fs.forEach((f) => f && f()); },
  };
}
function envoi() {
  const h = horloge();
  const sortis = [];
  const e = S.creerEnvoi({ envoyer: (m) => sortis.push(JSON.parse(JSON.stringify(m))), planifier: h.planifier, deplanifier: h.deplanifier });
  return { e, h, sortis };
}

// ================================================================== envoi
{
  const { e, h, sortis } = envoi();
  const d = D.creerDessin();
  const tr = d.commencer(3, 2, 100, 200);
  e.commencer(7, tr);
  t('rien ne part avant le lot (le dessin local, lui, est déjà là)', sortis.length === 0 && tr.p.length === 2);
  h.tourner();
  t('1er lot : turnId, s, c, w, p — pas de end', json(sortis[0]) === json({ action: 'stroke', turnId: 7, s: tr.s, p: [100, 200], c: 3, w: 2 }));
  d.prolonger(110, 200); e.point(tr, 110, 200);
  d.prolonger(120, 205); e.point(tr, 120, 205);
  h.tourner();
  t('lot suivant : seulement s, p (l encre n est plus répétée)', json(sortis[1]) === json({ action: 'stroke', turnId: 7, s: tr.s, p: [110, 200, 120, 205] }));
  h.tourner();
  t('lot vide : rien ne part', sortis.length === 2);
  d.prolonger(130, 210); e.point(tr, 130, 210);
  d.finir(); e.finir(tr);
  t('fin : les points restants ET end:true, tout de suite', json(sortis[2]) === json({ action: 'stroke', turnId: 7, s: tr.s, p: [130, 210], end: true }));
  t('après la fin, plus rien en attente', !e.enAttente());
}
{
  const { e, h, sortis } = envoi();
  const d = D.creerDessin();
  const tr = d.commencer(0, 0, 0, 0);
  e.commencer(1, tr);
  for (let i = 1; i <= 150; i++) { d.prolonger(i * 3, 0); e.point(tr, i * 3, 0); }
  h.tourner();
  e.finir(tr);
  const pts = sortis.reduce((n, m) => n + m.p.length / 2, 0);
  t('un trait de 151 points : aucun message de plus de 64 points', sortis.every((m) => m.p.length <= 2 * S.LOT_MAX));
  t('… et tous les points partent, dans l ordre, une seule fois', pts === 151 && json(sortis.flatMap((m) => m.p)) === json(tr.p));
  t('… seul le dernier message porte end', sortis.filter((m) => m.end).length === 1 && sortis.at(-1).end === true);
}
{
  const { e, sortis } = envoi();
  const d = D.creerDessin();
  const tr = d.commencer(1, 1, 5, 5);
  e.commencer(2, tr);
  d.prolonger(9, 9); e.point(tr, 9, 9);
  d.annuler(); e.annuler(2);
  t('annuler en plein trait : le trait part D ABORD (sinon le serveur retirerait le précédent), puis undo',
    sortis.length === 2 && sortis[0].s === tr.s && sortis[0].c === 1 && sortis[1].action === 'undo' && sortis[1].turnId === 2);
  e.point(tr, 20, 20); e.finir(tr);
  t('… puis plus rien pour le trait retiré', sortis.length === 2);
}
{
  const { e, sortis } = envoi();
  const d = D.creerDessin();
  const tr = d.commencer(1, 1, 5, 5);
  e.commencer(2, tr);
  e.effacer(2);
  t('effacer : ce qui attend part d abord, puis clear', sortis.map((m) => m.action).join() === 'stroke,clear' && sortis[1].turnId === 2);
}
{
  const { e, h, sortis } = envoi();
  const d = D.creerDessin();
  e.commencer(4, d.commencer(1, 1, 5, 5));
  e.oublier();
  h.tourner();
  t('oublier (nouveau tour, snapshot) : rien ne part', sortis.length === 0 && !e.enAttente());
}
{
  const { e, h, sortis } = envoi();
  const d = D.creerDessin();
  const a = d.commencer(1, 1, 0, 0);
  e.commencer(5, a);
  const b = d.commencer(2, 2, 50, 50);     // un nouveau trait sans fin explicite du précédent
  e.commencer(5, b);
  h.tourner();
  t('nouveau trait : le précédent est clos (end) avant', sortis[0].s === a.s && sortis[0].end === true && sortis[1].s === b.s && sortis[1].c === 2);
}

// ============================================================== réception
const vue = () => ({ dessin: D.creerDessin(), turnId: null });
{
  const v = vue();
  t('turn : adopte le tour', S.recevoir(v, { type: 'turn', turnId: 3 }).quoi === 'tout' && v.turnId === 3);
  t('drawing du même tour : rien', S.recevoir(v, { type: 'drawing', turnId: 3 }).quoi === 'rien');
  const r1 = S.recevoir(v, { type: 'stroke', turnId: 3, s: 1, c: 4, w: 1, p: [10, 10, 20, 20], end: false });
  t('stroke : un nouveau trait, ouvert (tracé sur la couche vivante)', r1.quoi === 'trait' && !r1.fini && v.dessin.ouvert === r1.trait && json(r1.trait) === json({ s: 1, c: 4, w: 1, p: [10, 10, 20, 20] }));
  const r2 = S.recevoir(v, { type: 'stroke', turnId: 3, s: 1, c: 4, w: 1, p: [30, 30], end: true });
  t('stroke suite + end : points ajoutés, trait clos', r2.fini && v.dessin.ouvert === null && json(v.dessin.traits[0].p) === json([10, 10, 20, 20, 30, 30]));
  t('le même trait renvoyé (doublon) : ignoré', S.recevoir(v, { type: 'stroke', turnId: 3, s: 1, c: 4, w: 1, p: [99, 99], end: true }).quoi === 'rien'
    && v.dessin.traits.length === 1 && v.dessin.traits[0].p.length === 6);
  t('stroke d un ANCIEN turnId : ignoré', S.recevoir(v, { type: 'stroke', turnId: 2, s: 9, c: 0, w: 0, p: [1, 1], end: true }).quoi === 'rien' && v.dessin.traits.length === 1);
  t('stroke aux points illisibles : ignoré', S.recevoir(v, { type: 'stroke', turnId: 3, s: 8, c: 0, w: 0, p: [1, 'x'], end: true }).quoi === 'rien');
  S.recevoir(v, { type: 'stroke', turnId: 3, s: 2, c: 0, w: 0, p: [5, 5], end: false });
  const r3 = S.recevoir(v, { type: 'stroke', turnId: 3, s: 3, c: 1, w: 2, p: [7, 7], end: true });
  t('un nouveau trait clôt le précédent (rendu : il est posé)', r3.precedent && r3.precedent.s === 2 && v.dessin.ouvert === null && v.dessin.traits.length === 3);
  t('undo d un ancien turnId : ignoré', S.recevoir(v, { type: 'undo', turnId: 2, s: 3 }).quoi === 'rien' && v.dessin.traits.length === 3);
  t('undo : retire le trait désigné', S.recevoir(v, { type: 'undo', turnId: 3, s: 3 }).quoi === 'tout' && v.dessin.traits.map((x) => x.s).join() === '1,2');
  t('undo d un trait inconnu : rien', S.recevoir(v, { type: 'undo', turnId: 3, s: 42 }).quoi === 'rien' && v.dessin.traits.length === 2);
  t('clear d un ancien turnId : ignoré', S.recevoir(v, { type: 'clear', turnId: 1 }).quoi === 'rien' && v.dessin.traits.length === 2);
  t('clear : feuille vide', S.recevoir(v, { type: 'clear', turnId: 3 }).quoi === 'tout' && v.dessin.traits.length === 0);
  S.recevoir(v, { type: 'stroke', turnId: 3, s: 4, c: 0, w: 0, p: [5, 5], end: true });
  t('nouveau tour : la feuille repart de zéro', S.recevoir(v, { type: 'turn', turnId: 4 }).quoi === 'tout' && v.dessin.traits.length === 0 && v.turnId === 4);
  t('… et les traits du tour d avant n y entrent plus', S.recevoir(v, { type: 'stroke', turnId: 3, s: 5, c: 0, w: 0, p: [5, 5], end: true }).quoi === 'rien' && v.dessin.traits.length === 0);
}
{
  const v = vue();
  S.recevoir(v, { type: 'turn', turnId: 1 });
  S.recevoir(v, { type: 'stroke', turnId: 1, s: 1, c: 0, w: 0, p: [1, 1], end: true });
  const snap = { type: 'snapshot', turnId: 6, strokes: [{ s: 10, c: 2, w: 1, p: [1, 2, 3, 4], end: true }, { s: 11, c: 5, w: 0, p: [9, 9], end: false }] };
  t('snapshot : REMPLACE tout (tour, traits), le dernier trait encore ouvert reste ouvert', S.recevoir(v, snap).quoi === 'tout' && v.turnId === 6
    && json(v.dessin.traits) === json([{ s: 10, c: 2, w: 1, p: [1, 2, 3, 4] }, { s: 11, c: 5, w: 0, p: [9, 9] }]) && v.dessin.ouvert === v.dessin.traits[1]);
  S.recevoir(v, { type: 'stroke', turnId: 6, s: 11, c: 5, w: 0, p: [12, 12], end: true });
  t('… et sa suite arrive dessus', json(v.dessin.traits[1].p) === json([9, 9, 12, 12]) && v.dessin.ouvert === null);
  t('snapshot : la copie est indépendante du message', (snap.strokes[0].p.push(0, 0), v.dessin.traits[0].p.length === 4));
  t('snapshot : le prochain id local passe après ceux du serveur', v.dessin.prochainS >= 12);
  S.recevoir(v, { type: 'snapshot', turnId: 6, strokes: [] });
  t('snapshot vide : feuille vide', v.dessin.traits.length === 0 && v.dessin.ouvert === null);
}

// =========================================== aller-retour auteur → autre
{
  const { e, h, sortis } = envoi();
  const auteur = D.creerDessin();
  // Un dessin varié : traits longs, points, coupe à 1 000 points, annulation.
  const tracer = (c, w, pts) => { const tr = auteur.commencer(c, w, pts[0], pts[1]); e.commencer(9, tr);
    for (let i = 2; i < pts.length; i += 2) { const avant = auteur.ouvert; const r = auteur.prolonger(pts[i], pts[i + 1]);
      if (r === 'ajoute') e.point(avant, pts[i], pts[i + 1]); else if (r === 'coupe') { e.finir(avant); e.commencer(9, auteur.ouvert); }
      if (i % 20 === 0) h.tourner(); }
    const fin = auteur.ouvert; auteur.finir(); e.finir(fin); };
  tracer(0, 1, Array.from({ length: 80 }, (_, i) => (i % 2 ? 300 + Math.round(100 * Math.sin(i)) : i * 10)));
  tracer(3, 2, [500, 500]);
  tracer(5, 0, Array.from({ length: 2400 }, (_, i) => (i % 2 ? Math.floor(i / 2000) * 4 : (i * 3) % 1000)));
  tracer(12, 2, [100, 100, 200, 200, 300, 300]);
  auteur.annuler(); e.annuler(9);
  tracer(8, 1, [10, 700, 990, 10]);
  h.tourner();
  // Ce qui est parti, relayé comme le fait croquis-server (server.js) : un
  // `stroke` tel quel ; un `undo` retire le DERNIER trait de sa pile et relaie
  // son id `s` ; un `clear` vide la pile.
  const pile = [];
  const relais = (m) => {
    if (m.action === 'stroke') { if (!pile.includes(m.s)) pile.push(m.s); return { type: 'stroke', turnId: m.turnId, s: m.s, c: m.c, w: m.w, p: m.p, end: !!m.end }; }
    if (m.action === 'undo') return { type: 'undo', turnId: m.turnId, s: pile.pop() };
    pile.length = 0;
    return { type: 'clear', turnId: m.turnId };
  };
  const autre = vue();
  S.recevoir(autre, { type: 'turn', turnId: 9 });
  for (const m of sortis) S.recevoir(autre, relais(m));
  t(`aller-retour : ${sortis.length} messages, le dessin de l autre est IDENTIQUE à celui de l auteur (${auteur.traits.length} traits)`,
    json(autre.dessin.traits) === json(auteur.traits));
  t('aller-retour : rien ne reste ouvert chez l autre', autre.dessin.ouvert === null);
  t('aller-retour : chaque message respecte les bornes du serveur (≤ 64 points, entiers 0..1000 × 0..750, c 0..12, w 0..2)',
    sortis.filter((m) => m.action === 'stroke').every((m) => m.p.length <= 128 && m.p.every((v, i) => Number.isInteger(v) && v >= 0 && v <= (i % 2 ? 750 : 1000))
      && (m.c === undefined || (m.c >= 0 && m.c <= 12)) && (m.w === undefined || (m.w >= 0 && m.w <= 2))));
}

console.log(`\n${ok} OK, ${ko} KO`);
process.exit(ko ? 1 : 0);
