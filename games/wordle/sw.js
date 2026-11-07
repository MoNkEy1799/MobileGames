const CACHE_NAME = "wordle-v2";
const CACHE_ASSETS = [
    "/",
    "/index.html",
    "/manifest.json",
    "/words.js",
    "/img/icon-192.png",
    "/img/icon-512.png",
    "/img/image.svg",
];

self.addEventListener("install", (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(CACHE_ASSETS))
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        Promise.all([
            caches.keys().then(names =>
                Promise.all(
                    names.map(name =>
                        name !== CACHE_NAME ? caches.delete(name) : null
                    )
                )
            ),
            self.clients.claim()
        ])
    );
});

self.addEventListener("fetch", (event) => {
    event.respondWith(
        caches.match(event.request).then((response) => response || fetch(event.request))
    );
});