"""Build states' statewide map overlays for the app:
    python tools/build_layers.py TX OK      (those states)
    python tools/build_layers.py all        (the 48 contiguous states and DC)
Then run tools/build_states.py, which puts them in each state's file the app loads when the state is chosen.

Inputs (tools/raw):
  wei.tif, weg_int.tif  - UC Davis SoilWeb 800 m CONUS grids derived from SSURGO
  power_grid.json       - NASA POWER monthly climatology 2001-2025 over the contiguous states (fetch_power_grid.py)
  county_c.json         - official NRCS climatic factor C symbols per county and survey area, with acres (fetch_county_c.py)
  survey_areas.json     - outlines of the survey areas in counties whose survey areas differ in C (fetch_county_c.py)
  us_states_5m.json, us_counties_5m.json - US Census 2010 state and county boundaries (5m generalization)

Outputs:
  data/states/XX/layer_susceptibility.png  WEQ bare-field potential  E = I * C/100  (t/ac/yr)
  data/states/XX/layer_soil_weg.png        Wind Erodibility Group (SSURGO)
  data/states/XX/layer_climate_c.png       wind-erosion climatic factor C (% of Garden City, KS)
  data/states/XX/layer_wind_spring.png     spring mean 10 m wind
  data/states/XX/overlays.json             image bounds, legends, statistics and spring-wind arrows

C is set county by county (county_table): the acre-weighted mean of the county's official NRCS climate-factor areas
where SSURGO rates it (by soil survey area within the county where its survey areas differ), else an estimate, the
county's Chepil C from NASA POWER times the median ratio of official to formula C over the rated counties.
stats.C_est_pct is the share of the state's area with an estimate, which the app's legend reports, and overlays.json
lists every county's C by SSURGO county code for the app's point and area results:
counties: {"115": [70.0, 0], "017": [100.8, 0, {"AZ633": 120.0, "AZ683": 20.0, "AZ707": 120.0, "AZ714": 120.0}]}
(C, 1 if estimated, survey areas' C; e.g. Dawson County, TX and Navajo County, AZ)
"""
import json
import math
import sys
from pathlib import Path

import numpy as np
import rasterio
import shapely
from PIL import Image
from pyproj import Transformer
from rasterio.features import geometry_mask, rasterize
from rasterio.transform import from_origin
from rasterio.warp import Resampling, reproject
from scipy import ndimage
from scipy.interpolate import RegularGridInterpolator
from scipy.spatial import cKDTree
from shapely import prepared
from shapely.geometry import Point, mapping, shape
from shapely.ops import transform as shp_transform, unary_union

HERE = Path(__file__).parent
RAW = HERE / "raw"
sys.path.insert(0, str(HERE))
from build_states import STATES  # noqa: E402  (postal code, Census name, FIPS, time offset, contiguous)
import fetch_county_c as FC  # noqa: E402  (its weights(), so the fetch and the build weigh symbols alike)

NAMES = {c: (n, f) for c, n, f, tz, l48 in STATES if l48}  # the states the climate inputs cover

RES = 1000.0  # metres, EPSG:3857
MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
DAYS = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

to_merc = Transformer.from_crs("EPSG:4326", "EPSG:3857", always_xy=True)
to_ll = Transformer.from_crs("EPSG:3857", "EPSG:4326", always_xy=True)
to_alb = Transformer.from_crs("EPSG:4326", "EPSG:5070", always_xy=True)


_cache = {}


def load(name):
    if name not in _cache:
        _cache[name] = json.loads((RAW / name).read_text(encoding="latin-1" if name.startswith("us_") else "utf-8"))
    return _cache[name]


def state_geometry(name):
    return shape(next(f for f in load("us_states_5m.json")["features"] if f["properties"]["NAME"] == name)["geometry"])


