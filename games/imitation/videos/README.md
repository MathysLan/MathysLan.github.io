# Vidéos de référence

Les clips que les joueurs doivent imiter. Ce dossier fait office de CDN
(GitHub Pages) : le serveur ne connaît que des IDs.

**La seule source de vérité est `videos.json`, ici même.** Le serveur Render
recharge ce fichier au démarrage puis toutes les 10 minutes : ajouter un clip
ne demande AUCUN redéploiement du serveur.

Ajouter un clip :

1. Dépose le fichier ici, ex. `vid_04.mp4`.
2. Ajoute sa ligne dans `videos.json` : `{ "id": "vid_04" }`.

C'est tout - plus besoin de durée : la fin du clip coupe l'enregistrement
toute seule, et c'est le host qui fait avancer les phases.

Contraintes :

- Format : H.264 + AAC dans un conteneur .mp4 (lisible partout). Pas de HEVC.
- Poids : vise 2-5 Mo (10-20 s en 720p). Limite dure GitHub : 100 Mo/fichier.

## Hébergement externe (Cloudflare R2, etc.)

Chaque entrée de `videos.json` accepte un champ `url` optionnel :

```json
{ "id": "vid_04", "url": "https://pub-xxxx.r2.dev/vid_04.mp4" }
```

⚠️ Important : le waveform analyse le son de la vidéo via Web Audio, ce qui
impose du CORS propre sur l'hébergeur externe. Sur R2, configure les règles
CORS du bucket avec `Access-Control-Allow-Origin: https://mathyslan.github.io`
(méthode GET). Sans ça, la vidéo refusera de se charger (l'attribut
`crossorigin` est posé exprès pour échouer bruyamment plutôt que de jouer
sans waveform).
