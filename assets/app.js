/**
 * app.js — MonSuiviOrdo
 * Interface, stockage local (localStorage) et reconnaissance de texte locale (Tesseract.js).
 * Aucune donnée n'est envoyée à un serveur : tout reste dans le navigateur.
 */
import {
  aujourdHuiISO,
  finMedicament,
  finMaladie,
  joursRestants,
  etatMedicament,
  etatMaladie,
  formaterDate,
  libelleJours,
  creerId,
  donneesVides,
  normaliserDonnees,
  extraireOrdonnance,
  resumer
} from "./logique.js";
import { demarrerScan } from "./scan.js";
import { demanderCadrage } from "./cadrage.js";
import {
  versNiveauxDeGris,
  corrigerEclairage,
  etirerContraste,
  accentuerContours,
  binariser as binariserImage
} from "./traitement-image.js";

const CLE_STOCKAGE = "monsuiviordo.v1";
// Tout est servi par le site : aucune dépendance externe pour l'OCR.
const RACINE_OCR = new URL("./assets/ocr/", window.location.href).href;

const elements = {
  liste: document.getElementById("liste"),
  vide: document.getElementById("vide"),
  resume: document.getElementById("resume"),
  notifications: document.getElementById("notifications"),
  boutonImprimerTout: document.getElementById("bouton-imprimer-tout"),
  boutonNouvelleMaladie: document.getElementById("bouton-nouvelle-maladie"),
  boutonExporter: document.getElementById("bouton-exporter"),
  boutonImporter: document.getElementById("bouton-importer"),
  champImport: document.getElementById("champ-import"),
  boutonInstaller: document.getElementById("bouton-installer"),
  dialogueMaladie: document.getElementById("dialogue-maladie"),
  formulaireMaladie: document.getElementById("formulaire-maladie"),
  dialogueMedicament: document.getElementById("dialogue-medicament"),
  formulaireMedicament: document.getElementById("formulaire-medicament"),
  titreDialogueMedicament: document.getElementById("titre-dialogue-medicament"),
  impressionDate: document.getElementById("impression-date"),
  dialogueConfirmation: document.getElementById("dialogue-confirmation"),
  messageConfirmation: document.getElementById("message-confirmation"),
  champPhotoMaladie: document.getElementById("champ-photo-maladie"),
  champPhotoGalerie: document.getElementById("champ-photo-galerie"),
  dialogueAnalyse: document.getElementById("dialogue-analyse"),
  formulaireAnalyse: document.getElementById("formulaire-analyse"),
  listeAnalyse: document.getElementById("liste-analyse"),
  etatAnalyse: document.getElementById("etat-analyse"),
  detailsAnalyse: document.getElementById("details-analyse"),
  texteAnalyse: document.getElementById("texte-analyse"),
  boutonAjouterAnalyse: document.getElementById("bouton-ajouter-analyse")
};

let etat = charger();
let maladieCible = null; // id de la maladie en cours d'édition
let medicamentCible = null; // id du médicament en cours d'édition (null = ajout)
let invitationInstallation = null;
let chargementTesseract = null;
let suppressionArmee = null; // clé du bouton « Supprimer » déjà cliqué une fois
let minuteurSuppression = null;
const cartesOuvertes = new Set(); // maladies dépliées (repliées par défaut)
let glisser = null; // { carte, bouton, x, y, actif, minuteur }
let clicBloque = false; // vrai juste après un glisser, pour ne pas replier la carte

/* ------------------------------------------------------------------ utilitaires */

