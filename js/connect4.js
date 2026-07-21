// Puissance 4 - canvas natif, caché derrière « INSERT COIN » (ou le Konami code).
// Toi : violet. Le bot : ambre. Heuristique volontairement simple : gagner > bloquer > centre.
(function () {
  const COLS = 7, ROWS = 6, CELL = 60;
  let board, over, busy, canvas, ctx, statusEl;

  const t = (fr, en) => (window.LANG === 'en' ? en : fr);
  const COLORS = { 0: '#1b1b2b', 1: '#8b5cf6', 2: '#f59e0b' };

  window.launchConnect4 = function () {
    const wrap = document.getElementById('c4-wrap');
    if (!wrap) return;
    wrap.classList.remove('hidden');
    if (!canvas) init();
    reset();
    wrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  function init() {
    canvas = document.getElementById('c4');
    ctx = canvas.getContext('2d');
    statusEl = document.getElementById('c4-status');
    canvas.addEventListener('click', onClick);
    document.getElementById('c4-reset').addEventListener('click', reset);
  }

  function reset() {
    board = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
    over = false;
    busy = false;
    setStatus(t('à toi de jouer (violet)', 'your move (violet)'));
    draw();
  }

  function onClick(e) {
    if (over || busy) return;
    const rect = canvas.getBoundingClientRect();
    const col = Math.floor(((e.clientX - rect.left) / rect.width) * COLS);
    if (!play(col, 1)) return;
    if (over) return;
    busy = true;
    setStatus(t('le bot réfléchit…', 'bot is thinking…'));
    setTimeout(() => { play(botMove(), 2); busy = false; }, 350);
  }

  // Pose un jeton dans la colonne. Retourne false si la colonne est pleine.
  function play(col, p) {
    if (col < 0 || col >= COLS) return false;
    let row = -1;
    for (let r = ROWS - 1; r >= 0; r--) if (board[r][col] === 0) { row = r; break; }
    if (row === -1) return false;
    board[row][col] = p;
    draw();
    if (wins(row, col, p)) {
      over = true;
      setStatus(p === 1 ? t('gagné. GG ✔', 'you win. GG ✔') : t('perdu. ROLLBACK et rejoue ?', 'you lose. ROLLBACK and retry?'));
    } else if (board[0].every((v) => v !== 0)) {
      over = true;
      setStatus(t('égalité. 0 rows returned.', 'draw. 0 rows returned.'));
    } else if (p === 2) {
      setStatus(t('à toi de jouer (violet)', 'your move (violet)'));
    }
    return true;
  }

  function wins(r, c, p) {
    const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
    return dirs.some(([dr, dc]) => {
      let n = 1;
      for (const s of [1, -1]) {
        let rr = r + dr * s, cc = c + dc * s;
        while (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS && board[rr][cc] === p) {
          n++; rr += dr * s; cc += dc * s;
        }
      }
      return n >= 4;
    });
  }

  function botMove() {
    const playable = [];
    for (let c = 0; c < COLS; c++) {
      const r = lowestFree(c);
      if (r !== -1) playable.push([r, c]);
    }
    // 1. je gagne si je peux, 2. je te bloque sinon
    for (const p of [2, 1]) {
      for (const [r, c] of playable) {
        board[r][c] = p;
        const w = wins(r, c, p);
        board[r][c] = 0;
        if (w) return c;
      }
    }
    // 3. sinon, tirage pondéré vers le centre
    const weight = (c) => 4 - Math.abs(3 - c);
    const pool = playable.flatMap(([, c]) => Array(weight(c)).fill(c));
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function lowestFree(col) {
    for (let r = ROWS - 1; r >= 0; r--) if (board[r][col] === 0) return r;
    return -1;
  }

  function draw() {
    ctx.fillStyle = '#11111c';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        ctx.beginPath();
        ctx.arc(c * CELL + CELL / 2, r * CELL + CELL / 2, 23, 0, Math.PI * 2);
        ctx.fillStyle = COLORS[board[r][c]];
        ctx.fill();
      }
    }
  }

  function setStatus(msg) { if (statusEl) statusEl.textContent = '> ' + msg; }

  const coin = document.getElementById('insert-coin');
  if (coin) coin.addEventListener('click', window.launchConnect4);
})();
