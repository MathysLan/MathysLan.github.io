// Contrat « score de soirée » des neuf jeux, vérifié STATIQUEMENT : aucun
// navigateur, aucun serveur. C'est le garde-fou rapide ; les vraies parties
// sont jouées par tests/hub-score-*.mjs.
//
//   node tests/hub-score-contract.mjs
//
// Le contrat (CLAUDE.md, « Le contrat commun, référence ») :
//   roomReady(code, gamePlayerId)   chacun SA place de jeu, jamais l'id du Hub
//   results([{ gamePlayerId, rank, points }])   une fois, depuis l'hôte
//   ended()                          toujours APRÈS results
//
// Ce qui est vérifié, par jeu :
//   - la page charge hub-handoff.js et son script de jeu ;
//   - roomReady reçoit DEUX arguments, dont la place attendue pour ce jeu ;
//   - un seul appel à results, gardé par `lien.results`, suivi de ended dans
//     le même chemin de fin (Morpion : via finie()) ;
//   - le helper de classement, EXTRAIT de la page et EXÉCUTÉ ici : forme des
//     lignes, rangs de compétition (ex æquo = même rang), points = score du
//     jeu (0 pour le Morpion) ;
// et pour le module partagé : results une seule fois, ended le consomme,
// failed() ne rouvre pas d'essai pendant la partie.
//
// ⚠️ Les écarts de forme sont voulus et décrits ci-dessous (PLACES, FIN) : le
// test suit le contrat fonctionnel, pas une syntaxe unique.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lire = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let ok = 0, ko = 0;
const t = (nom, cond, detail = '') => {
  if (cond) ok++; else ko++;
  console.log(`${cond ? 'OK  ' : 'KO  '} ${nom}${detail ? ' — ' + detail : ''}`);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Les neuf jeux du Hub : fichier du raccord, expression de SA place, helper de fin.
//   `place`  : ce que le jeu passe en second argument de roomReady ;
//   `helper` : la fonction qui construit le classement envoyé à results ;
//   `source` : le champ du message de fin qui porte le classement ;
//   `garde`  : (facultatif) la garde de results quand elle diffère de
//              `if (lien.results` — Croq.ios ne classe qu'une partie COMPLÈTE.
const JEUX = [
  { id: 'passeur',    fichier: 'games/passeur/app.js',    place: 'msg.id',    helper: 'rangs',      source: 'msg.ranking' },
  { id: 'imitation',  fichier: 'games/imitation/app.js',  place: 'msg.you',   helper: 'rangs',      source: 'msg.podium' },
  { id: 'demicercle', fichier: 'games/demicercle/app.js', place: 'msg.you',   helper: 'rangs',      source: 'msg.podium' },
  { id: 'ban',        fichier: 'games/ban/app.js',        place: 'msg.you',   helper: 'rangs',      source: 'msg.podium' },
  { id: 'precision',  fichier: 'games/precision/app.js',  place: 'msg.you',   helper: 'rangs',      source: 'msg.podium' },
  { id: 'quiment',    fichier: 'games/quiment/app.js',    place: 'msg.id',    helper: 'rangs',      source: 'msg.ranking' },
  { id: 'morpion',    fichier: 'games/morpion/net.js',    place: 'state.you', helper: 'classement', source: 'state.winner' },
  { id: 'roquette',   fichier: 'games/roquette/app.js',   place: 'm.id',      helper: 'rangs',      source: 'm.ranking' },
  { id: 'croquis',    fichier: 'games/croquis/jeu.js',    place: 'm.id',      helper: 'rangs',      source: 'm.ranking',
    garde: /if \(m\.complete && lien\.results\b/ },
];

// Extrait `function nom(...) { ... }` par comptage d'accolades (pas de regex
// sur le corps : il peut changer de forme sans changer de sens).
function extraire(code, nom) {
  const i = code.indexOf(`function ${nom}(`);
  if (i < 0) return null;
  let j = code.indexOf('{', i), prof = 0;
  for (; j < code.length; j++) {
    if (code[j] === '{') prof++;
    else if (code[j] === '}' && --prof === 0) return code.slice(i, j + 1);
  }
  return null;
}
// Tous les appels `lien.<m>(` avec leurs arguments (parenthèses équilibrées).
function appels(code, m) {
  const out = [];
  let i = -1;
  while ((i = code.indexOf(`lien.${m}(`, i + 1)) >= 0) {
    let j = i + m.length + 6, prof = 1;
    for (; j < code.length && prof; j++) { if (code[j] === '(') prof++; else if (code[j] === ')') prof--; }
    out.push({ at: i, args: code.slice(i + m.length + 6, j - 1) });
  }
  return out;
}
// Découpe au premier niveau de virgule.
const args = (s) => { const a = []; let p = 0, cur = ''; for (const c of s) { if (c === ',' && !p) { a.push(cur.trim()); cur = ''; continue; } if ('([{'.includes(c)) p++; if (')]}'.includes(c)) p--; cur += c; } if (cur.trim()) a.push(cur.trim()); return a; };

const manifest = JSON.parse(lire('data/games.manifest.json'));

// Faux Témoin est tenu HORS du Hub (hub: false) pendant la refonte de son
// gameplay : il ne doit pas entrer au manifest.
t('temoin : hors du Hub pendant la refonte (absent du manifest)', !manifest.games.some((g) => g.id === 'temoin'));

for (const J of JEUX) {
  console.log(`\n— ${J.id}`);
  const code = lire(J.fichier).replace(/\r\n/g, '\n');
  const page = lire(`games/${J.id}/index.html`);
  const script = path.basename(J.fichier);

  // Le montage
  const g = manifest.games.find((x) => x.id === J.id);
  t(`${J.id} : handoff: true dans le manifest`, !!g && g.handoff === true);
  t(`${J.id} : la page charge hub-handoff.js puis ${script}`,
    /shared\/hub-handoff\.js/.test(page) && page.indexOf('hub-handoff.js') < page.search(new RegExp(`src="${script.replace('.', '\\.')}`)));
  t(`${J.id} : HubHandoff.start({ gameId: '${J.id}' })`, new RegExp(`HubHandoff\\.start\\(\\{[\\s\\S]{0,40}gameId:\\s*'${J.id}'`).test(code));

  // roomReady : deux arguments, le second = SA place de jeu
  const rr = appels(code, 'roomReady').map((c) => args(c.args));
  t(`${J.id} : roomReady(code, ${J.place})`, rr.length >= 1 && rr.every((a) => a.length === 2 && a[1] === J.place), JSON.stringify(rr));
  t(`${J.id} : jamais l'id du Hub en place`, rr.every((a) => !/GameProfile|playerId|profil/i.test(a.join(','))));

  // results : un seul appel, gardé, sur le classement du serveur, puis ended
  const rs = appels(code, 'results');
  t(`${J.id} : un seul appel à lien.results`, rs.length === 1, `${rs.length} appel(s)`);
  if (rs.length === 1) {
    const r = rs[0];
    t(`${J.id} : results(${J.helper}(${J.source}))`, r.args.replace(/\s/g, '') === `${J.helper}(${J.source})`, r.args);
    t(`${J.id} : gardé par \`if (${J.garde ? 'm.complete && ' : ''}lien.results …)\` (hub-handoff.js en cache)`,
      (J.garde || /if \(lien\.results\b/).test(code.slice(Math.max(0, r.at - 120), r.at)));
    // La suite immédiate du chemin de fin : ended() (Morpion : finie(), qui l'appelle).
    const apres = code.slice(r.at, r.at + 400);
    const iEnded = J.id === 'morpion' ? apres.indexOf('finie()') : apres.indexOf('lien.ended()');
    t(`${J.id} : ended APRÈS results, dans le même chemin de fin`, iEnded > 0 && !/lien\.(results|roomReady)\(/.test(apres.slice(1, iEnded)), iEnded < 0 ? 'ended introuvable' : '');
    const avant = appels(code, 'ended').filter((c) => c.at < r.at && r.at - c.at < 400);
    t(`${J.id} : aucun ended juste AVANT results`, avant.length === 0);
  }

  // Le helper, exécuté
  const src = extraire(code, J.helper);
  t(`${J.id} : helper ${J.helper}() présent`, !!src);
  if (!src) continue;
  const f = new Function(`${src}; return ${J.helper};`)();
  const cles = ['gamePlayerId', 'points', 'rank'];
  if (J.id === 'morpion') {
    const v = { X: f('X'), O: f('O'), draw: f('draw') };
    const r = (w) => Object.fromEntries(v[w].map((l) => [l.gamePlayerId, l.rank]));
    t('morpion : victoire X → X 1 / O 2', same(r('X'), { X: 1, O: 2 }));
    t('morpion : victoire O → X 2 / O 1', same(r('O'), { X: 2, O: 1 }));
    t('morpion : égalité → 1 / 1 (ex æquo)', same(r('draw'), { X: 1, O: 1 }));
    t('morpion : points du jeu = 0, lignes { gamePlayerId, rank, points }', Object.values(v).flat().every((l) => l.points === 0 && same(Object.keys(l).sort(), cles)));
    // Abandon : le seul chemin qui mène à ended sans état `over` ne touche pas à results.
    const erreur = code.slice(code.indexOf("NET.on('error'"), code.indexOf("NET.on('lost'"));
    t('morpion : abandon (« adversaire est parti ») → finie() sans results', /adversaire est parti/.test(erreur) && /finie\(\)/.test(erreur) && !/results/.test(erreur));
    t('morpion : results seulement sur un vainqueur connu (X, O, draw)', /\[\s*'X',\s*'O',\s*'draw'\s*\]\.includes\(state\.winner\)/.test(code));
    continue;
  }
  if (J.id === 'croquis') {
    // Croq.ios : le SERVEUR envoie rang (ex æquo compris) et score ; le helper
    // recopie les deux, sans rien recalculer (points = score de la partie).
    const C = (l) => f(l.map(([rank, score], i) => ({ id: 'c' + i, name: 'n' + i, avatar: '🙂', rank, score, found: 1, drawn: 1, left: false })));
    const parPlace = (l) => Object.fromEntries(l.map((x) => [x.gamePlayerId, [x.rank, x.points]]).sort());
    t('croquis : rangs ET scores du serveur recopiés (2/150, 1/300, 3/90 → tels quels)', same(parPlace(C([[2, 150], [1, 300], [3, 90]])), { c0: [2, 150], c1: [1, 300], c2: [3, 90] }));
    t('croquis : ex æquo du serveur gardé (1 / 1 / 3, 0 point à deux)', same(parPlace(C([[1, 0], [1, 0], [3, 0]])), { c0: [1, 0], c1: [1, 0], c2: [3, 0] }));
    t('croquis : lignes { gamePlayerId, rank, points }, rien d\'autre', C([[1, 10], [2, 5]]).every((l) => same(Object.keys(l).sort(), cles)));
    // Partie interrompue (pas assez de joueurs) : ended() seul, comme l'abandon du Morpion.
    const finC = code.slice(code.indexOf("NET.on('results'"), code.indexOf('function rangs('));
    t('croquis : partie interrompue → pas de results, mais ended() quand même (hors de la garde)',
      /if \(m\.complete && lien\.results\) lien\.results\(/.test(finC) && /\n\s*lien\.ended\(\);/.test(finC));
    // Le contrat Hub de Croq.ios, au manifest (généré depuis data/games.js).
    t('croquis : manifest — en ligne, 2 à 16 joueurs, 5 à 18 min', !!g && g.mode === 'online' && same(g.players, { min: 2, max: 16 }) && same(g.minutes, { min: 5, max: 18 }));
    t('croquis : manifest — serveur et santé sur Render', !!g && g.server === 'wss://croquis-server.onrender.com' && g.health === 'https://croquis-server.onrender.com/');
    t('croquis : manifest — join v1, content false, replay true, handoff true', !!g && g.join === 'v1' && g.content === false && g.replay === true && g.handoff === true);
    t('croquis : manifest — catégories creatif + ambiance, aucun besoin', !!g && same(g.categories, ['creatif', 'ambiance']) && same(g.needs, []));
    t('croquis : manifest — une seule entrée, URL games/croquis/, nom affiché Croq.ios',
      manifest.games.filter((x) => x.id === 'croquis').length === 1 && g.url === 'games/croquis/' && g.title === 'Croq.ios');
    continue;
  }
  if (J.id === 'roquette') {
    // Roquette ne compte pas de points : le SERVEUR envoie le rang (ordre
    // d'élimination). Le helper le recopie tel quel, sans le recalculer.
    const R = (rangs) => f(rangs.map((rank, i) => ({ id: 'r' + i, name: 'n' + i, avatar: '🙂', rank, lives: 0, words: 3 })));
    const parPlace = (l) => Object.fromEntries(l.map((x) => [x.gamePlayerId, x.rank]).sort());
    t('roquette : rangs du serveur recopiés (3 / 1 / 2 → 3 / 1 / 2, rien de recalculé)', same(parPlace(R([3, 1, 2])), { r0: 3, r1: 1, r2: 2 }));
    t('roquette : seul → rang 1', same(parPlace(R([1])), { r0: 1 }));
    t('roquette : points du jeu = 0, lignes { gamePlayerId, rank, points }', R([2, 1]).every((l) => l.points === 0 && same(Object.keys(l).sort(), cles)));
    continue;
  }
  const L = (scores) => scores.map((score, i) => ({ id: 'p' + i, name: 'n' + i, avatar: '🙂', score, avg: 1, title: 't' }));
  // Rangs par place, triés par place : un jeu peut réordonner ses lignes (Le
  // Passeur trie d'abord), seul le rang de chaque place compte.
  const rangs = (scores) => Object.fromEntries(f(L(scores)).map((l) => [l.gamePlayerId, l.rank]).sort());
  t(`${J.id} : 100 / 80 / 50 → 1 / 2 / 3`, same(rangs([100, 80, 50]), { p0: 1, p1: 2, p2: 3 }));
  t(`${J.id} : 13 / 13 / 5 → 1 / 1 / 3 (ex æquo)`, same(rangs([13, 13, 5]), { p0: 1, p1: 1, p2: 3 }));
  t(`${J.id} : 50 / 20 / 50 (non trié) → 1 / 3 / 1 — le rang vient du score, pas de l'index`, same(rangs([50, 20, 50]), { p0: 1, p1: 3, p2: 1 }));
  t(`${J.id} : 0 / 0 / −1 (points négatifs) → 1 / 1 / 3`, same(rangs([0, 0, -1]), { p0: 1, p1: 1, p2: 3 }));
  t(`${J.id} : seul → rang 1`, same(rangs([42]), { p0: 1 }));
  const lignes = f(L([7, 3]));
  t(`${J.id} : lignes { gamePlayerId, rank, points = score }, ni avg ni title`,
    lignes.every((l) => same(Object.keys(l).sort(), cles)) && same(lignes.map((l) => [l.gamePlayerId, l.points]).sort(), [['p0', 7], ['p1', 3]]));
}

// ── le module partagé
console.log('\n— games/shared/hub-handoff.js');
const hh = lire('games/shared/hub-handoff.js').replace(/\r\n/g, '\n');
const bloc = (nom) => { const i = hh.indexOf(`${nom}: function`); return i < 0 ? '' : hh.slice(i, hh.indexOf('\n      },', i)); };
t('results : une seule fois, et plus après ended (`rapporte || fini`)', /if \(rapporte \|\| fini\) return false/.test(bloc('results')));
t('results : seulement l\'hôte du lancement, sur le bon tirage', /l\.hostId !== t\.playerId/.test(bloc('results')) && /l\.drawId !== t\.drawId/.test(bloc('results')));
t('ended : une seule fois, et consomme le billet', /if \(fini\) return/.test(bloc('ended')) && /fini = true/.test(bloc('ended')) && /clear\(\)/.test(bloc('ended')));
t('roomReady : transmet la place au Hub (launched / entered)', /hub\.launched\(t\.drawId, code, place\)/.test(bloc('roomReady')) && /hub\.entered\(t\.drawId, code, place\)/.test(bloc('roomReady')));
t('failed : pas de nouvel essai pendant la partie (`stage !== \'playing\'`)', /if \(!l \|\| l\.stage !== 'playing'\) joint = false/.test(bloc('failed')));
t('les neuf pages chargent la même version de hub-handoff.js',
  new Set(JEUX.map((J) => (lire(`games/${J.id}/index.html`).match(/src="[^"]*hub-handoff\.js(\?v=\d+)?"/) || ['?'])[0])).size === 1);

console.log(`\n${ko ? 'DES TESTS ÉCHOUENT' : 'TOUT PASSE'} — ${ok + ko} vérifications, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
