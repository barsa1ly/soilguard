"""Build the Soil maps theme's statewide salinity overlays and the legend of the USGS total-element maps:
    python tools/build_soilmaps.py TX OK      (those states)
    python tools/build_soilmaps.py all        (the 48 contiguous states and DC)
    python tools/build_soilmaps.py legend     (data/soilchem_legend.json only)

Run it after tools/build_layers.py, which rewrites each state's overlays.json without these layers.

Inputs (tools/raw/soilmaps, fetched once when missing; the GeoTIFFs answer no browser request, so the app cannot read them):
  ec_025.tif   UC Davis SoilWeb 800 m CONUS grid: EC (dS/m), thickness-weighted 0-25 cm, component- and map-unit-area
               weighted (Walkinshaw, O'Geen and Beaudette, Soil Properties, California Soil Resource Lab, from SSURGO)
  sar.tif      the same: SAR, the maximum of all horizons (the whole profile, not the surface)
  ds801/       USGS Data Series 801 (Smith et al. 2013) CSV: site.txt, top5cm.txt, ahorizon.txt, chorizon.txt
  ../us_states_5m.json  US Census state outlines, as tools/build_layers.py

Outputs:
  data/states/XX/layer_soil_ec.png   EC classes < 2, 2-4, 4-8, 8-16, >= 16 dS/m (the Soil Survey Manual's salinity classes)
  data/states/XX/layer_soil_sar.png  SAR classes < 6, 6-13, 13-20, >= 20 (13: the U.S. Salinity Laboratory's sodic limit)
  data/states/XX/overlays.json       gains layers.soil_ec and layers.soil_sar (file, title, unit, legend, note) and
                                     stats.soil (share of the state's mapped area in each class), on the same 1 km
                                     Web Mercator grid and bounds as the erosion overlays (build_layers.build)
  data/states/XX.json, data/states.js  patched in place the way tools/build_states.py writes them (files, stats, meta),
                                     so that script need not be run again; it carries them over when it is
  data/soilchem_legend.json          the class limits of the USGS soil geochemistry WMS (mrdata.usgs.gov/services/soils),
                                     which draws each element's inverse-distance surface in ten classes and publishes no
                                     legend: the national deciles of the DS-801 site values, censored values ("<0.01")
                                     taken at their detection limit, classes closed above (a site at the 10th percentile
                                     is in the lowest class). Checked by sampling the WMS's colours at the sites (P and
                                     Na top 5 cm, K A horizon, and the heavily censored S of the C horizon, 22% below
                                     0.01%): each class's sites sit in these limits, and ties leave the classes between
                                     them empty, as on the WMS (C horizon S: only classes 1, 5, 7, 9 and 10 drawn).
"""
import csv
import json
import math
import sys
import zipfile
from pathlib import Path

import numpy as np
import rasterio
import requests
from rasterio.features import geometry_mask
from rasterio.transform import from_origin
from rasterio.warp import Resampling, reproject
from shapely.geometry import mapping
from shapely.ops import transform as shp_transform

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
from build_layers import NAMES, RES, classify, state_geometry, to_ll, to_merc, to_png  # noqa: E402  (the erosion overlays' grid)

RAW = HERE / "raw" / "soilmaps"
DATA = HERE.parent / "data"
SOILWEB = "https://casoilresource.lawr.ucdavis.edu/800m_grids/rasters/"
DS801 = "https://mrdata.usgs.gov/ds-801/ds-801-csv.zip"

EC_BREAKS, EC_COLORS = [2, 4, 8, 16], ["#f3efdc", "#f6d46b", "#ee9a3a", "#d4472a", "#7f1a16"]
EC_LABELS = ["< 2  Non-saline", "2–4  Very slightly saline", "4–8  Slightly saline", "8–16  Moderately saline", "≥ 16  Strongly saline"]
SAR_BREAKS, SAR_COLORS = [6, 13, 20], ["#f3efdc", "#c6b0dc", "#8a64bd", "#47237f"]
SAR_LABELS = ["< 6", "6–13", "13–20  Sodic", "≥ 20  Sodic"]
CREDIT = ("UC Davis SoilWeb 800 m grid from SSURGO (Walkinshaw, O'Geen and Beaudette, Soil Properties, California Soil "
          "Resource Lab), components and map units area-weighted in each cell")
