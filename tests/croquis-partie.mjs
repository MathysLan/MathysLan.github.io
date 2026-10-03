// Croquis — des PARTIES COMPLÈTES, dans de vrais navigateurs, contre le VRAI
// croquis-server (choix 1,5 s, dessin 7 s, révélation 1,5 s).
//
//   node tests/croquis-partie.mjs                  ~4 min
//   node tests/croquis-partie.mjs --shots <dossier>
//   node tests/croquis-partie.mjs --serveur C:\perso\croquis-server
//
// Deux onglets Edge — bureau (souris, clavier) et téléphone (doigt) — et des
// robots WebSocket. Un chef d'orchestre joue chaque tour selon un PLAN (qui
// devine, quand ; ou personne) et, après chaque tour, relit l'écran : la
// révélation (mot, motif, gain de chacun, nouveaux totaux) et le tableau
// doivent être EXACTEMENT les valeurs du `turn-end` du serveur ; à la fin,
// l'écran de classement doit être EXACTEMENT le `results`.
//   2 joueurs (égalité forcée : à deux, devineur et dessinateur marquent
//   pareil), revanche ; 3 joueurs / 3 manches (trouveurs à des temps
//   différents, un tour où personne ne trouve, ancien turnId) ; 5 joueurs /
//   2 manches (départ entre deux tours, dessinateur qui part, retour au
//   salon) ; 6 joueurs / 1 manche ; 16 joueurs ; partie incomplète.
import { compteur, sleep, arg, lancerServeur, lancerEdge, pageCroquis, robot, fin } from './croquis-harnais.mjs';

const t = compteur();
const SHOTS = arg('--shots');
const DRAW = 7000;
const { url } = await lancerServeur({ TEST_CHOOSE_MS: '1500', TEST_DRAW_MS: String(DRAW), TEST_PAUSE_MS: '200', TEST_REVEAL_MS: '1500' });
const { onglet } = await lancerEdge({ shots: SHOTS });
const PAGE = pageCroquis(url);
const A = await onglet('A', { w: 1100, h: 800, page: PAGE });
const B = await onglet('B', { w: 390, h: 844, mobile: true, page: PAGE });
const MEDAILLES = ['🥇', '🥈', '🥉'];
const place = (r) => (r <= 3 ? MEDAILLES[r - 1] : r + 'e');

// ------------------------------------------------------------- une partie
// Ouvre une room : A l'héberge, B la rejoint, puis `nbRobots` robots.
async function salle(nbRobots, prefixe) {
  await A.ouvrir(); await B.ouvrir();
  await A.ev('document.getElementById("name-input").value = ""; true');
  await A.taper('#name-input', 'Alice');
  await A.clic('#host');
  await A.until('/^[A-Z]{4}$/.test(document.getElementById("room-code").textContent)');
  const code = await A.texte('#room-code');
  await B.ev('document.getElementById("name-input").value = ""; true');
  await B.taper('#name-input', 'Bruno');
  await B.taper('#code-input', code);
  await B.clic('#join');
  const bots = Array.from({ length: nbRobots }, (_, i) => robot(url, `${prefixe}${i + 1}`, code));
  const n = 2 + nbRobots;
  await A.until(`document.querySelectorAll('#players li').length === ${n}`, 10000);
  const idA = (await A.recu('you')).at(-1).id, idB = (await B.recu('you')).at(-1).id;
  const g = { code, bots, pages: [A, B], id: new Map([[A, idA], [B, idB]]), parId: new Map([[idA, A], [idB, B]]), dernierTour: 0, fins: [], partis: new Set() };
  for (const b of bots) g.parId.set(b.id, b);
  g.nom = (id) => (id === idA ? 'Alice' : id === idB ? 'Bruno' : (bots.find((b) => b.id === id) || {}).nom);
  return g;
}
const estPage = (x) => x === A || x === B;
const filtreTour = (l, turnId) => l.filter((m) => m.turnId === turnId);

// Le tour suivant (turnId plus grand que le dernier vu), ou la fin.
async function prochain(g) {
  const temoin = g.pages.find((p) => !g.partis.has(p)) || A;
  await temoin.until(`window.__recu.some((m) => (m.type === 'turn' && m.turnId > ${g.dernierTour}) || m.type === 'results')`, 20000);
  const tr = (await temoin.recu('turn')).find((m) => m.turnId > g.dernierTour);
  if (!tr) return null;
  g.dernierTour = tr.turnId;
  return tr;
}

