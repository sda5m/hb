self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};

  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  const title = data.title || "طلب جديد";

  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "وصل إشعار جديد",
      icon: "/btcm/512.png",
      badge: "/btcm/192.png",
      tag: data.tag || "btcm-test",
      renotify: true,
      data: {
        url: data.url || "/btcm/"
      }
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = event.notification?.data?.url || "/btcm/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        try {
          return client.navigate(url).then(() => client.focus());
        } catch {}
      }

      return clients.openWindow(url);
    })
  );
});
