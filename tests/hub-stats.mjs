// Les STATISTIQUES DE JOUEUR dans le Game Hub (lot H) : la vraie page /games/,
// de vrais navigateurs, un VRAI game-hub-server local (statistiques en mémoire,
// HUB_STATS=memory) — et un second Hub SANS statistiques.
//
//   node tests/hub-stats.mjs              mouvement normal
//   node tests/hub-stats.mjs --reduced    mouvement réduit
//   node tests/hub-stats.mjs --shots <d>  captures (vide, rempli 390 / 1280, solo, indisponible)
//
// ⚠️ LA SOURCE DE VÉRITÉ EST LE HUB. Les définitions, les doublons, la clé, la
// panne et le SQL sont éprouvés côté serveur (game-hub-server, test-stats.js).
// Ici : ce que la PAGE en montre, et qu'elle ne montre que ça. Les parties
// classées sont jouées par des clients Node (protocole du Hub, aucun jeu), avec
// l'id ET la clé du profil du navigateur, qui reprend ensuite la session.
//
// Scénarios : A nouveau joueur (« Aucune partie jouée », pas de zéros) ;
// B–G quatre parties (1er, 2e, 4e, 1er ex æquo) sur trois jeux → 4 parties,
// 2 victoires, 3 podiums, meilleure place 1er, ventilées par jeu ; H un joueur
// parti compte ; I le classement renvoyé ne recompte rien ; J rechargement ;
// K par jeu ; L pseudo changé ; M clé qui ne correspond pas, Hub sans
// statistiques ; solo seulement (pas de « victoire ») ; N 390 → 1280 px ;
// clavier et annonce.
//
// Records personnels (lot I, `stats.records`, calculés par le Hub dans la même
// réponse) : « Pas encore de record » sans partie, « Aucun record compétitif »
// en solo, meilleure place / victoires / jeu le plus joué / meilleur jeu, une
// égalité montre les deux jeux, un nom long finit en « … », la meilleure place
// par jeu dans « Par jeu », rien d'un autre joueur.
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
const R = () => Math.floor(Math.random() * 300);
const HTTP_PORT = 8700 + R(), CDP_PORT = 9700 + R(), HUB_PORT = 8100 + R(), SANS_PORT = 7400 + R(), HEALTH_PORT = 6400 + R();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KEY = 'mathys_game_profile';

