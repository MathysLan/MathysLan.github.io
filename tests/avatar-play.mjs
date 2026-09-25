// La photo de profil en VRAIE partie, dans les six jeux qui reçoivent une
// identité — de bout en bout, sans un seul mock :
//
//   UI de GameProfile (vrai champ fichier) → join → WebSocket → serveur
//   (avatar.js) → état joueur → diffusion → client → <img> décodée à l'écran
//
//   node tests/avatar-play.mjs
//   node tests/avatar-play.mjs --edge "C:\chemin\vers\msedge.exe"
//   node tests/avatar-play.mjs --only quiment
//
// Les six serveurs sont lancés EN LOCAL depuis leurs dépôts voisins
// (../imitation-server, ../demicercle-server, …) : c'est leur code courant qui
// est testé, pas la production. `npm install` doit y avoir été fait.
//
// Trois joueurs, chacun dans son propre contexte de navigation (donc son propre
// localStorage, comme trois personnes sur trois machines) :
//   A — une vraie photo, posée par le vrai champ fichier du profil ;
//   B — un emoji ;
//   C — une photo dont l'en-tête est valide (le serveur l'accepte) mais dont le
//       contenu est illisible : le navigateur ne sait pas la décoder, et TOUT
//       LE MONDE doit retomber sur l'emoji de C, sans que son profil change.
//
// Ce qui est lu : les trames WebSocket réellement reçues (protocole DevTools,
// Network.webSocketFrameReceived) ET le DOM, image par image, avec
// `naturalWidth > 0` — une <img> présente mais pas décodée ne compte pas.
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PERSO = path.resolve(ROOT, '..');
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const EDGE = arg('--edge') || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ONLY = arg('--only');
// --shots <dossier> : une capture de chaque écran vérifié, pour juger à l'œil.
const SHOTS = arg('--shots');
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const R = () => Math.floor(Math.random() * 400);
const HTTP_PORT = 8700 + R();
const CDP_PORT = 9700 + R();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let out = [], ko = 0;
const t = (nom, ok, detail = '') => {
  out.push(`${ok ? 'OK  ' : 'KO  '} ${nom}${detail ? ' — ' + detail : ''}`);
  if (!ok) ko++;
  console.log(out[out.length - 1]);
};

// --- les six serveurs ---------------------------------------------------------
const SERVEURS = {
  imitation: { repo: 'imitation-server', main: 'src/server.js', env: { VIDEOS_URL: '', RECORD_GRACE_MS: '300', ROUNDS: '1' } },
  demicercle: { repo: 'demicercle-server', main: 'src/server.js', env: {} },
  ban: { repo: 'ban-server', main: 'src/server.js', env: { TURN_SAFETY_MS: '800', VIDEOS_JSON: '[{"id":"v","fatal":1.0,"startAt":0}]' } },
  precision: { repo: 'precision-server', main: 'src/server.js', env: { LEAD_MS: '200' } },
  passeur: { repo: 'passeur-server', main: 'server.js', env: {} },
  quiment: { repo: 'qui-ment-server', main: 'server.js', env: {} },
};
const procs = [];
async function lanceServeurs() {
  let port = 8100 + R();
  for (const [g, s] of Object.entries(SERVEURS)) {
    s.port = port++;
    const cwd = path.join(PERSO, s.repo);
    if (!fs.existsSync(path.join(cwd, 'node_modules', 'ws'))) throw new Error(`${s.repo} : lancer « npm install » d'abord`);
    const p = spawn(process.execPath, [s.main], { cwd, env: { ...process.env, ...s.env, PORT: String(s.port) }, stdio: 'ignore' });
    procs.push(p);
    for (let i = 0; i < 80; i++) {
      try { await fetch(`http://127.0.0.1:${s.port}/`); s.up = true; break; } catch (_) { await sleep(100); }
    }
    if (!s.up) throw new Error(`${s.repo} ne démarre pas`);
  }
}

// --- serveur statique du portfolio -----------------------------------------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp' };
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

// --- CDP, niveau navigateur, sessions « aplaties » ---------------------------
async function cdpBrowser() {
  let url = null;
  for (let i = 0; i < 50 && !url; i++) {
    try { url = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json()).webSocketDebuggerUrl; }
    catch (_) { await sleep(200); }
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
    send(method, params = {}, sessionId) {
      const mid = ++id; ws.send(JSON.stringify({ id: mid, method, params, sessionId }));
      return new Promise((res) => waiting.set(mid, res));
    },
    on(sessionId, fn) { listeners.set(sessionId, fn); },
    close() { try { ws.close(); } catch (_) {} },
  };
}

