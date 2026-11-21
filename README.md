# Lokus

Die nächste Toilette, schnell gefunden. Private Web-App (PWA) für Familie und enge Freunde.
Live: https://lokus.thisisjan.com

- **Daten:** öffentliche Toiletten und „Weitere Klos“ (Café, Imbiss, Kaufhaus, Bahnhof, Bibliothek, Museum, Tankstelle)
  aus OpenStreetMap, © OpenStreetMap-Mitwirkende, ODbL. `tools/fetch_osm.py` holt sie sonntags in
  `.github/workflows/pages.yml` und legt sie als 0,5°-Kacheln in `data/` der Seite (nicht im Repo).
  Bei Code-Änderungen werden die Daten der laufenden Seite wiederverwendet. Neu holen: Actions → „Seite und Daten“ → Run.
- **Karte:** Leaflet 1.9.4 (in `vendor/`), Kartenbilder von CARTO (Voyager hell, Dark Matter dunkel).
- **Familie:** Bewertungen, Notizen, Favoriten, „Gibt's nicht mehr“ und Wünsche über Supabase
  (Projekt von NephroWoche, Tabellen `lk_*`, Einrichtung `supabase/setup.sql`).
  Einladung: `https://lokus.thisisjan.com/?einladung=CODE`, jede Person gibt einmal ihren Namen ein.
- **Offline:** `sw.js` speichert App, angesehene Datenkacheln und Kartenbilder.
- Öffnungszeiten: `oh.js` versteht einfache Angaben, alles andere gilt als „unbekannt“.

Einrichtung: GitHub → Settings → Pages → Source „GitHub Actions“, Custom domain `lokus.thisisjan.com`;
bei Strato CNAME `lokus` → `brockmann-director.github.io.`