let out = [], ko = 0;
const t = (nom, ok, detail = '') => {
  out.push(`${ok ? 'OK  ' : 'KO  '} ${nom}${detail ? ' — ' + detail : ''}`);
  if (!ok) ko++;
  console.log(out[out.length - 1]);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// --- serveurs (local) -------------------------------------------------------------
const HUB = `ws://127.0.0.1:${HUB_PORT}`, SANS = `ws://127.0.0.1:${SANS_PORT}`;
const procs = [];
const lance = (cwd, file, port, env = {}) => {
  const p = spawn(process.execPath, [file], { cwd, env: { ...process.env, PORT: String(port), HUB_QUIET: '1', ...env }, stdio: 'ignore' });
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

// --- CDP (même plomberie que hub-profile.mjs) --------------------------------------
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
  const J = { nom, erreurs: [], envoyes: [], recus: [] };
  cdp.on(sessionId, (m) => {
    const p = m.params || {};
    if (m.method === 'Runtime.exceptionThrown') J.erreurs.push((p.exceptionDetails.exception?.description || p.exceptionDetails.text || '').split('\n')[0]);
    if (m.method === 'Network.webSocketFrameSent') { try { J.envoyes.push(JSON.parse(p.response.payloadData)); } catch (_) {} }
    if (m.method === 'Network.webSocketFrameReceived') { try { J.recus.push(JSON.parse(p.response.payloadData)); } catch (_) {} }
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
  J.until = async (expr, ms = 10000, label = expr) => {
    const fin = Date.now() + ms;
    while (Date.now() < fin) { try { const v = await J.eval(expr); if (v) return v; } catch (_) {} await sleep(80); }
    throw new Error(`[${nom}] attente expirée : ${label}`);
  };
  J.goto = async (url) => { await S('Page.navigate', { url }); await J.until(`document.readyState === 'complete' && !!window.GameHub && !!window.GameProfile`, 30000, 'chargement ' + url); await sleep(150); };
  J.click = async (sel) => {
    const box = await J.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'center', behavior: 'instant' });
      const r = e.getBoundingClientRect(); return r.width && r.height ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; })()`);
    if (!box) throw new Error(`[${nom}] introuvable ou invisible : ${sel}`);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await S('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
    await sleep(100);
  };
  J.type = async (sel, text) => { await J.click(sel); await J.eval(`document.querySelector(${JSON.stringify(sel)}).select()`); await S('Input.insertText', { text }); await sleep(60); };
  J.enter = async () => {
    await S('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
    await S('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await sleep(150);
  };
  J.escape = async () => {
    for (const type of ['rawKeyDown', 'keyUp']) await S('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(150);
  };
  J.shot = async (nomFichier) => {
    if (!SHOTS) return;
    await sleep(200);
    const r = await S('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOTS, (REDUCED ? 'r-' : '') + nomFichier + '.png'), Buffer.from(r.result.data, 'base64'));
  };
  J.profil = () => J.eval(`JSON.parse(localStorage.getItem(${JSON.stringify(KEY)}))`);
  return J;
}

// ═══════════════════════════════════════════ la vraie page, les vrais Hubs
const WS = createRequire(path.join(ROOT, '..', 'game-hub-server', 'package.json'))('ws');

// ═══ records relus en liste blanche (game-hub.js, sans navigateur)
{
  const GH = createRequire(import.meta.url)('../games/shared/game-hub.js');
  const base = { played: 2, solo: 0, wins: 1, podiums: 2, best: 1, games: [{ gameId: 'passeur', played: 2, solo: 0, wins: 1, podiums: 2, best: 1 }] };
  t('Hub d\'avant le lot I (pas de clé records) : la clé reste absente — la page cache la section', !('records' in GH.readStats(base).stats));
  t('records: null (aucune partie) : relu null', GH.readStats({ ...base, records: null }).stats.records === null);
  const forge = GH.readStats({ ...base, records: { best: 0, wins: -2, playerId: 'p_x', mostPlayed: { games: ['passeur', '<img>', 42], played: 2, by: 'p_x' },
    mostWins: { games: ['passeur'], wins: 'beaucoup' } } }).stats.records;
  t('records forgés : rangs invalides → null, ids de jeu filtrés, champs inconnus jetés', same(forge, { best: null, wins: null, mostPlayed: { games: ['passeur'], played: 2 }, mostWins: null }), JSON.stringify(forge));
}
const sante = await fakeHealth(HEALTH_PORT);
const MANIFEST = localManifest(ROOT, HEALTH_PORT);
const HUBDIR = path.join(ROOT, '..', 'game-hub-server');
lance(HUBDIR, 'src/server.js', HUB_PORT, { MANIFEST_FILE: MANIFEST, HUB_STATS: 'memory' });
lance(HUBDIR, 'src/server.js', SANS_PORT, { MANIFEST_FILE: MANIFEST, HUB_STATS: '' });
const srv = await serve();
await attends(`http://127.0.0.1:${HUB_PORT}/health`);
await attends(`http://127.0.0.1:${SANS_PORT}/health`);
const PAGE = `http://127.0.0.1:${HTTP_PORT}/games/?hub=${encodeURIComponent(HUB)}`;
const PAGE_SANS = `http://127.0.0.1:${HTTP_PORT}/games/?hub=${encodeURIComponent(SANS)}`;
const TOUS = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')).games.map((g) => g.id);

function client(nom) {
  const ws = new WS(HUB);
  const c = { ws, nom, msgs: [] };
  ws.on('message', (raw) => c.msgs.push(JSON.parse(raw)));
  ws.on('error', () => {});
  c.open = new Promise((res) => ws.on('open', res));
  c.send = (o) => ws.send(JSON.stringify(o));
  c.mark = () => c.msgs.length;
  c.waitFor = (pred, ms = 5000, from = 0) => new Promise((resolve, reject) => {
    const fin = Date.now() + ms;
    const voir = () => {
      const m = c.msgs.slice(from).reverse().find(pred);
      if (m) return resolve(m);
      if (Date.now() > fin) return reject(new Error(`${nom} : condition non atteinte en ${ms} ms`));
      setTimeout(voir, 10);
    };
    voir();
  });
  c.until = (pred, ms, from) => c.waitFor((m) => m.session && pred(m.session), ms, from).then((m) => m.session);
  c.last = () => { const m = [...c.msgs].reverse().find((x) => x.session); return m && m.session; };
  c.stats = async () => { const m = c.mark(); c.send({ action: 'stats' }); return (await c.waitFor((x) => x.type === 'stats', 5000, m)); };
  c.fermer = () => new Promise((res) => { if (ws.readyState === ws.CLOSED) return res(); ws.once('close', res); ws.close(); });
  return c;
}
// `key` : la clé du profil (celle du navigateur quand un client Node joue pour lui).
async function entre(nom, id, code, key, name = nom) {
  const c = client(nom); await c.open;
  const player = Object.assign({ id, name, avatar: { kind: 'emoji', emoji: '🦊' } }, key ? { key } : {});
  c.send(code ? { action: 'join', code, player } : { action: 'create', player });
  await c.waitFor((m) => m.type === 'joined' || m.type === 'created');
  await sleep(40);
  return c;
}
async function partie(hote, autres, gameId, rangs, avantResultats) {
  await hote.until((s) => s.pool && s.pool.catalog === 'ready', 8000);
  hote.send({ action: 'prefs', love: [], veto: TOUS.filter((g) => g !== gameId) });
  await hote.until((s) => same(s.pool.eligible, [gameId]), 5000);
  let m = hote.mark();
  hote.send({ action: 'draw' });
  const d = (await hote.until((s) => s.draw && s.draw.status === 'drawn' && s.draw.gameId === gameId, 8000, m)).draw;
  m = hote.mark(); hote.send({ action: 'continue' }); await hote.until((s) => s.state === 'launching', 5000, m);
  hote.send({ action: 'launched', drawId: d.id, roomCode: 'KQMP', gamePlayerId: 'g-' + hote.nom });
  for (const c of autres) {
    await c.until((s) => s.launch && s.launch.drawId === d.id && s.launch.stage === 'join', 5000);
    c.send({ action: 'entered', drawId: d.id, roomCode: 'KQMP', gamePlayerId: 'g-' + c.nom });
  }
  await hote.until((s) => s.state === 'inGame', 5000);
  if (avantResultats) await avantResultats();
  const results = [hote, ...autres].map((c) => ({ gamePlayerId: 'g-' + c.nom, rank: rangs[c.nom], points: 100 - rangs[c.nom] }));
  m = hote.mark();
  hote.send({ action: 'results', drawId: d.id, gameId, results });
  await hote.until((s) => s.history.games.some((g) => g.drawId === d.id), 5000, m);
  // I. Le même classement, renvoyé tout de suite (un retry de la page) : refusé.
  m = hote.mark();
  hote.send({ action: 'results', drawId: d.id, gameId, results });
  hote.refus = (await hote.waitFor((x) => x.type === 'error', 3000, m)).code;
  m = hote.mark(); hote.send({ action: 'ended', drawId: d.id });
  await hote.until((s) => s.state === 'debrief', 5000, m);
  await sleep(60);
  return d.id;
}

// Ce que le panneau montre des statistiques.
const STATS = `(() => { const q = (s) => document.getElementById(s);
  const figs = [...document.querySelectorAll('#profile-figures .profile-figure')].map((f) => ({ mot: f.querySelector('dt').textContent,
    n: f.querySelector('b').textContent, detail: f.querySelector('small').textContent }));
  const jeux = [...document.querySelectorAll('#profile-games .profile-game')].map((li) => ({ id: li.dataset.game,
    nom: li.querySelector('.profile-game-name').textContent, meta: li.querySelector('.profile-game-meta').textContent }));
  return { ouvert: q('profile-dialog').open, note: q('profile-stats-note').hidden ? null : q('profile-stats-note').textContent,
    figuresVues: !q('profile-figures').hidden, figs, jeuxVus: !q('profile-games').hidden, jeux,
    live: q('profile-stats-live').textContent, busy: q('profile-stats').getAttribute('aria-busy'),
    recVus: !q('profile-records').hidden, recNote: q('profile-records-note').hidden ? null : q('profile-records-note').textContent,
    recListe: !q('profile-records-list').hidden,
    recs: [...document.querySelectorAll('#profile-records-list .profile-record')].map((f) => ({ cle: f.dataset.record,
      mot: [...f.querySelector('dt').childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim(), emojiCache: f.querySelector('dt [aria-hidden="true"]') !== null,
      jeux: [...f.querySelectorAll('.profile-record-game')].map((n) => n.textContent), n: f.querySelector('b').textContent,
      lu: f.querySelector('b').textContent, detail: f.querySelector('small').textContent })),
    texte: q('profile-stats').innerText, focus: document.activeElement && document.activeElement.id }; })()`;
const fig = (v, mot) => (v.figs.find((f) => f.mot === mot) || {}).n;
const rec = (v, cle) => v.recs.find((r) => r.cle === cle);
// Ouvre le panneau et attend que les statistiques soient arrivées (ou dites indisponibles).
async function ouvre(J) {
  await J.click('#hub-profile-btn');
  await J.until(`document.getElementById('profile-dialog').open && !document.getElementById('profile-stats').hasAttribute('aria-busy')
    && !!document.getElementById('profile-stats-live').textContent`, 8000, 'statistiques affichées');
  return J.eval(STATS);
}
const ferme = (J) => J.click('#profile-close');
// Rien ne déborde : le panneau dans l'écran (défilement vertical permis dans le
// <dialog>), les chiffres et les lignes de jeux dans le panneau.
const GEOM = `(() => { const R = (e) => e.getBoundingClientRect(); const dlg = document.getElementById('profile-dialog'), p = R(dlg);
  const sec = R(document.getElementById('profile-stats'));
  const dedans = (e) => { const r = R(e); return r.left >= sec.left - 0.5 && r.right <= sec.right + 0.5; };
  const figs = [...document.querySelectorAll('#profile-figures .profile-figure, #profile-records-list .profile-record')], jeux = [...document.querySelectorAll('#profile-games .profile-game')];
  const coupe = [...document.querySelectorAll('.profile-figure b, .profile-figure dt, .profile-game-meta')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent);
  const noms = [...document.querySelectorAll('.profile-game-name, .profile-record-game')];
  return { largeur: innerWidth, scrollX: document.documentElement.scrollWidth - innerWidth,
    panneau: p.left >= 0 && p.right <= innerWidth + 0.5 && p.top >= 0 && p.bottom <= innerHeight + 0.5,
    figures: figs.every(dedans), jeux: jeux.every(dedans), coupe,
    noms: noms.every((n) => getComputedStyle(n).textOverflow === 'ellipsis' && R(n).right <= sec.right + 0.5),
    colonnes: getComputedStyle(document.getElementById('profile-figures')).gridTemplateColumns.split(' ').length,
    colRecords: getComputedStyle(document.getElementById('profile-records-list')).gridTemplateColumns.split(' ').length,
    tronques: noms.filter((n) => n.scrollWidth > n.clientWidth + 1).map((n) => n.textContent) }; })()`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hubstats-'));
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${dir}`, '--no-first-run',
  '--disable-features=BackForwardCache', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank'], { stdio: 'ignore' });
let cdp = null;
const clients = [];

try {
  cdp = await cdpBrowser();
  console.log(`Statistiques de joueur du Game Hub — vrais navigateurs, vrai Hub (${REDUCED ? 'mouvement RÉDUIT' : 'mouvement normal'})\n`);

  // ═══ A. nouveau joueur
  const A = await joueur(cdp, 'A');
  await A.goto(PAGE);
  const pA = await A.profil();
  t('le profil a une clé (32 octets en base64url), écrite dès la première visite', /^[A-Za-z0-9_-]{43}$/.test(pA.key), pA.key && pA.key.length);
  await A.type('#name-input', 'Mathys');
  await A.click('#identity-done');
  await A.click('#hub-create');
  await A.until(`!document.getElementById('lobby').hidden`, 10000, 'salon de A');
  const cree = A.envoyes.find((m) => m.action === 'create');
  t('la clé part au Hub avec create… et JAMAIS dans ce que le Hub renvoie', cree.player.key === pA.key && !JSON.stringify(A.recus).includes(pA.key));
  t('le Hub annonce ses statistiques (created.stats)', A.recus.some((m) => m.type === 'created' && m.stats === true));
  const v0 = await ouvre(A);
  t('A. nouveau joueur : « Aucune partie jouée », aucun chiffre, aucun jeu', /^Aucune partie jouée/.test(v0.note || '') && !v0.figuresVues && !v0.jeuxVus && !/\b0\b/.test(v0.texte), JSON.stringify({ note: v0.note, texte: v0.texte }));
  t('A. … et c\'est annoncé (role="status")', /Aucune partie jouée/.test(v0.live), v0.live);
  t('A. records : « Pas encore de record. », aucune carte (pas de collection de zéros)', v0.recVus && v0.recNote === 'Pas encore de record.' && !v0.recListe && !v0.recs.length
    && /Pas encore de record/.test(v0.live), JSON.stringify({ note: v0.recNote, live: v0.live }));
  await A.shot('A-stats-vides');
  await ferme(A);

  // ═══ B–I. quatre parties jouées par le protocole avec l'id ET la clé de A
  await A.eval(`document.getElementById('hub-leave').click(); true`);
  const na = await entre('Mat', pA.id, null, pA.key, 'Mathys');
  const code = na.last().code;
  const nb = await entre('Bob', 'p_statb', code, 'b'.repeat(40)), nc = await entre('Cam', 'p_statc', code, 'c'.repeat(40)), nd = await entre('Dan', 'p_statd', code, 'd'.repeat(40));
  clients.push(na, nb, nc, nd);
  await partie(na, [nb, nc, nd], 'passeur', { Mat: 1, Bob: 2, Cam: 3, Dan: 4 });      // B/C : victoire
  t('I. classement renvoyé : refusé par le Hub', na.refus === 'RESULTS_ALREADY', na.refus);
  await partie(na, [nb, nc, nd], 'demicercle', { Mat: 2, Bob: 1, Cam: 3, Dan: 4 });   // D : 2e
  await partie(na, [nb, nc, nd], 'passeur', { Mat: 4, Bob: 1, Cam: 2, Dan: 3 });      // F : 4e
  // G : ex æquo en tête (Mat et Bob), H : Cam part de la session après s'être assise.
  await partie(na, [nb, nc, nd], 'precision', { Mat: 1, Bob: 1, Cam: 3, Dan: 4 }, async () => {
    nc.send({ action: 'leave' });
    await na.until((s) => !s.players.some((p) => p.id === 'p_statc'), 3000);
  });
  await na.fermer();
  await A.eval(`sessionStorage.setItem('mathys_hub_session', ${JSON.stringify(code)}); true`);
  await A.goto(PAGE);
  await A.until(`!document.getElementById('lobby').hidden`, 10000, 'A de retour au salon');
  const v1 = await ouvre(A);
  t('B–G. 4 parties, 2 victoires (1er, 1er ex æquo), 3 podiums, meilleure place 1er',
    fig(v1, 'parties') === '4' && fig(v1, 'victoires') === '2' && fig(v1, 'podiums') === '3' && fig(v1, 'meilleure place') === '1er', JSON.stringify(v1.figs));
  t('chaque chiffre dit ce qu\'il compte, en toutes lettres', v1.figs.every((f) => f.detail.length > 4)
    && /devant au moins un joueur/.test(v1.figs.find((f) => f.mot === 'victoires').detail) && /3 premiers/.test(v1.figs.find((f) => f.mot === 'podiums').detail));
  const jeu = (id) => (v1.jeux.find((j) => j.id === id) || {}).meta;
  t('K/E. par jeu, le plus joué d\'abord, avec la meilleure place : Passeur 2 · 1 · 1 · 1er ; Demi-Cercle 1 · 0 · 1 · 2e ; Précision 1 · 1 · 1 · 1er',
    v1.jeux[0].id === 'passeur' && jeu('passeur') === '2 parties · 1 victoire · 1 podium · meilleure place : 1er'
    && jeu('demicercle') === '1 partie · 0 victoire · 1 podium · meilleure place : 2e'
    && jeu('precision') === '1 partie · 1 victoire · 1 podium · meilleure place : 1er' && v1.jeux.length === 3, JSON.stringify(v1.jeux));
  t('records : quatre cartes, dans l\'ordre meilleure place, victoires, jeu le plus joué, meilleur(s) jeu(x)', same(v1.recs.map((r) => r.cle), ['best', 'wins', 'mostPlayed', 'mostWins'])
    && v1.recVus && v1.recNote === null, JSON.stringify(v1.recs));
  t('A/B. records : « Meilleure place 1er », « Victoires 2 » (la définition du lot H : le Hub, pas la page)',
    rec(v1, 'best').n === '1er' && rec(v1, 'best').mot === 'Meilleure place' && rec(v1, 'wins').n === '2' && rec(v1, 'wins').mot === 'Victoires', JSON.stringify(v1.recs.slice(0, 2)));
  t('C. records : « Jeu le plus joué · Le Passeur · 2 parties »', rec(v1, 'mostPlayed').mot === 'Jeu le plus joué' && same(rec(v1, 'mostPlayed').jeux, ['Le Passeur'])
    && rec(v1, 'mostPlayed').detail === '2 parties', JSON.stringify(rec(v1, 'mostPlayed')));
  t('D/égalité. meilleur jeu : Le Passeur ET Précision (1 victoire chacun), sans départage', rec(v1, 'mostWins').mot === 'Meilleurs jeux'
    && same(rec(v1, 'mostWins').jeux, ['Le Passeur', 'Précision']) && rec(v1, 'mostWins').detail === 'à égalité · 1 victoire chacun', JSON.stringify(rec(v1, 'mostWins')));
  t('records lisibles sans emoji : l\'emoji est caché aux lecteurs d\'écran, chaque carte a un libellé en mots et une précision', v1.recs.every((r) => r.emojiCache && r.mot.length > 4 && r.detail.length > 2));
  t('records : les deux jeux à égalité sont séparés pour le lecteur d\'écran (« Le Passeur et Précision »)', /Le Passeur\s*et\s*Précision/.test(rec(v1, 'mostWins').lu), rec(v1, 'mostWins').lu);
  t('rien d\'un autre joueur : ni nom ni id dans le panneau, ni dans les réponses stats', !/Bob|Cam|Dan/.test(v1.texte)
    && A.recus.filter((m) => m.type === 'stats').every((m) => !/p_stat[bcd]/.test(JSON.stringify(m))));
  t('K. les noms de jeux viennent du catalogue (Le Passeur, Demi-Cercle, Précision)', same(v1.jeux.map((j) => j.nom).sort(), ['Demi-Cercle', 'Le Passeur', 'Précision']));
  t('annonce : le résumé, puis les jeux en tête', v1.live === '4 parties, 2 victoires, 3 podiums, meilleure place : 1er. '
    + 'Records : jeu le plus joué : Le Passeur (2 parties) ; meilleurs jeux : Le Passeur et Précision (1 victoire chacun, à égalité).', v1.live);
  t('focus : sur « Fermer » à l\'ouverture', v1.focus === 'profile-close', v1.focus);
  await A.shot('B-stats-1280');
  // H. Cam, partie avant le classement de Précision : sa partie compte.
  const cam = await entre('Cam', 'p_statc', code, 'c'.repeat(40));
  clients.push(cam);
  const sc = (await cam.stats()).stats;
  t('H. joueur parti avant le classement : sa partie est comptée (4 parties, 3e à Précision)', sc.played === 4 && sc.games.find((g) => g.gameId === 'precision').best === 3, JSON.stringify(sc));
  // N. 390 → 1280 px, panneau ouvert.
  for (const [w, h] of [[390, 780], [768, 1024], [1100, 900], [1280, 900]]) {
    await A.size(w, h); await sleep(250);
    const g = await A.eval(GEOM);
    t(`N. ${w} px : panneau dans l'écran, chiffres et jeux dans le panneau, aucun texte coupé, noms en « … » si trop longs`,
      g.panneau && g.figures && g.jeux && !g.coupe.length && g.noms && g.scrollX <= 0 && g.colonnes === (w < 561 ? 2 : 4) && g.colRecords === 2, JSON.stringify(g));
    if (w === 390) { await A.shot('N-stats-390'); await A.eval(`document.getElementById('profile-records').scrollIntoView({ block: 'end', behavior: 'instant' }); true`); await A.shot('N-stats-390-bas'); }
  }
  await A.size(1280, 900);
  // Clavier : Échap ferme, le focus revient au bouton ; Entrée rouvre et redemande.
  await A.escape();
  t('clavier : Échap ferme, le focus revient à « ton profil »', await A.eval(`!document.getElementById('profile-dialog').open && document.activeElement.id === 'hub-profile-btn'`));
  const avantDemandes = A.envoyes.filter((m) => m.action === 'stats').length;
  await A.enter();
  await A.until(`!document.getElementById('profile-stats').hasAttribute('aria-busy') && !!document.getElementById('profile-stats-live').textContent`, 5000);
  t('clavier : Entrée rouvre, les statistiques sont redemandées (une demande par ouverture)', A.envoyes.filter((m) => m.action === 'stats').length === avantDemandes + 1);
  const vr = await A.eval(STATS);
  t('refermé puis rouvert : les mêmes records, sans doublon de cartes', same(vr.recs, v1.recs) && vr.recs.length === 4, JSON.stringify(vr.recs.map((r) => r.cle)));
  t('la demande ne porte RIEN (le Hub désigne le joueur par son socket)', A.envoyes.filter((m) => m.action === 'stats').every((m) => same(Object.keys(m), ['action'])));
  await ferme(A);

  // Noms longs : le catalogue de la page porte le titre ; on l'allonge et on rouvre à 390 px.
  await A.eval(`GAMES.find((g) => g.id === 'precision').title = 'Précision — édition spéciale du très long dimanche soir'; true`);
  await A.size(390, 780); await sleep(200);
  const vlong = await ouvre(A);
  const gl = await A.eval(GEOM);
  t('noms longs (390 px) : le nom du meilleur jeu finit en « … » dans sa carte, en entier dans son titre, rien ne déborde',
    gl.tronques.some((n) => /très long dimanche/.test(n)) && gl.noms && gl.figures && gl.panneau && gl.scrollX <= 0 && !gl.coupe.length
    && await A.eval(`[...document.querySelectorAll('.profile-record-game')].some((n) => n.title === n.textContent && /très long/.test(n.title))`),
    JSON.stringify({ tronques: gl.tronques, coupe: gl.coupe }));
  await A.eval(`document.getElementById('profile-records').scrollIntoView({ block: 'end', behavior: 'instant' }); true`);
  await A.shot('records-nom-long-390');
  t('noms longs : l\'annonce garde le nom entier', /très long dimanche soir/.test(vlong.live), vlong.live);
  await A.eval(`GAMES.find((g) => g.id === 'precision').title = 'Précision'; true`);
  await A.size(1280, 900);
  await ferme(A);

  // J. rechargement : mêmes chiffres.
  await A.goto(PAGE);
  await A.until(`!document.getElementById('lobby').hidden`, 10000, 'reprise après rechargement');
  const vj = await ouvre(A);
  t('J. rechargement (reprise) : les mêmes statistiques, les mêmes records', same(vj.figs, v1.figs) && same(vj.jeux, v1.jeux) && same(vj.recs, v1.recs));
  await ferme(A);

  // L. pseudo changé entre deux soirées : mêmes statistiques.
  await A.eval(`document.getElementById('hub-leave').click(); true`);
  await A.click('#identity-toggle');
  await A.type('#name-input', 'Mathys L.');
  await A.click('#identity-done');
  await A.click('#hub-create');
  await A.until(`!document.getElementById('lobby').hidden`, 10000, 'nouvelle soirée de A');
  const vl = await ouvre(A);
  const nomVu = await A.eval(`document.getElementById('profile-name').textContent`);
  t('L. pseudo changé, nouvelle soirée : le nouveau nom, les MÊMES statistiques et records', nomVu === 'Mathys L.' && same(vl.figs, v1.figs) && same(vl.recs, v1.recs), nomVu);
  await ferme(A);

  // M. une clé qui ne correspond pas (profil trafiqué) : rien n'est montré ni compté.
  await A.eval(`document.getElementById('hub-leave').click(); true`);
  await A.eval(`(() => { const p = JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})); p.key = 'x'.repeat(43); localStorage.setItem(${JSON.stringify(KEY)}, JSON.stringify(p)); return true; })()`);
  await A.goto(PAGE);
  await A.click('#hub-create');
  await A.until(`!document.getElementById('lobby').hidden`, 10000, 'session avec la mauvaise clé');
  const vm = await ouvre(A);
  t('M. autre clé pour le même id : « Pas de statistiques pour ce profil dans ce navigateur », aucun chiffre, aucun record', /^Pas de statistiques pour ce profil/.test(vm.note || '') && !vm.figuresVues && !vm.recVus, vm.note);
  await ferme(A);
  await A.eval(`document.getElementById('hub-leave').click(); true`);
  await A.eval(`(() => { const p = JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})); p.key = ${JSON.stringify(pA.key)}; localStorage.setItem(${JSON.stringify(KEY)}, JSON.stringify(p)); return true; })()`);

  // M. un Hub SANS statistiques : la soirée marche, le panneau le dit.
  const demandesAvant = A.envoyes.filter((m) => m.action === 'stats').length;
  await A.goto(PAGE_SANS);
  await A.click('#hub-create');
  await A.until(`!document.getElementById('lobby').hidden`, 10000, 'salon sur le Hub sans statistiques');
  const vs = await ouvre(A);
  t('M. Hub sans statistiques : « Ce Hub ne garde pas encore de statistiques », rien de demandé, pas de records', vs.note === 'Ce Hub ne garde pas encore de statistiques.' && !vs.figuresVues && !vs.recVus
    && A.recus.some((m) => m.type === 'created' && m.stats === false) && A.envoyes.filter((m) => m.action === 'stats').length === demandesAvant, vs.note);
  await A.shot('M-stats-indisponibles');
  await ferme(A);
  await A.eval(`document.getElementById('hub-leave').click(); true`);

  // Solo seulement : pas de « victoire » là où il n'y avait personne à battre.
  const Sj = await joueur(cdp, 'S');
  await Sj.goto(PAGE);
  const pS = await Sj.profil();
  const ns = await entre('Sol', pS.id, null, pS.key, 'Solène');
  clients.push(ns);
  await partie(ns, [], 'precision', { Sol: 1 });
  await partie(ns, [], 'passeur', { Sol: 1 });
  await ns.fermer();
  await Sj.eval(`(() => { const p = JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})); p.name = 'Solène'; localStorage.setItem(${JSON.stringify(KEY)}, JSON.stringify(p));
    sessionStorage.setItem('mathys_hub_session', ${JSON.stringify(ns.last().code)}); return true; })()`);
  await Sj.goto(PAGE);
  await Sj.until(`!document.getElementById('lobby').hidden`, 10000, 'S de retour');
  const vso = await ouvre(Sj);
  t('solo seulement : « 2 parties — en solo », pas de chiffre de victoires ni de podiums', vso.figs.length === 1 && vso.figs[0].n === '2' && vso.figs[0].detail === 'en solo'
    && !vso.figs.some((f) => /victoire|podium/.test(f.mot)), JSON.stringify(vso.figs));
  t('solo seulement : la raison est dite (« personne à battre »), et par jeu « 1 partie en solo »', /personne à battre/.test(vso.note || '') && vso.jeux.every((j) => j.meta === '1 partie en solo'), JSON.stringify({ note: vso.note, jeux: vso.jeux }));
  t('solo seulement : « Aucun record compétitif pour l\'instant », ni meilleure place, ni victoires, ni meilleur jeu',
    /^Aucun record compétitif pour l'instant/.test(vso.recNote || '') && same(vso.recs.map((r) => r.cle), ['mostPlayed']), JSON.stringify({ note: vso.recNote, recs: vso.recs }));
  t('solo seulement : le jeu le plus joué reste un record — égalité Le Passeur / Précision, 1 partie chacun',
    same(rec(vso, 'mostPlayed').jeux, ['Le Passeur', 'Précision']) && rec(vso, 'mostPlayed').mot === 'Jeux les plus joués' && rec(vso, 'mostPlayed').detail === 'à égalité · 1 partie chacun',
    JSON.stringify(rec(vso, 'mostPlayed')));
  t('solo seulement : annoncé', /Aucun record compétitif pour l'instant\. Records : jeux les plus joués : Le Passeur et Précision \(1 partie chacun, à égalité\)\./.test(vso.live), vso.live);
  await Sj.size(390, 780); await sleep(200);
  const gso = await Sj.eval(GEOM);
  t('solo seulement, 390 px : rien ne déborde', gso.panneau && gso.figures && gso.noms && !gso.coupe.length && gso.scrollX <= 0, JSON.stringify(gso));
  await Sj.shot('solo-390');

  // Égalité à plus de trois jeux : Tom gagne une fois à quatre jeux → « 4 jeux »
  // pour le plus joué comme pour le meilleur (le détail est dans « Par jeu »).
  const Tj = await joueur(cdp, 'T');
  await Tj.goto(PAGE);
  const pT = await Tj.profil();
  const nt = await entre('Tom', pT.id, null, pT.key);
  const codeT = nt.last().code;
  const u2 = await entre('U2', 'p_statu2', codeT, 'u'.repeat(40)), u3 = await entre('U3', 'p_statu3', codeT, 'v'.repeat(40)), u4 = await entre('U4', 'p_statu4', codeT, 'w'.repeat(40));
  clients.push(nt, u2, u3, u4);
  for (const g of ['passeur', 'demicercle', 'precision', 'quiment']) await partie(nt, [u2, u3, u4], g, { Tom: 1, U2: 2, U3: 3, U4: 4 });
  await nt.fermer();
  await Tj.eval(`(() => { const p = JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})); p.name = 'Tom'; localStorage.setItem(${JSON.stringify(KEY)}, JSON.stringify(p));
    sessionStorage.setItem('mathys_hub_session', ${JSON.stringify(codeT)}); return true; })()`);
  await Tj.goto(PAGE);
  await Tj.until(`!document.getElementById('lobby').hidden`, 10000, 'T de retour');
  const vt = await ouvre(Tj);
  t('égalité à 4 jeux : « 4 jeux » (pluriel, « à égalité · 1 … chacun »), aucun départage, aucun nom tronqué',
    rec(vt, 'mostPlayed').n === '4 jeux' && rec(vt, 'mostPlayed').mot === 'Jeux les plus joués' && rec(vt, 'mostPlayed').detail === 'à égalité · 1 partie chacun'
    && rec(vt, 'mostWins').n === '4 jeux' && rec(vt, 'mostWins').mot === 'Meilleurs jeux' && rec(vt, 'mostWins').detail === 'à égalité · 1 victoire chacun'
    && rec(vt, 'wins').n === '4', JSON.stringify(vt.recs));
  t('égalité à 4 jeux : l\'annonce nomme les quatre', /jeux les plus joués : Demi-Cercle, Le Passeur, Précision et Qui Ment \? \(1 partie chacun, à égalité\)/.test(vt.live), vt.live);
  t('égalité à 4 jeux : les quatre restent dans « Par jeu »', vt.jeux.length === 4, JSON.stringify(vt.jeux.map((j) => j.id)));

  const errs = [A, Sj, Tj].flatMap((J) => J.erreurs.map((e) => `[${J.nom}] ${e}`));
  t('aucune erreur JS dans les pages', errs.length === 0, errs.slice(0, 3).join(' | '));
} catch (e) {
  t('EXCEPTION', false, e.message);
} finally {
  for (const c of clients) { try { await c.fermer(); } catch (_) {} }
  try { execFileSync('taskkill', ['/PID', String(edge.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (_) { try { edge.kill(); } catch (__) {} }
  procs.forEach((p) => { try { p.kill(); } catch (_) {} });
  try { cdp && cdp.close(); } catch (_) {}
  try { srv.close(); } catch (_) {}
  sante.close();
  try { fs.unlinkSync(MANIFEST); } catch (_) {}
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

console.log(`\n${ko ? 'DES TESTS ÉCHOUENT' : 'TOUT PASSE'} — ${out.length} vérifications, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