# climate-factor symbols read as "not rated" rather than as values:
#   0 anywhere: a place with wind has C above 0, and the states that use it (AL, AR, GA, LA, NC, VA) give 0 to every
#     rated county, which reads as "wind erosion not assessed";
#   100 in Michigan: 14 of the 15 Upper Peninsula counties carry it (Baraga has no climate-factor area), the Garden
#     City reference itself, against 5-6 in the Wisconsin counties across the border and single digits from the Chepil
#     formula with NASA POWER there.
NOT_RATED = {"*": {"0"}, "MI": {"100"}}
C_MAX = 300  # the highest official value (desert Southwest), and the estimate's cap
# 2010 Census county codes that SSURGO gives another code: Shannon County, SD became Oglala Lakota County (46102) in 2015
SSURGO_CODE = {"46113": "46102"}
# 2010 Census county-equivalents SSURGO has no county record for: their soils are in the surrounding county's survey
# (checked with SDA at points in each), so they take that county's C, as the app's point and area results do
HELD_BY = {"29510": "29189",  # St. Louis city: survey MO189, St. Louis County and City
           "51530": "51163", "51678": "51163",  # Buena Vista, Lexington: Rockbridge
           "51640": "51035",  # Galax: Carroll (and Grayson)
           "51660": "51165",  # Harrisonburg: Rockingham
           "51683": "51153", "51685": "51153",  # Manassas, Manassas Park: Prince William
           "51720": "51195",  # Norton: Wise
           "51750": "51121"}  # Radford: Montgomery
# SSURGO county codes with no 2010 Census county: the app may meet them on a map unit, so they copy the county now
# holding them: Yellowstone National Park's Montana part (Park County), Clifton Forge and South Boston (former Virginia
# cities, now towns in Alleghany and Halifax)
SSURGO_ALIAS = {"30113": "30067", "51560": "51005", "51780": "51083"}


def official_c(vals, code):
    """Official C from climate-factor symbols {symbol: [acres, map units, map units with acres]}: the mean of the rated
    symbols weighted by acres, or by map units where SSURGO leaves a symbol's acres empty (fetch_county_c.weights);
    None when none is rated."""
    skip = NOT_RATED["*"] | NOT_RATED.get(code, set())
    v = {k: x for k, x in vals.items() if k.replace(".", "", 1).isdigit() and k not in skip and float(k) > 0}
    w = FC.weights(v)
    tot = sum(w.values())
    return round(sum(float(k) * x for k, x in w.items()) / tot, 1) if tot else None


def area_km2(geom):
    """Area in km² (Albers equal-area, EPSG:5070)."""
    return shp_transform(lambda x, y, z=None: to_alb.transform(x, y), geom).area / 1e6


