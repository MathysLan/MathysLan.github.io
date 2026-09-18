# Portfolio Mathys Langiny — notes d'architecture (à lire en premier)

Ce fichier existe pour qu'une **nouvelle conversation reparte avec le bon
contexte**. Si tu débarques : lis-le en entier avant de toucher quoi que ce soit.

## Le principe de base : front statique + serveurs séparés

- **Le portfolio** (`mathyslan.github.io`) est un site **statique** : HTML +
  Vanilla JS + Tailwind **compilé** (`css/tailwind.css`, plus de CDN). Hébergé
  sur **GitHub Pages**, servi tel quel. Aucun framework. Pas de logique de jeu
  ici. Un seul script de génération, `tools/build.mjs` (Node, zéro dépendance) :
  pré-rendu du contenu de `data/*.js` dans `index.html`, compilation Tailwind
  via `npx`, sitemap. Voir « Stabilisation » plus bas.
- **Chaque jeu multijoueur a son PROPRE serveur** Node.js (WebSocket, lib `ws`),
  déployé **à part sur Render**. Le front et le back ne vivent PAS dans le même
  repo : ce repo ne contient que le **front**. Les serveurs sont livrés/déployés
  séparément.
- **Règle d'or : le serveur est la seule autorité.** Le front envoie des
  *intentions* (« je place mon curseur à 42 », « voici mon indice ») ; le serveur
  valide TOUTES les règles et calcule TOUS les scores. Le front ne calcule jamais
  un score ni ne décide d'une phase. Modèle « zéro confiance » : par ex. la cible
  du Demi-Cercle n'est envoyée qu'au Guide, jamais aux devineurs avant les
  résultats ; les curseurs live ne partent qu'au Guide (pas entre devineurs, pour
  éviter la triche).
- Protocole : messages **JSON** sur un seul WebSocket. Machine à états par phase,
  progression **pilotée par le MJ/host** (plus de timers de gameplay dans les
  versions récentes).

## Les jeux

| Jeu | Front | Serveur | Notes |
|-----|-------|---------|-------|
| **Demi-Cercle** | `games/demicercle/` | `demicercle-server` (Render) | Cadran SVG, un Guide donne un indice, les autres placent un curseur 0–100. Mode `auto` (thèmes catalogue) ou `custom` (le Guide invente thème + extrémités, mais PAS la cible). |
| **Imitation** | `games/imitation/` | serveur dédié (Render) | Enregistrement voix (MediaRecorder + Web Audio), vidéos de référence sur **Cloudflare R2** (CORS requis). Double waveform référence (ambre) + voix (violet) pour juger la synchro. |
| **Le Jeu du Ban** | `games/ban/` | `ban-server` (Render) | Une vidéo (CDN R2) cache un mot interdit à `fatal` (secondes). Chacun son tour, on stoppe au plus tard sans dépasser. Serveur : `setTimeout` pour le rythme + filet anti-blocage, temps recoupé à l'horloge serveur (anti-triche), ordre de passage aléatoire par vidéo. `fatal` jamais envoyé avant `results`. **Catalogue = `games/ban/videos.json` DANS CE REPO** (`{id, fatal, startAt}`) : le serveur le fetch depuis Pages à chaque partie (cache 10 s), donc Mathys édite le JSON + push, aucun redeploy Render. Contrepartie assumée : `fatal` public. |
| **Précision** | `games/precision/` | `precision-server` (Render) | Party game inspiré de dialed.gg : 4 épreuves (shape/color/sound/time). TOUT LE MONDE joue en même temps. Le serveur génère la cible, tient les timers de phase (`memorize`→`play`, durées selon la difficulté Facile→Impossible) et calcule la précision 0–100 %. Moteur pur `engine-precision.js` (barèmes + scoring : teinte circulaire, symétrie du triangle, cents pour le son). Cible envoyée en `memorize` seulement ; `time` recoupé à l'horloge serveur. |
| **Puissance 4** | `js/connect4.js` (`launchConnect4`) | aucun (100 % navigateur) | Canvas, bot heuristique gagner > bloquer > centre. Lancé par le carousel, INSERT COIN, Ctrl+K, Konami. |
| **Morpion** | `games/morpion/` | `morpion-server` (Render) | URL du serveur fixée dans `net.js` (pas de `?server=`, contrairement aux autres). |
| **Le Passeur** | `games/passeur/` | `passeur-server` (Render, PAS ENCORE DÉPLOYÉ) | Une situation de volley, cinq passes, cinq secondes. Points = pertinence × vitesse. Barèmes et `why` envoyés seulement au `results` ; temps recoupé à l'horloge serveur. Catalogue = `situations.js` côté serveur. |
| **Qui Ment ?** | `games/quiment/` | `qui-ment-server` (Render, PAS ENCORE DÉPLOYÉ) | Jeu de bluff. Tout le monde a le même mot sauf l'intrus, qui n'a que la catégorie. 2 tours d'indices en aveugle, vote, révélation, dernière chance. Le mot ne part JAMAIS en diffusion. Catalogue = `mots.js` côté serveur. |

