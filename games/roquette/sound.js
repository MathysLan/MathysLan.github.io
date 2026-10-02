// Les sons : tout est SYNTHÉTISÉ par Web Audio (aucun fichier), comme
// l'Imitation et Précision. Six sons, pas un de plus : le tic d'attente, le
// tic de danger (plus rapide, plus aigu), la validation, le whoosh, l'impact
// et l'explosion. Bouton muet mémorisé ; le mouvement réduit ne coupe PAS le
// son (ce n'est pas la même préférence).
//
// Le contexte audio ne naît qu'après un geste (Créer / Rejoindre) : sans geste,
// un navigateur le laisse suspendu.
(function () {
  'use strict';
  var CLE = 'roquette_muet';
  var ctx = null, muet = false, tic = null, niveau = -1;
  try { muet = localStorage.getItem(CLE) === '1'; } catch (_) { /* stockage bloqué : son actif */ }

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { ctx = new AC(); } catch (_) { ctx = null; }
  }

  function env(g, t, a, d, v) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  function osc(type, f, t, d, v, f2) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
    env(g, t, 0.005, d, v);
    o.connect(g).connect(ctx.destination);
    o.start(t); o.stop(t + d + 0.05);
  }
  function bruit(t, d, v, de, vers, type) {
    var n = Math.floor(ctx.sampleRate * d), buf = ctx.createBuffer(1, n, ctx.sampleRate), data = buf.getChannelData(0);
    for (var i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
    var s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = buf; f.type = type || 'bandpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(de, t); f.frequency.exponentialRampToValueAtTime(vers, t + d);
    env(g, t, 0.01, d, v);
    s.connect(f).connect(g).connect(ctx.destination);
    s.start(t);
  }

  var SONS = {
    tic: function (t, n) { osc('square', 900 + n * 260, t, 0.03, 0.04 + n * 0.02); },
    valide: function (t) { osc('triangle', 520, t, 0.09, 0.18); osc('triangle', 780, t + 0.08, 0.14, 0.18); },
    whoosh: function (t) { bruit(t, 0.38, 0.35, 400, 4200); },
    impact: function (t) { osc('sine', 160, t, 0.25, 0.5, 40); },
    explosion: function (t) { bruit(t, 0.7, 0.6, 1800, 120, 'lowpass'); osc('sawtooth', 90, t, 0.45, 0.25, 30); },
  };

  function play(nom) {
    if (muet || !ctx || ctx.state !== 'running' || !SONS[nom]) return;
    SONS[nom](ctx.currentTime + 0.01, Math.max(0, niveau));
  }

  // Le tic d'un tour : de plus en plus serré avec le danger (0 → 3). -1 = silence.
  var PERIODES = [900, 620, 380, 210];
  function danger(n) {
    if (n === niveau) return;
    niveau = n;
    clearInterval(tic); tic = null;
    if (n < 0) return;
    tic = setInterval(function () { play('tic'); }, PERIODES[n]);
  }

  function setMuet(v) {
    muet = !!v;
    try { localStorage.setItem(CLE, muet ? '1' : '0'); } catch (_) { /* tant pis : le choix vaut pour la visite */ }
  }

  window.Sons = { init: init, play: play, danger: danger, setMuet: setMuet, get muet() { return muet; } };
})();