// Un joueur = un contexte de navigation isolé + un onglet.
async function joueur(cdp, nom) {
  const { result: { browserContextId } } = await cdp.send('Target.createBrowserContext', { disposeOnDetach: true });
  const { result: { targetId } } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { result: { sessionId } } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const J = { nom, sessionId, recus: [], envoyes: [], erreurs: [] };
  cdp.on(sessionId, (m) => {
    if (m.method === 'Network.webSocketFrameReceived') J.recus.push(m.params.response.payloadData);
    if (m.method === 'Network.webSocketFrameSent') J.envoyes.push(m.params.response.payloadData);
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      J.erreurs.push((d.exception?.description || d.text || '').split('\n')[0]);
    }
  });
  const S = (method, params) => cdp.send(method, params, sessionId);
  await S('Runtime.enable'); await S('Page.enable'); await S('Network.enable'); await S('DOM.enable');
  await S('Emulation.setDeviceMetricsOverride', { width: 1100, height: 1000, deviceScaleFactor: 1, mobile: false });
  J.eval = async (expression) => {
    const r = await S('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(`[${nom}] ` + (r.result.exceptionDetails.exception?.description || 'erreur JS').split('\n')[0]);
    return r.result?.result?.value;
  };
  J.goto = async (url) => {
    await S('Page.navigate', { url });
    for (let i = 0; i < 60; i++) {
      await sleep(100);
      // ⚠️ `NET` est un `const` global : il n'est PAS une propriété de window.
      try { if (await J.eval(`document.readyState === 'complete' && !!window.GameAvatar && typeof NET !== 'undefined'`)) return; } catch (_) {}
    }
    throw new Error(`[${nom}] la page ne se charge pas : ${url}`);
  };
  // Vrai clic, aux coordonnées réelles de l'élément (après l'avoir amené à l'écran).
  J.click = async (sel) => {
    const box = await J.eval(`(() => {
      const e = document.querySelector(${JSON.stringify(sel)});
      if (!e) return null;
      // 'instant' : un défilement doux déplacerait l'élément sous le curseur.
      e.scrollIntoView({ block: 'center', behavior: 'instant' });
      const r = e.getBoundingClientRect();
      return r.width && r.height ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
    })()`);
    if (!box) throw new Error(`[${nom}] introuvable ou invisible : ${sel}`);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await S('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
    }
    await sleep(80);
  };
  J.type = async (sel, text) => {
    await J.click(sel);
    await J.eval(`document.querySelector(${JSON.stringify(sel)}).select()`);
    await S('Input.insertText', { text });
    await sleep(60);
  };
  // Un vrai fichier dans le vrai <input type=file> (déclenche `change`).
  J.upload = async (sel, file) => {
    const { result: { root } } = await S('DOM.getDocument', { depth: 0 });
    const { result: { nodeId } } = await S('DOM.querySelector', { nodeId: root.nodeId, selector: sel });
    await S('DOM.setFileInputFiles', { files: [file], nodeId });
  };
  J.until = async (expr, ms = 8000, label = expr) => {
    const fin = Date.now() + ms;
    while (Date.now() < fin) {
      try { const v = await J.eval(expr); if (v) return v; } catch (_) {}
      await sleep(80);
    }
    // Diagnostic : ce que la page affiche comme erreur, et la dernière trame.
    let etat = '';
    try { etat = await J.eval(`(document.getElementById('error') || {}).textContent || ''`); } catch (_) {}
    const der = J.recus.length ? J.recus[J.recus.length - 1].slice(0, 160) : '(aucune trame)';
    throw new Error(`[${nom}] attente expirée : ${label} — erreur affichée « ${etat} » — dernière trame ${der}`);
  };
  J.shot = async (nom) => {
    const r = await S('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    if (r.result?.data) fs.writeFileSync(path.join(SHOTS, `${nom}.png`), Buffer.from(r.result.data, 'base64'));
  };
  // Quitter la page ferme le WebSocket : le serveur voit partir le joueur.
  J.leave = async () => { await S('Page.navigate', { url: 'about:blank' }); await sleep(300); };
  J.visible = (sel) => J.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && !e.closest('[hidden]') && e.getClientRects().length > 0; })()`);
  // Trames JSON reçues, décodées.
  J.msgs = () => J.recus.map((s) => { try { return JSON.parse(s); } catch (_) { return null; } }).filter(Boolean);
  return J;
}

// --- ce qu'on lit dans le DOM -----------------------------------------------
// Pour un conteneur : chaque avatar affiché, avec le texte de sa « ligne »
// (li, rangée de résultat, bouton de vote…) pour savoir à qui il appartient.
const LIGNE = 'li, .res-row, .rank-row, .clue-row, .rv-row, button, .lg, #listen-name, #res-verdict';
const lireAvatars = (sel) => `(() => {
  const root = document.querySelector(${JSON.stringify(sel)});
  if (!root) return null;
  return [...root.querySelectorAll('.g-av')].map((a) => {
    const row = a.closest(${JSON.stringify(LIGNE)}) || a.parentElement;
    const img = a.querySelector('img');
    return {
      ligne: row.textContent.replace(/\\s+/g, ' ').trim(),
      img: img ? img.getAttribute('src') : null,
      decodee: img ? (img.complete && img.naturalWidth > 0) : false,
      largeur: img ? Math.round(img.getBoundingClientRect().width) : 0,
      texte: img ? '' : a.textContent,
      // La boîte d'identité elle-même (photo OU emoji) et sa taille nommée.
      taille: (a.className.match(/g-av--(sm|md|lg)/) || [])[1] || null,
      bw: Math.round(a.getBoundingClientRect().width), bh: Math.round(a.getBoundingClientRect().height),
    };
  });
})()`;

// Alignement en colonnes : pour chaque rangée des listes données, le centre
// horizontal de l'avatar et le bord gauche du pseudo. Tous doivent coïncider
// (à 1 px près), même quand les avatars n'ont pas la même taille.
const ALIGNEMENT = (rangees, nom) => `(() => {
  const rows = ${JSON.stringify(rangees)}.flatMap((s) => [...document.querySelectorAll(s)]).filter((r) => r.getClientRects().length);
  const av = rows.map((r) => { const b = r.querySelector('.g-av').getBoundingClientRect(); return Math.round(b.left + b.width / 2); });
  const nm = rows.map((r) => Math.round(r.querySelector(${JSON.stringify(nom)}).getBoundingClientRect().left));
  const serre = (xs) => xs.length > 1 && Math.max(...xs) - Math.min(...xs) <= 1;
  return { ok: serre(av) && serre(nm), centres: av, pseudos: nm };
})()`;

// Vérifie, dans un emplacement, l'avatar de A (photo), B (emoji) et C (repli).
async function verifie(J, lieu, sel, P, qui = ['A', 'B']) {
  let av = null;
  try {
    await J.until(`(() => { const r = ${lireAvatars(sel)}; return r && r.length && r.every((x) => !x.img || x.decodee || x.texte); })()`, 6000, `avatars de ${sel}`);
  } catch (_) { /* on lit quand même, l'échec se verra plus bas */ }
  // Laisse le temps à une image illisible de déclencher son `error`.
  await sleep(150);
  av = await J.eval(lireAvatars(sel));
  const de = (nom) => (av || []).find((x) => x.ligne.includes(nom));
  if (qui.includes('A')) {
    const a = de(P.A.name);
    t(`${lieu} — PP de ${P.A.name} affichée (vue par ${J.nom})`,
      !!a && a.img === P.A.src && a.decodee, a ? `img=${!!a.img} décodée=${a.decodee}` : 'absente');
    // Taille à l'écran, quand l'écran est visible (0 = masqué, voir le podium du Demi-Cercle).
    if (a && a.img && a.largeur > 0) t(`${lieu} — la PP n'est jamais agrandie (${a.largeur}px ≤ 96px)`, a.largeur <= 96);
  }
  // Géométrie (phase de finition du 2026-09-19) : un avatar dimensionné est un
  // CARRÉ d'une taille de la hiérarchie, et une photo et un emoji de même
  // taille nommée occupent exactement la même boîte — sinon le passage de l'un
  // à l'autre décalerait la mise en page.
  const vus = (av || []).filter((x) => x.taille && x.bw > 0);
  if (vus.length) {
    const TAILLES = [32, 36, 44, 48, 60, 68];
    t(`${lieu} — avatars carrés, à une taille de la hiérarchie (vu par ${J.nom})`,
      vus.every((x) => x.bw === x.bh && TAILLES.includes(x.bw)), vus.map((x) => `${x.taille}:${x.bw}x${x.bh}`).join(' '));
    const parTaille = {};
    vus.forEach((x) => { (parTaille[x.taille] = parTaille[x.taille] || new Set()).add(`${x.bw}x${x.bh}`); });
    t(`${lieu} — photo et emoji : même boîte à taille égale (vu par ${J.nom})`,
      Object.values(parTaille).every((s) => s.size === 1), JSON.stringify(Object.fromEntries(Object.entries(parTaille).map(([k, s]) => [k, [...s]]))));
    const a = de(P.A.name);
    if (qui.includes('A') && a && a.taille) t(`${lieu} — la PP a un vrai poids visuel (${a.bw}px ≥ 32px)`, a.bw >= 32);
  }
  t(`${lieu} — aucun débordement horizontal (vu par ${J.nom})`,
    await J.eval(`document.documentElement.scrollWidth <= innerWidth`));
  if (SHOTS) await J.shot(`${lieu.replace(/[^a-z0-9]+/gi, '-')}-${J.nom}`);
  // Le bug vu à la main : un avatar objet converti en chaîne quelque part.
  const fuite = await J.eval(`(() => { const m = document.body.innerText.match(/\\[obj(ect)?[^\\n]{0,20}|\\bundefined\\b|\\bnull\\b/); return m && m[0]; })()`);
  t(`${lieu} — aucun « [object Object] » / « [obj » dans le texte visible (vu par ${J.nom})`, !fuite, fuite || '');
  if (qui.includes('B')) {
    const b = de(P.B.name);
    t(`${lieu} — emoji de ${P.B.name} affiché (vu par ${J.nom})`, !!b && !b.img && b.texte === P.B.emoji, b ? `« ${b.texte} »` : 'absent');
  }
  if (qui.includes('C')) {
    const c = de(P.C.name);
    t(`${lieu} — image illisible de ${P.C.name} → son emoji (vu par ${J.nom})`, !!c && !c.img && c.texte === P.C.emoji, c ? `img=${!!c.img} « ${c.texte} »` : 'absent');
  }
  return av;
}

