/**
 * MonSuiviOrdo — composants d'interface (web components).
 *
 * Ces éléments normalisent le balisage répété de l'application : une icône, un
 * bouton d'action, une pastille d'état et un champ de formulaire s'écrivent
 * désormais en une balise, avec le même rendu partout.
 *
 *   <icone-tabler nom="pilule" taille="18"></icone-tabler>
 *   <bouton-action action="ajouter-medicament" icone="plus" variante="petit" libelle="Médicament"></bouton-action>
 *   <pastille-statut statut="en-cours">En cours · reste 3 j</pastille-statut>
 *   <champ-formulaire libelle="Nom" nom="nom" maxlength="80" requis></champ-formulaire>
 *
 * Les hôtes sont en « display: contents » : ils ne créent aucune boîte, leur
 * contenu réel participe directement à la mise en page du parent (flex, grid).
 * La classe de l'hôte est recopiée sur l'élément rendu, ce qui laisse les
 * styles existants (.carte__poignee, …) s'appliquer normalement.
 */

const SVG = "http://www.w3.org/2000/svg";

const iconesSignalees = new Set();

/** Crée un élément SVG dans le bon espace de noms. */
function svg(nom, attributs = {}) {
  const element = document.createElementNS(SVG, nom);
  for (const [cle, valeur] of Object.entries(attributs)) element.setAttribute(cle, valeur);
  return element;
}

/**
 * Base commune : le contenu écrit dans la balise (libellé, texte de la pastille)
 * n'existe pas encore au moment où l'élément est connecté s'il vient du HTML de
 * la page — le parseur insère l'élément avant ses enfants. On attend donc la fin
 * du chargement du document dans ce cas, et une microtâche sinon (contenu inséré
 * par l'application).
 */
class Composant extends HTMLElement {
  connectedCallback() {
    if (this._pret) {
      this.rendre();
      return;
    }
    const finaliser = () => {
      this._pret = true;
      this.rendre();
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", finaliser, { once: true });
    } else {
      queueMicrotask(finaliser);
    }
  }
}

/* ------------------------------------------------------------------ icône */

class IconeTabler extends Composant {
  static observedAttributes = ["nom", "taille", "libelle"];

  attributeChangedCallback() {
    if (this._pret) this.rendre();
  }

  rendre() {
    const nom = (this.getAttribute("nom") || "").trim();
    if (!nom) return;

    const taille = (this.getAttribute("taille") || "").trim();
    if (taille) {
      this.style.setProperty("--taille-icone", /^\d+(?:\.\d+)?$/.test(taille) ? `${taille}px` : taille);
    } else {
      this.style.removeProperty("--taille-icone");
    }

    const libelle = (this.getAttribute("libelle") || "").trim();
    const dessin = svg("svg", {
      viewBox: "0 0 24 24",
      focusable: "false",
      "aria-hidden": libelle ? "false" : "true",
      class: `icone ${this.className || ""}`.trim()
    });
    if (libelle) {
      dessin.setAttribute("role", "img");
      dessin.setAttribute("aria-label", libelle);
    }
    dessin.appendChild(svg("use", { href: `#ico-${nom}` }));

    // Un nom absent de la sprite donne un dessin vide : mieux vaut le dire une
    // fois dans la console que de livrer un trou dans l'interface.
    if (!iconesSignalees.has(nom) && !document.getElementById(`ico-${nom}`)) {
      iconesSignalees.add(nom);
      console.warn(`Icône inconnue : « ${nom} » (absente de src/_includes/sprite-icones.svg)`);
    }

    this.replaceChildren(dessin);
  }
}

/* ------------------------------------------------------------------ bouton */

class BoutonAction extends Composant {
  static observedAttributes = ["action", "icone", "variante", "type", "libelle", "icone-taille", "desactive"];

  connectedCallback() {
    if (this._libelle === undefined) this._libelle = this.textContent.trim();
    super.connectedCallback();
  }

  attributeChangedCallback() {
    if (this._pret) this.rendre();
  }

  get libelle() {
    return this.getAttribute("libelle") ?? this._libelle ?? "";
  }

  set libelle(texte) {
    this.setAttribute("libelle", texte);
  }

