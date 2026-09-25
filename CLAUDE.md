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
| **Morpion** | `games/morpion/` | `morpion-server` (Render) | Duel strict (X/O). Le serveur ne reçoit AUCUNE identité (ni pseudo, ni avatar) et ferme la room dès qu'un joueur part. `net.js` est toute l'appli ; `?server=` accepté comme ailleurs. |
| **Le Passeur** | `games/passeur/` | `passeur-server` (Render) | Une situation de volley, cinq passes, cinq secondes. Points = pertinence × vitesse. Barèmes et `why` envoyés seulement au `results` ; temps recoupé à l'horloge serveur. Catalogue = `situations.js` côté serveur. |
| **Qui Ment ?** | `games/quiment/` | `qui-ment-server` (Render) | Jeu de bluff. Tout le monde a le même mot sauf l'intrus, qui n'a que la catégorie. 2 tours d'indices en aveugle, vote, révélation, dernière chance. Le mot ne part JAMAIS en diffusion. Catalogue = `mots.js` côté serveur. |

Le **carousel des jeux** (`js/carousel.js`) est un coverflow 3D ; le drag ne
démarre qu'après un seuil de 6 px pour que le lien « Jouer » reste cliquable.

Les **sept jeux en ligne** se lancent aussi depuis le **Game Hub** (`/games/`,
handoff), et parlent tous à leur serveur par le même transport,
`games/shared/game-net.js`, avec la **présence** des joueurs. Voir
« Handoff et présence : l'état des sept jeux » en fin de fichier. Puissance 4
(local) n'est pas concerné.

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
  Mathys. Les deux sont déployés sur Render depuis le 2026-09-18 (voir « Mise
  en ligne » plus bas). ⚠️ Pas de `gh` sur la machine : toute opération GitHub
  sur ces deux dépôts (créer, pousser) est faite à la main par Mathys.
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

### Mise en ligne (faite le 2026-09-18)

Mathys a déployé les deux serveurs sur Render, puis les deux jeux sont passés
en ligne : `href` + `status: 'live'` dans `data/games.js`, `noindex` retiré des
deux pages, rebuild. Ils apparaissent donc dans le carousel avec un bouton
« Jouer », dans le tirage de la caisse Mann Co. et dans le sitemap (8 `<loc>`).

Vérifié **contre la production**, pas seulement en local : un fumigène qui joue
vraiment une manche sur chaque serveur Render (le health check HTTP ne prouve
que le process, pas le WebSocket). Il confirme aussi les deux règles qui
comptent — la manche du Passeur ne contient pas le barème, et le mot de Qui
Ment ? n'apparaît nulle part chez l'intrus.

⚠️ Reste la contrainte du plan gratuit Render : l'instance s'endort, donc le
premier joueur attend ~30 s le temps du réveil. Les deux clients le disent dans
leur message d'erreur (« réveil Render ~30 s ? réessaie ») — ne pas prendre ce
premier échec pour une panne.

Dernier passage vert : front 195/194, jeux 146/146 (deux modes), clavier 8/8,
`passeur-server` 28 + 24, `qui-ment-server` 52 + 57, une partie complète de Qui
Ment ? jouée par trois clients dans un navigateur 42/42, et 10/10 en production.

## Le Passeur : le terrain SVG (2026-09-18, après playtest)

Le jeu était juste techniquement mais trop abstrait : on choisissait parmi cinq
boutons de texte. Le choix se fait maintenant **sur un terrain**.

- **`games/passeur/court.js`** dessine le terrain à partir de la `scene` que le
  serveur envoie avec la manche. Il ne connaît **aucune situation** : il sait
  dessiner une réception, un bloc, quatre attaquants et un passeur. Ajouter une
  situation côté serveur ne demande donc rien ici.
- **`scene` vit dans `situations.js`, côté serveur** (réception, origine, état
  du passeur, bloc, état de chaque attaquant). Ce n'est pas un secret : c'est ce
  que `ctx`/`detail` disaient déjà en prose. Les deux suites de tests vérifient
  qu'aucune note ne s'y glisse — c'est exactement le champ où un barème finit
  par arriver « juste pour l'affichage ».
  ⚠️ Ajouter un état demande de toucher **aux deux dépôts** (la valeur côté
  serveur, son dessin dans `court.js`). C'est voulu : un état que le client ne
  sait pas dessiner ne doit pas pouvoir exister. `test-engine.mjs` refuse toute
  valeur inconnue, parce qu'une faute de frappe sortirait un terrain muet chez
  le joueur **sans aucune erreur JS**.
- **Repli** : si la manche arrive sans `scene` (serveur pas encore redéployé),
  `court.js` dessine un terrain neutre et le jeu reste entièrement jouable.
  Vérifié contre la production : 34/34 avec l'ancien serveur en ligne.
