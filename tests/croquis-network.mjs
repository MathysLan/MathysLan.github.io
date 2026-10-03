// Croquis — le dessin SYNCHRONISÉ, dans de vrais navigateurs, contre le VRAI
// croquis-server (lancé par ce test, délais raccourcis par ses variables TEST_*).
//
//   node tests/croquis-network.mjs
//   node tests/croquis-network.mjs --shots <dossier>
//   node tests/croquis-network.mjs --serveur C:\perso\croquis-server
//
// Deux onglets Edge — un bureau (1100 px, souris) et un téléphone (390 px,
// doigt) — et des robots WebSocket. Le dessin passe par de VRAIES entrées
// (protocole DevTools) ; ce qui arrive chez l'autre est comparé trait pour
// trait (modèle) et au pixel (feuille). Un espion relève ce que chaque onglet
// envoie et reçoit sur son WebSocket.
//   salon à 2, room annoncée ; dessin → l'autre reçoit tout ; le dessinateur ne
//   reçoit pas ses traits ; undo, clear ; snapshot qui reconstruit ; resize et
//   rotation chez celui qui regarde ; ancien turnId ignoré ; un spectateur ne
//   dessine pas (au doigt, ni par le protocole) ; traits invalides refusés ;
//   aucune fuite du mot ; changement de tour (la feuille repart de zéro, l'autre
//   dessine à son tour, au doigt) ; puis 16 clients, et plusieurs qui essaient
//   de dessiner en même temps.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const EDGE = arg('--edge') || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
// Le dépôt du serveur : à côté de ce dépôt, sinon C:\perso (l'autre poste).
const VOISIN = path.resolve(ROOT, '..', 'croquis-server');
const SERVEUR = arg('--serveur') || (existsSync(path.join(VOISIN, 'server.js')) ? VOISIN : 'C:\\perso\\croquis-server');
const SHOTS = arg('--shots');
const CDP_PORT = 9400 + Math.floor(Math.random() * 400);
const PORT = 8700 + Math.floor(Math.random() * 200);
const WS = `ws://127.0.0.1:${PORT}`;
const PAGE = 'file:///' + path.join(ROOT, 'games', 'croquis', 'index.html').replace(/\\/g, '/') + `?server=${encodeURIComponent(WS)}`;
const D = createRequire(import.meta.url)('../games/croquis/dessin.js');

let ok = 0, ko = 0;
const t = (name, cond, detail) => {
  if (cond) { ok++; console.log('OK   ' + name); }
  else { ko++; console.log('KO   ' + name + (detail ? ' — ' + detail : '')); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

// ------------------------------------------------------------ le vrai serveur
// Dessin long (2 min) : les tours se terminent quand les devineurs trouvent.
const srv = spawn(process.execPath, [path.join(SERVEUR, 'server.js')], {
  cwd: SERVEUR,
  env: { ...process.env, PORT: String(PORT), TEST_CHOOSE_MS: '800', TEST_DRAW_MS: '120000', TEST_PAUSE_MS: '100', TEST_REVEAL_MS: '300', PRESENCE_QUIET: '1' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((res) => srv.stdout.on('data', (d) => { if (/écoute/.test(String(d))) res(); }));

// ------------------------------------------------------------------ robots
const robots = [];
function robot(nom, code) {
  const ws = new WebSocket(WS);
  const b = { nom, ws, id: null, msgs: [], refus: null };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    b.msgs.push(m);
    if (m.type === 'presence' && !m.remplace) ws.send(JSON.stringify({ action: 'presence', n: m.n }));
    if (m.type === 'you') b.id = m.id;
    if (m.type === 'error') b.refus = m.message;
  };
  ws.onopen = () => ws.send(JSON.stringify({ action: 'join', name: nom, code, avatar: { kind: 'emoji', emoji: '🤖' } }));
  b.send = (o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
  robots.push(b);
  return b;
}

// ------------------------------------------------------------- Edge + CDP
async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('CDP injoignable')); });
  let id = 0;
  const waiting = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } };
  return { send(method, params = {}) { const mid = ++id; ws.send(JSON.stringify({ id: mid, method, params })); return new Promise((res) => waiting.set(mid, res)); } };
}
const profil = mkdtempSync(path.join(tmpdir(), 'croquis-network-'));
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--allow-file-access-from-files',
  `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profil}`, '--window-size=1100,900', 'about:blank'], { stdio: 'ignore' });
