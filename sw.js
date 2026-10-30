/* Gangaya Finance Service Worker v43 - instant pre-seeded load, zero delay & live sync */
const CACHE = 'gangaya-v43';
const ASSETS = ['/', '/index.html', '/sitemap.html', '/runtime.js', '/vendor/supabase.js', '/favicon.svg', '/icon-512.jpg', '/scanner.png', '/manifest.json'];

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

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'notify') {
    self.registration.showNotification(e.data.title || 'Gangaya Finance', {
      body: e.data.body || '',
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      vibrate: [250, 120, 250],
      tag: 'gf-alert-' + Date.now(),
      renotify: true
    });
  }
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (const client of windowClients) {
        if ('focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('/');
      }
    })
  );
});

self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  // API calls, sitemap, robots, google verification, and Supabase calls always go to network directly
  if (u.pathname.startsWith('/api/') || u.pathname === '/sitemap.xml' || u.pathname === '/robots.txt' || u.pathname.startsWith('/google') || u.hostname.includes('supabase') || u.hostname.includes('google')) return;

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
