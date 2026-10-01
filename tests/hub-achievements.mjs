// Les SUCCÈS dans le Game Hub (lot J) : la vraie page /games/, un vrai Edge,
// un VRAI game-hub-server local (statistiques en mémoire, ou en Postgres avec
// --pg) — la notification « 🏆 Succès débloqué » et la section du profil.
//
//   node tests/hub-achievements.mjs              mouvement normal
//   node tests/hub-achievements.mjs --reduced    mouvement réduit
//   node tests/hub-achievements.mjs --shots <d>  captures (notification 1280 / 390, profil)
//   node tests/hub-achievements.mjs --pg <url>   le Hub sur une base Postgres de TEST (vidée)
//
// ⚠️ LE HUB DÉCIDE. Les définitions, le premier déblocage, l'accusé, le
// rattrapage silencieux et le SQL sont éprouvés côté serveur
// (game-hub-server, test-achievements.js). Ici : ce que la PAGE en montre, et
// QUAND. Les parties sont jouées par des clients Node (protocole du Hub, aucun
// jeu) avec l'id ET la clé du profil du navigateur, qui revient ensuite au Hub
// — exactement le retour d'une partie.
//
// Scénarios : profil neuf (10 verrouillés, l'état écrit) ; victoire à 6 →
// retour au Hub → DEUX notifications l'une après l'autre (1/2, 2/2), jamais
// ensemble, parties seules, focus intact, annonce une fois ; rechargement,
// autre onglet, autre navigateur avec le même profil : rien n'est rejoué ;
// profil : obtenus d'abord, « Nouveau », date ; une fenêtre ouverte retient la
// notification ; garde-fou local (déjà vu ici → accusé sans être rejoué) ;
// pause au survol ; 390 px ; jamais le succès d'un autre ; codes identiques
// au serveur ; seule /games/ écoute les succès.
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
const PG = arg('--pg');
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const R = () => Math.floor(Math.random() * 300);
const HTTP_PORT = 8700 + R(), CDP_PORT = 9700 + R(), HUB_PORT = 8100 + R(), HEALTH_PORT = 6400 + R();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KEY = 'mathys_game_profile';

