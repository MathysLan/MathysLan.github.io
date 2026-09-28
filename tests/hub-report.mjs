// Livraison FIABLE du classement au Game Hub : `results` puis `ended`, à
// travers les coupures du socket Hub, les reconnexions et les changements de
// page (jeu → /games/ → rechargement), dans le même onglet.
//
//   node tests/hub-report.mjs
//
// Le défaut couvert : un `send()` sur un socket fermé ou en cours de connexion
// était jeté en silence, alors que hub-handoff.js marquait déjà le classement
// comme rapporté. Rien n'était rejoué : partie non comptée, ou Hub bloqué en
// inGame / playing (ended perdu). Voir CLAUDE.md, « Livraison fiable ».
//
// Le montage :
//   - le VRAI game-hub-server, lancé en local sur le vrai manifest ;
//   - les VRAIS games/shared/game-hub.js et hub-handoff.js, exécutés dans des
//     « pages » Node : un contexte vm par page, le WebSocket natif (même API que
//     le navigateur), un sessionStorage PAR ONGLET partagé par ses pages
//     successives, et des minuteries rattachées à la page. Quitter une page
//     (navigation, rechargement) coupe ses sockets ET ses minuteries, comme un
//     navigateur ;
//   - les invités sont des clients bruts : l'état qu'ILS reçoivent du Hub est la
//     vérité (score, historique, étape du lancement).
// Pourquoi pas un navigateur : il faut couper UN socket (celui du Hub) à un
// instant précis, bloquer sa reconnexion, ou rendre la page sourde aux
// diffusions. Le parcours réel dans Edge est tests/hub-report-play.mjs.
import vm from 'node:vm';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fakeHealth, localManifest } from './hub-fixture.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const R = () => Math.floor(Math.random() * 300);
const HUB_PORT = 8400 + R(), HEALTH_PORT = 6700 + R();
const HUB = `ws://127.0.0.1:${HUB_PORT}`;
// Un Hub injoignable : un port qu'on vient de libérer (connexion refusée). Pas
// un port « réservé » comme 1 ou 9 : le WebSocket de Node les bloque d'office.
const MORT = await new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(`ws://127.0.0.1:${p}/`)); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// Scores : l'ordre des clés dépend de l'ordre d'application, pas du sens.
const memes = (a, b) => same(Object.entries(a || {}).sort(), Object.entries(b || {}).sort());

let ok = 0, ko = 0;
const t = (nom, cond, detail = '') => {
  if (cond) ok++; else ko++;
  console.log(`${cond ? 'OK  ' : 'KO  '} ${nom}${detail ? ' — ' + detail : ''}`);
};
async function attendre(f, ms = 8000, label = 'condition') {
  const fin = Date.now() + ms;
  for (;;) { const v = f(); if (v) return v; if (Date.now() > fin) throw new Error('attente expirée : ' + label); await sleep(15); }
}

const lire = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const CODE_GH = lire('games/shared/game-hub.js');
const CODE_HH = lire('games/shared/hub-handoff.js');
const JEUX = JSON.parse(lire('data/games.manifest.json')).games.map((g) => g.id);
const PREFIXE = 'mathys_hub_report:';

// ─── un onglet : UN sessionStorage, partagé par ses pages successives ──────
function onglet() {
  const mem = new Map();
  return {
    mem,
    storage: {
      get length() { return mem.size; },
      key: (i) => [...mem.keys()][i] ?? null,
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => { mem.set(k, String(v)); },
      removeItem: (k) => { mem.delete(k); },
    },
  };
}
const attentes = (tab) => [...tab.mem.keys()].filter((k) => k.startsWith(PREFIXE));
// Une attente écrite à la main (le format du module) : ancien tirage, autre session.
const poseAttente = (tab, a) => tab.mem.set(PREFIXE + a.session + ':' + a.drawId, JSON.stringify(Object.assign(
  { v: 1, gameId: 'passeur', results: null, ended: false, sent: { results: 0, ended: 0 }, at: Date.now() }, a)));

