"""A daily check of the outside data services the app's pages ask directly.

One small, cheap request to each, of the kind the app makes (a tiny Soil Data Access query, a watershed point query, a
3 x 3-cell land cover GeoTIFF, one day of weather, one map tile, ...), sent with the Origin of the live site as a
browser would. A check passes when the status is right, the body looks right (a key, a type or a few bytes) and, for
a service the page reads itself with fetch(), Access-Control-Allow-Origin is * or the site's origin (a POST with a
JSON body is also checked for its CORS preflight). Map tiles and WMS images are <img> loads and need no CORS header.
A busy answer (429, 502, 503, 504) or a dropped connection is asked once more after 5 s, as the app asks again too.
Services known to fail at times are marked in the note but still count.

Prints a Markdown table (service, what was asked, result, time, note); adds it to the GitHub Actions run summary
when GITHUB_STEP_SUMMARY is set; --report writes it to a file (the issue's text) and --failing the failing services,
one a line. Exits 1 when any check fails. About 40 requests, 8 at a time, each with a 30 s limit: under 2 minutes.

Run: python tools/check_services.py [--report report.md] [--failing failing.txt]
"""
import argparse
import concurrent.futures as cf
import datetime as dt
import json
import math
import os
import sys
import tempfile
import time
from urllib.parse import urlencode

import requests

ORIGIN = "https://barsa1ly.github.io"
UA = "data-services-check/1.0 (a daily availability check, one request per service)"
TIMEOUT = 30
MAX_BODY = 2_000_000
LAT, LON = 31.044, -97.347  # cropland in central Texas, inside every service's area
TODAY = dt.datetime.now(dt.timezone.utc).date()
DAY = lambda n: TODAY - dt.timedelta(days=n)


def albers(lat, lon):
    """EPSG:5070 (NAD83 / Conus Albers) metres, as js/landcover.js asks MRLC and Crop-CASMA."""
    a, e2 = 6378137.0, 0.00669438002290
    e, r = math.sqrt(e2), math.radians
    q = lambda p: (1 - e2) * (math.sin(p) / (1 - e2 * math.sin(p) ** 2) - math.log((1 - e * math.sin(p)) / (1 + e * math.sin(p))) / (2 * e))
    m = lambda p: math.cos(p) / math.sqrt(1 - e2 * math.sin(p) ** 2)
    p0, p1, p2 = r(23), r(29.5), r(45.5)
    n = (m(p1) ** 2 - m(p2) ** 2) / (q(p2) - q(p1))
    C = m(p1) ** 2 + n * q(p1)
    rho, rho0, th = a * math.sqrt(C - n * q(r(lat))) / n, a * math.sqrt(C - n * q(p0)) / n, n * r(lon + 96)
    return rho * math.sin(th), rho0 - rho * math.cos(th)


X, Y = albers(LAT, LON)


# ---------- what an answer must look like ----------
def body_json(r, body):
    try:
        return json.loads(body.decode("utf-8", "replace"))
    except ValueError:
        return None


def has_keys(*keys):
    def test(r, body):
        j = body_json(r, body)
        if not isinstance(j, dict):
            return "not JSON"
        if "error" in j and not any(k in j for k in keys):
            return f"error: {str(j['error'])[:120]}"
        miss = [k for k in keys if k not in j]
        return f"no {', '.join(miss)} in the JSON" if miss else None
    return test


def json_list(r, body):
    return None if isinstance(body_json(r, body), list) else "not a JSON list"


def has_text(*parts):
    def test(r, body):
        t = body.decode("utf-8", "replace")
        miss = [p for p in parts if p not in t]
        return f"no {miss[0]!r} in the answer" if miss else None
    return test


def ctype(prefix):
    def test(r, body):
        ct = r.headers.get("Content-Type", "")
        if not ct.lower().startswith(prefix):
            return f"Content-Type {ct or 'none'}, not {prefix}"
        return None if body or r.request.method == "HEAD" else "an empty answer"
    return test


