// Tailwind compilé une fois pour toutes dans css/tailwind.css (tools/build.mjs),
// à la place du script cdn.tailwindcss.com qui générait les styles dans le
// navigateur à chaque visite.
//
// Configuration par défaut, comme le CDN : on ne change rien au rendu. Seuls
// les fichiers qui portent des classes Tailwind sont scannés — y compris les
// gabarits JS et les données, où des classes sont écrites dans des chaînes.
module.exports = {
  content: [
    './index.html',
    './js/**/*.js',
    './data/**/*.js',
  ],
};
