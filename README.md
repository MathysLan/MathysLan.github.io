<div align="center">

# Mathys Langiny — Portfolio

**Data & administration de bases de données** · Reims, France

[![Live](https://img.shields.io/badge/live-mathyslan.github.io-8b5cf6?style=flat-square)](https://mathyslan.github.io)
[![Vibecodé avec Claude](https://img.shields.io/badge/vibecodé%20avec-Claude-34d399?style=flat-square)](https://claude.com/claude-code)
[![Vanilla JS](https://img.shields.io/badge/stack-Vanilla%20JS-f59e0b?style=flat-square)](#stack-technique)

</div>

---

## C'est quoi

Mon portfolio. Pas une vitrine marketing : un endroit pour **exposer ce que je construis** —
mes projets data, et des **jeux web jouables directement dans le navigateur**.

Je suis spécialisé Data / Admin BDD, pas « dev » générique. Ma ligne : on protège la donnée,
on automatise ce qui doit l'être, et on dit non aux usines à gaz. Le portfolio suit la même
règle — tout est en **JavaScript natif**, sans framework lourd, hébergé sur GitHub Pages.

👉 **[mathyslan.github.io](https://mathyslan.github.io)**

## Ce qu'on y trouve

- **Projets** — data (radars & accidents, analyse d'influence Bluesky × GTA VI), dev web,
  algo, entrepreneuriat. Galerie de captures pour chacun.
- **Jeux web** — un carousel de jeux jouables en ligne, sans install ni compte :
  - **Morpion** — multijoueur temps réel (le « Hello World » du réseau)
  - **Imitation** — party game vocal : regarde un extrait, imite le son au micro, note les autres
  - **Puissance 4** — solo contre un bot, en canvas (aussi caché derrière un easter egg)
- **Parcours, engagement associatif, passions** — le reste de l'histoire.

## Les jeux : l'architecture

Même principe pour tous les jeux multijoueurs, et c'est le point que je tiens :
**le front ne calcule rien, le serveur est la seule autorité.**

```
  Front statique (ce repo, GitHub Pages)         Serveur arbitre (repo séparé, Render)
  ┌─────────────────────────────┐   WebSocket   ┌──────────────────────────────┐
  │  games/<jeu>/                │ ◀───────────▶ │  engine.js  (règles pures)   │
  │  affiche l'état, envoie      │   intentions  │  server.js  (rooms + états)  │
  │  des intentions              │    + états    │  valide TOUT, RAM only       │
  └─────────────────────────────┘               └──────────────────────────────┘
```

- Le client envoie des **intentions** (`{ action: 'play', index }`), jamais des résultats.
- Le serveur **valide tout** (case vide, bon tour, victoire…) dans un moteur pur et testable.
- Pour *Imitation*, les enregistrements vocaux transitent en **binaire** sur le WebSocket,
  vivent **en RAM le temps du round**, puis sont purgés. Les vidéos de référence sont sur
  **Cloudflare R2**, jamais servies par le serveur Node.

Les serveurs vivent dans leurs propres dépôts (`morpion-server`, `imitation-server`) —
GitHub Pages ne fait que du statique.

## Stack technique

| Côté | Techno |
|------|--------|
| Front | JavaScript natif, Tailwind (CDN), Canvas, Web Audio, MediaRecorder |
| Temps réel | WebSocket (`ws`), serveurs Node.js arbitres |
| Hébergement | GitHub Pages (front), Render (serveurs), Cloudflare R2 (vidéos) |
| i18n | FR / EN maison, sans dépendance |

## Structure du repo

```
├── index.html          page unique du portfolio
├── 404.html            page d'erreur façon session SQL*Plus (ORA-00942)
├── css/style.css       thème « studio / scène », clair & sombre
├── data/
│   ├── projects.js     les projets (ajouter = un objet)
│   └── games.js        les jeux du carousel (ajouter = un objet)
├── js/
│   ├── main.js         rendu projets + interactions globales
│   ├── carousel.js     carousel des jeux
│   ├── i18n.js         dictionnaire FR / EN
│   ├── palette.js      command palette (Ctrl/Cmd + K)
│   ├── connect4.js     Puissance 4 (canvas)
│   ├── easter.js       Konami code + secrets console
│   └── …
└── games/
    ├── morpion/        client du morpion multijoueur
    └── imitation/      client du jeu d'imitation
```

## Lancer en local

Aucune étape de build — c'est du statique.

```bash
# n'importe quel serveur statique fait l'affaire
python3 -m http.server 8000
# puis http://localhost:8000
```

Pour jouer aux jeux multijoueurs en local, il faut lancer le serveur correspondant
(voir le README de `morpion-server` / `imitation-server`) et pointer `WS_URL` dessus.

## Petits secrets

- `Ctrl` / `Cmd` + `K` → une command palette pour naviguer partout
- Le vieux code des salles d'arcade (↑↑↓↓←→←→ B A) débloque quelque chose
- La console développeur (`F12`) cache une requête SQL

## Vibecodé avec Claude

Ce portfolio — et les serveurs de jeux qui vont avec — a été **conçu et codé en binôme avec
[Claude](https://claude.com/claude-code)** (Claude Code), à partir de mes idées, mes specs et
mes retours. Les décisions d'architecture (server-authoritative, RAM only, R2 comme CDN,
zéro usine à gaz) sont les miennes ; Claude a tenu le clavier et testé chaque étape. Je l'assume :
c'est comme ça que je bosse — je pilote, j'optimise, je vérifie que ça tourne.

## Contact

[mathys.langiny@gmail.com](mailto:mathys.langiny@gmail.com) ·
[LinkedIn](https://www.linkedin.com/in/mathys-langiny) ·
[GitHub](https://github.com/MathysLan) ·
[Twitch](https://www.twitch.tv/nimu_08)