- **Les cinq zones** sont de vrais éléments interactifs du SVG (`role="button"`,
  `tabindex`, `aria-pressed`, `aria-label` qui annonce le raccourci). Les
  touches 1 à 5 marchent toujours, mais **elles suivent maintenant l'ordre
  spatial** — gauche, courte, deuxième main, droite, arrière — et le chiffre est
  écrit dans chaque zone. L'ordre de `PASSES` dans `situations.js` a été aligné
  dessus (rien n'en dépendait : tout se fait par `id`).
  ⚠️ L'anneau de focus est **dessiné dans le SVG** (`.z-focus`), pas un
  `outline` : un `outline` sur un `<g>` n'est pas rendu pareil partout, et c'est
  la seule indication pour qui joue au clavier. Ne pas « simplifier ».
  ⚠️ Aucun état ne repose sur la seule couleur : bloc en retard = pointillés,
  attaquant au sol = croix, zone choisie = trait épais + coche + `aria-pressed`.
- **`.court-wrap` porte le même rapport que le viewBox (100 × 78)**, ce qui
  permet de raisonner en unités du viewBox partout. Changer l'un sans l'autre
  décale tout.
- **Écran de résultats** : le même terrain, figé, avec ma zone (cadre pointillé
  + coche) et la zone recommandée (cadre plein) — deux formes, pas deux
  couleurs — plus le détail du score. Le serveur envoie maintenant `speed` et
  `ms` en plus de `relevance`, pour pouvoir écrire « pertinence 100/100 ·
  vitesse 92 % » au lieu d'un nombre sorti de nulle part.
- **Champ pseudo** (Le Passeur et Qui Ment ?) : il faisait 50 px pour un bouton
  à 40, et débordait de 33 px du panneau. Deux causes, aucune arbitraire — ces
  deux pages ne posaient pas `box-sizing: border-box` (le portfolio le reçoit de
  Tailwind, pas les pages de jeux), et `font: inherit` ramène aussi le
  `line-height: 1.5` du corps alors que `.tf-btn` est en `normal`. Les cinq
  autres jeux posaient déjà `border-box` : ils n'ont pas été touchés.
  `tests/games.html` compare désormais la hauteur du champ à celle du bouton
  d'action, pour les sept jeux.
- **Tests** : `tests/games.html` pilote `Court.render()` **directement** avec une
  scène fabriquée — vrai rendu, vrai clic, vraie touche, sans serveur. 179
  vérifications (146 avant). Un harnais jetable a joué en plus une partie
  complète contre un serveur local ET contre la production, 34/34 dans les deux
  modes de mouvement.
  ⚠️ Rappel qui a resservi : pour tout test réseau, **pas de
  `--virtual-time-budget`**, il fait expirer les attentes avant la réponse du
  WebSocket. Passer par le protocole DevTools, en temps réel.

## Le Passeur : le terrain passe en fausse 3D (2026-09-18, soir)

Le terrain existait mais ressemblait à des cartes posées sur un fond. Il
ressemble maintenant à un terrain de volley vu en légère perspective. **Rien
d'autre n'a bougé** : le contrat `scene`, l'API de `court.js`, `app.js`, le
moteur, le barème et le serveur sont identiques.

**Three.js a été écarté**, et c'est le bon choix : ~600 Ko pour une scène qui
ne bouge pas, sur un client de 500 lignes sans dépendance. Tout l'effet tient
dans une projection de six lignes.

Trois idées, et il n'y en a pas d'autres :

1. **Une projection à un point de fuite.** Le terrain est décrit en coordonnées
   de monde (`wx` de −1 à +1) ; la profondeur, c'est l'ordonnée écran. `hw(y)`
   rétrécit linéairement avec la profondeur, donc le terrain est un trapèze.
2. **L'échelle se propage.** `sc(y) = hw(y)/NEAR_HW` sert à TOUT : les
   silhouettes sont posées en `translate(...) scale(sc(y))`, et le ballon, les
   numéros de zone et les libellés en héritent. C'est ça qui fait la
   profondeur, pas les ombres.
3. **L'ordre de tracé EST l'ordre de profondeur** : sol → bloc → filet → zones
   → nos joueurs → ballon → trajectoires. ⚠️ Ne pas réordonner `paint()` sans y
   penser : un contreur repasserait devant la bande du filet.

Détails qui ont leur raison d'être :

- Le filet est à **profondeur constante**, donc c'est un vrai rectangle à
  l'écran : maillage en `<pattern>`, bande blanche, poteaux avec une face
  sombre pour le volume. Aucune déformation à gérer.
- Les silhouettes sont **huit poses** (`idle`, `run`, `set`, `block`, `attack`,
  `receive`, `tired`, `down`) définies une fois dans un repère local, pieds en
  (0,0). L'état d'un attaquant choisit sa pose — un joueur au sol est *couché*,
  pas barré d'une croix.
- **Trajectoires** : au survol et au focus d'une zone, une courbe passeur →
  attaquant. C'est elle qui transforme « quatre cases » en « quatre passes
  possibles ». Aux résultats, les deux trajectoires (ton choix + le meilleur)
  sont tracées ensemble.
- ⚠️ **La perspective écrase les cibles tactiles.** C'est LE risque de la
  fausse 3D, et il est mesuré : `tests/games.html` vérifie les **cinq** zones à
  390 px, pas une seule. « 2e main » a été élargie aux dépens de ses voisines,
  et la zone arrière rallongée (elle était tombée à 40 px). Ne pas rééquilibrer
  les largeurs à l'œil — le test est là pour ça.
- Les bruns du sol (`#7a4a24` / `#573720`) ne sont **pas** des tokens TF2 :
  c'est un sol de gymnase. Le thème Mann Co. reste sur le panneau, les boutons
  et la typo autour. C'est voulu — le terrain doit être un terrain.
- Accessibilité inchangée : zones en `role="button"` + `tabindex` +
  `aria-pressed` + `aria-label` qui annonce la touche, anneau de focus dessiné
  dans le SVG, description textuelle générée des mêmes données, touches 1 à 5.

**Tests** : jeux 181/181 (deux modes), e2e navigateur 34/34 (deux modes),
clavier 8/8, `passeur-server` 34 + 29. Le rendu a été jugé à l'image à chaque
étape : trois collisions de libellés que les tests DOM ne pouvaient pas voir
(numéro 5 masqué, « TOI » derrière le ballon, réceptionneur sur le libellé de
la zone arrière) n'ont été trouvées que comme ça.

## Le Passeur devient une vraie situation de volley (2026-09-18, nuit)

Deux changements de fond, et ils sont liés : **le volley est désormais correct**,
et **on regarde avant de jouer**.

### Les règles, et où elles vivent

Référence : **FIVB Official Volleyball Rules 2025-2028**. Elles sont dans
**`rules.js` (passeur-server)**, module pur, testé par `test-rules.mjs`.
⚠️ Le client n'en connaît AUCUNE — il reçoit une scène déjà résolue. Ne jamais
remettre une règle de volley dans `court.js`.

| Règle | Ce que le jeu en fait |
|---|---|
| **7.4** positions | P4 P3 P2 = ligne avant, P5 P6 P1 = ligne arrière. Une rotation légale est obtenue en TOURNANT la rotation de base, jamais saisie à la main |
| **7.5** faute de position | seule la formation au service doit être légale |
| **7.6** après le service | tout le monde se déplace. Le réceptionneur-attaquant attaque en poste 4 même s'il a tourné en P3, et **le passeur arrière monte au filet** |
| **13.2.2** attaque arrière | un arrière peut attaquer, mais au-dessus du filet il doit prendre son appel **derrière la ligne des 3 m** |
| **14.1.1 / 14.6.2** bloc | seuls les avants peuvent contrer → jamais plus de 3 contreurs |

⚠️ **Ne JAMAIS écrire « il est arrière donc il ne peut pas aller devant ».**
C'est faux (7.6), et un test est là pour l'empêcher de revenir. La ligne des
3 m est une ligne de référence, pas un mur.

**La conséquence de jeu la plus importante** : quand le passeur est arrière, il
n'a **pas de deuxième main** (13.2.2). L'option reste visible sur le terrain,
marquée `×` / « interdit », avec la raison dans son `aria-label` — et le serveur
la refuse. 6 des 12 situations ont un passeur avant, 6 un passeur arrière.

### Le modèle de situation

Une situation ne décrit plus un dessin, elle décrit du volley : `rotation` (0-5),
`serve`, `reception`, `block { count, start, target, late }`, `attackers`,
`introMs`. **Tout le reste est déduit** : qui joue quelle distribution, qui est
avant, ce qui est légal. On ne peut donc plus écrire une situation illégale sans
que `npm test` le dise.

⚠️ Deux pièges déjà rencontrés, tous deux couverts par des tests :
- le réceptionneur par défaut est le **réceptionneur-attaquant arrière**, pas
  « le joueur de P6 » — qui selon la rotation peut être le passeur ;
- une option **interdite** ne doit pas être notée 50 ou plus dans `scores`,
  sinon le barème vante une action que l'arbitre sifflerait.

### Les deux temps d'une manche

C'est le **serveur** qui tient les deux, pas le client :

1. `round` → la mise en situation (`introMs`, 2,2 à 3,0 s selon la situation).
   Service, réception, le passeur qui monte, le bloc qui se replace. Aucun
   chrono ne tourne, les zones sont en retrait et **ne se jouent pas**.
2. `go` → « À TOI ». Les zones s'activent, les 5 secondes partent.

⚠️ Le chrono ne démarre PAS à la fin de l'animation locale : celui dont l'onglet
a ramé jouerait plus longtemps. Mesuré à 3 joueurs dans un navigateur : **0 ms
d'écart** sur l'ouverture de la fenêtre.

Le serveur refuse une réponse envoyée pendant la phase `intro`.

### L'animation

Du **SMIL** (`animateMotion`, `animateTransform`, `set`), pas de boucle JS. Le
gros avantage : le rendu de l'état FINAL est le même code que celui de
l'animation (`animate: false`), donc **le mouvement réduit n'a pas de branche à
part** — on dessine l'arrivée, tout est lisible.
⚠️ Un joueur qui bouge est enveloppé dans un `<g class="mv">` qui ne fait qu'une
translation ; le groupe intérieur garde l'échelle de profondeur. Ne pas fusionner
les deux, il faudrait tout recalculer.
⚠️ Pour capturer une animation SMIL à un instant précis :
`svg.pauseAnimations()` puis `svg.setCurrentTime(t)`. Sous
`--virtual-time-budget`, le SMIL a déjà FINI — une capture montre l'état final,
pas le début.

### Ce que l'image a attrapé et que les tests ne pouvaient pas voir

Les classes d'équipe (`sil-us` / `sil-them` / `sil-set`) avaient disparu en
réécrivant `paint()` : toutes les silhouettes tombaient en **noir**, et aucun
test ne s'en plaignait. Idem pour trois collisions d'étiquettes (« zone avant »
sur un joueur, « TOI » à l'autre bout du terrain au départ, le « 5 » derrière
le réceptionneur). Se fier aux captures reste indispensable.

**Tests** : `rules.js` 43, moteur 35, WebSocket 37, jeux 194/194 (deux modes),
e2e navigateur **à trois joueurs** 46/46 (deux modes), clavier 8/8.

## Le Passeur : la boucle de jeu (2026-09-18, tard)

Le terrain était réussi mais la manche ne se lisait pas. Diagnostic mesuré
avant de toucher au code, et **une cause dominait les autres**.

### ⚠️⚠️ LE PIÈGE SMIL — c'est lui qui cassait tout

En SMIL, **`begin` se compte sur la timeline du DOCUMENT**, pas depuis
l'insertion de l'élément. Quand une manche démarre, la page vit déjà depuis un
moment (accueil, salon, manches précédentes) : tous les `begin` sont donc
**déjà passés**, et chaque animation est figée sur son état final à la
milliseconde où on l'insère.

Mesuré : manche 1 (document neuf) → le décalage évolue 0 → 7,3 → 17,7 → 20,7.
Manche 2 (document vieux de 4 s) → **déjà 20,7 à +60 ms**, et plus rien.
Autrement dit : le service, la réception, le passeur qui monte et le bloc qui
se replace **ne jouaient jamais**. C'est ce qui expliquait à la fois « je ne
vois pas les bloqueurs bouger » et « je ne comprends pas la séquence ».

Correctif : `svg.setCurrentTime(0)` après chaque rendu animé. C'est la seule
animation de ce SVG, il n'y a rien d'autre à préserver.
**`tests/games.html` vérifie maintenant que la timeline repart de zéro** —
sans ce test la régression est invisible, tout étant présent dans le DOM.

### Les trois autres causes, mesurées aussi

- **Le bloc ne bougeait pas** : 9 situations sur 12 ont `start === target`,
  donc `mover()` ne créait aucune animation. Les contreurs partent maintenant
  TOUJOURS en retrait du filet (`BLOCK_WAIT_Y`) pour venir s'y coller
  (`BLOCK_READY_Y`) : le pas vers le filet se voit toujours, l'écart latéral
  porte l'information. Ils partent en léger décalage l'un de l'autre, et un
  bloc « en retard » part plus tard ET met plus longtemps — il est encore en
  train de fermer quand il faut décider.
- **Le chrono était invisible** : 19,2 px de haut, 45 px au-dessus du terrain,
  soit **0,43 %** de la surface qu'on regarde. Il est maintenant **sur le
  terrain**, en haut à droite, à ~31 px (`clamp(1.9rem, 7.5vw, 3rem)`), et il
  chauffe (`warn` / `hot`). Mêmes identifiants qu'avant (`#timer-num`,
  `#timer-fill`), seuls le placement et la taille changent.
- **Les cinq choix étaient abstraits** : seuls le numéro et un sous-titre de
  jargon en 3,1 px étaient dessinés — `ZONES[].label` n'était **jamais
  affiché**. Chaque zone porte maintenant son NOM en grand (`lines`, 1 ou
  2 lignes) et le raccourci clavier devient une pastille discrète.
  ⚠️ La taille du nom (`fs = 10 * s`) est calibrée pour le **téléphone** : à
  390 px le terrain ne fait que ~316 px, soit 1,58 px par unité de viewBox, et
  un nom à 4,6 unités sortait à **6 px**. La largeur des zones laissait
  pourtant trois fois la place. Ne pas la réduire sans remesurer à 390 px.

### La règle de la deuxième main, reprise proprement

« Passeur arrière = 2e main interdite » était un raccourci. `rules.js` décrit
maintenant l'**action** de chaque option (`ACTION`) — hauteur du ballon au
contact, et d'où part l'attaquant — et `attackFault()` applique 13.2.2 dessus :
un arrière ne peut pas conclure **au-dessus du filet depuis la zone avant**. Il
peut donc conclure avec un appel derrière la ligne, et il peut jouer le ballon
**sous** le niveau du filet en zone avant. Ce que le jeu représente pour la 2e
main, c'est le ballon poussé par-dessus le filet : d'où le refus. Si on ajoute
un jour une poussette basse, il suffit de la déclarer `ball: 'below-net'`.
Quatre tests couvrent les quatre combinaisons.

### Tests de COMPORTEMENT, pas de présence

Le e2e échantillonne les positions réelles à l'écran pendant la mise en
situation : ballon **140 px** parcourus, passeur **69 px**, bloc **20 px** ; et
en mouvement réduit **0 / 0 / 0** avec l'état final déjà en place. Le compte à
rebours est observé 5 → 4 → 3. Le chrono est mesuré en taille et vérifié comme
étant DANS les bornes du terrain.

**Dernier passage** : `rules.js` 50, moteur 35, WebSocket 37, jeux 200/198
(deux modes), e2e navigateur à trois joueurs 56/54 (deux modes), clavier 8/8,
front 195, fichiers générés OK.

## Le Passeur : jouabilité réelle (2026-09-18, très tard)

Quatre causes trouvées **dans le code** (pas des hypothèses), dont une extérieure.

### 1. ⚠️⚠️ LE SERVEUR DÉPLOYÉ ÉTAIT DEUX VERSIONS EN RETARD

Mesuré contre `wss://passeur-server.onrender.com` : le message `round` ne
contenait ni `scene`, ni `introMs`, et **`go` n'arrivait jamais**. Conséquences
en cascade, qui expliquaient à elles seules presque tous les symptômes :

- pas de `go` → `court.arm()` jamais appelé → **aucune zone cliquable** ;
- pas de `go` → `startTimer()` jamais appelé → **chrono figé sur 5,0** ;
- pas de `scene` → terrain de repli → **5 joueurs** et **bloc immobile**.

**Le correctif n'est pas « redéployer »** : un client ne doit pas devenir
injouable parce que le serveur a une version de retard. `app.js` a maintenant un
filet — si `introMs` est absent, la fenêtre de décision s'ouvre tout de suite
(l'ancien serveur l'avait déjà ouverte) ; si `introMs` est là mais que `go`
tarde, on arme quand même après `introMs + 700 ms`. Le serveur reste l'arbitre :
il mesure le temps à son horloge et refuse ce qui arrive trop tôt.
**Vérifié : `tests/passeur-play.mjs` passe 49/49 contre la production périmée.**

