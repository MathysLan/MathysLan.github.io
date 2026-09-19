// Handoff Hub → Le Passeur dans de VRAIS navigateurs, trois joueurs isolés,
// jusqu'au bout d'une vraie partie.
//
//   node tests/handoff-play.mjs                 Hub + Passeur lancés en local
//   node tests/handoff-play.mjs --reduced       même parcours en mouvement réduit
//   node tests/handoff-play.mjs --shots <dir>   une capture par étape
//
// A (vraie photo), B et C (emoji), trois contextes isolés. Le parcours :
//   portfolio → clic sur l'entrée Game Hub → /games/ → A crée, B et C
//   rejoignent → B ne laisse que Le Passeur (vetos) → A tire → révélation →
//   A « Continuer — lancer » → A « Ouvrir Le Passeur » (même onglet) → la page
//   du Passeur crée la room toute seule et en déclare le code au Hub → B
//   RECHARGE /games/ pendant le lancement (même player.id, même bouton) → B et
//   C « Rejoindre » → une seule room, trois joueurs → A lance → manches jouées
//   au clavier → classement → retour au Hub (debrief).
//
// ⚠️ LA VÉRITÉ EST DANS LES TRAMES : celles du Hub (état de session) et celles
// de passeur-server (you, lobby, round, results, end), lues sur chaque page par
// le protocole DevTools, puis comparées au DOM.
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
const SHOTS = arg('--shots');
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const R = () => Math.floor(Math.random() * 300);
const HTTP_PORT = 8700 + R(), CDP_PORT = 9700 + R(), HUB_PORT = 8100 + R(), PASSEUR_PORT = 8500 + R(), HEALTH_PORT = 6400 + R();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let out = [], ko = 0;
const t = (nom, ok, detail = '') => {
  out.push(`${ok ? 'OK  ' : 'KO  '} ${nom}${detail ? ' — ' + detail : ''}`);
  if (!ok) ko++;
  console.log(out[out.length - 1]);
};

