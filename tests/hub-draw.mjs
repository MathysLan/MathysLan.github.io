// Le randomizer du Game Hub en VRAI navigateur, à trois joueurs isolés.
//
//   node tests/hub-draw.mjs                 serveur du Hub lancé en local
//   node tests/hub-draw.mjs --reduced       même parcours en mouvement réduit
//   node tests/hub-draw.mjs --shots <dir>   une capture par étape
//
// A (vraie photo), B et C (emoji), trois contextes isolés (trois localStorage,
// trois player.id). Le parcours :
//   portfolio → clic RÉEL sur l'entrée Game Hub → /games/ → A crée
//   → B et C rejoignent → préférences, visibles chez tous
//   → A tire : caisse, bande, révélation → CONTINUER → 2e tirage (récence)
//   → la bande reste arrêtée SUR le jeu tiré quand la fenêtre change : après
//     l'arrêt, en plein défilement, en paysage, et pour un 3e tirage (GEOM)
//   → C recharge pendant la révélation : même tirage, pas un nouveau
//   → aucun jeu possible : le salon dit pourquoi
//   → 390 / 768 / 1920 px
//   → le même front contre la version du Hub D'AVANT le randomizer
//   → un serveur de jeu MORT : le jeu est tiré et révélé quand même.
//
// ⚠️ LA VÉRITÉ EST DANS LES TRAMES. Le jeu tiré est lu dans les messages
// WebSocket reçus par la page (protocole DevTools), puis comparé au DOM : c'est
// ce qui prouve que la page affiche le jeu choisi PAR LE SERVEUR, et que la
// bande ne montre que des jeux de SA liste éligible.
//
// Les serveurs de jeu sont simulés (leur /health seulement, tests/hub-fixture.mjs) :
// aucun serveur Render n'est réveillé par ce test.
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { fakeHealth, localManifest } from './hub-fixture.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HUBDIR = path.join(ROOT, '..', 'game-hub-server');
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const EDGE = arg('--edge') || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const REDUCED = process.argv.includes('--reduced');
const SHOTS = arg('--shots');
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const R = () => Math.floor(Math.random() * 300);
const HTTP_PORT = 8700 + R(), CDP_PORT = 9700 + R(), HUB_PORT = 8100 + R(), OLD_PORT = 7400 + R(), HEALTH_PORT = 6400 + R();
// ⚠️ Un SECOND Hub, rien que pour le réveil. Un état « up » vit 5 min dans le
// Hub (UP_TTL_MS, pas réglable par l'environnement) : sur l'instance qui a déjà
// tiré deux fois, le serveur du candidat serait déclaré frais et il n'y aurait
// aucune attente à observer. Un processus neuf = un cache de santé vierge.
const WAKE_PORT = 7800 + R();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MANIFEST_JSON = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'games.manifest.json'), 'utf8'));
const TITRE = Object.fromEntries(MANIFEST_JSON.games.map((g) => [g.id, g.title]));

let out = [], ko = 0;
const t = (nom, ok, detail = '') => {
  out.push(`${ok ? 'OK  ' : 'KO  '} ${nom}${detail ? ' — ' + detail : ''}`);
  if (!ok) ko++;
  console.log(out[out.length - 1]);
};

// --- serveurs ----------------------------------------------------------------
const HUB = `ws://127.0.0.1:${HUB_PORT}`, OLD = `ws://127.0.0.1:${OLD_PORT}`;
const procs = [];
function lance(cwd, port, env = {}) {
  const p = spawn(process.execPath, ['src/server.js'], { cwd, env: { ...process.env, PORT: String(port), HUB_QUIET: '1', ...env }, stdio: 'ignore' });
  procs.push(p);
  return p;
}
async function attendsHttp(url) { for (let i = 0; i < 100; i++) { try { return await (await fetch(url)).json(); } catch (_) { await sleep(100); } } throw new Error('injoignable : ' + url); }