// ─── une page ────────────────────────────────────────────────────────────
// P.bloque : toute NOUVELLE connexion vise un port fermé (Hub injoignable).
// P.sourd  : les messages reçus ne sont plus remis à la page (diffusion perdue).
// P.onNew  : appelé à la construction d'un socket (readyState = CONNECTING).
// P.apresEnvoi(d) : appelé après chaque trame envoyée.
function page(tab, profil) {
  const P = { sockets: [], envoyes: [], bloque: false, sourd: false, onNew: null, apresEnvoi: null, morte: false };
  const timers = new Set();
  class PageWS extends WebSocket {
    constructor(url) {
      super(P.bloque ? MORT : url);
      this.__n = P.sockets.length;
      P.sockets.push(this);
      super.addEventListener('message', (e) => {
        let d = null; try { d = JSON.parse(e.data); } catch (_) {}
        if (d && d.type === 'joined') this.__joined = true;
        if (P.sourd || P.morte) return;
        if (this.__om) this.__om(e);
      });
      // ⚠️ Connexion refusée : un navigateur émet `error` PUIS `close`. Le
      // WebSocket de Node n'émet que `error` et reste en CONNECTING — le client
      // attendrait alors son délai de 45 s. On rend ici le `close` du navigateur.
      super.addEventListener('error', () => {
        if (this.readyState === 0 && !this.__clos) { this.__clos = true; if (typeof this.onclose === 'function') this.onclose({ code: 1006 }); }
      });
      if (P.onNew) { const f = P.onNew; P.onNew = null; f(this); }
    }
    get onmessage() { return this.__om || null; }
    set onmessage(f) { this.__om = f; }
    send(d) {
      let x = null; try { x = JSON.parse(d); } catch (_) {}
      P.envoyes.push({ n: this.__n, d: x });
      super.send(d);
      if (P.apresEnvoi) P.apresEnvoi(x);
    }
  }
  const noeud = () => ({ className: '', textContent: '', setAttribute() {}, append() {}, insertBefore() {}, firstChild: null });
  const ctx = {
    console,
    WebSocket: PageWS,
    setTimeout: (f, ms, ...a) => {
      if (P.morte) return null;
      const id = setTimeout(() => { timers.delete(id); if (!P.morte) f(...a); }, ms);
      timers.add(id);
      return id;
    },
    clearTimeout: (id) => { if (id) { clearTimeout(id); timers.delete(id); } },
    document: { createElement: noeud, querySelector: () => noeud(), body: noeud() },
    GameProfile: { load: () => profil },
    sessionStorage: tab.storage,
  };
  ctx.self = ctx;
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(CODE_GH, ctx, { filename: 'game-hub.js' });
  vm.runInContext(CODE_HH, ctx, { filename: 'hub-handoff.js' });
  P.ctx = ctx;
  P.GH = ctx.GameHub;
  P.HH = ctx.HubHandoff;
  // Le socket Hub en service : ouvert, et le Hub y a répondu `joined`.
  P.hubSock = () => [...P.sockets].reverse().find((s) => s.readyState === 1 && s.__joined) || null;
  P.reprise = (depuis, ms = 10000) => attendre(() => P.sockets.slice(depuis).find((s) => s.readyState === 1 && s.__joined), ms, 'reprise du socket Hub');
  P.trames = (action, depuis = 0) => P.envoyes.slice(depuis).filter((f) => f.d && f.d.action === action);
  // Navigation / rechargement : la page meurt, sockets et minuteries avec elle.
  P.quitter = () => {
    P.morte = true;
    timers.forEach((id) => clearTimeout(id));
    timers.clear();
    P.sockets.forEach((s) => { try { s.close(); } catch (_) {} });
  };
  return P;
}

// Coupe le socket Hub de la page comme une perte réseau et attend qu'il soit
// VRAIMENT fermé (le client est passé en `reconnecting`, plus aucun socket).
async function couper(P, { bloquer = false } = {}) {
  P.bloque = bloquer;
  const s = P.hubSock();
  if (!s) throw new Error('aucun socket Hub ouvert à couper');
  const avant = P.sockets.length;
  await new Promise((r) => { s.addEventListener('close', r); s.close(); });
  await sleep(0);
  return avant;
}

