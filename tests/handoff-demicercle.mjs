// Handoff Hub → Demi-Cercle, de bout en bout : le vrai game-hub-server et le
// VRAI demicercle-server, lancés en local depuis les dépôts voisins. Aucun
// mock : le code de room est celui que demicercle-server fabrique.
//
//   node tests/handoff-demicercle.mjs
//   node tests/handoff-demicercle.mjs --reduced       mouvement réduit
//   node tests/handoff-demicercle.mjs --shots <dir>   une capture par étape
//
// Trois étages, du plus sec au plus réel :
//
//   1. le billet, sans réseau ni navigateur ;
//   2. le PROTOCOLE, deux joueurs en Node : A crée la session du Hub, B
//      rejoint → seul Demi-Cercle éligible → A tire → A crée la room (join
//      SANS code, le protocole normal du jeu) → A déclare le code → B le
//      relit dans SON état de session et rejoint CE code → inGame → une vraie
//      partie jusqu'au bout, avec l'ordre exact des trames de fin (`phase:end`
//      PUIS `room` en phase lobby) → un retardataire est refusé → ended ;
//   3. de VRAIS NAVIGATEURS (Edge par le protocole DevTools, trois contextes
//      isolés) : portfolio → /games/ → tirage → la page du Demi-Cercle crée la
//      room toute seule → B rejoint → « Lancer » attend Chloé → A lance SANS
//      l'attendre → Chloé, en retard, est refusée → deux manches jouées à la
//      souris → podium, qui RESTE à l'écran malgré le `room` lobby qui suit →
//      retour au salon → retour au Hub. Puis deux joueurs HORS Hub : la page
//      se joue exactement comme avant.
//
// ⚠️ AUCUN SECOND PROTOCOLE DE ROOM. Le Hub ne parle jamais à
// demicercle-server : ce sont les pages qui lui parlent, par son `join`
// habituel. Le Hub ne fait que relayer le code et arbitrer qui a le droit de
// le déclarer. C'est le montage du Passeur (handoff.mjs, handoff-play.mjs) et
// d'Imitation (handoff-imitation.mjs).
//
// ⚠️ demicercle-server a besoin de `ws`. Sur un poste où son `npm install`
// n'a pas été fait, NODE_PATH peut pointer sur un autre node_modules qui l'a
// (celui de game-hub-server, par exemple) : le processus fils en hérite.
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { fakeHealth, localManifest } from './hub-fixture.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const EDGE = arg('--edge') || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const REDUCED = process.argv.includes('--reduced');
const SHOTS = arg('--shots');
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
// L'alphabet des codes de room du Demi-Cercle (src/server.js : sans I, L, O, 0, 1).
const CODE_RE = /^[A-HJKMNP-Z2-9]{4}$/;
const require = createRequire(import.meta.url);
const H = require(path.join(ROOT, 'games/shared/game-hub.js'));
const HH = require(path.join(ROOT, 'games/shared/hub-handoff.js'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = () => Math.floor(Math.random() * 300);
const HUB_PORT = 8300 + R(), DEMI_PORT = 8900 + R(), HEALTH_PORT = 6100 + R(), HTTP_PORT = 8700 + R(), CDP_PORT = 9700 + R();

let out = [], ko = 0;
const t = (nom, ok, detail = '') => {
  out.push(`${ok ? 'OK  ' : 'KO  '} ${nom}${detail ? ' — ' + detail : ''}`);
  if (!ok) ko++;
  console.log(out[out.length - 1]);
};

// ═══════════════════════════════ 1. le billet, sans réseau ni navigateur
// Le handshake commence par là : une page de jeu n'accepte un billet que s'il
// est pour ELLE, pour ce profil, et récent.
console.log('Handoff Demi-Cercle — le billet\n');
const BON = { v: 1, hub: 'ws://127.0.0.1:8100', session: 'AB2DE', playerId: 'p_alice', drawId: 'd_1', gameId: 'demicercle', role: 'host', at: Date.now() };
t('billet valable pour demicercle', !!HH.readTicket(BON, 'demicercle'));
t('billet d\'un AUTRE jeu : refusé par la page Demi-Cercle', !HH.readTicket({ ...BON, gameId: 'imitation' }, 'demicercle'));
t('billet sans rôle connu : refusé', !HH.readTicket({ ...BON, role: 'spectateur' }, 'demicercle'));
t('billet périmé (plus de 3 h) : refusé', !HH.readTicket({ ...BON, at: Date.now() - HH.MAX_AGE_MS - 1000 }, 'demicercle'));
t('billet au code de session bidon : refusé', !HH.readTicket({ ...BON, session: 'abc' }, 'demicercle'));
t('billet dont le hub n\'est pas une URL WebSocket : refusé', !HH.readTicket({ ...BON, hub: 'http://x' }, 'demicercle'));
t('les deux rôles sont acceptés', !!HH.readTicket({ ...BON, role: 'guest' }, 'demicercle'));

// ═══════════════════════════════ 2. les vrais serveurs
const procs = [];
const lance = (cwd, file, port, env = {}) => {
  const p = spawn(process.execPath, [file], { cwd, env: { ...process.env, PORT: String(port), HUB_QUIET: '1', ...env }, stdio: 'ignore' });
  procs.push(p); return p;
};
async function attends(url) { for (let i = 0; i < 100; i++) { try { const r = await fetch(url); if (r.ok) return; } catch (_) {} await sleep(100); } throw new Error('injoignable : ' + url); }

const sante = await fakeHealth(HEALTH_PORT);
const MANIFEST = localManifest(ROOT, HEALTH_PORT, { demicercle: `http://127.0.0.1:${DEMI_PORT}/` });
lance(path.join(ROOT, '..', 'demicercle-server'), 'src/server.js', DEMI_PORT);
lance(path.join(ROOT, '..', 'game-hub-server'), 'src/server.js', HUB_PORT, { MANIFEST_FILE: MANIFEST });
const HUB = `ws://127.0.0.1:${HUB_PORT}`, DEMI = `ws://127.0.0.1:${DEMI_PORT}`;

let edge = null, cdp = null, srv = null, dir = null;
const joueurs = [];   // pour le diagnostic en cas d'échec
const stop = () => {
  if (edge) { try { execFileSync('taskkill', ['/PID', String(edge.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (_) { try { edge.kill(); } catch (__) {} } }
  procs.forEach((p) => { try { p.kill(); } catch (_) {} });
  try { cdp && cdp.close(); } catch (_) {}
  try { srv && srv.close(); } catch (_) {}
  sante.close();
  if (dir) try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  try { fs.unlinkSync(MANIFEST); } catch (_) {}
};

function suivi(client) {
  const s = { last: null, errors: [] };
  client.on('session', (x) => { s.last = x.session; });
  client.on('error', (e) => s.errors.push(e));
  s.until = async (cond, ms = 8000) => { const fin = Date.now() + ms; while (Date.now() < fin) { if (s.last && cond(s.last)) return s.last; await sleep(20); } return null; };
  return s;
}
const hubClient = () => H.createClient({ url: HUB, retryDelays: [], connectTimeout: 5000 });

// Le client du jeu : un WebSocket vers demicercle-server, rien d'autre.
function demi() {
  const ws = new WebSocket(DEMI);
  const c = { ws, msgs: [] };
  ws.onmessage = (e) => { if (typeof e.data === 'string') c.msgs.push(JSON.parse(e.data)); };
  c.open = new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('demicercle injoignable')); });
  c.send = (o) => ws.send(JSON.stringify(o));
  c.wait = async (pred, ms = 8000) => { const fin = Date.now() + ms; while (Date.now() < fin) { const m = c.msgs.find(pred); if (m) return m; await sleep(20); } return null; };
  c.last = (type) => [...c.msgs].reverse().find((m) => m.type === type);
  return c;
}
// Le join du Demi-Cercle : SANS `code` pour créer, AVEC pour rejoindre. Aucun
// champ inventé pour le Hub — c'est le protocole du jeu, tel quel.
const joinDemi = (p, code) => (code === undefined
  ? { action: 'join', name: p.name, avatar: p.avatar }
  : { action: 'join', name: p.name, avatar: p.avatar, code });

const IMG = 'data:image/webp;base64,' + fs.readFileSync(path.join(ROOT, '..', 'demicercle-server', 'test-fixtures', 'avatar-96.webp')).toString('base64');
const pA = { id: 'p_alicedemi', name: 'Alice', avatar: { kind: 'image', emoji: '🦊', src: IMG } };
const pB = { id: 'p_brunodemi', name: 'Bruno', avatar: { kind: 'emoji', emoji: '🐼' } };

try {
  await attends(`http://127.0.0.1:${DEMI_PORT}/`);
  await attends(`http://127.0.0.1:${HUB_PORT}/health`);
  console.log(`\nHandoff Hub → Demi-Cercle — protocole réel (Hub :${HUB_PORT}, Demi-Cercle :${DEMI_PORT})\n`);

  // ═══ 3. le groupe, et un tirage qui ne peut donner que Demi-Cercle
  const A = hubClient(), B = hubClient();
  const sA = suivi(A), sB = suivi(B);
  const code = (await A.create(pA)).session.code;
  await B.join(code, pB);
  await sA.until((s) => s.pool && s.pool.catalog === 'ready' && s.players.length === 2);
  B.setPrefs([], ['morpion', 'imitation', 'ban', 'precision', 'passeur']);
  const seul = await sA.until((s) => JSON.stringify(s.pool.eligible) === '["demicercle"]');
  t('le groupe (2) : seul Demi-Cercle est éligible (vetos de B)', !!seul, JSON.stringify(sA.last.pool.eligible));
  t('le manifest annonce le handoff de Demi-Cercle', JSON.parse(fs.readFileSync(path.join(ROOT, 'data/games.manifest.json'), 'utf8')).games.find((g) => g.id === 'demicercle').handoff === true);
  A.draw();
  const tire = await sA.until((s) => s.draw && s.draw.status === 'drawn');
  t('tirage serveur : Demi-Cercle', !!tire && tire.draw.gameId === 'demicercle', tire && tire.draw.gameId);
  const drawId = tire.draw.id;

  // ═══ 4. continuer → lancement, rôles, URL
  A.confirm();
  const l0 = await sB.until((s) => s.state === 'launching');
  t('continuer → launching (stage create), lié au tirage', !!l0 && l0.launch.stage === 'create' && l0.launch.drawId === drawId);
  t('rôles : A host du lancement, B guest', l0.launch.hostId === pA.id && l0.launch.hostId !== pB.id);
  t('le Hub donne l\'URL du jeu (manifest)', l0.launch.url === 'games/demicercle/', l0.launch.url);

  // ═══ 5. A « navigue » : sa page du Hub se ferme, la page du jeu rouvre le Hub
  A._drop();
  await sB.until((s) => s.players.find((p) => p.id === pA.id).connected === false, 4000);
  const A2 = hubClient(), sA2 = suivi(A2);
  await A2.join(code, pA);
  t('navigation de A : même player.id, toujours hôte du lancement',
    sA2.last.hostId === pA.id && sA2.last.launch.hostId === pA.id && sA2.last.players.length === 2);

  // ═══ 6. A crée la room par le protocole NORMAL du Demi-Cercle : join SANS code
  const DA = demi(); await DA.open;
  DA.send(joinDemi(pA));
  const roomA = await DA.wait((m) => m.type === 'room');
  const moiA = roomA && roomA.players.find((p) => p.id === roomA.you);
  t('Demi-Cercle : room créée par un join SANS code, vrai code renvoyé', !!roomA && CODE_RE.test(roomA.code), roomA && roomA.code);
  t('Demi-Cercle : le créateur est le MJ (host) de la room', !!moiA && moiA.host === true);
  const roomCode = roomA.code;

  // Un invité tente de déclarer SA room à la place de l'hôte du lancement.
  const errB0 = sB.errors.length;
  B.launched(drawId, 'ZZZZ');
  await sleep(300);
  t('un guest qui déclare un code : refusé (NOT_HOST)',
    sB.errors.length > errB0 && sB.errors[sB.errors.length - 1].code === 'NOT_HOST');

  // ═══ 7. le code remonte au Hub, qui le relaie
  A2.launched(drawId, roomCode);
  const go = await sB.until((s) => s.launch && s.launch.stage === 'join');
  t('go : B reçoit LE code de la room créée par A', !!go && go.launch.roomCode === roomCode, go && go.launch.roomCode);
  t('waiting : B attendu, A déjà dedans',
    JSON.stringify(go.launch.entered) === JSON.stringify([pA.id]) && JSON.stringify(go.launch.waiting) === JSON.stringify([pB.id]));
  // Le code ne se déclare qu'une fois : un second `launched` est refusé.
  const errA0 = sA2.errors.length;
  A2.launched(drawId, roomCode);
  await sleep(300);
  t('un second `launched` du même code : refusé (LAUNCH_CONSUMED)',
    sA2.errors.length > errA0 && sA2.errors[sA2.errors.length - 1].code === 'LAUNCH_CONSUMED');

  // ═══ 8. B « navigue » et rejoint CE code, par le chemin normal
  B._drop();
  const B2 = hubClient(), sB2 = suivi(B2);
  await B2.join(code, pB);
  const vuB = sB2.last.launch.roomCode;
  t('B relit le code dans SON état de session (il ne le saisit pas)', vuB === roomCode, vuB);
  const DB = demi(); await DB.open;
  DB.send(joinDemi(pB, vuB));                                  // le code vient du HUB
  const roomB = await DB.wait((m) => m.type === 'room');
  const moiB = roomB && roomB.players.find((p) => p.id === roomB.you);
  t('B : entré dans la room Demi-Cercle par le protocole normal (join + code)',
    !!roomB && roomB.code === roomCode && !!moiB && moiB.host === false);
  B2.entered(drawId, roomB.code);
  const enJeu = await sA2.until((s) => s.state === 'inGame');
  t('Hub : tout le groupe est entré → inGame, personne en attente',
    !!enJeu && enJeu.launch.waiting.length === 0 && enJeu.launch.entered.length === 2);

  // ═══ 9. UNE seule room, vue par demicercle-server lui-même
  await sleep(300);
  const lob = DA.last('room');
  t('Demi-Cercle : A + B dans LA MÊME room (vue du serveur du jeu)',
    !!lob && lob.code === roomCode && lob.players.length === 2
    && ['Alice', 'Bruno'].every((n) => lob.players.some((p) => p.name === n)), lob && lob.players.map((p) => p.name).join(','));
  const pa = lob.players.find((p) => p.name === 'Alice');
  t('la vraie PP de A arrive dans le Demi-Cercle (image, pas l\'emoji)', !!pa && pa.avatar && pa.avatar.kind === 'image' && pa.avatar.src === IMG);

  // ═══ 10. une vraie partie, jusqu'au bout
  DA.send({ action: 'start', rounds: 1 });
  const setA = await DA.wait((m) => m.type === 'phase' && m.phase === 'setup');
  const setB = await DB.wait((m) => m.type === 'phase' && m.phase === 'setup');
  t('A démarre : les deux reçoivent la phase setup de la manche 1',
    !!setA && !!setB && setA.round === 1 && setB.round === 1, setA && `manche ${setA.round}/${setA.of}`);
  t('zéro confiance : la cible part au Guide (A), jamais au devineur (B)',
    setA.guide === roomA.you && typeof setA.target === 'number' && !('target' in setB));
  A2.started(drawId);
  await sleep(200);
  t('Hub : toujours inGame pendant la partie', sA2.last.state === 'inGame', sA2.last.state);

  // Un retardataire, avec le bon code, pendant la partie : le serveur du jeu
  // refuse, et c'est à lui de le faire (le Hub n'en sait rien).
  const DC = demi(); await DC.open;
  DC.send(joinDemi({ name: 'Chloé', avatar: { kind: 'emoji', emoji: '🐸' } }, roomCode));
  const refus = await DC.wait((m) => m.type === 'error');
  t('un retardataire est refusé (« partie en cours »), la room garde 2 joueurs',
    !!refus && /partie en cours/.test(refus.message) && !DC.msgs.some((m) => m.type === 'room'), refus && refus.message);

  DA.send({ action: 'next' });                                  // setup → clue
  await DA.wait((m) => m.type === 'phase' && m.phase === 'clue');
  DA.send({ action: 'clue', text: 'tiède' });
  await DB.wait((m) => m.type === 'phase' && m.phase === 'guessing');
  DB.send({ action: 'guess', value: 60 });
  const res = await DB.wait((m) => m.type === 'phase' && m.phase === 'results');
  t('manche 1 : indice, vote, résultats notés par le serveur', !!res && res.guesses.length === 1 && res.guesses[0].value === 60, res && `cible ${res.target}`);
  DA.send({ action: 'next' });                                  // results → fin
  const endB = await DB.wait((m) => m.type === 'phase' && m.phase === 'end');
  t('fin de partie : podium à deux joueurs', !!endB && endB.podium.length === 2);
  await sleep(200);
  const iEnd = DB.msgs.indexOf(endB);
  const lobbyApres = DB.msgs.findIndex((m, i) => i > iEnd && m.type === 'room' && m.phase === 'lobby');
  t('ORDRE DES TRAMES : `phase:end` PUIS `room` en phase lobby (d\'où la garde du podium)', iEnd >= 0 && lobbyApres > iEnd, `end #${iEnd}, room lobby #${lobbyApres}`);

  // ═══ 11. fin → retour au Hub
  A2.ended(drawId);
  const deb = await sB2.until((s) => s.state === 'debrief');
  t('ended : le Hub revient en debrief, prêt pour un nouveau tirage',
    !!deb && deb.launch.stage === 'ended' && deb.history.played[0] === 'demicercle');

  // ═══ 12. hors Hub : le jeu reste autonome
  const DD = demi(); await DD.open;
  DD.send(joinDemi({ name: 'Solo', avatar: { kind: 'emoji', emoji: '🎯' } }));
  const roomD = await DD.wait((m) => m.type === 'room');
  const DE = demi(); await DE.open;
  DE.send(joinDemi({ name: 'Duo', avatar: { kind: 'emoji', emoji: '🎧' } }, roomD.code));
  const roomE = await DE.wait((m) => m.type === 'room');
  t('hors Hub : une room SÉPARÉE, créée et rejointe à la main',
    !!roomE && roomE.code === roomD.code && roomE.players.length === 2 && roomD.code !== roomCode, roomD && roomD.code);

  for (const P of [DA, DB, DC, DD, DE]) { try { P.ws.close(); } catch (_) {} }
  for (const X of [A2, B2]) { try { X.leave(); } catch (_) {} }
  await sleep(200);
} catch (e) {
  t('EXCEPTION (protocole)', false, e && (e.stack || e.message));
}

// ═══════════════════════════════ 3. de vrais navigateurs
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json' };
// Le site tel quel, avec DEUX redirections propres au test : les liens réels
// (`games/` depuis la home, `games/demicercle/` depuis le Hub) n'ont pas de
// `?hub=` / `?server=` — ils iraient en production. On les redirige vers les
// serveurs locaux ; les liens eux-mêmes ne changent pas.
function serve() {
  const s = createServer((req, res) => {
    const [p0, q] = req.url.split('?');
    if (p0 === '/games/' && !/(^|&)hub=/.test(q || '')) { res.writeHead(302, { Location: `/games/?hub=${encodeURIComponent(HUB)}` }); return res.end(); }
    if (p0 === '/games/demicercle/' && !/(^|&)server=/.test(q || '')) { res.writeHead(302, { Location: `/games/demicercle/?server=${encodeURIComponent(DEMI)}` }); return res.end(); }
    let p = decodeURIComponent(p0);
    if (p.endsWith('/')) p += 'index.html';
    const full = path.join(ROOT, p);
    if (!full.startsWith(ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
    res.end(fs.readFileSync(full));
  });
  return new Promise((r) => s.listen(HTTP_PORT, '127.0.0.1', () => r(s)));
}

async function cdpBrowser() {
  let url = null;
  for (let i = 0; i < 60 && !url; i++) {
    try { url = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json()).webSocketDebuggerUrl; } catch (_) { await sleep(200); }
  }
  if (!url) throw new Error('Edge n\'a pas ouvert son protocole de debug');
  const ws = new WebSocket(url);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('CDP injoignable')); });
  let id = 0; const waiting = new Map(); const listeners = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); return; }
    if (m.method && m.sessionId && listeners.has(m.sessionId)) listeners.get(m.sessionId)(m);
  };
  return {
    send(method, params = {}, sessionId) { const mid = ++id; ws.send(JSON.stringify({ id: mid, method, params, sessionId })); return new Promise((r) => waiting.set(mid, r)); },
    on(sessionId, fn) { listeners.set(sessionId, fn); },
    close() { try { ws.close(); } catch (_) {} },
  };
}

