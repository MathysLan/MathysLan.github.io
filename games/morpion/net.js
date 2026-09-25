// Client du morpion multijoueur.
// Règle d'or : AUCUNE logique de jeu ici. On envoie des intentions
// ({ action: 'play', index }), le serveur valide et renvoie l'état complet.
// Le front ne fait que deux choses : afficher l'état, transmettre les clics.

// ?server=ws://localhost:8080 permet de tester contre un serveur local, comme
// les quatre autres jeux. Le morpion était le seul à avoir l'URL en dur : rien
// ne le justifiait, c'est la même forme de client.
const WS_URL = new URLSearchParams(location.search).get('server')
  || 'wss://morpion-server-eygy.onrender.com';

let state = null; // dernier état reçu du serveur - la seule vérité affichée

// --- transport -------------------------------------------------------------
// Commun aux jeux : games/shared/game-net.js (connexion, présence du joueur,
// perte de connexion). Même phrase d'erreur réseau que les autres jeux : un
// serveur Render endormi met ~30 s à répondre.
const NET = GameNet.create({ url: WS_URL });

NET.on('state', (msg) => { state = msg; showError(''); render(); relais(); });
NET.on('error', (msg) => {
  showError(msg.message);
  // Entrée lancée par le Hub et refusée (room introuvable, pleine…) : on le
  // dit au Hub, sinon le groupe attend un joueur qui n'arrivera jamais.
  if (lien && viaHub && !state) { viaHub = false; lien.failed('JOIN', msg.message); }
  // L'autre joueur est parti : morpion-server a fermé la room, la partie
  // s'arrête là. Pour le Hub, elle est finie.
  else if (lien && state && /adversaire est parti/.test(msg.message)) finie();
});
NET.on('lost', perdu);

async function envoyer(obj) {
  try { await NET.connect(); NET.send(obj); }
  catch (err) {
    showError(err.message);
    if (lien && viaHub && !state) { viaHub = false; lien.failed('UNREACHABLE', err.message); }
  }
}

// Pas de pseudo ni d'avatar : morpion-server ne lit que `code` (voir index.html).
const host = () => envoyer({ action: 'join' });

function join(code) {
  if (!code.trim()) return showError('rentre un code de room');
  return envoyer({ action: 'join', code });
}

const play = (index) => NET.send({ action: 'play', index });

// --- lancé par le Game Hub -------------------------------------------------
// Si la page a été ouverte par le Hub, un billet dit si l'on CRÉE la partie
// (l'hôte du lancement) ou si l'on REJOINT le code du groupe. Dans les deux cas
// on passe par le chemin normal de cette page — host() ou join(code) — donc
// par le même `{ action: 'join' }` qu'un clic : ni pseudo, ni avatar. Le profil
// ne sert qu'à se présenter au HUB (même player.id), jamais à morpion-server.
// ⚠️ Sans billet, `lien` vaut null et la page marche exactement comme avant.
let viaHub = false;            // le join en cours vient du Hub
let codeDeclare = null;        // le code déjà annoncé au Hub (une seule fois)
let demarre = false;           // `started` déjà envoyé
const lien = window.HubHandoff ? HubHandoff.start({
  gameId: 'morpion',
  join: (code) => { viaHub = true; return code ? join(code) : host(); },
}) : null;

// À chaque état reçu : ce que le Hub doit savoir. Le Morpion se joue à deux,
// donc la room passe à `playing` à l'instant où l'invité y entre — c'est
// l'hôte qui le déclare au Hub (`started` n'est pris en compte que de lui).
function relais() {
  if (!lien) return;
  if (!codeDeclare) { codeDeclare = state.code; viaHub = false; lien.roomReady(state.code); }
  if (state.status === 'playing' && !demarre) { demarre = true; lien.started(); }
  if (state.status === 'over') finie();
}

function finie() {
  lien.ended();
  $('to-hub').hidden = false;
}

// --- connexion perdue --------------------------------------------------------
// Le Morpion ferme sa room dès qu'un joueur part (règle du serveur, inchangée) :
// après une perte, il n'y a PLUS de room où revenir — ni en attente, ni en
// partie. Donc aucune reconnexion automatique (elle échouerait toujours) : on
// le dit, et le joueur recrée une partie ou revient à l'accueil. Jamais le
// plateau ou l'attente d'avant à l'écran : ils mentiraient.
function perdu() {
  if (!state) return;                          // pas encore dans une room
  const { status, code } = state;
  state = null;
  showError('');
  $('home').hidden = true; $('game').hidden = true; $('lost').hidden = false;
  $('lost-text').textContent = status === 'waiting'
    ? `Connexion perdue : ta partie en attente (code ${code}) a été fermée. Crée-en une nouvelle et envoie le nouveau code.`
    : status === 'over'
      ? 'Connexion perdue. La partie était terminée.'
      : 'Connexion perdue pendant la partie : elle s\'arrête là — le Morpion se joue à deux.';
  if (!lien) return;
  $('lost-hub').hidden = false;
  // Seule la room du lancement concerne le Hub : une partie recréée ensuite à
  // la main (« Créer une nouvelle partie ») ne le regarde plus.
  if (code !== lien.code()) return;
  // Pour le Hub : une room perdue AVANT que l'invité n'y entre est un
  // lancement raté (hub-handoff en fait une annulation quand l'hôte avait déjà
  // donné son code) ; une partie commencée est une partie finie.
  if (status === 'waiting') lien.failed('UNREACHABLE', 'connexion perdue');
  else lien.ended();
}

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
  $('lost').hidden = true;
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

// Après une connexion perdue : une nouvelle partie (nouveau code), ou l'accueil.
$('lost-new').addEventListener('click', () => { $('lost-hub').hidden = true; $('to-hub').hidden = true; host(); });
$('lost-home').addEventListener('click', () => { $('lost').hidden = true; $('home').hidden = false; });
$('code-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') join($('code-input').value);
});
