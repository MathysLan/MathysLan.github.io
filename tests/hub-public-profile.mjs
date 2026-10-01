// Les PROFILS PUBLICS dans le Game Hub (lot K) : la vraie page /games/, deux
// vrais navigateurs, un VRAI game-hub-server local (statistiques en mémoire).
//
//   node tests/hub-public-profile.mjs              mouvement normal
//   node tests/hub-public-profile.mjs --reduced    mouvement réduit
//   node tests/hub-public-profile.mjs --shots <d>  captures (profil public 1280 / 390, nouveau, parti)
//
// ⚠️ LE HUB DÉCIDE QUI VOIT QUOI (game-hub-server, test-public-profile.js :
// même session, clé de la cible vérifiée, usurpation, ids forgés). Ici : ce
// que la PAGE en fait. Les parties sont jouées par des clients Node avec l'id
// ET la clé des profils des navigateurs, qui reviennent ensuite dans la soirée.
//
// Scénarios : bouton « 👤 Profil » sur les cartes des AUTRES (le sien garde
// « ton profil ») ; rien demandé avant le clic ; profil de Bob vu par Ana =
// profil privé de Bob (stats, par jeu, records, succès), sans « Ton profil » ;
// nouveau joueur (« Aucune partie enregistrée ») ; joueur sans clé ; joueur
// qui part pendant que son profil est ouvert ; clavier (Tab, Entrée, Échap,
// focus rendu, focus gardé quand le salon change) ; « Ton profil » après ;
// 390 → 1280 px ; deux joueurs seulement ; refus côté protocole ; aucune fuite.
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
const HUBDIR = path.join(ROOT, '..', 'game-hub-server');
const WS = createRequire(path.join(HUBDIR, 'package.json'))('ws');

