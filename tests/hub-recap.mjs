// Débrief de soirée du Game Hub : le module pur (games/hub-recap.js), puis la
// vraie page /games/ contre un VRAI game-hub-server local.
//
//   node tests/hub-recap.mjs              module + navigateur
//   node tests/hub-recap.mjs --reduced    même parcours en mouvement réduit
//   node tests/hub-recap.mjs --shots <d>  captures du débrief (1280 et 390 px)
//
// ⚠️ AUCUN JEU N'EST LANCÉ, ET AUCUN SCORE N'EST FABRIQUÉ CÔTÉ PAGE. Des
// clients Node jouent le protocole du Hub tel que les pages de jeux le jouent
// (tirage, continue, launched / entered avec la place, results, ended — comme
// game-hub-server/test-scores.js) : c'est le VRAI Hub qui calcule le score et
// l'historique. L'un de ces clients porte l'id du profil du navigateur ; il se
// déconnecte, et la vraie page /games/ reprend la session — exactement le
// retour au Hub après une partie. Puis le navigateur clique « Terminer ma
// soirée » : le débrief est construit sur l'état que le Hub vient d'envoyer.
//
// Scénarios : 3 joueurs / 1 partie ; 3 joueurs / 3 parties avec ex æquo et un
// joueur parti en route ; solo ; aucune partie (comportement d'avant) ; le
// débrief n'apparaît jamais tant que la session est active ; une nouvelle
// session le range et repart de zéro. Mise en page à 1280 et 390 px.
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


// ═══════════════════════════════════════════════ 1. le module pur, sans réseau
const require = createRequire(import.meta.url);
const HubRecap = require(path.join(ROOT, 'games', 'hub-recap.js'));
const INFO = { passeur: { emoji: '🏐', title: 'Le Passeur' }, precision: { emoji: '🎯', title: 'Précision' }, morpion: { emoji: '❌', title: 'Morpion' } };
const info = (id) => INFO[id] || { emoji: '🎮', title: id };
const P = (id, name, connected = true) => ({ id, name, avatar: { kind: 'emoji', emoji: '🦊' }, connected });
const G = (n, gameId, rows) => ({ n, drawId: 'd' + n, gameId, at: n, players: rows.length, results: rows.map(([playerId, name, rank, points]) => ({ playerId, name, rank, gamePoints: 0, points })) });
const S = (players, scores, games) => ({ code: 'ABCDE', players, scores, history: { played: games.map((g) => g.gameId), games } });

