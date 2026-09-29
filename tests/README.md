# Tests du front

Des suites qui ne se recouvrent pas :

| Fichier | Ce qu'il couvre |
|---|---|
| `front.html` | le portfolio : rendu des cartes, lightbox, palette Ctrl+K, FR/EN, thèmes, guichet, presse-papiers, menu mobile, sans JS |
| `games.html` | le **socle commun** des pages de jeux : polices locales, favicon, retour au portfolio, messages d'état, avatars, `?server=`, mouvement réduit, téléphone |
| `keyboard.mjs` | le focus clavier, avec de **vraies frappes Tab** (voir plus bas) |
| `manifest.mjs` | le **manifest des jeux** (`data/games.manifest.json`) : cohérence avec `data/games.js` et avec les clients, et les garde-fous du build |
| `profile.mjs` | le **profil local** (pseudo + avatar) : tests unitaires du module, puis intégration sur les vraies pages de jeux |
| `passeur-play.mjs` | **une partie réelle du Passeur**, avec de vrais clics, un vrai tactile et de vraies touches (voir plus bas) |
| `avatar-play.mjs` | **la photo de profil en vraie partie**, dans les six jeux qui reçoivent une identité, à trois joueurs (voir plus bas) |
| `hub.mjs` | le **client du Game Hub** (`games/shared/game-hub.js`) : unitaires, puis protocole contre le vrai `game-hub-server` (local, ou `--hub wss://…`) |
| `hub-play.mjs` | **le salon du Hub dans deux navigateurs** : créer, rejoindre, avatars, hôte, reprise ; **coupure de socket** (absent, grâce conservée, retour avec le même id) puis **« Quitter »** (A disparaît tout de suite chez B ; le dernier qui part ferme la session sur-le-champ) ; 12 joueurs (`--hub wss://…` pour la production) |
| `handoff.mjs` | **le handoff, protocole réel** : le vrai `game-hub-server` ET le vrai `passeur-server` lancés en local, trois joueurs en Node — room créée par l'hôte, code relayé, invités entrés, une manche jouée et notée |
| `handoff-play.mjs` | **le handoff dans trois navigateurs**, jusqu'au bout : portfolio → Hub → tirage → « Ouvrir Le Passeur » → room réelle → rechargement d'un invité → « Rejoindre » → une seule room → 3 manches au clavier → classement → retour au Hub ; plus le cas « serveur du jeu injoignable ». `--reduced`, `--shots` |
| `handoff-morpion.mjs` | **le handoff du Morpion**, vrai `game-hub-server` + vrai `morpion-server` : protocole en Node (room créée par `{ action: 'join' }` sans code, code relayé, `playing`, victoire, « room pleine », debrief), puis deux navigateurs de la home jusqu'au retour au Hub, un second lancement où l'invité part en pleine partie, un troisième où l'hôte perd sa connexion en attente (lancement annulé pour le groupe), et le jeu hors Hub. Relit chaque trame **envoyée** à `morpion-server` : ni `name`, ni `avatar`, jamais. `--reduced`, `--shots` |
| `handoff-quiment.mjs` | **le handoff de Qui Ment ?**, vrai `game-hub-server` + vrai `qui-ment-server` : protocole à trois en Node (rôles, le mot jamais chez l'intrus avant les résultats, retardataire refusé, classement), puis quatre navigateurs — « Lancer » attend Dora, départ sans elle, Dora refusée, une manche jouée pour de vrai, classement, retour au Hub ; un second lancement à quatre ; trois joueurs hors Hub. `--reduced`, `--shots` |
| `quiment-replay.mjs` | **« Rejouer » dans Qui Ment ?**, vrai `qui-ment-server` (+ vrai `game-hub-server`) : au niveau du protocole, `start` est ignoré en phase `end` et `lobby` (MJ seulement) ramène au salon ; puis trois navigateurs hors Hub — trois « Rejouer » de suite (double clic compris : un seul `lobby`, un seul `start`, même room, aucun nouveau `you`), le dernier à deux joueurs (salon valide, un nouveau venu entre par le code) ; puis via le Hub — la revanche se joue dans la même room sans rien envoyer au Hub, toujours une seule session. `--reduced` |
| `hub-score.mjs` | **le score de soirée**, vrai `game-hub-server` + vrai `passeur-server`, trois navigateurs : bloc « Score de la soirée » réduit à une ligne (« Aucune partie jouée ») avant tout tirage (panneau à part, mesuré de 1920 à 390 px : colonne de droite collante à partir de 1200 px, entre le salon et le panneau des jeux en dessous, aucun défilement horizontal), ordre du salon et « Tirer » de l'hôte / attente des invités à 390, 768, 1100 et 1280 px, deux vraies parties du Passeur où chacun joue une passe différente, chaque joueur déclare SA place (`gamePlayerId`), seul l'hôte rapporte le classement (avant `ended`), points du Hub = conversion recalculée depuis la trame `end` de passeur-server, affichage chez les trois, **addition** à la 2e partie, nouvelle session à zéro. `--reduced`, `--shots` (captures du salon) |
| `hub-score-imitation.mjs` | **le score de soirée d'Imitation**, vrai `game-hub-server` + vrai `imitation-server`, trois navigateurs au micro factice : chacun déclare SA place (id Imitation, jamais celui du Hub), une reconnexion au salon ré-annonce la nouvelle place, une manche où A et B enregistrent et C non → ex æquo réel 4 / 4 / 0 → rangs 1 / 1 / 3 ; `results` puis `ended`, depuis l'hôte seul ; 30 / 30 / 10 au Hub, deux 🥇 dans le bloc. `--reduced`, `--shots`, `--prod` (site GitHub Pages + serveurs Render, cumule avec les points déjà présents) |
| `hub-score-demicercle.mjs` | **le score de soirée du Demi-Cercle**, vrai `game-hub-server` + vrai `demicercle-server`, trois navigateurs : chacun déclare SA place (id Demi-Cercle, jamais celui du Hub), une reconnexion au salon ré-annonce la nouvelle place (et elle seule), trois manches jouées au vrai clic sur le cadran — A et B visent la cible reçue par le Guide, C l'opposé → ex æquo réel 13 / 13 / 5 → rangs 1 / 1 / 3 ; `results` puis `ended`, depuis l'hôte seul ; helper `rangs()` sur 4 / 4 / 0 et sur un podium non trié ; 30 / 30 / 10 au Hub, deux 🥇 dans le bloc. `--reduced`, `--shots`, `--prod` |
| `hub-score-ban.mjs` | **le score de soirée du Ban**, vrai `game-hub-server` + vrai `ban-server`, trois navigateurs : l'avertissement est demandé à chacun et aucune room n'existe avant la case, chacun déclare SA place (id Ban), une reconnexion au salon ré-annonce la nouvelle place et B marque bien par elle, une vidéo aux vrais boutons — deux STOP immédiats (0), un mot lâché (−1) → ex æquo 0 / 0 / −1 → rangs 1 / 1 / 3 ; `results` puis `ended`, depuis l'hôte seul ; helper `rangs()` sur 13 / 13 / 5 et 13 / 5 / 13 ; 30 / 30 / 10 au Hub, deux 🥇. `--reduced`, `--shots`, `--prod` (vraies vidéos R2, mot lu dans `videos.json`) |
| `hub-score-precision.mjs` | **le score de soirée de Précision**, vrai `game-hub-server` + vrai `precision-server`. TRIO : chacun déclare SA place (id Précision), une reconnexion au salon ré-annonce la nouvelle place et B marque bien par elle, trois manches de frappe (Impossible) au vrai clavier — A et B dix mots justes (100), C rien (0) → ex æquo 300 / 300 / 0 → rangs 1 / 1 / 3 ; `results` puis `ended`, depuis l'hôte seul ; helper `rangs()` sur 100/80/50, 100/100/50, 50/20/50 (non trié) et une ligne ; 30 / 30 / 10 au Hub, deux 🥇, retour en debrief. SOLO : une session d'un joueur → podium d'une ligne → rang 1 → +10 dans la trame du Hub → VRAI retour au Hub (`#to-hub`, même onglet : le socket du Hub se ferme puis se rouvre) → même session et même code, score 10, `history.played` / `history.games` intacts, `debrief`, toujours hôte, puis un nouveau tirage (n° 2). Régression du défaut corrigé dans game-hub-server `d679eab` : échoue en `SESSION_NOT_FOUND` contre le Hub d'avant. 38 vérifications. `--reduced`, `--shots`, `--prod` |
| `hub-score-quiment.mjs` | **le score de soirée de Qui Ment ?**, vrai `game-hub-server` + vrai `qui-ment-server`, trois navigateurs. Chacun déclare SA place (id de son `you`), B se reconnecte au salon → nouvel id ré-annoncé, et c'est par lui qu'il est crédité ; trois manches jouées pour de vrai (indices, votes, dernière chance) avec des votes CHOISIS selon l'intrus tiré, pour un ex æquo 1 / 1 / 3 garanti quel que soit le tirage ; `results` puis `ended` depuis l'hôte seul, points = `score` (ni avg ni title) ; helper `rangs()` extrait de `app.js` (100/80/50, 100/100/50, 50/20/50, 13/13/5) ; 30 / 30 / 10 au Hub ; « Rejouer » : revanche complète, rien ne part au Hub, score et historique inchangés ; vrai retour au Hub (`#to-hub`) des trois, même session, debrief, deux 🥇 ; nouveau tirage = nouveau drawId. 35 vérifications. `--reduced`, `--shots`, `--prod` |
| `hub-score-morpion.mjs` | **le score de soirée du Morpion**, vrai `game-hub-server` + vrai `morpion-server` (son `ws` prêté par `NODE_PATH`), deux navigateurs, une session. Le Morpion n'a PAS de score : classement dérivé de `winner` — victoire 1 / 2, égalité 1 / 1, `points: 0` — que le Hub convertit en 20 / 10 ou 20 / 20. Quatre parties réelles à la souris : victoire X, victoire O, égalité (X O X / X O O / O X X), puis abandon. À chaque fois : places `X` / `O` (jamais l'id du Hub), aucune identité vers morpion-server, `results` puis `ended` depuis l'hôte seul, gains et `gamePoints` 0 dans l'historique, cumul 20/10 → 30/30 → 50/50, vrai retour au Hub des deux (`#to-hub`, même session, debrief), nouveau drawId à chaque tirage. Abandon : room fermée, AUCUN classement, seulement `ended`, score inchangé. 45 vérifications. `--reduced`, `--shots`, `--prod` |
| `hub-score-contract.mjs` | **le contrat du score de soirée, statiquement, pour les sept jeux** — sans navigateur ni serveur, en une seconde. Par jeu : `handoff: true` au manifest, la page charge `hub-handoff.js` avant son script, `roomReady(code, place)` avec SA place (`msg.id` / `msg.you` / `state.you`, jamais l'id du Hub), un seul `lien.results(…)` gardé et suivi de `ended` dans le même chemin de fin ; le helper de classement est EXTRAIT de la page et EXÉCUTÉ (100/80/50, 13/13/5, 50/20/50 non trié, 0/0/−1, solo ; Morpion : victoire X, victoire O, nul, `points: 0`, abandon sans `results`). Plus `hub-handoff.js` : `results` une fois (`rapporte || fini`), `ended` consomme le billet, `failed()` sans nouvel essai en `playing`, même `?v=` sur les sept pages. 125 vérifications. ⚠️ « une fois » veut dire une fois PAR LA PAGE : la livraison elle-même (renvois après reconnexion) est gardée par `hub-report.mjs`. À lancer après toute retouche d'un raccord ; les vraies parties restent dans `hub-score-*.mjs` |
| `hub-report.mjs` | **la livraison fiable `results` → `ended`** (voir la section du même nom plus bas), sans navigateur : vrai `game-hub-server` local, vrais `game-hub.js` et `hub-handoff.js` exécutés dans des « pages » Node (un contexte `vm` par page, `sessionStorage` par onglet, minuteries tuées à la navigation). Envoi normal, socket fermé / en CONNECTING avant `results`, `ended` perdu, les deux perdus, confirmation perdue (aucun double score), retour à `/games/` + rechargement pendant la livraison, ancien tirage et autre session jamais rejoués, règles internes (une fois par connexion, borne de 5 envois, refus définitifs, étape `join`). 59 vérifications, ~15 s |
| `hub-report-play.mjs` | **la même livraison dans deux vrais navigateurs**, sur le Morpion : seul le WebSocket **Hub** de l'hôte est coupé (script injecté), celui du jeu jamais. Fin de partie sans Hub puis retour du Hub sur la page du jeu ; fin sans Hub puis retour à `/games/` (c'est `hub-page.js` qui livre) et rechargement (rien de renvoyé) ; tirage suivant. 19 vérifications. `--prod` : ce front, servi en local, contre le **vrai** Hub et le **vrai** `morpion-server` |
| `hub-finale.mjs` | **la fin de soirée** : l'hôte termine, tout le monde voit le podium. Trois navigateurs contre un vrai `game-hub-server` local (clients Node pour les scores, comme `hub-recap.mjs`). Seul l'hôte a « 🏁 Terminer la soirée », distinct de « Quitter la session » ; Annuler n'envoie rien ; confirmer (deux fois exprès) → une seule fin, la même finale chez les trois ; révélation 3e → 1ers ex æquo ensemble (ou tout d'emblée avec `--reduced`) ; podium = la finale du Hub (🥇🥇🥉 4., joueur parti gardé), présenté en MARCHES (une par rang, 2e · 1er · 3e, pas de rang inventé), « Ta place finale », composition distincte du récap ; 1280 / 1100 / 768 / 390 px ; 2 joueurs, 3 joueurs / 3 parties, solo avec une partie ; « Retour à l'accueil » ; un absent qui revient reçoit le podium (refus `SESSION_CLOSED`), pas de reprise ; l'hôte seul sans partie. 67 vérifications (65 en mouvement réduit). `--reduced`, `--shots <dir>` |
| `hub-recap.mjs` | **le débrief de soirée du Game Hub**. D'abord `games/hub-recap.js` seul (Node) : aucune partie → `null`, classement du Hub, ex æquo au même rang, joueur parti gardé avec ses points, historique chronologique sans doublon, vainqueurs multiples, ta place / ton gain, solo ; le podium de la finale (`podium()`, `finalPlace()`). Puis la vraie page `/games/` contre un vrai `game-hub-server` local, SANS jeu : des clients Node jouent le protocole (`launched` / `entered` / `results` / `ended`), l'un porte l'id du profil du navigateur, qui reprend la session. 3 joueurs / 1 partie, 3 joueurs / 3 parties (ex æquo, nul, un joueur parti), solo, aucune partie (départ comme avant), pas de débrief tant que la session est active, le départ dit « Quitter la session » et le récap « 📋 Ton récap de soirée » (« Soirée terminée » est réservé à la fin décidée par l'hôte), nouvelle session = débrief rangé et score à zéro, rechargement = rien de recréé. Géométrie à 1280 et 390 px, y compris le texte qui déborde de sa cellule. 89 vérifications. `--reduced`, `--shots <dir>` |
| `hub-draw.mjs` | **le randomizer à trois joueurs** : clic réel de la home vers `/games/`, préférences et micro visibles chez tous, tirage, caisse, révélation, CONTINUER, 2e tirage (récence), rechargement pendant la révélation, aucun jeu possible, 390/768/1920 px, anneau de focus à la vraie touche Tab, et le même front devant le Hub **d'avant** le randomizer (extrait de git). `--reduced` pour le mouvement réduit |
| `game-net.mjs` | **le transport commun** (`games/shared/game-net.js`), en Node avec un faux WebSocket : même API que l'ancien `NET`, réponse aux pings de présence (jamais transmis au jeu), `lost` une seule fois, `connect()` réutilisé, `send()` sans exception, le remplacement de la connexion perdue (connect() ne rend la main qu'après l'acquittement), et le chien de garde — dont le faux `lost` quand le ping de connexion servait à mesurer la période |
| `presence-precision.mjs` | **le joueur fantôme, pilote Précision** : vrai `precision-server` (présence 1 s, absent après 3 s), Edge **sans** les options qui masquaient le gel. Onglet gelé au salon, au lancement et en pleine partie ; joueur silencieux mais actif ; ancien client ; coupure réseau franche (proxy TCP en trou noir) ; avec le Game Hub, invité gelé et hôte seul gelé (lancement annulé). Vérifie aussi qu'une reconnexion ne crée JAMAIS de doublon (l'ancienne connexion est remplacée avant le `join`). `--production` : les vraies valeurs du serveur (10 s / 30 s, ~10 min) ; `--precision <dossier>` pour la contre-épreuve contre le serveur d'avant |
| `presence-jeux.mjs` | **la présence dans les jeux du lot 1** (Demi-Cercle, Imitation, Ban, Passeur, Qui Ment ?), en jeu direct : pour chacun, le vrai serveur (délais courts), trois joueurs ; B gelé au salon → retiré puis de retour sans doublon, A lance et les trois sont en partie, C gelé en pleine partie → « elle a continué sans toi ». Edge sans les options qui masquaient le gel. `--only <jeu>` |
| `presence-morpion.mjs` | **la présence dans le Morpion**, qui ferme sa room dès qu'un joueur part : vrai `morpion-server`, Edge sans les options qui masquaient le gel. X gelé en attente → room fermée (le code ne se rejoint plus), écran « connexion perdue » sans reconnexion automatique ; O gelé en partie → X prévenu ; coupure réseau franche (proxy TCP) → l'ancien code refusé, pas de partie contre son propre fantôme ; une partie complète. `--production` : vraies valeurs (10 s / 30 s) ; `--morpion <dossier>` pour la contre-épreuve contre le serveur d'avant |
| `hub-fixture.mjs` | (module, pas une suite) le montage local des trois tests du Hub : le vrai `data/games.manifest.json`, avec les URL `health` redirigées vers un faux serveur local — aucun serveur Render n'est réveillé |

