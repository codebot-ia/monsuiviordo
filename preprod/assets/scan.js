/**
 * scan.js — capture d'une photo d'ordonnance avec la caméra arrière.
 * Aucune dépendance : getUserMedia pour le flux, ImageCapture pour aller
 * chercher la définition maximale du capteur, canvas en secours.
 * On prend la feuille entière : le recadrage se fait après coup (cadrage.js),
 * quand on voit enfin où sont les lignes utiles.
 */

// Découpe minimale quand on doit se rabattre sur une image du flux vidéo.
const LARGEUR_MINIMUM = 1600;

/** Contraintes vidéo : caméra arrière, définition demandée très haute. */
const CONTRAINTES = {
  video: {
    facingMode: { ideal: "environment" },
    width: { ideal: 4096 },
    height: { ideal: 3072 }
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

/** Demande au capteur sa plus grande définition et l'autofocus continu. */
async function reglerAuMieux(piste) {
  if (!piste) return;
  try {
    const capacites = piste.getCapabilities ? piste.getCapabilities() : {};
    const avance = [];
    if (capacites.width && capacites.height && capacites.width.max && capacites.height.max) {
      avance.push({ width: capacites.width.max, height: capacites.height.max });
    }
    if (capacites.focusMode && capacites.focusMode.includes("continuous")) {
      avance.push({ focusMode: "continuous" });
    }
    if (avance.length) await piste.applyConstraints({ advanced: avance });
  } catch (erreur) {
    console.warn("Réglages caméra non appliqués", erreur);
  }
}

/** Ouvre le flux caméra ; retente sans préférence si la caméra arrière manque. */
async function ouvrirFlux() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error("caméra indisponible dans ce navigateur");
  }
  let flux;
  try {
    flux = await navigator.mediaDevices.getUserMedia(CONTRAINTES);
  } catch (erreur) {
    if (erreur && (erreur.name === "OverconstrainedError" || erreur.name === "NotFoundError")) {
      flux = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    } else {
      throw erreur;
    }
  }
  await reglerAuMieux(flux.getVideoTracks()[0]);
  return flux;
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
 * Photo pleine définition. ImageCapture.takePhoto() rend l'image du capteur
 * (souvent 4000x3000), là où une image tirée du flux vidéo plafonne à 1920x1080.
 * Renvoie null si l'appareil ne sait pas faire : on retombe sur le flux.
 */
async function photoPleineResolution(piste) {
  if (typeof window.ImageCapture !== "function" || !piste) return null;
  try {
    const capture = new window.ImageCapture(piste);
    const blob = await capture.takePhoto();
    if (!blob || !blob.size) return null;
    const nom = `ordonnance-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.jpg`;
    return new File([blob], nom, { type: blob.type || "image/jpeg" });
  } catch (erreur) {
    console.warn("Photo pleine définition indisponible, image du flux utilisée", erreur);
    return null;
  }
}

/** Image tirée du flux vidéo (1920x1080 au mieux) quand takePhoto n'existe pas. */
function imageDuFlux(video) {
  const facteur = Math.max(1, LARGEUR_MINIMUM / video.videoWidth);
  const canevas = document.createElement("canvas");
  canevas.width = Math.round(video.videoWidth * facteur);
  canevas.height = Math.round(video.videoHeight * facteur);
  const contexte = canevas.getContext("2d");
  contexte.imageSmoothingQuality = "high";
  contexte.drawImage(video, 0, 0, canevas.width, canevas.height);
  return canevas;
}

/**
 * Ouvre l'écran de capture et rend le résultat une fois l'utilisateur décidé.
 * - { type: "photo", fichier } : photo prise (pleine définition si possible)
 * - { type: "fichier" } : l'utilisateur préfère choisir une image existante
 * - { type: "annule" } : abandon
 * Lève une erreur si la caméra ne peut pas être ouverte (l'appelant retombe
 * alors sur le champ fichier natif du navigateur).
 */
export async function demarrerScan() {
  const dialogue = document.getElementById("dialogue-scan");
  const video = document.getElementById("flux-scan");
  const etat = document.getElementById("etat-scan");
  const boutonPrendre = document.getElementById("bouton-prendre");
  const boutonTorche = document.getElementById("bouton-torche");
  const boutonFichier = document.getElementById("bouton-fichier-scan");
  if (!dialogue || !video || !boutonPrendre) throw new Error("écran de capture absent");

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
      annoncer("Prise de vue…");
      boutonPrendre.disabled = true;
      try {
        const pleine = await photoPleineResolution(flux.getVideoTracks()[0]);
        if (pleine) {
          finir({ type: "photo", fichier: pleine });
          return;
        }
        const canevas = imageDuFlux(video);
        const blob = await new Promise((ok) => canevas.toBlob(ok, "image/jpeg", 0.95));
        if (!blob) {
          annoncer("Photo impossible à enregistrer, réessayez.");
          return;
        }
        const nom = `ordonnance-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.jpg`;
        finir({ type: "photo", fichier: new File([blob], nom, { type: "image/jpeg" }) });
      } catch (erreur) {
        console.warn("Prise de vue impossible", erreur);
        annoncer("Prise de vue impossible, réessayez.");
      } finally {
        boutonPrendre.disabled = false;
      }
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
