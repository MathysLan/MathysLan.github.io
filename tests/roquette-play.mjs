// Roquette — on JOUE, dans de vrais navigateurs, contre le VRAI serveur.
//
//   node tests/roquette-play.mjs
//   node tests/roquette-play.mjs --reduced            (mouvement réduit)
//   node tests/roquette-play.mjs --shots <dossier>    (captures)
//   node tests/roquette-play.mjs --serveur C:\perso\roquette-server
//
// Le test lance lui-même le serveur du lot 2 (server.js, délais raccourcis par
// ses variables TEST_*), ouvre DEUX onglets Edge — un bureau (1100 px) et un
// téléphone (390 px, tactile) — et complète la table avec des robots
// WebSocket qui jouent de vrais mots du vrai dictionnaire. Aucun faux serveur.
//
// Ce qui est vérifié, au clic et à la frappe réels (protocole DevTools) :
//   2 joueurs : salon, hôte, réglages, lancement, décompte, cible, prompt,
//   saisie hors tour refusée, saisie relayée, refus, mot validé (prompt mis
//   en évidence), focus gardé d'un tour à l'autre, explosion (bonne cible,
//   animation, vie perdue, retour au centre), élimination, fin, revanche ;
//   8 puis 16 joueurs : aucune carte cachée ni perdue, aucune qui en recouvre
//   une autre, la roquette vise la bonne carte (à 3° près) tour après tour ;
//   téléphone avec clavier ouvert (fenêtre réduite) : prompt, roquette, champ
//   et cible visibles ; clavier : Tab, focus, Entrée ; et RIEN sur le fil ni à
//   l'écran qui donne le temps de la menace.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const has = (n) => process.argv.includes(n);
const EDGE = arg('--edge') || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const SERVEUR = arg('--serveur') || 'C:\\perso\\roquette-server';
const REDUCED = has('--reduced');
const SHOTS = arg('--shots');
const CDP_PORT = 9400 + Math.floor(Math.random() * 400);
const PORT = 8700 + Math.floor(Math.random() * 200);
const WS = `ws://127.0.0.1:${PORT}`;
const PAGE = 'file:///' + path.join(ROOT, 'games', 'roquette', 'index.html').replace(/\\/g, '/') + `?server=${encodeURIComponent(WS)}`;
const PLANCHER = 2500;      // menace neuve : 5 à 10 s — le temps de mesurer ET de taper sur un même tour

let ok = 0, ko = 0;
const t = (name, cond, detail) => {
  if (cond) { ok++; console.log('OK   ' + name); }
  else { ko++; console.log('KO   ' + name + (detail ? ' — ' + detail : '')); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

// ------------------------------------------------------------ le vrai serveur
const req = createRequire(path.join(SERVEUR, 'server.js'));
const E = req('./engine.js');
const { charger } = req('./dico.js');
const srv = spawn(process.execPath, [path.join(SERVEUR, 'server.js')], {
  cwd: SERVEUR,
  env: { ...process.env, PORT: String(PORT), TEST_PLANCHER_MS: String(PLANCHER), TEST_COUNTDOWN_MS: '1200', TEST_BOOM_MS: '1800' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((res) => srv.stdout.on('data', (d) => { if (/écoute/.test(String(d))) res(); }));

// Les mots : le vrai dictionnaire, indexé par prompt.
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
const robots = [];
function robot(nom, code, mode = 'answer') {
  const ws = new WebSocket(WS);
  const b = { nom, ws, id: null, mode, msgs: [], refus: null };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    b.msgs.push(m);
    if (m.type === 'presence' && !m.remplace) ws.send(JSON.stringify({ action: 'presence', n: m.n }));
    if (m.type === 'you') b.id = m.id;
    if (m.type === 'error') b.refus = m.message;
    if (m.type === 'accepted') JOUES.add(E.cle(m.word));
    if (m.type === 'turn' && m.holder === b.id && b.mode === 'answer') {
      setTimeout(() => { const w = motPour(m.prompt); if (w && ws.readyState === 1) ws.send(JSON.stringify({ action: 'submit', turnId: m.turnId, text: w })); }, 1000);   // 1 s : le temps de mesurer le tour
    }
  };
  ws.onopen = () => ws.send(JSON.stringify({ action: 'join', name: nom, code, avatar: { kind: 'emoji', emoji: '🤖' } }));
  robots.push(b);
  return b;
}
const fermerRobots = (liste) => liste.forEach((b) => { try { b.ws.close(); } catch (_) {} });

// ------------------------------------------------------------- Edge + CDP
async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('CDP injoignable')); });
  let id = 0;
  const waiting = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } };
  return { send(method, params = {}) { const mid = ++id; ws.send(JSON.stringify({ id: mid, method, params })); return new Promise((res) => waiting.set(mid, res)); } };
}
const profil = mkdtempSync(path.join(tmpdir(), 'roquette-play-'));
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--allow-file-access-from-files',
  '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profil}`, '--window-size=1100,900', 'about:blank'], { stdio: 'ignore' });