let out = [], ko = 0;
const t = (nom, ok, detail = '') => {
  out.push(`${ok ? 'OK  ' : 'KO  '} ${nom}${detail ? ' — ' + detail : ''}`);
  if (!ok) ko++;
  console.log(out[out.length - 1]);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const HUBDIR = path.join(ROOT, '..', 'game-hub-server');
const req = createRequire(path.join(HUBDIR, 'package.json'));
const AC = req('./src/achievements.js');
const WS = req('ws');

// ═══ sans navigateur : le client relit en liste blanche ; seule /games/ écoute
{
  const GH = createRequire(import.meta.url)('../games/shared/game-hub.js');
  const base = { played: 0, solo: 0, wins: 0, podiums: 0, best: null, games: [] };
  t('Hub d\'avant le lot J (pas de clé achievements) : la clé reste absente — la section reste cachée', !('achievements' in GH.readStats(base).stats));
  const f = GH.readStats({ ...base, achievements: [{ code: 'first-win', unlocked: true, at: 5, drawId: 'd_1', notifiedAt: 1, playerId: 'p_x' },
    { code: '<img src=x>', unlocked: true }, { code: 'hat-trick', unlocked: 'oui' }, null] }).stats.achievements;
  t('achievements forgés : codes valides seulement, « unlocked » strict, champs inconnus jetés',
    same(f, [{ code: 'first-win', unlocked: true, at: 5, drawId: 'd_1' }, { code: 'hat-trick', unlocked: false }]), JSON.stringify(f));
  t('message achievement forgé : relu { code, at, drawId }', same(GH.readUnlocked([{ code: 'crowd-king', at: 'x', drawId: '../', extra: 1 }, { code: 42 }]), [{ code: 'crowd-king', at: null, drawId: null }]));
  // Les pages de jeu ne doivent rien afficher ni accuser : seule /games/ (hub-page.js) écoute.
  const fichiers = [];
  const visite = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f2 = path.join(d, e.name); if (e.isDirectory()) visite(f2); else if (/\.(js|html)$/.test(e.name)) fichiers.push(f2); } };
  visite(path.join(ROOT, 'games'));
  const ecoutent = fichiers.filter((f2) => /on\('achievement'|achievementsSeen\(/.test(fs.readFileSync(f2, 'utf8'))).map((f2) => path.relative(ROOT, f2).replace(/\\/g, '/'));
  t('seule /games/ écoute « achievement » et accuse réception (aucune page de jeu)', same(ecoutent, ['games/hub-page.js']), ecoutent.join(', '));
}

// --- serveurs (local) -------------------------------------------------------------
const HUB = `ws://127.0.0.1:${HUB_PORT}`;
const procs = [];
const lance = (cwd, file, port, env = {}) => {
  const p = spawn(process.execPath, [file], { cwd, env: { ...process.env, PORT: String(port), HUB_QUIET: '1', ...env }, stdio: 'ignore' });
  procs.push(p); return p;
};
async function attends(url) { for (let i = 0; i < 100; i++) { try { const r = await fetch(url); if (r.ok) return; } catch (_) {} await sleep(100); } throw new Error('injoignable : ' + url); }
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json' };
function serve() {
  const srv = createServer((rq, res) => {
    let p = decodeURIComponent(rq.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const full = path.join(ROOT, p);
    if (!full.startsWith(ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
    res.end(fs.readFileSync(full));
  });
  return new Promise((r) => srv.listen(HTTP_PORT, '127.0.0.1', () => r(srv)));
}

// --- CDP (même plomberie que hub-stats.mjs) ----------------------------------------
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
// `contexte` : réutiliser un contexte (même localStorage = autre onglet du même navigateur).
async function joueur(cdp, nom, contexte) {
  let browserContextId = contexte;
  if (!browserContextId) ({ result: { browserContextId } } = await cdp.send('Target.createBrowserContext', { disposeOnDetach: true }));
  const { result: { targetId } } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { result: { sessionId } } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const J = { nom, erreurs: [], envoyes: [], recus: [], contexte: browserContextId, targetId };
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
  // Un vrai doigt : `(pointer: coarse)` ne s'allume qu'avec l'émulation tactile.
  J.tactile = (on) => S('Emulation.setTouchEmulationEnabled', { enabled: on, maxTouchPoints: on ? 5 : 0 });
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
  J.survole = async (sel) => {
    const box = await J.eval(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await S('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
  };
  J.quitte = () => S('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
  J.type = async (sel, text) => { await J.click(sel); await J.eval(`document.querySelector(${JSON.stringify(sel)}).select()`); await S('Input.insertText', { text }); await sleep(60); };
  J.escape = async () => {
    for (const type of ['rawKeyDown', 'keyUp']) await S('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(150);
  };
  J.shot = async (nomFichier) => {
    if (!SHOTS) return;
    const r = await S('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOTS, (REDUCED ? 'r-' : '') + nomFichier + '.png'), Buffer.from(r.result.data, 'base64'));
  };
  J.profil = () => J.eval(`JSON.parse(localStorage.getItem(${JSON.stringify(KEY)}))`);
  J.fermeOnglet = () => cdp.send('Target.closeTarget', { targetId });
  return J;
}

// ═══════════════════════════════════════════ la vraie page, le vrai Hub
const sante = await fakeHealth(HEALTH_PORT);
const MANIFEST = localManifest(ROOT, HEALTH_PORT);
if (PG) {
  const { Pool } = req('pg');
  const brut = new Pool({ connectionString: PG });
  await brut.query('drop table if exists hub_achievements; drop table if exists hub_plays; drop table if exists hub_players;');
  await brut.end();
}
lance(HUBDIR, 'src/server.js', HUB_PORT, PG ? { MANIFEST_FILE: MANIFEST, DATABASE_URL: PG } : { MANIFEST_FILE: MANIFEST, HUB_STATS: 'memory' });
const srv = await serve();
await attends(`http://127.0.0.1:${HUB_PORT}/health`);
const PAGE = `http://127.0.0.1:${HTTP_PORT}/games/?hub=${encodeURIComponent(HUB)}`;
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
  c.fermer = () => new Promise((res) => { if (ws.readyState === ws.CLOSED) return res(); ws.once('close', res); ws.close(); });
  return c;
}
async function entre(nom, id, code, key, name = nom) {
  const c = client(nom); await c.open;
  const player = Object.assign({ id, name, avatar: { kind: 'emoji', emoji: '🦊' } }, key ? { key } : {});
  c.send(code ? { action: 'join', code, player } : { action: 'create', player });
  await c.waitFor((m) => m.type === 'joined' || m.type === 'created');
  await sleep(60);
  return c;
}
async function partie(hote, autres, gameId, rangs) {
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
  const results = [hote, ...autres].map((c) => ({ gamePlayerId: 'g-' + c.nom, rank: rangs[c.nom], points: 100 - rangs[c.nom] }));
  m = hote.mark();
  hote.send({ action: 'results', drawId: d.id, gameId, results });
  await hote.until((s) => s.history.games.some((g) => g.drawId === d.id), 5000, m);
  m = hote.mark(); hote.send({ action: 'ended', drawId: d.id });
  await hote.until((s) => s.state === 'debrief', 5000, m);
  await sleep(150);
  return d.id;
}

// Le journal de la notification, tenu DANS la page (MutationObserver) : chaque
// apparition / disparition, le code, le compteur, le focus, l'annonce.
const JOURNAL = `(() => { window.__toasts = []; const t = document.getElementById('ach-toast'), live = document.getElementById('ach-live');
  const note = (quoi) => window.__toasts.push({ quoi, ms: Math.round(performance.now()), visible: !t.hidden, code: t.dataset.code || null,
    n: document.getElementById('ach-toast-n').textContent, nom: document.getElementById('ach-toast-name').textContent,
    desc: document.getElementById('ach-toast-desc').textContent, focus: document.activeElement && (document.activeElement.id || document.activeElement.tagName),
    live: live.textContent, trans: getComputedStyle(t).transitionDuration });
  new MutationObserver(() => note('toast')).observe(t, { attributes: true, attributeFilter: ['hidden'] });
  new MutationObserver(() => note('live')).observe(live, { childList: true, characterData: true, subtree: true });
  return true; })()`;
const apparitions = (J) => J.eval(`window.__toasts.filter((e) => e.quoi === 'toast' && e.visible)`);
const LISTE = `[...document.querySelectorAll('#profile-ach-list .profile-ach-item')].map((li) => ({ code: li.dataset.code, ok: li.classList.contains('is-unlocked'),
  nom: li.querySelector('.profile-ach-name').firstChild.textContent, nouveau: !!li.querySelector('.profile-ach-new'),
  etat: li.querySelector('.profile-ach-state').textContent, emojiCache: li.querySelector('.profile-ach-emoji').getAttribute('aria-hidden') === 'true' }))`;
async function ouvreProfil(J) {
  await J.click('#hub-profile-btn');
  await J.until(`document.getElementById('profile-dialog').open && !document.getElementById('profile-stats').hasAttribute('aria-busy')
    && !!document.getElementById('profile-stats-live').textContent`, 8000, 'statistiques affichées');
}
const seenEnvoyes = (J) => J.envoyes.filter((m) => m.action === 'achievements-seen').map((m) => m.codes);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hubach-'));
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${dir}`, '--no-first-run',
  '--disable-features=BackForwardCache', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank'], { stdio: 'ignore' });
let cdp = null;
const clients = [];

try {
  cdp = await cdpBrowser();
  console.log(`Succès du Game Hub — vrais navigateurs, vrai Hub (${PG ? 'Postgres' : 'mémoire'}, ${REDUCED ? 'mouvement RÉDUIT' : 'mouvement normal'})\n`);

  // ═══ profil neuf : 10 succès verrouillés, l'état écrit
  const A = await joueur(cdp, 'A');
  await A.goto(PAGE);
  const pA = await A.profil();
  await A.type('#name-input', 'Mathys');
  await A.click('#identity-done');
  await A.click('#hub-create');
  await A.until(`!document.getElementById('lobby').hidden`, 10000, 'salon de A');
  await ouvreProfil(A);
  const l0 = await A.eval(LISTE);
  t('profil neuf : les 10 succès, tous « Verrouillé » (écrit, pas seulement la couleur), emoji caché aux lecteurs',
    l0.length === 10 && l0.every((x) => !x.ok && /Verrouillé$/.test(x.etat) && x.emojiCache), JSON.stringify(l0.slice(0, 2)));
  t('les codes de la page = ceux du serveur (achievements.js), dans le même ordre', same(l0.map((x) => x.code), AC.CODES), l0.map((x) => x.code).join());
  t('compteur « · 0/10 » ; annoncé avec les statistiques', (await A.eval(`document.getElementById('profile-ach-count').textContent`)) === '· 0/10'
    && /Succès : 0 sur 10\./.test(await A.eval(`document.getElementById('profile-stats-live').textContent`)));
  await A.click('#profile-close');
  await A.eval(`document.getElementById('hub-leave').click(); true`);

  // ═══ une victoire à 6 joueurs, jouée par le protocole avec l'id ET la clé de A
  const ma = await entre('Mat', pA.id, null, pA.key, 'Mathys');
  const code = ma.last().code;
  const autres = [];
  for (const [i, nom] of ['Bob', 'Cam', 'Dan', 'Eve', 'Fil'].entries()) autres.push(await entre(nom, 'p_ach' + i, code, String.fromCharCode(98 + i).repeat(40)));
  clients.push(ma, ...autres);
  await partie(ma, autres, 'ban', { Mat: 1, Bob: 2, Cam: 3, Dan: 4, Eve: 5, Fil: 6 });
  await ma.waitFor((m) => m.type === 'achievement', 3000).catch(() => null);
  t('le Hub a débloqué [first-win, crowd-king] pour A (reçus par sa connexion de jeu, qui les ignore)',
    same(ma.msgs.filter((m) => m.type === 'achievement').flatMap((m) => m.unlocked.map((u) => u.code)), ['first-win', 'crowd-king']));
  await ma.fermer();

  // ═══ retour au Hub : DEUX notifications, l'une après l'autre
  await A.eval(`sessionStorage.setItem('mathys_hub_session', ${JSON.stringify(code)}); true`);
  await A.goto(PAGE);
  await A.eval(JOURNAL);
  await A.until(`!document.getElementById('lobby').hidden`, 10000, 'A de retour au salon');
  await A.until(`!document.getElementById('ach-toast').hidden`, 6000, 'première notification');
  const focusAvant = await A.eval(`document.activeElement && (document.activeElement.id || document.activeElement.tagName)`);
  const t1 = await A.eval(`({ kicker: document.querySelector('.ach-toast-kicker').textContent, nom: document.getElementById('ach-toast-name').textContent,
    desc: document.getElementById('ach-toast-desc').textContent, n: document.getElementById('ach-toast-n').textContent,
    aria: document.getElementById('ach-toast').getAttribute('aria-hidden'), r: (() => { const r = document.getElementById('ach-toast').getBoundingClientRect(); return { l: r.left, r: r.right, b: r.bottom, w: innerWidth, h: innerHeight }; })() })`);
  t('notification 1 : « 🏆 Succès débloqué · 1/2 », « Première victoire », sa description',
    /Succès débloqué/.test(t1.kicker) && t1.n === '· 1/2' && t1.nom === 'Première victoire' && t1.desc === 'Gagne une partie à plusieurs.', JSON.stringify(t1));
  t('notification : en bas à droite, dans l\'écran (1280 px)', t1.r.r <= t1.r.w && t1.r.b <= t1.r.h && t1.r.l > t1.r.w / 2, JSON.stringify(t1.r));
  await sleep(400);                                         // capture une fois arrivée
  await A.shot('notification-1280');
  await A.until(`window.__toasts.filter((e) => e.quoi === 'toast' && e.visible).length >= 2 && !document.getElementById('ach-toast').hidden`, 9000, 'seconde notification');
  const t2 = await A.eval(`({ nom: document.getElementById('ach-toast-name').textContent, n: document.getElementById('ach-toast-n').textContent })`);
  t('notification 2 : « Roi de la foule · 2/2 »', t2.nom === 'Roi de la foule' && t2.n === '· 2/2', JSON.stringify(t2));
  await A.until(`document.getElementById('ach-toast').hidden && window.__toasts.filter((e) => e.quoi === 'toast' && !e.visible).length >= 2`, 9000, 'fin des notifications');
  const j = await A.eval(`window.__toasts`);
  const vues = j.filter((e) => e.quoi === 'toast');
  t('elles se SUIVENT : visible, cachée, visible, cachée — jamais deux à la fois', same(vues.map((e) => e.visible), [true, false, true, false]), JSON.stringify(vues.map((e) => [e.visible, e.code])));
  const duree = vues[1].ms - vues[0].ms;
  t('chacune reste ~5 s puis part toute seule', duree > 4500 && duree < 7000, duree + ' ms');
  t('le focus ne bouge pas pendant les notifications', j.every((e) => e.focus === focusAvant), JSON.stringify([focusAvant, ...new Set(j.map((e) => e.focus))]));
  const annonces = j.filter((e) => e.quoi === 'live').map((e) => e.live).filter(Boolean);
  t('lecteur d\'écran : chaque succès annoncé une fois, nom + description', same(annonces, ['Succès débloqué : Première victoire. Gagne une partie à plusieurs.',
    'Succès débloqué : Roi de la foule. Gagne une partie à 6 joueurs ou plus.']), JSON.stringify(annonces));
  t('accusé « affiché » envoyé au Hub pour chacune, au moment de l\'afficher', same(seenEnvoyes(A), [['first-win'], ['crowd-king']]), JSON.stringify(seenEnvoyes(A)));
  // (en mouvement réduit, game-ui.css force aussi .01 ms partout : ≤ 1 ms = aucune transition)
  const secondes = (v) => Math.max(...v.split(',').map((x) => parseFloat(x)));
  t(REDUCED ? 'mouvement réduit : aucune transition' : 'mouvement normal : entrée animée (transition)', REDUCED ? j.every((e) => secondes(e.trans) <= 0.001) : j.some((e) => secondes(e.trans) >= 0.2), JSON.stringify([...new Set(j.map((e) => e.trans))]));

  // ═══ rien n'est rejoué : rechargement, autre onglet, autre navigateur
  const recusAvant = A.recus.length;
  await A.goto(PAGE);
  await A.eval(JOURNAL);
  await A.until(`!document.getElementById('lobby').hidden`, 10000, 'A après rechargement');
  await sleep(2500);
  t('rechargement : aucune notification, le Hub n\'envoie plus rien', (await apparitions(A)).length === 0 && !A.recus.slice(recusAvant).some((m) => m.type === 'achievement'));
  const A2 = await joueur(cdp, 'A-onglet', A.contexte);
  await A2.goto(PAGE);
  // Le code de session est par onglet (sessionStorage) : le second onglet rejoint la soirée.
  await A2.eval(`sessionStorage.setItem('mathys_hub_session', ${JSON.stringify(code)}); true`);
  await A2.goto(PAGE);
  await A2.eval(JOURNAL);
  await A2.until(`!document.getElementById('lobby').hidden`, 10000, 'second onglet');
  await sleep(2500);
  t('autre onglet (même navigateur) : aucune notification', (await apparitions(A2)).length === 0 && !A2.recus.some((m) => m.type === 'achievement'));
  await A2.fermeOnglet();
  // Un autre navigateur, le MÊME profil (id + clé) : rien en local — seul le Hub sait.
  const B = await joueur(cdp, 'A-ailleurs');
  await B.goto(PAGE);
  await B.eval(`localStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(JSON.stringify(await A.profil()))});
    sessionStorage.setItem('mathys_hub_session', ${JSON.stringify(code)}); true`);
  await B.goto(PAGE);
  await B.eval(JOURNAL);
  await B.until(`!document.getElementById('lobby').hidden`, 10000, 'autre navigateur');
  await sleep(2500);
  t('autre navigateur, même profil, sans aucune mémoire locale : rien n\'est rejoué (le Hub a retenu l\'accusé)', (await apparitions(B)).length === 0 && !B.recus.some((m) => m.type === 'achievement'));
  await B.fermeOnglet();

  // ═══ le profil : obtenus d'abord, « Nouveau », la date
  // (A a été remplacé par le second onglet, puis par B : il revient dans la soirée.)
  await A.eval(`sessionStorage.setItem('mathys_hub_session', ${JSON.stringify(code)}); true`);
  await A.goto(PAGE);
  await A.until(`!document.getElementById('lobby').hidden`, 10000, 'A au salon');
  await ouvreProfil(A);
  const l1 = await A.eval(LISTE);
  t('profil : les obtenus D\'ABORD (Première victoire, Roi de la foule), puis les 8 verrouillés', same(l1.slice(0, 2).map((x) => [x.code, x.ok]), [['first-win', true], ['crowd-king', true]])
    && l1.slice(2).every((x) => !x.ok), JSON.stringify(l1.map((x) => x.code)));
  t('profil : « ✓ Obtenu le … » (date du jour), « Nouveau » (débloqué ce soir)', l1.slice(0, 2).every((x) => /Obtenu le \d{1,2} \S+ \d{4}$/.test(x.etat) && x.nouveau), JSON.stringify(l1.slice(0, 2)));
  t('profil : compteur « · 2/10 »', (await A.eval(`document.getElementById('profile-ach-count').textContent`)) === '· 2/10');
  await A.shot('profil-succes-1280');
  await A.escape();
  await sleep(1200);
  t('profil refermé / rouvert : aucune notification', (await A.eval(`document.getElementById('ach-toast').hidden`)));
  await A.eval(`document.getElementById('hub-leave').click(); true`);

  // ═══ une fenêtre ouverte retient la notification ; garde-fou local ; survol
  // A attend dans une AUTRE soirée, profil ouvert ; son double joue ailleurs.
  await A.click('#hub-create');
  await A.until(`!document.getElementById('lobby').hidden`, 10000, 'A dans une autre soirée');
  // Garde-fou : « versatile » est déjà marqué vu dans CE navigateur (accusé perdu).
  await A.eval(`localStorage.setItem('mathys_hub_ach_shown', JSON.stringify({ id: ${JSON.stringify(pA.id)}, codes: ['versatile'] })); true`);
  await A.eval(JOURNAL);
  await ouvreProfil(A);
  const ma2 = await entre('Mat', pA.id, code, pA.key, 'Mathys');
  clients.push(ma2);
  await autres[0].until((s) => s.players.some((p) => p.id === pA.id && p.connected), 5000);
  const hote = autres.find((c) => c.last().hostId === c.last().players.find((p) => p.name === c.nom)?.id) || autres[0];
  const avantSeen = seenEnvoyes(A).length;
  await partie(hote, [ma2, ...autres.filter((c) => c !== hote)], 'passeur', { Mat: 1, Bob: 2, Cam: 3, Dan: 4, Eve: 5, Fil: 6 });
  await partie(hote, [ma2, ...autres.filter((c) => c !== hote)], 'precision', { Mat: 1, Bob: 2, Cam: 3, Dan: 4, Eve: 5, Fil: 6 });
  await A.until(`window.__toasts !== undefined && true`, 1000);
  await sleep(1500);
  const pendant = await apparitions(A);
  const recuVivant = A.recus.filter((m) => m.type === 'achievement').flatMap((m) => m.unlocked.map((u) => u.code));
  t('déjà sur /games/ : [versatile, hat-trick] arrivent tout de suite (ban, passeur, précision gagnés d\'affilée)', recuVivant.includes('versatile') && recuVivant.includes('hat-trick'), JSON.stringify(recuVivant));
  t('profil OUVERT : la notification attend (rien d\'affiché ; Hat-trick pas encore accusé)', pendant.length === 0
    && !seenEnvoyes(A).slice(avantSeen).flat().includes('hat-trick'), JSON.stringify({ pendant, seen: seenEnvoyes(A).slice(avantSeen) }));
  await A.escape();
  await A.until(`!document.getElementById('ach-toast').hidden`, 5000, 'notification après fermeture du profil');
  const t3 = await A.eval(`({ code: document.getElementById('ach-toast').dataset.code, n: document.getElementById('ach-toast-n').textContent })`);
  t('fenêtre fermée : la notification part ; garde-fou local → « Polyvalent » (déjà vu ici) n\'est PAS rejoué, seulement accusé',
    t3.code === 'hat-trick' && t3.n === '' && seenEnvoyes(A).slice(avantSeen).some((c) => same(c, ['versatile'])), JSON.stringify({ t3, seen: seenEnvoyes(A).slice(avantSeen) }));
  if (!REDUCED) {
    await A.survole('#ach-toast');
    await sleep(6500);
    t('survol : la notification reste tant que la souris est dessus', !(await A.eval(`document.getElementById('ach-toast').hidden`)));
    await A.quitte();
    await A.until(`document.getElementById('ach-toast').hidden`, 9000, 'départ après le survol');
    t('souris partie : elle s\'en va', true);
  } else {
    await A.until(`document.getElementById('ach-toast').hidden`, 8000, 'départ');
  }
  t('accusés de la salve : versatile (garde-fou) puis hat-trick (affiché)', same(seenEnvoyes(A).slice(avantSeen).flat().sort(), ['hat-trick', 'versatile']), JSON.stringify(seenEnvoyes(A).slice(avantSeen)));

  // ═══ 390 px
  await A.size(390, 780); await A.tactile(true); await sleep(200);
  t('390 px tactile : (pointer: coarse) actif', await A.eval(`matchMedia('(pointer: coarse)').matches`));
  await ma2.fermer();
  const ma3 = await entre('Mat', pA.id, code, pA.key, 'Mathys');
  clients.push(ma3);
  await autres[0].until((s) => s.players.some((p) => p.id === pA.id && p.connected), 5000);
  await A.eval(JOURNAL);
  // Pat est trop long à obtenir ici ; « Touche-à-tout » : un 5e jeu (ban, passeur, précision + 2).
  const h2 = autres.find((c) => c.last().hostId === c.last().players.find((p) => p.name === c.nom)?.id) || autres[0];
  await partie(h2, [ma3, ...autres.filter((c) => c !== h2)], 'imitation', { Mat: 2, Bob: 1, Cam: 3, Dan: 4, Eve: 5, Fil: 6 });
  await partie(h2, [ma3, ...autres.filter((c) => c !== h2)], 'quiment', { Mat: 2, Bob: 1, Cam: 3, Dan: 4, Eve: 5, Fil: 6 });
  await A.until(`!document.getElementById('ach-toast').hidden`, 8000, 'notification à 390 px');
  await sleep(500);                                         // mesurée une fois arrivée (fin de la glissade)
  const g = await A.eval(`(() => { const r = document.getElementById('ach-toast').getBoundingClientRect(); return { l: r.left, r: r.right, b: r.bottom, w: innerWidth, h: innerHeight,
    sx: document.documentElement.scrollWidth - innerWidth, code: document.getElementById('ach-toast').dataset.code,
    pe: getComputedStyle(document.getElementById('ach-toast')).pointerEvents }; })()`);
  t('390 px : Touche-à-tout notifié, pleine largeur dans l\'écran, aucun défilement horizontal, ne bloque pas le doigt',
    g.code === 'explorer' && g.l >= 8 && g.r <= g.w - 8 && g.b <= g.h && g.sx <= 0 && g.pe === 'none', JSON.stringify(g));
  await A.shot('notification-390');
  await A.until(`document.getElementById('ach-toast').hidden`, 8000, 'départ à 390 px');
  await ouvreProfil(A);
  const geo = await A.eval(`(() => { const sec = document.getElementById('profile-ach').getBoundingClientRect();
    const items = [...document.querySelectorAll('.profile-ach-item')].map((e) => e.getBoundingClientRect());
    const coupe = [...document.querySelectorAll('.profile-ach-name, .profile-ach-desc, .profile-ach-state')].filter((e) => e.scrollWidth > e.clientWidth + 1).length;
    return { dedans: items.every((r) => r.left >= sec.left - .5 && r.right <= sec.right + .5), coupe, sx: document.documentElement.scrollWidth - innerWidth }; })()`);
  t('390 px : le profil tient (lignes dans la section, aucun texte coupé)', geo.dedans && !geo.coupe && geo.sx <= 0, JSON.stringify(geo));
  await A.eval(`document.getElementById('profile-ach').scrollIntoView({ block: 'start', behavior: 'instant' }); true`);
  await A.shot('profil-succes-390');
  await A.escape();

  // ═══ jamais le succès d'un autre
  const tousCodes = A.recus.filter((m) => m.type === 'achievement').flatMap((m) => m.unlocked.map((u) => u.code));
  const aMoi = new Set(['first-win', 'crowd-king', 'versatile', 'hat-trick', 'explorer']);
  t('A n\'a jamais reçu que SES succès (Bob a gagné deux fois : rien chez A)', tousCodes.every((c) => aMoi.has(c)), JSON.stringify([...new Set(tousCodes)]));
  t('aucun message de stats ne contient l\'id d\'un autre joueur', A.recus.filter((m) => m.type === 'stats' || m.type === 'achievement').every((m) => !/p_ach\d/.test(JSON.stringify(m))));

  const errs = [A, B].flatMap((J) => J.erreurs.map((e) => `[${J.nom}] ${e}`));
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