### 2. Les couches décoratives interceptaient le clic

Les joueurs, le ballon et les trajectoires sont dessinés **après** les zones
(c'est voulu : un joueur se tient SUR sa zone). Sans `pointer-events: none`,
ce sont eux qui recevaient le clic. Mesuré avec `elementFromPoint` au centre de
chaque zone : l'**ombre au sol du réceptionneur** bloquait tout le centre de la
zone arrière. Cliquer sur un attaquant — le geste le plus naturel du jeu — ne
faisait rien.
⚠️ Ne pas retirer le bloc `pointer-events: none` des couches `.c-*`.

### 3. Les cinq choix n'étaient pas nommés → corrigé au passage précédent

### 4. Le bloc avançait tout droit, et souvent pas du tout

Deux causes cumulées : 9 situations sur 12 ont `start === target` (donc aucun
déplacement), et le mouvement était une interpolation directe. Les contreurs
suivent maintenant un **chemin en L** (`moverL`, `animateMotion`) : pas vers le
filet, puis glissement latéral. Et quand la scène ne demande pas de départ
particulier, ils partent de leur position d'**avant-lecture** (`blockXs('base')`),
ce qui garantit un trajet dans tous les cas.

### Six joueurs par équipe (FIVB 7.3)

Il en manquait un chez nous : cinq rôles portent une option, le sixième — le
central de la ligne arrière — n'en porte aucune. Il se **déduit** de `lineup`
moins les porteurs d'options : aucun changement de protocole. Les six adverses
(trois au filet, trois en défense) sont du **décor** dessiné côté client, parce
que le serveur n'a rien à en dire — ce qui compte, le nombre de contreurs et
leur cible, vient bien de lui. Tout ce qui n'est pas un choix est en `.c-extra`
(opacité .42).
⚠️ Notre 6e joueur est placé près de sa ligne de touche, PAS sur sa position de
rotation : posé là, il tombait pile sur le libellé de la zone arrière.

### Le test qui manquait

`tests/passeur-play.mjs` (nouveau) joue quatre manches avec de **vraies
entrées** par le protocole DevTools, aux coordonnées réelles, et lit la passe
que **le serveur** a enregistrée. `games.html` ne pouvait pas attraper ces bugs :
il appelle `dispatchEvent` sur le `<g>` d'une zone, ce qui contourne le test de
survol.

Deux pièges de plomberie, documentés dans `tests/README.md` :
- `text: 'Enter'` fait passer l'événement pour une saisie de texte et le
  handler ne voit rien → `rawKeyDown` sans `text` (même piège que Tab) ;
- `edge.kill()` ne tue que le parent : après quelques exécutions, **49 processus
  msedge fantômes** saturaient la machine et le test échouait au second
  passage. Il faut `taskkill /T` et un port de debug tiré au hasard.

**Dernier passage** : partie réelle 49/49 (local et **production périmée**, deux
modes de mouvement), jeux 206/201, front 195/194, clavier 8/8, `rules.js` 50,
moteur 35, WebSocket 37, fichiers générés OK.

## Harmonisation visuelle des 7 jeux (2026-09-19)

Les cinq premiers jeux avaient leur propre DA (fond indigo, police mono,
boutons violets arrondis) ; Le Passeur et Qui Ment ? portaient celle du
portfolio. Les sept partagent maintenant le même **chrome**, chacun gardant son
**gameplay** et son **accent**.

### Le principe : chrome commun, gameplay propre

`games/shared/game-ui.css` ne portait que du COMPORTEMENT (focus, tactile,
mouvement réduit, messages). Il porte maintenant aussi l'HABILLAGE commun :
fond, titres, panneaux, boutons, champs, salon, code de salle, retour.

**On n'a pas créé un second système de design** : le vocabulaire vient de
`css/tf2.css`, que les 7 pages de jeux chargent désormais (32 Ko, polices déjà
auto-hébergées, aucune ressource externe). tf2.css ne touche globalement que
`html` et `body` — son emprise est contenue.

Et **il n'y avait presque rien à réécrire dans le balisage** : les 7 pages
partageaient déjà les mêmes identifiants (`#name-input`, `#code-input`, `#host`,
`#join`, `#start`, `#room-code`, `#code-hint`, `#error`, `#players`,
`#avatar-row`) et les mêmes classes (`.join-row`, `.or`, `.sub`, `.avatar-pick`,
`.back`). Le socle habille ces sélecteurs une fois. Seul le panneau a demandé
une classe : `class="panel g-screen"`.

⚠️ **LA RÈGLE QUI REND ÇA SÛR** : le socle est chargé AVANT le `<style>` de
chaque jeu et ne cible que des éléments (0,0,1) ou des classes (0,1,0). Tout ce
qu'un jeu déclare ensuite gagne. C'est ce qui permet aux boutons de GAMEPLAY —
`.cell` du morpion, `.rate` de l'imitation, `.fab` de precision, `#stop-btn` du
ban — de garder leur apparence sans toucher à leur balisage.

Chaque jeu choisit **un** jeton : `--g-accent` (+ `--g-accent-ink`).
Morpion violet, Demi-Cercle violet, Imitation violet, Ban rouge, Precision son
lavande, Passeur et Qui Ment ? l'orange Mann Co.

### Trois pièges rencontrés, tous les trois invisibles à l'œil nu

1. ⚠️ **`:where()` a une spécificité NULLE.** Mon `button { … }` commun (0,0,1)
   écrasait donc `:where(.avatar-pick)`, et les avatars se retrouvaient avec le
   fond plein et les coins coupés d'un bouton d'action. `.avatar-pick` et
   `.ghost` s'écrivent en classe NUE (0,1,0). Ne pas les remettre en `:where()`.
2. ⚠️ **Precision redéfinissait `--bg`, `--ink`, `--line` et `--card`** — les
   noms mêmes des jetons de tf2.css. Le fond commun ne passait pas et les
   règles partagées résolvaient sur sa palette. Ces quatre-là ne servaient plus
   qu'au chrome retiré (zéro usage restant) : supprimés, et son trait propre
   renommé `--p-line`. **Ne jamais redéfinir un nom de jeton de tf2.css dans un
   jeu** — c'est l'avertissement qui était déjà en tête de game-ui.css.
3. ⚠️ **Le commentaire de chaque page contient les mots « dans le `<style>`
   ci-dessous ».** Un script d'édition qui ancre sur `<style>` injecte donc son
   CSS DANS LE COMMENTAIRE : rien ne s'applique, et rien ne le signale. Ancrer
   sur `\n<style>\n`.

### Ce qui reste volontairement différent

Grille et ✕/◯ du Morpion, cadran du Demi-Cercle, double waveform de
l'Imitation, vidéo et `#stop-btn` du Ban (gros et rouge vif : c'est du « grand
texte » WCAG, 3:1 exigé), les 4 épreuves de Precision, terrain 2.5D du Passeur,
carte de rôle de Qui Ment ?. Le Mann Co. est le langage de l'INTERFACE, pas
celui du terrain.

Deux différences assumées en plus :
- le code de salle du Morpion reste **en ligne et à la taille du texte** : il
  vit dans une rangée de méta, pas en bloc. C'est la surcharge que `.g-copy`
  laisse passer par construction ;
- Le Passeur et Qui Ment ? gardent des copies locales de quelques règles que le
  socle porte aussi (champs, avatars, code de salle). Elles sont identiques —
  c'est d'elles que le socle a été tiré — donc aucune divergence visuelle. Je ne
  les ai pas retirées pour ne pas risquer une régression sur les deux jeux qui
  venaient d'être validés.

### Le test qui garde tout ça

`tests/games.html` compare désormais **les 7 jeux entre eux** : même hauteur de
bouton, même hauteur de champ, un seul fond, une seule famille de titre, le
panneau commun partout. Avant : boutons de 40 à 48 px, champs de 40 à 50, trois
familles de titre, deux fonds, panneaux dans 3 jeux sur 7. Après : **40 / 40
partout**. C'est ce test qui rattrapera une modification du fichier partagé qui
re-diverge un jeu ayant des styles locaux.

**Dernier passage** : jeux 213/208 (deux modes), front 195, clavier 8/8 sur les
8 pages, partie réelle du Passeur 49/49, fichiers générés OK.


## Précision : la zone de jeu redevenue grande, et encastrée (2026-09-18)

L'harmonisation avait écrasé le plateau de Précision en **bande horizontale de
45 px de haut**. Trois causes, toutes de la migration de la veille :

1. La section est passée de `class="card play-card"` à
   `class="panel g-screen play-card"`, ce qui a rendu le sélecteur
   **`.card.play-card` orphelin** — donc plus d'`aspect-ratio: 5/6`.
   ⚠️ **C'est LE piège à retenir** : toutes les épreuves de Précision vivent en
   `position: absolute; inset: 0`. Elles ne participent donc pas à la hauteur
   de la section, qui retombe sur son seul rembourrage. Mesuré : 560×672 avant,
   **560×45** après, ratio 12,5:1. Rien ne manquait dans le DOM, tous les
   éléments répondaient présents — un test d'existence n'aurait rien vu.
   Quand on renomme la classe d'un élément, **relire les sélecteurs composés**
   qui la mentionnaient.
2. `:where(.g-screen) { padding: 1.4rem 1.2rem }` du socle s'appliquait au
   plateau. Ce sont ces 45 px. Le bon côté du `:where()` : spécificité nulle,
   donc `.play-card { padding: 0 }` le bat **sans un seul `!important`**.
3. L'ancienne `.card` portait aussi `overflow: hidden` et un fond noir, perdus
   au passage : le plateau débordait des coins coupés et la surface de jeu était
   **brune** (le dégradé Mann Co. du panneau) au lieu d'être noire.

Corrigé, avec un écart : le plateau est maintenant **plus grand qu'avant** —
`main:has(.play-card:not([hidden]))` l'élargit à 640 px sur grand écran, mais
plafonné par `calc((100svh - 3.6rem) * 5/6)`, donc **c'est la largeur qui cède,
jamais le ratio**. 1280×900 → 640×768 (+31 % d'aire) ; 1280×720 → 552×662 ;
390×780 → 358×430. Sans `:has()`, on retombe sur les 560×672 d'avant.

### Deux pièges CSS, notés pour la prochaine fois

- ⚠️ **`background` sur un `.panel` ne se voit pas.** `.panel::before` de
  tf2.css peint son dégradé à `z-index: -1` sous `isolation: isolate`, donc
  **au-dessus** du fond de l'élément. Pour donner au plateau son noir
  d'instrument il faut redéfinir **`.play-card::before`** — même spécificité
  (0,1,0), notre feuille passe après tf2.css.
- ⚠️ **Le décor ne doit jamais intercepter le gameplay.** Le boîtier est un seul
  `<div id="bezel" aria-hidden="true">` en `pointer-events: none`, à
  **z-index 4** : au-dessus des épreuves, sous le HUD (5), le bouton rond (6) et
  la barre de temps (7). Vérifié par `elementFromPoint` sur 9 points, bords
  compris — c'est là que vivent les graduations.
  Et **les barres de teinte de l'épreuve COULEUR sont remontées à z-index 5** :
  collées au flanc gauche, elles passaient sous la gouttière du boîtier, qui
  assombrissait le bord de la barre H. On ne juge pas une couleur sur un bord
  teinté. Idem pour `#reveal-view` (le classement est de la lecture, pas une
  surface de mesure).

### Ce que le boîtier dessine

Précision n'est pas un terrain de sport : c'est un **appareil de mesure**, et
c'est ce qui la distingue du Passeur. Biseau en `box-shadow` inset (lumière en
haut, ombre en bas), vignette d'encastrement, gouttière, graduations de règle à
deux pas sur les quatre bords, équerres de visée dans l'accent violet, liseré
interne, plaque gravée verticale « CAL. 00—100 » en TF2 Build. **Aucune image,
aucun fichier** : des dégradés répétés et des ombres. Tout est **local à
`games/precision/`** — `tests/games.html` vérifie que le socle commun ne
contient aucune règle de plateau.

