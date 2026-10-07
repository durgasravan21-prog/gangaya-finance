/* Gangaya Finance Service Worker - enables offline caching and PWA install */
const CACHE = 'gangaya-v1';
const ASSETS = ['/', '/index.html', '/runtime.js', '/vendor/supabase.js', '/favicon.svg', '/icon-512.jpg', '/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  // API calls and Supabase calls always go to network
  if (u.pathname.startsWith('/api/') || u.hostname.includes('supabase')) return;
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).then(resp => {
      if (resp.ok && e.request.method === 'GET') {
        const cl = resp.clone();
        caches.open(CACHE).then(c => c.put(e.request, cl));
      }
      return resp;
    }))
  );
});
