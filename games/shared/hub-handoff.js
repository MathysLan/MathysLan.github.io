// Le handoff côté PAGE DE JEU : relier une partie au Game Hub.
//
//   /games/ (Hub)  ──billet──▶  /games/<jeu>/  ──protocole NORMAL du jeu──▶  serveur du jeu
//        ▲                            │
//        └──── launched / entered ────┘   (le même player.id, reconnecté au Hub)
//
// Ce module ne crée AUCUNE room et ne rejoint rien lui-même : il appelle le
// `join(code)` que la page du jeu lui donne — son chemin habituel (« Créer une
// partie » sans code, « Rejoindre » avec). Il ne connaît aucune règle de jeu.
//
// Le BILLET (sessionStorage, pas l'URL — une URL se recopie et se partage) est
// écrit par /games/ juste avant la navigation, au clic du joueur :
//   { v, hub, session, playerId, drawId, gameId, role, at }
// Même onglet : le socket du Hub se ferme en quittant /games/ ; ce module le
// rouvre avec le MÊME player.id (la reprise habituelle du Hub) et le garde
// ouvert pendant la partie — le Hub sait ainsi qui est encore là.
//
// ⚠️ SANS BILLET, RIEN NE CHANGE : la page du jeu marche exactement comme
// avant, hors Hub. Et si le Hub est injoignable, la partie reste jouable : on
// le dit, et on laisse le jeu tranquille.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HubHandoff = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var KEY = 'mathys_hub_handoff';
  // Un billet ne sert qu'à un lancement : au-delà de 3 h il ne veut plus rien
  // dire (le Hub, lui, l'aura oublié bien avant).
  var MAX_AGE_MS = 3 * 3600 * 1000;
  var ID_RE = /^[A-Za-z0-9_-]{4,40}$/;

  function store() { try { return window.sessionStorage; } catch (_) { return null; } }

  // Relu comme tout ce qui vient d'ailleurs : forme exacte, sinon rien.
  function readTicket(raw, gameId, now) {
    var t;
    try { t = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (_) { return null; }
    if (!t || typeof t !== 'object' || t.v !== 1) return null;
    if (typeof t.hub !== 'string' || !/^wss?:\/\/[^\s]+$/.test(t.hub)) return null;
    if (typeof t.session !== 'string' || !/^[A-Z2-9]{5}$/.test(t.session)) return null;
    if (typeof t.playerId !== 'string' || !ID_RE.test(t.playerId)) return null;
    if (typeof t.drawId !== 'string' || !t.drawId) return null;
    if (t.role !== 'host' && t.role !== 'guest') return null;
    if (gameId && t.gameId !== gameId) return null;
    if (typeof t.at !== 'number' || (now || Date.now()) - t.at > MAX_AGE_MS) return null;
    return { v: 1, hub: t.hub, session: t.session, playerId: t.playerId, drawId: t.drawId, gameId: t.gameId, role: t.role, at: t.at };
  }

  function write(t) {
    var s = store();
    if (!s) return false;
    try { s.setItem(KEY, JSON.stringify(Object.assign({ v: 1, at: Date.now() }, t))); return true; } catch (_) { return false; }
  }
  function read(gameId) { var s = store(); return s ? readTicket(s.getItem(KEY), gameId) : null; }
  function clear() { var s = store(); if (s) try { s.removeItem(KEY); } catch (_) {} }

  // ----------------------------------------------------------- le bandeau
  // Une ligne en haut de la page du jeu : d'où l'on vient, qui est là, et le
  // chemin du retour. Construite nœud par nœud (des pseudos y passent).
  function banner() {
    var el = document.createElement('div');
    el.className = 'g-hub-banner';
    el.setAttribute('role', 'status');
    var txt = document.createElement('span');
    txt.className = 'g-hub-banner-text';
    var back = document.createElement('a');
    back.className = 'g-hub-banner-back';
    back.href = '../';
    back.textContent = '↩ Game Hub';
    el.append(txt, back);
    var main = document.querySelector('main') || document.body;
    main.insertBefore(el, main.firstChild);
    return { el: el, say: function (t) { txt.textContent = t; } };
  }

  // ------------------------------------------- livraison de results → ended
  // Le classement final et la fin de partie ne partent PAS en direct : un
  // send() sur un socket fermé ou en cours de reconnexion était jeté en
  // silence, alors que la page tenait le classement pour rapporté. Partie non
  // comptée, ou Hub bloqué en inGame / playing (ended perdu, aucune minuterie
  // n'en sort). D'où une ATTENTE, et une livraison pilotée par l'état du Hub :
  //
  //   noter (sessionStorage) → envoyer si le socket est ouvert → CONFIRMER par
  //   l'état reçu → effacer
  //
  //   - results est confirmé par `launch.scored === true` (ou RESULTS_ALREADY) ;
  //   - ended ne part qu'APRÈS cette confirmation (ou s'il n'y a pas de
  //     classement : abandon du Morpion), et il est confirmé par
  //     `launch.stage === 'ended'` ;
  //   - l'envoi n'est jamais une preuve : rien n'est effacé sur un send().
  //
  // UNE entrée par partie : clé `mathys_hub_report:<session>:<drawId>`. Elle
  // survit à la reconnexion ET à la navigation dans l'onglet (jeu → /games/ →
  // rechargement) : /games/ branche le même mécanisme sur son propre client
  // (`attach`, dans hub-page.js). Ce qui la relance, c'est chaque état reçu —
  // dont le `joined` d'une reconnexion : aucune minuterie, aucun intervalle.
  //
  // Pas de boucle : une intention part au plus UNE fois par connexion (il faut
  // un nouveau socket pour la renvoyer), et MAX_ENVOIS fois en tout. Le Hub
  // reste l'arbitre : il refuse un second classement (RESULTS_ALREADY) et
  // ignore un ended de trop. Une entrée qui ne peut plus servir — autre
  // session, autre tirage, lancement échoué, plus de 3 h — est effacée sans
  // rien envoyer : un vieux classement ne s'applique jamais à une autre partie.
  var REPORT = 'mathys_hub_report:';
  var MAX_ENVOIS = 5;
  // Refus qui ne changeront pas en réessayant : on abandonne l'intention.
  var DEFINITIFS = ['BAD_RESULTS', 'GAME_MISMATCH', 'NOT_HOST', 'LAUNCH_MISMATCH', 'NOT_LAUNCHING'];
  // Sans sessionStorage (navigation privée stricte) : en mémoire, pour cette
  // page seulement — mieux que rien, et rien ne casse.
  var sansStockage = {};

  function reportKey(session, drawId) { return REPORT + session + ':' + drawId; }
  function readReport(key) {
    var s = store(), raw = null;
    try { raw = s ? s.getItem(key) : null; } catch (_) {}
    if (raw == null) raw = sansStockage[key] || null;
    var p;
    try { p = JSON.parse(raw); } catch (_) { return null; }
    if (!p || p.v !== 1 || typeof p.session !== 'string' || typeof p.drawId !== 'string' || typeof p.gameId !== 'string') return null;
    if (reportKey(p.session, p.drawId) !== key) return null;
    if (p.results !== null && !Array.isArray(p.results)) return null;
    var sent = p.sent || {};
    return { v: 1, session: p.session, drawId: p.drawId, gameId: p.gameId, results: p.results, ended: p.ended === true,
      sent: { results: +sent.results || 0, ended: +sent.ended || 0 }, at: typeof p.at === 'number' ? p.at : 0 };
  }
  function saveReport(p) {
    var key = reportKey(p.session, p.drawId), s = store();
    try { if (s) { s.setItem(key, JSON.stringify(p)); delete sansStockage[key]; return; } } catch (_) {}
    sansStockage[key] = JSON.stringify(p);
  }
  function dropReport(key) {
    var s = store();
    try { if (s) s.removeItem(key); } catch (_) {}
    delete sansStockage[key];
  }
  function reportKeys() {
    var s = store(), out = Object.keys(sansStockage);
    try {
      if (s) for (var i = 0; i < s.length; i++) { var k = s.key(i); if (k && k.indexOf(REPORT) === 0 && out.indexOf(k) < 0) out.push(k); }
    } catch (_) {}
    return out;
  }
  // Ajoute une intention à l'entrée de CE lancement (la crée au besoin).
  function noteReport(t, patch) {
    var p = readReport(reportKey(t.session, t.drawId)) || { v: 1, session: t.session, drawId: t.drawId, gameId: t.gameId,
      results: null, ended: false, sent: { results: 0, ended: 0 }, at: Date.now() };
    if (patch.results) p.results = patch.results;
    if (patch.ended) p.ended = true;
    saveReport(p);
  }

  // Branche la livraison sur un client du Hub (GameHub.createClient) : celui de
  // la page du jeu (start, plus bas) ou celui de /games/ (hub-page.js). Rend
  // { pump } pour relancer après avoir noté une intention.
  function attach(hub) {
    if (!hub || typeof hub.on !== 'function') return null;
    var last = null;          // dernier état de session reçu
    var parti = {};           // clé + '/' + op → connexion sur laquelle c'est parti (mémoire de CETTE page)
    var enVol = null;         // { key, op } : le dernier envoi, pour lui attribuer un refus

    function envoyer(key, p, op) {
      var marque = key + '/' + op;
      var conn = hub.connection == null ? 0 : hub.connection;      // (game-hub.js d'avant : une seule « connexion »)
      if (parti[marque] === conn) return;                          // déjà parti sur ce socket : on attend l'état
      if (p.sent[op] >= MAX_ENVOIS) return abandonner(key, p, op);
      var envoye = op === 'results' ? hub.results(p.drawId, p.gameId, p.results) : hub.ended(p.drawId);
      if (envoye === false) return;                                  // socket pas ouvert : la reprise relancera
      parti[marque] = conn;
      p.sent[op]++;
      saveReport(p);
      enVol = { key: key, op: op };
    }
    function abandonner(key, p, op) {
      if (enVol && enVol.key === key && enVol.op === op) enVol = null;
      if (op === 'results') { p.results = null; saveReport(p); pump(); }
      else dropReport(key);
    }

    function pump() {
      var s = last;
      if (!s) return;
      reportKeys().forEach(function (key) {
        var p = readReport(key);
        if (!p || p.session !== s.code || Date.now() - p.at > MAX_AGE_MS) return dropReport(key);
        var l = s.launch;
        if (!l || l.drawId !== p.drawId || l.stage === 'failed') return dropReport(key);
        if (p.results) {
          if (l.scored) {                                          // confirmé
            if (enVol && enVol.key === key && enVol.op === 'results') enVol = null;
            p.results = null;
            saveReport(p);
          } else if (l.stage === 'playing' || l.stage === 'ended') {
            return envoyer(key, p, 'results');                     // ended attendra la confirmation
          } else {
            return;                                                // create / join : le Hub refuserait, on attend
          }
        }
        if (!p.ended || l.stage === 'ended') {                     // rien à finir, ou fin confirmée
          if (enVol && enVol.key === key) enVol = null;
          return dropReport(key);
        }
        envoyer(key, p, 'ended');
      });
    }

    hub.on('session', function (x) { last = x && x.session; pump(); });
    hub.on('error', function (e) {
      if (!enVol || !e) return;
      var key = enVol.key, op = enVol.op, p = readReport(key);
      if (!p) { enVol = null; return; }
      if (op === 'results' && e.code === 'RESULTS_ALREADY') {     // déjà compté : c'est une confirmation
        enVol = null;
        p.results = null;
        saveReport(p);
        return pump();
      }
      if (DEFINITIFS.indexOf(e.code) >= 0) abandonner(key, p, op);
    });
    return { pump: pump };
  }

  // ------------------------------------------------------------ démarrage
  // opts : { gameId, join(code | null), onUpdate(info) }
  // Rend null sans billet (la page reste autonome), sinon un petit objet que
  // la page du jeu prévient à trois moments : room obtenue, partie démarrée,
  // partie finie — et en cas d'échec.
  function start(opts) {
    var t = read(opts.gameId);
    if (!t || typeof GameHub === 'undefined' || typeof GameProfile === 'undefined') return null;
    var profil = GameProfile.load();
    // Le billet appartient à CE profil. Un autre profil dans le même onglet
    // (improbable, mais possible) ne rejoue pas le lancement d'un autre.
    if (profil.id !== t.playerId) { clear(); return null; }

    var b = banner();
    var hub = GameHub.createClient({ url: t.hub });
    var session = null, fini = false, joint = false, monCode = null, rapporte = false;
    var noms = function (list) {
      return (list || []).map(function (id) { var p = session && session.players.find(function (x) { return x.id === id; }); return p ? p.name : '?'; }).join(', ');
    };
    var info = function () {
      var l = session && session.launch;
      return l ? { launch: l, host: l.hostId === t.playerId, waiting: noms(l.waiting), entered: noms(l.entered), waitingIds: l.waiting } : null;
    };
    function dire() {
      var l = session && session.launch;
      if (!l) return;
      var qui = 'Game Hub · session ' + t.session;
      if (l.stage === 'create') b.say(qui + ' · création de la partie…');
      else if (l.stage === 'join') b.say(qui + ' · dans la partie : ' + noms(l.entered) + (l.waiting.length ? ' · attendus : ' + noms(l.waiting) : ''));
      // `playing` = tout le groupe attendu est dans la room (ou l'hôte est parti
      // sans les retardataires) — pas forcément que la première manche a commencé.
      else if (l.stage === 'playing') b.say(qui + ' · dans la partie : ' + noms(l.entered) + (l.missed.length ? ' · sans ' + noms(l.missed) : ''));
      else if (l.stage === 'ended') b.say(qui + ' · partie terminée — retour au Hub quand tu veux');
      else if (l.stage === 'failed') b.say(qui + ' · lancement annulé : ' + GameHub.launchFailureText(l.reason));
    }

    // Rejoindre la room du jeu : UNE fois, au bon moment.
    function peutJouer() {
      var l = session && session.launch;
      if (joint || !l || l.drawId !== t.drawId) return;
      if (l.roomCode) { joint = true; opts.join(l.roomCode); return; }
      // Pas encore de code : seul l'hôte du lancement crée la room.
      if (l.stage === 'create' && l.hostId === t.playerId) { joint = true; opts.join(null); }
    }

    hub.on('session', function (x) {
      session = x.session;
      var l = session.launch;
      // Le Hub ne parle plus de CE lancement : le billet est périmé.
      if (!l || l.drawId !== t.drawId || l.stage === 'failed' || l.stage === 'ended') {
        if (!l || l.drawId !== t.drawId) b.say('Game Hub · ce lancement n\'est plus d\'actualité — la partie reste jouable ici.');
        else dire();
        clear();
        if (opts.onUpdate) opts.onUpdate(info());
        return;
      }
      dire();
      peutJouer();
      if (opts.onUpdate) opts.onUpdate(info());
    });
    hub.on('ended', function () { b.say('Game Hub · connexion au Hub terminée — la partie continue ici.'); });
    var livraison = attach(hub);

    b.say('Game Hub · session ' + t.session + ' · connexion…');
    hub.join(t.session, GameHub.playerFrom(profil)).catch(function (e) {
      // Hub injoignable ou session disparue : la partie reste jouable, et on
      // le dit. Sans le Hub, l'invité n'a pas de code — il le demande à l'hôte.
      clear();
      b.say('Game Hub injoignable (' + e.message + ') — la partie reste jouable : ' + (t.role === 'host' ? 'crée-la et donne le code.' : 'demande le code à l\'hôte.'));
    });

    var api = {
      role: t.role,
      // La page du jeu a obtenu SA room (message du serveur du jeu).
      // `gamePlayerId` (facultatif) : l'identifiant que le serveur du jeu vient
      // de lui donner. C'est sa PLACE dans la room : le Hub s'en sert pour relier
      // le classement final à ce joueur (score de soirée). Chacun ne déclare que
      // la sienne — l'hôte ne peut pas l'écrire pour les autres.
      roomReady: function (code, gamePlayerId) {
        monCode = code;
        var l = session && session.launch;
        if (!l || l.drawId !== t.drawId) return;
        var place = gamePlayerId == null ? undefined : String(gamePlayerId);
        if (l.hostId === t.playerId && !l.roomCode) hub.launched(t.drawId, code, place);
        else hub.entered(t.drawId, code, place);
      },
      // Le classement FINAL de la partie, tel que le serveur du jeu l'a envoyé :
      // [{ gamePlayerId, rank, points }]. Seul l'hôte du lancement le rapporte,
      // une seule fois, et AVANT `ended()`. Le Hub valide tout et le convertit en
      // points de soirée — cette page ne calcule aucun score de soirée.
      // ⚠️ Noté puis LIVRÉ (voir « livraison de results → ended ») : il est
      // gardé jusqu'à ce que le Hub montre `scored`, reconnexion et retour à
      // /games/ compris. `true` = pris en charge, pas « reçu par le Hub ».
      results: function (rows) {
        if (rapporte || fini) return false;
        var l = session && session.launch;
        if (!l || l.drawId !== t.drawId || l.hostId !== t.playerId) return false;
        rapporte = true;
        noteReport(t, { results: rows });
        livraison.pump();
        return true;
      },
      // L'hôte a démarré la partie (première manche).
      started: function () {
        var l = session && session.launch;
        if (l && l.hostId === t.playerId && l.stage === 'join') hub.started(t.drawId);
      },
      // La partie est finie : retour au Hub possible, billet consommé. L'intention
      // de fin est gardée comme le classement : elle part après la confirmation
      // de celui-ci, et jusqu'à ce que le Hub montre le lancement `ended`.
      ended: function () {
        if (fini) return;
        fini = true;
        var l = session && session.launch;
        if (l && l.hostId === t.playerId) { noteReport(t, { ended: true }); livraison.pump(); }
        clear();
      },
      // Création ou entrée impossible (serveur injoignable, code refusé…).
      failed: function (reason, detail) {
        // L'HÔTE du lancement a déjà déclaré sa room et ne peut plus y revenir
        // (connexion perdue alors qu'il y était seul : la room a disparu). Elle
        // est perdue pour tout le groupe. Le Hub n'accepte un échec de l'hôte
        // qu'à la création ; au-delà, c'est une annulation — sinon le groupe
        // resterait devant « Rejoindre » une room morte jusqu'à l'échéance du
        // lancement (120 s). Mesuré : tests/presence-precision.mjs.
        var l = session && session.launch;
        if (l && l.drawId === t.drawId && l.hostId === t.playerId && l.stage === 'join') return api.cancel(detail);
        // Un nouvel essai n'a de sens qu'avant le début de la partie. En
        // `playing`, le serveur du jeu vient de refuser un retardataire : sans
        // cette garde, la diffusion suivante du Hub (le classement arrive
        // avant `ended`) le faisait entrer en douce dans la room revenue au
        // salon. Mesuré : tests/handoff-demicercle.mjs.
        if (!l || l.stage !== 'playing') joint = false;
        hub.abort(t.drawId, reason === 'UNREACHABLE' ? 'UNREACHABLE' : 'CREATE_FAILED', String(detail || '').slice(0, 120));
        b.say('Game Hub · ' + (reason === 'UNREACHABLE' ? 'serveur du jeu injoignable' : 'impossible d\'entrer dans la partie') + (detail ? ' (' + detail + ')' : '') + ' — le Hub est prévenu.');
      },
      // Annuler le lancement : tout le groupe revient au salon du Hub (raison
      // CANCELLED, que le Hub accepte déjà de l'hôte) et peut retirer.
      cancel: function (detail) {
        joint = false;
        hub.abort(t.drawId, 'CANCELLED');
        clear();
        b.say('Game Hub · la partie est perdue' + (detail ? ' (' + detail + ')' : '') + ' — lancement annulé, le groupe revient au Hub.');
      },
      code: function () { return monCode; },
      info: info,
    };
    return api;
  }

  return { KEY: KEY, MAX_AGE_MS: MAX_AGE_MS, REPORT: REPORT, readTicket: readTicket, write: write, read: read, clear: clear,
    start: start, attach: attach };
});