Rien à installer pour les deux pages HTML. Les ouvrir dans un navigateur suffit
**si** l'accès local aux fichiers est autorisé (une iframe `file://` est bloquée
par défaut). Deux façons :

    # au choix, un petit serveur local
    python -m http.server 8000    # puis http://localhost:8000/tests/front.html

    # ou, en headless
    msedge --headless=new --disable-gpu --allow-file-access-from-files \
           --window-size=900,600 --virtual-time-budget=25000 --dump-dom \
           "file:///C:/perso/MathysLan.github.io/tests/front.html"

Le verdict s'affiche en haut : `TOUT PASSE` ou la liste des `KO`.

> Sous Windows, `msedge --dump-dom` ne rend rien depuis PowerShell (c'est un exe
> graphique, sa sortie standard est perdue) : passer par Bash. Et donner à Edge
> un `--user-data-dir` à part, sinon il attend le navigateur déjà ouvert.

**Lancer les deux suites HTML deux fois.** Une partie des tests suit la
préférence « mouvement réduit » (terminal sans frappe, compteurs immédiats, Spy
qui ne marche pas, pas de bouton pause ; côté jeux, transitions coupées). Le
second passage se force avec `--force-prefers-reduced-motion`. La première ligne
du journal indique le mode détecté.

## front.html

