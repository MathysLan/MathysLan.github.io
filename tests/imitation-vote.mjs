// Imitation — la ligne « on attend … » du vote suit les DÉPARTS, dans de vrais
// navigateurs.
//
//   node tests/imitation-vote.mjs                  imitation-server lancé en local
//   node tests/imitation-vote.mjs --edge <exe>     autre navigateur Chromium
//
// Le défaut : pendant le vote, « on attend X, Y » n'était recalculé qu'à chaque
// vote (`rated`). Un votant qui quittait la partie restait nommé jusqu'au vote
// suivant. Le serveur, lui, renvoie bien l'état `room` sans le partant.
//
// Le parcours, en jeu direct (sans Hub) : A crée, B et C rejoignent → une
// manche, A et B enregistrent, C non → première prise : C (qui vote sur toutes
// les prises) quitte AVANT de voter → chez les deux restants, C n'est plus
// nommé, seul l'autre votant l'est → il vote → « ✔ tout le monde a voté ».
//
// ⚠️ Pas de --virtual-time-budget (jeu en réseau) : temps réel par DevTools.
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const EDGE = arg('--edge') || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const R = () => Math.floor(Math.random() * 300);
const HTTP_PORT = 8700 + R(), CDP_PORT = 9700 + R(), IMI_PORT = 8900 + R();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let out = [], ko = 0;
const t = (nom, ok, detail = '') => {
  out.push(`${ok ? 'OK  ' : 'KO  '} ${nom}${detail ? ' — ' + detail : ''}`);
  if (!ok) ko++;
  console.log(out[out.length - 1]);
};

// --- serveurs (local) -------------------------------------------------------------
const IMI = `ws://127.0.0.1:${IMI_PORT}`;
const procs = [];
const lance = (cwd, file, port, env = {}) => {
  const p = spawn(process.execPath, [file], { cwd, env: { ...process.env, PORT: String(port), ...env }, stdio: 'ignore' });
  procs.push(p); return p;
};
async function attends(url) { for (let i = 0; i < 100; i++) { try { const r = await fetch(url); if (r.ok) return; } catch (_) {} await sleep(100); } throw new Error('injoignable : ' + url); }

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json' };
function serve() {
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const full = path.join(ROOT, p);
    if (!full.startsWith(ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
    res.end(fs.readFileSync(full));
  });
  return new Promise((r) => srv.listen(HTTP_PORT, '127.0.0.1', () => r(srv)));
}

// --- CDP (même plomberie que hub-score-imitation.mjs) ----------------------------------------
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
  // Chaque socket est rangé par serveur, d'après son URL.
  const J = { nom, erreurs: [], sockets: {}, recus: [], envoyes: [] };
  const genre = () => 'jeu';
  cdp.on(sessionId, (m) => {
    const p = m.params || {};
    if (m.method === 'Runtime.exceptionThrown') J.erreurs.push((p.exceptionDetails.exception?.description || p.exceptionDetails.text || '').split('\n')[0]);
    if (m.method === 'Network.webSocketCreated') J.sockets[p.requestId] = genre(p.url);
    if (m.method === 'Network.webSocketFrameReceived' || m.method === 'Network.webSocketFrameSent') {
      if (p.response.opcode !== 1) return;                   // les prises audio (binaire)
      let d; try { d = JSON.parse(p.response.payloadData); } catch (_) { return; }
      const f = { g: J.sockets[p.requestId] || '?', d, at: Date.now() };
      (m.method.endsWith('Sent') ? J.envoyes : J.recus).push(f);
    }
  });
  const S = (m, p) => cdp.send(m, p, sessionId);
  await S('Runtime.enable'); await S('Page.enable'); await S('Network.enable');
  J.targetId = targetId;
  await cdp.send('Browser.grantPermissions', { permissions: ['audioCapture'], browserContextId });
  J.size = (w, h) => S('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 500 });
  await J.size(1280, 900);
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
  J.goto = async (url) => { await S('Page.navigate', { url }); await J.until(`document.readyState === 'complete' && !!window.GameNet`, 30000, 'chargement ' + url); };
  J.click = async (sel) => {
    const box = await J.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'center', behavior: 'instant' });
      const r = e.getBoundingClientRect(); return r.width && r.height ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; })()`);
    if (!box) throw new Error(`[${nom}] introuvable ou invisible : ${sel}`);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await S('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
    await sleep(100);
  };
  J.type = async (sel, text) => { await J.click(sel); await J.eval(`document.querySelector(${JSON.stringify(sel)}).select()`); await S('Input.insertText', { text }); await sleep(60); };
  J.attends = async (pred, ms = 10000, label = 'trame') => {
    const fin = Date.now() + ms;
    while (Date.now() < fin) { const f = [...J.recus].reverse().find((x) => pred(x.d, x.g)); if (f) return f.d; await sleep(50); }
    throw new Error(`[${nom}] trame jamais reçue : ${label}`);
  };
  return J;
}

// --- orchestration ----------------------------------------------------------------
lance(path.join(ROOT, '..', 'imitation-server'), 'src/server.js', IMI_PORT, { VIDEOS_URL: '', RECORD_GRACE_MS: '300' });
const srv = await serve();
await attends(`http://127.0.0.1:${IMI_PORT}/`);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imivote-'));
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${dir}`, '--no-first-run',
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required',
  '--disable-features=BackForwardCache', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank'], { stdio: 'ignore' });
let cdp = null;
const stop = () => {
  // ⚠️ edge.kill() ne tue que le parent (voir tests/README.md).
  try { execFileSync('taskkill', ['/PID', String(edge.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (_) { try { edge.kill(); } catch (__) {} }
  procs.forEach((p) => { try { p.kill(); } catch (_) {} });
  try { cdp && cdp.close(); } catch (_) {}
  try { srv.close(); } catch (_) {}
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
};

const PAGE = `http://127.0.0.1:${HTTP_PORT}/games/imitation/?server=${encodeURIComponent(IMI)}`;
const ligne = `document.getElementById('listen-count').textContent`;
console.log('Imitation — « on attend … » et les départs pendant le vote (local)\n');