function echapper(texte) {
  const remplacements = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(texte === null || texte === undefined ? "" : texte).replace(/[&<>"']/g, (c) => remplacements[c]);
}

function notifier(message) {
  const bulle = document.createElement("p");
  bulle.className = "notification";
  bulle.textContent = message;
  elements.notifications.appendChild(bulle);
  while (elements.notifications.children.length > 2) {
    elements.notifications.firstElementChild.remove();
  }
  window.setTimeout(() => bulle.remove(), 3400);
}

/**
 * Suppression en deux temps : le premier clic arme le bouton (« Certain ? »),
 * le second supprime. Sans second clic sous 4 s, le bouton reprend son libellé.
 */
function armerSuppression(bouton, cle) {
  desarmerSuppression();
  bouton.dataset.libelleInitiale = bouton.textContent.trim();
  bouton.textContent = "Certain ?";
  bouton.classList.add("bouton--arme");
  suppressionArmee = cle;
  minuteurSuppression = window.setTimeout(() => {
    bouton.textContent = bouton.dataset.libelleInitiale || "Supprimer";
    bouton.classList.remove("bouton--arme");
    suppressionArmee = null;
    minuteurSuppression = null;
  }, 4000);
}

function desarmerSuppression() {
  if (minuteurSuppression) {
    window.clearTimeout(minuteurSuppression);
    minuteurSuppression = null;
  }
  document.querySelectorAll(".bouton--arme").forEach((bouton) => {
    bouton.textContent = bouton.dataset.libelleInitiale || "Supprimer";
    bouton.classList.remove("bouton--arme");
  });
  suppressionArmee = null;
}

/** Boîte de confirmation intégrée à l'application (remplace window.confirm). */
function demanderConfirmation(message) {
  return new Promise((resoudre) => {
    elements.messageConfirmation.textContent = message;
    const surFermeture = () => {
      elements.dialogueConfirmation.removeEventListener("close", surFermeture);
      resoudre(elements.dialogueConfirmation.returnValue === "confirmer");
    };
    elements.dialogueConfirmation.addEventListener("close", surFermeture);
    elements.dialogueConfirmation.returnValue = "annuler";
    elements.dialogueConfirmation.showModal();
  });
}

/* ------------------------------------------------------------------ stockage */

function charger() {
  try {
    const brut = window.localStorage.getItem(CLE_STOCKAGE);
    if (!brut) return donneesVides();
    return normaliserDonnees(JSON.parse(brut));
  } catch (erreur) {
    console.warn("Lecture du stockage impossible", erreur);
    return donneesVides();
  }
}

function sauvegarder() {
  try {
    window.localStorage.setItem(CLE_STOCKAGE, JSON.stringify(etat));
  } catch (erreur) {
    console.warn("Écriture du stockage impossible", erreur);
    notifier("Enregistrement impossible : stockage plein ou désactivé.");
  }
}

function trouverMaladie(id) {
  return etat.maladies.find((maladie) => maladie.id === id) || null;
}

/* ------------------------------------------------------------------ rendu */

function rendre() {
  const aujourdHui = aujourdHuiISO();
  suppressionArmee = null;
  if (minuteurSuppression) {
    window.clearTimeout(minuteurSuppression);
    minuteurSuppression = null;
  }
  elements.liste.replaceChildren();
  for (const maladie of etat.maladies) {
    elements.liste.appendChild(construireCarte(maladie, aujourdHui));
  }
  elements.vide.hidden = etat.maladies.length > 0;
  elements.resume.textContent = resumer(etat, aujourdHui);
}

function texteSousTitre(maladie, aujourdHui) {
  const fin = finMaladie(maladie);
  const medicaments = maladie.medicaments;
  if (!medicaments.length) {
    return `Aucun médicament<span class="ecran-seul"> : ajoutez-en un pour démarrer le suivi</span>`;
  }
  if (!fin) {
    const nombre = medicaments.length;
    return `${nombre} médicament${nombre > 1 ? "s" : ""}<span class="ecran-seul"> · en attente de démarrage</span>`;
  }
  const restants = joursRestants(fin, aujourdHui);
  const detail = restants > 0 ? libelleJours(restants) : "terminé";
  return `<strong>Traitement jusqu'au ${formaterDate(fin)}</strong><span class="ecran-seul"> · ${echapper(detail)}</span>`;
}

function construireCarte(maladie, aujourdHui) {
  const article = document.createElement("article");
  const ouverte = cartesOuvertes.has(maladie.id);
  const nombre = maladie.medicaments.length;
  article.className = `carte ${ouverte ? "carte--ouverte" : "carte--repliee"}`;
  article.dataset.maladie = maladie.id;
  const lignes = maladie.medicaments.map((medicament) => construireLigneMedicament(medicament, aujourdHui)).join("");
  article.innerHTML = `
    <header class="carte__entete">
      <h2 class="carte__titre-ligne">
        <button type="button" class="carte__bascule" data-action="basculer-maladie"
                aria-expanded="${ouverte}" aria-controls="corps-${maladie.id}">
          <span class="carte__entete-texte">
            <span class="carte__titre">${echapper(maladie.nom)}</span>
            <span class="carte__sous-titre">${texteSousTitre(maladie, aujourdHui)}</span>
          </span>
          ${nombre ? `<span class="carte__compte" aria-hidden="true">${nombre}</span>` : ""}
          <span class="carte__poignee" aria-hidden="true"></span>
          <svg class="carte__chevron" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path d="M3 5.5 8 10.5l5-5" fill="none" stroke="currentColor"
                  stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </h2>
    </header>
    <div class="carte__corps" id="corps-${maladie.id}">
      <div class="carte__actions">
        <button type="button" class="bouton bouton--petit" data-action="ajouter-medicament">+ Médicament</button>
        <button type="button" class="bouton bouton--petit" data-action="scanner-ordonnance">Scanner</button>
        <button type="button" class="bouton bouton--petit" data-action="imprimer-carte">Imprimer</button>
        <button type="button" class="bouton bouton--petit bouton--danger" data-action="supprimer-maladie">Supprimer</button>
      </div>
      ${nombre
        ? `<ul class="medicaments">${lignes}</ul>`
        : `<p class="carte__vide">Ajoutez les médicaments prescrits pour cette maladie.</p>`}
    </div>
  `;
  return article;
}

function construireLigneMedicament(medicament, aujourdHui) {
  const fin = finMedicament(medicament);
  const statut = etatMedicament(medicament, aujourdHui);
  const restants = joursRestants(fin, aujourdHui);
  const libelles = { attente: "En attente", "en-cours": "En cours", termine: "Terminé" };
  const detail = statut === "en-cours" ? ` · ${libelleJours(restants)}` : "";
  const duree = `${medicament.dureeJours} jour${medicament.dureeJours > 1 ? "s" : ""}`;
  const dates = medicament.debut && fin
    ? `Du ${formaterDate(medicament.debut)} au ${formaterDate(fin)} · ${duree}`
    : `<span class="ecran-seul">Durée prévue : </span>${duree}<span class="ecran-seul"> · pas encore démarré</span>`;
  const boutonDebut = medicament.debut
    ? `<button type="button" class="bouton bouton--petit" data-action="annuler-debut">Annuler</button>`
    : `<button type="button" class="bouton bouton--petit bouton--principal" data-action="demarrer">Début</button>`;

  return `
    <li class="medicament" data-medicament="${medicament.id}">
      <div class="medicament__ligne">
        <span class="medicament__nom">${echapper(medicament.nom)}</span>
        <span class="pastille pastille--${statut}">${libelles[statut]}${detail}</span>
      </div>
      ${medicament.posologie ? `<p class="medicament__posologie">${echapper(medicament.posologie)}</p>` : ""}
      <p class="medicament__dates">${dates}</p>
      <div class="medicament__actions">
        ${boutonDebut}
        <button type="button" class="bouton bouton--petit" data-action="modifier-medicament">Modifier</button>
        <button type="button" class="bouton bouton--petit bouton--danger" data-action="supprimer-medicament">Supprimer</button>
      </div>
    </li>
  `;
}

/* ------------------------------------------------------------------ dialogues */

function ouvrirDialogueMaladie() {
  elements.formulaireMaladie.reset();
  elements.dialogueMaladie.showModal();
  elements.formulaireMaladie.elements.nom.focus();
}

function ouvrirDialogueMedicament(idMaladie, idMedicament) {
  const maladie = trouverMaladie(idMaladie);
  if (!maladie) return;
  maladieCible = idMaladie;
  medicamentCible = idMedicament || null;
  elements.formulaireMedicament.reset();

  if (medicamentCible) {
    const medicament = maladie.medicaments.find((m) => m.id === medicamentCible);
    if (!medicament) return;
    elements.titreDialogueMedicament.textContent = "Modifier le médicament";
    elements.formulaireMedicament.elements.nom.value = medicament.nom;
    elements.formulaireMedicament.elements.posologie.value = medicament.posologie || "";
    elements.formulaireMedicament.elements.dureeJours.value = medicament.dureeJours;
    elements.formulaireMedicament.elements.debut.value = medicament.debut || "";
  } else {
    elements.titreDialogueMedicament.textContent = "Nouveau médicament";
    elements.formulaireMedicament.elements.dureeJours.value = 7;
  }

  elements.dialogueMedicament.showModal();
  elements.formulaireMedicament.elements.nom.focus();
}

/* ------------------------------------------------------------------ impression */

function reinitialiserImpression() {
  document.body.classList.remove("impression-unique");
  document.querySelectorAll(".carte--imprimee").forEach((carte) => carte.classList.remove("carte--imprimee"));
}

function imprimer(idMaladie) {
  reinitialiserImpression();
  let complement = "";
  if (idMaladie) {
    document.body.classList.add("impression-unique");
    const carte = elements.liste.querySelector(`[data-maladie="${idMaladie}"]`);
    if (carte) carte.classList.add("carte--imprimee");
    const maladie = trouverMaladie(idMaladie);
    if (maladie) complement = ` · ${maladie.nom}`;
  }
  if (elements.impressionDate) {
    elements.impressionDate.textContent = `${complement} — document édité le ${formaterDate(aujourdHuiISO())}`;
  }
  window.addEventListener("afterprint", reinitialiserImpression, { once: true });
  window.setTimeout(() => window.print(), 60);
  window.setTimeout(reinitialiserImpression, 1500);
}

/* ------------------------------------------------------------------ sauvegardes */

function exporter() {
  const charge = {
    application: "MonSuiviOrdo",
    version: 1,
    exporteLe: new Date().toISOString(),
    donnees: etat
  };
  const blob = new Blob([JSON.stringify(charge, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const lien = document.createElement("a");
  lien.href = url;
  lien.download = `monsuiviordo-${aujourdHuiISO()}.json`;
  document.body.appendChild(lien);
  lien.click();
  lien.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  notifier("Sauvegarde téléchargée.");
}

async function importer(fichier) {
  try {
    const charge = JSON.parse(await fichier.text());
    const donnees = normaliserDonnees(charge && charge.donnees ? charge.donnees : charge);
    if (!donnees.maladies.length) {
      notifier("Cette sauvegarde ne contient aucune maladie.");
      return;
    }
    const accord = await demanderConfirmation(
      `Remplacer les ${etat.maladies.length} maladie(s) actuelles par les ${donnees.maladies.length} de la sauvegarde ?`
    );
    if (!accord) return;
    etat = donnees;
    sauvegarder();
    rendre();
    notifier("Sauvegarde restaurée.");
  } catch (erreur) {
    console.warn("Import impossible", erreur);
    notifier("Fichier illisible : sauvegarde au format JSON attendue.");
  }
}

/* ------------------------------------------------------------------ scan d'ordonnance */

function chargerTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (!chargementTesseract) {
    chargementTesseract = new Promise((resoudre, rejeter) => {
      const script = document.createElement("script");
      script.src = `${RACINE_OCR}tesseract.min.js`;
      script.onload = () => (window.Tesseract ? resoudre(window.Tesseract) : rejeter(new Error("moteur absent")));
      script.onerror = () => rejeter(new Error("moteur de reconnaissance introuvable"));
      document.head.appendChild(script);
    });
  }
  return chargementTesseract;
}

/**
 * Prépare la photo avant OCR : mise à l'échelle, niveaux de gris, correction de
 * l'éclairage (ombres, lampe d'un côté), puis étirement du contraste.
 * « durcir » ajoute un seuillage adaptatif noir/blanc, réservé à la seconde
 * tentative : une photo bien exposée donne de meilleurs résultats en gris.
 */
async function preparerImage(fichier, { durcir = false } = {}) {
  try {
    const bitmap = await createImageBitmap(fichier);
    const largeurCible = Math.min(2200, Math.max(1400, bitmap.width));
    const echelle = largeurCible / bitmap.width;
    const canevas = document.createElement("canvas");
    canevas.width = Math.round(bitmap.width * echelle);
    canevas.height = Math.round(bitmap.height * echelle);
    const contexte = canevas.getContext("2d", { willReadFrequently: true });
    contexte.imageSmoothingQuality = "high";
    contexte.drawImage(bitmap, 0, 0, canevas.width, canevas.height);
    const image = contexte.getImageData(0, 0, canevas.width, canevas.height);
    versNiveauxDeGris(image);
    corrigerEclairage(image);
    etirerContraste(image);
    // Découpe agrandie (peu de pixels au départ) : un peu de netteté rend les
    // lettres plus franches pour Tesseract. Jamais sur une photo réduite.
    if (echelle > 1.15) accentuerContours(image, { force: 0.7 });
    if (durcir) binariserImage(image);
    contexte.putImageData(image, 0, 0);
    return canevas;
  } catch (erreur) {
    console.warn("Préparation de l'image impossible, photo brute utilisée", erreur);
    return fichier;
  }
}

// En dessous de ce nombre de lettres, la lecture est jugée trop pauvre pour
// être proposée : on retente sur une image noir/blanc.
const LETTRES_MINIMUM = 25;
// Message de progression courant : le moteur rappelle sa progression souvent.
let messageReconnaissance = "Reconnaissance en cours…";

function compterLettres(texte) {
  const lettres = String(texte || "").match(/\p{L}/gu);
  return lettres ? lettres.length : 0;
}

/** Crée le moteur Tesseract, paramétré pour une ordonnance (colonne unique). */
async function creerWorker(Tesseract) {
  const worker = await Tesseract.createWorker("fra", 1, {
    workerPath: `${RACINE_OCR}worker.min.js`,
    corePath: RACINE_OCR,
    langPath: `${RACINE_OCR}lang`,
    gzip: true,
    workerBlobURL: false,
    logger: (m) => {
      if (m.status === "recognizing text") {
        elements.etatAnalyse.textContent = `${messageReconnaissance} ${Math.round((m.progress || 0) * 100)} %`;
      }
    }
  });
  // Colonne unique de texte et espaces conservés : indispensable pour séparer
  // les noms de médicaments de leur posologie.
  await worker.setParameters({
    tessedit_pageseg_mode: "4",
    preserve_interword_spaces: "1"
  });
  return worker;
}

async function reconnaitre(worker, source, message) {
  messageReconnaissance = message;
  elements.etatAnalyse.textContent = message;
  const { data } = await worker.recognize(source);
  return (data && data.text ? data.text : "").trim();
}

/** Lance l'OCR locale sur une photo et renvoie le texte reconnu. */
async function lireTexte(fichier) {
  elements.etatAnalyse.textContent = "Préparation de l'image…";
  const premiere = await preparerImage(fichier);
  elements.etatAnalyse.textContent = "Chargement du moteur de reconnaissance (une seule fois)…";
  const Tesseract = await chargerTesseract();
  const worker = await creerWorker(Tesseract);
  try {
    const texte = await reconnaitre(worker, premiere, "Reconnaissance en cours…");
    if (compterLettres(texte) >= LETTRES_MINIMUM) return texte;
    // Photo difficile : seconde passe sur une image seuillée (noir/blanc).
    const renforcee = await preparerImage(fichier, { durcir: true });
    const texteRenforce = await reconnaitre(worker, renforcee, "Deuxième lecture, image renforcée…");
    return compterLettres(texteRenforce) > compterLettres(texte) ? texteRenforce : texte;
  } finally {
    await worker.terminate();
  }
}

/**
 * Photo prise ou choisie -> passage par l'écran de cadrage -> OCR.
 * « reprise » n'a de sens qu'après une prise de vue.
 */
async function cadrerPuisAnalyser(idMaladie, fichier, { reprise }) {
  if (!fichier) return;
  const choix = await demanderCadrage(fichier, { reprise });
  if (!choix) return;
  if (choix.recommencer) return "recommencer";
  scannerPourMaladie(idMaladie, choix.fichier);
}

/** Ouvre l'écran de capture, avec repli sur le sélecteur de fichier natif. */
async function lancerScan(idMaladie) {
  maladieCible = idMaladie;
  for (;;) {
    let capture;
    try {
      capture = await demarrerScan();
    } catch (erreur) {
      console.warn("Caméra indisponible, sélection de fichier", erreur);
      elements.champPhotoMaladie.click();
      return;
    }
    if (capture.type === "fichier") {
      elements.champPhotoGalerie.click();
      return;
    }
    if (capture.type !== "photo") return;
    const suite = await cadrerPuisAnalyser(idMaladie, capture.fichier, { reprise: true });
    if (suite !== "recommencer") return;
  }
}

/** Ouvre l'aperçu d'analyse, puis remplit les médicaments détectés pour relecture. */
async function scannerPourMaladie(idMaladie, fichier) {
  const maladie = trouverMaladie(idMaladie);
  if (!maladie) return;
  maladieCible = idMaladie;
  ouvrirAnalyse("Analyse de la photo en cours…");
  try {
    const texte = await lireTexte(fichier);
    if (!texte) {
      elements.etatAnalyse.textContent = "Aucun texte détecté : reprenez la photo avec plus de lumière, ou saisissez à la main.";
      ajouterLigneAnalyse({ nom: "", posologie: "", dureeJours: 7 });
      return;
    }
    remplirAnalyse(extraireOrdonnance(texte), texte);
  } catch (erreur) {
    console.warn("Analyse impossible", erreur);
    elements.etatAnalyse.textContent = "Reconnaissance indisponible sur ce navigateur. Saisissez les médicaments à la main.";
  }
}

function ouvrirAnalyse(messageAttente) {
  elements.listeAnalyse.replaceChildren();
  elements.detailsAnalyse.hidden = true;
  elements.detailsAnalyse.open = false;
  elements.texteAnalyse.textContent = "";
  elements.etatAnalyse.textContent = messageAttente || "";
  majBoutonAnalyse();
  if (!elements.dialogueAnalyse.open) elements.dialogueAnalyse.showModal();
}

/** Ajoute une ligne éditable (un médicament détecté) dans l'aperçu. */
function ajouterLigneAnalyse(valeurs) {
  const ligne = document.createElement("div");
  ligne.className = "ligne-analyse";
  ligne.innerHTML = `
    <label class="ligne-analyse__choix">
      <input type="checkbox" checked aria-label="Ajouter ce médicament">
    </label>
    <div class="ligne-analyse__champs">
      <input class="champ__saisie" data-champ="nom" type="text" maxlength="80"
             placeholder="Médicament" aria-label="Médicament" value="${echapper(valeurs.nom || "")}">
      <textarea class="champ__saisie champ__saisie--zone" data-champ="posologie" rows="2" maxlength="220"
                placeholder="Posologie" aria-label="Posologie">${echapper(valeurs.posologie || "")}</textarea>
      <div class="ligne-analyse__pied">
        <label class="ligne-analyse__duree">
          <span>Durée (jours)</span>
          <input class="champ__saisie" data-champ="dureeJours" type="number" min="1" max="365"
                 value="${Number(valeurs.dureeJours) > 0 ? Number(valeurs.dureeJours) : 7}" aria-label="Durée en jours">
        </label>
        <button type="button" class="bouton bouton--petit bouton--danger" data-retirer>Retirer</button>
      </div>
    </div>`;
  elements.listeAnalyse.appendChild(ligne);
  majBoutonAnalyse();
  return ligne;
}

function majBoutonAnalyse() {
  const total = elements.listeAnalyse.querySelectorAll('.ligne-analyse input[type="checkbox"]:checked').length;
  elements.boutonAjouterAnalyse.disabled = total === 0;
  elements.boutonAjouterAnalyse.textContent = total > 1 ? `Ajouter ${total} médicaments` : "Ajouter le médicament";
}

function remplirAnalyse(ordonnance, texte) {
  const medicaments = (ordonnance && ordonnance.medicaments) || [];
  if (!medicaments.length) {
    elements.etatAnalyse.textContent = "Aucun médicament reconnu : complétez la ligne ci-dessous à la main.";
    ajouterLigneAnalyse({ nom: "", posologie: "", dureeJours: 7 });
  } else {
    const nombre = medicaments.length;
    elements.etatAnalyse.textContent = `${nombre} médicament${nombre > 1 ? "s" : ""} détecté${nombre > 1 ? "s" : ""} — relisez avant d'ajouter.`;
    medicaments.forEach((medicament) => ajouterLigneAnalyse(medicament));
  }
  if (texte) {
    elements.texteAnalyse.textContent = texte;
    elements.detailsAnalyse.hidden = false;
  }
  if (elements.dialogueAnalyse.open) {
    elements.dialogueAnalyse.scrollTop = 0;
  }
}

/* ------------------------------------------------------------------ événements */

elements.boutonNouvelleMaladie.addEventListener("click", ouvrirDialogueMaladie);
elements.boutonImprimerTout.addEventListener("click", () => imprimer(null));
elements.boutonExporter.addEventListener("click", exporter);
elements.boutonImporter.addEventListener("click", () => elements.champImport.click());
elements.champImport.addEventListener("change", () => {
  const fichier = elements.champImport.files && elements.champImport.files[0];
  elements.champImport.value = "";
  if (fichier) importer(fichier);
});

document.addEventListener("click", (evenement) => {
  const action = evenement.target.closest("[data-action]");
  if (action && action.dataset.action === "nouvelle-maladie") ouvrirDialogueMaladie();
  const fermeture = evenement.target.closest("[data-fermer]");
  if (fermeture) {
    const dialogue = fermeture.closest("dialog");
    if (dialogue) dialogue.close();
  }
});

elements.formulaireMaladie.addEventListener("submit", (evenement) => {
  evenement.preventDefault();
  const nom = elements.formulaireMaladie.elements.nom.value.trim();
  if (!nom) return;
  etat.maladies.unshift({ id: creerId(), nom, creeLe: new Date().toISOString(), medicaments: [] });
  sauvegarder();
  rendre();
  elements.dialogueMaladie.close();
  notifier(`« ${nom} » ajoutée.`);
});

elements.formulaireMedicament.addEventListener("submit", (evenement) => {
  evenement.preventDefault();
  const maladie = trouverMaladie(maladieCible);
  if (!maladie) return;
  cartesOuvertes.add(maladie.id);
  const formulaire = elements.formulaireMedicament.elements;
  const nom = formulaire.nom.value.trim();
  if (!nom) return;
  const duree = Math.min(Math.max(parseInt(formulaire.dureeJours.value, 10) || 1, 1), 365);
  const valeurs = {
    nom,
    posologie: formulaire.posologie.value.trim(),
    dureeJours: duree,
    debut: formulaire.debut.value || null
  };

  if (medicamentCible) {
    const medicament = maladie.medicaments.find((m) => m.id === medicamentCible);
    if (medicament) Object.assign(medicament, valeurs);
    notifier("Médicament modifié.");
  } else {
    maladie.medicaments.push({ id: creerId(), ...valeurs });
    notifier("Médicament ajouté.");
  }

  sauvegarder();
  rendre();
  elements.dialogueMedicament.close();
});

/** Un champ fichier vient de rendre une image (photo prise ou galerie). */
function ecouterPhotoChoisie(champ) {
  if (!champ) return;
  champ.addEventListener("change", () => {
    const fichier = champ.files && champ.files[0];
    champ.value = "";
    if (fichier && maladieCible) cadrerPuisAnalyser(maladieCible, fichier, { reprise: false });
  });
}
ecouterPhotoChoisie(elements.champPhotoMaladie);
ecouterPhotoChoisie(elements.champPhotoGalerie);

elements.listeAnalyse.addEventListener("click", (evenement) => {
  const retirer = evenement.target.closest("[data-retirer]");
  if (!retirer) return;
  const ligne = retirer.closest(".ligne-analyse");
  if (ligne) ligne.remove();
  majBoutonAnalyse();
});

elements.listeAnalyse.addEventListener("change", (evenement) => {
  if (evenement.target.matches('input[type="checkbox"]')) majBoutonAnalyse();
});

elements.formulaireAnalyse.addEventListener("submit", (evenement) => {
  evenement.preventDefault();
  const maladie = trouverMaladie(maladieCible);
  if (!maladie) return;
  cartesOuvertes.add(maladie.id);
  const ajouts = [];
  for (const ligne of elements.listeAnalyse.querySelectorAll(".ligne-analyse")) {
    const coche = ligne.querySelector('input[type="checkbox"]').checked;
    const nom = ligne.querySelector('[data-champ="nom"]').value.trim();
    if (!coche || !nom) continue;
    const duree = parseInt(ligne.querySelector('[data-champ="dureeJours"]').value, 10);
    ajouts.push({
      id: creerId(),
      nom,
      posologie: ligne.querySelector('[data-champ="posologie"]').value.trim(),
      dureeJours: Math.min(Math.max(duree || 7, 1), 365),
      debut: null
    });
  }
  if (!ajouts.length) {
    notifier("Aucun médicament retenu : cochez une ligne et renseignez son nom.");
    return;
  }
  maladie.medicaments.push(...ajouts);
  sauvegarder();
  rendre();
  elements.dialogueAnalyse.close();
  notifier(`${ajouts.length} médicament${ajouts.length > 1 ? "s" : ""} ajouté${ajouts.length > 1 ? "s" : ""}.`);
});

elements.liste.addEventListener("click", (evenement) => {
  // Un glisser-déposer vient de se terminer : on n'ouvre pas la carte.
  if (clicBloque) {
    evenement.preventDefault();
    evenement.stopPropagation();
    return;
  }
  const bouton = evenement.target.closest("button[data-action]");
  if (!bouton) return;
  const carte = bouton.closest("[data-maladie]");
  const ligne = bouton.closest("[data-medicament]");
  const idMaladie = carte ? carte.dataset.maladie : null;
  const idMedicament = ligne ? ligne.dataset.medicament : null;

  switch (bouton.dataset.action) {
    case "basculer-maladie": {
      const article = bouton.closest(".carte");
      const id = article ? article.dataset.maladie : null;
      if (!id) break;
      if (cartesOuvertes.has(id)) cartesOuvertes.delete(id);
      else cartesOuvertes.add(id);
      const desormaisOuverte = cartesOuvertes.has(id);
      article.classList.toggle("carte--ouverte", desormaisOuverte);
      article.classList.toggle("carte--repliee", !desormaisOuverte);
      bouton.setAttribute("aria-expanded", String(desormaisOuverte));
      break;
    }

    case "ajouter-medicament":
      if (idMaladie) cartesOuvertes.add(idMaladie);
      ouvrirDialogueMedicament(idMaladie, null);
      break;

    case "imprimer-carte":
      imprimer(idMaladie);
      break;

    case "scanner-ordonnance": {
      const maladie = trouverMaladie(idMaladie);
      if (!maladie) break;
      cartesOuvertes.add(idMaladie);
      lancerScan(idMaladie);
      break;
    }

    case "supprimer-maladie": {
      const maladie = trouverMaladie(idMaladie);
      if (!maladie) break;
      if (suppressionArmee !== `maladie:${idMaladie}`) {
        armerSuppression(bouton, `maladie:${idMaladie}`);
        break;
      }
      etat.maladies = etat.maladies.filter((m) => m.id !== idMaladie);
      sauvegarder();
      rendre();
      notifier("Maladie supprimée.");
      break;
    }

    case "demarrer": {
      const maladie = trouverMaladie(idMaladie);
      const medicament = maladie && maladie.medicaments.find((m) => m.id === idMedicament);
      if (!medicament) break;
      medicament.debut = aujourdHuiISO();
      sauvegarder();
      rendre();
      notifier(`Traitement démarré : fin le ${formaterDate(finMedicament(medicament))}.`);
      break;
    }

    case "annuler-debut": {
      const maladie = trouverMaladie(idMaladie);
      const medicament = maladie && maladie.medicaments.find((m) => m.id === idMedicament);
      if (!medicament) break;
      medicament.debut = null;
      sauvegarder();
      rendre();
      notifier("Début annulé : le médicament repasse en attente.");
      break;
    }

    case "modifier-medicament":
      ouvrirDialogueMedicament(idMaladie, idMedicament);
      break;

    case "supprimer-medicament": {
      const maladie = trouverMaladie(idMaladie);
      if (!maladie) break;
      const medicament = maladie.medicaments.find((m) => m.id === idMedicament);
      if (!medicament) break;
      if (suppressionArmee !== `medicament:${idMedicament}`) {
        armerSuppression(bouton, `medicament:${idMedicament}`);
        break;
      }
      maladie.medicaments = maladie.medicaments.filter((m) => m.id !== idMedicament);
      sauvegarder();
      rendre();
      notifier("Médicament supprimé.");
      break;
    }

    default:
      break;
  }
});

// Recalcule les compteurs au retour sur l'onglet (changement de jour).
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") rendre();
});

// Installation en application (Android/Chrome) quand le navigateur le propose.
window.addEventListener("beforeinstallprompt", (evenement) => {
  evenement.preventDefault();
  invitationInstallation = evenement;
  elements.boutonInstaller.hidden = false;
});

elements.boutonInstaller.addEventListener("click", async () => {
  if (!invitationInstallation) return;
  invitationInstallation.prompt();
  await invitationInstallation.userChoice;
  invitationInstallation = null;
  elements.boutonInstaller.hidden = true;
});

// Service worker : fonctionne hors ligne après la première visite.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((erreur) => {
      console.warn("Service worker non enregistré", erreur);
    });
  });
}

