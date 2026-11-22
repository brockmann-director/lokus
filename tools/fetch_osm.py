#!/usr/bin/env python3
"""Holt alle öffentlichen Toiletten (und „Weitere Klos“) in Deutschland aus OpenStreetMap
und schreibt sie als kleine Kacheln nach <out>/data/.

Aufruf:  python3 tools/fetch_osm.py <out-ordner> [--fallback https://lokus.thisisjan.com] [--reuse]

Läuft wöchentlich in .github/workflows/pages.yml. Schlägt der Abruf fehl, werden die
Daten der laufenden Seite übernommen (--fallback), damit die App nie leer ist.
Daten: © OpenStreetMap-Mitwirkende, ODbL.
"""
import json, math, os, sys, time, urllib.parse, urllib.request
from datetime import datetime, timezone

ENDPOINTS = ["https://overpass-api.de/api/interpreter",
             "https://overpass.kumi.systems/api/interpreter"]
TILE = 0.5  # Grad, ca. 55 x 35 km
AREA = 'area["ISO3166-1"="DE"][admin_level=2]->.a;'
UA = "Lokus/1.0 (private Familien-App, wöchentlicher Abruf)"

# Weitere Klos: Orte, die fast immer ein Gäste-WC haben
MORE = [
    ("Café", 'nwr["amenity"="cafe"](area.a);'),
    ("Imbiss", 'nwr["amenity"="fast_food"](area.a);'),
    ("Kaufhaus", 'nwr["shop"~"^(department_store|mall)$"](area.a);'),
    ("Bahnhof", 'nwr["railway"="station"]["station"!="subway"](area.a);'),
    ("Bibliothek", 'nwr["amenity"="library"](area.a);'),
    ("Museum", 'nwr["tourism"="museum"](area.a);'),
    ("Tankstelle", 'nwr["amenity"="fuel"](area.a);'),
]
KIND_IDS = {k: i for i, (k, _) in enumerate(MORE)}
FALLBACK_BASE = None

# Bits für Toiletten
FREE, PAID, WC_YES, WC_LIMITED, WC_NO, BABY_YES, BABY_NO, CUSTOMERS, UNISEX = 1, 2, 4, 8, 16, 32, 64, 128, 256


def overpass(body, timeout=900):
    q = "[out:json][timeout:%d];%s%sout tags center qt;" % (timeout - 60, AREA, body)
    data = urllib.parse.urlencode({"data": q}).encode()
    last = None
    for attempt in range(3):
        for ep in ENDPOINTS:
            try:
                req = urllib.request.Request(ep, data=data, headers={"User-Agent": UA})
                with urllib.request.urlopen(req, timeout=timeout) as r:
                    js = json.load(r)
                if js.get("remark"):  # z. B. Zeitüberschreitung: Ergebnis unvollständig
                    raise RuntimeError(js["remark"])
                if not js["elements"]:  # leere Antwort = meist abgebrochen, nochmal versuchen
                    raise RuntimeError("leere Antwort")
                return js["elements"]
            except Exception as e:  # noqa: BLE001
                last = e
                print("  Fehler bei", ep, "->", e, file=sys.stderr)
                time.sleep(20 * (attempt + 1))
    raise RuntimeError("Overpass nicht erreichbar: %s" % last)


def pos(el):
    if "lat" in el:
        return el["lat"], el["lon"]
    c = el.get("center")
    return (c["lat"], c["lon"]) if c else (None, None)


def short_id(el):
    return el["type"][0] + str(el["id"])


def toilet_row(el):
    t = el.get("tags", {})
    if t.get("access") in ("private", "no") or t.get("toilets:access") in ("private", "no"):
        return None
    lat, lon = pos(el)
    if lat is None:
        return None
    f = 0
    fee = t.get("fee", "")
    if fee == "no":
        f |= FREE
    elif fee:
        f |= PAID
    wc = t.get("wheelchair", "")
    f |= {"yes": WC_YES, "designated": WC_YES, "limited": WC_LIMITED, "no": WC_NO}.get(wc, 0)
    ct = t.get("changing_table", t.get("diaper", ""))
    if ct and ct not in ("no", "0"):
        f |= BABY_YES
    elif ct in ("no", "0"):
        f |= BABY_NO
    if t.get("access") == "customers" or t.get("toilets:access") == "customers":
        f |= CUSTOMERS
    if t.get("unisex") == "yes":
        f |= UNISEX
    name = t.get("name") or t.get("description") or t.get("operator") or ""
    charge = t.get("charge", "") if f & PAID else ""
    hours = t.get("opening_hours", "")
    return [short_id(el), round(lat, 5), round(lon, 5), f, name[:80], charge[:20], hours[:120]]


