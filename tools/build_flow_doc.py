"""Build docs/SoilGuard_Data_Flow.docx: flow diagrams of where each dataset comes from,
where it is calculated and how the results reach the screen (run from the repo root or tools/)."""
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
IMG = ROOT / "docs" / "img"
DOCX = ROOT / "docs" / "SoilGuard_Data_Flow.docx"

FONT, MONO = "Segoe UI", "Consolas"
DPI = 600  # PNG for the Word document; the SVG next to it (for GitHub) is sharp at any zoom
# text as outlines, so the SVG needs no fonts; a fixed salt and no date, so an unchanged figure gives an unchanged file
plt.rcParams.update({"font.family": FONT, "font.size": 10.5, "svg.fonttype": "path", "svg.hashsalt": "soilguard"})

INK, INK2, MUTED, LINE = "#1F2933", "#3E4C59", "#616E7C", "#52606D"
PAL = {  # fill, border
    "user": ("#F1F3F5", "#5F6B76"),
    "soil": ("#F7EFE5", "#A0672D"),
    "wx": ("#E8F1FB", "#2C6CB0"),
    "built": ("#F1ECF8", "#6B4FA0"),
    "calc": ("#E6F4EA", "#2F7D4F"),
    "comb": ("#FFF2E2", "#C26A12"),
    "out": ("#EEF0F2", "#323F4B"),
    "warn": ("#FDECEC", "#B83A3A"),
    "panel": ("#FAFBFC", "#CBD2D9"),
}
DASH = (0, (4, 2.5))


class Box:
    def __init__(self, x, y, w, h):
        self.x, self.y, self.w, self.h = x, y, w, h

    @property
    def top(self): return self.y + self.h

    @property
    def right(self): return self.x + self.w

    @property
    def cx(self): return self.x + self.w / 2

    @property
    def cy(self): return self.y + self.h / 2


class Sheet:
    """A matplotlib canvas measured in inches (1 data unit = 1 inch)."""

    def __init__(self, w, h):
        self.w, self.h = w, h
        self.fig = plt.figure(figsize=(w, h), dpi=DPI)
        self.ax = self.fig.add_axes([0, 0, 1, 1])
        self.ax.set_xlim(0, w)
        self.ax.set_ylim(0, h)
        self.ax.axis("off")
        self.fits = []  # (text, right limit) checked before saving

    def text(self, x, y, s, fs=10.5, color=INK2, weight="normal", ha="left", va="top", family=None,
             style="normal", limit=None, bg=None, z=4):
        t = self.ax.text(x, y, s, fontsize=fs, color=color, fontweight=weight, ha=ha, va=va, zorder=z,
                         family=family or FONT, style=style,
                         bbox=dict(fc=bg, ec="none", pad=1.2) if bg else None)
        if limit is not None:
            self.fits.append((t, limit))
        return t

    def box(self, x, top, w, h, kind, title, lines=(), module=None, dashed=False, fs=10.5, tfs=12, lh=0.215,
            lw=1.5):
        fc, ec = PAL[kind]
        b = Box(x, top - h, w, h)
        self.ax.add_patch(FancyBboxPatch((b.x, b.y), w, h, boxstyle="round,pad=0,rounding_size=0.09",
                                         fc=fc, ec=ec, lw=lw, ls=DASH if dashed else "-", zorder=2))
        tx, ty = x + 0.14, top - 0.11
        self.text(tx, ty, title, fs=tfs, color=INK, weight="semibold", limit=b.right - 0.08)
        ty -= tfs / 72 * 1.38
        if module:
            self.text(tx, ty + 0.01, module, fs=fs - 1.2, color=ec, family=MONO, limit=b.right - 0.08)
            ty -= (fs - 1) / 72 * 1.45
        for ln in lines:
            self.text(tx, ty, ln, fs=fs, limit=b.right - 0.08)
            ty -= lh
        if ty < b.y - 0.02:
            print(f"  ! text runs past the bottom of box '{title}' by {b.y - ty:.2f} in")
        return b

    def panel(self, x, top, w, h, title=None):
        fc, ec = PAL["panel"]
        self.ax.add_patch(FancyBboxPatch((x, top - h), w, h, boxstyle="round,pad=0,rounding_size=0.12",
                                         fc=fc, ec=ec, lw=1, zorder=1))
        if title:
            self.text(x + 0.12, top - 0.1, title, fs=10, color=MUTED, weight="semibold")

    def path(self, pts, color=LINE, dashed=False, lw=1.4, head=True):
        ls = DASH if dashed else "-"
        if len(pts) > 2:
            xs, ys = zip(*pts[:-1])
            self.ax.add_line(Line2D(xs, ys, color=color, lw=lw, ls=ls, zorder=3, solid_capstyle="butt"))
        self.ax.add_patch(FancyArrowPatch(pts[-2], pts[-1], arrowstyle="-|>" if head else "-", mutation_scale=13,
                                          color=color, lw=lw, ls=ls, shrinkA=0, shrinkB=0, zorder=3))

    def label(self, x, y, s, ha="center", va="bottom", color=MUTED, fs=9, bg="white"):
        return self.text(x, y, s, fs=fs, color=color, ha=ha, va=va, style="italic", bg=bg, z=5)

    def legend_swatch(self, x, y, kind, s, dashed=False):
        fc, ec = PAL[kind]
        self.ax.add_patch(FancyBboxPatch((x, y - 0.09), 0.3, 0.2, boxstyle="round,pad=0,rounding_size=0.04",
                                         fc=fc, ec=ec, lw=1.3, ls=DASH if dashed else "-", zorder=2))
        t = self.text(x + 0.38, y + 0.01, s, fs=9.5, color=INK2, va="center")
        self.fig.canvas.draw()
        return x + 0.38 + t.get_window_extent().width / self.fig.dpi + 0.32

    def save(self, name):
        self.fig.canvas.draw()
        for t, limit in self.fits:
            right = self.ax.transData.inverted().transform(t.get_window_extent().get_points())[1][0]
            if right > limit:
                print(f"  ! '{t.get_text()}' overflows its box by {right - limit:.2f} in")
        IMG.mkdir(parents=True, exist_ok=True)
        out = IMG / name
        self.fig.savefig(out, dpi=DPI, facecolor="white")
        self.fig.savefig(out.with_suffix(".svg"), facecolor="white", metadata={"Date": None})
        plt.close(self.fig)
        Image.open(out).convert("RGB").save(out, optimize=True, dpi=(DPI, DPI))
        print("wrote", out.relative_to(ROOT), "and", out.with_suffix(".svg").name)
        return out


# --------------------------------------------------------------------------------------------
# Figure 1: the whole app, left to right
# --------------------------------------------------------------------------------------------
def fig_overview():
    W, H = 15.1, 11.3
    s = Sheet(W, H)
    SX, SW = 0.45, 3.5
    EX, EW = SX + SW + 0.65, 3.2
    KX, KW = EX + EW + 0.85, 2.7
    RX, RW = KX + KW + 0.85, 2.75

    for x, w, t in [(SX, SW, "1   WHERE THE DATA COMES FROM"), (EX, EW, "2   CALCULATED IN YOUR BROWSER"),
                    (KX, KW, "3   COMBINED"), (RX, RW, "4   WHAT YOU SEE")]:
        s.text(x, 11.08, t, fs=11, color=INK, weight="bold")
        s.ax.add_line(Line2D([x, x + w], [10.8, 10.8], color="#9AA5B1", lw=1.2))

    # top row: the states, the point and the location check
    U = s.box(SX, 10.62, SW, 0.9, "user", "You choose states, pick a point",
              ["state button: Texas now, others later", "map tap · search · GPS · lat, lon"])
    L = s.box(EX, 10.62, EW, 0.98, "calc", "Location check", ["in a chosen state; not on a", "building, road or water?"],
              module="app.js · inRegion, ensureState")
    M = s.box(RX, 10.62, RW, 1.2, "warn", "Refused", ["a map tap outside the chosen states,", "or on a building, road or water",
                                                       "(a place found in another state by", "search, GPS or coordinates adds it)"])
    s.path([(U.right, U.cy), (L.x, U.cy)])
    s.path([(L.right, L.cy), (M.x, L.cy)], color=PAL["warn"][1], dashed=True)
    s.label((L.right + M.x) / 2, L.cy + 0.05, "no: nothing is downloaded", color=PAL["warn"][1])

    bus_y, chan_y, top0, pitch, bh = 9.5, 9.3, 9.13, 1.04, 0.9
    bx = EX + 0.7
    s.path([(bx, L.y), (bx, bus_y)], head=False)
    s.label(bx + 0.08, (L.y + bus_y) / 2 - 0.01, "yes: the same path in every state, with that state's files", ha="left", va="center")
    rows = [top0 - i * pitch for i in range(8)]
    mid = [r - bh / 2 for r in rows]
    s.path([(bx, bus_y), (0.2, bus_y), (0.2, mid[7])], head=False)
    s.label((0.2 + EX) / 2 + 0.2, bus_y + 0.03, "your point (lat, lon) goes to every service at once")

    src = [
        ("soil", "USDA-NRCS SSURGO soil survey", ["Soil Data Access web service", "map unit, horizons, WEG, I, T, factor C"], False),
        ("soil", "USGS 3DEP elevation", ["Elevation Point Query Service", "5 points → slope and aspect"], False),
        ("soil", "Land cover", ["NLCD 2021 (MRLC); when blocked,", "Sentinel-2 10 m (Esri / Impact Obs.)"], False),
        ("wx", "gridMET daily weather", ["Univ. of Idaho THREDDS server, 4 km", "rain, grass reference ET₀, Tmax/Tmin"], False),
        ("wx", "NASA MERRA-2 hourly wind (default)", ["NASA POWER API, ~50 km cell", "10 m speed and direction"], False),
        ("wx", "ECMWF hourly wind (backup)", ["Open-Meteo archive: re-hosted copy", "if NASA fails or > 20 s, or chosen"], True),
        ("wx", "NOAA airport records (GHCNh)", ["NCEI data service; IEM copy as backup", "hourly wind and gusts at the airport"], False),
        ("built", "The state's files (built in)", ["loaded when the state is chosen: outline,", "airports ≤ 150 km, maps, county C, practices"], False),
    ]
    S = []
    for i, (kind, title, lines, dashed) in enumerate(src):
        S.append(s.box(SX, rows[i], SW, bh, kind, title, lines, dashed=dashed))
        s.path([(0.2, mid[i]), (SX, mid[i])], lw=1.2)

    E1 = s.box(EX, rows[0], EW, bh + pitch, "calc", "Soil engine",
               ["dominant component, surface layer", "texture class → WEG and index I", "Saxton & Rawls water retention",
                "RWEQ EF and SCF (cross-check)", "profile parameters, .SOL export"], module="soil.js")
    E2 = s.box(EX, rows[3], EW, bh + 4 * pitch, "calc", "Wind & climate engine",
               ["nearest airport, quality-checked", "calibrate model to the airport", "(monthly quantile mapping)",
                "erosive hours: wind ≥ 8 m/s", "erosive energy Σ u²(u − 8)", "dryness = (ET₀ − P) / ET₀",
                "monthly risk = energy × dryness", "red month: ≥ 10 % of annual risk", "wind rose, direction, drift",
                "trend test, FAO index, gust days", "", "no airport with ≥ 60 % of hours:", "   model only, uncalibrated"],
               module="wind.js")
    K1 = s.box(KX, rows[0], KW, bh + pitch, "comb", "Erosion-risk model",
               ["E = I × C / 100   (t/ac/yr)", "EI = E / T", "C: SSURGO, else the state's", "county table; class Low … Extreme"],
               module="app.js · riskModel")
    K2 = s.box(KX, rows[2], KW, bh + 2 * pitch, "comb", "Practice planner",
               ["land use and your answers", "Texas: Texas rules; other states:", "the state's practice profile",
                "region (MLRA), soil group, risk", "→ NRCS practices, timing, species"], module="practices.js")
    R_soil = s.box(RX, rows[0], RW, bh, "out", "Soil and Soil profile tabs", ["Soil: surface layer, WEG, I", "Soil profile: horizons, .SOL"], lw=2)
    R_over = s.box(RX, rows[1], RW, bh + pitch, "out", "Overview tab",
                   ["risk class, E and EI", "erosive hours, red months,", "prevailing direction",
                    "(wind values from wind engine)"], lw=2)
    R_prac = s.box(RX, rows[3], RW, bh + pitch, "out", "Practices tab",
                   ["NRCS practice codes and specs", "timing calendar", "cover-crop and native species"], lw=2)
    R_wind = s.box(RX, rows[5], RW, bh + pitch, "out", "Wind tab",
                   ["seasonal hours, red months", "wind rose, moisture, trend", "airport vs model comparison"], lw=2)
    s.box(RX, rows[7], RW, bh, "out", "Methods sheet", ["sources used at this point,", "every equation and reference"], lw=2)

    for i in (0, 1):
        s.path([(S[i].right, mid[i]), (EX, mid[i])])
    s.path([(S[2].right, mid[2]), (KX, mid[2])])
    s.label(EX + EW / 2, mid[2] + 0.05, "land-cover class → default land use")
    for i in range(3, 8):
        s.path([(S[i].right, mid[i]), (EX, mid[i])])

    y = (mid[0] + mid[1]) / 2
    s.path([(E1.right, y), (KX, y)])
    s.label((E1.right + KX) / 2, y + 0.05, "I, WEG, T, C")
    cx = E1.right - 0.45
    s.path([(cx, E1.top), (cx, chan_y), (R_soil.cx, chan_y), (R_soil.cx, R_soil.top)])
    s.label(KX + KW / 2, chan_y + 0.03, "soil profile and derived properties")
    s.path([(K1.cx, K1.y), (K2.cx, K2.top)])
    y = (mid[3] + mid[4]) / 2
    s.path([(E2.right, y), (KX, y)])
    s.label((E2.right + KX) / 2, y + 0.05, "windy months")
    s.path([(K1.right, mid[1]), (RX, mid[1])])
    s.label((K1.right + RX) / 2, mid[1] + 0.05, "E, EI, class")
    s.path([(K2.right, y), (RX, y)])
    s.label((K2.right + RX) / 2, y + 0.05, "plan")
    y = (mid[5] + mid[6]) / 2
    s.path([(E2.right, y), (RX, y)])
    s.label(KX + KW / 2, y + 0.05, "hourly and monthly statistics")

    x = SX
    for kind, t in [("user", "You"), ("soil", "Soil and land data"), ("wx", "Weather and wind data"),
                    ("built", "Built into the app"), ("calc", "Calculated in your browser"), ("comb", "Combined"),
                    ("out", "On screen"), ("warn", "Refused")]:
        x = s.legend_swatch(x, 0.62, kind, t)
    x = s.legend_swatch(SX, 0.24, "panel", "solid border: read directly from the agency that produces it")
    x = s.legend_swatch(x, 0.24, "panel", "dashed border: re-hosted copy", dashed=True)
    s.text(x, 0.35, "Pre-built offline: state maps, county C, practice profiles. Also: area tool and boundary uploads Fig. 4 ·",
           fs=9.5, color=MUTED, va="center")
    s.text(x, 0.14, "model files and your files Fig. 5 · drought and Soil maps Fig. 6 · Soil maps in detail Figs. 7–9.",
           fs=9.5, color=MUTED, va="center")
    return s.save("flow_overview.png")


