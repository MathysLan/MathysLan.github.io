// Le Game Hub en VRAI navigateur : /games/ contre game-hub-server.
//
//   node tests/hub-play.mjs                          serveur du Hub lancé en local
//   node tests/hub-play.mjs --hub wss://game-hub-server-qqdk.onrender.com
//   node tests/hub-play.mjs --shots <dossier>        une capture par étape
//   node tests/hub-play.mjs --reduced                mouvement réduit
//
// Deux contextes de navigation isolés (deux localStorage, deux player.id) :
//   A — une vraie photo, posée par le vrai champ fichier du profil ;
//   B — un emoji.
// Scénario : A crée → B rejoint → A voit B, B voit A (avatars, hôte) → B
// recharge sa page et reprend SA place (même id, pas de doublon) → A ferme sa
// page (vraie coupure) : absent, l'hôte passe à B, A revient pendant la grâce →
// 12 joueurs → A fait « Quitter » : B le voit disparaître tout de suite → B fait
// « Quitter » : la session disparaît immédiatement du serveur.
// Tout est lu dans le DOM réel ; « le WebSocket se connecte » ne prouve rien.
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { fakeHealth, localManifest } from './hub-fixture.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const H = createRequire(import.meta.url)(path.join(ROOT, 'games/shared/game-hub.js'));
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const EDGE = arg('--edge') || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PROD = arg('--hub');
const SHOTS = arg('--shots');
const REDUCED = process.argv.includes('--reduced');
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const R = () => Math.floor(Math.random() * 300);
const HTTP_PORT = 8700 + R(), CDP_PORT = 9700 + R();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let out = [], ko = 0;
const t = (nom, ok, detail = '') => {
  out.push(`${ok ? 'OK  ' : 'KO  '} ${nom}${detail ? ' — ' + detail : ''}`);
  if (!ok) ko++;
  console.log(out[out.length - 1]);
};

// --- serveurs -------------------------------------------------------------
let hubProc = null, HUB = PROD, sante = null, MANIFEST = null;
async function lanceHub() {
  if (PROD) return;
  const cwd = path.join(ROOT, '..', 'game-hub-server');
  const port = 8100 + R();
  // Le vrai catalogue, mais les /health des jeux simulés : un test local ne
  // réveille pas les serveurs Render (tests/hub-fixture.mjs).
  sante = await fakeHealth(6100 + R());
  MANIFEST = localManifest(ROOT, sante.srv.address().port);
  hubProc = spawn(process.execPath, ['src/server.js'], { cwd, env: { ...process.env, PORT: String(port), HUB_QUIET: '1', MANIFEST_FILE: MANIFEST }, stdio: 'ignore' });
  HUB = `ws://127.0.0.1:${port}`;
}
const health = async () => (await (await fetch(H.healthUrl(HUB))).json());

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json' };
function serve() {
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const full = path.join(ROOT, p);
    if (!full.startsWith(ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
    res.end(fs.readFileSync(full));
  });
  return new Promise((r) => srv.listen(HTTP_PORT, '127.0.0.1', () => r(srv)));
}