function fin() {
  try { edge.kill(); } catch (_) {}
  if (process.platform === 'win32' && edge.pid) { try { spawn('taskkill', ['/PID', String(edge.pid), '/T', '/F'], { stdio: 'ignore', detached: true }).unref(); } catch (_) {} }
  try { srv.kill(); } catch (_) {}
  robots.forEach((b) => { try { b.ws.close(); } catch (_) {} });
}
process.on('exit', fin);
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { fin(); process.exit(130); });
async function json(p) { for (let i = 0; i < 80; i++) { try { return await (await fetch(`http://127.0.0.1:${CDP_PORT}${p}`)).json(); } catch (_) { await sleep(150); } } throw new Error('Edge muet'); }

// L'espion : tout ce qui passe sur le WebSocket du jeu.
const ESPION = `(() => {
  window.__recu = []; window.__envoye = [];
  const W = window.WebSocket;
  window.WebSocket = function (u, p) {
    const ws = p ? new W(u, p) : new W(u);
    ws.addEventListener('message', (e) => { try { const m = JSON.parse(e.data); if (m.type !== 'presence') window.__recu.push(m); } catch (_) {} });
    const s = ws.send.bind(ws);
    ws.send = (d) => { try { const m = JSON.parse(d); if (m.action !== 'presence') window.__envoye.push(m); } catch (_) {} return s(d); };
    return ws;
  };
  window.WebSocket.prototype = W.prototype; Object.assign(window.WebSocket, { OPEN: 1, CLOSED: 3, CONNECTING: 0, CLOSING: 2 });
})();`;

