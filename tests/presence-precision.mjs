// Présence du joueur — le pilote Précision, dans de VRAIS navigateurs.
//
//   node tests/presence-precision.mjs
//   node tests/presence-precision.mjs --precision <dossier>   un autre precision-server (contre-épreuve : celui d'avant la présence)
//
// Le bug : un onglet GELÉ par le navigateur (arrière-plan, écran verrouillé,
// changement d'application) gardait son WebSocket ouvert côté serveur. Il
// restait compté dans sa room, l'hôte lançait avec un fantôme, et au réveil la
// page affichait un salon périmé.
//
// Le correctif : precision-server/src/presence.js (présence applicative) +
// games/shared/game-net.js (réponse, détection de la perte, événement `lost`).
//
// ⚠️ AUCUNE des options d'Edge qui masquaient le problème ici
// (--disable-renderer-backgrounding, --disable-background-timer-throttling,
// --disable-features=BackForwardCache…). Le gel est celui du navigateur, piloté
// par le protocole DevTools (Page.setWebLifecycleState) : la page ne fait plus
// tourner son JavaScript, exactement comme un onglet mis en veille.
//
// Le vrai precision-server, avec des délais courts : présence toutes les 1 s,
// absent après 3 s. Un petit proxy TCP simule une coupure réseau franche : les
// connexions existantes tombent dans un trou noir, les nouvelles passent (un
// passage Wi-Fi → 4G).
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = () => Math.floor(Math.random() * 300);
const PR_PORT = 9000 + R(), PROXY_PORT = 9400 + R(), HUB_PORT = 8300 + R(), HEALTH_PORT = 6100 + R(), HTTP_PORT = 8700 + R(), CDP_PORT = 9700 + R();
// --production : les VRAIES valeurs de presence.js (aucune variable passée au
// serveur : ce sont ses défauts qui sont testés), 10 s / 30 s. Compter ~10 min.
const PROD = process.argv.includes('--production');
const PRESENCE_MS = PROD ? 10000 : 1000, ABSENCE_MS = PROD ? 30000 : 3000, KILL_MS = PROD ? 3000 : 1000;
const RETRAIT_MS = ABSENCE_MS + PRESENCE_MS + KILL_MS + 2000;   // délai maximal de retrait d'un absent
const SILENCE_MS = ABSENCE_MS + 2 * PRESENCE_MS;                // plus long que tout délai d'absence

let out = [], ko = 0;
const t = (nom, ok, detail = '') => {
  out.push(`${ok ? 'OK  ' : 'KO  '} ${nom}${detail ? ' — ' + detail : ''}`);
  if (!ok) ko++;
  console.log(out[out.length - 1]);
};

// --- serveurs ------------------------------------------------------------------
const procs = [];
const lance = (cwd, file, port, env = {}) => {
  const p = spawn(process.execPath, [file], { cwd, env: { ...process.env, PORT: String(port), HUB_QUIET: '1', PRESENCE_QUIET: '1', ...env }, stdio: 'ignore' });
  procs.push(p); return p;
};
async function attends(url) { for (let i = 0; i < 100; i++) { try { const r = await fetch(url); if (r.ok) return; } catch (_) {} await sleep(100); } throw new Error('injoignable : ' + url); }

const sante = await fakeHealth(HEALTH_PORT);
const MANIFEST = localManifest(ROOT, HEALTH_PORT, { precision: `http://127.0.0.1:${PR_PORT}/` });
lance(arg('--precision') || path.join(ROOT, '..', 'precision-server'), 'src/server.js', PR_PORT,
  PROD ? { LEAD_MS: '200' } : { PRESENCE_MS: String(PRESENCE_MS), ABSENCE_MS: String(ABSENCE_MS), NATIVE_PING_MS: '2000', PRESENCE_KILL_MS: String(KILL_MS), LEAD_MS: '200' });
