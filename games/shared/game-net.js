// Le transport commun des pages de jeux : un WebSocket, du JSON — et la
// PRÉSENCE du joueur. Aucune règle de jeu ici.
//
// Pourquoi un module commun : chaque jeu avait son `net.js`, presque identique,
// et aucun ne savait qu'une page peut être GELÉE par le navigateur (onglet en
// arrière-plan, écran verrouillé, changement d'application). Mesuré dans Edge :
// le socket d'une page gelée reste ouvert côté serveur, ses messages ne sont
// plus traités, et il se ferme au réveil — la page se retrouvait sur un salon
// périmé, et les autres jouaient avec un fantôme.
//
// Ce que ce module ajoute à l'ancien `NET` (même API : connect, on, send,
// dispatch, ws, handlers, onBinary) :
//   · il répond tout seul aux `{ type: 'presence', n }` du serveur par
//     `{ action: 'presence', n }` — le serveur en envoie un dès la connexion,
//     c'est l'adhésion (voir src/presence.js côté serveur). Il n'en envoie
//     JAMAIS de lui-même. Ces messages ne sont jamais transmis au jeu ;
//   · il émet `lost` UNE seule fois par connexion perdue (fermée, coupée ou
//     muette), avec { raison, code, veille } ; `closed` reste émis comme avant ;
//   · il surveille le cycle de vie de la page (visibilitychange, pagehide,
//     pageshow, freeze/resume, online) et vérifie la connexion au retour ;
//   · connect() réutilise une connexion en cours au lieu d'en ouvrir une
//     seconde (un double clic ouvrait deux sockets) ;
//   · send() ne lève jamais d'erreur : il rend false si le socket n'est pas
//     disponible ;
//   · JSON.parse est protégé ; option `binary` pour les frames binaires.
//
// ⚠️ Le module ne RECONNECTE PAS tout seul : c'est au jeu de décider (au salon
// on peut revenir, en pleine partie non). Il n'invente aucune room.
//
// Le chien de garde ne s'arme qu'après deux pings PÉRIODIQUES (le ping de
// connexion ne compte pas) : devant un serveur qui n'envoie pas de présence,
// il ne se déclenche jamais.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GameNet = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var INJOIGNABLE = 'serveur injoignable (réveil Render ~30 s ? réessaie)';
  var FACTEUR = 3.5;       // silence toléré = 3,5 intervalles de présence (35 s en prod)
  var PLANCHER_MS = 2000;  // jamais moins, quels que soient les intervalles vus

  // opts : { url, binary?, remplacementMs?, WebSocket?, page? }  (les deux derniers : tests Node)
  function create(opts) {
    var WS = opts.WebSocket || (typeof WebSocket !== 'undefined' ? WebSocket : null);
    var page = opts.page !== undefined ? opts.page : (typeof window !== 'undefined' ? window : null);
    var enCours = null;      // promesse de la connexion en cours d'ouverture
    var perdu = false;       // `lost` déjà émis pour la connexion courante
    var dernier = 0;         // dernier message reçu (preuve de vie du serveur)
    var dernierPing = 0;     // dernier ping de présence PÉRIODIQUE reçu
    var pings = 0;           // pings reçus sur cette connexion
    var limite = 0;          // silence au-delà duquel la connexion est morte (0 = pas armé)
    var veille = false;      // la page a été cachée ou gelée depuis l'ouverture
    var garde = null;        // minuteur du chien de garde
    var cle = null;          // secret de la connexion courante (donné par le serveur)
    var aRemplacer = null;   // secret d'une connexion PERDUE, à faire fermer par la suivante
    var remplacement = null; // { finir, echouer } : connect() attend l'acquittement
    var sortie = false;      // la page est quittée (pagehide) : fermeture VOLONTAIRE

    var NET = {
      ws: null,
      handlers: {},          // type de message → fonction
      onBinary: null,        // frame binaire (option `binary`)

      connect: function () {
        // D'abord la connexion en cours : pendant un remplacement, le nouveau
        // socket est déjà ouvert, mais connect() n'a pas encore rendu la main.
        if (enCours) return enCours;
        if (NET.ws && NET.ws.readyState === 1 && !perdu) return Promise.resolve();
        enCours = new Promise(function (resolve, reject) {
          var ws, ouvert = false;
          try { ws = new WS(opts.url); } catch (_) { enCours = null; reject(new Error(INJOIGNABLE)); return; }
          if (opts.binary) ws.binaryType = 'arraybuffer';
          ws.onopen = function () {
            ouvert = true;
            brancher(ws);
            // Une connexion perdue à remplacer : on ne rend la main (donc le
            // jeu n'envoie son `join`) qu'une fois l'ancienne retirée par le
            // serveur — sinon le même joueur serait brièvement deux fois dans
            // sa room. Un serveur qui ne connaît pas le remplacement ne répond
            // pas : on n'attend pas plus de `remplacementMs`.
            if (!aRemplacer) { enCours = null; resolve(); return; }
            var fini = false;
            var finir = function (ok) {
              if (fini) return;
              fini = true; clearTimeout(delai); remplacement = null; enCours = null;
              if (ok) { aRemplacer = null; resolve(); } else reject(new Error(INJOIGNABLE));
            };
            var delai = setTimeout(function () { finir(true); }, opts.remplacementMs || 3000);
            remplacement = { finir: function () { finir(true); }, echouer: function () { finir(false); } };
          };
          ws.onerror = function () { if (!ouvert) { enCours = null; reject(new Error(INJOIGNABLE)); } };
          ws.onclose = function (e) {
            var code = e && e.code;
            if (!ouvert) { enCours = null; reject(new Error(INJOIGNABLE)); }
            else if (remplacement && NET.ws === ws) { var r = remplacement; perte('fermeture', code); r.echouer(); }
            // Fermée par nous en quittant la page : pas de `lost` maintenant
            // (la page part, elle ne doit pas se reconnecter). Si elle revient
            // du cache, pageshow le constatera.
            else if (NET.ws === ws && !sortie) perte('fermeture', code);
            NET.dispatch({ type: 'closed', code: code });
          };
          ws.onmessage = function (e) { if (NET.ws === ws) recevoir(e.data); };
        });
        return enCours;
      },

      dispatch: function (msg) { var h = NET.handlers[msg.type]; if (h) h(msg); },
      on: function (type, fn) { NET.handlers[type] = fn; },

      // Rend true si le message est parti. Jamais d'exception : un socket
      // absent ou fermé rend false (et fait vérifier la connexion).
      send: function (obj) {
        var ws = NET.ws;
        if (!ws || ws.readyState !== 1 || perdu) { verifier(); return false; }
        try { ws.send(JSON.stringify(obj)); return true; } catch (_) { return false; }
      },

      // La connexion est-elle utilisable ?
      connected: function () { return !!NET.ws && NET.ws.readyState === 1 && !perdu; },
    };

    function brancher(ws) {
      NET.ws = ws;
      perdu = false; veille = false; limite = 0; dernierPing = 0; pings = 0; cle = null; sortie = false;
      dernier = Date.now();
      // ⚠️ AUCUN message de présence envoyé de nous-mêmes : un serveur qui ne
      // connaît pas la présence répondrait « action inconnue » (et, via le
      // Game Hub, l'entrée serait signalée en échec). C'est le serveur qui
      // ouvre l'échange, dès la connexion ; on ne fait que répondre.
      clearInterval(garde);
      garde = setInterval(verifier, 1000);
    }

    function recevoir(data) {
      dernier = Date.now();
      if (typeof data !== 'string') { if (NET.onBinary) NET.onBinary(data); return; }
      var msg;
      try { msg = JSON.parse(data); } catch (_) { return; }
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'presence') { presence(msg); return; }
      NET.dispatch(msg);
    }

    function presence(msg) {
      var n = msg.n, maintenant = Date.now();
      // L'acquittement d'un remplacement : l'ancienne connexion est retirée,
      // connect() peut rendre la main. Ce n'est pas un ping du rythme.
      if (msg.remplace === true) { if (remplacement) remplacement.finir(); return; }
      if (typeof msg.cle === 'string' && !cle) cle = msg.cle;
      // L'intervalle des pings règle le chien de garde. ⚠️ Le PREMIER ping
      // (celui de la connexion) ne compte pas : le serveur le pose à
      // l'ouverture, hors de son rythme, et le suivant peut arriver 0,1 s plus
      // tard — la limite serait tombée au plancher et la moindre pause aurait
      // passé pour une perte (vu : un faux `lost` en pleine partie). On mesure
      // donc entre deux pings PÉRIODIQUES, et la limite ne peut que grandir
      // (un ping en retard, ou une rafale au réveil, ne la raccourcit jamais).
      pings++;
      if (pings >= 3 && dernierPing) {
        var l = Math.max(PLANCHER_MS, FACTEUR * (maintenant - dernierPing));
        limite = Math.max(limite, l);
      }
      if (pings >= 2) dernierPing = maintenant;
      var reponse = { action: 'presence', n: n };
      // Première réponse d'une connexion qui en remplace une perdue.
      if (pings === 1 && remplacement && aRemplacer) reponse.remplace = aRemplacer;
      if (NET.ws && NET.ws.readyState === 1) {
        try { NET.ws.send(JSON.stringify(reponse)); } catch (_) {}
      }
    }

    // La connexion est-elle encore vivante ? Appelé chaque seconde, au retour
    // de la page (visible, restaurée, réveillée, en ligne) et à chaque send raté.
    function verifier() {
      var ws = NET.ws;
      if (!ws || perdu || sortie) return;          // page quittée : rien à constater avant son retour
      if (ws.readyState === 2 || ws.readyState === 3) { perte('fermeture', null); return; }
      if (limite && Date.now() - dernier > limite) {
        perte('silence', null);                    // d'abord la vraie raison…
        try { ws.close(4001, 'silence'); } catch (_) {}   // …puis on ferme ce qui reste
      }
    }

    function perte(raison, code) {
      if (perdu || !NET.ws) return;
      perdu = true;
      // La prochaine connexion demandera au serveur de fermer celle-ci (si le
      // serveur nous en a donné la clé) : jamais deux fois le même joueur.
      if (cle) { aRemplacer = cle; cle = null; }
      clearInterval(garde); garde = null;
      NET.dispatch({ type: 'lost', raison: raison, code: code == null ? null : code, veille: veille });
    }

    // Le cycle de vie de la page. Une page cachée n'est pas perdue (elle
    // répond encore aux pings tant qu'elle n'est pas gelée) : on le note, et
    // on vérifie au retour.
    if (page && page.addEventListener) {
      var doc = page.document;
      var auRetour = function () { veille = true; verifier(); };
      if (doc) {
        doc.addEventListener('visibilitychange', function () {
          if (doc.visibilityState === 'hidden') veille = true; else verifier();
        });
        doc.addEventListener('freeze', function () { veille = true; });
        doc.addEventListener('resume', auRetour);
      }
      // On QUITTE la page (lien vers le Game Hub, retour au portfolio…) : le
      // navigateur peut la garder en cache avec son WebSocket ouvert côté
      // serveur — un fantôme jusqu'à l'absence (30 s), mesuré avec les valeurs
      // de production. On ferme donc proprement, tout de suite : le serveur
      // retire le joueur à l'instant. Ce n'est PAS un changement d'onglet
      // (visibilitychange), seulement un départ de la page.
      page.addEventListener('pagehide', function () {
        veille = true;
        var ws = NET.ws;
        // ⚠️ 1000 : un navigateur n'accepte que 1000 ou 3000-4999 dans close()
        // (1001 lève une exception — le socket restait ouvert, sans rien dire).
        if (ws && ws.readyState <= 1 && !perdu) { sortie = true; try { ws.close(1000, 'page quittée'); } catch (_) {} }
      });
      // Revenue du cache : la connexion fermée au départ est constatée perdue,
      // et le jeu fait comme pour toute perte (retour au salon, ou explication).
      page.addEventListener('pageshow', function (e) { if (e && e.persisted) { sortie = false; auRetour(); } });
      page.addEventListener('online', verifier);
    }

    return NET;
  }

  return { create: create, INJOIGNABLE: INJOIGNABLE };
});
