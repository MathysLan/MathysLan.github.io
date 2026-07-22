// Mes jeux vidéo préférés. Ajouter un jeu = ajouter un objet ici.
// Image de la carte, par ordre de priorité :
//   1. img   → une URL/chemin d'image explicite (ex: 'assets/games/xxx.jpg')
//   2. steam → l'app ID Steam : la bannière officielle est tirée du CDN Steam
//   3. sinon → fond dégradé (bg) + emoji, en repli
// Un repli emoji s'affiche toujours si l'image ne charge pas (jamais de carte cassée).
const FAV_GAMES = [
  {
    name: 'Team Fortress 2', emoji: '🎯', steam: 440,
    note: '9 classes, zéro sérieux — le FPS qui vieillit pas.',
    note_en: '9 classes, zero seriousness — the FPS that never ages.',
  },
  {
    name: 'Clair Obscur : Expédition 33', emoji: '🎨',
    img: 'assets/games/expedition33.jpg',
    bg: 'linear-gradient(135deg, #6d4fd0, #241b3a)',
    note: 'Claque visuelle et narrative — RPG au tour par tour.',
    note_en: 'A visual and narrative punch — turn-based RPG.',
  },
  {
    name: 'DBZ Kakarot', emoji: '🐉', steam: 851850,
    note: "L'enfance en jeu, du Saiyan à gogo.",
    note_en: 'Childhood as a game, Saiyan galore.',
  },
  {
    name: 'Minecraft', emoji: '⛏️',
    img: 'assets/games/minecraft.jpg',
    bg: 'linear-gradient(135deg, #3a7d34, #1f4d2b)',
    note: 'Je montais les serveurs — mes meilleurs souvenirs à jouer avec toute la bande.',
    note_en: 'I ran the servers — my best memories playing with the whole crew.',
  },
  {
    name: 'Rust', emoji: '🪓', steam: 252490,
    note: 'Survie hardcore, trahisons garanties.',
    note_en: 'Hardcore survival, betrayals guaranteed.',
  },
  {
    name: "Garry's Mod", emoji: '🔧', steam: 4000,
    note: 'Le bac à sable sans aucune limite.',
    note_en: 'The no-limits sandbox.',
  },
  {
    name: 'Fortnite', emoji: '🪂',
    img: 'assets/games/fortnite.jpg',
    bg: 'linear-gradient(135deg, #3b82f6, #7c3aed)',
    note: "L'époque prime, la vraie.",
    note_en: 'The prime era, the real one.',
  },
  {
    name: 'Your Only Move Is HUSTLE', emoji: '🥊', steam: 2212330,
    note: 'Baston au tour par tour, chaque frame compte.',
    note_en: 'Turn-based fighting, every frame counts.',
  },
  {
    name: 'SCP: Secret Laboratory', emoji: '🧪', steam: 700330,
    note: 'Confinement, chaos et trahisons en équipe.',
    note_en: 'Containment, chaos and team betrayals.',
  },
];
