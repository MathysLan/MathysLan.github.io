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
    // Une page de jeu dépend AUSSI du socle commun : sans games/_shared, une
    // refonte du focus clavier ne bougerait la date d'aucune des cinq pages.
    ...games.map((g) => ({ loc: `${SITE}/${g.href}`, paths: [g.href, 'games/_shared'] })),
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
