/**
 * scan.js — capture d'une photo d'ordonnance avec la caméra arrière.
 * Aucune dépendance : getUserMedia pour le flux, canvas pour extraire l'image.
 * L'image est recadrée sur le repère de visée affiché à l'écran : l'utilisateur
 * cadre, l'app rogne (ni bords de table, ni fond de poche).
 */
import { recadrerSurCadre } from "./traitement-image.js";

// Largeur minimale de la découpe : en dessous, on agrandit avant l'OCR.
const LARGEUR_MINIMUM = 1500;

/** Contraintes vidéo : caméra arrière en HD si l'appareil le permet. */
const CONTRAINTES = {
  video: {
    facingMode: { ideal: "environment" },
    width: { ideal: 1920 },
    height: { ideal: 1080 }
  },
  audio: false
};

function attendreMetadonnees(video) {
  if (video.readyState >= 1 && video.videoWidth) return Promise.resolve();
  return new Promise((resoudre) => {
    const fini = () => {
      video.removeEventListener("loadedmetadata", fini);
      resoudre();
    };
    video.addEventListener("loadedmetadata", fini);
  });
}

/** Ouvre le flux caméra ; retente sans préférence si la caméra arrière manque. */
async function ouvrirFlux() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error("caméra indisponible dans ce navigateur");
  }
  try {
    return await navigator.mediaDevices.getUserMedia(CONTRAINTES);
  } catch (erreur) {
    if (erreur && (erreur.name === "OverconstrainedError" || erreur.name === "NotFoundError")) {
      return await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }
    throw erreur;
  }
}

/** Active ou coupe la torche du capteur, si l'appareil l'expose. */
async function reglerTorche(piste, allumee) {
  if (!piste || !piste.applyConstraints) return false;
  try {
    await piste.applyConstraints({ advanced: [{ torch: allumee }] });
    return true;
  } catch (erreur) {
    console.warn("Torche indisponible", erreur);
    return false;
  }
}

/**
 * Ouvre l'écran de capture et rend le résultat une fois l'utilisateur décidé.
 * - { type: "photo", fichier } : photo prise et déjà recadrée
 * - { type: "fichier" } : l'utilisateur préfère choisir une image existante
 * - { type: "annule" } : abandon
 * Lève une erreur si la caméra ne peut pas être ouverte (l'appelant retombe
 * alors sur le champ fichier natif du navigateur).
 */
export async function demarrerScan() {
  const dialogue = document.getElementById("dialogue-scan");
  const video = document.getElementById("flux-scan");
  const cadre = document.getElementById("cadre-scan");
  const etat = document.getElementById("etat-scan");
  const boutonPrendre = document.getElementById("bouton-prendre");
  const boutonTorche = document.getElementById("bouton-torche");
  const boutonFichier = document.getElementById("bouton-fichier-scan");
  if (!dialogue || !video || !cadre || !boutonPrendre) throw new Error("écran de capture absent");

  const flux = await ouvrirFlux();
  const annoncer = (texte) => {
    if (etat) etat.textContent = texte || "";
  };

  return new Promise((resoudre) => {
    let termine = false;

    const arreterFlux = () => {
      flux.getTracks().forEach((piste) => piste.stop());
      video.srcObject = null;
    };

    const finir = (resultat) => {
      if (termine) return;
      termine = true;
      dialogue.removeEventListener("close", surFermeture);
      boutonPrendre.removeEventListener("click", prendrePhoto);
      if (boutonTorche) boutonTorche.removeEventListener("click", basculerTorche);
      if (boutonFichier) boutonFichier.removeEventListener("click", choisirFichier);
      arreterFlux();
      if (dialogue.open) dialogue.close();
      resoudre(resultat);
    };

    const surFermeture = () => finir({ type: "annule" });
    const choisirFichier = () => finir({ type: "fichier" });

    const basculerTorche = async () => {
      const piste = flux.getVideoTracks()[0];
      const allumee = boutonTorche.getAttribute("aria-pressed") !== "true";
      const applique = await reglerTorche(piste, allumee);
      if (!applique) return annoncer("Torche non disponible sur cet appareil.");
      // L'état se lit sur le bouton (couleur + aria-pressed) : écrire une phrase
      // dans la ligne d'état ferait bouger les boutons sous le doigt.
      boutonTorche.setAttribute("aria-pressed", String(allumee));
      boutonTorche.classList.toggle("bouton--actif", allumee);
      annoncer("");
    };

    const prendrePhoto = async () => {
      if (!video.videoWidth) return annoncer("Caméra encore en cours d'ouverture…");
      const zoneVue = video.getBoundingClientRect();
      const zoneCadre = cadre.getBoundingClientRect();
      if (!zoneVue.width || !zoneVue.height) return annoncer("Aperçu indisponible, réessayez.");
      const recadrage = recadrerSurCadre(
        {
          largeurVideo: video.videoWidth,
          hauteurVideo: video.videoHeight,
          largeurVue: zoneVue.width,
          hauteurVue: zoneVue.height
        },
        {
          gauche: zoneCadre.left - zoneVue.left,
          haut: zoneCadre.top - zoneVue.top,
          largeur: zoneCadre.width,
          hauteur: zoneCadre.height
        }
      );
      if (!recadrage.largeur || !recadrage.hauteur) return annoncer("Cadre vide, replacez l'ordonnance.");

      const facteur = Math.max(1, LARGEUR_MINIMUM / recadrage.largeur);
      const canevas = document.createElement("canvas");
      canevas.width = Math.round(recadrage.largeur * facteur);
      canevas.height = Math.round(recadrage.hauteur * facteur);
      const contexte = canevas.getContext("2d");
      contexte.imageSmoothingQuality = "high";
      contexte.drawImage(
        video,
        recadrage.x,
        recadrage.y,
        recadrage.largeur,
        recadrage.hauteur,
        0,
        0,
        canevas.width,
        canevas.height
      );

      annoncer("Lecture de la photo…");
      const blob = await new Promise((resoudreBlob) =>
        canevas.toBlob(resoudreBlob, "image/jpeg", 0.95)
      );
      if (!blob) {
        annoncer("Photo impossible à enregistrer, réessayez.");
        return;
      }
      const nom = `ordonnance-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.jpg`;
      finir({ type: "photo", fichier: new File([blob], nom, { type: "image/jpeg" }) });
    };

    dialogue.addEventListener("close", surFermeture);
    boutonPrendre.addEventListener("click", prendrePhoto);
    if (boutonFichier) boutonFichier.addEventListener("click", choisirFichier);
    if (boutonTorche) {
      boutonTorche.hidden = true;
      boutonTorche.setAttribute("aria-pressed", "false");
      boutonTorche.classList.remove("bouton--actif");
      boutonTorche.addEventListener("click", basculerTorche);
    }

    video.srcObject = flux;
    dialogue.showModal();
    annoncer("Ouverture de la caméra…");

    attendreMetadonnees(video).then(() => {
      if (termine) return;
      const lecture = video.play();
      if (lecture && lecture.catch) lecture.catch(() => annoncer("Lecture vidéo bloquée, touchez la photo pour réessayer."));
      annoncer("");
      const piste = flux.getVideoTracks()[0];
      let capacites = null;
      try {
        capacites = piste && piste.getCapabilities ? piste.getCapabilities() : null;
      } catch (erreur) {
        capacites = null;
      }
      if (boutonTorche && capacites && capacites.torch) boutonTorche.hidden = false;
    });
  });
}
