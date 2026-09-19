// Génération des fichiers dérivés du portfolio. Node ≥ 18, AUCUNE dépendance.
//
//   node tools/build.mjs           régénère tout
//   node tools/build.mjs --check   ne réécrit rien : échoue si un fichier
//                                  généré n'est plus à jour (utilisé en CI)
//
// Le site reste un site statique servi tel quel par GitHub Pages : ce script ne
// produit pas de dossier dist/, il met à jour des fichiers du dépôt, qu'on
// commite comme le reste.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://mathyslan.github.io';
const CHECK = process.argv.includes('--check');

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// Charge un fichier data/*.js (des `const X = [...]` pour le navigateur) sans
// le modifier : on l'exécute dans un bac à sable et on récupère la constante.
function loadData(file, name) {
  const ctx = {};
  vm.runInNewContext(`${read(file)}\n;this.${name} = ${name};`, ctx, { filename: file });
  return ctx[name];
}

// Écrit un fichier généré, ou en mode --check signale qu'il est périmé.
const stale = [];
function emit(file, content) {
  const full = path.join(ROOT, file);
  const current = fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null;
  // Comparaison insensible aux fins de ligne : git peut les convertir sous Windows.
  const norm = (s) => s && s.replace(/\r\n/g, '\n');
  if (norm(current) === norm(content)) return;
  if (CHECK) { stale.push(file); return; }
  fs.writeFileSync(full, content);
  console.log(`  écrit : ${file}`);
}