Le **carousel des jeux** (`js/carousel.js`) est un coverflow 3D ; le drag ne
démarre qu'après un seuil de 6 px pour que le lien « Jouer » reste cliquable.

## Contraintes de l'environnement de dev (IMPORTANT)

- **Poste Windows de Mathys** (Claude Code en local) : `git push` fonctionne.
  **Pas de Node ni de Python installés** : pour exécuter `tools/build.mjs` ou
  une conversion d'images, télécharger le zip Node officiel dans le scratchpad
  (vérifier le SHA-256), rien sur le système. Navigateur de test : Edge
  headless (`msedge --headless=new`). Sous PowerShell la sortie de
  `--dump-dom` est vide : passer par l'outil Bash.
- Les notes ci-dessous (proxy, Playwright sous /opt, zip) concernent
  l'environnement **cloud** Linux utilisé pour les serveurs.

- **Le proxy sortant bloque le réseau externe** (HTTP 000/403). On ne peut donc
  PAS joindre les serveurs Render ni R2 depuis l'environnement. Pour tester :
  toujours lancer les serveurs **en local** et tester le front contre eux via
  **Playwright headless Chromium** (`?server=ws://localhost:PORT` sur les pages de
  jeu ; le binaire est sous `/opt/pw-browsers/`, playwright global sous
  `/opt/node22/lib/node_modules/playwright`).
- **`git push` renvoie 403** (politique du proxy, pas une erreur réseau — ne pas
  retenter). La livraison se fait donc en **zip** : on commit en local pour
  l'historique, mais on remet les fichiers modifiés (front) + le serveur en zip,
  et Mathys les applique/déploie à la main.
- Les serveurs ont chacun un `test.js` (et parfois `test-custom.js`) : un client
  `ws` qui joue une partie complète et vérifie les règles. On les lance en local
  contre le serveur avant toute livraison.

## Conventions

- **Tout en français**, ton direct et pragmatique (la voix de Mathys, « zéro
  usine à gaz »). Commentaires de code en français aussi.
- Mathys est spécialiste **Data / Admin BDD**. Pas de sur-ingénierie.
- Front : pas de dépendance lourde, pas de framework, pas de logique de jeu.
- Les commits sont signés ; si le hook local râle après un commit, re-signer la
  pointe avec `git commit --amend --no-edit --reset-author` (faux positif local).

## État au dernier passage (2026-07)

- Demi-Cercle : ajout du mode « le Guide invente » (thème + extrémités, cible
  toujours tirée par le serveur) + légende couleur→joueur chez le Guide pendant
  le vote. Serveur : `onTheme`, `mode` par room, thèmes élargis à ~28 axes.
- Imitation : le bouton « réécouter ma prise » relance maintenant AUSSI la vidéo
  (muette) pour vérifier la synchro, avec le double waveform.
