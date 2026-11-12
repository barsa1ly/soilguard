/* Soil maps: the map theme of soil chemistry and its panel tab. Map layers: soil pH, CEC and organic matter at four depths
   (the USDA Forest Service's image services built from gNATSGO, 30 m, drawn for each view), salinity and sodicity (UC Davis
   SoilWeb 800 m grids from SSURGO, pre-built per state by tools/build_soilmaps.py), total elements (the USGS soil
   geochemistry WMS from Data Series 801, one element at a time) and total nitrogen (the ISRIC SoilGrids WMS, a model).
   The tab gives, at the point, the survey's chemistry by depth (SSURGO through Soil Data Access), the Forest Service
   values, SoilGrids' total N, the nearest USGS sites and the nearest NRCS lab pedons (KSSL), each labelled for what it
   measures. No map covers the US for soil-test (plant-available) N, P, K, Ca, Mg or S, nor for boron: the tab says
   so. Loaded after weather.js, whose THEMES, layers and RENDER it joins, and before app.js, which builds the theme bar,
   the layer sheet and the legend from them. */
WG.soilmaps = (function () {
  const { $$, esc, fmt, fetchJSON, fetchText, compass } = WG.util;
  const Wx = WG.weather, UN = WG.units;
  const num = v => (v === null || v === undefined || v === "" || !Number.isFinite(+v) ? null : +v);
  const ok = v => v !== null && v !== undefined && Number.isFinite(v);
  const V = ((document.querySelector('script[src*="data/states.js"]') || {}).src || "").split("v=")[1] || "1"; // the state files' version, as app.js

  /* ---------- classes ---------- */
  /* pH: the Soil Survey Manual's reaction classes; values come to one decimal, so each limit sits halfway between */
  const PH = { lims: [4.45, 5.05, 5.55, 6.05, 6.55, 7.35, 7.85, 8.45, 9.05], min: 0.01,
    colors: ["#b30000", "#e34a33", "#fc8d59", "#fdbb84", "#fee8a0", "#a6d96a", "#66c2a5", "#3288bd", "#5e4fa2", "#2d004b"],
    labels: ["< 4.5  Extremely acid or below", "4.5–5.0  Very strongly acid", "5.1–5.5  Strongly acid", "5.6–6.0  Moderately acid", "6.1–6.5  Slightly acid",
      "6.6–7.3  Neutral", "7.4–7.8  Slightly alkaline", "7.9–8.4  Moderately alkaline", "8.5–9.0  Strongly alkaline", "> 9.0  Very strongly alkaline"] };
  const CEC = { lims: [5, 10, 15, 25, 40], min: 0.01, colors: ["#ffffcc", "#c7e9b4", "#7fcdbb", "#41b6c4", "#2c7fb8", "#253494"],
    labels: ["< 5  sands, few nutrients held", "5–10", "10–15", "15–25", "25–40", "≥ 40  clays, organic soils"] };
  const OM = { lims: [0.5, 1, 2, 4, 8, 20], min: 0, colors: ["#fff7bc", "#fee391", "#fec44f", "#fe9929", "#ec7014", "#cc4c02", "#8c2d04"],
    labels: ["< 0.5", "0.5–1", "1–2", "2–4", "4–8", "8–20", "≥ 20  organic soil material"] };
  const RXN = ["Extremely acid", "Very strongly acid", "Strongly acid", "Moderately acid", "Slightly acid", "Neutral", "Slightly alkaline", "Moderately alkaline", "Strongly alkaline", "Very strongly alkaline"];
  const reaction = v => (!ok(v) ? "" : v < 3.45 ? "Ultra acid" : RXN[PH.lims.filter(l => v >= l).length]);
  const SAL = ["Non-saline", "Very slightly saline", "Slightly saline", "Moderately saline", "Strongly saline"];
  const salinity = v => (ok(v) ? SAL[[2, 4, 8, 16].filter(l => v >= l).length] : "");
  // U.S. Salinity Laboratory (Handbook 60): saline at EC 4 dS/m or more; sodic at SAR 13 or ESP 15 or more
  function sodicity(ec, sar, esp) {
    const sod = (ok(sar) && sar >= 13) || (ok(esp) && esp >= 15), sal = ok(ec) && ec >= 4;
    if (!ok(sar) && !ok(esp)) return sal ? "Saline" : "";
    return sod ? (sal ? "Saline-sodic" : "Sodic") : sal ? "Saline" : "Not sodic";
  }

  /* ---------- the map's choices: depth of the 30 m maps, the element and its layer, the depth of total N ---------- */
  const DEPTHS = [[5, "0–5 cm"], [25, "5–25 cm"], [50, "25–50 cm"], [100, "50–100 cm"]];
  const ELS = [["P", "phosphorus"], ["K", "potassium"], ["Ca", "calcium"], ["Mg", "magnesium"], ["S", "sulfur"], ["Zn", "zinc"], ["Fe", "iron"], ["Mn", "manganese"], ["Cu", "copper"], ["Na", "sodium"]];
  const HZ = [["Top5", "top 0–5 cm"], ["A", "A horizon"], ["C", "C horizon"]];
  const SGD = ["0-5cm", "5-15cm", "15-30cm", "30-60cm", "60-100cm", "100-200cm"];
  const cmLabel = d => d.replace("-", "–").replace("cm", " cm");
  const pick = { depth: 5, el: "P", hz: "Top5", nd: "0-5cm", ...(WG.util.cache.get("soilmaps") || {}) }; // remembered on this device
  if (!DEPTHS.some(d => d[0] === pick.depth)) pick.depth = 5;
  if (!ELS.some(e => e[0] === pick.el)) pick.el = "P";
  if (!HZ.some(h => h[0] === pick.hz)) pick.hz = "Top5";
  if (!SGD.includes(pick.nd)) pick.nd = "0-5cm";
  const nameOf = (list, k) => (list.find(x => x[0] === k) || [k, k])[1];

  /* ---------- the Forest Service's 30 m maps, drawn for the view ---------- */
  const USFS = "https://imagery.geoplatform.gov/iipp/rest/services/Soil_Geology/";
  const SVC = { ph: ["USFS_pH", "pH", PH], cec: ["USFS_Cation_Exchange_Capacity_pH7", "CEC7", CEC], om: ["USFS_Organic_Material", "Organic_Material", OM] };
  const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  /* the server draws the classes (Remap to class numbers, then a Colormap), so the legend is exact; values outside them
     are left clear: 0, which the services hold where the survey has no value (except for organic matter, where 0 is real) */
  const rule = c => { const e = [c.min, ...c.lims, 1e6]; return { rasterFunction: "Colormap", variableName: "Raster", rasterFunctionArguments: { Colormap: c.colors.map((h, i) => [i + 1, ...rgb(h)]),
    Raster: { rasterFunction: "Remap", rasterFunctionArguments: { InputRanges: c.colors.flatMap((_, i) => [e[i], e[i + 1]]), OutputValues: c.colors.map((_, i) => i + 1), AllowUnmatched: false } } } }; };
  const usfsUrl = k => (bbox, w, h) => `${USFS}${SVC[k][0]}/ImageServer/exportImage?${new URLSearchParams({ bbox, bboxSR: 3857, imageSR: 3857, size: `${w},${h}`, format: "png", transparent: true, f: "image",
    renderingRule: JSON.stringify(rule(SVC[k][2])), mosaicRule: JSON.stringify({ multidimensionalDefinition: [{ variableName: SVC[k][1], dimensionName: "Depth", values: [pick.depth] }] }) })}`;
  /* one image of the whole view from an ArcGIS exportImage, asked again after each move; the old image stays until the
     new one has loaded, so a pan never shows a blank map */
  const ViewImage = L.Layer.extend({
    initialize(url, o) { this._url = url; this._o = o; this._op = 0.72; this._seq = 0; this._img = null; this._k = null; },
    onAdd(m) { m.on("moveend", this._go, this); this._go(); },
    onRemove(m) { m.off("moveend", this._go, this); this._seq++; if (this._img) m.removeLayer(this._img); this._img = null; },
    getAttribution() { return this._o.attribution; },
    setOpacity(o) { this._op = o; if (this._img) this._img.setOpacity(o); return this; },
    redraw() { if (this._map && this._k !== this._o.key()) this._go(); return this; }, // only when its choice (the depth) changed
    _go() {
      const m = this._map, b = m.getBounds(), s = m.getSize(), k = Math.min(2, window.devicePixelRatio || 1); // sharp on a dense screen, at most 4096 px a side (the server's limit is far above)
      const a = L.CRS.EPSG3857.project(b.getSouthWest()), z = L.CRS.EPSG3857.project(b.getNorthEast()), w = Math.min(4096, Math.round(s.x * k)), h = Math.min(4096, Math.round(s.y * k));
      if (w < 2 || h < 2) return;
      this._k = this._o.key();
      const my = ++this._seq, img = L.imageOverlay(this._url(`${a.x.toFixed(1)},${a.y.toFixed(1)},${z.x.toFixed(1)},${z.y.toFixed(1)}`, w, h), b, { pane: "thematic", opacity: 0, interactive: false });
      img.once("load", () => { if (my !== this._seq) { m.removeLayer(img); return; } if (this._img) m.removeLayer(this._img); this._img = img; img.setOpacity(this._op); });
      img.once("error", () => { m.removeLayer(img); if (my === this._seq && Date.now() - (this._warned || 0) > 60e3) { this._warned = Date.now(); WG.util.toast(`${this._o.name} could not be drawn: the Forest Service's map server did not answer. Move the map to try again.`, 5000); } });
      img.addTo(m);
    },
  });

  /* ---------- the statewide salinity images (data/states/XX/layer_soil_*.png), near the view, as app.js's OverlaySet ---------- */
  const StateSet = L.LayerGroup.extend({
    initialize(key) { L.LayerGroup.prototype.initialize.call(this); this._key = key; this._got = new Map(); this._op = 0.72; },
    onAdd(m) { L.LayerGroup.prototype.onAdd.call(this, m); m.on("moveend", this.fill, this); this.fill(); },
    onRemove(m) { m.off("moveend", this.fill, this); L.LayerGroup.prototype.onRemove.call(this, m); },
    setOpacity(o) { this._op = o; this.eachLayer(l => l.setOpacity(o)); return this; },
    fill() {
      if (!this._map || !WG.region) return this;
      const recs = WG.region.recs(), codes = new Set(recs.map(r => r.code)), view = this._map.getBounds().pad(0.5);
      for (const [c, l] of this._got) if (!codes.has(c)) { this.removeLayer(l); this._got.delete(c); } // a state taken off the map
      recs.forEach(r => {
        const f = r.overlays && r.overlays.files && r.overlays.files[this._key];
        if (!f || this._got.has(r.code) || !view.intersects(r.overlays.bounds)) return;
        const l = L.imageOverlay(`${f}?v=${V}`, r.overlays.bounds, { pane: "thematic", opacity: this._op, className: "thematic-img", interactive: false });
        this._got.set(r.code, l); this.addLayer(l);
      });
      return this;
    },
  });

  /* ---------- the WMS layers: USGS total elements and SoilGrids total N (512 px tiles: a quarter of the requests) ---------- */
  const USGS_WMS = "https://mrdata.usgs.gov/services/soils", ISRIC = "https://maps.isric.org/mapserv?map=/map/nitrogen.map";
  const wms = (url, layers, attribution) => L.tileLayer.wms(url, { layers, styles: "", format: "image/png", transparent: true, pane: "thematic", tileSize: 512, maxZoom: 19, attribution });
  const chemLayer = wms(USGS_WMS, `${pick.hz}_${pick.el}`, "USGS Data Series 801 (Smith et al. 2013)");
  const nLayer = wms(ISRIC, `nitrogen_${pick.nd}_mean`, "ISRIC SoilGrids 2.0 (CC BY 4.0)");
  // the SoilGrids nitrogen ramp, 33 steps of 38.66 cg/kg read from its legend graphic (the same at every depth)
  const N_RAMP = ["#f7fcf5", "#f7fcf5", "#f3fbf0", "#eef9eb", "#eaf7e6", "#e6f6e1", "#def3d9", "#d7f0d1", "#cfedc9", "#c8eac1", "#bee6b8", "#b5e2ae", "#abdea5", "#a2da9c", "#97d593", "#8ccf8a", "#81ca80",
    "#75c577", "#69bf70", "#5cb96a", "#4fb264", "#43ac5e", "#3aa458", "#339c52", "#2b944c", "#248c46", "#1e8942", "#19873f", "#14853c", "#0f8339", "#0a8136", "#057f33", "#007d30"];

  /* the USGS map's classes: national deciles of the DS-801 sites (tools/build_soilmaps.py), read once */
  let chemLeg = null, chemLegP = null;
  const chemLegend = () => (chemLegP = chemLegP || fetchJSON(`data/soilchem_legend.json?v=${V}`, {}, 20000).then(j => { chemLeg = j; return j; }).catch(e => { chemLegP = null; throw e; }));

  /* ---------- the layers and their legends ---------- */
  const SURVEY_NOTE = "Survey values describe the soil mapped here, not a test of a field.";
  const USFS_CREDIT = "gNATSGO 2022 (USDA-NRCS soil survey) rasterized by the USDA Forest Service, Geospatial Technology and Applications Center (CC0)";
  const TOTAL_NOTE = "TOTAL element in the soil (not plant-available): a near-total four-acid digest, which counts the element locked in minerals. A soil test of available nutrient reads far lower.";
  const meta = k => (window.WG_STATES.meta || {})[k];
  function legendOf(it) {
    const k = it.key, d = nameOf(DEPTHS, pick.depth), rows = c => c.colors.map((col, i) => [col, c.labels[i]]);
    if (k === "ph") return { title: `Soil pH, ${d}`, unit: "1:1 water", rows: rows(PH), note: `The survey's representative pH (1:1 soil and water) of each 30 m cell, thickness-weighted over ${d}: ${USFS_CREDIT}. Classes: Soil Survey Manual reaction classes. ${SURVEY_NOTE}` };
    if (k === "cec") return { title: `CEC at pH 7, ${d}`, unit: "cmol(+)/kg = meq/100 g", rows: rows(CEC), note: `Cation exchange capacity by ammonium acetate at pH 7, the survey's representative value, thickness-weighted over ${d}: ${USFS_CREDIT}. Blank where the survey gives no CEC at pH 7, as in many acid soils of the East, where it gives effective CEC (ECEC) instead (the tab shows it). ${SURVEY_NOTE}` };
    if (k === "om") return { title: `Organic matter, ${d}`, unit: "% by weight", rows: rows(OM), note: `The survey's representative organic matter, thickness-weighted over ${d}: ${USFS_CREDIT}. ${SURVEY_NOTE}` };
    if (k === "ec" || k === "sar") {
      const m = meta(k === "ec" ? "soil_ec" : "soil_sar") || {};
      return { title: m.title || it.name, unit: m.unit || "", rows: (m.legend || []).map(l => [l.color, l.label]), note: m.note || "" };
    }
    if (k === "chem") {
      const e = nameOf(ELS, pick.el), h = nameOf(HZ, pick.hz), L0 = chemLeg && chemLeg.elements[pick.el], c = L0 && L0[pick.hz];
      if (!chemLeg) chemLegend().then(redrawLegend, () => {});
      const u = L0 ? L0.unit : "", f = v => (c && c.dl !== null && v <= c.dl ? `${v} (detection limit)` : String(v));
      // classes closed above (a site at a limit belongs to the class below); equal limits leave the classes between them empty, as on the map
      const R = c ? chemLeg.colors.map((col, i) => [col, i === 0 ? `≤ ${f(c.breaks[0])}` : i === 9 ? `> ${c.breaks[8]}` : c.breaks[i - 1] === c.breaks[i] ? null : `${c.breaks[i - 1]}–${c.breaks[i]}`]).filter(r => r[1]) : [];
      return { title: `Total ${pick.el} (${e}), ${h}`, unit: u === "%" ? "% by weight (1% = 10,000 mg/kg)" : u, rows: R,
        note: `${TOTAL_NOTE} USGS Data Series 801 (Smith et al. 2013, public domain): ${c ? `${c.n.toLocaleString()} sites` : "4,857 sites"} sampled 2007–2010, about one per 1,600 km², interpolated by the USGS (inverse distance); colours from the USGS map service, classes its national tenths (deciles), worked out here from the sites${c ? `; US median ${c.median} ${u}` : ""}.${chemLeg ? "" : " Reading the class limits…"} Fine detail is not real: the nearest site may be 20–40 km away.` };
    }
    if (k === "n") return { title: `Total nitrogen, ${cmLabel(pick.nd)}`, unit: "g/kg (model)", scale: N_RAMP, ticks: [0, 2, 4, 6, 8, 10, 12].map(g => [(g * 100 / 38.66 + 0.5) / 33, String(g)]),
      note: "TOTAL nitrogen modelled by ISRIC SoilGrids 2.0 (Poggio et al. 2021, CC BY 4.0), 250 m, the mean prediction: organic N, not nitrate or plant-available N. Built-up land and water have no value. 1 g/kg = 0.1%." };
    return { title: it.name };
  }
  // the choices drawn under a layer's legend title, and in the layer sheet
  const sel = (k, opts, label) => `<label>${esc(label)}<select data-sm="${k}">${opts.map(([v, n]) => `<option value="${esc(v)}"${String(v) === String(pick[k]) ? " selected" : ""}>${esc(n)}</option>`).join("")}</select></label>`;
  const CTL = { depth: () => sel("depth", DEPTHS, "Depth"), el: () => sel("el", ELS.map(([e, n]) => [e, `${e} · ${n}`]), "Element"), hz: () => sel("hz", HZ, "Layer"), nd: () => sel("nd", SGD.map(d => [d, cmLabel(d)]), "Depth") };
  const CTL_OF = { ph: ["depth"], cec: ["depth"], om: ["depth"], chem: ["el", "hz"], n: ["nd"] };
  let lastLegend = null;
  function drawLegend(el, it, min, toggle) {
    lastLegend = [el, it, min, toggle];
    const g = legendOf(it);
    it.legend = g; it.note = g.note;
    Wx.legend(el, it, min, toggle);
    const h = el.querySelector("h5");
    if (CTL_OF[it.key] && h) h.insertAdjacentHTML("afterend", `<div class="sm-ctl">${CTL_OF[it.key].map(c => CTL[c]()).join("")}</div>`);
  }
  function redrawLegend() { if (lastLegend && lastLegend[1].on) drawLegend(...lastLegend); }
  const item = (key, name, sub, layer, o = {}) => ({ key, name, sub, layer, drawLegend, legend: { title: name }, note: "", opacity: 1.2, ...o });
  const LAYERS = [
    item("ph", "Soil pH (1:1 water)", "USDA Forest Service from the soil survey, 30 m, four depths", new ViewImage(usfsUrl("ph"), { key: () => pick.depth, name: "The pH map", attribution: "USDA Forest Service, gNATSGO" }), { def: true }),
    item("cec", "Cation exchange capacity (CEC)", "the same, at pH 7, cmol(+)/kg", new ViewImage(usfsUrl("cec"), { key: () => pick.depth, name: "The CEC map", attribution: "USDA Forest Service, gNATSGO" })),
    item("om", "Organic matter", "the same, % by weight", new ViewImage(usfsUrl("om"), { key: () => pick.depth, name: "The organic matter map", attribution: "USDA Forest Service, gNATSGO" })),
    item("ec", "Salinity: EC, 0–25 cm", "UC Davis SoilWeb from the soil survey, 800 m, dS/m", new StateSet("soil_ec")),
    item("sar", "Sodicity: SAR, profile maximum", "the same, the highest horizon's SAR", new StateSet("soil_sar")),
    item("chem", "Nutrients: total element", "USGS, about 1 site per 1,600 km²; TOTAL, not plant-available", chemLayer),
    item("n", "Total nitrogen", "ISRIC SoilGrids model, 250 m; not nitrate", nLayer),
  ];
  const byKey = k => LAYERS.find(x => x.key === k);

  // a choice made in the legend, the layer sheet or the tab: the layers it changes are asked again, and every select shows it
  function apply() {
    WG.util.cache.set("soilmaps", pick);
    ["ph", "cec", "om"].forEach(x => byKey(x).layer.redraw());
    const want = (l, p) => { if (l.wmsParams.layers !== p) l.setParams({ layers: p }); };
    want(chemLayer, `${pick.hz}_${pick.el}`);
    want(nLayer, `nitrogen_${pick.nd}_mean`);
    Object.keys(CTL).forEach(k => $$(`[data-sm="${k}"]`).forEach(s => { s.value = String(pick[k]); }));
    redrawLegend();
  }
  function choose(k, v) { pick[k] = k === "depth" ? +v : v; apply(); }
  document.addEventListener("change", e => { const s = e.target.closest && e.target.closest("[data-sm]"); if (s) choose(s.dataset.sm, s.value); });
  // the theme's choices at the end of the layer sheet's list (app.js buildLayerSheet)
  const sheetControls = () => `<div class="sm-ctl sm-sheet">${sel("depth", DEPTHS, "Depth of pH, CEC, organic matter")}${CTL.el()}${sel("hz", HZ, "Element's layer")}${sel("nd", SGD.map(d => [d, cmLabel(d)]), "Depth of total N")}</div>`;

  /* ---------- the theme ---------- */
  const ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8c2.2-1.5 4.3-1.5 6.5 0s4.3 1.5 6.5 0 3.6-1.2 5-.5M3 13h18M3 18h18"/><path d="M7 15.5h.01M12.5 15.5h.01M17 15.5h.01M9.5 20.5h.01M15 20.5h.01"/></svg>`;
  // second in the theme bar and the layer sheet, right after wind erosion: both list THEMES in order
  Wx.THEMES.splice(Wx.THEMES.findIndex(t => t.key === "erosion") + 1, 0, { key: "soilmaps", name: "Soil maps", short: "Soil", icon: ICON, layersTitle: "Soil maps",
    title: "Soil maps: pH, salinity, sodicity, CEC, organic matter, and total nutrients and nitrogen",
    hint: "to see the soil's chemistry by depth: pH, salinity, sodicity, CEC and organic matter from the soil survey, total nutrients from USGS sites, and nutrients measured at nearby NRCS lab pedons.",
    note: "Soil survey maps (pH, CEC and organic matter at 30 m; salinity and sodicity at 800 m), USGS total elements and SoilGrids total nitrogen. The panel shows Overview (the soil, its water and its moisture at a glance) and Soil maps: the survey's chemistry by depth, the 30 m values, nearby USGS sites and NRCS lab pedons.",
    layersNote: "Survey and model values describe typical soil, not a soil test. Total elements are not plant-available. No map covers the US for soil-test (plant-available) N, P, K, Ca, Mg or S, or for boron.",
    controls: sheetControls });
  Wx.layers.soilmaps = LAYERS;

  /* ---------- the tab: what each source says at the point ---------- */
  const SDA = "https://SDMDataAccess.sc.egov.usda.gov/Tabular/post.rest";
  async function sda(query) {
    const j = await fetchJSON(SDA, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, format: "JSON+COLUMNNAME" }) }, 40000);
    const t = j.Table || [];
    return t.length ? t.slice(1).map(r => Object.fromEntries(t[0].map((c, i) => [c, r[i]]))) : [];
  }
  const km = (a, b, c, d) => { const r = Math.PI / 180, x = Math.sin(((c - a) * r) / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(((d - b) * r) / 2) ** 2; return 12742 * Math.asin(Math.sqrt(x)); };
  const bearing = (a, b, c, d) => { const r = Math.PI / 180, y = Math.sin((d - b) * r) * Math.cos(c * r), x = Math.cos(a * r) * Math.sin(c * r) - Math.sin(a * r) * Math.cos(c * r) * Math.cos((d - b) * r); return compass(Math.atan2(y, x) / r); };
  const dist = k => UN.fmt("distance", k, k < 10 ? 1 : 0);
  const pt = (lat, lon) => `POINT(${(+lon).toFixed(6)} ${(+lat).toFixed(6)})`;

  /* Each source at a point, as a plain function of lat and lon (for other parts of the app), and as the tab reads it:
     once per location (Wx.once, keyed by WG.state.token). */
  /* the survey's chemistry: every horizon of the map unit's major components (representative values) */
  async function surveyAt(lat, lon) {
    const rows = await sda(`SELECT mu.mukey, mu.musym, mu.muname, l.areasymbol, c.cokey, c.compname, c.comppct_r, c.compkind, h.hzname, h.hzdept_r, h.hzdepb_r,
      h.ph1to1h2o_r, h.ph01mcacl2_r, h.ec_r, h.sar_r, h.esp_r, h.cec7_r, h.ecec_r, h.sumbases_r, h.om_r, h.caco3_r, h.gypsum_r
      FROM (SELECT TOP 1 mukey FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('${pt(lat, lon)}')) g
      JOIN mapunit mu ON mu.mukey = g.mukey JOIN legend l ON l.lkey = mu.lkey
      JOIN component c ON c.mukey = mu.mukey AND c.majcompflag = 'Yes' LEFT JOIN chorizon h ON h.cokey = c.cokey
      ORDER BY c.comppct_r DESC, c.cokey, h.hzdept_r`);
    const comps = [];
    rows.forEach(r => {
      let c = comps.find(x => x.cokey === r.cokey);
      if (!c) comps.push((c = { cokey: r.cokey, name: r.compname, pct: num(r.comppct_r), kind: r.compkind, hz: [] }));
      if (r.hzdept_r === null || r.hzdepb_r === null) return;
      const n = k => num(r[k]), ph = n("ph1to1h2o_r"), cec7 = n("cec7_r"), sb = n("sumbases_r");
      c.hz.push({ name: r.hzname || "", t: n("hzdept_r"), b: n("hzdepb_r"), ph: ok(ph) ? ph : n("ph01mcacl2_r"), cacl2: !ok(ph) && ok(n("ph01mcacl2_r")),
        ec: n("ec_r"), sar: n("sar_r"), esp: n("esp_r"), cec: ok(cec7) ? cec7 : n("ecec_r"), ecec: !ok(cec7) && ok(n("ecec_r")),
        bs: ok(sb) && ok(cec7) && cec7 > 0 ? (100 * sb) / cec7 : null, om: n("om_r"), caco3: n("caco3_r"), gyps: n("gypsum_r") });
    });
    return { mu: rows[0] ? { key: rows[0].mukey, sym: rows[0].musym, name: rows[0].muname, area: rows[0].areasymbol } : null, comps };
  }
  const survey = (lat, lon) => Wx.once("sm:survey", () => surveyAt(lat, lon));
  // the thickness-weighted mean over a..b cm of the horizons that have a value
  function over(hz, a, b, k) {
    let s = 0, t = 0;
    hz.forEach(h => { const d = Math.min(b, h.b) - Math.max(a, h.t); if (d > 0 && ok(h[k])) { s += h[k] * d; t += d; } });
    return t ? s / t : null;
  }
  const PROPS = ["ph", "ec", "sar", "esp", "cec", "bs", "om", "caco3", "gyps"];
  const layerOf = (hz, a, b) => ({ ...Object.fromEntries(PROPS.map(k => [k, over(hz, a, b, k)])), cacl2: hz.some(h => h.cacl2 && h.t < b), ecec: hz.some(h => h.ecec && h.t < b) });

  /* the Forest Service's values at the cell, its four depths, one service at a time */
  async function usfsSamples(k, lat, lon) {
    const q = new URLSearchParams({ geometry: JSON.stringify({ x: +lon.toFixed(6), y: +lat.toFixed(6), spatialReference: { wkid: 4326 } }), geometryType: "esriGeometryPoint", returnFirstValueOnly: false, outFields: "*", f: "json" });
    const j = await fetchJSON(`${USFS}${SVC[k][0]}/ImageServer/getSamples?${q}`, {}, 40000);
    if (j.error) throw new Error(j.error.message || "the service refused the request");
    const out = {};
    // each slice's depth: its depth field, or (the CEC service has none) the bottom depth that ends its name ("pH_5-25", "Cation_Exchange_Capacity_pH7_25")
    const depthOf = a => num(a.depth) || num((/(\d+)\D*$/.exec(a.name || "") || [])[1]);
    (j.samples || []).forEach(s => { const d = depthOf(s.attributes || {}), v = num(s.value); if (DEPTHS.some(x => x[0] === d)) out[d] = v === 0 && k !== "om" ? null : v; }); // 0: no survey value (pH and CEC)
    return out;
  }
  const usfsAt = (k, lat, lon) => Wx.once(`sm:usfs:${k}`, () => usfsSamples(k, lat, lon));

  /* SoilGrids' total N at six depths; kept on this device, as ISRIC asks for fair use of its point service */
  const SG = "https://rest.isric.org/soilgrids/v2.0/properties/query";
  async function sgNAt(lat, lon) {
    const key = `sgN:${lat.toFixed(4)},${lon.toFixed(4)}`, hit = WG.util.cache.get(key);
    if (hit && hit.some(r => ok(r.mean))) return hit;
    const j = await fetchJSON(`${SG}?lon=${lon.toFixed(5)}&lat=${lat.toFixed(5)}&property=nitrogen&value=mean&value=Q0.05&value=Q0.95&${SGD.map(d => `depth=${d}`).join("&")}`, {}, 45000);
    const L0 = ((j.properties || {}).layers || [])[0], f = (L0 && L0.unit_measure && L0.unit_measure.d_factor) || 100, g = v => (ok(num(v)) ? num(v) / f : null);
    const out = (L0 ? L0.depths : []).map(d => ({ label: d.label, t: d.range.top_depth, b: d.range.bottom_depth, mean: g(d.values.mean), lo: g(d.values["Q0.05"]), hi: g(d.values["Q0.95"]) }));
    if (out.some(r => ok(r.mean))) WG.util.cache.set(key, out); // an answer with no value at all is asked again next time: SoilGrids may fill it later
    return out;
  }
  const sgN = (lat, lon) => Wx.once("sm:sgn", () => sgNAt(lat, lon));

  /* USGS DS-801: the nearest sites (ids and places from the WFS, in a box widened once if it holds fewer than 3), then
     each site's analyses */
  const WFS = "https://mrdata.usgs.gov/services/wfs/ds801";
  async function usgsNearAt(lat, lon) {
    let list = [];
    for (const r of [0.6, 1.5]) {
      const dx = r / Math.cos((lat * Math.PI) / 180);
      const t = await fetchText(`${WFS}?service=WFS&version=1.0.0&request=GetFeature&typeName=ds801&bbox=${(lon - dx).toFixed(3)},${(lat - r).toFixed(3)},${(lon + dx).toFixed(3)},${(lat + r).toFixed(3)}`, 30000);
      list = t.split("<gml:featureMember>").slice(1).map(b => {
        const c = /<gml:Point[^>]*>\s*<gml:coordinates>\s*([-\d.]+),([-\d.]+)/.exec(b), id = /<ms:site_id>(\d+)<\/ms:site_id>/.exec(b);
        return c && id ? { id: id[1], lon: +c[1], lat: +c[2] } : null;
      }).filter(Boolean).map(s => ({ ...s, km: km(lat, lon, s.lat, s.lon), dir: bearing(lat, lon, s.lat, s.lon) }));
      if (list.length >= 3) break;
    }
    list.sort((a, b) => a.km - b.km);
    return Promise.all(list.slice(0, 3).map(async s => ({ ...s, p: (j => j.properties || j)(await fetchJSON(`https://mrdata.usgs.gov/ds-801/json/${s.id}`, {}, 30000)) })));
  }
  const usgsNear = (lat, lon) => Wx.once("sm:ds801", () => usgsNearAt(lat, lon));
  const DS_COL = { P: "p_ppm", K: "k_pct", Ca: "ca_pct", Mg: "mg_pct", S: "s_pct", Zn: "zn_ppm", Fe: "fe_pct", Mn: "mn_ppm", Cu: "cu_ppm", Na: "na_pct" };

  /* NRCS KSSL: the lab-measured pedons nearest the point, their surface layer (a box widened once if it holds fewer than 3) */
  async function ksslAt(lat, lon) {
    let rows = [];
    for (const r of [0.5, 1.5]) {
      const dx = r / Math.cos((lat * Math.PI) / 180), la = lat.toFixed(5), lo = lon.toFixed(5);
      rows = await sda(`SELECT TOP 8 p.pedon_key, p.pedlabsampnum, p.corr_name, p.samp_name, p.site_obsdate AS obsdate, p.latitude_decimal_degrees AS lat, p.longitude_decimal_degrees AS lon,
        l.hzn_top, l.hzn_bot, l.hzn_desgn, c.ph_h2o, c.ph_cacl2, c.electrical_conductivity_satx AS ec, c.total_nitrogen_ncs AS n_pct, c.phosphorus_bray1 AS p_bray1, c.phosphorus_olsen AS p_olsen,
        c.phosphorus_mehlich_3 AS p_m3, c.k_nh4_ph_7 AS k, c.ca_nh4_ph_7 AS ca, c.mg_nh4_ph_7 AS mg, c.na_nh4_ph_7 AS na, c.total_sulfur_ncs AS s_pct, c.cec_nh4_ph_7 AS cec7, c.caco3_lt_2_mm AS caco3
        FROM lab_combine_nasis_ncss p JOIN lab_layer l ON l.pedon_key = p.pedon_key AND l.hzn_top = 0 JOIN lab_chemical_properties c ON c.labsampnum = l.labsampnum
        WHERE p.latitude_decimal_degrees BETWEEN ${(lat - r).toFixed(4)} AND ${(lat + r).toFixed(4)} AND p.longitude_decimal_degrees BETWEEN ${(lon - dx).toFixed(4)} AND ${(lon + dx).toFixed(4)}
        ORDER BY SQUARE(p.latitude_decimal_degrees - (${la})) + SQUARE((p.longitude_decimal_degrees - (${lo})) * COS(RADIANS(${la})))`);
      if (rows.length >= 3) break;
    }
    return rows.map(r => ({ ...r, km: km(lat, lon, +r.lat, +r.lon), dir: bearing(lat, lon, +r.lat, +r.lon), year: (/(\d{4})/.exec(r.obsdate || "") || [])[1] || "" }));
  }
  const kssl = (lat, lon) => Wx.once("sm:kssl", () => ksslAt(lat, lon));

  /* the tab's tables, kept for the CSV downloads: id -> { title, header, rows }. Setting one (the parts in other files
     write tables().basin = …) tells the listeners, so the Overview's tiles fill as each source answers. */
  const subs = new Set(), emit = id => subs.forEach(f => { try { f(id); } catch (e) { console.warn("soil maps listener", e); } });
  const newTables = () => new Proxy({}, { set(o, k, v) { o[k] = v; emit(k); return true; } });
  const on = f => { subs.add(f); return () => subs.delete(f); }; // f(id): a table set, or "part:<key>" when a part has ended
  let tables = newTables();
  // the tab's last drawing: its location and how each added part ended ("done", or the Error), for the Overview's tiles
  let run = { tok: null, parts: {} };
  const DL = `<svg viewBox="0 0 24 24"><path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/></svg>`;
  const head = (title, csv, tag = "") => `<div class="card-h"><h3>${esc(title)}</h3><div class="card-tools">${tag ? `<span class="tag">${esc(tag)}</span>` : ""}${csv ? `<button class="dl-btn" data-sm-csv="${csv}" title="Download this table (CSV)" aria-label="Download ${esc(title)} (CSV)">${DL}</button>` : ""}</div></div>`;
  const grid = (cols, rows) => `<div class="table-wrap"><table class="grid sm-table"><thead><tr>${cols.map(c => `<th>${c}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td${i === 0 ? ' class="l"' : ""}>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  const th = (name, unit) => `${esc(name)}${unit ? `<small>${esc(unit)}</small>` : ""}`;
  const r1 = v => (ok(v) ? +v.toFixed(2) : null); // CSV values: two decimals, blank when missing
  const showBtn = (key, label, data = {}) => `<button class="link" data-sm-show="${key}"${Object.entries(data).map(([k, v]) => ` data-${k}="${esc(v)}"`).join("")}>${esc(label)}</button>`;
  function csv(id) {
    const ids = id === "all" ? Object.keys(tables) : [id];
    if (!ids.length || !tables[ids[0]]) return WG.util.toast("Wait for the tables to load.");
    if (id !== "all") { const t = tables[id]; return WG.downloads.csvSave(`soil_${id}`, t.header, t.rows); }
    // all tables in one file: each row headed by its table's name, and each table's own header as its first row
    const width = Math.max(...ids.map(k => tables[k].header.length)), pad = r => [...r, ...new Array(Math.max(0, width + 1 - r.length)).fill("")];
    const rows = ids.flatMap(k => [pad([tables[k].title, ...tables[k].header]), ...tables[k].rows.map(r => pad([tables[k].title, ...r]))]);
    WG.downloads.csvSave("soil_all_tables", ["Table", ...new Array(width).fill("").map((_, i) => `Column ${i + 1}`)], rows);
  }

  let hooks = null; // app.js: setLive(theme, key)
  function showMap(key, d) {
    if (d.depth) pick.depth = +d.depth;
    if (d.el) pick.el = d.el;
    if (d.hz) pick.hz = d.hz;
    if (d.nd) pick.nd = d.nd;
    apply();
    if (hooks) hooks.setLive("soilmaps", key);
    redrawLegend();
    syncChips();
  }
  /* the theme's map layers as a row of buttons per group, the one on the map pressed. The groups by the file that adds
     them: this file's chemistry, js/soilmoisture.js's layers, and the rest (js/basins.js's watersheds and streams). */
  const OWN = new Set(LAYERS.map(x => x.key));
  const SHORT = { ph: "pH", cec: "CEC", om: "Organic matter", ec: "Salinity (EC)", sar: "Sodicity (SAR)", chem: "Total elements", n: "Total N",
    wbd: "Watersheds", flow: "Streams", smap_sf: "SMAP 0–5 cm", smap_rz: "SMAP 0–100 cm", nwm: "NWM saturation", sport: "Percentile, daily", grace: "Percentile, weekly", stations: "Stations" };
  const onMap = it => !!(WG.map && it && it.layer && WG.map.hasLayer(it.layer));
  function chips() {
    const wet = new Set(WG.soilmoisture ? WG.soilmoisture.layers.map(x => x.key) : []);
    const groups = [["Soil chemistry", x => OWN.has(x.key)], ["Water: basins", x => !OWN.has(x.key) && !wet.has(x.key)], ["Soil moisture", x => wet.has(x.key)]];
    return groups.map(([g, f]) => { const list = LAYERS.filter(f); return list.length ? `<div class="sm-chips"><span class="sm-chips-k">${esc(g)}</span><div class="seg" role="group" aria-label="${esc(g)} maps">${list.map(x =>
      `<button type="button" data-sm-show="${x.key}" data-sm-chip class="${onMap(x) ? "on" : ""}" aria-pressed="${onMap(x)}" title="${esc(x.name)}${x.sub ? `: ${esc(x.sub)}` : ""}">${esc(SHORT[x.key] || x.name.split(/[:,(]/)[0].trim())}</button>`).join("")}</div></div>` : ""; }).join("");
  }
  // the pressed chip follows the map, whichever way the layer changed (a chip, a link, the layer sheet, another theme)
  function syncChips() { $$("[data-sm-chip]").forEach(b => { const on = onMap(byKey(b.dataset.smShow)); b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); }); }
  let chipT = 0;
  const chipSoon = e => { if (LAYERS.some(x => x.layer === e.layer)) { clearTimeout(chipT); chipT = setTimeout(syncChips, 0); } };
  document.addEventListener("click", e => {
    const c = e.target.closest && e.target.closest("[data-sm-csv]");
    if (c) { e.preventDefault(); csv(c.dataset.smCsv); }
    const m = e.target.closest && e.target.closest("[data-sm-show]");
    if (m) { e.preventDefault(); showMap(m.dataset.smShow, m.dataset); }
  });

  const SOURCES = `Each part comes from its own source and says what it measures: <b>survey</b> values describe the soil mapped here (not a test of a field); <b>model</b> values are predictions; <b>total</b> elements include what is locked in minerals (not plant-available); <b>lab</b> values were measured on samples at a pedon, often decades ago.`;
  const NO_MAP = `<div class="card">${head("What data is missing", "")}<p class="fine" style="margin-top:0">No map covers the US for the nutrients a plant can take up, as a <b>soil test</b> measures them: nitrate, phosphorus (Bray, Olsen or Mehlich-3), potassium, calcium, magnesium and sulfur, or zinc, iron, manganese and copper (DTPA). Boron and phosphorus survey data is also limited for the US. For a field's fertility, take a soil test: the total elements and lab pedons here are background, not a recommendation.</p></div>`;

  // more parts of the tab from other files (js/basins.js, js/soilmoisture.js): {key, wait, render(el, live, lat, lon)}, each in its own box
  const PARTS = [];
  Wx.RENDER.soilmaps = async (el, live) => {
    const { lat, lon } = WG.state.site, at = id => (live() ? el.querySelector(`#${id}`) : null);
    tables = newTables();
    const me = (run = { tok: WG.state.token, parts: Object.fromEntries(PARTS.map(p => [p.key, "wait"])) });
    el.innerHTML = `<div class="card">${head("Soil chemistry here", "", "")}<p class="fine" style="margin-top:0">${SOURCES}</p>
        <h4 class="sm-h">Show on the map</h4>${chips()}</div>
      <div id="smSurvey">${Wx.wait("the soil survey's chemistry (SSURGO)")}</div>
      <div id="smUsfs">${Wx.wait("the Forest Service's 30 m maps at this cell")}</div>
      <div id="smN">${Wx.wait("SoilGrids' total nitrogen")}</div>
      <div id="smUsgs">${Wx.wait("the nearest USGS soil geochemistry sites")}</div>
      <div id="smKssl">${Wx.wait("the nearest NRCS lab pedons (KSSL)")}</div>
      ${PARTS.map(p => `<div id="smPart-${p.key}">${Wx.wait(p.wait)}</div>`).join("")}
      ${NO_MAP}
      <div class="card sm-all"><button class="btn" data-sm-csv="all">${DL}<span>Download all the tables (CSV)</span></button>
        <p class="fine">Every table of this tab in one file, each row headed by its table's name; each card's own button gives its table alone.</p></div>`;
    const fail = (id, what) => e => { console.warn(id, e); const x = at(id); if (x) x.innerHTML = Wx.failed(what, e); };
    const D = (a, b) => UN.range("depth", a, b);

    /* the survey: the dominant component at a glance, each major component over 0-15 and 0-30 cm, and every horizon */
    const pSurvey = survey(lat, lon).then(S => {
      const x = at("smSurvey");
      if (!x) return;
      if (!S.mu || !S.comps.length) { x.innerHTML = `<div class="card">${head("Soil survey chemistry", "")}<p class="fine">No soil survey map unit with major components here (water, or an area not surveyed).</p></div>`; return; }
      const comps = S.comps.filter(c => c.hz.length), top = comps[0];
      const P = (v, cacl2) => (ok(v) ? `${fmt(v, 1)}${cacl2 ? " CaCl₂" : ""}` : "—");
      const rowsHtml = [], rowsCsv = [];
      const avg = (a, b) => { const w = comps.map(c => [c.pct || 0, layerOf(c.hz, a, b)]), o = {}; PROPS.forEach(k => { let s = 0, t = 0; w.forEach(([p, l]) => { if (ok(l[k]) && p) { s += p * l[k]; t += p; } }); o[k] = t ? s / t : null; }); o.cacl2 = w.some(([, l]) => l.cacl2); o.ecec = w.some(([, l]) => l.ecec); return o; };
      const line = (name, pct, a, b, l) => {
        const sod = sodicity(l.ec, l.sar, l.esp), bs = ok(l.bs) ? Math.min(100, l.bs) : null;
        rowsHtml.push([esc(name), pct === null ? "" : fmt(pct, 0), D(a, b), P(l.ph, l.cacl2), esc(l.cacl2 ? "" : reaction(l.ph)), fmt(l.ec, 1), esc(salinity(l.ec)), fmt(l.sar, 1), fmt(l.esp, 0), esc(sod),
          `${fmt(l.cec, 1)}${l.ecec && ok(l.cec) ? " ECEC" : ""}`, ok(bs) ? `${fmt(bs, 0)}${l.bs > 100 ? "+" : ""}` : "—", fmt(l.om, 1), fmt(l.caco3, 0), fmt(l.gyps, 0)]);
        rowsCsv.push([name, pct, a, b, r1(l.ph), l.cacl2 ? "CaCl2" : "1:1 water", l.cacl2 ? "" : reaction(l.ph), r1(l.ec), salinity(l.ec), r1(l.sar), r1(l.esp), sod, r1(l.cec), l.ecec ? "ECEC" : "CEC7", r1(bs), r1(l.om), r1(l.caco3), r1(l.gyps)]);
      };
      if (comps.length > 1) [[0, 15], [0, 30]].forEach(([a, b]) => line("Map unit (major components, by share)", null, a, b, avg(a, b)));
      comps.forEach(c => [[0, 15], [0, 30]].forEach(([a, b]) => line(c.name, c.pct, a, b, layerOf(c.hz, a, b))));
      tables.survey = { title: "Soil survey chemistry, 0-15 and 0-30 cm (SSURGO representative values)", header: ["Component", "Component %", "Top (cm)", "Bottom (cm)", "pH", "pH method", "Reaction class", "EC (dS/m)", "Salinity class", "SAR", "ESP (%)", "Sodicity (SAR>=13 or ESP>=15; EC>=4 saline)", "CEC (cmol(+)/kg)", "CEC method", "Base saturation (%, sum of bases / CEC7)", "Organic matter (%)", "CaCO3 equivalent (%)", "Gypsum (%)"], rows: rowsCsv };
      const hzRows = comps.flatMap(c => c.hz.map(h => [c.name, h.name, h.t, h.b, h.ph, h.cacl2 ? "CaCl2" : "1:1 water", h.ec, h.sar, h.esp, h.cec, h.ecec ? "ECEC" : "CEC7", ok(h.bs) ? Math.min(100, h.bs) : null, h.om, h.caco3, h.gyps]));
      tables.horizons = { title: "Soil survey chemistry by horizon (SSURGO representative values)", header: ["Component", "Horizon", "Top (cm)", "Bottom (cm)", "pH", "pH method", "EC (dS/m)", "SAR", "ESP (%)", "CEC (cmol(+)/kg)", "CEC method", "Base saturation (%)", "Organic matter (%)", "CaCO3 equivalent (%)", "Gypsum (%)"], rows: hzRows.map(r => r.map(v => (typeof v === "number" ? r1(v) : v))) };
      const l15 = top ? layerOf(top.hz, 0, 15) : null, sod = l15 ? sodicity(l15.ec, l15.sar, l15.esp) : "";
      const vu = (v, d, u) => (ok(v) ? `${fmt(v, d)}${u ? ` <small>${u}</small>` : ""}` : "—");
      const kv = l15 ? `<div class="wx-kv">
          <div><span>pH${l15.cacl2 ? " (CaCl₂)" : ""}</span><b>${P(l15.ph, false)}</b><span>${esc(l15.cacl2 ? "classes are for water pH, about 0.5 higher" : reaction(l15.ph))}</span></div>
          <div><span>Salinity, EC</span><b>${vu(l15.ec, 1, "dS/m")}</b><span>${esc(salinity(l15.ec))}</span></div>
          <div><span>Sodicity, SAR · ESP</span><b>${fmt(l15.sar, 1)} · ${vu(l15.esp, 0, "%")}</b><span>${esc(sod)}</span></div>
          <div><span>${l15.ecec ? "ECEC" : "CEC at pH 7"}</span><b>${vu(l15.cec, 1, "cmol(+)/kg")}</b><span>${ok(l15.bs) ? `base saturation ${fmt(Math.min(100, l15.bs), 0)}%` : ""}</span></div>
          <div><span>Organic matter</span><b>${vu(l15.om, 1, "%")}</b><span>${ok(l15.caco3) ? `CaCO₃ ${fmt(l15.caco3, 0)}%` : ""}${ok(l15.gyps) && l15.gyps > 0 ? ` · gypsum ${fmt(l15.gyps, 0)}%` : ""}</span></div></div>` : "";
      const cols = [th("Component"), th("Share", "%"), th("Depth"), th("pH"), th("Reaction"), th("EC", "dS/m"), th("Salinity"), th("SAR"), th("ESP", "%"), th("Sodicity"), th("CEC", "cmol(+)/kg"), th("Base sat.", "%"), th("OM", "%"), th("CaCO₃", "%"), th("Gypsum", "%")];
      const hzCols = [th("Component"), th("Horizon"), th("Depth"), th("pH"), th("EC", "dS/m"), th("SAR"), th("ESP", "%"), th("CEC", "cmol(+)/kg"), th("Base sat.", "%"), th("OM", "%"), th("CaCO₃", "%"), th("Gypsum", "%")];
      x.innerHTML = `<div class="card">${head("Soil survey chemistry", "survey", `${S.mu.sym} · ${S.mu.area}`)}
          <p class="fine" style="margin-top:0">${esc(S.mu.name)}. ${top ? `${esc(top.name)} (${fmt(top.pct, 0)}% of the map unit), 0–15 cm:` : "No horizon data."}</p>${kv}
          <h4 class="sm-h">Each major component, depth-weighted</h4>${grid(cols, rowsHtml)}
          <p class="fine">Depth-weighted over the horizons with a value. Base saturation is the sum of bases over CEC at pH 7 (shown as 100+ in calcareous soils, where bases exceed it). "CaCl₂": the survey gives only pH in calcium chloride (common in New England), about 0.5 below water pH. "ECEC": effective CEC, given where CEC at pH 7 is not (acid soils).</p></div>
        <div class="card">${head("Soil survey chemistry by horizon", "horizons")}${grid(hzCols, comps.flatMap(c => c.hz.map(h => [esc(c.name), esc(h.name), D(h.t, h.b), P(h.ph, h.cacl2), fmt(h.ec, 1), fmt(h.sar, 1), fmt(h.esp, 0), `${fmt(h.cec, 1)}${h.ecec && ok(h.cec) ? " ECEC" : ""}`, ok(h.bs) ? fmt(Math.min(100, h.bs), 0) : "—", fmt(h.om, 1), fmt(h.caco3, 0), fmt(h.gyps, 0)])))}
          <p class="fine">USDA-NRCS Soil Survey Geographic Database (SSURGO) through Soil Data Access: representative values of the map unit's major components, public domain. pH 1:1 in water; EC and SAR of the saturated-paste extract; ESP: exchangeable sodium percentage; CEC by ammonium acetate at pH 7; organic matter, CaCO₃ equivalent and gypsum by weight. Classes: Soil Survey Manual (reaction, salinity); sodic at SAR 13 or ESP 15 or more, saline at EC 4 dS/m or more (U.S. Salinity Laboratory, Handbook 60). ${SURVEY_NOTE}</p></div>`;
    }, fail("smSurvey", "the soil survey's chemistry"));

    /* the Forest Service's 30 m values: each property's column fills as its service answers */
    const R = {}, drawUsfs = () => {
      const x = at("smUsfs");
      if (!x) return;
      const v = (k, d) => (R[k] === undefined ? "…" : R[k] instanceof Error ? "—" : R[k][d] === null || R[k][d] === undefined ? "—" : fmt(R[k][d], 1));
      const done = Object.keys(SVC).every(k => R[k] !== undefined), bad = Object.keys(SVC).filter(k => R[k] instanceof Error);
      if (done) tables.usfs = { title: "USDA Forest Service 30 m soil maps from gNATSGO 2022 (survey values)", header: ["Depth", "pH (1:1 water)", "Reaction class", "CEC at pH 7 (cmol(+)/kg)", "Organic matter (%)"],
        rows: DEPTHS.map(([d, n]) => { const g = k => (R[k] instanceof Error ? null : r1(R[k][d])); return [n, g("ph"), reaction(g("ph")), g("cec"), g("om")]; }) };
      x.innerHTML = `<div class="card">${head("Soil survey maps at this 30 m cell", done ? "usfs" : "", "USDA Forest Service")}
        ${grid([th("Depth"), th("pH", "1:1 water"), th("Reaction"), th("CEC", "cmol(+)/kg"), th("Organic matter", "%")], DEPTHS.map(([d, n]) => [n, v("ph", d), esc(R.ph && !(R.ph instanceof Error) ? reaction(R.ph[d]) : ""), v("cec", d), v("om", d)]))}
        <p class="fine">${bad.length ? `The Forest Service's server did not answer for ${bad.map(k => ({ ph: "pH", cec: "CEC", om: "organic matter" })[k]).join(", ")}; pick the location again to retry. ` : ""}The soil survey's representative values thickness-weighted over each depth, as rasters at 30 m: ${USFS_CREDIT}. They follow the same survey as the table above, cell by cell, so they can differ from it where the point sits near a map unit's edge or the survey has been updated since 2022. CEC is at pH 7 only: blank where the survey gives only effective CEC. Maps: ${showBtn("ph", "pH", { depth: pick.depth })} · ${showBtn("cec", "CEC")} · ${showBtn("om", "organic matter")}.</p></div>`;
    };
    drawUsfs();
    const pUsfs = Promise.all(Object.keys(SVC).map(k => usfsAt(k, lat, lon).then(o => { R[k] = o; }, e => { console.warn("usfs", k, e); R[k] = e instanceof Error ? e : new Error(String(e)); }).then(drawUsfs)));

    /* SoilGrids' total N */
    const pN = sgN(lat, lon).then(rows => {
      const x = at("smN");
      if (!x) return;
      const any = rows.some(r => ok(r.mean));
      tables.n = { title: "Total nitrogen, ISRIC SoilGrids 2.0 (model, 250 m)", header: ["Top (cm)", "Bottom (cm)", "Total N mean (g/kg)", "5th percentile (g/kg)", "95th percentile (g/kg)", "Total N mean (%)"], rows: rows.map(r => [r.t, r.b, r1(r.mean), r1(r.lo), r1(r.hi), ok(r.mean) ? +(r.mean / 10).toFixed(3) : null]) };
      x.innerHTML = `<div class="card">${head("Total nitrogen (model)", any ? "n" : "", "SoilGrids, 250 m")}
        ${any ? grid([th("Depth"), th("Total N", "g/kg"), th("90% range", "g/kg"), th("Total N", "%")], rows.map(r => [esc(cmLabel(r.label)), fmt(r.mean, 2), ok(r.lo) ? `${fmt(r.lo, 2)}–${fmt(r.hi, 2)}` : "—", ok(r.mean) ? fmt(r.mean / 10, 3) : "—"]))
          : `<p class="fine" style="margin-top:0">SoilGrids gives no value at this point: it leaves built-up land and water out, and has gaps elsewhere too. Pick a point nearby.</p>`}
        <p class="fine">TOTAL nitrogen predicted by ISRIC SoilGrids 2.0 (Poggio et al. 2021, doi:10.5194/soil-7-217-2021, CC BY 4.0), a global model from soil profiles and covariates, with its 5–95% prediction range: mostly organic N, not nitrate or what a crop can take up this season. ${showBtn("n", "Show it on the map")}.</p></div>`;
    }, fail("smN", "SoilGrids' total nitrogen"));

    /* USGS DS-801: the three nearest sites, top 5 cm and A horizon */
    const pUsgs = Promise.all([usgsNear(lat, lon), chemLegend().catch(() => null)]).then(([sites, lg]) => {
      const x = at("smUsgs");
      if (!x) return;
      if (!sites.length) { x.innerHTML = `<div class="card">${head("Nearest USGS soil geochemistry sites", "")}<p class="fine">No DS-801 site within about 160 km.</p></div>`; return; }
      const val = (s, hz, el) => { const a = ((s.p[hz] || {}).analyses || {})[DS_COL[el]]; return a === undefined || a === null || a === "" ? null : a; };
      const unit = el => (DS_COL[el].endsWith("_pct") ? "%" : "mg/kg");
      const shows = (v, el) => (v === null ? "—" : typeof v === "string" ? esc(v) : fmt(v, unit(el) === "%" ? 2 : v < 10 ? 1 : 0)); // as the lab reports them
      const depthOf = (s, hz) => (s.p[hz] && s.p[hz].depth_cm ? `${s.p[hz].depth_cm} cm` : "");
      const cols = [th("Element"), ...sites.flatMap((s, i) => [th(`Site ${i + 1}, top 5 cm`, depthOf(s, "top5cm")), th(`Site ${i + 1}, A horizon`, depthOf(s, "ahorizon"))]), th("US median", "top 5 cm")];
      const rows = ELS.map(([el, n]) => [`${showBtn("chem", el, { el, hz: "Top5" })} <small>${esc(n)}, ${unit(el)}</small>`, ...sites.flatMap(s => [shows(val(s, "top5cm", el), el), shows(val(s, "ahorizon", el), el)]),
        lg && lg.elements[el] ? esc(String(lg.elements[el].Top5.median)) : "—"]);
      tables.usgs = { title: "USGS DS-801 soil geochemistry, nearest sites: TOTAL element (not plant-available)", header: ["Element", "Unit", ...sites.flatMap((s, i) => [`Site ${i + 1} (#${s.id}, ${r1(s.km)} km ${s.dir}, ${s.p.colldate || ""}) top 5 cm`, `Site ${i + 1} A horizon`]), "US median top 5 cm"],
        rows: ELS.map(([el]) => [el, unit(el), ...sites.flatMap(s => [val(s, "top5cm", el), val(s, "ahorizon", el)]), lg && lg.elements[el] ? lg.elements[el].Top5.median : null]) };
      const sLine = sites.map((s, i) => { const p = s.p; return `<b>Site ${i + 1}</b> #${esc(s.id)}: ${dist(s.km)} ${esc(s.dir)}, sampled ${esc(p.colldate || "")}${p.landcover1 ? `, ${esc(p.landcover1)}${p.landcover2 ? ` (${esc(p.landcover2)})` : ""}` : ""}`; }).join("; ");
      x.innerHTML = `<div class="card">${head("Nearest USGS soil geochemistry sites", "usgs", "TOTAL element")}
        <p class="fine" style="margin-top:0">${sLine}.</p>${grid(cols, rows)}
        <p class="fine"><b>Total element in the soil, not plant-available:</b> a near-total four-acid digest (ICP-AES/MS) that counts the element held in minerals; K, Ca, Mg, S, Fe and Na in % by weight (1% = 10,000 mg/kg), the others in mg/kg. A soil test (available P, K …) reads tens to hundreds of times lower and is not predicted by these. "&lt;": below the detection limit. USGS Data Series 801 (Smith et al. 2013, doi:10.3133/ds801), public domain, one site per about 1,600 km², sampled 2007–2010. Click an element to map it.</p></div>`;
    }, fail("smUsgs", "the USGS soil geochemistry sites"));

    /* NRCS KSSL pedons */
    const pKssl = kssl(lat, lon).then(rows => {
      const x = at("smKssl");
      if (!x) return;
      if (!rows.length) { x.innerHTML = `<div class="card">${head("Lab-measured pedons nearby", "")}<p class="fine">No NRCS soil lab pedon with a surface sample within about 160 km.</p></div>`; return; }
      const n = (r, k) => num(r[k]), f = (v, d) => fmt(v, d);
      const calc = r => (ok(n(r, "caco3")) && n(r, "caco3") >= 1) || (ok(n(r, "ph_h2o")) && n(r, "ph_h2o") >= 7.8);
      const cols = [th("Pedon"), th("Distance"), th("Year"), th("Layer", "cm"), th("pH", "water"), th("EC", "dS/m"), th("Total N", "%"), th("P Bray-1", "mg/kg"), th("P Olsen", "mg/kg"), th("P Mehlich-3", "mg/kg"),
        th("K", "cmol(+)/kg"), th("Ca", "cmol(+)/kg"), th("Mg", "cmol(+)/kg"), th("Na", "cmol(+)/kg"), th("Total S", "%"), th("CEC7", "cmol(+)/kg"), th("CaCO₃", "%")];
      const html = rows.map(r => [`${esc(r.corr_name || r.samp_name || "")} <small>${esc(r.pedlabsampnum || "")}</small>`, dist(r.km) + ` ${esc(r.dir)}`, esc(r.year), `${f(n(r, "hzn_top"), 0)}–${f(n(r, "hzn_bot"), 0)}${r.hzn_desgn ? ` ${esc(r.hzn_desgn)}` : ""}`,
        f(n(r, "ph_h2o"), 1), f(n(r, "ec"), 2), f(n(r, "n_pct"), 3), f(n(r, "p_bray1"), 1), f(n(r, "p_olsen"), 1), f(n(r, "p_m3"), 1), f(n(r, "k"), 2), `${f(n(r, "ca"), 1)}${ok(n(r, "ca")) && calc(r) ? "*" : ""}`, f(n(r, "mg"), 2), f(n(r, "na"), 2), f(n(r, "s_pct"), 3), f(n(r, "cec7"), 1), f(n(r, "caco3"), 0)]);
      tables.kssl = { title: "NRCS KSSL lab-measured pedons nearby, surface layer", header: ["Pedon key", "Lab sample number", "Soil (correlated name)", "Distance (km)", "Direction", "Sampled", "Layer top (cm)", "Layer bottom (cm)", "Horizon", "pH (1:1 water)", "pH (CaCl2)", "EC saturated paste (dS/m)", "Total N (%)", "P Bray-1 (mg/kg)", "P Olsen (mg/kg)", "P Mehlich-3 (mg/kg)", "K NH4OAc pH 7 (cmol(+)/kg)", "Ca NH4OAc pH 7 (cmol(+)/kg)", "Mg NH4OAc pH 7 (cmol(+)/kg)", "Na NH4OAc pH 7 (cmol(+)/kg)", "Total S (%)", "CEC NH4OAc pH 7 (cmol(+)/kg)", "CaCO3 equivalent (%)", "Latitude", "Longitude"],
        rows: rows.map(r => [r.pedon_key, r.pedlabsampnum, r.corr_name || r.samp_name || "", r1(r.km), r.dir, r.obsdate ? String(r.obsdate).split(" ")[0] : "", n(r, "hzn_top"), n(r, "hzn_bot"), r.hzn_desgn || "", ...["ph_h2o", "ph_cacl2", "ec", "n_pct", "p_bray1", "p_olsen", "p_m3", "k", "ca", "mg", "na", "s_pct", "cec7", "caco3"].map(k => n(r, k)), num(r.lat), num(r.lon)]) };
      x.innerHTML = `<div class="card">${head("Lab-measured pedons nearby", "kssl", "NRCS soil lab")}${grid(cols, html)}
        <p class="fine">Measured at the USDA-NRCS Kellogg Soil Survey Laboratory on each pedon's surface layer (public domain, through Soil Data Access): K, Ca, Mg and Na exchangeable by ammonium acetate at pH 7 (1 cmol(+)/kg K = 391 mg/kg; Ca 200; Mg 122), P by the Bray-1, Olsen or Mehlich-3 extraction where run, total N and S by combustion. <b>Caveats:</b> pedons are sparse and often old (the year is the sampling date), sampled to describe the soil series rather than a field's fertility; blank cells were not measured. *Ammonium acetate dissolves carbonates, so Ca reads high in calcareous soils (CaCO₃ 1% or more, or pH 7.8 or more).</p></div>`;
    }, fail("smKssl", "the NRCS soil lab's pedons"));

    const ended = (k, v) => { if (run === me) { me.parts[k] = v; emit(`part:${k}`); } };
    const pParts = PARTS.map(p => Promise.resolve().then(() => { const x = at(`smPart-${p.key}`); return x && p.render(x, live, lat, lon); })
      .then(() => ended(p.key, "done"), e => { ended(p.key, e instanceof Error ? e : new Error(String(e))); fail(`smPart-${p.key}`, p.wait)(e); }));
    await Promise.allSettled([pSurvey, pUsfs, pN, pUsgs, pKssl, ...pParts]);
  };

  /* ---------- the Overview tab: the soil here at a glance, one tile per source with a link to its card ----------
     It asks nothing itself: it draws the Soil maps tab once per location into that tab's hidden box (Wx.show keeps it,
     so opening the tab afterwards reads nothing again), and fills from the same reads (Wx.once) and the tab's tables
     as each one answers; each tile waits or fails on its own. */
  // the pH reaction classes in five groups: the headline's colour and its scale
  const PH5 = [[5.55, "Strongly acid", "≤ 5.5", "#e34a33"], [6.55, "Acid", "5.6–6.5", "#fdbb84"], [7.35, "Neutral", "6.6–7.3", "#a6d96a"], [8.45, "Alkaline", "7.4–8.4", "#3288bd"], [99, "Strongly alkaline", "> 8.4", "#5e4fa2"]];
  const ph5 = v => (ok(v) ? PH5.findIndex(g => v < g[0]) + 1 : 0);
  // total N in g/kg, Landon (1991, after Metson 1961): very low < 1 (0.1%), low 1–2, medium 2–5, high 5–10, very high > 10
  const nClass = g => (!ok(g) ? "" : ["very low", "low", "medium", "high", "very high"][[1, 2, 5, 10].filter(l => g >= l).length]);
  const facts = rows => rows.filter(Boolean).map(([k, v, n]) => `<span class="k">${esc(k)}</span><span class="v">${esc(v)}</span><span class="n">${esc(n || "")}</span>`).join("");
  const rowOf = (t, re, unit) => (t && t.rows.find(r => re.test(String(r[0])) && (!unit || r[2] === unit))) || null;
  const val = r => (r && ok(num(r[1])) ? num(r[1]) : null);
  const TILES = [
    ["ph", "Soil pH, 0–15 cm", "survey", "#smSurvey"], ["salt", "Salinity · sodicity", "survey", "#smSurvey"], ["cec", "CEC · organic matter", "survey", "#smSurvey"],
    ["n", "Total nitrogen, 0–5 cm", "model", "#smN"], ["basin", "Watershed (HU12)", "model", "#smPart-basin", "basin"], ["storm", "Design-storm runoff", "TR-55", "#bsCnOut", "basin"],
    ["loss", "Soil loss (RUSLE)", "model", "#bsRusleOut", "basin"], ["smm", "Soil moisture today", "model", ".smm-m", "moisture"], ["stn", "Nearest station", "station", ".smm-st", "moisture"]];

  Wx.RENDER.soiloverview = async (el, live) => {
    const { lat, lon } = WG.state.site, tab = document.getElementById("tab-soilmaps");
    const pTab = tab ? Wx.show("soilmaps", tab) : Promise.resolve();
    const has = k => !k || PARTS.some(p => p.key === k), tiles = TILES.filter(t => has(t[4]));
    el.innerHTML = `<div class="risk-card so-head loading" id="soHead"></div>
      <div class="card">${head("At a glance", "", "")}<div class="stat-grid so-tiles">${tiles.map(t => `<div class="stat so-tile" id="so-${t[0]}"></div>`).join("")}</div>
        <p class="fine">Survey and model values describe typical soil here, not a test of a field; each tile's source is named on its card.</p></div>
      <div class="card">${head("On the map", "", "")}${chips()}</div>
      <div class="card cta"><div><h3>Soil chemistry in depth</h3><p class="fine">Every horizon of the survey, the 30 m maps, total nitrogen, USGS sites, NRCS lab pedons, the watershed and soil moisture by depth, with their tables (CSV).</p></div>
        <button class="btn primary" data-goto="soilmaps">Open Soil maps</button></div>`;
    const box = id => (live() ? el.querySelector(`#${id}`) : null);
    let S, N; // each: undefined while read, the value, or an Error
    const tile = (id, v, s) => { const x = box(`so-${id}`), t = tiles.find(q => q[0] === id); if (!x || !t) return;
      x.innerHTML = `<span class="k"><span>${esc(t[1])}</span><span class="tag">${esc(t[2])}</span></span>${v === undefined ? `<span class="v"><span class="skeleton" style="width:55%"></span></span><span class="s">${s}</span>`
        : `<span class="v">${v}</span><span class="s">${s}</span>`}${v === undefined ? "" : `<button class="link so-go" data-goto="soilmaps" data-so-go="${t[3]}">Details →</button>`}`; };
    const bad = e => `Could not read: ${esc(e.message || String(e))}`, u = (v, unit) => `${v}${unit ? ` <small>${esc(unit)}</small>` : ""}`;
    function draw() {
      if (!live()) return;
      /* the survey: the headline, pH, salinity and sodicity, CEC and organic matter of the dominant component, 0-15 cm */
      const top = S && !(S instanceof Error) && S.mu ? S.comps.filter(c => c.hz.length)[0] : null, l = top ? layerOf(top.hz, 0, 15) : null;
      const hd = box("soHead");
      if (hd) {
        const g = l ? ph5(l.ph) : 0, why = S === undefined ? "Reading the soil survey (SSURGO)…" : S instanceof Error ? `The soil survey could not be read: ${S.message}. Pick the location again to retry.`
          : !S.mu ? "No soil survey map unit here (water, or an area not surveyed)." : !l ? "The survey gives no horizon data for this soil." : "";
        hd.className = `risk-card so-head${S === undefined ? " loading" : ""}${g ? ` ph${g}` : ""}`;
        hd.innerHTML = `<div class="eyebrow">Soil here · soil survey, 0–15 cm</div>
          <div class="risk-level">${l && ok(l.ph) ? `${esc(l.cacl2 ? "pH (CaCl₂)" : reaction(l.ph))} · pH ${fmt(l.ph, 1)}` : S === undefined ? "Reading the survey…" : top ? esc(top.name) : "No survey data"}</div>
          <div class="risk-legend"><div class="risk-scale" role="list" aria-label="pH classes">${PH5.map((p, i) => `<div role="listitem" class="${i + 1 === g ? "on" : ""}" style="--c:${p[3]}"><b>${p[1]}</b><span>${p[2]}</span></div>`).join("")}</div>
            ${l ? `<div class="facts">${facts([["Soil", top.name, `${fmt(top.pct, 0)}% of map unit ${S.mu.sym}${top.kind && top.kind !== "Series" ? ` · ${top.kind}` : ""}`],
              ["Salinity, EC", ok(l.ec) ? `${fmt(l.ec, 1)} dS/m` : "—", salinity(l.ec)], ["Sodicity, SAR · ESP", `${fmt(l.sar, 1)} · ${ok(l.esp) ? `${fmt(l.esp, 0)}%` : "—"}`, sodicity(l.ec, l.sar, l.esp)],
              ["Organic matter", ok(l.om) ? `${fmt(l.om, 1)}%` : "—", ok(l.caco3) && l.caco3 > 0 ? `CaCO₃ ${fmt(l.caco3, 0)}%` : ""]])}</div>` : ""}</div>
          <p class="risk-text">${why ? esc(why) : `${esc(S.mu.name)} (${esc(S.mu.sym)} · ${esc(S.mu.area)}). ${esc(SURVEY_NOTE)}`}</p>
          <div class="risk-links"><button class="link risk-how" data-goto="soilmaps" data-so-go="#smSurvey">Chemistry by depth →</button><button class="link risk-how" data-methods="m-sources">Sources →</button></div>`;
      }
      const sw = "Reading the soil survey…";
      if (S === undefined) ["ph", "salt", "cec"].forEach(k => tile(k, undefined, sw));
      else if (S instanceof Error) ["ph", "salt", "cec"].forEach(k => tile(k, "—", bad(S)));
      else if (!l) ["ph", "salt", "cec"].forEach(k => tile(k, "—", S.mu ? "No horizon data" : "No survey map unit here"));
      else {
        tile("ph", ok(l.ph) ? `${fmt(l.ph, 1)}${l.cacl2 ? " <small>CaCl₂</small>" : ""}` : "—", `<b>${esc(l.cacl2 ? "in CaCl₂, about 0.5 below water pH" : reaction(l.ph))}</b> · ${esc(top.name)}`);
        const sod = sodicity(l.ec, l.sar, l.esp);
        tile("salt", ok(l.ec) ? u(fmt(l.ec, 1), "dS/m") : "—", `<b>${esc(salinity(l.ec) || "No EC")}</b>${sod ? ` · <b>${esc(sod)}</b>` : ""} · SAR ${fmt(l.sar, 1)}, ESP ${ok(l.esp) ? `${fmt(l.esp, 0)}%` : "—"}`);
        tile("cec", ok(l.cec) ? u(fmt(l.cec, 1), `cmol(+)/kg${l.ecec ? " ECEC" : ""}`) : "—", `Organic matter <b>${ok(l.om) ? `${fmt(l.om, 1)}%` : "—"}</b>${ok(l.bs) ? ` · base saturation ${fmt(Math.min(100, l.bs), 0)}%` : ""}`);
      }
      /* SoilGrids' total N, 0-5 cm */
      const n0 = N && !(N instanceof Error) ? N.find(r => r.t === 0) : null;
      if (N === undefined) tile("n", undefined, "Reading SoilGrids…");
      else if (N instanceof Error) tile("n", "—", bad(N));
      else tile("n", n0 && ok(n0.mean) ? u(fmt(n0.mean, 2), "g/kg") : "—", n0 && ok(n0.mean) ? `<b>${esc(nClass(n0.mean))}</b> (Landon 1991) · ${fmt(n0.mean / 10, 3)}% · SoilGrids` : "SoilGrids gives no value at this point");
      /* the parts of other files: their tables, or how the part ended */
      const T = tables, st = k => (run.tok === WG.state.token ? run.parts[k] : undefined);
      const later = (k, id, what, f) => { const s = st(k); if (s instanceof Error) return tile(id, "—", bad(s)); const r = f(); if (r) return tile(id, ...r); tile(id, s === "done" ? "—" : undefined, s === "done" ? "Not given here: its card says why" : `Reading ${esc(what)}…`); };
      if (has("basin")) {
        const B = T.basin, name = rowOf(B, /^HU12 name$/), huc = rowOf(B, /^HU12$/), mm = val(rowOf(B, /mean annual runoff/i));
        const hn = name ? `<b>${esc(name[1])}</b>${huc ? ` · HUC ${esc(huc[1])}` : ""}` : "";
        // the HU12's name as soon as it is known, its runoff when the NHDPlus HR network has been read
        later("basin", "basin", "the watershed", () => (ok(mm) ? [`${UN.fmt("precip", mm)} <small>/yr</small>`, `Mean annual runoff of ${hn || "the HU12"}`]
          : !hn ? null : st("basin") === "done" ? ["—", `${hn}: no mean annual runoff; its card says why`] : [undefined, `${hn}: reading its mean annual runoff…`]));
        const q = val(rowOf(B, /^Storm runoff Q/)), pr = rowOf(B, /^Storm depth/), p = val(pr), yr = pr && /(\d+)-yr/.exec(pr[3] || "");
        later("basin", "storm", "design-storm runoff", () => (ok(q) && ok(p) ? [UN.fmt("precip", q), `<b>${fmt((100 * q) / p, 0)}% of the rain</b> of the ${yr ? `${yr[1]}-year` : "chosen"}, 24-hour storm (${UN.fmt("precip", p)})`] : null));
        const R = T.basin_rusle, a = val(rowOf(B, /^Soil loss A, all land/, "t/ac/yr")) ?? val(rowOf(R, /^A, all land/)), tf = val(rowOf(B, /^T$/, "t/ac/yr")) ?? val(rowOf(R, /^T, tolerable/));
        later("basin", "loss", "soil loss", () => (ok(a) ? [UN.fmt("soilLoss", a, a < 10 ? 1 : 0), ok(tf) && tf > 0 ? `<b>${fmt(a / tf, a / tf < 1 ? 2 : 1)} × T</b>: ${a <= tf ? "within" : "above"} the tolerable loss · all land in the HU12` : "gross sheet and rill erosion · all land in the HU12"] : null));
      }
      if (has("moisture")) {
        const M = T.moisture_models, ifs = M ? M.rows.filter(r => /^ECMWF IFS/.test(r[0])) : [], era = M ? M.rows.filter(r => /^ERA5/.test(r[0])) : [], use = ifs.length ? ifs : era;
        const day = use.reduce((m, r) => (r[4] > m ? r[4] : m), ""), at = (a, b) => { const r = use.find(x => x[2] === a && x[3] === b && x[4] === day); return r && ok(r[5]) ? r[5] : null; };
        const v0 = at(0, 7), v28 = at(28, 100);
        later("moisture", "smm", "soil moisture models", () => (ok(v0) ? [u(fmt(v0, 2), "m³/m³"), `0–7 cm · 28–100 cm <b>${ok(v28) ? fmt(v28, 2) : "—"}</b> · ${ifs.length ? "ECMWF IFS, today" : `ERA5-Land, ${esc(day)}`}`] : null));
        const Sx = T.moisture_stations, rows = Sx && Sx.rows.length ? Sx.rows.filter(r => r[0] === Sx.rows[0][0] && ok(r[7])) : [], cm = rows.length ? Math.min(...rows.map(r => r[5])) : null;
        const atD = rows.filter(r => r[5] === cm), last = atD.find(r => /latest/.test(r[9])) || atD.reduce((m, r) => (!m || r[6] > m[6] ? r : m), null);
        later("moisture", "stn", "soil moisture station within 400 km", () => (last ? [u(fmt(last[7], 2), "m³/m³"), `${esc(last[4])} · ${esc(String(last[6]))} · <b>${esc(last[0])}</b>, ${esc(last[1])}, ${dist(last[3])}`] : null));
      }
    }
    let t = 0;
    const off = on(() => { if (!live()) return off(); clearTimeout(t); t = setTimeout(draw, 30); });
    draw();
    const pS = survey(lat, lon).then(v => { S = v; }, e => { S = e instanceof Error ? e : new Error(String(e)); }).then(draw);
    const pN = sgN(lat, lon).then(v => { N = v; }, e => { N = e instanceof Error ? e : new Error(String(e)); }).then(draw);
    await Promise.allSettled([pS, pN, pTab]);
    draw();
  };
  // a tile's or the headline's Details: the Soil maps tab (app.js shows it on data-goto), scrolled to the card
  document.addEventListener("click", e => {
    const b = e.target.closest && e.target.closest("[data-so-go]"), tab = document.getElementById("tab-soilmaps"), pb = document.getElementById("panelBody");
    if (!b || !tab || !pb) return;
    setTimeout(() => {
      const x = tab.querySelector(b.dataset.soGo), card = x && (x.closest(".card") || x.querySelector(".card") || x);
      if (!card || tab.hidden) return;
      pb.scrollTo({ top: Math.max(0, card.getBoundingClientRect().top - pb.getBoundingClientRect().top + pb.scrollTop - 8), behavior: "smooth" });
      card.classList.remove("so-flash"); void card.offsetWidth; card.classList.add("so-flash");
    }, 0);
  });

  return { init(h) { hooks = h; WG.map.on("layeradd layerremove", chipSoon); }, pick, layers: LAYERS, legendOf, choose, tables: () => tables, chemLegend, addPart: p => PARTS.push(p), sda, km, head, grid, th, r1, showBtn,
    on, chips, syncChips,
    // classes and the depth-weighting the tab uses, and each source at any point (plain async functions of lat, lon)
    PH, CEC, OM, reaction, salinity, sodicity, over, layerOf, surveyAt, usfsSamples, sgNAt, usgsNearAt, ksslAt, DS_COL, DEPTHS, SGD, ELS };
})();
