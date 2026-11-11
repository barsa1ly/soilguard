"""Each state's Practices-tab profile: data/practices/XX.json, from the researched and verified profiles.

The profiles were researched state by state from the state's NRCS Field Office Technical Guide documents
(tools/fetch_efotg.py) and its extension, forestry, DOT and other public sources, each fact checked against its
source by a second reader. The research files (JSON, one per state) are read from a folder given on the command line;
this script checks and compacts them for the app (js/practices.js loads a state's file when its Practices tab opens).

Checks: every cited source is defined and has an http(s) address; months are 0-11; regions named by an item exist;
a source no item cites is dropped. With --check (used for profiles no second reader verified) every number in a fact,
a species row or a date window, and every species name, must appear in the text of a source it cites (the local eFOTG
text, or the page itself, fetched once and kept in tools/raw/practices/web/); an item that fails is dropped. The state's current NRCS practice standards (CPS) from the eFOTG index are added
as sources "cps<code>" (e.g. cps340), so a plan can cite the standard itself.

Run: python tools/build_practices.py <research folder> [--check] [KS NE ...]
Writes data/practices/XX.json and prints what it dropped.
"""
import hashlib
import io
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).parent
OUT = HERE.parent / "data" / "practices"
EFOTG = HERE / "raw" / "efotg"
sys.path.insert(0, str(HERE))
from build_states import STATES  # noqa: E402

NAME = {c: n for c, n, f, tz, l48 in STATES}
BUL = ["context", "cover_rules", "residue", "barriers", "windbreak", "roughening", "grazing", "drought", "seeding",
       "dont_seed", "pasture", "crp", "disturbed", "dunes", "notes"]
CPS_CODES = ["314", "327", "328", "329", "340", "342", "345", "380", "386", "484", "511", "512", "528", "550", "585", "588",
             "589", "603", "609"]


def cps_refs(st):
    """The state's current conservation practice standard (CPS) per code, from the eFOTG index."""
    p = EFOTG / st / "index.json"
    if not p.exists():
        return {}
    out = {}
    for r in json.loads(p.read_text()):
        if r.get("current") and r.get("code") in CPS_CODES and re.search(r"\bCPS\b", r["title"]):
            k = "cps" + r["code"]
            if k not in out or r["date"] > out[k][2]:
                out[k] = [re.sub(r"\s+", " ", r["title"]).strip(), r["url"], r["date"]]
    return {k: v[:2] for k, v in out.items()}


WEB = HERE / "raw" / "practices" / "web"
_texts = {}


def source_text(ref):
    """The cited source's text: its local eFOTG .txt, else the page fetched once (kept in WEB); "" if unreadable."""
    key = ref.get("local") or ref["url"]
    if key in _texts:
        return _texts[key]
    t = ""
    loc = HERE.parent / ref["local"] if ref.get("local") else None
    if loc and loc.exists():
        t = loc.read_text(encoding="utf-8", errors="ignore")
    else:
        WEB.mkdir(parents=True, exist_ok=True)
        f = WEB / (hashlib.sha1(ref["url"].encode()).hexdigest() + ".txt")
        if f.exists():
            t = f.read_text(encoding="utf-8", errors="ignore")
        else:
            try:
                import requests
                r = requests.get(ref["url"], timeout=60, headers={"User-Agent": "SoilGuard source check"})
                if r.ok and "pdf" in r.headers.get("content-type", ""):
                    import pdfplumber
                    with pdfplumber.open(io.BytesIO(r.content)) as pdf:
                        t = "\n".join(pg.extract_text() or "" for pg in pdf.pages)
                elif r.ok:
                    t = re.sub(r"<[^>]+>", " ", r.text)
            except Exception:
                t = ""
            f.write_text(t, encoding="utf-8")
    _texts[key] = norm(t)
    return _texts[key]


def norm(t):
    """Lower case, thousands commas and spaced dashes taken out, so "1,000" and "1000" or "Aug 1 - Sep 15" compare."""
    t = re.sub(r"(\d),(\d{3})\b", r"\1\2", t.lower())
    return re.sub(r"\s+", " ", t)