/* ------------------------------------------------------------------ ordre des maladies */

// Appui long puis glisser pour réordonner les maladies.
const DELAI_APPUI = 350; // ms

function demarrerAppui(evenement) {
  if (evenement.button !== undefined && evenement.button !== 0) return;
  const bouton = evenement.target.closest(".carte__bascule");
  if (!bouton) return;
  const carte = bouton.closest("[data-maladie]");
  if (!carte || etat.maladies.length < 2) return;
  glisser = { carte, bouton, x: evenement.clientX, y: evenement.clientY, actif: false, deltaY: 0, decalage: 0 };
  glisser.minuteur = window.setTimeout(() => {
    if (!glisser) return;
    glisser.actif = true;
    carte.style.transition = "none";
    carte.classList.add("carte--glissee");
    document.body.classList.add("glisser-en-cours");
    if (navigator.vibrate) {
      try { navigator.vibrate(12); } catch (erreur) { /* sans importance */ }
    }
  }, DELAI_APPUI);
}

function annulerAppui() {
  if (!glisser) return;
  window.clearTimeout(glisser.minuteur);
  relacherCarte(glisser.carte, false);
  glisser = null;
}

/** Remet la carte à sa place (avec une petite transition si demandé). */
function relacherCarte(carte, animer) {
  if (!carte) return;
  carte.classList.remove("carte--glissee");
  document.body.classList.remove("glisser-en-cours");
  if (animer) {
    carte.style.transition = "transform .18s ease";
    carte.style.transform = "";
    window.setTimeout(() => {
      carte.style.transition = "";
      carte.style.transform = "";
    }, 220);
  } else {
    carte.style.transition = "";
    carte.style.transform = "";
  }
}

