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

  // Un seul jeu possible : il n'y a RIEN à tirer. Pas de bande qui fait défiler
  // trente fois le même jeu pour simuler un suspense qui n'existe pas — la
  // caisse s'ouvre sur lui, tout de suite. Le résultat reste celui du serveur :
  // on ne regarde que la liste qu'il a envoyée avec le tirage.
  function single(eligible, winnerId) {
    var ids = (eligible || []).filter(function (id, i, a) { return typeof id === 'string' && a.indexOf(id) === i; });
    return ids.length === 0 || (ids.length === 1 && ids[0] === winnerId);
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

  // ⚠️ LA GÉOMÉTRIE DE L'ARRÊT. La cible est un décalage en PIXELS, calculé
  // sur la largeur de la bande et la position du gagnant — qui changent avec la
  // fenêtre (bande plafonnée à 560 px, vignettes de 104 → 92 px au téléphone).
  // Calculée une seule fois, elle laissait après un redimensionnement ou une
  // rotation la bande arrêtée à côté du gagnant (une autre vignette sous le
  // repère). On garde donc le jeu de l'arrêt en FRACTION de vignette, et un
  // ResizeObserver invalide la géométrie : bande arrêtée → reposée d'un coup ;
  // bande qui tourne → même fin, nouvelle cible, sur le temps qui reste.
  // Seulement quand une mesure a vraiment changé (l'observateur se déclenche
  // aussi à l'observation, et quand la bande réapparaît après display: none).
  var etats = typeof WeakMap === 'function' ? new WeakMap() : null;
  var FIN_REPRISE = 'cubic-bezier(.2, .6, .3, 1)';

  function mesure(reel, cible) {
    return reel.clientWidth + ':' + cible.offsetLeft + ':' + cible.offsetWidth;
  }
  function cibleX(reel, e) {
    var w = e.cible.offsetWidth;
    return -(e.cible.offsetLeft + w / 2 - reel.clientWidth / 2 + e.jeu * w);
  }
  function surResize(reel) {
    var e = etats && etats.get(reel);
    if (!e || !e.cible.isConnected || !reel.clientWidth) return;   // rangée, ou masquée : rien à mesurer
    var reste = e.finAt - Date.now();
    if (e.tourne && reste < 60) return;      // la fin est là : stop() reposera la bande
    var m = mesure(reel, e.cible);
    if (m === e.geo) return;
    e.geo = m;
    var strip = e.strip;
    if (!e.tourne) {
      strip.style.transition = 'none';
      strip.style.transform = 'translateX(' + cibleX(reel, e) + 'px)';
      return;
    }
    // En plein défilement : on repart de là où la bande EST, vers la nouvelle
    // cible. Le transitionend attendu par spin() arrive à la fin de celle-ci.
    var ici = new DOMMatrix(getComputedStyle(strip).transform).m41;
    strip.style.transition = 'none';
    strip.style.transform = 'translateX(' + ici + 'px)';
    void strip.offsetWidth;
    strip.style.transition = 'transform ' + Math.round(reste) + 'ms ' + FIN_REPRISE;
    strip.style.transform = 'translateX(' + cibleX(reel, e) + 'px)';
  }
  function suivre(reel, strip, cible, jeu, dureeMs) {
    if (!etats) return;
    var e = { strip: strip, cible: cible, jeu: jeu, tourne: dureeMs > 0, finAt: Date.now() + dureeMs, geo: mesure(reel, cible) };
    etats.set(reel, e);
    if (typeof ResizeObserver !== 'function') return;
    if (!reel._hubResize) {
      reel._hubResize = new ResizeObserver(function () { surResize(reel); });
      reel._hubResize.observe(reel);
    }
    // La vignette aussi : sa largeur change avec le point de rupture.
    if (reel._hubCible) reel._hubResize.unobserve(reel._hubCible);
    reel._hubCible = cible;
    reel._hubResize.observe(cible);
    return e;
  }
  function oublier(reel) {
    if (etats) etats.delete(reel);
    if (reel._hubResize && reel._hubCible) { reel._hubResize.unobserve(reel._hubCible); reel._hubCible = null; }
  }

  // Fait défiler la bande jusqu'au gagnant. Rend une promesse tenue à l'arrêt.
  // opts : { eligible, winnerId, info, reduced }.
  // Un seul jeu possible : une seule vignette, posée, aucune transition (la
  // page masque alors la bande, voir #hub-draw.is-single).
  function spin(reel, opts) {
    var strip = reel.querySelector('.reel-strip');
    oublier(reel);
    reel.classList.remove('is-spinning', 'is-done', 'is-single');
    if (single(opts.eligible, opts.winnerId)) {
      strip.style.transition = 'none';
      strip.style.transform = 'translateX(0px)';
      var seule = cellNode(opts.winnerId, opts.info);
      seule.classList.add('is-win');
      strip.replaceChildren(seule);
      reel.classList.add('is-single', 'is-done');
      return Promise.resolve();
    }
    var suite = cells(opts.eligible, opts.winnerId);
    strip.replaceChildren.apply(strip, suite.map(function (id) { return cellNode(id, opts.info); }));
    strip.style.transition = 'none';
    strip.style.transform = 'translateX(0px)';

    var cible = strip.children[WIN_AT];
    // La vignette gagnante : c'est elle que la page met en avant à l'arrêt.
    cible.classList.add('is-win');
    // Centre du gagnant sous le repère, à ±30 % d'une vignette près : la bande
    // ne s'arrête pas pile au milieu, comme une vraie roue — mais toujours
    // DANS la vignette gagnante. Le jeu est une FRACTION de vignette, pour
    // rester le même si la vignette change de largeur (voir surResize).
    var jeu = opts.reduced ? 0 : (Math.random() - 0.5) * 0.6;

    return new Promise(function (resolve) {
      if (opts.reduced) {
        var pose = suivre(reel, strip, cible, jeu, 0);
        strip.style.transform = 'translateX(' + cibleX(reel, pose || { cible: cible, jeu: jeu }) + 'px)';
        reel.classList.add('is-done');
        resolve();
        return;
      }
      void strip.offsetWidth;                // reflow : sinon la transition ne part pas
      reel.classList.add('is-spinning');
      var e = suivre(reel, strip, cible, jeu, DUREE_MS) || { cible: cible, jeu: jeu };
      strip.style.transition = 'transform ' + DUREE_MS + 'ms cubic-bezier(.1, .7, .14, 1)';
      strip.style.transform = 'translateX(' + cibleX(reel, e) + 'px)';
      var fini = false;
      var stop = function () {
        if (fini) return;
        fini = true;
        // Arrêt : la bande est reposée sur la géométrie DU MOMENT (un
        // redimensionnement dans les dernières images, ou le filet ci-dessous
        // qui coupe une transition avalée). Même cible : rien ne bouge sinon.
        e.tourne = false;
        e.geo = null;
        surResize(reel);
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
    oublier(reel);
    strip.style.transition = 'none';
    strip.style.transform = 'translateX(0px)';
    strip.replaceChildren();
    reel.classList.remove('is-spinning', 'is-done', 'is-single');
  }

  window.HubCrate = { CELLS: CELLS, WIN_AT: WIN_AT, DUREE_MS: DUREE_MS, cells: cells, single: single, spin: spin, reset: reset };
})();
