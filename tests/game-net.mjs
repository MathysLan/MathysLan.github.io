// games/shared/game-net.js — tests unitaires, sans navigateur ni réseau.
//
//   node tests/game-net.mjs
//
// Le module est piloté avec un faux WebSocket, dont on contrôle chaque
// événement et chaque instant. Ce qui est vérifié : la même API que l'ancien
// `NET`, la réponse aux pings de présence (jamais transmis au jeu), `lost`
// émis une seule fois, `connect()` qui réutilise une connexion en cours,
// `send()` qui ne lève jamais d'exception, JSON protégé, frames binaires — et
// surtout le chien de garde, qui ne doit JAMAIS déclarer perdue une connexion
// vivante.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const GameNet = require(path.join(ROOT, 'games/shared/game-net.js'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let n = 0, ko = 0;
const t = (nom, ok, detail = '') => { n++; if (!ok) ko++; console.log(`${ok ? 'OK  ' : 'KO  '} ${nom}${detail ? ' — ' + detail : ''}`); };

// Un faux WebSocket : on ouvre, on fait parler le « serveur », on ferme.
const crees = [];
class FauxWS {
  constructor(url) { this.url = url; this.readyState = 0; this.envoye = []; crees.push(this); }
  send(s) { if (this.readyState !== 1) throw new Error('InvalidStateError'); this.envoye.push(typeof s === 'string' ? JSON.parse(s) : s); }
  // Aussi strict qu'un navigateur : close() n'accepte que 1000 ou 3000-4999.
  close(code) {
    if (code !== undefined && code !== 1000 && !(code >= 3000 && code <= 4999)) throw new Error('InvalidAccessError : code ' + code);
    if (this.readyState >= 2) return; this.readyState = 3; this.onclose && this.onclose({ code: code || 1000 });
  }
  // côté « serveur »
  ouvrir() { this.readyState = 1; this.onopen && this.onopen(); }
  recoit(obj) { this.onmessage && this.onmessage({ data: typeof obj === 'string' ? obj : JSON.stringify(obj) }); }
  binaire(buf) { this.onmessage && this.onmessage({ data: buf }); }
  coupe(code = 1006) { this.readyState = 3; this.onclose && this.onclose({ code }); }
  echoue() { this.readyState = 3; this.onerror && this.onerror(); this.onclose && this.onclose({ code: 1006 }); }
}
const net = (o = {}) => GameNet.create({ url: 'ws://x', WebSocket: FauxWS, page: null, ...o });
const presences = (ws) => ws.envoye.filter((m) => m.action === 'presence');

// ═══ l'API d'avant, intacte
{
  const NET = net();
  t('même API que l\'ancien NET', ['connect', 'on', 'send', 'dispatch'].every((k) => typeof NET[k] === 'function') && 'ws' in NET && 'handlers' in NET && 'onBinary' in NET);
  const recus = [];
  NET.on('room', (m) => recus.push(m));
  const p = NET.connect();
  crees.at(-1).ouvrir(); await p;
  const ws = crees.at(-1);
  t('connect() ouvre, et NET.ws est le socket ouvert', NET.ws === ws && NET.connected());
  t('à l\'ouverture, la page n\'envoie RIEN (surtout pas de présence de sa propre initiative)', ws.envoye.length === 0);
  ws.recoit({ type: 'room', code: 'ABCD' });
  t('un message du jeu est transmis à son gestionnaire', recus.length === 1 && recus[0].code === 'ABCD');
  ws.recoit({ type: 'presence', n: 7 });
  t('ping de présence : réponse { action: "presence", n } aussitôt', presences(ws).length === 1 && presences(ws)[0].n === 7);
  let fuite = false; NET.on('presence', () => { fuite = true; });
  ws.recoit({ type: 'presence', n: 8 });
  t('… et il n\'est JAMAIS transmis au jeu', !fuite);
  ws.recoit('{{{ pas du json');
  ws.recoit('null');
  t('JSON illisible ou nul : ignoré, sans exception', true);
  t('send() : true quand le socket est ouvert', NET.send({ action: 'x' }) === true && ws.envoye.at(-1).action === 'x');
}

