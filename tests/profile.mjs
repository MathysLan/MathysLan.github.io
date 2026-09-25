// Profil local : tests unitaires + intégration sur les vraies pages de jeux.
//
//   node tests/profile.mjs
//   node tests/profile.mjs --edge "C:\chemin\vers\msedge.exe"
//
// ⚠️ POURQUOI UN SERVEUR HTTP ET PAS file:// : Chromium refuse localStorage sur
// un document file://, et surtout chaque fichier local est sa propre origine.
// Or c'est précisément le PARTAGE du profil entre deux pages de jeux qu'on veut
// prouver. En file:// tous les tests passeraient sans rien démontrer.
//
// Aucune dépendance : serveur http natif, client CDP sur le WebSocket de Node.
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const EDGE = arg('--edge') || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
// Ports tirés au hasard : deux exécutions qui se chevauchent ne doivent pas se
// parler sans le savoir (le piège des msedge fantômes, voir tests/README.md).
const HTTP_PORT = 8300 + Math.floor(Math.random() * 400);
const CDP_PORT = 9400 + Math.floor(Math.random() * 400);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let out = [], ko = 0;
const t = (nom, ok, detail = '') => {
  out.push(`${ok ? 'OK  ' : 'KO  '} ${nom}${detail ? ' — ' + detail : ''}`);
  if (!ok) ko++;
};

// --- serveur statique -------------------------------------------------------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon' };

function serve() {
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const full = path.join(ROOT, p);
    if (!full.startsWith(ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
      res.writeHead(404); return res.end('nope');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
    res.end(fs.readFileSync(full));
  });
  return new Promise((r) => srv.listen(HTTP_PORT, '127.0.0.1', () => r(srv)));
}

// --- client CDP -------------------------------------------------------------
async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('CDP injoignable')); });
  let id = 0; const waiting = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
  };
  return { ws, send(method, params = {}) {
    const mid = ++id; ws.send(JSON.stringify({ id: mid, method, params }));
    return new Promise((res) => waiting.set(mid, res));
  } };
}

async function evaluate(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'erreur JS');
  return r.result?.result?.value;
}

const URLS = (g) => `http://127.0.0.1:${HTTP_PORT}/games/${g}/index.html`;

async function go(cdp, url) {
  await cdp.send('Page.navigate', { url });
  await sleep(900);
}

