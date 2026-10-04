// Jeux de la section carousel. Ajouter un jeu = ajouter un objet ici, rien d'autre.
// status: 'live' = jouable (href OU action), 'soon' = teaser à venir.
// Les champs *_en fournissent la version anglaise (repli : version française).
// code : dépôt public du code (serveur arbitre pour les jeux en ligne).
//
// hub : LE CONTRAT MACHINE, lu par le Game Hub et par le randomizer. Il est
//   généré tel quel dans data/games.manifest.json par tools/build.mjs — c'est
//   ce fichier-ci qui reste la source de vérité, jamais le JSON.
//   Trois règles, et tools/build.mjs fait échouer le build si l'une saute :
//
//   1. SCHÉMA FERMÉ. Aucune clé en dehors de la liste autorisée. C'est ce qui
//      empêche un identifiant de CONTENU (une situation, une vidéo, un thème)
//      d'atterrir un jour ici : le Hub transporte l'historique de contenu, il
//      ne l'interprète ni ne le fabrique. Le serveur du jeu reste seul maître
//      de ce qu'il a consommé.
//   2. minutes = { min, max } AU RÉGLAGE PAR DÉFAUT du MJ, et c'est le **max**
//      que le filtre de durée compare. Un « ≤ 10 min » écarte donc un jeu dont
//      le max est 12 : rien d'implicite. Le MJ peut toujours allonger une fois
//      dans la partie — le Hub ne surveille pas les réglages d'un jeu.
//   3. needs = DÉCLARATIF. Le Hub ne teste jamais une capacité : il ne fait que
//      comparer ce que les joueurs ont déclaré. Il ne demandera JAMAIS la
//      permission micro — c'est le jeu, et lui seul, qui demande et vérifie.
//
//   content / replay / handoff valent false tant que ce n'est pas VÉRIFIÉ.
//   handoff : la page du jeu sait être lancée par le Game Hub (billet de
//   lancement, games/shared/hub-handoff.js). Sans lui, le Hub tire le jeu mais
//   ne le lance pas. false veut donc dire « non supporté ou pas encore
//   vérifié » : dans les deux cas le Hub s'en passe.
//
//   hub: false (et non un bloc) = jeu jouable VOLONTAIREMENT tenu hors du Game
//   Hub : il est dans la section Jeux, pas dans le manifest, donc jamais tiré.
//   C'est un choix écrit, pas un oubli — un jeu « live » sans `hub` du tout
//   fait toujours échouer le build.
// arch : points d'architecture affichés dans la fiche « Architecture ». Des
//        faits vérifiables sur le code, pas du discours.
const GAMES = [
  {
    id: 'morpion',
    emoji: '⭕',
    accent: 'violet',
    title: 'Morpion',
    title_en: 'Tic-Tac-Toe',
    tagline: 'Le Hello World du réseau',
    tagline_en: 'The networking Hello World',
    desc: "Le classique en multijoueur temps réel : tu crées une partie, tu partages un code à 4 lettres, et c'est parti. Serveur Node arbitre - le client n'a aucune autorité.",
    desc_en: "The classic, real-time multiplayer: create a room, share a 4-letter code, and play. A Node server referees - the client has zero authority.",
    tags: ['en ligne', '2 joueurs', 'temps réel'],
    tags_en: ['online', '2 players', 'real-time'],
    stack: ['WebSocket', 'Node.js', 'Canvas'],
    code: 'https://github.com/MathysLan/morpion-server',
    arch: [
      "Serveur Node.js (ws) seul arbitre : le client n'envoie que son intention de jeu",
      "Règles isolées dans un moteur pur (engine.js), séparé du réseau",
      "Parties privées par code à 4 lettres (rooms)",
      "Front statique sur GitHub Pages, serveur hébergé sur Render",
    ],
    arch_en: [
      "Node.js (ws) server is the only referee: the client only sends its move intent",
      "Rules isolated in a pure engine (engine.js), separate from networking",
      "Private games through a 4-letter code (rooms)",
      "Static front on GitHub Pages, server hosted on Render",
    ],
    href: 'games/morpion/',
    status: 'live',
    hub: {
      mode: 'online',
      players: { min: 2, max: 2 },        // un duel : ni plus, ni moins
      minutes: { min: 1, max: 5 },
      needs: [],
      categories: ['classique'],
      server: 'wss://morpion-server-eygy.onrender.com',
      health: 'https://morpion-server-eygy.onrender.com/',
      join: 'anon',                       // le seul sans pseudo ni avatar
      content: false,
      replay: false,
      handoff: true,                      // branché au Game Hub (games/shared/hub-handoff.js)
    },
  },
  {
    id: 'imitation',
    emoji: '🎤',
    accent: 'amber',
    title: 'Imitation',
    title_en: 'Imitation',
    tagline: 'Le party game vocal',
    tagline_en: 'The voice party game',
    desc: "Regarde un extrait, imite le son au micro en rythme (double waveform pour te caler), puis note les autres 👍×2 / 👍 / 👎. Le host pilote, le serveur arbitre, les audios ne touchent jamais le disque.",
    desc_en: "Watch a clip, imitate its sound on mic in rhythm (dual waveform to sync up), then rate the others 👍×2 / 👍 / 👎. The host drives, the server referees, audio never hits disk.",
    tags: ['en ligne', 'multi', 'micro'],
    tags_en: ['online', 'multi', 'mic'],
    stack: ['WebSocket', 'MediaRecorder', 'Web Audio', 'R2'],
    code: 'https://github.com/MathysLan/imitation-server',
    arch: [
      "Enregistrement au micro avec MediaRecorder, double waveform en Web Audio pour se caler",
      "Prises envoyées en binaire par WebSocket, gardées en RAM le temps de la manche puis purgées",
      "Vidéos de référence sur Cloudflare R2 (CORS) : elles ne passent jamais par le serveur Node",
      "Le host pilote les phases, le serveur valide chaque transition",
    ],
    arch_en: [
      "Mic recording with MediaRecorder, dual Web Audio waveform to sync up",
      "Takes sent as binary over WebSocket, kept in RAM for the round then purged",
      "Reference videos on Cloudflare R2 (CORS): they never go through the Node server",
      "The host drives the phases, the server validates every transition",
    ],
    href: 'games/imitation/',
    status: 'live',
    hub: {
      mode: 'online',
      players: { min: 2, max: 8 },
      minutes: { min: 6, max: 15 },
      needs: ['mic'],                     // déclaratif : le jeu demande, pas le Hub
      categories: ['creatif', 'ambiance'],
      server: 'wss://imitation-server.onrender.com',
      health: 'https://imitation-server.onrender.com/',
      join: 'v1',
      content: false,
      replay: false,
      handoff: true,                      // branche au Game Hub (games/shared/hub-handoff.js)
    },
  },
  {
    id: 'demicercle',
    emoji: '🎯',
    accent: 'amber',
    title: 'Demi-Cercle',
    title_en: 'Half-Circle',
    tagline: 'Le party game de perception',
    tagline_en: 'The perception party game',
    desc: "Inspiré de Wavelength : un Guide voit une cible secrète sur un spectre 0-100 et lâche un indice, les autres placent leur curseur au plus près. Serveur arbitre - la cible ne fuite jamais avant la révélation.",
    desc_en: "Wavelength-inspired: a Guide sees a secret target on a 0-100 spectrum and drops a clue, everyone else places their cursor as close as they can. Referee server - the target never leaks before the reveal.",
    tags: ['en ligne', 'multi', 'bluff'],
    tags_en: ['online', 'multi', 'bluff'],
    stack: ['WebSocket', 'Node.js', 'SVG'],
    code: 'https://github.com/MathysLan/demicercle-server',
    arch: [
      "La cible n'est envoyée qu'au Guide, jamais aux autres joueurs avant la révélation",
      "Les curseurs en direct ne partent qu'au Guide, pas entre devineurs (anti-triche)",
      "Scores calculés côté serveur ; le cadran est dessiné en SVG",
      "Deux modes : thèmes du catalogue, ou thème inventé par le Guide (la cible reste tirée par le serveur)",
    ],
    arch_en: [
      "The target is only sent to the Guide, never to the other players before the reveal",
      "Live cursors only go to the Guide, not between guessers (anti-cheat)",
      "Scores computed server-side; the dial is drawn in SVG",
      "Two modes: catalogue themes, or a theme invented by the Guide (the server still draws the target)",
    ],
    href: 'games/demicercle/',
    status: 'live',
    hub: {
      mode: 'online',
      players: { min: 2, max: 10 },
      minutes: { min: 2, max: 15 },
      needs: [],
      categories: ['discussion', 'deduction'],
      server: 'wss://demicercle-server.onrender.com',
      health: 'https://demicercle-server.onrender.com/',
      join: 'v1',
      content: false,
      replay: false,
      handoff: true,                      // branché au Game Hub (games/shared/hub-handoff.js)
    },
  },
  {
    id: 'puissance4',
    emoji: '🔴',
    accent: 'violet',
    title: 'Puissance 4',
    title_en: 'Connect 4',
    tagline: 'Solo contre le bot',
    tagline_en: 'Solo vs the bot',
    desc: "Un Puissance 4 en canvas contre une IA simple mais pas manchote (gagner > bloquer > centre). Caché aussi derrière l'INSERT COIN et le Konami code - à toi de fouiller.",
    desc_en: "Canvas Connect 4 against a simple-but-not-clueless AI (win > block > center). Also hidden behind the INSERT COIN and the Konami code - go dig.",
    tags: ['solo', 'vs bot'],
    tags_en: ['solo', 'vs bot'],
    stack: ['Canvas', 'JS natif'],
    code: 'https://github.com/MathysLan/MathysLan.github.io/blob/main/js/connect4.js',
    arch: [
      "Entièrement dans le navigateur, rendu sur Canvas, sans serveur",
      "Bot à heuristique : gagner si possible, sinon bloquer, sinon viser le centre",
      "Lancé aussi par INSERT COIN, la palette Ctrl+K et le Konami code",
    ],
    arch_en: [
      "Runs entirely in the browser, rendered on Canvas, no server",
      "Heuristic bot: win if possible, otherwise block, otherwise aim for the center",
      "Also launched by INSERT COIN, the Ctrl+K palette and the Konami code",
    ],
    action: 'connect4',
    status: 'live',
    hub: {
      mode: 'local',                      // aucun serveur : tout est dans la page
      players: { min: 1, max: 1 },
      minutes: { min: 2, max: 6 },
      needs: [],
      categories: ['classique', 'solo'],
      content: false,
      replay: false,
      handoff: false,
    },
  },
  {
    id: 'ban',
    emoji: '🚫',
    accent: 'violet',
    title: 'Le Jeu du Ban',
    title_en: 'The Ban Game',
    tagline: 'Le party game du sang-froid',
    tagline_en: 'The nerve party game',
    desc: "Une vidéo cache un mot interdit. Chacun son tour, tu la stoppes le plus tard possible… sans jamais le laisser sortir. Serveur arbitre : il dicte le rythme, recoupe ton temps à son horloge (anti-triche) et coupe le tour d'un joueur inactif.",
    desc_en: "A video hides a forbidden word. Each turn, you stop it as late as you dare - without ever letting it out. Referee server: it sets the pace, cross-checks your time against its own clock (anti-cheat) and cuts an idle player's turn.",
    tags: ['en ligne', 'multi', 'sang-froid'],
    tags_en: ['online', 'multi', 'nerve'],
    stack: ['WebSocket', 'Node.js', 'R2', 'setTimeout'],
    code: 'https://github.com/MathysLan/ban-server',
    arch: [
      "Le temps « fatal » d'une vidéo n'est jamais envoyé aux joueurs avant les résultats",
      "Chaque arrêt est recoupé avec l'horloge du serveur (anti-triche)",
      "Rythme et filet anti-blocage tenus par le serveur ; ordre de passage aléatoire",
      "Catalogue des vidéos en JSON sur GitHub Pages, relu par le serveur : ajouter une vidéo ne demande aucun redéploiement",
    ],
    arch_en: [
      "A video's « fatal » time is never sent to players before the results",
      "Every stop is cross-checked against the server clock (anti-cheat)",
      "Pace and anti-stall safety net held by the server; random turn order",
      "Video catalogue as JSON on GitHub Pages, read by the server: adding a video needs no redeploy",
    ],
    href: 'games/ban/',
    status: 'live',
    hub: {
      mode: 'online',
      players: { min: 2, max: 10 },
      minutes: { min: 5, max: 12 },
      needs: ['consent'],                 // la case d'avertissement, cochée par le joueur
      categories: ['sang-froid', 'ambiance'],
      server: 'wss://ban-server-68h9.onrender.com',
      health: 'https://ban-server-68h9.onrender.com/',
      join: 'v1',
      content: false,
      replay: false,
      handoff: true,                      // branché au Game Hub (games/shared/hub-handoff.js)
    },
  },
  {
    id: 'precision',
    emoji: '🎯',
    accent: 'mint',
    title: 'Précision',
    title_en: 'Precision',
    tagline: 'Le party game de la mémoire fine',
    tagline_en: 'The fine-memory party game',
    desc: "Inspiré de dialed.gg : une forme, une couleur, un son ou un timing s'affiche quelques secondes… puis disparaît. À toi de le reproduire au plus juste. Tout le monde joue en même temps, le serveur note la précision de chacun de 0 à 100 %.",
    desc_en: "Dialed.gg-inspired: a shape, a color, a sound or a timing shows up for a few seconds - then vanishes. Reproduce it as closely as you can. Everyone plays at once, and the server scores each attempt from 0 to 100%.",
    tags: ['en ligne', 'multi', '4 épreuves'],
    tags_en: ['online', 'multi', '4 tests'],
    stack: ['WebSocket', 'Node.js', 'Web Audio', 'SVG'],
    code: 'https://github.com/MathysLan/precision-server',
    arch: [
      "Moteur de score pur : teinte circulaire, symétrie du triangle, écart en cents pour le son",
      "Le serveur tire la cible et tient les phases mémoriser puis jouer, selon la difficulté",
      "Cible envoyée seulement pendant la mémorisation ; les timings sont recoupés à l'horloge serveur",
      "Sons synthétisés en Web Audio et formes en SVG : aucun fichier média",
    ],
    arch_en: [
      "Pure scoring engine: circular hue, triangle symmetry, pitch error in cents",
      "The server draws the target and runs the memorize-then-play phases, by difficulty",
      "Target only sent during memorization; timings cross-checked against the server clock",
      "Sounds synthesized with Web Audio and shapes in SVG: no media files",
    ],
    href: 'games/precision/',
    status: 'live',
    hub: {
      mode: 'online',
      players: { min: 1, max: 12 },
      minutes: { min: 3, max: 10 },
      needs: [],
      categories: ['reflexe', 'observation'],
      server: 'wss://precision-server.onrender.com',
      health: 'https://precision-server.onrender.com/',
      join: 'v1',
      content: false,
      replay: false,
      handoff: true,                      // branché au Game Hub (games/shared/hub-handoff.js)
    },
  },
  {
    id: 'passeur',
    emoji: '🏐',
    accent: 'amber',
    title: 'Le Passeur',
    title_en: 'The Setter',
    tagline: 'Décider en cinq secondes',
    tagline_en: 'Five seconds to decide',
    desc: "Une situation de volley, cinq passes possibles, cinq secondes. Les points dépendent de la pertinence de la décision ET de la vitesse. Inspiré du poste de passeur - lecture du jeu, pas simulation.",
    desc_en: "A volleyball situation, five possible sets, five seconds. Points depend on how sound the decision is AND how fast you make it. Inspired by the setter position - reading the game, not simulating it.",
    tags: ['en ligne', 'multi', 'réflexe'],
    tags_en: ['online', 'multi', 'reflex'],
    stack: ['WebSocket', 'Node.js', 'Moteur pur'],
    code: 'https://github.com/MathysLan/passeur-server',
    arch: [
      "Serveur Node.js (ws) seul arbitre : le client n'envoie que la passe choisie",
      "Les barèmes et les explications vivent dans le serveur — le client ne les reçoit qu'APRÈS avoir répondu",
      "Temps de décision recoupé à l'horloge serveur : le chrono affiché n'est qu'un repère visuel",
      "Terrain SVG en fausse 3D, construit à partir de la « scène » envoyée par le serveur : le client sait dessiner une rotation, une réception et un bloc, jamais une situation précise",
      "Les règles du volley (FIVB 2025-2028) vivent dans un module serveur : positions 1 à 6, ligne avant/arrière, attaque et bloc d'un joueur arrière. Un passeur arrière n'a donc pas de deuxième main",
      "Une manche se joue en deux temps tenus par le serveur : la mise en situation qu'on regarde, puis les 5 secondes de décision — même fenêtre pour tout le monde",
      "Ajouter une situation = ajouter un objet dans situations.js, côté serveur",
    ],
    arch_en: [
      "A Node.js (ws) server is the only referee: the client only sends the chosen set",
      "Scoring tables and explanations live on the server — the client gets them only AFTER answering",
      "Decision time is re-measured against the server clock: the on-screen timer is just a visual cue",
      "A faux-3D SVG court built from the \"scene\" the server sends: the client knows how to draw a rotation, a reception and a block — never one specific situation",
      "The volleyball rules (FIVB 2025-2028) live in a server module: positions 1-6, front/back row, back-row attack and block. A back-row setter therefore has no dump",
      "A round has two server-driven phases: the build-up you watch, then the 5 seconds to decide — the same window for everyone",
      "Adding a situation means adding one object to situations.js, on the server side",
    ],
    href: 'games/passeur/',
    status: 'live',
    hub: {
      mode: 'online',
      players: { min: 1, max: 8 },        // MAX_PLAYERS vérifié dans server.js
      minutes: { min: 3, max: 8 },
      needs: [],
      categories: ['reflexe', 'sport'],
      server: 'wss://passeur-server.onrender.com',
      health: 'https://passeur-server.onrender.com/',
      join: 'v1',
      content: false,
      replay: true,                       // action: 'lobby' vérifiée dans server.js
      handoff: true,                      // branché au Game Hub (games/shared/hub-handoff.js)
    },
  },
  {
    id: 'quiment',
    emoji: '🕵️',
    accent: 'violet',
    title: 'Qui Ment ?',
    title_en: 'Who Is Lying?',
    tagline: 'Tout le monde a le même mot — sauf un',
    tagline_en: 'Everyone got the same word - except one',
    desc: "Jeu de bluff. Tout le monde reçoit le même mot, sauf l'intrus, qui ne connaît que la catégorie. Deux tours d'indices en aveugle, un vote, et la révélation. Trop précis, l'intrus devine ; trop vague, on vous prend pour lui.",
    desc_en: "A bluffing game. Everyone gets the same word except the impostor, who only knows the category. Two blind rounds of clues, a vote, then the reveal. Too precise and the impostor guesses; too vague and they take you for one.",
    tags: ['en ligne', 'multi', 'bluff'],
    tags_en: ['online', 'multi', 'bluff'],
    stack: ['WebSocket', 'Node.js', 'Moteur pur'],
    code: 'https://github.com/MathysLan/qui-ment-server',
    arch: [
      "Serveur Node.js (ws) seul arbitre : le client n'envoie qu'un indice, un vote, une tentative",
      "Le mot ne part jamais en diffusion — joueur par joueur, et `word: null` pour l'intrus",
      "Les indices sont ramassés en silence puis révélés d'un bloc : sinon le dernier à écrire lirait les autres",
      "La liste des mots de la catégorie n'est envoyée qu'à l'intrus, et seulement s'il est démasqué",
      "Ajouter une catégorie = ajouter un objet dans mots.js, côté serveur",
    ],
    arch_en: [
      "A Node.js (ws) server is the only referee: the client only sends a clue, a vote, a guess",
      "The word is never broadcast - it goes out player by player, with `word: null` for the impostor",
      "Clues are collected silently then revealed all at once: otherwise the last to write would read the others",
      "The category's word list is sent to the impostor only, and only once they have been unmasked",
      "Adding a category means adding one object to mots.js, on the server side",
    ],
    href: 'games/quiment/',
    status: 'live',
    hub: {
      mode: 'online',
      players: { min: 3, max: 8 },        // MIN 3 : en dessous le vote n'a aucun sens
      minutes: { min: 8, max: 15 },
      needs: [],
      categories: ['bluff', 'discussion'],
      server: 'wss://qui-ment-server.onrender.com',
      health: 'https://qui-ment-server.onrender.com/',
      join: 'v1',
      content: false,
      replay: true,                       // action: 'lobby' vérifiée dans server.js
      handoff: true,                      // branché au Game Hub (games/shared/hub-handoff.js)
    },
  },
  {
    id: 'roquette',
    emoji: '🚀',
    accent: 'amber',
    title: 'Roquette Party',
    title_en: 'Roquette Party',
    tagline: "Un mot avant qu'elle parte",
    tagline_en: 'One word before it blows',
    desc: "Jeu de mots en temps réel : deux ou trois lettres s'affichent, trouve un mot qui les contient avant que la roquette n'explose. Chaque mot valide l'envoie vers le joueur suivant ; chaque explosion coûte une vie.",
    desc_en: "A real-time word game: two or three letters appear, find a word that contains them before the rocket blows. Every valid word sends it to the next player; every explosion costs a life.",
    tags: ['en ligne', 'multi', 'mots'],
    tags_en: ['online', 'multi', 'words'],
    stack: ['WebSocket', 'Node.js', 'Moteur pur'],
    code: 'https://github.com/MathysLan/roquette-server',
    arch: [
      "Serveur Node.js (ws) seul arbitre : le client n'envoie que ce qu'il tape et le mot qu'il propose",
      "L'instant de l'explosion ne quitte jamais le serveur : le danger affiché ne dépend que du temps écoulé depuis le début du tour",
      "Le dictionnaire reste côté serveur : aucun message ne contient plus que le mot qui vient d'être validé",
      "Règles isolées dans un moteur pur (engine.js) : horloge et hasard injectés, aucun réseau",
      "De 2 à 16 joueurs, parties privées par code à 4 lettres",
    ],
    arch_en: [
      "A Node.js (ws) server is the only referee: the client only sends what it types and the word it submits",
      "The moment of the explosion never leaves the server: the danger shown only depends on the time elapsed since the turn began",
      "The dictionary stays on the server: no message ever holds more than the word just validated",
      "Rules isolated in a pure engine (engine.js): clock and randomness injected, no networking",
      "From 2 to 16 players, private games through a 4-letter code",
    ],
    href: 'games/roquette/',
    status: 'live',
    hub: {
      mode: 'online',
      players: { min: 2, max: 16 },       // MIN_PLAYERS / MAX_PLAYERS vérifiés dans engine.js
      // Réglage par défaut (3 vies, rythme normal) : ~20 s par vie perdue
      // (mèche de 12 à 24 s + 2,2 s d'explosion), au moins 3 × (joueurs − 1)
      // vies à perdre → ~2 min à 2, ~4 à 4, ~8 à 8, ~10 à 10. Au-delà de 10
      // joueurs, une partie peut dépasser le max annoncé.
      minutes: { min: 2, max: 10 },
      needs: [],
      categories: ['reflexe', 'ambiance'],
      server: 'wss://roquette-server.onrender.com',
      health: 'https://roquette-server.onrender.com/',
      join: 'v1',
      content: false,
      replay: true,                       // action: 'lobby' vérifiée dans server.js
      handoff: true,                      // branché au Game Hub (games/shared/hub-handoff.js)
    },
  },
  {
    // Nom affiché « Croq.ios » ; le nom technique reste « croquis » (id,
    // dossier games/croquis/, croquis-server).
    id: 'croquis',
    emoji: '🎨',
    accent: 'violet',
    title: 'Croq.ios',
    title_en: 'Croq.ios',
    tagline: 'Dessine. Devine. Gagne.',
    tagline_en: 'Draw. Guess. Win.',
    desc: "Jeu de dessin en ligne : chacun son tour, un joueur choisit un mot parmi trois et le dessine, les autres le devinent en le tapant. Plus on trouve vite, plus on marque ; des lettres se dévoilent au fil du chrono.",
    desc_en: "An online drawing game: one player at a time picks a word out of three and draws it, the others guess it by typing. The faster you find it, the more you score; letters reveal themselves as the clock runs down.",
    tags: ['en ligne', 'multi', 'dessin'],
    tags_en: ['online', 'multi', 'drawing'],
    stack: ['WebSocket', 'Node.js', 'Moteur pur', 'Canvas'],
    code: 'https://github.com/MathysLan/croquis-server',
    arch: [
      "Serveur Node.js (ws) seul arbitre : le client n'envoie que son choix de mot, son dessin et ses devinettes",
      "Le mot ne quitte le serveur que vers le dessinateur jusqu'à la fin du tour : les autres reçoivent un gabarit et les indices",
      "Les traits sont validés et bornés côté serveur (feuille 1000 × 750, 150 traits, 1 000 points par trait), puis relayés",
      "Catalogue de 318 mots en trois niveaux : chaque tour propose un facile, un moyen, un difficile, jamais deux fois le même dans une partie",
      "Règles isolées dans un moteur pur (engine.js) : horloge et hasard injectés, aucun réseau",
    ],
    arch_en: [
      "A Node.js (ws) server is the only referee: the client only sends its word choice, its drawing and its guesses",
      "The word only leaves the server towards the drawer until the turn ends: the others get a pattern and the hints",
      "Strokes are validated and capped on the server (1000 × 750 sheet, 150 strokes, 1,000 points per stroke), then relayed",
      "A 318-word catalogue in three levels: each turn offers one easy, one medium, one hard word, never twice in a game",
      "Rules isolated in a pure engine (engine.js): clock and randomness injected, no networking",
    ],
    href: 'games/croquis/',
    status: 'live',
    hub: false,                           // volontairement HORS du Game Hub (pas de handoff) : absent du manifest
  },
  {
    id: 'soon',
    emoji: '🎮',
    accent: 'mint',
    title: 'La suite',
    title_en: 'What\'s next',
    tagline: 'En cours de dev',
    tagline_en: 'In the works',
    desc: "D'autres jeux web arrivent - toujours jouables direct dans le navigateur, sans install ni compte. L'architecture front statique + serveur arbitre est prête à les accueillir.",
    desc_en: "More web games are coming - always playable straight in the browser, no install, no account. The static-front + referee-server architecture is ready for them.",
    tags: ['bientôt'],
    tags_en: ['soon'],
    stack: [],
    status: 'soon',
  },
];
