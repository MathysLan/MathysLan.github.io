// Croquis — la SYNCHRONISATION du dessin, sans DOM ni réseau.
//
// Deux sens, deux fonctions pures (le même fichier tourne dans la page et dans
// tests/croquis-sync.mjs) :
//   creerEnvoi()  — le dessinateur : ses traits locaux → messages `stroke`,
//                   `undo`, `clear`, au format EXACT de croquis-server
//                   (turnId, s, c, w, p, end), par lots de ~50 ms ;
//   recevoir()    — les autres : `stroke`, `undo`, `clear`, `snapshot`,
//                   `turn`, `drawing` → la feuille locale (dessin.js).
// Le serveur reste l'autorité sur les traits : il valide, il garde, il relaie ;
// un `snapshot` remplace TOUT l'état local.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CroquisSync = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DELAI_MS = 50;        // un lot toutes les ~50 ms : ~20 messages/s pour un trait continu
  const LOT_MAX = 64;         // points par message (MAX_POINTS_MSG de croquis-server)

  // ------------------------------------------------------------------ envoi
  // `envoyer(msg)` : le transport (NET.send). Les minuteries sont injectables
  // pour les tests. Le dessin LOCAL n'attend jamais ce module : on lui dit ce
  // qui vient d'être tracé, il l'envoie quand il veut.
  function creerEnvoi(o) {
    const envoyer = o.envoyer;
    const planifier = o.planifier || ((f, ms) => setTimeout(f, ms));
    const deplanifier = o.deplanifier || ((h) => clearTimeout(h));
    const delai = o.delaiMs || DELAI_MS;
    let courant = null;       // { turnId, s, c, w, envoye, tampon: [x, y, …], fin }
    let minuterie = null;

    function vider() {
      if (minuterie) { deplanifier(minuterie); minuterie = null; }
      const t = courant;
      if (!t) return;
      // Par paquets de LOT_MAX points ; le premier message porte l'encre.
      do {
        const p = t.tampon.splice(0, 2 * LOT_MAX);
        const dernier = t.tampon.length === 0;
        if (!p.length && t.envoye && !(t.fin && dernier)) return;
        const msg = { action: 'stroke', turnId: t.turnId, s: t.s, p };
        if (!t.envoye) { msg.c = t.c; msg.w = t.w; }
        if (t.fin && dernier) msg.end = true;
        envoyer(msg);
        t.envoye = true;
      } while (t.tampon.length);
      if (t.fin) courant = null;
    }
    const programmer = () => { if (!minuterie) minuterie = planifier(vider, delai); };

    return {
      // Un trait commence (ou repart après une coupe à 1 000 points) : tous
      // ses points déjà connus partent au prochain lot.
      commencer(turnId, t) {
        if (courant) { courant.fin = true; vider(); }
        courant = { turnId, s: t.s, c: t.c, w: t.w, envoye: false, tampon: t.p.slice(), fin: false };
        programmer();
      },
      point(t, x, y) {
        if (!courant || courant.s !== t.s) return;
        courant.tampon.push(x, y);
        if (courant.tampon.length >= 2 * LOT_MAX) vider(); else programmer();
      },
      finir(t) {
        if (!courant || (t && courant.s !== t.s)) return;
        courant.fin = true;
        vider();
      },
      // Annuler / effacer : ce qui était en attente part D'ABORD (sinon le
      // serveur retirerait le trait d'avant), puis l'ordre. Le trait en cours,
      // s'il y en a un, est celui qu'on retire : plus rien ne part pour lui.
      annuler(turnId) {
        vider();
        courant = null;
        envoyer({ action: 'undo', turnId });
      },
      effacer(turnId) {
        vider();
        courant = null;
        envoyer({ action: 'clear', turnId });
      },
      vider,
      // Nouveau tour, fin du dessin, snapshot : rien de ce qui attend ne part.
      oublier() {
        if (minuterie) { deplanifier(minuterie); minuterie = null; }
        courant = null;
      },
      enAttente: () => !!courant,
    };
  }

  // -------------------------------------------------------------- réception
  // `etat` : { dessin (dessin.js), turnId }. Le trait distant en cours est
  // `dessin.ouvert`, comme un trait local : l'atelier le trace sur la couche
  // vivante et le pose dessous quand il est fini — même rendu des deux côtés.
  // Rend ce que l'atelier doit retracer :
  //   { quoi: 'rien' }                         — ignoré (ancien tour, doublon…) ;
  //   { quoi: 'trait', trait, fini, precedent } — un trait a grandi ;
  //   { quoi: 'tout' }                         — retracer toute la feuille.
  const RIEN = { quoi: 'rien' };
  const pointsOk = (p) => Array.isArray(p) && p.length % 2 === 0 && p.every((v) => Number.isFinite(v));

  function nouveauTour(etat, turnId) {
    etat.turnId = turnId;
    etat.dessin.effacer();
  }

  function recevoir(etat, m) {
    const d = etat.dessin;
    switch (m && m.type) {
      case 'turn':
      case 'drawing':
        // Un AUTRE tour : la feuille repart de zéro. Le même : rien.
        if (m.turnId === etat.turnId) return RIEN;
        nouveauTour(etat, m.turnId);
        return { quoi: 'tout' };

      case 'snapshot': {
        etat.turnId = m.turnId;
        const traits = (m.strokes || []).filter((t) => pointsOk(t.p) && t.p.length >= 2)
          .map((t) => ({ s: t.s, c: t.c, w: t.w, p: t.p.slice() }));
        d.effacer();
        d.traits = traits;
        const dernier = (m.strokes || [])[(m.strokes || []).length - 1];
        d.ouvert = dernier && dernier.end === false ? traits[traits.length - 1] : null;
        d.prochainS = Math.max(d.prochainS, ...traits.map((t) => t.s + 1));
        return { quoi: 'tout' };
      }

      case 'stroke': {
        if (m.turnId !== etat.turnId || !pointsOk(m.p)) return RIEN;
        const ouvert = d.ouvert;
        if (ouvert && ouvert.s === m.s) {
          ouvert.p.push(...m.p);
          if (m.end) d.ouvert = null;
          return { quoi: 'trait', trait: ouvert, fini: !!m.end, precedent: null };
        }
        // Un trait déjà connu (et fini) : un doublon, on ne le rejoue pas.
        if (d.traits.some((t) => t.s === m.s)) return RIEN;
        if (m.p.length < 2) return RIEN;
        const t = { s: m.s, c: m.c, w: m.w, p: m.p.slice() };
        d.traits.push(t);
        // Un nouveau trait clôt le précédent (même règle que le serveur).
        d.ouvert = m.end ? null : t;
        return { quoi: 'trait', trait: t, fini: !!m.end, precedent: ouvert };
      }

      case 'undo': {
        if (m.turnId !== etat.turnId) return RIEN;
        let i = d.traits.length - 1;
        while (i >= 0 && d.traits[i].s !== m.s) i--;
        if (i < 0) return RIEN;
        const [t] = d.traits.splice(i, 1);
        if (t === d.ouvert) d.ouvert = null;
        return { quoi: 'tout' };
      }

      case 'clear':
        if (m.turnId !== etat.turnId) return RIEN;
        d.effacer();
        return { quoi: 'tout' };

      default:
        return RIEN;
    }
  }

  return { creerEnvoi, recevoir, DELAI_MS, LOT_MAX };
});
