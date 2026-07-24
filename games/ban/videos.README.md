# Catalogue du Jeu du Ban — `videos.json`

Le serveur (`ban-server` sur Render) **lit ce fichier** depuis
`https://mathyslan.github.io/games/ban/videos.json` au démarrage **et à chaque
partie** (cache de 10 s). Donc pour ajouter/modifier une vidéo :

1. Uploade le fichier sur ton bucket R2, nommé **`<id>.mp4`** à la racine
   (ex : `vid_01.mp4` → `https://pub-427c946793104d1f8e39fbf6d5584ba9.r2.dev/vid_01.mp4`).
2. Ajoute une ligne ici, puis **push** (déploiement Pages habituel).
3. C'est tout — pas de redeploy Render, la prochaine partie prend la nouvelle liste.

## Format

```json
[
  { "id": "vid_01", "fatal": 6.40, "startAt": 0 }
]
```

- **`id`** — sert à nommer le fichier (`<id>.mp4`) sur R2. Le front construit
  l'URL à partir de là.
- **`fatal`** — l'instant EXACT où le mot interdit **commence**, en secondes
  (décimales OK). Pour le trouver : ouvre la vidéo, mets pause juste avant le
  mot, et en console : `document.querySelector('video').currentTime`.
- **`startAt`** *(optionnel, défaut 0)* — le « run-up » : au tour de chaque
  joueur, la vidéo repart de là. Mets-le quelques secondes avant `fatal` pour
  des passages courts et tendus.

## ⚠️ Note

Ce fichier est **public** (GitHub Pages) : le `fatal` est donc lisible par tout
le monde. C'est un choix assumé pour la simplicité (édition dans le repo, pas de
redeploy). L'anti-triche serveur (ton temps d'arrêt est recoupé à l'horloge du
serveur) reste actif quoi qu'il arrive : on ne peut pas **envoyer** un faux
temps, même en connaissant le `fatal`.