# --------------------------------------------------------------------------------------------
# Figure 2: wind and climate pipeline, with every fallback
# --------------------------------------------------------------------------------------------
def fig_wind():
    W, H = 8.6, 10.75
    s = Sheet(W, H)
    kw = dict(fs=10, tfs=11, lh=0.2)
    LW, xs = 2.7, [0.1, 2.95, 5.8]
    bw = LW - 0.24
    ptop = 10.62

    def chain(x0, items, top):
        """Stacked boxes inside a lane; items = (kind, title, lines, h, dashed, arrow-to-next label, dashed arrow)."""
        boxes, y = [], top
        for kind, title, lines, h, dashed, note, alt in items:
            b = s.box(x0 + 0.12, y, bw, h, kind, title, lines, dashed=dashed, **kw)
            if boxes:
                s.path([(b.cx, boxes[-1][0].y), (b.cx, b.top)], dashed=boxes[-1][1][1])
                if boxes[-1][1][0]:
                    s.label(b.cx, (boxes[-1][0].y + b.top) / 2, boxes[-1][1][0], va="center", fs=8.5)
            boxes.append((b, (note, alt)))
            y = b.y - 0.42
        return [b for b, _ in boxes]

    for x, t, h in [(xs[0], "A   Gridded hourly wind", 3.15), (xs[1], "B   Airport wind, for calibration", 5.65),
                    (xs[2], "C   Daily moisture", 3.95)]:
        s.panel(x, ptop, LW, h, t)
    A = chain(xs[0], [
        ("wx", "NASA MERRA-2 (default)", ["NASA POWER API · direct", "0.5° × 0.625° · 2001 on",
                                        "no gusts: daily max wind used"], 1.05, False, "error, or no answer in 20 s", True),
        ("wx", "ECMWF via Open-Meteo", ["backup copy · 9 km (ERA5 earlier)", "hourly speed, direction; daily gust",
                                       "also used when you choose it"], 1.05, True, None, False),
    ], ptop - 0.42)
    B = chain(xs[1], [
        ("built", "Pick the station", ["6 nearest within 150 km", "record covers the period", "ASOS ranked ahead of AWOS"],
         1.0, False, None, False),
        ("wx", "NOAA NCEI GHCNh", ["routine (FM-15) reports", "drop QC flags 2, 3, 6, 7", "wind ≤ 40, gust ≤ 55 m/s",
                                  "nearest report to each hour"], 1.22, False, "coverage < 60 %", True),
        ("wx", "IEM ASOS copy", ["still < 60 %: next station"], 0.68, True, None, False),
        ("wx", "Model at the station's cell", ["same model, same years", "(NASA POWER or Open-Meteo)"], 0.88, False, None, False),
    ], ptop - 0.42)
    C = chain(xs[2], [
        ("wx", "gridMET (Univ. of Idaho)", ["direct · 4 km · daily", "rain, grass ET₀ (ASCE PM),", "Tmax and Tmin"],
         1.05, False, "fails, or < 80 % of days", True),
        ("wx", "NASA POWER daily", ["direct · rain, temp., dew point,", "wind, sun → Penman–Monteith ET₀"], 0.88, False,
         "fails", True),
        ("wx", "Open-Meteo daily (ECMWF)", ["backup copy · rain, FAO-56 ET₀"], 0.68, True, None, False),
    ], ptop - 0.42)

    q_top = 4.55
    Q = s.box(0.1, q_top, 5.55, 1.27, "calc", "Calibrate to the airport (monthly quantile mapping)",
              ["for each month, rank model-at-station and station hours (101 quantiles)",
               "map each model hour at your point to the station value of equal rank",
               "gusts the same way; no usable airport → model only, uncalibrated"],
              module="wind.js · trainMappers, calibrate", **kw)
    pa, pb, pc = ptop - 3.15, ptop - 5.65, ptop - 3.95
    s.path([(xs[0] + LW / 2, pa), (xs[0] + LW / 2, Q.top)])
    s.label(xs[0] + LW / 2, (pa + Q.top) / 2, "first source that answers:\nhourly wind at your point", va="center", fs=8.5)
    s.path([(xs[1] + LW / 2, pb), (xs[1] + LW / 2, Q.top)])
    s.label(xs[1] + LW / 2 + 0.06, (pb + Q.top) / 2, "station + model at station", va="center", fs=8.5)

    an_top = 2.85
    s.path([(xs[2] + LW / 2, pc), (xs[2] + LW / 2, an_top)])
    s.label(xs[2] + LW / 2, (pc + an_top) / 2 + 0.6, "first source that answers:\ndaily rain, ET₀, temperature",
            va="center", fs=8.5)
    s.path([(Q.cx, Q.y), (Q.cx, an_top)])
    s.label(Q.cx, (Q.y + an_top) / 2, "calibrated hourly wind", va="center", fs=8.5)
    An = s.box(0.1, an_top, 8.4, 1.72, "calc", "Monthly analysis", [], module="wind.js · analyze", **kw)
    left = ["erosive hours: wind ≥ 8 m/s (adjustable)", "erosive energy: Σ u²(u − 8) per month",
            "dryness D = (ET₀ − P) / ET₀, from 0 to 1", "risk index = energy × D; share of the year",
            "red ≥ 10 % of the year, amber ≥ 6.7 %"]
    right = ["erosive wind rose, 16 sectors", "prevailing and resultant transport direction",
             "Fryberger drift potential DP and RDP", "FAO climatic index C",
             "linear trend with significance test", "gust days: daily gust ≥ 17.9 m/s"]
    for col, x in [(left, 0.24), (right, 4.4)]:
        for i, t in enumerate(col):
            s.text(x, an_top - 0.53 - i * 0.2, t, fs=10, limit=(4.3 if x < 1 else 8.42))

    ow, gap = 2.7, (8.4 - 3 * 2.7) / 2
    outs = [("out", "Wind tab", ["charts, rose, moisture, trend"]),
            ("out", "Overview tab", ["erosive hours, red months"]),
            ("comb", "Practice planner", ["calendar against windy months"])]
    for i, (kind, t, lines) in enumerate(outs):
        x = 0.1 + i * (ow + gap)
        b = s.box(x, 0.78, ow, 0.68, kind, t, lines, lw=2 if kind == "out" else 1.5, **kw)
        s.path([(b.cx, An.y), (b.cx, b.top)])
    return s.save("flow_wind.png")


# --------------------------------------------------------------------------------------------
# Figure 3: soil survey to erosion risk
# --------------------------------------------------------------------------------------------
def fig_soil():
    W, H = 8.6, 10.35
    s = Sheet(W, H)
    kw = dict(fs=10, tfs=11, lh=0.2)
    MX, MW = 0.1, 4.5
    SX, SW, chan = 4.95, 3.3, 8.45

    P1 = s.box(MX, 10.25, MW, 0.5, "user", "Your point (in a chosen state)", **kw)
    P2 = s.box(MX, 9.4, MW, 0.95, "soil", "SSURGO: soil map unit at the point",
               ["USDA-NRCS Soil Data Access, read directly"], module="SDA_Get_Mukey_from_intersection_with_WktWgs84", **kw)
    P3 = s.box(MX, 8.05, MW, 1.15, "soil", "8 queries at once",
               ["map unit, components, horizons, special areas", "(climatic factor C, rainfall R, MLRA),",
                "ecological site, crop yields, plants, restrictions"], **kw)
    P4 = s.box(MX, 6.5, MW, 0.82, "calc", "Dominant component → surface layer",
               ["sand, silt, clay, OM, CaCO₃, rock fragments"], module="soil.js", **kw)
    P5 = s.box(MX, 5.3, MW, 1.12, "calc", "Texture class → WEG and index I",
               ["USDA texture triangle; NRCS WEG rules: texture,", "clay, CaCO₃ ≥ 5 %, OM ≥ 20 %, stones",
                "I from the WEG table (t/ac/yr)"], module="soil.js · wegFromSurface", **kw)
    P6 = s.box(MX, 3.8, MW, 1.12, "comb", "Bare-soil erosion potential",
               ["E = I × C / 100   (t/ac/yr)", "C: the map unit's SSURGO factor; else the state's",
                "county table (NRCS or estimate); else 0.9 × FAO C"], module="app.js · riskModel, tableC", **kw)
    P7 = s.box(MX, 2.3, MW, 1.0, "comb", "Erodibility index and risk class",
               ["EI = E / T   (T = soil-loss tolerance, SSURGO)", "Low < 10 · Moderate 10–40 · High 40–80",
                "Very high 80–150 · Extreme ≥ 150 t/ac/yr"], **kw)
    P8 = s.box(MX, 1.02, MW, 0.92, "comb", "Practice planner", ["+ land use, answers, region, windy months;", "Texas rules or the state's profile"],
               module="practices.js", **kw)
    chain = [P1, P2, P3, P4, P5, P6, P7, P8]
    notes = [None, "map unit key", "components and horizons", "surface layer", "I, WEG", "E", "risk, WEG"]
    for a, b, n in zip(chain, chain[1:], notes):
        s.path([(a.cx - 1.2, a.y), (a.cx - 1.2, b.top)])
        if n:
            s.label(a.cx - 1.1, (a.y + b.top) / 2, n, ha="left", va="center", fs=8.5)

    Q1 = s.box(SX, 9.4, SW, 0.95, "soil", "USGS 3DEP elevation", ["5 points: center + 4 at ~100 m", "→ slope %, aspect"], **kw)
    Q2 = s.box(SX, 8.05, SW, 1.15, "calc", "Profile parameters",
               ["all horizons: LL, DUL, SAT, AWC, Ksat,", "root growth, runoff CN, SLU1, SLDR"],
               module="soil.js · toSOL", **kw)
    Q3 = s.box(SX, 6.5, SW, 1.0, "user", "Your edits", ["sand, silt, clay, OM, CaCO₃ (Soil tab);", "pH (Soil profile tab)"], **kw)
    Q4 = s.box(SX, 5.3, SW, 1.12, "calc", "Edited-layer properties",
               ["Saxton & Rawls 2006 water retention", "RWEQ EF and SCF (cross-check)", "flags soils outside RWEQ range"],
               module="soil.js · saxtonRawls, rweq", **kw)
    Q5 = s.box(SX, 3.8, SW, 1.12, "out", "Soil and Soil profile tabs", ["Soil: surface layer, WEG and I;", "Soil profile: horizons, CSV, .SOL"], lw=2, **kw)
    Q6 = s.box(SX, 2.3, SW, 1.0, "out", "Overview tab", ["risk card and 12-month strip", "WEG, C, EI"], lw=2, **kw)
    Q7 = s.box(SX, 0.88, SW, 0.78, "out", "Practices tab", ["NRCS practices, specs, timing"], lw=2, **kw)

    s.path([(Q1.cx, Q1.y), (Q1.cx, Q2.top)])
    s.path([(P3.right, P3.cy), (Q2.x, P3.cy)])
    s.label((P3.right + Q2.x) / 2, P3.cy + 0.05, "horizons", fs=8.5)
    s.path([(Q3.x, Q3.cy), (P4.right, Q3.cy)])
    s.label((P4.right + Q3.x) / 2, Q3.cy + 0.05, "replaces", fs=8.5)
    s.path([(P5.right, P5.cy), (Q4.x, P5.cy)])
    s.label((P5.right + Q4.x) / 2, P5.cy + 0.05, "texture", fs=8.5)
    s.path([(Q4.cx, Q4.y), (Q4.cx, Q5.top)])
    s.path([(Q2.right, Q2.cy), (chan, Q2.cy), (chan, Q5.cy), (Q5.right, Q5.cy)])
    s.path([(P7.right, P7.cy), (Q6.x, P7.cy)])
    s.path([(P8.right, P8.cy), (Q7.x, P8.cy)])
    return s.save("flow_soil.png")


