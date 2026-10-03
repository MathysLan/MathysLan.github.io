// Croquis — UN TOUR JOUABLE, dans de vrais navigateurs, contre le VRAI
// croquis-server (choix 4 s, dessin 12 s : indices à 6 et 9 s ; révélation 4 s,
// le temps pour le harnais de vérifier la fin d’un tour AVANT le suivant).
//
//   node tests/croquis-tour.mjs
//   node tests/croquis-tour.mjs --shots <dossier>
//   node tests/croquis-tour.mjs --serveur C:\perso\croquis-server
//
// Deux onglets Edge — bureau (souris, clavier) et téléphone (doigt) — et un
// robot WebSocket : trois joueurs, la première manche (trois tours). L'ordre
// des dessinateurs est tiré par le serveur : chaque tour est joué selon QUI
// dessine.
//   1er tour dessiné par un navigateur : choix MANUEL (au clic / au doigt),
//   devinettes (mauvaise réponse publique, bonne réponse jamais divulguée,
//   « a trouvé », pas de seconde récompense, mot entre trouveurs), le
//   dessinateur ne devine pas, fin « tout le monde a trouvé » ;
//   2e tour dessiné par un navigateur : choix AUTOMATIQUE, indices dans le
//   gabarit, fin AU CHRONO ;
//   tour du robot : les deux navigateurs devinent, le robot dessinateur est
//   refusé s'il devine.
// Entre deux tours : aucun message de l'ancien turnId ne touche au nouveau.
import { compteur, sleep, arg, lancerServeur, lancerEdge, pageCroquis, robot, fin } from './croquis-harnais.mjs';

const t = compteur();
const SHOTS = arg('--shots');
const { url } = await lancerServeur({ TEST_CHOOSE_MS: '4000', TEST_DRAW_MS: '12000', TEST_PAUSE_MS: '300', TEST_REVEAL_MS: '4000' });
const { onglet } = await lancerEdge({ shots: SHOTS });
const PAGE = pageCroquis(url);
const A = await onglet('A', { w: 1100, h: 800, page: PAGE });
const B = await onglet('B', { w: 390, h: 844, mobile: true, page: PAGE });
await A.ouvrir();
await B.ouvrir();

// ======================================================= 1–2. salon, lancement
await A.taper('#name-input', 'Alice');
await A.clic('#host');
await A.until('/^[A-Z]{4}$/.test(document.getElementById("room-code").textContent)');
const code = await A.texte('#room-code');
await B.taper('#name-input', 'Bruno');
await B.taper('#code-input', code);
await B.clic('#join');
const R = robot(url, 'Robot', code);
t('[1] deux navigateurs (et un robot) rejoignent la même room', await A.until('document.querySelectorAll("#players li").length === 3')
  && await B.until('document.querySelectorAll("#players li").length === 3') && !!R.id);
await A.clic('#start');
t('[2] l hôte lance : tout le monde passe en partie', await A.until('!document.getElementById("play").hidden') && await B.until('!document.getElementById("play").hidden'));

const youA = (await A.recu('you'))[0], youB = (await B.recu('you'))[0];
const pageDe = { [youA.id]: A, [youB.id]: B };
const nomDe = { [youA.id]: 'Alice', [youB.id]: 'Bruno', [R.id]: 'Robot' };
// Un message reçu par la page mentionne-t-il ce mot ? (hors fin de tour, où il est public)
// (le champ `type` est écarté : « chat » est un mot de la fixture ET un type de message)
// Seulement les messages du tour regardé (`turnId`) : un mot peut en contenir
// un autre d'un tour précédent (« pomme » / « pomme de terre » dans la fixture).
const fuite = (msgs, mot, turnId) => msgs.filter((m) => m.type !== 'turn-end' && (turnId == null || m.turnId === turnId))
  .some((m) => JSON.stringify({ ...m, type: undefined }).toLowerCase().includes(mot.toLowerCase()));
const visibleDans = (p, mot) => p.ev(`document.body.innerText.toLowerCase().includes(${JSON.stringify(mot.toLowerCase())})`);
const filTexte = (p) => p.ev(`[...document.querySelectorAll('#fil li')].map((li) => li.textContent)`);
async function deviner(p, texte) {
  await p.taper('#devine', texte);
  if (p.mobile) await p.clic('#devine-envoyer'); else await p.entree();
  await sleep(450);                        // le bouton se rallume (3 devinettes / s au serveur)
}

