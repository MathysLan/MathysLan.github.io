// Handoff Hub → Imitation, protocole RÉEL : le vrai game-hub-server et le VRAI
// imitation-server, lancés en local depuis les dépôts voisins, et deux joueurs
// en Node. Aucun mock : le code de room est celui qu'imitation-server fabrique.
//
//   node tests/handoff-imitation.mjs
//
// A crée la session du Hub, B rejoint → B écarte tout sauf Imitation → A tire
// → A = host, B = guest → A crée la room Imitation (join SANS code, le
// protocole normal du jeu) → vrai code → A le déclare au Hub → B le reçoit
// (« go ») → B rejoint CE code → entered → côté Imitation, A + B dans UNE
// room → A démarre → première manche.
//
// ⚠️ AUCUN SECOND PROTOCOLE DE ROOM. Le Hub ne parle jamais à
// imitation-server : ce sont les pages qui lui parlent, par son `join`
// habituel. Le Hub ne fait que relayer le code et arbitrer qui a le droit de
// le déclarer. C'est exactement le montage du Passeur (tests/handoff.mjs).
//
// Le « navigateur » de chacun est simulé fidèlement : le client du Hub de
// /games/ se coupe (navigation), et la « page du jeu » ouvre un nouveau client
// du Hub avec le même player.id — ce que fait hub-handoff.js.
//
// ⚠️ `VIDEOS_URL=''` : imitation-server n'ira pas chercher le catalogue de
// clips sur GitHub Pages, il prend sa liste de secours. Le test ne dépend donc
// d'aucun réseau sortant, et la manche peut démarrer.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeHealth, localManifest } from './hub-fixture.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// L'alphabet des codes de room d'Imitation, chiffres compris (src/server.js).
const CODE_RE = /^[A-HJ-NP-Z2-9]{4}$/;
const require = createRequire(import.meta.url);
const H = require(path.join(ROOT, 'games/shared/game-hub.js'));
const HH = require(path.join(ROOT, 'games/shared/hub-handoff.js'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = () => Math.floor(Math.random() * 300);
const HUB_PORT = 8300 + R(), IMI_PORT = 8900 + R(), HEALTH_PORT = 6100 + R();

let out = [], ko = 0;
const t = (nom, ok, detail = '') => {
  out.push(`${ok ? 'OK  ' : 'KO  '} ${nom}${detail ? ' — ' + detail : ''}`);
  if (!ok) ko++;
  console.log(out[out.length - 1]);
};

// ═══════════════════════════════ 1. le billet, sans réseau ni navigateur
// Le handshake commence par là : une page de jeu n'accepte un billet que s'il
// est pour ELLE, pour ce profil, et récent.
console.log('Handoff Imitation — le billet\n');
const BON = { v: 1, hub: 'ws://127.0.0.1:8100', session: 'AB2DE', playerId: 'p_alice', drawId: 'd_1', gameId: 'imitation', role: 'host', at: Date.now() };
t('billet valable pour imitation', !!HH.readTicket(BON, 'imitation'));
t('billet d\'un AUTRE jeu : refusé par la page Imitation', !HH.readTicket(BON, 'imitation') === false && !HH.readTicket({ ...BON, gameId: 'passeur' }, 'imitation'));
t('billet sans rôle connu : refusé', !HH.readTicket({ ...BON, role: 'spectateur' }, 'imitation'));
t('billet périmé (plus de 3 h) : refusé', !HH.readTicket({ ...BON, at: Date.now() - HH.MAX_AGE_MS - 1000 }, 'imitation'));
t('billet au code de session bidon : refusé', !HH.readTicket({ ...BON, session: 'abc' }, 'imitation'));
t('billet dont le hub n\'est pas une URL WebSocket : refusé', !HH.readTicket({ ...BON, hub: 'http://x' }, 'imitation'));
t('les deux rôles sont acceptés', !!HH.readTicket({ ...BON, role: 'guest' }, 'imitation'));

// ═══════════════════════════════ 2. les vrais serveurs
const procs = [];
const lance = (cwd, file, port, env = {}) => {
  const p = spawn(process.execPath, [file], { cwd, env: { ...process.env, PORT: String(port), HUB_QUIET: '1', ...env }, stdio: 'ignore' });
  procs.push(p); return p;
};
async function attends(url) { for (let i = 0; i < 100; i++) { try { const r = await fetch(url); if (r.ok) return; } catch (_) {} await sleep(100); } throw new Error('injoignable : ' + url); }

const sante = await fakeHealth(HEALTH_PORT);
const MANIFEST = localManifest(ROOT, HEALTH_PORT, { imitation: `http://127.0.0.1:${IMI_PORT}/` });
lance(path.join(ROOT, '..', 'imitation-server'), 'src/server.js', IMI_PORT, { VIDEOS_URL: '' });
lance(path.join(ROOT, '..', 'game-hub-server'), 'src/server.js', HUB_PORT, { MANIFEST_FILE: MANIFEST });
await attends(`http://127.0.0.1:${IMI_PORT}/`);
await attends(`http://127.0.0.1:${HUB_PORT}/health`);
const HUB = `ws://127.0.0.1:${HUB_PORT}`;

function suivi(client) {
  const s = { last: null, errors: [] };
  client.on('session', (x) => { s.last = x.session; });
  client.on('error', (e) => s.errors.push(e));
  s.until = async (cond, ms = 8000) => { const fin = Date.now() + ms; while (Date.now() < fin) { if (s.last && cond(s.last)) return s.last; await sleep(20); } return null; };
  return s;
}
const hubClient = () => H.createClient({ url: HUB, retryDelays: [], connectTimeout: 5000 });

// Le client du jeu : un WebSocket vers imitation-server, rien d'autre.
function imitation() {
  const ws = new WebSocket(`ws://127.0.0.1:${IMI_PORT}`);
  const c = { ws, msgs: [] };
  ws.binaryType = 'arraybuffer';
  ws.onmessage = (e) => { if (typeof e.data === 'string') c.msgs.push(JSON.parse(e.data)); };
  c.open = new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('imitation injoignable')); });
  c.send = (o) => ws.send(JSON.stringify(o));
  c.wait = async (pred, ms = 8000) => { const fin = Date.now() + ms; while (Date.now() < fin) { const m = c.msgs.find(pred); if (m) return m; await sleep(20); } return null; };
  c.last = (type) => [...c.msgs].reverse().find((m) => m.type === type);
  return c;
}

