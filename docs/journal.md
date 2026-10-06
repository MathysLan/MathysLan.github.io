# Journal du projet — historique des lots

Ce fichier garde l'**histoire** : ce qui a été fait, quand, pourquoi, les bugs
trouvés en route et comment on les a diagnostiqués. Les **règles en vigueur**
sont dans `CLAUDE.md` ; quand une règle vient d'un incident, c'est ici qu'on
en trouve le récit.

Format par lot : objectif · résultat · commits · décisions / diagnostics.
Les compteurs de tests sont ceux du moment (les suites ont grandi depuis) ;
`tests/README.md` tient les chiffres actuels. Commits du portfolio sauf mention
`hub:` (dépôt `game-hub-server`).

---

## 2026-07 — Les premiers jeux

`a97a6cc` → `261e135` (commits « Mise à jour » / « Add files via upload »).

- **Demi-Cercle** : mode « le Guide invente » (thème + extrémités, cible
  toujours tirée par le serveur) + légende couleur→joueur chez le Guide pendant
  le vote. Serveur : `onTheme`, `mode` par room, ~28 axes.
- **Imitation** : « réécouter ma prise » relance AUSSI la vidéo (muette) avec le
  double waveform, pour juger la synchro.
- **Le Jeu du Ban** : `ban-server` à part (moteur pur `engine-ban.js`,
  `setTimeout` + filet, catalogue `{id, fatal, startAt?}` surchargeable par
  `VIDEOS_JSON`), front sur `wss://ban-server-68h9.onrender.com` + bucket R2.
  Tests : moteur 26/26, ws e2e 16/16, front e2e 12/12.
- **Précision** : `precision-server` à part (`engine-precision.js` pur +
  `setTimeout` de phase), front sur `wss://precision-server.onrender.com`. Le MJ
  choisit difficulté / manches / épreuve. Tests : moteur 60/60, ws 23/23, front
  59/59.
- Livraison de l'époque (environnement cloud) : `git push` en 403, donc zip
  remis à Mathys.

## 2026-09-14 → 16 — Le portfolio devient une interface TF2

`4cc3e66`, `1be449a`, `c7d46a1`, `9658658`, `1251ec3`, `573f1e0`, `5623940`,
`5a41264`, `19c7aea`, `8e4aaac`, `cac5f3b`, `8ae699e`, `44a1c0d`.

- Objectif : passer d'un *accent* TF2 à une vraie interface VGUI. Le thème
  violet/verre précédent a disparu ; « poursuite de scène », nav allumée et
  grain de pellicule datent du 14 (testé via CDP 10/10).
- Liste de Mathys, faite dans l'ordre : 1 ConTracker ✅, 2 sac à dos + fiche
  d'objet en modale ✅, 3 CTA sur `.tf-btn` ✅, 4 compétences en stats d'arme ✅,
  5 textures de fond ✅, 6 réticule ✅, 7 easter egg du Spy ✅, 8 barre « SIGNAL
  SÉCURISÉ ✓ » ✅ ; le 9 (icônes de nav) était déjà fait.
- Décisions : réticule UNIQUEMENT sur `.tf-btn`, `.bp-cell` et le carousel
  (choix de Mathys). Masque du Spy redessiné deux fois (bandeau d'yeux, sans
  cigarette) ; un SVG de fan du logo de classe proposé par Mathys a été refusé
  comme source, gardé comme référence de proportions. Mis de côté sauf demande :
  switch RED/BLU, sons du jeu, vidéo « Meet the Team ».
