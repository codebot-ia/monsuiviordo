/* MonSuiviOrdo — service worker : application disponible hors ligne. */
const RACINE = new URL("./", self.location).pathname;

// La préprod (sous-dossier GitHub Pages) partage l'origine avec la prod : les
// caches doivent donc être préfixés par le périmètre, sinon les deux versions
// se marcheraient dessus.
const PERIMETRE = RACINE.replace(/^\/+/, "").replace(/\/+$/, "").replace(/\//g, "-");
const BASE_CACHE = "monsuiviordo-v1.12.2";
// Préfixe des caches de CE périmètre : la prod (« monsuiviordo-v… ») ne touche
// jamais aux caches de la préprod (« monsuiviordo-preprod@monsuiviordo-v… »).
const PREFIXE_CACHE = PERIMETRE ? `${PERIMETRE}@monsuiviordo-v` : "monsuiviordo-v";
const VERSION = PERIMETRE ? `${PERIMETRE}@${BASE_CACHE}` : BASE_CACHE;

const FICHIERS_APPLICATION = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./assets/style.css",
  "./assets/app.js",
  "./assets/composants.js",
  "./assets/logique.js",
  "./assets/traitement-image.js",
  "./assets/scan.js",
  "./assets/cadrage.js",
  "./assets/icone-192.png",
  "./assets/icone-512.png",
  "./assets/ocr/tesseract.min.js",
  "./assets/ocr/worker.min.js"
];

self.addEventListener("install", (evenement) => {
  evenement.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(FICHIERS_APPLICATION))
      .then(() => self.skipWaiting())
      .catch((erreur) => console.warn("Pré-cache incomplet", erreur))
  );
});

self.addEventListener("activate", (evenement) => {
  evenement.waitUntil(
    caches
      .keys()
      .then((noms) => Promise.all(
        noms
          .filter((nom) => nom.startsWith(PREFIXE_CACHE) && nom !== VERSION)
          .map((nom) => caches.delete(nom))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (evenement) => {
  const requete = evenement.request;
  if (requete.method !== "GET") return;

  const url = new URL(requete.url);
  const memeOrigine = url.origin === self.location.origin;

  // Navigation : réseau d'abord, cache en secours (fonctionne hors ligne).
  if (requete.mode === "navigate") {
    // Seule la page racine de ce périmètre nous concerne : un sous-dossier
    // (préprod) est une autre application, avec son propre service worker.
    const pageRacine = url.pathname === RACINE || url.pathname === `${RACINE}index.html`;
    if (!pageRacine) return;
    evenement.respondWith(
      fetch(requete)
        .then((reponse) => {
          const copie = reponse.clone();
          caches.open(VERSION).then((cache) => cache.put("./index.html", copie));
          return reponse;
        })
        .catch(() => caches.match("./index.html").then((cache) => cache || caches.match("./")))
    );
    return;
  }

  // Ressources d'un sous-dossier (préprod) : gérées par le service worker de
  // ce sous-dossier, jamais mises en cache par celui de la prod.
  if (url.pathname.startsWith(`${RACINE}preprod/`)) return;

  if (!memeOrigine) {
    // Ressources externes (moteur OCR) : cache après le premier téléchargement.
    if (/jsdelivr|unpkg|tessdata|tesseract/i.test(url.hostname + url.pathname)) {
      evenement.respondWith(
        caches.match(requete).then(
          (enCache) =>
            enCache ||
            fetch(requete).then((reponse) => {
              const copie = reponse.clone();
              caches.open(VERSION).then((cache) => cache.put(requete, copie));
              return reponse;
            })
        )
      );
    }
    return;
  }

  // Ressources locales : cache immédiat, mise à jour en arrière-plan
  // (l'utilisateur voit la version en cache, le réseau rafraîchit pour la visite suivante).
  evenement.respondWith(
    caches.match(requete).then((enCache) => {
      const depuisReseau = fetch(requete)
        .then((reponse) => {
          const copie = reponse.clone();
          caches.open(VERSION).then((cache) => cache.put(requete, copie));
          return reponse;
        })
        .catch(() => enCache);
      return enCache || depuisReseau;
    })
  );
});

// Le préfixe sert au périmètre du service worker (sous-dossier GitHub Pages).
self.MONSUIVIORO_RACINE = RACINE;
