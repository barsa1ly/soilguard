"""Index and download each state's NRCS Field Office Technical Guide (eFOTG) documents for the wind-erosion practices,
with their text, for researching the Practices tab state by state.

eFOTG (https://efotg.sc.egov.usda.gov) serves each state's folder tree (/api/stateFolder/getMenu/<state FIPS>) and the
documents in a folder (/api/resourceItem/listByFolderAll); Section 4 holds one folder per conservation practice
("Cover Crop (340)") with the state's standard (CPS), implementation requirements, specifications and guidance.

Writes (tools/raw/efotg/, not committed):
  XX/index.json                   [{code, folder, title, date, url, file, pages, current}]: every document listed
  XX/<resourceId>.bin and .txt    the current documents (the file as served, and its text) of the practices below and of the state's Section 1 references
                                  on wind erosion, cover crops, seeding, windbreaks and grazing, with their text
Run: python tools/fetch_efotg.py --refresh  (no listing: from each XX/index.json download the further references on
                                            establishment, species, seeding, trees and grazing, and extract every
                                            file's text again with its tables)
     python tools/fetch_efotg.py            (every contiguous state and DC; files already downloaded are kept;
                                            Maryland and DC have no eFOTG folders)
     python tools/fetch_efotg.py KS NE
"""
import io
import json
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).parent))
from build_states import STATES  # noqa: E402

BASE = "https://efotg.sc.egov.usda.gov"
OUT = Path(__file__).parent / "raw" / "efotg"
# the practices the Practices tab draws on
CODES = ["314", "327", "328", "329", "340", "342", "345", "380", "382", "386", "484", "511", "512", "528", "550", "585",
         "588", "589", "589C", "601", "603", "609", "612", "650"]
# Section 1-3 reference folders and documents worth reading for the same questions
REF = re.compile(r"wind erosion|cover crop|seeding|seed mix|plant(ing)? (guide|list|material)|windbreak|shelterbelt|"
                 r"grazing|range (planting|site)|pasture|forage|residue|tillage|critical area|dune|blowout|CRP", re.I)
# reference documents downloaded (the practice folders' documents always are)
REF_GET = re.compile(r"wind erosion|cover crop|seeding|seed mix|plant(ing)? (guide|list)|windbreak|shelterbelt|dune|blowout|"
                     r"range planting|critical area", re.I)
UA = {"User-Agent": "SoilGuard research script (public eFOTG documents)"}


def get(url, **kw):
    for attempt in range(4):
        try:
            r = requests.get(url, timeout=120, headers=UA, **kw)
            if r.ok:
                return r
            print("retry", r.status_code, url[:120])
        except requests.RequestException as e:
            print("retry", e, url[:120])
        time.sleep(5 * (attempt + 1))
    return None


def folders(fips):
    """(path, itemId, isNRT, practice code or None) for the practice folders and the reference folders."""
    menu = get(f"{BASE}/api/stateFolder/getMenu/{fips}").json()["result"]
    out = []

    def walk(nodes, path):
        for n in nodes:
            p = path + [n["title"]]
            m = re.search(r"\((\d{3}[A-Z]?)\)\s*$", n["title"])
            if m and m.group(1) in CODES and p[0].startswith("Section 4"):
                out.append((" > ".join(p), n["itemId"], n.get("isNRTVersion", False), m.group(1)))
            elif not p[0].startswith("Section 4") and REF.search(n["title"]):
                out.append((" > ".join(p), n["itemId"], n.get("isNRTVersion", False), None))
            walk(n.get("children", []), p)
    walk(menu, [])
    return out


def items(fips, fid, nrt):
    r = get(f"{BASE}/api/resourceItem/listByFolderAll", params={"stateCode": fips, "folderId": fid, "isNRTVersion": str(bool(nrt)).lower()})
    return ((r.json().get("result") or {}).get("resourceItems") or []) if r else []


def url_of(it):
    u = it.get("documentUrl") or ""
    return u if u.startswith("http") else f"{BASE}/api/CPSFile/{u}" if u else None


