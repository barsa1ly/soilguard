/* Soil moisture by depth, in the Soil maps theme: its map layers and its own tab, Soil moisture.
   Map layers (pushed onto the theme's list, which app.js reads after this file has loaded): NASA SMAP Level-4 surface
   (0-5 cm) and root-zone (0-100 cm) soil moisture through NASA GIBS, any day since 31 March 2015; the NOAA National
   Water Model's near-surface saturation (0-40 cm), the latest hour; the NASA SPoRT-LIS (0-100 cm) and GRACE-DA root-zone
   percentiles through NOAA NIDIS's drought.gov tiles, the latest day or week; and the soil moisture stations (USDA NRCS
   SCAN and SNOTEL, NOAA USCRN) from data/soilmoisture_stations.json (tools/build_moisture.py).
   The tab (Wx.RENDER.soilmoist) gives, at the point, over a chosen period: the models by depth (ERA5-Land reanalysis, any
   day since 1950; ECMWF IFS, the last 92 days and today, both through Open-Meteo), SMAP L4 at its 9 km cell (USDA NASS
   Crop-CASMA, since 31 March 2015), the National Water Model's four layers on request (read in place from NOAA's files on
   AWS with js/h5range.js) and the three nearest stations' daily means; the chosen years against each other and the
   average of the years before; and a table of what is shown. Its period controls follow the Rain and Temperature tabs'
   (js/weather.js) but are written here: the public SoilGuard copy has neither tab. summary() gives the Overview's
   moisture rows from the same reads. Each value says what it is: a model, a satellite analysis or a station's
   measurement, in m³/m³ (volume of water per volume of soil; stations that report % are divided by 100). Every source
   here is free and answers a browser (CORS); none needs a key. */