// La page /games/ du point de vue de la livraison : le client du Hub, le
// raccord `HubHandoff.attach(hub)` (comme hub-page.js), puis la reprise de la
// session. Rend la page, une fois `joined` reçu.
async function pageHub(tab, profil, code) {
  const H = page(tab, profil);
  const hub = H.GH.createClient({ url: HUB });
  H.hub = hub;
  if (typeof H.HH.attach === 'function') H.HH.attach(hub);
  else H.sansAttach = true;
  await hub.join(code, H.GH.playerFrom(profil));
  return H;
}

// ─── clients bruts : les invités, et l'hôte tant qu'il est sur /games/ ────
function brut(nom) {
  const ws = new WebSocket(HUB);
  const c = { nom, ws, msgs: [] };
  ws.addEventListener('message', (e) => c.msgs.push(JSON.parse(e.data)));
  c.open = new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', () => j(new Error(nom + ' : Hub injoignable'))); });
  c.send = (o) => ws.send(JSON.stringify(o));
  c.mark = () => c.msgs.length;
  c.attends = async (pred, ms = 6000, from = 0, label = 'message') => {
    const fin = Date.now() + ms;
    for (;;) {
      const m = c.msgs.slice(from).reverse().find(pred);
      if (m) return m;
      if (Date.now() > fin) throw new Error(`${nom} : ${label} jamais reçu`);
      await sleep(10);
    }
  };
  c.etat = (pred, ms, from, label = 'état') => c.attends((m) => m.session && pred(m.session), ms, from, label).then((m) => m.session);
  c.last = () => { const m = [...c.msgs].reverse().find((x) => x.session); return m && m.session; };
  c.fermer = () => new Promise((r) => { if (ws.readyState === 3) return r(); ws.addEventListener('close', r); ws.close(); });
  return c;
}
const joueur = (id, name) => ({ id, name, avatar: { kind: 'emoji', emoji: '🦊' } });
async function entre(nom, id, code) {
  const c = brut(nom);
  await c.open;
  c.send(code ? { action: 'join', code, player: joueur(id, nom) } : { action: 'create', player: joueur(id, nom) });
  await c.attends((m) => m.type === 'joined' || m.type === 'created', 6000, 0, nom + ' entre');
  return c;
}

// ─── une session à trois, seul Le Passeur possible ───────────────────────
const ROOM = 'KQMP';
// L'hôte (place ga) 2e, Bob (gb) 1er, Cam (gc) 3e → 20 / 30 / 10.
const CLASSEMENT = [
  { gamePlayerId: 'gb', rank: 1, points: 480 },
  { gamePlayerId: 'ga', rank: 2, points: 350 },
  { gamePlayerId: 'gc', rank: 3, points: 90 },
];
let numero = 0;
async function salon() {
  numero++;
  const ids = { a: `p_hote${numero}`, b: `p_bob${numero}`, c: `p_cam${numero}` };
  const A = await entre('Ana', ids.a);
  const code = A.last().code;
  const B = await entre('Bob', ids.b, code);
  const C = await entre('Cam', ids.c, code);
  await A.etat((s) => s.pool && s.pool.catalog === 'ready' && s.players.length === 3, 8000, 0, 'catalogue prêt');
  B.send({ action: 'prefs', love: [], veto: JEUX.filter((g) => g !== 'passeur') });
  await A.etat((s) => s.pool && same(s.pool.eligible, ['passeur']), 6000, 0, 'seul Le Passeur');
  const S = { A, B, C, code, ids, tab: onglet(), profil: joueur(ids.a, 'Ana'), pages: [] };
  S.attendu = { [ids.a]: 20, [ids.b]: 30, [ids.c]: 10 };
  S.hubVu = () => S.B.last();
  S.fin = (drawId, ms = 8000) => S.B.etat((s) => s.state === 'debrief' && s.launch && s.launch.drawId === drawId && s.launch.stage === 'ended', ms, 0, 'debrief');
  return S;
}
// Tirage + « continuer », depuis le client brut de l'hôte (sur /games/).
async function tirage(S) {
  let m = S.A.mark();
  S.A.send({ action: 'draw' });
  const d = (await S.A.etat((s) => s.draw && s.draw.status === 'drawn', 6000, m, 'tirage')).draw;
  m = S.A.mark();
  S.A.send({ action: 'continue' });
  await S.A.etat((s) => s.state === 'launching', 6000, m, 'launching');
  return d.id;
}
// L'hôte « ouvre Le Passeur » : billet, navigation (son socket /games/ se
// ferme), page du jeu avec le VRAI HubHandoff.start ; les invités entrent.
async function lancement(S) {
  const drawId = await tirage(S);
  await S.A.fermer();
  const J = page(S.tab, S.profil);
  S.pages.push(J);
  J.HH.write({ hub: HUB, session: S.code, playerId: S.ids.a, drawId, gameId: 'passeur', role: 'host' });
  let lien = null;
  lien = J.HH.start({ gameId: 'passeur', join: (c) => J.ctx.setTimeout(() => lien.roomReady(c || ROOM, 'ga'), 10) });
  J.lien = lien;
  J.drawId = drawId;
  await S.B.etat((s) => s.launch && s.launch.drawId === drawId && s.launch.stage === 'join', 8000, 0, 'room déclarée');
  S.B.send({ action: 'entered', drawId, roomCode: ROOM, gamePlayerId: 'gb' });
  S.C.send({ action: 'entered', drawId, roomCode: ROOM, gamePlayerId: 'gc' });
  await S.B.etat((s) => s.state === 'inGame' && s.launch.stage === 'playing', 6000, 0, 'playing');
  await attendre(() => J.hubSock(), 4000, 'socket Hub de la page du jeu');
  return J;
}
async function ranger(S) {
  for (const P of S.pages) P.quitter();
  for (const c of [S.A, S.B, S.C]) await c.fermer().catch(() => {});
}
const actions = (P, depuis = 0) => P.envoyes.slice(depuis).map((f) => f.d && f.d.action).filter((a) => a === 'results' || a === 'ended');

