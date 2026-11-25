// ============================================================
// Service Worker — CipherLine
// Versão: incrementar sempre que alterares este ficheiro,
// para forçar a atualização nos clientes já instalados.
// ============================================================
const SW_VERSION = 'v1.2.0';
const CACHE_NAME = `cipherline-static-${SW_VERSION}`;
const SHELL_URLS = ['/', '/manifest.webmanifest', '/favicon.svg', '/icon-192.png', '/offline.html'];
const STATIC_URLS = new Set([
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
  '/apple-touch-icon.png',
]);

function isEligibleRequest(request, url) {
  return request.method === 'GET' &&
    url.origin === self.location.origin &&
    !request.headers.has('Authorization');
}

function isSuccessfulResponse(response) {
  return response.ok && response.status === 200;
}

async function cacheSuccessfulResponse(cache, key, response) {
  if (isSuccessfulResponse(response)) {
    await cache.put(key, response.clone());
  }
  return response;
}

// Instala e passa a controlar imediatamente (sem esperar que a aba feche)
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS)),
  );
  self.skipWaiting();
});

// Toma controlo dos clientes já abertos
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => Promise.all(
        cacheNames
          .filter((cacheName) => cacheName.startsWith('cipherline-') && cacheName !== CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName)),
      ))
      .then(() => self.clients.claim()),
  );
});

// ---------- Cache restrita ao shell e aos estáticos da aplicação ----------
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (!isEligibleRequest(request, url)) return;

  // Fontes e conteúdo de mídia não fazem parte do cache offline da aplicação.
  if (['font', 'audio', 'video'].includes(request.destination)) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (url.search === '') {
          const cache = await caches.open(CACHE_NAME);
          await cacheSuccessfulResponse(cache, '/', response);
        }
        return response;
      } catch {
        const cache = await caches.open(CACHE_NAME);
        const shell = await cache.match('/');
        if (shell) return shell;
        return (await cache.match('/offline.html')) || Response.error();
      }
    })());
    return;
  }

  // A query pode conter o código de convite; nunca consultar nem gravar essa URL.
  if (url.search !== '') return;

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      if (cached) return cached;

      const response = await fetch(request);
      return cacheSuccessfulResponse(cache, request, response);
    })());
    return;
  }

  if (STATIC_URLS.has(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      const update = fetch(request).then((response) =>
        cacheSuccessfulResponse(cache, request, response),
      );

      if (cached) {
        event.waitUntil(update.catch(() => {}));
        return cached;
      }

      return update;
    })());
  }
});

// ---------- Notificações push ----------
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'CIPHERLINE', body: 'Nova mensagem' };
  }

  const title = data.title || 'CIPHERLINE';
  const body = data.body || 'Nova mensagem recebida';
  const roomCode = data.roomCode || null;
  const tag = data.tag || 'cipherline-message';

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      tag,
      renotify: true,
      data: { url: roomCode ? `/?room=${encodeURIComponent(roomCode)}` : '/' },
    }),
  );
});

// ---------- Click na notificação ----------
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Se já existe uma janela aberta, foca-a e navega
      for (const client of clientList) {
        if ('focus' in client) {
          if ('navigate' in client) {
            client.navigate(targetUrl).catch(() => {});
          }
          return client.focus();
        }
      }
      // Senão, abre nova janela
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    }),
  );
});
