/**
 * logique.js — fonctions pures de MonSuiviOrdo (aucun accès au DOM ni au stockage).
 * Toutes les dates « métier » sont des chaînes ISO locales : "AAAA-MM-JJ".
 */

export const MS_PAR_JOUR = 86400000;

/** Date d'aujourd'hui au format ISO local (pas UTC : évite le décalage d'un jour). */
export function aujourdHuiISO() {
  return versISO(new Date());
}

/** Convertit un objet Date en "AAAA-MM-JJ" en heure locale. */
export function versISO(date) {
  const deux = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${deux(date.getMonth() + 1)}-${deux(date.getDate())}`;
}

/** Convertit "AAAA-MM-JJ" en Date locale calée à midi (immunise contre les changements d'heure). */
export function depuisISO(iso) {
  const [annee, mois, jour] = String(iso).split("-").map(Number);
  return new Date(annee, mois - 1, jour, 12, 0, 0, 0);
}

/** Ajoute (ou retire) des jours à une date ISO. */
export function ajouterJours(iso, jours) {
  const date = depuisISO(iso);
  date.setDate(date.getDate() + Number(jours || 0));
  return versISO(date);
}

/** Date de fin d'un médicament : début + durée - 1 (le jour du début compte comme jour 1). */
export function finMedicament(medicament) {
  if (!medicament || !medicament.debut) return null;
  const duree = Number(medicament.dureeJours);
  if (!Number.isFinite(duree) || duree < 1) return null;
  return ajouterJours(medicament.debut, duree - 1);
}

/** Date de fin d'une maladie : la plus tardive des fins de ses médicaments. */
export function finMaladie(maladie) {
  const medicaments = (maladie && maladie.medicaments) || [];
  const fins = medicaments.map(finMedicament).filter(Boolean).sort();
  return fins.length ? fins[fins.length - 1] : null;
}

/** Nombre de jours restants (jour de fin inclus). 0 ou moins = terminé. */
export function joursRestants(finISO, aujourdHui = aujourdHuiISO()) {
  if (!finISO) return null;
  const ecart = depuisISO(finISO) - depuisISO(aujourdHui);
  return Math.round(ecart / MS_PAR_JOUR) + 1;
}

/** État d'un médicament : "attente" (pas démarré), "en-cours" ou "termine". */
export function etatMedicament(medicament, aujourdHui = aujourdHuiISO()) {
  const fin = finMedicament(medicament);
  if (!fin) return "attente";
  return joursRestants(fin, aujourdHui) > 0 ? "en-cours" : "termine";
}

/** État d'une maladie, déduit de ses médicaments. */
export function etatMaladie(maladie, aujourdHui = aujourdHuiISO()) {
  const medicaments = (maladie && maladie.medicaments) || [];
  if (!medicaments.length) return "vide";
  const etats = medicaments.map((m) => etatMedicament(m, aujourdHui));
  if (etats.includes("en-cours")) return "en-cours";
  if (etats.includes("attente")) return "attente";
  return "termine";
}

/** "2026-10-29" -> "29/10/2026". */
export function formaterDate(iso) {
  if (!iso) return "—";
  const [annee, mois, jour] = String(iso).split("-");
  if (!annee || !mois || !jour) return "—";
  return `${jour}/${mois}/${annee}`;
}

/** Libellé court des jours restants. */
export function libelleJours(nombre) {
  if (nombre === null || nombre === undefined) return "";
  if (nombre <= 0) return "terminé";
  if (nombre === 1) return "dernier jour";
  return `reste ${nombre} j`;
}

/** Identifiant unique, avec repli si crypto.randomUUID est absent. */
export function creerId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Structure de données initiale. */
export function donneesVides() {
  return { version: 1, maladies: [] };
}

function texteSur(valeur, longueurMax) {
  return String(valeur === null || valeur === undefined ? "" : valeur)
    .trim()
    .slice(0, longueurMax);
}

function borneDuree(valeur) {
  const duree = Number(valeur);
  if (!Number.isFinite(duree) || duree < 1) return 7;
  return Math.min(Math.round(duree), 365);
}

/**
 * Nettoie des données lues (stockage local ou sauvegarde importée) :
 * champs attendus uniquement, types corrigés, ids uniques.
 */
export function normaliserDonnees(brut) {
  const donnees = donneesVides();
  const maladies = Array.isArray(brut && brut.maladies) ? brut.maladies : [];
  donnees.maladies = maladies
    .filter((maladie) => maladie && texteSur(maladie.nom, 80))
    .map((maladie) => {
      const medicaments = Array.isArray(maladie.medicaments) ? maladie.medicaments : [];
      return {
        id: texteSur(maladie.id, 64) || creerId(),
        nom: texteSur(maladie.nom, 80),
        creeLe: texteSur(maladie.creeLe, 40) || new Date().toISOString(),
        medicaments: medicaments
          .filter((medicament) => medicament && texteSur(medicament.nom, 80))
          .map((medicament) => {
            const debut = /^\d{4}-\d{2}-\d{2}$/.test(String(medicament.debut))
              ? String(medicament.debut)
              : null;
            return {
              id: texteSur(medicament.id, 64) || creerId(),
              nom: texteSur(medicament.nom, 80),
              posologie: texteSur(medicament.posologie, 120),
              dureeJours: borneDuree(medicament.dureeJours),
              debut
            };
          })
      };
    });
  return donnees;
}

/* ------------------------------------------------------------------ lecture d'ordonnance */

// Préfixe de liste numérotée (« 1) », « 2/ », « 1°) », « 3. ») que l'on
// rencontre sur les ordonnances hospitalières et les logiciels métier.
const MOTIF_NUMERO_LISTE = /^\(?\d{1,2}\s*[.)°\/]+\s*(?=[A-Za-zÀ-ÿ])/;

const MOTIF_FORME = /(comprim|g[ée]lul|cuill|pulv[ée]risation|sachet|goutte|bouff[ée]e|application|injection|suppositoire|ovule|dose|lavement|shampooin|solution|sirop|cr[eè]me|pommade|collyre|patch|transdermique|spray|gobelet|bouchon|dosette|rouleau|compresse)/i;
const MOTIF_RYTHME = /(matin|midi|apr[eè]s[- ]midi|soir|nuit|coucher|repas|par\s*[\/-]?\s*jour|\/\s*j|toutes?\s+les|\d+\s*fois|fois\s+par|heure|semaine|[x×]\s*\/?\s*j|si\s+douleur|en\s+cas\s+de)/i;
const MOTIF_EMBALLAGE = /\b(CPR|COMPR|GELULES?|GEL|G[EÉ]L|SUSP|SOLU?|SP|S\/S|TUBE|FL|AMP|BUV|EFF|LP|ZTV|NAS|PULV|SIROP|CR[EÈ]ME|POM|SUPPO|SACHET|COLLYRE|INJ|STICK|PDRE|DRAG|OVULE)\b/gi;
const MOTIF_BRUIT = /(ordonnance|pharmacie|pharmacien|docteur|m[ée]decin|membre|association|assurance|r[ée]glement|honoraires|ch[eè]que|accepte|conventionn|garde|ameli|https?|www\.|prescription|prescripteur|produits?|patient|titulaire|autorit[ée]|donn[ée]es|transmises|[ée]lectroniquement|droits|signature|cachet|merci|confiance|cordialement|conserver|posologie|notice|g[ée]n[ée]rique|substitu|rpps|\bam\b|t[ée]l\b|e-?mail|mail|\bdr\b|adresse|box|bo[îi]te|renouvel|date|apicrypt|code[- ]?barre|\bean\b|\blot\b|poids|taille|\bage\b|sexe|naissance|\bn[ée]\b|identification|structure|affection|exon[eé]rante|intercurrente|bizone|maladies?)/i;
const MOTIF_ETIQUETTE = /^\s*(?:n[°o]\s*\.?\s*)?(rpps|adeli|finess|siret|siren|lot|am\b|ordre\s+des)|^\s*n[°o]\s*$/i;
const MOTIF_DEBUT_POSOLOGIE = /\s+\d+\s*(?:à\s*\d+\s*)?(comprim|g[ée]lul|cuill|pulv[ée]risation|sachet|goutte|dose|application|bouff[ée]e|injection|gobelet|bouchon)/i;
// Dosage écrit en toutes lettres (« vingt-cinq microgrammes ») : fréquent sur
// les ordonnances de stupéfiants, jamais sur une ligne de bruit.
const MOTIF_DOSAGE_EN_MOTS = /\b(?:un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|treize|quatorze|quinze|seize|dix[- ]sept|dix[- ]huit|dix[- ]neuf|vingt(?:[- ]\w+)?|trente|quarante|cinquante|soixante(?:[- ]\w+)?|cent)\s+(?:milligrammes?|microgrammes?|centigrammes?|grammes?|millilitres?|unit[ée]s?)\b/i;
// Mesure de dispositif / de pansement : « 25 mmx5m », « 20*20 ».
const MOTIF_MESURE = /\d\s*(?:mm|cm)|\d\s*[*x×]\s*\d/i;
// Ligne de conditionnement seule : « 1 flacon », « 1 boîte de 10 » (et non
// « 1 sachet le soir », qui est une posologie).
const MOTIF_CONDITIONNEMENT = /^[\s|"'\u201c\u201d\u201e\u00ab\u00bb]*\d+\s*(?:bo[iî]tes?|flacons?|tubes?|rouleaux?|sachets?|ampoules?|plaquettes?)[\s-]*?(?:de\s+\d+\s*)?$/i;
// Consigne administrative sans intérêt pour la posologie.
const MOTIF_CONSIGNE = /^[\s"'|-]*(?:[àa]\s*(?:d[ée]livrer|renouveler)|[àa]\s+renouveler|renouveler|nombre\s+de\s+produits)\b/i;

/** Un dosage pharmaceutique est-il présent (tolérance OCR sur 0/O, 1/I/l et G/6) ? */
function aUnDosage(ligne) {
  const t = String(ligne);
  return (
    /\d[\d\s.,]*[0-9OIL]{0,4}\s*(?:MG|M6|MGI|MCG|UI|µG|UG)\b/i.test(t) ||
    /\b(?:MG|M6|MGI|MCG|ML|UI)\s*\/\s*(?:ML|G|KG|HEURE)\b/i.test(t) ||
    /\b\d[\dOIL]{0,4}\s*(?:ML|G|KG)\b/i.test(t) ||
    /\d[\d\s.,]*\s*%/.test(t) ||
    MOTIF_DOSAGE_EN_MOTS.test(t)
  );
}

function compterEmballages(ligne) {
  const trouves = String(ligne).match(MOTIF_EMBALLAGE);
  return trouves ? trouves.length : 0;
}

function estLignePosologie(ligne) {
  const t = String(ligne);
  if (/^\d/.test(t) && MOTIF_FORME.test(t)) return true;
  return MOTIF_FORME.test(t) && MOTIF_RYTHME.test(t) && !aUnDosage(t);
}

/** Vrai si la ligne ressemble au nom commercial d'un médicament. */
function estNomDeMedicament(ligne, suivante) {
  // On juge sur le nom nettoyé : « … boîte de 8 » ou « … comprimé pelliculé »
  // en fin de ligne ne doivent pas faire passer un médicament pour du bruit.
  const t = nettoyerNom(ligne);
  if (t.length < 3 || t.length > 120) return false;
  // Un conditionnement seul (« tube », « flacon ») n'est jamais un médicament.
  if (/^(?:tubes?|flacons?|bo[iî]tes?|rouleaux?|sachets?|ampoules?|plaquettes?)$/i.test(t)) return false;
  if (MOTIF_BRUIT.test(t)) return false;
  if (estLignePosologie(t)) return false;
  // Un nom commence par un mot de lettres : écarte les codes-barres, les
  // numéros de lot, les dates et les lignes de chiffres.
  if (!/^[A-Za-zÉÈÀÂÎÔÛÇéèêàâîïôûç]{3,}/.test(t)) return false;
  const lettres = (t.match(/[A-Za-zÉÈÀÂÎÔÛÇéèêàâîïôûç]/g) || []).length;
  const chiffres = (t.match(/\d/g) || []).length;
  if (lettres < 4 || lettres <= chiffres) return false;
  if (aUnDosage(t) || compterEmballages(t) >= 2 || MOTIF_MESURE.test(t)) return true;
  // Nom seul en majuscules, le dosage figurant sur la ligne suivante.
  const enMajuscules = /^[A-ZÉÈÀÂÎÔÛÇ][A-ZÉÈÀÂÎÔÛÇ'’.\-\s]{2,45}$/.test(t);
  if (enMajuscules && suivante) {
    if (aUnDosage(suivante) || compterEmballages(suivante) > 0) return true;
  }
  // Nom d'une seule syllabe (« sebiprox », « lithioderm ») : c'est la ligne
  // du dessous qui porte la forme galénique et le rythme.
  if (motSeul(t) && suivante) {
    return aUnDosage(suivante) || compterEmballages(suivante) > 0 || MOTIF_MESURE.test(suivante) || estLignePosologie(suivante);
  }
  return false;
}

/** Un seul mot, sans chiffre (« DOLIPRANE », « sebiprox »). */
function motSeul(ligne) {
  return /^[A-Za-zÉÈÀÂÎÔÛÇéèêàâîïôûç][A-Za-zÉÈÀÂÎÔÛÇéèêàâîïôûç'’\-]{3,29}$/.test(ligne);
}

/**
 * Nettoie un nom de médicament : enlève les artefacts d'OCR en bord de ligne et
 * la fin de description (« …, comprimé pelliculé », « …, boîte de 30 ») qui
 * pollue les noms des ordonnances bizones.
 */
function nettoyerNom(nom) {
  return String(nom)
    .replace(/^[^A-Za-zÀ-ÿ0-9]+/, "")
    .replace(/,\s*(?:bo[iî]tes?|flacons?|tubes?|plaquettes?|sachets?|g[ée]lules?|comprim[ée]s?|poudre|solution|dispositif|sirop|cr[eè]mes?|pommades?|collyres?)(?=[\s,]|$).*$/i, "")
    .replace(/[\s|\\"'\u2018\u2019\u201A\u201B`]+$/, "")
    // Ponctuation et artefacts laissés en fin de ligne par l'OCR
    // (« ANXEMIL 200MG CPR 98 ,  ; »).
    .replace(/[\s,;:.!?|]+$/, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 90);
}

