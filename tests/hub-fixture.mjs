// Montage local du Game Hub pour les tests : le VRAI serveur, le VRAI
// catalogue, mais des serveurs de jeu simulés — seulement leur /health.
//
// Pourquoi : le Hub vérifie la santé des jeux par un GET sur leur URL `health`
// (celles de Render). Un test local ne doit ni réveiller les sept serveurs de
// production, ni dépendre du réseau. On reprend donc data/games.manifest.json
// TEL QUEL (bornes, durées, besoins, modes — les vraies valeurs) et on ne
// redirige que les URL `health` vers un petit serveur HTTP local, qui peut
// rendre un jeu malade à la demande.
import { createServer } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Le serveur de santé : GET /<gameId> → 200, sauf réglage contraire.
// `set(id, { code, delay })` fige une réponse ; `set(id, { seq: [503, 503, 200] })`
// en donne une par requête (la dernière reste) — c'est un serveur Render qui se
// RÉVEILLE, pas un serveur mort, et c'est le seul moyen d'observer une attente.
export function fakeHealth(port) {
  const sante = {};             // gameId → { code, delay } | { seq, delay }
  const appels = [];            // { id, method, upgrade }
  const srv = createServer((req, res) => {
    const id = req.url.replace(/^\//, '').split('?')[0];
    appels.push({ id, method: req.method, upgrade: !!req.headers.upgrade });
    const c = sante[id] || { code: 200, delay: 0 };
    if (Array.isArray(c.seq)) c.code = c.seq.length > 1 ? c.seq.shift() : c.seq[0];
    setTimeout(() => { res.writeHead(c.code); res.end(c.code === 200 ? 'ok' : 'ko'); }, c.delay || 0);
  });
  return new Promise((r) => srv.listen(port, '127.0.0.1', () => r({
    srv, appels, set: (id, v) => { sante[id] = v; }, close: () => srv.close(),
  })));
}

// Le manifest réel, avec les URL de santé redirigées. Rend le chemin du fichier.
// `vrais` : { gameId: url } pour pointer un jeu vers un VRAI serveur local (le
// Passeur des tests de handoff répond 200 sur n'importe quel chemin).
// `opts.sansHandoff` : aucun jeu lançable (tests du SEUL randomizer : « continuer »
// y revient au Hub, comme avant le handoff).
export function localManifest(root, healthPort, vrais = {}, opts = {}) {
  const m = JSON.parse(fs.readFileSync(path.join(root, 'data', 'games.manifest.json'), 'utf8'));
  for (const g of m.games) if (g.mode === 'online') g.health = vrais[g.id] || `http://127.0.0.1:${healthPort}/${g.id}`;
  if (opts.sansHandoff) for (const g of m.games) g.handoff = false;
  const f = path.join(os.tmpdir(), `hub-manifest-${process.pid}-${healthPort}.json`);
  fs.writeFileSync(f, JSON.stringify(m));
  return f;
}
