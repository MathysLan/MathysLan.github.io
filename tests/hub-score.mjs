// Score de soirée, de bout en bout, dans de VRAIS navigateurs.
//
//   node tests/hub-score.mjs                 Hub + Passeur lancés en local
//   node tests/hub-score.mjs --reduced       même parcours en mouvement réduit
//   node tests/hub-score.mjs --shots <dir>   captures du bloc score (bureau / téléphone)
//
// Trois contextes isolés (A hôte, B, C). Le parcours :
//   /games/ → A crée, B et C rejoignent → le bloc « Score de la soirée » est
//   là, à zéro, AVANT tout tirage (mise en page mesurée à 1280 et à 390 px) →
//   tirage → Le Passeur → une vraie partie de 3 manches, chacun joue une passe
//   DIFFÉRENTE → le classement final part de passeur-server, la page de l'hôte
//   le rapporte au Hub → le Hub convertit → le bloc l'affiche chez les trois →
//   retour au Hub, 2e tirage, 2e partie → les points s'ADDITIONNENT → A quitte
//   et crée une nouvelle session → zéro.
//
// ⚠️ LA VÉRITÉ EST DANS LES TRAMES : le classement vient de la trame `end` de
// passeur-server, le score de la trame `session` du Hub. Le test recalcule la
// conversion à partir du premier et la compare au second, puis au DOM.
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
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

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
// Les liens réels (`games/passeur/` depuis le Hub) n'ont pas de `?server=` :
// ils iraient en production. On les redirige vers les serveurs locaux.
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

