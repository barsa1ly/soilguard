/* Basins: surface runoff and soil loss for the small watershed that holds the point, in the Soil maps theme and tab.
   The watershed is the Watershed Boundary Dataset's 12-digit hydrologic unit (HU12, about 40 to 250 km²; USGS The National
   Map, wbd layer 6). Inside it the NHDPlus High Resolution network: its flowlines (NHDPlus_HR layer 3, asked by the HU12's
   polygon) and the catchments of those flowlines and of the sinks (layer 1), asked BY ID from layer 10: a spatial query on
   the catchment layer takes 40-100 s or times out, so none is ever made. Three results, each labelled for what it is:
   - mean annual runoff of each catchment and of the HU12 from NHDPlus HR's EROM step A (the McCabe-Wolock water-balance
     model): 893.6 x qincrama (cfs) / area (km²) = mm/yr, a model value;
   - design-storm runoff by the SCS curve number (TR-55) for a 24-hour depth (NOAA Atlas 14 where data/states/XX/atlas14.json
     is built, else typed), CN from the soil survey's hydrologic groups (SSURGO, area-weighted inside the HU12 on Soil Data
     Access's server) and the HU12's NLCD 2021 land cover (js/landcover.js's reader of the MRLC WCS);
   - gross sheet-and-rill soil loss by RUSLE, A = R K LS C P: R of the point's NHDPlus V2 catchment (USGS RF7100, pre-built
     per state into data/states/XX/rfactor.json by tools/build_basins.py; the COMID from USGS NLDI), K, slope and slope
     length from SSURGO, C from the NLCD classes.
   Two map layers join the theme: watershed boundaries (WBD) and NHDPlus HR streams, both drawn by the USGS servers.
   Loaded after soilmaps.js (whose layer list and tab it joins) and before landcover.js and app.js. */