// ---------------------------------------------------------------- sitemap.xml
// La liste des jeux vient de data/games.js : un jeu ajouté au carousel entre au
// sitemap sans qu'on y pense. Date = dernier commit touchant la page, ou
// aujourd'hui si elle a des modifications pas encore commitées.
function lastmod(paths) {
  const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
  try {
    if (git(['status', '--porcelain', '--', ...paths])) return new Date().toISOString().slice(0, 10);
    return git(['log', '-1', '--format=%cs', '--', ...paths]) || new Date().toISOString().slice(0, 10);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function sitemapURLs() {
  const games = loadData('data/games.js', 'GAMES').filter((g) => g.href);
  return [
    { loc: `${SITE}/`, paths: ['index.html', 'css', 'js', 'data', 'assets'] },
    // Une page de jeu dépend AUSSI du socle commun : sans games/shared, une
    // refonte du focus clavier ne bougerait la date d'aucune des cinq pages.
    ...games.map((g) => ({ loc: `${SITE}/${g.href}`, paths: [g.href, 'games/shared'] })),
  ];
}

function buildSitemap() {
  const body = sitemapURLs().map((u) =>
    `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${lastmod(u.paths)}</lastmod>\n  </url>`).join('\n');
  emit('sitemap.xml',
    `<?xml version="1.0" encoding="UTF-8"?>\n`
    + `<!-- Généré par tools/build.mjs depuis data/games.js : ne pas éditer à la main. -->\n`
    + `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`);
}

// En --check on ne peut pas comparer le fichier entier : <lastmod> vaut « la
// date du dernier commit touchant la page », donc un sitemap juste avant un
// commit ne l'est plus juste après — la CI échouerait à chaque fois.
// Ce qui PEUT périmer en silence, en revanche, c'est la LISTE : un jeu ajouté
// à data/games.js et un build oublié, et la page n'entre jamais au sitemap.
// On vérifie donc les <loc>, dans l'ordre, et on laisse les dates tranquilles.
function checkSitemap() {
  const want = sitemapURLs().map((u) => u.loc);
  const file = 'sitemap.xml';
  const have = [...read(file).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  if (have.join('\n') === want.join('\n')) return;
  stale.push(file);
  const only = (a, b) => a.filter((x) => !b.includes(x));
  const missing = only(want, have), extra = only(have, want);
  if (missing.length) console.error(`  sitemap.xml : URL manquantes → ${missing.join(', ')}`);
  if (extra.length) console.error(`  sitemap.xml : URL en trop → ${extra.join(', ')}`);
  if (!missing.length && !extra.length) console.error('  sitemap.xml : les URL ne sont plus dans le même ordre');
}

// --------------------------------------------- chemins publiables par Pages
// GitHub Pages passe le dépôt par Jekyll, qui IGNORE tout fichier ou dossier
// dont le nom commence par « _ » : il n'est jamais publié, et la page qui le
// référence reçoit un 404 — en silence, puisque en local le fichier existe.
// C'est arrivé le 2026-09-17 avec games/_shared/game-ui.css : les cinq jeux se
// sont retrouvés SANS socle commun en production (code de room redevenu un gros
// bouton plein, plus d'anneau de focus, polices en repli), alors que tout était
// vert en local. Le dossier s'appelle games/shared/ depuis, et ce garde-fou
// refuse désormais le cas au build plutôt que de le laisser filer.
function htmlFiles(dir = '.', found = []) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const rel = dir === '.' ? e.name : `${dir}/${e.name}`;
    if (e.isDirectory()) htmlFiles(rel, found);
    else if (e.name.endsWith('.html')) found.push(rel);
  }
  return found;
}

function checkPagesPaths() {
  const bad = [];
  for (const f of htmlFiles()) {
    for (const m of read(f).matchAll(/(?:href|src)="([^"]+)"/g)) {
      const p = m[1];
      if (/^(?:[a-z]+:|\/\/|#)/i.test(p)) continue;              // externe, data:, ancre
      if (p.split('/').some((seg) => seg.startsWith('_'))) bad.push(`${f} → ${p}`);
    }
  }
  if (bad.length) {
    throw new Error('chemins que Jekyll refusera de publier (nom commençant par « _ ») :\n  '
      + bad.join('\n  ') + '\n→ renommer sans le tiret bas.');
  }
}

// ------------------------------------------- data/games.manifest.json
// Le contrat MACHINE des jeux, pour le Game Hub et le randomizer. Il est
// GÉNÉRÉ depuis le bloc `hub` de data/games.js, qui reste la seule source de
// vérité : on ne veut pas deux catalogues qui divergent en silence.
//
// Le validateur ci-dessous n'est pas de la décoration. Il tient trois
// promesses qu'un commentaire ne tiendrait pas :
//
//   1. SCHÉMA FERMÉ (`CLES`). Toute clé inconnue fait échouer le build. C'est
//      ce qui empêche un identifiant de CONTENU — une situation, une vidéo, un
//      thème — d'arriver un jour dans le manifest. Le Hub transporte
//      l'historique de contenu ; il ne l'interprète ni ne le fabrique, et le
//      serveur du jeu reste seul maître de ce qu'il a consommé.
//   2. Un jeu « live » SANS bloc `hub` fait échouer le build. Ajouter un jeu au
//      carousel sans le déclarer au Hub devient donc impossible.
//   3. Vocabulaires fermés pour `needs` et `categories` : une faute de frappe
//      (« micro » au lieu de « mic ») créerait un filtre que rien ne satisfait,
//      en silence. C'est le genre de panne qu'on ne découvre qu'en soirée.
const CLES = {
  commun: ['mode', 'players', 'minutes', 'needs', 'categories', 'content', 'replay', 'handoff'],
  online: ['server', 'health', 'join'],
};
// `needs` est DÉCLARATIF : le Hub compare ce que les joueurs annoncent, il ne
// teste jamais rien lui-même et ne demandera JAMAIS la permission micro. C'est
// le jeu qui demande et qui vérifie, à l'entrée.
const NEEDS = ['mic', 'cam', 'consent'];
const CATEGORIES = ['classique', 'solo', 'reflexe', 'observation', 'bluff',
  'discussion', 'deduction', 'creatif', 'ambiance', 'sang-froid', 'sport'];

function checkHub(g) {
  const err = (m) => { throw new Error(`data/games.js — ${g.id} : ${m}`); };
  const h = g.hub;
  if (g.status === 'live' && !h) err('jeu « live » sans bloc hub (le Hub ne peut pas le proposer)');
  if (!h) return;
  if (g.status !== 'live') err('bloc hub sur un jeu qui n\'est pas « live »');

  if (h.mode !== 'online' && h.mode !== 'local') err(`mode inconnu : ${h.mode}`);
  const permis = [...CLES.commun, ...(h.mode === 'online' ? CLES.online : [])];
  for (const k of Object.keys(h)) {
    if (!permis.includes(k)) err(`clé interdite dans hub : ${k} — le schéma est fermé`);
  }
  for (const k of permis) if (!(k in h)) err(`clé manquante : ${k}`);

  // Bornes : min ≤ max, entiers positifs. Un max à 0 sortirait le jeu de tous
  // les tirages sans rien dire à personne.
  for (const k of ['players', 'minutes']) {
    const v = h[k];
    if (!v || typeof v.min !== 'number' || typeof v.max !== 'number') err(`${k} : { min, max } attendus`);
    if (!Number.isInteger(v.min) || !Number.isInteger(v.max)) err(`${k} : entiers attendus`);
    if (v.min < 1 || v.max < v.min) err(`${k} : bornes incohérentes (${v.min}..${v.max})`);
  }
  // ⚠️ `minutes` se lit AU RÉGLAGE PAR DÉFAUT du MJ, et c'est `max` que le
  // filtre de durée compare — jamais `min`. Un « ≤ 10 min » écarte donc un jeu
  // dont le max est 12 : rien d'implicite. Le MJ peut allonger une fois dans
  // la partie, et le Hub ne surveille pas les réglages d'un jeu.

  if (!Array.isArray(h.needs)) err('needs : tableau attendu');
  for (const n of h.needs) if (!NEEDS.includes(n)) err(`capacité inconnue : ${n} (connues : ${NEEDS.join(', ')})`);
  if (!Array.isArray(h.categories) || !h.categories.length) err('categories : tableau non vide attendu');
  for (const c of h.categories) if (!CATEGORIES.includes(c)) err(`catégorie inconnue : ${c}`);

  if (typeof h.content !== 'boolean' || typeof h.replay !== 'boolean' || typeof h.handoff !== 'boolean') err('content, replay et handoff : booléens attendus');

  if (h.mode === 'online') {
    if (!/^wss:\/\//.test(h.server)) err('server : wss:// attendu');
    if (!/^https:\/\//.test(h.health)) err('health : https:// attendu');
    if (h.join !== 'v1' && h.join !== 'anon') err(`dialecte join inconnu : ${h.join}`);
    if (!g.href) err('jeu en ligne sans href');
  } else if (!g.action) {
    err('jeu local sans action');
  }
}

function buildManifest() {
  const games = loadData('data/games.js', 'GAMES');
  games.forEach(checkHub);
  const out = games.filter((g) => g.hub).map((g) => ({
    id: g.id,
    title: g.title,
    emoji: g.emoji,
    ...(g.href ? { url: g.href } : { action: g.action }),
    mode: g.hub.mode,
    players: g.hub.players,
    minutes: g.hub.minutes,
    needs: g.hub.needs,
    categories: g.hub.categories,
    ...(g.hub.mode === 'online'
      ? { server: g.hub.server, health: g.hub.health, join: g.hub.join }
      : {}),
    content: g.hub.content,
    replay: g.hub.replay,
    handoff: g.hub.handoff,
  }));
  emit('data/games.manifest.json', JSON.stringify({
    // `version` est celle du SCHÉMA, pas du catalogue : le Hub refusera un
    // manifest dont la majeure ne lui parle pas, plutôt que de deviner.
    version: 1,
    note: 'Généré par tools/build.mjs depuis data/games.js — ne pas éditer à la main.',
    minutesBasis: 'reglage par defaut du MJ ; le filtre de duree compare max',
    games: out,
  }, null, 2) + '\n');
}

// ------------------------------------------------- pré-rendu dans index.html
// Les données (data/*.js) et les gabarits (js/templates.js) sont chargés dans
// UN même bac à sable, comme le navigateur les charge dans la page : les
// gabarits appelés ici sont exactement ceux qu'appelle le navigateur.
const PRERENDER_LANG = 'fr';   // langue par défaut de la page

function loadBrowserScripts() {
  const files = ['data/projects.js', 'data/games.js', 'data/favgames.js', 'js/templates.js'];
  const code = files.map((f) => read(f)).join('\n;\n')
    + '\n;({ PROJECTS, GAMES, FAV_GAMES, projectCellHTML, projectSheetHTML, gameSlideHTML, favGameHTML });';
  return vm.runInNewContext(code, {}, { filename: 'data+templates' });
}

// Remplace le contenu d'un bloc <!-- build:nom --> … <!-- /build:nom -->. Le
// bloc contient un seul conteneur : on garde sa balise ouvrante telle qu'elle
// est écrite dans index.html (attributs éditables à la main), on y pose
// data-lang, et on régénère son contenu.
function fillBlock(src, name, inner) {
  const re = new RegExp(`([ \\t]*)<!-- build:${name} -->[\\s\\S]*?<!-- /build:${name} -->`);
  const m = src.match(re);
  if (!m) throw new Error(`bloc <!-- build:${name} --> introuvable dans index.html`);
  const indent = m[1];
  const open = m[0].match(/<div\b[^>]*>/);
  if (!open) throw new Error(`bloc ${name} : conteneur <div> introuvable`);
  const tag = open[0].replace(/\sdata-lang="[^"]*"/, '').replace(/>$/, ` data-lang="${PRERENDER_LANG}">`);
  const block = `${indent}<!-- build:${name} -->\n${indent}${tag}${inner}\n${indent}</div>\n${indent}<!-- /build:${name} -->`;
  return src.replace(re, () => block);
}

// Toute image locale citée dans les données doit exister : une faute de frappe
// dans un chemin casse le build plutôt que d'afficher un trou sur le site.
function checkAssets(S) {
  const local = (p) => p && !/^https?:\/\//.test(p);
  const refs = [
    ...S.PROJECTS.flatMap((p) => [p.cover, ...(p.images || []).map((i) => i.src)]),
    ...S.FAV_GAMES.map((g) => g.img),
  ].filter(local);
  const missing = refs.filter((p) => !fs.existsSync(path.join(ROOT, p)));
  if (missing.length) throw new Error(`images introuvables :\n  ${missing.join('\n  ')}`);
}

function buildIndex() {
  const S = loadBrowserScripts();
  checkAssets(S);
  const L = PRERENDER_LANG;
  let src = read('index.html');
  src = fillBlock(src, 'projects', S.PROJECTS.map((p, i) => S.projectCellHTML(p, i, L)).join(''));
  src = fillBlock(src, 'sheets', S.PROJECTS.map((p) => S.projectSheetHTML(p, L)).join(''));
  src = fillBlock(src, 'games', S.GAMES.map((g, i) => S.gameSlideHTML(g, i, L)).join(''));
  src = fillBlock(src, 'favgames', S.FAV_GAMES.map((g) => S.favGameHTML(g, L)).join(''));
  emit('index.html', src);
}

// ------------------------------------------------------------ css/tailwind.css
// Seule étape qui passe par npm : `npx` télécharge Tailwind (version figée) le
// temps de la compilation. Rien n'est ajouté au dépôt (pas de package.json, pas
// de node_modules). Version = celle que servait cdn.tailwindcss.com, pour un
// rendu identique. À relancer après avoir ajouté une classe Tailwind au HTML ou
// aux gabarits JS ; la CI le signale si on oublie.
const TAILWIND = 'tailwindcss@3.4.17';

function buildTailwind() {
  const out = path.join(ROOT, 'tools', '.tailwind.tmp.css');
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  try {
    execFileSync(npx, ['--yes', TAILWIND,
      '-c', 'tools/tailwind.config.cjs', '-i', 'tools/tailwind.in.css', '-o', out, '--minify'],
      { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'], shell: process.platform === 'win32' });
  } catch (e) {
    throw new Error(`compilation Tailwind impossible (npx et le réseau sont nécessaires) :\n${e.stderr || e.message}`);
  }
  const css = fs.readFileSync(out, 'utf8');
  fs.rmSync(out);
  emit('css/tailwind.css', `/* Généré par tools/build.mjs (${TAILWIND}) : ne pas éditer à la main. */\n${css.trim()}\n`);
}

// ----------------------------------------------------------------------- main
console.log(CHECK ? 'Vérification des fichiers générés…' : 'Génération…');
try {
  checkPagesPaths();
  buildManifest();
  buildIndex();
  if (!process.argv.includes('--no-css')) buildTailwind();
} catch (e) {
  console.error(`\nÉCHEC : ${e.message}`);
  process.exit(1);
}
if (CHECK) checkSitemap(); else buildSitemap();

if (stale.length) {
  console.error(`\nFichiers générés périmés : ${stale.join(', ')}\n→ lancer « node tools/build.mjs » puis commiter.`);
  process.exit(1);
}
console.log('OK');
