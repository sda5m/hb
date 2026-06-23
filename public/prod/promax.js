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

  const title = data.title || "تنبيه جديد";
  const notifIcon = data.image || "/prod/ico1.png";

  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "وصل إشعار جديد",
      icon: notifIcon,
      badge: "/prod/ico2.png",
      tag: data.tag || "prod-alert",
      renotify: true,
      data: {
        url: data.url || "/prod/"
      }
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = event.notification?.data?.url || "/prod/";

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
