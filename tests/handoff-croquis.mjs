// Handoff Hub → Croq.ios (technique : croquis), de bout en bout : le vrai
// game-hub-server et le VRAI croquis-server, lancés en local depuis les dépôts
// voisins, et de vrais navigateurs (Edge par le protocole DevTools, contextes
// isolés). Même scénario que tests/handoff-roquette.mjs.
//
//   node tests/handoff-croquis.mjs
//   node tests/handoff-croquis.mjs --reduced       mouvement réduit
//   node tests/handoff-croquis.mjs --shots <dir>   une capture par étape
//
// ⚠️ Croq.ios est HORS du Hub (hub: false dans data/games.js) : il n'est PAS au
// manifest du dépôt, et ce test le vérifie. Pour éprouver le handoff quand
// même, l'entrée `croquis` n'est ajoutée qu'au manifest TEMPORAIRE du Hub local
// (hub-fixture.mjs l'écrit dans le dossier temporaire du système).
//
//   1. le billet, sans réseau ni navigateur (valide, autre jeu, périmé, mal formé) ;
//   2. trois navigateurs : A crée la session du Hub, B et C la rejoignent → seul
//      Croq.ios est éligible → A tire, ouvre le jeu : la room se crée toute
//      seule (roomReady) → B rejoint par le Hub → « Lancer » attend Chloé, A
//      lance SANS l'attendre (started, au premier tour) → C, en retard, est
//      refusé par croquis-server (failed → abort) → la partie va jusqu'au bout
//      au chrono → results PUIS ended, envoyés par l'hôte seul → le Hub compte
//      la partie (debrief, score de soirée par le rang) → « Retour au Game Hub » ;
//   3. hors Hub : sans billet, puis avec un billet d'un autre jeu, périmé ou
//      illisible, la page se joue exactement comme avant, sans un mot au Hub ;
//   4. les messages vers croquis-server : les mêmes actions, et le même `join`,
//      avec ou sans Hub.
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
const require = createRequire(import.meta.url);
const HH = require(path.join(ROOT, 'games/shared/hub-handoff.js'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = () => Math.floor(Math.random() * 300);
const HUB_PORT = 8300 + R(), CRO_PORT = 8900 + R(), HEALTH_PORT = 6100 + R(), HTTP_PORT = 8700 + R(), CDP_PORT = 9700 + R();
const CODE_RE = /^[A-Z]{4}$/;
const SERVEUR = arg('--serveur') || path.join(ROOT, '..', 'croquis-server');
// Les seules actions que la page envoie à croquis-server (avant comme après le
// handoff), et la forme exacte de son `join`.
const ACTIONS_JEU = new Set(['presence', 'join', 'start', 'choose', 'guess', 'stroke', 'undo', 'clear', 'lobby', 'snapshot']);
const CLES_JOIN = ['action', 'avatar', 'code', 'name'];

let out = [], ko = 0;
const t = (nom, ok, detail = '') => {
  out.push(`${ok ? 'OK  ' : 'KO  '} ${nom}${detail ? ' — ' + detail : ''}`);
  if (!ok) ko++;
  console.log(out[out.length - 1]);
};

// ═══════════════════════════════ 1. le billet, sans réseau ni navigateur
console.log('Handoff Croq.ios — le billet\n');
const BON = { v: 1, hub: 'ws://127.0.0.1:8100', session: 'AB2DE', playerId: 'p_alice', drawId: 'd_1', gameId: 'croquis', role: 'host', at: Date.now() };
t('billet valable pour croquis', !!HH.readTicket(BON, 'croquis'));
t('les deux rôles sont acceptés', !!HH.readTicket({ ...BON, role: 'guest' }, 'croquis'));
t('billet d\'un AUTRE jeu : refusé par la page de Croq.ios', !HH.readTicket({ ...BON, gameId: 'roquette' }, 'croquis'));
t('billet périmé (plus de 3 h) : refusé', !HH.readTicket({ ...BON, at: Date.now() - HH.MAX_AGE_MS - 1000 }, 'croquis'));
t('billet illisible ou incomplet : refusé', !HH.readTicket('{pas du json', 'croquis') && !HH.readTicket({ ...BON, session: 'x' }, 'croquis')
  && !HH.readTicket({ ...BON, role: 'admin' }, 'croquis') && !HH.readTicket({ ...BON, v: 2 }, 'croquis'));
t('aucun secret dans le billet : les mêmes champs que pour les autres jeux',
  JSON.stringify(Object.keys(HH.readTicket(BON, 'croquis')).sort()) === JSON.stringify(['at', 'drawId', 'gameId', 'hub', 'playerId', 'role', 'session', 'v']));
const MAN_DEPOT = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/games.manifest.json'), 'utf8'));
t('manifest du DÉPÔT : Croq.ios n\'y est PAS (hub: false, jamais tiré par le vrai Hub)', !MAN_DEPOT.games.some((g) => g.id === 'croquis'));
{
  const src = fs.readFileSync(path.join(ROOT, 'data/games.js'), 'utf8');
  const G = new Function(src + ';return GAMES')();
  const g = G.find((x) => x.id === 'croquis');
  t('data/games.js : croquis reste hub: false', !!g && g.hub === false && g.status === 'live');
}
{
  const page = fs.readFileSync(path.join(ROOT, 'games/croquis/index.html'), 'utf8');
  t('la page charge game-hub.js puis hub-handoff.js (mêmes versions que Roquette)',
    /shared\/game-hub\.js\?v=10/.test(page) && /shared\/hub-handoff\.js\?v=5/.test(page) && page.indexOf('game-hub.js') < page.indexOf('hub-handoff.js'));
}

// ═══════════════════════════════ 2. les vrais serveurs
const procs = [];
const lance = (cwd, file, port, env = {}) => {
  const p = spawn(process.execPath, [file], { cwd, env: { ...process.env, PORT: String(port), HUB_QUIET: '1', PRESENCE_QUIET: '1', ...env }, stdio: 'ignore' });
  procs.push(p); return p;
};
async function attends(url) { for (let i = 0; i < 100; i++) { try { const r = await fetch(url); if (r.ok) return; } catch (_) {} await sleep(100); } throw new Error('injoignable : ' + url); }

const sante = await fakeHealth(HEALTH_PORT);
// Le manifest du Hub LOCAL : celui du dépôt, PLUS une entrée croquis (test
// seulement), au même schéma que Roquette, santé sur le croquis-server local.
const MANIFEST = localManifest(ROOT, HEALTH_PORT);
{
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  m.games.push({ id: 'croquis', title: 'Croq.ios', emoji: '🎨', url: 'games/croquis/', mode: 'online', players: { min: 2, max: 16 },
    minutes: { min: 5, max: 15 }, needs: [], categories: ['ambiance'], server: `ws://127.0.0.1:${CRO_PORT}`,
    health: `http://127.0.0.1:${CRO_PORT}/`, join: 'v1', content: false, replay: true, handoff: true });
  fs.writeFileSync(MANIFEST, JSON.stringify(m));
}
// Délais de test de croquis-server : 2 joueurs = 3 manches, 6 tours ; personne
// ne dessine ni ne devine, chaque tour finit au chrono.
lance(SERVEUR, 'server.js', CRO_PORT, { TEST_CHOOSE_MS: '500', TEST_DRAW_MS: '1200', TEST_PAUSE_MS: '100', TEST_REVEAL_MS: '300' });
lance(path.join(ROOT, '..', 'game-hub-server'), 'src/server.js', HUB_PORT, { MANIFEST_FILE: MANIFEST });
const HUB = `ws://127.0.0.1:${HUB_PORT}`, CRO = `ws://127.0.0.1:${CRO_PORT}`;

let edge = null, cdp = null, srv = null, dir = null;
const stop = () => {
  if (edge) { try { execFileSync('taskkill', ['/PID', String(edge.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (_) { try { edge.kill(); } catch (__) {} } }
  procs.forEach((p) => { try { p.kill(); } catch (_) {} });
  try { cdp && cdp.close(); } catch (_) {}
  try { srv && srv.close(); } catch (_) {}
  sante.close();
  if (dir) try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  try { fs.unlinkSync(MANIFEST); } catch (_) {}
};

// ═══════════════════════════════ 3. de vrais navigateurs
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json' };
function serve() {
  const s = createServer((req, res) => {
    const [p0, q] = req.url.split('?');
    if (p0 === '/games/' && !/(^|&)hub=/.test(q || '')) { res.writeHead(302, { Location: `/games/?hub=${encodeURIComponent(HUB)}` }); return res.end(); }
    if (p0 === '/games/croquis/' && !/(^|&)server=/.test(q || '')) { res.writeHead(302, { Location: `/games/croquis/?server=${encodeURIComponent(CRO)}` }); return res.end(); }
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

// Un joueur = un contexte de navigation isolé. On garde TOUT ce qui passe sur
// ses WebSocket, dans les deux sens, avec l'URL du socket.
async function joueur(nom) {
  const { result: { browserContextId } } = await cdp.send('Target.createBrowserContext', { disposeOnDetach: true });
  const { result: { targetId } } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { result: { sessionId } } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const J = { nom, erreurs: [], trames: [], envoyes: [], sockets: {} };
  cdp.on(sessionId, (m) => {
    if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails; J.erreurs.push((d.exception?.description || d.text || '').split('\n')[0]); }
    if (m.method === 'Network.webSocketCreated') J.sockets[m.params.requestId] = m.params.url;
    if (m.method === 'Network.webSocketFrameReceived') { try { J.trames.push({ url: J.sockets[m.params.requestId], ...JSON.parse(m.params.response.payloadData) }); } catch (_) {} }
    if (m.method === 'Network.webSocketFrameSent') { try { J.envoyes.push({ url: J.sockets[m.params.requestId], ...JSON.parse(m.params.response.payloadData) }); } catch (_) {} }
  });
  const S = (m, p) => cdp.send(m, p, sessionId);
  await S('Runtime.enable'); await S('Page.enable'); await S('Network.enable');
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
  J.box = (sel) => J.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null;
      e.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = e.getBoundingClientRect();
      return r.width && r.height ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; })()`);
  J.click = async (sel) => {
    const box = await J.box(sel);
    if (!box) throw new Error(`[${nom}] introuvable ou invisible : ${sel}`);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await S('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
    await sleep(80);
  };
  J.type = async (sel, text) => { await J.click(sel); await J.eval(`document.querySelector(${JSON.stringify(sel)}).select()`); await S('Input.insertText', { text }); await sleep(60); };
  J.immobile = async (sel, ms = 5000) => {
    const pos = `(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return r.top + ',' + r.left + ',' + scrollY; })()`;
    let avant = await J.eval(pos), stables = 0;
    const fin = Date.now() + ms;
    while (Date.now() < fin && stables < 3) { await sleep(100); const p = await J.eval(pos); stables = p === avant ? stables + 1 : 0; avant = p; }
  };
  J.shot = async (f) => { if (!SHOTS) return; const r = await S('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SHOTS, (REDUCED ? 'r-' : '') + f + '.png'), Buffer.from(r.result.data, 'base64')); };
  J.hubEnvoye = (action) => J.envoyes.filter((m) => m.url && m.url.startsWith(HUB) && m.action === action);
  J.hubEtat = () => { for (let i = J.trames.length - 1; i >= 0; i--) if (J.trames[i].session && J.trames[i].url && J.trames[i].url.startsWith(HUB)) return J.trames[i].session; return null; };
  J.cro = (type) => J.trames.filter((m) => m.url && m.url.startsWith(CRO) && m.type === type);
  J.versJeu = () => J.envoyes.filter((m) => m.url && m.url.startsWith(CRO));
  return J;
}
const surCroquis = `location.pathname === '/games/croquis/' && document.readyState === 'complete' && !!window.__croquis && typeof NET === 'object'`;
const texte = (J, id) => J.eval(`(document.getElementById(${JSON.stringify(id)}) || {}).textContent || ''`);
const vu = (id) => `(() => { const e = document.getElementById(${JSON.stringify(id)}); return !!e && !e.hidden && !!e.offsetParent; })()`;
const banniere = (J) => J.eval(`(document.querySelector('.g-hub-banner') || {}).textContent || ''`);
// Ce qu'une page envoie à croquis-server : uniquement les actions du jeu, et
// un `join` de la forme habituelle (jamais un champ du Hub).
function messagesJeu(J) {
  const l = J.versJeu();
  const etrangers = l.filter((m) => !ACTIONS_JEU.has(m.action)).map((m) => m.action);
  const joins = l.filter((m) => m.action === 'join').map((m) => Object.keys(m).filter((k) => k !== 'url').sort());
  const fuite = l.some((m) => /drawId|session|playerId|hub/i.test(JSON.stringify({ ...m, url: undefined })));
  return { n: l.length, etrangers, joins, fuite };
}

try {
  await attends(`http://127.0.0.1:${CRO_PORT}/`);
  await attends(`http://127.0.0.1:${HUB_PORT}/health`);
  srv = await serve();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'handoffcro-'));
  edge = spawn(EDGE, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${dir}`, '--no-first-run',
    '--disable-features=BackForwardCache', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank'], { stdio: 'ignore' });
  cdp = await cdpBrowser();
  const BASE = `http://127.0.0.1:${HTTP_PORT}`;
  const PAGE = `${BASE}/games/?hub=${encodeURIComponent(HUB)}`;
  console.log(`\nHandoff Hub → Croq.ios — navigateurs (${REDUCED ? 'mouvement RÉDUIT' : 'mouvement normal'})\n`);
  const A = await joueur('A'), B = await joueur('B'), C = await joueur('C'), D = await joueur('D');

  // ═══ 4. le Hub : trois profils, une session, un tirage qui ne peut donner que Croq.ios
  for (const [J, nom, rang] of [[A, 'Alice', 1], [B, 'Bruno', 2], [C, 'Chloé', 5]]) {
    await J.navigate(PAGE);
    await J.until(`document.readyState === 'complete' && !!window.GameHub && !!window.HubHandoff`, 15000, '/games/');
    await J.type('#name-input', nom);
    await J.click(`#avatar-row .avatar-pick:nth-child(${rang})`);
    await J.click('#identity-done');
    if (J === A) { await J.click('#hub-create'); await J.until(`!document.getElementById('lobby').hidden`, 20000, 'salon de A'); }
    else { await J.type('#hub-code-input', await A.eval(`document.getElementById('hub-code').textContent.trim()`)); await J.click('#hub-join'); }
  }
  const code = await A.eval(`document.getElementById('hub-code').textContent.trim()`);
  for (const J of [A, B, C]) await J.until(`document.querySelectorAll('#hub-players .hub-card').length === 3`, 20000, `${J.nom} au salon`);
  t('Hub : A crée la session, B et C la rejoignent', true, code);
  for (let k = 0; k < 20; k++) {
    const id = await B.eval(`([...document.querySelectorAll('#hub-games .hub-game[data-eligible=true]')].map((x) => x.dataset.game).find((g) => g !== 'croquis')) || ''`);
    if (!id) break;
    await B.click(`#hub-games [data-pref=veto][data-game=${id}]`);
    await B.until(`!document.querySelector('#hub-games .hub-game[data-eligible=true][data-game=${id}]')`, 5000, `veto ${id}`);
  }
  await A.until(`[...document.querySelectorAll('#hub-games .hub-game[data-eligible=true]')].map((x) => x.dataset.game).join() === 'croquis'`, 8000, 'seul Croq.ios');
  await A.click('#hub-draw-btn');
  for (const J of [A, B, C]) await J.until(`document.getElementById('hub-result').dataset.game === 'croquis' && !document.getElementById('hub-result').hidden`, 15000, `révélation ${J.nom}`);
  t('tirage (manifest de TEST) : Croq.ios, révélé chez les trois', true);

  // ═══ 5. A ouvre le jeu : billet lu, la room se crée toute seule, roomReady
  await A.click('#hub-continue');
  await A.until(`!document.getElementById('launch-go').hidden`, 8000, 'Ouvrir');
  await A.immobile('#launch-go');
  await A.click('#launch-go');
  await A.until(surCroquis, 15000, 'A sur Croq.ios');
  const billetA = await A.eval(`sessionStorage.getItem('mathys_hub_handoff')`);
  await A.until(`${vu('lobby')} && /^[A-Z]{4}$/.test(document.getElementById('room-code').textContent.trim())`, 20000, 'room créée');
  const roomA = (await texte(A, 'room-code')).trim();
  const youA = A.cro('you').find((m) => m.code === roomA);
  const joinA = A.versJeu().find((m) => m.action === 'join');
  t('billet lu : la page crée la room toute seule (join SANS code), A hôte', CODE_RE.test(roomA) && !!youA && youA.host === true && !!joinA && joinA.code === undefined, roomA);
  t('billet écrit par /games/ : gameId croquis, rôle host', !!billetA && JSON.parse(billetA).gameId === 'croquis' && JSON.parse(billetA).role === 'host', billetA);
  t('le pseudo du profil est repris (« Alice »)', await A.eval(`document.getElementById('name-input').value === 'Alice'`) && joinA.name === 'Alice');
  const banA = await banniere(A);
  t('bandeau Game Hub sur la page de Croq.ios (session du billet)', banA.includes(code), banA);
  const launched = A.hubEnvoye('launched');
  t('roomReady → « launched » : LE code de la room, et SA place (id Croq.ios)', launched.length === 1 && launched[0].roomCode === roomA && launched[0].gamePlayerId === youA.id,
    JSON.stringify(launched.map((m) => ({ roomCode: m.roomCode, gamePlayerId: m.gamePlayerId }))));
  const etatJoin = await (async () => { for (let i = 0; i < 80; i++) { const s = A.hubEtat(); if (s && s.launch && s.launch.stage === 'join') return s; await sleep(100); } return null; })();
  t('Hub : stage join, le code de A annoncé au groupe', !!etatJoin && etatJoin.launch.roomCode === roomA);
  const att0 = await A.eval(`({ off: document.getElementById('start').disabled, txt: document.getElementById('start').textContent, anyway: !document.getElementById('start-anyway').hidden })`);
  t('seul dans la room : « Lancer » bloqué, les absents nommés, « Lancer sans attendre » visible', att0.off && /Bruno/.test(att0.txt) && /Chloé/.test(att0.txt) && att0.anyway, att0.txt);
  await A.shot('1-hote-attend');

  // ═══ 6. B rejoint par le Hub ; C attend dehors
  await B.until(`!document.getElementById('launch-go').hidden && /Rejoindre/.test(document.getElementById('launch-go').textContent)`, 10000, 'Rejoindre chez B');
  await B.immobile('#launch-go');
  await B.click('#launch-go');
  await B.until(surCroquis, 15000, 'B sur Croq.ios');
  await B.until(`${vu('lobby')} && document.getElementById('room-code').textContent.trim() === ${JSON.stringify(roomA)}`, 20000, 'B dans la room');
  const youB = B.cro('you').find((m) => m.code === roomA);
  const entered = B.hubEnvoye('entered');
  t('B : entré dans LA room (join + code), « entered » avec SA place', !!youB && !youB.host && entered.length === 1 && entered[0].roomCode === roomA && entered[0].gamePlayerId === youB.id);
  t('B : aucun « launched » (seul l\'hôte déclare le code)', B.hubEnvoye('launched').length === 0);
  await A.until(`/Chloé/.test(document.getElementById('start').textContent) && !/Bruno/.test(document.getElementById('start').textContent)`, 8000, 'attente de Chloé seule');
  t('A : « Lancer » n\'attend plus que Chloé', true, await texte(A, 'start'));

  // ═══ 7. A lance SANS attendre → started, au premier tour, une fois
  const avantStart = A.envoyes.length;
  await A.click('#start-anyway');
  await A.until(`${vu('play')}`, 10000, 'partie lancée');
  await (async () => { for (let i = 0; i < 40 && !A.hubEnvoye('started').length; i++) await sleep(100); })();
  const started = A.hubEnvoye('started');
  const tour1 = A.cro('turn').find((m) => m.turnId === 1);
  t('started : envoyé par l\'hôte, une fois, au premier tour (après le « start » du jeu)', started.length === 1 && A.envoyes.indexOf(started[0]) >= avantStart && !!tour1,
    JSON.stringify(started.map((m) => m.drawId)));
  t('B (invité) n\'envoie jamais « started »', B.hubEnvoye('started').length === 0);
  const playing = await (async () => { for (let i = 0; i < 80; i++) { const s = A.hubEtat(); if (s && s.state === 'inGame') return s; await sleep(100); } return null; })();
  t('Hub : inGame (partie lancée sans Chloé)', !!playing && playing.launch.stage === 'playing');

  // ═══ 8. C arrive en retard : croquis-server refuse → failed → abort
  await C.until(`/commencé sans toi/.test(document.getElementById('launch-text').textContent) && document.getElementById('launch-go').hidden`, 8000, 'Chloé manquée');
  t('Chloé, au Hub : « La partie a commencé sans toi », plus de bouton Rejoindre', true);
  const sC = C.hubEtat();
  const idC = await C.eval(`GameProfile.load().id`);
  await C.eval(`HubHandoff.write(${JSON.stringify({ hub: HUB, session: sC.code, playerId: idC, drawId: sC.launch.drawId, gameId: 'croquis', role: 'guest' })})`);
  await C.navigate(`${BASE}/games/croquis/`);
  await C.until(surCroquis, 15000, 'C sur Croq.ios');
  await (async () => { for (let i = 0; i < 80 && !C.hubEnvoye('abort').length; i++) await sleep(100); })();
  const refusC = C.cro('error')[0];
  const abortC = C.hubEnvoye('abort');
  t('C en retard : refusé par croquis-server (« partie déjà commencée »)', !!refusC && /commencée/.test(refusC.message), refusC && refusC.message);
  t('C : failed(\'JOIN\') → « abort » au Hub, avec la raison du jeu', abortC.length === 1 && abortC[0].reason === 'CREATE_FAILED' && /commencée/.test(abortC[0].detail || ''),
    JSON.stringify(abortC.map((m) => ({ reason: m.reason, detail: m.detail }))));
  t('C : le bandeau dit que le Hub est prévenu', /prévenu/.test(await banniere(C)));
  t('C : jamais de « entered » (il n\'est pas dans la room)', C.hubEnvoye('entered').length === 0);

  // ═══ 9. la fin : results PUIS ended, par l'hôte seul
  await A.until(vu('end'), 45000, 'fin chez A');
  await B.until(vu('end'), 10000, 'fin chez B');
  await (async () => { for (let i = 0; i < 80 && !A.hubEnvoye('ended').length; i++) await sleep(100); })();
  const fin = A.cro('results')[0];
  const res = A.hubEnvoye('results'), end = A.hubEnvoye('ended');
  t('fin : croquis-server classe les deux joueurs, partie complète (6 tours)', !!fin && fin.complete === true && fin.ranking.length === 2 && A.cro('turn').length === 6,
    fin && JSON.stringify(fin.ranking.map((r) => `${r.rank}:${r.score}`)));
  const attendu = fin.ranking.map((r) => ({ gamePlayerId: r.id, rank: r.rank, points: r.score })).sort((a, b) => a.rank - b.rank || a.gamePlayerId.localeCompare(b.gamePlayerId));
  const recu = res[0] ? res[0].results.slice().sort((a, b) => a.rank - b.rank || a.gamePlayerId.localeCompare(b.gamePlayerId)) : null;
  t('results : le classement du serveur, tel quel (id Croq.ios, rang et score du serveur)', res.length === 1 && JSON.stringify(recu) === JSON.stringify(attendu),
    JSON.stringify(recu));
  t('results et ended : chacun une fois, results AVANT ended', res.length === 1 && end.length === 1 && A.envoyes.indexOf(res[0]) < A.envoyes.indexOf(end[0]));
  t('results / ended : le bon tirage (drawId) et le bon jeu', res[0] && res[0].drawId === end[0].drawId && res[0].gameId === 'croquis');
  t('B (invité) n\'envoie ni results ni ended', B.hubEnvoye('results').length === 0 && B.hubEnvoye('ended').length === 0);
  const debrief = await (async () => { for (let i = 0; i < 80; i++) { const s = A.hubEtat(); if (s && s.state === 'debrief') return s; await sleep(100); } return null; })()
    || await (async () => { for (let i = 0; i < 80; i++) { const s = B.hubEtat(); if (s && s.state === 'debrief') return s; await sleep(100); } return null; })();
  t('Hub : la partie est comptée puis terminée (scored, stage ended, debrief)', !!debrief && debrief.launch.scored === true && debrief.launch.stage === 'ended', debrief && JSON.stringify(debrief.launch).slice(0, 160));
  const partie = debrief && debrief.history && debrief.history.games && debrief.history.games[0];
  // Personne n'a dessiné ni deviné : 0 partout, ex æquo au 1er rang → 20 chacun.
  const pts = (r) => 10 * (2 - r.rank + 1);
  t('score de soirée : le rang du serveur converti par le Hub (10 × (classés − rang + 1))', !!partie && partie.gameId === 'croquis' && partie.results.length === 2
    && partie.results.every((r) => r.points === pts(r)), partie && JSON.stringify(partie.results.map((r) => `${r.name}:${r.rank}:${r.points}`)));
  t('billet consommé à la fin (ended)', !(await A.eval(`sessionStorage.getItem('mathys_hub_handoff')`)));

  // ═══ 10. l'écran de fin, en mode Hub
  const finA = await A.eval(`({ hub: !document.getElementById('to-hub').hidden && document.getElementById('to-hub').classList.contains('g-hub-home'),
    revanche: document.getElementById('revanche').textContent, avant: !!(document.getElementById('to-hub').compareDocumentPosition(document.getElementById('revanche')) & 4) })`);
  t('A : « ↩ Retour au Game Hub » en action principale, avant la revanche « hors score »', finA.hub && finA.avant && /Revanche \(hors score\)/.test(finA.revanche), JSON.stringify(finA));
  t('B : le retour au Hub aussi', await B.eval(`!document.getElementById('to-hub').hidden`));
  for (const J of [A, B]) {
    const mj = messagesJeu(J);
    t(`${J.nom} (mode Hub) : vers croquis-server, seulement les actions du jeu et un join habituel (${mj.n} messages)`,
      mj.etrangers.length === 0 && !mj.fuite && mj.joins.length === 1 && mj.joins.every((k) => k.every((x) => CLES_JOIN.includes(x))), JSON.stringify(mj));
  }
  await A.shot('2-fin-hub');
  await A.click('#to-hub');
  await A.until(`location.pathname === '/games/' && !document.getElementById('lobby').hidden`, 15000, 'retour au Hub');
  t('A revient au Game Hub, même session', (await A.eval(`document.getElementById('hub-code').textContent.trim()`)) === code);
  await A.shot('3-retour-hub');

  // ═══ 11. hors Hub : billets invalides, puis aucun billet — la page comme avant
  const idD = await (async () => { await D.navigate(`${BASE}/games/croquis/`); await D.until(surCroquis, 15000, 'D sur Croq.ios'); return D.eval(`GameProfile.load().id`); })();
  const base = { v: 1, hub: HUB, session: code, playerId: idD, drawId: 'd_x', role: 'host', at: Date.now() };
  for (const [nom, billet] of [
    ['billet d\'un autre jeu (roquette)', JSON.stringify({ ...base, gameId: 'roquette' })],
    ['billet périmé', JSON.stringify({ ...base, gameId: 'croquis', at: Date.now() - HH.MAX_AGE_MS - 1000 })],
    ['billet illisible', '{pas du json'],
  ]) {
    const avant = D.envoyes.length;
    await D.eval(`sessionStorage.setItem('mathys_hub_handoff', ${JSON.stringify(billet)})`);
    await D.navigate(`${BASE}/games/croquis/`);
    await D.until(surCroquis, 15000, 'D sur Croq.ios');
    await sleep(600);
    const etat = await D.eval(`({ bandeau: !!document.querySelector('.g-hub-banner'), home: !document.getElementById('home').hidden,
      toHub: document.getElementById('to-hub').hidden, anyway: document.getElementById('start-anyway').hidden })`);
    t(`${nom} : ignoré — accueil normal, aucun bandeau, aucune connexion au Hub ni au jeu`,
      !etat.bandeau && etat.home && etat.toHub && etat.anyway && D.envoyes.slice(avant).length === 0, JSON.stringify(etat));
  }
  await D.eval(`sessionStorage.removeItem('mathys_hub_handoff')`);
  await D.navigate(`${BASE}/games/croquis/`);
  await D.until(surCroquis, 15000, 'D sur Croq.ios');
  t('sans billet : aucun bandeau, ni « Retour au Game Hub », ni « Lancer sans attendre »',
    await D.eval(`!document.querySelector('.g-hub-banner') && document.getElementById('to-hub').hidden && document.getElementById('start-anyway').hidden`));
  await D.type('#name-input', 'Dora');
  await D.click('#host');
  await D.until(`${vu('lobby')} && /^[A-Z]{4}$/.test(document.getElementById('room-code').textContent.trim())`, 15000, 'room de D');
  const roomD = (await texte(D, 'room-code')).trim();
  t('hors Hub : une room SÉPARÉE, aucun message au Hub', roomD !== roomA && D.envoyes.every((m) => !m.url || !m.url.startsWith(HUB)), roomD);
  t('hors Hub : « Lancer » bloqué seul (règle des 2 joueurs), texte habituel', await D.eval(`document.getElementById('start').disabled && document.getElementById('start').textContent === 'Lancer la partie'`));
  const E = new WebSocket(CRO);
  await new Promise((r) => { E.onopen = r; });
  E.onmessage = (e) => { const m = JSON.parse(e.data); if (m.type === 'presence') E.send(JSON.stringify({ action: 'presence', n: m.n })); };
  E.send(JSON.stringify({ action: 'join', name: 'Eve', avatar: { kind: 'emoji', emoji: '🐙' }, code: roomD }));
  await D.until(`!document.getElementById('start').disabled && document.getElementById('start').textContent === 'Lancer la partie'`, 8000, '2 joueurs');
  t('hors Hub : à 2, « Lancer » s\'ouvre, sans attente du Hub', true);
  await D.click('#start');
  await D.until(vu('end'), 45000, 'fin hors Hub');
  t('hors Hub : partie jouée jusqu\'au classement, sans « Retour au Game Hub », revanche habituelle',
    await D.eval(`document.getElementById('to-hub').hidden && document.querySelectorAll('#classement li').length === 2 && document.getElementById('revanche').textContent === '↻ Revanche'`));
  t('hors Hub : aucun message vers le Hub de toute la partie', D.envoyes.every((m) => !m.url || !m.url.startsWith(HUB)));
  {
    const mj = messagesJeu(D);
    t(`hors Hub : vers croquis-server, les mêmes actions et le même join qu'en mode Hub (${mj.n} messages)`,
      mj.etrangers.length === 0 && !mj.fuite && mj.joins.length === 1 && mj.joins.every((k) => k.every((x) => CLES_JOIN.includes(x))), JSON.stringify(mj));
  }
  try { E.close(); } catch (_) {}

  for (const J of [A, B, C, D]) t(`aucune erreur JS chez ${J.nom}`, J.erreurs.length === 0, J.erreurs.join(' | '));
} catch (e) {
  t('EXCEPTION (navigateurs)', false, e && (e.stack || e.message));
} finally {
  stop();
  console.log(`\n${ko ? 'DES TESTS ÉCHOUENT' : 'TOUT PASSE'} — ${out.length} vérifications, ${ko} échec(s)`);
  process.exit(ko ? 1 : 0);
}
