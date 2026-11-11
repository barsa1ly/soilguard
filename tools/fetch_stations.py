"""Weather stations used to calibrate reanalysis wind: airports (ASOS/AWOS) and West Texas Mesonet towers.

The app now reads its stations from each state's file, written by tools/build_states.py with the functions here
(GHCNh matching, the mesonet towers). Running this file alone writes the older single Texas-area list, data/stations.js,
which the app no longer loads.

Sources:
  Iowa Environmental Mesonet station networks, https://mesonet.agron.iastate.edu/
  NOAA NCEI ISD station history (WBAN numbers), https://www.ncei.noaa.gov/pub/data/noaa/isd-history.csv
  NOAA NCEI GHCNh station list, https://www.ncei.noaa.gov/oa/global-historical-climatology-network/hourly/doc/ghcnh-station-list.txt
  West Texas Mesonet site list (Texas Tech), https://www.mesonet.ttu.edu/mesoweb/sites/
Writes data/stations.js: window.WE_STATIONS = [[id, name, lat, lon, first_year, is_awos, ghcnh_id(, "WTM")], ...]
ghcnh_id is "" when the station has no NOAA GHCNh record; the app then reads it from IEM only.
Tower rows end with "WTM": id is the NWS SHEF id the Iowa Environmental Mesonet archives the hourly reports under,
name and position come from that NWS station list, first_year is the first (nearly) complete year in the archive. The
mesonet's own site list only tells which SHEF ids are its towers. The app uses them only when the mesonet is switched on.
"""
import csv
import json
import math
from pathlib import Path

import requests

NETWORKS = ["TX_ASOS", "NM_ASOS", "OK_ASOS", "LA_ASOS", "AR_ASOS"]
WTM_SITES = "https://www.mesonet.ttu.edu/mesoweb/sites/"
DCP = ["TX_DCP", "NM_DCP"]  # IEM networks holding the towers' NWS SHEF reports
ROOT = Path(__file__).parent
OUT = ROOT.parent / "data" / "stations.js"
RAW = ROOT / "raw"
ISD = "https://www.ncei.noaa.gov/pub/data/noaa/isd-history.csv"
GHCNH = "https://www.ncei.noaa.gov/oa/global-historical-climatology-network/hourly/doc/ghcnh-station-list.txt"


def cached(url, name):
    p = RAW / name
    if not p.exists():
        RAW.mkdir(exist_ok=True)
        p.write_bytes(requests.get(url, timeout=120).content)
    return p


def km(la1, lo1, la2, lo2):
    r = math.pi / 180
    a = math.sin((la2 - la1) * r / 2) ** 2 + math.cos(la1 * r) * math.cos(la2 * r) * math.sin((lo2 - lo1) * r / 2) ** 2
    return 12742 * math.asin(math.sqrt(a))


def load_ghcnh():
    """US GHCNh stations: id -> (lat, lon)."""
    out = {}
    for line in cached(GHCNH, "ghcnh-station-list.txt").read_text(encoding="latin-1").splitlines():
        sid = line[:11].strip()
        if sid.startswith(("USW", "USI")):
            out[sid] = (float(line[12:20]), float(line[21:30]))
    return out


def load_isd():
    """ICAO -> rows (wban, lat, lon, end), US only."""
    out = {}
    with cached(ISD, "isd-history.csv").open(encoding="latin-1") as f:
        for r in csv.DictReader(f):
            if r["CTRY"] != "US" or not r["ICAO"].strip():
                continue
            try:
                lat, lon = float(r["LAT"]), float(r["LON"])
            except ValueError:
                continue
            out.setdefault(r["ICAO"].strip(), []).append((r["WBAN"], lat, lon, r["END"]))
    return out


def ghcnh_id(sid, lat, lon, isd, ghcnh):
    """WBAN-based USW id (newest ISD record for the ICAO), else ICAO-based USI id, else a USW/USI site within 2 km."""
    icao = sid if len(sid) == 4 else "K" + sid
    for wban, la, lo, _ in sorted(isd.get(icao, []), key=lambda x: x[3], reverse=True):
        cand = "USW00" + wban
        if wban != "99999" and cand in ghcnh and km(lat, lon, la, lo) < 5:
            return cand
    cand = "USI0000" + icao
    if cand in ghcnh and km(lat, lon, *ghcnh[cand]) < 5:
        return cand
    near = min(ghcnh.items(), key=lambda kv: km(lat, lon, *kv[1]))
    return near[0] if km(lat, lon, *near[1]) < 2 else ""


def nws_name(s):
    """'PLAINVIEW 1S' -> 'Plainview 1S' (direction-and-distance words stay upper case)."""
    s = s.replace("(MESO)", "").strip()
    return " ".join(w if any(c.isdigit() for c in w) else w.title() for w in s.split())


def wtm_rows():
    """West Texas Mesonet towers that the IEM DCP archive carries, with the NWS name and position IEM publishes;
    first year from IEM's archive_begin (a record starting after 15 January counts from the next year)."""
    dcp = {}
    for net in DCP:
        for f in requests.get(f"https://mesonet.agron.iastate.edu/geojson/network/{net}.geojson", timeout=120).json()["features"]:
            dcp[f["properties"]["sid"]] = f
    rows = []
    for s in requests.get(WTM_SITES, timeout=60).json()["results"]:
        f = dcp.get(s["shef_id"])
        p = f and f["properties"]
        if not p or not p.get("online") or p.get("archive_end"):
            continue
        lon, lat = f["geometry"]["coordinates"][:2]
        ab = p.get("archive_begin") or "2100-01-01"
        begin = int(ab[:4]) + (1 if ab[5:10] > "01-15" else 0)
        rows.append([p["sid"], f"{nws_name(p.get('sname') or p['sid'])}, {p.get('state', '')}", round(lat, 4), round(lon, 4), begin, 0, "", "WTM"])
    return rows


def main():
    isd, ghcnh = load_isd(), load_ghcnh()
    rows = []
    for net in NETWORKS:
        j = requests.get(f"https://mesonet.agron.iastate.edu/geojson/network/{net}.geojson", timeout=60).json()
        for f in j["features"]:
            p = f["properties"]
            if not p.get("online") or p.get("archive_end"):
                continue
            lon, lat = f["geometry"]["coordinates"][:2]
            begin = int((p.get("archive_begin") or "2100")[:4])
            awos = 1 if (p.get("attributes") or {}).get("IS_AWOS") == "1" else 0
            name = (p.get("sname") or p["sid"]).replace("_", " ").title().replace("Arpt", "Airport").replace(" Apt", " Airport")
            rows.append([p["sid"], f"{name}, {p.get('state', '')}", round(lat, 4), round(lon, 4), begin, awos,
                         ghcnh_id(p["sid"], lat, lon, isd, ghcnh)])
    n = sum(1 for r in rows if r[6])
    towers = wtm_rows()
    js = "/* generated by tools/fetch_stations.py (Iowa Environmental Mesonet station lists; NOAA NCEI GHCNh ids) */\n" + \
         "window.WE_STATIONS = " + json.dumps(rows + towers, separators=(",", ":")) + ";\n"
    OUT.write_text(js, encoding="utf-8")
    print(len(rows), "airports,", n, "with GHCNh ids;", len(towers), "West Texas Mesonet towers;", len(js) // 1024, "KB")
    for r in rows:
        if r[0] in ("LBB", "MAF", "AMA", "HOB", "INK", "MRF", "GNC", "F05", "0F2", "ELP"):
            print(r)


if __name__ == "__main__":
    main()
