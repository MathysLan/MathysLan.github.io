// Gabarits HTML partagés entre le navigateur et le pré-rendu.
//
// Ces fonctions sont appelées :
//   - dans le navigateur, par main.js et carousel.js (changement de langue) ;
//   - par tools/build.mjs, qui écrit leur résultat DANS index.html, pour que le
//     contenu important (projets, jeux) soit présent sans exécuter de JS.
// Une seule source pour le balisage : ce qui est pré-rendu est exactement ce
// que le navigateur produirait. Règle : pas de DOM, pas de window — la langue
// est toujours passée en paramètre.

// Champ dans la langue demandée, avec repli sur le français.
function trLang(obj, field, lang) {
  const en = obj[field + '_en'];
  return lang === 'en' && en !== undefined && en !== '' ? en : obj[field];
}

// Le nom de qualité tel que les joueurs le lisent : il reste en anglais dans
// les deux langues (« un Strange », pas « un Étrange »).
function qualityLabel(q) {
  if (q === 'collectors') return "Collector's";
  return q;
}

// Échappement pour les attributs et le texte généré à partir des données.
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Libellés des fiches. Ici plutôt que dans i18n.js : le pré-rendu
// (tools/build.mjs) charge ce fichier sans i18n.js.
const SHEET_LABELS = {
  fr: { goal: 'Objectif', role: 'Ma part', result: 'Résultat', team: 'Équipe', details: 'En détail',
        arch: 'Architecture', code: 'Code', play: 'Jouer' },
  en: { goal: 'Goal', role: 'My part', result: 'Outcome', team: 'Team', details: 'Details',
        arch: 'Architecture', code: 'Code', play: 'Play' },
};
const sheetLabels = (lang) => SHEET_LABELS[lang] || SHEET_LABELS.fr;

function teamLabel(team, lang) {
  if (team === 'solo') return 'Solo';
  return lang === 'en' ? `Team of ${team}` : `Projet à ${team}`;
}

// Le résumé qu'un recruteur lit en premier : objectif, ma part, résultat,
// équipe. Chaque ligne n'apparaît que si le champ est rempli dans data/.
function projectFactsHTML(p, lang) {
  const L = sheetLabels(lang);
  const rows = ['goal', 'role', 'result']
    .map((k) => [k, trLang(p, k, lang)])
    .filter(([, v]) => v)
    .map(([k, v]) => `<div class="facts-row${k === 'role' ? ' is-role' : ''}"><dt>${L[k]}</dt><dd>${esc(v)}</dd></div>`);
  if (p.team) rows.push(`<div class="facts-row"><dt>${L.team}</dt><dd>${teamLabel(p.team, lang)}</dd></div>`);
  return rows.length ? `<dl class="facts">${rows.join('')}</dl>` : '';
}

// ------------------------------------------------------------------ Projets
// Une case du sac à dos. Un vrai <button> : focus clavier, Entrée et Espace
// viennent du navigateur ; aria-haspopup="dialog" annonce qu'il ouvre une
// fenêtre. Pas de visuel ? L'initiale en filigrane, jamais une case vide.
function projectCellHTML(p, i, lang) {
  const q = p.quality || 'normal';
  const title = trLang(p, 'title', lang);
  const thumb = p.cover
    ? `<img src="${p.cover}" alt="" loading="lazy"
              class="bp-img ${p.coverFit === 'contain' ? 'is-contain' : ''}">`
    : `<span class="bp-noimg font-display" aria-hidden="true">${title.charAt(0)}</span>`;
  return `
    <button type="button" class="reveal is-visible item bp-cell" data-q="${q}" data-index="${i}"
            aria-haspopup="dialog">
      <span class="bp-thumb panel-inset">
        ${thumb}
        <span class="q-badge bp-q" data-q="${q}">★ ${qualityLabel(q)}</span>
        ${p.confidential ? '<span class="bp-lock" aria-hidden="true">🔒</span>' : ''}
      </span>
      <span class="item-label bp-name">${title}</span>
    </button>`;
}

// La fiche complète d'un projet, en HTML lisible. Affichée seulement SANS
// JavaScript (où les cases ne peuvent pas ouvrir la modale) ; avec JS elle est
// masquée et la modale prend le relais. Elle garantit que le descriptif est
// dans le HTML publié.
function projectSheetHTML(p, lang) {
  const en = lang === 'en';
  const stack = (p.stack || []).map((s) => `<li>${s}</li>`).join('');
  const gh = p.github
    ? `<p><a href="${p.github}" target="_blank" rel="noopener noreferrer">GitHub</a></p>` : '';
  return `
    <article class="nojs-sheet">
      <h3>${trLang(p, 'title', lang)}</h3>
      <p class="nojs-sheet-meta">${esc(trLang(p, 'badge', lang))}${p.confidential ? (en ? ' · confidential' : ' · confidentiel') : ''}</p>
      ${projectFactsHTML(p, lang)}
      <p>${esc(trLang(p, 'desc', lang))}</p>
      ${stack ? `<ul class="attr-list">${stack}</ul>` : ''}
      ${gh}
    </article>`;
}

