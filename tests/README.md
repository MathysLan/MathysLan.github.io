# Tests du front

Des suites qui ne se recouvrent pas :

| Fichier | Ce qu'il couvre |
|---|---|
| `front.html` | le portfolio : rendu des cartes, lightbox, palette Ctrl+K, FR/EN, thèmes, guichet, presse-papiers, menu mobile, sans JS |
| `games.html` | le **socle commun** des pages de jeux : polices locales, favicon, retour au portfolio, messages d'état, avatars, `?server=`, mouvement réduit, téléphone |
| `keyboard.mjs` | le focus clavier, avec de **vraies frappes Tab** (voir plus bas) |
| `manifest.mjs` | le **manifest des jeux** (`data/games.manifest.json`) : cohérence avec `data/games.js` et avec les clients, et les garde-fous du build |
| `profile.mjs` | le **profil local** (pseudo + avatar) : tests unitaires du module, puis intégration sur les vraies pages de jeux |
| `hub-stats.mjs` | **les statistiques de joueur dans le Game Hub** : nouveau joueur (une phrase, pas de zéros), 4 parties jouées par le protocole avec l'id ET la clé du profil, ex æquo, joueur parti, renvoi refusé, rechargement, pseudo changé, autre clé, Hub sans statistiques, solo seul, 390 → 1280 px, clavier et annonce (voir « Lot H ») |
| `hub-public-profile.mjs` | **les profils publics dans le Game Hub** : « 👤 Profil » sur les cartes des autres (le sien garde « ton profil »), rien demandé avant le clic, profil de Bob chez Ana = profil privé de Bob, nouveau joueur, joueur sans clé, joueur qui part panneau ouvert, clavier (Tab, Entrée, Échap, focus rendu et gardé), « Ton profil » après, 390 → 1280 px, soirée à deux, refus (autre soirée, id forgé), aucune fuite (voir « Lot K ») |
| `hub-achievements.mjs` | **les succès dans le Game Hub** : 10 verrouillés au départ, victoire à 6 → retour au Hub → deux notifications l'une après l'autre (1/2, 2/2), focus intact, annonce unique ; rien de rejoué (rechargement, autre onglet, autre navigateur) ; profil (obtenus d'abord, « Nouveau », date) ; fenêtre ouverte = attente ; garde-fou local ; survol ; 390 px tactile ; codes = serveur (voir « Lot J ») |
| `hub-profile.mjs` | **le profil joueur dans le Game Hub** : aucun profil, pseudo nettoyé, icône, photo, stockage corrompu / bloqué, joueur sans profil, la même identité du salon à la finale, panneau « ton profil » au clavier, 390 → 1280 px (voir « Lot G ») |
| `passeur-play.mjs` | **une partie réelle du Passeur**, avec de vrais clics, un vrai tactile et de vraies touches (voir plus bas) |
| `avatar-play.mjs` | **la photo de profil en vraie partie**, dans les six jeux qui reçoivent une identité, à trois joueurs (voir plus bas) |
| `hub.mjs` | le **client du Game Hub** (`games/shared/game-hub.js`) : unitaires, puis protocole contre le vrai `game-hub-server` (local, ou `--hub wss://…`) |
| `hub-play.mjs` | **le salon du Hub dans deux navigateurs** : créer, rejoindre, avatars, hôte, reprise ; **coupure de socket** (absent, grâce conservée, retour avec le même id) puis **« Quitter »** (A disparaît tout de suite chez B ; le dernier qui part ferme la session sur-le-champ) ; 12 puis 16 joueurs (le plafond), 17e refusé (`--hub wss://…` pour la production) |
| `handoff.mjs` | **le handoff, protocole réel** : le vrai `game-hub-server` ET le vrai `passeur-server` lancés en local, trois joueurs en Node — room créée par l'hôte, code relayé, invités entrés, une manche jouée et notée |
| `handoff-play.mjs` | **le handoff dans trois navigateurs**, jusqu'au bout : portfolio → Hub → tirage → « Ouvrir Le Passeur » → room réelle → rechargement d'un invité → « Rejoindre » → une seule room → 3 manches au clavier → classement → retour au Hub ; plus le cas « serveur du jeu injoignable ». `--reduced`, `--shots` |
| `handoff-morpion.mjs` | **le handoff du Morpion**, vrai `game-hub-server` + vrai `morpion-server` : protocole en Node (room créée par `{ action: 'join' }` sans code, code relayé, `playing`, victoire, « room pleine », debrief), puis deux navigateurs de la home jusqu'au retour au Hub, un second lancement où l'invité part en pleine partie, un troisième où l'hôte perd sa connexion en attente (lancement annulé pour le groupe), et le jeu hors Hub. Relit chaque trame **envoyée** à `morpion-server` : ni `name`, ni `avatar`, jamais. `--reduced`, `--shots` |
| `handoff-croquis.mjs` | **le handoff de Croq.ios** : vrai `game-hub-server` + vrai `croquis-server`, le manifest du dépôt (Croq.ios y est une fois, `handoff: true`) avec la santé de Croq.ios sur le serveur local. Billet (valide, autre jeu, périmé, illisible), puis quatre navigateurs : room créée par le billet (`launched` avec SA place), invité entré (`entered`), « Lancer » attend Chloé, départ sans elle (`started` au premier tour), Chloé refusée (`abort`), partie au chrono jusqu'à `results` PUIS `ended` (hôte seul), score de soirée, retour au Hub ; hors Hub avec des billets invalides puis sans billet ; relit chaque trame envoyée à `croquis-server` (mêmes actions, même `join`, avec ou sans Hub). 56 vérifications, ~1 min. `--reduced`, `--shots`, `--serveur <dossier>` |
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
| `hub-score.mjs` | carte Résultat chez l'hôte (« Tirage suivant » dans la carte) et les invités (« En attente d'Alice ») ; gain en pastille ; score vide en une ligne ; ordre du salon et place de « Tirer » / « Terminer » à 390 / 768 / 1100 / 1280 px | 80 | 80 |
| `hub-play.mjs` | action de l'hôte sous les joueurs, attente de l'invité, changement d'hôte (le bouton suit), score vide à 2 et 12 joueurs, grille à 12 et 16, 17e refusé, salon rangé au départ | 56 | — |
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
| `hub-draw.mjs` | **plusieurs jeux** : bande présente, vignette gagnante = jeu du serveur, « 🎲 Jeu tiré » (🎯 avant le lot E), nom plus gros que tout le reste de la fiche, état réservé aux lecteurs d'écran, focus sur « ▶ Continuer — lancer … », attente de l'invité, encart du haut à jour, pas de « ?. » ; hôte et invité à 390 / 768 / 1100 / 1280 px. **Un seul jeu** : bande jamais affichée ni déplacée, révélé en moins de 1,5 s, « Seul jeu possible ce soir », les 4 largeurs, puis « Continuer » à la **vraie touche Entrée** | 114 | 112 |
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

