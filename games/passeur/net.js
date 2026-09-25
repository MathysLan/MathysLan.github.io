// Transport du Passeur : un socket, du JSON. Aucune règle ici — le serveur
// décide (situations, barèmes, chrono, scores), on transmet et on affiche.
// ?server=ws://localhost:8090 permet de tester contre un serveur local.
//
// Le transport lui-même — connexion, présence du joueur, perte de connexion
// (`lost`) — est commun aux jeux : games/shared/game-net.js. Même API `NET`
// qu'avant (connect, on, send, dispatch, ws).
const WS_URL = new URLSearchParams(location.search).get('server')
  || 'wss://passeur-server.onrender.com';

const NET = GameNet.create({ url: WS_URL });
