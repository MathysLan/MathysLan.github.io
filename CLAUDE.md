# Portfolio Mathys Langiny — notes d'architecture (à lire en premier)

Ce fichier décrit **l'état actuel** et **les règles** du projet, pour qu'une
nouvelle conversation reparte avec le bon contexte. Lis-le en entier avant de
toucher quoi que ce soit.

L'**historique** (lots, dates, commits, bugs corrigés, diagnostics, chiffres de
tests d'époque) est dans **`docs/journal.md`**. Quand une règle ci-dessous
vient d'un incident, le récit est là-bas. En fin de lot : la règle ici, le récit
dans le journal.

## Le principe de base : front statique + serveurs séparés

- **Le portfolio** (`mathyslan.github.io`) est un site **statique** : HTML +
  Vanilla JS + Tailwind **compilé** (`css/tailwind.css`, plus de CDN). Hébergé
  sur **GitHub Pages**, servi tel quel. Aucun framework. Pas de logique de jeu
  ici. Un seul script de génération, `tools/build.mjs` (Node, zéro dépendance) :
  pré-rendu du contenu de `data/*.js` dans `index.html`, compilation Tailwind
  via `npx`, sitemap, manifest des jeux.
- **Chaque jeu multijoueur a son PROPRE serveur** Node.js (WebSocket, lib `ws`),
  déployé **à part sur Render**, dans son propre dépôt. Ce repo ne contient que
  le **front**.
- **Règle d'or : le serveur est la seule autorité.** Le front envoie des
  *intentions* (« je place mon curseur à 42 », « voici mon indice ») ; le serveur
  valide TOUTES les règles et calcule TOUS les scores. Le front ne calcule jamais
  un score ni ne décide d'une phase. Modèle « zéro confiance » : par ex. la cible
  du Demi-Cercle n'est envoyée qu'au Guide, jamais aux devineurs avant les
  résultats ; les curseurs live ne partent qu'au Guide.
- Protocole : messages **JSON** sur un seul WebSocket. Machine à états par phase,
  progression **pilotée par le MJ/host**.
- Le **Game Hub** (`/games/` + `game-hub-server`) orchestre une soirée entre
  amis : salon, tirage, lancement du jeu, score de soirée. Il ne parle JAMAIS à
  un serveur de jeu : ce sont les navigateurs qui relaient.

## Les jeux

| Jeu | Front | Serveur | Notes |
|-----|-------|---------|-------|
| **Demi-Cercle** | `games/demicercle/` | `demicercle-server` | Cadran SVG, un Guide donne un indice, les autres placent un curseur 0–100. Mode `auto` (thèmes catalogue) ou `custom` (le Guide invente thème + extrémités, mais PAS la cible). |
| **Imitation** | `games/imitation/` | `imitation-server` | Enregistrement voix (MediaRecorder + Web Audio), vidéos de référence sur **Cloudflare R2** (CORS requis). Double waveform référence (ambre) + voix (violet). |
| **Le Jeu du Ban** | `games/ban/` | `ban-server` | Une vidéo (R2) cache un mot interdit à `fatal` (secondes). Chacun son tour, on stoppe au plus tard sans dépasser. Temps recoupé à l'horloge serveur, ordre de passage aléatoire, `fatal` jamais envoyé avant `results`. **Catalogue = `games/ban/videos.json` DANS CE REPO** (`{id, fatal, startAt}`) : le serveur le relit sur Pages à chaque partie (cache 10 s), donc Mathys édite le JSON + push, aucun redeploy. Contrepartie assumée : `fatal` public. Vidéo = `<id>.mp4` à la racine du bucket ; `?server=` et `?cdn=` pour le local. |
| **Précision** | `games/precision/` | `precision-server` | Inspiré de dialed.gg : 4 épreuves (shape/color/sound/time), tout le monde en même temps. Le serveur génère la cible, tient les timers de phase (`memorize`→`play`) et calcule la précision 0–100 % (`engine-precision.js`). Cible envoyée en `memorize` seulement. Jouable seul. |
| **Morpion** | `games/morpion/` | `morpion-server` | Duel strict (X/O). Le serveur ne reçoit AUCUNE identité et ferme la room dès qu'un joueur part. `net.js` est toute l'appli. |
| **Le Passeur** | `games/passeur/` | `passeur-server` | Une situation de volley, cinq passes, cinq secondes. Points = pertinence × vitesse. Barèmes et `why` seulement au `results`. Catalogue `situations.js` + règles `rules.js` côté serveur. |
| **Qui Ment ?** | `games/quiment/` | `qui-ment-server` | Bluff : même mot pour tous sauf l'intrus (qui n'a que la catégorie). 2 tours d'indices en aveugle, vote, révélation, dernière chance. Le mot ne part JAMAIS en diffusion (joueur par joueur, `word: null` pour l'intrus) ; les indices sont ramassés en silence puis révélés d'un bloc ; la liste des mots de la catégorie ne part qu'à l'intrus démasqué. Le test WebSocket du serveur relit **tout le fil** chez l'intrus (seul moyen d'attraper une fuite par un message de progression). Catalogue `mots.js`. |
| **Roquette Party** | `games/roquette/` | `roquette-server` | Jeu de mots en temps réel, 2 à 16 joueurs : des lettres s'affichent, un mot qui les contient avant l'explosion, chaque explosion coûte une vie. L'instant de l'explosion et le dictionnaire ne quittent jamais le serveur ; rang = ordre d'élimination, aucun point de partie. Jeu du Hub (`handoff: true`). Armes cosmétiques (skins) : voir « Roquette Party : les armes ». |
| **Croq.ios** (technique : `croquis`) | `games/croquis/` | `croquis-server` | Jeu de dessin, 2 à 16 joueurs : un dessinateur choisit un mot parmi trois (1 facile, 1 moyen, 1 difficile, catalogue V1 de 318 mots côté serveur), les autres devinent. Le mot ne part qu'au dessinateur jusqu'au `turn-end` ; traits validés et bornés par le serveur. Nom AFFICHÉ « Croq.ios » ; dossier, id, modules JS et serveur restent `croquis` (ne pas renommer). Jeu du Hub (`handoff: true`, 2 à 16 joueurs, 5–18 min, `creatif` + `ambiance`) : même montage que Roquette (`gameId: 'croquis'`, `roomReady` au `you`, `started` au premier `turn`, `results` (rang + score du serveur) puis `ended` à `results` — `ended` seul pour une partie interrompue —, « Lancer sans attendre », `#to-hub`) ; test `tests/handoff-croquis.mjs`. |
| **Puissance 4** | `js/connect4.js` (`launchConnect4`) | aucun | 100 % navigateur, canvas, bot gagner > bloquer > centre. Lancé par le carousel, INSERT COIN, Ctrl+K, Konami. |

- Dépôts serveurs sur le poste de Mathys : `C:\perso\<nom>` (les sept
  ci-dessus + `game-hub-server`). Chacun a ses tests (`npm test`, `test*.js`) :
  un client `ws` qui joue une partie complète et vérifie les règles.
- URL de production utiles : Hub `wss://game-hub-server-qqdk.onrender.com`,
  Ban `wss://ban-server-68h9.onrender.com`, Précision
  `wss://precision-server.onrender.com`, Passeur
  `wss://passeur-server.onrender.com` (les autres : dans le `net.js` / `app.js`
  de chaque jeu, recoupés par `tests/manifest.mjs`), bucket R2
  `pub-427c946793104d1f8e39fbf6d5584ba9.r2.dev`. Toute page de jeu accepte
  `?server=ws://localhost:PORT` ; `/games/` accepte `?hub=`.
- ⚠️ **Plan gratuit Render** : une instance endormie met ~30 s à répondre. Les
  clients le disent (« réveil Render ~30 s ? réessaie ») : un premier échec
  n'est pas une panne.
- Le **carousel** (`js/carousel.js`) est un coverflow 3D ; le drag ne démarre
  qu'après 6 px pour que « Jouer » reste cliquable.
- Les sept jeux en ligne se lancent aussi depuis le Game Hub et partagent le
  même transport (`games/shared/game-net.js`) et la même présence : voir
  « Handoff et présence : l'état des sept jeux ».

## Environnement de dev et façon de travailler

### Le poste de Mathys (Windows, Claude Code en local)

- `git push` fonctionne. **Pas de `gh`** : créer un dépôt GitHub se fait à la
  main par Mathys.
- **Pas de Node ni de Python installés** : pour `tools/build.mjs` et les tests
  `.mjs`, télécharger le zip Node officiel dans le scratchpad (vérifier le
  SHA-256), rien sur le système.
- Navigateur de test : **Edge headless** (`msedge --headless=new`), piloté par
  le protocole DevTools pour tout ce qui est réseau ou clavier.
  - Sous PowerShell, `--dump-dom` ne rend rien (stdout d'un exe graphique) :
    passer par l'outil Bash. Donner un `--user-data-dir` à part.
  - Edge headless n'ouvre pas de fenêtre sous ~500 px : tester 390 px dans une
    iframe. `--screenshot` capture depuis le haut : masquer les autres sections
    plutôt que scroller.
  - ⚠️ **Jeu en réseau : PAS de `--virtual-time-budget`** (il avance minuteries
    et `Date.now()`, toute attente expire avant la réponse du WebSocket). Temps
    réel par DevTools, comme `tests/keyboard.mjs`.
  - En temps virtuel, les animations CSS restent figées à 0 ms
    (`el.getAnimations().forEach(a => a.finish())` puis ~1,5 s) et le SMIL a
    déjà FINI (capture = état final).
  - `edge.kill()` ne tue que le parent : `taskkill /T` + port de debug au
    hasard, sinon des dizaines de msedge fantômes.
  - Frappes par CDP : Tab et Entrée en `rawKeyDown` **sans** `text` (avec
    `text: 'Enter'` le handler ne voit rien). Prouver un anneau de focus exige
    de vraies frappes Tab (`tests/keyboard.mjs`) : `:focus-visible` ne s'allume
    pas sur un `el.focus()` programmé.
- `morpion-server` n'a pas de `node_modules` sur le poste : les tests lui
  prêtent le `ws` de `game-hub-server` par `NODE_PATH` (rien n'est écrit dans
  son dépôt).
- Environnement **cloud** Linux (parfois utilisé pour les serveurs) : le proxy
  bloque le réseau externe (pas de Render ni R2), `git push` y renvoie 403 (ne
  pas retenter) → commit local + livraison en zip ; Playwright sous
  `/opt/pw-browsers/`, playwright global sous
  `/opt/node22/lib/node_modules/playwright`.

### Conventions

- **Tout en français**, ton direct et pragmatique (la voix de Mathys, « zéro
  usine à gaz »). Commentaires de code en français.
- Mathys est spécialiste **Data / Admin BDD**. Pas de sur-ingénierie. Front :
  pas de dépendance lourde, pas de framework, pas de logique de jeu.
- Commits signés ; si le hook local râle après un commit, re-signer la pointe
  avec `git commit --amend --no-edit --reset-author` (faux positif local).
- **Aucun asset Valve** (images, sons, voix) : tout est refait en CSS/SVG. Les
  polices TF2 viennent du tf2-ui-kit de GingerBunny (propriété de Valve, d'où
  « Not affiliated with Valve Corporation » en pied de page).
- Les textes écrits à la place de Mathys (objectifs, stats, « ma part ») lui
  sont soumis avant publication.
- Ordre de livraison quand un contrat change : **serveurs d'abord, front
  ensuite** (un front neuf devant un serveur en retard dégrade au mieux).
- Tout nouveau cache : relever le `?v=` du fichier partagé sur **toutes** les
  pages qui le chargent.

### Politique de tests

- **Ciblée par défaut** : les tests du jeu ou de la fonctionnalité touchés,
  `node tools/build.mjs --check`, et au plus 1-2 suites directement
  dépendantes. Régression large seulement si un composant commun change
  (`game-net.js`, `hub-handoff.js`, `game-hub.js`, `presence.js`, protocole du
  Hub). Avant un test long : dire pourquoi, ce qu'il couvre, combien de temps.
- **Un bug se prouve avant de se corriger** : un test qui échoue sur l'ancien
  code (contre-épreuve : remettre les fichiers d'avant, ou le serveur d'avant
  extrait de git), puis vert grâce au correctif seulement.
- Tester des **comportements**, pas des présences : plusieurs défauts n'étaient
  visibles qu'à la géométrie, au clic réel ou à l'image (voir le journal).
- Production : seulement par les options `--prod` / `--hub wss://…` des suites
  qui le prévoient.
- `tests/README.md` dit quoi lancer et comment ; `tests/front.html` et
  `tests/games.html` se lancent DEUX fois (dont `--force-prefers-reduced-motion`).

## Front du portfolio : l'interface TF2 / Mann Co.

Le site n'a pas un accent TF2, il EST une interface VGUI. Trois principes :
1. un panneau = aplat dégradé + biseau (lumière haut-gauche, ombre bas-droite)
   + bordure nette ; 2. des coins coupés en diagonale, jamais d'arrondi ; 3. une
   hiérarchie par la **qualité d'objet**, pas par la taille du texte.

- **Deux feuilles, et l'ordre compte** : `css/tf2.css` = le socle (polices,
  palette, primitives `.panel` / `.item` / `.tf-btn` / `.tf-tag` / `.attr-list`
  / `.q-badge` / `.item-desc`) ; `css/style.css` = les composants du portfolio.
  Le socle ne connaît rien du site. `css/tailwind.css` (compilé, 3.4.17) est
  placé APRÈS `style.css`.
- **Polices, toutes locales** (`assets/fonts/`, WOFF2 préchargées) : `TF2 Build`
  (titres), `TF2 Secondary` (corps), JetBrains Mono (terminal du hero, jeux) et
  Space Grotesk (jeux), ces deux-là en fichier variable 400→700. Aucune
  ressource Google, sur aucune page. Les polices TF2 couvrent les accents
  français mais pas `« » → ✦ ★` : repli système glyphe par glyphe, voulu.
- **Mapping** : nav = écran de sélection de classe ; parcours = ConTracker
  (contrats dépliables) ; projets = sac à dos + fiche d'objet en modale
  (`js/itemmodal.js`) ; compétences = infobulle d'objet (`.item-desc`) à droite
  du nom dans le hero (sous les CTA en dessous de 1180 px, texte dans `i18n.js`,
  `skills.*`) ; contact = guichet Mann Co. ; footer = bandeau de bas d'écran.
  Killfeed, sections RED/BLU et numéros de classe du carousel conservés.
- **Thèmes** : Mann Co. (brun carton, défaut) et Blueprint (papier calque +
  grille bleue), bouton soleil/lune ; posé dans le `<head>` (pas de flash).
- Détails vivants : halo de section qui suit le curseur (`--hx`/`--hy` posés
  par `main.js`, amorti 55 %, coupé au doigt et en mouvement réduit) ; nav qui
  allume la section lue ; grain de pellicule ; textures (taches + fibres en
  `feTurbulence`, token `--tex-stains`, sur `.section-halo::after`) ; réticule
  ( • ) (token `--cursor-cross`, un par thème) UNIQUEMENT sur `.tf-btn`,
  `.bp-cell` et le carousel — choix de Mathys, pas sur tout le site.
- **Easter egg** : masque du Spy dans le bandeau du footer → un Spy BLU (SVG
  maison dans `index.html`) traverse en crabe et « déterre » le projet abandonné
  de Mathys, en `.item-desc`. Enchaînement sur `animationend` dans
  `js/easter.js`.
- **Guichet** : le formulaire compose un `mailto:` (aucun service tiers) ; à
  l'envoi, `#cf-capture` se remplit (« SIGNAL SÉCURISÉ ✓ », `--capture-ms`
  1,1 s) PUIS le mailto: s'ouvre (délai court : un navigateur n'ouvre un
  mailto: que peu après le clic). `main.js` émet l'événement annulable
  `guichet:send` juste avant, que `tests/front.html` annule (un vrai mailto:
  bloque Edge headless).