let manuelFait = false, autoFait = false, robotFait = false;
let tourPrecedent = null;

for (let n = 0; n < 3; n++) {
  // ------------------------------------------------------- un nouveau tour
  const turnId = (tourPrecedent ? tourPrecedent.turnId : 0) + 1;
  await A.until(`window.__recu.some((m) => m.type === 'turn' && m.turnId === ${turnId})`, 25000);
  await B.until(`window.__recu.some((m) => m.type === 'turn' && m.turnId === ${turnId})`, 5000);
  const tr = (await A.recu('turn')).find((m) => m.turnId === turnId);
  const P = pageDe[tr.drawer] || null;                 // le dessinateur, s'il est un navigateur
  const spect = [A, B].filter((x) => x !== P);

  // ---- 18. l'ancien tour ne pollue pas le nouveau
  if (tourPrecedent) {
    const Q = spect[0];
    t(`[18] tour ${turnId} : le fil repart de zéro`, (await filTexte(Q)).every((l) => !/a trouvé|zzz|bien joué/.test(l)));
    const avantFil = await filTexte(Q), avantBandeau = await Q.texte('#bandeau'), avantGab = await Q.texte('#gabarit');
    await Q.ev(`(() => { const v = ${tourPrecedent.turnId};
      NET.dispatch({ type: 'chat', turnId: v, id: 'zz', text: 'VIEUX MESSAGE', scope: 'all' });
      NET.dispatch({ type: 'found', turnId: v, id: ${JSON.stringify(youA.id)}, order: 1 });
      NET.dispatch({ type: 'hint', turnId: v, pattern: 'VIEUX' });
      NET.dispatch({ type: 'close', turnId: v });
      NET.dispatch({ type: 'stop', turnId: v, reason: 'time' });
      NET.dispatch({ type: 'turn-end', turnId: v, word: 'VIEUXMOT', reason: 'time', gains: [], scores: [], remainingMs: 1000 });
      NET.dispatch({ type: 'stroke', turnId: v, s: 999, c: 0, w: 0, p: [10, 10], end: true });
      return true; })()`);
    t(`[18] tour ${turnId} : chat, found, hint, close, stop, turn-end, stroke de l ancien turnId ignorés`,
      JSON.stringify(await filTexte(Q)) === JSON.stringify(avantFil) && await Q.texte('#bandeau') === avantBandeau
      && await Q.texte('#gabarit') === avantGab && !(await Q.traits()).includes('999') && !(await visibleDans(Q, 'VIEUXMOT')));
  }

  // ======================================================= tour du robot
  if (!P) {
    const choix = await (async () => { for (let i = 0; i < 50; i++) { const m = R.dernier('choices', turnId); if (m) return m; await sleep(40); } return null; })();
    R.send({ action: 'choose', turnId, index: 0 });
    await A.until(`window.__recu.some((m) => m.type === 'drawing' && m.turnId === ${turnId})`);
    await B.until(`window.__recu.some((m) => m.type === 'drawing' && m.turnId === ${turnId})`);
    const mot = choix.words[0].word;
    t(`[tour ${turnId}, robot] les deux navigateurs ont le gabarit, pas le mot`, (await Promise.all([A, B].map(async (p) => !(await visibleDans(p, mot)) && !fuite(await p.recu(), mot, turnId)
      && await p.ev('document.querySelectorAll("#gabarit .l").length') > 0))).every(Boolean));
    R.send({ action: 'guess', turnId, text: mot });
    await sleep(300);
    t(`[15] tour ${turnId} : le robot dessinateur qui devine est refusé (IS_DRAWER)`, R.msgs.some((m) => m.type === 'refused' && m.reason === 'IS_DRAWER'));
    await deviner(A, mot);
    await deviner(B, mot);
    t(`[16] tour ${turnId} : les deux trouvent → « Tout le monde a trouvé ! »`, await A.until(`/Tout le monde a trouvé/.test(document.getElementById('bandeau').textContent)`)
      && await B.until(`/Tout le monde a trouvé/.test(document.getElementById('bandeau').textContent)`));
    robotFait = true;
    tourPrecedent = tr;
    continue;
  }

  const Q = spect[0];
  const nomQ = nomDe[Q === A ? youA.id : youB.id];

  // ================================= 1er tour d'un navigateur : choix manuel
  if (!manuelFait) {
    await P.until('!document.getElementById("choix").hidden && document.querySelectorAll("#choix-mots button").length === 3');
    const mots = await P.ev('[...document.querySelectorAll("#choix-mots button .mot")].map((e) => e.textContent)');
    t(`[3] tour ${turnId} : le dessinateur (${P.nom}) voit 3 mots : ${mots.join(', ')}`, mots.length === 3 && mots.every(Boolean));
    t(`[4] tour ${turnId} : l autre ne voit pas le choix, mais qui choisit et le compte à rebours`,
      await Q.ev('document.getElementById("choix").hidden') && new RegExp(`${nomDe[tr.drawer]} choisit un mot`).test(await Q.texte('#bandeau'))
      && /^\d+ s$/.test(await Q.texte('#chrono')));
    t(`[4] tour ${turnId} : aucun des 3 mots chez l autre (ni à l écran, ni sur le fil), ni chez le robot`,
      (await Promise.all(mots.map(async (m) => !(await visibleDans(Q, m)) && !fuite(await Q.recu(), m, turnId) && !fuite(R.msgs, m, turnId)))).every(Boolean)
      && (await Q.recu('choices')).length === 0 && !R.msgs.some((m) => m.type === 'choices' && m.turnId === turnId));
    await P.shot(`t${turnId}-choix`);
    await P.clic('#choix-mots button:nth-child(2)');
    await P.until(`window.__recu.some((m) => m.type === 'drawing' && m.turnId === ${turnId})`);
    const dr = (await P.recu('drawing')).find((m) => m.turnId === turnId);
    const mot = dr.word;
    t(`[5] tour ${turnId} : choix manuel — c est le 2e mot (« ${mot} »), pas un tirage`, mot === mots[1] && dr.auto === false
      && (await P.envoye('choose')).filter((m) => m.turnId === turnId).length === 1);
    t(`[5] tour ${turnId} : un seul choix possible (les boutons s éteignent, le panneau se range)`, await P.ev('document.getElementById("choix").hidden'));
    await Q.until(`window.__recu.some((m) => m.type === 'drawing' && m.turnId === ${turnId})`);
    t(`[7] tour ${turnId} : le mot est chez le dessinateur (bandeau et gabarit)`, (await P.texte('#bandeau')).includes(mot) && (await P.texte('#gabarit')) === mot);
    const nbLettres = (await Q.recu('drawing')).find((m) => m.turnId === turnId).letters;
    t(`[8] tour ${turnId} : l autre a le gabarit (${nbLettres} cases vides), pas le mot`,
      await Q.ev('document.querySelectorAll("#gabarit .l").length') === nbLettres && await Q.ev('document.querySelectorAll("#gabarit .l.revele").length') === 0
      && !(await visibleDans(Q, mot)) && !fuite(await Q.recu(), mot, turnId));
    t(`[8] tour ${turnId} : compte à rebours du dessin`, /^\d+ s$/.test(await Q.texte('#chrono')));
    // Mesuré, pas supposé : au bureau, le champ (width: 100 % sans border-box) débordait de la colonne.
    const deborde = (p) => p.ev(`(() => { const d = document.getElementById('devinettes').getBoundingClientRect(), b = document.getElementById('devine-envoyer').getBoundingClientRect();
      return d.right > innerWidth + 1 || (b.width > 0 && b.right > d.right + 1) || document.documentElement.scrollWidth > innerWidth; })()`);
    const mesures = (p) => p.ev(`(() => { const d = document.getElementById('devinettes').getBoundingClientRect(), b = document.getElementById('devine-envoyer').getBoundingClientRect();
      return { iw: innerWidth, sw: document.documentElement.scrollWidth, d: Math.round(d.right), b: Math.round(b.right), bw: Math.round(b.width) }; })()`);
    t(`tour ${turnId} : rien ne déborde de la colonne des devinettes (bureau et téléphone)`, !(await deborde(A)) && !(await deborde(B)),
      JSON.stringify({ A: await mesures(A), B: await mesures(B) }));
    // innerText compte aussi le texte d'un .sr-only (masqué par découpe) : on lit le texte VISIBLE, hors .sr-only.
    t(`tour ${turnId} : le texte pour lecteur d écran du gabarit est hors de l écran (.sr-only)`,
      await Q.ev(`(() => { const i = document.getElementById('gabarit-info'); const sr = i.querySelector('.sr-only');
        return !!sr && /vide/.test(sr.textContent) && ![...i.childNodes].filter((n) => n.nodeType === 3).some((n) => /vide/.test(n.textContent)); })()`));
    t(`[15] tour ${turnId} : le dessinateur n a pas de champ de réponse`, !(await P.visible('#devine-form')) && !(await P.visible('#devine')));
    await P.geste([[0.2, 0.2], [0.8, 0.7]]);
    t(`[9] tour ${turnId} : le dessin reste synchronisé`, await Q.until(`JSON.stringify(window.__croquis.dessin.traits) === ${JSON.stringify(await P.traits())} && !window.__croquis.dessin.ouvert`));

    // ---- devinettes
    await deviner(Q, 'zzz');
    t(`[10] tour ${turnId} : mauvaise réponse visible chez tous (« ${nomQ} : zzz »)`, await P.until(`[...document.querySelectorAll('#fil li')].some((li) => /zzz/.test(li.textContent))`)
      && (await filTexte(Q)).some((l) => /zzz/.test(l)) && R.msgs.some((m) => m.type === 'chat' && m.text === 'zzz'));
    await deviner(Q, `c'est un ${mot} ?`);
    t(`[11] tour ${turnId} : un message qui contient le mot est retenu, expliqué à son auteur seul`, /écris juste le mot/.test(await Q.texte('#devine-retour'))
      && !(await visibleDans(P, `c'est un ${mot}`)));
    await deviner(Q, mot.toUpperCase());
    t(`[12] tour ${turnId} : « ✓ ${nomQ} a trouvé ! » chez le dessinateur, « ✓ Tu as trouvé » chez lui`,
      await P.until(`[...document.querySelectorAll('#fil li')].some((li) => /${nomQ} a trouvé/.test(li.textContent))`)
      && (await filTexte(Q)).some((l) => /Tu as trouvé/.test(l)));
    t(`[11] tour ${turnId} : la bonne réponse n a fui nulle part (ni chez le dessinateur, ni chez le robot)`,
      !(await P.recu('chat')).some((m) => m.text.toLowerCase().includes(mot.toLowerCase()))
      && !R.msgs.some((m) => m.type === 'chat' && m.text.toLowerCase().includes(mot.toLowerCase())) && !fuite(R.msgs, mot, turnId));
    t(`[12] tour ${turnId} : le trouveur voit « Tu as trouvé ! », son champ sert à parler aux trouveurs`,
      /Tu as trouvé/.test(await Q.texte('#bandeau')) && /trouveurs/.test(await Q.ev('document.getElementById("devine").placeholder')));
    await deviner(Q, mot);
    await deviner(Q, 'bien joué');
    await sleep(300);
    const founds = (await P.recu('found')).filter((m) => m.turnId === turnId && m.id === (Q === A ? youA.id : youB.id));
    t(`[13] tour ${turnId} : retaper le mot ne refait pas trouver (1 seul found)`, founds.length === 1
      && (await filTexte(P)).filter((l) => new RegExp(`${nomQ} a trouvé`).test(l)).length === 1);
    t(`[13] tour ${turnId} : … ses messages partent aux trouveurs et au dessinateur seulement`,
      (await P.recu('chat')).some((m) => m.scope === 'found' && m.text === 'bien joué') && !R.msgs.some((m) => m.type === 'chat' && m.text === 'bien joué'));
    await P.ev(`NET.send({ action: 'guess', turnId: ${turnId}, text: ${JSON.stringify(mot)} }); true`);
    await P.until(`window.__recu.some((m) => m.type === 'refused' && m.reason === 'IS_DRAWER')`);
    t(`[15] tour ${turnId} : une devinette forgée par le dessinateur est refusée (IS_DRAWER)`, (await P.recu('refused')).some((m) => m.reason === 'IS_DRAWER'));
    await Q.shot(`t${turnId}-devineur`); await P.shot(`t${turnId}-dessinateur`);

    // ---- fin : tout le monde a trouvé (le robot trouve en dernier)
    R.send({ action: 'guess', turnId, text: mot });
    t(`[16] tour ${turnId} : le dernier trouve → « Tout le monde a trouvé ! Le mot était « ${mot} » »`,
      await Q.until(`/Tout le monde a trouvé/.test(document.getElementById('bandeau').textContent) && document.getElementById('bandeau').textContent.includes(${JSON.stringify(mot)})`)
      && await P.until(`/Tout le monde a trouvé/.test(document.getElementById('bandeau').textContent)`));
    t(`[16] tour ${turnId} : entrées bloquées (champ éteint), dessin conservé chez l autre`,
      await Q.ev('document.getElementById("devine").disabled') && JSON.parse(await Q.traits()).length === 1);
    const avantTraits = await P.traits();
    const avantEnvois = (await P.envoye('stroke')).length;
    await P.geste([[0.1, 0.9], [0.9, 0.9]]);
    await sleep(150);
    // Le geste doit tomber PENDANT la révélation de ce tour : si le tour
    // suivant a déjà commencé, la mesure ne dit plus rien (la feuille a été vidée).
    const suivantDeja = (await P.recu('turn')).some((m) => m.turnId > turnId);
    t(`[16] tour ${turnId} : le dessinateur ne dessine plus après la fin (rien tracé, rien envoyé)`,
      !suivantDeja && await P.traits() === avantTraits && (await P.envoye('stroke')).length === avantEnvois,
      suivantDeja ? 'mesure invalide : le tour suivant avait déjà commencé (révélation trop courte pour le harnais)' : '');
    await Q.shot(`t${turnId}-fin`);
    manuelFait = true;

  // ===================== 2e tour d'un navigateur : choix auto, indices, chrono
  } else {
    await P.until('!document.getElementById("choix").hidden');
    // Personne ne clique : le serveur tire au sort à l'échéance (4 s).
    t(`[6] tour ${turnId} : sans clic, le tirage automatique fait passer au dessin`,
      await Q.until(`window.__recu.some((m) => m.type === 'drawing' && m.turnId === ${turnId} && m.auto === true)`, 7000)
      && await P.until('document.getElementById("choix").hidden') && (await filTexte(Q)).some((l) => /tiré au sort/.test(l)));
    const mot = (await P.recu('drawing')).find((m) => m.turnId === turnId).word;
    const nb = (await Q.recu('drawing')).find((m) => m.turnId === turnId).letters;
    t(`[7] tour ${turnId} : le mot tiré (« ${mot} ») est chez le dessinateur seul`, (await P.texte('#bandeau')).includes(mot) && !(await visibleDans(Q, mot)) && !fuite(await Q.recu(), mot, turnId));
    // indice à 50 % (6 s), et à 75 % (9 s) pour un mot de 6 lettres ou plus
    t(`[14] tour ${turnId} : 1er indice (50 %) — une case révélée, la bonne lettre à la bonne place`,
      await Q.until('document.querySelectorAll("#gabarit .l.revele").length === 1', 9000)
      && await Q.ev(`[...document.querySelectorAll('#gabarit > span')].every((s, i) => !s.classList.contains('revele') || ${JSON.stringify(Array.from(mot))}[i].toLowerCase() === s.textContent.toLowerCase())`));
    if (nb >= 6) t(`[14] tour ${turnId} : 2e indice (75 %, mot de ${nb} lettres)`, await Q.until('document.querySelectorAll("#gabarit .l.revele").length === 2', 5000));
    else t(`[14] tour ${turnId} : mot de ${nb} lettres → pas de 2e indice`, (await sleep(3500), await Q.ev('document.querySelectorAll("#gabarit .l.revele").length === 1')));
    t(`[14] tour ${turnId} : le gabarit ne montre jamais le mot entier`, await Q.ev(`document.querySelectorAll('#gabarit .l:not(.revele)').length >= 1`) && !(await visibleDans(Q, mot)));
    await Q.shot(`t${turnId}-indices`);
    t(`[17] tour ${turnId} : personne ne trouve → « Temps écoulé ! », le mot est donné`,
      await Q.until(`/Temps écoulé/.test(document.getElementById('bandeau').textContent) && document.getElementById('bandeau').textContent.includes(${JSON.stringify(mot)})`, 8000));
    t(`[17] tour ${turnId} : champ éteint après le chrono`, await Q.ev('document.getElementById("devine").disabled'));
    autoFait = true;
  }
  tourPrecedent = tr;
}

t('les trois scénarios ont été joués (choix manuel, choix auto + indices + chrono, tour du robot)', manuelFait && autoFait && robotFait);

const { ok, ko } = t.bilan();
console.log(`\n${ok} OK, ${ko} KO`);
fin();
process.exit(ko ? 1 : 0);
