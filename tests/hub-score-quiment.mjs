// Score de soirée — Qui Ment ?, de bout en bout, dans de VRAIS navigateurs.
//
//   node tests/hub-score-quiment.mjs              Hub + qui-ment-server lancés en local
//   node tests/hub-score-quiment.mjs --reduced    même parcours en mouvement réduit
//   node tests/hub-score-quiment.mjs --shots <d>  captures du salon du Hub à la fin
//   node tests/hub-score-quiment.mjs --prod       PRODUCTION : site GitHub Pages, vrai Hub
//                                                 et vrai qui-ment-server (Render)
//
// Trois contextes isolés. Le parcours : /games/ → A crée, B et C rejoignent →
// seul Qui Ment ? possible → tirage → lancement → A crée la room, B et C la
// rejoignent (chacun déclare SA place = l'id de son message `you`) → B perd sa
// connexion au salon et revient (nouvel id : la place doit suivre) → trois
// manches jouées pour de vrai (indices tapés, votes cliqués, dernière chance
// de l'intrus) → classement → l'hôte rapporte le classement AVANT ended, les
// invités jamais → le Hub convertit → « Rejouer » : une revanche complète dans
// la même room, qui ne recompte RIEN → vrai retour au Hub (#to-hub) : même
// session, score, historique, debrief → un nouveau tirage a un nouveau drawId.
//
// ⚠️ L'EX ÆQUO EST CONSTRUIT, PAS ESPÉRÉ. L'intrus est tiré au hasard par le
// serveur à chaque manche ; on ne le force pas. Mais chaque joueur sait s'il
// l'est (son `role` arrive sans mot), et le barème laisse cinq issues par
// manche selon qui vote pour qui et ce que l'intrus devine :
//   intrus démasqué, se trompe de mot  → intrus 0, informés 2 / 2
//   intrus démasqué, retrouve le mot   → intrus 4, informés 2 / 2
//   un seul informé vote pour lui      → intrus 4, informés 2 / 0 (égalité des voix : il s'échappe)
//   aucun                              → intrus 4, informés 0 / 0
// Une recherche exhaustive (plus bas, `gagnable`) montre qu'en trois manches on
// peut TOUJOURS finir avec deux joueurs à égalité en tête et le troisième
// derrière (rangs 1 / 1 / 3), quels que soient les trois intrus tirés. Le test
// choisit donc, manche par manche, l'issue qui garde ce but atteignable.
// Quelle paire finit en tête dépend du tirage ; les rangs, non.
//
// ⚠️ LA VÉRITÉ EST DANS LES TRAMES : le rôle vient de la trame `role`, le
// classement de la trame `end` de qui-ment-server, le score de la trame
// `session` du Hub.
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { fakeHealth, localManifest } from './hub-fixture.mjs';
import { finHub } from './hub-end.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const EDGE = arg('--edge') || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const REDUCED = process.argv.includes('--reduced');
const PROD = process.argv.includes('--prod');
const SHOTS = arg('--shots');
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const R = () => Math.floor(Math.random() * 300);
const HTTP_PORT = 8700 + R(), CDP_PORT = 9700 + R(), HUB_PORT = 8100 + R(), QM_PORT = 8900 + R(), HEALTH_PORT = 6400 + R();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let out = [], ko = 0;
const t = (nom, ok, detail = '') => {
  out.push(`${ok ? 'OK  ' : 'KO  '} ${nom}${detail ? ' — ' + detail : ''}`);
  if (!ok) ko++;
  console.log(out[out.length - 1]);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// --- serveurs (local) -------------------------------------------------------------
const HUB = `ws://127.0.0.1:${HUB_PORT}`, QM = `ws://127.0.0.1:${QM_PORT}`;
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
    if (p0 === '/games/quiment/' && !/(^|&)server=/.test(q || '')) { res.writeHead(302, { Location: `/games/quiment/?server=${encodeURIComponent(QM)}` }); return res.end(); }
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

// La conversion du Hub, recalculée À PARTIR DU CLASSEMENT du jeu.
const rangDe = (list, p) => 1 + list.filter((x) => x.score > p.score).length;
const attendu = (podium) => Object.fromEntries(podium.map((p) => [p.name, 10 * (podium.length - rangDe(podium, p) + 1)]));

// --- orchestration ----------------------------------------------------------------
let sante = null, MANIFEST = null, srv = null;
if (!PROD) {
  sante = await fakeHealth(HEALTH_PORT);
  MANIFEST = localManifest(ROOT, HEALTH_PORT, { quiment: `http://127.0.0.1:${QM_PORT}/` });
  lance(path.join(ROOT, '..', 'qui-ment-server'), 'server.js', QM_PORT, { PRESENCE_QUIET: '1' });
  lance(path.join(ROOT, '..', 'game-hub-server'), 'src/server.js', HUB_PORT, { MANIFEST_FILE: MANIFEST });
  srv = await serve();
  await attends(`http://127.0.0.1:${QM_PORT}/`);
  await attends(`http://127.0.0.1:${HUB_PORT}/health`);
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hubscoreqm-'));
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${dir}`, '--no-first-run',
  '--disable-features=BackForwardCache', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank'], { stdio: 'ignore' });
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
console.log(`Score de soirée — Qui Ment ?, trois navigateurs (${PROD ? 'PRODUCTION' : 'local'}${REDUCED ? ', mouvement réduit' : ''})\n`);
const surQM = `location.pathname.endsWith('/games/quiment/') && document.readyState === 'complete'`;
const auSalon = `location.pathname.endsWith('/games/') && !document.getElementById('lobby').hidden`;

const vu = (id) => `(() => { const e = document.getElementById(${JSON.stringify(id)}); return !!e && !e.hidden && !!e.offsetParent; })()`;

// ── la stratégie d'ex æquo ─────────────────────────────────────────────────
// Issues d'une manche, en points [intrus, informé 1, informé 2] (barème du
// moteur : bon vote 2, intrus non démasqué 4, intrus démasqué qui retrouve 4).
const ISSUES = [[0, 2, 2], [4, 2, 2], [4, 2, 0], [4, 0, 2], [4, 0, 0]];
const deltas = (imp) => ISSUES.map((pts) => {
  const d = [0, 0, 0], o = [0, 1, 2].filter((i) => i !== imp);
  d[imp] = pts[0]; d[o[0]] = pts[1]; d[o[1]] = pts[2];
  return { pts, d };
});
const exAequo = (s) => { const t = [...s].sort((a, b) => b - a); return t[0] === t[1] && t[2] < t[1]; };
const memo = new Map();
// Vrai si, depuis les scores `s`, il reste une façon d'arriver à 1 / 1 / 3 en
// `n` manches QUEL QUE SOIT l'intrus tiré à chacune.
function gagnable(s, n) {
  const k = s.join() + '|' + n;
  if (!memo.has(k)) memo.set(k, n === 0 ? exAequo(s)
    : [0, 1, 2].every((imp) => deltas(imp).some(({ d }) => gagnable(s.map((x, i) => x + d[i]), n - 1))));
  return memo.get(k);
}

// Une manche jouée pour de vrai, à l'issue choisie. `J3` = les trois joueurs
// dans l'ordre des scores `s` ; chacun connaît son id Qui Ment ? (J.qid).
async function manche(J3, mj, n, s, reste) {
  const roles = await Promise.all(J3.map((J) => J.attends((d, g) => g === 'jeu' && d.type === 'role' && d.round === n, 15000 * LENT, 'rôle ' + n)));
  const imp = roles.findIndex((r) => r.impostor);
  const mot = roles.find((r) => !r.impostor).word;
  const choix = deltas(imp).find(({ d }) => gagnable(s.map((x, i) => x + d[i]), reste));
  const [px, py, pz] = choix.pts;
  const [X, Y, Z] = [imp, ...[0, 1, 2].filter((i) => i !== imp)].map((i) => J3[i]);
  // qui vote pour qui, pour obtenir exactement cette issue
  const cible = py === 2 && pz === 2 ? [[Y, X], [Z, X], [X, Y]]
    : py === 2 ? [[Y, X], [Z, Y], [X, Y]]
      : pz === 2 ? [[Y, Z], [Z, X], [X, Z]]
        : [[Y, Z], [Z, Y], [X, Y]];

  for (let tour = 1; tour <= 2; tour++) {
    for (const [i, J] of J3.entries()) {
      await J.until(`${vu('play')} && !document.getElementById('clue-input').disabled && /Tour ${tour}/.test(document.getElementById('turn-head').textContent)`, 15000 * LENT, `tour ${tour} chez ${J.nom}`);
      await J.type('#clue-input', `qx${n}${tour}${i}`);
      await J.click('#clue-send');
    }
  }
  for (const [J, T] of cible) {
    await J.until(`${vu('vote')} && document.querySelectorAll('#vote-grid button:not([disabled])').length === 2`, 15000 * LENT, `vote chez ${J.nom}`);
    await J.click(`#vote-grid button[aria-label=${JSON.stringify('Voter contre ' + T.nomJeu)}]`);
  }
  if (py === 2 && pz === 2) {                          // démasqué : sa dernière chance
    await X.until(`${vu('guess')} && document.querySelectorAll('#word-grid button:not([disabled])').length > 1`, 15000 * LENT, 'dernière chance');
    const mots = await X.eval(`[...document.querySelectorAll('#word-grid button')].map((b) => b.textContent)`);
    const k = px === 4 ? mots.indexOf(mot) : mots.findIndex((w) => w !== mot);
    await X.click(`#word-grid button:nth-child(${k + 1})`);
  }
  const res = await mj.attends((d, g) => g === 'jeu' && d.type === 'results' && d.round === n, 15000 * LENT, 'résultats ' + n);
  const obtenu = J3.map((J) => res.points[J.qid] || 0);
  t(`manche ${n} : jouée pour de vrai, l'issue voulue (${J3[imp].nom} intrus)`, same(obtenu, choix.d), `${JSON.stringify(obtenu)} pour ${JSON.stringify(choix.d)}`);
  await mj.until(`${vu('results')} && ${vu('next')}`, 8000, 'bouton du MJ');
  await mj.click('#next');
  return s.map((x, i) => x + obtenu[i]);
}

