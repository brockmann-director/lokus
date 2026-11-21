// Lokus – nächste Toilette finden. Daten: OpenStreetMap (wöchentlich als Kacheln in data/),
// gemeinsame Bewertungen/Notizen/Favoriten der Familie über Supabase (lk_*-Funktionen).
"use strict";
const VERSION = "1.2", BUILD = "__BUILD__";

// ---------- Kleinkram ----------
const $ = id => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem("lk_" + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("lk_" + k, JSON.stringify(v)); } catch (e) { } }
};
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const TOILET = '<svg viewBox="0 0 24 24"><path d="M6 3h4v7h9a1 1 0 0 1 1 1c0 3.5-2.4 6.2-6 6.9V21H8v-4.3C5.6 15.6 4 13.4 4 11a1 1 0 0 1 1-1h1z"/></svg>';
const CUP = '<svg viewBox="0 0 24 24"><path d="M4 7h13v6a6 6 0 0 1-6 6h-1a6 6 0 0 1-6-6zM17 9h1.6a2.6 2.6 0 0 1 0 5.2H17v-2h1.6a.6.6 0 0 0 0-1.2H17z"/></svg>';
const STAR = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.3L12 17.1l-5.7 3.1 1.2-6.3L2.8 9.5l6.4-.8z"/></svg>';
const SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const MOON = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/></svg>';
const B = { FREE: 1, PAID: 2, WC_YES: 4, WC_LIMITED: 8, WC_NO: 16, BABY_YES: 32, BABY_NO: 64, CUSTOMERS: 128, UNISEX: 256 };
const IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

function distM(a, b) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
const walkMin = m => Math.max(1, Math.round(m * 1.25 / 75)); // Umweg-Faktor, gemütliches Tempo
const fmtDist = m => m < 1000 ? Math.round(m / 10) * 10 + " m" : (m / 1000).toFixed(m < 10000 ? 1 : 0).replace(".", ",") + " km";
let toastT;
function toast(msg) {
  document.querySelector(".toast")?.remove();
  const d = document.createElement("div"); d.className = "toast"; d.setAttribute("role", "status"); d.textContent = msg;
  document.body.append(d); clearTimeout(toastT); toastT = setTimeout(() => d.remove(), 2600);
}

// ---------- Zustand ----------
const S = {
  index: null, tiles: new Map(), loading: new Set(),
  places: new Map(),        // id -> Toilette oder weiterer Ort
  me: null, meAcc: null, follow: true, geoErr: null,
  filters: new Set(store.get("filters", [])), more: store.get("more", true), sel: null,
  group: { me: null, ratings: [], favs: [], gone: [] }, groupErr: null,
};
const params = new URLSearchParams(location.search);
let token = params.get("k");
if (token) store.set("token", token); else token = store.get("token", null);
const invite = params.get("einladung");

// iOS startet das Homebildschirm-Symbol mit eigenem Speicher: Schlüssel in die Start-Adresse
function linkManifest() {
  if (!token) return;
  const base = new URL("./", location.href).href, start = base + "?k=" + encodeURIComponent(token);
  if (!params.get("k")) history.replaceState(null, "", start);
  const m = { name: "Lokus", short_name: "Lokus", start_url: start, scope: base, display: "standalone",
    background_color: "#14120f", theme_color: "#14120f",
    icons: [{ src: base + "icon-192.png", sizes: "192x192", type: "image/png" }, { src: base + "icon-512-any.png", sizes: "512x512", type: "image/png" }] };
  const l = document.querySelector('link[rel="manifest"]');
  if (l) l.href = "data:application/manifest+json," + encodeURIComponent(JSON.stringify(m));
}
linkManifest();

// ---------- Gruppe (Supabase) ----------
async function rpc(fn, args) {
  const c = window.LK_CONFIG || {};
  const r = await fetch(c.supabaseUrl + "/rest/v1/rpc/" + fn, { method: "POST",
    headers: { apikey: c.supabaseKey, "Content-Type": "application/json" }, body: JSON.stringify(args || {}) });
  const txt = await r.text();
  if (!r.ok) { let m = txt; try { m = JSON.parse(txt).message || txt; } catch (e) { } throw new Error(m); }
  return txt ? JSON.parse(txt) : null;
}
const T = a => Object.assign({ p_token: token }, a || {});
async function loadGroup() {
  if (!token) return;
  try { S.group = await rpc("lk_all", T()); S.groupErr = null; store.set("group", S.group); }
  catch (e) { S.groupErr = e.message; const g = store.get("group", null); if (g) S.group = g; }
  render();
}
const ratingsFor = id => S.group.ratings.filter(r => r.place === id);
const avgFor = id => { const r = ratingsFor(id).filter(x => x.stars); return r.length ? r.reduce((a, x) => a + x.stars, 0) / r.length : 0; };
const isFav = id => S.group.favs.some(f => f.place === id);
const isGone = id => S.group.gone.some(g => g.place === id);