/** Sépare un nom collé à sa posologie par l'OCR ("NOM 200MG 2 comprimés matin et soir"). */
function separerNomEtPosologie(ligne) {
  const trouve = String(ligne).match(MOTIF_DEBUT_POSOLOGIE);
  if (!trouve || trouve.index === undefined || trouve.index < 3) return { nom: ligne, reste: "" };
  return { nom: ligne.slice(0, trouve.index).trim(), reste: ligne.slice(trouve.index).trim() };
}

const NOMBRES = { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, douze: 12, quinze: 15, vingt: 20 };

function dureeEnJours(quantite, unite) {
  const nombre = NOMBRES[String(quantite).toLowerCase()] || parseInt(quantite, 10);
  if (!nombre || nombre < 1) return null;
  const u = String(unite).toLowerCase();
  let jours = nombre;
  if (u.startsWith("semaine")) jours = nombre * 7;
  else if (u.startsWith("mois")) jours = nombre * 30;
  return Math.min(jours, 365);
}

/** "pendant 1 mois" / "durée : 2 semaines" / "5 jours" -> nombre de jours. */
export function extraireDuree(texte) {
  const contenu = String(texte || "");
  const quantites = "(\\d{1,3}|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|douze|quinze|vingt)";
  const unites = "(jours?|semaines?|mois)";
  const avecPreposition = contenu.match(new RegExp(`(?:pendant|durant|pour|sur|dur[ée]e\\s*:?)\\s*${quantites}\\s*${unites}`, "i"));
  if (avecPreposition) return dureeEnJours(avecPreposition[1], avecPreposition[2]);
  const simple = contenu.match(new RegExp(`${quantites}\\s*${unites}\\b`, "i"));
  if (simple) return dureeEnJours(simple[1], simple[2]);
  return null;
}