function appliquerTranslation() {
  if (!glisser) return;
  const translation = glisser.deltaY + glisser.decalage;
  glisser.carte.style.transform = `translateY(${Math.round(translation)}px)`;
}

/** Échange la carte glissée avec ses voisines quand elle les dépasse. */
function replacerSelonPosition() {
  const carte = glisser.carte;
  for (let garde = 0; garde < 15; garde += 1) {
    const rect = carte.getBoundingClientRect();
    const centre = rect.top + rect.height / 2;
    let bouge = false;

    const suivante = carte.nextElementSibling;
    if (suivante) {
      const r = suivante.getBoundingClientRect();
      if (centre > r.top + r.height / 2) {
        const avant = carte.offsetTop;
        elements.liste.insertBefore(carte, suivante.nextElementSibling);
        glisser.decalage += avant - carte.offsetTop;
        appliquerTranslation();
        bouge = true;
      }
    }
    if (!bouge) {
      const precedente = carte.previousElementSibling;
      if (precedente) {
        const r = precedente.getBoundingClientRect();
        if (centre < r.top + r.height / 2) {
          const avant = carte.offsetTop;
          elements.liste.insertBefore(carte, precedente);
          glisser.decalage += avant - carte.offsetTop;
          appliquerTranslation();
          bouge = true;
        }
      }
    }
    if (!bouge) break;
  }
}