def starts(prefix):
    return lambda r, body: None if body.startswith(prefix) else f"starts {body[:8]!r}, not {prefix!r}"


def all_of(*tests):
    def test(r, body):
        for t in tests:
            msg = t(r, body)
            if msg:
                return msg
        return None
    return test


# ---------- the checks ----------
def C(service, what, url, test, *, method="GET", cors=True, body=None, headers=None, ok=(200,), flaky=""):
    return dict(service=service, what=what, url=url, test=test, method=method, cors=cors, body=body, headers=headers or {}, ok=ok, flaky=flaky)


def arcgis_point(layer_url, fields):
    return layer_url + "/query?" + urlencode({"geometry": f"{LON},{LAT}", "geometryType": "esriGeometryPoint", "inSR": 4326, "spatialRel": "esriSpatialRelIntersects",
                                              "outFields": fields, "returnGeometry": "false", "f": "json"})


def arcgis_box(layer_url, d=0.002):
    """the area tool's query (GeoJSON with geometry) over a box of about 400 m: a few features at most. (Asked for one record without
    geometry, USA Structures took over 30 s.)"""
    return layer_url + "/query?" + urlencode({"geometry": f"{LON - d},{LAT - d},{LON + d},{LAT + d}", "geometryType": "esriGeometryEnvelope", "inSR": 4326,
                                              "spatialRel": "esriSpatialRelIntersects", "outFields": "OBJECTID", "returnGeometry": "true", "outSR": 4326, "f": "geojson"})


def wms_map(url, layer, version="1.1.1", fmt="image/png"):
    box = f"{LON - 0.05},{LAT - 0.05},{LON + 0.05},{LAT + 0.05}"
    srs = {"SRS": "EPSG:4326", "BBOX": box} if version == "1.1.1" else {"CRS": "CRS:84", "BBOX": box}
    sep = "&" if "?" in url else "?"
    return url + sep + urlencode({"SERVICE": "WMS", "VERSION": version, "REQUEST": "GetMap", "LAYERS": layer, "STYLES": "", **srs, "WIDTH": 16, "HEIGHT": 16,
                                  "FORMAT": fmt, "TRANSPARENT": "true"})


