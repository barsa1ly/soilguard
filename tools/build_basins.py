"""Build the small lookups the basin part of the Soil maps tab (js/basins.js) needs, that no browser can read live:
    python tools/build_basins.py rfactor TX OK   (the R factor lookups of those states)
    python tools/build_basins.py rfactor all     (the 48 contiguous states and DC)
    python tools/build_basins.py atlas14 all     (the NOAA Atlas 14 24-hour design-storm depths of every state it covers)
    python tools/build_basins.py atlas14 IA MO   (those states' depths)

Inputs (tools/raw/basins, fetched once when missing):
  RF7100_CONUS.txt  USGS, Wieczorek & LaMotte (2010), "Estimated 30-year (1971-2000) mean annual rainfall and runoff
                    factor (R factor of the Universal Soil Loss Equation)" per NHDPlus Version 2 catchment (COMID),
                    from the PRISM-based R grid of Daly & Taylor; ScienceBase item 573b6028e4b0dae0d5e3ae16, public
                    domain. CAT_RF7100: the catchment's mean R in hundreds of ft-tonf-in/(ac-h-yr), the US customary
                    unit of the RUSLE handbook (AH 703). The file has no geometry and ScienceBase sends no CORS header.
  sc_XX.json        the NHDPlus V2 COMIDs EPA StreamCat lists in each state (api.epa.gov/StreamCat, any metric with
                    state=XX): only used to split the national table by state.
  rr{2,10,100}yr24ha.zip  NOAA Atlas 14 precipitation-frequency grids, one set per region folder
                    (hdsc.nws.noaa.gov/pub/hdsc/data/<rr>/: see A14_VOL), partial-duration series, 24-hour depth in
                    thousandths of an inch, 30 arc-seconds (ESRI ASCII grid, with its .prj and FGDC .xml). NOAA's
                    point service (PFDS) sends no CORS header, so the app reads these instead. Oregon and Washington
                    have no Atlas 14 volume yet (Volume 12 covers Idaho, Montana and Wyoming only): none is built.

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
                               the row holds none. The cells are the same for every state (Texas's grid sets them) and
                               cover the state's box; a cell takes the state's own volume where that has a value, else a
                               neighbouring volume's (edge cells outside the state); cells more than about 0.1 degree
                               (2 cells) outside the state's outline are left empty. js/basins.js asks only for the
                               states in its A14 list (the run prints it): add a newly built state's code there.
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
# the NOAA Atlas 14 volumes, by the HDSC folder whose grids hold them: the volume, the states it covers, and the grid's
# extent [w, s, e, n] (from its header, rounded outward), so that a state's build fetches only the grids its box reaches
A14_VOL = {
    "sw": ("Volumes 1 and 6", ["AZ", "CA", "NM", "NV", "UT"], [-124.76, 31.32, -102.98, 42.98]),  # one grid for both
    "orb": ("Volume 2", ["DC", "DE", "IL", "IN", "KY", "MD", "NC", "NJ", "OH", "PA", "SC", "TN", "VA", "WV"], [-91.54, 31.95, -73.87, 42.53]),
    "mw": ("Volume 8", ["CO", "IA", "KS", "MI", "MN", "MO", "ND", "NE", "OK", "SD", "WI"], [-109.37, 33.31, -82.37, 49.43]),
    "se": ("Volume 9", ["AL", "AR", "FL", "GA", "LA", "MS"], [-94.93, 24.46, -79.95, 36.80]),
    "ne": ("Volume 10", ["CT", "MA", "ME", "NH", "NY", "RI", "VT"], [-82.30, 38.49, -66.47, 48.75]),
    "tx": ("Volume 11", ["TX"], [-106.66, 25.82, -93.49, 36.52]),
    "inw": ("Volume 12", ["ID", "MT", "WY"], [-117.26, 40.98, -104.02, 49.02]),
}
A14_OF = {s: r for r, (_, states, _) in A14_VOL.items() for s in states}
A14_BUF = 0.1  # degrees kept outside the state's outline


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


# The 0.05-degree cells, the same for every state, in 240ths of a degree: column i spans x = 12 i - 1 .. 12 i + 11 and
# row j spans y = 12 j + 7 .. 12 j + 19 (Texas's grid has its corner there). The 30" cells of every grid but Volume 2's
# have their edges on odd 240ths, so each block holds 6 x 6 of them; Volume 2's cells are 0.02% smaller and drift by up
# to 0.4 cell across the grid, so each of those goes to the block that holds its centre.
col_of = lambda x: int(np.floor((x * 240 + 1) / 12))
row_of = lambda y: int(np.floor((y * 240 - 7) / 12))
_A14 = {}


def a14_blocks(region, p):
    """the region's p-year grid as 0.05-degree means in mm: (i0, j0, B), B[j - j0, i - i0] for row j, column i, rows
    south to north, NaN where the block holds no value"""
    if (region, p) not in _A14:
        head, a = read_asc(fetch(f"{region}{p}yr24ha.zip", A14_URL.format(region, p)))
        nr, nc = a.shape
        cs, X, Y = head["cellsize"] * 240, head["xllcorner"] * 240, head["yllcorner"] * 240
        if abs(cs - 2) < 1e-4 and abs(X - round(X)) < 0.05 and abs(Y - round(Y)) < 0.05 and round(X) % 2 and round(Y) % 2:
            X, Y = round(X), round(Y)
            i0, j0 = (X + 1) // 12, (Y - 7) // 12
            w, s = (X - (12 * i0 - 1)) // 2, (Y - (12 * j0 + 7)) // 2  # 30" cells from the first block's edge to the grid's
            ni, nj = -(-(w + nc) // 6), -(-(s + nr) // 6)
            g = np.full((nj * 6, ni * 6), np.nan, np.float32)  # rows north to south, as in the file
            g[nj * 6 - s - nr:nj * 6 - s, w:w + nc] = a
            with np.errstate(invalid="ignore"), warnings.catch_warnings():
                warnings.simplefilter("ignore", RuntimeWarning)  # blocks with no value: NaN, as wanted
                m = np.nanmean(g.reshape(nj, 6, ni, 6), axis=(1, 3))[::-1]  # rows south to north
        else:
            x = head["xllcorner"] + (np.arange(nc) + 0.5) * head["cellsize"]
            y = head["yllcorner"] + (np.arange(nr)[::-1] + 0.5) * head["cellsize"]
            ci, rj = np.floor((x * 240 + 1) / 12).astype(np.int64), np.floor((y * 240 - 7) / 12).astype(np.int64)
            i0, j0 = int(ci.min()), int(rj.min())
            ni, nj = int(ci.max()) - i0 + 1, int(rj.max()) - j0 + 1
            k = ((rj - j0)[:, None] * ni + (ci - i0)[None, :]).ravel()
            v = a.ravel()
            has = ~np.isnan(v)
            with np.errstate(invalid="ignore", divide="ignore"):
                m = (np.bincount(k[has], v[has].astype(np.float64), ni * nj) / np.bincount(k[has], minlength=ni * nj)).reshape(nj, ni)
        _A14[region, p] = int(i0), int(j0), np.where(np.isnan(m), np.nan, np.round(m / 1000 * 25.4, 0))
    return _A14[region, p]


def near_outline(outline, i0, j0, ni, nj):
    """True for the cells (rows j0.., columns i0..) whose centre is inside the outline or within about A14_BUF of it"""
    rings = [np.asarray(r, np.float64) for poly in (outline["coordinates"] if outline["type"] == "MultiPolygon" else [outline["coordinates"]]) for r in poly]
    a = np.concatenate([r[:-1] for r in rings]), np.concatenate([r[1:] for r in rings])  # every edge, start and end
    (x1, y1), (x2, y2) = a[0].T, a[1].T
    xc, yc = (12 * (i0 + np.arange(ni)) + 5) / 240, (12 * (j0 + np.arange(nj)) + 13) / 240
    m = np.zeros((nj, ni), bool)
    for r, y in enumerate(yc):  # even-odd fill along each row of centres
        e = (y1 <= y) != (y2 <= y)
        xs = np.sort(x1[e] + (y - y1[e]) * (x2[e] - x1[e]) / (y2[e] - y1[e]))
        for xa, xb in zip(xs[0::2], xs[1::2]):
            m[r, (xc >= xa) & (xc < xb)] = True
    for (xa, ya), (xb, yb) in zip(*a):  # and every cell the outline passes through
        t = np.linspace(0, 1, int(np.hypot(xb - xa, yb - ya) / 0.01) + 2)
        c, r = np.floor(((xa + t * (xb - xa)) * 240 + 1) / 12).astype(int) - i0, np.floor(((ya + t * (yb - ya)) * 240 - 7) / 12).astype(int) - j0
        k = (c >= 0) & (c < ni) & (r >= 0) & (r < nj)
        m[r[k], c[k]] = True
    n = round(A14_BUF / 0.05)
    out, pad = m.copy(), np.pad(m, n)
    for dr in range(-n, n + 1):  # grown by n cells (a disc)
        for dc in range(-n, n + 1):
            if 0 < dr * dr + dc * dc <= n * n + 1:
                out |= pad[n + dr:n + dr + nj, n + dc:n + dc + ni]
    return out


def atlas14(code):
    if code not in A14_OF:
        print(code, "no NOAA Atlas 14 volume covers it (NOAA Atlas 2 still applies there): not built")
        return None
    rec = json.loads((DATA / "states" / f"{code}.json").read_text())
    w, s, e, n = rec["box"]
    i0, j0 = col_of(w - A14_BUF), row_of(s - A14_BUF)
    ni, nj = col_of(e + A14_BUF) - i0 + 1, row_of(n + A14_BUF) - j0 + 1
    own = A14_OF[code]
    regions = [own] + [r for r, (_, _, b) in A14_VOL.items() if r != own and b[0] < e + A14_BUF and b[2] > w - A14_BUF and b[1] < n + A14_BUF and b[3] > s - A14_BUF]
    keep = near_outline(rec["outline"], i0, j0, ni, nj)
    grids, used = {}, []
    for p in (2, 10, 100):
        g = np.full((nj, ni), np.nan)
        for r in regions:  # the state's own volume first, then a neighbour's where that is empty
            bi, bj, B = a14_blocks(r, p)
            ia, ib, ja, jb = max(i0, bi), min(i0 + ni, bi + B.shape[1]), max(j0, bj), min(j0 + nj, bj + B.shape[0])
            if ia >= ib or ja >= jb:
                continue
            sub, src = g[ja - j0:jb - j0, ia - i0:ib - i0], B[ja - bj:jb - bj, ia - bi:ib - bi]
            take = np.isnan(sub) & ~np.isnan(src) & keep[ja - j0:jb - j0, ia - i0:ib - i0]
            sub[take] = src[take]
            if take.any() and r not in used:
                used.append(r)
        grids[str(p)] = g
    has = ~np.isnan(grids["2"]) | ~np.isnan(grids["10"]) | ~np.isnan(grids["100"])
    rr, cc = np.nonzero(has.any(axis=1))[0], np.nonzero(has.any(axis=0))[0]
    if not len(rr):
        print(code, "no Atlas 14 value inside the state: not built")
        return None
    sr, sc = slice(rr[0], rr[-1] + 1), slice(cc[0], cc[-1] + 1)  # trimmed to the cells with a value
    i0, j0 = i0 + cc[0], j0 + rr[0]
    rows = lambda g: [[None if np.isnan(v) else int(v) for v in row] for row in g[sr, sc]]
    def code_row(row):  # [first column with a value, its value, then deltas]; a gap inside the row takes the value before it
        idx = [i for i, v in enumerate(row) if v is not None]
        if not idx:
            return []
        vals, last = [], None
        for v in row[idx[0]:idx[-1] + 1]:
            last = v if v is not None else last
            vals.append(last)
        return [idx[0], vals[0]] + [b - a for a, b in zip(vals, vals[1:])]
    vols = " and ".join(f"{A14_VOL[r][0]} ({r})" for r in used)
    out = {"src": f"NOAA Atlas 14 {vols} precipitation-frequency estimates ({code}), partial-duration series, 24-hour depth, mean "
                  "of each 0.05-degree block of the 30-arc-second grids (hdsc.nws.noaa.gov/pub/hdsc/data); cells over 0.1 degree "
                  "outside the state left empty", "unit": "mm",
           "x0": round((12 * i0 + 5) / 240, 6), "y0": round((12 * j0 + 13) / 240, 6), "d": 0.05, "nx": int(sc.stop - sc.start), "ny": int(sr.stop - sr.start),
           "p": {k: [code_row(r) for r in rows(g)] for k, g in grids.items()}}
    f = DATA / "states" / code / "atlas14.json"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps(out, separators=(",", ":")))
    kb = f.stat().st_size / 1e3
    print(code, vols, out["nx"], "x", out["ny"], "cells,", round(kb), "KB", flush=True)
    return kb


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in ("rfactor", "atlas14", "fetch"):
        sys.exit(__doc__)
    args = [a.upper() for a in sys.argv[2:]] or ["TX"]
    codes = sorted(NAMES) if args == ["ALL"] else args
    bad = [c for c in codes if c not in NAMES]
    if bad:
        sys.exit(f"{', '.join(bad)}: not one of the contiguous states and DC")
    done = {c: {"rfactor": rfactor, "atlas14": atlas14, "fetch": state_comids}[sys.argv[1]](c) for c in codes}
    if sys.argv[1] == "atlas14":
        built = sorted(c for c, kb in done.items() if kb)
        print(len(built), "files,", round(sum(done[c] for c in built)), "KB; js/basins.js lists the states that have one:")
        print("  const A14 = new Set([" + ", ".join(f'"{c}"' for c in sorted(set(built) | {p.parent.name for p in (DATA / "states").glob("*/atlas14.json")})) + "]);")


if __name__ == "__main__":
    main()