// Joue un tour selon le plan :
//   devineurs : [{ id, apresMs }] dans l'ordre (par défaut : tous, 150 ms d'écart) ;
//   personne : true → personne ne devine (fin au chrono) ;
//   avant(tr, mot) : appelé une fois le dessin commencé (départs…).
async function jouerTour(g, tr, plan = {}) {
  const D = g.parId.get(tr.drawer);
  // le choix : au clic (navigateur) ou par le protocole (robot)
  if (estPage(D)) {
    // Le choix ne dure que 1,5 s ici : si le harnais arrive après le tirage
    // automatique, le panneau est déjà rangé — on prend le tirage, sans clic.
    await D.until(`(!document.getElementById("choix").hidden && document.querySelectorAll("#choix-mots button:not(:disabled)").length === 3)
      || window.__recu.some((m) => m.type === 'drawing' && m.turnId === ${tr.turnId})`, 5000);
    if (await D.ev('!document.getElementById("choix").hidden && document.querySelectorAll("#choix-mots button:not(:disabled)").length === 3')) {
      await D.clic('#choix-mots button:nth-child(1)');
    } else g.tiragesAuto = (g.tiragesAuto || 0) + 1;
  } else {
    for (let i = 0; i < 60 && !D.dernier('choices', tr.turnId); i++) await sleep(25);
    D.send({ action: 'choose', turnId: tr.turnId, index: 0 });
  }
  const temoin = g.pages.find((p) => !g.partis.has(p));
  await temoin.until(`window.__recu.some((m) => m.type === 'drawing' && m.turnId === ${tr.turnId})`, 5000);
  const mot = estPage(D) ? (await D.recu('drawing')).find((m) => m.turnId === tr.turnId).word
    : D.dernier('drawing', tr.turnId).word;
  if (estPage(D)) await D.geste([[0.2, 0.3], [0.7, 0.6]]);
  else D.send({ action: 'stroke', turnId: tr.turnId, s: 1, c: 3, w: 1, p: [200, 200, 700, 500], end: true });
  if (plan.avant) await plan.avant(tr, mot, D);
  if (!plan.personne) {
    const presents = [...g.parId.keys()].filter((id) => id !== tr.drawer && !g.partis.has(g.parId.get(id)));
    const devineurs = plan.devineurs || presents.map((id, i) => ({ id, apresMs: i ? 150 : 0 }));
    for (const d of devineurs) {
      await sleep(d.apresMs);
      const qui = g.parId.get(d.id);
      if (estPage(qui)) {
        await qui.taper('#devine', mot);
        if (qui.mobile) await qui.clic('#devine-envoyer'); else await qui.entree();
      } else qui.send({ action: 'guess', turnId: tr.turnId, text: mot });
    }
  }
  if (plan.attendreFin === false) return { mot };
  await temoin.until(`window.__recu.some((m) => m.type === 'turn-end' && m.turnId === ${tr.turnId})`, DRAW + 5000);
  const finTour = (await temoin.recu('turn-end')).find((m) => m.turnId === tr.turnId);
  g.fins.push(finTour);
  return { mot, fin: finTour };
}

// L'écran de révélation et le tableau = les valeurs du serveur, exactement.
async function relireRevelation(p, finTour, g) {
  await p.until(`!document.getElementById('revele').hidden && document.getElementById('revele-mot').textContent.includes(${JSON.stringify(finTour.word)})`, 3000);
  const lignes = await p.ev(`[...document.querySelectorAll('#revele-gains li')].map((li) => ({ id: li.dataset.id, gain: li.querySelector('.gain').textContent, total: li.querySelector('.total').textContent, dessinateur: !!li.querySelector('.role') }))`);
  const tableau = await p.ev(`[...document.querySelectorAll('#tableau li')].map((li) => ({ id: li.dataset.id, total: li.querySelector('.total').textContent }))`);
  const gains = new Map(finTour.gains.map((x) => [x.id, x]));
  const totaux = new Map(finTour.scores.map((x) => [x.id, x.score]));
  const ecarts = [];
  for (const l of lignes) {
    const gn = gains.get(l.id);
    if (l.gain !== `+${gn ? gn.points : 0}`) ecarts.push(`${g.nom(l.id)} gain ${l.gain} ≠ +${gn ? gn.points : 0}`);
    if (l.total !== `${totaux.get(l.id)} pts`) ecarts.push(`${g.nom(l.id)} total ${l.total} ≠ ${totaux.get(l.id)}`);
    if (l.dessinateur !== !!(gn && gn.drawer)) ecarts.push(`${g.nom(l.id)} rôle`);
  }
  for (const x of finTour.gains) if (!lignes.some((l) => l.id === x.id)) ecarts.push(`${g.nom(x.id)} absent de la révélation`);
  for (const l of tableau) if (l.total !== `${totaux.get(l.id)} pts`) ecarts.push(`tableau ${g.nom(l.id)} ${l.total} ≠ ${totaux.get(l.id)}`);
  // tableau trié par total décroissant
  const tri = tableau.map((l) => totaux.get(l.id));
  if (tri.some((v, i) => i && v > tri[i - 1])) ecarts.push('tableau mal trié');
  return ecarts;
}

