// Croquis — l'atelier de dessin, dans un VRAI navigateur, avec de VRAIES
// entrées (souris, doigt, stylet) envoyées par le protocole DevTools.
//
//   node tests/croquis-atelier.mjs
//   node tests/croquis-atelier.mjs --shots <dossier>   (captures)
//
// Pas de serveur : le lot front 1 dessine en local. Ce qui est vérifié, AU
// PIXEL de la feuille (pas seulement dans le modèle) :
//   bureau 1280 × 800 (souris) : mise en page, diagonale, couleur, taille,
//   gomme, Ctrl+Z et bouton Annuler, Effacer en deux appuis, tracé rapide,
//   les quatre bords (pointeur sorti de la feuille), clic droit, redimension-
//   nement sans déplacement ni déformation ;
//   stylet ;
//   téléphone 390 × 844 (doigt) : mise en page, cibles de 44 px, trait SOUS le
//   doigt, aucun défilement, un seul doigt à la fois, appui = point ;
//   téléphone en paysage 844 × 390, et rotation avec un dessin en place.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const EDGE = arg('--edge') || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const SHOTS = arg('--shots');
const CDP_PORT = 9400 + Math.floor(Math.random() * 400);
// `?atelier` : l'atelier libre, sans réseau (depuis le lot réseau 1, la page
// sans paramètre ouvre l'accueil de la partie).
const PAGE = 'file:///' + path.join(ROOT, 'games', 'croquis', 'index.html').replace(/\\/g, '/') + '?atelier';
const D = createRequire(import.meta.url)('../games/croquis/dessin.js');

let ok = 0, ko = 0;
const t = (name, cond, detail) => {
  if (cond) { ok++; console.log('OK   ' + name); }
  else { ko++; console.log('KO   ' + name + (detail ? ' — ' + detail : '')); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

// ------------------------------------------------------------- Edge + CDP
async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('CDP injoignable')); });
  let id = 0;
  const waiting = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } };
  return { send(method, params = {}) { const mid = ++id; ws.send(JSON.stringify({ id: mid, method, params })); return new Promise((res) => waiting.set(mid, res)); } };
}
const profil = mkdtempSync(path.join(tmpdir(), 'croquis-atelier-'));
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--allow-file-access-from-files',
  `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profil}`, '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
function fin() {
  try { edge.kill(); } catch (_) {}
  if (process.platform === 'win32' && edge.pid) { try { spawn('taskkill', ['/PID', String(edge.pid), '/T', '/F'], { stdio: 'ignore', detached: true }).unref(); } catch (_) {} }
}
process.on('exit', fin);
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { fin(); process.exit(130); });
async function json(p) { for (let i = 0; i < 80; i++) { try { return await (await fetch(`http://127.0.0.1:${CDP_PORT}${p}`)).json(); } catch (_) { await sleep(150); } } throw new Error('Edge muet'); }

