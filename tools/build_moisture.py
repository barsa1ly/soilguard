"""Builds data/soilmoisture_stations.json: the soil moisture stations of the 48 states and DC that js/soilmoisture.js
searches for the nearest to a point. The browser reads each station's readings live (both services send CORS *); only
the lists are kept here, as they change a few times a year.

  USDA NRCS Air and Water Database (AWDB REST): SCAN, SNOTEL (SNTL), CSCAN and SNOTEL-lite (SNTLT) stations that report
    soil moisture (element SMS), with the depths of their sensors in inches (heightDepth -2, -4, -8, -20, -40).
  NOAA U.S. Climate Reference Network (USCRN): commissioned stations whose daily file of this year holds soil moisture
    (5, 10, 20, 50 and 100 cm) in the last 60 days, with the file's name (TX_Muleshoe_19_S), as the browser asks
    daily01/{year}/CRND0103-{year}-{stem}.txt and hourly02/{year}/CRNH0203-{year}-{stem}.txt.

Usage: python tools/build_moisture.py   (about 2 minutes; nothing is kept but the JSON)
"""
import datetime as dt
import json
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor

import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "soilmoisture_stations.json")
AWDB = "https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/stations"
CRN = "https://www.ncei.noaa.gov/pub/data/uscrn/products/"
STATES = set("AL AZ AR CA CO CT DE DC FL GA ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split())
S = requests.Session()
S.headers["User-Agent"] = "soil-moisture-station-list-builder"


def awdb():
    out = []
    for net in ["SCAN", "SNTL", "CSCAN", "SNTLT"]:
        r = S.get(AWDB, params={"stationTriplets": f"*:*:{net}", "elements": "SMS:*", "returnStationElements": "true", "activeOnly": "true"}, timeout=180)
        r.raise_for_status()
        for s in r.json():
            if s.get("stateCode") not in STATES or s.get("latitude") is None:
                continue
            # the sensors still reporting: hourly SMS elements whose record runs to the open end date (2100)
            deps = sorted({-e["heightDepth"] for e in s.get("stationElements") or [] if e["elementCode"] == "SMS" and e["durationName"] == "HOURLY"
                           and (e.get("endDate") or "") >= "2100" and e.get("heightDepth") is not None and e["heightDepth"] < 0})
            if not deps:
                continue
            out.append([s["stationTriplet"], s["name"].strip(), round(s["latitude"], 4), round(s["longitude"], 4), round(s.get("elevation") or 0),
                        deps, (s.get("beginDate") or "")[:4]])
        print(net, sum(1 for x in out if x[0].endswith(":" + net)), file=sys.stderr)
    return sorted(out, key=lambda x: x[0])


def uscrn(year):
    lst = S.get(f"{CRN}daily01/{year}/", timeout=60).text
    stems = sorted(set(re.findall(rf"CRND0103-{year}-([A-Za-z0-9_.-]+)\.txt", lst)))
    meta = {}
    for line in S.get(f"{CRN}stations.tsv", timeout=60).text.splitlines()[1:]:
        c = line.split("\t")
        if len(c) > 10 and c[9] == "Commissioned" and c[2] in STATES:
            meta[c[0]] = c
    since = (dt.date.today() - dt.timedelta(days=60)).strftime("%Y%m%d")

    def one(stem):
        if stem[:2] not in STATES:
            return None
        t = S.get(f"{CRN}daily01/{year}/CRND0103-{year}-{stem}.txt", timeout=60).text
        rows = [l.split() for l in t.splitlines() if len(l.split()) >= 23]
        if not rows or rows[0][0] not in meta:
            return None
        # columns 19-23: volumetric water content at 5, 10, 20, 50, 100 cm; -99 is missing
        deps = [d for k, d in enumerate([5, 10, 20, 50, 100]) if any(r[1] >= since and float(r[18 + k]) >= 0 for r in rows)]
        if not deps:
            return None
        m = meta[rows[0][0]]
        return [m[0], stem, f"{m[3]} {m[4]}".strip(), round(float(m[6]), 4), round(float(m[7]), 4), round(float(m[8])), deps, m[10][:4]]

    with ThreadPoolExecutor(6) as ex:
        out = [x for x in ex.map(one, stems) if x]
    print("USCRN", len(out), "of", len(stems), file=sys.stderr)
    return sorted(out, key=lambda x: x[1])


def main():
    today = dt.date.today()
    data = {"made": today.isoformat(),
            "awdb_cols": ["triplet", "name", "lat", "lon", "elevation_ft", "sensor_depths_in", "since"],
            "crn_cols": ["wban", "file_stem", "name", "lat", "lon", "elevation_ft", "sensor_depths_cm", "commissioned"],
            "awdb": awdb(), "crn": uscrn(today.year)}
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(data, separators=(",", ":"), ensure_ascii=False).replace('],["', '],\n["'))  # a station a line, for readable diffs
        f.write("\n")
    print(OUT, os.path.getsize(OUT), "bytes", file=sys.stderr)


if __name__ == "__main__":
    main()
