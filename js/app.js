/* App controller: map, layers, search, site analysis, panel rendering. */
(function () {
  const U = WG.util, S = WG.soil, Wd = WG.wind, Ch = WG.charts, UN = WG.units;
  const { $, $$, esc, fmt, num } = U;
  const SI = window.WG_STATES, META = SI.meta; // every state's code, name, box and files; the statewide layers' legends
  const ASSET_V = ((document.querySelector('script[src*="data/states.js"]') || {}).src || "").split("v=")[1] || "1"; // the state files follow the page's version
  const app = $("#app");

  const state = {
    site: null,          // {lat, lon}
    token: 0,            // guards against out-of-order async results
    soil: null,          // fetched SSURGO profile
    edits: null,         // user surface overrides {sand, silt, clay, om, caco3, ph}
    windRaw: null,
    windSets: null,      // {model, cal, station} raw series
    windStation: null,   // station data used for calibration: an airport, or a West Texas Mesonet tower when on
    windAirport: null,   // airport data: gusts for a tower calibration and the "station only" series
    windTower: null,     // tower that ranks ahead of every airport, while its records load
    windSkipped: [],     // towers read but not used: they read low against the airport (probably sheltered)
    windSource: "cal",   // preferred source: cal | station | model
    gridModel: "merra2", // gridded wind: merra2 (NASA POWER, direct) | ecmwf (IFS/ERA5 via Open-Meteo, the backup)
    windKey: null,       // source actually shown
    windAll: null,       // analyses of every available source
    windCompare: null,   // reanalysis vs station statistics
    wind: null,
    thr: 8,
    period: { n: 10 },   // {n: 5|10|20} last n complete years, or {from, to} ISO dates
    windPeriod: null,    // the period resolved for the model in use (dates, label)
    nlcd: null,
    place: null,
    elev: null,
    landUse: null,
    answers: {},
  };
  WG.state = state;
  const KEEP_Q = Wd.wtmTrial ? "&wtm=1" : ""; // a local mesonet test survives a reload (the public site ignores ?wtm=1)
  const START_Q = new URLSearchParams(location.search); // the link as opened, before anything rewrites it
  {
    const q = new URLSearchParams(location.search);
    if (/^\d{4}-\d{2}-\d{2}$/.test(q.get("from") || "") && /^\d{4}-\d{2}-\d{2}$/.test(q.get("to") || "")) state.period = { from: q.get("from"), to: q.get("to") };
    else if (["5", "10", "20"].includes(q.get("period"))) state.period = { n: +q.get("period") };
    if (q.get("model") === "ecmwf") state.gridModel = "ecmwf"; // checked against the dates with the period controls below
    state.theme = WG.weather.THEMES.some(t => t.key === q.get("map")) ? q.get("map") : "erosion";
  }
  const L48 = SI.list.filter(x => x.l48).map(x => x.c); // the 48 contiguous states and DC: the picker's Whole US
  // the states this copy lets a visitor choose (js/config.js); the rest are listed as "(later)" and kept in the code and data
  const LIVE = WG.config && WG.config.live ? new Set(WG.config.live) : null, canLive = c => !LIVE || LIVE.has(c);
  const LIVE48 = L48.filter(canLive);
  const statesQ = codes => (codes.length === L48.length ? "US" : codes.join(",")); // the states in the link and on this device: US for all of them
  // the period and, when not the default, the gridded model: a reloaded or shared link redoes the same analysis
  const windQ = () => (state.period.from ? `&from=${state.period.from}&to=${state.period.to}` : state.period.n !== 10 ? `&period=${state.period.n}` : "")
    + (state.gridModel !== "merra2" ? `&model=${state.gridModel}` : "") + (state.theme !== "erosion" ? `&map=${state.theme}` : "")
    + (state.region && state.region.join(",") !== "TX" ? `&states=${statesQ(state.region)}` : "");
  // the address without a location: the theme, the states and the units kept in step with the choices
  let booted = false; // the first paint is done (until then the address is the link as opened)
  function bareUrl() {
    if (!booted) return;
    try {
      const q = new URLSearchParams(location.search);
      q.delete("lat"); q.delete("lon"); // no location on show
      if (state.theme === "erosion") q.delete("map"); else q.set("map", state.theme);
      if (state.region) q.set("states", statesQ(state.region)); // untouched until the states load; always named, so a shared link doesn't fall back on the reader's own last choice
      q.delete("units"); if (UN.query()) q.set("units", UN.preset);
      const s = q.toString();
      history.replaceState(null, "", location.pathname + (s ? `?${s}` : ""));
    } catch (e) { /* file:// */ }
  }
  const periodLabel = () => (state.windPeriod ? state.windPeriod.label : state.period.from ? `${state.period.from} to ${state.period.to}` : `the last ${state.period.n} years`);

  /* ============ MAP ============ */
  const map = L.map("map", { zoomControl: false, preferCanvas: true, worldCopyJump: false, tap: true })
    .setView([32.2, -100.6], 6);
  WG.map = map;
  if (window.matchMedia("(min-width: 768px)").matches) L.control.zoom({ position: "bottomright" }).addTo(map);
  L.control.scale({ imperial: true, metric: true, position: "bottomright" }).addTo(map);

  const esri = p => `https://server.arcgisonline.com/ArcGIS/rest/services/${p}/MapServer/tile/{z}/{y}/{x}`;
  const usgs = p => `https://basemap.nationalmap.gov/arcgis/rest/services/${p}/MapServer/tile/{z}/{y}/{x}`;
  /* the Plain base: no tiles at all, a light background (css/app.css .plain-base) under the states' outlines and the
     layers on show, for a clean map to read or to save as an image (no imagery, roads, rivers or names) */
  const PlainBase = L.Layer.extend({
    onAdd(m) { m.getContainer().classList.add("plain-base"); },
    onRemove(m) { m.getContainer().classList.remove("plain-base"); },
    bringToBack() { return this; },
  });
  // its picker thumb: an outline on the blank background (single quotes outside, %22 inside: it goes into a style="…")
  const PLAIN_THUMB = "#fcfbf8 url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 60 40%22%3E%3Cpath d=%22M9 9h21l3 5h11l7 9-5 9H31l-5-5H14l-5-8z%22 fill=%22none%22 stroke=%22%2333403a%22 stroke-width=%221.6%22 stroke-linejoin=%22round%22/%3E%3C/svg%3E') center / auto 82% no-repeat";

  const bases = {
    sat: { name: "Satellite", thumb: "#3d4a3a",
      layer: L.tileLayer(esri("World_Imagery"), { maxZoom: 19, maxNativeZoom: 19, attribution: "Imagery © Esri, Maxar, USDA FSA, USGS" }),
      labels: true },
    usgsimg: { name: "USGS imagery + topo", thumb: "#56604a",
      layer: L.tileLayer(usgs("USGSImageryTopo"), { maxZoom: 19, maxNativeZoom: 16, attribution: "USGS The National Map" }),
      labels: false },
    topo: { name: "Topographic", thumb: "#dfe3cf",
      layer: L.tileLayer(usgs("USGSTopo"), { maxZoom: 19, maxNativeZoom: 16, attribution: "USGS The National Map" }),
      labels: false },
    plain: { name: "Plain (no base map)", thumb: PLAIN_THUMB, blank: true, layer: new PlainBase(), labels: false }, // the names overlay goes with it, as with the other bases without it
  };

  map.createPane("thematic").style.zIndex = 350;
  map.createPane("refs").style.zIndex = 420;
  map.createPane("labels").style.zIndex = 450;
  map.getPane("labels").style.pointerEvents = "none";
  map.getPane("refs").style.pointerEvents = "none";

  /* County lines drawn by the Census TIGERweb map service for each tile. Its county layers 1–13 each cover a range of
     map scales, so asking for all of them gives the right detail at every zoom. */
  const TIGER_COUNTIES = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/export";
  const CensusCounties = L.TileLayer.extend({
    getTileUrl(c) {
      const a = L.CRS.EPSG3857.project(this._map.unproject([c.x * 256, c.y * 256], c.z));
      const b = L.CRS.EPSG3857.project(this._map.unproject([(c.x + 1) * 256, (c.y + 1) * 256], c.z));
      return `${this._url}?bbox=${a.x},${b.y},${b.x},${a.y}&bboxSR=3857&imageSR=3857&size=256,256`
        + "&layers=show:1,3,5,7,9,11,13&format=png32&transparent=true&f=image";
    },
  });

  const refs = {
    labels: { name: "Place, river and county names", sub: "towns, rivers, lakes, landmarks",
      layer: L.tileLayer(esri("Reference/World_Reference_Overlay"), { pane: "labels", maxZoom: 19, attribution: "Labels © Esri" }), on: true },
    roads: { name: "Roads and street names", sub: "highways, county roads, streets",
      layer: L.tileLayer(esri("Reference/World_Transportation"), { pane: "refs", maxZoom: 19, opacity: 0.95, attribution: "Roads © Esri" }), on: false }, // off at first: a cleaner map; one tap in Layers brings it
    hydro: { name: "Rivers, streams, lakes", sub: "USGS National Hydrography lines",
      layer: L.tileLayer(usgs("USGSHydroCached"), { pane: "refs", maxZoom: 19, maxNativeZoom: 16, opacity: 0.9, attribution: "USGS National Hydrography" }), on: false }, // off at first, as the roads
    counties: { name: "County lines", sub: "U.S. Census TIGER, exact at every zoom",
      layer: new CensusCounties(TIGER_COUNTIES, { pane: "refs", maxZoom: 19, opacity: 0.85, className: "county-lines", attribution: "Counties: U.S. Census TIGER" }),
      on: false }, // off at first, as the roads and water: a cleaner map
  };

  const imgOpts = { pane: "thematic", opacity: 0.6, className: "thematic-img", interactive: false };
  /* A statewide layer is a set of pieces, one for each chosen state that has it. A state's piece is added only while
     the set is on the map and the state is in or near the view (fill, after every move), so the whole US doesn't load
     at once; pieces added stay until the states change. */
  let holdFill = false; // setRegion is moving the map: the pieces wait for the view it ends on
  const NearSet = L.LayerGroup.extend({
    setStates(recs, key) { this.clearLayers(); this._key = key; this._todo = recs.filter(r => this.has(r, key)); return this.fill(); },
    onAdd(m) { L.LayerGroup.prototype.onAdd.call(this, m); this.fill(); },
    fill() {
      if (holdFill || !this._map || !this._todo || !this._todo.length) return this;
      const view = this._map.getBounds().pad(0.5);
      this._todo = this._todo.filter(r => {
        if (!view.intersects(r.overlays.bounds)) return true;
        this.make(r, this._key);
        return false;
      });
      return this;
    },
  });
  // the statewide images (data/states/XX/*.png); the set takes its opacity like one image
  const OverlaySet = NearSet.extend({
    has: (r, key) => !!(r.overlays && r.overlays.files[key]),
    make(r, key) { this.addLayer(L.imageOverlay(`${r.overlays.files[key]}?v=${ASSET_V}`, r.overlays.bounds, { ...imgOpts, opacity: this._op ?? imgOpts.opacity })); },
    setOpacity(o) { this._op = o; this.eachLayer(l => l.setOpacity(o)); return this; },
  });
  // the spring wind layer's downwind arrows
  const ArrowSet = NearSet.extend({
    has: r => !!(r.overlays && r.overlays.windArrows),
    make(r) { windArrows(this, r.overlays.windArrows); },
  });
  const themes = {
    susceptibility: { layer: new OverlaySet(), meta: META.susceptibility, on: true },
    weg: { layer: new OverlaySet(), meta: META.weg, on: false },
    climate: { layer: new OverlaySet(), meta: META.climate, on: false },
    wind: { layer: new OverlaySet(), meta: META.wind, on: false, extra: new ArrowSet() },
  };
  const fillNear = () => Object.values(themes).forEach(t => { t.layer.fill(); if (t.extra) t.extra.fill(); });
  // the legend's % column (js/shares.js): each class measured on the statewide images themselves
  Object.entries(themes).forEach(([k, t]) => { t.shares = { id: `erosion-${k}`, png: k, none: k === "susceptibility" || k === "weg" ? "No data (water, built-up or not surveyed)" : "No data" }; });
  map.on("moveend", fillNear);

  /* Downwind arrows for the spring wind layer (direction soil is carried), length by speed. */
  function windArrows(g, arrows) {
    (arrows || []).forEach(([lat, lon, from, mph]) => {
      const len = 10 + Math.max(0, mph - 8) * 3.2;
      const svg = `<svg width="2" height="2" viewBox="-1 -1 2 2"><g transform="rotate(${(from + 180) % 360})">
        <line x1="0" y1="${len / 2}" x2="0" y2="${-len / 2}" stroke="#16324f" stroke-width="2"/>
        <path d="M0,${-len / 2 - 5} L-4,${-len / 2 + 2} L4,${-len / 2 + 2} Z" fill="#16324f"/></g></svg>`;
      L.marker([lat, lon], { pane: "refs", interactive: false, keyboard: false,
        icon: L.divIcon({ className: "wind-arrow", html: svg, iconSize: [2, 2], iconAnchor: [1, 1] }) }).addTo(g);
    });
    return g;
  }

  const soilLayers = {
    nlcd: { name: "Land cover (NLCD 2021)", sub: "cropland, rangeland, shrubland…",
      layer: L.tileLayer.wms("https://www.mrlc.gov/geoserver/mrlc_display/wms", {
        layers: "NLCD_2021_Land_Cover_L48", format: "image/png", transparent: true, pane: "thematic", opacity: 0.6,
        attribution: "NLCD / MRLC" }), on: false },
    ssurgo: { name: "Soil map units (SSURGO)", sub: "polygon lines and map symbols, zoom 13+",
      layer: L.tileLayer.wms("https://SDMDataAccess.sc.egov.usda.gov/Spatial/SDM.wms", {
        layers: "mapunitpoly", format: "image/png", transparent: true, pane: "refs", minZoom: 13, maxZoom: 19, opacity: 0.85,
        attribution: "USDA-NRCS SSURGO" }), on: false },
  };

  let baseKey = "plain"; // Plain (no base map) under the data layers by default; Satellite and the others are in Layers
  bases[baseKey].layer.addTo(map);
  if (!bases[baseKey].labels) refs.labels.on = false; // the names overlay comes with the bases that carry it (setBase)
  Object.values(refs).forEach(r => r.on && r.layer.addTo(map));
  Object.values(themes).forEach(t => t.on && t.layer.addTo(map));
  Object.values(soilLayers).forEach(t => t.on && t.layer.addTo(map));
  /* ---------- the states on the map ----------
     data/states.js lists every state; a state's own file (data/states/XX.json: outline, nearby airports, statewide
     overlays where built) is fetched only when the state is chosen. Any number at once, up to the whole US (L48);
     their statewide images load as the map comes near them (NearSet). Everything outside them is covered and the map
     can't be panned or zoomed away from them. Alaska, Hawaii and Puerto Rico are listed for later: PRISM, gridMET and
     several NOAA maps cover the 48 contiguous states only. */
  const STATE_OF = Object.fromEntries(SI.list.map(x => [x.c, x]));
  const stateFiles = new Map(); // code -> promise of the state's file, with its polygons ready for the inside test
  function prepState(rec) {
    const g = rec.outline;
    rec.polys = (g.type === "MultiPolygon" ? g.coordinates : [g.coordinates]).map(rings => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      rings[0].forEach(([x, y]) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; });
      return { rings, box: [x0, y0, x1, y1] };
    });
    return rec;
  }
  const loadState = code => {
    if (!stateFiles.has(code)) stateFiles.set(code, U.fetchJSON(`data/states/${code}.json?v=${ASSET_V}`, {}, 30000).then(prepState).catch(e => { stateFiles.delete(code); throw e; }));
    return stateFiles.get(code);
  };
  /* Even-odd ray test against a state's outline (Census 1:5M, mainland and islands, within about 0.2 km). */
  function inPolys(polys, lat, lon) {
    return polys.some(({ rings, box }) => {
      if (lon < box[0] || lon > box[2] || lat < box[1] || lat > box[3]) return false;
      let inside = false;
      rings.forEach(r => {
        for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
          const [xi, yi] = r[i], [xj, yj] = r[j];
          if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
        }
      });
      return inside;
    });
  }
  const region = { codes: [], recs: [] };
  const stateAt = (lat, lon) => region.recs.find(r => inPolys(r.polys, lat, lon)) || null; // the chosen state holding the point
  const inRegion = (lat, lon) => !!stateAt(lat, lon);
  /* any contiguous state holding the point: its box first, then its outline (its file is fetched to tell). The record,
     or null with why: "failed" (a state's file could not be read: try again), "edge" (inside a state's box but not its
     outline: water or just outside the coast or border), "outside" (in no contiguous state's box). */
  let whyNot = "outside";
  async function findState(lat, lon) {
    const boxes = SI.list.filter(x => x.l48 && lon >= x.b[0] && lon <= x.b[2] && lat >= x.b[1] && lat <= x.b[3]);
    let failed = null;
    for (const x of boxes) {
      const rec = await loadState(x.c).catch(() => { failed = failed || x.n; return null; });
      if (rec && inPolys(rec.polys, lat, lon)) {
        if (canLive(rec.code)) return rec;
        whyNot = `later:${rec.name}`; // a state this copy does not show yet
        return null;
      }
    }
    whyNot = failed ? `failed:${failed}` : boxes.length ? "edge" : "outside";
    return null;
  }
  const regionName = () => (region.recs.length === 1 ? region.recs[0].name : region.recs.length === L48.length ? "the 48 contiguous states and DC"
    : region.recs.length ? `the ${region.recs.length} chosen states` : "the chosen states");

  map.createPane("mask").style.zIndex = 460; // above every tile and overlay pane, below pins and tooltips
  map.getPane("mask").style.pointerEvents = "none";
  const maskRenderer = L.svg({ pane: "mask", padding: 1 }); // wide padding: no uncovered edge while dragging
  map.options.maxBoundsViscosity = 0.9;
  let regionLayer = null, regionBounds = null, regionSeq = 0, wanted = null, regionDone = Promise.resolve(true);
  /* Show these states: fetch their files, cover the rest, fit the map, fill the statewide layers. false if a file
     could not be read (the states on show stay). keepView: the map is not moved (a state added for a place found);
     at: [lat, lon], the map opens there instead when a chosen state holds it (a link's location). */
  async function setRegion(codes, opts = {}) {
    codes = [...new Set(codes.map(c => String(c).toUpperCase()).flatMap(c => (c === "US" ? L48 : [c])).filter(c => STATE_OF[c] && STATE_OF[c].l48 && canLive(c)))];
    if (!codes.length) codes = LIVE ? LIVE48.slice(0, 1) : ["TX"];
    const my = ++regionSeq;
    wanted = codes;
    let recs;
    const fresh = codes.filter(c => !stateFiles.has(c)).length;
    if (fresh > 6) U.toast(`Loading ${fresh} states…`);
    const done = Promise.all(codes.map(loadState));
    regionDone = done.then(() => true, () => false);
    try { recs = await done; } catch (e) { if (my === regionSeq) { wanted = null; U.toast(`Could not load the state's file (${e.message || e}). Try again.`); } return false; }
    if (my !== regionSeq) return false; // a later choice won: it holds these states too when it was an added one
    wanted = null;
    region.codes = codes; region.recs = recs; state.region = codes;
    if (regionLayer) map.removeLayer(regionLayer);
    const geos = recs.map(r => r.outline), gc = { type: "GeometryCollection", geometries: geos };
    const holes = geos.flatMap(g => (g.type === "MultiPolygon" ? g.coordinates : [g.coordinates]).map(p => p[0].map(([x, y]) => [y, x])));
    const world = [[-85, -180], [-85, 180], [85, 180], [85, -180]];
    const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#f3f1ea";
    regionLayer = L.layerGroup([
      L.polygon([world, ...holes], { renderer: maskRenderer, stroke: false, fillColor: bg, fillOpacity: 1, interactive: false }),
      L.geoJSON(gc, { renderer: maskRenderer, interactive: false, style: { color: "#33403a", weight: 2, fill: false } }),
    ]).addTo(map);
    regionBounds = L.latLngBounds(recs.map(r => [[r.box[1], r.box[0]], [r.box[3], r.box[2]]]).flat());
    holdFill = true; // the statewide pieces: those in or near the view the map ends on
    try {
      Object.entries(themes).forEach(([k, t]) => { t.layer.setStates(recs, k); if (t.extra) t.extra.setStates(recs, k); });
      map.setMaxBounds(regionBounds.pad(0.2));
      fitMinZoom();
      // a link's location in a chosen state: the map opens on it, so only the pieces near it load (not the whole US)
      const at = opts.at && recs.some(r => inPolys(r.polys, opts.at[0], opts.at[1])) ? opts.at : null;
      if (at) map.setView(at, 13, { animate: false });
      else if (!opts.keepView) map.fitBounds(regionBounds, { animate: false });
    } finally { holdFill = false; }
    fillNear();
    applyOpacity();
    const all = codes.length === L48.length && !LIVE;
    $("#regionLabel").textContent = all ? "Whole US" : recs.length > 1 ? `${recs.length} states` : recs[0].name;
    $("#regionLabel").dataset.short = all ? "US" : recs.length > 1 ? `${recs.length}` : recs[0].code;
    $("#regionBtn").title = `States on the map: ${all ? "the 48 contiguous states and DC" : recs.map(r => r.name).join(", ")}`;
    $("#hintWhere").textContent = `Tap anywhere in ${regionName()}`;
    renderLegend();
    document.dispatchEvent(new Event("wg-states")); // the Soil tab's Land cover card counts the new states (js/landcover.js)
    try { localStorage.setItem("fg.states", statesQ(codes)); } catch (e) { /* storage off */ }
    if (state.site && !stateAt(state.site.lat, state.site.lon)) $("#closePanelBtn").click(); // the location's state was taken off
    if (state.site) { try { history.replaceState(null, "", `?lat=${state.site.lat.toFixed(5)}&lon=${state.site.lon.toFixed(5)}${windQ()}${UN.query()}${KEEP_Q}`); } catch (e) { /* file:// */ } }
    else bareUrl();
    return true;
  }
  // a place outside the states on show: its state is added; the state's record, or null with the reason shown
  async function ensureState(lat, lon) {
    const here = stateAt(lat, lon);
    if (here) return here;
    const rec = await findState(lat, lon);
    if (!rec) {
      U.toast(whyNot.startsWith("later:") ? `${whyNot.slice(6)} comes later: ${WG.config.name} shows ${LIVE48.map(c => STATE_OF[c].n).join(", ")} for now.`
        : whyNot.startsWith("failed:") ? `Could not load ${whyNot.slice(7)}'s file. Check the connection and try again.`
        : whyNot === "edge" ? "That point is on water or just outside the state outlines. Pick a point on land."
        : `That point is outside the 48 contiguous states ${WG.config.name} covers so far (Alaska, Hawaii and Puerto Rico come later).`, 5000);
      return null;
    }
    const base = wanted || region.codes; // the states asked for last, so a choice still loading isn't dropped
    if (base.includes(rec.code)) { await regionDone; return stateAt(lat, lon); }
    if (!(await setRegion([...base, rec.code], { keepView: true }))) return null;
    U.toast(`${rec.name} added to the map.`);
    return stateAt(lat, lon);
  }
  function fitMinZoom() { // no zooming out past the chosen states; the old limit is cleared first, as getBoundsZoom is clamped by it
    if (!regionBounds) return;
    map.options.minZoom = 0;
    map.setMinZoom(Math.max(3, map.getBoundsZoom(regionBounds.pad(0.05))));
  }
  map.on("resize", fitMinZoom);

  /* the picker: a checklist of states, any number ticked, or the whole US at once; Show loads them */
  const pop = $("#regionPop");
  let pick = new Set(); // the states ticked while the picker is open (the filter hides some of them)
  function pickCount() {
    const n = pick.size, all = $("#regionAll");
    all.checked = n === LIVE48.length; all.indeterminate = n > 0 && n < LIVE48.length;
    $("#regionCount").textContent = n === L48.length ? "Whole US" : n ? `${n} chosen` : "Choose any number";
    $("#regionApply").disabled = !n;
  }
  function renderPicker() {
    const f = $("#regionFilter").value.trim().toLowerCase();
    const list = SI.list.slice().sort((a, b) => a.n.localeCompare(b.n)).filter(x => !f || x.n.toLowerCase().includes(f) || x.c.toLowerCase() === f);
    $("#regionList").innerHTML = list.map(x => {
      const on = pick.has(x.c), off = !x.l48 || !canLive(x.c);
      return `<label class="${off ? "off" : ""}"${!x.l48 ? ' title="Later: several sources cover the 48 contiguous states only"' : off ? ` title="Later: ${esc(WG.config.name)} shows ${esc(LIVE48.join(", "))} for now"` : ""}><input type="checkbox" value="${x.c}" ${on ? "checked" : ""} ${off ? "disabled" : ""}>${esc(x.n)}${x.ov && !off ? ' <i class="rp-dot" title="Statewide erosion maps"></i>' : ""}${off ? " <small>(later)</small>" : ""}</label>`;
    }).join("");
    pickCount();
  }
  function openPicker(open) {
    if (open) { pop.hidden = true; pick = new Set(region.codes); $("#regionFilter").value = ""; renderPicker(); }
    pop.hidden = !open;
    $("#regionBtn").setAttribute("aria-expanded", String(open));
    if (open) $("#regionFilter").focus({ preventScroll: true });
  }
  $("#regionBtn").addEventListener("click", () => openPicker(pop.hidden));
  $("#regionCancel").addEventListener("click", () => openPicker(false));
  $("#regionFilter").addEventListener("input", renderPicker);
  $("#regionList").addEventListener("change", e => { // in place, so the box just ticked keeps the focus
    const i = e.target;
    if (i.checked) pick.add(i.value); else pick.delete(i.value);
    pickCount();
  });
  if (LIVE) $("#regionAll").closest("label").hidden = true; // no Whole US while some states come later
  const tickAll = on => { pick = new Set(on ? LIVE48 : []); $$("#regionList input").forEach(i => { i.checked = pick.has(i.value); }); pickCount(); };
  $("#regionAll").addEventListener("change", e => tickAll(e.target.checked));
  $("#regionNone").addEventListener("click", () => tickAll(false));
  $("#regionApply").addEventListener("click", async () => {
    const codes = SI.list.map(x => x.c).filter(c => pick.has(c));
    openPicker(false);
    $("#regionBtn").focus({ preventScroll: true });
    if (codes.length) await setRegion(codes);
  });
  let pickerTap = false; // the pointer went down outside the open picker: that tap only closes it
  document.addEventListener("pointerdown", e => { pickerTap = !pop.hidden && !e.target.closest("#regionBox"); }, true);
  document.addEventListener("click", e => { if (!pop.hidden && !e.target.closest("#regionBox")) openPicker(false); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !pop.hidden) { openPicker(false); $("#regionBtn").focus(); } });
  L.DomEvent.disableClickPropagation($("#regionBox"));

  /* ---------- layer sheet ---------- */
  function buildLayerSheet() {
    $("#baseGrid").innerHTML = Object.entries(bases).map(([k, b]) =>
      `<button data-base="${k}" class="${k === baseKey ? "on" : ""}"><i${b.blank ? ' class="blank"' : ""} style="background:${b.thumb}"></i>${esc(b.name)}</button>`).join("");
    const toggle = (group, key, item, swatch) => `<label class="toggle"><input type="checkbox" data-group="${group}" data-key="${key}" ${item.on ? "checked" : ""}>
      <span>${esc(item.name || item.meta.title)}<small>${esc(item.sub || (item.meta && (group === "themes" ? legendText(key, item.meta).unit : item.meta.unit)) || "")}</small></span>${swatch || ""}</label>`;
    $("#refToggles").innerHTML = Object.entries(refs).map(([k, r]) => toggle("refs", k, r)).join("");
    $("#themeToggles").innerHTML = Object.entries(themes).map(([k, t]) => toggle("themes", k, t,
      `<i class="sw2" style="background:linear-gradient(90deg,${(t.meta.legend || []).map(l => l.color).join(",")})"></i>`)).join("");
    $("#soilToggles").innerHTML = Object.entries(soilLayers).map(([k, r]) => toggle("soilLayers", k, r)).join("");
    const th = state.theme, T = WG.weather.THEMES.find(t => t.key === th);
    $("#themeSeg").innerHTML = WG.weather.THEMES.map(t => `<button data-theme="${t.key}" class="${t.key === th ? "on" : ""}">${esc(t.name)}</button>`).join("");
    $("#themeNote").textContent = T.note;
    $("#erosionBox").hidden = th !== "erosion";
    $("#liveBox").hidden = th === "erosion";
    if (th !== "erosion") {
      $("#liveTitle").textContent = T.layersTitle;
      $("#liveToggles").innerHTML = Object.entries(live[th]).map(([k, it]) => toggle("live", k, it, it.swatch ? `<i class="sw2" style="background:${it.swatch}"></i>` : "")).join("")
        + (T.controls ? T.controls() : ""); // a theme's own choices under its layers (the soil maps' depths and element)
      $("#liveNote").textContent = T.layersNote || "";
    }
  }
  /* ---------- themes: what the map shows ----------
     Wind erosion, drought or soil maps. A theme puts its overlay on the map (one at a time, the last chosen) and
     gives the panel its tabs; the live layers and the tabs' data are in js/weather.js. */
  const live = Object.fromEntries(Object.entries(WG.weather.layers).map(([t, list]) => [t, Object.fromEntries(list.map(x => [x.key, { ...x, on: false }]))]));
  const choice = { erosion: Object.keys(themes).find(k => themes[k].on) || null,
    ...Object.fromEntries(Object.entries(WG.weather.layers).map(([t, list]) => [t, (list.find(x => x.def) || list[0] || {}).key || null])) };
  const groups = { refs, themes, soilLayers, live: new Proxy({}, { get: (_, k) => live[state.theme] && live[state.theme][k] }) };
  const showItem = (it, v) => { [it.layer, it.extra].filter(Boolean).forEach(l => (v ? l.addTo(map) : map.removeLayer(l))); };
  // tab: the tab to open (a link to another theme's tab), else the one on show if it belongs, else the theme's first
  function setTheme(t, tab) {
    state.theme = WG.weather.THEMES.some(x => x.key === t) ? t : "erosion";
    Object.entries(themes).forEach(([k, it]) => { const on = state.theme === "erosion" && k === choice.erosion; if (it.on !== on) { it.on = on; showItem(it, on); } });
    Object.entries(live).forEach(([tk, set]) => Object.entries(set).forEach(([k, it]) => { const on = tk === state.theme && k === choice[tk]; if (it.on !== on) { it.on = on; showItem(it, on); } }));
    applyOpacity();
    renderLegend();
    renderThemeBar();
    if (!$("#layerSheet").hidden) buildLayerSheet();
    const T = WG.weather.THEMES.find(x => x.key === state.theme);
    $("#hintText").textContent = T.hint;
    // the panel's tabs: those of this theme; the one on show stays if it belongs, else the theme's first
    $$(".tabs button[data-tab]").forEach(b => { b.hidden = !b.dataset.for.split(" ").includes(state.theme); });
    const on = $(".tabs button.active"), to = tab && $(`.tabs button[data-tab="${tab}"]:not([hidden])`);
    showTab(to ? tab : on && !on.hidden ? on.dataset.tab : $(".tabs button[data-tab]:not([hidden])").dataset.tab);
    try {
      if (state.site) history.replaceState(null, "", `?lat=${state.site.lat.toFixed(5)}&lon=${state.site.lon.toFixed(5)}${windQ()}${UN.query()}${KEEP_Q}`);
      else bareUrl();
    } catch (e) { /* file:// */ }
  }
  function renderThemeBar() {
    $("#themeBar").innerHTML = WG.weather.THEMES.map(t => `<button data-theme="${t.key}" class="${t.key === state.theme ? "on" : ""}" aria-pressed="${t.key === state.theme}" title="${esc(t.title)}">${t.icon}<span class="full">${esc(t.name)}</span><span class="short">${esc(t.short)}</span></button>`).join("");
    const on = $("#themeBar .on"); // a narrow screen scrolls the bar: the theme on show stays in view
    if (on) $("#themeBar").scrollLeft = Math.max(0, on.offsetLeft - ($("#themeBar").clientWidth - on.offsetWidth) / 2);
  }
  $("#themeBar").addEventListener("click", e => { const b = e.target.closest("[data-theme]"); if (b) setTheme(b.dataset.theme); });

  function setBase(k) {
    map.removeLayer(bases[baseKey].layer);
    baseKey = k;
    bases[k].layer.addTo(map);
    bases[k].layer.bringToBack();
    // name overlays are tuned for imagery; bases with built-in names don't need them
    ["labels"].forEach(n => {
      const lab = refs[n];
      if (!bases[k].labels && lab.on) { map.removeLayer(lab.layer); lab.on = false; }
      if (bases[k].labels && !lab.on) { lab.layer.addTo(map); lab.on = true; }
    });
    buildLayerSheet();
  }

  function setToggle(group, key, on) {
    const item = groups[group][key], show = showItem;
    item.on = on;
    show(item, on);
    // a switch from elsewhere (the Soil tab's tile, the Basin tab, the legend's link) ticks or unticks the sheet's box too, so the next tap there does the opposite
    const cb = $(`#layerSheet input[data-group="${group}"][data-key="${key}"]`);
    if (cb) cb.checked = on;
    if (group === "themes") choice.erosion = on ? key : null;
    if (group === "live") choice[state.theme] = on ? key : null;
    const set = group === "themes" ? themes : group === "live" ? live[state.theme] : null;
    if (set && on) {
      // one thematic overlay at a time keeps the map readable
      Object.entries(set).forEach(([k, t]) => { if (k !== key && t.on) { t.on = false; show(t, false); } });
      buildLayerSheet();
      applyOpacity();
    }
    renderLegend();
  }

  $("#layerSheet").addEventListener("click", e => {
    const b = e.target.closest("[data-base]");
    if (b) setBase(b.dataset.base);
    const t = e.target.closest("[data-theme]");
    if (t) setTheme(t.dataset.theme);
  });
  $("#layerSheet").addEventListener("change", e => {
    const i = e.target;
    if (i.dataset.group) setToggle(i.dataset.group, i.dataset.key, i.checked);
  });
  /* Statewide overlays are 1 km grids: fade them as you zoom in so imagery, roads and soil lines read through. */
  let userOpacity = 0.6;
  function applyOpacity() {
    const z = map.getZoom();
    const f = z >= 14 ? 0 : z >= 12 ? 0.4 : z >= 10 ? 0.75 : 1;
    Object.values(themes).forEach(t => t.layer.setOpacity(userOpacity * f));
    Object.values(live).forEach(set => Object.values(set).forEach(t => t.layer.setOpacity(Math.min(1, userOpacity * (t.opacity || 1.2)))));
    soilLayers.nlcd.layer.setOpacity(Math.min(1, userOpacity * (z >= 12 ? 0.8 : 1)));
  }
  $("#opacityRange").addEventListener("input", e => { userOpacity = +e.target.value; applyOpacity(); });
  map.on("zoomend", applyOpacity);
  applyOpacity();
  const openSheet = open => {
    $("#layerSheet").hidden = !open;
    $("#sheetBackdrop").hidden = !open;
    if (!open) $("#methodsSheet").hidden = true;
  };
  $("#layersBtn").addEventListener("click", () => { buildLayerSheet(); openSheet(true); });
  $("#sheetClose").addEventListener("click", () => openSheet(false));
  $("#sheetBackdrop").addEventListener("click", () => openSheet(false));

  /* ---------- the map as an image (PNG): js/mapimage.js, loaded the first time the button is used ---------- */
  // the layers on show with their names, so the image can name one whose server keeps its pictures out of it
  const shownLayers = () => [bases[baseKey], ...Object.values(refs), ...Object.values(themes), ...Object.values(soilLayers), ...Object.values(live[state.theme] || {})]
    .filter(it => it.on !== false && map.hasLayer(it.layer)).flatMap(it => [it.layer, it.extra].filter(Boolean).map(layer => ({ name: it.name || (it.meta && it.meta.title) || "", layer })));
  let imgLib = null;
  $("#saveMapBtn").addEventListener("click", async () => {
    const b = $("#saveMapBtn");
    if (b.classList.contains("busy")) return;
    b.classList.add("busy");
    try {
      await (imgLib = imgLib || new Promise((res, rej) => {
        const s = document.createElement("script");
        // a failed load is forgotten, so the next tap tries again
        s.src = `js/mapimage.js?v=${ASSET_V}`; s.onload = res; s.onerror = () => { imgLib = null; s.remove(); rej(new Error("its script could not be loaded. Check the connection and try again.")); };
        document.head.appendChild(s);
      }));
      await WG.mapimage.save({ shown: shownLayers });
    } catch (e) { console.warn("map image", e); U.toast(`The map image could not be made: ${e.message || e}`, 6000); }
    finally { b.classList.remove("busy"); }
  });

  /* ---------- legend ---------- */
  /* legend text in the units table's units: the layer files label soil loss in t/ac/yr and wind in mph */
  function legendText(key, m) {
    const sl = v => UN.num("soilLoss", +v, 0), us = UN.sym("soilLoss") === "t/ac/yr", mph = UN.sym("wind") === "mph";
    const wnd = v => (mph ? v : UN.num("wind", +v * 0.44704, ["m/s", "kn"].includes(UN.sym("wind")) ? 1 : 0));
    const labels = m.legend.map(l => l.label);
    if (key === "susceptibility" && !us) return { unit: UN.sym("soilLoss"), labels: labels.map(t => t.replace(/\d+/g, v => UN.edge("soilLoss", +v))), note: m.note.replace("40 t/ac/yr", UN.fmt("soilLoss", 40, 0)).replace("T = 5", `T = ${UN.fmt("soilLoss", 5, 0)}`) };
    if (key === "weg" && !us) return { unit: m.unit, labels: labels.map(t => t.replace(/I ([\d–]+)/, (_, g) => `I ${g.replace(/\d+/g, sl)}`)), note: m.note.replace("(t/ac/yr, 0–310)", `(${UN.range("soilLoss", 0, 310, 0)})`).replace("share I = 86", `share I = ${sl(86)}`) };
    if (key === "wind" && !mph) return { unit: `${UN.sym("wind")} at 10 m`, labels: labels.map(t => t.replace(/\d+(\.\d+)?/g, wnd)), note: m.note };
    return { unit: m.unit, labels, note: m.note };
  }
  let legendMin = window.matchMedia("(max-width: 767px)").matches;
  /* with the NLCD overlay on, its colour key (js/landcover.js) is added under whatever legend the theme has */
  const lcKey = () => { if (soilLayers.nlcd.on && WG.landcover) WG.landcover.legend($("#legend"), legendMin, () => { legendMin = !legendMin; renderLegend(); }); };
  function renderLegend() {
    drawBaseLegend();
    lcKey();
  }
  /* a layer's legend drawn again by its own file (a depth or a day chosen, its colour scale read: js/soilmaps.js,
     js/soilmoisture.js, js/weather.js) fills the whole box: the land cover key goes back under it while that overlay is on */
  /* a legend's long note (what the classes mean, the map's date, the credit) folds under one small button, as METHODS and
     the Sources sheet already give the details: the legend stays short. Open or shut is kept for the visit and on this device;
     notes that say something failed, or hold a link, are never folded (only the theme note, #legendNote or [data-fold]). */
  let notesOpen = false;
  try { notesOpen = localStorage.getItem("fg.lnotes") === "1"; } catch (e) { /* storage off: shut */ }
  document.body.classList.toggle("lnotes-open", notesOpen);
  const NOTE_TG = () => (notesOpen ? "Hide details" : "About this map: classes, date, source");
  function foldNotes() {
    $$("#legend > #legendNote, #legend > .lnote[data-fold]").forEach(n => {
      if (n.classList.contains("folded") || !n.textContent.trim()) return;
      n.classList.add("folded");
      const b = document.createElement("button");
      b.type = "button"; b.className = "lnote-tg"; b.textContent = NOTE_TG(); b.setAttribute("aria-expanded", notesOpen);
      n.before(b);
    });
  }
  document.addEventListener("click", e => {
    if (!e.target.closest || !e.target.closest(".lnote-tg")) return;
    notesOpen = !notesOpen;
    document.body.classList.toggle("lnotes-open", notesOpen);
    $$(".lnote-tg").forEach(b => { b.textContent = NOTE_TG(); b.setAttribute("aria-expanded", notesOpen); });
    try { localStorage.setItem("fg.lnotes", notesOpen ? "1" : "0"); } catch (err) { /* storage off */ }
  });
  new MutationObserver(() => { if (!$("#legend .lc")) lcKey(); foldNotes(); }).observe($("#legend"), { childList: true });
  function drawBaseLegend() {
    const entry = Object.entries(themes).find(([, t]) => t.on), el = $("#legend");
    const lv = state.theme !== "erosion" && Object.values(live[state.theme] || {}).find(t => t.on);
    if (lv) return (lv.drawLegend || WG.weather.legend)(el, lv, legendMin, () => { legendMin = !legendMin; renderLegend(); }); // a layer may draw its own (the soil maps add their choices)
    // no layer of the theme on: the box is emptied too, so the land cover key (or the next legend) is not added to the last one's
    if (!entry) { el.innerHTML = ""; el.hidden = true; return; }
    const [key, { meta: m }] = entry, L = legendText(key, m);
    el.hidden = false;
    el.classList.toggle("min", legendMin);
    el.innerHTML = `<h5><span>${esc(m.title)}${L.unit ? ` <small style="font-weight:400;color:#69716a">(${esc(L.unit)})</small>` : ""}</span>
      <button id="legendMin">${legendMin ? "show" : "hide"}</button></h5>
      <div class="rows">${m.legend.map((l, i) => `<div class="row"><i class="sw" style="background:${l.color}"></i>${esc(L.labels[i])}</div>`).join("")}</div>
      <p class="lnote" data-fold>${esc(L.note)}${key === "climate" || key === "susceptibility" ? estNote() : ""}${noMaps()}</p>`;
    $("#legendMin").onclick = () => { legendMin = !legendMin; renderLegend(); };
    if (WG.shares) WG.shares.attach(el, { key, name: m.title, legend: { rows: m.legend.map((l, i) => [l.color, L.labels[i]]) }, shares: themes[key].shares });
  }
  // the chosen states whose statewide maps are not built yet: said in the legend, so a blank state doesn't read as no risk
  function noMaps() {
    const miss = (typeof region !== "undefined" ? region.recs : []).filter(r => !r.overlays).map(r => r.name);
    return miss.length ? ` <b>Not mapped yet: ${esc(miss.join(", "))}.</b> Tap any point there for its own results.` : "";
  }
  // the chosen states' share of area where SSURGO gives a county no usable C and the map's C is the estimate (tools/build_layers.py)
  function estNote() {
    const est = (typeof region !== "undefined" ? region.recs : []).filter(r => r.overlays && r.overlays.stats && r.overlays.stats.C_est_pct >= 0.5)
      .map(r => `${r.overlays.stats.C_est_pct >= 99.5 ? "all" : `${Math.round(r.overlays.stats.C_est_pct)}%`} of ${r.name}`);
    const many = est.length > 6 && `${est.length} of the ${region.recs.length} chosen states, in all or part`; // the whole US: a count, not 35 names
    return est.length ? ` <b>C estimated</b> where SSURGO gives a county no usable value: ${esc(many || est.join(", "))}.` : "";
  }
  renderLegend();
  /* a theme's live layer by key (null: its default), from the tabs and the date bar on the map (js/timemap.js) */
  function setLive(theme, key) {
    if (state.theme !== theme) setTheme(theme);
    const set = live[theme], k = key || (WG.weather.layers[theme].find(x => x.def) || WG.weather.layers[theme][0]).key;
    if (set && set[k] && !set[k].on) setToggle("live", k, true);
  }
  WG.timemap.init(map, { setLive, renderLegend });
  /* the Soil maps theme's tabs: their "show on the map" links, the dominant soil drawn into the Soil tab, a phone's results
     lowered so a place shown on the map can be seen, and the land cover overlay switched from the Soil tab's tile and the
     Basin tab: the same overlay as the layer sheet's (so never a second one), with the theme's own map taken off (liveOff)
     where the land cover takes its place */
  if (WG.soilmaps) WG.soilmaps.init({ setLive, renderLegend, profile: () => renderSoilDetail(), lower: () => { if (phone() && state.site) setLayout("peek"); },
    lcLayer: soilLayers.nlcd.layer, landCover: on => { if (soilLayers.nlcd.on !== on) setToggle("soilLayers", "nlcd", on); },
    liveOff: key => { const it = (live[state.theme] || {})[key]; if (it && it.on) setToggle("live", key, false); } });
  /* the land cover key's link: Soil maps › Soil, scrolled to its Land cover card. The land cover stays the map there (the
     theme's own map is not put over it). The tab is a place's: without one, it says so. */
  $("#legend").addEventListener("click", e => {
    if (!e.target.closest("[data-lc-go]")) return;
    if (!state.site) { U.toast("Tap a place on the map, then open Soil maps › Soil: its Land cover card gives each class's share and curve numbers.", 6000); return; }
    const big = app.classList.contains("map-big");
    if (state.theme !== "soilmaps") { choice.soilmaps = null; setTheme("soilmaps", "soilmaps"); } else showTab("soilmaps");
    if (big) raisePanel();
    // once lowered results have opened to their size (a .35 s transition): measured earlier, the card's place is wrong
    setTimeout(() => {
      const c = $("#smLc .card"), pb = $("#panelBody");
      if (!c || $("#tab-soilmaps").hidden) return;
      pb.scrollTo({ top: Math.max(0, c.getBoundingClientRect().top - pb.getBoundingClientRect().top + pb.scrollTop - 8), behavior: "smooth" });
      c.classList.remove("so-flash"); void c.offsetWidth; c.classList.add("so-flash");
    }, big ? 450 : 0);
  });
  setTheme(state.theme); // the theme in the link, or wind erosion: its overlay, legend, hint and tabs

  /* ============ SEARCH / COORDINATES ============ */
  const input = $("#searchInput"), results = $("#searchResults");
  let searchSeq = 0;

  /* While typing, towns, cities and counties come from the app's own list (js/places.js), no server asked.
     Enter asks Nominatim (OpenStreetMap), which also knows streets, addresses and landmarks: its usage policy allows at
     most one request a second for the whole site, no search as you type, and asks for answers to be kept; so it is
     asked on Enter only, each answer is kept for the session, and requests are spaced one second apart. */
  const NOMI = "https://nominatim.openstreetmap.org/";
  let nomiNext = 0;
  const nomiMemo = (() => { try { return new Map(JSON.parse(sessionStorage.getItem("fg.nominatim") || "[]")); } catch (e) { return new Map(); } })();
  const nomiNow = new Map(); // path -> promise, while a request is out
  function nominatim(path) {
    if (nomiMemo.has(path)) return Promise.resolve(nomiMemo.get(path));
    if (!nomiNow.has(path)) nomiNow.set(path, nomiAsk(path).finally(() => nomiNow.delete(path)));
    return nomiNow.get(path);
  }
  async function nomiAsk(path) {
    const wait = Math.max(0, nomiNext - Date.now());
    nomiNext = Math.max(Date.now(), nomiNext) + 1000;
    if (wait) await new Promise(r => setTimeout(r, wait));
    if (nomiMemo.has(path)) return nomiMemo.get(path);
    const j = await U.fetchJSON(NOMI + path, { headers: { "Accept-Language": "en" } }, 12000);
    nomiMemo.set(path, j);
    try { sessionStorage.setItem("fg.nominatim", JSON.stringify([...nomiMemo].slice(-200))); } catch (e) { /* storage full or off */ }
    return j;
  }
  function geocode(q) {
    const b = regionBounds; // preferred, not limiting: a place in another state can be found and its state added
    const params = new URLSearchParams({ q: q.trim().replace(/\s+/g, " "), format: "jsonv2", limit: "6", countrycodes: "us", addressdetails: "1",
      ...(b ? { viewbox: `${b.getWest().toFixed(2)},${b.getNorth().toFixed(2)},${b.getEast().toFixed(2)},${b.getSouth().toFixed(2)}` } : {}), bounded: "0" });
    return nominatim(`search?${params}`);
  }

  // the list's buttons are type="button": inside the form, a plain button would submit it and search again for the name picked
  function showResults(items, note, hint) {
    const tail = hint ? `<button type="button" class="enter-hint" disabled>${esc(hint)}</button>` : "";
    if (!items.length) { results.innerHTML = `<button type="button" disabled>${esc(note || "No matches in the 48 contiguous states")}</button>${tail}`; results.hidden = false; return; }
    results.innerHTML = items.map((r, i) =>
      `<button type="button" data-i="${i}" role="option"><b>${esc(r.title)}</b><small>${esc(r.sub)}${r.adds ? ` · adds ${esc(r.adds)} to the map` : ""}${r.later ? " · comes later" : ""}</small></button>`).join("") + tail;
    results.hidden = false;
    results.onclick = e => {
      const b = e.target.closest("button[data-i]");
      if (!b) return;
      e.preventDefault();
      goToResult(items[+b.dataset.i]);
    };
  }
  async function goToResult(r) {
    clearTimeout(typeTimer);
    searchSeq++; // a suggestion or a search still on its way no longer shows
    results.hidden = true;
    input.value = r.title;
    input.blur();
    if (await ensureState(r.lat, r.lon)) selectSite(r.lat, r.lon, { zoom: r.zoom || 14, place: r.title });
  }

  /* suggestions while typing: "Tem" lists Temple, TX; Temple City, CA; ... (the most people first, the states on the
     map counting more); ", ok" or " oklahoma" at the end keeps one state */
  const ENTER_HINT = "Press Enter to search streets, addresses and other places (OpenStreetMap)";
  const stateNames = Object.fromEntries(SI.list.filter(x => x.l48).map(x => [x.c, x.n]));
  let typeTimer = 0;
  const findPlaces = (q, limit) => WG.places.find(q, { here: new Set(region.codes), states: stateNames, limit }).map(placeItem);
  function placeItem(p) {
    const x = STATE_OF[p.st], n = p.people;
    const ppl = n >= 1000 ? `about ${Number(n.toPrecision(2)).toLocaleString("en-US")} people` : n ? `${n} people` : "";
    return { title: `${p.name}, ${p.st}`, sub: [x.n, p.kind, ppl].filter(Boolean).join(" · "), lat: p.lat, lon: p.lon,
      zoom: p.county ? 10 : 13, adds: region.codes.includes(p.st) || !canLive(p.st) ? null : x.n, later: !canLive(p.st), exact: p.exact };
  }
  async function suggest() {
    const q = input.value, t = q.trim(), seq = ++searchSeq;
    const c = U.parseCoords(q);
    if (c) { showResults([{ title: `${c.lat.toFixed(5)}, ${c.lon.toFixed(5)}`, sub: "Go to coordinates", lat: c.lat, lon: c.lon, zoom: 14 }]); return; }
    if (t.length < 2) { results.hidden = true; return; }
    if (/^\d/.test(t)) { showResults([], ENTER_HINT); return; } // a street address
    try { await WG.places.load(ASSET_V); } catch (e) { if (seq === searchSeq) showResults([], ENTER_HINT); return; }
    if (seq !== searchSeq) return;
    const items = findPlaces(q, 10);
    showResults(items, `No town, city or county starts with "${t}". ${ENTER_HINT}.`, items.length ? ENTER_HINT : "");
  }
  input.addEventListener("input", () => { clearTimeout(typeTimer); typeTimer = setTimeout(suggest, 80); });
  input.addEventListener("focus", () => {
    WG.places.load(ASSET_V).catch(() => {}); // read once, so it is ready by the first letters
    if (input.value.trim().length >= 2 && results.hidden && $("#coordForm").hidden) suggest();
  });
  // the arrow keys move through the list (Enter or Space picks), Escape closes it
  const rowsShown = () => [...results.querySelectorAll("button[data-i]")];
  input.addEventListener("keydown", e => {
    if (e.key === "ArrowDown" && !results.hidden && rowsShown().length) { e.preventDefault(); rowsShown()[0].focus(); }
    else if (e.key === "Escape" && !results.hidden) { e.preventDefault(); results.hidden = true; }
  });
  results.addEventListener("keydown", e => {
    const list = rowsShown(), i = list.indexOf(document.activeElement);
    if (i < 0) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const j = i + (e.key === "ArrowDown" ? 1 : -1);
      (j < 0 ? input : list[Math.min(j, list.length - 1)]).focus();
    } else if (e.key === "Escape") { e.preventDefault(); results.hidden = true; input.focus(); }
  });

  async function runSearch(q) {
    const c = U.parseCoords(q);
    if (c) {
      showResults([{ title: `${c.lat.toFixed(5)}, ${c.lon.toFixed(5)}`, sub: "Go to coordinates", lat: c.lat, lon: c.lon, zoom: 14 }]);
      return;
    }
    if (q.trim().length < 3) { results.hidden = true; return; }
    const seq = ++searchSeq;
    try {
      const rows = await geocode(q);
      if (seq !== searchSeq) return;
      // contiguous states only; a place in a state not on the map says it will be added
      const st = r => { const iso = r.address && r.address["ISO3166-2-lvl4"]; return iso && iso.startsWith("US-") ? STATE_OF[iso.slice(3)] : null; };
      const found = rows.filter(r => { const x = st(r); return x ? x.l48 && (!region.codes.includes(x.c) || inRegion(+r.lat, +r.lon)) : inRegion(+r.lat, +r.lon); });
      const own = found.length || !WG.places.loaded() ? [] : findPlaces(q, 8);
      if (own.length) { showResults(own, "", "OpenStreetMap found nothing more"); return; }
      showResults(found.map(r => {
        const x = st(r);
        return {
          title: r.name || r.display_name.split(",")[0],
          sub: r.display_name.split(",").slice(1, 4).join(",").trim(),
          lat: +r.lat, lon: +r.lon, adds: x && !region.codes.includes(x.c) && canLive(x.c) ? x.n : null, later: !!x && !canLive(x.c),
          zoom: r.type === "county" || r.addresstype === "county" ? 10 : r.place_rank < 16 ? 11 : 14,
        };
      }));
    } catch (e) {
      // a failed search is not "no matches": say so, and that coordinates still work
      if (seq === searchSeq) showResults([], `The place search (OpenStreetMap) did not answer: ${e.message || e}. Try again in a moment, or enter lat, lon.`);
    }
  }
  $("#searchForm").addEventListener("submit", e => {
    e.preventDefault();
    clearTimeout(typeTimer);
    const c = U.parseCoords(input.value);
    if (c) { results.hidden = true; input.blur(); ensureState(c.lat, c.lon).then(ok => ok && selectSite(c.lat, c.lon, { zoom: 14 })); return; }
    // a whole name and its state ("Temple, TX", "temple texas") goes there; anything else asks OpenStreetMap
    const top = WG.places.loaded() && findPlaces(input.value, 1)[0];
    if (top && top.exact) { goToResult(top); return; }
    runSearch(input.value);
  });
  document.addEventListener("click", e => {
    if (!e.target.closest("#searchForm")) { results.hidden = true; $("#coordForm").hidden = true; }
  });
  $("#coordBtn").addEventListener("click", () => {
    const f = $("#coordForm");
    f.hidden = !f.hidden;
    results.hidden = true;
    if (!f.hidden) {
      if (state.site) { $("#latInput").value = state.site.lat.toFixed(5); $("#lonInput").value = state.site.lon.toFixed(5); }
      $("#latInput").focus();
    }
  });
  function goCoords() {
    const lat = U.parseCoords($("#latInput").value + " " + $("#lonInput").value)
      || { lat: parseFloat($("#latInput").value), lon: parseFloat($("#lonInput").value) };
    if (!Number.isFinite(lat.lat) || !Number.isFinite(lat.lon) || Math.abs(lat.lat) > 90 || Math.abs(lat.lon) > 180) {
      U.toast("Enter latitude and longitude in decimal degrees, e.g. 32.7357 and -101.955");
      return;
    }
    $("#coordForm").hidden = true;
    ensureState(lat.lat, lat.lon).then(ok => ok && selectSite(lat.lat, lat.lon, { zoom: 14 }));
  }
  $("#coordGo").addEventListener("click", goCoords);
  $$("#coordForm input").forEach(i => i.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); goCoords(); } }));

  $("#locateBtn").addEventListener("click", () => {
    if (!navigator.geolocation) return U.toast("Location is not available in this browser");
    const b = $("#locateBtn");
    b.classList.add("busy");
    navigator.geolocation.getCurrentPosition(p => {
      b.classList.remove("busy");
      ensureState(p.coords.latitude, p.coords.longitude).then(ok => ok && selectSite(p.coords.latitude, p.coords.longitude, { zoom: 15 }));
    }, err => {
      b.classList.remove("busy");
      U.toast("Couldn't get your location: " + err.message);
    }, { enableHighAccuracy: true, timeout: 15000 });
  });

  /* ============ LAYOUT ============ */
  function setLayout(mode) {
    /* mode: 'none' | 'split' | 'mapbig' | 'peek'. 'peek' is the bigger map of a phone, where the results drop to a bar at
       the foot that keeps the place's name and the grip (tap it or swipe it up to bring them back): the same class as
       'mapbig', which css/app.css draws as that bar on a phone and as the map alone, with the "Show results" pill, on a
       wider screen */
    const big = mode === "mapbig" || mode === "peek";
    app.classList.toggle("has-site", mode !== "none");
    app.classList.toggle("map-big", big);
    $("#mapToggle").hidden = !big;
    const g = $("#panelGrip");
    g.setAttribute("aria-expanded", String(mode === "split"));
    g.setAttribute("aria-label", mode === "split" ? "Lower the results to a bar and show the map" : "Show the results");
    // follow the grid transition, then settle (timers rather than rAF so background tabs still settle)
    // the map container animates; a ResizeObserver settles it once the size stops changing
    setTimeout(() => { if (pendingView) settleMap(); }, 1200); // fallback if the size never changed
  }
  let pendingView = null;
  function settleMap() {
    map.invalidateSize({ pan: false });
    if (pendingView) { map.setView(pendingView.ll, pendingView.z, { animate: false }); pendingView = null; }
    else if (state.site) keepPinVisible();
    Ch.resizeAll();
  }
  const settleSoon = U.debounce(settleMap, 140);
  new ResizeObserver(() => { map.invalidateSize({ pan: false }); settleSoon(); }).observe($(".map-pane"));
  function keepPinVisible() {
    const p = L.latLng(state.site.lat, state.site.lon);
    if (!map.getBounds().pad(-0.15).contains(p)) map.panTo(p, { animate: true });
  }
  $("#expandMapBtn").addEventListener("click", () => setLayout("mapbig"));
  const raisePanel = () => { if (state.site) pendingView = { ll: L.latLng(state.site.lat, state.site.lon), z: map.getZoom() }; setLayout("split"); };
  $("#mapToggle").addEventListener("click", raisePanel);
  /* the phone's grip and the panel's head: a tap on the grip lowers the results to the bar or brings them back, a tap on
     the bar brings them back, and a swipe on either (down 40 px or more: the bar; up: the results) does the same. Only
     these two take the swipe (touch-action: none in css/app.css), so the results scroll as before. */
  const phone = () => window.matchMedia("(max-width: 767px)").matches, bar = () => app.classList.contains("map-big");
  let swipe = null, swiped = 0;
  const lower = () => setLayout("peek");
  [$("#panelGrip"), $(".panel-head")].forEach(el => el.addEventListener("pointerdown", e => {
    if (!phone() || !state.site || e.button > 0 || e.target.closest(".head-actions")) return;
    if (e.pointerType === "mouse" && el !== $("#panelGrip")) e.preventDefault(); // a mouse drag on the head would select the place's name, and the next drag from that selection drags the text (pointercancel) instead
    swipe = { id: e.pointerId, x: e.clientX, y: e.clientY };
  }));
  window.addEventListener("pointerup", e => {
    if (!swipe || e.pointerId !== swipe.id) return;
    const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
    swipe = null;
    if (Math.abs(dy) < 40 || Math.abs(dy) < Math.abs(dx)) return;
    swiped = Date.now(); // the click that may follow the swipe is not a tap
    if (dy > 0 && !bar()) lower(); else if (dy < 0 && bar()) raisePanel();
  });
  window.addEventListener("pointercancel", () => { swipe = null; });
  $("#panelGrip").addEventListener("click", () => { if (Date.now() - swiped < 500) return; if (bar()) raisePanel(); else lower(); });
  $(".panel-head").addEventListener("click", e => { if (Date.now() - swiped < 500 || !phone() || !bar() || e.target.closest(".head-actions")) return; raisePanel(); });
  $("#closePanelBtn").addEventListener("click", () => {
    setLayout("none");
    if (marker) { map.removeLayer(marker); marker = null; }
    state.site = null;
    bareUrl(); // a reload or a shared link no longer opens the closed location
  });
  window.addEventListener("resize", U.debounce(() => { map.invalidateSize(); Ch.resizeAll(); }, 150));

  /* ---------- tabs ---------- */
  function showTab(name) {
    $$(".tabs button").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
    $$(".tab").forEach(t => { t.hidden = t.id !== "tab-" + name; });
    $("#panelBody").scrollTop = 0;
    fitTabRow();
    if (name === "wind" && state.wind) setTimeout(renderWindCharts, 0);
    if (["drought", "soilmaps", "soiloverview", "soilbasin", "soilmoist"].includes(name) && state.site) WG.weather.show(name, $("#tab-" + name));
    if (name === "download" && state.site) WG.datasheet.show();
  }
  /* A tab row wider than the panel (tablets; some themes on phones) scrolls under the sticky DOWNLOAD at its right end.
     The active tab is scrolled clear of it, so a link to another theme's tab lands on a tab that shows. DOWNLOAD's fade
     marks tabs hidden under it, so it goes ("at-end") once the row is scrolled to its end or fits, where it would only
     pale the tab next to it. Not measured while the panel is not laid out (no site yet); measured again as the row
     changes size (the panel opening widens it over .35 s, a window resized). */
  function fitTabRow() {
    const row = $(".tabs"), dl = $(".tabs .tab-dl"), b = $(".tabs button.active");
    if (!row.clientWidth) return;
    if (b && b !== dl && row.scrollWidth > row.clientWidth) {
      const x = b.getBoundingClientRect(), left = row.getBoundingClientRect().left + parseFloat(getComputedStyle(row).paddingLeft), right = dl.getBoundingClientRect().left - 16;
      // its left end first: in a row still narrower than the tab (the panel opening), scrolled no further than keeps it
      if (x.left < left) row.scrollLeft -= left - x.left;
      else if (x.right > right) row.scrollLeft += Math.min(x.right - right, x.left - left);
    }
    tabRowEnd();
  }
  function tabRowEnd() { const row = $(".tabs"); if (row.clientWidth) row.classList.toggle("at-end", row.scrollLeft + row.clientWidth >= row.scrollWidth - 1); }
  $(".tabs").addEventListener("scroll", tabRowEnd, { passive: true });
  new ResizeObserver(() => fitTabRow()).observe($(".tabs"));
  $("#dataBtn").addEventListener("click", () => showTab("download"));
  $(".tabs").addEventListener("click", e => { const b = e.target.closest("button[data-tab]"); if (b) showTab(b.dataset.tab); });
  // data-goto-theme: a link to a tab of another theme (Wind erosion › Soil to Soil maps › Soil) switches the map's theme too
  $("#panel").addEventListener("click", e => {
    const g = e.target.closest("[data-goto]");
    if (!g) return;
    if (g.dataset.gotoTheme && g.dataset.gotoTheme !== state.theme) setTheme(g.dataset.gotoTheme, g.dataset.goto);
    else showTab(g.dataset.goto);
    // keyboard focus off the link, now in a hidden tab: to the tab's first heading, else its button (js/soilmaps.js
    // moves it on to the card a data-so-go link names, once scrolled there)
    if (!g.getClientRects().length && !U.focusHead($("#tab-" + g.dataset.goto))) { const b = $(".tabs button.active"); if (b) b.focus({ preventScroll: true }); }
  });

  /* ============ SITE SELECTION ============ */
  let marker = null;
  map.on("click", e => { if (pickerTap) { pickerTap = false; return; } if (!(WG.area && WG.area.drawing())) pickSite(e.latlng.lat, e.latlng.lng, { keepZoom: true }); });
  // not-allowed cursor outside the outline, so the limit shows before a click
  map.on("mousemove", e => map.getContainer().classList.toggle("off-tx", !inRegion(e.latlng.lat, e.latlng.lng)));
  map.on("mouseout", () => map.getContainer().classList.remove("off-tx"));

  // for the area tool and the model files: the chosen states and the location's own
  /* A county's C on the state's maps (tools/build_layers.py), by SSURGO's county symbol ("KS055"): { C, est } with est
     true where SSURGO gives the county no usable value and C is the estimate; null where the symbol or the state's table is missing. */
  function countyC(sym) {
    if (!/^[A-Z]{2}\d{3}$/.test(sym || "")) return null;
    const rec = region.recs.find(r => r.code === sym.slice(0, 2)), v = rec && rec.overlays && rec.overlays.counties && rec.overlays.counties[sym.slice(2)];
    return v ? { C: v[0], est: !!v[1], pieces: v[2] || null } : null;
  }
  /* The C rule the point (cFactor) and the area tool (js/area.js) share. In a county with an estimate, the estimate:
     there the map unit's own symbol is none, 0 or Michigan's Upper Peninsula 100 (tools/build_layers.py NOT_RATED).
     Else the map unit's own NRCS areas (acre-weighted), which can be finer than the map: the map shows the county's
     mean, or its survey area's where they differ. Else that county or survey-area value. null without any. */
  function tableC(unitC, sym, survey) {
    const t = countyC(sym);
    if (t && t.est) return { C: t.C, kind: "est" };
    if (unitC) return { C: unitC, kind: "unit" };
    if (t) return { C: (t.pieces && t.pieces[survey]) || t.C, kind: "county" };
    return null;
  }
  // C to show: whole numbers, with a decimal below 10 when it has one (estimates go down to 0.1, which must not read as
  // the not-rated 0)
  const fmtC = v => fmt(v, Number.isInteger(+v) || v >= 10 ? 0 : 1);
  WG.fmtC = fmtC;
  WG.region = { inRegion, stateAt, countyC, tableC, codes: () => region.codes.slice(), recs: () => region.recs.slice(), site: () => state.siteState || null };

  /* Map clicks and pin drags: refuse points on a building, road or water body (area.js asks USA Structures, Census
     TIGER and USGS NHD; if they are slow the point is accepted). */
  let pickSeq = 0;
  async function pickSite(lat, lon, opts) {
    if (!inRegion(lat, lon) || !WG.area) return selectSite(lat, lon, opts);
    const my = ++pickSeq, el = map.getContainer();
    el.classList.add("checking");
    const hit = await WG.area.excludedAt(lat, lon);
    if (my !== pickSeq) return;
    el.classList.remove("checking");
    if (!hit) return selectSite(lat, lon, opts);
    U.toast(`That spot is ${hit.label} according to ${hit.src}. Pick a point on open land.`, 4500);
    if (marker && state.site) marker.setLatLng([state.site.lat, state.site.lon]);
  }

  function selectSite(lat, lon, opts = {}) {
    const here = stateAt(lat, lon);
    if (!here) {
      U.toast(opts.why || `That point is outside ${regionName()}. Pick a point inside the outline, or add its state with the state button.`);
      if (marker && state.site) marker.setLatLng([state.site.lat, state.site.lon]); // undo a drag across the line
      return;
    }
    state.site = { lat, lon };
    state.siteState = here;
    Wd.setZone(here.tz); // days and months in the state's standard time
    window.WE_STATIONS = here.stations; // the airports within about 150 km of the state, for the calibration
    state.token++;
    state.soil = null; state.edits = null; state.wind = null; state.windRaw = null; state.windSets = null; state.windStation = null; state.windAirport = null; state.windTower = null; state.windSkipped = []; state.nlcd = null; state.elev = null;
    state.place = opts.place || null;

    const ll = L.latLng(lat, lon);
    if (!marker) {
      marker = L.marker(ll, { draggable: true, icon: L.divIcon({ className: "", html: '<div class="pin"></div>', iconSize: [30, 30], iconAnchor: [15, 30] }) }).addTo(map);
      marker.on("dragend", () => { const p = marker.getLatLng(); pickSite(p.lat, p.lng, { keepZoom: true }); });
    } else marker.setLatLng(ll);

    const wasOpen = app.classList.contains("has-site") && !app.classList.contains("map-big");
    const z = opts.keepZoom ? Math.max(map.getZoom(), 9) : opts.zoom || Math.max(map.getZoom(), 12);
    if (wasOpen) map.setView(ll, z, { animate: true });
    else { pendingView = { ll, z }; setLayout("split"); }

    try { history.replaceState(null, "", `?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}${windQ()}${UN.query()}${KEEP_Q}`); } catch (e) { /* file:// */ }
    renderHeader();
    resetPanels();
    const on = $(".tabs button.active"), keep = on && !on.hidden && !["overview", "wind", "soil", "practices"].includes(on.dataset.tab);
    showTab(keep ? on.dataset.tab : $(".tabs button[data-tab]:not([hidden])").dataset.tab);
    analyzeSite(state.token);
  }

  function renderHeader() {
    // a late answer (the 1 m elevation, the place name) after the panel was closed
    if (!state.site) return;
    const { lat, lon } = state.site;
    $("#siteName").textContent = state.place || "Selected location";
    $("#siteCoords").textContent = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    $("#siteElev").textContent = state.elev ? `${UN.fmt("elev", state.elev.z)} elev · ${fmt(state.elev.slope, 1)}% slope (${state.elev.src.replace(/ \d+ m.*$/, "")})` : "";
  }

  function resetPanels() {
    const rc = $("#riskCard");
    rc.className = "risk-card loading";
    $("#riskLevel").textContent = "Analyzing…";
    $("#riskText").textContent = `Fetching the soil survey and hourly wind for ${periodLabel()}…`;
    Ch.gauge($("#riskGauge"), null);
    renderRiskScale(0);
    $("#riskUnit").textContent = "";
    $("#riskFacts").innerHTML = "";
    $("#glance").innerHTML = ["Mean wind (10 m)", "Erosive wind", "Prevailing erosive wind", "Wind data", "Land cover"]
      .map(k => `<span class="k">${k}</span><span class="v"><span class="skeleton" style="width:80px"></span></span><span class="n"></span>`).join("");
    renderWegTable(null);
    $("#monthStrip").innerHTML = U.MONTHS.map(m => `<div class="m"><i class="skeleton" style="height:28px"></i>${m[0]}</div>`).join("");
    $("#ovSoil").innerHTML = '<span class="skeleton"></span><span class="skeleton" style="width:60%"></span>';
    $("#soilSummary").innerHTML = '<span class="skeleton"></span><span class="skeleton" style="width:60%"></span>';
    $("#soilDerived").innerHTML = "";
    $("#soilSrcTag").textContent = "SSURGO"; // the Soil maps theme's Soil tab is drawn anew for the new location (js/soilmaps.js)
    $$(EDIT_INPUTS).forEach(i => { i.value = ""; i.classList.remove("edited"); });
    $$(".reset-soil").forEach(b => { b.hidden = true; });
    clearWind();
    $("#planBox").innerHTML = "";
    renderPractices();
  }

  /* The Wind tab while a series loads: nothing of the last site or period stays on the page or in its downloads. */
  const WIND_CHARTS = ["chSeason", "chSpeed", "chWater", "chTrend", "chCal"];
  function clearWind() {
    $("#windSrcTag").textContent = "loading…";
    ["#moistTag", "#roseBox", "#roseNote", "#trendTag", "#trendNote", "#calKv", "#windIdx", "#windSource"].forEach(s => { $(s).textContent = ""; });
    $("#calCard").hidden = true;
    Ch.clear(WIND_CHARTS);
  }

  async function analyzeSite(tok) {
    const { lat, lon } = state.site;
    const live = () => tok === state.token;

    const jobs = [
      reverseGeocode(lat, lon).then(p => { if (live() && p && !state.place) { state.place = p; renderHeader(); } }).catch(() => {}),
      fetchElevation(lat, lon).then(({ e, later }) => {
        const use = x => { if (x && live()) { state.elev = x; renderHeader(); renderSoilDetail(); } };
        use(e);
        later.then(use); // USGS 3DEP (1 m), when it answers after the Copernicus DEM was shown
      }).catch(() => {}),
      fetchNLCD(lat, lon).then(n => { if (live()) { state.nlcd = n; renderStats(); renderPractices(); } }).catch(() => { if (live()) { state.nlcd = { code: null }; renderStats(); } }),
      // "wg-soil": the survey read (or its failure) and the surface edits, for the Soil maps theme's tabs (js/soilmaps.js, js/basins.js)
      S.fetchSoil(lat, lon).then(s => {
        if (!live()) return;
        state.soil = s;
        renderSoil(); renderRisk(); renderStats(); renderPractices();
        document.dispatchEvent(new Event("wg-soil"));
      }).catch(err => {
        if (!live()) return;
        state.soil = { error: err.message || String(err) };
        renderSoil(); renderRisk(); renderStats();
        document.dispatchEvent(new Event("wg-soil"));
      }),
      loadWind(tok),
    ];
    await Promise.allSettled(jobs);
  }

  let windSeq = 0, stnSeq = 0; // a newer period/model request supersedes an older one; a newer station pick an older pick
  async function loadWind(tok) {
    const { lat, lon } = state.site;
    const seq = ++windSeq;
    stnSeq++;
    const live = () => tok === state.token && seq === windSeq;
    let failed = false;
    const towerLive = () => !failed && live() && !state.windStationChoice; // a pick, a newer load or a failed load stops the tower read
    try {
      // airport observations download in parallel; the gridded model shows first, calibration follows. A West Texas
      // Mesonet tower that ranks ahead of every airport (mesonet on) loads alongside and replaces the airport's speed
      // calibration if it passes the exposure check; gusts stay with the airport.
      state.windStationChoice = null;
      state.windStationPending = true;
      const P = state.windPeriod = Wd.resolvePeriod(state.period, state.gridModel), bad = periodIssue(state.period, state.gridModel);
      if (bad) throw new Error(bad); // refused when the dates or the model were chosen; never analyse days not asked for
      state.windTower = Wd.towerFirst(lat, lon, P);
      const tried = []; // every tower read, so a second try never reads one again
      const onTry = s => { tried.push(s.id); if (towerLive()) { state.windTower = s; renderWind(); } };
      const findAirport = per => Wd.findStation(lat, lon, per).catch(e => { console.warn("station lookup failed", e); return null; });
      let stationJob = findAirport(P);
      let job = state.windTower ? Wd.findStation(lat, lon, P, null, { towers: true, live: towerLive, onTry })
        .catch(e => { console.warn("tower lookup failed", e); return null; }) : null;
      const raw = await Wd.fetchWind(lat, lon, P, state.gridModel);
      if (!live()) return;
      const per = state.windPeriod = raw.period; // the other model may have answered, with its own limits
      if (per !== P) { // other dates: the airport's window must hold them for "station only" and the comparison
        const T = Wd.trainSpan(P);
        if (per.d0 < T.d0 || per.d1 > T.d1) stationJob = findAirport(per);
        U.toast(`${MODEL[state.gridModel].short} did not answer, so ${MODEL[raw.model].short} is used for ${per.label}.`, 6000);
      }
      state.windSets = { model: raw };
      state.windStation = null;
      state.windAirport = null; // reset with the sets: the old "station only" series and its airport go together
      state.windSkipped = [];
      chooseWind();
      renderWind(); renderRisk(); renderStats(); renderPractices();
      const st = await withModel(await stationJob, raw, live);
      if (!live()) return;
      applyStation(st, tok);
      // a tower is used if it passes the exposure check against the airport, or unchecked when no airport was found.
      // One that reads low (probably sheltered) or cannot be compared is skipped: one more is checked, then the airport stays.
      while (job) {
        const tw = await withModel(await job, raw, towerLive);
        if (!towerLive()) return;
        if (!tw || !tw.mod) break;
        const x = towerExposure(tw);
        if (x ? x.ero >= Wd.EXPOSURE_MIN : !state.windAirport) { state.windTower = null; applyStation(tw, tok); return; }
        state.windSkipped.push(tw.meta);
        job = state.windSkipped.length < 2 && Wd.towerFirst(lat, lon, P, tried)
          ? Wd.findStation(lat, lon, P, null, { towers: true, live: towerLive, skip: tried, onTry }).catch(() => null) : null;
      }
      state.windTower = null;
      renderWind(); renderStats(); // no usable tower: the airport calibration stays
    } catch (err) {
      failed = true;
      if (!live()) return;
      state.windStationPending = false;
      state.windTower = null;
      state.wind = { error: err.message || String(err) };
      renderWind(); renderRisk(); renderStats(); renderPractices();
    }
  }

  /* Tower vs the current airport, each relative to the model: {mean, ero} ratios, null without an airport. */
  function towerExposure(tw) {
    const ap = state.windAirport;
    tw.meta.exposure = ap && ap.mod ? Wd.exposure(tw, ap) : null;
    tw.meta.expAp = ap ? ap.meta.id : null;
    return tw.meta.exposure;
  }

  /* Add the site's gridded model at the station to train the calibration; on an Open-Meteo per-minute
     quota error wait a minute and try once more. Without it the station series is still usable. */
  async function withModel(st, raw, live) {
    if (!st) return null;
    const get = () => Wd.fetchModelAt(raw.model, st.meta.lat, st.meta.lon, st.meta.win);
    try {
      st.mod = await get();
    } catch (e) {
      if (!/limit/i.test(e.message || "")) { console.warn("model at station failed", e); return st; }
      state.windStationRetry = true;
      if (live()) renderWind();
      await new Promise(r => setTimeout(r, 65000));
      state.windStationRetry = false;
      if (!live()) return null;
      st.mod = await get().catch(() => null);
    }
    return st;
  }

  function applyStation(st, tok) {
    if (tok !== state.token || !state.windSets) return;
    state.windStationPending = false;
    const raw = state.windSets.model;
    state.windSets = { model: raw };
    state.windStation = st;
    if (st && !st.meta.tower) state.windAirport = st;
    const ap = state.windAirport;
    if (ap) state.windSets.station = Wd.stationRaw(raw, ap); // "station only" is always an airport (towers cover only their latest years)
    if (st && st.mod) state.windSets.cal = Wd.calibrate(raw, st, st.meta.tower ? ap : st);
    chooseWind();
    renderWind(); renderRisk(); renderStats(); renderPractices();
  }

  /* User picked another calibration station; a newer pick or a new load supersedes it (and stops a tower read). */
  $("#stnSel").addEventListener("change", async e => {
    const tok = state.token, seq = windSeq, my = ++stnSeq, id = e.target.value;
    if (!state.site || !state.windSets) return;
    const live = () => tok === state.token && seq === windSeq && my === stnSeq;
    state.windStationChoice = id;
    state.windStationPending = true;
    state.windTower = null;
    renderWind();
    const st = await Wd.findStation(state.site.lat, state.site.lon, state.windPeriod, id, { live }).catch(() => null);
    if (!live()) return;
    if (!st) U.toast(`No usable data at ${id} for this period.`);
    const withMod = st ? await withModel(st, state.windSets.model, live) : null;
    if (!live()) return;
    if (withMod && withMod.meta.tower && withMod.mod) towerExposure(withMod); // shown, not enforced: the user chose it
    applyStation(withMod || state.windStation, tok);
  });

  /* Pick the preferred available wind series and analyze every source for the comparison card. */
  function chooseWind() {
    const sets = state.windSets || {};
    const pref = state.windSource;
    const key = sets[pref] ? pref : sets.cal ? "cal" : "model";
    state.windKey = key;
    state.windRaw = sets[key];
    state.windAll = Object.fromEntries(Object.entries(sets).map(([k, r]) => [k, Wd.analyze(r, state.thr)]));
    state.wind = state.windAll[key];
    state.windCompare = state.windStation && state.windStation.mod ? Wd.compare(state.windStation, state.thr, sets.model.period) : null;
  }

  async function reverseGeocode(lat, lon) {
    const j = await nominatim(`reverse?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&format=jsonv2&zoom=12&addressdetails=1`); // about 11 m: nearby clicks share an answer
    const a = j.address || {};
    const town = a.city || a.town || a.village || a.hamlet || a.locality;
    const county = a.county;
    if (town && county) return `Near ${town}, ${county}`;
    return county ? `${county}, ${a.state || ""}`.replace(/, $/, "") : (j.name || null);
  }

  /* Elevation, slope and aspect from 5 points ~100 m apart: USGS 3DEP (1–10 m lidar/DEM) from the Elevation
     Point Query Service, else the Copernicus 90 m DEM via Open-Meteo. */
  // how long the USGS 3DEP answer (1 m) is waited for before the Copernicus DEM (90 m, about a second) is used instead
  const ELEV_WAIT = 4000;
  async function fetchElevation(lat, lon) {
    const d = 0.0009, dl = d / Math.cos(lat * Math.PI / 180);
    const lats = [lat, lat + d, lat - d, lat, lat], lons = [lon, lon, lon, lon + dl, lon - dl];
    let pts, src;
    // the five 3DEP points and the Copernicus DEM (one request for all five points) are asked at once. The 3DEP answer is
    // used when it arrives within ELEV_WAIT; otherwise the Copernicus one, which answers in about a second. A slow 3DEP
    // point used to hold the lookup for its full 15 s timeout before the same fallback
    const settle = p => p.then(v => ({ ok: true, v }), e => ({ ok: false, e }));
    const usgs = settle(Promise.all(lats.map((y, k) => U.fetchJSON(`https://epqs.nationalmap.gov/v1/json?x=${lons[k].toFixed(6)}&y=${y.toFixed(6)}&wkid=4326&units=Meters&includeDate=false`, {}, 15000)))
      .then(js => { const p = js.map(j => num(j.value)); if (p.some(v => v === null || v < -1000)) throw new Error("no 3DEP coverage"); return { pts: p, src: `USGS 3DEP ${fmt(js[0].resolution, 0)} m` }; }));
    const cop = settle(U.fetchJSON(`https://api.open-meteo.com/v1/elevation?latitude=${lats.map(v => v.toFixed(5)).join(",")}&longitude=${lons.map(v => v.toFixed(5)).join(",")}`, {}, 10000)
      .then(j => ({ pts: j.elevation, src: "Copernicus 90 m DEM" })));
    const shape = ({ pts, src }) => {
      const [z, zn, zs, ze, zw] = pts;
      const dy = 2 * d * 111320, dx = 2 * dl * 111320 * Math.cos(lat * Math.PI / 180);
      const gx = (ze - zw) / dx, gy = (zn - zs) / dy;
      const slope = Math.hypot(gx, gy) * 100;
      const aspect = (Math.atan2(-gx, -gy) * 180 / Math.PI + 360) % 360;
      return { z, slope, aspect, src };
    };
    // after the wait, whichever of the two answers first with data (both failed: the last failure)
    const firstOk = ps => new Promise(res => { let left = ps.length; ps.forEach(p => p.then(x => { if (x.ok || --left === 0) res(x); })); });
    const quick = await Promise.race([usgs, new Promise(r => setTimeout(() => r(null), ELEV_WAIT))]);
    const r = quick && quick.ok ? quick : await firstOk([cop, usgs]);
    if (!r.ok) throw r.e;
    // the Copernicus answer is shown at once; a 3DEP answer that comes later replaces it (later), so nothing waits on it
    const later = r.v.src.startsWith("Copernicus") ? usgs.then(x => (x.ok ? shape(x.v) : null)) : Promise.resolve(null);
    if (r.v.src.startsWith("Copernicus")) console.warn("USGS 3DEP did not answer in time, using Copernicus DEM until it does");
    ({ pts, src } = r.v);
    return { e: shape({ pts, src }), later };
  }

  const NLCD = {
    11: "Open water", 12: "Perennial ice/snow", 21: "Developed, open space", 22: "Developed, low intensity",
    23: "Developed, medium intensity", 24: "Developed, high intensity", 31: "Barren land", 41: "Deciduous forest",
    42: "Evergreen forest", 43: "Mixed forest", 52: "Shrub/scrub", 71: "Grassland/herbaceous", 81: "Pasture/hay",
    82: "Cultivated crops", 90: "Woody wetlands", 95: "Emergent herbaceous wetlands",
  };
  /* Impact Observatory / Esri Sentinel-2 10 m classes, with the NLCD code the practice suggestions understand. */
  const IO_LULC = { 1: ["Water", 11], 2: ["Trees", 41], 4: ["Flooded vegetation", 95], 5: ["Crops", 82], 7: ["Built area", 22],
    8: ["Bare ground", 31], 9: ["Snow/ice", 12], 10: ["Clouds", null], 11: ["Rangeland", 71] };

  /* NLCD 2021 from the MRLC WMS; MRLC currently refuses cross-site requests, so the Sentinel-2 10 m land cover
     (Impact Observatory, Microsoft, Esri; latest year) answers instead. */
  async function fetchNLCD(lat, lon) {
    try {
      const d = 0.0005;
      const q = new URLSearchParams({ service: "WMS", version: "1.1.1", request: "GetFeatureInfo", layers: "NLCD_2021_Land_Cover_L48",
        query_layers: "NLCD_2021_Land_Cover_L48", srs: "EPSG:4326", bbox: `${lon - d},${lat - d},${lon + d},${lat + d}`,
        width: "3", height: "3", x: "1", y: "1", info_format: "application/json" });
      const j = await U.fetchJSON(`https://www.mrlc.gov/geoserver/mrlc_display/wms?${q}`, {}, 8000);
      const f = j.features && j.features[0];
      const code = f ? num(f.properties.PALETTE_INDEX ?? f.properties.GRAY_INDEX) : null;
      if (NLCD[code]) return { code, name: NLCD[code], src: "nlcd" };
    } catch (e) {
      console.warn("NLCD unavailable, using Sentinel-2 land cover", e);
    }
    const g = encodeURIComponent(JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } }));
    const j = await U.fetchJSON(`https://ic.imagery1.arcgis.com/arcgis/rest/services/Sentinel2_10m_LandCover/ImageServer/identify?geometry=${g}&geometryType=esriGeometryPoint&returnGeometry=false&returnCatalogItems=false&f=json`, {}, 12000);
    const c = IO_LULC[num(j.value)];
    return { code: c ? c[1] : null, name: c ? c[0] : null, src: "io" };
  }

  /* ============ RISK ============ */
  /* Bare-soil potential E = I × C/100 (t/ac/yr), C from SSURGO (official) else local estimate. */
  function currentSurface() {
    const s = state.soil && state.soil.surface;
    if (!s) return null;
    if (!state.edits) return { ...s, calc: null };
    const e = { ...s, ...state.edits };
    const texOf = v => S.refineCode(S.textureClass(v.sand, v.silt, v.clay), s.texCode);
    // unchanged sand/silt/clay keep the survey's own texture label (its RV fractions can classify differently)
    const sameTex = e.sand === s.sand && e.silt === s.silt && e.clay === s.clay;
    if (!sameTex) { e.texCode = texOf(e); e.texName = S.TEX[e.texCode] || e.texCode; }
    const w = S.wegFromSurface(e);
    // keep the survey's group unless the edit changes what the texture rules give (both worked out the same way):
    // a pH edit must not move Pullman clay loam (survey WEG 7) to the rules' 6, or a very stony Ector loam from 8 to 6
    const base = S.wegFromSurface(sameTex ? s : { ...s, texCode: texOf(s) });
    // "kept" puts a note under the edits that the survey's group stays: not after a pH edit alone, which edits none of them
    if (s.weg && w.weg === base.weg) { e.calc = null; e.kept = erodEdited(); }
    else { e.weg = w.weg; e.wei = w.I; e.calc = w; }
    return e;
  }
  // the edits change a value that sets the wind erodibility (sand to CaCO3, edited on Wind erosion › Soil; not pH);
  // a survey without CaCO3 reads as 0, as in the input
  function erodEdited() {
    const s = state.soil && state.soil.surface, ed = state.edits;
    return !!(s && ed) && ["sand", "silt", "clay", "om", "caco3"].some(k => (ed[k] ?? null) !== (s[k] ?? (k === "caco3" ? 0 : null)));
  }
  WG.currentSurface = currentSurface;

  /* The point's C from the survey and the state's county table (tableC), without the wind series: null when neither has
     one (the state's file not loaded, or a county code the table lacks). */
  function soilC(s) {
    const r = s && !s.error ? tableC(s.cFactor, s.countySym, s.mapunit && s.mapunit.areasymbol) : null;
    if (!r) return null;
    const syms = (s.cSyms || []).join(", ");
    if (r.kind === "est") return { C: r.C, src: "estimated for the county",
      how: `estimated for the county, as on the map: Chepil's formula with NASA POWER, scaled to the rated counties (${syms ? `SSURGO's ${syms} here is read as not assessed` : "SSURGO rates none here"})` };
    if (r.kind === "unit") return { C: r.C, src: "NRCS (SSURGO climate-factor area)",
      how: (s.cSyms || []).filter(x => +x > 0).length > 1 ? `NRCS climate-factor areas ${syms} of this map unit in SSURGO, ${s.cWeighted ? "weighted by its acres in each" : "their mean (SSURGO gives no acres)"} (direct)` : "NRCS climate-factor area in SSURGO (direct)" };
    return { C: r.C, src: "NRCS county value (SSURGO)", how: "NRCS value for the county (or its survey area) in SSURGO; this map unit has none" };
  }
  /* The point's C: as above (soilC), else an estimate from the hourly wind. */
  function cFactor() {
    const sc = soilC(state.soil);
    if (sc) return sc;
    if (state.wind && !state.wind.error && state.wind.annualized) {
      // local estimate from reanalysis: scale FAO monthly-sum C to Chepil-type C (rough), kept within the highest official
      // value (300, desert Southwest); it needs all 12 months, so a custom range shorter than a year gives no estimate
      return { C: Math.round(Math.min(300, state.wind.faoC * 0.9)), src: "estimated from reanalysis wind", how: "estimated from the wind series" };
    }
    return null;
  }

  function riskModel() {
    const surf = currentSurface();
    const cf = cFactor();
    if (!surf || surf.wei === null || surf.wei === undefined || !cf) return null;
    const E = (surf.wei * cf.C) / 100;
    const T = state.soil.dominant ? num(state.soil.dominant.tfact) : null;
    const EI = T ? E / T : null;
    // the exact E (t/ac/yr) against the class edges, in every unit; the headline's number follows it (UN.fmtCls)
    const level = 1 + UN.cls("soilLoss", E);
    const frac = level + Math.min(0.49, Math.max(-0.49,
      level === 1 ? E / 10 - 0.5 : level === 2 ? (E - 10) / 30 - 0.5 : level === 3 ? (E - 40) / 40 - 0.5 : level === 4 ? (E - 80) / 70 - 0.5 : (E - 150) / 150 - 0.5));
    return { E, EI, T, level, frac, C: cf.C, cSrc: cf.src, I: surf.wei, weg: surf.weg };
  }
  WG.riskModel = riskModel;

  const LEVEL_NAME = ["", "Low", "Moderate", "High", "Very high", "Extreme"];
  const LEVEL_EDGES = UN.Q.soilLoss.edges; // t/ac/yr, the app's classes; shown in the chosen soil-loss unit
  const levelRange = i => { const e = LEVEL_EDGES.map(v => UN.edge("soilLoss", v));
    return ["", `< ${e[0]}`, `${e[0]}–${e[1]}`, `${e[1]}–${e[2]}`, `${e[2]}–${e[3]}`, `≥ ${e[3]}`][i]; };
  const LEVEL_COLOR = ["", "#3f9a66", "#9bbf55", "#efc24a", "#ef8a3c", "#d8402f"]; // the gauge's colours

  /* The five classes under the headline, with this site's class lit, so the number has a scale. */
  function renderRiskScale(level) {
    const ss = state.siteState, tx = (ss && ss.overlays && ss.overlays.stats && ss.overlays.stats.E_pct_by_class) || [];
    $("#riskScale").innerHTML = LEVEL_NAME.slice(1).map((n, i) =>
      `<div role="listitem" class="${i + 1 === level ? "on" : ""}"${i + 1 === level ? ' aria-current="true"' : ""} style="--c:${LEVEL_COLOR[i + 1]}" title="${n}: ${levelRange(i + 1)} ${UN.sym("soilLoss")}${tx[i] !== undefined ? ` · ${fmt(tx[i], 0)}% of rated land in ${esc(ss.name)}` : ""}"><b>${n}</b><span>${levelRange(i + 1)}</span></div>`).join("");
    $("#riskScale").setAttribute("aria-label", `Risk classes, ${UN.sym("soilLoss")}`);
  }

  function renderRisk() {
    const rc = $("#riskCard");
    const r = riskModel();
    const w = state.wind;
    if (!r) {
      const surf = currentSurface();
      const noGroup = !!surf && (surf.wei === null || surf.wei === undefined);
      if (state.soil && (state.soil.error || !state.soil.surface || noGroup)) {
        rc.className = "risk-card";
        Ch.gauge($("#riskGauge"), null);
        renderRiskScale(0);
        $("#riskUnit").textContent = "";
        $("#riskFacts").innerHTML = "";
        $("#riskLevel").textContent = noGroup ? "No erodibility group" : "Soil data unavailable";
        $("#riskText").textContent = state.soil.error ? `Soil survey request failed (${state.soil.error}). Try again or enter your soil test on the Soil tab.`
          : !noGroup ? "No soil survey component with texture data here (water, urban or rock?). Enter your soil test on the Soil tab."
          : state.edits ? "These surface values don't place the soil in a Wind Erodibility Group. Enter sand, silt and clay on the Soil tab, or reset to the survey."
          : "The soil survey gives no Wind Erodibility Group for this soil (rock outcrop, urban land or water?). Enter your soil test on the Soil tab.";
      } else if (surf) { // a group but no climatic factor C yet: clear any older message
        rc.className = state.wind ? "risk-card" : "risk-card loading";
        Ch.gauge($("#riskGauge"), null);
        renderRiskScale(0);
        $("#riskUnit").textContent = "";
        $("#riskFacts").innerHTML = "";
        $("#riskLevel").textContent = state.wind ? "Climatic factor unavailable" : "Analyzing…";
        $("#riskText").textContent = state.wind ? (state.wind.annualized === false ? "NRCS gives no climatic factor C for this map unit, and estimating one needs a period that covers all 12 months."
          : "NRCS gives no climatic factor C for this map unit, and the wind history could not be used to estimate one.")
          : `Fetching hourly wind for ${periodLabel()}…`;
      }
      return;
    }
    rc.className = `risk-card r${r.level}`;
    $("#riskLevel").textContent = `${LEVEL_NAME[r.level]} · ${UN.fmtCls("soilLoss", r.E, 0)}`;
    Ch.gauge($("#riskGauge"), r.frac);
    renderRiskScale(r.level);
    const peak = w && !w.error && w.riskMonths.length ? monthsText(w.riskMonths) : null;
    const est = !r.cSrc.startsWith("NRCS"), tDp = UN.sym("soilLoss") === "t/ha/yr" ? 1 : 0;
    $("#riskFacts").innerHTML = facts([
      ["Soil erodibility I", UN.fmt("soilLoss", r.I, 0), `WEG ${r.weg || "—"} (1 most, 8 least erodible)`],
      ["Wind climatic factor C", `${est ? "≈ " : ""}${fmtC(r.C)}`, `${est ? "estimated · " : "NRCS · "}Garden City, KS = 100; windier and drier = more; not RUSLE's C`],
      ["E = I × C ÷ 100", UN.fmtCls("soilLoss", r.E, 0), "a yearly loss from bare, smooth, unsheltered ground, not your field's"],
      r.T ? ["Tolerable loss T", UN.fmt("soilLoss", r.T, tDp), "NRCS rating for this soil"] : null,
      r.EI ? ["Erodibility index C·I/T", `${est ? "≈ " : ""}${fmt(r.EI, 1)}`, r.EI >= 8 ? "C·I ÷ T: 8 or more = highly erodible land (HEL), NRCS" : "C·I ÷ T: highly erodible land (HEL) starts at 8, NRCS"] : null,
      peak ? ["Highest-risk months", peak, ""] : null,
    ]);
    $("#riskUnit").textContent = "Cover, residue, roughness and barriers can cut this by 80–99%.";
    $("#riskText").textContent = "";
  }

  function monthsText(idx) {
    if (!idx.length) return "";
    const s = [...idx].sort((a, b) => a - b);
    // group contiguous (wrap Dec→Jan)
    const runs = [];
    s.forEach(i => { const last = runs[runs.length - 1]; if (last && last[last.length - 1] === i - 1) last.push(i); else runs.push([i]); });
    if (runs.length > 1 && runs[0][0] === 0 && runs[runs.length - 1].slice(-1)[0] === 11) runs[0] = runs.pop().concat(runs[0]);
    return runs.map(r => r.length === 1 ? U.MONTHS[r[0]] : `${U.MONTHS[r[0]]}–${U.MONTHS[r[r.length - 1]]}`).join(", ");
  }
  WG.monthsText = monthsText;

  const speedTxt = (ms, d) => UN.html("wind", ms, d);
  // erosive threshold as a label: one decimal in m/s and kn, whole numbers in mph and km/h
  const thrTxt = v => UN.fmt("wind", v, ["m/s", "kn"].includes(UN.sym("wind")) ? 1 : 0);

  function renderStats() {
    const w = state.wind;
    if (w && !w.error) {
      const share = w.eroHours / 87.6; // % of the 8,760 hours in a year
      const stn = state.windStation && state.windStation.meta, ap = airportMeta();
      const src = state.windKey === "cal" ? [`calibrated to ${stn.id}`, `${(MODEL[w.model] || MODEL.merra2).short} + ${stn.tower ? "mesonet tower" : "airport"}`]
        : state.windKey === "station" ? [`${ap.id} airport`, "measured"] : [state.windStationPending ? "calibrating…" : "reanalysis only", (MODEL[w.model] || MODEL.merra2).short];
      $("#glance").innerHTML = facts([
        ["Mean wind (10 m)", UN.fmt("wind", w.meanSpeed, UN.sym("wind") === "km/h" ? 0 : 1), w.period ? w.period.label : periodLabel()],
        w.annualized ? ["Erosive wind", `${fmt(w.eroHours, 0)} h/yr`, `${fmt(share, share < 10 ? 1 : 0)}% of hours ≥ ${thrTxt(w.thr)}`]
          : ["Erosive wind", `${fmt(w.eroHours, 0)} h`, `in the months covered, per year, ≥ ${thrTxt(w.thr)}`],
        w.prevailing === null ? ["Prevailing erosive wind", "none", `no wind ≥ ${thrTxt(w.thr)} in this period`]
          : ["Prevailing erosive wind", `${U.compass(w.prevailing)}, from ${fmt(w.prevailing, 0)}°`, w.rdd === null ? "" : `soil moves toward ${U.compass(w.rdd)}`],
        ["Wind data", src[0], src[1]],
        ["Land cover", state.nlcd ? state.nlcd.name || "n/a" : "…", state.nlcd ? { nlcd: "NLCD 2021, 30 m", io: "Sentinel-2, 10 m" }[state.nlcd.src] || "" : ""],
      ]);
      // the months are ranked by their share of the year only when the period covers all 12
      $("#monthStrip").innerHTML = w.months.map((m, i) => `<div class="m ${m.level}" title="${U.MONTHS_LONG[i]}: ${m.valid ? `${(m.share * 100).toFixed(0)}% of ${w.annualized ? "annual" : "the covered months'"} risk` : "no data in this period"}"><i></i>${U.MONTHS[i][0]}</div>`).join("");
      $("#monthStripNote").textContent = !w.annualized
        ? `Months covered: ${monthsText(w.months.flatMap((m, i) => (m.valid ? [i] : [])))}. Months are ranked (red: 10% or more of the year's erosive wind energy, in dry conditions) only when the period covers all 12.`
        : w.riskMonths.length ? `High-risk: ${monthsText(w.riskMonths)}. Red: 10% or more of the year's erosive wind energy, in dry conditions.`
          : "Erosive wind is spread evenly across the year here.";
    } else if (w && w.error) { // the series failed to load, or has no usable month in the period: a message, no numbers
      const what = w.insufficient ? "Not enough wind data" : "Wind history unavailable";
      $("#glance").innerHTML = facts([["Wind history", w.insufficient ? "not enough data" : "unavailable", w.error], ["Land cover", state.nlcd ? state.nlcd.name || "n/a" : "…", ""]]);
      $("#monthStrip").innerHTML = `<p class="fine" style="grid-column:1/-1">${what}: ${esc(w.error)}</p>`;
      $("#monthStripNote").textContent = w.insufficient ? "Each month is summarised from 20 or more days of hourly wind." : "";
    }
  }

  /* rows [label, value, note] as aligned columns (null rows are skipped) */
  const facts = rows => rows.filter(Boolean).map(([k, v, n]) => `<span class="k">${esc(k)}</span><span class="v">${esc(v)}</span><span class="n">${esc(n || "")}</span>`).join("");


  /* ============ WIND TAB ============ */
  function renderWind() {
    const w = state.wind;
    if (!w) return;
    $("#thrVal").textContent = thrTxt(state.thr);
    const sets = state.windSets || {};
    if (sets.model) { // the selectors follow the series loaded, also when the one shown has too little data
      const was = shownModel();
      $("#modelSel").value = sets.model.model || state.gridModel;
      if (shownModel() !== was) syncPeriodUI(!$("#periodCustom").hidden); // the other model answered: the date limits follow
      const sel = $("#srcSel");
      [...sel.options].forEach(o => { o.disabled = !sets[o.value]; });
      sel.value = state.windKey;
    }
    if (w.error) return blankWind(w);
    const stn = state.windStation && state.windStation.meta, ap = airportMeta();
    const key = state.windKey;
    const mShort = (MODEL[w.model] || MODEL.merra2).short;
    const busy = state.windTower ? ` · reading ${state.windTower.id} tower…` : state.windStationPending && state.windStationChoice ? ` · loading ${state.windStationChoice}…` : "";
    const yl = w.period ? w.period.label : periodLabel(); // the analysis' own dates, never those of a load still running
    $("#windSrcTag").textContent = key === "cal" ? `calibrated to ${stn.id} · ${yl}${busy}`
      : key === "station" ? `${ap.id} station · ${yl}${busy}`
        : state.windStationRetry ? `${mShort} · data limit, retrying in 1 min` : state.windStationPending ? `${mShort} · calibrating…` : `${mShort} · ${yl}`;
    $("#moistTag").textContent = { gridmet: "gridMET 4 km", "nasa-power": "NASA POWER (fallback)", "open-meteo": "Open-Meteo (fallback)" }[(w.moisture || {}).source] || "";
    // colours rank the months only over a whole year
    $("#seasonLegend").innerHTML = w.annualized ? '<span><i class="sw red"></i>High-risk month</span><span><i class="sw amber"></i>Elevated</span><span><i class="sw gray"></i>Lower</span><span><i class="sw line"></i>Mean wind speed</span>'
      : '<span><i class="sw gray"></i>Month covered (not ranked)</span><span><i class="sw line"></i>Mean wind speed</span>';
    $("#seasonNote").textContent = w.annualized ? "Bars: average hours per year with wind above the erosive threshold. Color weighs wind energy above threshold by dryness (1 − precip/ET₀)."
      : "Bars: average hours per year with wind above the erosive threshold, in the months covered. Colors rank the months by their share of the year's risk only when the period covers all 12 months.";
    if (!$("#tab-wind").hidden) renderWindCharts();
    renderCalibration();
    const t = w.trend, partial = w.annual.some(a => !a.complete);
    $("#trendTag").textContent = t ? `${t.slope >= 0 ? "+" : ""}${fmt(t.slope * 10, 0)} h/decade` : "";
    $("#trendNote").textContent = (t
      ? `Erosive-wind hours per year, ${yl}. Linear trend ${t.slope >= 0 ? "+" : ""}${fmt(t.slope * 10, 0)} hours per decade (${t.significant ? "statistically significant at 95%" : "not statistically significant"} over ${w.completeYears} complete years). Red bars: ≥ 15% above average; gray: ≥ 15% below.`
      : `Erosive-wind hours per year, ${yl}. A trend needs 5 or more complete calendar years (this period has ${w.completeYears}).`)
      + (partial ? " Pale bars are partial years, scaled to a year and left out of the trend." : "");
    const fmtS = v => UN.fmt("wind", v, UN.sym("wind") === "km/h" ? 0 : 1), pr = v => UN.fmt("precip", v, UN.sym("precip") === "in" ? 1 : 0);
    const dpClass = w.dp < 200 ? "low energy" : w.dp < 400 ? "intermediate" : "high energy", rr = w.rdp / Math.max(w.dp, 1e-9);
    const none = `none: no wind ≥ ${thrTxt(w.thr)} in this period`; // no erosive wind, so no direction
    $("#windIdx").innerHTML = [
      ["Mean wind speed (10 m)", fmtS(w.meanSpeed)],
      [w.annualized ? "Erosive-wind hours per year" : "Erosive-wind hours in the months covered (per year)", `${fmt(w.eroHours, 0)} h${w.annualized ? ` (${fmt(w.eroHours / 87.6, 1)}% of time)` : ""}`],
      [`Days ${w.annualized ? "per year" : "in the months covered, per year,"} with gusts ≥ ${thrTxt(17.9)}`, w.gustDays !== null ? fmt(w.gustDays, 0)
        : key === "cal" ? "n/a (the tower records no gusts and no airport could supply them)" : "n/a (MERRA-2 has no gusts)"],
      ["Prevailing erosive wind (from)", w.prevailing === null ? none : `${U.compass(w.prevailing)} (${fmt(w.prevailing, 0)}°)`],
      ["Resultant soil-transport direction (toward)", w.rdd === null ? none : `${U.compass(w.rdd)} (${fmt(w.rdd, 0)}°)`],
      ["Best barrier / strip orientation", w.prevailing === null ? "no erosive wind to set it by" : orientation(w)],
      ["Sand drift potential DP (Fryberger & Dean)", `${fmt(w.dp, 0)} VU · ${dpClass}`],
      ...(w.rddF !== null ? [["Resultant drift RDP / direction", `${fmt(w.rdp, 0)} VU toward ${U.compass(w.rddF)}; RDP/DP ${fmt(rr, 2)} (${rr < 0.3 ? "multidirectional" : rr < 0.8 ? "intermediate" : "unidirectional"})`]] : []),
      ...(w.annualized ? [["FAO wind-erosion climatic index (annual)", `${fmt(w.faoC, 0)} (no fixed top; higher = windier and drier)`]] : []),
      [w.annualized ? "Annual precipitation / ET₀" : "Precipitation / ET₀, months covered", `${pr(w.precip)} / ${pr(w.et0)} (P/ET₀ = ${fmt(w.aridity, 2)})`],
    ].map(([k, v]) => `<span class="k">${esc(k)}</span><span class="v">${esc(v)}</span>`).join("")
      + `<span class="d">${esc(sourceCaveat())}</span>`;
    $("#windSource").innerHTML = `Source: ${windSourceText()} ${esc(yl)}. <button class="link" data-methods="m-site">All sources and equations →</button>`;
  }

  /* The Wind tab without numbers: the series failed to load, or has no usable month in the period. */
  function blankWind(w) {
    const why = w.insufficient ? `Not enough wind data: ${w.error}. Each month is summarised from 20 or more days of hourly wind.`
      : `Wind history could not be loaded: ${w.error}`;
    $("#windSrcTag").textContent = w.insufficient ? "not enough data" : "unavailable";
    $("#moistTag").textContent = "";
    $("#windIdx").innerHTML = `<span class="d">${esc(why)}</span>`;
    $("#roseBox").innerHTML = "";
    $("#roseNote").textContent = "";
    $("#trendTag").textContent = "";
    $("#trendNote").textContent = "";
    $("#calCard").hidden = true;
    $("#windSource").textContent = why;
    Ch.clear(WIND_CHARTS);
  }

  /* ---- provenance: what supplied each piece of data for this site ---- */
  const A = (href, text) => `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;
  const MODEL = {
    ecmwf: { short: "ECMWF", name: "ECMWF IFS 9 km analysis (2017 on) and ERA5 0.25° reanalysis (before 2017)",
      via: `the ${A("https://open-meteo.com/en/docs/historical-weather-api", "Open-Meteo archive")} (a copy of the ECMWF data)` },
    merra2: { short: "MERRA-2", name: "NASA MERRA-2 reanalysis (0.5° × 0.625°)",
      via: `${A("https://power.larc.nasa.gov/docs/services/api/temporal/hourly/", "NASA POWER")} (direct)` },
  };
  const MOIST = {
    gridmet: `gridMET 4 km (University of Idaho), read directly from its ${A("https://www.climatologylab.org/gridmet.html", "THREDDS server")}`,
    "nasa-power": `NASA POWER daily (MERRA-2 weather) with FAO-56 Penman–Monteith ET₀ computed in the app, direct (gridMET did not respond)`,
    "open-meteo": `ECMWF IFS/ERA5 via ${A("https://open-meteo.com/en/docs/historical-weather-api", "Open-Meteo")} (gridMET and NASA POWER did not respond)`,
  };
  const OBS = {
    ncei: `NOAA NCEI ${A("https://www.ncei.noaa.gov/products/global-historical-climatology-network-hourly", "GHCNh")} (direct)`,
    iem: `the ${A("https://mesonet.agron.iastate.edu/request/download.phtml", "Iowa Environmental Mesonet")} ASOS archive`,
    iemhads: `NWS Lubbock's hourly SHEF reports, archived by the ${A("https://mesonet.agron.iastate.edu/request/dcp/fe.phtml", "Iowa Environmental Mesonet")}`,
  };
  const WTM = A("https://www.mesonet.ttu.edu/", "West Texas Mesonet");
  // the airport behind "Airport station only" (the calibration station if no airport is recorded)
  const airportMeta = () => (state.windAirport || state.windStation || {}).meta;
  // "Lubbock Intl Airport, TX (LBB, 21 km away, 99% of hours)"; towers add their years and network
  const stationTxt = s => `${esc(s.name)} (${s.id}, ${UN.fmt("distance", s.km)} away, ${fmt(s.coverage * 100, 0)}% of hours${s.tower ? ` ${s.y0}–${s.y1}` : ""})`
    + `${s.tower ? `, a ${WTM} 10 m tower (Texas Tech),` : ""} from ${OBS[s.obsSource]}`;

  function windSourceText() {
    const model = state.windSets && state.windSets.model, stn = state.windStation && state.windStation.meta, key = state.windKey;
    const ap = airportMeta();
    if (!model) return "";
    const M = MODEL[model.model];
    const grid = `${M.name} via ${M.via}, grid cell ${fmt(model.lat, 3)}, ${fmt(model.lon, 3)}${model.fellBack ? " (the other model did not respond)" : ""}`;
    const moist = `Precipitation, grass reference ET₀ and temperature: ${MOIST[model.moisture.source]}.`;
    if (key === "cal") {
      const g = state.windRaw.gustStation;
      const gust = !stn.tower ? "" : g ? `; daily gusts calibrated to ${esc(g.name)} (${g.id}, ${UN.fmt("distance", g.km)} away), because the tower records no gusts` : "; no gusts (the tower records none and no airport could supply them)";
      return `hourly 10 m wind from ${grid}, calibrated month by month (quantile mapping) to hourly observations at ${stationTxt(stn)}${gust}. ${moist}`;
    }
    if (key === "station") return `hourly airport observations (2-minute mean wind at 10 m) at ${stationTxt(ap)}. ${moist}`;
    return `hourly 10 m wind from ${grid}. Not calibrated. ${moist}`;
  }

  /* Rows for the "This location" table of the Methods sheet. */
  function siteSources() {
    const s = state.soil, model = state.windSets && state.windSets.model, stn = state.windStation && state.windStation.meta;
    const cf = cFactor(), e = state.elev;
    const rows = [];
    if (model) {
      const M = MODEL[model.model];
      rows.push(["Hourly wind (gridded)", `${M.name}, cell ${fmt(model.lat, 3)}, ${fmt(model.lon, 3)}`, M.via + (model.fellBack ? "; automatic fallback" : "")]);
      const ap = state.windAirport && state.windAirport.meta, tw = stn && stn.tower ? stn : null;
      rows.push(["Airport observations", ap ? `${esc(ap.name)} (${ap.id}), ${UN.fmt("distance", ap.km)}, ${fmt(ap.coverage * 100, 0)}% of hours` : state.windStationPending ? "loading…" : `none within ${UN.fmt("distance", 150)}`, ap ? OBS[ap.obsSource] : ""]);
      if (tw || state.windTower) rows.push(["West Texas Mesonet tower", tw ? `${esc(tw.name)} (${tw.id}), ${UN.fmt("distance", tw.km)}, ${fmt(tw.coverage * 100, 0)}% of hours ${tw.y0}–${tw.y1}; ${checkTxt(tw)}` : "loading…",
        tw ? `${OBS[tw.obsSource]}; ${WTM} data policy: public use needs the mesonet's permission` : ""]);
      const skipped = state.windSkipped.filter(s => !stn || s.id !== stn.id), g = (state.windSets.cal || {}).gustStation;
      if (skipped.length) rows.push(["Towers not used", skipped.map(s => `${esc(s.name)} (${s.id}), ${UN.fmt("distance", s.km)}: ${skipTxt(s)}`).join("; "), "exposure check"]);
      rows.push(["Wind used for results", { cal: tw ? (g ? `Calibrated to the tower (gusts to ${g.id})` : "Calibrated to the tower (no gusts)") : "Calibrated to the airport", station: "Airport station only", model: "Gridded model only" }[state.windKey] || "—", ""]);
      rows.push(["Precipitation, ET₀, temperature", `${{ gridmet: "gridMET 4 km", "open-meteo": "ECMWF IFS/ERA5", "nasa-power": "NASA POWER MERRA-2" }[model.moisture.source]}, cell ${fmt(model.moisture.lat, 3)}, ${fmt(model.moisture.lon, 3)}`, MOIST[model.moisture.source]]);
    }
    if (s && !s.error) rows.push(["Soil profile, WEG, I, T", `SSURGO map unit ${esc(String(s.mukey))}${s.dominant ? `, ${esc(s.dominant.compname)}` : ""} (${esc(s.mapunit.areasymbol || "")})`, `USDA-NRCS ${A("https://sdmdataaccess.nrcs.usda.gov/", "Soil Data Access")} (direct)`]);
    if (cf) rows.push(["Climatic factor C", `${cf.src.startsWith("NRCS") ? "" : "≈ "}${fmtC(cf.C)}`, cf.how]);
    if (e) rows.push(["Elevation and slope", `${UN.fmt("elev", e.z)}, ${fmt(e.slope, 1)}% slope`, e.src.startsWith("USGS") ? `${e.src}, ${A("https://apps.nationalmap.gov/epqs/", "Elevation Point Query Service")} (direct)` : `${e.src} via Open-Meteo (USGS did not respond)`]);
    if (state.nlcd) rows.push(["Land cover", state.nlcd.name || "no answer", state.nlcd.src === "nlcd" ? `NLCD 2021, ${A("https://www.mrlc.gov/", "MRLC")} WMS (direct)`
      : state.nlcd.src === "io" ? `Sentinel-2 10 m land cover, ${A("https://livingatlas.arcgis.com/landcover/", "Impact Observatory, Microsoft, Esri")} (NLCD server refuses browser requests)`
        : "neither NLCD nor the Sentinel-2 land-cover service answered"]);
    return rows;
  }
  WG.siteSources = siteSources;

  function sourceCaveat() {
    const stn = state.windStation && state.windStation.meta;
    const ap = airportMeta(), x = stn && stn.tower && stn.exposure;
    const ground = !stn || !stn.tower ? "Airport winds are measured on open ground, so sheltered sites blow less."
      : !x ? "The tower was not checked against an airport, and sheltered towers read low."
        : x.ero < Wd.EXPOSURE_MIN ? "This tower reads low against the airport and may be sheltered, so these values may be low."
          : "The tower reads like the airport, on open ground, so sheltered sites blow less.";
    if (state.windKey === "cal") return `Speeds follow the measured distribution at ${stn.id} for each month; timing and direction come from the reanalysis at this point. ${ground}`;
    if (state.windKey === "station") return `Measured at the ${ap.id} airport, ${UN.fmt("distance", ap.km)} away; local terrain and surface can differ from this field.`;
    if (state.windStationPending) return "Calibrating to the nearest airport station…";
    const merra = state.windSets && state.windSets.model && state.windSets.model.model === "merra2";
    return (merra ? "Uncalibrated MERRA-2: at Lubbock it caught ~58% of the airport's erosive hours." : "Uncalibrated ECMWF: at Lubbock and Midland it caught only ~35–45% of erosive hours and shifted the peak months earlier.")
      + (state.windStation ? "" : ` No airport station with enough data within ${UN.fmt("distance", 150)}.`);
  }

  function renderCalibration() {
    const card = $("#calCard");
    const c = state.windCompare, st = state.windStation, all = state.windAll || {};
    const tw = state.windTower;
    card.classList.toggle("waiting", !st || !c); // only the message below: the stations, chart and table come with the comparison
    if (!st || !c) {
      card.hidden = !state.windStationPending && !tw;
      $("#calKv").innerHTML = `<span class="k">${tw && !state.windStationPending ? `Reading the ${esc(tw.id)} mesonet tower…` : "Looking for the nearest airport station…"}</span><span class="v"></span>`;
      return;
    }
    card.hidden = false;
    const m = st.meta, ap = state.windAirport && state.windAirport.meta, g = (state.windSets.cal || {}).gustStation;
    const skipped = state.windSkipped.filter(s => s.id !== m.id); // a skipped tower the user then picked is the station
    const cands = Wd.nearestStations(state.site.lat, state.site.lon, state.windPeriod);
    const want = state.windStationPending && state.windStationChoice ? cands.find(c => c.id === state.windStationChoice) : null; // picked, still loading
    $("#stnSel").innerHTML = cands.map(c => `<option value="${esc(c.id)}" ${c.id === (want || m).id ? "selected" : ""}>${esc(c.id)} · ${esc(c.name.replace(/,.*$/, ""))} · ${UN.fmt("distance", c.km)}${c.awos ? " · AWOS" : c.tower ? " · mesonet tower" : ""}</option>`).join("");
    const sp = v => UN.fmt("wind", v, UN.sym("wind") === "m/s" ? 2 : 1);
    const tm = a => (!a ? "—" : a.error ? "too little data" : !a.annualized ? "not ranked" : WG.monthsText(a.riskMonths) || "—");
    $("#calKv").innerHTML = [
      ["Station", `${m.name} (${m.id}${m.awos ? ", AWOS" : ""})${m.tower ? " · West Texas Mesonet 10 m tower" : ""}`],
      ["Distance · data coverage", `${UN.fmt("distance", m.km)} · ${fmt(m.coverage * 100, 0)}% of hours${m.tower ? `, ${m.y0}–${m.y1}` : ""}`],
      ...(m.tower ? [["Gusts", g ? `from ${g.name.replace(/,.*$/, "")} (${g.id}), ${UN.fmt("distance", g.km)}: the tower records none`
        : ap ? `none: the tower records none and ${ap.id} has no model series to map them` : `none: the tower records none and no airport within ${UN.fmt("distance", 150)} has them`]] : []),
      ...(m.tower ? [["Exposure vs airport", checkTxt(m)]] : []),
      ...(skipped.length ? [["Towers not used", skipped.map(s => `${s.id}, ${UN.fmt("distance", s.km)}: ${skipTxt(s)}`).join("; ")]] : []),
      ...(tw ? [["Mesonet tower ranked ahead", `${tw.id}, ${UN.fmt("distance", tw.km)}: reading its last ${Wd.TOWER_YEARS} years (about a minute)`]] : []),
      ...(want ? [["Loading", `${want.id}, ${UN.fmt("distance", want.km)}${want.tower ? `: reading its last ${Wd.TOWER_YEARS} years (about a minute)` : "…"}`]] : []),
      ["Mean wind: station vs model", `${sp(c.meanObs)} vs ${sp(c.meanMod)} (${c.bias >= 0 ? "+" : ""}${fmt((c.bias / c.meanObs) * 100, 0)}%)`],
      ["Hourly agreement", `r = ${fmt(c.r, 2)}, RMSE ${sp(c.rmse)}`],
      ["Erosive hours caught by model", `${fmt((c.freqMod / Math.max(c.freqObs, 1e-9)) * 100, 0)}% (${fmt(c.freqMod * 100, 1)}% vs ${fmt(c.freqObs * 100, 1)}% of hours)`],
      state.wind.annualized ? [`High-risk months: ${ap ? `${ap.id} airport` : "station"} / model / calibrated`, `${tm(all.station)} / ${tm(all.model)} / ${tm(all.cal)}`]
        : ["High-risk months", "not ranked: the period covers part of a year"],
    ].map(([k, v]) => `<span class="k">${esc(k)}</span><span class="v">${esc(v)}</span>`).join("");
    if (!$("#tab-wind").hidden) Ch.calib(all, ap && `${ap.id} airport`);
  }

  const pctOff = x => `${x >= 1 ? "+" : "−"}${fmt(Math.abs(x - 1) * 100, 0)}%`; // 0.79 -> "−21%"
  // "−49% erosive hours, −21% mean wind against LBB, relative to the model"
  const expTxt = s => `${pctOff(s.exposure.ero)} erosive hours, ${pctOff(s.exposure.mean)} mean wind against ${s.expAp}, relative to the model`;
  const checkTxt = s => s.exposure ? `${expTxt(s)}${s.exposure.ero < Wd.EXPOSURE_MIN ? ": reads low, probably sheltered" : ""}`
    : s.expAp ? `not checked: could not be compared with ${s.expAp}` : `not checked: no airport within ${UN.fmt("distance", 150)}`;
  const skipTxt = s => s.exposure ? `${expTxt(s)} (probably sheltered)` : `could not be compared with ${s.expAp}`;

  function orientation(w) {
    // barriers/strips should run perpendicular to the prevailing erosive wind (callers check that there is one)
    const perp = (w.prevailing + 90) % 180;
    const a = U.compass(perp), b = U.compass(perp + 180);
    return `${a}–${b} rows (perpendicular to ${U.compass(w.prevailing)} winds${w.annualized ? "" : " in the months covered"})`;
  }
  WG.orientation = orientation;

  function renderWindCharts() {
    const w = state.wind;
    if (!w || w.error) return;
    Ch.season(w);
    Ch.speeds(w);
    Ch.water(w);
    Ch.trend(w);
    Ch.rose($("#roseBox"), w);
    if (state.windAll && (state.windAll.station || state.windCompare)) Ch.calib(state.windAll, state.windAirport && `${state.windAirport.meta.id} airport`);
    const tot = w.rose.reduce((a, r) => a + r.bins.reduce((x, y) => x + y, 0), 0);
    $("#roseNote").textContent = w.prevailing === null ? `No wind at or above ${thrTxt(w.thr)} in this period, so no erosive wind rose.`
      : `Erosive winds blow ${fmt(tot, 1)}% of the time, mostly from the ${U.compass(w.prevailing)}.${w.rdd === null ? "" : ` Soil moves toward the ${U.compass(w.rdd)}.`}`;
  }

  $("#unitSel").addEventListener("change", e => UN.set("wind", e.target.value)); // shortcut for the wind row of the units table
  $("#thrRange").addEventListener("input", U.debounce(e => {
    state.thr = +e.target.value;
    if (state.windSets) { chooseWind(); renderWind(); renderStats(); renderRisk(); renderPractices(); }
    $("#thrVal").textContent = thrTxt(state.thr);
  }, 120));
  $("#srcSel").addEventListener("change", e => {
    state.windSource = e.target.value;
    if (state.windSets) { chooseWind(); renderWind(); renderStats(); renderRisk(); renderPractices(); }
  });
  /* Period: presets, or custom dates within the chosen model's record (MERRA-2 from 2001, ECMWF from 1979). */
  const otherModel = m => (m === "ecmwf" ? "merra2" : "ecmwf");
  const recordTxt = m => { const L = Wd.limits(m); return `${MODEL[m].short} record (${Wd.dayLabel(L.first)} – ${Wd.dayLabel(L.last)})`; };
  /* Why custom dates p ({from, to}) cannot be analysed with model m, or "". In this order: both are calendar dates (a
     link typed by hand may hold 2024-02-30), the start comes first, the dates span 30 days or more, 30 of them are
     inside the model's record, and 20 or more fall in one calendar month (analyze() summarises a month only from 20
     days of hourly wind). */
  function periodIssue(p, m) {
    if (!p.from) return "";
    const real = s => { const t = new Date(`${s}T00:00:00Z`); return !Number.isNaN(+t) && t.toISOString().slice(0, 10) === s; }; // any year, also 0024
    const bad = [p.from, p.to].find(s => !real(s));
    if (bad) return `${bad} is not a calendar date.`;
    const n = Wd.parseDay(p.to) - Wd.parseDay(p.from) + 1, P = Wd.resolvePeriod(p, m);
    if (n < 1) return "The start date is after the end date.";
    if (n < 30) return `These dates cover ${n} day${n > 1 ? "s" : ""}: choose at least 30.`;
    if (P.overlap < 30) return `${P.overlap > 0 ? `Only ${P.overlap} of these days ${P.overlap > 1 ? "are" : "is"}` : "These dates are not"} in the ${recordTxt(m)}: choose at least 30 days inside it.`;
    if (P.monthDays < 20) return "These dates have no calendar month with 20 or more days, and a month is summarised only from 20 days of hourly wind or more: include at least 20 days of one month (for example 1–20 March).";
    return "";
  }
  const movedTxt = (P, m) => `The days outside the ${recordTxt(m)} were left out: ${P.label}.`;
  // dates are checked against the model the select shows: after a fallback that is the one that answered, not state.gridModel
  const shownModel = () => $("#modelSel").value;
  function syncPeriodUI(choosing = false) { // choosing: "Custom dates…" picked, dates not applied yet
    const m = shownModel(), L = Wd.limits(m), custom = !!state.period.from || choosing;
    $("#periodSel").value = custom ? "custom" : String(state.period.n);
    $("#periodCustom").hidden = !custom;
    ["#periodFrom", "#periodTo"].forEach(s => { $(s).min = Wd.isoDay(L.first); $(s).max = Wd.isoDay(L.last); });
    // applied custom dates are shown; otherwise the inputs keep what was typed, and empty ones start at the preset's dates
    const P = state.period.from ? state.period : Wd.resolvePeriod(state.period, m);
    if (state.period.from || !$("#periodFrom").value) $("#periodFrom").value = P.from;
    if (state.period.from || !$("#periodTo").value) $("#periodTo").value = P.to;
    $("#periodLimits").textContent = `${m === "ecmwf" ? "ECMWF" : "NASA MERRA-2"}: ${Wd.dayLabel(L.first)} – ${Wd.dayLabel(L.last)}`;
  }
  function reloadWind() {
    if (!state.site) return;
    // the old period's series go: nothing re-analyses them or labels them with the new period while it loads
    Object.assign(state, { wind: null, windRaw: null, windSets: null, windAll: null, windCompare: null, windStation: null, windAirport: null, windTower: null, windSkipped: [] });
    clearWind();
    const { lat, lon } = state.site;
    try { history.replaceState(null, "", `?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}${windQ()}${UN.query()}${KEEP_Q}`); } catch (e) { /* file:// */ }
    loadWind(state.token);
  }
  $("#periodSel").addEventListener("change", e => {
    if (e.target.value === "custom") { syncPeriodUI(true); $("#periodFrom").focus(); return; }
    if (!state.period.from && state.period.n === +e.target.value) return syncPeriodUI(); // same preset: just close the date row
    state.period = { n: +e.target.value };
    syncPeriodUI();
    reloadWind();
  });
  $("#periodApply").addEventListener("click", () => {
    const a = $("#periodFrom").value, b = $("#periodTo").value, m = shownModel(), alt = otherModel(m);
    if (!a || !b) return U.toast("Choose a start and an end date.");
    const p = { from: a, to: b }, why = periodIssue(p, m);
    if (why) return U.toast(why + (periodIssue(p, alt) ? "" : ` The ${recordTxt(alt)} holds them.`), 8000);
    const P = Wd.resolvePeriod(p, m);
    if (P.moved) U.toast(movedTxt(P, m), 5000);
    state.gridModel = m; // the model they were checked against is the one to read them with
    state.period = { from: P.from, to: P.to }; // the dates analysed, which the inputs and the address then show
    syncPeriodUI();
    reloadWind();
  });
  $("#modelSel").addEventListener("change", e => {
    const m = e.target.value;
    if (state.period.from) { // custom dates: the new model must hold them
      const P = Wd.resolvePeriod(state.period, m), why = periodIssue(state.period, m);
      if (why) {
        e.target.value = otherModel(m); // what it showed: two models, and a change event means it held the other
        return U.toast(`${MODEL[m].short} not chosen. ${why}`, 8000);
      }
      if (P.moved) { U.toast(movedTxt(P, m), 5000); state.period = { from: P.from, to: P.to }; }
    }
    state.gridModel = m;
    syncPeriodUI(!$("#periodCustom").hidden);
    reloadWind();
  });
  // dates in a link that its model cannot serve (a link made before the model was kept in it, or typed by hand):
  // the other model when it can, else the last 10 years
  if (state.period.from) {
    const m = state.gridModel, alt = otherModel(m), why = periodIssue(state.period, m);
    if (why && !periodIssue(state.period, alt)) { state.gridModel = alt; U.toast(`The ${recordTxt(m)} cannot serve these dates, so ${MODEL[alt].short} is used.`, 6000); }
    else if (why) { U.toast(`${why} The last 10 years are shown instead.`, 8000); state.period = { n: 10 }; }
    const P = Wd.resolvePeriod(state.period, state.gridModel);
    if (P.moved) state.period = { from: P.from, to: P.to };
  }
  $("#modelSel").value = state.gridModel;
  syncPeriodUI();

  /* ============ SOIL TAB ============
     Wind erosion › Soil holds only what sets the wind erodibility: the dominant soil with its WEG, I and surface
     texture, the surface layer to edit and what it gives, and the WEG classes. The rest of the profile is in the Soil maps
     theme's Soil tab (renderSoilDetail), drawn from the same survey read. */
  // the surface layer's inputs: sand to CaCO3 on Wind erosion › Soil; pH, which does not set the erodibility, in the Soil
  // maps theme's Soil tab, which js/soilmaps.js draws only when shown: until then its value is the edit's or the survey's
  const EDIT_INPUTS = "#soilEdit input, #soilEditPh input";
  const EDIT_KEY = { inSand: "sand", inSilt: "silt", inClay: "clay", inOm: "om", inCaco3: "caco3", inPh: "ph" };
  let phHold; // Wind erosion › Soil's reset keeps a pH edit, though the pH box may not be drawn
  function phNow() {
    if (phHold !== undefined) return phHold;
    const i = $("#inPh");
    if (i) return i.value === "" ? null : +i.value;
    return state.edits ? state.edits.ph ?? null : (state.soil && state.soil.surface ? state.soil.surface.ph ?? null : null);
  }
  function renderSoil() {
    const s = state.soil;
    // no survey soil: the same message on the erosion Overview and Wind erosion › Soil; the Soil tab's is renderSoilDetail's
    const say = msg => { ["#soilSummary", "#ovSoil"].forEach(id => { $(id).innerHTML = `<p class="fine">${msg}</p>`; }); renderSoilDetail(); };
    if (!s || s.error) return say(s && s.error ? `Soil survey request failed: ${esc(s.error)}` : "No soil survey map unit at this point.");
    const d = s.dominant;
    if (!d) return say(`Map unit ${esc(s.mapunit.muname)} has no component data.`);
    const surf = s.surface;
    if (surf) {
      $("#inSand").value = surf.sand ?? "";
      $("#inSilt").value = surf.silt ?? "";
      $("#inClay").value = surf.clay ?? "";
      $("#inOm").value = surf.om ?? "";
      $("#inCaco3").value = surf.caco3 ?? 0;
      if ($("#inPh")) $("#inPh").value = surf.ph ?? "";
    }
    renderSoilSummary();
    renderSoilDetail();
  }

  function renderSoilSummary() {
    const s = state.soil;
    if (!s || s.error || !s.dominant) return;
    const d = s.dominant, surf = currentSurface();
    const tex = surf ? (surf.texName || S.TEX[surf.texCode] || surf.texCode) : "—";
    // the erodibility chips, here and on the erosion Overview's soil card; the profile's own are in the Soil maps theme's Soil tab
    const chips = [
      surf && surf.weg ? `<span class="chip ${surf.wei >= 86 ? "warn" : surf.wei <= 38 ? "ok" : ""}" title="Wind Erodibility Group: nine classes from 1 (most erodible) to 8 (not erodible), with 4L between 4 and 5">WEG ${esc(surf.weg)} · I ${esc(UN.fmt("soilLoss", surf.wei, 0))}${surf.calc ? " (from your values)" : ""}</span>` : "",
      tex ? `<span class="chip">Surface: ${esc(tex)}</span>` : "",
    ].join("");
    $("#soilSummary").innerHTML = `<div><div class="nm">${esc(d.compname)} <span style="font-weight:500;color:#69716a;font-size:13px">${fmt(d.comppct_r, 0)}% of map unit</span></div>
      <div class="sub">${esc(s.mapunit.muname || "")}</div></div>
      <div class="chips">${chips}</div>
      ${!s.dominantIsTop ? `<p class="fine">Largest component (${esc(s.components[0].compname)}) has no horizon data; showing the largest soil component.</p>` : ""}
      <p class="fine">Horizons, chemistry, classification, site parameters and the map unit's other soils: <button class="link" data-goto="soilmaps" data-goto-theme="soilmaps" data-so-go="#smHz">Soil maps › Soil →</button></p>`;
    $("#ovSoil").innerHTML = `<div class="nm">${esc(d.compname)} ${tex ? "· " + esc(tex) : ""}</div><div class="sub">${esc(s.mapunit.muname || "")}</div><div class="chips">${chips}</div>`;
    $("#soilSrcTag").textContent = `SSURGO · ${s.mapunit.areasymbol || ""}`;
    renderWegTable(surf);
    $("#soilSource").innerHTML = `Source: USDA-NRCS Soil Survey Geographic Database (SSURGO) via <a href="https://sdmdataaccess.nrcs.usda.gov/" target="_blank" rel="noopener">Soil Data Access</a>, map unit key ${s.mukey}, ${esc(s.mapunit.areaname || "")}${s.mapunit.saverest ? `, survey dated ${esc(String(s.mapunit.saverest).split(/[ T]/)[0])}` : ""}. Groups for edited values: NRCS National Soil Survey Handbook §618.93; RWEQ factors: Fryrear et al. (1994, 1998). <button class="link" data-methods="m-erod">Equations →</button>`;
    renderDerived();
  }

  function renderDerived() {
    const s = state.soil;
    if (!s || !s.surface) return;
    const surf = currentSurface(), base = s.surface;
    // what sets the wind erodibility; the layer's water retention is in the Soil maps › Soil tab's horizons (survey
    // values, or Saxton & Rawls once sand, silt, clay or OM is edited)
    const ch = (a, b) => (state.edits && a !== b ? "chg" : "");
    const cells = [
      ["Texture class", surf.texName || S.TEX[surf.texCode] || "—", ch(surf.texCode, base.texCode)],
      ["Wind erodibility group (1 most – 8 least)", surf.weg || "—", ch(surf.weg, base.weg)],
      [`Erodibility index I (${UN.range("soilLoss", 0, 310, 0)})`, surf.wei !== null ? UN.both("soilLoss", surf.wei, 0) : "—", ch(surf.wei, base.wei)],
    ];
    const rw = S.rweq(surf), rw0 = S.rweq(base);
    if (rw) cells.push(
      ["RWEQ erodible fraction EF (more = blows easier)", `${fmt(rw.ef * 100, 0)}% < 0.84 mm${rw.inRange ? "" : " *"}`, ch(rw.ef.toFixed(3), rw0 && rw0.ef.toFixed(3)), "EF: the share of the surface soil in clods and grains finer than 0.84 mm, which wind can lift; more blows more easily (typically 20–80%)."],
      ["RWEQ crust factor SCF (1 = no crust, 0 = full crust)", `${fmt(rw.scf, 2)}${rw.inRange ? "" : " *"}`, ch(rw.scf.toFixed(3), rw0 && rw0.scf.toFixed(3)), "SCF: 1 = no crust, 0 = a crust that fully protects the soil; clay and lime crusts lower it. 0.80 means the crust takes little off."]);
    $("#soilDerived").innerHTML = cells.map(([k, v, c, t]) => `<div><span${t ? ` title="${esc(t)}"` : ""}>${esc(k)}</span><b class="${c}">${esc(v)}</b></div>`).join("")
      + (surf.calc ? `<div style="grid-column:1/-1"><span>WEG rule applied</span><b>${esc(surf.calc.why)}</b></div>` : "")
      + (surf.kept ? `<div style="grid-column:1/-1"><span>Wind erodibility group</span><b>The survey's group is kept: your values give the same texture-rule result as the survey's.</b></div>` : "")
      + (rw && !rw.inRange ? `<div style="grid-column:1/-1"><span>* RWEQ check</span><b>This soil is outside the range of soils the RWEQ equations were fitted to; read EF and SCF as rough.</b></div>` : "");
  }

  /* All nine groups with this soil's row marked (surf null: the plain table). */
  function renderWegTable(surf) {
    const g = surf && surf.weg;
    $("#wegTag").textContent = g ? `this soil: WEG ${g}` : "";
    const here = g ? `<span class="here">this soil${surf.texName ? `: ${esc(surf.texName)}` : ""}</span>` : "";
    const iTxt = I => String(I).replace(/\d+/g, n => UN.num("soilLoss", +n, 0)); // "160–310" in the chosen unit
    $("#wegTable").innerHTML = `<thead><tr><th>WEG</th><th class="l">Texture guide</th><th>I<small>${esc(UN.sym("soilLoss"))}</small></th></tr></thead><tbody>`
      + S.WEG_INFO.map(w => `<tr class="${w.g === g ? "on" : ""}"><td><b>${w.g}</b></td><td class="l"><b>${esc(w.name)}</b>${w.g === g ? ` ${here}` : ""}<span class="def">${esc(w.def)}</span></td><td>${iTxt(w.I)}</td></tr>`).join("")
      + "</tbody>";
  }

  $("#wegFull").addEventListener("click", e => {
    const full = $("#wegTable").classList.toggle("full");
    e.target.textContent = !full ? "Show all definitions" : $("#wegTable tr.on") ? "Show only this soil's definition" : "Hide definitions";
  });

  function onSoilEdit(e) {
    const s = state.soil;
    if (!s || !s.surface) return;
    const g = id => { const v = $("#" + id).value; return v === "" ? null : +v; };
    let sand = g("inSand"), silt = g("inSilt"), clay = g("inClay");
    if (e && (e.target.id === "inSand" || e.target.id === "inClay") && sand !== null && clay !== null) {
      silt = Math.max(0, +(100 - sand - clay).toFixed(1));
      $("#inSilt").value = silt;
    }
    if (sand !== null && clay !== null && silt !== null && Math.abs(sand + silt + clay - 100) > 1.5) {
      U.toast(`Sand + silt + clay = ${fmt(sand + silt + clay, 0)}%. Adjust so they add to 100.`);
    }
    const ed = { sand, silt, clay, om: g("inOm"), caco3: g("inCaco3") ?? 0, ph: phNow() };
    const b = s.surface;
    const same = Object.values(EDIT_KEY).every(k => (ed[k] ?? null) === (b[k] ?? (k === "caco3" ? 0 : null)));
    state.edits = same ? null : ed;
    $$(EDIT_INPUTS).forEach(i => {
      const k = EDIT_KEY[i.id];
      i.classList.toggle("edited", !!state.edits && (ed[k] ?? null) !== (b[k] ?? (k === "caco3" ? 0 : null)));
    });
    // each reset shows when it has something to undo: Wind erosion › Soil's its five values, the pH box's any edit
    $("#tab-soil .reset-soil").hidden = !erodEdited();
    if ($("#profPh .reset-soil")) $("#profPh .reset-soil").hidden = !state.edits;
    renderSoilSummary(); renderSoilDetail(); renderRisk(); renderStats(); renderPractices();
    document.dispatchEvent(new Event("wg-soil"));
  }
  // the pH box is drawn with the Soil tab, after this has run: its input and reset are listened to here, on the page
  document.addEventListener("change", e => { if (e.target.matches && e.target.matches(EDIT_INPUTS)) onSoilEdit(e); });
  // Wind erosion › Soil's reset: its five values back to the survey's, a pH edit kept; the pH box's: every edit
  document.addEventListener("click", e => {
    const r = e.target.closest && e.target.closest(".reset-soil");
    if (!r) return;
    phHold = r.closest("#tab-soil") ? phNow() : undefined;
    state.edits = null; renderSoil();
    if (phHold !== undefined && $("#inPh")) $("#inPh").value = phHold ?? "";
    onSoilEdit();
    phHold = undefined;
  });

  /* ============ THE DOMINANT SOIL IN THE SOIL MAPS THEME'S SOIL TAB ============
     The dominant soil, the physical and water view of its horizons, the pH box, its classification and site parameters,
     the map unit's components, yields and plants: from the survey read for the wind erosion (state.soil), no request of
     its own. js/soilmaps.js draws the tab with a box for each (hooks.profile calls this once it has), and the chemistry
     view of the horizons beside them; drawn again when the surface edits, the elevation or the units change. */
  function renderSoilDetail() {
    const s = state.soil, box = $("#profHz"), more = $("#profMore"), phBox = $("#profPh");
    if (!box || !$("#profSoil")) return; // the Soil tab not drawn for this page yet
    if (!s) return; // read: the tab's boxes keep their "reading" lines
    if (s.error || !s.dominant) {
      const msg = s.error ? `Soil survey request failed: ${esc(s.error)}` : s.mapunit ? `Map unit ${esc(s.mapunit.muname || "")} has no component data.` : "No soil survey map unit at this point.";
      $("#profSoil").innerHTML = `<p class="fine">${msg}</p>`;
      box.innerHTML = `<p class="fine">No horizons of a dominant soil here; the survey's chemistry by horizon, where it has one, is in the Chemistry view.</p>`;
      if (more) more.innerHTML = ""; if (phBox) phBox.innerHTML = ""; if ($("#profSource")) $("#profSource").innerHTML = "";
      return;
    }
    const d = s.dominant, surf = currentSurface();
    const layers = S.profileLayers(d, state.edits ? { sand: surf.sand, silt: surf.silt, clay: surf.clay, om: surf.om, ph: surf.ph, caco3: surf.caco3 } : null);
    const site = S.siteParams(s, d, surf);
    const f = (v, n) => (v === null || v === undefined ? "—" : fmt(v, n));
    // the dominant soil and what the site is; its erodibility chips (WEG, I, surface texture) are Wind erosion › Soil's
    const others = s.components.filter(c => c.cokey !== d.cokey && c.comppct_r >= 5);
    const chips = [
      site.slope !== null ? `<span class="chip">Slope ${fmt(site.slope, 1)}%</span>` : "",
      site.drainage ? `<span class="chip">${esc(site.drainage)}</span>` : "",
      site.hydgrp ? `<span class="chip">Hydrologic group ${esc(site.hydgrp)}</span>` : "",
      site.depth ? `<span class="chip">${site.restriction ? `${esc(site.restriction.kind)} at ${UN.fmt("depth", site.restriction.depth)}` : `Deep (> ${UN.fmt("depth", site.depth)})`}</span>` : "",
      d.eco ? `<span class="chip">${esc(d.eco.ecoclassname)}</span>` : "",
      s.mlra ? `<span class="chip">MLRA ${esc(s.mlra.sym)} · ${esc(s.mlra.name)}</span>` : "",
    ].join("");
    $("#profSoil").innerHTML = `<div><div class="nm">${esc(d.compname)} <span style="font-weight:500;color:#69716a;font-size:13px">${fmt(d.comppct_r, 0)}% of map unit</span></div>
      <div class="sub">${esc(s.mapunit.muname || "")}</div>
      <div class="sub">${esc(d.taxclname || "")}</div></div>
      ${chips ? `<div class="chips">${chips}</div>` : ""}
      ${!s.dominantIsTop ? `<p class="fine">Largest component (${esc(s.components[0].compname)}) has no horizon data; showing the largest soil component.</p>` : ""}
      ${others.length ? `<p class="fine">Also in this map unit: ${others.map(c => `${esc(c.compname)} ${fmt(c.comppct_r, 0)}%`).join(" · ")}</p>` : ""}`;
    $("#profSrcTag").textContent = `SSURGO · ${s.mapunit.areasymbol || ""}`;
    // the physical and water view of the horizons; pH, CEC, OM, carbonates, salts and N are its Chemistry view (js/soilmaps.js)
    const cols = [
      ["Horizon", l => esc(l.hz) + (l.edited ? " ✎" : ""), ""], ["Depth", l => `${UN.num("depth", l.top)}–${UN.num("depth", l.bot)}`, UN.sym("depth")],
      ["Texture", l => esc(l.texture), ""], ["Sand", l => f(l.sand, 1), "%"], ["Silt", l => f(l.silt, 1), "%"],
      ["Clay", l => f(l.clay, 1), "%"], ["V.f. sand", l => f(l.vfs, 1), "%"], ["Coarse frag.", l => f(l.cf, 0), "%"], ["Bulk dens.", l => f(l.bd, 2), "g/cm³"], ["LL 15 bar", l => f(l.ll, 3), "cm³/cm³"],
      ["DUL ⅓ bar", l => f(l.dul, 3), "cm³/cm³"], ["Saturation", l => f(l.sat, 3), "cm³/cm³"], ["AWC", l => (l.awc === null || l.awc === undefined ? "—" : UN.num("awc", l.awc, ["mm/m"].includes(UN.sym("awc")) ? 0 : 3)), UN.sym("awc")],
      ["Ksat", l => (l.ksat === null || l.ksat === undefined ? "—" : UN.num("ksat", l.ksat / 0.36)), UN.sym("ksat")], ["Kw", l => f(l.kw, 2), ""], ["Root growth", l => f(l.srgf, 2), "factor"],
    ];
    const table = `<div class="table-wrap"><table class="grid"><thead><tr>${cols.map(c => `<th>${c[0]}${c[2] ? `<small>${c[2]}</small>` : ""}</th>`).join("")}</tr></thead>
      <tbody>${layers.map(l => `<tr>${cols.map((c, i) => `<td class="${i === 2 ? "l" : ""}">${c[1](l)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    const P = (k, v) => `<div><span>${esc(k)}</span><b>${v}</b></div>`;
    const e = state.elev;
    const params = [
      P("Soil order", esc(d.taxorder || "—")), P("Great group", esc(d.taxgrtgroup || "—")), P("Subgroup", esc(d.taxsubgrp || "—")),
      P("Particle-size class", esc(d.taxpartsize || "—")), P("Temperature regime", esc(d.taxtempregime || "—")), P("Moisture subclass", esc(d.taxmoistscl || "—")),
      P("Slope (survey)", site.slope !== null ? `${fmt(site.slope, 1)}% (${f(site.slopeRange[0], 0)}–${f(site.slopeRange[1], 0)})` : "—"),
      P("Slope (DEM, ±100 m)", e ? `${fmt(e.slope, 1)}%, facing ${U.compass(e.aspect)} · ${esc(e.src)}` : "—"),
      P("Elevation", e ? UN.fmt("elev", e.z) : (d.elev_r ? UN.fmt("elev", d.elev_r) : "—")),
      P("Soil depth", site.depth ? UN.fmt("depth", site.depth) : "—"),
      P("Restrictive layer", site.restriction ? `${esc(site.restriction.kind)} at ${UN.fmt("depth", site.restriction.depth)}` : "none reported"),
      P("Drainage class", esc(site.drainage || "—")), P("Hydrologic group", esc(site.hydgrp || "—")), P("Surface runoff", esc(site.runoff || "—")),
      P("Dry albedo", f(site.albedo, 2)), P("Stage-1 evaporation limit", site.u !== null && site.u !== undefined ? UN.fmt("waterDepth", site.u) : "—"), P("Drainage rate", site.drainRate !== null ? `${f(site.drainRate, 2)} /day` : "—"),
      P("Runoff curve number", f(site.cn, 0)), P(`Avail. water 0–${UN.fmt("depth", 150)}`, site.aws150 !== null ? UN.fmt("waterDepth", site.aws150 * 10) : "—"),
      P("T factor (tolerable loss)", site.tfact !== null ? UN.fmt("soilLoss", site.tfact, UN.sym("soilLoss") === "t/ha/yr" ? 1 : 0) : "—"), P("Kw (surface)", f(site.kw, 2)),
      P(`WEG / I (${UN.range("soilLoss", 0, 310, 0)})`, surf ? `${esc(surf.weg || "—")} / ${surf.wei !== null && surf.wei !== undefined ? esc(UN.fmt("soilLoss", surf.wei, 0)) : "—"}` : "—"),
      P("Capability class (dry / irr.)", `${esc(site.lcc || "—")} / ${esc(site.lccIrr || "—")}`),
      P("Climatic factor C", (cf => cf ? `${cf.src.startsWith("NRCS") ? "" : "≈ "}${fmtC(cf.C)}` : "—")(soilC(s))), P("Rainfall factor R", s.rFactor ? fmt(s.rFactor, 0) : "—"),
      P("Mean annual precip", site.map ? UN.fmt("precip", site.map, 0) : "—"), P("Mean annual air temp", site.airtemp ? UN.fmt("temp", site.airtemp) : "—"),
      P("Frost-free days", site.ffd ? fmt(site.ffd, 0) : "—"),
      P("Range production (normal yr)", site.rsprod ? UN.fmt("massArea", site.rsprod) : "—"),
      P("Ecological site", d.eco ? `<a href="https://edit.jornada.nmsu.edu/catalogs/esd/${esc(d.eco.ecoclassid.slice(1, 5))}/${esc(d.eco.ecoclassid)}" target="_blank" rel="noopener">${esc(d.eco.ecoclassid)}</a>` : "—"),
      P("MLRA", s.mlra ? `${esc(s.mlra.sym)}` : "—"), P("Survey area", esc(s.mapunit.areasymbol || "—")), P("Map unit key", esc(String(s.mukey))),
    ].join("");
    const card = (title, body, tools) => `<div class="card"><div class="card-h"><h3>${title}</h3>${tools || ""}</div>${body}</div>`;
    const yields = d.yields.length ? card("Typical yields (survey estimates)", `<div class="table-wrap"><table class="grid"><thead><tr><th>Crop</th><th>Dryland</th><th>Irrigated</th><th>Units</th></tr></thead>
      <tbody>${d.yields.map(y => `<tr><td>${esc(y.cropname)}</td><td>${f(num(y.nonirryield_r), 0)}</td><td>${f(num(y.irryield_r), 0)}</td><td>${esc(y.yldunits || "")}</td></tr>`).join("")}</tbody></table></div>`) : "";
    const plants = d.plants.filter(p => p.plantsciname).slice(0, 12);
    const plantTbl = plants.length ? card("Reference native plant community (% of production)", `<div class="table-wrap"><table class="grid"><thead><tr><th>Plant</th><th>Scientific name</th><th>%</th></tr></thead>
      <tbody>${plants.map(p => `<tr><td>${esc(p.plantcomname || p.plantsym)}</td><td class="l"><i>${esc(p.plantsciname)}</i></td><td>${f(num(p.rangeprod), 0)}</td></tr>`).join("")}</tbody></table></div>`) : "";
    const comps = card("Components in this map unit", `<div class="table-wrap"><table class="grid"><thead><tr><th>Component</th><th>%</th><th>WEG</th><th>I<small>${esc(UN.sym("soilLoss"))}</small></th><th>Slope<small>%</small></th><th>Drainage</th><th>Ecological site</th></tr></thead>
      <tbody>${s.components.map(c => `<tr><td>${esc(c.compname)}${c.cokey === d.cokey ? " ★" : ""}</td><td>${f(c.comppct_r, 0)}</td><td>${esc(c.weg || "—")}</td><td>${num(c.wei) === null ? "—" : UN.num("soilLoss", num(c.wei), 0)}</td><td>${f(num(c.slope_r), 1)}</td><td class="l">${esc(c.drainagecl || "—")}</td><td class="l">${esc(c.eco ? c.eco.ecoclassname : "—")}</td></tr>`).join("")}</tbody></table></div>`);
    box.innerHTML = `<p class="fine sm-hzwho"><b>${esc(d.compname)}</b>, the dominant soil: texture, density, water retention and conductivity of each horizon.</p>${table}<p class="fine">Water retention, conductivity and bulk density come from the survey; a row marked ✎ holds your edits, and where they change sand, silt, clay or organic matter its water retention, conductivity and bulk density are Saxton &amp; Rawls (2006) estimates (a pH edit alone keeps the survey's). Root growth factor = exp(−0.02 × mid-depth) below 15 cm, 0 below a restrictive layer. The profile CSV has every column of both views for this soil (pH, CEC, OM, organic C, total N, CaCO₃, gypsum, EC, SAR too) and keeps cm and cm/h whatever the units table says.</p>
        <div class="export-row"><button class="btn small" id="dlCsv">Download the profile (CSV)</button><button class="btn small" id="dlSol">Download DSSAT .SOL</button></div>`;
    // the pH box: drawn once per Soil tab (an input redrawn while typed in would lose its focus), then only its value follows
    if (phBox && !phBox.firstChild) phBox.innerHTML = card("Surface pH — edit with your soil test", `<div class="soil-edit" id="soilEditPh"><label>pH (1:1 water)<input type="number" id="inPh" min="3" max="10" step="0.1"></label></div>
      <p class="fine">pH goes into the surface horizon (✎ in Horizons › Chemistry) and the model files; it does not change the wind erodibility. Sand, silt, clay, organic matter and CaCO₃ are edited on Wind erosion › Soil, and show here too. Reset to survey undoes every edit of the surface layer.</p>`, `<button class="link reset-soil"${state.edits ? "" : " hidden"}>Reset to survey</button>`);
    const ph = $("#inPh");
    if (ph && document.activeElement !== ph) { const v = surf ? surf.ph : null; ph.value = v ?? ""; ph.classList.toggle("edited", !!state.edits && (v ?? null) !== (s.surface ? s.surface.ph ?? null : null)); }
    if ($("#profPh .reset-soil")) $("#profPh .reset-soil").hidden = !state.edits;
    if (more) more.innerHTML = card("Site and classification", `<div class="param-grid">${params}</div>`) + comps + yields + plantTbl;
    const csv = () => U.download(`soil_${s.mukey}_${d.compname.replace(/\W+/g, "_")}.csv`, S.toCSV(s, layers, site, cFactor(), surf), "text/csv");
    $("#dlCsv").onclick = csv;
    $("#dlSol").onclick = () => { // a component without water retention or bulk density (urban land, pits) has no DSSAT soil
      try { U.download("WG.SOL", WG.models.writers.dssatSol(WG.models.surveySoil(state))); }
      catch (e) { console.warn(e); U.toast(`No DSSAT soil file for ${d.compname}: ${e.message || e}.`, 6000); }
    };
    if ($("#profSource")) $("#profSource").innerHTML = `Source: USDA-NRCS Soil Survey Geographic Database (SSURGO) via <a href="https://sdmdataaccess.nrcs.usda.gov/" target="_blank" rel="noopener">Soil Data Access</a>, map unit key ${s.mukey}, ${esc(s.mapunit.areaname || "")}${s.mapunit.saverest ? `, survey dated ${esc(String(s.mapunit.saverest).split(/[ T]/)[0])}` : ""}. Elevation/slope: ${e ? esc(e.src) + (e.src.startsWith("USGS") ? " (Elevation Point Query Service)" : " via Open-Meteo") : "loading"}. Water retention of a layer with edited sand, silt, clay or organic matter: Saxton &amp; Rawls (2006). <button class="link" data-methods="m-soil">Equations →</button>`;
  }

  /* ============ PRACTICES TAB ============ */
  /* Texas plans come from the Texas engine; another state's from its researched profile, data/practices/XX.json,
     loaded the first time its Practices tab is drawn (js/practices.js planState). A state without a profile gets a
     note pointing to the national NRCS standards and the state's Field Office Technical Guide. */
  function renderPractices() {
    if (!WG.practices) return;
    const ss = state.siteState, tx = !ss || ss.code === "TX";
    const pf = tx ? null : WG.practices.profile(ss.code);
    if (pf === undefined) WG.practices.loadProfile(ss.code, ASSET_V).then(() => { if (state.siteState === ss) renderPractices(); });
    const none = !tx && !pf;
    $("#tab-practices").classList.toggle("elsewhere", none);
    $("#practicesElsewhere").hidden = !none;
    if (none) {
      const A = (h, t) => `<a href="${h}" target="_blank" rel="noopener">${t}</a>`;
      $("#practicesElsewhere").innerHTML = pf === undefined
        ? `<div class="card-h"><h3>Control practices in ${esc(ss.name)}</h3></div><p>Loading ${esc(ss.name)}'s practice guidance…</p>`
        : `<div class="card-h"><h3>Control practices in ${esc(ss.name)}</h3></div>
        <p>${esc(ss.name)}'s practice guidance could not be loaded.</p>
        <p>The NRCS ${A("https://www.nrcs.usda.gov/resources/guides-and-instructions/conservation-practice-standards", "national Conservation Practice Standards")} give each practice's purpose and criteria, and ${esc(ss.name)}'s own version, with its seeding lists, rates and dates, is in the state's ${A("https://efotg.sc.egov.usda.gov/", "Field Office Technical Guide (eFOTG)")}. Your NRCS field office or county extension office can help choose them.</p>`;
      return;
    }
    WG.practices.render({
      grid: $("#luGrid"), qWrap: $("#luQuestions"), qBox: $("#qBox"), plan: $("#planBox"), suggestTag: $("#lcSuggest"),
      state, surface: currentSurface(), risk: riskModel(), profile: pf, onChange: () => renderPractices(),
    });
  }

  /* A change in the units table redraws every view that shows numbers. */
  UN.on(() => {
    $("#unitSel").value = UN.sym("wind");
    renderLegend(); buildLayerSheet();
    $("#thrVal").textContent = thrTxt(state.thr);
    if (!state.site) {
      bareUrl(); // keep ?units= in the address in step with the choice, so a reload does not bring an old one back
      return;
    }
    renderHeader(); renderStats(); renderRisk(); renderWegTable(currentSurface());
    if (state.wind && !state.wind.error) renderWind();
    renderSoilSummary(); renderSoilDetail(); renderPractices();
    const tab = $(".tabs button.active"); // a weather tab on show is drawn again in the new units, from the data read for this location
    if (tab && ["drought", "soilmaps", "soiloverview", "soilbasin", "soilmoist"].includes(tab.dataset.tab)) WG.weather.show(tab.dataset.tab, $("#tab-" + tab.dataset.tab));
    const { lat, lon } = state.site;
    try { history.replaceState(null, "", `?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}${windQ()}${UN.query()}${KEEP_Q}`); } catch (e) { /* file:// */ }
  });
  $("#unitSel").value = UN.sym("wind");
  $("#thrVal").textContent = thrTxt(state.thr);

  /* first paint: the states in the link; else the state of the location in it (an older link); else the states last
     chosen on this device; else Texas */
  buildLayerSheet();
  (async () => {
    const params = START_Q, lat = +params.get("lat"), lon = +params.get("lon"), has = params.get("lat") && params.get("lon");
    let codes = (params.get("states") || "").split(",").filter(Boolean);
    if (!codes.length && has) { const rec = await findState(lat, lon); if (rec) codes = [rec.code]; }
    if (!codes.length) { try { codes = (localStorage.getItem("fg.states") || "").split(",").filter(Boolean); } catch (e) { /* storage off */ } }
    try {
      await setRegion(codes.length ? codes : ["TX"], has ? { at: [lat, lon] } : {});
      if (has) {
        if (!stateAt(lat, lon) && region.codes.length) await ensureState(lat, lon);
        if (stateAt(lat, lon)) selectSite(lat, lon, { zoom: 13 }); // else ensureState's toast says why, and the link keeps the location
      }
    } finally { booted = true; if (!has && START_Q.has("map") && START_Q.get("map") !== state.theme) bareUrl(); } // a link to a theme this copy has not: the address drops it
  })();
})();
