// Le Passeur — l'affichage. AUCUNE règle ici : le serveur envoie une manche,
// on l'affiche ; le joueur choisit, on transmet l'intention ; le serveur renvoie
// les résultats, on les affiche. Les barèmes et les explications ne sont dans
// ce dépôt à AUCUN moment — ils vivent dans passeur-server.
//
// Le chrono affiché est purement visuel : il aide à décider vite. Ce n'est pas
// lui qui compte les points — le serveur mesure l'écart entre l'envoi de la
// manche et la réception de la réponse, à son horloge.
(function () {
  const $ = (id) => document.getElementById(id);
  const AVATARS = ['🏐', '🦊', '🐼', '😎', '🤖', '👻', '🔥', '⚡', '🎯', '🎧', '🍕', '🚀'];

  // Les cinq choix n'existent plus sous forme de liste : ce sont les zones du
  // terrain, définies une seule fois dans court.js. On ne garde ici que de quoi
  // retrouver un LIBELLÉ à partir d'un identifiant, pour les lignes de
  // résultats. Aucune note, aucune explication — le serveur les renvoie après
  // coup.
  const labelOf = (id) =>
    (Court.ZONES.find((z) => z.id === id) || {}).label || id;

  // Lu au moment où on s'en sert, pas au chargement : c'est la règle du
  // portfolio, et la préférence peut changer en cours de partie.
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let myId = null, isHost = false, answered = false, msLimit = 5000;
  let raf = 0, tick = 0, deadline = 0;
  let court = null;              // le terrain de la manche en cours
  let lastScene = null;          // sa scène, rejouée telle quelle aux résultats
  let armTimer = 0;              // filet si le « go » du serveur n'arrive pas

  const show = (id) => ['home', 'lobby', 'game', 'results', 'end']
    .forEach((s) => { $(s).hidden = s !== id; });
  const showError = (m) => { $('error').textContent = m ? '> ' + m : ''; };

  // ------------------------------------------------------------- accueil
  let myAvatar = AVATARS[Math.floor(Math.random() * AVATARS.length)];
  for (const em of AVATARS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'avatar-pick' + (em === myAvatar ? ' picked' : '');
    b.textContent = em;
    b.setAttribute('aria-pressed', String(em === myAvatar));
    b.addEventListener('click', () => {
      myAvatar = em;
      document.querySelectorAll('.avatar-pick').forEach((x) => {
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
      NET.send({ action: 'join', name: $('name-input').value, avatar: myAvatar, code: code || undefined });
    } catch (err) { showError(err.message); }
  }
  $('host').addEventListener('click', () => enter());
  $('join').addEventListener('click', () => enter($('code-input').value));
  $('code-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') enter($('code-input').value); });

  $('room-code').addEventListener('click', async () => {
    const hint = $('code-hint');
    const back = () => setTimeout(() => { hint.textContent = 'clique sur le code pour le copier'; }, 2000);
    try {
      await navigator.clipboard.writeText($('room-code').textContent.trim());
      hint.textContent = 'code copié ✔';
    } catch (_) {
      hint.textContent = 'copie impossible — recopie le code à la main';
    }
    back();
  });

  $('start').addEventListener('click', () => NET.send({ action: 'start', rounds: +$('rounds-select').value }));
  $('again').addEventListener('click', () => NET.send({ action: 'start', rounds: +$('rounds-select').value }));
  $('next').addEventListener('click', () => NET.send({ action: 'next' }));

  // ------------------------------------------------------------- le terrain
  // Les raccourcis 1 à 5 restent, et ce sont toujours les mêmes touches : elles
  // sont maintenant écrites DANS chaque zone, donc on n'a plus à les deviner.
  // On ne les intercepte pas quand le joueur est en train de taper son pseudo.
  document.addEventListener('keydown', (e) => {
    if ($('game').hidden || answered) return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test((e.target.tagName || ''))) return;
    if (!/^[1-5]$/.test(e.key) || !court) return;
    e.preventDefault();
    court.pickByKey(e.key);
  });

  function answer(passId) {
    if (answered) return;
    answered = true;
    stopTimer();
    NET.send({ action: 'answer', passId });     // une intention, rien de plus
    if (court) court.lock();
    $('waiting').hidden = false;
  }

  // ------------------------------------------------------------- le chrono
  // Le chrono est une VISUALISATION du temps serveur, pas une logique de jeu :
  // la butée est posée à l'ouverture de la fenêtre (le « go » du serveur) et
  // rAF ne sert qu'à peindre. Si l'affichage tombe à zéro, on n'en conclut
  // rien — c'est le serveur qui résout la manche, avec son propre filet.
  function startTimer(limit) {
    stopTimer();
    deadline = performance.now() + limit;
    const fill = $('timer-fill'), num = $('timer-num');
    document.querySelector('.timer-wrap').classList.remove('is-idle');
    // Le compte à rebours reste DYNAMIQUE même en mouvement réduit : ce n'est
    // pas une animation d'agrément, c'est l'information dont on a besoin pour
    // décider. On la rafraîchit par paliers plutôt qu'à chaque frame.
    const low = reduced();
    const step = () => {
      const left = Math.max(0, deadline - performance.now());
      const ratio = left / limit;
      fill.style.width = (ratio * 100).toFixed(1) + '%';
      const heat = ratio < .25 ? ' hot' : ratio < .55 ? ' warn' : '';
      fill.className = 'timer-fill' + heat;
      // Le gros chiffre chauffe aussi : à deux secondes de la fin, on doit le
      // voir sans avoir à le lire.
      num.className = 'timer-num' + heat;
      num.textContent = (left / 1000).toFixed(1).replace('.', ',');
      // À zéro on s'arrête d'afficher, mais on ne décide rien : c'est le
      // serveur qui tranche (il a son propre filet anti-blocage).
      if (left <= 0) { stopTimer(); return; }
      if (!low) raf = requestAnimationFrame(step);
    };
    if (low) { tick = setInterval(step, 200); step(); }
    else raf = requestAnimationFrame(step);
  }
  function stopTimer() { cancelAnimationFrame(raf); clearInterval(tick); raf = 0; tick = 0; }

  // Le chrono à l'arrêt, pendant la mise en situation : barre pleine et limite
  // affichée. On ne regarde pas un compte à rebours descendre alors qu'on n'a
  // pas encore le droit de jouer — c'était tout le problème d'avant.
  function idleTimer(limit) {
    const fill = $('timer-fill'), num = $('timer-num');
    fill.style.width = '100%';
    fill.className = 'timer-fill is-idle';
    num.className = 'timer-num';
    num.textContent = (limit / 1000).toFixed(1).replace('.', ',');
    document.querySelector('.timer-wrap').classList.add('is-idle');
  }

  window.addEventListener('pagehide', stopTimer);

  // ------------------------------------------------------ messages serveur
  NET.on('you', (msg) => {
    myId = msg.id; isHost = msg.host;
    $('room-code').textContent = msg.code;
    show('lobby');
  });

  NET.on('lobby', (msg) => {
    show('lobby');
    $('players').innerHTML = msg.players.map((p) =>
      `<li><span>${p.avatar}</span><span>${esc(p.name)}</span>${p.host ? '<span class="tag">MJ</span>' : ''}</li>`).join('');
    $('host-config').hidden = !isHost;
    $('need-players').hidden = isHost;
    if (msg.rounds) $('rounds-select').value = String(msg.rounds);
  });

  // PHASE 1 — la mise en situation. On regarde, on comprend. Aucun chrono ne
  // tourne, les zones ne se jouent pas encore : c'est le serveur qui ouvrira la
  // fenêtre de décision, avec le message `go`.
  NET.on('round', (msg) => {
    answered = false;
    msLimit = msg.msLimit || 5000;
    $('round-num').textContent = msg.index + 1;
    $('round-of').textContent = msg.of;
    $('ctx').textContent = msg.ctx;
    $('detail').textContent = msg.detail;
    $('waiting').hidden = true;
    lastScene = msg.scene || null;
    // Le terrain est redessiné à chaque manche à partir de la scène. Si le
    // serveur n'en envoie pas (version précédente encore en ligne), court.js
    // dessine un terrain neutre : les cinq zones restent jouables et le texte
    // de la situation, lui, est toujours au-dessus.
    court = Court.render($('court'), lastScene, {
      interactive: true,
      introMs: msg.introMs,
      describeInto: $('court-desc'),
      onPick: answer,
    });
    // Le chrono existe mais ne tourne pas : la barre est pleine et le nombre
    // affiche la limite. On ne lit pas « 5,0 » qui descend pendant qu'on essaie
    // de comprendre la situation.
    stopTimer();
    idleTimer(msLimit);
    $('phase').textContent = 'Mise en place…';
    $('phase').className = 'phase is-intro';
    $('go-banner').hidden = true;
    show('game');

    // ⚠️ FILET : le jeu ne doit JAMAIS devenir injouable parce que le « go »
    // n'arrive pas. C'est exactement ce qui se passait contre un serveur d'une
    // version précédente : pas de `go` → zones jamais armées → aucun clic
    // possible, et chrono figé sur 5,0 jusqu'à la fin de la manche.
    //
    // Deux cas, distingués par la présence de `introMs` :
    //   - `introMs` absent : serveur ancien. Sa fenêtre de décision est déjà
    //     ouverte depuis l'envoi de la manche, donc on arme TOUT DE SUITE.
    //   - `introMs` présent : on laisse la mise en situation se jouer, et si le
    //     `go` n'est pas là un peu après, on arme quand même.
    // Le serveur reste l'arbitre : c'est lui qui mesure le temps de réponse à
    // son horloge et qui refuse ce qui arrive trop tôt. Armer ici ne fait que
    // rendre la main au joueur.
    clearTimeout(armTimer);
    const wait = msg.introMs == null ? 0 : msg.introMs + 700;
    armTimer = setTimeout(() => {
      if (court && !court.isArmed()) openWindow(msLimit, 'filet');
    }, wait);
    // Le focus va sur la première zone dès la mise en place : au clavier, on
    // est déjà sur le terrain quand le « à toi » tombe, sans avoir à tabuler.
    if (court.zones[0]) court.zones[0].focus();
  });

  // PHASE 2 — « À TOI ». La fenêtre de décision s'ouvre : les zones s'activent
  // et le chrono part. Normalement c'est le serveur qui le dit (même fenêtre
  // pour tout le monde) ; le filet de `round` peut aussi l'ouvrir si ce message
  // n'arrive pas.
  function openWindow(limit, how) {
    clearTimeout(armTimer);
    if (!court || court.isArmed()) return;
    court.arm();
    $('phase').textContent = 'À toi de distribuer';
    $('phase').className = 'phase is-go';
    $('go-banner').hidden = false;
    startTimer(limit);
    if (how === 'filet') showError('');
  }

  NET.on('go', (msg) => {
    msLimit = msg.msLimit || msLimit;
    openWindow(msLimit, 'serveur');
  });

  NET.on('answered', (msg) => {
    const me = msg.players.find((p) => p.id === myId);
    if (me) $('score').textContent = me.score;
  });

  NET.on('results', (msg) => {
    stopTimer();
    clearTimeout(armTimer);
    $('go-banner').hidden = true;
    show('results');
    $('res-round').textContent = `manche ${msg.index + 1}/${msg.of}`;
    $('best-head').textContent = 'Meilleur choix : ' + msg.bestLabel;
    $('best-why').textContent = msg.bestWhy;
    $('res-rows').innerHTML = msg.results.map((r) => {
      const cls = r.wasBest ? 'best-row' : (r.timedOut || r.relevance < 55 ? 'miss' : '');
      return `<div class="res-row ${cls}">
        <span>${r.avatar} ${esc(r.name)}</span>
        <span>${r.timedOut ? 'pas de passe' : esc(labelOf(r.passId))}</span>
        <span class="pts">+${r.points}</span>
        ${r.why ? `<p class="why">${esc(r.why)}</p>` : ''}
      </div>`;
    }).join('');

    const me = msg.results.find((r) => r.id === myId);
    if (me) $('score').textContent = me.score;
    // Le même terrain, figé : ma zone et la zone recommandée. La scène est
    // celle de la manche qu'on vient de jouer, pas une autre.
    Court.renderResult($('res-court'), lastScene, me ? me.passId : null, msg.best);
    $('res-court-desc').textContent = me && !me.timedOut
      ? `Ton choix : ${labelOf(me.passId)}. Meilleur choix : ${msg.bestLabel}.`
      : `Tu n'as pas distribué. Meilleur choix : ${msg.bestLabel}.`;
    $('res-mine').innerHTML = me ? mineHTML(me) : '';
    $('next').hidden = !isHost;
    $('wait-host').hidden = isHost;
    if (isHost) { $('next').textContent = msg.last ? 'Voir le classement' : 'Manche suivante'; $('next').focus(); }
  });

  NET.on('end', (msg) => {
    stopTimer();
    show('end');
    const me = msg.ranking.find((r) => r.id === myId);
    $('final-title').textContent = me ? `${me.avg} / 100 — ${me.title}` : 'Fin de partie';
    $('ranking').innerHTML = msg.ranking.map((r, i) =>
      `<div class="rank-row"><span>${i + 1}. ${r.avatar} ${esc(r.name)}</span><span class="avg">${r.avg}/100</span></div>`).join('');
    $('again').hidden = !isHost;
  });

  NET.on('error', (msg) => showError(msg.message));
  NET.on('closed', () => { stopTimer(); showError('connexion au serveur perdue'); });

  // D'où viennent mes points. Les trois chiffres sont ceux du serveur : la
  // pertinence de la passe jouée, la vitesse mesurée à SON horloge, et le
  // produit des deux. On ne recalcule rien ici — on explique.
  function mineHTML(r) {
    if (r.timedOut) {
      return `<p class="mine-pts">+0</p>
        <p class="mine-verdict">Pas de passe</p>
        <p class="mine-calc">Les 5 secondes sont passées. Une balle non distribuée, c'est un point pour eux.</p>`;
    }
    const verdict = r.wasBest ? 'Le bon choix'
      : r.relevance >= 75 ? 'Bonne lecture'
        : r.relevance >= 55 ? 'Jouable' : 'Mauvaise lecture';
    const secs = (r.ms / 1000).toFixed(1).replace('.', ',');
    return `<p class="mine-pts">+${r.points}</p>
      <p class="mine-verdict">${esc(verdict)}</p>
      <p class="mine-calc">pertinence <b>${r.relevance}/100</b> · vitesse <b>${r.speed} %</b>
        <span class="mine-t">(${esc(secs)} s)</span></p>`;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
})();
