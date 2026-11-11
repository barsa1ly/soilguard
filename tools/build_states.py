"""Per-state files for SoilGuard: the app loads only the states chosen in its picker.

Reads data/states/XX/overlays.json (tools/build_layers.py XX) for each state with statewide overlays.

Writes
  data/states.js          window.WG_STATES = {meta, list}: every state's code, name, box, standard time offset and
                          which files it has (a few KB, loaded with the page); meta holds the statewide layers' titles,
                          units, legends and notes, the same for every state.
  data/states/XX.json     one per state: outline (for the map's cover and the inside test), box, standard time offset,
                          the airports within about 150 km of the state (calibration stations), and, where built, the
                          statewide erosion overlays (images under data/states/XX/, their bounds, the spring-wind
                          arrows, the state's statistics and each county's climatic factor C).

Inputs (tools/raw)
  us_states_5m.json       U.S. Census 1:5,000,000 state outlines (cartographic boundary file)
  iem_XX_ASOS.geojson     Iowa Environmental Mesonet ASOS/AWOS network per state, fetched once and kept
  isd-history.csv, ghcnh-station-list.txt   NOAA NCEI station lists (GHCNh ids), as in tools/fetch_stations.py

Run: python tools/build_states.py            (all states)
     python tools/build_states.py TX OK      (only those state files; states.js is always rewritten)
"""
import json
import math
import sys
from pathlib import Path

import requests
import shapely
from shapely.geometry import mapping, shape

sys.path.insert(0, str(Path(__file__).parent))
import fetch_stations as FS  # noqa: E402  (its GHCNh matching and West Texas Mesonet list)

HERE = Path(__file__).parent
RAW = HERE / "raw"
DATA = HERE.parent / "data"
OUT = DATA / "states"
MARGIN_KM = 150  # airports this far outside a state still count for points near its border

# postal code, Census name, FIPS, standard time offset (hours; the zone most of the state keeps), contiguous
STATES = [
    ("AL", "Alabama", "01", -6, 1), ("AK", "Alaska", "02", -9, 0), ("AZ", "Arizona", "04", -7, 1), ("AR", "Arkansas", "05", -6, 1),
    ("CA", "California", "06", -8, 1), ("CO", "Colorado", "08", -7, 1), ("CT", "Connecticut", "09", -5, 1), ("DE", "Delaware", "10", -5, 1),
    ("DC", "District of Columbia", "11", -5, 1), ("FL", "Florida", "12", -5, 1), ("GA", "Georgia", "13", -5, 1), ("HI", "Hawaii", "15", -10, 0),
    ("ID", "Idaho", "16", -7, 1), ("IL", "Illinois", "17", -6, 1), ("IN", "Indiana", "18", -5, 1), ("IA", "Iowa", "19", -6, 1),
    ("KS", "Kansas", "20", -6, 1), ("KY", "Kentucky", "21", -5, 1), ("LA", "Louisiana", "22", -6, 1), ("ME", "Maine", "23", -5, 1),
    ("MD", "Maryland", "24", -5, 1), ("MA", "Massachusetts", "25", -5, 1), ("MI", "Michigan", "26", -5, 1), ("MN", "Minnesota", "27", -6, 1),
    ("MS", "Mississippi", "28", -6, 1), ("MO", "Missouri", "29", -6, 1), ("MT", "Montana", "30", -7, 1), ("NE", "Nebraska", "31", -6, 1),
    ("NV", "Nevada", "32", -8, 1), ("NH", "New Hampshire", "33", -5, 1), ("NJ", "New Jersey", "34", -5, 1), ("NM", "New Mexico", "35", -7, 1),
    ("NY", "New York", "36", -5, 1), ("NC", "North Carolina", "37", -5, 1), ("ND", "North Dakota", "38", -6, 1), ("OH", "Ohio", "39", -5, 1),
    ("OK", "Oklahoma", "40", -6, 1), ("OR", "Oregon", "41", -8, 1), ("PA", "Pennsylvania", "42", -5, 1), ("RI", "Rhode Island", "44", -5, 1),
    ("SC", "South Carolina", "45", -5, 1), ("SD", "South Dakota", "46", -6, 1), ("TN", "Tennessee", "47", -6, 1), ("TX", "Texas", "48", -6, 1),
    ("UT", "Utah", "49", -7, 1), ("VT", "Vermont", "50", -5, 1), ("VA", "Virginia", "51", -5, 1), ("WA", "Washington", "53", -8, 1),
    ("WV", "West Virginia", "54", -5, 1), ("WI", "Wisconsin", "55", -6, 1), ("WY", "Wyoming", "56", -7, 1), ("PR", "Puerto Rico", "72", -4, 0),
]


def rounded(geom, nd=5):
    """GeoJSON geometry with coordinates to nd decimals (about 1 m) and no repeated points."""
    def ring(r):
        out = []
        for x, y in r:
            p = [round(x, nd), round(y, nd)]
            if not out or out[-1] != p:
                out.append(p)
        return out
    g = mapping(geom)
    if g["type"] == "Polygon":
        return {"type": "Polygon", "coordinates": [ring(r) for r in g["coordinates"]]}
    return {"type": "MultiPolygon", "coordinates": [[ring(r) for r in poly] for poly in g["coordinates"]]}


