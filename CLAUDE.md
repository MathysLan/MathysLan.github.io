# Portfolio Mathys Langiny — notes d'architecture (à lire en premier)

Ce fichier existe pour qu'une **nouvelle conversation reparte avec le bon
contexte**. Si tu débarques : lis-le en entier avant de toucher quoi que ce soit.

## Le principe de base : front statique + serveurs séparés

- **Le portfolio** (`mathyslan.github.io`) est un site **statique** : HTML +
  Vanilla JS + Tailwind (CDN). Hébergé sur **GitHub Pages**. Aucun build, aucun
  framework. Pas de logique de jeu ici.
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
| **Puissance 4** | `games/` + `launchConnect4` | serveur dédié | lancé via bouton du carousel. |

Le **carousel des jeux** (`js/carousel.js`) est un coverflow 3D ; le drag ne
démarre qu'après un seuil de 6 px pour que le lien « Jouer » reste cliquable.

## Contraintes de l'environnement de dev (IMPORTANT)

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
  été foncés pour tenir 4.5:1 sur la tache la plus sombre. Puis polish : 6 réticule SVG, 7 easter egg (sur
  `js/easter.js`), 8 barre « SIGNAL SÉCURISÉ ✓ » du guichet. Le 9 (icônes de
  nav) était déjà fait. Règle : aucun asset Valve (images, sons, voix), tout
  est refait en CSS/SVG. Mis de côté sauf demande : switch RED/BLU, sons du
  jeu, vidéo « Meet the Team ». Les textes écrits à la place de Mathys
  (objectifs, stats) lui sont soumis avant publication.
- **Précision** (nouveau) : back `precision-server` livré à part
  (`engine-precision.js` pur + `server.js` avec les setTimeout de phase), front
  `games/precision/` sur `wss://precision-server.onrender.com`. Le MJ choisit
  difficulté / manches / épreuve. Testé : moteur 60/60, ws e2e 23/23, front
  e2e 59/59.
