// Handoff Hub → Le Passeur, protocole RÉEL : le vrai game-hub-server et le
// VRAI passeur-server, lancés en local depuis les dépôts voisins, et trois
// joueurs en Node. Aucun mock : le code de room est celui que passeur-server
// fabrique, et la partie va jusqu'à une manche jouée et notée.
//
//   node tests/handoff.mjs
//
// A crée le Hub, B et C rejoignent → A tire Le Passeur → A = host, B/C =
// guest → A crée la room Passeur (join SANS code, le protocole normal du jeu)
// → vrai code → A le déclare au Hub → B et C le reçoivent (« go ») → B et C
// rejoignent CE code → entered → côté Passeur, A + B + C dans UNE room → A
// démarre → manche, réponses, résultats.
//
// Le « navigateur » de chacun est simulé fidèlement : le client du Hub de
// /games/ se coupe (navigation), et la « page du jeu » ouvre un nouveau client
// du Hub avec le même player.id — exactement ce que fait hub-handoff.js.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeHealth, localManifest } from './hub-fixture.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const H = require(path.join(ROOT, 'games/shared/game-hub.js'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = () => Math.floor(Math.random() * 300);
const HUB_PORT = 8200 + R(), PASSEUR_PORT = 8600 + R(), HEALTH_PORT = 6700 + R();

let out = [], ko = 0;
const t = (nom, ok, detail = '') => {
  out.push(`${ok ? 'OK  ' : 'KO  '} ${nom}${detail ? ' — ' + detail : ''}`);
  if (!ok) ko++;
  console.log(out[out.length - 1]);
};

// --- serveurs réels -----------------------------------------------------------
const procs = [];
const lance = (cwd, file, port, env = {}) => {
  const p = spawn(process.execPath, [file], { cwd, env: { ...process.env, PORT: String(port), HUB_QUIET: '1', ...env }, stdio: 'ignore' });
  procs.push(p); return p;
};
async function attends(url) { for (let i = 0; i < 100; i++) { try { const r = await fetch(url); if (r.ok) return; } catch (_) {} await sleep(100); } throw new Error('injoignable : ' + url); }

const sante = await fakeHealth(HEALTH_PORT);
const MANIFEST = localManifest(ROOT, HEALTH_PORT, { passeur: `http://127.0.0.1:${PASSEUR_PORT}/` });
lance(path.join(ROOT, '..', 'passeur-server'), 'server.js', PASSEUR_PORT);
lance(path.join(ROOT, '..', 'game-hub-server'), 'src/server.js', HUB_PORT, { MANIFEST_FILE: MANIFEST });
await attends(`http://127.0.0.1:${PASSEUR_PORT}/`);
await attends(`http://127.0.0.1:${HUB_PORT}/health`);
const HUB = `ws://127.0.0.1:${HUB_PORT}`;

// --- clients --------------------------------------------------------------------
function suivi(client) {
  const s = { last: null, hist: [], errors: [] };
  client.on('session', (x) => { s.last = x.session; s.hist.push(x.session); });
  client.on('error', (e) => s.errors.push(e));
  s.until = async (cond, ms = 8000) => { const fin = Date.now() + ms; while (Date.now() < fin) { if (s.last && cond(s.last)) return s.last; await sleep(20); } return null; };
  return s;
}
const hubClient = () => H.createClient({ url: HUB, retryDelays: [], connectTimeout: 5000 });

// Le client du jeu : un WebSocket vers passeur-server, rien d'autre.
function passeur() {
  const ws = new WebSocket(`ws://127.0.0.1:${PASSEUR_PORT}`);
  const c = { ws, msgs: [] };
  ws.onmessage = (e) => c.msgs.push(JSON.parse(e.data));
  c.open = new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('passeur injoignable')); });
  c.send = (o) => ws.send(JSON.stringify(o));
  c.wait = async (pred, ms = 8000) => { const fin = Date.now() + ms; while (Date.now() < fin) { const m = c.msgs.find(pred); if (m) return m; await sleep(20); } return null; };
  c.last = (type) => [...c.msgs].reverse().find((m) => m.type === type);
  return c;
}

