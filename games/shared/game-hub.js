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
//   client → { action: 'prefs', love: [ids], veto: [ids] }     pour SOI
//   client → { action: 'caps', caps: { mic: true } }           déclaratif, pour soi
//   client → { action: 'constraints', maxMinutes }             hôte
//   client → { action: 'draw' }                                hôte — rien d'autre
//   client → { action: 'continue' }                            hôte
//   Lancement (envoyés par la PAGE DU JEU, games/shared/hub-handoff.js) :
//   client → { action: 'launched', drawId, roomCode }         hôte du lancement
//   client → { action: 'entered', drawId, roomCode }          chacun, une fois dans la room
//   client → { action: 'started' | 'ended', drawId }          hôte du lancement
//   client → { action: 'abort', drawId, reason, detail }      création / entrée impossible
//   serveur → { type: 'created' | 'joined', you, session }
//   serveur → { type: 'session', session }           à chaque changement, à tous
//   serveur → { type: 'error', code, message, why? }
//
// ⚠️ LE CLIENT NE TIRE JAMAIS. `draw` ne porte aucun champ : le serveur filtre,
// pondère et tire ; la page ne fait que mettre en scène `session.draw.gameId`.
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
  var prefsMsg = function (love, veto) { return { action: 'prefs', love: love || [], veto: veto || [] }; };
  var capsMsg = function (caps) { return { action: 'caps', caps: caps }; };
  var constraintsMsg = function (maxMinutes) { return { action: 'constraints', maxMinutes: maxMinutes == null ? null : maxMinutes }; };
  var drawMsg = function () { return { action: 'draw' }; };
  var continueMsg = function () { return { action: 'continue' }; };
  var launchedMsg = function (drawId, roomCode) { return { action: 'launched', drawId: drawId, roomCode: roomCode }; };
  var enteredMsg = function (drawId, roomCode) { return { action: 'entered', drawId: drawId, roomCode: roomCode }; };
  var startedMsg = function (drawId) { return { action: 'started', drawId: drawId }; };
  var endedMsg = function (drawId) { return { action: 'ended', drawId: drawId }; };
  var abortMsg = function (drawId, reason, detail) { return { action: 'abort', drawId: drawId, reason: reason, detail: detail }; };

  // Ce qui arrive du réseau n'est jamais pris tel quel.
  function parseMessage(raw) {
    var m;
    try { m = JSON.parse(raw); } catch (_) { return null; }
    if (!m || typeof m !== 'object' || typeof m.type !== 'string') return null;
    return m;
  }

  // L'état public d'une session, relu en LISTE BLANCHE : la page ne manipule
  // que ces champs-là.
  var ids = function (v) { return Array.isArray(v) ? v.filter(function (x) { return typeof x === 'string'; }) : []; };
  var num = function (v) { return typeof v === 'number' && isFinite(v) ? v : null; };

  function readWeights(w) {
    var out = {};
    if (w && typeof w === 'object') Object.keys(w).forEach(function (k) { if (num(w[k]) !== null) out[k] = w[k]; });
    return out;
  }

  // Le tirage : `gameId` n'existe qu'une fois le serveur décidé. `eligible` et
  // `weights` sont ceux DU MOMENT du tirage (la caisse n'affiche qu'eux).
  function readDraw(d) {
    if (!d || typeof d !== 'object' || typeof d.id !== 'string') return null;
    var status = ['pending', 'drawn', 'confirmed'].indexOf(d.status) >= 0 ? d.status : 'pending';
    return {
      id: d.id,
      n: num(d.n) || 0,
      status: status,
      by: typeof d.by === 'string' ? d.by : null,
      gameId: status !== 'pending' && typeof d.gameId === 'string' ? d.gameId : null,
      eligible: ids(d.eligible),
      weights: readWeights(d.weights),
      drawnAt: num(d.drawnAt),
      // Le Hub réveille le serveur du jeu qu'il vient de tirer (plan gratuit
      // Render : ~30 s). ⚠️ Il ne dit PAS lequel — la caisse ne doit pas être
      // éventée avant de s'ouvrir. `tried` = combien de candidats ont déjà été
      // recalés pour ce tirage. Un serveur d'avant cette version n'envoie ni
      // l'un ni l'autre : false / 0, et la page se comporte comme avant.
      waking: status === 'pending' && d.waking === true,
      tried: Math.max(0, Math.floor(num(d.tried) || 0)),
    };
  }

  // Ce que le serveur dit du catalogue pour ce groupe. `null` = serveur qui
  // ne connaît pas encore le tirage (version d'avant) : la page le dit.
  function readPool(p) {
    if (!p || typeof p !== 'object') return null;
    var why = {};
    if (p.why && typeof p.why === 'object') {
      Object.keys(p.why).forEach(function (k) {
        why[k] = (Array.isArray(p.why[k]) ? p.why[k] : []).filter(function (r) { return r && typeof r.code === 'string'; });
      });
    }
    var health = {};
    if (p.health && typeof p.health === 'object') Object.keys(p.health).forEach(function (k) { if (typeof p.health[k] === 'string') health[k] = p.health[k]; });
    return {
      catalog: ['ready', 'loading', 'error'].indexOf(p.catalog) >= 0 ? p.catalog : 'loading',
      games: ids(p.games),
      eligible: ids(p.eligible),
      why: why,
      weights: readWeights(p.weights),
      health: health,
    };
  }

  // Le lancement du jeu tiré. Le rôle de chacun s'en déduit : `hostId` est
  // l'hôte DU LANCEMENT (celui qui crée la room), tous les autres sont invités.
  var STAGES = ['create', 'join', 'playing', 'ended', 'failed'];
  function readLaunch(l) {
    if (!l || typeof l !== 'object' || typeof l.drawId !== 'string' || STAGES.indexOf(l.stage) < 0) return null;
    var failed = {};
    if (l.failed && typeof l.failed === 'object') Object.keys(l.failed).forEach(function (k) { if (typeof l.failed[k] === 'string') failed[k] = l.failed[k]; });
    return {
      drawId: l.drawId,
      gameId: typeof l.gameId === 'string' ? l.gameId : null,
      url: typeof l.url === 'string' && /^games\/[a-z0-9-]+\/$/.test(l.url) ? l.url : null,
      stage: l.stage,
      hostId: typeof l.hostId === 'string' ? l.hostId : null,
      roomCode: typeof l.roomCode === 'string' && /^[A-Z0-9]{4,8}$/.test(l.roomCode) ? l.roomCode : null,
      expected: ids(l.expected), entered: ids(l.entered), waiting: ids(l.waiting), missed: ids(l.missed),
      failed: failed,
      reason: typeof l.reason === 'string' ? l.reason : null,
      expiresInMs: num(l.expiresInMs),
    };
  }

  function readSession(s) {
    if (!s || typeof s !== 'object' || typeof s.code !== 'string') return null;
    var players = Array.isArray(s.players) ? s.players : [];
    var caps = function (c) {
      var out = {};
      if (c && typeof c === 'object') Object.keys(c).forEach(function (k) { if (c[k] === true) out[k] = true; });
      return out;
    };
    var history = s.history && typeof s.history === 'object' ? s.history : {};
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
            caps: caps(p.caps),
            love: ids(p.love),
            veto: ids(p.veto),
          };
        }),
      constraints: { maxMinutes: s.constraints ? num(s.constraints.maxMinutes) : null },
      draw: readDraw(s.draw),
      history: { played: ids(history.played) },
      launch: readLaunch(s.launch),
      pool: readPool(s.pool),
    };
  }

  // Pourquoi un jeu est exclu, en français. `nameOf(id)` rend le pseudo d'un
  // joueur (la page le connaît, pas ce module).
  function reasonText(r, nameOf) {
    var noms = function (list) {
      var n = (list || []).map(function (id) { return nameOf ? nameOf(id) : id; });
      return n.length <= 2 ? n.join(' et ') : n.slice(0, 2).join(', ') + ' et ' + (n.length - 2) + ' autre' + (n.length > 3 ? 's' : '');
    };
    var pl = function (n, mot) { return n + ' ' + mot + (n > 1 ? 's' : ''); };
    switch (r && r.code) {
      case 'TOO_FEW': return 'il faut ' + pl(r.min, 'joueur') + ', vous êtes ' + r.count;
      case 'TOO_MANY': return pl(r.max, 'joueur') + ' maximum, vous êtes ' + r.count;
      case 'LOCAL_ONLY': return 'se joue seul, sur un seul écran';
      case 'NEEDS':
        if (r.need === 'mic') return 'micro non déclaré : ' + noms(r.players);
        if (r.need === 'consent') return 'avertissement non accepté : ' + noms(r.players);
        if (r.need === 'cam') return 'caméra non déclarée : ' + noms(r.players);
        return 'capacité manquante (' + r.need + ') : ' + noms(r.players);
      case 'VETO': return 'veto de ' + noms(r.players);
      case 'TOO_LONG': return 'peut durer ' + r.max + ' min (limite : ' + r.limit + ' min)';
      case 'SERVER_DOWN': return 'serveur du jeu indisponible pour l\'instant';
      default: return 'indisponible';
    }
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
    // Randomizer.
    NOT_HOST: 'Seul l\'hôte peut faire ça.',
    DRAW_IN_PROGRESS: 'Un tirage est déjà en cours.',
    NOT_DRAWN: 'Il n\'y a pas de tirage à confirmer.',
    NO_ELIGIBLE_GAME: 'Aucun jeu n\'est possible pour ce groupe : chaque jeu dit pourquoi dans la liste.',
    // Les jeux étaient possibles, mais aucun de leurs serveurs n'a répondu :
    // ce n'est pas le groupe qui est en cause, c'est Render.
    NO_SERVER_AVAILABLE: 'Aucun serveur de jeu ne répond pour l\'instant. Ils dorment peut-être (~30 s de réveil) : réessaie.',
    MANIFEST_UNAVAILABLE: 'Le Hub n\'arrive pas à lire le catalogue des jeux. Réessaie dans un instant.',
    DRAW_FAILED: 'Le tirage a échoué. Réessaie.',
    BAD_PREFS: 'Préférences refusées par le Hub.',
    BAD_CAPS: 'Réglage refusé par le Hub.',
    BAD_CONSTRAINTS: 'Durée refusée par le Hub.',
    // Lancement.
    NOT_LAUNCHING: 'Aucun lancement n\'est en cours.',
    LAUNCH_MISMATCH: 'Ce lancement ne correspond plus au tirage en cours.',
    LAUNCH_CONSUMED: 'Le code de la partie a déjà été transmis.',
    LAUNCH_EXPIRED: 'Le lancement a expiré.',
    BAD_ROOM_CODE: 'Le code de la partie est mal formé.',
    WRONG_ROOM: 'Ce n\'est pas la partie du groupe.',
  };

  // Pourquoi un lancement a échoué (launch.reason), dit au groupe entier.
  var ECHECS = {
    LAUNCH_TIMEOUT: 'l\'hôte n\'a pas créé la partie à temps',
    HOST_LEFT: 'l\'hôte a quitté la session avant de créer la partie',
    UNREACHABLE: 'le serveur du jeu est injoignable (il dort peut-être : réessaie dans un instant)',
    SERVER_DOWN: 'le serveur du jeu est indisponible pour l\'instant',
    CREATE_FAILED: 'la partie n\'a pas pu être créée',
    CANCELLED: 'l\'hôte a annulé le lancement',
  };
  function launchFailureText(reason) { return ECHECS[reason] || 'le lancement a échoué'; }

  // Ce qu'on dit pendant qu'un tirage est en attente. Trois cas, et aucun ne
  // nomme un jeu : le Hub ne le dit pas, et la caisse ne doit pas être éventée.
  //   { titre }  la ligne en gros, ou null s'il n'y a rien à réveiller
  //   { detail } la précision sous le titre (l'attente, ou la tentative en cours)
  //   { phrase } ce qui est ANNONCÉ (lecteur d'écran) — le titre et le détail
  //              réunis, puisque le bloc visible est décoratif
  function wakingText(d) {
    if (!d || d.status !== 'pending' || !d.waking) {
      return { titre: null, detail: null, phrase: 'La caisse est secouée… le Hub prépare le tirage.' };
    }
    var n = d.tried || 0;
    if (!n) {
      return { titre: 'Réveil du serveur…', detail: 'au repos, il peut mettre ~30 s à répondre',
        phrase: 'Réveil du serveur du jeu tiré… au repos, il peut mettre ~30 s à répondre.' };
    }
    var muets = n > 1 ? n + ' serveurs muets' : '1 serveur muet';
    return { titre: 'Réveil du serveur…', detail: 'tentative ' + (n + 1) + ' · ' + muets,
      phrase: 'Réveil d\'un autre serveur… tentative ' + (n + 1) + ' (' + muets + ').' };
  }

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
        var err = { code: m.code, text: errorText(m.code, m.message), why: m.why && typeof m.why === 'object' ? m.why : null };
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
      // Réglages et tirage : on envoie une INTENTION ; la réponse est l'état
      // de session diffusé par le serveur (ou une erreur, événement `error`).
      setPrefs: function (love, veto) { send(prefsMsg(love, veto)); },
      setCaps: function (caps) { send(capsMsg(caps)); },
      setConstraints: function (maxMinutes) { send(constraintsMsg(maxMinutes)); },
      draw: function () { send(drawMsg()); },
      confirm: function () { send(continueMsg()); },
      launched: function (drawId, roomCode) { send(launchedMsg(drawId, roomCode)); },
      entered: function (drawId, roomCode) { send(enteredMsg(drawId, roomCode)); },
      started: function (drawId) { send(startedMsg(drawId)); },
      ended: function (drawId) { send(endedMsg(drawId)); },
      abort: function (drawId, reason, detail) { send(abortMsg(drawId, reason, detail)); },
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
    prefsMsg: prefsMsg, capsMsg: capsMsg, constraintsMsg: constraintsMsg, drawMsg: drawMsg, continueMsg: continueMsg,
    launchedMsg: launchedMsg, enteredMsg: enteredMsg, startedMsg: startedMsg, endedMsg: endedMsg, abortMsg: abortMsg,
    readLaunch: readLaunch, launchFailureText: launchFailureText,
    parseMessage: parseMessage, readSession: readSession, errorText: errorText, reasonText: reasonText,
    wakingText: wakingText,
    createClient: createClient,
  };
});
