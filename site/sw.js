// LostTimes — service worker.
//
// MIKS SEE OLEMAS ON:
// Kasutaja seisab finišialal, kus on üks pulk levi ja kakssada inimest vaatavad
// korraga telefoni. Just siis peab leht avanema. Service worker hoiab lehe ja
// viimati laetud tulemused telefonis, nii et avamine ei sõltu võrgust.
//
// Kolm erinevat strateegiat, sest kolme sorti asja käituvad erinevalt:
//
//   1. Leht ise ja ikoonid  — vahemälust kohe (muutub harva)
//   2. Andmed (JSON)        — vahemälust kohe, värskendus taustal
//   3. Võõrad domeenid      — ei puutu üldse (ChampionChip, racetecresults jne)

const VERSION = 'losttimes-v1';
const SHELL = `${VERSION}-shell`;
const DATA = `${VERSION}-data`;

// Leht peab olema kasutatav ka siis, kui seda pole kunagi varem avatud
// võrguga — seepärast paneme kesta kohe paigaldamisel salve.
const SHELL_FILES = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.ico',
  '/apple-touch-icon.png',
  '/icon-192.png',
  '/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      // Üksik puuduv fail ei tohi kogu paigaldust nurjata.
      .then((cache) => Promise.allSettled(SHELL_FILES.map((f) => cache.add(f))))
      .then(() => self.skipWaiting())
  );
});

// Vana versiooni vahemälu koristame ära, muidu kogunevad need telefoni.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(
        keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Võõraid domeene me ei vahenda. Kui kasutaja vajutab "Results", peab ta
  // saama päris, värske lehe — mitte meie salvestatud koopia.
  if (url.origin !== self.location.origin) return;

  // 1. Navigeerimine: proovime võrku, aga kukume kohe lehe koopiale.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          caches.open(SHELL).then((c) => c.put('/index.html', res.clone()));
          return res;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // 2. Andmed: näita kohe salvestatut, tõmba värske taustal.
  //    Nii on avamine hetkeline ja järgmisel korral on andmed uued.
  if (url.pathname.endsWith('.json')) {
    event.respondWith(
      caches.open(DATA).then(async (cache) => {
        const cached = await cache.match(request);
        const fresh = fetch(request)
          .then((res) => {
            if (res.ok) cache.put(request, res.clone());
            return res;
          })
          .catch(() => null);
        return cached || fresh || new Response('[]', { headers: { 'Content-Type': 'application/json' } });
      })
    );
    return;
  }

  // 3. Ülejäänu (ikoonid, fondid): vahemälust, muidu võrgust ja salve.
  event.respondWith(
    caches.match(request).then((cached) =>
      cached ||
      fetch(request).then((res) => {
        if (res.ok) caches.open(SHELL).then((c) => c.put(request, res.clone()));
        return res;
      })
    )
  );
});
