// Offline support for Tension. The app shell is cached on install.
// Pages are fetched network-first and always revalidated with the server
// (GitHub Pages caches for 10 minutes), so a new version shows up on the next
// open. Icons and fonts are cache-first. Keep CACHE in step with the
// app-version meta tag in index.html (the tests check this).
const CACHE = "tension-2026.10.07-9";
const CORE = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./icon-maskable-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(CORE.map(u => new Request(u, { cache: "reload" }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const req = e.request;
  // "no-store" requests (the app's check for a new version) always go to the network.
  if (req.method !== "GET" || req.cache === "no-store") return;
  if (req.mode === "navigate") {
    e.respondWith((async () => {
      try {
        // Built from the URL rather than the navigation request itself, which Firefox and
        // Chrome treat differently when options are added.
        const res = await fetch(req.url, { cache: "no-cache", credentials: "same-origin" });
        if (res.redirected) return Response.redirect(res.url, 302);
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put("./index.html", copy)); }
        return res;
      } catch (err) {
        return (await caches.match("./index.html")) || Response.error();
      }
    })());
    return;
  }
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
    if (res.ok || res.type === "opaque") { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  })));
});