NUM = re.compile(r"(?<![\w.])(\d+(?:\.\d+)?)")
# labels whose numbers name a document, not a fact: "KS 314 Table 1:", "TN KS-11", "MF2206", "CP24", "Att. 6", "K.A.R. 4-8-44"
LABEL = re.compile(r"\b(?:[A-Z]{2}\s+)?\d{3}[A-Z]?(?:/\d{3}[A-Z]?)*(?=[\s:/,)])|\b(?:TN|TG|MF|CP|PM|ECS|Table|Tables|Att\.?|App\.?|"
                   r"Appendix|Exhibit|Part|Section|Sec\.|Form|Note|K\.A\.R\.|K\.S\.A\.|NAM|NEH|NSSH|EAG|SP|EB|G)\s*[- ]?[A-Z]{0,4}[- ]?\d+[A-Z]?(?:[-.]\d+)*",
                   re.I)


def supported(text, names, texts):
    """Every number of text (labels of documents left out), and one of names (if any), found in the cited sources'
    text, taken together (a fact may join two documents)."""
    t = " ".join(x for x in texts if x)
    if not t:
        return False
    head = re.match(r"^[^:]{1,40}:", text)  # a leading label, "OK 133850:" or "KS 340/550:"
    body = text[head.end():] if head and re.match(r"^[A-Z]{2}\b", text) else text
    nums = {n for n in NUM.findall(norm(LABEL.sub(" ", body))) if n}
    ok_n = all(re.search(rf"(?<![\d.]){re.escape(n)}(?![\d])", t) or (n.startswith("0.") and n[1:] in t)
               or (n.endswith(".0") and re.search(rf"(?<![\d.]){re.escape(n[:-2])}(?![\d])", t)) for n in nums)
    ok_name = not names or any(nm and nm.lower() in t for nm in names)
    return ok_n and ok_name


