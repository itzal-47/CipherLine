// ============================================================
// Service Worker — CipherLine
// Versão: incrementar sempre que alterares este ficheiro,
// para forçar a atualização nos clientes já instalados.
// ============================================================
const SW_VERSION = 'v1.1.0';
console.log(`[SW] CipherLine SW carregado — ${SW_VERSION}`);

// Instala e passa a controlar imediatamente (sem esperar que a aba feche)
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// Toma controlo dos clientes já abertos
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
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