- **Hub de la section Jeux** (`js/gamehub.js`) : carte « Game Hub · Joue avec
  tes amis » (`#hub-link`, lien `games/`, marche sans JS), commande dans la
  palette Ctrl+K, et la caisse **solo** « Je joue à quoi ? » (tirage local, sans
  session, qui renvoie au Game Hub). Tirage par `playable()` : `status ===
  'live'` ET (`href` ou `action`).

### Ce qu'il ne faut pas casser

- **Accessibilité** : menu mobile (`inert` fermé, aria-expanded, Échap, focus),
  lightbox (visibility quand fermée, piège à focus, focus rendu), palette
  (combobox/listbox), carousel (role region, points nommés, bouton pause,
  rotation coupée hors écran, `focusin` ramène au centre), killfeed
  `aria-hidden`, `aria-label` traduits via `data-i18n-aria`. Échap : la fenêtre
  du dessus fait `preventDefault`, celles du dessous ignorent une touche déjà
  traitée. La croix de la fiche écoute `click`.
- **Mouvement réduit** aussi en JS : `prefersReducedMotion()` et
  `scrollBehavior()` (`main.js`), lus au moment de l'animation.
- **Sans JS** : classe `js` posée dans le `<head>` ; seul `.js .reveal` est
  caché ; `.js-only` / `.nojs-only` ; carousel en grille ; compteurs avec leur
  vraie valeur dans le HTML. Au téléphone, un `<details class="nojs-nav">` donne
  les 6 sections — posé **hors du `<header>`** (le `clip-path` de `#navbar nav`
  le rognerait).
- **Pré-rendu** : `js/templates.js` = balisage partagé navigateur/build. Le
  contenu entre `<!-- build:… -->` dans `index.html` est GÉNÉRÉ. Après toute
  modif de `data/`, `templates.js` ou d'une classe Tailwind :
  `node tools/build.mjs`. CI : `.github/workflows/generated-files.yml` lance
  `--check` (qui vérifie aussi la liste des `<loc>` du sitemap, pas les
  `<lastmod>`, qui dépendent du commit ; la date d'une page de jeu dépend aussi
  de `games/shared`).
- **SEO** : canonical, Open Graph, Twitter, JSON-LD Person (faits affichés
  seulement), `assets/og-image.png` généré depuis `tools/og-image.html`, sitemap
  généré depuis `data/games.js`, `games/ban/calibrate.html` en noindex,
  `styleguide.html` et les pages de tests en `Disallow`. **`/data/` reste
  autorisé** dans `robots.txt` (sans `data/*.js`, le script casse ; raisonnement
  dans le fichier).
- **Perf** : images WebP (vignettes 480 px dans `assets/projects/thumbs/`), un
  seul écouteur de scroll (rAF), terminal en pause hors écran. AVIF : décidé
  non (voir journal).
- **Contenu** : `data/projects.js` (`goal` / `role` / `result` / `team`) et
  `data/games.js` (`code` / `arch` → bouton Architecture, même modale). `role`
  est écrit avec les mots de Mathys : ne rien y ajouter sans lui. ⚠️ Le dépôt
  des radars n'est PAS lié tant que Mathys n'a pas retiré l'IP interne et les
  identifiants de son README (ils resteraient aussi dans son historique git).
- **Favicon** `assets/favicon.svg` (plaque Mann Co. + ML en traits) sur toutes
  les pages.

### Pièges du front

- ⚠️ **`clip-path` rogne aussi les ombres portées et les outlines.** Biseau en
  `box-shadow` *inset*, lueur de rareté en `filter: drop-shadow()`, focus en
  anneau inset. Une `box-shadow` extérieure sur un élément découpé ne
  s'affichera jamais. (Documenté dans `tf2.css`.)
- ⚠️ **Teinte ≠ encre.** Les couleurs TF2 sont calibrées pour le gris du jeu ;
  sur le brun ou le papier, la moitié passe sous 4.5:1. `--red` / `--q-*` pour
  barres, bordures et fonds ; `--red-ink` / `--qi-*` pour le texte, un jeu par
  thème. Ne pas réunifier. Même logique pour `--on-orange`. En Blueprint,
  `--ink-3` / `--orange-ink` sont foncés pour tenir 4.5:1 sur la tache la plus
  sombre.
- ⚠️ Le filtre SVG des textures doit avoir une région = la tuile
  (`filterUnits='userSpaceOnUse'`), sinon coutures tous les 720 px. Un SVG en
  `data:` ne voit pas les variables CSS (d'où un réticule par thème).
- ⚠️⚠️ **GitHub Pages passe le dépôt par Jekyll, qui IGNORE tout fichier ou
  dossier commençant par `_`** : jamais publié, 404 en production, invisible en
  local. `tools/build.mjs` refuse tout `href`/`src` local dont un segment
  commence par `_` (`checkPagesPaths`). Ne jamais « ranger » un dossier avec un
  tiret bas.
- **Audit de contraste** : le dégradé d'un panneau est dans `::before` (à cause
  du `clip-path`), pas dans `background-color` ; dans une iframe hors écran
  l'IntersectionObserver ne se déclenche pas (tout `.reveal` à `opacity: 0`) :
  couper les transitions, forcer `.is-visible`, puis mesurer. Compromis gardés :
  cartes latérales du carousel à `opacity: .08` (coverflow), boutons `disabled`
  du Ban (WCAG exempte l'inactif), `#stop-btn` rouge vif (grand texte, 3:1).
- `GAMES` / `PROJECTS` sont des `const` de premier niveau : globaux mais pas
  propriétés de `window` (`w.GAMES` vaut `undefined` ; lire par
  `w.eval('GAMES')`). `tests/front.html` lit les nombres de jeux dans
  `data/games.js`, jamais en dur.

## Pages de jeux : le socle commun

Les sept pages de jeux chargent **`css/tf2.css` puis
`games/shared/game-ui.css`, puis leur propre `<style>`**. Chrome commun
(fond, titres, panneaux, boutons, champs, salon, code de salle, retour),
gameplay et accent propres.

- ⚠️ **LA RÈGLE QUI REND ÇA SÛR** : le socle ne cible que des éléments (0,0,1)
  ou des classes (0,1,0), et il est chargé AVANT le `<style>` du jeu : tout ce
  qu'un jeu déclare ensuite gagne. C'est ce qui garde l'apparence des boutons de
  gameplay (`.cell` du Morpion, `.rate` d'Imitation, `.fab` de Précision,
  `#stop-btn` du Ban). Panneau commun : `class="panel g-screen"`. Le socle
  habille les identifiants communs aux pages (`#name-input`, `#code-input`,
  `#host`, `#join`, `#start`, `#room-code`, `#code-hint`, `#error`, `#players`,
  `#avatar-row`) et classes (`.join-row`, `.or`, `.sub`, `.avatar-pick`,
  `.back`) : les garder quand on touche au balisage d'un jeu.
- Un jeton d'accent par jeu : `--g-accent` (+ `--g-accent-ink`). Morpion,
  Demi-Cercle et Imitation violet, Ban rouge, Précision lavande, Passeur et Qui
  Ment ? orange Mann Co.
- Le socle porte aussi le comportement : focus clavier doré, mouvement réduit,
  cibles tactiles 44 px en `pointer: coarse`, convention `disabled`, `.g-copy`
  (le code de room est un vrai `<button>` qui se copie ; un échec de copie est
  dit), `.g-error` / `.g-status`, `.back` (retour portfolio).
- Reste volontairement propre à chaque jeu : grille ✕/◯, cadran, double
  waveform, vidéo et `#stop-btn`, épreuves de Précision, terrain 2.5D du
  Passeur, carte de rôle de Qui Ment ?. Le Mann Co. est le langage de
  l'INTERFACE, pas du terrain. Le code de room du Morpion reste en ligne (rangée
  de méta : `display: inline`). Passeur et Qui Ment ? gardent des copies locales
  identiques de quelques règles du socle (non retirées pour ne rien risquer).

### Pièges de spécificité (tous déjà mordus)

- ⚠️ **`:where()` a une spécificité NULLE.** Les règles de focus s'écrivent
  `:where(…):focus-visible` (0,1,0) et battent `input { outline: none }` quel
  que soit l'ordre — ne pas retirer le `:where()`. Mais `.avatar-pick` et
  `.ghost` s'écrivent en classe NUE (sinon `button {}` les écrase).
- ⚠️ **`* { margin: 0 }` bat `:where()`** : cinq pages ouvrent leur `<style>`
  par ce reset, chargé après le socle. Jamais de marge ni de rembourrage en
  `:where()` dans `game-ui.css` ; d'où `#avatar-row { margin-bottom: 1.25rem }`
  en ID.
- ⚠️ **`.g-copy` est écrit en DEUX règles, délibérément** : le chrome déshabillé
  par `.g-copy.g-copy` (0,2,0, bat `button {}` et `.card button` sans
  `!important`), la mise en page à `.g-copy` seul (0,1,0) pour que le
  `#room-code` de chaque jeu garde la main. Ne pas fusionner ;
  `tests/games.html` le rattrape.
- ⚠️ **Ne jamais redéfinir un nom de jeton de `tf2.css` dans un jeu** (`--bg`,
  `--ink`, `--line`, `--card`…) ; les jetons du socle sont préfixés `--g-`,
  ceux propres à un jeu aussi (Précision : `--p-line`).
- ⚠️ Chaque page contient les mots « dans le `<style>` ci-dessous » dans un
  commentaire : un script d'édition doit ancrer sur `\n<style>\n`, sinon il
  injecte son CSS dans le commentaire.
- ⚠️ Quand on renomme la classe d'un élément, **relire les sélecteurs composés**
  qui la mentionnaient (un `.card.play-card` orphelin a écrasé le plateau de
  Précision ; un `class="card"` orphelin a fait perdre son panneau au Morpion).
- Passeur et Qui Ment ? redéfinissent `.tf-btn:disabled` en `opacity: .45;
  cursor: default` : volontaire (le `cursor: progress` de tf2.css veut dire
  « envoi en cours »). Ne pas toucher tf2.css.