function nettoyerPosologie(texte) {
  return String(texte)
    .replace(/^[\s\-•*·|]+/, "")
    // Reliquat de conditionnement arraché au nom : « 5 sachets de 1 … ».
    .replace(/^\d+\s*(?:sachets?|bo[iî]tes?|flacons?|tubes?)\s+de\s+\d+\s*/i, "")
    .replace(/\s*(?:pendant|durant|pour)\s+(?:\d{1,3}|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|douze|quinze|vingt)\s*(?:jours?|semaines?|mois)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.;,])/g, "$1")
    .replace(/[.;,\s]+$/, "")
    .trim()
    .slice(0, 220);
}

/** Une ligne de détail est-elle du bruit (code-barres, numéros, total) ? */
function estLigneParasite(ligne) {
  const t = String(ligne).trim();
  if (!t) return true;
  if (MOTIF_BRUIT.test(t)) return true;
  if (MOTIF_CONDITIONNEMENT.test(t)) return true;
  if (MOTIF_CONSIGNE.test(t)) return true;
  if (/^[\d\s.,\-\/|:]+$/.test(t)) return true; // uniquement des chiffres
  const chiffres = (t.match(/\d/g) || []).length;
  const lettres = (t.match(/[A-Za-zÉÈÀÂÎÔÛÇéèêàâîïôûç]/g) || []).length;
  if (chiffres > 0 && lettres < 4 && chiffres >= lettres) return true;
  // Mention isolée sans chiffre (cachet, paraphe, « John Somare ») : une vraie
  // phrase de posologie compte au moins trois mots.
  if (!/\d/.test(t) && t.split(/\s+/).length < 3 && !MOTIF_FORME.test(t)) return true;
  return false;
}