// Trames : l'avatar de A tel que les autres l'ont reçu, partout où il passe.
function avatarsRecus(J, id) {
  const vus = [];
  const fouille = (o) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) return o.forEach(fouille);
    if ((o.id === id || o.player === id) && 'avatar' in o) vus.push(o.avatar);
    Object.values(o).forEach(fouille);
  };
  J.msgs().forEach(fouille);
  return vus;
}

// ------------------------------------------------------------ préparation
const URL = (g) => `http://127.0.0.1:${HTTP_PORT}/games/${g}/index.html?server=ws://127.0.0.1:${SERVEURS[g].port}`
  + `&cdn=http://127.0.0.1:${HTTP_PORT}/__pas_de_video`;

// Une photo « lisible par le serveur, illisible par le navigateur » : bon
// en-tête RIFF/WEBP (la signature que vérifie avatar.js), contenu aléatoire.
function webpIllisible() {
  const corps = Buffer.concat([Buffer.from('WEBPVP8 '), Buffer.alloc(4), Buffer.from(Array.from({ length: 300 }, (_, i) => (i * 97 + 13) % 256))]);
  corps.writeUInt32LE(300, 8);
  const tete = Buffer.alloc(8); tete.write('RIFF', 0); tete.writeUInt32LE(corps.length, 4);
  return 'data:image/webp;base64,' + Buffer.concat([tete, corps]).toString('base64');
}

async function profils(A, B, C) {
  // A : pseudo tapé, photo posée par le vrai champ fichier du module de profil.
  await A.goto(URL('passeur'));
  await A.eval(`localStorage.clear()`);
  await A.goto(URL('passeur'));
  await A.type('#name-input', 'Alice');
  await A.eval(`document.getElementById('name-input').dispatchEvent(new Event('change'))`);
  await A.upload('#gp-file', path.join(ROOT, 'assets', 'og-image.png'));
  await A.until(`(() => { const p = JSON.parse(localStorage.getItem('mathys_game_profile') || 'null'); return p && p.avatar.kind === 'image'; })()`, 8000, 'photo enregistrée');
  const pa = await A.eval(`JSON.parse(localStorage.getItem('mathys_game_profile'))`);
  const octets = Buffer.from(pa.avatar.src.split(',')[1], 'base64');
  t(`profil A : photo passée par le vrai champ fichier (og-image.png 1200×630 → ${octets.length} o)`,
    pa.avatar.kind === 'image' && /^data:image\/(webp|png);base64,/.test(pa.avatar.src) && octets.length <= 12 * 1024);
  t('profil A : c\'est bien du webp produit par le canvas', octets.toString('latin1', 0, 4) === 'RIFF' && octets.toString('latin1', 8, 12) === 'WEBP');
  t('profil A : l\'aperçu du choix d\'identité affiche la photo', await A.eval(`!!document.querySelector('.gp-preview:not([hidden])')`));
  t('profil A : le message dit que la photo part en jeu',
    /visible en jeu/.test(await A.eval(`document.querySelector('.gp-msg').textContent`)));

  // B : emoji, choisi en cliquant.
  await B.goto(URL('passeur'));
  await B.eval(`localStorage.clear()`);
  await B.goto(URL('passeur'));
  await B.type('#name-input', 'Bruno');
  await B.click('#avatar-row .avatar-pick:nth-child(3)');

  // C : un profil dont la photo passe toutes les validations mais ne se décode pas.
  await C.goto(URL('passeur'));
  await C.eval(`localStorage.setItem('mathys_game_profile', ${JSON.stringify(JSON.stringify({
    v: 1, id: 'p_chloe', name: 'Chloé', avatar: { kind: 'image', emoji: '🤖', src: webpIllisible() } }))})`);
  await C.goto(URL('passeur'));
  const pc = await C.eval(`GameProfile.load()`);
  t('profil C : la photo illisible est bien acceptée par le profil (elle ne l\'est qu\'au décodage)', pc.avatar.kind === 'image');
  return { A: { name: 'Alice', src: pa.avatar.src }, B: { name: 'Bruno' }, C: { name: 'Chloé' } };
}

