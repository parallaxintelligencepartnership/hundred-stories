// Loaded into the game's service worker (vite.config.ts workbox importScripts). A tap on one of
// the game's notifications (src/ui/notify.ts) brings the game's tab forward and tells it which
// kind was tapped, so an alert can open the news; with no game tab open it opens the game.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const kind = event.notification.data && event.notification.data.kind;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const game = windows.find((client) => new URL(client.url).pathname.startsWith('/play/')) || windows[0];
      if (game) {
        await game.focus();
        game.postMessage({ type: 'hs-notification', kind });
        return;
      }
      await self.clients.openWindow('/play/');
    })(),
  );
});