// L'écran de fin = le `results` du serveur, exactement.
async function relireFin(p, g) {
  await p.until('!document.getElementById("end").hidden', 10000);
  const res = (await p.recu('results')).at(-1);
  const lignes = await p.ev(`[...document.querySelectorAll('#classement li')].map((li) => ({ id: li.dataset.id, rang: li.querySelector('.rang').textContent, score: li.querySelector('.score').textContent, detail: li.querySelector('.detail').textContent }))`);
  const ecarts = [];
  if (lignes.length !== res.ranking.length) ecarts.push(`${lignes.length} lignes ≠ ${res.ranking.length}`);
  res.ranking.forEach((r, i) => {
    const l = lignes[i] || {};
    if (l.id !== r.id) ecarts.push(`ligne ${i + 1} : ${g.nom(l.id)} ≠ ${g.nom(r.id)}`);
    if (l.rang !== place(r.rank)) ecarts.push(`${g.nom(r.id)} rang ${l.rang} ≠ ${place(r.rank)}`);
    if (l.score !== `${r.score} pts`) ecarts.push(`${g.nom(r.id)} score ${l.score} ≠ ${r.score}`);
    if (!new RegExp(`^${r.found} mot`).test(l.detail || '')) ecarts.push(`${g.nom(r.id)} mots ${l.detail}`);
    if (r.left && !/parti/.test(l.detail)) ecarts.push(`${g.nom(r.id)} parti non dit`);
  });
  return { res, ecarts };
}
// Le classement du serveur = la somme des gains annoncés tour par tour.
const sommeGains = (fins) => { const s = {}; for (const f of fins) for (const x of f.gains) s[x.id] = (s[x.id] || 0) + x.points; return s; };
const rangsCoherents = (ranking) => ranking.every((r, i, a) => i === 0 || (a[i - 1].score >= r.score && r.rank === (a[i - 1].score === r.score ? a[i - 1].rank : i + 1)));

