const CACHE = 'tortirappi-v2';
const ASSETS = [
  '/',
  '/login.html',
  '/registro.html',
  '/admin.html',
  '/repartidor.html',
  '/tracking.html',
  '/css/style.css',
  '/js/config.js',
  '/js/auth.js',
  '/js/admin.js',
  '/js/repartidor.js',
  '/js/tracking.js',
  '/js/offline-queue.js',
  '/js/maps-loader.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS).catch(() => {})));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  if (url.hostname.includes('supabase.co') || url.hostname.includes('googleapis.com')) {
    return;
  }

  // Network-first para HTML (siempre obtener última versión)
  if (e.request.mode === 'navigate' || url.pathname.endsWith('.html')) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request).then(c => c || caches.match('/login.html')))
    );
    return;
  }

  // Cache-first para assets estáticos (CSS, JS, imágenes)
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (!res || res.status !== 200 || res.type !== 'basic') return res;
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      }).catch(() => caches.match('/login.html'));
    })
  );
});