/** Valeur d'une étiquette administrative (RPPS, AM, lot…) collée à la ligne suivante ? */
function estValeurIdentifiant(ligne) {
  const t = String(ligne).trim();
  if (!t || t.length > 40) return false;
  if (estNomDeMedicament(t, "")) return false;
  if (estLignePosologie(t)) return false;
  return !aUnDosage(t) && compterEmballages(t) === 0;
}

/**
 * Analyse le texte d'une ordonnance et renvoie le motif éventuel ainsi que la
 * liste des médicaments détectés : [{ nom, posologie, dureeJours }].
 * Les valeurs sont des propositions : l'utilisateur les relit et les corrige.
 */
export function extraireOrdonnance(texte) {
  const resultat = { maladie: "", medicaments: [] };
  const contenu = String(texte || "")
    .replace(/\r/g, "")
    // L'OCR colle parfois le nombre et la forme galénique (« 1comprimé »).
    .replace(/(\d)(?=(?:comprim|g[ée]lul|cuill|sachet|goutte|dose|application|bouff[ée]e|injection|pulv[ée]risation|suppositoire|ovule|patch|gobelet|bouchon|dosette|rouleau|compresse|flacons?|tubes?|bo[iî]tes?))/gi, "$1 ");
  if (!contenu.trim()) return resultat;

  const motif = contenu.match(/(?:motif|diagnostic|indication)\s*:?\s*([A-Za-zÉÈÀÂÎÔÛÇéèêàâîïôûç' \-]{3,60})/i);
  if (motif) {
    const candidat = motif[1].trim().replace(/\s{2,}/g, " ");
    if (candidat && !MOTIF_BRUIT.test(candidat)) resultat.maladie = candidat;
  }

  const lignes = contenu
    .split("\n")
    // Colonnes d'un même en-tête (« ANXEMIL … 98                    ,     ; ») :
    // au-delà de trois espaces, ce qui suit appartient à une autre colonne.
    .map((ligne) => ligne.replace(/\s{3,}.*$/, "").trim())
    .map((ligne) => ligne.replace(/\s+/g, " ").trim())
    // « … pendant 1 mois        À renouveler 2 fois » : la consigne est en fin
    // de ligne, elle ne fait pas partie de la posologie.
    .map((ligne) => ligne.replace(/(?:^|\s)[àa]\s+renouveler\b.*$/i, "").trim())
    // Ordonnances numérotées : « 1) », « 2/ », « 1°) », « 3. ».
    .map((ligne) => ligne.replace(MOTIF_NUMERO_LISTE, ""))
    .filter((ligne) => ligne.length > 1 && /[A-Za-zÉÈÀÂÎÔÛÇéèêàâîïôûç]/.test(ligne));

  const blocs = [];
  let bloc = null;
  let lignesAIgnorer = 0;
  lignes.forEach((ligne, index) => {
    if (lignesAIgnorer > 0) {
      lignesAIgnorer -= 1;
      return;
    }
    // « N° RPPS », « N° AM », « Lot »… : la valeur (nom, numéro) est sur la
    // ligne suivante, ce n'est jamais un médicament.
    if (MOTIF_ETIQUETTE.test(ligne)) {
      const suivante = lignes[index + 1] || "";
      if (!/\d{3,}/.test(ligne) && suivante && estValeurIdentifiant(suivante)) lignesAIgnorer = 1;
      return;
    }
    if (estNomDeMedicament(ligne, lignes[index + 1])) {
      if (bloc) blocs.push(bloc);
      const { nom, reste } = separerNomEtPosologie(ligne);
      bloc = { nom: nettoyerNom(nom), details: reste ? [reste] : [] };
    } else if (bloc && !estLigneParasite(ligne) && bloc.details.length < 6) {
      bloc.details.push(ligne);
    } else if (bloc) {
      // Ligne de bruit : la description du médicament s'arrête là, tout ce qui
      // suit (cachet, mentions légales, en-tête suivant) ne lui appartient pas.
      blocs.push(bloc);
      bloc = null;
    }
  });
  if (bloc) blocs.push(bloc);

  for (const element of blocs) {
    const texteBloc = [element.nom, ...element.details].join(" ");
    // Toute la description du médicament, y compris les lignes suivantes
    // (précautions, maximum par jour…), pas seulement la première.
    const description = element.details
      .filter((ligne, position) => element.details.indexOf(ligne) === position)
      .join(" ");
    resultat.medicaments.push({
      nom: nettoyerNom(element.nom).replace(/\s{2,}/g, " "),
      posologie: description ? nettoyerPosologie(description) : "",
      dureeJours: extraireDuree(texteBloc)
    });
  }

  // Repli : aucun nom reconnu, mais une posologie exploitable existe.
  if (!resultat.medicaments.length) {
    const posologie = lignes.find((ligne) => MOTIF_FORME.test(ligne) && MOTIF_RYTHME.test(ligne));
    if (posologie) {
      resultat.medicaments.push({ nom: "", posologie: nettoyerPosologie(posologie), dureeJours: extraireDuree(contenu) });
    }
  }

  const vus = new Set();
  resultat.medicaments = resultat.medicaments.filter((medicament) => {
    const cle = `${medicament.nom}|${medicament.posologie}`;
    if (vus.has(cle)) return false;
    vus.add(cle);
    return true;
  });

  return resultat;
}

/** Résumé textuel de l'état général, pour l'en-tête. */
export function resumer(donnees, aujourdHui = aujourdHuiISO()) {
  const maladies = (donnees && donnees.maladies) || [];
  if (!maladies.length) return "";
  const enCours = maladies.reduce(
    (total, maladie) => total + (maladie.medicaments || []).filter((medicament) => etatMedicament(medicament, aujourdHui) === "en-cours").length,
    0
  );
  const parties = [`${maladies.length} maladie${maladies.length > 1 ? "s" : ""}`];
  if (enCours) parties.push(`${enCours} médicament${enCours > 1 ? "s" : ""} en cours`);
  else parties.push("aucun traitement en cours");
  return parties.join(" · ");
}