LAYERS = {
    "soil_ec": {"src": "ec_025.tif", "breaks": EC_BREAKS, "colors": EC_COLORS, "labels": EC_LABELS,
                "title": "Salinity: EC, 0–25 cm (soil survey)", "unit": "dS/m",
                "note": "Electrical conductivity of the saturated-paste extract, thickness-weighted over 0–25 cm: the "
                        "soil survey's representative values, not a test of the field. Classes from the Soil Survey "
                        f"Manual. {CREDIT}."},
    "soil_sar": {"src": "sar.tif", "breaks": SAR_BREAKS, "colors": SAR_COLORS, "labels": SAR_LABELS,
                 "title": "Sodicity: SAR, profile maximum (soil survey)", "unit": "ratio",
                 "note": "Sodium adsorption ratio, the highest of any horizon in the profile (often a subsoil), not "
                         "the surface: soil survey representative values. SAR 13 or more is sodic (U.S. Salinity "
                         f"Laboratory). {CREDIT}."},
}

# the elements of the Fertility layer: the CSV column and the WMS's unit
ELEMENTS = [("P", "p_ppm", "mg/kg"), ("K", "k_pct", "%"), ("Ca", "ca_pct", "%"), ("Mg", "mg_pct", "%"), ("S", "s_pct", "%"),
            ("Zn", "zn_ppm", "mg/kg"), ("Fe", "fe_pct", "%"), ("Mn", "mn_ppm", "mg/kg"), ("Cu", "cu_ppm", "mg/kg"), ("Na", "na_pct", "%")]
HORIZONS = [("Top5", "top5cm", "top 0–5 cm"), ("A", "ahorizon", "A horizon"), ("C", "chorizon", "C horizon")]
WMS_COLORS = ["#0000ff", "#3661ff", "#38acff", "#00ffff", "#91ffb4", "#d2ff69", "#ffff00", "#ffb700", "#ff6f00", "#ff0000"]  # read from the WMS's own images


def fetch(name, url):
    p = RAW / name
    if not p.exists():
        RAW.mkdir(parents=True, exist_ok=True)
        print("fetching", url)
        with requests.get(url, stream=True, timeout=600) as r:
            r.raise_for_status()
            with open(p, "wb") as f:
                for b in r.iter_content(1 << 20):
                    f.write(b)
    return p


def ds801():
    d = RAW / "ds801"
    if not (d / "top5cm.txt").exists():
        with zipfile.ZipFile(fetch("ds-801-csv.zip", DS801)) as z:
            z.extractall(d)
    return d


def nice(v, unit):
    """A class limit as the lab reports it: whole mg/kg above 10, else 2 significant figures; % to 2 decimals or 2 figures."""
    if v == 0:
        return 0
    if unit == "mg/kg" and v >= 10:
        return int(round(v))
    return float(f"{v:.2g}") if v < 0.1 else round(v, 2)


