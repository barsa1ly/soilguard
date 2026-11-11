"""The place list behind the search box's suggestions as you type (data/places.txt).

Every Census place (cities, towns, villages, boroughs and unincorporated places, CDPs), every county, and the
New England towns (county subdivisions with their own government in CT, ME, MA, NH, RI, VT, where the town, not a
place, is the local government) in the 48 contiguous states and DC, with an inside point and a population, so the
app can suggest "Temple, TX", "Temple, OK", ... from the first letters without asking any server.

Inputs (tools/raw/gazetteer; U.S. Census Bureau, public domain, no key)
  2020_Gaz_place_national.txt, 2020_Gaz_counties_national.txt, 2020_Gaz_cousubs_national.txt
      https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2020_Gazetteer/2020_Gaz_{place,counties,cousubs}_national.zip
  sub-est.csv   city and town population estimates (incorporated places, counties, county subdivisions)
      https://www2.census.gov/programs-surveys/popest/datasets/2020-2024/cities/totals/sub-est2024.csv
  Gaz_places_national.txt   2010 Gazetteer with 2010 counts, for the unincorporated places (CDPs) the estimates leave out
      https://www2.census.gov/geo/docs/maps-data/data/gazetteer/Gaz_places_national.zip

Writes data/places.txt: one place a line, most people first, "name|ST|lat|lon|kind|people", kind c = city, w = town,
v = village, b = borough, p = unincorporated place (CDP), k = county, t = New England town; lat/lon at 3 decimals
(~100 m); people: the 2024 estimate, or for a CDP its 2010 count (0 if new since).

Run: python tools/build_places.py
"""
import csv
import io
import re
from pathlib import Path

HERE = Path(__file__).parent
RAW = HERE / "raw" / "gazetteer"
OUT = HERE.parent / "data" / "places.txt"

L48 = set("AL AZ AR CA CO CT DE DC FL GA ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR "
          "PA RI SC SD TN TX UT VT VA WA WV WI WY".split())
NEW_ENGLAND = {"CT", "ME", "MA", "NH", "RI", "VT"}
KIND = {"city": "c", "town": "w", "village": "v", "borough": "b", "CDP": "p"}  # the last word of a place's name

# the Census kind at the end of a name ("Temple city", "Abanda CDP"), left out of the suggestion's name
SUFFIX = re.compile(r"\s+(?:\(balance\)\s*)?$|\s+(?:city and borough|consolidated government|unified government|"
                    r"metropolitan government|metro government|metro township|urban county|municipality|corporation|plantation|"
                    r"township|borough|village|city|town|CDP)(?:\s+\(balance\))?$")


def gaz(name):
    with io.open(RAW / name, encoding="latin-1") as f:
        rows = list(csv.reader(f, delimiter="\t"))
    head = [h.strip() for h in rows[0]]
    return [dict(zip(head, (v.strip() for v in r))) for r in rows[1:] if r]


def clean(name):
    for _ in range(2):  # "Nashville-Davidson metropolitan government (balance)"
        name = SUFFIX.sub("", name)
    return name.strip()


def main():
    est = {}
    with io.open(RAW / "sub-est.csv", encoding="latin-1") as f:
        for r in csv.DictReader(f):
            pop = int(r["POPESTIMATE2024"] or 0)
            if r["SUMLEV"] == "162":
                est["p" + r["STATE"] + r["PLACE"]] = pop
            elif r["SUMLEV"] == "050":
                est["k" + r["STATE"] + r["COUNTY"]] = pop
            elif r["SUMLEV"] == "061":
                est["t" + r["STATE"] + r["COUNTY"] + r["COUSUB"]] = pop
    pop10 = {r["GEOID"]: int(r["POP10"] or 0) for r in gaz("Gaz_places_national.txt")}

    out, seen = [], {}
    for r in gaz("2020_Gaz_place_national.txt"):
        if r["USPS"] not in L48:
            continue
        kind = KIND.get(r["NAME"].replace(" (balance)", "").rsplit(" ", 1)[-1], "c")
        pop = est.get("p" + r["GEOID"], pop10.get(r["GEOID"], 0))
        out.append([clean(r["NAME"]), r["USPS"], float(r["INTPTLAT"]), float(r["INTPTLONG"]), kind, pop])
    for r in gaz("2020_Gaz_counties_national.txt"):
        # Virginia's independent cities, Baltimore, St. Louis and Carson City are places already
        if r["USPS"] in L48 and (re.search(r" (County|Parish)$", r["NAME"]) or r["NAME"] == "District of Columbia"):
            out.append([r["NAME"], r["USPS"], float(r["INTPTLAT"]), float(r["INTPTLONG"]), "k", est.get("k" + r["GEOID"], 0)])
    for x in out:
        if x[4] != "k":
            seen.setdefault((x[0].lower(), x[1]), []).append(x)
    for r in gaz("2020_Gaz_cousubs_national.txt"):
        if r["USPS"] not in NEW_ENGLAND or r["FUNCSTAT"] != "A" or not re.search(r" (town|plantation)$", r["NAME"]):
            continue
        name, st = clean(r["NAME"]), r["USPS"]
        lat, lon, pop = float(r["INTPTLAT"]), float(r["INTPTLONG"]), est.get("t" + r["GEOID"], 0)
        # the town's own village (a CDP of the same name inside it) gives way to the town
        same = [x for x in seen.get((name.lower(), st), []) if abs(x[2] - lat) < 0.15 and abs(x[3] - lon) < 0.2]
        if any(x[4] != "p" for x in same):
            continue
        for x in same:
            x[4] = None  # dropped below
        out.append([name, st, lat, lon, "t", pop])
    out = [x for x in out if x[4]]

    out.sort(key=lambda x: (-x[5], x[0], x[1]))
    lines = [f"{n}|{st}|{lat:.3f}|{lon:.3f}|{k}|{p}" for n, st, lat, lon, k, p in out]
    assert not any("|" in x[0] for x in out)
    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
    kinds = {k: sum(1 for x in out if x[4] == k) for k in "cwvbpkt"}
    print(f"{len(out)} places ({kinds}), {OUT.stat().st_size / 1e6:.2f} MB -> {OUT}")


if __name__ == "__main__":
    main()
