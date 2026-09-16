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

// ----------------------------------------------------------------------- main
console.log(CHECK ? 'Vérification des fichiers générés…' : 'Génération…');
// Le sitemap n'est pas vérifié en --check : ses dates dépendent du commit
// lui-même (un fichier à jour avant commit ne l'est plus juste après).
if (!CHECK) buildSitemap();

if (stale.length) {
  console.error(`\nFichiers générés périmés : ${stale.join(', ')}\n→ lancer « node tools/build.mjs » puis commiter.`);
  process.exit(1);
}
console.log('OK');