lance(path.join(ROOT, '..', 'game-hub-server'), 'src/server.js', HUB_PORT, { MANIFEST_FILE: MANIFEST });
const HUB = `ws://127.0.0.1:${HUB_PORT}`, PR = `ws://127.0.0.1:${PR_PORT}`, PROXY = `ws://127.0.0.1:${PROXY_PORT}`;

// Proxy TCP : `couper()` fige les connexions EXISTANTES (plus un octet ne
// passe, dans aucun sens, et rien n'est fermé) ; les nouvelles passent.
const tuyaux = [];
const proxy = net.createServer((client) => {
  const amont = net.connect(PR_PORT, '127.0.0.1');
  const tuyau = { client, amont, coupe: false };
  client.on('data', (d) => { if (!tuyau.coupe) amont.write(d); });
  amont.on('data', (d) => { if (!tuyau.coupe) client.write(d); });
  const fin = () => { client.destroy(); amont.destroy(); };
  client.on('error', fin); amont.on('error', fin);
  client.on('close', () => { if (!tuyau.coupe) amont.destroy(); });
  amont.on('close', () => { if (!tuyau.coupe) client.destroy(); });
  tuyaux.push(tuyau);
});
await new Promise((r) => proxy.listen(PROXY_PORT, '127.0.0.1', r));
const couper = () => { for (const x of tuyaux) x.coupe = true; };

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json' };
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

// --- CDP ------------------------------------------------------------------------
let cdp = null;
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

const joueurs = [];
async function joueur(nom) {
  const { result: { browserContextId } } = await cdp.send('Target.createBrowserContext', { disposeOnDetach: true });
  const { result: { targetId } } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { result: { sessionId } } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const J = { nom, erreurs: [], recu: [], envoye: [] };
  joueurs.push(J);
  cdp.on(sessionId, (m) => {
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      J.erreurs.push((d.exception?.description || d.text || '').split('\n')[0]);
    }
    if (m.method === 'Network.webSocketFrameReceived') { try { J.recu.push(JSON.parse(m.params.response.payloadData)); } catch (_) {} }
    if (m.method === 'Network.webSocketFrameSent') { try { J.envoye.push(JSON.parse(m.params.response.payloadData)); } catch (_) {} }
  });
  const S = (m, p) => cdp.send(m, p, sessionId);
  await S('Runtime.enable'); await S('Page.enable'); await S('DOM.enable'); await S('Network.enable');
  await S('Emulation.setDeviceMetricsOverride', { width: 1100, height: 1000, deviceScaleFactor: 1, mobile: false });
  J.eval = async (expression) => {
    const r = await S('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(`[${nom}] ` + (r.result.exceptionDetails.exception?.description || 'erreur JS').split('\n')[0]);
    return r.result?.result?.value;
  };
  J.until = async (expr, ms = 10000, label = expr) => {
    const fin = Date.now() + ms;
    while (Date.now() < fin) { try { const v = await J.eval(expr); if (v) return v; } catch (_) {} await sleep(60); }
    throw new Error(`[${nom}] attente expirée : ${label}`);
  };
  J.goto = async (url) => { await S('Page.navigate', { url }); await J.until(`document.readyState === 'complete' && !!window.GameHub`, 15000, 'chargement ' + url); };
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
  J.gel = () => S('Page.setWebLifecycleState', { state: 'frozen' });
  J.reveil = () => S('Page.setWebLifecycleState', { state: 'active' });
  // Le prochain message du jeu (reçu) qui correspond, à partir de maintenant.
  J.marque = () => J.recu.length;
  J.apres = async (depuis, pred, ms = 10000, label = 'trame') => {
    const fin = Date.now() + ms;
    while (Date.now() < fin) { const m = J.recu.slice(depuis).find(pred); if (m) return m; await sleep(40); }
    throw new Error(`[${nom}] trame jamais reçue : ${label}`);
  };
  J.hub = () => { for (let i = J.recu.length - 1; i >= 0; i--) if (J.recu[i].session) return J.recu[i].session; return null; };
  // Journal des écrans visibles, tenu PAR LA PAGE (il tourne encore au réveil,
  // quand la page rattrape ses événements) : c'est lui qui dit si un faux salon
  // s'est affiché.
  J.journalEcrans = () => J.eval(`(() => {
    window.__ecrans = [];
    const noter = () => { const v = [...document.querySelectorAll('main > section')].filter((s) => !s.hidden).map((s) => s.id).join(',');
      if (window.__ecrans[window.__ecrans.length - 1] !== v) window.__ecrans.push(v); };
    new MutationObserver(noter).observe(document.querySelector('main'), { attributes: true, subtree: true, attributeFilter: ['hidden'] });
    noter();
    const h = NET.handlers.lost; window.__lost = [];
    NET.handlers.lost = (e) => { window.__lost.push({ raison: e.raison, veille: e.veille }); h(e); };
    return true; })()`);
  J.etat = () => J.eval(`({ ecran: [...document.querySelectorAll('main > section')].filter((s) => !s.hidden).map((s) => s.id).join(','),
    joueurs: document.querySelectorAll('#players li').length, ws: NET.ws ? NET.ws.readyState : -1, texte: document.getElementById('lost-text').textContent,
    retry: !document.getElementById('lost-retry').hidden, erreur: document.getElementById('error').textContent })`);
  return J;
}