// Tout le monde rejoint la room de A. Renvoie l'emoji effectivement choisi par
// chaque jeu (il dépend de la liste d'icônes du jeu).
async function salon(g, P, joueurs) {
  const [A, ...autres] = joueurs;
  for (const J of joueurs) { J.recus.length = 0; J.envoyes.length = 0; await J.goto(URL(g)); }
  const emoji = async (J) => (await J.eval(`document.querySelector('.avatar-pick.picked').textContent.trim()`));
  // Le Ban demande un consentement (avertissement) avant de créer/rejoindre.
  for (const J of joueurs) {
    if (await J.eval(`!!document.getElementById('tw-check') && !document.getElementById('tw-check').checked`)) await J.click('#tw-check');
  }
  P.B.emoji = await emoji(joueurs[1]);
  if (joueurs[2]) P.C.emoji = await emoji(joueurs[2]);
  await A.click('#host');
  const code = await A.until(`(() => { const c = document.getElementById('room-code').textContent.trim(); return /^[A-Z0-9]{4}$/.test(c) && c; })()`, 12000, 'code de salle');
  for (const J of autres) { await J.type('#code-input', code); await J.click('#join'); }
  await A.until(`document.querySelectorAll('#players .g-av').length === ${joueurs.length}`, 8000, 'salon complet');
  for (const J of autres) await J.until(`document.querySelectorAll('#players .g-av').length === ${joueurs.length}`, 8000, 'salon complet');

  // Le join lui-même : A a bien ENVOYÉ sa photo, B son emoji.
  const join = (J) => J.envoyes.map((s) => { try { return JSON.parse(s); } catch (_) { return {}; } }).find((m) => m.action === 'join');
  const ja = join(A), jb = join(joueurs[1]);
  t(`${g} — join de A : l'avatar complet part (kind image + src + emoji)`,
    !!ja && ja.avatar.kind === 'image' && ja.avatar.src === P.A.src && !!ja.avatar.emoji);
  t(`${g} — join de B : kind emoji, sans src`, !!jb && jb.avatar.kind === 'emoji' && !('src' in jb.avatar) && jb.avatar.emoji === P.B.emoji);

  // Les ids, lus dans les trames (le serveur les attribue).
  const ids = {};
  for (const J of joueurs) {
    const m = J.msgs().find((x) => x.type === 'you' || (x.type === 'room' && x.you));
    ids[J.nom] = m.type === 'you' ? m.id : m.you;
  }
  // Ce que B a REÇU pour A, et A pour B.
  const recuParB = avatarsRecus(joueurs[1], ids.A);
  t(`${g} — trames : B reçoit la PP de A, à l'octet près`,
    recuParB.length > 0 && recuParB.every((a) => a && a.kind === 'image' && a.src === P.A.src),
    `${recuParB.length} occurrence(s)`);
  const recuParA = avatarsRecus(A, ids.B);
  t(`${g} — trames : A reçoit l'emoji de B`,
    recuParA.length > 0 && recuParA.every((a) => a && a.kind === 'emoji' && a.emoji === P.B.emoji && !a.src));

  await verifie(A, `${g} / salon`, '#players', P, joueurs.length > 2 ? ['A', 'B', 'C'] : ['A', 'B']);
  await verifie(joueurs[1], `${g} / salon`, '#players', P, ['A']);
  return { code, ids };
}