function fin() {
  try { edge.kill(); } catch (_) {}
  if (process.platform === 'win32' && edge.pid) { try { spawn('taskkill', ['/PID', String(edge.pid), '/T', '/F'], { stdio: 'ignore', detached: true }).unref(); } catch (_) {} }
  try { srv.kill(); } catch (_) {}
  fermerRobots(robots);
}
process.on('exit', fin);
// Coupé de l'extérieur (Ctrl+C, `timeout`) : `exit` ne passerait pas, et Edge
// et le serveur resteraient orphelins (vu pendant la mise au point).
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { fin(); process.exit(130); });
async function json(p) { for (let i = 0; i < 80; i++) { try { return await (await fetch(`http://127.0.0.1:${CDP_PORT}${p}`)).json(); } catch (_) { await sleep(150); } } throw new Error('Edge muet'); }

// Un onglet : on y enregistre tout ce qui passe sur le WebSocket du jeu.
const ESPION = `(() => {
  window.__recu = []; window.__envoye = [];
  const W = window.WebSocket;
  window.WebSocket = function (u, p) {
    const ws = p ? new W(u, p) : new W(u);
    ws.addEventListener('message', (e) => { try { window.__recu.push(JSON.parse(e.data)); } catch (_) {} });
    const s = ws.send.bind(ws);
    ws.send = (d) => { try { window.__envoye.push(JSON.parse(d)); } catch (_) {} return s(d); };
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
  await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: !!mobile });
  await c.send('Emulation.setFocusEmulationEnabled', { enabled: true });      // deux onglets « au premier plan »
  if (mobile) await c.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
  if (REDUCED) await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: ESPION });
  await c.send('Page.navigate', { url: PAGE });
  const p = {
    nom, c, w, h,
    async ev(expr) {
      const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.result && r.result.exceptionDetails) throw new Error(nom + ' : ' + (r.result.exceptionDetails.exception || {}).description);
      return r.result && r.result.result ? r.result.result.value : undefined;
    },
    async until(expr, ms = 10000) { const f = Date.now() + ms; while (Date.now() < f) { if (await p.ev(expr)) return true; await sleep(60); } return false; },
    async centre(sel) { return p.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`); },
    async clic(sel) {
      // Comme un doigt : on fait défiler jusqu'à l'élément, puis on touche.
      await p.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (e) e.scrollIntoView({ block: 'center', behavior: 'instant' }); })()`);
      const q = await p.centre(sel);
      if (!q) throw new Error(`${nom} : ${sel} introuvable`);
      if (mobile) {
        await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: q.x, y: q.y }] });
        await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } else {
        await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: q.x, y: q.y });
        await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: q.x, y: q.y, button: 'left', clickCount: 1 });
        await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: q.x, y: q.y, button: 'left', clickCount: 1 });
      }
    },
    async taper(texte) { await c.send('Input.insertText', { text: texte }); },
    // ⚠️ Entrée et Tab : rawKeyDown SANS `text` (avec, le handler ne voit rien).
    async touche(key, code, kc) {
      await c.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: kc, nativeVirtualKeyCode: kc });
      await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: kc, nativeVirtualKeyCode: kc });
    },
    entree() { return p.touche('Enter', 'Enter', 13); },
    tab() { return p.touche('Tab', 'Tab', 9); },
    async vider() { await p.ev(`(() => { const i = document.getElementById('mot'); i.focus(); i.value = ''; })()`); },
    recu() { return p.ev('window.__recu'); },
    dernier(type) { return p.ev(`(() => { const l = window.__recu.filter((m) => m.type === ${JSON.stringify(type)}); return l[l.length - 1] || null; })()`); },
    async shot(nomFichier) {
      if (!SHOTS) return;
      const r = await c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      writeFileSync(path.join(SHOTS, `${nomFichier}${REDUCED ? '-reduit' : ''}.png`), Buffer.from(r.result.data, 'base64'));
    },
  };
  await p.until('document.readyState === "complete" && !!window.Rocket && !!window.NET');
  return p;
}

const A = await onglet('A', { w: 1100, h: 900 });
const B = await onglet('B', { w: 390, h: 780, mobile: true });
const pages = [A, B];

// --------------------------------------------------------- outils de mesure
// L'écart (en degrés) entre la direction de la roquette et l'avatar visé.
const ECART = (id) => `(() => {
  const host = document.getElementById('rocket'), r = host.getBoundingClientRect();
  const px = r.left + r.width * Rocket.PIVOT, py = r.top + r.height / 2;
  const g = document.querySelector('.card[data-id="${id}"] .g-av'); if (!g) return 999;
  const q = g.getBoundingClientRect();
  const voulu = Math.atan2(q.top + q.height / 2 - py, q.left + q.width / 2 - px) * 180 / Math.PI;
  // L'angle POSÉ (la fin de la transition) : un onglet d'arrière-plan peut figer
  // la transition CSS, et l'angle calculé à mi-course ne dirait rien de la visée.
  const pose = /rotate\\(([-\\d.]+)deg\\)/.exec(document.querySelector('.r-aim').style.transform);
  window.__vis = (window.__vis || new Set()); window.__vis.add(document.visibilityState);
  const vu = pose ? +pose[1] : 0;
  return Math.abs(((vu - voulu) % 360 + 540) % 360 - 180);
})()`;
// Les cartes : toutes là, visibles, dans l'arène et l'écran, sans se recouvrir.
const CARTES = `(() => {
  const ar = document.getElementById('arena').getBoundingClientRect();
  const cs = [...document.querySelectorAll('#ring .card')];
  const av = cs.map((c) => c.querySelector('.g-av').getBoundingClientRect());
  let dehors = 0, cachees = 0, chevauch = 0;
  const ecarts = [];
  cs.forEach((c, i) => {
    const r = c.getBoundingClientRect();
    if (!c.checkVisibility() || r.width < 20) cachees++;
    if (r.left < ar.left - 2 || r.right > ar.right + 2 || r.top < ar.top - 2 || r.bottom > ar.bottom + 2 || r.left < 0 || r.right > innerWidth) {
      dehors++;
      // (diagnostic) id / classes / débord gauche, droite, haut, bas, en px
      ecarts.push([c.dataset.id, c.className.replace('card', '').trim(), Math.round(ar.left - r.left), Math.round(r.right - ar.right), Math.round(ar.top - r.top), Math.round(r.bottom - ar.bottom)].join('/'));
    }
    for (let j = i + 1; j < av.length; j++) {
      const a = av[i], b = av[j];
      const x = Math.min(a.right, b.right) - Math.max(a.left, b.left), y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (x > 2 && y > 2) chevauch++;
    }
  });
  const cibles = cs.filter((c) => c.classList.contains('is-target')).map((c) => c.dataset.id);
  // (diagnostic) la géométrie du moment, pour lire un échec sans le rejouer
  const st = getComputedStyle(document.getElementById('arena'));
  const geo = { arene: [Math.round(ar.width), Math.round(ar.height)], rk: st.getPropertyValue('--rk'), cw: cs[0] && cs[0].style.getPropertyValue('--cw'),
    compact: document.getElementById('ring').classList.contains('is-compact'), fenetre: [innerWidth, innerHeight, Math.round(visualViewport.height)],
    hauteurs: [...new Set(cs.map((c) => Math.round(c.getBoundingClientRect().height)))], ecarts };
  return { n: cs.length, dehors, cachees, chevauch, cibles, nomsVisibles: cs.filter((c) => c.querySelector('.nom').checkVisibility()).length, geo };
})()`;
const dansEcran = (sel) => `(() => { const e = document.querySelector('${sel}'); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.top >= -1 && r.bottom <= innerHeight + 1 && r.left >= -1 && r.right <= innerWidth + 1; })()`;

// Attendre, sur une page, le prochain tour (turnId > n). Rend le message.
async function prochainTour(p, apres, ms = 15000) {
  // Le DERNIER tour de la partie en cours (après le dernier décompte : les
  // turnId repartent à 1 à chaque partie) ; null si la partie s'est terminée.
  const f = Date.now() + ms;
  while (Date.now() < f) {
    const r = await p.ev(`(() => { const l = window.__recu; let d = 0; l.forEach((m, i) => { if (m.type === 'countdown') d = i; });
      let tour = null, fini = false; for (const m of l.slice(d)) { if (m.type === 'turn') { fini = false; if (m.turnId > ${apres}) tour = m; } if (m.type === 'end') fini = true; }
      return { tour, fini }; })()`);
    if (r.fini) return null;
    if (r.tour) return r.tour;
    await sleep(50);
  }
  return null;
}
const parId = (id, ids) => pages.find((p) => ids[p.nom] === id);

try {
  // =================================================================== salon
  await A.clic('#name-input'); await A.taper('Alice');
  await A.clic('#host');
  t('A crée la partie : salon, code de 4 lettres', await A.until(`!document.getElementById('lobby').hidden && /^[A-Z]{4}$/.test(document.getElementById('room-code').textContent)`));
  const code = await A.ev(`document.getElementById('room-code').textContent`);
  t('hôte seul : « 1 / 16 », réglages visibles, « Lancer » éteint', await A.ev(`document.getElementById('lobby-count').textContent === '1 / 16' && !document.getElementById('host-config').hidden && document.getElementById('start').disabled`));
  await B.clic('#name-input'); await B.taper('Bruno');
  await B.clic('#code-input'); await B.taper(code);
  await B.clic('#join');
  t('B rejoint au téléphone : « 2 / 16 » chez les deux', await A.until(`document.getElementById('lobby-count').textContent === '2 / 16'`) && await B.until(`document.getElementById('lobby-count').textContent === '2 / 16'`));
  t('B (invité) : pas de réglages, « En attente de l hôte… »', await B.ev(`document.getElementById('host-config').hidden && /attente de l.hôte/.test(document.getElementById('need-players').textContent)`));
  t('salon : avatars et hôte marqué', await A.ev(`document.querySelectorAll('#players .g-av').length === 2 && document.querySelectorAll('#players .tag').length === 1`));
  const ids = { A: await A.ev(`window.__recu.find((m) => m.type === 'you').id`), B: await B.ev(`window.__recu.find((m) => m.type === 'you').id`) };

  // Clavier : Tab parcourt les réglages puis « Lancer ».
  await A.ev(`document.activeElement.blur(); document.getElementById('room-code').focus()`);
  const vus = [];
  // (jusqu'à « Lancer » : avant les réglages, un arrêt par bouton d'arme du sélecteur)
  for (let i = 0; i < 10 && vus[vus.length - 1] !== 'start'; i++) { await A.tab(); vus.push(await A.ev(`document.activeElement.id`)); }
  t(`clavier : Tab → ${vus.join(' → ')}`, ['vies-select', 'rythme-select', 'start'].every((x) => vus.includes(x))
    && vus.indexOf('vies-select') < vus.indexOf('rythme-select') && vus.indexOf('rythme-select') < vus.indexOf('start'));
  const anneau = await A.ev(`(() => { document.getElementById('start').focus(); const s = getComputedStyle(document.getElementById('start')); return s.boxShadow.includes('255, 215, 0') || s.outlineStyle !== 'none'; })()`);
  t('clavier : « Lancer » porte un anneau de focus', anneau);
  await A.ev(`document.getElementById('vies-select').value = '2'; document.getElementById('rythme-select').value = 'normal'`);
  await A.shot('1-salon');
  await A.clic('#start');

  // ===================================================== 2 joueurs : décompte
  t('lancement : décompte chez les deux (cartes numérotées, premier annoncé)',
    await A.until(`document.getElementById('play').dataset.phase === 'countdown'`) && await B.until(`document.getElementById('play').dataset.phase === 'countdown'`)
    && await A.ev(`document.querySelectorAll('#ring .card').length === 2 && /Premier/.test(document.getElementById('cible').textContent) && document.querySelector('.card .num').checkVisibility()`));
  let tour = await prochainTour(A, 0);
  t('premier tour : prompt affiché en grand chez les deux', !!tour && await A.ev(`document.getElementById('prompt').textContent === ${JSON.stringify((tour || {}).prompt || '').toUpperCase()}`)
    && await B.ev(`parseFloat(getComputedStyle(document.getElementById('prompt')).fontSize) >= 28`));
  await sleep(450);
  for (const p of pages) {
    const e = await p.ev(ECART(tour.holder));
    t(`${p.nom} : la roquette vise ${tour.holder === ids[p.nom] ? 'moi' : 'l autre'} (écart ${e.toFixed(1)}°)`, e < 3);
  }
  const H = parId(tour.holder, ids), O = pages.find((p) => p !== H);
  t('le joueur visé lit « À TOI ! », l autre le nom de la cible', await H.ev(`/À TOI/.test(document.getElementById('cible').textContent)`)
    && await O.ev(`document.getElementById('cible').textContent.includes(${JSON.stringify(H === A ? 'Alice' : 'Bruno')})`));
  t('le joueur visé a le champ, et le focus dedans', await H.ev(`document.getElementById('saisie').classList.contains('is-mine') && document.activeElement.id === 'mot'`));
  // Hors de son tour : rien ne s'écrit, rien ne part.
  const avant = await O.ev(`window.__envoye.length`);
  await O.clic('#mot'); await O.taper('abc'); await O.entree();
  await sleep(150);
  t('hors de son tour : le champ reste là, rien ne s écrit, rien ne part au serveur',
    await O.ev(`!document.getElementById('mot').disabled && document.getElementById('mot').value === '' && /au tour de/i.test(document.getElementById('retour').textContent)`)
    && (await O.ev(`window.__envoye.slice(${avant}).filter((m) => m.action === 'typing' || m.action === 'submit').length`)) === 0);
  // Saisie relayée.
  await H.vider(); await H.taper('zzq');
  t('saisie en direct : l autre voit « zzq▌ »', await O.until(`document.getElementById('live').textContent === 'zzq' && document.getElementById('live').classList.contains('is-typing')`, 3000));
  // Refus.
  await H.taper(tour.prompt + 'xq'); await H.entree();
  t('refus : la raison, chez le joueur (« pas dans le dictionnaire »)', await H.until(`/pas dans le dictionnaire/.test(document.getElementById('retour').textContent)`, 3000));
  t('refus : montré à l autre, avec le mot', await O.until(`/zzq.*pas dans le dictionnaire/.test(document.getElementById('retour').textContent)`, 3000));
  t('refus : le tour continue (même cible, le texte reste pour corriger)', (await A.dernier('turn')).turnId === tour.turnId && await H.ev(`document.getElementById('mot').value.length > 0`));
  // Mot validé.
  const mot = motPour(tour.prompt);
  await H.vider(); await H.taper(mot); await H.entree();
  const t2 = await prochainTour(A, tour.turnId, 4000);
  t(`mot validé (« ${mot} ») : la roquette vise l autre`, !!t2 && t2.holder !== tour.holder);
  // Le jeu garde la forme du dictionnaire (« séné » → « ÉNÉ » surligné) : on
  // compare en forme normalisée, sans accents (ÉNÉ = ENE).
  t('mot validé : affiché avec le prompt mis en évidence', await O.until(`(() => { const m = document.querySelector('#feed li .w mark');
    const sans = (s) => s.normalize('NFD').replace(/\\p{Mn}/gu, '').toUpperCase().replace(/Œ/g, 'OE').replace(/Æ/g, 'AE');
    return !!m && sans(m.textContent) === ${JSON.stringify(tour.prompt.toUpperCase())}; })()`, 2000));
  await sleep(450);
  for (const p of pages) t(`${p.nom} : la roquette a pivoté vers la nouvelle cible (écart ${(await p.ev(ECART(t2.holder))).toFixed(1)}°)`, (await p.ev(ECART(t2.holder))) < 3);
  t('O, qui avait le focus dans le champ, le garde : c est à lui (clavier du téléphone jamais refermé)', await O.ev(`document.activeElement.id === 'mot' && document.getElementById('saisie').classList.contains('is-mine')`));
  await A.shot('2-partie-2j'); await B.shot('2-partie-2j-mobile');

  // Explosion : personne ne répond.
  const visee = t2.holder, P = parId(visee, ids);
  const boom = await (async () => { const f = Date.now() + 12000; while (Date.now() < f) { const b = await A.dernier('boom'); if (b) return b; await sleep(30); } return null; })();
  t('explosion : sur le joueur visé', !!boom && boom.id === visee);
  if (!REDUCED) {
    const vol = await A.until(`document.querySelector('.r-fly').getAnimations().length > 0 || document.querySelector('.boum')`, 1500);
    t('explosion : la roquette part (animation de vol), puis l éclat sur la carte', vol && await A.until(`!!document.querySelector('.boum')`, 2000));
    const pos = await A.ev(`(() => { const b = document.querySelector('.boum'); const g = document.querySelector('.card[data-id="${visee}"] .g-av'); if (!b || !g) return 999; const r = b.getBoundingClientRect(), q = g.getBoundingClientRect(); return Math.hypot(r.left + r.width / 2 - q.left - q.width / 2, r.top + r.height / 2 - q.top - q.height / 2); })()`);
    t(`explosion : l éclat est posé sur la bonne carte (${Math.round(pos)} px)`, pos < 30);
  } else {
    await sleep(250);
    t('mouvement réduit : aucune trajectoire, aucun éclat', await A.ev(`document.querySelector('.r-fly').getAnimations().length === 0 && !document.querySelector('.boum')`));
  }
  t('perte de vie : la carte montre ❤️🖤', await A.until(`document.querySelector('.card[data-id="${visee}"] .vies').textContent === '❤️🖤'`, 2500));
  t('perte de vie : lisible chez la victime aussi', await P.until(`document.querySelector('.card[data-id="${visee}"] .vies').textContent === '❤️🖤'`, 2500));
  t('perte de vie : écrite (fil) et annoncée', await A.ev(`/perd une vie/.test(document.getElementById('feed').textContent)`) && await A.until(`/perd une vie/.test(document.getElementById('annonce').textContent + document.getElementById('annonce-vite').textContent)`, 1500));
  await A.shot('3-explosion');
  t('retour au centre : la roquette réapparaît, au repos', await A.until(`(() => { const f = document.querySelector('.r-fly'), tr = getComputedStyle(f).transform.replace(/ /g, '');
    return !document.getElementById('rocket').classList.contains('is-gone') && f.getAnimations().length === 0 && (tr === 'none' || tr === 'matrix(1,0,0,1,0,0)'); })()`, 4000));
  const t3 = await prochainTour(A, t2.turnId, 6000);
  t('après la pause : la roquette vise le suivant, même prompt', !!t3 && t3.prompt === t2.prompt);
  await sleep(450);
  t(`… et l a bien en ligne de mire (écart ${(await A.ev(ECART(t3.holder))).toFixed(1)}°)`, (await A.ev(ECART(t3.holder))) < 3);
  if (REDUCED) {
    t('mouvement réduit : la rotation n est pas animée', await A.ev(`parseFloat(getComputedStyle(document.querySelector('.r-aim')).transitionDuration) < 0.01`));
    t('mouvement réduit : ni vibration ni balancement', await A.ev(`['.r-svg', '.r-bob'].every((s) => getComputedStyle(document.querySelector(s)).animationName === 'none')`));
  }
  // Danger : le tour vieillit, la roquette chauffe (temps écoulé seulement).
  t('danger : au bout de ~2,5 s sans réponse, la roquette chauffe', await A.until(`+document.getElementById('rocket').dataset.danger >= 1`, 4500));
  // Élimination : on laisse tout exploser jusqu'à la fin (2 vies chacun).
  const fin2 = await A.until(`!document.getElementById('end').hidden`, 30000);
  t('élimination puis fin : écran de fin chez les deux', fin2 && await B.until(`!document.getElementById('end').hidden`, 3000));
  const recuA = await A.recu();
  const elim = recuA.filter((m) => m.type === 'boom' && m.out);
  t('élimination : « 💀 2e » sur la carte du perdant (vue avant la fin)', elim.length === 1 && elim[0].rank === 2);
  t('fin : podium et classement (1er = dernier en vie), titre au focus', await A.ev(`document.querySelectorAll('#podium .marche').length === 2 && document.querySelectorAll('#ranking li').length === 2 && /gagne/.test(document.getElementById('end-title').textContent) && document.activeElement.id === 'end-title'`));
  t('fin : l hôte a « Rejouer », l invité attend', await A.ev(`!document.getElementById('again').hidden`) && await B.ev(`document.getElementById('again').hidden && !document.getElementById('wait-host').hidden`));
  await A.shot('4-fin'); await B.shot('4-fin-mobile');
  await A.clic('#to-lobby');
  t('« Retour au salon » : les deux reviennent au salon', await A.until(`!document.getElementById('lobby').hidden`, 3000) && await B.until(`!document.getElementById('lobby').hidden`, 3000));

  // ============================================================ 8 puis 16
  for (const N of [8, 16]) {
    const bots = [];
    const deja = robots.filter((b) => b.ws.readyState === 1).length;
    for (let i = deja; i < N - 2; i++) bots.push(robot('Robot' + (i + 1), code));
    t(`${N} joueurs : salon à « ${N} / 16 » chez les deux`, await A.until(`document.getElementById('lobby-count').textContent === '${N} / 16'`, 6000)
      && await B.until(`document.getElementById('lobby-count').textContent === '${N} / 16'`, 3000)
      && await B.ev(`document.querySelectorAll('#players li').length === ${N}`));
    if (N === 16) {
      const r17 = robot('Robot17', code);
      await sleep(400);
      t('16 joueurs : le 17e est refusé (partie complète), le salon ne bouge pas', /complète/.test(r17.refus || '') && await A.ev(`document.getElementById('lobby-count').textContent === '16 / 16'`));
      await A.shot('5-salon-16');
    }
    await A.ev(`document.getElementById('vies-select').value = '1'`);
    await A.clic('#start');
    await A.until(`document.getElementById('play').dataset.phase === 'turn'`, 8000);
    await B.until(`document.getElementById('play').dataset.phase === 'turn'`, 3000);
    // Plusieurs tours : la carte visée, la roquette, les cartes, partout.
    let ecartMax = 0, cibleOk = true, cartesOk = true, detail = '';
    let dernierId = 0;
    for (let k = 0; k < 6; k++) {
      const m = await prochainTour(A, dernierId, 12000);
      if (!m) break;
      dernierId = m.turnId;
      await sleep(350);
      for (const p of pages) {
        const e = await p.ev(ECART(m.holder));
        ecartMax = Math.max(ecartMax, e);
        const cs = await p.ev(CARTES);
        if (cs.cibles.length !== 1 || cs.cibles[0] !== m.holder) cibleOk = false;
        if (cs.n !== N || cs.cachees || cs.dehors || cs.chevauch) { cartesOk = false; detail = `${p.nom} ${JSON.stringify(cs)}`; }
      }
      // Si c'est à l'un des navigateurs : il joue au clavier (ou au tactile).
      const Pp = parId(m.holder, ids);
      if (Pp) { const w = motPour(m.prompt); await Pp.vider(); await Pp.taper(w); await Pp.entree(); }
    }
    t(`${N} joueurs : une seule carte visée, toujours la bonne (6 tours, 2 navigateurs)`, cibleOk);
    t(`${N} joueurs : la roquette vise la bonne carte (écart max ${ecartMax.toFixed(1)}°)`, ecartMax < 3);
    t(`${N} joueurs : ${N} cartes partout, aucune cachée, hors de l arène ou recouverte`, cartesOk, detail);
    const nomsA = (await A.ev(CARTES)).nomsVisibles, nomsB = (await B.ev(CARTES)).nomsVisibles;
    t(`${N} joueurs : noms écrits au bureau (${nomsA}/${N}) ; au téléphone, au moins la cible et soi (${nomsB})`, (N <= 8 ? nomsA === N : nomsA >= 2) && nomsB >= ((await B.dernier('turn')).holder === ids.B ? 1 : 2));
    t(`${N} joueurs : la bannière nomme la cible en toutes lettres`, await B.ev(`document.getElementById('cible').textContent.length > 2`));
    t(`${N} joueurs (téléphone) : prompt, roquette et champ visibles à l écran`,
      await B.ev(dansEcran('#prompt')) && await B.ev(dansEcran('#rocket')) && await B.ev(dansEcran('#mot')));
    await A.shot(`6-partie-${N}`); await B.shot(`6-partie-${N}-mobile`);
    if (N === 16) {
      // Clavier du téléphone ouvert : la fenêtre visible rétrécit (~430 px).
      await B.c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 430, deviceScaleFactor: 1, mobile: true });
      await B.ev(`document.getElementById('mot').focus()`);
      await sleep(500);
      const vise = (await B.dernier('turn')).holder;
      t('téléphone, clavier ouvert (430 px visibles) : prompt, roquette, champ ET carte visée à l écran',
        await B.ev(dansEcran('#prompt')) && await B.ev(dansEcran('#rocket')) && await B.ev(dansEcran('#mot')) && await B.ev(dansEcran(`.card[data-id="${vise}"]`)),
        JSON.stringify(await B.ev(`['#prompt', '#rocket', '#mot'].map((s) => { const r = document.querySelector(s).getBoundingClientRect(); return [s, Math.round(r.top), Math.round(r.bottom)]; })`)) + ' ' + JSON.stringify((await B.ev(CARTES)).geo) + ' scrollY ' + (await B.ev('Math.round(scrollY)')));
      t('téléphone, clavier ouvert : 16 cartes, aucune perdue ni recouverte', (await B.ev(CARTES)).n === 16 && !(await B.ev(CARTES)).chevauch && !(await B.ev(CARTES)).dehors);
      await B.shot('7-mobile-clavier-16');
      await B.c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 780, deviceScaleFactor: 1, mobile: true });
    }
    // Les robots s'en vont : la partie se termine (partir = être éliminé).
    fermerRobots(bots);
    t(`${N} joueurs : les robots partis, la partie se termine`, await A.until(`!document.getElementById('end').hidden`, 30000));
    t(`${N} joueurs : classement complet (${N} lignes, les partis marqués)`, await A.ev(`document.querySelectorAll('#ranking li').length === ${N} && document.getElementById('ranking').textContent.includes('parti')`));
    if (N === 16) {
      // La revanche, depuis l'écran de fin (on ne la joue pas jusqu'au bout).
      await A.clic('#again');
      t('revanche : « Rejouer » relance un décompte chez les deux', await A.until(`document.getElementById('play').dataset.phase === 'countdown' && !document.getElementById('play').hidden`, 4000)
        && await B.until(`!document.getElementById('play').hidden`, 4000));
    } else {
      await A.clic('#to-lobby');
      await A.until(`!document.getElementById('lobby').hidden`, 3000);
    }
  }

  console.log(`(info) visibilité vue pendant les mesures — A : ${await A.ev('[...(window.__vis || [])].join()')}, B : ${await B.ev('[...(window.__vis || [])].join()')}`);
  // ===================================== le temps ne sort jamais (fil + écran)
  const CHAMPS_INTERDITS = /explod|deadline|remain|restant|ends|dur[eé]e|timestamp|^at$|^ms$|time|reste/i;
  const NOMBRES = new Set(['n', 'turnId', 'lives', 'rank', 'words', 'vies', 'seconds', 'max']);
  let fautes = [];
  let total = 0;
  for (const p of pages) {
    const recu = await p.recu();
    total += recu.length;
    const parcours = (o, cle, ou) => {
      if (typeof o === 'number' && !NOMBRES.has(cle)) fautes.push(`${ou} nombre dans ${cle}`);
      else if (Array.isArray(o)) o.forEach((x) => parcours(x, cle, ou));
      else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { if (CHAMPS_INTERDITS.test(k)) fautes.push(`${ou} champ ${k}`); parcours(v, k, ou); }
    };
    recu.forEach((m, i) => parcours(m, 'type', `${p.nom}#${i}:${m.type}`));
  }
  t(`le fil : ${total} messages reçus par les deux navigateurs, aucun temps (échéance, reste, durée)`, !fautes.length, fautes.slice(0, 4).join(' | '));
  t('l écran : aucun chrono affiché pendant une partie (ni « 1,2 s », ni barre de progression)',
    await A.ev(`!/\\d+[.,]\\d+\\s?s\\b|\\d+\\s?ms\\b/.test(document.body.innerText) && !document.querySelector('progress, [role="progressbar"], meter')`));

  // ========================================================= connexion perdue
  srv.kill();
  t('serveur coupé : l écran « Connexion perdue » (jamais un faux salon)', await A.until(`!document.getElementById('lost').hidden`, 8000));
} catch (e) {
  t('exception', false, e.stack || e.message);
}

console.log(`\n${ok} OK, ${ko} KO${REDUCED ? ' (mouvement réduit)' : ''}`);
fin();
process.exit(ko ? 1 : 0);