console.log('Débrief de soirée — module pur\n');
t('aucune partie classée → pas de débrief (null), pas de faux historique', HubRecap.build(S([P('a', 'Ana')], {}, []), 'a', info) === null);
{
  const s = S([P('a', 'Ana'), P('b', 'Bob'), P('c', 'Cam')], { a: 20, b: 30, c: 10 }, [G(1, 'passeur', [['b', 'Bob', 1, 30], ['a', 'Ana', 2, 20], ['c', 'Cam', 3, 10]])]);
  const r = HubRecap.build(s, 'a', info);
  t('1 partie : classement du Hub, meilleurs d\'abord (Bob 30, Ana 20, Cam 10)', same(r.ranking.map((l) => [l.name, l.pts, l.rank]), [['Bob', 30, 1], ['Ana', 20, 2], ['Cam', 10, 3]]));
  t('1 partie : « toi » repéré, une ligne d\'historique', r.ranking.find((l) => l.me).id === 'a' && r.games.length === 1);
  t('1 partie : vainqueur Bob, ta place 2 (🥈), ton gain +20', same(r.games[0].winners.map((w) => w.name), ['Bob']) && same(r.games[0].me, { rank: 2, points: 20 }) && HubRecap.place(2) === '🥈');
  t('1 partie : chiffres — 1 partie, dernier jeu Le Passeur, dernier gain +20', r.facts.count === 1 && r.facts.last.title === 'Le Passeur' && r.facts.lastGain === 20);
  t('1 partie : pas solo', r.solo === false);
}
{
  // Trois parties ; ex æquo dans la 2e ; Cam part après la 2e (garde ses points).
  const games = [
    G(1, 'passeur', [['a', 'Ana', 1, 30], ['b', 'Bob', 2, 20], ['c', 'Cam', 3, 10]]),
    G(2, 'precision', [['b', 'Bob', 1, 30], ['c', 'Cam', 1, 30], ['a', 'Ana', 3, 10]]),
    G(3, 'morpion', [['a', 'Ana', 1, 20], ['b', 'Bob', 2, 10]]),
  ];
  const s = S([P('a', 'Ana'), P('b', 'Bob')], { a: 60, b: 60, c: 40 }, games);
  const r = HubRecap.build(s, 'b', info);
  t('plusieurs parties : cumul du Hub, ex æquo au MÊME rang (60, 60, 40 → 1, 1, 3)', same(r.ranking.map((l) => [l.name, l.pts, l.rank]), [['Ana', 60, 1], ['Bob', 60, 1], ['Cam', 40, 3]]));
  t('plusieurs parties : à égalité, l\'ordre d\'arrivée — aucun départage inventé', r.ranking[0].rank === r.ranking[1].rank);
  t('joueur parti en route : il reste au classement avec ses points, marqué parti', r.ranking[2].gone === true && r.ranking[2].name === 'Cam');
  t('historique : dans l\'ordre chronologique, sans doublon', same(r.games.map((g) => g.n), [1, 2, 3]) && same(r.games.map((g) => g.gameId), ['passeur', 'precision', 'morpion']));
  t('historique : ex æquo de la partie 2 → deux vainqueurs (Bob, Cam)', same(r.games[1].winners.map((w) => w.name), ['Bob', 'Cam']));
  t('historique : ta place et ton gain par partie (2 +20, 1 +30, 2 +10)', same(r.games.map((g) => g.me && [g.me.rank, g.me.points]), [[2, 20], [1, 30], [2, 10]]));
  t('chiffres : 3 parties, dernier jeu Morpion, dernier gain +10', r.facts.count === 3 && r.facts.last.gameId === 'morpion' && r.facts.lastGain === 10);
  const r2 = HubRecap.build(s, 'c', info);
  t('pas classé dans la dernière partie → dernier gain « — » (null), pas 0', r2.facts.lastGain === null && r2.games[2].me === null);
}
{
  const s = S([P('a', 'Ana')], { a: 10 }, [G(1, 'precision', [['a', 'Ana', 1, 10]])]);
  const r = HubRecap.build(s, 'a', info);
  t('solo : une ligne, rang 1, 10 pts, marqué solo', r.solo === true && same(r.ranking.map((l) => [l.name, l.pts, l.rank]), [['Ana', 10, 1]]) && r.othersOnline === false);
}
{
  const s = S([P('a', 'Ana'), P('b', 'Bob')], { a: 0, b: 0 }, []);
  t('ranking() seul (panneau Score) : joueurs de la session, 0 pour tous, ex æquo 1 / 1', same(HubRecap.ranking(s).map((l) => l.rank), [1, 1]));
  t('ranking() seul : n\'ajoute PAS les joueurs partis', HubRecap.ranking(S([P('a', 'Ana')], { a: 5, z: 9 }, [])).length === 1);
}
t('place() : 🥇 🥈 🥉 puis « 4e »', same([1, 2, 3, 4].map(HubRecap.place), ['🥇', '🥈', '🥉', '4e']));
t('ordinal() : « 1er », « 2e », « 3e »', same([1, 2, 3].map(HubRecap.ordinal), ['1er', '2e', '3e']));

// ── fromFinale() : le PODIUM de la finale — les rangs du Hub regroupés, jamais recalculés
console.log('\nPodium de la finale — module pur\n');
// Une finale telle que game-hub-server (finale.js) l'envoie : [id, nom, points, rang, présent].
const FIN = (rows, games = [G(1, 'passeur', [])]) => ({ code: 'ABCDE', at: 1, by: rows[0][0], played: games.length, games,
  ranking: rows.map(([playerId, name, points, rank, present = true]) => ({ playerId, name, avatar: { kind: 'emoji', emoji: '🦊' }, points, rank, present })) });
