// Livraison fiable results → ended, dans de VRAIS navigateurs : le socket
// Game Hub de l'hôte est coupé au moment critique, celui du JEU jamais.
//
//   node tests/hub-report-play.mjs              Hub + morpion-server lancés en local
//   node tests/hub-report-play.mjs --prod       front de CE dépôt (servi en local)
//                                               contre le VRAI Hub et le VRAI
//                                               morpion-server (Render)
//
// Le Morpion parce qu'il se joue à deux et se termine en cinq coups, et que son
// classement (victoire = rangs 1 / 2) se prévoit exactement.
//
// Comment on coupe UN socket : un script injecté avant la page enveloppe
// WebSocket. Les sockets vers le Hub sont retenus ; `__hub.bloque = true` les
// ferme et envoie toute NOUVELLE connexion Hub vers un port fermé (le client se
// croit coupé du réseau et retente). Le socket du jeu passe tel quel.
//
//   1. coupure juste avant le coup gagnant, fin de partie SANS Hub, puis le Hub
//      revient sur la page du jeu → le classement puis la fin sont livrés ;
//   2. coupure, fin de partie, et l'hôte rentre au Hub (#to-hub) avant toute
//      reprise : c'est /games/ (hub-page.js) qui livre ; puis rechargement de
//      /games/ → rien n'est renvoyé ;
//   3. le tirage suivant marche.
// La vérité est dans les trames : ce que l'hôte envoie au Hub, et l'état que
// le Hub diffuse à l'invité.
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { fakeHealth, localManifest } from './hub-fixture.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const EDGE = arg('--edge') || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PROD = process.argv.includes('--prod');
const R = () => Math.floor(Math.random() * 300);
const HTTP_PORT = 8700 + R(), CDP_PORT = 9700 + R(), HUB_PORT = 8100 + R(), MO_PORT = 8900 + R(), HEALTH_PORT = 6400 + R();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const PREFIXE = 'mathys_hub_report:';

let out = [], ko = 0;
const t = (nom, ok, detail = '') => {
  out.push(`${ok ? 'OK  ' : 'KO  '} ${nom}${detail ? ' — ' + detail : ''}`);
  if (!ok) ko++;
  console.log(out[out.length - 1]);
};

// Un port qu'on vient de libérer : une connexion refusée, tout de suite.
const PORT_MORT = await new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

