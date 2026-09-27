const CACHE = "mydo-shell-" + self.registration.scope + "-v2";
const FILES = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "model.js",
  "reminders.js",
  "push-client.js",
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

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data?.json() || {};
  } catch {}
  const title =
    typeof data.title === "string" ? data.title.slice(0, 150) : "Mydo";
  const body =
    typeof data.body === "string"
      ? data.body.slice(0, 250)
      : "You have a task reminder. / 你有一項任務提醒。";
  const taskId =
    typeof data.taskId === "string" ? data.taskId.slice(0, 100) : "";
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: new URL("icon-192.png", self.registration.scope).href,
      badge: new URL("icon-192.png", self.registration.scope).href,
      tag:
        typeof data.tag === "string" ? data.tag.slice(0, 250) : "mydo-reminder",
      data: { taskId },
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const taskId = event.notification.data?.taskId || "";
  const target = new URL("./", self.registration.scope);
  target.hash = "all";
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const existing = windows.find((c) =>
        c.url.startsWith(self.registration.scope),
      );
      if (existing) {
        await existing.focus();
        existing.postMessage({ type: "mydo-open-task", taskId });
      } else {
        target.searchParams.set("task", taskId);
        await self.clients.openWindow(target.href);
      }
    })(),
  );
});
