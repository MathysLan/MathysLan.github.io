// Transport de Croquis : un socket, du JSON. Aucune règle ici — croquis-server
// décide de tout (qui dessine, quel tour, quels traits sont valides) ; on
// transmet et on affiche.
//
// Quel serveur ? Même convention que les autres jeux (?server= d'abord, sinon
// la production) : une page ouverte EN LOCAL (fichier, ou servie par
// localhost / 127.0.0.1) vise le serveur local ; servie par le portfolio
// (GitHub Pages), elle vise Render (wss://croquis-server.onrender.com,
// déployé et vérifié le 2026-10-04 : join, partie, catalogue V1).
//   ?server=ws://localhost:8095   force un serveur, partout
//
// Le transport lui-même — connexion, présence du joueur, perte de connexion
// (`lost`) — est commun aux jeux : games/shared/game-net.js.
const EN_LOCAL = location.protocol === 'file:'
  || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

const WS_URL = new URLSearchParams(location.search).get('server')
  || (EN_LOCAL ? 'ws://localhost:8095' : 'wss://croquis-server.onrender.com');

const NET = GameNet.create({ url: WS_URL });
