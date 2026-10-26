/**
 * cadrage.js — écran de recadrage après la prise de vue.
 * On photographie la feuille entière, puis on ne garde que les lignes utiles :
 * beaucoup plus de pixels par lettre, donc un OCR nettement plus stable.
 * Aucune dépendance : canvas pour l'aperçu et la découpe, pointeur pour les coins.
 */
import { bornerZone, deplacerZone, priseAttrapee, zoneVersPixels } from "./traitement-image.js";

// Taille minimale d'une zone, en fraction de l'image : en dessous, les quatre
// prises de coin se marcheraient dessus et le doigt ne saurait plus quoi faire.
const MARGE_MINIMUM = 0.12;
// Rayon d'accroche des coins, en pixels d'écran (le doigt est large).
const ACCROCHE = 28;
// Zone proposée à l'ouverture : presque toute l'image, coins attrapables.
const ZONE_DEPART = { x: 0.06, y: 0.06, largeur: 0.88, hauteur: 0.88 };

/**
 * Affiche la photo et laisse l'utilisateur choisir la zone à lire.
 * Résout { fichier } (zone découpée), { recommencer: true } (nouvelle photo) ou null.
 */
export async function demanderCadrage(fichier, { reprise = false } = {}) {
  const dialogue = document.getElementById("dialogue-cadrage");
  const vue = document.getElementById("vue-cadrage");
  const canevas = document.getElementById("canevas-cadrage");
  const zoneEl = document.getElementById("zone-cadrage");
  const mesure = document.getElementById("mesure-cadrage");
  const boutonEntier = document.getElementById("bouton-cadrage-entier");
  const boutonReprendre = document.getElementById("bouton-reprendre");
  const boutonLire = document.getElementById("bouton-analyser");
  const etat = document.getElementById("etat-cadrage");
  if (!dialogue || !vue || !canevas || !zoneEl) return null;

  const bitmap = await createImageBitmap(fichier);
  const annoncer = (texte) => {
    if (etat) etat.textContent = texte || "";
  };

  return new Promise((resoudre) => {
    let zone = bornerZone(ZONE_DEPART, MARGE_MINIMUM);
    let taille = { largeur: 0, hauteur: 0 };
    let glissement = null;
    let termine = false;

    /** Ajuste l'aperçu à la place disponible (fait après showModal : avant, tout vaut 0). */
    const dimensionner = () => {
      const parent = vue.parentElement;
      const style = parent ? getComputedStyle(parent) : null;
      const marge = style ? parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) : 0;
      const largeurDispo = Math.max(160, (parent ? parent.clientWidth : 320) - marge);
      const hauteurDispo = Math.max(200, Math.round(window.innerHeight * 0.5));
      const echelle = Math.min(largeurDispo / bitmap.width, hauteurDispo / bitmap.height);
      taille = {
        largeur: Math.max(80, Math.round(bitmap.width * echelle)),
        hauteur: Math.max(80, Math.round(bitmap.height * echelle))
      };
      vue.style.width = `${taille.largeur}px`;
      vue.style.height = `${taille.hauteur}px`;
      canevas.width = taille.largeur;
      canevas.height = taille.hauteur;
      const contexte = canevas.getContext("2d");
      contexte.imageSmoothingQuality = "high";
      contexte.drawImage(bitmap, 0, 0, taille.largeur, taille.hauteur);
    };

    const dessinerZone = () => {
      zoneEl.style.left = `${zone.x * 100}%`;
      zoneEl.style.top = `${zone.y * 100}%`;
      zoneEl.style.width = `${zone.largeur * 100}%`;
      zoneEl.style.height = `${zone.hauteur * 100}%`;
      if (mesure) {
        const pixels = zoneVersPixels(zone, bitmap.width, bitmap.height);
        mesure.textContent = `${pixels.largeur} × ${pixels.hauteur} px`;
      }
    };

    // On mesure la distance aux sommets plutôt que de compter sur la boîte des
    // repères visuels : le doigt vise un sommet, pas un rectangle de 48 px.
    const surAppui = (evenement) => {
      if (!taille.largeur || !taille.hauteur) return;
      const prise = priseAttrapee(evenement.clientX, evenement.clientY, zoneEl.getBoundingClientRect(), ACCROCHE);
      if (!prise) return;
      glissement = {
        prise,
        departX: evenement.clientX,
        departY: evenement.clientY,
        zone: { ...zone }
      };
      evenement.preventDefault();
    };

    const surBouge = (evenement) => {
      if (!glissement) return;
      const dx = (evenement.clientX - glissement.departX) / taille.largeur;
      const dy = (evenement.clientY - glissement.departY) / taille.hauteur;
      zone = deplacerZone(glissement.zone, glissement.prise, dx, dy, MARGE_MINIMUM);
      dessinerZone();
      evenement.preventDefault();
    };

    const surRelache = () => {
      glissement = null;
    };

    const surRedimensionnement = () => {
      if (termine) return;
      dimensionner();
      dessinerZone();
    };

    const finir = (resultat) => {
      if (termine) return;
      termine = true;
      dialogue.removeEventListener("close", surFermeture);
      vue.removeEventListener("pointerdown", surAppui);
      window.removeEventListener("pointermove", surBouge);
      window.removeEventListener("pointerup", surRelache);
      window.removeEventListener("pointercancel", surRelache);
      window.removeEventListener("resize", surRedimensionnement);
      if (boutonEntier) boutonEntier.removeEventListener("click", prendreTout);
      if (boutonReprendre) boutonReprendre.removeEventListener("click", reprendre);
      if (boutonLire) boutonLire.removeEventListener("click", confirmer);
      if (bitmap.close) bitmap.close();
      if (dialogue.open) dialogue.close();
      resoudre(resultat);
    };

    const surFermeture = () => finir(null);
    const reprendre = () => finir({ recommencer: true });

    const prendreTout = () => {
      zone = bornerZone({ x: 0, y: 0, largeur: 1, hauteur: 1 }, MARGE_MINIMUM);
      dessinerZone();
    };

    const confirmer = async () => {
      const pixels = zoneVersPixels(zone, bitmap.width, bitmap.height);
      const sortie = document.createElement("canvas");
      sortie.width = pixels.largeur;
      sortie.height = pixels.hauteur;
      sortie
        .getContext("2d")
        .drawImage(bitmap, pixels.x, pixels.y, pixels.largeur, pixels.hauteur, 0, 0, pixels.largeur, pixels.hauteur);
      annoncer("Découpe de la zone…");
      const blob = await new Promise((ok) => sortie.toBlob(ok, "image/jpeg", 0.95));
      if (!blob) {
        annoncer("Découpe impossible, réessayez.");
        return;
      }
      finir({ fichier: new File([blob], fichier.name || "ordonnance.jpg", { type: "image/jpeg" }) });
    };

    if (boutonReprendre) boutonReprendre.hidden = !reprise;
    dialogue.addEventListener("close", surFermeture);
    vue.addEventListener("pointerdown", surAppui);
    window.addEventListener("pointermove", surBouge);
    window.addEventListener("pointerup", surRelache);
    window.addEventListener("pointercancel", surRelache);
    window.addEventListener("resize", surRedimensionnement);
    if (boutonEntier) boutonEntier.addEventListener("click", prendreTout);
    if (boutonReprendre) boutonReprendre.addEventListener("click", reprendre);
    if (boutonLire) boutonLire.addEventListener("click", confirmer);

    dialogue.showModal();
    annoncer("");
    dimensionner();
    dessinerZone();
  });
}
