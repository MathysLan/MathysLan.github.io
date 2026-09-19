// Avatar d'un joueur, À L'AFFICHAGE : ce que le serveur renvoie dans la liste
// des joueurs (et dans les résultats, podiums, etc.) devient un nœud DOM.
//
//   serveur  →  { kind: 'image', emoji, src }  →  <img src="data:image/webp…">
//               { kind: 'emoji', emoji }       →  l'emoji, en texte
//               '🦊' (ancien serveur)          →  l'emoji, en texte
//
// C'est le pendant, côté navigateur, de `avatar.js` des six serveurs. Ce
// fichier ne connaît ni serveur ni règle : il dessine un avatar, c'est tout.
// (game-profile.js, lui, gère le profil LOCAL — le sien, pas celui des autres.)
//
// ⚠️ La donnée vient du réseau : elle ne passe JAMAIS par innerHTML. Une image
// est un <img> créé à la main, un emoji du textContent. Pour les gabarits en
// chaîne que les jeux assemblent déjà, `slot()` pose un emplacement VIDE, et
// `fill()` y met le vrai nœud juste après l'innerHTML.
//
// ⚠️ Morpion ne charge pas ce fichier : son serveur ne reçoit pas d'identité.
(function () {
  'use strict';

  var FALLBACK = '🙂';
  var MAX_IMAGE = 12 * 1024;   // octets décodés — la borne des serveurs
  var DATA_URL = /^data:image\/(webp|png);base64,([A-Za-z0-9+/]+={0,2})$/;

  // Le serveur a déjà validé ; on revérifie quand même la forme, parce qu'un
  // serveur d'une autre version (ou un serveur de test) peut répondre n'importe
  // quoi. Pas de décodage ici : la forme et la taille suffisent pour ne pas
  // mettre autre chose qu'une image inerte dans un src.
  function okSrc(src) {
    if (typeof src !== 'string') return false;
    var m = DATA_URL.exec(src);
    if (!m || m[2].length % 4 !== 0) return false;
    var pad = m[2].slice(-2) === '==' ? 2 : m[2].slice(-1) === '=' ? 1 : 0;
    return m[2].length / 4 * 3 - pad <= MAX_IMAGE;
  }

  function okEmoji(e) {
    return typeof e === 'string' && e.length > 0 && e.length <= 8;
  }

  // Ce qui vient du RÉSEAU doit en plus RESSEMBLER à un emoji : au moins un
  // pictogramme, et aucun caractère ASCII imprimable.
  // ⚠️ C'est le garde-fou du « [obj » : un serveur pas encore redéployé fait
  // `String(avatar).slice(0, 4)` sur l'objet que le client lui envoie, et
  // renvoie la chaîne « [obj » à tout le monde. Elle a la taille d'un emoji,
  // elle n'en est pas un : on affiche l'emoji par défaut à la place.
  var PICTO = /\p{Extended_Pictographic}/u;
  function looksEmoji(e) {
    return okEmoji(e) && PICTO.test(e) && !/[\x20-\x7e]/.test(e);
  }

  // N'importe quoi → { kind, emoji, src? }. Ne lève jamais.
  // (`fallback` vient du jeu, pas du réseau : il peut être « • ».)
  function normalize(av, fallback) {
    var fb = okEmoji(fallback) ? fallback : FALLBACK;
    if (typeof av === 'string') return { kind: 'emoji', emoji: looksEmoji(av) ? av : fb };
    if (!av || typeof av !== 'object') return { kind: 'emoji', emoji: fb };
    var emoji = looksEmoji(av.emoji) ? av.emoji : fb;
    if (av.kind === 'image' && okSrc(av.src)) return { kind: 'image', emoji: emoji, src: av.src };
    return { kind: 'emoji', emoji: emoji };
  }

  // Tailles : une hiérarchie, pas des pixels semés dans six feuilles.
  //   sm ≈ 32 px (compact) · md ≈ 48 px (salon, scores) · lg ≈ 68 px (podium,
  //   « c'est à qui ? »). Sans taille : l'ancien rendu en ligne, calé sur le
  //   texte (phrases, légendes). Les pixels vivent dans game-ui.css.
  var SIZES = { sm: 1, md: 1, lg: 1 };

  // L'emoji est posé dans son propre bloc (.g-av-e) : ainsi une photo et un
  // emoji occupent EXACTEMENT la même boîte, et passer de l'un à l'autre ne
  // décale rien.
  function emojiNode(e) {
    var s = document.createElement('span');
    s.className = 'g-av-e';
    s.textContent = e;
    return s;
  }

  // Le nœud. `.g-av` porte l'emoji ou la photo ; une photo qui ne se charge
  // pas (données abîmées, décodeur absent) redevient l'emoji, sur place — sans
  // rien réécrire côté profil ni côté serveur.
  function node(av, fallback, size) {
    var a = normalize(av, fallback);
    var span = document.createElement('span');
    span.className = 'g-av' + (SIZES[size] ? ' g-av--' + size : '');
    if (a.kind !== 'image') {
      span.appendChild(emojiNode(a.emoji));
      return span;
    }
    var img = document.createElement('img');
    img.className = 'g-av-img';
    img.alt = '';                    // le pseudo est toujours écrit à côté
    img.decoding = 'async';
    img.draggable = false;
    img.addEventListener('error', function () {
      span.classList.remove('is-img');
      span.replaceChildren(emojiNode(a.emoji));
    }, { once: true });
    img.src = a.src;
    span.classList.add('is-img');
    span.appendChild(img);
    return span;
  }

  // Pour les contextes qui n'acceptent que du texte (aria-label, <option>…).
  function text(av, fallback) { return normalize(av, fallback).emoji; }

  // --- gabarits en chaîne -------------------------------------------------
  // slot() réserve un emplacement et garde l'avatar de côté ; fill() remplace
  // chaque emplacement par son nœud. Un emplacement jamais rempli reste vide :
  // rien de ce qui vient du serveur n'a été interprété comme du HTML.
  var pending = {};
  var seq = 0;

  function slot(av, fallback, size) {
    var k = 'a' + (++seq);
    pending[k] = [av, fallback, size];
    return '<span data-g-av="' + k + '"></span>';
  }

  function fill(root) {
    if (!root) return;
    var list = root.querySelectorAll('[data-g-av]');
    for (var i = 0; i < list.length; i++) {
      var k = list[i].getAttribute('data-g-av');
      var v = pending[k] || [];
      delete pending[k];
      list[i].replaceWith(node(v[0], v[1], v[2]));
    }
  }

  window.GameAvatar = {
    MAX_IMAGE: MAX_IMAGE,
    normalize: normalize, node: node, text: text, slot: slot, fill: fill, okSrc: okSrc,
  };
})();
