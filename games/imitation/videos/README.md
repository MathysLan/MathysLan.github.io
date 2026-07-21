# Vidéos de référence

Les clips que les joueurs doivent imiter. Ce dossier fait office de CDN
(GitHub Pages) : le serveur ne connaît que les IDs, jamais les fichiers.

Règles :

- Nom du fichier = ID déclaré dans `src/videos.js` du repo `imitation-server`,
  ex. `vid_01.mp4` ↔ `{ id: 'vid_01', dur: 10 }` (durée en secondes, elle pilote
  le timer de la phase « watching »).
- Format : H.264 + AAC dans un conteneur .mp4 (lisible partout). Pas de HEVC.
- Poids : vise 2-5 Mo (10-20 s en 720p). Limite dure GitHub : 100 Mo/fichier.

Ajouter un clip = déposer le .mp4 ici + une ligne dans `videos.js` côté serveur.