// ---------- Daten (Kacheln) ----------
async function loadIndex() {
  try { const r = await fetch("data/index.json", { cache: "no-cache" }); S.index = await r.json(); }
  catch (e) { S.index = null; }
  $("ver").textContent = "Lokus " + VERSION + " · Build " + BUILD + (S.index ? " · Daten vom " + new Date(S.index.built).toLocaleDateString("de-DE") : "");
}
const tileKey = (lat, lon) => { const t = S.index.tile; return (Math.floor(lat / t) * t).toFixed(1) + "_" + (Math.floor(lon / t) * t).toFixed(1); };
function addToilet(r) {
  const [id, lat, lon, f, name, fee, hours] = r;
  S.places.set(id, { id, lat, lon, f, name, fee, hours, more: false });
}
function addMore(r) {
  const [id, lat, lon, k, name, hours] = r;
  if (S.places.has(id) && !S.places.get(id).more) return;
  S.places.set(id, { id, lat, lon, kind: S.index ? S.index.kinds[k] : String(k), name, hours, more: true });
}
async function ensureTiles(bounds) {
  if (!S.index) return;
  const t = S.index.tile, have = new Set(S.index.tiles), want = [];
  for (let la = Math.floor(bounds.s / t) * t; la <= bounds.n; la += t)
    for (let lo = Math.floor(bounds.w / t) * t; lo <= bounds.e; lo += t) {
      const k = la.toFixed(1) + "_" + lo.toFixed(1);
      if (have.has(k) && !S.tiles.has(k) && !S.loading.has(k)) want.push(k);
    }
  if (!want.length || want.length > 12) return;
  await Promise.all(want.map(async k => {
    S.loading.add(k);
    try {
      const d = await (await fetch("data/t/" + k + ".json")).json();
      d.t.forEach(addToilet); d.w.forEach(addMore); S.tiles.set(k, true);
    } catch (e) { /* offline und nie geladen */ }
    S.loading.delete(k);
  }));
  render();
}

// Live-Abfrage für den sichtbaren Ausschnitt
async function refreshLive() {
  if (map.getZoom() < 13) { toast("Bitte näher heranzoomen, dann aktualisieren"); return; }
  const b = map.getBounds(), bb = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].map(x => x.toFixed(5)).join(",");
  const q = `[out:json][timeout:25];(nwr["amenity"="toilets"](${bb}););out tags center;`;
  $("refreshBtn").disabled = true; toast("Frage OpenStreetMap …");
  try {
    const r = await fetch("https://overpass-api.de/api/interpreter", { method: "POST", body: "data=" + encodeURIComponent(q),
      headers: { "Content-Type": "application/x-www-form-urlencoded" } });
    const js = await r.json(); let n = 0;
    for (const el of js.elements) {
      const row = osmToRow(el); if (row) { addToilet(row); n++; }
    }
    toast(n + " Toiletten in diesem Ausschnitt, auf dem neuesten Stand");
    render();
  } catch (e) { toast("Aktualisieren hat nicht geklappt. Kein Netz?"); }
  $("refreshBtn").disabled = false;
}
function osmToRow(el) {
  const t = el.tags || {}; if (t.access === "private" || t.access === "no") return null;
  const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon; if (lat == null) return null;
  let f = 0;
  if (t.fee === "no") f |= B.FREE; else if (t.fee) f |= B.PAID;
  f |= { yes: B.WC_YES, designated: B.WC_YES, limited: B.WC_LIMITED, no: B.WC_NO }[t.wheelchair] || 0;
  const ct = t.changing_table || t.diaper || "";
  if (ct && ct !== "no" && ct !== "0") f |= B.BABY_YES; else if (ct) f |= B.BABY_NO;
  if (t.access === "customers" || t["toilets:access"] === "customers") f |= B.CUSTOMERS;
  return [el.type[0] + el.id, +lat.toFixed(5), +lon.toFixed(5), f, (t.name || t.description || t.operator || "").slice(0, 80),
    f & B.PAID ? (t.charge || "") : "", t.opening_hours || ""];
}

