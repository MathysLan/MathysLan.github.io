// Le Passeur — on JOUE une manche, avec de vrais clics.
//
//   node tests/passeur-play.mjs --server ws://localhost:8090
//   node tests/passeur-play.mjs --server wss://passeur-server.onrender.com
//   node tests/passeur-play.mjs --server ... --reduced
//
// Pourquoi ce fichier existe : `tests/games.html` pilote `Court.render()` en
// appelant `dispatchEvent` sur le `<g>` d'une zone. Ça CONTOURNE le test de
// survol du navigateur, donc ça ne prouve rien sur la jouabilité réelle. Deux
// bugs bloquants sont passés à travers cette suite :
//
//   1. les couches décoratives (joueurs, ballon, trajectoires) sont dessinées
//      APRÈS les zones et interceptaient le clic — l'ombre au sol du
//      réceptionneur bloquait à elle seule tout le centre de la zone arrière ;
//   2. contre un serveur d'une version précédente, le message `go` n'arrive
//      jamais : les zones n'étaient jamais armées, et rien n'était cliquable.
//
// Ici on envoie de VRAIS événements d'entrée par le protocole DevTools, aux
// coordonnées réelles de la zone, sur la page de jeu chargée telle quelle. Et
// on vérifie le résultat là où il compte : dans le message `results` du
// serveur, qui nous dit quelle passe IL a enregistrée.
//
// Aucune dépendance : le client WebSocket est celui de Node (≥ 22). Il faut un
// serveur passeur en face — c'est le seul test de ce dépôt qui en a besoin,
// d'où le `--server` obligatoire.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const has = (n) => process.argv.includes(n);

const EDGE = arg('--edge') || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const SERVER = arg('--server');
const REDUCED = has('--reduced');
// ⚠️ Un port FIXE fait échouer deux exécutions rapprochées : l'Edge précédent
// tient encore le port, le nôtre n'arrive pas à l'ouvrir, et on se connecte
// sans le savoir à l'ANCIEN navigateur — qui n'a ni la bonne page ni les
// bonnes préférences. Symptôme observé : le test passait seul et échouait
// juste après un autre. Un port tiré au hasard règle le problème.
const PORT = 9400 + Math.floor(Math.random() * 400);

if (!SERVER) {
  console.log('Il faut un serveur en face :\n'
    + '  node tests/passeur-play.mjs --server ws://localhost:8090\n'
    + '  node tests/passeur-play.mjs --server wss://passeur-server.onrender.com');
  process.exit(2);
}

let ok = 0, ko = 0;
const t = (name, cond) => {
  if (cond) { ok++; console.log('OK   ' + name); }
  else { ko++; console.log('KO   ' + name); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- petit client CDP ------------------------------------------------------
async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('CDP injoignable')); });
  let id = 0;
  const waiting = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
  };
  return {
    send(method, params = {}) {
      const mid = ++id;
      ws.send(JSON.stringify({ id: mid, method, params }));
      return new Promise((res) => waiting.set(mid, res));
    },
  };
}

const profile = mkdtempSync(path.join(tmpdir(), 'passeur-play-'));
const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--allow-file-access-from-files',
  ...(REDUCED ? ['--force-prefers-reduced-motion'] : []),
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=900,1100',
  'about:blank',
], { stdio: 'ignore' });

// ⚠️ `edge.kill()` ne tue QUE le processus parent. Chromium en lance une
// quinzaine d'autres, qui survivent : après quelques exécutions la machine est
// saturée de navigateurs fantômes et les lancements suivants se comportent
// n'importe comment (symptôme observé : le test échouait au deuxième passage).
// Sur Windows, il faut tuer l'arbre — `/T`.
function closeEdge() {
  try { edge.kill(); } catch (_) { /* déjà parti */ }
  if (process.platform === 'win32' && edge.pid) {
    try {
      spawn('taskkill', ['/PID', String(edge.pid), '/T', '/F'], { stdio: 'ignore', detached: true }).unref();
    } catch (_) { /* tant pis */ }
  }
}
process.on('exit', closeEdge);

async function target() {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const page = (await r.json()).find((x) => x.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch (_) { /* pas encore prêt */ }
    await sleep(200);
  }
  throw new Error('Edge ne répond pas sur le port de debug');
}

const cdp = await connect(await target());

const evaluate = async (expr) => {
  const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'exception');
  return r.result?.result?.value;
};
const until = async (expr, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await evaluate(expr)) return true;
    await sleep(80);
  }
  return false;
};

