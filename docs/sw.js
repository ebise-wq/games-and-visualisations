// Service worker: keeps a copy of the arcade on the device so it opens offline.
// Bump VERSION whenever any page changes, so devices fetch the new files.
const VERSION = "arcade-v8";
const CORE = [
  "./", "index.html", "manifest.json", "pwa.js", "limit.js",
  "InfluenceFloodGlobe.html", "InfluenceFloodRace.html", "MazeRunner.html",
  "BoomBust.html", "TruthOrDrink.html",
  "img/globe-2.jpg", "img/race-2.jpg", "img/maze-2.jpg", "img/boombust-2.jpg", "img/truth-2.jpg",
  "icons/icon-192.png", "icons/apple-touch-icon.png",
  "https://cdn.tailwindcss.com/3.4.16",
  "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) =>
    // cache.add() rejects cross-origin (opaque) responses, so fetch and store by hand.
    Promise.all(CORE.map((url) => {
      const req = new Request(url, { mode: url.startsWith("http") ? "no-cors" : "same-origin", cache: "reload" });
      return fetch(req).then((res) => (res.ok || res.type === "opaque") && c.put(req, res)).catch(() => {});
    }))
  ).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
  ).then(() => self.clients.claim()));
});

// Serve from the cache straight away, and refresh the cached copy in the background.
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(caches.open(VERSION).then(async (cache) => {
    const cached = await cache.match(e.request, { ignoreSearch: true });
    const fresh = fetch(e.request).then((res) => {
      if (res && (res.ok || res.type === "opaque")) cache.put(e.request, res.clone());
      return res;
    }).catch(() => cached);
    return cached || fresh;
  }));
});
