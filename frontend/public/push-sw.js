/* HL Central browser push (Nov 2026 plan, E7): show what the server sends,
   and open the task when it is clicked. */
self.addEventListener('push', (event) => {
  let msg = { title: 'HL Central', body: '', url: '/' };
  try {
    msg = { ...msg, ...event.data.json() };
  } catch {
    /* plain text or nothing */
  }
  event.waitUntil(
    self.registration.showNotification(msg.title, {
      body: msg.body,
      icon: '/favicon.svg',
      data: { url: msg.url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c && c.url.startsWith(self.location.origin)) {
          c.navigate(url);
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