try {
  cdp = await cdpBrowser();
  const A = await joueur(cdp, 'A'), B = await joueur(cdp, 'B'), C = await joueur(cdp, 'C');
  const tous = [A, B, C];
  const noms = { A: 'Vote-Alice', B: 'Vote-Bruno', C: 'Vote-Chloé' };

  // ═══ 1. room à trois, en jeu direct
  await A.goto(PAGE);
  await A.type('#name-input', noms.A); await A.click('#host');
  await A.until(`!document.getElementById('lobby').hidden && document.getElementById('room-code').textContent.trim().length === 4`, 20000, 'room créée');
  const code = await A.eval(`document.getElementById('room-code').textContent.trim()`);
  for (const J of [B, C]) {
    await J.goto(PAGE);
    await J.type('#name-input', noms[J.nom]); await J.type('#code-input', code); await J.click('#join');
    await J.until(`!document.getElementById('lobby').hidden`, 20000, `${J.nom} dans la room`);
  }
  await A.until(`document.querySelectorAll('#players .g-player').length === 3`, 10000, '3 joueurs chez A');
  const ids = {}; for (const J of tous) ids[J.nom] = await J.eval('you');

  // ═══ 2. une manche : A et B enregistrent, C non
  await A.until(`!document.getElementById('start').disabled`, 15000, '« Lancer » débloqué');
  await A.eval(`document.getElementById('rounds-select').value = '1'; true`);
  await A.click('#start');
  await A.until(`!document.getElementById('next-btn').hidden`, 15000, 'visionnage : bouton du MJ');
  await A.click('#next-btn');
  for (const J of [A, B]) await J.until(`!document.getElementById('rec-box').hidden`, 10000, `enregistrement ${J.nom}`);
  for (const J of [A, B]) await J.click('#rec-btn');
  await sleep(1300);
  for (const J of [A, B]) await J.click('#rec-btn');
  for (const J of [A, B]) await J.until(`/envoyée/.test(document.getElementById('rec-status').textContent)`, 10000, `prise envoyée ${J.nom}`);
  await A.click('#next-btn');

  // ═══ 3. première prise : C part avant de voter
  const l = await A.attends((d) => d.type === 'listen' && d.idx === 1, 15000, 'écoute 1');
  const auteur = tous.find((J) => ids[J.nom] === l.player);
  const votant = [A, B].find((J) => J !== auteur);          // le seul votant qui reste
  const restants = [A, B];
  for (const J of restants) await J.until(`!document.getElementById('listen-box').hidden && /on attend/.test(${ligne})`, 10000, `écoute chez ${J.nom}`);
  const avant = await A.eval(ligne);
  t('avant tout vote, les deux votants sont attendus (jamais l\'auteur)',
    avant.includes(noms.C) && avant.includes(noms[votant.nom]) && !avant.includes(noms[auteur.nom]), avant);

  await cdp.send('Target.closeTarget', { targetId: C.targetId });  // C ferme son onglet
  for (const J of restants) await J.attends((d) => d.type === 'room' && d.players.length === 2, 10000, `départ de C vu par ${J.nom}`);
  await sleep(300);
  for (const J of restants) {
    const txt = await J.eval(ligne);
    t(`${J.nom} : après le départ de C, il n'est plus attendu, seul ${noms[votant.nom]} l'est`,
      !txt.includes(noms.C) && txt.includes(`on attend ${noms[votant.nom]}`), txt);
  }

  // ═══ 4. le dernier votant vote → tout le monde a voté
  await votant.until(`!document.querySelector('.rate[data-v="2"]').disabled`, 10000, 'boutons de note');
  await votant.click('.rate[data-v="2"]');
  for (const J of restants) {
    await J.attends((d) => d.type === 'rated' && d.count === 1 && d.of === 1, 10000, `vote vu par ${J.nom}`);
    await sleep(200);
    const txt = await J.eval(ligne);
    t(`${J.nom} : « ✔ tout le monde a voté » après le vote de ${votant.nom}`, /tout le monde a voté/.test(txt), txt);
  }

  const errs = restants.flatMap((J) => J.erreurs.map((e) => `[${J.nom}] ${e}`));
  t('aucune erreur JS chez les deux restants', errs.length === 0, errs.slice(0, 3).join(' | '));
} catch (e) {
  t('EXCEPTION', false, e.message);
} finally {
  stop();
}
console.log(`\n${ko ? 'DES TESTS ÉCHOUENT' : 'TOUT PASSE'} — ${out.length} vérifications, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
