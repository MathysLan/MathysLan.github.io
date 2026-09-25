// Handoff Hub → Morpion, de bout en bout : le vrai game-hub-server et le VRAI
// morpion-server, lancés en local depuis les dépôts voisins. Aucun mock : le
// code de room est celui que morpion-server fabrique.
//
//   node tests/handoff-morpion.mjs
//   node tests/handoff-morpion.mjs --reduced       mouvement réduit
//   node tests/handoff-morpion.mjs --shots <dir>   une capture par étape
//
// Trois étages, du plus sec au plus réel :
//
//   1. le billet, sans réseau ni navigateur ;
//   2. le PROTOCOLE, deux joueurs en Node : A crée la session du Hub, B la
//      rejoint → seul le Morpion est éligible → A tire → A crée la room
//      (`{ action: 'join' }`, SANS code : le protocole normal du jeu) → A
//      déclare le code → B le relit dans SON état de session et rejoint CE
//      code → la room passe à `playing` → inGame → une partie jusqu'à la
//      victoire → un troisième est refusé (« room pleine ») → ended ;
//   3. de VRAIS NAVIGATEURS (Edge par le protocole DevTools, contextes isolés) :
//      portfolio → /games/ → tirage → la page du Morpion crée la room toute
//      seule → B rejoint par le bouton du Hub → partie jouée à la souris →
//      « Retour au Game Hub ». Puis un SECOND lancement dans la même session,
//      où B quitte en pleine partie (A est prévenu, le Hub revient en debrief),
//      un TROISIÈME où la connexion de l'hôte tombe pendant l'attente (le
//      lancement est annulé pour tout le groupe), et enfin deux joueurs HORS
//      Hub : la page se joue exactement comme avant.
//
// ⚠️ LE MORPION NE REÇOIT AUCUNE IDENTITÉ. morpion-server ne lit que `code`.
// Chaque trame envoyée par une page à morpion-server est relue (protocole
// DevTools, `webSocketFrameSent`) : ni `name`, ni `avatar`, ni rien du profil
// — seulement `action`, `code`, `index` (et `n` / `remplace` de la présence).
// Le profil ne sert qu'à se présenter au HUB, avec le même player.id.
//
// ⚠️ morpion-server a besoin de `ws`. Sur un poste où son `npm install` n'a
// pas été fait, NODE_PATH peut pointer sur un autre node_modules qui l'a
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
// L'alphabet des codes de room du Morpion (src/server.js : sans I, L, O, 0, 1).
const CODE_RE = /^[A-HJKMNP-Z2-9]{4}$/;
const require = createRequire(import.meta.url);
const H = require(path.join(ROOT, 'games/shared/game-hub.js'));
const HH = require(path.join(ROOT, 'games/shared/hub-handoff.js'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = () => Math.floor(Math.random() * 300);
const HUB_PORT = 8300 + R(), MORP_PORT = 8900 + R(), HEALTH_PORT = 6100 + R(), HTTP_PORT = 8700 + R(), CDP_PORT = 9700 + R();
// Les seules clés qu'une page a le droit d'envoyer à morpion-server.
const CLES_MORPION = ['action', 'code', 'index', 'n', 'remplace'];
// Tout ce qui n'est pas le Morpion est écarté par B : il ne reste que lui.
const AUTRES = ['imitation', 'demicercle', 'ban', 'precision', 'passeur', 'quiment'];

let out = [], ko = 0;
const t = (nom, ok, detail = '') => {
  out.push(`${ok ? 'OK  ' : 'KO  '} ${nom}${detail ? ' — ' + detail : ''}`);
  if (!ok) ko++;
  console.log(out[out.length - 1]);
};

// ═══════════════════════════════ 1. le billet, sans réseau ni navigateur
console.log('Handoff Morpion — le billet\n');
const BON = { v: 1, hub: 'ws://127.0.0.1:8100', session: 'AB2DE', playerId: 'p_alice', drawId: 'd_1', gameId: 'morpion', role: 'host', at: Date.now() };
t('billet valable pour morpion', !!HH.readTicket(BON, 'morpion'));
t('billet d\'un AUTRE jeu : refusé par la page du Morpion', !HH.readTicket({ ...BON, gameId: 'passeur' }, 'morpion'));
t('billet périmé (plus de 3 h) : refusé', !HH.readTicket({ ...BON, at: Date.now() - HH.MAX_AGE_MS - 1000 }, 'morpion'));
t('les deux rôles sont acceptés', !!HH.readTicket({ ...BON, role: 'guest' }, 'morpion'));
const MAN = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/games.manifest.json'), 'utf8')).games.find((g) => g.id === 'morpion');
t('manifest : Morpion lançable par le Hub, le reste inchangé (anon, duel, ni content ni replay)',
  MAN.handoff === true && MAN.join === 'anon' && MAN.players.min === 2 && MAN.players.max === 2 && MAN.content === false && MAN.replay === false, JSON.stringify(MAN));

// ═══════════════════════════════ 2. les vrais serveurs
const procs = [];
const lance = (cwd, file, port, env = {}) => {
  const p = spawn(process.execPath, [file], { cwd, env: { ...process.env, PORT: String(port), HUB_QUIET: '1', PRESENCE_QUIET: '1', ...env }, stdio: 'ignore' });
  procs.push(p); return p;
};
async function attends(url) { for (let i = 0; i < 100; i++) { try { const r = await fetch(url); if (r.ok) return; } catch (_) {} await sleep(100); } throw new Error('injoignable : ' + url); }

const sante = await fakeHealth(HEALTH_PORT);
const MANIFEST = localManifest(ROOT, HEALTH_PORT, { morpion: `http://127.0.0.1:${MORP_PORT}/` });
lance(path.join(ROOT, '..', 'morpion-server'), 'src/server.js', MORP_PORT);
lance(path.join(ROOT, '..', 'game-hub-server'), 'src/server.js', HUB_PORT, { MANIFEST_FILE: MANIFEST });
const HUB = `ws://127.0.0.1:${HUB_PORT}`, MORP = `ws://127.0.0.1:${MORP_PORT}`;

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

// Le client du jeu : un WebSocket vers morpion-server, rien d'autre. Les pings
// de présence sont ignorés (on n'y adhère pas : c'est volontaire côté serveur).
function morp() {
  const ws = new WebSocket(MORP);
  const c = { ws, msgs: [] };
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.type !== 'presence') c.msgs.push(m); };
  c.open = new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('morpion injoignable')); });
  c.send = (o) => ws.send(JSON.stringify(o));
  c.wait = async (pred, ms = 8000) => { const fin = Date.now() + ms; while (Date.now() < fin) { const m = c.msgs.find(pred); if (m) return m; await sleep(20); } return null; };
  c.last = (type) => [...c.msgs].reverse().find((m) => m.type === type);
  return c;
}