Charge `index.html` dans **quatre** iframes : bureau (1100 px), téléphone
(390 px, menu burger), **sans JavaScript** (`sandbox` sans `allow-scripts`) et
**sans JavaScript en 390 px** — le seul cas où le menu de secours `<details>`
doit apparaître, puisque le burger a besoin de JS et que la liste du header est
masquée sous 768 px.

Deux points méritent d'être connus :

- En headless, un vrai `mailto:` bloque le navigateur : le guichet émet
  l'événement annulable `guichet:send` juste avant d'ouvrir le client mail, et
  le test l'annule.
- **Le presse-papiers.** On ne peut pas vérifier ici qu'un vrai
  `navigator.clipboard.writeText()` réussit : ni permission, ni page sécurisée
  en `file://`. Ce qui est testé, c'est toute la mécanique autour — le repli sur
  `execCommand`, le filet d'une seconde quand la promesse ne se règle jamais, le
  fait que la réponse arrive **exactement une fois** même si le presse-papiers
  répond en retard, et surtout qu'aucun faux « Adresse copiée ✓ » ne puisse
  s'afficher. Les stubs remplacent `navigator.clipboard`, `isSecureContext` et
  `document.execCommand` le temps du test, puis les remettent.

## games.html

Deux tests méritent un mot, parce qu'ils rattrapent des bugs qui sont déjà
passés en production :