// ------------------------------------------------------------- les parties
const JEUX = {
  // Qui Ment ? d'abord : c'est là que le problème a été vu à la main.
  async quiment(P, [A, B, C]) {
    const { ids } = await salon('quiment', P, [A, B, C]);
    await A.eval(`document.getElementById('rounds-select').value = '3'`);
    await A.click('#start');
    for (const J of [A, B, C]) await J.until(`!document.getElementById('play').hidden`, 8000, 'écran de jeu');
    await verifie(B, 'quiment / en jeu (qui a joué)', '#play-players', P, ['A', 'B', 'C']);
    // Deux tours d'indices, tapés et envoyés pour de vrai.
    for (const tour of [1, 2]) {
      for (const [J, mot] of [[A, 'rouge'], [B, 'rond'], [C, 'sucré']]) {
        await J.until(`!document.getElementById('clue-input').disabled`, 8000, 'saisie ouverte');
        await J.type('#clue-input', mot + tour);
        await J.click('#clue-send');
      }
      if (tour === 1) {
        await B.until(`document.querySelectorAll('#clue-history .clue-row').length === 3`, 8000, 'indices révélés');
        await verifie(B, 'quiment / indices révélés', '#clue-history', P, ['A', 'B', 'C']);
      }
    }
    for (const J of [A, B, C]) await J.until(`!document.getElementById('vote').hidden`, 8000, 'écran de vote');
    await verifie(B, 'quiment / boutons de vote', '#vote-grid', P, ['A', 'C']);
    await verifie(C, 'quiment / boutons de vote', '#vote-grid', P, ['A', 'B']);
    await verifie(A, 'quiment / historique au vote', '#vote-history', P, ['A', 'B', 'C']);
    // Votes par vrais clics : tout le monde vote contre A (B et C), A contre B.
    const voteContre = async (J, nom) => {
      const i = await J.eval(`[...document.querySelectorAll('#vote-grid button')].findIndex((b) => b.textContent.includes(${JSON.stringify(nom)}))`);
      await J.click(`#vote-grid button:nth-child(${i + 1})`);
    };
    await voteContre(A, P.B.name); await voteContre(B, P.A.name); await voteContre(C, P.A.name);
    // Démasqué : l'intrus a sa dernière chance ; le MJ la passe.
    await sleep(400);
    if (!(await A.visible('#results'))) {
      await A.until(`!document.getElementById('guess').hidden`, 8000, 'dernière chance');
      if (await A.visible('#skip-guess')) await A.click('#skip-guess');
      else { await A.click('#word-grid button'); }
    }
    for (const J of [A, B, C]) await J.until(`!document.getElementById('results').hidden`, 8000, 'résultats');
    await verifie(B, 'quiment / résultats', '#res-rows', P, ['A', 'B', 'C']);
    const intrus = B.msgs().filter((m) => m.type === 'results').pop().impostorId;
    const nomIntrus = Object.entries(ids).find(([, id]) => id === intrus)[0];
    await verifie(B, 'quiment / verdict (l\'intrus)', '#res-verdict', P, [nomIntrus]);
    // Manches 2 et 3 au pas de course, puis le classement.
    for (let i = 0; i < 2; i++) {
      await A.click('#next');
      await A.until(`!document.getElementById('play').hidden`, 8000, 'manche suivante');
      await A.click('#skip-clue'); await sleep(250);
      await A.until(`!document.getElementById('play').hidden && !document.getElementById('skip-clue').hidden`, 8000, 'tour 2');
      await A.click('#skip-clue');
      await A.until(`!document.getElementById('vote').hidden`, 8000, 'vote');
      await A.click('#skip-vote');
      await A.until(`!document.getElementById('results').hidden`, 8000, 'résultats');
    }
    await A.click('#next');
    for (const J of [A, B, C]) await J.until(`!document.getElementById('end').hidden`, 8000, 'classement');
    await verifie(B, 'quiment / classement final', '#ranking', P, ['A', 'B', 'C']);
    await verifie(C, 'quiment / classement final', '#ranking', P, ['A', 'B', 'C']);
  },

  async passeur(P, [A, B, C]) {
    await salon('passeur', P, [A, B, C]);
    await C.leave();                         // C s'en va : la partie se joue à deux
    await A.until(`document.querySelectorAll('#players .g-av').length === 2`, 8000, 'départ de C');
    await A.eval(`document.getElementById('rounds-select').value = '3'`);
    await A.click('#start');
    for (let manche = 0; manche < 3; manche++) {
      for (const J of [A, B]) {
        await J.until(`!document.getElementById('go-banner').hidden`, 10000, '« à toi »');
        // Une zone jouable, cliquée pour de vrai à ses coordonnées.
        for (let essai = 0; essai < 5; essai++) {
          const n = await J.eval(`[...document.querySelectorAll('#court g.zone[data-pass]')].findIndex((z) => !z.classList.contains('is-illegal'))`);
          await J.click(`#court g.zone[data-pass]:nth-child(${n + 1})`);
          if (await J.eval(`document.getElementById('go-banner').hidden || !!document.querySelector('#court g.zone[aria-pressed="true"]')`)) break;
          await sleep(150);
        }
      }
      for (const J of [A, B]) await J.until(`!document.getElementById('results').hidden`, 10000, 'résultats de manche');
      if (manche === 0) {
        await verifie(B, 'passeur / résultats de manche', '#res-rows', P, ['A', 'B']);
        await verifie(A, 'passeur / résultats de manche', '#res-rows', P, ['A', 'B']);
      }
      await A.click('#next');
    }
    for (const J of [A, B]) await J.until(`!document.getElementById('end').hidden`, 8000, 'classement');
    await verifie(B, 'passeur / classement final', '#ranking', P, ['A', 'B']);
  },

  async demicercle(P, [A, B, C]) {
    await salon('demicercle', P, [A, B, C]);
    await C.leave();
    await A.until(`document.querySelectorAll('#players .g-av').length === 2`, 8000, 'départ de C');
    await A.eval(`document.getElementById('rounds-select').value = '2'`);
    await A.click('#start');
    await A.until(`!document.getElementById('scores-live').closest('[hidden]') && document.querySelectorAll('#scores-live .g-av').length === 2`, 8000, 'écran de jeu');
    await verifie(B, 'demicercle / tableau des scores en jeu', '#scores-live', P, ['A', 'B']);
    // Manche 1 : A est le Guide. Manche 2 : B est le Guide, A devine — et B
    // voit l'aiguille live de A, avec sa photo au bout, dans le cadran SVG.
    for (const [guide, devin] of [[A, B], [B, A]]) {
      // Le MJ fait avancer (résultats → manche suivante → indice) jusqu'à ce
      // que le Guide ait la main.
      for (let i = 0; i < 4 && !(await guide.visible('#clue-input')); i++) {
        await A.until(`!document.getElementById('next-btn').hidden`, 8000, 'bouton du MJ');
        await A.click('#next-btn');
        await sleep(300);
      }
      await guide.until(`!document.getElementById('clue-row').hidden`, 8000, 'saisie de l\'indice');
      await guide.type('#clue-input', 'tiède');
      await guide.click('#clue-send');
      await devin.until(`phase === 'guessing'`, 8000, 'phase de vote');
      await devin.click('#dial');
      if (guide === B) {
        await B.until(`!!document.querySelector('#dial-needles image')`, 6000, 'aiguille live');
        const aiguille = await B.eval(`(() => { const i = document.querySelector('#dial-needles image'); return { href: i.getAttribute('href'), w: +i.getAttribute('width') }; })()`);
        t('demicercle / cadran (aiguille live chez le Guide) — PP de A en <image> SVG', aiguille.href === P.A.src && aiguille.w <= 96);
        await verifie(B, 'demicercle / légende du Guide', '#dial-legend', P, ['A']);
      }
      await devin.until(`!document.getElementById('guess-send').hidden`, 6000, 'bouton valider');
      await devin.click('#guess-send');
      await A.until(`!document.getElementById('scores').hidden`, 8000, 'résultats');
      if (guide === B) {
        await verifie(B, 'demicercle / résultats (aiguilles)', '#scores', P, ['A']);
        const bout = await B.eval(`(() => { const i = document.querySelector('#dial-needles image'); return i && i.getAttribute('href'); })()`);
        t('demicercle / cadran des résultats — PP de A au bout de son aiguille', bout === P.A.src);
      }
    }
    await A.click('#next-btn');
    await B.until(`/podium/.test(document.getElementById('stage-sub').textContent)`, 8000, 'podium');
    // Juste après `end`, le serveur renvoie `room` (phase lobby). Le client
    // avait fait show('lobby') sans garde, et le podium disparaissait aussitôt.
    // Corrigé depuis (`inEndScreen` dans app.js), et c'est
    // tests/handoff-demicercle.mjs qui vérifie qu'il RESTE à l'écran. Ici on
    // vérifie son CONTENU (l'image y est, décodée).
    await verifie(B, 'demicercle / podium (contenu)', '#scores', P, ['A', 'B']);
  },

  async ban(P, [A, B, C]) {
    await salon('ban', P, [A, B, C]);
    await C.leave();
    await A.until(`document.querySelectorAll('#players .g-av').length === 2`, 8000, 'départ de C');
    await A.click('#start');
    // Le MJ enchaîne : découverte → passages (passés) → résultats → fin.
    for (let i = 0; i < 12; i++) {
      if (await B.eval(`/Fin de partie/.test(document.getElementById('turn-title').textContent)`)) break;
      if (await A.visible('#host-skip')) await A.click('#host-skip');
      else if (await A.visible('#host-next')) await A.click('#host-next');
      await sleep(350);
    }
    await B.until(`/Fin de partie/.test(document.getElementById('turn-title').textContent)`, 8000, 'fin de partie');
    await verifie(B, 'ban / podium', '#scores', P, ['A', 'B']);
    await verifie(A, 'ban / podium', '#scores', P, ['A', 'B']);
  },

  async precision(P, [A, B, C]) {
    await salon('precision', P, [A, B, C]);
    await C.leave();
    await A.until(`document.querySelectorAll('#players .g-av').length === 2`, 8000, 'départ de C');
    await A.eval(`document.getElementById('diff-select').value = 'facile';
      document.getElementById('rounds-select').value = '3';   // le minimum proposé
      document.getElementById('game-select').value = 'color';`);
    await A.click('#start');
    for (let manche = 0; manche < 3; manche++) {
      // Tout le monde joue en même temps : chacun valide par le vrai bouton.
      for (const J of [A, B]) {
        await J.until(`document.getElementById('fab').dataset.mode === 'submit'`, 15000, 'phase de jeu');
        await J.click('#fab');
      }
      await A.until(`document.getElementById('fab').dataset.mode === 'next'`, 12000, 'révélation');
      if (manche === 0) {
        await B.until(`document.querySelectorAll('#rv-list .g-av').length === 2`, 6000, 'révélation');
        await verifie(B, 'precision / révélation (classement de la manche)', '#rv-list', P, ['A', 'B']);
        await verifie(A, 'precision / scores de la manche', '#scores', P, ['A', 'B']);
        // Les deux listes partagent leurs colonnes : même centre d'avatar, même
        // départ de pseudo, quelle que soit la taille de l'avatar (48 vs 32).
        const col = await B.eval(ALIGNEMENT(['#rv-list .rv-row', '#scores li'], '.rv-name, .g-player-name'));
        t(`precision / révélation — avatars et pseudos alignés sur les mêmes colonnes`, col.ok, JSON.stringify(col));
        // Deux sections, deux sens : % = précision de CE tir, entier = score CUMULÉ.
        const sec = await B.eval(`(() => {
          const vis = (id) => { const e = document.getElementById(id); return !!e && !e.hidden && e.getClientRects().length > 0; };
          const cs = (id) => getComputedStyle(document.getElementById(id));
          const y = (sel) => document.querySelector(sel).getBoundingClientRect().top;
          return {
            round: vis('rv-head-round') && /manche/i.test(document.getElementById('rv-head-round').textContent),
            total: vis('rv-head-total') && /global/i.test(document.getElementById('rv-head-total').textContent),
            capRound: /%/.test(document.getElementById('rv-cap-round').textContent),
            capTotal: /cumul/i.test(document.getElementById('rv-cap-total').textContent),
            couleurs: cs('rv-head-round').color !== cs('rv-head-total').color,
            fondTotal: getComputedStyle(document.getElementById('scores')).backgroundColor !== 'rgba(0, 0, 0, 0)',
            ordre: y('#rv-head-round') < y('#rv-list') && y('#rv-list') < y('#rv-head-total') && y('#rv-head-total') < y('#scores'),
            pct: [...document.querySelectorAll('#rv-list .ra')].every((e) => /%$/.test(e.textContent.trim())),
            pts: [...document.querySelectorAll('#scores .pts')].every((e) => /^\\d+\\s*pts$/.test(e.textContent.trim())),
          };
        })()`);
        t('precision / révélation — section « Résultat de la manche » présente, légende en %', sec.round && sec.capRound && sec.pct, JSON.stringify(sec));
        t('precision / révélation — section « Score global » présente, légende « cumulés », valeurs en pts', sec.total && sec.capTotal && sec.pts);
        t('precision / révélation — les deux sections se distinguent (couleur de titre, fond du score global, ordre vertical)',
          sec.couleurs && sec.fondTotal && sec.ordre);
      }
      await A.click('#fab');
    }
    await B.until(`/Podium/.test(document.getElementById('rv-compare').textContent)`, 8000, 'podium');
    await verifie(B, 'precision / podium', '#scores', P, ['A', 'B']);
    const colP = await B.eval(ALIGNEMENT(['#scores li'], '.g-player-name'));
    t(`precision / podium — avatars et pseudos alignés sur les mêmes colonnes`, colP.ok, JSON.stringify(colP));
    t('precision / podium — les intitulés de manche / score global sont masqués (le podium a son titre)',
      await B.eval(`['rv-head-round', 'rv-head-total'].every((id) => document.getElementById(id).hidden)`));
  },

  async imitation(P, [A, B, C]) {
    await salon('imitation', P, [A, B, C]);
    await C.leave();
    await A.until(`document.querySelectorAll('#players .g-av').length === 2`, 8000, 'départ de C');
    await A.eval(`document.getElementById('rounds-select').value = '1'`);
    await A.click('#start');
    await B.until(`document.querySelectorAll('#scores-live .g-av').length === 2`, 8000, 'scores en jeu');
    await verifie(B, 'imitation / tableau des scores en jeu', '#scores-live', P, ['A', 'B']);
    // Visionnage → enregistrement : A enregistre une vraie prise (micro factice).
    await A.until(`!document.getElementById('next-btn').hidden`, 8000, 'bouton du MJ');
    await A.click('#next-btn');
    await A.until(`!document.getElementById('rec-box').hidden`, 8000, 'enregistrement');
    await A.click('#rec-btn');
    await sleep(1200);
    await A.click('#rec-btn');
    await A.until(`/envoyée/.test(document.getElementById('rec-status').textContent)`, 8000, 'prise envoyée');
    await A.click('#next-btn');
    // Écoute : B entend la prise de A, présentée avec sa photo.
    await B.until(`!document.getElementById('listen-box').hidden && !!document.querySelector('#listen-name .g-av')`, 10000, 'écoute');
    await verifie(B, 'imitation / écoute d\'une prise', '#listen-name', P, ['A']);
    await B.click('.rate');
    await A.click('#next-btn');
    await B.until(`!document.getElementById('scores').hidden && document.querySelectorAll('#scores .g-av').length === 2`, 10000, 'résultats');
    await verifie(B, 'imitation / résultats du round', '#scores', P, ['A', 'B']);
    await A.until(`!document.getElementById('next-btn').hidden`, 6000, 'bouton du MJ');
    await A.click('#next-btn');
    await B.until(`!document.getElementById('back-lobby').hidden`, 8000, 'podium');
    await verifie(B, 'imitation / podium', '#scores', P, ['A', 'B']);
  },
};