async function onglet(nom, { w, h, mobile }) {
  let cible;
  if (nom === 'A') cible = (await json('/json/list')).find((x) => x.type === 'page');
  else { const v = await json('/json/version'); const b = await connect(v.webSocketDebuggerUrl); const r = await b.send('Target.createTarget', { url: 'about:blank' }); cible = (await json('/json/list')).find((x) => x.id === r.result.targetId); }
  const c = await connect(cible.webSocketDebuggerUrl);
  await c.send('Page.enable');
  await c.send('Runtime.enable');
  await c.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: ESPION });
  const p = {
    nom, c, mobile,
    async metrics(W, H) {
      await c.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: mobile ? 2 : 1, mobile: !!mobile });
      await c.send('Emulation.setTouchEmulationEnabled', { enabled: !!mobile, maxTouchPoints: mobile ? 5 : 0 });
    },
    async ev(expr) {
      const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.result && r.result.exceptionDetails) throw new Error(nom + ' : ' + ((r.result.exceptionDetails.exception || {}).description || 'eval'));
      return r.result && r.result.result ? r.result.result.value : undefined;
    },
    async until(expr, ms = 8000) { const f = Date.now() + ms; while (Date.now() < f) { if (await p.ev(expr)) return true; await sleep(40); } return false; },
    async clic(sel) {
      const q = await p.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      if (mobile) {
        await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: q.x, y: q.y }] });
        await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } else {
        await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: q.x, y: q.y });
        await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: q.x, y: q.y, button: 'left', buttons: 1, clickCount: 1 });
        await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: q.x, y: q.y, button: 'left', buttons: 0, clickCount: 1 });
      }
      await sleep(40);
    },
    async taper(sel, texte) { await p.ev(`document.querySelector(${JSON.stringify(sel)}).focus()`); await c.send('Input.insertText', { text: texte }); },
    // Un geste sur la feuille, en fractions (fx, fy) : souris ou doigt selon l'onglet.
    async geste(fracs, { pas = 12 } = {}) {
      const r = await p.feuille();
      const pts = [];
      for (let i = 0; i < fracs.length - 1; i++) for (let k = 0; k < pas; k++) {
        const f = k / pas;
        pts.push({ x: r.left + (fracs[i][0] + (fracs[i + 1][0] - fracs[i][0]) * f) * r.width, y: r.top + (fracs[i][1] + (fracs[i + 1][1] - fracs[i][1]) * f) * r.height });
      }
      const z = fracs.at(-1);
      pts.push({ x: r.left + z[0] * r.width, y: r.top + z[1] * r.height });
      if (mobile) {
        await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pts[0].x, y: pts[0].y }] });
        for (const q of pts.slice(1)) await c.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: q.x, y: q.y }] });
        await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } else {
        await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pts[0].x, y: pts[0].y });
        await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pts[0].x, y: pts[0].y, button: 'left', buttons: 1, clickCount: 1 });
        for (const q of pts.slice(1)) await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: q.x, y: q.y, button: 'left', buttons: 1 });
        await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pts.at(-1).x, y: pts.at(-1).y, button: 'left', buttons: 0, clickCount: 1 });
      }
      await sleep(30);
    },
    feuille: () => p.ev(`(() => { const r = document.getElementById('vivant').getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`),
    traits: () => p.ev('JSON.stringify(window.__croquis.dessin.traits)'),
    ouvert: () => p.ev('!!window.__croquis.dessin.ouvert'),
    // La couleur de la feuille (couche des traits finis) à une fraction de la feuille.
    pixel: (fx, fy) => p.ev(`(() => { const b = document.getElementById('base');
      const bx = Math.min(b.width - 1, Math.floor(${fx} * b.width)), by = Math.min(b.height - 1, Math.floor(${fy} * b.height));
      const d = b.getContext('2d').getImageData(bx, by, 1, 1).data; return [d[0], d[1], d[2]]; })()`),
    recu: (type) => p.ev(`window.__recu.filter((m) => !${JSON.stringify(type || '')} || m.type === ${JSON.stringify(type || '')})`),
    envoye: (action) => p.ev(`window.__envoye.filter((m) => m.action === ${JSON.stringify(action)})`),
    // ⚠️ Une capture d'un onglet d'ARRIÈRE-PLAN attend une image qui ne vient
    // pas : elle a bloqué la suite plus d'une minute, le tour a expiré au
    // chrono et tout ce qui suivait tombait sur un tour fini (STALE_TURN). On
    // amène l'onglet devant, et une capture qui traîne est abandonnée.
    async shot(f) {
      if (!SHOTS) return;
      await c.send('Page.bringToFront');
      const r = await Promise.race([c.send('Page.captureScreenshot', { format: 'png' }), sleep(5000).then(() => null)]);
      if (r && r.result) writeFileSync(path.join(SHOTS, f + '.png'), Buffer.from(r.result.data, 'base64'));
      else console.log(`(capture ${f} abandonnée : trop lente)`);
    },
    async ouvrir() {
      await c.send('Page.navigate', { url: PAGE });
      await p.until('document.readyState === "complete" && !!window.__croquis && typeof NET === "object"');
    },
  };
  await p.metrics(w, h);
  return p;
}
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const proche = (px, hex, tol = 45) => px.every((v, i) => Math.abs(v - rgb(hex)[i]) <= tol);
// Le détail d'un échec : traits de chaque côté, ce que le dessinateur a envoyé,
// ses refus, ce que le spectateur a reçu en dernier.
const diag = async (Dn, Vu) => `D ${JSON.parse(await Dn.traits()).length} traits, V ${JSON.parse(await Vu.traits()).length} ; D envoie ${(await Dn.ev('JSON.stringify(window.__envoye.map((m) => m.action + (m.s ? m.s : "") + (m.end ? "e" : "")).slice(-14))'))} ; D refus ${JSON.stringify((await Dn.recu('refused')).map((m) => m.reason))} ; V reçoit ${(await Vu.ev('JSON.stringify(window.__recu.slice(-8).map((m) => m.type + (m.s || "")))'))}`;
const egaux = async (a, b, ms = 5000) => {
  const f = Date.now() + ms;
  let x, y;
  while (Date.now() < f) { x = await a.traits(); y = await b.traits(); if (x === y && !(await b.ouvert())) return true; await sleep(40); }
  return false;
};

const A = await onglet('A', { w: 1100, h: 800 });
const B = await onglet('B', { w: 390, h: 844, mobile: true });
await A.ouvrir();
await B.ouvrir();

// ======================================================= 1–2. salon à 2
await A.taper('#name-input', 'Alice');
await A.clic('#host');
await A.until('!document.getElementById("lobby").hidden && /^[A-Z]{4}$/.test(document.getElementById("room-code").textContent)');
const code = await A.ev('document.getElementById("room-code").textContent');
await B.taper('#name-input', 'Bruno');
await B.taper('#code-input', code);
await B.clic('#join');
await A.until('document.querySelectorAll("#players li").length === 2');
await B.until('document.querySelectorAll("#players li").length === 2');
const youA = (await A.recu('you'))[0], youB = (await B.recu('you'))[0];
t('[1] deux clients dans la même room', youA.code === code && youB.code === code && youA.host === true && youB.host === false);
const lob = (await B.recu('lobby')).at(-1);
t('[2] le serveur annonce la room : 2 joueurs, un hôte, les deux pseudos', lob.players.length === 2 && lob.players.filter((p) => p.host).length === 1
  && lob.players.map((p) => p.name).sort().join() === 'Alice,Bruno');