// ---------- Auswahl & Filter ----------
const FILTERS = [["free", "kostenlos"], ["wc", "barrierefrei"], ["baby", "Wickeltisch"], ["open", "jetzt offen"], ["fav", "Favoriten"], ["good", "gut bewertet"]];
function openState(p) { return p.hours ? OH.isOpen(p.hours) : null; }
function passes(p) {
  if (isGone(p.id)) return false;
  for (const f of S.filters) {
    if (p.more && f !== "fav" && f !== "open" && f !== "good") return false;
    if (f === "free" && !(p.f & B.FREE)) return false;
    if (f === "wc" && !(p.f & B.WC_YES)) return false;
    if (f === "baby" && !(p.f & B.BABY_YES)) return false;
    if (f === "open" && openState(p) === false) return false;
    if (f === "fav" && !isFav(p.id)) return false;
    if (f === "good" && avgFor(p.id) < 4) return false;
  }
  return true;
}
function origin() {
  if (S.me) return S.me;
  const c = map.getCenter(); return { lat: c.lat, lon: c.lng };
}
function favPlaces() {
  // Favoriten auch zeigen, wenn ihre Kachel nicht geladen ist
  return S.group.favs.filter(f => !S.places.has(f.place) && f.lat != null)
    .map(f => ({ id: f.place, lat: f.lat, lon: f.lon, name: f.name, more: f.kind !== "toilet" && f.kind !== "", kind: f.kind, f: 0, hours: "", fromFav: true }));
}
function nearby(more, limit) {
  const o = origin(), out = [];
  const all = [...S.places.values(), ...(S.filters.has("fav") ? favPlaces() : [])];
  for (const p of all) {
    if (p.more !== more || !passes(p)) continue;
    const d = distM(o, p);
    if (d < (S.filters.size ? 30000 : 5000)) out.push([d, p]);
  }
  out.sort((a, b) => a[0] - b[0]);
  return out.slice(0, limit);
}

// ---------- Karte ----------
const map = L.map("map", { zoomControl: false, attributionControl: true, minZoom: 5, maxZoom: 19, tap: true })
  .setView(store.get("view", [51.16, 10.45]), store.get("viewZ", 6));
L.control.zoom({ position: "bottomright" }).addTo(map);
map.attributionControl.setPrefix(false);
let baseLayer;
function setBase() {
  const dark = isDark();
  // Freie OSM-Karte (ohne Schlüssel); im Dunkelmodus per CSS-Filter abgedunkelt
  document.getElementById("map").classList.toggle("map-dark", dark);
  if (baseLayer) return;
  baseLayer = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' }).addTo(map);
}
const pinLayer = L.layerGroup().addTo(map);
let meMarker = null, accCircle = null;

function pinIcon(p, near) {
  const cls = p.more ? "more" : (p.f & B.FREE ? "free" : p.f & B.PAID ? "paid" : "unk");
  const size = p.more ? 30 : near ? 50 : 38;
  return L.divIcon({ className: "lk-pin " + cls + (near ? " near" : "") + (S.sel === p.id ? " sel" : "") + (isFav(p.id) ? " fav" : ""),
    html: '<span class="b">' + (p.more ? CUP : TOILET) + "</span>", iconSize: [size, size + 6], iconAnchor: [size / 2, size + 6] });
}
function drawPins(nearT) {
  pinLayer.clearLayers();
  const z = map.getZoom(); if (z < 11) return;
  const b = map.getBounds().pad(0.15), c = map.getCenter(), cc = { lat: c.lat, lon: c.lng };
  const vis = [];
  for (const p of S.places.values()) {
    if (!b.contains([p.lat, p.lon]) || !passes(p)) continue;
    if (p.more && (!S.more || z < 15 || (S.filters.size && !S.filters.has("fav")))) continue;
    vis.push([distM(cc, p), p]);
  }
  vis.sort((a, b2) => a[0] - b2[0]);
  let nT = 0, nM = 0;
  for (const [, p] of vis) {
    if (p.more ? ++nM > 150 : ++nT > 400) continue;
    const near = nearT && p.id === nearT.id;
    const m = L.marker([p.lat, p.lon], { icon: pinIcon(p, near), zIndexOffset: near ? 1000 : p.more ? -100 : 0, keyboard: true, title: placeName(p) })
      .on("click", () => select(p.id));
    if (near && S.me) m.bindTooltip("Am nächsten · " + fmtDist(distM(S.me, p)), { permanent: true, direction: "top", offset: [0, -54], className: "near-tag" });
    m.addTo(pinLayer);
  }
}
map.on("moveend", () => {
  const c = map.getCenter(); store.set("view", [c.lat, c.lng]); store.set("viewZ", map.getZoom());
  if (map.getZoom() >= 10) { const b = map.getBounds(); ensureTiles({ s: b.getSouth(), n: b.getNorth(), w: b.getWest(), e: b.getEast() }); }
  render();
});
map.on("dragstart", () => { S.follow = false; });

