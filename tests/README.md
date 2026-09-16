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

**Lancer la suite deux fois.** Une partie des tests suit la préférence
« mouvement réduit » (terminal sans frappe, compteurs immédiats, Spy qui ne
marche pas, pas de bouton pause). Le second passage se force avec
`--force-prefers-reduced-motion` ajouté à la commande headless ci-dessus. La
première ligne du journal indique le mode détecté.

La page charge `index.html` dans trois iframes : bureau (1100 px), téléphone
(390 px, menu burger) et **sans JavaScript** (`sandbox` sans `allow-scripts`,
pour vérifier que le contenu et les compteurs restent justes).

En headless, un vrai `mailto:` bloque le navigateur : le guichet émet
l'événement annulable `guichet:send` juste avant d'ouvrir le client mail, et le
test l'annule.

`../styleguide.html` est l'autre outil de contrôle : il montre les primitives
(panneau, bouton, étiquette, qualités, case d'objet) côte à côte, dans les deux
thèmes. Les deux sont exclus de l'indexation dans `robots.txt`.
