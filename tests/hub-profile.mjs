// Le PROFIL JOUEUR dans le Game Hub (lot G) : la vraie page /games/, de vrais
// navigateurs, un VRAI game-hub-server local.
//
//   node tests/hub-profile.mjs              mouvement normal
//   node tests/hub-profile.mjs --reduced    mouvement réduit
//   node tests/hub-profile.mjs --shots <d>  captures (profil fermé / ouvert, nom long, 390 / 1280 px, photo, clavier)
//
// Trois niveaux qui ne se mélangent pas (CLAUDE.md, « Profil joueur ») :
//   profil local (games/shared/game-profile.js) → préférence, dans ce navigateur ;
//   identité de session → ce que le Hub a reçu au `join`, montrée à tous ;
//   serveur → seule autorité (hôte, score, résultats).
//
// Scénarios :
//   A. aucun profil : un id est écrit une fois (stable au rechargement),
//      l'éditeur s'ouvre, « Créer » attend un pseudo ;
//   B/C/D. pseudo (nettoyé : invisibles, forçage de sens, espaces, 16 unités,
//      emoji jamais coupé en deux, HTML affiché en TEXTE), icône, photo ;
//      restaurés au rechargement ; le Hub reçoit la version nettoyée ;
//   E. stockage corrompu (texte illisible, JSON hostile) → le Hub démarre ;
//      stockage BLOQUÉ (localStorage qui jette) → on entre quand même ;
//   F. un joueur sans profil rejoint une session comme avant ;
//   G. la même identité (nom + photo) dans le salon, le score, la carte
//      Résultat, le panneau « ton profil », le récap et la finale ; un profil
//      local changé ailleurs ne remplace PAS l'identité de la soirée ;
//   H. 390 / 768 / 1100 / 1280 px, nom long : rien ne déborde ;
//   I. clavier : vraie touche Tab / Entrée / Échap, focus au bon endroit,
//      jamais perdu sur <body>, même quand le salon est redessiné.
//
// ⚠️ Comme hub-recap.mjs / hub-finale.mjs : les parties « jouées » le sont par
// des clients Node (protocole du Hub, AUCUN jeu lancé) avec l'id du profil du
// navigateur, qui reprend ensuite la session — le vrai retour au Hub.
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
const KEY = 'mathys_game_profile';

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
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const full = path.join(ROOT, p);
    if (!full.startsWith(ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
    res.end(fs.readFileSync(full));
  });
  return new Promise((r) => srv.listen(HTTP_PORT, '127.0.0.1', () => r(srv)));
}

// --- CDP (même plomberie que hub-finale.mjs) ---------------------------------------
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