def legend_json():
    d = ds801()
    out = {"source": "USGS Data Series 801, Smith et al. (2013), doi:10.3133/ds801; WMS https://mrdata.usgs.gov/services/soils",
           "method": "national deciles of the site values, censored values at their detection limit; class k holds values "
                     "above limit k-1 up to limit k; the WMS colours, lowest first",
           "colors": WMS_COLORS, "elements": {}}
    for code, fname, label in HORIZONS:
        rows = list(csv.DictReader(open(d / f"{fname}.txt", encoding="utf-8")))
        for el, col, unit in ELEMENTS:
            vals, cens, dl = [], 0, None
            for r in rows:
                if r[col]:
                    vals.append(float(r[col]))
                elif r.get(col + "_q", "").startswith("<"):
                    lim = float(r[col + "_q"][1:])
                    vals.append(lim)
                    cens += 1
                    dl = lim if dl is None else max(dl, lim)
            a = np.array(vals)
            br = [nice(float(x), unit) for x in np.percentile(a, range(10, 100, 10))]
            out["elements"].setdefault(el, {"unit": unit})[code] = {
                "label": label, "n": int(a.size), "censored": cens, "dl": dl, "breaks": br,
                "median": nice(float(np.median(a)), unit), "max": nice(float(a.max()), unit)}
    p = DATA / "soilchem_legend.json"
    p.write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    print("wrote", p.name, p.stat().st_size // 1024, "KB")


def build(code):
    name = NAMES[code][0]
    out = DATA / "states" / code
    ov_path = out / "overlays.json"
    if not ov_path.exists():
        sys.exit(f"{code}: no overlays.json; run tools/build_layers.py {code} first")
    # the erosion overlays' grid (build_layers.build): 1 km Web Mercator cells around the state's outline, one cell of margin
    geom = state_geometry(name)
    gm = shp_transform(lambda x, y, z=None: to_merc.transform(x, y), geom)
    minx, miny, maxx, maxy = gm.bounds
    minx, miny = math.floor(minx / RES) * RES - RES, math.floor(miny / RES) * RES - RES
    maxx, maxy = math.ceil(maxx / RES) * RES + RES, math.ceil(maxy / RES) * RES + RES
    W, H = int((maxx - minx) / RES), int((maxy - miny) / RES)
    tf = from_origin(minx, maxy, RES, RES)
    inside = geometry_mask([mapping(gm)], (H, W), tf, invert=True)
    lon0, lat0 = to_ll.transform(minx, miny)
    lon1, lat1 = to_ll.transform(maxx, maxy)
    bounds = [[round(lat0, 6), round(lon0, 6)], [round(lat1, 6), round(lon1, 6)]]
    ov = json.loads(ov_path.read_text(encoding="utf-8"))
    if any(abs(a - b) > 1e-5 for p, q in zip(bounds, ov["bounds"]) for a, b in zip(p, q)):
        sys.exit(f"{code}: grid bounds {bounds} differ from overlays.json {ov['bounds']}")
    stats = {}
    for key, L in LAYERS.items():
        with rasterio.open(fetch(L["src"], SOILWEB + L["src"])) as src:
            arr = np.full((H, W), src.nodata, np.float32)
            reproject(rasterio.band(src, 1), arr, dst_transform=tf, dst_crs="EPSG:3857", resampling=Resampling.nearest, dst_nodata=src.nodata)
            ok = inside & (arr != src.nodata) & np.isfinite(arr) & (arr >= 0)
        to_png(classify(arr, L["breaks"], L["colors"], ok), out / f"layer_{key}.png")
        idx = np.digitize(arr, L["breaks"])
        stats[key] = [round(float(((idx == k) & ok).sum() / max(1, ok.sum()) * 100), 1) for k in range(len(L["colors"]))]
        ov["layers"][key] = {"file": f"data/states/{code}/layer_{key}.png", "title": L["title"], "unit": L["unit"],
                             "legend": [{"label": l, "color": c} for l, c in zip(L["labels"], L["colors"])], "note": L["note"]}
    ov.setdefault("stats", {})["soil"] = stats  # % of the state's mapped cells in each class, lowest first
    ov_path.write_text(json.dumps(ov, separators=(",", ":")), encoding="utf-8")
    print(code, stats)
    # the state's file as tools/build_states.py would write it from overlays.json
    sp = DATA / "states" / f"{code}.json"
    rec = json.loads(sp.read_text(encoding="utf-8"))
    if rec.get("overlays"):
        rec["overlays"]["files"].update({k: ov["layers"][k]["file"] for k in LAYERS})
        rec["overlays"]["stats"] = ov["stats"]
        sp.write_text(json.dumps(rec, separators=(",", ":")), encoding="utf-8")


def patch_meta():
    """The layers' titles, units, legends and notes in data/states.js's meta, as tools/build_states.py puts them there."""
    p = DATA / "states.js"
    text = p.read_text(encoding="utf-8")
    head, body = text.split("window.WG_STATES = ", 1)
    js = json.loads(body.rstrip().rstrip(";"))
    for key, L in LAYERS.items():
        js["meta"][key] = {"title": L["title"], "unit": L["unit"], "legend": [{"label": l, "color": c} for l, c in zip(L["labels"], L["colors"])], "note": L["note"]}
    p.write_text(head + "window.WG_STATES = " + json.dumps(js, separators=(",", ":")) + ";\n", encoding="utf-8")
    print("patched states.js meta")


def main():
    args = [a.upper() for a in sys.argv[1:]] or ["TX"]
    if args == ["LEGEND"]:
        return legend_json()
    codes = sorted(NAMES) if args == ["ALL"] else args
    bad = [c for c in codes if c not in NAMES]
    if bad:
        sys.exit(f"{', '.join(bad)}: not one of the contiguous states and DC")
    for code in codes:
        build(code)
    patch_meta()
    legend_json()


if __name__ == "__main__":
    main()