**Compromis assumé** : l'aperçu de l'épreuve COULEUR garde la vignette sur ses
bords (seules les barres sont remontées). Elle se juge sur sa masse centrale,
et remonter l'aperçu ferait disparaître le cadre pendant cette épreuve.

### Au passage

**Morpion avait perdu son panneau** dans la même migration : sa section de jeu
portait encore `class="card"`, classe orpheline elle aussi — plus de fond, plus
de bordure, plus de coins coupés. `tests/games.html` vérifie désormais pour les
7 jeux que l'écran de jeu est bien un `.panel`.

**Dernier passage** : jeux **239/234** (deux modes), front **195/194** (deux
modes), clavier 8/8 sur les 8 pages, fichiers générés OK. Les 7 tests de
géométrie du plateau **échouent bien sur l'état d'avant** (640×45, ratio 14,3) —
vérifié en remettant la bande.


## Passe de layout sur les 7 lobbys (2026-09-18)

Audit à la règle des 7 jeux, accueil et salon, à 1280 et 390 px : chevauchements
de boîtes, labels séparés de leur liste, débordements. **Deux pannes réelles**,
et cinq jeux sortis propres — je n'ai pas touché à ce qui ne cassait pas.

### ⚠️⚠️ `* { margin: 0 }` bat `:where()` — la troisième fois que ce piège mord

`:where(#avatar-row) { … margin-bottom: 1rem }` du socle a une spécificité
**nulle**. Or cinq des sept pages ouvrent leur `<style>` par
`* { margin: 0; box-sizing: border-box }` — **spécificité nulle elle aussi**, et
leur feuille est chargée APRÈS le socle. C'est donc l'étoile qui gagnait.

Résultat mesuré : **0 px** entre la dernière rangée d'avatars et « Créer une
partie » sur ban, demicercle, imitation et precision — contre 21 px sur passeur
et quiment, les deux seuls à déclarer leur propre `#avatar-row` (1,0,0). Quand
les avatars passent sur deux ou trois lignes, le bouton se lit comme la suite de
la grille d'icônes.

Correctif : la marge sort du `:where()` et s'écrit `#avatar-row { margin-bottom:
1.25rem }` — un ID (1,0,0) passe devant l'étoile, et un jeu garde le dernier mot
avec son propre `#avatar-row` déclaré plus loin. Écart après : 20-21 px partout.

**La règle à retenir** : dans game-ui.css, `:where()` convient pour ce qu'un jeu
doit pouvoir surcharger facilement, mais **jamais pour une propriété qu'un reset
universel remet à zéro**. Marges et rembourrages en font partie.

### Demi-Cercle : un `flex-wrap` qui cassait entre un label et sa liste

`#host-config` était un `display: flex; flex-wrap: wrap` de **cinq éléments
indépendants** (manches, liste, thèmes, liste, bouton). Rien n'y tenait un label
avec sa liste : dès que la première ligne était pleine, « thèmes : » y restait
pendant que son select passait à la ligne suivante, **à côté du bouton de
lancement**. Mesuré aux DEUX largeurs — ce n'était pas un problème de téléphone
mais de méthode.

Correctif local : une grille `grid-template-columns: auto minmax(0, 1fr)`, qui
soude chaque paire, plus `#start { grid-column: 1 / -1 }` pour que « Lancer la
partie » ait sa propre ligne. Les listes sont plafonnées à `15rem` : sans ça un
select de 360 px affichait « 3 ».

**Les autres jeux gardent leur flex, volontairement.** Mesurés : une seule paire
label+liste, trop étroite pour se scinder (116 px dans un conteneur de 320). Sur
bureau ils tiennent sur une ligne — c'est la présentation compacte voulue, pas
un défaut. Ne pas les passer en grille « par cohérence » : ça leur ajouterait une
rangée pour rien.

### Un mot sur les faux positifs

Deux pistes ont été écartées après mesure, et c'est aussi bien de le noter :

- ⚠️ **Comparer les bords hauts de deux éléments d'une même ligne de flex ne
  prouve rien.** Un label de 18 px et un select de 40 px centrés ensemble ont
  22 px d'écart de `top` alors qu'ils sont parfaitement alignés. Mon premier
  détecteur criait « label séparé » sur les 6 jeux. **Comparer les centres.**
- Les scores non alignés à droite dans les salons : artefact de mon harnais de
  capture, qui ajoutait un `<span class="pts">` que le vrai `app.js` ne produit
  jamais. Aucun jeu n'affiche de score dans son salon.

Au passage : l'icône 🎙 de la note micro d'imitation tombait seule sur sa ligne
→ espace insécable.

### Les tests

`tests/games.html` mesure désormais, **pour les 7 jeux et aux deux largeurs** :
aucun chevauchement de boîtes dans l'accueil et le salon (comparaison deux à
deux de tous les éléments de texte et de contrôle), l'écart avatars→bouton avec
le nombre de lignes d'avatars, chaque label sur la ligne de sa liste, « Lancer »
qui ne recouvre aucune liste, et rien qui sorte du panneau à 390 px.
**Vérifié : 10 de ces tests échouent sur l'état d'avant**, avec les bons
libellés (« 0px, 2 ligne(s) », « thèmes : »).

**Dernier passage** : jeux **308/303** (deux modes), front 195/194 (deux modes),
clavier 8/8, fichiers générés OK. Precision et Le Passeur n'ont pas été touchés
et leurs tests de plateau et de terrain passent tous.


## Game Hub, phase 1 : le manifest des jeux (2026-09-18)

Première brique du futur **Mathys Game Hub** (`/games/`, orchestrateur de
session). Le design review complet est hors dépôt ; ce qui compte ici est que
**seule la phase 1 est faite** : le catalogue machine. Aucun serveur de hub,
aucune room, aucun handoff, aucun randomizer.

### Ce qui existe maintenant