def airports(code, isd, ghcnh):
    """A state's online ASOS/AWOS airports from its IEM network, kept in tools/raw once fetched."""
    p = RAW / f"iem_{code}_ASOS.geojson"
    if not p.exists():
        r = requests.get(f"https://mesonet.agron.iastate.edu/geojson/network/{code}_ASOS.geojson", timeout=120)
        if r.status_code != 200:
            print("no IEM network", code, r.status_code)
            return []
        p.write_bytes(r.content)
    rows = []
    for f in json.loads(p.read_text(encoding="utf-8")).get("features", []):
        q = f["properties"]
        if not q.get("online") or q.get("archive_end"):
            continue
        lon, lat = f["geometry"]["coordinates"][:2]
        begin = int((q.get("archive_begin") or "2100")[:4])
        awos = 1 if (q.get("attributes") or {}).get("IS_AWOS") == "1" else 0
        name = (q.get("sname") or q["sid"]).replace("_", " ").title().replace("Arpt", "Airport").replace(" Apt", " Airport")
        rows.append([q["sid"], f"{name}, {q.get('state', '')}", round(lat, 4), round(lon, 4), begin, awos,
                     FS.ghcnh_id(q["sid"], lat, lon, isd, ghcnh)])
    return rows


def near(box, lat, lon):
    """Within MARGIN_KM of the state's box."""
    w, s, e, n = box
    dlat = MARGIN_KM / 111.0
    dlon = MARGIN_KM / (111.0 * math.cos(math.radians(min(89.0, max(abs(s), abs(n)) + dlat))))  # widest where a degree of longitude is shortest
    return s - dlat <= lat <= n + dlat and w - dlon <= lon <= e + dlon


def main():
    only = {a.upper() for a in sys.argv[1:]}
    OUT.mkdir(parents=True, exist_ok=True)
    feats = {f["properties"]["NAME"]: f for f in json.loads((RAW / "us_states_5m.json").read_text(encoding="latin-1"))["features"]}
    isd, ghcnh = FS.load_isd(), FS.load_ghcnh()

    # every contiguous state's airports, then each state takes those near it
    allrows, seen = [], set()
    for code, name, fips, tz, l48 in STATES:
        if not l48:
            continue
        for r in airports(code, isd, ghcnh):
            if r[0] not in seen:
                seen.add(r[0])
                allrows.append(r)
    towers = FS.wtm_rows()  # West Texas Mesonet towers (used only when the mesonet is switched on)
    print(len(allrows), "airports;", len(towers), "West Texas Mesonet towers")

    # the contiguous states simplified as one coverage (GEOS coverage simplification), so the two sides of a shared border
    # keep the same vertices: no gaps or overlaps between neighbours; the others on their own
    cont = [x for x in STATES if x[4]]
    cov = dict(zip([x[0] for x in cont], shapely.coverage_simplify([shape(feats[x[1]]["geometry"]) for x in cont], 0.002)))
    meta, index = None, []
    for code, name, fips, tz, l48 in STATES:
        geom = cov.get(code) or shape(feats[name]["geometry"]).simplify(0.002, preserve_topology=True)  # within about 0.2 km of the 1:5M line
        w, s, e, n = geom.bounds
        box = [round(w, 4), round(s, 4), round(e, 4), round(n, 4)]
        ov = OUT / code / "overlays.json"  # written by tools/build_layers.py XX, committed with the images
        has_ov = ov.exists()
        index.append({"c": code, "n": name, "f": fips, "b": box, "tz": tz, "l48": l48, "ov": 1 if has_ov else 0})
        if not l48 or (only and code not in only):
            continue
        rec = {"code": code, "name": name, "fips": fips, "box": box, "tz": tz, "outline": rounded(geom),
               "stations": [r for r in allrows + towers if near(box, r[2], r[3])], "overlays": None}
        if has_ov:
            o = json.loads(ov.read_text(encoding="utf-8"))
            meta = meta or {k: {kk: vv for kk, vv in v.items() if kk != "file"} for k, v in o["layers"].items()}
            rec["overlays"] = {"bounds": o["bounds"], "files": {k: v["file"] for k, v in o["layers"].items()},
                               "stats": o.get("stats"), "windArrows": o.get("windArrows", []),
                               "counties": o.get("counties", {})}  # county code -> [C, 1 if estimated] (tools/build_layers.py)
        text = json.dumps(rec, separators=(",", ":"))
        (OUT / f"{code}.json").write_text(text, encoding="utf-8")
        print(code, len(text) // 1024, "KB,", len(rec["stations"]), "stations", "with overlays" if has_ov else "")
    if meta is None:  # the layers' legends come from any state's overlays file
        any_ov = next(iter(sorted(OUT.glob("*/overlays.json"))), None)
        if any_ov:
            meta = {k: {kk: vv for kk, vv in v.items() if kk != "file"} for k, v in json.loads(any_ov.read_text(encoding="utf-8"))["layers"].items()}
    if meta is None:
        sys.exit("No data/states/XX/overlays.json found: run tools/build_layers.py TX first (the app needs the layers' legends).")
    # the station counts the Methods sheet gives: airports, and the towers' first complete years
    summary = {"airports": len(allrows), "towerYears": sorted(r[4] for r in towers)}
    js = "/* generated by tools/build_states.py */\nwindow.WG_STATES = " + json.dumps({"meta": meta, "list": index, **summary}, separators=(",", ":")) + ";\n"
    (DATA / "states.js").write_text(js, encoding="utf-8")
    print("wrote states.js", len(js) // 1024, "KB")


if __name__ == "__main__":
    main()