async function joueur(nom) {
  const { result: { browserContextId } } = await cdp.send('Target.createBrowserContext', { disposeOnDetach: true });
  const { result: { targetId } } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { result: { sessionId } } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const J = { nom, erreurs: [], trames: [] };
  joueurs.push(J);
  cdp.on(sessionId, (m) => {
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      J.erreurs.push((d.exception?.description || d.text || '').split('\n')[0]);
    }
    if (m.method === 'Network.webSocketFrameReceived') {
      try { J.trames.push(JSON.parse(m.params.response.payloadData)); } catch (_) {}
    }
  });
  const S = (m, p) => cdp.send(m, p, sessionId);
  await S('Runtime.enable'); await S('Page.enable'); await S('DOM.enable'); await S('Network.enable');
  if (REDUCED) await S('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await S('Emulation.setDeviceMetricsOverride', { width: 1100, height: 1000, deviceScaleFactor: 1, mobile: false });
  J.eval = async (expression) => {
    const r = await S('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(`[${nom}] ` + (r.result.exceptionDetails.exception?.description || 'erreur JS').split('\n')[0]);
    return r.result?.result?.value;
  };
  J.navigate = (url) => S('Page.navigate', { url });
  J.until = async (expr, ms = 10000, label = expr) => {
    const fin = Date.now() + ms;
    while (Date.now() < fin) { try { const v = await J.eval(expr); if (v) return v; } catch (_) {} await sleep(80); }
    throw new Error(`[${nom}] attente expirée : ${label}`);
  };
  J.goto = async (url) => { await J.navigate(url); await J.until(`document.readyState === 'complete' && !!window.GameHub`, 15000, 'chargement ' + url); };
  J.box = (sel) => J.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null;
      e.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = e.getBoundingClientRect();
      return r.width && r.height ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; })()`);
  J.click = async (sel) => {
    const box = await J.box(sel);
    if (!box) throw new Error(`[${nom}] introuvable ou invisible : ${sel}`);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await S('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
    await sleep(80);
  };
  J.type = async (sel, text) => {
    await J.click(sel);
    await J.eval(`document.querySelector(${JSON.stringify(sel)}).select()`);
    await S('Input.insertText', { text });
    await sleep(60);
  };
  // Un élément qui ne bouge plus à l'écran (fin d'un défilement doux).
  J.immobile = async (sel, ms = 5000) => {
    const pos = `(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return r.top + ',' + r.left + ',' + scrollY; })()`;
    let avant = await J.eval(pos), stables = 0;
    const fin = Date.now() + ms;
    while (Date.now() < fin && stables < 3) { await sleep(100); const p = await J.eval(pos); stables = p === avant ? stables + 1 : 0; avant = p; }
  };
  J.visible = (sel) => J.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && !e.hidden && !!e.offsetParent; })()`);
  J.upload = async (sel, file) => {
    const { result: { root } } = await S('DOM.getDocument', { depth: 0 });
    const { result: { nodeId } } = await S('DOM.querySelector', { nodeId: root.nodeId, selector: sel });
    await S('DOM.setFileInputFiles', { files: [file], nodeId });
  };
  J.shot = async (nomFichier) => {
    if (!SHOTS) return;
    const r = await S('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOTS, (REDUCED ? 'r-' : '') + nomFichier + '.png'), Buffer.from(r.result.data, 'base64'));
  };
  // Trames du Hub (elles portent `session`) et du Demi-Cercle (types du jeu).
  J.hub = () => { for (let i = J.trames.length - 1; i >= 0; i--) if (J.trames[i].session) return J.trames[i].session; return null; };
  J.attendsTrame = async (pred, ms = 10000, label = 'trame') => {
    const fin = Date.now() + ms;
    while (Date.now() < fin) { const m = [...J.trames].reverse().find(pred); if (m) return m; await sleep(50); }
    throw new Error(`[${nom}] trame jamais reçue : ${label}`);
  };
  return J;
}

