// Test clavier de bout en bout — de VRAIES frappes Tab, pas des el.focus().
//
//   node tests/keyboard.mjs
//   node tests/keyboard.mjs --edge "C:\chemin\vers\msedge.exe"
//
// Pourquoi ce fichier existe : `:focus-visible` ne s'allume que si le focus
// VIENT du clavier. Un el.focus() lancé depuis un script ne le déclenche pas
// sur un <button> (vérifié sous Edge), et focus({focusVisible:true}) n'est pas
// encore implémenté. Autrement dit, tests/front.html ne peut PAS prouver qu'un
// anneau de focus apparaît réellement à la tabulation — il ne peut que vérifier
// que la règle existe. Ce script comble exactement ce trou : il ouvre Edge en
// headless avec le protocole DevTools, envoie des Tab comme un clavier, et lit
// pour chaque élément atteint s'il porte un anneau visible.
//
// Aucune dépendance : le client WebSocket est celui de Node (≥ 22).
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };

const EDGE = arg('--edge') || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9333;
const TABS = 18;   // assez pour parcourir l'accueil de chaque page,
                   // y compris le choix de photo ajoute par game-profile.js

const PAGES = [
  ['index.html', `file://${ROOT}/index.html`],
  ['morpion', `file://${ROOT}/games/morpion/index.html`],
  ['demicercle', `file://${ROOT}/games/demicercle/index.html`],
  ['imitation', `file://${ROOT}/games/imitation/index.html`],
  ['ban', `file://${ROOT}/games/ban/index.html`],
  ['precision', `file://${ROOT}/games/precision/index.html`],
  ['passeur', `file://${ROOT}/games/passeur/index.html`],
  ['quiment', `file://${ROOT}/games/quiment/index.html`],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- petit client CDP ------------------------------------------------------
async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('CDP injoignable')); });
  let id = 0;
  const waiting = new Map();
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
  };
  return {
    ws,
    send(method, params = {}) {
      const mid = ++id;
      ws.send(JSON.stringify({ id: mid, method, params }));
      return new Promise((res) => waiting.set(mid, res));
    },
  };
}

async function evaluate(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text);
  return r.result?.result?.value;
}

async function pressTab(cdp) {
  for (const type of ['rawKeyDown', 'keyUp']) {
    await cdp.send('Input.dispatchKeyEvent', {
      type, key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9,
    });
  }
}

// Ce qu'on considère comme « un anneau visible » : un outline non nul, ou une
// box-shadow (le portfolio dessine son anneau en inset, parce que clip-path
// rogne les outlines — c'est documenté dans css/tf2.css).
const PROBE = `(() => {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  const s = getComputedStyle(el);
  const outline = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0;
  const shadow = s.boxShadow && s.boxShadow !== 'none';
  return {
    tag: el.tagName.toLowerCase(),
    id: el.id || '',
    label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 28),
    focusVisible: el.matches(':focus-visible'),
    ring: outline || shadow,
    how: outline ? 'outline ' + s.outlineWidth + ' ' + s.outlineColor : (shadow ? 'box-shadow' : 'aucun'),
  };
})()`;

async function auditPage(cdp, label, url) {
  await cdp.send('Page.navigate', { url });
  await sleep(1400);
  await evaluate(cdp, 'window.focus(); document.body.focus();');

  const seen = [], problems = [];
  for (let i = 0; i < TABS; i++) {
    await pressTab(cdp);
    await sleep(60);
    const info = await evaluate(cdp, PROBE);
    if (!info) continue;
    const key = info.tag + '#' + info.id + '/' + info.label;
    if (seen.includes(key)) break;          // on a bouclé
    seen.push(key);
    if (!info.focusVisible || !info.ring) {
      problems.push(`  <${info.tag}${info.id ? '#' + info.id : ''}> « ${info.label} » `
        + `focus-visible=${info.focusVisible} anneau=${info.how}`);
    }
  }
  return { label, count: seen.length, problems };
}

// --- main ------------------------------------------------------------------
const profile = mkdtempSync(path.join(tmpdir(), 'kb-edge-'));
const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--allow-file-access-from-files',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=1100,900',
  'about:blank',
], { stdio: 'ignore' });

let code = 0;
try {
  // Attendre que le port DevTools réponde.
  let target = null;
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(250);
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
    } catch (_) { /* pas encore prêt */ }
  }
  if (!target) throw new Error(`Edge n'a pas ouvert le port ${PORT} (chemin correct ? --edge ...)`);

  const cdp = await connect(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  console.log('Test clavier — vraies frappes Tab via CDP\n');
  for (const [label, url] of PAGES) {
    const r = await auditPage(cdp, label, url);
    if (r.problems.length) {
      code = 1;
      console.log(`KO   ${r.label} — ${r.problems.length} élément(s) sur ${r.count} sans anneau au clavier`);
      r.problems.forEach((p) => console.log(p));
    } else {
      console.log(`OK   ${r.label} — ${r.count} éléments tabulés, tous avec un anneau visible`);
    }
  }
  cdp.ws.close();
} catch (e) {
  console.error(`\nÉCHEC : ${e.message}`);
  code = 1;
} finally {
  edge.kill();
  try { rmSync(profile, { recursive: true, force: true }); } catch (_) {}
}
console.log(code ? '\nDes éléments ne montrent pas leur focus au clavier.' : '\nTOUT PASSE');
process.exit(code);