// --- serveurs (local) -------------------------------------------------------------
const HUB = PROD ? 'wss://game-hub-server-qqdk.onrender.com' : `ws://127.0.0.1:${HUB_PORT}`;
const MO = `ws://127.0.0.1:${MO_PORT}`;
const procs = [];
const lance = (cwd, file, port, env = {}) => {
  const p = spawn(process.execPath, [file], { cwd, env: { ...process.env, PORT: String(port), HUB_QUIET: '1', ...env }, stdio: 'ignore' });
  procs.push(p); return p;
};
async function attends(url) { for (let i = 0; i < 100; i++) { try { const r = await fetch(url); if (r.ok) return; } catch (_) {} await sleep(100); } throw new Error('injoignable : ' + url); }

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json' };
// Le front de CE dépôt. En local, /games/ et le Morpion sont redirigés vers les
// serveurs locaux ; en --prod, rien n'est redirigé : les pages parlent au Hub et
// au morpion-server de production (leurs URL par défaut).
function serve() {
  const srv = createServer((req, res) => {
    const [p0, q] = req.url.split('?');
    if (!PROD && p0 === '/games/' && !/(^|&)hub=/.test(q || '')) { res.writeHead(302, { Location: `/games/?hub=${encodeURIComponent(HUB)}` }); return res.end(); }
    if (!PROD && p0 === '/games/morpion/' && !/(^|&)server=/.test(q || '')) { res.writeHead(302, { Location: `/games/morpion/?server=${encodeURIComponent(MO)}` }); return res.end(); }
    let p = decodeURIComponent(p0);
    if (p.endsWith('/')) p += 'index.html';
    const full = path.join(ROOT, p);
    if (!full.startsWith(ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(fs.readFileSync(full));
  });
  return new Promise((r) => srv.listen(HTTP_PORT, '127.0.0.1', () => r(srv)));
}

// --- le coupe-Hub, injecté AVANT chaque document -------------------------------------
const COUPE_HUB = `(() => {
  const N = window.WebSocket;
  const estHub = (u) => ${JSON.stringify(PROD ? 'game-hub-server' : `127.0.0.1:${HUB_PORT}`)} && String(u).includes(${JSON.stringify(PROD ? 'game-hub-server' : `127.0.0.1:${HUB_PORT}`)});
  window.__hub = { socks: [], bloque: false };
  window.__hub.couper = () => { window.__hub.bloque = true; window.__hub.socks.forEach((s) => { try { s.close(); } catch (_) {} }); return true; };
  class W extends N {
    constructor(u, p) {
      const hub = estHub(u);
      super(hub && window.__hub.bloque ? 'ws://127.0.0.1:${PORT_MORT}/' : u, p);
      if (hub) window.__hub.socks.push(this);
    }
  }
  window.WebSocket = W;
})();`;

// --- CDP (même plomberie que hub-score-morpion.mjs) --------------------------------
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

async function joueur(cdp, nom) {
  const { result: { browserContextId } } = await cdp.send('Target.createBrowserContext', { disposeOnDetach: true });
  const { result: { targetId } } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { result: { sessionId } } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const J = { nom, erreurs: [], sockets: {}, recus: [], envoyes: [] };
  const genre = (url) => (/game-hub|hub/i.test(url) && !/morpion/i.test(url)) || url.startsWith(HUB) ? 'hub' : 'jeu';
  cdp.on(sessionId, (m) => {
    const p = m.params || {};
    if (m.method === 'Runtime.exceptionThrown') J.erreurs.push((p.exceptionDetails.exception?.description || p.exceptionDetails.text || '').split('\n')[0]);
    if (m.method === 'Network.webSocketCreated') J.sockets[p.requestId] = genre(p.url);
    if (m.method === 'Network.webSocketFrameReceived' || m.method === 'Network.webSocketFrameSent') {
      if (p.response.opcode !== 1) return;
      let d; try { d = JSON.parse(p.response.payloadData); } catch (_) { return; }
      const f = { g: J.sockets[p.requestId] || '?', d, at: Date.now() };
      (m.method.endsWith('Sent') ? J.envoyes : J.recus).push(f);
    }
  });
  const S = (m, p) => cdp.send(m, p, sessionId);
  await S('Runtime.enable'); await S('Page.enable'); await S('Network.enable');
  await S('Page.addScriptToEvaluateOnNewDocument', { source: COUPE_HUB });
  await S('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  J.eval = async (expression) => {
    const r = await S('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(`[${nom}] ` + (r.result.exceptionDetails.exception?.description || 'erreur JS').split('\n')[0]);
    return r.result?.result?.value;
  };
  J.until = async (expr, ms = 10000, label = expr) => {
    const fin = Date.now() + ms;
    while (Date.now() < fin) { try { const v = await J.eval(expr); if (v) return v; } catch (_) {} await sleep(80); }
    throw new Error(`[${nom}] attente expirée : ${label}`);
  };
  J.goto = async (url) => { await S('Page.navigate', { url }); await J.until(`document.readyState === 'complete' && !!window.GameHub`, 30000, 'chargement ' + url); };
  J.reload = async () => { await S('Page.reload', { ignoreCache: true }); await sleep(300); await J.until(`document.readyState === 'complete' && !!window.GameHub`, 30000, 'rechargement'); };
  J.immobile = async (sel, ms = 5000) => {
    const pos = `(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return r.top + ',' + r.left + ',' + scrollY; })()`;
    let avant = await J.eval(pos), st = 0; const fin = Date.now() + ms;
    while (Date.now() < fin && st < 3) { await sleep(100); const q = await J.eval(pos); st = q === avant ? st + 1 : 0; avant = q; }
  };
  J.click = async (sel) => {
    const box = await J.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'center', behavior: 'instant' });
      const r = e.getBoundingClientRect(); return r.width && r.height ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; })()`);
    if (!box) throw new Error(`[${nom}] introuvable ou invisible : ${sel}`);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await S('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
    await sleep(100);
  };
  J.type = async (sel, text) => { await J.click(sel); await J.eval(`document.querySelector(${JSON.stringify(sel)}).select()`); await S('Input.insertText', { text }); await sleep(60); };
  J.hub = () => { const f = [...J.recus].reverse().find((x) => x.g === 'hub' && x.d.session); return f ? f.d.session : null; };
  J.attends = async (pred, ms = 10000, label = 'trame') => {
    const fin = Date.now() + ms;
    while (Date.now() < fin) { const f = [...J.recus].reverse().find((x) => pred(x.d, x.g)); if (f) return f.d; await sleep(50); }
    throw new Error(`[${nom}] trame jamais reçue : ${label}`);
  };
  J.versHub = (depuis) => J.envoyes.slice(depuis).filter((f) => f.g === 'hub' && (f.d.action === 'results' || f.d.action === 'ended')).map((f) => f.d.action);
  J.attentes = () => J.eval(`Object.keys(sessionStorage).filter((k) => k.startsWith(${JSON.stringify(PREFIXE)})).map((k) => [k, JSON.parse(sessionStorage.getItem(k))])`);
  return J;
}

// --- orchestration ----------------------------------------------------------------
let sante = null, MANIFEST = null;
if (!PROD) {
  sante = await fakeHealth(HEALTH_PORT);
  MANIFEST = localManifest(ROOT, HEALTH_PORT, { morpion: `http://127.0.0.1:${MO_PORT}/` });
  // morpion-server emprunte le `ws` de game-hub-server (même parade que
  // hub-score-morpion.mjs) : rien n'est écrit dans son dépôt.
  const wsDe = path.join(ROOT, '..', 'game-hub-server', 'node_modules');
  lance(path.join(ROOT, '..', 'morpion-server'), 'src/server.js', MO_PORT, { PRESENCE_QUIET: '1',
    NODE_PATH: [process.env.NODE_PATH, wsDe].filter(Boolean).join(path.delimiter) });
  lance(path.join(ROOT, '..', 'game-hub-server'), 'src/server.js', HUB_PORT, { MANIFEST_FILE: MANIFEST });
  await attends(`http://127.0.0.1:${MO_PORT}/`);
  await attends(`http://127.0.0.1:${HUB_PORT}/health`);
}
const srv = await serve();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hubreport-'));
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${dir}`, '--no-first-run',
  '--disable-features=BackForwardCache', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank'], { stdio: 'ignore' });
let cdp = null;
const stop = () => {
  try { execFileSync('taskkill', ['/PID', String(edge.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (_) { try { edge.kill(); } catch (__) {} }
  procs.forEach((p) => { try { p.kill(); } catch (_) {} });
  try { cdp && cdp.close(); } catch (_) {}
  try { srv.close(); } catch (_) {}
  if (sante) sante.close();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  try { MANIFEST && fs.unlinkSync(MANIFEST); } catch (_) {}
};

const BASE = `http://127.0.0.1:${HTTP_PORT}`;
const PAGE = PROD ? `${BASE}/games/` : `${BASE}/games/?hub=${encodeURIComponent(HUB)}`;
const LENT = PROD ? 3 : 1;
console.log(`Livraison fiable results → ended — Morpion, deux navigateurs (${PROD ? 'PRODUCTION : vrai Hub, vrai morpion-server, front local' : 'local'})\n`);
const surMorpion = `location.pathname.endsWith('/games/morpion/') && document.readyState === 'complete'`;
const auSalon = `location.pathname.endsWith('/games/') && !document.getElementById('lobby').hidden`;

