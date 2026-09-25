// Présence du joueur — les jeux du lot 1, dans de VRAIS navigateurs, en jeu
// direct (sans le Game Hub : ses tests de handoff couvrent l'autre chemin).
//
//   node tests/presence-jeux.mjs
//   node tests/presence-jeux.mjs --only ban
//
// Pour chaque jeu, le vrai serveur (dépôt voisin, délais courts : présence 1 s,
// absent après 3 s) et trois joueurs A (hôte), B, C :
//   1. B gelé au salon → le serveur le retire, A le voit ; B se réveille →
//      « connexion perdue » puis retour dans LA room, sans doublon ;
//   2. A lance → les trois quittent le salon : le jeu direct fonctionne ;
//   3. C gelé en pleine partie → au réveil, « elle a continué sans toi »,
//      aucune tentative de reprise.
//
// ⚠️ AUCUNE des options d'Edge qui masquaient le gel (voir
// presence-precision.mjs, qui couvre en détail le pilote Précision).
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const EDGE = arg('--edge') || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const ONLY = arg('--only');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = () => Math.floor(Math.random() * 300);
const HTTP_PORT = 8700 + R(), CDP_PORT = 9700 + R();
const PRESENCE_MS = 1000, ABSENCE_MS = 3000;
const RETRAIT_MS = ABSENCE_MS + PRESENCE_MS + 1000 + 2000;
const PRESENCE_ENV = { PRESENCE_MS: String(PRESENCE_MS), ABSENCE_MS: String(ABSENCE_MS), NATIVE_PING_MS: '2000', PRESENCE_KILL_MS: '1000', PRESENCE_QUIET: '1' };

const JEUX = {
  demicercle: { repo: 'demicercle-server', main: 'src/server.js', env: {} },
  imitation: { repo: 'imitation-server', main: 'src/server.js', env: { VIDEOS_URL: '', RECORD_GRACE_MS: '300', ROUNDS: '1' } },
  ban: { repo: 'ban-server', main: 'src/server.js', env: { VIDEOS_JSON: '[{"id":"v","fatal":1.0,"startAt":0}]', TURN_SAFETY_MS: '800' }, case: '#tw-check' },
  passeur: { repo: 'passeur-server', main: 'server.js', env: {} },
  quiment: { repo: 'qui-ment-server', main: 'server.js', env: {} },
};

let out = [], ko = 0;
const t = (nom, ok, detail = '') => {
  out.push(`${ok ? 'OK  ' : 'KO  '} ${nom}${detail ? ' — ' + detail : ''}`);
  if (!ok) ko++;
  console.log(out[out.length - 1]);
};

// Le salon, dans les deux dialectes des serveurs : `room` (players, you) ou `lobby` (players) + `you` (id).
const estSalon = (m) => (m.type === 'room' || m.type === 'lobby') && Array.isArray(m.players);
const moiDe = (J) => { const m = [...J.recu].reverse().find((x) => (x.type === 'room' && x.you) || x.type === 'you'); return m ? (m.you || m.id) : null; };

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json' };
function serve() {
  const s = createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const full = path.join(ROOT, p);
    if (!full.startsWith(ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
    res.end(fs.readFileSync(full));
  });
  return new Promise((r) => s.listen(HTTP_PORT, '127.0.0.1', () => r(s)));
}

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

