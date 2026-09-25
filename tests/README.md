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
