/* Gangaya Finance Service Worker - enables offline caching and PWA install */
const CACHE = 'gangaya-v2';
const ASSETS = ['/', '/index.html', '/runtime.js', '/vendor/supabase.js', '/favicon.svg', '/icon-512.jpg', '/manifest.json'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS))
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  // API calls and Supabase calls always go to network directly
  if (u.pathname.startsWith('/api/') || u.hostname.includes('supabase')) return;

  // For HTML pages and runtime.js: Network First (fetch fresh from server, fallback to cache when offline)
  if (e.request.mode === 'navigate' || u.pathname === '/' || u.pathname.endsWith('.html') || u.pathname.endsWith('.js')) {
    e.respondWith(
      fetch(e.request)
        .then(resp => {
          if (resp && resp.ok && e.request.method === 'GET') {
            const cl = resp.clone();
            caches.open(CACHE).then(c => c.put(e.request, cl));
          }
          return resp;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // For static assets (images, fonts, manifest): Cache First
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).then(resp => {
      if (resp && resp.ok && e.request.method === 'GET') {
        const cl = resp.clone();
        caches.open(CACHE).then(c => c.put(e.request, cl));
      }
      return resp;
    }))
  );
});