// =============================================== 1. deux joueurs, partie complète
{
  const g = await salle(0, 'X');
  await A.clic('#start');
  const tours = [];
  let ecartsRev = [];
  for (let tr = await prochain(g); tr; tr = await prochain(g)) {
    const bandeauOk = await A.until(`/^Manche ${tr.round}\\/3/.test(document.getElementById('bandeau').textContent)`, 3000);
    const { fin: f } = await jouerTour(g, tr);
    tours.push({ tr, bandeauOk });
    for (const p of [A, B]) ecartsRev = ecartsRev.concat(await relireRevelation(p, f, g));
    if (tours.length === 1) {
      const dev = f.gains.find((x) => !x.drawer), des = f.gains.find((x) => x.drawer);
      t('[6] score du devineur : entre 50 et 100, selon son temps', dev.points >= 50 && dev.points <= 100);
      t('[7] score du dessinateur : la moyenne de ce qu il a fait gagner (seul devineur → la même valeur)', des.points === dev.points);
      await A.shot('p2-revelation-a'); await B.shot('p2-revelation-b');
    }
  }
  t('[1] 2 joueurs : 6 tours (3 manches), Manche X/3 au bandeau à chaque tour', tours.length === 6 && tours.every((x) => x.bandeauOk)
    && tours.map((x) => x.tr.round).join() === '1,1,2,2,3,3');
  t('révélation : mot, gains, totaux et tableau = le turn-end du serveur, aux 6 tours, chez les deux', ecartsRev.length === 0, ecartsRev.slice(0, 4).join(' | '));
  const { res, ecarts } = await relireFin(A, g);
  const fb = await relireFin(B, g);
  t('[14] résultat final : l écran de fin reprend le results (ordre, rang, score, mots trouvés), chez les deux', ecarts.length === 0 && fb.ecarts.length === 0, [...ecarts, ...fb.ecarts].slice(0, 4).join(' | '));
  const somme = sommeGains(g.fins);
  t('[14] classement = somme des gains annoncés tour par tour', res.complete && res.ranking.every((r) => r.score === (somme[r.id] || 0)));
  t('[10] égalité : à deux, mêmes points → tous deux 1ers, « Égalité » au titre', res.ranking.every((r) => r.rank === 1) && /Égalité/.test(await A.texte('#end-title'))
    && (await A.ev('[...document.querySelectorAll("#classement .rang")].map((e) => e.textContent).join()')) === '🥇,🥇');
  t('[14] chacun a trouvé 3 mots et dessiné 3 fois', res.ranking.every((r) => r.found === 3 && r.drawn === 3));
  t('fin : l hôte a Revanche et Retour au salon, l invité attend', await A.visible('#revanche') && await A.visible('#vers-salon')
    && !(await B.visible('#revanche')) && await B.visible('#attente-hote'));
  await A.shot('p2-fin-a'); await B.shot('p2-fin-b');
  // ------------------------------------------------- 15. revanche locale
  const nAvant = (await B.recu('snapshot')).length;
  await A.clic('#revanche');
  t('[15] revanche : nouvelle partie dans la même room, chez les deux', await A.until('!document.getElementById("play").hidden', 5000)
    && await B.until(`window.__recu.filter((m) => m.type === 'snapshot').length > ${nAvant} && !document.getElementById('play').hidden`, 5000));
  t('[15] revanche : totaux remis à zéro, Manche 1/3, tour 1', await B.until(`[...document.querySelectorAll('#tableau .total')].every((e) => e.textContent === '0 pts') && /Manche 1\\/3/.test(document.getElementById('bandeau').textContent)`, 3000)
    && (await B.recu('snapshot')).at(-1).turnId === 1);
}

// ====================================== 2. trois joueurs, trois manches
{
  const g = await salle(1, 'R');
  const [R1] = g.bots;
  await A.clic('#start');
  let n = 0, multiFait = false, personneFait = false, ancienFait = false, ecartsRev = [];
  const rounds = [];
  for (let tr = await prochain(g); tr; tr = await prochain(g)) {
    n++;
    rounds.push(tr.round);
    // ---- 16. un message de l'ancien tour arrive au début du nouveau
    if (n === 2) {
      const avantTab = await B.ev('document.getElementById("tableau").textContent');
      const vieux = g.fins.at(-1);
      await B.ev(`NET.dispatch(${JSON.stringify({ ...vieux, scores: vieux.scores.map((s) => ({ ...s, score: 999 })), word: 'VIEUXMOT' })}); NET.dispatch({ type: 'found', turnId: ${vieux.turnId}, id: ${JSON.stringify(g.id.get(A))}, order: 1 }); true`);
      t('[16] turn-end et found de l ancien tour : ignorés (ni révélation, ni totaux 999, ni ✓)', await B.ev('document.getElementById("tableau").textContent') === avantTab
        && !(await B.ev('document.body.innerText.includes("VIEUXMOT") || document.body.innerText.includes("999")')));
      ancienFait = true;
    }
    const D = g.parId.get(tr.drawer);
    let plan = {};
    if (!multiFait && D === R1) {
      // 9. deux trouveurs à des temps différents : A tout de suite, B 1,5 s après
      plan = { devineurs: [{ id: g.id.get(A), apresMs: 0 }, { id: g.id.get(B), apresMs: 1500 }] };
    } else if (!personneFait && estPage(D) && multiFait) {
      plan = { personne: true };
    }
    const { fin: f } = await jouerTour(g, tr, plan);
    ecartsRev = ecartsRev.concat(await relireRevelation(A, f, g), await relireRevelation(B, f, g));
    if (plan.devineurs) {
      const pa = f.gains.find((x) => x.id === g.id.get(A)).points, pb = f.gains.find((x) => x.id === g.id.get(B)).points;
      const pd = f.gains.find((x) => x.drawer).points;
      t(`[9] deux trouveurs à 1,5 s d écart : ${pa} puis ${pb} points (le plus rapide gagne plus)`, pa > pb && pa <= 100 && pb >= 50);
      t(`[7] dessinateur (robot) : moyenne (${pa} + ${pb}) / 2 = ${pd}`, pd === Math.round((pa + pb) / 2));
      await A.shot('p3-deux-trouveurs');
      multiFait = true;
    }
    if (plan.personne) {
      t('[8] personne ne trouve : « Temps écoulé ! », +0 pour tous, dessinateur compris', f.reason === 'time' && f.gains.every((x) => x.points === 0)
        && (await A.ev('[...document.querySelectorAll("#revele-gains .gain")].every((e) => e.textContent === "+0")')) && /Temps écoulé/.test(await A.texte('#revele-motif')));
      await B.shot('p3-personne');
      personneFait = true;
    }
  }
  t('[2] 3 joueurs : 9 tours, 3 manches', n === 9 && rounds.join() === '1,1,1,2,2,2,3,3,3');
  t('[2] les scénarios ont eu lieu (deux trouveurs, personne, ancien turnId)', multiFait && personneFait && ancienFait);
  t('révélation = turn-end du serveur, aux 9 tours, chez les deux navigateurs', ecartsRev.length === 0, ecartsRev.slice(0, 4).join(' | '));
  const { res, ecarts } = await relireFin(A, g);
  const somme = sommeGains(g.fins);
  t('[14] 3 joueurs : écran de fin = results ; classement = somme des gains ; rangs cohérents', ecarts.length === 0 && res.complete
    && res.ranking.every((r) => r.score === (somme[r.id] || 0)) && rangsCoherents(res.ranking), ecarts.slice(0, 3).join(' | '));
  t('fin : chaque joueur a dessiné 3 fois', res.ranking.every((r) => r.drawn === 3));
}