def build(st, src, check=False):
    p = json.loads(src.read_text(encoding="utf-8"))
    drop = []
    refs = {r["id"]: [r["title"].strip(), r["url"].strip()] for r in p["refs"] if re.match(r"https?://", r.get("url", ""))}
    rawref = {r["id"]: r for r in p["refs"] if r["id"] in refs}

    def holds(text, rs, where, names=()):
        """--check: the item's numbers (and a name) are in a cited source."""
        if not check or supported(text, [n for n in names if n], [source_text(rawref[r]) for r in rs]):
            return True
        drop.append(f"{where}: not found in its source: '{text[:70]}'")
        return False
    drop += [f"ref {r['id']}: no http address" for r in p["refs"] if r["id"] not in refs]
    # a region named by the state code alone ("NE") takes the state's name
    regions = [{"id": r["id"], "name": NAME[st] if r["name"].strip().upper() in (st, "ALL") else r["name"],
                "mlra": [m.strip().upper() for m in r["mlra"] if m.strip()]} for r in p["regions"]]
    rids = {r["id"] for r in regions} | {"all"}
    if len(regions) > 1:
        drop += [f"region {r['id']}: no MLRA symbols, so no site matches it" for r in regions if not r["mlra"]]

    def ok_refs(rs, where):
        good = [r for r in rs if r in refs]
        if len(good) < len(rs):
            drop.append(f"{where}: unknown source {sorted(set(rs) - set(good))}")
        return good

    def ok_regions(rs, where):
        good = [r for r in (rs or []) if r in rids]
        if rs and len(good) < len(rs):
            drop.append(f"{where}: unknown region {sorted(set(rs) - rids)}")
        return good

    def bullets(items, where):
        out = []
        for b in items:
            rs = ok_refs(b.get("refs", []), where)
            if not rs:
                drop.append(f"{where}: no valid source for '{b['text'][:60]}'")
                continue
            if holds(b["text"], rs, where):
                out.append([b["text"].strip(), rs])
        return out

    def windows(items, where):
        out = []
        for w in items:
            rs = ok_refs(w.get("refs", []), where)
            months = sorted({m for m in w.get("months", []) if isinstance(m, int) and 0 <= m <= 11})
            if not rs:
                drop.append(f"{where}: no valid source for '{w['text'][:60]}'")
                continue
            if not holds(w["text"], rs, where):
                continue
            out.append({"regions": ok_regions(w.get("regions"), where), "text": w["text"].strip(), "months": months, "refs": rs})
        return out

    prof = {
        "state": st, "name": NAME[st], "regions": regions,
        "crops": [{"id": c["id"], "name": c["name"], "residue": c["residue"]} for c in p.get("crops", [])],
        "B": {k: bullets(p.get(k, []), k) for k in BUL},
        "cover": [{"name": c["name"], "sci": c.get("sci", ""), "rate": c["rate"], "note": c.get("note", ""),
                   "regions": ok_regions(c.get("regions"), "cover"), "refs": ok_refs(c["refs"], "cover")}
                  for c in p.get("cover_species", []) if ok_refs(c["refs"], "cover")
                  and holds(c["rate"], ok_refs(c["refs"], "cover"), "cover", (c["name"].split("(")[0].split("/")[0].strip(), c.get("sci", "")))],
        "coverPlant": windows(p.get("cover_plant", []), "cover_plant"),
        "seedWin": windows(p.get("seeding_windows", []), "seeding_windows"),
        "natives": [{"name": n["name"], "sci": n.get("sci", ""), "release": n.get("release", ""), "rate": n.get("rate_pls"),
                     "regions": ok_regions(n.get("regions"), "native"), "soils": n.get("soils", []), "refs": ok_refs(n["refs"], "native")}
                    for n in p.get("native_species", []) if ok_refs(n["refs"], "native")
                    and holds(str(n["rate_pls"]) if n.get("rate_pls") is not None else "", ok_refs(n["refs"], "native"), "native",
                              (n["name"].split("(")[0].strip(), n.get("sci", "")))],
        "mixes": [{"title": m["title"], "regions": ok_regions(m.get("regions"), "mix"), "soils": m.get("soils") or [],
                   "rows": [[r["name"], r["rate"]] for r in m["rows"]], "unit": m.get("unit", ""), "note": m.get("note", ""),
                   "refs": ok_refs(m["refs"], "mix")} for m in p.get("mixes", []) if ok_refs(m["refs"], "mix")],
        "wb": {"species": p.get("windbreak_species", []), "avoid": p.get("windbreak_avoid", [])},
        "shrubs": [{"id": re.sub(r"\W+", "", s["id"].lower()) or f"s{i}", "name": s["name"], "advice": bullets(s["advice"], f"shrub {s['id']}")}
                   for i, s in enumerate(p.get("shrubs", []))],
        "gaps": p.get("gaps", []),
    }
    # the sources cited anywhere, plus the state's practice standards
    used = set()
    for k in BUL:
        for t, rs in prof["B"][k]:
            used |= set(rs)
    for k in ("cover", "coverPlant", "seedWin", "natives", "mixes"):
        for x in prof[k]:
            used |= set(x["refs"])
    for s in prof["shrubs"]:
        for t, rs in s["advice"]:
            used |= set(rs)
    cps = cps_refs(st)
    prof["refs"] = {**{k: v for k, v in refs.items() if k in used}, **cps}
    prof["cps"] = sorted(cps)
    drop += [f"ref {k}: cited nowhere" for k in refs if k not in used]
    OUT.mkdir(parents=True, exist_ok=True)
    text = json.dumps(prof, ensure_ascii=False, separators=(",", ":"))
    (OUT / f"{st}.json").write_text(text, encoding="utf-8")
    n = sum(len(v) for v in prof["B"].values())
    print(f"{st}: {len(text) // 1024} KB, {n} notes, {len(prof['cover'])} cover crops, {len(prof['natives'])} native species, "
          f"{len(prof['refs'])} sources ({len(cps)} standards)" + (f"; dropped {len(drop)}" if drop else ""))
    for d in drop:
        print("   -", d)


def main():
    args = [a for a in sys.argv[1:] if a != "--check"]
    if not args:
        sys.exit(__doc__)
    folder = Path(args[0])
    want = {a.upper() for a in args[1:]}
    for f in sorted(folder.glob("*.json")):
        st = f.stem.upper()
        if st in NAME and (not want or st in want):
            build(st, f, check="--check" in sys.argv)


if __name__ == "__main__":
    main()
