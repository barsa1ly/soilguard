/* Land cover legend: when the NLCD 2021 overlay is on, the map legend lists its classes (official colours) with each class's
   share of the area: of your boundary (area tool) when one is drawn or uploaded, else of the chosen state(s). State shares
   are pre-built (tools/build_landcover.py: MRLC WCS 2.0.1, class counts inside each state's outline, in km2, to
   data/states/landcover.json). A boundary is counted live from the same WCS: its box as an uncompressed GeoTIFF in EPSG:5070
   (Albers equal area, so every cell has the same area), at 30 m, or coarser (nearest neighbour, class codes kept) when that
   would pass about 4 million cells; the boundary is rasterised on that grid by cell centre. Kept per boundary for the visit.
   Under the shares, a block to open gives each listed class's runoff curve numbers (NRCS TR-55 Table 2-2, hydrologic soil
   groups A-D, js/basins.js's table, where the page has it), and the CSV has them too. classAt gives one point's class,
   from the same WCS. */
WG.landcover = (function () {
  const { esc, fetchJSON, download } = WG.util;
  const V = ((document.querySelector('script[src*="data/states.js"]') || {}).src || "").split("v=")[1] || "1";
  const WCS = "https://www.mrlc.gov/geoserver/mrlc_download/NLCD_2021_Land_Cover_L48/wcs";
  const MAX_CELLS = 3.6e6;
  // official NLCD legend colours
  const CLASSES = [[11, "Open water", "#466b9f"], [12, "Perennial ice/snow", "#d1def8"], [21, "Developed, open space", "#dec5c5"], [22, "Developed, low intensity", "#d99282"],
    [23, "Developed, medium intensity", "#eb0000"], [24, "Developed, high intensity", "#ab0000"], [31, "Barren land", "#b3ac9f"], [41, "Deciduous forest", "#68ab5f"],
    [42, "Evergreen forest", "#1c5f2c"], [43, "Mixed forest", "#b5c58f"], [52, "Shrub/scrub", "#ccb879"], [71, "Grassland/herbaceous", "#dfdfc2"],
    [81, "Pasture/hay", "#dcd939"], [82, "Cultivated crops", "#ab6c28"], [90, "Woody wetlands", "#b8d9eb"], [95, "Emergent herbaceous wetlands", "#6c9fb8"]];
  let redraw = () => {};

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
    const r = await fetch(`${WCS}?${q}`);
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
      const r = await fetch(`${WCS}?${q}`);
      if (!r.ok) throw new Error(`MRLC WCS answered ${r.status}`);
      const res = count(readTiff(await r.arrayBuffer()), rings);
      if (!res.cells) throw new Error("no cells inside the boundary");
      return res;
    })();
    memo.set(polys, p);
    p.catch(() => memo.delete(polys)); // a failed read is tried again next time
    return p;
  }

  /* ---------- the legend ---------- */
  let model = null; // what the table shows now, for the CSV
  let cnOpen = false; // the curve-number block, open or shut, kept as the legend is drawn again
  const cnOf = () => (WG.basins && WG.basins.CN ? WG.basins : null); // TR-55 by NLCD class: { CN: code -> [A, B, C, D], CN_AS: code -> cover }
  const cur = () => (WG.area && WG.area.boundary && WG.area.boundary()) || null;
  function draw(el, min, toggle) {
    const b = cur(), recs = WG.region ? WG.region.recs() : [];
    const key = b ? "b" : recs.map(r => r.code).join(",");
    el.hidden = false;
    el.classList.toggle("min", min);
    let host = el.querySelector(".lc");
    if (!host) { host = document.createElement("div"); host.className = "lc"; el.appendChild(host); }
    host.dataset.key = key;
    const head = sub => `<h5><span>Land cover <small>NLCD 2021</small></span>${el.querySelector("#legendMin") ? "" : `<button class="lcMin">${min ? "show" : "hide"}</button>`}</h5>${sub}`;
    const set = (sub, body) => {
      host.innerHTML = `${head(sub)}<div class="lc-body">${body}</div>`;
      const t = host.querySelector(".lcMin"), c = host.querySelector(".lcCsv");
      if (t) t.onclick = toggle;
      if (c) c.onclick = ev => { ev.preventDefault(); csv(); };
    };
    const paint = (res, what, src, note) => {
      const tot = res.km2.reduce((s, v) => s + v, 0) || 1;
      model = { rows: CLASSES.map((c, i) => [c[0], c[1], 100 * res.km2[i] / tot, res.km2[i]]), what, src };
      const rows = model.rows.filter(r => r[2] >= 0.05), T = cnOf();
      // the classes' curve numbers: a compact table under the shares, open on a tap, so the legend stays short on a phone
      const cn = T ? `<details class="lc-cn"${cnOpen ? " open" : ""}><summary>Runoff curve numbers (TR-55)</summary><table class="lc-cnt"><thead><tr><th>Land cover <small>treated as</small></th><th>A</th><th>B</th><th>C</th><th>D</th></tr></thead><tbody>${rows.map(r => {
        const c = CLASSES.find(x => x[0] === r[0]), v = T.CN[r[0]];
        return `<tr><td><i class="sw" style="background:${c[2]}"></i><span>${esc(c[1])}<small>${esc(v ? T.CN_AS[r[0]] : "no curve number")}</small></span></td>${v ? v.map(n => `<td>${n}</td>`).join("") : `<td colspan="4">—</td>`}</tr>`;
      }).join("")}</tbody></table><p class="lnote">NRCS TR-55 (1986) Table 2-2, average wetness before a storm (AMC II): the higher, the more of the rain runs off. A–D: the hydrologic soil groups, deep sands (A, least runoff) to clays and shallow or wet soils (D). Each class as the TR-55 cover under its name; wetlands 78 (assumed: not in TR-55). The Basin tab gives a storm's runoff at the point and in its watershed.</p></details>` : "";
      set(`<p class="lc-what">% of ${esc(what)}</p>`, `<div class="rows">${rows.map(r => {
        const c = CLASSES.find(x => x[0] === r[0]);
        return `<div class="row"><i class="sw" style="background:${c[2]}"></i><span class="lc-n">${esc(c[1])}</span><b class="lc-p">${r[2].toFixed(1)}%</b></div>`;
      }).join("")}</div>${cn}<p class="lnote">${esc(src)}${note ? ` ${esc(note)}` : ""} Classes under 0.05% are not listed. <a href="#" class="lcCsv">CSV</a></p>`);
      const d = host.querySelector(".lc-cn");
      if (d) d.addEventListener("toggle", () => { cnOpen = d.open; });
    };
    const none = () => set("", `<p class="lnote">Land-cover shares are not available.</p>`);
    const states = () => stateData().then(d => {
      const have = recs.filter(r => d.states[r.code]);
      if (!have.length) throw new Error("no state shares");
      const km2 = CLASSES.map((_, i) => have.reduce((s, r) => s + d.states[r.code].km2[i], 0)), res = have.map(r => d.states[r.code].res);
      const nm = have.length === 1 ? have[0].name : have.length >= 48 ? "the 48 contiguous states and DC" : `the ${have.length} chosen states, combined`;
      const rr = Math.min(...res) === Math.max(...res) ? `${res[0]} m` : `${Math.min(...res)}–${Math.max(...res)} m`;
      return [{ km2 }, nm, `NLCD 2021 Land Cover (MRLC), counted inside each state's outline in ${rr} cells (equal area), pre-built.`];
    });
    if (b) {
      set(`<p class="lc-what">% of your boundary</p>`, `<p class="lnote">reading land cover…</p>`);
      const mine = b.polys, same = () => host.dataset.key === "b" && cur() && cur().polys === mine;
      boundaryShares(mine).then(res => { if (same()) paint(res, "your boundary", `NLCD 2021 Land Cover (MRLC WCS), ${res.res} m cells (equal area), ${res.cells.toLocaleString("en-US")} inside the boundary.`); },
        () => { if (same()) states().then(([res, nm, src]) => paint(res, nm, src, "Your boundary could not be read from MRLC, so this is the state."), none); });
    } else if (!recs.length) none();
    else {
      set(`<p class="lc-what">% of ${esc(recs.length === 1 ? recs[0].name : "the chosen states")}</p>`, `<p class="lnote">reading land cover…</p>`);
      states().then(([res, nm, src]) => { if (host.dataset.key === key) paint(res, nm, src); }, none);
    }
  }
  function csv() {
    if (!model) return;
    const q = s => `"${String(s).replace(/"/g, '""')}"`;
    const T = cnOf(), cn = c => (T && T.CN[c] ? [q(T.CN_AS[c]), ...T.CN[c]] : ["", "", "", "", ""]);
    download("land_cover_shares.csv", [`class_code,class_name,percent,area_km2,area,source${T ? ",tr55_cover_type,cn_a,cn_b,cn_c,cn_d" : ""}`,
      ...model.rows.map(r => [r[0], q(r[1]), r[2].toFixed(2), r[3].toFixed(2), q(model.what), q(model.src), ...(T ? cn(r[0]) : [])].join(","))].join("\n"), "text/csv");
  }
  // a boundary drawn, uploaded or cleared: the legend follows (app.js draws it only while the layer is on)
  document.addEventListener("wg-boundary", () => redraw());
  return { draw, CLASSES, albers, readTiff, count, boundaryShares, classAt, init: o => { redraw = o.render; } };
})();
