// Page de dépôt de vidéos (jeu de l'Imitation).
// Le navigateur ne connaît AUCUNE clé : il demande au serveur une URL signée
// pour un nom de fichier précis, puis envoie le fichier DIRECTEMENT à R2.
// ?server= pour tester contre un serveur local.

const API = (new URLSearchParams(location.search).get('server')
  || 'https://upload-server-9r3c.onrender.com').replace(/\/$/, '');

const $ = (id) => document.getElementById(id);
const err = (m) => { $('err').textContent = m ? '> ' + m : ''; };
const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

let password = '', who = '', maxMb = 80, busy = false;

async function api(path, opts) {
  const res = await fetch(API + path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `erreur ${res.status}`);
  return data;
}

// --- accès ------------------------------------------------------------------
$('enter').addEventListener('click', enter);
$('pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') enter(); });
async function enter() {
  const pw = $('pw').value.trim();
  who = $('who').value.trim() || 'quelqu\'un';
  if (!pw) return err('il faut le mot de passe');
  err(''); $('enter').disabled = true;
  try {
    await api('/session', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    });
    password = pw;
    try { const h = await api('/health'); maxMb = h.maxMb || 80; $('maxmb').textContent = maxMb; } catch (_) {}
    $('gate').hidden = true; $('zone').hidden = false;
  } catch (e) {
    err(e.message);
  } finally { $('enter').disabled = false; }
}

// --- sélection des fichiers -------------------------------------------------
$('drop').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', (e) => { queue([...e.target.files]); e.target.value = ''; });
['dragenter', 'dragover'].forEach((t) => $('drop').addEventListener(t, (e) => {
  e.preventDefault(); $('drop').classList.add('over');
}));
['dragleave', 'drop'].forEach((t) => $('drop').addEventListener(t, (e) => {
  e.preventDefault(); $('drop').classList.remove('over');
}));
$('drop').addEventListener('drop', (e) => queue([...(e.dataTransfer.files || [])]));

// On envoie les fichiers UN PAR UN : chaque numéro est attribué par le serveur
// au dernier moment, donc deux envois simultanés se marcheraient dessus.
const pending = [];
function queue(files) {
  for (const f of files) pending.push(f);
  if (!busy) drain();
}
async function drain() {
  busy = true;
  while (pending.length) {
    const f = pending.shift();
    // eslint-disable-next-line no-await-in-loop
    await upload(f);
  }
  busy = false;
}

// --- envoi ------------------------------------------------------------------
function addItem(name) {
  const el = document.createElement('div');
  el.className = 'item';
  el.innerHTML = `<div class="top"><span class="nm">${esc(name)}</span><span class="st">en attente…</span></div>`
    + '<div class="bar"><i></i></div>';
  $('items').appendChild(el);
  return {
    el,
    status: (t) => { el.querySelector('.st').textContent = t; },
    progress: (p) => { el.querySelector('.bar i').style.width = p + '%'; },
    done: (ok, t) => { el.classList.add(ok ? 'ok' : 'ko'); el.querySelector('.st').textContent = t; },
  };
}

async function upload(file) {
  const it = addItem(file.name);
  if (!/\.mp4$/i.test(file.name) && file.type !== 'video/mp4') {
    return it.done(false, 'refusé : .mp4 seulement');
  }
  if (file.size > maxMb * 1024 * 1024) {
    return it.done(false, `trop lourd (${(file.size / 1048576).toFixed(0)} Mo > ${maxMb})`);
  }
  try {
    it.status('préparation…');
    const slot = await api('/slot', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password, ext: 'mp4' }),
    });
    it.status(`envoi → ${slot.id}`);
    await put(slot.url, file, (p) => it.progress(p));
    const res = await api('/done', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password, id: slot.id, name: who }),
    });
    it.progress(100);
    it.done(true, `déposé → ${slot.id}.mp4`);
    showCatalogue(res);
  } catch (e) {
    it.done(false, e.message);
    err(e.message);
  }
}

// XHR plutôt que fetch : c'est le seul moyen d'avoir une vraie barre de progression.
function put(url, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true);
    xhr.setRequestHeader('Content-Type', 'video/mp4');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round(e.loaded / e.total * 100)); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300
      ? resolve()
      : reject(new Error(`envoi refusé par le bucket (${xhr.status})`)));
    // Piège classique : un PUT déclenche toujours un préliminaire OPTIONS, où le
    // navigateur annonce Content-Type. Sans "AllowedHeaders": ["content-type"]
    // dans la CORS du bucket, R2 refuse ce préliminaire.
    xhr.onerror = () => reject(new Error(
      'bloqué par la CORS du bucket — vérifie que la règle contient '
      + '"AllowedHeaders": ["content-type"] et "AllowedMethods": ["PUT"]'));
    xhr.send(file);
  });
}

function showCatalogue(res) {
  $('out').hidden = false;
  $('count').textContent = res.count;
  $('json').value = res.json;
}
$('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('json').value);
    $('copied').hidden = false; setTimeout(() => { $('copied').hidden = true; }, 1800);
  } catch (_) { $('json').select(); }
});