// ═══ connect() réutilise la connexion en cours
{
  const avant = crees.length;
  const NET = net();
  const p1 = NET.connect(), p2 = NET.connect();
  t('deux connect() pendant l\'ouverture : UN seul socket, la même promesse', crees.length === avant + 1 && p1 === p2);
  crees.at(-1).ouvrir(); await p1;
  await NET.connect();
  t('connect() sur une connexion ouverte : aucun nouveau socket', crees.length === avant + 1);
}

// ═══ send() ne lève jamais d'exception
{
  const NET = net();
  let ok = true, r1, r2;
  try { r1 = NET.send({ a: 1 }); } catch (_) { ok = false; }
  const p = NET.connect(); crees.at(-1).ouvrir(); await p;
  crees.at(-1).coupe();
  try { r2 = NET.send({ a: 2 }); } catch (_) { ok = false; }
  t('send() sans socket, puis sur un socket fermé : false, jamais d\'exception', ok && r1 === false && r2 === false);
}

// ═══ échec de connexion : rejet, `closed` comme avant, pas de `lost`
{
  const NET = net();
  const ev = [];
  NET.on('lost', () => ev.push('lost')); NET.on('closed', () => ev.push('closed'));
  const p = NET.connect();
  crees.at(-1).echoue();
  let msg = '';
  try { await p; } catch (e) { msg = e.message; }
  t('serveur injoignable : connect() rejette avec la phrase habituelle', msg === GameNet.INJOIGNABLE, msg);
  t('… `closed` émis comme avant, mais PAS de `lost` (on n\'a jamais été connecté)', ev.join() === 'closed', ev.join());
}

// ═══ `lost` une seule fois, puis `closed` ; une nouvelle connexion repart à zéro
{
  const NET = net();
  const ev = [];
  NET.on('lost', (e) => ev.push('lost:' + e.raison + ':' + e.code)); NET.on('closed', () => ev.push('closed'));
  let p = NET.connect(); crees.at(-1).ouvrir(); await p;
  const ws1 = crees.at(-1);
  ws1.coupe(1001);
  NET.send({ x: 1 });                                  // un send raté fait vérifier : pas de second `lost`
  await sleep(1100);                                   // et le chien de garde passe
  t('connexion fermée : `lost` UNE fois (raison fermeture, code), puis `closed`', ev.join() === 'lost:fermeture:1001,closed', ev.join());
  p = NET.connect(); crees.at(-1).ouvrir(); await p;
  ws1.coupe(1006);                                     // l'ANCIEN socket qui se manifeste en retard
  t('un ancien socket qui se ferme en retard ne déclenche rien pour la nouvelle connexion', NET.connected() && ev.filter((x) => x.startsWith('lost')).length === 1);
  crees.at(-1).coupe(4000);
  t('… et la nouvelle connexion a son propre `lost`', ev.filter((x) => x.startsWith('lost')).length === 2);
}

