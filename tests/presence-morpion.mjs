// Présence du joueur — le Morpion, dans de VRAIS navigateurs.
//
//   node tests/presence-morpion.mjs
//   node tests/presence-morpion.mjs --production     vraies valeurs (10 s / 30 s), ~5 min
//
// Le Morpion ferme sa room dès qu'un joueur part, et n'a ni pseudo ni avatar.
// La présence n'y change rien : elle retire un joueur GELÉ (onglet en veille,
// écran verrouillé) comme s'il était parti. Ce qui est vérifié, avec le vrai
// morpion-server et Edge SANS les options qui masquaient le gel :
//   1. X gelé pendant qu'il attend → sa room est fermée (B ne peut plus y
//      entrer) ; au réveil, X voit « connexion perdue », pas l'attente
//      d'avant, et rien n'est relancé tout seul ; « Créer une nouvelle partie »
//      repart proprement ;
//   2. deux joueurs actifs mais silencieux restent ;
//   3. O gelé en pleine partie → X prévenu (« ton adversaire est parti ») ;
//      au réveil, O voit que la partie s'est arrêtée, sans reconnexion ;
//   4. coupure réseau franche (proxy TCP en trou noir) : la page le détecte
//      seule ; son ancien code ne se rejoint plus — impossible de jouer
//      contre son propre fantôme (le remplacement ferme l'ancienne connexion) ;
//   5. une partie complète se joue normalement.
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const EDGE = arg('--edge') || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PROD = process.argv.includes('--production');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = () => Math.floor(Math.random() * 300);
const PORT = 9000 + R(), PROXY_PORT = 9400 + R(), HTTP_PORT = 8700 + R(), CDP_PORT = 9700 + R();
const PRESENCE_MS = PROD ? 10000 : 1000, ABSENCE_MS = PROD ? 30000 : 3000, KILL_MS = PROD ? 3000 : 1000;
const RETRAIT_MS = ABSENCE_MS + PRESENCE_MS + KILL_MS + 2000;
const SILENCE_MS = ABSENCE_MS + 2 * PRESENCE_MS;

let out = [], ko = 0;
const t = (nom, ok, detail = '') => {
  out.push(`${ok ? 'OK  ' : 'KO  '} ${nom}${detail ? ' — ' + detail : ''}`);
  if (!ok) ko++;
  console.log(out[out.length - 1]);
};

// Le vrai serveur : ses DÉFAUTS en --production, des délais courts sinon.
const srv = spawn(process.execPath, ['src/server.js'], { cwd: arg('--morpion') || path.join(ROOT, '..', 'morpion-server'),
  env: { ...process.env, PORT: String(PORT), PRESENCE_QUIET: '1', ...(PROD ? {} : { PRESENCE_MS: String(PRESENCE_MS), ABSENCE_MS: String(ABSENCE_MS), NATIVE_PING_MS: '2000', PRESENCE_KILL_MS: String(KILL_MS) }) }, stdio: 'ignore' });

// Proxy TCP : couper() fige les connexions EXISTANTES, les nouvelles passent.
const tuyaux = [];
const proxy = net.createServer((client) => {
  const amont = net.connect(PORT, '127.0.0.1');
  const x = { client, amont, coupe: false };
  client.on('data', (d) => { if (!x.coupe) amont.write(d); });
  amont.on('data', (d) => { if (!x.coupe) client.write(d); });
  const fin = () => { client.destroy(); amont.destroy(); };
  client.on('error', fin); amont.on('error', fin);
  client.on('close', () => { if (!x.coupe) amont.destroy(); });
  amont.on('close', () => { if (!x.coupe) client.destroy(); });
  tuyaux.push(x);
});
await new Promise((r) => proxy.listen(PROXY_PORT, '127.0.0.1', r));
const couper = () => { for (const x of tuyaux) x.coupe = true; };

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json' };
const http = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const full = path.join(ROOT, p);
  if (!full.startsWith(ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
  res.end(fs.readFileSync(full));
});
await new Promise((r) => http.listen(HTTP_PORT, '127.0.0.1', r));

