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
    var session = null, fini = false, joint = false, monCode = null;
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

    b.say('Game Hub · session ' + t.session + ' · connexion…');
    hub.join(t.session, GameHub.playerFrom(profil)).catch(function (e) {
      // Hub injoignable ou session disparue : la partie reste jouable, et on
      // le dit. Sans le Hub, l'invité n'a pas de code — il le demande à l'hôte.
      clear();
      b.say('Game Hub injoignable (' + e.message + ') — la partie reste jouable : ' + (t.role === 'host' ? 'crée-la et donne le code.' : 'demande le code à l\'hôte.'));
    });

    return {
      role: t.role,
      // La page du jeu a obtenu SA room (message du serveur du jeu).
      roomReady: function (code) {
        monCode = code;
        var l = session && session.launch;
        if (!l || l.drawId !== t.drawId) return;
        if (l.hostId === t.playerId && !l.roomCode) hub.launched(t.drawId, code);
        else hub.entered(t.drawId, code);
      },
      // L'hôte a démarré la partie (première manche).
      started: function () {
        var l = session && session.launch;
        if (l && l.hostId === t.playerId && l.stage === 'join') hub.started(t.drawId);
      },
      // La partie est finie : retour au Hub possible, billet consommé.
      ended: function () {
        if (fini) return;
        fini = true;
        var l = session && session.launch;
        if (l && l.hostId === t.playerId) hub.ended(t.drawId);
        clear();
      },
      // Création ou entrée impossible (serveur injoignable, code refusé…).
      failed: function (reason, detail) {
        joint = false;
        hub.abort(t.drawId, reason === 'UNREACHABLE' ? 'UNREACHABLE' : 'CREATE_FAILED', String(detail || '').slice(0, 120));
        b.say('Game Hub · ' + (reason === 'UNREACHABLE' ? 'serveur du jeu injoignable' : 'impossible d\'entrer dans la partie') + (detail ? ' (' + detail + ')' : '') + ' — le Hub est prévenu.');
      },
      code: function () { return monCode; },
      info: info,
    };
  }

  return { KEY: KEY, MAX_AGE_MS: MAX_AGE_MS, readTicket: readTicket, write: write, read: read, clear: clear, start: start };
});