// ═══ LE CHIEN DE GARDE — le bug qu'il ne faut jamais revoir
// Le serveur envoie un ping À LA CONNEXION, puis suit son propre rythme
// (global). Le premier ping périodique peut donc arriver 0,1 s après celui de
// la connexion. Si ce court écart servait de période, la limite tombait au
// plancher (2 s) et une connexion VIVANTE était déclarée perdue.
{
  const NET = net();
  const ev = [];
  NET.on('lost', (e) => ev.push(e.raison));
  const p = NET.connect(); crees.at(-1).ouvrir(); await p;
  const ws = crees.at(-1);
  ws.recoit({ type: 'presence', n: 4 });               // ping de connexion
  await sleep(100);
  ws.recoit({ type: 'presence', n: 5 });               // premier ping périodique, 0,1 s plus tard
  await sleep(3500);                                   // silence de 3,5 s : bien plus que le plancher (2 s) et le pas du chien de garde (1 s)
  t('ping de connexion + ping périodique 0,1 s après, puis 3,5 s de silence : PAS perdue', ev.length === 0 && NET.connected(), ev.join());
  ws.recoit({ type: 'presence', n: 6 });               // période réelle : ~3,5 s → limite ~12 s
  await sleep(4000);
  t('la période se mesure entre deux pings PÉRIODIQUES : 4 s de silence ensuite, toujours vivante', ev.length === 0 && NET.connected(), ev.join());
}
{
  // Période courte (tests : 1 s) : le chien de garde doit bien se déclencher.
  const NET = net();
  const ev = [];
  NET.on('lost', (e) => ev.push(e.raison));
  const p = NET.connect(); crees.at(-1).ouvrir(); await p;
  const ws = crees.at(-1);
  ws.recoit({ type: 'presence', n: 1 });
  await sleep(500); ws.recoit({ type: 'presence', n: 2 });
  await sleep(600); ws.recoit({ type: 'presence', n: 3 });   // période 0,6 s → limite = plancher 2 s
  const t0 = Date.now();
  while (!ev.length && Date.now() - t0 < 5000) await sleep(50);
  const d = Date.now() - t0;
  t(`réseau muet : \`lost\` pour SILENCE, après ${(d / 1000).toFixed(1)} s (plancher 2 s)`, ev.join() === 'silence' && d >= 1900 && d < 3500, `${d} ms`);
  t('… et la page ferme elle-même le socket muet', ws.readyState === 3);
}
{
  // Serveur SANS présence : le chien de garde ne s'arme jamais.
  const NET = net();
  const ev = [];
  NET.on('lost', (e) => ev.push(e.raison));
  const p = NET.connect(); crees.at(-1).ouvrir(); await p;
  crees.at(-1).recoit({ type: 'room', code: 'ZZZZ' });
  await sleep(3500);
  t('serveur qui n\'envoie aucune présence : jamais de faux `lost`, même après 3,5 s de silence', ev.length === 0 && NET.connected());
}
{
  // Une rafale au réveil (messages mis en file pendant un gel) ne raccourcit pas la limite.
  const NET = net();
  const ev = [];
  NET.on('lost', (e) => ev.push(e.raison));
  const p = NET.connect(); crees.at(-1).ouvrir(); await p;
  const ws = crees.at(-1);
  ws.recoit({ type: 'presence', n: 1 });
  await sleep(100); ws.recoit({ type: 'presence', n: 2 });
  await sleep(1000); ws.recoit({ type: 'presence', n: 3 });  // période 1 s → limite 3,5 s
  ws.recoit({ type: 'presence', n: 4 }); ws.recoit({ type: 'presence', n: 5 });   // rafale
  await sleep(2800);
  t('rafale de pings (réveil) : la limite ne raccourcit pas (2,8 s de silence, limite 3,5 s)', ev.length === 0, ev.join());
}

