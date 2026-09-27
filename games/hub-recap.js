// Débrief de soirée du Game Hub : la MISE EN FORME des données de session.
//
// ⚠️ AUCUN CALCUL DE POINTS ICI. `session.scores` et `session.history.games`
// sont tenus par le Hub (game-hub-server, scores.js), qui les tire des
// classements rendus par les jeux. Ce module trie, range et résume — c'est
// tout. Pur (aucun DOM, aucun réseau) : le même fichier tourne dans la page et
// dans tests/hub-recap.mjs.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HubRecap = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Le classement de la soirée, meilleurs d'abord, en rangs « de compétition »
  // (50, 40, 40, 10 → 1, 2, 2, 4) : un ex æquo garde le même rang, sans
  // départage inventé. À points égaux, l'ordre d'arrivée dans la session.
  //   departed: true → ajoute ceux qui ont marqué puis QUITTÉ la session (leur
  //   nom est relu dans l'historique ; ils n'ont plus d'avatar connu).
  function ranking(session, opts) {
    const sc = session.scores || {};
    const lignes = session.players.map((p, i) => ({ id: p.id, name: p.name, avatar: p.avatar, connected: p.connected, i, pts: sc[p.id] || 0, gone: false }));
    if (opts && opts.departed) {
      const connus = new Set(lignes.map((l) => l.id));
      const nomDe = {};
      (session.history.games || []).forEach((g) => g.results.forEach((r) => { nomDe[r.playerId] = r.name; }));
      Object.keys(sc).filter((id) => !connus.has(id)).forEach((id, k) => {
        lignes.push({ id, name: nomDe[id] || '?', avatar: null, connected: false, i: lignes.length + k, pts: sc[id], gone: true });
      });
    }
    lignes.sort((a, b) => b.pts - a.pts || a.i - b.i);
    lignes.forEach((l) => { l.rank = 1 + lignes.filter((x) => x.pts > l.pts).length; });
    return lignes;
  }

  // Tout le débrief, ou null s'il n'y a rien à débriefer (aucune partie
  // classée : on ne fabrique pas de faux historique).
  //   info(gameId) → { emoji, title } : l'affichage d'un jeu (data/games.js).
  function build(session, you, info) {
    const jeux = (session && session.history && session.history.games) || [];
    if (!jeux.length) return null;
    const classement = ranking(session, { departed: true }).map((l) => Object.assign(l, { me: l.id === you }));
    return assemble(session.code, classement, jeux, you, info, {
      solo: classement.length === 1 && jeux.every((g) => g.players <= 1),
      // D'autres joueurs encore connectés : la soirée continue sans toi.
      othersOnline: session.players.some((p) => p.id !== you && p.connected),
    });
  }

  // La FINALE : le podium figé par le Hub quand l'hôte a terminé la soirée
  // (game-hub-server, finale.js). Même forme que build(), mais le classement
  // est repris TEL QUEL — rangs compris : rien n'est retrié ni recompté ici.
  // Contrairement à build(), une soirée terminée sans partie a quand même son
  // écran (tout le monde à 0) : la fin a été décidée par l'hôte.
  function fromFinale(finale, you, info) {
    const classement = finale.ranking.map((l) => ({ id: l.playerId, name: l.name, avatar: l.avatar, pts: l.points, rank: l.rank,
      gone: !l.present, me: l.playerId === you }));
    const jeux = finale.games || [];
    const r = assemble(finale.code, classement, jeux, you, info, {
      solo: classement.length === 1,
      othersOnline: false,
    });
    r.by = finale.by;
    r.byName = (finale.ranking.find((l) => l.playerId === finale.by) || {}).name || null;
    return r;
  }

  function assemble(code, classement, jeux, you, info, extra) {
    const parties = jeux.map((g) => {
      const moi = g.results.find((r) => r.playerId === you) || null;
      const i = info(g.gameId);
      return {
        n: g.n,
        gameId: g.gameId,
        emoji: i.emoji,
        title: i.title,
        players: g.players,
        // Les premiers de CETTE partie (ex æquo compris), tels que le Hub les a
        // classés. Vide si personne n'y a été classé.
        winners: g.results.filter((r) => r.rank === 1).map((r) => ({ id: r.playerId, name: r.name, me: r.playerId === you })),
        me: moi ? { rank: moi.rank, points: moi.points } : null,
      };
    });
    const derniere = parties[parties.length - 1] || null;
    return {
      code,
      ranking: classement,
      games: parties,
      // Seul d'un bout à l'autre : pas de colonne « vainqueur » (ce serait lui).
      solo: extra.solo,
      facts: {
        count: parties.length,
        last: derniere ? { gameId: derniere.gameId, emoji: derniere.emoji, title: derniere.title } : null,
        lastGain: derniere && derniere.me ? derniere.me.points : null,
      },
      othersOnline: extra.othersOnline,
    };
  }

  // 1 → 🥇, 2 → 🥈, 3 → 🥉, puis « 4e ». Pour un rang de partie ou de soirée.
  const MEDAILLES = ['🥇', '🥈', '🥉'];
  const place = (rank) => (rank >= 1 && rank <= 3 ? MEDAILLES[rank - 1] : rank + 'e');

  return { ranking, build, fromFinale, place, MEDAILLES };
});