// --- CDP, sessions aplaties ------------------------------------------------
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
  const J = { nom, erreurs: [] };
  cdp.on(sessionId, (m) => {
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      J.erreurs.push((d.exception?.description || d.text || '').split('\n')[0]);
    }
  });
  const S = (m, p) => cdp.send(m, p, sessionId);
  await S('Runtime.enable'); await S('Page.enable'); await S('DOM.enable');
  if (REDUCED) await S('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  J.size = (w, h) => S('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 500 });
  await J.size(1100, 1000);
  J.eval = async (expression) => {
    const r = await S('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(`[${nom}] ` + (r.result.exceptionDetails.exception?.description || 'erreur JS').split('\n')[0]);
    return r.result?.result?.value;
  };
  J.goto = async (url) => {
    await S('Page.navigate', { url });
    for (let i = 0; i < 60; i++) {
      await sleep(100);
      try { if (await J.eval(`document.readyState === 'complete' && !!window.GameHub && !!window.GameAvatar`)) return; } catch (_) {}
    }
    throw new Error(`[${nom}] la page ne se charge pas`);
  };
  J.reload = async () => { await S('Page.reload', {}); await sleep(300); for (let i = 0; i < 60; i++) { await sleep(100); try { if (await J.eval(`document.readyState === 'complete' && !!window.GameHub`)) return; } catch (_) {} } };
  J.leavePage = async () => { await S('Page.navigate', { url: 'about:blank' }); await sleep(300); };
  J.click = async (sel) => {
    const box = await J.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null;
      e.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = e.getBoundingClientRect();
      return r.width && r.height ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; })()`);
    if (!box) throw new Error(`[${nom}] introuvable ou invisible : ${sel}`);
    for (const type of ['mousePressed', 'mouseReleased']) await S('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
    await sleep(80);
  };
  J.type = async (sel, text) => {
    await J.click(sel);
    await J.eval(`document.querySelector(${JSON.stringify(sel)}).select()`);
    await S('Input.insertText', { text });
    await sleep(60);
  };
  J.upload = async (sel, file) => {
    const { result: { root } } = await S('DOM.getDocument', { depth: 0 });
    const { result: { nodeId } } = await S('DOM.querySelector', { nodeId: root.nodeId, selector: sel });
    await S('DOM.setFileInputFiles', { files: [file], nodeId });
  };
  J.until = async (expr, ms = 10000, label = expr) => {
    const fin = Date.now() + ms;
    while (Date.now() < fin) { try { const v = await J.eval(expr); if (v) return v; } catch (_) {} await sleep(100); }
    let etat = ''; try { etat = await J.eval(`(document.getElementById('hub-msg') || {}).textContent || ''`); } catch (_) {}
    throw new Error(`[${nom}] attente expirée : ${label} — message « ${etat} »`);
  };
  J.shot = async (nomFichier) => {
    if (!SHOTS) return;
    const r = await S('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(path.join(SHOTS, nomFichier + '.png'), Buffer.from(r.result.data, 'base64'));
  };
  J.grant = (origin) => cdp.send('Browser.grantPermissions', { origin, browserContextId, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
  return J;
}

// Ce que le salon affiche, carte par carte.
const SALON = `(() => ({
  code: document.getElementById('hub-code').textContent.trim(),
  count: document.getElementById('hub-count').textContent,
  conn: document.getElementById('hub-conn').textContent,
  visible: !document.getElementById('lobby').hidden,
  texte: document.body.innerText,
  cartes: [...document.querySelectorAll('#hub-players .hub-card')].map((c) => {
    const img = c.querySelector('.g-av img');
    const b = c.querySelector('.g-av').getBoundingClientRect();
    return { id: c.dataset.player, nom: c.querySelector('.hub-card-name').textContent,
      img: img ? img.getAttribute('src') : null, decodee: img ? img.complete && img.naturalWidth > 0 : false,
      emoji: img ? '' : c.querySelector('.g-av').textContent, taille: Math.round(b.width) + 'x' + Math.round(b.height),
      host: !!c.querySelector('.hub-tag.host'), moi: !!c.querySelector('.hub-tag.me'), absent: c.classList.contains('is-away') };
  }),
}))()`;

// --- orchestration ---------------------------------------------------------
const srv = await serve();
await lanceHub();
for (let i = 0; i < 90; i++) { try { await health(); break; } catch (_) { await sleep(PROD ? 1000 : 100); } }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hubplay-'));
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${dir}`, '--no-first-run',
  '--disable-features=BackForwardCache', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank'], { stdio: 'ignore' });
