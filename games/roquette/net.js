// Transport du jeu à la roquette : un socket, du JSON. Aucune règle ici — le
// serveur décide de tout (le prompt, le temps, les mots, les vies) ; on
// transmet et on affiche.
//
// Quel serveur ? Même convention que les autres jeux (?server= d'abord, sinon
// la production), plus une chose : une page ouverte EN LOCAL (fichier, ou
// servie par localhost / 127.0.0.1) vise le serveur local, pour garder le
// développement tel qu'il marchait. Servie par le portfolio (GitHub Pages),
// elle vise Render.
//   ?server=ws://localhost:8094   force un serveur, partout
//
// Le transport lui-même — connexion, présence du joueur, perte de connexion
// (`lost`) — est commun aux jeux : games/shared/game-net.js.
const EN_LOCAL = location.protocol === 'file:'
  || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

const WS_URL = new URLSearchParams(location.search).get('server')
  || (EN_LOCAL ? 'ws://localhost:8094' : 'wss://roquette-server.onrender.com');

const NET = GameNet.create({ url: WS_URL });