function surDeplacement(evenement) {
  if (!glisser) return;
  if (!glisser.actif) {
    // Bouger avant la fin de l'appui = défilement ou clic normal.
    if (Math.hypot(evenement.clientX - glisser.x, evenement.clientY - glisser.y) > 10) annulerAppui();
    return;
  }
  evenement.preventDefault();
  glisser.deltaY = evenement.clientY - glisser.y;
  appliquerTranslation();
  replacerSelonPosition();

  // Défilement automatique près des bords, pour les longues listes.
  const marge = 80;
  if (evenement.clientY < marge) window.scrollBy(0, -14);
  else if (evenement.clientY > window.innerHeight - marge) window.scrollBy(0, 14);
}

function terminerAppui() {
  if (!glisser) return;
  window.clearTimeout(glisser.minuteur);
  const aGlisse = glisser.actif;
  const carte = glisser.carte;
  relacherCarte(carte, aGlisse);
  glisser = null;
  if (!aGlisse) return;

  const ordre = [...elements.liste.querySelectorAll(".carte")].map((carte) => carte.dataset.maladie);
  etat.maladies.sort((a, b) => ordre.indexOf(a.id) - ordre.indexOf(b.id));
  sauvegarder();
  clicBloque = true;
  window.setTimeout(() => { clicBloque = false; }, 350);
  notifier("Ordre des maladies enregistré.");
}

