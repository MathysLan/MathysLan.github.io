// Handoff Hub → Roquette Party, de bout en bout : le vrai game-hub-server et le
// VRAI roquette-server, lancés en local depuis les dépôts voisins, et de vrais
// navigateurs (Edge par le protocole DevTools, contextes isolés).
//
//   node tests/handoff-roquette.mjs
//   node tests/handoff-roquette.mjs --reduced       mouvement réduit
//   node tests/handoff-roquette.mjs --shots <dir>   une capture par étape
//
// Roquette Party est au manifest du dépôt (handoff: true) : le Hub LOCAL relit
// ce manifest, seule la santé de Roquette pointe sur le roquette-server local.
//
//   1. le billet, sans réseau ni navigateur ;
//   2. trois navigateurs : A crée la session du Hub, B et C la rejoignent → seul
//      Roquette est éligible → A tire, ouvre le jeu : la room se crée toute seule
//      (roomReady) → B rejoint par le Hub → « Lancer » attend Chloé, A lance
//      SANS l'attendre (started) → C, en retard, est refusé par roquette-server
//      (failed → abort) → la partie va jusqu'au bout (1 vie, personne ne tape)
//      → results PUIS ended, envoyés par l'hôte seul → le Hub compte la partie
//      (debrief, score de soirée par le rang) → « Retour au Game Hub » ;
//   3. hors Hub (aucun billet) : la page se joue exactement comme avant.
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
const HUB_PORT = 8300 + R(), ROQ_PORT = 8900 + R(), HEALTH_PORT = 6100 + R(), HTTP_PORT = 8700 + R(), CDP_PORT = 9700 + R();
const CODE_RE = /^[A-Z]{4}$/;
// roquette-server n'a pas de node_modules sur le poste : on lui prête le `ws`
// du Hub (rien n'est écrit dans son dépôt).
const NODE_PATH = path.join(ROOT, '..', 'game-hub-server', 'node_modules');

let out = [], ko = 0;
const t = (nom, ok, detail = '') => {
  out.push(`${ok ? 'OK  ' : 'KO  '} ${nom}${detail ? ' — ' + detail : ''}`);
  if (!ok) ko++;
  console.log(out[out.length - 1]);
};

// ═══════════════════════════════ 1. le billet, sans réseau ni navigateur
console.log('Handoff Roquette Party — le billet\n');
const BON = { v: 1, hub: 'ws://127.0.0.1:8100', session: 'AB2DE', playerId: 'p_alice', drawId: 'd_1', gameId: 'roquette', role: 'host', at: Date.now() };
t('billet valable pour roquette', !!HH.readTicket(BON, 'roquette'));
t('billet d\'un AUTRE jeu : refusé par la page de Roquette', !HH.readTicket({ ...BON, gameId: 'passeur' }, 'roquette'));
t('billet périmé (plus de 3 h) : refusé', !HH.readTicket({ ...BON, at: Date.now() - HH.MAX_AGE_MS - 1000 }, 'roquette'));
t('les deux rôles sont acceptés', !!HH.readTicket({ ...BON, role: 'guest' }, 'roquette'));
const MAN_DEPOT = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/games.manifest.json'), 'utf8'));
{
  const g = MAN_DEPOT.games.find((x) => x.id === 'roquette');
  t('manifest du DÉPÔT : Roquette y est, lançable (handoff: true, 2 à 16 joueurs)',
    !!g && g.handoff === true && g.players.min === 2 && g.players.max === 16, JSON.stringify(g && { handoff: g.handoff, players: g.players }));
}

// ═══════════════════════════════ 2. les vrais serveurs
const procs = [];
const lance = (cwd, file, port, env = {}) => {
  const p = spawn(process.execPath, [file], { cwd, env: { ...process.env, PORT: String(port), HUB_QUIET: '1', PRESENCE_QUIET: '1', ...env }, stdio: 'ignore' });
  procs.push(p); return p;
};
async function attends(url) { for (let i = 0; i < 100; i++) { try { const r = await fetch(url); if (r.ok) return; } catch (_) {} await sleep(100); } throw new Error('injoignable : ' + url); }

