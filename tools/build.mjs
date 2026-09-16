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

function buildSitemap() {
  const games = loadData('data/games.js', 'GAMES').filter((g) => g.href);
  const urls = [
    { loc: `${SITE}/`, paths: ['index.html', 'css', 'js', 'data', 'assets'] },
    ...games.map((g) => ({ loc: `${SITE}/${g.href}`, paths: [g.href] })),
  ];
  const body = urls.map((u) =>
    `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${lastmod(u.paths)}</lastmod>\n  </url>`).join('\n');
  emit('sitemap.xml',
    `<?xml version="1.0" encoding="UTF-8"?>\n`
    + `<!-- Généré par tools/build.mjs depuis data/games.js : ne pas éditer à la main. -->\n`
    + `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`);
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

function buildIndex() {
  const S = loadBrowserScripts();
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
buildIndex();
if (!process.argv.includes('--no-css')) buildTailwind();
// Le sitemap n'est pas vérifié en --check : ses dates dépendent du commit
// lui-même (un fichier à jour avant commit ne l'est plus juste après).
if (!CHECK) buildSitemap();

if (stale.length) {
  console.error(`\nFichiers générés périmés : ${stale.join(', ')}\n→ lancer « node tools/build.mjs » puis commiter.`);
  process.exit(1);
}
console.log('OK');
