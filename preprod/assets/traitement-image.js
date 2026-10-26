/**
 * traitement-image.js — préparation des photos d'ordonnance avant OCR.
 * Que du calcul sur pixels : aucune dépendance, aucun accès au DOM.
 * Les fonctions prennent directement un ImageData (getImageData / new ImageData)
 * ou tout objet de même forme { data, width, height }, et le modifient sur place.
 */

/** Rayon de la fenêtre de voisinage, proportionnel à la taille de l'image. */
export function rayonParDefaut(width, height) {
  return Math.max(6, Math.round(Math.min(width, height) / 20));
}

/** Convertit l'image en niveaux de gris (r = v = b = luminance). */
export function versNiveauxDeGris(image) {
  const { data } = image;
  for (let i = 0; i < data.length; i += 4) {
    const gris = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    data[i] = data[i + 1] = data[i + 2] = gris;
  }
  return image;
}

/** Table de sommes cumulées (image intégrale) sur le canal rouge (= luminance). */
function tableIntegrale(data, width, height) {
  const lignes = width + 1;
  const table = new Int32Array(lignes * (height + 1));
  for (let y = 0; y < height; y++) {
    let cumulLigne = 0;
    for (let x = 0; x < width; x++) {
      cumulLigne += data[(y * width + x) * 4];
      table[(y + 1) * lignes + (x + 1)] = table[y * lignes + (x + 1)] + cumulLigne;
    }
  }
  return { table, lignes };
}

/** Somme et effectif de la fenêtre carrée centrée sur (x, y), tronquée aux bords. */
function fenetre(integrales, width, height, x, y, rayon) {
  const { table, lignes } = integrales;
  const x1 = Math.max(0, x - rayon);
  const y1 = Math.max(0, y - rayon);
  const x2 = Math.min(width - 1, x + rayon);
  const y2 = Math.min(height - 1, y + rayon);
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
 * « melange » (0 → 1) dose la correction, « gainMax » évite d'amplifier le bruit.
 */
export function corrigerEclairage(image, { rayon, melange = 1, gainMax = 3 } = {}) {
  const { data, width, height } = image;
  const r = rayon || rayonParDefaut(width, height);
  const integrales = tableIntegrale(data, width, height);
  const dose = Math.min(1, Math.max(0, melange));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const { somme, nombre } = fenetre(integrales, width, height, x, y, r);
      const moyenne = somme / nombre;
      if (moyenne < 8) continue; // zone totalement noire : rien à récupérer
      const gain = Math.min(gainMax, 255 / moyenne);
      const valeur = data[i];
      const corrige = Math.min(255, valeur * gain);
      data[i] = data[i + 1] = data[i + 2] = valeur * (1 - dose) + corrige * dose;
    }
  }
  return image;
}

/** Histogramme de luminance (256 cases). */
export function histogramme(image) {
  const { data } = image;
  const cases = new Uint32Array(256);
  for (let i = 0; i < data.length; i += 4) cases[data[i]] += 1;
  return cases;
}

/** Étire le contraste entre deux percentiles (2 % et 98 % par défaut). */
export function etirerContraste(image, { bas = 0.02, haut = 0.98 } = {}) {
  const { data, width, height } = image;
  const total = width * height;
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
  for (let i = 0; i < data.length; i += 4) {
    const v = Math.min(255, Math.max(0, (data[i] - valeurBasse) * facteur));
    data[i] = data[i + 1] = data[i + 2] = v;
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
  const { data, width, height } = image;
  const r = rayon || rayonParDefaut(width, height);
  const integrales = tableIntegrale(data, width, height);
  const marge = Math.min(0.6, Math.max(0.01, decalage));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const { somme, nombre } = fenetre(integrales, width, height, x, y, r);
      const noir = data[i] < (somme / nombre) * (1 - marge) ? 0 : 255;
      data[i] = data[i + 1] = data[i + 2] = noir;
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