# --------------------------------------------------------------------------------------------
# Figure 4: field or area analysis
# --------------------------------------------------------------------------------------------
def fig_area():
    W, H = 8.6, 9.1
    s = Sheet(W, H)
    kw = dict(fs=10, tfs=11, lh=0.2)
    D1 = s.box(0.1, 9.0, 4.1, 0.62, "user", "Draw on the map", ["tap the corners; tap the first one to close"], **kw)
    D2 = s.box(4.4, 9.0, 4.1, 0.62, "user", "Upload a boundary file", [".zip shapefile, .shp + .dbf + .prj, .kml, .kmz, .geojson"], **kw)
    B = s.box(0.1, 7.95, 8.4, 0.85, "calc", "Boundary polygon",
              ["read in the browser (shpjs reprojects with the .prj; togeojson, JSZip) · any size, large ones in tiles · acres from the polygon"],
              module="area.js · analyse", **kw)
    for d in (D1, D2):
        s.path([(d.cx, d.y), (d.cx, B.top)])
    bw, gap, top = 2.0, (8.4 - 4 * 2.0) / 3, 6.25
    srcs = [("soil", "SSURGO soil polygons", ["Soil Data Access clips", "map units to the boundary", "+ components, C"]),
            ("soil", "USA Structures", ["FEMA / ORNL", "building footprints"]),
            ("soil", "Census TIGER roads", ["centrelines widened", "by road class (MTFCC)"]),
            ("soil", "USGS NHD water", ["lakes, reservoirs, marshes", "Esri copy if NHD is slow", "+ SSURGO Water units"])]
    S = []
    bus = B.y - 0.25
    s.path([(B.cx, B.y), (B.cx, bus)], head=False)
    s.path([(0.1 + bw / 2, bus), (0.1 + 3 * (bw + gap) + bw / 2, bus)], head=False)
    for i, (kind, t, lines) in enumerate(srcs):
        x = 0.1 + i * (bw + gap)
        b = s.box(x, top, bw, 1.02, kind, t, lines, **kw)
        s.path([(b.cx, bus), (b.cx, b.top)])
        S.append(b)
    s.label(B.cx + 0.08, (B.y + bus) / 2, "all four at once", ha="left", va="center", fs=8.5)
    P = s.box(0.1, 4.55, 8.4, 1.2, "calc", "Sample the area",
              ["about 20,000 stratified random points inside the boundary (seeded: same area, same answer)",
               "left out: points on a building, within a road's half-width, in water, outside the chosen states, without soil",
               "each kept point is split among its map unit's components by their percentages"], module="area.js", **kw)
    for b in S:
        s.path([(b.cx, b.y), (b.cx, P.top)])
    Q = s.box(0.1, 2.9, 8.4, 0.85, "comb", "Shares and means",
              ["share and acres in each Wind Erodibility Group and risk class, E = I × C / 100 (C per map unit)",
               "area-weighted mean I and E · map units by share · components without a WEG reported apart"], **kw)
    s.path([(P.cx, P.y), (P.cx, Q.top)])
    ow, og = 2.7, (8.4 - 3 * 2.7) / 2
    for i, (t, lines) in enumerate([("Area panel", ["acres, bars, map-unit table"]), ("Map", ["soils by WEG, left-out features"]),
                                    ("CSV file", ["shares, acres, map units"])]):
        x = 0.1 + i * (ow + og)
        b = s.box(x, 1.45, ow, 0.68, "out", t, lines, lw=2, **kw)
        s.path([(b.cx, Q.y), (b.cx, b.top)])
    s.text(0.1, 0.45, "Map clicks use the same three layers: a point inside a building or water body, or within a road's\n"
           "half-width, is refused before anything is downloaded.", fs=9.5, color=MUTED, va="center", limit=W - 0.05)
    return s.save("flow_area.png")


# --------------------------------------------------------------------------------------------
# Figure 5: model files from the data sheet, with your own weather and soil files
# --------------------------------------------------------------------------------------------
def fig_models():
    W, H = 8.6, 10.0
    s = Sheet(W, H)
    kw = dict(fs=10, tfs=11, lh=0.2)
    LX, RX, CW = 0.25, 4.45, 3.9
    s.text(LX, 9.85, "WEATHER: ONE SOURCE, CHOSEN IN THE SHEET", fs=10, color=INK, weight="bold")
    s.text(RX, 9.85, "SOIL: THE SURVEY'S OR YOURS", fs=10, color=INK, weight="bold")
    wx = [s.box(LX, 9.55, CW, 0.72, "wx", "gridMET (University of Idaho)", ["THREDDS OPeNDAP, 4 km, 1979 on", "9 daily variables (direct)"], **kw),
          s.box(LX, 8.7, CW, 0.72, "wx", "PRISM (Oregon State University)", ["rain, Tmax, Tmin through ACIS GridData,", "4 km, 1981 on; the rest from gridMET"], **kw),
          s.box(LX, 7.85, CW, 0.52, "wx", "NASA POWER daily", ["0.5°, 1981 on (direct)"], **kw),
          s.box(LX, 7.2, CW, 0.72, "user", "Your weather file (upload)", ["CSV, text or Excel, read in the browser;", "columns found by name, units converted"], **kw)]
    so = [s.box(RX, 9.55, CW, 0.52, "soil", "SSURGO soil at the point", ["the profile on the Soil profile tab"], **kw),
          s.box(RX, 8.9, CW, 0.72, "user", "Your soil profile (upload or type)", ["a CSV read in the browser, or typed layers;", "blanks estimated (Saxton & Rawls 2006)"], **kw),
          s.box(RX, 8.05, CW, 0.72, "built", "Templates and CO₂ (built in)", ["the layout of your own files to download;", "NOAA GML CO₂ for APSIM"], **kw)]
    for col, x in ((wx, LX - 0.13), (so, RX - 0.13)):
        s.path([(x, col[0].cy), (x, 6.05)], head=False)
        for b in col:
            s.path([(x, b.cy), (b.x, b.cy)], head=False, lw=1.2)
    C1 = s.box(0.12, 5.85, 8.36, 0.95, "calc", "Read, clean and fill the weather",
               ["dates cut to the source's record · values no station reports become missing",
                "your file: missing days from gridMET, ET₀ by FAO-56 · a gap-free copy where a model needs one"],
               module="wind.js · dailyWeather; models.js · parseWeatherCSV, fillGaps; writers.js", **kw)
    s.path([(LX - 0.13, 6.05), (2.0, 6.05), (2.0, C1.top)])
    C2 = s.box(0.12, 4.65, 8.36, 0.95, "calc", "Climate statistics and soil layers",
               ["TAV and AMP, weather-generator statistics · each model's layers, the horizons as they are, or your depths",
                "(thickness-weighted; OM, C, CaCO₃ and N by mass; harmonic Ksat) · stops at bedrock"],
               module="writers.js · tavAmp, wp1Stats; models.js · relayer", **kw)
    s.path([(4.3, C1.y), (4.3, C2.top)])
    s.path([(RX - 0.13, 6.05), (8.55, 6.05), (8.55, C2.cy), (C2.right, C2.cy)])  # the soil, round the weather step
    s.label(8.5, 6.1, "soil", ha="right", va="bottom", fs=8.5)
    O1 = s.box(0.12, 3.35, 4.0, 0.72, "out", "Preview", ["charts and tables of what the zip will hold;", "nothing is saved"], lw=2, **kw)
    O2 = s.box(4.48, 3.35, 4.0, 0.92, "out", "One zip", ["DSSAT · SWAT+ · EPIC · APEX · APSIM", "AquaCrop · CENTURY · DayCent · CSV,", "a README in each folder"], lw=2, **kw)
    for b in (O1, O2):
        s.path([(b.cx, C2.y), (b.cx, b.top)])
    G = s.box(0.12, 2.05, 8.36, 0.95, "calc", "Area grid (from the area tool, Figure 4)",
              ["cells from 20 cm up inside the boundary · soil from the map units and C as the area panel uses it,",
               "weather per weather cell · model files once per soil and per weather cell, joined by run_id"], module="grid.js; gridfiles.js", **kw)
    O3 = s.box(0.12, 0.85, 8.36, 0.52, "out", "GeoTIFF, shapefile, GeoJSON and CSV, and model folders", ["the columns you choose, in the chosen projection; models/runs.csv joins cells to files"], lw=2, **kw)
    s.path([(G.cx, G.y), (G.cx, O3.top)])
    s.text(0.12, 0.12, "Uploads are read in your browser and never leave it; the sheet's Preview draws everything before a download.",
           fs=9.5, color=MUTED, va="center", limit=W - 0.05)
    return s.save("flow_models.png")


# --------------------------------------------------------------------------------------------
# Figure 6: the Drought and Soil maps themes, their tabs, the map on a past week and the downloads
# --------------------------------------------------------------------------------------------
def fig_drought():
    W, H, o = 8.6, 10.4, 0.0  # o: every height below is written as on a 10.4-in sheet (moved down by o, here none)
    s = Sheet(W, H)
    kw = dict(fs=9.5, tfs=10.5, lh=0.19)
    SX, SW, KX, KW, RX, RW = 0.1, 2.75, 3.0, 2.6, 5.75, 2.75
    gx = (SX + SW + KX) / 2  # the gap between the first two columns
    for x, tt in [(SX, "WHERE IT COMES FROM"), (KX, "IN YOUR BROWSER"), (RX, "WHAT YOU SEE")]:
        s.text(x, 10.15 + o, tt, fs=10, color=INK, weight="bold")
    s.text(SX, 9.85 + o, "DROUGHT", fs=9.5, color=MUTED, weight="bold")

    D = [s.box(SX, 9.6 + o, SW, 0.72, "wx", "U.S. Drought Monitor (NDMC)", ["WMS: this week, any week since", "2000; GetFeatureInfo; GetMap"], **kw),
         s.box(SX, 8.75 + o, SW, 0.72, "wx", "NOAA CPC drought outlooks", ["WMS on the map; REST query", "at the point"], **kw),
         s.box(SX, 7.9 + o, SW, 0.72, "wx", "Esri Living Atlas", ["U.S. Drought Intensity: the", "weekly classes, 2000 on"], dashed=True, **kw),
         s.box(SX, 7.05 + o, SW, 0.92, "wx", "gridMET Drought", ["SPI, SPEI, PDSI, 4 km, every", "5 days, 1980 on (OPeNDAP,", "else file byte ranges)"], **kw)]
    K = [s.box(KX, 9.6 + o, KW, 0.92, "calc", "Live overlay", ["drawn as the agency draws it;", "nothing recomputed"], module="weather.js", **kw),
         s.box(KX, 8.5 + o, KW, 0.73, "calc", "Past-week frames", ["one week at a time; play"], module="timemap.js", **kw),
         s.box(KX, 7.6 + o, KW, 1.12, "calc", "Drought parts", ["class at the point, week by", "week; indices and their", "classes; outlook at the point"], module="weather.js", **kw),
         s.box(KX, 6.3 + o, KW, 1.12, "calc", "Drought Monitor downloads", ["weekly classes at the point;", "grid cells classed by the", "map's colour"], module="datasheet.js · grid.js", **kw)]
    R = [s.box(RX, 9.6 + o, RW, 0.92, "out", "Map themes", ["Wind erosion · Soil maps ·", "Drought: one overlay at a time,", "the agency's own legend"], lw=2, **kw),
         s.box(RX, 8.5 + o, RW, 0.73, "out", "Map on a past week", ["the Drought Monitor, any week", ], lw=2, **kw),
         s.box(RX, 7.6 + o, RW, 1.12, "out", "Drought tab", ["this week and outlooks; week", "by week since 2000; between", "years since 1980"], lw=2, **kw),
         s.box(RX, 6.3 + o, RW, 1.12, "out", "Data sheet and area grid", ["drought_monitor_weekly.csv;", "dm_* columns and", "drought/weeks.csv"], lw=2, **kw)]
    s.path([(gx, D[0].cy), (gx, K[-1].cy)], head=False)
    for b in D:
        s.path([(b.right, b.cy), (gx, b.cy)], head=False, lw=1.2)
    for k, r in zip(K, R):
        s.path([(gx, k.cy), (k.x, k.cy)])
        s.path([(k.right, k.cy), (r.x, k.cy)])

    top = 4.95
    s.text(SX, top + 0.25 + o, "SOIL MAPS", fs=9.5, color=MUTED, weight="bold")
    S = [s.box(SX, top + o, SW, 0.72, "soil", "USFS gNATSGO, 30 m", ["pH, CEC, OM by depth:", "exportImage; getSamples"], **kw),
         s.box(SX, top - 0.85 + o, SW, 0.72, "built", "State EC and SAR images", ["build_soilmaps.py ← SoilWeb", "ec_025.tif, sar.tif (800 m)"], **kw),
         s.box(SX, top - 1.7 + o, SW, 0.72, "soil", "USGS DS-801", ["WMS (+ soilchem_legend.json);", "WFS → nearest sites' JSON"], **kw),
         s.box(SX, top - 2.55 + o, SW, 0.72, "soil", "ISRIC SoilGrids 2.0", ["total N: WMS; REST at", "the point"], **kw),
         s.box(SX, top - 3.4 + o, SW, 0.72, "soil", "Soil Data Access", ["SSURGO horizons;", "KSSL lab tables"], **kw)]
    KS = [s.box(KX, top + o, KW, 1.12, "calc", "Soil maps theme", ["one layer at a time: depth,", "element and horizon chosen;", "classes in the legend"], module="soilmaps.js", **kw),
          s.box(KX, top - 1.7 + o, KW, 1.31, "calc", "Soil maps tab", ["depth-weighted 0–15, 0–30 cm;", "reaction, salinity, sodic", "classes; nearest sites", "and pedons"], module="soilmaps.js", **kw)]
    RS = [s.box(RX, top + o, RW, 1.12, "out", "Soil maps on the map", ["pH, CEC, OM, salinity,", "sodicity, total elements,", "total N"], lw=2, **kw),
          s.box(RX, top - 1.7 + o, RW, 1.31, "out", "Soil maps tab", ["survey chemistry by depth;", "30 m values; total N; USGS", "sites; KSSL pedons; CSV", "of every table"], lw=2, **kw)]
    s.path([(gx, S[0].cy), (gx, S[-1].cy)], head=False)
    for b in S:
        s.path([(b.right, b.cy), (gx, b.cy)], head=False, lw=1.2)
    for k, r in zip(KS, RS):
        s.path([(gx, k.cy), (k.x, k.cy)])
        s.path([(k.right, k.cy), (r.x, k.cy)])

    s.text(SX, S[-1].y - 0.28, "Each part reads only the sources it needs. Wind erosion is in Figures 1–4; the Soil maps, in detail,",
           fs=9.5, color=MUTED, va="center", limit=W - 0.05)
    s.text(SX, S[-1].y - 0.52, "in Figures 7–9. Survey values describe typical soil, not a soil test; total elements are not plant-available.",
           fs=9.5, color=MUTED, va="center", limit=W - 0.05)
    return s.save("flow_drought.png")


