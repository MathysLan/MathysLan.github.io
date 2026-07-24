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