def checks():
    d10, d3, d1 = DAY(10), DAY(3), DAY(1)
    sda_q = f"SELECT mukey FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('point({LON} {LAT})')"
    usdm = "https://ndmcgeodata.unl.edu/cgi-bin/mapserv.exe?map=/ms4w/apps/usdm/map/usdm_current_wms.map"
    gibs_rz = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/SMAP_L4_Analyzed_Root_Zone_Soil_Moisture/default/GoogleMapsCompatible_Level6/all/"
    casma = ("https://nassgeo.csiss.gmu.edu/smap_service?service=WPS&version=1.0.0&request=Execute&identifier=GetProfileByDate&DataInputs="
             f"productId=SMAP-9KM-DAILY-TOP;x={round(X)};y={round(Y)};startDate={d10:%Y.%m.%d};endDate={d10:%Y.%m.%d}")
    wcs = "https://www.mrlc.gov/geoserver/mrlc_download/NLCD_2021_Land_Cover_L48/wcs?" + urlencode(
        [("service", "WCS"), ("version", "2.0.1"), ("request", "GetCoverage"), ("coverageId", "NLCD_2021_Land_Cover_L48"), ("format", "image/geotiff"),
         ("subset", f"X({math.floor(X - 45)},{math.ceil(X + 45)})"), ("subset", f"Y({math.floor(Y - 45)},{math.ceil(Y + 45)})")])
    gfi = "https://www.mrlc.gov/geoserver/mrlc_display/wms?" + urlencode({"service": "WMS", "version": "1.1.1", "request": "GetFeatureInfo", "layers": "NLCD_2021_Land_Cover_L48",
        "query_layers": "NLCD_2021_Land_Cover_L48", "srs": "EPSG:4326", "bbox": f"{LON - 0.0005},{LAT - 0.0005},{LON + 0.0005},{LAT + 0.0005}", "width": 3, "height": 3,
        "x": 1, "y": 1, "info_format": "application/json"})
    geom = json.dumps({"x": LON, "y": LAT, "spatialReference": {"wkid": 4326}})
    return [
        # soil
        C("USDA Soil Data Access (tabular)", "POST: the map unit at a point", "https://SDMDataAccess.sc.egov.usda.gov/Tabular/post.rest", has_keys("Table"),
          method="POST", body={"query": sda_q, "format": "JSON+COLUMNNAME"}),
        C("USDA Soil Data Access (soil map WMS)", "16 x 16 px map-unit lines", wms_map("https://SDMDataAccess.sc.egov.usda.gov/Spatial/SDM.wms", "mapunitpoly"),
          ctype("image/png"), cors=False),
        C("USFS soil image services", "pH samples at a point", "https://imagery.geoplatform.gov/iipp/rest/services/Soil_Geology/USFS_pH/ImageServer/getSamples?" + urlencode(
            {"geometry": geom, "geometryType": "esriGeometryPoint", "returnFirstValueOnly": "false", "outFields": "*", "f": "json"}), has_keys("samples")),
        C("USGS mrdata (soil chemistry, DS-801)", "WFS sites in a small box", "https://mrdata.usgs.gov/services/wfs/ds801?" + urlencode(
            {"service": "WFS", "version": "1.0.0", "request": "GetFeature", "typeName": "ds801", "bbox": f"{LON - 0.3:.3f},{LAT - 0.3:.3f},{LON + 0.3:.3f},{LAT + 0.3:.3f}"}),
          has_text("FeatureCollection")),
        C("ISRIC SoilGrids (REST)", "nitrogen 0-5 cm at a point", "https://rest.isric.org/soilgrids/v2.0/properties/query?" + urlencode(
            {"lon": LON, "lat": LAT, "property": "nitrogen", "value": "mean", "depth": "0-5cm"}), has_keys("properties"),
          flaky="known flaky: a beta service, slow or down at times, 5 requests a minute"),
        C("ISRIC SoilGrids (WMS)", "16 x 16 px nitrogen map", wms_map("https://maps.isric.org/mapserv?map=/map/nitrogen.map", "nitrogen_0-5cm_mean"),
          ctype("image/png"), cors=False),
        # land and terrain
        C("MRLC NLCD (WMS feature info)", "land cover class at a point", gfi, has_keys("features")),
        C("MRLC NLCD (WCS)", "3 x 3 cells as GeoTIFF", wcs, all_of(ctype("image/"), lambda r, b: None if b[:2] in (b"II", b"MM") else "not a TIFF")),
        C("Esri Sentinel-2 land cover", "identify at a point", "https://ic.imagery1.arcgis.com/arcgis/rest/services/Sentinel2_10m_LandCover/ImageServer/identify?" + urlencode(
            {"geometry": geom, "geometryType": "esriGeometryPoint", "returnGeometry": "false", "returnCatalogItems": "false", "f": "json"}), has_keys("value")),
        C("USGS 3DEP elevation (EPQS)", "elevation at a point", "https://epqs.nationalmap.gov/v1/json?" + urlencode(
            {"x": LON, "y": LAT, "wkid": 4326, "units": "Meters", "includeDate": "false"}), has_keys("value"),
          flaky="known flaky: slow at times; the app then uses Copernicus via Open-Meteo"),
        C("Open-Meteo elevation", "elevation at a point", f"https://api.open-meteo.com/v1/elevation?latitude={LAT}&longitude={LON}", has_keys("elevation")),
        C("Census TIGERweb", "the county at a point", arcgis_point("https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/55", "NAME"),
          has_keys("features")),
        C("FEMA/ORNL USA Structures (Esri)", "buildings in a 400 m box", arcgis_box("https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/USA_Structures_View/FeatureServer/0"),
          has_keys("features")),
        C("Esri USA Detailed Water Bodies", "water bodies in a 400 m box", arcgis_box("https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Detailed_Water_Bodies/FeatureServer/0"),
          has_keys("features")),
        # water
        C("USGS WBD (hydro.nationalmap.gov)", "the HU12 at a point", arcgis_point("https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer/6", "huc12,name"),
          has_keys("features"), flaky="known flaky: HTTP 502 or 504 at times (11 and 12 Nov 2026)"),
        C("USGS NHDPlus HR (hydro.nationalmap.gov)", "sinks at a point (layer 1)", arcgis_point("https://hydro.nationalmap.gov/arcgis/rest/services/NHDPlus_HR/MapServer/1", "nhdplusid"),
          has_keys("features"), flaky="known flaky: slow at times (25 s to over 60 s on 12 Nov 2026)"),
        C("USGS NLDI", "the NHDPlus catchment at a point", "https://api.water.usgs.gov/nldi/linked-data/comid/position?" + urlencode({"coords": f"POINT({LON} {LAT})"}),
          has_keys("features")),
        # weather and climate
        C("Open-Meteo forecast", "1 day of hourly soil moisture", f"https://api.open-meteo.com/v1/forecast?latitude={LAT}&longitude={LON}&hourly=soil_moisture_0_to_1cm&forecast_days=1",
          has_keys("hourly")),
        C("Open-Meteo archive", "1 day of daily wind", f"https://archive-api.open-meteo.com/v1/archive?latitude={LAT}&longitude={LON}&start_date={d10}&end_date={d10}&daily=wind_speed_10m_max",
          has_keys("daily")),
        C("NASA POWER", "1 day of daily Tmax", "https://power.larc.nasa.gov/api/temporal/daily/point?" + urlencode(
            {"parameters": "T2M_MAX", "community": "AG", "longitude": LON, "latitude": LAT, "start": f"{DAY(30):%Y%m%d}", "end": f"{DAY(30):%Y%m%d}", "format": "JSON"}),
          has_keys("properties")),
        C("ACIS GridData (PRISM)", "POST: 1 day of rain at a point", "https://data.rcc-acis.org/GridData", has_keys("data"), method="POST",
          body={"loc": f"{LON},{LAT}", "sdate": f"{d10}", "edate": f"{d10}", "grid": "21", "elems": [{"name": "pcpn", "units": "mm"}]}),
        C("NOAA NCEI GHCNh (Access Data Service)", "1 day of wind, one station", "https://www.ncei.noaa.gov/access/services/data/v1?" + urlencode(
            {"dataset": "global-historical-climatology-network-hourly", "stations": "USW00013959", "startDate": f"{d10}T00:00:00", "endDate": f"{d10}T23:59:59",
             "dataTypes": "wind_speed", "format": "csv"}), has_text('"wind_speed"'), flaky="known flaky: NCEI is slow at times"),
        C("NOAA NCEI USCRN files", "HEAD of a station's daily file", f"https://www.ncei.noaa.gov/pub/data/uscrn/products/daily01/{d3:%Y}/CRND0103-{d3:%Y}-TX_Austin_33_NW.txt",
          ctype("text/plain"), method="HEAD"),
        C("Iowa Environmental Mesonet (ASOS)", "1 day of wind, one station", "https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?" + urlencode(
            {"station": "ACT", "data": "sknt", "sts": f"{d1}T00:00Z", "ets": f"{d1}T23:59Z", "tz": "Etc/UTC", "format": "onlycomma", "latlon": "no", "missing": "null",
             "trace": "null", "direct": "no", "report_type": 3}), has_text("station,valid"), flaky="known flaky: IEM throttles (HTTP 429) at times"),
        C("gridMET THREDDS (OPeNDAP)", "the .dds of the rain dataset", "https://thredds.northwestknowledge.net/thredds/dodsC/agg_met_pr_1979_CurrentYear_CONUS.nc.dds",
          has_text("Dataset"), flaky="known flaky: down for days at times (out since 11 Nov 2026); the app then reads the Idaho file server"),
        C("gridMET file server (Univ. of Idaho)", "8 bytes of a NetCDF file (Range)", f"https://www.northwestknowledge.net/metdata/data/pr_{DAY(40):%Y}.nc",
          starts(b"\x89HDF"), headers={"Range": "bytes=0-7"}, ok=(206,)),
        # drought
        C("NDMC Drought Monitor (WMS)", "GetCapabilities of the current map", usdm + "&SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities", has_text("WMS_Capabilities")),
        C("Esri Living Atlas, US Drought Intensity", "1 record", "https://services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/rest/services/US_Drought_Intensity_v1/FeatureServer/2/query?" + urlencode(
            {"where": "1=1", "outFields": "ddate", "returnGeometry": "false", "resultRecordCount": 1, "f": "json"}), has_keys("features")),
        C("NOAA NIDIS drought.gov tiles", "the SPoRT map's info.json", "https://storage.googleapis.com/noaa-nidis-drought-gov-data/current-conditions/tile/v1/nasa-sport-3km/info.json",
          has_keys("date")),
        # soil moisture and live maps
        C("NASA GIBS (SMAP L4)", "the days held (DescribeDomains)", f"{gibs_rz}{DAY(60)}--{TODAY}.xml", has_text("<Domain>")),
        C("NOAA map services (NWM land analysis)", "the latest hour (1 field)", "https://mapservices.weather.noaa.gov/raster/rest/services/obs/NWM_Land_Analysis/MapServer/2/query?" + urlencode(
            {"where": "1=1", "outFields": "idp_validtime", "returnGeometry": "false", "f": "json"}), has_keys("features")),
        C("NOAA National Water Model files (AWS S3)", "1 byte of the latest hour's file", None, starts(b"\x89"), headers={"Range": "bytes=0-0"}, ok=(206,)),
        C("USDA NASS Crop-CASMA (SMAP)", "1 day at a 9 km cell", casma, has_text(".csv"), flaky="known flaky: slow (up to 30 s) and down at times"),
        C("USDA NRCS AWDB (SCAN)", "1 station, 1 day of soil moisture", "https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/data?" + urlencode(
            {"stationTriplets": "2006:TX:SCAN", "elements": "SMS:*", "duration": "DAILY", "beginDate": f"{d3}", "endDate": f"{d3}"}), json_list),
        # place search and base maps
        C("OpenStreetMap Nominatim", "search one town", "https://nominatim.openstreetmap.org/search?" + urlencode({"q": "Temple, Texas", "format": "jsonv2", "limit": 1}),
          json_list, headers={"Accept-Language": "en"}),
        C("Esri World Imagery (base map)", "one tile", "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/6/26/14", ctype("image/"), cors=False),
        C("USGS National Map (base map)", "one tile", "https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/6/26/14", ctype("image/"), cors=False),
        C("OpenStreetMap tiles (base map)", "one tile", "https://tile.openstreetmap.org/6/14/26.png", ctype("image/png"), cors=False),
    ]


