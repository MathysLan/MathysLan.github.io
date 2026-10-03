// Score de soirée — Morpion, de bout en bout, dans de VRAIS navigateurs.
//
//   node tests/hub-score-morpion.mjs              Hub + morpion-server lancés en local
//   node tests/hub-score-morpion.mjs --reduced    même parcours en mouvement réduit
//   node tests/hub-score-morpion.mjs --shots <d>  captures du salon du Hub
//   node tests/hub-score-morpion.mjs --prod       PRODUCTION : site GitHub Pages, vrai Hub
//                                                 et vrai morpion-server (Render)
//
// ⚠️ LE MORPION N'A PAS DE SCORE DE PARTIE. morpion-server ne rend qu'un
// vainqueur (`winner` : 'X' | 'O' | 'draw') à `status: 'over'`. La page en
// DÉRIVE le classement, sans rien inventer :
//   victoire X → X rang 1, O rang 2        victoire O → O rang 1, X rang 2
//   égalité    → X rang 1, O rang 1 (ex æquo)
// avec `points: 0` pour les deux (aucun score propre au jeu : c'est ce que le
// Hub garde en `gamePoints`). Les places sont 'X' et 'O' — le `you` de l'état,
// jamais l'id du Hub. Le HUB convertit (10 × (classés − rang + 1)) : à deux,
// rang 1 → 20, rang 2 → 10. Donc victoire = 20 / 10, égalité = 20 / 20.
//
// Deux contextes isolés (le Morpion se joue à deux, exactement), UNE session :
//   1. victoire X  (X 0, O 3, X 1, O 4, X 2)             → +20 / +10
//   2. victoire O  (X 0, O 3, X 1, O 4, X 8, O 5)        → +10 / +20, cumulés
//   3. égalité     (X O X / X O O / O X X)               → +20 / +20, cumulés
//   4. abandon     (B quitte en pleine partie)           → room fermée, AUCUN
//      classement fabriqué, score inchangé, le Hub revient quand même en debrief
// Entre chaque partie : VRAI retour au Hub (#to-hub) des deux joueurs, même
// session, score et historique conservés, puis un nouveau tirage (nouveau drawId).
//
// ⚠️ LA VÉRITÉ EST DANS LES TRAMES : le vainqueur vient de la trame `state` de
// morpion-server, le score de la trame `session` du Hub.
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
const HTTP_PORT = 8700 + R(), CDP_PORT = 9700 + R(), HUB_PORT = 8100 + R(), MO_PORT = 8900 + R(), HEALTH_PORT = 6400 + R();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let out = [], ko = 0;
const t = (nom, ok, detail = '') => {
  out.push(`${ok ? 'OK  ' : 'KO  '} ${nom}${detail ? ' — ' + detail : ''}`);
  if (!ok) ko++;
  console.log(out[out.length - 1]);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// --- serveurs (local) -------------------------------------------------------------
const HUB = `ws://127.0.0.1:${HUB_PORT}`, MO = `ws://127.0.0.1:${MO_PORT}`;
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
    if (p0 === '/games/morpion/' && !/(^|&)server=/.test(q || '')) { res.writeHead(302, { Location: `/games/morpion/?server=${encodeURIComponent(MO)}` }); return res.end(); }
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

// --- orchestration ----------------------------------------------------------------
let sante = null, MANIFEST = null, srv = null;
if (!PROD) {
  sante = await fakeHealth(HEALTH_PORT);
  MANIFEST = localManifest(ROOT, HEALTH_PORT, { morpion: `http://127.0.0.1:${MO_PORT}/` });
  // ⚠️ morpion-server a besoin de `ws` : sans son propre `npm install`, on lui
  // prête celui de game-hub-server par NODE_PATH (même parade que
  // handoff-morpion.mjs). Rien n'est écrit dans son dépôt.
  const wsDe = path.join(ROOT, '..', 'game-hub-server', 'node_modules');
  lance(path.join(ROOT, '..', 'morpion-server'), 'src/server.js', MO_PORT, { PRESENCE_QUIET: '1',
    NODE_PATH: [process.env.NODE_PATH, wsDe].filter(Boolean).join(path.delimiter) });
  lance(path.join(ROOT, '..', 'game-hub-server'), 'src/server.js', HUB_PORT, { MANIFEST_FILE: MANIFEST });
  srv = await serve();
  await attends(`http://127.0.0.1:${MO_PORT}/`);
  await attends(`http://127.0.0.1:${HUB_PORT}/health`);
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hubscoremo-'));
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
console.log(`Score de soirée — Morpion, deux navigateurs (${PROD ? 'PRODUCTION' : 'local'}${REDUCED ? ', mouvement réduit' : ''})\n`);
const surMorpion = `location.pathname.endsWith('/games/morpion/') && document.readyState === 'complete'`;
const auSalon = `location.pathname.endsWith('/games/') && !document.getElementById('lobby').hidden`;

// Les seules clés qu'une page a le droit d'envoyer à morpion-server (même
// liste que handoff-morpion.mjs) : aucune identité, jamais.
const CLES_JEU = ['action', 'code', 'index', 'n', 'remplace'];

try {
  cdp = await cdpBrowser();
  const A = await joueur(cdp, 'A'), B = await joueur(cdp, 'B');
  const tous = [A, B];
  const noms = { A: 'Mo-Alice', B: 'Mo-Bruno' };

  // ═══ 1. session à deux, seul le Morpion possible
  await A.goto(PAGE);
  await A.type('#name-input', noms.A); await A.click('#identity-done');
  await A.click('#hub-create');
  await A.until(`!document.getElementById('lobby').hidden`, 20000 * LENT, 'salon de A');
  const code = await A.eval(`document.getElementById('hub-code').textContent.trim()`);
  await B.goto(PAGE);
  await B.type('#name-input', noms.B); await B.click('#identity-done');
  await B.type('#hub-code-input', code); await B.click('#hub-join');
  for (const J of tous) await J.until(`document.querySelectorAll('#hub-players .hub-card').length === 2 && document.querySelectorAll('#hub-games .hub-game').length >= 8`, 20000 * LENT, `${J.nom} au salon`);
  for (const g of ['passeur', 'imitation', 'ban', 'precision', 'demicercle', 'roquette']) await B.click(`#hub-games [data-pref=veto][data-game=${g}]`);
  await A.until(`[...document.querySelectorAll('#hub-games .hub-game[data-eligible=true]')].map((x) => x.dataset.game).join() === 'morpion'`, 8000, 'seul le Morpion');
  const idsHub = await Promise.all(tous.map((J) => J.eval('GameProfile.load().id')));
  t('session à deux, seul le Morpion possible', true, code);

  // Un tirage, un lancement, les deux dans la room. Rend { drawId, room, depuis }.
  const drawIds = [];
  async function lancement(n) {
    const m = A.recus.length;
    await A.click('#hub-draw-btn');
    await A.until(`document.getElementById('hub-result').dataset.game === 'morpion' && !document.getElementById('hub-continue').hidden`, 20000, 'révélation ' + n);
    const d = await A.attends((x, g) => g === 'hub' && x.session && x.session.draw && x.session.draw.status === 'drawn' && x.session.draw.n === n, 5000, 'tirage ' + n);
    t(`partie ${n} : nouveau tirage, nouveau drawId`, !drawIds.includes(d.session.draw.id) && A.recus.length > m, d.session.draw.id);
    drawIds.push(d.session.draw.id);
    const depuis = tous.map((J) => ({ r: J.recus.length, e: J.envoyes.length }));
    await A.click('#hub-continue');
    await A.until(`!document.getElementById('launch-go').hidden`, 8000, 'Ouvrir');
    await A.click('#launch-go');
    await A.until(`${surMorpion} && state && state.status === 'waiting'`, 60000 * LENT, 'room créée');
    const room = await A.eval('state.code');
    await B.until(`!document.getElementById('launch-go').hidden && /Rejoindre/.test(document.getElementById('launch-go').textContent)`, 15000, 'Rejoindre chez B');
    await B.immobile('#launch-go');
    await B.click('#launch-go');
    await B.until(`${surMorpion} && state && state.status === 'playing'`, 30000 * LENT, 'B dans la room');
    await A.until(`state && state.status === 'playing'`, 10000, 'partie chez A');
    return { drawId: d.session.draw.id, room, depuis };
  }
  const coup = async (J, i) => {
    await J.until(`state && state.status === 'playing' && state.turn === state.you`, 10000 * LENT, `tour de ${J.nom}`);
    await J.click(`#board .cell:nth-child(${i + 1})`);
  };
  // Coups alternés, X (A, l'hôte) commence.
  async function joue(seq) { for (const [k, i] of seq.entries()) await coup(k % 2 ? B : A, i); }
  const versHub = (J, depuis, action) => J.envoyes.slice(depuis).filter((f) => f.g === 'hub' && (!action || f.d.action === action));

  // Ce qui part vers le Hub et ce qu'il en fait, pour une partie finie.
  async function verifie(n, L, winner, rangs, gains) {
    const fin = await A.attends((d, g) => g === 'jeu' && d.type === 'state' && d.code === L.room && d.status === 'over', 10000 * LENT, 'fin ' + n);
    t(`partie ${n} : morpion-server rend winner = ${winner}`, fin.winner === winner, `winner ${fin.winner}`);
    await sleep(500);
    const decl = tous.map((J, i) => versHub(J, L.depuis[i].e).filter((f) => f.d.action === 'launched' || f.d.action === 'entered').map((f) => f.d.gamePlayerId));
    t(`partie ${n} : A déclare la place X, B la place O — une fois chacun, jamais l'id du Hub`, same(decl, [['X'], ['O']]) && decl.flat().every((x) => !idsHub.includes(x)), JSON.stringify(decl));
    const ordre = versHub(A, L.depuis[0].e).filter((f) => f.d.action === 'results' || f.d.action === 'ended').map((f) => f.d.action);
    t(`partie ${n} : l'hôte envoie \`results\` PUIS \`ended\`, une seule fois`, same(ordre, ['results', 'ended']), ordre.join(' → '));
    const envoi = versHub(A, L.depuis[0].e, 'results')[0];
    t(`partie ${n} : classement dérivé du vainqueur = ${JSON.stringify(rangs)}, points du jeu 0`, !!envoi && envoi.d.gameId === 'morpion' && envoi.d.drawId === L.drawId
      && same(envoi.d.results, [{ gamePlayerId: 'X', rank: rangs.X, points: 0 }, { gamePlayerId: 'O', rank: rangs.O, points: 0 }]), envoi && JSON.stringify(envoi.d.results));
    t(`partie ${n} : l'invité n'envoie AUCUN classement`, versHub(B, L.depuis[1].e, 'results').length === 0);
    const jeu = tous.flatMap((J, i) => J.envoyes.slice(L.depuis[i].e).filter((f) => f.g === 'jeu').map((f) => Object.keys(f.d)));
    t(`partie ${n} : aucune identité envoyée à morpion-server`, jeu.length > 0 && jeu.every((ks) => ks.every((k) => CLES_JEU.includes(k))), JSON.stringify([...new Set(jeu.flat())]));
    const deb = await B.attends((d) => d.session && d.session.state === 'debrief' && d.session.history.games.length === n, 15000, 'debrief ' + n);
    const partie = deb.session.history.games[n - 1];
    const gain = idsHub.map((id) => deb.session.scores[id] - (avantScores[id] || 0));
    t(`partie ${n} : le Hub crédite ${gains.join(' / ')} (A / B)`, same(gain, gains), JSON.stringify(gain));
    t(`partie ${n} : historique — Morpion, rangs ${rangs.X} / ${rangs.O}, gamePoints 0`, partie.gameId === 'morpion'
      && same(idsHub.map((id) => { const r = partie.results.find((x) => x.playerId === id); return r && [r.rank, r.gamePoints]; }), [[rangs.X, 0], [rangs.O, 0]]), JSON.stringify(partie.results));
    return deb.session;
  }

  // La carte « Résultat » du debrief, telle qu'affichée (ou son absence).
  const CARTE = `(() => { const c = document.getElementById('hub-round'); const btn = document.getElementById('hub-draw-btn');
    return { vu: !c.hidden, draw: c.dataset.draw, titre: document.getElementById('round-title').textContent,
      lignes: [...document.querySelectorAll('#round-list .round-row')].map((li) => [li.dataset.player, +li.dataset.rank, +li.dataset.points]),
      ptsJeu: document.querySelectorAll('#round-list .round-game-pts').length, caisse: !document.getElementById('hub-draw').hidden,
      tirerAuSalon: !!btn.closest('#hub-act'), pret: document.getElementById('hub-ready').textContent }; })()`;
  // Vrai retour au Hub des deux joueurs : même session, rien de perdu.
  async function retour(n, attendu) {
    const depuis = tous.map((J) => J.recus.length);
    for (const J of tous) {
      await J.until(`!document.getElementById('to-hub').hidden`, 10000, `« Retour au Game Hub » chez ${J.nom}`);
      // Lot F : la fin en mode Hub (tests/hub-end.mjs) ; pas de revanche au Morpion.
      if (n === 1) await finHub(J, t, `Morpion — ${J.nom}`, { replay: null });
      await J.click('#to-hub');
    }
    for (const J of tous) await J.until(`${auSalon} && document.querySelectorAll('#hub-score-list li').length === 2`, 20000 * LENT, `retour Hub ${J.nom}`);
    const oks = await Promise.all(tous.map(async (J, i) => {
      const f = J.recus.slice(depuis[i]).find((x) => x.g === 'hub' && x.d.type === 'joined');
      const s = f && f.d.session;
      return !!s && s.code === code && (await J.eval(`document.getElementById('hub-code').textContent.trim()`)) === code
        && same(s.scores, attendu.scores) && same(s.history, attendu.history) && s.state === 'debrief';
    }));
    t(`après la partie ${n} : vrai retour au Hub des deux — même session, score et historique conservés, debrief`, oks.every(Boolean), JSON.stringify(oks));
    const b = await A.eval(`[...document.querySelectorAll('#hub-score-list .hub-score-row')].map((li) => [li.dataset.player, +li.dataset.points, li.querySelector('.hub-score-rank').textContent])`);
    t(`après la partie ${n} : le bloc affiche les points du Hub`, b.every(([id, pts]) => pts === attendu.scores[id]), JSON.stringify(b));
    // La carte « Résultat » : CETTE partie (dernière entrée de history.games),
    // sans colonne de points de partie (le Morpion n'en a pas : 0 partout).
    const g = attendu.history.games[attendu.history.games.length - 1];
    for (const J of tous) {
      const c = await J.eval(CARTE);
      t(`après la partie ${n} : ${J.nom} voit la carte « Résultat — Morpion » de CETTE partie (rangs et gains du Hub, aucun point de partie)`,
        c.vu && c.draw === g.drawId && /Résultat — Morpion/.test(c.titre) && !c.caisse && c.ptsJeu === 0
        && same(c.lignes, g.results.slice().sort((x, y) => x.rank - y.rank).map((r) => [r.playerId, r.rank, r.points])), JSON.stringify(c));
    }
    return b;
  }

  // ═══ 2. victoire X
  let avantScores = {};
  let L = await lancement(1);
  await joue([0, 3, 1, 4, 2]);
  let s = await verifie(1, L, 'X', { X: 1, O: 2 }, [20, 10]);
  let bloc = await retour(1, s);
  t('victoire X : 🥇 pour A (X), 🥈 pour B (O)', same(bloc.map(([id, , r]) => [id, r]), [[idsHub[0], '🥇'], [idsHub[1], '🥈']]), JSON.stringify(bloc));
  await A.shot('morpion-score-1');

  // ═══ 3. victoire O — cumulée
  avantScores = s.scores;
  L = await lancement(2);
  await joue([0, 3, 1, 4, 8, 5]);
  s = await verifie(2, L, 'O', { X: 2, O: 1 }, [10, 20]);
  t('victoire O : les points se cumulent (30 / 30)', same(idsHub.map((id) => s.scores[id]), [30, 30]), JSON.stringify(s.scores));
  await retour(2, s);

  // ═══ 4. égalité : X O X / X O O / O X X — ex æquo au premier rang
  avantScores = s.scores;
  L = await lancement(3);
  await joue([0, 1, 2, 4, 3, 5, 7, 6, 8]);
  s = await verifie(3, L, 'draw', { X: 1, O: 1 }, [20, 20]);
  t('égalité : cumul 50 / 50', same(idsHub.map((id) => s.scores[id]), [50, 50]), JSON.stringify(s.scores));
  bloc = await retour(3, s);
  t('égalité : l\'ex æquo est conservé (deux 🥇)', bloc.filter(([, , r]) => r === '🥇').length === 2, JSON.stringify(bloc));
  await A.shot('morpion-score-3');

  // ═══ 5. abandon : B quitte en pleine partie
  const scoresAvant = s.scores, histoAvant = s.history;
  L = await lancement(4);
  await coup(A, 4);
  await B.click('.g-hub-banner-back');
  await B.until(`location.pathname.endsWith('/games/')`, 15000, 'B au Hub');
  await A.until(`/adversaire est parti/.test(document.getElementById('error').textContent) && !document.getElementById('to-hub').hidden`, 10000 * LENT, 'A prévenu');
  t('abandon : morpion-server ferme la room, A est prévenu (« adversaire est parti »)', true, await A.eval(`document.getElementById('error').textContent`));
  await sleep(600);
  t('abandon : aucune fin `over` pour cette room', !A.recus.some((f) => f.g === 'jeu' && f.d.type === 'state' && f.d.code === L.room && f.d.status === 'over'));
  const ordre4 = versHub(A, L.depuis[0].e).filter((f) => f.d.action === 'results' || f.d.action === 'ended').map((f) => f.d.action);
  t('abandon : AUCUN classement fabriqué — seulement `ended`, comme avant', same(ordre4, ['ended']), ordre4.join(' → '));
  const deb4 = await A.attends((d) => d.session && d.session.state === 'debrief' && d.session.launch && d.session.launch.drawId === L.drawId && d.session.launch.stage === 'ended', 15000, 'debrief 4');
  t('abandon : le Hub revient en debrief, score et parties notées inchangés', same(deb4.session.scores, scoresAvant) && same(deb4.session.history.games, histoAvant.games), JSON.stringify(deb4.session.scores));
  await A.click('#to-hub');
  await A.until(`${auSalon} && document.querySelectorAll('#hub-score-list li').length === 2`, 20000 * LENT, 'retour Hub A (abandon)');
  t('abandon : A revient au Hub, même session, score toujours 50 / 50', (await A.eval(`document.getElementById('hub-code').textContent.trim()`)) === code
    && same(idsHub.map((id) => A.hub().scores[id]), [50, 50]));
  const c4 = await A.eval(CARTE);
  t('abandon : AUCUNE carte « Résultat » (pas de partie classée) — la caisse et « Partie … terminée » comme avant, « Tirer » à sa place sous les joueurs',
    !c4.vu && c4.caisse && /terminée/.test(c4.pret) && c4.tirerAuSalon, JSON.stringify(c4));

  const errs = tous.flatMap((J) => J.erreurs.map((e) => `[${J.nom}] ${e}`));
  t('aucune erreur JS dans les deux navigateurs', errs.length === 0, errs.slice(0, 3).join(' | '));
} catch (e) {
  t('EXCEPTION', false, e.message);
} finally {
  stop();
}
console.log(`\n${ko ? 'DES TESTS ÉCHOUENT' : 'TOUT PASSE'} — ${out.length} vérifications, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