elements.liste.addEventListener("pointerdown", demarrerAppui);
// Pendant le glisser seulement, on empêche la page de défiler ; sinon un
// simple appui sur l'en-tête continue de faire défiler normalement.
elements.liste.addEventListener("touchmove", (evenement) => {
  if (glisser && glisser.actif) evenement.preventDefault();
}, { passive: false });
elements.liste.addEventListener("contextmenu", (evenement) => {
  if (glisser && glisser.actif) evenement.preventDefault();
});
window.addEventListener("pointermove", surDeplacement, { passive: false });
window.addEventListener("pointerup", terminerAppui);
window.addEventListener("pointercancel", annulerAppui);
window.addEventListener("blur", annulerAppui);

// Quand le clavier mobile s'ouvre, on recentre le champ actif dans la fenêtre :
// sans ça, une fenêtre haute (aperçu de scan, formulaire) passe sous le clavier.
document.addEventListener("focusin", (evenement) => {
  const champ = evenement.target;
  if (!champ || !champ.matches("input, textarea, select")) return;
  const dialogue = champ.closest("dialog");
  if (!dialogue) return;
  window.setTimeout(() => {
    try {
      champ.scrollIntoView({ block: "center", behavior: "smooth" });
    } catch (erreur) {
      champ.scrollIntoView();
    }
  }, 280);
});

rendre();