# --------------------------------------------------------------------------------------------
# Figure 7: the Soil maps theme and tab
# --------------------------------------------------------------------------------------------
def fig_soilmaps():
    W, H = 8.6, 7.1
    T = H - 0.25  # the column titles; every height below is measured down from them
    s = Sheet(W, H)
    kw = dict(fs=9.5, tfs=10.5, lh=0.19)
    SX, SW, KX, KW, RX, RW = 0.1, 2.75, 3.0, 2.6, 5.75, 2.75
    gx = (SX + SW + KX) / 2  # the gap between the first two columns
    for x, t in [(SX, "WHERE IT COMES FROM"), (KX, "IN YOUR BROWSER"), (RX, "WHAT YOU SEE")]:
        s.text(x, T, t, fs=10, color=INK, weight="bold")

    s.text(SX, T - 0.27, "Map layers: one at a time", fs=9, color=MUTED, weight="semibold")
    src = [("soil", "USFS gNATSGO 30 m (CC0)", "pH, CEC, OM; 4 depths to 100 cm"),
           ("built", "Salinity, sodicity (built in)", "SoilWeb 800 m EC, SAR → state PNGs"),
           ("soil", "USGS DS-801 soils WMS", "total P, K, Ca … Na; top 5 cm, A, C"),
           ("soil", "ISRIC SoilGrids 2.0 WMS", "total N, 250 m, 6 depths (model)")]
    L = [s.box(SX, T - 0.5 - i * 0.6, SW, 0.5, k, t, [l], **kw) for i, (k, t, l) in enumerate(src)]
    K1 = s.box(KX, T - 0.9, KW, 1.5, "calc", "Layer, depth, legend",
               ["one layer at a time; depth,", "element and horizon chosen", "(kept on the device); classes",
                "drawn by the USFS server or", "from soilchem_legend.json"], module="soilmaps.js", **kw)
    R1 = s.box(RX, T - 0.9, RW, 1.5, "out", "Soil maps theme",
               ["pH, CEC, organic matter,", "salinity, sodicity, total", "nutrients, total N; each with", "its legend, units, depth", "and credit"], lw=2, **kw)
    s.path([(gx, L[0].cy), (gx, L[-1].cy)], head=False)
    for b in L:
        s.path([(b.right, b.cy), (gx, b.cy)], head=False, lw=1.2)
    s.path([(gx, K1.cy), (K1.x, K1.cy)])
    s.path([(K1.right, K1.cy), (R1.x, K1.cy)])

    s.text(SX, T - 3.02, "The Soil maps tab, at the point", fs=9, color=MUTED, weight="semibold")
    tab = [("SSURGO by Soil Data Access", "the major components' horizons"),
           ("USFS gNATSGO getSamples", "pH, CEC, OM at the 4 depths"),
           ("ISRIC SoilGrids REST", "total N: mean, 5–95 % range"),
           ("USGS DS-801 sites", "WFS, then site JSON: 3 nearest"),
           ("NRCS KSSL lab data", "SDA lab tables: 8 nearest pedons")]
    P = [s.box(SX, T - 3.25 - i * 0.6, SW, 0.5, "soil", t, [l], **kw) for i, (t, l) in enumerate(tab)]
    K2 = s.box(KX, T - 3.25, KW, 1.1, "calc", "Depth-weighting, classes",
               ["0–15, 0–30 cm by thickness; map", "unit by component share; reaction,", "salinity, sodic or saline"],
               module="soilmaps.js · over, reaction", **kw)
    K3 = s.box(KX, T - 4.55, KW, 1.6, "calc", "Values at the point",
               ["the 30 m values; SoilGrids N;", "USGS sites: distance, direction,", "totals beside the US median;",
                "KSSL pedons: Ca * where", "calcareous"], module="soilmaps.js", **kw)
    R2 = s.box(RX, T - 3.25, RW, 2.9, "out", "Soil maps tab",
               ["at a glance: reaction, salinity,", "sodic or saline at 0–15 cm;", "tables by depth and horizon;",
                "the 30 m values; SoilGrids N;", "the 3 nearest USGS sites;", "the 8 nearest lab pedons;",
                "a CSV of each table, or all", "", "Overview tab: a pH headline", "and tiles from the same reads,", "Details → to each card"], lw=2, **kw)
    s.path([(P[0].right, P[0].cy), (K2.x, P[0].cy)])
    s.path([(gx, P[1].cy), (gx, P[-1].cy)], head=False)
    for b in P[1:]:
        s.path([(b.right, b.cy), (gx, b.cy)], head=False, lw=1.2)
    s.path([(gx, K3.cy), (K3.x, K3.cy)])
    for k in (K2, K3):
        s.path([(k.right, k.cy), (R2.x, k.cy)])
    s.text(SX, P[-1].y - 0.3, "Labels: survey (SSURGO, USFS), model (SoilGrids), total (USGS, SoilGrids N: not plant-available), lab (KSSL).",
           fs=9.5, color=MUTED, va="center", limit=W - 0.05)
    s.text(SX, P[-1].y - 0.55, "No US-wide map of soil-test N, P, K, Ca, Mg or S or DTPA micronutrients; boron and P survey data are limited. The tab says so.",
           fs=9.5, color=MUTED, va="center", limit=W - 0.05)
    return s.save("flow_soilmaps.png")


# --------------------------------------------------------------------------------------------
# Figure 8: basins in the Soil maps theme and tab: runoff and soil loss for the HU12 at the point
# --------------------------------------------------------------------------------------------
def fig_basins():
    W, H = 8.6, 5.85
    T = H - 0.25  # the column titles; every height below is measured down from them
    s = Sheet(W, H)
    kw = dict(fs=9.5, tfs=10.5, lh=0.19)
    SX, SW, KX, KW, RX, RW = 0.1, 2.75, 3.0, 2.6, 5.75, 2.75
    gx = (SX + SW + KX) / 2  # the gap between the first two columns
    for x, t in [(SX, "WHERE IT COMES FROM"), (KX, "IN YOUR BROWSER"), (RX, "WHAT YOU SEE")]:
        s.text(x, T, t, fs=10, color=INK, weight="bold")

    s.text(SX, T - 0.27, "For the HU12 that holds the point", fs=9, color=MUTED, weight="semibold")
    src = [(0.5, "soil", "USGS WBD MapServer", "HU12 at the point; HU8–HU12 map"),
           (1.1, "soil", "USGS NHDPlus HR MapServer", "flowlines, sinks; catchments by id"),
           (1.85, "built", "Atlas 14 (built in)", "2-, 10-, 100-yr 24 h → atlas14.json"),
           (2.45, "soil", "MRLC NLCD 2021 WCS", "30 m classes in the HU12"),
           (3.05, "soil", "SSURGO by Soil Data Access", "groups, K, slope, λ, T in the HU12"),
           (3.8, "built", "R factor (built in)", "RF7100 per COMID → rfactor.json"),
           (4.4, "soil", "USGS NLDI", "COMID at the point; upstream basin")]
    S = [s.box(SX, T - d, SW, 0.5, k, t, [l], **kw) for d, k, t, l in src]
    K1 = s.box(KX, T - 0.5, KW, 1.3, "calc", "Catchments and runoff",
               ["893.6 × qincrama ÷ area,", "each catchment; HU12 mean;", "upstream by hydroseq; the", "NLDI basin on request"],
               module="basins.js · network", **kw)
    K2 = s.box(KX, T - 1.9, KW, 1.1, "calc", "Curve number",
               ["TR-55 CN by class and soil", "group; Q per pair, averaged;", "volume over the land"], module="basins.js · cnModel", **kw)
    K3 = s.box(KX, T - 3.1, KW, 1.8, "calc", "RUSLE",
               ["A = R K LS C P; K × LS per", "component; McCool S, L by", "slope class; C by land cover;", "A against T, tons a year"],
               module="basins.js · drawRusle", **kw)
    R1 = s.box(RX, T - 0.5, RW, 0.92, "out", "Soil maps theme",
               ["watershed boundaries; streams;", "HU12 catchments coloured by", "runoff; the point's, upstream"], lw=2, **kw)
    R2 = s.box(RX, T - 1.52, RW, 3.38, "out", "Soil maps tab",
               ["HU12 runoff and the point's", "catchment, flow, drainage area;", "storm runoff and volume;",
                "soil loss against T, tons a", "year; a CSV of each table"], lw=2, **kw)
    # WBD and NHDPlus HR feed the network; Atlas 14 the storm; NLCD and SSURGO both methods; R and the COMID RUSLE
    s.path([(gx, S[0].cy), (gx, S[1].cy)], head=False)
    for b in S[:2]:
        s.path([(b.right, b.cy), (gx, b.cy)], head=False, lw=1.2)
    s.path([(gx, K1.cy), (K1.x, K1.cy)])
    s.path([(S[2].right, S[2].cy), (K2.x, S[2].cy)])
    s.path([(gx, S[3].cy), (gx, S[4].cy)], head=False)
    for b in S[3:5]:
        s.path([(b.right, b.cy), (gx, b.cy)], head=False, lw=1.2)
    s.path([(gx, K2.y + 0.15), (K2.x, K2.y + 0.15)])
    s.path([(gx, K3.top - 0.15), (K3.x, K3.top - 0.15)])
    for b in S[5:]:
        s.path([(b.right, b.cy), (K3.x, b.cy)])
    s.path([(K1.right, R1.cy), (R1.x, R1.cy)])
    s.path([(K1.right, K1.y + 0.13), (R2.x, K1.y + 0.13)])
    for k in (K2, K3):
        s.path([(k.right, k.cy), (R2.x, k.cy)])
    s.text(SX, S[-1].y - 0.3, "Labels: model (EROM runoff, the curve number, RUSLE), survey (SSURGO), map (NLCD 2021).",
           fs=9.5, color=MUTED, va="center", limit=W - 0.05)
    s.text(SX, S[-1].y - 0.55, "NOAA Atlas 14 depths are built in for every state but Oregon and Washington, where the "
           "24-hour depth is typed.",
           fs=9.5, color=MUTED, va="center", limit=W - 0.05)
    return s.save("flow_basins.png")


# --------------------------------------------------------------------------------------------
# Figure 9: soil moisture by depth in the Soil maps theme and tab
# --------------------------------------------------------------------------------------------
def fig_moisture():
    W, H = 8.6, 7.0
    T = H - 0.25  # the column titles; every height below is measured down from them
    s = Sheet(W, H)
    kw = dict(fs=9.5, tfs=10.5, lh=0.19)
    SX, SW, KX, KW, RX, RW = 0.1, 2.75, 3.0, 2.6, 5.75, 2.75
    gx = (SX + SW + KX) / 2  # the gap between the first two columns
    for x, t in [(SX, "WHERE IT COMES FROM"), (KX, "IN YOUR BROWSER"), (RX, "WHAT YOU SEE")]:
        s.text(x, T, t, fs=10, color=INK, weight="bold")

    def group(top, title, items):
        s.text(SX, T - top + 0.23, title, fs=9, color=MUTED, weight="semibold")
        return [s.box(SX, T - top - i * 0.6, SW, 0.5, k, t, [l], dashed=d, **kw) for i, (k, t, l, d) in enumerate(items)]

    def bus(boxes, k, y=None):
        s.path([(gx, boxes[0].cy), (gx, boxes[-1].cy)], head=False)
        for b in boxes:
            s.path([(b.right, b.cy), (gx, b.cy)], head=False, lw=1.2)
        s.path([(gx, k.cy if y is None else y), (k.x, k.cy if y is None else y)])

    G1 = group(0.5, "Map layers: one at a time",
               [("soil", "NASA GIBS: SMAP L4", "0–5, 0–100 cm; any day since 2015", False),
                ("soil", "NOAA NWM WMS", "0–40 cm saturation, latest hour", False),
                ("soil", "NOAA NIDIS tiles", "SPoRT-LIS, GRACE-DA percentiles", False)])
    G2 = group(2.65, "Stations: on the map and in the tab",
               [("built", "Station list (built in)", "SCAN, SNOTEL, USCRN → JSON", False),
                ("soil", "NRCS AWDB, NCEI USCRN", "hourly and daily readings", False)])
    G3 = group(4.35, "The Soil maps tab, at the point",
               [("soil", "Open-Meteo (a copy)", "ERA5-Land, ECMWF IFS, 4 depths", True),
                ("soil", "USDA Crop-CASMA", "SMAP L4 at the 9 km cell", False),
                ("soil", "NWM files on AWS", "4 layers, on request (byte ranges)", False)])
    K1 = s.box(KX, T - 0.5, KW, 1.7, "calc", "Layer, day, legend",
               ["one layer at a time; SMAP's", "day chosen under the legend", "(GIBS lists the days it has);",
                "NWM tiles asked again each", "half hour while it is on"], module="soilmoisture.js · LAYERS", **kw)
    K3 = s.box(KX, T - 2.6, KW, 1.3, "calc", "Nearest stations",
               ["dots from the list; the 3", "nearest within 400 km; % ÷ 100;", "latest hour, 30 daily means"],
               module="soilmoisture.js · readStations", **kw)
    K2 = s.box(KX, T - 4.35, KW, 1.7, "calc", "Series by depth",
               ["ERA5-Land and IFS at 4 depths,", "local-day means; SMAP at its", "9 km cell; the NWM's 1 km", "cell by byte ranges; m³/m³"],
               module="soilmoisture.js · era5At, ifsAt", **kw)
    R1 = s.box(RX, T - 0.5, RW, 2.55, "out", "Soil maps theme",
               ["SMAP surface or root zone on", "any day since 2015; NWM", "saturation this hour; SPoRT", "and GRACE percentiles;",
                "station dots: tap one"], lw=2, **kw)
    R2 = s.box(RX, T - 3.15, RW, 2.9, "out", "Soil maps tab",
               ["models by depth: today and", "30 days; SMAP and the NWM", "at the point; the 3 nearest",
                "stations' latest readings and", "daily means; 30-day charts;", "a CSV of each table"], lw=2, **kw)
    bus(G1, K1)
    bus(G2, K3)
    bus(G3, K2)
    s.path([(K1.right, K1.cy), (R1.x, K1.cy)])
    s.path([(K3.right, K3.top - 0.18), (R1.x, K3.top - 0.18)])
    s.path([(K3.right, K3.y + 0.25), (R2.x, K3.y + 0.25)])
    s.path([(K2.right, K2.cy), (R2.x, K2.cy)])
    s.text(SX, G3[-1].y - 0.3, "Labels: model (ERA5-Land, IFS, NWM, SPoRT), satellite + model (SMAP L4, GRACE-DA), station (SCAN, SNOTEL, USCRN).",
           fs=9.5, color=MUTED, va="center", limit=W - 0.05)
    s.text(SX, G3[-1].y - 0.55, "Compare changes more than levels: a model's soil is not the field's. Dashed: a re-hosted copy.",
           fs=9.5, color=MUTED, va="center", limit=W - 0.05)
    return s.save("flow_moisture.png")