// --- serveurs -------------------------------------------------------------------
const HUB = `ws://127.0.0.1:${HUB_PORT}`, PASSEUR = `ws://127.0.0.1:${PASSEUR_PORT}`;
const procs = [];
const lance = (cwd, file, port, env = {}) => {
  const p = spawn(process.execPath, [file], { cwd, env: { ...process.env, PORT: String(port), HUB_QUIET: '1', ...env }, stdio: 'ignore' });
  procs.push(p); return p;
};
async function attends(url) { for (let i = 0; i < 100; i++) { try { const r = await fetch(url); if (r.ok) return; } catch (_) {} await sleep(100); } throw new Error('injoignable : ' + url); }

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json' };
// Le site tel quel, avec DEUX redirections propres au test : les liens réels
// (`games/` depuis la home, `games/passeur/` depuis le Hub) n'ont pas de
// `?hub=` / `?server=` — ils iraient en production. On les redirige vers les
// serveurs locaux ; les liens eux-mêmes ne changent pas.
function serve() {
  const srv = createServer((req, res) => {
    const [p0, q] = req.url.split('?');
    if (p0 === '/games/' && !/(^|&)hub=/.test(q || '')) { res.writeHead(302, { Location: `/games/?hub=${encodeURIComponent(HUB)}` }); return res.end(); }
    if (p0 === '/games/passeur/' && !/(^|&)server=/.test(q || '')) { res.writeHead(302, { Location: `/games/passeur/?server=${encodeURIComponent(PASSEUR)}` }); return res.end(); }
    let p = decodeURIComponent(p0);
    if (p.endsWith('/')) p += 'index.html';
    const full = path.join(ROOT, p);
    if (!full.startsWith(ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
    res.end(fs.readFileSync(full));
  });
  return new Promise((r) => srv.listen(HTTP_PORT, '127.0.0.1', () => r(srv)));
}

// --- CDP ------------------------------------------------------------------------
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
  const J = { nom, erreurs: [], trames: [] };
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
  J.reload = async () => { await S('Page.reload', {}); await sleep(300); await J.until(`document.readyState === 'complete' && !!window.GameHub`, 15000, 'rechargement'); };
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
  // Une vraie touche (le Passeur se joue aussi au clavier, 1 à 5).
  J.key = async (k) => {
    for (const type of ['rawKeyDown', 'keyUp']) await S('Input.dispatchKeyEvent', { type, key: k, code: 'Digit' + k, windowsVirtualKeyCode: 48 + Number(k) });
    await sleep(40);
  };
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
  // Trames du Hub (elles portent `session`) et du Passeur (types du jeu).
  J.hub = () => { for (let i = J.trames.length - 1; i >= 0; i--) if (J.trames[i].session) return J.trames[i].session; return null; };
  J.jeu = (type) => [...J.trames].reverse().find((m) => m.type === type && !m.session) || null;
  J.attendsTrame = async (pred, ms = 10000, label = 'trame') => {
    const fin = Date.now() + ms;
    while (Date.now() < fin) { const m = [...J.trames].reverse().find(pred); if (m) return m; await sleep(50); }
    throw new Error(`[${nom}] trame jamais reçue : ${label}`);
  };
  return J;
}

// Mesure de mise en page commune : aucun débordement, éléments visibles.
const MISE = (ids) => `(() => {
  const vis = (id) => { const e = document.getElementById(id); if (!e || e.hidden || !e.offsetParent) return null; const r = e.getBoundingClientRect(); return r.left >= -1 && r.right <= innerWidth + 1 && r.width > 0; };
  return { over: document.documentElement.scrollWidth - innerWidth, vis: Object.fromEntries(${JSON.stringify(ids)}.map((id) => [id, vis(id)])) }; })()`;

// --- orchestration ----------------------------------------------------------------
const sante = await fakeHealth(HEALTH_PORT);
const MANIFEST = localManifest(ROOT, HEALTH_PORT, { passeur: `http://127.0.0.1:${PASSEUR_PORT}/` });
lance(path.join(ROOT, '..', 'passeur-server'), 'server.js', PASSEUR_PORT);
lance(path.join(ROOT, '..', 'game-hub-server'), 'src/server.js', HUB_PORT, { MANIFEST_FILE: MANIFEST });
const srv = await serve();
await attends(`http://127.0.0.1:${PASSEUR_PORT}/`);
await attends(`http://127.0.0.1:${HUB_PORT}/health`);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'handoffplay-'));
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${dir}`, '--no-first-run',
  '--disable-features=BackForwardCache', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank'], { stdio: 'ignore' });
let cdp = null;
const stop = () => {
  try { execFileSync('taskkill', ['/PID', String(edge.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (_) { try { edge.kill(); } catch (__) {} }
  procs.forEach((p) => { try { p.kill(); } catch (_) {} });
  try { cdp && cdp.close(); } catch (_) {}
  try { srv.close(); } catch (_) {}
  sante.close();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  try { fs.unlinkSync(MANIFEST); } catch (_) {}
};

console.log(`Handoff Hub → Le Passeur — trois navigateurs (${REDUCED ? 'mouvement RÉDUIT' : 'mouvement normal'})\n`);
const BASE = `http://127.0.0.1:${HTTP_PORT}`;
const PAGE = `${BASE}/games/?hub=${encodeURIComponent(HUB)}`;
const surPasseur = `location.pathname === '/games/passeur/' && document.readyState === 'complete'`;

