// Client du Game Hub (games/shared/game-hub.js) : tests unitaires, puis
// protocole contre le VRAI game-hub-server lancé en local depuis le dépôt
// voisin (../game-hub-server, `npm ci` fait). Aucun mock du protocole : ce qui
// est vérifié, c'est ce que le serveur répond vraiment.
//
//   node tests/hub.mjs
//   node tests/hub.mjs --hub wss://game-hub-server-qqdk.onrender.com   (production)
//
// Node ≥ 22 : le client utilise le WebSocket natif de Node, le même objet que
// celui du navigateur.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeHealth, localManifest } from './hub-fixture.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const H = require(path.join(ROOT, 'games/shared/game-hub.js'));
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let out = [], ko = 0;
const t = (nom, ok, detail = '') => {
  out.push(`${ok ? 'OK  ' : 'KO  '} ${nom}${!ok && detail ? ' — ' + detail : ''}`);
  if (!ok) ko++;
  console.log(out[out.length - 1]);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ════════════════════════════════════════════════════════ 1. unitaires, purs
console.log('— unitaires —');
t('URL par défaut : la production', H.hubUrl('') === 'wss://game-hub-server-qqdk.onrender.com');
t('URL surchargée par ?hub= (tests, dev local)', H.hubUrl('?hub=ws://localhost:8100') === 'ws://localhost:8100');
t('?hub= qui n\'est pas une URL WebSocket : ignoré', H.hubUrl('?hub=javascript:alert(1)') === H.PROD && H.hubUrl('?hub=http://x') === H.PROD);
t('/health dérivé de l\'URL WebSocket', H.healthUrl('wss://h.example/') === 'https://h.example/health' && H.healthUrl('ws://localhost:8100') === 'http://localhost:8100/health');

t('code : minuscules et espaces pardonnés', H.normalizeCode('  ab2de ') === 'AB2DE');
t('code : 4 caractères refusés (c\'est un code de JEU, pas de Hub)', H.normalizeCode('ABCD') === null);
t('code : signes ambigus refusés (0, 1, I, L, O)', ['ABCD0', 'ABCD1', 'ABCDI', 'ABCDL', 'ABCDO'].every((c) => H.normalizeCode(c) === null));
t('code : pas une chaîne → null', H.normalizeCode(12345) === null && H.normalizeCode(null) === null);

const IMG = 'data:image/webp;base64,' + fs.readFileSync(path.join(ROOT, '..', 'qui-ment-server', 'test-fixtures', 'avatar-96.webp')).toString('base64');
const profilA = { v: 1, id: 'p_alicetst', name: '  Alice ', avatar: { kind: 'image', emoji: '🦊', src: IMG } };
const profilB = { v: 1, id: 'p_brunotst', name: 'Bruno', avatar: { kind: 'emoji', emoji: '🐼' } };
const pA = H.playerFrom(profilA), pB = H.playerFrom(profilB);
t('playerFrom : l\'avatar COMPLET part (photo comprise)', pA.avatar.kind === 'image' && pA.avatar.src === IMG && pA.avatar.emoji === '🦊');
t('playerFrom : emoji seul, sans src', same(pB.avatar, { kind: 'emoji', emoji: '🐼' }));
t('playerFrom : id du profil, pseudo nettoyé', pA.id === 'p_alicetst' && pA.name === 'Alice');
t('playerFrom : image annoncée sans src → emoji', H.playerFrom({ id: 'p_x1', name: 'X', avatar: { kind: 'image', emoji: '🐸' } }).avatar.kind === 'emoji');

t('sérialisation create', same(H.createMsg(pB), { action: 'create', player: pB }));
t('sérialisation join', same(H.joinMsg('AB2DE', pB), { action: 'join', code: 'AB2DE', player: pB }));
t('sérialisation leave', same(H.leaveMsg(), { action: 'leave' }));

t('parse : JSON illisible → null', H.parseMessage('{pas du json') === null);
t('parse : sans type → null', H.parseMessage('{"session":{}}') === null);
t('parse : message valable', H.parseMessage('{"type":"session","session":{}}').type === 'session');

const brute = { code: 'AB2DE', state: 'lobby', hostId: 'p_b', maxPlayers: 12, draw: null, history: { played: [] }, secret: 'x',
  players: [{ id: 'p_a', name: 'A', avatar: { kind: 'emoji', emoji: '🦊' }, caps: { mic: false, consent: 'oui' }, veto: ['ban', 3], love: [], connected: false, host: true, since: 1, sockets: {} },
            { id: 'p_b', name: 'B', avatar: { kind: 'emoji', emoji: '🐼' }, connected: true, host: false }, null, { name: 'sans id' }] };
const lue = H.readSession(brute);
t('session : l\'hôte vient de hostId (pas du drapeau reçu)', lue.players.find((p) => p.id === 'p_b').host === true && lue.players.find((p) => p.id === 'p_a').host === false);
t('session : absent conservé', lue.players.find((p) => p.id === 'p_a').connected === false);
t('session : liste blanche (rien d\'inconnu ne passe : ni secret, ni since, ni sockets)',
  !('secret' in lue) && lue.players.every((p) => !('since' in p) && !('sockets' in p)));
t('session : caps relues en booléens stricts (« oui » n\'est pas true)', same(lue.players.find((p) => p.id === 'p_a').caps, {}));
t('session : veto/love = des chaînes seulement', same(lue.players.find((p) => p.id === 'p_a').veto, ['ban']) && same(lue.players.find((p) => p.id === 'p_b').love, []));
t('session : serveur d\'avant le randomizer → pool null, draw null (la page le dit)', lue.pool === null && lue.draw === null && same(lue.history.played, []));

// Le randomizer, côté client : il n'envoie que des INTENTIONS.
t('sérialisation draw : AUCUN champ (le client ne choisit rien)', same(H.drawMsg(), { action: 'draw' }));
t('sérialisation continue / prefs / caps / constraints',
  same(H.continueMsg(), { action: 'continue' }) && same(H.prefsMsg(['passeur'], ['ban']), { action: 'prefs', love: ['passeur'], veto: ['ban'] })
  && same(H.capsMsg({ mic: true }), { action: 'caps', caps: { mic: true } }) && same(H.constraintsMsg(10), { action: 'constraints', maxMinutes: 10 })
  && same(H.constraintsMsg(null), { action: 'constraints', maxMinutes: null }));
const s2 = H.readSession({ code: 'AB2DE', players: [], history: { played: ['passeur', 7] },
  draw: { id: 'd_1', n: 1, status: 'pending', gameId: 'passeur', eligible: ['passeur', 1], weights: { passeur: 1, x: 'y' } },
  pool: { catalog: 'ready', games: ['passeur', 'ban'], eligible: ['passeur'], why: { ban: [{ code: 'VETO', players: ['p_a'] }, 'bruit'] }, weights: { passeur: 1.5 }, health: { passeur: 'up' } } });
t('draw : pas de gameId tant que le tirage est « pending » (même si le fil en porte un)', s2.draw.gameId === null && s2.draw.status === 'pending');
t('draw : listes et poids nettoyés', same(s2.draw.eligible, ['passeur']) && same(s2.draw.weights, { passeur: 1 }));
t('pool : relu en liste blanche', s2.pool.catalog === 'ready' && same(s2.pool.eligible, ['passeur']) && s2.pool.why.ban.length === 1 && s2.pool.weights.passeur === 1.5);
t('history.played : chaînes seulement', same(s2.history.played, ['passeur']));
const noms = { p_a: 'Alice', p_b: 'Bruno', p_c: 'Chloé', p_d: 'Dan' };
const R = (r) => H.reasonText(r, (id) => noms[id]);
t('raison : trop peu de joueurs', R({ code: 'TOO_FEW', min: 3, count: 2 }) === 'il faut 3 joueurs, vous êtes 2');
t('raison : trop de joueurs', R({ code: 'TOO_MANY', max: 2, count: 3 }) === '2 joueurs maximum, vous êtes 3');
t('raison : micro, nominatif', R({ code: 'NEEDS', need: 'mic', players: ['p_b'] }) === 'micro non déclaré : Bruno');
t('raison : veto, nominatif (et plusieurs)', R({ code: 'VETO', players: ['p_a', 'p_b'] }) === 'veto de Alice et Bruno'
  && R({ code: 'VETO', players: ['p_a', 'p_b', 'p_c', 'p_d'] }) === 'veto de Alice, Bruno et 2 autres');
t('raison : durée, serveur, local, consentement', /15 min.*10 min/.test(R({ code: 'TOO_LONG', max: 15, limit: 10 }))
  && /indisponible/.test(R({ code: 'SERVER_DOWN' })) && /seul/.test(R({ code: 'LOCAL_ONLY', count: 2 }))
  && /avertissement/.test(R({ code: 'NEEDS', need: 'consent', players: ['p_c'] })));
t('session : joueurs sans id écartés', lue.players.length === 2);
t('session : forme invalide → null', H.readSession(null) === null && H.readSession({ players: [] }) === null);

const CODES = ['BAD_JSON', 'TOO_BIG', 'UNKNOWN_ACTION', 'BAD_PLAYER', 'BAD_CODE', 'SESSION_NOT_FOUND', 'SESSION_FULL',
  'SESSION_CLOSED', 'ALREADY_IN_SESSION', 'NOT_IN_SESSION', 'REPLACED',
  'NOT_HOST', 'DRAW_IN_PROGRESS', 'NOT_DRAWN', 'NO_ELIGIBLE_GAME', 'MANIFEST_UNAVAILABLE', 'DRAW_FAILED', 'BAD_PREFS', 'BAD_CAPS', 'BAD_CONSTRAINTS',
  'NOT_LAUNCHING', 'LAUNCH_MISMATCH', 'LAUNCH_CONSUMED', 'LAUNCH_EXPIRED', 'BAD_ROOM_CODE', 'WRONG_ROOM'];
// La liste est relue dans protocol.js du serveur : un code ajouté là-bas sans
// phrase ici ferait échouer ce test.
const cote = fs.readFileSync(path.join(ROOT, '..', 'game-hub-server', 'src', 'protocol.js'), 'utf8');
// Deux blocs dans protocol.js : les erreurs de MESSAGE (ERRORS) et les raisons
// d'échec d'un LANCEMENT (LAUNCH_FAILURES). Chacun doit avoir ses phrases.
const bloc = (nom) => { const i = cote.indexOf('const ' + nom + ' = {'); return cote.slice(i, cote.indexOf('};', i)); };
const codesDe = (txt) => [...txt.matchAll(/^\s{2}([A-Z_]+):/gm)].map((m) => m[1]);
const serveur = codesDe(bloc('ERRORS'));
t('erreurs : chaque code de protocol.js a sa phrase côté client (' + serveur.length + ')', serveur.length >= 25 && serveur.every((c) => CODES.includes(c)), serveur.filter((c) => !CODES.includes(c)).join(','));
const echecs = codesDe(bloc('LAUNCH_FAILURES'));
t('lancement : chaque raison d\'échec du serveur a sa phrase (' + echecs.length + ')', echecs.length >= 6 && echecs.every((c) => H.launchFailureText(c) !== 'le lancement a échoué'), echecs.join(','));
t('lancement : billet et lancement relus en liste blanche', (() => {
  const l = H.readLaunch({ drawId: 'd_1', stage: 'join', hostId: 'p_a', roomCode: 'KQMP', url: 'games/passeur/', expected: ['p_a', 3], entered: ['p_a'], waiting: [], missed: [], failed: { p_b: 'x', p_c: 4 }, secret: 1 });
  return l.roomCode === 'KQMP' && same(l.expected, ['p_a']) && same(l.failed, { p_b: 'x' }) && !('secret' in l)
    && H.readLaunch({ drawId: 'd_1', stage: 'inconnu' }) === null && H.readLaunch({ drawId: 'd_1', stage: 'join', roomCode: 'kq mp', url: 'https://ailleurs/' }).roomCode === null
    && H.readLaunch({ drawId: 'd_1', stage: 'join', url: 'https://ailleurs/' }).url === null;
})());
t('erreurs : les ' + CODES.length + ' codes RÉELS du Hub ont une phrase lisible',
  CODES.every((c) => { const x = H.errorText(c); return typeof x === 'string' && x.length > 10 && !/[{}]/.test(x) && !x.includes(c); }));
t('erreurs : BAD_PLAYER reprend la raison du serveur', H.errorText('BAD_PLAYER', 'il faut un pseudo') === 'Profil refusé : il faut un pseudo.');
t('erreurs : code inconnu → le code est MONTRÉ, pas noyé dans une phrase creuse',
  H.errorText('ROOM_NOT_FOUND') === 'Le Hub a refusé la demande (ROOM_NOT_FOUND).');
t('erreurs : code inconnu → le message du serveur est repris s\'il y en a un',
  H.errorText('ROOM_NOT_FOUND', 'salle introuvable') === 'Le Hub a refusé la demande (ROOM_NOT_FOUND : salle introuvable).');
t('erreurs : sans code du tout → la phrase générique reste', H.errorText(null) === 'Le Hub a refusé la demande.');

// ═══════════════════════════════════════════ 2. contre le vrai serveur du Hub
const PROD = arg('--hub');
let srv = null, URL = PROD, sante = null, MANIFEST = null;
if (!PROD) {
  const cwd = path.join(ROOT, '..', 'game-hub-server');
  if (!fs.existsSync(path.join(cwd, 'node_modules', 'ws'))) { t('game-hub-server : npm ci fait', false, cwd); process.exit(1); }
  const port = 8400 + Math.floor(Math.random() * 300);
  // Le vrai catalogue, les serveurs de jeu simulés (leur /health seulement).
  sante = await fakeHealth(port + 400);
  // Aucun jeu lançable : cette suite teste le client et le TIRAGE (« continuer »
  // revient au Hub). Le lancement est testé par tests/handoff.mjs.
  MANIFEST = localManifest(ROOT, port + 400, {}, { sansHandoff: true });
  srv = spawn(process.execPath, ['src/server.js'], { cwd, env: { ...process.env, PORT: String(port), HUB_QUIET: '1', MANIFEST_FILE: MANIFEST }, stdio: 'ignore' });
  URL = `ws://127.0.0.1:${port}`;
}
const health = async () => (await (await fetch(H.healthUrl(URL))).json());
for (let i = 0; i < 100; i++) { try { await health(); break; } catch (_) { await sleep(PROD ? 1000 : 100); } }
console.log(`\n— protocole réel (${PROD ? 'PRODUCTION ' + PROD : 'serveur local ' + URL}) —`);

// Attendre un état qui satisfait une CONDITION, jamais « le prochain message » :
// la diffusion de l'action précédente peut arriver juste après (piège noté dans
// le README du Hub).
function suivi(client) {
  // `hist` garde TOUS les états reçus : sur un vrai réseau, un état transitoire
  // (« absent ») peut être suivi de près par le suivant et échapper à qui ne
  // regarde que le dernier.
  const s = { last: null, hist: [], statuses: [], ended: null, errors: [] };
  client.on('session', (x) => { s.last = x; s.hist.push(x); });
  client.on('status', (x) => s.statuses.push(x));
  client.on('ended', (e) => { s.ended = e; });
  client.on('error', (e) => s.errors.push(e));
  s.until = async (cond, ms = 8000) => {
    const fin = Date.now() + ms;
    while (Date.now() < fin) { if (cond(s)) return true; await sleep(20); }
    return false;
  };
  return s;
}
const client = (opts = {}) => H.createClient({ url: URL, retryDelays: [150, 300, 600, 1200], connectTimeout: PROD ? 60000 : 5000, ...opts });

try {
  const A = client(), B = client();
  const sA = suivi(A), sB = suivi(B);

  const rA = await A.create(pA);
  t('create : le serveur répond created, A est hôte', rA.you === pA.id && rA.session.hostId === pA.id && rA.session.players[0].host);
  t('create : le code vient du serveur (5 caractères de son alphabet)', !!H.normalizeCode(rA.session.code) && rA.session.code === H.normalizeCode(rA.session.code));
  t('create : la vraie PP de A est gardée par le Hub', rA.session.players[0].avatar.kind === 'image' && rA.session.players[0].avatar.src === IMG);
  t('create : état lobby', rA.session.state === 'lobby' && A.status === 'in-session');
  const code = rA.session.code;

  const rB = await B.join(code.toLowerCase(), pB);
  t('join : B entre (code saisi en minuscules)', rB.you === pB.id && rB.session.players.length === 2);
  t('join : B voit la PP de A et son propre emoji', rB.session.players[0].avatar.src === IMG && same(rB.session.players[1].avatar, pB.avatar));
  t('join : A reçoit la diffusion, avec B', await sA.until((s) => s.last && s.last.session.players.length === 2));

  // Erreurs réelles, en phrases.
  const C = client();
  let e1 = null; try { await C.join('ZZZZZ', { id: 'p_charlie', name: 'C', avatar: { kind: 'emoji', emoji: '🐸' } }); } catch (e) { e1 = e; }
  t('erreur SESSION_NOT_FOUND : rejet lisible', e1 && e1.code === 'SESSION_NOT_FOUND' && /Aucune session/.test(e1.message), e1 && e1.message);
  t('après un refus, le client peut réessayer (état idle)', C.status === 'idle');
  let e2 = null; try { await C.join('AB', pB); } catch (e) { e2 = e; }
  t('erreur BAD_CODE : refusée AVANT le réseau', e2 && e2.code === 'BAD_CODE');
  let e3 = null; try { await C.create({ id: 'p_sanspseudo', name: '   ', avatar: { kind: 'emoji', emoji: '🐸' } }); } catch (e) { e3 = e; }
  t('erreur BAD_PLAYER : la raison du serveur est dite', e3 && e3.code === 'BAD_PLAYER' && /pseudo/.test(e3.message), e3 && e3.message);

  // Perte réseau de B : reprise automatique, MÊME player.id, aucun doublon.
  B._drop();
  // ⚠️ PRODUCTION (Render) : le serveur ne constate une fermeture initiée par le
  // client qu'après ~10 s (mesuré) — B, qui revient en 150 ms, reprend sa place
  // AVANT que l'absence existe. En local, l'absence est immédiate et vérifiée.
  if (PROD) t('perte réseau (prod) : B revient avant même que son absence soit constatée — admis', true);
  else t('perte réseau : A voit B absent', await sA.until((s) => s.hist.some((h) => h.session.players.some((p) => p.id === pB.id && !p.connected))),
    JSON.stringify(sA.hist.map((h) => h.session.players.map((p) => p.id.slice(2, 6) + (p.connected ? '+' : '-')).join(' '))));
  t('perte réseau : B passe en reprise', await sB.until((s) => s.statuses.includes('reconnecting')));
  t('reprise : B est de retour, connecté', await sB.until(() => B.status === 'in-session') && await sA.until((s) => s.last.session.players.find((p) => p.id === pB.id).connected));
  t('reprise : même player.id, AUCUN doublon', sA.last.session.players.length === 2 && sA.last.session.players.filter((p) => p.id === pB.id).length === 1);

  // REPLACED : la même identité se connecte ailleurs → l'ancien s'arrête, SANS se reconnecter.
  const B2 = client(), sB2 = suivi(B2);
  await B2.join(code, pB);
  t('REPLACED : l\'ancienne connexion de B est terminée', await sB.until((s) => s.ended && s.ended.code === 'REPLACED'), JSON.stringify(sB.ended));
  const avant = sB.statuses.length;
  await sleep(1500);
  t('REPLACED : aucune reconnexion automatique (pas de ping-pong)', B.status === 'ended' && !sB.statuses.slice(avant).includes('reconnecting') && B2.status === 'in-session');
  t('REPLACED : toujours 2 joueurs, B connecté (par B2)', sA.last.session.players.length === 2 && sA.last.session.players.find((p) => p.id === pB.id).connected);

  // Changement d'hôte : A disparaît sans revenir → B2 devient hôte.
  const A0 = A;
  const Adead = client({ retryDelays: [] });   // un A qui ne se reconnectera pas
  A0.leave();                                   // A quitte pour de bon (retiré tout de suite)
  t('hôte : A parti, B devient hôte', await sB2.until((s) => s.last && s.last.session.hostId === pB.id && s.last.session.players.length === 1));
  const rA2 = await Adead.join(code, pA);
  t('hôte : A revient → B RESTE hôte (plus ancien encore connecté)', rA2.session.hostId === pB.id);
  Adead._drop();
  t('A se déconnecte sans reprise : B le voit absent', await sB2.until((s) => s.last && s.last.session.players.some((p) => p.id === pA.id && !p.connected), PROD ? 20000 : 8000),
    JSON.stringify(sB2.hist.slice(-3).map((h) => h.session.players.map((p) => p.id.slice(2, 6) + (p.connected ? '+' : '-')).join(' '))) + ' statut Adead=' + Adead.status);
  t('sans reprise possible : le client A dit « terminé »', await suivi(Adead).until(() => Adead.status === 'ended', 3000) || Adead.status === 'ended');

  // SESSION_FULL : 12 maximum.
  const D = client(); const rD = await D.create({ id: 'p_full00', name: 'Hôte', avatar: { kind: 'emoji', emoji: '🎯' } });
  const extras = [];
  for (let i = 1; i < 12; i++) { const x = client(); extras.push(x); await x.join(rD.session.code, { id: 'p_full' + String(i).padStart(2, '0'), name: 'J' + i, avatar: { kind: 'emoji', emoji: '🎧' } }); }
  let e4 = null; try { await client().join(rD.session.code, { id: 'p_full12', name: 'J12', avatar: { kind: 'emoji', emoji: '🍕' } }); } catch (e) { e4 = e; }
  t('SESSION_FULL : le 13e est refusé, en phrase', e4 && e4.code === 'SESSION_FULL' && /complète/.test(e4.message), e4 && e4.message);
  D.leave(); extras.forEach((x) => x.leave());

  // ── Le tirage, par les méthodes du client (une session à part : E hôte, F).
  {
    const E = client(), F = client();
    const sE = suivi(E), sF = suivi(F);
    const pE = { id: 'p_emmatst', name: 'Emma', avatar: { kind: 'emoji', emoji: '🎯' } };
    const pF = { id: 'p_fredtst', name: 'Fred', avatar: { kind: 'emoji', emoji: '🔥' } };
    const rE = await E.create(pE);
    await F.join(rE.session.code, pF);
    const pret = await sF.until((s) => s.last && s.last.session.pool && s.last.session.pool.catalog === 'ready', PROD ? 30000 : 8000);
    if (!pret && PROD) {
      t('tirage (prod) : le serveur en ligne ne connaît pas encore le tirage — pool absent, client inchangé', !sF.last.session.pool);
    } else {
      t('tirage : le catalogue arrive dans l\'état de session', pret, JSON.stringify(sF.last && sF.last.session.pool));
      const games = sF.last.session.pool.games;
      t('tirage : le catalogue est celui du manifest réel (' + games.length + ' jeux)', same(games, JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'games.manifest.json'), 'utf8')).games.map((g) => g.id)));
      F.setPrefs([], ['morpion']);
      E.setPrefs(['passeur'], []);
      t('prefs : B met un veto, A un cœur — synchronisés chez les deux', await sE.until((s) => {
        const ps = s.last.session.players; const f = ps.find((p) => p.id === pF.id), e = ps.find((p) => p.id === pE.id); return !!f && !!e && f.veto.includes('morpion') && e.love.includes('passeur');
      }) && await sF.until((s) => !!s.last.session.players.find((p) => p.id === pE.id && p.love.includes('passeur'))));
      t('prefs : le veto exclut Morpion, avec le nom du joueur', !sE.last.session.pool.eligible.includes('morpion')
        && H.reasonText(sE.last.session.pool.why.morpion[0], () => 'Fred') === 'veto de Fred');
      const errs0 = sF.errors.length;
      F.draw();
      t('tirage : un non-hôte est refusé (NOT_HOST, en phrase)', await sF.until((s) => s.errors.length > errs0 && s.errors[s.errors.length - 1].code === 'NOT_HOST'));
      E.draw();
      // En production, le tirage attend le /health des jeux sur Render : jusqu'à
      // 40 s si l'un d'eux dort (c'est voulu, voir game-hub-server/src/health.js).
      const DELAI = PROD ? 60000 : 8000;
      t('tirage : les deux voient le jeu tiré par le SERVEUR',
        await sE.until((s) => s.last.session.draw && s.last.session.draw.status === 'drawn', DELAI) && await sF.until((s) => s.last.session.draw && s.last.session.draw.status === 'drawn', DELAI));
      const d1 = sF.last.session.draw;
      t('tirage : même tirage chez A et B, dans la liste éligible', d1.id === sE.last.session.draw.id && d1.gameId === sE.last.session.draw.gameId && d1.eligible.includes(d1.gameId), d1.gameId);
      t('tirage : history.played = [jeu]', same(sF.last.session.history.played, [d1.gameId]));
      E.confirm();
      t('continuer : debrief, rien d\'effacé', await sF.until((s) => s.last.session.state === 'debrief' && s.last.session.draw.status === 'confirmed'));
      E.draw();
      t('2e tirage : l\'historique garde le premier', await sF.until((s) => s.last.session.draw && s.last.session.draw.n === 2 && s.last.session.draw.status === 'drawn')
        && sF.last.session.history.played[0] === d1.gameId && sF.last.session.history.played.length === 2, JSON.stringify(sF.last.session.history));
      t('2e tirage : récence — le premier jeu pèse 0,15 × son poids', (() => {
        const w = sF.last.session.draw.weights[d1.gameId]; const base = d1.gameId === 'passeur' ? 1.5 : 1;
        return w === Math.round(base * 0.15 * 10000) / 10000;
      })(), JSON.stringify(sF.last.session.draw.weights));
      if (!PROD && sante) {
        // ⚠️ LA RÈGLE DE FOND : un tirage ne consulte AUCUN /health. Un serveur
        // de jeu endormi (Render : ~30 s) ne doit jamais coûter un tirage. Le
        // serveur du jeu se réveille quand la page du jeu s'y connecte.
        t('santé : un tirage complet n\'a interrogé aucun serveur de jeu', sante.appels.length === 0,
          sante.appels.map((a) => a.id).join(',') || 'aucun appel');
        t('santé : et jamais un WebSocket vers un jeu, quoi qu\'il arrive', sante.appels.every((a) => a.method === 'GET' && !a.upgrade));
      }
    }
    E.leave(); F.leave();
  }

  // Fin : B2 quitte, et A n'est qu'ABSENT (socket coupé, en délai de grâce).
  // Un `leave` volontaire du dernier joueur CONNECTÉ ferme la session tout de
  // suite : plus personne n'y est volontairement présent. (La grâce d'une coupure
  // réseau est vérifiée à part, par tests/hub-play.mjs et game-hub-server.)
  B2.leave();
  if (!PROD) {
    const t0 = Date.now(); let h = null;
    for (let i = 0; i < 40; i++) { h = await health(); if (h.sessions === 0) break; await sleep(50); }
    t(`fin : B2, dernier connecté, fait leave → session supprimée immédiatement (${Date.now() - t0} ms, A absent compris)`,
      h.sessions === 0 && h.players === 0 && Date.now() - t0 < 2000, JSON.stringify(h));
  }
} catch (e) {
  t('EXCEPTION', false, e && (e.stack || e.message));
} finally {
  if (srv) srv.kill();
  if (sante) sante.close();
  if (MANIFEST) { try { fs.unlinkSync(MANIFEST); } catch (_) {} }
}

console.log(`\n${ko ? 'DES TESTS ÉCHOUENT' : 'TOUT PASSE'} — ${out.length} vérifications, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
