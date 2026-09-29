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
- ⚠️ **Anneau de focus rogné** : le socle le dessine en `outline`, que le
  `clip-path` des boutons génériques rogne. Corrigé sur `/games/` (box-shadow
  inset) et bon sur `.tf-btn` ; **défaut encore ouvert** dans les jeux au
  `button` générique (vu sur Imitation), et `keyboard.mjs` ne le voit pas (il
  compte le biseau comme un anneau).

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
  sans exception ; une migration de `v` se branchera là).
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
| serveur | `game-hub-server/src/` | `hub.js`, `session.js`, `engine.js`, `catalog.js`, `health.js`, `launch.js`, `scores.js`, `finale.js`, `protocol.js`, `serialize.js` |

Configuration : une seule constante `PROD` dans `game-hub.js` ; `?hub=` la
remplace. Protocole relu dans `game-hub-server/src` : `create` / `join` /
`leave` → `created` / `joined` / `session` / `error { code, message }`. Les
codes d'erreur sont ceux du serveur (`SESSION_NOT_FOUND`, `SESSION_FULL`,
`SESSION_CLOSED`, `BAD_CODE`, `BAD_PLAYER`, `REPLACED`…), traduits par
`errorText()` ; un code **inconnu** est affiché avec son code (jamais noyé dans
une phrase générique). Une session compte au plus 12 joueurs (le
`MAX_PLAYERS` de `precision-server`, le plus permissif).

### Le manifest des jeux

- **`data/games.js` est la source de vérité** (bloc `hub` par jeu jouable, 8 sur
  9 — « La suite » n'en a pas). **`data/games.manifest.json` est GÉNÉRÉ** par
  `tools/build.mjs` ; le Hub le relit sur GitHub Pages (cache 5 min) : ajouter
  un jeu au portfolio l'ajoute au tirage sans redéployer le Hub.
- ⚠️ **Schéma FERMÉ** (clés `CLES`, vocabulaires fermés `needs` = `mic` /
  `cam` / `consent`, `categories`) : aucun identifiant de contenu n'entre dans
  le manifest, et une faute de frappe fait échouer le build au lieu de créer un
  filtre que rien ne satisfait.
- `minutes` = `{ min, max }` au réglage par défaut ; le filtre de durée compare
  le `max`. `content` / `replay` à `false` = « non supporté OU pas vérifié »
  (`replay` est à `true` pour Le Passeur et Qui Ment ?). Le Hub transporte
  l'historique de contenu sans l'interpréter ; limite connue : les serveurs
  rappellent `E.deal()` à chaque `start`, donc « rejouer » efface
  l'anti-répétition de contenu.
  `handoff: true` pour les sept jeux en ligne (Puissance 4 : `false`) ; le test
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
  la fiche (`#result-kicker` « 🎯 Jeu tiré »), la bande s'efface derrière la
  vignette gagnante (`.reel-cell.is-win`), `#hub-draw-status` passe en texte
  pour lecteurs d'écran seulement (`#hub-draw.is-revealed`). Focus sur
  `#hub-continue` chez l'hôte ; chez l'invité, « ⏳ En attente de <hôte> pour
  lancer <jeu> ». `point()` évite « Qui Ment ?. ».
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
Passeur, Qui Ment ?) ont le **même montage**. Puissance 4, local, n'en a pas
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
- `results(rangs)` PUIS `ended()` à la fin d'une partie complète, et un lien
  **« ↩ Retour au Game Hub »** (`#to-hub`, jamais la classe `.back`, réservée
  au retour portfolio). Détail du contrat : « Score de soirée », tableau de
  référence. Les deux sont LIVRÉS jusqu'à confirmation par l'état du Hub, même
  à travers une coupure ou un retour à `/games/` : « Livraison fiable du
  classement » ;
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
  « simplifier » en renvoyant `start` directement.
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
- **Catalogue** : `#hub-games` contient TOUJOURS les 8 fiches : `#hub-games-ok`
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

## Défauts connus, non corrigés

- Anneau de focus rogné dans les jeux au `button` générique (voir « Pièges de
  spécificité »).
- `tests/manifest.mjs` : la mutation « jeu live sans bloc hub » est une regex en
  `\n`, qui ne s'applique pas sur un poste en `core.autocrlf=true` (CRLF).
- `tests/passeur-play.mjs --reduced` instable au premier clic sur ce poste
  (harnais, pas le jeu ; le mode normal passe).