// ═══ REMPLACEMENT : jamais deux fois le même joueur dans une room
// Après une perte, la connexion suivante demande au serveur de fermer
// l'ancienne, et connect() ne rend la main (donc le jeu n'envoie son `join`)
// qu'après l'acquittement.
{
  const NET = net({ remplacementMs: 400 });
  let p = NET.connect(); crees.at(-1).ouvrir(); await p;
  const ws1 = crees.at(-1);
  let fuiteCle = false; NET.on('presence', () => { fuiteCle = true; });
  ws1.recoit({ type: 'presence', n: 3, cle: 'CLE-UNE' });
  t('la clé n\'est jamais renvoyée sur sa propre connexion, ni transmise au jeu', !JSON.stringify(ws1.envoye).includes('CLE-UNE') && !fuiteCle);
  ws1.coupe(1006);
  let rendu = false;
  p = NET.connect().then(() => { rendu = true; });
  const ws2 = crees.at(-1); ws2.ouvrir();
  await sleep(50);
  t('nouvelle connexion ouverte : connect() ne rend PAS encore la main', !rendu);
  const p2 = NET.connect();
  t('… et un second connect() pendant l\'attente ne court-circuite rien (aucun nouveau socket)', crees.at(-1) === ws2);
  ws2.recoit({ type: 'presence', n: 4, cle: 'CLE-DEUX' });
  const rep = ws2.envoye.find((m) => m.action === 'presence');
  t('1re réponse de la nouvelle connexion : { action: "presence", n, remplace: <ancienne clé> }', !!rep && rep.n === 4 && rep.remplace === 'CLE-UNE', JSON.stringify(rep));
  await sleep(50);
  t('… toujours pas de main rendue tant que le serveur n\'a pas acquitté', !rendu);
  ws2.recoit({ type: 'presence', n: 4, remplace: true });
  await p; await p2;
  t('acquittement reçu : connect() rend la main — le `join` part APRÈS le retrait de l\'ancienne', rendu);
  ws2.recoit({ type: 'presence', n: 5 });
  t('les réponses suivantes ne redemandent aucun remplacement', ws2.envoye.filter((m) => m.remplace).length === 1);
}
{
  // Serveur muet sur le remplacement : on n'attend pas plus de remplacementMs.
  const NET = net({ remplacementMs: 300 });
  let p = NET.connect(); crees.at(-1).ouvrir(); await p;
  crees.at(-1).recoit({ type: 'presence', n: 1, cle: 'K' });
  crees.at(-1).coupe();
  const t0 = Date.now();
  p = NET.connect(); crees.at(-1).ouvrir(); await p;
  const d = Date.now() - t0;
  t(`pas d'acquittement : connect() rend la main après remplacementMs (${d} ms), sans bloquer le joueur`, d >= 280 && d < 1000);
}
{
  // Aucune clé reçue (serveur sans présence) : aucune attente à la reconnexion.
  const NET = net();
  let p = NET.connect(); crees.at(-1).ouvrir(); await p;
  crees.at(-1).coupe();
  const t0 = Date.now();
  p = NET.connect(); crees.at(-1).ouvrir(); await p;
  t('serveur sans présence : reconnexion immédiate, rien à remplacer', Date.now() - t0 < 50 && crees.at(-1).envoye.length === 0);
}
{
  // La nouvelle connexion tombe pendant l'attente : connect() échoue proprement.
  const NET = net({ remplacementMs: 2000 });
  let p = NET.connect(); crees.at(-1).ouvrir(); await p;
  crees.at(-1).recoit({ type: 'presence', n: 1, cle: 'K' });
  crees.at(-1).coupe();
  p = NET.connect(); const ws = crees.at(-1); ws.ouvrir();
  ws.coupe();
  let msg = ''; try { await p; } catch (e) { msg = e.message; }
  t('nouvelle connexion perdue pendant le remplacement : connect() rejette (pas de promesse pendante)', msg === GameNet.INJOIGNABLE, msg);
}

// ═══ QUITTER la page : fermeture propre et immédiate, sans reconnexion
// (sinon, gardée en cache par le navigateur, elle restait un fantôme côté
// serveur jusqu'à l'absence : 30 s en production).
{
  const ecoute = {};
  const page = { addEventListener: (type, fn) => { ecoute[type] = fn; }, document: { visibilityState: 'visible', addEventListener: () => {} } };
  const NET = net({ page });
  const ev = [];
  NET.on('lost', (e) => ev.push('lost:' + e.raison));
  let p = NET.connect(); crees.at(-1).ouvrir(); await p;
  const ws = crees.at(-1);
  ecoute.pagehide({ persisted: true });
  t('pagehide : la page ferme elle-même son socket (code 1000, accepté par un navigateur) — le serveur retire le joueur aussitôt', ws.readyState === 3);
  await sleep(1200);
  t('… sans `lost` ni reconnexion pendant qu\'elle s\'en va', ev.length === 0 && crees.at(-1) === ws);
  ecoute.pageshow({ persisted: true });
  t('revenue du cache (pageshow) : la perte est constatée, `lost` UNE fois', ev.join() === 'lost:fermeture', ev.join());
  const avant = crees.length;
  p = NET.connect(); crees.at(-1).ouvrir(); await p;
  t('… et le jeu peut se reconnecter normalement', crees.length === avant + 1 && NET.connected());
  ecoute.pageshow({ persisted: false });
  t('un pageshow ordinaire (premier affichage) ne touche à rien', NET.connected() && ev.length === 1);
}

