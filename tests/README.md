# Tests du front

Trois suites, qui ne se recouvrent pas :

| Fichier | Ce qu'il couvre |
|---|---|
| `front.html` | le portfolio : rendu des cartes, lightbox, palette Ctrl+K, FR/EN, thèmes, guichet, presse-papiers, menu mobile, sans JS |
| `games.html` | le **socle commun** des cinq pages de jeux : polices locales, favicon, retour au portfolio, messages d'état, avatars, `?server=`, mouvement réduit, téléphone |
| `keyboard.mjs` | le focus clavier, avec de **vraies frappes Tab** (voir plus bas) |

Rien à installer pour les deux pages HTML. Les ouvrir dans un navigateur suffit
**si** l'accès local aux fichiers est autorisé (une iframe `file://` est bloquée
par défaut). Deux façons :

    # au choix, un petit serveur local
    python -m http.server 8000    # puis http://localhost:8000/tests/front.html

    # ou, en headless
    msedge --headless=new --disable-gpu --allow-file-access-from-files \
           --window-size=900,600 --virtual-time-budget=25000 --dump-dom \
           "file:///C:/perso/MathysLan.github.io/tests/front.html"

Le verdict s'affiche en haut : `TOUT PASSE` ou la liste des `KO`.

> Sous Windows, `msedge --dump-dom` ne rend rien depuis PowerShell (c'est un exe
> graphique, sa sortie standard est perdue) : passer par Bash. Et donner à Edge
> un `--user-data-dir` à part, sinon il attend le navigateur déjà ouvert.

**Lancer les deux suites HTML deux fois.** Une partie des tests suit la
préférence « mouvement réduit » (terminal sans frappe, compteurs immédiats, Spy
qui ne marche pas, pas de bouton pause ; côté jeux, transitions coupées). Le
second passage se force avec `--force-prefers-reduced-motion`. La première ligne
du journal indique le mode détecté.

## front.html

Charge `index.html` dans **quatre** iframes : bureau (1100 px), téléphone
(390 px, menu burger), **sans JavaScript** (`sandbox` sans `allow-scripts`) et
**sans JavaScript en 390 px** — le seul cas où le menu de secours `<details>`
doit apparaître, puisque le burger a besoin de JS et que la liste du header est
masquée sous 768 px.

Deux points méritent d'être connus :

- En headless, un vrai `mailto:` bloque le navigateur : le guichet émet
  l'événement annulable `guichet:send` juste avant d'ouvrir le client mail, et
  le test l'annule.
- **Le presse-papiers.** On ne peut pas vérifier ici qu'un vrai
  `navigator.clipboard.writeText()` réussit : ni permission, ni page sécurisée
  en `file://`. Ce qui est testé, c'est toute la mécanique autour — le repli sur
  `execCommand`, le filet d'une seconde quand la promesse ne se règle jamais, le
  fait que la réponse arrive **exactement une fois** même si le presse-papiers
  répond en retard, et surtout qu'aucun faux « Adresse copiée ✓ » ne puisse
  s'afficher. Les stubs remplacent `navigator.clipboard`, `isSecureContext` et
  `document.execCommand` le temps du test, puis les remettent.

## games.html

Deux tests méritent un mot, parce qu'ils rattrapent des bugs qui sont déjà
passés en production :

- **L'apparence du code de room.** C'est un `<button>` (pour le clavier), donc
  le `button { background: …; padding: …; border-radius: … }` générique de
  chaque jeu lui remettrait l'allure d'un bouton d'action si le socle ne le
  déshabillait pas. Le test le compare au bouton d'action principal des cinq
  jeux, et vérifie aussi que ce dernier est bien resté plein — sinon le test
  passerait pour de mauvaises raisons.
- **L'état désactivé.** Deux pièges de mesure y sont désamorcés : Précision
  déclare `transition: opacity .12s`, donc lire le style juste après avoir posé
  `disabled` renvoie la valeur de *départ* (le test coupe les transitions le
  temps de la mesure) ; et la convention est « visiblement éteint », pas une
  valeur — le socle fournit `.45` par défaut, imitation préfère `.4` et
  precision `.35`, chacun avec une règle qui gagne légitimement.

## keyboard.mjs

    node tests/keyboard.mjs
    node tests/keyboard.mjs --edge "C:\chemin\vers\msedge.exe"

Node ≥ 22, aucune dépendance (le client WebSocket est celui de Node). Pas de
Node sur la machine ? Même méthode que pour `tools/build.mjs` : le zip officiel
dans le scratchpad.

Ce script existe parce que les deux autres suites ne peuvent **pas** prouver ce
qu'elles ont l'air de prouver : `:focus-visible` ne s'allume que si le focus
vient du clavier. Un `el.focus()` lancé par un script ne le déclenche pas sur un
`<button>` (vérifié sous Edge), et `focus({ focusVisible: true })` n'y est pas
encore implémenté. Le script ouvre donc Edge avec le protocole DevTools, envoie
de vrais `Tab`, et lit sur chaque élément atteint s'il porte un anneau visible —
un `outline`, ou une `box-shadow` inset (le portfolio dessine son anneau en
inset parce que `clip-path` rogne les outlines).

## Autres outils

`../styleguide.html` montre les primitives (panneau, bouton, étiquette,
qualités, case d'objet) côte à côte, dans les deux thèmes. `tests/`,
`styleguide.html` et `upload/` sont exclus de l'indexation dans `robots.txt`.
