// La caisse Mann Co. du Game Hub : la mise en scène d'un tirage DÉJÀ FAIT.
//
//   serveur → session.draw { gameId, eligible }  →  cette animation  →  révélation
//
// ⚠️ CE MODULE NE CHOISIT RIEN. Il reçoit le jeu tiré par le serveur et la liste
// des jeux éligibles AU MOMENT du tirage, et il fait défiler une bande qui
// s'arrête sur ce jeu-là. Le hasard utilisé ici ne sert qu'à mélanger le décor
// de la bande — et la bande ne contient QUE des jeux éligibles : un jeu
// impossible pour ce groupe n'y apparaît jamais, même en passant.
//
// Aucune donnée réseau ne passe par innerHTML : les vignettes sont construites
// nœud par nœud.
(function () {
  'use strict';

  // Longueur de la bande et place du gagnant : assez de vignettes pour que la
  // bande défile ~3 s, et le gagnant pas tout au bout (la vignette d'après
  // montre qu'on aurait pu tomber ailleurs).
  var CELLS = 36;
  var WIN_AT = 31;
  var DUREE_MS = 3400;

  // La suite de vignettes : tirées dans `eligible` seulement, gagnant à WIN_AT.
  // Évite deux fois de suite le même jeu quand on a le choix (sinon, à deux
  // jeux, la bande ressemble à une rayure).
  function cells(eligible, winnerId, rand) {
    rand = rand || Math.random;
    var pool = eligible.filter(function (id) { return typeof id === 'string'; });
    if (pool.indexOf(winnerId) < 0) pool.push(winnerId);   // ceinture : le gagnant vient du serveur
    var out = [];
    for (var i = 0; i < CELLS; i++) {
      if (i === WIN_AT) { out.push(winnerId); continue; }
      var choix = pool.length > 1 ? pool.filter(function (id) { return id !== out[i - 1]; }) : pool;
      out.push(choix[Math.floor(rand() * choix.length)]);
    }
    // Les voisins immédiats du gagnant ne sont pas le gagnant lui-même : la
    // bande s'arrête sur UNE vignette lisible, pas sur un bloc de trois.
    if (pool.length > 1) {
      [WIN_AT - 1, WIN_AT + 1].forEach(function (j) {
        if (out[j] === winnerId) out[j] = pool.filter(function (id) { return id !== winnerId; })[0];
      });
    }
    return out;
  }

  // Une vignette : emoji + nom. `info(id)` rend { emoji, title, accent }.
  function cellNode(id, info) {
    var g = info(id);
    var li = document.createElement('li');
    li.className = 'reel-cell';
    li.dataset.game = id;
    if (g.accent) li.dataset.accent = g.accent;
    var e = document.createElement('span');
    e.className = 'reel-emoji';
    e.textContent = g.emoji || '🎮';
    var n = document.createElement('span');
    n.className = 'reel-name';
    n.textContent = g.title || id;
    li.append(e, n);
    return li;
  }

  // Fait défiler la bande jusqu'au gagnant. Rend une promesse tenue à l'arrêt.
  // opts : { eligible, winnerId, info, reduced }.
  function spin(reel, opts) {
    var strip = reel.querySelector('.reel-strip');
    var suite = cells(opts.eligible, opts.winnerId);
    strip.replaceChildren.apply(strip, suite.map(function (id) { return cellNode(id, opts.info); }));
    strip.style.transition = 'none';
    strip.style.transform = 'translateX(0px)';

    var cible = strip.children[WIN_AT];
    // Centre du gagnant sous le repère, à ±30 % d'une vignette près : la bande
    // ne s'arrête pas pile au milieu, comme une vraie roue — mais toujours
    // DANS la vignette gagnante.
    var fin = function () {
      var w = cible.offsetWidth;
      var jeu = opts.reduced ? 0 : (Math.random() - 0.5) * w * 0.6;
      return -(cible.offsetLeft + w / 2 - reel.clientWidth / 2 + jeu);
    };

    return new Promise(function (resolve) {
      if (opts.reduced) {
        strip.style.transform = 'translateX(' + fin() + 'px)';
        reel.classList.add('is-done');
        resolve();
        return;
      }
      void strip.offsetWidth;                // reflow : sinon la transition ne part pas
      reel.classList.add('is-spinning');
      strip.style.transition = 'transform ' + DUREE_MS + 'ms cubic-bezier(.1, .7, .14, 1)';
      strip.style.transform = 'translateX(' + fin() + 'px)';
      var fini = false;
      var stop = function () {
        if (fini) return;
        fini = true;
        reel.classList.remove('is-spinning');
        reel.classList.add('is-done');
        resolve();
      };
      strip.addEventListener('transitionend', stop, { once: true });
      // Filet : onglet en arrière-plan, transition avalée… on révèle quand même.
      setTimeout(stop, DUREE_MS + 700);
    });
  }

  function reset(reel) {
    var strip = reel.querySelector('.reel-strip');
    strip.style.transition = 'none';
    strip.style.transform = 'translateX(0px)';
    strip.replaceChildren();
    reel.classList.remove('is-spinning', 'is-done');
  }

  window.HubCrate = { CELLS: CELLS, WIN_AT: WIN_AT, DUREE_MS: DUREE_MS, cells: cells, spin: spin, reset: reset };
})();