// ------------------------------------------------------ Jeux vidéo préférés
// L'image (object-cover) recouvre l'emoji quand elle charge ; si elle échoue,
// onerror la retire et l'emoji reste sur le fond dégradé. Jamais de carte vide.
function favGameHTML(g, lang) {
  const src = g.img || (g.steam ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.steam}/header.jpg` : '');
  const style = g.bg ? ` style="background:${g.bg}"` : '';
  const name = trLang(g, 'name', lang);
  const img = src
    ? `<img src="${src}" alt="${name}" loading="lazy" class="fav-img" onerror="this.remove()">`
    : '';
  return `
    <div class="item fav-game" data-q="${g.quality || 'normal'}">
      <div class="fav-cover panel-inset"${style}>
        <span class="fav-emoji">${g.emoji}</span>
        ${img}
      </div>
      <p class="fav-note">${trLang(g, 'note', lang)}</p>
      <p class="item-label fav-name">${name}</p>
    </div>`;
}

// --------------------------------------------------------- Carousel des jeux
// L'accent d'un jeu (champ `accent` dans data/games.js) devient une qualité
// d'objet TF2 : c'est elle qui colore la bordure de la carte et sa tagline.
const GAME_QUALITY = { violet: 'unusual', amber: 'unique', mint: 'haunted' };

function gameSlideHTML(game, idx, lang) {
  const en = lang === 'en';
  const qual = GAME_QUALITY[game.accent] || 'normal';
  const tags = (trLang(game, 'tags', lang) || []).map((t) =>
    `<span class="tf-tag font-mono">${t}</span>`).join('');
  const stack = (game.stack || []).map((s) => `<li>${s}</li>`).join('');

  let cta;
  if (game.status === 'soon') {
    cta = `<span class="tf-btn tf-btn-ghost tf-btn-sm game-cta-soon font-mono">
               <span class="live-dot inline-block w-2 h-2 dot-live"></span>
               ${en ? 'coming soon' : 'bientôt'}
             </span>`;
  } else if (game.href) {
    cta = `<a href="${game.href}" class="tf-btn tf-btn-buy game-cta">
               ${en ? 'Play' : 'Jouer'}
               <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
             </a>`;
  } else {
    // Action JS (Puissance 4) : sans JS le bouton ne ferait rien, on le masque.
    cta = `<button type="button" data-action="${game.action}" class="tf-btn tf-btn-buy game-cta js-only">
               ${en ? 'Play' : 'Jouer'} ▸
             </button>`;
  }

  // Code (dépôt public) et Architecture (fiche technique en modale) : la partie
  // technique des jeux, à côté de « Jouer ». Les points d'architecture sont
  // aussi écrits dans la carte, visibles seulement sans JS (et lisibles par
  // les moteurs) ; avec JS, le bouton ouvre la fiche.
  const L = sheetLabels(lang);
  const title = trLang(game, 'title', lang);
  const code = game.code
    ? `<a href="${game.code}" class="tf-btn tf-btn-sm game-code" target="_blank" rel="noopener noreferrer"
               aria-label="${L.code} — ${title}">${L.code}</a>`
    : '';
  const archItems = trLang(game, 'arch', lang) || [];
  const arch = archItems.length
    ? `<button type="button" class="tf-btn tf-btn-sm game-arch js-only" data-arch="${idx}" aria-haspopup="dialog"
               aria-label="${L.arch} — ${title}">${L.arch}</button>`
    : '';
  const archList = archItems.length
    ? `<ul class="attr-list game-arch-list nojs-only">${archItems.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>`
    : '';

  return `
    <div class="game-slide" role="group" aria-roledescription="${en ? 'slide' : 'diapositive'}" aria-label="${trLang(game, 'title', lang)}">
      <div class="item game-card" data-q="${qual}">
        <div class="game-card-body">
          <div class="flex items-start justify-between gap-4 mb-4">
            <div class="flex items-center gap-3">
              <span class="slot-num" aria-hidden="true">${idx + 1}</span>
              <div class="game-emoji">${game.emoji}</div>
            </div>
            <span class="font-mono text-xs game-tagline">${trLang(game, 'tagline', lang)}</span>
          </div>
          <h3 class="game-title">${trLang(game, 'title', lang)}</h3>
          <p class="muted text-sm leading-relaxed game-desc">${trLang(game, 'desc', lang)}</p>
          <div class="flex flex-wrap gap-2 mt-4">${tags}</div>
          ${stack ? `<ul class="attr-list mt-3">${stack}</ul>` : ''}
          ${archList}
          <div class="mt-6 game-actions">${cta}${code}${arch}</div>
        </div>
      </div>
    </div>`;
}