WG.soilmoisture = (function () {
  const SM = WG.soilmaps, Wx = WG.weather, UN = WG.units;
  if (!SM) return null;
  const { esc, fmt, fetchJSON, fetchText, compass } = WG.util;
  const num = v => (v === null || v === undefined || v === "" || !Number.isFinite(+v) ? null : +v);
  const ok = v => v !== null && v !== undefined && Number.isFinite(v);
  const V = ((document.currentScript || {}).src || "").split("v=")[1] || "1"; // this file's cache tag, for the station list
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const iso = d => new Date(d * 864e5).toISOString().slice(0, 10);
  const dayOf = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 864e5;
  const today = () => { const t = new Date(); return Date.UTC(t.getFullYear(), t.getMonth(), t.getDate()) / 864e5; }; // the viewer's calendar day, as the models' local days
  const DAYS = 30;

  /* ---------- NASA SMAP L4 through GIBS: one map a day at 12:00 UTC, about three days behind ---------- */
  const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/";
  const SMAP_L = { sf: "SMAP_L4_Analyzed_Surface_Soil_Moisture", rz: "SMAP_L4_Analyzed_Root_Zone_Soil_Moisture" };
  const SMAP0 = "2015-03-31";
  // GIBS's colormap SMAP_Analyzed_Soil_Moisture (255 steps of 0.00275 m³/m³), one colour each 0.02 from 0 to 0.70
  const SMAP_RAMP = ["#ffaa00", "#ffbd00", "#ffcd00", "#ffde00", "#ffee00", "#fffd00", "#e1f000", "#b8db00", "#8ec600", "#5faf00", "#359a00", "#0c8500", "#008f1f", "#00a851", "#00bd7c", "#00d3a8", "#00e9d3", "#00ffff",
    "#00dbff", "#00b2ff", "#0088ff", "#0059ff", "#002fff", "#0006ff", "#0000e9", "#0000cd", "#0000b3", "#00009a", "#00007d", "#000064", "#0e0e64", "#1c1c64", "#2c2c5a", "#3a3a5a", "#484850"];
  const pick = { date: null }; // null: the latest map
  /* the days GIBS holds (DescribeDomains): intervals such as 2026-09-01/2026-11-06/P1D, with gaps where SMAP had none */
  let domP = null;
  const smapDays = () => (domP = domP || fetchText(`${GIBS}1.0.0/${SMAP_L.rz}/default/GoogleMapsCompatible_Level6/all/${SMAP0}--${iso(today())}.xml`, 20000).then(t => {
    const d = (/<Domain>([^<]+)<\/Domain>/.exec(t) || [])[1];
    if (!d) throw new Error("GIBS gave no dates");
    const spans = d.split(",").map(s => s.split("/").slice(0, 2));
    return { spans, latest: spans[spans.length - 1][1] };
  }).catch(e => { domP = null; throw e; }));
  const hasMap = (D, s) => D.spans.some(([a, b]) => s >= a && s <= b);
  const smapUrl = (k, date) => `${GIBS}${SMAP_L[k]}/default/${date || "default"}/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png`;
  const tiles = (url, o) => L.tileLayer(url, { pane: "thematic", maxZoom: 19, tileSize: 256, ...o });
  // in CORS mode (GIBS allows it): the time slider's GIF draws the tiles as they are, without asking for them twice
  const smapSf = tiles(smapUrl("sf"), { maxNativeZoom: 6, crossOrigin: "anonymous", attribution: "NASA GIBS; SMAP L4 (NASA GMAO)" });
  const smapRz = tiles(smapUrl("rz"), { maxNativeZoom: 6, crossOrigin: "anonymous", attribution: "NASA GIBS; SMAP L4 (NASA GMAO)" });
  // the chosen day; the latest is GIBS's "default" time, so nothing is asked before the layer is shown
  function smapSet() { smapSf.setUrl(smapUrl("sf", pick.date)); smapRz.setUrl(smapUrl("rz", pick.date)); redrawLegend(); document.dispatchEvent(new Event("wg-mapdate")); }
  /* the day the SMAP map shows when a past day is chosen (its slider, its legend's picker) and a SMAP layer is on, else
     null: the Soil maps Overview's moisture rows follow it ("wg-mapdate", js/soilmaps.js) */
  const mapDay = () => (pick.date && WG.map && [smapSf, smapRz].some(l => WG.map.hasLayer(l)) ? dayOf(pick.date) : null);
  [smapSf, smapRz].forEach(l => l.on("add remove", () => document.dispatchEvent(new Event("wg-mapdate"))));

  /* ---------- NOAA National Water Model: near-surface saturation, the latest hour ---------- */
  const NWM_MS = "https://mapservices.weather.noaa.gov/raster/services/obs/NWM_Land_Analysis/MapServer/WMSServer";
  const NWM_REST = "https://mapservices.weather.noaa.gov/raster/rest/services/obs/NWM_Land_Analysis/MapServer/";
  const nwmLayer = L.tileLayer.wms(NWM_MS, { layers: "3", format: "image/png", transparent: true, pane: "thematic", maxZoom: 19, attribution: "NOAA Office of Water Prediction, National Water Model" });
  /* a new analysis each hour: while the layer is on, its tiles are asked again each half hour (and at once when it is
     turned on after more than that); the timer runs only while the layer is on */
  let nwmTick = null, nwmT = Date.now();
  const nwmFresh = () => { nwmT = Date.now(); nwmLayer.setParams({ _t: nwmT }); };
  nwmLayer.on("add", () => { if (Date.now() - nwmT > 30 * 60e3) nwmFresh(); clearInterval(nwmTick); nwmTick = setInterval(nwmFresh, 30 * 60e3); })
    .on("remove", () => { clearInterval(nwmTick); nwmTick = null; });
  // the service's 11 classes (its legend, MapServer/legend), in % of saturation
  const NWM_ROWS = [["#a60027", "0–5"], ["#c94d3a", "5–15"], ["#eb8d52", "15–25"], ["#ffbc70", "25–35"], ["#ffde96", "35–45"], ["#ffffbf", "45–55"], ["#dff0d1", "55–65"], ["#bce0e0", "65–75"], ["#91b4d9", "75–85"], ["#606db5", "85–95"], ["#323794", "95–100 (saturated)"]];
  const utcLabel = ms => `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;
  // the hour the service shows, for the legend's title: kept half an hour, as long as its tiles
  const nwmDate = () => Wx.fresh("nwm", 30, () => fetchJSON(`${NWM_REST}2/query?where=1%3D1&outFields=idp_validtime&returnGeometry=false&f=json`, {}, 20000)
    .then(j => { const t = num((((j.features || [])[0] || {}).attributes || {}).idp_validtime); if (!t) throw new Error("no valid time from the National Water Model's service"); return Wx.timeLabel(t); }));

  /* ---------- NOAA NIDIS (drought.gov) percentile tiles: the latest day (SPoRT) or week (GRACE) ---------- */
  const NIDIS = "https://storage.googleapis.com/noaa-nidis-drought-gov-data/current-conditions/tile/v1/";
  const US_BOX = L.latLngBounds([24.4, -128.8], [50.3, -66.0]); // the tiles' extent (info.json bbox): no requests outside
  // the day or week the tiles show (their info.json), for the legend's title: kept an hour
  const nidisDate = k => () => Wx.fresh(`nidis:${k}`, 60, () => fetchJSON(`${NIDIS}${k}/info.json`, {}, 20000)).then(j => { const d = String(j.date || ""); return /^\d{8}$/.test(d) ? WG.wind.dayLabel(dayOf(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`)) : null; });
  // classes as drought.gov draws them; colours read from the tiles. Dry classes match the Drought Monitor's D4 to D0.
  const DRY = [["#730000", "0–2 (driest; like D4)"], ["#e60000", "2–5 (D3)"], ["#ffaa00", "5–10 (D2)"], ["#fcd37f", "10–20 (D1)"], ["#ffff00", "20–30 (D0)"]];
  const SPORT_ROWS = [...DRY, ["#c8c8c8", "30–70 near normal"], ["#e1ffff", "70–80"], ["#96d2fa", "80–90"], ["#50a5f5", "90–95"], ["#2882f0", "95–98"], ["#1464d2", "98–100 (wettest)"]];
  const GRACE_ROWS = [...DRY, ["transparent", "30–70 near normal (not coloured)"], ["#8ccdef", "70–80"], ["#00bfff", "80–90"], ["#1d90ff", "90–95"], ["#4169e1", "95–98"], ["#0000ff", "98–100 (wettest)"]];
  const sport = tiles(`${NIDIS}nasa-sport-3km/{z}/{x}/{y}.png`, { minNativeZoom: 2, maxNativeZoom: 9, bounds: US_BOX, attribution: "NASA SPoRT-LIS via NOAA NIDIS (drought.gov)" });
  const grace = tiles(`${NIDIS}nasa-rtzsm-0.125d/{z}/{x}/{y}.png`, { minNativeZoom: 2, maxNativeZoom: 7, bounds: US_BOX, attribution: "NASA GRACE-DA (NASA GSFC, NDMC) via NOAA NIDIS (drought.gov)" });

  /* ---------- the stations: data/soilmoisture_stations.json, read once ---------- */
  const NET = { SCAN: ["SCAN", "USDA NRCS Soil Climate Analysis Network", "#2a78d6"], SNTL: ["SNOTEL", "USDA NRCS Snow Telemetry", "#1baf7a"], CSCAN: ["CSCAN", "USDA NRCS cooperative SCAN", "#6250d6"],
    SNTLT: ["SNOTEL-lite", "USDA NRCS SNOTEL-lite", "#1baf7a"], CRN: ["USCRN", "NOAA U.S. Climate Reference Network", "#eb6834"] };
  let stP = null;
  const stations = () => (stP = stP || fetchJSON(`data/soilmoisture_stations.json?v=${V}`, {}, 20000).then(j => [
    ...j.awdb.map(([id, name, lat, lon, ft, deps, since]) => ({ src: "awdb", id, net: id.split(":")[2], name, lat, lon, ft, since, depths: deps.map(d => ({ key: d, cm: d * 2.54, label: `${d} in` })) })),
    ...j.crn.map(([id, stem, name, lat, lon, ft, deps, since]) => ({ src: "crn", id, stem, net: "CRN", name, lat, lon, ft, since, depths: deps.map(d => ({ key: d, cm: d, label: `${d} cm` })) })),
  ]).catch(e => { stP = null; throw e; }));
  // circles that pass a tap on to the map, which picks the point there: the tab then shows that station first
  const StationSet = L.FeatureGroup.extend({
    onAdd(m) { L.FeatureGroup.prototype.onAdd.call(this, m); if (!this._filled) stations().then(list => { if (this._filled) return; this._filled = true; list.forEach(s => this.addLayer(L.circleMarker([s.lat, s.lon], { radius: 5, weight: 1.5, color: "#fff", fillColor: NET[s.net][2], fillOpacity: 0.95 })
      .bindTooltip(`${esc(s.name)} · ${NET[s.net][0]} ${esc(s.src === "crn" ? s.id : s.id.split(":")[0])}<br>sensors at ${s.depths.map(d => d.label).join(", ")}`, { direction: "top" }))); }, e => WG.util.toast(`The station list could not be read: ${e.message}`)); },
    setOpacity() { return this; }, // app.js fades every live layer with the opacity slider; the dots stay solid
  });
  const stationLayer = new StationSet();

  /* ---------- the layers and their legends ---------- */
  const M3 = "m³/m³ = volume of water in a volume of soil: 0.25 is 25% water by volume.";
  const SMAP_NOTE = (depth, more) => `NASA SMAP Level-4 analysis (NASA GMAO, product SPL4SMAU): the SMAP satellite's microwave readings merged into a land surface model, 9 km, the day's 12:00 UTC value; ${depth}. ${more} ${M3} Daily since 31 March 2015, about 3 days behind, with a few gaps. Through NASA GIBS (NASA open data). A model-and-satellite estimate, not a measurement at a field.`;
  /* what a m³/m³ value means for this soil: the dominant soil's surface horizon, wilting point (15 bar, LL) and field capacity
     (1/3 bar, DUL), from the survey already read for the wind erosion (no request); else typical values */
  const soilRange = () => {
    let r = null;
    try { const d = WG.state.soil && !WG.state.soil.error ? WG.state.soil.dominant : null, l = d ? WG.soil.profileLayers(d)[0] : null; r = l && ok(l.ll) && ok(l.dul) ? l : null; } catch (e) { r = null; }
    return r ? `this soil: wilting point about ${fmt(r.ll, 2)}, field capacity about ${fmt(r.dul, 2)}` : "roughly: under 0.10 dry, 0.20–0.35 moist, 0.40–0.50 near saturation; clays hold more";
  };
  const pctW = v => (ok(v) ? ` = ${fmt(100 * v, 0)}% water by volume` : "");
  const PCT_NOTE = "A percentile ranks today's soil moisture against the same time of year in the model's record: 10 means drier than 90% of those days. It says how unusual the moisture is, not how much water there is.";
  let lastLegend = null;
  const ctlHtml = D => {
    const latest = D ? D.latest : "", shown = pick.date || latest;
    return `<div class="sm-ctl smm-ctl"><label>Day (12:00 UTC)<input type="date" data-smm="date" min="${SMAP0}" max="${latest || iso(today())}" value="${shown}"></label>
      <label><span>&nbsp;</span><button type="button" class="smm-latest" data-smm-latest ${pick.date ? "" : "disabled"}>Latest${latest ? ` · ${latest}` : ""}</button></label></div>`;
  };
  function drawLegend(el, it, min, toggle) {
    lastLegend = [el, it, min, toggle];
    Wx.legend(el, it, min, toggle);
    const h = el.querySelector("h5");
    if (!h || !it.dated) return;
    h.insertAdjacentHTML("afterend", `<div class="smm-ctl-box">${ctlHtml(null)}</div>`);
    smapDays().then(D => { const b = el.querySelector(".smm-ctl-box"); if (b && it.on) b.innerHTML = ctlHtml(D); }, () => {});
  }
  function redrawLegend() { if (lastLegend && lastLegend[1].on) drawLegend(...lastLegend); }
  // the day shown, in the legend's title: the one chosen, else the latest GIBS holds; the note says only which
  const smapDate = () => (pick.date ? WG.wind.dayLabel(dayOf(pick.date)) : smapDays().then(D => WG.wind.dayLabel(dayOf(D.latest))));
  const smapWhen = () => smapDays().then(D => { const d = pick.date || D.latest; return !hasMap(D, d) ? `GIBS has no SMAP map for ${d}: choose another day.` : pick.date ? "" : "The latest map GIBS holds."; });
  const item = (key, name, sub, layer, legend, note, o = {}) => ({ key, name, sub, layer, legend, note, drawLegend, opacity: 1.2, ...o });
  const LAYERS = [
    item("smap_sf", "Soil moisture, surface 0–5 cm", "NASA SMAP L4, 9 km, any day since 2015", smapSf, { title: "Soil moisture, 0–5 cm (SMAP L4)", unit: "m³/m³: 0.25 = 25% water by volume", scale: SMAP_RAMP, ticks: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7].map(v => [v / 0.7, v === 0.7 ? "≥0.7" : String(v)]) },
      SMAP_NOTE("surface layer 0–5 cm", ""), { dated: true, when: smapWhen, dateOf: smapDate }),
    item("smap_rz", "Soil moisture, root zone 0–100 cm", "the same, the top metre", smapRz, { title: "Soil moisture, 0–100 cm (SMAP L4)", unit: "m³/m³: 0.25 = 25% water by volume", scale: SMAP_RAMP, ticks: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7].map(v => [v / 0.7, v === 0.7 ? "≥0.7" : String(v)]) },
      SMAP_NOTE("root zone 0–100 cm", "The model carries the surface readings down; the satellite itself sees only the top few centimetres."), { dated: true, when: smapWhen, dateOf: smapDate }),
    item("nwm", "Soil saturation 0–40 cm, this hour", "NOAA National Water Model, 1 km, % of saturation", nwmLayer, { title: "Soil saturation, 0–40 cm (NWM)", unit: "% of saturation: 0 = dry, 100 = all pores full", rows: NWM_ROWS },
      "How full the soil's pores are in the top 40 cm (100% = saturated), from the NOAA National Water Model's hourly land analysis (Noah-MP, 1 km, version 3.0; public domain). A model: its soils and rain differ from a field's, and it often reads wetter than stations in dry country. Only the latest hour is served.", { dateOf: nwmDate, refresh: 30 }),
    item("sport", "Soil moisture percentile 0–100 cm", "NASA SPoRT-LIS, 3 km, today", sport, { title: "Soil moisture percentile, 0–100 cm (SPoRT-LIS)", unit: "percentile: 10 = drier than 90% of days at this time of year", rows: SPORT_ROWS },
      `${PCT_NOTE} NASA SPoRT's Land Information System (Noah model, 3 km), daily, against its 1981–2013 record. Through NOAA NIDIS (drought.gov); only the latest day is served.`, { dateOf: nidisDate("nasa-sport-3km") }),
    item("grace", "Root-zone moisture percentile", "NASA GRACE-DA, 12 km, weekly", grace, { title: "Root-zone soil moisture percentile (GRACE-DA)", unit: "percentile: 10 = drier than 90% of weeks at this time of year", rows: GRACE_ROWS },
      `${PCT_NOTE} NASA GRACE-FO satellite gravity (total water storage) assimilated into the Catchment land model (NASA GSFC, with the National Drought Mitigation Center), root zone about 0–100 cm, 0.125°, weekly, against 1948–2012. Through NOAA NIDIS (drought.gov); only the latest week is served.`, { dateOf: nidisDate("nasa-rtzsm-0.125d") }),
    item("stations", "Soil moisture stations", "USDA SCAN and SNOTEL, NOAA USCRN: tap one", stationLayer, { title: "Soil moisture stations", rows: [["#2a78d6", "SCAN (USDA NRCS), 2–40 in"], ["#6250d6", "CSCAN (USDA NRCS cooperative)"], ["#1baf7a", "SNOTEL (USDA NRCS), mountains"], ["#eb6834", "USCRN (NOAA), 5–100 cm"]] },
      "Stations that measure soil moisture by depth and report it every hour. Tap a station (or any point): the Soil moisture tab gives the three nearest, their latest readings and their daily means over the chosen period. List of active stations made with tools/build_moisture.py."),
  ];
  /* how each map's classes are measured for the legend's % column (js/shares.js): the tiles of the box at a low zoom
     (SMAP from GIBS, its scale cut at the legend's ticks; drought.gov's percentiles), the National Water Model as one
     export of the box from its ArcGIS service (its WMS draws nothing at a whole state's scale) */
  const NIDIS_BOX = [US_BOX.getSouth(), US_BOX.getWest(), US_BOX.getNorth(), US_BOX.getEast()];
  // the day shown: the one chosen, else the latest GIBS holds (kept once read, so the latest chosen again is known at once)
  let smapLatest = null;
  const smapTag = () => pick.date || smapLatest || smapDays().then(D => (smapLatest = D.latest));
  // the tiles of the day in the tag, not of pick.date when measured: the slider may have moved on by the time its turn comes
  const smapShares = k => ({ id: `smap_${k}`, tiles: { url: t => smapUrl(k, /^\d{4}-\d\d-\d\d$/.test(t || "") ? t : pick.date), zmin: 2, zmax: 6 }, tag: smapTag, none: "No data (water, or not modelled)", full: true });
  const SHARES = { smap_sf: smapShares("sf"), smap_rz: smapShares("rz"), nwm: { id: "nwm", rest: { url: NWM_REST.replace(/\/$/, ""), id: 3 }, none: "No data", full: true },
    sport: { id: "sport", tiles: { url: `${NIDIS}nasa-sport-3km/{z}/{x}/{y}.png`, zmin: 2, zmax: 9, bounds: NIDIS_BOX }, none: "No data (water, or outside the model)" },
    // GRACE leaves near normal clear: its legend's clear row takes the uncoloured share
    grace: { id: "grace", tiles: { url: `${NIDIS}nasa-rtzsm-0.125d/{z}/{x}/{y}.png`, zmin: 2, zmax: 7, bounds: NIDIS_BOX }, none: "Near normal (30th–70th percentile, not coloured)" } };
  LAYERS.forEach(x => { if (SHARES[x.key]) x.shares = SHARES[x.key]; SM.layers.push(x); });
  const T = Wx.THEMES.find(t => t.key === "soilmaps");
  if (T) T.note = `${T.note} Soil moisture: NASA SMAP by day since 2015, the National Water Model's saturation, drought.gov's percentiles and the stations that measure it; the Soil moisture tab gives the models, SMAP and the stations by depth over any period since 1950, year against year.`;

  /* the time slider (js/timeslider.js): SMAP's days since 31 March 2015 that GIBS holds, on both layers, the day the
     legend's picker shows (the slider moves pick.date as the picker does; the legend, drawn again, shows the day) */
  let smapD = null; // the days GIBS holds as epoch days: spans and the latest, once read
  const smapRead = () => smapDays().then(D => (smapD = smapD && smapD.D === D ? smapD : { D, latest: dayOf(D.latest), spans: D.spans.map(([a, b]) => [dayOf(a), dayOf(b || a)]) }));
  const smapFrames = (a, b) => { const out = []; (smapD ? smapD.spans : [[dayOf(SMAP0), b]]).forEach(([x, y]) => { for (let d = Math.max(a, x), e = Math.min(b, y); d <= e; d++) out.push(d); }); return out; };
  // the day on the map; a promise that resolves when its tiles are in (at most 8 s), at once when nothing changed
  function smapShow(day, layer) {
    pick.date = smapD && day >= smapD.latest ? null : iso(day);
    const was = layer._url, p = new Promise(r => { layer.once("load", r); setTimeout(r, 8000); });
    smapSet();
    return layer._url === was || !layer._map ? Promise.resolve() : p;
  }
  const smapDay = d => (smapD && d >= smapD.latest ? "default" : iso(d)); // the latest is GIBS's default time, as smapUrl asks for it
  LAYERS.filter(x => x.key === "smap_sf" || x.key === "smap_rz").forEach(it => (WG.tsAdapters = WG.tsAdapters || []).push({
    key: it.key.replace("_", "-"), item: it, label: it.key === "smap_sf" ? "Soil moisture 0–5 cm (SMAP L4)" : "Soil moisture 0–100 cm (SMAP L4)", start: dayOf(SMAP0), step: "day",
    end: () => smapRead().then(x => x.latest), frames: smapFrames, show: d => smapShow(d, it.layer),
    current: () => (pick.date ? dayOf(pick.date) : smapD ? smapD.latest : null), dateLabel: d => WG.wind.dayLabel(d),
    prefetch: d => WG.timeslider.prefetch(it.layer, s => s.replace(/\/default\/[^/]+\/GoogleMapsCompatible/, `/default/${smapDay(d)}/GoogleMapsCompatible`)) }));

  // the day chosen under the SMAP legend
  function setDate(v) { pick.date = v || null; smapDays().then(D => { if (pick.date === D.latest) pick.date = null; }, () => {}).then(smapSet); }
  document.addEventListener("change", e => { const s = e.target.closest && e.target.closest('[data-smm="date"]'); if (s && /^\d{4}-\d\d-\d\d$/.test(s.value)) setDate(s.value < SMAP0 ? SMAP0 : s.value); });
  document.addEventListener("click", e => { const b = e.target.closest && e.target.closest("[data-smm-latest]"); if (b) { e.preventDefault(); setDate(null); } const n = e.target.closest && e.target.closest("[data-smm-nwm]"); if (n) { e.preventDefault(); nwmClick(n); } });

  /* ---------- each source at a point: plain async functions of lat, lon ---------- */
  const OM_D = [[0, 7], [7, 28], [28, 100], [100, 255]], OM_V = OM_D.map(([a, b]) => `soil_moisture_${a}_to_${b}cm`);
  /* Open-Meteo's longer answers (31 days of hours) now and then miss the 30 s cap while the page waits on many other
     sources, and answer in a few seconds when asked again: one more try, with 45 s */
  const omJSON = url => fetchJSON(url, {}, 30000).catch(() => new Promise(r => setTimeout(r, 1000)).then(() => fetchJSON(url, {}, 45000)));
  const utcDay = () => Math.floor(Date.now() / 864e5); // the archive refuses an end date after the UTC day, which can be behind the viewer's
  /* ERA5-Land (Copernicus reanalysis, 0.1°), daily means of the local day over days a..b, each depth an array from a: about
     a week behind, the days not in yet come back empty. Any span since 1950 in one request (11 years: about 1 s). */
  async function era5Range(lat, lon, a, b) {
    const j = await omJSON(`https://archive-api.open-meteo.com/v1/archive?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&start_date=${iso(a)}&end_date=${iso(Math.min(b, utcDay()))}&daily=${OM_V.map(v => `${v}_mean`).join(",")}&models=era5_land&timezone=auto`);
    const d = j.daily || {}, t = d.time || [];
    return { lat: j.latitude, lon: j.longitude, a: t.length ? dayOf(t[0]) : a, v: OM_V.map(v => (d[`${v}_mean`] || []).map(num)) };
  }
  // the same as one series a depth, [[day, m³/m³]] (by default the last 42 days, to have 30 with values)
  async function era5At(lat, lon, a = today() - DAYS - 12, b = today()) {
    const R = await era5Range(lat, lon, a, b);
    return { lat: R.lat, lon: R.lon, series: OM_D.map(([x, y], k) => ({ a: x, b: y, pts: R.v[k].map((v, i) => [R.a + i, v]).filter(p => ok(p[1])) })) };
  }
  /* ECMWF IFS (9 km), hourly from its successive runs: the past days (31, or up to 92) and today, as daily means of the local day */
  async function ifsAt(lat, lon, past = DAYS + 1) {
    const j = await omJSON(`https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&hourly=${OM_V.join(",")}&models=ecmwf_ifs&past_days=${past}&forecast_days=1&timezone=auto`);
    const h = j.hourly || {}, times = h.time || [];
    return { lat: j.latitude, lon: j.longitude, tz: j.timezone_abbreviation || "", series: OM_D.map(([a, b], k) => {
      const by = new Map();
      times.forEach((s, i) => { const v = num((h[OM_V[k]] || [])[i]); if (!ok(v)) return; const d = dayOf(s), g = by.get(d) || [0, 0]; g[0] += v; g[1]++; by.set(d, g); });
      return { a, b, pts: [...by].sort((x, y) => x[0] - y[0]).map(([d, [s, n]]) => [d, s / n]) };
    }) };
  }
  /* SMAP L4 at its 9 km cell, daily averages of the 3-hourly analyses, from USDA NASS Crop-CASMA's service (GET only:
     its POST preflight is refused); the cell is asked in EPSG:5070 metres (js/landcover.js albers). The service answers
     at most 200 days a request, and takes up to half a minute for that many: a longer span is asked in parts at once. */
  const CASMA = "https://nassgeo.csiss.gmu.edu/smap_service?service=WPS&version=1.0.0&request=Execute&identifier=GetProfileByDate&DataInputs=", CASMA_MAX = 200;
  // one layer, p "TOP" (0-5 cm) or "SUB" (the root zone, 0-100 cm): [[day, m³/m³]]
  async function smapLayer(lat, lon, p, d0, d1) {
    if (!WG.landcover || !WG.landcover.albers) throw new Error("the Albers projection (js/landcover.js) is not loaded");
    const [x, y] = WG.landcover.albers(lon, lat), dot = d => iso(d).replace(/-/g, ".");
    const one = async (a, b) => {
      const t = await fetchText(`${CASMA}productId=SMAP-9KM-DAILY-${p};x=${Math.round(x)};y=${Math.round(y)};startDate=${dot(a)};endDate=${dot(b)}`, 60000);
      const u = (/https?:\/\/[^<\s"]+\.csv/.exec(t) || [])[0];
      if (!u) throw new Error((/<ows:ExceptionText>([^<]+)/.exec(t) || [])[1] || (/LiteralData[^>]*>([^<]{3,120})</.exec(t) || [])[1] || "Crop-CASMA gave no series");
      const c = await fetchText(u.replace(/^http:/, "https:"), 30000);
      return c.trim().split(/\r?\n/).slice(1).map(l => l.split(",")).map(([d, a]) => [dayOf((d || "").replace(/\./g, "-")), num(a)]).filter(p => Number.isFinite(p[0]) && ok(p[1]) && p[1] >= 0 && p[1] <= 1);
    };
    const parts = [];
    for (let a = d0; a <= d1; a += CASMA_MAX) parts.push([a, Math.min(a + CASMA_MAX - 1, d1)]);
    return (await Promise.all(parts.map(([a, b]) => one(a, b)))).flat();
  }
  // both layers: null for a layer that could not be read; throws when neither could
  async function smapAt(lat, lon, d0, d1) {
    const [top, sub] = await Promise.allSettled(["TOP", "SUB"].map(p => smapLayer(lat, lon, p, d0, d1)));
    if (top.status === "rejected" && sub.status === "rejected") throw top.reason;
    return { top: top.value || null, sub: sub.value || null };
  }
  /* the National Water Model's latest hourly land analysis on AWS (about 118 MB a file): only the chunks that hold the
     cell are read, about 2.5 MB. Its grid: Lambert conformal conic on a sphere of 6,370 km, parallels 30 and 60 N,
     origin 40 N 97 W, 1 km; the file's own x and y give the first cell and the step. */
  const NWM_S3 = "https://noaa-nwm-pds.s3.amazonaws.com/";
  const lcc = (() => {
    const R = 6370000, r = Math.PI / 180, p1 = 30 * r, p2 = 60 * r, t = p => Math.tan(Math.PI / 4 + p / 2);
    const n = Math.log(Math.cos(p1) / Math.cos(p2)) / Math.log(t(p2) / t(p1)), F = (Math.cos(p1) * t(p1) ** n) / n, rho = p => (R * F) / t(p) ** n, rho0 = rho(40 * r);
    return (lat, lon) => { const q = rho(lat * r), th = n * (lon + 97) * r; return [q * Math.sin(th), rho0 - q * Math.cos(th)]; };
  })();
  async function nwmFile() {
    for (let h = 0; h <= 6; h++) {
      const t = Date.now() - h * 36e5, s = new Date(t).toISOString(), url = `${NWM_S3}nwm.${s.slice(0, 10).replace(/-/g, "")}/analysis_assim/nwm.t${s.slice(11, 13)}z.analysis_assim.land.tm00.conus.nc`;
      // one byte, to see whether the hour's file is there yet (a plain range is allowed across origins; HEAD may not be)
      const r = await WG.util.fetchQ(url, { headers: { Range: "bytes=0-0" } }, 15000).catch(() => null);
      if (r && r.ok) return { url, valid: Math.floor(t / 36e5) * 36e5 };
    }
    throw new Error("no National Water Model analysis on AWS in the last 6 hours");
  }
  async function nwmAt(lat, lon) {
    const f = await nwmFile();
    return WG.h5range.withFile(f.url, async F => {
      const [X, Y, S, T0] = await Promise.all(["x", "y", "SOIL_M", "SOILSAT_TOP"].map(p => F.dataset(p)));
      const [x2, y2] = await Promise.all([F.read(X, [0], [2]), F.read(Y, [0], [2])]), [px, py] = lcc(lat, lon);
      const i = Math.round((px - x2[0]) / (x2[1] - x2[0])), j = Math.round((py - y2[0]) / (y2[1] - y2[0]));
      if (i < 0 || j < 0 || i >= X.shape[0] || j >= Y.shape[0]) throw new Error("the point is outside the National Water Model's grid");
      const val = (ds, raw) => { const A = ds.attrs || {}, at = (k, d) => (Number.isFinite(A[k]) ? A[k] : d), fill = at("_FillValue", ds.fill); return [...raw].map(v => (v === fill || v < -9000 ? null : v * at("scale_factor", 1) + at("add_offset", 0))); };
      const [soil, sat] = await Promise.all([F.read(S, [0, j, 0, i], [1, 1, 4, 1]), F.read(T0, [0, j, i], [1, 1, 1])]);
      return { valid: f.valid, url: f.url, layers: val(S, soil), sat: val(T0, sat)[0], bytes: F.bytes };
    });
  }

  /* the stations nearest a point (at most 400 km away) */
  const km = SM.km;
  const bearing = (a, b, c, d) => { const r = Math.PI / 180, y = Math.sin((d - b) * r) * Math.cos(c * r), x = Math.cos(a * r) * Math.sin(c * r) - Math.sin(a * r) * Math.cos(c * r) * Math.cos((d - b) * r); return compass(Math.atan2(y, x) / r); };
  const nearest = async (lat, lon, n = 3) => (await stations()).map(s => ({ ...s, km: km(lat, lon, s.lat, s.lon), dir: bearing(lat, lon, s.lat, s.lon) })).filter(s => s.km <= 400).sort((a, b) => a.km - b.km).slice(0, n);
  /* USDA NRCS AWDB: daily means (SMV; the start-of-day value SMS where a sensor has no mean) and, for a period that ends
     now, the latest hourly readings, in % by volume, for several stations in two requests. Times are the station's local
     standard time. */
  const AWDB = "https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/data";
  async function awdbRead(trips, d0, d1) {
    const now = d1 >= today() - 2; // the latest hourly readings only for a period that ends now
    const q = (els, dur, a, b) => fetchJSON(`${AWDB}?stationTriplets=${trips.join(",")}&elements=${els}&duration=${dur}&beginDate=${encodeURIComponent(a)}&endDate=${encodeURIComponent(b)}`, {}, 40000);
    const [day, hr] = await Promise.all([q("SMV:*,SMS:*", "DAILY", iso(d0), iso(d1)), now ? q("SMS:*", "HOURLY", `${iso(d1 - 2)} 00:00`, `${iso(d1 + 1)} 00:00`).catch(() => []) : []]);
    const out = new Map(trips.map(t => [t, { daily: new Map(), latest: new Map() }]));
    day.forEach(st => (st.data || []).forEach(e => {
      const se = e.stationElement || {}, k = -se.heightDepth, o = out.get(st.stationTriplet);
      if (!o || se.ordinal !== 1 || !(k > 0)) return;
      const pts = (e.values || []).map(v => [dayOf(v.date), num(v.value)]).filter(p => ok(p[1])).map(([d, v]) => [d, v / 100]);
      if (pts.length && (se.elementCode === "SMV" || !o.daily.has(k))) o.daily.set(k, pts);
    }));
    hr.forEach(st => (st.data || []).forEach(e => {
      const se = e.stationElement || {}, k = -se.heightDepth, o = out.get(st.stationTriplet), v = (e.values || []).filter(x => ok(num(x.value))).pop();
      if (o && se.ordinal === 1 && v) o.latest.set(k, { v: num(v.value) / 100, time: `${v.date} LST` });
    }));
    return out;
  }
  /* NOAA USCRN: each year's daily file (about 70 KB) and, for a period that ends now, the end of its hourly file (a byte
     range from the size, as a suffix range "bytes=-N" is not allowed across origins); m³/m³ at 5, 10, 20, 50 and 100 cm,
     -99 missing */
  const CRN = "https://www.ncei.noaa.gov/pub/data/uscrn/products/";
  const CRN_K = [5, 10, 20, 50, 100];
  async function crnRead(stem, d0, d1) {
    const years = [];
    for (let y = new Date(d0 * 864e5).getUTCFullYear(); y <= new Date(d1 * 864e5).getUTCFullYear(); y++) years.push(y);
    // each year of the span; a year before the station's record has no file, and only all failing is an error
    const read = await Promise.allSettled(years.map(y => fetchText(`${CRN}daily01/${y}/CRND0103-${y}-${stem}.txt`, 30000)));
    if (read.every(r => r.status === "rejected")) throw read[read.length - 1].reason;
    const texts = read.map(r => r.value || "");
    const daily = new Map();
    texts.join("\n").split("\n").map(l => l.trim().split(/\s+/)).filter(c => c.length >= 23 && /^\d{8}$/.test(c[1])).forEach(c => {
      const d = dayOf(`${c[1].slice(0, 4)}-${c[1].slice(4, 6)}-${c[1].slice(6)}`);
      if (d < d0 || d > d1) return;
      CRN_K.forEach((k, i) => { const v = num(c[18 + i]); if (ok(v) && v >= 0) { if (!daily.has(k)) daily.set(k, []); daily.get(k).push([d, v]); } });
    });
    const latest = new Map();
    if (d1 >= today() - 2) try {
      const y = new Date(d1 * 864e5).getUTCFullYear(), url = `${CRN}hourly02/${y}/CRNH0203-${y}-${stem}.txt`;
      const h = await WG.util.fetchQ(url, { method: "HEAD" }, 15000), size = +h.headers.get("content-length");
      const r = await WG.util.fetchQ(url, { headers: size > 30000 ? { Range: `bytes=${size - 30000}-` } : {} }, 20000);
      (await r.text()).split("\n").slice(1).map(l => l.trim().split(/\s+/)).filter(c => c.length >= 33).forEach(c => CRN_K.forEach((k, i) => {
        const v = num(c[28 + i]);
        if (ok(v) && v >= 0) latest.set(k, { v, time: `${c[3].slice(0, 4)}-${c[3].slice(4, 6)}-${c[3].slice(6)} ${c[4].slice(0, 2)}:${c[4].slice(2)} LST` });
      }));
    } catch (e) { console.warn("USCRN hourly", stem, e); } // the daily means still show
    return { daily, latest };
  }
  /* the readings of a list of stations (from nearest): each station's {daily: depth -> [[day, m³/m³]], latest: depth ->
     {v, time}} or an Error. Each part is kept for the location under its own key (Wx.once: the AWDB stations' one
     request, each USCRN station's files), so a part that failed is asked again at the next read and the rest is not;
     stKeys names those keys, which the Soil moisture by depth card's ⟳ forgets. A USCRN station whose record begins
     after the period has no file for it: no readings, not an error. */
  const awKey = (ids, d0, d1) => `smm:aw:${ids.join(",")}:${d0}:${d1}`, crnKey = (s, d0, d1) => `smm:crn:${s.id}:${d0}:${d1}`;
  const stKeys = (list, d0, d1) => { const ids = list.filter(s => s.src === "awdb").map(s => s.id); return [...(ids.length ? [awKey(ids, d0, d1)] : []), ...list.filter(s => s.src === "crn").map(s => crnKey(s, d0, d1))]; };
  async function readStations(list, d0, d1) {
    const aw = list.filter(s => s.src === "awdb"), ids = aw.map(s => s.id), got = new Map(), y1 = new Date(d1 * 864e5).getUTCFullYear();
    const pA = ids.length ? Wx.once(awKey(ids, d0, d1), () => awdbRead(ids, d0, d1)).then(m => m.forEach((v, k) => got.set(k, v)), e => aw.forEach(s => got.set(s.id, e))) : null;
    await Promise.all([pA, ...list.filter(s => s.src === "crn").map(s => (parseInt(s.since, 10) > y1 ? (got.set(s.id, { daily: new Map(), latest: new Map() }), null)
      : Wx.once(crnKey(s, d0, d1), () => crnRead(s.stem, d0, d1)).then(v => got.set(s.id, v), e => got.set(s.id, e))))]);
    return list.map(s => got.get(s.id) || new Error("no answer"));
  }

  /* ---------- the tab's period and choices: as the Rain and Temperature tabs' (js/weather.js), written here ---------- */
  const SMAP_D0 = dayOf(SMAP0), SMAP_MAX = 366, ST_MAX = 731, RUN_MAX = 40; // the newest days of a period read from SMAP and from the stations; years in one ERA5-Land request
  const eDay = (y, m, d) => Date.UTC(y, m, d) / 864e5;
  const ymd = d => { const x = new Date(d * 864e5); return [x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()]; };
  const mdays = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const STEP_AUTO = [[120, "day"], [731, "week"], [Infinity, "month"]]; // daily to 120 days, weekly to 2 years, then monthly
  const STEP_WORD = { day: ["Daily", "day"], week: ["Weekly", "week"], month: ["Monthly", "month"] };
  const PRESETS = [["30", "Last 30 days"], ["90", "Last 90 days"], ["ytd", "This year"], ["365", "Last 12 months"], ["lastyear", "Last calendar year"], ["custom", "Chosen dates"]];
  const AVGS = [["0", "No average"], ["5", "5 years before"], ["10", "10 years before"], ["20", "20 years before"], ["30", "30 years before"]];
  const COLS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"]; // the depths, shallowest first: categorical slots 1-5
  const YEAR_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"]; // the years by slot: each keeps its colour while shown
  /* the choices, kept while the page is open (for any location): the period, its steps, the average's years, the years
     compared and at which depth, the model depths and sources shown, and the station sensors left out */
  const per = { preset: "30", d0: null, d1: null, step: "auto", avg: "10", years: null, slot: new Map(), at: 0, dep: [true, true, true, true],
    src: { era5: true, ifs: true, smap: true, st: true }, stOff: new Set(), ver: 0 };
  function setPreset(p) {
    const L = today(), y = ymd(L)[0];
    per.preset = p;
    if (p === "custom") return;
    per.d1 = p === "lastyear" ? eDay(y - 1, 11, 31) : L;
    per.d0 = p === "ytd" ? eDay(y, 0, 1) : p === "lastyear" ? eDay(y - 1, 0, 1) : L - +p + 1;
  }
  const stepOk = (s, len) => s === "auto" || (s === "day" ? len <= 1096 : s === "week" ? len >= 14 : len >= 60);
  const stepOf = () => { const len = per.d1 - per.d0 + 1; return per.step !== "auto" && stepOk(per.step, len) ? per.step : STEP_AUTO.find(([n]) => len <= n)[1]; };
  const yearsOf = (a, b) => { const out = []; for (let y = ymd(a)[0]; y <= ymd(b)[0]; y++) out.push(y); return out; };
  // the average's years: the n whole years before the period starts, none before 1950
  function avgYears() {
    const n = +per.avg, b = Math.min(ymd(per.d0)[0] - 1, ymd(today())[0] - 1), out = [];
    for (let y = Math.max(1950, b - n + 1); n && y <= b; y++) out.push(y);
    return out;
  }
  function addYear(y) {
    if (per.years.includes(y) || per.years.length >= YEAR_COLORS.length || y < 1950) return;
    const used = new Set(per.years.map(x => per.slot.get(x)));
    per.slot.set(y, YEAR_COLORS.findIndex((_, k) => !used.has(k)));
    per.years.push(y);
  }
  // steps over days a..b: each day, 7-day steps from a, or calendar months (the ends may be part of one)
  function binsOf(a, b, s) {
    const out = [];
    if (s === "day") for (let d = a; d <= b; d++) out.push({ a: d, b: d });
    else if (s === "week") for (let d = a; d <= b; d += 7) out.push({ a: d, b: Math.min(d + 6, b) });
    else for (let d = a; d <= b;) { const [y, m] = ymd(d), e = Math.min(eDay(y, m + 1, 0), b); out.push({ a: d, b: e }); d = e + 1; }
    return out;
  }
  const short = d => { const [, m, dd] = ymd(d); return `${dd} ${MON[m]}`; };
  const binLabel = (bn, s, many) => { const [y, m] = ymd(bn.a); return s === "month" ? `${MON[m]} ${y}` : `${short(bn.a)}${many ? ` ${y}` : ""}`; };
  const binText = bn => (bn.a === bn.b ? iso(bn.a) : `${iso(bn.a)} to ${iso(bn.b)}`);
  /* the years compared: the period's own calendar days in each (the window ending on its last day's date), daily up to
     120 days, else weekly; a period longer than a year compares each year's calendar months instead */
  function cmpPlan() {
    const len = per.d1 - per.d0 + 1;
    if (len > 366) return { months: true, x: MON, bins: y => MON.map((_, m) => ({ a: eDay(y, m, 1), b: eDay(y, m + 1, 0) })), base: MON.map((_, m) => ({ a: eDay(2001, m, 1), b: eDay(2001, m + 1, 0) })), need: y => [y] };
    const s = len <= 120 ? "day" : "week", [, m1, d1] = ymd(per.d1), off = binsOf(0, len - 1, s), end = y => eDay(y, m1, d1), start = y => end(y) - len + 1;
    return { months: false, step: s, x: off.map(o => short(per.d0 + o.a)), bins: y => off.map(o => ({ a: start(y) + o.a, b: start(y) + o.b })), base: off.map(o => ({ a: per.d0 + o.a, b: per.d0 + o.b })),
      need: y => yearsOf(start(y), end(y)), win: `${short(per.d0)} – ${short(per.d1)}` };
  }

  /* ERA5-Land by calendar year for the location: y -> {a: its first day, v: [depth][day]}. One request reads a run of
     whole years not read yet (at most 40), so the period, the years compared and the average take one to three. */
  const E5 = new Map(), E5P = new Map(), E5X = new Map(); // the years read, being read, and failed (y -> Error)
  let e5tok = null, e5cell = null;
  function e5Read(lat, lon, years) {
    if (e5tok !== WG.state.token) { E5.clear(); E5P.clear(); E5X.clear(); e5tok = WG.state.token; e5cell = null; }
    const tok = e5tok, last = ymd(utcDay())[0], runs = [];
    [...new Set(years)].filter(y => y >= 1950 && y <= last && !E5.has(y) && !E5P.has(y)).sort((x, y) => x - y)
      .forEach(y => { const r = runs[runs.length - 1]; if (r && y === r[1] + 1 && y - r[0] < RUN_MAX) r[1] = y; else runs.push([y, y]); });
    runs.forEach(([a, b]) => {
      for (let y = a; y <= b; y++) E5X.delete(y);
      const p = era5Range(lat, lon, eDay(a, 0, 1), eDay(b, 11, 31)).then(R => {
        if (tok !== e5tok) return;
        if (!e5cell) e5cell = [R.lat, R.lon];
        for (let y = a; y <= b; y++) { const y0 = eDay(y, 0, 1), i = y0 - R.a; E5.set(y, { a: y0, v: R.v.map(s => s.slice(i, i + eDay(y + 1, 0, 1) - y0)) }); }
      }, e => { if (tok === e5tok) for (let y = a; y <= b; y++) E5X.set(y, e); throw e; }).finally(() => { if (tok === e5tok) for (let y = a; y <= b; y++) E5P.delete(y); });
      for (let y = a; y <= b; y++) E5P.set(y, p);
    });
    return Promise.allSettled([...new Set(years.map(y => E5P.get(y)).filter(Boolean))]);
  }
  // a day's value at a depth: undefined while its year is not read, null when missing
  const e5v = (k, d) => { const y = ymd(d)[0], r = E5.get(y); if (!r) return E5X.has(y) ? null : undefined; const x = r.v[k][d - r.a]; return ok(x) ? x : null; };
  // the average of a calendar day over the years A (29 February from the leap years, or 28 February when none); undefined until all are read
  function avgDay(A, k, d) {
    const [, m, dd] = ymd(d);
    const of = list => { let s = 0, n = 0; for (const y of list) { const x = e5v(k, eDay(y, m, dd === 29 && m === 1 && mdays(y, 1) === 28 ? 28 : dd)); if (x === undefined) return undefined; if (ok(x)) { s += x; n++; } } return n ? s / n : null; };
    if (m === 1 && dd === 29) { const leap = A.filter(y => mdays(y, 1) === 29); return of(leap.length ? leap : A); }
    return of(A);
  }
  // a step's mean: undefined while a day is not read yet, null when more than a tenth of its days have no value
  function agg(f, bn) {
    let s = 0, n = 0;
    for (let d = bn.a; d <= bn.b; d++) { const v = f(d); if (v === undefined) return undefined; if (ok(v)) { s += v; n++; } }
    const len = bn.b - bn.a + 1;
    return !n || len - n > Math.floor(len / 10) ? null : s / n;
  }
  const inMap = m => d => (m.has(d) ? m.get(d) : null); // a series read for the whole span: a day not in it has no value

  /* ---------- the tab ---------- */
  const Ch = WG.charts, C = Ch.C;
  const v2 = v => (ok(v) ? fmt(v, 2) : "—"), r3 = v => (ok(v) ? +v.toFixed(3) : null);
  const D = (a, b) => UN.range("depth", a, b, 0), Dp = cm => UN.fmt("depth", cm, 0);
  const dist = k => UN.fmt("distance", k, k < 10 ? 1 : 0);
  const at = (pts, d) => (pts.find(p => p[0] === d) || [])[1];
  const lastOf = R => { const d = R ? R.series.flatMap(s => s.pts.map(p => p[0])) : []; return d.length ? Math.max(...d) : null; };
  const ptKey = (lat, lon) => `${lat.toFixed(4)},${lon.toFixed(4)}`;
  const stats = vals => { let n = 0, s = 0, lo = Infinity, hi = -Infinity; vals.forEach(v => { if (ok(v)) { n++; s += v; if (v < lo) lo = v; if (v > hi) hi = v; } }); return n ? { mean: s / n, lo, hi, n } : null; };
  const rng = st => (st ? `${v2(st.lo)}–${v2(st.hi)}` : "—");
  const { head, grid, th, showBtn } = SM;
  const W8 = Wx.wait;
  /* reload: a part that could not be read gets the round button of the other tabs (js/weather.js: the tab is drawn
     again and only what failed is asked again); the Soil moisture by depth card, once today's values are in, a ⟳ that
     reads them again */
  const RELOAD = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/></svg>`;
  const RETRY = `<button type="button" class="wx-retry" data-wx-retry title="Reload this part" aria-label="Reload this part">${RELOAD}</button>`;
  /* a part of the tab written only when its html changes, so a control in it keeps the focus while other reads come in.
     When the part does change, the control that had the focus (a reload button, a year chip's ✕, a table's summary, a
     station's name, a CSV or figure download, a choice, the More button) gets it back: the one at the same place among
     those of its kind in the part; a <details> left open stays open. */
  const KINDS = ["[data-wx-retry]", "[data-smm-drop]", "summary", "[data-smm-pt]", "[data-sm-csv]", "[data-fig]", "[data-smm-c]", ".fold-tg"];
  function put(box, html) {
    if (!box || box.smmHtml === html) return;
    const a = document.activeElement, s = a && a !== box && box.contains(a) ? KINDS.find(x => a.matches(x)) : null, k = s ? [...box.querySelectorAll(s)].indexOf(a) : -1;
    const open = [...box.querySelectorAll("details")].map(d => d.open);
    box.smmHtml = html;
    box.innerHTML = html;
    box.querySelectorAll("details").forEach((d, i) => { if (open[i]) d.open = true; });
    if (k < 0) return;
    if (s === ".fold-tg" && WG.fold) WG.fold.scan(); // js/fold.js puts the card's More button back now, not a frame later
    const b = box.querySelectorAll(s)[k];
    if (b) b.focus({ preventScroll: true });
  }
  const nwmSeen = new Map(); // NWM reads by point
  let redrawNow = null; // the tab's drawing on show, for the National Water Model's button
  /* the tab's tables join the Soil maps theme's set (js/soilmaps.js), filed under this tab by their "moisture" ids, for
     this tab's "Download all the soil moisture tables". A new drawing of the Soil tab starts a new set, so they are put
     back each time it sets one of its own. */
  let mineT = { tok: null, t: {} };
  const putTable = (live, id, t) => { if (!live()) return; if (mineT.tok !== WG.state.token) mineT = { tok: WG.state.token, t: {} }; mineT.t[id] = t; SM.tables()[id] = t; };
  if (SM.on) SM.on(() => { if (mineT.tok !== WG.state.token) return; const T = SM.tables(); Object.entries(mineT.t).forEach(([id, t]) => { if (T[id] !== t) T[id] = t; }); });
  /* a station's name: a link that shows it as a point on the map (js/soilmaps.js showOnMap: a pin, a dashed line from the
     location, both in view), where the Soil maps theme offers it; sub: its plain-text line under the name */
  const ptLink = (s, sub) => (typeof SM.showOnMap === "function" ? `<button class="link" data-smm-pt data-lat="${s.lat}" data-lon="${s.lon}" data-name="${esc(s.name)}" data-sub="${esc(sub || "")}" title="Show ${esc(s.name)} on the map">${esc(s.name)}</button>` : esc(s.name));
  document.addEventListener("click", e => { const b = e.target.closest && e.target.closest("[data-smm-pt]"); if (b && typeof SM.showOnMap === "function") { e.preventDefault(); SM.showOnMap(+b.dataset.lat, +b.dataset.lon, b.dataset.name, b.dataset.sub || ""); } });
  const stSub = (net, id, k, dir) => `${net} ${id} soil moisture station · ${dist(k)} ${dir} of the location`;

  /* a chart in its own card, with the download button of the Rain and Temperature tabs' figures (js/downloads.js); a chart
     over the period gives its data with each step's first and last day, as its labels ("14 Oct") carry no year */
  const isoTable = (id, bins) => () => { const t = Ch.table(id) || { header: [""], rows: [] }; return { header: ["From", "To", ...t.header.slice(1)], rows: t.rows.map((r, i) => [iso(bins[i].a), iso(bins[i].b), ...r.slice(1)]) }; };
  const DL = `<svg viewBox="0 0 24 24"><path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/></svg>`;
  function figCard(id, title, h, fig, o = {}) {
    const f = { own: true, title, file: fig.file, x: fig.x, sub: fig.sub, ...(fig.bins ? { table: isoTable(id, fig.bins) } : {}) };
    if (WG.downloads) WG.downloads.addFig(id, f); else document.addEventListener("DOMContentLoaded", () => WG.downloads.addFig(id, f), { once: true });
    return `<div class="card"><div class="card-h"><h3>${esc(title)}</h3><div class="card-tools">${o.tag ? `<span class="tag">${esc(o.tag)}</span>` : ""}<button class="dl-btn" data-fig="${id}" title="Download this figure or its data" aria-label="Download ${esc(title)}">${DL}</button></div></div>
      ${o.top || ""}<div class="chart-box" style="height:${h}px"><canvas id="${id}"></canvas></div>${o.foot || ""}</div>`;
  }
  const xAx = { grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 14, maxTicksLimit: 8 } };
  const opts = title => ({ maintainAspectRatio: false, animation: false, interaction: { mode: "index", intersect: false },
    plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { ...(title ? { title } : {}), label: it => `${it.dataset.label}: ${ok(it.parsed.y) ? it.parsed.y.toFixed(3) : "—"} m³/m³` } } },
    scales: { x: xAx, y: { title: { display: true, text: "m³/m³" }, ticks: { callback: v => (+v).toFixed(2) } } } });
  const line = (label, data, color, o = {}) => ({ type: "line", label, data: data.map(r3), borderColor: color, backgroundColor: color, pointRadius: o.points ? 2.5 : 0, pointHoverRadius: 3.5, borderWidth: o.w || 2, spanGaps: false, ...(o.dash ? { borderDash: o.dash } : {}) });

  /* today at the point, for the Overview's two rows and the Soil moisture tab's Soil moisture by depth card: the models'
     0-7 and 28-100 cm today (ECMWF IFS; ERA5-Land's latest day when IFS gives none) and the nearest station's latest
     reading at its shallowest sensor. The same reads as the tab's default view (IFS's last 31 days, ERA5-Land's year, the
     stations' last 30 days): either one reads them once. lat, lon: the picked point.
     -> {model, station}, each a value; null where there is none (no model value at the point, no station within 400 km);
     {none: "recent", n} where the n nearest stations have no reading in the last 30 days; or an Error where it could not
     be read. A value with .err stands in for a part that failed: ERA5-Land's latest day when ECMWF IFS did not answer, a
     farther station when a nearer one could not be read. A summary with an Error or an .err is not kept, so the next one
     (a reload) asks again what failed, and only that: the reads themselves are kept (Wx.once, readStations);
     dropSummary() forgets one that was read, for the card's ⟳. */
  const SUM = new Map(), sumKey = (lat, lon) => `${WG.state.token}|${ptKey(lat, lon)}`;
  const dropSummary = (lat, lon) => { SUM.delete(sumKey(lat, lon)); };
  // the last summary read here, complete or not: the card shows it while a new one is read (a part asked again, or ⟳)
  const SUMLAST = new Map(), lastSummary = (lat, lon) => SUMLAST.get(sumKey(lat, lon)) || null;
  // the first station of the list that could not be read, if it comes before the n-th (the one shown): {e, i}, else null
  const failedBefore = (got, n) => { const i = got.findIndex(r => r instanceof Error); return i >= 0 && i < n ? { e: got[i], i } : null; };
  // what a stand-in station carries: the failure, the name of the station that failed, and whether it was the nearest
  const standIn = (f, list) => (f ? { err: f.e, errName: list[f.i].name, errNearest: f.i === 0 } : {});
  const partial = x => x instanceof Error || !!(x && x.err);
  function summary(lat, lon) {
    const k = sumKey(lat, lon);
    if (SUM.has(k)) return SUM.get(k);
    const pt = ptKey(lat, lon), t1 = today();
    const model = (async () => {
      let ifsErr = null;
      try {
        const F = await Wx.once(`smm:ifs:31:${pt}`, () => ifsAt(lat, lon, 31)), d = lastOf(F);
        if (d !== null) { const top = at(F.series[0].pts, d), root = at(F.series[2].pts, d); if (ok(top) || ok(root)) return { top: ok(top) ? top : null, root: ok(root) ? root : null, date: iso(d), src: "ECMWF IFS" }; }
      } catch (e) { console.warn("soil moisture: IFS", e); ifsErr = e; }
      const y = ymd(t1)[0], ys = t1 - 10 < eDay(y, 0, 1) ? [y - 1, y] : [y];
      await e5Read(lat, lon, ys); // ERA5-Land's latest day is about a week back
      for (let d = Math.min(t1, utcDay()); d >= t1 - 400; d--) {
        const top = e5v(0, d), root = e5v(2, d);
        if (top === undefined) break;
        if (ok(top) || ok(root)) return { top, root, date: iso(d), src: "ERA5-Land", ...(ifsErr ? { err: ifsErr } : {}) };
      }
      // neither model has a value: an Error when one of them did not answer (a reload may get it), else none here
      const e5Err = ys.map(x => E5X.get(x)).find(Boolean), msg = e => (e && e.message) || String(e);
      if (ifsErr || e5Err) throw new Error([ifsErr ? `ECMWF IFS: ${msg(ifsErr)}` : "", e5Err ? `ERA5-Land: ${msg(e5Err)}` : ""].filter(Boolean).join("; "));
      return null;
    })();
    const station = (async () => {
      const list = await Wx.once(`smm:near:${pt}`, () => nearest(lat, lon, 3));
      if (!list.length) return null;
      const got = await readStations(list, t1 - DAYS + 1, t1);
      for (let n = 0; n < list.length; n++) {
        const s = list[n], r = got[n];
        if (r instanceof Error) continue;
        for (const d of s.depths) {
          const last = r.latest.get(d.key), p = r.daily.get(d.key) || [], ld = p.length ? p[p.length - 1] : null, f = failedBefore(got, n);
          if (last || ld) return { name: s.name, net: NET[s.net][0], id: s.src === "crn" ? `WBAN ${s.id}` : s.id.split(":")[0], lat: s.lat, lon: s.lon, km: s.km, dir: s.dir,
            depth: d.label, depthCm: +d.cm.toFixed(1), depthIn: +(d.cm / 2.54).toFixed(1), value: last ? last.v : ld[1], time: last ? last.time : `${iso(ld[0])}, daily mean`, ...standIn(f, list) };
        }
      }
      // none with a reading: a station that could not be read may have one (readStations asks it again next time)
      const bad = got.find(r => r instanceof Error);
      if (bad) throw bad;
      return { none: "recent", n: list.length };
    })();
    const p = Promise.allSettled([model, station]).then(([m, s]) => {
      const err = x => { console.warn("soil moisture: today", x.reason); return x.reason instanceof Error ? x.reason : new Error(String(x.reason)); };
      const r = { model: m.status === "fulfilled" ? m.value : err(m), station: s.status === "fulfilled" ? s.value : err(s) };
      SUMLAST.set(k, r);
      while (SUMLAST.size > 20) SUMLAST.delete(SUMLAST.keys().next().value);
      if ((partial(r.model) || partial(r.station)) && SUM.get(k) === p) SUM.delete(k);
      // each new reading here reaches the Overview's rows too (js/soilmaps.js "wg-smm": it takes lastSummary, no new read)
      setTimeout(() => document.dispatchEvent(new Event("wg-smm")), 0);
      return r;
    });
    SUM.set(k, p);
    return p;
  }
  /* the same two rows on a past day d, the day the SMAP map shows (mapDay): ERA5-Land's daily means that day (ECMWF
     IFS's for a day ERA5-Land has not reached yet, within IFS's 92 days), and the nearest station's daily mean that day
     at its shallowest sensor; the same shapes as summary(), {none: "day", n} where the stations have no reading that day.
     Kept per location and day; a part that failed (or stood in for one, .err) is read again next time. */
  const SUMD = new Map();
  function summaryOn(lat, lon, d) {
    const pt = ptKey(lat, lon), k = `${WG.state.token}|${pt}|${d}`;
    if (SUMD.has(k)) return SUMD.get(k);
    const model = (async () => {
      const R = await era5Range(lat, lon, d, d), top = R.a === d ? R.v[0][0] : null, root = R.a === d ? R.v[2][0] : null;
      if (ok(top) || ok(root)) return { top: ok(top) ? top : null, root: ok(root) ? root : null, date: iso(d), src: "ERA5-Land" };
      if (today() - d > 90) return null;
      const F = await Wx.once(`smm:ifs:92:${pt}`, () => ifsAt(lat, lon, 92)), t = at(F.series[0].pts, d), r = at(F.series[2].pts, d);
      return ok(t) || ok(r) ? { top: ok(t) ? t : null, root: ok(r) ? r : null, date: iso(d), src: "ECMWF IFS" } : null;
    })();
    const station = (async () => {
      const list = await Wx.once(`smm:near:${pt}`, () => nearest(lat, lon, 3));
      if (!list.length) return null;
      const got = await readStations(list, d, d);
      for (let n = 0; n < list.length; n++) {
        const s = list[n], r = got[n];
        if (r instanceof Error) continue;
        for (const x of s.depths) {
          const v = at(r.daily.get(x.key) || [], d), f = failedBefore(got, n);
          if (ok(v)) return { name: s.name, net: NET[s.net][0], id: s.src === "crn" ? `WBAN ${s.id}` : s.id.split(":")[0], lat: s.lat, lon: s.lon, km: s.km, dir: s.dir,
            depth: x.label, depthCm: +x.cm.toFixed(1), depthIn: +(x.cm / 2.54).toFixed(1), value: v, time: `${iso(d)}, daily mean`, ...standIn(f, list) };
        }
      }
      // none with a reading that day: a station that could not be read may have one (readStations asks it again next time)
      const bad = got.find(r => r instanceof Error);
      if (bad) throw bad;
      return { none: "day", n: list.length }; // stations near, none with a reading that day
    })();
    const p = Promise.allSettled([model, station]).then(([m, s]) => {
      // a part that failed, or stood in for one that did, is asked again next time
      [m, s].forEach(x => { if (x.status === "rejected") console.warn("soil moisture on a past day", x.reason); if ((x.status === "rejected" || partial(x.value)) && SUMD.get(k) === p) SUMD.delete(k); });
      if (m.status === "rejected" && s.status === "rejected") throw m.reason;
      const err = x => (x.reason instanceof Error ? x.reason : new Error(String(x.reason)));
      return { model: m.status === "fulfilled" ? m.value : err(m), station: s.status === "fulfilled" ? s.value : err(s) };
    });
    SUMD.set(k, p);
    while (SUMD.size > 60) SUMD.delete(SUMD.keys().next().value);
    return p;
  }

  function periodCard(len, s, A) {
    const t1 = iso(today()), opt = (list, cur) => list.map(([k, n]) => `<option value="${k}" ${k === cur ? "selected" : ""}>${esc(n)}</option>`).join("");
    const steps = [["auto", `Auto: ${STEP_WORD[STEP_AUTO.find(([n]) => len <= n)[1]][0].toLowerCase()}`], ["day", "Daily"], ["week", "Weekly"], ["month", "Monthly"]].filter(([k]) => stepOk(k, len));
    const box = (c, on, label) => `<label class="check"><input type="checkbox" data-smm-c="${c}" ${on ? "checked" : ""}>${label}</label>`;
    return `<div class="card smm-per"><div class="card-h"><h3>Period</h3><span class="tag">${STEP_WORD[s][0]} steps</span></div>
      <div class="form-grid">
        <label>Show<select data-smm-c="preset">${opt(PRESETS, per.preset)}</select></label>
        <label>From<input type="date" data-smm-c="from" min="1950-01-01" max="${t1}" value="${iso(per.d0)}"></label>
        <label>To<input type="date" data-smm-c="to" min="1950-01-01" max="${t1}" value="${iso(per.d1)}"></label>
        <label>Steps<select data-smm-c="step">${opt(steps, per.step)}</select></label>
        <label>Average over<select data-smm-c="avg">${opt(AVGS, per.avg)}</select></label>
      </div>
      <div class="smm-fs" role="group" aria-label="Model depths"><span class="smm-fs-k">Model depths</span>${OM_D.map(([a, b], k) => box(`dep${k}`, per.dep[k], `<i class="smm-sw" style="background:${COLS[k]}"></i>${esc(D(a, b))}`)).join("")}</div>
      <div class="smm-fs" role="group" aria-label="Sources"><span class="smm-fs-k">Sources</span>${[["era5", "ERA5-Land", "model, since 1950"], ["ifs", "ECMWF IFS", "model, last 92 days"], ["smap", "SMAP L4", "satellite, since 2015"], ["st", "Stations", "the 3 nearest"]]
        .map(([k, n, w]) => box(`src-${k}`, per.src[k], `${n} <small>${w}</small>`)).join("")}</div>
      <p class="fine">${len} days, ${iso(per.d0)} to ${iso(per.d1)}. ${A.length ? `Average: ERA5-Land on the same calendar days in ${A[0]}–${A[A.length - 1]} (${A.length} year${A.length > 1 ? "s" : ""}).` : per.avg === "0" ? "No average chosen." : "No whole years before this period in ERA5-Land's record (from 1950)."}
        Steps follow the period unless chosen: daily up to 120 days, weekly to 2 years, then monthly; each step is the mean of its days.</p>
      <p class="fine smm-prog" id="smmProg"></p></div>`;
  }

  Wx.RENDER.soilmoist = async (el, live) => {
    if (per.d0 === null) setPreset(per.preset);
    if (per.years === null) { per.years = []; [ymd(per.d1)[0], ymd(per.d1)[0] - 1].forEach(addYear); }
    const { lat, lon } = WG.state.site, pt = ptKey(lat, lon), v0 = per.ver, mine = () => live() && per.ver === v0, t1 = today();
    const q = sel => (mine() ? el.querySelector(sel) : null);
    const len = per.d1 - per.d0 + 1, s = stepOf(), B = binsOf(per.d0, per.d1, s), many = ymd(per.d0)[0] !== ymd(per.d1)[0];
    const xs = B.map(b => binLabel(b, s, many && s !== "month")), plan = cmpPlan(), A = avgYears(), K = OM_D.map((_, k) => k).filter(k => per.dep[k]);
    const ifsDays = per.d0 >= t1 - 31 ? 31 : per.d1 >= t1 - 92 ? 92 : 0; // IFS's past days to read: the default's 31, or 92 for a period that reaches into them
    const smA = Math.max(per.d0, SMAP_D0, per.d1 - SMAP_MAX + 1), smB = Math.min(per.d1, t1), stA = Math.max(per.d0, per.d1 - ST_MAX + 1), stB = Math.min(per.d1, t1);
    // a chart's height: its key takes a row for every line or few (about 150 px each), so the plot keeps its height on a phone
    const tall = n => { const w = el.clientWidth > 200 ? el.clientWidth : Math.min(innerWidth, 560) - 40; return 220 + Math.ceil(n / Math.max(2, Math.floor(w / 150))) * 18; };
    const sub = `${Wx.siteLine()} · ${STEP_WORD[s][0].toLowerCase()} means`, xName = s === "month" ? "Month" : s === "week" ? "Week from" : "Date";
    let yOpts = "";
    for (let y = ymd(t1)[0]; y >= 1950; y--) if (!per.years.includes(y)) yOpts += `<option>${y}</option>`;
    const yearCtl = `<div class="form-grid"><label>Add a year<select data-smm-c="addyear" ${per.years.length >= YEAR_COLORS.length ? "disabled" : ""}><option value="">Choose…</option>${yOpts}</select></label>
        <label>Depth (ERA5-Land)<select data-smm-c="at">${OM_D.map(([a, b], k) => `<option value="${k}" ${k === per.at ? "selected" : ""}>${esc(D(a, b))}</option>`).join("")}</select></label></div>
      <div class="chips" id="smmYearChips"></div>`;
    el.innerHTML = `${SM.mapCard ? SM.mapCard("wet", "Soil moisture on the map") : ""}<div class="card" id="smmToday">
        <div class="card-h"><h3>Soil moisture by depth</h3><div class="card-tools"><span class="tag">today · model · station</span><button type="button" class="dl-btn" data-smm-reload hidden title="Read today's soil moisture again" aria-label="Read today's soil moisture again">${RELOAD}</button></div></div>
        <div id="smmNow"><p class="fine" style="margin-top:0"><span class="skeleton" style="width:60%"></span></p><p class="fine">Reading today's soil moisture here…</p></div>
        <p class="fine">Water in the soil at this point, in <b>m³/m³</b> (volume of water in a volume of soil: 0.25 = 25% by volume), from three kinds of source, each labelled: <b>models</b> (computed from weather and their own soil maps), <b>satellite</b> analyses (SMAP, merged into a model) and <b>station</b> measurements (sensors in the ground, the nearest may be tens of km away). Models and stations often differ by 0.1 or more: a model's soil is not the field's. Compare their changes more than their levels.</p></div>
      ${periodCard(len, s, A)}
      ${per.src.era5 || per.src.ifs ? figCard("smmDepth", `Models by depth, ${STEP_WORD[s][0].toLowerCase()} means`, tall(K.length * ((per.src.era5 ? 1 : 0) + (per.src.ifs && ifsDays ? 1 : 0))), { file: `soil_moisture_models_${s}`, x: xName, sub, bins: B }, { tag: "model", foot: `<p class="fine">All the chosen depths on one chart: ERA5-Land solid, ECMWF IFS dashed (the last ${ifsDays || 92} days and today, today partly forecast). Hover or tap for each step's values.</p>` }) : ""}
      <div id="smmModels">${per.src.era5 || per.src.ifs ? W8("the soil moisture models by depth (Open-Meteo: ERA5-Land, ECMWF IFS)") : ""}</div>
      ${figCard("smmYears", "Year against year", tall(per.years.length + (A.length ? 1 : 0)), { file: "soil_moisture_years", x: plan.months ? "Month" : "Day", sub: `${Wx.siteLine()} · ERA5-Land ${D(...OM_D[per.at])}` }, { tag: plan.months ? "months of each year" : plan.win, top: yearCtl,
        foot: `<p class="fine">ERA5-Land at ${esc(D(...OM_D[per.at]))}: ${plan.months ? "the monthly means of each chosen year" : `the period's calendar days (${esc(plan.win)}) in each chosen year, ${plan.step === "day" ? "daily" : "weekly"} means`}${A.length ? `, and their average over ${A[0]}–${A[A.length - 1]}` : ""}. The year in progress ends about a week before today, where ERA5-Land ends.</p>` })}
      ${per.src.smap ? `<div id="smmSmap">${W8("NASA SMAP L4 at this 9 km cell (USDA Crop-CASMA)")}</div>` : ""}
      ${per.src.st ? `<div id="smmSt">${W8("the nearest soil moisture stations (USDA SCAN and SNOTEL, NOAA USCRN)")}</div>` : ""}
      <div id="smmShown"></div>
      ${SM.allBtn ? SM.allBtn("soilmoist", "all the soil moisture tables") : ""}`;

    /* the controls: a change draws the tab again from what is read; the tab keeps its height meanwhile, so the page stays put */
    const redo = () => { el.style.minHeight = `${el.offsetHeight}px`; per.ver++; el.dataset.key = ""; Wx.show("soilmoist", el); };
    el.onchange = e => {
      const c = e.target.dataset && e.target.dataset.smmC, v = e.target.value;
      if (!c) return;
      if (c === "preset") { setPreset(v); if (v !== "custom") redo(); return; }
      if (c === "from" || c === "to") {
        const a = q('[data-smm-c="from"]'), b = q('[data-smm-c="to"]');
        if (!a || !b || !a.value || !b.value || !a.validity.valid || !b.validity.valid) return; // a date still being typed waits
        const d0 = Math.max(dayOf(a.value), dayOf("1950-01-01")), d1 = Math.min(dayOf(b.value), today());
        if (d1 < d0) { badRange = true; draw(); return; } // said in the progress line (drawAll)
        Object.assign(per, { preset: "custom", d0, d1 });
        return redo();
      }
      if (c === "step") per.step = v;
      else if (c === "avg") per.avg = v;
      else if (c === "at") per.at = +v;
      else if (c === "addyear") { if (!v) return; addYear(+v); }
      else if (/^dep\d$/.test(c)) per.dep[+c.slice(3)] = e.target.checked;
      else if (/^src-/.test(c)) per.src[c.slice(4)] = e.target.checked;
      else if (c === "stdep") { if (e.target.checked) per.stOff.delete(v); else per.stOff.add(v); }
      else return;
      redo();
    };
    /* the Soil moisture by depth card's ⟳, once today's values are in: they are read again (ECMWF IFS's recent days and the stations'
       readings to now; ERA5-Land, a week behind, and SMAP, three days behind, are kept), with anything that could not be
       read; the Overview's soil moisture rows follow when it is shown again */
    const fresh = () => {
      WG.say("Reloading");
      Wx.once(`smm:near:${pt}`, () => nearest(lat, lon, 3)).catch(() => []).then(l => {
        if (!mine()) return;
        [`smm:ifs:31:${pt}`, `smm:ifs:92:${pt}`, ...stKeys(l, t1 - DAYS + 1, t1), ...(stB >= t1 - 2 ? stKeys(l, stA, stB) : [])].forEach(k => Wx.forget(k));
        dropSummary(lat, lon);
        const ov = document.getElementById("tab-soiloverview");
        if (ov) ov.dataset.key = "";
        redo();
      });
    };
    el.onclick = e => {
      if (e.target.closest("[data-smm-reload]")) { e.preventDefault(); fresh(); return; }
      const b = e.target.closest("[data-smm-drop]");
      if (b) { e.preventDefault(); const y = +b.dataset.smmDrop; per.years = per.years.filter(x => x !== y); per.slot.delete(y); redo(); }
    };

    /* what is read: each kept for the location, so a new choice reads only what it adds */
    let F = null, Ferr = null, Fnow = null, S = null, Serr = null, Spart = null, near = null, nearErr = null, got = null, gotErr = null, sumR = null, sumErr = null, sumOld = lastSummary(lat, lon), badRange = false;
    const yP = yearsOf(per.d0, per.d1).filter(() => per.src.era5), yC = [...per.years.flatMap(plan.need), ...A], yAll = [...new Set([...yP, ...yC])];
    let busy = true, tq = false;
    const later = () => { if (tq) return; tq = true; Promise.resolve().then(() => { tq = false; draw(); }); }; // one drawing for all that came in at once
    function draw() { if (!mine()) return; redrawNow = draw; try { drawAll(); } catch (e) { console.warn("soil moisture tab", e); } }
    // the comparison line's wilting point and field capacity come with the soil survey, which can land after this drawing
    const soilIn = () => { if (!mine()) { document.removeEventListener("wg-soil", soilIn); return; } later(); };
    document.addEventListener("wg-soil", soilIn);

    function drawAll() {
      const shown = []; // [label, value per step] of every line drawn over the period, for the table of what is shown
      /* progress */
      const p = q("#smmProg");
      if (p) {
        const inN = yAll.filter(y => E5.has(y)).length, bad = yAll.filter(y => E5X.has(y));
        const html = `${badRange ? "The first day must come before the last. " : ""}${busy && inN + bad.length < yAll.length ? `Reading ERA5-Land: ${inN} of ${yAll.length} years in. ` : ""}${bad.length ? `${esc(`ERA5-Land gave no answer for ${bad.length > 4 ? `${bad.length} years` : bad.join(", ")} (${(E5X.get(bad[0]) || {}).message || "error"}).`)} ${RETRY}` : ""}`;
        put(p, html);
      }

      /* today at the point, in the Soil moisture by depth card: the models and the nearest station, or why a part has none.
         A part that could not be read, or was stood in for (.err), says so with a reload; once all is in, the card's ⟳
         reads them again. Written only when it changes, so a reload button keeps its focus while other reads come in. */
      // old: the last values read here, shown while this drawing's summary is read (a part asked again, or the ⟳)
      const tb = q("#smmNow"), rb = q("[data-smm-reload]"), old = !sumR && !sumErr ? sumOld : null;
      if (tb && (sumR || sumErr || old)) {
        const R = sumR || old, m = R ? R.model : sumErr, st = R ? R.station : sumErr, mOk = !!m && !(m instanceof Error), sOk = !!st && !(st instanceof Error) && !st.none;
        const when = mOk && m.date !== iso(t1) ? "latest" : "today", msg = e => esc((e && e.message) || String(e)), says = [];
        if (old) { /* what failed is being asked again */ }
        else if (sumErr) says.push(`Could not read today's soil moisture here (${msg(sumErr)}).`);
        else {
          if (m instanceof Error) says.push(`Could not read the models (${msg(m)}).`);
          else if (mOk && m.err) says.push(`Could not read ECMWF IFS (${msg(m.err)}): ERA5-Land's latest day is shown.`);
          if (st instanceof Error) says.push(`Could not read the stations (${msg(st)}).`);
          else if (sOk && st.err) says.push(`Could not read ${st.errNearest ? "the nearest station" : "a nearer station"}${st.errName ? `, ${esc(st.errName)}` : ""} (${msg(st.err)}): the next one with a reading is shown.`);
        }
        const few = st && st.none ? (st.n === 1 ? "the nearest station" : `the ${st.n || 3} nearest`) : "";
        const html = `<div class="wx-kv">
          <div><span>${esc(D(0, 7))}, ${when}</span><b>${mOk ? v2(m.top) : "—"}</b><span>${mOk ? `m³/m³${pctW(num(m.top))} · ${esc(m.src)}, ${esc(m.date)}` : m instanceof Error ? "could not be read" : "no model value at this point"}</span></div>
          <div><span>${esc(D(28, 100))}, ${when}</span><b>${mOk ? v2(m.root) : "—"}</b><span>${mOk ? `m³/m³${pctW(num(m.root))} · ${esc(m.src)}` : ""}</span></div>
          <div><span>${sOk && st.err ? "Next station" : "Nearest station"}${sOk ? `, ${esc(st.depth)}` : ""}</span><b${sOk && ok(num(st.value)) ? ` title="m³/m³${pctW(num(st.value))}"` : ""}>${sOk ? v2(st.value) : "—"}</b><span>${sOk ? `${ptLink(st, stSub(st.net, st.id, st.km, st.dir))} (${esc(st.net)}), ${dist(st.km)} ${esc(st.dir)} · ${esc(st.time)}`
            : st instanceof Error ? "could not be read" : st && st.none ? `no reading in the last 30 days at ${few}` : "none within 400 km"}</span></div></div>
          <p class="fine">For comparison, ${esc(soilRange())}.</p>
          ${old ? `<p class="fine">Reading today's values again…</p>` : ""}
          ${says.length ? `<p class="fine">${says.join(" ")} ${RETRY}</p>` : ""}
          <p class="fine">Values are m³ of water per m³ of soil (0.27 = 27% water by volume). Models: ECMWF IFS's mean of today's hours (partly forecast), or ERA5-Land's latest day; station: its latest hourly value at its shallowest sensor. The cards below give every depth over the period.</p>`;
        put(tb, html);
        if (rb) rb.hidden = says.length > 0 || !!old;
      }

      /* the models over the period: all the chosen depths on one chart, and their numbers */
      const Fm = F ? F.series.map(x => new Map(x.pts)) : null;
      if (per.src.era5 || per.src.ifs) {
        const ds = [];
        K.forEach(k => {
          const [a, b] = OM_D[k];
          if (per.src.era5) { const v = B.map(bn => agg(d => e5v(k, d), bn)); ds.push(line(`ERA5-Land ${D(a, b)}`, v, COLS[k], { points: s !== "day" })); shown.push([`ERA5-Land ${a}-${b} cm (m3/m3)`, v]); }
          if (per.src.ifs && Fm) { const v = B.map(bn => agg(inMap(Fm[k]), bn)); if (v.some(ok)) { ds.push(line(`IFS ${D(a, b)}`, v, COLS[k], { dash: [5, 4], points: s !== "day" })); shown.push([`ECMWF IFS ${a}-${b} cm (m3/m3)`, v]); } }
        });
        Ch.draw("smmDepth", () => ({ data: { labels: xs, datasets: ds }, options: opts(it => binText(B[it[0].dataIndex])) }));
        const mb = q("#smmModels"), eIn = yP.every(y => E5.has(y) || E5X.has(y));
        if (mb && (eIn || !per.src.era5) && (F || Ferr || !ifsDays || !per.src.ifs)) {
          const Fn = Fnow || F, fT = lastOf(Fn), days = [];
          for (let d = per.d0; d <= per.d1; d++) days.push(d);
          const aIn = A.length && A.every(y => E5.has(y) || E5X.has(y)), csv = [];
          const rows = K.map(k => {
            const [a, b] = OM_D[k], ev = days.map(d => e5v(k, d)), st = stats(ev), li = ev.map(ok).lastIndexOf(true), av = aIn ? stats(days.map(d => avgDay(A, k, d))) : null;
            if (per.src.era5) days.forEach((d, i) => { if (ok(ev[i])) csv.push(["ERA5-Land (Copernicus C3S) via Open-Meteo", "model: reanalysis", a, b, iso(d), r3(ev[i]), "daily mean, local day"]); });
            if (per.src.ifs && Fm) F.series[k].pts.forEach(([d, v]) => { if (d >= per.d0 && d <= per.d1) csv.push(["ECMWF IFS 9 km via Open-Meteo", "model: analysis and forecast", a, b, iso(d), r3(v), d === fT ? "mean of today's hours; the hours after now are forecast" : "daily mean of hourly values, local day"]); });
            const dif = st && av ? st.mean - av.mean : null;
            return [esc(D(a, b)), Fn && fT !== null ? v2(at(Fn.series[k].pts, fT)) : "—", li >= 0 ? `${v2(ev[li])} <small>${iso(days[li])}</small>` : "—", st ? v2(st.mean) : "—", av ? v2(av.mean) : A.length && !aIn ? "…" : "—",
              ok(dif) ? `${dif >= 0 ? "+" : "−"}${fmt(Math.abs(dif), 2)}` : "—", rng(st)];
          });
          putTable(mine, "moisture_models", { title: "Soil moisture by depth, models (m3/m3)", header: ["Source", "Kind", "Top (cm)", "Bottom (cm)", "Date", "Soil moisture (m3/m3)", "Note"], rows: csv });
          put(mb, `<div class="card">${head("Models by depth: the numbers", csv.length ? "moisture_models" : "", "model")}
            ${K.length ? grid([th("Depth"), th("Today, ECMWF IFS", fT !== null ? iso(fT) : ""), th("ERA5-Land, latest", "in the period"), th("Period mean", "ERA5-Land"), th("Average", A.length ? `${A[0]}–${A[A.length - 1]}, same days` : "none chosen"), th("Difference", "mean − average"), th("Period range", "daily means")], rows) : `<p class="fine">Choose a depth above.</p>`}
            ${(per.src.era5 && yP.some(y => E5X.has(y))) || (per.src.ifs && Ferr) ? `<p class="fine"><b>${per.src.era5 && yP.some(y => E5X.has(y)) ? "ERA5-Land did not answer. " : ""}${per.src.ifs && Ferr ? `ECMWF IFS did not answer (${esc(Ferr.message || String(Ferr))}).` : ""}</b> ${RETRY}</p>` : ""}
            <p class="fine">m³/m³, daily means of the local day; ERA5-Land's days in the period (it ends about a week before today). ${!ifsDays && per.src.ifs ? "ECMWF IFS is read for the last 92 days only: none in this period. " : ""}
            <b>ERA5-Land</b>: the Copernicus Climate Change Service's land reanalysis (ECMWF; Muñoz-Sabater et al. 2021), 0.1° (about 9–11 km), daily since 1950${e5cell ? `, cell at ${fmt(e5cell[0], 2)}, ${fmt(e5cell[1], 2)}` : ""}. <b>ECMWF IFS</b>: the operational forecast model's land surface (9 km), the same four layers (0–7, 7–28, 28–100, 100–255 cm), each past day from that day's runs. Both through Open-Meteo (CC BY 4.0; ECMWF and Copernicus data, CC BY 4.0). Models, not measurements: they use their own soil texture and rain, so their levels can sit far from a station's.</p></div>`);
        }
      }

      /* year against year at one depth, and the average of the years before */
      const k0 = per.at, yearIn = y => plan.need(y).every(x => E5.has(x) || E5X.has(x));
      const ofYear = y => (yearIn(y) ? plan.bins(y).map(bn => agg(d => (d > utcDay() ? null : e5v(k0, d)), bn)) : plan.x.map(() => undefined));
      const aIn = A.length && A.every(y => E5.has(y) || E5X.has(y)), aC = aIn ? plan.base.map(bn => agg(d => avgDay(A, k0, d), bn)) : null, aL = A.length ? `Average ${A[0]}–${A[A.length - 1]}` : "";
      const yv = per.years.map(y => [y, ofYear(y)]);
      Ch.draw("smmYears", () => ({ data: { labels: plan.x, datasets: [
        ...yv.map(([y, v]) => line(`${y}`, v, YEAR_COLORS[per.slot.get(y)], { points: plan.months || plan.step === "week", w: y === ymd(per.d1)[0] ? 2.5 : 2 })),
        ...(aC ? [line(aL, aC, C.ink, { dash: [5, 4], points: plan.months })] : [])] }, options: opts() }));
      const chips = q("#smmYearChips");
      if (chips) put(chips, per.years.map(y => { const v = yv.find(x => x[0] === y)[1], st = stats(v); return `<span class="chip"><i class="yr-sw" style="background:${YEAR_COLORS[per.slot.get(y)]}"></i>${y}${st ? ` · ${v2(st.mean)}` : yearIn(y) ? "" : " · …"} <button class="link" data-smm-drop="${y}" title="Take ${y} off the chart" aria-label="Take ${y} off the chart">✕</button></span>`; }).join("")
        + (A.length ? `<span class="chip"><i class="yr-sw" style="background:${C.ink}"></i>${esc(aL)}${aC && stats(aC) ? ` · ${v2(stats(aC).mean)}` : " · …"}</span>` : ""));
      const yHead = [plan.months ? "Month" : "Calendar day (step start)", ...per.years.map(y => `${y} (m3/m3)`), ...(A.length ? [`${aL} (m3/m3)`] : [])];
      const yRows = plan.x.map((x, i) => [x, ...yv.map(([, v]) => r3(v[i])), ...(A.length ? [aC ? r3(aC[i]) : null] : [])]);
      putTable(mine, "moisture_years", { title: `Soil moisture year against year, ERA5-Land ${OM_D[k0][0]}-${OM_D[k0][1]} cm (m3/m3)`, header: yHead, rows: yRows });

      /* SMAP L4 at its cell, and the National Water Model on request */
      const xS = q("#smmSmap");
      if (xS && (S || Serr || smB < smA)) {
        const top = S && S.top ? S.top : [], subL = S && S.sub ? S.sub : [], lt = top.length ? top[top.length - 1] : null, ls = subL.length ? subL[subL.length - 1] : null;
        const nw = nwmSeen.get(pt), tS = stats(top.map(p => p[1])), sS = stats(subL.map(p => p[1]));
        const rows = [
          ["SMAP L4, surface", "satellite + model", D(0, 5), lt ? v2(lt[1]) : "—", lt ? `${iso(lt[0])}, daily average` : "", tS ? v2(tS.mean) : "—", rng(tS)],
          ["SMAP L4, root zone", "satellite + model", D(0, 100), ls ? v2(ls[1]) : "—", ls ? `${iso(ls[0])}, daily average` : "", sS ? v2(sS.mean) : "—", rng(sS)],
          ...(nw ? [...[[0, 10], [10, 40], [40, 100], [100, 200]].map(([a, b], k) => ["National Water Model", "model", D(a, b), v2(nw.layers[k]), utcLabel(nw.valid), "—", "—"]),
            ["National Water Model", "model: % of saturation", D(0, 40), ok(nw.sat) ? `${fmt(nw.sat * 100, 0)}%` : "—", utcLabel(nw.valid), "—", "—"]] : []),
        ];
        const csv = [...top.map(([d, v]) => ["NASA SMAP L4 via USDA NASS Crop-CASMA", "satellite + model", 0, 5, iso(d), r3(v), "daily average of the 3-hourly analyses, 9 km cell"]),
          ...subL.map(([d, v]) => ["NASA SMAP L4 via USDA NASS Crop-CASMA", "satellite + model", 0, 100, iso(d), r3(v), "daily average of the 3-hourly analyses, 9 km cell"]),
          ...(nw ? [...[[0, 10], [10, 40], [40, 100], [100, 200]].map(([a, b], k) => ["NOAA National Water Model 3.0 land analysis (AWS)", "model", a, b, utcLabel(nw.valid), r3(nw.layers[k]), "SOIL_M, 1 km cell"]),
            ["NOAA National Water Model 3.0 land analysis (AWS)", "model", 0, 40, utcLabel(nw.valid), r3(nw.sat), "SOILSAT_TOP: fraction of saturation, not m3/m3"]] : [])];
        putTable(mine, "moisture_smap", { title: "Soil moisture, NASA SMAP L4 and the National Water Model (m3/m3)", header: ["Source", "Kind", "Top (cm)", "Bottom (cm)", "Date or time", "Value", "Note"], rows: csv });
        const vT = B.map(bn => agg(inMap(new Map(top)), bn)), vS = B.map(bn => agg(inMap(new Map(subL)), bn)), has = top.length || subL.length;
        if (has) shown.push(["SMAP L4 0-5 cm (m3/m3)", vT], ["SMAP L4 0-100 cm (m3/m3)", vS]);
        const why = smB < smA ? (per.d1 < SMAP_D0 ? "SMAP L4 begins on 31 March 2015: none in this period." : "No SMAP days in this period.")
          : `${Serr ? `SMAP L4 could not be read from Crop-CASMA: ${esc(Serr.message || String(Serr))}. The map layer (NASA GIBS) still shows it. ${RETRY}` : ""}${Spart ? `SMAP L4's ${Spart.which} could not be read from Crop-CASMA: ${esc(Spart.e.message || String(Spart.e))}. ${RETRY}` : ""}${smA > per.d0 ? `Read from ${iso(smA)}${smA === SMAP_D0 ? ", when SMAP begins" : `: the last ${SMAP_MAX} days of the period at most, as Crop-CASMA serves 200 days a request and takes up to half a minute for each`}. ` : ""}`;
        const body = `${!has && !nw ? "" : grid([th("Source"), th("Kind"), th("Depth"), th("Latest", "m³/m³"), th("Date"), th("Period mean", "m³/m³"), th("Period range", "m³/m³")], rows.map(r => r.map((c, i) => (i < 3 || i === 4 ? esc(c) : c))))}
          ${why ? `<p class="fine">${why}</p>` : ""}`;
        const foot = `<p class="fine">${nw ? `National Water Model read ${esc(utcLabel(nw.valid))} (${fmt(nw.bytes / 1e6, 1)} MB).` : `<button class="link" data-smm-nwm data-lat="${lat}" data-lon="${lon}">Read the National Water Model here</button> (its four layers at the 1 km cell, the latest hour: about 2.5 MB from NOAA's files on AWS, which can take half a minute).`}
          ${csv.length ? `<button class="link" data-sm-csv="moisture_smap">This table, every day (CSV)</button>` : ""}</p>
          <p class="fine"><b>SMAP L4</b> (NASA GMAO, SPL4SMAU): the SMAP satellite's L-band readings of the top 5 cm assimilated into the Catchment land model, 9 km, about 3 days behind; the root zone (0–100 cm) is the model's, steered by the surface. Daily averages of its 3-hourly analyses at this 9 km cell from USDA NASS Crop-CASMA (George Mason University). <b>National Water Model</b> (NOAA Office of Water Prediction, version 3.0, Noah-MP, 1 km, hourly analysis): volumetric water in four layers (0–10, 10–40, 40–100, 100–200 cm) and the top 40 cm's fraction of saturation (what the NWM map shows). Public domain.</p>`;
        put(xS, has ? figCard("smmSat", "Satellite (SMAP L4) and the National Water Model", 220, { file: `soil_moisture_smap_${s}`, x: xName, sub: `${Wx.siteLine()} · SMAP L4, ${STEP_WORD[s][0].toLowerCase()} means`, bins: B }, { tag: "satellite · model", top: body, foot })
          : `<div class="card">${head("Satellite (SMAP L4) and the National Water Model", "", "satellite · model")}${body}${foot}</div>`);
        if (has) Ch.draw("smmSat", () => ({ data: { labels: xs, datasets: [line(`SMAP ${D(0, 5)}`, vT, COLS[0], { points: s !== "day" }), line(`SMAP ${D(0, 100)}`, vS, COLS[2], { points: s !== "day" })] }, options: opts(it => binText(B[it[0].dataIndex])) }));
      }

      /* the nearest stations over the period (their newest two years at most), at their own sensor depths */
      const xT = q("#smmSt");
      if (xT && (nearErr || (near && !near.length))) put(xT, nearErr ? Wx.failed("the nearest soil moisture stations", nearErr) : `<div class="card">${head("Nearest soil moisture stations", "", "station")}<p class="fine" style="margin-top:0">No SCAN, SNOTEL or USCRN station within 400 km.</p></div>`);
      else if (xT && near && (got || gotErr)) {
        const labs = new Map();
        near.forEach(st => st.depths.forEach(d => labs.set(d.label, d.cm)));
        const ctl = `<div class="smm-fs" role="group" aria-label="Sensor depths"><span class="smm-fs-k">Sensor depths</span>${[...labs].sort((a, b) => a[1] - b[1]).map(([l]) => `<label class="check"><input type="checkbox" data-smm-c="stdep" value="${esc(l)}" ${per.stOff.has(l) ? "" : "checked"}>${esc(l)}</label>`).join("")}</div>`;
        const csv = [], charts = [], now = stB >= t1 - 2;
        const cards = near.map((st, n) => {
          const r = got ? got[n] : gotErr, net = NET[st.net], id = st.src === "crn" ? `WBAN ${st.id}` : st.id.split(":")[0];
          const where = `${dist(st.km)} ${esc(st.dir)} · ${esc(net[0])} ${esc(id)} · elevation ${UN.fmt("elev", st.ft * 0.3048, 0)}${st.since ? ` · since ${esc(st.since)}` : ""}`;
          if (r instanceof Error) return `<div class="card">${head(st.name, "", "station")}<p class="fine" style="margin-top:0">${ptLink(st, stSub(net[0], id, st.km, st.dir))} · ${where}. Could not read its data: ${esc(String(r.message || r).trim())}. ${RETRY}</p></div>`;
          const deps = st.depths.filter(d => !per.stOff.has(d.label));
          const rows = deps.map(d => {
            const pts = (r.daily.get(d.key) || []).filter(x => x[0] >= stA && x[0] <= stB), last = now ? r.latest.get(d.key) : null, ld = pts.length ? pts[pts.length - 1] : null, sd = stats(pts.map(x => x[1]));
            pts.forEach(([day, v]) => csv.push([st.name, net[0], id, r3(st.km), d.label, +d.cm.toFixed(1), iso(day), r3(v), r3(v * 100), "daily mean"]));
            if (last) csv.push([st.name, net[0], id, r3(st.km), d.label, +d.cm.toFixed(1), last.time, r3(last.v), r3(last.v * 100), "latest hourly reading"]);
            return [`${esc(d.label)}${st.src === "awdb" ? ` <small>${esc(Dp(d.cm))}</small>` : ""}`, last ? v2(last.v) : ld ? v2(ld[1]) : "—", last ? esc(last.time) : ld ? `${iso(ld[0])} mean` : `<small>no readings in the period</small>`, sd ? v2(sd.mean) : "—", rng(sd)];
          });
          const series = deps.map(d => { const m = new Map(r.daily.get(d.key) || []); return { d, v: B.map(bn => (bn.b < stA ? null : agg(inMap(m), { a: Math.max(bn.a, stA), b: bn.b }))) }; }).filter(x => x.v.some(ok));
          series.forEach(x => shown.push([`${st.name} (${net[0]} ${id}) ${x.d.label} (m3/m3)`, x.v]));
          const top = `<p class="fine" style="margin-top:0">${ptLink(st, stSub(net[0], id, st.km, st.dir))} · ${where}.</p>${deps.length ? grid([th("Sensor depth"), th(now ? "Latest" : "Last in the period", "m³/m³"), th("Time"), th("Period mean", "daily means"), th("Period range", "daily means")], rows) : `<p class="fine">No sensor depth chosen.</p>`}`;
          if (!series.length) return `<div class="card">${head(st.name, "", "station")}${top}<p class="fine">No daily means in this period${st.since ? ` (its record begins in ${esc(st.since)})` : ""}.</p></div>`;
          charts.push([`smmSt${n}`, series]);
          return figCard(`smmSt${n}`, st.name, tall(series.length) - 20, { file: `soil_moisture_station_${n + 1}_${s}`, x: xName, sub: `${st.name} (${net[0]} ${id}) · ${STEP_WORD[s][0].toLowerCase()} means of the daily means`, bins: B }, { tag: "station", top });
        });
        putTable(mine, "moisture_stations", { title: "Soil moisture at the nearest stations (station measurements)", header: ["Station", "Network", "ID", "Distance (km)", "Sensor depth", "Sensor depth (cm)", "Date or time", "Soil moisture (m3/m3)", "Soil moisture (% by volume)", "Kind"], rows: csv });
        put(xT, `<div class="card">${head("Nearest soil moisture stations", csv.length ? "moisture_stations" : "", "station")}${ctl}
          <p class="fine">Measured in the ground by each station's sensors (volumetric water content; dielectric probes) at the depth shown, hourly; daily means over the station's local standard day (LST)${stA > per.d0 ? `, read from ${iso(stA)}: the last two years of the period at most` : ""}. <b>USDA NRCS SCAN and SNOTEL</b> (Air and Water Database, public domain) report % by volume at 2, 4, 8, 20 and 40 in (5, 10, 20, 51, 102 cm), shown here ÷ 100; SNOTEL sites are in the mountains, often under snow in winter. <b>NOAA USCRN</b> (public domain) reports m³/m³ at 5, 10, 20, 50 and 100 cm. A station reads its own soil: tens of km away, in another soil, it can differ a lot from this point. Sensors drift or fail: a flat or stepped line may be a sensor fault.</p></div>${cards.join("")}`);
        charts.forEach(([id, series]) => Ch.draw(id, () => ({ data: { labels: xs, datasets: series.map((x, i) => line(x.d.label, x.v, COLS[i % COLS.length], { points: s !== "day" })) }, options: opts(it => binText(B[it[0].dataIndex])) })));
      }

      /* the table of what is shown: every line over the period by step, and the years compared */
      const sb = q("#smmShown");
      if (sb) {
        const hdr = ["From", "To", ...shown.map(x => x[0])], rows = B.map((bn, i) => [iso(bn.a), iso(bn.b), ...shown.map(x => r3(x[1][i]))]);
        putTable(mine, "moisture_shown", { title: `Soil moisture shown, ${STEP_WORD[s][0].toLowerCase()} means ${iso(per.d0)} to ${iso(per.d1)} (m3/m3)`, header: hdr, rows });
        const cell = v => (ok(v) ? fmt(v, 3) : "—");
        put(sb, `<div class="card">${head("The values shown", "moisture_shown", `${B.length} ${STEP_WORD[s][1]}s`)}
            <details class="smm-tbl"><summary>Every line over the period, by ${STEP_WORD[s][1]} (${shown.length} series)</summary>
              ${grid([th(s === "day" ? "Date" : "From"), ...(s === "day" ? [] : [th("To")]), ...shown.map(x => esc(x[0].replace(/ \(m3\/m3\)$/, "")))], rows.map(r => [r[0], ...(s === "day" ? [] : [r[1]]), ...r.slice(2).map(cell)]))}</details>
            <div class="card-h smm-sub"><h3>Year against year: the values</h3><div class="card-tools"><button class="dl-btn" data-sm-csv="moisture_years" title="Download this table (CSV)" aria-label="Download the years table (CSV)">${DL}</button></div></div>
            <details class="smm-tbl"><summary>ERA5-Land ${esc(D(...OM_D[k0]))}, ${per.years.length} year${per.years.length === 1 ? "" : "s"}${A.length ? " and the average" : ""}</summary>
              ${grid([th(yHead[0]), ...yHead.slice(1).map(h => esc(h.replace(/ \(m3\/m3\)$/, "")))], yRows.map(r => [esc(r[0]), ...r.slice(1).map(cell)]))}</details>
            <p class="fine">m³/m³, the mean of each step's days (blank where more than a tenth of them have no value). Each card's own button gives its table or figure alone; the button below gives every table of this tab in one file.</p></div>`);
      }
    }

    draw();
    setTimeout(() => { if (mine()) el.style.minHeight = ""; }, 1500);
    const jobs = [
      summary(lat, lon).then(r => { sumR = r; }, e => { sumErr = e; }).then(later),
      per.src.era5 || per.src.ifs ? e5Read(lat, lon, yP).then(later) : null,
      e5Read(lat, lon, yC).then(later),
      per.src.ifs && ifsDays ? Wx.once(`smm:ifs:${ifsDays}:${pt}`, () => ifsAt(lat, lon, ifsDays)).then(x => { F = x; }, e => { Ferr = e; }).then(later) : null,
      Wx.once(`smm:ifs:31:${pt}`, () => ifsAt(lat, lon, 31)).then(x => { Fnow = x; }, () => {}).then(later), // today's values: the summary's read
      // SMAP's two layers each kept on its own (a layer that failed is asked again alone)
      per.src.smap && smB >= smA ? Promise.allSettled(["TOP", "SUB"].map(p => Wx.once(`smm:smap:${p}:${smA}:${smB}:${pt}`, () => smapLayer(lat, lon, p, smA, smB)))).then(([a, b]) => {
        const bad = [a, b].filter(x => x.status === "rejected").map(x => x.reason);
        bad.forEach(e => console.warn("SMAP", e));
        if (bad.length === 2) { Serr = bad[0]; return; }
        S = { top: a.status === "fulfilled" ? a.value : null, sub: b.status === "fulfilled" ? b.value : null };
        if (bad.length) Spart = { which: a.status === "rejected" ? "surface layer (0–5 cm)" : "root zone (0–100 cm)", e: bad[0] };
      }).then(later) : null,
      per.src.st ? Wx.once(`smm:near:${pt}`, () => nearest(lat, lon, 3)).then(l => { near = l; later(); if (l.length) return readStations(l, stA, stB).then(g => { got = g; }, e => { gotErr = e; }); }, e => { nearErr = e; }).then(later) : null,
    ];
    await Promise.allSettled(jobs.filter(Boolean));
    busy = false;
    draw();
  };

  /* the National Water Model on request: read once per point, then the tab is drawn again with it */
  async function nwmClick(b) {
    const lat = +b.dataset.lat, lon = +b.dataset.lon;
    b.disabled = true; b.textContent = "Reading the National Water Model…";
    try {
      nwmSeen.set(ptKey(lat, lon), await nwmAt(lat, lon));
      if (redrawNow) redrawNow();
    } catch (e) { console.warn("NWM", e); b.disabled = false; b.textContent = "Read the National Water Model here (try again)"; WG.util.toast(`The National Water Model could not be read: ${e.message}`, 5000); }
  }

  return { layers: LAYERS, pick, stations, nearest, readStations, era5At, era5Range, ifsAt, smapAt, nwmAt, summary, summaryOn, lastSummary, mapDay, soilRange, period: per };
})();