const cible = (await json('/json/list')).find((x) => x.type === 'page');
const c = await connect(cible.webSocketDebuggerUrl);
await c.send('Page.enable');
await c.send('Runtime.enable');
// Le type de chaque pointeur qui touche la feuille, relevé dans la page.
await c.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__types = []; addEventListener('pointerdown', (e) => { if (e.target.id === 'vivant') window.__types.push(e.pointerType); }, true);` });

async function ev(expr) {
  const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) throw new Error((r.result.exceptionDetails.exception || {}).description || 'eval');
  return r.result && r.result.result ? r.result.result.value : undefined;
}
async function until(expr, ms = 5000) { const f = Date.now() + ms; while (Date.now() < f) { if (await ev(expr)) return true; await sleep(40); } return false; }
async function ecran(w, h, mobile) {
  await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile: !!mobile });
  await c.send('Emulation.setTouchEmulationEnabled', { enabled: !!mobile, maxTouchPoints: mobile ? 5 : 0 });
}
async function ouvrir() {
  await c.send('Page.navigate', { url: PAGE });
  await until('document.readyState === "complete" && !!window.__croquis');
  await attendreTaille();
}
// Le backing store suit la boîte (ResizeObserver + une image).
const attendreTaille = () => until(`(() => { const b = document.getElementById('base'), r = b.getBoundingClientRect(), d = devicePixelRatio;
  return Math.abs(b.width - Math.round(r.width * d)) <= 1 && Math.abs(b.height - Math.round(r.height * d)) <= 1; })()`);
const feuille = () => ev(`(() => { const r = document.getElementById('vivant').getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height, bottom: r.bottom, right: r.right }; })()`);
const modele = () => ev('JSON.parse(JSON.stringify({ traits: window.__croquis.dessin.traits, etat: window.__croquis.etat }))');
// La couleur de la feuille (couche des traits finis) sous un point d'écran.
const pixel = (x, y) => ev(`(() => { const b = document.getElementById('base'), r = b.getBoundingClientRect();
  const bx = Math.min(b.width - 1, Math.floor((${x} - r.left) * b.width / r.width)), by = Math.min(b.height - 1, Math.floor((${y} - r.top) * b.height / r.height));
  const d = b.getContext('2d').getImageData(bx, by, 1, 1).data; return [d[0], d[1], d[2]]; })()`);
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const proche = (px, hex, tol = 40) => px.every((v, i) => Math.abs(v - rgb(hex)[i]) <= tol);
const FOND = D.FOND;
// Un point d'écran à une fraction (fx, fy) de la feuille.
const a = (r, fx, fy) => ({ x: r.left + fx * r.width, y: r.top + fy * r.height });
async function shot(nom) {
  if (!SHOTS) return;
  const r = await c.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(SHOTS, nom + '.png'), Buffer.from(r.result.data, 'base64'));
}

// ---------------------------------------------------------------- gestes
async function souris(points, { bouton = 'left', type = 'mouse' } = {}) {
  const [p0, ...reste] = points;
  const extra = type === 'pen' ? { pointerType: 'pen', force: 0.5 } : {};
  await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p0.x, y: p0.y, ...extra });
  await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p0.x, y: p0.y, button: bouton, buttons: bouton === 'left' ? 1 : 2, clickCount: 1, ...extra });
  for (const p of reste) await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: bouton, buttons: bouton === 'left' ? 1 : 2, ...extra });
  const pn = points[points.length - 1];
  await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pn.x, y: pn.y, button: bouton, buttons: 0, clickCount: 1, ...extra });
  await sleep(60);
}
async function doigt(points, autre) {
  const tp = (p, q) => (q ? [{ x: p.x, y: p.y, id: 1 }, { x: q.x, y: q.y, id: 2 }] : [{ x: p.x, y: p.y, id: 1 }]);
  await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(points[0], autre && autre[0]) });
  for (let i = 1; i < points.length; i++) await c.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(points[i], autre && autre[i]) });
  await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(60);
}
const ligne = (p, q, n) => Array.from({ length: n + 1 }, (_, i) => ({ x: p.x + (q.x - p.x) * i / n, y: p.y + (q.y - p.y) * i / n }));
async function clic(sel) {
  const q = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.scrollIntoView({ block: 'nearest', behavior: 'instant' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  const tactile = await ev('matchMedia("(pointer: coarse)").matches');
  if (tactile) {
    await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: q.x, y: q.y }] });
    await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: q.x, y: q.y });
    await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: q.x, y: q.y, button: 'left', buttons: 1, clickCount: 1 });
    await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: q.x, y: q.y, button: 'left', buttons: 0, clickCount: 1 });
  }
  await sleep(40);
}
const pasDeDebordement = () => ev('document.documentElement.scrollWidth <= innerWidth');
const ratio = (r) => Math.abs(r.width / r.height - 4 / 3) < 0.01;

// =================================================== bureau, à la souris
await ecran(1280, 800, false);
await ouvrir();
{
  const r = await feuille();
  const o = await ev(`(() => { const r = document.querySelector('.outils').getBoundingClientRect(); return { left: r.left, bottom: r.bottom }; })()`);
  t(`bureau : feuille ${Math.round(r.width)} × ${Math.round(r.height)}, ratio 4:3`, ratio(r));
  t('bureau : la feuille tient dans la hauteur, les outils à droite', r.bottom <= 800 && o.left >= r.right && await pasDeDebordement());
  t('bureau : feuille vierge = blanc cassé', proche(await pixel(r.left + r.width / 2, r.top + r.height / 2), FOND, 3));
  await shot('bureau-vierge');

  // diagonale, crayon noir moyen (outil par défaut)
  await souris(ligne(a(r, 0.1, 0.1), a(r, 0.9, 0.9), 24));
  let m = await modele();
  t('souris : un trait, noir (c = 0), moyen (w = 1)', m.traits.length === 1 && m.traits[0].c === 0 && m.traits[0].w === 1);
  t('souris : premier et dernier points au bon endroit (100, 75) → (900, 675)',
    m.traits[0].p[0] === 100 && m.traits[0].p[1] === 75 && m.traits[0].p.at(-2) === 900 && m.traits[0].p.at(-1) === 675);
  const surLigne = await Promise.all([0.25, 0.5, 0.75].map((f) => pixel(a(r, f, f).x, a(r, f, f).y)));
  t('souris : la diagonale est noire sous le pointeur (25 %, 50 %, 75 %)', surLigne.every((px) => proche(px, D.PALETTE[0].hex)));
  t('souris : à côté de la diagonale, la feuille est vierge', proche(await pixel(a(r, 0.25, 0.75).x, a(r, 0.25, 0.75).y), FOND, 3));
  t('pointerType : mouse', (await ev('window.__types')).at(-1) === 'mouse');

  // couleur + taille
  await clic('.pastille[data-couleur="3"]');
  await clic('.taille[data-taille="2"]');
  t('outils : rouge et gros choisis (aria-pressed), étiquette à jour',
    await ev(`document.querySelector('.pastille[data-couleur="3"]').getAttribute('aria-pressed') === 'true' && document.querySelector('.taille[data-taille="2"]').getAttribute('aria-pressed') === 'true' && document.getElementById('outil-actuel').textContent === 'Crayon rouge · gros'`));
  await souris(ligne(a(r, 0.1, 0.5), a(r, 0.9, 0.5), 20));
  m = await modele();
  t('trait rouge gros : c = 3, w = 2', m.traits[1].c === 3 && m.traits[1].w === 2);
  t('trait rouge : rouge au pixel, aussi au croisement avec la diagonale (il passe dessus)',
    proche(await pixel(a(r, 0.3, 0.5).x, a(r, 0.3, 0.5).y), D.PALETTE[3].hex) && proche(await pixel(a(r, 0.5, 0.5).x, a(r, 0.5, 0.5).y), D.PALETTE[3].hex));
  // épaisseur : « gros » = 28 unités logiques
  const ep = r.height * 28 / 750;
  t(`épaisseur gros ≈ ${ep.toFixed(1)} px : couvert à ±40 %, vierge à ±80 %`,
    proche(await pixel(a(r, 0.3, 0.5).x, a(r, 0.3, 0.5).y + ep * 0.4), D.PALETTE[3].hex)
    && proche(await pixel(a(r, 0.3, 0.5).x, a(r, 0.3, 0.5).y + ep * 0.8), FOND, 3));

  // gomme
  await clic('#gomme');
  t('gomme : pressée, plus aucune couleur pressée', await ev(`document.getElementById('gomme').getAttribute('aria-pressed') === 'true' && !document.querySelector('.pastille[aria-pressed="true"]')`));
  await souris(ligne(a(r, 0.5, 0.3), a(r, 0.5, 0.7), 12));
  m = await modele();
  t('gomme : un trait c = 12, la taille gardée (gros)', m.traits[2].c === 12 && m.traits[2].w === 2);
  t('gomme : le croisement redevient blanc cassé', proche(await pixel(a(r, 0.5, 0.5).x, a(r, 0.5, 0.5).y), FOND, 3));
  await shot('bureau-trois-traits');

  // Ctrl+Z, puis le bouton
  await c.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 2 });
  await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 2 });
  await sleep(60);
  t('Ctrl+Z : le coup de gomme est annulé, le rouge revient au croisement',
    (await modele()).traits.length === 2 && proche(await pixel(a(r, 0.5, 0.5).x, a(r, 0.5, 0.5).y), D.PALETTE[3].hex));
  await clic('#annuler');
  t('bouton Annuler : le trait rouge part, la diagonale noire revient dessous',
    (await modele()).traits.length === 1 && proche(await pixel(a(r, 0.5, 0.5).x, a(r, 0.5, 0.5).y), D.PALETTE[0].hex)
    && proche(await pixel(a(r, 0.3, 0.5).x, a(r, 0.3, 0.5).y), FOND, 3));

  // tracé rapide : deux mouvements seulement d'un bout à l'autre
  await clic('.pastille[data-couleur="8"]');
  await souris([a(r, 0.05, 0.2), a(r, 0.5, 0.25), a(r, 0.95, 0.3)]);
  const ech = await Promise.all(Array.from({ length: 9 }, (_, i) => {
    const f = 0.1 + i * 0.1;
    const y = f <= 0.5 ? 0.2 + (f - 0.05) / 0.45 * 0.05 : 0.25 + (f - 0.5) / 0.45 * 0.05;
    return pixel(a(r, f, y).x, a(r, f, y).y);
  }));
  t('tracé rapide (2 mouvements) : continu, bleu de bout en bout', ech.every((px) => proche(px, D.PALETTE[8].hex, 60)));

  // les quatre bords : le pointeur sort de la feuille de tous les côtés
  const tour = [a(r, 0.5, 0.5), a(r, -0.2, 0.5), a(r, -0.2, -0.2), a(r, 0.5, -0.2), a(r, 1.2, -0.2), a(r, 1.2, 0.5), a(r, 1.2, 1.2), a(r, 0.5, 1.2), a(r, -0.2, 1.2)];
  await souris(tour.flatMap((p, i) => (i ? ligne(tour[i - 1], p, 6).slice(1) : [p])));
  m = await modele();
  const pts = m.traits.at(-1).p;
  const xs = pts.filter((_, i) => i % 2 === 0), ys = pts.filter((_, i) => i % 2 === 1);
  t('bords : aucun point hors 0..1000 × 0..750', xs.every((x) => x >= 0 && x <= 1000) && ys.every((y) => y >= 0 && y <= 750));
  t('bords : les quatre bords atteints (x = 0, x = 1000, y = 0, y = 750)', xs.includes(0) && xs.includes(1000) && ys.includes(0) && ys.includes(750));
  const bord = await Promise.all([[0.004, 0.5], [0.996, 0.5], [0.5, 0.006], [0.5, 0.994]].map(([fx, fy]) => pixel(a(r, fx, fy).x, a(r, fx, fy).y)));
  t('bords : le trait est visible contre chaque bord', bord.every((px) => proche(px, D.PALETTE[8].hex, 60)));

  // clic droit : rien
  const n0 = (await modele()).traits.length;
  await souris(ligne(a(r, 0.2, 0.8), a(r, 0.4, 0.8), 5), { bouton: 'right' });
  t('clic droit : aucun trait', (await modele()).traits.length === n0);

  // stylet
  await souris(ligne(a(r, 0.2, 0.62), a(r, 0.45, 0.62), 10), { type: 'pen' });
  t('stylet : pointerType pen, un trait de plus, visible', (await ev('window.__types')).at(-1) === 'pen'
    && (await modele()).traits.length === n0 + 1 && proche(await pixel(a(r, 0.3, 0.62).x, a(r, 0.3, 0.62).y), D.PALETTE[8].hex, 60));

  // redimensionnement : même dessin, autre taille, rien ne bouge ni ne se déforme
  const avant = await modele();
  const FR = [[0.25, 0.25], [0.75, 0.75], [0.5, 0.5], [0.3, 0.62], [0.12, 0.21], [0.75, 0.5], [0.996, 0.5]];
  const pxAvant = await Promise.all(FR.map(([fx, fy]) => pixel(a(r, fx, fy).x, a(r, fx, fy).y)));
  await ecran(900, 700, false);
  await attendreTaille();
  const r2 = await feuille();
  t(`resize 1280 → 900 : feuille ${Math.round(r2.width)} × ${Math.round(r2.height)}, toujours 4:3`, ratio(r2) && r2.width !== r.width);
  t('resize : le modèle n a pas changé (rien n est recopié en pixels)', JSON.stringify(await modele()) === JSON.stringify(avant));
  const pxApres = await Promise.all(FR.map(([fx, fy]) => pixel(a(r2, fx, fy).x, a(r2, fx, fy).y)));
  t('resize : aux mêmes fractions de la feuille, les mêmes couleurs (7 points : diagonale, croisements, bord, vierge)',
    pxApres.every((px, i) => px.every((v, k) => Math.abs(v - pxAvant[i][k]) <= 40)), JSON.stringify([pxAvant, pxApres]));
  t('resize : la diagonale noire est toujours là', proche(pxApres[0], D.PALETTE[0].hex) && proche(pxApres[1], D.PALETTE[0].hex));
  t('resize : à côté, toujours vierge', proche(await pixel(a(r2, 0.75, 0.5).x, a(r2, 0.75, 0.5).y), FOND, 3));
  await shot('bureau-900');
  await ecran(1280, 800, false);
  await attendreTaille();

  // effacer : deux appuis
  await clic('#effacer');
  t('Effacer, 1er appui : rien n est effacé, le bouton demande confirmation',
    (await modele()).traits.length === avant.traits.length && await ev(`document.querySelector('#effacer .lib').textContent === 'Sûr ?'`));
  await clic('#effacer');
  const vide = await Promise.all([[0.5, 0.5], [0.25, 0.25], [0.004, 0.5], [0.3, 0.62]].map(([fx, fy]) => pixel(a(r, fx, fy).x, a(r, fx, fy).y)));
  t('Effacer, 2e appui : plus aucun trait, la feuille entière est blanc cassé', (await modele()).traits.length === 0 && vide.every((px) => proche(px, FOND, 3)));
  t('feuille vide : Annuler et Effacer désactivés', await ev(`document.getElementById('annuler').disabled && document.getElementById('effacer').disabled`));
}

// ========================================== téléphone en portrait, au doigt
await ecran(390, 844, true);
await ouvrir();
{
  const r = await feuille();
  t('portrait : la feuille prend la largeur (au moins 90 % de l écran)', r.width >= 0.9 * 390);
  t(`portrait 390 : feuille ${Math.round(r.width)} × ${Math.round(r.height)}, 4:3, pleine largeur`, ratio(r) && r.width >= 340);
  t('portrait : aucun débordement horizontal', await pasDeDebordement());
  const petits = await ev(`[...document.querySelectorAll('.outils button')].filter((b) => { const q = b.getBoundingClientRect(); return q.width < 44 || q.height < 44; }).length`);
  t('portrait : chaque bouton d outil fait au moins 44 × 44 px', petits === 0, `${petits} trop petits`);
  t('portrait : les outils sous la feuille', await ev(`document.querySelector('.outils').getBoundingClientRect().top >= document.getElementById('vivant').getBoundingClientRect().bottom`));
  await shot('tel-vierge');

  const y0 = await ev('scrollY');
  const geste = ligne(a(r, 0.15, 0.2), a(r, 0.85, 0.8), 18);
  await doigt(geste);
  const m = await modele();
  t('doigt : un trait, pointerType touch', m.traits.length === 1 && (await ev('window.__types')).at(-1) === 'touch');
  // Sous le doigt : chaque point touché, converti, est dans le trait (± 1).
  const attendus = geste.map((p) => D.versLogique(p.x, p.y, r));
  const pts = m.traits[0].p;
  const dans = attendus.every((q) => { for (let i = 0; i < pts.length; i += 2) if (Math.abs(pts[i] - q.x) <= 1 && Math.abs(pts[i + 1] - q.y) <= 1) return true; return false; });
  t('doigt : chaque point touché est dans le trait, à 1 unité près (≈ 0,4 px)', dans);
  const sous = await Promise.all([3, 9, 15].map((i) => pixel(geste[i].x, geste[i].y)));
  t('doigt : le trait est SOUS le doigt (pixel aux points touchés)', sous.every((px) => proche(px, D.PALETTE[0].hex)));
  t('doigt : la page n a pas défilé', await ev('scrollY') === y0);
  // Juste après un trait, le PREMIER appui sur un outil doit compter :
  // Chromium prenait le trait pour un défilement lancé et avalait ce click.
  await clic('.pastille[data-couleur="9"]');
  t('doigt : le 1er appui après un trait choisit bien la couleur (pas de click avalé)', (await modele()).etat.couleur === 9);

  // un geste vertical qui sort par le bas : toujours aucun défilement
  await doigt(ligne(a(r, 0.6, 0.3), a(r, 0.6, 1.6), 20));
  t('doigt sorti par le bas : pas de défilement, trait arrêté au bord (y = 750)',
    await ev('scrollY') === y0 && (await modele()).traits[1].p.at(-1) === 750);

  // deux doigts : un seul dessine
  const n0 = (await modele()).traits.length;
  await doigt(ligne(a(r, 0.1, 0.9), a(r, 0.4, 0.9), 6), ligne(a(r, 0.9, 0.1), a(r, 0.6, 0.1), 6));
  const m2 = await modele();
  t('deux doigts : UN trait (le premier doigt), l autre ignoré', m2.traits.length === n0 + 1 && m2.traits.at(-1).p[1] === D.versLogique(0, a(r, 0.1, 0.9).y, r).y);
  t('deux doigts : rien sous le second', proche(await pixel(a(r, 0.75, 0.1).x, a(r, 0.75, 0.1).y), FOND, 3));

  // un appui = un point
  await clic('.pastille[data-couleur="4"]');
  await doigt([a(r, 0.3, 0.45)]);
  const m3 = await modele();
  t('appui simple : un trait d un point (un disque), orange', m3.traits.at(-1).p.length === 2 && m3.traits.at(-1).c === 4
    && proche(await pixel(a(r, 0.3, 0.45).x, a(r, 0.3, 0.45).y), D.PALETTE[4].hex));
  await clic('#annuler');
  t('annuler au doigt : le point part', (await modele()).traits.length === n0 + 1 && proche(await pixel(a(r, 0.3, 0.45).x, a(r, 0.3, 0.45).y), FOND, 3));
  await shot('tel-dessin');

  // rotation : le dessin reste où il est, en fraction de la feuille
  await ecran(844, 390, true);
  await attendreTaille();
  const rp = await feuille();
  t(`paysage 844 × 390 : feuille ${Math.round(rp.width)} × ${Math.round(rp.height)}, 4:3, entièrement visible`,
    ratio(rp) && rp.top >= 0 && rp.bottom <= 390 && rp.left >= 0);
  t(`paysage : la feuille prend la hauteur (${Math.round(rp.height)} px sur 390, au moins 85 %)`, rp.height >= 0.85 * 390);
  t('paysage : outils visibles à côté, sans débordement', await pasDeDebordement()
    && await ev(`(() => { const o = document.querySelector('.outils').getBoundingClientRect(); return o.left >= document.getElementById('vivant').getBoundingClientRect().right && o.bottom <= innerHeight + 1; })()`));
  const tourne = await Promise.all([3, 9, 15].map((i) => { const f = [0.15 + 0.7 * i / 18, 0.2 + 0.6 * i / 18]; return pixel(a(rp, f[0], f[1]).x, a(rp, f[0], f[1]).y); }));
  t('rotation : le trait est toujours aux mêmes fractions de la feuille', tourne.every((px) => proche(px, D.PALETTE[0].hex)));
  const petitsP = await ev(`[...document.querySelectorAll('.outils button')].filter((b) => { const q = b.getBoundingClientRect(); return q.width < 44 || q.height < 44; }).length`);
  t('paysage : boutons d outil d au moins 44 px', petitsP === 0);
  await doigt(ligne(a(rp, 0.1, 0.1), a(rp, 0.4, 0.1), 8));
  t('paysage : on dessine au doigt, sous le doigt', proche(await pixel(a(rp, 0.25, 0.1).x, a(rp, 0.25, 0.1).y), D.PALETTE[4].hex));
  await shot('tel-paysage');
}

console.log(`\n${ok} OK, ${ko} KO`);
fin();
process.exit(ko ? 1 : 0);