const IMG = 'data:image/webp;base64,' + fs.readFileSync(path.join(ROOT, '..', 'passeur-server', 'test-fixtures', 'avatar-96.webp')).toString('base64');
const pA = { id: 'p_alicehnd', name: 'Alice', avatar: { kind: 'image', emoji: '🦊', src: IMG } };
const pB = { id: 'p_brunohnd', name: 'Bruno', avatar: { kind: 'emoji', emoji: '🐼' } };
const pC = { id: 'p_chloehnd', name: 'Chloé', avatar: { kind: 'emoji', emoji: '👻' } };
const joinPasseur = (p) => ({ action: 'join', name: p.name, avatar: p.avatar });

console.log(`Handoff Hub → Le Passeur — protocole réel (Hub :${HUB_PORT}, Passeur :${PASSEUR_PORT})\n`);
try {
  // ═══ 1. le groupe, et un tirage qui ne peut donner que Le Passeur
  const A = hubClient(), B = hubClient(), C = hubClient();
  const sA = suivi(A), sB = suivi(B), sC = suivi(C);
  const code = (await A.create(pA)).session.code;
  await B.join(code, pB); await C.join(code, pC);
  await sA.until((s) => s.pool && s.pool.catalog === 'ready' && s.players.length === 3);
  B.setPrefs([], ['demicercle', 'precision', 'quiment']);
  const seul = await sA.until((s) => JSON.stringify(s.pool.eligible) === '["passeur"]');
  t('le groupe (3) : seul Le Passeur est éligible (vetos de B)', !!seul, JSON.stringify(sA.last.pool.eligible));
  A.draw();
  const tire = await sA.until((s) => s.draw && s.draw.status === 'drawn');
  t('tirage serveur : Le Passeur', tire && tire.draw.gameId === 'passeur');
  const drawId = tire.draw.id;

  // ═══ 2. continuer → lancement, rôles
  A.confirm();
  const l0 = await sB.until((s) => s.state === 'launching');
  t('continuer → launching (stage create), lié au tirage', l0 && l0.launch.stage === 'create' && l0.launch.drawId === drawId);
  t('rôles : A host, B et C guest', l0.launch.hostId === pA.id && sC.last.launch.hostId !== pC.id);
  t('le Hub donne l\'URL du jeu (manifest)', l0.launch.url === 'games/passeur/');

  // ═══ 3. A « navigue » : sa page du Hub se ferme, la page du jeu rouvre le Hub
  A._drop();
  await sB.until((s) => s.players.find((p) => p.id === pA.id).connected === false, 4000);
  const A2 = hubClient(), sA2 = suivi(A2);
  await A2.join(code, pA);
  t('navigation de A : même player.id, toujours hôte du lancement', sA2.last.hostId === pA.id && sA2.last.launch.hostId === pA.id && sA2.last.players.length === 3);

  // ═══ 4. A crée la room par le protocole NORMAL du Passeur : join sans code
  const PA = passeur(); await PA.open;
  PA.send(joinPasseur(pA));
  const youA = await PA.wait((m) => m.type === 'you');
  t('Passeur : room créée par un join SANS code, vrai code renvoyé', !!youA && /^[A-Z]{4}$/.test(youA.code) && youA.host === true, youA && youA.code);
  const roomCode = youA.code;

  // Un invité tente de déclarer SA room à la place de l'hôte.
  const errB0 = sB.errors.length;
  B.launched(drawId, 'ZZZZ');
  await sleep(300);
  t('un guest qui déclare un code : refusé (NOT_HOST)', sB.errors.length > errB0 && sB.errors[sB.errors.length - 1].code === 'NOT_HOST');

  A2.launched(drawId, roomCode);
  const go = await sB.until((s) => s.launch && s.launch.stage === 'join');
  t('go : B et C reçoivent LE code de la room créée par A', go && go.launch.roomCode === roomCode && (await sC.until((s) => s.launch.roomCode === roomCode)));
  t('waiting : B et C attendus, A déjà dedans', JSON.stringify(go.launch.entered) === JSON.stringify([pA.id]) && go.launch.waiting.length === 2);

  // ═══ 5. B et C « naviguent » et rejoignent LE code
  const pages = {};
  for (const [nom, X, p] of [['B', B, pB], ['C', C, pC]]) {
    X._drop();
    const X2 = hubClient(), s2 = suivi(X2);
    await X2.join(code, p);
    const PX = passeur(); await PX.open;
    PX.send({ ...joinPasseur(p), code: s2.last.launch.roomCode });       // le code vient du HUB, pas d'une saisie
    const you = await PX.wait((m) => m.type === 'you');
    t(`${nom} : entré dans la room Passeur par le protocole normal (join + code)`, !!you && you.code === roomCode && you.host === false);
    X2.entered(drawId, you.code);
    pages[nom] = { X2, s2, PX, you };
  }
  const enJeu = await sA2.until((s) => s.state === 'inGame');
  t('Hub : tout le monde est entré → inGame, personne en attente', enJeu && enJeu.launch.waiting.length === 0 && enJeu.launch.entered.length === 3);

  // ═══ 6. UNE room côté Passeur, vue par le serveur du jeu
  await sleep(200);
  const lob = PA.last('lobby');
  t('Passeur : A + B + C dans LA MÊME room (lobby vu par le serveur du jeu)',
    lob && lob.code === roomCode && lob.players.length === 3
    && ['Alice', 'Bruno', 'Chloé'].every((n) => lob.players.some((p) => p.name === n)), lob && lob.players.map((p) => p.name).join(','));
  t('roomCode A === B === C', youA.code === pages.B.you.code && pages.B.you.code === pages.C.you.code);
  const pa = lob.players.find((p) => p.name === 'Alice');
  t('la vraie PP de A arrive dans Le Passeur (image, pas l\'emoji)', pa.avatar && pa.avatar.kind === 'image' && pa.avatar.src === IMG);
  t('B et C y arrivent avec leur emoji', lob.players.find((p) => p.name === 'Bruno').avatar.emoji === '🐼');

  // ═══ 7. une vraie partie : A démarre, une manche se joue
  PA.send({ action: 'start', rounds: 3 });
  const round = await pages.C.PX.wait((m) => m.type === 'round');
  t('A démarre : C reçoit une vraie manche (situation, scène)', !!round && !!round.ctx && !!round.scene, round && round.ctx);
  A2.started(drawId);
  const gos = await Promise.all([PA, pages.B.PX, pages.C.PX].map((P) => P.wait((m) => m.type === 'go', 8000)));
  t('les trois reçoivent « À TOI » (le serveur du jeu ouvre la fenêtre)', gos.every(Boolean));
  const legal = Object.entries(round.scene.options || {}).filter(([, o]) => o.legal !== false).map(([id]) => id);
  for (const P of [PA, pages.B.PX, pages.C.PX]) P.send({ action: 'answer', passId: legal[0] });
  const res = await PA.wait((m) => m.type === 'results');
  t('manche jouée et notée par le serveur du Passeur (3 résultats)', !!res && res.results.length === 3, res && res.results.map((r) => `${r.name} +${r.points}`).join(', '));
  t('Hub : toujours inGame pendant la partie', sA2.last.state === 'inGame');

  // ═══ 8. fin → retour au Hub
  A2.ended(drawId);
  const deb = await sB.until((s) => s.state === 'debrief') || await pages.B.s2.until((s) => s.state === 'debrief');
  t('ended : le Hub revient en debrief, prêt pour un nouveau tirage', !!deb && deb.launch.stage === 'ended' && deb.history.played[0] === 'passeur');

  for (const P of [PA, pages.B.PX, pages.C.PX]) { try { P.ws.close(); } catch (_) {} }
  for (const X of [A2, pages.B.X2, pages.C.X2]) { try { X.leave(); } catch (_) {} }
  await sleep(200);
} catch (e) {
  t('EXCEPTION', false, e && (e.stack || e.message));
} finally {
  procs.forEach((p) => { try { p.kill(); } catch (_) {} });
  sante.close();
  try { fs.unlinkSync(MANIFEST); } catch (_) {}
}
console.log(`\n${ko ? 'DES TESTS ÉCHOUENT' : 'TOUT PASSE'} — ${out.length} vérifications, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
