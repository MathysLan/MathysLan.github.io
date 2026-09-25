// Transport du jeu d'imitation : un socket, du JSON, des frames binaires.
// Aucune règle de jeu ici - le serveur décide, on transmet et on affiche.

// ?server=ws://localhost:8080 permet de tester contre un serveur local.
//
// Le transport lui-même — connexion, présence du joueur, perte de connexion
// (`lost`) — est commun aux jeux : games/shared/game-net.js. Même API `NET`
// qu'avant (connect, on, send, dispatch, ws).
const WS_URL = new URLSearchParams(location.search).get('server')
  || 'wss://imitation-server.onrender.com';

// binary : les prises audio passent en frames binaires (onBinary pour la
// frame qui suit un message « listen »).
const NET = GameNet.create({ url: WS_URL, binary: true });

// Une méta JSON puis UNE frame binaire : l'ordre des frames est garanti par WebSocket.
// (Le serveur accorde un sursis de présence dès audio-meta : pendant un envoi
// lent, nos réponses de présence attendent derrière ces octets.)
NET.sendAudio = async function (blob) {
  NET.send({ action: 'audio-meta', mime: blob.type, size: blob.size });
  const buf = await blob.arrayBuffer();
  if (NET.ws && NET.ws.readyState === 1) NET.ws.send(buf);
};