# --------------------------------------------------------------------------------------------
# The Word document
# --------------------------------------------------------------------------------------------
SOURCES = [
    ("Soil survey: map unit, components, horizons, WEG, I, T, climatic factor C, rainfall R, MLRA, yields, plants",
     "USDA-NRCS SSURGO", "Soil Data Access SQL web service (direct)", "survey polygons, mapped at 1:12,000–1:24,000",
     "the Soil and Soil profile tabs show the error; risk cannot be computed"),
    ("Elevation, slope and aspect", "USGS 3DEP", "Elevation Point Query Service, 5 points (direct)",
     "best available 3DEP: 1 m lidar where flown, else ~10 m", "Copernicus 90 m elevation via Open-Meteo (after 15 s)"),
    ("Land cover", "MRLC NLCD 2021; Esri / Impact Observatory", "WMS GetFeatureInfo; ImageServer identify (direct)",
     "30 m; Sentinel-2 10 m", "Sentinel-2 when NLCD is blocked (currently always: MRLC refuses web-page requests)"),
    ("Daily rain, grass reference ET₀, Tmax, Tmin", "University of Idaho gridMET", "THREDDS OPeNDAP, one cell (direct)",
     "4 km, daily, 1979 on; last ~4 days not yet published", "NASA POWER daily with Penman–Monteith ET₀ computed in the app, then Open-Meteo daily (ECMWF)"),
    ("Hourly 10 m wind speed and direction (default)", "NASA GMAO MERRA-2", "NASA POWER hourly API (direct)",
     "0.5° × 0.625° (~50 km), 2001 on; no gust variable", "ECMWF via Open-Meteo if NASA POWER errors or has not answered within 20 s"),
    ("Hourly 10 m wind, daily max gust (backup, or when chosen)", "ECMWF: IFS analysis from 2017, ERA5 before",
     "Open-Meteo archive (re-hosted copy)", "9 km from 2017; 0.25° (~28 km) before", "NASA MERRA-2"),
    ("Airport hourly wind and gusts (for calibration)", "NOAA NCEI GHCNh", "NCEI Access Data Service, one request per year, 6 at a time (direct)",
     "station, hourly", "Iowa Environmental Mesonet ASOS copy; then the next station"),
    ("Airport station list", "Iowa Environmental Mesonet networks + NOAA ISD and GHCNh lists",
     "built into each state's file (data/states/XX.json)", "2,478 airports; a state holds those within 150 km", "—"),
    ("Soil polygons inside a drawn or uploaded area", "USDA-NRCS SSURGO", "Soil Data Access spatial query, clipped to "
     "the boundary (direct)", "map units, 1:12,000–1:24,000", "—"),
    ("Building footprints (area tool, map clicks)", "FEMA / ORNL USA Structures", "ArcGIS feature service (direct)",
     "footprint polygons", "not removed; the panel says so"),
    ("Roads (area tool, map clicks)", "U.S. Census Bureau TIGER/Line", "TIGERweb map service (direct); widened by road class",
     "road centrelines", "not removed; the panel says so"),
    ("Water bodies (area tool, map clicks)", "USGS NHD (lakes, reservoirs, marshes; playas stay in) + SSURGO Water units",
     "NHD map service (direct)", "1:24,000 polygons", "Esri's copy of NHD after 5 s (3 s for a click)"),
    ("Boundary files", "your shapefile, KML/KMZ or GeoJSON", "read in the browser with shpjs, togeojson, JSZip",
     "as drawn", "—"),
    ("Place suggestions", "U.S. Census Bureau 2020 Gazetteer; 2024 population estimates", "pre-built list "
     "(data/places.txt), matched while typing", "each place's inside point", "—"),
    ("Place search", "OpenStreetMap Nominatim", "search API on Enter, one request a second; 48 states and DC; a place "
     "in another state adds it", "—", "type coordinates instead"),
    ("Statewide map layers", "SSURGO WEG/I (UC Davis SoilWeb), NRCS county C (estimated where missing), NASA POWER wind; "
     "built offline", "each state's file and PNG overlays (data/states/XX/)", "1 km statewide grid", "display only"),
    ("County climatic factor C", "SSURGO county overlaps; Chepil C from NASA POWER × 1.64 where SSURGO gives none",
     "each state's file (data/states/XX.json)", "county or soil survey area", "—"),
    ("County at the point", "U.S. Census TIGERweb (Census 2020 counties)", "map service query (direct)", "county",
     "the map unit's county with the most acres"),
    ("Practice profiles", "each state's NRCS Field Office Technical Guide (+ extension pages for a few states)",
     "data/practices/XX.json, loaded with the Practices tab", "state, by region", "Texas: rules built into practices.js"),
    ("Base maps; county lines", "Esri, USGS, OpenStreetMap; U.S. Census TIGER (county lines)", "map tiles; TIGERweb map "
     "service drawn per tile", "—", "switch base map"),
    ("Daily weather for model files (data sheet)", "University of Idaho gridMET; PRISM (Oregon State University); NASA POWER; or your own daily file",
     "THREDDS OPeNDAP, 9 variables (direct); PRISM's rain and temperature through ACIS GridData (NOAA RCC), the rest from gridMET; POWER daily API (direct); your CSV, text or Excel file read in the browser",
     "4 km, 1979 on; 4 km, 1981 on; 0.5°, 1981 on; your station", "NASA POWER; gaps in your file can be filled from gridMET"),
    ("Drought Monitor (Drought map and tab)", "National Drought Mitigation Center (USDM)", "NDMC MapServer WMS, this week "
     "and any week since 2000; GetFeatureInfo at the point (direct)", "weekly polygons", "—"),
    ("Drought Monitor week by week at the point (Drought tab, data sheet)", "Esri Living Atlas, U.S. Drought Intensity (a copy of the weekly maps)",
     "FeatureServer point query, pages of 260", "weekly, 2000 on", "NDMC GetFeatureInfo on each week's map (direct)"),
    ("Drought Monitor in the area grid", "National Drought Mitigation Center (USDM)", "WMS GetMap PNGs, classed by colour (direct)",
     "about 0.001° a pixel", "a week not read is left out and named"),
    ("Drought outlooks (Drought map and tab)", "NOAA Climate Prediction Center", "NWS map services: WMS layers 5 and 2; REST "
     "query of layers 1 and 4 at the point (direct)", "monthly; seasonal", "the tab says it could not be read"),
    ("Drought indices (Drought tab)", "University of Idaho gridMET Drought", "THREDDS OPeNDAP (direct)", "4 km, every 5 days, 1980 on",
     "the same NetCDF-4 files on its file server, read in place by byte ranges: only the chunks that hold the cell (direct)"),
    ("Soil maps: pH, CEC (pH 7), organic matter", "USDA Forest Service gNATSGO 2022 (CC0)", "image services: exportImage, "
     "getSamples (direct)", "30 m; 0–5, 5–25, 25–50, 50–100 cm", "left blank"),
    ("Soil maps: salinity EC, sodicity SAR", "UC Davis SoilWeb grids from SSURGO", "per-state PNGs built by tools/build_soilmaps.py",
     "800 m", "—"),
    ("Soil maps: total P, K, Ca, Mg, S, Zn, Fe, Mn, Cu, Na", "USGS DS-801 (Smith et al. 2013)", "WMS; WFS and site JSON (direct)",
     "about 1 site per 1,600 km²", "the tab says why"),
    ("Soil maps: total nitrogen", "ISRIC SoilGrids 2.0 (CC BY 4.0)", "WMS; REST at the point (direct)", "250 m, 6 depths",
     "no value on built-up land and water"),
    ("Soil maps tab: chemistry by horizon, lab pedons", "USDA-NRCS SSURGO and KSSL", "Soil Data Access (direct)",
     "map units; points", "the tab says why"),
    ("Soil maps: watershed boundaries, streams", "USGS WBD; USGS NHDPlus HR (public domain)", "MapServer export tiles, "
     "the app's own symbols (direct)", "HU8–HU12; flowlines from zoom 12", "—"),
    ("Soil maps tab: basin runoff", "NHDPlus HR EROM step A (a model); USGS NLDI", "HU12 by point query; flowlines and "
     "sinks by its polygon; catchments by id, 500 a request (direct)", "HR catchments; HU12 40–250 km²",
     "the card says it could not be read"),
    ("Soil maps tab: design-storm runoff", "NOAA Atlas 14 Vols. 1, 2, 6, 8–12 (not OR, WA); NLCD 2021; SSURGO", "pre-built "
     "atlas14.json (tools/build_basins.py); MRLC WCS; Soil Data Access", "0.05°; 30 m; map units", "a typed depth (OR, WA)"),
    ("Soil maps tab: soil loss (RUSLE)", "USGS RF7100 (Wieczorek & LaMotte 2010); SSURGO; NLCD 2021", "pre-built "
     "rfactor.json per state (tools/build_basins.py); COMID from NLDI", "NHDPlus V2 catchment", "a typed R"),
    ("Soil maps: soil moisture maps", "NASA SMAP L4; NOAA NWM 3.0; NASA SPoRT-LIS, GRACE-DA", "NASA GIBS WMTS; NOAA WMS; "
     "NOAA NIDIS tiles (direct)", "9 km daily since 2015; 1 km hourly; 3 km; 0.125° weekly", "—"),
    ("Soil maps tab: soil moisture at the point", "ERA5-Land, ECMWF IFS (Open-Meteo, CC BY 4.0); SMAP L4 (Crop-CASMA); "
     "NWM (AWS)", "Open-Meteo APIs (re-hosted copy), one retry; Crop-CASMA WPS GET and NWM NetCDF by byte ranges, on "
     "request (direct)", "0.1°; 9 km; 1 km", "the card names a source that did not answer"),
    ("Soil maps tab: soil moisture stations", "USDA NRCS SCAN, SNOTEL; NOAA USCRN", "list pre-built "
     "(tools/build_moisture.py); AWDB REST, NCEI USCRN files (direct)", "the 3 nearest within 400 km, hourly",
     "the station's block says why"),
    ("Atmospheric CO₂ (APSIM files)", "NOAA GML Mauna Loa annual means", "built into the app", "1959–2025, +2.5 ppm a year after, the 1959 value before",
     "—"),
    ("Your soil profile (data sheet)", "your lab results or edits", "typed into the sheet or read from a CSV in the browser",
     "your layers", "blanks estimated with Saxton & Rawls (2006)"),
]

WIND_CALC = [
    ("Period", "the last 5, 10 or 20 complete years, or your dates (30 days or more inside the model's record, 20 or more "
     "in one month); a month needs 480 hours; months weighted so an uneven period does not tilt the year",
     "choice → dates, months", "wind.js · `resolvePeriod`"),
    ("Pick the station", "6 nearest within 150 km whose record covers the period; AWOS ranked as if 100 km farther",
     "station list → candidates", "wind.js · `nearestStations`"),
    ("Clean the airport record", "routine FM-15 reports only; drop quality flags 2, 3, 6, 7; wind ≤ 40 m/s, gust ≤ 55 m/s; "
     "keep the report nearest each whole hour; need ≥ 60 % of hours", "NOAA reports → hourly series, coverage",
     "wind.js · `toHourly`, `ghcnhObs`"),
    ("Calibrate the model", "monthly empirical quantile mapping, 101 quantiles from 0.1 to 99.9 %; beyond the ends, scale "
     "by the end ratio; gusts the same way (MERRA-2: daily max wind)", "model at station + station, same years → mapping "
     "applied at your point", "wind.js · `trainMappers`, `calibrate`"),
    ("Erosive hours", "hours with u ≥ uₜ (default 8 m/s, adjustable), scaled to a full month", "hourly wind → hours/month",
     "wind.js · `analyze`"),
    ("Erosive energy", "Σ u² (u − uₜ) over erosive hours", "hourly wind → energy/month", "`analyze`"),
    ("Dryness", "D = (ET₀ − P) / ET₀, limited to 0–1", "monthly rain, ET₀ → D", "`analyze`"),
    ("Monthly risk and red months", "index = energy × D; share = month ÷ year; red ≥ 10 %, amber ≥ 6.7 %; ranked only "
     "when the period covers all 12 months", "energy, D → 12-month strip", "`analyze`"),
    ("Wind rose and directions", "16 sectors; prevailing = sector with most erosive energy (neighbours weighted ½); "
     "resultant = vector sum of energy toward downwind", "speed, direction → rose, directions", "`analyze`"),
    ("Drift potential", "Fryberger: Σ V² (V − 12 kn) for V > 12 kn; RDP = vector sum; RDP/DP", "hourly wind → DP, RDP",
     "`analyze`"),
    ("FAO climatic index", "C = Σ u₂³ · D · days / 100, with u₂ = 0.748 u₁₀ (FAO-56 log law)", "monthly wind, D → C",
     "`analyze`"),
    ("Gust days", "days with daily max gust ≥ 17.9 m/s (40 mph)", "daily gust → days/month", "`analyze`"),
    ("Trend", "least-squares slope of yearly erosive hours and mean wind, with significance test", "yearly totals → trend",
     "util.js · `linreg`"),
    ("Reference ET when gridMET fails", "FAO-56 Penman–Monteith from NASA POWER Tmax, Tmin, dew point, 2 m wind and solar "
     "radiation (Rn = 0.77 Rs − Rnl, G = 0); Hargreaves 0.0023 Ra (T + 17.8) √(Tmax − Tmin) on days missing an input",
     "NASA POWER daily → ET₀",
     "wind.js · `powerDaily`"),
]

