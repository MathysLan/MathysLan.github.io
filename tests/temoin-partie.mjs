// Faux Témoin — des parties dans de vrais navigateurs, contre le VRAI
// temoin-server (flash 1,5 s, déclaration 6 s, délibération 3 s, dernier
// appel 2 s, audit 2,5 s).
//
//   node tests/temoin-partie.mjs                    ~1 min
//   node tests/temoin-partie.mjs --shots <dossier>
//   node tests/temoin-partie.mjs --serveur C:\perso\temoin-server
//   node tests/temoin-partie.mjs --edge <chemin du navigateur>
//
// Deux onglets — bureau (souris) et téléphone (doigt) — et un robot
// WebSocket. Ce qui est vérifié : ce que l'ÉCRAN montre est exactement ce que
// le serveur a envoyé (rôle et fragment du flash, révélations, audit, points,
// totaux, classement), les intentions parties sont celles des clics (déclarer,
// se taire, verrouiller avec accusation), rayer reste local, et aucune erreur
// JavaScript. Puis une partie à deux (l'indic).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { compteur, sleep, arg, lancerEdge, robot, ROOT } from './croquis-harnais.mjs';

const t = compteur();
const SHOTS = arg('--shots');

// ------------------------------------------------------------ le vrai serveur
const voisin = path.resolve(ROOT, '..', 'temoin-server');
const dossier = arg('--serveur') || (existsSync(path.join(voisin, 'server.js')) ? voisin : 'C:\\perso\\temoin-server');
const port = 8700 + Math.floor(Math.random() * 200);
const srv = spawn(process.execPath, [path.join(dossier, 'server.js')], {
  cwd: dossier,
  env: {
    ...process.env, PORT: String(port), PRESENCE_QUIET: '1',
    TEST_FLASH_MS: '1500', TEST_DECLARE_MS: '6000', TEST_DELIBERATE_MS: '3000', TEST_LASTCALL_MS: '2000', TEST_RESULTS_MS: '2500',
  },
  stdio: ['ignore', 'pipe', 'inherit'],
});
process.on('exit', () => srv.kill());
await new Promise((res) => srv.stdout.on('data', (d) => { if (/écoute/.test(String(d))) res(); }));
const URL_WS = `ws://127.0.0.1:${port}`;
const PAGE = pathToFileURL(path.join(ROOT, 'games', 'temoin', 'index.html')).href + `?server=${encodeURIComponent(URL_WS)}`;

const ERREURS = `window.__err = []; addEventListener('error', (e) => window.__err.push(String(e.message || e)));
  addEventListener('unhandledrejection', (e) => window.__err.push('promesse : ' + String(e.reason)));`;

const { onglet } = await lancerEdge({ shots: SHOTS });
async function ouvrir(nom, o) {
  const p = await onglet(nom, { ...o, page: PAGE });
  await p.c.send('Page.addScriptToEvaluateOnNewDocument', { source: ERREURS });
  p.ouvrir = async () => {
    await p.c.send('Page.navigate', { url: PAGE });
    await p.until('document.readyState === "complete" && typeof NET === "object" && !!window.TemoinSuspects');
  };
  return p;
}
const A = await ouvrir('A', { w: 1200, h: 850 });
const B = await ouvrir('B', { w: 390, h: 844, mobile: true });

const dernier = async (p, type) => (await p.recu(type)).at(-1);
const attendreType = (p, type, pred = 'true', ms = 15000) =>
  p.until(`window.__recu.some((m) => m.type === ${JSON.stringify(type)} && (${pred}))`, ms);

// =================================================== 1. partie à trois
await A.ouvrir(); await B.ouvrir();
await A.ev('document.getElementById("name-input").value = ""; true');
await A.taper('#name-input', 'Alice');
await A.clic('#host');
await A.until('/^[A-Z]{4}$/.test(document.getElementById("room-code").textContent)');
const code = await A.texte('#room-code');
t('[1] salon créé : code à 4 lettres', /^[A-Z]{4}$/.test(code));
await A.clic('.nb-affaires[data-cases="3"]');
await A.until('document.getElementById("lobby-cases").textContent.startsWith("3 affaires")');
t('[1] l hôte règle 3 affaires : bouton enfoncé, texte du salon', await A.ev('document.querySelector(\'.nb-affaires[data-cases="3"]\').getAttribute("aria-pressed") === "true"'));