async function joueur(nom) {
  const { result: { browserContextId } } = await cdp.send('Target.createBrowserContext', { disposeOnDetach: true });
  const { result: { targetId } } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { result: { sessionId } } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const J = { nom, erreurs: [], recu: [], envoye: [], contexte: browserContextId };
  cdp.on(sessionId, (m) => {
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      J.erreurs.push((d.exception?.description || d.text || '').split('\n')[0]);
    }
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
  J.ecran = () => J.eval(`[...document.querySelectorAll('main > section')].filter((s) => !s.hidden).map((s) => s.id).join(',')`);
  J.nb = () => J.eval(`document.querySelectorAll('#players li').length`);
  J.fermer = () => cdp.send('Target.disposeBrowserContext', { browserContextId: browserContextId });
  return J;
}

const joins = (J, depuis) => J.envoye.slice(depuis).filter((m) => m.action === 'join').length;

async function unJeu(jeu, cfg) {
  console.log(`\n— ${jeu} —`);
  const port = 9000 + R();
  const srv = spawn(process.execPath, [cfg.main], { cwd: path.join(ROOT, '..', cfg.repo), env: { ...process.env, PORT: String(port), ...PRESENCE_ENV, ...cfg.env }, stdio: 'ignore' });
  const joueursJeu = [];
  try {
    for (let i = 0; i < 100; i++) { try { await fetch(`http://127.0.0.1:${port}/`); break; } catch (_) { await sleep(100); } }
    const PAGE = `http://127.0.0.1:${HTTP_PORT}/games/${jeu}/?server=${encodeURIComponent(`ws://127.0.0.1:${port}`)}&cdn=${encodeURIComponent(`http://127.0.0.1:${HTTP_PORT}/cdn-test`)}`;
    const A = await joueur(`${jeu}/A`), B = await joueur(`${jeu}/B`), C = await joueur(`${jeu}/C`);
    joueursJeu.push(A, B, C);
    for (const [J, nom] of [[A, 'Alice'], [B, 'Bruno'], [C, 'Chloé']]) {
      await J.goto(PAGE);
      if (cfg.case) await J.click(cfg.case);
      await J.type('#name-input', nom);
    }
    await A.click('#host');
    await A.until(`!document.getElementById('lobby').hidden && /^[A-Z2-9]{4}$/.test(document.getElementById('room-code').textContent.trim())`, 15000, 'salon de A');
    const code = (await A.eval(`document.getElementById('room-code').textContent`)).trim();
    for (const J of [B, C]) { await J.type('#code-input', code); await J.click('#join'); }
    await A.until(`document.querySelectorAll('#players li').length === 3`, 10000, '3 joueurs');
    t(`${jeu} : A crée, B et C rejoignent — salon à 3`, true, code);

    // ── 1. B gelé au salon
    const ancienB = moiDe(B);
    const mA = A.recu.length;
    await B.gel();
    const t0 = Date.now();
    await A.until(`document.querySelectorAll('#players li').length === 2`, RETRAIT_MS, 'A voit B retiré');
    t(`${jeu} : B gelé → retiré par le serveur, A le voit en ${((Date.now() - t0) / 1000).toFixed(1)} s`, true);
    const jB = B.envoye.length;
    await B.reveil();
    await B.until(`!document.getElementById('lobby').hidden && document.querySelectorAll('#players li').length === 3 && NET.connected()`, 10000, 'B de retour');
    await A.until(`document.querySelectorAll('#players li').length === 3`, 5000, 'A voit B revenu');
    const nouveauB = moiDe(B);
    const doublon = A.recu.slice(mA).some((m) => estSalon(m) && m.players.some((p) => p.id === ancienB) && m.players.some((p) => p.id === nouveauB));
    t(`${jeu} : réveil de B → retour dans LA room par un seul join, aucun doublon chez A`,
      joins(B, jB) === 1 && B.envoye.slice(jB).find((m) => m.action === 'join').code === code && !doublon && ancienB !== nouveauB, `${ancienB} → ${nouveauB}`);

    // ── 2. A lance : le jeu direct fonctionne
    await A.until(`!document.getElementById('start').disabled`, 8000, 'Lancer actif');
    await A.click('#start');
    for (const J of [A, B, C]) await J.until(`(() => { const v = [...document.querySelectorAll('main > section')].filter((s) => !s.hidden).map((s) => s.id); return v.length && !v.some((id) => ['home', 'lobby', 'lost'].includes(id)); })()`, 15000, `${J.nom} en partie`);
    t(`${jeu} : A lance → les trois joueurs sont en partie (${await B.ecran()})`, true);

    // ── 3. C gelé en pleine partie
    await C.gel();
    await sleep(RETRAIT_MS);
    const jC = C.envoye.length;
    await C.reveil();
    await C.until(`!document.getElementById('lost').hidden`, 8000, 'écran de perte chez C');
    await sleep(800);
    const s = await C.eval(`({ texte: document.getElementById('lost-text').textContent, retry: !document.getElementById('lost-retry').hidden })`);
    t(`${jeu} : C gelé en pleine partie → « elle a continué sans toi », aucune tentative de reprise`, /continué sans toi/.test(s.texte) && s.retry && joins(C, jC) === 0, s.texte.slice(0, 60));

    const errs = [A, B, C].flatMap((J) => J.erreurs.map((e) => `[${J.nom}] ${e}`));
    t(`${jeu} : aucune erreur JS`, errs.length === 0, errs.slice(0, 3).join(' | '));
  } catch (e) {
    t(`${jeu} : EXCEPTION`, false, e.message);
    for (const J of joueursJeu) console.log(`     [${J.nom}] ${await J.eval(`location.href + ' ' + [...document.querySelectorAll('main > section')].filter((s) => !s.hidden).map((s) => s.id).join(',') + ' | ' + ((document.getElementById('error') || {}).textContent || '')`).catch((x) => x.message)}`);
  } finally {
    for (const J of joueursJeu) { try { await J.fermer(); } catch (_) {} }
    srv.kill();
  }
}

let edge = null, http = null, dir = null;
try {
  http = await serve();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'presence-jeux-'));
  // ⚠️ Aucune option --disable-* de ralentissement ou de cache. Micro factice
  // pour Imitation (sinon getUserMedia attend une autorisation).
  edge = spawn(EDGE, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${dir}`, '--no-first-run',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', 'about:blank'], { stdio: 'ignore' });
  cdp = await cdpBrowser();
  console.log(`Présence — jeux du lot 1 (présence ${PRESENCE_MS} ms, absent après ${ABSENCE_MS} ms), jeu direct, Edge sans options de contournement`);
  for (const [jeu, cfg] of Object.entries(JEUX)) if (!ONLY || ONLY === jeu) await unJeu(jeu, cfg);
} catch (e) {
  t('EXCEPTION', false, e.message);
} finally {
  if (edge) { try { execFileSync('taskkill', ['/PID', String(edge.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (_) { try { edge.kill(); } catch (__) {} } }
  try { cdp && cdp.close(); } catch (_) {}
  try { http && http.close(); } catch (_) {}
  if (dir) try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}
console.log(`\n${ko ? 'DES TESTS ÉCHOUENT' : 'TOUT PASSE'} — ${out.length} vérifications, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
