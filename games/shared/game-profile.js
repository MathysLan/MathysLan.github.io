// Profil de joueur, local au navigateur. Pseudo + avatar, retenus d'un jeu à
// l'autre pour qu'on ne les retape pas six fois.
//
// Ce que ce fichier N'EST PAS, et ne doit jamais devenir : il n'ouvre aucun
// socket, ne connaît aucun serveur, aucune règle, aucun score. Il lit et écrit
// une clé de localStorage, et remplit deux champs. C'est tout.
//
//   localStorage  →  game-profile.js  →  page de jeu
//
// ⚠️ MORPION EST L'EXCEPTION, et elle est voulue. Son serveur lit
// `onJoin(ws, msg.code)` : ni pseudo, ni avatar, et sa page n'a ni #name-input
// ni #avatar-row. Ce fichier n'y est donc pas chargé — on ne lui envoie pas une
// identité qu'il ne sait pas recevoir. Vérifié dans morpion-server/src/server.js.
//
// ⚠️ L'IMAGE NE PART PAS EN JEU, en V1. Les six serveurs qui acceptent un
// avatar font `String(avatar || '🙂').slice(0, 4)` : quatre caractères, une
// URL n'y tient pas. La photo reste donc locale (et servira au futur Hub) ;
// c'est l'emoji qui voyage. Ce n'est pas une limite oubliée, c'est le choix
// de la V1, et l'interface le dit au joueur.
(function () {
  'use strict';

  var KEY = 'mathys_game_profile';
  var V = 1;
  var MAX_NAME = 16;        // `slice(0, 16)` dans les six serveurs
  var MAX_EMOJI = 4;        // `slice(0, 4)` — en unités UTF-16, voir plus bas
  var MAX_IMAGE = 12 * 1024;
  var TYPES = ['image/webp', 'image/png', 'image/jpeg'];

  // --------------------------------------------------------------- validation
  // ⚠️ `slice(0, 4)` côté serveur compte des unités UTF-16, pas des emojis. Les
  // douze icônes proposées aujourd'hui en font 2 ou 3, donc tout passe — mais un
  // emoji à ZWJ (👨‍👩‍👧 = 8 unités) serait coupé en plein milieu et arriverait
  // cassé chez les autres joueurs. On refuse ici plutôt que de laisser le
  // serveur trancher.
  function okEmoji(e) {
    return typeof e === 'string' && e.length > 0 && e.length <= MAX_EMOJI && e.trim() === e;
  }

  // Une image n'est acceptée que sous la forme qu'on produit nous-mêmes : une
  // data-URL webp ou png sortie d'un canvas. SVG exclu par construction — il
  // peut porter du script, et aucune image légitime n'arrive ici sous ce
  // format puisque le canvas ne sait pas en écrire.
  function okImage(src) {
    return typeof src === 'string'
      && /^data:image\/(webp|png);base64,[A-Za-z0-9+/=]+$/.test(src)
      && src.length <= MAX_IMAGE * 2;
  }

  function defaults() {
    return {
      v: V,
      // Identifiant LOCAL. Il sert à se reconnaître dans son propre navigateur,
      // jamais à prouver quoi que ce soit : aucun serveur ne le reçoit, et le
      // jour où le Hub existera, l'autorité viendra du socket, pas de cet id.
      id: 'p_' + Math.random().toString(36).slice(2, 10),
      name: '',
      avatar: { kind: 'emoji', emoji: '🙂' },
    };
  }

  // Ramène n'importe quoi à un profil valide. Ne jette jamais : un profil
  // corrompu ne doit pas empêcher de jouer.
  function sanitize(raw) {
    var p = defaults();
    if (!raw || typeof raw !== 'object') return p;
    // Version inconnue : on repart à neuf plutôt que de deviner. C'est ici
    // qu'une migration viendra se brancher le jour où le format changera.
    if (raw.v !== V) return p;
    if (typeof raw.id === 'string' && /^p_[a-z0-9]{1,16}$/.test(raw.id)) p.id = raw.id;
    if (typeof raw.name === 'string') p.name = raw.name.trim().slice(0, MAX_NAME);

    var a = raw.avatar;
    if (a && typeof a === 'object') {
      if (okEmoji(a.emoji)) p.avatar.emoji = a.emoji;
      // `kind: 'image'` sans image valide retombe sur l'emoji : l'emoji est
      // toujours présent, c'est lui le repli.
      if (a.kind === 'image' && okImage(a.src)) {
        p.avatar.kind = 'image';
        p.avatar.src = a.src;
      }
    }
    return p;
  }

  // ------------------------------------------------------------------ stockage
  function load() {
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(KEY)); } catch (_) { /* illisible : on repart à neuf */ }
    return sanitize(raw);
  }

  function save(p) {
    var clean = sanitize(p);
    try {
      localStorage.setItem(KEY, JSON.stringify(clean));
      return { ok: true, profile: clean };
    } catch (e) {
      // Navigation privée, stockage plein, cookies bloqués : le jeu continue,
      // simplement le profil ne survivra pas au rechargement.
      return { ok: false, error: 'profil non enregistré (stockage indisponible)', profile: clean };
    }
  }

  function reset() {
    try { localStorage.removeItem(KEY); } catch (_) { /* rien à faire */ }
    return defaults();
  }

  function patch(fn) {
    var p = load();
    fn(p);
    return save(p);
  }

  var setName = function (name) {
    return patch(function (p) { p.name = String(name || '').trim().slice(0, MAX_NAME); });
  };
  var setEmoji = function (emoji) {
    return patch(function (p) { if (okEmoji(emoji)) p.avatar.emoji = emoji; });
  };
  var clearImage = function () {
    return patch(function (p) { p.avatar.kind = 'emoji'; delete p.avatar.src; });
  };

  // --------------------------------------------------------------- image
  // Normalisation dans le navigateur : 96×96, WebP, sous 12 Ko. Le passage par
  // un canvas ne fait pas que compresser — il ne ressort QUE des pixels, donc
  // ni EXIF, ni profil couleur, ni charge utile cachée dans le fichier source.
  function normalizeImage(file) {
    return new Promise(function (resolve) {
      if (!file) return resolve({ ok: false, error: 'aucun fichier' });
      if (TYPES.indexOf(file.type) < 0) {
        return resolve({ ok: false, error: 'formats acceptés : webp, png ou jpeg' });
      }
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onerror = function () {
        URL.revokeObjectURL(url);
        resolve({ ok: false, error: 'image illisible' });
      };
      img.onload = function () {
        URL.revokeObjectURL(url);
        try {
          var c = document.createElement('canvas');
          c.width = 96; c.height = 96;
          var ctx = c.getContext('2d');
          // Cadrage « cover » : on remplit le carré sans déformer le visage.
          var cote = Math.min(img.naturalWidth, img.naturalHeight) || 1;
          ctx.drawImage(img,
            (img.naturalWidth - cote) / 2, (img.naturalHeight - cote) / 2, cote, cote,
            0, 0, 96, 96);
          // On descend la qualité jusqu'à tenir dans l'enveloppe. Un 96×96 à
          // 0.8 fait ~4 Ko : la première valeur suffit presque toujours.
          var out = null;
          var q = [0.8, 0.65, 0.5, 0.4];
          for (var i = 0; i < q.length; i++) {
            var d = c.toDataURL('image/webp', q[i]);
            // Un navigateur sans encodeur WebP renvoie silencieusement du PNG :
            // on l'accepte s'il tient, il sort du même canvas et reste inerte.
            if (!/^data:image\/(webp|png);base64,/.test(d)) continue;
            if (d.length <= MAX_IMAGE * 2) { out = d; break; }
            out = d;
          }
          if (!out) return resolve({ ok: false, error: 'image non convertible' });
          if (out.length > MAX_IMAGE * 2) {
            return resolve({ ok: false, error: 'image trop lourde même après compression' });
          }
          resolve({ ok: true, src: out });
        } catch (e) {
          resolve({ ok: false, error: 'conversion impossible' });
        }
      };
      img.src = url;
    });
  }

  function setImage(file) {
    return normalizeImage(file).then(function (r) {
      if (!r.ok) return r;
      var saved = patch(function (p) { p.avatar.kind = 'image'; p.avatar.src = r.src; });
      return saved.ok ? { ok: true, src: r.src } : { ok: false, error: saved.error };
    });
  }

  // ------------------------------------------------------- emoji de démarrage
  // L'emoji que CE jeu affichera. Règle, et elle est volontairement simple :
  //  - si l'emoji du profil fait partie des douze de ce jeu, on le garde ;
  //  - sinon on en choisit un de façon STABLE (dérivé de l'id local), pour que
  //    le même jeu montre toujours le même, sans jamais réécrire le profil.
  // Chaque jeu propose douze icônes qui ne sont pas les mêmes partout : on
  // préfère un repli déterministe à un tirage au sort qui changerait à chaque
  // rechargement, et on ne touche pas au choix du joueur.
  function startEmoji(list) {
    var p = load();
    if (!list || !list.length) return p.avatar.emoji;
    if (list.indexOf(p.avatar.emoji) >= 0) return p.avatar.emoji;
    var h = 0;
    for (var i = 0; i < p.id.length; i++) h = (h * 31 + p.id.charCodeAt(i)) % 100000;
    return list[h % list.length];
  }

  // ------------------------------------------------------------- branchement
  // Aucune page n'a été modifiée pour ça : le module trouve les éléments par
  // les identifiants que les six jeux partagent déjà, et crée lui-même le seul
  // morceau d'interface qu'il ajoute.
  function mount() {
    var input = document.getElementById('name-input');
    var row = document.getElementById('avatar-row');
    var p = load();

    if (input) {
      if (!input.value && p.name) input.value = p.name;
      // On enregistre quand la saisie est FINIE (change = à la sortie du champ),
      // pas à chaque frappe : écrire dans localStorage à chaque lettre ne sert
      // à rien et fait travailler le disque pour rien.
      input.addEventListener('change', function () { setName(input.value); });
      // Filet : cliquer « Créer » sans quitter le champ ne déclenche pas
      // toujours `change` avant le handler du jeu. On passe en capture pour
      // enregistrer avant que la partie ne démarre.
      ['host', 'join'].forEach(function (id) {
        var b = document.getElementById(id);
        if (b) b.addEventListener('click', function () { setName(input.value); }, true);
      });
    }

    // Délégation : les boutons d'avatar sont créés par le jeu, et gardent leurs
    // propres écouteurs. On écoute le conteneur, donc les deux cohabitent.
    if (row) {
      row.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('.avatar-pick') : null;
        if (b && row.contains(b)) setEmoji(b.textContent.trim());
      });
      mountPhoto(row);
    }
  }

  // Le choix d'une photo. Discret : tant qu'il n'y a pas d'image, ce n'est
  // qu'un bouton secondaire de plus sous la grille d'icônes.
  function mountPhoto(row) {
    var p = load();
    var box = document.createElement('div');
    box.className = 'gp-photo';

    var img = document.createElement('img');
    img.className = 'gp-preview';
    img.alt = 'ta photo de profil';
    img.hidden = true;

    var add = document.createElement('button');
    add.type = 'button';
    add.className = 'ghost gp-btn';

    var del = document.createElement('button');
    del.type = 'button';
    del.className = 'ghost gp-btn';
    del.textContent = 'retirer';
    del.hidden = true;

    var file = document.createElement('input');
    file.type = 'file';
    file.accept = TYPES.join(',');
    file.className = 'gp-file';
    // Le bouton est le seul point d'entrée clavier : on ne veut pas tomber sur
    // un champ invisible en tabulant.
    file.tabIndex = -1;
    file.id = 'gp-file';

    // Le champ fichier natif est illisible et intraduisible : on le masque et
    // on pilote tout par le bouton. Il garde un vrai label, sinon il n'a aucun
    // nom accessible.
    var lab = document.createElement('label');
    lab.setAttribute('for', 'gp-file');
    lab.className = 'gp-sr';
    lab.textContent = 'choisir une photo de profil';

    var msg = document.createElement('p');
    msg.className = 'gp-msg';
    msg.setAttribute('role', 'status');

    box.appendChild(lab);
    box.appendChild(file);
    box.appendChild(img);
    box.appendChild(add);
    box.appendChild(del);
    box.appendChild(msg);
    row.parentNode.insertBefore(box, row.nextSibling);

    function paint(prof, note) {
      var has = prof.avatar.kind === 'image' && prof.avatar.src;
      // ⚠️ Jamais d'innerHTML avec une donnée du profil : le nom et la source
      // viennent de l'utilisateur. Un <img> et du textContent, rien d'autre.
      if (has) img.src = prof.avatar.src; else img.removeAttribute('src');
      img.hidden = !has;
      del.hidden = !has;
      add.textContent = has ? 'changer' : 'ajouter une photo';
      // On le dit franchement : en V1 la photo ne part pas dans la partie.
      msg.textContent = note !== undefined ? note
        : (has ? 'gardée pour toi — en jeu, c’est ton icône qui s’affiche' : '');
      msg.classList.toggle('gp-err', note !== undefined && note !== '');
    }

    add.addEventListener('click', function () { file.click(); });
    del.addEventListener('click', function () { paint(clearImage().profile, ''); });
    file.addEventListener('change', function () {
      var f = file.files && file.files[0];
      file.value = '';
      if (!f) return;
      msg.textContent = 'traitement…';
      setImage(f).then(function (r) {
        if (r.ok) paint(load());
        else paint(load(), r.error);
      });
    });

    paint(p);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

  window.GameProfile = {
    KEY: KEY, VERSION: V,
    MAX_NAME: MAX_NAME, MAX_EMOJI: MAX_EMOJI, MAX_IMAGE: MAX_IMAGE, TYPES: TYPES,
    load: load, save: save, reset: reset,
    setName: setName, setEmoji: setEmoji,
    setImage: setImage, clearImage: clearImage, normalizeImage: normalizeImage,
    startEmoji: startEmoji,
    _sanitize: sanitize, _okEmoji: okEmoji, _okImage: okImage, _defaults: defaults,
  };
})();