await B.ev('document.getElementById("name-input").value = ""; true');
await B.taper('#name-input', 'Bruno');
await B.taper('#code-input', code);
await B.clic('#join');
const R = robot(URL_WS, 'Robot', code);
await A.until('document.querySelectorAll("#players li").length === 3');
t('[1] 3 joueurs au salon ; l invité ne voit pas les réglages', (await A.ev('document.querySelectorAll("#players li").length')) === 3
  && !(await B.visible('#host-config')) && (await B.texte('#lobby-cases')).startsWith('3 affaires'));
await A.until('!document.getElementById("start").disabled');
await A.clic('#start');

// --- le flash
await attendreType(B, 'role');
await B.until('!document.getElementById("flash").hidden');
const roleB = await dernier(B, 'role');
const caseB = await dernier(B, 'case');
t('[1] lancement : tapissage de 12 cartes chez les deux', (await A.ev('document.querySelectorAll("#mur .carte").length')) === 12 && (await B.ev('document.querySelectorAll("#mur .carte").length')) === 12);
const vuB = await B.ev('[...document.querySelectorAll("#flash .vu li")].map((li) => li.lastChild.textContent)');
t('[1] le flash montre EXACTEMENT le fragment reçu (téléphone)', vuB.length === roleB.fragment.length,
  JSON.stringify({ vuB, f: roleB.fragment }));
t('[1] téléphone : la photo du flash est à l écran, avant le tapissage, sans défiler',
  await B.ev('(() => { const f = document.querySelector("#flash .polaroid") || document.getElementById("flash"); const r = f.getBoundingClientRect(); return scrollY === 0 && r.bottom <= innerHeight && r.bottom < document.getElementById("tapissage").getBoundingClientRect().top + 1; })()'));
t('[1] le rôle est dit', /témoin|FAUX TÉMOIN/.test(await B.texte('#role')));
const desc0 = await A.ev('document.querySelector("#mur .carte").getAttribute("aria-label")');
t('[1] chaque carte se lit en entier (aria-label : numéro et description)', /^Suspect 1 : .+, manteau .+/.test(desc0), desc0);
await B.shot('temoin-1-flash-telephone');
await A.until('document.getElementById("flash").hidden', 5000);
t('[1] après le flash : la photo disparaît', await A.ev('document.getElementById("flash").hidden && !document.getElementById("declarer").hidden'));

// --- déclaration 1 : A déclare son premier attribut vu, B se tait, le robot aussi
const roleA = await dernier(A, 'role');
const f = roleA.fragment[0];
await A.clic(`#decl-attrs button[data-attr="${f.attr}"]`);
const valeurs = await A.ev('[...document.querySelectorAll("#decl-valeurs button")].map((b) => b.textContent)');
t('[1] choisir un attribut montre ses valeurs (vocabulaire du serveur)', valeurs.length >= 3);
const idx = (await A.ev('window.__recu.find((m) => m.type === "game").attrs')).find((a) => a.id === f.attr).values.indexOf(f.value);
await A.clic(`#decl-valeurs button:nth-child(${idx + 1})`);
t('[1] le bouton d envoi dit la déclaration', /^Déclarer : /.test(await A.texte('#decl-envoyer')));
await A.clic('#decl-envoyer');
await B.clic('#decl-taire');
const declA = (await A.envoye('declare')).at(-1);
t('[1] intention envoyée = le clic (attribut, valeur, affaire)', declA && declA.attr === f.attr && declA.value === f.value && declA.caseId === caseB.caseId);
t('[1] se taire envoie `pass`', !!(await B.envoye('declare')).find((m) => m.pass === true));
await B.until('/2\\/3 ont déclaré/.test(document.getElementById("decl-etat").textContent)', 4000);
t('[1] le compteur suit `declared` (2/3)', /2\/3 ont déclaré/.test(await B.texte('#decl-etat')));
R.send({ action: 'declare', caseId: caseB.caseId, pass: true });