const joins = (J, depuis) => J.envoye.slice(depuis).filter((m) => m.action === 'join').length;
// Une room reçue qui contient À LA FOIS l'ancienne et la nouvelle connexion du même joueur ?
const doublon = (J, depuis, ancien, nouveau) => J.recu.slice(depuis).some((m) => m.type === 'room'
  && m.players.some((p) => p.id === ancien) && m.players.some((p) => p.id === nouveau));
const maxJoueurs = (J, depuis) => Math.max(0, ...J.recu.slice(depuis).filter((m) => m.type === 'room').map((m) => m.players.length));
const nPlayers = (J) => J.eval(`document.querySelectorAll('#players li').length`);

// Une partie complète au bouton rond (voir handoff-precision.mjs).
async function partie(mj, tous) {
  for (let i = 0; i < 120; i++) {
    if (await mj.eval(`phase === 'end'`)) return;
    for (const J of tous) {
      if (await J.eval(`phase === 'play' && !submitted && document.getElementById('fab').dataset.mode === 'submit' && !document.getElementById('fab').hidden`)) await J.click('#fab');
    }
    if (await mj.eval(`phase === 'reveal' && document.getElementById('fab').dataset.mode === 'next'`)) await mj.click('#fab');
    await sleep(150);
  }
  throw new Error('la partie ne se termine pas');
}
const lancer = async (A) => {
  await A.eval(`document.getElementById('game-select').value = 'color'; document.getElementById('diff-select').value = 'impossible'; document.getElementById('rounds-select').value = '3'; true`);
  await A.click('#start');
};