WG.basins = (function () {
  const { esc, fmt, fetchJSON } = WG.util;
  const Wx = WG.weather, SM = WG.soilmaps, UN = WG.units;
  const num = v => (v === null || v === undefined || v === "" || !Number.isFinite(+v) ? null : +v);
  const ok = v => v !== null && v !== undefined && Number.isFinite(v);
  const V = ((document.querySelector('script[src*="data/states.js"]') || {}).src || "").split("v=")[1] || "1"; // the state files' version, as app.js
  const WBD = "https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer";
  const HR = "https://hydro.nationalmap.gov/arcgis/rest/services/NHDPlus_HR/MapServer";
  const NLDI = "https://api.water.usgs.gov/nldi/linked-data";
  const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));

  /* ---------- the map layers: an ArcGIS MapServer drawn as 512 px tiles of export images ----------
     dynamicLayers carry our own symbols, so the legend matches the map; a tile is an ordinary GET the browser keeps */
  const ArcTiles = L.TileLayer.extend({
    initialize(svc, layers, o) { this._svc = svc; this._dl = layers; L.TileLayer.prototype.initialize.call(this, "", { tileSize: 512, pane: "thematic", maxZoom: 19, ...o }); },
    getTileUrl(c) {
      const R = 20037508.342789244, span = (4 * R) / 2 ** c.z, x0 = -R + c.x * span, y1 = R - c.y * span, k = Math.min(2, window.devicePixelRatio || 1);
      /* f > 1 asks for a lower dpi: the server then takes the tile for a larger scale and draws a layer it would hide (its
         flowlines only below 1:100,000); the lines are drawn f times wider to look the same */
      const f = this.options.thin ? this.options.thin(c.z) : 1;
      return `${this._svc}/export?${new URLSearchParams({ bbox: [x0, y1 - span, x0 + span, y1].map(v => v.toFixed(1)).join(","), bboxSR: 3857, imageSR: 3857, size: `${512 * k},${512 * k}`,
        dpi: Math.round((96 * k) / f), format: "png32", transparent: true, dynamicLayers: JSON.stringify(this._dl(f)), f: "image" })}`;
    },
  });
  const outline = (hex, w) => ({ type: "simple", symbol: { type: "esriSFS", style: "esriSFSNull", outline: { type: "esriSLS", style: "esriSLSSolid", color: [...rgb(hex), 255], width: w } } });
  /* HU8, HU10, HU12: the server keeps its own scale ranges (one level at a time: HU8 to 1:867,000, HU10 to 1:433,000, HU12
     below), so zooms 6-8 are asked at a lower dpi to show the HU8s there; HU12s keep their HUC labels */
  const HUS = [[4, "#54278f", 2.4, "HU8 subbasin (8-digit, about 1,800 km²): zoom 6–9"], [5, "#756bb1", 1.6, "HU10 watershed (10-digit): zoom 10"], [6, "#807dba", 1.2, "HU12 subwatershed (12-digit, 40–250 km²): zoom 11 and in; the unit the tab uses"]];
  const wbdLayer = new ArcTiles(WBD, f => HUS.map(([id, c, w]) => ({ id, source: { type: "mapLayer", mapLayerId: id }, drawingInfo: { renderer: outline(c, w * f), showLabels: id === 6 } })),
    { minZoom: 6, thin: z => (z >= 9 ? 1 : 2 ** (9 - z)), attribution: "USGS Watershed Boundary Dataset" });
  // NHDPlus HR network flowlines by stream order (Strahler)
  const ORD = [[2, "#6baed6", 0.8, "Stream order 1–2"], [4, "#3182bd", 1.3, "Stream order 3–4"], [6, "#08519c", 2, "Stream order 5–6"], [99, "#08306b", 3, "Stream order 7 and up"]];
  const flowLayer = new ArcTiles(HR, f => [{ id: 3, source: { type: "mapLayer", mapLayerId: 3 }, drawingInfo: { renderer: { type: "classBreaks", field: "streamorde", minValue: -99,
    classBreakInfos: ORD.map(([classMaxValue, c, w]) => ({ classMaxValue, symbol: { type: "esriSLS", style: "esriSLSSolid", color: [...rgb(c), 255], width: w * f } })) } } }],
    { minZoom: 12, thin: z => (z >= 13 ? 1 : 2), attribution: "USGS NHDPlus High Resolution" });
  const HR_CREDIT = "USGS NHDPlus High Resolution (NHDPlus HR, 1:24,000 NHD with value-added attributes, public domain), drawn by The National Map's server";
  SM.layers.push(
    { key: "wbd", name: "Watershed boundaries (HU8, HU10, HU12)", sub: "USGS Watershed Boundary Dataset, drawn by its server", layer: wbdLayer, opacity: 2,
      legend: { title: "Watershed boundaries", unit: "hydrologic units", rows: HUS.map(h => [h[1], h[3]]) },
      note: "Hydrologic units of the Watershed Boundary Dataset (USGS and USDA-NRCS, public domain), drawn by The National Map's server, one level at a time: HU8 at zoom 6–9, HU10 at zoom 10, HU12 from zoom 11 in, with its 12-digit code. Each HU12 drains to the one named in its 'to HUC'. The tab works on the HU12 that holds the point." },
    { key: "flow", name: "Streams: NHDPlus HR flowlines", sub: "USGS, 1:24,000 network, from zoom 12", layer: flowLayer, opacity: 2,
      legend: { title: "Streams (NHDPlus HR)", unit: "Strahler stream order", rows: ORD.map(o => [o[1], o[3]]) },
      note: `Network flowlines of ${HR_CREDIT}. Drawn from zoom 12 in; zoom in if the map is empty. Lines follow the 1:24,000 hydrography, including intermittent and ephemeral channels.` });

  /* ---------- small geometry ---------- */
  // even-odd over all rings (holes and several parts work); rings as [lon, lat]
  function inRings(x, y, rings) {
    let c = false;
    for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; }
    return c;
  }
  const signed = r => r.reduce((s, [x, y], i) => { const [x2, y2] = r[(i + 1) % r.length]; return s + x * y2 - x2 * y; }, 0) / 2;
  // the centroid of the largest ring: a catchment counts as inside the HU12 when it is (HR catchments nest in HU12s, but
  // the flowlines that only touch the HU12's edge bring their neighbours' catchments too)
  function centroid(rings) {
    const r = rings.reduce((a, b) => (Math.abs(signed(b)) > Math.abs(signed(a)) ? b : a)), A = signed(r);
    let cx = 0, cy = 0;
    r.forEach(([x1, y1], i) => { const [x2, y2] = r[(i + 1) % r.length], k = x1 * y2 - x2 * y1; cx += (x1 + x2) * k; cy += (y1 + y2) * k; });
    return A ? [cx / (6 * A), cy / (6 * A)] : r[0];
  }
  // km² of rings in lon/lat, on the Albers equal-area plane of js/landcover.js
  const km2Of = rings => Math.abs(rings.reduce((s, r) => s + signed(r.map(([x, y]) => WG.landcover.albers(x, y))), 0)) / 1e6;
  // the HU12 as WKT for SQL Server: Esri's outer rings run clockwise, holes counter-clockwise; each hole joins the outer ring around it
  function wkt(rings) {
    const outer = rings.filter(r => signed(r) < 0), holes = rings.filter(r => signed(r) >= 0);
    const polys = outer.length ? outer.map(o => [o, ...holes.filter(h => inRings(h[0][0], h[0][1], [o]))]) : rings.map(r => [r]);
    const txt = r => r.map(([x, y]) => `${x.toFixed(5)} ${y.toFixed(5)}`).join(",");
    return `MULTIPOLYGON(${polys.map(p => `(${p.map(r => `(${txt(r)})`).join(",")})`).join(",")})`;
  }
  const ll = rings => rings.map(r => r.map(([x, y]) => [y, x]));

  /* ---------- the sources ---------- */
  // ArcGIS query by POST (an HU12 polygon or an id list is too long for a URL), paged past the 2,000-record limit
  async function arcAll(url, params) {
    let out = [];
    for (let page = 0; page < 20; page++) {
      const body = new URLSearchParams({ ...params, f: "json", ...(page ? { resultOffset: out.length, resultRecordCount: 2000 } : {}) });
      const j = await fetchJSON(url, { method: "POST", body }, 60000);
      if (j.error) throw new Error(j.error.message || "the USGS map server refused the query");
      out = out.concat(j.features || []);
      if (!j.exceededTransferLimit || !(j.features || []).length) break;
    }
    return out;
  }
  // the HU12 that holds the point (its polygon simplified to about 10 m)
  async function hu12At(lat, lon) {
    const q = new URLSearchParams({ geometry: `${lon},${lat}`, geometryType: "esriGeometryPoint", inSR: 4326, outSR: 4326, spatialRel: "esriSpatialRelIntersects", outFields: "huc12,name,areasqkm,tohuc,states",
      returnGeometry: true, maxAllowableOffset: 0.0001, geometryPrecision: 6, f: "json" });
    const j = await fetchJSON(`${WBD}/6/query?${q}`, {}, 30000);
    if (j.error) throw new Error(j.error.message || "the Watershed Boundary Dataset's server refused the query");
    const f = (j.features || [])[0];
    if (!f || !f.geometry || !f.geometry.rings) return null;
    const a = f.attributes, rings = f.geometry.rings;
    return { huc12: a.huc12, name: a.name, km2: num(a.areasqkm), tohuc: a.tohuc, states: a.states, rings, polys: [rings] };
  }
  const FL_FIELDS = "nhdplusid,gnis_name,streamorde,hydroseq,dnhydroseq,dnminorhyd,qincrama,qama,areasqkm,totdasqkm,ftype";
  // the NHDPlus HR flowlines and sinks inside the HU12, then their catchments by id (500 ids a request)
  async function hrIn(hu) {
    const geo = { geometry: JSON.stringify({ rings: hu.rings, spatialReference: { wkid: 4326 } }), geometryType: "esriGeometryPolygon", inSR: 4326, outSR: 4326, spatialRel: "esriSpatialRelIntersects" };
    const [fl, sk] = await Promise.all([
      arcAll(`${HR}/3/query`, { ...geo, outFields: FL_FIELDS, returnGeometry: true, maxAllowableOffset: 0.0001, geometryPrecision: 5 }),
      arcAll(`${HR}/1/query`, { ...geo, outFields: "nhdplusid,purpcode", returnGeometry: false }),
    ]);
    const ids = [...new Set([...fl, ...sk].map(f => Math.round(f.attributes.nhdplusid)).filter(Number.isFinite))], parts = [];
    for (let i = 0; i < ids.length; i += 500) parts.push(ids.slice(i, i + 500));
    const cats = (await Promise.all(parts.map(p => arcAll(`${HR}/10/query`, { where: `nhdplusid in (${p.join(",")})`, outFields: "nhdplusid,areasqkm", returnGeometry: true, outSR: 4326, maxAllowableOffset: 0.0002, geometryPrecision: 5 })))).flat();
    return { fl, sk, cats };
  }
  /* each catchment's EROM runoff, the one at the point, those upstream of it inside the HU12, and the HU12's mean */
  function network(hr, hu, lat, lon) {
    const F = new Map(hr.fl.map(f => [Math.round(f.attributes.nhdplusid), f.attributes]));
    const cats = hr.cats.filter(c => c.geometry && c.geometry.rings).map(c => {
      const id = Math.round(c.attributes.nhdplusid), a = F.get(id) || null, area = num(c.attributes.areasqkm), q = a ? num(a.qincrama) : null;
      return { id, area, a, q, mm: ok(q) && q >= 0 && area > 0 ? (893.6 * q) / area : null, rings: c.geometry.rings, sink: !a, inHu: inRings(...centroid(c.geometry.rings), hu.rings) };
    });
    const here = cats.find(c => inRings(lon, lat, c.rings)) || null;
    // upstream: every flowline whose main or minor downstream path leads to the point's flowline, inside what was loaded
    const up = new Set();
    if (here && here.a) {
      const by = new Map();
      hr.fl.forEach(f => [f.attributes.dnhydroseq, f.attributes.dnminorhyd].forEach(d => { if (d) { if (!by.has(d)) by.set(d, []); by.get(d).push(f.attributes); } }));
      const todo = [here.a.hydroseq], seen = new Set(todo);
      while (todo.length) (by.get(todo.pop()) || []).forEach(a => { if (!seen.has(a.hydroseq)) { seen.add(a.hydroseq); todo.push(a.hydroseq); up.add(Math.round(a.nhdplusid)); } });
    }
    cats.forEach(c => { c.here = c === here; c.up = up.has(c.id); });
    const run = cats.filter(c => c.inHu && ok(c.mm)), sinks = cats.filter(c => c.inHu && c.sink), upc = cats.filter(c => c.up);
    const sum = (a, k) => a.reduce((s, c) => s + (c[k] || 0), 0);
    return { cats, here, flows: hr.fl, nRun: run.length, runKm2: sum(run, "area"), huMm: sum(run, "area") ? (893.6 * sum(run, "q")) / sum(run, "area") : null,
      sinkKm2: sum(sinks, "area"), nSink: sinks.length, upN: upc.length, upKm2: sum(upc, "area") + (here ? here.area : 0),
      upMm: here && ok(here.mm) ? (893.6 * (sum(upc.filter(c => ok(c.q)), "q") + here.q)) / (sum(upc.filter(c => ok(c.q)), "area") + here.area) : null };
  }

  /* the soil survey inside the HU12: SDA intersects the polygon with the map units on its server and sums each map unit's
     area there; every component with its share, hydrologic group, slope, USLE slope length, T and surface-horizon K */
  async function soilsIn(hu) {
    const rows = await SM.sda(`WITH a AS (SELECT geometry::STGeomFromText('${wkt(hu.rings)}', 4326).MakeValid() AS g),
      m AS (SELECT P.mukey, SUM(P.mupolygongeo.STIntersection(a.g).STArea()) AS ar FROM mupolygon P, a WHERE P.mupolygongeo.STIntersects(a.g) = 1 GROUP BY P.mukey)
      SELECT m.mukey, m.ar, mu.musym, mu.muname, c.cokey, c.compname, c.comppct_r, c.compkind, c.majcompflag, c.hydgrp, c.slope_r, c.slopelenusle_r, c.tfact, h.kwfact, h.kffact
      FROM m JOIN mapunit mu ON mu.mukey = m.mukey JOIN component c ON c.mukey = m.mukey LEFT JOIN chorizon h ON h.cokey = c.cokey AND h.hzdept_r = 0
      ORDER BY m.ar DESC, c.comppct_r DESC`);
    const tot = [...new Map(rows.map(r => [r.mukey, num(r.ar) || 0])).values()].reduce((s, v) => s + v, 0), seen = new Set();
    return rows.filter(r => !seen.has(r.cokey) && seen.add(r.cokey)).map(r => {
      const kw = num(r.kwfact), kf = num(r.kffact), s = num(r.slope_r), lam = num(r.slopelenusle_r), g = String(r.hydgrp || "").split("/").pop().trim().charAt(0).toUpperCase();
      const L0 = ls(s, lam);
      return { mukey: r.mukey, sym: r.musym, mu: r.muname, muShare: tot ? (num(r.ar) || 0) / tot : 0, name: r.compname, pct: num(r.comppct_r), kind: r.compkind, major: /yes/i.test(r.majcompflag || ""),
        hsg: "ABCD".includes(g) && g ? g : null, hydgrp: r.hydgrp, K: ok(kw) ? kw : kf, kSrc: ok(kw) ? "kw" : ok(kf) ? "kf" : "", slope: s, lam, T: num(r.tfact), ...L0,
        w: (tot ? (num(r.ar) || 0) / tot : 0) * ((num(r.comppct_r) || 0) / 100) };
    });
  }
  /* RUSLE's topographic factor from the survey's slope (%) and USLE slope length (m): McCool et al. (1987) S, and
     L = (λ / 22.13)^m with Wischmeier & Smith's m by slope class */
  function ls(s, lam) {
    if (!ok(s) || !ok(lam) || lam <= 0) return { L: null, S: null, LS: null };
    const sin = Math.sin(Math.atan(s / 100)), S = s < 9 ? 10.8 * sin + 0.03 : 16.8 * sin - 0.5, m = s < 1 ? 0.2 : s < 3.5 ? 0.3 : s < 5 ? 0.4 : 0.5, L = (lam / 22.13) ** m;
    return { L, S, LS: L * S, m };
  }
  // the component-weighted mean of a value over the components that have it, and the share of the HU12 they cover
  function wmean(comps, f) {
    let s = 0, w = 0, all = 0;
    comps.forEach(c => { all += c.w; const v = f(c); if (ok(v) && c.w > 0) { s += v * c.w; w += c.w; } });
    return { v: w ? s / w : null, cover: all ? w / all : 0 };
  }

  /* the point's NHDPlus V2 COMID (USGS NLDI, the reach nearest the point) */
  async function comidAt(lat, lon) {
    const j = await fetchJSON(`${NLDI}/comid/position?coords=${encodeURIComponent(`POINT(${lon.toFixed(5)} ${lat.toFixed(5)})`)}`, {}, 30000);
    const p = ((j.features || [])[0] || {}).properties || {};
    const c = num(p.comid !== undefined ? p.comid : p.identifier);
    if (!ok(c)) throw new Error("NLDI found no NHDPlus V2 reach here");
    return c;
  }
  /* R per COMID: data/states/XX/rfactor.json (tools/build_basins.py). COMIDs sorted, the first and the steps between
     them; q = round(100 ln R), the first and the changes, zigzag-coded. Base 32, high digits first: a digit that ends a
     number is one of 0-9a-v, one before it of A-Z!#$%&* */
  const FIN = "0123456789abcdefghijklmnopqrstuv", CON = "ABCDEFGHIJKLMNOPQRSTUVWXYZ!#$%&*", DIG = new Int16Array(128).fill(-1);
  [...FIN].forEach((ch, i) => { DIG[ch.charCodeAt(0)] = i; });
  [...CON].forEach((ch, i) => { DIG[ch.charCodeAt(0)] = 32 + i; });
  function unb32(s, n) {
    const out = new Float64Array(n);
    let v = 0, k = 0;
    for (let i = 0; i < s.length && k < n; i++) { const d = DIG[s.charCodeAt(i)]; if (d >= 32) v = v * 32 + d - 32; else if (d >= 0) { out[k++] = v * 32 + d; v = 0; } }
    return out;
  }
  const rFiles = new Map();
  const rFile = st => {
    if (!rFiles.has(st)) rFiles.set(st, fetchJSON(`data/states/${st}/rfactor.json?v=${V}`, {}, 30000).then(j => {
      const n = j.n, ids = new Float64Array(n), q = new Float64Array(n), dc = unb32(j.c, n - 1), dq = unb32(j.q, n);
      ids[0] = j.c0;
      for (let i = 1; i < n; i++) ids[i] = ids[i - 1] + dc[i - 1];
      for (let i = 0, z = 0; i < n; i++) { const d = dq[i] % 2 ? -(dq[i] + 1) / 2 : dq[i] / 2; z = i ? z + d : d; q[i] = z; }
      return { ids, q, src: j.src };
    }, e => { rFiles.delete(st); throw e; }));
    return rFiles.get(st);
  };
  // StreamCat lists no COMID under DC, so no DC file is built (asking for it would only log a 404): its neighbours' files hold its catchments
  const R_IN = { DC: ["MD", "VA"] };
  async function rAt(st, comid) {
    for (const s of R_IN[st] || [st]) {
      const f = await rFile(s).catch(() => null);
      if (!f) continue;
      let a = 0, b = f.ids.length - 1;
      while (a <= b) { const m = (a + b) >> 1; if (f.ids[m] === comid) return { R: Math.exp(f.q[m] / 100), st: s }; if (f.ids[m] < comid) a = m + 1; else b = m - 1; }
    }
    return null;
  }
  /* NOAA Atlas 14 24-hour depths (mm) at the point from data/states/XX/atlas14.json: the 0.05° cell, or the nearest of its
     neighbours with a value (a point at the state's edge). Only the states in A14 have the file (tools/build_basins.py
     atlas14 XX, then add XX here): elsewhere nothing is asked, as a missing file would log a 404 at every point. */
  const A14 = new Set(["TX"]);
  const a14Files = new Map();
  const a14File = st => { if (!a14Files.has(st)) a14Files.set(st, fetchJSON(`data/states/${st}/atlas14.json?v=${V}`, {}, 20000).catch(() => null)); return a14Files.get(st); };
  function a14At(j, lat, lon) {
    const at = (k, r, c) => { const row = (j.p[k] || [])[r]; if (!row || !row.length || c < row[0] || c > row[0] + row.length - 2) return null; let v = row[1]; for (let i = 2; i <= c - row[0] + 1; i++) v += row[i]; return v; };
    const c0 = Math.round((lon - j.x0) / j.d), r0 = Math.round((lat - j.y0) / j.d);
    for (const [dr, dc] of [[0, 0], [0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const v = Object.fromEntries(Object.keys(j.p).map(k => [k, at(k, r0 + dr, c0 + dc)]));
      if (Object.values(v).every(ok)) return v;
    }
    return null;
  }

  /* ---------- the methods' tables ---------- */
  // TR-55 Table 2-2 curve numbers for each NLCD 2021 class, hydrologic soil groups A-D; open water and ice are left out;
  // wetlands, which the table lacks, take 78 for every group (an assumed value, labelled so)
  const CN = { 21: [49, 69, 79, 84], 22: [61, 75, 83, 87], 23: [77, 85, 90, 92], 24: [89, 92, 94, 95], 31: [77, 86, 91, 94], 41: [36, 60, 73, 79], 42: [36, 60, 73, 79], 43: [36, 60, 73, 79],
    52: [35, 56, 70, 77], 71: [49, 69, 79, 84], 81: [39, 61, 74, 80], 82: [67, 78, 85, 89], 90: [78, 78, 78, 78], 95: [78, 78, 78, 78] };
  const CN_AS = { 21: "open space, fair", 22: "residential, 1/4 ac lots (38% impervious)", 23: "residential, 1/8 ac lots (65%)", 24: "commercial (85%)", 31: "fallow, bare soil", 41: "woods, fair", 42: "woods, fair", 43: "woods, fair",
    52: "brush, fair", 71: "pasture or range, fair", 81: "pasture, good", 82: "row crops, straight row, good", 90: "wetland: not in TR-55, 78 assumed", 95: "wetland: not in TR-55, 78 assumed" };
  // RUSLE cover factor C by NLCD class: mid values of the literature ranges (cropland's is the user's, 0.24 by default)
  const C_OF = { 21: 0.005, 22: 0.003, 23: 0.001, 24: 0, 31: 0.45, 41: 0.003, 42: 0.003, 43: 0.003, 52: 0.025, 71: 0.03, 81: 0.035, 82: null, 90: 0.003, 95: 0.003 };
  const C_RANGE = { 21: "0.003–0.01", 22: "about 0", 23: "about 0", 24: "0", 31: "0.3–0.6", 41: "0.001–0.005", 42: "0.001–0.005", 43: "0.001–0.005", 52: "0.01–0.04", 71: "0.01–0.05", 81: "0.02–0.05", 82: "0.2–0.3 (yours)", 90: "about 0.003", 95: "about 0.003" };
  const HSG = ["A", "B", "C", "D"];
  // SCS runoff (mm) of a P mm storm on a CN: S = 25400/CN - 254, Ia = 0.2 S
  const scsQ = (P, cn) => { const S = 25400 / cn - 254, Ia = 0.2 * S; return P > Ia ? (P - Ia) ** 2 / (P - Ia + S) : 0; };
  // mean annual runoff classes (mm/yr) of the catchments on the map
  const RUN = { lims: [10, 25, 50, 100, 200, 400, 800], colors: ["#ffffd9", "#edf8b1", "#c7e9b4", "#7fcdbb", "#41b6c4", "#1d91c0", "#225ea8", "#0c2c84"],
    labels: ["< 10", "10–25", "25–50", "50–100", "100–200", "200–400", "400–800", "≥ 800"] };
  const runColor = v => (ok(v) ? RUN.colors[RUN.lims.filter(l => v >= l).length] : "#bdbdbd");

  /* the user's choices, kept on this device: the storm, cropland's C and the support practice P */
  const pick = { storm: "2", cropC: 0.24, P: 1, ...(WG.util.cache.get("basins") || {}) };
  if (!["2", "10", "100", "own"].includes(pick.storm)) pick.storm = "2";
  if (!ok(pick.cropC) || pick.cropC < 0 || pick.cropC > 1) pick.cropC = 0.24;
  if (!ok(pick.P) || pick.P < 0 || pick.P > 1) pick.P = 1;
  const keep = () => WG.util.cache.set("basins", { storm: pick.storm === "own" ? "2" : pick.storm, cropC: pick.cropC, P: pick.P });

  /* ---------- the map overlay: the HU12, its catchments by runoff, its flowlines and the upstream outline ----------
     on the map while the Soil maps theme is on and the point is the same; off when the theme changes (back when it
     returns, the tab is not drawn again), gone with a new point */
  let shown = null, timer = null;
  function sync() {
    if (!shown) return;
    const m = WG.map;
    if (!WG.state.site || WG.state.token !== shown.tok) { m.removeLayer(shown.g); shown = null; clearInterval(timer); timer = null; return; }
    const want = WG.state.theme === "soilmaps";
    if (want !== m.hasLayer(shown.g)) { if (want) shown.g.addTo(m); else m.removeLayer(shown.g); }
  }
  function overlay(M) {
    if (shown && shown.tok !== M.tok) { WG.map.removeLayer(shown.g); shown = null; }
    if (!shown) { shown = { tok: M.tok, g: L.layerGroup(), cv: L.canvas({ padding: 0.3 }) }; shown.g.addTo(WG.map); }
    if (!timer) timer = setInterval(sync, 500);
    const g = shown.g, cv = shown.cv;
    g.clearLayers();
    if (M.net) {
      M.net.cats.forEach(c => L.polygon(ll(c.rings), { renderer: cv, color: c.here ? "#d7301f" : c.up ? "#e6550d" : "#4d4d4d", weight: c.here ? 3 : c.up ? 1.8 : 0.5, opacity: 0.9,
        fillColor: c.sink ? "#d9d9d9" : runColor(c.mm), fillOpacity: c.inHu ? 0.6 : 0.25, dashArray: c.sink ? "3 3" : null })
        .bindTooltip(`${c.here ? "<b>The point's catchment</b><br>" : c.up ? "Upstream of the point<br>" : ""}${c.a && c.a.gnis_name ? `${esc(c.a.gnis_name)}<br>` : ""}NHDPlus HR catchment ${c.id}<br>${fmt(c.area, 2)} km² · ${c.sink ? "drains to a sink: no EROM runoff" : `runoff ${fmt(c.mm, 1)} mm/yr (model)`}`, { sticky: true })
        .addTo(g));
      M.net.flows.forEach(f => { const o = num(f.attributes.streamorde) || 1, s = ORD.find(x => o <= x[0]) || ORD[3]; if (f.geometry && f.geometry.paths) L.polyline(ll(f.geometry.paths), { renderer: cv, color: s[1], weight: s[2] * 1.6, opacity: 0.95, interactive: false }).addTo(g); });
    }
    if (M.nldi) L.geoJSON(M.nldi, { renderer: cv, style: { color: "#111", weight: 2, dashArray: "6 4", fill: false }, interactive: false }).addTo(g);
    L.polygon(ll(M.hu.rings), { renderer: cv, color: "#3f007d", weight: 3, fill: false, interactive: false }).addTo(g);
  }

  /* ---------- the tab's part ---------- */
  let M = null; // what the part shows now: its data and its own live()
  const T = () => SM.tables();
  const box = id => (M && M.live() ? M.el.querySelector(`#${id}`) : null);
  const kv = items => `<div class="wx-kv">${items.filter(Boolean).map(([k, v, s]) => `<div><span>${k}</span><b>${v}</b><span>${s || ""}</span></div>`).join("")}</div>`;
  const P_U = v => UN.fmt("precip", v), small = u => ` <small>${esc(u)}</small>`;
  const t2 = v => (ok(v) ? +v.toFixed(3) : null);

  // the HU12 and its catchments
  function drawNet() {
    const x = box("bsNet");
    if (!x) return;
    const N = M.net, hu = M.hu, h = N && N.here;
    if (M.err.net) { x.innerHTML = `<p class="fine">Could not read the NHDPlus HR network: ${esc(M.err.net.message || String(M.err.net))}. Pick the location again to retry.</p>`; return; }
    if (!N) { x.innerHTML = `<p class="fine">Reading the NHDPlus HR flowlines and catchments inside the HU12 (about 5 s)…</p>`; return; }
    const ha = h && h.a, legend = `<div class="bs-leg">${RUN.colors.map((c, i) => `<span><i style="background:${c}"></i>${RUN.labels[i]}</span>`).join("")}<span><i class="sink"></i>drains to a sink</span><span><i class="here"></i>the point's catchment</span><span><i class="up"></i>upstream</span></div>`;
    x.innerHTML = `${kv([
      ["HU12 mean annual runoff", ok(N.huMm) ? `${fmt(N.huMm, 1)}${small("mm/yr")}` : "—", ok(N.huMm) ? `${P_U(N.huMm)}/yr over ${fmt(N.runKm2, 1)} km² that drain to streams` : "no EROM runoff"],
      ["The point's catchment", h ? (h.sink ? "sink" : `${fmt(h.mm, 1)}${small("mm/yr")}`) : "—", h ? `${fmt(h.area, 2)} km²${ha && ha.gnis_name ? ` · ${esc(ha.gnis_name)}` : ""}` : "the point is in no catchment read"],
      ha && ["Mean annual flow here", `${fmt(num(ha.qama), num(ha.qama) < 10 ? 2 : 1)}${small("cfs")}`, `${fmt(num(ha.qama) * 0.0283168, 3)} m³/s · drainage area ${fmt(num(ha.totdasqkm), 1)} km²`],
      h && ["Upstream in this HU12", `${N.upN + 1}${small(N.upN ? "catchments" : "catchment")}`, `${fmt(N.upKm2, 1)} km²${ok(N.upMm) ? ` · runoff ${fmt(N.upMm, 1)} mm/yr` : ""}`],
    ])}
      ${legend}
      <p class="fine">${N.cats.filter(c => c.inHu).length} NHDPlus HR catchments in the HU12: ${N.nRun} drain to the stream network (${fmt(N.runKm2, 1)} km²)${N.nSink ? `, ${N.nSink} to sinks such as playas and stock ponds (${fmt(N.sinkKm2, 1)} km², no runoff in EROM)` : ""}; the HU12 is ${fmt(hu.km2, 1)} km². Upstream catchments are traced through the flowlines' hydrologic sequence (hydroseq) inside this HU12 only${ha && num(ha.totdasqkm) > N.upKm2 * 1.05 ? `; the stream here also gathers water from upstream HU12s (its whole drainage area is ${fmt(num(ha.totdasqkm), 1)} km²)` : ""}.
      <button class="link" data-bs-act="zoom">Zoom to the HU12</button> · <button class="link" data-bs-act="nldi">${M.nldi ? "Upstream basin drawn" : "Draw the whole upstream basin (USGS NLDI)"}</button>${M.nldiNote ? ` · ${M.nldiNote}` : ""} · <button class="link" data-sm-csv="basin_catchments">catchments (CSV)</button> · Maps: ${SM.showBtn("wbd", "watershed boundaries")} · ${SM.showBtn("flow", "streams")}</p>
      <p class="fine"><b>Model values, not measured:</b> mean annual runoff generated in each catchment by NHDPlus HR's flow estimates (EROM step A: the McCabe-Wolock monthly water-balance model, 1971–2000 climate), 893.6 × qincrama (cfs) ÷ area (km²) = mm/yr; the HU12's is the sum over its stream catchments. Other models can differ by a factor of two here (EPA StreamCat's runoff on the NHDPlus V2 network is one); check against a stream gauge before relying on it. ${HR_CREDIT}; catchments read by id, coloured on the map.</p>`;
  }
  // the design storm and its runoff by the curve number
  function cnModel() {
    const S = M.soils, LC = M.lc, P = M.P;
    if (!S || !LC || !ok(P)) return null;
    const hs = Object.fromEntries(HSG.map(g => [g, S.filter(c => c.hsg === g).reduce((s, c) => s + c.w, 0)])), known = HSG.reduce((s, g) => s + hs[g], 0), all = S.reduce((s, c) => s + c.w, 0);
    if (!known) return { noHsg: true };
    const h = Object.fromEntries(HSG.map(g => [g, hs[g] / known]));
    const cls = WG.landcover.CLASSES.map((c, i) => ({ code: c[0], name: c[1], color: c[2], km2: LC.km2[i] })).filter(c => CN[c.code] && c.km2 > 0);
    const land = cls.reduce((s, c) => s + c.km2, 0);
    if (!land) return { noLand: true };
    cls.forEach(c => { c.share = c.km2 / land; c.cnMix = HSG.reduce((s, g, i) => s + h[g] * CN[c.code][i], 0); c.q = HSG.reduce((s, g, i) => s + h[g] * scsQ(P, CN[c.code][i]), 0); });
    const cn = cls.reduce((s, c) => s + c.share * c.cnMix, 0), q = cls.reduce((s, c) => s + c.share * c.q, 0);
    return { h, hsgCover: all ? known / all : 0, cls, land, cn, q, qAtCn: scsQ(P, cn), water: LC.km2.reduce((s, v, i) => s + (CN[WG.landcover.CLASSES[i][0]] ? 0 : v), 0) };
  }
  const storm = () => (M.a14 ? pick.storm : "own"); // without an Atlas 14 grid, the depth is typed
  const stormP = () => (storm() !== "own" ? M.a14[storm()] : M.own);
  function drawCn() {
    const x = box("bsCnOut");
    if (!x) return;
    M.P = stormP();
    const miss = [!M.soils && !M.err.soils && "the soil survey's hydrologic groups", !M.lc && !M.err.lc && "the HU12's land cover"].filter(Boolean);
    if (M.err.soils || M.err.lc) { x.innerHTML = `<p class="fine">Could not read ${esc([M.err.soils && "the soil survey (SDA)", M.err.lc && "the land cover (MRLC)"].filter(Boolean).join(" or "))}: ${esc((M.err.soils || M.err.lc).message || "")}. Pick the location again to retry.</p>`; return; }
    if (miss.length) { x.innerHTML = `<p class="fine">Reading ${esc(miss.join(" and "))}…</p>`; return; }
    if (M.a14 === undefined) { x.innerHTML = `<p class="fine">Reading the NOAA Atlas 14 depths…</p>`; return; }
    if (!ok(M.P)) { x.innerHTML = `<p class="fine">Type the storm's 24-hour depth above (NOAA's point estimate: ${pfds()}).</p>`; return; }
    const R = cnModel();
    if (!R || R.noHsg || R.noLand) { x.innerHTML = `<p class="fine">${R && R.noLand ? "The HU12 has no land cover with a curve number (all water)." : "The soil survey gives no hydrologic group in this HU12."}</p>`; return; }
    const vol = (R.q / 1000) * R.land * 1e6;
    M.cn = R;
    T().basin_landcover = { title: `Land cover and curve numbers, HU12 ${M.hu.huc12} (NLCD 2021; TR-55 Table 2-2; ${fmt(M.P, 0)} mm storm)`,
      header: ["NLCD code", "NLCD class", "Share of land (%)", "Area (km2)", "TR-55 cover type", "CN A", "CN B", "CN C", "CN D", "CN for the HU12's soil groups", `Runoff Q for ${r0(M.P)} mm (mm)`, "RUSLE C", "C literature range"],
      rows: R.cls.map(c => [c.code, c.name, t2(100 * c.share), t2(c.km2), CN_AS[c.code], ...CN[c.code], t2(c.cnMix), t2(c.q), c.code === 82 ? pick.cropC : C_OF[c.code], C_RANGE[c.code]]) };
    x.innerHTML = `${kv([
      ["Storm", P_U(M.P), `24-hour, ${storm() !== "own" ? `${storm()}-year (NOAA Atlas 14)` : "your depth"}`],
      ["Curve number", fmt(R.cn, 1), `area-weighted, land only`],
      ["Runoff", P_U(R.q), `${fmt((100 * R.q) / M.P, 0)}% of the rain`],
      ["Volume", `${fmt(vol / 1233.48, 0)}${small("ac-ft")}`, `${fmt(vol / 1e6, 2)} million m³ from ${fmt(R.land, 1)} km² of land`],
    ])}
      <h4 class="sm-h">Land cover in the HU12 and its curve numbers</h4>
      ${SM.grid([SM.th("Land cover", "NLCD 2021"), SM.th("Share", "% of land"), SM.th("CN", "A · B · C · D"), SM.th("CN here", "soil mix"), SM.th("Runoff", UN.sym("precip"))],
        R.cls.filter(c => c.share >= 0.001).map(c => [`<i class="bs-sw" style="background:${c.color}"></i>${esc(c.name)}`, fmt(100 * c.share, 1), CN[c.code].join(" · "), fmt(c.cnMix, 1), UN.num("precip", c.q)]))}
      <p class="fine">Hydrologic soil groups in the HU12 (SSURGO, area-weighted, dual groups as undrained): ${HSG.map(g => `${g} ${fmt(100 * R.h[g], 0)}%`).join(" · ")}${R.hsgCover < 0.995 ? `; ${fmt(100 * (1 - R.hsgCover), 0)}% of the area has no group (urban land, water, pits) and is left out` : ""}. ${R.water > 0.005 ? `Open water (${fmt(R.water, 1)} km²) is left out. ` : ""}<button class="link" data-sm-csv="basin_landcover">land cover table (CSV)</button></p>
      <p class="fine"><b>Method:</b> SCS curve number (NRCS TR-55, 1986): Q = (P − Ia)² ÷ (P − Ia + S), S = 1000/CN − 10 in, Ia = 0.2 S, with the curve numbers of TR-55 Table 2-2 for average wetness (AMC II) for each NLCD 2021 class (wetlands, which the table lacks, 78 assumed; MRLC WCS, counted in 30 m cells inside the HU12) and soil group. Runoff is worked out for each land cover and soil group and then averaged (Q is not linear in CN; at the mean CN it would be ${P_U(R.qAtCn)}). Land cover and soils are taken as independent inside the HU12 (no cell-by-cell overlay). <b>Limits:</b> an event method for one storm on average wetness, not a forecast or a yearly total; crude for cracking clays such as the Vertisols of the Blackland Prairie, and for frozen or very wet ground.</p>`;
    summary();
  }
  // the soil loss by RUSLE
  function drawRusle() {
    const x = box("bsRusleOut");
    if (!x) return;
    if (M.err.soils || M.err.lc) { x.innerHTML = `<p class="fine">Could not read ${esc([M.err.soils && "the soil survey (SDA)", M.err.lc && "the land cover (MRLC)"].filter(Boolean).join(" or "))}. Pick the location again to retry.</p>`; return; }
    const miss = [!M.soils && "the soil survey's K, slope and slope length", !M.lc && "the land cover", M.R === undefined && "the R factor (NLDI, RF7100)"].filter(Boolean);
    if (miss.length) { x.innerHTML = `<p class="fine">Reading ${esc(miss.join(", "))}…</p>`; return; }
    const S = M.soils, K = wmean(S, c => c.K), Ls = wmean(S, c => c.LS), KLS = wmean(S, c => (ok(c.K) && ok(c.LS) ? c.K * c.LS : null)), Tf = wmean(S, c => c.T);
    const cls = WG.landcover.CLASSES.map((c, i) => ({ code: c[0], name: c[1], km2: M.lc.km2[i] })).filter(c => c.code in C_OF && c.km2 > 0), land = cls.reduce((s, c) => s + c.km2, 0);
    const cOf = c => (c.code === 82 ? pick.cropC : C_OF[c.code]), C = land ? cls.reduce((s, c) => s + (c.km2 / land) * cOf(c), 0) : null, crop = cls.find(c => c.code === 82);
    const R = M.Rv, P = pick.P, okAll = ok(R) && ok(KLS.v) && ok(C);
    const A = okAll ? R * KLS.v * C * P : null, Ac = ok(R) && ok(KLS.v) ? R * KLS.v * pick.cropC * P : null, tons = ok(A) ? A * land * 247.105 : null;
    M.rusle = { R, K, Ls, KLS, Tf, C, P, A, Ac, land, tons, crop };
    const ta = v => (ok(v) ? `${fmt(v, v < 10 ? 2 : 1)}${small("t/ac/yr")}` : "—"), th_ = v => (ok(v) ? `${fmt(v * 2.2417, v * 2.2417 < 10 ? 2 : 1)} t/ha/yr` : "");
    const pct = v => `${fmt(100 * v, 0)}% of the area`;
    const rows = [
      ["R, rainfall erosivity", ok(R) ? fmt(R, 1) : "—", "hundreds ft·tonf·in/(ac·h·yr)", ok(R) ? fmt(R * 17.02, 0) : "—", "MJ·mm/(ha·h·yr)", M.Rsrc || "", ""],
      ["K, soil erodibility", ok(K.v) ? fmt(K.v, 3) : "—", "t·ac·h/(hundreds·ac·ft·tonf·in)", ok(K.v) ? fmt(K.v * 0.1317, 4) : "—", "t·ha·h/(ha·MJ·mm)", "SSURGO surface horizon Kw (Kf where Kw is blank), by component and map-unit area", pct(K.cover)],
      ["LS, slope length and steepness", ok(Ls.v) ? fmt(Ls.v, 3) : "—", "", "", "", "SSURGO slope and USLE slope length of each component; S of McCool et al. (1987), L exponent by slope class", pct(Ls.cover)],
      ["K × LS, averaged by component", ok(KLS.v) ? fmt(KLS.v, 4) : "—", "", "", "", "the product of each component's K and LS, then averaged (used for A)", pct(KLS.cover)],
      ["C, cover and management", ok(C) ? fmt(C, 3) : "—", "", "", "", `NLCD 2021 classes with literature C values; cropland ${pick.cropC}`, `${fmt(land, 1)} km² of land`],
      ["P, support practice", fmt(P, 2), "", "", "", "1 = no contouring, strips or terraces (your choice)", ""],
    ];
    T().basin_rusle = { title: `RUSLE soil loss, HU12 ${M.hu.huc12} (gross sheet and rill erosion)`, header: ["Factor", "Value (US)", "US unit", "Value (SI)", "SI unit", "Source", "Coverage"],
      rows: [...rows.map(r => r.map((v, i) => (i === 1 || i === 3 ? num(String(v).replace(/,/g, "")) : v))),
        ["A, all land", t2(A), "t/ac/yr", t2(ok(A) ? A * 2.2417 : null), "t/ha/yr", "R × (K × LS) × C × P", ""], ["A, cropland", t2(Ac), "t/ac/yr", t2(ok(Ac) ? Ac * 2.2417 : null), "t/ha/yr", `the same with C = ${pick.cropC}`, crop ? `${fmt(crop.km2, 1)} km² of cropland` : "no cropland"],
        ["T, tolerable soil loss", t2(Tf.v), "t/ac/yr", t2(ok(Tf.v) ? Tf.v * 2.2417 : null), "t/ha/yr", "SSURGO tfact, by component and map-unit area", pct(Tf.cover)],
        ["A / T, all land", t2(ok(A) && Tf.v ? A / Tf.v : null), "", "", "", "", ""], ["Soil moved each year, all land", t2(tons), "short tons/yr", t2(ok(tons) ? tons * 0.90718 : null), "t/yr", "A × the HU12's land area", ""]] };
    T().basin_soils = { title: `Soil components in HU12 ${M.hu.huc12} (SSURGO by SDA)`, header: ["Map unit", "Map unit name", "Map unit share of HU12 (%)", "Component", "Component (%)", "Kind", "Major", "Hydrologic group", "K", "K source", "Slope (%)", "USLE slope length (m)", "L", "S", "LS", "T (t/ac/yr)"],
      rows: S.map(c => [c.sym, c.mu, t2(100 * c.muShare), c.name, c.pct, c.kind || "", c.major ? "yes" : "no", c.hydgrp || "", c.K, c.kSrc === "kw" ? "Kw" : c.kSrc === "kf" ? "Kf" : "", c.slope, c.lam, t2(c.L), t2(c.S), t2(c.LS), c.T]) };
    const noR = !ok(R) ? `<p class="fine"><b>No R factor${ok(M.comid) ? ` for NHDPlus V2 COMID ${M.comid}` : ""}</b>${M.err.R ? ` (${esc(M.err.R.message || String(M.err.R))})` : ""}: type one above (US units; the USGS RF7100 grid or NRCS AH 703's isoerodent maps).</p>` : "";
    x.innerHTML = `${noR}${kv([
      ["Soil loss, all land", ta(A), th_(A)],
      crop && ["Cropland", ta(Ac), `${th_(Ac)} · C ${pick.cropC}`],
      ["Compared with T", ok(A) && Tf.v ? `${fmt(A / Tf.v, A / Tf.v < 1 ? 2 : 1)}${small("× T")}` : "—", ok(Tf.v) ? `T ${fmt(Tf.v, 1)} t/ac/yr (survey)${crop && ok(Ac) ? ` · cropland ${fmt(Ac / Tf.v, 1)} × T` : ""}` : ""],
      ["Soil moved each year", ok(tons) ? `${fmt(tons / 1000, tons < 1e4 ? 1 : 0)}${small("thousand t")}` : "—", ok(tons) ? `short tons from ${fmt(land * 247.105, 0)} ac of land` : ""],
    ])}
      <h4 class="sm-h">The factors</h4>
      ${SM.grid([SM.th("Factor"), SM.th("Value", "US units"), SM.th("SI"), SM.th("Source"), SM.th("Covers")], rows.map(r => [esc(r[0]), `${r[1]}${r[2] ? ` <small>${esc(r[2])}</small>` : ""}`, r[3] ? `${r[3]} <small>${esc(r[4])}</small>` : "", esc(r[5]), esc(r[6])]))}
      <p class="fine">A = R × K × LS × C × P (RUSLE, USDA Agriculture Handbook 703) in short tons per acre per year; × 2.2417 = metric tonnes per hectare. K and LS are taken together for each soil component, and land cover as independent of the soils inside the HU12. <button class="link" data-sm-csv="basin_soils">soil components (CSV)</button> · <button class="link" data-sm-csv="basin_rusle">factors (CSV)</button></p>
      <p class="fine"><b>Limits:</b> gross sheet and rill erosion on the slopes, a long-term yearly average; not gullies, stream banks or channels, and not the sediment that leaves the HU12 (only part of it reaches the stream). LS comes from the survey's representative slope and slope length for each soil, not from a terrain model; C from land-cover classes is coarse (crops, residue and tillage change it ten-fold, so set cropland's C from your rotation); RUSLE fits rangeland, urban land and wetlands poorly. R: USGS RF7100 (Wieczorek & LaMotte 2010; the PRISM-based 1971–2000 R of Daly & Taylor) for the point's NHDPlus V2 catchment (USGS NLDI), kept to 1%.</p>`;
    summary();
  }
  // the part's summary table: every result so far, with its unit and source
  function summary() {
    if (!M || !M.live()) return;
    const hu = M.hu, N = M.net, C = M.cn, R = M.rusle, rows = [
      ["HU12", hu.huc12, "", "USGS Watershed Boundary Dataset"], ["HU12 name", hu.name, "", ""], ["HU12 area", t2(hu.km2), "km2", ""], ["Flows to HU12", hu.tohuc || "", "", ""],
      ["Point", `${M.lat.toFixed(5)}, ${M.lon.toFixed(5)}`, "lat, lon", ""]];
    if (N) rows.push(["HU12 mean annual runoff", t2(N.huMm), "mm/yr", "NHDPlus HR EROM step A (model), stream catchments"], ["Area draining to streams", t2(N.runKm2), "km2", ""], ["Area draining to sinks", t2(N.sinkKm2), "km2", ""],
      ["Point's NHDPlus HR catchment", N.here ? String(N.here.id) : "", "", ""], ["Point's catchment runoff", N.here ? t2(N.here.mm) : null, "mm/yr", "EROM step A (model)"], ["Point's reach mean annual flow", N.here && N.here.a ? t2(num(N.here.a.qama)) : null, "cfs", "EROM step A (model)"],
      ["Point's drainage area", N.here && N.here.a ? t2(num(N.here.a.totdasqkm)) : null, "km2", "NHDPlus HR VAA"], ["Upstream catchments in the HU12 (with the point's)", N.here ? N.upN + 1 : null, "", "hydroseq"], ["Upstream area in the HU12", N.here ? t2(N.upKm2) : null, "km2", ""]);
    if (C && ok(M.P)) rows.push(["Storm depth, 24 h", t2(M.P), "mm", storm() !== "own" ? `NOAA Atlas 14, ${storm()}-yr` : "typed"], ["Curve number (area-weighted)", t2(C.cn), "", "TR-55, NLCD 2021 x SSURGO groups"], ["Storm runoff Q", t2(C.q), "mm", "per land cover and soil group, averaged"],
      ["Storm runoff volume", t2((C.q / 1000) * C.land * 1e6), "m3", ""], ...HSG.map(g => [`Hydrologic group ${g}`, t2(100 * C.h[g]), "% of area with a group", "SSURGO"]));
    if (R) rows.push(["NHDPlus V2 COMID", ok(M.comid) ? String(M.comid) : "", "", "USGS NLDI"], ["R", t2(R.R), "hundreds ft-tonf-in/(ac-h-yr)", "USGS RF7100"], ["K", t2(R.K.v), "US", "SSURGO"], ["LS", t2(R.Ls.v), "", "SSURGO slope, slope length"], ["C", t2(R.C), "", "NLCD 2021"], ["P", R.P, "", "user"],
      ["Soil loss A, all land", t2(R.A), "t/ac/yr", "RUSLE, gross sheet and rill"], ["Soil loss A, all land", t2(ok(R.A) ? R.A * 2.2417 : null), "t/ha/yr", ""], ["Soil loss A, cropland", t2(R.Ac), "t/ac/yr", `C = ${pick.cropC}`], ["T", t2(R.Tf.v), "t/ac/yr", "SSURGO tfact"]);
    if (ok(M.nldiKm2)) rows.push(["Whole upstream basin (NHDPlus V2)", t2(M.nldiKm2), "km2", `USGS NLDI basin of COMID ${M.nldiComid}, not split at the point`]);
    T().basin = { title: `Basin: runoff and soil loss, HU12 ${hu.huc12} ${hu.name}`, header: ["Quantity", "Value", "Unit", "Source"], rows };
  }
  const r0 = v => (ok(v) ? Math.round(v) : "");
  const pfds = () => `<a href="https://hdsc.nws.noaa.gov/pfds/pfds_printpage.html?lat=${M.lat.toFixed(4)}&lon=${M.lon.toFixed(4)}&data=depth&units=english&series=pds" target="_blank" rel="noopener">NOAA PFDS at this point</a>`;
  function stormControls() {
    const a = M.a14, opts = (a ? ["2", "10", "100"].map(k => [k, `${k}-year, 24-hour: ${P_U(a[k])} (Atlas 14)`]) : []).concat([["own", "Your depth"]]);
    const val = ok(stormP()) ? UN.num("precip", stormP()).replace(/,/g, "") : "";
    return `<div class="form-grid"><label>Storm<select data-bs="storm">${opts.map(([k, n]) => `<option value="${k}"${k === storm() ? " selected" : ""}>${esc(n)}</option>`).join("")}</select></label>
      <label>24-hour depth (${esc(UN.sym("precip"))})<input type="number" min="0" step="any" inputmode="decimal" data-bs="depth" value="${val}"></label></div>
      <p class="fine" style="margin-top:2px">${a ? `NOAA Atlas 14 depths at this point's 0.05° cell (partial-duration series, the mean of the 30″ cells it holds). ` : `No NOAA Atlas 14 grid is built for ${esc(M.st || "this state")} in this app: `}Check or copy the depth from ${pfds()}.</p>`;
  }
  const rusleControls = () => `<div class="form-grid"><label>R (US units)<input type="number" min="0" step="any" data-bs="R" value="${ok(M.Rv) ? +M.Rv.toFixed(1) : ""}" placeholder="${M.R === undefined ? "reading…" : "type R"}"></label>
      <label>Cropland C<input type="number" min="0" max="1" step="0.01" data-bs="cropC" value="${pick.cropC}"></label>
      <label>P, support practice<input type="number" min="0" max="1" step="0.05" data-bs="P" value="${pick.P}"></label></div>`;

  /* a new point in the same HU12 reuses its network, soils and land cover (kept for the visit, the last few HU12s) */
  const huSeen = new Map();
  const perHu = (huc, k, f) => {
    const m = huSeen.get(huc);
    if (!m[k]) m[k] = f().catch(e => { delete m[k]; throw e; });
    return m[k];
  };
  async function render(el, live, lat, lon) {
    const h0 = await Wx.once("bs:hu12", () => hu12At(lat, lon));
    if (!live()) return;
    if (h0 && !huSeen.has(h0.huc12)) { huSeen.set(h0.huc12, { hu: h0 }); if (huSeen.size > 6) huSeen.delete(huSeen.keys().next().value); }
    const hu = h0 && huSeen.get(h0.huc12).hu; // the same object, so js/landcover.js's count of its polygon is kept too
    if (!hu) { el.innerHTML = `<div class="card">${SM.head("Basin: runoff and soil loss", "")}<p class="fine">No 12-digit hydrologic unit (WBD) holds this point.</p></div>`; return; }
    const st = (WG.state.siteState || {}).code || "";
    if (pick.storm === "own") pick.storm = "2"; // a typed depth belongs to its point
    M = { el, live, tok: WG.state.token, hu, lat, lon, st, net: null, soils: null, lc: null, R: undefined, Rv: null, a14: undefined, own: null, err: {}, nldi: null };
    const me = M, mine = () => M === me && live();
    el.innerHTML = `<div class="card">${SM.head("Basin: watershed and mean annual runoff", "basin", `HU12 ${hu.huc12}`)}
        <p class="fine" style="margin-top:0"><b>${esc(hu.name)}</b>, HUC ${esc(hu.huc12)}: ${fmt(hu.km2, 1)} km² (${UN.fmt("area", hu.km2 * 1e6)}), flows to HU12 ${esc(hu.tohuc || "—")}. The small watershed (HU12) that holds the point, from the USGS Watershed Boundary Dataset, drawn on the map with its NHDPlus HR catchments while this theme is on.</p>
        <div id="bsNet"></div></div>
      <div class="card">${SM.head("Design-storm runoff (curve number)", "basin_landcover", "TR-55")}<div id="bsCnCtl"></div><div id="bsCnOut"></div></div>
      <div class="card">${SM.head("Soil loss (RUSLE)", "basin_rusle", "sheet and rill")}<div id="bsRusleCtl">${rusleControls()}</div><div id="bsRusleOut"></div></div>`;
    overlay(M);
    summary();
    drawNet(); drawCn(); drawRusle();
    const done = (k, f) => v => { if (!mine()) return; M[k] = v; f(); }, fail = (k, f) => e => { console.warn("basins", k, e); if (!mine()) return; M.err[k] = e instanceof Error ? e : new Error(String(e)); f(); };
    const both = () => { drawCn(); drawRusle(); };
    const jobs = [
      perHu(hu.huc12, "hr", () => hrIn(hu)).then(hr => { if (!mine()) return; M.net = network(hr, hu, lat, lon); overlay(M); drawNet(); summary(); T().basin_catchments = catTable(); }, fail("net", drawNet)),
      perHu(hu.huc12, "soils", () => soilsIn(hu)).then(done("soils", both), fail("soils", both)),
      WG.landcover.boundaryShares(hu.polys).then(done("lc", both), fail("lc", both)),
      (A14.has(st) ? a14File(st) : Promise.resolve(null)).then(j => { if (!mine()) return; M.a14 = j ? a14At(j, lat, lon) : null; const c = box("bsCnCtl"); if (c) c.innerHTML = stormControls(); drawCn(); }),
      Wx.once("bs:comid", () => comidAt(lat, lon)).then(async c => { const r = await rAt(st, c); if (!mine()) return; M.comid = c; M.R = r; M.Rv = r ? r.R : null; M.Rsrc = M.Rsrc0 = r ? `USGS RF7100, NHDPlus V2 COMID ${c} (NLDI)${r.st !== st ? `, ${r.st} file` : ""}` : ""; },
        e => { if (!mine()) return; M.err.R = e; M.R = null; }).then(() => { if (!mine()) return; const c = box("bsRusleCtl"); if (c) c.innerHTML = rusleControls(); drawRusle(); }),
    ];
    await Promise.allSettled(jobs);
  }
  function catTable() {
    const N = M.net;
    return { title: `NHDPlus HR catchments of HU12 ${M.hu.huc12}: mean annual runoff (EROM step A, model)`, header: ["NHDPlus ID", "Stream name", "Area (km2)", "qincrama (cfs)", "Runoff (mm/yr)", "Mean annual flow qama (cfs)", "Stream order", "Drainage area (km2)", "hydroseq", "dnhydroseq", "Drains to", "Inside the HU12", "At the point", "Upstream of the point"],
      rows: N.cats.map(c => [String(c.id), c.a ? c.a.gnis_name || "" : "", t2(c.area), c.a ? t2(num(c.a.qincrama)) : null, t2(c.mm), c.a ? t2(num(c.a.qama)) : null, c.a ? num(c.a.streamorde) : null, c.a ? t2(num(c.a.totdasqkm)) : null,
        c.a ? String(c.a.hydroseq) : "", c.a ? String(c.a.dnhydroseq || "") : "", c.sink ? "sink" : "stream", c.inHu ? "yes" : "no", c.here ? "yes" : "", c.up ? "yes" : ""]) };
  }

  /* the part's choices and buttons */
  function onInput(t) {
    if (!M || !M.live()) return;
    const k = t.dataset.bs, v = num(t.value);
    if (k === "storm") {
      pick.storm = t.value;
      const d = M.el.querySelector('[data-bs="depth"]');
      if (pick.storm !== "own" && d && M.a14) d.value = UN.num("precip", M.a14[pick.storm]).replace(/,/g, "");
      if (pick.storm === "own" && d) M.own = ok(num(d.value)) ? UN.back("precip", num(d.value)) : null;
      keep(); drawCn();
    } else if (k === "depth") {
      pick.storm = "own"; M.own = ok(v) && v > 0 ? UN.back("precip", v) : null;
      const s = M.el.querySelector('[data-bs="storm"]');
      if (s) s.value = "own";
      drawCn();
    } else if (k === "cropC" && ok(v) && v >= 0 && v <= 1) { pick.cropC = v; keep(); drawRusle(); drawCn(); }
    else if (k === "P" && ok(v) && v >= 0 && v <= 1) { pick.P = v; keep(); drawRusle(); }
    else if (k === "R") { M.Rv = ok(v) && v > 0 ? v : null; M.Rsrc = M.R && ok(M.Rv) && Math.abs(M.Rv - M.R.R) < 0.06 ? M.Rsrc0 : "typed by you"; drawRusle(); }
  }
  ["input", "change"].forEach(ev => document.addEventListener(ev, e => { const t = e.target.closest && e.target.closest("[data-bs]"); if (t) onInput(t); }));
  document.addEventListener("click", async e => {
    const b = e.target.closest && e.target.closest("[data-bs-act]");
    if (!b || !M || !M.live()) return;
    e.preventDefault();
    if (b.dataset.bsAct === "zoom") { WG.map.fitBounds(L.latLngBounds(ll(M.hu.rings).flat()), { padding: [24, 24] }); return; }
    if (b.dataset.bsAct === "nldi" && !M.nldi) {
      const me = M;
      b.textContent = "Reading the upstream basin from USGS NLDI…";
      try {
        const c = await Wx.once("bs:comid", () => comidAt(me.lat, me.lon));
        const j = await Wx.once("bs:nldi", () => fetchJSON(`${NLDI}/comid/${c}/basin?simplified=true&splitCatchment=false`, {}, 45000));
        if (M !== me || !me.live()) return;
        const g = ((j.features || [])[0] || {}).geometry;
        if (!g) throw new Error("NLDI returned no basin");
        const polys = g.type === "MultiPolygon" ? g.coordinates : [g.coordinates], km2 = polys.reduce((s, p) => s + km2Of(p), 0);
        me.nldi = j; me.nldiKm2 = km2; me.nldiComid = c;
        me.nldiNote = `the whole upstream basin (dashed): ${fmt(km2, km2 < 100 ? 1 : 0)} km² on the NHDPlus V2 network (COMID ${c}, the V2 catchment's outlet, not split at the point; USGS NLDI)`;
        overlay(me); drawNet(); summary();
        WG.map.fitBounds(L.geoJSON(j).getBounds(), { padding: [24, 24] });
      } catch (err) { console.warn("nldi", err); if (M === me) { b.textContent = "Draw the whole upstream basin (USGS NLDI)"; WG.util.toast(`USGS NLDI did not give the basin: ${err.message || err}`, 5000); } }
    }
  });

  SM.addPart({ key: "basin", wait: "the watershed (HU12) at the point", render });
  return { hu12At, hrIn, network, soilsIn, comidAt, rAt, rFile, a14At, ls, scsQ, CN, C_OF, RUN, A14 };
})();
