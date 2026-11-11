"""Official NRCS WEQ climatic factor C per county, from SSURGO land-area overlaps, for the 48 contiguous states and DC.

SSURGO links each map unit to the counties and to the WEQ climate-factor areas (their symbol is C) it lies in, with
the map unit's acres in each. For every county this keeps the acres of each climate-factor symbol (a map unit's acres in
the county split between its climate-factor areas in proportion to its acres in each, or equally where SSURGO gives
none), in all and for each soil survey area within the county (most counties are one survey area; several western counties are split
between survey areas that use different climate-factor areas). tools/build_layers.py averages them, decides which
symbols count (0, and 100 in Michigan, are read as "not rated" there) and estimates C where a county has none.

Writes raw/county_c.json:
         {"04017": {"name": "Navajo", "values": {"120": [acres, map units, map units with acres], "20": [...]},
                    "pieces": {"AZ633": {"120": [...]}, "AZ683": {"20": [...]}, "AZ707": {...}, "AZ714": {...}}}}
         (SSURGO leaves the acres empty for some survey areas: "map units with acres" tells those apart)
       raw/county_c_states.json: {"TX": {"counties": 254, "with_values": 254}, ...}   (what each state's query returned)
       raw/survey_areas.json: {"AZ625": GeoJSON geometry, ...}: the outlines (SSURGO sapolygon, simplified to about
         200 m) of the survey areas in counties whose survey areas differ, which tools/build_layers.py paints separately
Run: python tools/fetch_county_c.py           (every state not fetched yet, then the survey areas still missing)
     python tools/fetch_county_c.py KS NE     (those states again)
"""
import json
import sys
import time
from collections import defaultdict
from pathlib import Path

import requests
from shapely import wkt
from shapely.geometry import mapping
from shapely.ops import unary_union

sys.path.insert(0, str(Path(__file__).parent))
from build_states import STATES  # noqa: E402  (postal code, name, FIPS, time offset, contiguous)

SDA = "https://SDMDataAccess.sc.egov.usda.gov/Tabular/post.rest"
RAW = Path(__file__).parent / "raw"
OUT = RAW / "county_c.json"
LOG = RAW / "county_c_states.json"
SAS = RAW / "survey_areas.json"

# acres and map units of each climate-factor symbol, by county and the map unit's survey area (legend)
Q = """
SELECT cty.areasymbol AS county, cty.areaname, l.areasymbol AS survey, cf.areasymbol AS cfact,
       SUM(COALESCE(m1.areaovacres, 0) * CASE WHEN t.tot > 0 THEN COALESCE(m2.areaovacres, 0) / t.tot ELSE 1.0 / t.n END) AS acres,
       COUNT(*) AS n, COUNT(m1.areaovacres) AS known
FROM muaoverlap m1
JOIN laoverlap cty ON cty.lareaovkey = m1.lareaovkey AND cty.areatypename = 'County or Parish'
JOIN mapunit mu ON mu.mukey = m1.mukey
JOIN legend l ON l.lkey = mu.lkey
JOIN muaoverlap m2 ON m2.mukey = m1.mukey
JOIN laoverlap cf ON cf.lareaovkey = m2.lareaovkey AND cf.areatypename LIKE 'Climate Factor%'
JOIN (SELECT m.mukey, SUM(CAST(COALESCE(m.areaovacres, 0) AS FLOAT)) AS tot, COUNT(*) AS n
      FROM muaoverlap m JOIN laoverlap c ON c.lareaovkey = m.lareaovkey AND c.areatypename LIKE 'Climate Factor%'
      GROUP BY m.mukey) t ON t.mukey = m1.mukey
WHERE cty.areasymbol LIKE '{code}%'
GROUP BY cty.areasymbol, cty.areaname, l.areasymbol, cf.areasymbol
"""
# every county in the state's surveys, with or without a climate-factor area, so a state with none is told apart
# from a failed query
QC = """
SELECT DISTINCT cty.areasymbol AS county, cty.areaname
FROM laoverlap cty WHERE cty.areatypename = 'County or Parish' AND cty.areasymbol LIKE '{code}%'
"""
QS = "SELECT areasymbol, sapolygongeo.Reduce(0.002).STAsText() AS wkt FROM sapolygon WHERE areasymbol IN ({syms})"


