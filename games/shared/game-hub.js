// Client du Game Hub : le connecteur entre /games/ et game-hub-server.
//
//   page /games/  →  game-hub.js  →  WebSocket  →  game-hub-server
//
// Ce fichier ne dessine RIEN et ne connaît aucune règle de jeu. Il parle le
// protocole du Hub (lu dans game-hub-server/src/hub.js, pas deviné), tient
// l'état de la connexion, et prévient la page par des événements. Le profil
// local reste l'affaire de game-profile.js, l'affichage des avatars celle de
// game-avatar.js.
//
// Protocole (game-hub-server, protocolVersion 1) :
//   client → { action: 'create', player }            player = { id, name, avatar }
//   client → { action: 'join', code, player }        même id = reprise de SA place
//   client → { action: 'leave' }
//   serveur → { type: 'created' | 'joined', you, session }
//   serveur → { type: 'session', session }           à chaque changement, à tous
//   serveur → { type: 'error', code, message }
//
// Chargé tel quel par le navigateur (window.GameHub) ET par Node (require), pour
// que les tests unitaires jouent contre le vrai serveur plutôt qu'un mock.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GameHub = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------- configuration
  // UN seul endroit. Le portfolio parle à la production ; un test (ou un
  // développeur) passe `?hub=ws://localhost:8100` dans l'URL de la page.
  var PROD = 'wss://game-hub-server-qqdk.onrender.com';

  function hubUrl(search) {
    var q = null;
    try { q = new URLSearchParams(search || '').get('hub'); } catch (_) { /* pas d'URLSearchParams */ }
    return q && /^wss?:\/\/[^\s]+$/.test(q) ? q : PROD;
  }

  // L'adresse HTTP du même serveur, pour /health (savoir s'il est réveillé).
  function healthUrl(ws) {
    return ws.replace(/^ws/, 'http').replace(/\/+$/, '') + '/health';
  }

  // -------------------------------------------------------------- codes
  // Le code est TOUJOURS celui du serveur ; on ne fait que reconnaître un code
  // bien formé avant d'embêter le réseau. Mêmes règles que codes.js du Hub :
  // 5 signes, alphabet sans I / L / O / 0 / 1, minuscules et espaces pardonnés.
  var ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  var CODE_LENGTH = 5;

  function normalizeCode(raw) {
    if (typeof raw !== 'string') return null;
    var c = raw.trim().toUpperCase();
    if (c.length !== CODE_LENGTH) return null;
    for (var i = 0; i < c.length; i++) if (ALPHABET.indexOf(c[i]) < 0) return null;
    return c;
  }

  // ------------------------------------------------------------ messages
  // L'identité qui part au Hub : l'avatar COMPLET (photo comprise). Le Hub
  // garde l'image ; c'est lui qui l'affiche dans le salon.
  function playerFrom(profile) {
    var a = (profile && profile.avatar) || {};
    var avatar = { kind: a.kind === 'image' && a.src ? 'image' : 'emoji', emoji: a.emoji };
    if (avatar.kind === 'image') avatar.src = a.src;
    return { id: profile && profile.id, name: ((profile && profile.name) || '').trim(), avatar: avatar };
  }

  var createMsg = function (player) { return { action: 'create', player: player }; };
  var joinMsg = function (code, player) { return { action: 'join', code: code, player: player }; };
  var leaveMsg = function () { return { action: 'leave' }; };

  // Ce qui arrive du réseau n'est jamais pris tel quel.
  function parseMessage(raw) {
    var m;
    try { m = JSON.parse(raw); } catch (_) { return null; }
    if (!m || typeof m !== 'object' || typeof m.type !== 'string') return null;
    return m;
  }

  // L'état public d'une session, relu en LISTE BLANCHE : la page ne manipule
  // que ces champs-là. `caps` / `veto` / `love` / `draw` / `history` existent
  // sur le fil mais ne servent pas encore — on ne les recopie pas.
  function readSession(s) {
    if (!s || typeof s !== 'object' || typeof s.code !== 'string') return null;
    var players = Array.isArray(s.players) ? s.players : [];
    return {
      code: s.code,
      state: typeof s.state === 'string' ? s.state : 'lobby',
      hostId: typeof s.hostId === 'string' ? s.hostId : null,
      maxPlayers: typeof s.maxPlayers === 'number' ? s.maxPlayers : 12,
      players: players
        .filter(function (p) { return p && typeof p.id === 'string'; })
        .map(function (p) {
          return {
            id: p.id,
            name: typeof p.name === 'string' ? p.name : '?',
            avatar: p.avatar,              // interprété par GameAvatar, jamais ici
            connected: p.connected !== false,
            host: p.id === s.hostId,
          };
        }),
    };
  }

  // Codes du serveur → phrases lisibles. Jamais d'erreur brute à l'écran.
  var TEXTES = {
    SESSION_NOT_FOUND: 'Aucune session avec ce code. Vérifie-le avec la personne qui l\'a créée.',
    SESSION_FULL: 'Cette session est complète (12 joueurs maximum).',
    SESSION_CLOSED: 'Cette session est terminée.',
    BAD_CODE: 'Ce code n\'a pas le bon format : 5 caractères, sans I, L, O, 0 ni 1.',
    BAD_PLAYER: 'Ton profil a été refusé par le Hub.',
    ALREADY_IN_SESSION: 'Tu es déjà dans une session.',
    NOT_IN_SESSION: 'Tu n\'es dans aucune session.',
    REPLACED: 'Ta session a été reprise dans un autre onglet ou sur un autre appareil.',
    TOO_BIG: 'Ton profil est trop lourd pour le Hub (la photo ?).',
    BAD_JSON: 'Le Hub n\'a pas compris la demande. Recharge la page.',
    UNKNOWN_ACTION: 'Le Hub n\'a pas compris la demande. Recharge la page.',
    NETWORK: 'Impossible de joindre le Hub. S\'il dormait, il met ~30 s à se réveiller : réessaie.',
  };

  function errorText(code, message) {
    if (TEXTES[code]) {
      // BAD_PLAYER : le serveur dit POURQUOI (« il faut un pseudo »…), en français.
      if (code === 'BAD_PLAYER' && typeof message === 'string' && message) return 'Profil refusé : ' + message + '.';
      return TEXTES[code];
    }
    return 'Le Hub a refusé la demande.';
  }

  // --------------------------------------------------------------- client
  // États : idle → connecting → in-session ⇄ reconnecting ; ended (fin).
  // Événements : status, session, error, ended.
  function createClient(options) {
    options = options || {};
    var url = options.url || PROD;
    var WS = options.WebSocket || (typeof WebSocket !== 'undefined' ? WebSocket : null);
    var delays = options.retryDelays || [1000, 2000, 4000, 8000, 15000, 15000, 15000];
    var connectTimeout = options.connectTimeout || 45000;

    var ws = null, status = 'idle', you = null, session = null, player = null, code = null;
    var pending = null;           // { resolve, reject } de create/join en cours
    var retry = 0, retryTimer = null, closedByUs = false;
    var handlers = {};

    function emit(ev, data) { (handlers[ev] || []).forEach(function (fn) { try { fn(data); } catch (_) {} }); }
    function setStatus(s) { if (status !== s) { status = s; emit('status', s); } }

    function open() {
      return new Promise(function (resolve, reject) {
        if (!WS) return reject(fail('NETWORK'));
        var sock;
        try { sock = new WS(url); } catch (_) { return reject(fail('NETWORK')); }
        var timer = setTimeout(function () { try { sock.close(); } catch (_) {} reject(fail('NETWORK')); }, connectTimeout);
        sock.onopen = function () { clearTimeout(timer); resolve(sock); };
        sock.onerror = function () { /* onclose suit */ };
        sock.onclose = function () { clearTimeout(timer); reject(fail('NETWORK')); };
      });
    }

    function fail(code, message) {
      var e = new Error(errorText(code, message));
      e.code = code;
      return e;
    }

    function wire(sock) {
      ws = sock;
      sock.onmessage = function (ev) { onMessage(parseMessage(ev.data)); };
      sock.onclose = function (ev) { onClose(sock, ev); };
    }

    function send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }

    function onMessage(m) {
      if (!m) return;
      if (m.type === 'created' || m.type === 'joined') {
        var s = readSession(m.session);
        if (!s) return;
        you = m.you; session = s; code = s.code; retry = 0;
        setStatus('in-session');
        emit('session', { session: s, you: you });
        if (pending) { pending.resolve({ session: s, you: you }); pending = null; }
        return;
      }
      if (m.type === 'session') {
        var s2 = readSession(m.session);
        if (!s2) return;
        session = s2;
        emit('session', { session: s2, you: you });
        return;
      }
      if (m.type === 'error') {
        var err = { code: m.code, text: errorText(m.code, m.message) };
        // Remplacé ailleurs : on NE revient PAS tout seul, sinon deux onglets du
        // même profil s'éjecteraient l'un l'autre en boucle.
        if (m.code === 'REPLACED') { closedByUs = true; setStatus('ended'); emit('ended', err); return; }
        // Pendant une reprise, une session disparue termine l'histoire proprement.
        if (status === 'reconnecting' && (m.code === 'SESSION_NOT_FOUND' || m.code === 'SESSION_CLOSED')) {
          end(err); return;
        }
        if (pending) { pending.reject(fail(m.code, m.message)); pending = null; return; }
        emit('error', err);
      }
    }

    function onClose(sock, ev) {
      if (sock !== ws) return;
      ws = null;
      if (pending) { pending.reject(fail('NETWORK')); pending = null; }
      if (closedByUs || !code || !player) { if (status !== 'ended') setStatus(code ? 'ended' : 'idle'); return; }
      // Fermeture 4001 = remplacé ailleurs (le message error l'a déjà dit).
      if (ev && ev.code === 4001) return;
      scheduleRetry();
    }

    // Reprise : on se reconnecte et on rejoue un `join` avec le MÊME player.id.
    // Le serveur reconnaît l'id et rend sa place au joueur — pas de doublon.
    function scheduleRetry() {
      if (retry >= delays.length) { end({ code: 'NETWORK', text: 'Connexion au Hub perdue.' }); return; }
      setStatus('reconnecting');
      var wait = delays[retry++];
      clearTimeout(retryTimer);
      retryTimer = setTimeout(function () {
        open().then(function (sock) {
          wire(sock);
          send(joinMsg(code, player));
        }, function () { scheduleRetry(); });
      }, wait);
    }

    function end(err) {
      closedByUs = true;
      clearTimeout(retryTimer);
      try { if (ws) ws.close(); } catch (_) {}
      ws = null; session = null; code = null;
      setStatus('ended');
      emit('ended', err);
    }

    // create / join : ouvre la connexion, envoie, attend la réponse du serveur.
    function start(msgFn, p) {
      if (status === 'connecting' || status === 'in-session' || status === 'reconnecting') {
        return Promise.reject(fail('ALREADY_IN_SESSION'));
      }
      player = p; closedByUs = false; retry = 0;
      setStatus('connecting');
      return open().then(function (sock) {
        wire(sock);
        return new Promise(function (resolve, reject) {
          pending = { resolve: resolve, reject: reject };
          send(msgFn());
        });
      }).catch(function (e) {
        closedByUs = true;
        try { if (ws) ws.close(); } catch (_) {}
        ws = null; code = null;
        setStatus('idle');
        throw e;
      });
    }

    return {
      on: function (ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); return this; },
      create: function (p) { return start(function () { return createMsg(p); }, p); },
      join: function (c, p) {
        var n = normalizeCode(c);
        if (!n) return Promise.reject(fail('BAD_CODE'));
        code = n;
        return start(function () { return joinMsg(n, p); }, p);
      },
      // Départ volontaire : le serveur retire le joueur tout de suite.
      leave: function () {
        closedByUs = true;
        clearTimeout(retryTimer);
        send(leaveMsg());
        var s = ws; ws = null;
        // Laisse au message le temps de partir avant de fermer.
        if (s) setTimeout(function () { try { s.close(); } catch (_) {} }, 50);
        session = null; code = null;
        setStatus('idle');
      },
      get status() { return status; },
      get session() { return session; },
      get you() { return you; },
      get code() { return code; },
      // Pour les tests : coupe le socket SANS `leave`, comme une perte réseau.
      _drop: function () { if (ws) ws.close(); },
    };
  }

  return {
    PROD: PROD, ALPHABET: ALPHABET, CODE_LENGTH: CODE_LENGTH,
    hubUrl: hubUrl, healthUrl: healthUrl, normalizeCode: normalizeCode,
    playerFrom: playerFrom, createMsg: createMsg, joinMsg: joinMsg, leaveMsg: leaveMsg,
    parseMessage: parseMessage, readSession: readSession, errorText: errorText,
    createClient: createClient,
  };
});