## Lot F — fin de partie → retour au Game Hub (2026-09-29)

Composants communs touchés (`hub-handoff.js` : `endActions` ; `game-ui.css` :
classes de fin en mode Hub, anneau intérieur des boutons découpés), d'où une
régression large. La vérification de fin est écrite UNE fois,
`tests/hub-end.mjs` (`finHub(J, t, jeu, { replay, icone, hote })`), et appelée
là où une vraie partie lancée par le Hub se termine dans un vrai navigateur :
retour au Hub = action principale (bouton plein, focus dessus), revanche
« ↻ Revanche (hors score) » secondaire et APRÈS lui (sauf le rond de
Précision, qui reste dans le plateau), rien ne déborde à 390 / 768 / 1280 px,
captures `fin-hub-*` avec `--shots`. « Rien de recompté par une revanche » :
là où elle est vraiment jouée (`hub-score-quiment.mjs`, `quiment-replay.mjs`).

| Suite | Ce qui a été ajouté | Vérifications |
|---|---|---|
| `keyboard.mjs` | pixels dorés comptés sur chaque élément DÉCOUPÉ atteint au vrai Tab (7 jeux) | 8 pages : 18 boutons découpés + le retour au Hub des 7 jeux (Maj+Tab / Tab), en pixels |
| `handoff-play.mjs` | `finHub` : Passeur, hôte (revanche) et invité (sans) | 57 |
| `hub-score-morpion.mjs` | `finHub` : Morpion, les deux joueurs, pas de revanche | 60 |
| `hub-score-imitation.mjs` | `finHub` : Imitation, `#back-lobby` | 27 |
| `hub-score-demicercle.mjs` | `finHub` : Demi-Cercle, `#back-lobby` | 31 |
| `hub-score-ban.mjs` | `finHub` : Ban, `#to-lobby` | 34 |
| `hub-score-precision.mjs` | `finHub` : Précision, le rond `#fab` (`icone`) | 51 |
| `hub-score-quiment.mjs` | `finHub` : à la 1re fin (avant « Rejouer ») ET à la fin de la revanche | 50 |
| `quiment-replay.mjs` | inchangé — a ATTRAPÉ un second `start` : la revanche ayant changé de place, le 2e clic d’un double clic tombait sur « Lancer la partie » du salon (corrigé dans `quiment/app.js`, `relance`) | 36 |