t('[2] l hôte voit « Lancer », l invité attend', await A.ev('!document.getElementById("host-config").hidden && !document.getElementById("start").disabled')
  && await B.ev('document.getElementById("host-config").hidden'));
await A.shot('salon-a');

// ================================================== lancement, 1er tour
await A.clic('#start');
await A.until('window.__recu.some((m) => m.type === "drawing")');
await B.until('window.__recu.some((m) => m.type === "drawing")');
const idDe = (p) => (p === A ? youA.id : youB.id);
const fuite = (msgs, m) => msgs.filter((x) => x.type !== 'turn-end').some((x) => JSON.stringify(x).toLowerCase().includes(m.toLowerCase()));

// LE SCÉNARIO DU DESSIN, joué deux fois : au tour 1, puis au tour 2 avec les
// rôles inversés. Le bureau (souris) et le téléphone (doigt) dessinent donc
// TOUS LES DEUX à chaque passage, quel que soit l'ordre tiré par le serveur.
async function scenario(Dn, Vu, turnId) {
  const tag = `[tour ${turnId}, ${Dn.nom === 'A' ? 'souris' : 'doigt'}]`;
  const debutV = (await Vu.recu()).findIndex((m) => m.type === 'turn' && m.turnId === turnId);
  const nSnapV = (await Vu.recu('snapshot')).length;
  const nSnapD = (await Dn.recu('snapshot')).length;
  const du = (l) => l.filter((m) => m.turnId === turnId);
  const mot = (await Dn.recu('drawing')).filter((m) => m.turnId === turnId)[0].word;
  t(`${tag} ${Dn.nom} dessine « ${mot} », ${Vu.nom} regarde (le mot ne part qu au dessinateur)`,
    !!mot && du(await Vu.recu('drawing'))[0].word === undefined);
  t(`${tag} dessinateur : outils visibles, son mot dans le bandeau`, await Dn.ev(`!document.getElementById('outils').hidden && document.getElementById('bandeau').textContent.includes(${JSON.stringify(mot)})`));
  t(`${tag} spectateur : pas d outils, « … dessine », jamais le mot à l écran`, await Vu.ev(`document.getElementById('outils').hidden && /dessine/.test(document.getElementById('bandeau').textContent) && !document.body.innerText.toLowerCase().includes(${JSON.stringify(mot.toLowerCase())})`));

  // ------------------------------------------------------- 3–5. dessin
  await Dn.geste([[0.1, 0.1], [0.9, 0.9]]);
  t(`[3] ${tag} dessin local immédiat : le trait est là dès le geste fini, avant tout retour serveur`, JSON.parse(await Dn.traits()).length === 1);
  t(`[4] ${tag} l autre reçoit le trait, à l identique (modèle)`, await egaux(Dn, Vu), await diag(Dn, Vu));
  t(`[4] ${tag} … et au pixel (la diagonale chez celui qui regarde)`, (await Promise.all([0.25, 0.5, 0.75].map((f) => Vu.pixel(f, f)))).every((px) => proche(px, D.PALETTE[0].hex)));
  await Dn.clic('.pastille[data-couleur="3"]');
  await Dn.clic('.taille[data-taille="2"]');
  await Dn.geste([[0.1, 0.5], [0.5, 0.45], [0.9, 0.5]], { pas: 20 });
  await Dn.clic('.pastille[data-couleur="6"]');
  await Dn.clic('.taille[data-taille="0"]');
  await Dn.geste([[0.2, 0.8], [0.2, 0.8]]);              // un simple point
  t(`[4] ${tag} trois traits (dont un point), couleurs et tailles du protocole, identiques chez l autre`, await egaux(Dn, Vu)
    && JSON.parse(await Vu.traits()).map((x) => `${x.c}/${x.w}`).join() === '0/1,3/2,6/0', await diag(Dn, Vu));
  const envoyes = du(await Dn.envoye('stroke'));
  t(`[4] ${tag} envoi par lots : ${envoyes.length} messages stroke, chacun ≤ 64 points, end sur le dernier lot de chaque trait`,
    envoyes.every((m) => m.p.length <= 128) && new Set(envoyes.filter((m) => m.end).map((m) => m.s)).size === 3);
  t(`[5] ${tag} le dessinateur ne reçoit AUCUN de ses traits`, du(await Dn.recu('stroke')).length === 0);
  t(`[4] ${tag} le spectateur a reçu des messages stroke (pas un snapshot)`, du(await Vu.recu('stroke')).length >= envoyes.length && (await Vu.recu('snapshot')).length === nSnapV);
  await Dn.shot(`t${turnId}-dessinateur`); await Vu.shot(`t${turnId}-spectateur`);

  // ------------------------------------------------------ 6–7. undo, clear
  await Dn.clic('#annuler');
  t(`[6] ${tag} undo répliqué : le point vert disparaît chez l autre`, await egaux(Dn, Vu) && JSON.parse(await Vu.traits()).length === 2
    && proche(await Vu.pixel(0.2, 0.8), D.FOND, 3), await diag(Dn, Vu));
  await Dn.clic('#effacer'); await Dn.clic('#effacer');
  t(`[7] ${tag} clear répliqué : feuille vide chez les deux`, await egaux(Dn, Vu) && JSON.parse(await Vu.traits()).length === 0
    && proche(await Vu.pixel(0.5, 0.5), D.FOND, 3) && proche(await Vu.pixel(0.25, 0.25), D.FOND, 3), await diag(Dn, Vu));

  // ------------------------------------------------------------ 8. snapshot
  await Dn.clic('.pastille[data-couleur="8"]');
  await Dn.clic('.taille[data-taille="1"]');
  await Dn.geste([[0.15, 0.3], [0.85, 0.3]]);
  await Dn.geste([[0.5, 0.1], [0.5, 0.9]]);
  t(`[8] ${tag} (deux traits bleus reçus)`, await egaux(Dn, Vu) && JSON.parse(await Vu.traits()).length === 2, await diag(Dn, Vu));
  // On abîme la feuille du spectateur (un trait perdu), puis on redemande l'état au serveur.
  await Vu.ev('window.__croquis.dessin.traits.pop(); window.__croquis.retracer(); true');
  await Vu.ev('NET.send({ action: "snapshot" })');
  t(`[8] ${tag} snapshot : la feuille abîmée est reconstruite EXACTEMENT (modèle)`, await egaux(Dn, Vu), await diag(Dn, Vu));
  t(`[8] ${tag} snapshot : … et au pixel (le trait perdu revient)`, proche(await Vu.pixel(0.5, 0.7), D.PALETTE[8].hex) && proche(await Vu.pixel(0.3, 0.3), D.PALETTE[8].hex));

  // ------------------------------------------ resize / rotation du spectateur
  const avantRot = await Vu.traits();
  await Vu.metrics(Vu.mobile ? 844 : 800, Vu.mobile ? 390 : 600);
  await sleep(300);
  t(`${tag} rotation / resize du spectateur : modèle inchangé, dessin aux mêmes fractions`, await Vu.traits() === avantRot
    && proche(await Vu.pixel(0.5, 0.7), D.PALETTE[8].hex) && proche(await Vu.pixel(0.3, 0.3), D.PALETTE[8].hex));
  await Vu.metrics(Vu.mobile ? 390 : 1100, Vu.mobile ? 844 : 800);
  await sleep(200);

  // ------------------------------------------------------- 10. ancien turnId
  const av10 = await Vu.traits();
  await Vu.ev(`NET.dispatch({ type: 'stroke', turnId: ${turnId - 1}, s: 999, c: 0, w: 0, p: [500, 375], end: true });
    NET.dispatch({ type: 'undo', turnId: ${turnId - 1}, s: 1 }); NET.dispatch({ type: 'clear', turnId: ${turnId - 1} }); true`);
  t(`[10] ${tag} stroke / undo / clear d un ancien turnId : ignorés`, await Vu.traits() === av10);

  // ---------------------------------------- 12–13. un spectateur ne dessine pas
  const envAvant = (await Vu.envoye('stroke')).length;
  await Vu.geste([[0.1, 0.9], [0.9, 0.1]]);
  t(`[12] ${tag} le spectateur essaie de dessiner (${Vu.nom === 'A' ? 'souris' : 'doigt'}) : rien localement, rien envoyé`, await Vu.traits() === av10 && (await Vu.envoye('stroke')).length === envAvant);
  const nRefusV = (await Vu.recu('refused')).length;
  await Vu.ev(`NET.send({ action: 'stroke', turnId: ${turnId}, s: 77, c: 0, w: 0, p: [10, 10], end: true }); true`);
  await Vu.until(`window.__recu.filter((m) => m.type === 'refused').length > ${nRefusV}`);
  t(`[13] ${tag} stroke forgé par le spectateur : refusé (NOT_DRAWER), le dessinateur n a rien`,
    (await Vu.recu('refused')).at(-1).reason === 'NOT_DRAWER' && (await Dn.traits()) === av10 && du(await Dn.recu('stroke')).length === 0);

  // -------------------------------------------- 14. traits invalides refusés
  const avant14 = await Dn.traits();
  const nRefus = (await Dn.recu('refused')).length;
  await Dn.ev(`NET.send({ action: 'stroke', turnId: ${turnId}, s: 500, c: 0, w: 0, p: [5000, 10], end: true });
    NET.send({ action: 'stroke', turnId: ${turnId}, s: 501, c: 13, w: 0, p: [10, 10], end: true });
    NET.send({ action: 'stroke', turnId: ${turnId}, s: 502, c: 0, w: 7, p: [10, 10], end: true }); true`);
  await Dn.until(`window.__recu.filter((m) => m.type === 'refused').length >= ${nRefus + 3}`);
  const refus14 = (await Dn.recu('refused')).slice(nRefus);
  t(`[14] ${tag} coordonnée hors cadre, couleur 13, taille 7 : refusés (BAD_STROKE)`, refus14.length === 3 && refus14.every((r) => r.reason === 'BAD_STROKE'));
  await Dn.until(`window.__recu.filter((m) => m.type === 'snapshot').length > ${nSnapD}`);
  await sleep(200);
  t(`[14] ${tag} le spectateur n a rien reçu de tout ça`, await Vu.traits() === avant14);
  t(`[14] ${tag} le dessinateur s est resynchronisé (snapshot), feuille inchangée`, await Dn.traits() === avant14);

  // ------------------------------------------------------- 15. aucune fuite
  t(`[15] ${tag} le mot (« ${mot} ») n est passé dans AUCUN message reçu par le spectateur`, !fuite((await Vu.recu()).slice(Math.max(0, debutV)), mot));
  t(`[15] ${tag} … ni dans le texte de sa page`, !(await Vu.ev(`document.body.innerText.toLowerCase().includes(${JSON.stringify(mot.toLowerCase())})`)));
  return mot;
}

