# Tests du front

`front.html` pilote le vrai `index.html` dans une iframe et vérifie ce qui casse
en silence quand on touche au style : rendu des cartes, lightbox, palette
Ctrl+K, bascule FR/EN, bascule de thème, guichet de contact, anneau de focus sur
les éléments découpés au `clip-path`.

Rien à installer. Ouvrir le fichier dans un navigateur suffit **si** l'accès
local aux fichiers est autorisé (une iframe `file://` est bloquée par défaut).
Deux façons :

    # au choix, un petit serveur local
    python -m http.server 8000    # puis http://localhost:8000/tests/front.html

    # ou, en headless, pour une capture du verdict
    msedge --headless=new --disable-gpu --allow-file-access-from-files \
           --window-size=900,500 --screenshot=out.png --virtual-time-budget=12000 \
           "file:///C:/perso/MathysLan.github.io/tests/front.html"

Le verdict s'affiche en haut : `TOUT PASSE` ou la liste des `KO`.

`../styleguide.html` est l'autre outil de contrôle : il montre les primitives
(panneau, bouton, étiquette, qualités, case d'objet) côte à côte, dans les deux
thèmes. Les deux sont exclus de l'indexation dans `robots.txt`.