const marches = (r) => r.podium.steps.map((s) => [s.rank, s.tie, s.players.map((l) => l.id)]);
{
  const r = HubRecap.fromFinale(FIN([['a', 'Ana', 70, 1], ['b', 'Bob', 50, 2], ['c', 'Cam', 30, 3]]), 'b', info);
  t('finale 3 joueurs : trois marches 1er / 2e / 3e, personne en dessous', same(marches(r), [[1, false, ['a']], [2, false, ['b']], [3, false, ['c']]]) && r.podium.rest.length === 0, JSON.stringify(marches(r)));
  t('finale 3 joueurs : ta place = « 2e sur 3 », 50 pts (repris du Hub)', same(r.place, { rank: 2, pts: 50, of: 3, tie: false }));
}
{
  const r = HubRecap.fromFinale(FIN([['a', 'Ana', 70, 1], ['b', 'Bob', 70, 1], ['c', 'Cam', 50, 3]]), 'b', info);
  t('ex æquo (1, 1, 3) : une marche 1er à DEUX, pas de marche 2e inventée, la 3e', same(marches(r), [[1, true, ['a', 'b']], [3, false, ['c']]]), JSON.stringify(marches(r)));
  t('ex æquo : ta place = « 1er ex æquo sur 3 »', same(r.place, { rank: 1, pts: 70, of: 3, tie: true }));
}
{
  const r = HubRecap.fromFinale(FIN([['a', 'Ana', 60, 1], ['b', 'Bob', 40, 2], ['c', 'Cam', 40, 2], ['d', 'Dan', 20, 4], ['e', 'Eva', 10, 5, false]]), 'e', info);
  t('5 joueurs (1, 2, 2, 4, 5) : marches 1er et 2e (à deux) ; 4e et 5e dans la suite, dans l\'ordre du Hub', same(marches(r), [[1, false, ['a']], [2, true, ['b', 'c']]])
    && same(r.podium.rest.map((l) => [l.id, l.rank]), [['d', 4], ['e', 5]]), JSON.stringify(r.podium));
  t('joueur parti : gardé (nom, avatar, points, rang), marqué parti ; « 5e sur 5 »', r.podium.rest[1].gone === true && r.podium.rest[1].avatar && r.podium.rest[1].pts === 10 && same(r.place, { rank: 5, pts: 10, of: 5, tie: false }));
}
{
  const r = HubRecap.fromFinale(FIN([['a', 'Ana', 40, 1], ['b', 'Bob', 40, 1], ['c', 'Cam', 40, 1]]), 'c', info);
  t('tous ex æquo : UNE marche, les trois dessus, aucun départage', same(marches(r), [[1, true, ['a', 'b', 'c']]]) && same(r.place, { rank: 1, pts: 40, of: 3, tie: true }));
}
{
  const r = HubRecap.fromFinale(FIN([['a', 'Ana', 30, 1], ['b', 'Bob', 10, 2]]), 'a', info);
  t('2 joueurs : deux marches, pas de 3e place inexistante', same(marches(r), [[1, false, ['a']], [2, false, ['b']]]) && r.podium.rest.length === 0 && r.solo === false);
}
{
  const r = HubRecap.fromFinale(FIN([['a', 'Ana', 30, 1]]), 'a', info);
  t('solo : une marche, un joueur, marqué solo', same(marches(r), [[1, false, ['a']]]) && r.solo === true && r.place.of === 1);
}
{
  const r = HubRecap.fromFinale(FIN([['a', 'Ana', 30, 1], ['b', 'Bob', 0, 2], ['c', 'Cam', 0, 2]]), 'b', info);
  t('0 point : pas de marche (pas de médaille pour rien) — dans la suite, rang du Hub gardé', same(marches(r), [[1, false, ['a']]]) && same(r.podium.rest.map((l) => [l.id, l.rank]), [['b', 2], ['c', 2]]));
  const vide = HubRecap.fromFinale(FIN([['a', 'Ana', 0, 1], ['b', 'Bob', 0, 1]], []), 'a', info);
  t('personne n\'a marqué (fin sans partie) : aucune marche, tout le monde dans la suite', vide.podium.steps.length === 0 && vide.podium.rest.length === 2 && vide.games.length === 0);
}
{
  // Le Hub a déjà rangé : fromFinale ne retrie RIEN (même un ordre inattendu passe tel quel).
  const r = HubRecap.fromFinale(FIN([['b', 'Bob', 50, 1], ['a', 'Ana', 50, 1], ['c', 'Cam', 20, 3]]), 'a', info);
  t('rien de retrié ni recompté : ordre, rangs et points du Hub tels quels', same(r.ranking.map((l) => [l.id, l.rank, l.pts]), [['b', 1, 50], ['a', 1, 50], ['c', 3, 20]])
    && same(marches(r)[0][2], ['b', 'a']));
}