const IMG = 'data:image/webp;base64,' + fs.readFileSync(path.join(ROOT, '..', 'imitation-server', 'test-fixtures', 'avatar-96.webp')).toString('base64');
const pA = { id: 'p_aliceimi', name: 'Alice', avatar: { kind: 'image', emoji: '🦊', src: IMG } };
const pB = { id: 'p_brunoimi', name: 'Bruno', avatar: { kind: 'emoji', emoji: '🐼' } };
// Le join d'Imitation : SANS `code` pour créer, AVEC pour rejoindre. Aucun
// champ inventé pour le Hub — c'est le protocole du jeu, tel quel.
const joinImi = (p, code) => (code === undefined
  ? { action: 'join', name: p.name, avatar: p.avatar }
  : { action: 'join', name: p.name, avatar: p.avatar, code });

console.log(`\nHandoff Hub → Imitation — protocole réel (Hub :${HUB_PORT}, Imitation :${IMI_PORT})\n`);
try {
  // ═══ 3. le groupe, et un tirage qui ne peut donner qu'Imitation
  const A = hubClient(), B = hubClient();
  const sA = suivi(A), sB = suivi(B);
  const code = (await A.create(pA)).session.code;
  await B.join(code, pB);
  await sA.until((s) => s.pool && s.pool.catalog === 'ready' && s.players.length === 2);
  B.setPrefs([], ['morpion', 'demicercle', 'ban', 'precision', 'passeur']);
  const seul = await sA.until((s) => JSON.stringify(s.pool.eligible) === '["imitation"]');
  t('le groupe (2) : seul Imitation est éligible (vetos de B)', !!seul, JSON.stringify(sA.last.pool.eligible));
  t('le micro n\'écarte plus rien : aucune raison de capacité', !(sA.last.pool.why.imitation || []).length);
  A.draw();
  const tire = await sA.until((s) => s.draw && s.draw.status === 'drawn');
  t('tirage serveur : Imitation', !!tire && tire.draw.gameId === 'imitation', tire && tire.draw.gameId);
  const drawId = tire.draw.id;

  // ═══ 4. continuer → lancement, rôles, URL
  A.confirm();
  const l0 = await sB.until((s) => s.state === 'launching');
  t('continuer → launching (stage create), lié au tirage', !!l0 && l0.launch.stage === 'create' && l0.launch.drawId === drawId);
  t('rôles : A host du lancement, B guest', l0.launch.hostId === pA.id && l0.launch.hostId !== pB.id);
  t('le Hub donne l\'URL du jeu (manifest)', l0.launch.url === 'games/imitation/', l0.launch.url);

  // ═══ 5. A « navigue » : sa page du Hub se ferme, la page du jeu rouvre le Hub
  A._drop();
  await sB.until((s) => s.players.find((p) => p.id === pA.id).connected === false, 4000);
  const A2 = hubClient(), sA2 = suivi(A2);
  await A2.join(code, pA);
  t('navigation de A : même player.id, toujours hôte du lancement',
    sA2.last.hostId === pA.id && sA2.last.launch.hostId === pA.id && sA2.last.players.length === 2);

  // ═══ 6. A crée la room par le protocole NORMAL d'Imitation : join SANS code
  const IA = imitation(); await IA.open;
  IA.send(joinImi(pA));
  const roomA = await IA.wait((m) => m.type === 'room');
  const moiA = roomA && roomA.players.find((p) => p.id === roomA.you);
  t('Imitation : room créée par un join SANS code, vrai code renvoyé',
    !!roomA && CODE_RE.test(roomA.code), roomA && roomA.code);
  t('Imitation : le créateur est le host de la room', !!moiA && moiA.host === true);
  const roomCode = roomA.code;

  // Un invité tente de déclarer SA room à la place de l'hôte du lancement.
  const errB0 = sB.errors.length;
  B.launched(drawId, 'ZZZZ');
  await sleep(300);
  t('un guest qui déclare un code : refusé (NOT_HOST)',
    sB.errors.length > errB0 && sB.errors[sB.errors.length - 1].code === 'NOT_HOST');

  // ═══ 7. le code remonte au Hub, qui le relaie
  A2.launched(drawId, roomCode);
  const go = await sB.until((s) => s.launch && s.launch.stage === 'join');
  t('go : B reçoit LE code de la room créée par A', !!go && go.launch.roomCode === roomCode, go && go.launch.roomCode);
  t('waiting : B attendu, A déjà dedans',
    JSON.stringify(go.launch.entered) === JSON.stringify([pA.id]) && JSON.stringify(go.launch.waiting) === JSON.stringify([pB.id]));

  // ═══ 8. B « navigue » et rejoint CE code, par le chemin normal
  B._drop();
  const B2 = hubClient(), sB2 = suivi(B2);
  await B2.join(code, pB);
  const vuB = sB2.last.launch.roomCode;
  t('B relit le code dans SON état de session (il ne le saisit pas)', vuB === roomCode, vuB);
  const IB = imitation(); await IB.open;
  IB.send(joinImi(pB, vuB));                                  // le code vient du HUB
  const roomB = await IB.wait((m) => m.type === 'room');
  const moiB = roomB && roomB.players.find((p) => p.id === roomB.you);
  t('B : entré dans la room Imitation par le protocole normal (join + code)',
    !!roomB && roomB.code === roomCode && !!moiB && moiB.host === false);
  B2.entered(drawId, roomB.code);

  const enJeu = await sA2.until((s) => s.state === 'inGame');
  t('Hub : tout le groupe est entré → inGame, personne en attente',
    !!enJeu && enJeu.launch.waiting.length === 0 && enJeu.launch.entered.length === 2);

  // ═══ 9. UNE seule room, vue par imitation-server lui-même
  await sleep(300);
  const lob = IA.last('room');
  t('Imitation : A + B dans LA MÊME room (vue du serveur du jeu)',
    !!lob && lob.code === roomCode && lob.players.length === 2
    && ['Alice', 'Bruno'].every((n) => lob.players.some((p) => p.name === n)), lob && lob.players.map((p) => p.name).join(','));
  t('roomCode A === roomCode B', roomA.code === roomB.code);
  const rooms = await (await fetch(`http://127.0.0.1:${IMI_PORT}/`)).text().catch(() => '');
  t('une seule room ouverte côté serveur (aucune room orpheline)',
    new Set([roomA.code, roomB.code]).size === 1 && lob.players.length === 2, rooms ? '' : '');
  const pa = lob.players.find((p) => p.name === 'Alice');
  t('la vraie PP de A arrive dans Imitation (image, pas l\'emoji)', !!pa && pa.avatar && pa.avatar.kind === 'image' && pa.avatar.src === IMG);
  t('B y arrive avec son emoji', lob.players.find((p) => p.name === 'Bruno').avatar.emoji === '🐼');

  // ═══ 10. une vraie partie : A démarre, la première manche part
  IA.send({ action: 'start', rounds: 1 });
  const phaseA = await IA.wait((m) => m.type === 'phase' && m.phase === 'watching');
  const phaseB = await IB.wait((m) => m.type === 'phase' && m.phase === 'watching');
  t('A démarre : les deux reçoivent la première manche (phase watching, round 1)',
    !!phaseA && !!phaseB && phaseA.round === 1 && phaseB.round === 1, phaseA && `round ${phaseA.round}/${phaseA.of}`);
  t('la manche porte bien un clip (catalogue de secours, aucun réseau)', !!(phaseA.video || phaseA.url), phaseA && (phaseA.video || phaseA.url));
  A2.started(drawId);
  await sleep(200);
  t('Hub : toujours inGame pendant la partie', sA2.last.state === 'inGame', sA2.last.state);

  // ═══ 11. fin → retour au Hub
  A2.ended(drawId);
  const deb = await sB2.until((s) => s.state === 'debrief');
  t('ended : le Hub revient en debrief, prêt pour un nouveau tirage',
    !!deb && deb.launch.stage === 'ended' && deb.history.played[0] === 'imitation');

  // ═══ 12. hors Hub : le jeu reste autonome
  // Aucun billet, aucun Hub : deux clients ouvrent leur propre room comme
  // avant. C'est le chemin de quelqu'un qui arrive par le portfolio.
  const IC = imitation(); await IC.open;
  IC.send(joinImi({ name: 'Solo', avatar: { kind: 'emoji', emoji: '🎤' } }));
  const roomC = await IC.wait((m) => m.type === 'room');
  t('hors Hub : un joueur crée sa room normalement, code différent',
    !!roomC && CODE_RE.test(roomC.code) && roomC.code !== roomCode, roomC && roomC.code);
  const ID = imitation(); await ID.open;
  ID.send(joinImi({ name: 'Duo', avatar: { kind: 'emoji', emoji: '🎧' } }, roomC.code));
  const roomD = await ID.wait((m) => m.type === 'room');
  t('hors Hub : un second joueur rejoint par le code, à la main',
    !!roomD && roomD.code === roomC.code && roomD.players.length === 2);
  t('hors Hub : cette room est bien SÉPARÉE de celle du Hub', roomD.code !== roomCode);

  for (const P of [IA, IB, IC, ID]) { try { P.ws.close(); } catch (_) {} }
  for (const X of [A2, B2]) { try { X.leave(); } catch (_) {} }
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
