// « Rejouer » dans Qui Ment ?, de bout en bout : le vrai qui-ment-server et le
// vrai game-hub-server lancés en local, de vrais navigateurs (Edge par le
// protocole DevTools, contextes isolés). Aucun mock.
//
//   node tests/quiment-replay.mjs
//   node tests/quiment-replay.mjs --reduced       mouvement réduit
//
// Le cycle de vie du serveur, qu'on respecte au lieu de le contourner : à la
// fin, la room est en phase `end`, et `start` n'y est accepté QUE depuis le
// salon — ailleurs il est ignoré, sans erreur (d'où un bouton qui ne faisait
// rien). « Rejouer » demande donc `lobby` (réservé au MJ), et le nouveau
// `start` ne part qu'au retour du salon diffusé par le serveur.
//
//   1. PROTOCOLE (Node) : `start` en phase `end` est bien ignoré ; `lobby`
//      ramène les trois au salon de LA MÊME room ; `start` y est accepté ;
//      `lobby` est refusé à un joueur qui n'est pas MJ.
//   2. HORS HUB, trois navigateurs : une partie complète, « Rejouer » (double
//      clic compris) → exactement un `lobby` et un `start`, même room, aucun
//      nouveau `you`, un rôle chacun ; puis une deuxième fois ; puis une
//      troisième avec un joueur parti : le salon retrouvé est valide (« il faut
//      au moins 3 joueurs »), un nouveau venu y entre par le code, et la partie
//      repart.
//   3. VIA LE HUB, trois navigateurs : partie complète → debrief ; « Rejouer »
//      rejoue dans la même room, sans rien demander au Hub (ni launched, ni
//      started, ni ended) — comme Le Passeur ; toujours UNE session Hub.
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { fakeHealth, localManifest } from './hub-fixture.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const EDGE = arg('--edge') || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const REDUCED = process.argv.includes('--reduced');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = () => Math.floor(Math.random() * 300);
const HUB_PORT = 8300 + R(), QM_PORT = 8900 + R(), HEALTH_PORT = 6100 + R(), HTTP_PORT = 8700 + R(), CDP_PORT = 9700 + R();
const HUB = `ws://127.0.0.1:${HUB_PORT}`, QM = `ws://127.0.0.1:${QM_PORT}`;
const AUTRES = ['morpion', 'imitation', 'demicercle', 'ban', 'precision', 'passeur'];

let out = [], ko = 0;
const t = (nom, ok, detail = '') => {
  out.push(`${ok ? 'OK  ' : 'KO  '} ${nom}${detail ? ' — ' + detail : ''}`);
  if (!ok) ko++;
  console.log(out[out.length - 1]);
};

// ═══════════════════════════════ les vrais serveurs
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

// ═══════════════════════════════ 1. le protocole, en Node
function qm() {
  const ws = new WebSocket(QM);
  const c = { ws, msgs: [] };
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.type !== 'presence') c.msgs.push(m); };
  c.open = new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('qui-ment injoignable')); });
  c.send = (o) => ws.send(JSON.stringify(o));
  c.apres = async (n, pred, ms = 8000) => { const fin = Date.now() + ms; while (Date.now() < fin) { const m = c.msgs.slice(n).find(pred); if (m) return m; await sleep(20); } return null; };
  return c;
}
const JEU = ['role', 'clues', 'vote', 'guessing', 'results', 'end'];