- **L'apparence du code de room.** C'est un `<button>` (pour le clavier), donc
  le `button { background: …; padding: …; border-radius: … }` générique de
  chaque jeu lui remettrait l'allure d'un bouton d'action si le socle ne le
  déshabillait pas. Le test le compare au bouton d'action principal de chaque
  jeu, et vérifie aussi que ce dernier est bien resté plein — sinon le test
  passerait pour de mauvaises raisons.
- **L'état désactivé.** Deux pièges de mesure y sont désamorcés : Précision
  déclare `transition: opacity .12s`, donc lire le style juste après avoir posé
  `disabled` renvoie la valeur de *départ* (le test coupe les transitions le
  temps de la mesure) ; et la convention est « visiblement éteint », pas une
  valeur — le socle fournit `.45` par défaut, imitation préfère `.4` et
  precision `.35`, chacun avec une règle qui gagne légitimement.

## keyboard.mjs

    node tests/keyboard.mjs
    node tests/keyboard.mjs --edge "C:\chemin\vers\msedge.exe"

Node ≥ 22, aucune dépendance (le client WebSocket est celui de Node). Pas de
Node sur la machine ? Même méthode que pour `tools/build.mjs` : le zip officiel
dans le scratchpad.

Ce script existe parce que les deux autres suites ne peuvent **pas** prouver ce
qu'elles ont l'air de prouver : `:focus-visible` ne s'allume que si le focus
vient du clavier. Un `el.focus()` lancé par un script ne le déclenche pas sur un
`<button>` (vérifié sous Edge), et `focus({ focusVisible: true })` n'y est pas
encore implémenté. Le script ouvre donc Edge avec le protocole DevTools, envoie
de vrais `Tab`, et lit sur chaque élément atteint s'il porte un anneau visible —
un `outline`, ou une `box-shadow` inset (le portfolio dessine son anneau en
inset parce que `clip-path` rogne les outlines).