const sante = await fakeHealth(HEALTH_PORT);
// Le manifest du Hub LOCAL : celui du dépôt, santé de Roquette sur le serveur local.
const MANIFEST = localManifest(ROOT, HEALTH_PORT, { roquette: `http://127.0.0.1:${ROQ_PORT}/` });
const AUTRES = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')).games.map((g) => g.id).filter((id) => id !== 'roquette');
// Délais de test de roquette-server : une menace courte (1 vie, personne ne
// tape → explosion rapide), un décompte bref.
lance(path.join(ROOT, '..', 'roquette-server'), 'server.js', ROQ_PORT, { NODE_PATH, TEST_PLANCHER_MS: '900', TEST_COUNTDOWN_MS: '600', TEST_BOOM_MS: '600' });
lance(path.join(ROOT, '..', 'game-hub-server'), 'src/server.js', HUB_PORT, { MANIFEST_FILE: MANIFEST });
const HUB = `ws://127.0.0.1:${HUB_PORT}`, ROQ = `ws://127.0.0.1:${ROQ_PORT}`;

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
    if (p0 === '/games/roquette/' && !/(^|&)server=/.test(q || '')) { res.writeHead(302, { Location: `/games/roquette/?server=${encodeURIComponent(ROQ)}` }); return res.end(); }
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
// ses WebSocket, dans les deux sens, avec l'URL du socket : ce qu'envoie la
// page au Hub (`envoyes`) est exactement ce que ce test vérifie.
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
  J.roq = (type) => J.trames.filter((m) => m.url && m.url.startsWith(ROQ) && m.type === type);
  return J;
}
const surRoquette = `location.pathname === '/games/roquette/' && document.readyState === 'complete' && !!window.Rocket`;
const texte = (J, id) => J.eval(`(document.getElementById(${JSON.stringify(id)}) || {}).textContent || ''`);
const vu = (id) => `(() => { const e = document.getElementById(${JSON.stringify(id)}); return !!e && !e.hidden && !!e.offsetParent; })()`;

