// Handoff Hub → Précision, de bout en bout : le vrai game-hub-server et le VRAI
// precision-server, lancés en local depuis les dépôts voisins. Aucun mock : le
// code de room est celui que precision-server fabrique.
//
//   node tests/handoff-precision.mjs
//   node tests/handoff-precision.mjs --reduced       mouvement réduit
//   node tests/handoff-precision.mjs --shots <dir>   une capture par étape
//
// Trois étages, du plus sec au plus réel :
//
//   1. le billet, sans réseau ni navigateur ;
//   2. le PROTOCOLE en Node : un groupe de deux (création sans code, code
//      déclaré une fois, invité qui rejoint CE code, inGame, une vraie partie,
//      cible seulement en `memorize`, ordre end → room lobby, retardataire
//      refusé, ended) ; puis une session SOLO, qui passe directement en inGame ;
//   3. de VRAIS NAVIGATEURS (Edge par le protocole DevTools) :
//      - le SON de l'invité : arrivé par « Rejoindre », puis après un
//        rechargement de la page (plus aucun geste → contexte « suspended ») :
//        bouton « 🔊 Activer le son », reprise au premier geste, et l'épreuve
//        Son qui le dit quand l'audio est encore bloqué ;
//      - le handoff complet : « Lancer » attend, « Lancer sans attendre »,
//        retardataire refusé, partie, podium qui reste, retour au salon,
//        #to-hub HORS du plateau, retour au Hub ;
//      - le SOLO : un joueur seul lance tout de suite ;
//      - le jeu DIRECT, hors Hub : la page d'avant, sans bouton de son.
//
// ⚠️ AUCUN SECOND PROTOCOLE DE ROOM. Le Hub ne parle jamais à precision-server.
//
// ⚠️ precision-server a besoin de `ws`. Sur un poste où son `npm install` n'a
// pas été fait, NODE_PATH peut pointer sur un autre node_modules qui l'a (celui
// de game-hub-server, par exemple) : le processus fils en hérite.
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
// L'alphabet des codes de room de Précision (src/server.js : sans I, L, O, 0, 1).
const CODE_RE = /^[A-HJKMNP-Z2-9]{4}$/;
const require = createRequire(import.meta.url);
const H = require(path.join(ROOT, 'games/shared/game-hub.js'));
const HH = require(path.join(ROOT, 'games/shared/hub-handoff.js'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = () => Math.floor(Math.random() * 300);
const HUB_PORT = 8300 + R(), PR_PORT = 8900 + R(), HEALTH_PORT = 6100 + R(), HTTP_PORT = 8700 + R(), CDP_PORT = 9700 + R();

let out = [], ko = 0;
const t = (nom, ok, detail = '') => {
  out.push(`${ok ? 'OK  ' : 'KO  '} ${nom}${detail ? ' — ' + detail : ''}`);
  if (!ok) ko++;
  console.log(out[out.length - 1]);
};

// ═══════════════════════════════ 1. le billet, sans réseau ni navigateur
console.log('Handoff Précision — le billet\n');
const BON = { v: 1, hub: 'ws://127.0.0.1:8100', session: 'AB2DE', playerId: 'p_alice', drawId: 'd_1', gameId: 'precision', role: 'host', at: Date.now() };
t('billet valable pour precision', !!HH.readTicket(BON, 'precision'));
t('billet d\'un AUTRE jeu : refusé par la page de Précision', !HH.readTicket({ ...BON, gameId: 'ban' }, 'precision'));
t('billet sans rôle connu : refusé', !HH.readTicket({ ...BON, role: 'spectateur' }, 'precision'));
t('billet périmé (plus de 3 h) : refusé', !HH.readTicket({ ...BON, at: Date.now() - HH.MAX_AGE_MS - 1000 }, 'precision'));
t('billet au code de session bidon : refusé', !HH.readTicket({ ...BON, session: 'abc' }, 'precision'));
t('billet dont le hub n\'est pas une URL WebSocket : refusé', !HH.readTicket({ ...BON, hub: 'http://x' }, 'precision'));
t('les deux rôles sont acceptés', !!HH.readTicket({ ...BON, role: 'guest' }, 'precision'));

// ═══════════════════════════════ 2. les vrais serveurs
const procs = [];
const lance = (cwd, file, port, env = {}) => {
  const p = spawn(process.execPath, [file], { cwd, env: { ...process.env, PORT: String(port), HUB_QUIET: '1', ...env }, stdio: 'ignore' });
  procs.push(p); return p;
};
async function attends(url) { for (let i = 0; i < 100; i++) { try { const r = await fetch(url); if (r.ok) return; } catch (_) {} await sleep(100); } throw new Error('injoignable : ' + url); }

const sante = await fakeHealth(HEALTH_PORT);
const MANIFEST = localManifest(ROOT, HEALTH_PORT, { precision: `http://127.0.0.1:${PR_PORT}/` });
lance(path.join(ROOT, '..', 'precision-server'), 'src/server.js', PR_PORT, { LEAD_MS: '200' });
lance(path.join(ROOT, '..', 'game-hub-server'), 'src/server.js', HUB_PORT, { MANIFEST_FILE: MANIFEST });
const HUB = `ws://127.0.0.1:${HUB_PORT}`, PR = `ws://127.0.0.1:${PR_PORT}`;

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

// Le client du jeu : un WebSocket vers precision-server, rien d'autre.
function prec() {
  const ws = new WebSocket(PR);
  const c = { ws, msgs: [] };
  ws.onmessage = (e) => { if (typeof e.data === 'string') c.msgs.push(JSON.parse(e.data)); };
  c.open = new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('precision injoignable')); });
  c.send = (o) => ws.send(JSON.stringify(o));
  c.wait = async (pred, ms = 10000) => { const fin = Date.now() + ms; while (Date.now() < fin) { const m = c.msgs.find(pred); if (m) return m; await sleep(20); } return null; };
  c.last = (type) => [...c.msgs].reverse().find((m) => m.type === type);
  return c;
}
// Le join de Précision : SANS `code` pour créer, AVEC pour rejoindre.
const joinPr = (p, code) => (code === undefined
  ? { action: 'join', name: p.name, avatar: p.avatar }
  : { action: 'join', name: p.name, avatar: p.avatar, code });
