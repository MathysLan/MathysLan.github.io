// Transport de Faux Témoin : un socket, du JSON. Aucune règle ici —
// temoin-server décide de tout (tapissage, rôles, phases, points) ; on
// transmet et on affiche.
//
// Quel serveur ? Même convention que les autres jeux (?server= d'abord, sinon
// la production) : une page ouverte EN LOCAL (fichier, ou servie par
// localhost / 127.0.0.1) vise le serveur local ; servie par le portfolio
// (GitHub Pages), elle vise Render (wss://temoin-server.onrender.com, déployé
// par Mathys le 2026-10-06, redéployé à chaque push sur main).
//   ?server=ws://localhost:8096   force un serveur, partout
//
// Le transport lui-même — connexion, présence du joueur, perte de connexion
// (`lost`) — est commun aux jeux : games/shared/game-net.js.
const EN_LOCAL = location.protocol === 'file:'
  || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

const WS_URL = new URLSearchParams(location.search).get('server')
  || (EN_LOCAL ? 'ws://localhost:8096' : 'wss://temoin-server.onrender.com');

const NET = GameNet.create({ url: WS_URL });