try {
  await attends(`http://127.0.0.1:${ROQ_PORT}/`);
  await attends(`http://127.0.0.1:${HUB_PORT}/health`);
  srv = await serve();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'handoffroq-'));
  edge = spawn(EDGE, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${dir}`, '--no-first-run',
    '--disable-features=BackForwardCache', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank'], { stdio: 'ignore' });
  cdp = await cdpBrowser();
  const BASE = `http://127.0.0.1:${HTTP_PORT}`;
  const PAGE = `${BASE}/games/?hub=${encodeURIComponent(HUB)}`;
  console.log(`\nHandoff Hub → Roquette Party — navigateurs (${REDUCED ? 'mouvement RÉDUIT' : 'mouvement normal'})\n`);
  const A = await joueur('A'), B = await joueur('B'), C = await joueur('C'), D = await joueur('D');

  // ═══ 4. le Hub : trois profils, une session, un tirage qui ne peut donner que Roquette
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
  // B met son veto sur chaque jeu encore ÉLIGIBLE (un jeu écarté passe dans la
  // liste repliée des indisponibles, son bouton n'est plus à l'écran).
  for (let k = 0; k < 20; k++) {
    const id = await B.eval(`([...document.querySelectorAll('#hub-games .hub-game[data-eligible=true]')].map((x) => x.dataset.game).find((g) => g !== 'roquette')) || ''`);
    if (!id) break;
    await B.click(`#hub-games [data-pref=veto][data-game=${id}]`);
    await B.until(`!document.querySelector('#hub-games .hub-game[data-eligible=true][data-game=${id}]')`, 5000, `veto ${id}`);
  }
  void AUTRES;
  await A.until(`[...document.querySelectorAll('#hub-games .hub-game[data-eligible=true]')].map((x) => x.dataset.game).join() === 'roquette'`, 8000, 'seul Roquette');
  await A.click('#hub-draw-btn');
  for (const J of [A, B, C]) await J.until(`document.getElementById('hub-result').dataset.game === 'roquette' && !document.getElementById('hub-result').hidden`, 15000, `révélation ${J.nom}`);
  t('tirage : Roquette Party, révélé chez les trois', true);

  // ═══ 5. A ouvre le jeu : billet lu, la room se crée toute seule, roomReady
  await A.click('#hub-continue');
  await A.until(`!document.getElementById('launch-go').hidden`, 8000, 'Ouvrir');
  await A.immobile('#launch-go');
  await A.click('#launch-go');
  await A.until(surRoquette, 15000, 'A sur Roquette');
  await A.until(`${vu('lobby')} && /^[A-Z]{4}$/.test(document.getElementById('room-code').textContent.trim())`, 20000, 'room créée');
  const roomA = (await texte(A, 'room-code')).trim();
  const youA = A.roq('you').find((m) => m.code === roomA);
  t('billet lu : la page crée la room toute seule (join sans code), A hôte', CODE_RE.test(roomA) && !!youA && youA.host === true, roomA);
  t('le pseudo du profil est repris (« Alice »)', await A.eval(`document.getElementById('name-input').value === 'Alice'`));
  const banA = await A.eval(`(document.querySelector('.g-hub-banner') || {}).textContent || ''`);
  t('bandeau Game Hub sur la page de Roquette (session du billet)', banA.includes(code), banA);
  await A.until(`(() => true)()`);
  const launched = A.hubEnvoye('launched');
  t('roomReady → « launched » : LE code de la room, et SA place (id Roquette)', launched.length === 1 && launched[0].roomCode === roomA && launched[0].gamePlayerId === youA.id,
    JSON.stringify(launched.map((m) => ({ roomCode: m.roomCode, gamePlayerId: m.gamePlayerId }))));
  const etatJoin = await (async () => { for (let i = 0; i < 80; i++) { const s = A.hubEtat(); if (s && s.launch && s.launch.stage === 'join') return s; await sleep(100); } return null; })();
  t('Hub : stage join, le code de A annoncé au groupe', !!etatJoin && etatJoin.launch.roomCode === roomA);
  const att0 = await A.eval(`({ off: document.getElementById('start').disabled, txt: document.getElementById('start').textContent, anyway: !document.getElementById('start-anyway').hidden })`);
  t('seul dans la room : « Lancer » bloqué, les absents nommés, « Lancer sans attendre » visible', att0.off && /Bruno/.test(att0.txt) && /Chloé/.test(att0.txt) && att0.anyway, att0.txt);
  await A.shot('1-hote-attend');

  // ═══ 6. B rejoint par le Hub ; C attend dehors
  await B.until(`!document.getElementById('launch-go').hidden && /Rejoindre/.test(document.getElementById('launch-go').textContent)`, 10000, 'Rejoindre chez B');
  // L'arme (skin) : Bruno a choisi la Pétoire lors d'une visite précédente
  // (préférence du navigateur, même origine que /games/) ; Alice n'a rien choisi.
  await B.eval(`localStorage.setItem('roquette_skin', 'petoire')`);
  await B.immobile('#launch-go');
  await B.click('#launch-go');
  await B.until(surRoquette, 15000, 'B sur Roquette');
  await B.until(`${vu('lobby')} && document.getElementById('room-code').textContent.trim() === ${JSON.stringify(roomA)}`, 20000, 'B dans la room');
  const youB = B.roq('you').find((m) => m.code === roomA);
  const entered = B.hubEnvoye('entered');
  t('B : entré dans LA room (join + code), « entered » avec SA place', !!youB && !youB.host && entered.length === 1 && entered[0].roomCode === roomA && entered[0].gamePlayerId === youB.id);
  t('B : aucun « launched » (seul l\'hôte déclare le code)', B.hubEnvoye('launched').length === 0);
  await A.until(`/Chloé/.test(document.getElementById('start').textContent) && !/Bruno/.test(document.getElementById('start').textContent)`, 8000, 'attente de Chloé seule');
  t('A : « Lancer » n\'attend plus que Chloé', true, await texte(A, 'start'));

  // ═══ 6 bis. l'arme (skin) en mode Hub : le même salon, rien vers le Hub
  const joinRoq = (J) => J.envoyes.find((m) => m.url && m.url.startsWith(ROQ) && m.action === 'join');
  t('skin : A (aucune préférence) entre avec la roquette, B avec sa Pétoire (join du jeu)',
    joinRoq(A) && joinRoq(A).skin === 'roquette' && joinRoq(B) && joinRoq(B).skin === 'petoire', JSON.stringify([joinRoq(A) && joinRoq(A).skin, joinRoq(B) && joinRoq(B).skin]));
  t('skin : le sélecteur est dans le salon du jeu lancé par le Hub (aucun autre écran), la roquette choisie chez A',
    await A.until(`!document.getElementById('skin-choix').hidden && document.querySelector('.skin-pick[data-skin="roquette"]').getAttribute('aria-pressed') === 'true'`, 5000, 'sélecteur A'));
  t('skin : A voit Bruno avec la Pétoire',
    await A.until(`((document.querySelector('#players li[data-id="${youB.id}"] .tag-skin') || {}).textContent || '') === 'Pétoire'`, 5000, 'tag B'));
  await A.click('.skin-pick[data-skin="petoire"]');
  await B.until(`((document.querySelector('#players li[data-id="${youA.id}"] .tag-skin') || {}).textContent || '') === 'Pétoire'`, 5000, 'A en Pétoire chez B');
  await sleep(300);
  await A.click('.skin-pick[data-skin="roquette"]');
  await B.until(`((document.querySelector('#players li[data-id="${youA.id}"] .tag-skin') || {}).textContent || '') === 'Roquette'`, 5000, 'A de retour en roquette chez B');
  t('skin : A change d\'arme au salon (Pétoire puis roquette), B le voit — action `skin` vers le jeu seulement',
    A.envoyes.filter((m) => m.url && m.url.startsWith(ROQ) && m.action === 'skin').map((m) => m.skin).join() === 'petoire,roquette');

  // ═══ 7. A lance SANS attendre (1 vie) → started, au décompte, une fois
  await A.eval(`document.getElementById('vies-select').value = '1'`);
  const avantStart = A.envoyes.length;
  await A.click('#start-anyway');
  await A.until(`document.getElementById('play').dataset.phase === 'countdown' || document.getElementById('play').dataset.phase === 'turn'`, 10000, 'décompte');
  await (async () => { for (let i = 0; i < 40 && !A.hubEnvoye('started').length; i++) await sleep(100); })();
  const started = A.hubEnvoye('started');
  const iCountdown = A.trames.findIndex((m) => m.url && m.url.startsWith(ROQ) && m.type === 'countdown');
  t('started : envoyé par l\'hôte, une fois, au décompte (après le « start » du jeu)', started.length === 1 && A.envoyes.indexOf(started[0]) >= avantStart && iCountdown >= 0,
    JSON.stringify(started.map((m) => m.drawId)));
  t('B (invité) n\'envoie jamais « started »', B.hubEnvoye('started').length === 0);
  const playing = await (async () => { for (let i = 0; i < 80; i++) { const s = A.hubEtat(); if (s && s.state === 'inGame') return s; await sleep(100); } return null; })();
  t('Hub : inGame (partie lancée sans Chloé)', !!playing && playing.launch.stage === 'playing');

  // ═══ 8. C arrive en retard : roquette-server refuse → failed → abort
  // Le Hub ne lui propose plus « Rejoindre » ; elle arrive quand même par un
  // billet (celui que /games/ écrit au clic) : c'est roquette-server qui refuse.
  await C.until(`/commencé sans toi/.test(document.getElementById('launch-text').textContent) && document.getElementById('launch-go').hidden`, 8000, 'Chloé manquée');
  t('Chloé, au Hub : « La partie a commencé sans toi », plus de bouton Rejoindre', true);
  const sC = C.hubEtat();
  const idC = await C.eval(`GameProfile.load().id`);
  await C.eval(`HubHandoff.write(${JSON.stringify({ hub: HUB, session: sC.code, playerId: idC, drawId: sC.launch.drawId, gameId: 'roquette', role: 'guest' })})`);
  await C.navigate(`${BASE}/games/roquette/`);
  await C.until(surRoquette, 15000, 'C sur Roquette');
  await (async () => { for (let i = 0; i < 80 && !C.hubEnvoye('abort').length; i++) await sleep(100); })();
  const refusC = C.roq('error')[0];
  const abortC = C.hubEnvoye('abort');
  t('C en retard : refusé par roquette-server (« partie déjà commencée »)', !!refusC && /commencée/.test(refusC.message), refusC && refusC.message);
  t('C : failed(\'JOIN\') → « abort » au Hub, avec la raison du jeu', abortC.length === 1 && abortC[0].reason === 'CREATE_FAILED' && /commencée/.test(abortC[0].detail || ''),
    JSON.stringify(abortC.map((m) => ({ reason: m.reason, detail: m.detail }))));
  t('C : le bandeau dit que le Hub est prévenu', /prévenu/.test(await C.eval(`(document.querySelector('.g-hub-banner') || {}).textContent || ''`)));
  t('C : jamais de « entered » (il n\'est pas dans la room)', C.hubEnvoye('entered').length === 0);

  // ═══ 9. la fin : results PUIS ended, par l'hôte seul
  await A.until(vu('end'), 30000, 'fin chez A');
  await B.until(vu('end'), 10000, 'fin chez B');
  await (async () => { for (let i = 0; i < 80 && !A.hubEnvoye('ended').length; i++) await sleep(100); })();
  const fin = A.roq('end')[0];
  const res = A.hubEnvoye('results'), end = A.hubEnvoye('ended');
  t('fin : roquette-server classe les deux joueurs (rangs 1 et 2)', !!fin && fin.ranking.length === 2 && fin.ranking.map((r) => r.rank).sort().join() === '1,2');
  const attendu = fin.ranking.map((r) => ({ gamePlayerId: r.id, rank: r.rank, points: 0 })).sort((a, b) => a.rank - b.rank);
  const recu = res[0] ? res[0].results.slice().sort((a, b) => a.rank - b.rank) : null;
  t('results : le classement du serveur, tel quel (id Roquette, rang du serveur, 0 point)', res.length === 1 && JSON.stringify(recu) === JSON.stringify(attendu),
    JSON.stringify(recu));
  t('results et ended : chacun une fois, results AVANT ended', res.length === 1 && end.length === 1 && A.envoyes.indexOf(res[0]) < A.envoyes.indexOf(end[0]));
  t('results / ended : le bon tirage (drawId) et le bon jeu', res[0] && res[0].drawId === end[0].drawId && res[0].gameId === 'roquette');
  t('B (invité) n\'envoie ni results ni ended', B.hubEnvoye('results').length === 0 && B.hubEnvoye('ended').length === 0);
  const debrief = await (async () => { for (let i = 0; i < 80; i++) { const s = A.hubEtat(); if (s && s.state === 'debrief') return s; await sleep(100); } return null; })()
    || await (async () => { for (let i = 0; i < 80; i++) { const s = B.hubEtat(); if (s && s.state === 'debrief') return s; await sleep(100); } return null; })();
  t('Hub : la partie est comptée puis terminée (scored, stage ended, debrief)', !!debrief && debrief.launch.scored === true && debrief.launch.stage === 'ended', debrief && JSON.stringify(debrief.launch).slice(0, 160));
  const partie = debrief && debrief.history && debrief.history.games && debrief.history.games[0];
  const gagnant = fin.ranking.find((r) => r.rank === 1);
  const nomGagnant = gagnant.id === youA.id ? 'Alice' : 'Bruno';
  t('score de soirée : le 1er (rang du serveur) marque 20, le 2e 10', !!partie && partie.gameId === 'roquette'
    && partie.results.find((r) => r.rank === 1).name === nomGagnant && partie.results.find((r) => r.rank === 1).points === 20 && partie.results.find((r) => r.rank === 2).points === 10,
    partie && JSON.stringify(partie.results.map((r) => `${r.name}:${r.rank}:${r.points}`)));

  // L'explosion a montré l'arme du joueur touché (A roquette, B Pétoire).
  const touche = A.roq('boom')[0];
  const armeAttendue = touche && touche.id === youB.id ? 'petoire' : 'roquette';
  t(`skin : l'explosion montre l'arme du joueur touché (${armeAttendue}), chez A et chez B`,
    !!touche && (await A.eval(`document.getElementById('rocket').dataset.skin`)) === armeAttendue && (await B.eval(`document.getElementById('rocket').dataset.skin`)) === armeAttendue);
  t('skin : aucun message vers le Hub ne parle d\'arme (contrat Hub inchangé)',
    [A, B, C].every((J) => J.envoyes.filter((m) => m.url && m.url.startsWith(HUB)).every((m) => !JSON.stringify(m).includes('skin'))));

  // ═══ 10. l'écran de fin, en mode Hub
  const finA = await A.eval(`({ hub: !document.getElementById('to-hub').hidden && document.getElementById('to-hub').classList.contains('g-hub-home'),
    again: document.getElementById('again').textContent, focus: document.activeElement && document.activeElement.id })`);
  t('A : « ↩ Retour au Game Hub » en action principale, la revanche « hors score »', finA.hub && /Revanche \(hors score\)/.test(finA.again), JSON.stringify(finA));
  t('B : le retour au Hub aussi', await B.eval(`!document.getElementById('to-hub').hidden`));
  await A.shot('2-fin-hub');
  await A.click('#to-hub');
  await A.until(`location.pathname === '/games/' && !document.getElementById('lobby').hidden`, 15000, 'retour au Hub');
  t('A revient au Game Hub, même session', (await A.eval(`document.getElementById('hub-code').textContent.trim()`)) === code);
  await A.shot('3-retour-hub');

  // ═══ 11. hors Hub : aucun billet, la page fonctionne comme avant
  await D.navigate(`${BASE}/games/roquette/`);
  await D.until(surRoquette, 15000, 'D sur Roquette');
  t('hors Hub : aucun bandeau, ni « Retour au Game Hub », ni « Lancer sans attendre »',
    await D.eval(`!document.querySelector('.g-hub-banner') && document.getElementById('to-hub').hidden && document.getElementById('start-anyway').hidden`));
  await D.type('#name-input', 'Dora');
  await D.click('#host');
  await D.until(`${vu('lobby')} && /^[A-Z]{4}$/.test(document.getElementById('room-code').textContent.trim())`, 15000, 'room de D');
  const roomD = (await texte(D, 'room-code')).trim();
  t('hors Hub : une room SÉPARÉE, aucun message au Hub', roomD !== roomA && D.envoyes.every((m) => !m.url || !m.url.startsWith(HUB)), roomD);
  t('hors Hub : « Lancer » bloqué seul (règle des 2 joueurs), texte habituel', await D.eval(`document.getElementById('start').disabled && document.getElementById('start').textContent === 'Lancer la partie'`));
  // un second joueur, simple client WebSocket
  const E = new WebSocket(ROQ);
  await new Promise((r) => { E.onopen = r; });
  E.onmessage = (e) => { const m = JSON.parse(e.data); if (m.type === 'presence') E.send(JSON.stringify({ action: 'presence', n: m.n })); };
  E.send(JSON.stringify({ action: 'join', name: 'Eve', avatar: { kind: 'emoji', emoji: '🐙' }, code: roomD }));
  await D.until(`!document.getElementById('start').disabled && document.getElementById('start').textContent === 'Lancer la partie'`, 8000, '2 joueurs');
  t('hors Hub : à 2, « Lancer » s\'ouvre, sans attente du Hub', true);
  await D.eval(`document.getElementById('vies-select').value = '1'`);
  await D.click('#start');
  await D.until(vu('end'), 30000, 'fin hors Hub');
  t('hors Hub : partie jouée jusqu\'au classement, sans « Retour au Game Hub »', await D.eval(`document.getElementById('to-hub').hidden && document.querySelectorAll('#ranking li').length === 2`));
  t('hors Hub : aucun message vers le Hub de toute la partie', D.envoyes.every((m) => !m.url || !m.url.startsWith(HUB)));
  try { E.close(); } catch (_) {}

  for (const J of [A, B, C, D]) t(`aucune erreur JS chez ${J.nom}`, J.erreurs.length === 0, J.erreurs.join(' | '));
} catch (e) {
  t('EXCEPTION (navigateurs)', false, e && (e.stack || e.message));
} finally {
  stop();
  console.log(`\n${ko ? 'DES TESTS ÉCHOUENT' : 'TOUT PASSE'} — ${out.length} vérifications, ${ko} échec(s)`);
  process.exit(ko ? 1 : 0);
}