- **`data/games.js` reste la source de vérité**, avec un bloc `hub` par jeu
  jouable (8 sur 9 — « La suite » n'en a pas, et ne doit pas en avoir).
- **`data/games.manifest.json` est GÉNÉRÉ** par `tools/build.mjs`, comme le
  sitemap. Ne jamais l'éditer à la main. C'est le fichier que le Hub ira
  chercher sur GitHub Pages, exactement comme `ban-server` va déjà chercher
  `games/ban/videos.json`.

### Les trois règles du schéma, et pourquoi elles sont dans le CODE

Elles sont validées par `tools/build.mjs` et testées par `tests/manifest.mjs`.
Écrites seulement en commentaire, elles auraient dérivé en trois mois.

1. ⚠️ **SCHÉMA FERMÉ.** Toute clé hors de `CLES` fait échouer le build. C'est
   ce qui empêche un identifiant de **contenu** (situation, vidéo, thème)
   d'entrer un jour dans le manifest : le Hub transporte l'historique de
   contenu, il ne l'interprète ni ne le fabrique. Le serveur du jeu reste seul
   maître de ce qu'il a consommé.
2. ⚠️ **`minutes` = `{ min, max }` au réglage par défaut du MJ, et le filtre
   de durée compare le `max`.** Un « ≤ 10 min » écarte donc un jeu dont le max
   est 12 : rien d'implicite, au prix d'un filtre conservateur. Le MJ peut
   allonger une fois dans la partie — le Hub ne surveille pas les réglages d'un
   jeu.
3. ⚠️ **Le Hub ne teste JAMAIS une capacité.** Il ne déclenchera aucune
   demande de permission micro ou caméra : c'est le jeu qui demande et qui
   vérifie, à l'entrée. Ne pas « améliorer » le Hub en lui faisant appeler
   `getUserMedia`.
   ⚠️ Depuis le 2026-09-20, **`mic` et `consent` sont acquis d'office** : un
   nouveau joueur naît avec `caps: { mic: true, consent: true }`
   (`game-hub-server/src/session.js`), et plus personne ne déclare rien. Voir
   « Les capacités sont acquises d'office » en fin de fichier.

Vocabulaires fermés aussi pour `needs` (`mic`, `cam`, `consent`) et
`categories` : `needs: ['micro']` créerait un filtre que rien ne satisfait, en
silence — le genre de panne qu'on ne découvre qu'en soirée.

### Les bornes de joueurs, vérifiées

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

`content` et `replay` valent `false` partout sauf `replay` sur passeur et
quiment, où `action: 'lobby'` est vérifiée dans le serveur. **`false` veut
dire « non supporté OU pas encore vérifié »** : dans les deux cas le Hub s'en
passe. Ces drapeaux passeront à `true` jeu par jeu, plus tard.

### Le test qui compte

`tests/manifest.mjs` (`node tests/manifest.mjs`, 71 vérifications) ne se
contente pas de relire le JSON :

- il compare l'URL `wss://` annoncée à celle que le `net.js` du jeu utilise
  **vraiment** — un copier-coller raté enverrait le Hub réveiller un serveur
  pendant que le joueur en contacte un autre, et tout aurait l'air normal des
  deux côtés ;
- il vérifie le dialecte : un jeu `join: 'v1'` doit bien envoyer `name` et
  `avatar`, un `'anon'` (Morpion) ne doit en envoyer aucun ;
- il **casse volontairement `data/games.js`** six fois et vérifie que le build
  échoue à chaque fois. ⚠️ Ces cas écrivent vraiment dans le fichier avant de
  le restaurer dans un `finally` : si le test est interrompu, regarder
  `git diff data/games.js` avant de commiter.

### Décisions déjà prises pour la suite (ne pas les rouvrir sans raison)

Pilote **Le Passeur** ; navigation **même onglet** (donc un `resumeToken` sera
nécessaire dès le serveur de hub) ; photo de profil **au Hub seulement**, emoji
conservé dans les jeux ; ~~pré-réveil Render **au moment du tirage**~~
(abandonné le 2026-09-20 : on ne réveille plus rien avant de tirer) ; public
**entre amis** ; `/games/` **remplacera** le faux randomizer de `js/gamehub.js`.

⚠️ Deux limites de l'existant, mesurées, qui commanderont les phases tardives :
les serveurs tronquent l'avatar à 4 caractères (`slice(0, 4)`), donc une image
ne peut pas les atteindre ; et `E.deal()` est rappelé à chaque `start`, donc
« rejouer » efface l'anti-répétition de contenu.

**Dernier passage** : manifest 71/71, jeux 308, front 195, fichiers générés OK.


## Game Hub, phase 2 : le profil local (2026-09-18)

Deuxième brique du Game Hub : **une identité commune au portfolio**, pseudo +
avatar, retenue d'un jeu à l'autre. Toujours aucun serveur de hub, aucune room,
aucun handoff, aucun randomizer.

    localStorage  →  games/shared/game-profile.js  →  pages de jeux

Et rien de plus. Le module n'ouvre aucun socket et ne connaît ni serveur, ni
règle, ni score.

### Le contrat

```js
{ v: 1, id: 'p_7f3a91c2', name: 'Mathys',
  avatar: { kind: 'emoji' | 'image', emoji: '🦊', src?: 'data:image/webp;…' } }
```

Clé `localStorage` : **`mathys_game_profile`**. `id` est LOCAL — aucun serveur
ne le reçoit, et il ne prouve rien : le jour où le Hub existera, l'autorité
viendra du socket, comme dans les sept jeux aujourd'hui.

**L'emoji est toujours présent, même en mode image.** C'est lui le repli, et
c'est lui qui voyage.

### Trois bornes, toutes prises dans les vrais serveurs

- `name` : 16 caractères — c'est le `slice(0, 16)` des six serveurs.
- ⚠️ `emoji` : **4 unités UTF-16 maximum**. Les serveurs font
  `String(avatar || '🙂').slice(0, 4)`, et ce `slice` compte des unités UTF-16,
  pas des emojis. Les douze icônes actuelles en font 2 ou 3, donc tout passe —
  mais un emoji à ZWJ (👨‍👩‍👧 = 8 unités) serait coupé en plein milieu et
  arriverait cassé chez les autres joueurs. Le module le refuse ici plutôt que
  de laisser le serveur trancher.
- `src` : 12 Ko, et uniquement une data-URL **webp ou png** produite par notre
  canvas. SVG refusé par construction (il peut porter du script, et un canvas
  n'en écrit jamais).

Un profil illisible, une version inconnue, un champ du mauvais type : on repart
sur un profil neuf **sans jamais lever d'exception**. `sanitize()` est le seul
point d'entrée, et c'est là que viendra se brancher une migration le jour où
`v` changera.

### ⚠️ L'image ne part PAS en jeu, et c'est voulu

`slice(0, 4)` : une URL n'y tient pas, une image encore moins. La photo reste
donc **locale** (elle servira au futur Hub) et c'est l'emoji qui voyage.
L'interface le dit au joueur : « gardée pour toi — en jeu, c'est ton icône qui
s'affiche ». Ne pas « corriger » ça sans étendre d'abord les six serveurs.

### ⚠️ Morpion : l'exception, et elle est structurelle

`morpion-server/src/server.js` lit `onJoin(ws, msg.code)` : **ni pseudo, ni
avatar**. Sa page n'a d'ailleurs ni `#name-input` ni `#avatar-row`, et on ne
lui envoie jamais une identité qu'il ne sait pas recevoir.
⚠️ `game-profile.js` y est **chargé quand même**, pour une seule raison : le
handoff du Game Hub (`hub-handoff.js`) a besoin de l'identifiant local pour se
présenter au HUB avec le même player.id. Il n'y remplit rien et n'ajoute
aucune interface. `tests/profile.mjs` vérifie qu'aucun champ d'identité
n'apparaît, `tests/handoff-morpion.mjs` relit chaque trame envoyée à
morpion-server : jamais de `name` ni d'`avatar`.

### Ce qui a changé dans les six autres jeux

**Une seule ligne par jeu.** `AVATARS[Math.floor(Math.random() * …)]` devient
`GameProfile.startEmoji(AVATARS)`. Tout le reste — préremplissage du pseudo,
enregistrement au clic sur un avatar, choix de photo — est branché par le
module lui-même, par délégation sur `#avatar-row` et `#name-input`, sans
toucher au balisage. Les écouteurs du jeu continuent de fonctionner à côté.

`startEmoji(liste)` : garde l'emoji du profil s'il figure dans les douze de ce
jeu ; sinon en choisit un **de façon stable** (dérivé de l'id local), et **ne
réécrit jamais** le choix du joueur. Les six jeux ne proposent pas les mêmes
douze icônes : un tirage au sort changerait d'avatar à chaque rechargement.

Le pseudo est enregistré à l'événement `change` (sortie du champ), pas à chaque
frappe, plus un filet en phase de capture sur `#host` et `#join`.

### Deux pièges rencontrés, et notés

- ⚠️ **`width: 1px` ne suffit pas à masquer un champ.** Le `input {}` générique
  du socle pose 8/12,8 px de rembourrage, et en `box-sizing: border-box` une
  largeur de 1px ne peut pas descendre sous rembourrage + bordure : le champ
  fichier occupait encore **30 × 20 px**, invisible mais bien présent dans la
  mise en page. Il faut `padding: 0; border: 0; min-height: 0`. C'est
  `tests/games.html` qui l'a vu, en comparant les boîtes deux à deux.
- ⚠️ **`tests/keyboard.mjs` passe de 14 à 18 tabulations** : sans ça le nouveau
  bouton « ajouter une photo » n'était jamais atteint, et sa couverture aurait
  baissé en silence.

`games/shared/game-ui.css` est passé en `?v=3` sur les **sept** pages : la
feuille a changé, le cache devait sauter.

### Tests

`node tests/profile.mjs` : **41 vérifications unitaires + 31 d'intégration**,
sur un vrai serveur HTTP local (voir tests/README.md pour le pourquoi).

**Dernier passage** : profil 41 + 31, jeux 308/303, front 195/194, clavier 8/8
(18 tabulations), manifest 71, partie réelle du Passeur 49/49 contre un serveur
local, fichiers générés OK.

## La photo de profil voyage en jeu (2026-09-19)

La PP choisie dans le profil local s'affiche maintenant **chez les autres
joueurs**, dans les six jeux qui reçoivent une identité. Morpion reste hors du
coup (son serveur ne reçoit pas d'identité) ; game-hub-server n'a pas bougé.
⚠️ Ça **remplace** la décision n°3 du design review du Hub (« image au Hub
seulement ») : c'est Mathys qui l'a demandé, la data-URL dans le `join` plutôt
qu'une `avatarUrl` servie par le Hub.

    GameProfile.joinAvatar(emoji) → join → avatar.js (serveur) → état joueur
    → toutes les listes de joueurs → GameAvatar (client) → <img> ou emoji

### Le contrat, le même dans les deux sens

```js
{ kind: 'emoji', emoji: '🦊' }
{ kind: 'image', emoji: '🦊', src: 'data:image/webp;base64,…' }
```

L'emoji voyage **toujours** : c'est le repli. Un ancien client qui envoie une
chaîne reste accepté (`{ kind: 'emoji' }`), un ancien serveur qui renvoie une
chaîne reste affiché.

### Serveurs : `avatar.js`, le même fichier dans les six dépôts

Le `String(avatar).slice(0, 4)` a disparu. `cleanAvatar()` n'accepte qu'une
data-URL **webp ou png**, **≤ 12 Ko décodés**, base64 canonique, signature du
fichier vérifiée ; tout le reste (SVG, gif/jpeg, trop lourd, `kind` inconnu,
structure) écarte l'image et garde l'emoji — le joueur n'est jamais bloqué.
Seuls `kind`/`emoji`/`src` sont recopiés ; l'image n'est ni décodée ni
réencodée. Aucun changement de protocole ailleurs : `avatar` passe juste
de chaîne à objet, là où il passait déjà.

### Client : `games/shared/game-avatar.js`

⚠️ **La donnée du réseau ne passe jamais par innerHTML.** Les jeux assemblent
leurs listes en gabarits ; `GameAvatar.slot(avatar)` y pose un emplacement VIDE
et `GameAvatar.fill(conteneur)`, juste après l'innerHTML, le remplace par un
nœud créé à la main (`<img>` ou texte). **Tout `slot()` doit être suivi d'un
`fill()`** sur le même conteneur, sinon la case reste vide. Une image qui ne se
décode pas redevient l'emoji sur place (`error`), sans toucher au profil.
Le Demi-Cercle pose la photo au bout de l'aiguille en `<image>` SVG.
Style : `.g-av-img` dans game-ui.css (1,5em, jamais plus que les 96 px de la
source) — d'où un `?v=` relevé sur `game-ui.css` dans les pages de jeux.

⚠️ **Borne alignée** : le profil bornait la data-URL à 24 Ko de TEXTE (~18 Ko
d'image) alors que la limite annoncée était 12 Ko. Une photo entre 12 et 18 Ko
serait passée côté client puis refusée par le serveur. `okImage()` compte
maintenant les octets décodés, comme le serveur.

### Tests

- chaque serveur : `test-avatar.js` (42, sur de vraies images dans
  `test-fixtures/`) et `test-avatar-ws.js` (25 à 30, sur le fil). Vérifié : ils
  échouent en masse contre les serveurs d'avant (22 à 26 KO chacun) ;
- `tests/avatar-play.mjs` : les six jeux joués pour de vrai à trois joueurs
  dans trois contextes isolés, PP posée par le vrai champ fichier, trames
  WebSocket ET DOM lus (153 vérifications). Voir tests/README.md.

⚠️ Défauts **préexistants** vus en passant, non corrigés (hors tâche) :
- Demi-Cercle : après `end`, le `room` qui suit faisait `show('lobby')` sans
  garde → podium masqué. **Corrigé depuis** (`inEndScreen` dans `app.js`) ;
- `tests/manifest.mjs` : la mutation « jeu live sans bloc hub » est une regex
  en `
` — sur un poste en `core.autocrlf=true` (CRLF) elle ne s'applique pas
  et le test échoue (déjà le cas sur HEAD) ;
- `tests/passeur-play.mjs --reduced` échoue au premier clic sur ce poste, déjà
  avec le front ET le serveur de HEAD ; le mode normal passe (49/49).
- les harnais WebSocket de 4 serveurs avaient une course dans `open()`
  (abonnement à `open` après coup) : corrigée, une ligne par fichier.

### ⚠️ Le « [obj » vu à la main — et pourquoi les tests ne l'avaient pas vu

Mathys a testé le front neuf contre la **production** (la page de jeu vise
Render quand il n'y a pas de `?server=`), alors que les serveurs n'étaient pas
encore poussés. L'ancien serveur a fait `String(avatar).slice(0, 4)` sur
l'objet → **« [obj »**, diffusé à tout le monde (même l'emoji de B, qui voyage
aussi en objet). Le client a pris cette chaîne pour « l'emoji d'un ancien
serveur » et l'a affichée dans `span.g-av`. Tous les tests tournaient contre
les serveurs LOCAUX déjà modifiés : la combinaison front neuf + serveur
d'avant n'était jamais jouée.

Correctif, côté client seulement (contrat et serveurs inchangés) :
`game-avatar.js` n'accepte plus comme emoji venu du réseau qu'une chaîne qui
en a l'air (un pictogramme, aucun ASCII imprimable) ; sinon, l'emoji par
défaut du jeu. Et `tests/avatar-play.mjs` rejoue désormais les six salons
contre la version du serveur **d'avant avatar.js**, extraite de git — vérifié :
ce test échoue sur `"[obj"` avec l'ancien rendu. Chaque écran vérifié scanne
aussi le texte visible à la recherche de « [obj ».

Les six serveurs ont été poussés sur `main` le 2026-09-19 (à la demande de
Mathys) et Render les a redéployés : une sonde WebSocket sur chacun renvoie
la PP à l'identique. Pour la suite : **serveurs d'abord, front ensuite** — un
front neuf devant un serveur en retard affiche maintenant l'emoji par défaut,
plus jamais « [obj », mais la photo n'apparaît qu'une fois le serveur à jour.

## Des PP qui se voient (2026-09-19, finition)

Les vraies PP passaient mais faisaient ~20×15 px : un glyphe. Elles sont
devenues un bloc d'identité, dans les six jeux, sans nouveau protocole.

- **Une hiérarchie, pas des pixels semés** : `GameAvatar.slot(av, repli, taille)`
  / `node(…, taille)` avec `sm` 32 px (compact : légendes, pastilles, indices),
  `md` 48 px (salons, scores, résultats, votes), `lg` 68 px (podium,
  « c'est à qui ? »). Sous 480 px : 44 / 60. Sans taille, l'ancien rendu en
  ligne reste disponible pour les phrases.
- **Même boîte pour la photo et l'emoji** : l'emoji est posé dans `.g-av-e`,
  même géométrie que l'`<img>` → aucun décalage de mise en page entre les deux.
- **Forme** : carré à coins coupés (la silhouette de tout « objet » Mann Co.),
  pas un cercle. Liseré = accent du jeu, ou couleur du joueur via
  `--g-av-ring` (Demi-Cercle et Ban : la couleur de l'aiguille / du trait).
  ⚠️ `clip-path` rogne bordures et ombres : le liseré est le FOND du bloc vu à
  travers 2 px de rembourrage. Ne pas « simplifier » en `border`.
- **`.g-player` / `.g-player-name` / `.g-player-score`** (game-ui.css) : la
  rangée avatar · pseudo (2 lignes max) · score. Pas de couleur imposée — chaque
  jeu garde la sienne. `:where(ul):has(> .g-player)` retire le retrait de 40 px
  des `<ul>`, qui décalait déjà toutes les listes sans qu'on le voie.
- Adaptations propres à un jeu : scoreboard d'Imitation et du Demi-Cercle
  élargi (170 → 240 px) ; photo au bout de l'aiguille du cadran 18 → 26 unités ;
  Ban : avatar dans le titre « tour de … », les pastilles d'ordre de passage et
  le classement du round (le serveur les envoyait déjà) ; Précision : liste de
  révélation à 36 px sous 480 px (plateau à ratio fixe) ; Qui Ment ? : boutons
  de vote en cartes joueur, verdict de l'intrus en grand.
- Tests : `tests/avatar-play.mjs` vérifie maintenant aussi la géométrie
  (carré, taille de la hiérarchie, même boîte photo/emoji) et l'absence de
  débordement à chaque écran ; `--shots <dossier>` capture chaque écran vérifié.
  Le bouton « Créer » de Qui Ment ? à 390×780 : inchangé (bas à 727 px, comme HEAD).

## Game Hub, phase 3 : /games/ connecté au Hub, le vrai salon (2026-09-19)

`/games/` n'existait pas (404). C'est maintenant l'entrée du Game Hub :
profil → **Créer une session** ou **CODE + Rejoindre** → **salon** (code,
joueurs, hôte). Cette phase s'arrêtait là ; le tirage (caisse, randomizer) et
le lancement des jeux (handoff) sont venus ensuite — sections suivantes.

| Fichier | Rôle |
|---|---|
| `games/index.html` | la page (Mann Co., mise en page propre au Hub), `noindex` pour l'instant |
| `games/hub-page.js` | la colle profil ↔ client ↔ affichage ; aucun WebSocket ici |
| `games/shared/game-hub.js` | LE client du Hub : connexion, create/join/leave, reprise, erreurs. Navigateur ET Node |

**Configuration** : une seule constante, `PROD` dans game-hub.js
(`wss://game-hub-server-qqdk.onrender.com`). `?hub=ws://localhost:8100` dans
l'URL de la page la remplace (tests, dev). Rien d'autre à régler.

**Le protocole a été relu dans `game-hub-server/src`, pas deviné** : `create`
/ `join` / `leave` → `created` / `joined` / `session` / `error{code,message}`.
Les codes d'erreur sont CEUX du serveur (`SESSION_NOT_FOUND`, `SESSION_FULL`,
`BAD_CODE`, `BAD_PLAYER`, `REPLACED`…), traduits en phrases par
`errorText()` ; aucune erreur brute n'atteint l'écran.

⚠️ **Trois règles du client, toutes testées** :
- **Reprise = rejouer `join` avec le MÊME player.id.** Le serveur rend sa place
  au joueur (pas de doublon). Un rechargement de page la reprend aussi (code
  de session en `sessionStorage`, par onglet).
- **`REPLACED` → jamais de reconnexion automatique.** Deux onglets du même
  profil s'éjecteraient sinon en boucle. L'onglet remplacé revient à l'entrée.
- **Profil neuf → id écrit dès la première lecture** (`GameProfile.load()`).
  Avant, chaque lecture d'un profil jamais enregistré tirait un nouvel id :
  la reconnexion était impossible. Un profil d'une AUTRE version n'est pas
  écrasé. C'est le seul changement de game-profile.js, et
  `tests/profile.html` l'a noté : l'ancienne assertion « rien n'est écrit tant
  qu'on ne sauvegarde pas » décrivait précisément ce défaut.

Comportements RÉELS du serveur à connaître (non modifiés) :
- un `leave` ne ferme la session que si elle est vide ; un joueur **absent**
  la garde vivante jusqu'au bout de sa grâce de **60 s** ;
- **en production**, une fermeture initiée par le client n'est vue qu'au bout
  de **~10 s** (proxy Render, mesuré) ; un onglet fermé est vu tout de suite.
  Pas de ping côté serveur : une vraie coupure réseau (sans trame de
  fermeture) peut être vue encore plus tard — à traiter avec le handoff.

Tests : `node tests/hub.mjs` (unitaires + protocole contre le vrai serveur,
50 local / 49 production) et `node tests/hub-play.mjs` (deux navigateurs isolés :
A crée → B rejoint → avatars et hôte → B recharge et reprend sa place → A
ferme → l'hôte passe à B → 12 joueurs aux 3 tailles → B quitte → la session
disparaît du serveur ; 40/40 en local ET contre la production).


## Game Hub : stabilisation (2026-09-19)

Serveur `game-hub-server` seulement (+ ses tests et ceux du portfolio). Aucun
changement de protocole, aucun changement du front `/games/`, aucun serveur de
jeu touché. **Pas encore déployé** : Mathys s'en charge sur Render.

- **Heartbeat** : ping/pong NATIF de WebSocket, un ping toutes les **20 s**
  (`HEARTBEAT_MS` dans `src/hub.js`). Une connexion qui n'a pas répondu au tour
  précédent est `terminate()`e au suivant → détection en 20 à 40 s. Le
  navigateur répond lui-même (aucun code côté page), et la coupure passe par le
  MÊME `onClose` qu'une fermeture ordinaire : absent, grâce, reprise possible.
- **Trois sorties, trois comportements** :
  | Événement | Effet |
  |---|---|
  | coupure réseau / socket fermé | joueur **absent**, gardé 60 s, peut revenir avec le même id |
  | `leave` volontaire | joueur **retiré tout de suite**, hôte réélu, diffusion |
  | plus aucun joueur **connecté** (leave ou coupure) | session supprimée **immédiatement**, absents compris |
  Avant : un `leave` laissait vivre la session 60 s tant qu'un absent y restait.
- Tests : `game-hub-server/test-presence.js` (23, vraies connexions, client
  `autoPong: false` pour simuler un téléphone en mode avion) ; `tests/hub.mjs`
  attend maintenant la suppression immédiate au dernier `leave` ;
  `tests/hub-play.mjs` joue séparément la coupure de socket (A ferme sa page →
  absent → revient pendant la grâce, même id) et le départ volontaire (A clique
  « Quitter » → disparaît chez B en ~100 ms → B clique → `/health` à 0 session).
- ⚠️ Tant que le serveur n'est pas redéployé, la production garde l'ancien
  comportement (pas de heartbeat, session gardée 60 s après le dernier leave).
  Le client n'en dépend pas : aucun changement côté front n'est nécessaire.

## Game Hub : le randomizer (2026-09-19)

Le Hub tire maintenant le jeu de la soirée. **Le serveur décide, la page met en
scène.** Aucun serveur de jeu touché, aucun score de soirée, aucune base. (Le
lancement du jeu tiré — le handoff — est décrit dans la section suivante.)

    LOBBY → 🎲 (hôte) → le Hub filtre, pondère, tire → caisse → révélation
          → CONTINUER (debrief) → 🎲 tirage suivant → …   (même session, history.played grandit)

⚠️ Le schéma ci-dessus est à jour, mais les détails de SANTÉ écrits dans cette
section ont été corrigés depuis : voir « Le tirage ne dépend plus du /health »
en fin de fichier. En deux mots : rien n'est réveillé avant le tirage.

### Côté serveur (game-hub-server)

- **`src/engine.js`, module pur** : FILTRER (nombre de joueurs, mode local,
  capacités de TOUS — acquises d'office depuis le 2026-09-20, donc sans effet
  en pratique —, veto d'UN seul, durée max vs `minutes.max`)
  → PONDÉRER (`(1 + 0,5 × ❤️) × récence`, récence 0,15 / 0,4 / 0,7 selon
  l'ancienneté) → TIRER (hasard crypto). Toutes les raisons d'exclusion sont
  rendues, nominatives, dans `session.pool.why`.
- **Le catalogue n'est pas recopié** : `src/catalog.js` relit
  `data/games.manifest.json` sur GitHub Pages (cache 5 min), comme ban-server
  relit `videos.json`. Ajouter un jeu au portfolio l'ajoute au tirage sans
  redéployer le Hub.
- **Santé** : un GET sur l'URL `health` du manifest (`src/health.js`),
  **jamais** de WebSocket vers un jeu.
  ⚠️⚠️ **Plus aucun /health n'est consulté pendant un tirage**, et aucun
  pré-réveil n'a lieu à la création de session (corrigé le 2026-09-20, voir la
  section de fin de fichier). `pool.health` n'est plus qu'une **information**,
  souvent `unknown`.
- **Concurrence** : l'état passe à `drawing` AVANT le moindre `await` → un
  second `draw` reçoit `DRAW_IN_PROGRESS`. Seul l'hôte tire (`hostId` relu
  côté serveur). `draw` ne porte AUCUN champ.
- Aucun jeu possible : `NO_ELIGIBLE_GAME` + `why`, **pas de repli**.
  ⚠️ Ce code veut dire **une seule chose** : aucun jeu ne passe les RÈGLES
  (joueurs, besoins, veto, durée). Jamais « un serveur ne répond pas ».

### Côté portfolio

- **Entrée visible** : une carte « Game Hub · Joue avec tes amis » dans
  l'en-tête de la section Jeux (`#hub-link`, lien `games/`, marche sans JS),
  plus une commande dans la palette Ctrl+K. Les liens directs vers les 7 jeux
  restent.
- **Le faux matchmaking (« Trouver une partie ») est retiré** : il affichait un
  « match trouvé » sans aucun serveur, donc prétendait trouver un groupe. La
  caisse **solo** « Je joue à quoi ? » reste (tirage sur la page, sans session),
  marquée « tirage solo, sans session », et renvoie au Game Hub.
- `/games/` : ❤️ / 🚫 par jeu, durée max (hôte), la raison de chaque exclusion,
  les chances, la caisse (`games/hub-crate.js`), le résultat, et l'historique de
  la soirée. `noindex` conservé.
  ⚠️ Le bloc « ce que tu apportes » (micro, avertissement) a été **retiré** le
  2026-09-20 : ces capacités sont désormais acquises d'office. Ne pas le
  remettre — voir la section de fin de fichier.
  ⚠️ La caisse ne choisit rien : sa bande est tirée dans `draw.eligible` et
  s'arrête sur `draw.gameId`, tous deux venus du serveur.
  ⚠️ Au début d'un tirage, la page amène la caisse à l'écran (chez tous) : au
  téléphone, l'hôte cliquait « Tirer » en bas de la liste et la bande tournait
  900 px plus haut. Le test `390 px : la bande est à l'écran` échoue sans ça.
- ⚠️ **Anneau de focus rogné** : le socle le dessine en `outline`, mais les
  boutons des pages de jeux sont découpés au `clip-path`, qui rogne l'outline.
  Mesuré à la vraie touche Tab : invisible. Corrigé **sur la page du Hub
  seulement** (box-shadow inset). ⚠️ **Le même défaut existe dans les jeux qui
  utilisent le `button` générique** (vu sur Imitation ; Le Passeur, en
  `.tf-btn`, est bon) — non corrigé, hors périmètre, et `keyboard.mjs` ne le
  voit pas (il compte le biseau comme un anneau).

### Tests

Serveur : `test-engine.js` 65, `test-draw.js` 57, `test-e2e.js` 26 (+ session
41, protocole 37, présence 23). Portfolio : `tests/hub.mjs` 77,
`tests/hub-draw.mjs` 66 (64 en mouvement réduit), `tests/hub-play.mjs` 45.
Les tests locaux du Hub utilisent `tests/hub-fixture.mjs` : le vrai manifest,
les `/health` simulés — aucun serveur Render réveillé.

## Handoff : le Hub lance vraiment Le Passeur (2026-09-19)

`/games/` → tirage → **vraie room du Passeur, tout le monde dedans, partie
jouée**. `passeur-server` n'a **pas** été modifié, ni aucun autre serveur de
jeu. Le Passeur a été le pilote ; les **sept** jeux en ligne sont branchés
depuis, sur le même principe (voir la fin du fichier).

    lobby → drawing → [continuer] → launching (create → join) → inGame → debrief

### Le principe : le Hub ne parle jamais au serveur du jeu

Ce sont les NAVIGATEURS qui parlent au jeu ; le Hub relaie et arbitre.

1. l'hôte confirme le tirage → `launching`, stage `create` ;
2. il clique « Ouvrir Le Passeur » → même onglet → la page du jeu **crée la
   room par son chemin normal** (`enter()` sans code) et déclare le code au
   Hub (`launched`) → stage `join` ;
3. chaque invité voit « Rejoindre », clique, entre par le chemin normal
   (`enter(code)`) et le déclare (`entered`) ;
4. tout le monde est entré → `inGame` ; la partie se joue ; `ended` → `debrief`.

⚠️ **Aucun jeton secret, et c'est un choix.** L'autorité vient du SOCKET (seul
l'hôte DU LANCEMENT peut déclarer un code), le lancement est lié au tirage
(`drawId`), borné (90 s / 120 s) et à usage unique. Un jeton n'ajouterait rien.

### Ce qui a été ajouté, et où

- **`games/shared/hub-handoff.js`** (nouveau, partagé) : lit le BILLET écrit par
  `/games/` (sessionStorage : hub, session, playerId, drawId, gameId, rôle),
  rouvre le Hub avec le **même player.id**, appelle le `join()` que la page du
  jeu lui donne, déclare la room, affiche un bandeau (qui est là, qui est
  attendu, retour au Hub). **Sans billet, il ne fait rien** : Le Passeur ouvert
  directement marche comme avant.
- **`games/passeur/app.js`** : ~50 lignes. Aucun second système de création :
  le handoff appelle `enter()`. Nouveauté visible : « Lancer la partie » est
  bloqué tant que le groupe n'est pas dans la room (sinon un invité en retard
  se fait refuser par `passeur-server` : « partie déjà commencée »), avec
  « Lancer sans attendre » pour l'hôte.
- **`data/games.js` + `tools/build.mjs`** : clé `handoff` (schéma fermé, testée).
  Les sept jeux en ligne sont à `true` ; Puissance 4 (local) à `false`. Un jeu
  qui ne l'a pas : `continuer` revient au Hub comme avant.
  ⚠️ `tests/manifest.mjs` vérifie que `handoff: true`
  correspond à une page qui charge vraiment `hub-handoff.js`.
- **Hub** : `src/launch.js` (module pur) + handlers `launched` / `entered` /
  `started` / `ended` / `abort` dans `hub.js`.

### Trois pièges rencontrés, tous les trois trouvés par un test

1. ⚠️ **L'hôte qui navigue perd l'hôte.** Aller au jeu ferme son socket du Hub →
   `electHost` donnait la main à un invité, et l'hôte revenait sans pouvoir
   lancer. Règle ajoutée : pendant `launching`/`inGame` — **et au retour**
   (`debrief` d'un lancement fini) — l'hôte du lancement garde la main tant
   qu'il est dans la session (absent compris). Il ne la perd qu'en partant.
2. ⚠️ **Une session sans personne de connecté ne doit pas se fermer** pendant un
   lancement : tout le groupe navigue en même temps (et en solo, l'hôte est
   seul). Les grâces individuelles suffisent.
3. ⚠️ **`inGame` ne veut pas dire « la manche a commencé »** : c'est « tout le
   groupe est dans la room ». Le bandeau disait « partie en cours » au salon du
   jeu ; il dit maintenant qui est dans la partie.

### ⚠️⚠️ DÉFAUT DE PRODUCTION TROUVÉ : le réveil ≠ la panne

> **Dépassé le 2026-09-20.** Le correctif décrit ici (réessayer pendant 40 s au
> lieu de trancher tout de suite) rendait le tirage plus tolérant, mais il le
> laissait dépendre du /health — donc lent, et faillible. La santé a fini par
> sortir complètement du tirage. Gardé pour le diagnostic qu'il contient.

Mesuré contre la production pendant cette phase : le Hub déployé voyait les
**sept** serveurs de jeu « down » en moins d'une seconde, donc le tirage ne
trouvait **aucun jeu** (`NO_ELIGIBLE_GAME`), alors que les mêmes URL de santé
répondaient 200 en 12 à 22 s depuis un poste (le réveil Render). Corrigé dans
`src/health.js` : dans la fenêtre de 40 s, un non-2xx ou une erreur réseau
n'est plus un verdict — on réessaie toutes les 2,5 s ; seules une connexion
refusée et un nom inconnu tranchent tout de suite, et la raison du dernier
échec part dans les journaux Render (`[santé] passeur injoignable après 40 s : …`).
Une fois les serveurs réveillés à la main, la production tirait en 0,7 s.

### Tests

Serveur : `test-launch.js` 43 (pur), `test-handoff.js` 42 (vraies connexions :
rôles, codes, concurrence, délais, échecs, annulation, changement d'hôte),
`test-draw.js` 57 (dont le réveil d'un serveur). Portfolio :
`tests/handoff.mjs` 22 — **le vrai Hub + le vrai `passeur-server`**, room
réelle, trois joueurs dedans, une manche notée ; `tests/handoff-play.mjs` 42 —
**trois navigateurs**, du portfolio jusqu'au classement final et au retour au
Hub, plus le cas « serveur du jeu injoignable ».
⚠️ `tests/passeur-play.mjs` (Le Passeur hors Hub) reste **instable au premier
clic sur ce poste** : mesuré 4 échecs sur 4 avec les fichiers de HEAD contre 1
sur 4 avec ceux-ci — c'est le harnais, pas le jeu.

## Les capacités sont acquises d'office (2026-09-20)

L'écran **« Ce que tu apportes »** de `/games/` n'existe plus, et avec lui les
deux interrupteurs « 🎤 J'ai un micro » et « ⚠️ J'accepte les jeux à
avertissement », leurs états « déclaré / non déclaré » et les pastilles 🎤 / ⚠️
sur les cartes joueur.

**Un nouveau joueur naît avec `caps: { mic: true, consent: true }`** — une seule
ligne, dans `game-hub-server/src/session.js`. C'est le seul changement de
comportement ; le reste n'est que du retrait.

⚠️ **Ce qui n'a PAS changé, et qu'il ne faut pas confondre** :
- le **manifest** garde ses besoins : Imitation reste `needs: ['mic']`, le Ban
  reste `needs: ['consent']`. Ne pas les retirer ;
- la **règle `NEEDS` d'`engine.js` est intacte** : un joueur dont une capacité
  vaut explicitement `false` écarte encore le jeu, nominativement. L'action
  `caps` reste au protocole, et `reasonText` garde ses libellés côté client.
  C'est le filet si un besoin redevient un jour un vrai filtre — il s'affichera
  dans la raison du jeu, sans interface à refaire. Un test le vérifie
  (`test-engine.js`, « la règle NEEDS tient toujours »).

**Pourquoi** : le Hub n'a jamais testé ces capacités — c'est le jeu qui demande
le micro à l'entrée, et l'avertissement est affiché sur sa page. Un défaut à
`false` sans écran pour le lever aurait rendu Imitation et le Ban **impossibles
pour tout le monde, pour toujours**.

**Conséquence sur les listes** : Imitation et le Ban ne sont plus écartés que
par leur minimum de 2 joueurs. À 3 joueurs on passe de 3 à **5 jeux possibles**
(`imitation, demicercle, ban, passeur, quiment`). Plusieurs tests listaient ces
ensembles en dur et ont dû suivre — si un test parle d'éligibilité, il connaît
ces bornes.

⚠️⚠️ **`cam` n'est PAS dans le défaut**, parce qu'aucun jeu ne le demande
aujourd'hui. Le jour où un jeu déclarera `needs: ['cam']`, il sera impossible
pour tout le monde **en silence** : il n'y a plus aucune interface pour déclarer
quoi que ce soit. L'ajouter dans `session.js` ce jour-là. C'est noté en
commentaire à l'endroit exact.

**Dernier passage** : `game-hub-server` `npm test` 378/378 (deux fois), dont
moteur 68 et `test-draw` 64 (trois fois, le tirage étant aléatoire) ;
`tests/hub.mjs` 82, `tests/hub-draw.mjs` 79 et 77 en mouvement réduit,
`tests/handoff-play.mjs` 42, `tests/handoff.mjs` 22, `tests/hub-play.mjs` 45,
fichiers générés OK. Vérifié nommément : à 1 joueur, Imitation et le Ban sont
bloqués par « il faut 2 joueurs » et par **rien d'autre**.

## Le tirage ne dépend plus du /health (2026-09-20)

Un serveur de jeu endormi ne doit pas coûter un tirage. Sur le plan gratuit de
Render un serveur au repos met ~30 s à répondre : le Hub prenait ce silence pour
une panne, écartait le jeu, et pouvait finir par ne **rien** trouver à proposer
à un groupe dont tous les jeux étaient parfaitement jouables. Mesuré en
production : les sept serveurs vus « down » en moins d'une seconde.

### Le flux réel, aujourd'hui

    catalogue (data/games.manifest.json, relu sur Pages, cache 5 min)
      → FILTRER   nombre de joueurs, mode local, besoins, veto, durée max
      → PONDÉRER  (1 + 0,5 × ❤️) × récence (0,15 / 0,4 / 0,7 selon l'ancienneté)
      → TIRER     hasard crypto, tout de suite                    ◄── ~90 ms
      → révélation (la caisse met en scène un résultat DÉJÀ décidé)
      → CONTINUER → handoff → la page du jeu s'ouvre et se connecte à SON
        serveur : c'est ce moment-là qui le réveille, et personne d'autre

**Aucun `/health` n'est appelé dans ce chemin.** Ni au clic sur 🎲, ni à la
création de la session (le pré-réveil des sept serveurs a disparu aussi). Le
`onDraw` de `src/hub.js` ne contient plus un seul `await health…` — les deux
occurrences de « health » qui y restent sont des commentaires.

### Ce que la santé est encore

- `pool.health` voyage dans l'état de session, pour **informer** : c'est le
  dernier état connu d'un serveur, et il vaut le plus souvent `unknown`
  puisqu'on n'interroge plus personne à l'avance. Il n'entre **ni dans le
  filtre, ni dans les poids, ni dans le tirage**.
- `src/health.js` reste appelable pour le diagnostic (`check`, `one`, `status`,
  `snapshot`, `markDown`), et reste un simple GET — jamais un WebSocket vers un
  jeu.
- Une seule décision s'appuie encore dessus, et c'est au **LANCEMENT**, pas au
  tirage : si un joueur vient de signaler le serveur injoignable (`abort` avec
  `UNREACHABLE` → `markDown`), le lancement suivant échoue tout de suite en
  `SERVER_DOWN` plutôt que d'envoyer le groupe dans le vide. C'est une
  information fraîche, donnée par un humain, pas une sonde.

### Les erreurs, et ce qu'elles veulent dire

- **`NO_ELIGIBLE_GAME`** : aucun jeu ne passe les RÈGLES. C'est le seul refus
  possible d'un tirage, et il ne parle jamais d'un serveur.
- **`NO_SERVER_AVAILABLE` a été supprimé** du protocole : plus personne ne peut
  l'émettre. Ne pas le réintroduire — ce serait remettre la santé dans le
  tirage.
- ⚠️ Côté client, un code d'erreur **inconnu** n'est plus noyé dans « Le Hub a
  refusé la demande. » : le code est affiché, avec le message du serveur s'il y
  en a un. Sans ça, un serveur plus récent que la page ressemblait à un refus
  banal et n'était pas diagnosticable.

### ⚠️ Ce qu'il ne faut pas « réparer »

Le bloc **« Réveil du serveur… »** (`#hub-waking`, `wakingText`, `showWake`) a
existé quelques heures entre les deux corrections, puis a été retiré : plus rien
ne pose `waking`, et les champs `waking` / `tried` sont sortis de l'état public.
Si l'on veut un jour montrer un réveil, sa place est **l'étape de lancement** —
là où Render se réveille vraiment —, pas le tirage.

### Les tests qui gardent la règle

- `game-hub-server/test-candidat.js` remplace le vérificateur de santé par un
  faux qui **compte les appels** : c'est le compteur qui prouve la règle, pas le
  résultat. Trois serveurs morts → un jeu est tiré quand même, en moins de
  500 ms, sans un seul appel. Si un `await health…` revient dans `onDraw`, c'est
  ce fichier qui le dira.
- `tests/hub.mjs` : un tirage complet contre le vrai Hub n'interroge aucun
  serveur de jeu.
- `tests/hub-draw.mjs`, section « 1 joueur » : le `/health` du Passeur est
  bloqué sur 503 — un serveur aussi mort que possible, et c'est la tête qu'a un
  serveur Render endormi. Mesuré en vrai navigateur : **Passeur seul éligible
  est tiré en ~90 ms**, 0 appel `/health` avant la révélation, la caisse
  l'ouvre, aucun message d'erreur.

**Dernier passage** : `game-hub-server` `npm test` 378/378 ; `tests/hub.mjs` 82,
`tests/hub-draw.mjs` 79 (77 en mouvement réduit), `tests/handoff-play.mjs` 42,
`tests/handoff.mjs` 22, `tests/hub-play.mjs` 45, fichiers générés OK.

## Handoff et présence : l'état des sept jeux

Les sept jeux en ligne (Morpion, Imitation, Demi-Cercle, Ban, Précision, Le
Passeur, Qui Ment ?) ont le **même montage**. Puissance 4, local, n'en a pas
besoin. Aucun serveur de jeu ne connaît le Hub.

### Le handoff, page par page

Chaque page charge `game-profile.js`, `game-net.js`, `game-hub.js` et
`hub-handoff.js`, et appelle `HubHandoff.start({ gameId, join, onUpdate })`.
Sans billet, `lien` vaut `null` et la page marche exactement comme hors Hub.
Avec billet, le module appelle le `join` de la page — son chemin NORMAL (créer
sans code, rejoindre avec) — et la page le prévient :

- `roomReady(code)` à la première room obtenue, **une seule fois** (garde
  `codeDeclare` : un retour au salon après une coupure renvoie le même code) ;
- `started()` par l'hôte à la première vraie phase de jeu ;
- `ended()` à la fin, et un lien **« ↩ Retour au Game Hub »** (`#to-hub`,
  jamais la classe `.back`, réservée au retour portfolio) ;
- `failed('JOIN' | 'UNREACHABLE', détail)` si l'entrée lancée par le Hub
  échoue (`viaHub` et pas encore dans une room). Pour l'hôte déjà au stade
  `join`, `failed` devient `cancel()` : sa room est perdue pour tout le groupe,
  le lancement est annulé (`CANCELLED`) au lieu de laisser le groupe devant une
  room morte jusqu'à l'échéance.

Tant que des joueurs attendus manquent, « Lancer » est bloqué et nomme les
absents, avec **« Lancer sans attendre »** (`#start-anyway`) — la règle propre
à chaque jeu (3 joueurs pour Qui Ment ?…) s'applique en plus.

Les écarts, voulus :
- **Morpion** : aucune identité ne part vers `morpion-server` (voir « Morpion :
  l'exception »). Pas de salon ni de « Lancer » : la room passe d'elle-même à
  `playing` quand l'invité entre, c'est là que l'hôte envoie `started()`. Le
  départ de l'adversaire (« room fermée ») vaut `ended()`. Écran de perte
  propre au jeu (pas de `surPerte`), puisque la room n'existe plus.
- **Qui Ment ?, « Rejouer »** : à la fin la room est en phase `end`, et
  `qui-ment-server` n'accepte `start` QUE depuis le salon — ailleurs il
  l'ignore **sans erreur**. « Rejouer » envoie donc `lobby` (MJ seulement), et
  le `start` ne part qu'au retour du salon diffusé par le serveur. Ne pas
  « simplifier » en renvoyant `start` directement : c'était le bug.
- Une revanche jouée dans la même room (« Rejouer » de Qui Ment ?, du Passeur…)
  **ne parle pas au Hub** : il reste en `debrief` sur le lancement terminé,
  l'historique ne bouge pas, aucune session n'est créée.

### La présence : qui est VRAIMENT là

Un onglet gelé (arrière-plan, écran verrouillé) garde son WebSocket ouvert et
répond au ping natif — c'est le navigateur qui répond, pas la page : un joueur
fantôme. D'où une présence **applicative**.

- **Serveur** : `presence.js`, **le même fichier dans les sept dépôts** (on le
  copie, on ne l'adapte pas). Ping `{ type: 'presence', n }` dès la connexion
  puis toutes les 10 s ; le client répond `{ action: 'presence', n }`. Adhésion
  **volontaire** : un client qui n'a jamais répondu n'est jamais expulsé. Sans
  signe de vie depuis 30 s → `close(4000, 'absent')`, puis `terminate` 3 s plus
  tard. Ping natif séparé (20 s) pour les coupures réseau franches. `hold()`
  donne un sursis (Imitation, pendant l'envoi d'une prise audio). Le module ne
  connaît aucune room : c'est le `close` habituel du serveur qui retire le
  joueur. Le routeur appelle `presence.consume(ws, msg)` en premier.
- **Client** : `games/shared/game-net.js` (`GameNet.create`), même API que
  l'ancien `NET` de chaque jeu. Il répond aux pings (jamais de lui-même),
  émet `lost` une fois par connexion perdue, ne reconnecte **jamais** tout
  seul. Une nouvelle connexion présente la clé de l'ancienne (`remplace`) : le
  serveur ferme l'ancienne AVANT d'acquitter, donc jamais de doublon dans la
  room. `pagehide` ferme en 1000 (le navigateur refuse 1001).
- **Écran de perte** : `GameNet.surPerte(NET, …)` dans six jeux — au salon, un
  retour automatique par le join normal ; en pleine partie, « elle a continué
  sans toi ». Il exige `#lost`, `#lost-text`, `#lost-retry`, `#lost-hub`.

### Les tests qui gardent tout ça

`tests/handoff*.mjs` (un par jeu, vrais Hub + vrai serveur), `game-net.mjs`,
`presence-jeux.mjs`, `presence-precision.mjs`, `presence-morpion.mjs`,
`quiment-replay.mjs`. Détail et options dans `tests/README.md`.