SOIL_CALC = [
    ("Find the map unit", "`SDA_Get_Mukey_from_intersection_with_WktWgs84` at the point", "lat, lon → map unit key",
     "soil.js · `fetchSoil`"),
    ("Dominant component, surface layer", "component with the largest percentage; its top horizon", "components, horizons → "
     "sand, silt, clay, OM, CaCO₃", "soil.js"),
    ("Texture class", "USDA texture triangle, refined by sand size", "sand, silt, clay → class",
     "soil.js · `textureClass`, `refineCode`"),
    ("Wind Erodibility Group and I", "NRCS rules: texture family, clay ≤ 5 %, CaCO₃ ≥ 5 %, OM ≥ 20 %, stones; I from the WEG table",
     "surface layer → WEG 1–8, I (t/ac/yr)", "soil.js · `wegFromSurface`"),
    ("Climatic factor C", "the map unit's SSURGO climate-factor areas (acre-weighted); in a county with no usable C, "
     "the state's county estimate (Chepil C from NASA POWER × 1.64); else 0.9 × FAO index C (≤ 300)",
     "SSURGO, county table or wind engine → C", "app.js · `tableC`, `cFactor`"),
    ("Bare-soil erosion potential", "E = I × C / 100", "I, C → E (t/ac/yr)", "app.js · `riskModel`"),
    ("Erodibility index", "EI = E / T", "E, T → EI", "`riskModel`"),
    ("Risk class", "Low < 10, Moderate 10–40, High 40–80, Very high 80–150, Extreme ≥ 150 t/ac/yr; the exact E is "
     "classed in every display unit", "E → class", "`riskModel`; units.js · `cls`"),
    ("Water retention", "Saxton & Rawls (2006) pedotransfer equations", "sand, clay, OM → LL, DUL, SAT, AWC, Ksat",
     "soil.js · `saxtonRawls`"),
    ("RWEQ erodible fraction", "EF = (29.09 + 0.31 Sa + 0.17 Si + 0.33 Sa/Cl − 2.59 OM − 0.95 CaCO₃) / 100",
     "surface layer → EF (cross-check)", "soil.js · `rweq`"),
    ("RWEQ crust factor", "SCF = 1 / (1 + 0.0066 Cl² + 0.021 OM²)", "clay, OM → SCF (cross-check)", "soil.js · `rweq`"),
    ("Slope and aspect", "finite differences on the centre and four neighbours ~100 m away", "5 elevations → slope %, aspect",
     "app.js · `fetchElevation`"),
    ("Profile parameters", "SLU1, SLDR, runoff curve number, root growth factor, albedo per crop-model .SOL format",
     "all horizons → DSSAT .SOL file", "writers.js · `dssatSol`"),
]

MODEL_CALC = [
    ("Read the weather", "gridMET 9 variables, PRISM through ACIS with gridMET's other variables (each calendar day holds PRISM's next date), NASA POWER daily, or your file (columns found by name, units converted, wind "
     "moved to 10 and 2 m by the log law); dates cut to the source's record", "dates → daily series",
     "wind.js · `dailyWeather`; models.js · `parseWeatherCSV`"),
    ("Fill your file's gaps (optional)", "missing days taken from gridMET for the same days, not its ET₀; then ET₀ by "
     "FAO-56 from your columns", "your series + gridMET → filled series", "models.js · `fillGaps`; datasheet.js"),
    ("Clean", "values no station reports (rain or wind < 0, solar > 50 MJ/m², T outside −60…60 °C, Tmax = Tmin = 0) "
     "become missing", "series → cleaned series", "writers.js · `clean`"),
    ("Gap-free copy (DSSAT, APSIM, AquaCrop)", "first to last day with Tmax and Tmin; linear Tmax, Tmin, wind; Hargreaves "
     "solar; rain 0; ET₀ FAO-56", "cleaned series → complete series", "writers.js · `complete`"),
    ("Climate statistics", "TAV, AMP from 12 monthly means; generator statistics per month; 10 complete years read when "
     "the dates lack a month or a variable", "series → .WTH header, .met, .WP1, weather-wgn.cli",
     "writers.js · `tavAmp`, `wp1Stats`, `swatWgn`"),
    ("Soil layers", "each model's usual layers, the horizons as they are, or your depths (thickness-weighted means, "
     "OM, OC, CaCO3 and N by mass, harmonic Ksat); stops at bedrock", "profile → model layers", "models.js · `relayer`; writers.js"),
    ("Write and pack", "each model's fixed-width or JSON layout, a README per folder, NOT_WRITTEN.txt where a model "
     "cannot be made; one zip", "series, soil → zip", "writers.js; datasheet.js · `build`"),
]

AREA_CALC = [
    ("Read the boundary", "drawn corners, or a file: shpjs (reprojects with the .prj), togeojson (KML), JSZip (KMZ), GeoJSON; "
     "all polygons kept, no size limit (tiles over 500 km²)", "file → polygons, acres", "area.js · `parseFiles`, `polysArea`"),
    ("Clip the soils", "`mupolygongeo.STIntersection(boundary)` on Soil Data Access (boundary simplified to ≤ 600 vertices); "
     "over 500 km² tile by tile (about 20 km, 3 at a time, retried, then split; outlines thinned with `Reduce` over 1,500 km²); "
     "components with WEG, I, %; climate-factor areas and counties per map unit", "boundary → soil polygons", "area.js · `soils`"),
    ("Left-out features", "USA Structures footprints; TIGER roads as bands (S1100 15 m, S1200 9 m, S1400 5 m … half-widths); "
     "NHD lakes, reservoirs, marshes, estuaries; SSURGO Water units; over 500 km² per tile up to a feature budget, "
     "with any part not read named in the panel", "boundary box → features", "area.js · `exclusions`"),
    ("Sample", "≈ 20,000 stratified random points (up to 70,000 on large areas; one per grid cell, seeded) inside the boundary; drop left-out, "
     "outside-the-chosen-states and no-soil points", "points → kept points", "area.js · `samples`, `hitAt`"),
    ("Shares", "share = Σ points Σ components (pct/100)·[class] ÷ Σ points Σ components (pct/100); E = I × C / 100; "
     "± 0.7 points at 95 %", "kept points → % and acres", "area.js · `analyse`"),
    ("Map-click check", "same layers in a ~180 m box; inside a building or water, or within a road half-width → refused; "
     "accepted if the services take > 3.5 s", "click → accept or refuse", "area.js · `excludedAt`; app.js · `pickSite`"),
]

SOILMAP_CALC = [
    ("Map layer", "USFS exportImage for the view at the chosen depth, the classes drawn by the server; the state PNGs "
     "near the view; the USGS and SoilGrids WMS", "choice → image and legend", "soilmaps.js · `layers`, `legendOf`"),
    ("Survey at the point", "the map unit's major components and horizons from Soil Data Access", "lat, lon → horizons",
     "soilmaps.js · `surveyAt`"),
    ("Depth-weighting", "thickness-weighted mean over 0–15 and 0–30 cm of the horizons with a value; map unit by "
     "component share", "horizons → pH, EC, SAR, ESP, CEC, base saturation, OM, CaCO₃, gypsum", "soilmaps.js · `over`"),
    ("Classes", "reaction and salinity by the Soil Survey Manual; sodic at SAR ≥ 13 or ESP ≥ 15, saline at EC ≥ 4 "
     "(Handbook 60)", "values → classes", "soilmaps.js · `reaction`, `salinity`, `sodicity`"),
    ("Nearest sites and pedons", "USGS DS-801: 3 nearest by WFS, then site JSON; KSSL: 8 nearest surface layers from the "
     "lab tables; boxes widened once", "lat, lon → sites, pedons with distance", "soilmaps.js · `usgsNearAt`, `ksslAt`"),
    ("USGS legend (offline)", "the national deciles of the DS-801 site values, censored values at their detection limit",
     "DS-801 CSV → data/soilchem_legend.json", "tools/build_soilmaps.py"),
]

BASIN_CALC = [
    ("HU12 and its network", "WBD point query; NHDPlus HR flowlines and sinks by the HU12 polygon; catchments by id; "
     "inside = centroid of the largest ring", "lat, lon → HU12, catchments", "basins.js · `hu12At`, `hrIn`"),
    ("EROM runoff, upstream", "893.6 × qincrama / area; HU12 = 893.6 Σq / ΣA; upstream by hydroseq inside the HU12",
     "catchments → mm/yr, upstream set", "basins.js · `network`"),
    ("Soils and land cover in the HU12", "SDA intersects the HU12 with map units on its server; NLCD 2021 counted in 30 m "
     "cells from the MRLC WCS", "HU12 → components, class areas", "basins.js · `soilsIn`; landcover.js · `boundaryShares`"),
    ("Curve number runoff", "TR-55 Table 2-2 CN per class and group; Q = (P − 0.2S)²/(P + 0.8S) per pair, averaged; "
     "P from Atlas 14 (not OR, WA) or typed", "groups, classes, P → CN, Q, volume", "basins.js · `cnModel`, `a14At`, `scsQ`"),
    ("RUSLE", "R from rfactor.json by NLDI COMID; K, LS (McCool S, L by slope class), T per component; C by class; "
     "A = R K LS C P", "→ t/ac/yr, t/ha/yr, × T, tons/yr", "basins.js · `rAt`, `ls`, `drawRusle`"),
    ("R and Atlas 14 lookups (offline)", "RF7100 split by state with StreamCat COMIDs, delta and base-32 coded; Atlas 14 "
     "regional 30″ grids to 0.05° means per state", "national and regional files → rfactor.json, atlas14.json", "tools/build_basins.py"),
]

MOISTURE_CALC = [
    ("Map layers", "GIBS WMTS by day (DescribeDomains lists the days); NWM WMS asked again each half hour while on; "
     "NIDIS tiles; station dots from the list", "choice, day → tiles and legend", "soilmoisture.js · `LAYERS`, `drawLegend`"),
    ("Models by depth", "ERA5-Land daily means (42 days asked); IFS hourly → local-day means; four layers to 255 cm; "
     "one retry", "lat, lon → 30-day series", "soilmoisture.js · `era5At`, `ifsAt`"),
    ("SMAP at the cell", "Crop-CASMA GetProfileByDate at the EPSG:5070 cell, TOP and SUB", "lat, lon → daily m³/m³",
     "soilmoisture.js · `smapAt`"),
    ("NWM on request", "latest analysis_assim land file on AWS; LCC cell; SOIL_M (4 layers), SOILSAT_TOP read by byte "
     "ranges", "lat, lon → 4 layers + saturation", "soilmoisture.js · `nwmAt`; h5range.js"),
    ("Nearest stations", "3 nearest within 400 km; AWDB daily SMV/SMS and hourly SMS (% ÷ 100); USCRN daily file and "
     "hourly tail", "lat, lon → latest and 30 daily means per depth", "soilmoisture.js · `nearest`, `readStations`"),
    ("Station list (offline)", "AWDB stations reporting hourly SMS with live sensor depths; USCRN stations with recent "
     "soil moisture", "→ data/soilmoisture_stations.json", "tools/build_moisture.py"),
]

RESULTS = [
    ("Risk class and E (Overview)", "E = I × C / 100", "SSURGO: WEG → I; climatic factor C (SSURGO or the state's county table)"),
    ("Erodibility index EI", "E / T", "SSURGO soil-loss tolerance T"),
    ("Erosive hours, mean wind", "count of hours ≥ threshold; mean", "NASA MERRA-2 (ECMWF via Open-Meteo as backup), calibrated to the NOAA airport"),
    ("Red and amber months", "energy × dryness, share of the year", "calibrated wind + gridMET rain and ET₀"),
    ("Prevailing erosive direction", "sector with most erosive energy", "calibrated wind direction"),
    ("Wind Erodibility Group, C, land cover", "read as published (WEG recomputed if you edit)", "SSURGO; NLCD or Sentinel-2"),
    ("Soil profile, water properties", "Saxton & Rawls for edited layers", "SSURGO horizons"),
    ("Slope", "finite differences", "USGS 3DEP"),
    ("Moisture chart", "monthly sums", "gridMET (or its fallbacks)"),
    ("Airport vs model card", "same-hour comparison", "NOAA GHCNh and the model at the station's cell"),
    ("Practice plan", "Texas rules in practices.js; every other state's profile (data/practices/XX.json)",
     "land use and answers, MLRA region, WEG, risk, windy months"),
    ("Area panel: WEG and risk-class shares, mean I and E", "sampled shares, components weighted by %",
     "SSURGO polygons and components; USA Structures, TIGER and NHD left out"),
    ("Statewide map colours", "pre-computed offline", "SSURGO WEG/I (UC Davis SoilWeb rasters), NRCS C, NASA POWER monthly wind"),
    ("Model files (data sheet zip)", "each model's layout, gaps filled where the model needs it",
     "gridMET, PRISM, NASA POWER or your file; the survey soil or yours"),
    ("Soil maps layers", "drawn by the source; classes from the survey manual or the USGS deciles",
     "USFS gNATSGO, SoilWeb, USGS DS-801, SoilGrids"),
    ("Soil maps tab", "depth-weighted means and classes; nearest sites and pedons",
     "SSURGO, USFS getSamples, SoilGrids, USGS DS-801, NRCS KSSL"),
    ("Basin: HU12 and catchment runoff", "893.6 × qincrama ÷ area (EROM step A, a model); upstream by hydroseq",
     "NHDPlus HR, WBD, USGS NLDI"),
    ("Design-storm runoff, soil loss", "TR-55 curve number; RUSLE A = R K LS C P",
     "NOAA Atlas 14 (not OR, WA) or your depth; NLCD 2021; SSURGO; USGS RF7100"),
    ("Soil moisture by depth", "daily means in m³/m³; the 3 nearest stations",
     "ERA5-Land, ECMWF IFS (Open-Meteo); SMAP L4 (Crop-CASMA); National Water Model; SCAN, SNOTEL, USCRN"),
    ("Figure and table downloads", "charts redrawn at the chosen size and DPI; CSV with units", "the results above, in the "
     "units chosen"),
]