- Les pages de jeux ne reçoivent pas `box-sizing: border-box` de Tailwind, et
  `font: inherit` ramène un `line-height: 1.5` : c'est ce qui faisait déborder
  les champs. Un champ masqué en `width: 1px` garde son rembourrage : il faut
  aussi `padding: 0; border: 0; min-height: 0`.
- ⚠️ **Anneau de focus et `clip-path`** : l'outline du socle est rogné tout
  entier sur un bouton découpé (les 7 jeux en avaient, 14 boutons). Le socle
  AJOUTE donc un anneau intérieur (`button:focus-visible`, box-shadow inset,
  la forme de `.tf-btn` et de `/games/`), placé APRÈS `.join-row button` (même
  poids 0,1,1 : le dernier gagne). Un bouton qu'un jeu habille par un id avec
  sa propre ombre (`#stop-btn`) garde l'outline, comme avant. Preuve :
  `keyboard.mjs` compte les pixels DORÉS de chaque élément découpé atteint au
  vrai Tab (le simple « outline non nul » voyait un anneau rogné comme bon).

### Mises en page propres à un jeu

- **Précision** : le plateau est un **appareil de mesure**. Toutes les épreuves
  sont en `position: absolute; inset: 0` et ne donnent aucune hauteur : c'est
  `.play-card` qui porte `aspect-ratio: 5/6`, `padding: 0` (bat le `:where()` du
  socle), `overflow: hidden`, et son noir via **`.play-card::before`** (un
  `background` sur un `.panel` ne se voit pas, le `::before` de tf2.css peint
  au-dessus). `main:has(.play-card:not([hidden]))` l'élargit à 640 px, plafonné
  par `calc((100svh - 3.6rem) * 5/6)` : c'est la largeur qui cède, jamais le
  ratio. Le boîtier `#bezel` (`aria-hidden`, `pointer-events: none`) est à
  z-index 4 : au-dessus des épreuves, sous le HUD (5), le bouton rond (6) et la
  barre de temps (7) ; les barres de teinte de COULEUR et `#reveal-view` sont
  remontées à 5 (on ne juge pas une couleur sur un bord teinté). Le boîtier ne
  dessine qu'avec des dégradés et des ombres, aucune image : biseau inset,
  vignette, gouttière, graduations, équerres dans l'accent, plaque « CAL.
  00—100 » en TF2 Build. Compromis : l'aperçu de COULEUR garde la vignette sur
  ses bords. Tout est local à `games/precision/` (`tests/games.html` vérifie que
  le socle n'a aucune règle de plateau).
- **Demi-Cercle** : `#host-config` est une grille `auto minmax(0, 1fr)` (chaque
  label soudé à sa liste, listes plafonnées à 15rem, `#start` sur sa ligne). Les
  autres jeux gardent leur flex (une seule paire, trop étroite pour se scinder) :
  ne pas les passer en grille « par cohérence ».
- Mesurer un alignement : comparer les **centres**, pas les bords hauts.

### Profil et avatars

- **Profil local** (`games/shared/game-profile.js`, clé `localStorage`
  `mathys_game_profile`) : `{ v: 1, id, name, avatar: { kind: 'emoji' |
  'image', emoji, src? } }`. `id` est local et ne prouve rien ; il est écrit dès
  la première lecture (`GameProfile.load()`), sinon la reconnexion au Hub est
  impossible. `sanitize()` est le seul point d'entrée (profil illisible → neuf,
  sans exception ; une migration de `v` se branchera là). C'est LE profil
  joueur (lot G, 2026-09-30) : aucune seconde source, pas de compte, pas de
  date de création (rien ne s'en sert encore).
- **Stockage inaccessible** (cookies bloqués, ancienne navigation privée :
  `localStorage` qui jette, ou écriture refusée) : `load()` rend la **copie de
  la page** (`memoire`), même id et même pseudo jusqu'au bout de la visite.
  Sans elle, chaque lecture donnait un profil neuf et le pseudo tapé était
  perdu avant « Créer » (le Hub refusait d'entrer). La copie ne sert QUE dans
  ce cas : un contenu illisible ou d'une autre version garde sa règle (profil
  neuf ; `tests/profile.html`).
- **Pseudo** : toujours `GameProfile.cleanName()` (relecture, enregistrement,
  carte de l'accueil) — contrôles, forçages de sens d'écriture (U+202A–202E,
  U+2066–2069, LRM/RLM/ALM), espaces invisibles retirés, espaces réduits, 16
  unités sans couper un emoji en deux. Le ZWJ reste. Affichage en
  `textContent` partout. ⚠️ Seul NOTRE client filtre : un client forgé peut
  encore envoyer ces caractères au Hub (`identity.js` ne filtre que la
  longueur) — c'est au serveur de les retirer le jour où ça compte.
- **Trois niveaux, qui ne se mélangent pas** : profil local = préférence, dans
  ce navigateur ; identité de session = ce que le Hub a reçu au `join` (reprise
  comprise : `hub.js` remplace nom et avatar) et montre à tous ; serveur =
  seule autorité (hôte, score, résultats). Salon, score, carte Résultat, récap
  et finale lisent l'identité de SESSION (`session.players`, ou l'historique
  pour un parti), jamais le profil local.
- **« 👤 ton profil »** (`#hub-profile-btn`, sur ta carte seulement) ouvre
  `#profile-dialog` (`<dialog>` natif + `.panel` dedans, comme la fin de
  soirée) EN LECTURE : l'identité de la soirée, le code, où le profil est
  gardé. On ne le modifie pas pendant une soirée (choix du lot G) : l'éditeur
  est à l'accueil. Si le profil local a changé ailleurs (autre onglet, page de
  jeu), le panneau le dit : le Hub le prendra à la prochaine connexion
  (rechargement, retour d'une partie — `hub-handoff.js` rejoint avec le profil
  local). Limite connue, assumée. ⚠️ Le bouton est UN élément déplacé dans ta
  carte à chaque rendu (recréé, il perdait le focus clavier à chaque état du
  Hub) ; à la fermeture, le focus lui revient.
- Bornes, prises dans les serveurs : `name` 16 caractères ; `emoji` **4 unités
  UTF-16 max** (un emoji à ZWJ serait coupé) ; `src` = data-URL **webp ou png**
  produite par notre canvas, **≤ 12 Ko décodés** (SVG refusé : il peut porter
  du script). L'emoji est TOUJOURS présent : c'est le repli.
