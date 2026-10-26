/**
 * traitement-image.js — préparation des photos d'ordonnance avant OCR.
 * Que du calcul sur pixels : aucune dépendance, aucun accès au DOM.
 * Les fonctions travaillent sur un objet { donnees, largeur, hauteur } où
 * « donnees » est le tableau RGBA de getImageData (modifié sur place).
 */

/** Rayon de la fenêtre de voisinage, proportionnel à la taille de l'image. */
export function rayonParDefaut(largeur, hauteur) {
  return Math.max(6, Math.round(Math.min(largeur, hauteur) / 20));
}

/** Convertit l'image en niveaux de gris (r = v = b = luminance). */
export function versNiveauxDeGris(image) {
  const { donnees } = image;
  for (let i = 0; i < donnees.length; i += 4) {
    const gris = 0.299 * donnees[i] + 0.587 * donnees[i + 1] + 0.114 * donnees[i + 2];
    donnees[i] = donnees[i + 1] = donnees[i + 2] = gris;
  }
  return image;
}

/** Table de sommes cumulées (image intégrale) sur le canal rouge (= luminance). */
function tableIntegrale(donnees, largeur, hauteur) {
  const lignes = largeur + 1;
  const table = new Int32Array(lignes * (hauteur + 1));
  for (let y = 0; y < hauteur; y++) {
    let cumulLigne = 0;
    for (let x = 0; x < largeur; x++) {
      cumulLigne += donnees[(y * largeur + x) * 4];
      table[(y + 1) * lignes + (x + 1)] = table[y * lignes + (x + 1)] + cumulLigne;
    }
  }
  return { table, lignes };
}

/** Somme et effectif de la fenêtre carrée centrée sur (x, y), tronquée aux bords. */
function fenetre(integrales, largeur, hauteur, x, y, rayon) {
  const { table, lignes } = integrales;
  const x1 = Math.max(0, x - rayon);
  const y1 = Math.max(0, y - rayon);
  const x2 = Math.min(largeur - 1, x + rayon);
  const y2 = Math.min(hauteur - 1, y + rayon);
  const somme =
    table[(y2 + 1) * lignes + (x2 + 1)] -
    table[y1 * lignes + (x2 + 1)] -
    table[(y2 + 1) * lignes + x1] +
    table[y1 * lignes + x1];
  return { somme, nombre: (x2 - x1 + 1) * (y2 - y1 + 1) };
}

/**
 * Corrige l'éclairage inégal (ombre de la main, lampe d'un côté) : chaque pixel
 * est rapporté à la moyenne de son voisinage, comme si la feuille était
 * uniformément blanche. Sans seuillage dur, l'OCR garde un dégradé exploitable.
 * « melange » (0 → 1) dose la correction.
 */
export function corrigerEclairage(image, { rayon, melange = 1 } = {}) {
  const { donnees, largeur, hauteur } = image;
  const r = rayon || rayonParDefaut(largeur, hauteur);
  const integrales = tableIntegrale(donnees, largeur, hauteur);
  const dose = Math.min(1, Math.max(0, melange));
  for (let y = 0; y < hauteur; y++) {
    for (let x = 0; x < largeur; x++) {
      const i = (y * largeur + x) * 4;
      const { somme, nombre } = fenetre(integrales, largeur, hauteur, x, y, r);
      const moyenne = somme / nombre;
      if (moyenne < 8) continue; // zone totalement noire : rien à récupérer
      const gain = Math.min(3, 255 / moyenne);
      const valeur = donnees[i];
      const corrige = Math.min(255, valeur * gain);
      donnees[i] = donnees[i + 1] = donnees[i + 2] = valeur * (1 - dose) + corrige * dose;
    }
  }
  return image;
}

/** Histogramme de luminance (256 cases). */
export function histogramme(image) {
  const { donnees } = image;
  const cases = new Uint32Array(256);
  for (let i = 0; i < donnees.length; i += 4) cases[donnees[i]] += 1;
  return cases;
}