// ---------- Standort ----------
function startGeo() {
  if (!navigator.geolocation) { S.geoErr = "Dieses Gerät kann den Standort nicht teilen."; render(); return; }
  navigator.geolocation.watchPosition(pos => {
    const first = !S.me;
    S.me = { lat: pos.coords.latitude, lon: pos.coords.longitude }; S.meAcc = pos.coords.accuracy; S.geoErr = null;
    const ll = [S.me.lat, S.me.lon];
    if (!meMarker) {
      meMarker = L.marker(ll, { icon: L.divIcon({ className: "", html: '<div class="lk-me"></div>', iconSize: [20, 20], iconAnchor: [10, 10] }), interactive: false, zIndexOffset: 2000 }).addTo(map);
    } else meMarker.setLatLng(ll);
    if (first || S.follow) map.setView(ll, first ? Math.max(map.getZoom(), 16) : map.getZoom(), { animate: !first });
    ensureTiles({ s: S.me.lat - 0.1, n: S.me.lat + 0.1, w: S.me.lon - 0.15, e: S.me.lon + 0.15 });
    render();
  }, err => {
    S.geoErr = err.code === 1 ? "Standort ist nicht erlaubt. Dann suche ich ab der Kartenmitte."
      : "Standort gerade nicht verfügbar. Ich suche ab der Kartenmitte.";
    render();
  }, { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 });
}