// ── lastResult() : la carte « Résultat » du debrief, la dernière partie classée
console.log('\nRésultat de partie (carte du debrief) — module pur\n');
// Un debrief qui SUIT le lancement `drawId` (terminé).
const D = (s, drawId, stage = 'ended') => Object.assign(s, { state: 'debrief', launch: { drawId, stage } });
const GP = (n, gameId, rows, players) => ({ n, drawId: 'd' + n, gameId, at: n, players: players || rows.length,
  results: rows.map(([playerId, name, rank, gamePoints, points]) => ({ playerId, name, rank, gamePoints, points })) });
{
  const s = D(S([P('a', 'Ana'), P('b', 'Bob'), P('c', 'Cam')], { a: 50, b: 30, c: 10 }, [
    GP(1, 'precision', [['a', 'Ana', 1, 300, 30], ['b', 'Bob', 2, 200, 20], ['c', 'Cam', 3, 0, 10]]),
    GP(2, 'passeur', [['c', 'Cam', 3, 40, 10], ['a', 'Ana', 2, 70, 20], ['b', 'Bob', 1, 90, 30]]),
  ]), 'd2');
  const r = HubRecap.lastResult(s, 'a', info);
  t('résultat : la DERNIÈRE partie (n° 2, Le Passeur), pas une autre', r && r.n === 2 && r.gameId === 'passeur' && r.title === 'Le Passeur' && r.drawId === 'd2');
  t('résultat : lignes triées par rang, points de partie ET gains du Hub tels quels',
    same(r.rows.map((x) => [x.name, x.rank, x.gamePoints, x.points]), [['Bob', 1, 90, 30], ['Ana', 2, 70, 20], ['Cam', 3, 40, 10]]), JSON.stringify(r.rows));
  t('résultat : toi = Ana, 2e, +20 ; total de soirée = scores du Hub (50)', same(r.me, { rank: 2, points: 20, tie: false }) && r.total === 50 && r.rows.filter((x) => x.me).length === 1);
  t('résultat : avatars relus dans la session, pas solo, points de partie affichables', r.rows.every((x) => x.avatar && !x.gone) && r.solo === false && r.gamePoints === true);
  t('résultat : un invité voit la même carte, sa propre ligne en évidence', HubRecap.lastResult(s, 'c', info).me.rank === 3 && HubRecap.lastResult(s, 'c', info).rows.find((x) => x.me).name === 'Cam');
}
{
  // Ex æquo (1, 1, 3) et un joueur parti depuis la partie.
  const s = D(S([P('a', 'Ana'), P('b', 'Bob')], { a: 30, b: 30, z: 10 }, [
    GP(1, 'passeur', [['a', 'Ana', 1, 13, 30], ['b', 'Bob', 1, 13, 30], ['z', 'Zoé', 3, 5, 10]]),
  ]), 'd1');
  const r = HubRecap.lastResult(s, 'b', info);
  t('ex æquo : même rang (1, 1, 3), marqué « tie », aucun départage', same(r.rows.map((x) => [x.rank, x.tie]), [[1, true], [1, true], [3, false]]) && r.me.tie === true && r.me.rank === 1);
  const z = r.rows.find((x) => x.id === 'z');
  t('joueur parti : gardé avec son nom de l\'historique, ses points, marqué parti, sans avatar', z && z.gone && z.name === 'Zoé' && z.points === 10 && z.avatar === null);
  t('pas classé dans la partie (arrivé après) → me null, total quand même', (() => { const s2 = D(S([P('a', 'Ana'), P('n', 'Nia')], { a: 30 }, [GP(1, 'passeur', [['a', 'Ana', 1, 9, 30]], 2)]), 'd1');
    const x = HubRecap.lastResult(s2, 'n', info); return x && x.me === null && x.total === 0; })());
}
{
  const s = D(S([P('a', 'Ana')], { a: 10 }, [GP(1, 'precision', [['a', 'Ana', 1, 280, 10]], 1)]), 'd1');
  const r = HubRecap.lastResult(s, 'a', info);
  t('solo : une ligne, marqué solo, gain +10', r && r.solo === true && r.rows.length === 1 && same(r.me, { rank: 1, points: 10, tie: false }));
  t('Morpion (points de partie à 0 partout) : colonne des points de partie masquée',
    HubRecap.lastResult(D(S([P('a', 'Ana'), P('b', 'Bob')], { a: 20, b: 10 }, [GP(1, 'morpion', [['a', 'Ana', 1, 0, 20], ['b', 'Bob', 2, 0, 10]])]), 'd1'), 'a', info).gamePoints === false);
}
{
  // SANS CLASSEMENT : aucune fausse carte.
  const base = () => S([P('a', 'Ana'), P('b', 'Bob')], { a: 20, b: 10 }, [GP(1, 'morpion', [['a', 'Ana', 1, 0, 20], ['b', 'Bob', 2, 0, 10]])]);
  t('sans classement : abandon (le lancement fini d2 n\'a pas d\'entrée) → null', HubRecap.lastResult(D(base(), 'd2'), 'a', info) === null);
  t('sans classement : lancement annulé / en échec → null', HubRecap.lastResult(D(base(), 'd1', 'failed'), 'a', info) === null);
  t('sans classement : pas de lancement (jeu retenu, non lancé) → null', HubRecap.lastResult(Object.assign(base(), { state: 'debrief', launch: null }), 'a', info) === null);
  t('hors debrief (salon, tirage, partie en cours) → null', ['lobby', 'drawing', 'launching', 'inGame'].every((st) => HubRecap.lastResult(Object.assign(D(base(), 'd1'), { state: st }), 'a', info) === null));
  t('aucune partie du tout → null', HubRecap.lastResult(D(S([P('a', 'Ana')], {}, []), 'd1'), 'a', info) === null);
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
// La carte « Résultat » du debrief (#hub-round), telle qu'affichée.
const ROUND = `(() => { const c = document.getElementById('hub-round'); const btn = document.getElementById('hub-draw-btn');
  return { vu: !c.hidden, game: c.dataset.game, titre: document.getElementById('round-title').textContent, moi: document.getElementById('round-me').textContent,
    lignes: [...document.querySelectorAll('#round-list .round-row')].map((li) => ({ id: li.dataset.player, rank: +li.dataset.rank, pts: +li.dataset.points,
      moi: li.classList.contains('is-me'), rangVu: getComputedStyle(li.querySelector('.round-rank')).display !== 'none', av: !!li.querySelector('.g-av') })),
    total: document.getElementById('round-total').textContent, solo: c.classList.contains('is-solo'), neuf: c.classList.contains('is-new'),
    focus: document.activeElement && document.activeElement.id, tirerIci: !!btn.closest('#hub-round') && !btn.hidden,
    caisse: !document.getElementById('hub-draw').hidden, pret: document.getElementById('hub-ready').textContent }; })()`;
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

// La même mesure, pour la carte « Résultat » du debrief.
const GEOM_ROUND = `(() => {
  const R = (e) => e.getBoundingClientRect();
  const panneau = R(document.getElementById('hub-round'));
  const feuilles = [...document.querySelectorAll('#hub-round > *, #hub-round .round-row > *, #hub-round .round-who > *')]
    .filter((e) => getComputedStyle(e).display !== 'none' && R(e).width > 0);
  const deborde = feuilles.filter((e) => R(e).right > panneau.right + 1 || R(e).left < panneau.left - 1).map((e) => e.className || e.id);
  const chev = [];
  for (const par of document.querySelectorAll('#hub-round .round-row')) {
    const k = [...par.children].filter((e) => getComputedStyle(e).display !== 'none');
    for (let i = 0; i < k.length; i++) for (let j = i + 1; j < k.length; j++) {
      const a = R(k[i]), b = R(k[j]);
      if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) chev.push(k[i].className + ' / ' + k[j].className);
    }
  }
  const coupe = feuilles.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => (e.className || e.id) + ' : ' + e.textContent.trim());
  const b = document.getElementById('hub-draw-btn');
  const btnDedans = b.hidden || !b.closest('#hub-round') || (R(b).left >= panneau.left - 1 && R(b).right <= panneau.right + 1);
  return { deborde, chev, coupe, btnDedans, scrollX: document.documentElement.scrollWidth > innerWidth + 1 };
})()`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hubrecap-'));
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${dir}`, '--no-first-run',
  '--disable-features=BackForwardCache', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank'], { stdio: 'ignore' });
let cdp = null;

try {
  cdp = await cdpBrowser();
  const W = await joueur(cdp, 'W');

  // ═══ A. 3 joueurs, 1 partie
  console.log('\nDébrief de soirée — navigateur, vrai Hub\n');
  {
    const w = await entre('Wen', 'p_recapw1');
    const code = w.last().code;
    const b = await entre('Bob', 'p_recapb1', code), c = await entre('Cam', 'p_recapc1', code);
    const deb = await partie(w, [b, c], 'passeur', { Wen: 2, Bob: 1, Cam: 3 });
    await w.fermer();
    await reprend(W, 'p_recapw1', 'Wen', code);
    t('A — après la partie, retour au salon : PAS de débrief (la session est active)', !(await W.eval(recapVu)));
    await W.until(`!document.getElementById('hub-round').hidden`, 5000, 'carte résultat A');
    const ra = await W.eval(ROUND);
    t('A — carte « Résultat — Le Passeur » au retour, À LA PLACE de la caisse', ra.vu && /Résultat — Le Passeur/.test(ra.titre) && ra.game === 'passeur' && !ra.caisse && /terminée/.test(ra.pret), JSON.stringify(ra));
    t('A — classement de la PARTIE : Bob 1er +30, Wen 2e +20, Cam 3e +10, avatars, ta ligne en évidence',
      same(ra.lignes.map((l) => [l.id, l.rank, l.pts, l.moi]), [['p_recapb1', 1, 30, false], ['p_recapw1', 2, 20, true], ['p_recapc1', 3, 10, false]]) && ra.lignes.every((l) => l.av && l.rangVu), JSON.stringify(ra.lignes));
    t('A — ta phrase : « Tu termines 2e · +20 pts », total = score du Hub', ra.moi === 'Tu termines 2e · +20 pts' && ra.total.includes(deb.scores.p_recapw1 + ' pts'), ra.moi + ' | ' + ra.total);
    t('A — l\'hôte a « 🎲 Tirage suivant » DANS la carte', ra.tirerIci && /Tirage suivant/.test(await W.eval(`document.getElementById('hub-draw-btn').textContent`)));
    t('A — arrivée marquée (is-new ; l\'animation elle-même est coupée en mouvement réduit), focus sur le titre', ra.neuf && ra.focus === 'round-title', JSON.stringify(ra));
    t('A — le panneau Score met TON gain en pastille (+20)', (await W.eval(`(document.querySelector('#hub-score-list .hub-score-row.is-me .hub-score-delta.is-fresh') || {}).textContent`)) === '+20');
    for (const [w_, h_] of [[1280, 900], [1100, 900], [390, 780]]) {
      await W.size(w_, h_); await sleep(200);
      const g = await W.eval(GEOM_ROUND);
      t(`A — ${w_} px : carte Résultat sans débordement ni chevauchement, bouton de tirage dans la carte`, !g.deborde.length && !g.chev.length && !g.coupe.length && !g.scrollX && g.btnDedans, JSON.stringify(g));
      if (SHOTS) await W.shot(`round-A-${w_}`, '#hub-round');
    }
    await W.size(1280, 900);
    // Rechargement pendant le debrief : la même carte, rien de rejoué, rien de doublé.
    await W.goto(PAGE);
    await W.until(`!document.getElementById('hub-round').hidden`, 10000, 'carte après rechargement');
    const rr = await W.eval(ROUND);
    t('A — rechargement : même carte, mêmes lignes, AUCUNE arrivée rejouée, focus non volé', same(rr.lignes, ra.lignes) && rr.moi === ra.moi && !rr.neuf && rr.focus !== 'round-title', JSON.stringify(rr));
    t('A — rechargement : rien de doublé côté Hub (1 partie, scores inchangés)', b.last().history.games.length === 1 && same(b.last().scores, deb.scores));
    t('A — le départ dit « Quitter la session » (terminer la soirée pour tous, c\'est l\'hôte, ailleurs)', (await W.eval(`document.getElementById('hub-leave').textContent`)) === 'Quitter la session');
    await W.click('#hub-leave');
    await W.until(recapVu, 5000, 'débrief A');
    const v = await W.eval(LIRE);
    t('A — « Ton récap de soirée » (pas « Soirée terminée » : la session continue), code de la session', /Ton récap/.test(v.titre) && !/terminée/i.test(v.titre) && v.code === code);
    t('A — classement = scores du Hub (Bob 30, Wen 20, Cam 10), 🥇🥈🥉, avatars', same(v.rang.map((l) => [l.id, l.pts, l.rank, l.medaille]), [['p_recapb1', 30, 1, '🥇'], ['p_recapw1', 20, 2, '🥈'], ['p_recapc1', 10, 3, '🥉']])
      && v.rang.every((l) => l.av) && same(v.rang.map((l) => [l.id, l.pts]), Object.entries(deb.scores).sort((x, y) => y[1] - x[1])), JSON.stringify(v.rang));
    t('A — sa ligne en évidence, le premier mis en avant', v.rang.find((l) => l.moi).id === 'p_recapw1' && v.rang[0].top && !v.rang[1].top);
    t('A — chiffres : 1 partie, Le Passeur, +20 pts', v.count === '1' && /Passeur/.test(v.last) && v.gain === '+20 pts', `${v.count} | ${v.last} | ${v.gain}`);
    t('A — historique : une ligne, vainqueur Bob, ta place 🥈, +20', v.jeux.length === 1 && /Bob/.test(v.jeux[0].win) && v.jeux[0].winVu && v.jeux[0].me === '🥈' && v.jeux[0].pts === '+20', JSON.stringify(v.jeux));
    t('A — l\'entrée reste juste dessous (créer / rejoindre), le salon est rangé', v.entree && !v.salon);
    // La composition du RÉCAP, pas celle de la finale (tests/hub-finale.mjs vérifie l'inverse).
    const compo = await W.eval(`(() => { const l = document.getElementById('recap-ranking'), vu = (id) => document.getElementById(id).checkVisibility();
      return { final: document.getElementById('hub-recap').classList.contains('is-final'), podium: l.classList.contains('is-podium'),
        marches: l.querySelectorAll('.recap-step, .recap-plinth').length, lignes: l.querySelectorAll(':scope > .recap-row').length,
        moi: vu('recap-me'), gain: vu('recap-gain'), dernier: vu('recap-last'), suite: vu('recap-next'), accueil: vu('recap-home') }; })()`);
    t('A — récap ≠ finale : une LISTE (ni podium ni marche), pas de « Ta place finale », dernier jeu + dernier gain, la suite (créer / rejoindre), pas de « Retour à l\'accueil »',
      !compo.final && !compo.podium && compo.marches === 0 && compo.lignes === 3 && !compo.moi && compo.gain && compo.dernier && compo.suite && !compo.accueil, JSON.stringify(compo));
    for (const [w_, h_] of [[1280, 900], [390, 780]]) {
      await W.size(w_, h_); await sleep(200);
      const g = await W.eval(GEOM);
      t(`A — ${w_} px : rien ne déborde du panneau, rien ne se chevauche, pas de défilement horizontal`, !g.deborde.length && !g.chev.length && !g.coupe.length && !g.scrollX, JSON.stringify(g));
      if (SHOTS) await W.shot(`recap-A-${w_}`, '#hub-recap');
    }
    await W.size(1280, 900);
    for (const k of [b, c]) k.ws.terminate();
  }

  // ═══ B. 3 joueurs, 3 parties, ex æquo, un joueur parti en route
  {
    const w = await entre('Wen', 'p_recapw2');
    const code = w.last().code;
    const b = await entre('Bob', 'p_recapb2', code), c = await entre('Cam', 'p_recapc2', code);
    await partie(w, [b, c], 'passeur', { Wen: 1, Bob: 2, Cam: 3 });            // 30 / 20 / 10
    await partie(w, [b, c], 'precision', { Wen: 3, Bob: 1, Cam: 1 });          // ex æquo : 10 / 30 / 30
    c.send({ action: 'leave' });                                              // Cam part (garde ses 40)
    await w.until((s) => s.players.length === 2, 5000);
    const deb = await partie(w, [b], 'morpion', { Wen: 1, Bob: 1 });            // nul : 20 / 20
    t('B — le Hub : Wen 60, Bob 70, Cam 40 (score tenu par le Hub)', same(deb.scores, { p_recapw2: 60, p_recapb2: 70, p_recapc2: 40 }), JSON.stringify(deb.scores));
    await w.fermer();
    await reprend(W, 'p_recapw2', 'Wen', code);
    t('B — de retour au salon : pas de débrief tant qu\'on ne part pas', !(await W.eval(recapVu)));
    await W.until(`!document.getElementById('hub-round').hidden`, 5000, 'carte résultat B');
    const rb = await W.eval(ROUND);
    t('B — carte = la DERNIÈRE partie (Morpion), nul : même rang pour les deux, « 1er ex æquo · +20 pts »',
      /Morpion/.test(rb.titre) && same(rb.lignes.map((l) => l.rank), [1, 1]) && rb.moi === 'Tu termines 1er ex æquo · +20 pts', JSON.stringify(rb));
    await W.click('#hub-leave');
    await W.until(recapVu, 5000, 'débrief B');
    const v = await W.eval(LIRE);
    t('B — cumul : Bob 70, Wen 60, Cam 40 (parti, gardé avec ses points)', same(v.rang.map((l) => [l.id, l.pts, l.rank]), [['p_recapb2', 70, 1], ['p_recapw2', 60, 2], ['p_recapc2', 40, 3]]) && v.rang[2].parti, JSON.stringify(v.rang));
    t('B — 3 parties, dernier jeu Morpion, dernier gain +20', v.count === '3' && /Morpion/.test(v.last) && v.gain === '+20 pts', `${v.count} | ${v.last} | ${v.gain}`);
    t('B — historique chronologique, sans doublon (1, 2, 3)', same(v.jeux.map((j) => [j.n, j.game]), [[1, 'passeur'], [2, 'precision'], [3, 'morpion']]), JSON.stringify(v.jeux.map((j) => j.game)));
    t('B — ex æquo de la partie 2 : deux vainqueurs (Bob, Cam), ta place 🥉 +10', /Bob/.test(v.jeux[1].win) && /Cam/.test(v.jeux[1].win) && v.jeux[1].me === '🥉' && v.jeux[1].pts === '+10', v.jeux[1].win);
    t('B — nul du Morpion : deux vainqueurs, dont toi, 🥇 +20', /Wen \(toi\)/.test(v.jeux[2].win) && /Bob/.test(v.jeux[2].win) && v.jeux[2].me === '🥇' && v.jeux[2].pts === '+20', v.jeux[2].win);
    for (const [w_, h_] of [[1280, 900], [390, 780]]) {
      await W.size(w_, h_); await sleep(200);
      const g = await W.eval(GEOM);
      t(`B — ${w_} px : rien ne déborde, rien ne se chevauche`, !g.deborde.length && !g.chev.length && !g.coupe.length && !g.scrollX, JSON.stringify(g));
      if (SHOTS) await W.shot(`recap-B-${w_}`, '#hub-recap');
    }
    // ⚠️ ~300 ms après 390 → 1280 px avant de cliquer : sans cette pause un clic
    // se perd de temps en temps en mouvement réduit (même piège que hub-finale.mjs).
    await W.size(1280, 900); await sleep(300);

    // Une nouvelle session depuis l'entrée juste dessous : le débrief se range, tout repart de zéro.
    await W.click('#hub-create');
    await W.until(`!document.getElementById('lobby').hidden && document.getElementById('hub-code').textContent.trim() !== ${JSON.stringify(code)} && document.getElementById('hub-code').textContent.trim().length === 5`, 10000, 'nouvelle session');
    t('nouvelle session : le débrief est rangé, score à zéro, bouton « Quitter la session » inchangé', !(await W.eval(recapVu))
      && (await W.eval(`[...document.querySelectorAll('#hub-score-list .hub-score-row')].every((li) => li.dataset.points === '0')`))
      && (await W.eval(`document.getElementById('hub-leave').textContent`)) === 'Quitter la session');
    t('… et l\'ancienne session garde ses scores (vue de Bob)', same(b.last().scores, { p_recapw2: 60, p_recapb2: 70, p_recapc2: 40 }));
    await W.click('#hub-leave');
    await W.until(`!document.getElementById('entry').hidden`, 5000, 'entrée');
    t('E — aucune partie jouée : départ comme avant (entrée, pas de débrief)', !(await W.eval(recapVu)) && /quitté la session/.test(await W.eval(`document.getElementById('hub-state').textContent`)));
    b.ws.terminate();
  }

  // ═══ C. solo
  {
    const w = await entre('Wen', 'p_recapw3');
    const code = w.last().code;
    await partie(w, [], 'precision', { Wen: 1 });
    await w.fermer();
    await reprend(W, 'p_recapw3', 'Wen', code);
    await W.until(`!document.getElementById('hub-round').hidden`, 5000, 'carte résultat solo');
    const rs = await W.eval(ROUND);
    t('solo — carte : une ligne, sans rang ni vainqueur, « Partie terminée · +10 pts », Tirage suivant', rs.solo && rs.lignes.length === 1 && !rs.lignes[0].rangVu && rs.moi === 'Partie terminée · +10 pts' && rs.tirerIci, JSON.stringify(rs));
    await W.size(390, 780); await sleep(200);
    const gs = await W.eval(GEOM_ROUND);
    t('solo — 390 px : carte sans débordement', !gs.deborde.length && !gs.chev.length && !gs.coupe.length && !gs.scrollX, JSON.stringify(gs));
    if (SHOTS) await W.shot('round-solo-390', '#hub-round');
    await W.size(1280, 900); await sleep(300);   // un clic juste après 390 → 1280 px peut se perdre
    await W.click('#hub-leave');
    await W.until(recapVu, 5000, 'débrief solo');
    const v = await W.eval(LIRE);
    t('solo — une ligne : toi, 🥇, 10 pts', same(v.rang.map((l) => [l.id, l.pts, l.medaille, l.moi]), [['p_recapw3', 10, '🥇', true]]), JSON.stringify(v.rang));
    t('solo — pas de colonne « vainqueur » (ce serait toi), ta place 🥇 +10', v.jeux.length === 1 && !v.jeux[0].winVu && v.jeux[0].me === '🥇' && v.jeux[0].pts === '+10');
    t('solo — pas de phrase « la session continue pour les autres »', !/continue pour les autres/.test(await W.eval(`document.getElementById('recap-sub').textContent`)));
    await W.size(390, 780); await sleep(200);
    const g = await W.eval(GEOM);
    t('solo — 390 px : rien ne déborde', !g.deborde.length && !g.chev.length && !g.coupe.length && !g.scrollX, JSON.stringify(g));
    if (SHOTS) await W.shot('recap-solo-390', '#hub-recap');
    await W.size(1280, 900);
  }

  // ═══ D. un rechargement après le départ : pas de débrief recréé
  await W.goto(PAGE);
  await sleep(500);
  t('rechargement après le départ : ni session reprise, ni débrief recréé', !(await W.eval(recapVu)) && !(await W.eval(`!document.getElementById('lobby').hidden`)));

  t('aucune erreur JS', W.erreurs.length === 0, W.erreurs.slice(0, 3).join(' | '));
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
