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

  const title = data.title || "إشعار جديد";

  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "وصل إشعار جديد",
      icon: "/k/ico1.png",
      badge: "/k/ico2.png",
      image: data.image || undefined,
      tag: data.tag || "k-alert",
      renotify: true,
      data: {
        url: data.url || "/k/"
      }
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = event.notification?.data?.url || "/k/";

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