  rendre() {
    if (this._libelle === undefined) this._libelle = this.textContent.trim();

    const variantes = (this.getAttribute("variante") || "")
      .split(/\s+/)
      .filter(Boolean)
      .map((variante) => `bouton--${variante}`);

    const bouton = document.createElement("button");
    bouton.type = this.getAttribute("type") || "button";
    bouton.className = ["bouton", ...variantes, this.className || ""].filter(Boolean).join(" ");

    const action = this.getAttribute("action");
    if (action) bouton.dataset.action = action;

    const nomIcone = this.getAttribute("icone");
    if (nomIcone) {
      const dessin = document.createElement("icone-tabler");
      dessin.setAttribute("nom", nomIcone);
      dessin.setAttribute("taille", this.getAttribute("icone-taille") || "16");
      bouton.appendChild(dessin);
    }

    const zoneLibelle = document.createElement("span");
    zoneLibelle.className = "bouton__libelle";
    zoneLibelle.textContent = this.libelle;
    bouton.appendChild(zoneLibelle);

    if (this.hasAttribute("desactive")) bouton.disabled = true;
    this.replaceChildren(bouton);
  }
}

/* --------------------------------------------------------------- pastille */

const ICONES_STATUT = { attente: "attente", "en-cours": "en-cours", termine: "termine" };

class PastilleStatut extends Composant {
  static observedAttributes = ["statut"];

  connectedCallback() {
    if (this._contenu === undefined) this._contenu = Array.from(this.childNodes);
    super.connectedCallback();
  }

  attributeChangedCallback() {
    if (this._pret) this.rendre();
  }

  rendre() {
    if (this._contenu === undefined) this._contenu = Array.from(this.childNodes);
    const statut = (this.getAttribute("statut") || "attente").trim();

    const pastille = document.createElement("span");
    pastille.className = ["pastille", `pastille--${statut}`, this.className || ""].filter(Boolean).join(" ");

    const nomIcone = ICONES_STATUT[statut];
    if (nomIcone) {
      const dessin = document.createElement("icone-tabler");
      dessin.setAttribute("nom", nomIcone);
      dessin.setAttribute("taille", "13");
      pastille.appendChild(dessin);
    }

    const texte = document.createElement("span");
    texte.className = "pastille__texte";
    texte.append(...this._contenu);
    pastille.appendChild(texte);

    this.replaceChildren(pastille);
  }
}

/* ------------------------------------------------------------------ champ */

// Attributs de saisie recopiés tels quels de l'hôte vers le champ rendu.
const ATTRIBUTS_SAISIE = [
  "type", "placeholder", "maxlength", "min", "max", "step", "inputmode",
  "autocomplete", "pattern", "rows", "value"
];

class ChampFormulaire extends Composant {
  static observedAttributes = ["libelle", "nom", "zone", "requis", "aide"];

  attributeChangedCallback() {
    if (this._pret) this.rendre();
  }

  rendre() {
    const zone = this.hasAttribute("zone");
    const label = document.createElement("label");
    label.className = "champ";

    const libelle = document.createElement("span");
    libelle.className = "champ__libelle";
    libelle.textContent = this.getAttribute("libelle") || "";
    label.appendChild(libelle);

    const champ = document.createElement(zone ? "textarea" : "input");
    champ.className = `champ__saisie${zone ? " champ__saisie--zone" : ""}`;
    const nom = this.getAttribute("nom");
    if (nom) champ.name = nom;
    for (const attribut of ATTRIBUTS_SAISIE) {
      if (this.hasAttribute(attribut)) champ.setAttribute(attribut, this.getAttribute(attribut));
    }
    if (this.hasAttribute("requis")) champ.required = true;
    label.appendChild(champ);

    const aide = this.getAttribute("aide");
    if (aide) {
      const note = document.createElement("span");
      note.className = "champ__aide";
      note.textContent = aide;
      label.appendChild(note);
    }

    this.replaceChildren(label);
  }
}

if (!customElements.get("icone-tabler")) customElements.define("icone-tabler", IconeTabler);
if (!customElements.get("bouton-action")) customElements.define("bouton-action", BoutonAction);
if (!customElements.get("pastille-statut")) customElements.define("pastille-statut", PastilleStatut);
if (!customElements.get("champ-formulaire")) customElements.define("champ-formulaire", ChampFormulaire);