// --- de VRAIES entrées, aux coordonnées réelles ---------------------------
async function clickAt(x, y) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}
async function tapAt(x, y) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
// ⚠️ Une touche « texte » (un chiffre) et une touche de commande (Entrée) ne
// s'envoient pas pareil. Avec `text: 'Enter'`, Chromium traite l'événement
// comme une saisie de texte et le handler ne voit pas la touche : il faut
// `rawKeyDown` et pas de `text`. Même piège que dans tests/keyboard.mjs.
async function pressKey(key, code, vk, printable) {
  await cdp.send('Input.dispatchKeyEvent', Object.assign({
    type: printable ? 'keyDown' : 'rawKeyDown', key, code,
    windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk,
  }, printable ? { text: key } : {}));
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk,
  });
}
// Le centre d'une zone, en coordonnées de la fenêtre.
const zoneCenter = (pass) => evaluate(`(() => {
  const z = document.querySelector('#court .zone[data-pass="${pass}"] .z-hit');
  if (!z) return null;
  const r = z.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})()`);

// --- la partie ------------------------------------------------------------
try {
  console.log(`Le Passeur — partie réelle contre ${SERVER}`
    + (REDUCED ? ' (mouvement réduit)' : ''));

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate', {
    url: `file://${ROOT}/games/passeur/index.html?server=${encodeURIComponent(SERVER)}`,
  });
  t('la page de jeu se charge', await until("!!document.getElementById('host')", 12000));

  // On remplit et on crée la partie avec de vrais clics.
  await evaluate("document.getElementById('name-input').value = 'Robot'");
  const hostBtn = await evaluate(`(() => {
    const r = document.getElementById('host').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  await clickAt(hostBtn.x, hostBtn.y);
  const joined = await until("!document.getElementById('lobby').hidden && /^[A-Z]{4}$/.test(document.getElementById('room-code').textContent)", 45000);
  t('un vrai clic crée la partie (le serveur répond un code)', joined);
  if (!joined) throw new Error('pas de salon : le serveur est-il joignable ?');

  const startBtn = await evaluate(`(() => {
    const r = document.getElementById('start').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  await clickAt(startBtn.x, startBtn.y);
  t('un vrai clic lance la partie', await until("!document.getElementById('game').hidden", 15000));

  // ---------------- MANCHE 1 ----------------
  async function playRound(n, how) {
    console.log(`\n--- manche ${n} : ${how} ---`);

    // Mise en situation : rien ne doit être jouable.
    const armedNow = await evaluate("document.getElementById('court').dataset.armed");
    if (armedNow === '0') {
      const c = await zoneCenter('courte');
      await clickAt(c.x, c.y);
      await sleep(150);
      t(`m${n} — un vrai clic pendant la mise en situation ne joue rien`,
        !(await evaluate("!!document.querySelector('#court .zone.is-picked')")));
    } else {
      t(`m${n} — la fenêtre était déjà ouverte (serveur sans mise en situation)`, true);
    }

    // « À TOI »
    t(`m${n} — la fenêtre de décision s'ouvre`,
      await until("document.getElementById('court').dataset.armed === '1'", 12000));

    // Le chrono doit DÉFILER. On échantillonne la valeur ET la largeur de la barre.
    const samples = [];
    for (let i = 0; i < 6; i++) {
      samples.push(await evaluate(`(() => {
        const n = document.getElementById('timer-num').textContent;
        const w = document.getElementById('timer-fill').style.width;
        return n + '|' + w;
      })()`));
      await sleep(320);
    }
    const nums = samples.map((s) => parseFloat(s.split('|')[0].replace(',', '.')));
    const widths = samples.map((s) => parseFloat(s.split('|')[1]) || 0);
    const distinct = new Set(nums).size;
    t(`m${n} — LE CHRONO DÉFILE VRAIMENT [${nums.join(' ')}]`,
      distinct >= 4 && nums[0] > nums[nums.length - 1]);
    t(`m${n} — la barre de progression diminue [${widths.map((w) => Math.round(w)).join(' ')} %]`,
      widths[0] > widths[widths.length - 1] + 5);

    // La décision, avec l'entrée demandée.
    let want;
    if (how === 'clic') {
      want = 'courte';
      const c = await zoneCenter(want);
      await clickAt(c.x, c.y);
    } else if (how === 'tactile') {
      want = 'droite';
      const c = await zoneCenter(want);
      await tapAt(c.x, c.y);
    } else if (how === 'touche 1') {
      want = 'gauche';
      await pressKey('1', 'Digit1', 49, true);
    } else if (how === 'Entrée') {
      want = 'gauche';
      await evaluate("document.querySelector('#court .zone[data-pass=\"gauche\"]').focus()");
      t(`m${n} — la zone prend bien le focus`,
        await evaluate("(document.activeElement && document.activeElement.dataset || {}).pass === 'gauche'"));
      await pressKey('Enter', 'Enter', 13, false);
    }

    await sleep(250);
    const picked = await evaluate("(document.querySelector('#court .zone.is-picked') || {}).dataset ? document.querySelector('#court .zone.is-picked').dataset.pass : null");
    t(`m${n} — ${how} : la zone « ${want} » devient sélectionnée (obtenu : ${picked})`, picked === want);
    t(`m${n} — l'attente des autres est annoncée`,
      await evaluate("!document.getElementById('waiting').hidden"));
    t(`m${n} — les autres zones sont verrouillées`,
      await evaluate("document.getElementById('court').dataset.locked === '1'"
        + " && document.querySelectorAll('#court .zone.is-picked').length === 1"));

    // LE point : ce que le SERVEUR a enregistré, lu dans son message results.
    t(`m${n} — le serveur renvoie un résultat`,
      await until("!document.getElementById('results').hidden", 15000));
    const mine = await evaluate("document.getElementById('res-mine').textContent.trim()");
    const rows = await evaluate("document.getElementById('res-rows').textContent");
    const label = { gauche: 'Aile gauche', courte: 'Rapide au centre',
      droite: 'Aile droite', arriere: 'Attaque arrière', deuxieme: 'Deuxième main' }[want];
    t(`m${n} — LE SERVEUR A BIEN ENREGISTRÉ « ${label} »`, rows.includes(label));
    t(`m${n} — le détail de mon score est là (${mine.split('\n')[0]})`, /\+\d+/.test(mine));

    // Manche suivante
    const next = await evaluate(`(() => {
      const b = document.getElementById('next');
      if (b.hidden) return null;
      const r = b.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
    return next;
  }

  const next1 = await playRound(1, 'clic');
  t('le bouton « manche suivante » est là', !!next1);
  await clickAt(next1.x, next1.y);
  t('un vrai clic enchaîne sur la manche 2',
    await until("!document.getElementById('game').hidden", 12000));

  // ---------------- MANCHE 2 : au clavier ----------------
  const next2 = await playRound(2, 'touche 1');
  await clickAt(next2.x, next2.y);
  await until("!document.getElementById('game').hidden", 12000);

  // ---------------- MANCHE 3 : au doigt ----------------
  const next3 = await playRound(3, 'tactile');
  await clickAt(next3.x, next3.y);
  await until("!document.getElementById('game').hidden", 12000);

  // ---------------- MANCHE 4 : Entrée sur une zone focalisée ----------------
  await playRound(4, 'Entrée');

  // ---------------- SIX JOUEURS DE CHAQUE CÔTÉ ----------------
  console.log('\n--- le terrain ---');
  const counts = await evaluate(`(() => {
    const svg = document.getElementById('res-court') || document.getElementById('court');
    const us = svg.querySelectorAll('.sil-us').length;
    const them = svg.querySelectorAll('.sil-them').length;
    const set = svg.querySelectorAll('.sil-set').length;
    return { us: us + set, them: them };
  })()`);
  t(`six joueurs dans notre camp (${counts.us})`, counts.us === 6);
  t(`six joueurs en face (${counts.them})`, counts.them === 6);

  const overlap = await evaluate(`(() => {
    const svg = document.getElementById('res-court') || document.getElementById('court');
    const bodies = [...svg.querySelectorAll('.sil-body')].map((b) => b.getBoundingClientRect());
    let worst = 0;
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i], b = bodies[j];
        const ox = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
        const oy = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
        const inter = ox * oy;
        const small = Math.min(a.width * a.height, b.width * b.height) || 1;
        worst = Math.max(worst, inter / small);
      }
    }
    return Math.round(worst * 100);
  })()`);
  t(`aucun joueur n'en cache un autre (recouvrement maximal ${overlap} %)`, overlap <= 55);
} catch (e) {
  console.log('KO   EXCEPTION : ' + e.message);
  ko++;
}

console.log('\n' + (ko
  ? 'DES TESTS ÉCHOUENT — ' + ko + ' échec(s) sur ' + (ok + ko)
  : 'TOUT PASSE — ' + ok + ' vérifications, 0 échec(s)'));
closeEdge();
process.exit(ko ? 1 : 0);