def county_table():
    """Every contiguous county's C. Official where SSURGO rates it (with each survey area's own value where a county's
    survey areas differ); else the county's mean Chepil C from NASA POWER times the median ratio official / formula C
    over all rated counties.

    Tested by estimating every rated county with its own state left out: the same C class (the map's 20-wide classes)
    as the official value for 65% of plains counties and 99% of eastern ones, median error 28% on the plains; in the
    mountain West it runs low, about 2.5 times, as a 0.5-degree cell's rain falls mostly on the high ground (63% in the
    same class). Scaling by the nearest rated counties' own ratios did worse there (41%) and blew up next to states
    that give one value statewide (Pennsylvania 8, Connecticut 20), which are conventions rather than the formula's."""
    if "counties" in _cache:
        return _cache["counties"]
    cc = load("county_c.json")
    code_of = {f: c for c, (n, f) in NAMES.items()}
    lats, lons, Cg = climate_grid()
    it = RegularGridInterpolator((lats, lons), Cg, bounds_error=False, fill_value=None)
    rows = []
    for f in load("us_counties_5m.json")["features"]:
        p = f["properties"]
        if p["STATE"] not in code_of:
            continue
        g = shape(f["geometry"])
        w, s_, e, n = g.bounds
        xs, ys = np.meshgrid(np.arange(w + 0.025, e, 0.05), np.arange(s_ + 0.025, n, 0.05))
        m = shapely.contains_xy(g, xs, ys)
        if m.any():
            px, py = xs[m], ys[m]
        else:  # smaller than the 0.05-degree lattice
            q = g.representative_point()
            px, py = np.array([q.x]), np.array([q.y])
        fips = p["STATE"] + p["COUNTY"]
        sym = SSURGO_CODE.get(fips, fips)  # the code SSURGO's county symbol carries, which the app looks up
        rec = cc.get(sym)
        code = code_of[p["STATE"]]
        off = official_c(rec["values"], code) if rec else None
        pieces = {}
        if off is not None:  # survey areas' own C, kept where they differ within the county
            pc = {sa: official_c(v, code) for sa, v in rec.get("pieces", {}).items()}
            pc = {sa: c_ for sa, c_ in pc.items() if c_ is not None}
            if len({round(c_, 1) for c_ in pc.values()}) > 1:
                pieces = pc
                # the county's C: its survey areas' C weighted by their area in the county, where the outlines are
                # known (acres are missing for whole survey areas in a few counties, Park County, MT among them)
                sas = load("survey_areas.json") if (RAW / "survey_areas.json").exists() else {}
                parts = [(c_, area_km2(g.intersection(shape(sas[sa])))) for sa, c_ in pc.items() if sa in sas]
                tot = sum(a for c_, a in parts)
                if tot > 0:
                    off = round(sum(c_ * a for c_, a in parts) / tot, 1)
        c = g.centroid
        rows.append({"fips": fips, "sym": sym, "geom": g, "lat": c.y, "lon": c.x,
                     "formula": float(np.mean(it(np.c_[py, px]))), "official": off, "pieces": pieces})
    ref = [r for r in rows if r["official"] and r["fips"] not in HELD_BY]
    scale = float(np.median([r["official"] / max(r["formula"], 0.1) for r in ref]))
    for r in rows:
        r["C"], r["est"] = (r["official"], 0) if r["official"] else (round(min(C_MAX, r["formula"] * scale), 1), 1)
    by = {r["fips"]: r for r in rows}
    for f, h in HELD_BY.items():  # after the scale, so a held county is not counted twice
        if f in by and h in by:
            by[f].update(C=by[h]["C"], est=by[h]["est"], official=by[h]["official"], pieces=by[h]["pieces"])
    print(f"counties: {len(rows)}, {len(ref)} rated, {sum(1 for r in rows if r['pieces'])} split by survey area; "
          f"median ratio official / formula {scale:.2f}")
    _cache["counties"] = rows, len(ref), scale
    return _cache["counties"]


def land():
    """The contiguous states as one shape, prepared for fast point tests."""
    if "land" not in _cache:
        names = {n for c, n, f, tz, l48 in STATES if l48}
        _cache["land"] = prepared.prep(unary_union([shape(f["geometry"]) for f in load("us_states_5m.json")["features"]
                                                    if f["properties"]["NAME"] in names]).buffer(0))
    return _cache["land"]


def chepil_c(rec):
    """Chepil et al. (1962) climatic factor, % of Garden City KS.

    C = 34.483 v^3 / PE^2, v = mean annual wind (mph) at 30 ft,
    PE = Thornthwaite precipitation-effectiveness index
       = sum_i 115 * (P_i / (T_i - 10))^(10/9), P inches/month, T deg F (T >= 28.4).
    """
    pe = 0.0
    for m, d in zip(MONTHS, DAYS):
        p_in = rec["PRECTOTCORR"][m] * d / 25.4
        t_f = max(rec["T2M"][m] * 9 / 5 + 32, 28.4)
        pe += 115 * (max(p_in, 0.5) / (t_f - 10)) ** (10 / 9)  # NAM: P floor 0.5 in
    pe = max(pe, 1.0)
    # 10 m -> 30 ft (9.14 m) with log profile, z0 = 3 cm
    v_mph = rec["WS10M"]["ANN"] * 2.23694 * math.log(9.144 / 0.03) / math.log(10 / 0.03)
    return 34.483 * v_mph ** 3 / pe ** 2, pe, v_mph


