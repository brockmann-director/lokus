// Lokus Service Worker: App und Daten offline verfügbar.
// App-Dateien: erst Netz, sonst Speicher. Toiletten-Daten: Speicher sofort, im Hintergrund auffrischen.
// Kartenbilder: aus dem Speicher, wenn schon einmal geladen (höchstens ~3000 Stück).
const V = "lokus-1.2";
const SHELL = ["./", "index.html", "style.css?v=1", "app.js?v=1", "oh.js?v=1", "config.js?v=1", "vendor/leaflet.js?v=1.9.4", "vendor/leaflet.css?v=1.9.4",
  "icon.svg", "icon-192.png", "apple-touch-icon.png", "manifest.webmanifest",
  "vendor/fonts/atkinson-hyperlegible-latin-400-normal.woff2", "vendor/fonts/atkinson-hyperlegible-latin-700-normal.woff2", "vendor/fonts/bricolage-grotesque-latin-800-normal.woff2"];
self.addEventListener("install", e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("lokus-") && k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
async function trim(name, max) {
  const c = await caches.open(name), ks = await c.keys();
  for (let i = 0; i < ks.length - max; i++) await c.delete(ks[i]);
}
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (u.hostname === "tile.openstreetmap.org") {
    e.respondWith(caches.open("lokus-karte").then(async c => {
      const hit = await c.match(e.request); if (hit) return hit;
      const r = await fetch(e.request); if (r.ok) { c.put(e.request, r.clone()); if (Math.random() < 0.02) trim("lokus-karte", 3000); }
      return r;
    }));
    return;
  }
  if (u.origin !== location.origin) return;
  if (u.pathname.includes("/data/t/")) {
    e.respondWith(caches.open("lokus-daten").then(async c => {
      const hit = await c.match(e.request);
      const net = fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) { const cp = r.clone(); caches.open(V).then(c => c.put(e.request, cp)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: u.pathname.endsWith("/") || u.pathname.endsWith("index.html") })));
});
