// Transport du Jeu du Demi-Cercle : un socket, du JSON. Aucune règle de jeu ici -
// le serveur décide, on transmet et on affiche.
// ?server=ws://localhost:8080 permet de tester contre un serveur local.
const WS_URL = new URLSearchParams(location.search).get('server')
  || 'wss://demicercle-server.onrender.com';

const NET = {
  ws: null,
  handlers: {},

  connect() {
    return new Promise((resolve, reject) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) return resolve();
      const ws = new WebSocket(WS_URL);
      ws.onopen = () => { this.ws = ws; resolve(); };
      ws.onerror = () => reject(new Error('serveur injoignable (réveil Render ~30 s ? réessaie)'));
      ws.onclose = () => this.dispatch({ type: 'closed' });
      ws.onmessage = (e) => this.dispatch(JSON.parse(e.data));
    });
  },

  dispatch(msg) { (this.handlers[msg.type] || (() => {}))(msg); },
  on(type, fn) { this.handlers[type] = fn; },
  send(obj) { this.ws.send(JSON.stringify(obj)); },
};
