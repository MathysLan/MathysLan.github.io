// Client du morpion multijoueur.
// Règle d'or : AUCUNE logique de jeu ici. On envoie des intentions
// ({ action: 'play', index }), le serveur valide et renvoie l'état complet.
// Le front ne fait que deux choses : afficher l'état, transmettre les clics.

const WS_URL = 'wss://morpion-server-eygy.onrender.com';

let ws = null;
let state = null; // dernier état reçu du serveur - la seule vérité affichée

// --- transport -------------------------------------------------------------

function connect() {
  return new Promise((resolve, reject) => {
    if (ws && ws.readyState === WebSocket.OPEN) return resolve();
    ws = new WebSocket(WS_URL);
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error('serveur injoignable - il tourne ?'));
    ws.onclose = () => { if (state) showError('connexion au serveur perdue'); };
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'state') { state = msg; showError(''); render(); }
      else if (msg.type === 'error') showError(msg.message);
    };
  });
}

const send = (obj) => ws.send(JSON.stringify(obj));

async function host() {
  try { await connect(); send({ action: 'join' }); }
  catch (err) { showError(err.message); }
}

async function join(code) {
  if (!code.trim()) return showError('rentre un code de room');
  try { await connect(); send({ action: 'join', code }); }
  catch (err) { showError(err.message); }
}

const play = (index) => send({ action: 'play', index });

// --- rendu -----------------------------------------------------------------

const $ = (id) => document.getElementById(id);
const cells = [];

// La grille est construite une fois ; ensuite on ne fait que la mettre à jour.
for (let i = 0; i < 9; i++) {
  const btn = document.createElement('button');
  btn.className = 'cell';
  btn.addEventListener('click', () => play(i));
  $('board').appendChild(btn);
  cells.push(btn);
}

function render() {
  $('home').hidden = true;
  $('game').hidden = false;
  $('room-code').textContent = state.code;
  $('you').textContent = state.you;

  state.board.forEach((mark, i) => {
    const cell = cells[i];
    cell.textContent = mark === 'X' ? '✕' : mark === 'O' ? '◯' : '';
    cell.className = 'cell' + (mark ? ' ' + mark : '');
    if (state.line && state.line.includes(i)) cell.classList.add('win');
    // On désactive juste pour l'ergonomie : la vraie validation est côté serveur.
    cell.disabled = state.status !== 'playing' || state.turn !== state.you || mark !== null;
  });

  $('status').textContent = statusText();
}

function statusText() {
  if (state.status === 'waiting') return `en attente du joueur O - partage le code ${state.code}`;
  if (state.status === 'playing') return state.turn === state.you ? 'à toi de jouer' : "l'adversaire joue…";
  if (state.winner === 'draw') return 'égalité. 0 rows returned.';
  return state.winner === state.you ? 'gagné. GG ✔' : 'perdu. ROLLBACK et rejoue ?';
}

const showError = (msg) => { $('error').textContent = msg ? '> ' + msg : ''; };

// --- boutons de l'accueil --------------------------------------------------

$('host').addEventListener('click', host);
$('join').addEventListener('click', () => join($('code-input').value));
$('code-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') join($('code-input').value);
});
