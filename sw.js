const CACHE = "mydo-shell-" + self.registration.scope + "-v1";
const FILES = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "model.js",
  "icon.svg",
  "icon-180.png",
  "icon-192.png",
  "icon-512.png",
  "manifest.webmanifest",
];
const URLS = FILES.map((p) => new URL(p, self.registration.scope).href);
self.addEventListener("install", (event) =>
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(URLS))),
);
// Updates activate once all existing Mydo windows close, keeping each app version consistent.
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (
          key.startsWith("mydo-shell-" + self.registration.scope + "-") &&
          key !== CACHE
        )
          await caches.delete(key);
      await self.clients.claim();
    })(),
  ),
);
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  url.search = "";
  url.hash = "";
  if (!URLS.includes(url.href)) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE),
        cached = await cache.match(url.href);
      return cached || fetch(event.request);
    })(),
  );
});
