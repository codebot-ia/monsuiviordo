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
 * Accentue les contours (masque flou léger) : rendu d'un agrandissement moins
 * mou, ce qui aide Tesseract sur les petites découpes passées en grand.
 * À réserver aux images agrandies (force ~0.7), sinon le bruit de la photo ressort.
 */
export function accentuerContours(image, { force = 0.7 } = {}) {
  const { data, width, height } = image;
  if (width < 3 || height < 3) return image;
  const source = data.slice(); // copie : on lit les voisins d'origine
  const dose = Math.max(0, force);
  const pas = width * 4;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = (y * width + x) * 4;
      const voisins = (source[i - 4] + source[i + 4] + source[i - pas] + source[i + pas]) / 4;
      const v = Math.min(255, Math.max(0, source[i] + dose * (source[i] - voisins)));
      data[i] = data[i + 1] = data[i + 2] = v;
    }
  }
  return image;
}

/**
 * Ramène une zone de recadrage dans l'image, en gardant une taille minimale.
 * Une zone est exprimée en fractions de l'image : { x, y, largeur, hauteur } ∈ [0, 1].
 */
export function bornerZone(zone, minimum = 0.06) {
  const nombre = (valeur, defaut) => (Number.isFinite(valeur) ? valeur : defaut);
  const largeur = Math.min(1, Math.max(minimum, nombre(zone && zone.largeur, 1)));
  const hauteur = Math.min(1, Math.max(minimum, nombre(zone && zone.hauteur, 1)));
  const x = Math.min(1 - largeur, Math.max(0, nombre(zone && zone.x, 0)));
  const y = Math.min(1 - hauteur, Math.max(0, nombre(zone && zone.y, 0)));
  return { x, y, largeur, hauteur };
}

/**
 * Déplace ou redimensionne une zone de recadrage.
 * « prise » : "centre" pour déplacer, sinon un ou deux côtés — "n", "s", "o", "e"
 * et leurs combinaisons ("no", "ne", "so", "se") pour les coins.
 * dx et dy sont des fractions de la largeur / hauteur de l'image.
 */
export function deplacerZone(zone, prise, dx, dy, minimum = 0.06) {
  const depart = bornerZone(zone, minimum);
  let gauche = depart.x;
  let haut = depart.y;
  let droite = depart.x + depart.largeur;
  let bas = depart.y + depart.hauteur;

  if (prise === "centre") {
    gauche += dx;
    droite += dx;
    haut += dy;
    bas += dy;
    if (gauche < 0) {
      droite -= gauche;
      gauche = 0;
    }
    if (droite > 1) {
      gauche -= droite - 1;
      droite = 1;
    }
    if (haut < 0) {
      bas -= haut;
      haut = 0;
    }
    if (bas > 1) {
      haut -= bas - 1;
      bas = 1;
    }
  } else {
    if (prise.includes("n")) haut = Math.min(haut + dy, bas - minimum);
    if (prise.includes("s")) bas = Math.max(bas + dy, haut + minimum);
    if (prise.includes("o")) gauche = Math.min(gauche + dx, droite - minimum);
    if (prise.includes("e")) droite = Math.max(droite + dx, gauche + minimum);
    gauche = Math.max(0, gauche);
    haut = Math.max(0, haut);
    droite = Math.min(1, droite);
    bas = Math.min(1, bas);
  }

  return bornerZone({ x: gauche, y: haut, largeur: droite - gauche, hauteur: bas - haut }, minimum);
}

/** Convertit une zone en fractions vers un rectangle de pixels (entiers, dans l'image). */
export function zoneVersPixels(zone, width, height) {
  const z = bornerZone(zone);
  const x = Math.min(Math.max(0, Math.round(z.x * width)), Math.max(0, width - 1));
  const y = Math.min(Math.max(0, Math.round(z.y * height)), Math.max(0, height - 1));
  return {
    x,
    y,
    largeur: Math.max(1, Math.min(Math.round(z.largeur * width), width - x)),
    hauteur: Math.max(1, Math.min(Math.round(z.hauteur * height), height - y))
  };
}
