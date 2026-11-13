/* Land cover (NLCD 2021). With the overlay on, the map legend gives its classes' official colours, and a link to the Land
   cover card of Soil maps › Soil. That card gives each class's share of the area, in % and km2: of your boundary (area
   tool) when one is drawn or uploaded, else of the states on the map; with each class's runoff curve numbers (NRCS TR-55
   Table 2-2, hydrologic soil groups A-D, js/basins.js's table, where the page has it) and its CSV. State shares are
   pre-built (tools/build_landcover.py: MRLC WCS 2.0.1, class counts inside each state's outline, in km2, to
   data/states/landcover.json). A boundary is counted live from the same WCS: its box as an uncompressed GeoTIFF in EPSG:5070
   (Albers equal area, so every cell has the same area), at 30 m, or coarser (nearest neighbour, class codes kept) when that
   would pass about 4 million cells; the boundary is rasterised on that grid by cell centre. Kept per boundary for the visit.
   classAt gives one point's class, from the same WCS. */
WG.landcover = (function () {
  const { esc, fmt, fetchJSON } = WG.util;
  const V = ((document.querySelector('script[src*="data/states.js"]') || {}).src || "").split("v=")[1] || "1";
  const WCS = "https://www.mrlc.gov/geoserver/mrlc_download/NLCD_2021_Land_Cover_L48/wcs";
  const MAX_CELLS = 3.6e6;
  // official NLCD legend colours
  const CLASSES = [[11, "Open water", "#466b9f"], [12, "Perennial ice/snow", "#d1def8"], [21, "Developed, open space", "#dec5c5"], [22, "Developed, low intensity", "#d99282"],
    [23, "Developed, medium intensity", "#eb0000"], [24, "Developed, high intensity", "#ab0000"], [31, "Barren land", "#b3ac9f"], [41, "Deciduous forest", "#68ab5f"],
    [42, "Evergreen forest", "#1c5f2c"], [43, "Mixed forest", "#b5c58f"], [52, "Shrub/scrub", "#ccb879"], [71, "Grassland/herbaceous", "#dfdfc2"],
    [81, "Pasture/hay", "#dcd939"], [82, "Cultivated crops", "#ab6c28"], [90, "Woody wetlands", "#b8d9eb"], [95, "Emergent herbaceous wetlands", "#6c9fb8"]];

  /* ---------- EPSG:5070 (NAD83 / Conus Albers), forward only ---------- */
  const A = 6378137, E2 = 0.00669438002290, E = Math.sqrt(E2), R = Math.PI / 180;
  const mm = p => Math.cos(p) / Math.sqrt(1 - E2 * Math.sin(p) ** 2);
  const qq = p => { const s = Math.sin(p); return (1 - E2) * (s / (1 - E2 * s * s) - Math.log((1 - E * s) / (1 + E * s)) / (2 * E)); };
  const P1 = 29.5 * R, P2 = 45.5 * R, P0 = 23 * R, L0 = -96 * R;
  const N = (mm(P1) ** 2 - mm(P2) ** 2) / (qq(P2) - qq(P1)), C = mm(P1) ** 2 + N * qq(P1), RHO0 = A * Math.sqrt(C - N * qq(P0)) / N;
  function albers(lon, lat) {
    const rho = A * Math.sqrt(C - N * qq(lat * R)) / N, th = N * (lon * R - L0);
    return [rho * Math.sin(th), RHO0 - rho * Math.cos(th)];
  }

  /* ---------- the GeoTIFF the WCS returns: uncompressed uint8, tiled or in strips ---------- */
  function readTiff(buf) {
    const dv = new DataView(buf), le = dv.getUint16(0) === 0x4949;
    if (dv.getUint16(2, le) !== 42) throw new Error("not a TIFF");
    const u16 = o => dv.getUint16(o, le), u32 = o => dv.getUint32(o, le), f64 = o => dv.getFloat64(o, le), tags = {};
    const size = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 12: 8, 16: 8 };
    const o = u32(4);
    for (let n = u16(o), i = 0; i < n; i++) {
      const e = o + 2 + i * 12, t = u16(e), ty = u16(e + 2), cnt = u32(e + 4), at = size[ty] * cnt > 4 ? u32(e + 8) : e + 8, v = [];
      for (let k = 0; k < cnt; k++) v.push(ty === 3 ? u16(at + 2 * k) : ty === 4 ? u32(at + 4 * k) : ty === 12 ? f64(at + 8 * k) : ty === 16 ? u32(at + 8 * k) : dv.getUint8(at + k));
      tags[t] = v;
    }
    const w = tags[256][0], h = tags[257][0];
    if ((tags[259] || [1])[0] !== 1 || tags[258][0] !== 8 || (tags[277] || [1])[0] !== 1) throw new Error("unexpected GeoTIFF layout");
    const out = new Uint8Array(w * h), px = new Uint8Array(buf);
    if (tags[322]) { // tiles
      const tw = tags[322][0], th = tags[323][0], per = Math.ceil(w / tw);
      tags[324].forEach((off, k) => {
        const x0 = (k % per) * tw, y0 = Math.floor(k / per) * th;
        for (let y = 0; y < th && y0 + y < h; y++) out.set(px.subarray(off + y * tw, off + y * tw + Math.min(tw, w - x0)), (y0 + y) * w + x0);
      });
    } else { // strips
      const rps = (tags[278] || [h])[0];
      tags[273].forEach((off, k) => { const n = Math.min(rps, h - k * rps) * w; out.set(px.subarray(off, off + n), k * rps * w); });
    }
    // GeoServer writes a ModelTransformation (34264, north-up: no rotation); other writers a pixel scale and a tie point
    const sc = tags[33550], tp = tags[33922], mt = tags[34264];
    if (mt) return { w, h, data: out, left: mt[3], top: mt[7], dx: mt[0], dy: -mt[5] };
    if (!sc || !tp) throw new Error("no georeferencing");
    return { w, h, data: out, left: tp[3] - tp[0] * sc[0], top: tp[4] + tp[1] * sc[1], dx: sc[0], dy: sc[1] };
  }

  /* km2 per class of the cells of a grid whose centres lie inside the rings (even-odd over all rings, so holes work);
     rings are in the grid's CRS, and a cell's area is dx * dy (equal-area CRS) */
  function count(g, rings) {
    const rows = Array.from({ length: g.h }, () => []);
    for (const r of rings) {
      for (let i = 0, n = r.length; i < n; i++) {
        const [x1, y1] = r[i], [x2, y2] = r[(i + 1) % n];
        if (y1 === y2) continue;
        // row k has its centre at top - (k + .5) dy; an edge crosses the rows whose centres lie between its ends
        const lo = Math.max(0, Math.ceil((g.top - Math.max(y1, y2)) / g.dy - 0.5)), hi = Math.min(g.h - 1, Math.floor((g.top - Math.min(y1, y2)) / g.dy - 0.5));
        for (let k = lo; k <= hi; k++) {
          const y = g.top - (k + 0.5) * g.dy;
          if ((y1 <= y) !== (y2 <= y)) rows[k].push(x1 + (y - y1) * (x2 - x1) / (y2 - y1));
        }
      }
    }
    const cnt = new Float64Array(256);
    rows.forEach((xs, k) => {
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const a = Math.max(0, Math.ceil((xs[i] - g.left) / g.dx - 0.5)), b = Math.min(g.w - 1, Math.floor((xs[i + 1] - g.left) / g.dx - 0.5));
        for (let c = a; c <= b; c++) cnt[g.data[k * g.w + c]]++;
      }
    });
    const cell = g.dx * g.dy / 1e6;
    return { km2: CLASSES.map(c => cnt[c[0]] * cell), cells: cnt.reduce((s, v) => s + v, 0), res: Math.round(Math.sqrt(g.dx * g.dy)) };
  }

  /* the class of the 30 m cell that holds a point: a box of 3 x 3 cells from the same WCS, the cell under the point */
  async function classAt(lat, lon) {
    const [x, y] = albers(lon, lat), q = new URLSearchParams({ service: "WCS", version: "2.0.1", request: "GetCoverage", coverageId: "NLCD_2021_Land_Cover_L48", format: "image/geotiff" });
    q.append("subset", `X(${Math.floor(x - 45)},${Math.ceil(x + 45)})`); q.append("subset", `Y(${Math.floor(y - 45)},${Math.ceil(y + 45)})`);
    const r = await WG.util.fetchQ(`${WCS}?${q}`);
    if (!r.ok) throw new Error(`MRLC WCS answered ${r.status}`);
    const g = readTiff(await r.arrayBuffer()), c = Math.floor((x - g.left) / g.dx), k = Math.floor((g.top - y) / g.dy);
    if (c < 0 || k < 0 || c >= g.w || k >= g.h) throw new Error("the point is outside the cells returned");
    const v = g.data[k * g.w + c];
    return CLASSES.some(z => z[0] === v) ? v : null;
  }

  /* ---------- state shares ---------- */
  let stateP = null;
  const stateData = () => stateP || (stateP = fetchJSON(`data/states/landcover.json?v=${V}`).catch(e => { stateP = null; throw e; }));

  /* ---------- boundary shares ---------- */
  const memo = new WeakMap(); // polys array -> promise of the counts
  function boundaryShares(polys) {
    if (memo.has(polys)) return memo.get(polys);
    const p = (async () => {
      const rings = polys.flat().map(r => r.map(([lo, la]) => albers(lo, la)));
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      rings.forEach(r => r.forEach(([x, y]) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }));
      x0 = Math.floor(x0 - 30); y0 = Math.floor(y0 - 30); x1 = Math.ceil(x1 + 30); y1 = Math.ceil(y1 + 30);
      const nat = (x1 - x0) / 30 * ((y1 - y0) / 30), f = Math.max(1, Math.sqrt(nat / MAX_CELLS));
      const n = Math.max(1, Math.round((x1 - x0) / 30 / f)), m = Math.max(1, Math.round((y1 - y0) / 30 / f));
      const q = new URLSearchParams({ service: "WCS", version: "2.0.1", request: "GetCoverage", coverageId: "NLCD_2021_Land_Cover_L48", format: "image/geotiff" });
      q.append("subset", `X(${x0},${x1})`); q.append("subset", `Y(${y0},${y1})`);
      if (f > 1) q.set("scalesize", `i(${n}),j(${m})`);
      const r = await WG.util.fetchQ(`${WCS}?${q}`);
      if (!r.ok) throw new Error(`MRLC WCS answered ${r.status}`);
      const res = count(readTiff(await r.arrayBuffer()), rings);
      if (!res.cells) throw new Error("no cells inside the boundary");
      return res;
    })();
    memo.set(polys, p);
    p.catch(() => memo.delete(polys)); // a failed read is tried again next time
    return p;
  }

  /* ---------- the legend's % column (js/shares.js): the exact shares, not counted from the map's pixels ----------
     km2 by class (CLASSES' order) of your boundary (counted live, as the card) or of the states on the map (pre-built) */
  const exact = A => (A.polys ? boundaryShares(A.polys).then(r => ({ km2: r.km2, note: `NLCD 2021 Land Cover (MRLC WCS), ${r.res} m cells (equal area), ${r.cells.toLocaleString("en-US")} inside your boundary.` }))
    : stateData().then(d => {
      const have = (A.recs || []).filter(r => d.states[r.code]);
      if (!have.length) throw new Error("no shares for the states on the map");
      return { km2: CLASSES.map((_, i) => have.reduce((s, r) => s + d.states[r.code].km2[i], 0)), note: "NLCD 2021 Land Cover (MRLC), its 30 m cells counted inside each state's outline (equal area), pre-built." };
    }));
  const ITEM = { key: "nlcd", name: "Land cover (NLCD 2021)", legend: { rows: CLASSES.map(c => [c[2], c[1]]) }, shares: { id: "nlcd", exact, none: null } };

  /* ---------- the map legend: the classes' colours, and the way to their shares ----------
     Added under the theme's legend (app.js renderLegend); alone, it has its own hide button. Its link opens Soil maps › Soil
     at the Land cover card (app.js); a saved map image leaves the link out, as it does every button (js/mapimage.js). */
  function legend(el, min, toggle) {
    const old = el.querySelector(".lc"), host = document.createElement("div"), alone = !el.querySelector("#legendMin");
    if (old) old.remove();
    el.hidden = false;
    el.classList.toggle("min", min);
    host.className = "lc";
    host.innerHTML = `<h5><span>Land cover <small>NLCD 2021</small></span>${alone ? `<button class="lcMin">${min ? "show" : "hide"}</button>` : ""}</h5>
      <div class="rows lc-key">${CLASSES.map(c => `<div class="row"><i class="sw" style="background:${c[2]}"></i><span>${esc(c[1]).replace(/\//g, "/<wbr>")}</span></div>`).join("")}</div>
      <p class="lnote"><button class="link lc-go" data-lc-go>Shares and curve numbers: Soil maps › Soil</button></p>`;
    el.appendChild(host);
    if (alone) host.querySelector(".lcMin").onclick = toggle;
    if (WG.shares) WG.shares.attach(host, ITEM);
  }

  /* ---------- the Land cover card of Soil maps › Soil ----------
     Each class's share of your boundary when one is drawn or uploaded, else of the states on the map, with its curve
     numbers; drawn again when the boundary or the states change. Its table is the tab's "landcover" (js/soilmaps.js): the
     card's CSV, and part of the tab's file of all its tables. */
  const cnOf = () => (WG.basins && WG.basins.CN ? WG.basins : null); // TR-55 by NLCD class: { CN: code -> [A, B, C, D], CN_AS: code -> cover }
  const cur = () => (WG.area && WG.area.boundary && WG.area.boundary()) || null;
  const HSG_TIP = { A: "Hydrologic soil group A: deep sand or gravel, least runoff", B: "B: loams", C: "C: finer soils or a slowly permeable layer", D: "D: clays, shallow or wet soils, most runoff" };
  const km2Txt = v => fmt(v, v >= 100 ? 0 : v >= 10 ? 1 : v >= 1 ? 2 : 3);
  let box = null, cseq = 0; // the card's box while the Soil tab holds it, and the drawing that counts (a later one wins)
  function card(el) { box = el || null; drawCard(); }
  function drawCard() {
    if (box && !box.isConnected) box = null;
    const el = box, SM = WG.soilmaps;
    if (!el || !SM) return;
    const my = ++cseq, live = () => my === cseq && el === box, b = cur(), recs = WG.region ? WG.region.recs() : [];
    const put = (csv, what, body) => { if (live()) el.innerHTML = `<div class="card lc-card">${SM.head("Land cover", csv, "NLCD 2021")}${what ? `<p class="fine lc-what">${what}</p>` : ""}${body}</div>`; };
    const onMap = `<button class="link" data-sm-lc>Show the land cover on the map</button>`;
    const how = b ? "Your boundary, from the area tool: clear it there for the states on the map." : "For a field or any area of your own, draw or upload its boundary with the area tool (in the map tools): this card then counts it.";
    const paint = (res, what, src, note) => {
      if (!live()) return;
      const tot = res.km2.reduce((s, v) => s + v, 0) || 1, T = cnOf(), HSG = ["A", "B", "C", "D"];
      const all = CLASSES.map((c, i) => ({ code: c[0], name: c[1], color: c[2], pct: (100 * res.km2[i]) / tot, km2: res.km2[i], cn: T && T.CN[c[0]], as: T && T.CN_AS[c[0]] }));
      SM.tables().landcover = { title: `Land cover of ${what} (NLCD 2021${T ? "; TR-55 Table 2-2 curve numbers" : ""})`,
        header: ["NLCD code", "NLCD class", "Share (%)", "Area (km2)", ...(T ? ["TR-55 cover type", "CN A", "CN B", "CN C", "CN D"] : []), "Area counted", "Source"],
        rows: all.map(r => [r.code, r.name, +r.pct.toFixed(2), +r.km2.toFixed(3), ...(T ? [r.as || "no curve number (water or ice)", ...(r.cn || ["", "", "", ""])] : []), what, src]) };
      const cols = [SM.th("Land cover", T ? "as TR-55 cover" : ""), SM.th("Share", "%"), SM.th("Area", "km²"), ...(T ? HSG.map(g => `<span title="${HSG_TIP[g]}">CN ${g}</span>`) : [])];
      const rows = all.filter(r => r.pct >= 0.05).map(r => [`<i class="lc-sw" style="background:${r.color}"></i>${esc(r.name)}${T ? `<small>${esc(r.as || "no curve number")}</small>` : ""}`,
        fmt(r.pct, 1), km2Txt(r.km2), ...(T ? (r.cn ? r.cn.map(String) : ["—", "—", "—", "—"]) : [])]);
      put("landcover", `% of ${esc(what)}`, `${SM.grid(cols, rows)}
        <p class="fine">${esc(src)}${note ? ` ${esc(note)}` : ""} Classes under 0.05% are not listed (the CSV has them all). ${esc(how)} ${onMap}.</p>
        ${T ? `<p class="fine">Curve numbers: NRCS TR-55 (1986) Table 2-2, for average wetness before a storm (AMC II): the higher, the more of the rain runs off. A–D: the hydrologic soil groups, from deep sands (A, least runoff) to clays and shallow or wet soils (D). Each class is taken as the TR-55 cover under its name; wetlands 78 (assumed: not in TR-55). The Basin tab gives a storm's runoff at the point and in its watershed.</p>` : ""}`);
    };
    const none = e => put("", "", `<p class="fine">Land-cover shares are not available${e && e.message ? ` (${esc(e.message)})` : ""}. ${onMap}.</p>`);
    const states = () => stateData().then(d => {
      const have = recs.filter(r => d.states[r.code]);
      if (!have.length) throw new Error("no shares for the states on the map");
      const km2 = CLASSES.map((_, i) => have.reduce((s, r) => s + d.states[r.code].km2[i], 0)), res = have.map(r => d.states[r.code].res);
      const nm = have.length === 1 ? have[0].name : have.length >= 48 ? "the 48 contiguous states and DC" : `the ${have.length} chosen states, combined`;
      const rr = Math.min(...res) === Math.max(...res) ? `${res[0]} m` : `${Math.min(...res)}–${Math.max(...res)} m`;
      return [{ km2 }, nm, `NLCD 2021 Land Cover (MRLC), counted inside each state's outline in ${rr} cells (equal area), pre-built.`];
    });
    if (b) {
      const mine = `your boundary${b.name ? ` (${b.name})` : ""}`;
      put("", `% of ${esc(mine)}`, `<p class="fine">Reading the land cover inside your boundary from MRLC…</p>`);
      boundaryShares(b.polys).then(res => paint(res, mine, `NLCD 2021 Land Cover (MRLC WCS), ${res.res} m cells (equal area), ${res.cells.toLocaleString("en-US")} inside the boundary.`),
        () => states().then(([res, nm, src]) => paint(res, nm, src, "Your boundary could not be read from MRLC, so these are the states on the map."), none));
    } else if (!recs.length) none();
    else {
      put("", `% of ${esc(recs.length === 1 ? recs[0].name : "the chosen states")}`, `<p class="fine">Reading the land cover…</p>`);
      states().then(([res, nm, src]) => paint(res, nm, src), none);
    }
  }
  // a boundary drawn, uploaded or cleared (js/area.js), or other states on the map (app.js): the card counts them
  ["wg-boundary", "wg-states"].forEach(ev => document.addEventListener(ev, drawCard));
  return { legend, card, CLASSES, albers, readTiff, count, boundaryShares, classAt, exact, ITEM };
})();