const pA = { id: 'p_alicemorp', name: 'Alice', avatar: { kind: 'emoji', emoji: '🦊' } };
const pB = { id: 'p_brunomorp', name: 'Bruno', avatar: { kind: 'emoji', emoji: '🐼' } };

try {
  await attends(`http://127.0.0.1:${MORP_PORT}/`);
  await attends(`http://127.0.0.1:${HUB_PORT}/health`);
  console.log(`\nHandoff Hub → Morpion — protocole réel (Hub :${HUB_PORT}, Morpion :${MORP_PORT})\n`);

  // ═══ 3. le groupe, et un tirage qui ne peut donner que le Morpion
  const A = hubClient(), B = hubClient();
  const sA = suivi(A), sB = suivi(B);
  const code = (await A.create(pA)).session.code;
  await B.join(code, pB);
  await sA.until((s) => s.pool && s.pool.catalog === 'ready' && s.players.length === 2);
  B.setPrefs([], AUTRES);
  const seul = await sA.until((s) => JSON.stringify(s.pool.eligible) === '["morpion"]');
  t('le groupe (2) : seul le Morpion est éligible (vetos de B)', !!seul, JSON.stringify(sA.last.pool.eligible));
  A.draw();
  const tire = await sA.until((s) => s.draw && s.draw.status === 'drawn');
  t('tirage serveur : Morpion', !!tire && tire.draw.gameId === 'morpion', tire && tire.draw.gameId);
  const drawId = tire.draw.id;

  // ═══ 4. continuer → lancement, rôles, URL
  A.confirm();
  const l0 = await sB.until((s) => s.state === 'launching');
  t('continuer → launching (stage create), lié au tirage', !!l0 && l0.launch.stage === 'create' && l0.launch.drawId === drawId);
  t('rôles : A hôte du lancement', l0.launch.hostId === pA.id);
  t('le Hub donne l\'URL du jeu (manifest)', l0.launch.url === 'games/morpion/', l0.launch.url);

  // ═══ 5. A « navigue » : la page du jeu rouvre le Hub avec le même player.id
  A._drop();
  await sB.until((s) => s.players.find((p) => p.id === pA.id).connected === false, 4000);
  const A2 = hubClient(), sA2 = suivi(A2);
  await A2.join(code, pA);
  t('navigation de A : même player.id, toujours hôte du lancement', sA2.last.launch.hostId === pA.id && sA2.last.players.length === 2);

  // ═══ 6. A crée la room par le protocole NORMAL du Morpion : join SANS code
  const MA = morp(); await MA.open;
  MA.send({ action: 'join' });
  const stA = await MA.wait((m) => m.type === 'state');
  t('Morpion : room créée par `{ action: \'join\' }`, vrai code, A joue X, en attente',
    !!stA && CODE_RE.test(stA.code) && stA.you === 'X' && stA.status === 'waiting', stA && stA.code);
  t('Morpion : l\'état ne contient aucune identité (le serveur n\'en a pas)',
    !!stA && !Object.keys(stA).some((k) => /name|avatar|player/i.test(k)), stA && Object.keys(stA).join(','));
  const roomCode = stA.code;

  A2.launched(drawId, roomCode);
  const go = await sB.until((s) => s.launch && s.launch.stage === 'join');
  t('go : B reçoit LE code de la room créée par A', !!go && go.launch.roomCode === roomCode, go && go.launch.roomCode);
  t('waiting : B attendu, A déjà dedans',
    JSON.stringify(go.launch.entered) === JSON.stringify([pA.id]) && JSON.stringify(go.launch.waiting) === JSON.stringify([pB.id]));

  // ═══ 7. B « navigue » et rejoint CE code, par le chemin normal
  B._drop();
  const B2 = hubClient(), sB2 = suivi(B2);
  await B2.join(code, pB);
  const vuB = sB2.last.launch.roomCode;
  t('B relit le code dans SON état de session (il ne le saisit pas)', vuB === roomCode, vuB);
  const MB = morp(); await MB.open;
  MB.send({ action: 'join', code: vuB });
  const stB = await MB.wait((m) => m.type === 'state');
  t('B : entré dans LA room par `{ action: \'join\', code }`, joue O, partie lancée',
    !!stB && stB.code === roomCode && stB.you === 'O' && stB.status === 'playing');
  const stA2 = await MA.wait((m) => m.type === 'state' && m.status === 'playing');
  t('A voit la même room passer à `playing` (vue du serveur du jeu)', !!stA2 && stA2.code === roomCode && stA2.turn === 'X');
  B2.entered(drawId, roomCode);
  A2.started(drawId);
  const enJeu = await sA2.until((s) => s.state === 'inGame');
  t('Hub : les deux sont entrés → inGame, personne en attente ni manqué',
    !!enJeu && enJeu.launch.waiting.length === 0 && enJeu.launch.entered.length === 2 && enJeu.launch.missed.length === 0);

  // Un troisième, avec le bon code : c'est morpion-server qui refuse.
  const MC = morp(); await MC.open;
  MC.send({ action: 'join', code: roomCode });
  const plein = await MC.wait((m) => m.type === 'error');
  t('un troisième est refusé par morpion-server (« room pleine »)', !!plein && /pleine/.test(plein.message), plein && plein.message);

  // ═══ 8. une vraie partie : X aligne la première ligne
  for (const [P, i] of [[MA, 0], [MB, 3], [MA, 1], [MB, 4], [MA, 2]]) {
    const n = P.msgs.length;
    P.send({ action: 'play', index: i });
    await P.wait((m) => P.msgs.indexOf(m) >= n && m.type === 'state');
  }
  const finB = await MB.wait((m) => m.type === 'state' && m.status === 'over');
  t('fin de partie : X gagne sur la première ligne, vu par O', !!finB && finB.winner === 'X' && JSON.stringify(finB.line) === '[0,1,2]');

  A2.ended(drawId);
  const deb = await sB2.until((s) => s.state === 'debrief');
  t('ended : le Hub revient en debrief', !!deb && deb.launch.stage === 'ended' && deb.history.played[0] === 'morpion');

  // ═══ 9. hors Hub : le jeu reste autonome
  const MD = morp(), ME = morp(); await MD.open; await ME.open;
  MD.send({ action: 'join' });
  const stD = await MD.wait((m) => m.type === 'state');
  ME.send({ action: 'join', code: stD.code });
  const stE = await ME.wait((m) => m.type === 'state');
  t('hors Hub : une room SÉPARÉE, créée et rejointe à la main', !!stE && stE.code === stD.code && stE.status === 'playing' && stD.code !== roomCode, stD.code);

  for (const P of [MA, MB, MC, MD, ME]) { try { P.ws.close(); } catch (_) {} }
  for (const X of [A2, B2]) { try { X.leave(); } catch (_) {} }
  await sleep(200);
} catch (e) {
  t('EXCEPTION (protocole)', false, e && (e.stack || e.message));
}