CODE = [
    ("index.html, css/app.css", "page layout, tabs, sheets and the phone layout"),
    ("js/util.js", "downloads with time limits (`fetchJSON`, `fetchText`), concurrency pool, statistics helpers"),
    ("js/units.js", "the units table: quantities, conversions, metric and US presets, risk classes in every unit"),
    ("js/export.js", "PNG, JPEG and TIFF files with their DPI, CSV, saving files"),
    ("js/soil.js", "SSURGO queries, texture, WEG and I, Saxton & Rawls, RWEQ, CSV export"),
    ("js/wind.js", "wind and moisture downloads with fallbacks, periods, station choice and QC, calibration, monthly "
     "analysis, daily weather for model files"),
    ("js/app.js", "map, state picker and per-state files, location check, loading sequence, risk model, elevation and "
     "land cover, rendering of every tab"),
    ("js/charts.js", "Chart.js charts, drawn on screen or off screen for downloads"),
    ("js/downloads.js", "the units sheet, figure sheet (size, DPI, format) and CSV tables"),
    ("js/models.js", "weather and soil structures for model files, your weather and soil files, soil re-layering, zip"),
    ("js/writers.js", "DSSAT, SWAT+, EPIC, APEX, APSIM, AquaCrop and plain CSV writers"),
    ("js/century.js", "CENTURY 4.0 and 4.5: monthly weather and the site file for each version"),
    ("js/datasheet.js", "the data sheet: weather source, dates, soil, layers, models; builds the zip"),
    ("js/preview.js", "the data sheet's preview: charts and tables of what a download will hold, before it is saved"),
    ("js/templates.js", "the layout of your own weather and soil files: tick the columns, choose units, download a template"),
    ("js/grid.js, js/gridfiles.js", "the area grid: cells from 20 cm up with soil and weather in each; projections, GeoTIFF and shapefile writers"),
    ("js/weather.js", "the map themes and the Drought theme: live layers, the Drought tab, the Drought Monitor at a point and by week"),
    ("js/timemap.js", "the Drought Monitor on a past week: the week bar on the map, play"),
    ("js/soilmaps.js", "the Soil maps theme, its Overview and Soil maps tabs: layers, legends, SSURGO chemistry by depth, nearby sites and pedons"),
    ("js/basins.js", "basins in the Soil maps theme and tab: WBD and NHDPlus HR layers, the HU12 and its catchments, EROM "
     "runoff, curve-number storm runoff, RUSLE soil loss, CSV"),
    ("js/soilmoisture.js", "soil moisture in the Soil maps theme and tab: SMAP, NWM, SPoRT and GRACE layers, stations, "
     "models by depth, SMAP at the cell, NWM on request, nearest stations, charts, CSV"),
    ("js/config.js", "the app's name and the states a visitor can choose (Texas for now)"),
    ("js/daycent.js", "DayCent weather and site files"),
    ("js/stats.js", "visitor counting (Umami Cloud), off until a website ID is added"),
    ("js/practices.js", "practice planner: Texas rules, the engine for other states' profiles, questions, specifications, "
     "species tables"),
    ("js/area.js", "field or area analysis: drawing, boundary files, clipped soils, left-out features, sampling, panel, CSV; "
     "map-click check"),
    ("js/methods.js", "Methods sheet: sources used at the point, source catalog, equations"),
    ("data/states.js, data/states/XX.json, data/states/XX/*.png", "the state list; each state's outline, airports, "
     "statewide layers and county C (made by tools/build_states.py and tools/build_layers.py)"),
    ("data/practices/XX.json", "each state's practice profile (made by tools/fetch_efotg.py and tools/build_practices.py)"),
    ("data/states/XX/rfactor.json, data/states/XX/atlas14.json", "the R factor per NHDPlus V2 catchment and the "
     "Atlas 14 depths of 46 states and DC (made by tools/build_basins.py)"),
    ("data/soilmoisture_stations.json", "the soil moisture stations and their sensor depths (made by tools/build_moisture.py)"),
    ("tools/*.py", "offline builders, run by hand, never by the app; tools/build_flow_doc.py makes this document"),
]

STEPS = [
    ("Location check.", " The state button chooses among the open states (Texas for now; js/config.js lists them); only their files load "
     "(outline, airports, statewide layers, county C), and everything outside them is covered. The point is tested against "
     "the chosen states' outlines (U.S. Census 1:5,000,000, simplified together so neighbours share their borders). A place "
     "found by search, GPS or coordinates in another state adds that state; a map click outside them is refused. "
     "A map click or pin drag is also checked against building footprints (USA Structures), roads (Census TIGER) and water "
     "bodies (USGS NHD). If it fails, the app says why and downloads nothing."),
    ("Soil.", " Soil Data Access finds the SSURGO map unit under the point, then runs 8 queries at once. The soil engine "
     "derives texture, WEG, I and water properties, and the risk card can show E as soon as the soil arrives."),
    ("Elevation and land cover, at the same time.", " Five USGS 3DEP elevations give slope and aspect (15 s limit, then "
     "Copernicus via Open-Meteo). Land cover comes from NLCD (8 s limit) or the Sentinel-2 10 m map."),
    ("Gridded wind and moisture, at the same time.", " Hourly wind for the chosen period comes straight from NASA "
     "(MERRA-2 through NASA POWER, usually 1–3 s). If NASA errors or has not answered within 20 s, the app switches to "
     "ECMWF through Open-Meteo. Daily rain and ET₀ come from gridMET, else NASA POWER, else Open-Meteo. The Wind tab "
     "first shows the model, uncalibrated."),
    ("Airport calibration, in the background.", " The app takes up to 6 nearby airports from the state's file (the airports within about 150 km of the state), downloads "
     "hourly records from NOAA one year per request, keeps the first station with at least 60 % of hours, downloads the "
     "same model at that station's cell, trains the monthly quantile mapping and redraws every result as calibrated."),
    ("Practices.", " When you choose a land use (the default comes from land cover) and answer 2–5 questions, the "
     "planner builds the plan from the risk, soil group, region and windy months: in Texas from its own rules, in every "
     "other state from the state's practice profile, loaded the first time its tab opens."),
    ("Changes.", " Editing the soil layer, the threshold or the units recalculates in the browser with no new downloads. "
     "Changing the period, the model or the calibration station downloads again."),
    ("Downloads.", " Every chart can be saved as PNG, TIFF or JPEG at a chosen size and DPI, or as CSV. The data sheet "
     "has tabs for weather files, soil files or both: it reads daily weather for the chosen dates (gridMET, PRISM, NASA POWER or "
     "your file), takes the survey soil or yours, and writes files for DSSAT, SWAT+, EPIC, APEX, APSIM, AquaCrop and CENTURY into "
     "one zip (section 8, Figure 5). Its Preview button draws all of that as charts and tables first, with nothing saved."),
]

LIMITS = [
    ("Texas now.", " Visitors can choose Texas only for now; the code and data hold the 48 contiguous states and DC, "
     "opened by js/config.js. Alaska, Hawaii and Puerto Rico come later (several sources cover the 48 contiguous states "
     "only). The outline is the Census 1:5,000,000 boundary, kept within about 0.2 km of that source; a point a few hundred "
     "metres from a state line can land on the wrong side. The statewide C is an estimate where SSURGO gives a county none, "
     "and the practice profiles outside Texas and Kansas are lighter than Texas's."),
    ("Open-Meteo is a backup.", " Every default source is direct, except the soil moisture models by depth (ERA5-Land, "
     "ECMWF IFS), which only Open-Meteo's copy serves without a personal key. Otherwise Open-Meteo steps in for wind when NASA POWER "
     "errors or has not answered within 20 s, for daily weather when gridMET and NASA POWER both fail, for elevation when "
     "USGS fails, and when you choose ECMWF (Copernicus's own store needs each user's key and a queued job). After "
     "calibration both models give 1,291–1,295 erosive h/yr at Lubbock."),
    ("NLCD is blocked.", " MRLC's server refuses requests from web pages, so land cover currently always comes from the "
     "Sentinel-2 10 m map."),
    ("MERRA-2 has no gusts.", " Its daily maximum hourly wind stands in for gusts during calibration; without an airport, "
     "gust days show n/a."),
    ("gridMET lags a few days.", " The newest ~4 days are not yet published; a point with less than 80 % of days falls "
     "back to NASA POWER and then Open-Meteo."),
    ("Station rules.", " A station needs at least 60 % of hours in the period (20 % if you pick it yourself). AWOS sites are "
     "ranked as if 100 km farther, because several West Texas AWOS anemometers read 40–60 % fewer erosive hours than "
     "nearby ASOS sites."),
    ("RWEQ values are cross-checks.", " EF and SCF are not used in the risk; they get an asterisk when the soil is "
     "outside the range the equations were fitted on."),
    ("Area results are estimates.", " Shares come from about 20,000 sample points (± 0.7 percentage points at 95 %) and "
     "from SSURGO components, which are not mapped separately inside a map unit. Buildings, roads and water are only as "
     "complete as USA Structures, TIGER and NHD; if one of them does not answer, the panel says it was not removed."),
    ("Statewide layers are fixed.", " The map colours are pre-computed and do not change with the point you pick."),
    ("Soil maps are not a soil test.", " Survey values describe the mapped soil; USGS and SoilGrids values are total, "
     "not plant-available; KSSL pedons are sparse and often decades old. No map covers the US for soil-test (plant-available) "
     "N, P, K, Ca, Mg or S, or DTPA micronutrients; boron and phosphorus survey data is also limited for the US."),
    ("Basins are models.", " Mean annual runoff is NHDPlus HR's EROM model (1971–2000 climate), not a gauge; other "
     "models can differ by a factor of two. The curve number is an event method on average wetness. RUSLE gives gross "
     "sheet-and-rill erosion, with LS from survey slopes and C from land-cover classes, not gullies or the sediment that "
     "leaves the HU12. NOAA Atlas 14 depths are built for every state but Oregon and Washington, which no volume covers "
     "yet; there the depth is typed."),
    ("Soil moisture sources differ.", " Models, SMAP L4 and stations often differ by 0.1 m³/m³ or more, as a model's "
     "soil is not the field's; compare changes more than levels. A station reads its own soil, often tens of km away."),
    ("No SoilGuard server.", " GitHub Pages only delivers the files. Your browser sends the point's coordinates (and any "
     "place name you search for) straight to each service listed above; nothing is stored."),
]


