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
//      carte AVANT l'étoile commune, avec ses sons ; le Grenade Launcher tire
//      une grenade qui CULBUTE (halo, traînée) puis l'étoile commune seule ; le
//      Huntsman lâche SA FLÈCHE (l'arc reste), pointe devant, sans culbute ni
//      traînée, qui se plante dans la carte AVANT l'étoile commune ; la roquette
//      garde les siens ; en mouvement réduit, ni vol, ni traînée, ni éclat.
//
// Le Grenade Launcher (id marmite) est aussi mesuré à l'arrêt : ses marqueurs
// (Dossier Grenade Launcher), sa grenade cachée dans le canon, sa visée dans
// six directions, son enveloppe. Le Huntsman (id huntsman) aussi (Dossier
// Huntsman) : ses marqueurs et proportions, sa flèche VISIBLE encochée, la
// tension de sa corde à chaque cran de danger, sa visée dans six directions
// (ruban asymétrique), son enveloppe mesurée point par point contre le vrai fit().
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
  window.__recu = []; window.__envoye = []; window.__vu = []; window.__fx = []; window.__vol = []; window.__tirs = []; window.__sons = []; window.__err = []; window.__bandes = [];
  // Le recul de la corde du Huntsman (lu dans sa polyligne : le point d'encoche, au milieu).
  const recul = (r) => { const c = r.querySelector('.h-corde'); if (!c) return null; const p = c.getAttribute('points').trim().split(/\\s+/); return -40.8 - parseFloat(p[Math.floor(p.length / 2)]); };
  addEventListener('error', (e) => window.__err.push(String(e.message)));
  const W = window.WebSocket;
  window.WebSocket = function (u, p) {
    const ws = p ? new W(u, p) : new W(u);
    ws.addEventListener('message', (e) => {
      let m; try { m = JSON.parse(e.data); } catch (_) { return; }
      window.__recu.push(m);
      // Chaque explosion d'un Huntsman : jusqu'où la corde s'est bandée AVANT le
      // départ de la flèche, et où elle est revenue après.
      if (m.type === 'boom') {
        const t0 = performance.now(), b = { t: t0, max: 0, avantVol: 0, fin: null, skin: null };
        window.__bandes.push(b);
        const pas = () => {
          const r = document.getElementById('rocket'), x = recul(r);
          b.skin = r.dataset.skin;
          if (x !== null) { b.max = Math.max(b.max, x); if (!r.classList.contains('is-flying') && !r.classList.contains('is-shot')) b.avantVol = Math.max(b.avantVol, x); b.fin = x; }
          if (performance.now() - t0 < 1300) requestAnimationFrame(pas);
        };
        setTimeout(() => requestAnimationFrame(pas), 0);
      }
      if (m.type === 'countdown' || m.type === 'turn' || m.type === 'boom') {
        const t = performance.now();
        setTimeout(() => {
          const r = document.getElementById('rocket');
          window.__vu.push({ type: m.type, cible: m.type === 'turn' ? m.holder : m.type === 'boom' ? m.id : m.order[0],
            skin: r.dataset.skin, w: r.style.width, fumeeVol: !!r.querySelector('.p-fumee-vol'),
            anciens: !!r.querySelector('.p-trainee, .p-feu-arriere, text'),
            projVisible: !!r.querySelector('.r-proj') && getComputedStyle(r.querySelector('.r-proj')).visibility === 'visible',
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
    // Chaque éclat posé dans #fx ; pour la flèche plantée, son orientation et sa
    // taille, à comparer à la direction pivot → carte touchée et à l'arme.
    new MutationObserver((l) => l.forEach((x) => x.addedNodes.forEach((n) => {
      if (!n.className) return;
      const f = { cls: String(n.className), t: performance.now() };
      if (f.cls === 'huntsman-impact') {
        const h = document.getElementById('rocket'), hb = h.getBoundingClientRect(), pv = [hb.left + hb.width * Rocket.PIVOT, hb.top + hb.height / 2];
        const nb = n.getBoundingClientRect(), c = [parseFloat(n.style.left), parseFloat(n.style.top)], ar = document.getElementById('arena').getBoundingClientRect();
        f.a = parseFloat(n.style.getPropertyValue('--a')); f.attendu = Math.atan2(c[1] + ar.top - pv[1], c[0] + ar.left - pv[0]) * 180 / Math.PI;
        f.w = parseFloat(n.style.getPropertyValue('--w')); f.wRocket = hb.width; f.vue = !!n.querySelector('svg .hi-plume') && nb.width > 0;
      }
      window.__fx.push(f);
    }))).observe(document.getElementById('fx'), { childList: true });
    // Chaque VOL (.is-flying) : image par image, jusqu'où se sont éloignés du
    // repère (.r-aim, qui ne bouge pas pendant le vol) le calque qui vole
    // (.r-fly : toute la roquette), le projectile (.r-proj) et l'arme (.p-arme) ;
    // la course attendue (pivot → avatar visé, moins NEZ) ; l'éclair au départ.
    // Pour une arme à projectile : l'éclair visible, la gerbe et la bouffée
    // animées, le recul (rotation maximale de l'arme), la fusée visible, sa tête
    // DEVANT son corps (produit scalaire avec la direction de tir), la fumée rouge.
    // Et chaque IMPACT d'une arme à projectile (.is-shot) : qui reste visible.
    const r = document.getElementById('rocket');
    const ctr = (e) => { const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; };
    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    let vole = false, tire = false;
    new MutationObserver(() => {
      const v = r.classList.contains('is-flying');
      if (v && !vole) {
        const h = r.getBoundingClientRect(), pivot = [h.left + h.width * Rocket.PIVOT, h.top + h.height / 2];
        const av = document.querySelector('.card.is-target .g-av');
        const rec = { skin: r.dataset.skin, t: performance.now(), eclair: r.classList.contains('is-firing'), w: h.width,
          course: av ? dist(ctr(av), pivot) - h.width * Rocket.NEZ : 0, fly: 0, proj: 0, arme: 0, projSousArme: false,
          eclairVu: false, gerbe: false, bouffee: false, rotMax: 0, projVu: false, teteDevant: null, fumee: 0, fumeeRouge: false,
          // la grenade (Grenade Launcher) : rotation CUMULÉE du groupe qui culbute,
          // halo et traînée au plus fort, position le long du tir (départ, plus loin)
          grenadeVu: false, tours: 0, angPrec: null, halo: 0, trainee: 0, depart: null, loin: 0,
          // la flèche (Huntsman) : vue à chaque image, son plus grand écart d'angle
          // (encoche → pointe) avec la direction du tir, rotation cumulée, pointe
          // devant, éléments visibles du calque HORS de la flèche (une traînée)
          flecheVu: false, flecheImages: 0, ecartMax: 0, flecheTours: 0, flecheAngPrec: null, pointeDevant: null, horsFleche: 0, flecheCachee: false, flecheLueur: false };
        const p = r.querySelector('.r-proj'), a = r.querySelector('.p-arme');
        rec.projSousArme = !!(p && a && (p.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING));
        const dir = av ? (() => { const c = ctr(av), n = dist(c, pivot) || 1; return [(c[0] - pivot[0]) / n, (c[1] - pivot[1]) / n]; })() : [1, 0];
        if (a) {
          const ec = a.querySelector('.p-eclair'), ge = a.querySelector('.p-gerbe'), bo = a.querySelector('.p-bouffee');
          rec.eclairVu = !!ec && getComputedStyle(ec).opacity === '1';
          rec.gerbe = !!ge && ge.getAnimations().length > 0;
          rec.bouffee = !!bo && bo.getAnimations().length > 0;
        }
        window.__vol.push(rec);
        const pas = () => {
          if (!r.classList.contains('is-flying')) return;
          const base = ctr(r.querySelector('.r-aim')), pr = r.querySelector('.r-proj'), ar = r.querySelector('.p-arme');
          rec.fly = Math.max(rec.fly, dist(ctr(r.querySelector('.r-fly')), base));
          if (pr) rec.proj = Math.max(rec.proj, dist(ctr(pr), base));
          if (ar) {
            rec.arme = Math.max(rec.arme, dist(ctr(ar), base));
            const tf = getComputedStyle(ar).transform, m = tf === 'none' ? null : new DOMMatrix(tf);
            if (m) rec.rotMax = Math.max(rec.rotMax, Math.abs(Math.atan2(m.b, m.a) * 180 / Math.PI));
          }
          if (pr && getComputedStyle(pr).visibility === 'visible') {
            rec.projVu = true;
            const te = pr.querySelector('.p-tete'), co = pr.querySelector('.p-corps'), fu = pr.querySelector('.p-fumee-vol');
            if (te && co) { const a2 = ctr(te), b2 = ctr(co), d = (a2[0] - b2[0]) * dir[0] + (a2[1] - b2[1]) * dir[1]; rec.teteDevant = rec.teteDevant === null ? d : Math.min(rec.teteDevant, d); }
            if (fu) { rec.fumee = Math.max(rec.fumee, +getComputedStyle(fu).opacity); const c = (getComputedStyle(fu.querySelector('circle')).fill.match(/[0-9]+/g) || []).map(Number); rec.fumeeRouge = c[0] > 150 && c[1] < 80 && c[2] < 70; }
            const mt = pr.querySelector('.m-tourne');
            if (mt) {
              rec.grenadeVu = true;
              const tf2 = getComputedStyle(mt).transform, m2 = tf2 === 'none' ? new DOMMatrix() : new DOMMatrix(tf2);
              const ang = Math.atan2(m2.b, m2.a) * 180 / Math.PI;
              if (rec.angPrec !== null) rec.tours += Math.abs(((ang - rec.angPrec) % 360 + 540) % 360 - 180);
              rec.angPrec = ang;
              rec.halo = Math.max(rec.halo, +getComputedStyle(pr.querySelector('.m-halo')).opacity);
              const tt = getComputedStyle(pr.querySelector('.m-trainee')).transform;
              rec.trainee = Math.max(rec.trainee, tt === 'none' ? 1 : new DOMMatrix(tt).a);
              const gc = ctr(pr.querySelector('.m-grenade')), le = (gc[0] - pivot[0]) * dir[0] + (gc[1] - pivot[1]) * dir[1];
              if (rec.depart === null) rec.depart = le;
              rec.loin = Math.max(rec.loin, le);
            }
            const fl = pr.querySelector('.h-fleche');
            if (fl) {
              rec.flecheVu = true; rec.flecheImages++;
              const po = ctr(pr.querySelector('.h-pointe')), en = ctr(pr.querySelector('.h-encoche-bout'));
              const ang = Math.atan2(po[1] - en[1], po[0] - en[0]) * 180 / Math.PI, dang = Math.atan2(dir[1], dir[0]) * 180 / Math.PI;
              rec.ecartMax = Math.max(rec.ecartMax, Math.abs(((ang - dang) % 360 + 540) % 360 - 180));
              if (rec.flecheAngPrec !== null) rec.flecheTours += Math.abs(((ang - rec.flecheAngPrec) % 360 + 540) % 360 - 180);
              rec.flecheAngPrec = ang;
              const d = (po[0] - en[0]) * dir[0] + (po[1] - en[1]) * dir[1];
              rec.pointeDevant = rec.pointeDevant === null ? d : Math.min(rec.pointeDevant, d);
              // tout ce qui se dessine dans le calque de la flèche, hors de la flèche elle-même
              const hors = [...pr.querySelectorAll('svg *')].filter((e) => e instanceof SVGGraphicsElement && e.tagName !== 'g' && !e.closest('defs, .h-encoche')
                && getComputedStyle(e).visibility === 'visible' && +getComputedStyle(e).opacity > 0 && e.getBoundingClientRect().width > 0);
              rec.horsFleche = Math.max(rec.horsFleche, hors.length);
              if (getComputedStyle(pr.querySelector('svg.p-fleche')).filter !== 'none') rec.flecheLueur = true;
            }
          } else if (pr && pr.querySelector('.h-fleche')) {
            rec.flecheCachee = true;
          }
          requestAnimationFrame(pas);
        };
        requestAnimationFrame(pas);
      }
      vole = v;
      const s = r.classList.contains('is-shot');
      if (s && !tire) window.__tirs.push({ skin: r.dataset.skin, t: performance.now(),
        proj: getComputedStyle(r.querySelector('.r-proj')).visibility, arme: getComputedStyle(r.querySelector('.p-arme')).opacity,
        fly: getComputedStyle(r.querySelector('.r-fly')).opacity, gone: r.classList.contains('is-gone') });
      tire = s;
    }).observe(r, { attributes: true, attributeFilter: ['class'] });
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
      if (e.closest('defs, .r-proj') || e.tagName === 'g' || !(e instanceof SVGGraphicsElement)) return;
      const b = e.getBoundingClientRect(); if (!b.width && !b.height) return;
      for (const [x, y] of [[b.left, b.top], [b.right, b.top], [b.left, b.bottom], [b.right, b.bottom]]) max = Math.max(max, Math.hypot(x - px, y - py) * k);
    });
    out[id + d] = Math.round(max * 10) / 10;
    h.remove();
  }
  return out;
})()`;

// La portée PRÉCISE d'une arme : chaque élément dessiné (arme ET projectile)
// échantillonné le long de sa géométrie (getPointAtLength), ramené à l'écran
// par sa matrice, plus la moitié de son trait. La boîte englobante ne suffit pas
// pour la corde tendue du Huntsman : ses coins sont loin de tout trait. Les
// éléments découpés (ruban, embouts : dans le corps) ne comptent pas.
const ECHANTILLONS = `const echantillons = (racine, px, py) => {
  let max = 0, pts = [], demiMax = 0;
  racine.querySelectorAll('svg *').forEach((e) => {
    if (!(e instanceof SVGGeometryElement) || e.closest('defs, clipPath, [clip-path]')) return;
    const cs = getComputedStyle(e); if (cs.visibility !== 'visible' || cs.display === 'none') return;
    const m = e.getScreenCTM(); if (!m) return;
    const k = Math.hypot(m.a, m.b), demi = cs.stroke && cs.stroke !== 'none' ? parseFloat(cs.strokeWidth) * k / 2 : 0;
    demiMax = Math.max(demiMax, demi);
    const L = e.getTotalLength();
    for (let i = 0; i <= 160; i++) {
      const q = e.getPointAtLength(L * i / 160), s = new DOMPoint(q.x, q.y).matrixTransform(m);
      pts.push([s.x, s.y]); max = Math.max(max, Math.hypot(s.x - px, s.y - py) + demi);
    }
  });
  return { max, pts, demi: demiMax };
};`;

try {
  const A = await onglet('A');
  const B = await onglet('B', { reduit: true });

  // ======================================================= 1. la table des armes
  t('table des armes : roquette, petoire, marmite et huntsman, roquette par défaut', await A.ev(`JSON.stringify(Rocket.SKINS) === '["roquette","petoire","marmite","huntsman"]' && Rocket.DEFAUT === 'roquette'`));
  t('id inconnu, absent ou mal formé → roquette (disrupteur, Marmite, Huntsman, Petoire, __proto__, constructor, 42, null, objet)',
    await A.ev(`['disrupteur', 'Marmite', ' marmite', 'Huntsman', 'huntsman ', 'Petoire', ' petoire', '__proto__', 'constructor', 'toString', 42, null, undefined, {}, ['petoire'], ['marmite'], ['huntsman']].every((v) => Rocket.skinId(v) === 'roquette') && Rocket.skinId('petoire') === 'petoire' && Rocket.skinId('marmite') === 'marmite' && Rocket.skinId('huntsman') === 'huntsman'`));
  t('Rocket.info d un id inconnu : la roquette (nom, sons, pas de feu)',
    await A.ev(`(() => { const i = Rocket.info('disrupteur'); return i.id === 'roquette' && i.depart === 'whoosh' && i.impact === 'impact' && i.couche === null; })()`));
  t('Rocket.info(marmite) : « Le Grenade Launcher », son tube au départ, impact de la roquette, AUCUNE couche d impact (étoile commune seule)',
    await A.ev(`(() => { const i = Rocket.info('marmite'); return i.id === 'marmite' && i.nom === 'Le Grenade Launcher' && i.court === 'Grenade Launcher' && i.depart === 'tube' && i.impact === 'impact' && i.couche === null; })()`));
  t('Rocket.info(huntsman) : « Le Huntsman », la corde au départ, le coup sourd à l impact, la flèche plantée comme couche d impact',
    await A.ev(`(() => { const i = Rocket.info('huntsman'); return i.id === 'huntsman' && i.nom === 'Le Huntsman' && i.court === 'Huntsman' && i.depart === 'corde' && i.impact === 'plante' && i.couche === 'huntsman-impact'; })()`));
  // La Pétoire et le Grenade Launcher : leur dessin, à l'octet près, est celui
  // d'avant le Huntsman (empreintes relevées sur le commit précédent).
  t('Pétoire et Grenade Launcher inchangés (empreintes f5b2ef1f et bef33a64, mêmes fiches)', await A.ev(`(() => {
    const h = (d) => { let x = 0x811c9dc5; for (let i = 0; i < d.length; i++) { x ^= d.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; } return x.toString(16) + '/' + d.length; };
    const p = Rocket.info('petoire'), m = Rocket.info('marmite');
    return h(Rocket.dessin('petoire', 'r')) === 'f5b2ef1f/9028' && h(Rocket.dessin('marmite', 'r')) === 'bef33a64/10143'
      && p.depart === 'fusee' && p.impact === 'crepitement' && p.couche === 'scorch-impact' && m.couche === null;
  })()`));
  // La Pétoire = une ARME + un PROJECTILE : deux éléments distincts, aucun ne
  // contient l'autre ; le projectile (.r-proj) est AVANT l'arme dans le DOM
  // (dessous à l'écran) ; la tête qui brûle est dans le projectile, l'éclair de
  // bouche dans l'arme. La roquette n'a ni l'un ni l'autre.
  t('Pétoire : l arme et le projectile sont deux éléments distincts (arme svg.p-arme, projectile .r-proj > svg.p-fusee)', await A.ev(`(() => {
    const h = document.createElement('div'); h.style.cssText = 'position:fixed;left:0;top:0;width:250px;aspect-ratio:250/92'; document.body.append(h);
    const r = Rocket.create(h); r.setSkin('petoire');
    const arme = h.querySelectorAll('svg.p-arme'), proj = h.querySelectorAll('.r-proj'), fusee = h.querySelectorAll('.r-proj > svg.p-fusee');
    const a = arme[0], p = proj[0];
    const ok = arme.length === 1 && proj.length === 1 && fusee.length === 1 && a !== fusee[0]
      && !a.contains(p) && !p.contains(a) && a.parentNode === p.parentNode
      && !!(p.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING)
      && !!p.querySelector('.p-tete') && !!p.querySelector('.p-corps') && !!p.querySelector('.p-fumee-vol') && !a.querySelector('.p-tete, .p-corps, .p-fumee-vol')
      && !!a.querySelector('.p-eclair') && !p.querySelector('.p-eclair')
      && getComputedStyle(p).position === 'absolute' && getComputedStyle(a).position === 'absolute';
    const b1 = a.getBoundingClientRect(), b2 = p.getBoundingClientRect();
    const memeBoite = [b1.left, b1.top, b1.width, b1.height].join() === [b2.left, b2.top, b2.width, b2.height].join();
    r.setSkin('roquette'); const roquette = !h.querySelector('.r-proj, .p-arme, .p-fusee') && h.querySelectorAll('svg.r-svg').length === 1;
    h.remove(); return ok && memeBoite && roquette;
  })()`));
  // La Pétoire = le Scorch Shot de TF2 redessiné (dossier de référence validé).
  // Ses marqueurs, mesurés sur un hôte de 250 px (1 unité du dessin = 1 px) :
  // canon droit ~3 diamètres, bouche peinte en orange (~30 %, bord déchiqueté),
  // poignée avant noire côtelée SOUS le canon avec sa goupille à l'avant,
  // petite crosse derrière et en dessous, longueur / hauteur ≈ 1,85–1,95.
  const scorch = await A.ev(`(() => {
    const h = document.createElement('div'); h.style.cssText = 'position:fixed;left:300px;top:300px;width:250px;aspect-ratio:250/92'; document.body.append(h);
    const r = Rocket.create(h); r.setSkin('petoire');
    const a = h.querySelector('.p-arme'), q = (s) => a.querySelector(s), bb = (e) => e.getBoundingClientRect();
    const marqueurs = ['.p-canon', '.p-peinture', '.p-poignee-avant', '.p-goupille', '.p-crosse', '.p-pontet', '.p-chien'].filter((s) => !q(s));
    const can = bb(q('.p-canon')), pei = bb(q('.p-peinture')), poi = bb(q('.p-poignee-avant')), gou = bb(q('.p-goupille')), cro = bb(q('.p-crosse'));
    const corps = ['.p-canon', '.p-crosse', '.p-chien', '.p-pontet', '.p-poignee-avant'].map((s) => bb(q(s)));
    const L = Math.max(...corps.map((b) => b.right)) - Math.min(...corps.map((b) => b.left)), H = Math.max(...corps.map((b) => b.bottom)) - Math.min(...corps.map((b) => b.top));
    const peinture = q('.p-peinture'), dents = (peinture.getAttribute('d').match(/L/g) || []).length;
    const grad = document.getElementById((peinture.getAttribute('fill').match(/#([^)]+)/) || [])[1]);
    const out = {
      marqueurs, cotes: a.querySelectorAll('.p-poignee-avant .p-cote').length,
      canonLD: +(can.width / can.height).toFixed(2), peintureBout: Math.abs(pei.right - can.right) < 1.5, peinturePart: +(pei.width / can.width).toFixed(2), dents,
      orange: !!grad && [...grad.querySelectorAll('stop')].some((s) => s.getAttribute('stop-color') === '#c87d4c'),
      sousCanon: poi.top >= can.bottom - 3, poigneeDe: +((poi.left - can.left) / can.width).toFixed(2), poigneeA: +((poi.right - can.left) / can.width).toFixed(2),
      goupilleAvant: gou.left >= poi.right - 6, crosse: cro.right < can.left + 2 && cro.bottom > can.bottom + 30,
      LH: +(L / H).toFixed(2), chargeeInvisible: getComputedStyle(h.querySelector('.r-proj')).visibility === 'hidden',
    };
    const html = h.innerHTML;
    out.ancien = /p-trainee|p-feu-arriere|PAS UN JOUET|<text|#ff4f9a|#f7bfd3|#e8c39a|#efcfa8/i.test(html);
    h.remove(); return out;
  })()`);
  t(`Scorch Shot : les 7 marqueurs dessinés (canon, peinture, poignée avant, goupille, crosse, pontet, chien) et 6 côtes`, scorch.marqueurs.length === 0 && scorch.cotes === 6, JSON.stringify(scorch));
  t(`Scorch Shot : canon droit de ~3 diamètres (${scorch.canonLD})`, scorch.canonLD >= 2.8 && scorch.canonLD <= 3.3);
  t(`Scorch Shot : bouche peinte en orange #c87d4c, ~30 % du canon (${scorch.peinturePart}), au bout, bord déchiqueté (${scorch.dents} segments)`,
    scorch.orange && scorch.peintureBout && scorch.peinturePart >= 0.25 && scorch.peinturePart <= 0.36 && scorch.dents >= 6);
  t(`Scorch Shot : poignée avant SOUS le canon, de ${scorch.poigneeDe} à ${scorch.poigneeA} de sa longueur, goupille à l avant`,
    scorch.sousCanon && scorch.poigneeDe >= 0.3 && scorch.poigneeDe <= 0.45 && scorch.poigneeA >= 0.9 && scorch.goupilleAvant);
  t(`Scorch Shot : petite crosse derrière et sous le canon, longueur / hauteur ${scorch.LH} (dossier : ~1,85)`, scorch.crosse && scorch.LH >= 1.75 && scorch.LH <= 2.05);
  t('Pétoire : chargée, la fusée est invisible (rien ne dépasse de la bouche)', scorch.chargeeInvisible);
  t('Pétoire : plus rien de l ancien dessin (traînée rose, flamme arrière, pansement, pochoir)', !scorch.ancien);
  // La roquette d'origine : son dessin et sa fiche, à l'octet près (empreinte relevée avant ce lot).
  t('Roquette d origine inchangée (empreinte du dessin 38f1849d, même fiche)', await A.ev(`(() => {
    const d = Rocket.dessin('roquette', 'r'); let h = 0x811c9dc5; for (let i = 0; i < d.length; i++) { h ^= d.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    const i = Rocket.info('roquette');
    return h.toString(16) === '38f1849d' && d.length === 3570 && i.nom === 'La Roquette' && i.depart === 'whoosh' && i.impact === 'impact' && i.couche === null;
  })()`));
  // Une arme non symétrique se retourne quand elle vise à gauche : la crosse
  // reste en BAS quelle que soit la direction (droite, gauche, bas, haut-gauche).
  const crosse = await A.ev(`(async () => {
    const h = document.createElement('div'); h.style.cssText = 'position:fixed;left:400px;top:300px;width:250px;aspect-ratio:250/92'; document.body.append(h);
    const r = Rocket.create(h); r.setSkin('petoire');
    const out = {};
    for (const [nom, dx, dy] of [['droite', 300, 0], ['gauche', -300, 0], ['bas-gauche', -200, 150], ['haut-gauche', -200, -150], ['bas-droite', 200, 150]]) {
      const c = document.createElement('div'); const b = h.getBoundingClientRect(), px = b.left + b.width * Rocket.PIVOT, py = b.top + b.height / 2;
      c.style.cssText = 'position:fixed;width:10px;height:10px;left:' + (px + dx - 5) + 'px;top:' + (py + dy - 5) + 'px'; document.body.append(c);
      r.aimAt(c, { instant: true }); await new Promise((f) => setTimeout(f, 250));
      const g = h.querySelector('.p-crosse').getBoundingClientRect(), gy = g.top + g.height / 2;
      // « en bas » dans le repère de l'arme : du côté où la normale de l'axe pointe vers le bas de l'écran
      const ang = Math.atan2(dy, dx), nx = -Math.sin(ang), ny = Math.cos(ang), sens = ny >= 0 ? 1 : -1;
      const gx = g.left + g.width / 2;
      out[nom] = { bas: ((gx - px) * nx + (gy - py) * ny) * sens > 0, gauche: h.classList.contains('is-gauche') };
      c.remove();
    }
    h.remove(); return out;
  })()`);
  t(`Pétoire : crosse toujours vers le bas, retournée quand elle vise à gauche (${Object.entries(crosse).map(([k, v]) => k + (v.bas ? ' ✓' : ' ✗') + (v.gauche ? ' (retournée)' : '')).join(', ')})`,
    Object.values(crosse).every((v) => v.bas) && crosse.gauche.gauche && !crosse.droite.gauche, JSON.stringify(crosse));

  // Le Grenade Launcher (id marmite) = le lance-grenades du Demoman, d'après le
  // Dossier Grenade Launcher validé. Deux calques comme la Pétoire, puis ses
  // marqueurs MESURÉS sur un hôte de 250 px (1 unité du dessin = 1 px), en
  // diamètres du canon (D = 17 u) : bouche à +60 sur l'axe, cage plus haute que
  // le canon des deux côtés (surtout dessous), canon qui sort du HAUT du
  // barillet, ~3,5 D devant la cage, crosse derrière la cage (~41 % de l'arme),
  // hausse au-dessus du canon (~1,8 D) à ~1 D de la bouche, garde-main dessous,
  // 10 D de long, longueur / hauteur ≈ 3,2. Grenade chargée DANS le canon et
  // invisible ; halo, traînée, ogive et bande rouges ; ni flamme ni rose.
  const gl = await A.ev(`(() => {
    const h = document.createElement('div'); h.style.cssText = 'position:fixed;left:300px;top:300px;width:250px;aspect-ratio:250/92'; document.body.append(h);
    const r = Rocket.create(h); r.setSkin('marmite');
    const a = h.querySelector('svg.p-arme'), p = h.querySelector('.r-proj'), g = h.querySelector('.r-proj > svg.p-grenade');
    const q = (s) => a.querySelector(s), bb = (e) => e.getBoundingClientRect();
    const hb = h.getBoundingClientRect(), px = hb.left + 128, py = hb.top + 46;
    const out = {
      calques: !!a && !!p && !!g && h.querySelectorAll('svg.p-arme').length === 1 && h.querySelectorAll('.r-proj').length === 1
        && !a.contains(p) && !p.contains(a) && a.parentNode === p.parentNode && !!(p.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING)
        && !!g.querySelector('.m-tourne .m-grenade') && !!g.querySelector('.m-halo') && !!g.querySelector('.m-trainee') && !a.querySelector('.m-grenade, .m-halo, .m-trainee')
        && !!a.querySelector('.p-eclair') && !g.querySelector('.p-eclair')
        && getComputedStyle(p).position === 'absolute' && getComputedStyle(a).position === 'absolute'
        && [bb(a).left, bb(a).top, bb(a).width, bb(a).height].join() === [bb(p).left, bb(p).top, bb(p).width, bb(p).height].join(),
      manque: ['.m-crosse', '.m-cage', '.m-barillet', '.m-canon', '.m-hausse', '.m-garde-main', '.m-pontet', '.m-chien', '.m-ferrure', '.m-collier'].filter((s) => !q(s)),
    };
    if (out.manque.length) { h.remove(); return out; }
    const cro = bb(q('.m-crosse')), cag = bb(q('.m-cage')), can = bb(q('.m-canon')), hau = bb(q('.m-hausse')), gar = bb(q('.m-garde-main')), fer = bb(q('.m-ferrure')), bar = bb(q('.m-barillet'));
    const D = can.height, corps = [cro, cag, can, gar, fer];
    const L = Math.max(...corps.map((b) => b.right)) - Math.min(...corps.map((b) => b.left)), H = Math.max(...corps.map((b) => b.bottom)) - Math.min(...corps.map((b) => b.top));
    const stops = (el) => { const id = ((el.getAttribute('fill') || '').match(/#([^)]+)/) || [])[1]; const gr = id && document.getElementById(id); return gr ? [...gr.querySelectorAll('stop')].map((s) => s.getAttribute('stop-color')) : []; };
    const rouge = (c) => { const m = /^#(..)(..)(..)$/.exec(c || ''); if (!m) return false; const [R, G, B] = m.slice(1).map((x) => parseInt(x, 16)); return R > 180 && G < 90 && B < 90; };
    Object.assign(out, {
      D: +D.toFixed(1), bouche: +(can.right - px).toFixed(1), axe: +((can.top + can.bottom) / 2 - py).toFixed(1),
      cageDessus: +((can.top - cag.top) / D).toFixed(2), cageDessous: +((cag.bottom - can.bottom) / D).toFixed(2),
      canonHaut: (can.top + can.bottom) / 2 < (cag.top + cag.bottom) / 2 - 3, canonLong: +((can.right - cag.right) / D).toFixed(2),
      crosseDerriere: cro.right <= cag.left + 1, crossePart: +(cro.width / L).toFixed(2),
      hausseDessus: hau.bottom <= can.top + .5, hausseHaut: +((can.top - hau.top) / D).toFixed(2), hausseBouche: +((can.right - (hau.left + hau.right) / 2) / D).toFixed(2),
      gardeSous: gar.top >= can.bottom - 1 && gar.right <= can.right && gar.left >= cag.right - 1,
      barillet: bar.left >= cag.left && bar.right <= cag.right && bar.top >= cag.top && bar.bottom <= cag.bottom, chambres: q('.m-barillet').querySelectorAll('rect[rx]').length,
      LH: +(L / H).toFixed(2), LD: +(L / D).toFixed(2),
      bois: stops(q('.m-crosse')).includes('#925439'), noir: stops(q('.m-canon')).includes('#31322b'), gris: stops(q('.m-cage')).includes('#62615b'),
    });
    const gr = bb(g.querySelector('.m-grenade'));
    out.chargee = { invisible: getComputedStyle(p).visibility === 'hidden',
      dansCanon: gr.left >= can.left && gr.right <= can.right + .5 && gr.top >= can.top && gr.bottom <= can.bottom, L: +gr.width.toFixed(1), H: +gr.height.toFixed(1) };
    out.rouges = { halo: stops(g.querySelector('.m-halo circle')).some(rouge), trainee: stops(g.querySelector('.m-trainee')).some(rouge),
      ogive: stops(g.querySelector('.m-ogive')).some(rouge), bande: rouge(g.querySelector('.m-bande').getAttribute('fill')) };
    out.interdits = /r-flamme|p-trainee|p-feu-arriere|p-fumee-vol|p-fusee|#ff4f9a|#f7bfd3|<text/i.test(h.innerHTML);
    h.remove(); return out;
  })()`);
  t('Grenade Launcher : l arme et le projectile sont deux calques distincts (svg.p-arme, .r-proj > svg.p-grenade), projectile dessous, même boîte', gl.calques, JSON.stringify(gl));
  t(`Grenade Launcher : les 10 marqueurs dessinés (crosse, cage, barillet, canon, hausse, garde-main, pontet, chien, ferrure, collier)`, gl.manque.length === 0, gl.manque.join());
  t(`Grenade Launcher : bouche à +60 sur l axe du pivot (${gl.bouche} ; axe ${gl.axe}), canon de 17 u (${gl.D})`, Math.abs(gl.bouche - 60) <= 1.5 && Math.abs(gl.axe) <= 1 && Math.abs(gl.D - 17) <= 1);
  t(`Grenade Launcher : barillet massif, cage plus haute que le canon (dessus ${gl.cageDessus} D, dessous ${gl.cageDessous} D), deux chambres dans la cage`,
    gl.cageDessus >= .5 && gl.cageDessous >= 1.2 && gl.barillet && gl.chambres === 2);
  t(`Grenade Launcher : long canon qui sort du HAUT du barillet (${gl.canonLong} D devant la cage)`, gl.canonHaut && gl.canonLong >= 3 && gl.canonLong <= 3.8);
  t(`Grenade Launcher : crosse de fusil derrière la cage (${Math.round(gl.crossePart * 100)} % de l arme), en bois #925439`, gl.crosseDerriere && gl.crossePart >= .36 && gl.crossePart <= .46 && gl.bois);
  t(`Grenade Launcher : hausse au-dessus du canon (${gl.hausseHaut} D), près de la bouche (${gl.hausseBouche} D), garde-main sous le canon`,
    gl.hausseDessus && gl.hausseHaut >= 1.5 && gl.hausseHaut <= 2.2 && gl.hausseBouche >= .5 && gl.hausseBouche <= 1.4 && gl.gardeSous);
  t(`Grenade Launcher : proportions du dossier, ${gl.LD} D de long, longueur / hauteur ${gl.LH} (~3,2) ; canon noir #31322b, cage grise #62615b`,
    gl.LD >= 9.5 && gl.LD <= 10.5 && gl.LH >= 2.9 && gl.LH <= 3.5 && gl.noir && gl.gris);
  t(`Grenade Launcher : chargée, la grenade est INVISIBLE et tient DANS le canon (${gl.chargee && gl.chargee.L} × ${gl.chargee && gl.chargee.H} px)`,
    gl.chargee.invisible && gl.chargee.dansCanon && gl.chargee.L >= 22 && gl.chargee.L <= 26 && gl.chargee.H < gl.D, JSON.stringify(gl.chargee));
  t('Grenade Launcher : halo, traînée, ogive et bande ROUGES ; ni flamme, ni traînée rose, ni rien de la Pétoire', Object.values(gl.rouges).every(Boolean) && !gl.interdits, JSON.stringify(gl.rouges));

  // La visée : à droite comme à gauche, la crosse reste en BAS et la hausse en
  // HAUT, la bouche est du côté de la cible, et l'arme n'est jamais déformée
  // (même distance bouche → talon dans toutes les directions).
  const viseeGL = await A.ev(`(async () => {
    const h = document.createElement('div'); h.style.cssText = 'position:fixed;left:400px;top:300px;width:250px;aspect-ratio:250/92'; document.body.append(h);
    const r = Rocket.create(h); r.setSkin('marmite');
    const out = {};
    const ctr = (s) => { const b = h.querySelector(s).getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; };
    for (const [nom, dx, dy] of [['droite', 300, 0], ['gauche', -300, 0], ['bas-gauche', -200, 150], ['haut-gauche', -200, -150], ['bas-droite', 200, 150], ['haut-droite', 200, -150]]) {
      const c = document.createElement('div'); const b = h.getBoundingClientRect(), px = b.left + b.width * Rocket.PIVOT, py = b.top + b.height / 2;
      c.style.cssText = 'position:fixed;width:10px;height:10px;left:' + (px + dx - 5) + 'px;top:' + (py + dy - 5) + 'px'; document.body.append(c);
      r.aimAt(c, { instant: true }); await new Promise((f) => setTimeout(f, 250));
      const ang = Math.atan2(dy, dx), nx = -Math.sin(ang), ny = Math.cos(ang), sens = ny >= 0 ? 1 : -1;
      const cote = (p) => ((p[0] - px) * nx + (p[1] - py) * ny) * sens;      // > 0 : vers le bas de l'écran
      const cr = ctr('.m-crosse'), ha = ctr('.m-hausse'), ca = ctr('.m-canon');
      out[nom] = { crosseBas: cote(cr) > 0, hausseHaut: cote(ha) < 0, canonVers: (ca[0] - px) * Math.cos(ang) + (ca[1] - py) * Math.sin(ang) > 0,
        gauche: h.classList.contains('is-gauche'), longueur: Math.round(Math.hypot(ca[0] - cr[0], ca[1] - cr[1]) * 10) / 10 };
      c.remove();
    }
    h.remove(); return out;
  })()`);
  const longueurs = Object.values(viseeGL).map((v) => v.longueur);
  t(`Grenade Launcher, visée : crosse en bas, hausse en haut, canon vers la cible dans les 6 directions (${Object.entries(viseeGL).map(([k, v]) => k + (v.crosseBas && v.hausseHaut && v.canonVers ? ' ✓' : ' ✗') + (v.gauche ? ' (retournée)' : '')).join(', ')})`,
    Object.values(viseeGL).every((v) => v.crosseBas && v.hausseHaut && v.canonVers), JSON.stringify(viseeGL));
  t('Grenade Launcher, visée : retournée à gauche seulement', viseeGL.gauche.gauche && viseeGL['bas-gauche'].gauche && viseeGL['haut-gauche'].gauche && !viseeGL.droite.gauche && !viseeGL['bas-droite'].gauche && !viseeGL['haut-droite'].gauche);
  t(`Grenade Launcher, visée : aucune déformation (canon → crosse : ${[...new Set(longueurs)].join(' / ')} px)`, Math.max(...longueurs) - Math.min(...longueurs) <= 1, JSON.stringify(longueurs));

  // Le Huntsman (id huntsman) = l'arc du Sniper, d'après le Dossier Huntsman
  // validé. Deux calques (l'arc, la flèche), puis ses marqueurs MESURÉS sur un
  // hôte de 250 px (1 unité du dessin = 1 px) : arc de 151 u, pointes à -72 et
  // +80 de l'axe (la flèche au-dessus du milieu), profondeur corde → dos de la
  // poignée ~23 %, flèche de 103 u dont ~66 % devant la poignée, pointe sur +60 ;
  // embouts recourbés vers l'avant ; ruban asymétrique (bande courte en haut,
  // long manchon en bas, deux bandes à la poignée de part et d'autre de la
  // flèche) ; flèche VISIBLE encochée ; couleurs du relevé.
  const hu = await A.ev(`(() => {
    const h = document.createElement('div'); h.style.cssText = 'position:fixed;left:300px;top:300px;width:250px;aspect-ratio:250/92'; document.body.append(h);
    const r = Rocket.create(h); r.setSkin('huntsman');
    h.getAnimations({ subtree: true }).forEach((x) => { x.pause(); x.currentTime = 0; });
    const a = h.querySelector('svg.p-arme'), p = h.querySelector('.r-proj'), f = h.querySelector('.r-proj > svg.p-fleche');
    const bb = (e) => e.getBoundingClientRect(), hb = bb(h), px = hb.left + 128, py = hb.top + 46;
    const out = {
      calques: !!a && !!p && !!f && h.querySelectorAll('svg.p-arme').length === 1 && h.querySelectorAll('.r-proj').length === 1
        && !a.contains(p) && !p.contains(a) && a.parentNode === p.parentNode && !!(p.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING)
        && !!f.querySelector('.h-encoche .h-fleche .h-pointe') && !a.querySelector('.h-fleche, .h-pointe') && !f.querySelector('.h-bois, .h-corde')
        && getComputedStyle(p).position === 'absolute' && getComputedStyle(a).position === 'absolute'
        && [bb(a).left, bb(a).top, bb(a).width, bb(a).height].join() === [bb(p).left, bb(p).top, bb(p).width, bb(p).height].join(),
      manque: ['.h-bois', '.h-embout-haut', '.h-embout-bas', '.h-ruban-haut', '.h-ruban-bas', '.h-ruban-poignee', '.h-plaque-haut', '.h-plaque-bas', '.h-corde']
        .filter((q) => !a.querySelector(q)).concat(['.h-pointe', '.h-ligature', '.h-fut', '.h-bague', '.h-plume-haut', '.h-plume-bas', '.h-encoche-bout'].filter((q) => !f.querySelector(q))),
    };
    if (out.manque.length) { h.remove(); return out; }
    const q = (s) => h.querySelector(s), bois = bb(q('.h-bois'));
    const geo = (s) => { const e = q(s), m = e.getScreenCTM(), L = e.getTotalLength(), pts = []; for (let i = 0; i <= 400; i++) { const z = e.getPointAtLength(L * i / 400), w = new DOMPoint(z.x, z.y).matrixTransform(m); pts.push([w.x - px, w.y - py]); } return pts; };
    const corps = geo('.h-bois'), haut = corps.reduce((m, z) => z[1] < m[1] ? z : m), bas = corps.reduce((m, z) => z[1] > m[1] ? z : m);
    // la gorge de chaque embout : le point du corps le plus à gauche (côté corde) sous la pointe
    const gorgeH = corps.filter((z) => z[1] > -66 && z[1] < -50).reduce((m, z) => z[0] < m[0] ? z : m), gorgeB = corps.filter((z) => z[1] > 58 && z[1] < 74).reduce((m, z) => z[0] < m[0] ? z : m);
    const corde = q('.h-corde').getAttribute('points').trim().split(/\\s+/).map((c) => c.split(',').map(Number)), encoche = corde[Math.floor(corde.length / 2)];
    const fl = [bb(q('.h-pointe')), bb(q('.h-ligature')), bb(q('.h-fut')), bb(q('.h-encoche-bout')), bb(q('.h-plume-haut')), bb(q('.h-plume-bas'))];
    const L = Math.max(...fl.map((b) => b.right)) - Math.min(...fl.map((b) => b.left)), pointe = bb(q('.h-pointe'));
    const ctrY = (s) => { const b = bb(q(s)); return (b.top + b.bottom) / 2 - py; };
    const longueur = (s) => q(s).getTotalLength();
    const stops = (el) => { const id = ((el.getAttribute('fill') || '').match(/#([^)]+)/) || [])[1]; const gr = id && document.getElementById(id); return gr ? [...gr.querySelectorAll('stop')].map((x) => x.getAttribute('stop-color')) : []; };
    const rgb = (c) => { const m = /^#(..)(..)(..)$/.exec(c || ''); return m ? m.slice(1).map((x) => parseInt(x, 16)) : [0, 0, 0]; };
    const fil = rgb(h.querySelector('.h-corde-fil').getAttribute('stroke')), plume = rgb(q('.h-plume-haut').getAttribute('fill'));
    const bandes = [...q('.h-ruban-poignee').querySelectorAll('rect')].map((x) => { const b = bb(x); return (b.top + b.bottom) / 2 - py; });
    Object.assign(out, {
      hauteur: +(bois.height).toFixed(1), pointeHaut: +haut[1].toFixed(1), pointeBas: +bas[1].toFixed(1),
      recourbeH: +(haut[0] - gorgeH[0]).toFixed(1), recourbeB: +(bas[0] - gorgeB[0]).toFixed(1),
      dos: +(bois.right - px).toFixed(1), profondeur: +((bois.right - px - encoche[0]) / bois.height).toFixed(3),
      fleche: +L.toFixed(1), bout: +(pointe.right - px).toFixed(1), axe: +((pointe.top + pointe.bottom) / 2 - py).toFixed(1),
      devant: +((pointe.right - bois.right) / L).toFixed(2), largeurPointe: +(pointe.height).toFixed(1), encocheCorde: +(encoche[0] - (bb(q('.h-encoche-bout')).left - px)).toFixed(1),
      rubanHaut: +ctrY('.h-ruban-haut').toFixed(1), rubanBas: +ctrY('.h-ruban-bas').toFixed(1), asym: +(longueur('.h-ruban-bas') / longueur('.h-ruban-haut')).toFixed(2),
      bandes: bandes.map((y) => +y.toFixed(1)),
      bois: stops(q('.h-bois')).includes('#795e43'), ruban: q('.h-ruban-haut').getAttribute('stroke') === '#242424' && q('.h-ruban-bas').getAttribute('stroke') === '#242424',
      embout: stops(q('.h-embout-haut')).includes('#454341'), pointeGrise: stops(q('.h-pointe')).includes('#41433f'), fut: stops(q('.h-fut')).includes('#675543'),
      kaki: fil[0] > fil[2] + 20 && fil[1] > fil[2] + 20 && Math.abs(fil[0] - fil[1]) < 16, creme: plume[0] > 200 && plume[1] > 190 && plume[2] > 150 && plume[2] < plume[0],
      bague: q('.h-bague').getAttribute('fill') === '#1d1d1d', ligatureNoire: q('.h-ligature').getAttribute('fill') === '#222',
      encocheeVisible: getComputedStyle(p).visibility === 'visible' && getComputedStyle(q('.h-pointe')).visibility === 'visible',
      tension: r.tension,
      interdits: /r-flamme|r-fumee|r-chaleur|p-eclair|p-gerbe|p-bouffee|trainee|p-fumee-vol|m-halo|<text/i.test(h.innerHTML),
    });
    h.remove(); return out;
  })()`);
  t('Huntsman : l arc et la flèche sont deux calques distincts (svg.p-arme, .r-proj > svg.p-fleche), flèche dessous, même boîte', hu.calques, JSON.stringify(hu));
  t(`Huntsman : les 16 marqueurs dessinés (bois, 2 embouts, 3 rubans, 2 plaques, corde ; pointe, ligature, fût, bague, 2 plumes, encoche)`, hu.manque.length === 0, hu.manque.join());
  t(`Huntsman : arc de 151 u (${hu.hauteur}), pointes à ${hu.pointeHaut} et +${hu.pointeBas} de l axe (la flèche au-dessus du milieu, 47 %)`,
    Math.abs(hu.hauteur - 151) <= 3 && Math.abs(hu.pointeHaut + 72) <= 2 && Math.abs(hu.pointeBas - 80) <= 2 && -hu.pointeHaut < hu.pointeBas);
  t(`Huntsman : « D » en bois, profondeur corde → dos de la poignée ${Math.round(hu.profondeur * 100)} % (dossier : 23 %), dos à ${hu.dos} (dossier : -8)`,
    hu.profondeur >= .2 && hu.profondeur <= .25 && Math.abs(hu.dos + 8) <= 1.5);
  t(`Huntsman : embouts recourbés vers l AVANT, à l opposé de la corde (haut +${hu.recourbeH} u, bas +${hu.recourbeB} u)`, hu.recourbeH >= 3 && hu.recourbeB >= 3);
  t(`Huntsman : ruban ASYMÉTRIQUE — bande courte en haut (${hu.rubanHaut}), long manchon en bas (${hu.rubanBas}, ${hu.asym} × plus long), deux bandes à la poignée de part et d autre de la flèche (${hu.bandes.join(' / ')})`,
    hu.rubanHaut < -25 && hu.rubanBas > 25 && hu.asym >= 3 && hu.bandes.length === 2 && hu.bandes[0] < 0 && hu.bandes[1] > 0 && hu.bandes.every((y) => Math.abs(y) < 12));
  t(`Huntsman : flèche de 103 u (${hu.fleche}), pointe sur +60 (${hu.bout}) dans l axe (${hu.axe}), ${Math.round(hu.devant * 100)} % devant la poignée (dossier : 66 %), pointe large de ${hu.largeurPointe} u`,
    Math.abs(hu.fleche - 103.2) <= 2.5 && Math.abs(hu.bout - 60) <= 1.5 && Math.abs(hu.axe) <= .6 && hu.devant >= .62 && hu.devant <= .70 && hu.largeurPointe >= 7 && hu.largeurPointe <= 10);
  t(`Huntsman : la corde passe dans l encoche (${hu.encocheCorde} u derrière le bout de la flèche), au repos (tension ${hu.tension})`, hu.encocheCorde > 0 && hu.encocheCorde <= 3.2 && hu.tension === 0);
  t('Huntsman : au repos, la flèche est VISIBLE, encochée sur l arc', hu.encocheeVisible);
  t('Huntsman : couleurs du relevé — bois #795e43, ruban #242424, embouts #454341, corde kaki, pointe #41433f, ligature et bague noires, fût #675543, plumes crème',
    hu.bois && hu.ruban && hu.embout && hu.kaki && hu.pointeGrise && hu.ligatureNoire && hu.bague && hu.fut && hu.creme, JSON.stringify(hu));
  t('Huntsman : rien d une arme à feu (ni éclair, ni gerbe, ni fumée, ni flamme, ni traînée, ni halo)', !hu.interdits);

  // La tension de la corde à chaque cran de danger (habillage : le danger reste
  // celui du jeu) : le recul de l'encoche, la flèche qui suit, la pointe contre
  // la poignée au cran 3, et le tremblement du cran 3 seulement.
  const tension = await A.ev(`(async () => {
    const h = document.createElement('div'); h.style.cssText = 'position:fixed;left:300px;top:300px;width:250px;aspect-ratio:250/92'; document.body.append(h);
    const r = Rocket.create(h); r.setSkin('huntsman');
    const hb = h.getBoundingClientRect(), px = hb.left + 128, out = [];
    for (const n of [0, 1, 2, 3, 2, 0]) {
      r.setDanger(n); await new Promise((f) => setTimeout(f, 520));
      const c = h.querySelector('.h-corde').getAttribute('points').trim().split(/\\s+/), x = parseFloat(c[Math.floor(c.length / 2)].split(',')[0]);
      const po = h.querySelector('.h-pointe').getBoundingClientRect(), en = h.querySelector('.h-encoche-bout').getBoundingClientRect(), dos = h.querySelector('.h-bois').getBoundingClientRect().right - px;
      const anims = [...h.querySelectorAll('svg.r-svg')].map((s) => s.getAnimations().map((a) => a.animationName).join()).join('|');
      out.push({ n, tension: r.tension, encoche: +x.toFixed(1), pointe: +(po.right - px).toFixed(1), suit: +(x - (en.left - px)).toFixed(1), collet: +(po.left - px).toFixed(1), dos: +dos.toFixed(1), anims });
    }
    h.remove(); return out;
  })()`);
  const tn = tension.map((x) => x.tension);
  t(`Huntsman : la corde se tend avec le danger (recul ${tension.slice(0, 4).map((x) => x.tension).join(' → ')} u aux crans 0 à 3), et se détend (${tn.slice(3).join(' → ')})`,
    JSON.stringify(tn) === JSON.stringify([0, 12, 33, 60, 33, 0]), JSON.stringify(tension));
  t('Huntsman : la flèche recule AVEC la corde (l encoche reste sur la corde à chaque cran)', tension.every((x) => x.suit > 0 && x.suit <= 3.2 && Math.abs(x.encoche + 40.8 + x.tension) < .2), JSON.stringify(tension));
  // « contre la poignée » : le dos de la poignée tombe DANS la pointe (entre son
  // collet et son bout), et plus de 5 u de pointe dépassent encore devant.
  t(`Huntsman : à bande complète, la pointe vient contre la poignée (pointe de ${tension[3].collet} à ${tension[3].pointe}, dos de la poignée à ${tension[3].dos})`,
    Math.abs(tension[3].pointe) <= 1.5 && tension[3].collet <= tension[3].dos && tension[3].dos <= tension[3].pointe - 5, JSON.stringify(tension[3]));
  t(`Huntsman : tremblement fin au cran 3 SEULEMENT, aucun aux crans 0 à 2 (${tension.slice(0, 4).map((x) => x.n + ':' + (x.anims.replace(/\|/g, '/') || '—')).join(' ')})`,
    tension.every((x) => x.n === 3 ? x.anims.split('|').every((a) => a === 'h-trem') : x.anims.split('|').every((a) => a === '')), JSON.stringify(tension.map((x) => x.anims)));

  // La visée : à droite comme à gauche, le MANCHON reste sur la branche du BAS
  // de l'écran et la bande courte en haut (ruban asymétrique : retournée à
  // gauche), la corde reste DERRIÈRE, la pointe vers la cible, rien déformé.
  const viseeHU = await A.ev(`(async () => {
    const h = document.createElement('div'); h.style.cssText = 'position:fixed;left:400px;top:300px;width:250px;aspect-ratio:250/92'; document.body.append(h);
    const r = Rocket.create(h); r.setSkin('huntsman');
    const out = {};
    const ctr = (s) => { const b = h.querySelector(s).getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; };
    for (const [nom, dx, dy] of [['droite', 300, 0], ['gauche', -300, 0], ['bas-gauche', -200, 150], ['haut-gauche', -200, -150], ['bas-droite', 200, 150], ['haut-droite', 200, -150]]) {
      const c = document.createElement('div'); const b = h.getBoundingClientRect(), px = b.left + b.width * Rocket.PIVOT, py = b.top + b.height / 2;
      c.style.cssText = 'position:fixed;width:10px;height:10px;left:' + (px + dx - 5) + 'px;top:' + (py + dy - 5) + 'px'; document.body.append(c);
      r.aimAt(c, { instant: true }); await new Promise((f) => setTimeout(f, 250));
      const ang = Math.atan2(dy, dx), nx = -Math.sin(ang), ny = Math.cos(ang), sens = ny >= 0 ? 1 : -1, ux = Math.cos(ang), uy = Math.sin(ang);
      const cote = (p) => ((p[0] - px) * nx + (p[1] - py) * ny) * sens, long = (p) => (p[0] - px) * ux + (p[1] - py) * uy;
      const mb = ctr('.h-ruban-bas'), mh = ctr('.h-ruban-haut'), po = ctr('.h-pointe'), co = ctr('.h-corde'), eh = ctr('.h-embout-haut'), eb = ctr('.h-embout-bas');
      out[nom] = { manchonBas: cote(mb) > 0, bandeHaut: cote(mh) < 0, pointeVers: long(po) > 40, cordeDerriere: long(co) < -20,
        gauche: h.classList.contains('is-gauche'), envergure: Math.round(Math.hypot(eh[0] - eb[0], eh[1] - eb[1]) * 10) / 10 };
      c.remove();
    }
    h.remove(); return out;
  })()`);
  const env = Object.values(viseeHU).map((v) => v.envergure);
  t(`Huntsman, visée : manchon en bas, bande courte en haut, corde derrière, pointe vers la cible dans les 6 directions (${Object.entries(viseeHU).map(([k, v]) => k + (v.manchonBas && v.bandeHaut && v.cordeDerriere && v.pointeVers ? ' ✓' : ' ✗') + (v.gauche ? ' (retourné)' : '')).join(', ')})`,
    Object.values(viseeHU).every((v) => v.manchonBas && v.bandeHaut && v.cordeDerriere && v.pointeVers), JSON.stringify(viseeHU));
  t('Huntsman, visée : retourné à gauche seulement', viseeHU.gauche.gauche && viseeHU['bas-gauche'].gauche && viseeHU['haut-gauche'].gauche && !viseeHU.droite.gauche && !viseeHU['bas-droite'].gauche && !viseeHU['haut-droite'].gauche);
  t(`Huntsman, visée : aucune déformation (embout → embout : ${[...new Set(env)].join(' / ')} px)`, Math.max(...env) - Math.min(...env) <= 1, JSON.stringify(env));

  // L'enveloppe du Huntsman, point par point (arc, corde ET flèche encochée) :
  // au repos et à bande complète, puis contre le VRAI fit() — un disque, un
  // obstacle, la taille que fit() pose : rien de l'arc tendu n'approche
  // l'obstacle plus près que la marge (6 px).
  const envHU = await A.ev(`(async () => {
    ${ECHANTILLONS}
    const out = {};
    for (const n of [0, 3]) {
      const h = document.createElement('div'); h.style.cssText = 'position:fixed;left:300px;top:300px;width:250px;aspect-ratio:250/92'; document.body.append(h);
      const r = Rocket.create(h); r.setSkin('huntsman'); r.setDanger(n); await new Promise((f) => setTimeout(f, 520));
      h.getAnimations({ subtree: true }).forEach((x) => { x.pause(); x.currentTime = 0; });
      const hb = h.getBoundingClientRect(), px = hb.left + 128, py = hb.top + 46, e = echantillons(h, px, py);
      out['d' + n] = Math.round(e.max * 10) / 10;
      if (n === 0) {   // contrôle de la méthode : l'échantillonnage du corps retrouve sa boîte
        const c = h.querySelector('.h-bois'), b = c.getBoundingClientRect(), m = c.getScreenCTM(), L = c.getTotalLength(), xs = [], ys = [];
        for (let i = 0; i <= 600; i++) { const z = c.getPointAtLength(L * i / 600), w = new DOMPoint(z.x, z.y).matrixTransform(m); xs.push(w.x); ys.push(w.y); }
        out.controle = Math.max(Math.abs(Math.min(...xs) - b.left), Math.abs(Math.max(...xs) - b.right), Math.abs(Math.min(...ys) - b.top), Math.abs(Math.max(...ys) - b.bottom));
      }
      h.remove();
    }
    // le vrai fit() : un disque de 400 px, un obstacle à 150 px du centre
    const d = document.createElement('div'); d.style.cssText = 'position:fixed;left:200px;top:100px;width:400px;height:400px;display:grid;place-items:center'; document.body.append(d);
    const h = document.createElement('div'); h.style.cssText = 'aspect-ratio:250/92'; d.append(h);
    const o = document.createElement('div'); o.style.cssText = 'position:fixed;left:550px;top:290px;width:20px;height:20px'; document.body.append(o);
    const r = Rocket.create(h); r.setSkin('huntsman'); r.fit([o]);
    const db = d.getBoundingClientRect(), cx = db.left + 200, cy = db.top + 200, place = 550 - cx;
    out.largeur = parseFloat(h.style.width); out.rayon = Math.round(Rocket.EMPRISE * out.largeur * 10) / 10; out.place = place;
    for (const [nom, dx, dy] of [['droite', 1, 0], ['gauche', -1, 0], ['haut', 0, -1], ['bas-gauche', -1, 1]]) {
      const c = document.createElement('div'); c.style.cssText = 'position:fixed;width:4px;height:4px;left:' + (cx + dx * 120) + 'px;top:' + (cy + dy * 120) + 'px'; document.body.append(c);
      r.aimAt(c, { instant: true }); r.setDanger(3); await new Promise((f) => setTimeout(f, 520));
      h.getAnimations({ subtree: true }).forEach((x) => { x.pause(); x.currentTime = 0; });
      const hb = h.getBoundingClientRect(), pvx = hb.left + hb.width * Rocket.PIVOT, pvy = hb.top + hb.height / 2;
      const e = echantillons(h, pvx, pvy);
      // le jeu : la plus petite distance d'un point dessiné (trait compris) à l'obstacle
      const jeu = Math.min(...e.pts.map(([x, y]) => Math.hypot(Math.max(550 - x, 0, x - 570), Math.max(290 - y, 0, y - 310)))) - e.demi;
      out['fit-' + nom] = { r: Math.round(e.max * 10) / 10, jeu: Math.round(jeu * 10) / 10 };
      r.setDanger(0); c.remove();
    }
    d.remove(); o.remove(); return out;
  })()`);
  const emprise = await A.ev('Rocket.EMPRISE * 250');
  t(`enveloppe : le Huntsman, point par point, tient dans EMPRISE (repos ${envHU.d0} u, bande complète ${envHU.d3} u ≤ ${Math.round(emprise * 10) / 10} u ; contrôle de la méthode ${envHU.controle.toFixed(2)} px)`,
    envHU.d3 <= emprise && envHU.d0 <= emprise && envHU.d3 > envHU.d0 && envHU.d3 > 95 && envHU.controle < .6, JSON.stringify(envHU));
  const dirsFit = ['droite', 'gauche', 'haut', 'bas-gauche'];
  t(`enveloppe : contre le VRAI fit() (largeur ${envHU.largeur} px, rayon réservé ${envHU.rayon} px), l arc tendu reste dans le cercle (${dirsFit.map((k) => envHU['fit-' + k].r).join(' / ')} px) et ne touche jamais l obstacle (jeu ${dirsFit.map((k) => envHU['fit-' + k].jeu).join(' / ')} px)`,
    dirsFit.every((k) => envHU['fit-' + k].r <= envHU.rayon + .5 && envHU['fit-' + k].jeu > 0) && envHU.largeur > 240 && envHU.largeur < 360, JSON.stringify(envHU));

  const portee = await A.ev(PORTEE);
  t(`enveloppe : la Pétoire ne va pas plus loin du pivot que la roquette (danger 3 : ${portee.petoire3} ≤ ${portee.roquette3} ; danger 0 : ${portee.petoire0})`,
    portee.petoire3 <= portee.roquette3 && portee.petoire0 <= portee.roquette3 && portee.petoire3 > 50, JSON.stringify(portee));
  t(`enveloppe : le Grenade Launcher tient dans la place que fit() réserve (danger 3 : ${portee.marmite3} ≤ ${portee.roquette3} ; danger 0 : ${portee.marmite0} ; EMPRISE ${await A.ev('Math.round(Rocket.EMPRISE * 2500) / 10')})`,
    portee.marmite3 <= portee.roquette3 && portee.marmite0 <= portee.roquette3 && portee.marmite3 <= await A.ev('Rocket.EMPRISE * 250') && portee.marmite3 > 100, JSON.stringify(portee));
  t('changer d arme ne change pas la taille posée (largeur, hauteur)', await A.ev(`(() => {
    const h = document.createElement('div'); h.style.cssText = 'position:fixed;left:0;top:0;width:213px;aspect-ratio:250/92;';
    document.body.append(h);
    const r = Rocket.create(h), mesure = () => { const b = h.getBoundingClientRect(); return [b.width, b.height, h.style.width].join(); };
    const avant = mesure(); r.setSkin('petoire'); const apres = mesure(); const skin = h.dataset.skin;
    r.setSkin('marmite'); const gl = mesure(); const skin2 = h.dataset.skin; r.setSkin('huntsman'); const hu = mesure(); const skin3 = h.dataset.skin;
    r.setSkin('roquette'); const retour = mesure();
    h.remove(); return avant === apres && apres === gl && gl === hu && hu === retour && skin === 'petoire' && skin2 === 'marmite' && skin3 === 'huntsman' && h.dataset.skin === 'roquette';
  })()`));
  t('enveloppe : la roquette tient dans EMPRISE (le rayon que fit() lui réserve)',
    await A.ev(`${portee.roquette3} <= Rocket.EMPRISE * 250 + 4`), `${portee.roquette3} vs ${await A.ev('Rocket.EMPRISE * 250')}`);

  // ============================================================== 2. le salon
  t('A, sans préférence : la roquette est choisie (aria-pressed), seule',
    await A.ev(`localStorage.getItem('roquette_skin') === null && ${choixEst('roquette')} && document.querySelectorAll('.skin-pick').length === 4`));
  await A.clic('#name-input'); await A.taper('Alice');
  await A.clic('#host');
  await A.until(`!document.getElementById('lobby').hidden && /^[A-Z]{4}$/.test(document.getElementById('room-code').textContent)`);
  const code = await A.ev(`document.getElementById('room-code').textContent`);
  const idA = await A.ev(`window.__recu.find((m) => m.type === 'you').id`);
  const joinA = (await envoyes(A, 'join'))[0];
  t('join de A : skin « roquette » (aucune préférence)', joinA && joinA.skin === 'roquette', JSON.stringify(joinA));
  t('salon : le sélecteur est visible, quatre armes avec aperçu et nom',
    await A.ev(`document.getElementById('skin-choix').checkVisibility() && [...document.querySelectorAll('.skin-pick')].every((b) => b.querySelector('svg.r-svg') && b.textContent.trim().length > 4)`)
    && await A.ev(`[...document.querySelectorAll('.skin-pick')].map((b) => b.querySelector('.skin-nom').textContent).join('|') === 'La Roquette|La Pétoire de Secours|Le Grenade Launcher|Le Huntsman'`)
    && await A.ev(`[...document.querySelectorAll('.skin-apercu svg')].every((s) => s.getAttribute('aria-hidden') === 'true')`));
  const apercuHU = await A.ev(`(() => {
    const b = document.querySelector('.skin-pick[data-skin="huntsman"]'), bb = b.getBoundingClientRect(), nom = b.querySelector('.skin-nom').getBoundingClientRect();
    const arc = b.querySelector('.h-bois').getBoundingClientRect(), fl = b.querySelector('.h-pointe').getBoundingClientRect(), ap = b.querySelector('.skin-apercu');
    return { dedans: arc.top >= bb.top + 1 && arc.bottom <= nom.top + 1 && arc.left >= bb.left && fl.right <= bb.right, hauteur: Math.round(arc.height),
      flecheVue: getComputedStyle(b.querySelector('.r-proj')).visibility === 'visible', ids: ap.querySelectorAll('[id^="apercu-huntsman-"]').length };
  })()`);
  t(`salon : l aperçu du Huntsman tient dans son bouton, au-dessus du nom (arc de ${apercuHU.hauteur} px), flèche encochée visible, dégradés préfixés`,
    apercuHU.dedans && apercuHU.hauteur >= 40 && apercuHU.flecheVue && apercuHU.ids >= 5, JSON.stringify(apercuHU));
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
  await A.ev(`NET.dispatch({ type: 'skin', id: ${JSON.stringify(R1.id)}, skin: 'disrupteur' })`);
  t('id inconnu reçu (disrupteur) → affiché comme la roquette', (await A.ev(tagDe(R1.id))) === 'Roquette');
  R1.send({ action: 'skin', skin: 'roquette' });        // le serveur repasse R1 en roquette (et le relaie)
  await A.until(`window.__recu.some((m) => m.type === 'skin' && m.id === ${JSON.stringify(R1.id)} && m.skin === 'roquette')`, 3000);

  // B : la préférence locale, relue au chargement.
  await B.ev(`localStorage.setItem('roquette_skin', 'disrupteur')`);
  await B.recharger();
  t('B, préférence locale INVALIDE (disrupteur) → la roquette est choisie', await B.ev(choixEst('roquette')));
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
  // B passe au Grenade Launcher : c'est son arme pour la partie.
  await B.clic('.skin-pick[data-skin="marmite"]');
  t('B choisit le Grenade Launcher : relayé, A voit B en « Grenade Launcher »', await A.until(`${tagDe(idB)} === 'Grenade Launcher'`, 3000)
    && (await envoyes(B, 'skin')).some((m) => m.skin === 'marmite'));

  // R2 : nouveau client, roquette explicite ; il tape à chaque tour (il gagne).
  const R2 = robot('Robot2', code, { mode: 'answer', skin: 'roquette' });
  await R2.attend((m) => m.type === 'you');
  // R3 : tape tant que les quatre « muets » n'ont pas explosé, puis se tait — c'est
  // lui qui prend la DERNIÈRE explosion (celle que la fin de partie interrompt :
  // `end` arrive avec elle). Les quatre explosions étudiées ont ainsi leur effet entier.
  const R3 = robot('Robot3', code, { skin: 'roquette', mode: (b) => b.msgs.filter((m) => m.type === 'boom').length < 4 });
  await R3.attend((m) => m.type === 'you');
  // R4 : nouveau client au Huntsman (dans son join), muet : son explosion est celle de l'arc.
  const R4 = robot('Robot4', code, { mode: 'silent', skin: 'huntsman' });
  await R4.attend((m) => m.type === 'you');
  await A.until(`document.getElementById('lobby-count').textContent === '6 / 16'`);
  t('salon à 6 : A Pétoire, R1 Roquette, B Grenade Launcher, R2 et R3 Roquette, R4 Huntsman (chez A)',
    (await A.ev(`[${[idA, R1.id, idB, R2.id, R3.id, R4.id].map(tagDe).join(',')}].join()`)) === 'Pétoire,Roquette,Grenade Launcher,Roquette,Roquette,Huntsman');
  t('le serveur relaie le Huntsman du join de R4 (lobby : skin « huntsman »)', await A.ev(`window.__recu.some((m) => m.type === 'lobby' && m.players.some((p) => p.id === ${JSON.stringify(R4.id)} && p.skin === 'huntsman'))`));
  await A.shot('1-salon-A');

  // ============================================================= 3. la partie
  const attendu = { [idA]: 'petoire', [R1.id]: 'roquette', [idB]: 'marmite', [R2.id]: 'roquette', [R3.id]: 'roquette', [R4.id]: 'huntsman' };
  await A.ev(`document.getElementById('vies-select').value = '1'`);
  await A.clic('#start');
  t('lancement : plus de sélecteur pendant la partie',
    await A.until(`document.getElementById('play').dataset.phase === 'countdown' || document.getElementById('play').dataset.phase === 'turn'`)
    && await A.ev(`!document.getElementById('skin-choix').checkVisibility()`));
  // Les captures (--shots), dès que chaque moment apparaît, dans l'ordre où la
  // partie les amène : la Pétoire en jeu et l'impact du Scorch Shot ; le
  // Grenade Launcher en jeu, en vol (la grenade à mi-course) et à l'impact.
  let petJeu = !SHOTS, feuCapture = !SHOTS, glJeu = !SHOTS, glVol = !SHOTS, glImpact = !SHOTS, glVise = false;
  let huJeu = !SHOTS, huVol = !SHOTS, huImpact = !SHOTS;
  const guetteur = (async () => {
    while (!petJeu || !feuCapture || !glJeu || !glVol || !glImpact || !huJeu || !huVol || !huImpact) {
      if (!petJeu && await A.ev(`document.getElementById('rocket').dataset.skin === 'petoire' && document.getElementById('play').dataset.phase === 'turn'`)) {
        await sleep(200); await A.shot('2-petoire-A'); petJeu = true;
      }
      const e = await A.ev(`(() => { const r = document.getElementById('rocket'), p = r.querySelector('.r-proj'), a = p && p.getAnimations().find((x) => !(x instanceof CSSAnimation));
        return { feu: !!document.querySelector('#fx .scorch-impact'), fin: !document.getElementById('end').hidden, phase: document.getElementById('play').dataset.phase,
          gl: r.dataset.skin === 'marmite', hu: r.dataset.skin === 'huntsman', vol: r.classList.contains('is-flying'), t: a ? a.currentTime : 0,
          boum: !!document.querySelector('#fx .boum'), plantee: !!document.querySelector('#fx .huntsman-impact') }; })()`);
      if (e.fin) break;
      if (!feuCapture && e.feu) { await sleep(40); await A.shot('2b-impact-A'); feuCapture = true; }
      if (!glJeu && e.gl && e.phase === 'turn') { await sleep(300); await A.shot('4-grenade-launcher-A'); glJeu = true; }
      if (!glVol && e.gl && e.vol && e.t > 150) { await A.shot('4b-grenade-vol-A'); glVol = true; glVise = true; }
      if (!glImpact && glVise && e.boum) { await A.shot('4c-grenade-impact-A'); glImpact = true; }
      if (!huJeu && e.hu && e.phase === 'turn') { await sleep(300); await A.shot('5-huntsman-A'); huJeu = true; }
      if (!huVol && e.hu && e.vol && e.t > 150) { await A.shot('5b-huntsman-vol-A'); huVol = true; }
      if (!huImpact && e.plantee) { await sleep(60); await A.shot('5c-huntsman-impact-A'); huImpact = true; }
      await sleep(15);
    }
  })();
  const fini = await A.until(`!document.getElementById('end').hidden`, 90000);
  await guetteur;
  t('la partie va au bout (cinq explosions, R2 gagne)', fini && await A.ev(`/Robot2/.test(document.getElementById('end-title').textContent)`));
  await A.shot('3-fin-A');
  await sleep(1600);              // le filet d'impact (1,3 s) de la dernière explosion

  for (const P of [A, B]) {
    const vu = await P.ev('window.__vu');
    const faux = vu.filter((v) => v.skin !== attendu[v.cible]);
    const types = vu.reduce((o, v) => ((o[v.type] = (o[v.type] || 0) + 1), o), {});
    t(`${P.nom} : l arme montrée est celle du joueur visé, à chaque countdown / turn / boom (${JSON.stringify(types)})`,
      faux.length === 0 && types.countdown === 1 && types.turn >= 5 && types.boom === 5, JSON.stringify(faux.slice(0, 3)));
    const skinsVus = new Set(vu.map((v) => v.skin));
    t(`${P.nom} : les quatre armes ont été montrées`, skinsVus.has('petoire') && skinsVus.has('roquette') && skinsVus.has('marmite') && skinsVus.has('huntsman'));
    t(`${P.nom} : la fumée de vol n existe que dans la Pétoire, l ancien dessin (traînée rose, flamme arrière, pochoir) nulle part`,
      vu.every((v) => v.fumeeVol === (v.skin === 'petoire') && !v.anciens));
    t(`${P.nom} : chargé, le projectile (fusée, grenade) est INVISIBLE (à chaque décompte et chaque tour)`, vu.filter((v) => v.type !== 'boom' && v.skin !== 'huntsman').every((v) => !v.projVisible));
    const tirsHU = vu.filter((v) => v.type !== 'boom' && v.skin === 'huntsman');
    t(`${P.nom} : la flèche du Huntsman est VISIBLE, encochée, à chacun de ses tours (${tirsHU.length})`, tirsHU.length >= 1 && tirsHU.every((v) => v.projVisible));
    t(`${P.nom} : aucun sélecteur pendant la partie`, vu.every((v) => !v.choix));
    const booms = vu.filter((v) => v.type === 'boom');
    t(`${P.nom} : les explosions utilisent l arme du joueur touché (${booms.map((b) => b.skin).join(', ')})`,
      booms.length === 5 && booms.every((b) => b.skin === attendu[b.cible]) && ['petoire', 'marmite', 'huntsman'].every((k) => booms.filter((b) => b.skin === k).length === 1));
  }

  // L'impact, en mouvement normal (A) : la Pétoire pose l'impact du Scorch Shot PUIS l'étoile commune ; la roquette, l'étoile seule.
  const vuA = await A.ev('window.__vu'), fxA = await A.ev('window.__fx'), sonsA = await A.ev('window.__sons'), volA = await A.ev('window.__vol');
  const tirsA = await A.ev('window.__tirs'), bandesA = await A.ev('window.__bandes');
  const impacts = { petoire: [], marmite: [], roquette: [], huntsman: [] };
  const boomsA = vuA.filter((v) => v.type === 'boom');
  // Les quatre premières (la 5e, celle de R3, finit la partie : `end` coupe son vol, comme avant).
  t('A : quatre explosions étudiées, une par arme (Pétoire, Grenade Launcher, Huntsman, roquette)', boomsA.length === 5 && ['petoire', 'marmite', 'roquette', 'huntsman'].every((k) => boomsA.slice(0, 4).filter((b) => b.skin === k).length === 1), boomsA.map((b) => b.skin).join());
  boomsA.slice(0, 4).forEach((b, i) => {
    const finFenetre = boomsA[i + 1].t;
    const fx = fxA.filter((f) => f.t >= b.t && f.t < finFenetre);
    const sons = sonsA.filter((s) => s.t >= b.t && s.t < finFenetre).map((s) => s.n);
    const feu = fx.find((f) => f.cls === 'scorch-impact'), etoile = fx.find((f) => f.cls === 'boum');
    if (b.skin === 'petoire') {
      t(`A, explosion Pétoire : l impact du Scorch Shot (rayons, boule rouge), PUIS l étoile commune (+${feu && etoile ? Math.round(etoile.t - feu.t) : '?'} ms)`,
        !!feu && !!etoile && etoile.t - feu.t >= 100, JSON.stringify(fx));
      t(`A, explosion Pétoire : sons fusee, crepitement, explosion (${sons.join(' ')})`,
        ['fusee', 'crepitement', 'explosion'].every((n) => sons.includes(n)) && !sons.includes('whoosh') && !sons.includes('impact')
        && sons.indexOf('crepitement') < sons.indexOf('explosion'));
      // Le cycle arme → tir → projectile → impact, mesuré pendant le vol.
      const vol = volA.find((v) => v.t >= b.t && v.t < finFenetre);
      const tir = tirsA.find((x) => x.t >= b.t && x.t < finFenetre);
      t(`A, tir Pétoire : éclair de bouche au départ, projectile SOUS l arme (${vol ? 'vu' : 'pas de vol'})`,
        !!vol && vol.skin === 'petoire' && vol.eclair && vol.projSousArme, JSON.stringify(vol));
      t(`A, tir Pétoire : le PROJECTILE part vers la cible (${vol ? Math.round(vol.proj) : '?'} px sur ${vol ? Math.round(vol.course) : '?'} de course), l ARME reste au centre (recul max ${vol ? Math.round(vol.arme) : '?'} px)`,
        !!vol && vol.course > 40 && vol.proj >= 0.5 * vol.course && vol.arme <= 0.25 * vol.w && vol.fly < 1, JSON.stringify(vol));
      t(`A, tir Pétoire : éclair visible, gerbe d étincelles et bouffée de fumée rouge animées`, !!vol && vol.eclairVu && vol.gerbe && vol.bouffee, JSON.stringify(vol));
      t(`A, tir Pétoire : recul franc, le canon se relève (rotation max ${vol ? Math.round(vol.rotMax) : '?'}°)`, !!vol && vol.rotMax >= 12, JSON.stringify(vol));
      t(`A, vol Pétoire : la fusée n est visible qu en vol, tête lumineuse DEVANT le corps (${vol && vol.teteDevant !== null ? vol.teteDevant.toFixed(1) : '?'} px)`,
        !!vol && vol.projVu && vol.teteDevant > 2, JSON.stringify(vol));
      t(`A, vol Pétoire : fumée rouge derrière la fusée`, !!vol && vol.fumee > 0.5 && vol.fumeeRouge, JSON.stringify(vol));
      t('A, impact Pétoire : le projectile disparaît, l arme reste visible au centre',
        !!tir && tir.proj === 'hidden' && tir.arme === '1' && tir.fly === '1' && !tir.gone, JSON.stringify(tir));
      if (feu) impacts.petoire.push(feu.t - b.t);
    } else if (b.skin === 'marmite') {
      // Le Grenade Launcher : même cycle arme → tir → projectile → impact, mais la
      // grenade CULBUTE en vol (rotation cumulée du groupe .m-tourne, image par
      // image), dans son halo rouge, avec sa traînée ; aucune couche d'impact.
      const vol = volA.find((v) => v.t >= b.t && v.t < finFenetre);
      const tir = tirsA.find((x) => x.t >= b.t && x.t < finFenetre);
      const j = vol ? JSON.stringify(vol) : 'pas de vol';
      t('A, explosion Grenade Launcher : l étoile commune SEULE (aucune couche d impact propre)', !!etoile && !feu && fx.every((f) => f.cls === 'boum'), JSON.stringify(fx));
      t(`A, explosion Grenade Launcher : sons tube, impact, explosion (${sons.join(' ')})`,
        ['tube', 'impact', 'explosion'].every((n) => sons.includes(n)) && !['whoosh', 'fusee', 'crepitement'].some((n) => sons.includes(n)));
      t('A, tir Grenade Launcher : éclair de bouche visible au départ, étincelles et brume animées, grenade SOUS l arme',
        !!vol && vol.skin === 'marmite' && vol.eclair && vol.eclairVu && vol.gerbe && vol.bouffee && vol.projSousArme, j);
      t(`A, tir Grenade Launcher : recul visuel (rotation max ${vol ? Math.round(vol.rotMax) : '?'}°, court)`, !!vol && vol.rotMax >= 4 && vol.rotMax <= 12, j);
      t(`A, vol Grenade Launcher : la GRENADE parcourt la trajectoire (${vol ? Math.round(vol.proj) : '?'} px sur ${vol ? Math.round(vol.course) : '?'}), l ARME reste au centre (${vol ? Math.round(vol.arme) : '?'} px), .r-fly immobile`,
        !!vol && vol.course > 40 && vol.proj >= 0.5 * vol.course && vol.arme <= 0.25 * vol.w && vol.fly < 1, j);
      t(`A, vol Grenade Launcher : la grenade part de DANS le canon (${vol && vol.depart !== null ? Math.round(vol.depart) : '?'} px du pivot, bouche à ${vol ? Math.round(vol.w * 60 / 250) : '?'}) et sort par la bouche (jusqu à ${vol ? Math.round(vol.loin) : '?'} px)`,
        !!vol && vol.grenadeVu && vol.depart !== null && vol.depart > vol.w * 0.1 && vol.depart <= vol.w * 60 / 250 + 2 && vol.loin >= 0.5 * vol.course, j);
      t(`A, vol Grenade Launcher : la grenade CULBUTE pendant le vol (${vol ? Math.round(vol.tours) : '?'}° cumulés)`, !!vol && vol.tours >= 180, j);
      t(`A, vol Grenade Launcher : halo rouge (opacité ${vol ? vol.halo : '?'}) et fine traînée rouge qui s allonge (échelle ${vol ? vol.trainee.toFixed(2) : '?'})`,
        !!vol && vol.halo >= 0.9 && vol.trainee >= 0.5, j);
      t('A, vol Grenade Launcher : ni tête de fusée ni fumée de la Pétoire', !!vol && vol.teteDevant === null && vol.fumee === 0, j);
      t('A, impact Grenade Launcher : la grenade disparaît, l arme reste visible au centre',
        !!tir && tir.proj === 'hidden' && tir.arme === '1' && tir.fly === '1' && !tir.gone, JSON.stringify(tir));
      if (etoile) impacts.marmite.push(etoile.t - b.t);
    } else if (b.skin === 'huntsman') {
      // Le Huntsman : l'arc se bande, la corde claque, SEULE la flèche part —
      // pointe devant, sans culbute ni traînée ni éclair — puis elle se plante
      // dans la carte, dans l'axe du tir, AVANT l'étoile commune.
      const vol = volA.find((v) => v.t >= b.t && v.t < finFenetre);
      const tir = tirsA.find((x) => x.t >= b.t && x.t < finFenetre);
      const bande = bandesA.find((x) => x.t >= b.t - 1 && x.t < finFenetre);
      const plantee = fx.find((f) => f.cls === 'huntsman-impact');
      const j = vol ? JSON.stringify(vol) : 'pas de vol';
      t(`A, explosion Huntsman : la flèche PLANTÉE dans la carte, PUIS l étoile commune (+${plantee && etoile ? Math.round(etoile.t - plantee.t) : '?'} ms)`,
        !!plantee && !!etoile && etoile.t - plantee.t >= 100 && plantee.vue && fx.every((f) => f.cls === 'boum' || f.cls === 'huntsman-impact'), JSON.stringify(fx));
      t(`A, flèche plantée : dans l axe du tir (${plantee ? Math.round(plantee.a) : '?'}° pour ${plantee ? Math.round(plantee.attendu) : '?'}°) et à l échelle de l arme (${plantee ? plantee.w : '?'} px pour ${plantee ? Math.round(plantee.wRocket) : '?'})`,
        !!plantee && Math.abs(((plantee.a - plantee.attendu) % 360 + 540) % 360 - 180) <= 4 && Math.abs(plantee.w - plantee.wRocket) <= 1, JSON.stringify(plantee));
      t(`A, explosion Huntsman : sons corde, plante, explosion (${sons.join(' ')})`,
        ['corde', 'plante', 'explosion'].every((n) => sons.includes(n)) && !['whoosh', 'fusee', 'crepitement', 'tube', 'impact'].some((n) => sons.includes(n))
        && sons.indexOf('plante') < sons.indexOf('explosion'));
      t(`A, tir Huntsman : l arc se bande à fond avant le départ (recul ${bande ? Math.round(bande.avantVol) : '?'} u), la corde claque et revient au repos (${bande && bande.fin !== null ? bande.fin.toFixed(1) : '?'} u)`,
        !!bande && bande.avantVol >= 55 && bande.fin !== null && Math.abs(bande.fin) < .5, JSON.stringify(bande));
      t('A, tir Huntsman : AUCUN éclair, ni gerbe, ni bouffée ; la flèche est SOUS l arc', !!vol && !vol.eclairVu && !vol.gerbe && !vol.bouffee && vol.projSousArme, j);
      t(`A, vol Huntsman : SEULE la flèche parcourt la trajectoire (${vol ? Math.round(vol.proj) : '?'} px sur ${vol ? Math.round(vol.course) : '?'}), l ARC reste au centre (${vol ? Math.round(vol.arme) : '?'} px), .r-fly immobile`,
        !!vol && vol.course > 40 && vol.proj >= 0.5 * vol.course && vol.arme <= 0.25 * vol.w && vol.fly < 1, j);
      t(`A, vol Huntsman : la flèche est vue à chaque image du vol (${vol ? vol.flecheImages : 0}), pointe DEVANT (${vol && vol.pointeDevant !== null ? Math.round(vol.pointeDevant) : '?'} px)`,
        !!vol && vol.flecheVu && !vol.flecheCachee && vol.flecheImages >= 5 && vol.pointeDevant > 20, j);
      t(`A, vol Huntsman : aucune culbute — la flèche reste dans l axe du tir (écart max ${vol ? vol.ecartMax.toFixed(1) : '?'}°, rotation cumulée ${vol ? vol.flecheTours.toFixed(1) : '?'}°)`,
        !!vol && vol.ecartMax <= 3 && vol.flecheTours <= 6, j);
      t(`A, vol Huntsman : aucune traînée — rien ne se dessine dans le calque hors de la flèche (${vol ? vol.horsFleche : '?'} élément), ni halo, ni lueur`, !!vol && vol.horsFleche === 0 && vol.halo === 0 && vol.trainee === 0 && vol.fumee === 0 && !vol.flecheLueur, j);
      t('A, impact Huntsman : la flèche disparaît de l arc (plantée), l arc reste visible au centre',
        !!tir && tir.proj === 'hidden' && tir.arme === '1' && tir.fly === '1' && !tir.gone, JSON.stringify(tir));
      if (plantee) impacts.huntsman.push(plantee.t - b.t);
    } else {
      t('A, explosion roquette : l étoile commune seule, sans l impact du Scorch Shot', !!etoile && !feu, JSON.stringify(fx));
      t(`A, explosion roquette : ses sons d avant (${sons.join(' ')})`,
        ['whoosh', 'impact', 'explosion'].every((n) => sons.includes(n)) && !sons.includes('fusee') && !sons.includes('crepitement') && !sons.includes('tube') && !sons.includes('corde'));
      const vol = volA.find((v) => v.t >= b.t && v.t < finFenetre);
      t(`A, vol roquette : comme avant, c est TOUTE la roquette qui part (${vol ? Math.round(vol.fly) : '?'} px), sans éclair ni projectile`,
        !!vol && !vol.eclair && vol.fly >= 0.5 * vol.course && vol.proj === 0 && vol.arme === 0 && !tirsA.some((x) => x.t >= b.t && x.t < finFenetre), JSON.stringify(vol));
      if (etoile) impacts.roquette.push(etoile.t - b.t);
    }
  });
  t(`A : même instant d impact pour les quatre armes (Pétoire ${impacts.petoire.map(Math.round).join(' / ')} ms, Grenade Launcher ${impacts.marmite.map(Math.round).join(' / ')} ms, Huntsman ${impacts.huntsman.map(Math.round).join(' / ')} ms, roquette ${impacts.roquette.map(Math.round).join(' / ')} ms après boom)`,
    impacts.petoire.length === 1 && impacts.marmite.length === 1 && impacts.huntsman.length === 1 && impacts.roquette.length === 1
    && [...impacts.petoire, ...impacts.marmite, ...impacts.huntsman].every((x) => Math.abs(x - impacts.roquette[0]) < 120));
  t('A : sons communs gardés (validation du mot de R2)', sonsA.some((s) => s.n === 'valide'));

  // Mouvement réduit (B) : version fixe — ni vol, ni traînée, ni éclat ; les sons restent.
  const fxB = await B.ev('window.__fx'), volB = await B.ev('window.__vol'), sonsB = await B.ev('window.__sons');
  t('B (mouvement réduit) : aucun éclat posé (ni feu, ni étoile)', fxB.length === 0, JSON.stringify(fxB));
  t('B (mouvement réduit) : aucun vol, donc aucune traînée', volB.length === 0);
  t('B (mouvement réduit) : les sons d impact restent (crepitement, impact, plante)', sonsB.some((s) => s.n === 'crepitement') && sonsB.some((s) => s.n === 'impact') && sonsB.some((s) => s.n === 'plante'));
  t('B (mouvement réduit) : la Pétoire est figée (étincelles de danger, fumée de vol)', await B.ev(`(() => { const h = document.createElement('div'); h.style.width = '250px'; document.body.append(h);
    const r = Rocket.create(h); r.setSkin('petoire'); h.dataset.danger = '3'; h.classList.add('is-flying');
    const n = ['.p-etinc', '.p-fumee-vol'].reduce((s, q) => s + h.querySelector(q).getAnimations().length, 0); h.remove(); return n === 0; })()`));
  t('B (mouvement réduit) : le Grenade Launcher est figé — même « en vol », ni culbute, ni traînée, ni halo animés', await B.ev(`(() => { const h = document.createElement('div'); h.style.width = '250px'; document.body.append(h);
    const r = Rocket.create(h); r.setSkin('marmite'); h.dataset.danger = '3'; h.classList.add('is-flying');
    const n = ['.m-tourne', '.m-trainee', '.m-halo'].reduce((s, q) => s + h.querySelector(q).getAnimations().length, 0); h.remove(); return n === 0; })()`));
  t('B (mouvement réduit) : arme fixe — jamais de tir animé (ni .is-firing, ni .is-shot)', (await B.ev('window.__tirs')).length === 0);
  const huB = await B.ev(`(() => { const h = document.createElement('div'); h.style.width = '250px'; document.body.append(h);
    const r = Rocket.create(h); r.setSkin('huntsman'); r.setDanger(3); h.classList.add('is-flying');
    const out = { tension: r.tension, anims: h.getAnimations({ subtree: true }).length, fleche: getComputedStyle(h.querySelector('.r-proj')).visibility };
    r.setDanger(1); out.tension1 = r.tension; h.remove(); return out; })()`);
  t(`B (mouvement réduit) : le Huntsman est figé (aucune animation, même au cran 3 « en vol »), la tension posée d un coup (${huB.tension} puis ${huB.tension1} u), flèche visible`,
    huB.anims === 0 && huB.tension === 60 && huB.tension1 === 12 && huB.fleche === 'visible', JSON.stringify(huB));

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
