self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  const fallback = {
    title: 'Powiadomienie ERP',
    body: 'Pojawila sie aktualizacja dokumentu ERP.',
    url: '/przesuniecia-magazynowe',
    tag: 'erp-document-update'
  };

  let payload = fallback;
  if (event.data) {
    try {
      const data = event.data.json();
      payload = {
        ...fallback,
        ...data
      };
    } catch {
      const text = event.data.text();
      if (text) {
        payload = {
          ...fallback,
          body: text
        };
      }
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/logo.png',
      badge: '/logo.png',
      data: {
        url: payload.url
      },
      tag: payload.tag,
      renotify: true
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const rawUrl = event.notification?.data?.url;
  const targetUrl = rawUrl && typeof rawUrl === 'string' ? rawUrl : '/przesuniecia-magazynowe';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (!client || typeof client.url !== 'string') continue;
        if (client.url.includes(targetUrl)) {
          return client.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});