- Dans les six jeux à identité : `GameProfile.startEmoji(AVATARS)` (garde
  l'emoji du profil s'il est dans les douze du jeu, sinon un choix stable dérivé
  de l'id, jamais réécrit) ; le module branche lui-même préremplissage et
  enregistrement (`change` + capture sur `#host` / `#join`).
- **La PP voyage en jeu** : `GameProfile.joinAvatar(emoji)` → `join` →
  `avatar.js` (le **même fichier** dans les six serveurs : `cleanAvatar()`,
  signature vérifiée, image jamais décodée ni réencodée, tout refus garde
  l'emoji ; tests `test-avatar.js` et `test-avatar-ws.js`) → listes de joueurs
  → `games/shared/game-avatar.js`. Côté profil, `okImage()` compte les octets
  DÉCODÉS, comme le serveur. Un ancien client qui envoie une chaîne reste
  accepté, un ancien serveur qui renvoie une chaîne reste affiché.
  ⚠️ **La donnée du réseau ne passe jamais par innerHTML** : `GameAvatar.slot()`
  pose un emplacement vide dans le gabarit, et **tout `slot()` doit être suivi
  d'un `fill()`** sur le même conteneur. Un emoji venu du réseau n'est accepté
  que s'il en a l'air (aucun ASCII imprimable) — sinon l'emoji par défaut.
- Tailles : `sm` 32 px, `md` 48, `lg` 68 (44 / 60 sous 480 px) ; photo et emoji
  dans la même boîte (`.g-av-e`) ; carré à coins coupés, liseré = le FOND vu à
  travers 2 px (le `clip-path` rognerait une `border`), couleur via
  `--g-av-ring`. Rangée `.g-player` / `.g-player-name` / `.g-player-score` ;
  `:where(ul):has(> .g-player)` retire le retrait des `<ul>`. Sans taille, le
  rendu en ligne (`.g-av-img`, 1,5em) reste pour les phrases. Par jeu : photo au
  bout de l'aiguille du Demi-Cercle (`<image>` SVG), scoreboards d'Imitation et
  du Demi-Cercle à 240 px, avatars du Ban dans « tour de … » et l'ordre de
  passage, révélation de Précision à 36 px sous 480 px, votes de Qui Ment ? en
  cartes joueur.
- ⚠️ **Morpion : l'exception structurelle.** `morpion-server` ne reçoit ni
  pseudo ni avatar, la page n'a ni `#name-input` ni `#avatar-row`, et on ne lui
  envoie jamais d'identité (`tests/handoff-morpion.mjs` relit chaque trame).
  `game-profile.js` y est chargé quand même, pour le seul `player.id` du Hub.

## Le Passeur : le terrain

- **`games/passeur/court.js` ne connaît aucune situation** : il dessine la
  `scene` envoyée par le serveur (réception, bloc, attaquants, passeur…). La
  `scene` vit dans `situations.js` côté serveur ; ce n'est pas un secret, mais
  aucun barème ne doit s'y glisser (les deux suites le vérifient).
  ⚠️ Ajouter un état demande de toucher **aux deux dépôts** (valeur serveur +
  dessin client) ; `test-engine.mjs` refuse toute valeur inconnue (une faute de
  frappe donnerait un terrain muet sans erreur JS). Sans `scene`, terrain
  neutre, jeu jouable.
- **Les règles de volley sont côté serveur** (`rules.js`, FIVB 2025-2028,
  `test-rules.mjs`) ; le client n'en connaît AUCUNE. Rotations obtenues en
  tournant la rotation de base (7.4), seule la formation au service doit être
  légale (7.5), tout le monde se déplace après le service (7.6), un arrière
  attaque au-dessus du filet seulement depuis derrière les 3 m (13.2.2), seuls
  les avants contrent (14.1.1 / 14.6.2).
  ⚠️ **Ne JAMAIS écrire « il est arrière donc il ne peut pas aller devant »**
  (faux, 7.6 ; un test l'empêche). Passeur arrière = pas de 2e main (ballon
  poussé au-dessus du filet depuis la zone avant, via `ACTION` /
  `attackFault()` ; une poussette basse se déclarerait `ball: 'below-net'`).
  Une option interdite reste visible (`×`, raison dans l'`aria-label`), le
  serveur la refuse, et elle n'est jamais notée 50 ou plus. Le réceptionneur par
  défaut est le réceptionneur-attaquant arrière.
- **Deux temps tenus par le serveur** : `round` (mise en situation, `introMs`
  2,2–3,0 s, zones inactives, le serveur refuse une réponse) puis `go` (5 s). Le
  chrono ne démarre pas à la fin de l'animation locale (un onglet qui rame
  jouerait plus longtemps). Filet client : sans `introMs`, on arme tout de suite ;
  si `go` tarde, on arme après `introMs + 700 ms` (le serveur reste l'arbitre).
- **Fausse 3D** : projection à un point de fuite (`hw(y)`), échelle propagée
  `sc(y) = hw(y)/NEAR_HW` à tout ; **l'ordre de tracé EST la profondeur** : sol →
  bloc → filet → zones → nos joueurs → ballon → trajectoires (ne pas
  réordonner `paint()`). Filet à profondeur constante. Huit poses de silhouette.
  (`idle`, `run`, `set`, `block`, `attack`, `receive`, `tired`, `down`),
  définies une fois pieds en (0,0) ; l'état d'un attaquant choisit sa pose (au
  sol = couché). Classes d'équipe `sil-us` / `sil-them` / `sil-set` : sans
  elles, tout tombe en noir sans qu'aucun test DOM ne se plaigne. Trajectoire
  passeur → attaquant au survol / focus. `.court-wrap` a le ratio
  du viewBox (100 × 78) : changer l'un sans l'autre décale tout. Sol de gymnase
  (`#7a4a24` / `#573720`), pas des tokens TF2.
- **Animation en SMIL** (`animateMotion`, `animateTransform`, `set`), pas de
  boucle JS ; l'état final = le même rendu avec `animate: false`
  (donc pas de branche « mouvement réduit »). Un joueur qui bouge est dans un
  `<g class="mv">` qui ne fait que translater (ne pas fusionner avec le groupe
  d'échelle). ⚠️⚠️ **En SMIL, `begin` se compte sur la timeline du DOCUMENT** :
  sans `svg.setCurrentTime(0)` après chaque rendu animé, toutes les animations
  sont déjà finies à l'insertion (`tests/games.html` le vérifie). Capture à un
  instant : `svg.pauseAnimations()` + `svg.setCurrentTime(t)`.
- Le bloc part toujours en retrait (`BLOCK_WAIT_Y` → `BLOCK_READY_Y`), en chemin
  en L (`moverL`), depuis `blockXs('base')` si la scène ne dit rien ; un bloc en
  retard part plus tard et met plus longtemps.
- **Zones** : vrais boutons du SVG (`role="button"`, `tabindex`,
  `aria-pressed`, `aria-label` avec la touche), touches 1 à 5 dans l'ordre
  spatial (gauche, courte, 2e main, droite, arrière), nom en grand (`fs = 10 *
  s`, calibré pour 390 px), anneau de focus **dessiné dans le SVG**
  (`.z-focus`). Aucun état par la seule couleur. ⚠️ La perspective écrase les
  cibles tactiles : `tests/games.html` mesure les cinq zones à 390 px, ne pas
  rééquilibrer à l'œil.
- ⚠️ **Les couches décoratives `.c-*` sont en `pointer-events: none`** : joueurs,
  ballon et trajectoires sont tracés après les zones et intercepteraient le
  clic (vérifié par `elementFromPoint` au centre de chaque zone). Six joueurs
  par équipe (FIVB 7.3) : notre 6e — le central arrière, sans option — se
  déduit de `lineup` moins les porteurs d'options, et il est placé près de sa
  ligne de touche (pas sur sa position de rotation, où il masquait le libellé
  de la zone arrière) ; les six adverses sont du décor, `.c-extra`. L'ordre de
  `PASSES` (`situations.js`) suit l'ordre spatial des touches ; tout se fait
  par `id`.
  `tests/games.html` pilote `Court.render()` par `dispatchEvent`, ce qui
  contourne le test de survol : les vrais clics sont dans
  `tests/passeur-play.mjs`, qui lit la passe enregistrée par le serveur.
- Chrono SUR le terrain (`#timer-num`, `#timer-fill`, ~31 px, `warn` / `hot`).
  Résultats : le terrain figé, ma zone (cadre pointillé + coche) et la
  recommandée (cadre plein), « pertinence 100/100 · vitesse 92 % » à partir de
  `relevance`, `speed` et `ms` envoyés par le serveur.

## Game Hub — architecture actuelle

| Côté | Fichier | Rôle |
|---|---|---|
| page | `games/index.html` | l'entrée `/games/` (Mann Co.), `noindex` |
| page | `games/hub-page.js` | colle profil ↔ client ↔ affichage ; aucun WebSocket en direct |
| page | `games/hub-crate.js` | la caisse : met en scène un tirage DÉJÀ décidé |
| page | `games/hub-recap.js` | module pur (page + Node) : classement, débrief, finale, dernier résultat |
| partagé | `games/shared/game-hub.js` | LE client du Hub (navigateur ET Node) : connexion, reprise, erreurs |
| partagé | `games/shared/hub-handoff.js` | billet, handoff côté page de jeu, livraison results → ended |
| partagé | `games/shared/game-net.js` | transport des jeux + présence (`GameNet.create`, `surPerte`) |
| serveur | `game-hub-server/src/` | `hub.js`, `session.js`, `engine.js`, `catalog.js`, `health.js`, `launch.js`, `scores.js`, `finale.js`, `protocol.js`, `serialize.js`, `stats.js`, `store-pg.js`, `store-memory.js` |

Configuration : une seule constante `PROD` dans `game-hub.js` ; `?hub=` la
remplace. Protocole relu dans `game-hub-server/src` : `create` / `join` /
`leave` → `created` / `joined` / `session` / `error { code, message }`. Les
codes d'erreur sont ceux du serveur (`SESSION_NOT_FOUND`, `SESSION_FULL`,
`SESSION_CLOSED`, `BAD_CODE`, `BAD_PLAYER`, `REPLACED`…), traduits par
`errorText()` ; un code **inconnu** est affiché avec son code (jamais noyé dans
une phrase générique). Une session compte au plus 16 joueurs (le
`MAX_PLAYERS` de `roquette-server`, le plus permissif ; `session.js` côté
serveur, repli `maxPlayers` de `game-hub.js` côté page). Chaque jeu garde son
propre plafond dans le manifest : le tirage écarte seul un jeu trop petit
(`TOO_MANY`).

### Le manifest des jeux

- **`data/games.js` est la source de vérité** (bloc `hub` par jeu jouable, 10 sur
  11 — « La suite » n'en a pas).
  **`data/games.manifest.json` est GÉNÉRÉ** par `tools/build.mjs` ; le Hub le
  relit sur GitHub Pages (cache 5 min) : ajouter un jeu au portfolio l'ajoute au
  tirage sans redéployer le Hub.
- **`hub: false`** = jeu jouable tenu VOLONTAIREMENT hors du Hub (dans la
  section Jeux, absent du manifest, jamais tiré). Choix écrit, pas un oubli :
  un jeu « live » sans `hub` du tout fait toujours échouer le build.
  `tests/manifest.mjs` vérifie qu'il n'entre pas au manifest. Aucun jeu ne
  l'utilise aujourd'hui : **Roquette Party** puis **Croq.ios** l'ont été
  jusqu'à leur handoff, ils sont désormais des jeux du Hub
  (`hub.handoff: true`).
- ⚠️ **Schéma FERMÉ** (clés `CLES`, vocabulaires fermés `needs` = `mic` /
  `cam` / `consent`, `categories`) : aucun identifiant de contenu n'entre dans
  le manifest, et une faute de frappe fait échouer le build au lieu de créer un
  filtre que rien ne satisfait.
- `minutes` = `{ min, max }` au réglage par défaut ; le filtre de durée compare
  le `max`. `content` / `replay` à `false` = « non supporté OU pas vérifié »
  (`replay` est à `true` pour Le Passeur, Qui Ment ?, Roquette Party et Croq.ios — retour
  au salon par `action: 'lobby'`, vérifié dans chaque `server.js`). Le Hub transporte
  l'historique de contenu sans l'interpréter ; limite connue : les serveurs
  rappellent `E.deal()` à chaque `start`, donc « rejouer » efface
  l'anti-répétition de contenu.
  `handoff: true` pour les neuf jeux en ligne (Puissance 4 : `false`) ; le test
  vérifie que la page charge vraiment `hub-handoff.js`.
- ⚠️ **Le Hub ne teste JAMAIS une capacité** (aucun `getUserMedia`) : c'est le
  jeu qui demande le micro à l'entrée.

| Jeu | min | max | Source |
|-----|-----|-----|--------|
| Morpion | 2 | 2 | duel strict |
| Imitation | 2 | 8 | dépôt |
| Demi-Cercle | 2 | 10 | dépôt |
| Ban | 2 | 10 | dépôt |
| Précision | 1 | 12 | dépôt |
| Le Passeur | 1 | 8 | `MAX_PLAYERS` dans server.js |
| Qui Ment ? | **3** | 8 | `E.MIN_PLAYERS` — sous 3 le vote n'a aucun sens |
| Roquette Party | 2 | **16** | `MIN_PLAYERS` / `MAX_PLAYERS` dans `engine.js` ; `minutes` 2–10 (au-delà de 10 joueurs une partie peut dépasser) |
| Croq.ios | 2 | 16 | `MIN_PLAYERS` / `MAX_PLAYERS` dans `engine.js` de `croquis-server` ; `minutes` 5–18 |
| Puissance 4 | 1 | 1 | local, sans serveur |

`tests/manifest.mjs` compare l'URL `wss://` annoncée à celle du `net.js` du jeu,
vérifie le dialecte (`join: 'v1'` envoie `name` et `avatar`, `'anon'` —
Morpion — aucun) et **casse volontairement `data/games.js`** pour vérifier que
le build échoue. ⚠️ Il écrit vraiment dans le fichier puis restaure dans un
`finally` : après une interruption, regarder `git diff data/games.js`.

### Cycle de vie d'une session

États (`session.js`) : `lobby` → `drawing` → `launching` → `inGame` →
`debrief` (→ tirage suivant…) ; `finished` (soirée terminée par l'hôte) ;
`closed`.

- **Reprise = rejouer `join` avec le MÊME player.id** : le serveur rend sa place
  au joueur, sans doublon. Le code de session est gardé en `sessionStorage`
  (`mathys_hub_session`, par onglet) : un rechargement reprend.
- **`REPLACED` → jamais de reconnexion automatique** (deux onglets du même
  profil s'éjecteraient en boucle).
- **Heartbeat** : ping natif toutes les 20 s (`HEARTBEAT_MS`, `src/hub.js`),
  `terminate()` au tour suivant sans réponse (détection 20 à 40 s), même chemin
  que `onClose` ; le navigateur répond seul (`test-presence.js` simule un
  téléphone muet avec `autoPong: false`). Grâce : `GRACE_MS` (60 s). En production,
  une fermeture initiée par le client n'est vue qu'après ~10 s (proxy Render).

| Événement | Effet |
|---|---|
| coupure réseau / socket fermé | joueur **absent**, gardé 60 s (grâce), peut revenir avec le même id |
| `leave` volontaire | joueur **retiré tout de suite**, hôte réélu, diffusion |
| plus aucun joueur **connecté** | session supprimée **immédiatement**, absents compris — sauf pendant `launching` / `inGame` (`HANDOFF_STATES`) et au retour d'une partie finie (`S.backFromGame(s)` : `debrief` d'un lancement `ended`), où les grâces individuelles suffisent |

- **Hôte** (`electHost`) : pendant `launching` / `inGame` et au retour
  (`debrief` d'un lancement fini), l'hôte du lancement garde la main tant qu'il
  est dans la session, absent compris.
- `session.departed` garde nom + avatar de qui est parti (pour le podium) ;
  `session.scores` et `history.games` meurent avec la session.
- **`finished`** : plus aucune action ni reprise ; un `join` reçoit
  `SESSION_CLOSED` (avec le podium si l'on en faisait partie) ; effacée au bout
  de 10 min (`FINALE_KEEP_MS`), puis `SESSION_NOT_FOUND`.

### Le tirage

    catalogue (manifest relu sur Pages, cache 5 min)
      → FILTRER   nombre de joueurs, mode local, besoins, veto d'UN seul, durée max
      → PONDÉRER  (1 + 0,5 × ❤️) × récence (0,15 / 0,4 / 0,7 selon l'ancienneté)
      → TIRER     hasard crypto, tout de suite (~90 ms)
      → révélation (la caisse met en scène un résultat DÉJÀ décidé)
      → CONTINUER → handoff : la page du jeu se connecte à SON serveur,
        c'est ce moment-là qui le réveille

- Moteur pur `src/engine.js` ; toutes les raisons d'exclusion rendues,
  nominatives, dans `session.pool.why`. Seul l'hôte tire (`hostId` relu côté
  serveur), `draw` ne porte AUCUN champ, l'état passe à `drawing` avant tout
  `await` (second `draw` → `DRAW_IN_PROGRESS`).
- ⚠️⚠️ **Aucun `/health` dans le tirage**, ni pré-réveil à la création. Un
  serveur Render endormi ne coûte jamais un tirage. `pool.health` n'est qu'une
  information (souvent `unknown`). La seule décision sur la santé est au
  LANCEMENT : après un `abort` `UNREACHABLE` (`markDown`), le lancement suivant
  échoue tout de suite en `SERVER_DOWN`. `src/health.js` reste un simple GET,
  jamais un WebSocket vers un jeu. Garde-fou : `game-hub-server/test-candidat.js`
  remplace la santé par un faux qui **compte les appels** — si un
  `await health…` revient dans `onDraw`, c'est lui qui le dira.
- **`NO_ELIGIBLE_GAME`** = aucun jeu ne passe les RÈGLES, jamais « un serveur ne
  répond pas ». `NO_SERVER_AVAILABLE` a été supprimé : ne pas le réintroduire.
  Si l'on veut un jour montrer un réveil, sa place est l'étape de lancement,
  pas le tirage.
- ⚠️ **La caisse ne choisit rien** : sa bande est tirée dans `draw.eligible` et
  s'arrête sur `draw.gameId`, tous deux venus du serveur.
- ⚠️ **L'arrêt de la bande est un décalage en PIXELS** (bande plafonnée à
  560 px, vignettes 104 → 92 px sous 560 px) : figé au lancement, il laissait
  après un redimensionnement ou une rotation une AUTRE vignette sous le repère
  (lot E, 2026-09-30). `hub-crate.js` garde le jeu d'arrêt en fraction de
  vignette et un `ResizeObserver` (bande + vignette gagnante) invalide la
  géométrie SEULEMENT quand une mesure change : bande arrêtée → reposée d'un
  coup, en plein défilement → nouvelle cible sur le temps restant ; à l'arrêt,
  reposée sur la géométrie du moment. Pas de calcul par image. Rien dans le
  DOM ne trahit ce défaut : `hub-draw.mjs` le MESURE (`GEOM`).
- **Capacités acquises d'office** : un joueur naît avec `caps: { mic: true,
  consent: true }` (`session.js`), aucun écran de déclaration — ne pas remettre
  l'ancien bloc « Ce que tu apportes ». La règle `NEEDS`
  d'`engine.js` reste (un `false` explicite écarterait le jeu, nominativement),
  et les besoins restent au manifest (Imitation `mic`, Ban `consent`).
  ⚠️⚠️ **`cam` n'est PAS dans le défaut** : le jour où un jeu déclare
  `needs: ['cam']`, l'ajouter dans `session.js`, sinon ce jeu sera impossible
  pour tout le monde, en silence.
- Page : ❤️ / 🚫 par jeu, durée max (hôte), raison de chaque exclusion, chances,
  caisse amenée à l'écran chez tous au début d'un tirage (au téléphone elle
  tournait 900 px plus haut), historique de la soirée.
- **Révélation** (lot C, 2026-09-28) : le NOM du jeu est le plus gros texte de
  la fiche (`#result-kicker` « 🎲 Jeu tiré » — pas 🎯, l'emoji de Précision et
  du Demi-Cercle ; « Seul jeu possible ce soir » sans dé), la bande s'efface
  derrière la vignette gagnante (`.reel-cell.is-win`), `#hub-draw-status` passe
  en texte pour lecteurs d'écran seulement (`#hub-draw.is-revealed`). Focus sur
  `#hub-continue` chez l'hôte ; chez l'invité, « ⏳ En attente d'<hôte> pour
  lancer <jeu> ». `point()` évite « Qui Ment ?. ».
- **« de » devant un pseudo ou un titre** : toujours `GameHub.de()`
  (`game-hub.js`, repris par `hub-page.js` et `reasonText`) : « d'Alice »,
  « d'Imitation », « du Passeur », « de Bruno ». Élision devant une voyelle
  seulement (H et Y laissés à « de » : on ne devine pas la prononciation). Une
  annulation voulue se dit « Lancement de X annulé », pas « a échoué ».
- ⚠️ **Un seul jeu possible = pas de bande** (`HubCrate.single(draw.eligible,
  draw.gameId)`) : `#hub-draw.is-single`, révélation directe, zéro faux
  suspense. Plusieurs jeux : bande et hasard de décor inchangés. Dans ce cas
  la fiche arrive PENDANT le défilement doux lancé à `pending` : `animate()` le
  coupe d'un saut `instant`, sinon le clic sur « Continuer » tombe à côté
  (attrapé par `handoff-play.mjs`). Ne pas retirer ce saut.
- ⚠️⚠️ **Les classes de mise en scène d'un tirage (`MISE_EN_SCENE` dans
  `hub-page.js` : `is-pending`, `is-open`, `is-revealed`, `is-single`,
  `is-launching`) sont effacées quand la caisse se range ET à chaque nouveau
  tirage.** Régression corrigée le 2026-09-28 : après un lancement annulé ou
  raté, `is-launching` (qui masque la bande en `display: none`) restait posée,
  et le tirage suivant tournait sur une bande NON RENDUE — pas de transition,
  cible calculée à 0 px, bande figée et mauvais jeu sous le repère. Une
  transition CSS ne se joue jamais sur un élément non rendu. Test :
  `hub-play.mjs` observe trois tirages séparés par un lancement annulé (il
  échoue sur l'ancien code : 0 position aux tirages 2 et 3).

## Handoff et présence : l'état des sept jeux

Les sept jeux en ligne (Morpion, Imitation, Demi-Cercle, Ban, Précision, Le
Passeur, Qui Ment ?) ont le **même montage**, et **Roquette Party** aussi
(handoff, `results` par le rang du serveur avec `points: 0`, « Lancer sans
attendre », `surPerte` ; test `tests/handoff-roquette.mjs`). **Croq.ios** a le même
montage (`results` avec le rang ET le score du serveur ; test `tests/handoff-croquis.mjs`). Puissance 4, local, n'en a pas
besoin. Aucun serveur de jeu ne connaît le Hub.

### Le principe : le Hub ne parle jamais au serveur du jeu

    lobby → drawing → [continuer] → launching (create → join) → inGame → debrief

1. l'hôte confirme le tirage → `launching`, stage `create` ;
2. il clique « Ouvrir <jeu> » → même onglet → la page du jeu **crée la room par
   son chemin normal** et déclare le code au Hub (`launched`) → stage `join` ;
3. chaque invité clique « Rejoindre », entre par le chemin normal et le déclare
   (`entered`) ;
4. tout le monde est entré → `inGame` (« tout le groupe est dans la room », pas
   « la manche a commencé ») ; `ended` → `debrief`.

⚠️ **Deux clics chez l'hôte (« ▶ Continuer — lancer X » puis « ▶ Ouvrir X »),
et c'est un choix** (lot C) : naviguer tout seul à la réception de l'état
`launching` demanderait une garde contre un nouveau départ au rechargement ou au
retour arrière, et changerait le parcours que les 7 suites `handoff-*.mjs`
jouent. Le gain d'un clic ne vaut pas ce risque. À la place : le focus passe
tout seul sur `#launch-go` (une fois par étape, seulement s'il était sur
`<body>` ou sur « Continuer » qui vient de disparaître ; saut `instant` s'il est
hors écran), `#hub-launch.is-your-turn` (encart + deux pulsations, coupées en
mouvement réduit), titre d'onglet « ▶ Ouvrir / Rejoindre X · Game Hub » tant
que l'action attend CE joueur, `#launch-title` en `role="status"` (réécrit
seulement s'il change ; le compte à rebours de `#launch-text` n'est PAS annoncé).
Pendant le lancement, la fiche du jeu se resserre (`#hub-draw.is-launching`).

⚠️ **Aucun jeton secret, et c'est un choix** : l'autorité vient du SOCKET (seul
l'hôte DU LANCEMENT peut déclarer un code), le lancement est lié au tirage
(`drawId`), borné (90 s / 120 s) et à usage unique. Une session sans connectés
n'est pas fermée pendant un lancement : tout le groupe navigue en même temps.

### Le handoff, page par page

Chaque page charge `game-profile.js`, `game-net.js`, `game-hub.js` et
`hub-handoff.js`, et appelle `HubHandoff.start({ gameId, join, onUpdate })`.
Le **billet** (`sessionStorage` `mathys_hub_handoff`, jamais l'URL) est écrit
par `/games/` juste avant la navigation. Sans billet, `lien` vaut `null` et la
page marche exactement comme hors Hub. Avec billet, le module rouvre le Hub avec
le même player.id, appelle le `join` de la page — son chemin NORMAL (créer sans
code, rejoindre avec) —, affiche un bandeau, et la page le prévient :

- `roomReady(code, place)` à la première room obtenue, avec SA place de jeu
  (score de soirée) ; ré-annoncé seulement quand la place change (reconnexion
  au salon = nouvel id), jamais pour un simple retour au salon (même code) ;
- `started()` par l'hôte à la première vraie phase de jeu ;
- `results(rangs)` PUIS `ended()` à la fin d'une partie complète, et
  **« ↩ Retour au Game Hub »** (`#to-hub`, jamais la classe `.back`, réservée
  au retour portfolio). Détail du contrat : « Score de soirée », tableau de
  référence. Les deux sont LIVRÉS jusqu'à confirmation par l'état du Hub, même
  à travers une coupure ou un retour à `/games/` : « Livraison fiable du
  classement » ;
- **Fin de partie en mode Hub** (lot F) : juste après `ended()`, la page
  appelle `HubHandoff.endActions(#to-hub, revanche)` (gardé : un
  `hub-handoff.js` en cache peut ne pas l'avoir). `#to-hub` devient l'action
  PRINCIPALE (bouton plein, focus dessus, sans défilement), placé AVANT la
  revanche dans le DOM ; la revanche passe au second plan et s'appelle
  « ↻ Revanche (hors score) » — son écouteur ne change pas, et elle ne peut
  rien rapporter (`results` / `ended` déjà consommés). Hors Hub, la fonction
  n'est jamais appelée : rien ne change. Classes : `.tf-btn-buy` /
  `.tf-btn-sm` (Passeur, Qui Ment ?), `.g-hub-home` / `.ghost` +
  `.g-hub-replay` (les autres, `game-ui.css` ; `#to-hub.g-hub-home` en 1,1,0
  exprès, contre le `#to-hub {}` de chaque jeu).
  | Jeu | revanche | écart |
  |---|---|---|
  | Passeur, Qui Ment ? | `#again` | réservée à l'hôte ; « Les autres jeux » reste, après |
  | Imitation, Demi-Cercle | `#back-lobby` | — |
  | Ban | `#to-lobby` | — |
  | Précision | le rond `#fab` (mode `lobby`) | reste DANS le plateau (couches positionnées) : habit d'anneau (`.g-hub-replay-icon`), nom en `aria-label`, remis à zéro par `setFab()` ; il précède `#to-hub` au clavier |
  | Morpion | aucune | la room se ferme au départ d'un joueur |
  | Roquette Party | `#again` | relance depuis la fin ; « Retour au salon » (`#to-lobby` → `action: 'lobby'`) reste à l'hôte |
  Test commun : `tests/hub-end.mjs` (`finHub`), appelé par les 6
  `hub-score-*.mjs` et `handoff-play.mjs` ;
- `failed('JOIN' | 'UNREACHABLE', détail)` si l'entrée lancée par le Hub
  échoue (`viaHub` et pas encore dans une room). Pour l'hôte déjà au stade
  `join`, `failed` devient `cancel()` : sa room est perdue pour tout le groupe,
  le lancement est annulé (`CANCELLED`). En `playing`, `failed()` ne rouvre
  plus d'essai (sinon un retardataire refusé entrait en douce dans la room
  revenue au salon).

Tant que des joueurs attendus manquent, « Lancer » est bloqué et nomme les
absents, avec **« Lancer sans attendre »** (`#start-anyway`) — la règle propre
à chaque jeu (3 joueurs pour Qui Ment ?…) s'applique en plus.

Les écarts, voulus :
- **Morpion** : aucune identité ne part vers `morpion-server`. Pas de salon ni
  de « Lancer » : la room passe d'elle-même à `playing` quand l'invité entre,
  c'est là que l'hôte envoie `started()`. Le départ de l'adversaire (« room
  fermée ») vaut `ended()`. Écran de perte propre au jeu (pas de `surPerte`).
- **Qui Ment ?, « Rejouer »** : `qui-ment-server` n'accepte `start` QUE depuis
  le salon (ailleurs il l'ignore **sans erreur**). « Rejouer » envoie donc
  `lobby` (MJ seulement), et le `start` ne part qu'au retour du salon. Ne pas
  « simplifier » en renvoyant `start` directement. Pendant ce `start`
  automatique, « Lancer la partie » reste éteint (`relance`) : depuis le lot F
  la revanche a changé de place, et le 2e clic d'un double clic tombait sur ce
  bouton du salon (second `start`, attrapé par `quiment-replay.mjs`).
- Une revanche jouée dans la même room **ne parle pas au Hub** : il reste en
  `debrief` sur le lancement terminé, rien n'est recompté.

### La présence : qui est VRAIMENT là

Un onglet gelé (arrière-plan, écran verrouillé) garde son WebSocket ouvert et
répond au ping natif — c'est le navigateur qui répond, pas la page : un joueur
fantôme. D'où une présence **applicative**.

- **Serveur** : `presence.js`, **le même fichier dans les sept dépôts** (on le
  copie, on ne l'adapte pas). Ping `{ type: 'presence', n }` dès la connexion
  puis toutes les 10 s ; le client répond `{ action: 'presence', n }`. Adhésion
  **volontaire** : un client qui n'a jamais répondu n'est jamais expulsé. Sans
  signe de vie depuis 30 s → `close(4000, 'absent')`, puis `terminate` 3 s plus
  tard. Ping natif séparé (20 s) pour les coupures franches. `hold()` donne un
  sursis (Imitation, pendant l'envoi d'une prise audio). Le module ne connaît
  aucune room. Le routeur appelle `presence.consume(ws, msg)` en premier.
- **Client** : `games/shared/game-net.js` (`GameNet.create`), même API que
  l'ancien `NET` de chaque jeu. Il répond aux pings (jamais de lui-même), émet
  `lost` une fois par connexion perdue, ne reconnecte **jamais** tout seul. Une
  nouvelle connexion présente la clé de l'ancienne (`remplace`) : le serveur
  ferme l'ancienne AVANT d'acquitter, donc jamais de doublon. `pagehide` ferme
  en 1000 (le navigateur refuse 1001).
- **Écran de perte** : `GameNet.surPerte(NET, …)` dans six jeux — au salon, un
  retour automatique par le join normal ; en pleine partie, « elle a continué
  sans toi ». Il exige `#lost`, `#lost-text`, `#lost-retry`, `#lost-hub`.

### Les tests qui gardent tout ça

`tests/handoff*.mjs` (un par jeu, vrais Hub + vrai serveur), `game-net.mjs`,
`presence-jeux.mjs`, `presence-precision.mjs`, `presence-morpion.mjs`,
`quiment-replay.mjs`, `hub-report*.mjs`. Détail et options dans
`tests/README.md`.

## Score de soirée

Le Hub tient un **score cumulé par session**. Deux autorités qui ne se mélangent
pas : **le jeu** reste maître de SA partie, **le Hub**
(`game-hub-server/src/scores.js`, module pur) est maître de la soirée. La page
ne calcule aucun point. Aucun serveur de jeu n'a été modifié pour ça.

### Le contrat commun, référence

    roomReady(code, gamePlayerId)   chacun SA place, jamais l'id du Hub
    results([{ gamePlayerId, rank, points }])   hôte du lancement, une fois
    ended()                          toujours APRÈS results

    sur le fil : launched / entered { …, gamePlayerId }   chacun SA place
                 results { drawId, gameId, results: [...] }  puis  ended

- `rank` = rang de compétition calculé sur le score DU SERVEUR (ex æquo = même
  rang : 13, 13, 5 → 1, 1, 3), jamais sur l'index.
- **Conversion, seule et commune** : `10 × (classés − rang + 1)` — à trois
  30 / 20 / 10. Le rang et pas les points du jeu : Le Passeur va de 3 à 12
  manches, le Morpion n'a pas de points. Les points du jeu restent dans
  `history.games[].results[].gamePoints`.
- **Pourquoi `gamePlayerId`** : l'hôte ne connaît pas l'identifiant de jeu des
  autres. Chacun déclare le sien en entrant ; une place déjà prise est refusée
  (l'hôte ne peut pas donner de points à quelqu'un d'autre) ; une place inconnue
  occupe son rang sans marquer. Les places ne sortent jamais dans l'état public.
- **Validations du Hub** : hôte du lancement (ou hôte actuel), bon `drawId`,
  bon `gameId`, partie lancée (`playing` ou `ended`), **une fois par lancement**
  (`RESULTS_ALREADY`), forme (`BAD_RESULTS`), `GAME_MISMATCH`.
- « Une fois » est garanti deux fois : `hub-handoff.js` (`rapporte` / `fini`,
  `ended()` consomme le billet) puis le Hub. Une partie incomplète (abandon,
  room perdue) n'envoie jamais `results`. Garde `if (lien.results)` dans chaque
  jeu (un `hub-handoff.js` en cache peut ne pas avoir la méthode).
- ⚠️ **Limite assumée** : le classement passe par le navigateur de l'hôte (le
  serveur du jeu ne parle pas au Hub). Même confiance que pour le code de room ;
  le jour où ça ne suffira plus, c'est le serveur du jeu qui devra signer.

| Jeu | place (`gamePlayerId`) | ré-annonce | classement → `results` | particularité |
|---|---|---|---|---|
| Le Passeur | `you.id` | à chaque `you` (1 par connexion = 1 id) | `rangs(ranking)`, trié d'abord | pilote ; de 3 à 12 manches, d'où le rang |
| Imitation | `room.you` | `placeDeclaree` | `rangs(podium)` | pas de message `you` |
| Demi-Cercle | `room.you` | `placeDeclaree` | `rangs(podium)` | |
| Le Ban | `room.you` | `placeDeclaree` | `rangs(podium)` | points négatifs possibles (seul le rang compte) ; la place est déclarée APRÈS l'avertissement |
| Précision | `room.you` | `placeDeclaree` | `rangs(podium)` | jouable seul (1 → 10 pts) |
| Qui Ment ? | `you.id` | `placeDeclaree` | `rangs(ranking)` (sans avg/title) | « Rejouer » ne recompte rien |
| Morpion | `state.you` ('X'/'O') | `placeDeclaree`, même room | `classement(winner)`, `points: 0` | victoire 1/2 (20/10), nul 1/1 (20/20) ; abandon → `ended` seul |

Garde-fou statique : `node tests/hub-score-contract.mjs` (sans navigateur ni
serveur) ; les vraies parties : `tests/hub-score*.mjs`.

- **UI** (`renderScore` dans `hub-page.js`) : `#hub-score` est un **panneau à
  part** (`<aside class="panel">`), FRÈRE du salon (découpé au `clip-path`, rien
  n'en sort), placé entre `#lobby` et `#hub-lobby-games`. **≥ 1200 px** : grille
  (`main:has(> #hub-score:not([hidden]))`, salon ~880 px + colonne de 270 px),
  panneau `sticky` sur `grid-row: 2 / span 2`. Ton dernier gain en pastille
  (`.hub-score-delta.is-fresh`). **< 1200 px** : pleine largeur, après joueurs et action, avant le
  catalogue. ⚠️ Sa règle porte le MÊME préfixe `:has()` que `> *` (qui contient
  un ID) : un simple `main > #hub-score` perdait. Pas de médaille tant que
  personne n'a marqué ; au-delà de 6 joueurs, les 5 premiers + ta ligne.

## Livraison fiable du classement : results → ended

⚠️ **Un `send()` n'est pas une livraison.** `send()` (`game-hub.js`) rend
`false` si le socket Hub n'est pas ouvert, et `true` ne vaut pas accusé de
réception. `results()` / `ended()` ne font donc pas d'envoi direct
(`hub-handoff.js`, « livraison de results → ended ») :

- ils **notent** l'intention dans le `sessionStorage`, UNE entrée par partie,
  clé `mathys_hub_report:<session>:<drawId>` (`{ results, ended, sent, at }`),
  puis tentent la livraison. Contrat des pages inchangé (`results()` = « pris en
  charge », pas « reçu ») ;
- **confirmation par l'état du Hub, jamais par l'envoi** : `results` est
  confirmé par `launch.scored === true` (ou le refus `RESULTS_ALREADY`) ;
  `ended` ne part qu'APRÈS (ou sans classement : abandon du Morpion) et il est
  confirmé par `launch.stage === 'ended'`. Alors seulement l'entrée est effacée ;
- **reconnexion** : relancée à CHAQUE état reçu, dont le `joined` d'une reprise
  — aucune minuterie. `game-hub.js` expose `connection` (+1 à chaque socket) ;
- **navigation** : `/games/` branche le même mécanisme sur son client
  (`HubHandoff.attach(hub)` dans `hub-page.js`) : ce que la page du jeu n'a pas
  pu livrer l'est au retour, rechargement compris ;
- **doublons et boucles** : au plus UNE fois par connexion, 5 fois en tout.
  Refus définitifs (`BAD_RESULTS`, `GAME_MISMATCH`, `NOT_HOST`,
  `LAUNCH_MISMATCH`, `NOT_LAUNCHING`) → intention abandonnée (`ended` part
  quand même). En `create` / `join`, `results` attend (le Hub le refuserait) ;
- **jamais rejoué ailleurs** : une entrée d'une autre session, d'un autre
  tirage, d'un lancement échoué ou de plus de 3 h est effacée sans rien envoyer.

Sans cette livraison, un `ended` perdu laissait le Hub en `inGame` / `playing`
(aucune minuterie n'en sort, `abort` y est refusé ; seul le bouton « Partie
terminée » de `/games/` débloque). `started`, `launched`, `entered` passent
encore par un envoi simple : leurs pertes sont rattrapées par les échéances du
lancement (un `started` perdu → `playing` au bout de 120 s). Tests :
`tests/hub-report.mjs`, `tests/hub-report-play.mjs` (`--prod`).

## Débrief et fin de soirée

**Quitter ≠ terminer.** « Quitter la session » (`leave`, tout le monde) ne fait
partir que soi : ses points restent, les autres continuent. « 🏁 Terminer la
soirée » (`finish`, l'HÔTE seul, confirmation) termine pour TOUS et révèle le
podium final.

- **Débrief personnel** : en quittant une session où au moins une partie a été
  classée, « 📋 Ton récap de soirée » (`#hub-recap`, construit sur le DERNIER
  état reçu, posé au-dessus de l'entrée, jamais recréé au rechargement). Aucune
  partie → départ comme avant. `HubRecap.ranking()` est la règle de rang du
  panneau Score aussi ; `build()` ne calcule aucun point. Les joueurs partis
  restent au classement (« parti »).
- **Fin de soirée** (serveur : `finish`, état `finished`, message `finale`,
  erreur `FINISH_NOT_ALLOWED`, `src/finale.js`) : hôte = `session.hostId` (un
  hôte réélu peut terminer) ; au salon seulement (`lobby` / `debrief`) ; podium
  calculé UNE fois sur `scores`, joueurs partis compris (`present: false`) ;
  sockets détachés et fermés (4002) ; double clic = une seule clôture, la même
  finale.
- **Page** : `fromFinale()` reprend le podium TEL QUEL. Confirmation =
  `<dialog>` natif avec un `.panel` DEDANS (`.panel` sur le `<dialog>`
  casserait son positionnement).
- **La finale n'est PAS le récap rebaptisé** (lot D). Même section
  `#hub-recap` et mêmes id, mais `.is-final` change la composition :
  | | 📋 Récap (`leave`) | 🏆 Finale (`finish`) |
  |---|---|---|
  | classement | liste de lignes | podium : `#recap-ranking.is-podium`, une `.recap-step` par rang, puis `.recap-rest` |
  | toi | ligne en évidence | + plaque `#recap-me` « Ta place finale : 2e sur 5 · 50 pts » |
  | chiffres | parties, dernier jeu, dernier gain | parties seulement (`.recap-fact-perso` masqués) |
  | historique | tableau à colonnes | compact, secondaire |
  | suite | `#recap-next` (créer / rejoindre) | `#recap-home` « Retour à l'accueil » |
- **Podium** : `HubRecap.podium()` REGROUPE les rangs du Hub, ne calcule rien.
  Une marche par rang ≤ 3 tenu par quelqu'un qui a marqué ; des ex æquo
  partagent la marche (`.is-tie`, largeur `--n`) ; un rang absent (1, 1, 3)
  n'a PAS de marche ; 4e et au-delà, et 0 point, dans `.recap-rest`. DOM dans
  l'ordre des rangs (lisible sans CSS), le CSS pose 2e · 1er · 3e (`order`).
  Socle = bois de la caisse + plaque au pochoir « 1er ex æquo » (rang en
  toutes lettres, `aria-hidden` : chaque ligne dit son rang dans son
  `aria-label`). Solo : pas de socle (une plaque) ni de `#recap-me`. Personne
  n'a marqué (fin sans partie) : pas de podium, la liste. Au téléphone, des ex
  æquo empilent les marches (`.is-crowded`, 1er en haut) ; sans ex æquo, trois
  colonnes même à 390 px.
- **Révélation** : titre tamponné, puis la marche du 3e, du 2e, du 1er (socle
  qui monte, joueurs qui tombent dessus, lumière du 1er), puis le reste :
  ~3 s (`REVEAL_FIRST` 900, `REVEAL_STEP` 850). Tout est retenu par
  `.is-revealing` SEULEMENT : sans elle (mouvement réduit), tout est visible,
  aucune animation. Annonce finale (`#recap-live`) : vainqueurs, puis ta place.
- ⚠️ `scrollIntoView({ behavior: 'instant' })`, pas `'auto'` (qui suit le
  `scroll-behavior: smooth` de tf2.css et avale le clic suivant). Au téléphone,
  les colonnes de l'historique du récap sont posées EXPLICITEMENT.

## Game Hub : le salon et le retour de partie

Ordre, bureau et téléphone : **joueurs → action → score → jeux possibles →
indisponibles → Quitter / Terminer.**

- Le salon = **trois blocs frères** dans `main` : `#lobby` (code, joueurs,
  `#hub-act`, caisse, carte Résultat), `#hub-score`, `#hub-lobby-games`
  (catalogue puis `.hub-foot` avec Quitter et Terminer). ⚠️ `show()` bascule
  toujours les trois, et la règle d'anneau de focus (box-shadow inset) liste
  `#hub-lobby-games button`.
- **`#hub-act`**, sous les joueurs : `#hub-draw-btn` chez l'hôte ; chez les
  invités, `#hub-wait` en encart (`.is-waiting`). Pendant le debrief d'une
  partie classée, `#hub-act` se tait : la carte Résultat porte la suite.
- **Carte `#hub-round` « 🏆 Résultat — <jeu> »** au debrief d'une partie
  CLASSÉE, à la place de la caisse. Données : `HubRecap.lastResult()` = la
  dernière entrée de `history.games` **à condition** que son `drawId` soit celui
  du lancement terminé. ⚠️ Ne pas relâcher cette condition (sinon fausse carte
  après un abandon du Morpion ou un lancement annulé). Points de partie masqués
  si tous à 0 ; solo sans rang ni médaille. « 🎲 Tirage suivant » est le MÊME
  `#hub-draw-btn`, déplacé par `renderRound()`. Arrivée + focus sur le titre
  (`tabindex="-1"`, `aria-describedby` = la phrase du joueur) une fois par
  partie et par onglet (`sessionStorage` `mathys_hub_round`), dans un
  `setTimeout(0)` (au retour, le premier rendu précède `show('lobby')`). Pas
  d'anneau sur ces titres. `showRecap` met de même le focus sur `#recap-title`.
- **Score vide** : `#hub-score.is-empty`, une ligne ; les lignes restent
  calculées, masquées.
- **Catalogue** : `#hub-games` contient TOUJOURS les 10 fiches : `#hub-games-ok`
  puis `<details id="hub-out">` (`#hub-games-out`) avec les raisons et les ❤️ /
  🚫 (c'est là qu'on
  lève son veto) ; ouvert d'office s'il n'y a plus aucun jeu possible.
  ⚠️ Le contenu d'un `<details>` fermé est en `content-visibility: hidden` :
  tester avec `checkVisibility()`, pas `offsetParent`.
- **« 🏁 Terminer la soirée »** : secondaire (liseré rouge en box-shadow inset),
  en bas du second panneau, loin de « Tirer ». `.crate-plate` a une marge de
  2.9rem (le couvercle ouvert recouvrait la plaque).
- ⚠️ Test : un clic envoyé pendant un défilement DOUX tombe à côté ;
  `hub-draw.mjs` attend la fin réelle du défilement (`J.scrollFini()`).

## Statistiques de joueur (lot H)

« Comment je joue ? » : parties, victoires, podiums, meilleure place, par jeu,
d'une soirée à l'autre, dans le panneau « 👤 ton profil » du salon.

- **Source de vérité : le Hub.** Une ligne n'existe que parce que le Hub a
  ACCEPTÉ un classement (`results`, contrat Score **inchangé**) :
  `game-hub-server/src/stats.js` (règles pures), écrit juste après
  `scores.apply`, en asynchrone, jamais attendu. Le client ne déclare rien :
  `{ action: 'stats' }` ne porte RIEN, le Hub désigne le joueur par son socket
  et ne rend que SES agrégats. Aucun calcul dans `hub-page.js`.
- **Stockage** : Postgres (Neon, `DATABASE_URL` sur le service Render du Hub),
  tables `hub_players` (id + empreinte de la clé) et `hub_plays` (une ligne
  par tirage et par joueur), agrégats calculés en SQL (`group by` jeu). Sans
  `DATABASE_URL` : pas de statistiques, la soirée marche comme avant, et le
  Hub l'annonce (`created` / `joined` portent `stats: false`) — la page ne
  demande alors rien et dit « Ce Hub ne garde pas encore de statistiques ».
  `HUB_STATS=memory` : stockage en mémoire (tests). ⚠️ Pour qu'elles existent
  en production, Mathys crée la base Neon et pose `DATABASE_URL` (le schéma se
  crée tout seul au premier appel).
- **Identité** : l'id du profil ne suffit pas (il est dans l'état public de
  chaque session). Le profil porte une **clé** (`key`, 43 caractères base64url,
  `game-profile.js`), envoyée au Hub SEUL par `playerFrom` ; le Hub n'en garde
  que le sha256. Premier passage d'un id = enregistrement ; autre clé = ni
  lecture ni écriture pour ce socket (« Pas de statistiques pour ce profil dans
  ce navigateur »), la partie se joue quand même. Un pseudo changé ne change
  rien ; effacer les données du site = nouvel id = nouvelles statistiques (pas
  de compte). Un profil d'avant le lot H reçoit sa clé au premier chargement.
  ⚠️ La clé ne doit JAMAIS partir vers un serveur de jeu ni s'afficher.
- **Définitions** (rang du JEU, tel que reçu : aucun classement recalculé) :
  | | compte |
  |---|---|
  | partie | une partie classée où tu as une place, solo compris |
  | victoire | rang 1 **et au moins un classé derrière** : ni un solo, ni un nul du Morpion (1 / 1). Ex æquo 1, 1, 3 → deux victoires |
  | podium | rang ≤ 3, à 2 classés ou plus |
  | meilleure place | plus petit rang, à 2 classés ou plus (absente si que du solo) |
  Les points de soirée sont stockés, **pas affichés** (ils dépendent de la
  taille du groupe). Un joueur PARTI avant le classement compte (sa place le
  prouve) ; le score de SOIRÉE, lui, reste aux présents.
- **Doublons** : `RESULTS_ALREADY` (une fois par lancement), puis la clé
  primaire `(draw_id, player_id)` + `on conflict do nothing` — un renvoi, même
  après un redémarrage du Hub, ne recompte rien. Base injoignable : deux
  nouvelles tentatives, `stats` répond `UNAVAILABLE` (jamais un faux zéro).
- **Panneau** : « 📊 Tes statistiques » entre l'identité et le texte de soirée ;
  redemandées à CHAQUE ouverture. Vide → une phrase (« Aucune partie jouée… »),
  jamais une rangée de zéros. Quatre cases `<dl>` libellé / chiffre / précision
  (2 × 2 sous 560 px), puis « 🎮 Par jeu » (le plus joué d'abord, nom en « … »).
  Que du solo → une seule case « en solo » et la raison (« personne à
  battre »). Résumé annoncé par `#profile-stats-live` (`role="status"`),
  `aria-busy` pendant le chargement. Chaque ligne « Par jeu » finit par
  « meilleure place : 1er » quand elle existe (déjà dans `games[].best`).
- **Disposition du panneau** (micro-lot « profil compact », CSS seulement) :
  sous 720 px, une colonne dans l'ordre du DOM (identité, statistiques, par
  jeu, records, succès). À partir de 720 px, `#profile-dialog` s'élargit
  jusqu'à 980 px et devient un petit tableau de bord par `grid-template-areas`
  : identité | textes de la soirée ; statistiques 2 × 2 | records 2 × 2 ; par
  jeu en colonnes (`minmax(18.5rem, 1fr)`) ; les 10 succès sur 2 colonnes.
  ⚠️ Le DOM et l'ordre de lecture ne changent PAS (seul l'affichage pose les
  records à côté des statistiques). La rangée « Fermer » colle au bas du
  `<dialog>` qui défile (`position: sticky`), à toutes les largeurs.
  `hub-stats.mjs` (N.) mesure tout ça à 390 / 768 / 1100 / 1280 px.

## Records personnels (lot I)

« 🏆 Tes records », sous les statistiques, dans le même panneau.

- **Source de vérité : le Hub, et les MÊMES données que le lot H.** Aucune
  table, aucune requête, aucune persistance de plus : `records(s)` dans
  `game-hub-server/src/stats.js` est dérivé du résumé (`summarize()`, qui
  l'attache en `stats.records`), lui-même tiré des agrégats par jeu
  (`perGame`, SQL `group by`). Donc mémoire = Postgres par construction, et la
  MÊME réponse `stats` porte tout (une seule demande par ouverture). Même
  garde que le lot H : le joueur est désigné par son socket, id + clé vérifiés.
- **Définitions** (celles du lot H, rien de recalculé) :
  | `records.` | contenu | absent (`null`) |
  |---|---|---|
  | `best` | meilleure place à plusieurs | que du solo |
  | `wins` | victoires (1er + au moins un classé derrière) | aucune victoire |
  | `mostPlayed` | `{ games, played }` — solo compris | jamais (dès 1 partie) |
  | `mostWins` | `{ games, wins }` | aucune victoire |
  `records: null` = aucune partie (« Pas encore de record. »). Que du solo →
  « Aucun record compétitif pour l'instant. » + le jeu le plus joué. Un record
  absent n'est jamais montré comme un zéro.
- ⚠️ **Égalité = TOUS les jeux à égalité dans `games`**, dans l'ordre du résumé
  (le plus joué, puis l'id) : aucun départage, ni au serveur ni à la page.
  Libellé au pluriel (« Meilleurs jeux »), précision « à égalité · 1 victoire
  chacun », un jeu par ligne (séparateurs « , » / « et » pour le lecteur
  d'écran) ; plus de trois → « 4 jeux » (le détail est dans « Par jeu »).
- **Non retenu** : la meilleure performance en POINTS du jeu (`hub_plays` ne
  garde que les points de soirée) ; séries, badges, XP, comparaison avec les
  autres — hors lot.
- **Page** : `game-hub.js` relit `records` en liste blanche (`readRecords`) ;
  un Hub d'avant le lot I n'envoie pas la clé → section cachée (≠ `null`).
  Cartes `.profile-record` (classe `.profile-figure` réutilisée), en deux
  colonnes à toutes les largeurs (le panneau ne dépasse pas 440 px), emoji en
  `aria-hidden`, nom de jeu en « … » avec le nom entier en `title`. L'annonce
  ajoute les jeux en tête (meilleure place et victoires sont déjà dans la
  phrase des statistiques). Le panneau montre donc deux fois victoires et
  meilleure place : c'est la maquette du lot I.

## Succès (lot J)

Dix succès, la section « 🎖️ Tes succès » du profil, et la notification
« 🏆 Succès débloqué » au retour au Hub.

- **Le Hub décide** (`game-hub-server/src/achievements.js`, pur) : rejeu des
  parties `hub_plays` du joueur dans l'ordre (`played_at`, `draw_id`), chaque
  succès daté par la PREMIÈRE partie qui le rend vrai (tous monotones). Aucun
  message client ne débloque quoi que ce soit ; la page ne connaît que les
  TEXTES (`SUCCES` dans `hub-page.js`, mêmes codes et même ordre que `CODES`
  côté serveur — `hub-achievements.mjs` compare).
  | code | succès | condition |
  |---|---|---|
  | `first-win` | 🥇 Première victoire | 1 victoire |
  | `explorer` | 🧭 Touche-à-tout | 5 jeux différents (solo compris) |
  | `stalemate` | ✖️ Pat | 3 nuls au Morpion (1 / 1, personne derrière) |
  | `shared-throne` | 🤝 Partage du trône | 1er ex æquo devant au moins un joueur |
  | `versatile` | 🔀 Polyvalent | victoires dans 3 jeux |
  | `marathon` | 🏃 Marathon | 10 parties compétitives dans une soirée |
  | `night-owl` | 🌙 Oiseau de nuit | partie compétitive à 00:00:00–04:59:59, Europe/Paris |
  | `hat-trick` | 🔥 Hat-trick | 3 victoires d'affilée dans une soirée |
  | `crowd-king` | 👑 Roi de la foule | victoire à 6 classés ou plus |
  | `grand-slam` | 💎 Grand Chelem | victoire aux 7 jeux en ligne (liste FIGÉE) |
  Victoire = celle du lot H. Compétitive = 2 classés ou plus : le solo ne
  compte que pour Touche-à-tout. Soirée = parties compétitives consécutives,
  même code de session, ≤ 12 h entre deux. Série : un 1er ex æquo devant
  quelqu'un la continue, une défaite ou un nul du Morpion la casse, un solo
  est ignoré, une partie abandonnée ou jouée sans toi n'existe pas.
- ⚠️ **Table `hub_achievements`** `(player_id, code, unlocked_at, draw_id,
  notified_at)` — nécessaire pour retenir le PREMIER déblocage (la clé
  primaire décide : `returning code` = les nouveaux) et « déjà notifié » à
  travers rechargement, reconnexion, autre onglet, autre navigateur et
  redémarrage du Hub. Créée toute seule ; le jour de sa création, les succès
  déjà mérités y sont inscrits SANS notification (`notified_at =
  unlocked_at`, même transaction). Aucune action sur Neon.
- **Quand la notification apparaît** : le Hub débloque juste après les lignes
  d'un classement accepté et envoie `achievement` aux sockets du joueur ; la
  page du JEU l'ignore (seule `hub-page.js` écoute — le test le vérifie
  dans les sources). Au retour à `/games/` (`joined`), le Hub renvoie tout ce
  qui n'est pas notifié (`auRetour`, qui rattrape aussi un déblocage manqué) ;
  déjà sur `/games/`, c'est immédiat.
- **La notification** (`#ach-toast`, bas droite ; pleine largeur sous 560 px) :
  une à la fois, en file (« · 1/2 »), ~5 s chacune, 0,7 s après l'arrivée (la
  carte Résultat prend le focus d'abord). Visuelle seulement (`aria-hidden`) ;
  annoncée UNE fois par `#ach-live`. Ne prend jamais le focus. Attend tant
  qu'un `<dialog>` est ouvert ou que l'onglet est caché. Pause au survol ;
  `pointer-events: none` au doigt. Mouvement réduit : ni glissement ni fondu.
- **Mémorisée par le Hub** : à l'AFFICHAGE, la page envoie
  `achievements-seen` (→ `notified_at`). Garde-fou d'affichage en plus
  (`localStorage` `mathys_hub_ach_shown`, par id) : un code déjà montré ici
  n'est pas rejoué si l'accusé s'est perdu — il est accusé de nouveau, sans
  être affiché. Ce garde-fou ne débloque rien.
- **Profil** : 10 lignes, obtenus d'abord puis verrouillés, l'état ÉCRIT
  (« ✓ Obtenu le 1 oct. 2026 » / « 🔒 Verrouillé », signes en `aria-hidden`),
  « Nouveau » si la partie qui l'a débloqué est dans la soirée en cours,
  compteur « · 5/10 ». Un Hub d'avant le lot J n'envoie pas `achievements` :
  section cachée.
- **Limite** (celle du score) : le classement passe par le navigateur de
  l'hôte, et un second profil fait un faux adversaire. Succès cosmétiques,
  aucun classement entre joueurs.

## Profils publics des joueurs (lot K)

Deux profils, un seul panneau (`#profile-dialog`, même mise en page, mêmes
ids) :

| | Profil PRIVÉ — « Ton profil » | Profil PUBLIC — un autre joueur |
|---|---|---|
| bouton | `#hub-profile-btn` « 👤 ton profil », sur TA carte | `.hub-card-public` « 👤 Profil » (`data-player`, `aria-label` « Voir le profil de Bob »), sur les cartes des AUTRES |
| message | `stats` (ne porte rien) | `public-profile { playerId }` |
| qui | toi (ton socket, ta clé) | un joueur de TA soirée dont la clé y a été vérifiée |
| contenu | tes stats, records, succès (+ « Nouveau ») | identité du HUB + stats, par jeu, records, succès (sans drawId, donc sans « Nouveau ») |
| textes | « Tes statistiques »… | « Profil de Bob », « 📊 Statistiques », « Aucune partie enregistrée. », « Ces chiffres viennent du Game Hub, jamais du navigateur de Bob. » |

- ⚠️⚠️ **UN PLAYER ID SEUL NE PERMET JAMAIS D'ACCÉDER AUX STATS D'UN JOUEUR.**
  Les ids sont publics (état de chaque session). Le Hub (`onPublicProfile`)
  exige : demandeur dans une session, cible dans CETTE session (présente ou
  partie, `session.departed`), clé de la cible VÉRIFIÉE dans cette session.
  Entrer avec l'id d'Alice sans sa clé → `UNVERIFIED` (identité seule). Id
  inventé ou autre soirée → `NOT_FOUND`, même réponse (pas d'oracle).
  `test-public-profile.js` le prouve (mutation sans la vérification de clé :
  Mallory lit les stats de Dan).
- **Identité** : celle que le Hub connaît (nom et avatar de la session, ou de
  `session.departed`), jamais le profil local du joueur consulté.
- **À l'ouverture seulement** (`hub.requestPublicProfile`, annoncé par
  `profiles: true` dans `created` / `joined`) : rien au chargement du salon,
  pas de polling, rien gardé après fermeture. Un ancien Hub ne l'annonce pas →
  pas de bouton. Lecture seule : rien n'est débloqué pour la cible.
- **Joueur parti** : si son profil est ouvert, le panneau le dit (« parti de
  la soirée », « X a quitté la soirée : ses statistiques restent… ») sans rien
  redemander ; le Hub le sert encore dans cette soirée. ⚠️ Limite : sa carte
  disparaît du salon, donc plus de bouton pour l'ouvrir après son départ (pas
  de nouvelle persistance pour ça).
- **Focus** : les boutons publics sont gardés d'un rendu à l'autre (Map
  `boutonsPublics`), comme `#hub-profile-btn` ; à la fermeture le focus revient
  au bouton d'origine, ou à « ton profil » si celui-ci a disparu — y compris
  quand le focus est resté DANS le panneau fermé (corrigé au lot K).
- Le mode du panneau est dans `fiche` (`hub-page.js`) : `stats` n'est affiché
  qu'en mode privé, `public-profile` qu'en mode public et pour la cible
  ouverte.

## Roquette Party : les armes (skins)

Purement cosmétiques : aucun effet sur la partie, aucun inventaire, aucun
déblocage, rien au Hub. Aujourd'hui `roquette` (défaut), `petoire` (« La
Pétoire de Secours », le Scorch Shot du Pyro) et `marmite` (« Le Grenade
Launcher », le lance-grenades du Demoman) ; V1 prévue : + `disrupteur`.

- ⚠️⚠️ **Règle de DA : FIDÉLITÉ TF2 > ORIGINALITÉ > BLAGUE** (depuis le
  2026-10-05). Chaque skin adapte UNE arme de TF2 précise (référence unique,
  jamais un mélange) qu'un joueur doit reconnaître à la silhouette et à ses
  éléments caractéristiques. Avant tout code : un **dossier de référence
  validé** par Mathys (5 à 10 marqueurs sourcés, silhouette en noir uni,
  projectile observé EN MOUVEMENT, ce qui reste propre à Roquette). Dessin
  **maison** en SVG/CSS : aucun asset de Valve (modèle, texture, sprite,
  icône), aucune géométrie de modèle reprise. Le nom affiché reste celui de
  Roquette Party (jamais le nom TF2 dans le jeu) — exception décidée par
  Mathys : « Le Grenade Launcher », nom PROVISOIRE (2026-10-05). Les blagues
  passent après la reconnaissance. Dossiers : artifacts « Dossier Scorch Shot »
  et « Dossier Grenade Launcher » (sources wiki et vidéos horodatées).

- **Contrat** (`roquette-server`, README) : un id FERMÉ par joueur (`SKINS`
  dans `server.js`) ; `skin` dans `join`, dans les joueurs de `lobby` et de
  `countdown` (figé dans le roster pour la partie, revanche comprise) ;
  action `{ action: 'skin', skin }` au SALON seulement, relayée en
  `{ type: 'skin', id, skin }` ; invalide, identique, hors salon ou au-delà de
  4 changements/s → ignorée en silence. Seul l'id nettoyé repart.
  ⚠️ **Nouvelle arme = serveur d'abord** (l'id dans `SKINS`), front ensuite.
- **Choix** : au salon (`#skin-choix`, boutons `.avatar-pick.skin-pick`,
  `aria-pressed`) — seul écran commun au jeu seul et au Hub (le handoff saute
  l'accueil). Caché si le serveur ne met pas `skin` dans `lobby` (ancien
  serveur : l'action lui ferait répondre « action inconnue »). Préférence
  `localStorage` `roquette_skin`, propre au jeu (PAS dans `GameProfile`),
  partie avec le join. Un envoi au plus toutes les 260 ms, le dernier choix
  gagne. ⚠️ Le gestionnaire des avatars vise `#avatar-row .avatar-pick` :
  les armes portent la même classe.
- **Affichage** : l'arme montrée est celle du joueur VISÉ
  (`rocket.setSkin(skinDe(holder))` au countdown et à chaque turn, celle de
  `boom.id` à l'explosion), lue dans le roster tel que le SERVEUR l'a relayé ;
  tout id inconnu → la roquette (`Rocket.skinId`, avec `hasOwnProperty`).
- **Table** `Rocket.SKINS` (`rocket.js`) : dessin, nom, sons propres
  (`depart` / `impact`, `sound.js`), `couche` (classe de sa couche d'impact,
  `COUCHES` dans `app.js`, ou `null`), `projectile`. Tic, validation,
  verrouillage (lueur rouge) et explosion restent COMMUNS ; l'étoile orange
  aussi, une arme la fait précéder de sa couche (la Pétoire :
  `.scorch-impact`, éclair orange à rayons puis boule rouge qui s'éteint,
  l'étoile 150 ms après).
- ⚠️ **Arme ≠ projectile** (`projectile: true`, la Pétoire et le Grenade
  Launcher) : le dessin est DEUX calques superposés dans la même boîte,
  `.r-proj > svg.p-fusee` (`svg.p-grenade` pour le Grenade Launcher ; le
  projectile, AVANT dans le DOM, donc dessous : la bouche du canon couvre sa
  queue) puis `svg.p-arme`. `boom()` passe alors par `tirer()` : l'arme reste
  au centre (se cale, éclair `.is-firing`, recul `SKINS[].recul`), seul `.r-proj` vole (même
  formule de course, même minutage 160 + 260 + 340 ms : l'impact tombe au même
  instant que la roquette), `.is-shot` le cache à l'impact. ⚠️ Chargée, la
  fusée est INVISIBLE (`.r-proj` en `visibility: hidden` hors `.is-flying`) :
  rien ne dépasse de la bouche, le danger se lit à la bouche (lueur, fumée,
  étincelles). Au tir : éclair, gerbe (`.p-gerbe`) et bouffée de fumée rouge
  (`.p-bouffee`), recul autour de la MAIN (`transform-origin` de `.p-arme`)
  qui relève le canon. En vol : tête incandescente (`.p-tete`) DEVANT le corps
  (`.p-corps`), fumée rouge (`.p-fumee-vol`) ; plus de flamme arrière ni de
  traînée rose (le test le vérifie). La roquette garde son chemin :
  c'est `.r-fly` (toute l'arme) qui vole. Une arme non symétrique se
  retourne quand elle vise à gauche (`.is-gauche`, propriété CSS `scale` sur
  `.r-bob` : elle se compose avec les `transform` du balancement et des
  animations au lieu de les écraser). ⚠️ Le montage en calques et le
  retournement sont des règles CSS qui LISTENT les armes à projectile
  (`:is([data-skin="petoire"], [data-skin="marmite"])`) : une nouvelle arme à
  projectile s'y ajoute, sinon ses calques s'empilent l'un sous l'autre.
- **Le Grenade Launcher** (`marmite`, référence unique : le Grenade Launcher
  du Demoman ; dossier validé) : profil du modèle mesuré colonne par colonne
  puis ramené au repère du jeu — canon de 17 u sur l'axe, bouche à +60, talon
  à −110,7 (114,5 u du pivot contour compris, sous EMPRISE 120,4 ; plafond du
  canon : 17,5 u), 10 D de long, L / H ≈ 3,2. Marqueurs dessinés et MESURÉS
  par le test (classes `.m-*`) : cage grise du barillet plus haute que le
  canon (surtout dessous), deux chambres, canon noir qui sort du HAUT, hausse
  à ~1 D de la bouche, garde-main et crosse de fusil en bois orangé. Grenade
  (`svg.p-grenade`, pilule de 24 × 13 u, culot à +34) cachée DANS le canon ;
  en vol elle CULBUTE (`.m-tourne`, animation CSS ~4,5 tr/s après 70 ms —
  rotation PUREMENT cosmétique, la course reste celle de `tirer()`), dans son
  halo rouge (`.m-halo`), avec une fine traînée rouge (`.m-trainee`). Tir :
  éclair ROND, étincelles, brume claire, recul court autour de la poignée.
  Impact : l'explosion standard de TF2, donc `couche: null` (étoile commune
  seule) ; sons `tube` puis l'`impact` de la roquette. Contre-épreuves :
  arme qui vole entière → 4 échecs ; plus de rotation → 1 échec.
- ⚠️ **L'enveloppe** : même viewBox, même pivot (0, 0), nez à +60 (`NEZ`),
  rien plus loin du pivot que la flamme arrière de la roquette (`EMPRISE`) —
  `fit()` ne connaît qu'elle, la taille ne dépend jamais de l'arme.
  `roquette-skins.mjs` mesure la portée de chaque arme au danger 3.
- ⚠️ **Id de dégradés préfixés** (`{p}` dans chaque dessin : `r` dans
  l'arène, `apercu-<id>` au salon). Un même id dans un sous-arbre
  `display: none` (le salon pendant la partie, l'arène au salon) passerait
  avant et le dégradé ne s'afficherait pas. Et chaque arme a ses PROPRES noms
  (la Pétoire : `{p}-sc-…`) : deux dessins qui partagent un nom (`acier`,
  `chaleur`…) sous le même préfixe se volent leurs dégradés (vu : carcasse et
  crosse du Scorch Shot rendues en noir).
- Crochets du danger communs (`.r-flamme`, `.r-fumee`, `.r-chaleur`,
  `data-danger`) ; ceux d'une arme sont sous `[data-skin="…"]` (sans
  `.rocket` : l'aperçu du salon porte aussi `data-skin` ; celui de la
  Pétoire est recentré et grossi par CSS, au salon seulement). Fumée de vol
  seulement pendant `.is-flying` (posé par `rocket.js`). Mouvement réduit : ni
  tir animé, ni vol, ni éclat, étincelles figées ; le texte et les sons
  portent l'information.

## Défauts connus, non corrigés

- `tests/manifest.mjs` : la mutation « jeu live sans bloc hub » est une regex en
  `\n`, qui ne s'applique pas sur un poste en `core.autocrlf=true` (CRLF).
- `tests/passeur-play.mjs --reduced` instable au premier clic sur ce poste
  (harnais, pas le jeu ; le mode normal passe).
- `tests/keyboard.mjs` : échec intermittent sur le Ban (« Retour au Game Hub » :
  le focus tombe sur `#tw-check`), ~1 passage sur 3 ou 4 sur ce poste, vu aux
  lots G et H, jamais reproduit sur commande.
- `tests/roquette-play.mjs` (normal ou `--reduced`) : échec intermittent
  « téléphone, clavier ouvert : … carte visée à l'écran » (`scrollY 101`),
  ~1 passage sur 3 ; vu avec le front d'avant les armes (2026-10-05), donc
  antérieur à elles. Revu au lot du Grenade Launcher : plus fréquent ce
  jour-là (3 sur 3 après le lot, 1 sur 2 sur le code d'avant), même géométrie
  au pixel près des deux côtés (`scrollY` 0, 13 ou 101 selon le passage) — le
  téléphone de cette suite ne montre que la roquette.