// ===================== 3. cinq joueurs, deux manches : départs, retour au salon
{
  const g = await salle(3, 'C');
  await A.clic('#start');
  let n = 0, departFait = false, dessinateurParti = false;
  const rounds = [];
  for (let tr = await prochain(g); tr; tr = await prochain(g)) {
    n++;
    rounds.push(tr.round);
    const D = g.parId.get(tr.drawer);
    // 12. un robot dessinateur part en plein dessin (après le 1er tour)
    if (!dessinateurParti && n >= 2 && !estPage(D)) {
      const { fin: f } = await jouerTour(g, tr, { personne: true, avant: async () => { await sleep(300); D.ws.close(); g.partis.add(D); } });
      t('[12] dessinateur parti en plein dessin : tour arrêté, motif « … a quitté la partie »', f.reason === 'drawer-left'
        && new RegExp(`${D.nom} a quitté la partie`).test(await A.texte('#revele-motif')));
      t('[12] … il est « parti » au tableau', await A.ev(`[...document.querySelectorAll('#tableau li')].some((li) => li.dataset.id === ${JSON.stringify(D.id)} && li.classList.contains('is-parti') && /parti/.test(li.textContent))`));
      dessinateurParti = true;
      continue;
    }
    const { fin: f } = await jouerTour(g, tr);
    // 11. un robot (pas le prochain dessinateur) part ENTRE deux tours (pendant la révélation)
    if (!departFait && n === 1) {
      const partant = g.bots.find((b) => b.id !== tr.drawer && !g.partis.has(b));
      partant.ws.close(); g.partis.add(partant);
      t('[11] un joueur part entre deux tours : « parti » au tableau', await A.until(`[...document.querySelectorAll('#tableau li')].some((li) => li.dataset.id === ${JSON.stringify(partant.id)} && li.classList.contains('is-parti'))`, 4000));
      g.partant = partant;
      departFait = true;
    }
    void f;
  }
  const { res, ecarts } = await relireFin(A, g);
  t(`[3] 5 joueurs : 2 manches (${rounds.join(',')}) ; les partis ne dessinent plus`, rounds.every((r) => r === 1 || r === 2) && rounds.includes(2)
    && res.ranking.filter((r) => r.left).every((r) => r.drawn <= 1));
  t('[11] la partie va au bout malgré les départs (complète), partis au classement avec leurs points', res.complete && res.ranking.length === 5
    && res.ranking.filter((r) => r.left).length === 2 && ecarts.length === 0, ecarts.slice(0, 3).join(' | '));
  t('[14] classement = somme des gains ; rangs cohérents', res.ranking.every((r) => r.score === (sommeGains(g.fins)[r.id] || 0)) && rangsCoherents(res.ranking));
  await A.shot('p5-fin');
  // ------------------------------------------------- retour au salon
  await A.clic('#vers-salon');
  t('retour au salon : tout le monde revient au salon (3 présents)', await A.until('!document.getElementById("lobby").hidden && document.querySelectorAll("#players li").length === 3', 5000)
    && await B.until('!document.getElementById("lobby").hidden', 5000));
}