try {
  cdp = await cdpBrowser();
  const A = await joueur(cdp, 'A'), B = await joueur(cdp, 'B');
  const tous = [A, B];

  // ═══ session à deux, seul le Morpion possible
  await A.goto(PAGE);
  await A.type('#name-input', 'Rep-Alice'); await A.click('#identity-done');
  await A.click('#hub-create');
  await A.until(`!document.getElementById('lobby').hidden`, 30000 * LENT, 'salon de A');
  const code = await A.eval(`document.getElementById('hub-code').textContent.trim()`);
  await B.goto(PAGE);
  await B.type('#name-input', 'Rep-Bruno'); await B.click('#identity-done');
  await B.type('#hub-code-input', code); await B.click('#hub-join');
  for (const J of tous) await J.until(`document.querySelectorAll('#hub-players .hub-card').length === 2 && document.querySelectorAll('#hub-games .hub-game').length >= 8`, 20000 * LENT, `${J.nom} au salon`);
  for (const g of ['passeur', 'imitation', 'ban', 'precision', 'demicercle', 'roquette']) await B.click(`#hub-games [data-pref=veto][data-game=${g}]`);
  await A.until(`[...document.querySelectorAll('#hub-games .hub-game[data-eligible=true]')].map((x) => x.dataset.game).join() === 'morpion'`, 8000 * LENT, 'seul le Morpion');
  const ids = await Promise.all(tous.map((J) => J.eval('GameProfile.load().id')));
  t('session à deux, seul le Morpion possible', true, code);

  async function lancement(n) {
    await A.click('#hub-draw-btn');
    await A.until(`document.getElementById('hub-result').dataset.game === 'morpion' && !document.getElementById('hub-continue').hidden`, 20000 * LENT, 'révélation ' + n);
    const d = await A.attends((x, g) => g === 'hub' && x.session && x.session.draw && x.session.draw.status === 'drawn' && x.session.draw.n === n, 8000, 'tirage ' + n);
    await A.click('#hub-continue');
    await A.until(`!document.getElementById('launch-go').hidden`, 8000 * LENT, 'Ouvrir');
    await A.click('#launch-go');
    await A.until(`${surMorpion} && state && state.status === 'waiting'`, 60000 * LENT, 'room créée');
    await B.until(`!document.getElementById('launch-go').hidden && /Rejoindre/.test(document.getElementById('launch-go').textContent)`, 20000 * LENT, 'Rejoindre chez B');
    await B.immobile('#launch-go');
    await B.click('#launch-go');
    await B.until(`${surMorpion} && state && state.status === 'playing'`, 30000 * LENT, 'B dans la room');
    await A.until(`state && state.status === 'playing'`, 10000 * LENT, 'partie chez A');
    await B.attends((x, g) => g === 'hub' && x.session && x.session.state === 'inGame' && x.session.launch.drawId === d.session.draw.id, 15000 * LENT, 'inGame');
    return d.session.draw.id;
  }
  const coup = async (J, i) => {
    await J.until(`state && state.status === 'playing' && state.turn === state.you`, 10000 * LENT, `tour de ${J.nom}`);
    await J.click(`#board .cell:nth-child(${i + 1})`);
  };
  const joue = async (seq, depuis = 0) => { for (const [k, i] of seq.entries()) await coup((k + depuis) % 2 ? B : A, i); };
  const etatHub = () => B.hub();
  const debrief = (drawId, ms) => B.attends((x, g) => g === 'hub' && x.session && x.session.state === 'debrief' && x.session.launch && x.session.launch.drawId === drawId && x.session.launch.stage === 'ended', ms, 'debrief');
  const scores = (s) => ids.map((id) => s.scores[id] || 0);
  async function coupeHub(J) {
    await J.eval('window.__hub.couper()');
    await J.until(`window.__hub.socks.every((s) => s.readyState === 3)`, 5000, 'socket Hub fermé');
    await sleep(200);
  }

  // ═══ 1. coupure, fin de partie sans Hub, le Hub revient SUR LA PAGE DU JEU
  const d1 = await lancement(1);
  await joue([0, 3, 1, 4]);
  await coupeHub(A);
  const e1 = A.envoyes.length;
  await coup(A, 2);                                        // X gagne : 0 1 2
  await A.attends((d, g) => g === 'jeu' && d.type === 'state' && d.status === 'over' && d.winner === 'X', 10000 * LENT, 'fin 1');
  await sleep(500);
  const att1 = await A.attentes();
  t('1. fin de partie pendant la coupure : classement ET fin gardés dans l\'onglet (clé session + tirage)',
    att1.length === 1 && att1[0][0] === `${PREFIXE}${code}:${d1}` && att1[0][1].ended === true
    && same(att1[0][1].results, [{ gamePlayerId: 'X', rank: 1, points: 0 }, { gamePlayerId: 'O', rank: 2, points: 0 }]), JSON.stringify(att1));
  t('1. rien n\'est parti vers le Hub pendant la coupure', A.versHub(e1).length === 0, A.versHub(e1).join());
  const s1a = etatHub();
  t('1. le Hub n\'a rien reçu : toujours inGame / playing, scored=false', s1a.state === 'inGame' && s1a.launch.stage === 'playing' && s1a.launch.scored === false);
  await A.eval('window.__hub.bloque = false; true');       // le réseau revient
  const s1 = (await debrief(d1, 40000 * LENT)).session;
  t('1. le Hub revient : partie comptée (A 20, B 10) et debrief', same(scores(s1), [20, 10]) && s1.history.games.length === 1, JSON.stringify(scores(s1)));
  await sleep(500);
  t('1. depuis la page du jeu : results PUIS ended, une fois chacun', same(A.versHub(e1), ['results', 'ended']), A.versHub(e1).join(' → '));
  t('1. attente effacée une fois la fin confirmée', (await A.attentes()).length === 0);
  for (const J of tous) {
    await J.until(`!document.getElementById('to-hub').hidden`, 10000, `« Retour au Game Hub » chez ${J.nom}`);
    await J.click('#to-hub');
  }
  for (const J of tous) await J.until(`${auSalon} && document.querySelectorAll('#hub-score-list li').length === 2`, 30000 * LENT, `retour Hub ${J.nom}`);
  t('1. retour au Hub des deux : même session, debrief, score affiché', (await A.eval(`document.getElementById('hub-code').textContent.trim()`)) === code && A.hub().state === 'debrief');

  // ═══ 2. coupure, fin de partie, l'hôte rentre au Hub AVANT toute reprise
  const d2 = await lancement(2);
  await joue([0, 3, 1, 4, 8]);
  await coupeHub(A);
  const e2 = A.envoyes.length;
  await coup(B, 5);                                        // O gagne : 3 4 5
  await A.attends((d, g) => g === 'jeu' && d.type === 'state' && d.status === 'over' && d.winner === 'O', 10000 * LENT, 'fin 2');
  await sleep(500);
  const att2 = await A.attentes();
  t('2. fin pendant la coupure : l\'attente est posée', att2.length === 1 && att2[0][1].ended === true && Array.isArray(att2[0][1].results), JSON.stringify(att2.map((x) => x[0])));
  t('2. le Hub n\'a toujours rien', etatHub().state === 'inGame' && etatHub().launch.scored === false);
  await A.until(`!document.getElementById('to-hub').hidden`, 10000, '« Retour au Game Hub » chez A');
  await A.click('#to-hub');                                // nouvelle page : le coupe-Hub repart à zéro
  await A.until(auSalon, 30000 * LENT, 'A sur /games/');
  const s2 = (await debrief(d2, 30000 * LENT)).session;
  t('2. /games/ livre : partie comptée (cumul A 30, B 30) et debrief', same(scores(s2), [30, 30]) && s2.history.games.length === 2, JSON.stringify(scores(s2)));
  await sleep(600);
  t('2. results PUIS ended, une fois chacun, tous partis de /games/', same(A.versHub(e2), ['results', 'ended']), A.versHub(e2).join(' → '));
  t('2. attente effacée', (await A.attentes()).length === 0);
  const e2b = A.envoyes.length;
  await A.reload();
  await A.until(`${auSalon} && document.querySelectorAll('#hub-score-list li').length === 2`, 30000 * LENT, 'A après rechargement');
  await sleep(1500);
  t('2. /games/ rechargée : rien n\'est renvoyé', A.versHub(e2b).length === 0, A.versHub(e2b).join());
  const s2b = A.hub();
  t('2. après rechargement : score et historique inchangés, debrief', same(scores(s2b), [30, 30]) && s2b.history.games.length === 2 && s2b.state === 'debrief');
  await B.until(`!document.getElementById('to-hub').hidden`, 10000, '« Retour au Game Hub » chez B');
  await B.click('#to-hub');
  await B.until(`${auSalon} && document.querySelectorAll('#hub-score-list li').length === 2`, 30000 * LENT, 'retour Hub B');
  const bloc = await A.eval(`[...document.querySelectorAll('#hub-score-list .hub-score-row')].map((li) => [li.dataset.player, +li.dataset.points])`);
  t('2. le panneau Score affiche les points du Hub', bloc.every(([id, pts]) => pts === s2b.scores[id]) && bloc.length === 2, JSON.stringify(bloc));

  // ═══ 3. la soirée continue : tirage suivant
  await A.click('#hub-draw-btn');
  await A.until(`document.getElementById('hub-result').dataset.game === 'morpion' && !document.getElementById('hub-continue').hidden`, 20000 * LENT, 'révélation 3');
  const s3 = await A.attends((x, g) => g === 'hub' && x.session && x.session.draw && x.session.draw.status === 'drawn' && x.session.draw.n === 3, 8000, 'tirage 3');
  t('3. tirage suivant possible', s3.session.state === 'drawing' || s3.session.state === 'debrief' || !!s3.session.draw, s3.session.state);
  await A.click('#hub-continue');
  await A.until(`!document.getElementById('launch-go').hidden`, 8000 * LENT, 'Ouvrir 3');
  t('3. puis lancement de la partie suivante', A.hub().state === 'launching', A.hub().state);

  const errs = tous.flatMap((J) => J.erreurs.map((e) => `[${J.nom}] ${e}`));
  t('aucune erreur JS dans les deux navigateurs', errs.length === 0, errs.slice(0, 3).join(' | '));
} catch (e) {
  t('EXCEPTION', false, e.message);
} finally {
  stop();
}
console.log(`\n${ko ? 'DES TESTS ÉCHOUENT' : 'TOUT PASSE'} — ${out.length} vérifications, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