def sda(q):
    for attempt in range(4):
        try:
            r = requests.post(SDA, json={"query": q, "format": "JSON"}, timeout=600)
            if r.ok:
                return r.json().get("Table", [])
            print("retry", r.status_code, r.text[:200])
        except requests.RequestException as e:
            print("retry", e)
        time.sleep(15 * (attempt + 1))
    raise RuntimeError("SDA failed")


def is_num(k):
    return k.replace(".", "", 1).isdigit()


def weights(v):
    """{symbol: weight}: acres, or map-unit counts when any symbol's map units all lack acres (an empty acre figure
    is unknown, not 0) or no symbol has acres. Shared with tools/build_layers.py."""
    unknown = any(n > 0 and kn == 0 for a, n, kn in v.values())
    use_acres = sum(a for a, n, kn in v.values()) > 0 and not unknown
    return {k: (a if use_acres else n) for k, (a, n, kn) in v.items()}


def mean(vals):
    """Weighted mean of the numeric symbols above 0 (weights()); None if none."""
    w = weights({k: x for k, x in vals.items() if is_num(k) and float(k) > 0})
    tot = sum(w.values())
    return sum(float(k) * x for k, x in w.items()) / tot if tot else None


def split_surveys(out):
    """Survey areas of the counties whose survey areas have different mean C: their outlines are needed."""
    need = set()
    for rec in out.values():
        ms = {s: mean(v) for s, v in rec.get("pieces", {}).items()}
        if len({round(m, 1) for m in ms.values() if m is not None}) > 1:
            need |= set(ms)
    return need


def main():
    want = {a.upper() for a in sys.argv[1:]}
    out = json.loads(OUT.read_text()) if OUT.exists() else {}
    log = json.loads(LOG.read_text()) if LOG.exists() else {}
    for code, name, fips, tz, l48 in STATES:
        if not l48 or (want and code not in want) or (not want and code in log):
            continue
        counties = sda(QC.format(code=code))
        rows = sda(Q.format(code=code))
        recs = defaultdict(lambda: {"name": "", "values": {}, "pieces": {}})
        for county, cname in counties:
            recs[fips + county[2:]]["name"] = cname
        for county, cname, survey, cfact, acres, n, known in rows:
            r = recs[fips + county[2:]]
            r["name"] = cname
            a, n, kn = float(acres or 0), int(n), int(known)
            for d in (r["values"].setdefault(cfact, [0.0, 0, 0]), r["pieces"].setdefault(survey, {}).setdefault(cfact, [0.0, 0, 0])):
                d[0] = round(d[0] + a, 1)
                d[1] += n
                d[2] += kn
        for k in [k for k in out if k[:2] == fips]:
            del out[k]
        out.update(recs)
        odd = sorted({k for r in recs.values() for k in r["values"] if not is_num(k)})
        with_v = sum(1 for r in recs.values() if r["values"])
        log[code] = {"counties": len(recs), "with_values": with_v, **({"odd_symbols": odd} if odd else {})}
        OUT.write_text(json.dumps(out, indent=1))
        LOG.write_text(json.dumps(log, indent=1))
        print(code, len(recs), "counties,", with_v, "with climate-factor areas", odd or "", flush=True)

    sas = json.loads(SAS.read_text()) if SAS.exists() else {}
    need = sorted(split_surveys(out) - set(sas))
    for i in range(0, len(need), 8):
        part = need[i:i + 8]
        rows = sda(QS.format(syms=",".join(f"'{s}'" for s in part)))
        geoms = defaultdict(list)
        for sym, w in rows:
            geoms[sym].append(wkt.loads(w))
        for sym in part:
            if geoms[sym]:
                sas[sym] = mapping(unary_union(geoms[sym]).buffer(0))
            else:
                print("no outline for", sym)
        SAS.write_text(json.dumps(sas))
        print("survey areas", min(i + 8, len(need)), "of", len(need), flush=True)
    print(len(sas), "survey-area outlines kept")


if __name__ == "__main__":
    main()
