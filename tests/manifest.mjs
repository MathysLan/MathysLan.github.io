// Test du manifest des jeux (data/games.manifest.json).
//
//   node tests/manifest.mjs
//
// Ce que ce fichier essaie d'attraper, et qu'une relecture ne verrait pas :
//
//   1. un manifest qui DÉRIVE du reste du site — une URL de serveur qui ne
//      correspond plus à celle que le client du jeu utilise vraiment, une page
//      qui n'existe pas, un jeu ajouté au carousel et oublié ici ;
//   2. un garde-fou de tools/build.mjs qui ne mordrait plus. Un validateur
//      qu'on ne teste jamais finit par tout accepter en silence, et on ne s'en
//      aperçoit que le jour où il aurait servi.
//
// Les cas « négatifs » cassent volontairement data/games.js dans une copie
// temporaire, lancent le build, et vérifient qu'il ÉCHOUE. Le fichier d'origine
// est restauré dans un `finally` : une interruption ne doit pas laisser le
// dépôt dans un état bancal.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const p = (f) => path.join(ROOT, f);
const read = (f) => fs.readFileSync(p(f), 'utf8');

let ko = 0, n = 0;
const t = (nom, ok, detail = '') => {
  n++;
  if (!ok) ko++;
  console.log(`${ok ? 'OK  ' : 'KO  '} ${nom}${detail ? ' — ' + detail : ''}`);
};

// data/games.js tel que le navigateur le charge : un const, pas un module.
function loadGames() {
  const ctx = {};
  vm.runInNewContext(`${read('data/games.js')}\n;this.GAMES = GAMES;`, ctx);
  return ctx.GAMES;
}

const GAMES = loadGames();
const M = JSON.parse(read('data/games.manifest.json'));

console.log('Manifest des jeux\n');

// ---------------------------------------------------------------- cohérence
t('schéma versionné', M.version === 1, `version=${M.version}`);
t('la base des durées est écrite noir sur blanc',
  typeof M.minutesBasis === 'string' && /max/.test(M.minutesBasis));

const live = GAMES.filter((g) => g.status === 'live');
t('tous les jeux jouables sont au manifest',
  M.games.length === live.length, `${M.games.length} / ${live.length}`);
t('même ordre que le carousel',
  M.games.map((g) => g.id).join(',') === live.map((g) => g.id).join(','));
t('aucun jeu « bientôt » au manifest',
  !M.games.some((g) => GAMES.find((x) => x.id === g.id)?.status !== 'live'));

// ------------------------------------------------- le manifest dit vrai
// Le test qui compte vraiment : l'URL de serveur annoncée est-elle celle que
// le client du jeu utilise pour de bon ? Un copier-coller raté ici enverrait
// le Hub réveiller un serveur pendant que le joueur en contacte un autre.
for (const g of M.games.filter((x) => x.mode === 'online')) {
  const net = read(`${g.url}net.js`);
  const m = net.match(/['"](wss:\/\/[^'"]+)['"]/);
  t(`${g.id} : le serveur annoncé est celui du client`,
    !!m && m[1] === g.server, m ? `manifest=${g.server} client=${m[1]}` : 'aucun wss:// dans net.js');
  t(`${g.id} : health et server désignent le même hôte`,
    new URL(g.health).host === new URL(g.server.replace(/^wss:/, 'https:')).host);
}

// Le dialecte de connexion est vérifiable : un client « v1 » envoie name et
// avatar dans son join, un client « anon » n'en envoie aucun.
for (const g of M.games.filter((x) => x.mode === 'online')) {
  const src = read(`${g.url}net.js`) + (fs.existsSync(p(`${g.url}app.js`)) ? read(`${g.url}app.js`) : '');
  const join = /action:\s*'join'[^}]*\}/.exec(src)?.[0] || '';
  const identite = /name/.test(join) && /avatar/.test(join);
  t(`${g.id} : dialecte « ${g.join} » conforme au client`,
    g.join === 'v1' ? identite : !identite, join.slice(0, 48));
}

for (const g of M.games) {
  if (g.mode === 'online') {
    t(`${g.id} : la page existe`, fs.existsSync(p(`${g.url}index.html`)), g.url);
  } else {
    t(`${g.id} : action locale déclarée`, typeof g.action === 'string' && g.action.length > 0);
    t(`${g.id} : un jeu local n'annonce aucun serveur`, !g.server && !g.health && !g.join);
  }
}

// --------------------------------------------------------------- les bornes
for (const g of M.games) {
  t(`${g.id} : joueurs ${g.players.min}..${g.players.max} cohérents`,
    g.players.min >= 1 && g.players.max >= g.players.min);
  t(`${g.id} : durée ${g.minutes.min}..${g.minutes.max} min cohérente`,
    g.minutes.min >= 1 && g.minutes.max >= g.minutes.min);
}
// Les trois contraintes dures relevées DANS les serveurs. Si l'une bouge ici
// sans bouger là-bas, le Hub proposera une partie que le serveur refusera.
t('Qui Ment ? exige toujours 3 joueurs (E.MIN_PLAYERS)',
  M.games.find((g) => g.id === 'quiment').players.min === 3);