let edge = null, srv = null, dir = null;
try {
  srv = await serve();
  await attends(`http://127.0.0.1:${PR_PORT}/`);
  await attends(`http://127.0.0.1:${HUB_PORT}/health`);
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'presence-'));
  // ⚠️ Volontairement AUCUNE option --disable-* de ralentissement ou de cache.
  edge = spawn(EDGE, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${dir}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  cdp = await cdpBrowser();
  const BASE = `http://127.0.0.1:${HTTP_PORT}`;
  const DIRECT = `${BASE}/games/precision/?server=${encodeURIComponent(PR)}`;
  console.log(`Présence — Précision (${PROD ? 'VALEURS DE PRODUCTION, défauts du serveur' : 'délais courts'} : présence ${PRESENCE_MS} ms, absent après ${ABSENCE_MS} ms), Edge sans options de contournement\n`);

  // ═══ 1. A + B dans une room
  const A = await joueur('A'), B = await joueur('B');
  for (const [J, nom] of [[A, 'Alice'], [B, 'Bruno']]) { await J.goto(DIRECT); await J.type('#name-input', nom); }
  await A.click('#host');
  await A.until(`!document.getElementById('lobby').hidden && /^[A-Z2-9]{4}$/.test(document.getElementById('room-code').textContent.trim())`, 10000, 'room de A');
  const code = (await A.eval(`document.getElementById('room-code').textContent`)).trim();
  await B.type('#code-input', code);
  await B.click('#join');
  await A.until(`document.querySelectorAll('#players li').length === 2`, 8000, 'B dans la room');
  await B.journalEcrans();
  t('A + B dans la même room', true, code);
  t('le serveur ouvre l\'échange de présence dès la connexion, la page répond', B.recu[0]?.type === 'presence' && B.envoye.some((m) => m.action === 'presence'));
  t('la page n\'envoie JAMAIS de présence d\'elle-même (seulement en réponse)',
    B.envoye.filter((m) => m.action === 'presence').every((m) => B.recu.some((r) => r.type === 'presence' && r.n === m.n)));
  t('les messages de présence ne parviennent jamais au jeu (aucune erreur, aucun écran)', (await B.etat()).erreur === '' && B.erreurs.length === 0);

  // ═══ 2. B actif mais silencieux : il reste présent
  const rep0 = B.envoye.filter((m) => m.action === 'presence').length;
  await sleep(SILENCE_MS);
  const s1 = await B.etat();
  t(`B actif, sans rien faire pendant ${SILENCE_MS / 1000} s : toujours présent (salon à 2 chez A et chez B)`,
    (await nPlayers(A)) === 2 && s1.joueurs === 2 && s1.ecran === 'lobby' && s1.ws === 1, `${B.envoye.filter((m) => m.action === 'presence').length - rep0} réponses de présence`);

  // ═══ 3. B gelé au salon → retiré, A voit la room à jour ; B se réveille → retour au salon
  const ancienB = [...B.recu].reverse().find((m) => m.type === 'room').you;
  let mA = A.marque();
  await B.gel();
  const t0 = Date.now();
  await A.apres(mA, (m) => m.type === 'room' && m.players.length === 1, RETRAIT_MS, 'room sans B');
  const d = Date.now() - t0;
  t(`B gelé : le serveur le retire et A reçoit la room à jour en ${(d / 1000).toFixed(1)} s (absent après ${ABSENCE_MS / 1000} s)`, d < ABSENCE_MS + PRESENCE_MS + 1500, `${d} ms`);
  await A.until(`document.querySelectorAll('#players li').length === 1`, 2000, 'DOM de A à 1');
  t('… l\'écran de A le montre aussitôt : 1 joueur', true);
  const jB = B.envoye.length;
  await B.reveil();
  await B.until(`!document.getElementById('lobby').hidden && document.querySelectorAll('#players li').length === 2 && NET.connected()`, 8000, 'B de retour au salon');
  const e3 = await B.eval('({ ecrans: window.__ecrans, lost: window.__lost })');
  const apresGel = e3.ecrans.slice(e3.ecrans.lastIndexOf('lobby') > 0 ? 1 : 0);
  t('réveil de B : il voit « connexion perdue » AVANT tout salon (jamais le salon périmé)',
    e3.ecrans.includes('lost') && e3.ecrans[e3.ecrans.indexOf('lost') - 1] === 'lobby' && e3.ecrans[e3.ecrans.length - 1] === 'lobby', JSON.stringify(e3.ecrans));
  t('`lost` émis UNE fois, perte signalée (veille : ' + (e3.lost[0] && e3.lost[0].veille) + ')', e3.lost.length === 1, JSON.stringify(e3.lost));
  t('… puis UN seul join, avec le même code : B revient dans LA room', joins(B, jB) === 1 && B.envoye.slice(jB).find((m) => m.action === 'join').code === code && (await nPlayers(A)) === 2);
  const nouveauB = [...B.recu].reverse().find((m) => m.type === 'room').you;
  t('… et A n\'a JAMAIS reçu de room avec l\'ancien ET le nouveau B (au plus 2 joueurs vus)',
    !doublon(A, mA, ancienB, nouveauB) && maxJoueurs(A, mA) <= 2, `${ancienB} → ${nouveauB}, max ${maxJoueurs(A, mA)}`);
  void apresGel;

  // ═══ 4. B gelé, A lance sans lui ; au réveil, B est prévenu, sans boucle
  await B.journalEcrans();
  mA = A.marque();
  await B.gel();
  await A.apres(mA, (m) => m.type === 'room' && m.players.length === 1, RETRAIT_MS, 'room sans B (2)');
  await A.until(`document.querySelectorAll('#players li').length === 1`, 2000, 'DOM de A à 1 (2)');
  const mA2 = A.marque();
  await lancer(A);
  const rev = await A.apres(mA2, (m) => m.type === 'phase' && m.phase === 'reveal', 15000, 'reveal');
  // (la validation automatique ou un clic : peu importe, on regarde le serveur)
  t('A lance : la partie démarre SANS B (révélation calculée pour 1 joueur)', rev.results.length === 1 && rev.results[0].name === 'Alice');
  const jB2 = B.envoye.length;
  await B.reveil();
  await B.until(`/partie en cours/.test(document.getElementById('lost-text').textContent)`, 8000, 'refus du retour');
  await sleep(2000);
  const s4 = await B.etat();
  t('réveil pendant la partie de A : « connexion perdue », retour refusé et EXPLIQUÉ (« partie en cours »)',
    s4.ecran === 'lost' && /Impossible de revenir dans le salon : partie en cours/.test(s4.texte) && s4.retry, s4.texte);
  t('… UNE seule tentative automatique, pas de boucle', joins(B, jB2) === 1, `${joins(B, jB2)} join(s)`);
  await partie(A, [A]);
  await B.click('#lost-retry');
  await B.until(`!document.getElementById('lobby').hidden && document.querySelectorAll('#players li').length === 2`, 8000, 'retour manuel');
  t('la partie finie, « Revenir dans le salon » ramène B dans la room', (await nPlayers(A)) === 2);

  // ═══ 5. B gelé EN PLEINE PARTIE : pas de reprise, on le dit
  await A.click('#fab');                                       // podium → salon
  await A.until(`!document.getElementById('lobby').hidden`, 5000, 'A au salon');
  await B.journalEcrans();
  const mA3 = A.marque();
  await lancer(A);
  await B.until(`phase === 'memorize' || phase === 'play'`, 8000, 'B en partie');
  await B.gel();
  await A.apres(mA3, (m) => m.type === 'room' && m.players.length === 1, RETRAIT_MS, 'B retiré en partie');
  t('B gelé en pleine partie : retiré par le serveur, la partie continue pour A', true);
  const jB3 = B.envoye.length;
  await B.reveil();
  await B.until(`!document.getElementById('lost').hidden`, 8000, 'écran perdu (partie)');
  await sleep(1500);
  const s5 = await B.etat();
  t('réveil : « la partie a continué sans toi », aucune tentative de reprise', /continué sans toi/.test(s5.texte) && joins(B, jB3) === 0 && s5.retry, s5.texte);
  t('… et plus rien du jeu à l\'écran : ni plateau, ni salon périmé', s5.ecran === 'lost');
  await partie(A, [A]);
  await B.click('#lost-retry');
  await B.until(`!document.getElementById('lobby').hidden && document.querySelectorAll('#players li').length === 2`, 8000, 'retour après la partie');
  t('fin de la partie de A : B revient dans le salon au bouton', true);
  await A.click('#fab');
  await A.until(`!document.getElementById('lobby').hidden`, 5000, 'A au salon (2)');

  // ═══ 6. un ANCIEN client, qui ignore la présence : jamais expulsé
  const vieux = new WebSocket(PR);
  await new Promise((r) => { vieux.onopen = r; });
  vieux.send(JSON.stringify({ action: 'join', name: 'Ancien', code, avatar: { kind: 'emoji', emoji: '🐢' } }));
  await A.until(`document.querySelectorAll('#players li').length === 3`, 5000, 'ancien client dans la room');
  await sleep(SILENCE_MS);
  t(`ancien client (aucune réponse de présence), ${SILENCE_MS / 1000} s plus tard : toujours dans la room`, (await nPlayers(A)) === 3 && vieux.readyState === 1);
  vieux.close();
  await A.until(`document.querySelectorAll('#players li').length === 2`, 5000, 'départ de l\'ancien');

  // ═══ 7. coupure réseau franche : C passe par le proxy, le réseau « tombe »
  const C = await joueur('C');
  await C.goto(`${BASE}/games/precision/?server=${encodeURIComponent(PROXY)}`);
  await C.type('#name-input', 'Chloé');
  await C.type('#code-input', code);
  await C.click('#join');
  await A.until(`document.querySelectorAll('#players li').length === 3`, 8000, 'C dans la room');
  await C.journalEcrans();
  await sleep(2 * PRESENCE_MS + 500);                          // le chien de garde de C s'arme (2 pings périodiques)
  const ancienC = [...C.recu].reverse().find((m) => m.type === 'room').you;
  const mA4 = A.marque(), jC = C.envoye.length;
  couper();
  const t1 = Date.now();
  // C détecte la coupure (3,5 périodes) et revient par une nouvelle connexion,
  // parfois AVANT que le serveur n'ait fini de couper l'ancienne (absent +
  // fermeture impossible + terminate). Sans remplacement, la room passait
  // brièvement par « ancien C + nouveau C ». Désormais la nouvelle connexion
  // fait fermer l'ancienne AVANT d'envoyer son join.
  const sansAncien = await A.apres(mA4, (m) => m.type === 'room' && !m.players.some((p) => p.id === ancienC), RETRAIT_MS + 2000, 'ancien C retiré');
  t(`coupure franche : l'ancienne connexion de C est retirée en ${((Date.now() - t1) / 1000).toFixed(1)} s`, !!sansAncien);
  await C.until(`window.__lost && window.__lost.length === 1`, RETRAIT_MS, 'C détecte la perte');
  const lostC = await C.eval('window.__lost[0]');
  t('… et la page de C le détecte d\'elle-même : `lost` pour SILENCE (aucune fermeture ne lui est parvenue)', lostC.raison === 'silence', JSON.stringify(lostC));
  await C.until(`!document.getElementById('lobby').hidden && NET.connected()`, 10000, 'C de retour');
  await A.until(`document.querySelectorAll('#players li').length === 3`, 8000, 'room à 3 (A, B, nouveau C)');
  const nouveauC = [...C.recu].reverse().find((m) => m.type === 'room').you;
  const finale = [...A.recu].reverse().find((m) => m.type === 'room');
  t('… puis C revient seul dans la room par une NOUVELLE connexion (un seul join), sans doublon au final',
    joins(C, jC) === 1 && nouveauC !== ancienC && finale.players.length === 3 && !finale.players.some((p) => p.id === ancienC)
    && finale.players.filter((p) => p.name === 'Chloé').length === 1, `${ancienC} → ${nouveauC}`);
  t('… et A n\'a JAMAIS reçu de room avec l\'ancien ET le nouveau C (au plus 3 joueurs vus) : aucun doublon, même un instant',
    !doublon(A, mA4, ancienC, nouveauC) && maxJoueurs(A, mA4) <= 3, `max ${maxJoueurs(A, mA4)}`);
  const remp = C.envoye.slice(jC).find((m) => m.action === 'presence' && m.remplace);
  const iRemp = C.envoye.indexOf(remp), iJoin = C.envoye.findIndex((m, i) => i >= jC && m.action === 'join');
  t('… car la nouvelle connexion a demandé le remplacement de l\'ancienne AVANT son join', !!remp && iRemp < iJoin, `remplace @${iRemp}, join @${iJoin}`);

  const errs = [A, B, C].flatMap((J) => J.erreurs.map((e) => `[${J.nom}] ${e}`));
  t('aucune erreur JS', errs.length === 0, errs.slice(0, 3).join(' | '));

  // ═══ 8. Game Hub : un invité gelé au salon du jeu, puis de retour
  console.log('\n— avec le Game Hub —');
  const PAGE = `${BASE}/games/?hub=${encodeURIComponent(HUB)}`;
  const H = await joueur('H'), G = await joueur('G'), K = await joueur('K');
  await H.goto(PAGE); await H.type('#name-input', 'Hélène'); await H.click('#identity-done'); await H.click('#hub-create');
  await H.until(`!document.getElementById('lobby').hidden`, 20000, 'salon Hub');
  const hcode = (await H.eval(`document.getElementById('hub-code').textContent`)).trim();
  for (const [J, nom] of [[G, 'Gabin'], [K, 'Karim']]) { await J.goto(PAGE); await J.type('#name-input', nom); await J.click('#identity-done'); await J.type('#hub-code-input', hcode); await J.click('#hub-join'); }
  await H.until(`document.querySelectorAll('#hub-players .hub-card').length === 3`, 20000, '3 au Hub');
  for (const id of ['imitation', 'demicercle', 'ban', 'passeur', 'quiment']) await G.click(`#hub-games [data-pref=veto][data-game=${id}]`);
  await H.until(`[...document.querySelectorAll('#hub-games .hub-game[data-eligible=true]')].map((x) => x.dataset.game).join() === 'precision'`, 8000, 'seule Précision');
  await H.click('#hub-draw-btn');
  await H.until(`document.getElementById('hub-result').dataset.game === 'precision' && !document.getElementById('hub-continue').hidden`, 15000, 'révélation');
  await H.immobile('#hub-continue'); await H.click('#hub-continue');
  await H.until(`!document.getElementById('hub-launch').hidden && !document.getElementById('launch-go').hidden`, 8000, 'Ouvrir');
  await H.immobile('#launch-go'); await H.click('#launch-go');
  await H.until(`location.pathname === '/games/precision/' && !document.getElementById('lobby').hidden && /^[A-Z2-9]{4}$/.test(document.getElementById('room-code').textContent.trim())`, 20000, 'room du lancement');
  await G.until(`!document.getElementById('launch-go').hidden && /Rejoindre/.test(document.getElementById('launch-go').textContent)`, 10000, 'Rejoindre');
  await G.immobile('#launch-go'); await G.click('#launch-go');
  await G.until(`location.pathname === '/games/precision/' && !document.getElementById('lobby').hidden && document.querySelectorAll('#players li').length === 2`, 20000, 'G dans la room');
  await G.journalEcrans();
  const mH = H.marque();
  await G.gel();
  await H.apres(mH, (m) => m.type === 'room' && m.players.length === 1, RETRAIT_MS, 'G retiré');
  const jG = G.envoye.length;
  await G.reveil();
  await G.until(`!document.getElementById('lobby').hidden && document.querySelectorAll('#players li').length === 2 && NET.connected()`, 8000, 'G de retour');
  const hubG = G.hub();
  t('Hub : invité gelé au salon du jeu → retiré, puis de retour dans LA room (un join), le lancement suit son cours',
    joins(G, jG) === 1 && hubG && hubG.launch && hubG.launch.stage === 'join' && hubG.launch.entered.length === 2 && !Object.keys(hubG.launch.failed).length,
    hubG && JSON.stringify({ stage: hubG.launch.stage, entered: hubG.launch.entered.length, failed: hubG.launch.failed }));
  t('… sans nouvelle annonce du code au Hub (codeDeclare)', await G.eval(`typeof codeDeclare === 'string'`));

  // ═══ 9. Game Hub : l'HÔTE du lancement, seul dans sa room, gelé (diagnostic)
  // Il crée la partie puis change d'application (pour envoyer le code…). Seul
  // dans la room, son départ la supprime. Que devient le groupe ?
  await H.journalEcrans();
  // G quitte VRAIMENT la page (fermer son socket ne suffit pas : la page
  // reviendrait toute seule dans le salon, c'est tout l'objet du correctif).
  // Quitter la page doit retirer le joueur TOUT DE SUITE (game-net.js ferme
  // son socket au pagehide) — sans ça, gardée en cache par le navigateur,
  // la page restait un fantôme jusqu'à l'absence (30 s en production).
  const tQuitte = Date.now();
  await G.eval(`location.href = 'about:blank'; true`).catch(() => {});
  await H.until(`document.querySelectorAll('#players li').length === 1`, 3000, 'H seul (G a quitté la page)');
  t(`G quitte la page du jeu : retiré de la room en ${((Date.now() - tQuitte) / 1000).toFixed(1)} s, sans attendre l'absence`, Date.now() - tQuitte < 3000);
  await H.gel();
  await sleep(ABSENCE_MS + PRESENCE_MS + 1500);
  await H.reveil();
  await H.until(`!document.getElementById('lost').hidden && /Impossible de revenir/.test(document.getElementById('lost-text').textContent)`, 8000, 'H : room disparue');
  const tH = Date.now();
  let hubK = K.hub();
  while (Date.now() - tH < 5000 && !(hubK && hubK.state === 'lobby')) { await sleep(100); hubK = K.hub(); }
  const sH = await H.eval(`({ texte: document.getElementById('lost-text').textContent, hub: !document.getElementById('lost-hub').hidden })`);
  console.log(`     DIAGNOSTIC hôte seul gelé : page de H = « ${sH.texte} » ; Hub vu par K : stage=${hubK && hubK.launch && hubK.launch.stage}, roomCode=${hubK && hubK.launch && hubK.launch.roomCode}, state=${hubK && hubK.state}`);
  t('hôte seul gelé : sa page le dit (room disparue) et propose le retour au Game Hub', /room introuvable/.test(sH.texte) && sH.hub, sH.texte);
  t(`… et le Hub ne laisse pas le groupe attendre une room morte : lancement annulé, tout le monde au salon du Hub (${((Date.now() - tH) / 1000).toFixed(1)} s, au lieu de 120 s)`,
    !!hubK && hubK.state === 'lobby' && hubK.launch && hubK.launch.stage === 'failed' && hubK.launch.reason === 'CANCELLED', hubK && `${hubK.state} / ${hubK.launch && hubK.launch.stage} / ${hubK.launch && hubK.launch.reason}`);
  await K.until(`!document.getElementById('hub-failed').hidden`, 5000, 'message chez K');
  t('… K le lit au Hub, et l\'hôte peut retirer', /annulé/.test(await K.eval(`document.getElementById('hub-failed').textContent`)), await K.eval(`document.getElementById('hub-failed').textContent`));

  const errs2 = [H, G, K].flatMap((J) => J.erreurs.map((e) => `[${J.nom}] ${e}`));
  t('aucune erreur JS (Hub)', errs2.length === 0, errs2.slice(0, 3).join(' | '));
} catch (e) {
  t('EXCEPTION', false, e.message);
  for (const J of joueurs) {
    const etat = await J.eval(`location.href + ' | ' + JSON.stringify({ ecran: [...document.querySelectorAll('main > section')].filter((s) => !s.hidden).map((s) => s.id).join(','), texte: (document.getElementById('lost-text') || {}).textContent, erreur: (document.getElementById('error') || {}).textContent, ecrans: window.__ecrans })`).catch((x) => x.message);
    console.log(`     [${J.nom}] ${etat}${J.erreurs.length ? ' | JS : ' + J.erreurs.join(' / ') : ''}`);
  }
} finally {
  if (edge) { try { execFileSync('taskkill', ['/PID', String(edge.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (_) { try { edge.kill(); } catch (__) {} } }
  procs.forEach((p) => { try { p.kill(); } catch (_) {} });
  try { cdp && cdp.close(); } catch (_) {}
  try { srv && srv.close(); } catch (_) {}
  try { proxy.close(); tuyaux.forEach((x) => { x.client.destroy(); x.amont.destroy(); }); } catch (_) {}
  sante.close();
  if (dir) try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  try { fs.unlinkSync(MANIFEST); } catch (_) {}
}
console.log(`\n${ko ? 'DES TESTS ÉCHOUENT' : 'TOUT PASSE'} — ${out.length} vérifications, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
