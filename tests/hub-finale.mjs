// Fin de soirée du Game Hub : l'HÔTE termine, TOUT LE MONDE voit le podium.
// La vraie page /games/, trois navigateurs, contre un VRAI game-hub-server local.
//
//   node tests/hub-finale.mjs              révélation animée
//   node tests/hub-finale.mjs --reduced    mouvement réduit : tout est là d'emblée
//   node tests/hub-finale.mjs --shots <d>  captures du podium (1280 et 390 px)
//
// ⚠️ AUCUN JEU LANCÉ, AUCUN SCORE FABRIQUÉ CÔTÉ PAGE. Comme tests/hub-recap.mjs :
// des clients Node jouent le protocole du Hub (tirage, launched / entered,
// results, ended) avec l'id de profil de chaque navigateur, puis se
// déconnectent ; les navigateurs reprennent la session — le vrai retour au Hub.
// Le podium affiché doit être EXACTEMENT celui que le Hub a figé (`finale`).
//
// Scénarios :
//   1. trois joueurs + un quatrième parti avant la fin ; ex æquo en tête ;
//      seul l'hôte a « Terminer la soirée » ; Annuler ne fait rien ; confirmer
//      (deux fois, exprès) → une seule fin, le même podium chez les trois ;
//      la révélation 3e → 1er (ou tout de suite en mouvement réduit) ;
//      390 px lisible ; « Retour à l'accueil » ;
//   2. un joueur absent pendant la fin revient : pas de reprise, le podium ;
//   3. l'hôte seul, sans aucune partie : un podium d'une ligne, sans historique.
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
const HTTP_PORT = 8700 + R(), CDP_PORT = 9700 + R(), HUB_PORT = 8100 + R(), HEALTH_PORT = 6400 + R();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let out = [], ko = 0;
const t = (nom, ok, detail = '') => {
  out.push(`${ok ? 'OK  ' : 'KO  '} ${nom}${detail ? ' — ' + detail : ''}`);
  if (!ok) ko++;
  console.log(out[out.length - 1]);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

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

// --- CDP (même plomberie que hub-score.mjs) ----------------------------------------
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
  const genre = (url) => (/hub/i.test(url) || url.startsWith(HUB) ? 'hub' : 'jeu');
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
  J.goto = async (url) => { await S('Page.navigate', { url }); await J.until(`document.readyState === 'complete' && !!window.GameHub`, 30000, 'chargement ' + url); };
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
  J.mouse = async (x, y) => { for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await S('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }); await sleep(100); };
  J.type = async (sel, text) => { await J.click(sel); await J.eval(`document.querySelector(${JSON.stringify(sel)}).select()`); await S('Input.insertText', { text }); await sleep(60); };
  J.shot = async (nomFichier, sel = '#lobby') => {
    if (!SHOTS) return;
    const r0 = await J.eval(`(() => { window.scrollTo(0, 0); const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();
      return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: Math.min(r.height, 900) }; })()`);
    const r = await S('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { ...r0, scale: 1 } });
    fs.writeFileSync(path.join(SHOTS, nomFichier + '.png'), Buffer.from(r.result.data, 'base64'));
  };
  J.hub = () => { const f = [...J.recus].reverse().find((x) => x.d.session); return f ? f.d.session : null; };
  J.jeu = (pred) => [...J.recus].reverse().find((x) => x.g === 'jeu' && pred(x.d));
  J.attends = async (pred, ms = 10000, label = 'trame') => {
    const fin = Date.now() + ms;
    while (Date.now() < fin) { const f = [...J.recus].reverse().find((x) => pred(x.d, x.g)); if (f) return f.d; await sleep(50); }
    throw new Error(`[${nom}] trame jamais reçue : ${label}`);
  };
  return J;
}



// ═══════════════════════════════════════════ 2. la vraie page, le vrai Hub
const WS = createRequire(path.join(ROOT, '..', 'game-hub-server', 'package.json'))('ws');
const sante = await fakeHealth(HEALTH_PORT);
const MANIFEST = localManifest(ROOT, HEALTH_PORT);
lance(path.join(ROOT, '..', 'game-hub-server'), 'src/server.js', HUB_PORT, { MANIFEST_FILE: MANIFEST });
const srv = await serve();
await attends(`http://127.0.0.1:${HUB_PORT}/health`);
const PAGE = `http://127.0.0.1:${HTTP_PORT}/games/?hub=${encodeURIComponent(HUB)}`;
const TOUS = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')).games.map((g) => g.id);

// Un client du Hub en Node : le protocole, rien d'autre (même forme que test-scores.js).
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
  c.fermer = () => new Promise((res) => { ws.once('close', res); ws.close(); });
  return c;
}
const joueurNode = (id, name) => ({ id, name, avatar: { kind: 'emoji', emoji: '🦊' } });
async function entre(nom, id, code) {
  const c = client(nom); await c.open;
  c.send(code ? { action: 'join', code, player: joueurNode(id, nom) } : { action: 'create', player: joueurNode(id, nom) });
  await c.waitFor((m) => m.type === 'joined' || m.type === 'created');
  return c;
}
// Une partie « jouée » : l'hôte force le jeu par veto, tire, lance, chacun
// s'assoit, l'hôte rapporte le classement puis ended. `rangs` = rang par joueur.
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
  m = hote.mark();
  hote.send({ action: 'results', drawId: d.id, gameId, results: [hote, ...autres].map((c) => ({ gamePlayerId: 'g-' + c.nom, rank: rangs[c.nom], points: 100 - rangs[c.nom] })) });
  await hote.until((s) => s.history.games.some((g) => g.drawId === d.id), 5000, m);
  m = hote.mark(); hote.send({ action: 'ended', drawId: d.id });
  return hote.until((s) => s.state === 'debrief', 5000, m);
}

// Le navigateur prend le profil `id` et reprend la session `code` (retour au Hub).
async function reprend(J, id, name, code) {
  await J.goto(PAGE);
  await J.eval(`localStorage.setItem('mathys_game_profile', ${JSON.stringify(JSON.stringify({ v: 1, id, name, avatar: { kind: 'emoji', emoji: '🦊' } }))});
    sessionStorage.setItem('mathys_hub_session', ${JSON.stringify(code)}); true`);
  await J.goto(PAGE);
  await J.until(`!document.getElementById('lobby').hidden && document.getElementById('hub-code').textContent.trim() === ${JSON.stringify(code)}`, 10000, 'retour au salon ' + code);
}
const recapVu = `!document.getElementById('hub-recap').hidden`;
const LIRE = `(() => ({
  titre: document.getElementById('recap-title').textContent,
  code: document.getElementById('recap-code').textContent,
  rang: [...document.querySelectorAll('#recap-ranking .recap-row')].map((li) => ({ id: li.dataset.player, rank: +li.dataset.rank, pts: +li.dataset.points,
    medaille: li.querySelector('.recap-rank').textContent, moi: li.classList.contains('is-me'), top: li.classList.contains('is-top'),
    parti: !!li.querySelector('.hub-tag.away'), av: !!li.querySelector('.g-av') })),
  count: document.getElementById('recap-count').textContent, last: document.getElementById('recap-last').textContent, gain: document.getElementById('recap-gain').textContent,
  jeux: [...document.querySelectorAll('#recap-games .recap-game')].map((li) => ({ n: +li.dataset.n, game: li.dataset.game,
    win: li.querySelector('.recap-game-win').textContent, winVu: getComputedStyle(li.querySelector('.recap-game-win')).display !== 'none',
    me: li.querySelector('.recap-game-me').textContent, pts: li.querySelector('.recap-game-pts').textContent })),
  entree: !document.getElementById('entry').hidden, salon: !document.getElementById('lobby').hidden,
}))()`;
// Rien ne dépasse, rien ne se chevauche dans le débrief.
const GEOM = `(() => {
  const R = (e) => e.getBoundingClientRect();
  const panneau = R(document.getElementById('hub-recap'));
  const feuilles = [...document.querySelectorAll('#hub-recap .recap-row > *, #hub-recap .recap-game > *, #hub-recap .recap-facts > div, #hub-recap .recap-head > *')]
    .filter((e) => getComputedStyle(e).display !== 'none' && R(e).width > 0);
  const deborde = feuilles.filter((e) => R(e).right > panneau.right + 1 || R(e).left < panneau.left - 1).map((e) => e.className || e.id);
  let chev = [];
  for (const par of document.querySelectorAll('#hub-recap .recap-row, #hub-recap .recap-game')) {
    const k = [...par.children].filter((e) => getComputedStyle(e).display !== 'none');
    for (let i = 0; i < k.length; i++) for (let j = i + 1; j < k.length; j++) {
      const a = R(k[i]), b = R(k[j]);
      if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) chev.push(k[i].className + ' / ' + k[j].className);
    }
  }
  // Le texte qui déborde de SA cellule (la boîte tient, le contenu non) : c'est
  // ce qu'une capture a montré au téléphone en solo (« PRÉC… »).
  const coupe = feuilles.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.className + ' : ' + e.textContent.trim());
  return { deborde, chev, coupe, scrollX: document.documentElement.scrollWidth > innerWidth + 1 };
})()`;


const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hubfinale-'));
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${dir}`, '--no-first-run',
  '--disable-features=BackForwardCache', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank'], { stdio: 'ignore' });
let cdp = null;

const finaleVue = `!document.getElementById('hub-recap').hidden && document.getElementById('hub-recap').classList.contains('is-final')`;
const toutMontre = `!document.getElementById('hub-recap').classList.contains('is-revealing')`;
// L'état visible d'une ligne du podium : montrée ou encore retenue par la révélation.
const VISIBLES = `[...document.querySelectorAll('#recap-ranking .recap-row')].map((li) => [li.dataset.player, getComputedStyle(li).opacity === '1'])`;
const trames = (J, type) => J.recus.filter((f) => f.g === 'hub' && f.d.type === type).map((f) => f.d);

try {
  cdp = await cdpBrowser();
  const [A, B, C] = [await joueur(cdp, 'A'), await joueur(cdp, 'B'), await joueur(cdp, 'C')];
  console.log(`Fin de soirée — trois navigateurs, vrai Hub (${REDUCED ? 'mouvement RÉDUIT' : 'révélation animée'})\n`);

  // ═══ 1. trois joueurs, un quatrième parti, ex æquo en tête
  const ids = { A: 'p_fina', B: 'p_finb', C: 'p_finc', D: 'p_find' };
  const a = await entre('Ana', ids.A);
  const code = a.last().code;
  const b = await entre('Bob', ids.B, code), c = await entre('Cam', ids.C, code), d = await entre('Dan', ids.D, code);
  // 4 classés : Ana 1, Bob 1 (ex æquo), Cam 3, Dan 4 → 40 / 40 / 20 / 10.
  const deb = await partie(a, [b, c, d], 'passeur', { Ana: 1, Bob: 1, Cam: 3, Dan: 4 });
  t('préparation : le Hub a compté 40 / 40 / 20 / 10', same(deb.scores, { [ids.A]: 40, [ids.B]: 40, [ids.C]: 20, [ids.D]: 10 }), JSON.stringify(deb.scores));
  d.send({ action: 'leave' });                               // Dan quitte : lui seul
  await a.until((s) => s.players.length === 3, 5000);
  for (const k of [a, b, c]) await k.fermer();
  await reprend(A, ids.A, 'Ana', code);
  await reprend(B, ids.B, 'Bob', code);
  await reprend(C, ids.C, 'Cam', code);
  t('les trois reviennent au salon, Ana hôte', (await A.eval(`document.querySelector('#hub-players .hub-card.is-me .hub-tag.host') !== null`)));

  const finishVu = `(() => { const b = document.getElementById('hub-finish'); return !b.hidden && !!b.offsetParent; })()`;
  t('seul l\'hôte voit « 🏁 Terminer la soirée »', (await A.eval(finishVu)) && !(await B.eval(finishVu)) && !(await C.eval(finishVu)));
  t('… et tout le monde garde « Quitter la session »', (await Promise.all([A, B, C].map((J) => J.eval(`document.getElementById('hub-leave').textContent`)))).every((x) => x === 'Quitter la session'));
  // Distinct du départ (liseré ROUGE, pas le fantôme gris), mais SECONDAIRE :
  // pas de fond plein, et loin de l'action principale (« Tirer », sous les
  // joueurs) — dans le panneau des jeux, en bas, après la liste.
  const fin = await A.eval(`(() => { const f = document.getElementById('hub-finish'), l = document.getElementById('hub-leave'), d = document.getElementById('hub-draw-btn');
    const cs = getComputedStyle(f), rf = f.getBoundingClientRect(), rd = d.getBoundingClientRect();
    return { ghost: f.classList.contains('ghost'), leaveGhost: l.classList.contains('ghost'), fond: cs.backgroundImage === 'none' && /rgba\\(0, 0, 0, 0\\)|transparent/.test(cs.backgroundColor),
      liseré: /184, 69, 47/.test(cs.boxShadow), panneau: !!f.closest('#hub-lobby-games'), tirerVu: !d.hidden, ecart: Math.round(rf.top - rd.bottom),
      apresJeux: rf.top >= document.getElementById('hub-pool').getBoundingClientRect().bottom }; })()`);
  t('le bouton de fin : distinct du départ (liseré rouge, pas fantôme gris) mais secondaire (sans fond plein)',
    !fin.ghost && fin.leaveGhost && fin.fond && fin.liseré, JSON.stringify(fin));
  t('le bouton de fin est loin de « Tirer » : autre panneau, après la liste des jeux', fin.panneau && fin.tirerVu && fin.apresJeux && fin.ecart >= 200, JSON.stringify(fin));

  // Annuler : rien ne part.
  const env0 = A.envoyes.length;
  await A.click('#hub-finish');
  await A.until(`document.getElementById('finish-dialog').open`, 3000, 'confirmation');
  t('la confirmation s\'ouvre, avec son texte', /podium final/.test(await A.eval(`document.getElementById('finish-text').textContent`)));
  await A.click('#finish-cancel');
  await sleep(300);
  t('Annuler : la confirmation se ferme, aucun `finish` envoyé, la soirée continue', !(await A.eval(`document.getElementById('finish-dialog').open`))
    && !A.envoyes.slice(env0).some((f) => f.d.action === 'finish') && !(await B.eval(finaleVue)));

  // Confirmer — et renvoyer exprès une seconde fois (double clic / double message).
  const marques = [A, B, C].map((J) => J.recus.length);
  await A.click('#hub-finish');
  await A.until(`document.getElementById('finish-dialog').open`, 3000, 'confirmation 2');
  await A.click('#finish-confirm');
  await A.eval(`document.getElementById('finish-confirm').click(); true`);
  for (const J of [A, B, C]) await J.until(finaleVue, 8000, `podium chez ${J.nom}`);
  const envoisFin = A.envoyes.filter((f) => f.g === 'hub' && f.d.action === 'finish').length;
  t('confirmer : `finish` envoyé (une fois, ou deux au double clic — jamais plus)', envoisFin >= 1 && envoisFin <= 2, `${envoisFin} envoi(s)`);
  const finales = [A, B, C].map((J, i) => J.recus.slice(marques[i]).filter((f) => f.g === 'hub' && f.d.type === 'finale').map((f) => f.d.finale));
  t('les trois reçoivent la finale, et la même', finales.every((l) => l.length >= 1) && finales.flat().every((f) => same(f, finales[0][0])));
  const F = finales[0][0];
  t('une seule fin côté serveur : toutes les copies ont la même heure de clôture', finales.flat().every((f) => f.at === F.at));

  // La révélation.
  if (REDUCED) {
    t('mouvement réduit : pas de révélation retenue, tout est visible tout de suite', (await A.eval(toutMontre)) && (await A.eval(VISIBLES)).every(([, v]) => v));
  } else {
    const t0 = await C.eval(VISIBLES);
    t('révélation : au début, « La soirée est terminée » seul — aucune ligne encore montrée', (await C.eval(`document.getElementById('hub-recap').classList.contains('is-revealing')`)) && t0.every(([, v]) => !v), JSON.stringify(t0));
    // Le 3e (Cam) avant les 1ers (Ana, Bob, ex æquo : ensemble).
    await C.until(`(() => { const l = ${VISIBLES}; return l.find((x) => x[0] === ${JSON.stringify(ids.C)})[1]; })()`, 4000, '3e révélé');
    const t1 = Object.fromEntries(await C.eval(VISIBLES));
    t('révélation : le 3e (Cam) paraît AVANT les premiers', t1[ids.C] && !t1[ids.A] && !t1[ids.B], JSON.stringify(t1));
    await C.until(`(() => { const l = ${VISIBLES}; return l.find((x) => x[0] === ${JSON.stringify(ids.A)})[1]; })()`, 4000, '1ers révélés');
    const t2 = Object.fromEntries(await C.eval(VISIBLES));
    t('révélation : les deux premiers (ex æquo) paraissent ENSEMBLE', t2[ids.A] && t2[ids.B], JSON.stringify(t2));
  }
  // (la classe retirée, la transition d'opacité finit en 0,45 s : on attend l'état, on ne le suppose pas)
  const tousVisibles = `${toutMontre} && ${VISIBLES}.every((x) => x[1])`;
  const finis = await Promise.all([A, B, C].map((J) => J.until(tousVisibles, 8000, `fin de révélation chez ${J.nom}`).then(() => true, () => false)));
  t('au bout de la révélation : tout est visible chez les trois', finis.every(Boolean), JSON.stringify(finis));

  const vues = await Promise.all([A, B, C].map((J) => J.eval(LIRE)));
  t('« 🏆 Soirée terminée », code de la session, chez les trois', vues.every((v) => /Soirée terminée/.test(v.titre) && v.code === code));
  t('podium = la finale du Hub, identique chez les trois : 🥇 Ana 40, 🥇 Bob 40, 🥉 Cam 20, 4. Dan 10',
    vues.every((v) => same(v.rang.map((l) => [l.id, l.pts, l.rank, l.medaille]), [[ids.A, 40, 1, '🥇'], [ids.B, 40, 1, '🥇'], [ids.C, 20, 3, '🥉'], [ids.D, 10, 4, '4.']]))
    && same(vues[0].rang.map((l) => [l.id, l.pts, l.rank]), F.ranking.map((l) => [l.playerId, l.points, l.rank])), JSON.stringify(vues[0].rang.map((l) => [l.id, l.pts, l.medaille])));
  t('Dan, parti avant la fin : au podium avec ses points, marqué « parti »', vues.every((v) => v.rang[3].parti && v.rang[3].av));
  t('chacun voit SA ligne en évidence', vues.every((v, i) => v.rang.find((l) => l.moi).id === [ids.A, ids.B, ids.C][i]));
  t('le total des parties et l\'historique suivent le podium', vues.every((v) => v.count === '1' && v.jeux.length === 1 && v.jeux[0].game === 'passeur'));
  t('la phrase dit qui a terminé', /^Tu as terminé/.test(await A.eval(`document.getElementById('recap-sub').textContent`)) && /Ana a terminé/.test(await B.eval(`document.getElementById('recap-sub').textContent`)));
  t('lecteurs d\'écran : les vainqueurs à égalité sont annoncés', /à égalité : Ana, Bob/.test(await B.eval(`document.getElementById('recap-live').textContent`)));
  t('le salon est rangé, l\'accueil caché derrière le podium', (await Promise.all([A, B, C].map((J) => J.eval(`document.getElementById('lobby').hidden && document.getElementById('entry').hidden`)))).every(Boolean));
  t('plus de session à reprendre dans ces onglets', (await Promise.all([A, B, C].map((J) => J.eval(`sessionStorage.getItem('mathys_hub_session')`)))).every((x) => x === null));
  t('aucun refus du Hub côté hôte pendant la fin', trames(A, 'error').length === 0, JSON.stringify(trames(A, 'error')));

  for (const [w_, h_] of [[1280, 900], [390, 780]]) {
    await B.size(w_, h_); await sleep(250);
    const g = await B.eval(GEOM);
    t(`${w_} px : podium lisible — rien ne déborde, rien ne se chevauche, pas de défilement horizontal`, !g.deborde.length && !g.chev.length && !g.coupe.length && !g.scrollX, JSON.stringify(g));
    if (SHOTS) await B.shot(`finale-${w_}`, '#hub-recap');
  }
  await B.size(1280, 900);
  // ⚠️ Laisser la mise en page se refaire après le passage mobile → bureau :
  // cliqué dans la foulée, le clic se perdait par intermittence (2 fois sur 5).
  await sleep(300);

  // « Retour à l'accueil »
  await B.click('#recap-home');
  await B.until(`!document.getElementById('entry').hidden && document.getElementById('hub-recap').hidden`, 3000, 'accueil');
  t('« Retour à l\'accueil » : hors session, l\'accueil, sans podium', /soirée est terminée/i.test(await B.eval(`document.getElementById('hub-state').textContent`)));
  await B.goto(PAGE);
  await sleep(500);
  t('recharger ensuite : ni reprise, ni podium recréé', (await B.eval(`!document.getElementById('entry').hidden && document.getElementById('hub-recap').hidden && document.getElementById('lobby').hidden`)));

  // ═══ 2. absent pendant la fin : il revient, pas de reprise, le podium
  {
    const x = await entre('Xia', 'p_finx');
    const code2 = x.last().code;
    const y = await entre('Yan', 'p_finy', code2);
    await partie(x, [y], 'passeur', { Xia: 2, Yan: 1 });   // 10 / 20
    await x.fermer(); await y.fermer();
    await reprend(A, 'p_finx', 'Xia', code2);                // A = Xia, hôte
    await reprend(C, 'p_finy', 'Yan', code2);                // C = Yan
    await C.eval(`location.href = 'about:blank'; true`);     // Yan quitte l'onglet (absent, en grâce)
    await A.until(`[...document.querySelectorAll('#hub-players .hub-card.is-away')].length === 1`, 8000, 'Yan absent');
    await A.click('#hub-finish');
    await A.until(`document.getElementById('finish-dialog').open`, 3000, 'confirmation');
    await A.click('#finish-confirm');
    await A.until(finaleVue, 8000, 'podium chez Xia');
    await C.goto(PAGE);                                       // Yan revient : sa session est toujours notée dans l'onglet
    await C.until(finaleVue, 10000, 'podium chez Yan qui revient');
    const v = await C.eval(LIRE);
    t('absent pendant la fin, il revient : PAS de reprise, le podium final (🥇 Yan 20, 🥈 Xia 10)', same(v.rang.map((l) => [l.id, l.pts, l.medaille]), [['p_finy', 20, '🥇'], ['p_finx', 10, '🥈']])
      && (await C.eval(`document.getElementById('lobby').hidden`)), JSON.stringify(v.rang));
    const refus = C.recus.filter((f) => f.g === 'hub' && f.d.type === 'error').pop();
    t('… c\'est le refus SESSION_CLOSED du Hub qui porte ce podium', !!refus && refus.d.code === 'SESSION_CLOSED' && !!refus.d.finale);
  }

  // ═══ 3. l'hôte seul, sans aucune partie
  {
    await A.goto(PAGE);
    await A.eval(`localStorage.setItem('mathys_game_profile', ${JSON.stringify(JSON.stringify({ v: 1, id: 'p_finsolo', name: 'Solo', avatar: { kind: 'emoji', emoji: '🦊' } }))}); true`);
    await A.goto(PAGE);
    await A.click('#hub-create');
    await A.until(`!document.getElementById('lobby').hidden && !document.getElementById('hub-finish').hidden`, 10000, 'salon solo');
    await A.click('#hub-finish');
    await A.until(`document.getElementById('finish-dialog').open`, 3000, 'confirmation solo');
    await A.click('#finish-confirm');
    await A.until(`${finaleVue} && ${toutMontre}`, 8000, 'podium solo');
    const v = await A.eval(LIRE);
    t('solo, sans partie : une ligne (toi, 0 pt), « Aucune partie classée », pas de faux historique', v.rang.length === 1 && v.rang[0].moi && v.rang[0].pts === 0
      && v.count === '0' && v.last === '—' && v.jeux.length === 0 && (await A.eval(`!document.getElementById('recap-empty').hidden && document.getElementById('recap-games').hidden`)), JSON.stringify(v));
    await A.size(390, 780); await sleep(250);
    const g = await A.eval(GEOM);
    t('solo, 390 px : rien ne déborde', !g.deborde.length && !g.coupe.length && !g.scrollX, JSON.stringify(g));
    if (SHOTS) await A.shot('finale-solo-390', '#hub-recap');
  }

  const errs = [A, B, C].flatMap((J) => J.erreurs.map((e) => `[${J.nom}] ${e}`));
  t('aucune erreur JS', errs.length === 0, errs.slice(0, 3).join(' | '));
} catch (e) {
  t('EXCEPTION', false, e.stack || e.message);
} finally {
  try { execFileSync('taskkill', ['/PID', String(edge.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (_) { try { edge.kill(); } catch (__) {} }
  procs.forEach((p) => { try { p.kill(); } catch (_) {} });
  try { cdp && cdp.close(); } catch (_) {}
  try { srv.close(); } catch (_) {}
  sante.close();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  try { fs.unlinkSync(MANIFEST); } catch (_) {}
}
console.log(`\n${ko ? 'DES TESTS ÉCHOUENT' : 'TOUT PASSE'} — ${out.length} vérifications, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