## Autres outils

`../styleguide.html` montre les primitives (panneau, bouton, étiquette,
qualités, case d'objet) côte à côte, dans les deux thèmes. `tests/`,
`styleguide.html` et `upload/` sont exclus de l'indexation dans `robots.txt`.

## passeur-play.mjs

    node tests/passeur-play.mjs --server ws://localhost:8090
    node tests/passeur-play.mjs --server wss://passeur-server.onrender.com
    node tests/passeur-play.mjs --server ... --reduced

**Le seul test de ce dépôt qui a besoin d'un serveur en face**, d'où le
`--server` obligatoire. Il joue quatre manches, une par mode d'entrée : clic,
touche 1, tactile, Entrée sur une zone focalisée.

Il existe parce que `games.html` ne pouvait pas prouver ce qu'il avait l'air de
prouver. Pour cliquer une zone, il appelle `dispatchEvent` sur son `<g>` — ce
qui **contourne le test de survol du navigateur**. Deux bugs bloquants sont
passés à travers cette suite :

- les joueurs, le ballon et les trajectoires sont dessinés **après** les zones
  et interceptaient le clic. L'ombre au sol du réceptionneur bloquait à elle
  seule tout le centre de la zone arrière ;
- contre un serveur d'une version antérieure, le message `go` n'arrive jamais :
  les zones n'étaient jamais armées, donc rien n'était cliquable, et le chrono
  restait figé sur 5,0.

Ici les entrées passent par le protocole DevTools, **aux coordonnées réelles**
de la zone, sur la page de jeu chargée telle quelle. Et la vérification ne
porte pas sur le DOM local : on lit la passe que **le serveur** a enregistrée,
dans son message `results`.

Deux pièges de plomberie, tous deux rencontrés ici :

- une touche « texte » (un chiffre) et une touche de commande (Entrée) ne
  s'envoient pas pareil. Avec `text: 'Enter'`, Chromium traite l'événement
  comme une saisie et le handler ne voit rien : il faut `rawKeyDown` sans
  `text`. Même piège que pour Tab dans `keyboard.mjs` ;
- `edge.kill()` ne tue que le processus parent. Chromium en lance une quinzaine
  d'autres qui survivent, et après quelques exécutions la machine est saturée
  de navigateurs fantômes — le test passait seul et échouait juste après un
  autre. Il faut tuer l'arbre (`taskkill /T`), et un port de debug tiré au
  hasard pour ne pas se connecter sans le savoir à l'instance précédente.


## manifest.mjs

    node tests/manifest.mjs

Le manifest est le contrat **machine** des jeux : c'est lui que lira le Game
Hub pour savoir combien de joueurs un jeu accepte, combien de temps il dure et
à quel serveur il parle. Il est généré depuis `data/games.js` par
`tools/build.mjs`.

Deux choses sont vérifiées, et aucune n'est visible à la relecture.

**Le manifest dit-il vrai ?** L'URL `wss://` annoncée pour chaque jeu est
comparée à celle que son `net.js` utilise réellement. Un copier-coller raté
enverrait le Hub réveiller un serveur pendant que le joueur en contacte un
autre — et tout aurait l'air normal des deux côtés. Le dialecte de connexion
est vérifié de la même façon : un jeu déclaré `join: 'v1'` doit bien envoyer
`name` et `avatar`, un `'anon'` (le Morpion) ne doit en envoyer aucun.

**Les garde-fous du build mordent-ils encore ?** Six cas cassent volontairement
`data/games.js` — un jeu jouable sans bloc `hub`, une clé hors schéma, une
catégorie inventée, `needs: ['micro']` au lieu de `['mic']`, des bornes de
joueurs à l'envers, un serveur en `ws://` — puis lancent le build et
vérifient qu'il **échoue**. Un validateur qu'on ne teste jamais finit par tout
accepter, et on ne s'en aperçoit que le jour où il aurait servi.

⚠️ Ces cas écrivent vraiment dans `data/games.js` avant de le restaurer dans
un `finally`. Si le test est interrompu au mauvais moment, vérifier
`git diff data/games.js` avant de commiter.


## profile.mjs

    node tests/profile.mjs

Le profil (`games/shared/game-profile.js`) retient pseudo et avatar d'un jeu à
l'autre. Ce fichier lance deux choses : les tests unitaires du module, dans
`tests/profile.html`, puis un parcours d'intégration sur les vraies pages.

⚠️ **Il démarre un petit serveur HTTP, et ce n'est pas du confort.** Chromium
refuse `localStorage` sur un document `file://`, et surtout chaque fichier
local y est sa PROPRE origine. Or ce qu'on veut prouver, c'est justement qu'un
profil renseigné dans un jeu se retrouve dans un autre. En `file://` tous les
tests passeraient sans rien démontrer. Le serveur sert le dépôt sur
`127.0.0.1`, sur un port tiré au hasard — deux exécutions qui se chevauchent ne
doivent pas se parler sans le savoir.

`tests/profile.html` peut aussi s'ouvrir seul, à condition de le servir en
HTTP ; ouvert en `file://` il le dit lui-même dès la première ligne.

Le parcours d'intégration fait ce qu'un joueur ferait : il tape un pseudo,
clique un avatar, recharge, ouvre un autre jeu, change d'avis, pose une photo,
la retire. Il vérifie aussi deux choses qui n'ont rien d'évident :

- **un profil corrompu ne casse aucun des six jeux** — la clé est remplie avec
  du texte qui n'est pas du JSON, puis chaque page est ouverte ;
- **Morpion ne charge pas le module du tout**, parce que son serveur ne sait
  recevoir ni pseudo ni avatar.

## avatar-play.mjs

    node tests/avatar-play.mjs
    node tests/avatar-play.mjs --only quiment
    node tests/avatar-play.mjs --shots C:\temp\pp    # une capture par écran vérifié

Lance lui-même les **six serveurs** depuis les dépôts voisins
(`../imitation-server`, `../qui-ment-server`…, `npm install` fait), un
serveur statique pour le portfolio, et un Edge piloté par le protocole
DevTools. Trois joueurs, chacun dans **son propre contexte de navigation**
(`Target.createBrowserContext`) — donc son propre localStorage, comme trois
personnes sur trois machines :

- **A** pose une vraie photo par le **vrai champ fichier** du profil
  (`DOM.setFileInputFiles` avec `assets/og-image.png`) ;
- **B** garde un emoji ;
- **C** a une photo à l'en-tête valide (le serveur l'accepte) mais au contenu
  illisible : tout le monde doit retomber sur son emoji, sans que son profil
  change.

