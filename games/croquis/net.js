// Transport de Croquis : un socket, du JSON. Aucune règle ici — croquis-server
// décide de tout (qui dessine, quel tour, quels traits sont valides) ; on
// transmet et on affiche.
//
// Quel serveur ? Même convention que les autres jeux (?server= d'abord, sinon
// la production) : une page ouverte EN LOCAL (fichier, ou servie par
// localhost / 127.0.0.1) vise le serveur local ; servie par le portfolio
// (GitHub Pages), elle viserait Render.
//   ?server=ws://localhost:8095   force un serveur, partout
// ⚠️ croquis-server n'est PAS encore déployé : l'URL de production ci-dessous
// est celle que Render donnera au service `croquis-server` (render.yaml du
// dépôt) ; à recouper le jour du déploiement.
//
// Le transport lui-même — connexion, présence du joueur, perte de connexion
// (`lost`) — est commun aux jeux : games/shared/game-net.js.
const EN_LOCAL = location.protocol === 'file:'
  || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

const WS_URL = new URLSearchParams(location.search).get('server')
  || (EN_LOCAL ? 'ws://localhost:8095' : 'wss://croquis-server.onrender.com');

const NET = GameNet.create({ url: WS_URL });
