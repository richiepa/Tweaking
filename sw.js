const CACHE = "tweaking-v8";
const ASSETS = [
  "./",
  "./index.html",
  "./app.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  // cross-origin (song search, artwork, previews) goes straight to the network
  if (new URL(e.request.url).origin !== location.origin) return;
  // Navigations go network-first so a new deploy shows up on the next open;
  // the cache is the offline fallback. Assets stay cache-first (each deploy
  // bumps CACHE, which refreshes them).
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request)
        .then((resp) => {
          if (resp.ok) {
            const copy = resp.clone();
            caches.open(CACHE).then((c) => c.put("./", copy));
          }
          return resp;
        })
        .catch(() => caches.match("./"))
    );
    return;
  }
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(
      (hit) =>
        hit ||
        fetch(e.request)
          .then((resp) => {
            if (resp.ok && new URL(e.request.url).origin === location.origin) {
              const copy = resp.clone();
              caches.open(CACHE).then((c) => c.put(e.request, copy));
            }
            return resp;
          })
          .catch(() => undefined)
    )
  );
});
