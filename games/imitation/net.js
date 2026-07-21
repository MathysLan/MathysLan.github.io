// Transport du jeu d'imitation : un socket, du JSON, des frames binaires.
// Aucune règle de jeu ici - le serveur décide, on transmet et on affiche.

// ?server=ws://localhost:8080 permet de tester contre un serveur local.
const WS_URL = new URLSearchParams(location.search).get('server')
  || 'wss://imitation-server.onrender.com';

const NET = {
  ws: null,
  handlers: {},   // type de message → fonction
  onBinary: null, // la frame binaire qui suit un message 'listen'

  connect() {
    return new Promise((resolve, reject) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) return resolve();
      const ws = new WebSocket(WS_URL);
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => { this.ws = ws; resolve(); };
      ws.onerror = () => reject(new Error('serveur injoignable (réveil Render ~30 s ? réessaie)'));
      ws.onclose = () => this.dispatch({ type: 'closed' });
      ws.onmessage = (e) => {
        if (typeof e.data === 'string') this.dispatch(JSON.parse(e.data));
        else if (this.onBinary) this.onBinary(e.data);
      };
    });
  },

  dispatch(msg) { (this.handlers[msg.type] || (() => {}))(msg); },
  on(type, fn) { this.handlers[type] = fn; },
  send(obj) { this.ws.send(JSON.stringify(obj)); },

  // Une méta JSON puis UNE frame binaire : l'ordre des frames est garanti par WebSocket.
  async sendAudio(blob) {
    this.send({ action: 'audio-meta', mime: blob.type, size: blob.size });
    this.ws.send(await blob.arrayBuffer());
  },
};
