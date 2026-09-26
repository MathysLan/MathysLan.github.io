// Score de soirée — Précision, de bout en bout, dans de VRAIS navigateurs.
//
//   node tests/hub-score-precision.mjs              Hub + precision-server lancés en local
//   node tests/hub-score-precision.mjs --reduced    même parcours en mouvement réduit
//   node tests/hub-score-precision.mjs --shots <d>  captures du salon du Hub à la fin
//   node tests/hub-score-precision.mjs --prod       PRODUCTION : site GitHub Pages, vrai Hub
//                                                   et vrai precision-server (Render)
//
// Deux scénarios dans le même navigateur.
//
// TRIO (trois contextes isolés) : /games/ → A crée, B et C rejoignent → seul
// Précision possible → tirage → lancement → A crée la room, B et C la
// rejoignent (chacun déclare SA place = son id Précision) → B perd sa
// connexion au salon et revient (nouvel id : la place doit suivre) → trois
// manches de FRAPPE en difficulté Impossible, au vrai clavier : A et B tapent
// dix mots justes (au-delà des 65 mots/min du barème : 100 par manche), C ne
// tape rien (0) → un EX ÆQUO réel 300 / 300 / 0 → podium → l'hôte rapporte le
// classement AVANT ended, les invités jamais → le Hub convertit (30 / 30 / 10)
// → retour au Hub, le bloc l'affiche.
//
// SOLO (un quatrième contexte) : Précision se joue seul (MIN_PLAYERS = 1). Une
// session d'un joueur → seul Précision → partie → podium d'une ligne → rang 1
// → 10 points de soirée.
//
// Pourquoi la frappe : c'est la seule épreuve dont on peut forcer le score
// exact sans viser au pixel ni au centième (le barème plafonne à 100 %).
//
// ⚠️ LA VÉRITÉ EST DANS LES TRAMES : le podium vient de la trame `phase: end`
// de precision-server, le score de la trame `session` du Hub.
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
const PROD = process.argv.includes('--prod');
const SHOTS = arg('--shots');
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const R = () => Math.floor(Math.random() * 300);
const HTTP_PORT = 8700 + R(), CDP_PORT = 9700 + R(), HUB_PORT = 8100 + R(), PREC_PORT = 8900 + R(), HEALTH_PORT = 6400 + R();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let out = [], ko = 0;
const t = (nom, ok, detail = '') => {
  out.push(`${ok ? 'OK  ' : 'KO  '} ${nom}${detail ? ' — ' + detail : ''}`);
  if (!ok) ko++;
  console.log(out[out.length - 1]);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// --- serveurs (local) -------------------------------------------------------------
const HUB = `ws://127.0.0.1:${HUB_PORT}`, PREC = `ws://127.0.0.1:${PREC_PORT}`;
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
    if (p0 === '/games/precision/' && !/(^|&)server=/.test(q || '')) { res.writeHead(302, { Location: `/games/precision/?server=${encodeURIComponent(PREC)}` }); return res.end(); }
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
  J.key = async (key, code, vk) => { await S('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: vk }); await S('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk }); };
  J.insere = (text) => S('Input.insertText', { text });
  J.type = async (sel, text) => { await J.click(sel); await J.eval(`document.querySelector(${JSON.stringify(sel)}).select()`); await S('Input.insertText', { text }); await sleep(60); };
  J.shot = async (nomFichier, sel = '#lobby') => {
    if (!SHOTS) return;
    const r0 = await J.eval(`(() => { window.scrollTo(0, 0); const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();
      return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: Math.min(r.height, 900) }; })()`);
    const r = await S('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { ...r0, scale: 1 } });
    fs.writeFileSync(path.join(SHOTS, (PROD ? 'prod-' : '') + nomFichier + '.png'), Buffer.from(r.result.data, 'base64'));
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

// La conversion du Hub, recalculée À PARTIR DU PODIUM du jeu.
const rangDe = (list, p) => 1 + list.filter((x) => x.score > p.score).length;
const attendu = (podium) => Object.fromEntries(podium.map((p) => [p.name, 10 * (podium.length - rangDe(podium, p) + 1)]));

// --- orchestration ----------------------------------------------------------------
let sante = null, MANIFEST = null, srv = null;
if (!PROD) {
  sante = await fakeHealth(HEALTH_PORT);
  MANIFEST = localManifest(ROOT, HEALTH_PORT, { precision: `http://127.0.0.1:${PREC_PORT}/` });
  lance(path.join(ROOT, '..', 'precision-server'), 'src/server.js', PREC_PORT, { PRESENCE_QUIET: '1' });
  lance(path.join(ROOT, '..', 'game-hub-server'), 'src/server.js', HUB_PORT, { MANIFEST_FILE: MANIFEST });
  srv = await serve();
  await attends(`http://127.0.0.1:${PREC_PORT}/`);
  await attends(`http://127.0.0.1:${HUB_PORT}/health`);
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hubscoreprec-'));
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${dir}`, '--no-first-run',
  '--autoplay-policy=no-user-gesture-required', '--disable-features=BackForwardCache', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank'], { stdio: 'ignore' });
let cdp = null;
const stop = () => {
  try { execFileSync('taskkill', ['/PID', String(edge.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (_) { try { edge.kill(); } catch (__) {} }
  procs.forEach((p) => { try { p.kill(); } catch (_) {} });
  try { cdp && cdp.close(); } catch (_) {}
  try { srv && srv.close(); } catch (_) {}
  if (sante) sante.close();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  try { MANIFEST && fs.unlinkSync(MANIFEST); } catch (_) {}
};

const BASE = PROD ? 'https://mathyslan.github.io' : `http://127.0.0.1:${HTTP_PORT}`;
const PAGE = PROD ? `${BASE}/games/` : `${BASE}/games/?hub=${encodeURIComponent(HUB)}`;
const LENT = PROD ? 3 : 1;                       // Render peut dormir
console.log(`Score de soirée — Précision, trio puis solo (${PROD ? 'PRODUCTION' : 'local'}${REDUCED ? ', mouvement réduit' : ''})\n`);
const surPrec = `location.pathname.endsWith('/games/precision/') && document.readyState === 'complete'`;
const auSalon = `location.pathname.endsWith('/games/') && !document.getElementById('lobby').hidden`;

// Une partie de FRAPPE (Impossible), manche par manche. `tapeurs` tapent dix
// mots justes puis valident ; les autres ne touchent à rien (validation auto
// du front en fin de phase, 0 mot). Le MJ enchaîne depuis le bouton rond.
async function partie(mj, tous, tapeurs) {
  for (let manche = 1; manche <= 3; manche++) {
    const pl = await mj.attends((d, g) => g === 'jeu' && d.type === 'phase' && d.phase === 'play' && d.round === manche, 15000 * LENT, 'jeu ' + manche);
    for (const J of tapeurs) {
      await J.until(`phase === 'play' && !document.getElementById('typing-input').disabled && document.activeElement === document.getElementById('typing-input')`, 5000, `clavier ${J.nom}`);
      for (const mot of pl.words.slice(0, 10)) { await J.insere(mot); await J.key('Enter', 'Enter', 13); }
      await J.until(`/^10 mots/.test(document.getElementById('typing-count').textContent)`, 3000, `10 mots ${J.nom}`);
      await J.click('#fab');                                         // valider
    }
    const rv = await mj.attends((d, g) => g === 'jeu' && d.type === 'phase' && d.phase === 'reveal' && d.round === manche, 15000 * LENT, 'révélation ' + manche);
    tous.forEach((J) => { J.pts = (J.pts || []).concat([(rv.results.find((r) => r.name === J.nomJeu) || {}).points]); });
    await mj.until(`phase === 'reveal' && document.getElementById('fab').dataset.mode === 'next' && !document.getElementById('fab').hidden`, 8000, 'bouton du MJ');
    await mj.click('#fab');                                          // → manche suivante / fin
  }
}
const regler = (J) => J.eval(`document.getElementById('rounds-select').value = '3'; document.getElementById('diff-select').value = 'impossible';
  document.getElementById('game-select').value = 'typing'; true`);

try {
  cdp = await cdpBrowser();
  const A = await joueur(cdp, 'A'), B = await joueur(cdp, 'B'), C = await joueur(cdp, 'C');
  const tous = [A, B, C];
  const noms = { A: 'Pr-Alice', B: 'Pr-Bruno', C: 'Pr-Chloé' };
  for (const J of tous) J.nomJeu = noms[J.nom];

  // ═══ 1. session à trois, seul Précision possible
  await A.goto(PAGE);
  await A.type('#name-input', noms.A); await A.click('#identity-done');
  await A.click('#hub-create');
  await A.until(`!document.getElementById('lobby').hidden`, 20000 * LENT, 'salon de A');
  const code = await A.eval(`document.getElementById('hub-code').textContent.trim()`);
  for (const J of [B, C]) {
    await J.goto(PAGE);
    await J.type('#name-input', noms[J.nom]); await J.click('#identity-done');
    await J.type('#hub-code-input', code); await J.click('#hub-join');
  }
  for (const J of tous) await J.until(`document.querySelectorAll('#hub-players .hub-card').length === 3 && document.querySelectorAll('#hub-games .hub-game').length >= 8`, 20000 * LENT, `${J.nom} au salon`);
  for (const g of ['passeur', 'imitation', 'ban', 'demicercle', 'quiment']) await B.click(`#hub-games [data-pref=veto][data-game=${g}]`);
  await A.until(`[...document.querySelectorAll('#hub-games .hub-game[data-eligible=true]')].map((x) => x.dataset.game).join() === 'precision'`, 8000, 'seul Précision');
  const avant = Object.assign({}, A.hub().scores);
  t('session à trois, seul Précision possible', true, code);

  // ═══ 2. lancement : chacun déclare SA place
  await A.click('#hub-draw-btn');
  await A.until(`document.getElementById('hub-result').dataset.game === 'precision' && !document.getElementById('hub-continue').hidden`, 20000, 'révélation');
  await A.click('#hub-continue');
  await A.until(`!document.getElementById('launch-go').hidden`, 8000, 'Ouvrir');
  await A.click('#launch-go');
  await A.until(surPrec, 20000, 'A sur Précision');
  await A.until(`!document.getElementById('lobby').hidden && document.getElementById('room-code').textContent.trim().length === 4`, 60000 * LENT, 'room créée');
  for (const J of [B, C]) {
    await J.until(`!document.getElementById('launch-go').hidden && /Rejoindre/.test(document.getElementById('launch-go').textContent)`, 15000, `Rejoindre chez ${J.nom}`);
    await J.immobile('#launch-go');
    await J.click('#launch-go');
    await J.until(surPrec, 20000, `${J.nom} sur Précision`);
    await J.until(`!document.getElementById('lobby').hidden && document.getElementById('room-code').textContent.trim().length === 4`, 20000, `${J.nom} dans la room`);
  }
  const declares = (J) => J.envoyes.filter((f) => f.g === 'hub' && (f.d.action === 'launched' || f.d.action === 'entered'));
  const places = await Promise.all(tous.map(async (J) => {
    const you = await J.eval('you');
    const d = declares(J);
    return { you, decl: d.map((f) => f.d.gamePlayerId), ok: d.length === 1 && d[0].d.gamePlayerId === you };
  }));
  t('chacun déclare au Hub SA place (id Précision = son `you`), une seule fois', places.every((p) => p.ok), JSON.stringify(places));
  const idsHub = await Promise.all(tous.map((J) => J.eval('GameProfile.load().id')));
  t('… et jamais l\'id du Hub à la place', places.every((p, i) => p.you !== idsHub[i]));

  // ═══ 3. B perd sa connexion au salon et revient : nouvel id, la place suit
  const youB1 = places[1].you;
  await B.eval(`NET.ws.close(); true`);
  await B.until(`!!you && you !== ${JSON.stringify(youB1)} && !document.getElementById('lobby').hidden`, 15000, 'retour de B au salon');
  const youB2 = await B.eval('you');
  await A.until(`document.querySelectorAll('#players .g-player').length === 3`, 10000, '3 joueurs chez A');
  // Les `room` qui suivent (arrivée de B chez tous, etc.) n'ajoutent aucune annonce.
  await sleep(400);
  const declB = declares(B).map((f) => f.d.gamePlayerId);
  t('reconnexion au salon : nouvel id Précision, la place est ré-annoncée (et elle seule)', declB.length === 2 && declB[0] === youB1 && declB[1] === youB2 && youB2 !== youB1, JSON.stringify(declB));
  t('… les autres n\'ont rien ré-annoncé pendant ce temps', [A, C].every((J) => declares(J).length === 1));
  const hubB = B.envoyes.filter((f) => f.g === 'hub' && f.d.action === 'entered').pop();
  t('la nouvelle place Y part bien vers le Hub (`entered`, gamePlayerId = Y)', !!hubB && hubB.d.gamePlayerId === youB2);

  // ═══ 4. une partie : trois manches de frappe, au vrai clavier
  await A.until(`!document.getElementById('start').disabled`, 15000 * LENT, '« Lancer » débloqué');
  await regler(A);
  await A.click('#start');
  await partie(A, tous, [A, B]);
  const fin = await A.attends((d, g) => g === 'jeu' && d.type === 'phase' && d.phase === 'end', 15000 * LENT, 'podium');
  const podium = fin.podium;
  t('podium du serveur : A = 300, B = 300, C = 0 (ex æquo réel)', same(podium.map((p) => [p.name, p.score]).sort(), [[noms.A, 300], [noms.B, 300], [noms.C, 0]].sort()),
    podium.map((p) => `${p.name} ${p.score}`).join(', ') + ' | manches ' + JSON.stringify(tous.map((J) => J.pts)));

  // ═══ 5. ce qui part vers le Hub
  await sleep(500);
  const ordre = A.envoyes.filter((f) => f.g === 'hub' && (f.d.action === 'results' || f.d.action === 'ended')).map((f) => f.d.action);
  const envoi = A.envoyes.find((f) => f.g === 'hub' && f.d.action === 'results');
  t('l\'hôte envoie `results` PUIS `ended`, une seule fois', same(ordre, ['results', 'ended']), ordre.join(' → '));
  t('le classement envoyé = le podium du serveur (ids, points), rien d\'autre', !!envoi && envoi.d.gameId === 'precision'
    && same(envoi.d.results.map((r) => [r.gamePlayerId, r.points]).sort(), podium.map((p) => [p.id, p.score]).sort()));
  t('B y figure sous sa NOUVELLE place', !!envoi && envoi.d.results.some((r) => r.gamePlayerId === youB2) && !envoi.d.results.some((r) => r.gamePlayerId === youB1));
  t('rangs de compétition : 300, 300, 0 → 1, 1, 3', !!envoi && same(envoi.d.results.map((r) => r.rank).sort(), [1, 1, 3]),
    envoi && JSON.stringify(envoi.d.results.map((r) => [r.points, r.rank])));
  t('les invités n\'envoient AUCUN classement', [B, C].every((J) => !J.envoyes.some((f) => f.d.action === 'results')));
  const R3 = (a) => B.eval(`rangs(${JSON.stringify(a.map((score, i) => ({ id: 'q' + i, score })))}).map((r) => r.rank)`);
  const hs = [[[100, 80, 50], [1, 2, 3]], [[100, 100, 50], [1, 1, 3]], [[50, 20, 50], [1, 3, 1]], [[42], [1]]];
  const vus = [];
  for (const [sc, attendu] of hs) vus.push([sc, await R3(sc), attendu]);
  t('helper de rangs : 100/80/50 → 1/2/3, 100/100/50 → 1/1/3, 50/20/50 → 1/3/1 (non trié), solo → 1', vus.every(([, v, a]) => same(v, a)), JSON.stringify(vus.map(([sc, v]) => [sc, v])));
  const h1 = await B.eval(`rangs([{ id: 'x', score: 50 }, { id: 'y', score: 20 }, { id: 'z', score: 50 }])`);
  t('… l\'ordre des lignes est conservé, seuls les rangs dépendent du score', same(h1, [{ gamePlayerId: 'x', rank: 1, points: 50 }, { gamePlayerId: 'y', rank: 3, points: 20 }, { gamePlayerId: 'z', rank: 1, points: 50 }]), JSON.stringify(h1));

  // ═══ 6. le Hub compte, le bloc affiche
  const deb = await B.attends((d) => d.session && d.session.state === 'debrief' && d.session.history.games.some((g) => g.gameId === 'precision'), 15000, 'debrief compté');
  const nomDe = (pid) => deb.session.players.find((p) => p.id === pid).name;
  const gain = Object.fromEntries(Object.entries(deb.session.scores).map(([pid, v]) => [nomDe(pid), v - (avant[pid] || 0)]));
  const partieH = deb.session.history.games.filter((g) => g.gameId === 'precision').pop();
  const ligneB = partieH && partieH.results.find((r) => r.playerId === idsHub[1]);
  t('B marque via sa NOUVELLE place (rang 1, 300 points de jeu)', !!ligneB && ligneB.rank === 1 && ligneB.gamePoints === 300, JSON.stringify(ligneB));
  t('la session revient en debrief', deb.session.state === 'debrief');
  t('le Hub a converti le podium : 30 / 30 / 10', same(Object.entries(gain).sort(), Object.entries(attendu(podium)).sort()), JSON.stringify(gain));
  for (const J of tous) {
    await J.until(`!document.getElementById('to-hub').hidden`, 10000, `fin chez ${J.nom}`);
    await J.click('#to-hub');
    await J.until(`${auSalon} && document.querySelectorAll('#hub-score-list li').length === 3`, 20000 * LENT, `retour Hub ${J.nom}`);
  }
  for (const J of tous) {
    const b = await J.eval(`[...document.querySelectorAll('#hub-score-list .hub-score-row')].map((li) => ({ id: li.dataset.player, pts: +li.dataset.points,
      rang: li.querySelector('.hub-score-rank').textContent, me: li.classList.contains('is-me'), txt: li.querySelector('.hub-score-pts').textContent }))`);
    const s = J.hub().scores;
    const ok = b.every((l) => l.pts === (s[l.id] || 0)) && b.filter((l) => l.rang === '🥇').length === 2 && b.find((l) => l.me).id === idsHub[tous.indexOf(J)];
    t(`${J.nom} : le bloc affiche les points du Hub, deux 🥇 (ex æquo), sa ligne en évidence`, ok, JSON.stringify(b.map((l) => `${l.rang} ${l.txt}`)));
  }
  const b0 = await C.eval(`[...document.querySelectorAll('#hub-score-list .hub-score-row')].map((li) => (li.querySelector('.hub-score-delta') || {}).textContent || '')`);
  t('gain de la dernière partie affiché (+30 / +30 / +10)', same([...b0].sort(), ['+10', '+30', '+30']), JSON.stringify(b0));
  t('note : « dernière : Précision »', /dernière : .*Précision/i.test(await C.eval(`document.getElementById('hub-score-note').textContent`)),
    await C.eval(`document.getElementById('hub-score-note').textContent`));
  await C.shot('precision-score');

  // ═══ 7. SOLO : un joueur, une session, une partie
  const D = await joueur(cdp, 'D');
  D.nomJeu = 'Pr-Solo';
  await D.goto(PAGE);
  await D.type('#name-input', D.nomJeu); await D.click('#identity-done');
  await D.click('#hub-create');
  await D.until(`!document.getElementById('lobby').hidden && document.querySelectorAll('#hub-games .hub-game').length >= 8`, 20000 * LENT, 'salon solo');
  // Seul, d'autres jeux restent possibles (Le Passeur, Puissance 4…) : veto sur tout sauf Précision.
  const autres = await D.eval(`[...document.querySelectorAll('#hub-games .hub-game[data-eligible=true]')].map((x) => x.dataset.game).filter((g) => g !== 'precision')`);
  for (const g of autres) await D.click(`#hub-games [data-pref=veto][data-game=${g}]`);
  await D.until(`[...document.querySelectorAll('#hub-games .hub-game[data-eligible=true]')].map((x) => x.dataset.game).join() === 'precision'`, 8000, 'solo : seul Précision');
  t('solo : une session à un joueur, seul Précision possible', true, 'veto sur ' + autres.join(', '));
  await D.click('#hub-draw-btn');
  await D.until(`document.getElementById('hub-result').dataset.game === 'precision' && !document.getElementById('hub-continue').hidden`, 20000, 'révélation solo');
  await D.click('#hub-continue');
  await D.until(`!document.getElementById('launch-go').hidden`, 8000, 'Ouvrir (solo)');
  await D.click('#launch-go');
  await D.until(surPrec, 20000, 'D sur Précision');
  await D.until(`!document.getElementById('lobby').hidden && document.getElementById('room-code').textContent.trim().length === 4 && !document.getElementById('start').disabled`, 60000 * LENT, 'room solo');
  const dYou = await D.eval('you');
  t('solo : D déclare SA place', D.envoyes.some((f) => f.g === 'hub' && f.d.action === 'launched' && f.d.gamePlayerId === dYou));
  await regler(D);
  await D.click('#start');
  await partie(D, [D], [D]);
  const finD = await D.attends((d, g) => g === 'jeu' && d.type === 'phase' && d.phase === 'end', 15000 * LENT, 'podium solo');
  await sleep(500);
  const envD = D.envoyes.find((f) => f.g === 'hub' && f.d.action === 'results');
  const ordreD = D.envoyes.filter((f) => f.g === 'hub' && (f.d.action === 'results' || f.d.action === 'ended')).map((f) => f.d.action);
  t('solo : podium d\'une ligne, classement envoyé = [{ sa place, rang 1, son score }], puis ended',
    finD.podium.length === 1 && !!envD && same(envD.d.results, [{ gamePlayerId: dYou, rank: 1, points: finD.podium[0].score }]) && same(ordreD, ['results', 'ended']),
    JSON.stringify(envD && envD.d.results));
  const debD = await D.attends((d) => d.session && d.session.state === 'debrief' && d.session.history.games.some((g) => g.gameId === 'precision'), 15000, 'debrief solo');
  const idD = await D.eval('GameProfile.load().id');
  t('solo : le Hub donne 10 points de soirée', debD.session.scores[idD] === 10, JSON.stringify(debD.session.scores));
  await D.until(`!document.getElementById('to-hub').hidden`, 10000, 'fin solo');
  t('solo : « Retour au Game Hub » proposé', true);
  // ⚠️ PAS de retour au Hub ici : c'est un défaut CONNU de game-hub-server, hors
  // de ce raccord. Au debrief d'un lancement, une session sans personne de
  // connecté est fermée tout de suite (onClose) ; seul, le joueur quitte la page
  // du jeu avant que /games/ ne se reconnecte → « Ta session précédente n'existe
  // plus ». Voir CLAUDE.md, « Score de soirée ». Quand le Hub sera corrigé :
  // cliquer #to-hub et vérifier « 🥇 +10 » dans #hub-score-list.
  tous.push(D);

  const errs = tous.flatMap((J) => J.erreurs.map((e) => `[${J.nom}] ${e}`));
  t('aucune erreur JS dans les trois navigateurs', errs.length === 0, errs.slice(0, 3).join(' | '));
} catch (e) {
  t('EXCEPTION', false, e.message);
} finally {
  stop();
}
console.log(`\n${ko ? 'DES TESTS ÉCHOUENT' : 'TOUT PASSE'} — ${out.length} vérifications, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