// --- CDP (même plomberie que handoff-play.mjs) ------------------------------------
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
  const J = { nom, erreurs: [], trames: [], envoyees: [] };
  cdp.on(sessionId, (m) => {
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      J.erreurs.push((d.exception?.description || d.text || '').split('\n')[0]);
    }
    if (m.method === 'Network.webSocketFrameReceived') {
      try { J.trames.push(JSON.parse(m.params.response.payloadData)); } catch (_) {}
    }
    if (m.method === 'Network.webSocketFrameSent') {
      try { J.envoyees.push(JSON.parse(m.params.response.payloadData)); } catch (_) {}
    }
  });
  const S = (m, p) => cdp.send(m, p, sessionId);
  await S('Runtime.enable'); await S('Page.enable'); await S('Network.enable');
  if (REDUCED) await S('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  J.size = (w, h) => S('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 500 });
  await J.size(1280, 900);
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
  // ⚠️ Quand le code de room arrive, /games/ amène « Rejoindre » à l'écran par
  // un défilement DOUX : un clic pendant ce défilement se perd, sans erreur.
  // On attend que l'élément ne bouge plus (même piège que handoff-demicercle).
  J.immobile = async (sel, ms = 5000) => {
    const pos = `(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return r.top + ',' + r.left + ',' + scrollY; })()`;
    let avant = await J.eval(pos), stables = 0;
    const fin = Date.now() + ms;
    while (Date.now() < fin && stables < 3) { await sleep(100); const p = await J.eval(pos); stables = p === avant ? stables + 1 : 0; avant = p; }
  };
  J.type = async (sel, text) => {
    await J.click(sel);
    await J.eval(`document.querySelector(${JSON.stringify(sel)}).select()`);
    await S('Input.insertText', { text });
    await sleep(60);
  };
  J.key = async (k) => {
    for (const type of ['rawKeyDown', 'keyUp']) await S('Input.dispatchKeyEvent', { type, key: k, code: 'Digit' + k, windowsVirtualKeyCode: 48 + Number(k) });
    await sleep(40);
  };
  // Capture d'une zone précise : `--screenshot` cadre toujours le haut du
  // document, ici on vise le salon lui-même.
  J.shot = async (nomFichier, sel = '#lobby') => {
    if (!SHOTS) return;
    const r0 = await J.eval(`(() => { window.scrollTo(0, 0); const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();
      return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: Math.min(r.height, 1400) }; })()`);
    const r = await S('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { ...r0, scale: 1 } });
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

// Le bloc score tel que la page l'affiche : ordre, points, mise en évidence.
const BLOC = `(() => [...document.querySelectorAll('#hub-score-list .hub-score-row')].map((li) => ({
  id: li.dataset.player, pts: +li.dataset.points, me: li.classList.contains('is-me'),
  rang: li.querySelector('.hub-score-rank').textContent, nom: li.querySelector('.hub-score-name').textContent,
  txt: li.querySelector('.hub-score-pts').textContent })))()`;

// La géométrie du salon, pour vérifier la place du bloc.
const GEO = `(() => {
  const r = (s) => { const e = document.querySelector(s); if (!e || e.hidden || !e.offsetParent) return null; const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top + scrollY, b: b.bottom + scrollY, w: b.width }; };
  const nom = document.querySelector('.hub-score-name');
  return { vw: innerWidth, over: document.documentElement.scrollWidth - innerWidth,
    lobby: r('#lobby'), head: r('.hub-lobby-head'), code: r('#hub-code'), status: r('.hub-status'), score: r('#hub-score'),
    players: r('#hub-players'), draw: r('#hub-draw'), pool: r('#hub-pool'),
    nomPx: nom ? parseFloat(getComputedStyle(nom).fontSize) : 0,
    titre: (document.querySelector('.hub-score-title') || {}).textContent || '' }; })()`;

// La conversion du Hub, recalculée ici À PARTIR DE LA TRAME DU JEU :
// 10 × (classés − rang + 1), rang « de compétition » sur les points de partie.
function attendu(ranking) {
  const n = ranking.length;
  return Object.fromEntries(ranking.map((r) => [r.name, 10 * (n - (1 + ranking.filter((x) => x.score > r.score).length) + 1)]));
}

// --- orchestration ----------------------------------------------------------------
const sante = await fakeHealth(HEALTH_PORT);
const MANIFEST = localManifest(ROOT, HEALTH_PORT, { passeur: `http://127.0.0.1:${PASSEUR_PORT}/` });
lance(path.join(ROOT, '..', 'passeur-server'), 'server.js', PASSEUR_PORT);
lance(path.join(ROOT, '..', 'game-hub-server'), 'src/server.js', HUB_PORT, { MANIFEST_FILE: MANIFEST });
const srv = await serve();
await attends(`http://127.0.0.1:${PASSEUR_PORT}/`);
await attends(`http://127.0.0.1:${HUB_PORT}/health`);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hubscore-'));
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

console.log(`Score de soirée — trois navigateurs, deux parties du Passeur (${REDUCED ? 'mouvement RÉDUIT' : 'mouvement normal'})\n`);
const BASE = `http://127.0.0.1:${HTTP_PORT}`;
const PAGE = `${BASE}/games/?hub=${encodeURIComponent(HUB)}`;
const surPasseur = `location.pathname === '/games/passeur/' && document.readyState === 'complete'`;
const auSalon = `location.pathname === '/games/' && !document.getElementById('lobby').hidden`;

// Une partie complète, du tirage au retour au Hub. Chaque joueur joue une
// option légale DIFFÉRENTE (le décalage change à chaque partie) : le
// classement a donc de vrais écarts, et c'est passeur-server qui les note.
async function partie(A, B, C, numero) {
  await A.until(`${auSalon} && !document.getElementById('hub-draw-btn').hidden && !document.getElementById('hub-draw-btn').disabled`, 15000, 'bouton tirer');
  await A.click('#hub-draw-btn');
  await A.until(`document.getElementById('hub-result').dataset.game === 'passeur' && !document.getElementById('hub-continue').hidden`, 20000, 'révélation');
  // Pendant le tirage, le score reste là.
  t(`partie ${numero} — pendant le tirage, le bloc score reste affiché`, await B.eval(`!!document.getElementById('hub-score').offsetParent && document.querySelectorAll('#hub-score-list li').length === 3`));
  await A.click('#hub-continue');
  await A.until(`!document.getElementById('launch-go').hidden`, 8000, 'Ouvrir');
  await A.click('#launch-go');
  await A.until(surPasseur, 15000, 'A sur Le Passeur');
  await A.until(`!document.getElementById('lobby').hidden && /^[A-Z]{4}$/.test(document.getElementById('room-code').textContent.trim())`, 20000, 'room créée');
  for (const J of [B, C]) {
    await J.until(`!document.getElementById('launch-go').hidden && /Rejoindre/.test(document.getElementById('launch-go').textContent)`, 15000, `Rejoindre chez ${J.nom}`);
    await J.immobile('#launch-go');
    await J.click('#launch-go');
    await J.until(surPasseur, 15000, `${J.nom} sur Le Passeur`);
    await J.until(`!document.getElementById('lobby').hidden && document.getElementById('room-code').textContent.trim().length === 4`, 20000, `${J.nom} dans la room`);
  }
  // Chacun a déclaré SA place au Hub (launched / entered + gamePlayerId).
  const places = [A, B, C].map((J) => {
    const you = [...J.trames].reverse().find((m) => m.type === 'you' && !m.session);
    const decl = [...J.envoyees].reverse().find((m) => m.action === 'launched' || m.action === 'entered');
    return you && decl && decl.gamePlayerId === you.id;
  });
  t(`partie ${numero} — chacun déclare au Hub SA place dans la room (gamePlayerId = son « you »)`, places.every(Boolean), JSON.stringify(places));

  await A.until(`!document.getElementById('start').disabled && document.getElementById('start').textContent === 'Lancer la partie'`, 15000, 'start débloqué');
  await A.eval(`document.getElementById('rounds-select').value = '3'; true`);
  await A.click('#start');
  for (let n = 0; n < 3; n++) {
    const round = await A.attendsTrame((m) => m.type === 'round' && m.index === n && !m.session, 15000, 'manche ' + n);
    const legal = Object.entries(round.scene.options || {}).filter(([, o]) => o.legal !== false).map(([id]) => id);
    for (const [i, J] of [A, B, C].entries()) {
      const choix = legal[(i + numero) % legal.length];
      const k = await J.eval(`Court.ZONES.find((z) => z.id === ${JSON.stringify(choix)}).key`);
      await J.until(`!document.getElementById('game').hidden && document.getElementById('round-num').textContent === '${n + 1}' && document.getElementById('court').dataset.armed === '1'`, 10000, 'zones armées ' + n);
      await J.key(k);
    }
    await A.attendsTrame((m) => m.type === 'results' && m.index === n && !m.session, 15000, 'résultats ' + n);
    await A.until(`!document.getElementById('next').hidden`, 8000, 'bouton suivant');
    await A.click('#next');
  }
  const fin = await A.attendsTrame((m) => m.type === 'end' && !m.session, 15000, 'fin de partie');
  // Ce que l'hôte a envoyé au Hub : le classement, tel quel, AVANT ended.
  const envoi = await (async () => {
    const f = Date.now() + 5000;
    while (Date.now() < f) { const m = A.envoyees.find((x) => x.action === 'results' && !x._vu); if (m) { m._vu = true; return m; } await sleep(50); }
    return null;
  })();
  const ordre = A.envoyees.filter((x) => x.action === 'results' || x.action === 'ended').map((x) => x.action);
  t(`partie ${numero} — la page de l'hôte rapporte le classement au Hub, puis « ended »`, !!envoi && ordre.lastIndexOf('results') < ordre.lastIndexOf('ended'), ordre.join(' → '));
  t(`partie ${numero} — … avec les identifiants et points de passeur-server, tels quels`, !!envoi && envoi.gameId === 'passeur'
    && same(envoi.results.map((r) => [r.gamePlayerId, r.points]).sort(), fin.ranking.map((r) => [r.id, r.score]).sort()));
  const guestsSilencieux = [B, C].every((J) => !J.envoyees.some((x) => x.action === 'results'));
  t(`partie ${numero} — les invités n'envoient AUCUN classement`, guestsSilencieux);

  const deb = await B.attendsTrame((m) => m.session && m.session.state === 'debrief' && m.session.history.games.length === numero, 15000, 'debrief + partie comptée');
  for (const J of [A, B, C]) {
    await J.until(`!document.getElementById('end').hidden && !document.getElementById('to-hub').hidden`, 8000, `fin chez ${J.nom}`);
    await J.click('#to-hub');
    await J.until(`${auSalon} && document.querySelectorAll('#hub-score-list li').length === 3`, 15000, `retour Hub ${J.nom}`);
  }
  return { fin, session: deb.session };
}

try {
  cdp = await cdpBrowser();
  const A = await joueur(cdp, 'A'), B = await joueur(cdp, 'B'), C = await joueur(cdp, 'C');

  // ═══ 1. la session, et le bloc score AVANT tout tirage
  const noms = { A: 'Alice', B: 'Bruno', C: 'Chloé-Anne la très longue' };
  await A.goto(PAGE);
  await A.type('#name-input', noms.A);
  await A.click('#identity-done');
  await A.click('#hub-create');
  await A.until(`!document.getElementById('lobby').hidden`, 20000, 'salon de A');
  const code = await A.eval(`document.getElementById('hub-code').textContent.trim()`);
  for (const [J, rang] of [[B, 2], [C, 5]]) {
    await J.goto(PAGE);
    await J.type('#name-input', noms[J.nom]);
    await J.click(`#avatar-row .avatar-pick:nth-child(${rang})`);
    await J.click('#identity-done');
    await J.type('#hub-code-input', code);
    await J.click('#hub-join');
  }
  for (const J of [A, B, C]) await J.until(`document.querySelectorAll('#hub-players .hub-card').length === 3 && document.querySelectorAll('#hub-games .hub-game').length === 8`, 20000, `${J.nom} au salon`);
  const id = {};
  for (const J of [A, B, C]) id[J.nom] = await J.eval(`GameProfile.load().id`);
  for (const g of ['imitation', 'demicercle', 'ban', 'precision', 'quiment']) await B.click(`#hub-games [data-pref=veto][data-game=${g}]`);
  await A.until(`[...document.querySelectorAll('#hub-games .hub-game[data-eligible=true]')].map((x) => x.dataset.game).join() === 'passeur'`, 8000, 'seul Passeur');

  const b0 = await B.eval(BLOC);
  t('avant tout tirage : « Score de la soirée », une ligne par joueur, tous à 0', b0.length === 3 && b0.every((l) => l.pts === 0)
    && /score de la soirée/i.test(await B.eval(`document.querySelector('.hub-score-title').textContent`)), JSON.stringify(b0.map((l) => l.txt)));
  t('avant tout tirage : pas de médaille (personne n\'a marqué)', b0.every((l) => !/🥇|🥈|🥉/.test(l.rang)));
  t('le joueur courant est mis en évidence (une seule ligne, la sienne)', b0.filter((l) => l.me).length === 1 && b0.find((l) => l.me).id === id.B);
  t('la session diffusée porte un score vide', same(B.hub().scores, {}) && same(B.hub().history.games, []));

  // Mise en page : 1280 (bureau), 390 (téléphone), et 700/701 autour de la bascule.
  await C.size(1280, 900); await sleep(250);
  let g = await C.eval(GEO);
  t('1280 : le bloc est en haut à droite du salon (même hauteur que le code)', !!g.score && Math.abs(g.score.t - g.head.t) <= 4 && g.score.l >= g.code.r && g.score.r <= g.lobby.r + 1, JSON.stringify({ s: g.score, h: g.head }));
  t('1280 : largeur raisonnable (240–320 px), pas un tableau', g.score.w >= 240 && g.score.w <= 320, String(Math.round(g.score.w)));
  t('1280 : il ne recouvre ni les joueurs, ni la liste des jeux', g.score.b <= g.players.t + 1 && (!g.pool || g.score.b <= g.pool.t), JSON.stringify({ s: g.score.b, p: g.players.t }));
  t('1280 : le statut de session est passé sous le code, à gauche', !!g.status && g.status.r <= g.score.l && g.status.t >= g.code.b - 1);
  t('1280 : aucun défilement horizontal', g.over <= 0, String(g.over));
  await C.shot('1-score-vide-1280');
  await C.size(390, 780); await sleep(250);
  g = await C.eval(GEO);
  t('390 : ordre code → joueurs → score', g.code.b <= g.players.t && g.players.b <= g.score.t, JSON.stringify({ c: g.code.b, p: [g.players.t, g.players.b], s: g.score.t }));
  t('390 : bloc pleine largeur, aucun défilement horizontal', g.over <= 0 && g.score.w >= g.lobby.w - 60 && g.score.r <= g.vw, JSON.stringify({ over: g.over, w: g.score.w, lobby: g.lobby.w }));
  t('390 : taille lisible (noms ≥ 14 px), le nom long est coupé proprement', g.nomPx >= 14 && await C.eval(`[...document.querySelectorAll('.hub-score-name')].every((n) => n.getBoundingClientRect().right <= n.closest('li').getBoundingClientRect().right + 1)`), String(g.nomPx));
  await C.shot('2-score-vide-390');
  for (const w of [701, 700, 560]) {
    await C.size(w, 900); await sleep(200);
    const x = await C.eval(GEO);
    const ok = x.over <= 0 && x.score.r <= x.vw && (w > 700 ? Math.abs(x.score.t - x.head.t) <= 4 : x.score.t >= x.players.b);
    t(`${w} px : ${w > 700 ? 'deux colonnes' : 'une colonne'}, rien ne déborde`, ok, JSON.stringify({ over: x.over, s: x.score, code: x.code }));
  }
  await C.size(1280, 900);

  // ═══ 2. première partie
  const p1 = await partie(A, B, C, 1);
  const att1 = attendu(p1.fin.ranking);
  const nomDe = (pid) => p1.session.players.find((p) => p.id === pid).name;
  const hub1 = Object.fromEntries(Object.entries(p1.session.scores).map(([pid, v]) => [nomDe(pid), v]));
  t('partie 1 — les points du Hub = conversion du classement de passeur-server', same(Object.entries(hub1).sort(), Object.entries(att1).sort()),
    `classement ${p1.fin.ranking.map((r) => r.name + ' ' + r.score).join(', ')} → Hub ${JSON.stringify(hub1)}`);
  t('partie 1 — historique : une partie, jeu passeur, points du jeu conservés', p1.session.history.games.length === 1 && p1.session.history.games[0].gameId === 'passeur'
    && p1.session.history.games[0].results.every((r) => p1.fin.ranking.some((x) => x.name === r.name && x.score === r.gamePoints)));
  for (const J of [A, B, C]) {
    const b = await J.eval(BLOC);
    const tri = b.map((l) => l.pts);
    const okPts = b.every((l) => l.pts === p1.session.scores[l.id]);
    t(`partie 1 — ${J.nom} : le bloc affiche les points du Hub, triés, sa ligne en évidence`,
      okPts && same(tri, [...tri].sort((x, y) => y - x)) && b.find((l) => l.me).id === id[J.nom], JSON.stringify(b.map((l) => `${l.rang} ${l.nom} ${l.txt}`)));
  }
  const b1 = await A.eval(BLOC);
  t('partie 1 — le premier a sa médaille 🥇, et le gain de la partie est affiché', b1[0].rang === '🥇' && /^\+\d+/.test(b1[0].txt), b1[0].txt);
  t('partie 1 — note : « après 1 partie · dernière : Le Passeur »', /après 1 partie · dernière : Le Passeur/.test(await A.eval(`document.getElementById('hub-score-note').textContent`)));
  await A.shot('3-score-apres-partie1-1280');
  await B.size(390, 780); await sleep(250);
  await B.shot('4-score-apres-partie1-390');
  const g2 = await B.eval(GEO);
  t('partie 1 — 390 : toujours aucun défilement horizontal', g2.over <= 0, String(g2.over));
  await B.size(1280, 900);

  // ═══ 3. deuxième tirage, deuxième partie : les points s'additionnent
  const p2 = await partie(A, B, C, 2);
  const att2 = attendu(p2.fin.ranking);
  const hub2 = Object.fromEntries(Object.entries(p2.session.scores).map(([pid, v]) => [nomDe(pid), v]));
  const somme = Object.fromEntries(Object.keys(att1).map((n) => [n, att1[n] + att2[n]]));
  t('partie 2 — les points s\'ADDITIONNENT (partie 1 + partie 2)', same(Object.entries(hub2).sort(), Object.entries(somme).sort()), `${JSON.stringify(att1)} + ${JSON.stringify(att2)} → ${JSON.stringify(hub2)}`);
  t('partie 2 — historique : deux parties, dans l\'ordre', p2.session.history.games.length === 2 && p2.session.history.games[1].n === 2 && p2.session.history.played.length === 2);
  const b2 = await C.eval(BLOC);
  t('partie 2 — le bloc suit (chez C)', b2.every((l) => l.pts === p2.session.scores[l.id]), JSON.stringify(b2.map((l) => l.txt)));
  t('partie 2 — note : « après 2 parties »', /après 2 parties/.test(await C.eval(`document.getElementById('hub-score-note').textContent`)));
  await C.shot('5-score-apres-partie2-1280');

  // ═══ 4. nouvelle session : zéro
  await A.click('#hub-leave');
  await A.until(`!document.getElementById('entry').hidden`, 8000, 'A à l\'entrée');
  await A.click('#hub-create');
  await A.until(`!document.getElementById('lobby').hidden && document.getElementById('hub-code').textContent.trim() !== ${JSON.stringify(code)}`, 20000, 'nouvelle session');
  const neuve = await A.attendsTrame((m) => m.session && m.session.code !== code, 8000, 'nouvelle session');
  const bn = await A.eval(BLOC);
  t('nouvelle session : le score repart de zéro (serveur ET affichage)', same(neuve.session.scores, {}) && same(neuve.session.history.games, [])
    && bn.length === 1 && bn[0].pts === 0, JSON.stringify(bn.map((l) => l.txt)));
  t('… pendant que l\'ancienne session garde les siens (chez B)', Object.values(B.hub().scores).reduce((a, b) => a + b, 0) === Object.values(somme).reduce((a, b) => a + b, 0));

  const errs = [A, B, C].flatMap((J) => J.erreurs.map((e) => `[${J.nom}] ${e}`));
  t('aucune erreur JS dans les trois navigateurs', errs.length === 0, errs.slice(0, 3).join(' | '));
} catch (e) {
  t('EXCEPTION', false, e.message);
} finally {
  stop();
}
console.log(`\n${ko ? 'DES TESTS ÉCHOUENT' : 'TOUT PASSE'} — ${out.length} vérifications, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
