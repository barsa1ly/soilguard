/* Soil moisture by depth, in the Soil maps theme: its map layers and a part of the Soil maps tab.
   Map layers (pushed onto the theme's list, which app.js reads after this file has loaded): NASA SMAP Level-4 surface
   (0-5 cm) and root-zone (0-100 cm) soil moisture through NASA GIBS, any day since 31 March 2015; the NOAA National
   Water Model's near-surface saturation (0-40 cm), the latest hour; the NASA SPoRT-LIS (0-100 cm) and GRACE-DA root-zone
   percentiles through NOAA NIDIS's drought.gov tiles, the latest day or week; and the soil moisture stations (USDA NRCS
   SCAN and SNOTEL, NOAA USCRN) from data/soilmoisture_stations.json (tools/build_moisture.py).
   The tab part gives, at the point: the models by depth (ERA5-Land reanalysis, the last 30 days; ECMWF IFS, today, both
   through Open-Meteo), SMAP L4 at its 9 km cell (USDA NASS Crop-CASMA), the National Water Model's four layers on
   request (read in place from NOAA's files on AWS with js/h5range.js), and the three nearest stations with their latest
   readings and 30 days of daily means. Each value says what it is: a model, a satellite analysis or a station's
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
  const dLabel = d => { const t = new Date(d * 864e5); return `${MON[t.getUTCMonth()]} ${t.getUTCDate()}`; };
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
  const smapSf = tiles(smapUrl("sf"), { maxNativeZoom: 6, attribution: "NASA GIBS; SMAP L4 (NASA GMAO)" });
  const smapRz = tiles(smapUrl("rz"), { maxNativeZoom: 6, attribution: "NASA GIBS; SMAP L4 (NASA GMAO)" });
  // the chosen day; the latest is GIBS's "default" time, so nothing is asked before the layer is shown
  function smapSet() { smapSf.setUrl(smapUrl("sf", pick.date)); smapRz.setUrl(smapUrl("rz", pick.date)); redrawLegend(); }

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
  const nwmWhen = () => fetchJSON(`${NWM_REST}2/query?where=1%3D1&outFields=idp_validtime&returnGeometry=false&f=json`, {}, 20000)
    .then(j => { const t = num((((j.features || [])[0] || {}).attributes || {}).idp_validtime); return t ? `Valid ${utcLabel(t)}.` : ""; });

  /* ---------- NOAA NIDIS (drought.gov) percentile tiles: the latest day (SPoRT) or week (GRACE) ---------- */
  const NIDIS = "https://storage.googleapis.com/noaa-nidis-drought-gov-data/current-conditions/tile/v1/";
  const US_BOX = L.latLngBounds([24.4, -128.8], [50.3, -66.0]); // the tiles' extent (info.json bbox): no requests outside
  const nidisWhen = k => () => fetchJSON(`${NIDIS}${k}/info.json`, {}, 20000).then(j => { const d = String(j.date || ""); const s = /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : d; return s ? `Map of ${s}.` : ""; });
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
  const smapWhen = () => smapDays().then(D => { const d = pick.date || D.latest; return hasMap(D, d) ? `Map of ${d}${pick.date ? "" : ", the latest"}.` : `GIBS has no SMAP map for ${d}: choose another day.`; });
  const item = (key, name, sub, layer, legend, note, o = {}) => ({ key, name, sub, layer, legend, note, drawLegend, opacity: 1.2, ...o });
  const LAYERS = [
    item("smap_sf", "Soil moisture, surface 0–5 cm", "NASA SMAP L4, 9 km, any day since 2015", smapSf, { title: "Soil moisture, 0–5 cm (SMAP L4)", unit: "m³/m³", scale: SMAP_RAMP, ticks: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7].map(v => [v / 0.7, v === 0.7 ? "≥0.7" : String(v)]) },
      SMAP_NOTE("surface layer 0–5 cm", ""), { dated: true, when: smapWhen }),
    item("smap_rz", "Soil moisture, root zone 0–100 cm", "the same, the top metre", smapRz, { title: "Soil moisture, 0–100 cm (SMAP L4)", unit: "m³/m³", scale: SMAP_RAMP, ticks: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7].map(v => [v / 0.7, v === 0.7 ? "≥0.7" : String(v)]) },
      SMAP_NOTE("root zone 0–100 cm", "The model carries the surface readings down; the satellite itself sees only the top few centimetres."), { dated: true, when: smapWhen }),
    item("nwm", "Soil saturation 0–40 cm, this hour", "NOAA National Water Model, 1 km, % of saturation", nwmLayer, { title: "Soil saturation, 0–40 cm (NWM)", unit: "% of saturation", rows: NWM_ROWS },
      "How full the soil's pores are in the top 40 cm (100% = saturated), from the NOAA National Water Model's hourly land analysis (Noah-MP, 1 km, version 3.0; public domain). A model: its soils and rain differ from a field's, and it often reads wetter than stations in dry country. Only the latest hour is served.", { when: nwmWhen }),
    item("sport", "Soil moisture percentile 0–100 cm", "NASA SPoRT-LIS, 3 km, today", sport, { title: "Soil moisture percentile, 0–100 cm (SPoRT-LIS)", unit: "percentile", rows: SPORT_ROWS },
      `${PCT_NOTE} NASA SPoRT's Land Information System (Noah model, 3 km), daily, against its 1981–2013 record. Through NOAA NIDIS (drought.gov); only the latest day is served.`, { when: nidisWhen("nasa-sport-3km") }),
    item("grace", "Root-zone moisture percentile", "NASA GRACE-DA, 12 km, weekly", grace, { title: "Root-zone soil moisture percentile (GRACE-DA)", unit: "percentile", rows: GRACE_ROWS },
      `${PCT_NOTE} NASA GRACE-FO satellite gravity (total water storage) assimilated into the Catchment land model (NASA GSFC, with the National Drought Mitigation Center), root zone about 0–100 cm, 0.125°, weekly, against 1948–2012. Through NOAA NIDIS (drought.gov); only the latest week is served.`, { when: nidisWhen("nasa-rtzsm-0.125d") }),
    item("stations", "Soil moisture stations", "USDA SCAN and SNOTEL, NOAA USCRN: tap one", stationLayer, { title: "Soil moisture stations", rows: [["#2a78d6", "SCAN (USDA NRCS), 2–40 in"], ["#6250d6", "CSCAN (USDA NRCS cooperative)"], ["#1baf7a", "SNOTEL (USDA NRCS), mountains"], ["#eb6834", "USCRN (NOAA), 5–100 cm"]] },
      "Stations that measure soil moisture by depth and report it every hour. Tap a station (or any point): the Soil maps tab lists the three nearest with their latest readings and 30 days of daily means. List of active stations made with tools/build_moisture.py."),
  ];
  LAYERS.forEach(x => SM.layers.push(x));
  const T = Wx.THEMES.find(t => t.key === "soilmaps");
  if (T) T.note = `${T.note} Soil moisture: NASA SMAP by day since 2015, the National Water Model's saturation, drought.gov's percentiles and the stations that measure it.`;

  // the day chosen under the SMAP legend
  function setDate(v) { pick.date = v || null; smapDays().then(D => { if (pick.date === D.latest) pick.date = null; }, () => {}).then(smapSet); }
  document.addEventListener("change", e => { const s = e.target.closest && e.target.closest('[data-smm="date"]'); if (s && /^\d{4}-\d\d-\d\d$/.test(s.value)) setDate(s.value < SMAP0 ? SMAP0 : s.value); });
  document.addEventListener("click", e => { const b = e.target.closest && e.target.closest("[data-smm-latest]"); if (b) { e.preventDefault(); setDate(null); } const n = e.target.closest && e.target.closest("[data-smm-nwm]"); if (n) { e.preventDefault(); nwmClick(n); } });

  /* ---------- each source at a point: plain async functions of lat, lon ---------- */
  const OM_D = [[0, 7], [7, 28], [28, 100], [100, 255]], OM_V = OM_D.map(([a, b]) => `soil_moisture_${a}_to_${b}cm`);
  /* Open-Meteo's longer answers (31 days of hours) now and then miss the 30 s cap while the page waits on many other
     sources, and answer in a few seconds when asked again: one more try, with 45 s */
  const omJSON = url => fetchJSON(url, {}, 30000).catch(() => new Promise(r => setTimeout(r, 1000)).then(() => fetchJSON(url, {}, 45000)));
  /* ERA5-Land (Copernicus reanalysis, 0.1°), daily means: about 5 days behind, so 42 days are asked to have 30 */
  async function era5At(lat, lon) {
    const t = today(), j = await omJSON(`https://archive-api.open-meteo.com/v1/archive?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&start_date=${iso(t - DAYS - 12)}&end_date=${iso(t)}&daily=${OM_V.map(v => `${v}_mean`).join(",")}&models=era5_land&timezone=auto`);
    const d = j.daily || {};
    return { lat: j.latitude, lon: j.longitude, series: OM_D.map(([a, b], k) => ({ a, b, pts: (d.time || []).map((s, i) => [dayOf(s), num((d[`${OM_V[k]}_mean`] || [])[i])]).filter(p => ok(p[1])) })) };
  }
  /* ECMWF IFS (9 km), hourly from its successive runs: the past 31 days and today, as daily means of the local day */
  async function ifsAt(lat, lon) {
    const j = await omJSON(`https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&hourly=${OM_V.join(",")}&models=ecmwf_ifs&past_days=${DAYS + 1}&forecast_days=1&timezone=auto`);
    const h = j.hourly || {}, times = h.time || [];
    return { lat: j.latitude, lon: j.longitude, tz: j.timezone_abbreviation || "", series: OM_D.map(([a, b], k) => {
      const by = new Map();
      times.forEach((s, i) => { const v = num((h[OM_V[k]] || [])[i]); if (!ok(v)) return; const d = dayOf(s), g = by.get(d) || [0, 0]; g[0] += v; g[1]++; by.set(d, g); });
      return { a, b, pts: [...by].sort((x, y) => x[0] - y[0]).map(([d, [s, n]]) => [d, s / n]) };
    }) };
  }
  /* SMAP L4 at its 9 km cell, daily averages of the 3-hourly analyses, from USDA NASS Crop-CASMA's service (GET only:
     its POST preflight is refused); the cell is asked in EPSG:5070 metres (js/landcover.js albers) */
  const CASMA = "https://nassgeo.csiss.gmu.edu/smap_service?service=WPS&version=1.0.0&request=Execute&identifier=GetProfileByDate&DataInputs=";
  async function smapAt(lat, lon, d0, d1) {
    if (!WG.landcover || !WG.landcover.albers) throw new Error("the Albers projection (js/landcover.js) is not loaded");
    const [x, y] = WG.landcover.albers(lon, lat), dot = d => iso(d).replace(/-/g, ".");
    const one = async p => {
      const t = await fetchText(`${CASMA}productId=SMAP-9KM-DAILY-${p};x=${Math.round(x)};y=${Math.round(y)};startDate=${dot(d0)};endDate=${dot(d1)}`, 45000);
      const u = (/https?:\/\/[^<\s"]+\.csv/.exec(t) || [])[0];
      if (!u) throw new Error((/<ows:ExceptionText>([^<]+)/.exec(t) || [])[1] || "Crop-CASMA gave no series");
      const c = await fetchText(u.replace(/^http:/, "https:"), 30000);
      return c.trim().split(/\r?\n/).slice(1).map(l => l.split(",")).map(([d, a]) => [dayOf((d || "").replace(/\./g, "-")), num(a)]).filter(p => Number.isFinite(p[0]) && ok(p[1]) && p[1] >= 0 && p[1] <= 1);
    };
    const [top, sub] = await Promise.allSettled([one("TOP"), one("SUB")]);
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
      const r = await fetch(url, { headers: { Range: "bytes=0-0" }, signal: AbortSignal.timeout(15000) }).catch(() => null);
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
  /* USDA NRCS AWDB: daily means (SMV; the start-of-day value SMS where a sensor has no mean) and the latest hourly
     readings, in % by volume, for several stations in two requests. Times are the station's local standard time. */
  const AWDB = "https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/data";
  async function awdbRead(trips, d0, d1) {
    const q = (els, dur, a, b) => fetchJSON(`${AWDB}?stationTriplets=${trips.join(",")}&elements=${els}&duration=${dur}&beginDate=${encodeURIComponent(a)}&endDate=${encodeURIComponent(b)}`, {}, 40000);
    const [day, hr] = await Promise.all([q("SMV:*,SMS:*", "DAILY", iso(d0), iso(d1)), q("SMS:*", "HOURLY", `${iso(d1 - 2)} 00:00`, `${iso(d1 + 1)} 00:00`).catch(() => [])]);
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
  /* NOAA USCRN: the year's daily file (about 70 KB) and the end of its hourly file (a byte range from the size, as a
     suffix range "bytes=-N" is not allowed across origins); m³/m³ at 5, 10, 20, 50 and 100 cm, -99 missing */
  const CRN = "https://www.ncei.noaa.gov/pub/data/uscrn/products/";
  const CRN_K = [5, 10, 20, 50, 100];
  async function crnRead(stem, d0, d1) {
    const years = [...new Set([new Date(d0 * 864e5).getUTCFullYear(), new Date(d1 * 864e5).getUTCFullYear()])];
    const texts = await Promise.all(years.map(y => fetchText(`${CRN}daily01/${y}/CRND0103-${y}-${stem}.txt`, 30000).catch(e => (y === years[years.length - 1] ? Promise.reject(e) : ""))));
    const daily = new Map();
    texts.join("\n").split("\n").map(l => l.trim().split(/\s+/)).filter(c => c.length >= 23 && /^\d{8}$/.test(c[1])).forEach(c => {
      const d = dayOf(`${c[1].slice(0, 4)}-${c[1].slice(4, 6)}-${c[1].slice(6)}`);
      if (d < d0 || d > d1) return;
      CRN_K.forEach((k, i) => { const v = num(c[18 + i]); if (ok(v) && v >= 0) { if (!daily.has(k)) daily.set(k, []); daily.get(k).push([d, v]); } });
    });
    const latest = new Map();
    try {
      const y = new Date(d1 * 864e5).getUTCFullYear(), url = `${CRN}hourly02/${y}/CRNH0203-${y}-${stem}.txt`;
      const h = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(15000) }), size = +h.headers.get("content-length");
      const r = await fetch(url, { headers: size > 30000 ? { Range: `bytes=${size - 30000}-` } : {}, signal: AbortSignal.timeout(20000) });
      (await r.text()).split("\n").slice(1).map(l => l.trim().split(/\s+/)).filter(c => c.length >= 33).forEach(c => CRN_K.forEach((k, i) => {
        const v = num(c[28 + i]);
        if (ok(v) && v >= 0) latest.set(k, { v, time: `${c[3].slice(0, 4)}-${c[3].slice(4, 6)}-${c[3].slice(6)} ${c[4].slice(0, 2)}:${c[4].slice(2)} LST` });
      }));
    } catch (e) { console.warn("USCRN hourly", stem, e); } // the daily means still show
    return { daily, latest };
  }
  /* the readings of a list of stations (from nearest): each station's {daily: depth -> [[day, m³/m³]], latest: depth -> {v, time}} or an Error */
  async function readStations(list, d0, d1) {
    const aw = list.filter(s => s.src === "awdb"), got = new Map();
    const pA = aw.length ? awdbRead(aw.map(s => s.id), d0, d1).then(m => m.forEach((v, k) => got.set(k, v)), e => aw.forEach(s => got.set(s.id, e))) : null;
    await Promise.all([pA, ...list.filter(s => s.src === "crn").map(s => crnRead(s.stem, d0, d1).then(v => got.set(s.id, v), e => got.set(s.id, e)))]);
    return list.map(s => got.get(s.id) || new Error("no answer"));
  }

  /* ---------- a small line chart (inline SVG): one line a depth, a hover column a day ---------- */
  const COLS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"]; // categorical slots 1-5, shallowest first
  function chart(series, d0, d1, w, label) {
    const vals = series.flatMap(s => s.pts.filter(p => p[0] >= d0 && p[0] <= d1).map(p => p[1])).filter(ok);
    if (!vals.length) return `<p class="fine">No values in these ${DAYS} days.</p>`;
    const W = Math.round(Math.max(280, Math.min(760, w))), H = 170, l = 36, r = 22, t = 8, b = 20, pw = W - l - r, ph = H - t - b;
    const mn = Math.min(...vals), mx = Math.max(...vals), st = mx - mn > 0.3 ? 0.1 : mx - mn > 0.1 ? 0.05 : 0.02;
    const lo = Math.max(0, Math.floor((mn - st / 4) / st) * st), hi = Math.max(lo + st, Math.ceil((mx + st / 4) / st) * st);
    const X = d => l + ((d - d0) / Math.max(1, d1 - d0)) * pw, Y = v => t + ph - ((v - lo) / (hi - lo)) * ph;
    let g = "";
    for (let v = lo; v <= hi + 1e-9; v += st) g += `<line x1="${l}" x2="${W - r}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text stroke="none" x="${l - 4}" y="${(Y(v) + 3.5).toFixed(1)}" text-anchor="end">${v.toFixed(2)}</text>`;
    for (let d = d1; d >= d0; d -= 7) g += `<text stroke="none" x="${X(d).toFixed(1)}" y="${H - 5}" text-anchor="middle">${dLabel(d)}</text>`;
    const line = s => {
      let p = "", n = 0, last = null;
      s.pts.forEach(([d, v]) => { if (d < d0 || d > d1) return; if (!ok(v)) { n = 0; return; } p += `${n ? "L" : "M"}${X(d).toFixed(1)},${Y(v).toFixed(1)}`; n++; last = [d, v]; });
      return (p ? `<path d="${p}" stroke="${s.color}"${s.dash ? ' stroke-dasharray="5 3"' : ""}/>` : "") + (last ? `<circle cx="${X(last[0]).toFixed(1)}" cy="${Y(last[1]).toFixed(1)}" r="3" fill="${s.color}"/>` : "");
    };
    // hover: a column a day whose title lists each line's value that day (the browser's own tooltip)
    const cw = pw / (d1 - d0 + 1), hov = [];
    for (let d = d0; d <= d1; d++) {
      const at = series.map(s => { const p = s.pts.find(q => q[0] === d); return p && ok(p[1]) ? `${s.label}: ${p[1].toFixed(3)}` : null; }).filter(Boolean);
      if (at.length) hov.push(`<rect x="${(X(d) - cw / 2).toFixed(1)}" y="${t}" width="${cw.toFixed(1)}" height="${ph}"><title>${esc(iso(d))} (m³/m³)\n${esc(at.join("\n"))}</title></rect>`);
    }
    return `<svg class="smm-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}"><g class="ax" stroke="#ebe8df" fill="#69716a" font-size="11">${g}</g><g class="ln" fill="none" stroke-width="2" stroke-linejoin="round">${series.map(line).join("")}</g><g class="hv" fill="transparent">${hov.join("")}</g></svg>
      <div class="smm-key">${series.map(s => `<span><i style="border-top-color:${s.color}"${s.dash ? ' class="d"' : ""}></i>${esc(s.label)}</span>`).join("")}</div>`;
  }

  /* ---------- the tab part ---------- */
  const v2 = v => (ok(v) ? fmt(v, 2) : "—"), r3 = v => (ok(v) ? +v.toFixed(3) : null);
  const D = (a, b) => UN.range("depth", a, b, 0), Dp = cm => UN.fmt("depth", cm, 0);
  const dist = k => UN.fmt("distance", k, k < 10 ? 1 : 0);
  const at = (pts, d) => (pts.find(p => p[0] === d) || [])[1];
  const span = pts => { const v = pts.map(p => p[1]).filter(ok); return v.length ? `${v2(Math.min(...v))}–${v2(Math.max(...v))}` : "—"; };
  const nearAt = (pts, d, k = 2) => { const p = pts.find(q => q[0] >= d && q[0] <= d + k); return p ? p : null; }; // the first value on or just after a day
  const putTable = (live, id, t) => { if (live()) SM.tables()[id] = t; };
  const { head, grid, th, showBtn } = SM;
  const wid = el => (el.clientWidth || 600) - 30;
  const W8 = Wx.wait;
  const lastOf = R => { const d = R ? R.series.flatMap(s => s.pts.map(p => p[0])) : []; return d.length ? Math.max(...d) : null; };
  const nwmSeen = new Map(), redrawS = new WeakMap(); // NWM reads by point; the SMAP card's redraw by its box

  async function render(el, live, lat, lon) {
    const t1 = today(), d0 = t1 - DAYS;
    el.innerHTML = `<div class="card">${head("Soil moisture by depth", "", "model · satellite · station")}
        <p class="fine" style="margin-top:0">Water in the soil at this point, in <b>m³/m³</b> (volume of water in a volume of soil: 0.25 = 25% by volume), from three kinds of source, each labelled: <b>models</b> (computed from weather and their own soil maps), <b>satellite</b> analyses (SMAP, merged into a model) and <b>station</b> measurements (sensors in the ground, the nearest may be tens of km away). Models and stations often differ by 0.1 or more: a model's soil is not the field's. Compare their changes over the month more than their levels.
        Maps: ${showBtn("smap_sf", "SMAP surface")} · ${showBtn("smap_rz", "SMAP root zone")} · ${showBtn("nwm", "NWM saturation")} · ${showBtn("sport", "percentile (daily)")} · ${showBtn("grace", "percentile (weekly)")} · ${showBtn("stations", "stations")}.</p></div>
      <div class="smm-m">${W8("the soil moisture models by depth (Open-Meteo: ERA5-Land, ECMWF IFS)")}</div>
      <div class="smm-s">${W8("NASA SMAP L4 at this 9 km cell (USDA Crop-CASMA)")}</div>
      <div class="smm-st">${W8("the nearest soil moisture stations (USDA SCAN and SNOTEL, NOAA USCRN)")}</div>`;
    const box = c => (live() ? el.querySelector(c) : null);
    const fail = (c, what) => e => { console.warn("soil moisture", what, e); const x = box(c); if (x) x.innerHTML = Wx.failed(what, e); };

    /* models: ERA5-Land's last 30 days and ECMWF IFS's to today, four depths */
    const pM = Promise.allSettled([Wx.once("smm:era5", () => era5At(lat, lon)), Wx.once("smm:ifs", () => ifsAt(lat, lon))]).then(([e, f]) => {
      const x = box(".smm-m");
      if (!x) return;
      if (e.status === "rejected" && f.status === "rejected") throw e.reason;
      const eLast = lastOf(e.value), fLast = lastOf(f.value), E = eLast === null ? null : e.value, F = fLast === null ? null : f.value;
      const rows = OM_D.map(([a, b], k) => {
        const es = E ? E.series[k].pts : [], fs = F ? F.series[k].pts : [], e30 = es.filter(p => p[0] >= eLast - DAYS);
        const ago = E ? nearAt(es, eLast - DAYS) : null;
        return [D(a, b), v2(at(fs, fLast)), v2(at(es, eLast)), ago ? v2(ago[1]) : "—", span(e30)];
      });
      const csv = [];
      if (E) E.series.forEach(s => s.pts.forEach(([d, v]) => csv.push(["ERA5-Land (Copernicus C3S) via Open-Meteo", "model: reanalysis", s.a, s.b, iso(d), r3(v), "daily mean, local day"])));
      if (F) F.series.forEach(s => s.pts.forEach(([d, v]) => csv.push(["ECMWF IFS 9 km via Open-Meteo", "model: analysis and forecast", s.a, s.b, iso(d), r3(v), d === fLast ? "mean of today's hours; the hours after now are forecast" : "daily mean of hourly values, local day"])));
      putTable(live, "moisture_models", { title: "Soil moisture by depth, models (m3/m3)", header: ["Source", "Kind", "Top (cm)", "Bottom (cm)", "Date", "Soil moisture (m3/m3)", "Note"], rows: csv });
      const series = [...(E ? E.series.map((s, k) => ({ label: `ERA5-Land ${s.a}–${s.b} cm`, color: COLS[k], pts: s.pts })) : []), ...(F ? F.series.map((s, k) => ({ label: `IFS ${s.a}–${s.b} cm`, color: COLS[k], dash: true, pts: s.pts })) : [])];
      x.innerHTML = `<div class="card">${head("Models by depth", "moisture_models", "model")}
        ${grid([th("Depth"), th(`Today, ECMWF IFS`, fLast ? iso(fLast) : ""), th("ERA5-Land, latest", eLast ? iso(eLast) : ""), th(`ERA5-Land ${DAYS} days before`, eLast ? iso(eLast - DAYS) : ""), th(`ERA5-Land, ${DAYS}-day range`, "daily means")], rows)}
        <p class="fine">m³/m³, daily means of the local day. ${E ? "" : "<b>ERA5-Land did not answer.</b> "}${F ? "" : "<b>ECMWF IFS did not answer.</b> "}</p>
        ${chart(series, d0, t1, wid(x), "Soil moisture by depth, models, the last 30 days")}
        <p class="fine"><b>ERA5-Land</b>: the Copernicus Climate Change Service's land reanalysis (ECMWF; Muñoz-Sabater et al. 2021), 0.1° (about 9–11 km), solid lines; about 5 days behind. <b>ECMWF IFS</b>: the operational forecast model's land surface (9 km), dashed lines, the same four layers (0–7, 7–28, 28–100, 100–255 cm), to today: each past day from that day's runs, today partly forecast. Both through Open-Meteo (CC BY 4.0; ECMWF and Copernicus data, CC BY 4.0). Models, not measurements: they use their own soil texture and rain, so their levels can sit far from a station's.</p></div>`;
    }).catch(fail(".smm-m", "the soil moisture models"));

    /* SMAP L4 at its cell, and the National Water Model on request (its button draws this card again) */
    let lastS = null, lastErr = null;
    const sCard = (S, err) => {
      const x = box(".smm-s");
      if (!x) return;
      lastS = S; lastErr = err;
      redrawS.set(x, () => sCard(lastS, lastErr));
      const top = S && S.top ? S.top : [], sub = S && S.sub ? S.sub : [], lt = top.length ? top[top.length - 1] : null, ls = sub.length ? sub[sub.length - 1] : null;
      const nw = nwmSeen.get(`${lat.toFixed(4)},${lon.toFixed(4)}`);
      const rows = [
        ["SMAP L4, surface", "satellite + model", D(0, 5), lt ? v2(lt[1]) : "—", lt ? `${iso(lt[0])}, daily average` : "", span(top)],
        ["SMAP L4, root zone", "satellite + model", D(0, 100), ls ? v2(ls[1]) : "—", ls ? `${iso(ls[0])}, daily average` : "", span(sub)],
        ...(nw ? [...[[0, 10], [10, 40], [40, 100], [100, 200]].map(([a, b], k) => ["National Water Model", "model", D(a, b), v2(nw.layers[k]), utcLabel(nw.valid), "—"]),
          ["National Water Model", "model: % of saturation", D(0, 40), ok(nw.sat) ? `${fmt(nw.sat * 100, 0)}%` : "—", utcLabel(nw.valid), "—"]] : []),
      ];
      const csv = [...top.map(([d, v]) => ["NASA SMAP L4 via USDA NASS Crop-CASMA", "satellite + model", 0, 5, iso(d), r3(v), "daily average of the 3-hourly analyses, 9 km cell"]),
        ...sub.map(([d, v]) => ["NASA SMAP L4 via USDA NASS Crop-CASMA", "satellite + model", 0, 100, iso(d), r3(v), "daily average of the 3-hourly analyses, 9 km cell"]),
        ...(nw ? [...[[0, 10], [10, 40], [40, 100], [100, 200]].map(([a, b], k) => ["NOAA National Water Model 3.0 land analysis (AWS)", "model", a, b, utcLabel(nw.valid), r3(nw.layers[k]), "SOIL_M, 1 km cell"]),
          ["NOAA National Water Model 3.0 land analysis (AWS)", "model", 0, 40, utcLabel(nw.valid), r3(nw.sat), "SOILSAT_TOP: fraction of saturation, not m3/m3"]] : [])];
      putTable(live, "moisture_smap", { title: "Soil moisture, NASA SMAP L4 and the National Water Model (m3/m3)", header: ["Source", "Kind", "Top (cm)", "Bottom (cm)", "Date or time", "Value", "Note"], rows: csv });
      x.innerHTML = `<div class="card">${head("Satellite (SMAP L4) and the National Water Model", csv.length ? "moisture_smap" : "", "satellite · model")}
        ${grid([th("Source"), th("Kind"), th("Depth"), th("Latest", "m³/m³"), th("Date"), th(`${DAYS}-day range`, "m³/m³")], rows.map(r => r.map((c, i) => (i < 2 || i === 4 ? esc(c) : c))))}
        ${err ? `<p class="fine">SMAP L4 could not be read from Crop-CASMA: ${esc(err.message || String(err))}. The map layer (NASA GIBS) still shows it.</p>` : ""}
        ${top.length || sub.length ? chart([{ label: "SMAP 0–5 cm", color: COLS[0], pts: top }, { label: "SMAP 0–100 cm", color: COLS[2], pts: sub }], d0, t1, wid(x), "SMAP L4 soil moisture, the last 30 days") : ""}
        <p class="fine">${nw ? `National Water Model read ${esc(utcLabel(nw.valid))} (${fmt(nw.bytes / 1e6, 1)} MB).` : `<button class="link" data-smm-nwm data-lat="${lat}" data-lon="${lon}">Read the National Water Model here</button> (its four layers at the 1 km cell, the latest hour: about 2.5 MB from NOAA's files on AWS, which can take half a minute).`}</p>
        <p class="fine"><b>SMAP L4</b> (NASA GMAO, SPL4SMAU): the SMAP satellite's L-band readings of the top 5 cm assimilated into the Catchment land model, 9 km, about 3 days behind; the root zone (0–100 cm) is the model's, steered by the surface. Daily averages of its 3-hourly analyses at this 9 km cell from USDA NASS Crop-CASMA (George Mason University). <b>National Water Model</b> (NOAA Office of Water Prediction, version 3.0, Noah-MP, 1 km, hourly analysis): volumetric water in four layers (0–10, 10–40, 40–100, 100–200 cm) and the top 40 cm's fraction of saturation (what the NWM map shows). Public domain.</p></div>`;
    };
    const pS = Wx.once("smm:smap", () => smapAt(lat, lon, d0, t1)).then(S => sCard(S), e => { console.warn("SMAP", e); sCard(null, e); });

    /* the nearest stations: latest readings and 30 days of daily means */
    const pT = Wx.once("smm:near", () => nearest(lat, lon, 3)).then(async list => {
      if (!box(".smm-st")) return;
      if (!list.length) { box(".smm-st").innerHTML = `<div class="card">${head("Nearest soil moisture stations", "", "station")}<p class="fine" style="margin-top:0">No SCAN, SNOTEL or USCRN station within 400 km.</p></div>`; return; }
      const got = await Wx.once("smm:read", () => readStations(list, d0, t1)), x = box(".smm-st");
      if (!x) return;
      const csv = [], blocks = list.map((s, n) => {
        const r = got[n], net = NET[s.net], id = s.src === "crn" ? `WBAN ${s.id}` : s.id.split(":")[0];
        const where = `${dist(s.km)} ${esc(s.dir)} · ${esc(net[0])} ${esc(id)} · elevation ${UN.fmt("elev", s.ft * 0.3048, 0)}`;
        if (r instanceof Error) return `<h4 class="sm-h">${esc(s.name)}</h4><p class="fine">${where}. Could not read its data: ${esc(r.message)}.</p>`;
        const rows = s.depths.map(d => {
          const p = r.daily.get(d.key) || [], last = r.latest.get(d.key), ld = p.length ? p[p.length - 1] : null, ago = nearAt(p, d0);
          p.forEach(([day, v]) => csv.push([s.name, net[0], id, r3(s.km), d.label, +d.cm.toFixed(1), iso(day), r3(v), r3(v * 100), "daily mean"]));
          if (last) csv.push([s.name, net[0], id, r3(s.km), d.label, +d.cm.toFixed(1), last.time, r3(last.v), r3(last.v * 100), "latest hourly reading"]);
          return [`${esc(d.label)}${s.src === "awdb" ? ` <small>${esc(Dp(d.cm))}</small>` : ""}`, last ? v2(last.v) : ld ? v2(ld[1]) : "—", last ? esc(last.time) : ld ? `${iso(ld[0])} mean` : `<small>no readings in ${DAYS} days</small>`, ago ? v2(ago[1]) : "—", span(p)];
        });
        const series = s.depths.map((d, k) => ({ label: d.label, color: COLS[k % COLS.length], pts: r.daily.get(d.key) || [] }));
        return `<h4 class="sm-h">${esc(s.name)}</h4><p class="fine" style="margin-top:0">${where}.</p>
          ${grid([th("Sensor depth"), th("Latest", "m³/m³"), th("Time"), th(`${DAYS} days before`, "daily mean"), th(`${DAYS}-day range`, "daily means")], rows)}
          ${chart(series, d0, t1, wid(x), `${s.name}: soil moisture by depth, daily means`)}`;
      });
      putTable(live, "moisture_stations", { title: "Soil moisture at the nearest stations (station measurements)", header: ["Station", "Network", "ID", "Distance (km)", "Sensor depth", "Sensor depth (cm)", "Date or time", "Soil moisture (m3/m3)", "Soil moisture (% by volume)", "Kind"], rows: csv });
      x.innerHTML = `<div class="card">${head("Nearest soil moisture stations", csv.length ? "moisture_stations" : "", "station")}${blocks.join("")}
        <p class="fine">Measured in the ground by each station's sensors (volumetric water content; dielectric probes) at the depth shown, hourly; daily means over the station's local standard day (LST). <b>USDA NRCS SCAN and SNOTEL</b> (Air and Water Database, public domain) report % by volume at 2, 4, 8, 20 and 40 in (5, 10, 20, 51, 102 cm), shown here ÷ 100; SNOTEL sites are in the mountains, often under snow in winter. <b>NOAA USCRN</b> (public domain) reports m³/m³ at 5, 10, 20, 50 and 100 cm. A station reads its own soil: tens of km away, in another soil, it can differ a lot from this point. Sensors drift or fail: a flat or stepped line may be a sensor fault.</p></div>`;
    }).catch(fail(".smm-st", "the nearest soil moisture stations"));
    await Promise.allSettled([pM, pS, pT]);
  }
  SM.addPart({ key: "moisture", wait: "soil moisture by depth (models, SMAP, stations)", render });

  /* the National Water Model on request: read once per point, then the SMAP card is drawn again with it */
  async function nwmClick(b) {
    const lat = +b.dataset.lat, lon = +b.dataset.lon, box = b.closest(".smm-s");
    b.disabled = true; b.textContent = "Reading the National Water Model…";
    try {
      nwmSeen.set(`${lat.toFixed(4)},${lon.toFixed(4)}`, await nwmAt(lat, lon));
      const again = box && redrawS.get(box);
      if (again && document.contains(box)) again();
    } catch (e) { console.warn("NWM", e); b.disabled = false; b.textContent = "Read the National Water Model here (try again)"; WG.util.toast(`The National Water Model could not be read: ${e.message}`, 5000); }
  }

  return { layers: LAYERS, pick, stations, nearest, readStations, era5At, ifsAt, smapAt, nwmAt, chart };
})();