let cdp = null;
const extras = [];
const stop = () => {
  try { execFileSync('taskkill', ['/PID', String(edge.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (_) { try { edge.kill(); } catch (__) {} }
  extras.forEach((x) => { try { x.leave(); } catch (_) {} });
  if (hubProc) hubProc.kill();
  if (sante) sante.close();
  if (MANIFEST) { try { fs.unlinkSync(MANIFEST); } catch (_) {} }
  try { cdp && cdp.close(); } catch (_) {}
  try { srv.close(); } catch (_) {}
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
};

console.log(`Game Hub — parcours réel dans le navigateur (${PROD ? 'PRODUCTION ' + PROD : 'serveur local ' + HUB})\n`);
const PAGE = `http://127.0.0.1:${HTTP_PORT}/games/?hub=${encodeURIComponent(HUB)}`;
try {
  cdp = await cdpBrowser();
  const A = await joueur(cdp, 'A'), B = await joueur(cdp, 'B');

  // ═══ 1. profils : A met une vraie photo, B un emoji — par les vrais contrôles
  await A.goto(PAGE);
  const idA1 = await A.eval(`JSON.parse(localStorage.getItem('mathys_game_profile')).id`);
  await A.goto(PAGE);
  const idA2 = await A.eval(`JSON.parse(localStorage.getItem('mathys_game_profile')).id`);
  t('profil neuf : son id est écrit à la première visite et reste le même', !!idA1 && idA1 === idA2, `${idA1} / ${idA2}`);
  t('profil neuf : l\'éditeur est ouvert (pas de pseudo) et « Créer » attend un pseudo',
    await A.eval(`!document.getElementById('identity').hidden && document.getElementById('hub-create').disabled`));
  await A.type('#name-input', 'Alice');
  await A.upload('#gp-file', path.join(ROOT, 'assets', 'og-image.png'));
  await A.until(`GameProfile.load().avatar.kind === 'image'`, 8000, 'photo enregistrée');
  await A.click('#identity-done');
  const srcA = await A.eval(`GameProfile.load().avatar.src`);
  t('carte « Ton profil » : la vraie photo de A, décodée', await A.until(`(() => { const i = document.querySelector('#me-avatar img'); return i && i.complete && i.naturalWidth > 0 && i.getAttribute('src') === GameProfile.load().avatar.src; })()`));
  t('carte « Ton profil » : le pseudo', await A.eval(`document.getElementById('me-name').textContent`) === 'Alice');

  await B.goto(PAGE);
  await B.type('#name-input', 'Bruno');
  await B.click('#avatar-row .avatar-pick:nth-child(2)');   // 🐼
  await B.click('#identity-done');
  const emojiB = await B.eval(`GameProfile.load().avatar.emoji`);
  const idB = await B.eval(`GameProfile.load().id`);
  t('deux contextes, deux player.id', idB !== idA1 && /^p_[a-z0-9]+$/.test(idB));
  await A.shot('1-entree-A');

  // ═══ 2. erreurs lisibles
  await B.type('#hub-code-input', 'ZZZZZ');
  await B.click('#hub-join');
  t('erreur réelle SESSION_NOT_FOUND : phrase lisible à l\'écran',
    /Aucune session avec ce code/.test(await B.until(`document.getElementById('hub-msg').textContent`, 60000, 'message d\'erreur')));
  await B.type('#hub-code-input', 'AB');
  await B.click('#hub-join');
  t('code mal formé : refusé avant le réseau, en phrase', /5 caractères/.test(await B.eval(`document.getElementById('hub-msg').textContent`)));

  // L'action principale du salon (sous les joueurs) : le bouton chez l'hôte,
  // la phrase d'attente chez les autres ; et les trois blocs frères du salon.
  const ACT = `(() => { const R = (id) => { const e = document.getElementById(id); return e && !e.hidden && e.offsetParent ? e.getBoundingClientRect() : null; };
    const pl = R('hub-players'), btn = R('hub-draw-btn'), wait = R('hub-wait'), act = R('hub-act');
    return { bouton: !!btn, sousJoueurs: !!act && !!pl && act.top >= pl.bottom - 1 && (!btn || btn.top >= pl.bottom),
      dansSalon: !!document.getElementById('hub-act').closest('#lobby'), attente: document.getElementById('hub-act').classList.contains('is-waiting'),
      texte: document.getElementById('hub-wait').textContent, attenteVue: !!wait,
      salon: !!R('lobby'), score: !!R('hub-score'), jeux: !!R('hub-lobby-games'), finish: !!R('hub-finish'),
      scoreVide: document.getElementById('hub-score').classList.contains('is-empty'), scoreH: R('hub-score') ? Math.round(R('hub-score').height) : 0,
      lignesVues: [...document.querySelectorAll('#hub-score-list .hub-score-row')].filter((li) => li.offsetParent).length,
      lignes: document.querySelectorAll('#hub-score-list .hub-score-row').length }; })()`;

  // ═══ 3. A crée, B rejoint
  await A.click('#hub-create');
  await A.until(`!document.getElementById('lobby').hidden && document.querySelectorAll('#hub-players .hub-card').length === 1`, 60000, 'salon de A');
  const code = await A.eval(`document.getElementById('hub-code').textContent.trim()`);
  t('le code affiché est un code de Hub (5 caractères de son alphabet)', H.normalizeCode(code) === code, code);
  await B.type('#hub-code-input', code.toLowerCase());
  await B.click('#hub-join');
  await B.until(`document.querySelectorAll('#hub-players .hub-card').length === 2`, 30000, 'salon de B');
  await A.until(`document.querySelectorAll('#hub-players .hub-card').length === 2`, 10000, 'A voit B');

  for (const [J, vu] of [[A, 'A'], [B, 'B']]) {
    const s = await J.eval(SALON);
    const a = s.cartes.find((c) => c.id === idA1), b = s.cartes.find((c) => c.id === idB);
    t(`${vu} voit A et B dans le salon`, !!a && !!b && a.nom === 'Alice' && b.nom === 'Bruno');
    t(`${vu} voit la vraie PP de A (img décodée, src exacte)`, !!a && a.img === srcA && a.decodee);
    t(`${vu} voit l'emoji de B`, !!b && !b.img && b.emoji === emojiB, b && `« ${b.emoji} »`);
    t(`${vu} : PP et emoji dans la même boîte (${a && a.taille})`, !!a && !!b && a.taille === b.taille && /^(68x68|60x60)$/.test(a.taille));
    t(`${vu} voit A comme hôte, et B non`, a.host && !b.host);
    t(`${vu} : sa propre carte porte « toi »`, s.cartes.filter((c) => c.moi).length === 1 && s.cartes.find((c) => c.moi).id === (vu === 'A' ? idA1 : idB));
    t(`${vu} : même code de session affiché`, s.code === code);
    t(`${vu} : aucun « [object » ni « [obj » à l'écran`, !/\[obj/.test(s.texte));
  }
  t("compte des joueurs", /^2 joueurs dans la session$/.test((await A.eval(SALON)).count));
  {
    const a = await A.eval(ACT), b = await B.eval(ACT);
    t('hôte A : « Tirer » juste sous les joueurs, dans le salon ; « Terminer » à lui seul', a.bouton && a.sousJoueurs && a.dansSalon && !a.attente && a.finish, JSON.stringify(a));
    t('invité B : pas de bouton ni de « Terminer », mais « En attente de Alice », à la même place', !b.bouton && !b.finish && b.attente && b.attenteVue && b.sousJoueurs
      && /En attente de Alice/.test(b.texte), JSON.stringify(b));
    t('les trois blocs du salon sont là chez les deux (salon, score, jeux)', [a, b].every((x) => x.salon && x.score && x.jeux));
    t('2 joueurs, aucune partie : score en une ligne (« Aucune partie jouée »), aucune ligne à 0 visible', [a, b].every((x) => x.scoreVide && x.lignesVues === 0 && x.lignes === 2 && x.scoreH <= 110), JSON.stringify([a.scoreH, b.scoreH]));
  }
  await A.shot('2-salon-A'); await B.shot('2-salon-B');

  // Copier : exactement le code reçu.
  await A.grant(`http://127.0.0.1:${HTTP_PORT}`);
  await A.click('#hub-code');
  const copie = await A.eval(`navigator.clipboard.readText().catch(() => null)`);
  const hint = await A.eval(`document.getElementById('hub-code-hint').textContent`);
  t('copier : le presse-papiers contient exactement le code', copie === code || (copie === null && /copié/.test(hint)), `${copie} / ${hint}`);

  // ═══ 3b. Lot C — du tirage au lancement, chez l'hôte ET chez l'invité.
  // Le cycle n'est PAS modifié : tirage → « Continuer » → lancement (étape
  // create) → annulation par l'hôte → retour au salon, comme avant. On ne
  // navigue vers aucun jeu ici (handoff-play.mjs le fait) : on lit le Hub.
  // ⚠️ RÉGRESSION DU LOT C, gardée ici : après un lancement ANNULÉ (ou raté),
  // la caisse gardait `is-launching`, qui masque la bande. Le tirage suivant
  // tournait sur une bande non rendue : aucune animation, bande figée à la
  // révélation, gagnant même pas sous le repère. On observe donc TROIS tirages,
  // séparés chacun par un lancement annulé, chez l'hôte ET chez l'invité : la
  // bande doit être visible et DÉFILER (positions relevées pendant la
  // rotation), puis s'arrêter sur le jeu du serveur. En mouvement réduit : pas
  // de défilement, mais la bande visible et le bon jeu sous le repère.
  const BANDE = `(() => { const reel = document.getElementById('hub-reel'), s = reel.querySelector('.reel-strip'), r = reel.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const c = [...reel.querySelectorAll('.reel-cell')].find((el) => { const b = el.getBoundingClientRect(); return x >= b.left && x <= b.right && y >= b.top && y <= b.bottom; });
    const res = document.getElementById('hub-result');
    return { dx: Math.round(new DOMMatrix(getComputedStyle(s).transform).m41), vue: reel.checkVisibility(), sous: c ? c.dataset.game : null,
      lancement: document.getElementById('hub-draw').classList.contains('is-launching'), res: res.hidden ? null : res.dataset.game }; })()`;
  async function tirageObserve(n) {
    await A.click('#hub-draw-btn');
    const vus = { A: [], B: [] };
    for (let i = 0; i < 80; i++) {
      for (const [J, k] of [[A, 'A'], [B, 'B']]) vus[k].push(await J.eval(BANDE));
      if (vus.A[vus.A.length - 1].res && vus.B[vus.B.length - 1].res) break;
      await sleep(90);
    }
    for (const [k, role] of [['A', 'hôte'], ['B', 'invité']]) {
      const v = vus[k], fin = v[v.length - 1];
      const pendant = v.filter((x) => !x.res && x.vue);
      const positions = new Set(pendant.map((x) => x.dx)).size;
      const anime = REDUCED || positions >= 4;
      t(`tirage ${n}, ${role} : ${REDUCED ? 'bande posée d’emblée' : 'la bande DÉFILE (' + positions + ' positions)'}, jamais masquée, arrêtée sur le jeu du serveur`,
        anime && fin.vue && v.every((x) => !x.lancement) && !!fin.res && fin.sous === fin.res,
        JSON.stringify({ positions, vue: fin.vue, lancement: v.some((x) => x.lancement), sous: fin.sous, res: fin.res }));
    }
  }
  async function annuleLancement() {
    await A.until(`!document.getElementById('hub-result').hidden && !document.getElementById('hub-continue').hidden`, 15000, 'Continuer');
    await A.click('#hub-continue');
    for (const J of [A, B]) await J.until(`!document.getElementById('hub-launch').hidden`, 8000, `lancement ${J.nom}`);
    await A.click('#launch-cancel');
    for (const J of [A, B]) await J.until(`document.getElementById('hub-launch').hidden && !document.getElementById('hub-failed').hidden`, 8000, `retour au salon ${J.nom}`);
    await A.until(`!document.getElementById('hub-draw-btn').hidden && !document.getElementById('hub-draw-btn').disabled`, 8000, 'Tirer de nouveau');
  }
  {
    const TITRE0 = await B.eval('document.title');
    await tirageObserve(1);
    for (const J of [A, B]) await J.until(`!document.getElementById('hub-result').hidden && !!document.getElementById('hub-result').dataset.game`, 15000, `révélation ${J.nom}`);
    const jeu = await A.eval(`document.getElementById('result-title').textContent`);
    const rv = await A.eval(`({ focus: document.activeElement && document.activeElement.id, cont: document.getElementById('hub-continue').textContent })`);
    const rvB = await B.eval(`({ cont: !document.getElementById('hub-continue').hidden, att: document.getElementById('hub-continue-wait').textContent })`);
    t('révélation, hôte : « ▶ Continuer — lancer <jeu> », et le focus dessus', rv.focus === 'hub-continue' && rv.cont === `▶ Continuer — lancer ${jeu}`, JSON.stringify(rv));
    t('révélation, invité : pas de bouton, « ⏳ En attente de Alice pour lancer <jeu> »', !rvB.cont && rvB.att.startsWith(`⏳ En attente de Alice pour lancer ${jeu}`), rvB.att);
    await A.click('#hub-continue');
    for (const J of [A, B]) await J.until(`!document.getElementById('hub-launch').hidden`, 8000, `lancement ${J.nom}`);
    await sleep(150);
    const LANCE = `(() => { const go = document.getElementById('launch-go'), box = document.getElementById('hub-launch'), r = go.getBoundingClientRect();
      return { go: !go.hidden, txt: go.textContent, focus: document.activeElement && document.activeElement.id, tour: box.classList.contains('is-your-turn'),
        titre: document.title, role: document.getElementById('launch-title').getAttribute('role'), lt: document.getElementById('launch-title').textContent,
        serre: document.getElementById('hub-draw').classList.contains('is-launching'), vu: !go.hidden && r.top >= 0 && r.bottom <= innerHeight,
        over: document.documentElement.scrollWidth - innerWidth }; })()`;
    const la = await A.eval(LANCE), lb = await B.eval(LANCE);
    t('lancement, hôte : « ▶ Ouvrir <jeu> », le focus y est passé tout seul, encart « à toi »', la.go && la.txt === `▶ Ouvrir ${jeu}` && la.focus === 'launch-go' && la.tour, JSON.stringify(la));
    t('lancement, hôte : l\'onglet dit l\'action (« ▶ Ouvrir … · Game Hub »)', la.titre === `▶ Ouvrir ${jeu} · Game Hub`, la.titre);
    t('lancement, invité : aucun bouton, pas d\'encart « à toi », onglet inchangé, « Alice crée la partie… »',
      !lb.go && !lb.tour && lb.titre === TITRE0 && /Alice crée la partie/.test(lb.lt), JSON.stringify(lb));
    t('lancement : titre d\'étape annoncé (role=status), fiche du jeu resserrée chez les deux', la.role === 'status' && la.serre && lb.serre);
    for (const [w, h] of [[390, 780], [768, 1024], [1100, 1000], [1280, 900]]) {
      await A.size(w, h); await B.size(w, h); await sleep(200);
      await A.eval(`document.getElementById('launch-go').scrollIntoView({ block: 'center', behavior: 'instant' }); true`);
      const m = await A.eval(LANCE), mb = await B.eval(LANCE);
      t(`${w} px : « Ouvrir » à l'écran chez l'hôte, aucun débordement chez les deux`, m.vu && m.over <= 0 && mb.over <= 0, JSON.stringify({ vu: m.vu, over: m.over, overB: mb.over }));
      await A.shot(`2c-lancement-hote-${w}`); await B.shot(`2c-lancement-invite-${w}`);
    }
    await A.size(1100, 1000); await B.size(1100, 1000); await sleep(150);
    await A.click('#launch-cancel');
    for (const J of [A, B]) await J.until(`document.getElementById('hub-launch').hidden && !document.getElementById('hub-failed').hidden`, 8000, `retour au salon ${J.nom}`);
    const fin = await A.eval(`({ titre: document.title, tirer: !document.getElementById('hub-draw-btn').hidden })`);
    t('annulation : retour au salon comme avant (raison affichée, « Tirer » chez l\'hôte), onglet rendu', fin.tirer && fin.titre === TITRE0, JSON.stringify(fin));
    await A.until(`!document.getElementById('hub-draw-btn').disabled`, 8000, 'Tirer de nouveau');
    // Tirages 2 et 3, chacun après un lancement annulé : c'est là que la bande
    // restait figée.
    await tirageObserve(2);
    await A.shot('2d-tirage-2-hote'); await B.shot('2d-tirage-2-invite');
    await annuleLancement();
    await tirageObserve(3);
    await annuleLancement();
  }

  // ═══ 4. B recharge : il reprend SA place (même player.id, pas de doublon)
  await B.reload();
  await B.until(`!document.getElementById('lobby').hidden && document.querySelectorAll('#hub-players .hub-card').length === 2`, 15000, 'reprise de B');
  const apres = await A.eval(SALON);
  t('rechargement : B revient avec le MÊME id, aucun doublon', apres.cartes.length === 2 && apres.cartes.filter((c) => c.id === idB).length === 1);
  t('rechargement : B connecté (pas absent)', !apres.cartes.find((c) => c.id === idB).absent);

  // ═══ 5. VRAIE coupure de socket (A ferme sa page) : absent, grâce conservée
  await A.leavePage();
  await B.until(`(() => { const c = [...document.querySelectorAll('#hub-players .hub-card')]; const a = c.find((x) => x.dataset.player === ${JSON.stringify(idA1)}); const b = c.find((x) => x.dataset.player === ${JSON.stringify(idB)});
    return a && b && a.classList.contains('is-away') && !!b.querySelector('.hub-tag.host') && !a.querySelector('.hub-tag.host'); })()`, 15000, 'A absent, B hôte');
  const vuB = await B.eval(SALON);
  t('coupure de socket : B voit A « absent » (gardé, pas retiré)', vuB.cartes.find((c) => c.id === idA1).absent && vuB.cartes.length === 2);
  t("coupure de socket : l'hôte passe à B", vuB.cartes.find((c) => c.id === idB).host && !vuB.cartes.find((c) => c.id === idA1).host);
  t("le texte le dit à B : « Tu es l'hôte »", /Tu es l'hôte/.test(await B.eval(`document.getElementById('hub-wait').textContent`)));
  {
    const b = await B.eval(ACT);
    t('changement d\'hôte : B reçoit le bouton « Tirer » sous les joueurs, et « Terminer »', b.bouton && b.sousJoueurs && !b.attente && b.finish, JSON.stringify(b));
  }
  await B.shot('3-hote-change-B');
  // A revient dans le même onglet pendant le délai de grâce : il reprend SA place.
  await A.goto(PAGE);
  await A.until(`!document.getElementById('lobby').hidden && document.querySelectorAll('#hub-players .hub-card').length === 2`, 15000, 'reprise de A');
  await B.until(`(() => { const a = document.querySelector('#hub-players .hub-card[data-player=' + JSON.stringify(${JSON.stringify(idA1)}) + ']'); return a && !a.classList.contains('is-away'); })()`, 10000, 'A de retour');
  const retour = await B.eval(SALON);
  t('pendant la grâce : A revient avec le MÊME id, aucun doublon', retour.cartes.length === 2 && retour.cartes.filter((c) => c.id === idA1).length === 1);
  t('pendant la grâce : B reste hôte (le plus ancien encore connecté)', retour.cartes.find((c) => c.id === idB).host);
  {
    const a = await A.eval(ACT);
    t('A revenu, désormais invité : plus de bouton, « En attente de Bruno »', !a.bouton && !a.finish && a.attente && /En attente de Bruno/.test(a.texte), JSON.stringify(a));
  }

  // ═══ 6. salon plein : 12 joueurs, aux 3 tailles
  for (let i = 0; i < 10; i++) {
    const x = H.createClient({ url: HUB, retryDelays: [] });
    extras.push(x);
    await x.join(code, { id: 'p_bot' + String(i).padStart(3, '0'), name: ['Chloé', 'Maximilien-Anne', 'Dan', 'Eva', 'Farid', 'Gaëlle', 'Hugo', 'Inès', 'Jules', 'Kenza'][i],
      avatar: { kind: 'emoji', emoji: ['🐸', '🤖', '👻', '😎', '🔥', '⚡', '🎯', '🎧', '🍕', '🚀'][i] } });
  }
  await B.until(`document.querySelectorAll('#hub-players .hub-card').length === 12`, 10000, '12 cartes');
  {
    const b = await B.eval(ACT);
    t('12 joueurs, aucune partie : toujours une seule ligne de score, pas douze zéros', b.scoreVide && b.lignesVues === 0 && b.lignes === 6 && b.scoreH <= 110, JSON.stringify({ h: b.scoreH, l: b.lignes }));
  }
  for (const [w, h] of [[390, 780], [768, 1024], [1920, 1080]]) {
    await B.size(w, h); await sleep(250);
    const m = await B.eval(`(() => { const cards = [...document.querySelectorAll('#hub-players .hub-card')];
      const boxes = cards.map((c) => c.getBoundingClientRect());
      let chev = 0; for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j]; if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) chev++; }
      const code = document.getElementById('hub-code').getBoundingClientRect();
      const leave = document.getElementById('hub-leave').getBoundingClientRect();
      const act = document.getElementById('hub-act').getBoundingClientRect(), der = boxes.reduce((m, b) => Math.max(m, b.bottom), 0);
      return { over: document.documentElement.scrollWidth - innerWidth, chev, cols: new Set(boxes.map((b) => Math.round(b.left))).size,
        code: code.width > 0 && code.right <= innerWidth && code.left >= 0, leave: leave.width > 0 && leave.right <= innerWidth,
        act: act.top >= der - 1, tirer: !document.getElementById('hub-draw-btn').hidden && document.getElementById('hub-draw-btn').getBoundingClientRect().top >= der,
        av: [...document.querySelectorAll('#hub-players .g-av')].every((a) => a.getBoundingClientRect().width >= 44) }; })()`);
    t(`${w}×${h} : 12 joueurs, aucun débordement ni chevauchement (${m.cols} colonnes)`, m.over <= 0 && m.chev === 0, JSON.stringify(m));
    t(`${w}×${h} : code visible, bouton « Quitter » accessible, PP ≥ 44 px`, m.code && m.leave && m.av);
    t(`${w}×${h} : 12 joueurs — « Tirer » (B, hôte) reste juste après la DERNIÈRE carte`, m.act && m.tirer, JSON.stringify({ act: m.act, tirer: m.tirer }));
    await B.shot(`4-salon-12-${w}`);
  }
  await B.size(1100, 1000);
  extras.forEach((x) => x.leave());
  await B.until(`document.querySelectorAll('#hub-players .hub-card').length === 2`, 10000, 'départ des 10');

  // ═══ 7. A fait un LEAVE explicite : B le voit disparaître tout de suite, et reste
  const t7 = Date.now();
  await A.click('#hub-leave');
  await B.until(`!document.querySelector('#hub-players .hub-card[data-player=' + JSON.stringify(${JSON.stringify(idA1)}) + ']')`, 5000, 'A disparaît');
  const ms7 = Date.now() - t7;
  const seul = await B.eval(SALON);
  t(`leave explicite de A : B le voit disparaître immédiatement (${ms7} ms, sans délai de grâce)`, ms7 < 3000 && seul.cartes.length === 1);
  t('leave explicite de A : B reste dans la session, et hôte', seul.visible && seul.cartes[0].id === idB && seul.cartes[0].host);
  t("A est revenu à l'écran d'entrée", await A.until(`!document.getElementById('entry').hidden`, 5000));
  {
    const a = await A.eval(ACT);
    t("… et tout le salon est rangé chez A (salon, score, jeux et actions secondaires)", !a.salon && !a.score && !a.jeux && !a.finish, JSON.stringify(a));
  }

  // ═══ 8. B, dernier présent, fait un leave : la session disparaît IMMÉDIATEMENT
  await B.click('#hub-leave');
  t("B quitte : retour à l'écran d'entrée", await B.until(`!document.getElementById('entry').hidden && document.getElementById('lobby').hidden`, 5000));
  if (!PROD) {
    const t8 = Date.now(); let h = null;
    for (let i = 0; i < 40; i++) { h = await health(); if (h.sessions === 0) break; await sleep(50); }
    t(`dernier leave : la session disparaît immédiatement du serveur (${Date.now() - t8} ms)`, h.sessions === 0 && h.players === 0 && Date.now() - t8 < 2000, JSON.stringify(h));
  } else {
    t('production : pas de lecture de /health par session (le compteur mélange tout le monde)', true);
  }

  const errs = [A, B].flatMap((J) => J.erreurs.map((e) => `[${J.nom}] ${e}`));
  t('aucune erreur JS dans les pages', errs.length === 0, errs.slice(0, 3).join(' | '));
} catch (e) {
  t('EXCEPTION', false, e.message);
} finally {
  stop();
}

console.log(`\n${ko ? 'DES TESTS ÉCHOUENT' : 'TOUT PASSE'} — ${out.length} vérifications, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
