"""The ZIP code list behind the search box's ZIP suggestions (data/zips/0.txt ... 9.txt).

Typing "76502" or its first digits suggests the ZIP code areas at once, without asking any server: each ZIP Code
Tabulation Area (ZCTA, the Census Bureau's area for a 5-digit ZIP code) in the 48 contiguous states and DC, with an
inside point, its state and the town it is best known by, so the app can show "ZIP 76502 · Temple area, TX".

Inputs (tools/raw/zcta; U.S. Census Bureau, public domain, no key)
  2020_Gaz_zcta_national.txt   ZCTA inside points (INTPTLAT, INTPTLONG)
      https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2020_Gazetteer/2020_Gaz_zcta_national.zip
  tab20_zcta520_county20_natl.txt, tab20_zcta520_place20_natl.txt, tab20_zcta520_cousub20_natl.txt
      the land each ZCTA shares with each county, place and county subdivision (AREALAND_PART)
      https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_{county20,place20,cousub20}_natl.txt
  tools/raw/gazetteer/2020_Gaz_counties_national.txt (tools/build_places.py's input): state code by FIPS
  data/places.txt (tools/build_places.py): each town's people, and the nearest town where a ZCTA shares no land with any place

The state: the one holding most of the ZCTA's land (by county). The town: of the places (cities, towns, villages,
CDPs; in New England the towns, county subdivisions, which are the local government there and cover all the land)
sharing land with the ZCTA, the one with the most people in it, taken as its people (data/places.txt) times the share
of its land inside the ZCTA; with no place at all, the nearest one in data/places.txt in the same state within 40 km,
else the county. USPS names a ZIP after its post office, and its list is sold, so the label says "area": checked
against GeoNames' ZIP names (USPS's), this rule gave the same town for 86% of the ZCTAs that share land with a place,
the most land shared 82%, the nearest town 78%; most misses are a suburb or a neighbourhood by its own name (80215
Lakewood, where USPS writes Denver) or a city reaching over a small town's ZIP area (90210 Los Angeles, not Beverly
Hills).

Writes data/zips/D.txt for each first digit D (a file is read only when a ZIP starting with D is typed): one ZCTA a
line, by ZIP, "zip|lat|lon|ST|town"; lat/lon at 3 decimals (~100 m).

Run: python tools/build_zips.py
"""
import io
import math
import sys
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
from build_places import L48, NEW_ENGLAND, clean, gaz  # noqa: E402  the same names as the place list

RAW = HERE / "raw" / "zcta"
OUT = HERE.parent / "data" / "zips"


def rel(name, keep):
    """{zcta: [(land shared, code, name, the area's own land), ...]} from a relationship file; keep(code) picks the rows"""
    out = defaultdict(list)
    with io.open(RAW / name, encoding="utf-8-sig") as f:
        head = f.readline().rstrip("\n").split("|")
        # the other area's GEOID and name are the 10th and 11th columns in all three files (GEOID_COUNTY_20, ...)
        iz, ic, iname, ipart = head.index("GEOID_ZCTA5_20"), 9, 10, head.index("AREALAND_PART")
        for line in f:
            r = line.rstrip("\n").split("|")
            if r[iz] and r[ic] and keep(r[ic]):
                out[r[iz]].append((int(r[ipart] or 0), r[ic], r[iname], int(r[11] or 0)))
    return out


def main():
    st_of = {r["GEOID"][:2]: r["USPS"] for r in gaz("2020_Gaz_counties_national.txt")}  # state FIPS -> code
    zctas = [(r["GEOID"], float(r["INTPTLAT"]), float(r["INTPTLONG"])) for r in gaz_zcta()]
    county = rel("tab20_zcta520_county20_natl.txt", lambda c: True)
    place = rel("tab20_zcta520_place20_natl.txt", lambda c: True)
    cousub = rel("tab20_zcta520_cousub20_natl.txt", lambda c: st_of.get(c[:2]) in NEW_ENGLAND)

    # the place list's towns (no counties): people by name and state (most people first, so a name used twice in a
    # state gives the bigger one's), and on a 0.5-degree grid for the nearest-town fallback
    grid, people = defaultdict(list), {}
    for line in (HERE.parent / "data" / "places.txt").read_text(encoding="utf-8").splitlines():
        n, st, lat, lon, k, p = line.split("|")
        if k != "k":
            grid[(math.floor(float(lat) * 2), math.floor(float(lon) * 2))].append((n, st, float(lat), float(lon)))
            people.setdefault((n.lower(), st), int(p))

    def nearest(lat, lon, st):
        best, gy, gx, kx = None, math.floor(lat * 2), math.floor(lon * 2), math.cos(math.radians(lat))
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                for n, s, y, x in grid[(gy + dy, gx + dx)]:
                    d = math.hypot(y - lat, (x - lon) * kx) * 111.2
                    if s == st and d <= 40 and (not best or d < best[0]):
                        best = (d, n)
        return best and best[1]

    rows, how = [], defaultdict(int)
    for z, lat, lon in zctas:
        cs = sorted(county.get(z, []), reverse=True)
        if not cs:
            continue
        st = st_of.get(cs[0][1][:2])
        if st not in L48:
            continue
        own = [x for x in (cousub if st in NEW_ENGLAND else place).get(z, []) if st_of.get(x[1][:2]) == st]
        if own:
            # its people times the share of its land in the ZCTA (people spread evenly); the land shared breaks a tie
            ppl = lambda x: (people.get((clean(x[2]).lower(), st), 0) + 1) * x[0] / max(x[3], x[0], 1)
            town, k = clean(max(own, key=lambda x: (ppl(x), x[0]))[2]), "place"
        else:
            town = nearest(lat, lon, st)
            k = "nearest" if town else "county"
            town = town or cs[0][2]
        how[k] += 1
        assert "|" not in town
        rows.append((z, lat, lon, st, town))

    rows.sort()
    OUT.mkdir(parents=True, exist_ok=True)
    total = 0
    for d in "0123456789":
        lines = [f"{z}|{lat:.3f}|{lon:.3f}|{st}|{town}" for z, lat, lon, st, town in rows if z[0] == d]
        p = OUT / f"{d}.txt"
        p.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
        total += p.stat().st_size
    print(f"{len(rows)} ZIP code areas (town by {dict(how)}), {total / 1e6:.2f} MB in 10 files -> {OUT}")


def gaz_zcta():
    with io.open(RAW / "2020_Gaz_zcta_national.txt", encoding="latin-1") as f:
        head = [h.strip() for h in f.readline().split("\t")]
        for line in f:
            v = [x.strip() for x in line.split("\t")]
            if len(v) >= len(head):
                yield dict(zip(head, v))


if __name__ == "__main__":
    main()
