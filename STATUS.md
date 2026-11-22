# Lokus – Stand

Stand: 22.11.2026 · Build 10 · live unter https://lokus.thisisjan.com

Öffentliche-Toiletten-Finder für Familie und enge Freunde (Hauptnutzer: ältere Eltern unterwegs, dazu Kinder).
Web-App (PWA) auf GitHub Pages, keine native App.

## Was V1 kann

- Karte zuerst (Leaflet + OpenStreetMap-Kacheln, im Dunkelmodus per CSS-Filter abgedunkelt), Pins in Form kleiner Toiletten,
  nächste Toilette hervorgehoben („Am nächsten · 1,8 km“), Liste darunter mit Entfernung und Gehminuten.
- „Hinführen“ öffnet Apple Karten (iPhone) bzw. Google Maps, zu Fuß.
- Filter: kostenlos, barrierefrei, Wickeltisch, jetzt offen (eigener Öffnungszeiten-Leser `oh.js`), Favoriten, gut bewertet.
- Ebene „Weitere Klos“ (blasser, abschaltbar): Café, Imbiss, Kaufhaus, Bahnhof, Bibliothek, Museum, Tankstelle.
- Familie: Einladungs-Link mit Name → 1–5 Sterne, Notiz, Favorit (Stern), „Gibt's nicht mehr“ (blendet für alle aus),
  alles mit Namen sichtbar. Knopf „Wunsch / Feedback“ unten.
- Hell/Dunkel-Schalter, A+ (große Schrift), Build-Nummer neben dem Logo und in der Fußzeile.
- Home-Bildschirm-App, offline nutzbar (Service Worker).

## Technik

- Dateien: `index.html`, `app.js`, `oh.js`, `style.css`, `sw.js`, `config.js` (Supabase-URL + öffentlicher Schlüssel), `vendor/` (Leaflet, Schriften).
- Daten: `tools/fetch_osm.py` holt per Overpass alle `amenity=toilets` in Deutschland + Weitere Klos und schreibt
  0,5°-Kacheln nach `data/` (nicht im Git, nur im Pages-Artefakt).
- Workflow `.github/workflows/pages.yml`:
  - bei jedem Push: übernimmt die Daten der laufenden Seite (`--reuse`, ~1 Min.), Build-Nummer = Run-Nummer (`__BUILD__` per sed)
  - sonntags 02:17 UTC + manuell: frischer Abruf (~40–50 Min., Overpass ist oft überlastet; leere Antworten werden wiederholt,
    leere Weitere-Klos-Arten von letzter Woche übernommen; unter 5.000 Toiletten → alte Daten bleiben)
  - Fallback-Adresse bewusst `http://`, damit es auch ohne fertiges Zertifikat geht.
- Supabase: im selben Projekt wie NephroWoche, Tabellen `lk_*`, nur über RPC-Funktionen erreichbar (`supabase/setup.sql`, mehrfach ausführbar).
  Einladungs-Link: `https://lokus.thisisjan.com/?einladung=CODE` (Code steht in `lk_invites`, nicht im Repo).
  Wünsche ansehen: Abfrage ganz unten in `setup.sql`.
- Domain: Strato CNAME `lokus` → `brockmann-director.github.io.`, Custom Domain in den Pages-Einstellungen.

## Stolperfallen (gelöst)

- CARTO-Kartenkacheln verlangen inzwischen einen API-Schlüssel → OSM-Standardkacheln.
- iPhone: Home-Bildschirm-App hat eigenen Speicher, getrennt von Safari. Mit Manifest startete sie ohne `?k=` und
  kannte den Namen nicht → auf iOS wird kein Manifest eingebunden, iOS nimmt die aktuelle Adresse (mit Schlüssel).
  Reihenfolge für Familie: Link in Safari öffnen → Namen eingeben → Teilen → Zum Home-Bildschirm.
- Standort-Updates zeichneten das Namensfeld neu (Tastatur klappte zu) → Banner/Detailansicht nur bei echten Änderungen neu.
- Kopfzeile lag in der Home-Bildschirm-App unter der Statusleiste → `safe-area-inset-top`.

## Daten (Lauf 22.11.2026)

31.965 Toiletten, 33.234 Cafés, 42.317 Imbisse, 17.820 Tankstellen, 6.081 Bibliotheken, 3.833 Bahnhöfe, 3.554 Kaufhäuser.
Museen kamen diesmal leer (Overpass) – ab dem nächsten Lauf wird so etwas wiederholt bzw. von der Vorwoche übernommen.

## Offen / später

- „Enforce HTTPS“ in Settings → Pages anhaken, sobald möglich (falls noch nicht geschehen).
- Später (aus dem Brainstorm): Fotos, Fehler an OSM melden, eigene Orte, Europa, Familien-Wünsche einbauen.
- Brainstorm-Dokument: https://claude.ai/artifact/GDgt3GMNgtpFbraVaaRe73