// ---------- Darstellung ----------
function placeName(p) {
  if (p.name) return p.name;
  return p.more ? p.kind : "Öffentliche Toilette";
}
function metaLine(p) {
  if (p.more) return esc(p.kind) + " · Gäste-WC wahrscheinlich";
  const bits = [];
  bits.push(p.f & B.FREE ? "kostenlos" : p.f & B.PAID ? (p.fee ? "kostet " + p.fee : "kostet") : "Preis unklar");
  if (p.f & B.WC_YES) bits.push("barrierefrei");
  if (p.f & B.BABY_YES) bits.push("Wickeltisch");
  const o = openState(p);
  if (o === false) bits.push('<span style="color:var(--danger)">jetzt zu</span>');
  const a = avgFor(p.id);
  if (a) bits.push('<span class="ratingTxt">★ ' + a.toFixed(1).replace(".", ",") + "</span>");
  return bits.join(" · ");
}
function rowHTML(d, p, first) {
  const color = p.more ? "var(--more)" : p.f & B.FREE ? "var(--free)" : p.f & B.PAID ? "var(--paid)" : "var(--unk)";
  return `<li><button class="row ${first ? "first" : ""}" data-id="${esc(p.id)}"><span class="ic" style="background:${color}">${p.more ? CUP : TOILET}</span>
    <span><span class="n">${first ? '<span class="badge">Am nächsten</span>' : ""}${isFav(p.id) ? "★ " : ""}${esc(placeName(p))}</span><span class="m">${metaLine(p)}</span></span>
    <span class="d">${fmtDist(d)}<small>ca. ${walkMin(d)} Min.</small></span></button></li>`;
}
function renderBanner() {
  const el = $("banner"); let h = "";
  if (invite && !token) h = `<div class="banner"><b>Willkommen bei Lokus! Wie heißt du? Dein Name steht bei deinen Bewertungen.</b>
      <input type="text" id="joinName" maxlength="30" placeholder="z. B. Mama" autocomplete="given-name" style="flex:1 1 140px">
      <button class="secondary" id="joinBtn">Mitmachen</button></div>`;
  else if (S.geoErr) h = `<div class="banner"><b>${esc(S.geoErr)}</b><button class="secondary" id="geoRetry">Nochmal versuchen</button></div>`;
  else if (!S.index) h = `<div class="banner"><b>Die Toiletten-Daten fehlen noch. Sie werden einmal pro Woche geladen.</b></div>`;
  else if (S.groupErr && token) h = `<div class="banner"><b>Bewertungen gerade nicht erreichbar (${esc(S.groupErr)}).</b></div>`;
  el.innerHTML = h; el.hidden = !h;
  $("joinBtn")?.addEventListener("click", join);
  $("geoRetry")?.addEventListener("click", () => { S.geoErr = null; startGeo(); render(); });
}
async function join() {
  const name = $("joinName").value.trim();
  if (name.length < 2) { toast("Bitte deinen Namen eingeben"); return; }
  try {
    const r = await rpc("lk_join", { p_code: invite, p_name: name });
    token = r.token; store.set("token", token);
    history.replaceState(null, "", new URL("./", location.href).href + "?k=" + token);
    linkManifest(); toast("Hallo " + r.name + "! Jetzt zum Home-Bildschirm hinzufügen."); loadGroup();
  } catch (e) { toast(e.message); }
}
function renderList() {
  const T_ = nearby(false, 12), M_ = S.more && (!S.filters.size || S.filters.has("fav")) ? nearby(true, 6) : [];
  const from = S.me ? "ab deinem Standort" : "ab Kartenmitte";
  let h = `<h2>Toiletten in der Nähe <small>${from}</small></h2>`;
  if (T_.length) h += `<ul class="list">${T_.map(([d, p], i) => rowHTML(d, p, i === 0)).join("")}</ul>`;
  else if (map.getZoom() < 10 && !S.me) h += `<p class="empty">Erlaube den Standort oder zoome in die Karte, dann erscheinen die Toiletten.</p>`;
  else h += `<p class="empty">${S.filters.size ? "Keine Toilette passt zu allen Filtern. Nimm einen Filter heraus." : "Hier ist keine Toilette eingetragen. Schau bei den weiteren Klos."}</p>`;
  if (M_.length) h += `<h2>Weitere Klos <small>Café, Kaufhaus, Bahnhof …</small></h2><ul class="list">${M_.map(([d, p]) => rowHTML(d, p, false)).join("")}</ul>`;
  $("sheet").innerHTML = h;
  return T_.length ? T_[0][1] : null;
}
function fact(cond, txt, cls) { return cond ? `<span class="fact ${cls || ""}">${txt}</span>` : ""; }
function renderDetail(p) {
  const d = S.me ? distM(S.me, p) : null;
  const apple = `https://maps.apple.com/?daddr=${p.lat},${p.lon}&dirflg=w`;
  const google = `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}&travelmode=walking`;
  const osmUrl = `https://www.openstreetmap.org/${{ n: "node", w: "way", r: "relation" }[p.id[0]]}/${p.id.slice(1)}`;
  const o = openState(p), today = p.hours ? OH.today(p.hours) : null;
  let h = `<button class="ibtn" id="backBtn" style="align-self:flex-start">← Liste</button><div class="detail">
    <div class="dhead"><h3>${esc(placeName(p))}</h3>${token ? `<button class="ibtn" id="favBtn" aria-pressed="${isFav(p.id)}" title="Als Favorit merken" aria-label="Favorit">${STAR}</button>` : ""}</div><div class="facts">`;
  if (d != null) h += `<span class="fact"><b>${fmtDist(d)}</b> · ca. ${walkMin(d)} Min. zu Fuß</span>`;
  if (p.more) h += fact(true, esc(p.kind)) + fact(true, "kein öffentliches Klo, als Gast meist möglich", "unk");
  else {
    h += p.f & B.FREE ? fact(true, "kostenlos") : p.f & B.PAID ? fact(true, "kostet" + (p.fee ? " " + esc(p.fee) : "")) : fact(true, "Preis unbekannt", "unk");
    h += p.f & B.WC_YES ? fact(true, "barrierefrei") : p.f & B.WC_LIMITED ? fact(true, "teilweise barrierefrei") : p.f & B.WC_NO ? fact(true, "nicht barrierefrei") : fact(true, "Barrierefreiheit unbekannt", "unk");
    h += p.f & B.BABY_YES ? fact(true, "Wickeltisch") : p.f & B.BABY_NO ? fact(true, "kein Wickeltisch") : "";
    h += fact(p.f & B.CUSTOMERS, "nur für Kunden", "warn");
  }
  if (p.hours) h += today ? fact(true, (o === false ? "jetzt zu · " : o ? "jetzt offen · " : "") + today, o === false ? "warn" : "") : fact(true, "Öffnungszeiten: " + esc(p.hours));
  else if (!p.more) h += fact(true, "Öffnungszeiten unbekannt", "unk");
  h += `</div><a class="primary" href="${IOS ? apple : google}" target="_blank" rel="noopener">Hinführen</a>
    <div class="navrow"><a class="secondary" href="${apple}" target="_blank" rel="noopener">Apple Karten</a><a class="secondary" href="${google}" target="_blank" rel="noopener">Google Maps</a></div>`;
  const rs = ratingsFor(p.id);
  if (token) {
    const mine = rs.find(r => r.mine) || {};
    const a = avgFor(p.id);
    h += `<h2>Eure Bewertungen <small>${a ? "★ " + a.toFixed(1).replace(".", ",") + " von " + rs.filter(r => r.stars).length : "noch keine"}</small></h2>`;
    if (rs.length) h += `<ul class="reviews">${rs.map(r => `<li><b>${esc(r.who)}</b>${r.stars ? `<span class="s">${"★".repeat(r.stars)}${"☆".repeat(5 - r.stars)}</span>` : ""}<span class="when">${new Date(r.at).toLocaleDateString("de-DE")}</span>${r.note ? `<div>${esc(r.note)}</div>` : ""}</li>`).join("")}</ul>`;
    h += `<div><div class="small">Deine Bewertung${S.group.me ? " (als " + esc(S.group.me) + ")" : ""}</div><div class="stars" id="stars">${[1, 2, 3, 4, 5].map(n => `<button data-n="${n}" class="${n <= (mine.stars || 0) ? "on" : ""}" aria-label="${n} Sterne">${STAR}</button>`).join("")}</div></div>
      <div><label class="small" for="noteIn">Notiz für alle (z. B. „Code an der Theke“)</label><textarea id="noteIn" maxlength="500" placeholder="Notiz schreiben …">${esc(mine.note || "")}</textarea></div>
      <button class="secondary" id="saveBtn">Speichern</button>`;
  } else h += `<p class="small">Bewertungen, Notizen und Favoriten gibt es mit dem Familien-Link.</p>`;
  h += `<div class="links"><a href="${osmUrl}" target="_blank" rel="noopener">In OpenStreetMap ansehen oder korrigieren</a>${token && !p.more ? `<button id="goneBtn">${isGone(p.id) ? "Doch wieder anzeigen" : "Gibt's nicht mehr"}</button>` : ""}</div></div>`;
  $("sheet").innerHTML = h;
  $("backBtn").onclick = () => select(null);
  if (!token) return;
  let stars = (rs.find(r => r.mine) || {}).stars || 0;
  $("stars").onclick = e => { const b = e.target.closest("button"); if (!b) return; const n = +b.dataset.n; stars = stars === n ? 0 : n;
    [...$("stars").children].forEach((s, i) => s.classList.toggle("on", i < stars)); };
  $("saveBtn").onclick = async () => {
    const note = $("noteIn").value.trim();
    try { await rpc("lk_rate", T({ p_place: p.id, p_stars: stars || null, p_note: note, p_name: placeName(p), p_lat: p.lat, p_lon: p.lon }));
      toast(stars || note ? "Gespeichert, die Familie sieht es" : "Bewertung gelöscht"); await loadGroup(); }
    catch (e) { toast("Speichern ging nicht: " + e.message); }
  };
  $("favBtn").onclick = async () => {
    const on = !isFav(p.id);
    try { await rpc("lk_fav", T({ p_place: p.id, p_on: on, p_name: placeName(p), p_lat: p.lat, p_lon: p.lon, p_kind: p.more ? p.kind : "toilet" }));
      toast(on ? "Als Favorit gemerkt" : "Favorit entfernt"); await loadGroup(); }
    catch (e) { toast("Ging nicht: " + e.message); }
  };
  $("goneBtn") && ($("goneBtn").onclick = async () => {
    const on = !isGone(p.id);
    try { await rpc("lk_set_gone", T({ p_place: p.id, p_on: on })); toast(on ? "Ausgeblendet für alle" : "Wird wieder angezeigt"); await loadGroup(); }
    catch (e) { toast("Ging nicht: " + e.message); }
  });
}
function renderChips() {
  const shown = FILTERS.filter(([k]) => token || (k !== "fav" && k !== "good"));
  $("chips").innerHTML = shown.map(([k, l]) => `<button class="chip" data-k="${k}" aria-pressed="${S.filters.has(k)}">${l}</button>`).join("");
}
function render() {
  renderBanner(); renderChips();
  const all = [...S.places.values(), ...favPlaces()];
  const p = S.sel ? all.find(x => x.id === S.sel) : null;
  let nearT;
  if (p) { renderDetail(p); nearT = nearby(false, 1)[0]?.[1]; }
  else nearT = renderList();
  drawPins(nearT);
}
function select(id) {
  S.sel = id; S.follow = false;
  render();
  const p = id && ([...S.places.values(), ...favPlaces()].find(x => x.id === id));
  if (p && !map.getBounds().pad(-0.1).contains([p.lat, p.lon])) map.panTo([p.lat, p.lon]);
  if (window.innerWidth < 900) $("sheet").scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------- Bedienung ----------
$("chips").addEventListener("click", e => {
  const b = e.target.closest(".chip"); if (!b) return; const k = b.dataset.k;
  S.filters.has(k) ? S.filters.delete(k) : S.filters.add(k); store.set("filters", [...S.filters]); S.sel = null; render();
});
$("sheet").addEventListener("click", e => { const r = e.target.closest(".row"); if (r) select(r.dataset.id); });
$("moreBtn").setAttribute("aria-pressed", S.more);
$("moreBtn").onclick = () => { S.more = !S.more; store.set("more", S.more); $("moreBtn").setAttribute("aria-pressed", S.more);
  toast(S.more ? "Weitere Klos eingeblendet" : "Weitere Klos ausgeblendet"); render(); };
$("refreshBtn").onclick = refreshLive;
$("locBtn").onclick = () => { S.follow = true; if (S.me) map.setView([S.me.lat, S.me.lon], Math.max(map.getZoom(), 16)); else { S.geoErr = null; startGeo(); } };
$("wishBtn").onclick = () => {
  if (!token) { toast("Wünsche gehen mit dem Familien-Link"); return; }
  const m = document.createElement("div"); m.className = "modal";
  m.innerHTML = `<div class="box" role="dialog" aria-label="Wunsch an Jan"><h3>Wunsch oder Feedback</h3><label class="small" for="wishIn">Was soll Lokus besser können?</label>
    <textarea id="wishIn" maxlength="2000"></textarea><div class="navrow"><button class="secondary" id="wishCancel">Abbrechen</button><button class="primary" id="wishSend" style="padding:10px">Senden</button></div></div>`;
  document.body.append(m); $("wishIn").focus();
  $("wishCancel").onclick = () => m.remove();
  m.addEventListener("click", e => { if (e.target === m) m.remove(); });
  $("wishSend").onclick = async () => { const v = $("wishIn").value.trim(); if (v.length < 3) return;
    try { await rpc("lk_wish", T({ p_text: v })); m.remove(); toast("Danke! Jan bekommt den Wunsch."); } catch (e) { toast("Ging nicht: " + e.message); } };
};
const root = document.documentElement;
function isDark() { const t = root.dataset.theme; return t ? t === "dark" : !matchMedia("(prefers-color-scheme: light)").matches; }
function paintTheme() {
  $("themeBtn").innerHTML = isDark() ? SUN : MOON; $("themeBtn").title = isDark() ? "Hell" : "Dunkel";
  document.querySelector('meta[name="theme-color"]').content = isDark() ? "#14120f" : "#f7f4ee";
}
$("themeBtn").onclick = () => { root.dataset.theme = isDark() ? "light" : "dark"; store.set("theme", root.dataset.theme); paintTheme(); setBase(); };
matchMedia("(prefers-color-scheme: light)").addEventListener?.("change", () => { if (!root.dataset.theme) { paintTheme(); setBase(); } });
function paintSize() { $("sizeBtn").textContent = root.classList.contains("big") ? "A−" : "A+"; }
$("sizeBtn").onclick = () => { root.classList.toggle("big"); store.set("big", root.classList.contains("big")); paintSize(); };

// ---------- Start ----------
paintTheme(); paintSize(); setBase();
(async () => {
  await loadIndex();
  render();
  startGeo();
  loadGroup();
  if (map.getZoom() >= 10) map.fire("moveend");
})();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => { });
document.addEventListener("visibilitychange", () => { if (!document.hidden) loadGroup(); });