// `opts.bloque` : localStorage JETTE à chaque accès (cookies bloqués, ancienne
// navigation privée) — posé avant tout script de la page.
async function joueur(cdp, nom, opts = {}) {
  const { result: { browserContextId } } = await cdp.send('Target.createBrowserContext', { disposeOnDetach: true });
  const { result: { targetId } } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { result: { sessionId } } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const J = { nom, erreurs: [], envoyes: [] };
  cdp.on(sessionId, (m) => {
    const p = m.params || {};
    if (m.method === 'Runtime.exceptionThrown') J.erreurs.push((p.exceptionDetails.exception?.description || p.exceptionDetails.text || '').split('\n')[0]);
    if (m.method === 'Network.webSocketFrameSent') { try { J.envoyes.push(JSON.parse(p.response.payloadData)); } catch (_) {} }
  });
  const S = (m, p) => cdp.send(m, p, sessionId);
  await S('Runtime.enable'); await S('Page.enable'); await S('Network.enable');
  if (opts.bloque) {
    await S('Page.addScriptToEvaluateOnNewDocument', { source: `Object.defineProperty(window, 'localStorage', { configurable: true,
      get() { throw new DOMException('stockage bloqué (test)', 'SecurityError'); } });` });
  }
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
  // De vraies touches (voir tests/README.md : Tab sans `text`, Entrée avec).
  J.tab = async (shift = false) => {
    for (const type of ['rawKeyDown', 'keyUp']) await S('Input.dispatchKeyEvent', { type, key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: shift ? 8 : 0 });
    await sleep(50);
  };
  J.enter = async () => {
    await S('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
    await S('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await sleep(120);
  };
  J.escape = async () => {
    for (const type of ['rawKeyDown', 'keyUp']) await S('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(150);
  };
  J.upload = async (sel, file) => {
    await S('DOM.enable');
    const { result: { root } } = await S('DOM.getDocument', { depth: 0 });
    const { result: { nodeId } } = await S('DOM.querySelector', { nodeId: root.nodeId, selector: sel });
    await S('DOM.setFileInputFiles', { files: [file], nodeId });
  };
  J.shot = async (nomFichier) => {
    if (!SHOTS) return;
    await sleep(200);
    const r = await S('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOTS, (REDUCED ? 'r-' : '') + nomFichier + '.png'), Buffer.from(r.result.data, 'base64'));
  };
  J.profil = () => J.eval(`(() => { try { return JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})); } catch (_) { return 'bloqué'; } })()`);
  J.joins = () => J.envoyes.filter((m) => m.action === 'join' || m.action === 'create');
  return J;
}

// ═══════════════════════════════════════════ la vraie page, le vrai Hub
const WS = createRequire(path.join(ROOT, '..', 'game-hub-server', 'package.json'))('ws');
const sante = await fakeHealth(HEALTH_PORT);
const MANIFEST = localManifest(ROOT, HEALTH_PORT);
lance(path.join(ROOT, '..', 'game-hub-server'), 'src/server.js', HUB_PORT, { MANIFEST_FILE: MANIFEST });
const srv = await serve();
await attends(`http://127.0.0.1:${HUB_PORT}/health`);
const PAGE = `http://127.0.0.1:${HTTP_PORT}/games/?hub=${encodeURIComponent(HUB)}`;
const TOUS = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')).games.map((g) => g.id);

// Un client du Hub en Node : le protocole, rien d'autre (même forme que hub-finale.mjs).
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
async function entre(nom, id, code, name = nom) {
  const c = client(nom); await c.open;
  const player = { id, name, avatar: { kind: 'emoji', emoji: '🦊' } };
  c.send(code ? { action: 'join', code, player } : { action: 'create', player });
  await c.waitFor((m) => m.type === 'joined' || m.type === 'created');
  return c;
}
// Une partie « jouée » par le protocole seul (voir hub-finale.mjs).
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

// Ce que l'écran d'entrée montre du profil.
const ENTREE = `(() => ({ nom: document.getElementById('me-name').textContent, note: document.getElementById('me-note').textContent,
  img: (document.querySelector('#me-avatar img') || {}).src || null, emoji: (document.querySelector('#me-avatar .g-av-e') || document.getElementById('me-avatar')).textContent.trim(),
  editeur: !document.getElementById('identity').hidden, creer: !document.getElementById('hub-create').disabled,
  entree: !document.getElementById('entry').hidden, salon: !document.getElementById('lobby').hidden,
  balises: document.querySelectorAll('#me-name *, #hub-players .hub-card-name *').length, pwn: !!window.pwn }))()`;
// L'identité d'un joueur, lue dans CHAQUE endroit qui l'affiche.
const PARTOUT = (id) => `(() => { const q = (s) => document.querySelector(s);
  const lire = (li, nomSel) => li ? { nom: ((li.querySelector(nomSel).firstChild || {}).textContent || '').replace(' (toi)', ''), img: (li.querySelector('.g-av img') || {}).src || null,
    emoji: li.querySelector('.g-av img') ? null : (li.querySelector('.g-av') || {}).textContent || null } : null;
  const dlg = q('#profile-dialog');
  return {
    salon: lire(q('#hub-players .hub-card[data-player=${JSON.stringify(id)}]'), '.hub-card-name'),
    score: lire(q('#hub-score-list .hub-score-row[data-player=${JSON.stringify(id)}]'), '.hub-score-name'),
    resultat: q('#hub-round').hidden ? null : lire(q('#round-list .round-row[data-player=${JSON.stringify(id)}]'), '.round-name'),
    recap: q('#hub-recap').hidden ? null : lire(q('#recap-ranking .recap-row[data-player=${JSON.stringify(id)}]'), '.recap-name'),
    profil: dlg.open ? { nom: q('#profile-name').textContent, img: (q('#profile-avatar img') || {}).src || null } : null,
  }; })()`;
// Rien ne déborde : la carte, son nom et son bouton ; le panneau dans l'écran.
const GEOM = `(() => { const R = (e) => e.getBoundingClientRect(); const moi = document.querySelector('#hub-players .hub-card.is-me');
  const c = R(moi), n = moi.querySelector('.hub-card-name'), b = document.getElementById('hub-profile-btn'), rb = R(b), code = R(document.getElementById('hub-code'));
  const dlg = document.getElementById('profile-dialog'), rd = dlg.open ? R(dlg.querySelector('.panel')) : null;
  const pn = document.getElementById('profile-name');
  return { largeur: innerWidth, scrollX: document.documentElement.scrollWidth - innerWidth,
    carte: rb.left >= c.left - 0.5 && rb.right <= c.right + 0.5 && rb.bottom <= c.bottom + 0.5 && R(n).right <= c.right + 0.5 && n.scrollWidth <= n.clientWidth + 1,
    bouton: Math.round(rb.width) + '×' + Math.round(rb.height), codeVu: code.left >= 0 && code.right <= innerWidth,
    panneau: rd ? rd.left >= 0 && rd.right <= innerWidth + 0.5 && rd.top >= 0 && rd.bottom <= innerHeight + 0.5 && pn.scrollWidth <= pn.clientWidth + 1 : null }; })()`;
const trouve = (J, sel) => J.eval(`!!document.querySelector(${JSON.stringify(sel)})`);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hubprofil-'));
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${dir}`, '--no-first-run',
  '--disable-features=BackForwardCache', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank'], { stdio: 'ignore' });
let cdp = null;
const PHOTO = path.join(ROOT, 'assets', 'og-image.png');

try {
  cdp = await cdpBrowser();
  console.log(`Profil joueur du Game Hub — vrais navigateurs, vrai Hub (${REDUCED ? 'mouvement RÉDUIT' : 'mouvement normal'})\n`);

  // ═══ A. aucun profil
  const A = await joueur(cdp, 'A');
  await A.goto(PAGE);
  const p0 = await A.profil(), e0 = await A.eval(ENTREE);
  t('A. aucun profil : un id local est écrit tout de suite (p_…), sans pseudo', !!p0 && /^p_[a-z0-9]+$/.test(p0.id) && p0.name === '' && p0.v === 1, JSON.stringify(p0));
  t('A. aucun profil : « sans pseudo », l\'éditeur est ouvert, « Créer » attend un pseudo', e0.nom === 'sans pseudo' && e0.editeur && !e0.creer, JSON.stringify(e0));
  await A.goto(PAGE);
  t('A. aucun profil : le MÊME id au rechargement (pas un nouveau joueur à chaque visite)', (await A.profil()).id === p0.id);
  await A.shot('A-entree-sans-profil');

  // ═══ C. le pseudo, nettoyé — ce qui est enregistré, affiché, envoyé
  const cas = [
    ['  Zoé   la\tFusée ', 'Zoé la Fusée', 'espaces en trop, tabulation'],
    ['\u202eecilA\u200b\n', 'ecilA', 'forçage de sens (U+202E), espace invisible, retour à la ligne'],
    ['ABCDEFGHIJKLMNO🦊', 'ABCDEFGHIJKLMNO', '16 unités sans couper l\'emoji (sinon « � »)'],
    ['Élodie 🦊', 'Élodie 🦊', 'accents et emoji gardés'],
  ];
  for (const [tape, attendu, quoi] of cas) {
    await A.eval(`(() => { const i = document.getElementById('name-input'); i.removeAttribute('maxlength'); i.value = ${JSON.stringify(tape)};
      i.dispatchEvent(new Event('input')); i.dispatchEvent(new Event('change')); return true; })()`);
    const v = await A.eval(`({ champ: document.getElementById('name-input').value, carte: document.getElementById('me-name').textContent })`);
    const p = await A.profil();
    t(`C. pseudo — ${quoi} : enregistré « ${attendu} », et c'est ce que montrent le champ et la carte`, p.name === attendu && v.champ === attendu && v.carte === attendu, JSON.stringify({ p: p.name, ...v }));
  }
  await A.eval(`document.getElementById('name-input').setAttribute('maxlength', '16'); true`);
  // Du HTML dans le pseudo : affiché en TEXTE, partout, et jamais exécuté.
  await A.type('#name-input', '<b>x</b><img src=x onerror="window.pwn=1">');
  await A.click('#identity-done');
  const eh = await A.eval(ENTREE);
  t('C. un pseudo en HTML s\'affiche en texte (aucune balise créée, rien d\'exécuté)', eh.balises === 0 && !eh.pwn && eh.nom.startsWith('<b>x</b>'), JSON.stringify(eh));
  await A.click('#identity-toggle');
  await A.type('#name-input', 'Mathys Langiny');
  // ═══ D. l'icône puis la photo
  await A.click('#avatar-row .avatar-pick:nth-child(4)');
  const emo = await A.eval(`document.querySelector('#avatar-row .avatar-pick:nth-child(4)').textContent`);
  await A.until(`document.querySelector('#me-avatar').textContent.includes(${JSON.stringify(emo)})`, 3000, 'icône sur la carte');
  t('D. icône choisie : enregistrée et affichée sur la carte', (await A.profil()).avatar.emoji === emo, emo);
  await A.upload('#gp-file', PHOTO);
  await A.until(`GameProfile.load().avatar.kind === 'image' && !!document.querySelector('#me-avatar img')`, 8000, 'photo sur la carte');
  const pA = await A.profil();
  t('D. photo : 96×96 webp/png ≤ 12 Ko, affichée sur la carte, l\'icône gardée en repli',
    /^data:image\/(webp|png);base64,/.test(pA.avatar.src) && pA.avatar.emoji === emo && (await A.eval(ENTREE)).img === pA.avatar.src);
  await A.click('#identity-done');
  // ═══ B. restauré au rechargement
  await A.goto(PAGE);
  const eb = await A.eval(ENTREE), pb = await A.profil();
  t('B. profil existant : pseudo, photo et id restaurés au chargement, éditeur fermé', eb.nom === 'Mathys Langiny' && eb.img === pA.avatar.src && !eb.editeur && eb.creer && pb.id === p0.id, JSON.stringify({ ...eb, img: !!eb.img }));
  await A.shot('B-entree-profil-photo');

  // ═══ E. stockage corrompu, puis hostile, puis BLOQUÉ
  const E = await joueur(cdp, 'E');
  await E.goto(PAGE);
  await E.eval(`localStorage.setItem(${JSON.stringify(KEY)}, '{pas du json'); true`);
  await E.goto(PAGE);
  const ec = await E.eval(ENTREE), pc = await E.profil();
  t('E. stockage illisible : le Hub démarre, profil neuf (id écrit), éditeur ouvert', ec.entree && ec.editeur && !!pc && /^p_/.test(pc.id) && E.erreurs.length === 0, JSON.stringify({ ec, err: E.erreurs }));
  await E.eval(`localStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(JSON.stringify({ v: 1, id: 'p_hostile1', name: '\u202e<i>Eve</i>\n', avatar: { kind: 'image', emoji: '🦊', src: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' } }))}); true`);
  await E.goto(PAGE);
  const eo = await E.eval(ENTREE);
  t('E. profil hostile relu : forçage de sens retiré, HTML en texte, SVG refusé (l\'icône à la place)', eo.nom === '<i>Eve</i>' && eo.balises === 0 && !eo.img && eo.emoji === '🦊', JSON.stringify(eo));
  await E.click('#hub-create');
  await E.until(`!document.getElementById('lobby').hidden`, 10000, 'salon de E');
  const je = E.joins().pop();
  t('E. … et il entre dans une session ; le Hub reçoit le pseudo NETTOYÉ et l\'icône', je && je.player.name === '<i>Eve</i>' && je.player.avatar.kind === 'emoji', JSON.stringify(je && je.player));

  // Stockage BLOQUÉ : chaque accès à localStorage jette. Le Hub doit rester
  // utilisable — et le pseudo tapé doit tenir jusqu'à « Créer ».
  const P = await joueur(cdp, 'P', { bloque: true });
  await P.goto(PAGE);
  t('E. stockage bloqué : la page démarre sans erreur, éditeur ouvert', (await P.eval(ENTREE)).editeur && P.erreurs.length === 0, P.erreurs.join(' | '));
  await P.type('#name-input', 'WWWWWWWWWWWWWWWW');
  await P.click('#hub-create');
  let entreBloque = true;
  try { await P.until(`!document.getElementById('lobby').hidden`, 8000, 'salon de P'); } catch (_) { entreBloque = false; }
  const msgP = await P.eval(`document.getElementById('hub-msg').textContent`);
  t('E. stockage bloqué : on entre quand même dans une session (le pseudo tapé n\'est pas perdu)', entreBloque, msgP);
  const idsP = P.joins().map((m) => m.player.id);
  if (entreBloque) {
    await P.click('#hub-profile-btn');
    const w = await P.eval(`document.getElementById('profile-where').textContent`);
    t('E. stockage bloqué : le panneau le dit (« ne garde pas ton profil »)', /ne garde pas ton profil/.test(w), w);
    // ═══ H. nom long (16 × W, le plus large possible) aux quatre largeurs
    for (const [w, h] of [[390, 780], [768, 1024], [1100, 900], [1280, 900]]) {
      await P.size(w, h); await sleep(250);
      const g = await P.eval(GEOM);
      t(`H. ${w} px, nom long, panneau ouvert : panneau dans l'écran, nom sans débordement`, g.panneau === true && g.scrollX <= 0, JSON.stringify(g));
      if (w === 390 || w === 1280) await P.shot(`H-nom-long-panneau-${w}`);
    }
    await P.escape();
    for (const [w, h] of [[390, 780], [768, 1024], [1100, 900], [1280, 900]]) {
      await P.size(w, h); await sleep(250);
      await P.eval(`document.getElementById('hub-code').scrollIntoView({ block: 'start', behavior: 'instant' }); true`);
      const g = await P.eval(GEOM);
      t(`H. ${w} px, nom long : carte, nom et bouton « ton profil » tiennent, code à l'écran, aucun défilement horizontal`, g.carte && g.codeVu && g.scrollX <= 0, JSON.stringify(g));
      if (w === 390 || w === 1280) await P.shot(`H-nom-long-salon-${w}`);
    }
  }

  // ═══ F. un joueur SANS profil rejoint une session existante, comme avant
  const codeE = await E.eval(`document.getElementById('hub-code').textContent.trim()`);
  const F = await joueur(cdp, 'F');
  await F.goto(PAGE);
  await F.type('#name-input', 'Fanny');
  await F.click('#identity-done');
  await F.type('#hub-code-input', codeE);
  await F.click('#hub-join');
  await F.until(`!document.getElementById('lobby').hidden && document.querySelectorAll('#hub-players .hub-card').length === 2`, 10000, 'F dans la session de E');
  const nomsE = await E.until(`(() => { const n = [...document.querySelectorAll('#hub-players .hub-card-name')].map((x) => x.firstChild.textContent); return n.length === 2 && n; })()`, 8000);
  t('F. sans profil : pseudo tapé, « Rejoindre » → dans la session, vu par l\'hôte', nomsE.includes('Fanny') && nomsE.includes('<i>Eve</i>'), nomsE.join(', '));
  t('F. le bouton « ton profil » n\'est QUE sur sa propre carte', await F.eval(`document.querySelectorAll('#hub-profile-btn').length === 1 && !!document.querySelector('#hub-players .hub-card.is-me #hub-profile-btn')`));

  // ═══ G. la même identité partout — salon, score, carte Résultat, profil, récap, finale
  // Une partie classée jouée par des clients Node (l'un avec l'id du profil de
  // A), puis A reprend la session avec SON profil (photo comprise).
  const nomA = 'Mathys Langiny';
  const na = await entre('Mat', p0.id, null, nomA);
  const code1 = na.last().code;
  const nb = await entre('Bob', 'p_profb', code1), nc = await entre('Cam', 'p_profc', code1);
  await partie(na, [nb, nc], 'passeur', { Mat: 1, Bob: 2, Cam: 3 });
  await na.fermer();
  await A.eval(`sessionStorage.setItem('mathys_hub_session', ${JSON.stringify(code1)}); true`);
  await A.goto(PAGE);
  await A.until(`!document.getElementById('lobby').hidden && !document.getElementById('hub-round').hidden`, 10000, 'A de retour au salon, carte Résultat');
  const ga = await A.eval(PARTOUT(p0.id));
  const ok = (x) => x && x.nom === nomA && x.img === pA.avatar.src;
  t('G. salon : la carte de A = son pseudo et SA photo', ok(ga.salon), JSON.stringify(ga.salon && { ...ga.salon, img: !!ga.salon.img }));
  t('G. score : la ligne de A = le même pseudo, la même photo', ok(ga.score), JSON.stringify(ga.score && { ...ga.score, img: !!ga.score.img }));
  t('G. carte Résultat : la ligne de A = le même pseudo, la même photo', ok(ga.resultat), JSON.stringify(ga.resultat && { ...ga.resultat, img: !!ga.resultat.img }));
  const gb = await nb.until((x) => x.players.some((p) => p.id === p0.id && p.connected && p.avatar && p.avatar.kind === 'image'), 5000);
  const vuParB = gb.players.find((p) => p.id === p0.id);
  t('G. et les AUTRES le voient pareil (état du Hub diffusé : pseudo + photo)', vuParB.name === nomA && vuParB.avatar.kind === 'image' && vuParB.avatar.src === pA.avatar.src);
  await A.shot('G-salon-profil-ferme');

  // I. clavier : la vraie touche Tab atteint « ton profil », Entrée ouvre,
  // focus sur « Fermer », Échap ferme, le focus revient au bouton.
  await A.eval(`document.getElementById('hub-code').focus(); true`);
  let atteint = false;
  for (let i = 0; i < 25 && !atteint; i++) { await A.tab(); atteint = await A.eval(`document.activeElement && document.activeElement.id === 'hub-profile-btn'`); }
  const anneau = atteint && await A.eval(`(() => { const b = document.getElementById('hub-profile-btn'); return b.matches(':focus-visible') && /rgb\\(255, 215, 0\\)/.test(getComputedStyle(b).boxShadow); })()`);
  t('I. clavier : « ton profil » atteint à la vraie touche Tab, anneau doré visible', atteint && anneau);
  await A.shot('I-clavier-bouton');
  await A.enter();
  const ouvert = await A.eval(`({ open: document.getElementById('profile-dialog').open, focus: document.activeElement && document.activeElement.id,
    modal: document.getElementById('profile-dialog').matches(':modal'), exp: document.getElementById('hub-profile-btn').getAttribute('aria-haspopup') })`);
  t('I. Entrée ouvre le panneau (modal), focus initial sur « Fermer »', ouvert.open && ouvert.modal && ouvert.focus === 'profile-close' && ouvert.exp === 'dialog', JSON.stringify(ouvert));
  const gp = await A.eval(PARTOUT(p0.id));
  t('G. panneau « ton profil » : l\'identité de la soirée (même pseudo, même photo)', ok(gp.profil), JSON.stringify(gp.profil && { ...gp.profil, img: !!gp.profil.img }));
  const txt = await A.eval(`({ s: document.getElementById('profile-session').textContent, l: document.getElementById('profile-local').hidden, w: document.getElementById('profile-where').textContent })`);
  t('G. panneau : dit que c\'est l\'identité de la soirée (code), qu\'on la change à l\'accueil, et qu\'elle est gardée dans ce navigateur',
    txt.s.includes(code1) && /accueil/.test(txt.s) && txt.l && /Enregistré dans ce navigateur/.test(txt.w), JSON.stringify(txt));
  await A.shot('G-profil-ouvert');
  await A.escape();
  const ferme = await A.eval(`({ open: document.getElementById('profile-dialog').open, focus: document.activeElement && document.activeElement.id })`);
  t('I. Échap ferme, le focus revient à « ton profil »', !ferme.open && ferme.focus === 'hub-profile-btn', JSON.stringify(ferme));
  // Le salon est redessiné (un état du Hub arrive) pendant que le focus est
  // sur le bouton : il ne doit PAS retomber sur <body>.
  nb.send({ action: 'prefs', love: ['precision'], veto: [] });
  await A.until(`[...document.querySelectorAll('#hub-games .hub-game-loves')].some((e) => /Bob/.test(e.textContent))`, 5000, 'nouvel état chez A');
  t('I. salon redessiné par un état du Hub : le focus reste sur « ton profil »', await A.eval(`document.activeElement && document.activeElement.id === 'hub-profile-btn'`));
  // Pareil panneau OUVERT : l'état arrive, on ferme (bouton), le focus revient.
  await A.enter();
  nc.send({ action: 'prefs', love: ['precision'], veto: [] });
  await A.until(`[...document.querySelectorAll('#hub-games .hub-game-loves')].some((e) => /Cam/.test(e.textContent))`, 5000, 'nouvel état chez A (2)');
  await A.enter();                                         // le focus est sur « Fermer »
  const f2 = await A.eval(`({ open: document.getElementById('profile-dialog').open, focus: document.activeElement && document.activeElement.id })`);
  t('I. état reçu PENDANT que le panneau est ouvert : « Fermer » (Entrée) → focus rendu au bouton', !f2.open && f2.focus === 'hub-profile-btn', JSON.stringify(f2));

  // Un profil local changé AILLEURS (autre onglet, page de jeu) ne remplace
  // PAS l'identité de la soirée : le panneau le dit, sans l'afficher à sa place.
  await A.eval(`(() => { const p = JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})); p.name = 'Autre Nom'; localStorage.setItem(${JSON.stringify(KEY)}, JSON.stringify(p)); return true; })()`);
  await A.click('#hub-profile-btn');
  const gl = await A.eval(PARTOUT(p0.id));
  const loc = await A.eval(`({ vu: !document.getElementById('profile-local').hidden, t: document.getElementById('profile-local').textContent })`);
  t('G. profil local changé ailleurs : le salon et le panneau gardent l\'identité de la soirée', ok(gl.salon) && ok(gl.profil), JSON.stringify(gl.profil && gl.profil.nom));
  t('G. … et le panneau le dit (« Autre Nom », pris à la prochaine connexion)', loc.vu && /Autre Nom/.test(loc.t) && /prochaine connexion/.test(loc.t), loc.t);
  await A.shot('G-profil-local-change');
  await A.click('#profile-close');
  await A.eval(`(() => { const p = JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})); p.name = ${JSON.stringify(nomA)}; localStorage.setItem(${JSON.stringify(KEY)}, JSON.stringify(p)); return true; })()`);
  // Récap (Quitter) : même identité.
  await A.click('#hub-leave');
  await A.until(`!document.getElementById('hub-recap').hidden`, 5000, 'récap de A');
  const gr = await A.eval(PARTOUT(p0.id));
  t('G. récap de soirée : la ligne de A = le même pseudo, la même photo', ok(gr.recap), JSON.stringify(gr.recap && { ...gr.recap, img: !!gr.recap.img }));
  t('G. le panneau « ton profil » est fermé hors du salon', !(await A.eval(`document.getElementById('profile-dialog').open`)));
  // Finale : une autre soirée, terminée par A.
  const na2 = await entre('Mat', p0.id, null, nomA);
  const code2 = na2.last().code;
  const nd = await entre('Dan', 'p_profd', code2);
  await partie(na2, [nd], 'passeur', { Mat: 1, Dan: 2 });
  await na2.fermer();
  await A.eval(`sessionStorage.setItem('mathys_hub_session', ${JSON.stringify(code2)}); true`);
  await A.goto(PAGE);
  await A.until(`!document.getElementById('lobby').hidden && !document.getElementById('hub-finish').hidden`, 10000, 'A hôte, au salon');
  await A.click('#hub-finish');
  await A.click('#finish-confirm');
  await A.until(`!document.getElementById('hub-recap').hidden && document.getElementById('hub-recap').classList.contains('is-final')`, 8000, 'finale chez A');
  await A.until(`!document.getElementById('hub-recap').classList.contains('is-revealing')`, 8000, 'révélation finie');
  const gf = await A.eval(PARTOUT(p0.id));
  t('G. finale : la ligne de A sur le podium = le même pseudo, la même photo', ok(gf.recap), JSON.stringify(gf.recap && { ...gf.recap, img: !!gf.recap.img }));
  // Aucun identifiant réseau changé : A a toujours rejoint avec l'id de SON profil.
  t('G. un seul id pour A du début à la fin (celui du profil local), à chaque join', A.joins().length >= 2 && A.joins().every((m) => m.player.id === p0.id), [...new Set(A.joins().map((m) => m.player.id))].join(','));
  for (const c of [nb, nc, nd]) await c.fermer();

  const errs = [A, E, P, F].flatMap((J) => J.erreurs.map((e) => `[${J.nom}] ${e}`));
  t('aucune erreur JS dans les pages', errs.length === 0, errs.slice(0, 3).join(' | '));
  if (idsP.length) t('E. stockage bloqué : un seul id pour la page, à chaque envoi', new Set(idsP).size === 1, idsP.join(','));
} catch (e) {
  t('EXCEPTION', false, e.message);
} finally {
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
