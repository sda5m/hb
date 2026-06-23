const CACHE = "pwa-v111";
const ASSETS = [
  "/driver.html",
  "/bt.html",
  "/manifest.json",
  "/ico1.png",
  "/ico2.png"
];

// كاش للصفحات الأساسية (بدون index.html)
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // ✅ الصفحة الرئيسية دائمًا من الشبكة
  if (
    url.origin === location.origin &&
    (url.pathname === "/" || url.pathname === "/index.html")
  ) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match("/driver.html"))
    );
    return;
  }

  // ✅ لا تكاش أي API نهائيًا
  if (
    url.origin === location.origin &&
    url.pathname.startsWith("/api/")
  ) {
    e.respondWith(
      fetch(e.request, { cache: "no-store" })
    );
    return;
  }

  // ✅ أي طلب غير GET لا يدخل الكاش
  if (e.request.method !== "GET") {
    e.respondWith(fetch(e.request));
    return;
  }

  // ✅ باقي الملفات فقط (صور / css / html)
  e.respondWith(
    caches.match(e.request).then((r) => r || fetch(e.request))
  );
});
