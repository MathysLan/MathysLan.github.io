// Faux Témoin (« l'Interrogatoire ») — une VRAIE partie à quatre, dans de
// vrais navigateurs, contre le VRAI temoin-server (durées raccourcies).
//
//   node tests/temoin-partie.mjs                    ~1 min 30
//   node tests/temoin-partie.mjs --shots <dossier>
//   node tests/temoin-partie.mjs --serveur C:\perso\temoin-server
//   node tests/temoin-partie.mjs --edge <chemin du navigateur>
//
// Alice (bureau, souris, hôte), Bruno (téléphone 390 px, doigt) et deux robots
// WebSocket. Trois manches jouées comme à table : chacun répond à son tour
// (les pages par « J'ai répondu », les robots par le fil), tout le monde se
// dit prêt, puis vote — manche 1 contre le Faux Témoin (démasqué, dernière
// chance), manche 2 contre un témoin (il s'en tire), manche 3 en égalité.
//
// Ce qui est vérifié : ce que l'ÉCRAN montre est exactement ce que le serveur
// a envoyé à CE joueur (rôle, scène dessinée élément par élément, lieu seul
// chez le Faux Témoin, question, qui parle, verdict, 4 versions au seul
// démasqué, révélation, votes, points, totaux, classement) ; la scène
// disparaît après le flash ; les intentions parties sont celles des clics ;
// au téléphone, chaque phase tient à l'écran sans défiler ; aucune erreur
// JavaScript.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { compteur, sleep, arg, lancerEdge, robot, ROOT } from './croquis-harnais.mjs';

const t = compteur();
const SHOTS = arg('--shots');

// ------------------------------------------------------------ le vrai serveur
const voisin = path.resolve(ROOT, '..', 'temoin-server');
const dossier = arg('--serveur') || (existsSync(path.join(voisin, 'server.js')) ? voisin : 'C:\\perso\\temoin-server');
const port = 8700 + Math.floor(Math.random() * 200);
const srv = spawn(process.execPath, [path.join(dossier, 'server.js')], {
  cwd: dossier,
  env: {
    ...process.env, PORT: String(port), PRESENCE_QUIET: '1',
    // Le flash RÉEL se règle au salon (5, 8 ou 10 s) ; ici, 2,5 s pour aller vite.
    TEST_ROLE_MS: '900', TEST_FLASH_MS: '2500', TEST_ASK_MS: '0', TEST_ANSWER_MS: '20000',
    TEST_DEBATE_MS: '30000', TEST_VOTE_MS: '30000', TEST_VERDICT_MS: '1500', TEST_GUESS_MS: '15000',
  },
  stdio: ['ignore', 'pipe', 'inherit'],
});
process.on('exit', () => srv.kill());
await new Promise((res) => srv.stdout.on('data', (d) => { if (/écoute/.test(String(d))) res(); }));
const URL_WS = `ws://127.0.0.1:${port}`;
const PAGE = pathToFileURL(path.join(ROOT, 'games', 'temoin', 'index.html')).href + `?server=${encodeURIComponent(URL_WS)}`;

const ERREURS = `window.__err = []; addEventListener('error', (e) => window.__err.push(String(e.message || e)));
  addEventListener('unhandledrejection', (e) => window.__err.push('promesse : ' + String(e.reason)));`;

const { onglet } = await lancerEdge({ shots: SHOTS });
async function ouvrir(nom, o) {
  const p = await onglet(nom, { ...o, page: PAGE });
  await p.c.send('Page.addScriptToEvaluateOnNewDocument', { source: ERREURS });
  p.ouvrir = async () => {
    await p.c.send('Page.navigate', { url: PAGE });
    await p.until('document.readyState === "complete" && typeof NET === "object" && !!window.TemoinScene');
  };
  return p;
}
const A = await ouvrir('A', { w: 1200, h: 850 });
const B = await ouvrir('B', { w: 390, h: 844, mobile: true });

const derniere = async (p, type, pred = 'true') => p.ev(`window.__recu.filter((m) => m.type === ${JSON.stringify(type)} && (${pred})).at(-1) || null`);
const attendreType = (p, type, pred = 'true', ms = 15000) =>
  p.until(`window.__recu.some((m) => m.type === ${JSON.stringify(type)} && (${pred}))`, ms);