const tour1 = (await A.recu('turn'))[0];
const D1 = tour1.drawer === youA.id ? A : B;
const V1 = D1 === A ? B : A;
const mot1 = await scenario(D1, V1, tour1.turnId);

// ============================== 9. changement de tour : les rôles s'inversent
await V1.ev(`NET.send({ action: 'guess', turnId: ${tour1.turnId}, text: ${JSON.stringify(mot1)} }); true`);
await A.until(`window.__recu.some((m) => m.type === 'drawing' && m.turnId === ${tour1.turnId + 1})`, 10000);
await B.until(`window.__recu.some((m) => m.type === 'drawing' && m.turnId === ${tour1.turnId + 1})`, 10000);
const tour2 = (await A.recu('turn')).at(-1);
t('[9] tour 2 : l autre joueur dessine', tour2.turnId === tour1.turnId + 1 && tour2.drawer === idDe(V1));
t('[9] nouveau tour : feuille VIDE chez les deux (modèle et pixel)', JSON.parse(await A.traits()).length === 0 && JSON.parse(await B.traits()).length === 0
  && proche(await A.pixel(0.5, 0.7), D.FOND, 3) && proche(await B.pixel(0.5, 0.7), D.FOND, 3));
t('[9] les outils changent de main', await V1.ev('!document.getElementById("outils").hidden') && await D1.ev('document.getElementById("outils").hidden'));
await scenario(V1, D1, tour2.turnId);
await D1.ev(`NET.dispatch({ type: 'stroke', turnId: ${tour1.turnId}, s: 4242, c: 0, w: 0, p: [1, 1], end: true }); true`);
t('[10] un trait du tour 1 arrivé en retard : ignoré au tour 2', await egaux(V1, D1) && !(await D1.traits()).includes('4242'));

