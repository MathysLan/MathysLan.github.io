# Vidéos de référence

Les clips que les joueurs doivent imiter. Ce dossier fait office de CDN
(GitHub Pages) : le serveur ne connaît que des IDs et des durées.

**La seule source de vérité est `videos.json`, ici même.** Le serveur Render
recharge ce fichier au démarrage puis toutes les 10 minutes : ajouter un clip
ne demande AUCUN redéploiement du serveur.

Ajouter un clip :

1. Dépose le fichier ici, ex. `vid_04.mp4`.
2. Ajoute sa ligne dans `videos.json` : `{ "id": "vid_04", "dur": 14 }`
   (durée en secondes - elle pilote le visionnage ET la fenêtre d'enregistrement).

Contraintes :

- Format : H.264 + AAC dans un conteneur .mp4 (lisible partout). Pas de HEVC.
- Poids : vise 2-5 Mo (10-20 s en 720p). Limite dure GitHub : 100 Mo/fichier.
- La durée déclarée doit coller à la vraie durée du clip, sinon l'enregistrement
  sera coupé trop tôt ou trop tard.