let cdp = null;
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
const joueurs = [];
async function joueur(nom) {
  const { result: { browserContextId } } = await cdp.send('Target.createBrowserContext', { disposeOnDetach: true });
  const { result: { targetId } } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { result: { sessionId } } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const J = { nom, erreurs: [], recu: [], envoye: [] };
  joueurs.push(J);
  cdp.on(sessionId, (m) => {
    if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails; J.erreurs.push((d.exception?.description || d.text || '').split('\n')[0]); }
    if (m.method === 'Network.webSocketFrameReceived') { try { J.recu.push(JSON.parse(m.params.response.payloadData)); } catch (_) {} }
    if (m.method === 'Network.webSocketFrameSent') { try { J.envoye.push(JSON.parse(m.params.response.payloadData)); } catch (_) {} }
  });
  const S = (m, p) => cdp.send(m, p, sessionId);
  await S('Runtime.enable'); await S('Page.enable'); await S('Network.enable');
  await S('Emulation.setDeviceMetricsOverride', { width: 1100, height: 1000, deviceScaleFactor: 1, mobile: false });
  J.eval = async (expression) => {
    const r = await S('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(`[${nom}] ` + (r.result.exceptionDetails.exception?.description || 'erreur JS').split('\n')[0]);
    return r.result?.result?.value;
  };
  J.until = async (expr, ms = 10000, label = expr) => {
    const fin = Date.now() + ms;
    while (Date.now() < fin) { try { const v = await J.eval(expr); if (v) return v; } catch (_) {} await sleep(60); }
    throw new Error(`[${nom}] attente expirée : ${label}`);
  };
  J.goto = async (url) => { await S('Page.navigate', { url }); await J.until(`document.readyState === 'complete' && typeof NET === 'object'`, 15000, 'chargement'); };
  J.click = async (sel) => {
    const b = await J.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = e.getBoundingClientRect(); return r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; })()`);
    if (!b) throw new Error(`[${nom}] introuvable ou invisible : ${sel}`);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await S('Input.dispatchMouseEvent', { type, x: b.x, y: b.y, button: 'left', clickCount: 1 });
    await sleep(80);
  };
  J.type = async (sel, text) => { await J.click(sel); await J.eval(`document.querySelector(${JSON.stringify(sel)}).select()`); await S('Input.insertText', { text }); await sleep(60); };
  J.gel = () => S('Page.setWebLifecycleState', { state: 'frozen' });
  J.reveil = () => S('Page.setWebLifecycleState', { state: 'active' });
  J.ecran = () => J.eval(`['home', 'game', 'lost'].filter((id) => !document.getElementById(id).hidden).join(',')`);
  J.etat = () => [...J.recu].reverse().find((m) => m.type === 'state') || null;
  J.code = () => J.eval(`document.getElementById('room-code').textContent.trim()`);
  return J;
}
const joins = (J, depuis) => J.envoye.slice(depuis).filter((m) => m.action === 'join').length;

let edge = null, dir = null;
try {
  for (let i = 0; i < 100; i++) { try { await fetch(`http://127.0.0.1:${PORT}/`); break; } catch (_) { await sleep(100); } }
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'presence-morpion-'));
  // ⚠️ Aucune option --disable-* de ralentissement ou de cache.
  edge = spawn(EDGE, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${dir}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  cdp = await cdpBrowser();
  const BASE = `http://127.0.0.1:${HTTP_PORT}/games/morpion/`;
  const DIRECT = `${BASE}?server=${encodeURIComponent(`ws://127.0.0.1:${PORT}`)}`;
  console.log(`Présence — Morpion (${PROD ? 'VALEURS DE PRODUCTION, défauts du serveur' : 'délais courts'} : présence ${PRESENCE_MS} ms, absent après ${ABSENCE_MS} ms), Edge sans options de contournement\n`);
  const A = await joueur('A'), B = await joueur('B');
  for (const J of [A, B]) await J.goto(DIRECT);

  // ═══ 1. X gelé pendant qu'il attend un adversaire
  await A.click('#host');
  await A.until(`!document.getElementById('game').hidden && /^[A-Z2-9]{4}$/.test(document.getElementById('room-code').textContent.trim())`, 10000, 'A attend');
  const code1 = await A.code();
  t('A crée une partie et attend (le join ne porte ni pseudo ni avatar)', A.envoye.find((m) => m.action === 'join') && Object.keys(A.envoye.find((m) => m.action === 'join')).join() === 'action', code1);
  await A.gel();
  await sleep(RETRAIT_MS);
  await B.type('#code-input', code1);
  await B.click('#join');
  await B.until(`/introuvable/.test(document.getElementById('error').textContent)`, 5000, 'refus du code fantôme');
  t('A gelé : sa room en attente est fermée — B ne peut plus y entrer (« room introuvable »)', await B.eval(`document.getElementById('game').hidden`));
  const jA = A.envoye.length;
  await A.reveil();
  await A.until(`!document.getElementById('lost').hidden`, 8000, 'écran de perte chez A');
  await sleep(1500);
  const sA = await A.eval(`({ ecran: ['home', 'game', 'lost'].filter((id) => !document.getElementById(id).hidden).join(','), texte: document.getElementById('lost-text').textContent })`);
  t('réveil de A : « connexion perdue », l\'attente d\'avant n\'est PLUS affichée', sA.ecran === 'lost' && /partie en attente/.test(sA.texte) && sA.texte.includes(code1), sA.texte);
  t('… et rien n\'est relancé tout seul (aucun join envoyé)', joins(A, jA) === 0);
  await A.click('#lost-new');
  await A.until(`!document.getElementById('game').hidden && document.getElementById('room-code').textContent.trim() !== ${JSON.stringify(code1)}`, 8000, 'nouvelle partie');
  const code2 = await A.code();
  t('« Créer une nouvelle partie » : nouveau code, A attend de nouveau', /^[A-Z2-9]{4}$/.test(code2) && code2 !== code1, `${code1} → ${code2}`);

  // ═══ 2. deux joueurs actifs mais silencieux restent
  await B.type('#code-input', code2);
  await B.click('#join');
  await A.until(`/à toi de jouer/.test(document.getElementById('status').textContent)`, 8000, 'partie lancée');
  await sleep(SILENCE_MS);
  const e2 = [A.etat(), B.etat()];
  t(`A et B en partie, silencieux ${SILENCE_MS / 1000} s : toujours là, aucune erreur`,
    e2.every((e) => e && e.status === 'playing') && (await A.eval(`document.getElementById('error').textContent`)) === '' && (await B.ecran()) === 'game');

  // ═══ 3. O gelé en pleine partie
  await A.click('#board .cell:nth-child(5)');
  await B.until(`/à toi de jouer/.test(document.getElementById('status').textContent)`, 5000, 'tour de B');
  await B.gel();
  const t3 = Date.now();
  await A.until(`/adversaire est parti/.test(document.getElementById('error').textContent)`, RETRAIT_MS, 'A prévenu');
  t(`B gelé en pleine partie : retiré, A est prévenu (« ton adversaire est parti ») en ${((Date.now() - t3) / 1000).toFixed(1)} s`, true);
  const jB = B.envoye.length;
  await B.reveil();
  await B.until(`!document.getElementById('lost').hidden`, 8000, 'écran de perte chez B');
  await sleep(1500);
  const sB = await B.eval(`({ ecran: ['home', 'game', 'lost'].filter((id) => !document.getElementById(id).hidden).join(','), texte: document.getElementById('lost-text').textContent })`);
  t('réveil de B : « la partie s\'arrête là », plus de plateau, aucune reconnexion', sB.ecran === 'lost' && /pendant la partie/.test(sB.texte) && joins(B, jB) === 0, sB.texte);
  await B.click('#lost-home');
  t('« Retour à l\'accueil » : l\'accueil, prêt à créer ou rejoindre', (await B.ecran()) === 'home');

  // ═══ 4. coupure réseau franche : pas de partie contre son propre fantôme
  const C = await joueur('C');
  await C.goto(`${BASE}?server=${encodeURIComponent(`ws://127.0.0.1:${PROXY_PORT}`)}`);
  await C.click('#host');
  await C.until(`!document.getElementById('game').hidden && /^[A-Z2-9]{4}$/.test(document.getElementById('room-code').textContent.trim())`, 10000, 'C attend');
  const codeC = await C.code();
  await sleep(2 * PRESENCE_MS + 500);                          // le chien de garde s'arme (2 pings périodiques)
  couper();
  await C.until(`!document.getElementById('lost').hidden`, RETRAIT_MS + 2000, 'C détecte la coupure');
  t('coupure franche : la page de C le détecte seule (aucune fermeture ne lui parvient) et le dit', /partie en attente/.test(await C.eval(`document.getElementById('lost-text').textContent`)));
  await C.click('#lost-home');
  const mC = C.recu.length;
  await C.type('#code-input', codeC);
  await C.click('#join');
  await C.until(`/introuvable/.test(document.getElementById('error').textContent) || !document.getElementById('game').hidden`, 8000, 'réponse au join');
  const contreSoi = C.recu.slice(mC).some((m) => m.type === 'state' && m.status === 'playing');
  const remp = C.envoye.find((m) => m.action === 'presence' && m.remplace);
  t('C tente son ancien code : « room introuvable » — l\'ancienne connexion a été remplacée, pas de partie contre son fantôme',
    !contreSoi && /introuvable/.test(await C.eval(`document.getElementById('error').textContent`)) && !!remp);

  // ═══ 5. une partie complète, présence active
  const D = await joueur('D'), E = await joueur('E');
  for (const J of [D, E]) await J.goto(DIRECT);
  await D.click('#host');
  await D.until(`/^[A-Z2-9]{4}$/.test(document.getElementById('room-code').textContent.trim())`, 8000, 'D attend');
  await E.type('#code-input', await D.code());
  await E.click('#join');
  for (const [J, i] of [[D, 1], [E, 4], [D, 2], [E, 5], [D, 3]]) {
    await J.until(`/à toi de jouer/.test(document.getElementById('status').textContent)`, 5000, `tour de ${J.nom}`);
    await J.click(`#board .cell:nth-child(${i})`);
  }
  await D.until(`/gagné/.test(document.getElementById('status').textContent)`, 5000, 'victoire');
  t('une partie complète : X gagne sur la première ligne, O voit la défaite', /perdu/.test(await E.eval(`document.getElementById('status').textContent`)));

  const errs = joueurs.flatMap((J) => J.erreurs.map((e) => `[${J.nom}] ${e}`));
  t('aucune erreur JS', errs.length === 0, errs.slice(0, 3).join(' | '));
} catch (e) {
  t('EXCEPTION', false, e.message);
  for (const J of joueurs) console.log(`     [${J.nom}] ${await J.eval(`location.href + ' ' + ['home', 'game', 'lost'].filter((id) => !document.getElementById(id).hidden).join(',') + ' | ' + document.getElementById('error').textContent + ' | ' + document.getElementById('lost-text').textContent`).catch((x) => x.message)}`);
} finally {
  if (edge) { try { execFileSync('taskkill', ['/PID', String(edge.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (_) { try { edge.kill(); } catch (__) {} } }
  try { cdp && cdp.close(); } catch (_) {}
  srv.kill(); http.close();
  try { proxy.close(); tuyaux.forEach((x) => { x.client.destroy(); x.amont.destroy(); }); } catch (_) {}
  if (dir) try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}
console.log(`\n${ko ? 'DES TESTS ÉCHOUENT' : 'TOUT PASSE'} — ${out.length} vérifications, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