// Une réponse valide à l'épreuve COULEUR (forme exacte attendue par le moteur).
const COULEUR = { h: 180, s: 50, l: 50 };

const IMG = 'data:image/webp;base64,' + fs.readFileSync(path.join(ROOT, '..', 'precision-server', 'test-fixtures', 'avatar-96.webp')).toString('base64');
const pA = { id: 'p_aliceprec', name: 'Alice', avatar: { kind: 'image', emoji: '🦊', src: IMG } };
const pB = { id: 'p_brunoprec', name: 'Bruno', avatar: { kind: 'emoji', emoji: '🐼' } };
const pS = { id: 'p_solopreci', name: 'Solo', avatar: { kind: 'emoji', emoji: '🎯' } };

try {
  await attends(`http://127.0.0.1:${PR_PORT}/`);
  await attends(`http://127.0.0.1:${HUB_PORT}/health`);
  console.log(`\nHandoff Hub → Précision — protocole réel (Hub :${HUB_PORT}, Précision :${PR_PORT})\n`);

  // ═══ 3. le groupe, et un tirage qui ne peut donner que Précision
  const A = hubClient(), B = hubClient();
  const sA = suivi(A), sB = suivi(B);
  const code = (await A.create(pA)).session.code;
  await B.join(code, pB);
  await sA.until((s) => s.pool && s.pool.catalog === 'ready' && s.players.length === 2);
  B.setPrefs([], ['morpion', 'imitation', 'demicercle', 'ban', 'passeur']);
  const seul = await sA.until((s) => JSON.stringify(s.pool.eligible) === '["precision"]');
  t('le groupe (2) : seule Précision est éligible (vetos de B)', !!seul, JSON.stringify(sA.last.pool.eligible));
  const entree = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/games.manifest.json'), 'utf8')).games.find((g) => g.id === 'precision');
  t('le manifest annonce le handoff de Précision, et garde `min: 1`', entree.handoff === true && entree.players.min === 1);
  A.draw();
  const tire = await sA.until((s) => s.draw && s.draw.status === 'drawn');
  t('tirage serveur : Précision', !!tire && tire.draw.gameId === 'precision', tire && tire.draw.gameId);
  const drawId = tire.draw.id;

  // ═══ 4. continuer → lancement, rôles, URL
  A.confirm();
  const l0 = await sB.until((s) => s.state === 'launching');
  t('continuer → launching (stage create), lié au tirage', !!l0 && l0.launch.stage === 'create' && l0.launch.drawId === drawId);
  t('rôles : A host du lancement, B guest', l0.launch.hostId === pA.id && l0.launch.hostId !== pB.id);
  t('le Hub donne l\'URL du jeu (manifest)', l0.launch.url === 'games/precision/', l0.launch.url);

  // ═══ 5. A « navigue » : sa page du Hub se ferme, la page du jeu rouvre le Hub
  A._drop();
  await sB.until((s) => s.players.find((p) => p.id === pA.id).connected === false, 4000);
  const A2 = hubClient(), sA2 = suivi(A2);
  await A2.join(code, pA);
  t('navigation de A : même player.id, toujours hôte du lancement',
    sA2.last.hostId === pA.id && sA2.last.launch.hostId === pA.id && sA2.last.players.length === 2);

  // ═══ 6. A crée la room par le protocole NORMAL de Précision : join SANS code
  const PA = prec(); await PA.open;
  PA.send(joinPr(pA));
  const roomA = await PA.wait((m) => m.type === 'room');
  const moiA = roomA && roomA.players.find((p) => p.id === roomA.you);
  t('Précision : room créée par un join SANS code, vrai code renvoyé', !!roomA && CODE_RE.test(roomA.code), roomA && roomA.code);
  t('Précision : le créateur est le MJ (host) de la room', !!moiA && moiA.host === true);
  const roomCode = roomA.code;

  const errB0 = sB.errors.length;
  B.launched(drawId, 'ZZZZ');
  await sleep(300);
  t('un guest qui déclare un code : refusé (NOT_HOST)',
    sB.errors.length > errB0 && sB.errors[sB.errors.length - 1].code === 'NOT_HOST');

  // ═══ 7. le code remonte au Hub, qui le relaie — une seule fois
  A2.launched(drawId, roomCode);
  const go = await sB.until((s) => s.launch && s.launch.stage === 'join');
  t('go : B reçoit LE code de la room créée par A', !!go && go.launch.roomCode === roomCode, go && go.launch.roomCode);
  t('waiting : B attendu, A déjà dedans',
    JSON.stringify(go.launch.entered) === JSON.stringify([pA.id]) && JSON.stringify(go.launch.waiting) === JSON.stringify([pB.id]));
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
  const PB = prec(); await PB.open;
  PB.send(joinPr(pB, vuB));
  const roomB = await PB.wait((m) => m.type === 'room');
  const moiB = roomB && roomB.players.find((p) => p.id === roomB.you);
  t('B : entré dans la room de Précision par le protocole normal (join + code)',
    !!roomB && roomB.code === roomCode && !!moiB && moiB.host === false);
  B2.entered(drawId, roomB.code);
  const enJeu = await sA2.until((s) => s.state === 'inGame');
  t('Hub : tout le groupe est entré → inGame, personne en attente',
    !!enJeu && enJeu.launch.waiting.length === 0 && enJeu.launch.entered.length === 2);
  await sleep(300);
  const lob = PA.last('room');
  t('Précision : A + B dans LA MÊME room (vue du serveur du jeu)',
    !!lob && lob.code === roomCode && lob.players.length === 2
    && ['Alice', 'Bruno'].every((n) => lob.players.some((p) => p.name === n)), lob && lob.players.map((p) => p.name).join(','));
  t('la vraie PP de A arrive dans Précision (image, pas l\'emoji)', lob.players.find((p) => p.name === 'Alice').avatar.src === IMG);

  // ═══ 9. une vraie partie, jusqu'au bout (une manche de couleur)
  PA.send({ action: 'start', rounds: 1, difficulty: 'impossible', game: 'color' });
  const meA = await PA.wait((m) => m.type === 'phase' && m.phase === 'memorize');
  const meB = await PB.wait((m) => m.type === 'phase' && m.phase === 'memorize');
  t('A démarre : les deux reçoivent `memorize`, manche 1 — le vrai début',
    !!meA && !!meB && meA.round === 1 && meB.round === 1 && meA.game === 'color', meA && `${meA.game} ${meA.round}/${meA.of}`);
  t('la cible part en `memorize`…', !!meB.target);
  A2.started(drawId);
  const plB = await PB.wait((m) => m.type === 'phase' && m.phase === 'play');
  t('… et jamais en `play` (zéro confiance)', !!plB && !('target' in plB));
  t('Hub : toujours inGame pendant la partie', sA2.last.state === 'inGame', sA2.last.state);

  const PC = prec(); await PC.open;
  PC.send(joinPr({ name: 'Chloé', avatar: { kind: 'emoji', emoji: '🐸' } }, roomCode));
  const refus = await PC.wait((m) => m.type === 'error');
  t('un retardataire est refusé (« partie en cours »), la room garde 2 joueurs',
    !!refus && /partie en cours/.test(refus.message) && !PC.msgs.some((m) => m.type === 'room'), refus && refus.message);

  PA.send({ action: 'submit', type: 'color', data: COULEUR });
  PB.send({ action: 'submit', type: 'color', data: COULEUR });
  const rev = await PB.wait((m) => m.type === 'phase' && m.phase === 'reveal');
  t('les deux valident : `reveal` avec la cible et les deux résultats', !!rev && !!rev.target && rev.results.length === 2);
  PA.send({ action: 'next' });
  const endB = await PB.wait((m) => m.type === 'phase' && m.phase === 'end');
  t('fin de partie : podium à deux joueurs', !!endB && endB.podium.length === 2);
  await sleep(200);
  const iEnd = PB.msgs.indexOf(endB);
  const lobbyApres = PB.msgs.findIndex((m, i) => i > iEnd && m.type === 'room' && m.phase === 'lobby');
  t('ORDRE DES TRAMES : `phase:end` PUIS `room` en phase lobby', iEnd >= 0 && lobbyApres > iEnd, `end #${iEnd}, room lobby #${lobbyApres}`);
  A2.ended(drawId);
  const deb = await sB2.until((s) => s.state === 'debrief');
  t('ended : le Hub revient en debrief, prêt pour un nouveau tirage',
    !!deb && deb.launch.stage === 'ended' && deb.history.played[0] === 'precision');

  // ═══ 10. SOLO : une session d'un seul joueur passe directement en inGame
  const S = hubClient(), sS = suivi(S);
  const codeS = (await S.create(pS)).session.code;
  await sS.until((s) => s.pool && s.pool.catalog === 'ready');
  S.setPrefs([], ['passeur', 'puissance4']);
  const soloEl = await sS.until((s) => JSON.stringify(s.pool.eligible) === '["precision"]');
  t('solo : Précision est éligible à 1 joueur (min: 1)', !!soloEl, JSON.stringify(sS.last.pool.eligible));
  S.draw();
  const tS = await sS.until((s) => s.draw && s.draw.status === 'drawn');
  S.confirm();
  await sS.until((s) => s.state === 'launching');
  const PS = prec(); await PS.open;
  PS.send(joinPr(pS));
  const roomS = await PS.wait((m) => m.type === 'room');
  S.launched(tS.draw.id, roomS.code);
  const solo = await sS.until((s) => s.state === 'inGame');
  t('solo : dès le code déclaré, le Hub passe en inGame (personne à attendre)',
    !!solo && solo.launch.stage === 'playing' && solo.launch.waiting.length === 0 && solo.launch.missed.length === 0, codeS);
  PS.send({ action: 'start', rounds: 1, difficulty: 'impossible', game: 'color' });
  await PS.wait((m) => m.type === 'phase' && m.phase === 'play');
  PS.send({ action: 'submit', type: 'color', data: COULEUR });
  await PS.wait((m) => m.type === 'phase' && m.phase === 'reveal');
  PS.send({ action: 'next' });
  const endS = await PS.wait((m) => m.type === 'phase' && m.phase === 'end');
  S.ended(tS.draw.id);
  const debS = await sS.until((s) => s.state === 'debrief');
  t('solo : la partie se joue seul jusqu\'au podium, puis debrief', !!endS && endS.podium.length === 1 && !!debS);

  // ═══ 11. hors Hub : le jeu reste autonome
  const PD = prec(); await PD.open;
  PD.send(joinPr({ name: 'Dora', avatar: { kind: 'emoji', emoji: '🎧' } }));
  const roomD = await PD.wait((m) => m.type === 'room');
  const PE = prec(); await PE.open;
  PE.send(joinPr({ name: 'Émile', avatar: { kind: 'emoji', emoji: '🍕' } }, roomD.code));
  const roomE = await PE.wait((m) => m.type === 'room');
  t('hors Hub : une room SÉPARÉE, créée et rejointe à la main',
    !!roomE && roomE.code === roomD.code && roomE.players.length === 2 && roomD.code !== roomCode, roomD && roomD.code);

  for (const P of [PA, PB, PC, PS, PD, PE]) { try { P.ws.close(); } catch (_) {} }
  for (const X of [A2, B2, S]) { try { X.leave(); } catch (_) {} }
  await sleep(200);
} catch (e) {
  t('EXCEPTION (protocole)', false, e && (e.stack || e.message));
}

