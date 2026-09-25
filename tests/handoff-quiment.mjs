// Handoff Hub → Qui Ment ?, de bout en bout : le vrai game-hub-server et le
// VRAI qui-ment-server, lancés en local depuis les dépôts voisins. Aucun mock :
// le code de room est celui que qui-ment-server fabrique.
//
//   node tests/handoff-quiment.mjs
//   node tests/handoff-quiment.mjs --reduced       mouvement réduit
//   node tests/handoff-quiment.mjs --shots <dir>   une capture par étape
//
// Trois étages, du plus sec au plus réel :
//
//   1. le billet, sans réseau ni navigateur ;
//   2. le PROTOCOLE, trois joueurs en Node (Qui Ment ? se joue à 3 au moins) :
//      A crée la session du Hub, B et C la rejoignent → seul Qui Ment ? est
//      éligible → A tire → A crée la room (join SANS code, le protocole normal
//      du jeu) → A déclare le code → B et C le relisent dans LEUR état de
//      session et rejoignent CE code → inGame → vraie partie jusqu'au
//      classement, le mot jamais chez l'intrus avant les résultats → un
//      retardataire est refusé → ended ;
//   3. de VRAIS NAVIGATEURS (Edge par le protocole DevTools, contextes
//      isolés) : portfolio → /games/ → tirage → la page de Qui Ment ? crée la
//      room toute seule → B et C rejoignent → « Lancer » attend Dora → A lance
//      SANS l'attendre → Dora, en retard, est refusée → une manche jouée pour
//      de vrai (indices, vote), les suivantes au bouton du MJ → classement →
//      retour au Hub. Puis un SECOND lancement dans la même session, à quatre,
//      où « Lancer » s'ouvre de lui-même quand tout le monde est entré, et
//      enfin trois joueurs HORS Hub : la page se joue exactement comme avant.
//
// ⚠️ AUCUN SECOND PROTOCOLE DE ROOM. Le Hub ne parle jamais à qui-ment-server :
// ce sont les pages qui lui parlent, par son `join` habituel. C'est le montage
// du Passeur (handoff.mjs, handoff-play.mjs) et des autres jeux branchés.
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
// L'alphabet des codes de room de Qui Ment ? (server.js : lettres sans I, L, O).
const CODE_RE = /^[A-HJKMNP-Z]{4}$/;
const require = createRequire(import.meta.url);
const H = require(path.join(ROOT, 'games/shared/game-hub.js'));
const HH = require(path.join(ROOT, 'games/shared/hub-handoff.js'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = () => Math.floor(Math.random() * 300);
const HUB_PORT = 8300 + R(), QM_PORT = 8900 + R(), HEALTH_PORT = 6100 + R(), HTTP_PORT = 8700 + R(), CDP_PORT = 9700 + R();
// Tout ce qui n'est pas Qui Ment ? est écarté par B : il ne reste que lui.
const AUTRES = ['morpion', 'imitation', 'demicercle', 'ban', 'precision', 'passeur'];
// Les messages de jeu (hors salon) : ce qui fait avancer une manche.
const JEU = ['role', 'clues', 'vote', 'guessing', 'results', 'end'];

let out = [], ko = 0;
const t = (nom, ok, detail = '') => {
  out.push(`${ok ? 'OK  ' : 'KO  '} ${nom}${detail ? ' — ' + detail : ''}`);
  if (!ok) ko++;
  console.log(out[out.length - 1]);
};

// ═══════════════════════════════ 1. le billet, sans réseau ni navigateur
console.log('Handoff Qui Ment ? — le billet\n');
const BON = { v: 1, hub: 'ws://127.0.0.1:8100', session: 'AB2DE', playerId: 'p_alice', drawId: 'd_1', gameId: 'quiment', role: 'host', at: Date.now() };
t('billet valable pour quiment', !!HH.readTicket(BON, 'quiment'));
t('billet d\'un AUTRE jeu : refusé par la page de Qui Ment ?', !HH.readTicket({ ...BON, gameId: 'passeur' }, 'quiment'));
t('billet périmé (plus de 3 h) : refusé', !HH.readTicket({ ...BON, at: Date.now() - HH.MAX_AGE_MS - 1000 }, 'quiment'));
t('les deux rôles sont acceptés', !!HH.readTicket({ ...BON, role: 'guest' }, 'quiment'));
const MAN = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/games.manifest.json'), 'utf8')).games.find((g) => g.id === 'quiment');
t('manifest : Qui Ment ? lançable par le Hub, le reste inchangé (v1, 3 à 8, replay)',
  MAN.handoff === true && MAN.join === 'v1' && MAN.players.min === 3 && MAN.players.max === 8 && MAN.replay === true && MAN.content === false, JSON.stringify(MAN));

// ═══════════════════════════════ 2. les vrais serveurs
const procs = [];
const lance = (cwd, file, port, env = {}) => {
  const p = spawn(process.execPath, [file], { cwd, env: { ...process.env, PORT: String(port), HUB_QUIET: '1', PRESENCE_QUIET: '1', ...env }, stdio: 'ignore' });
  procs.push(p); return p;
};
async function attends(url) { for (let i = 0; i < 100; i++) { try { const r = await fetch(url); if (r.ok) return; } catch (_) {} await sleep(100); } throw new Error('injoignable : ' + url); }

const sante = await fakeHealth(HEALTH_PORT);
const MANIFEST = localManifest(ROOT, HEALTH_PORT, { quiment: `http://127.0.0.1:${QM_PORT}/` });
lance(path.join(ROOT, '..', 'qui-ment-server'), 'server.js', QM_PORT);
lance(path.join(ROOT, '..', 'game-hub-server'), 'src/server.js', HUB_PORT, { MANIFEST_FILE: MANIFEST });
const HUB = `ws://127.0.0.1:${HUB_PORT}`, QM = `ws://127.0.0.1:${QM_PORT}`;

let edge = null, cdp = null, srv = null, dir = null;
const joueurs = [];
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

// Le client du jeu : un WebSocket vers qui-ment-server, rien d'autre.
function qm() {
  const ws = new WebSocket(QM);
  const c = { ws, msgs: [] };
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.type !== 'presence') c.msgs.push(m); };
  c.open = new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('qui-ment injoignable')); });
  c.send = (o) => ws.send(JSON.stringify(o));
  c.wait = async (pred, ms = 8000) => { const fin = Date.now() + ms; while (Date.now() < fin) { const m = c.msgs.find(pred); if (m) return m; await sleep(20); } return null; };
  c.apres = async (n, pred, ms = 8000) => c.wait((m) => c.msgs.indexOf(m) >= n && pred(m), ms);
  return c;
}
const joinQM = (p, code) => (code === undefined
  ? { action: 'join', name: p.name, avatar: p.avatar }
  : { action: 'join', name: p.name, avatar: p.avatar, code });

