/* MonSuiviOrdo — service worker : application disponible hors ligne. */
const RACINE = new URL("./", self.location).pathname;

// La préprod (sous-dossier GitHub Pages) partage l'origine avec la prod : les
// caches doivent donc être préfixés par le périmètre, sinon les deux versions
// se marcheraient dessus.
const PERIMETRE = RACINE.replace(/^\/+/, "").replace(/\/+$/, "").replace(/\//g, "-");
const BASE_CACHE = "monsuiviordo-v1.13.2";
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
  // « cache: reload » : le pré-cache doit lire le réseau, pas la copie HTTP que
  // le navigateur garde quelques minutes — sinon une mise en ligne récente est
  // figée dans le cache du service worker dès l'installation.
  evenement.waitUntil(
    caches
      .open(VERSION)
      .then((cache) =>
        Promise.all(
          FICHIERS_APPLICATION.map((fichier) =>
            fetch(new URL(fichier, self.location).href, { cache: "reload" })
              .then((reponse) => (reponse && reponse.ok ? cache.put(fichier, reponse) : null))
              .catch((erreur) => console.warn("Pré-cache incomplet :", fichier, erreur))
          )
        )
      )
      .then(() => self.skipWaiting())
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

  // Moteur OCR (plusieurs mégaoctets, jamais modifié entre deux versions) :
  // cache d'abord.
  if (/\/assets\/ocr\//.test(url.pathname)) {
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
    return;
  }

  // Reste de l'application (HTML, JS, CSS, manifeste) : réseau d'abord, sans
  // passer par le cache HTTP du navigateur — une mise en ligne est ainsi visible
  // au rechargement suivant, même quand un module importé n'a pas de « ?v= ».
  // Le cache ne sert qu'en secours, hors ligne.
  evenement.respondWith(
    fetch(requete, { cache: "no-store" })
      .then((reponse) => {
        const copie = reponse.clone();
        caches.open(VERSION).then((cache) => cache.put(requete, copie));
        return reponse;
      })
      .catch(() => caches.match(requete).then((enCache) => enCache || Response.error()))
  );
});

// Le préfixe sert au périmètre du service worker (sous-dossier GitHub Pages).
self.MONSUIVIORO_RACINE = RACINE;