// ====================================== 11–12. 16 clients, dessins simultanés
await A.ouvrir();
await B.ouvrir();
await A.clic('#host');
await A.until('/^[A-Z]{4}$/.test(document.getElementById("room-code").textContent)');
const code16 = await A.ev('document.getElementById("room-code").textContent');
await B.taper('#code-input', code16);
await B.clic('#join');
const bots = Array.from({ length: 14 }, (_, i) => robot('R' + (i + 1), code16));
await A.until('document.querySelectorAll("#players li").length === 16', 10000);
t('[11] 16 clients dans la room (2 navigateurs + 14 robots)', await B.until('document.querySelectorAll("#players li").length === 16')
  && bots.every((b) => !!b.id));
const dixSept = robot('R17', code16);
await sleep(400);
t('[11] le 17e est refusé', /complète/.test(dixSept.refus || ''));
await B.shot('salon-16');
await A.clic('#start');
await A.until('window.__recu.some((m) => m.type === "drawing")', 10000);
await B.until('window.__recu.some((m) => m.type === "drawing")', 10000);
const tr16 = (await A.recu('turn')).at(-1);
const youA2 = (await A.recu('you')).at(-1), youB2 = (await B.recu('you')).at(-1);
const parId = { [youA2.id]: A, [youB2.id]: B };
const drawerBot = bots.find((b) => b.id === tr16.drawer);
const autresBots = bots.filter((b) => b !== drawerBot);
// Le dessinateur trace ; DEUX autres essaient en même temps (par le protocole,
// et un navigateur spectateur au doigt).
const nouveaux = (b) => b.msgs.filter((m) => m.type === 'stroke').length;
const avant16 = autresBots.map(nouveaux);
const [intrus1, intrus2] = autresBots;
const forge = (b, s) => b.send({ action: 'stroke', turnId: tr16.turnId, s, c: 4, w: 2, p: [100, 100, 900, 700], end: true });
if (drawerBot) {
  drawerBot.send({ action: 'stroke', turnId: tr16.turnId, s: 1, c: 9, w: 2, p: [100, 375, 300, 375] });
  forge(intrus1, 50); forge(intrus2, 51);
  drawerBot.send({ action: 'stroke', turnId: tr16.turnId, s: 1, p: [500, 375, 900, 375], end: true });
} else {
  forge(intrus1, 50); forge(intrus2, 51);
  await parId[tr16.drawer].geste([[0.1, 0.5], [0.9, 0.5]]);
}
const spect = [A, B].filter((p) => p !== parId[tr16.drawer]);
await spect[0].geste([[0.1, 0.1], [0.9, 0.9]]);        // un spectateur essaie aussi
await sleep(500);
const attendu = drawerBot ? JSON.stringify([{ s: 1, c: 9, w: 2, p: [100, 375, 300, 375, 500, 375, 900, 375] }]) : await parId[tr16.drawer].traits();
t(`[12] 16 clients, trois qui dessinent à la fois : seul le dessinateur (${drawerBot ? drawerBot.nom : parId[tr16.drawer].nom}) passe`,
  (await Promise.all(spect.map((p) => p.traits()))).every((x) => x === attendu));
t('[12] les intrus sont refusés (NOT_DRAWER)', [intrus1, intrus2].every((b) => b.msgs.some((m) => m.type === 'refused' && m.reason === 'NOT_DRAWER')));
const recus16 = autresBots.map((b, i) => b.msgs.filter((m) => m.type === 'stroke').slice(avant16[i]));
t(`[11] les ${autresBots.length} robots spectateurs reçoivent le trait du dessinateur, et lui seul`,
  recus16.every((l) => l.length >= 1 && l.every((m) => m.s === JSON.parse(attendu)[0].s)));
t('[15] 16 clients : le mot ne fuit chez aucun spectateur', (() => {
  const m16 = (drawerBot ? drawerBot.msgs : []).find((m) => m.type === 'drawing' && m.word);
  return !m16 || autresBots.every((b) => !fuite(b.msgs, m16.word));
})() && (drawerBot ? !(await A.ev('JSON.stringify(window.__recu)')).includes(drawerBot.msgs.find((m) => m.type === 'drawing' && m.word).word) : true));
await spect[0].shot('partie-16');

console.log(`\n${ok} OK, ${ko} KO`);
fin();
process.exit(ko ? 1 : 0);