def build_docx(figs, commit):
    from docx import Document
    from docx.enum.section import WD_ORIENT, WD_SECTION
    from docx.enum.table import WD_TABLE_ALIGNMENT
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    from docx.shared import Inches, Pt, RGBColor

    ink, accent, muted = RGBColor(0x1F, 0x29, 0x33), RGBColor(0x2F, 0x7D, 0x4F), RGBColor(0x61, 0x6E, 0x7C)
    doc = Document()

    st = doc.styles
    st["Normal"].font.name, st["Normal"].font.size = "Calibri", Pt(10.5)
    st["Normal"].paragraph_format.space_after = Pt(5)
    st["Normal"].paragraph_format.line_spacing = 1.1
    for name, size, color, before in [("Title", 24, ink, 0), ("Heading 1", 15, accent, 16), ("Heading 2", 12, ink, 10)]:
        f = st[name].font
        f.name, f.size, f.color.rgb, f.bold = "Calibri", Pt(size), color, True
        rf = st[name].element.get_or_add_rPr().get_or_add_rFonts()  # drop theme fonts so Calibri applies
        for a in ("w:asciiTheme", "w:hAnsiTheme", "w:eastAsiaTheme", "w:cstheme"):
            rf.attrib.pop(qn(a), None)
        rf.set(qn("w:ascii"), "Calibri")
        rf.set(qn("w:hAnsi"), "Calibri")
        st[name].paragraph_format.space_before = Pt(before)
        st[name].paragraph_format.space_after = Pt(4)
    st["Caption"].font.size, st["Caption"].font.color.rgb, st["Caption"].font.italic = Pt(9), muted, True

    def page(section, landscape=False, margin=0.75):
        w, h = Inches(8.5), Inches(11)
        section.orientation = WD_ORIENT.LANDSCAPE if landscape else WD_ORIENT.PORTRAIT
        section.page_width, section.page_height = (h, w) if landscape else (w, h)
        for side in ("left_margin", "right_margin"):
            setattr(section, side, Inches(margin))
        section.top_margin = section.bottom_margin = Inches(0.45 if landscape else 0.75)
        section.footer_distance = Inches(0.25)

    def runs(p, text, size=None):
        """Plain text with `code` spans in Consolas."""
        for i, part in enumerate(text.split("`")):
            if not part:
                continue
            r = p.add_run(part)
            if i % 2:
                r.font.name = "Consolas"
                r.font.size = Pt((size or 10.5) - 1)
            elif size:
                r.font.size = Pt(size)
        return p

    def para(text, style=None, size=None, color=None, align=None, after=None):
        p = doc.add_paragraph(style=style)
        runs(p, text, size)
        if color is not None:
            for r in p.runs:
                r.font.color.rgb = color
        if align is not None:
            p.alignment = align
        if after is not None:
            p.paragraph_format.space_after = Pt(after)
        return p

    def lead_list(items, style):
        for lead, rest in items:
            p = doc.add_paragraph(style=style)
            p.add_run(lead).bold = True
            runs(p, rest)
            p.paragraph_format.space_after = Pt(3)

    def figure(path, width, caption):
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_after = Pt(2)
        p.add_run().add_picture(str(path), width=Inches(width))
        para(caption, style="Caption", align=WD_ALIGN_PARAGRAPH.CENTER, after=8)

    def shade(cell, fill):
        pr = cell._tc.get_or_add_tcPr()
        shd = OxmlElement("w:shd")
        for k, v in (("w:val", "clear"), ("w:color", "auto"), ("w:fill", fill)):
            shd.set(qn(k), v)
        pr.append(shd)

    def table(headers, rows, widths, size=9):
        t = doc.add_table(rows=1, cols=len(headers))
        t.alignment = WD_TABLE_ALIGNMENT.CENTER
        t.autofit = False
        tblPr = t._tbl.tblPr
        borders = OxmlElement("w:tblBorders")
        for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
            e = OxmlElement(f"w:{edge}")
            for k, v in (("w:val", "single"), ("w:sz", "4"), ("w:space", "0"), ("w:color", "C9D1D9")):
                e.set(qn(k), v)
            borders.append(e)
        tblPr.insert_element_before(borders, "w:shd", "w:tblLayout", "w:tblCellMar", "w:tblLook", "w:tblCaption",
                                    "w:tblDescription")  # schema order matters to Word
        grid = t._tbl.tblGrid
        for gc, w in zip(grid.findall(qn("w:gridCol")), widths):
            gc.set(qn("w:w"), str(int(w * 1440)))
        hdr = t.rows[0]
        trPr = hdr._tr.get_or_add_trPr()
        rep = OxmlElement("w:tblHeader")
        rep.set(qn("w:val"), "true")
        trPr.append(rep)
        for c, h, w in zip(hdr.cells, headers, widths):
            c.width = Inches(w)
            shade(c, "323F4B")
            p = c.paragraphs[0]
            r = p.add_run(h)
            r.bold, r.font.size, r.font.color.rgb = True, Pt(size), RGBColor(0xFF, 0xFF, 0xFF)
        for k, row in enumerate(rows):
            tr = t.add_row()
            tr._tr.get_or_add_trPr().append(OxmlElement("w:cantSplit"))  # keep each row on one page
            cells = tr.cells
            for j, (c, v, w) in enumerate(zip(cells, row, widths)):
                c.width = Inches(w)
                if k % 2:
                    shade(c, "F5F7FA")
                p = c.paragraphs[0]
                p.paragraph_format.space_after = Pt(0)
                p.paragraph_format.line_spacing = 1.0
                runs(p, v, size)
                if j == 0:
                    for r in p.runs:
                        r.bold = True
        spacer = doc.add_paragraph()
        spacer.paragraph_format.space_after = Pt(2)
        return spacer

    # ---- page 1 ----
    sec = doc.sections[0]
    page(sec)
    footer = sec.footer.paragraphs[0]
    footer.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = footer.add_run("SoilGuard · data flow · page ")
    r.font.size, r.font.color.rgb = Pt(8.5), muted
    # PAGE as a complex field (begin / instruction / separate / result / end); Word stalls exporting a fldSimple here
    for kind, text in (("begin", None), (None, " PAGE "), ("separate", None), (None, "1"), ("end", None)):
        r = footer.add_run()
        r.font.size, r.font.color.rgb = Pt(8.5), muted
        if kind:
            fc = OxmlElement("w:fldChar")
            fc.set(qn("w:fldCharType"), kind)
            r._r.append(fc)
        elif text.strip() == "PAGE":
            it = OxmlElement("w:instrText")
            it.set(qn("xml:space"), "preserve")
            it.text = text
            r._r.append(it)
        else:
            r.text = text

    doc.add_heading("SoilGuard: data flow", level=0)
    para("Where each dataset comes from, where it is calculated, and how the results reach the screen",
         size=13, color=muted, after=2)
    code = f" (commit {commit})" if commit != "unknown" else ""
    para(f"App: barsa1ly.github.io/soilguard   ·   Code: github.com/barsa1ly/soilguard{code}   ·   "
         f"November 11, 2026", size=9, color=muted, after=10)

    doc.add_heading("1. In one paragraph", level=1)
    para("SoilGuard is a static web page. When you pick a point in one of the chosen states, your browser asks each agency's web "
         "service for the data at that point, all at the same time. Every calculation then runs in your browser, in the "
         "JavaScript files under js/. There is no SoilGuard server: GitHub Pages only delivers the files. The soil "
         "survey gives the erodibility (I) and the climatic factor (C), which combine into the bare-soil erosion "
         "potential E = I × C / 100. Hourly wind, calibrated to the nearest airport and weighted by how dry each month "
         "is, decides which months are risky. The practice planner turns both into a plan. The Drought and Soil maps "
         "themes (sections 9–12) show drought now and since 2000, the soil's chemistry by depth, runoff and soil loss in "
         "the small watershed around the point, and soil moisture by depth.")

    doc.add_heading("2. How to read the diagrams", level=1)
    lead_list([
        ("Columns, left to right:", " where the data comes from, what the browser calculates, what is combined, and "
         "what you see."),
        ("Colours:", " brown = soil and land data, blue = weather and wind data, purple = built into the app, "
         "green = calculated in your browser, orange = combined, dark grey = results on screen, red = refused."),
        ("Borders:", " a solid border means the app reads the data directly from the agency that produces it; a "
         "dashed border means a re-hosted copy (Open-Meteo, Iowa Environmental Mesonet)."),
        ("Arrows:", " solid arrows carry data; dashed arrows are fallbacks, taken only when the source above fails, "
         "with the condition written beside them."),
    ], "List Bullet")

    doc.add_heading("3. What happens when you pick a point", level=1)
    lead_list(STEPS, "List Number")

    # ---- figure 1, landscape ----
    sec = doc.add_section(WD_SECTION.NEW_PAGE)
    page(sec, landscape=True, margin=0.5)
    doc.add_heading("4. The whole picture", level=1).paragraph_format.space_before = Pt(0)
    figure(figs[0], 9.25, "Figure 1. Data sources (left), calculations in the browser (middle) and results on screen "
                         "(right) for one point.")

    # ---- detail pages ----
    sec = doc.add_section(WD_SECTION.NEW_PAGE)
    page(sec)
    doc.add_heading("5. Wind and climate: three sources to monthly risk", level=1).paragraph_format.space_before = Pt(0)
    para("Three lanes run at the same time. Each lane is a priority list: the app uses the first source that answers. "
         "Lane B only exists to calibrate lane A; if no airport qualifies, the model is used uncalibrated.")
    figure(figs[1], 5.9, "Figure 2. Wind and moisture pipeline with every fallback.")

    h = doc.add_heading("6. Soil survey to erosion risk", level=1)
    h.paragraph_format.page_break_before, h.paragraph_format.space_before = True, Pt(0)
    para("The main column is the path to the risk class. The right column holds the profile, your edits (sand to CaCO₃ "
         "on Wind erosion › Soil, pH on Soil maps › Soil profile) and the result boxes. Your edits replace the surveyed "
         "surface layer, so every value below them is recalculated.")
    figure(figs[2], 6.2, "Figure 3. Soil and erosion-risk pipeline.")

    h = doc.add_heading("7. Field or area analysis", level=1)
    h.paragraph_format.page_break_before, h.paragraph_format.space_before = True, Pt(0)
    para("The area tool (polygon button on the map) works on a whole field or ranch instead of one point. Four sources "
         "are read at once for the boundary; sample points then give the share of the open land in each Wind "
         "Erodibility Group and risk class.")
    figure(figs[3], 5.9, "Figure 4. Field or area analysis, and the map-click check.")

    h = doc.add_heading("8. Model files, with your own weather and soil", level=1)
    h.paragraph_format.page_break_before, h.paragraph_format.space_before = True, Pt(0)
    para("The data sheet (DOWNLOAD tab) writes files for crop and watershed models. Its weather comes from one source you "
         "choose, or from your own daily file; its soil is the survey's profile or yours. Your files are read in the browser "
         "and never sent anywhere. The area tool's grid uses the same sources and writes the same model files once for each "
         "soil and each weather cell, with an index (models/runs.csv) that joins every cell to its files.")
    figure(figs[4], 5.9, "Figure 5. Model files from the data sheet, with your own files, and the area grid.")

    h = doc.add_heading("9. Drought and Soil maps themes", level=1)
    h.paragraph_format.page_break_before, h.paragraph_format.space_before = True, Pt(0)
    para("The Drought and Soil maps themes put an agency's layer on the map and give the panel their own tabs. The Drought "
         "Monitor's weekly classes at the point come from Esri's Living Atlas copy, with NDMC's own maps for any week it lacks; "
         "the data sheet and the area grid can add them to a download. The Soil maps read the soil survey (as USFS 30 m "
         "images and through Soil Data Access), UC Davis SoilWeb grids built per state, USGS total elements and SoilGrids "
         "total nitrogen; sections 10–12 show them in detail.")
    figure(figs[5], 5.9, "Figure 6. Drought and Soil maps: live layers, tabs and downloads.")

    h = doc.add_heading("10. Soil maps theme and its tabs", level=1)
    h.paragraph_format.page_break_before, h.paragraph_format.space_before = True, Pt(0)
    para("The Soil maps theme shows one soil chemistry layer at a time: pH, CEC and organic matter from the USDA Forest "
         "Service's 30 m maps of the soil survey, salinity and sodicity pre-built from UC Davis SoilWeb, total elements "
         "from the USGS, and total N from ISRIC SoilGrids; its layers are buttons in three groups (soil chemistry, basins, "
         "soil moisture). It comes right after Wind erosion and has three tabs. Overview gives a headline coloured by the "
         "survey's pH group and tiles for the soil, its watershed and its moisture; it asks for nothing itself, but draws "
         "the Soil maps tab once, out of sight, and reads from it, and each tile's Details link opens that tab at its card. "
         "The Soil maps tab gives the survey's values by depth with their classes, the 30 m values, SoilGrids N, and the "
         "nearest USGS sites and NRCS lab pedons, with a CSV of each table or all of them. Soil profile shows the dominant "
         "soil's horizons and site parameters from the survey read for the wind erosion (Figure 3). USGS and SoilGrids "
         "values are total, not plant-available; no map covers the US for soil-test nutrients; boron and phosphorus "
         "survey data is limited.")
    figure(figs[6], 5.9, "Figure 7. Soil maps: the map layers and the tab at the point.")

    h = doc.add_heading("11. Basins: runoff and soil loss", level=1)
    h.paragraph_format.page_break_before, h.paragraph_format.space_before = True, Pt(0)
    para("The Soil maps theme and tab also work on the small watershed (HU12) that holds the point. USGS map servers give "
         "its outline and its NHDPlus High Resolution catchments; their mean annual runoff comes from NHDPlus HR's EROM "
         "model. A design storm's runoff is worked out by the curve number (TR-55) from the HU12's land cover and soil "
         "groups, with NOAA Atlas 14 depths built in for every state but Oregon and Washington, and the long-term soil "
         "loss by RUSLE, with R built in from USGS RF7100 for every NHDPlus V2 catchment. All three are models, and the "
         "tab says so.")
    figure(figs[7], 5.9, "Figure 8. Basins: the HU12 and its catchments, runoff by EROM and by the curve number, and "
                         "RUSLE soil loss.")

    h = doc.add_heading("12. Soil moisture by depth", level=1)
    h.paragraph_format.page_break_before, h.paragraph_format.space_before = True, Pt(0)
    para("Soil moisture comes from three kinds of source, each labelled: models (ERA5-Land and ECMWF IFS through "
         "Open-Meteo, the National Water Model), a satellite analysis (NASA SMAP L4, merged into a model) and stations "
         "(USDA SCAN and SNOTEL, NOAA USCRN). The map shows SMAP on any day since 2015, the National Water Model's "
         "saturation this hour, drought.gov's percentiles and the stations; the tab gives each source by depth at the "
         "point, with 30 days of daily means. Values are in m³/m³; compare their changes more than their levels.")
    figure(figs[8], 5.9, "Figure 9. Soil moisture: the map layers and the tab at the point.")

    h = doc.add_heading("13. Calculations, step by step", level=1)
    h.paragraph_format.page_break_before, h.paragraph_format.space_before = True, Pt(0)
    para("“Where” names the file and function in the app's code, so each step can be checked against the source. "
         "The same equations, with their terms and references, are in the app's Methods sheet and in docs/METHODS.md.")
    doc.add_heading("Wind and climate (Figure 2)", level=2)
    table(["Step", "Rule or equation", "Inputs → output", "Where"], WIND_CALC, [1.35, 3.0, 1.55, 1.1])
    doc.add_heading("Soil and erosion risk (Figure 3)", level=2)
    table(["Step", "Rule or equation", "Inputs → output", "Where"], SOIL_CALC, [1.35, 3.0, 1.55, 1.1])
    doc.add_heading("Field or area analysis (Figure 4)", level=2)
    table(["Step", "Rule or equation", "Inputs → output", "Where"], AREA_CALC, [1.35, 3.0, 1.55, 1.1])
    doc.add_heading("Model files (data sheet)", level=2)
    table(["Step", "Rule or equation", "Inputs → output", "Where"], MODEL_CALC, [1.35, 3.0, 1.55, 1.1])
    doc.add_heading("Soil maps (Figure 7)", level=2)
    table(["Step", "Rule or equation", "Inputs → output", "Where"], SOILMAP_CALC, [1.35, 3.0, 1.55, 1.1])
    doc.add_heading("Basins (Figure 8)", level=2)
    table(["Step", "Rule or equation", "Inputs → output", "Where"], BASIN_CALC, [1.35, 3.0, 1.55, 1.1])
    doc.add_heading("Soil moisture (Figure 9)", level=2)
    table(["Step", "Rule or equation", "Inputs → output", "Where"], MOISTURE_CALC, [1.35, 3.0, 1.55, 1.1])

    doc.add_heading("14. Data sources", level=1)
    table(["Data", "Producer", "How the app reads it", "Resolution", "If it fails"], SOURCES, [1.6, 1.45, 1.45, 1.2, 1.3],
          size=8.5)

    doc.add_heading("15. Where each number on screen comes from", level=1)
    table(["Result on screen", "Calculation", "Data behind it"], RESULTS, [2.0, 2.2, 2.8])

    doc.add_heading("16. Fallbacks, limits and checks", level=1)
    lead_list(LIMITS, "List Bullet")

    doc.add_heading("17. Code map", level=1)
    end = table(["File", "What it does"], CODE, [1.9, 5.1])
    end.paragraph_format.space_after = Pt(0)  # Word needs a paragraph after the last table; keep it 1 pt tall
    mark = OxmlElement("w:rPr")
    sz = OxmlElement("w:sz")
    sz.set(qn("w:val"), "2")
    mark.append(sz)
    end._p.get_or_add_pPr().append(mark)

    zoom = doc.settings.element.find(qn("w:zoom"))  # python-docx's template omits the required percent
    if zoom is not None and zoom.get(qn("w:percent")) is None:
        zoom.set(qn("w:percent"), "100")
    doc.core_properties.title = "SoilGuard: data flow"
    doc.core_properties.subject = "Data sources, calculations and results"
    doc.core_properties.author = "SoilGuard"
    doc.save(DOCX)
    print("wrote", DOCX.relative_to(ROOT))


if __name__ == "__main__":
    import subprocess

    commit = subprocess.run(["git", "-C", str(ROOT), "rev-parse", "--short", "HEAD"], capture_output=True,
                            text=True).stdout.strip() or "unknown"
    build_docx([fig_overview(), fig_wind(), fig_soil(), fig_area(), fig_models(), fig_drought(), fig_soilmaps(),
                fig_basins(), fig_moisture()], commit)
