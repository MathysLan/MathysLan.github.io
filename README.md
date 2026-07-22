<div align="center">

# Mathys Langiny — Portfolio

**Data & Administration de bases de données** · Reims, France

[![Live](https://img.shields.io/badge/live-mathyslan.github.io-8b5cf6?style=flat-square)](https://mathyslan.github.io)
[![Vibecodé avec Claude](https://img.shields.io/badge/vibecodé%20avec-Claude-34d399?style=flat-square)](https://claude.com/claude-code)
[![Vanilla JS](https://img.shields.io/badge/stack-Vanilla%20JS-f59e0b?style=flat-square)](#stack-technique)

</div>

---

## C'est quoi

Mon portfolio. Pas une vitrine marketing remplie de buzzwords : un endroit direct pour **exposer ce que je construis au quotidien**, de mes projets data à mes serveurs de jeux web.

Je suis spécialisé en Data et Administration BDD chez AgiLab. Ma ligne de conduite est simple : on protège la donnée, on automatise tout ce qui doit l'être, et on dit catégoriquement non aux usines à gaz. Ce site applique exactement la même philosophie : du **JavaScript natif (Vanilla JS)**, aucun framework lourd, et un hébergement léger sur GitHub Pages.

👉 **[mathyslan.github.io](https://mathyslan.github.io)**

## Ce qu'on y trouve

### 01. Projets
De la data pure à l'analyse de réseaux (radars & accidents de la route, analyse d'influence Bluesky × GTA VI), du dev web, de l'automatisation et de l'outillage. Chaque projet vient avec sa galerie de captures et des explications concrètes.

### 02. Jeux web
Un carrousel de jeux jouables directement dans le navigateur, sans installation, sans compte et sans pub.
1. **Morpion** : le « Hello World » du réseau, en multijoueur temps réel.
2. **Imitation** : un party game vocal où on regarde un extrait vidéo, on imite le son au micro, et la room vote pour la pire prestation.
3. **Puissance 4** : moteur en Canvas jouable en solo contre un bot ou débloquable via un easter egg.

### 03. Parcours & Backstage
Mon parcours pro (stage, alternance, CDI chez AgiLab), mes 10 ans de karaté full contact (vice-champion de France), le volley au SUAPS (central au contre), la régie stream maison et la fosse en concert de rap.

## L'architecture des jeux

Le principe absolu sur tous les jeux multijoueurs : **le front-end ne calcule rien, le serveur est la seule autorité.**

```
  Front statique (ce repo, GitHub Pages)         Serveur arbitre (repo séparé, Render)
  ┌─────────────────────────────┐   WebSocket   ┌──────────────────────────────┐
  │  games/<jeu>/                │ ◀───────────▶ │  engine.js  (règles pures)   │
  │  affiche l'état, envoie      │   intentions  │  server.js  (rooms + états)  │
  │  des intentions              │    + états    │  valide TOUT, RAM unique     │
  └─────────────────────────────┘               └──────────────────────────────┘
```

Le client envoie uniquement des intentions (`{ action: 'play', index }`). Le serveur valide tout dans un moteur isolé et pur (`engine.js`). 

Pour le jeu *Imitation*, les flux vocaux transitent en binaire via WebSocket, restent stockés temporairement en RAM le temps du round, puis sont purgés (`takes.clear()`) pour garantir zéro fuite mémoire. Les vidéos de référence sont hébergées sur **Cloudflare R2** et ne pèsent jamais sur le serveur Node.

Les serveurs vivent dans leurs propres dépôts (`morpion-server`, `imitation-server`) hébergés sur Render.

## Stack technique

| Côté | Technos utilisées |
|------|-------------------|
| Front-end | Vanilla JS, Tailwind (CDN), Canvas, Web Audio API, MediaRecorder |
| Temps réel | WebSocket (`ws`), Node.js (moteurs de jeu purs) |
| Stockage & CDN | GitHub Pages (front), Render (serveurs arbitres), Cloudflare R2 (vidéos) |
| Internationalisation | Dictionnaire i18n FR/EN natif sans dépendance externe |

## Structure du repo

```
├── index.html          page unique du portfolio
├── 404.html            page d'erreur façon session SQL*Plus (ORA-00942)
├── css/style.css       thème « studio / scène », clair & sombre
├── data/
│   ├── projects.js     les projets
│   ├── games.js        les jeux du carrousel
│   └── favgames.js     mes jeux vidéo préférés
├── js/
│   ├── main.js         rendu projets + interactions globales
│   ├── carousel.js     carrousel des jeux
│   ├── i18n.js         dictionnaire FR / EN
│   ├── palette.js      command palette (Ctrl/Cmd + K)
│   ├── connect4.js     Puissance 4 (canvas)
│   └── easter.js       Konami code + secrets console
└── games/
    ├── morpion/        client du morpion multijoueur
    └── imitation/      client du jeu d'imitation
```

## Lancer en local

Aucun build, aucun `npm install` requis pour le front. Un simple serveur HTTP statique suffit :

```bash
python3 -m http.server 8000
```

Puis ouvrir `http://localhost:8000`. Pour tester le multi, il suffit de lancer le serveur Node dédié localement et de pointer `WS_URL` dessus.

## Secrets & Easter Eggs

1. `Ctrl` + `K` (ou `Cmd` + `K`) ouvre une command palette globale pour naviguer sur le site.
2. Le Konami Code (`↑` `↑` `↓↓` `←` `→` `←` `→` `B` `A`) débloque un mode caché.
3. Ouvrir la console développeur (`F12`) réserve une petite surprise orientée BDD.

## Vibecodé avec Claude

Ce projet et ses micro-services serveurs ont été conçus et codés en binôme avec **[Claude Code](https://claude.com/claude-code)**. Les choix d'architecture (server-authoritative, gestion RAM stricte, CDN R2, absence de framework) viennent de mes exigences. Claude a servi de second pilote pour implémenter, tester et garder la codebase ultra-propre.

## Contact

[mathys.langiny@gmail.com](mailto:mathys.langiny@gmail.com) · [LinkedIn](https://www.linkedin.com/in/mathys-langiny) · [GitHub](https://github.com/MathysLan) · [Twitch](https://www.twitch.tv/nimu_08) · [Steam](https://steamcommunity.com/id/mathys08)