def climate_grid():
    """Chepil C at each POWER grid point inside the contiguous states (land()); any other point (over the sea, a Great
    Lake, Canada or Mexico, which the Census outlines do not cover) takes the nearest inside point's C, so the
    interpolation near a shore or a border uses values from inside the states only (MERRA-2 wind over water is
    stronger)."""
    if "climate" in _cache:
        return _cache["climate"]
    g = load("power_grid.json")
    g = {k: v for k, v in g.items() if all(p in v for p in ("WS10M", "PRECTOTCORR", "T2M", "WD10M"))}
    lats = sorted({float(k.split(",")[0]) for k in g})
    lons = sorted({float(k.split(",")[1]) for k in g})
    li, lj = {v: i for i, v in enumerate(lats)}, {v: j for j, v in enumerate(lons)}
    C = np.full((len(lats), len(lons)), np.nan)
    on_land = np.zeros(C.shape, bool)
    for k, rec in g.items():
        la, lo = map(float, k.split(","))
        i, j = li[la], lj[lo]
        C[i, j] = chepil_c(rec)[0]
        on_land[i, j] = land().contains(Point(lo, la))
    ok = on_land & np.isfinite(C)
    LA, LO = np.meshgrid(lats, lons, indexing="ij")
    k = math.cos(math.radians(37))  # degrees of longitude to degrees of latitude, roughly, for the nearest search
    _, near = cKDTree(np.c_[LA[ok], LO[ok] * k]).query(np.c_[LA.ravel(), LO.ravel() * k])
    C = np.where(ok, C, C[ok][near].reshape(C.shape))
    _cache["climate"] = np.array(lats), np.array(lons), C
    return _cache["climate"]