try {
  await attends(`http://127.0.0.1:${QM_PORT}/`);
  await attends(`http://127.0.0.1:${HUB_PORT}/health`);
  console.log(`« Rejouer » dans Qui Ment ? — protocole réel (Qui Ment ? :${QM_PORT})\n`);
  const [PA, PB, PC] = [qm(), qm(), qm()];
  await Promise.all([PA.open, PB.open, PC.open]);
  PA.send({ action: 'join', name: 'Alice', avatar: '🦊' });
  const you = await PA.apres(0, (m) => m.type === 'you');
  PB.send({ action: 'join', name: 'Bruno', avatar: '🐼', code: you.code });
  PC.send({ action: 'join', name: 'Chloé', avatar: '🐸', code: you.code });
  await PA.apres(0, (m) => m.type === 'lobby' && m.players.length === 3);
  PA.send({ action: 'start', rounds: 3 });
  await PA.apres(0, (m) => m.type === 'role');
  // Jusqu'au classement, au bouton du MJ.
  let fin = null;
  for (let k = 0; k < 30 && !fin; k++) {
    const last = [...PA.msgs].reverse().find((m) => JEU.includes(m.type));
    const n = PA.msgs.length;
    PA.send(last.type === 'results' ? { action: 'next' } : { action: 'skip' });
    const m = await PA.apres(n, (x) => JEU.includes(x.type));
    if (m && m.type === 'end') fin = m;
  }
  t('protocole : une partie de 3 manches jusqu\'au classement', !!fin && fin.ranking.length === 3);

  let n = PA.msgs.length;
  PA.send({ action: 'start', rounds: 3 });
  await sleep(500);
  t('LE BUG, au niveau du serveur : `start` en phase `end` est ignoré — aucune réponse, aucune erreur',
    PA.msgs.length === n, JSON.stringify(PA.msgs.slice(n)));
  const nB = PB.msgs.length;
  PB.send({ action: 'lobby' });
  const refus = await PB.apres(nB, (m) => m.type === 'error');
  t('`lobby` est refusé à un joueur qui n\'est pas MJ', !!refus && /MJ/.test(refus.message), refus && refus.message);
  n = PA.msgs.length;
  const nC = PC.msgs.length;
  PA.send({ action: 'lobby' });
  const lobA = await PA.apres(n, (m) => m.type === 'lobby'), lobC = await PC.apres(nC, (m) => m.type === 'lobby');
  t('`lobby` du MJ : les trois reviennent au salon de LA MÊME room',
    !!lobA && !!lobC && lobA.code === you.code && lobC.code === you.code && lobA.players.length === 3);
  PA.send({ action: 'start', rounds: 3 });
  const r2 = await PC.apres(nC, (m) => m.type === 'role');
  t('`start` depuis le salon : accepté, nouvelle manche 1 avec des scores remis à zéro',
    !!r2 && r2.round === 1 && r2.players.every((p) => p.score === 0));
  for (const P of [PA, PB, PC]) { try { P.ws.close(); } catch (_) {} }
} catch (e) {
  t('EXCEPTION (protocole)', false, e && (e.stack || e.message));
}

// ═══════════════════════════════ de vrais navigateurs
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

// Un joueur : ses trames REÇUES et ENVOYÉES, chacune avec son socket (Qui Ment ? ou Hub).
async function joueur(nom) {
  const { result: { browserContextId } } = await cdp.send('Target.createBrowserContext', { disposeOnDetach: true });
  const { result: { targetId } } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { result: { sessionId } } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const J = { nom, erreurs: [], recu: [], envoye: [], sockets: new Map() };
  joueurs.push(J);
  cdp.on(sessionId, (m) => {
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      J.erreurs.push((d.exception?.description || d.text || '').split('\n')[0]);
    }
    if (m.method === 'Network.webSocketCreated') J.sockets.set(m.params.requestId, m.params.url);
    if (m.method === 'Network.webSocketFrameReceived' || m.method === 'Network.webSocketFrameSent') {
      let d; try { d = JSON.parse(m.params.response.payloadData); } catch (_) { return; }
      if (d.type === 'presence' || d.action === 'presence') return;
      const u = J.sockets.get(m.params.requestId) || '';
      (m.method.endsWith('Sent') ? J.envoye : J.recu).push({ qui: u.startsWith(QM) ? 'qm' : u.startsWith(HUB) ? 'hub' : '?', d });
    }
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
  J.goto = async (url) => { await J.navigate(url); await J.until(`document.readyState === 'complete' && !!window.GameHub`, 15000, 'chargement ' + url); };
  J.box = (sel) => J.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null;
      e.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = e.getBoundingClientRect();
      return r.width && r.height ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; })()`);
  J.click = async (sel, fois = 1) => {
    const box = await J.box(sel);
    if (!box) throw new Error(`[${nom}] introuvable ou invisible : ${sel}`);
    for (let i = 0; i < fois; i++) for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await S('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
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
  J.qm = (depuis = 0) => J.recu.slice(depuis).filter((x) => x.qui === 'qm').map((x) => x.d);
  J.jeu = () => J.recu.filter((x) => x.qui === 'qm' && JEU.includes(x.d.type)).length;
  return J;
}

const vu = (id) => `(() => { const e = document.getElementById(${JSON.stringify(id)}); return !!e && !e.hidden && !!e.offsetParent; })()`;
const texte = (J, id) => J.eval(`(document.getElementById(${JSON.stringify(id)}) || {}).textContent || ''`);

// Une partie jusqu'au classement, au bouton du MJ (passer, dépouiller…).
async function jusquAuClassement(mj, tous) {
  for (let k = 0; k < 40 && !(await mj.eval(vu('end'))); k++) {
    let id = null;
    for (const b of ['skip-clue', 'skip-vote', 'skip-guess', 'next']) if (await mj.eval(vu(b))) { id = b; break; }
    if (!id) { await sleep(150); continue; }
    const n = mj.jeu();
    await mj.click('#' + id);
    const fin = Date.now() + 8000;
    while (Date.now() < fin && mj.jeu() === n) await sleep(50);
    await sleep(150);
  }
  for (const J of tous) await J.until(vu('end'), 10000, `classement chez ${J.nom}`);
}

// « Rejouer » (clic doublé exprès), puis tout ce qu'on exige. Rend le détail.
async function rejouer(mj, tous, code, etiquette) {
  const eMj = mj.envoye.length, r = tous.map((J) => J.recu.length);
  await mj.click('#again', 2);
  for (const J of tous) await J.until(`${vu('play')} && document.getElementById('round-num').textContent === '1'`, 10000, `nouvelle partie chez ${J.nom}`);
  await sleep(500);
  const envoye = mj.envoye.slice(eMj).filter((x) => x.qui === 'qm').map((x) => x.d.action);
  t(`${etiquette} : « Rejouer » (double clic) → exactement un \`lobby\` puis un \`start\``,
    JSON.stringify(envoye) === '["lobby","start"]', JSON.stringify(envoye));
  const recus = tous.map((J, i) => J.qm(r[i]));
  t(`${etiquette} : chacun repasse par le salon de LA MÊME room, puis reçoit son rôle`,
    recus.every((l) => { const iL = l.findIndex((m) => m.type === 'lobby'), iR = l.findIndex((m) => m.type === 'role');
      return iL >= 0 && iR > iL && l[iL].code === code && l[iL].players.length === tous.length; }));
  t(`${etiquette} : pas de nouvelle room (aucun \`you\`), pas de double start (un seul rôle chacun)`,
    recus.every((l) => !l.some((m) => m.type === 'you') && l.filter((m) => m.type === 'role').length === 1));
  const roles = recus.map((l) => l.find((m) => m.type === 'role'));
  t(`${etiquette} : une vraie nouvelle partie — manche 1, un seul intrus, scores à zéro`,
    roles.filter((x) => x.impostor).length === 1 && roles.every((x) => x.round === 1 && x.players.every((p) => p.score === 0)));
  t(`${etiquette} : aucune erreur affichée`, !(await texte(mj, 'error')).trim(), await texte(mj, 'error'));
}