const surDemi = `location.pathname === '/games/demicercle/' && document.readyState === 'complete'`;
const texte = (J, id) => J.eval(`(document.getElementById(${JSON.stringify(id)}) || {}).textContent || ''`);

// Une partie complète au Demi-Cercle, à la souris : le MJ fait avancer, le
// Guide écrit son indice, les devineurs cliquent le cadran puis valident.
// Les Guides tournent dans l'ordre d'arrivée (src/server.js : pickGuide).
async function partie(mj, guides, tous) {
  for (let n = 0; n < guides.length; n++) {
    const guide = guides[n];
    for (let i = 0; i < 4 && !(await guide.visible('#clue-input')); i++) {
      await mj.until(`!document.getElementById('next-btn').hidden`, 8000, 'bouton du MJ');
      await mj.click('#next-btn');
      await sleep(300);
    }
    await guide.until(`!document.getElementById('clue-row').hidden`, 8000, 'saisie de l\'indice');
    await guide.type('#clue-input', n ? 'brûlant' : 'tiède');
    await guide.click('#clue-send');
    for (const devin of tous.filter((J) => J !== guide)) {
      await devin.until(`phase === 'guessing' && !document.getElementById('guess-send').hidden`, 8000, 'phase de vote');
      await devin.click('#dial');
      await devin.click('#guess-send');
    }
    await mj.until(`!document.getElementById('scores').hidden && phase === 'results'`, 8000, 'résultats ' + (n + 1));
  }
  await mj.click('#next-btn');                                   // dernière manche → fin
}

