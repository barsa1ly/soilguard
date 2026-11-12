"""Build the small lookups the basin part of the Soil maps tab (js/basins.js) needs, that no browser can read live:
    python tools/build_basins.py rfactor TX OK   (the R factor lookups of those states)
    python tools/build_basins.py rfactor all     (the 48 contiguous states and DC)
    python tools/build_basins.py atlas14 TX      (the NOAA Atlas 14 24-hour design-storm depths of Texas)

Inputs (tools/raw/basins, fetched once when missing):
  RF7100_CONUS.txt  USGS, Wieczorek & LaMotte (2010), "Estimated 30-year (1971-2000) mean annual rainfall and runoff
                    factor (R factor of the Universal Soil Loss Equation)" per NHDPlus Version 2 catchment (COMID),
                    from the PRISM-based R grid of Daly & Taylor; ScienceBase item 573b6028e4b0dae0d5e3ae16, public
                    domain. CAT_RF7100: the catchment's mean R in hundreds of ft-tonf-in/(ac-h-yr), the US customary
                    unit of the RUSLE handbook (AH 703). The file has no geometry and ScienceBase sends no CORS header.
  sc_XX.json        the NHDPlus V2 COMIDs EPA StreamCat lists in each state (api.epa.gov/StreamCat, any metric with
                    state=XX): only used to split the national table by state.
  xx{2,10,100}yr24ha.zip  NOAA Atlas 14 precipitation-frequency grids (hdsc.nws.noaa.gov/pub/hdsc/data/<state>/),
                    partial-duration series, 24-hour depth in thousandths of an inch, 30 arc-seconds. NOAA's point
                    service (PFDS) sends no CORS header, so the app reads these instead.

Outputs:
  data/states/XX/rfactor.json  {"src", "unit", "n", "c0", "c", "q"}: the state's COMIDs sorted, c0 the first and "c" the
                               steps between them; "q" = round(100 ln R), the first and then the changes from COMID to
                               COMID (R kept to 1%: within 0.5%). Each number is written in base 32, high digits first:
                               a digit that ends the number is one of 0-9a-v, a digit before it one of A-Z!#$%&*; a change
                               is zigzag-coded first (0 -1 1 -2 2 ... -> 0 1 2 3 4 ...). About 2 characters a COMID:
                               200 KB for Texas (60 KB as sent gzipped). js/basins.js decodes it (COMID -> R); the
                               point's COMID comes from USGS NLDI comid/position. DC: StreamCat lists no COMID under DC,
                               so none is built and the app reads Maryland's and Virginia's files there.
  data/states/XX/atlas14.json  {"src", "unit", "x0", "y0", "d", "nx", "ny", "p": {"2": [...], "10": [...], "100": [...]}}
                               24-hour depths in mm on a 0.05 degree grid (cell centres from x0, y0 in the south-west,
                               rows south to north), each cell the mean of the 6 x 6 Atlas 14 cells it holds; each row
                               [first column with a value, that value, then the change from cell to cell], empty where
                               the row holds none. Texas only so far (Atlas 14 Volume 11); other states' grids are
                               published by volume region (hdsc.nws.noaa.gov/pub/hdsc/data/<region>/) and need a clip.
                               js/basins.js asks only for the states in its A14 list: add a new state's code there.
"""
import json
import sys
import warnings
import zipfile
from pathlib import Path

import numpy as np
import requests

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
from build_layers import NAMES  # noqa: E402  (the 48 contiguous states and DC)

RAW = HERE / "raw" / "basins"
DATA = HERE.parent / "data"
RF_URL = "https://www.sciencebase.gov/catalog/file/get/573b6028e4b0dae0d5e3ae16?f=__disk__32%2F97%2F60%2F329760d5ddb2ab8ea2baf9d47060f461cb3a17d9"
SC_URL = "https://api.epa.gov/StreamCat/streams/metrics?name=precip9120&areaOfInterest=cat&state={}"
A14_URL = "https://hdsc.nws.noaa.gov/pub/hdsc/data/{0}/{0}{1}yr24ha.zip"


def fetch(name, url, timeout=600):
    p = RAW / name
    if not p.exists():
        RAW.mkdir(parents=True, exist_ok=True)
        print("fetching", url)
        with requests.get(url, stream=True, timeout=timeout) as r:
            r.raise_for_status()
            tmp = p.with_suffix(".part")
            with open(tmp, "wb") as f:
                for b in r.iter_content(1 << 20):
                    f.write(b)
            tmp.replace(p)
    return p


def state_comids(code):
    """the COMIDs StreamCat lists in the state, kept as a plain list (its answer for Texas is 11 MB)"""
    p = RAW / f"sc_{code}.json"
    if not p.exists():
        print("StreamCat", code)
        r = requests.get(SC_URL.format(code), timeout=900)
        r.raise_for_status()
        p.write_text(json.dumps(sorted({int(x["comid"]) for x in r.json()["items"]})))
    return json.loads(p.read_text())


_RF = None


def rf_table():
    """RF7100's catchment R (CAT_RF7100) as two arrays sorted by COMID; the 119 MB text is read once into a .npy"""
    global _RF
    if _RF is None:
        npy = RAW / "RF7100_CONUS.npy"
        if not npy.exists():
            src = fetch("RF7100_CONUS.txt", RF_URL)
            try:
                import pandas as pd
                d = pd.read_csv(src, usecols=["COMID", "CAT_RF7100"]).to_numpy(np.float64)
            except ImportError:
                d = np.loadtxt(src, delimiter=",", skiprows=1, usecols=(0, 1))
            d = d[d[:, 1] > -9000]  # -9999: no R (catchments outside PRISM's grid)
            np.save(npy, d[np.argsort(d[:, 0])])
        a = np.load(npy)
        _RF = a[:, 0].astype(np.int64), a[:, 1]
    return _RF


