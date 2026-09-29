// La FIN DE PARTIE en mode Game Hub : la même vérification pour les sept jeux
// (lot F). Importé par les suites qui jouent une vraie partie lancée depuis le
// Hub, dans un vrai navigateur : hub-score-{morpion, imitation, demicercle,
// ban, precision, quiment}.mjs et handoff-play.mjs (Le Passeur).
//
// Ce qu'on attend, posé par HubHandoff.endActions() (hub-handoff.js) :
//   1. « ↩ Retour au Game Hub » (#to-hub) est visible, et c'est l'action
//      PRINCIPALE : un vrai bouton plein, et le focus est dessus ;
//   2. la revanche du jeu existe, dit « Revanche (hors score) », et reste
//      SECONDAIRE : moins marquée (sans fond, ou plus petite), et APRÈS le
//      retour au Hub — à l'écran comme au clavier. Exception assumée : le
//      bouton rond de Précision vit DANS le plateau (couches positionnées),
//      il garde sa place ; seul son habit change ;
//   3. à 390 / 768 / 1280 px, rien ne déborde.
// Le « rien de recompté par une revanche » est vérifié là où une revanche est
// VRAIMENT jouée : hub-score-quiment.mjs (et quiment-replay.mjs).
//
// Dépend seulement de J.eval / J.size / J.shot, communs aux suites.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// L'état de la fin, lu dans la page. `replay` : l'id du bouton de revanche.
export const SONDE = (replay) => `(() => {
  const R = (e) => e.getBoundingClientRect();
  const vu = (e) => !!e && e.checkVisibility();
  const cs = (e) => getComputedStyle(e);
  const plein = (e) => { const m = cs(e).backgroundColor.match(/[\\d.]+/g) || []; return (m.length < 4 || +m[3] > .5) && m.length >= 3; };
  const h = document.getElementById('to-hub'), r = ${replay ? `document.getElementById(${JSON.stringify(replay)})` : 'null'};
  const hr = R(h), rr = r && vu(r) ? R(r) : null;
  return {
    home: { vu: vu(h), classe: h.classList.contains('g-hub-home'), texte: h.textContent.trim(), plein: plein(h),
      taille: parseFloat(cs(h).fontSize), focus: document.activeElement === h,
      dedans: hr.left >= -1 && hr.right <= innerWidth + 1 },
    replay: r ? { vu: vu(r), classe: r.classList.contains('g-hub-replay') || r.classList.contains('g-hub-replay-icon'),
      nom: (r.getAttribute('aria-label') || r.textContent).trim(), plein: plein(r), taille: parseFloat(cs(r).fontSize),
      apres: !!(h.compareDocumentPosition(r) & Node.DOCUMENT_POSITION_FOLLOWING),
      dessous: rr ? rr.top >= hr.bottom - 1 || rr.left >= hr.right - 1 : null,
      dedans: rr ? rr.left >= -1 && rr.right <= innerWidth + 1 : true } : null,
    scrollX: document.documentElement.scrollWidth > innerWidth + 1,
  };
})()`;

// Vérifie la fin chez UN joueur, déjà sur l'écran de fin (#to-hub visible).
//   jeu     : pour les libellés (« Imitation — A ») ;
//   replay  : id de la revanche (null : le Morpion n'en a pas) ;
//   icone   : la revanche est le bouton rond de Précision (voir plus haut) ;
//   hote    : la revanche est réservée à l'hôte (Passeur, Qui Ment ?) ;
//   largeurs, taille de retour, sélecteur de capture.
export async function finHub(J, t, jeu, { replay = null, icone = false, hote = true, largeurs = [[390, 780], [768, 1024], [1280, 900]],
  retour = [1280, 900], capture = '[data-fin-hub]', shots = true } = {}) {
  // La capture : le bloc qui porte le retour au Hub (podium + actions), marqué
  // pour J.shot — un attribut de test, rien d'autre ne le lit.
  await J.eval(`document.getElementById('to-hub').parentElement.setAttribute('data-fin-hub', ''); true`);
  await J.until(`document.activeElement === document.getElementById('to-hub')`, 3000, `focus sur le retour au Hub (${jeu})`).catch(() => {});
  const v = await J.eval(SONDE(replay));
  t(`${jeu} — fin en mode Hub : « ↩ Retour au Game Hub » est l'action PRINCIPALE (bouton plein, focus dessus)`,
    v.home.vu && v.home.classe && /Retour au Game Hub/.test(v.home.texte) && v.home.plein && v.home.focus, JSON.stringify(v.home));
  if (replay) {
    if (hote) {
      const r = v.replay;
      t(`${jeu} — la revanche est SECONDAIRE : « Revanche (hors score) », moins marquée, ${icone ? 'bouton rond du plateau (exception : il reste dans le plateau)' : 'après le retour au Hub (écran et clavier)'}`,
        r.vu && r.classe && /Revanche \(hors score\)/.test(r.nom) && (!r.plein || r.taille < v.home.taille) && (icone || (r.apres && r.dessous)), JSON.stringify(r));
    } else {
      t(`${jeu} — invité : pas de revanche (réservée à l'hôte), le retour au Hub seul`, !v.replay.vu, JSON.stringify(v.replay));
    }
  }
  for (const [w, h] of largeurs) {
    await J.size(w, h); await sleep(250);
    await J.eval(`document.getElementById('to-hub').scrollIntoView({ block: 'center', behavior: 'instant' }); true`);
    const g = await J.eval(SONDE(replay));
    t(`${jeu}, ${w} px : retour au Hub et revanche dans l'écran, pas de défilement horizontal`,
      g.home.vu && g.home.dedans && (!g.replay || g.replay.dedans) && !g.scrollX, JSON.stringify({ home: g.home, replay: g.replay, scrollX: g.scrollX }));
    if (shots) await J.shot(`fin-hub-${jeu.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${w}`, capture);
  }
  await J.size(...retour); await sleep(250);
}