// Un vrai clic, aux coordonnées réelles de l'élément.
async function click(cdp, sel) {
  const box = await evaluate(cdp, `(() => {
    const e = document.querySelector(${JSON.stringify(sel)});
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!box) return false;
  for (const type of ['mousePressed', 'mouseReleased']) {
    await cdp.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
  }
  await sleep(120);
  return true;
}

async function type(cdp, sel, text) {
  await click(cdp, sel);
  await evaluate(cdp, `document.querySelector(${JSON.stringify(sel)}).select()`);
  await cdp.send('Input.insertText', { text });
  await sleep(80);
}

const PROFIL = `(() => { try { return JSON.parse(localStorage.getItem('mathys_game_profile')); }
  catch (e) { return null; } })()`;

// --- la campagne ------------------------------------------------------------
async function run(cdp, errs) {
  // ═══ 1. les tests unitaires du module, dans la page dédiée
  await go(cdp, `http://127.0.0.1:${HTTP_PORT}/tests/profile.html`);
  for (let i = 0; i < 40 && await evaluate(cdp, 'document.title') !== 'FINI'; i++) await sleep(250);
  const u = await evaluate(cdp, 'window.__RESULT');
  if (!u) t('tests unitaires du module', false, 'la page n\'a pas fini');
  else {
    u.lines.filter((l) => l.startsWith('KO')).forEach((l) => out.push('     ' + l));
    t(`tests unitaires du module (${u.total} vérifications)`, u.ko === 0, `${u.ko} échec(s)`);
  }

  // ═══ 2. première visite : rien de préremplí, mais un avatar choisi
  await evaluate(cdp, "localStorage.clear()");
  await go(cdp, URLS('imitation'));
  const vierge = await evaluate(cdp, `({
    nom: document.getElementById('name-input').value,
    picked: document.querySelectorAll('.avatar-pick.picked').length,
    photo: !!document.querySelector('.gp-photo'),
  })`);
  t('première visite : le champ pseudo est vide', vierge.nom === '', `« ${vierge.nom} »`);
  t('première visite : une icône est déjà sélectionnée', vierge.picked === 1);
  t('le choix de photo est proposé', vierge.photo === true);

  // ═══ 3. on renseigne son identité, avec de vraies entrées
  await type(cdp, '#name-input', 'Mathys');
  await click(cdp, '#avatar-row .avatar-pick:nth-child(5)');   // le 5e emoji
  const choisi = await evaluate(cdp,
    `document.querySelector('.avatar-pick.picked').textContent.trim()`);
  const p1 = await evaluate(cdp, PROFIL);
  t('le pseudo est enregistré au clic sur un avatar', p1 && p1.name === 'Mathys', p1 && p1.name);
  t('l\'emoji cliqué est enregistré', p1 && p1.avatar.emoji === choisi, `${p1 && p1.avatar.emoji} / ${choisi}`);
  t('le profil est en version 1', p1 && p1.v === 1);

  // ═══ 4. rechargement : tout est là
  await go(cdp, URLS('imitation'));
  const apres = await evaluate(cdp, `({
    nom: document.getElementById('name-input').value,
    emoji: (document.querySelector('.avatar-pick.picked') || {}).textContent,
  })`);
  t('après rechargement : le pseudo est prérempli', apres.nom === 'Mathys', apres.nom);
  t('après rechargement : la même icône est sélectionnée',
    (apres.emoji || '').trim() === choisi, `${apres.emoji} / ${choisi}`);

  // ═══ 5. un AUTRE jeu : la même identité (le cœur de la phase)
  await go(cdp, URLS('passeur'));
  const autre = await evaluate(cdp, `({
    nom: document.getElementById('name-input').value,
    emoji: (document.querySelector('.avatar-pick.picked') || {}).textContent,
    dansListe: [...document.querySelectorAll('.avatar-pick')].map((b) => b.textContent.trim()),
  })`);
  t('autre jeu : le pseudo suit', autre.nom === 'Mathys', autre.nom);
  t('autre jeu : une icône est bien sélectionnée',
    !!autre.emoji && autre.dansListe.includes(autre.emoji.trim()),
    `${autre.emoji} parmi ${autre.dansListe.length}`);
  // Si ce jeu propose le même emoji, il DOIT être conservé à l'identique.
  if (autre.dansListe.includes(choisi)) {
    t('autre jeu : l\'icône du profil est reprise telle quelle',
      autre.emoji.trim() === choisi, `${autre.emoji} / ${choisi}`);
  } else {
    t('autre jeu : icône absente de sa liste → repli, sans écraser le profil',
      (await evaluate(cdp, PROFIL)).avatar.emoji === choisi);
  }

  // ═══ 6. on change le pseudo depuis ce jeu-là
  await type(cdp, '#name-input', 'Zoé');
  await click(cdp, '#avatar-row .avatar-pick:nth-child(2)');
  const p2 = await evaluate(cdp, PROFIL);
  t('le pseudo modifié est enregistré', p2.name === 'Zoé', p2.name);
  await go(cdp, URLS('quiment'));
  t('le nouveau pseudo suit encore ailleurs',
    await evaluate(cdp, `document.getElementById('name-input').value`) === 'Zoé');

  // ═══ 7. la photo : ajout, repli emoji, retrait
  const POSE_IMAGE = `(async () => {
    const c = document.createElement('canvas'); c.width = 400; c.height = 300;
    const g = c.getContext('2d'); g.fillStyle = '#c33'; g.fillRect(0, 0, 400, 300);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const r = await GameProfile.setImage(new File([blob], 'p.png', { type: 'image/png' }));
    return r.ok;
  })()`;
  t('une photo peut être posée', await evaluate(cdp, POSE_IMAGE) === true);
  const p3 = await evaluate(cdp, PROFIL);
  t('la photo est stockée en data-URL', !!p3.avatar.src && p3.avatar.src.startsWith('data:image/'));
  t('l\'emoji reste le repli, à côté de la photo',
    p3.avatar.kind === 'image' && !!p3.avatar.emoji, p3.avatar.emoji);

  // La photo part en jeu (joinAvatar, vérifié en partie réelle par
  // tests/avatar-play.mjs) ; l'icône du jeu reste sélectionnée : c'est le repli.
  await go(cdp, URLS('quiment'));
  const enJeu = await evaluate(cdp, `({
    apercu: !!document.querySelector('.gp-preview:not([hidden])'),
    picked: (document.querySelector('.avatar-pick.picked') || {}).textContent,
  })`);
  t('la photo est visible dans le choix d\'identité', enJeu.apercu === true);
  t('et le jeu sélectionne toujours une icône (le repli)', !!enJeu.picked, enJeu.picked);

  await click(cdp, '.gp-photo .gp-btn:nth-of-type(2)');   // « retirer »
  const p4 = await evaluate(cdp, PROFIL);
  t('retirer la photo : retour à l\'emoji', p4.avatar.kind === 'emoji' && !p4.avatar.src);
  t('retirer la photo : le pseudo survit', p4.name === 'Zoé');

  // ═══ 8. profil corrompu : aucune page ne casse
  await evaluate(cdp, `localStorage.setItem('mathys_game_profile', '{{{ pas du json')`);
  for (const g of ['imitation', 'demicercle', 'ban', 'precision', 'passeur', 'quiment']) {
    await go(cdp, URLS(g));
    const vivant = await evaluate(cdp, `({
      champ: !!document.getElementById('name-input'),
      avatars: document.querySelectorAll('.avatar-pick').length,
      picked: document.querySelectorAll('.avatar-pick.picked').length,
    })`);
    t(`${g} : survit à un profil corrompu`,
      vivant.champ && vivant.avatars >= 6 && vivant.picked === 1,
      `${vivant.avatars} avatars, ${vivant.picked} sélectionné`);
  }

  // ═══ 9. Morpion : l'exception, vérifiée sur la vraie page
  // Le module y est chargé depuis le handoff du Game Hub, UNIQUEMENT pour que
  // hub-handoff.js se présente au Hub avec le même player.id. Il ne doit rien
  // y ajouter : morpion-server ne reçoit ni pseudo ni avatar (le fil est
  // vérifié par tests/handoff-morpion.mjs).
  await go(cdp, URLS('morpion'));
  const m = await evaluate(cdp, `({
    module: typeof window.GameProfile,
    champ: !!document.getElementById('name-input'),
    row: !!document.getElementById('avatar-row'),
    photo: !!document.querySelector('.gp-photo'),
    boutons: !!document.getElementById('host') && !!document.getElementById('join'),
  })`);
  t('morpion : le module de profil est chargé (identité Game Hub seulement)', m.module === 'object', m.module);
  t('morpion : aucun champ d\'identité n\'a été ajouté', !m.champ && !m.row && !m.photo);
  t('morpion : la page reste fonctionnelle', m.boutons === true);

  t('aucune erreur JS sur les pages visitées', errs.length === 0, errs.slice(0, 2).join(' | '));
}

// --- orchestration ----------------------------------------------------------
const srv = await serve();
const dir = mkdtempSync(path.join(tmpdir(), 'prof-'));
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${dir}`, '--no-first-run', '--window-size=900,1000', 'about:blank'],
  { stdio: 'ignore' });

const stop = () => {
  // ⚠️ edge.kill() ne tue que le parent : Chromium en laisse une quinzaine
  // derrière lui, et l'exécution suivante se connecterait à un fantôme.
  try { execFileSync('taskkill', ['/PID', String(edge.pid), '/T', '/F'], { stdio: 'ignore' }); }
  catch (_) { try { edge.kill(); } catch (__) {} }
  try { srv.close(); } catch (_) {}
  try { rmSync(dir, { recursive: true, force: true }); } catch (_) {}
};

console.log('Profil local — tests unitaires + intégration\n');
try {
  let cdp = null;
  for (let i = 0; i < 40 && !cdp; i++) {
    await sleep(300);
    try {
      const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      const tabs = await r.json();
      const page = tabs.find((x) => x.type === 'page');
      if (page) cdp = await connect(page.webSocketDebuggerUrl);
    } catch (_) { /* Edge démarre encore */ }
  }
  if (!cdp) throw new Error('Edge n\'a pas ouvert son protocole de debug');

  const errs = [];
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  cdp.ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      errs.push((d.exception?.description || d.text || '').split('\n')[0]);
    }
  });

  await run(cdp, errs);
} catch (e) {
  t('EXCEPTION', false, e.message);
} finally {
  stop();
}

console.log(out.join('\n'));
console.log(`\n${ko ? 'DES TESTS ÉCHOUENT' : 'TOUT PASSE'} — ${out.length} lignes, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