// La version du Hub D'AVANT le randomizer, extraite de git. Le front neuf doit
// rester propre devant un serveur en retard : c'est exactement la situation
// entre deux déploiements. ⚠️ Commit FIXE (4c1784c = « stabilize hub presence
// and heartbeat », le dernier sans tirage), pas HEAD : une fois le randomizer
// commité, HEAD serait le randomizer et le test ne prouverait plus rien.
const ANCIEN = arg('--ancien') || '4c1784c';
function extraitAncien() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-ancien-'));
  try {
    const tar = path.join(dir, 'src.tar');
    execFileSync('git', ['-C', HUBDIR, 'archive', '--format=tar', '-o', tar, ANCIEN], { stdio: 'ignore' });
    execFileSync('tar', ['-xf', 'src.tar'], { cwd: dir, stdio: 'ignore' });   // chemin relatif : le tar de Windows lit « C: » comme un hôte distant
    fs.cpSync(path.join(HUBDIR, 'node_modules'), path.join(dir, 'node_modules'), { recursive: true });
    return dir;
  } catch (e) { fs.rmSync(dir, { recursive: true, force: true }); throw e; }
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json' };
// Le site servi tel quel. UNE exception, propre au test : `/games/` demandé SANS
// `?hub=` (c'est le lien de la home) est redirigé vers `/games/?hub=<Hub local>`,
// pour que le clic réel depuis la home arrive sur le Hub de test et non sur la
// production. Le lien de la home, lui, reste `games/` — vérifié plus bas.
function serve() {
  const srv = createServer((req, res) => {
    const [p0, q] = req.url.split('?');
    if (p0 === '/games/' && !/(^|&)hub=/.test(q || '')) { res.writeHead(302, { Location: `/games/?hub=${encodeURIComponent(HUB)}` }); return res.end(); }
    let p = decodeURIComponent(p0);
    if (p.endsWith('/')) p += 'index.html';
    const full = path.join(ROOT, p);
    if (!full.startsWith(ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
    res.end(fs.readFileSync(full));
  });
  return new Promise((r) => srv.listen(HTTP_PORT, '127.0.0.1', () => r(srv)));
}

// --- CDP ---------------------------------------------------------------------
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
    // Ce que le SERVEUR a envoyé à cette page.
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
  J.goto = async (url) => {
    await J.navigate(url);
    for (let i = 0; i < 80; i++) {
      await sleep(100);
      try { if (await J.eval(`document.readyState === 'complete' && !!window.GameHub && !!window.HubCrate`)) return; } catch (_) {}
    }
    throw new Error(`[${nom}] la page ne se charge pas`);
  };
  J.reload = async () => { await S('Page.reload', {}); await sleep(300); for (let i = 0; i < 80; i++) { await sleep(100); try { if (await J.eval(`document.readyState === 'complete' && !!window.GameHub`)) return; } catch (_) {} } };
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
  // Une VRAIE tabulation (rawKeyDown sans `text`, cf. tests/README.md) : seule
  // une vraie touche allume :focus-visible.
  J.tab = async () => {
    for (const type of ['rawKeyDown', 'keyUp']) await S('Input.dispatchKeyEvent', { type, key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await sleep(40);
  };
  // Une vraie touche Entrée (keyDown AVEC text : c'est ce qui active un
  // <button> ; sans text, seul un écouteur keydown la verrait).
  J.enter = async () => {
    await S('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
    await S('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await sleep(60);
  };
  // Attend la FIN d'un défilement (doux ou non) : scrollY inchangé pendant 6
  // images d'affilée, mesuré dans la page par requestAnimationFrame. Rend
  // { fini, y } — pas d'attente fixe, qui serait trop courte ou trop longue.
  J.scrollFini = () => J.eval(`new Promise((res) => { let y = scrollY, n = 0, k = 0;
    const f = () => { if (scrollY === y) n++; else { n = 0; y = scrollY; }
      if (n >= 6 || ++k > 600) res({ fini: n >= 6, y: Math.round(scrollY) }); else requestAnimationFrame(f); };
    requestAnimationFrame(f); })`);
  J.upload = async (sel, file) => {
    const { result: { root } } = await S('DOM.getDocument', { depth: 0 });
    const { result: { nodeId } } = await S('DOM.querySelector', { nodeId: root.nodeId, selector: sel });
    await S('DOM.setFileInputFiles', { files: [file], nodeId });
  };
  J.until = async (expr, ms = 10000, label = expr) => {
    const fin = Date.now() + ms;
    while (Date.now() < fin) { try { const v = await J.eval(expr); if (v) return v; } catch (_) {} await sleep(80); }
    throw new Error(`[${nom}] attente expirée : ${label}`);
  };
  J.shot = async (nomFichier) => {
    if (!SHOTS) return;
    const r = await S('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(SHOTS, (REDUCED ? 'r-' : '') + nomFichier + '.png'), Buffer.from(r.result.data, 'base64'));
  };
  // Le dernier état de session reçu du serveur (trames).
  J.session = () => { for (let i = J.trames.length - 1; i >= 0; i--) if (J.trames[i].session) return J.trames[i].session; return null; };
  J.drawn = (n) => J.trames.map((m) => m.session && m.session.draw).filter((d) => d && d.n === n && d.status !== 'pending').pop() || null;
  return J;
}

// Ce que la page affiche du tirage et des jeux.
const VUE = `(() => {
  const games = [...document.querySelectorAll('#hub-games .hub-game')].map((li) => ({ id: li.dataset.game, ok: li.dataset.eligible === 'true',
    etat: li.querySelector('.hub-game-state').textContent, loves: (li.querySelector('.hub-game-loves') || {}).textContent || '',
    love: li.querySelector('[data-pref=love]').getAttribute('aria-pressed') === 'true', veto: li.querySelector('[data-pref=veto]').getAttribute('aria-pressed') === 'true' }));
  const res = document.getElementById('hub-result');
  return { code: document.getElementById('hub-code').textContent.trim(), n: document.querySelectorAll('#hub-players .hub-card').length,
    games, eligibles: games.filter((g) => g.ok).map((g) => g.id),
    drawBtn: !document.getElementById('hub-draw-btn').hidden, drawBtnOff: document.getElementById('hub-draw-btn').disabled,
    drawLabel: document.getElementById('hub-draw-btn').textContent, wait: document.getElementById('hub-wait').textContent,
    stage: !document.getElementById('hub-draw').hidden, result: !res.hidden ? res.dataset.game : null,
    titre: document.getElementById('result-title').textContent, joueurs: document.getElementById('result-players').textContent,
    duree: document.getElementById('result-minutes').textContent, cont: !document.getElementById('hub-continue').hidden,
    contWait: document.getElementById('hub-continue-wait').textContent, ready: !document.getElementById('hub-ready').hidden,
    hist: document.getElementById('hub-history').textContent, none: !document.getElementById('hub-none').hidden,
    noneTxt: document.getElementById('hub-none').textContent,
    cells: [...document.querySelectorAll('#hub-reel .reel-cell')].map((c) => c.dataset.game),
    texte: document.body.innerText };
})()`;
// Le jeu SOUS le repère de la bande (le centre de la fenêtre).
const SOUS_REPERE = `(() => { const r = document.getElementById('hub-reel').getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
  const c = [...document.querySelectorAll('#hub-reel .reel-cell')].find((el) => { const b = el.getBoundingClientRect(); return x >= b.left && x <= b.right && y >= b.top && y <= b.bottom; });
  return c ? c.dataset.game : null; })()`;
// La plaque « Mann Co. · caisse de la soirée » et le couvercle OUVERT : la
// boîte du couvercle (rotation comprise) doit rester sous la plaque. Avant la
// correction, il montait sur « DE LA » à toutes les largeurs.
const PLAQUE = `(() => { const st = document.getElementById('hub-draw'); if (st.hidden) return null;
  const p = st.querySelector('.crate-plate').getBoundingClientRect(), l = st.querySelector('.crate-lid').getBoundingClientRect();
  return { ouvert: st.classList.contains('is-open'), ecart: Math.round(l.top - p.bottom), ok: l.top >= p.bottom - 0.5 }; })()`;
const DECALAGE = `(() => { const s = document.querySelector('#hub-reel .reel-strip'); return s ? new DOMMatrix(getComputedStyle(s).transform).m41 : 0; })()`;
// La GÉOMÉTRIE de l'arrêt (lot E) : la vignette gagnante sous le repère, entière
// dans la bande, son centre à moins de 30 % d'une vignette du repère (le « jeu »
// d'une vraie roue ; 0 en mouvement réduit). Avant le correctif, la cible était
// un décalage en pixels figé au lancement : après 1280 → 390 px, c'était une
// AUTRE vignette sous le repère (écart de −2,1 vignettes), sans rien dans le
// DOM pour le dire — seule la mesure le voit.
const GEOM = `(() => { const reel = document.getElementById('hub-reel'); const win = reel.querySelector('.reel-cell.is-win');
  if (!win || !reel.checkVisibility()) return null;
  const r = reel.getBoundingClientRect(), b = win.getBoundingClientRect(), x = r.left + r.width / 2;
  const sous = [...reel.querySelectorAll('.reel-cell')].find((c) => { const q = c.getBoundingClientRect(); return x >= q.left && x <= q.right; });
  return { jeu: win.dataset.game, sous: sous ? sous.dataset.game : null, sousGagnante: sous === win,
    ecart: Math.round((b.left + b.width / 2 - x) / b.width * 100) / 100, dedans: b.left >= r.left - 0.5 && b.right <= r.right + 0.5,
    bande: Math.round(r.width), vignette: Math.round(b.width), largeur: innerWidth }; })()`;
const arret = async (J, attendu, contexte) => {
  const g = await J.eval(GEOM);
  t(`${contexte} : ${J.nom} — la bande reste arrêtée SUR le jeu du serveur (repère dans la vignette gagnante)`,
    !!g && g.jeu === attendu && g.sousGagnante && g.dedans && Math.abs(g.ecart) <= (REDUCED ? 0.02 : 0.31), JSON.stringify(g));
};
// La RÉVÉLATION telle qu'on la lit (lot C) : un seul jeu ou non, la bande, la
// vignette gagnante, le titre plus gros que TOUT le reste de la fiche (emoji
// compris), la ligne d'état réservée aux lecteurs d'écran, le focus, et ce qui
// est à l'écran (titre, bouton de l'hôte ou attente de l'invité).
const REVELE = `(() => { const st = document.getElementById('hub-draw'), res = document.getElementById('hub-result'), reel = document.getElementById('hub-reel');
  const px = (e) => parseFloat(getComputedStyle(e).fontSize);
  const status = document.getElementById('hub-draw-status'), sr = status.getBoundingClientRect();
  const win = document.querySelector('#hub-reel .reel-cell.is-win');
  const cont = document.getElementById('hub-continue'), cr = cont.getBoundingClientRect();
  const wait = document.getElementById('hub-continue-wait'), wr = wait.getBoundingClientRect();
  const tr = document.getElementById('result-title').getBoundingClientRect();
  const autres = [...res.querySelectorAll('.result-kicker, .result-emoji, .result-tag, .result-facts dt, .result-facts dd, #hub-continue-wait')];
  return { single: st.classList.contains('is-single'), revealed: st.classList.contains('is-revealed'),
    reelVue: reel.checkVisibility(), cellules: reel.querySelectorAll('.reel-cell').length, gagnante: win ? win.dataset.game : null,
    kicker: document.getElementById('result-kicker').textContent, statut: status.textContent, statutCache: sr.width <= 1 && sr.height <= 1,
    titre: px(document.getElementById('result-title')), autres: Math.max(...autres.map(px)),
    focus: document.activeElement ? document.activeElement.id : null,
    cont: !cont.hidden, contTxt: cont.textContent, contVu: !cont.hidden && cr.top >= 0 && cr.bottom <= innerHeight && cr.left >= 0 && cr.right <= innerWidth,
    attente: wait.textContent, attenteVue: !!wait.textContent && wr.top >= 0 && wr.bottom <= innerHeight,
    titreVu: tr.top >= 0 && tr.bottom <= innerHeight && tr.left >= 0 && tr.right <= innerWidth,
    over: document.documentElement.scrollWidth - innerWidth }; })()`;

// --- orchestration ---------------------------------------------------------
const sante = await fakeHealth(HEALTH_PORT);
const santeWake = await fakeHealth(HEALTH_PORT + 1);
// Aucun jeu lançable ici : ce test est celui du RANDOMIZER (« continuer » revient
// au Hub). Le lancement a ses propres tests (handoff.mjs, handoff-play.mjs).
const MANIFEST = localManifest(ROOT, HEALTH_PORT, {}, { sansHandoff: true });
lance(HUBDIR, HUB_PORT, { MANIFEST_FILE: MANIFEST });
const MANIFEST_WAKE = localManifest(ROOT, HEALTH_PORT + 1, {}, { sansHandoff: true });
lance(HUBDIR, WAKE_PORT, { MANIFEST_FILE: MANIFEST_WAKE });
let ancienDir = null;
try { ancienDir = extraitAncien(); lance(ancienDir, OLD_PORT); } catch (e) { console.log('(ancien Hub non extrait : ' + e.message + ')'); }
const srv = await serve();
await attendsHttp(`http://127.0.0.1:${HUB_PORT}/health`);
await attendsHttp(`http://127.0.0.1:${WAKE_PORT}/health`);
if (ancienDir) await attendsHttp(`http://127.0.0.1:${OLD_PORT}/health`);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hubdraw-'));
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${dir}`, '--no-first-run',
  '--disable-features=BackForwardCache', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank'], { stdio: 'ignore' });
let cdp = null;
const stop = () => {
  try { execFileSync('taskkill', ['/PID', String(edge.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (_) { try { edge.kill(); } catch (__) {} }
  procs.forEach((p) => { try { p.kill(); } catch (_) {} });
  try { cdp && cdp.close(); } catch (_) {}
  try { srv.close(); } catch (_) {}
  sante.close();
  santeWake.close();
  try { fs.unlinkSync(MANIFEST_WAKE); } catch (_) {}
  for (const d of [dir, ancienDir]) if (d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} }
  try { fs.unlinkSync(MANIFEST); } catch (_) {}
};

console.log(`Game Hub — randomizer dans le navigateur, 3 joueurs (${REDUCED ? 'mouvement RÉDUIT' : 'mouvement normal'})\n`);
const BASE = `http://127.0.0.1:${HTTP_PORT}`;
const PAGE = `${BASE}/games/?hub=${encodeURIComponent(HUB)}`;
const INTERDITS = ['morpion', 'puissance4', 'precision'];   // pour ce groupe, voir étape 3

try {
  cdp = await cdpBrowser();
  const A = await joueur(cdp, 'A'), B = await joueur(cdp, 'B'), C = await joueur(cdp, 'C');

  // ═══ 1. du portfolio au Hub, par un VRAI clic
  await A.navigate(BASE + '/');
  await A.until(`document.readyState === 'complete' && !!document.getElementById('hub-link')`, 15000, 'home');
  await sleep(400);
  const lien = await A.eval(`(() => { const a = document.getElementById('hub-link'); const r = a.getBoundingClientRect();
    return { href: a.getAttribute('href'), texte: a.innerText, visible: r.width > 100 && r.height > 60, jeux: document.querySelectorAll('#games-track .game-cta[href^="games/"]').length }; })()`);
  t('home : l\'entrée Game Hub est visible dans la section Jeux', lien.visible && /Game Hub/i.test(lien.texte) && /amis/i.test(lien.texte), lien.texte.replace(/\s+/g, ' '));
  t('home : lien relatif « games/ » (GitHub Pages)', lien.href === 'games/');
  t('home : les liens directs vers les 7 jeux sont toujours là', lien.jeux === 7, String(lien.jeux));
  await A.box('#hub-link');           // amène l'entrée à l'écran pour la capture
  await sleep(300);
  await A.shot('0-home-entree');
  await A.click('#hub-link');
  await A.until(`location.pathname === '/games/' && document.readyState === 'complete' && !!window.GameHub && !!window.HubCrate`, 15000, 'arrivée sur /games/');
  t('clic réel sur l\'entrée → /games/ (la page du Hub)', await A.eval(`location.pathname === '/games/' && document.title.includes('Game Hub')`));
  t('/games/ reste en noindex', await A.eval(`(document.querySelector('meta[name=robots]') || {}).content === 'noindex'`));

  // ═══ 2. profils, et A crée depuis la page atteinte par le clic
  await A.type('#name-input', 'Alice');
  await A.upload('#gp-file', path.join(ROOT, 'assets', 'og-image.png'));
  await A.until(`GameProfile.load().avatar.kind === 'image'`, 8000, 'photo de A');
  await A.click('#identity-done');
  const srcA = await A.eval(`GameProfile.load().avatar.src`);
  await A.click('#hub-create');
  await A.until(`!document.getElementById('lobby').hidden && document.querySelectorAll('#hub-players .hub-card').length === 1`, 20000, 'salon de A');
  const code = await A.eval(`document.getElementById('hub-code').textContent.trim()`);
  t('home → Hub → création de session', /^[A-HJ-NP-Z2-9]{5}$/.test(code), code);
  const idA = await A.eval(`GameProfile.load().id`);

  for (const [J, nom, rang] of [[B, 'Bruno', 2], [C, 'Chloé', 5]]) {
    await J.goto(PAGE);
    await J.type('#name-input', nom);
    await J.click(`#avatar-row .avatar-pick:nth-child(${rang})`);
    await J.click('#identity-done');
    await J.type('#hub-code-input', code);
    await J.click('#hub-join');
  }
  for (const J of [A, B, C]) await J.until(`document.querySelectorAll('#hub-players .hub-card').length === 3 && document.querySelectorAll('#hub-games .hub-game').length === 8`, 20000, `${J.nom} voit 3 joueurs et le catalogue`);
  const idB = await B.eval(`GameProfile.load().id`), idC = await C.eval(`GameProfile.load().id`);
  for (const J of [A, B, C]) {
    const v = await J.eval(`(() => { const c = document.querySelector('#hub-players .hub-card[data-player=${JSON.stringify(idA)}]'); const i = c && c.querySelector('.g-av img');
      return { img: i ? i.getAttribute('src') : null, ok: !!i && i.complete && i.naturalWidth > 0,
        emojis: [...document.querySelectorAll('#hub-players .hub-card')].filter((x) => !x.querySelector('.g-av img')).length }; })()`);
    t(`${J.nom} : trois joueurs — la vraie PP de A, deux emojis`, v.img === srcA && v.ok && v.emojis === 2);
  }
  {
    // Les possibles d'abord, puis les indisponibles (repliés) : chaque groupe
    // garde l'ordre du manifest, et aucune fiche ne manque ni ne se double.
    const vb = (await B.eval(VUE)).games, ordre = MANIFEST_JSON.games.map((g) => g.id);
    const attendu = [...ordre.filter((id) => vb.find((g) => g.id === id).ok), ...ordre.filter((id) => !vb.find((g) => g.id === id).ok)];
    t('le catalogue affiché = le manifest réel : possibles d\'abord, puis les autres, chacun dans l\'ordre du manifest',
      JSON.stringify(vb.map((g) => g.id)) === JSON.stringify(attendu) && vb.length === ordre.length, vb.map((g) => g.id).join(','));
  }

  // ═══ 3. préférences, visibles chez tous
  await B.click('#hub-games [data-pref=veto][data-game=precision]');
  await C.click('#hub-games [data-pref=love][data-game=passeur]');
  await A.until(`(() => { const v = ${VUE}; const p = v.games.find((g) => g.id === 'precision'); const s = v.games.find((g) => g.id === 'passeur');
    return p && !p.ok && /veto de Bruno/.test(p.etat) && /Chloé/.test(s.loves); })()`, 8000, 'prefs visibles chez A');
  const vA = await A.eval(VUE), vB = await B.eval(VUE), vC = await C.eval(VUE);
  t('veto de B : Précision grisée chez A, avec « veto de Bruno »', /veto de Bruno/.test(vA.games.find((g) => g.id === 'precision').etat));
  t('❤️ de C : visible chez A et B (« ❤️ Chloé »)', /Chloé/.test(vA.games.find((g) => g.id === 'passeur').loves) && /Chloé/.test(vB.games.find((g) => g.id === 'passeur').loves));
  t('chacun voit SES boutons pressés : B son veto, C son cœur, A rien',
    vB.games.find((g) => g.id === 'precision').veto && vC.games.find((g) => g.id === 'passeur').love
    && !vA.games.some((g) => g.love || g.veto));
  // ⚠️ L'écran « Ce que tu apportes » n'existe plus : micro et avertissement
  // sont acquis d'office. Imitation et le Ban ne peuvent donc plus être écartés
  // que par leurs bornes de joueurs — à 3, ils passent.
  t('plus d\'écran « Ce que tu apportes » dans le salon',
    await A.eval(`!document.getElementById('hub-caps') && !document.getElementById('hub-caps-list')`));
  t('plus une seule mention de micro, d\'avertissement ou de « déclaré »',
    !/micro|avertissement|non déclaré|Ce que tu apportes/i.test(vA.texte),
    (vA.texte.match(/micro|avertissement|déclaré|Ce que tu apportes/gi) || []).join(' | '));
  t('micro acquis : Imitation est possible, sans rien déclarer', vA.eligibles.includes('imitation'));
  t('avertissement acquis : le Ban est possible, sans rien déclarer', vA.eligibles.includes('ban'));
  t('bloqué par nombre : Morpion (2 max) et Qui Ment ? possible à 3',
    /2 joueurs maximum, vous êtes 3/.test(vA.games.find((g) => g.id === 'morpion').etat) && vA.eligibles.includes('quiment'));
  t('jeu local : Puissance 4 « se joue seul »', /seul/.test(vA.games.find((g) => g.id === 'puissance4').etat));
  const ELIG = ['imitation', 'demicercle', 'ban', 'passeur', 'quiment'];
  t('éligibles, identiques chez les trois : Imitation, Demi-Cercle, Ban, Passeur, Qui Ment ?',
    [vA, vB, vC].every((v) => JSON.stringify(v.eligibles) === JSON.stringify(ELIG)), vA.eligibles.join(','));
  t('les chances affichées suivent le cœur de C (Passeur plus probable)',
    (() => { const pct = (id) => +vA.games.find((g) => g.id === id).etat.match(/(\d+) %/)[1]; return pct('passeur') > pct('demicercle') && pct('demicercle') === pct('quiment'); })());
  t('hôte : A a le bouton de tirage ; B et C non, et le texte le dit (« En attente d\'Alice »)',
    vA.drawBtn && !vA.drawBtnOff && !vB.drawBtn && !vC.drawBtn && /En attente d'Alice — c'est l'hôte qui tire le jeu/.test(vB.wait), vB.wait);

  // Le catalogue : les possibles d'abord, les indisponibles repliés — rien
  // n'est perdu, tout reste dans #hub-games (la raison comprise).
  const CAT = `(() => { const ok = [...document.querySelectorAll('#hub-games-ok .hub-game')], out = [...document.querySelectorAll('#hub-games-out .hub-game')];
    const det = document.getElementById('hub-out');
    return { ok: ok.map((li) => li.dataset.game), okElig: ok.every((li) => li.dataset.eligible === 'true'),
      out: out.map((li) => li.dataset.game), outElig: out.some((li) => li.dataset.eligible === 'true'),
      tous: document.querySelectorAll('#hub-games .hub-game').length, cache: det.hidden, ouvert: det.open,
      sum: document.getElementById('hub-out-sum').textContent,
      raisonsVues: out.map((li) => ({ id: li.dataset.game, vu: li.checkVisibility(), etat: li.querySelector('.hub-game-state').textContent })) }; })()`;
  const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
  const cA = await A.eval(CAT), cB = await B.eval(CAT);
  const HORS = vA.games.filter((g) => !g.ok).map((g) => g.id);
  t('catalogue : les possibles d\'abord, dans l\'ordre du catalogue ; #hub-games garde les 8 fiches',
    same(cA.ok, ELIG) && cA.okElig && cA.tous === 8, JSON.stringify(cA.ok));
  t(`catalogue : les ${HORS.length} indisponibles sont repliés sous « ${HORS.length} jeux indisponibles ce soir — pourquoi ? »`,
    same(cA.out, HORS) && !cA.outElig && !cA.cache && !cA.ouvert && cA.sum.startsWith(`${HORS.length} jeux indisponibles ce soir — pourquoi ?`)
    && cA.raisonsVues.every((r) => !r.vu), cA.sum);
  t('catalogue : B, qui a posé un veto, le lit dans le résumé (« dont 1 par ton veto »)', / \(dont 1 par ton veto\)$/.test(cB.sum) && !/veto/.test(cA.sum), cB.sum);
  await A.click('#hub-out-sum');
  const cA2 = await A.eval(CAT);
  t('catalogue : ouvert, chaque indisponible montre sa raison (celle du serveur, inchangée)',
    cA2.ouvert && cA2.raisonsVues.every((r) => r.vu && r.etat.length > 3 && r.etat === vA.games.find((g) => g.id === r.id).etat), JSON.stringify(cA2.raisonsVues));
  await A.shot('1b-indisponibles-A');
  await A.click('#hub-out-sum');
  t('catalogue : se referme au clic', !(await A.eval(CAT)).ouvert);
  await A.shot('1-salon-A'); await B.shot('1-salon-B');

  // Clavier : l'anneau de focus doit SE VOIR sur les boutons du Hub. Le socle le
  // dessine en outline, que le clip-path des boutons rogne : la page le
  // redessine en box-shadow inset. On lit ce qui est réellement peint.
  await B.eval(`document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0); true`);
  const vus = {};
  for (let i = 0; i < 60 && Object.keys(vus).length < 2; i++) {
    await B.tab();
    const f = await B.eval(`(() => { const a = document.activeElement; if (!a || a.tagName !== 'BUTTON') return null; const s = getComputedStyle(a);
      const genre = a.dataset.pref ? 'pref' : a.id === 'hub-leave' ? 'quitter' : null;
      return genre && { genre, fv: a.matches(':focus-visible'), jaune: /rgb\\(255, 215, 0\\)/.test(s.boxShadow), filtre: s.filter, opacite: s.opacity }; })()`);
    if (f && !vus[f.genre]) vus[f.genre] = f;
  }
  for (const g of ['pref', 'quitter']) {
    const f = vus[g];
    t(`clavier : anneau jaune visible sur un bouton « ${g} » atteint à la touche Tab`, !!f && f.fv && f.jaune && f.filtre === 'none' && f.opacite === '1', JSON.stringify(f));
  }
  // L'ordre de tabulation suit la hiérarchie du salon (vraies frappes Tab, chez
  // l'hôte) : code → « Tirer » → durée → ❤️ / 🚫 → indisponibles → Quitter → Terminer.
  {
    // Point de départ : le code (blur() ne ramène PAS le point de départ de la
    // tabulation en haut de page, il reste sur le dernier élément cliqué).
    await A.eval(`document.getElementById('hub-code').focus(); true`);
    const ordre = ['hub-code'];
    for (let i = 0; i < 40; i++) {
      await A.tab();
      const k = await A.eval(`(() => { const a = document.activeElement; if (!a) return null;
        if (a.dataset && a.dataset.pref) return 'pref'; if (a.id === 'hub-out-sum') return 'indispo'; return a.id || null; })()`);
      if (k && !ordre.includes(k)) ordre.push(k);
      if (k === 'hub-finish') break;
    }
    const cles = ['hub-code', 'hub-draw-btn', 'hub-max-min', 'pref', 'indispo', 'hub-leave', 'hub-finish'];
    const pos = cles.map((c) => ordre.indexOf(c));
    t('clavier : ordre de tabulation = code → Tirer → durée → ❤️/🚫 → indisponibles → Quitter → Terminer',
      pos.every((p) => p >= 0) && pos.every((p, i) => i === 0 || p > pos[i - 1]), ordre.join(' → '));
    // ⚠️ Un défilement DOUX en cours fait rater le clic suivant du harnais : le
    // clic a été tracé sur #lobby, pas sur « Tirer », et le tirage n'avait pas
    // lieu. Source : scroll-behavior: smooth de tf2.css (le produit n'est pas
    // touché), qui s'applique au défilement de la tabulation (le focus finit sur
    // « Terminer », en bas) ET à un window.scrollTo(0, 0) sans behavior. Course
    // INTERMITTENTE (vue 2 fois sur 2 un jour, 0 sur 6 le lendemain) : on ne
    // parie pas sur un délai, on attend la FIN réelle du défilement, on remonte
    // en 'instant', et on attend qu'il soit stable en haut avant de cliquer.
    const s1 = await A.scrollFini();
    await A.eval(`document.activeElement && document.activeElement.blur(); window.scrollTo({ top: 0, behavior: 'instant' }); true`);
    const s2 = await A.scrollFini();
    t('clavier : le défilement lancé par la tabulation s\'est terminé, la page est revenue en haut, stable', s1.fini && s2.fini && s2.y === 0, JSON.stringify({ s1, s2 }));
  }

  // ═══ 4. premier tirage
  const t0 = Date.now();
  await A.click('#hub-draw-btn');
  await B.until(`!document.getElementById('hub-draw').hidden`, 8000, 'caisse chez B');
  // La bande défile-t-elle vraiment ? On l'échantillonne chez B.
  const pos = [];
  for (let i = 0; i < 12; i++) { pos.push(await B.eval(DECALAGE)); await sleep(160); }
  const d1 = await (async () => { for (let i = 0; i < 100; i++) { const d = A.drawn(1); if (d) return d; await sleep(50); } return null; })();
  t('le serveur a tiré (lu dans les trames WebSocket de A)', !!d1 && !!d1.gameId, d1 && d1.gameId);
  const g1 = d1.gameId;
  t('tirage serveur : parmi les éligibles, jamais un jeu interdit', ELIG.includes(g1) && JSON.stringify(d1.eligible) === JSON.stringify(ELIG));
  for (const J of [A, B, C]) await J.until(`document.getElementById('hub-result').dataset.game && !document.getElementById('hub-result').hidden`, 12000, `révélation chez ${J.nom}`);
  const dur = Date.now() - t0;
  const r1 = await Promise.all([A, B, C].map((J) => J.eval(VUE)));
  const sous = await Promise.all([A, B, C].map((J) => J.eval(SOUS_REPERE)));
  t('la bande ne contient QUE des jeux de la liste éligible du serveur', r1.every((v) => v.cells.length > 20 && v.cells.every((c) => d1.eligible.includes(c))),
    [...new Set(r1.flatMap((v) => v.cells))].join(','));
  t('aucun jeu impossible pour la session n\'apparaît, même en passant', r1.every((v) => !v.cells.some((c) => INTERDITS.includes(c))));
  if (REDUCED) t('mouvement réduit : pas de défilement, résultat posé directement', new Set(pos.map((x) => Math.round(x))).size <= 2 && dur < 4000, `${dur} ms`);
  else t('animation : la bande a réellement défilé chez B', Math.abs(pos[pos.length - 1] - pos[0]) > 300 || new Set(pos.map((x) => Math.round(x))).size > 4,
    pos.map((x) => Math.round(x)).join(' '));
  t('la bande s\'arrête sur le jeu du serveur (sous le repère), chez les trois', sous.every((s) => s === g1), sous.join(','));
  for (const J of [A, B, C]) await arret(J, g1, '1er tirage, 1100 px');
  t('révélation = le jeu reçu du serveur, chez les trois', r1.every((v) => v.result === g1 && v.titre === TITRE[g1]), r1.map((v) => v.result).join(','));
  const hub1 = MANIFEST_JSON.games.find((g) => g.id === g1);
  t('fiche : joueurs et durée du manifest', r1[0].joueurs === `${hub1.players.min}–${hub1.players.max}` && r1[0].duree === `${hub1.minutes.min}–${hub1.minutes.max} min`,
    `${r1[0].joueurs} / ${r1[0].duree}`);
  t('CONTINUER : seulement chez l\'hôte ; B et C attendent Alice', r1[0].cont && !r1[1].cont && !r1[2].cont && /En attente d'Alice/.test(r1[1].contWait));
  for (const J of [A, B, C]) {
    const img = await J.eval(`(() => { const i = document.querySelector('#hub-players .hub-card[data-player=${JSON.stringify(idA)}] .g-av img'); return !!i && i.complete && i.naturalWidth > 0 && i.getAttribute('src') === ${JSON.stringify(srcA)}; })()`);
    t(`${J.nom} : la PP de A est toujours la bonne pendant le tirage`, img);
  }
  t('aucun « [obj » / « undefined » à l\'écran', r1.every((v) => !/\[obj|undefined|NaN/.test(v.texte)));

  // Lot C — la révélation, cas PLUSIEURS jeux : la bande reste (vrai tirage),
  // et à l'arrêt on lit d'abord « LE JEU TIRÉ ».
  {
    const [ra, rb] = [await A.eval(REVELE), await B.eval(REVELE)];
    t('plusieurs jeux : la bande est là (vrai tirage), pas le mode « un seul jeu »', !ra.single && ra.reelVue && ra.cellules > 20, JSON.stringify({ single: ra.single, n: ra.cellules }));
    t('plusieurs jeux : la vignette mise en avant est celle du serveur (et celle sous le repère)', ra.gagnante === g1 && rb.gagnante === g1 && sous[0] === g1, `${ra.gagnante} / ${g1}`);
    t('révélation : « 🎲 Jeu tiré », le NOM plus gros que tout le reste de la fiche', /Jeu tiré/.test(ra.kicker) && ra.titre > ra.autres, `${ra.titre} px > ${ra.autres} px`);
    t('révélation : la ligne d\'état dit « Jeu tiré : … » aux lecteurs d\'écran, sans doubler le titre à l\'écran',
      ra.statut === `Jeu tiré : ${TITRE[g1]}` + (/[?!.]$/.test(TITRE[g1]) ? '' : '.') && ra.statutCache, ra.statut);
    t('hôte : le focus est sur « ▶ Continuer — lancer … » dès la révélation', ra.focus === 'hub-continue' && /^▶ Continuer — lancer /.test(ra.contTxt), `${ra.focus} / ${ra.contTxt}`);
    t('invité : « ⏳ En attente d\'Alice pour … », à la place du bouton', !rb.cont && /^⏳ En attente d\'Alice pour /.test(rb.attente), rb.attente);
    const encart = await B.eval(`document.getElementById('hub-wait').textContent`);
    t('invité : l\'encart du haut ne dit plus « a lancé le tirage » une fois le jeu révélé', encart === 'Alice a tiré le jeu de la soirée.', encart);
    t('aucune double ponctuation (« Qui Ment ?. »)', r1.every((v) => !/[?!]\./.test(v.texte)) && !/[?!]\./.test(rb.attente + rb.statut));
  }
  // Aux quatre largeurs, chez l'hôte ET chez l'invité : le nom et la suite à
  // l'écran, rien qui déborde.
  for (const [w, h] of [[390, 780], [768, 1024], [1100, 1000], [1280, 900]]) {
    for (const [J, role] of [[A, 'hôte'], [B, 'invité']]) {
      await J.size(w, h); await sleep(200);
      await J.eval(`document.getElementById('hub-result').scrollIntoView({ block: 'center', behavior: 'instant' }); true`);
      const v = await J.eval(REVELE);
      t(`${w} px, ${role} : nom du jeu et ${role === 'hôte' ? 'bouton' : 'attente'} à l'écran, sans débordement`,
        v.over <= 0 && v.titreVu && (role === 'hôte' ? v.contVu : v.attenteVue), JSON.stringify({ over: v.over, titre: v.titreVu, cont: v.contVu, att: v.attenteVue }));
      // Lot E : tirage fini, PUIS la fenêtre change — la bande suit.
      await arret(J, g1, `1er tirage fini, redimensionné à ${w} px`);
      await J.shot(`2-revelation-${role === 'hôte' ? 'A' : 'B'}-${w}`);
    }
  }
  // Rotation d'un téléphone : portrait → paysage → portrait, bande arrêtée.
  for (const [w, h] of [[390, 780], [844, 390], [390, 780], [1100, 1000]]) {
    await A.size(w, h); await sleep(200);
    await arret(A, g1, `1er tirage fini, ${w}×${h}${w > h && h < 500 ? ' (paysage)' : ''}`);
  }
  await A.size(1100, 1000); await B.size(1100, 1000); await sleep(150);
  await A.shot('2-revelation-A'); await C.shot('2-revelation-C');

  // C recharge pendant la révélation : même tirage, rien de relancé.
  const nAvant = A.trames.filter((m) => m.session && m.session.draw && m.session.draw.status === 'pending').length;
  await C.reload();
  await C.until(`!document.getElementById('lobby').hidden && document.getElementById('hub-result').dataset.game`, 15000, 'reprise de C');
  const rc = await C.eval(VUE);
  t('reconnexion pendant la révélation : C retrouve LE MÊME jeu', rc.result === g1 && rc.n === 3);
  await sleep(300);
  t('reconnexion : aucun nouveau tirage (aucun « pending » de plus côté serveur)',
    A.trames.filter((m) => m.session && m.session.draw && m.session.draw.status === 'pending').length === nAvant && (A.session().draw.n === 1));

  // ═══ 5. CONTINUER : prêt pour la suite, rien d'effacé
  await A.click('#hub-continue');
  await B.until(`!document.getElementById('hub-ready').hidden`, 8000, 'prêt chez B');
  const r2 = await B.eval(VUE);
  t('continuer : le jeu est retenu, sans lancement (état debrief)', A.session().state === 'debrief' && r2.ready && r2.result === g1);
  t('continuer : l\'historique affiche le jeu tiré', new RegExp(TITRE[g1].replace(/[?]/g, '\\?')).test(r2.hist), r2.hist);
  const vA2 = await A.eval(VUE);
  t('« Tirage suivant » proposé à l\'hôte', vA2.drawBtn && /Tirage suivant/.test(vA2.drawLabel));
  const pct = (v, id) => { const g = v.games.find((x) => x.id === id); return g && g.ok ? +g.etat.match(/(\d+) %/)[1] : null; };
  const autres = ELIG.filter((id) => id !== g1);
  t('récence visible : le jeu tiré a maintenant moins de chances que les autres',
    autres.every((id) => pct(vA2, g1) < pct(vA2, id)), ELIG.map((id) => `${id} ${pct(vA2, id)} %`).join(' · '));

  // ═══ 6. deuxième tirage (à 390 px chez A : l'animation doit rester lisible)
  await A.size(390, 780); await sleep(200);
  await A.click('#hub-draw-btn');
  const d2 = await (async () => { for (let i = 0; i < 120; i++) { const d = A.drawn(2); if (d) return d; await sleep(50); } return null; })();
  t('2e tirage : même session, même code', !!d2 && A.session().code === code && (await B.eval(VUE)).code === code);
  t('2e tirage : history.played contient le premier jeu, en tête', JSON.stringify(A.session().history.played) === JSON.stringify([g1, d2.gameId]));
  const base = (id) => (id === 'passeur' ? 1.5 : 1);
  t('2e tirage : la sélection a pris la récence en compte (poids ×0,15)', d2.weights[g1] === Math.round(base(g1) * 0.15 * 10000) / 10000,
    JSON.stringify(d2.weights));
  if (!REDUCED) {
    await sleep(700);
    const mid = await A.eval(`(() => { const r = document.getElementById('hub-draw').getBoundingClientRect(); const reel = document.getElementById('hub-reel').getBoundingClientRect();
      return { l: r.left, r: r.right, w: innerWidth, over: document.documentElement.scrollWidth - innerWidth, reelTop: Math.round(reel.top), reelBas: Math.round(reel.bottom), h: innerHeight }; })()`);
    t('390 px : la caisse tient en largeur pendant l\'animation', mid.l >= 0 && mid.r <= mid.w && mid.over <= 0, JSON.stringify(mid));
    // L'hôte a cliqué « Tirer » tout en bas de la liste : la bande doit être
    // À L'ÉCRAN pendant qu'elle défile, pas quelque part au-dessus.
    t('390 px : la bande qui défile est à l\'écran (la page est venue à la caisse)', mid.reelTop >= 0 && mid.reelBas <= mid.h, JSON.stringify(mid));
    await A.shot('3-animation-390');
    // Lot E : la fenêtre change EN PLEIN défilement (390 → 1100 px : bande de
    // 292 → 560 px, vignettes de 92 → 104 px). La bande doit finir sur le même
    // jeu, sous le repère — nouvelle cible, même fin.
    const enCours = await A.eval(`document.getElementById('hub-reel').classList.contains('is-spinning')`);
    await A.size(1100, 1000);
    t('2e tirage : redimensionné pendant que la bande défile encore', enCours);
  }
  for (const J of [A, B, C]) await J.until(`document.getElementById('hub-result').dataset.game === ${JSON.stringify(d2.gameId)} && !document.getElementById('hub-result').hidden`, 12000, `2e révélation chez ${J.nom}`);
  t('2e révélation = le jeu du serveur, chez les trois', true, d2.gameId);
  await arret(A, d2.gameId, REDUCED ? '2e tirage, lancé à 390 px' : '2e tirage, lancé à 390 px, fini à 1100 px');
  await A.shot('3b-2e-tirage-arret');
  for (const [w, h] of [[390, 780], [768, 1024], [1100, 1000], [390, 780]]) {
    await A.size(w, h); await sleep(200);
    await arret(A, d2.gameId, `2e tirage fini, redimensionné à ${w} px`);
  }
  await A.shot('3c-2e-tirage-390-apres-resize');
  await A.click('#hub-continue');
  await A.until(`!document.getElementById('hub-ready').hidden`, 8000);

  // ═══ 7. responsive : 390 / 768 / 1920
  for (const [w, h] of [[390, 780], [768, 1024], [1920, 1080]]) {
    await A.size(w, h); await sleep(250);
    const m = await A.eval(`(() => {
      const vis = (id) => { const e = document.getElementById(id); if (!e || e.hidden) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.left >= -1 && r.right <= innerWidth + 1; };
      const stage = document.getElementById('hub-draw').getBoundingClientRect();
      const pps = [...document.querySelectorAll('#hub-players .g-av')].map((a) => a.getBoundingClientRect().width);
      const boutons = [...document.querySelectorAll('#hub-games button, #hub-draw-btn, #hub-leave')].filter((b) => !b.hidden && b.offsetParent);
      return { over: document.documentElement.scrollWidth - innerWidth,
        caisse: stage.left >= -1 && stage.right <= innerWidth + 1 && stage.height <= innerHeight, caisseH: Math.round(stage.height),
        code: vis('hub-code'), tirer: vis('hub-draw-btn'), pp: pps.length === 3 && pps.every((x) => x >= 44),
        boutons: boutons.every((b) => { const r = b.getBoundingClientRect(); return r.left >= -1 && r.right <= innerWidth + 1 && r.height >= 36; }) }; })()`);
    t(`${w}×${h} : aucun débordement horizontal`, m.over <= 0, String(m.over));
    t(`${w}×${h} : caisse entièrement visible (${m.caisseH} px de haut)`, m.caisse);
    t(`${w}×${h} : code, bouton de tirage, PP (≥ 44 px) et boutons accessibles`, m.code && m.tirer && m.pp && m.boutons, JSON.stringify(m));
    const pl = await A.eval(PLAQUE);
    t(`${w}×${h} : caisse ouverte, le couvercle ne recouvre pas la plaque`, pl && pl.ouvert && pl.ok, JSON.stringify(pl));
    await arret(A, d2.gameId, `${w}×${h}, après « Continuer »`);
    await A.shot(`4-hub-${w}`);
  }
  for (const [w, h] of [[1280, 900], [1100, 1000]]) {
    await A.size(w, h); await sleep(250);
    const pl = await A.eval(PLAQUE);
    t(`${w}×${h} : caisse ouverte, le couvercle ne recouvre pas la plaque`, pl && pl.ouvert && pl.ok, JSON.stringify(pl));
    await A.shot(`4-caisse-${w}`);
  }
  await A.size(1100, 1000);

  // ═══ 7 bis. un 3e tirage APRÈS toute cette série de redimensionnements
  // (1100 → 390 → 768 → 1920 → 1280 → 1100) : sa géométrie repart de zéro,
  // et il suit encore la fenêtre une fois arrêté.
  await sleep(200);
  await A.click('#hub-draw-btn');
  const d3 = await (async () => { for (let i = 0; i < 120; i++) { const d = A.drawn(3); if (d) return d; await sleep(50); } return null; })();
  t('3e tirage : tiré par le serveur', !!d3 && !!d3.gameId, d3 && d3.gameId);
  for (const J of [A, B]) await J.until(`document.getElementById('hub-result').dataset.game === ${JSON.stringify(d3.gameId)} && !document.getElementById('hub-result').hidden`, 12000, `3e révélation chez ${J.nom}`);
  await arret(A, d3.gameId, '3e tirage, 1100 px');
  await arret(B, d3.gameId, '3e tirage, 1100 px');
  await A.size(390, 780); await sleep(200);
  await arret(A, d3.gameId, '3e tirage fini, redimensionné à 390 px');
  await A.shot('4b-3e-tirage-390');
  await A.size(1100, 1000); await sleep(150);
  await A.click('#hub-continue');
  await A.until(`!document.getElementById('hub-ready').hidden`, 8000);

  // ═══ 8. aucun jeu possible : le salon explique, le bouton se tait
  for (const id of ['imitation', 'demicercle', 'ban', 'passeur', 'quiment']) await B.click(`#hub-games [data-pref=veto][data-game=${id}]`);
  await A.until(`(${VUE}).eligibles.length === 0`, 8000, 'plus aucun éligible');
  const v8 = await A.eval(VUE), v8c = await C.eval(VUE);
  t('aucun jeu possible : le salon le dit, chez tout le monde', v8.none && v8c.none && /Aucun jeu possible/.test(v8.noneTxt));
  t('aucun jeu possible : le bouton de tirage est désactivé chez l\'hôte', v8.drawBtn && v8.drawBtnOff);
  t('aucun jeu possible : chaque jeu garde sa raison (les vetos nomment Bruno)', v8.games.filter((g) => /veto de Bruno/.test(g.etat)).length === 6);
  const c8 = await B.eval(`({ ok: document.querySelectorAll('#hub-games-ok .hub-game').length, ouvert: document.getElementById('hub-out').open,
    none: document.getElementById('hub-none').textContent })`);
  t('aucun jeu possible : la liste des indisponibles s\'ouvre d\'elle-même (les raisons deviennent l\'essentiel)',
    c8.ok === 0 && c8.ouvert && /liste des indisponibles/.test(c8.none), JSON.stringify(c8));
  await A.shot('5-aucun-jeu');
  for (const id of ['imitation', 'demicercle', 'ban', 'passeur', 'quiment']) await B.click(`#hub-games [data-pref=veto][data-game=${id}]`);
  await A.until(`(${VUE}).eligibles.length === ${ELIG.length}`, 8000, 'vetos levés');
  t('B lève SES vetos : les jeux reviennent', true);

  // ═══ 9. le même front devant le Hub d'AVANT le randomizer
  if (ancienDir) {
    const D = await joueur(cdp, 'D');
    await D.goto(`${BASE}/games/?hub=${encodeURIComponent(OLD)}`);
    await D.type('#name-input', 'Dan');
    await D.click('#identity-done');
    await D.click('#hub-create');
    await D.until(`!document.getElementById('lobby').hidden && document.querySelectorAll('#hub-players .hub-card').length === 1`, 15000, 'salon sur l\'ancien Hub');
    const v9 = await D.eval(VUE);
    t('ancien Hub : le salon fonctionne, sans bloc de tirage', !v9.drawBtn && await D.eval(`document.getElementById('hub-pool').hidden`));
    t('ancien Hub : la page le dit honnêtement', /pas encore le tirage/.test(v9.wait), v9.wait);
    t('ancien Hub : ni « [obj », ni « undefined », ni erreur JS', !/\[obj|undefined|NaN/.test(v9.texte) && D.erreurs.length === 0, D.erreurs.join(' | '));
    await D.shot('6-ancien-hub');
  } else {
    t('ancien Hub : extraction git impossible sur ce poste', false);
  }

  // ═══ 10. UN SERVEUR DE JEU ENDORMI NE BLOQUE PLUS RIEN
  // ⚠️⚠️ C'EST LA RÈGLE DE FOND, ET C'EST ELLE QUI A COÛTÉ UNE SOIRÉE.
  // Le /health du Passeur répond 503 en permanence : c'est un serveur mort —
  // et c'est exactement la tête qu'a un serveur Render endormi. Passeur, seul
  // jeu possible, doit quand même être TIRÉ et RÉVÉLÉ, tout de suite, sans
  // qu'un seul /health soit appelé avant. Son serveur se réveillera plus tard,
  // quand la page du Passeur s'y connectera (handoff : tests/handoff-play.mjs).
  // ⚠️ Hub NEUF (WAKE_PORT) : cache de santé vierge, rien d'hérité de l'autre.
  {
    santeWake.set('passeur', { code: 503, delay: 0 });
    const E = await joueur(cdp, 'E');
    await E.goto(`${BASE}/games/?hub=${encodeURIComponent(`ws://127.0.0.1:${WAKE_PORT}`)}`);
    await E.type('#name-input', 'Eve');
    await E.click('#identity-done');
    await E.click('#hub-create');
    await E.until(`!document.getElementById('lobby').hidden && document.querySelectorAll('#hub-games .hub-game').length === 8`, 20000, 'salon de E');
    // Seule à bord : on ne laisse qu'UN jeu possible, pour que le résultat soit
    // connu d'avance — c'est le test « 1 joueur, Passeur seul éligible ».
    // ⚠️ Avant de réduire : à 1 joueur, Imitation et le Ban doivent être bloqués
    // par leur MINIMUM DE JOUEURS, et par rien d'autre — plus jamais par une
    // capacité non déclarée.
    const solo = await E.eval(VUE);
    t('1 joueur : Imitation bloquée par les 2 joueurs, pas par le micro',
      /il faut 2 joueurs/.test(solo.games.find((g) => g.id === 'imitation').etat)
      && !/micro/i.test(solo.games.find((g) => g.id === 'imitation').etat), solo.games.find((g) => g.id === 'imitation').etat);
    t('1 joueur : le Ban bloqué par les 2 joueurs, pas par l\'avertissement',
      /il faut 2 joueurs/.test(solo.games.find((g) => g.id === 'ban').etat)
      && !/avertissement/i.test(solo.games.find((g) => g.id === 'ban').etat), solo.games.find((g) => g.id === 'ban').etat);
    for (const id of ['precision', 'puissance4']) await E.click(`#hub-games [data-pref=veto][data-game=${id}]`);
    await E.until(`(${VUE}).eligibles.length === 1 && (${VUE}).eligibles[0] === 'passeur'`, 8000, 'Passeur seul éligible');
    t('1 joueur : Passeur reste proposé malgré son serveur muet', true);

    const avantSante = santeWake.appels.length;
    const t0 = Date.now();
    await E.click('#hub-draw-btn');

    // La VÉRITÉ est dans les trames : le serveur a-t-il tranché tout de suite ?
    let dTrame = null;
    for (let i = 0; i < 100 && !dTrame; i++) {
      dTrame = E.trames.map((m) => m.session && m.session.draw).filter((d) => d && d.status === 'drawn').pop() || null;
      if (!dTrame) await sleep(50);
    }
    const msServeur = Date.now() - t0;
    t('1 joueur : le serveur tire Passeur', !!dTrame && dTrame.gameId === 'passeur', dTrame && dTrame.gameId);
    t('1 joueur : il tranche tout de suite, sans attendre un /health', !!dTrame && msServeur < 2000, `${msServeur} ms`);
    t('1 joueur : AUCUN /health appelé avant la révélation', santeWake.appels.length - avantSante === 0,
      santeWake.appels.slice(avantSante).map((a) => a.id).join(',') || 'aucun appel');

    // L'écran, pendant l'animation de la caisse : rien ne doit parler de réveil.
    const vus = [];
    for (let i = 0; i < 60; i++) {
      vus.push(await E.eval(`(() => ({ reveil: !!document.getElementById('hub-waking'),
        statut: document.getElementById('hub-draw-status').textContent,
        msg: document.getElementById('hub-lobby-msg').textContent,
        vu: !document.getElementById('hub-result').hidden,
        jeu: document.getElementById('hub-result').dataset.game, dec: ${DECALAGE},
        bande: document.getElementById('hub-reel').checkVisibility() }))()`));
      if (vus[vus.length - 1].vu) break;
      await sleep(100);
    }
    const fin = vus[vus.length - 1];
    const msRevele = Date.now() - t0;
    t('1 joueur : la caisse révèle Passeur', fin.vu && fin.jeu === 'passeur', JSON.stringify(fin));

    // Lot C — UN SEUL JEU POSSIBLE : révélation directe. Pas de bande qui
    // fait défiler trente fois le même jeu, pas de suspense simulé ; le
    // résultat est celui du serveur (vérifié juste au-dessus dans les trames).
    const rs = await E.eval(REVELE);
    t('un seul jeu : pas de faux défilement (bande jamais affichée, jamais déplacée)',
      vus.every((v) => !v.bande && Math.round(v.dec) === 0) && rs.single && !rs.reelVue && rs.cellules === 1,
      JSON.stringify({ single: rs.single, bande: rs.reelVue, n: rs.cellules, dec: [...new Set(vus.map((v) => Math.round(v.dec)))] }));
    t('un seul jeu : révélé tout de suite (pas les ~3,4 s de la bande)', msRevele < 1500, `${msRevele} ms`);
    t('un seul jeu : « Seul jeu possible ce soir » (sans dé), et l\'état le dit aussi', /Seul jeu possible/.test(rs.kicker) && rs.statut === 'Seul jeu possible : Le Passeur.', `${rs.kicker} / ${rs.statut}`);
    t('un seul jeu : le nom domine la fiche, le focus est sur « Continuer »', rs.titre > rs.autres && rs.focus === 'hub-continue', `${rs.titre} > ${rs.autres}, focus ${rs.focus}`);
    for (const [w, h] of [[390, 780], [768, 1024], [1100, 1000], [1280, 900]]) {
      await E.size(w, h); await sleep(200);
      await E.eval(`document.getElementById('hub-draw').scrollIntoView({ block: 'start', behavior: 'instant' }); true`);
      const v = await E.eval(REVELE);
      const pl = await E.eval(PLAQUE);
      t(`un seul jeu, ${w} px : caisse ouverte, nom et « Continuer » à l'écran, sans débordement`,
        v.over <= 0 && v.titreVu && v.contVu && pl && pl.ouvert && pl.ok, JSON.stringify({ over: v.over, titre: v.titreVu, cont: v.contVu, pl }));
      await E.shot(`7-un-seul-jeu-${w}`);
    }
    await E.size(1100, 1000); await sleep(150);
    t('1 joueur : la caisse s\'ouvre sans attente de serveur', Date.now() - t0 < 20000, `${Date.now() - t0} ms`);
    // ⚠️ Le bloc « Réveil du serveur… » a été retiré : plus rien ne pose
    // `waking`, puisque le tirage ne consulte plus aucun /health. S'il
    // réapparaît, c'est qu'une attente de serveur s'est réinvitée dans le
    // chemin du tirage.
    t('1 joueur : aucun bloc « Réveil du serveur… » dans la page', vus.every((v) => !v.reveil),
      `${vus.filter((v) => v.reveil).length} relevé(s) sur ${vus.length}`);
    t('1 joueur : aucun message d\'erreur (ni NO_SERVER_AVAILABLE, ni refus générique)',
      vus.every((v) => !/refus|indisponible|ne répond/i.test(v.msg)), fin.msg);
    t('1 joueur : aucune erreur JS', E.erreurs.length === 0, E.erreurs.join(' | '));
    await E.shot('7-serveur-endormi');

    // Et « continuer » rend la main au Hub, prêt pour le lancement — AU
    // CLAVIER : le focus est déjà sur le bouton, une vraie touche Entrée suffit.
    await E.eval(`document.getElementById('hub-continue').focus({ preventScroll: true }); true`);
    await E.enter();
    await E.until(`document.getElementById('hub-draw-btn') && !document.getElementById('hub-draw-btn').disabled && document.getElementById('hub-continue').hidden`, 8000, 'retour au salon');
    t('1 joueur : « continuer » à la touche Entrée ramène au Hub, prêt à relancer', true);
  }

  const errs = [A, B, C].flatMap((J) => J.erreurs.map((e) => `[${J.nom}] ${e}`));
  t('aucune erreur JS dans les trois pages', errs.length === 0, errs.slice(0, 3).join(' | '));
  // ⚠️ Plus aucun /health n'est appelé : le tirage n'en dépend plus, et rien
  // d'autre ne réveille les serveurs de jeu à l'avance.
  t('santé des jeux : aucun serveur de jeu n\'a été réveillé de toute la session',
    sante.appels.length === 0, sante.appels.map((a) => a.id).join(',') || 'aucun appel');
} catch (e) {
  t('EXCEPTION', false, e.message);
} finally {
  stop();
}

console.log(`\n${ko ? 'DES TESTS ÉCHOUENT' : 'TOUT PASSE'} — ${out.length} vérifications, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