try {
  cdp = await cdpBrowser();
  const A = await joueur(cdp, 'A'), B = await joueur(cdp, 'B'), C = await joueur(cdp, 'C');

  // ═══ 1. portfolio → Game Hub, profils, session
  await A.navigate(BASE + '/');
  await A.until(`document.readyState === 'complete' && !!document.getElementById('hub-link')`, 15000, 'home');
  await A.click('#hub-link');
  await A.until(`location.pathname === '/games/' && !!window.GameHub && !!window.HubHandoff`, 15000, '/games/');
  t('portfolio → clic sur l\'entrée Game Hub → /games/', true);
  await A.type('#name-input', 'Alice');
  await A.upload('#gp-file', path.join(ROOT, 'assets', 'og-image.png'));
  await A.until(`GameProfile.load().avatar.kind === 'image'`, 8000, 'photo de A');
  await A.click('#identity-done');
  const srcA = await A.eval(`GameProfile.load().avatar.src`);
  const idA = await A.eval(`GameProfile.load().id`);
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
  for (const J of [A, B, C]) await J.until(`document.querySelectorAll('#hub-players .hub-card').length === 3 && document.querySelectorAll('#hub-games .hub-game').length === 8`, 20000, `${J.nom} au salon`);
  const idB = await B.eval(`GameProfile.load().id`);
  t('A crée, B et C rejoignent : trois joueurs au salon', true, code);

  // B ne laisse que Le Passeur : ses vetos, par les vrais boutons.
  for (const id of ['demicercle', 'precision', 'quiment']) await B.click(`#hub-games [data-pref=veto][data-game=${id}]`);
  await A.until(`[...document.querySelectorAll('#hub-games .hub-game[data-eligible=true]')].map((x) => x.dataset.game).join() === 'passeur'`, 8000, 'seul Passeur');
  t('seul Le Passeur reste possible (vetos de Bruno)', true);

  // ═══ 2. tirage → révélation
  await A.click('#hub-draw-btn');
  const d = await A.attendsTrame((m) => m.session && m.session.draw && m.session.draw.status === 'drawn', 15000, 'tirage');
  for (const J of [A, B, C]) await J.until(`document.getElementById('hub-result').dataset.game === 'passeur' && !document.getElementById('hub-result').hidden`, 15000, `révélation ${J.nom}`);
  t('tirage serveur : Le Passeur, révélé chez les trois', d.session.draw.gameId === 'passeur');
  const mesures = [];
  for (const [w, h] of [[390, 780], [768, 1024], [1920, 1080]]) {
    await C.size(w, h); await sleep(200);
    mesures.push([w, await C.eval(MISE(['hub-draw', 'hub-result', 'hub-code']))]);
  }
  await C.size(1100, 1000);
  t('révélation : aucun débordement à 390 / 768 / 1920 (chez C)', mesures.every(([, m]) => m.over <= 0 && m.vis['hub-draw'] && m.vis['hub-result']), JSON.stringify(mesures));
  t('bouton de l\'hôte : « Continuer — lancer Le Passeur »', /lancer Le Passeur/.test(await A.eval(`document.getElementById('hub-continue').textContent`)));
  await A.shot('1-revelation-A');

  // ═══ 3. lancement : A crée, B et C attendent
  await A.click('#hub-continue');
  await A.until(`!document.getElementById('hub-launch').hidden && !document.getElementById('launch-go').hidden`, 8000, 'bloc de lancement A');
  await B.until(`!document.getElementById('hub-launch').hidden`, 8000, 'bloc de lancement B');
  const lA = await A.eval(`({ t: document.getElementById('launch-title').textContent, b: document.getElementById('launch-go').textContent })`);
  const lB = await B.eval(`({ t: document.getElementById('launch-title').textContent, go: !document.getElementById('launch-go').hidden, liste: document.getElementById('launch-list').innerText })`);
  t('host : « À toi de créer la partie » + bouton « Ouvrir Le Passeur »', /À toi de créer/.test(lA.t) && /Ouvrir Le Passeur/.test(lA.b));
  t('guest : « Alice crée la partie… », aucun bouton (un invité ne crée JAMAIS de room)', /Alice crée la partie/.test(lB.t) && !lB.go);
  t('attente : chacun voit qui est attendu', /attendu/i.test(lB.liste) && /Alice/.test(lB.liste));
  for (const [w, h] of [[390, 780], [768, 1024], [1920, 1080]]) {
    await B.size(w, h); await sleep(200);
    const m = await B.eval(MISE(['hub-launch', 'launch-title', 'launch-list']));
    t(`${w}×${h} : lancement (vue invité) sans débordement`, m.over <= 0 && m.vis['hub-launch'] && m.vis['launch-list'], JSON.stringify(m));
    if (w === 390) await B.shot('2-attente-invite-390');
  }
  await B.size(1100, 1000);

  await A.click('#launch-go');                           // même onglet, geste réel
  await A.until(surPasseur, 15000, 'A sur Le Passeur');
  await A.until(`!document.getElementById('lobby').hidden && /^[A-Z]{4}$/.test(document.getElementById('room-code').textContent.trim())`, 20000, 'room créée');
  const roomA = await A.eval(`document.getElementById('room-code').textContent.trim()`);
  const youA = A.jeu('you');
  t('Le Passeur de A crée la room tout seul (join sans code → you)', !!youA && youA.code === roomA && youA.host === true, roomA);
  t('A est le MJ de la room Passeur', await A.eval(`!document.getElementById('host-config').hidden`));
  const banA = await A.eval(`(document.querySelector('.g-hub-banner') || {}).textContent || ''`);
  t('bandeau Game Hub sur la page du Passeur (session + attente)', new RegExp(code).test(banA) && /attendus/.test(banA), banA);
  const startA = await A.eval(`({ off: document.getElementById('start').disabled, txt: document.getElementById('start').textContent, sans: !document.getElementById('start-anyway').hidden })`);
  t('« Lancer » attend le groupe (désactivé, nomme les absents) + « Lancer sans attendre »', startA.off && /Bruno/.test(startA.txt) && startA.sans, startA.txt);
  await A.shot('3-passeur-hote-attend');

  // ═══ 4. B RECHARGE /games/ pendant le lancement
  await B.until(`/Rejoindre Le Passeur/.test(document.getElementById('launch-go').textContent) && !document.getElementById('launch-go').hidden`, 10000, 'bouton Rejoindre chez B');
  const avant = B.hub();
  await B.reload();
  await B.until(`!document.getElementById('lobby').hidden && /Rejoindre Le Passeur/.test(document.getElementById('launch-go').textContent)`, 15000, 'B après rechargement');
  const apres = await B.eval(`GameProfile.load().id`);
  const hb = B.hub();
  t('B recharge pendant le lancement : même player.id, même session, même code de room',
    apres === idB && hb.code === code && hb.launch.roomCode === roomA && hb.players.filter((p) => p.id === idB).length === 1, `${avant.launch.roomCode} → ${hb.launch.roomCode}`);
  const titreB = await B.eval(`document.getElementById('launch-title').textContent`);
  t('B voit « Le Passeur est prêt — code … » avec le bon code', titreB.includes(roomA), titreB);
  for (const [w, h] of [[390, 780], [768, 1024], [1920, 1080]]) {
    await B.size(w, h); await sleep(200);
    const m = await B.eval(MISE(['launch-go', 'launch-title']));
    t(`${w}×${h} : bouton « Rejoindre » visible, sans débordement`, m.over <= 0 && m.vis['launch-go'], JSON.stringify(m));
    if (w === 390) await B.shot('4-rejoindre-390');
  }
  await B.size(1100, 1000);

  // ═══ 5. B et C rejoignent
  for (const J of [B, C]) {
    await J.until(`!document.getElementById('launch-go').hidden && /Rejoindre/.test(document.getElementById('launch-go').textContent)`, 10000, `Rejoindre chez ${J.nom}`);
    await J.click('#launch-go');
    await J.until(surPasseur, 15000, `${J.nom} sur Le Passeur`);
    await J.until(`!document.getElementById('lobby').hidden && document.getElementById('room-code').textContent.trim().length === 4`, 20000, `${J.nom} dans la room`);
  }
  const rooms = await Promise.all([A, B, C].map((J) => J.eval(`document.getElementById('room-code').textContent.trim()`)));
  t('roomCode A === B === C (DOM)', rooms.every((r) => r === roomA), rooms.join(' / '));
  t('roomCode A === B === C (trames « you » du serveur Passeur)', [A, B, C].every((J) => J.jeu('you').code === roomA));
  await A.until(`document.querySelectorAll('#players .g-player').length === 3`, 10000, '3 joueurs chez A');
  const lobby = A.jeu('lobby');
  t('le serveur Passeur voit les trois dans LA room', lobby.code === roomA && lobby.players.length === 3
    && ['Alice', 'Bruno', 'Chloé'].every((n) => lobby.players.some((p) => p.name === n)), lobby.players.map((p) => p.name).join(','));
  const ppA = await B.eval(`(() => { const i = [...document.querySelectorAll('#players .g-player')].find((li) => /Alice/.test(li.textContent)); const img = i && i.querySelector('img');
    return img ? { src: img.getAttribute('src'), ok: img.complete && img.naturalWidth > 0 } : null; })()`);
  t('la VRAIE PP de A s\'affiche dans Le Passeur, chez B', !!ppA && ppA.src === srcA && ppA.ok);
  t('et côté serveur Passeur, l\'avatar de A est l\'image', lobby.players.find((p) => p.name === 'Alice').avatar.kind === 'image');
  await A.until(`!document.getElementById('start').disabled && document.getElementById('start').textContent === 'Lancer la partie'`, 10000, 'start débloqué');
  const hubA = await A.attendsTrame((m) => m.session && m.session.state === 'inGame', 10000, 'inGame');
  t('Hub : tout le monde est entré → inGame (entered = 3, waiting = 0)', hubA.session.launch.entered.length === 3 && hubA.session.launch.waiting.length === 0);
  t('« Lancer la partie » se débloque quand le groupe est là', true);
  const banB = await B.eval(`document.querySelector('.g-hub-banner').textContent`);
  t('bandeau chez B : dans la partie : Alice, Bruno, Chloé', /Alice/.test(banB) && /Chloé/.test(banB), banB);
  for (const [w, h] of [[390, 780], [768, 1024], [1920, 1080]]) {
    await C.size(w, h); await sleep(200);
    const m = await C.eval(`(() => { const b = document.querySelector('.g-hub-banner').getBoundingClientRect(); return { over: document.documentElement.scrollWidth - innerWidth, ban: b.left >= -1 && b.right <= innerWidth + 1 }; })()`);
    t(`${w}×${h} : salon du Passeur + bandeau Hub sans débordement`, m.over <= 0 && m.ban, JSON.stringify(m));
    if (w === 390) await C.shot('5-passeur-salon-390');
  }
  await C.size(1100, 1000);

  // ═══ 6. une VRAIE partie : A lance, on joue au clavier
  await A.eval(`document.getElementById('rounds-select').value = '3'; true`);
  await A.click('#start');
  let manches = 0;
  for (let n = 0; n < 3; n++) {
    const round = await A.attendsTrame((m) => m.type === 'round' && m.index === n, 15000, 'manche ' + n);
    const legal = Object.entries(round.scene.options || {}).filter(([, o]) => o.legal !== false).map(([id]) => id);
    for (const J of [A, B, C]) {
      const k = await J.eval(`Court.ZONES.find((z) => z.id === ${JSON.stringify(legal[0])}).key`);
      // « À TOI » : le serveur a ouvert la fenêtre, les zones de CETTE manche sont armées.
      await J.until(`!document.getElementById('game').hidden && document.getElementById('round-num').textContent === '${n + 1}' && document.getElementById('court').dataset.armed === '1'`, 10000, 'zones armées ' + n);
      await J.key(k);
    }
    const res = await A.attendsTrame((m) => m.type === 'results' && m.index === n, 15000, 'résultats ' + n);
    if (res.results.length === 3 && res.results.every((r) => !r.timedOut)) manches++;
    if (n === 0) {
      await B.until(`!document.getElementById('results').hidden`, 8000, 'écran de résultats B');
      await B.shot('6-resultats-B');
      t('manche 1 : jouée au clavier par les trois, notée par le serveur du Passeur', res.results.every((r) => r.passId === legal[0]), res.results.map((r) => `${r.name} +${r.points}`).join(', '));
    }
    await A.until(`!document.getElementById('next').hidden`, 8000, 'bouton suivant');
    await A.click('#next');
  }
  t('3 manches jouées par les trois joueurs, aucune réponse perdue', manches === 3);
  const fin = await A.attendsTrame((m) => m.type === 'end', 15000, 'fin');
  t('classement final du Passeur : trois joueurs', fin.ranking.length === 3);
  for (const J of [A, B, C]) await J.until(`!document.getElementById('end').hidden && !document.getElementById('to-hub').hidden`, 8000, `fin chez ${J.nom}`);
  t('fin de partie : « Retour au Game Hub » proposé à chacun', true);
  const deb = await B.attendsTrame((m) => m.session && m.session.state === 'debrief', 10000, 'debrief');
  t('Hub : la partie finie ramène la session en debrief (prête pour un nouveau tirage)', deb.session.launch.stage === 'ended');
  await A.shot('7-fin-A');

  // ═══ 7. retour au Hub
  await B.click('#to-hub');
  await B.until(`location.pathname === '/games/' && !document.getElementById('lobby').hidden && !document.getElementById('hub-ready').hidden`, 15000, 'retour Hub B');
  const retour = await B.eval(`({ ready: document.getElementById('hub-ready').textContent, n: document.querySelectorAll('#hub-players .hub-card').length, id: GameProfile.load().id })`);
  t('retour au Hub : même session, même joueur, « partie terminée »', /terminée/.test(retour.ready) && retour.id === idB && B.hub().code === code, retour.ready);
  await B.shot('8-retour-hub');

  // ═══ 8. erreur réelle : le serveur du Passeur tombe, l'hôte ouvre le jeu
  // La page du Passeur de A n'arrive pas à se connecter → elle le dit au Hub
  // (hub-handoff.js) → le Hub annule le lancement → TOUT le groupe revient au
  // salon avec la raison, et peut retirer. Aucune couche n'est simulée.
  await A.click('#to-hub');
  await A.until(`location.pathname === '/games/' && !document.getElementById('lobby').hidden && !document.getElementById('hub-draw-btn').hidden`, 15000, 'A au Hub');
  procs[0].kill();                                            // passeur-server
  await sleep(300);
  await A.click('#hub-draw-btn');
  await A.until(`document.getElementById('hub-result').dataset.game === 'passeur' && !document.getElementById('hub-continue').hidden`, 20000, '2e tirage');
  await A.click('#hub-continue');
  await A.until(`!document.getElementById('launch-go').hidden`, 8000, 'Ouvrir');
  await A.click('#launch-go');
  await A.until(surPasseur, 15000, 'A sur Le Passeur (serveur mort)');
  const panne = await B.attendsTrame((m) => m.session && m.session.launch && m.session.launch.stage === 'failed', 20000, 'échec du lancement');
  t('serveur du Passeur injoignable : le Hub annule le lancement (UNREACHABLE)', panne.session.launch.reason === 'UNREACHABLE' && panne.session.state === 'lobby');
  await B.until(`!document.getElementById('hub-failed').hidden`, 8000, 'message d\'échec chez B');
  const msg = await B.eval(`document.getElementById('hub-failed').textContent`);
  t('le groupe revient au salon, avec une phrase compréhensible', /injoignable/.test(msg) && /tirage/.test(msg), msg);
  const banPanne = await A.eval(`(document.querySelector('.g-hub-banner') || {}).textContent || ''`);
  t('la page du Passeur de A le dit aussi (bandeau)', /injoignable/.test(banPanne), banPanne);
  await B.shot('9-echec-lancement');

  const errs = [A, B, C].flatMap((J) => J.erreurs.map((e) => `[${J.nom}] ${e}`));
  t('aucune erreur JS dans les trois navigateurs', errs.length === 0, errs.slice(0, 3).join(' | '));
} catch (e) {
  t('EXCEPTION', false, e.message);
} finally {
  stop();
}
console.log(`\n${ko ? 'DES TESTS ÉCHOUENT' : 'TOUT PASSE'} — ${out.length} vérifications, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
