// Transport du Party Game de Précision : un socket, du JSON. Aucune règle ici —
// le serveur génère les cibles, tient les timers et calcule les précisions.
// ?server=ws://localhost:8145 permet de tester contre un serveur local.
//
// Le transport lui-même — connexion, présence du joueur, perte de connexion
// (`lost`) — est commun aux jeux : games/shared/game-net.js. Même API `NET`
// qu'avant (connect, on, send, dispatch, ws).
const WS_URL = new URLSearchParams(location.search).get('server')
  || 'wss://precision-server.onrender.com';

const NET = GameNet.create({ url: WS_URL });