// ------------------------------------------------ serveur pas encore redéployé
// LE cas qui est passé à travers les premiers tests (vu à la main le
// 2026-09-19) : front neuf, serveur d'AVANT la migration. L'ancien serveur fait
// `String(avatar).slice(0, 4)` sur l'objet reçu et renvoie « [obj » à tout le
// monde. Le front doit afficher un emoji, jamais cette chaîne. On lance donc la
// version du serveur qui précède l'arrivée de avatar.js, extraite de git.
async function lanceAncien(g) {
  const s = SERVEURS[g];
  const repo = path.join(PERSO, s.repo);
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { maxBuffer: 64 * 1024 * 1024 });
  const intro = git('log', '--diff-filter=A', '--format=%H', '--', 'avatar.js', 'src/avatar.js').toString().trim().split('\n').pop();
  if (!intro) throw new Error(`${s.repo} : commit d'introduction de avatar.js introuvable`);
  const rev = intro + '^';
  const dst = mkdtempSync(path.join(tmpdir(), `ancien-${g}-`));
  for (const f of git('ls-tree', '-r', '--name-only', rev).toString().trim().split('\n')) {
    fs.mkdirSync(path.dirname(path.join(dst, f)), { recursive: true });
    fs.writeFileSync(path.join(dst, f), git('show', `${rev}:${f}`));
  }
  fs.cpSync(path.join(repo, 'node_modules'), path.join(dst, 'node_modules'), { recursive: true });
  const port = 8600 + R();
  const p = spawn(process.execPath, [s.main], { cwd: dst, env: { ...process.env, ...s.env, PORT: String(port) }, stdio: 'ignore' });
  procs.push(p);
  for (let i = 0; i < 80; i++) { try { await fetch(`http://127.0.0.1:${port}/`); return { port, rev: 'avant ' + intro.slice(0, 7), dst, p }; } catch (_) { await sleep(100); } }
  throw new Error(`${s.repo} (ancien) ne démarre pas`);
}