def text_of(data, mime):
    """(pages, text): each page's text, then its tables one row a line, cells joined by " | " (seeding-rate, date and
    species tables often come out of the page text out of order or not at all)."""
    try:
        if "pdf" in mime or data[:4] == b"%PDF":
            import pdfplumber
            out = []
            with pdfplumber.open(io.BytesIO(data)) as pdf:
                for p in pdf.pages:
                    out.append(p.extract_text() or "")
                    try:
                        for t in p.extract_tables():
                            out += ["[table] " + " | ".join((c or "").replace("\n", " ") for c in row) for row in t if row]
                    except Exception:
                        pass
                return len(pdf.pages), "\n".join(out)
        if "word" in mime or "docx" in mime:
            import docx
            d = docx.Document(io.BytesIO(data))
            rows = [p.text for p in d.paragraphs] + ["\t".join(c.text for c in r.cells) for t in d.tables for r in t.rows]
            return None, "\n".join(rows)
    except Exception as e:  # a damaged or scanned file: kept, without text
        return None, f"[text not extracted: {e}]"
    return None, ""


def fetch_doc(code, rec):
    d = OUT / code
    pdf, txt = d / f"{rec['id']}.bin", d / f"{rec['id']}.txt"
    if txt.exists():
        rec["file"] = txt.name
        return rec
    r = get(rec["url"])
    if not r:
        rec["file"] = None
        return rec
    mime = r.headers.get("content-type", "")
    pdf.write_bytes(r.content)
    pages, text = text_of(r.content, mime)
    txt.write_text(text, encoding="utf-8")
    rec.update(file=txt.name, pages=pages, mime=mime, chars=len(text))
    return rec


# further references worth having for the state profiles (by document title)
EXTRA = re.compile(r"establishment|vegetat|HVEG|plant material|species|grass|forb|seed|cover crop|windbreak|shelterbelt|tree|"
                   r"shrub|range site|grazing|forage|pasture|residue|tillage|erosion|dune|blowout", re.I)


def refresh_one(code):
    d = OUT / code
    p = d / "index.json"
    if not p.exists():
        return code, 0, 0
    recs = json.loads(p.read_text())
    todo = [r for r in recs if r["current"] and not r.get("file") and not r["code"] and EXTRA.search(r["title"])
            and re.search(r"pdf|word|docx", r["mime"] or "pdf")]
    for r in todo:
        fetch_doc(code, r)
    n = 0
    for b in sorted(d.glob("*.bin")):
        data = b.read_bytes()
        pages, text = text_of(data, "pdf" if data[:4] == b"%PDF" else "docx" if data[:2] == b"PK" else "")
        if text:
            b.with_suffix(".txt").write_text(text, encoding="utf-8")
            n += 1
    p.write_text(json.dumps(recs, indent=1))
    return code, len(todo), n


def main():
    if "--refresh" in sys.argv:
        from concurrent.futures import ProcessPoolExecutor
        want = {a.upper() for a in sys.argv[1:] if a != "--refresh"}
        codes = [c for c, n, f, tz, l48 in STATES if l48 and (not want or c in want)]
        with ProcessPoolExecutor(4) as ex:
            for code, got, n in ex.map(refresh_one, codes):
                print(code, got, "more downloaded,", n, "texts extracted again", flush=True)
        return
    want = {a.upper() for a in sys.argv[1:]}
    OUT.mkdir(parents=True, exist_ok=True)
    for code, name, fips, tz, l48 in STATES:
        if not l48 or (want and code not in want):
            continue
        (OUT / code).mkdir(exist_ok=True)
        recs = []
        for path, fid, nrt, pcode in folders(fips):
            its = items(fips, fid, nrt)
            shown = [i for i in its if i.get("displayInd")] or its  # older versions are listed but not shown
            for it in its:
                u = url_of(it)
                if not u:
                    continue
                recs.append({"code": pcode, "folder": path, "title": (it.get("resourceTitle") or "").strip(),
                             "date": (it.get("resourceRevisionDate") or "")[:10], "url": u, "id": it["resourceId"],
                             "mime": (it.get("resourceMimeType") or {}).get("mimeTypeName", ""),
                             "current": it in shown})
            time.sleep(0.2)
        # download the current documents of the practices, and reference documents whose own title matches
        todo = [r for r in recs if r["current"] and (r["code"] or REF_GET.search(r["title"]))
                and re.search(r"pdf|word|docx", r["mime"] or "pdf")]
        with ThreadPoolExecutor(2) as ex:
            list(ex.map(lambda r: fetch_doc(code, r), todo))
        (OUT / code / "index.json").write_text(json.dumps(recs, indent=1))
        print(code, len(recs), "documents listed,", len(todo), "downloaded", flush=True)


if __name__ == "__main__":
    main()
