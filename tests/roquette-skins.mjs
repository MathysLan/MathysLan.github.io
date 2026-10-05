// Roquette — les ARMES (skins cosmétiques) : on les choisit et on les voit, dans
// de vrais navigateurs, contre le VRAI serveur, hors Game Hub (le mode Hub est
// vérifié par tests/handoff-roquette.mjs).
//
//   node tests/roquette-skins.mjs
//   node tests/roquette-skins.mjs --shots <dossier>   (captures)
//   node tests/roquette-skins.mjs --serveur C:\perso\roquette-server
//
// Deux contextes Edge ISOLÉS (chacun son localStorage) : A en mouvement normal,
// B en mouvement réduit ; deux robots WebSocket complètent la table.
//
//   1. la table des armes : ids, repli sur la roquette, enveloppe (rien ne sort
//      de la place que fit() réserve à la roquette), aucun id de dégradé en double ;
//   2. le salon : sélecteur (roquette par défaut, aria-pressed), skin du join,
//      changement → action `skin` → message relayé, retour à la roquette,
//      réception du skin d'un autre, id inconnu reçu → roquette, préférence
//      locale valide / invalide relue au chargement, rafale de clics (le DERNIER
//      choix part, jamais plus de 4 par seconde) ;
//   3. la partie : l'arme montrée est celle du joueur visé (décompte, chaque
//      tour, chaque explosion), à taille constante ; la Pétoire met le feu à la
//      carte AVANT l'étoile commune, avec ses sons ; la roquette garde les
//      siens ; en mouvement réduit, ni vol, ni traînée, ni éclat.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const EDGE = arg('--edge') || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const SERVEUR = arg('--serveur') || 'C:\\perso\\roquette-server';
const SHOTS = arg('--shots');
const CDP_PORT = 9400 + Math.floor(Math.random() * 400);
const PORT = 8700 + Math.floor(Math.random() * 200);
const WS = `ws://127.0.0.1:${PORT}`;
const PAGE = 'file:///' + path.join(ROOT, 'games', 'roquette', 'index.html').replace(/\\/g, '/') + `?server=${encodeURIComponent(WS)}`;