// --- révélation 1, verrous
await attendreType(A, 'phase', 'm.phase === "declare2"');
await A.until('!document.getElementById("revelations").hidden');
const rev = await A.texte('#tours');
t('[1] révélation 1 affichée : la déclaration d Alice et les silences', rev.includes('Alice') && rev.includes('se tait') && rev.includes('×1'), rev.slice(0, 200));
t('[1] le bandeau dit ce que vaut un verrou maintenant (5)', /5 points/.test(await A.texte('#palier')));
await A.shot('temoin-2-revelation-bureau');

// Rayer : local. Puis verrouiller le n° 2 en désignant Bruno.
await A.clic('#mur .carte:nth-child(1)');
await A.clic('#rayer');
t('[1] rayer : la carte est barrée, rien n est envoyé', await A.ev('document.querySelector("#mur .carte").classList.contains("is-raye")')
  && (await A.envoye('lock')).length === 0);
await A.clic('#mur .carte:nth-child(2)');
const idB = (await dernier(B, 'game')).you;
await A.ev(`document.getElementById("accuse").value = ${JSON.stringify(idB)}; true`);
await A.clic('#lock');
const lockA = (await A.envoye('lock')).at(-1);
t('[1] verrou envoyé : n° 2 (index 1), Bruno désigné', lockA && lockA.suspect === 1 && lockA.accuse === idB);
t('[1] carte verrouillée marquée 🔒, verrou plus proposé', (await A.texte('#mur .carte:nth-child(2) .badge')) === '🔒' && !(await A.visible('#verrou')));
await B.clic('#mur .carte:nth-child(3)');
t('[1] téléphone : la fiche du suspect s ouvre', await B.visible('#fiche') && (await B.texte('#fiche-titre')) === 'Suspect n° 3');
await B.clic('#lock');
R.send({ action: 'lock', caseId: caseB.caseId, suspect: 4 });