# ---------- asking ----------
AGAIN = {429, 502, 503, 504}


def cors_ok(r):
    return r.headers.get("Access-Control-Allow-Origin", "") in ("*", ORIGIN)


def nwm_url(s):
    """the newest hourly land analysis file among the last 4 hours (a new one is posted each hour, about an hour late)"""
    for h in range(1, 5):
        t = dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=h)
        url = f"https://noaa-nwm-pds.s3.amazonaws.com/nwm.{t:%Y%m%d}/analysis_assim/nwm.t{t:%H}z.analysis_assim.land.tm00.conus.nc"
        try:
            if s.head(url, timeout=TIMEOUT, headers={"Origin": ORIGIN}).status_code == 200:
                return url
        except requests.RequestException:
            pass
    return url


def ask(s, c):
    h = {"Origin": ORIGIN, **c["headers"]}
    kw = dict(headers=h, timeout=TIMEOUT, stream=True, allow_redirects=True)
    if c["body"] is not None:
        kw["json"] = c["body"]
    r = s.request(c["method"], c["url"], **kw)
    body = b""
    if c["method"] != "HEAD":
        for part in r.iter_content(65536):
            body += part
            if len(body) >= MAX_BODY:
                break
    r.close()
    return r, body


def run(c):
    s = requests.Session()
    s.headers["User-Agent"] = UA
    t0, notes = time.monotonic(), []
    try:
        if c["url"] is None:
            c["url"] = nwm_url(s)
        if c["method"] == "POST" and c["cors"]:
            p = s.options(c["url"], timeout=TIMEOUT, headers={"Origin": ORIGIN, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type"})
            allow = p.headers.get("Access-Control-Allow-Headers", "").lower()
            if p.status_code >= 300 or not cors_ok(p) or not ("content-type" in allow or "*" in allow):
                return fail(c, t0, f"CORS preflight refused (HTTP {p.status_code}, Allow-Origin {p.headers.get('Access-Control-Allow-Origin') or 'none'})")
        for k in range(2):
            try:
                r, body = ask(s, c)
            except requests.ConnectionError as e:
                if k == 0:
                    notes.append("connection failed, asked again")
                    time.sleep(5)
                    continue
                raise
            if r.status_code in AGAIN and k == 0:
                notes.append(f"HTTP {r.status_code}, asked again")
                time.sleep(5)
                continue
            break
        if r.status_code not in c["ok"]:
            return fail(c, t0, f"HTTP {r.status_code} {r.reason}", notes)
        if c["cors"] and not cors_ok(r):
            return fail(c, t0, f"no CORS header for the site (Allow-Origin: {r.headers.get('Access-Control-Allow-Origin') or 'none'})", notes)
        msg = c["test"](r, body)
        if msg:
            return fail(c, t0, msg, notes)
        return {**c, "ok_": True, "secs": time.monotonic() - t0, "note": "; ".join(notes)}
    except requests.Timeout:
        return fail(c, t0, f"no answer in {TIMEOUT} s", notes)
    except requests.RequestException as e:
        return fail(c, t0, f"{type(e).__name__}: {str(e)[:140]}", notes)


def fail(c, t0, why, notes=()):
    return {**c, "ok_": False, "secs": time.monotonic() - t0, "note": "; ".join([why, *notes])}


def table(res):
    cell = lambda s: str(s).replace("|", "\\|").replace("\n", " ")
    rows = ["| Service | What was asked | Result | Time | Note |", "|---|---|---|---|---|"]
    for x in res:
        note = "; ".join(p for p in (x["note"], x["flaky"]) if p)
        rows.append(f"| {cell(x['service'])} | {cell(x['what'])} | {'ok' if x['ok_'] else '**FAIL**'} | {x['secs']:.1f} s | {cell(note)} |")
    return "\n".join(rows)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--report", help="write the Markdown report here")
    ap.add_argument("--failing", help="write the failing services here, one a line (default: a file in the temp folder)")
    a = ap.parse_args()
    t0, cs = time.monotonic(), checks()
    with cf.ThreadPoolExecutor(max_workers=8) as ex:
        res = list(ex.map(run, cs))
    bad = [x for x in res if not x["ok_"]]
    failing = "; failing: " + ", ".join(x["service"] for x in bad) if bad else ""
    head = (f"Data services check, {dt.datetime.now(dt.timezone.utc):%Y-%m-%d %H:%M} UTC: {len(res) - len(bad)} of {len(res)} answered{failing}"
            f" ({time.monotonic() - t0:.0f} s; sent with Origin {ORIGIN}).")
    out = f"{head}\n\n{table(res)}\n"
    print(out)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as f:
            f.write(out + "\n")
    if a.report:
        with open(a.report, "w", encoding="utf-8") as f:
            f.write(out)
    path = a.failing or os.path.join(tempfile.gettempdir(), "data-services-failing.txt")
    with open(path, "w", encoding="utf-8") as f:
        f.writelines(f"{x['service']}: {x['note']}\n" for x in bad)
    print(f"Failing list: {path}", file=sys.stderr)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