// Le helper de rangs, lu dans la VRAIE page (il vit dans l'IIFE de app.js,
// donc hors de portée d'un eval navigateur) : extrait tel quel et exécuté ici.
function helperRangs() {
  const app = fs.readFileSync(path.join(ROOT, 'games', 'quiment', 'app.js'), 'utf8');
  const m = app.match(/function rangs\(ranking\) \{[\s\S]*?\n  \}/);
  return m ? new Function(m[0] + '; return rangs;')() : null;
}

try {
  cdp = await cdpBrowser();
  const A = await joueur(cdp, 'A'), B = await joueur(cdp, 'B'), C = await joueur(cdp, 'C');
  const tous = [A, B, C];
  const noms = { A: 'Qm-Alice', B: 'Qm-Bruno', C: 'Qm-Chloé' };
  for (const J of tous) J.nomJeu = noms[J.nom];

  // ═══ 1. session à trois, seul Qui Ment ? possible
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
  for (const g of ['passeur', 'imitation', 'ban', 'precision', 'demicercle', 'roquette']) await B.click(`#hub-games [data-pref=veto][data-game=${g}]`);
  await A.until(`[...document.querySelectorAll('#hub-games .hub-game[data-eligible=true]')].map((x) => x.dataset.game).join() === 'quiment'`, 8000, 'seul Qui Ment ?');
  const avant = Object.assign({}, A.hub().scores);
  t('session à trois, seul Qui Ment ? possible', true, code);

  // ═══ 2. lancement : chacun déclare SA place
  await A.click('#hub-draw-btn');
  await A.until(`document.getElementById('hub-result').dataset.game === 'quiment' && !document.getElementById('hub-continue').hidden`, 20000, 'révélation');
  await A.click('#hub-continue');
  await A.until(`!document.getElementById('launch-go').hidden`, 8000, 'Ouvrir');
  await A.click('#launch-go');
  await A.until(surQM, 20000, 'A sur Qui Ment ?');
  await A.until(`!document.getElementById('lobby').hidden && document.getElementById('room-code').textContent.trim().length === 4`, 60000 * LENT, 'room créée');
  for (const J of [B, C]) {
    await J.until(`!document.getElementById('launch-go').hidden && /Rejoindre/.test(document.getElementById('launch-go').textContent)`, 15000, `Rejoindre chez ${J.nom}`);
    await J.immobile('#launch-go');
    await J.click('#launch-go');
    await J.until(surQM, 20000, `${J.nom} sur Qui Ment ?`);
    await J.until(`!document.getElementById('lobby').hidden && document.getElementById('room-code').textContent.trim().length === 4`, 20000, `${J.nom} dans la room`);
  }
  const monYou = (J) => { const f = J.jeu((d) => d.type === 'you'); return f && f.d.id; };
  const declares = (J) => J.envoyes.filter((f) => f.g === 'hub' && (f.d.action === 'launched' || f.d.action === 'entered'));
  const places = tous.map((J) => {
    const you = monYou(J), d = declares(J);
    return { you, decl: d.map((f) => f.d.gamePlayerId), ok: !!you && d.length === 1 && d[0].d.gamePlayerId === you };
  });
  t('chacun déclare au Hub SA place (id de son message `you`), une seule fois', places.every((p) => p.ok), JSON.stringify(places));
  const idsHub = await Promise.all(tous.map((J) => J.eval('GameProfile.load().id')));
  t('… et jamais l\'id du Hub à la place', places.every((p, i) => p.you !== idsHub[i] && !p.decl.includes(idsHub[i])));

  // ═══ 3. B perd sa connexion au salon et revient : nouvel id, la place suit
  const youB1 = places[1].you;
  await B.eval(`NET.ws.close(); true`);
  await B.until(`!document.getElementById('lobby').hidden`, 15000, 'salon de B');
  const finB = Date.now() + 15000 * LENT;
  while (Date.now() < finB && (monYou(B) === youB1)) await sleep(80);
  const youB2 = monYou(B);
  await A.until(`document.querySelectorAll('#players .g-player').length === 3`, 10000, '3 joueurs chez A');
  await sleep(400);                                    // les `lobby` suivants n'ajoutent aucune annonce
  const declB = declares(B).map((f) => f.d.gamePlayerId);
  t('reconnexion au salon : nouvel id Qui Ment ?, la place est ré-annoncée (et elle seule)', declB.length === 2 && declB[0] === youB1 && declB[1] === youB2 && youB2 !== youB1, JSON.stringify(declB));
  t('… les autres n\'ont rien ré-annoncé pendant ce temps', [A, C].every((J) => declares(J).length === 1));
  const hubB = B.envoyes.filter((f) => f.g === 'hub' && f.d.action === 'entered').pop();
  t('la nouvelle place part bien vers le Hub (`entered`, gamePlayerId = nouvel id)', !!hubB && hubB.d.gamePlayerId === youB2);

  // ═══ 4. trois manches, jouées pour de vrai, vers un ex æquo 1 / 1 / 3
  t('stratégie : 1 / 1 / 3 atteignable en 3 manches quels que soient les intrus', gagnable([0, 0, 0], 3));
  for (const J of tous) J.qid = monYou(J);
  await A.until(`!document.getElementById('start').disabled`, 15000 * LENT, '« Lancer » débloqué');
  await A.eval(`document.getElementById('rounds-select').value = '3'; true`);
  await A.click('#start');
  let s = [0, 0, 0];
  for (let n = 1; n <= 3; n++) s = await manche(tous, A, n, s, 3 - n);
  const fin = await A.attends((d, g) => g === 'jeu' && d.type === 'end', 15000 * LENT, 'classement');
  const ranking = fin.ranking;
  const scoreDe = Object.fromEntries(ranking.map((r) => [r.id, r.score]));
  t('classement du serveur : un ex æquo en tête, le troisième derrière', exAequo(ranking.map((r) => r.score)) && same(tous.map((J) => scoreDe[J.qid]), s),
    ranking.map((r) => `${r.name} ${r.score}`).join(', '));

  // ═══ 5. ce qui part vers le Hub
  await sleep(500);
  const ordre = A.envoyes.filter((f) => f.g === 'hub' && (f.d.action === 'results' || f.d.action === 'ended')).map((f) => f.d.action);
  const envoi = A.envoyes.find((f) => f.g === 'hub' && f.d.action === 'results');
  t('l\'hôte envoie `results` PUIS `ended`, une seule fois', same(ordre, ['results', 'ended']), ordre.join(' → '));
  t('le classement envoyé = celui du serveur, dans son ordre (id, points = score), rien d\'autre', !!envoi && envoi.d.gameId === 'quiment'
    && same(envoi.d.results.map((r) => [r.gamePlayerId, r.points]), ranking.map((r) => [r.id, r.score]))
    && envoi.d.results.every((r) => same(Object.keys(r).sort(), ['gamePlayerId', 'points', 'rank'])));
  t('B y figure sous sa NOUVELLE place', !!envoi && envoi.d.results.some((r) => r.gamePlayerId === youB2) && !envoi.d.results.some((r) => r.gamePlayerId === youB1));
  t('rangs de compétition → 1, 1, 3', !!envoi && same(envoi.d.results.map((r) => r.rank), [1, 1, 3]), envoi && JSON.stringify(envoi.d.results.map((r) => [r.points, r.rank])));
  t('les invités n\'envoient AUCUN classement', [B, C].every((J) => !J.envoyes.some((f) => f.d.action === 'results')));
  const rangs = helperRangs();
  const cas = [[[100, 80, 50], [1, 2, 3]], [[100, 100, 50], [1, 1, 3]], [[50, 20, 50], [1, 3, 1]], [[13, 13, 5], [1, 1, 3]]];
  const vus = cas.map(([sc]) => rangs ? rangs(sc.map((score, i) => ({ id: 'p' + i, score, avg: 9, title: 'x' }))).map((r) => r.rank) : null);
  t('helper de rangs : 100/80/50 → 1/2/3, 100/100/50 → 1/1/3, 50/20/50 → 1/3/1 (non trié), 13/13/5 → 1/1/3', cas.every(([, a], i) => same(vus[i], a)), JSON.stringify(vus));
  t('… et il ne transmet ni avg ni title', !!rangs && same(Object.keys(rangs([{ id: 'x', score: 1, avg: 1, title: 't' }])[0]).sort(), ['gamePlayerId', 'points', 'rank']));

  // ═══ 6. le Hub compte
  const deb = await B.attends((d) => d.session && d.session.state === 'debrief' && d.session.history.games.some((g) => g.gameId === 'quiment'), 15000, 'debrief compté');
  const nomDe = (pid) => deb.session.players.find((p) => p.id === pid).name;
  const gain = Object.fromEntries(Object.entries(deb.session.scores).map(([pid, v]) => [nomDe(pid), v - (avant[pid] || 0)]));
  const partieH = deb.session.history.games.filter((g) => g.gameId === 'quiment').pop();
  const ligneB = partieH && partieH.results.find((r) => r.playerId === idsHub[1]);
  t('B est crédité via sa NOUVELLE place', !!ligneB && ligneB.gamePoints === scoreDe[youB2], JSON.stringify(ligneB));
  t('la session revient en debrief', deb.session.state === 'debrief');
  t('le Hub a converti le classement : 30 / 30 / 10', same(Object.entries(gain).sort(), Object.entries(attendu(ranking)).sort()) && same(Object.values(gain).sort(), [10, 30, 30]), JSON.stringify(gain));
  const drawId1 = deb.session.launch.drawId;
  const scoresHub = deb.session.scores, histoHub = deb.session.history;

  // ═══ 7. « Rejouer » : une revanche complète, qui ne recompte rien
  const eA = A.envoyes.length, finsAvant = A.recus.filter((f) => f.g === 'jeu' && f.d.type === 'end').length;
  await A.until(`${vu('again')} && !document.getElementById('again').disabled`, 8000, '« Rejouer »');
  // Lot F : à la PREMIÈRE fin déjà, le retour au Hub passe devant la revanche.
  await finHub(A, t, 'Qui Ment ? (1re fin) — A', { replay: 'again' });
  await A.click('#again');
  for (const J of tous) await J.until(vu('play'), 15000 * LENT, `revanche chez ${J.nom}`);
  t('« Rejouer » relance une partie dans la même room', true);
  for (let k = 0; k < 40 && !(await A.eval(vu('end'))); k++) {
    let id = null;
    for (const b of ['skip-clue', 'skip-vote', 'skip-guess', 'next']) if (await A.eval(vu(b))) { id = b; break; }
    if (!id) { await sleep(150); continue; }
    const n0 = A.recus.length;
    await A.click('#' + id);
    const f = Date.now() + 8000;
    while (Date.now() < f && A.recus.length === n0) await sleep(50);
    await sleep(150);
  }
  await A.until(vu('end'), 8000, 'classement de la revanche');
  await sleep(600);
  const finsApres = A.recus.filter((f) => f.g === 'jeu' && f.d.type === 'end').length;
  const versHub = A.envoyes.slice(eA).filter((f) => f.g === 'hub').map((f) => f.d.action);
  t('la revanche va jusqu\'à son classement (un second `end`)', finsApres === finsAvant + 1);
  t('… sans rien envoyer au Hub (ni results, ni ended)', !versHub.includes('results') && !versHub.includes('ended'), JSON.stringify(versHub));
  const hubApres = B.hub();
  t('… le score et l\'historique du Hub n\'ont pas bougé', same(hubApres.scores, scoresHub) && same(hubApres.history, histoHub) && hubApres.state === 'debrief');

  // ═══ 8. VRAI retour au Hub : chacun clique, la page du jeu se ferme
  const depuis = tous.map((J) => J.recus.length);
  for (const J of tous) {
    await J.until(`!document.getElementById('to-hub').hidden`, 10000, `fin chez ${J.nom}`);
    // Lot F : la fin en mode Hub (tests/hub-end.mjs), chez l'hôte et un invité.
    if (J === A || J === B) await finHub(J, t, `Qui Ment ? (revanche finie) — ${J.nom}`, { replay: 'again', hote: J === A });
    await J.click('#to-hub');
  }
  for (const J of tous) await J.until(`${auSalon} && document.querySelectorAll('#hub-score-list li').length === 3`, 20000 * LENT, `retour Hub ${J.nom}`);
  for (const [i, J] of tous.entries()) {
    const f = J.recus.slice(depuis[i]).find((x) => x.g === 'hub' && x.d.type === 'joined');
    const sj = f ? f.d.session : {};
    t(`${J.nom} : même session (${code}), score et historique conservés, debrief`,
      !!f && sj.code === code && (await J.eval(`document.getElementById('hub-code').textContent.trim()`)) === code
      && same(sj.scores, scoresHub) && same(sj.history, histoHub) && sj.state === 'debrief', f ? `${sj.state} ${JSON.stringify(sj.scores)}` : 'pas de joined');
  }
  for (const J of tous) {
    const b = await J.eval(`[...document.querySelectorAll('#hub-score-list .hub-score-row')].map((li) => ({ id: li.dataset.player, pts: +li.dataset.points,
      rang: li.querySelector('.hub-score-rank').textContent, me: li.classList.contains('is-me'), txt: li.querySelector('.hub-score-pts').textContent }))`);
    const sc = J.hub().scores;
    const ok = b.every((l) => l.pts === (sc[l.id] || 0)) && b.filter((l) => l.rang === '🥇').length === 2 && b.find((l) => l.me).id === idsHub[tous.indexOf(J)];
    t(`${J.nom} : le bloc affiche les points du Hub, deux 🥇 (ex æquo), sa ligne en évidence`, ok, JSON.stringify(b.map((l) => `${l.rang} ${l.txt}`)));
  }
  const b0 = await C.eval(`[...document.querySelectorAll('#hub-score-list .hub-score-row')].map((li) => (li.querySelector('.hub-score-delta') || {}).textContent || '')`);
  t('gain de la dernière partie affiché (+30 / +30 / +10)', same([...b0].sort(), ['+10', '+30', '+30']), JSON.stringify(b0));
  t('note : « dernière : Qui Ment ? »', /dernière : .*Qui Ment/i.test(await C.eval(`document.getElementById('hub-score-note').textContent`)),
    await C.eval(`document.getElementById('hub-score-note').textContent`));
  await C.shot('quiment-score');

  // ═══ 9. la soirée continue : un nouveau tirage = un nouveau drawId
  const n0 = A.recus.length;
  await A.click('#hub-draw-btn');
  const d2 = await A.attends((d, g) => g === 'hub' && d.session && d.session.draw && d.session.draw.status === 'drawn' && d.session.draw.n === 2, 20000, 'second tirage');
  t('nouveau tirage depuis la même session : nouveau drawId', d2.session.draw.id !== drawId1 && d2.session.code === code && A.recus.length > n0, `${drawId1} → ${d2.session.draw.id}`);

  const errs = tous.flatMap((J) => J.erreurs.map((e) => `[${J.nom}] ${e}`));
  t('aucune erreur JS dans les trois navigateurs', errs.length === 0, errs.slice(0, 3).join(' | '));
} catch (e) {
  t('EXCEPTION', false, e.message);
} finally {
  stop();
}
console.log(`\n${ko ? 'DES TESTS ÉCHOUENT' : 'TOUT PASSE'} — ${out.length} vérifications, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