def more_row(el, kind):
    t = el.get("tags", {})
    lat, lon = pos(el)
    if lat is None or t.get("access") in ("private", "no"):
        return None
    name = t.get("name") or t.get("brand") or ""
    if kind in ("Café", "Imbiss") and not name:
        return None  # namenlose Buden helfen niemandem
    return [short_id(el), round(lat, 5), round(lon, 5), KIND_IDS[kind], name[:60], t.get("opening_hours", "")[:120]]


def tile_key(lat, lon):
    return "%.1f_%.1f" % (math.floor(lat / TILE) * TILE, math.floor(lon / TILE) * TILE)


def build(out):
    tiles = {}
    counts = {"toilets": 0}
    missing = []
    print("Toiletten …")
    for el in overpass('nwr["amenity"="toilets"](area.a);'):
        r = toilet_row(el)
        if r:
            tiles.setdefault(tile_key(r[1], r[2]), {"t": [], "w": []})["t"].append(r)
            counts["toilets"] += 1
    if counts["toilets"] < 5000:
        raise RuntimeError("Zu wenige Toiletten (%d), Abruf vermutlich unvollständig" % counts["toilets"])
    for kind, body in MORE:
        print(kind, "…")
        n = 0
        try:
            els = overpass(body)
        except Exception as e:  # noqa: BLE001
            print("  ausgelassen:", e, file=sys.stderr)  # Toiletten zählen, Weitere Klos sind Bonus
            els = []
        for el in els:
            r = more_row(el, kind)
            if r:
                tiles.setdefault(tile_key(r[1], r[2]), {"t": [], "w": []})["w"].append(r)
                n += 1
        counts[kind] = n
        if n == 0:
            missing.append(kind)
        time.sleep(5)
    if missing and FALLBACK_BASE:
        keep_old(tiles, counts, missing)
    os.makedirs(os.path.join(out, "data", "t"), exist_ok=True)
    for k, v in tiles.items():
        with open(os.path.join(out, "data", "t", k + ".json"), "w") as f:
            json.dump(v, f, ensure_ascii=False, separators=(",", ":"))
    index = {"built": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"), "tile": TILE,
             "kinds": [k for k, _ in MORE], "tiles": sorted(tiles), "counts": counts}
    with open(os.path.join(out, "data", "index.json"), "w") as f:
        json.dump(index, f, ensure_ascii=False, separators=(",", ":"))
    print("Fertig:", counts, len(tiles), "Kacheln")


def keep_old(tiles, counts, missing):
    """Weitere-Klos-Arten, die diesmal leer kamen, aus den Daten der laufenden Seite übernehmen."""
    try:
        get = lambda p: json.loads(urllib.request.urlopen(urllib.request.Request(FALLBACK_BASE.rstrip("/") + p, headers={"User-Agent": UA}), timeout=60).read())
        index = get("/data/index.json")
        old_ids = {index["kinds"].index(k): k for k in missing if k in index["kinds"]}
        for key in index["tiles"]:
            rows = [r for r in get("/data/t/%s.json" % key).get("w", []) if r[3] in old_ids]
            for r in rows:
                r[3] = KIND_IDS[old_ids[r[3]]]
                tiles.setdefault(key, {"t": [], "w": []})["w"].append(r)
                counts[MORE[r[3]][0]] += 1
        print("Von letzter Woche übernommen:", {k: counts[k] for k in missing})
    except Exception as e:  # noqa: BLE001
        print("  alte Weitere Klos nicht übernommen:", e, file=sys.stderr)


def fallback(out, base):
    """Daten der laufenden Seite übernehmen."""
    get = lambda p: urllib.request.urlopen(urllib.request.Request(base.rstrip("/") + p, headers={"User-Agent": UA}), timeout=60).read()
    index = json.loads(get("/data/index.json"))
    os.makedirs(os.path.join(out, "data", "t"), exist_ok=True)
    for k in index["tiles"]:
        with open(os.path.join(out, "data", "t", k + ".json"), "wb") as f:
            f.write(get("/data/t/%s.json" % k))
    with open(os.path.join(out, "data", "index.json"), "w") as f:
        json.dump(index, f, ensure_ascii=False, separators=(",", ":"))
    print("Alte Daten übernommen vom", index["built"])


if __name__ == "__main__":
    out = sys.argv[1]
    fb = sys.argv[sys.argv.index("--fallback") + 1] if "--fallback" in sys.argv else None
    FALLBACK_BASE = fb
    if fb and "--reuse" in sys.argv:
        # Nur Code geändert: Daten der laufenden Seite wiederverwenden, Overpass schonen
        try:
            fallback(out, fb)
            sys.exit(0)
        except Exception as e:  # noqa: BLE001
            print("Keine alten Daten, hole neu:", e, file=sys.stderr)
    try:
        build(out)
    except Exception as e:  # noqa: BLE001
        print("Neuer Abruf fehlgeschlagen:", e, file=sys.stderr)
        if not fb:
            raise
        fallback(out, fb)