FIN, CON = "0123456789abcdefghijklmnopqrstuv", "ABCDEFGHIJKLMNOPQRSTUVWXYZ!#$%&*"


def b32(v):
    """a whole number >= 0 in base 32: the last digit from FIN, the ones before it from CON (no separators needed)"""
    v = int(v)
    if v < 0:
        raise ValueError(v)
    g = [v & 31]
    v >>= 5
    while v:
        g.append(v & 31)
        v >>= 5
    return "".join(CON[x] for x in reversed(g[1:])) + FIN[g[0]]


def zigzag(v):
    return 2 * v if v >= 0 else -2 * v - 1


def rfactor(code):
    ids = np.array(state_comids(code), np.int64)
    if not len(ids):
        print(code, "StreamCat lists no COMID here: not built")
        return
    c, r = rf_table()
    i = np.clip(np.searchsorted(c, ids), 0, len(c) - 1)
    ok = c[i] == ids
    ids, q = ids[ok], np.round(100 * np.log(np.maximum(r[i[ok]], 0.01))).astype(np.int64)
    out = {"src": "USGS RF7100 (Wieczorek & LaMotte 2010): mean annual R of each NHDPlus V2 catchment, from the PRISM-based "
                  "1971-2000 R grid of Daly & Taylor; the state's COMIDs as listed by EPA StreamCat",
           "unit": "hundreds of ft-tonf-in/(ac-h-yr)", "n": int(len(ids)), "c0": int(ids[0]),
           "c": "".join(b32(x) for x in np.diff(ids)),
           "q": b32(zigzag(int(q[0]))) + "".join(b32(zigzag(int(x))) for x in np.diff(q))}
    d = DATA / "states" / code
    d.mkdir(parents=True, exist_ok=True)
    (d / "rfactor.json").write_text(json.dumps(out, separators=(",", ":")))
    print(code, len(ok), "COMIDs,", len(ids), "with R,", round((d / "rfactor.json").stat().st_size / 1e3), "KB")


def read_asc(path):
    with zipfile.ZipFile(path) as z:
        name = next(n for n in z.namelist() if n.endswith(".asc"))
        with z.open(name) as f:
            head = {}
            for _ in range(6):
                k, v = f.readline().split()
                head[k.decode().lower()] = float(v)
            a = np.loadtxt(f, dtype=np.float32)
    a[a == head["nodata_value"]] = np.nan
    return head, a


def atlas14(code):
    st, step = code.lower(), 6  # 6 x 30" = 0.05 degree
    grids, H = {}, None
    for p in (2, 10, 100):
        head, a = read_asc(fetch(f"{st}{p}yr24ha.zip", A14_URL.format(st, p)))
        ny, nx = (a.shape[0] // step) * step, (a.shape[1] // step) * step
        a = a[a.shape[0] - ny:, :nx]  # whole blocks from the south-west corner
        with np.errstate(invalid="ignore"), warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)  # blocks wholly outside the state: NaN, as wanted
            m = np.nanmean(a.reshape(ny // step, step, nx // step, step), axis=(1, 3))[::-1]  # rows south to north
        mm = np.where(np.isnan(m), np.nan, np.round(m / 1000 * 25.4, 0))
        grids[str(p)] = mm
        H = head, ny // step, nx // step
    head, ny, nx = H
    d = head["cellsize"] * step
    rows = lambda g: [[None if np.isnan(v) else int(v) for v in row] for row in g]
    def code_row(row):  # [first column with a value, its value, then deltas]; a gap inside the row takes the value before it
        idx = [i for i, v in enumerate(row) if v is not None]
        if not idx:
            return []
        vals, last = [], None
        for v in row[idx[0]:idx[-1] + 1]:
            last = v if v is not None else last
            vals.append(last)
        return [idx[0], vals[0]] + [b - a for a, b in zip(vals, vals[1:])]
    out = {"src": f"NOAA Atlas 14 precipitation-frequency estimates ({code}), partial-duration series, 24-hour depth, mean of each "
                  "0.05-degree block of the 30-arc-second grids (hdsc.nws.noaa.gov/pub/hdsc/data)", "unit": "mm",
           "x0": round(head["xllcorner"] + d / 2, 6), "y0": round(head["yllcorner"] + d / 2, 6), "d": round(d, 6), "nx": nx, "ny": ny,
           "p": {k: [code_row(r) for r in rows(g)] for k, g in grids.items()}}
    f = DATA / "states" / code / "atlas14.json"
    f.write_text(json.dumps(out, separators=(",", ":")))
    print(code, nx, "x", ny, "cells,", round(f.stat().st_size / 1e3), "KB; add", code, "to A14 in js/basins.js if it is not there")


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in ("rfactor", "atlas14", "fetch"):
        sys.exit(__doc__)
    args = [a.upper() for a in sys.argv[2:]] or ["TX"]
    codes = sorted(NAMES) if args == ["ALL"] else args
    bad = [c for c in codes if c not in NAMES]
    if bad:
        sys.exit(f"{', '.join(bad)}: not one of the contiguous states and DC")
    for c in codes:
        {"rfactor": rfactor, "atlas14": atlas14, "fetch": state_comids}[sys.argv[1]](c)


if __name__ == "__main__":
    main()