let ok = 0, ko = 0;
const t = (name, cond, detail) => {
  if (cond) { ok++; console.log('OK   ' + name); }
  else { ko++; console.log('KO   ' + name + (detail ? ' — ' + detail : '')); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

// ------------------------------------------------------------ le vrai serveur
// Menace courte (plancher 700 ms) : trois explosions et une partie en ~15 s.
const req = createRequire(path.join(SERVEUR, 'server.js'));
const E = req('./engine.js');
const { charger } = req('./dico.js');
const srv = spawn(process.execPath, [path.join(SERVEUR, 'server.js')], {
  cwd: SERVEUR,
  env: { ...process.env, PORT: String(PORT), TEST_PLANCHER_MS: '700', TEST_COUNTDOWN_MS: '800', TEST_BOOM_MS: '1500' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((res) => srv.stdout.on('data', (d) => { if (/écoute/.test(String(d))) res(); }));

const { dico, prompts } = charger();
const parPrompt = new Map(prompts.map((p) => [p, []]));
for (const [k] of dico) {
  const vus = new Set();
  for (const n of [2, 3]) for (let i = 0; i + n <= k.length; i++) {
    const s = k.slice(i, i + n);
    if (k.length > n && !vus.has(s) && parPrompt.has(s)) { vus.add(s); parPrompt.get(s).push(k); }
  }
}
for (const l of parPrompt.values()) l.sort((a, b) => a.length - b.length || (a < b ? -1 : 1));
const JOUES = new Set();
const motPour = (p) => { const w = (parPrompt.get(p) || []).find((k) => !JOUES.has(k)); if (w) JOUES.add(w); return w; };

// ------------------------------------------------------------------ robots
// `answer` : tape un vrai mot à chacun de ses tours ; `silent` : ne tape jamais ;
// une fonction : tape tant qu'elle rend vrai (elle reçoit le robot).
// `skin` absent = le join d'un ANCIEN client (pas de champ du tout).
const robots = [];
function robot(nom, code, { mode = 'answer', skin } = {}) {
  const ws = new WebSocket(WS);
  const b = { nom, ws, id: null, mode, msgs: [] };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    b.msgs.push(m);
    if (m.type === 'presence' && !m.remplace) ws.send(JSON.stringify({ action: 'presence', n: m.n }));
    if (m.type === 'you') b.id = m.id;
    if (m.type === 'accepted') JOUES.add(E.cle(m.word));
    const repond = typeof b.mode === 'function' ? b.mode(b) : b.mode === 'answer';
    if (m.type === 'turn' && m.holder === b.id && repond) {
      setTimeout(() => { const w = motPour(m.prompt); if (w && ws.readyState === 1) ws.send(JSON.stringify({ action: 'submit', turnId: m.turnId, text: w })); }, 150);
    }
  };
  const join = { action: 'join', name: nom, code, avatar: { kind: 'emoji', emoji: '🤖' } };
  if (skin !== undefined) join.skin = skin;
  ws.onopen = () => ws.send(JSON.stringify(join));
  b.send = (o) => ws.send(JSON.stringify(o));
  b.attend = async (pred, ms = 5000) => { const f = Date.now() + ms; while (Date.now() < f) { const m = b.msgs.find(pred); if (m) return m; await sleep(30); } return null; };
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
const profil = mkdtempSync(path.join(tmpdir(), 'roquette-skins-'));
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--allow-file-access-from-files',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
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

// La sonde : tout le fil du jeu, et — APRÈS le traitement de chaque countdown /
// turn / boom par la page (même tâche, puis setTimeout 0) — l'arme qu'elle
// montre et sa taille. Plus : les éclats posés dans #fx, les vols (.is-flying),
// les sons demandés, les erreurs JS.
const SONDE = `(() => {
  window.__recu = []; window.__envoye = []; window.__vu = []; window.__fx = []; window.__vol = []; window.__sons = []; window.__err = [];
  addEventListener('error', (e) => window.__err.push(String(e.message)));
  const W = window.WebSocket;
  window.WebSocket = function (u, p) {
    const ws = p ? new W(u, p) : new W(u);
    ws.addEventListener('message', (e) => {
      let m; try { m = JSON.parse(e.data); } catch (_) { return; }
      window.__recu.push(m);
      if (m.type === 'countdown' || m.type === 'turn' || m.type === 'boom') {
        const t = performance.now();
        setTimeout(() => {
          const r = document.getElementById('rocket');
          window.__vu.push({ type: m.type, cible: m.type === 'turn' ? m.holder : m.type === 'boom' ? m.id : m.order[0],
            skin: r.dataset.skin, w: r.style.width, trainee: !!r.querySelector('.p-trainee'),
            choix: document.getElementById('skin-choix').checkVisibility(), t });
        }, 0);
      }
    });
    const s = ws.send.bind(ws);
    ws.send = (d) => { try { window.__envoye.push(JSON.parse(d)); } catch (_) {} return s(d); };
    return ws;
  };
  window.WebSocket.prototype = W.prototype; Object.assign(window.WebSocket, { OPEN: 1, CLOSED: 3, CONNECTING: 0, CLOSING: 2 });
  addEventListener('DOMContentLoaded', () => {
    new MutationObserver((l) => l.forEach((x) => x.addedNodes.forEach((n) => { if (n.className) window.__fx.push({ cls: String(n.className), t: performance.now() }); })))
      .observe(document.getElementById('fx'), { childList: true });
    const r = document.getElementById('rocket');
    new MutationObserver(() => { if (r.classList.contains('is-flying')) window.__vol.push({ skin: r.dataset.skin, t: performance.now() }); })
      .observe(r, { attributes: true, attributeFilter: ['class'] });
  });
  addEventListener('load', () => {
    const p = window.Sons.play;
    window.Sons.play = function (n) { window.__sons.push({ n, t: performance.now() }); return p.apply(this, arguments); };
  });
})();`;

// Un onglet dans son PROPRE contexte de navigation (localStorage à lui).
let navigateur = null;
async function onglet(nom, { reduit = false } = {}) {
  if (!navigateur) navigateur = await connect((await json('/json/version')).webSocketDebuggerUrl);
  const { result: { browserContextId } } = await navigateur.send('Target.createBrowserContext', { disposeOnDetach: false });
  const { result: { targetId } } = await navigateur.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const cible = (await json('/json/list')).find((x) => x.id === targetId);
  const c = await connect(cible.webSocketDebuggerUrl);
  await c.send('Page.enable');
  await c.send('Runtime.enable');
  await c.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });
  await c.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  if (reduit) await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: SONDE });
  const p = {
    nom, c,
    async ev(expr) {
      const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.result && r.result.exceptionDetails) throw new Error(nom + ' : ' + (r.result.exceptionDetails.exception || {}).description);
      return r.result && r.result.result ? r.result.result.value : undefined;
    },
    async until(expr, ms = 10000) { const f = Date.now() + ms; while (Date.now() < f) { if (await p.ev(expr)) return true; await sleep(60); } return false; },
    async pret() { await p.until('document.readyState === "complete" && !!window.Rocket && !!window.NET && !!window.__sons'); },
    async charger() { await c.send('Page.navigate', { url: PAGE }); await sleep(100); await p.pret(); },
    async recharger() { await c.send('Page.reload', { ignoreCache: true }); await sleep(150); await p.pret(); },
    async clic(sel) {
      await p.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (e) e.scrollIntoView({ block: 'center', behavior: 'instant' }); })()`);
      const q = await p.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      if (!q) throw new Error(`${nom} : ${sel} introuvable`);
      await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: q.x, y: q.y });
      await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: q.x, y: q.y, button: 'left', clickCount: 1 });
      await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: q.x, y: q.y, button: 'left', clickCount: 1 });
    },
    async taper(texte) { await c.send('Input.insertText', { text: texte }); },
    async shot(f) {
      if (!SHOTS) return;
      const r = await c.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(path.join(SHOTS, `${f}.png`), Buffer.from(r.result.data, 'base64'));
    },
  };
  await p.charger();
  return p;
}

const presse = (id) => `document.querySelector('.skin-pick[data-skin="${id}"]').getAttribute('aria-pressed') === 'true'`;
const choixEst = (id) => `(${presse(id)}) && [...document.querySelectorAll('.skin-pick')].filter((b) => b.getAttribute('aria-pressed') === 'true').length === 1`;
const tagDe = (pid) => `((document.querySelector('#players li[data-id="${pid}"] .tag-skin') || {}).textContent || '')`;
const envoyes = (p, action) => p.ev(`window.__envoye.filter((m) => m.action === ${JSON.stringify(action)})`);

// La portée de chaque arme (en unités du dessin, 250 = sa largeur) : la plus
// grande distance au PIVOT d'un de ses éléments, danger 0 et 3, flamme à son
// plus grand (animations arrêtées à leur début), visée à 0°. La traînée n'est
// pas comptée : elle n'existe qu'en vol.
const PORTEE = `(() => {
  const out = {};
  for (const id of Rocket.SKINS) for (const d of ['0', '3']) {
    const h = document.createElement('div');
    h.style.cssText = 'position:fixed;left:200px;top:200px;width:250px;height:92px;';
    document.body.append(h);
    const r = Rocket.create(h); r.setSkin(id); h.dataset.danger = d;
    h.querySelector('.r-aim').style.transform = 'none';
    h.getAnimations({ subtree: true }).forEach((a) => { a.pause(); a.currentTime = 0; });
    const hr = h.getBoundingClientRect(), k = 250 / hr.width;
    const px = hr.left + hr.width * Rocket.PIVOT, py = hr.top + hr.height / 2;
    let max = 0;
    h.querySelectorAll('svg *').forEach((e) => {
      if (e.closest('defs, .p-trainee') || e.tagName === 'g' || !(e instanceof SVGGraphicsElement)) return;
      const b = e.getBoundingClientRect(); if (!b.width && !b.height) return;
      for (const [x, y] of [[b.left, b.top], [b.right, b.top], [b.left, b.bottom], [b.right, b.bottom]]) max = Math.max(max, Math.hypot(x - px, y - py) * k);
    });
    out[id + d] = Math.round(max * 10) / 10;
    h.remove();
  }
  return out;
})()`;

try {
  const A = await onglet('A');
  const B = await onglet('B', { reduit: true });

  // ======================================================= 1. la table des armes
  t('table des armes : roquette et petoire, roquette par défaut', await A.ev(`JSON.stringify(Rocket.SKINS) === '["roquette","petoire"]' && Rocket.DEFAUT === 'roquette'`));
  t('id inconnu, absent ou mal formé → roquette (marmite, Petoire, __proto__, constructor, 42, null, objet)',
    await A.ev(`['marmite', 'Petoire', ' petoire', '__proto__', 'constructor', 'toString', 42, null, undefined, {}, ['petoire']].every((v) => Rocket.skinId(v) === 'roquette') && Rocket.skinId('petoire') === 'petoire'`));
  t('Rocket.info d un id inconnu : la roquette (nom, sons, pas de feu)',
    await A.ev(`(() => { const i = Rocket.info('marmite'); return i.id === 'roquette' && i.depart === 'whoosh' && i.impact === 'impact' && i.feu === false; })()`));
  const portee = await A.ev(PORTEE);
  t(`enveloppe : la Pétoire ne va pas plus loin du pivot que la roquette (danger 3 : ${portee.petoire3} ≤ ${portee.roquette3} ; danger 0 : ${portee.petoire0})`,
    portee.petoire3 <= portee.roquette3 && portee.petoire0 <= portee.roquette3 && portee.petoire3 > 50, JSON.stringify(portee));
  t('changer d arme ne change pas la taille posée (largeur, hauteur)', await A.ev(`(() => {
    const h = document.createElement('div'); h.style.cssText = 'position:fixed;left:0;top:0;width:213px;aspect-ratio:250/92;';
    document.body.append(h);
    const r = Rocket.create(h), mesure = () => { const b = h.getBoundingClientRect(); return [b.width, b.height, h.style.width].join(); };
    const avant = mesure(); r.setSkin('petoire'); const apres = mesure(); const skin = h.dataset.skin; r.setSkin('roquette'); const retour = mesure();
    h.remove(); return avant === apres && apres === retour && skin === 'petoire' && h.dataset.skin === 'roquette';
  })()`));
  t('enveloppe : la roquette tient dans EMPRISE (le rayon que fit() lui réserve)',
    await A.ev(`${portee.roquette3} <= Rocket.EMPRISE * 250 + 4`), `${portee.roquette3} vs ${await A.ev('Rocket.EMPRISE * 250')}`);

  // ============================================================== 2. le salon
  t('A, sans préférence : la roquette est choisie (aria-pressed), seule',
    await A.ev(`localStorage.getItem('roquette_skin') === null && ${choixEst('roquette')} && document.querySelectorAll('.skin-pick').length === 2`));
  await A.clic('#name-input'); await A.taper('Alice');
  await A.clic('#host');
  await A.until(`!document.getElementById('lobby').hidden && /^[A-Z]{4}$/.test(document.getElementById('room-code').textContent)`);
  const code = await A.ev(`document.getElementById('room-code').textContent`);
  const idA = await A.ev(`window.__recu.find((m) => m.type === 'you').id`);
  const joinA = (await envoyes(A, 'join'))[0];
  t('join de A : skin « roquette » (aucune préférence)', joinA && joinA.skin === 'roquette', JSON.stringify(joinA));
  t('salon : le sélecteur est visible, deux armes avec aperçu et nom',
    await A.ev(`document.getElementById('skin-choix').checkVisibility() && [...document.querySelectorAll('.skin-pick')].every((b) => b.querySelector('svg.r-svg') && b.textContent.trim().length > 4)`)
    && await A.ev(`[...document.querySelectorAll('.skin-pick')].map((b) => b.querySelector('.skin-nom').textContent).join('|') === 'La Roquette|La Pétoire de Secours'`)
    && await A.ev(`[...document.querySelectorAll('.skin-apercu svg')].every((s) => s.getAttribute('aria-hidden') === 'true')`));
  t('salon : chaque arme est un bouton à bascule (aria-pressed), nommé par son texte',
    await A.ev(`[...document.querySelectorAll('#skin-row > button')].every((b) => b.type === 'button' && b.hasAttribute('aria-pressed'))`));
  t('salon : aucun id en double dans la page (aperçus et arène ont leurs propres dégradés)',
    await A.ev(`(() => { const ids = [...document.querySelectorAll('[id]')].map((e) => e.id); return ids.length === new Set(ids).size; })()`));
  t('salon : ma ligne dit mon arme (« Roquette »)', (await A.ev(tagDe(idA))) === 'Roquette');

  // R1 : ancien client (aucun champ skin) → roquette ; il ne tape jamais.
  const R1 = robot('Robot1', code, { mode: 'silent' });
  await R1.attend((m) => m.type === 'you');
  await A.until(`${tagDe(R1.id)} === 'Roquette'`);
  t('un ancien client (join sans skin) apparaît avec la roquette', (await A.ev(tagDe(R1.id))) === 'Roquette');

  // A choisit la Pétoire, puis revient à la roquette, puis la reprend.
  let n0 = R1.msgs.length;
  await A.clic('.skin-pick[data-skin="petoire"]');
  const relaye = await R1.attend((m, i) => m.type === 'skin' && m.id === idA && m.skin === 'petoire');
  t('A choisit la Pétoire : action { skin: petoire } envoyée', (await envoyes(A, 'skin')).some((m) => m.skin === 'petoire'));
  t('… le serveur la relaie aux autres (message skin)', !!relaye);
  t('… sélection mise à jour, préférence écrite', await A.ev(`${choixEst('petoire')} && localStorage.getItem('roquette_skin') === 'petoire'`));
  t('… et la ligne de A dit « Pétoire » chez lui (écho du serveur)', await A.until(`${tagDe(idA)} === 'Pétoire'`, 3000));
  await sleep(300);
  n0 = R1.msgs.length;
  await A.clic('.skin-pick[data-skin="roquette"]');
  const retour = await R1.attend((m) => m.type === 'skin' && m.id === idA && m.skin === 'roquette' && R1.msgs.indexOf(m) >= n0);
  t('retour à la roquette : relayé, sélection et préférence à jour',
    !!retour && await A.ev(`${choixEst('roquette')} && localStorage.getItem('roquette_skin') === 'roquette'`) && await A.until(`${tagDe(idA)} === 'Roquette'`, 3000));
  await sleep(300);
  await A.clic('.skin-pick[data-skin="petoire"]');
  await A.until(`${tagDe(idA)} === 'Pétoire'`, 3000);

  // Le skin d'un AUTRE : reçu par le message `skin`.
  R1.send({ action: 'skin', skin: 'petoire' });
  t('réception du message skin d un autre joueur : sa ligne dit « Pétoire »', await A.until(`${tagDe(R1.id)} === 'Pétoire'`, 3000));
  // Un id que la page ne connaît pas (serveur en avance sur le front) → la roquette.
  await A.ev(`NET.dispatch({ type: 'skin', id: ${JSON.stringify(R1.id)}, skin: 'marmite' })`);
  t('id inconnu reçu (marmite) → affiché comme la roquette', (await A.ev(tagDe(R1.id))) === 'Roquette');
  R1.send({ action: 'skin', skin: 'roquette' });        // le serveur repasse R1 en roquette (et le relaie)
  await A.until(`window.__recu.some((m) => m.type === 'skin' && m.id === ${JSON.stringify(R1.id)} && m.skin === 'roquette')`, 3000);

  // B : la préférence locale, relue au chargement.
  await B.ev(`localStorage.setItem('roquette_skin', 'marmite')`);
  await B.recharger();
  t('B, préférence locale INVALIDE (marmite) → la roquette est choisie', await B.ev(choixEst('roquette')));
  await B.ev(`localStorage.setItem('roquette_skin', 'petoire')`);
  await B.recharger();
  t('B, préférence locale valide (petoire) → la Pétoire est choisie', await B.ev(choixEst('petoire')));
  await B.clic('#name-input'); await B.taper('Bea');
  await B.clic('#code-input'); await B.taper(code);
  await B.clic('#join');
  await B.until(`!document.getElementById('lobby').hidden`);
  const idB = await B.ev(`window.__recu.find((m) => m.type === 'you').id`);
  const joinB = (await envoyes(B, 'join'))[0];
  t('join de B : skin « petoire » (sa préférence)', joinB && joinB.skin === 'petoire', JSON.stringify(joinB));
  t('A voit B avec la Pétoire', await A.until(`${tagDe(idB)} === 'Pétoire'`, 3000));

  // Rafale : cinq clics d'affilée (r, p, r, p, r) → le dernier choix gagne, sans dépasser le débit.
  const avant = (await envoyes(B, 'skin')).length;
  await B.ev(`['roquette', 'petoire', 'roquette', 'petoire', 'roquette'].forEach((s) => document.querySelector('.skin-pick[data-skin="' + s + '"]').click())`);
  await sleep(900);
  const rafale = (await envoyes(B, 'skin')).slice(avant);
  t(`rafale de 5 clics : ${rafale.length} envoi(s), le dernier = roquette, et A voit B en Roquette`,
    rafale.length >= 1 && rafale.length <= 4 && rafale[rafale.length - 1].skin === 'roquette' && await A.until(`${tagDe(idB)} === 'Roquette'`, 3000),
    JSON.stringify(rafale.map((m) => m.skin)));
  await B.clic('.skin-pick[data-skin="petoire"]');
  await A.until(`${tagDe(idB)} === 'Pétoire'`, 3000);

  // R2 : nouveau client, roquette explicite ; il tape à chaque tour (il gagne).
  const R2 = robot('Robot2', code, { mode: 'answer', skin: 'roquette' });
  await R2.attend((m) => m.type === 'you');
  // R3 : tape tant que les trois « muets » n'ont pas explosé, puis se tait — c'est
  // lui qui prend la DERNIÈRE explosion (celle que la fin de partie interrompt :
  // `end` arrive avec elle). Les trois explosions étudiées ont ainsi leur effet entier.
  const R3 = robot('Robot3', code, { skin: 'roquette', mode: (b) => b.msgs.filter((m) => m.type === 'boom').length < 3 });
  await R3.attend((m) => m.type === 'you');
  await A.until(`document.getElementById('lobby-count').textContent === '5 / 16'`);
  t('salon à 5 : A Pétoire, R1 Roquette, B Pétoire, R2 et R3 Roquette (chez A)',
    (await A.ev(`[${[idA, R1.id, idB, R2.id, R3.id].map(tagDe).join(',')}].join()`)) === 'Pétoire,Roquette,Pétoire,Roquette,Roquette');
  await A.shot('1-salon-A');

  // ============================================================= 3. la partie
  const attendu = { [idA]: 'petoire', [R1.id]: 'roquette', [idB]: 'petoire', [R2.id]: 'roquette', [R3.id]: 'roquette' };
  await A.ev(`document.getElementById('vies-select').value = '1'`);
  await A.clic('#start');
  t('lancement : plus de sélecteur pendant la partie',
    await A.until(`document.getElementById('play').dataset.phase === 'countdown' || document.getElementById('play').dataset.phase === 'turn'`)
    && await A.ev(`!document.getElementById('skin-choix').checkVisibility()`));
  // Une capture de la Pétoire en jeu (--shots).
  if (SHOTS && await A.until(`document.getElementById('rocket').dataset.skin === 'petoire' && document.getElementById('play').dataset.phase === 'turn'`, 20000)) {
    await sleep(400); await A.shot('2-petoire-A');
  }
  // … et de la prise de feu sur une carte (--shots), dès qu'elle apparaît.
  let feuCapture = !SHOTS;
  const guetteur = (async () => {
    while (!feuCapture) {
      if (await A.ev(`!!document.querySelector('#fx .feu') && !document.getElementById('play').hidden`)) { await sleep(120); await A.shot('2b-feu-A'); feuCapture = true; }
      else if (await A.ev(`!document.getElementById('end').hidden`)) break;
      await sleep(20);
    }
  })();
  const fini = await A.until(`!document.getElementById('end').hidden`, 90000);
  await guetteur;
  t('la partie va au bout (quatre explosions, R2 gagne)', fini && await A.ev(`/Robot2/.test(document.getElementById('end-title').textContent)`));
  await A.shot('3-fin-A');
  await sleep(1600);              // le filet d'impact (1,3 s) de la dernière explosion

  for (const P of [A, B]) {
    const vu = await P.ev('window.__vu');
    const faux = vu.filter((v) => v.skin !== attendu[v.cible]);
    const types = vu.reduce((o, v) => ((o[v.type] = (o[v.type] || 0) + 1), o), {});
    t(`${P.nom} : l arme montrée est celle du joueur visé, à chaque countdown / turn / boom (${JSON.stringify(types)})`,
      faux.length === 0 && types.countdown === 1 && types.turn >= 4 && types.boom === 4, JSON.stringify(faux.slice(0, 3)));
    const skinsVus = new Set(vu.map((v) => v.skin));
    t(`${P.nom} : les deux armes ont été montrées`, skinsVus.has('petoire') && skinsVus.has('roquette'));
    t(`${P.nom} : la traînée n existe que dans la Pétoire`, vu.every((v) => v.trainee === (v.skin === 'petoire')));
    t(`${P.nom} : aucun sélecteur pendant la partie`, vu.every((v) => !v.choix));
    const booms = vu.filter((v) => v.type === 'boom');
    t(`${P.nom} : les explosions utilisent l arme du joueur touché (${booms.map((b) => b.skin).join(', ')})`,
      booms.length === 4 && booms.every((b) => b.skin === attendu[b.cible]) && booms.filter((b) => b.skin === 'petoire').length === 2);
  }

  // L'impact, en mouvement normal (A) : la Pétoire met le feu PUIS l'étoile commune ; la roquette, l'étoile seule.
  const vuA = await A.ev('window.__vu'), fxA = await A.ev('window.__fx'), sonsA = await A.ev('window.__sons'), volA = await A.ev('window.__vol');
  const boomsA = vuA.filter((v) => v.type === 'boom');
  // Les trois premières (la 4e, celle de R3, finit la partie : `end` coupe son vol, comme avant ce lot).
  t('A : trois explosions étudiées, dont celles des deux Pétoire', boomsA.length === 4 && boomsA.slice(0, 3).filter((b) => b.skin === 'petoire').length === 2);
  boomsA.slice(0, 3).forEach((b, i) => {
    const finFenetre = boomsA[i + 1].t;
    const fx = fxA.filter((f) => f.t >= b.t && f.t < finFenetre);
    const sons = sonsA.filter((s) => s.t >= b.t && s.t < finFenetre).map((s) => s.n);
    const feu = fx.find((f) => f.cls === 'feu'), etoile = fx.find((f) => f.cls === 'boum');
    if (b.skin === 'petoire') {
      t(`A, explosion Pétoire : la carte prend feu, PUIS l étoile commune (+${feu && etoile ? Math.round(etoile.t - feu.t) : '?'} ms)`,
        !!feu && !!etoile && etoile.t - feu.t >= 100, JSON.stringify(fx));
      t(`A, explosion Pétoire : sons fusee, crepitement, explosion (${sons.join(' ')})`,
        ['fusee', 'crepitement', 'explosion'].every((n) => sons.includes(n)) && !sons.includes('whoosh') && !sons.includes('impact')
        && sons.indexOf('crepitement') < sons.indexOf('explosion'));
      t('A, explosion Pétoire : vol avec traînée (.is-flying sur la Pétoire)', volA.some((v) => v.t >= b.t && v.t < finFenetre && v.skin === 'petoire'));
    } else {
      t('A, explosion roquette : l étoile commune, sans feu', !!etoile && !feu, JSON.stringify(fx));
      t(`A, explosion roquette : ses sons d avant (${sons.join(' ')})`,
        ['whoosh', 'impact', 'explosion'].every((n) => sons.includes(n)) && !sons.includes('fusee') && !sons.includes('crepitement'));
    }
  });
  t('A : sons communs gardés (validation du mot de R2)', sonsA.some((s) => s.n === 'valide'));

  // Mouvement réduit (B) : version fixe — ni vol, ni traînée, ni éclat ; les sons restent.
  const fxB = await B.ev('window.__fx'), volB = await B.ev('window.__vol'), sonsB = await B.ev('window.__sons');
  t('B (mouvement réduit) : aucun éclat posé (ni feu, ni étoile)', fxB.length === 0, JSON.stringify(fxB));
  t('B (mouvement réduit) : aucun vol, donc aucune traînée', volB.length === 0);
  t('B (mouvement réduit) : les sons d impact restent (crepitement et impact)', sonsB.some((s) => s.n === 'crepitement') && sonsB.some((s) => s.n === 'impact'));
  t('B (mouvement réduit) : la flamme de la Pétoire est figée', await B.ev(`(() => { const h = document.createElement('div'); h.style.width = '250px'; document.body.append(h);
    const r = Rocket.create(h); r.setSkin('petoire'); h.dataset.danger = '3'; const n = h.querySelector('.r-flamme').getAnimations().length + h.querySelector('.p-etinc').getAnimations().length; h.remove(); return n === 0; })()`));

  // Le fil : aucun message nouveau hors du contrat.
  for (const P of [A, B]) {
    const env = await P.ev('window.__envoye');
    t(`${P.nom} : n envoie que join (avec skin), skin, start, typing, submit, presence`, env.every((m) => ['join', 'skin', 'start', 'typing', 'submit', 'presence'].includes(m.action)), [...new Set(env.map((m) => m.action))].join());
    t(`${P.nom} : aucune erreur JS`, (await P.ev('window.__err')).length === 0, (await P.ev('window.__err')).join(' | '));
    t(`${P.nom} : aucune erreur du serveur`, (await P.ev(`window.__recu.filter((m) => m.type === 'error').length`)) === 0);
  }
} catch (e) {
  t('EXCEPTION', false, e && (e.stack || e.message));
}

console.log(`\n${ok} OK, ${ko} KO`);
process.exit(ko ? 1 : 0);