t('Morpion reste un duel strict',
  (() => { const g = M.games.find((x) => x.id === 'morpion'); return g.players.min === 2 && g.players.max === 2; })());
t('Le Passeur plafonne à 8 (MAX_PLAYERS)',
  M.games.find((g) => g.id === 'passeur').players.max === 8);

// ------------------------------------------------ la sémantique de `minutes`
// Le filtre de durée compare le MAX, jamais le min : un « ≤ 10 min » ne doit
// pas laisser passer un jeu qui peut réellement durer 15.
const tientEn = (g, max) => g.minutes.max <= max;
const long = M.games.find((g) => g.minutes.max > 10);
t('un filtre « ≤ 10 min » écarte un jeu qui peut durer plus',
  !!long && !tientEn(long, 10), long ? `${long.id} va jusqu'à ${long.minutes.max} min` : 'aucun jeu long');
t('et garde ceux qui tiennent vraiment',
  M.games.filter((g) => tientEn(g, 10)).length > 0);

// ------------------------------------------------ aucun identifiant de contenu
// Le Hub transporte l'historique de contenu sans jamais l'interpréter : aucun
// identifiant de situation, de vidéo ou de thème n'a le droit d'être ici.
const CLES_OK = ['id', 'title', 'emoji', 'url', 'action', 'mode', 'players',
  'minutes', 'needs', 'categories', 'server', 'health', 'join', 'content', 'replay', 'handoff'];
for (const g of M.games) {
  const inconnues = Object.keys(g).filter((k) => !CLES_OK.includes(k));
  t(`${g.id} : aucune clé hors schéma`, inconnues.length === 0, inconnues.join(', '));
}

// ------------------------------------------------------- handoff déclaré = réel
// `handoff: true` promet au Hub que la page du jeu sait être lancée par lui
// (billet, room déclarée). Une promesse sans le code ferait attendre le groupe
// jusqu'à l'échéance du lancement ; le code sans la promesse ne servirait
// jamais. On relit donc la page de chaque jeu.
for (const g of M.games.filter((x) => x.url)) {
  const page = path.join(ROOT, g.url, 'index.html');
  const charge = fs.existsSync(page) && /hub-handoff\.js/.test(fs.readFileSync(page, 'utf8'));
  t(`${g.id} : handoff ${g.handoff ? 'déclaré' : 'non déclaré'} = page ${charge ? 'branchée' : 'non branchée'}`, !!g.handoff === charge);
}

// --------------------------------------------------- les garde-fous mordent
// On casse data/games.js pour de vrai, on lance le build, on vérifie qu'il
// refuse. Sans ça, rien ne prouve que le validateur sert encore à quelque chose.
function buildEchoue(nom, casse) {
  const avant = read('data/games.js');
  try {
    fs.writeFileSync(p('data/games.js'), casse(avant));
    let sortie = '';
    try {
      execFileSync(process.execPath, ['tools/build.mjs', '--no-css', '--check'],
        { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
      t(nom, false, 'le build a ACCEPTÉ');
      return;
    } catch (e) {
      sortie = String(e.stdout || '') + String(e.stderr || '');
    }
    t(nom, /ÉCHEC/.test(sortie), sortie.split('\n').find((l) => /ÉCHEC/.test(l)) || sortie.slice(0, 80));
  } finally {
    fs.writeFileSync(p('data/games.js'), avant);
  }
}

buildEchoue('un jeu « live » sans bloc hub fait échouer le build',
  (s) => s.replace(/    hub: \{[\s\S]*?\n    \},\n/, ''));
buildEchoue('une clé hors schéma fait échouer le build',
  (s) => s.replace("      mode: 'online',", "      mode: 'online',\n      situations: ['s01', 's02'],"));
buildEchoue('une catégorie inconnue fait échouer le build',
  (s) => s.replace("categories: ['reflexe', 'sport'],", "categories: ['volleyball'],"));
buildEchoue('une capacité mal orthographiée fait échouer le build',
  (s) => s.replace("needs: ['mic'],", "needs: ['micro'],"));
buildEchoue('des bornes de joueurs incohérentes font échouer le build',
  (s) => s.replace('players: { min: 3, max: 8 },', 'players: { min: 9, max: 8 },'));
buildEchoue('un serveur en http:// fait échouer le build',
  (s) => s.replace("server: 'wss://passeur-server.onrender.com',", "server: 'ws://passeur-server.onrender.com',"));

// --check attrape-t-il un manifest périmé ?
{
  const avant = read('data/games.manifest.json');
  try {
    fs.writeFileSync(p('data/games.manifest.json'), avant.replace('"max": 8', '"max": 7'));
    let sortie = '';
    try {
      execFileSync(process.execPath, ['tools/build.mjs', '--no-css', '--check'],
        { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) { sortie = String(e.stdout || '') + String(e.stderr || ''); }
    t('--check repère un manifest périmé', /games\.manifest\.json/.test(sortie));
  } finally {
    fs.writeFileSync(p('data/games.manifest.json'), avant);
  }
}

console.log(`\n${ko ? 'DES TESTS ÉCHOUENT' : 'TOUT PASSE'} — ${n} vérifications, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