// ─── scénarios ───────────────────────────────────────────────────────────
async function scenario(nom, f) {
  console.log(`\n${nom}\n`);
  try { await f(); } catch (e) { t(`${nom} — exception`, false, e.message); }
}

async function main() {
  // A. Témoin, + « results deux fois » + G « reconnexion après ended »
  await scenario('A. Envoi normal (+ doublon côté page, + reconnexion après la fin)', async () => {
    const S = await salon();
    const J = await lancement(S);
    const r1 = J.lien.results(CLASSEMENT);
    const r2 = J.lien.results(CLASSEMENT);
    J.lien.ended();
    const s = await S.fin(J.drawId);
    t('A. score appliqué (Bob 30, Ana 20, Cam 10)', memes(s.scores, S.attendu), JSON.stringify(s.scores));
    t('A. debrief, lancement `ended`, `scored`', s.launch.stage === 'ended' && s.launch.scored === true && s.history.games.length === 1);
    t('A. results() deux fois : le second est refusé par la page', r1 === true && r2 === false);
    await sleep(300);
    t('A. sur le fil : un results, puis un ended, une seule fois', same(actions(J), ['results', 'ended']), actions(J).join(' → '));
    t('A. plus rien en attente dans le sessionStorage', attentes(S.tab).length === 0, attentes(S.tab).join());
    // G. — reconnexion APRÈS la fin : rien n'est renvoyé.
    const n0 = J.envoyes.length;
    const k = await couper(J);
    await J.reprise(k);
    await sleep(500);
    t('G. reconnexion après ended : ni results ni ended renvoyés', actions(J, n0).length === 0, actions(J, n0).join());
    t('G. score et historique inchangés', memes(S.hubVu().scores, S.attendu) && S.hubVu().history.games.length === 1 && S.hubVu().state === 'debrief');
    await ranger(S);
  });

  // B. Socket FERMÉ avant results → reconnexion → results rejoué
  await scenario('B. Socket fermé avant results, puis reconnexion', async () => {
    const S = await salon();
    const J = await lancement(S);
    const k = await couper(J);
    t('B. préalable : plus aucun socket Hub ouvert', !J.sockets.some((s) => s.readyState === 1));
    const r = J.lien.results(CLASSEMENT);
    t('B. results() pris en charge', r === true);
    const cle = PREFIXE + S.code + ':' + J.drawId;
    const garde = S.tab.mem.has(cle) ? JSON.parse(S.tab.mem.get(cle)) : null;
    t('B. le classement est GARDÉ dans le sessionStorage, clé session + tirage', same(attentes(S.tab), [cle]) && !!garde && same(garde.results, CLASSEMENT), attentes(S.tab).join());
    t('B. le Hub n\'a rien reçu (toujours playing, scored=false)', S.hubVu().launch.stage === 'playing' && S.hubVu().launch.scored === false);
    await J.reprise(k);
    const s = await S.B.etat((x) => x.launch && x.launch.scored, 6000, 0, 'scored').catch(() => S.hubVu());
    t('B. après reprise : results rejoué et compté', memes(s.scores, S.attendu) && s.history.games.length === 1, JSON.stringify(s.scores));
    J.lien.ended();
    const f = await S.fin(J.drawId).catch(() => S.hubVu());
    t('B. puis ended → debrief', f.state === 'debrief' && f.launch.stage === 'ended');
    await sleep(200);
    t('B. un seul results sur le fil au total', J.trames('results').length === 1, String(J.trames('results').length));
    t('B. attente nettoyée', attentes(S.tab).length === 0);
    await ranger(S);
  });

  // C. results pendant que le NOUVEAU socket est en CONNECTING
  await scenario('C. results() sur un socket en CONNECTING', async () => {
    const S = await salon();
    const J = await lancement(S);
    let etat = null, r = null;
    J.onNew = (sock) => { etat = sock.readyState; r = J.lien.results(CLASSEMENT); };
    const k = await couper(J);
    await J.reprise(k);
    t('C. préalable : appel fait pendant CONNECTING (readyState 0)', etat === 0, 'readyState=' + etat);
    t('C. results() pris en charge', r === true);
    const s = await S.B.etat((x) => x.launch && x.launch.scored, 6000, 0, 'scored').catch(() => S.hubVu());
    t('C. après reprise : results rejoué et compté', memes(s.scores, S.attendu) && s.history.games.length === 1, JSON.stringify(s.scores));
    J.lien.ended();
    const f = await S.fin(J.drawId).catch(() => S.hubVu());
    t('C. puis ended → debrief, score intact', f.state === 'debrief' && memes(f.scores, S.attendu));
    t('C. attente nettoyée', attentes(S.tab).length === 0);
    await ranger(S);
  });

  // D. results livré, socket perdu AVANT ended → ended rejoué
  await scenario('D. results livré, socket perdu avant ended', async () => {
    const S = await salon();
    const J = await lancement(S);
    J.lien.results(CLASSEMENT);
    await S.B.etat((x) => x.launch && x.launch.scored, 6000, 0, 'scored');
    await attendre(() => attentes(S.tab).length === 0, 3000, 'confirmation vue par la page').catch(() => {});
    const k = await couper(J);
    J.lien.ended();
    t('D. l\'intention de fin est gardée', attentes(S.tab).length === 1 && JSON.parse(S.tab.mem.get(attentes(S.tab)[0])).ended === true);
    t('D. le Hub est encore en inGame / playing', S.hubVu().state === 'inGame' && S.hubVu().launch.stage === 'playing');
    await J.reprise(k);
    const f = await S.fin(J.drawId).catch(() => S.hubVu());
    t('D. après reprise : ended rejoué → debrief', f.state === 'debrief' && f.launch.stage === 'ended', `state=${f.state}`);
    t('D. score compté une fois', memes(f.scores, S.attendu) && f.history.games.length === 1);
    t('D. un seul ended sur le fil', J.trames('ended').length === 1 && J.trames('results').length === 1);
    t('D. attente nettoyée', attentes(S.tab).length === 0);
    await ranger(S);
  });

  // E. results ET ended perdus → reconnexion → results puis ended
  await scenario('E. results et ended perdus tous les deux', async () => {
    const S = await salon();
    const J = await lancement(S);
    const k = await couper(J, { bloquer: true });
    J.lien.results(CLASSEMENT);
    J.lien.ended();
    await sleep(1300);                       // une tentative de reprise échoue (Hub injoignable)
    const g = attentes(S.tab).length === 1 ? JSON.parse(S.tab.mem.get(attentes(S.tab)[0])) : null;
    t('E. les deux intentions sont gardées dans UNE entrée (ce tirage)', !!g && same(g.results, CLASSEMENT) && g.ended === true);
    t('E. le Hub n\'a rien reçu', S.hubVu().state === 'inGame' && S.hubVu().launch.scored === false);
    J.bloque = false;
    const n = J.envoyes.length;
    await J.reprise(k, 15000);
    const f = await S.fin(J.drawId, 10000).catch(() => S.hubVu());
    t('E. après reprise : partie comptée et terminée', f.state === 'debrief' && f.launch.stage === 'ended' && memes(f.scores, S.attendu), `state=${f.state} ${JSON.stringify(f.scores)}`);
    t('E. dans l\'ordre : results PUIS ended, une fois chacun', same(actions(J, n), ['results', 'ended']), actions(J, n).join(' → '));
    t('E. attente nettoyée', attentes(S.tab).length === 0);
    await ranger(S);
  });

  // F. results APPLIQUÉ mais confirmation jamais vue → reconnexion → pas de double score
  await scenario('F. results appliqué, confirmation perdue, puis reconnexion', async () => {
    const S = await salon();
    const J = await lancement(S);
    J.sourd = true;                          // les diffusions du Hub ne lui arrivent plus
    J.lien.results(CLASSEMENT);
    J.lien.ended();
    await S.B.etat((x) => x.launch && x.launch.scored, 6000, 0, 'scored');
    await sleep(300);
    t('F. le Hub a compté ; ended attend la confirmation (toujours inGame)', memes(S.hubVu().scores, S.attendu) && S.hubVu().state === 'inGame');
    const k = await couper(J);
    J.sourd = false;
    await J.reprise(k);
    const f = await S.fin(J.drawId).catch(() => S.hubVu());
    t('F. après reprise : scored vu dans l\'état → results NON renvoyé', J.trames('results').length === 1, String(J.trames('results').length));
    t('F. ended envoyé → debrief, AUCUN double score', f.state === 'debrief' && memes(f.scores, S.attendu) && f.history.games.length === 1, JSON.stringify(f.scores));
    t('F. attente nettoyée', attentes(S.tab).length === 0);
    await ranger(S);
  });

  // H. Page Hub rechargée pendant la livraison
  await scenario('H. Retour au Hub puis rechargement pendant la livraison', async () => {
    const S = await salon();
    const J = await lancement(S);
    await couper(J, { bloquer: true });
    J.lien.results(CLASSEMENT);
    J.lien.ended();
    J.quitter();                             // « Retour au Game Hub » : la page du jeu meurt
    t('H. l\'attente survit à la page du jeu', attentes(S.tab).length === 1);
    // /games/ (1) : elle livre results… et elle est rechargée AVANT d'avoir vu
    // la confirmation (sourde dès l'envoi, puis quittée).
    const H1 = page(S.tab, S.profil);
    S.pages.push(H1);
    H1.apresEnvoi = (d) => { if (d && d.action === 'results') H1.sourd = true; };
    const hub1 = H1.GH.createClient({ url: HUB });
    if (typeof H1.HH.attach === 'function') H1.HH.attach(hub1);
    await hub1.join(S.code, H1.GH.playerFrom(S.profil)).catch(() => {});
    await S.B.etat((x) => x.launch && x.launch.scored, 6000, 0, 'scored').catch(() => {});
    t('H. /games/ (1ʳᵉ page) : results livré', memes(S.hubVu().scores, S.attendu), JSON.stringify(S.hubVu().scores));
    H1.quitter();                            // rechargement
    const H2 = await pageHub(S.tab, S.profil, S.code);
    S.pages.push(H2);
    const f = await S.fin(J.drawId).catch(() => S.hubVu());
    t('H. /games/ (rechargée) : ended livré → debrief', f.state === 'debrief' && f.launch.stage === 'ended', `state=${f.state}`);
    t('H. results envoyé UNE fois en tout (jeu 0, /games/ 1, rechargée 0)', J.trames('results').length + H1.trames('results').length + H2.trames('results').length === 1 && H2.trames('results').length === 0,
      [J, H1, H2].map((P) => P.trames('results').length).join(' / '));
    t('H. aucun double score', memes(f.scores, S.attendu) && f.history.games.length === 1);
    t('H. attente nettoyée', attentes(S.tab).length === 0);
    await ranger(S);
  });

  // I. Le classement d'un ANCIEN tirage n'est jamais appliqué à une nouvelle partie
  await scenario('I. Ancien tirage et autre session : jamais rejoués', async () => {
    const S = await salon();
    const J = await lancement(S);
    const d1 = J.drawId;
    await couper(J, { bloquer: true });
    J.lien.results(CLASSEMENT);
    J.lien.ended();
    J.quitter();
    // Une attente d'une AUTRE soirée, dans le même onglet.
    poseAttente(S.tab, { session: 'ZZZZZ', drawId: 'd_autre', results: CLASSEMENT, ended: true });
    // L'hôte revient par un autre chemin (bouton « Partie terminée » de /games/),
    // sans classement, puis relance un tirage.
    S.A = await entre('Ana', S.ids.a, S.code);
    const m = S.A.mark();
    S.A.send({ action: 'ended', drawId: d1 });
    await S.A.etat((s) => s.state === 'debrief', 6000, m, 'debrief manuel');
    const d2 = await tirage(S);
    await S.A.fermer();
    const H = await pageHub(S.tab, S.profil, S.code);
    S.pages.push(H);
    await sleep(600);
    const s = S.hubVu();
    t('I. préalable : nouveau tirage en cours', s.launch && s.launch.drawId === d2 && d2 !== d1);
    t('I. le classement de l\'ancien tirage n\'est jamais envoyé', H.trames('results').length === 0 && H.trames('ended').length === 0, actions(H).join());
    t('I. aucun point appliqué', memes(s.scores, {}) && s.history.games.length === 0 && !s.launch.scored);
    t('I. attentes périmées effacées (ancien tirage ET autre session)', attentes(S.tab).length === 0, attentes(S.tab).join());
    await ranger(S);
  });

  // Règles internes, avec un faux client du Hub (aucun réseau).
  await scenario('P. Règles du module, faux client (sans réseau)', async () => {
    const tab = onglet();
    const P = page(tab, joueur('p_moi1', 'Moi'));
    if (typeof P.HH.attach !== 'function') { t('P. HubHandoff.attach existe', false); return; }
    const faux = () => {
      const h = { handlers: {}, sent: [], open: true, connection: 1 };
      h.on = (ev, f) => { (h.handlers[ev] = h.handlers[ev] || []).push(f); return h; };
      h.emit = (ev, d) => (h.handlers[ev] || []).forEach((f) => f(d));
      h.results = (dr) => { if (!h.open) return false; h.sent.push('results:' + dr); return true; };
      h.ended = (dr) => { if (!h.open) return false; h.sent.push('ended:' + dr); return true; };
      h.etat = (drawId, stage, scored = false, code = 'ABCDE') => h.emit('session', { session: { code, state: stage === 'ended' ? 'debrief' : 'inGame', launch: { drawId, stage, scored } }, you: 'p_moi1' });
      return h;
    };
    const vider = () => attentes(tab).forEach((k) => tab.mem.delete(k));

    let h = faux(); P.HH.attach(h);
    poseAttente(tab, { session: 'ABCDE', drawId: 'd1', results: CLASSEMENT, ended: true });
    for (let i = 0; i < 10; i++) h.etat('d1', 'playing');
    t('P. pas de boucle : dix diffusions sur la MÊME connexion → un seul envoi', same(h.sent, ['results:d1']), h.sent.join());
    h.connection = 2; h.etat('d1', 'playing');
    t('P. nouvelle connexion sans confirmation → renvoyé une fois', same(h.sent, ['results:d1', 'results:d1']));
    h.emit('error', { code: 'RESULTS_ALREADY' });
    t('P. RESULTS_ALREADY = confirmé → ended part aussitôt', same(h.sent.slice(2), ['ended:d1']), h.sent.join());
    h.etat('d1', 'ended', true);
    t('P. stage ended = fin confirmée → attente effacée', attentes(tab).length === 0);

    vider(); h = faux(); P.HH.attach(h);
    poseAttente(tab, { session: 'ABCDE', drawId: 'd2', results: CLASSEMENT, ended: true });
    h.etat('d2', 'playing');
    h.emit('error', { code: 'BAD_RESULTS' });
    t('P. refus définitif (BAD_RESULTS) → classement abandonné, ended part quand même', same(h.sent, ['results:d2', 'ended:d2']), h.sent.join());

    vider(); h = faux(); P.HH.attach(h);
    poseAttente(tab, { session: 'ABCDE', drawId: 'd3', results: CLASSEMENT, ended: true });
    for (let c = 1; c <= 8; c++) { h.connection = c; h.etat('d3', 'playing'); }
    const n3 = h.sent.filter((x) => x === 'results:d3').length;
    t('P. borné : au plus 5 envois du classement, puis abandon (ended part)', n3 === 5 && h.sent.includes('ended:d3'), `${n3} envois`);

    vider(); h = faux(); P.HH.attach(h);
    poseAttente(tab, { session: 'ABCDE', drawId: 'd4', results: CLASSEMENT, ended: true });
    h.etat('d4', 'join');
    t('P. étape join : le Hub refuserait results → on attend, rien n\'est perdu', h.sent.length === 0 && attentes(tab).length === 1);
    h.etat('d4', 'playing');
    t('P. puis playing → envoyé', same(h.sent, ['results:d4']));

    vider(); h = faux(); P.HH.attach(h);
    poseAttente(tab, { session: 'ABCDE', drawId: 'd5', results: CLASSEMENT, ended: true });
    h.open = false; h.etat('d5', 'playing');
    t('P. socket fermé : rien n\'est compté comme envoyé', h.sent.length === 0);
    h.open = true; h.etat('d5', 'playing');
    t('P. socket rouvert, même connexion : envoyé', same(h.sent, ['results:d5']));

    vider(); h = faux(); P.HH.attach(h);
    poseAttente(tab, { session: 'ABCDE', drawId: 'd6', results: CLASSEMENT, ended: true });
    h.etat('d6', 'failed');
    t('P. lancement échoué → attente abandonnée sans envoi', h.sent.length === 0 && attentes(tab).length === 0);
    P.quitter();
  });

  // Le raccord de /games/ : hub-page.js branche la livraison sur SON client.
  console.log('\nRaccords\n');
  const hp = lire('games/hub-page.js');
  t('hub-page.js branche HubHandoff.attach sur son client du Hub', /HubHandoff\.attach\(hub\)/.test(hp));
  const pages = ['index.html', ...['ban', 'demicercle', 'imitation', 'morpion', 'passeur', 'precision', 'quiment'].map((j) => j + '/index.html')];
  const version = (f) => pages.map((p) => (lire('games/' + p).match(new RegExp(`src="[^"]*${f}(\\?v=\\d+)?"`)) || ['?'])[0].replace(/^src="(\.\.\/)?/, ''));
  t('les huit pages chargent la MÊME version de game-hub.js', new Set(version('game-hub\\.js')).size === 1, [...new Set(version('game-hub\\.js'))].join(' | '));
  t('les huit pages chargent la MÊME version de hub-handoff.js', new Set(version('hub-handoff\\.js')).size === 1, [...new Set(version('hub-handoff\\.js'))].join(' | '));
}

// ─── montage ─────────────────────────────────────────────────────────────
const sante = await fakeHealth(HEALTH_PORT);
const MANIFEST = localManifest(ROOT, HEALTH_PORT);
const hubProc = spawn(process.execPath, ['src/server.js'], {
  cwd: path.join(ROOT, '..', 'game-hub-server'),
  env: { ...process.env, PORT: String(HUB_PORT), HUB_QUIET: '1', MANIFEST_FILE: MANIFEST },
  stdio: 'ignore',
});
const stop = () => { try { hubProc.kill(); } catch (_) {} sante.close(); try { fs.unlinkSync(MANIFEST); } catch (_) {} };
try {
  let pret = false;
  for (let i = 0; i < 100 && !pret; i++) { try { pret = (await fetch(`http://127.0.0.1:${HUB_PORT}/health`)).ok; } catch (_) { await sleep(100); } }
  if (!pret) throw new Error('game-hub-server local injoignable');
  console.log('Livraison fiable results → ended — vrai Hub local, vrais modules du portfolio');
  await main();
} catch (e) {
  t('EXCEPTION', false, e.message);
} finally {
  stop();
}
console.log(`\n${ko ? 'DES TESTS ÉCHOUENT' : 'TOUT PASSE'} — ${ok + ko} vérifications, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