def to_png(rgba, path):
    Image.fromarray(rgba, "RGBA").save(path, optimize=True)
    print("wrote", path.name, path.stat().st_size // 1024, "KB")


def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def classify(arr, breaks, colors, valid):
    """breaks: upper bounds (len n-1) for n colors."""
    rgba = np.zeros(arr.shape + (4,), np.uint8)
    idx = np.digitize(arr, breaks)
    for k, col in enumerate(colors):
        m = valid & (idx == k)
        rgba[m, :3] = hex_rgb(col)
        rgba[m, 3] = 255
    return rgba


def ramp(arr, vmin, vmax, stops, valid, steps=24):
    """Stepped continuous ramp (keeps PNG small, reads as smooth)."""
    t = np.clip((arr - vmin) / (vmax - vmin), 0, 1)
    t = np.floor(t * (steps - 1) + 0.5) / (steps - 1)
    cols = np.array([hex_rgb(s) for s in stops], float)
    pos = np.linspace(0, 1, len(stops))
    rgba = np.zeros(arr.shape + (4,), np.uint8)
    for ch in range(3):
        rgba[..., ch] = np.interp(t, pos, cols[:, ch]).astype(np.uint8)
    rgba[..., 3] = np.where(valid, 255, 0)
    return rgba


def build(code):
    NAME, FIPS = NAMES[code]
    OUT = HERE.parent / "data" / "states" / code
    OUT.mkdir(parents=True, exist_ok=True)
    print(f"--- {code} {NAME}")
    tx = state_geometry(NAME)  # the state's outline (tx: named for the first state built)
    tx_m = shp_transform(lambda x, y, z=None: to_merc.transform(x, y), tx)
    minx, miny, maxx, maxy = tx_m.bounds
    minx, miny = math.floor(minx / RES) * RES - RES, math.floor(miny / RES) * RES - RES
    maxx, maxy = math.ceil(maxx / RES) * RES + RES, math.ceil(maxy / RES) * RES + RES
    W, H = int((maxx - minx) / RES), int((maxy - miny) / RES)
    dst_tf = from_origin(minx, maxy, RES, RES)
    print("grid", W, H)

    inside = geometry_mask([mapping(tx_m)], (H, W), dst_tf, invert=True)

    def warp(path, resampling, dtype):
        with rasterio.open(path) as src:
            out = np.full((H, W), src.nodata if src.nodata is not None else 0, dtype)
            reproject(rasterio.band(src, 1), out, dst_transform=dst_tf, dst_crs="EPSG:3857",
                      resampling=resampling, dst_nodata=src.nodata)
            return out, src.nodata

    wei, wei_nd = warp(RAW / "wei.tif", Resampling.nearest, np.float32)
    weg, _ = warp(RAW / "weg_int.tif", Resampling.nearest, np.uint8)
    wei_ok = inside & (wei != wei_nd) & np.isfinite(wei) & (wei >= 0)

    # climate factor on the same grid, county by county: official NRCS C, else the scaled estimate (county_table)
    lats, lons, Cg = climate_grid()
    xs = minx + (np.arange(W) + 0.5) * RES
    ys = maxy - (np.arange(H) + 0.5) * RES
    XX, YY = np.meshgrid(xs, ys)
    LON, LAT = to_ll.transform(XX, YY)
    rows, n_rated, scale = county_table()
    counties = [r for r in rows if r["fips"][:2] == FIPS]
    to_m = lambda geom: mapping(shp_transform(lambda x, y, z=None: to_merc.transform(x, y), geom))  # noqa: E731
    merc = [to_m(r["geom"]) for r in counties]
    C = rasterize([(g_, r["C"]) for g_, r in zip(merc, counties)], out_shape=(H, W), transform=dst_tf, fill=-1, dtype="float32")
    # where a county's survey areas differ, each survey area's part of the county takes its own C
    sas = load("survey_areas.json") if (RAW / "survey_areas.json").exists() else {}
    parts = []
    for r in counties:
        for sa, c_ in r["pieces"].items():
            if sa not in sas:
                print("no outline for survey area", sa, "in", r["fips"])
                continue
            part = r["geom"].intersection(shape(sas[sa]))
            if not part.is_empty and part.area > 0:
                parts.append((to_m(part), c_))
    if parts:
        P = rasterize(parts, out_shape=(H, W), transform=dst_tf, fill=-1, dtype="float32")
        C = np.where(P >= 0, P, C)
    est = rasterize([(g_, 1) for g_, r in zip(merc, counties) if r["est"]] or [(merc[0], 0)], out_shape=(H, W),
                    transform=dst_tf, fill=0, dtype="uint8")
    miss = C < 0  # slivers where the county and state outlines differ: the nearest county's value
    if miss.any():
        idx = ndimage.distance_transform_edt(miss, return_distances=False, return_indices=True)
        C, est = C[tuple(idx)], est[tuple(idx)]
    est = inside & (est == 1)

    # spring (Feb-May) mean 10 m wind speed, mph, interpolated from the POWER grid
    g = {k: v for k, v in load("power_grid.json").items() if "WS10M" in v and "WD10M" in v}
    SPR = ["FEB", "MAR", "APR", "MAY"]
    Wg = np.full((len(lats), len(lons)), np.nan)
    li, lj = {v: i for i, v in enumerate(lats)}, {v: j for j, v in enumerate(lons)}
    near = prepared.prep(tx.buffer(0.3))  # arrows within about 30 km of the state
    arrows = []
    for k, rec in g.items():
        la, lo = map(float, k.split(","))
        if la not in li or lo not in lj:
            continue
        ws = float(np.mean([rec["WS10M"][m] for m in SPR])) * 2.23694
        Wg[li[la], lj[lo]] = ws
        # vector-mean spring direction (wind FROM), weighted by speed
        u = sum(-rec["WS10M"][m] * math.sin(math.radians(rec["WD10M"][m])) for m in SPR)
        v = sum(-rec["WS10M"][m] * math.cos(math.radians(rec["WD10M"][m])) for m in SPR)
        dir_from = (math.degrees(math.atan2(-u, -v)) + 360) % 360
        if near.contains(Point(lo, la)):
            arrows.append([la, lo, round(dir_from), round(ws, 1)])
    Wg = np.where(np.isnan(Wg), np.nanmean(Wg), Wg)
    w_interp = RegularGridInterpolator((lats, lons), Wg, bounds_error=False, fill_value=None)
    WS = w_interp(np.stack([LAT.ravel(), LON.ravel()], -1)).reshape(H, W)

    E = wei * C / 100.0  # t/ac/yr, bare smooth unsheltered field (WEQ E3 with K=1)

    # --- susceptibility classes (multiples of T = 5 t/ac/yr: EI = C*I/T) ---
    sus_breaks = [10, 40, 80, 150]
    sus_colors = ["#2f8f5b", "#a3c45a", "#f2c84b", "#e8772e", "#b3261e"]
    to_png(classify(E, sus_breaks, sus_colors, wei_ok), OUT / "layer_susceptibility.png")

    # --- WEG classes (weg_int: 1..9 = 1,2,3,4,4L,5,6,7,8) ---
    weg_colors = ["#7f1d1d", "#c2410c", "#ea8a2e", "#e7b549", "#d9c46a", "#9cbf6b", "#5fa36a", "#2e7d5b", "#64748b"]
    weg_ok = inside & (weg >= 1) & (weg <= 9)
    to_png(classify(weg.astype(float), [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5], weg_colors, weg_ok),
           OUT / "layer_soil_weg.png")

    # --- climatic factor classes ---
    c_breaks = [20, 40, 60, 80, 100, 120]
    c_colors = ["#f4efe1", "#f1dc9c", "#ecbd68", "#e3934a", "#cf6334", "#a83a26", "#6f1d1b"]
    to_png(classify(C, c_breaks, c_colors, inside), OUT / "layer_climate_c.png")

    # --- spring wind speed classes ---
    w_breaks = [6, 7, 8, 9, 10, 11, 12, 13]  # spring means run from about 4 mph (Southeast) to 14 (High Plains)
    w_colors = ["#eef5f6", "#d6e7ec", "#b5d3df", "#8fbbd0", "#679fbf", "#4682b0", "#33689c", "#2a4e85", "#23306a"]
    to_png(classify(WS, w_breaks, w_colors, inside), OUT / "layer_wind_spring.png")

    # bounds in lat/lon of the mercator image corners
    lon0, lat0 = to_ll.transform(minx, miny)
    lon1, lat1 = to_ll.transform(maxx, maxy)
    bounds = [[round(lat0, 6), round(lon0, 6)], [round(lat1, 6), round(lon1, 6)]]

    stats = {
        "E_pct_by_class": [round(float(((np.digitize(E, sus_breaks) == k) & wei_ok).sum() / max(1, wei_ok.sum()) * 100), 1)
                           for k in range(5)],
        "C_range": [round(float(np.nanmin(C[inside])), 1), round(float(np.nanmax(C[inside])), 1)],
        "C_est_pct": round(float(est.sum() / inside.sum() * 100), 1),  # share of the state's area with an estimated C
    }
    print(stats)

    # the app looks the county up by SSURGO's code: held counties have none of their own, aliases copy their county
    cdict = {r["sym"][2:]: [r["C"], r["est"]] + ([r["pieces"]] if r["pieces"] else []) for r in counties if r["fips"] not in HELD_BY}
    cdict.update({a[2:]: cdict[t[2:]] for a, t in SSURGO_ALIAS.items() if a[:2] == FIPS and t[2:] in cdict})
    meta = {
        "bounds": bounds,
        "counties": cdict,  # SSURGO county code -> [C, 1 if estimated(, {survey area: C})]
        "layers": {
            "susceptibility": {
                "file": f"data/states/{code}/layer_susceptibility.png",
                "title": "Wind erosion susceptibility (bare-soil potential)",
                "unit": "t/ac/yr",
                "legend": [{"label": "< 10  Low", "color": sus_colors[0]},
                           {"label": "10–40  Moderate", "color": sus_colors[1]},
                           {"label": "40–80  High", "color": sus_colors[2]},
                           {"label": "80–150  Very high", "color": sus_colors[3]},
                           {"label": "≥ 150  Extreme", "color": sus_colors[4]}],
                "note": "Potential annual loss from a bare, smooth, wide, unsheltered field: E = I × C/100 "
                        "(SSURGO Wind Erodibility Index × Chepil climatic factor). 40 t/ac/yr ≈ Erodibility "
                        "Index 8 for a soil with T = 5.",
            },
            "weg": {
                "file": f"data/states/{code}/layer_soil_weg.png",
                "title": "Soil Wind Erodibility Group (SSURGO)",
                "legend": [{"label": l, "color": c} for l, c in zip(
                    # rank and I only: a survey's group does not always match a texture name
                    ["1 · most erodible (I 160–310)", "2 · I 134", "3 · I 86", "4 · I 86", "4L · I 86", "5 · I 56",
                     "6 · I 48", "7 · I 38", "8 · not erodible (I 0)"], weg_colors)],
                "note": "1 = most erodible, 8 = not erodible; 3, 4 and 4L share I = 86, and 4L holds calcareous "
                        "(limy) loamy soils. I = wind erodibility index (t/ac/yr, 0–310). Dominant-condition WEG of "
                        "the surface layer, 800 m grid (UC Davis SoilWeb from SSURGO).",
            },
            "wind": {
                "file": f"data/states/{code}/layer_wind_spring.png",
                "title": "Spring wind speed and direction (Feb–May)",
                "unit": "mph at 10 m",
                "legend": [{"label": l, "color": c} for l, c in zip(
                    ["< 6", "6–7", "7–8", "8–9", "9–10", "10–11", "11–12", "12–13", "≥ 13"], w_colors)],
                "note": "Mean 10 m wind speed for the windy season, NASA POWER (MERRA-2) 2001–2025 climatology; "
                        "arrows point downwind (where soil is carried), length scaled by speed.",
            },
            "climate": {
                "file": f"data/states/{code}/layer_climate_c.png",
                "title": "Wind erosion climatic factor C",
                "unit": "% of Garden City, KS",
                "legend": [{"label": l, "color": c} for l, c in zip(
                    ["< 20", "20–40", "40–60", "60–80", "80–100", "100–120", "≥ 120"], c_colors)],
                "note": "NRCS Wind Erosion Equation climatic factor, relative to Garden City, KS = 100: the "
                        "acre-weighted mean of SSURGO's climate-factor areas in each county, or in each soil survey "
                        "area of a county where they differ. Where SSURGO gives a county no usable value (none, or "
                        "only 0 or Michigan's 100, read as not assessed), C is estimated: Chepil's "
                        "C = 34.483 v³ / PE² from NASA POWER wind, rain and temperature (2001–2025), times "
                        f"{scale:.2f}, the median ratio of official to formula C over the {n_rated:,} rated counties; "
                        "it runs low in the mountain West.",
            },
        },
        "stats": stats,
        "windArrows": arrows,
    }
    out = OUT / "overlays.json"  # committed with the images; the outline and the app's state file come from tools/build_states.py
    out.write_text(json.dumps(meta, separators=(",", ":")), encoding="utf-8")
    print("wrote", out.name, "and the images in", OUT)


def main():
    args = [a.upper() for a in sys.argv[1:]] or ["TX"]
    codes = sorted(NAMES) if args == ["ALL"] else args
    bad = [c for c in codes if c not in NAMES]
    if bad:
        sys.exit(f"{', '.join(bad)}: not one of the contiguous states and DC")
    for code in codes:
        build(code)


if __name__ == "__main__":
    main()
