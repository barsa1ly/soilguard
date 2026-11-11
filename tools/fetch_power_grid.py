"""Fetch NASA POWER monthly climatology (2001-2025, MERRA-2 0.5 x 0.625 deg) over the 48 contiguous states and DC.

Writes raw/power_grid.json: {"lat,lon": {PARAM: {JAN..DEC, ANN}}}
The regional API takes one parameter and a box at most 10 degrees on a side per request, so the box is cut into tiles;
the grid points are the same whichever tile returns them. Run it again to fill any tile that failed.
"""
import json
import time
from pathlib import Path

import requests

PARAMS = ["WS10M", "WD10M", "PRECTOTCORR", "T2M"]  # what tools/build_layers.py uses
S, N, W, E = 24.0, 50.0, -125.625, -66.25  # the contiguous states with a cell to spare on every side
LATS = [S, 32.5, 41.0, N]
LONS = [round(W + (E - W) * i / 7, 3) for i in range(8)]  # 7 tiles of about 8.5 degrees
TILES = [(LATS[i], LATS[i + 1], LONS[j], LONS[j + 1]) for i in range(len(LATS) - 1) for j in range(len(LONS) - 1)]
URL = "https://power.larc.nasa.gov/api/temporal/climatology/regional"
OUT = Path(__file__).parent / "raw" / "power_grid.json"


def main():
    grid = json.loads(OUT.read_text()) if OUT.exists() else {}
    done = json.loads(OUT.with_suffix(".tiles.json").read_text()) if OUT.with_suffix(".tiles.json").exists() else []
    for p in PARAMS:
        for t in TILES:
            tag = f"{p} {t}"
            if tag in done:
                continue
            q = dict(parameters=p, community="AG", format="JSON",
                     **{"latitude-min": t[0], "latitude-max": t[1],
                        "longitude-min": t[2], "longitude-max": t[3]})
            for attempt in range(5):
                try:
                    r = requests.get(URL, params=q, timeout=300)
                    if r.ok:
                        break
                    print("retry", tag, r.status_code, r.text[:200])
                except requests.RequestException as e:
                    print("retry", tag, e)
                time.sleep(10 * (attempt + 1))
            else:
                print("FAILED", tag)
                continue
            for f in r.json()["features"]:
                lon, lat = f["geometry"]["coordinates"][:2]
                key = f"{lat:.3f},{lon:.3f}"
                grid.setdefault(key, {})[p] = f["properties"]["parameter"][p]
            done.append(tag)
            OUT.write_text(json.dumps(grid))
            OUT.with_suffix(".tiles.json").write_text(json.dumps(done))
            print(tag, "ok", len(grid), flush=True)
            time.sleep(1)  # one request at a time, a second apart
    print(len(done), "of", len(PARAMS) * len(TILES), "tiles;", len(grid), "points")


if __name__ == "__main__":
    main()