Contre-épreuves (code d'avant, tests d'après) : `keyboard.mjs` KO dans les 7
jeux (14 boutons découpés sans anneau visible) ; `handoff-play.mjs` 3 KO
(« Rejouer » en 16,8 px avant le retour au Hub, pas de focus).
⚠️ La capture de `finHub` marque le parent de `#to-hub` (`data-fin-hub`),
attribut de test seulement.

## Lot E — roulette et textes (2026-09-30)

Front seulement (CLAUDE.md, « Le tirage »). `game-hub.js` touché (`GameHub.de`,
`reasonText`) : `?v=5` sur les huit pages qui le chargent.

| Suite | Ce qui a été ajouté | Normal | Réduit |
|---|---|---|---|
| `hub-draw.mjs` | `GEOM` / `arret()` : la bande reste arrêtée SUR le jeu du serveur (vignette gagnante sous le repère, entière dans la bande, écart ≤ 30 % d'une vignette, 0 en réduit) — 1er tirage fini puis 390 / 768 / 1100 / 1280 px chez l'hôte et l'invité, rotation 390×780 ↔ 844×390 ; 2e tirage lancé à 390 px, **redimensionné à 1100 px en plein défilement**, puis 390 / 768 / 1100 / 390 ; 3e tirage après toute la série, puis 390 px ; « En attente d'Alice » | 144 | 141 |
| `hub.mjs` | `GameHub.de()` sur les 8 titres du manifest (« d'Imitation », « du Jeu du Ban », « du Passeur »…) et 15 pseudos (voyelles accentuées, minuscule, H / Y / chiffre / emoji → « de ») ; « veto d'Alice et Bruno » | 86 | — |
| `hub-play.mjs` | annulation : « Lancement de X annulé » (hôte), « … annulé par l'hôte » (invité), plus « a échoué » | 75 | 75 |

Contre-épreuve : `hub-draw.mjs` avec l'ancien `hub-crate.js` → 10 KO, tous de
géométrie (autre vignette sous le repère, jusqu'à −2,25 vignettes), dont le
redimensionnement en plein défilement. Un tirage NEUF sans redimensionnement
passe sur l'ancien code : seule la mesure après coup voit le défaut.

## Lot G — profil joueur (2026-09-30) : `hub-profile.mjs`

Front seulement (CLAUDE.md, « Profil et avatars »). `game-profile.js` touché
(`cleanName`, copie de la page) : `?v=2` sur les huit pages qui le chargent.

    node tests/hub-profile.mjs                 ~20 s, vrai game-hub-server local
    node tests/hub-profile.mjs --reduced
    node tests/hub-profile.mjs --shots <dir>   profil fermé / ouvert, nom long 390 / 1280, photo, clavier

Cinq navigateurs isolés + des clients Node (les parties classées sont jouées
par le protocole, comme `hub-finale.mjs`). A : aucun profil (id écrit une
fois, stable), pseudo nettoyé (invisibles, U+202E, espaces, 16 unités sans
couper un emoji, HTML affiché en texte), icône, photo, restauré au
rechargement. E : stockage illisible, profil hostile (SVG refusé), puis le Hub
reçoit le pseudo NETTOYÉ. P : **stockage bloqué** (`localStorage` qui jette,
posé par `Page.addScriptToEvaluateOnNewDocument`) → on entre quand même, un
seul id, nom long (16 × W) sans débordement à 390 / 768 / 1100 / 1280 px,
panneau compris. F : sans profil, rejoint comme avant. G : la même identité
(pseudo + photo) dans le salon, le score, la carte Résultat, le panneau, le
récap et la finale ; un profil local changé ailleurs ne remplace pas
l'identité de la soirée (le panneau le dit). I : vraie touche Tab jusqu'à
« ton profil » (anneau doré), Entrée ouvre (modal, focus sur « Fermer »),
Échap ferme et rend le focus ; salon redessiné par un état du Hub : le focus
reste sur le bouton, panneau ouvert ou non.

| Suite | Ce qui a été ajouté / changé | Normal | Réduit |
|---|---|---|---|
| `hub-profile.mjs` | nouvelle suite (ci-dessus) | 46 | 46 |
| `profile.mjs` | harnais : `click()` amène l'élément à l'écran — « retirer » (photo) de Qui Ment ? était à y = 573 px dans une fenêtre de 450, le clic était perdu et le test échouait déjà sur `ea0262f`, sans que la page soit en cause | 31 lignes | — |

Contre-épreuve : `hub-profile.mjs` avec `game-profile.js` SANS la copie de la
page (`cleanName` déjà posé) → 1 KO, « stockage bloqué : on entre quand
même » (« Choisis un pseudo avant de continuer. ») ; vert avec elle.

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

## Lot H — statistiques de joueur (2026-09-30) : `hub-stats.mjs`

Serveur d'abord (game-hub-server : `src/stats.js`, `store-pg.js`,
`store-memory.js`, message `stats`), front ensuite. `game-hub.js` et
`game-profile.js` touchés : `?v=6` / `?v=3` sur les huit pages.

    node tests/hub-stats.mjs                 ~10 s, vrai game-hub-server local (HUB_STATS=memory) + un second SANS stats
    node tests/hub-stats.mjs --reduced
    node tests/hub-stats.mjs --shots <dir>   vide, rempli 1280 / 390, solo, indisponible

La vérité (définitions, clé, doublons, panne, 9 joueurs, SQL) est éprouvée
côté serveur : `game-hub-server/test-stats.js` (50 vérifications, + 5 en SQL
avec `TEST_DATABASE_URL`). Pour ces 5-là sans Postgres sur le poste : PGlite
(le vrai moteur Postgres en WebAssembly) installé DANS LE SCRATCHPAD —
`npm i @electric-sql/pglite @electric-sql/pglite-socket`, puis
`node node_modules/@electric-sql/pglite-socket/dist/scripts/server.js -p 55432 -m 6`
et `TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/postgres`. ⚠️ Arrêter
ce serveur par le PID qui écoute sur le port, jamais `taskkill /IM node.exe`.

| Suite | Ce qui a été ajouté | Normal | Réduit |
|---|---|---|---|
| `hub-stats.mjs` | nouvelle suite (ci-dessus) | 27 | 27 |
| `hub.mjs`, `profile.mjs`, `hub-profile.mjs` | inchangées, vertes avec la clé et le message `stats` | 86 / 31 lignes / 46 | — |

## Lot I — records personnels (2026-10-01) : `hub-stats.mjs` étendue

Aucune nouvelle suite : les records sont dans la MÊME réponse `stats`
(`stats.records`, dérivé du résumé dans game-hub-server `src/stats.js`).
`game-hub.js` touché (relecture de `records` en liste blanche) : `?v=7` sur
les huit pages.

    node tests/hub-stats.mjs                 ~1 min
    node tests/hub-stats.mjs --reduced
    node tests/hub-stats.mjs --shots <dir>   + nom long à 390 px (records-nom-long-390)

Ajouté : relecture en Node de `readStats` (Hub d'avant le lot I = section
cachée, `records` forgés filtrés) ; « Pas encore de record. » ; les quatre
cartes (meilleure place, victoires, jeu le plus joué, meilleur jeu) ; égalité
à deux jeux (les deux, sans départage) et à quatre (« 4 jeux », annonce
complète) ; « meilleure place : 1er » dans « Par jeu » ; nom de jeu long en
« … » (titre allongé dans `GAMES`, panneau rouvert à 390 px) ; panneau
refermé / rouvert, rechargement, pseudo changé, autre clé, Hub sans stats ;
solo (« Aucun record compétitif pour l'instant. » + le jeu le plus joué) ;
rien d'un autre joueur (ni nom dans le panneau, ni id dans les réponses).

Côté serveur, `game-hub-server/test-stats.js` : définitions pures des records
(aucune partie, solo, une / plusieurs victoires, meilleur jeu ≠ plus joué,
égalité, ex æquo 1, 1, 3, sans victoire), puis sur de vraies connexions
(joueur parti, plusieurs jeux, pseudo changé, doublon, reconnexion, autre clé,
panne). 69 vérifications, 75 avec `TEST_DATABASE_URL` (PGlite, voir lot H) :
records SQL = records mémoire.

| Suite | Ce qui a été ajouté | Normal | Réduit |
|---|---|---|---|
| `hub-stats.mjs` | records (ci-dessus) | 48 | 48 |
| `hub-score-contract.mjs`, `hub-profile.mjs`, `hub-recap.mjs`, `hub-finale.mjs`, `handoff-play.mjs` | inchangées, vertes | 125 / 46 / 89 / 67 / 57 | — |

## Lot J — succès (2026-10-01) : `hub-achievements.mjs`

Serveur d'abord (game-hub-server : `src/achievements.js`, table
`hub_achievements`, message `achievement`, action `achievements-seen`), front
ensuite. `game-hub.js` (`?v=8`, huit pages) et `hub-page.js` (`?v=16`) touchés.

    node tests/hub-achievements.mjs              ~1 min 30, vrai game-hub-server local (HUB_STATS=memory)
    node tests/hub-achievements.mjs --reduced
    node tests/hub-achievements.mjs --shots <d>  notification 1280 / 390, profil 1280 / 390
    node tests/hub-achievements.mjs --pg <url>   le Hub sur une base Postgres de TEST (tables hub_* vidées)

Les parties sont jouées par des clients Node avec l'id ET la clé du profil du
navigateur, qui revient ensuite au Hub (le vrai retour d'une partie). La
notification est suivie DANS la page (MutationObserver : apparitions,
compteur, focus, annonce, durée de transition). `(pointer: coarse)` exige
l'émulation tactile (`Emulation.setTouchEmulationEnabled`) : redimensionner
ne suffit pas. En mouvement réduit, `game-ui.css` force `.01ms` partout : le
test accepte ≤ 1 ms.

La vérité (définitions aux bornes, rejeu, premier déblocage, accusé, joueur
parti, panne, rattrapage silencieux, SQL) est côté serveur :
`game-hub-server/test-achievements.js` (78, 94 avec `TEST_DATABASE_URL` /
PGlite, voir lot H). Contre-épreuves faites : quatre mutations serveur (accusé
ignoré, pas de livraison au retour, nul qui ne casse pas la série, 5 h
incluse) et deux côté page (pas d'attente sous une fenêtre, pas d'accusé),
toutes attrapées.

| Suite | Ce qui a été ajouté | Normal | Réduit | Postgres |
|---|---|---|---|---|
| `hub-achievements.mjs` | nouvelle suite (ci-dessus) | 36 | 34 | 36 |
| `hub-stats.mjs` | attentes ajustées : le texte « pas de zéros » exclut la section des succès (compteur « 0/10 ») et l'annonce ; l'annonce finit par « Succès : 2 sur 10. » | 48 | 48 | — |

Régression large (game-hub.js et l'entrée au Hub ont changé) : `npm test` du
Hub (14 fichiers), `hub` 86, `hub-draw` 144, `hub-play` 75, `hub-profile` 46,
`hub-recap` 89, `hub-finale` 67, `hub-report` 59, `hub-score-contract` 125,
`hub-score` 80, `hub-score-ban` 34, `-demicercle` 31, `-imitation` 27,
`-morpion` 60, `-precision` 51, `-quiment` 50, `handoff` 22, `handoff-play` 57,
`handoff-ban` 76, `-demicercle` 68, `-imitation` 34, `-morpion` 58,
`-precision` 79, `-quiment` 61, `quiment-replay` 36, `profile` 31 lignes,
`keyboard` : tout vert. ⚠️ Ban, Demi-Cercle, Imitation, Morpion et Précision
n'ont pas de `node_modules` sur ce poste : leurs `handoff-*` et
`hub-score-*` (sauf Morpion, qui le prête lui-même) exigent
`NODE_PATH=C:\perso\game-hub-server\node_modules`, sinon le serveur de jeu ne
démarre pas (« injoignable », ou suite muette).

## Lot K — profils publics (2026-10-01) : `hub-public-profile.mjs`

Serveur d'abord (game-hub-server : action `public-profile`, annonce
`profiles`), front ensuite. `game-hub.js` (`?v=9`, huit pages) et
`hub-page.js` (`?v=17`) touchés.

    node tests/hub-public-profile.mjs              ~1 min 30, vrai game-hub-server local (HUB_STATS=memory), deux navigateurs
    node tests/hub-public-profile.mjs --reduced
    node tests/hub-public-profile.mjs --shots <d>  profil public 1280 / 390, nouveau joueur, joueur parti, salon 390

Qui voit quoi est éprouvé côté serveur : `game-hub-server/test-public-profile.js`
(27 — soi, même soirée, autre soirée, ids forgés et pièges `__proto__` /
`constructor`, usurpation d'id sans et avec fausse clé, joueur sans clé,
parti, panne, aucune fuite). Contre-épreuves : sans la vérification de la clé
de la cible, 4 échecs (Mallory lit les stats de Dan) ; `departed[id]` sans
`hasOwnProperty`, 1 échec (`constructor`).

Entrée sur un `<button>` natif par CDP : `keyDown` AVEC `text: ''` (comme
`hub-stats.mjs`) ; un `rawKeyDown` sans texte n'active pas le bouton. Les
titres de section sont en majuscules CSS : `innerText` rend « SUCCÈS ».

## Croquis, lot front 1 — l'atelier de dessin (2026-10-03)

Dessin LOCAL seulement (`games/croquis/`, pas de réseau, page en `noindex`
liée nulle part). La règle du trait est dans `games/croquis/dessin.js`
(module pur, page + Node) : index du protocole de `croquis-server`
(couleur 0–11, gomme 12, taille 0–2), 1000 × 750, 150 traits, 1 000 points.

    node tests/croquis-dessin.mjs                  instantané : conversion, bornes, resize, palette, historique, lissage
    node tests/croquis-atelier.mjs                 ~20 s, Edge headless, vraies entrées souris / doigt / stylet
    node tests/croquis-atelier.mjs --shots <d>     bureau 1280 et 900, téléphone 390 portrait et 844 paysage

`croquis-atelier.mjs` vérifie AU PIXEL de la feuille (couche `#base`) : trait
sous le pointeur, couleurs, épaisseur, gomme, Ctrl+Z, Effacer en deux appuis,
bords, tracé rapide, deux doigts (un seul dessine), aucun défilement au doigt,
et le même dessin aux mêmes fractions après resize et rotation. ⚠️ Mesurer la
TAILLE de la feuille, pas seulement sa visibilité : en paysage, une colonne
`auto` la réduisait à 240 px sans qu'aucun test « visible » ne bronche.
Le surlignage d'appui natif (`-webkit-tap-highlight-color`) est coupé sur les
outils : en émulation mobile, il passait pour un état « choisi ».

## Croquis, lot réseau 1 — le dessin synchronisé (2026-10-03)

La page (`games/croquis/`) a maintenant un salon et se branche sur
`croquis-server` : `jeu.js` (salon, messages), `net.js` (même convention d'URL
que les autres jeux, `?server=`), `sync.js` (module pur : envoi par lots de
~50 ms au format exact du serveur, réception, snapshot, ancien `turnId`
ignoré). L'atelier libre est passé derrière `?atelier`. Pas encore de
devinettes, de choix de mot (tirage auto du serveur), de score ni de Hub.

    node tests/croquis-sync.mjs                    instantané : lots, undo/clear, réception, doublons, snapshot, aller-retour
    node tests/croquis-network.mjs                 ~1 min, VRAI croquis-server local + Edge (bureau souris, téléphone doigt) + robots
    node tests/croquis-network.mjs --shots <d>
    node tests/croquis-network.mjs --serveur C:\perso\croquis-server   (par défaut : ../croquis-server, sinon C:\perso)

`croquis-network.mjs` joue le scénario de dessin DEUX fois (tour 1, puis tour 2
rôles inversés) : la souris et le doigt dessinent à chaque passage, quel que
soit l'ordre tiré par le serveur. Comparaison trait pour trait (modèle) et au
pixel ; un espion relève ce que chaque onglet envoie et reçoit.
⚠️ Capture d'un onglet d'arrière-plan : `Page.bringToFront` d'abord, et une
capture bornée à 5 s — sinon elle bloquait plus d'une minute, le tour expirait
au chrono et toute la suite tombait en `STALE_TURN`.
⚠️ Les deux onglets partagent le profil Edge (donc `localStorage`) : au second
salon, ils portent le même pseudo. Sans conséquence sur ce qui est testé.
Bug trouvé par le doigt : sans `preventDefault()` sur `touchstart`/`touchmove`
de la feuille, le premier appui sur un outil après un trait ne produisait aucun
`click` (Chromium voyait un défilement lancé) — gardé par `croquis-atelier.mjs`.

## Croquis, lot gameplay 1 — un tour jouable (2026-10-03)

Choix du mot (3 boutons sur la feuille, au seul dessinateur ; tirage auto à
l'échéance), gabarit et indices (une case par lettre, lettres révélées en
évidence ; lecture en clair en `.sr-only`), devinettes (champ de 40, fil du
tour : mauvaises réponses publiques, « a trouvé » sans le mot, « presque » et
refus à l'auteur seul, mot entre trouveurs), chrono (`remainingMs`, décompté
ici), fin du tour (motif, mot donné). Pas encore : score affiché, classement,
écran de fin, Hub. `jeu.js` seul porte ce lot (+ balisage et CSS).

    node tests/croquis-tour.mjs                    ~30 s, VRAI croquis-server (choix 4 s, dessin 12 s) + Edge + 1 robot
    node tests/croquis-tour.mjs --shots <d>

Harnais partagé : `tests/croquis-harnais.mjs` (serveur, Edge, onglets,
robots ; `croquis-network.mjs` garde sa copie). Trois joueurs, la 1re manche :
chaque tour est joué selon QUI dessine (ordre tiré par le serveur) — choix
manuel + devinettes, choix auto + indices + chrono, tour du robot. Contre-
épreuves : sans le filtre `duTour` sur `chat`, 2 échecs ([18]) ; champ jamais
éteint, 7 échecs.
⚠️ Un contrôle de fuite sur le JSON d'un message doit écarter `type` : « chat »
est un mot de la fixture ET un type de message. ⚠️ `innerText` compte le texte
d'un `.sr-only` (masqué par découpe) : lire le texte hors `.sr-only`.
⚠️ Un `<input>` en flex garde sa largeur intrinsèque (~207 px) dans le calcul
de largeur minimale, même en `min-width: 0` : `width: 0; flex: 1`, et
`.cote` en `minmax(0, 1fr)` (le panneau débordait de sa colonne, mesuré).
⚠️ `scrollIntoView({ block: 'center' })` dans un harnais fait défiler la page
au toucher d'un outil et sort la feuille de l'écran : `nearest`.

## Croquis, lot gameplay 2 — une partie complète (2026-10-03)

Révélation au `turn-end` (le mot, le motif, le gain de CHAQUE joueur présent —
+0 pour qui n'a pas trouvé, ✏️ le dessinateur — et les nouveaux totaux,
pendant les 6 s du serveur ; aucune saisie), tableau des scores toute la
partie (totaux du serveur : `turn`, `turn-end`, `left` ; trié, « parti »),
manches enchaînées sans écran intermédiaire, écran de fin (`results` tel
quel : médailles 🥇🥈🥉 puis « 4e », ex æquo partagés, mots trouvés, dessins,
« parti » ; « Égalité » ; « Partie interrompue » si `complete: false`) avec
↻ Revanche et ↩ Retour au salon à l'hôte, AVANT le classement (16 joueurs).
Aucun point calculé côté page. Pas encore de Hub.

    node tests/croquis-partie.mjs                  ~3 min, VRAI croquis-server (choix 1,5 s, dessin 7 s, révélation 1,5 s) + Edge + robots
    node tests/croquis-partie.mjs --shots <d>

Un chef d'orchestre joue chaque tour selon un plan (qui devine, quand) et
relit l'écran après chaque tour : révélation et tableau = le `turn-end` ; à la
fin, l'écran = le `results`, et le classement = la somme des gains annoncés.
Parties : 2 joueurs (égalité forcée — à deux, devineur et dessinateur marquent
pareil — puis revanche), 3 joueurs / 3 manches (deux trouveurs à 1,5 s
d'écart, un tour sans trouveur, ancien turnId), 5 joueurs / 2 manches (départ
entre deux tours, dessinateur qui part, retour au salon), 6 joueurs / 1
manche, 16 joueurs, partie incomplète. Contre-épreuve : sans la mise à jour
des totaux au `turn-end`, 3 échecs (totaux à 0 ≠ ceux du serveur).
⚠️ `croquis-tour.mjs` vérifie la fin d'un tour PENDANT sa révélation : à 1,5 s,
le tour suivant commençait parfois avant le dernier contrôle (feuille vidée,
fil d'un autre tour) et tout cascadait. Révélation à 4 s dans cette suite, et
le contrôle « ne dessine plus » échoue en le disant si le tour a déjà changé.
`croquis-partie.mjs` accepte le tirage automatique quand le harnais arrive
après la fenêtre de choix (1,5 s).

## Roquette, armes (skins) — sélecteur et Pétoire (2026-10-05) : `roquette-skins.mjs`

Le choix de l'arme au salon (cosmétique) et la première arme, « La Pétoire de
Secours ». VRAI `roquette-server` (contrat `skin`, `8b7d01a`), deux contextes
Edge ISOLÉS (chacun son `localStorage` : A en mouvement normal, B en mouvement
réduit) et trois robots WebSocket (un ancien client sans `skin`).

    node tests/roquette-skins.mjs                  ~1 min
    node tests/roquette-skins.mjs --shots <d>      salon, Pétoire en jeu, prise de feu, fin

Ce qui est vérifié : la table (`Rocket.SKINS`, repli sur la roquette pour
tout id inconnu ou mal formé, `__proto__` compris), l'ENVELOPPE (portée de la
Pétoire mesurée au pivot ≤ celle de la roquette, danger 3 ; `setSkin` ne
change pas la taille), aucun id de dégradé en double (aperçus préfixés) ; au
salon, roquette par défaut, `aria-pressed`, skin du join (préférence absente,
valide, INVALIDE relue au rechargement), action `skin` → message relayé,
retour à la roquette, skin d'un autre reçu, id inconnu reçu → Roquette,
rafale de 5 clics → le dernier choix part, ≤ 4 envois ; en partie, l'arme
montrée = celle du joueur VISÉ à chaque countdown / turn / boom (sonde posée
après le traitement de chaque message), plus de sélecteur, explosion Pétoire
= feu PUIS étoile commune (+150 ms) avec `fusee` / `crepitement` /
`explosion`, explosion roquette = ses sons d'avant ; en mouvement réduit, ni
vol, ni traînée, ni éclat, flamme figée, sons gardés.

⚠️ La DERNIÈRE explosion d'une partie arrive avec `end`, qui coupe son vol
(comportement d'avant ce lot) : un robot « tape tant que les trois muets n'ont
pas explosé » prend cette explosion-là, les trois étudiées sont complètes.
⚠️ La largeur de l'arme en jeu varie avec la bannière (`fit()` évite aussi
`#cible`) : on ne la compare pas d'un tour à l'autre.
Contre-épreuves : l'arme du joueur LOCAL au lieu du visé → 2 échecs ; un
filtre `SKINS[v]` sans `hasOwnProperty` → 1 échec.

Mode Hub : `handoff-roquette.mjs` (6 vérifications de plus) — B entre par le
Hub avec sa préférence Pétoire, A sans préférence ; skins des join, sélecteur
dans le salon du jeu (aucun écran de plus), changements vus par l'autre,
l'explosion montre l'arme du touché, et AUCUN message vers le Hub ne parle
d'arme.

Pétoire refondue en ARME + PROJECTILE (2026-10-05, même suite, 67
vérifications) : les deux calques sont des éléments distincts (`svg.p-arme`,
`.r-proj > svg.p-fusee`, aucun ne contient l'autre, projectile dessous, même
boîte ; la roquette n'en a aucun) ; la crosse reste en bas quelle que soit la
visée (retournée à gauche) ; en partie, la sonde suit chaque vol IMAGE PAR
IMAGE (écart au repère `.r-aim`) : Pétoire = éclair au départ, le projectile
parcourt au moins la moitié de la course (pivot → avatar − NEZ), l'arme ne
recule que de ~15 px, `.r-fly` ne bouge pas, et à l'impact le projectile est
caché, l'arme visible ; roquette = c'est `.r-fly` qui vole, ni éclair ni
projectile ; impact au même instant pour les deux (±120 ms après `boom`) ;
mouvement réduit : aucun tir animé. Contre-épreuves : sans `projectile: true`
(la Pétoire vole tout entière) → 6 échecs ; sans le retournement → 1 échec.

Pétoire = Scorch Shot (2026-10-05, même suite, 85 vérifications) : les 7
marqueurs du dossier dessinés et MESURÉS sur un hôte de 250 px (canon ≈ 3
diamètres, bouche orange `#c87d4c` sur ~30 % au bord déchiqueté, poignée avant
côtelée sous le canon de 35 % à 100 % avec sa goupille devant, crosse derrière
et dessous, longueur / hauteur 1,75–2,05) ; plus rien de l'ancien dessin
(traînée rose, flamme arrière, pansement, pochoir) ; fusée INVISIBLE chargée
(statique, et à chaque décompte et tour en partie) ; au tir, éclair visible,
gerbe et bouffée animées, recul ≥ 12° ; en vol, fusée visible, tête DEVANT le
corps (produit scalaire avec la direction de tir), fumée rouge ; impact
`.scorch-impact` puis étoile ; roquette d'origine à l'empreinte `38f1849d`.
Contre-épreuves : Pétoire qui revole entière → 10 échecs ; lueur remise à
l'arrière (flamme arrière) → 2 échecs.