const pA = { id: 'p_aliceqm', name: 'Alice', avatar: { kind: 'emoji', emoji: '🦊' } };
const pB = { id: 'p_brunoqm', name: 'Bruno', avatar: { kind: 'emoji', emoji: '🐼' } };
const pC = { id: 'p_chloeqm', name: 'Chloé', avatar: { kind: 'emoji', emoji: '🐸' } };

try {
  await attends(`http://127.0.0.1:${QM_PORT}/`);
  await attends(`http://127.0.0.1:${HUB_PORT}/health`);
  console.log(`\nHandoff Hub → Qui Ment ? — protocole réel (Hub :${HUB_PORT}, Qui Ment ? :${QM_PORT})\n`);

  // ═══ 3. le groupe (3), et un tirage qui ne peut donner que Qui Ment ?
  const A = hubClient(), B = hubClient(), C = hubClient();
  const sA = suivi(A), sB = suivi(B), sC = suivi(C);
  const code = (await A.create(pA)).session.code;
  await B.join(code, pB);
  await C.join(code, pC);
  await sA.until((s) => s.pool && s.pool.catalog === 'ready' && s.players.length === 3);
  B.setPrefs([], AUTRES);
  const seul = await sA.until((s) => JSON.stringify(s.pool.eligible) === '["quiment"]');
  t('le groupe (3) : seul Qui Ment ? est éligible (vetos de B)', !!seul, JSON.stringify(sA.last.pool.eligible));
  A.draw();
  const tire = await sA.until((s) => s.draw && s.draw.status === 'drawn');
  t('tirage serveur : Qui Ment ?', !!tire && tire.draw.gameId === 'quiment', tire && tire.draw.gameId);
  const drawId = tire.draw.id;

  // ═══ 4. continuer → lancement
  A.confirm();
  const l0 = await sB.until((s) => s.state === 'launching');
  t('continuer → launching (stage create), lié au tirage, A hôte', !!l0 && l0.launch.stage === 'create' && l0.launch.drawId === drawId && l0.launch.hostId === pA.id);
  t('le Hub donne l\'URL du jeu (manifest)', l0.launch.url === 'games/quiment/', l0.launch.url);

  // ═══ 5. A « navigue », rouvre le Hub avec le même player.id, crée la room
  A._drop();
  await sB.until((s) => s.players.find((p) => p.id === pA.id).connected === false, 4000);
  const A2 = hubClient(), sA2 = suivi(A2);
  await A2.join(code, pA);
  t('navigation de A : même player.id, toujours hôte du lancement', sA2.last.launch.hostId === pA.id && sA2.last.players.length === 3);
  const QA = qm(); await QA.open;
  QA.send(joinQM(pA));
  const youA = await QA.wait((m) => m.type === 'you');
  t('Qui Ment ? : room créée par un join SANS code, vrai code, A est le MJ', !!youA && CODE_RE.test(youA.code) && youA.host === true, youA && youA.code);
  const roomCode = youA.code;
  A2.launched(drawId, roomCode);
  const go = await sB.until((s) => s.launch && s.launch.stage === 'join');
  t('go : B reçoit LE code de la room créée par A', !!go && go.launch.roomCode === roomCode);
  t('waiting : B et C attendus, A déjà dedans', JSON.stringify(go.launch.entered) === JSON.stringify([pA.id]) && go.launch.waiting.length === 2);

  // ═══ 6. B et C « naviguent » et rejoignent CE code, par le chemin normal
  B._drop(); C._drop();
  const B2 = hubClient(), sB2 = suivi(B2), C2 = hubClient(), sC2 = suivi(C2);
  await B2.join(code, pB); await C2.join(code, pC);
  t('B et C relisent le code dans LEUR état de session', sB2.last.launch.roomCode === roomCode && sC2.last.launch.roomCode === roomCode);
  const QB = qm(), QC = qm(); await QB.open; await QC.open;
  QB.send(joinQM(pB, roomCode));
  QC.send(joinQM(pC, roomCode));
  const youB = await QB.wait((m) => m.type === 'you'), youC = await QC.wait((m) => m.type === 'you');
  t('B et C : entrés dans LA room par le protocole normal (join + code), pas MJ',
    !!youB && !!youC && youB.code === roomCode && youC.code === roomCode && !youB.host && !youC.host);
  B2.entered(drawId, roomCode); C2.entered(drawId, roomCode);
  const enJeu = await sA2.until((s) => s.state === 'inGame');
  t('Hub : tout le groupe est entré → inGame, personne en attente', !!enJeu && enJeu.launch.waiting.length === 0 && enJeu.launch.entered.length === 3);
  const lob = await QA.wait((m) => m.type === 'lobby' && m.players.length === 3);
  t('Qui Ment ? : A, B, C dans LA MÊME room (vue du serveur du jeu)', !!lob && ['Alice', 'Bruno', 'Chloé'].every((n) => lob.players.some((p) => p.name === n)));

  // ═══ 7. une vraie partie (3 manches), jusqu'au classement
  const Q = [QA, QB, QC];
  let n0 = QA.msgs.length;
  QA.send({ action: 'start', rounds: 3 });
  const roles = await Promise.all(Q.map((P) => P.apres(0, (m) => m.type === 'role' && m.round === 1)));
  const intrus = roles.filter((r) => r && r.impostor);
  const mot = roles.find((r) => r && !r.impostor).word;
  t('A démarre : chacun reçoit SON rôle de la manche 1, un seul intrus, sans le mot',
    roles.every(Boolean) && intrus.length === 1 && intrus[0].word === null && roles.filter((r) => !r.impostor).every((r) => r.word === mot), `catégorie ${roles[0].cat}`);
  A2.started(drawId);
  await sleep(200);
  t('Hub : toujours inGame pendant la partie', sA2.last.state === 'inGame');

  // Un retardataire, avec le bon code : c'est qui-ment-server qui refuse.
  const QD = qm(); await QD.open;
  QD.send(joinQM({ name: 'Dora', avatar: { kind: 'emoji', emoji: '🎧' } }, roomCode));
  const refus = await QD.wait((m) => m.type === 'error');
  t('un retardataire est refusé (« partie déjà commencée »)', !!refus && /commencée/.test(refus.message), refus && refus.message);

  // Manche 1 pour de vrai : deux tours d'indices, puis chacun vote.
  for (let tour = 1; tour <= 2; tour++) {
    n0 = QA.msgs.length;
    Q.forEach((P, i) => P.send({ action: 'clue', text: `qx${tour}${i}` }));
    await QA.apres(n0, (m) => m.type === (tour === 1 ? 'clues' : 'vote'));
  }
  const ids = [youA.id, youB.id, youC.id];
  n0 = QA.msgs.length;
  Q.forEach((P, i) => P.send({ action: 'vote', target: ids[(i + 1) % 3] }));
  const imp = Q[roles.findIndex((r) => r.impostor)];
  const devine = await imp.apres(0, (m) => m.type === 'guess' || m.type === 'results');
  if (devine && devine.type === 'guess') imp.send({ action: 'guess', word: devine.words[0] });
  const res1 = await QA.apres(n0, (m) => m.type === 'results');
  t('manche 1 : indices, votes, résultats notés par le serveur (le mot révélé)', !!res1 && res1.word === mot && res1.round === 1);
  t('le mot n\'est JAMAIS arrivé chez l\'intrus avant les résultats',
    !imp.msgs.slice(0, imp.msgs.findIndex((m) => m.type === 'results' || m.type === 'guess')).some((m) => JSON.stringify(m).includes(JSON.stringify(mot))));
  // Manches 2 et 3 au bouton du MJ (skip), puis le classement.
  let fin = null;
  for (let k = 0; k < 20 && !fin; k++) {
    const last = [...QA.msgs].reverse().find((m) => JEU.includes(m.type));
    n0 = QA.msgs.length;
    QA.send(last.type === 'results' ? { action: 'next' } : { action: 'skip' });
    const m = await QA.apres(n0, (x) => JEU.includes(x.type));
    if (m && m.type === 'end') fin = m;
  }
  t('fin de partie : classement des trois joueurs', !!fin && fin.ranking.length === 3);

  A2.ended(drawId);
  const deb = await sB2.until((s) => s.state === 'debrief');
  t('ended : le Hub revient en debrief', !!deb && deb.launch.stage === 'ended' && deb.history.played[0] === 'quiment');

  // ═══ 8. hors Hub : le jeu reste autonome
  const QE = qm(); await QE.open;
  QE.send(joinQM({ name: 'Solo', avatar: { kind: 'emoji', emoji: '🎯' } }));
  const youE = await QE.wait((m) => m.type === 'you');
  t('hors Hub : une room SÉPARÉE', !!youE && youE.code !== roomCode, youE && youE.code);

  for (const P of [QA, QB, QC, QD, QE]) { try { P.ws.close(); } catch (_) {} }
  for (const X of [A2, B2, C2]) { try { X.leave(); } catch (_) {} }
  void sC;
  await sleep(200);
} catch (e) {
  t('EXCEPTION (protocole)', false, e && (e.stack || e.message));
}

