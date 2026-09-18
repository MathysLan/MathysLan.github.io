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

  // Les cinq passes : uniquement leurs LIBELLÉS. Aucune note, aucune
  // explication — c'est le serveur qui les renvoie après coup.
  const PASSES = [
    { id: 'courte', label: 'Passe courte', hint: 'au central, rapide' },
    { id: 'gauche', label: 'Aile gauche', hint: 'haute, en 4' },
    { id: 'droite', label: 'Aile droite', hint: 'haute, en 2' },
    { id: 'arriere', label: 'Attaque arrière', hint: 'derrière la ligne' },
    { id: 'deuxieme', label: 'Deuxième main', hint: 'tu joues toi-même' },
  ];

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let myId = null, isHost = false, answered = false, msLimit = 5000;
  let raf = 0, tick = 0, deadline = 0;

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

  // ------------------------------------------------------- les cinq passes
  const buttons = PASSES.map((p, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tf-btn tf-btn-sm pass';
    b.innerHTML = `<span class="num" aria-hidden="true">${i + 1}</span>
      <span>${p.label}<span class="hint">${p.hint}</span></span>`;
    b.setAttribute('aria-label', `${i + 1}. ${p.label} — ${p.hint}`);
    b.addEventListener('click', () => answer(p.id));
    return b;
  });
  buttons.forEach((b) => $('passes').appendChild(b));

  document.addEventListener('keydown', (e) => {
    if ($('game').hidden || answered) return;
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= buttons.length) { e.preventDefault(); answer(PASSES[n - 1].id); }
  });

  function answer(passId) {
    if (answered) return;
    answered = true;
    stopTimer();
    NET.send({ action: 'answer', passId });     // une intention, rien de plus
    $('passes').hidden = true;
    $('waiting').hidden = false;
  }

  // ------------------------------------------------------------- le chrono
  function startTimer(limit) {
    stopTimer();
    deadline = performance.now() + limit;
    const fill = $('timer-fill'), num = $('timer-num');
    const step = () => {
      const left = Math.max(0, deadline - performance.now());
      const ratio = left / limit;
      fill.style.width = (ratio * 100).toFixed(1) + '%';
      fill.className = 'timer-fill' + (ratio < .25 ? ' hot' : ratio < .55 ? ' warn' : '');
      num.textContent = (left / 1000).toFixed(1).replace('.', ',');
      // À zéro on s'arrête d'afficher, mais on ne décide rien : c'est le
      // serveur qui tranche (il a son propre filet anti-blocage).
      if (left <= 0) { stopTimer(); return; }
      if (!reduced) raf = requestAnimationFrame(step);
    };
    if (reduced) { tick = setInterval(step, 250); step(); }
    else raf = requestAnimationFrame(step);
  }
  function stopTimer() { cancelAnimationFrame(raf); clearInterval(tick); raf = 0; tick = 0; }
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

  NET.on('round', (msg) => {
    answered = false;
    msLimit = msg.msLimit || 5000;
    $('round-num').textContent = msg.index + 1;
    $('round-of').textContent = msg.of;
    $('ctx').textContent = msg.ctx;
    $('detail').textContent = msg.detail;
    $('passes').hidden = false;
    $('waiting').hidden = true;
    show('game');
    startTimer(msLimit);
    buttons[0].focus();
  });

  NET.on('answered', (msg) => {
    const me = msg.players.find((p) => p.id === myId);
    if (me) $('score').textContent = me.score;
  });

  NET.on('results', (msg) => {
    stopTimer();
    show('results');
    $('res-round').textContent = `manche ${msg.index + 1}/${msg.of}`;
    $('best-head').textContent = 'Meilleur choix : ' + msg.bestLabel;
    $('best-why').textContent = msg.bestWhy;
    $('res-rows').innerHTML = msg.results.map((r) => {
      const pass = PASSES.find((p) => p.id === r.passId);
      const cls = r.wasBest ? 'best-row' : (r.timedOut || r.relevance < 55 ? 'miss' : '');
      return `<div class="res-row ${cls}">
        <span>${r.avatar} ${esc(r.name)}</span>
        <span>${r.timedOut ? 'pas de passe' : esc(pass ? pass.label : r.passId)}</span>
        <span class="pts">+${r.points}</span>
        ${r.why ? `<p class="why">${esc(r.why)}</p>` : ''}
      </div>`;
    }).join('');
    const me = msg.results.find((r) => r.id === myId);
    if (me) $('score').textContent = me.score;
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

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
})();
