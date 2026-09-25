// Handoff Hub → Le Jeu du Ban, de bout en bout : le vrai game-hub-server et le
// VRAI ban-server, lancés en local depuis les dépôts voisins. Aucun mock : le
// code de room est celui que ban-server fabrique.
//
//   node tests/handoff-ban.mjs
//   node tests/handoff-ban.mjs --reduced       mouvement réduit
//   node tests/handoff-ban.mjs --shots <dir>   une capture par étape
//
// Trois étages, du plus sec au plus réel :
//
//   1. le billet, sans réseau ni navigateur ;
//   2. le PROTOCOLE, deux joueurs en Node : A crée la session du Hub, B
//      rejoint → seul le Ban éligible → A tire → A crée la room (join SANS
//      code, le protocole normal du jeu) → A déclare le code → B le relit dans
//      SON état de session et rejoint CE code → inGame → une vraie partie
//      (découverte, tours, STOP, résultats), avec l'ordre exact des trames de
//      fin (`phase:end` PUIS `room` en phase lobby) → un retardataire est
//      refusé → ended ;
//   3. de VRAIS NAVIGATEURS (Edge par le protocole DevTools, trois contextes
//      isolés) : portfolio → /games/ → tirage → la page du Ban attend que
//      l'hôte coche l'AVERTISSEMENT, puis crée la room → B (avertissement
//      déjà accepté) entre sans rien cocher → A lance SANS attendre Chloé →
//      Chloé, en retard, coche puis est refusée → la partie jusqu'au podium,
//      qui reste à l'écran → retour au salon (plus aucun avertissement) →
//      retour au Hub. Puis deux joueurs HORS Hub : la page d'avant, et le
//      retour forcé au salon quand l'autre joueur s'en va.
//
// ⚠️ AUCUN SECOND PROTOCOLE DE ROOM. Le Hub ne parle jamais à ban-server : ce
// sont les pages qui lui parlent, par son `join` habituel. C'est le montage du
// Passeur, d'Imitation et du Demi-Cercle.
//
// ⚠️ `VIDEOS_JSON` : ban-server n'ira pas chercher son catalogue sur GitHub
// Pages, et `?cdn=` pointe les vidéos vers le serveur du test (404 : la vidéo
// ne se charge pas, mais `play`, `stop` et `skip` passent par le serveur, et la
// partie se joue). Aucun réseau sortant.
//
// ⚠️ ban-server a besoin de `ws`. Sur un poste où son `npm install` n'a pas
// été fait, NODE_PATH peut pointer sur un autre node_modules qui l'a (celui de
// game-hub-server, par exemple) : le processus fils en hérite.
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
// L'alphabet des codes de room du Ban (src/server.js : sans I, L, O, 0, 1).
const CODE_RE = /^[A-HJKMNP-Z2-9]{4}$/;
const require = createRequire(import.meta.url);
const H = require(path.join(ROOT, 'games/shared/game-hub.js'));
const HH = require(path.join(ROOT, 'games/shared/hub-handoff.js'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = () => Math.floor(Math.random() * 300);
const HUB_PORT = 8300 + R(), BAN_PORT = 8900 + R(), HEALTH_PORT = 6100 + R(), HTTP_PORT = 8700 + R(), CDP_PORT = 9700 + R();
const VIDEOS = [{ id: 'v1', fatal: 1.5, startAt: 0 }, { id: 'v2', fatal: 2.5, startAt: 0 }];

let out = [], ko = 0;
const t = (nom, ok, detail = '') => {
  out.push(`${ok ? 'OK  ' : 'KO  '} ${nom}${detail ? ' — ' + detail : ''}`);
  if (!ok) ko++;
  console.log(out[out.length - 1]);
};

// ═══════════════════════════════ 1. le billet, sans réseau ni navigateur
console.log('Handoff Ban — le billet\n');
const BON = { v: 1, hub: 'ws://127.0.0.1:8100', session: 'AB2DE', playerId: 'p_alice', drawId: 'd_1', gameId: 'ban', role: 'host', at: Date.now() };
t('billet valable pour ban', !!HH.readTicket(BON, 'ban'));
t('billet d\'un AUTRE jeu : refusé par la page du Ban', !HH.readTicket({ ...BON, gameId: 'demicercle' }, 'ban'));
t('billet sans rôle connu : refusé', !HH.readTicket({ ...BON, role: 'spectateur' }, 'ban'));
t('billet périmé (plus de 3 h) : refusé', !HH.readTicket({ ...BON, at: Date.now() - HH.MAX_AGE_MS - 1000 }, 'ban'));
t('billet au code de session bidon : refusé', !HH.readTicket({ ...BON, session: 'abc' }, 'ban'));
t('billet dont le hub n\'est pas une URL WebSocket : refusé', !HH.readTicket({ ...BON, hub: 'http://x' }, 'ban'));
t('les deux rôles sont acceptés', !!HH.readTicket({ ...BON, role: 'guest' }, 'ban'));

// ═══════════════════════════════ 2. les vrais serveurs
const procs = [];
const lance = (cwd, file, port, env = {}) => {
  const p = spawn(process.execPath, [file], { cwd, env: { ...process.env, PORT: String(port), HUB_QUIET: '1', ...env }, stdio: 'ignore' });
  procs.push(p); return p;
};
async function attends(url) { for (let i = 0; i < 100; i++) { try { const r = await fetch(url); if (r.ok) return; } catch (_) {} await sleep(100); } throw new Error('injoignable : ' + url); }

const sante = await fakeHealth(HEALTH_PORT);
const MANIFEST = localManifest(ROOT, HEALTH_PORT, { ban: `http://127.0.0.1:${BAN_PORT}/` });
lance(path.join(ROOT, '..', 'ban-server'), 'src/server.js', BAN_PORT, { VIDEOS_JSON: JSON.stringify(VIDEOS), TURN_SAFETY_MS: '4000' });
lance(path.join(ROOT, '..', 'game-hub-server'), 'src/server.js', HUB_PORT, { MANIFEST_FILE: MANIFEST });
const HUB = `ws://127.0.0.1:${HUB_PORT}`, BAN = `ws://127.0.0.1:${BAN_PORT}`;

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

// Le client du jeu : un WebSocket vers ban-server, rien d'autre.
function ban() {
  const ws = new WebSocket(BAN);
  const c = { ws, msgs: [] };
  ws.onmessage = (e) => { if (typeof e.data === 'string') c.msgs.push(JSON.parse(e.data)); };
  c.open = new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ban injoignable')); });
  c.send = (o) => ws.send(JSON.stringify(o));
  c.wait = async (pred, ms = 8000) => { const fin = Date.now() + ms; while (Date.now() < fin) { const m = c.msgs.find(pred); if (m) return m; await sleep(20); } return null; };
  c.last = (type) => [...c.msgs].reverse().find((m) => m.type === type);
  return c;
}
// Le join du Ban : SANS `code` pour créer, AVEC pour rejoindre. Aucun champ
// inventé pour le Hub — c'est le protocole du jeu, tel quel.
const joinBan = (p, code) => (code === undefined
  ? { action: 'join', name: p.name, avatar: p.avatar }
  : { action: 'join', name: p.name, avatar: p.avatar, code });

const IMG = 'data:image/webp;base64,' + fs.readFileSync(path.join(ROOT, '..', 'ban-server', 'test-fixtures', 'avatar-96.webp')).toString('base64');
const pA = { id: 'p_aliceban', name: 'Alice', avatar: { kind: 'image', emoji: '🦊', src: IMG } };
const pB = { id: 'p_brunoban', name: 'Bruno', avatar: { kind: 'emoji', emoji: '🐼' } };

try {
  await attends(`http://127.0.0.1:${BAN_PORT}/`);
  await attends(`http://127.0.0.1:${HUB_PORT}/health`);
  console.log(`\nHandoff Hub → Ban — protocole réel (Hub :${HUB_PORT}, Ban :${BAN_PORT})\n`);

  // ═══ 3. le groupe, et un tirage qui ne peut donner que le Ban
  const A = hubClient(), B = hubClient();
  const sA = suivi(A), sB = suivi(B);
  const code = (await A.create(pA)).session.code;
  await B.join(code, pB);
  await sA.until((s) => s.pool && s.pool.catalog === 'ready' && s.players.length === 2);
  B.setPrefs([], ['morpion', 'imitation', 'demicercle', 'precision', 'passeur']);
  const seul = await sA.until((s) => JSON.stringify(s.pool.eligible) === '["ban"]');
  t('le groupe (2) : seul le Ban est éligible (vetos de B)', !!seul, JSON.stringify(sA.last.pool.eligible));
  t('l\'avertissement n\'écarte rien au Hub (consent acquis d\'office)', !(sA.last.pool.why.ban || []).length);
  const entree = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/games.manifest.json'), 'utf8')).games.find((g) => g.id === 'ban');
  t('le manifest annonce le handoff du Ban, et garde son besoin `consent`', entree.handoff === true && JSON.stringify(entree.needs) === '["consent"]');
  A.draw();
  const tire = await sA.until((s) => s.draw && s.draw.status === 'drawn');
  t('tirage serveur : le Ban', !!tire && tire.draw.gameId === 'ban', tire && tire.draw.gameId);
  const drawId = tire.draw.id;

  // ═══ 4. continuer → lancement, rôles, URL
  A.confirm();
  const l0 = await sB.until((s) => s.state === 'launching');
  t('continuer → launching (stage create), lié au tirage', !!l0 && l0.launch.stage === 'create' && l0.launch.drawId === drawId);
  t('rôles : A host du lancement, B guest', l0.launch.hostId === pA.id && l0.launch.hostId !== pB.id);
  t('le Hub donne l\'URL du jeu (manifest)', l0.launch.url === 'games/ban/', l0.launch.url);

  // ═══ 5. A « navigue » : sa page du Hub se ferme, la page du jeu rouvre le Hub
  A._drop();
  await sB.until((s) => s.players.find((p) => p.id === pA.id).connected === false, 4000);
  const A2 = hubClient(), sA2 = suivi(A2);
  await A2.join(code, pA);
  t('navigation de A : même player.id, toujours hôte du lancement',
    sA2.last.hostId === pA.id && sA2.last.launch.hostId === pA.id && sA2.last.players.length === 2);

  // ═══ 6. A crée la room par le protocole NORMAL du Ban : join SANS code
  const BA = ban(); await BA.open;
  BA.send(joinBan(pA));
  const roomA = await BA.wait((m) => m.type === 'room');
  const moiA = roomA && roomA.players.find((p) => p.id === roomA.you);
  t('Ban : room créée par un join SANS code, vrai code renvoyé', !!roomA && CODE_RE.test(roomA.code), roomA && roomA.code);
  t('Ban : le créateur est le MJ (host) de la room', !!moiA && moiA.host === true);
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
  const BB = ban(); await BB.open;
  BB.send(joinBan(pB, vuB));
  const roomB = await BB.wait((m) => m.type === 'room');
  const moiB = roomB && roomB.players.find((p) => p.id === roomB.you);
  t('B : entré dans la room du Ban par le protocole normal (join + code)',
    !!roomB && roomB.code === roomCode && !!moiB && moiB.host === false);
  B2.entered(drawId, roomB.code);
  const enJeu = await sA2.until((s) => s.state === 'inGame');
  t('Hub : tout le groupe est entré → inGame, personne en attente',
    !!enJeu && enJeu.launch.waiting.length === 0 && enJeu.launch.entered.length === 2);

  // ═══ 9. UNE seule room, vue par ban-server lui-même
  await sleep(300);
  const lob = BA.last('room');
  t('Ban : A + B dans LA MÊME room (vue du serveur du jeu)',
    !!lob && lob.code === roomCode && lob.players.length === 2
    && ['Alice', 'Bruno'].every((n) => lob.players.some((p) => p.name === n)), lob && lob.players.map((p) => p.name).join(','));
  const pa = lob.players.find((p) => p.name === 'Alice');
  t('la vraie PP de A arrive dans le Ban (image, pas l\'emoji)', !!pa && pa.avatar && pa.avatar.kind === 'image' && pa.avatar.src === IMG);

  // ═══ 10. une vraie partie, jusqu'au bout (une vidéo)
  BA.send({ action: 'start', videos: 1 });
  const prA = await BA.wait((m) => m.type === 'phase' && m.phase === 'preview');
  const prB = await BB.wait((m) => m.type === 'phase' && m.phase === 'preview');
  t('A démarre : les deux reçoivent la découverte de la vidéo 1 (le vrai début)',
    !!prA && !!prB && prA.round === 1 && prB.round === 1, prA && `vidéo ${prA.round}/${prA.of} (${prA.videoId})`);
  t('zéro confiance : `fatal` absent de la découverte', !('fatal' in prA) && !('fatal' in prB));
  A2.started(drawId);
  await sleep(200);
  t('Hub : toujours inGame pendant la partie', sA2.last.state === 'inGame', sA2.last.state);

  const BC = ban(); await BC.open;
  BC.send(joinBan({ name: 'Chloé', avatar: { kind: 'emoji', emoji: '🐸' } }, roomCode));
  const refus = await BC.wait((m) => m.type === 'error');
  t('un retardataire est refusé (« partie en cours »), la room garde 2 joueurs',
    !!refus && /partie en cours/.test(refus.message) && !BC.msgs.some((m) => m.type === 'room'), refus && refus.message);

  // Les tours : le joueur actif lance SA vidéo et stoppe ; le MJ enchaîne.
  BA.send({ action: 'next' });                                // découverte → premier tour
  const parId = { [roomA.you]: BA, [roomB.you]: BB };
  let stops = 0;
  for (let tour = 0; tour < 2; tour++) {
    const tr = await BA.wait((m) => m.type === 'phase' && m.phase === 'turn' && BA.msgs.indexOf(m) > (BA._vu || -1));
    BA._vu = BA.msgs.indexOf(tr);
    const actif = parId[tr.active];
    const nPlay = actif.msgs.length;
    actif.send({ action: 'play' });
    await actif.wait((m) => m.type === 'play' && actif.msgs.indexOf(m) >= nPlay);
    await sleep(300);
    actif.send({ action: 'stop', time: 0.3 });
    const st = await BA.wait((m) => m.type === 'stopped' && m.id === tr.active);
    if (st && !st.skipped) stops++;
    BA.send({ action: 'next' });                              // tour suivant / résultats
  }
  t('deux tours : chacun lance sa vidéo et stoppe, recoupé à l\'horloge du serveur', stops === 2);
  const res = await BB.wait((m) => m.type === 'phase' && m.phase === 'results');
  t('résultats : `fatal` révélé seulement maintenant, classement à deux', !!res && res.fatal === VIDEOS.find((v) => v.id === prA.videoId).fatal && res.ranking.length === 2, res && `fatal ${res.fatal}`);
  BA.send({ action: 'next' });                                // résultats → fin
  const endB = await BB.wait((m) => m.type === 'phase' && m.phase === 'end');
  t('fin de partie : podium à deux joueurs', !!endB && endB.podium.length === 2);
  await sleep(200);
  const iEnd = BB.msgs.indexOf(endB);
  const lobbyApres = BB.msgs.findIndex((m, i) => i > iEnd && m.type === 'room' && m.phase === 'lobby');
  t('ORDRE DES TRAMES : `phase:end` PUIS `room` en phase lobby', iEnd >= 0 && lobbyApres > iEnd, `end #${iEnd}, room lobby #${lobbyApres}`);

  // ═══ 11. fin → retour au Hub
  A2.ended(drawId);
  const deb = await sB2.until((s) => s.state === 'debrief');
  t('ended : le Hub revient en debrief, prêt pour un nouveau tirage',
    !!deb && deb.launch.stage === 'ended' && deb.history.played[0] === 'ban');

  // ═══ 12. hors Hub : le jeu reste autonome
  const BD = ban(); await BD.open;
  BD.send(joinBan({ name: 'Solo', avatar: { kind: 'emoji', emoji: '🎬' } }));
  const roomD = await BD.wait((m) => m.type === 'room');
  const BE = ban(); await BE.open;
  BE.send(joinBan({ name: 'Duo', avatar: { kind: 'emoji', emoji: '🍿' } }, roomD.code));
  const roomE = await BE.wait((m) => m.type === 'room');
  t('hors Hub : une room SÉPARÉE, créée et rejointe à la main',
    !!roomE && roomE.code === roomD.code && roomE.players.length === 2 && roomD.code !== roomCode, roomD && roomD.code);

  for (const P of [BA, BB, BC, BD, BE]) { try { P.ws.close(); } catch (_) {} }
  for (const X of [A2, B2]) { try { X.leave(); } catch (_) {} }
  await sleep(200);
} catch (e) {
  t('EXCEPTION (protocole)', false, e && (e.stack || e.message));
}

// ═══════════════════════════════ 3. de vrais navigateurs
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json' };
// Le site tel quel, avec DEUX redirections propres au test : les liens réels
// (`games/` depuis la home, `games/ban/` depuis le Hub) n'ont pas de `?hub=` /
// `?server=` / `?cdn=` — ils iraient en production. On les redirige vers les
// serveurs locaux ; les liens eux-mêmes ne changent pas.
function serve() {
  const s = createServer((req, res) => {
    const [p0, q] = req.url.split('?');
    if (p0 === '/games/' && !/(^|&)hub=/.test(q || '')) { res.writeHead(302, { Location: `/games/?hub=${encodeURIComponent(HUB)}` }); return res.end(); }
    if (p0 === '/games/ban/' && !/(^|&)server=/.test(q || '')) { res.writeHead(302, { Location: `/games/ban/?server=${encodeURIComponent(BAN)}&cdn=${encodeURIComponent(`http://127.0.0.1:${HTTP_PORT}/cdn-test`)}` }); return res.end(); }
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

const surBan = `location.pathname === '/games/ban/' && document.readyState === 'complete'`;
const texte = (J, id) => J.eval(`(document.getElementById(${JSON.stringify(id)}) || {}).textContent || ''`);

// Une partie complète au Ban, avec les vrais boutons : le joueur actif lance SA
// vidéo puis STOP ; le MJ enchaîne (découverte → tours → résultats → fin).
// La vidéo ne se charge pas (CDN du test en 404) : `play` et `stop` passent par
// le serveur, c'est lui qui compte le temps.
async function partie(mj, tous) {
  const autres = tous.filter((J) => J !== mj);
  for (let i = 0; i < 40; i++) {
    if (await mj.eval(`phase === 'end'`)) return;
    let fait = false;
    for (const J of tous) if (await J.visible('#stop-btn')) { await sleep(250); await J.click('#stop-btn'); fait = true; break; }
    if (!fait) for (const J of autres) if (await J.eval(`phase === 'turn' && youActive && !turnPlaying && !turnStopped`)) { await J.click('#play-btn'); fait = true; break; }
    if (!fait && await mj.visible('#host-next')) { await mj.click('#host-next'); fait = true; }
    if (!fait && await mj.eval(`phase === 'turn' && youActive && !turnPlaying && !turnStopped`)) { await mj.click('#play-btn'); fait = true; }
    await sleep(fait ? 350 : 150);
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
    const sc = document.getElementById('scores');
    return { game: vis('game'), lobby: vis('lobby'), podium: vis('scores') && sc.querySelectorAll('li').length === ${nb},
      medailles: sc.querySelectorAll('.medal').length, titre: document.getElementById('turn-title').textContent,
      retour: vis('to-lobby'), hub: vis('to-hub') };
  })()`);
}

try {
  srv = await serve();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'handoffban-'));
  edge = spawn(EDGE, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${dir}`, '--no-first-run',
    '--disable-features=BackForwardCache', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
  cdp = await cdpBrowser();
  const BASE = `http://127.0.0.1:${HTTP_PORT}`;
  const PAGE = `${BASE}/games/?hub=${encodeURIComponent(HUB)}`;
  console.log(`\nHandoff Hub → Ban — trois navigateurs (${REDUCED ? 'mouvement RÉDUIT' : 'mouvement normal'})\n`);
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
  // B a déjà accepté l'avertissement du Ban un autre jour (même origine) ; A et
  // Chloé, jamais.
  await B.eval(`localStorage.setItem('ban-tw-ok', '1'); true`);
  t('avertissement : jamais accepté chez A et Chloé, déjà accepté chez B',
    (await A.eval(`localStorage.getItem('ban-tw-ok')`)) === null && (await C.eval(`localStorage.getItem('ban-tw-ok')`)) === null);

  for (const id of ['imitation', 'demicercle', 'precision', 'passeur', 'quiment']) await B.click(`#hub-games [data-pref=veto][data-game=${id}]`);
  await A.until(`[...document.querySelectorAll('#hub-games .hub-game[data-eligible=true]')].map((x) => x.dataset.game).join() === 'ban'`, 8000, 'seul le Ban');
  await A.click('#hub-draw-btn');
  for (const J of [A, B, C]) await J.until(`document.getElementById('hub-result').dataset.game === 'ban' && !document.getElementById('hub-result').hidden`, 15000, `révélation ${J.nom}`);
  t('tirage : le Ban, révélé chez les trois', true);

  // ═══ 14. A ouvre le jeu : l'avertissement d'abord, la room ensuite
  await A.click('#hub-continue');
  await A.until(`!document.getElementById('launch-go').hidden`, 8000, 'Ouvrir');
  await A.click('#launch-go');
  await A.until(`${surBan} && /avertissement/.test(document.getElementById('error').textContent)`, 15000, 'A sur le Ban, avertissement demandé');
  await sleep(700);
  const avant = await A.eval(`({ home: !document.getElementById('home').hidden, tw: !document.getElementById('tw').hidden, coche: document.getElementById('tw-check').checked,
    focus: document.activeElement && document.activeElement.id, msg: document.getElementById('error').textContent, nom: document.getElementById('name-input').value })`);
  t('host sans avertissement accepté : reste à l\'accueil, la case est demandée (focus dessus)',
    avant.home && avant.tw && !avant.coche && avant.focus === 'tw-check' && avant.nom === 'Alice', JSON.stringify(avant));
  t('… et AUCUNE room n\'est créée tant que la case n\'est pas cochée',
    !A.trames.some((m) => m.type === 'room') && A.hub().launch.stage === 'create');
  await A.shot('1-ban-avertissement');
  await A.click('#tw-check');
  await A.until(`!document.getElementById('lobby').hidden && /^[A-Z2-9]{4}$/.test(document.getElementById('room-code').textContent.trim())`, 15000, 'room créée après la case');
  const roomA = (await texte(A, 'room-code')).trim();
  t('case cochée : la room se crée toute seule (join sans code), A est le MJ', CODE_RE.test(roomA)
    && A.trames.some((m) => m.type === 'room' && m.code === roomA && m.players.find((p) => p.id === m.you)?.host), roomA);
  t('l\'acceptation est retenue (`ban-tw-ok`)', (await A.eval(`localStorage.getItem('ban-tw-ok')`)) === '1');
  const lancee = await A.attendsTrame((m) => m.session && m.session.launch && m.session.launch.roomCode === roomA, 8000, 'code au Hub');
  t('le code arrive au Hub (stage join) — celui de LA room du Ban', lancee.session.launch.stage === 'join');
  const banA = await A.eval(`(document.querySelector('.g-hub-banner') || {}).textContent || ''`);
  t('bandeau Game Hub sur la page du Ban', new RegExp(code).test(banA) && /attendus/.test(banA), banA);
  const att = await A.eval(`({ off: document.getElementById('start').disabled, txt: document.getElementById('start').textContent, sans: !document.getElementById('start-anyway').hidden })`);
  t('« Lancer » attend le groupe (désactivé, nomme les absents) + « Lancer sans attendre »', att.off && /Bruno/.test(att.txt) && /Chloé/.test(att.txt) && att.sans, att.txt);
  const sansDeb = [];
  for (const [w, h] of [[390, 780], [1100, 1000]]) {
    await A.size(w, h); await sleep(200);
    sansDeb.push([w, await A.eval(`(() => { const r = document.getElementById('start-anyway').getBoundingClientRect(), p = document.getElementById('lobby').getBoundingClientRect();
      return { over: document.documentElement.scrollWidth - innerWidth, dedans: r.left >= p.left - 1 && r.right <= p.right + 1 && r.width > 0 }; })()`)]);
  }
  t('« Lancer sans attendre » tient dans le panneau, sans débordement (390 et 1100 px)', sansDeb.every(([, m]) => m.over <= 0 && m.dedans), JSON.stringify(sansDeb));
  await A.shot('2-ban-hote-attend');

  // ═══ 15. B (avertissement déjà accepté) rejoint sans rien cocher
  await B.until(`!document.getElementById('launch-go').hidden && /Rejoindre/.test(document.getElementById('launch-go').textContent)`, 10000, 'Rejoindre chez B');
  await B.immobile('#launch-go');   // ⚠️ défilement doux de /games/ : voir handoff-demicercle.mjs
  await B.click('#launch-go');
  await B.until(surBan, 15000, 'B sur le Ban');
  await B.until(`!document.getElementById('lobby').hidden && document.getElementById('room-code').textContent.trim() === ${JSON.stringify(roomA)}`, 20000, 'B dans la room');
  t('guest déjà d\'accord : auto-jointure de LA room, sans case à cocher ni code à saisir',
    (await texte(B, 'room-code')).trim() === roomA && !/avertissement/.test(await texte(B, 'error')));
  await A.until(`document.querySelectorAll('#players .g-player').length === 2`, 8000, '2 joueurs chez A');
  const entre = await A.attendsTrame((m) => m.session && m.session.launch && m.session.launch.entered.length === 2, 8000, 'entered');
  t('Hub : B déclaré `entered`, Chloé toujours attendue', entre.session.launch.waiting.length === 1 && entre.session.launch.waiting[0] === idC);
  const ppA = await B.eval(`(() => { const li = [...document.querySelectorAll('#players .g-player')].find((x) => /Alice/.test(x.textContent)); const img = li && li.querySelector('img');
    return img ? { src: img.getAttribute('src'), ok: img.complete && img.naturalWidth > 0 } : null; })()`);
  t('la VRAIE PP de A s\'affiche dans le salon du Ban, chez B', !!ppA && ppA.src === srcA && ppA.ok);
  t('B n\'annonce son code qu\'une fois', await B.eval(`codeDeclare === ${JSON.stringify(roomA)}`));

  // ═══ 16. A lance SANS attendre Chloé
  await A.eval(`document.getElementById('videos-select').value = '1'; true`);
  await A.click('#start-anyway');
  await A.until(`!document.getElementById('game').hidden && phase === 'preview'`, 8000, 'découverte');
  const pr1 = await A.attendsTrame((m) => m.type === 'phase' && m.phase === 'preview' && m.round === 1, 8000, 'preview 1');
  t('démarrage réel : découverte de la vidéo 1', !!pr1, `vidéo ${pr1.round}/${pr1.of}`);
  const joue = await B.attendsTrame((m) => m.session && m.session.state === 'inGame' && m.session.launch.stage === 'playing', 8000, 'playing');
  t('started() : le Hub passe à inGame/playing, Chloé est « manquée »', JSON.stringify(joue.session.launch.missed) === JSON.stringify([idC]));
  await C.until(`/commencé sans toi/.test(document.getElementById('launch-text').textContent) && document.getElementById('launch-go').hidden`, 8000, 'Chloé manquée');
  t('Chloé, au Hub : « La partie a commencé sans toi », plus de bouton Rejoindre', true);

  // Chloé arrive quand même par un billet (page ouverte en retard). Elle n'a
  // jamais accepté l'avertissement : la case d'abord, puis le serveur du jeu la
  // refuse, et la room garde deux joueurs.
  const sC = C.hub();
  await C.eval(`HubHandoff.write(${JSON.stringify({ hub: HUB, session: sC.code, playerId: idC, drawId: sC.launch.drawId, gameId: 'ban', role: 'guest' })})`);
  await C.navigate(`${BASE}/games/ban/`);
  await C.until(`${surBan} && /avertissement/.test(document.getElementById('error').textContent)`, 15000, 'avertissement chez Chloé');
  t('retardataire : l\'avertissement lui est demandé avant toute tentative', !C.trames.some((m) => m.type === 'room' || (m.type === 'error' && !m.session && /partie/.test(m.message || ''))));
  await C.click('#tw-check');
  await C.until(`/partie en cours/.test(document.getElementById('error').textContent)`, 10000, 'refus de Chloé');
  t('retardataire : refusée par ban-server (« partie en cours »), reste à l\'accueil',
    !(await C.visible('#lobby')) && !(await C.visible('#game')), await texte(C, 'error'));
  await sleep(300);
  t('la room du groupe garde deux joueurs', A.trames.filter((m) => m.type === 'room').pop().players.length === 2);

  // ═══ 17. la partie, jusqu'au bout
  await partie(A, [A, B]);
  const stops = A.trames.filter((m) => m.type === 'stopped' && !m.skipped).length;
  t('les deux joueurs ont lancé leur vidéo et stoppé (vrais boutons)', stops === 2, `${stops} stop(s)`);
  const podA = await podiumTient(A, 2), podB = await podiumTient(B, 2);
  for (const [J, p] of [[A, podA], [B, podB]]) {
    t(`${J.nom} : le podium RESTE à l'écran après le \`room\` lobby`, p.game && !p.lobby && p.podium && p.medailles === 2 && /Fin de partie/.test(p.titre), JSON.stringify(p));
    t(`${J.nom} : « retour au lobby » et « Retour au Game Hub » proposés`, p.retour && p.hub);
  }
  await B.shot('3-ban-podium');
  const deb = await B.attendsTrame((m) => m.session && m.session.state === 'debrief', 10000, 'debrief');
  t('ended() : le Hub revient en debrief (stage ended)', deb.session.launch.stage === 'ended' && deb.session.history.played[0] === 'ban');

  // ═══ 18. retour au salon (sans avertissement), une seconde partie, puis le Hub
  await A.click('#to-lobby');
  await A.until(`!document.getElementById('lobby').hidden && document.getElementById('game').hidden`, 5000, 'salon de A');
  const sal = await A.eval(`({ n: document.querySelectorAll('#players .g-player').length, off: document.getElementById('start').disabled, txt: document.getElementById('start').textContent,
    sans: document.getElementById('start-anyway').hidden, home: !document.getElementById('home').hidden, msg: document.getElementById('error').textContent })`);
  t('#to-lobby : retour au salon, deux joueurs, « Lancer la partie » actif, aucun avertissement',
    sal.n === 2 && !sal.off && sal.txt === 'Lancer la partie' && sal.sans && !sal.home && !/avertissement/.test(sal.msg), JSON.stringify(sal));
  // L'avertissement « oublié » ne doit plus rien bloquer une fois dans le salon.
  await A.eval(`localStorage.removeItem('ban-tw-ok'); true`);
  await B.click('#to-lobby');
  await A.click('#start');
  await B.until(`!document.getElementById('game').hidden && phase === 'preview'`, 8000, 'seconde partie');
  t('seconde partie : relancée du salon, aucun avertissement redemandé', !(await A.visible('#home')) && !(await B.visible('#home')));
  await partie(A, [A, B]);
  await podiumTient(B, 2);
  await B.click('#to-hub');
  await B.until(`location.pathname === '/games/' && !document.getElementById('lobby').hidden && !document.getElementById('hub-ready').hidden`, 15000, 'retour Hub B');
  t('#to-hub : B revient au Hub, même session, « partie terminée »', /terminée/.test(await texte(B, 'hub-ready')) && B.hub().code === code, await texte(B, 'hub-ready'));
  t('#to-hub n\'a pas la classe .back (réservée au retour portfolio)', await A.eval(`!document.getElementById('to-hub').classList.contains('back') && document.querySelectorAll('a.back').length === 1`));
  const errs = [A, B, C].flatMap((J) => J.erreurs.map((e) => `[${J.nom}] ${e}`));
  t('aucune erreur JS dans les trois navigateurs (Hub)', errs.length === 0, errs.slice(0, 3).join(' | '));

  // ═══ 19. HORS Hub : deux joueurs, aucun billet — la page d'avant
  const D = await joueur('D'), E = await joueur('E');
  const DIRECT = `${BASE}/games/ban/?server=${encodeURIComponent(BAN)}&cdn=${encodeURIComponent(`${BASE}/cdn-test`)}`;
  for (const [J, nom] of [[D, 'Dora'], [E, 'Émile']]) { await J.goto(DIRECT); await J.type('#name-input', nom); }
  const verrou = await D.eval(`({ host: document.getElementById('host').disabled, join: document.getElementById('join').disabled, err: document.getElementById('error').textContent })`);
  t('hors Hub : sans la case, « Créer » et « Rejoindre » restent désactivés, aucun message ajouté', verrou.host && verrou.join && verrou.err === '', JSON.stringify(verrou));
  for (const J of [D, E]) await J.click('#tw-check');
  await D.click('#host');
  await D.until(`!document.getElementById('lobby').hidden && /^[A-Z2-9]{4}$/.test(document.getElementById('room-code').textContent.trim())`, 10000, 'room de D');
  const roomD = (await texte(D, 'room-code')).trim();
  await E.type('#code-input', roomD);
  await E.click('#join');
  await D.until(`document.querySelectorAll('#players .g-player').length === 2`, 8000, 'E dans la room');
  const hors = await D.eval(`({ ban: !!document.querySelector('.g-hub-banner'), lien: lien === null, off: document.getElementById('start').disabled, sans: document.getElementById('start-anyway').hidden, txt: document.getElementById('start').textContent })`);
  t('hors Hub : pas de bandeau, `lien` nul, « Lancer » actif dès 2 joueurs, pas de « sans attendre »', !hors.ban && hors.lien && !hors.off && hors.sans && hors.txt === 'Lancer la partie', JSON.stringify(hors));
  t('hors Hub : aucune trame du Hub, une room distincte', !D.trames.some((m) => m.session) && !E.trames.some((m) => m.session) && roomD !== roomA);
  await D.eval(`document.getElementById('videos-select').value = '1'; true`);
  await D.click('#start');
  await partie(D, [D, E]);
  const pD = await podiumTient(D, 2), pE = await podiumTient(E, 2);
  t('hors Hub : le podium reste à l\'écran chez les deux', [pD, pE].every((p) => p.game && !p.lobby && p.podium && p.retour), JSON.stringify(pE));
  t('hors Hub : pas de « Retour au Game Hub »', !pD.hub && !pE.hub);
  for (const J of [D, E]) { await J.click('#to-lobby'); await J.until(`!document.getElementById('lobby').hidden`, 5000, `salon de ${J.nom}`); }
  t('hors Hub : #to-lobby ramène au salon', true);

  // ═══ 20. retour FORCÉ au salon : l'autre joueur s'en va en pleine partie
  await D.click('#start');
  await D.until(`!document.getElementById('game').hidden && phase === 'preview'`, 8000, 'partie 2');
  await E.navigate('about:blank');                                // E ferme la page
  await D.until(`/plus assez de joueurs/.test(document.getElementById('error').textContent)`, 8000, 'retour forcé annoncé');
  await sleep(500);
  const force = await D.eval(`({ lobby: !document.getElementById('lobby').hidden, game: !document.getElementById('game').hidden, phase, n: document.querySelectorAll('#players .g-player').length })`);
  t('retour forcé (« plus assez de joueurs ») : le salon s\'affiche, plus d\'écran de jeu figé',
    force.lobby && !force.game && force.phase === 'lobby' && force.n === 1, JSON.stringify(force));
  const errs2 = [D, E].flatMap((J) => J.erreurs.map((e) => `[${J.nom}] ${e}`));
  t('aucune erreur JS hors Hub', errs2.length === 0, errs2.slice(0, 3).join(' | '));
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