// ============================================ 4. six joueurs, une manche
{
  const g = await salle(4, 'S');
  await A.clic('#start');
  let n = 0;
  for (let tr = await prochain(g); tr; tr = await prochain(g)) {
    n++;
    if (!/Manche 1\/1/.test(await A.texte('#bandeau'))) t('bandeau Manche 1/1', false);
    await jouerTour(g, tr);
  }
  const { res, ecarts } = await relireFin(B, g);
  t('[4] 6 joueurs : 1 manche, 6 tours, chacun dessine une fois ; écran de fin = results', n === 6 && res.ranking.every((r) => r.drawn === 1) && ecarts.length === 0, ecarts.slice(0, 3).join(' | '));
}

// ================================================================ 5. 16 joueurs
{
  const g = await salle(14, 'Z');
  await A.clic('#start');
  let n = 0, ecartsRev = [];
  for (let tr = await prochain(g); tr; tr = await prochain(g)) {
    n++;
    // les robots devinent à des délais variés, les navigateurs d'abord
    const autres = [...g.parId.keys()].filter((id) => id !== tr.drawer);
    const devineurs = autres.map((id, i) => ({ id, apresMs: i < 2 ? 0 : 20 }));
    const { fin: f } = await jouerTour(g, tr, { devineurs });
    if (n === 1 || n === 16) ecartsRev = ecartsRev.concat(await relireRevelation(A, f, g), await relireRevelation(B, f, g));
    if (n === 1) { await A.shot('p16-revelation-a'); await B.shot('p16-revelation-b'); }
  }
  const { res, ecarts } = await relireFin(A, g);
  const fb = await relireFin(B, g);
  t('[5] 16 joueurs : 16 tours, 16 lignes au classement, chacun a dessiné une fois', n === 16 && res.ranking.length === 16 && res.ranking.every((r) => r.drawn === 1));
  t('[5] 16 joueurs : révélations (1er et dernier tour) et écrans de fin = le serveur', ecartsRev.length === 0 && ecarts.length === 0 && fb.ecarts.length === 0,
    [...ecartsRev, ...ecarts, ...fb.ecarts].slice(0, 4).join(' | '));
  t('[5] 16 joueurs : pas de débordement horizontal sur l écran de fin (téléphone)', await B.ev('document.documentElement.scrollWidth <= innerWidth'));
  t('[5] 16 joueurs : au téléphone, Revanche est à l écran sans défiler (actions avant le classement)', await A.ev('(() => { const b = document.getElementById("revanche").getBoundingClientRect(); return b.bottom <= innerHeight && b.top >= 0; })()')
    && await B.ev('(() => { const b = document.getElementById("attente-hote").getBoundingClientRect(); return b.bottom <= innerHeight; })()'));
  await A.shot('p16-fin-a'); await B.shot('p16-fin-b');
}

// =========================================================== 6. partie incomplète
{
  const g = await salle(1, 'I');
  await A.clic('#start');
  const tr = await prochain(g);
  const D = g.parId.get(tr.drawer);
  if (estPage(D)) await D.until('!document.getElementById("choix").hidden', 5000);
  g.bots[0].ws.close();
  await sleep(300);
  // B s'en va (onglet quitté) : il ne reste qu'Alice
  await B.ev('location.href = "about:blank"; true');
  t('[13] partie incomplète : A reste seule → écran « Partie interrompue »', await A.until('!document.getElementById("end").hidden', 8000)
    && /interrompue/i.test(await A.texte('#end-meta')) && /Pas assez de joueurs/.test(await A.texte('#end-title')));
  const res = (await A.recu('results')).at(-1);
  t('[13] results complete:false, les partis au classement', res.complete === false && res.ranking.filter((r) => r.left).length === 2);
  await A.shot('incomplete');
}

const { ok, ko } = t.bilan();
console.log(`\n${ok} OK, ${ko} KO`);
fin();
process.exit(ko ? 1 : 0);