// Le panneau de la phase tient-il à l'écran, sans défiler ?
const tientAEcran = (p, sel) => p.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); const r = e.getBoundingClientRect(); return scrollY === 0 && r.top >= 0 && r.bottom <= innerHeight; })()`);

// ================================================================ le salon
await A.ouvrir(); await B.ouvrir();
await A.ev('document.getElementById("name-input").value = ""; true');
await A.taper('#name-input', 'Alice');
await A.clic('#host');
await A.until('/^[A-Z]{4}$/.test(document.getElementById("room-code").textContent)');
const code = await A.texte('#room-code');
t('[salon] partie créée : code à 4 lettres', /^[A-Z]{4}$/.test(code));

await B.ev('document.getElementById("name-input").value = ""; true');
await B.taper('#name-input', 'Bruno');
await B.taper('#code-input', code);
await B.clic('#join');
await A.until('document.querySelectorAll("#players li").length === 2');
t('[salon] à deux, « Lancer » reste éteint (3 joueurs minimum)', await A.ev('document.getElementById("start").disabled')
  && /au moins 3/.test(await A.texte('#need-players')));

// Les deux robots : ils répondent à leur tour, se disent prêts, votent selon
// le plan de la manche, et choisissent la version 0 s'ils sont démasqués.
const plan = new Map();          // roundId → (id du votant) → id visé
function joueur(nom) {
  const r = robot(URL_WS, nom, code);
  r.ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.type !== 'phase') return;
    const go = (o) => setTimeout(() => r.send({ roundId: m.roundId, ...o }), 120);
    if (m.phase === 'question' && m.question.speaker === r.id && !m.question.answered.includes(r.id)) go({ action: 'answered' });
    if (m.phase === 'debate' && !m.ready.includes(r.id)) go({ action: 'ready', ready: true });
    if (m.phase === 'vote' && !m.voted.includes(r.id)) {
      const cible = (plan.get(m.roundId) || new Map()).get(r.id);
      if (cible) go({ action: 'vote', target: cible });
    }
    if (m.phase === 'guess' && m.liar === r.id && !r.choisi) { r.choisi = true; go({ action: 'guess', option: 0 }); }
  });
  return r;
}
const R1 = joueur('Robot1');
const R2 = joueur('Robot2');
await A.until('document.querySelectorAll("#players li").length === 4');
t('[salon] 4 joueurs ; l invité ne voit pas les réglages', !(await B.visible('#host-config')) && await A.visible('#host-config'));

// Réglages de l'hôte : 3 manches, scène de 5 s.
await A.clic('.nb-flash[data-flash="5000"]');
await B.until('/montrée 5 s/.test(document.getElementById("lobby-info").textContent)', 4000);
t('[salon] l hôte règle la scène à 5 s : envoyé, bouton enfoncé, annoncé chez l invité',
  (await A.envoye('settings')).some((m) => m.flashMs === 5000)
  && await A.ev('document.querySelector(\'.nb-flash[data-flash="5000"]\').getAttribute("aria-pressed") === "true"')
  && /montrée 5 s/.test(await B.texte('#lobby-info')));
t('[salon] 3 manches par défaut', /^3 manches/.test(await A.texte('#lobby-info')));
await A.shot('temoin-0-salon-bureau');
await A.until('!document.getElementById("start").disabled');
await A.clic('#start');
await attendreType(A, 'game');
const g = await derniere(A, 'game');
t('[salon] la partie part avec le flash réglé (5 s) et 3 manches', g.flashMs === 5000 && g.rounds === 3);

const ids = { A: g.you, B: (await derniere(B, 'game')).you, R1: R1.id, R2: R2.id };
const nom = { [ids.A]: 'Alice', [ids.B]: 'Bruno', [ids.R1]: 'Robot1', [ids.R2]: 'Robot2' };
const pages = [{ p: A, id: ids.A }, { p: B, id: ids.B }];

// ============================================================= une manche
const reveals = [];
async function manche(rid, voteDe) {
  const tag = `[manche ${rid}]`;
  await attendreType(A, 'role', `m.roundId === ${rid}`);
  await attendreType(B, 'role', `m.roundId === ${rid}`);
  await sleep(150);
  const roles = {
    [ids.A]: (await derniere(A, 'role', `m.roundId === ${rid}`)).role,
    [ids.B]: (await derniere(B, 'role', `m.roundId === ${rid}`)).role,
    [ids.R1]: R1.msgs.filter((m) => m.type === 'role' && m.roundId === rid).at(-1).role,
    [ids.R2]: R2.msgs.filter((m) => m.type === 'role' && m.roundId === rid).at(-1).role,
  };
  const liar = Object.keys(roles).find((id) => roles[id] === 'liar');
  t(`${tag} un seul Faux Témoin parmi les 4`, Object.values(roles).filter((r) => r === 'liar').length === 1);
  const titre = (await derniere(A, 'round', `m.roundId === ${rid}`)).title;

  // --- le rôle
  for (const { p, id } of pages) {
    await p.until('!document.getElementById("p-role").hidden', 5000);
    const ecran = await p.texte('#role-titre');
    t(`${tag} ${nom[id]} : la carte dit son rôle`, roles[id] === 'liar' ? /FAUX TÉMOIN/.test(ecran) : /Tu es témoin/.test(ecran), ecran);
  }

  // --- le flash : la scène chez les témoins, le lieu seul chez le Faux Témoin
  for (const { p, id } of pages) {
    await p.until('!document.getElementById("p-flash").hidden', 5000);
    await attendreType(p, 'scene', `m.roundId === ${rid}`, 5000);
    const recue = (await derniere(p, 'scene', `m.roundId === ${rid}`)).scene;
    if (roles[id] === 'liar') {
      await p.until('!document.getElementById("flash-menteur").hidden', 3000);
      t(`${tag} ${nom[id]} (Faux Témoin) : rien reçu, aucune scène dessinée, le lieu seul`, recue === null
        && (await p.ev('document.querySelectorAll(".scene-svg").length')) === 0 && (await p.texte('#flash-lieu')) === titre);
    } else {
      await p.until('!!document.querySelector("#flash-scene .scene-svg")', 3000);
      const vu = await p.ev(`(() => { const s = document.querySelector("#flash-scene .scene-svg"); return { label: s.getAttribute("aria-label"), attendu: TemoinScene.decrire(${JSON.stringify(recue)}), slots: [...s.querySelectorAll(".it")].map((x) => x.dataset.slot).sort() }; })()`);
      const slots = recue.items.filter((x) => x.item && x.item.kind !== 'ciel').map((x) => x.slot).sort();
      t(`${tag} ${nom[id]} (témoin) : la scène reçue est dessinée, élément par élément`, vu.label === vu.attendu && vu.slots.join() === slots.join(), JSON.stringify({ vu: vu.slots, slots }));
      if (p === B) t(`${tag} téléphone : la scène entière à l écran, sans défiler`, await tientAEcran(B, '#flash-scene'));
    }
  }
  if (rid === 1) { await B.shot('temoin-1-scene-telephone'); await A.shot('temoin-1-scene-bureau'); }

  // --- l'interrogatoire : chaque page répond à son tour par le bouton
  let tours = 0, vusEcran = true, boutonsOk = true;
  const parleurs = [];
  for (let n = 0; n < 40; n++) {
    await A.until(`(() => { const m = window.__recu.filter((x) => x.type === "phase").at(-1); return m && m.roundId === ${rid} && m.phase !== "flash" && m.phase !== "role"; })()`, 25000);
    const m = await derniere(A, 'phase');
    if (m.phase !== 'question') break;
    const q = m.question;
    if (parleurs.at(-1) === q.speaker + '@' + q.index) { await sleep(60); continue; }
    parleurs.push(q.speaker + '@' + q.index);
    tours++;
    if (tours === 1) t(`${tag} scène oubliée après le flash (aucun dessin chez personne)`, (await A.ev('document.querySelectorAll(".scene-svg").length')) === 0 && (await B.ev('document.querySelectorAll(".scene-svg").length')) === 0);
    for (const { p, id } of pages) {
      await p.until(`document.getElementById("q-texte").textContent === ${JSON.stringify(q.text)} && document.querySelector("#q-ordre .is-actuel")?.dataset.id === ${JSON.stringify(q.speaker)}`, 3000)
        || (vusEcran = false);
      const bouton = await p.visible('#repondu');
      if (bouton !== (q.speaker === id)) boutonsOk = false;
    }
    const qui = pages.find((x) => x.id === q.speaker);
    if (qui) {
      if (rid === 1 && qui.p === B && !B.photoQuestion) { B.photoQuestion = true; t(`${tag} téléphone : la question, qui parle et « J ai répondu » à l écran sans défiler`, await tientAEcran(B, '#p-question')); await B.shot('temoin-2-question-telephone'); }
      const avant = (await qui.p.envoye('answered')).length;
      await qui.p.clic('#repondu');
      const env = (await qui.p.envoye('answered')).at(-1);
      if (!(env && env.roundId === rid && (await qui.p.envoye('answered')).length === avant + 1)) boutonsOk = false;
    }
    await A.until(`(() => { const m = window.__recu.filter((x) => x.type === "phase").at(-1); return !(m.phase === "question" && m.question.speaker === ${JSON.stringify(q.speaker)} && m.question.index === ${q.index}); })()`, 25000);
  }
  t(`${tag} interrogatoire : 2 questions × 4 répondants = 8 tours de parole`, tours === 8, String(tours));
  t(`${tag} chaque écran montre la question du serveur et met en avant celui qui parle`, vusEcran);
  t(`${tag} « J ai répondu » : au seul joueur qui parle, et il envoie answered pour la manche`, boutonsOk);
  const q1 = parleurs.filter((x) => x.endsWith('@0'));
  t(`${tag} le Faux Témoin n ouvre pas la question 1`, !q1[0].startsWith(liar + '@'));

  // --- le débat
  for (const { p } of pages) await p.until('!document.getElementById("p-debat").hidden', 5000);
  const deb = await derniere(A, 'phase', `m.phase === "debate" && m.roundId === ${rid}`);
  t(`${tag} débat : les ${deb.asked.length} questions posées sont rappelées`, deb.asked.length === 2
    && JSON.stringify(await A.ev('[...document.querySelectorAll("#posees li")].map((li) => li.textContent)')) === JSON.stringify(deb.asked));
  await A.clic('#pret');
  t(`${tag} « Prêt à voter » envoie ready pour la manche`, (await A.envoye('ready')).some((m) => m.roundId === rid && m.ready === true)
    && (await A.ev('document.getElementById("pret").getAttribute("aria-pressed")')) === 'true');
  if (rid === 1) await A.shot('temoin-3-debat-bureau');
  await B.clic('#pret');

  // --- le vote : les pages touchent une carte, les robots suivent le plan
  for (const { p } of pages) await p.until('!document.getElementById("p-vote").hidden', 8000);
  const cartes = await B.ev('[...document.querySelectorAll("#vote-cartes button")].map((b) => b.dataset.id).sort()');
  t(`${tag} vote : une carte par AUTRE joueur`, cartes.join() === [ids.A, ids.R1, ids.R2].sort().join());
  if (rid === 1) t(`${tag} téléphone : les 3 cartes de vote à l écran sans défiler`, await tientAEcran(B, '#p-vote'));
  const votes = voteDe(liar);
  plan.set(rid, new Map(Object.entries(votes)));
  // Les robots votent à la phase `vote` : déjà passée pour eux, on les relance.
  for (const r of [R1, R2]) r.send({ action: 'vote', roundId: rid, target: votes[r.id] });
  for (const { p, id } of pages) {
    await p.clic(`#vote-cartes button[data-id="${votes[id]}"]`);
    const env = (await p.envoye('vote')).at(-1);
    t(`${tag} ${nom[id]} touche ${nom[votes[id]]} : le vote part tel quel`, env && env.target === votes[id] && env.roundId === rid);
  }
  if (rid === 1) await B.shot('temoin-4-vote-telephone');

  // --- le verdict
  await attendreType(A, 'phase', `m.phase === "verdict" && m.roundId === ${rid}`);
  const ver = (await derniere(A, 'phase', `m.phase === "verdict" && m.roundId === ${rid}`)).verdict;
  await A.until('!document.getElementById("p-verdict").hidden', 3000);
  const vt = await A.texte('#verdict-titre');
  t(`${tag} verdict affiché = celui du serveur`, ver.accused ? vt.includes(nom[ver.accused]) && (ver.caught ? /Faux Témoin/.test(vt) : /vrai témoin/.test(vt)) : /Égalité|Personne/.test(vt), vt);

  // --- la dernière chance
  if (ver.caught) {
    await attendreType(A, 'phase', `m.phase === "guess" && m.roundId === ${rid}`, 5000);
    const lui = pages.find((x) => x.id === liar);
    for (const { p, id } of pages) {
      await p.until('!document.getElementById("p-guess").hidden', 5000);
      if (id === liar) {
        await p.until('document.querySelectorAll("#guess-versions button .scene-svg").length === 4', 4000);
        const recues = (await derniere(p, 'options', `m.roundId === ${rid}`)).options;
        const ok = await p.ev(`(() => { const lab = [...document.querySelectorAll("#guess-versions .scene-svg")].map((s) => s.getAttribute("aria-label"));
          return lab.length === 4 && ${JSON.stringify(recues)}.every((sc, i) => lab[i] === "Version " + (i + 1) + " : " + TemoinScene.decrire(sc)); })()`);
        t(`${tag} ${nom[id]} démasqué : ses 4 versions reçues, dessinées dans l ordre`, ok);
      } else {
        t(`${tag} ${nom[id]} (témoin) : aucune version, ni reçue ni dessinée`, (await p.ev('document.querySelectorAll(".scene-svg").length')) === 0
          && (await p.recu('options')).length === 0 && (await p.texte('#guess-titre')).includes(nom[liar]));
      }
    }
    if (lui) {
      if (lui.p === B) await B.shot('temoin-5-derniere-chance-telephone');
      await lui.p.clic('#guess-versions button:nth-child(3)');
      const env = (await lui.p.envoye('guess')).at(-1);
      t(`${tag} le choix touché part : version 3 (index 2)`, env && env.option === 2 && env.roundId === rid);
    }
  }

  // --- la révélation
  await attendreType(A, 'phase', `m.phase === "reveal" && m.roundId === ${rid}`, 20000);
  const rv = (await derniere(A, 'phase', `m.phase === "reveal" && m.roundId === ${rid}`));
  const r = rv.reveal;
  reveals.push(r);
  for (const { p } of pages) await p.until('!document.getElementById("p-reveal").hidden', 4000);
  const ecran = await A.ev(`(() => ({
    titre: document.getElementById("rev-titre").textContent,
    scene: document.querySelector("#rev-scene .scene-svg").getAttribute("aria-label"),
    attendu: "La vraie scène : " + TemoinScene.decrire(${JSON.stringify(r.scene)}),
    votes: [...document.querySelectorAll("#rev-votes li")].map((li) => li.dataset.id + ">" + li.lastChild.textContent),
    points: [...document.querySelectorAll("#rev-points li")].map((li) => li.dataset.id + ":" + li.querySelector(".pts").textContent),
    totaux: Object.fromEntries([...document.querySelectorAll("#tableau li")].map((li) => [li.dataset.id, li.querySelector(".total").textContent])),
  }))()`);
  t(`${tag} révélation : le Faux Témoin nommé, la vraie scène dessinée pour tous`, ecran.titre.includes(nom[r.liar]) && r.liar === liar && ecran.scene === ecran.attendu);
  t(`${tag} révélation : qui a voté pour qui = le serveur`, JSON.stringify(ecran.votes.sort()) === JSON.stringify(r.votes.map((v) => v.id + '>' + nom[v.target]).sort()), JSON.stringify(ecran.votes));
  t(`${tag} révélation : les points de la manche = le serveur`, JSON.stringify(ecran.points.sort()) === JSON.stringify(r.points.filter((x) => x.points > 0).map((x) => `${x.id}:+${x.points}`).sort()), JSON.stringify({ e: ecran.points, s: r.points }));
  t(`${tag} tableau : les totaux du serveur`, rv.players.every((x) => ecran.totaux[x.id] === `${x.score} pts`), JSON.stringify(ecran.totaux));
  t(`${tag} « Manche suivante » à l hôte seulement`, await A.visible('#suivante') && !(await B.visible('#suivante')) && await B.visible('#rev-attente'));
  if (rid === 1) { await A.shot('temoin-6-revelation-bureau'); await B.shot('temoin-6-revelation-telephone'); }
  await A.clic('#suivante');
  return { liar, r };
}
// Trois scénarios, un par manche. Le Faux Témoin change à chaque manche (le
// serveur fait tourner le rôle) : l'une des trois tombe forcément sur une
// PAGE, et c'est elle qui reçoit « démasqué » — pour jouer la dernière
// chance au doigt ou à la souris, pas seulement par un robot.
const TOUS = [ids.A, ids.B, ids.R1, ids.R2];
const autre = (liar, sauf = []) => TOUS.find((x) => x !== liar && !sauf.includes(x));
const SCENARIOS = {
  // Tout le monde accuse le Faux Témoin (lui accuse un autre).
  demasque: (liar) => Object.fromEntries(TOUS.map((v) => [v, v === liar ? autre(liar, [v]) : liar])),
  // Tout le monde accuse un même témoin (lui accuse un autre).
  bouc: (liar) => { const b = autre(liar); return Object.fromEntries(TOUS.map((v) => [v, v === b ? autre(liar, [b]) : b])); },
  // Égalité 2 contre 2 entre deux témoins.
  egalite: (liar) => { const [w1, w2, w3] = TOUS.filter((v) => v !== liar); return { [w1]: w2, [w2]: w1, [w3]: w2, [liar]: w1 }; },
};
const restants = ['demasque', 'bouc', 'egalite'];
const joues = {};
let pageMenteuse = 0, pageDemasquee = false;
for (const rid of [1, 2, 3]) {
  let choix = null;
  const res = await manche(rid, (liar) => {
    const page = liar === ids.A || liar === ids.B;
    if (page) pageMenteuse++;
    choix = page && restants.includes('demasque') ? 'demasque' : restants.find((x) => x !== 'demasque') || 'demasque';
    restants.splice(restants.indexOf(choix), 1);
    if (page && choix === 'demasque') pageDemasquee = true;
    return SCENARIOS[choix](liar);
  });
  joues[choix] = res;
}
t('[parcours] une page a été Faux Témoin (lieu seul) et démasquée (4 versions au toucher)', pageMenteuse >= 1 && pageDemasquee);
t('[démasqué] la table accuse le Faux Témoin : verdict « démasqué »', joues.demasque.r.verdict.caught === true);
t('[bouc] un témoin accusé à tort : +3 au Faux Témoin', !joues.bouc.r.verdict.caught && joues.bouc.r.points.find((p) => p.id === joues.bouc.liar).points === 3);
t('[égalité] égalité en tête : personne n est démasqué, +3 au Faux Témoin', joues.egalite.r.verdict.accused === null && joues.egalite.r.verdict.tie === true
  && joues.egalite.r.points.find((p) => p.id === joues.egalite.liar).points === 3);

