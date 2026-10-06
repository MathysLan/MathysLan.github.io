// Faux Témoin — la page du jeu : salon, tapissage, flash, déclarations,
// verrou, audit, classement.
//
// AUCUNE règle de jeu ici : temoin-server tire le tapissage, les rôles et les
// fragments, tient les phases, refuse ce qui doit l'être et calcule TOUS les
// points (README du serveur). Cette page envoie des intentions (« je déclare :
// manteau rouge », « je verrouille le 7 ») et montre ce qui arrive.
//
// Ce qui est LOCAL, et seulement local : rayer un suspect (un bloc-notes, sans
// aucune élimination automatique : la déduction reste celle du joueur), le
// suspect choisi dans la fiche, et le décompte du chrono à partir du
// `remainingMs` du serveur.
//
// Game Hub : le handoff de Croq.ios (games/shared/hub-handoff.js), « lancé par
// le Hub » plus bas ; sans billet, rien ne change.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const S = window.TemoinSuspects;
  const AVATARS = ['🕵️', '🦊', '🐼', '😎', '🤖', '👻', '🔥', '⚡', '🎭', '🍕', '🐙', '🪖'];
  const DEFAUT = '🕵️';
  const SCREENS = ['home', 'lobby', 'play', 'end', 'lost'];
  const MEDAILLES = ['🥇', '🥈', '🥉'];
  const place = (rank) => (rank >= 1 && rank <= 3 ? MEDAILLES[rank - 1] : rank + 'e');
  const show = (id) => { SCREENS.forEach((s) => { $(s).hidden = s !== id; }); };
  const showError = (m) => { $('error').textContent = m ? '> ' + m : ''; };
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const pointeurFin = () => window.matchMedia('(pointer: fine)').matches;
  const INDIC = 'indic';

  // Les points d'un bon verrou selon la phase : ce que le serveur annonce dans
  // son README, affiché pour que le joueur sache ce qu'il risque. Le serveur
  // seul les compte (le total vient toujours de lui).
  const PALIERS = { declare2: 5, deliberate: 3, lastcall: 1 };
  const PHASES = {
    flash: 'Le flash !',
    declare1: 'Déclaration 1',
    declare2: 'Révélation 1 · Déclaration 2',
    deliberate: 'Révélation 2 · Délibération',
    lastcall: 'Dernier appel',
    results: 'L’audit',
  };

  // ------------------------------------------------------------ état reçu
  let myId = null, isHost = false;
  let attrs = [];              // le vocabulaire du serveur ({ id, values })
  let roster = new Map();      // id → { name, avatar, left }
  let scores = new Map();      // id → { score, left } — TELS QUE LE SERVEUR LES ENVOIE
  let kase = null;             // { caseId, cases, lineup, liars, indic }
  let phase = 'home';
  let role = null;             // { role, fragment, culprit } — le mien, à moi seul
  let rounds = [];             // les tours révélés
  let declares = [];           // qui a déclaré ce tour (ids)
  let verrous = 0;             // le NOMBRE de verrous posés
  let maDecl = [undefined, undefined];   // ma déclaration par tour (null = silence)
  let monVerrou = null;        // { suspect, accuse }
  let audit = null;
  let choisi = null;           // index du suspect dans la fiche (local)
  let rayes = new Set();       // suspects rayés (local, par affaire)
  let declAttr = null, declVal = null;
  let finLocale = 0;
  let nbJoueurs = 0;
  let nbAffaires = 5;
  const nomDe = (id) => (id === INDIC ? 'L’indic' : (roster.get(id) || {}).name || 'quelqu’un');
  const enDeclaration = () => phase === 'declare1' || phase === 'declare2';
  const tourEnCours = () => (phase === 'declare1' ? 0 : phase === 'declare2' ? 1 : null);
  const peutVerrouiller = () => !!PALIERS[phase] && !monVerrou && NET.connected();

  // ------------------------------------------------------------ affichage
  function bandeau() {
    const b = $('bandeau');
    if (!kase) { b.textContent = 'La partie commence…'; $('palier').textContent = ''; return; }
    b.textContent = `Affaire ${kase.caseId}/${kase.cases} · ${PHASES[phase] || ''}`;
    let p = '';
    if (PALIERS[phase]) p = monVerrou ? 'Ton verrou est posé.' : `Un bon verrou vaut ${PALIERS[phase]} point${PALIERS[phase] > 1 ? 's' : ''} maintenant.`;
    else if (phase === 'declare1') p = 'Le verrou s’ouvre à la révélation 1.';
    $('palier').textContent = p;
  }

  // LE TAPISSAGE. Une carte par suspect : son numéro (1 à n, l'index du
  // serveur + 1), son portrait, et sa description complète dans l'aria-label.
  function construireMur() {
    const mur = $('mur');
    mur.replaceChildren();
    mur.dataset.n = String(kase.lineup.length);
    kase.lineup.forEach((s, i) => {
      const b = el('button', 'carte');
      b.type = 'button';
      b.dataset.i = String(i);
      const desc = S.decrire(s);
      b.append(S.dessiner(s, { titre: `n° ${i + 1} : ${desc}` }), el('span', 'num', String(i + 1)), el('span', 'badge'));
      b.addEventListener('click', () => choisir(i));
      mur.append(b);
    });
    majMur();
  }

  function majMur() {
    if (!kase) return;
    const enAudit = !!audit;
    $('mur').classList.toggle('is-audit', enAudit);
    for (const b of $('mur').children) {
      const i = Number(b.dataset.i);
      const s = kase.lineup[i];
      b.classList.toggle('is-raye', rayes.has(i) && !enAudit);
      b.classList.toggle('is-choisi', choisi === i);
      b.classList.toggle('is-coupable', enAudit && audit.culprit === i);
      b.setAttribute('aria-pressed', String(choisi === i));
      const etat = [];
      if (rayes.has(i)) etat.push('rayé');
      if (monVerrou && monVerrou.suspect === i) etat.push('ton verrou');
      if (enAudit && audit.culprit === i) etat.push('le coupable');
      b.setAttribute('aria-label', `Suspect ${i + 1} : ${S.decrire(s)}${etat.length ? ' — ' + etat.join(', ') : ''}`);
      b.querySelector('.badge').textContent = monVerrou && monVerrou.suspect === i ? '🔒' : '';
      const t = b.querySelector('.tampon');
      if (enAudit && audit.culprit === i) { if (!t) b.append(el('span', 'tampon', 'COUPABLE')); }
      else if (t) t.remove();
    }
  }

  // ------------------------------------------------------------ mon rôle
  function majTemoin() {
    const r = $('role');
    r.classList.toggle('is-menteur', !!role && role.role === 'liar');
    if (!role) { r.textContent = ''; $('souvenir').textContent = ''; $('flash').hidden = true; return; }
    r.textContent = role.role === 'liar' ? '🎭 Tu es le FAUX TÉMOIN' : role.role === 'witness' ? '👁️ Tu es témoin' : 'Tu regardes cette affaire';
    const flash = $('flash');
    if (phase === 'flash') {
      flash.replaceChildren(polaroid());
      flash.hidden = false;
      $('souvenir').textContent = role.role === 'liar'
        ? 'Tu as tout vu. Mens sans te faire prendre : déclare des détails qui désignent un autre suspect.'
        : 'Retiens bien : ce sera parti dans 3 secondes.';
    } else {
      flash.hidden = true;
      flash.replaceChildren();
      $('souvenir').textContent = phase === 'results' ? ''
        : role.role === 'liar' ? 'Brouille les pistes. Tes points : les témoins qui se trompent, et +2 si personne ne te soupçonne.'
          : 'Le flash est passé. Ce que tu as vu, à toi de t’en souvenir. Une déclaration fausse, et ton affaire vaut 0.';
    }
  }

  // La photo du flash : ce que J'AI vu. Le Faux Témoin voit le coupable en
  // entier (portrait compris) ; un témoin, ses seuls attributs.
  function polaroid() {
    const p = el('figure', 'polaroid');
    p.append(el('p', 'titre', role.role === 'liar' ? 'Le coupable, en entier' : 'Ce que tu as vu'));
    if (role.role === 'liar') p.append(S.dessiner(Object.fromEntries(role.fragment.map((f) => [f.attr, f.value]))));
    const ul = el('ul', 'vu');
    for (const f of role.fragment) {
      const li = el('li');
      li.append(el('span', 'attr', S.nomAttr(f.attr)), document.createTextNode(S.court(f.attr, f.value)));
      ul.append(li);
    }
    p.append(ul);
    return p;
  }

  // ------------------------------------------------------- la déclaration
  function construireDeclaration() {
    const box = $('decl-attrs');
    box.replaceChildren();
    for (const a of attrs) {
      const b = el('button', null, S.nomAttr(a.id));
      b.type = 'button';
      b.dataset.attr = a.id;
      b.addEventListener('click', () => { declAttr = a.id; declVal = null; majDeclaration(); });
      box.append(b);
    }
  }

  function majDeclaration() {
    const t = tourEnCours();
    const visible = enDeclaration() && !!kase;
    $('declarer').hidden = !visible;
    if (!visible) return;
    const deja = maDecl[t] !== undefined;
    $('decl-titre').textContent = `Ta déclaration ${t + 1}/2`;
    for (const b of $('decl-attrs').children) {
      b.setAttribute('aria-pressed', String(b.dataset.attr === declAttr));
      b.disabled = deja;
    }
    const vals = $('decl-valeurs');
    vals.replaceChildren();
    const a = attrs.find((x) => x.id === declAttr);
    if (a && !deja) {
      vals.setAttribute('aria-label', S.nomAttr(a.id));
      for (const v of a.values) {
        const b = el('button', null, S.court(a.id, v));
        b.type = 'button';
        b.setAttribute('aria-pressed', String(v === declVal));
        b.addEventListener('click', () => { declVal = v; majDeclaration(); $('decl-envoyer').focus(); });
        vals.append(b);
      }
    }
    vals.hidden = !a || deja;
    const pret = !deja && declAttr && declVal && NET.connected();
    $('decl-envoyer').disabled = !pret;
    $('decl-envoyer').textContent = declAttr && declVal ? `Déclarer : ${S.long(declAttr, declVal)}` : 'Déclarer';
    $('decl-taire').disabled = deja || !NET.connected();
    const n = declares.length;
    const presents = [...scores.values()].filter((s) => !s.left).length;
    const moi = maDecl[t];
    $('decl-etat').textContent = (deja ? (moi ? `Tu as déclaré : ${S.long(moi.attr, moi.value)}. ` : 'Tu ne dis rien ce tour-ci. ') : '')
      + `${n}/${presents} ont déclaré.`;
  }

  function declarer(silence) {
    const t = tourEnCours();
    if (t == null || maDecl[t] !== undefined) return;
    if (silence) {
      maDecl[t] = null;
      NET.send({ action: 'declare', caseId: kase.caseId, pass: true });
    } else {
      if (!declAttr || !declVal) return;
      maDecl[t] = { attr: declAttr, value: declVal };
      NET.send({ action: 'declare', caseId: kase.caseId, attr: declAttr, value: declVal });
    }
    majDeclaration();
  }
  $('decl-envoyer').addEventListener('click', () => declarer(false));
  $('decl-taire').addEventListener('click', () => declarer(true));

  // --------------------------------------------------------- révélations
  // Le décompte par attribut d'abord (lisible à 16), puis qui a dit quoi.
  function majRevelations() {
    $('revelations').hidden = !rounds.length;
    const box = $('tours');
    box.replaceChildren();
    for (const r of rounds.slice().reverse()) {
      const sec = el('section', 'tour-revele');
      sec.append(el('h3', null, `Révélation ${r.round}`));
      const ul = el('ul', 'decompte');
      for (const a of S.ORDRE) {
        const vals = r.summary[a];
        if (!vals) continue;
        const li = el('li');
        li.append(el('span', 'attr', S.nomAttr(a) + ' : '));
        const conflit = Object.keys(vals).length > 1;
        Object.entries(vals).sort((x, y) => y[1] - x[1]).forEach(([v, n], k) => {
          if (k) li.append(document.createTextNode(', '));
          li.append(el('span', 'val' + (conflit ? ' is-conflit' : ''), `${S.court(a, v)} ×${n}`));
        });
        ul.append(li);
      }
      if (!ul.children.length) ul.append(el('li', 'aide', 'Personne n’a rien dit.'));
      sec.append(ul);
      const det = el('details', 'qui-dit');
      det.open = r.declarations.length <= 6;
      det.append(el('summary', null, 'Qui a dit quoi'));
      const liste = el('ul');
      for (const d of r.declarations) {
        const li = el('li');
        const id = d.id;
        if (id === INDIC) li.append(el('span', null, '📞'));
        else li.append(GameAvatar.node((roster.get(id) || {}).avatar, DEFAUT, 'sm'));
        li.append(el('span', null, nomDe(id) + (id === myId ? ' (toi)' : '') + ' : '));
        li.append(d.pass ? el('span', 'silence', 'se tait') : el('strong', null, S.long(d.attr, d.value)));
        liste.append(li);
      }
      det.append(liste);
      sec.append(det);
      box.append(sec);
    }
  }

  // ------------------------------------------------------------ la fiche
  function choisir(i) {
    choisi = choisi === i ? null : i;
    majMur();
    majFiche();
    if (choisi != null && !pointeurFin()) $('fiche').scrollIntoView({ behavior: 'instant', block: 'nearest' });
  }

  function majFiche() {
    const f = $('fiche');
    f.hidden = choisi == null || !kase || phase === 'results';
    if (f.hidden) return;
    const s = kase.lineup[choisi];
    $('fiche-portrait').replaceChildren(S.dessiner(s));
    $('fiche-titre').textContent = `Suspect n° ${choisi + 1}`;
    $('fiche-desc').textContent = S.decrire(s);
    $('rayer').textContent = rayes.has(choisi) ? 'Ne plus rayer ce suspect' : 'Rayer ce suspect';
    const v = $('verrou');
    v.hidden = !PALIERS[phase] || !!monVerrou;
    if (!v.hidden) {
      $('lock').textContent = `🔒 Verrouiller le n° ${choisi + 1}`;
      $('lock').disabled = !peutVerrouiller();
    }
    majVerrouEtat();
  }

  function majVerrouEtat() {
    const presents = [...scores.values()].filter((s) => !s.left).length;
    let t = '';
    if (monVerrou) t = `Ton verrou : n° ${monVerrou.suspect + 1}${monVerrou.accuse ? `, et tu désignes ${nomDe(monVerrou.accuse)}` : ''}. `;
    else if (phase === 'declare1' || phase === 'flash') t = 'Le verrou s’ouvre à la révélation 1. ';
    if (PALIERS[phase] || monVerrou) t += `${verrous}/${presents} verrous posés.`;
    $('lock-etat').textContent = t;
  }

  function remplirAccuse() {
    const sel = $('accuse');
    const garde = sel.value;
    sel.replaceChildren();
    const aucun = el('option', null, 'Personne');
    aucun.value = '';
    sel.append(aucun);
    for (const [id, r] of roster) {
      if (id === myId || r.left) continue;
      const o = el('option', null, r.name);
      o.value = id;
      sel.append(o);
    }
    sel.value = [...sel.options].some((o) => o.value === garde) ? garde : '';
    // À deux, il n'y a pas de Faux Témoin à désigner : l'indic ment pour lui.
    $('verrou').querySelector('label').hidden = !!(kase && kase.indic);
    sel.hidden = !!(kase && kase.indic);
  }

  $('rayer').addEventListener('click', () => {
    if (choisi == null) return;
    if (rayes.has(choisi)) rayes.delete(choisi); else rayes.add(choisi);
    majMur();
    majFiche();
  });
  $('lock').addEventListener('click', () => {
    if (choisi == null || !peutVerrouiller()) return;
    const accuse = kase.indic ? '' : $('accuse').value;
    monVerrou = { suspect: choisi, accuse: accuse || null };
    NET.send({ action: 'lock', caseId: kase.caseId, suspect: choisi, accuse: accuse || undefined });
    majMur();
    majFiche();
    bandeau();
  });

  // ---------------------------------------------------------------- audit
  function afficherAudit(m) {
    audit = m.audit;
    const a = audit;
    const pts = new Map(a.points.map((p) => [p.id, p]));
    const decl = (id) => a.declarations.filter((d) => d.id === id);
    const verrouDe = new Map(a.locks.map((l) => [l.id, l]));
    const menteurs = new Set(a.liars);
    $('audit-titre').textContent = `Affaire ${m.caseId}/${m.cases} : le coupable était le n° ${a.culprit + 1}`;
    $('audit-coupable').textContent = S.decrire(kase.lineup[a.culprit]) + '. '
      + (a.liars.length ? `${a.liars.length > 1 ? 'Faux Témoins' : 'Faux Témoin'} : ${a.liars.map(nomDe).join(', ')}.`
        : kase.indic ? 'L’indic a menti une fois sur deux.' : 'Pas de Faux Témoin dans cette affaire !');
    const ol = $('audit-liste');
    ol.replaceChildren();
    const ids = [...new Set([...a.points.map((p) => p.id), ...a.declarations.map((d) => d.id)])];
    ids.sort((x, y) => (x === INDIC) - (y === INDIC) || ((pts.get(y) || {}).points || 0) - ((pts.get(x) || {}).points || 0));
    for (const id of ids) {
      const li = el('li', 'audit-ligne' + (menteurs.has(id) ? ' is-menteur' : '') + (id === myId ? ' is-moi' : ''));
      li.append(id === INDIC ? el('span', null, '📞') : GameAvatar.node((roster.get(id) || {}).avatar, DEFAUT, 'sm'));
      const nom = el('span', 'nom', nomDe(id) + (id === myId ? ' (toi)' : ''));
      const det = el('span', 'det');
      decl(id).forEach((d, k) => {
        if (k) det.append(document.createTextNode(' · '));
        if (d.attr == null) det.append(document.createTextNode(`${d.round} : se tait`));
        else {
          det.append(document.createTextNode(`${d.round} : ${S.long(d.attr, d.value)} `));
          const ok = d.truth === true;
          const s = el('span', ok ? 'vrai' : 'faux', ok ? '✓' : '✗');
          s.setAttribute('aria-label', ok ? 'vrai' : 'faux');
          det.append(s);
        }
      });
      const v = verrouDe.get(id);
      if (v && !menteurs.has(id)) {
        if (det.childNodes.length) det.append(document.createTextNode(' · '));
        det.append(document.createTextNode(`verrou n° ${v.suspect + 1} `));
        const s = el('span', v.correct ? 'vrai' : 'faux', v.correct ? '✓' : '✗');
        s.setAttribute('aria-label', v.correct ? 'juste' : 'faux');
        det.append(s);
        if (v.accuse) det.append(document.createTextNode(` · désigne ${nomDe(v.accuse)} ${v.accuseCorrect ? '✓' : '✗'}`));
      } else if (!menteurs.has(id) && id !== INDIC) {
        if (det.childNodes.length) det.append(document.createTextNode(' · '));
        det.append(document.createTextNode('pas de verrou'));
      }
      nom.append(det);
      li.append(nom);
      const p = pts.get(id);
      li.append(id === INDIC || !p ? el('span', 'pts zero', '') : el('span', 'pts' + (p.points ? '' : ' zero'), `+${p.points}`));
      ol.append(li);
    }
    $('suivante').hidden = !isHost || m.last;
    $('suivante').textContent = 'Affaire suivante ▶';
  }
  $('suivante').addEventListener('click', () => NET.send({ action: 'next' }));

  // ---------------------------------------------------------------- scores
  function ligneJoueur(id, ...droite) {
    const r = roster.get(id) || {};
    const li = el('li', 'ligne-joueur');
    li.dataset.id = id;
    if (id === myId) li.classList.add('is-moi');
    if (r.left || (scores.get(id) || {}).left) li.classList.add('is-parti');
    li.append(GameAvatar.node(r.avatar, DEFAUT, 'sm'), el('span', 'nom', (r.name || '?') + (id === myId ? ' (toi)' : '')), ...droite);
    return li;
  }
  function majScores(liste) {
    for (const p of liste || []) {
      const s = scores.get(p.id) || { score: 0, left: false };
      if (Number.isFinite(p.score)) s.score = p.score;
      if (typeof p.left === 'boolean') s.left = p.left;
      scores.set(p.id, s);
      const r = roster.get(p.id);
      if (r && typeof p.left === 'boolean') r.left = p.left;
    }
  }
  function majTableau() {
    const ol = $('tableau');
    ol.replaceChildren();
    const ids = [...scores.keys()].sort((a, b) => scores.get(b).score - scores.get(a).score);
    for (const id of ids) {
      const s = scores.get(id);
      const etat = s.left ? 'parti' : enDeclaration() && declares.includes(id) ? '✓ déclaré' : '';
      ol.append(ligneJoueur(id, el('span', 'etat', etat), el('span', 'total', `${s.score} pts`)));
    }
  }

  function majTout() {
    bandeau();
    majTemoin();
    majDeclaration();
    majRevelations();
    majFiche();
    majMur();
    majTableau();
    $('audit').hidden = phase !== 'results' || !audit;
  }

  // --------------------------------------------------------------- chrono
  let horloge = 0;
  function armerChrono(remainingMs) {
    finLocale = Number.isFinite(remainingMs) ? performance.now() + remainingMs : 0;
    tic();
    if (!horloge) horloge = setInterval(tic, 250);
  }
  function tic() {
    const c = $('chrono');
    const s = finLocale ? Math.max(0, Math.ceil((finLocale - performance.now()) / 1000)) : null;
    const actif = s !== null && kase && phase !== 'end';
    c.textContent = actif ? `${s} s` : '';
    c.classList.toggle('vite', !!actif && s <= 5 && phase !== 'results');
  }

  // --------------------------------------------------------------- accueil
  let myAvatar = GameProfile.startEmoji(AVATARS);
  for (const em of AVATARS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'avatar-pick' + (em === myAvatar ? ' picked' : '');
    b.textContent = em;
    b.setAttribute('aria-pressed', String(em === myAvatar));
    b.addEventListener('click', () => {
      myAvatar = em;
      document.querySelectorAll('#avatar-row .avatar-pick').forEach((x) => {
        x.classList.toggle('picked', x === b);
        x.setAttribute('aria-pressed', String(x === b));
      });
    });
    $('avatar-row').appendChild(b);
  }

  async function enter(code) {
    showError('');
    try {
      await NET.connect();
      NET.send({ action: 'join', name: $('name-input').value, avatar: GameProfile.joinAvatar(myAvatar), code: code || undefined });
    } catch (err) {
      showError(err.message);
      perte.refus(err.message);
      if (lien && viaHub && !myId) { viaHub = false; lien.failed('UNREACHABLE', err.message); }
    }
  }
  $('host').addEventListener('click', () => enter());
  $('join').addEventListener('click', () => enter($('code-input').value));
  $('code-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') enter($('code-input').value); });

  // ------------------------------------------------------- lancé par le Hub
  // Même montage que Croq.ios. Sans billet, `lien` vaut null et la page
  // marche exactement comme hors Hub.
  let viaHub = false;
  let partirSansAttendre = false;
  const lien = window.HubHandoff ? HubHandoff.start({
    gameId: 'temoin',
    join: (code) => {
      viaHub = true;
      if (!$('name-input').value.trim()) $('name-input').value = GameProfile.load().name || '';
      enter(code || undefined);
    },
    onUpdate: (i) => attente(i),
  }) : null;

  function attente(i) {
    const n = i && i.launch.stage === 'join' ? i.waitingIds.length : 0;
    const bloque = isHost && n > 0 && !partirSansAttendre;
    $('start').disabled = bloque || nbJoueurs < 2;
    $('start').textContent = bloque ? `En attente de ${i.waiting}…` : 'Lancer la partie';
    $('start-anyway').hidden = !bloque;
  }

  // --- connexion perdue (games/shared/game-net.js) -------------------------
  const perte = GameNet.surPerte(NET, {
    dansRoom: () => !!myId,
    enPartie: () => !$('play').hidden,
    code: () => $('room-code').textContent.trim(),
    quitter: () => { myId = null; kase = null; phase = 'home'; $('to-hub').hidden = true; showError(''); },
    revenir: (code) => { if (lien) viaHub = true; enter(code); },
    show, hub: !!lien,
  });
  NET.on('lost', () => { majDeclaration(); majFiche(); });

  $('room-code').addEventListener('click', async () => {
    const hint = $('code-hint');
    try { await navigator.clipboard.writeText($('room-code').textContent.trim()); hint.textContent = 'code copié ✔'; }
    catch (_) { hint.textContent = 'copie impossible — recopie le code à la main'; }
    setTimeout(() => { hint.textContent = 'clique sur le code pour le copier'; }, 2000);
  });

  // ------------------------------------------------------------------ salon
  $('start').addEventListener('click', () => NET.send({ action: 'start' }));
  $('start-anyway').addEventListener('click', () => { partirSansAttendre = true; NET.send({ action: 'start' }); });
  $('revanche').addEventListener('click', () => NET.send({ action: 'start' }));
  $('vers-salon').addEventListener('click', () => NET.send({ action: 'lobby' }));
  document.querySelectorAll('.nb-affaires').forEach((b) => b.addEventListener('click', () => {
    NET.send({ action: 'cases', cases: Number(b.dataset.cases) });
  }));

  function renderLobby(m) {
    const ul = $('players');
    ul.replaceChildren();
    for (const p of m.players) {
      const li = el('li', 'g-player');
      li.append(GameAvatar.node(p.avatar, DEFAUT, 'sm'), el('span', 'g-player-name', p.name + (p.id === myId ? ' (toi)' : '')));
      if (p.host) li.append(el('span', 'tag', 'hôte'));
      ul.append(li);
    }
    $('lobby-count').textContent = `${m.players.length} / ${m.max || 16}`;
    $('host-config').hidden = !isHost;
    nbJoueurs = m.players.length;
    nbAffaires = m.cases || nbAffaires;
    document.querySelectorAll('.nb-affaires').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.cases) === nbAffaires)));
    $('lobby-cases').textContent = `${nbAffaires} affaires, environ ${Math.round(nbAffaires * 1.1)} min.`
      + (nbJoueurs === 2 ? ' À deux, pas de Faux Témoin : un indic donne un vrai et un faux renseignement.' : '');
    attente(lien && lien.info());
    $('need-players').textContent = isHost
      ? (m.players.length < 2 ? 'Il faut au moins 2 joueurs.' : '')
      : 'En attente de l’hôte…';
  }

  // ---------------------------------------------------------- les messages
  NET.on('you', (m) => {
    myId = m.id;
    isHost = m.host;
    perte.retour();
    $('room-code').textContent = m.code;
    show('lobby');
    // Lancé par le Hub : SA place (l'id Faux Témoin, jamais celui du Hub).
    if (lien) { viaHub = false; lien.roomReady(m.code, m.id); attente(lien.info()); }
  });

  NET.on('lobby', (m) => {
    isHost = m.players.some((p) => p.id === myId && p.host);
    if (m.phase === 'end') { majFin(); return; }
    phase = 'lobby';
    kase = null;
    renderLobby(m);
    show('lobby');
  });

  // Le lancement : le vocabulaire et les identités, une fois.
  NET.on('game', (m) => {
    isHost = m.host === myId;
    attrs = m.attrs;
    roster = new Map(m.identities.map((p) => [p.id, { name: p.name, avatar: p.avatar, left: false }]));
    scores = new Map(m.identities.map((p) => [p.id, { score: 0, left: false }]));
    construireDeclaration();
    kase = null;
    show('play');
  });

  // Une nouvelle affaire : tout ce qui concernait la précédente est oublié.
  NET.on('case', (m) => {
    if (lien && isHost && m.caseId === 1) lien.started();
    kase = { caseId: m.caseId, cases: m.cases, lineup: m.lineup, liars: m.liars, indic: m.indic };
    phase = m.phase;
    role = null;
    rounds = m.rounds || [];
    declares = m.declared || [];
    verrous = m.locked || 0;
    maDecl = [undefined, undefined];
    monVerrou = null;
    audit = null;
    choisi = null;
    rayes = new Set();
    declAttr = null; declVal = null;
    majScores(m.players);
    construireMur();
    remplirAccuse();
    show('play');
    armerChrono(m.remainingMs);
    majTout();
    $('bandeau').focus && $('temoin').scrollIntoView({ behavior: 'instant', block: 'nearest' });
  });

  // Mon rôle : à moi seul (le serveur ne l'envoie à personne d'autre).
  NET.on('role', (m) => {
    if (!kase || m.caseId !== kase.caseId) return;
    role = { role: m.role, fragment: m.fragment, culprit: m.culprit };
    majTemoin();
  });

  NET.on('phase', (m) => {
    if (!kase || m.caseId !== kase.caseId) return;
    const avant = phase;
    phase = m.phase;
    rounds = m.rounds || rounds;
    verrous = m.locked;
    if (m.phase !== avant && enDeclaration()) { declares = []; declAttr = null; declVal = null; }
    armerChrono(m.remainingMs);
    majTout();
  });

  NET.on('declared', (m) => {
    if (!kase || m.caseId !== kase.caseId) return;
    declares = m.declared;
    majDeclaration();
    majTableau();
  });

  NET.on('locked', (m) => {
    if (!kase || m.caseId !== kase.caseId) return;
    verrous = m.locked;
    majVerrouEtat();
  });

  NET.on('case-end', (m) => {
    if (!kase || m.caseId !== kase.caseId) return;
    phase = 'results';
    rounds = m.rounds || rounds;
    majScores(m.players);
    afficherAudit(m);
    armerChrono(m.remainingMs);
    majTout();
    $('audit').scrollIntoView({ behavior: 'instant', block: 'nearest' });
    $('audit-titre').focus({ preventScroll: true });
  });

  NET.on('left', (m) => {
    const r = roster.get(m.id);
    if (r) r.left = true;
    isHost = m.host === myId;
    majScores(m.players);
    remplirAccuse();
    if (phase === 'results' && audit) $('suivante').hidden = !isHost;
    majTout();
  });

  // L'état complet, à la demande : il REMPLACE ce que la page croyait savoir.
  NET.on('snapshot', (m) => {
    isHost = m.host === myId;
    attrs = m.attrs;
    roster = new Map(m.identities.map((p) => [p.id, { name: p.name, avatar: p.avatar, left: false }]));
    scores = new Map();
    majScores(m.players);
    construireDeclaration();
    if (m.phase === 'end') return m.ranking && afficherFin({ complete: m.complete, host: m.host, ranking: m.ranking });
    const autre = !kase || kase.caseId !== m.caseId;
    kase = { caseId: m.caseId, cases: m.cases, lineup: m.lineup, liars: m.liars, indic: m.indic };
    phase = m.phase;
    role = m.role ? { role: m.role.role, fragment: m.role.fragment, culprit: m.role.culprit } : null;
    rounds = m.rounds; declares = m.declared; verrous = m.locked;
    if (autre) { rayes = new Set(); choisi = null; maDecl = [undefined, undefined]; monVerrou = null; }
    audit = null;
    construireMur();
    remplirAccuse();
    if (m.audit) afficherAudit({ caseId: m.caseId, cases: m.cases, audit: m.audit, last: m.caseId >= m.cases });
    show('play');
    armerChrono(m.remainingMs);
    majTout();
  });

  // Fin de partie : le classement du serveur, tel quel.
  function afficherFin(m) {
    const ol = $('classement');
    ol.replaceChildren();
    for (const r of m.ranking) {
      const li = el('li', 'ligne-joueur' + (r.rank <= 3 && r.score > 0 ? ' is-podium' : '') + (r.id === myId ? ' is-moi' : '') + (r.left ? ' is-parti' : ''));
      li.dataset.id = r.id;
      const nom = el('span', 'nom', r.name + (r.id === myId ? ' (toi)' : ''));
      nom.append(el('span', 'detail', `${r.found} coupable${r.found > 1 ? 's' : ''} trouvé${r.found > 1 ? 's' : ''}${r.left ? ' · parti' : ''}`));
      const rang = el('span', 'rang', place(r.rank));
      rang.setAttribute('aria-label', r.rank === 1 ? '1er' : `${r.rank}e`);
      li.append(rang, GameAvatar.node(r.avatar, DEFAUT, 'sm'), nom, el('span', 'score', `${r.score} pts`));
      li.setAttribute('aria-label', `${r.rank === 1 ? '1er' : r.rank + 'e'} : ${r.name}, ${r.score} points, ${r.found} coupables trouvés`);
      ol.append(li);
    }
    const premiers = m.ranking.filter((r) => r.rank === 1);
    $('end-meta').textContent = m.complete ? 'Fin de partie' : 'Partie interrompue';
    $('end-title').textContent = !m.complete ? 'Pas assez de joueurs pour continuer.'
      : premiers.length > 1 ? `Égalité : ${premiers.map((r) => r.name).join(' et ')} !`
        : `${premiers[0].name} gagne !`;
    majFin();
    show('end');
    $('end-title').focus();
  }
  function majFin() {
    $('revanche').hidden = !isHost;
    $('vers-salon').hidden = !isHost;
    $('attente-hote').hidden = isHost;
  }

  NET.on('results', (m) => {
    phase = 'end';
    isHost = m.host === myId;
    finLocale = 0;
    afficherFin(m);
    if (lien) {
      // Score de soirée : le classement du SERVEUR, transmis au Hub (l'hôte du
      // lancement seulement, une fois — hub-handoff.js filtre), AVANT ended().
      // Une partie interrompue n'est pas classée : ended() seul.
      if (m.complete && lien.results) lien.results(rangs(m.ranking));
      lien.ended();
      if (HubHandoff.endActions) HubHandoff.endActions($('to-hub'), $('revanche'));
      else $('to-hub').hidden = false;
    }
  });

  // Le classement tel que le SERVEUR l'a calculé (rang ex æquo compris, score
  // de la partie) : rien n'est recalculé ici.
  function rangs(ranking) {
    return ranking.map((r) => ({ gamePlayerId: r.id, rank: r.rank, points: r.score }));
  }

  // Un refus, à moi seul : on remet l'action à disposition et on dit pourquoi.
  NET.on('refused', (m) => {
    if (!kase || (m.caseId != null && m.caseId !== kase.caseId)) return;
    if (m.action === 'declare') {
      const t = tourEnCours();
      if (t != null && m.reason !== 'ALREADY_DECLARED') maDecl[t] = undefined;
      $('decl-etat').textContent = `Refusé : ${m.message}.`;
      majDeclaration();
      $('decl-etat').textContent = `Refusé : ${m.message}.`;
    } else if (m.action === 'lock') {
      if (m.reason !== 'ALREADY_LOCKED') monVerrou = null;
      majMur();
      majFiche();
      $('lock-etat').textContent = `Verrou refusé : ${m.message}.`;
    }
  });

  NET.on('error', (m) => {
    showError(m.message);
    perte.refus(m.message);
    if (lien && viaHub && !myId) { viaHub = false; lien.failed('JOIN', m.message); }
  });

  // Le profil : préremplir le pseudo.
  if (!$('name-input').value.trim()) $('name-input').value = GameProfile.load().name || '';
})();