/** Étire le contraste entre deux percentiles (2 % et 98 % par défaut). */
export function etirerContraste(image, { bas = 0.02, haut = 0.98 } = {}) {
  const { donnees, largeur, hauteur } = image;
  const total = largeur * hauteur;
  if (!total) return image;
  const cases = histogramme(image);
  const seuilBas = total * bas;
  const seuilHaut = total * haut;
  let cumul = 0;
  let valeurBasse = 0;
  let valeurHaute = 255;
  for (let v = 0; v < 256; v++) {
    cumul += cases[v];
    if (cumul <= seuilBas) valeurBasse = v;
  }
  cumul = 0;
  for (let v = 255; v >= 0; v--) {
    cumul += cases[v];
    if (cumul <= total - seuilHaut) valeurHaute = v;
  }
  // Étendue trop faible (photo déjà bien contrastée ou page uniforme) : on ne touche à rien.
  if (valeurHaute - valeurBasse < 8) return image;
  const facteur = 255 / (valeurHaute - valeurBasse);
  for (let i = 0; i < donnees.length; i += 4) {
    const v = Math.min(255, Math.max(0, (donnees[i] - valeurBasse) * facteur));
    donnees[i] = donnees[i + 1] = donnees[i + 2] = v;
  }
  return image;
}

/**
 * Seuillage adaptatif (méthode de Bradley) : noir si le pixel est nettement plus
 * sombre que la moyenne de son voisinage. C'est ce qui tient sur une photo
 * éclairée de travers, là où un seuil global (Otsu) noierait une moitié de page.
 * « decalage » : 0.15 = 15 % sous la moyenne locale.
 */
export function binariser(image, { rayon, decalage = 0.15 } = {}) {
  const { donnees, largeur, hauteur } = image;
  const r = rayon || rayonParDefaut(largeur, hauteur);
  const integrales = tableIntegrale(donnees, largeur, hauteur);
  const marge = Math.min(0.6, Math.max(0.01, decalage));
  for (let y = 0; y < hauteur; y++) {
    for (let x = 0; x < largeur; x++) {
      const i = (y * largeur + x) * 4;
      const { somme, nombre } = fenetre(integrales, largeur, hauteur, x, y, r);
      const noir = donnees[i] < (somme / nombre) * (1 - marge) ? 0 : 255;
      donnees[i] = donnees[i + 1] = donnees[i + 2] = noir;
    }
  }
  return image;
}

/**
 * Rectangle de la vidéo réellement visible dans le repère de visée, quand la
 * vidéo est affichée en « object-fit: cover » (l'image remplit la zone et
 * déborde sur les côtés). Tout est en pixels : ceux de l'écran en entrée, ceux
 * de la vidéo en sortie.
 *
 * @param {{largeurVideo:number, hauteurVideo:number, largeurVue:number, hauteurVue:number}} vue
 * @param {{gauche:number, haut:number, largeur:number, hauteur:number}} cadre
 *        repère de visée, en coordonnées locales à la zone d'affichage
 * @returns {{x:number, y:number, largeur:number, hauteur:number}}
 */
export function recadrerSurCadre(vue, cadre) {
  const { largeurVideo, hauteurVideo, largeurVue, hauteurVue } = vue;
  const entier = (v) => Math.max(0, Math.round(v));
  if (!(largeurVideo > 0 && hauteurVideo > 0 && largeurVue > 0 && hauteurVue > 0)) {
    return { x: 0, y: 0, largeur: entier(largeurVideo), hauteur: entier(hauteurVideo) };
  }
  const echelle = Math.max(largeurVue / largeurVideo, hauteurVue / hauteurVideo);
  const margeX = (largeurVue - largeurVideo * echelle) / 2;
  const margeY = (hauteurVue - hauteurVideo * echelle) / 2;
  const borner = (valeur, maximum) => Math.min(maximum, Math.max(0, valeur));
  const x1 = borner((cadre.gauche - margeX) / echelle, largeurVideo);
  const y1 = borner((cadre.haut - margeY) / echelle, hauteurVideo);
  const x2 = borner((cadre.gauche + cadre.largeur - margeX) / echelle, largeurVideo);
  const y2 = borner((cadre.haut + cadre.hauteur - margeY) / echelle, hauteurVideo);
  return { x: entier(x1), y: entier(y1), largeur: entier(x2 - x1), hauteur: entier(y2 - y1) };
}