try {
  srv = await serve();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qmreplay-'));
  edge = spawn(EDGE, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${dir}`, '--no-first-run',
    '--disable-features=BackForwardCache', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank'], { stdio: 'ignore' });
  cdp = await cdpBrowser();
  const BASE = `http://127.0.0.1:${HTTP_PORT}`;
  const DIRECT = `${BASE}/games/quiment/?server=${encodeURIComponent(QM)}`;
  console.log(`\n« Rejouer » — HORS Hub, trois navigateurs (${REDUCED ? 'mouvement RÉDUIT' : 'mouvement normal'})\n`);

  // ═══ 2. HORS HUB
  const A = await joueur('A'), B = await joueur('B'), C = await joueur('C');
  for (const [J, nom] of [[A, 'Alice'], [B, 'Bruno'], [C, 'Chloé']]) { await J.goto(DIRECT); await J.type('#name-input', nom); }
  await A.click('#host');
  await A.until(`${vu('lobby')} && /^[A-Z]{4}$/.test(document.getElementById('room-code').textContent.trim())`, 10000, 'room');
  const code = (await texte(A, 'room-code')).trim();
  for (const J of [B, C]) { await J.type('#code-input', code); await J.click('#join'); await J.until(vu('lobby'), 10000, `${J.nom} au salon`); }
  await A.until(`!document.getElementById('start').disabled`, 8000, '« Lancer » actif');
  await A.eval(`document.getElementById('rounds-select').value = '3'`);
  await A.click('#start');
  for (const J of [A, B, C]) await J.until(vu('play'), 10000, `partie 1 chez ${J.nom}`);
  await jusquAuClassement(A, [A, B, C]);
  t('hors Hub : une partie complète, classement chez les trois', true);
  t('hors Hub : « Rejouer » n\'est proposé qu\'au MJ', (await A.eval(vu('again'))) && !(await B.eval(vu('again'))) && !(await C.eval(vu('again'))));
  await rejouer(A, [A, B, C], code, 'hors Hub, 1er rejouer');

  // Deuxième fois : la même mécanique, de nouveau jusqu'au bout.
  await jusquAuClassement(A, [A, B, C]);
  t('hors Hub : la partie rejouée va elle aussi jusqu\'au classement', true);
  t('hors Hub : « Rejouer » est de nouveau actif', await A.eval(`${vu('again')} && !document.getElementById('again').disabled`));
  await rejouer(A, [A, B, C], code, 'hors Hub, 2e rejouer');

  // Troisième fois, avec un joueur parti : le salon retrouvé doit être VALIDE.
  await jusquAuClassement(A, [A, B, C]);
  await C.navigate('about:blank');
  await A.until(`document.querySelectorAll('#ranking .rank-row').length >= 2`, 5000, 'classement');
  await sleep(500);
  const eMj = A.envoye.length;
  await A.click('#again');
  await A.until(`${vu('lobby')} && /au moins 3 joueurs/.test(document.getElementById('error').textContent)`, 10000, 'salon à 2');
  const sal = await A.eval(`({ n: document.querySelectorAll('#players .g-player').length, off: document.getElementById('start').disabled,
    code: document.getElementById('room-code').textContent.trim(), manque: document.getElementById('need-players').textContent })`);
  t('rejouer à 2 : le serveur refuse le `start` (« il faut au moins 3 joueurs »), les deux restent au SALON de la même room',
    sal.n === 2 && sal.off && sal.code === code && /3 joueurs/.test(sal.manque) && (await B.eval(vu('lobby'))), JSON.stringify(sal));
  t('rejouer à 2 : toujours un seul `lobby` et un seul `start` envoyés',
    JSON.stringify(A.envoye.slice(eMj).filter((x) => x.qui === 'qm').map((x) => x.d.action)) === '["lobby","start"]');
  const D = await joueur('D');
  await D.goto(DIRECT);
  await D.type('#name-input', 'Dora');
  await D.type('#code-input', code);
  await D.click('#join');
  await D.until(vu('lobby'), 10000, 'Dora au salon');
  await A.until(`document.querySelectorAll('#players .g-player').length === 3 && !document.getElementById('start').disabled`, 8000, '« Lancer » actif à 3');
  t('le salon retrouvé est ouvert : un nouveau joueur y entre par le code, « Lancer » se réactive', true);
  await A.click('#start');
  for (const J of [A, B, D]) await J.until(`${vu('play')} && document.getElementById('round-num').textContent === '1'`, 10000, `partie 4 chez ${J.nom}`);
  t('et la partie repart à trois (A, B, Dora)', true);
  const errs = [A, B, C, D].flatMap((J) => J.erreurs.map((e) => `[${J.nom}] ${e}`));
  t('aucune erreur JS hors Hub', errs.length === 0, errs.slice(0, 3).join(' | '));

  // ═══ 3. VIA LE HUB
  console.log('\n« Rejouer » — via le Game Hub, trois navigateurs\n');
  const PAGE = `${BASE}/games/?hub=${encodeURIComponent(HUB)}`;
  const [HA, HB, HC] = [await joueur('HA'), await joueur('HB'), await joueur('HC')];
  await HA.goto(PAGE);
  await HA.type('#name-input', 'Hélène');
  await HA.click('#identity-done');
  await HA.click('#hub-create');
  await HA.until(`!document.getElementById('lobby').hidden`, 20000, 'salon Hub');
  const sess = (await texte(HA, 'hub-code')).trim();
  for (const [J, nom] of [[HB, 'Hugo'], [HC, 'Hana']]) {
    await J.goto(PAGE); await J.type('#name-input', nom); await J.click('#identity-done');
    await J.type('#hub-code-input', sess); await J.click('#hub-join');
  }
  for (const J of [HA, HB, HC]) await J.until(`document.querySelectorAll('#hub-players .hub-card').length === 3`, 20000, `${J.nom} au Hub`);
  for (const id of AUTRES) await HB.click(`#hub-games [data-pref=veto][data-game=${id}]`);
  await HA.until(`[...document.querySelectorAll('#hub-games .hub-game[data-eligible=true]')].map((x) => x.dataset.game).join() === 'quiment'`, 8000, 'seul Qui Ment ?');
  await HA.click('#hub-draw-btn');
  await HA.until(`document.getElementById('hub-result').dataset.game === 'quiment' && !document.getElementById('hub-continue').hidden`, 15000, 'tirage');
  await HA.immobile('#hub-continue');
  await HA.click('#hub-continue');
  await HA.until(`!document.getElementById('launch-go').hidden`, 8000, 'Ouvrir');
  await HA.immobile('#launch-go');
  await HA.click('#launch-go');
  await HA.until(`location.pathname === '/games/quiment/' && ${vu('lobby')} && /^[A-Z]{4}$/.test(document.getElementById('room-code').textContent.trim())`, 20000, 'room Hub');
  const room = (await texte(HA, 'room-code')).trim();
  for (const J of [HB, HC]) {
    await J.until(`!document.getElementById('launch-go').hidden && /Rejoindre/.test(document.getElementById('launch-go').textContent)`, 10000, `Rejoindre chez ${J.nom}`);
    await J.immobile('#launch-go');
    await J.click('#launch-go');
    await J.until(`location.pathname === '/games/quiment/' && ${vu('lobby')}`, 20000, `${J.nom} dans la room`);
  }
  await HA.until(`!document.getElementById('start').disabled`, 10000, '« Lancer » via Hub');
  await HA.eval(`document.getElementById('rounds-select').value = '3'`);
  await HA.click('#start');
  for (const J of [HA, HB, HC]) await J.until(vu('play'), 10000, `partie Hub chez ${J.nom}`);
  await jusquAuClassement(HA, [HA, HB, HC]);
  for (const J of [HA, HB, HC]) await J.until(vu('to-hub'), 8000, `retour Hub proposé chez ${J.nom}`);
  const hubSess = () => { for (let i = HB.recu.length - 1; i >= 0; i--) if (HB.recu[i].d.session) return HB.recu[i].d.session; return null; };
  const fin = Date.now() + 8000;
  while (Date.now() < fin && !(hubSess() && hubSess().state === 'debrief')) await sleep(50);
  const avant = hubSess();
  t('via Hub : partie complète, « Retour au Game Hub » proposé, le Hub en debrief',
    !!avant && avant.state === 'debrief' && avant.launch.stage === 'ended' && avant.history.played.length === 1, avant && avant.state);
  const health0 = await (await fetch(`http://127.0.0.1:${HUB_PORT}/health`)).json();
  const eHub = [HA, HB, HC].map((J) => J.envoye.length);
  await rejouer(HA, [HA, HB, HC], room, 'via Hub');
  // Le Hub n'a rien à faire d'une revanche dans la même room : comme Le Passeur,
  // la page ne lui envoie rien (ni launched, ni started, ni entered, ni ended).
  const versHub = [HA, HB, HC].flatMap((J, i) => J.envoye.slice(eHub[i]).filter((x) => x.qui === 'hub').map((x) => x.d.action));
  t('via Hub : « Rejouer » ne parle PAS au Hub (aucun launched/started/entered/ended)',
    !versHub.some((a) => ['launched', 'started', 'entered', 'ended', 'create', 'join'].includes(a)), JSON.stringify(versHub));
  await jusquAuClassement(HA, [HA, HB, HC]);
  for (const J of [HA, HB, HC]) await J.until(vu('to-hub'), 8000, `retour Hub (2) chez ${J.nom}`);
  await sleep(500);
  const apres = hubSess();
  const health1 = await (await fetch(`http://127.0.0.1:${HUB_PORT}/health`)).json();
  t('via Hub : la revanche finie, « Retour au Game Hub » toujours proposé', true);
  t('via Hub : toujours UNE session Hub, les mêmes 3 joueurs (pas de session fantôme)',
    health0.sessions === 1 && health1.sessions === 1 && health1.players === 3, `${health0.sessions} → ${health1.sessions} session(s), ${health1.players} joueurs`);
  t('via Hub : le Hub reste en debrief sur le même lancement, historique inchangé',
    apres.state === 'debrief' && apres.launch.drawId === avant.launch.drawId && apres.history.played.length === 1, `${apres.state}, ${JSON.stringify(apres.history.played)}`);
  await HB.click('#to-hub');
  await HB.until(`location.pathname === '/games/' && !document.getElementById('lobby').hidden`, 15000, 'retour Hub HB');
  t('via Hub : « Retour au Game Hub » ramène au salon de la même session', (await texte(HB, 'hub-code')).trim() === sess);
  const errs2 = [HA, HB, HC].flatMap((J) => J.erreurs.map((e) => `[${J.nom}] ${e}`));
  t('aucune erreur JS via Hub', errs2.length === 0, errs2.slice(0, 3).join(' | '));
} catch (e) {
  t('EXCEPTION (navigateurs)', false, e.message);
  for (const J of joueurs) {
    const etat = await J.eval(`location.href + ' | erreur : ' + ((document.getElementById('error') || document.getElementById('hub-error') || {}).textContent || '')`).catch((x) => x.message);
    console.log(`     [${J.nom}] ${etat}${J.erreurs.length ? ' | JS : ' + J.erreurs.join(' / ') : ''}`);
  }
} finally {
  stop();
}
console.log(`\n${ko ? 'DES TESTS ÉCHOUENT' : 'TOUT PASSE'} — ${out.length} vérifications, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