// ═══ sans navigateur : la réponse relue en liste blanche
{
  const GH = createRequire(import.meta.url)('../games/shared/game-hub.js');
  const r = GH.readPublicProfile({ playerId: 'p_b', reason: null, profile: { name: 'Bob'.padEnd(60, '!'), avatar: { kind: 'emoji', emoji: '🦊' }, present: true, key: 'k'.repeat(43),
    stats: { played: 2, solo: 0, wins: 1, podiums: 2, best: 1, games: [], records: null, achievements: [{ code: 'first-win', unlocked: true, at: 5, drawId: 'd_1' }], keyHash: 'h' } } });
  t('readPublicProfile : nom borné, champs inconnus jetés (key, keyHash, drawId)', r.profile.name.length === 40 && !JSON.stringify(r).includes('kkkk') && !/keyHash|drawId/.test(JSON.stringify(r))
    && r.profile.stats.played === 2 && same(r.profile.stats.achievements, [{ code: 'first-win', unlocked: true, at: 5 }]), JSON.stringify(r).slice(0, 200));
  t('readPublicProfile : réponse sans profil → NOT_FOUND ; raison inconnue jetée', GH.readPublicProfile({ playerId: 'x' }).reason === 'NOT_FOUND'
    && GH.readPublicProfile({ playerId: 'x', reason: 'PWNED', profile: { name: 'A' } }).reason === null);
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

// --- CDP (même plomberie que hub-achievements.mjs) -----------------------------------
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
    await sleep(120);
  };
  // Vraies frappes (rawKeyDown SANS text : voir CLAUDE.md, Edge headless).
  const touche = async (key, code, vk, shift = false) => {
    for (const type of ['rawKeyDown', 'keyUp']) await S('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: vk, modifiers: shift ? 8 : 0 });
    await sleep(150);
  };
  J.tab = () => touche('Tab', 'Tab', 9);
  // Entrée sur un <button> natif : keyDown AVEC le caractère (comme hub-stats.mjs) ;
  // un rawKeyDown sans texte n'active pas le bouton.
  J.enter = async () => {
    await S('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
    await S('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await sleep(150);
  };
  J.escape = () => touche('Escape', 'Escape', 27);
  J.type = async (sel, text) => { await J.click(sel); await J.eval(`document.querySelector(${JSON.stringify(sel)}).select()`); await S('Input.insertText', { text }); await sleep(60); };
  J.shot = async (nomFichier) => {
    if (!SHOTS) return;
    await sleep(200);
    const r = await S('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOTS, (REDUCED ? 'r-' : '') + nomFichier + '.png'), Buffer.from(r.result.data, 'base64'));
  };
  J.profil = () => J.eval(`JSON.parse(localStorage.getItem(${JSON.stringify(KEY)}))`);
  return J;
}

// ═══════════════════════════════════════════ la vraie page, le vrai Hub
const sante = await fakeHealth(HEALTH_PORT);
const MANIFEST = localManifest(ROOT, HEALTH_PORT);
lance(HUBDIR, 'src/server.js', HUB_PORT, { MANIFEST_FILE: MANIFEST, HUB_STATS: 'memory' });
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
  c.profil = async (playerId) => { const m = c.mark(); c.send({ action: 'public-profile', playerId }); return c.waitFor((x) => x.type === 'public-profile', 5000, m); };
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
  const results = [hote, ...autres].map((c) => ({ gamePlayerId: 'g-' + c.nom, rank: rangs[c.nom], points: 0 }));
  m = hote.mark(); hote.send({ action: 'results', drawId: d.id, gameId, results });
  await hote.until((s) => s.history.games.some((g) => g.drawId === d.id), 5000, m);
  m = hote.mark(); hote.send({ action: 'ended', drawId: d.id });
  await hote.until((s) => s.state === 'debrief', 5000, m);
  await sleep(150);
}

// Ce que le panneau montre : titres, identité, chiffres, par jeu, records, succès.
const PANNEAU = `(() => { const q = (s) => document.getElementById(s);
  const dlg = q('profile-dialog');
  return { ouvert: dlg.open, busy: q('profile-stats').hasAttribute('aria-busy'), titre: q('profile-title').textContent,
    titres: [q('profile-stats-title').textContent, q('profile-records-title').textContent, q('profile-ach-title').firstChild.textContent],
    nom: q('profile-name').textContent, kind: q('profile-kind').textContent, session: q('profile-session').textContent, where: q('profile-where').textContent,
    local: q('profile-local').hidden, note: q('profile-stats-note').hidden ? null : q('profile-stats-note').textContent,
    figs: q('profile-figures').hidden ? [] : [...document.querySelectorAll('#profile-figures .profile-figure')].map((f) => [f.querySelector('dt').textContent, f.querySelector('b').textContent]),
    jeux: q('profile-games').hidden ? [] : [...document.querySelectorAll('#profile-games .profile-game')].map((li) => li.querySelector('.profile-game-meta').textContent),
    recs: q('profile-records').hidden ? null : [...document.querySelectorAll('#profile-records-list .profile-record')].map((r) => [r.dataset.record, r.querySelector('b').textContent]),
    ach: q('profile-ach').hidden ? null : [...document.querySelectorAll('#profile-ach-list .profile-ach-item')].map((li) => [li.dataset.code, li.classList.contains('is-unlocked'),
      li.querySelector('.profile-ach-state').textContent]),
    achCount: q('profile-ach-count').textContent, live: q('profile-stats-live').textContent,
    texte: dlg.innerText, focus: document.activeElement && (document.activeElement.id || document.activeElement.dataset.player || document.activeElement.tagName) }; })()`;
const charge = (J) => J.until(`document.getElementById('profile-dialog').open && !document.getElementById('profile-stats').hasAttribute('aria-busy')
  && !!document.getElementById('profile-stats-live').textContent`, 8000, 'profil chargé');
const boutonDe = (id) => `#hub-players .hub-card-public[data-player="${id}"]`;
const demandes = (J) => J.envoyes.filter((m) => m.action === 'public-profile').map((m) => m.playerId);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hubpub-'));
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${dir}`, '--no-first-run',
  '--disable-features=BackForwardCache', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank'], { stdio: 'ignore' });
let cdp = null;
const clients = [];

try {
  cdp = await cdpBrowser();
  console.log(`\nProfils publics du Game Hub — vrais navigateurs, vrai Hub (${REDUCED ? 'mouvement RÉDUIT' : 'mouvement normal'})\n`);

  // Deux navigateurs : Ana (A) et Bob (B), leurs profils (id + clé).
  const A = await joueur(cdp, 'A'), B = await joueur(cdp, 'B');
  await A.goto(PAGE); await B.goto(PAGE);
  const pA = await A.profil(), pB = await B.profil();
  // Les parties : par le protocole, avec l'id ET la clé de chacun.
  const na = await entre('Ana', pA.id, null, pA.key);
  const code = na.last().code;
  const nb = await entre('Bob', pB.id, code, pB.key);
  const cam = await entre('Cam', 'p_pubcam', code, 'c'.repeat(40));
  const dan = await entre('Dan', 'p_pubdan', code);                       // ancien client : pas de clé
  clients.push(na, nb, cam, dan);
  await partie(na, [nb, cam, dan], 'passeur', { Ana: 1, Bob: 2, Cam: 3, Dan: 4 });
  await partie(na, [nb, cam, dan], 'ban', { Ana: 2, Bob: 1, Cam: 1, Dan: 4 });
  const eve = await entre('Eve', 'p_pubeve', code, 'e'.repeat(40));      // nouvelle, jamais jouée
  clients.push(eve);
  await na.fermer(); await nb.fermer();
  for (const [J, nom] of [[A, 'Ana'], [B, 'Bob']]) {
    await J.eval(`(() => { const p = JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})); p.name = ${JSON.stringify(nom)}; localStorage.setItem(${JSON.stringify(KEY)}, JSON.stringify(p));
      sessionStorage.setItem('mathys_hub_session', ${JSON.stringify(code)}); return true; })()`);
    await J.goto(PAGE);
    await J.until(`!document.getElementById('lobby').hidden && document.querySelectorAll('#hub-players .hub-card').length === 5`, 10000, nom + ' au salon');
  }

  // ═══ les boutons
  const cartes = await A.eval(`[...document.querySelectorAll('#hub-players .hub-card')].map((li) => ({ id: li.dataset.player, prive: !!li.querySelector('#hub-profile-btn'),
    public: li.querySelector('.hub-card-public') ? { texte: li.querySelector('.hub-card-public').textContent, aria: li.querySelector('.hub-card-public').getAttribute('aria-label') } : null }))`);
  const moi = cartes.find((c) => c.id === pA.id), bob = cartes.find((c) => c.id === pB.id);
  t('ta carte : « 👤 ton profil » seulement ; les 4 autres : « 👤 Profil »', moi.prive && !moi.public && cartes.filter((c) => c.public).length === 4
    && cartes.filter((c) => c.id !== pA.id).every((c) => !c.prive && c.public && c.public.texte === '👤 Profil'), JSON.stringify(cartes));
  t('le bouton dit qui il ouvre (aria-label « Voir le profil de Bob »)', bob.public.aria === 'Voir le profil de Bob', bob.public.aria);
  t('rien n\'est demandé au chargement du salon (pas de profil public préchargé, pas de polling)', demandes(A).length === 0);

  // ═══ le profil privé de Bob, chez Bob (référence)
  await B.click('#hub-profile-btn');
  await charge(B);
  const ref = await B.eval(PANNEAU);
  await B.escape();

  // ═══ le profil public de Bob, chez Ana
  await A.click(boutonDe(pB.id));
  await charge(A);
  const vb = await A.eval(PANNEAU);
  t('1/2. le panneau s\'ouvre : « Profil de Bob », identité Bob, jamais « Ton profil »', vb.ouvert && vb.titre === 'Profil de Bob' && vb.nom === 'Bob' && !/Ton profil|Tes statistiques|Tes records|Tes succès/.test(vb.texte),
    JSON.stringify({ titre: vb.titre, nom: vb.nom }));
  t('titres neutres : « 📊 Statistiques », « 🏆 Records », « 🎖️ Succès »', same(vb.titres, ['📊 Statistiques', '🏆 Records', '🎖️ Succès ']), JSON.stringify(vb.titres));
  t('3. statistiques = celles du profil privé de Bob (4 cases)', same(vb.figs, ref.figs) && vb.figs.length === 4, JSON.stringify(vb.figs));
  t('3. par jeu = idem', same(vb.jeux, ref.jeux) && vb.jeux.length === 2, JSON.stringify(vb.jeux));
  t('4. records = idem', same(vb.recs, ref.recs) && !!vb.recs && vb.recs.length >= 3, JSON.stringify(vb.recs));
  t('5. succès = idem (obtenus, verrouillés, dates), compteur identique', same(vb.ach, ref.ach) && vb.achCount === ref.achCount && vb.ach.length === 10, `${vb.achCount} / ${ref.achCount}`);
  t('« Nouveau » n\'apparaît jamais sur le profil d\'un autre (pas de drawId public)', !(await A.eval(`!!document.querySelector('#profile-ach-list .profile-ach-new')`)));
  t('textes : la soirée, et « ces chiffres viennent du Game Hub, jamais du navigateur de Bob » ; rien du profil local', /Joueur de cette soirée/.test(vb.session)
    && vb.where === 'Ces chiffres viennent du Game Hub, jamais du navigateur de Bob.' && vb.local === true);
  t('annonce : « Profil de Bob. 2 parties… »', /^Profil de Bob\. 2 parties/.test(vb.live), vb.live);
  t('focus initial : « Fermer »', vb.focus === 'profile-close', vb.focus);
  t('une seule demande, pour Bob, à l\'ouverture', same(demandes(A), [pB.id]));
  await A.shot('public-bob-1280');

  // ═══ clavier : Échap ferme, le focus revient au bouton de Bob
  await A.escape();
  t('14/15. Échap ferme, le focus revient au « 👤 Profil » de Bob', await A.eval(`!document.getElementById('profile-dialog').open && document.activeElement.dataset.player === ${JSON.stringify(pB.id)}`));
  // Le salon change (quelqu'un arrive) : le bouton garde le focus.
  const fil = await entre('Fil', 'p_pubfil', code, 'f'.repeat(40));
  clients.push(fil);
  await A.until(`document.querySelectorAll('#hub-players .hub-card').length === 6`, 5000, 'Fil arrive');
  t('le salon se redessine (Fil arrive) : le bouton de Bob GARDE le focus', await A.eval(`document.activeElement.dataset.player === ${JSON.stringify(pB.id)}`));
  // Tab réel jusqu'au bouton suivant, Entrée l'ouvre.
  await A.tab();
  const suivant = await A.eval(`document.activeElement.dataset.player || document.activeElement.id`);
  await A.enter();
  await charge(A);
  const vk = await A.eval(PANNEAU);
  t('13. Tab mène au « 👤 Profil » suivant, Entrée l\'ouvre (profil de ce joueur)', !!suivant && suivant !== pB.id && vk.ouvert && demandes(A).at(-1) === suivant, `${suivant} → ${vk.titre}`);
  await A.escape();
  t('… Échap, et le focus revient sur CE bouton', await A.eval(`document.activeElement.dataset.player === ${JSON.stringify(suivant)}`));

  // ═══ 6. joueur sans partie, joueur sans clé
  await A.click(boutonDe('p_pubeve'));
  await charge(A);
  const ve = await A.eval(PANNEAU);
  // (innerText rend les titres en MAJUSCULES CSS : coupure insensible à la casse)
  const sansSucces = ve.texte.replace(/🎖️ succès[\s\S]*/i, '');
  t('6. nouveau joueur : « Aucune partie enregistrée. », identité gardée, aucune case de chiffres, aucun zéro', ve.note === 'Aucune partie enregistrée.' && ve.nom === 'Eve'
    && !ve.figs.length && !/\b0\b/.test(sansSucces.replace(ve.live, '')) && ve.achCount === '· 0/10', JSON.stringify({ note: ve.note, achCount: ve.achCount }));
  await A.shot('public-nouveau-1280');
  await A.escape();
  await A.click(boutonDe('p_pubdan'));
  await charge(A);
  const vd = await A.eval(PANNEAU);
  t('joueur sans clé (ancien client) : « Pas de statistiques pour ce joueur… », identité, aucun chiffre', /^Pas de statistiques pour ce joueur/.test(vd.note || '') && vd.nom === 'Dan' && !vd.figs.length && vd.ach === null, vd.note);
  await A.escape();

  // ═══ 9. joueur qui part pendant que son profil est ouvert
  await A.click(boutonDe('p_pubcam'));
  await charge(A);
  const vc1 = await A.eval(PANNEAU);
  const avantDemandes = demandes(A).length;
  cam.send({ action: 'leave' });
  await A.until(`/parti de la soirée/.test(document.getElementById('profile-kind').textContent)`, 5000, 'Cam partie');
  const vc2 = await A.eval(PANNEAU);
  t('9. Cam part, panneau ouvert : « parti de la soirée », ses statistiques restent (rien redemandé)', /a quitté la soirée/.test(vc2.session) && same(vc2.figs, vc1.figs)
    && same(vc2.ach, vc1.ach) && demandes(A).length === avantDemandes, vc2.kind);
  await A.shot('public-parti-1280');
  await A.escape();
  t('… fermé : son bouton a disparu, le focus revient à « ton profil »', await A.eval(`!document.querySelector(${JSON.stringify(boutonDe('p_pubcam'))}) && document.activeElement.id === 'hub-profile-btn'`));

  // ═══ « Ton profil » après un profil public : de nouveau le tien
  await A.click('#hub-profile-btn');
  await charge(A);
  const va = await A.eval(PANNEAU);
  t('« Ton profil » après : titre, « 📊 Tes statistiques », TES chiffres (2 parties, 1 victoire)', va.titre === 'Ton profil' && va.titres[0] === '📊 Tes statistiques' && va.nom === 'Ana'
    && same(va.figs.slice(0, 2), [['parties', '2'], ['victoire', '1']]), JSON.stringify(va.figs));
  await A.escape();

  // ═══ responsive : 390 → 1280
  for (const [w, h] of [[390, 780], [768, 1024], [1100, 900], [1280, 900]]) {
    await A.size(w, h); await sleep(250);
    const carte = await A.eval(`(() => { const b = document.querySelector(${JSON.stringify(boutonDe(pB.id))}); b.scrollIntoView({ block: 'center', behavior: 'instant' });
      const r = b.getBoundingClientRect(), c = b.closest('.hub-card').getBoundingClientRect();
      return { dans: r.left >= c.left - .5 && r.right <= c.right + .5 && r.width > 40 && r.height > 20, sx: document.documentElement.scrollWidth - innerWidth }; })()`);
    if (w === 390) await A.shot('salon-390');
    await A.click(boutonDe(pB.id));
    await charge(A);
    const g = await A.eval(`(() => { const d = document.getElementById('profile-dialog').getBoundingClientRect(); const f = document.getElementById('profile-close').getBoundingClientRect();
      const coupe = [...document.querySelectorAll('#profile-dialog .profile-figure b, #profile-dialog .profile-figure dt, #profile-dialog .profile-game-meta, #profile-dialog .profile-ach-name, #profile-dialog .profile-ach-desc')]
        .filter((e) => e.scrollWidth > e.clientWidth + 1).length;
      return { dlg: d.left >= 0 && d.right <= innerWidth + .5 && d.bottom <= innerHeight + .5, fermer: f.bottom <= innerHeight + .5 && f.top >= 0, coupe,
        succesCols: getComputedStyle(document.getElementById('profile-ach-list')).gridTemplateColumns.split(' ').length, largeur: Math.round(d.width) }; })()`);
    t(`${w} px : bouton dans la carte, panneau dans l'écran (même mise en page que « Ton profil »), « Fermer » visible, rien de coupé`,
      carte.dans && carte.sx <= 0 && g.dlg && g.fermer && !g.coupe && g.succesCols === (w >= 720 ? 2 : 1), JSON.stringify({ carte, g }));
    if (w === 390) { await A.shot('public-bob-390'); }
    await A.escape();
  }
  await A.size(1280, 900);

  // ═══ 7. deux joueurs seulement (nouvelle soirée)
  await B.eval(`document.getElementById('hub-leave').click(); true`);
  await A.eval(`document.getElementById('hub-leave').click(); true`);
  await A.click('#hub-create');
  await A.until(`!document.getElementById('lobby').hidden`, 10000, 'nouvelle soirée');
  const code2 = await A.eval(`document.getElementById('hub-code').textContent`);
  await B.eval(`sessionStorage.setItem('mathys_hub_session', ${JSON.stringify(code2)}); true`);
  await B.goto(PAGE);
  await A.until(`document.querySelectorAll('#hub-players .hub-card').length === 2 && !!document.querySelector(${JSON.stringify(boutonDe(pB.id))})`, 10000, 'Bob dans la soirée à deux');
  await A.click(boutonDe(pB.id));
  await charge(A);
  const v2 = await A.eval(PANNEAU);
  t('7. soirée à deux : le profil de Bob s\'ouvre, mêmes chiffres', v2.titre === 'Profil de Bob' && same(v2.figs, ref.figs));
  await A.escape();

  // ═══ 10–12. refus (protocole) : externe, forgé, autre soirée
  const ext = await entre('Ext', 'p_pubext', null, 'x'.repeat(40));     // une AUTRE soirée
  clients.push(ext);
  const r1 = await ext.profil(pB.id), r2 = await ext.profil(pA.id);
  const intrus = await entre('Intrus', 'p_pubint', code2, 'i'.repeat(40));
  clients.push(intrus);
  const r3 = await intrus.profil('p_pubcam'), r4 = await intrus.profil('p_' + 'z'.repeat(12)), r5 = await intrus.profil(pB.id);
  t('10/12. un joueur d\'une AUTRE soirée ne voit ni Bob ni Ana : NOT_FOUND', r1.reason === 'NOT_FOUND' && r2.reason === 'NOT_FOUND' && !r1.profile && !r2.profile);
  t('11. id forgé ou d\'une soirée précédente (Cam) : NOT_FOUND', r3.reason === 'NOT_FOUND' && r4.reason === 'NOT_FOUND');
  t('… le même joueur, entré dans la soirée de Bob : autorisé', r5.reason === null && r5.profile.name === 'Bob');

  // ═══ aucune fuite
  const chezA = JSON.stringify(A.recus);
  t('F/G. aucune clé ni empreinte de Bob chez Ana, aucun drawId dans les profils publics', !chezA.includes(pB.key)
    && A.recus.filter((m) => m.type === 'public-profile').every((m) => !/drawId|"key"|keyHash|notified/.test(JSON.stringify(m))));
  t('Ana ne reçoit jamais le message `stats` de quelqu\'un d\'autre (seulement les siens)', A.recus.filter((m) => m.type === 'stats').every((m) => !m.stats || m.stats.played === 2));

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