// ═══════════════════════════════ 3. de vrais navigateurs
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json' };
// Le site tel quel, avec DEUX redirections propres au test : les liens réels
// (`games/` depuis la home, `games/morpion/` depuis le Hub) n'ont pas de
// `?hub=` / `?server=` — ils iraient en production.
function serve() {
  const s = createServer((req, res) => {
    const [p0, q] = req.url.split('?');
    if (p0 === '/games/' && !/(^|&)hub=/.test(q || '')) { res.writeHead(302, { Location: `/games/?hub=${encodeURIComponent(HUB)}` }); return res.end(); }
    if (p0 === '/games/morpion/' && !/(^|&)server=/.test(q || '')) { res.writeHead(302, { Location: `/games/morpion/?server=${encodeURIComponent(MORP)}` }); return res.end(); }
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
  // trames : reçues (Hub + Morpion) ; envoyes : ENVOYÉES, avec l'URL du socket.
  const J = { nom, erreurs: [], trames: [], envoyes: [], sockets: new Map() };
  joueurs.push(J);
  cdp.on(sessionId, (m) => {
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      J.erreurs.push((d.exception?.description || d.text || '').split('\n')[0]);
    }
    if (m.method === 'Network.webSocketCreated') J.sockets.set(m.params.requestId, m.params.url);
    if (m.method === 'Network.webSocketFrameReceived') {
      try { J.trames.push(JSON.parse(m.params.response.payloadData)); } catch (_) {}
    }
    if (m.method === 'Network.webSocketFrameSent') {
      let data = null;
      try { data = JSON.parse(m.params.response.payloadData); } catch (_) { data = m.params.response.payloadData; }
      J.envoyes.push({ url: J.sockets.get(m.params.requestId) || '?', data });
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
  // Tout ce que CE navigateur a envoyé à morpion-server.
  J.versMorpion = () => J.envoyes.filter((e) => e.url.startsWith(MORP)).map((e) => e.data);
  return J;
}

const surMorpion = `location.pathname === '/games/morpion/' && document.readyState === 'complete'`;
const texte = (J, id) => J.eval(`(document.getElementById(${JSON.stringify(id)}) || {}).textContent || ''`);
const cle = (m) => Object.keys(m).find((k) => !CLES_MORPION.includes(k));

// Une trame envoyée au Morpion ne doit porter que les clés du protocole.
function sansIdentite(J) {
  const env = J.versMorpion();
  const fautif = env.find((m) => typeof m !== 'object' || !m || cle(m) !== undefined);
  return { ok: env.length > 0 && !fautif, n: env.length, fautif: fautif ? JSON.stringify(fautif) : '' };
}

// Un coup, à la souris, quand c'est au tour de ce joueur.
async function coup(J, i) {
  await J.until(`state && state.status === 'playing' && state.turn === state.you`, 8000, `tour de ${J.nom}`);
  await J.click(`#board .cell:nth-child(${i + 1})`);
  await J.until(`state && state.board[${i}] !== null`, 8000, `case ${i} jouée`);
}

// Du lancement (A clique « Continuer ») jusqu'aux deux joueurs dans LA room.
async function lancement(A, B, n) {
  await A.until(`!document.getElementById('hub-continue').hidden`, 10000, 'Continuer');
  await A.click('#hub-continue');
  await A.until(`!document.getElementById('launch-go').hidden`, 8000, 'Ouvrir');
  await A.immobile('#launch-go');
  await A.click('#launch-go');
  await A.until(surMorpion, 15000, 'A sur le Morpion');
  await A.until(`!document.getElementById('game').hidden && state && state.status === 'waiting'`, 20000, 'room créée');
  const room = (await texte(A, 'room-code')).trim();
  const l = await A.attendsTrame((m) => m.session && m.session.launch && m.session.launch.roomCode === room, 8000, 'code au Hub');
  return { room, l };
}
async function rejoindre(B, room) {
  await B.until(`!document.getElementById('launch-go').hidden && /Rejoindre/.test(document.getElementById('launch-go').textContent)`, 10000, `Rejoindre chez ${B.nom}`);
  await B.immobile('#launch-go');
  await B.click('#launch-go');
  await B.until(surMorpion, 15000, `${B.nom} sur le Morpion`);
  await B.until(`!document.getElementById('game').hidden && state && state.code === ${JSON.stringify(room)}`, 20000, `${B.nom} dans la room`);
}

try {
  srv = await serve();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'handoffmorp-'));
  edge = spawn(EDGE, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${dir}`, '--no-first-run',
    '--disable-features=BackForwardCache', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank'], { stdio: 'ignore' });
  cdp = await cdpBrowser();
  const BASE = `http://127.0.0.1:${HTTP_PORT}`;
  const PAGE = `${BASE}/games/?hub=${encodeURIComponent(HUB)}`;
  console.log(`\nHandoff Hub → Morpion — navigateurs (${REDUCED ? 'mouvement RÉDUIT' : 'mouvement normal'})\n`);
  const A = await joueur('A'), B = await joueur('B');

  // ═══ 10. portfolio → Game Hub, deux profils, une session
  await A.navigate(BASE + '/');
  await A.until(`document.readyState === 'complete' && !!document.getElementById('hub-link')`, 15000, 'home');
  await A.click('#hub-link');
  await A.until(`location.pathname === '/games/' && !!window.GameHub && !!window.HubHandoff`, 15000, '/games/');
  await A.type('#name-input', 'Alice');
  await A.click('#identity-done');
  await A.click('#hub-create');
  await A.until(`!document.getElementById('lobby').hidden`, 20000, 'salon de A');
  const code = await A.eval(`document.getElementById('hub-code').textContent.trim()`);
  await B.goto(PAGE);
  await B.type('#name-input', 'Bruno');
  await B.click('#avatar-row .avatar-pick:nth-child(2)');
  await B.click('#identity-done');
  await B.type('#hub-code-input', code);
  await B.click('#hub-join');
  for (const J of [A, B]) await J.until(`document.querySelectorAll('#hub-players .hub-card').length === 2`, 20000, `${J.nom} au salon`);
  t('navigateurs : A crée la session du Hub, B la rejoint', true, code);

  for (const id of AUTRES) await B.click(`#hub-games [data-pref=veto][data-game=${id}]`);
  await A.until(`[...document.querySelectorAll('#hub-games .hub-game[data-eligible=true]')].map((x) => x.dataset.game).join() === 'morpion'`, 8000, 'seul le Morpion');
  await A.click('#hub-draw-btn');
  for (const J of [A, B]) await J.until(`document.getElementById('hub-result').dataset.game === 'morpion' && !document.getElementById('hub-result').hidden`, 15000, `révélation ${J.nom}`);
  t('tirage : Morpion, révélé chez les deux', true);
  t('bouton de l\'hôte : « Continuer — lancer Morpion »', /lancer Morpion/.test(await texte(A, 'hub-continue')), await texte(A, 'hub-continue'));

  // ═══ 11. A ouvre le jeu : la room se crée toute seule
  const { room: room1, l: l1 } = await lancement(A, B, 1);
  t('host : la page du Morpion crée la room toute seule, A joue X, en attente', CODE_RE.test(room1)
    && A.trames.some((m) => m.type === 'state' && m.code === room1 && m.you === 'X' && m.status === 'waiting'), room1);
  t('le code arrive au Hub (stage join) — celui de LA room du Morpion', l1.session.launch.stage === 'join');
  const banA = await A.eval(`(document.querySelector('.g-hub-banner') || {}).textContent || ''`);
  t('bandeau Game Hub sur la page du Morpion (session, attendus)', new RegExp(code).test(banA) && /attendus/.test(banA) && /Bruno/.test(banA), banA);
  t('host : aucune identité n\'a été ajoutée à la page (ni champ, ni avatars)',
    await A.eval(`!document.getElementById('name-input') && !document.getElementById('avatar-row') && !document.querySelector('.gp-photo')`));
  await A.shot('1-morpion-hote-attend');

  // ═══ 12. B rejoint, par le bouton du Hub
  await rejoindre(B, room1);
  t('guest : auto-jointure de LA room, sans saisir de code, B joue O', (await B.eval(`state.you`)) === 'O' && (await texte(B, 'room-code')).trim() === room1);
  const joue = await B.attendsTrame((m) => m.session && m.session.state === 'inGame' && m.session.launch.stage === 'playing', 8000, 'playing');
  t('Hub : inGame / playing, les deux entrés, personne de manqué',
    joue.session.launch.entered.length === 2 && joue.session.launch.missed.length === 0 && joue.session.launch.waiting.length === 0);
  await A.until(`state.status === 'playing'`, 8000, 'partie chez A');
  const banB = await B.eval(`(document.querySelector('.g-hub-banner') || {}).textContent || ''`);
  t('bandeau chez B : dans la partie, Alice et Bruno', /dans la partie/.test(banB) && /Alice/.test(banB) && /Bruno/.test(banB), banB);

  // ═══ 13. la partie, à la souris : X aligne la première ligne
  for (const [J, i] of [[A, 0], [B, 3], [A, 1], [B, 4], [A, 2]]) await coup(J, i);
  for (const J of [A, B]) await J.until(`state.status === 'over' && !document.getElementById('to-hub').hidden`, 8000, `fin chez ${J.nom}`);
  t('fin : « gagné » chez A, « perdu » chez B', /gagné/.test(await texte(A, 'status')) && /perdu/.test(await texte(B, 'status')));
  t('fin : « Retour au Game Hub » proposé aux deux', (await A.visible('#to-hub')) && (await B.visible('#to-hub')));
  await B.shot('2-morpion-fin');
  const deb = await B.attendsTrame((m) => m.session && m.session.state === 'debrief', 10000, 'debrief');
  t('ended() : le Hub revient en debrief (stage ended)', deb.session.launch.stage === 'ended' && deb.session.history.played[0] === 'morpion');
  for (const J of [A, B]) {
    const s = sansIdentite(J);
    t(`${J.nom} : ${s.n} trames envoyées à morpion-server, AUCUNE ne porte name/avatar/profil`, s.ok, s.fautif);
  }
  t('A n\'a envoyé que `{ action: \'join\' }` pour créer, B `{ action: \'join\', code }` pour rejoindre',
    A.versMorpion().some((m) => m.action === 'join' && Object.keys(m).join() === 'action')
    && B.versMorpion().some((m) => m.action === 'join' && Object.keys(m).sort().join() === 'action,code' && m.code === room1));
  t('le Hub, lui, connaît bien le profil (même player.id) : c\'est là que l\'identité va',
    B.envoyes.some((e) => e.url.startsWith(HUB) && e.data && e.data.player && e.data.player.name === 'Bruno'));
  t('#to-hub n\'a pas la classe .back (réservée au retour portfolio)', await A.eval(`!document.getElementById('to-hub').classList.contains('back') && document.querySelectorAll('a.back').length === 1`));

  // ═══ 14. retour au Hub
  await B.click('#to-hub');
  await B.until(`location.pathname === '/games/' && !document.getElementById('lobby').hidden && !document.getElementById('hub-ready').hidden`, 15000, 'retour Hub B');
  t('#to-hub : B revient au Hub, même session, « partie terminée »', /terminée/.test(await texte(B, 'hub-ready')) && B.hub().code === code, await texte(B, 'hub-ready'));
  await A.click('#to-hub');
  await A.until(`location.pathname === '/games/' && !document.getElementById('lobby').hidden`, 15000, 'retour Hub A');
  t('#to-hub : A (l\'hôte) revient au Hub, toujours hôte', await A.eval(`!document.getElementById('hub-draw-btn').hidden && !document.getElementById('hub-draw-btn').disabled`));

  // ═══ 15. SECOND lancement dans la même session : B quitte en pleine partie
  await A.click('#hub-draw-btn');
  for (const J of [A, B]) await J.until(`document.getElementById('hub-result').dataset.game === 'morpion' && !document.getElementById('hub-result').hidden`, 15000, `second tirage ${J.nom}`);
  const { room: room2 } = await lancement(A, B, 2);
  t('second handoff : une NOUVELLE room, créée de la même façon', CODE_RE.test(room2) && room2 !== room1, room2);
  await rejoindre(B, room2);
  await coup(A, 4);
  // B repart au Hub par le bandeau, en pleine partie : morpion-server ferme la room.
  await B.click('.g-hub-banner-back');
  await B.until(`location.pathname === '/games/'`, 15000, 'B au Hub');
  await A.until(`/adversaire est parti/.test(document.getElementById('error').textContent) && !document.getElementById('to-hub').hidden`, 10000, 'A prévenu');
  t('B quitte en pleine partie : A est prévenu, « Retour au Game Hub » proposé', true, await texte(A, 'error'));
  const deb2 = await B.attendsTrame((m) => m.session && m.session.state === 'debrief' && m.session.history.played.length === 2, 10000, 'debrief 2');
  t('le Hub revient en debrief (partie finie), deux Morpion dans l\'historique', deb2.session.launch.stage === 'ended', JSON.stringify(deb2.session.history.played));

  // ═══ 16. TROISIÈME lancement : la connexion de l'hôte tombe pendant l'attente
  await A.click('#to-hub');
  await A.until(`location.pathname === '/games/' && !document.getElementById('lobby').hidden`, 15000, 'retour Hub A (2)');
  await A.click('#hub-draw-btn');
  await A.until(`document.getElementById('hub-result').dataset.game === 'morpion' && !document.getElementById('hub-result').hidden`, 15000, 'troisième tirage');
  const { room: room3 } = await lancement(A, B, 3);
  await A.eval(`NET.ws.close()`);        // coupure : la room d'attente meurt avec la connexion
  await A.until(`!document.getElementById('lost').hidden && !document.getElementById('lost-hub').hidden`, 8000, 'connexion perdue chez A');
  t('hôte coupé en attente : « connexion perdue » + « Retour au Game Hub »', /fermée/.test(await texte(A, 'lost-text')), await texte(A, 'lost-text'));
  const annule = await B.attendsTrame((m) => m.session && m.session.launch && m.session.launch.stage === 'failed', 10000, 'lancement annulé');
  t('le lancement est ANNULÉ pour tout le groupe (pas 120 s devant une room morte)', annule.session.launch.reason === 'CANCELLED' && annule.session.state === 'lobby', annule.session.launch.reason);
  await B.until(`!document.getElementById('hub-failed').hidden && /annul/.test(document.getElementById('hub-failed').textContent)`, 8000, 'échec affiché chez B');
  t('B, au Hub : plus de bouton « Rejoindre » vers la room morte', !(await B.visible('#launch-go')));
  t('B, au Hub : l\'échec est dit', true, await texte(B, 'hub-failed'));
  const errs = [A, B].flatMap((J) => J.erreurs.map((e) => `[${J.nom}] ${e}`));
  t('aucune erreur JS (Hub)', errs.length === 0, errs.slice(0, 3).join(' | '));
  void room3;

  // ═══ 17. HORS Hub : deux joueurs, aucun billet — la page d'avant
  const D = await joueur('D'), E = await joueur('E');
  const DIRECT = `${BASE}/games/morpion/?server=${encodeURIComponent(MORP)}`;
  for (const J of [D, E]) await J.goto(DIRECT);
  await D.click('#host');
  await D.until(`!document.getElementById('game').hidden && state && state.status === 'waiting'`, 10000, 'room de D');
  const roomD = (await texte(D, 'room-code')).trim();
  await E.type('#code-input', roomD);
  await E.click('#join');
  await D.until(`state.status === 'playing'`, 8000, 'E dans la room');
  const hors = await D.eval(`({ ban: !!document.querySelector('.g-hub-banner'), lien: lien === null })`);
  t('hors Hub : pas de bandeau, `lien` nul', !hors.ban && hors.lien, JSON.stringify(hors));
  t('hors Hub : aucune trame du Hub', !D.trames.some((m) => m.session) && !E.trames.some((m) => m.session) && !D.envoyes.some((e) => e.url.startsWith(HUB)));
  for (const [J, i] of [[D, 0], [E, 1], [D, 3], [E, 2], [D, 6]]) await coup(J, i);
  await E.until(`state.status === 'over'`, 8000, 'fin hors Hub');
  t('hors Hub : partie jouée jusqu\'au bout, D gagne sur la première colonne', /perdu/.test(await texte(E, 'status')) && JSON.stringify(await E.eval('state.line')) === '[0,3,6]');
  t('hors Hub : pas de « Retour au Game Hub »', !(await D.visible('#to-hub')) && !(await E.visible('#to-hub')));
  for (const J of [D, E]) {
    const s = sansIdentite(J);
    t(`hors Hub, ${J.nom} : aucune identité envoyée à morpion-server`, s.ok, s.fautif);
  }
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