// --- l'audit
await attendreType(A, 'case-end');
await A.until('!document.getElementById("audit").hidden');
await B.until('!document.getElementById("audit").hidden');
const fin1 = await dernier(A, 'case-end');
t('[1] tous verrouillés : audit tout de suite', fin1.caseId === 1);
t('[1] l audit nomme le bon coupable', (await A.texte('#audit-titre')).includes(`n° ${fin1.audit.culprit + 1}`));
t('[1] le tapissage tamponne le coupable', await A.ev(`document.querySelector("#mur .carte:nth-child(${fin1.audit.culprit + 1})").classList.contains("is-coupable")`));
const ptsEcran = await A.ev('Object.fromEntries([...document.querySelectorAll("#audit-liste .audit-ligne")].map((li) => [li.querySelector(".nom").firstChild.textContent, li.querySelector(".pts").textContent]))');
const noms = { [(await dernier(A, 'game')).you]: 'Alice (toi)', [idB]: 'Bruno', [R.id]: 'Robot' };
const ptsOk = fin1.audit.points.every((p) => ptsEcran[noms[p.id]] === `+${p.points}`);
t('[1] les points de l audit = ceux du serveur, joueur par joueur', ptsOk, JSON.stringify({ ptsEcran, srv: fin1.audit.points }));
const totaux = await A.ev('Object.fromEntries([...document.querySelectorAll("#tableau li")].map((li) => [li.dataset.id, li.querySelector(".total").textContent]))');
t('[1] le tableau = les totaux du serveur', fin1.players.every((p) => totaux[p.id] === `${p.score} pts`), JSON.stringify(totaux));
const menteur = fin1.audit.liars[0];
if (menteur) t('[1] le Faux Témoin est nommé', (await A.texte('#audit-coupable')).includes(noms[menteur].replace(' (toi)', '')));
else t('[1] sans Faux Témoin, l audit le dit', /Pas de Faux Témoin/.test(await A.texte('#audit-coupable')));
t('[1] « Affaire suivante » : à l hôte seulement', await A.visible('#suivante') && !(await B.visible('#suivante')));
const styleSuiv = await A.ev('(() => { const b = document.getElementById("suivante"); const s = getComputedStyle(b); let o = 1; for (let e = b; e; e = e.parentElement) o *= +getComputedStyle(e).opacity; return { o, dis: b.disabled, color: s.color, bg: s.backgroundColor, filter: s.filter }; })()');
const lum = (c) => { const v = c.match(/[\d.]+/g).slice(0, 3).map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
const [l1, l2] = [lum(styleSuiv.color), lum(styleSuiv.bg)].sort((x, y) => y - x);
t('[1] « Affaire suivante » : actif, opaque, texte lisible sur l accent (≥ 4.5:1)', styleSuiv.o === 1 && !styleSuiv.dis && (l1 + 0.05) / (l2 + 0.05) >= 4.5, JSON.stringify(styleSuiv));
await B.shot('temoin-3-audit-telephone');
await A.shot('temoin-3-audit-bureau');
await A.clic('#suivante');
await attendreType(B, 'case', 'm.caseId === 2', 5000);
const aff2 = await B.until('document.getElementById("bandeau").textContent.startsWith("Affaire 2/3")', 5000)
  && await A.until('document.getElementById("bandeau").textContent.startsWith("Affaire 2/3")', 5000);
const restes = await A.ev('[...document.querySelectorAll("#mur .is-raye, #mur .badge:not(:empty)")].map((e) => e.outerHTML.slice(0, 80))');
t('[1] affaire 2 : nouveau tapissage, rayures et verrou oubliés', aff2 && restes.length === 0,
  JSON.stringify({ aff2, restes, bandeau: await A.texte('#bandeau') }));

// --- personne ne joue les affaires 2 et 3 : la minuterie mène au bout
await attendreType(A, 'results', 'true', 60000);
await A.until('!document.getElementById("end").hidden');
const res = await dernier(A, 'results');
const lignes = await A.ev('[...document.querySelectorAll("#classement li")].map((li) => li.querySelector(".score").textContent)');
t('[1] fin : le classement = celui du serveur', res.complete && lignes.length === 3 && res.ranking.every((r, i) => lignes[i] === `${r.score} pts`));
t('[1] revanche et salon à l hôte, attente à l invité', await A.visible('#revanche') && !(await B.visible('#revanche')) && await B.visible('#attente-hote'));
await A.shot('temoin-4-fin-bureau');
await A.clic('#vers-salon');
t('[1] retour au salon', await B.until('!document.getElementById("lobby").hidden', 4000));
const err1 = [...await A.ev('window.__err'), ...await B.ev('window.__err')];
t('[1] aucune erreur JavaScript', err1.length === 0, err1.join(' | '));
R.ws.close();

// ======================================================= 2. à deux : l'indic
await A.ouvrir(); await B.ouvrir();
await A.clic('#host');
await A.until('/^[A-Z]{4}$/.test(document.getElementById("room-code").textContent)');
const code2 = await A.texte('#room-code');
await B.taper('#code-input', code2);
await B.clic('#join');
await A.until('document.querySelectorAll("#players li").length === 2');
t('[2] à deux, le salon annonce l indic', /indic/.test(await A.texte('#lobby-cases')));
await A.until('!document.getElementById("start").disabled');
await A.clic('#start');
await attendreType(A, 'phase', 'm.phase === "declare1"');
await A.clic('#decl-taire'); await B.clic('#decl-taire');
await attendreType(A, 'phase', 'm.phase === "declare2"');
await A.until('!document.getElementById("revelations").hidden');
t('[2] révélation : l indic a parlé', (await A.texte('#tours')).includes('L’indic'));
await A.clic('#mur .carte:nth-child(1)');
t('[2] à deux, pas de Faux Témoin à désigner', !(await A.ev('getComputedStyle(document.getElementById("accuse")).display !== "none" && !document.getElementById("accuse").hidden')));
await B.shot('temoin-5-indic-telephone');
const err2 = [...await A.ev('window.__err'), ...await B.ev('window.__err')];
t('[2] aucune erreur JavaScript', err2.length === 0, err2.join(' | '));

const { ok, ko } = t.bilan();
console.log(`\n${ok} OK, ${ko} KO`);
process.exit(ko ? 1 : 0);