// ═══════════════════════════════ 3. de vrais navigateurs
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json' };
// Le site tel quel, avec DEUX redirections propres au test : les liens réels
// (`games/` depuis la home, `games/precision/` depuis le Hub) n'ont pas de
// `?hub=` / `?server=` — ils iraient en production.
function serve() {
  const s = createServer((req, res) => {
    const [p0, q] = req.url.split('?');
    if (p0 === '/games/' && !/(^|&)hub=/.test(q || '')) { res.writeHead(302, { Location: `/games/?hub=${encodeURIComponent(HUB)}` }); return res.end(); }
    if (p0 === '/games/precision/' && !/(^|&)server=/.test(q || '')) { res.writeHead(302, { Location: `/games/precision/?server=${encodeURIComponent(PR)}` }); return res.end(); }
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
  J.size = (w, h) => S('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 500 });
  await J.size(1100, 1000);
  J.eval = async (expression) => {
    const r = await S('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(`[${nom}] ` + (r.result.exceptionDetails.exception?.description || 'erreur JS').split('\n')[0]);
    return r.result?.result?.value;
  };
  J.navigate = (url) => S('Page.navigate', { url });
  J.reload = async () => { await S('Page.reload', {}); await sleep(400); };
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
  J.hub = () => { for (let i = J.trames.length - 1; i >= 0; i--) if (J.trames[i].session) return J.trames[i].session; return null; };
  J.attendsTrame = async (pred, ms = 10000, label = 'trame') => {
    const fin = Date.now() + ms;
    while (Date.now() < fin) { const m = [...J.trames].reverse().find(pred); if (m) return m; await sleep(50); }
    throw new Error(`[${nom}] trame jamais reçue : ${label}`);
  };
  return J;
}

const surPr = `location.pathname === '/games/precision/' && document.readyState === 'complete'`;
const auSalon = `${surPr} && !document.getElementById('lobby').hidden && /^[A-Z2-9]{4}$/.test(document.getElementById('room-code').textContent.trim())`;
const texte = (J, id) => J.eval(`(document.getElementById(${JSON.stringify(id)}) || {}).textContent || ''`);
const son = (J) => J.eval(`({ etat: AUDIO.state(), bouton: !document.getElementById('sound-on').hidden, salon: !document.getElementById('lobby').hidden,
  joueurs: document.querySelectorAll('#players .g-player').length, geste: navigator.userActivation.hasBeenActive })`);

// Une partie complète de Précision avec les vrais boutons : chacun valide au
// bouton rond pendant `play`, le MJ enchaîne au même bouton pendant `reveal`.
async function partie(mj, tous) {
  for (let i = 0; i < 120; i++) {
    if (await mj.eval(`phase === 'end'`)) return;
    let fait = false;
    for (const J of tous) {
      if (await J.eval(`phase === 'play' && !submitted && document.getElementById('fab').dataset.mode === 'submit' && !document.getElementById('fab').hidden`)) { await J.click('#fab'); fait = true; }
    }
    if (await mj.eval(`phase === 'reveal' && document.getElementById('fab').dataset.mode === 'next'`)) { await mj.click('#fab'); fait = true; }
    await sleep(fait ? 300 : 150);
  }
  throw new Error('la partie ne se termine pas');
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
    const sc = document.getElementById('scores'), g = document.getElementById('game'), h = document.getElementById('to-hub');
    const rg = g.getBoundingClientRect(), rh = h.getBoundingClientRect();
    return { game: vis('game'), lobby: vis('lobby'), podium: vis('scores') && sc.querySelectorAll('li').length === ${nb},
      titre: document.getElementById('phase-title').textContent, fab: document.getElementById('fab').dataset.mode,
      hub: vis('to-hub'), horsPlateau: !g.contains(h) && (h.hidden || rh.top >= rg.bottom - 1) };
  })()`);
}

try {
  srv = await serve();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'handoffprec-'));
  // ⚠️ Pas de --autoplay-policy : on veut la politique PAR DÉFAUT du
  // navigateur, celle qui bloque le son d'une page sans geste.
  edge = spawn(EDGE, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${dir}`, '--no-first-run',
    '--disable-features=BackForwardCache', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank'], { stdio: 'ignore' });
  cdp = await cdpBrowser();
  const BASE = `http://127.0.0.1:${HTTP_PORT}`;
  const PAGE = `${BASE}/games/?hub=${encodeURIComponent(HUB)}`;
  console.log(`\nHandoff Hub → Précision — navigateurs (${REDUCED ? 'mouvement RÉDUIT' : 'mouvement normal'})\n`);
  const A = await joueur('A'), B = await joueur('B'), C = await joueur('C');

  // ═══ 12. portfolio → Game Hub, trois profils, une session
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
  for (const id of ['imitation', 'demicercle', 'ban', 'passeur', 'quiment']) await B.click(`#hub-games [data-pref=veto][data-game=${id}]`);
  await A.until(`[...document.querySelectorAll('#hub-games .hub-game[data-eligible=true]')].map((x) => x.dataset.game).join() === 'precision'`, 8000, 'seule Précision');
  await A.click('#hub-draw-btn');
  for (const J of [A, B, C]) await J.until(`document.getElementById('hub-result').dataset.game === 'precision' && !document.getElementById('hub-result').hidden`, 15000, `révélation ${J.nom}`);
  t('tirage : Précision, révélée chez les trois', true);

  // ═══ 13. A ouvre le jeu : la room se crée toute seule
  await A.immobile('#hub-continue');
  await A.click('#hub-continue');
  await A.until(`!document.getElementById('hub-launch').hidden && !document.getElementById('launch-go').hidden`, 8000, 'Ouvrir');
  await A.immobile('#launch-go');
  await A.click('#launch-go');
  await A.until(auSalon, 20000, 'room créée');
  const roomA = (await texte(A, 'room-code')).trim();
  t('host : la page de Précision crée la room toute seule (join sans code), A est le MJ', CODE_RE.test(roomA)
    && A.trames.some((m) => m.type === 'room' && m.code === roomA && m.players.find((p) => p.id === m.you)?.host), roomA);
  const lancee = await A.attendsTrame((m) => m.session && m.session.launch && m.session.launch.roomCode === roomA, 8000, 'code au Hub');
  t('le code arrive au Hub (stage join) — celui de LA room de Précision', lancee.session.launch.stage === 'join');
  const banA = await A.eval(`(document.querySelector('.g-hub-banner') || {}).textContent || ''`);
  t('bandeau Game Hub sur la page de Précision', new RegExp(code).test(banA) && /attendus/.test(banA), banA);
  const att = await A.eval(`({ off: document.getElementById('start').disabled, txt: document.getElementById('start').textContent, sans: !document.getElementById('start-anyway').hidden })`);
  t('« Lancer » attend le groupe (désactivé, nomme les absents) + « Lancer sans attendre »', att.off && /Bruno/.test(att.txt) && /Chloé/.test(att.txt) && att.sans, att.txt);
  const sonA = await son(A);
  t('hôte : son actif après la création automatique, pas de bouton', sonA.etat === 'running' && !sonA.bouton, JSON.stringify(sonA));

  // ═══ 14. B rejoint par « Rejoindre » — puis le SON, mesuré
  await B.until(`!document.getElementById('launch-go').hidden && /Rejoindre/.test(document.getElementById('launch-go').textContent)`, 10000, 'Rejoindre chez B');
  await B.immobile('#launch-go');   // ⚠️ défilement doux de /games/ : voir handoff-demicercle.mjs
  await B.click('#launch-go');
  await B.until(`${auSalon} && document.getElementById('room-code').textContent.trim() === ${JSON.stringify(roomA)}`, 20000, 'B dans la room');
  t('guest : auto-jointure de LA room, sans saisir de code', true);
  await sleep(500);
  const son1 = await son(B);
  console.log(`     MESURE — invité arrivé par « Rejoindre » : ${JSON.stringify(son1)}`);
  t('invité arrivé par « Rejoindre » : le clic de /games/ suit la navigation, son actif, pas de bouton',
    son1.etat === 'running' && son1.geste && !son1.bouton, JSON.stringify(son1));
  const ppA = await B.eval(`(() => { const li = [...document.querySelectorAll('#players .g-player')].find((x) => /Alice/.test(x.textContent)); const img = li && li.querySelector('img');
    return img ? { src: img.getAttribute('src'), ok: img.complete && img.naturalWidth > 0 } : null; })()`);
  t('la VRAIE PP de A s\'affiche dans le salon de Précision, chez B', !!ppA && ppA.src === srcA && ppA.ok);

  // Rechargement : plus aucun geste sur la page → le contexte naît suspendu.
  await B.reload();
  await B.until(`${auSalon} && document.querySelectorAll('#players .g-player').length === 2`, 15000, 'B de retour après rechargement');
  await sleep(500);
  const son2 = await son(B);
  console.log(`     MESURE — invité après RECHARGEMENT : ${JSON.stringify(son2)}`);
  t('rechargement : son BLOQUÉ (suspended, aucun geste) → « 🔊 Activer le son » affiché',
    son2.etat === 'suspended' && !son2.geste && son2.bouton, JSON.stringify(son2));
  t('… et le salon reste normal (deux joueurs, code, bandeau)', son2.salon && son2.joueurs === 2 && !!(await B.eval(`document.querySelector('.g-hub-banner')`)));
  await B.shot('1-son-bloque');
  await B.click('#sound-on');
  await B.until(`AUDIO.state() === 'running' && document.getElementById('sound-on').hidden`, 5000, 'son actif au bouton');
  t('clic sur « 🔊 Activer le son » : le contexte de Précision passe à running, le bouton disparaît', true);

  // Deuxième rechargement : un geste QUELCONQUE sur la page suffit.
  await B.reload();
  await B.until(`${auSalon} && document.querySelectorAll('#players .g-player').length === 2`, 15000, 'B de retour (2)');
  await sleep(400);
  t('second rechargement : de nouveau bloqué, bouton affiché', (await son(B)).bouton);
  await B.click('.lobby-head');
  await B.until(`AUDIO.state() === 'running' && document.getElementById('sound-on').hidden`, 5000, 'son actif au premier geste');
  t('premier geste ailleurs dans la page (un clic sur « Salon ») : son repris, bouton masqué', true);

  // Troisième rechargement, et on n'y touche PAS : l'épreuve Son doit le dire.
  await B.reload();
  await B.until(`${auSalon} && document.querySelectorAll('#players .g-player').length === 2`, 15000, 'B de retour (3)');
  await sleep(400);
  t('troisième rechargement, sans geste : son bloqué', (await son(B)).etat === 'suspended');
  const entre = await A.attendsTrame((m) => m.session && m.session.launch && m.session.launch.entered.length === 2, 8000, 'entered');
  t('Hub : B `entered` (même après ses rechargements), Chloé toujours attendue', entre.session.launch.waiting.length === 1 && entre.session.launch.waiting[0] === idC);

  // ═══ 15. A lance SANS attendre Chloé : trois manches de Son
  await A.eval(`document.getElementById('game-select').value = 'sound'; document.getElementById('diff-select').value = 'facile'; document.getElementById('rounds-select').value = '3'; true`);
  await A.click('#start-anyway');
  await A.until(`!document.getElementById('game').hidden && phase === 'memorize'`, 8000, 'mémorisation');
  const me1 = await A.attendsTrame((m) => m.type === 'phase' && m.phase === 'memorize' && m.round === 1, 8000, 'memorize 1');
  t('démarrage réel : `memorize`, manche 1, épreuve Son', me1.game === 'sound', `${me1.game} ${me1.round}/${me1.of}`);
  const joue = await B.attendsTrame((m) => m.session && m.session.state === 'inGame' && m.session.launch.stage === 'playing', 8000, 'playing');
  t('started() : le Hub passe à inGame/playing, Chloé est « manquée »', JSON.stringify(joue.session.launch.missed) === JSON.stringify([idC]));
  await B.until(`phase === 'memorize'`, 5000, 'mémorisation chez B');
  const bloque = await B.eval(`({ sub: document.getElementById('phase-sub').textContent, etat: AUDIO.state() })`);
  t('épreuve Son avec l\'audio bloqué : l\'invité en est averti à l\'écran', /son bloqué/.test(bloque.sub) && bloque.etat === 'suspended', JSON.stringify(bloque));
  await B.shot('2-son-bloque-epreuve');
  await B.click('#phase-title');
  await B.until(`AUDIO.state() === 'running'`, 5000, 'son repris en pleine épreuve');
  const repris = await B.eval(`({ sub: document.getElementById('phase-sub').textContent, phase })`);
  t('un geste sur l\'écran pendant l\'épreuve : son repris, l\'avertissement disparaît', !/son bloqué/.test(repris.sub), JSON.stringify(repris));
  const geo = await A.eval(`(() => { const r = document.getElementById('game').getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), ratio: +(r.width / r.height).toFixed(3) }; })()`);
  t('plateau intact : ratio 5/6 (le bouton de son et #to-hub n\'y sont pas)', Math.abs(geo.ratio - 5 / 6) < 0.01, JSON.stringify(geo));
  await C.until(`/commencé sans toi/.test(document.getElementById('launch-text').textContent) && document.getElementById('launch-go').hidden`, 8000, 'Chloé manquée');
  t('Chloé, au Hub : « La partie a commencé sans toi », plus de bouton Rejoindre', true);
  const sC = C.hub();
  await C.eval(`HubHandoff.write(${JSON.stringify({ hub: HUB, session: sC.code, playerId: idC, drawId: sC.launch.drawId, gameId: 'precision', role: 'guest' })})`);
  await C.navigate(`${BASE}/games/precision/`);
  await C.until(`${surPr} && /partie en cours/.test(document.getElementById('error').textContent)`, 15000, 'refus de Chloé');
  t('retardataire : refusée par precision-server (« partie en cours »), reste à l\'accueil',
    !(await C.visible('#lobby')) && !(await C.visible('#game')), await texte(C, 'error'));

  // ═══ 16. la partie, jusqu'au bout
  await partie(A, [A, B]);
  const podA = await podiumTient(A, 2), podB = await podiumTient(B, 2);
  for (const [J, p] of [[A, podA], [B, podB]]) {
    t(`${J.nom} : le podium RESTE à l'écran après le \`room\` lobby`, p.game && !p.lobby && p.podium && /Fin de partie/.test(p.titre) && p.fab === 'lobby', JSON.stringify(p));
    t(`${J.nom} : « Retour au Game Hub » affiché, HORS du plateau`, p.hub && p.horsPlateau);
  }
  await B.shot('3-podium');
  const deb = await B.attendsTrame((m) => m.session && m.session.state === 'debrief', 10000, 'debrief');
  t('ended() : le Hub revient en debrief (stage ended)', deb.session.launch.stage === 'ended' && deb.session.history.played[0] === 'precision');

  // ═══ 17. retour au salon, puis au Hub
  await A.click('#fab');
  await A.until(`!document.getElementById('lobby').hidden && document.getElementById('game').hidden`, 5000, 'salon de A');
  const sal = await A.eval(`({ n: document.querySelectorAll('#players .g-player').length, off: document.getElementById('start').disabled, txt: document.getElementById('start').textContent,
    sans: document.getElementById('start-anyway').hidden, hub: !document.getElementById('to-hub').hidden })`);
  t('bouton rond : retour au salon, « Lancer la partie » actif, #to-hub de nouveau caché',
    sal.n === 2 && !sal.off && sal.txt === 'Lancer la partie' && sal.sans && !sal.hub, JSON.stringify(sal));
  await B.click('#to-hub');
  await B.until(`location.pathname === '/games/' && !document.getElementById('lobby').hidden && !document.getElementById('hub-ready').hidden`, 15000, 'retour Hub B');
  t('#to-hub : B revient au Hub, même session, « partie terminée »', /terminée/.test(await texte(B, 'hub-ready')) && B.hub().code === code, await texte(B, 'hub-ready'));
  t('#to-hub n\'a pas la classe .back (réservée au retour portfolio)', await A.eval(`!document.getElementById('to-hub').classList.contains('back') && document.querySelectorAll('a.back').length === 1`));
  const errs = [A, B, C].flatMap((J) => J.erreurs.map((e) => `[${J.nom}] ${e}`));
  t('aucune erreur JS dans les trois navigateurs (Hub)', errs.length === 0, errs.slice(0, 3).join(' | '));

  // ═══ 18. SOLO dans le navigateur : un seul joueur lance tout de suite
  const S = await joueur('S');
  await S.goto(PAGE);
  await S.type('#name-input', 'Solo');
  await S.click('#identity-done');
  await S.click('#hub-create');
  await S.until(`!document.getElementById('lobby').hidden && document.querySelectorAll('#hub-players .hub-card').length === 1`, 20000, 'salon solo');
  for (const id of ['passeur', 'puissance4']) if (await S.eval(`!!document.querySelector('#hub-games [data-pref=veto][data-game=${id}]')`)) await S.click(`#hub-games [data-pref=veto][data-game=${id}]`);
  await S.until(`[...document.querySelectorAll('#hub-games .hub-game[data-eligible=true]')].map((x) => x.dataset.game).join() === 'precision'`, 8000, 'solo : seule Précision');
  await S.click('#hub-draw-btn');
  await S.until(`document.getElementById('hub-result').dataset.game === 'precision' && !document.getElementById('hub-continue').hidden`, 15000, 'révélation solo');
  await S.immobile('#hub-continue');
  await S.click('#hub-continue');
  await S.until(`!document.getElementById('hub-launch').hidden && !document.getElementById('launch-go').hidden`, 8000, 'Ouvrir (solo)');
  await S.immobile('#launch-go');
  await S.click('#launch-go');
  await S.until(auSalon, 20000, 'room solo');
  const ing = await S.attendsTrame((m) => m.session && m.session.state === 'inGame', 8000, 'solo inGame');
  const sst = await S.eval(`({ off: document.getElementById('start').disabled, txt: document.getElementById('start').textContent, sans: document.getElementById('start-anyway').hidden })`);
  t('solo : le Hub passe directement en inGame, « Lancer » actif tout de suite, pas de « sans attendre »',
    ing.session.launch.stage === 'playing' && !sst.off && sst.txt === 'Lancer la partie' && sst.sans, JSON.stringify(sst));
  await S.eval(`document.getElementById('game-select').value = 'color'; document.getElementById('diff-select').value = 'impossible'; document.getElementById('rounds-select').value = '3'; true`);
  await S.click('#start');
  await partie(S, [S]);
  const podS = await podiumTient(S, 1);
  const debS = await S.attendsTrame((m) => m.session && m.session.state === 'debrief', 10000, 'debrief solo');
  t('solo : trois manches jouées seul, podium à un joueur, Hub en debrief', podS.podium && podS.hub && !!debS, JSON.stringify(podS));

  // ═══ 19. HORS Hub : deux joueurs, aucun billet — la page d'avant
  const D = await joueur('D'), E = await joueur('E');
  const DIRECT = `${BASE}/games/precision/?server=${encodeURIComponent(PR)}`;
  for (const [J, nom] of [[D, 'Dora'], [E, 'Émile']]) { await J.goto(DIRECT); await J.type('#name-input', nom); }
  await D.click('#host');
  await D.until(auSalon, 10000, 'room de D');
  const roomD = (await texte(D, 'room-code')).trim();
  await E.type('#code-input', roomD);
  await E.click('#join');
  await D.until(`document.querySelectorAll('#players .g-player').length === 2`, 8000, 'E dans la room');
  const hors = await E.eval(`({ ban: !!document.querySelector('.g-hub-banner'), lien: lien === null, son: !document.getElementById('sound-on').hidden, etat: AUDIO.state() })`);
  t('hors Hub : pas de bandeau, `lien` nul, jamais de bouton de son (le clic sur « Rejoindre » suffit)', !hors.ban && hors.lien && !hors.son && hors.etat === 'running', JSON.stringify(hors));
  const hd = await D.eval(`({ off: document.getElementById('start').disabled, sans: document.getElementById('start-anyway').hidden, txt: document.getElementById('start').textContent })`);
  t('hors Hub : « Lancer » actif, pas de « sans attendre »', !hd.off && hd.sans && hd.txt === 'Lancer la partie', JSON.stringify(hd));
  t('hors Hub : aucune trame du Hub, une room distincte', !D.trames.some((m) => m.session) && !E.trames.some((m) => m.session) && roomD !== roomA);
  await D.eval(`document.getElementById('diff-select').value = 'impossible'; document.getElementById('rounds-select').value = '3'; true`);
  await D.click('#start');
  await partie(D, [D, E]);
  const pD = await podiumTient(D, 2), pE = await podiumTient(E, 2);
  t('hors Hub : le podium reste à l\'écran chez les deux, pas de « Retour au Game Hub »', [pD, pE].every((p) => p.game && !p.lobby && p.podium && !p.hub), JSON.stringify(pE));
  await E.click('#fab');
  await E.until(`!document.getElementById('lobby').hidden`, 5000, 'salon de E');
  t('hors Hub : le bouton rond ramène au salon, sans bouton de son', !(await E.visible('#sound-on')));
  const errs2 = [S, D, E].flatMap((J) => J.erreurs.map((e) => `[${J.nom}] ${e}`));
  t('aucune erreur JS (solo, hors Hub)', errs2.length === 0, errs2.slice(0, 3).join(' | '));
} catch (e) {
  t('EXCEPTION (navigateurs)', false, e.message);
  for (const J of joueurs) {
    const etat = await J.eval(`location.href + ' | phase : ' + (typeof phase === 'string' ? phase : '-') + ' | erreur : ' + ((document.getElementById('error') || {}).textContent || '')
      + ' | bandeau : ' + ((document.querySelector('.g-hub-banner') || {}).textContent || '')`).catch((x) => x.message);
    console.log(`     [${J.nom}] ${etat}${J.erreurs.length ? ' | JS : ' + J.erreurs.join(' / ') : ''}`);
  }
} finally {
  stop();
}
console.log(`\n${ko ? 'DES TESTS ÉCHOUENT' : 'TOUT PASSE'} — ${out.length} vérifications, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