- **Le Jeu du Ban** (nouveau) : back `ban-server` livré à part (moteur pur
  `engine-ban.js` + `server.js` avec `setTimeout`/filet, `videos.js` = catalogue
  `{id, fatal, startAt?}`, catalogue surchargeable par `VIDEOS_JSON`). Front
  `games/ban/` branché sur `wss://ban-server-68h9.onrender.com` + bucket R2
  `pub-427c946793104d1f8e39fbf6d5584ba9.r2.dev`. Convention : fichier nommé
  `<id>.mp4` à la racine du bucket. `?server=` et `?cdn=` pour tester en local.
  Testé : moteur 26/26, ws e2e 16/16, front e2e 12/12.
- **Interface Team Fortress 2 / Source** (le jeu préféré de Mathys) : le site
  n'a plus un *accent* TF2, il EST une interface VGUI. Le thème violet/verre
  précédent a disparu. Trois principes tiennent tout :
  1. un panneau = aplat dégradé + biseau (lumière haut-gauche, ombre
     bas-droite) + bordure nette ; 2. des coins coupés en diagonale, jamais
     d'arrondi ; 3. une hiérarchie par la **qualité d'objet**, pas par la
     taille du texte.
  **Deux feuilles, et l'ordre compte** : `css/tf2.css` = le socle (polices,
  palette, primitives `.panel` / `.item` / `.tf-btn` / `.tf-tag` / `.attr-list`
  / `.q-badge`) ; `css/style.css` = les composants du portfolio, construits
  dessus. Le socle ne connaît rien du site, ne pas y mettre de composant.
  **Polices** : `TF2 Build` (titres, capitales) et `TF2 Secondary` (corps), en
  `@font-face` depuis `assets/fonts/`. Elles viennent du tf2-ui-kit de
  GingerBunny et restent la propriété de Valve — d'où le « Not affiliated with
  Valve Corporation » en pied de page. Elles couvrent tous les accents
  français (vérifié dans la cmap) mais pas `« » → ✦ ★`, qui tombent sur le
  fallback (Anton / Inter) glyphe par glyphe : c'est voulu, pas un bug.
  **Mapping** : nav = écran de sélection de classe (pictogramme + nom + liseré
  d'équipe) ; projets = fiches d'objet (vignette, bordure de rareté, stack en
  attributs d'arme, étiquette de nom en bas) ; contact = guichet Mann Co. (le
  formulaire compose un `mailto:`, aucun service tiers) ; footer = bandeau de
  bas d'écran. Le killfeed, les sections RED/BLU et les numéros de classe du
  carousel sont conservés du passage précédent.
  ⚠️ Deux pièges, tous deux documentés dans `tf2.css` :
  - **`clip-path` rogne aussi les ombres portées et les outlines.** D'où :
    biseau en `box-shadow` *inset*, lueur de rareté en `filter: drop-shadow()`,
    focus clavier en anneau inset. Une `box-shadow` extérieure sur un élément
    découpé ne s'affichera jamais.
  - **Teinte ≠ encre.** Les couleurs officielles de TF2 sont calibrées pour le
    gris moyen du jeu ; posées telles quelles sur le brun (ou le papier), la
    moitié passe sous 4.5:1. `--red` / `--q-*` servent aux barres, bordures et
    fonds ; `--red-ink` / `--qi-*` au texte, avec un jeu de valeurs par thème.
    Ne pas « simplifier » en réunifiant les deux. Même logique pour
    `--on-orange` (du blanc sur l'orange Mann Co. plafonne à 3,4:1).
  Thèmes : **Mann Co.** (brun carton, défaut) et **Blueprint** (papier calque
  + grille bleue) — le bouton soleil/lune bascule entre les deux.
- **Front / identité visuelle** : le halo de chaque section suit maintenant le
  curseur (« poursuite de scène », amorti à 55 %, `--hx`/`--hy` posés par
  `main.js`, désactivé au doigt et en `prefers-reduced-motion`) ; la nav allume
  la section en cours de lecture ; grain de pellicule fixe sur toute la page ;
  focus clavier visible partout (le carousel avait un `outline:none` alors
  qu'il est tabbable et se pilote aux flèches). Testé via CDP : 10/10.
- **Outils de contrôle du front** (nouveaux) : `styleguide.html` montre les
  primitives côte à côte dans les deux thèmes ; `tests/front.html` pilote le
  vrai `index.html` dans une iframe et vérifie ce qui casse en silence quand on
  touche au style (rendu des cartes, lightbox, Ctrl+K, FR/EN, thème, guichet,
  anneau de focus). Les deux sont en `Disallow` dans `robots.txt`. Voir
  `tests/README.md` pour les lancer. Dernier passage : front 20/20, et un
  auditeur de contraste jetable (377 nœuds) a validé **0 échec WCAG AA** dans
  les deux thèmes.
  ⚠️ En headless, Edge n'ouvre pas de fenêtre sous ~500 px : pour tester le
  mobile à 390 px il faut passer par une iframe, pas par `--window-size`. Et
  `--screenshot` capture toujours depuis le haut du document, donc pour cadrer
  une section on masque les autres plutôt que de scroller.
  Astuce : sous Windows, `msedge --dump-dom` ne rend rien depuis PowerShell
  (stdout d'un exe GUI) ; passer par l'outil Bash, où la sortie arrive bien.
- **Pousser le thème TF2, section par section** (liste de Mathys, dans l'ordre) :
  1 ConTracker (parcours en contrats dépliables) ✅ ; 2 sac à dos (projets en
  cases + fiche d'objet en modale, `js/itemmodal.js`) ✅ ; 3 CTA tous sur
  `.tf-btn` ✅ ; 4 compétences en « stats d'arme » ✅ : infobulle d'objet
  (primitive `.item-desc`) à droite du nom dans le hero, sous les CTA en
  dessous de 1180 px, texte dans `i18n.js` (`skills.*`) ; 5 textures de fond
  ✅ : taches + fibres générées en `feTurbulence` (token `--tex-stains`),
  posées sur `.section-halo::after`. ⚠️ Le filtre SVG doit avoir une région =
  la tuile (`filterUnits='userSpaceOnUse'`), sinon coutures tous les 720 px.
  En Blueprint la tache assombrit le papier : `--ink-3` / `--orange-ink` y ont
  été foncés pour tenir 4.5:1 sur la tache la plus sombre. Puis polish : 6
  réticule ✅ : ( • ) en SVG, token `--cursor-cross` (un par thème, un SVG en
  data: ne voit pas les variables CSS), UNIQUEMENT sur `.tf-btn`, `.bp-cell` et
  le carousel (main fermée pendant le glissement) — choix de Mathys, pas sur
  tout le site ; 7 easter egg ✅ : masque du Spy dans le bandeau du footer →
  un Spy BLU (SVG maison dans `index.html`) traverse en crabe, s'arrête au
  milieu et « déterre » le projet abandonné de Mathys (cache-cache sur
  téléphone, zone qui se referme, même idée que Gotcha), en `.item-desc`.
  Enchaînement sur `animationend` dans `js/easter.js`. ⚠️ En headless à temps
  virtuel les animations CSS restent figées à 0 ms : pour tester la vraie
  chaîne, avancer avec `el.getAnimations().forEach(a => a.finish())` et
  laisser ~1,5 s avant de lire l'état ; 8 barre « SIGNAL SÉCURISÉ ✓ » du
  guichet ✅ : à l'envoi, `#cf-capture` se remplit à la couleur d'équipe
  (`--capture-ms`, 1,1 s) PUIS le mailto: s'ouvre — délai court car un
  navigateur n'ouvre un mailto: que peu après le clic. ⚠️ Un vrai mailto:
  bloque Edge headless : `main.js` émet l'événement annulable `guichet:send`
  juste avant, que `tests/front.html` annule. Le masque du Spy a été redessiné
  (bandeau d'yeux, sans cigarette) ; Mathys a proposé un SVG de fan du logo de
  classe : refusé comme source, gardé comme référence de proportions. Le 9 (icônes de
  nav) était déjà fait. Règle : aucun asset Valve (images, sons, voix), tout
  est refait en CSS/SVG. Mis de côté sauf demande : switch RED/BLU, sons du
  jeu, vidéo « Meet the Team ». Les textes écrits à la place de Mathys
  (objectifs, stats) lui sont soumis avant publication.
- **Stabilisation / professionnalisation (2026-09-16)**, sans toucher à
  l'identité. Ce qui a changé et qu'il ne faut pas casser :
  - **Accessibilité** : menu mobile (`inert` fermé, aria-expanded, Échap,
    focus), lightbox (visibility quand fermée, piège à focus, focus rendu),
    palette (combobox/listbox), carousel (role region, points nommés, bouton
    pause, rotation coupée hors écran), killfeed `aria-hidden`, `aria-label`
    traduits via `data-i18n-aria`. Échap : la fenêtre du dessus fait
    `preventDefault`, celles du dessous ignorent une touche déjà traitée.
    La croix de la fiche écoute `click` (au mousedown elle ne marchait pas au
    clavier).
  - **Mouvement réduit** respecté aussi en JS : `prefersReducedMotion()` et
    `scrollBehavior()` (main.js), lus au moment de l'animation.
  - **Sans JS** : classe `js` posée dans le `<head>` ; `.js .reveal` seul est
    caché ; `.js-only` / `.nojs-only` ; carousel en grille ; compteurs avec
    leur vraie valeur dans le HTML (l'animation n'est qu'une couche).
  - **Pré-rendu** : `js/templates.js` = balisage partagé navigateur/build.
    Contenu entre `<!-- build:… -->` dans index.html = GÉNÉRÉ. Après toute
    modif de `data/`, `templates.js` ou d'une classe Tailwind : `node
    tools/build.mjs`. CI `.github/workflows/generated-files.yml` = `--check`.
  - **Tailwind 3.4.17 compilé**, placé APRÈS style.css (c'est là que le CDN
    injectait ses styles). Équivalence vérifiée : géométrie identique des 1031
    éléments à 1280/390 px, deux thèmes.
  - **SEO** : canonical, Open Graph, Twitter, JSON-LD Person (faits affichés
    seulement), `assets/og-image.png` généré depuis `tools/og-image.html`,
    robots.txt ne bloque plus `/data/`, sitemap généré depuis data/games.js,
    `games/ban/calibrate.html` en noindex.
  - **Perf** : images en WebP (vignettes 480 px dans `assets/projects/thumbs/`),
    polices WOFF2 préchargées, thème posé dans le `<head>` (plus de flash),
    un seul écouteur de scroll (rAF), terminal en pause hors écran.
  - **Contenu** : `data/projects.js` a des champs `goal` / `role` / `result`
    / `team` ; `data/games.js` a `code` / `arch` (bouton Architecture →
    même modale que les projets). `role` (ma part) est rempli pour les 8
    projets avec les mots de Mathys : ne rien y ajouter sans lui. ⚠️ Le dépôt
    des radars n'est PAS lié tant que Mathys n'a pas retiré l'IP interne et les
    identifiants de son README (même si le service est hors ligne) ; ils
    resteraient aussi dans l'historique git du dépôt.
  - **Tests** : `tests/front.html` (bureau + téléphone + sans JS) à lancer
    DEUX fois, dont une avec `--force-prefers-reduced-motion`.
- **Précision** (nouveau) : back `precision-server` livré à part
  (`engine-precision.js` pur + `server.js` avec les setTimeout de phase), front
  `games/precision/` sur `wss://precision-server.onrender.com`. Le MJ choisit
  difficulté / manches / épreuve. Testé : moteur 60/60, ws e2e 23/23, front
  e2e 59/59.

## Passe de finition (2026-09-17)

Rien de l'identité n'a bougé : TF2/Mann Co., sac à dos, ConTracker, killfeed,
réticule, easter eggs, carousel, FR/EN et les deux thèmes sont intacts.

- **Zéro police externe.** Anton et Inter ne servaient que de repli à TF2
  Build / TF2 Secondary ; mesuré glyphe par glyphe, ils ne changeaient le rendu
  que de 7 signes de ponctuation (`« » ‹ › · … ↓`), qu'Arial Narrow et
  system-ui dessinent aussi bien → supprimés. JetBrains Mono sert vraiment (le
  terminal du hero, les 5 jeux) et **Space Grotesk** aussi (3 jeux) : les deux
  sont maintenant dans `assets/fonts/`, en fichier **variable 400→700**
  (31 + 22 Ko, sous-ensemble latin, SIL OFL 1.1). Plus aucun `preconnect`, plus
  aucune feuille bloquante venue de Google, sur AUCUNE page (`index`, les 5
  jeux, `404`, `styleguide`, `upload`, `calibrate`).
- **Favicon** : `assets/favicon.svg`, la plaque Mann Co. + monogramme ML,
  dessinée en traits (une favicon SVG ne peut compter sur aucune police).
  Déclarée sur toutes les pages — c'est le lien visuel le plus direct entre le
  portfolio et les jeux dans la barre d'onglets.
- ⚠️⚠️ **GitHub Pages passe le dépôt par Jekyll, qui IGNORE tout fichier ou
  dossier dont le nom commence par `_`.** Il n'est jamais publié, et la page
  qui le référence prend un 404 — invisible en local, puisque le fichier
  existe sur le disque. Le socle commun s'est d'abord appelé `games/_shared/`
  et les cinq jeux sont partis en production **sans socle du tout** : code de
  room redevenu un gros bouton plein (le `button { background: … }` de chaque
  page reprenait la main), plus d'anneau de focus, plus de mouvement réduit,
  polices en repli. Tout était vert en local. D'où deux choses : le dossier
  s'appelle `games/shared/`, et `tools/build.mjs` refuse maintenant au build
  tout `href`/`src` local dont un segment commence par `_` (`checkPagesPaths`).
  Ne pas « ranger » un dossier en le préfixant d'un tiret bas.
- **Socle commun des jeux : `games/shared/game-ui.css`, UN fichier.** Pas un
  système de design — le strict minimum pour que les 5 jeux se comportent
  pareil là où ça se remarque, sans toucher à leur DA (chaque page garde son
  `<style>` et peut tout surcharger). Il contient : les deux `@font-face`, un
  anneau de **focus clavier** doré (celui du portfolio, seul emprunt visuel),
  `prefers-reduced-motion` (aucun jeu ne le respectait), cibles tactiles 44 px
  en `pointer: coarse`, convention `disabled`, `.g-copy` (le code de room
  devient un vrai `<button>`), `.g-error` / `.g-status`, et `.back`.
  ⚠️ Les règles de focus s'écrivent `:where(…):focus-visible` = spécificité
  (0,1,0), ce qui bat le `input { outline: none }` (0,0,1) de chaque page
  **quel que soit l'ordre des feuilles**. Ne pas « simplifier » en enlevant le
  `:where()`. ⚠️ Les jetons sont préfixés `--g-` : `precision` définit déjà
  `--bg`, `--ink`, `--accent`…
  ⚠️ **`.g-copy` est écrit en DEUX règles, et c'est délibéré.** Le code de room
  est un `<button>` : le `button { background: …; padding: …; border-radius: }`
  générique de chaque jeu lui remettrait l'apparence d'un bouton d'action. Le
  « chrome » est donc déshabillé avec la classe **doublée** — `.g-copy.g-copy`,
  spécificité (0,2,0) — ce qui bat ce `button {}` (0,0,1) et un futur
  `.card button` (0,1,1) sans un seul `!important` ; tandis que la mise en page
  (display, font, color, text-align) reste à `.g-copy` seul (0,1,0), pour que
  le `#room-code { … }` (1,0,0) de chaque jeu garde la main sur la taille, la
  graisse, la couleur et l'interlettrage. Ne pas fusionner les deux règles.
  `tests/games.html` compare le code de room au bouton d'action principal des
  cinq jeux : c'est ce test qui rattrape la fusion.
- **Morpion** : accepte enfin `?server=` comme les quatre autres, même phrase
  d'erreur réseau, ses 9 cases ont un `aria-label` (« ligne 2, colonne 3 —
  vide ») — elles s'annonçaient « bouton » neuf fois de suite — et son code de
  room se copie au clic comme partout ailleurs. Nuance : il vit dans une rangée
  de méta, donc son `#room-code` repasse `.g-copy` en `display: inline`.
- **Presse-papiers** : les 4 jeux avalaient l'échec de copie du code en silence
  (`catch` vide) ; ils le disent maintenant, comme le guichet du portfolio.
- **Sans JS sur téléphone** : un `<details>` dans `index.html` (classe
  `.nojs-nav`) donne accès aux 6 sections. Zéro script. ⚠️ Il est posé **hors
  du `<header>`** : `#navbar nav` est découpé au `clip-path`, qui aurait rogné
  le panneau dépliant.
- **Contraste, mesuré et corrigé** (auditeur jetable qui compose les couches
  alpha, lit les fonds peints en `::before` et applique l'`opacity` des
  ancêtres) : gris `#6f6c80` → `#8b87a0` dans 4 jeux (3,59 → 5,30:1), blanc sur
  violet `#8b5cf6` → `#7c3aed` (4,23 → 5,70:1), blanc sur rouge `#ef4444` →
  `#dc2626` (3,76 → 4,84:1), `#4a4a52` → `#8a8a94` dans precision (2,24 →
  5,74:1), `--qi-collectors` `#e87070` → `#ee8080` (4,14 → 4,76:1), billet
  Bigflo `opacity-80` → `-90` (4,11 → 5,18:1 en Blueprint). Le `#stop-btn`
  rouge vif du Ban est conservé : gros et gras, c'est du « grand texte » WCAG
  (3:1 exigé, 3,76 mesuré).
  ⚠️ **Deux pièges pour qui refera cet audit** : un auditeur qui lit seulement
  `background-color` se trompe partout sur le portfolio (le dégradé d'un
  panneau est dans `::before`, à cause du `clip-path`) ; et dans une iframe
  hors écran l'IntersectionObserver ne se déclenche pas, donc tout `.reveal`
  est à `opacity: 0` et sort à 1,00:1. Il faut couper les transitions, forcer
  `.is-visible`, puis mesurer.
- **Compromis gardés volontairement** : les cartes latérales du carousel
  descendent à `opacity: .08` (c'est le coverflow) et sortent donc sous 4.5:1
  dans l'audit — ce n'est pas un défaut, et le `focusin` du carousel ramène au
  centre toute carte qu'on atteint au clavier. Les boutons `disabled` du Ban
  aussi : WCAG exempte les composants inactifs.
- **Sitemap** : `--check` vérifie désormais la **liste des `<loc>`** (un jeu
  ajouté à `data/games.js` sans rebuild fait échouer la CI) mais toujours pas
  les `<lastmod>`, qui dépendent du commit lui-même. Chaque page de jeu dépend
  aussi de `games/shared` pour sa date.
- **`/data/` reste autorisé** dans robots.txt. Mesuré : sans `data/*.js`, le
  texte pré-rendu survit mais `PROJECTS is not defined` casse le script (plus
  de palette Ctrl+K). Le raisonnement complet est dans `robots.txt`.
- **AVIF : non.** Mesuré : 225 Ko de vignettes WebP au total, ~20-30 % de gain
  théorique, contre un encodeur à installer, du `<picture>` partout et 45
  fichiers de plus. Le rapport ne vaut pas le coup.
- **Tests** : trois suites, `tests/README.md` explique quoi lancer. Nouveau :
  `tests/games.html` (socle commun des 5 jeux) et `tests/keyboard.mjs`, qui
  pilote Edge par le protocole DevTools pour envoyer de **vraies frappes Tab**
  — le seul moyen de prouver qu'un anneau de focus apparaît, `:focus-visible`
  ne s'allumant pas sur un `el.focus()` programmé.

## Deux nouveaux jeux + hub (2026-09-18)

Rien de l'identité n'a bougé. Ce qui est arrivé :

- **Le Passeur** (`games/passeur/`) et **Qui Ment ?** (`games/quiment/`), deux
  vrais jeux multijoueurs, chacun avec **son dépôt serveur à part** :
  `C:\perso\passeur-server` et `C:\perso\qui-ment-server` sur le poste de
  Mathys. Les deux sont **commités en local mais PAS encore poussés sur
  GitHub ni déployés sur Render** (pas de `gh` sur la machine, le dépôt distant
  reste à créer à la main). Voir « Ce qu'il reste à faire » plus bas.
- Contrairement aux cinq premiers jeux, ces deux-là **portent la DA du
  portfolio** : `css/tf2.css` + `games/shared/game-ui.css`, panneaux Mann Co.,
  polices TF2. Leur `<style>` de page ne contient que ce qui leur est propre.
  ⚠️ Les deux redéfinissent `.tf-btn:disabled` en `opacity: .45; cursor:
  default`. C'est **volontaire** : le `cursor: progress` de tf2.css veut dire
  « envoi en cours » (c'est le guichet), alors que sur une page de jeu
  désactivé veut dire « pas encore possible ». Même spécificité, l'ordre des
  feuilles suffit — ne pas « corriger » en touchant tf2.css.
- **Le secret, côté serveur, dans les deux cas.** Le Passeur : `scores` et
  `why` n'arrivent qu'au message `results`. Qui Ment ? : le mot ne part jamais
  en diffusion (joueur par joueur, `word: null` pour l'intrus), les indices
  sont ramassés en silence puis révélés d'un bloc, et la liste des mots de la
  catégorie ne part qu'à l'intrus démasqué. Le test WebSocket de
  `qui-ment-server` relit **tout ce qui est passé sur le fil** et cherche le
  mot dans l'historique de l'intrus : c'est le seul niveau qui attrape une
  fuite par un message de progression.
- **Hub de jeux** (`js/gamehub.js`), posé SUR l'existant sans le modifier :
  « Je joue à quoi ? » (caisse Mann Co. qui tire un jeu au sort) et « Trouver
  une partie » (**faux** matchmaking, annoncé en toutes lettres dans l'écran).
  Les deux passent par `playable()` — `status === 'live'` ET (`href` ou
  `action`) — donc ni l'un ni l'autre ne peut proposer un jeu non lançable.
  Pour brancher un vrai matchmaking un jour : **`buildMatch()` est le seul
  point à remplacer**, l'interface ne bouge pas.
- **`tests/front.html` ne compte plus les jeux en dur.** Les nombres viennent
  de `data/games.js`, lu par `w.eval('GAMES')`. ⚠️ `w.GAMES` vaut toujours
  `undefined` : `GAMES` est un `const` au premier niveau d'un script classique,
  donc global mais pas une propriété de `window` (même piège que dans
  `gamehub.js`).
- ⚠️ **Tester un jeu en réseau : PAS de `--virtual-time-budget`.** Il avance
  les minuteries *et* `Date.now()` instantanément, donc toute attente expire
  avant qu'un WebSocket ait eu le temps de répondre — les tests échouent par
  intermittence pour une raison qui n'a rien à voir. Il faut piloter Edge par
  le protocole DevTools, en temps réel, comme `tests/keyboard.mjs`.
- Backstage : le poste de volley passe de **central à passeur** (FR + EN), pour
  coller au jeu.

### Ce qu'il reste à faire (dans l'ordre)

1. Créer les dépôts GitHub `passeur-server` et `qui-ment-server`, y pousser les
   commits locaux.
2. Déployer les deux sur Render (`render.yaml` est déjà là ; plan gratuit, donc
   ~30 s de réveil au premier joueur — le client le dit dans son erreur).
3. Vérifier que les URL de production répondent :
   `wss://passeur-server.onrender.com`, `wss://qui-ment-server.onrender.com`.
4. Alors seulement, **pour chaque jeu** : ajouter `href` dans `data/games.js`,
   passer `status` à `'live'`, retirer le `<meta name="robots" content="noindex">`
   de sa page, puis `node tools/build.mjs`. C'est ce qui les fait apparaître
   dans le carousel avec un bouton « Jouer », dans le tirage de la caisse et
   dans le sitemap.

Dernier passage vert : front 195/194, jeux 146/146 (deux modes),
`passeur-server` 28 + 24, `qui-ment-server` 52 + 57, et une partie complète de
Qui Ment ? jouée par trois clients dans un navigateur, 42/42.
