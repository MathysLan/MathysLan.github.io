// Client du morpion multijoueur.
// Règle d'or : AUCUNE logique de jeu ici. On envoie des intentions
// ({ action: 'play', index }), le serveur valide et renvoie l'état complet.
// Le front ne fait que deux choses : afficher l'état, transmettre les clics.

// ?server=ws://localhost:8080 permet de tester contre un serveur local, comme
// les quatre autres jeux. Le morpion était le seul à avoir l'URL en dur : rien
// ne le justifiait, c'est la même forme de client.
const WS_URL = new URLSearchParams(location.search).get('server')
  || 'wss://morpion-server-eygy.onrender.com';

let ws = null;
let state = null; // dernier état reçu du serveur - la seule vérité affichée

// --- transport -------------------------------------------------------------

function connect() {
  return new Promise((resolve, reject) => {
    if (ws && ws.readyState === WebSocket.OPEN) return resolve();
    ws = new WebSocket(WS_URL);
    ws.onopen = () => resolve();
    // Même phrase que les quatre autres jeux : un serveur Render endormi met
    // ~30 s à répondre, et « il tourne ? » n'aide pas un joueur.
    ws.onerror = () => reject(new Error('serveur injoignable (réveil Render ~30 s ? réessaie)'));
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

// Nom de case pour les lecteurs d'écran : le contenu visible est un symbole
// (✕/◯) ou rien du tout, donc les neuf boutons s'annonçaient « bouton »,
// « bouton »… sans qu'on sache lequel. On dit la position, puis l'état.
const cellName = (i, mark) =>
  `ligne ${Math.floor(i / 3) + 1}, colonne ${(i % 3) + 1}` +
  (mark === 'X' ? ' — croix' : mark === 'O' ? ' — rond' : ' — vide');

// La grille est construite une fois ; ensuite on ne fait que la mettre à jour.
for (let i = 0; i < 9; i++) {
  const btn = document.createElement('button');
  btn.className = 'cell';
  btn.setAttribute('aria-label', cellName(i, null));
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
    cell.setAttribute('aria-label', cellName(i, mark));
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

// Copie du code de room, comme dans les quatre autres jeux. Un échec du
// presse-papiers se DIT : sans ça, le clic ne fait rien du tout et le joueur
// croit que le code est copié.
$('room-code').addEventListener('click', async () => {
  const hint = $('code-hint');
  const back = () => setTimeout(() => { hint.textContent = 'clique sur le code pour le copier'; }, 2000);
  try {
    await navigator.clipboard.writeText($('room-code').textContent.trim());
    hint.textContent = 'code copié ✔';
  } catch (_) {
    hint.textContent = 'copie impossible — recopie le code à la main';
  }
  back();
});

// --- boutons de l'accueil --------------------------------------------------

$('host').addEventListener('click', host);
$('join').addEventListener('click', () => join($('code-input').value));
$('code-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') join($('code-input').value);
});