// Le podium tient-il ? On attend le `room` lobby qui suit `phase:end`, on
// laisse au client le temps de le traiter, PUIS on regarde l'écran.
async function podiumTient(J, nb) {
  const fin = await J.attendsTrame((m) => m.type === 'phase' && m.phase === 'end', 10000, 'phase end');
  const iEnd = J.trames.lastIndexOf(fin);
  await J.attendsTrame((m) => m.type === 'room' && m.phase === 'lobby' && J.trames.indexOf(m) > iEnd, 10000, 'room lobby après end');
  await sleep(600);
  return J.eval(`(() => {
    const vis = (id) => { const e = document.getElementById(id); return !!e && !e.hidden && !!e.offsetParent; };
    const sc = document.getElementById('scores');
    const r = sc.getBoundingClientRect();
    return { game: vis('game'), lobby: vis('lobby'), podium: vis('scores') && sc.querySelectorAll('li').length === ${nb} && r.height > 40,
      medailles: sc.querySelectorAll('.medal').length, titre: document.getElementById('stage-title').textContent,
      retour: vis('back-lobby'), hub: vis('to-hub') };
  })()`);
}

try {
  srv = await serve();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'handoffdemi-'));
  edge = spawn(EDGE, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${dir}`, '--no-first-run',
    '--disable-features=BackForwardCache', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank'], { stdio: 'ignore' });
  cdp = await cdpBrowser();
  const BASE = `http://127.0.0.1:${HTTP_PORT}`;
  const PAGE = `${BASE}/games/?hub=${encodeURIComponent(HUB)}`;
  console.log(`\nHandoff Hub → Demi-Cercle — trois navigateurs (${REDUCED ? 'mouvement RÉDUIT' : 'mouvement normal'})\n`);
  const A = await joueur('A'), B = await joueur('B'), C = await joueur('C');

  // ═══ 13. portfolio → Game Hub, trois profils, une session
  await A.navigate(BASE + '/');
  await A.until(`document.readyState === 'complete' && !!document.getElementById('hub-link')`, 15000, 'home');
  await A.click('#hub-link');
  await A.until(`location.pathname === '/games/' && !!window.GameHub && !!window.HubHandoff`, 15000, '/games/');
  await A.type('#name-input', 'Alice');
  await A.upload('#gp-file', path.join(ROOT, 'assets', 'og-image.png'));
  await A.until(`GameProfile.load().avatar.kind === 'image'`, 8000, 'photo de A');
  await A.click('#identity-done');
  const srcA = await A.eval(`GameProfile.load().avatar.src`);
  await A.click('#hub-create');
  await A.until(`!document.getElementById('lobby').hidden`, 20000, 'salon de A');
  const code = await A.eval(`document.getElementById('hub-code').textContent.trim()`);
  for (const [J, nom, rang] of [[B, 'Bruno', 2], [C, 'Chloé', 5]]) {
    await J.goto(PAGE);
    await J.type('#name-input', nom);
    await J.click(`#avatar-row .avatar-pick:nth-child(${rang})`);
    await J.click('#identity-done');
    await J.type('#hub-code-input', code);
    await J.click('#hub-join');
  }
  for (const J of [A, B, C]) await J.until(`document.querySelectorAll('#hub-players .hub-card').length === 3`, 20000, `${J.nom} au salon`);
  t('navigateurs : A crée la session du Hub, B et C la rejoignent', true, code);
  const idC = await C.eval(`GameProfile.load().id`);

  for (const id of ['imitation', 'ban', 'precision', 'passeur', 'quiment']) await B.click(`#hub-games [data-pref=veto][data-game=${id}]`);
  await A.until(`[...document.querySelectorAll('#hub-games .hub-game[data-eligible=true]')].map((x) => x.dataset.game).join() === 'demicercle'`, 8000, 'seul Demi-Cercle');
  await A.click('#hub-draw-btn');
  for (const J of [A, B, C]) await J.until(`document.getElementById('hub-result').dataset.game === 'demicercle' && !document.getElementById('hub-result').hidden`, 15000, `révélation ${J.nom}`);
  t('tirage : Demi-Cercle, révélé chez les trois', true);
  t('bouton de l\'hôte : « Continuer — lancer Demi-Cercle »', /lancer Demi-Cercle/.test(await texte(A, 'hub-continue')), await texte(A, 'hub-continue'));

  // ═══ 14. A ouvre le jeu : la room se crée toute seule
  await A.click('#hub-continue');
  await A.until(`!document.getElementById('launch-go').hidden`, 8000, 'Ouvrir');
  await A.click('#launch-go');                                    // même onglet, geste réel
  await A.until(surDemi, 15000, 'A sur Demi-Cercle');
  await A.until(`!document.getElementById('lobby').hidden && /^[A-Z2-9]{4}$/.test(document.getElementById('room-code').textContent.trim())`, 20000, 'room créée');
  const roomA = (await texte(A, 'room-code')).trim();
  t('host : la page du Demi-Cercle crée la room toute seule (join sans code)', CODE_RE.test(roomA)
    && A.trames.some((m) => m.type === 'room' && m.code === roomA && m.players.find((p) => p.id === m.you)?.host), roomA);
  const lancee = await A.attendsTrame((m) => m.session && m.session.launch && m.session.launch.roomCode === roomA, 8000, 'code au Hub');
  t('le code arrive au Hub (stage join) — celui de LA room du Demi-Cercle', lancee.session.launch.stage === 'join');
  const banA = await A.eval(`(document.querySelector('.g-hub-banner') || {}).textContent || ''`);
  t('bandeau Game Hub sur la page du Demi-Cercle', new RegExp(code).test(banA) && /attendus/.test(banA), banA);
  const att = await A.eval(`({ off: document.getElementById('start').disabled, txt: document.getElementById('start').textContent, sans: !document.getElementById('start-anyway').hidden })`);
  t('« Lancer » attend le groupe (désactivé, nomme les absents) + « Lancer sans attendre »', att.off && /Bruno/.test(att.txt) && /Chloé/.test(att.txt) && att.sans, att.txt);
  await A.shot('1-demi-hote-attend');

  // ═══ 15. B rejoint, par le bouton du Hub
  await B.until(`!document.getElementById('launch-go').hidden && /Rejoindre/.test(document.getElementById('launch-go').textContent)`, 10000, 'Rejoindre chez B');
  // ⚠️ Quand le code arrive, /games/ amène le bouton à l'écran par un défilement
  // DOUX (hub-page.js). Cliquer pendant ce défilement tombe là où le bouton
  // ÉTAIT : le clic se perd, sans erreur. On attend qu'il ne bouge plus.
  await B.immobile('#launch-go');
  await B.click('#launch-go');
  await B.until(surDemi, 15000, 'B sur Demi-Cercle');
  await B.until(`!document.getElementById('lobby').hidden && document.getElementById('room-code').textContent.trim() === ${JSON.stringify(roomA)}`, 20000, 'B dans la room');
  t('guest : auto-jointure de LA room, sans saisir de code', (await texte(B, 'room-code')).trim() === roomA);
  await A.until(`document.querySelectorAll('#players .g-player').length === 2`, 8000, '2 joueurs chez A');
  const entre = await A.attendsTrame((m) => m.session && m.session.launch && m.session.launch.entered.length === 2, 8000, 'entered');
  t('Hub : B déclaré `entered`, Chloé toujours attendue', entre.session.launch.waiting.length === 1 && entre.session.launch.waiting[0] === idC);
  const att2 = await A.eval(`({ off: document.getElementById('start').disabled, txt: document.getElementById('start').textContent })`);
  t('« Lancer » attend toujours Chloé', att2.off && /Chloé/.test(att2.txt) && !/Bruno/.test(att2.txt), att2.txt);
  const ppA = await B.eval(`(() => { const li = [...document.querySelectorAll('#players .g-player')].find((x) => /Alice/.test(x.textContent)); const img = li && li.querySelector('img');
    return img ? { src: img.getAttribute('src'), ok: img.complete && img.naturalWidth > 0 } : null; })()`);
  t('la VRAIE PP de A s\'affiche dans le salon du Demi-Cercle, chez B', !!ppA && ppA.src === srcA && ppA.ok);
  const nEntered = B.trames.filter((m) => m.type === 'room').length;
  t('B reçoit plusieurs `room` du jeu mais n\'annonce son entrée qu\'une fois', nEntered >= 1
    && (await B.eval(`typeof codeDeclare === 'string' && codeDeclare === ${JSON.stringify(roomA)}`)));

  // ═══ 16. A lance SANS attendre Chloé
  await A.click('#start-anyway');
  await A.until(`!document.getElementById('game').hidden && phase === 'setup'`, 8000, 'manche 1');
  const set1 = await A.attendsTrame((m) => m.type === 'phase' && m.phase === 'setup' && m.round === 1, 8000, 'setup 1');
  t('démarrage réel : phase setup de la manche 1', !!set1, `manche ${set1.round}/${set1.of}`);
  const joue = await B.attendsTrame((m) => m.session && m.session.state === 'inGame' && m.session.launch.stage === 'playing', 8000, 'playing');
  t('started() : le Hub passe à inGame/playing, Chloé est « manquée »', JSON.stringify(joue.session.launch.missed) === JSON.stringify([idC]));
  await C.until(`/commencé sans toi/.test(document.getElementById('launch-text').textContent) && document.getElementById('launch-go').hidden`, 8000, 'Chloé manquée');
  t('Chloé, au Hub : « La partie a commencé sans toi », plus de bouton Rejoindre', true);

  // Chloé arrive quand même par un billet (page ouverte en retard) : le serveur
  // du jeu la refuse, sa page le dit, la room garde deux joueurs.
  const sC = C.hub();
  await C.eval(`HubHandoff.write(${JSON.stringify({ hub: HUB, session: sC.code, playerId: idC, drawId: sC.launch.drawId, gameId: 'demicercle', role: 'guest' })})`);
  await C.navigate(`${BASE}/games/demicercle/`);
  await C.until(`${surDemi} && /partie en cours/.test(document.getElementById('error').textContent)`, 15000, 'refus de Chloé');
  t('retardataire : refusée par demicercle-server (« partie en cours »), reste à l\'accueil',
    !(await C.visible('#lobby')) && !(await C.visible('#game')), await texte(C, 'error'));
  await sleep(300);
  t('la room du groupe garde deux joueurs', await A.eval(`document.querySelectorAll('#scores-live .g-player').length === 2`));

  // ═══ 17. la partie, jusqu'au bout (2 manches : A puis B guident)
  await partie(A, [A, B], [A, B]);
  const podA = await podiumTient(A, 2), podB = await podiumTient(B, 2);
  for (const [J, p] of [[A, podA], [B, podB]]) {
    t(`${J.nom} : le podium RESTE à l'écran après le \`room\` lobby`, p.game && !p.lobby && p.podium && p.medailles === 2 && /Fin de partie/.test(p.titre), JSON.stringify(p));
    t(`${J.nom} : « retour au salon » et « Retour au Game Hub » proposés`, p.retour && p.hub);
  }
  await B.shot('2-demi-podium');
  const deb = await B.attendsTrame((m) => m.session && m.session.state === 'debrief', 10000, 'debrief');
  t('ended() : le Hub revient en debrief (stage ended)', deb.session.launch.stage === 'ended' && deb.session.history.played[0] === 'demicercle');

  // ═══ 18. retour au salon, puis au Hub
  await A.click('#back-lobby');
  await A.until(`!document.getElementById('lobby').hidden && document.getElementById('game').hidden`, 5000, 'salon de A');
  const sal = await A.eval(`({ n: document.querySelectorAll('#players .g-player').length, off: document.getElementById('start').disabled, txt: document.getElementById('start').textContent, sans: document.getElementById('start-anyway').hidden })`);
  t('#back-lobby : retour au salon, deux joueurs, « Lancer la partie » de nouveau actif', sal.n === 2 && !sal.off && sal.txt === 'Lancer la partie' && sal.sans, JSON.stringify(sal));
  await B.click('#to-hub');
  await B.until(`location.pathname === '/games/' && !document.getElementById('lobby').hidden && !document.getElementById('hub-ready').hidden`, 15000, 'retour Hub B');
  t('#to-hub : B revient au Hub, même session, « partie terminée »', /terminée/.test(await texte(B, 'hub-ready')) && B.hub().code === code, await texte(B, 'hub-ready'));
  t('#to-hub n\'a pas la classe .back (réservée au retour portfolio)', await A.eval(`!document.getElementById('to-hub').classList.contains('back') && document.querySelectorAll('a.back').length === 1`));
  const errs = [A, B, C].flatMap((J) => J.erreurs.map((e) => `[${J.nom}] ${e}`));
  t('aucune erreur JS dans les trois navigateurs (Hub)', errs.length === 0, errs.slice(0, 3).join(' | '));

  // ═══ 19. HORS Hub : deux joueurs, aucun billet — la page d'avant
  const D = await joueur('D'), E = await joueur('E');
  const DIRECT = `${BASE}/games/demicercle/?server=${encodeURIComponent(DEMI)}`;
  for (const [J, nom] of [[D, 'Dora'], [E, 'Émile']]) { await J.goto(DIRECT); await J.type('#name-input', nom); }
  await D.click('#host');
  await D.until(`!document.getElementById('lobby').hidden && /^[A-Z2-9]{4}$/.test(document.getElementById('room-code').textContent.trim())`, 10000, 'room de D');
  const roomD = (await texte(D, 'room-code')).trim();
  await E.type('#code-input', roomD);
  await E.click('#join');
  await D.until(`document.querySelectorAll('#players .g-player').length === 2`, 8000, 'E dans la room');
  const hors = await D.eval(`({ ban: !!document.querySelector('.g-hub-banner'), lien: lien === null, off: document.getElementById('start').disabled, sans: document.getElementById('start-anyway').hidden, txt: document.getElementById('start').textContent })`);
  t('hors Hub : pas de bandeau, `lien` nul, « Lancer » actif dès 2 joueurs, pas de « sans attendre »', !hors.ban && hors.lien && !hors.off && hors.sans && hors.txt === 'Lancer la partie', JSON.stringify(hors));
  t('hors Hub : aucune trame du Hub', !D.trames.some((m) => m.session) && !E.trames.some((m) => m.session));
  t('hors Hub : une room distincte de celle du Hub', roomD !== roomA, roomD);
  await D.click('#start');
  await partie(D, [D, E], [D, E]);
  const pD = await podiumTient(D, 2), pE = await podiumTient(E, 2);
  t('hors Hub : le podium reste à l\'écran chez les deux', [pD, pE].every((p) => p.game && !p.lobby && p.podium && p.retour), JSON.stringify(pE));
  t('hors Hub : pas de « Retour au Game Hub »', !pD.hub && !pE.hub);
  await E.click('#back-lobby');
  await E.until(`!document.getElementById('lobby').hidden`, 5000, 'salon de E');
  t('hors Hub : #back-lobby ramène au salon', await E.eval(`document.querySelectorAll('#players .g-player').length === 2 && document.getElementById('game').hidden`));
  // Et on rejoue : le salon relance une partie normalement.
  await D.click('#back-lobby');
  await D.until(`!document.getElementById('lobby').hidden`, 5000, 'salon de D');
  await D.click('#start');
  await E.until(`!document.getElementById('game').hidden && phase === 'setup'`, 8000, 'nouvelle partie');
  t('hors Hub : une seconde partie repart du salon', true);
  const errs2 = [D, E].flatMap((J) => J.erreurs.map((e) => `[${J.nom}] ${e}`));
  t('aucune erreur JS hors Hub', errs2.length === 0, errs2.slice(0, 3).join(' | '));
} catch (e) {
  t('EXCEPTION (navigateurs)', false, e.message);
  for (const J of joueurs) {
    const etat = await J.eval(`location.href + ' | erreur : ' + ((document.getElementById('error') || document.getElementById('hub-error') || {}).textContent || '')
      + ' | bandeau : ' + ((document.querySelector('.g-hub-banner') || {}).textContent || '')`).catch((x) => x.message);
    console.log(`     [${J.nom}] ${etat}${J.erreurs.length ? ' | JS : ' + J.erreurs.join(' / ') : ''}`);
  }
} finally {
  stop();
}
console.log(`\n${ko ? 'DES TESTS ÉCHOUENT' : 'TOUT PASSE'} — ${out.length} vérifications, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