// ═══════════════════════════════ 3. de vrais navigateurs
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json' };
function serve() {
  const s = createServer((req, res) => {
    const [p0, q] = req.url.split('?');
    if (p0 === '/games/' && !/(^|&)hub=/.test(q || '')) { res.writeHead(302, { Location: `/games/?hub=${encodeURIComponent(HUB)}` }); return res.end(); }
    if (p0 === '/games/quiment/' && !/(^|&)server=/.test(q || '')) { res.writeHead(302, { Location: `/games/quiment/?server=${encodeURIComponent(QM)}` }); return res.end(); }
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
  J.immobile = async (sel, ms = 5000) => {
    const pos = `(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return r.top + ',' + r.left + ',' + scrollY; })()`;
    let avant = await J.eval(pos), stables = 0;
    const fin = Date.now() + ms;
    while (Date.now() < fin && stables < 3) { await sleep(100); const p = await J.eval(pos); stables = p === avant ? stables + 1 : 0; avant = p; }
  };
  J.visible = (sel) => J.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && !e.hidden && !!e.offsetParent; })()`);
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
  J.jeu = () => J.trames.filter((m) => JEU.includes(m.type)).length;
  return J;
}

const surQM = `location.pathname === '/games/quiment/' && document.readyState === 'complete'`;
const texte = (J, id) => J.eval(`(document.getElementById(${JSON.stringify(id)}) || {}).textContent || ''`);
const vu = (id) => `(() => { const e = document.getElementById(${JSON.stringify(id)}); return !!e && !e.hidden && !!e.offsetParent; })()`;

// Une manche jouée POUR DE VRAI : deux tours d'indices tapés, un vote chacun,
// la dernière chance de l'intrus s'il est démasqué.
async function mancheReelle(tous, mj) {
  for (let tour = 1; tour <= 2; tour++) {
    for (const [i, J] of tous.entries()) {
      await J.until(`${vu('play')} && !document.getElementById('clue-input').disabled && /Tour ${tour}/.test(document.getElementById('turn-head').textContent)`, 10000, `tour ${tour} chez ${J.nom}`);
      await J.type('#clue-input', `qx${tour}${i}`);
      await J.click('#clue-send');
    }
  }
  for (const J of tous) {
    await J.until(`${vu('vote')} && document.querySelectorAll('#vote-grid button:not([disabled])').length > 0`, 10000, `vote chez ${J.nom}`);
    await J.click('#vote-grid button:nth-child(1)');
  }
  const fin = Date.now() + 10000;
  while (Date.now() < fin && !(await mj.eval(vu('results')))) {
    for (const J of tous) if (await J.eval(`${vu('guess')} && document.querySelectorAll('#word-grid button:not([disabled])').length > 0`)) await J.click('#word-grid button:nth-child(1)');
    await sleep(150);
  }
  await mj.until(vu('results'), 5000, 'résultats');
}
// Les manches suivantes au bouton du MJ : « passer », « dépouiller »,
// « ne pas attendre », « manche suivante »… jusqu'au classement.
async function auBoutonDuMJ(mj) {
  for (let k = 0; k < 30 && !(await mj.eval(vu('end'))); k++) {
    const bouton = ['skip-clue', 'skip-vote', 'skip-guess', 'next'];
    let id = null;
    for (const b of bouton) if (await mj.eval(vu(b))) { id = b; break; }
    if (!id) { await sleep(150); continue; }
    const n = mj.jeu();
    await mj.click('#' + id);
    const fin = Date.now() + 8000;
    while (Date.now() < fin && mj.jeu() === n) await sleep(50);
    await sleep(150);
  }
  await mj.until(vu('end'), 5000, 'classement');
}

try {
  srv = await serve();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'handoffqm-'));
  edge = spawn(EDGE, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${dir}`, '--no-first-run',
    '--disable-features=BackForwardCache', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank'], { stdio: 'ignore' });
  cdp = await cdpBrowser();
  const BASE = `http://127.0.0.1:${HTTP_PORT}`;
  const PAGE = `${BASE}/games/?hub=${encodeURIComponent(HUB)}`;
  console.log(`\nHandoff Hub → Qui Ment ? — navigateurs (${REDUCED ? 'mouvement RÉDUIT' : 'mouvement normal'})\n`);
  const A = await joueur('A'), B = await joueur('B'), C = await joueur('C'), D = await joueur('D');

  // ═══ 9. portfolio → Game Hub, quatre profils, une session
  await A.navigate(BASE + '/');
  await A.until(`document.readyState === 'complete' && !!document.getElementById('hub-link')`, 15000, 'home');
  await A.click('#hub-link');
  await A.until(`location.pathname === '/games/' && !!window.GameHub && !!window.HubHandoff`, 15000, '/games/');
  await A.type('#name-input', 'Alice');
  await A.click('#identity-done');
  await A.click('#hub-create');
  await A.until(`!document.getElementById('lobby').hidden`, 20000, 'salon de A');
  const code = await A.eval(`document.getElementById('hub-code').textContent.trim()`);
  for (const [J, nom, rang] of [[B, 'Bruno', 2], [C, 'Chloé', 5], [D, 'Dora', 7]]) {
    await J.goto(PAGE);
    await J.type('#name-input', nom);
    await J.click(`#avatar-row .avatar-pick:nth-child(${rang})`);
    await J.click('#identity-done');
    await J.type('#hub-code-input', code);
    await J.click('#hub-join');
  }
  for (const J of [A, B, C, D]) await J.until(`document.querySelectorAll('#hub-players .hub-card').length === 4`, 20000, `${J.nom} au salon`);
  t('navigateurs : A crée la session du Hub, B, C et D la rejoignent', true, code);
  const idD = await D.eval(`GameProfile.load().id`);

  for (const id of AUTRES) await B.click(`#hub-games [data-pref=veto][data-game=${id}]`);
  await A.until(`[...document.querySelectorAll('#hub-games .hub-game[data-eligible=true]')].map((x) => x.dataset.game).join() === 'quiment'`, 8000, 'seul Qui Ment ?');
  await A.click('#hub-draw-btn');
  for (const J of [A, B, C, D]) await J.until(`document.getElementById('hub-result').dataset.game === 'quiment' && !document.getElementById('hub-result').hidden`, 15000, `révélation ${J.nom}`);
  t('tirage : Qui Ment ?, révélé chez les quatre', true);
  t('bouton de l\'hôte : « Continuer — lancer Qui Ment ? »', /lancer Qui Ment/.test(await texte(A, 'hub-continue')), await texte(A, 'hub-continue'));

  // ═══ 10. A ouvre le jeu : la room se crée toute seule
  await A.click('#hub-continue');
  await A.until(`!document.getElementById('launch-go').hidden`, 8000, 'Ouvrir');
  await A.immobile('#launch-go');
  await A.click('#launch-go');
  await A.until(surQM, 15000, 'A sur Qui Ment ?');
  await A.until(`${vu('lobby')} && /^[A-Z]{4}$/.test(document.getElementById('room-code').textContent.trim())`, 20000, 'room créée');
  const roomA = (await texte(A, 'room-code')).trim();
  t('host : la page de Qui Ment ? crée la room toute seule (join sans code), A est MJ', CODE_RE.test(roomA)
    && A.trames.some((m) => m.type === 'you' && m.code === roomA && m.host === true), roomA);
  t('le pseudo du profil est repris (« Alice »), pas saisi', await A.eval(`document.getElementById('name-input').value === 'Alice'`)
    && A.trames.some((m) => m.type === 'lobby' && m.players.some((p) => p.name === 'Alice')));
  const lancee = await A.attendsTrame((m) => m.session && m.session.launch && m.session.launch.roomCode === roomA, 8000, 'code au Hub');
  t('le code arrive au Hub (stage join) — celui de LA room de Qui Ment ?', lancee.session.launch.stage === 'join');
  const banA = await A.eval(`(document.querySelector('.g-hub-banner') || {}).textContent || ''`);
  t('bandeau Game Hub sur la page de Qui Ment ?', new RegExp(code).test(banA) && /attendus/.test(banA), banA);
  const att0 = await A.eval(`({ off: document.getElementById('start').disabled, txt: document.getElementById('start').textContent })`);
  t('seul dans la room : « Lancer » désactivé (et les absents nommés)', att0.off && /Bruno/.test(att0.txt), att0.txt);
  await A.shot('1-qm-hote-attend');

  // ═══ 11. B et C rejoignent, par le bouton du Hub
  for (const J of [B, C]) {
    await J.until(`!document.getElementById('launch-go').hidden && /Rejoindre/.test(document.getElementById('launch-go').textContent)`, 10000, `Rejoindre chez ${J.nom}`);
    await J.immobile('#launch-go');
    await J.click('#launch-go');
    await J.until(surQM, 15000, `${J.nom} sur Qui Ment ?`);
    await J.until(`${vu('lobby')} && document.getElementById('room-code').textContent.trim() === ${JSON.stringify(roomA)}`, 20000, `${J.nom} dans la room`);
  }
  t('guests : auto-jointure de LA room, sans saisir de code', true);
  await A.until(`document.querySelectorAll('#players .g-player').length === 3`, 8000, '3 joueurs chez A');
  const entre = await A.attendsTrame((m) => m.session && m.session.launch && m.session.launch.entered.length === 3, 8000, 'entered');
  t('Hub : B et C déclarés `entered`, Dora toujours attendue', entre.session.launch.waiting.length === 1 && entre.session.launch.waiting[0] === idD);
  const att = await A.eval(`({ off: document.getElementById('start').disabled, txt: document.getElementById('start').textContent, sans: !document.getElementById('start-anyway').hidden })`);
  t('« Lancer » attend Dora (désactivé, la nomme) + « Lancer sans attendre »', att.off && /Dora/.test(att.txt) && !/Bruno/.test(att.txt) && att.sans, att.txt);

  // ═══ 12. A lance SANS attendre Dora
  await A.click('#start-anyway');
  for (const J of [A, B, C]) await J.until(`${vu('play')} && document.getElementById('round-num').textContent === '1'`, 10000, `manche 1 chez ${J.nom}`);
  t('démarrage réel : chacun voit SON rôle de la manche 1', true);
  const roles = [A, B, C].map((J) => J.trames.find((m) => m.type === 'role' && m.round === 1));
  const intrus = roles.filter((r) => r.impostor);
  t('un seul intrus, sans le mot ; les autres ont le même mot', intrus.length === 1 && intrus[0].word === null && new Set(roles.filter((r) => !r.impostor).map((r) => r.word)).size === 1);
  const joue = await B.attendsTrame((m) => m.session && m.session.state === 'inGame' && m.session.launch.stage === 'playing', 8000, 'playing');
  t('started() : le Hub passe à inGame/playing, Dora est « manquée »', JSON.stringify(joue.session.launch.missed) === JSON.stringify([idD]));
  await D.until(`/commencé sans toi/.test(document.getElementById('launch-text').textContent) && document.getElementById('launch-go').hidden`, 8000, 'Dora manquée');
  t('Dora, au Hub : « La partie a commencé sans toi », plus de bouton Rejoindre', true);

  // Dora arrive quand même par un billet : qui-ment-server la refuse.
  const sD = D.hub();
  await D.eval(`HubHandoff.write(${JSON.stringify({ hub: HUB, session: sD.code, playerId: idD, drawId: sD.launch.drawId, gameId: 'quiment', role: 'guest' })})`);
  await D.navigate(`${BASE}/games/quiment/`);
  await D.until(`${surQM} && /commencée/.test(document.getElementById('error').textContent)`, 15000, 'refus de Dora');
  t('retardataire : refusée par qui-ment-server (« partie déjà commencée »), reste à l\'accueil',
    !(await D.eval(vu('lobby'))) && !(await D.eval(vu('play'))), await texte(D, 'error'));

  // ═══ 13. la partie : une manche pour de vrai, le reste au bouton du MJ
  await mancheReelle([A, B, C], A);
  const res = A.trames.find((m) => m.type === 'results');
  t('manche 1 : indices tapés, votes cliqués, résultats du serveur', !!res && res.round === 1 && Object.keys(res.counts).length > 0);
  const imp = [A, B, C][roles.findIndex((r) => r.impostor)];
  // Jusqu'au premier `results`, ou jusqu'au `guess` : démasqué, l'intrus reçoit
  // la liste des mots de la catégorie (sa dernière chance), et c'est voulu.
  const mot = res.word, avant = imp.trames.slice(0, imp.trames.findIndex((m) => m.type === 'results' || m.type === 'guess'));
  t('le mot n\'est jamais arrivé chez l\'intrus avant les résultats', !avant.some((m) => JSON.stringify(m).includes(JSON.stringify(mot))), `intrus : ${imp.nom}`);
  await auBoutonDuMJ(A);
  for (const J of [A, B, C]) await J.until(`${vu('end')} && ${vu('to-hub')}`, 10000, `classement chez ${J.nom}`);
  t('classement chez les trois, avec « Retour au Game Hub »', true);
  t('classement : trois lignes', await B.eval(`document.querySelectorAll('#ranking .rank-row').length === 3`));
  await B.shot('2-qm-classement');
  const deb = await B.attendsTrame((m) => m.session && m.session.state === 'debrief', 10000, 'debrief');
  t('ended() : le Hub revient en debrief (stage ended)', deb.session.launch.stage === 'ended' && deb.session.history.played[0] === 'quiment');
  t('#to-hub n\'a pas la classe .back (réservée au retour portfolio)', await A.eval(`!document.getElementById('to-hub').classList.contains('back') && document.querySelectorAll('a.back').length === 1`));

  // ═══ 14. retour au Hub
  for (const J of [B, C, A]) {
    await J.click('#to-hub');
    await J.until(`location.pathname === '/games/' && !document.getElementById('lobby').hidden`, 15000, `retour Hub ${J.nom}`);
  }
  t('#to-hub : B revient au Hub, même session, « partie terminée »', /terminée/.test(await texte(B, 'hub-ready')) && B.hub().code === code, await texte(B, 'hub-ready'));
  await D.goto(PAGE);
  await D.until(`!document.getElementById('lobby').hidden`, 15000, 'Dora revient au salon du Hub');

  // ═══ 15. SECOND lancement, à quatre : « Lancer » s'ouvre de lui-même
  await A.until(`!document.getElementById('hub-draw-btn').hidden && !document.getElementById('hub-draw-btn').disabled`, 8000, 'tirage possible');
  await A.click('#hub-draw-btn');
  for (const J of [A, B, C, D]) await J.until(`document.getElementById('hub-result').dataset.game === 'quiment' && !document.getElementById('hub-result').hidden`, 15000, `second tirage ${J.nom}`);
  await A.until(`!document.getElementById('hub-continue').hidden`, 8000, 'Continuer (2)');
  await A.click('#hub-continue');
  await A.until(`!document.getElementById('launch-go').hidden`, 8000, 'Ouvrir (2)');
  await A.immobile('#launch-go');
  await A.click('#launch-go');
  await A.until(`${surQM} && ${vu('lobby')} && /^[A-Z]{4}$/.test(document.getElementById('room-code').textContent.trim())`, 20000, 'room 2');
  const room2 = (await texte(A, 'room-code')).trim();
  t('second handoff : une NOUVELLE room', CODE_RE.test(room2) && room2 !== roomA, room2);
  for (const J of [B, C, D]) {
    await J.until(`!document.getElementById('launch-go').hidden && /Rejoindre/.test(document.getElementById('launch-go').textContent)`, 10000, `Rejoindre (2) chez ${J.nom}`);
    await J.immobile('#launch-go');
    await J.click('#launch-go');
    await J.until(`${surQM} && ${vu('lobby')} && document.getElementById('room-code').textContent.trim() === ${JSON.stringify(room2)}`, 20000, `${J.nom} dans la room 2`);
  }
  await A.until(`document.querySelectorAll('#players .g-player').length === 4 && !document.getElementById('start').disabled`, 10000, '« Lancer » actif à 4');
  const att2 = await A.eval(`({ txt: document.getElementById('start').textContent, sans: document.getElementById('start-anyway').hidden })`);
  t('tout le monde est entré : « Lancer la partie » actif, pas de « sans attendre »', att2.txt === 'Lancer la partie' && att2.sans, JSON.stringify(att2));
  const in2 = await A.attendsTrame((m) => m.session && m.session.state === 'inGame' && m.session.launch.roomCode === room2, 8000, 'inGame 2');
  t('Hub : inGame, les quatre entrés, personne de manqué', in2.session.launch.entered.length === 4 && in2.session.launch.missed.length === 0);
  await A.click('#start');
  for (const J of [A, B, C, D]) await J.until(`${vu('play')} && document.getElementById('round-num').textContent === '1'`, 10000, `manche 1 (2) chez ${J.nom}`);
  t('second handoff : la partie démarre chez les quatre', true);
  await auBoutonDuMJ(A);
  for (const J of [A, B, C, D]) await J.until(`${vu('end')} && ${vu('to-hub')}`, 10000, `classement (2) chez ${J.nom}`);
  const deb2 = await D.attendsTrame((m) => m.session && m.session.state === 'debrief' && m.session.history.played.length === 2, 10000, 'debrief 2');
  t('second handoff : classement, retour au Hub proposé, debrief', deb2.session.launch.stage === 'ended', JSON.stringify(deb2.session.history.played));
  const errs = [A, B, C, D].flatMap((J) => J.erreurs.map((e) => `[${J.nom}] ${e}`));
  t('aucune erreur JS (Hub)', errs.length === 0, errs.slice(0, 3).join(' | '));

  // ═══ 16. HORS Hub : trois joueurs, aucun billet — la page d'avant
  const E = await joueur('E'), F = await joueur('F'), G = await joueur('G');
  const DIRECT = `${BASE}/games/quiment/?server=${encodeURIComponent(QM)}`;
  for (const [J, nom] of [[E, 'Émile'], [F, 'Fanny'], [G, 'Gus']]) { await J.goto(DIRECT); await J.type('#name-input', nom); }
  await E.click('#host');
  await E.until(`${vu('lobby')} && /^[A-Z]{4}$/.test(document.getElementById('room-code').textContent.trim())`, 10000, 'room de E');
  const roomE = (await texte(E, 'room-code')).trim();
  const deux = await E.eval(`({ off: document.getElementById('start').disabled, txt: document.getElementById('start').textContent })`);
  t('hors Hub, seul : « Lancer » désactivé par la règle du jeu (3 joueurs), rien d\'autre', deux.off && deux.txt === 'Lancer la partie', JSON.stringify(deux));
  for (const J of [F, G]) { await J.type('#code-input', roomE); await J.click('#join'); }
  await E.until(`document.querySelectorAll('#players .g-player').length === 3 && !document.getElementById('start').disabled`, 8000, '3 joueurs hors Hub');
  const hors = await E.eval(`({ ban: !!document.querySelector('.g-hub-banner'), sans: document.getElementById('start-anyway').hidden, txt: document.getElementById('start').textContent })`);
  t('hors Hub : pas de bandeau, « Lancer » actif à 3, pas de « sans attendre »', !hors.ban && hors.sans && hors.txt === 'Lancer la partie', JSON.stringify(hors));
  t('hors Hub : aucune trame du Hub', ![E, F, G].some((J) => J.trames.some((m) => m.session)));
  t('hors Hub : une room distincte de celles du Hub', roomE !== roomA && roomE !== room2, roomE);
  await E.click('#start');
  await mancheReelle([E, F, G], E);
  await auBoutonDuMJ(E);
  for (const J of [E, F, G]) await J.until(vu('end'), 10000, `classement hors Hub chez ${J.nom}`);
  t('hors Hub : partie jouée jusqu\'au classement', true);
  t('hors Hub : pas de « Retour au Game Hub »', !(await E.eval(vu('to-hub'))) && !(await F.eval(vu('to-hub'))));
  const errs2 = [E, F, G].flatMap((J) => J.erreurs.map((e) => `[${J.nom}] ${e}`));
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
