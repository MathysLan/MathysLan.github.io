// Croquis — le harnais commun des tests navigateur contre le VRAI
// croquis-server : le serveur lancé en local (délais TEST_*), Edge headless
// piloté par le protocole DevTools, des onglets (bureau / téléphone) avec un
// espion sur leur WebSocket, des robots WebSocket. Pas un test.
//
// (tests/croquis-network.mjs garde sa copie d'origine de ces outils ; les
//  nouvelles suites passent par ce module.)
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function compteur() {
  let ok = 0, ko = 0;
  const t = (name, cond, detail) => {
    if (cond) { ok++; console.log('OK   ' + name); }
    else { ko++; console.log('KO   ' + name + (detail ? ' — ' + detail : '')); }
  };
  t.bilan = () => ({ ok, ko });
  return t;
}

const nettoyages = [];
function fin() { while (nettoyages.length) { try { nettoyages.pop()(); } catch (_) {} } }
process.on('exit', fin);
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { fin(); process.exit(130); });
export { fin };

// ------------------------------------------------------------ le vrai serveur
// Le dépôt du serveur : --serveur, sinon à côté de ce dépôt, sinon C:\perso.
export async function lancerServeur(env = {}) {
  const voisin = path.resolve(ROOT, '..', 'croquis-server');
  const dossier = arg('--serveur') || (existsSync(path.join(voisin, 'server.js')) ? voisin : 'C:\\perso\\croquis-server');
  const port = 8700 + Math.floor(Math.random() * 200);
  const srv = spawn(process.execPath, [path.join(dossier, 'server.js')], {
    cwd: dossier,
    env: { ...process.env, PORT: String(port), PRESENCE_QUIET: '1', ...env },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  nettoyages.push(() => srv.kill());
  await new Promise((res) => srv.stdout.on('data', (d) => { if (/écoute/.test(String(d))) res(); }));
  return { url: `ws://127.0.0.1:${port}`, dossier };
}

// ------------------------------------------------------------------ robots
export function robot(url, nom, code) {
  const ws = new WebSocket(url);
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
  b.dernier = (type, turnId) => [...b.msgs].reverse().find((m) => m.type === type && (turnId == null || m.turnId === turnId));
  nettoyages.push(() => ws.close());
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

// L'espion : tout ce qui passe sur le WebSocket du jeu (hors présence).
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

export async function lancerEdge({ shots } = {}) {
  const EDGE = arg('--edge') || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const cdp = 9400 + Math.floor(Math.random() * 400);
  if (shots) mkdirSync(shots, { recursive: true });
  const profil = mkdtempSync(path.join(tmpdir(), 'croquis-'));
  const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--allow-file-access-from-files',
    `--remote-debugging-port=${cdp}`, `--user-data-dir=${profil}`, '--window-size=1100,900', 'about:blank'], { stdio: 'ignore' });
  nettoyages.push(() => {
    try { edge.kill(); } catch (_) {}
    if (process.platform === 'win32' && edge.pid) { try { spawn('taskkill', ['/PID', String(edge.pid), '/T', '/F'], { stdio: 'ignore', detached: true }).unref(); } catch (_) {} }
  });
  const json = async (p) => { for (let i = 0; i < 80; i++) { try { return await (await fetch(`http://127.0.0.1:${cdp}${p}`)).json(); } catch (_) { await sleep(150); } } throw new Error('Edge muet'); };
  let premier = true;

  // Un onglet : bureau (souris) ou téléphone (doigt).
  async function onglet(nom, { w, h, mobile, page }) {
    let cible;
    if (premier) { premier = false; cible = (await json('/json/list')).find((x) => x.type === 'page'); }
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
      // Toucher / cliquer un élément ; on ne fait défiler que s'il est hors de l'écran.
      async clic(sel) {
        const q = await p.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'nearest', behavior: 'instant' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
        if (!q) throw new Error(`${nom} : ${sel} introuvable`);
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
      // ⚠️ Entrée : rawKeyDown SANS `text` (avec, le handler ne voit rien).
      async entree() {
        await c.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
        await c.send('Input.dispatchKeyEvent', { type: 'char', key: 'Enter', text: '\r', unmodifiedText: '\r' });
        await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
      },
      // Un geste sur la feuille, en fractions : souris ou doigt selon l'onglet.
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
      recu: (type) => p.ev(`window.__recu.filter((m) => !${JSON.stringify(type || '')} || m.type === ${JSON.stringify(type || '')})`),
      envoye: (action) => p.ev(`window.__envoye.filter((m) => m.action === ${JSON.stringify(action)})`),
      texte: (sel) => p.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? e.textContent : null; })()`),
      visible: (sel) => p.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && e.checkVisibility(); })()`),
      async shot(f) {
        if (!shots) return;
        // ⚠️ Un onglet d'arrière-plan ne rend pas d'image : devant d'abord, et
        // une capture qui traîne est abandonnée (sinon le tour expire).
        await c.send('Page.bringToFront');
        const r = await Promise.race([c.send('Page.captureScreenshot', { format: 'png' }), sleep(5000).then(() => null)]);
        if (r && r.result) writeFileSync(path.join(shots, f + '.png'), Buffer.from(r.result.data, 'base64'));
      },
      async ouvrir() {
        await c.send('Page.navigate', { url: page });
        await p.until('document.readyState === "complete" && !!window.__croquis && typeof NET === "object"');
      },
    };
    await p.metrics(w, h);
    return p;
  }
  return { onglet };
}

export function pageCroquis(url) {
  return 'file:///' + path.join(ROOT, 'games', 'croquis', 'index.html').replace(/\\/g, '/') + `?server=${encodeURIComponent(url)}`;
}
