"""Land-cover shares of every contiguous state and DC, from NLCD 2021, for the legend of the Land cover layer.

Reads data/states/XX.json (outline) and asks the MRLC WCS 2.0.1 (NLCD_2021_Land_Cover_L48, 30 m, EPSG:5070 Albers equal area)
for each state's box in tiles of at most TILE x TILE cells. The server resamples to a coarser grid (scalesize, nearest
neighbour, so class codes stay intact); the coarser the bigger the state (see cell_m), so a state is about 25 million
samples at most. Each tile's cells are kept when their centre lies inside the state's outline (rasterised on the returned
grid) and inside the tile's own extent (no cell counted twice). EPSG:5070 keeps equal area, so a cell's area is its size
squared and needs no latitude correction.

Writes data/states/landcover.json: {src, classes: [codes], states: {XX: {res (m), km2: [km2 per class, in classes order]}}}.
Shares are km2 / total; the app computes the percentages. Run: python tools/build_landcover.py [TX OK ...]  (a rerun
for some states only keeps the others)
"""
import io
import json
import math
import sys
import time
from pathlib import Path

import numpy as np
import rasterio
import requests
from pyproj import Transformer
from rasterio.features import rasterize
from shapely.geometry import box, shape
from shapely.ops import transform as shp_transform

HERE = Path(__file__).parent
STATES = HERE.parent / "data" / "states"
URL = "https://www.mrlc.gov/geoserver/mrlc_download/NLCD_2021_Land_Cover_L48/wcs"
CLASSES = [11, 12, 21, 22, 23, 24, 31, 41, 42, 43, 52, 71, 81, 82, 90, 95]
TILE = 1800  # cells per tile side: a response of about 3 MB
TARGET = 25e6  # samples per state
T = Transformer.from_crs(4326, 5070, always_xy=True)


def cell_m(w, s, e, n):
    """Cell size (m, a multiple of 30) giving about TARGET samples over the state's box, 30 m for small states."""
    xs, ys = T.transform([w, e, w, e], [s, s, n, n])
    px = (max(xs) - min(xs)) * (max(ys) - min(ys)) / 900.0
    return 30 * max(1, math.ceil(math.sqrt(px / TARGET)))


def get(x0, y0, x1, y1, n, m):
    q = {"service": "WCS", "version": "2.0.1", "request": "GetCoverage", "coverageId": "NLCD_2021_Land_Cover_L48",
         "subset": [f"X({x0:.0f},{x1:.0f})", f"Y({y0:.0f},{y1:.0f})"], "format": "image/geotiff", "scalesize": f"i({n}),j({m})"}
    for k in range(4):
        try:
            r = requests.get(URL, params=q, timeout=180)
            if r.status_code == 200 and r.content[:2] in (b"MM", b"II"):
                return r.content
            print("  retry", r.status_code, r.text[:120])
        except requests.RequestException as ex:
            print("  retry", ex)
        time.sleep(5 * (k + 1))
    raise RuntimeError("WCS failed")


def state(code):
    rec = json.loads((STATES / f"{code}.json").read_text(encoding="utf-8"))
    poly = shp_transform(T.transform, shape(rec["outline"]))
    x0, y0, x1, y1 = poly.bounds
    c = cell_m(*rec["box"])
    span = TILE * c
    counts = np.zeros(256)
    for ty in np.arange(y0, y1, span):
        for tx in np.arange(x0, x1, span):
            ex, ey = min(tx + span, x1), min(ty + span, y1)
            n, m = max(1, round((ex - tx) / c)), max(1, round((ey - ty) / c))
            if not poly.intersects(box(tx, ty, ex, ey)):
                continue
            with rasterio.open(io.BytesIO(get(tx, ty, ex, ey, n, m))) as d:
                a, tr = d.read(1), d.transform
                inside = rasterize([(poly, 1)], out_shape=a.shape, transform=tr, fill=0, dtype="uint8").astype(bool)
                cols = tr.c + (np.arange(a.shape[1]) + 0.5) * tr.a  # cell centres; kept when inside this tile's extent
                rows = tr.f + (np.arange(a.shape[0]) + 0.5) * tr.e
                inside &= ((cols >= tx) & (cols < ex))[None, :] & ((rows >= ty) & (rows < ey))[:, None]
                counts += np.bincount(a[inside].ravel(), minlength=256) * (abs(tr.a) * abs(tr.e) / 1e6)  # km2 of the cell actually returned
    km2 = [round(float(counts[k]), 1) for k in CLASSES]
    other = float(counts.sum() - sum(counts[k] for k in CLASSES))
    return {"res": c, "km2": km2}, other


def main():
    out = STATES / "landcover.json"
    doc = json.loads(out.read_text()) if out.exists() else {"src": "NLCD 2021 Land Cover (CONUS), MRLC WCS", "classes": CLASSES, "states": {}}
    only = {a.upper() for a in sys.argv[1:]}
    codes = sorted(p.stem for p in STATES.glob("??.json") if p.stem not in ("AK", "HI", "PR"))
    for code in codes:
        if only and code not in only:
            continue
        t = time.time()
        doc["states"][code], other = state(code)
        tot = sum(doc["states"][code]["km2"])
        print(code, doc["states"][code]["res"], "m", round(tot), "km2", "unclassified km2", round(other, 1), f"{time.time() - t:.0f}s", flush=True)
        out.write_text(json.dumps(doc, separators=(",", ":")), encoding="utf-8")


if __name__ == "__main__":
    main()