// ═══ GameNet.surPerte : la perte, côté écran (commune aux jeux)
// Un faux document minimal : #lost, #lost-text, #lost-retry, #lost-hub.
{
  const elts = {};
  const elt = (id) => (elts[id] ||= { id, hidden: true, textContent: '', ecoute: {}, addEventListener(t, f) { this.ecoute[t] = f; } });
  globalThis.document = { getElementById: elt };
  const NET = net();
  let etat = { room: true, partie: false }, ecran = 'lobby', revenus = [], quittes = [];
  const perte = GameNet.surPerte(NET, {
    dansRoom: () => etat.room, enPartie: () => etat.partie, code: () => 'ABCD',
    quitter: (p) => { quittes.push(p); etat.room = false; },
    revenir: (c) => revenus.push(c),
    show: (id) => { ecran = id; for (const k of ['lost', 'lobby']) elt(k).hidden = k !== id; }, hub: true,
  });
  NET.dispatch({ type: 'lost' });
  t('surPerte, au salon : écran « connexion perdue », état du jeu remis, UN retour avec le même code', ecran === 'lost' && quittes.join() === 'false' && revenus.join() === 'ABCD' && elt('lost-retry').hidden);
  t('… le lien vers le Game Hub suit l\'option hub', elt('lost-hub').hidden === false);
  perte.refus('partie en cours');
  t('retour refusé : expliqué, bouton pour réessayer, aucun nouvel essai automatique', /Impossible de revenir dans le salon : partie en cours/.test(elt('lost-text').textContent) && !elt('lost-retry').hidden && revenus.length === 1);
  elt('lost-retry').ecoute.click();
  t('« Revenir dans le salon » : un nouvel essai, à la demande', revenus.length === 2);
  perte.retour(); elt('lost').hidden = true;
  perte.refus('autre');
  t('de retour dans une room : les erreurs suivantes ne touchent plus l\'écran de perte', !/autre/.test(elt('lost-text').textContent));
  etat = { room: true, partie: true }; revenus = []; quittes = [];
  NET.dispatch({ type: 'lost' });
  t('surPerte, en pleine partie : AUCUNE tentative, « elle a continué sans toi », bouton pour après', revenus.length === 0 && quittes.join() === 'true' && /continué sans toi/.test(elt('lost-text').textContent) && !elt('lost-retry').hidden);
  etat = { room: false, partie: false };
  NET.dispatch({ type: 'lost' });
  t('perte hors d\'une room (retour en cours) : dit, sans rien relancer', /de nouveau été coupée/.test(elt('lost-text').textContent) && revenus.length === 0);
  delete globalThis.document;
}

// ═══ option `binary` (Imitation)
{
  const NET = net({ binary: true });
  let recu = null;
  NET.onBinary = (b) => { recu = b; };
  const p = NET.connect(); const ws = crees.at(-1); ws.ouvrir(); await p;
  const buf = new ArrayBuffer(4);
  ws.binaire(buf);
  t('option binary : binaryType arraybuffer, frame binaire remise à onBinary', ws.binaryType === 'arraybuffer' && recu === buf);
}

console.log(`\n${ko ? 'DES TESTS ÉCHOUENT' : 'TOUT PASSE'} — ${n} vérifications, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