- Outils créés : `styleguide.html`, `tests/front.html` (20/20 à l'époque) ; un
  auditeur de contraste jetable (377 nœuds) : 0 échec WCAG AA dans les deux
  thèmes.

## 2026-09-16/17 — Stabilisation / professionnalisation

`dc34834`, `b0889bf`, `5ebe50c`, `9333d8e`, `4cfef2c`, `bbbbd9f`, `2fcf2e7`,
`fa639ff`, `55d9f86`.

- Objectif : rendre le site solide sans toucher à l'identité.
- Résultat : accessibilité (menu mobile, lightbox, palette, carousel), mouvement
  réduit en JS, site lisible sans JS, pré-rendu + Tailwind 3.4.17 compilé (plus
  de CDN ; équivalence vérifiée sur la géométrie des 1031 éléments à 1280/390 px,
  deux thèmes), CI `--check`, SEO, WebP + WOFF2, fiches de projet structurées,
  « Ma part » (`role`) rédigée avec les mots de Mathys pour les 8 projets.

## 2026-09-17 — Passe de finition

`293432b`, puis `1a436b6` (correctif de publication).

- Zéro police externe : Anton et Inter ne changeaient le rendu que de 7 signes
  (`« » ‹ › · … ↓`), mesuré glyphe par glyphe → supprimés. JetBrains Mono et
  Space Grotesk auto-hébergés (variables 400→700, 31 + 22 Ko).
- Favicon SVG Mann Co., socle commun des jeux `game-ui.css`, Morpion aligné
  (`?server=`, `aria-label` des 9 cases, code copiable), échec de copie dit.
- **Incident** : le socle s'est d'abord appelé `games/_shared/`. Jekyll (GitHub
  Pages) ignore tout ce qui commence par `_` : les cinq jeux sont partis en
  production **sans socle** (code de room en gros bouton plein, plus d'anneau de
  focus, plus de mouvement réduit, polices en repli), alors que tout était vert
  en local. → dossier renommé `games/shared/`, et `checkPagesPaths` dans
  `tools/build.mjs`.
- Contraste mesuré et corrigé (auditeur qui compose les couches alpha) : gris
  `#6f6c80` → `#8b87a0` dans 4 jeux (3,59 → 5,30:1) ; blanc sur violet
  `#8b5cf6` → `#7c3aed` (4,23 → 5,70) ; blanc sur rouge `#ef4444` → `#dc2626`
  (3,76 → 4,84) ; `#4a4a52` → `#8a8a94` dans precision (2,24 → 5,74) ;
  `--qi-collectors` `#e87070` → `#ee8080` (4,14 → 4,76) ; billet Bigflo
  `opacity-80` → `-90` (4,11 → 5,18 en Blueprint). `#stop-btn` du Ban gardé
  (grand texte, 3,76 pour 3:1 exigé).
- Décisions : `/data/` reste autorisé dans robots.txt (sans `data/*.js`,
  `PROJECTS is not defined` casse la palette) ; **AVIF non** (225 Ko de WebP,
  ~20-30 % de gain théorique contre un encodeur, du `<picture>` partout et 45
  fichiers de plus).
- Tests créés : `tests/games.html`, `tests/keyboard.mjs`.

## 2026-09-18 — Le Passeur et Qui Ment ?

`c101d23`, `523e04a`, `f3a29d1`.

- Deux jeux multijoueurs, chacun son dépôt serveur ; premiers jeux à porter la
  DA du portfolio. Secrets côté serveur (barème du Passeur au `results`, mot de
  Qui Ment ? jamais diffusé).
- Hub de la section Jeux (`js/gamehub.js`) : caisse « Je joue à quoi ? » et un
  « Trouver une partie » qui était un **faux** matchmaking (annoncé comme tel ;
  point d'extension `buildMatch()`). Retiré le 2026-09-19 (voir randomizer).
- Mise en ligne le jour même : serveurs déployés par Mathys, `status: 'live'`,
  `noindex` retiré, 8 `<loc>` au sitemap. Vérifié par un fumigène qui joue une
  vraie manche sur chaque serveur Render (le health check ne prouve que le
  process) : 10/10 en production.
- Backstage : le poste de volley passe de central à passeur (FR + EN).
- Tests : front 195/194, jeux 146/146, clavier 8/8, passeur-server 28 + 24,
  qui-ment-server 52 + 57, Qui Ment ? à trois dans un navigateur 42/42.

## 2026-09-18 — Le Passeur : du terrain SVG à la vraie situation de volley

`a406e35` (terrain, fausse 3D, mise en situation, jouabilité — un seul commit
pour cinq passes de travail).

1. **Terrain SVG** (après playtest : cinq boutons de texte, trop abstrait).
   `court.js` dessine la `scene` envoyée par le serveur ; repli si elle manque
   (vérifié 34/34 contre la production d'alors). Trois collisions de libellés
   trouvées seulement à l'image. Champ pseudo de 50 px pour un bouton de 40
   (pas de `border-box`, `line-height` hérité).
2. **Fausse 3D** : Three.js écarté (~600 Ko pour une scène fixe) ; une
   projection de six lignes. « 2e main » élargie, zone arrière rallongée (elle
   était tombée à 40 px au téléphone).
3. **Vraie situation de volley** : règles FIVB 2025-2028 dans `rules.js`
   (serveur), modèle de situation déduit, deux temps `round` / `go` tenus par
   le serveur (0 ms d'écart mesuré à 3 joueurs). Les classes d'équipe
   (`sil-us` / `sil-them` / `sil-set`) avaient disparu en réécrivant `paint()` :
   silhouettes en noir, vu seulement à l'image. 6 situations sur 12 ont un
   passeur avant, 6 un passeur arrière.
4. **Boucle de jeu** — ⚠️ **le piège SMIL** : `begin` compte sur la timeline du
   document ; à la 2e manche (document vieux de 4 s) tout était déjà figé sur
   l'état final — mesuré 0 → 7,3 → 17,7 → 20,7 en manche 1, 20,7 d'emblée en
   manche 2. Le service, la réception, le passeur et le bloc ne jouaient
   jamais. Correctif `svg.setCurrentTime(0)`. Aussi : bloc immobile (9
   situations sur 12 avec `start === target`), chrono à 0,43 % de la surface,
   noms de zones jamais affichés (`ZONES[].label`), 2e main reprise via
   `ACTION` / `attackFault()`. Mesuré en e2e : ballon 140 px, passeur 69 px,
   bloc 20 px ; 0/0/0 en mouvement réduit.
5. **Jouabilité réelle** — ⚠️ le serveur **déployé avait deux versions de
   retard** (ni `scene`, ni `introMs`, jamais de `go`) : aucune zone cliquable,
   chrono figé, 5 joueurs, bloc immobile. Correctif côté client (armer sans
   `go`), pas « redéployer ». Aussi : l'ombre du réceptionneur interceptait le
   clic au centre de la zone arrière (`pointer-events: none` sur les couches
   `.c-*`) ; bloc en chemin en L ; 6 joueurs par équipe (FIVB 7.3).
   Test ajouté : `tests/passeur-play.mjs` (vraies entrées, 49/49 local et
   production périmée). Plomberie : `rawKeyDown` sans `text`, `taskkill /T`
   (49 processus msedge fantômes avaient saturé la machine).

## 2026-09-18/19 — Les pages de jeux au propre

`5a12614` (WIP phase 3 Game Hub, qui embarque aussi ces lots).

- **Harmonisation visuelle des 7 jeux** : chrome commun (tf2.css + game-ui.css),
  gameplay et accent propres. Avant : boutons de 40 à 48 px, champs de 40 à 50,
  trois familles de titre, deux fonds, panneaux dans 3 jeux sur 7 ; après :
  40 / 40 partout. Pièges : `:where()` écrasé par `button {}` (avatars devenus
  boutons pleins), Précision qui redéfinissait `--bg`/`--ink`/`--line`/`--card`,
  CSS injecté dans un commentaire par un script d'édition. Jeux 213/208.
- **Précision : plateau écrasé** en bande de **560×45** (ratio 12,5:1) par la
  migration : sélecteur `.card.play-card` orphelin, rembourrage du socle, fond
  et `overflow` perdus. Rien ne manquait dans le DOM. Plateau agrandi au passage
  (1280×900 → 640×768, +31 % d'aire) ; boîtier « appareil de mesure ». Même
  migration : **Morpion avait perdu son panneau** (`class="card"` orpheline).
  Jeux 239/234 ; les 7 tests de géométrie échouent bien sur la bande.
- **Layout des 7 lobbys** : 0 px entre avatars et « Créer » dans 4 jeux
  (`* { margin: 0 }` bat `:where()` — troisième fois que ce piège mord) ; le
  `flex-wrap` du Demi-Cercle séparait « thèmes : » de sa liste. Faux positifs
  écartés : comparer les `top` au lieu des centres ; un `<span class="pts">`
  ajouté par le harnais. Icône 🎙 orpheline → espace insécable. 10 tests
  échouent sur l'état d'avant. Jeux 308/303.

## 2026-09-18/19 — Game Hub, phases 1 et 2 : manifest et profil local

`5a12614`, `48a85f5`.

- **Phase 1, le manifest** : `data/games.manifest.json` généré depuis
  `data/games.js`, schéma fermé validé au build, `tests/manifest.mjs` (71).
- Décisions prises pour le Hub (design review hors dépôt) : pilote **Le
  Passeur** ; navigation **même onglet** (d'où la reprise par `player.id`) ;
  photo au Hub seulement *(remplacé le 2026-09-19 : la PP voyage en jeu, à la
  demande de Mathys)* ; pré-réveil Render au tirage *(abandonné le 2026-09-20)* ;
  public entre amis ; `/games/` remplace le faux randomizer de `js/gamehub.js`.
  Une reprise par `resumeToken` était envisagée ; c'est finalement le même
  `player.id` qui sert (voir CLAUDE.md). Les serveurs tronquaient alors l'avatar
  à 4 caractères (`slice(0, 4)`), d'où l'idée d'une `avatarUrl` servie par le
  Hub, abandonnée au profit de la data-URL dans le `join`.
- **Phase 2, le profil local** : `game-profile.js`, une ligne par jeu
  (`GameProfile.startEmoji`). Pièges : un champ fichier à `width: 1px` occupait
  encore 30×20 px ; `keyboard.mjs` passé de 14 à 18 tabulations pour atteindre
  « ajouter une photo ». Profil 41 + 31.

## 2026-09-19 — La photo de profil voyage, et se voit

`48a85f5` ; serveurs : `avatar.js` dans les six dépôts, poussés sur `main` et
redéployés le 2026-09-19 à la demande de Mathys.

- Contrat `{ kind, emoji, src? }` dans les deux sens, `cleanAvatar()` côté
  serveur, `GameAvatar.slot()` / `fill()` côté client. Borne alignée : le
  profil comptait 24 Ko de texte (~18 Ko d'image) contre 12 Ko annoncés.
- **Incident « [obj »** : front neuf testé contre la production avant que les
  serveurs soient poussés → `String(avatar).slice(0, 4)` sur l'objet diffusé à
  tous, affiché comme emoji. Tous les tests tournaient contre des serveurs
  locaux déjà modifiés. Correctif client (emoji réseau validé) +
  `avatar-play.mjs` rejoue désormais contre le serveur d'avant extrait de git.
  Leçon devenue règle : serveurs d'abord, front ensuite.
- Finition : hiérarchie `sm` / `md` / `lg`, forme Mann Co., `.g-player`.
- Défauts préexistants vus en passant : podium du Demi-Cercle masqué après
  `end` (**corrigé depuis**, `inEndScreen`) ; mutation CRLF de `manifest.mjs`
  (toujours ouvert) ; `passeur-play.mjs --reduced` instable au premier clic
  (toujours ouvert) ; course dans `open()` de 4 harnais serveur (corrigée).

## 2026-09-19 — Game Hub, phase 3 et stabilisation

`48a85f5` ; hub: `7406178`, `4c1784c`.

- `/games/` passe de 404 à l'entrée du Hub : profil → créer / rejoindre →
  salon. Protocole relu dans le serveur, pas deviné. `GameProfile.load()` écrit
  l'id dès la première lecture (avant, chaque lecture d'un profil jamais
  enregistré tirait un nouvel id : reconnexion impossible ; l'ancienne
  assertion de `profile.html` décrivait précisément ce défaut).
- Stabilisation serveur : heartbeat 20 s ; « trois sorties, trois
  comportements » ; avant, un `leave` laissait vivre la session 60 s tant
  qu'un absent y restait. Mesuré : en production une fermeture initiée par le
  client n'est vue qu'au bout de ~10 s (proxy Render).
- Tests : `hub.mjs` 50 local / 49 prod, `hub-play.mjs` 40/40 puis 45,
  `test-presence.js` 23.

## 2026-09-19/20 — Randomizer et handoff du Passeur

`cf0cc4f` ; hub: `1110de2`, `4f676ee`.

- Randomizer : moteur pur filtrer → pondérer → tirer, catalogue relu sur Pages,
  caisse côté page. Le **faux matchmaking** de `js/gamehub.js` est retiré (il
  prétendait trouver un groupe sans serveur) ; la caisse solo reste.
- Handoff pilote Le Passeur : ~50 lignes dans `app.js`, `hub-handoff.js` créé.
  Trois pièges trouvés par les tests : l'hôte qui navigue perdait l'hôte ; une
  session sans connectés se fermait pendant un lancement ; « partie en cours »
  affiché au salon du jeu.
- **Défaut de production** : le Hub déployé voyait les sept serveurs « down »
  en moins d'une seconde (réveil Render de 12 à 22 s) → `NO_ELIGIBLE_GAME` pour
  tout le monde. Premier correctif : réessayer 40 s dans `health.js`. Dépassé
  le lendemain (voir ci-dessous).
- Anneau de focus rogné par `clip-path` sur la page du Hub → box-shadow inset ;
  le même défaut reste dans les jeux au `button` générique (vu sur Imitation).
- Tests : serveur engine 65, draw 57, e2e 26, launch 43, handoff 42 ;
  portfolio hub 77, hub-draw 66/64, handoff 22, handoff-play 42.

## 2026-09-20 — Le tirage ne dépend plus de la santé ; capacités d'office

`b095c4f`, `a442d34`, `be76ee3`, `3fd3404` ; hub: `aca1450`, `b674bc2`,
`c976e7d`.

- Un bloc « Réveil du serveur… » (`#hub-waking`, `wakingText`, `showWake`,
  champs d'état `waking` / `tried`) a vécu quelques heures (`b095c4f`) puis a
  été retiré : plus aucun `/health` dans le tirage, ni
  pré-réveil à la création de session. `NO_SERVER_AVAILABLE` supprimé du
  protocole. Mesuré en navigateur : Passeur seul éligible, `/health` à 503,
  tiré en ~90 ms.
- Code d'erreur inconnu affiché avec son code (`a442d34`).
- L'écran « Ce que tu apportes » (micro, avertissement) est retiré :
  `caps: { mic: true, consent: true }` par défaut. Sans ça, Imitation et le Ban
  auraient été impossibles pour tout le monde. À 3 joueurs : 3 → 5 jeux
  possibles.
- Tests : game-hub-server 378/378 ; hub 82, hub-draw 79/77, handoff-play 42.

## 2026-09-20 → 25 — Handoff et présence dans les sept jeux

`78ca958`, `6dddca4`, `7145351`, `9bde223`, `7d2b21f`, `d11626b`, `7eb89d1`,
`fa51067`, `b65f980`, `db60fec`, `48bc1b3`, `12d9ab5`.

- Handoff branché jeu par jeu, présence applicative (`presence.js` identique
  dans les sept serveurs, `game-net.js` côté client, `GameNet.surPerte`).
- `48bc1b3` : « Rejouer » de Qui Ment ? envoyait `start` en phase `end`, que
  le serveur ignore sans erreur → passe par `lobby`.

## 2026-09-26/27 — Score de soirée

`90d0562`, `92c74f8`, `b4c40a4`, `e64b761`, `660c073`, `ce4c59b`, `084f480`,
`6976b29`, `b20d683`, `1aae85d`, `7493cf8` ; hub: `9832a56`, `d679eab`.

- Contrat `roomReady(code, place)` → `results` → `ended` ; conversion par le
  rang ; validé en production le 2026-09-26. Pilote Le Passeur, puis Imitation,
  Demi-Cercle, Ban, Précision, Qui Ment ?, Morpion. Aucun serveur de jeu touché.
- Défaut de `hub-handoff.js` révélé par le Demi-Cercle : `failed()` remettait
  `joint = false`, et un retardataire refusé entrait en douce dans la room
  revenue au salon. Corrigé (`?v=3`).
- **Défaut de `game-hub-server`** vu avec Précision solo : au `debrief`, une
  session vide était fermée tout de suite ; seul, le joueur perdait sa session
  et son score à chaque partie (Passeur solo aussi, et un groupe revenant d'un
  bloc). Corrigé `d679eab` (`backFromGame`) ; le scénario solo échoue en
  `SESSION_NOT_FOUND` contre le Hub d'avant. Production : sonde solo 4/4,
  trio 5/5.
- Qui Ment ? : ex æquo 1 / 1 / 3 **construit** manche par manche (recherche
  exhaustive des votes), l'intrus étant tiré au hasard.
- Garde-fou statique `tests/hub-score-contract.mjs`.

## 2026-09-27 — Débrief, fin de soirée, lots UX

`d672716`, `25c2455`, `5b1df70`, `b3a7446`, `58f48d9` ; hub: `e9a7a7a`.

- Débrief personnel en quittant ; le bouton a brièvement dit « Terminer ma
  soirée » avant la vraie fin de soirée.
- Fin de soirée : `finish`, état `finished`, podium figé ; révélation locale.
- Lot B (retour de partie) : carte Résultat ; le couvercle de la caisse
  recouvrait « DE LA » (−11 px), marge 1.6rem → 2.9rem.
- Lot A (hiérarchie du salon) : trois blocs frères, `#hub-act`, catalogue
  replié, « Terminer » secondaire.
- Pièges de test : `scrollIntoView` en `'auto'` restait animé et avalait le
  clic suivant ; colonne masquée en solo qui poussait « PRÉC… » ; clic perdu
  pendant un défilement doux (2 sur 2 un jour, 0 sur 6 le lendemain) ; 2 clics
  perdus sur 5 après 390 → 1280 px sans pause.

## 2026-09-28 — Livraison fiable results → ended

`83d48c5`.

- Audit : `send()` jetait en silence sur un socket Hub fermé / CONNECTING,
  `rapporte` et `fini` passaient à `true` quand même, rien n'était rejoué.
  Démontré avant correction (script jetable, 22/22 deux fois) puis par la suite
  définitive : `tests/hub-report.mjs` 21 échecs sur l'ancien code (score `{}`,
  Hub bloqué en `inGame`), `tests/hub-report-play.mjs` bloqué sur « debrief
  jamais reçu ».
- Correctif : attente dans le `sessionStorage` par partie, livraison pilotée
  par l'état du Hub, reprise par `/games/`. Aucun serveur touché.
- Résultat : 59/59 et 19/19, et **19/19 en production** (front local contre le
  vrai Hub et le vrai `morpion-server`). Régressions : contrat 125, hub 82,
  hub-score 80, hub-score-morpion 52, hub-play 56, handoff-play 42.
- Piège de harnais : le WebSocket de Node n'émet pas `close` sur une connexion
  refusée ; les ports 1 / 9 sont bloqués d'office.

## 2026-09-28 — Documentation séparée

`CLAUDE.md` ne garde que l'état actuel et les règles ; ce journal reçoit
l'historique.

## 2026-09-30 — Lot G : profil joueur

- Audit : le profil existait déjà (`game-profile.js` : id local stable, pseudo,
  icône / photo, `sanitize()`), branché sur l'accueil du Hub et les jeux ; le
  serveur reprend nom et avatar à chaque `join`. Aucune seconde source créée.
- Choix de Mathys : dans le salon, le profil se CONSULTE (« 👤 ton profil »,
  panneau en lecture) ; il se modifie à l'accueil, hors session. Aucun
  changement serveur ni protocole.
- Bug démontré puis corrigé : `localStorage` bloqué → chaque `load()` rendait
  un profil neuf, le pseudo tapé était perdu avant « Créer » et le Hub
  refusait d'entrer. Copie de la page, limitée au stockage inaccessible (les
  unitaires de `profile.html` fixent la règle « illisible → neuf »).
- Pseudo nettoyé à la source (`cleanName`) : contrôles, forçages de sens
  (un U+202E retournait « Alice (toi) »), espaces invisibles, emoji jamais
  coupé à la 16e unité.
- Piège de test : `profile.mjs` échouait déjà sur `ea0262f` (« retirer la
  photo ») — son `click()` visait un bouton à y = 573 dans une fenêtre de 450.
  `keyboard.mjs` : 1 échec intermittent sur le Ban (focus sur `#tw-check`),
  1 fois sur 4 ici, 0 sur 2 sur `HEAD` — non traité.

## 2026-09-30 — Lot H : statistiques de joueur

- Audit : aucune persistance dans game-hub-server (sessions en mémoire,
  Render gratuit éphémère, Render Postgres gratuit expire à 30 jours). Arrêt
  avant code, proposition validée par Mathys : Postgres Neon, victoire = 1er
  devant au moins un joueur, un parti compte, clé secrète par profil.
- Serveur d'abord : `stats.js` (pur), `store-pg.js` / `store-memory.js`,
  `stats` annoncé dans created / joined ; contrat Score inchangé ;
  `test-stats.js` 50/50, et le SQL éprouvé sur un vrai moteur Postgres (PGlite
  dans le scratchpad) : agrégats SQL = agrégats JS, champ par champ.
- Front : clé dans le profil (migration = écrite au premier chargement),
  section « 📊 Tes statistiques » dans le panneau. Défaut vu à la capture et
  corrigé : la précision passait avant le libellé (`column-reverse`).
- Incident de poste : pour arrêter PGlite, un `taskkill /IM node.exe` trop
  large a pu tuer d'autres processus node — arrêter par PID désormais.
- Mise en production : sans `DATABASE_URL` le Hub annonce `stats: false` et
  la page le dit ; les stats commencent quand la base Neon est branchée.

## 2026-10-01 — Lot I : records personnels

- Audit : `hub_plays` (rang, classés, derrière, jeu, points de SOIRÉE) et
  l'agrégat SQL `perGame` du lot H donnent déjà, par jeu, parties / solo /
  victoires / podiums / meilleure place. Tous les records demandés s'en
  déduisent : ni table, ni requête, ni persistance de plus. Non retenu : la
  meilleure performance en points du jeu (jamais stockée).
- Serveur d'abord : `records()` dans `stats.js`, attaché par `summarize()` à
  la réponse `stats` (une seule demande). Égalité = tous les jeux à égalité,
  aucun départage. `test-stats.js` 69/69, 75/75 en SQL (PGlite, arrêté par
  PID).
- Front : `readRecords` (liste blanche, `game-hub.js` en `?v=7`), section
  « 🏆 Tes records » sous les statistiques, « meilleure place » par jeu.
  Retouches vues à la capture : en solo, « personne à battre » était dit deux
  fois (note des records réduite à la phrase demandée). Attente de test
  fausse corrigée : les jeux à égalité sont dans l'ordre du résumé (id), pas
  dans l'ordre de jeu.
- À arbitrer par Mathys : la maquette du lot montre « Victoires » et
  « Meilleure place » dans les statistiques ET dans les records (doublon
  visible dans le panneau).

## 2026-10-01 — Lot J : succès

- Conception d'abord (sans code) : audit de `hub_plays` (rang, classés,
  derrière, jeu, soirée, heure ; ni score du jeu, ni hôte, ni rôles), 20
  candidats, pack de 10 validé par Mathys (« Lanterne rouge » retirée), séries
  limitées à la soirée, Touche-à-tout à 5 jeux, nuit 00:00–04:59:59 Paris.
- Exigence « succès débloqué » façon Steam : le système dérivé ne suffisait pas
  (premier déblocage sûr, « déjà notifié » à travers rechargement / autre
  onglet / redémarrage). Table `hub_achievements` proposée, puis validée avec
  `draw_id` et `notified_at` ; succès d'avant le lot inscrits sans
  notification ; notification sur `/games/` seulement.
- Serveur : `achievements.js` (rejeu pur), table + rattrapage silencieux dans
  la transaction de création, `auRetour` à chaque entrée vérifiée. Défaut
  trouvé par le passage SQL : le nettoyage de la base de TEST de
  `test-stats.js` supprimait `hub_players` avant `hub_achievements` (clé
  étrangère) — corrigé dans le test (la production ne supprime rien).
- Front : notifications en file, accusé à l'affichage, garde-fou local,
  attente sous une fenêtre ouverte. Attentes de test corrigées en route (code
  de session par onglet, mesure pendant la glissade, `pointer: coarse` sans
  émulation tactile, `.01ms` du mouvement réduit). `hub-page.js` passe à
  `?v=16` (il n'avait pas été relevé au lot I).
- Régression large (game-hub.js et l'entrée au Hub ont changé) : tout vert.
  Deux attentes de `hub-stats.mjs` ajustées à la nouvelle section (compteur
  « 0/10 » et annonce). Les `handoff-*` de Ban, Demi-Cercle, Imitation,
  Morpion et Précision ont d'abord échoué faute de `node_modules` dans ces
  serveurs : relancés avec `NODE_PATH` (game-hub-server), verts.

## 2026-10-01 — Micro-lot UI : profil compact

- Constat mesuré (profil rempli, 6 jeux, 5 succès) : `#profile-dialog` figé
  à 440 px partout, 1 866 px de contenu à 1280 px (2,1 écrans), « Fermer »
  hors écran, par jeu et succès sur une colonne ; 2 157 px à 390 px.
- CSS seulement (`games/index.html`) : tableau de bord à partir de 720 px
  (jusqu'à 980 px, `grid-template-areas`), « Fermer » collant. Après : 1 092 px
  à 1280 px (−41 %), profil vide sans défilement dès 768 px, « Fermer »
  toujours visible ; 390 px inchangé (une colonne). Retouches vues à la
  capture : trou entre les textes de l'en-tête (hauteur de l'identité
  reportée sur la dernière ligne), « meilleure place » orpheline sur 3
  colonnes (par jeu ramené à 2).
- `hub-stats.mjs` : l'attente « 4 colonnes au-dessus de 561 px » devient
  « 4 entre 561 et 719 px, 2 × 2 ailleurs », et la disposition est mesurée
  (contre-épreuve sur l'ancien CSS : 7 échecs).

## 2026-10-01 — Lot K : profils publics des joueurs

- Audit : les player.id circulent dans l'état de chaque session ; la seule
  preuve d'identité est la clé, vérifiée PAR SESSION (`verifies(session)`,
  jamais retirée au départ) ; `session.departed` garde nom et avatar.
- Choix : une action `public-profile { playerId }` (cible désignée par l'état
  de session), servie seulement si la cible est dans la session du demandeur
  ET que sa clé y a été vérifiée — sinon entrer avec l'id d'Alice suffirait.
  `NOT_FOUND` identique pour un id inventé et une autre soirée. Annoncée par
  `profiles` dans created / joined. Lecture seule.
- Front : le même panneau en mode public (`fiche`), boutons « 👤 Profil »
  gardés d'un rendu à l'autre. Défaut trouvé par le test : quand le joueur
  consulté part, son bouton disparaît et le focus restait dans le panneau
  fermé — corrigé (retour à « ton profil »), prouvé par le test qui échouait.
  Attentes de test corrigées en route (Entrée native par CDP, majuscules CSS
  dans `innerText`) ; `drawId: null` retiré des succès publics à la relecture.

## 2026-10-05 — Roquette Party : les armes (skins), contrat puis Pétoire

- Conception (micro-lots 0 et 0.5, sans code) : cinq armes imaginées, V1 =
  Pétoire de Secours, Marmite, Disrupteur. Contrat : un id FERMÉ par joueur,
  choisi au salon (le seul écran commun au jeu seul et au Hub, dont le
  handoff saute l'accueil), préférence `localStorage` `roquette_skin`, arme
  montrée = celle du joueur VISÉ.
- Serveur (`roquette-server` `8b7d01a`) : `skin` dans join / lobby /
  countdown, action `skin` au salon seulement, relayée en message léger
  (renvoyer `lobby` aurait fait repartir les photos de profil à chaque clic),
  4 changements/s, tout le reste ignoré en silence. 403 tests, mutations
  vérifiées. Un KO intermittent de `roquette-play.mjs` (téléphone clavier
  ouvert, `scrollY 101`) vu avec le front d'AVANT : antérieur au lot.
- Front : sélecteur (`.avatar-pick` du socle ; le gestionnaire des avatars
  visait TOUS les `.avatar-pick` de la page, restreint à `#avatar-row`),
  table `Rocket.SKINS`, Pétoire (cartouche rouge, culot de laiton, feu à
  l'avant, pochoir « PAS UN JOUET », traînée rose en vol, étincelles aux
  crans 2-3, prise de feu de la carte avant l'étoile commune, sons `fusee` /
  `crepitement`). Vue à la capture : trop petite à 140 px → dessin agrandi
  de 25 % (nez gardé à +60, trait compensé) ; « Alice (toi) » coupé par
  l'étiquette d'arme → liste du salon à 640 px.
- Pièges : un dégradé SVG dont la première définition (même id) est dans un
  sous-arbre `display: none` ne s'affiche pas → id préfixés par dessin ; la
  largeur en jeu suit aussi la bannière, on ne la compare pas entre tours ;
  la dernière explosion arrive avec `end`, qui coupe son vol (déjà le cas).

## 2026-10-05 — Pétoire : l'arme et son projectile séparés

- Retour de Mathys : la Pétoire était dessinée comme le projectile lui-même.
  Refaite en ARME (petit pistolet de détresse : canon rouge, bouche de
  laiton, carcasse d'acier, crosse de carton rouge, pansement en croix sur le
  canon) + PROJECTILE (fusée éclairante chargée, tête qui brûle avec le
  danger, flamme arrière et traînée rose-orange en vol). Deux calques
  distincts ; `tirer()` ne fait voler que le projectile, dans le minutage de
  la roquette (impact au même instant, mesuré : ~800-850 ms après `boom`
  pour les deux).
- Vu à la capture : le pontet dessiné en forme pleine devenait une tache
  (l'encre bouchait le trou) → trait ouvert ; le pistolet visait à gauche
  crosse en l'air → retourné (`.is-gauche`, propriété `scale`, qui ne se bat
  pas avec les `transform` animés). Roquette inchangée (dessin identique
  octet pour octet, `boom()` + une ligne d'aiguillage).

## 2026-10-05 — Règle de fidélité TF2 ; la Pétoire devient le Scorch Shot

- Nouvelle règle de DA des armes : fidélité TF2 > originalité > blague, une
  référence unique par arme, dossier de référence validé avant le code, dessin
  maison sans asset Valve. Dossier du Scorch Shot : rendus du wiki mesurés
  (planches 3D en profil pur, couleurs échantillonnées), puis le projectile
  relevé image par image dans 4 vidéos (dont « Meet the Pyro », seule vue de
  profil) : en vol, tête incandescente devant un corps sombre, fumée rouge,
  pas de flamme en langue.
- Pétoire refaite : pistolet gris à bouche orange déchiquetée, poignée avant
  côtelée, petite crosse inclinée ; fusée invisible chargée, éclair + gerbe +
  bouffée rouge + recul qui relève le canon au tir, tête lumineuse devant en
  vol, impact à rayons puis boule rouge, puis l'étoile commune. Le drapeau
  `feu` devient `couche` (classe de la couche d'impact).
- Vu au rendu : carcasse et crosse rendues en noir — la Pétoire réutilisait
  les noms de dégradés de la roquette (`acier`, `chaleur`, `flou`) sous le
  même préfixe ; noms propres `sc-…`. Roquette inchangée (empreinte du dessin).

## 2026-10-05 — Deuxième arme : le Grenade Launcher (`marmite`)

- Dossier de référence d'abord (artifact « Dossier Grenade Launcher ») : profil
  du modèle 3D du wiki mesuré colonne par colonne, grenade mesurée de profil,
  puis tir, vol et impact relevés image par image dans 4 vidéos (démo du wiki
  à 60 i/s, « Meet the Demoman », un ralenti Replay, du gameplay à 60 i/s). À
  retenir : la grenade CULBUTE en vol (jamais ogive en avant), halo rouge,
  fine traînée rouge continue ; l'explosion est la standard de TF2, donc rien
  de propre à l'arme à l'impact. Écarté en route : les « grenades » de Meet
  the Demoman à 24 s étaient les roquettes du Soldier.
- Serveur d'abord (`roquette-server` `a1790ef`) : `marmite` entre dans la
  liste fermée `SKINS`, rien d'autre ne change ; son test d'id inconnu passe à
  `disrupteur`.
- Front : arme et grenade sur deux calques (montage de la Pétoire), canon de
  17 u — le plafond calculé pour que le talon tienne dans EMPRISE est 17,5 u,
  on ne déforme rien. La culbute est une animation CSS du seul groupe de la
  grenade, démarrée 70 ms après le tir (sinon ses bouts dépassaient du canon
  avant la sortie). Le recul devient un champ de la table (`recul`), la
  Pétoire garde le sien à l'identique. Nom affiché provisoire choisi par
  Mathys : « Le Grenade Launcher ».
- Vu à la capture : les vues du Grenade Launcher manquaient dans `--shots` —
  son explosion arrivait avant que le guetteur ne démarre (il attendait
  d'abord la Pétoire) ; un seul guetteur pour toutes les captures.

## 2026-10-06 — Troisième arme : le Huntsman (`huntsman`)

- Dossier de référence d'abord (artifact « Dossier Huntsman », validé) : cinq
  candidats notés (Huntsman 8,7, Loose Cannon en réserve), puis l'arc et la
  flèche mesurés sur les planches 3D du wiki (profil au pixel, 0,58 u/px),
  couleurs relevées, silhouette testée à 38 et 83 px. Pas de vidéo (YouTube a
  demandé une vérification anti-robot) : tout le MOUVEMENT repose sur le texte
  du wiki et des images fixes — réserves acceptées.
- Serveur d'abord (`roquette-server` `6c99ec5`) : `huntsman` entre dans la
  liste fermée `SKINS`, rien d'autre ne change (57/57 à `test-skin.js`).
- Front : l'arc tracé en courbes de Catmull-Rom par les points relevés
  (bords dos et ventre, rangée par rangée), comparé à l'œil au masque du
  dossier superposé en rouge : il colle. Embouts et ruban découpés dans le
  corps (`clipPath`), corde en polyligne recalculée par `rocket.js`. Un seul
  écart au montage des armes à projectile : la flèche est VISIBLE encochée.
  Le danger devient la tension de la corde (0 / 12 / 33 / 60 u) ; la bande
  complète est arrêtée pointe contre le dos de la poignée (60 u, pointe
  visible) plutôt qu'aux ~68 u estimés. Impact : une couche « flèche
  plantée » orientée dans l'axe du tir, puis l'étoile commune.
- Vu à la capture : le contour de 5 noircissait l'arc aux petites tailles et
  dans l'aperçu du salon → 3,6 ; l'aperçu (arc plus haut que la boîte)
  débordait sur le nom → × 0,74. En vol, la flèche gardait la lueur rouge du
  verrouillage (règle commune `.is-locked .r-svg`) → retirée de la flèche en
  vol, test ajouté.
- Vu au test : la portée par boîte englobante surestime une corde tendue (le
  coin de sa boîte est à ~129 u alors qu'aucun trait ne dépasse 104 u) →
  mesure point par point (`getPointAtLength` + `getScreenCTM`, contrôlée sur
  la boîte du corps), et contre le vrai `fit()` avec un obstacle.
- `roquette-play.mjs` : le Tab du salon s'arrêtait avant « Lancer » (6 Tab
  comptés pour 3 armes) → avance jusqu'à « Lancer ». Son échec intermittent
  connu (« clavier ouvert … carte visée ») s'est reproduit sur le code d'avant.
- Contre-épreuves : arc qui vole entier → 3 échecs ; flèche qui culbute → 3 ;
  traînée ajoutée → 3.

## 2026-10-06 — `roquette-play.mjs` : l'échec « clavier ouvert … carte visée »

- Cause : le TEST, pas le jeu. Au `focus()` du champ (téléphone, 430 px), le
  navigateur amène le champ à l'écran en défilement DOUX (`scroll-behavior`
  du socle) : il part 250 à 500 ms après le focus, descend jusqu'en bas
  (`scrollY` 260), puis `cadrer()` remonte au `scrollend` (`scrollY` 13).
  L'ancien `sleep(500)` mesurait parfois pendant ce va-et-vient : géométrie
  identique, `scrollY` « au hasard » (0, 13, 101…), carte du haut hors écran.
  Hasard en plus : le défilement n'a lieu que si le champ n'avait pas déjà le
  focus, donc seulement quand B n'avait été visé dans aucun des 6 tours.
- Relevé image par image (Chromium Linux) : `scrollY` 0 → 260 → 13 entre
  ~260 et ~700 ms après le focus selon le passage.
- Correctif (test seul) : champ rendu au repos avant le cas (toujours le même
  parcours), puis attente d'au moins 1,2 s et de 400 ms sans aucun `scroll`
  (plafond 5 s) au lieu du délai fixe.
- Preuves : ancienne attente (champ au repos) → 1 échec sur 6, même
  signature (`arene` 364 × 293, `scrollY 260`) ; nouvelle → 6 sur 6 verts,
  `--reduced` vert ; mutation « plus de recadrage au `scrollend` » dans
  `app.js` → le cas échoue (2 sur 2), donc l'attente ne masque pas un vrai
  défaut.
## 2026-10-06 — Imitation : un votant parti n'est plus attendu

- Vérification du vote de bout en bout (front `renderVoteWait` du 26/09 et
  message `rated { ids, owner }` d'imitation-server, tous deux sur main) :
  `hub-score-imitation.mjs` 27/27, tests d'imitation-server verts.
- Défaut trouvé à la lecture : « on attend … » n'était recalculé qu'à chaque
  `rated`. Un votant qui quittait la partie pendant le vote restait nommé
  jusqu'au vote suivant. Correctif : `renderVoteWait` garde les derniers votes
  (`lastVote`) et l'état `room` redessine la ligne. `app.js?v=4`.
- Preuve : `tests/imitation-vote.mjs` échoue sur l'ancien code (2 KO : le
  partant toujours nommé chez les deux restants), passe avec le correctif.

## 2026-10-06 — Faux Témoin, lots 2 et 3 (page, puis Game Hub)

- Lot 2 (PR #4, fusionnée) : `games/temoin/` contre `temoin-server` (Render).
  `tests/temoin-partie.mjs` a attrapé deux défauts : au téléphone, la photo du
  flash (3 s) était sous les 12 cartes (passée devant le tapissage pendant le
  flash, sous 980 px) ; `--g-accent-ink` valait l'ENCRE étrange (texte sur fond
  sombre) au lieu d'une encre foncée : boutons pleins orange sur orange (2,2:1).
- Lot 3 : Faux Témoin au manifest (2 à 16, 4–6 min, `deduction` + `bluff`),
  helper `rangs()` comme Croq.ios, `tests/handoff-temoin.mjs` (56 vérifications,
  vrai Hub + vrai serveur). Défaut trouvé : en mode Hub, « Revanche (hors
  score) » réduite à côté d'un « Retour au salon » pleine taille, rangée
  décalée (contre-épreuve : 5,6 px d'écart de centre).
- Le même jour, Mathys déclare le gameplay de Faux Témoin PROTOTYPE et demande
  une refonte (game design d'abord, pas de Hub). PR #5 était déjà fusionnée :
  Faux Témoin passe en `hub: false` (hors tirage, page toujours jouable),
  `handoff-temoin.mjs` retiré, `hub-score-contract.mjs` vérifie son absence du
  manifest. Direction proposée : « l'Interrogatoire » (doc de game design).

## 2026-10-06 — Faux Témoin, « l'Interrogatoire » (lots A et B)

- Recherche documentée sur 9 jeux de référence (règles publiées), passe de
  game design validée par Mathys : SCÈNE → INTERROGATOIRE VOCAL → DÉBAT →
  VOTE → DERNIÈRE CHANCE → RÉVÉLATION. Questions sans bonne réponse (du
  bluff, pas un quiz de mémoire), flash réglable 5/8/10 s.
- Lot A (`temoin-server` PR #1) : nouveau moteur et protocole, 3 à 16 joueurs.
- Lot B (cette PR) : page réécrite (`scene.js` dessine les 6 lieux en SVG
  maison, `suspects.js` retiré), `tests/temoin-partie.mjs` réécrit (vraie
  partie à 4, 86 vérifications). Défaut attrapé par le test : les dessins de
  la révélation restaient dans le panneau caché à la manche suivante (le
  Faux Témoin avait encore la vraie scène de la manche d'avant dans son DOM) ;
  vidés à chaque `round`.