// ================================================================== la fin
await attendreType(A, 'results', 'true', 10000);
await A.until('!document.getElementById("end").hidden');
await B.until('!document.getElementById("end").hidden');
const res = await derniere(A, 'results');
const lignes = await A.ev('[...document.querySelectorAll("#classement li")].map((li) => li.dataset.id + ":" + li.querySelector(".score").textContent)');
t('[fin] le classement = celui du serveur, dans son ordre', res.complete && JSON.stringify(lignes) === JSON.stringify(res.ranking.map((r) => `${r.id}:${r.score} pts`)));
const attendu = new Map(res.ranking.map((r) => [r.id, 0]));
for (const v of reveals) for (const p of v.points) attendu.set(p.id, attendu.get(p.id) + p.points);
t('[fin] les totaux = la somme des points des 3 révélations', res.ranking.every((r) => r.score === attendu.get(r.id)));
t('[fin] revanche et salon à l hôte, attente à l invité', await A.visible('#revanche') && !(await B.visible('#revanche')) && await B.visible('#attente-hote'));
await A.shot('temoin-7-fin-bureau');
await B.shot('temoin-7-fin-telephone');
await A.clic('#vers-salon');
t('[fin] retour au salon chez tous', await B.until('!document.getElementById("lobby").hidden', 4000));
const err = [...await A.ev('window.__err'), ...await B.ev('window.__err')];
t('[fin] aucune erreur JavaScript', err.length === 0, err.join(' | '));

const { ok, ko } = t.bilan();
console.log(`\n${ok} OK, ${ko} KO`);
process.exit(ko ? 1 : 0);
