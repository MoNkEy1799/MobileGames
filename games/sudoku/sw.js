const CACHE_NAME = 'sudoku-v2';
const FILES = [
  '/',
  '/index.html',
  '/manifest.json',
  '/puzzles.js',
  '/img/icon-192.png',
  '/img/icon-512.png',
  '/img/image.svg',
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(FILES)));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(caches.match(event.request).then(r => r || fetch(event.request)));
});