const CACHE_VERSION = 'my-assistant-v1.6.1';
const CORE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon.svg',
  '/logo.png',
  '/apple-touch-icon.png',
  '/pwa-192x192.png',
  '/pwa-512x512.png',
  '/pwa-maskable-512x512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then(async (cache) => {
        await cache.addAll(CORE_ASSETS);
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (!url.protocol.startsWith('http')) return;
  if (url.pathname.startsWith('/@vite') || url.pathname.startsWith('/@fs')) return;

  // Navigation requests: network-first with instant cached /index.html fallback when offline
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.ok) {
            const copy = networkResponse.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put('/index.html', copy));
          }
          return networkResponse;
        })
        .catch(async () => {
          const cached = await caches.match('/index.html');
          return cached || caches.match('/');
        })
    );
    return;
  }

  // Stale-while-revalidate for static assets and cached external resources
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const fetchPromise = fetch(request)
        .then((networkResponse) => {
          if (
            networkResponse &&
            (networkResponse.ok || networkResponse.type === 'opaque')
          ) {
            const copy = networkResponse.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});

// Background & Lock-Screen Persistent Notification Handlers
self.addEventListener('message', (event) => {
  const payload = event.data || {};
  if (payload.type === 'SHOW_TASK_NOTIFICATION' && payload.title) {
    event.waitUntil(
      self.registration.showNotification(payload.title, {
        body: payload.body || '',
        icon: '/pwa-192x192.png',
        badge: '/pwa-192x192.png',
        tag: payload.tag || 'routine-reminder',
        renotify: true,
        requireInteraction: true,
        vibrate: [300, 140, 300, 140, 480],
        data: { taskId: payload.taskId || '' },
        actions: [
          { action: 'done', title: 'হ্যাঁ, করেছি' },
          { action: 'snooze', title: '১০ মিনিট পর' }
        ]
      })
    );
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const action = event.action || 'open';
  const taskId = (event.notification.data && event.notification.data.taskId) || '';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      if (clientList.length > 0) {
        const client = clientList[0];
        if (action === 'done' || action === 'snooze') {
          client.postMessage({ type: 'NOTIFICATION_ACTION', action, taskId });
        }
        if (action === 'open' && 'focus' in client) {
          return client.focus();
        }
        return Promise.resolve();
      }
      const targetUrl =
        action === 'done' || action === 'snooze'
          ? `/?action=${encodeURIComponent(action)}&taskId=${encodeURIComponent(taskId)}`
          : '/';
      return self.clients.openWindow(targetUrl);
    })
  );
});
