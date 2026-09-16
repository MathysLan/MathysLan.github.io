<div align="center">

# Mathys Langiny — Portfolio

**Data & Administration de bases de données** · Reims, France

[![Live](https://img.shields.io/badge/live-mathyslan.github.io-cf7336?style=flat-square)](https://mathyslan.github.io)
[![Construit avec Claude Code](https://img.shields.io/badge/construit%20avec-Claude%20Code-5885a2?style=flat-square)](#construit-avec-claude-code)
[![Vanilla JS](https://img.shields.io/badge/stack-Vanilla%20JS-b8383b?style=flat-square)](#stack-technique)

</div>

---

## C'est quoi

Mon portfolio. Pas une vitrine marketing remplie de buzzwords : un endroit direct pour **exposer ce que je construis**, de mes projets data à mes serveurs de jeux web.

Je suis Data et administrateur de bases de données chez AgiLab. Ma ligne de conduite : on protège la donnée, on automatise ce qui doit l'être, et on dit non aux usines à gaz. Le site applique la même philosophie : **JavaScript natif**, aucun framework, un hébergement statique sur GitHub Pages.

L'habillage reprend le langage graphique de **Team Fortress 2** (interface Source, raretés d'objets, killfeed), entièrement redessiné en CSS/SVG : aucune image, aucun son ni aucun logo du jeu.

👉 **[mathyslan.github.io](https://mathyslan.github.io)**

## Ce qu'on y trouve

| Section | Ce que c'est |
|---|---|
| **Projets** | Un « sac à dos » : une case par projet, et une fiche qui dit l'objectif, ma part, le résultat, l'équipe, la stack, avec les liens et les captures. |
| **Parcours** | Bac, BUT Informatique, stage, alternance, CDI chez AgiLab, en « contrats » dépliables. |
| **Assos** | Vice-président des Jeunes Capucins. |
| **Passions** | Volley, karaté (vice-champion de France full contact), régie de stream maison, concerts. |
| **Jeux** | Six jeux jouables dans le navigateur, avec pour chacun un lien vers son code et sa fiche d'architecture. |
| **Contact** | Un formulaire qui prépare un mail dans ton client mail (rien ne transite par un service tiers), et l'adresse à copier. |

### Les jeux

1. **Morpion** : le « Hello World » du réseau, en multijoueur temps réel.
2. **Imitation** : party game vocal. On regarde un extrait, on imite le son au micro, les autres notent.
3. **Demi-Cercle** : party game de perception à la Wavelength.
4. **Puissance 4** : en Canvas, en solo contre un bot, aussi caché derrière des easter eggs.
5. **Le Jeu du Ban** : arrêter une vidéo le plus tard possible sans laisser sortir le mot interdit.
6. **Précision** : mémoriser une forme, une couleur, un son ou un timing, puis le reproduire.

## L'architecture des jeux

Le principe, sur tous les jeux multijoueurs : **le front ne décide rien, le serveur est la seule autorité.**

```
  Front statique (ce dépôt, GitHub Pages)       Serveur arbitre (dépôt séparé, Render)
  ┌─────────────────────────────┐   WebSocket   ┌──────────────────────────────┐
  │  games/<jeu>/                │ ◀───────────▶ │  moteur de règles pur        │
  │  affiche l'état, envoie      │   intentions  │  server.js (rooms, phases)   │
  │  des intentions              │    + états    │  valide TOUT, calcule TOUT   │
  └─────────────────────────────┘               └──────────────────────────────┘
```

Le client envoie des intentions (« je joue la case 4 », « voici mon indice ») ; le serveur valide les règles et calcule les scores. Modèle « zéro confiance » : ce qu'un joueur ne doit pas savoir ne lui est jamais envoyé (la cible du Demi-Cercle, le temps « fatal » du Jeu du Ban), et les temps sont recoupés avec l'horloge du serveur.

Pour *Imitation*, les prises de voix transitent en binaire par WebSocket, restent en RAM le temps de la manche puis sont purgées. Les vidéos de référence sont sur **Cloudflare R2** et ne passent jamais par le serveur Node.

Chaque serveur a son dépôt : [`morpion-server`](https://github.com/MathysLan/morpion-server), [`imitation-server`](https://github.com/MathysLan/imitation-server), [`demicercle-server`](https://github.com/MathysLan/demicercle-server), [`ban-server`](https://github.com/MathysLan/ban-server), [`precision-server`](https://github.com/MathysLan/precision-server).

## Stack technique

| Côté | Technos |
|---|---|
| Front | HTML, CSS, JavaScript natif, Tailwind **compilé** (pas de CDN), Canvas, SVG, Web Audio, MediaRecorder |
| Temps réel | WebSocket (`ws`), Node.js, moteurs de règles purs |
| Hébergement | GitHub Pages (front), Render (serveurs), Cloudflare R2 (vidéos) |
| Langues | Dictionnaire FR / EN maison (`js/i18n.js`) |
| Génération | `tools/build.mjs` : Node, zéro dépendance |

## Structure du dépôt

```
├── index.html            la page du portfolio (contenu pré-rendu entre les marqueurs build:)
├── 404.html              page d'erreur façon session SQL*Plus (ORA-00942)
├── css/
│   ├── tf2.css           le socle : polices, palette, primitives (panneau, bouton, objet…)
│   ├── style.css         les composants du portfolio, construits sur le socle
│   └── tailwind.css      GÉNÉRÉ par tools/build.mjs
├── data/
│   ├── projects.js       les projets (objectif, ma part, résultat, équipe, stack…)
│   ├── games.js          les jeux du carousel (code, architecture…)
│   └── favgames.js       mes jeux vidéo préférés
├── js/
│   ├── templates.js      le balisage partagé entre le navigateur et le pré-rendu
│   ├── main.js           interactions globales (menu, scroll, guichet, compteurs…)
│   ├── itemmodal.js      fiche d'objet (projet ou architecture d'un jeu)
│   ├── carousel.js       carousel des jeux
│   ├── lightbox.js       captures en plein écran
│   ├── i18n.js           dictionnaire FR / EN
│   ├── palette.js        palette de commandes (Ctrl/Cmd + K)
│   ├── connect4.js       Puissance 4 (Canvas)
│   └── easter.js         Konami code, Spy crabe, secrets console
├── games/                les clients des jeux (morpion, imitation, demicercle, ban, precision)
├── tools/
│   ├── build.mjs         pré-rendu, Tailwind, sitemap
│   └── og-image.html     l'image de partage (assets/og-image.png)
└── tests/front.html      tests du front, pilotés dans le navigateur
```

## Modifier le contenu

Les projets, jeux et jeux préférés se modifient dans `data/*.js`. Le contenu est **pré-rendu dans `index.html`** pour être lisible sans JavaScript et par les moteurs de recherche. Après une modification :

```bash
node tools/build.mjs          # pré-rendu + Tailwind compilé + sitemap
```

Pas de `package.json` ni de `node_modules` : Tailwind (version figée) passe par `npx` le temps de la compilation. Une vérification GitHub Actions (`node tools/build.mjs --check`) signale un oubli.

Images : en **WebP**, avec une vignette de 480 px dans `assets/projects/thumbs/` pour la case du sac à dos. Le build échoue si une image citée dans `data/` n'existe pas.

## Lancer en local

Un serveur HTTP statique suffit :

```bash
python -m http.server 8000     # ou : npx http-server
```

Puis `http://localhost:8000`. Pour tester un jeu multijoueur, lancer son serveur Node en local et ouvrir la page du jeu avec `?server=ws://localhost:PORT` (Imitation, Demi-Cercle, Ban, Précision ; l'URL du Morpion est fixée dans `games/morpion/net.js`).

## Tests

`tests/front.html` pilote le vrai `index.html` (bureau, téléphone et **sans JavaScript**) : fiches, lightbox, clavier, lecteurs d'écran, SEO, guichet… Mode d'emploi dans [`tests/README.md`](tests/README.md). La suite se lance deux fois : mouvement normal et « mouvement réduit ».

## Secrets & easter eggs

1. `Ctrl` + `K` (ou `Cmd` + `K`) ouvre une palette de commandes.
2. Le Konami Code (`↑` `↑` `↓` `↓` `←` `→` `←` `→` `B` `A`) débloque un mode caché.
3. Un masque de Spy se cache en bas de page.
4. La console développeur (`F12`) réserve une petite surprise orientée BDD.

## Construit avec Claude Code

Je ne le cache pas : une grande partie du code de ce site et des serveurs de jeux a été écrite avec **[Claude Code](https://claude.com/claude-code)**. La répartition est claire :

- **Ce qui vient de moi** : les exigences, les choix d'architecture (front statique et serveur arbitre par jeu, zéro confiance côté client, audios en RAM, vidéos sur R2, pas de framework), l'identité visuelle, les priorités (stabilité et accessibilité avant les nouvelles fonctionnalités), et la relecture de ce qui est livré.
- **Ce qu'a fait l'IA** : l'implémentation, les tests, le refactoring et les audits (accessibilité, SEO, performance), à partir de ces exigences.

## Contact

[mathys.langiny@gmail.com](mailto:mathys.langiny@gmail.com) · [LinkedIn](https://www.linkedin.com/in/mathys-langiny) · [GitHub](https://github.com/MathysLan) · [Twitch](https://www.twitch.tv/nimu_08) · [Steam](https://steamcommunity.com/id/mathys08)

<sub>Not affiliated with Valve Corporation. Team Fortress 2 est une marque de Valve.</sub>