async function contreAncien(g, P, [A, B]) {
  const vieux = await lanceAncien(g);
  const url = `http://127.0.0.1:${HTTP_PORT}/games/${g}/index.html?server=ws://127.0.0.1:${vieux.port}`
    + `&cdn=http://127.0.0.1:${HTTP_PORT}/__pas_de_video`;
  try {
    for (const J of [A, B]) {
      J.recus.length = 0; await J.goto(url);
      if (await J.eval(`!!document.getElementById('tw-check') && !document.getElementById('tw-check').checked`)) await J.click('#tw-check');
    }
    await A.click('#host');
    const code = await A.until(`(() => { const c = document.getElementById('room-code').textContent.trim(); return /^[A-Z0-9]{4}$/.test(c) && c; })()`, 12000, 'code de salle');
    await B.type('#code-input', code); await B.click('#join');
    for (const J of [A, B]) await J.until(`document.querySelectorAll('#players .g-av').length === 2`, 8000, 'salon complet');
    // Ce que l'ancien serveur a vraiment renvoyé : la preuve que le cas est reproduit.
    const brut = B.msgs().filter((m) => m.players).pop().players.map((p) => p.avatar);
    t(`${g} (serveur ${vieux.rev}, non redéployé) — l'ancien serveur renvoie bien « [obj »`, brut.includes('[obj'), JSON.stringify(brut));
    for (const J of [A, B]) {
      const vu = await J.eval(`({
        texte: document.body.innerText,
        lignes: [...document.querySelectorAll('#players .g-av')].map((a) => ({ img: !!a.querySelector('img'), t: a.textContent })),
      })`);
      t(`${g} (serveur non redéployé) — aucun « [obj » à l'écran (vu par ${J.nom})`, !/\[obj/.test(vu.texte));
      t(`${g} (serveur non redéployé) — chaque joueur a un emoji de repli (vu par ${J.nom})`,
        vu.lignes.length === 2 && vu.lignes.every((l) => !l.img && /\p{Extended_Pictographic}/u.test(l.t)), JSON.stringify(vu.lignes));
    }
  } finally {
    await A.leave(); await B.leave();
    try { vieux.p.kill(); } catch (_) {}
    try { rmSync(vieux.dst, { recursive: true, force: true }); } catch (_) {}
  }
}

// Les cas limites du rendu, dans une vraie page (pas un mock : le vrai
// game-avatar.js, le vrai navigateur, le vrai décodeur d'images).
async function replis(J, P) {
  await J.goto(URL('quiment'));
  const r = await J.eval(`(async () => {
    const out = {};
    const attendre = () => new Promise((ok) => setTimeout(ok, 300));
    const vide = document.createElement('div'); document.body.appendChild(vide);
    // D. avatar absent → emoji par défaut du jeu
    vide.replaceChildren(GameAvatar.node(undefined, '🕵️'));
    out.absent = vide.textContent;
    // E. ancien serveur : une chaîne
    vide.replaceChildren(GameAvatar.node('🦊'));
    out.ancien = vide.textContent;
    // E bis. ancien serveur qui a tronqué l'objet : « [obj » n'est pas un emoji
    vide.replaceChildren(GameAvatar.node('[obj', '🕵️'));
    out.tronque = vide.textContent;
    vide.replaceChildren(GameAvatar.node({ kind: 'emoji', emoji: '[obj' }, '🕵️'));
    out.tronqueObjet = vide.textContent;
    // src qui n'est pas une data-URL d'image → jamais dans un <img>
    vide.replaceChildren(GameAvatar.node({ kind: 'image', emoji: '🐼', src: 'javascript:alert(1)' }));
    out.javascript = { img: !!vide.querySelector('img'), texte: vide.textContent };
    vide.replaceChildren(GameAvatar.node({ kind: 'image', emoji: '🐼', src: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' }));
    out.svg = { img: !!vide.querySelector('img'), texte: vide.textContent };
    // Une photo qui passe la forme mais pas le décodeur → l'emoji, sur place.
    vide.replaceChildren(GameAvatar.node({ kind: 'image', emoji: '🐼', src: ${JSON.stringify(webpIllisible())} }));
    out.avant = !!vide.querySelector('img');
    await attendre();
    out.apres = { img: !!vide.querySelector('img'), texte: vide.textContent };
    // Un nom piégé ne devient pas du HTML (on passe par textContent).
    vide.replaceChildren(GameAvatar.node({ kind: 'emoji', emoji: '<img src=x onerror=alert(1)>' }));
    out.piege = { img: !!vide.querySelector('img'), texte: vide.textContent };
    // Une vraie PP, décodée : taille d'affichage vs source.
    vide.replaceChildren(GameAvatar.node({ kind: 'image', emoji: '🐼', src: ${JSON.stringify(P.A.src)} }));
    await attendre();
    const im = vide.querySelector('img');
    out.vraie = { decodee: im.complete && im.naturalWidth === 96, largeur: im.getBoundingClientRect().width };
    vide.remove();
    return out;
  })()`);
  t('repli D : avatar absent → emoji par défaut', r.absent === '🕵️', r.absent);
  t('repli E : ancien format (chaîne) → emoji', r.ancien === '🦊');
  t('repli E : « [obj » d\'un serveur non redéployé → emoji par défaut, jamais le texte',
    r.tronque === '🕵️' && r.tronqueObjet === '🕵️', `${r.tronque} / ${r.tronqueObjet}`);
  t('src javascript: → aucune <img>, emoji', !r.javascript.img && r.javascript.texte === '🐼');
  t('src SVG → aucune <img>, emoji', !r.svg.img && r.svg.texte === '🐼');
  t('repli C : photo indécodable → <img> retirée, emoji à la place', r.avant === true && !r.apres.img && r.apres.texte === '🐼');
  t('emoji piégé : rendu en texte, jamais en HTML', !r.piege.img);
  t(`une vraie PP : décodée en 96×96, affichée en ${Math.round(r.vraie.largeur)}px (jamais agrandie)`, r.vraie.decodee && r.vraie.largeur > 0 && r.vraie.largeur <= 96);
}

// --------------------------------------------------------------- orchestration
const srv = await serve();
const dir = mkdtempSync(path.join(tmpdir(), 'avatar-'));
let edge = null, cdp = null;
const stop = () => {
  // ⚠️ edge.kill() ne tue que le parent (voir tests/README.md).
  if (edge) { try { execFileSync('taskkill', ['/PID', String(edge.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (_) { try { edge.kill(); } catch (__) {} } }
  procs.forEach((p) => { try { p.kill(); } catch (_) {} });
  try { cdp && cdp.close(); } catch (_) {}
  try { srv.close(); } catch (_) {}
  try { rmSync(dir, { recursive: true, force: true }); } catch (_) {}
};

console.log('Photo de profil — parties réelles dans les six jeux\n');
try {
  await lanceServeurs();
  edge = spawn(EDGE, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${dir}`, '--no-first-run', '--window-size=1100,1000',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    // ⚠️ Sans ça, quitter une page de jeu la met en cache « précédent/suivant »
    // avec son WebSocket encore ouvert : le serveur ne voit jamais partir le
    // joueur, et le salon attend un fantôme.
    '--disable-features=BackForwardCache', 'about:blank'], { stdio: 'ignore' });
  cdp = await cdpBrowser();
  const A = await joueur(cdp, 'A'), B = await joueur(cdp, 'B'), C = await joueur(cdp, 'C');
  const P = await profils(A, B, C);

  const ordre = ['quiment', 'passeur', 'demicercle', 'ban', 'precision', 'imitation'].filter((g) => !ONLY || g === ONLY);
  for (const g of ordre) {
    console.log(`\n— ${g} —`);
    try { await JEUX[g](P, [A, B, C]); }
    catch (e) { t(`${g} : la partie est allée au bout`, false, e.message); }
  }

  console.log('\n— serveurs non redéployés (front neuf, serveur d\'avant) —');
  for (const g of ordre) {
    try { await contreAncien(g, P, [A, B]); }
    catch (e) { t(`${g} (serveur non redéployé) : le salon s'ouvre`, false, e.message); }
  }

  console.log('\n— replis —');
  await replis(B, P);

  // Le repli d'affichage ne réécrit jamais le choix du joueur.
  await C.goto(URL('quiment'));
  const pc = await C.eval(`GameProfile.load()`);
  t('le repli n\'a pas réécrit le profil de C (toujours kind=image)', pc.avatar.kind === 'image' && !!pc.avatar.src);
  await A.goto(URL('quiment'));
  const pa = await A.eval(`GameProfile.load()`);
  t('le profil de A est intact après six parties', pa.avatar.kind === 'image' && pa.avatar.src === P.A.src);

  // Poids : la plus grosse trame reçue, pour garder un œil dessus.
  const max = Math.max(...[A, B, C].flatMap((J) => J.recus.map((s) => s.length)), 0);
  t(`plus grosse trame reçue : ${max} octets (une PP ≈ ${P.A.src.length} o de data-URL)`, max < 64 * 1024);

  const errs = [A, B, C].flatMap((J) => J.erreurs.map((e) => `[${J.nom}] ${e}`));
  t('aucune erreur JS dans les pages', errs.length === 0, errs.slice(0, 3).join(' | '));
} catch (e) {
  t('EXCEPTION', false, e.message);
} finally {
  stop();
}

console.log(`\n${ko ? 'DES TESTS ÉCHOUENT' : 'TOUT PASSE'} — ${out.length} vérifications, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