On lit **les trames WebSocket réellement reçues**
(`Network.webSocketFrameReceived`) ET le DOM, image par image avec
`naturalWidth > 0` : une `<img>` présente mais non décodée ne compte pas.
Chaque jeu est joué jusqu'au bout avec de vrais clics (salon, jeu en cours,
résultats, podium).

Trois pièges déjà rencontrés :

- ⚠️ **`--disable-features=BackForwardCache`** : sans ça, quitter une page de
  jeu la met en cache avec son WebSocket ouvert ; le serveur ne voit jamais
  partir le joueur et le salon attend un fantôme.
- ⚠️ `NET` est un `const` global : `window.NET` vaut `undefined` (même piège
  que `GAMES`). Tester `typeof NET`.
- Le Ban demande un **consentement** (`#tw-check`) avant de créer ou rejoindre.

⚠️ **Le scénario « serveur non redéployé » est celui qui compte le plus.**
Le « [obj » a été vu à la main avec le front neuf contre la production pas
encore mise à jour, et aucun test ne le voyait puisque tous tournaient contre
les serveurs locaux déjà modifiés. Le script extrait donc de git la version de
chaque serveur **d'avant `avatar.js`** (le parent du commit qui l'ajoute) et y
rejoue le salon : l'ancien serveur doit renvoyer « [obj », et l'écran doit
montrer un emoji. Chaque écran vérifié scanne aussi `document.body.innerText`
à la recherche de « [obj » / « [object ».

## hub-draw.mjs — le randomizer, et où lire la vérité

Le jeu tiré est lu dans les **trames WebSocket** que reçoit chaque page
(`Network.webSocketFrameReceived`), puis comparé au DOM. C'est ce qui prouve
que la page montre le jeu choisi **par le serveur**, que la bande de la caisse
ne contient **que** des jeux de sa liste éligible, et qu'elle s'arrête sur le
bon (on lit la vignette sous le repère, par `getBoundingClientRect`).

Trois pièges déjà rencontrés :

- **Le lien de la home vise `games/` sans `?hub=`** : il irait donc au Hub de
  production. Le petit serveur HTTP du test redirige `/games/` (et lui seul)
  vers `/games/?hub=<Hub local>`. Le clic reste un vrai clic, et le test vérifie
  que le lien, lui, vaut bien `games/`.
- **Le `tar` de Windows lit `C:\…` comme un hôte distant.** L'extraction de
  l'ancien Hub (`git archive`) se fait donc avec un chemin relatif.
- ⚠️ **`keyboard.mjs` compte une `box-shadow` comme un anneau.** Or tous les
  boutons ont une box-shadow (le biseau) : sur un bouton découpé au
  `clip-path`, un outline rogné passe donc pour un anneau visible. `hub-draw`
  vérifie la COULEUR de l'anneau (le jaune `rgb(255, 215, 0)`) à la place.
- ⚠️ **Tab déclenche un défilement DOUX** (`scroll-behavior: smooth` de
  tf2.css). Après la vérification de l'ordre de tabulation (le focus finit sur
  « Terminer la soirée », en bas), un clic envoyé pendant un défilement doux
  tombait à côté (tracé sur `#lobby`) et le tirage suivant n'avait pas lieu. Un
  `window.scrollTo(0, 0)` sans `behavior` hérite lui aussi du défilement doux.
  Course **intermittente** (2 sur 2 un jour, 0 sur 6 le lendemain, variantes
  comprises) : un avant / après ne prouve donc rien. `J.scrollFini()` attend la
  FIN réelle du défilement (`scrollY` stable 6 images d'affilée, par
  `requestAnimationFrame`), la page remonte en `instant`, et on attend à nouveau ;
  le test vérifie qu'elle est bien stable en haut. Pas d'attente fixe, et le
  produit n'est pas touché.
- Le contenu d'un `<details>` fermé (jeux indisponibles) est en
  `content-visibility: hidden` : `offsetParent` n'y est PAS nul. Tester la
  visibilité avec `checkVisibility()`.

## Lots UX du Game Hub (2026-09-27) : ce que chaque suite garde

Front seulement (lot B : retour de partie, lot A : hiérarchie du salon ; voir
CLAUDE.md, « Game Hub : le salon et le retour de partie »).

| Suite | Ce qui a été ajouté | Normal | Réduit |
|---|---|---|---|
| `hub-recap.mjs` | `HubRecap.lastResult()` (partie normale, ex æquo, solo, joueur parti, pas classé, **aucune carte sans partie classée**) ; carte Résultat dans la vraie page à 1280 / 1100 / 390 px ; focus sur le titre ; rechargement sans rien rejouer ni doubler | 76 | 76 |
| `hub-score.mjs` | carte Résultat chez l'hôte (« Tirage suivant » dans la carte) et les invités (« En attente de Alice ») ; gain en pastille ; score vide en une ligne ; ordre du salon et place de « Tirer » / « Terminer » à 390 / 768 / 1100 / 1280 px | 80 | 80 |
| `hub-play.mjs` | action de l'hôte sous les joueurs, attente de l'invité, changement d'hôte (le bouton suit), score vide à 2 et 12 joueurs, salon rangé au départ | 56 | — |
| `hub-draw.mjs` | plaque / couvercle (échoue sur l'ancienne marge : −11 px) ; catalogue : possibles d'abord, indisponibles repliés avec leur raison, dépliés d'office s'il n'y a plus rien ; **ordre de tabulation réel** (code → Tirer → durée → ❤️/🚫 → indisponibles → Quitter → Terminer) et fin du défilement attendue | 92 | 90 |
| `hub-finale.mjs` | « Terminer » secondaire (liseré rouge, sans fond plein), dans le panneau des jeux, loin de « Tirer » | 34 | 32 |
| `hub-score-morpion.mjs` | carte Résultat à chaque partie (sans points de partie) ; **aucune carte après l'abandon**, « Tirer » à sa place | 52 | — |
| `hub-score-precision.mjs` | solo : une ligne, sans rang, « Partie terminée · +10 pts », « Tirage suivant » dans la carte | 41 | — |

## Lot C — tirage → lancement (2026-09-28) : ce que chaque suite garde

Front seulement (CLAUDE.md, « Le tirage » et « Handoff et présence »). Le
parcours à deux clics de l'hôte est CONSERVÉ : les sept suites `handoff-*.mjs`
le rejouent tel quel et passent (Morpion 58, Imitation 34, Demi-Cercle 68,
Ban 76, Précision 79, Qui Ment ? 61, Le Passeur 47 ; Morpion avec
`NODE_PATH` = `node_modules` de game-hub-server).

| Suite | Ce qui a été ajouté | Normal | Réduit |
|---|---|---|---|
| `hub-draw.mjs` | **plusieurs jeux** : bande présente, vignette gagnante = jeu du serveur, « 🎯 Jeu tiré », nom plus gros que tout le reste de la fiche, état réservé aux lecteurs d'écran, focus sur « ▶ Continuer — lancer … », attente de l'invité, encart du haut à jour, pas de « ?. » ; hôte et invité à 390 / 768 / 1100 / 1280 px. **Un seul jeu** : bande jamais affichée ni déplacée, révélé en moins de 1,5 s, « Seul jeu possible ce soir », les 4 largeurs, puis « Continuer » à la **vraie touche Entrée** | 114 | 112 |
| `hub-play.mjs` | du tirage au lancement à deux : libellés, focus qui passe tout seul sur « ▶ Ouvrir … », encart « à toi » et titre d'onglet chez l'hôte seulement, `role=status`, fiche resserrée, 4 largeurs, puis annulation → salon comme avant, onglet rendu. **Trois tirages séparés par un lancement annulé**, chez l'hôte et l'invité : la bande visible, qui DÉFILE (positions relevées pendant la rotation), arrêtée sur le jeu du serveur — échoue sur le code d'avant le correctif (0 position aux tirages 2 et 3). `--reduced` ajouté | 73 | 73 |
| `handoff-play.mjs` | un seul jeu (pas de bande) chez les trois ; focus et onglet « ▶ Ouvrir Le Passeur » ; invité : onglet « ▶ Rejoindre Le Passeur », encart « à toi », titre annoncé ; onglet rendu au retour. A attrapé la course du défilement doux (voir CLAUDE.md) | 47 | 47 |

## Lot D — finale de soirée (2026-09-29) : ce que chaque suite garde

Front seulement (CLAUDE.md, « Débrief et fin de soirée »). La finale n'est plus
le récap rebaptisé : les deux suites vérifient la COMPOSITION, chacune dans son
sens.

| Suite | Ce qui a été ajouté | Normal | Réduit |
|---|---|---|---|
| `hub-recap.mjs` | `HubRecap.podium()` / `finalPlace()` seuls : 3 joueurs, ex æquo 1-1-3 (pas de marche 2e), 1-2-2-4-5, tous ex æquo (une marche), 2 joueurs, solo, 0 point (pas de médaille), fin sans partie (aucune marche), rien de retrié. Dans la page : le récap reste une LISTE (ni `.is-podium` ni marche, pas de « Ta place finale », dernier jeu + dernier gain, « crée une session ») | 89 | — (non relancé en réduit) |
| `hub-finale.mjs` | focus sur le titre chez les trois ; composition (podium, socles « 1er ex æquo » / « 3e », « Ta place finale », plus de dernier gain, « Retour à l'accueil ») ; `aria-label` des lignes (ex æquo, parti) et annonce finale avec ta place ; révélation < 4,5 s, socles couchés au début ; en réduit : aucune animation, socles dressés, tout visible, annonce faite ; géométrie du podium à 1280 / 1100 / 768 / 390 px (ex æquo : marches empilées au téléphone, pochoir sur une ligne DANS le biseau) ; 2 joueurs (pas de 3e) ; **3 joueurs / 3 parties** (2e · 1er · 3e, socles décroissants, « 2e sur 3 », « 3 parties jouées », historique compact) ; **solo avec une partie** (plaque, sans socle ni « Ta place ») ; fin sans partie = aucun podium fabriqué ; focus sur « Créer une session » au retour | 67 | 65 |

Contre-épreuve : sur le code d'avant les deux correctifs relevés aux captures,
`hub-finale.mjs` échoue 3 fois (« 1 parties jouées » deux fois, « EX ÆQUO » sur
deux lignes par-dessus le biseau à 390 px). ⚠️ Après `finish`, le Hub ferme
LUI-MÊME les sockets des joueurs : `fermer()` d'un client Node doit rendre la
main si le socket est déjà fermé (sinon la suite attend pour toujours).

## Livraison fiable results → ended (2026-09-28) : `hub-report.mjs`, `hub-report-play.mjs`

Le défaut (CLAUDE.md, « Livraison fiable du classement ») : un `send()` sur un
socket Hub fermé ou en CONNECTING était jeté en silence, et rien n'était
rejoué. Les deux suites ÉCHOUENT sur le code d'avant — vérifié en remettant
`games/` de `58f48d9` : 21 échecs pour `hub-report.mjs` (score `{}`, Hub bloqué
en `inGame`), et `hub-report-play.mjs` s'arrête sur « debrief jamais reçu ».

| Scénario | `hub-report.mjs` | `hub-report-play.mjs` |
|---|---|---|
| envoi normal, `results()` appelé deux fois | A | — (couvert par `hub-score-*.mjs`) |
| socket fermé avant `results` → reprise → rejoué | B | 1 (page du jeu) |
| socket en CONNECTING avant `results` | C | — |
| `results` livré, socket perdu avant `ended` | D | — |
| les deux perdus → `results` PUIS `ended` | E | 1, 2 |
| `results` appliqué, confirmation perdue → pas de double score | F | — |
| reconnexion après la fin : rien de renvoyé | G | 2 (rechargement) |
| retour à `/games/` puis rechargement pendant la livraison | H | 2 |
| ancien tirage / autre session : jamais rejoués | I | — |
| une fois par connexion, borne de 5, refus définitifs, étape `join` | P (faux client) | — |

Trois pièges de plomberie, tous rencontrés :

- ⚠️ **Le WebSocket de Node n'émet pas `close` sur une connexion refusée** :
  seulement `error`, et il reste en CONNECTING. Un navigateur émet `error` PUIS
  `close`. Sans le `close` que le harnais rend lui-même, le client attend son
  délai de 45 s et le scénario E expire.
- Pour simuler un Hub injoignable, un port qu'on vient de **libérer** — pas 1
  ni 9 : les ports « réservés » sont bloqués d'office (Node comme Chromium).
- Comparer les scores **sans l'ordre des clés** : il suit l'ordre
  d'application du classement, pas son sens.

`hub-report-play.mjs --prod` sert de sonde de production : il crée une vraie
session sur le Hub Render et joue deux Morpions sur le vrai `morpion-server`,
avec le front de CE dépôt servi en local (sans `?hub=` ni `?server=`).
