/* The area grid: the area tool's boundary as a grid of cells, from 20 cm up, square, turned or hexagonal, or the user's own
   grid file, each cell holding the soil at chosen depths and the weather, and linked to the data sheet's model files,
   written once for each soil and weather cell. Finer cells line up with other grids; they add
   no detail, as the soil survey is mapped at 1:12,000-1:24,000 and the weather comes in cells of 4 km or more. Geometry and
   file formats are in WG.gridfiles. */
WG.grid = (function () {
  const { $, $$, esc, fmt, toast, num, pool } = WG.util;
  const UN = WG.units, X = WG.export, Wd = WG.wind, M = WG.models, D = WG.downloads, G = WG.gridfiles, U = WG.writerUtil, A = WG.area, ok = U.ok, NO = G.NODATA;
  const DS = WG.datasheet, T = WG.templates;
  // the most a browser can hold: window cells (three arrays), cells x columns in a GeoTIFF, cells worked out one by one, and in each polygon or text file;
  // model files: runs (a soil with a weather cell) for CENTURY's and DayCent's site files, files written, and characters of text in all
  const MAX = { window: 50e6, values: 1.5e9, sampled: 200e3, shp: 500e3, geojson: 100e3, csv: 1e6, wxCells: 80, wxCellsGm: 400, fields: 240, runs: 5000, items: 40000, text: 1.2e9 };
  // the most weather cells a source reads: gridMET reads a box of cells in one request a variable, the others one cell a request
  const wxCap = o => (o.src === "gridmet" ? MAX.wxCellsGm : MAX.wxCells);
  /* the models of the data sheet: [key, name, its weather files, its soil files]; short names for the shapefile's link
     columns; CENTURY and DayCent, whose site files hold the soil and the climate together */
  const MODELS = DS.MODELS, MNAME = Object.fromEntries(MODELS.map(m => [m[0], m[1]])), SITES = DS.CLIM_MODELS, mName = m => (m === "csv" ? "CSV" : MNAME[m].split(" ")[0]);
  const MSHORT = { dssat: "DSSAT", swatplus: "SWAT", epic: "EPIC", apex: "APEX", apsim: "APSIM", aquacrop: "AQUA", century: "CENT", daycent: "DAYC", csv: "CSV" };
  // the file a link names: the main one of a weather cell's or a soil's files (DSSAT and SWAT+ are linked by the names in their files)
  const MAIN = { wx: { epic: /\.DLY$/, apex: /\.DLY$/, apsim: /\.met$/, aquacrop: /\.CLI$/, century: /\.wth$/, daycent: /\.wth$/ }, soil: { epic: /\.SOL$/, apex: /\.SOL$/, apsim: /\.apsimx$/, aquacrop: /\.SOL$/ } };
  // rough sizes for the caution: bytes a day of weather in a weather cell's files, and bytes of a soil's (a run's) files
  const DAY_BYTES = { dssat: 90, swatplus: 150, epic: 45, apex: 45, apsim: 50, aquacrop: 70, century: 1, daycent: 60, csv: 110 };
  const SOIL_BYTES = { dssat: 2500, swatplus: 1500, epic: 4000, apex: 3500, apsim: 12000, aquacrop: 1500, century: 9000, daycent: 9000, csv: 2500 };
  // the models whose files have fixed names, so each weather cell or soil (or run) has its own folder
  const OWN_DIR = { csv: ["weather", "soils"], daycent: ["sites"] };
  /* the columns of the files: presets of the Download section, by the group of each column */
  const PRESETS = [["erosion", "Erosion"], ["soil", "Soil properties"], ["weather", "Weather"], ["links", "Model links"], ["all", "All"]];
  const inPreset = (p, b) => p === "all" || b.group === "cover"
    || (p === "erosion" && (b.group === "site" || (b.group === "layer" && b.top0 && /^(sand|silt|clay|om|caco3|cfVol)_/.test(b.name)) ||(b.group === "wx" && (b.name === "wx_cell" || /^(prcp|et0|wind10)(_|$)/.test(b.name)))))
    || (p === "soil" && (b.group === "site" || b.group === "layer")) || (p === "weather" && (b.group === "wx" || b.group === "dm"))
    || (p === "links" && (b.group === "link" || b.name === "mukey" || b.name === "wx_cell"));
  const SIZE_UNIT = { cm: 0.01, m: 1, km: 1000, in: 0.0254, ft: 0.3048 };
  const QUICK = [[20, "cm"], [1, "m"], [10, "m"], [30, "m"], [100, "m"], [1, "km"]];
  const COVER = ["outside", "open land", "building", "road", "water", "no soil data"];
  /* soil columns: [key, name, short name, unit, or q and per for the units table], for each chosen layer */
  const SOIL = [["sand", "Sand", "SAND", "%"], ["silt", "Silt", "SILT", "%"], ["clay", "Clay", "CLAY", "%"], ["om", "Organic matter", "OM", "%"], ["bd", "Bulk density", "BD", "g/cm3"],
    ["ll", "Wilting point", "LL", "cm3/cm3"], ["dul", "Field capacity", "DUL", "cm3/cm3"], ["sat", "Saturation", "SAT", "cm3/cm3"], ["ksat", "Ksat", "KSAT", null, "ksat", 1 / 3.6],
    ["ph", "pH", "PH", ""], ["cec", "CEC", "CEC", "cmol/kg"], ["caco3", "CaCO3", "CACO", "%"], ["cfVol", "Coarse fragments", "CF", "% volume"], ["ec", "EC", "EC", "dS/m"]];
  const SOIL_ON = ["sand", "silt", "clay", "om", "bd", "ll", "dul", "ksat"];
  /* one column each: the map unit, its erodibility */
  const SITE = [["mukey", "Soil map unit key", "MUKEY"], ["weg", "Wind Erodibility Group (4L = 41)", "WEG"], ["wei", "Wind erodibility index I", "I"], ["cf", "Climatic factor C", "C"], ["e", "Bare-soil potential E", "E"]];
  const WX = [["prcp", "Rain", "RAIN", "precip", true], ["tmax", "Mean Tmax", "TMAX", "temp"], ["tmin", "Mean Tmin", "TMIN", "temp"], ["srad", "Mean solar radiation", "SRAD", "solar"],
    ["rh", "Mean relative humidity", "RH", null], ["wind10", "Mean wind at 10 m", "WIND", "wind"], ["et0", "Grass ET0", "ET0", "precip", true]];
  /* the weather sources' grids, for telling which of their cells a grid cell falls in */
  const WX_GRID = { gridmet: { name: "gridMET", res: "4 km", dLat: 1 / 24, dLon: 1 / 24, lat0: 49.4, lon0: -124.7666666333 },
    prism: { name: "PRISM", res: "4 km", dLat: 1 / 24, dLon: 1 / 24, lat0: 49.9166666667, lon0: -125 }, // its own grid; solar, humidity and wind from gridMET's cell there
    power: { name: "NASA POWER", res: "0.5°", dLat: 0.5, dLon: 0.625, lat0: 0, lon0: 0 } };

  let area = null, job = null, busy = false, own = null, gen = 0; // gen counts changes, so a build knows its choices are still the sheet's
  let want = null, auto = null; // the files ticked, kept while a choice rules one out so they come back; the file a change of shape ticked
  // the user's daily weather file for this area: { name, text, w (its parse), n }; gridMET's last day, once read
  let wxFile = null, wxLoads = 0, gmLast = null;
  // the columns and model folders ticked for the download, set afresh by each build
  let chosen = new Set(), zipMdl = new Set();
  // elevKept: each weather cell's elevation for this area, read once, so later builds read the same weather again
  const soilKept = new Map(), wxKept = new Map(), climKept = new Map(), elevKept = new Map();
  const elevKey = (o, c) => `${o.src}:${c.lon.toFixed(4)},${c.lat.toFixed(4)}`;
  const breathe = () => new Promise(r => setTimeout(r));
  const short = (s, n) => String(s).replace(/[^\w]+/g, "_").slice(0, n);
  const pad = (n, k = 3) => String(n).padStart(k, "0");
  // a weather cell's daily series as read: its source, dates and place, and the elevation it was read for (model files only)
  const wxKey = (o, lon, lat, z) => (o.src === "file" ? ["file", wxFile && wxFile.n, JSON.stringify(o.units), o.fill, o.from, o.to, z ?? ""] : [o.src, o.from, o.to, lon.toFixed(4), lat.toFixed(4), z ?? ""]).join();
  // read before: for model files, at the weather cell's elevation once it is known (elevKept); for the means alone, without one
  const wxRead = (o, lon, lat) => {
    if (!wxLinked(o)) return wxKept.has(wxKey(o, lon, lat, null));
    const e = elevKept.get(elevKey(o, { lon, lat }));
    return !!e && wxKept.has(wxKey(o, lon, lat, e.elev));
  };
  const wxName = o => (o.src === "file" ? (wxFile ? wxFile.name : "your weather file") : WX_GRID[o.src].name);
  // the model files that hold a soil, a weather cell, and CENTURY's or DayCent's site files (a soil with its weather cell's climate)
  const soilFiles = o => o.models.length > 0 && o.hold !== "weather";
  const wxFiles = o => o.models.length > 0 && o.hold !== "soil";
  const siteFiles = o => soilFiles(o) && o.models.some(m => SITES.includes(m));
  const zipName = o => `SoilGuard_grid_${short(area.name, 30)}_${o.shape === "own" ? "own" : `${o.size}m_${o.shape}`}.zip`;
  const bytes = n => (n >= 1e9 ? `${fmt(n / 1e9, 1)} GB` : n >= 1e6 ? `${fmt(n / 1e6, 1)} MB` : n >= 1e3 ? `${fmt(n / 1e3, 0)} kB` : `${Math.max(1, Math.round(n))} bytes`);
  const took = s => (s < 60 ? `${Math.max(1, Math.round(s))} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`);

  /* ---------- progress ---------- */
  /* the work running: { kind "build" or "save", plan (its steps), at, text, f (0-1, or null when it cannot be counted),
     stop }. Cancel sets stop, and the work stops at its next check, between batches; its token is its own object. */
  let run = null, clock = 0;
  function begin(kind, plan) {
    run = { kind, plan, at: 0, text: "Starting…", f: null, stop: false, t0: Date.now(), drawn: 0 };
    // fails when the work is stopped, so a long wait on the network can end at once
    run.halted = new Promise((_, no) => { run.halt = () => no(new Error("stopped")); });
    run.halted.catch(() => {});
    busy = true;
    $("#gBuild").disabled = $("#gSave").disabled = true;
    $("#gStatus").textContent = "";
    clearInterval(clock);
    clock = setInterval(draw, 1000);
    draw();
    return run;
  }
  /* where the work is: its step, what it does, and done of total when they can be counted */
  function say(R, step, text, done, total) {
    if (R !== run) return;
    const at = Math.max(0, R.plan.indexOf(step)), moved = at !== R.at || (total ? R.f === null : R.f !== null);
    R.at = at; R.text = text; R.f = total ? Math.min(1, Math.max(0, done / total)) : null;
    if (moved || Date.now() - R.drawn > 80) draw();
  }
  const live = R => { if (R.stop) throw new Error("stopped"); };
  const halt = R => { if (!R || R.stop) return; R.stop = true; R.halt(); draw(); };
  const until = (R, p) => Promise.race([p, R.halted]);
  function draw() {
    const box = $("#gProg");
    if (!box) return;
    box.hidden = !run;
    if (!run) return;
    const R = run, s = Math.floor((Date.now() - R.t0) / 1000), bar = $("#gProgBar");
    R.drawn = Date.now();
    $("#gProgStep").textContent = R.plan.length > 1 ? `Step ${R.at + 1} of ${R.plan.length}` : "";
    $("#gProgText").textContent = R.stop ? "Stopping at the next safe point…" : R.text;
    $("#gProgPct").textContent = `${R.f === null ? "" : `${Math.round(R.f * 100)}% · `}${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    bar.classList.toggle("busy", R.f === null);
    bar.firstElementChild.style.width = R.f === null ? "" : `${(R.f * 100).toFixed(1)}%`;
    if (R.f === null) bar.removeAttribute("aria-valuenow"); else bar.setAttribute("aria-valuenow", Math.round(R.f * 100));
    bar.setAttribute("aria-valuetext", $("#gProgText").textContent);
    $("#gStop").disabled = R.stop;
  }
  function finish(R) {
    if (R !== run) return;
    run = null; busy = false;
    clearInterval(clock);
    draw();
    $("#gBuild").disabled = false;
    $("#gSave").disabled = !job;
  }

  /* ---------- the sheet ---------- */
  function open(a) {
    if (!a || !a.result) return toast("Draw or upload a boundary in the area tool first, and wait for its analysis.");
    // your grid file and weather file belong to the area they were loaded for
    if (!area || area.polys !== a.polys) { own = wxFile = null; elevKept.clear(); }
    if (gmLast === null) Wd.gridmetLast().then(v => { gmLast = v; if ($("#gWxRange")) wxDates(); }).catch(() => {});
    // a build running is thrown away when the form starts afresh, so it stops now
    if (run && run.kind === "build") { run.quiet = true; halt(run); }
    job = null; gen++; want = auto = null; // the form starts afresh, so no earlier or running build matches it
    area = a;
    render();
    D.open("gridSheet");
    estimate();
  }
  const checks = (name, list, on, label = x => x[1]) => list.map(x => `<label><input type="checkbox" name="${name}" value="${x[0]}" ${on(x) ? "checked" : ""}> ${esc(label(x))}</label>`).join("");
  function render() {
    const y = new Date().getUTCFullYear() - 1, depth = UN.sym("depth"), dv = v => +UN.conv("depth", v).toFixed({ in: 2, cm: 1, mm: 0 }[depth] ?? 1), zone = G.zoneOf(mid()[0]);
    $("#gridBody").innerHTML = `
      <p class="fine"><b>${esc(area.name)}</b>. A grid of cells with the soil and weather in each, as a raster or as polygons, ready for a GIS.
        Finer cells do not add detail: the soil survey is mapped at 1:12,000–1:24,000 and the weather comes in cells of 4 km or more, so a 20 cm grid repeats the same values. Use it to line up with a grid you already have.</p>
      <ol class="g-steps" aria-label="How to make a grid"><li class="done">Draw or upload a boundary in the area tool</li><li class="done">Make a grid of this area</li><li>Choose the grid, soil, weather, model data and files below</li><li>Build and preview</li><li>Choose the columns and download the zip</li></ol>
      <section class="data-sec"><h4>1 · The grid</h4>
        <div class="form-grid">
          <label>Cell size<input type="number" id="gSize" value="30" min="0" step="any"></label>
          <label>Unit<select id="gUnit">${Object.keys(SIZE_UNIT).map(u => `<option ${u === "m" ? "selected" : ""}>${u}</option>`).join("")}</select></label>
          <label>Shape<select id="gShape"><option value="square">Square, north up (most common)</option><option value="turned">Square, turned by an angle</option><option value="hex">Hexagons, points up</option><option value="hexflat">Hexagons, flat side up</option><option value="own">My own grid file…</option></select></label>
          <label id="gAngleBox" hidden>Angle, clockwise (degrees)<input type="number" id="gAngle" value="0" step="any"></label>
          <label id="gCrsBox">Lay out the cells in<select id="gCrs"><option value="utm">UTM (metres)</option><option value="albers">CONUS Albers, EPSG:5070 (as NLCD and CDL)</option><option value="merc">Web Mercator, EPSG:3857 (web maps)</option></select></label>
          <label id="gZoneBox">UTM zone<select id="gZone"><option value="auto">This area's: ${zone}</option>${Array.from({ length: 23 }, (_, i) => `<option>${i + 1}</option>`).join("")}</select></label>
          <label id="gDatumBox">UTM datum<select id="gDatum"><option value="wgs84">WGS 84 (EPSG:326xx)</option><option value="nad83">NAD83 (EPSG:269xx)</option></select></label>
          <label id="gMercBox" hidden>Cell size in Web Mercator<select id="gMerc"><option value="ground">On the ground at this area</option><option value="map">In its own metres, as map tiles</option></select></label>
        </div>
        <p class="fine" id="gCrsInfo"></p>
        <p class="fine">Quick size: ${QUICK.map(([v, u]) => `<button class="link" data-quick="${v},${u}">${v} ${u}</button>`).join(" · ")}. A hexagon's size is its width across the flat sides.</p>
        <div id="gOwnBox" hidden><div class="form-grid"><label>Your grid (polygons: zipped shapefile, .kml, .kmz or .geojson)<input type="file" id="gOwnFile" accept=".zip,.shp,.dbf,.prj,.shx,.kml,.kmz,.geojson,.json" multiple></label></div><p class="fine dl-status" id="gOwnInfo"></p></div>
        <div id="gLineBox"><label class="pv-vars"><span><input type="checkbox" id="gLine"> Line up with a corner of a grid I have</span></label>
          <div class="form-grid" id="gLineXY" hidden><label>X of that corner (m)<input type="number" id="gOx" value="0" step="any"></label><label>Y of that corner (m)<input type="number" id="gOy" value="0" step="any"></label></div></div>
        <div class="form-grid"><label>A cell's value<select id="gRule"><option value="centre">What lies at its centre</option><option value="area">Weighted by what covers it (slower; ${(MAX.sampled / 1000).toFixed(0)},000 cells at most)</option></select></label></div>
        <p class="fine dl-status" id="gEstimate"></p>
      </section>
      <section class="data-sec"><h4>2 · Soil</h4>
        <div class="pv-vars">${checks("gSite", SITE, x => ["mukey", "weg"].includes(x[0]))}</div>
        <p class="fine">For each layer below:</p>
        <div class="pv-vars">${checks("gSoil", SOIL, x => SOIL_ON.includes(x[0]))}</div>
        <div class="form-grid"><label>Bottom of each layer (${esc(depth)})<input id="gDepths" inputmode="decimal" value="${[15, 30, 60, 100].map(dv).join(", ")}"></label>
          <label>Within a map unit<select id="gComp"><option value="dominant">The main soil</option><option value="weighted">All its soils, weighted by their %</option></select></label></div>
        <p class="fine">A map unit mixes soils without showing where each one lies, so a cell takes its main soil or a weighted mean. A layer below the end of a profile is left blank.</p>
      </section>
      <section class="data-sec"><h4>3 · Weather and drought</h4>
        <label class="pv-vars"><span><input type="checkbox" id="gWxOn"> Add weather</span></label>
        <div id="gWxBox" hidden>
          <div class="form-grid"><label>From<select id="gWxSrc">${Object.entries(WX_GRID).map(([k, g]) => `<option value="${k}">${esc(g.name)}, ${esc(g.res)}</option>`).join("")}<option value="file">My own daily weather file…</option></select></label>
            <label>First day<input type="date" id="gFrom" value="${y - 9}-01-01"></label><label>Last day<input type="date" id="gTo" value="${y}-12-31"></label></div>
          <p class="fine" id="gWxRange"></p>
          <div id="gWxFileBox" hidden>
            ${T.box("weather")}
            <div class="form-grid"><label>Your file<input type="file" id="gWxIn" accept=".csv,.txt,.tsv,.dat,.xlsx,.xls"></label>
              <label class="check"><input type="checkbox" id="gFill" checked> Fill gaps from gridMET</label></div>
            <p class="fine dl-status" id="gWxStatus">${wxFile ? esc(wxText()) : ""}</p>
            ${DS.unitFields("gu")}
            <p class="fine">One file is one weather for the whole area: every cell takes it (weather cell 1, at the area's centre), and gaps are filled from gridMET's cell there.</p>
          </div>
          <div class="pv-vars">${checks("gWx", WX, x => ["prcp", "tmax", "tmin"].includes(x[0]))}</div>
          <div class="pv-vars"><label><input type="checkbox" id="gMonthly"> Also each calendar month's value</label><label><input type="checkbox" id="gDaily" checked> Daily weather tables, one for each weather cell</label></div>
          <p class="fine">Each grid cell holds the period's means and a number that points to its weather cell, because a daily series for every grid cell would be far too large.</p>
        </div>
        <label class="pv-vars"><span><input type="checkbox" id="gDmOn"> Add the U.S. Drought Monitor</span></label>
        <div id="gDmBox" hidden>
          <div class="form-grid"><label>Weeks<select id="gDmSpan">${DM_SPANS.map(([v, t]) => `<option value="${v}" ${v === 52 ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label></div>
          <p class="fine">Each week's map is read as an image of the area at about 100 m (0.001°). Columns: dm_now, the class of the latest map (-1 none, 0 to 4 for D0 to D4); over more weeks also dm_d0p to dm_d4p, the % of the weeks in D0 or worse, D1 or worse (in drought) … D4; dm_max, the worst class; and dm_run, the longest run of weeks in drought. drought/weeks.csv gives each week's share of the cells in each class.</p>
        </div>
      </section>
      <section class="data-sec"><h4>4 · Data for models</h4>
        <p class="fine">The point data sheet's model files for the whole area, written once for each soil and once for each weather cell, not for every grid cell. Columns link each grid cell to them: soil_id (its map unit), wx_id (its weather cell) and run_id (the two together), with an index of the files for each.</p>
        <div class="model-grid">${MODELS.map(([k, n, w, s]) => `<label><input type="checkbox" name="gModel" value="${k}"><span>${esc(n)}<small>${esc(w)}; ${esc(s.charAt(0).toLowerCase() + s.slice(1))}</small></span></label>`).join("")}</div>
        <div id="gMdlBox" hidden>
          <div class="form-grid"><label>The files hold<select id="gHold"><option value="both">Soil and weather</option><option value="soil">Soil only</option><option value="weather">Weather only</option></select></label>
            <label>Soil layers<select id="gLayers"><option value="model">Each model's usual layers</option><option value="survey">The horizons as they are</option><option value="custom">Custom depths…</option></select></label></div>
          <div id="gMDepthBox" hidden><div class="form-grid"><label>Bottom of each layer (${esc(depth)})<input id="gMDepths" inputmode="decimal" value="${esc(DS.depthText(DS.DEPTH_SETS[0][1]))}"></label></div>
            <p class="fine">Separate the depths with commas; the last one is the profile depth. Quick fill: ${DS.DEPTH_SETS.map(([n, d]) => `<button class="link" data-mdepths="${d.join(",")}">${esc(n)}</button>`).join(" · ")}</p></div>
          <p class="fine dl-status" id="gMdlInfo"></p>
        </div>
      </section>
      <section class="data-sec"><h4>5 · Files</h4>
        <div class="pv-vars" id="gFiles"></div>
        <p class="fine">A GeoTIFF holds square cells only. Some GIS software ignores a raster's turn, so a turned grid also comes well as polygons; hexagons can only be polygons.</p>
        <div class="form-grid"><label>Coordinates of the shapefile and CSV<select id="gOut"><option value="same">Same as the layout</option><option value="4326">WGS 84 longitude, latitude (EPSG:4326)</option><option value="4269">NAD83 longitude, latitude (EPSG:4269)</option><option value="3857">Web Mercator (EPSG:3857)</option><option value="custom">Custom: a proj4 definition…</option></select></label></div>
        <div id="gOutBox" hidden><div class="form-grid"><label class="span">proj4 definition (epsg.io gives it for any EPSG code, as PROJ.4)<input id="gProj" class="mono" spellcheck="false" autocomplete="off" placeholder="+proj=lcc +lat_0=29.6666666666667 +lon_0=-100.333333333333 +lat_1=31.8833333333333 …"></label>
          <label class="span">Its .prj, optional (ESRI WKT, also on epsg.io): written to the shapefile as given<textarea id="gWkt" class="mono" rows="3" spellcheck="false" placeholder="PROJCS[&quot;…&quot;,GEOGCS[…],PROJECTION[…],…]"></textarea></label></div>
          <p class="fine dl-status" id="gOutInfo"></p></div>
        <p class="fine">Every corner is reprojected into them, with a .prj your GIS reads. GeoJSON is always WGS 84 longitude and latitude (RFC 7946). A GeoTIFF stays in the layout's coordinates: a raster cannot be reprojected without resampling its cells.</p>
      </section>
      <section class="data-sec"><h4>6 · Build and preview</h4>
        <p class="fine g-caution" id="gCaution"></p>
        <div class="area-actions"><button class="btn primary" id="gBuild" ${busy ? "disabled" : ""}>Build and preview</button></div>
        <div class="g-prog" id="gProg" hidden>
          <div class="g-prog-top"><b id="gProgStep"></b><span id="gProgText"></span><span class="g-prog-pct" id="gProgPct"></span></div>
          <div class="g-bar" id="gProgBar" role="progressbar" aria-label="Progress" aria-valuemin="0" aria-valuemax="100"><i></i></div>
          <div class="g-prog-foot"><span class="fine">Please keep this sheet open: large grids and long weather periods take a while.</span><button class="btn small" id="gStop">Cancel</button></div>
        </div>
        <p class="fine dl-status" id="gStatus" aria-live="polite"></p>
        <div id="gPvSec" hidden>
          <div class="pv-tools"><label class="pv-lab">Show <select id="gBand"></select></label></div>
          <canvas id="gCanvas" class="grid-canvas"></canvas><div id="gLegend" class="grid-legend"></div><p class="fine" id="gPvNote" hidden></p>
          <div class="table-wrap"><table class="grid pv-table" id="gStats"></table></div>
        </div>
      </section>
      <section class="data-sec" id="gDlSec" hidden><h4>7 · Download</h4>
        <div id="gColBox"></div>
        <div id="gMdlZip"></div>
        <p class="fine" id="gZipHead"></p>
        <ul class="g-files" id="gZipList"></ul>
        <div class="area-actions"><button class="btn primary" id="gSave" disabled>Download the zip</button></div>
        <p class="fine">The columns and model folders ticked here, and the files ticked under 5 · Files with their coordinates, are read when you download, so change them and download again without building again.</p>
      </section>`;
    wire();
    shape();
    wxDates();
    mdlShow();
    draw();
  }
  /* the date boxes take the chosen source's record, as on the data sheet; the file's box shows for the file */
  function wxDates() {
    const src = $("#gWxSrc").value, r = DS.wxRange(src, $("#gFill").checked, wxFile && { days: wxFile.w.days, name: wxFile.name }, gmLast);
    $("#gWxFileBox").hidden = src !== "file";
    $("#gWxRange").textContent = r ? `${r.name}: ${Wd.dayLabel(r.first)} – ${Wd.dayLabel(r.last)}.${src === "prism" ? " PRISM has rain and temperature only: solar radiation, humidity and wind come from gridMET." : ""}` : "Choose your file below: its days are the dates.";
    ["#gFrom", "#gTo"].forEach(s => { $(s).min = r ? Wd.isoDay(r.first) : ""; $(s).max = r ? Wd.isoDay(r.last) : ""; });
  }
  const wxText = () => {
    const w = wxFile.w, miss = k => (w[k] || []).filter(v => v === null).length;
    return `${wxFile.name}: ${w.days.length.toLocaleString()} days, ${Wd.dayLabel(w.days[0])} – ${Wd.dayLabel(w.days[w.days.length - 1])}. Missing: Tmax ${miss("tmax")}, Tmin ${miss("tmin")}, rain ${miss("prcp")}, solar ${miss("srad")}, humidity ${miss("rh")}, wind ${miss("wind10")} days.`;
  };
  /* the user's weather file, read in the units chosen; Build reads it again with the units chosen then */
  async function loadWx() {
    const f = $("#gWxIn").files[0];
    if (!f) return;
    $("#gWxIn").value = ""; // the same file, corrected, can then be chosen again
    const [lon, lat] = mid();
    try {
      const text = await DS.fileText(f), w = M.parseWeatherCSV(text, DS.wxUnits("gu"), lat, lon, null);
      wxFile = { name: f.name, text, w, n: ++wxLoads };
      $("#gFrom").value = Wd.isoDay(w.days[0]); $("#gTo").value = Wd.isoDay(w.days[w.days.length - 1]);
      $("#gWxStatus").textContent = wxText();
    } catch (e) { wxFile = null; $("#gWxStatus").textContent = `Could not read ${f.name}: ${e.message || e}`; }
    wxDates(); stale(); estimate();
  }
  /* the model choices that apply */
  function mdlShow() {
    $("#gMdlBox").hidden = !ticks("gModel").length;
    $("#gMDepthBox").hidden = $("#gLayers").value !== "custom";
  }
  /* the estimate waits until typing pauses; a choice made with a click counts at once */
  let estT = 0;
  const later = soon => { clearTimeout(estT); estT = 0; if (soon) estT = setTimeout(estimate, 300); else estimate(); };
  const flush = () => { if (estT) later(false); };
  function wire() {
    const body = $("#gridBody"), typed = t => t.tagName === "TEXTAREA" || (t.tagName === "INPUT" && !["checkbox", "radio", "file"].includes(t.type));
    const react = (e, soon) => {
      const t = e.target;
      // the weather template's own choices change nothing here
      if (["gBand", "gOwnFile", "gWxIn"].includes(t.id) || t.closest("[data-tpl]")) return;
      // the files and their coordinates are chosen when they are written, so the cells built stay good
      if (["gOut", "gProj", "gWkt"].includes(t.id)) return later(soon);
      if (t.name === "gFile") { if (t.checked) want.add(t.value); else want.delete(t.value); auto = null; later(false); return zipList(); }
      // so are the columns and the model folders
      if (t.name === "gCol" || t.name === "gZipMdl") { (t.name === "gCol" ? chosen : zipMdl)[t.checked ? "add" : "delete"](t.value); return zipList(); }
      stale(); later(soon);
    };
    body.oninput = e => { if (typed(e.target)) react(e, true); };
    body.onchange = e => react(e, false);
    body.onclick = e => {
      const q = e.target.closest("[data-quick]"), d = e.target.closest("[data-mdepths]"), p = e.target.closest("[data-preset]");
      if (q) { const [v, u] = q.dataset.quick.split(","); $("#gSize").value = v; $("#gUnit").value = u; stale(); estimate(); }
      if (d) { $("#gMDepths").value = DS.depthText(d.dataset.mdepths.split(",").map(Number)); stale(); estimate(); }
      if (p && job) { chosen = new Set(columns(job).filter(b => inPreset(p.dataset.preset, b)).map(b => b.name)); colBox(); zipList(); }
    };
    $("#gShape").addEventListener("change", shape);
    $("#gLine").addEventListener("change", () => { $("#gLineXY").hidden = !$("#gLine").checked; });
    $("#gWxOn").addEventListener("change", () => { $("#gWxBox").hidden = !$("#gWxOn").checked; });
    $("#gDmOn").addEventListener("change", () => { $("#gDmBox").hidden = !$("#gDmOn").checked; });
    $("#gWxSrc").addEventListener("change", wxDates);
    $("#gFill").addEventListener("change", wxDates);
    $("#gWxIn").addEventListener("change", loadWx);
    T.wire("weather", $("#gWxFileBox"));
    $$("input[name=gModel]").forEach(i => i.addEventListener("change", mdlShow));
    $("#gLayers").addEventListener("change", mdlShow);
    $("#gOwnFile").addEventListener("change", loadOwn);
    $("#gBuild").addEventListener("click", build);
    $("#gSave").addEventListener("click", save);
    $("#gStop").addEventListener("click", () => halt(run));
    $("#gBand").addEventListener("change", preview);
  }
  function shape() {
    const v = $("#gShape").value, mine = v === "own";
    $("#gAngleBox").hidden = v === "square" || mine;
    $("#gOwnBox").hidden = !mine;
    $("#gLineBox").hidden = mine;
    $("#gSize").disabled = $("#gUnit").disabled = mine;
    // your own cells are always weighed: the sheet shows it, and the choice made before comes back after
    const rule = $("#gRule");
    if (mine && !rule.disabled) { rule.dataset.was = rule.value; rule.value = "area"; } else if (!mine && rule.disabled) rule.value = rule.dataset.was || "centre";
    rule.disabled = mine;
    // a GeoTIFF holds square cells only: with no other file ticked, other shapes get the shapefile, dropped again on square cells unless you ticked a file since
    const sq = v === "square" || v === "turned";
    if (want && !sq && ![...want].some(k => k !== "tif")) { want.add("shp"); auto = "shp"; } else if (want && sq && auto) { want.delete(auto); auto = null; }
  }
  function stale() {
    gen++;
    // a build running would be thrown away at its end, so it stops now
    if (run && run.kind === "build") halt(run);
    if (!job) return;
    job = null;
    $("#gSave").disabled = true;
    $("#gPvSec").hidden = $("#gDlSec").hidden = true;
    $("#gStatus").textContent = "You changed something: build it again.";
  }
  const ticks = name => $$(`input[name=${name}]:checked`).map(i => i.value);
  function depths() {
    const raw = ($("#gDepths").value || "").split(/[,;\s]+/).filter(Boolean);
    const v = raw.map(x => UN.back("depth", +x));
    if (raw.length && v.some(x => x === null || !(x > 0))) return null;
    return [...new Set(v.map(x => Math.round(x * 10) / 10))].sort((a, b) => a - b);
  }
  function options() {
    const v = $("#gShape").value;
    return { size: +$("#gSize").value * SIZE_UNIT[$("#gUnit").value], shape: v, angle: v === "square" || v === "own" ? 0 : +$("#gAngle").value || 0,
      crs: $("#gCrs").value, zone: $("#gZone").value, datum: $("#gDatum").value, merc: $("#gMerc").value, out: $("#gOut").value, proj4: $("#gProj").value, wkt: $("#gWkt").value,
      line: $("#gLine").checked && v !== "own", ox: +$("#gOx").value || 0, oy: +$("#gOy").value || 0, rule: v === "own" ? "area" : $("#gRule").value,
      site: ticks("gSite"), soil: ticks("gSoil"), depths: depths(), comp: $("#gComp").value,
      wx: $("#gWxOn").checked, src: $("#gWxSrc").value, from: $("#gFrom").value, to: $("#gTo").value, wxVars: ticks("gWx"), monthly: $("#gMonthly").checked, daily: $("#gDaily").checked,
      fill: $("#gFill").checked, units: DS.wxUnits("gu"), dm: $("#gDmOn").checked, dmSpan: +$("#gDmSpan").value,
      models: ticks("gModel"), hold: $("#gHold").value, layers: $("#gLayers").value, mdepths: $("#gMDepths").value,
      files: ticks("gFile") };
  }
  const mid = () => [(area.bb[0] + area.bb[2]) / 2, (area.bb[1] + area.bb[3]) / 2];
  /* the system the cells are laid out in: UTM on WGS 84 or NAD83, in the area's zone or one chosen, Albers or Web Mercator */
  function layoutOf(o) {
    if (o.crs !== "utm") return G.crs(o.crs === "albers" ? 5070 : 3857);
    const cx = mid()[0], home = G.zoneOf(cx), z = o.zone === "auto" ? home : +o.zone, off = Math.abs(cx - (z * 6 - 183));
    if (off > 30) throw new Error(`UTM zone ${z} is ${Math.round(off)}° of longitude from this area: choose one within 30° of it (its own zone is ${home})`);
    return G.crs((o.datum === "nad83" ? 26900 : 32600) + z);
  }
  /* the system of the shapefile and CSV: the layout's, one built in, or the user's proj4 definition with its .prj as given */
  function outOf(o, P) {
    if (o.out === "same") return P;
    if (o.out !== "custom") return G.crs(+o.out);
    const C = G.fromProj4(o.proj4), w = o.wkt.trim();
    if (!w) return C;
    if (!/^[A-Z_]+\s*\[/i.test(w) || (w.match(/\[/g) || []).length !== (w.match(/\]/g) || []).length) throw new Error("the .prj box does not hold WKT, which starts PROJCS[ or GEOGCS[");
    return { ...C, prj: w, given: true };
  }
  /* both systems, or why not: { P, Q, err, outErr, outNote } */
  function crsOf(o) {
    const K = {};
    try { K.P = layoutOf(o); } catch (e) { K.err = `${e.message}.`; return K; }
    try { K.Q = outOf(o, K.P); } catch (e) { K.outErr = `The coordinates of the shapefile and CSV: ${e.message}.`; }
    if (o.out !== "custom") return K;
    if (!o.proj4.trim()) { K.outNote = "Paste the proj4 definition of your system: epsg.io gives it for any EPSG code, as PROJ.4, and its .prj as ESRI WKT."; return K; }
    if (!K.Q) { K.outNote = K.outErr; return K; }
    const [cx, cy] = mid(), [x, y] = K.Q.fwd(cx, cy), f = v => (K.Q.geo ? v.toFixed(6) : fmt(v, 1)), w = o.wkt.trim();
    const prj = !w ? `With no .prj given, one is written from the definition${K.Q.shift ? ", but a .prj cannot hold the +towgs84 shift: give your system's .prj to keep it" : ""}.`
      : /^(PROJ|GEOG|GEOD|COMPOUND|BOUND)CRS\s*\[/i.test(w) ? "The .prj is WKT2, written as given; ArcGIS reads only the older WKT (ESRI WKT on epsg.io)." : "The .prj is written as you gave it.";
    K.outNote = `Read as ${K.Q.desc}. The area's centre is ${f(x)}, ${f(y)} in it: check that in your GIS. ${prj}`;
    return K;
  }
  /* the projection, and the lattice and its window, of the choices made. sc: the layout's scale at the area's centre;
     k: its units in a metre of cell size, which is the scale in Web Mercator sized on the ground, else 1 */
  function setup(o, P) {
    const [cx, cy] = mid(), sc = G.scaleAt(P, cx, cy), k = o.crs === "merc" && o.merc === "ground" ? sc.s : 1;
    const rings = area.polys.map(poly => poly.map(r => r.map(([x, y]) => P.fwd(x, y))));
    if (o.shape === "own") return { P, rings, sc, k };
    // from 0, 0 or the corner given, turned or not, so grids of one size and angle line up
    const ox = o.line ? o.ox : 0, oy = o.line ? o.oy : 0;
    const L = G.lattice({ kind: o.shape.startsWith("hex") ? "hex" : "square", size: o.size * k, angle: o.angle, ox, oy, flat: o.shape === "hexflat" });
    return { P, rings, sc, k, L, W: G.windowOf(L, rings.flat()) };
  }
  /* the coordinate choices that apply, and what they come to here */
  function crsNotes(o, K) {
    $("#gZoneBox").hidden = $("#gDatumBox").hidden = o.crs !== "utm";
    $("#gMercBox").hidden = o.crs !== "merc" || o.shape === "own";
    $("#gOutBox").hidden = o.out !== "custom";
    $("#gOut").options[0].textContent = K.P ? `Same as the layout (EPSG:${K.P.epsg})` : "Same as the layout";
    $("#gOutInfo").textContent = K.outNote || "";
    let t = "";
    if (K.P) {
      const [cx, cy] = mid(), sc = G.scaleAt(K.P, cx, cy), r = v => fmt(v, 4), here = `here 1 m of it is ${r(1 / sc.k)} m on the ground east–west and ${r(1 / sc.h)} m north–south`;
      t = o.shape === "own" ? `Your cells are weighed in ${K.P.name} (EPSG:${K.P.epsg}).` : `Cells are true squares or hexagons in ${K.P.name} (EPSG:${K.P.epsg}).`;
      if (o.crs === "merc") t += ` Its metres are not ground metres away from the equator: ${here}${o.shape === "own" ? "" : `, so ${o.merc === "ground" ? `cells are made ${fmt(sc.s, 3)} times as large in it, to keep their size on the ground at the area's centre` : `a ${+(o.size || 0).toFixed(2)} m cell is about ${fmt((o.size || 0) / sc.s, 2)} m across on the ground`}`}.`;
      else if (Math.max(Math.abs(sc.k - 1), Math.abs(sc.h - 1)) > 1e-3) t += ` Its metres are close to ground metres, but ${here}.`;
    }
    $("#gCrsInfo").textContent = t;
  }
  const areaM2 = () => area.acres * 4046.8564;
  // the model files' link columns: soil_id, wx_id and run_id, those that apply
  const wxLinked = o => o.wx && (wxFiles(o) || siteFiles(o));
  const nLinks = o => (o.models.length ? 1 + soilFiles(o) + wxLinked(o) : 0);
  const nCols = o => o.site.length + o.soil.length * (o.depths ? o.depths.length : 0) + (o.wx ? o.wxVars.length * (o.monthly ? 13 : 1) + 1 : 0) + (o.dm ? (dmWeeks(o) > 1 ? 8 : 1) : 0) + 1 + nLinks(o);
  const wordy = n => (n >= 1e9 ? `${fmt(n / 1e9, 1)} billion` : n >= 1e6 ? `${fmt(n / 1e6, 1)} million` : Math.round(n).toLocaleString());
  /* what these choices come to, and which files they allow */
  function estimate() {
    clearTimeout(estT); estT = 0;
    const o = options(), box = $("#gEstimate"), mine = o.shape === "own", K = crsOf(o);
    let cells, say = "", S = null;
    crsNotes(o, K);
    if (K.err) { box.textContent = K.err; caution(o, 0); return buttons(0, o, null); }
    if (mine) {
      cells = own ? own.polys.length : 0;
      say = own ? `${cells.toLocaleString()} cells in ${own.name}.` : "Choose your grid file. Cells whose centres lie inside the boundary are kept.";
    } else {
      if (!(o.size >= 0.2)) { box.textContent = "The smallest cell is 20 cm."; caution(o, 0); return buttons(0, o, null); }
      S = setup(o, K.P);
      // the area in the layout's square metres; Web Mercator's cells are given on the ground too
      const inP = areaM2() * S.sc.ar, ga = S.L.area / S.sc.ar, merc = o.crs === "merc";
      cells = inP / S.L.area;
      say = merc ? `About ${wordy(cells)} cells of ${fmt(ga, ga < 1 ? 2 : 0)} m² on the ground.` : `About ${wordy(cells)} cells of ${fmt(S.L.area, S.L.area < 1 ? 2 : 0)} m².`;
      // the size to suggest: the smallest whose lattice box (larger than the area when turned) a browser can hold and whose cells some file can take
      const rings = S.rings.flat(), most = (n, W) => Math.max(W.count / MAX.window, Math.min(n / MAX.csv, S.L.hex ? Infinity : (n * nCols(o)) / MAX.values));
      const over = s => { const L2 = G.lattice({ ...S.L, size: s * S.k }); return most(inP / L2.area, G.windowOf(L2, rings)) > 1; };
      if (most(cells, S.W) > 1) {
        // both shrink as 1/size²; then up in whole cm below 10 m, whole m above, past the edges of the box
        const up = v => (v < 10 ? Math.ceil(v * 100 - 1e-6) / 100 : Math.ceil(v - 1e-9));
        let need = up(o.size * Math.sqrt(most(cells, S.W)));
        for (let t = 0; t < 50 && over(need); t++) need = up(need + (need < 10 ? 0.01 : 1));
        const use = `for this area use cells of ${need < 1 ? `${Math.round(need * 100)} cm` : `${+need.toFixed(2)} m`} or more, or a smaller area.`;
        say += S.W.count > MAX.window ? ` That is more than a browser can hold (${wordy(MAX.window)}): ${use}` : ` No file holds that many (a CSV ${wordy(MAX.csv)} rows${S.L.hex ? "" : `, a GeoTIFF ${wordy(MAX.values)} values`}): ${use}`;
      }
      if (o.rule === "area" && cells > MAX.sampled) say += ` Weighing what covers each cell works up to ${wordy(MAX.sampled)} cells; use what lies at the centre, or larger cells.`;
    }
    if (o.soil.length && !(o.depths && o.depths.length)) say += o.depths ? " Give the bottom of each layer for the soil columns." : " Layer bottoms must be positive numbers separated by commas.";
    if (o.wx && o.src === "file" && !wxFile) say += " Choose your weather file under 3 · Weather and drought.";
    const need = mdlInfo(o);
    if (need) say += ` ${need}`;
    if (nCols(o) > MAX.fields) say += ` A shapefile holds ${MAX.fields} columns at most, and these choices make ${nCols(o)}.`;
    if (K.outErr && (o.files.includes("shp") || o.files.includes("csv"))) say += ` ${K.outErr}`;
    buttons(cells, o, S);
    // with no file possible the advice above says why; otherwise say now what Build would refuse
    if (!ticks("gFile").length && $$("input[name=gFile]:not(:disabled)").length) say += ` ${noFile()}`;
    box.textContent = say;
    caution(o, cells, S);
  }
  /* what the model files will hold, under their choices; what they still need is also returned, or "" */
  function mdlInfo(o) {
    const box = $("#gMdlInfo");
    if (!box || !o.models.length) return "";
    const lay = { model: "each model's usual layers", survey: "the horizons as they are", custom: "your depths" }[o.layers];
    const say = [];
    if (soilFiles(o)) say.push(`Soil: ${o.comp === "dominant" ? "each map unit's main soil, the largest with water retention and bulk density" : "each map unit's soils as one profile, each layer the mean of theirs weighted by their %"} (Within a map unit, under 2 · Soil), on ${lay}; miscellaneous areas such as urban land are left out.`);
    if (wxFiles(o) && o.wx) say.push(`Weather: ${wxName(o)}, ${o.from} to ${o.to}, as under 3 · Weather and drought, at each weather cell's elevation.`);
    if (siteFiles(o)) say.push("CENTURY's and DayCent's site files hold a soil with its weather cell's climate, so they are written for each run, a soil with a weather cell.");
    let need = "";
    if (!o.wx && (wxFiles(o) || siteFiles(o))) need = wxFiles(o) ? "The model weather files need the weather: tick Add weather under 3 · Weather and drought, or choose Soil only under 4 · Data for models." : "CENTURY's and DayCent's site files take the climate of the weather cells: tick Add weather under 3 · Weather and drought.";
    else if (o.layers === "custom" && soilFiles(o) && DS.depthsCm(o.mdepths).error) need = DS.depthsCm(o.mdepths).error;
    box.textContent = [...say, need].filter(Boolean).join(" ");
    return need;
  }
  /* what Build will read over the internet and roughly how long it takes, from the choices alone, so it is cheap: the
     weather cells are those the area's box touches, the most it can need; soil and weather read before are kept.
     Times are rough: a gridMET request takes about 1 s and 0.2 s more a year of days (6 at a time; 3 s for 10 years, 8 s
     for 36), 8 s for 10 years of PRISM through ACIS (4 at a time). The model files are counted at most: every map unit
     and weather cell of the area's box, sized by DAY_BYTES and SOIL_BYTES, written at about 10 ms a set. */
  function caution(o, cells, S) {
    const box = $("#gCaution");
    if (!box) return;
    // nothing to say when the cells cannot be built: the estimate says why
    if (!(cells > 0) || (S && S.W.count > MAX.window) || !$$("input[name=gFile]:not(:disabled)").length) { box.textContent = ""; return; }
    const reads = [], s = n => (n === 1 ? "" : "s");
    let secs = o.rule === "area" || o.shape === "own" ? cells / 11000 : (S ? S.W.count / 25e6 : 0) + cells / 4e6;
    const ids = Object.keys(area.result.soil.units), soil = o.site.length || o.soil.length || soilFiles(o) ? ids.filter(k => !soilKept.has(k)).length : 0;
    if (soil) { const q = Math.ceil(soil / 100); reads.push(`the soil layers of ${soil.toLocaleString()} map unit${s(soil)} (${q * 3} Soil Data Access queries)`); secs += Math.ceil(q / 2) * 4; }
    let all = 0, tooMany = "";
    const cellsAll = o.wx && o.src === "file" ? [fileCell()] : [];
    const days = o.from && o.to && o.from <= o.to ? Wd.parseDay(o.to) - Wd.parseDay(o.from) + 1 : 0;
    if (o.wx && o.src === "file" && days) {
      all = 1;
      if (wxFile && !wxRead(o, cellsAll[0].lon, cellsAll[0].lat)) { reads.push(`your file ${wxFile.name}${o.fill ? ", with its gaps filled from gridMET's cell at the area's centre (9 requests)" : ""}`); secs += o.fill ? 3 : 0; }
    } else if (o.wx && days) {
      const g = WX_GRID[o.src], bb = area.bb, [ja, ia] = wxIndex(g, bb[0], bb[1]), [jb, ib] = wxIndex(g, bb[2], bb[3]);
      let need = 0;
      for (let j = Math.min(ja, jb); j <= Math.max(ja, jb); j++) for (let i = Math.min(ia, ib); i <= Math.max(ia, ib); i++) {
        const [lon, lat] = wxCentre(g, j, i);
        all++;
        cellsAll.push({ lon, lat });
        if (!wxRead(o, lon, lat)) need++;
      }
      // gridMET: one request a variable for all the cells, split so none passes 2 million values; a single cell is the same 9
      const gm = need > 1 ? 9 * Math.ceil((all * days) / 2e6) : 9, gmSecs = Math.ceil(gm / 6) * (1 + (0.2 * days) / 365.25 + (3 * Math.min(2e6, all * days)) / 1e6);
      const cellsTxt = `${need} weather cell${s(need)}${need < all ? ` (${all - need} read before)` : ""}`;
      if (need && o.src === "gridmet") { reads.push(`gridMET for ${cellsTxt}: ${gm} requests${need > 1 ? ", all cells at once" : ""}`); secs += gmSecs; }
      else if (need && o.src === "prism") { reads.push(`PRISM for ${cellsTxt}: ${need} request${s(need)} through ACIS${need > 4 ? ", 4 at a time" : ""}, and ${gm} gridMET requests for solar radiation, humidity and wind`); secs += Math.ceil(need / 4) * (2 + (0.6 * days) / 365.25) + gmSecs; }
      else if (need) { reads.push(`NASA POWER for ${cellsTxt}: ${need} request${s(need)}${need > 3 ? ", 3 at a time" : ""}`); secs += Math.ceil(need / 3) * 4; }
      // the box's count is the most there can be: Build counts the cells the grid really uses
      if (all > wxCap(o)) tooMany = ` The area's box spans ${all.toLocaleString()} weather cells, and ${wxCap(o)} is the most ${o.src === "gridmet" ? "gridMET" : o.src === "prism" ? "PRISM" : "NASA POWER"} reads${o.src === "gridmet" ? "" : ` (gridMET reads up to ${MAX.wxCellsGm})`}: if the grid's cells need more, Build stops before reading the weather. Turn the weather off for this area, or draw a smaller one.`;
    }
    // the Drought Monitor: an image of the area's box a week, about 0.4 to 1 s each, 4 at a time (2 over 4 million pixels, as dmRead reads them)
    if (o.dm) {
      const bb = area.bb, nw = dmWeeks(o), side = v => Math.min(DM_MAX, Math.ceil(v / 0.001) + 4), px = side(bb[2] - bb[0]), py = side(bb[3] - bb[1]), at = px * py > 4e6 ? 2 : 4;
      reads.push(`the Drought Monitor's map of ${nw === 1 ? "this week" : `each of ${nw} weeks`}, ${nw === 1 ? "an image" : "images"} of about ${px.toLocaleString()} × ${py.toLocaleString()} pixels (${nw} request${s(nw)}${nw > at ? `, ${at} at a time` : ""}; maps read here in the last 15 days come from this browser)`);
      secs += Math.ceil(nw / at) * (0.5 + (px * py) / 8e6);
    }
    // the model files, at most: every map unit of the area and every weather cell of its box
    let mdl = "";
    if (o.models.length) {
      const nS = soilFiles(o) ? ids.length : 0, nW = wxLinked(o) ? all : 0, wf = wxFiles(o) ? nW : 0, runs = nS * Math.max(1, nW);
      const items = o.models.reduce((t, m) => t + wf + (SITES.includes(m) ? runs : nS), 0);
      const size = o.models.reduce((t, m) => t + wf * (days * DAY_BYTES[m] + 2500) + (SITES.includes(m) ? runs : nS) * (SOIL_BYTES[m] + 2500), 0);
      if (nW && cellsAll.some(c => !elevKept.has(elevKey(o, c)))) { reads.push("the elevation of the weather cells (1 request)"); secs += 1; }
      secs += items * 0.01 + size / 40e6;
      const sites = o.models.filter(m => SITES.includes(m)).map(mName);
      mdl = ` The model files (${o.models.map(mName).join(", ")}) are for up to ${nS ? `${nS.toLocaleString()} soil${s(nS)}` : ""}${nS && wf ? " and " : ""}${wf ? `${wf} weather cell${s(wf)}` : ""}${sites.length && nS ? `, and ${runs.toLocaleString()} run${s(runs)} (a soil with a weather cell), each with a site file for ${sites.join(" and ")}` : ""}, about ${bytes(size)} at most${nW ? "; when the dates have too few years for a model's statistics, 10 complete years of the source are read for each weather cell" : ""}.`;
      if (items > 2000 || size > 300e6) mdl += " That is many files: writing them takes a while, and your browser needs memory for them.";
      // these counts are the most there can be: Build counts the real ones before it reads the weather
      if ((sites.length && nS ? runs * sites.length : 0) > MAX.runs || items > MAX.items) mdl += ` Build writes at most ${MAX.runs.toLocaleString()} site files and ${MAX.items.toLocaleString()} sets of files: if these cells need more, it says so before reading the weather.`;
    }
    const t = secs < 10 ? "a few seconds" : secs < 55 ? `about ${Math.round(secs / 10) * 10} s` : `about ${Math.round(secs / 60)} min`;
    let say = (reads.length ? `Build reads ${reads.join("; ")}. It takes ${t}, roughly.` : `Build reads nothing more over the internet. It takes ${t}.`) + tooMany + mdl;
    if (secs > 30) say += " That is a while: please be patient. A bar shows each step, and Cancel stops it.";
    else if (cells > 2e6) say += " With this many cells, writing the files at Download takes a while: please be patient. A bar shows each step, and Cancel stops it.";
    box.textContent = say;
  }
  /* the file choices these cells allow: a file you ticked is ticked while it is possible, and again when a change makes it possible again */
  function buttons(cells, o, S) {
    const hex = o.shape.startsWith("hex"), mine = o.shape === "own";
    if (!want) want = new Set([hex || mine ? "shp" : "tif"]);
    const list = [["tif", `GeoTIFF, one band per column${hex || mine ? " (square cells only)" : ""}`, !hex && !mine && (S ? S.W.count <= MAX.window && cells * nCols(o) <= MAX.values : false)],
      ["shp", `Shapefile of the cells (up to ${wordy(MAX.shp)}, and ${MAX.fields} columns)`, cells <= MAX.shp && nCols(o) <= MAX.fields], ["geojson", `GeoJSON of the cells (up to ${wordy(MAX.geojson)})`, cells <= MAX.geojson], ["csv", `CSV, one row per cell (up to ${wordy(MAX.csv)})`, cells <= MAX.csv]];
    $("#gFiles").innerHTML = list.map(([k, n, can]) => `<label class="${can ? "" : "off"}"><input type="checkbox" name="gFile" value="${k}" ${can && want.has(k) ? "checked" : ""} ${can ? "" : "disabled"}> ${esc(n)}</label>`).join("");
  }
  /* why Build would save no file, or "" */
  function noFile() {
    if (ticks("gFile").length) return "";
    if (!$$("input[name=gFile]:not(:disabled)").length) return "No file can hold this many cells: use the cell size suggested under the grid, or a smaller area.";
    return "No file that these choices allow is ticked: tick one under Files.";
  }
  async function loadOwn() {
    const f = $("#gOwnFile").files;
    if (!f.length) return;
    try {
      const { gj, name } = await A.parseFiles([...f]), feats = gj.features || (Array.isArray(gj) ? gj.flatMap(x => x.features || []) : []);
      const polys = [];
      feats.forEach(ft => A.geojsonPolys(ft).forEach(p => polys.push({ rings: p, props: ft.properties || {} })));
      if (!polys.length) throw new Error("it has no polygons");
      if (polys.length > MAX.sampled) throw new Error(`it has ${polys.length.toLocaleString()} cells, and ${MAX.sampled.toLocaleString()} is the most`);
      const bb = A.bboxOf(polys[0].rings);
      if (Math.abs(bb[0]) > 180 || Math.abs(bb[1]) > 90) throw new Error("its coordinates are projected: add its .prj file, or upload the whole .zip");
      own = { polys, name };
      $("#gOwnInfo").textContent = "";
      stale(); estimate();
    } catch (e) { own = null; $("#gOwnInfo").textContent = `Could not read it: ${e.message || e}`; estimate(); }
  }

  /* ---------- soil: a value per map unit ---------- */
  const inList = a => a.map(k => +k).join(",");
  async function soilTables(keys, R) {
    const need = keys.filter(k => !soilKept.has(k)), batches = [];
    if (!need.length) return;
    for (let n = 0; n < need.length; n += 100) batches.push(need.slice(n, n + 100));
    let done = 0;
    const tell = () => say(R, "soil", `Reading soil layers: map units ${done.toLocaleString()} of ${need.length.toLocaleString()}`, done, need.length);
    tell();
    // two batches at a time: at most six queries in flight to Soil Data Access
    await until(R, pool(batches, 2, async keys100 => {
      live(R);
      const part = inList(keys100);
      // the fields of the point's soil (js/soil.js), so each map unit also gives a full profile for the model files
      const [comps, hz, restr] = await Promise.all([
        A.sda(`SELECT c.mukey, c.cokey, c.compname, c.comppct_r, c.majcompflag, c.compkind, c.weg, c.wei, c.slope_l, c.slope_r, c.slope_h, c.hydgrp, c.drainagecl, c.albedodry_r, c.tfact, c.elev_r,
          c.taxclname, c.taxorder, c.runoff, c.nirrcapcl, c.nirrcapscl, c.irrcapcl, c.irrcapscl, c.rsprod_r, c.map_r, c.airtempa_r, ma.slopegraddcp
          FROM component c LEFT JOIN muaggatt ma ON ma.mukey = c.mukey WHERE c.mukey IN (${part}) ORDER BY c.mukey, c.comppct_r DESC`),
        A.sda(`SELECT ch.cokey, ch.chkey, ch.hzname, ch.hzdept_r, ch.hzdepb_r, ch.sandtotal_r, ch.silttotal_r, ch.claytotal_r, ch.sandvf_r, ch.om_r, ch.dbthirdbar_r, ch.wthirdbar_r, ch.wfifteenbar_r, ch.wsatiated_r, ch.awc_r, ch.ksat_r,
          ch.ph1to1h2o_r, ch.cec7_r, ch.ecec_r, ch.caco3_r, ch.gypsum_r, ch.ec_r, ch.sar_r, ch.kwfact, ch.kffact, ch.sieveno10_r, ch.frag3to10_r, ch.fraggt10_r, ch.fragvoltot_r, ch.lep_r, tg.texture, tg.texdesc
          FROM chorizon ch LEFT JOIN chtexturegrp tg ON tg.chkey = ch.chkey AND tg.rvindicator = 'Yes' WHERE ch.cokey IN (SELECT cokey FROM component WHERE mukey IN (${part})) ORDER BY ch.cokey, ch.hzdept_r`),
        A.sda(`SELECT cokey, reskind, reshard, resdept_r, resdepb_r FROM corestrictions WHERE cokey IN (SELECT cokey FROM component WHERE mukey IN (${part}))`),
      ]);
      const hzBy = new Map(), reBy = new Map(), by = new Map();
      hz.forEach(h => { if (num(h.hzdepb_r) !== null) hzBy.set(h.cokey, [...(hzBy.get(h.cokey) || []), h]); });
      restr.forEach(r => reBy.set(r.cokey, [...(reBy.get(r.cokey) || []), r]));
      comps.forEach(c => by.set(String(c.mukey), [...(by.get(String(c.mukey)) || []), { ...c, comppct_r: num(c.comppct_r) || 0, horizons: hzBy.get(c.cokey) || [], restrictions: (reBy.get(c.cokey) || []).sort((a, b) => num(a.resdept_r) - num(b.resdept_r)) }]));
      keys100.forEach(k => soilKept.set(k, by.get(k) || []));
      done += keys100.length;
      tell();
      await breathe();
    }));
  }
  /* a component's layers on the chosen bottoms, or null past the end of its profile: nothing is repeated here */
  function compLayers(comp, B) {
    const base = M.surveyLayers(comp).filter(l => ok(l.top) && ok(l.bot) && l.bot > l.top);
    if (!base.length) return B.map(() => null);
    const s = M.relayer({ layers: base }, B);
    return B.map((_, i) => { const l = s.layers[i]; return l && !l.extended ? l : null; });
  }
  /* one number for a map unit from its components: the main one that has it, or the mean weighted by their %; valueOf(comp, its place) */
  function mix(comps, valueOf, how) {
    if (how === "dominant") { for (let i = 0; i < comps.length; i++) { const v = valueOf(comps[i], i); if (ok(v)) return v; } return null; }
    let s = 0, w = 0;
    comps.forEach((c, i) => { const v = valueOf(c, i); if (ok(v) && c.comppct_r > 0) { s += v * c.comppct_r; w += c.comppct_r; } });
    return w ? s / w : null;
  }
  const depthTag = v => String(+UN.conv("depth", v).toFixed(UN.sym("depth") === "in" ? 1 : 0)).replace(".", "p");
  /* the columns of the soil, each with its value for every map unit: lut[id] */
  function soilBands(o, ids, units) {
    const bands = [], n = ids.length + 1, comps = ids.map(k => soilKept.get(k) || []), B = o.depths || [];
    const wegCode = w => (w === "4L" ? 41 : num(w));
    o.site.forEach(k => {
      const d = SITE.find(x => x[0] === k), lut = new Float32Array(n).fill(NO);
      ids.forEach((id, a) => {
        // cf: the C the area panel used (js/area.js), else the map unit's own
        const u = units[id], list = comps[a], cf = u ? (u.cUsed != null ? +u.cUsed : u.C ? +u.C : null) : null, iOf = c => num(c.wei) ?? (c.weg ? WG.soil.WEG_I[c.weg] : null);
        const v = k === "mukey" ? +id : k === "weg" ? mix(list, c => wegCode(c.weg), "dominant") : k === "cf" ? cf
          : k === "wei" ? (ok(mix(list, iOf, o.comp)) ? UN.conv("soilLoss", mix(list, iOf, o.comp)) : null)
            : cf !== null && ok(mix(list, iOf, o.comp)) ? UN.conv("soilLoss", (mix(list, iOf, o.comp) * cf) / 100) : null;
        if (ok(v)) lut[a + 1] = v;
      });
      bands.push({ name: k, short: d[2], label: d[1], unit: k === "wei" || k === "e" ? UN.sym("soilLoss") : "", by: "soil", group: "site", lut, cat: k === "mukey" || k === "weg" });
    });
    // each component's profile on the chosen bottoms, worked out once for all of them
    const lay = B.length && o.soil.length ? comps.map(list => list.map(c => compLayers(c, B))) : [];
    B.forEach((bot, b) => {
      const top = b ? B[b - 1] : 0, tag = `${depthTag(top)}_${depthTag(bot)}`;
      o.soil.forEach(k => {
        const d = SOIL.find(x => x[0] === k), lut = new Float32Array(n).fill(NO);
        ids.forEach((id, a) => {
          const v = mix(comps[a], (c, i) => { const l = lay[a][i][b]; return l ? l[k] : null; }, o.comp);
          if (ok(v)) lut[a + 1] = d[4] ? UN.conv(d[4], v * d[5]) : v;
        });
        bands.push({ name: `${k}_${tag}`, short: `${d[2]}${tag.replace(/_/g, "")}`, label: `${d[1]}, ${fmt(UN.conv("depth", top), 0)}–${fmt(UN.conv("depth", bot), 0)} ${UN.sym("depth")}`, unit: d[4] ? UN.sym(d[4]) : d[3], by: "soil", group: "layer", top0: b === 0, lut });
      });
    });
    return bands;
  }

  /* ---------- weather: a value per weather cell ---------- */
  const wxIndex = (g, lon, lat) => [Math.round((lat - g.lat0) / g.dLat), Math.round((lon - g.lon0) / g.dLon)];
  const wxCentre = (g, j, i) => [g.lon0 + i * g.dLon, g.lat0 + j * g.dLat];
  /* a weather cell's outline with a point every 0.002° at most, as a parallel's image curves away from a straight line
     (44 m over a NASA POWER cell); a side two cells share has the same points in both */
  function wxRing(g, j, i) {
    const nx = Math.ceil(g.dLon / 0.002), ny = Math.ceil(g.dLat / 0.002), x = t => g.lon0 + (i - 0.5 + t / nx) * g.dLon, y = t => g.lat0 + (j - 0.5 + t / ny) * g.dLat, out = [];
    for (let t = 0; t < ny; t++) out.push([x(0), y(t)]);
    for (let t = 0; t < nx; t++) out.push([x(t), y(ny)]);
    for (let t = ny; t > 0; t--) out.push([x(nx), y(t)]);
    for (let t = nx; t > 0; t--) out.push([x(t), y(0)]);
    out.push(out[0]);
    return out;
  }
  /* each weather cell's daily series, or null for one that could not be read: { series, missing [{ n, why }] }. gridMET
     (and PRISM's solar radiation, humidity and wind) is read for all the cells at once, a request a variable, and kept in
     js/wind.js for the calls that follow; a cell that fails is tried once more, then left blank so the rest still build. */
  async function wxSeries(o, cells, R) {
    const d0 = Wd.parseDay(o.from), d1 = Wd.parseDay(o.to), out = new Array(cells.length).fill(null), missing = [], name = wxName(o);
    // your file: one weather for all the cells, read again in the units chosen now, its gaps filled from gridMET as on the data sheet
    if (o.src === "file") {
      const c = cells[0], key = wxKey(o, c.lon, c.lat, c.elev);
      if (!wxKept.has(key)) {
        say(R, "wx", `Reading ${name}`);
        const w = M.parseWeatherCSV(wxFile.text, o.units, c.lat, c.lon, c.elev ?? null);
        wxKept.set(key, await until(R, DS.chosenWeather({ src: "file", file: w, fill: o.fill, site: { lat: c.lat, lon: c.lon }, elev: c.elev ?? null, d0, d1, name }, t => say(R, "wx", t))));
      }
      return { series: [U.clean(wxKept.get(key))], missing };
    }
    // a cell's elevation is known when model files are made; the means need none
    const need = cells.filter(c => !wxKept.has(wxKey(o, c.lon, c.lat, c.elev)));
    try {
      if (o.src !== "power" && need.length > 1) {
        const tell = (d, t) => say(R, "wx", `Reading gridMET${o.src === "prism" ? "'s solar radiation, humidity and wind" : ""} for ${need.length} weather cells at once: request ${d} of ${t}`, d, t);
        tell(0, 9);
        // the tick stops the box's requests at the next one when Cancel is pressed
        await until(R, Wd.gridmetBox(need.map(c => [c.lat, c.lon]), d0, d1, (d, t) => { tell(d, t); live(R); }).catch(e => { if (!R.stop) console.warn("gridMET for all the cells at once failed: a request a cell instead", e); }));
        live(R);
      }
      // PRISM reads ACIS once a cell, 4 cells at a time; NASA POWER 3 at a time; gridMET's requests wait their turn in js/wind.js, 6 at a time
      let next = 0, done = 0;
      const tell = () => say(R, "wx", `Reading ${name}: weather cell ${done} of ${cells.length}`, done, cells.length);
      tell();
      await until(R, Promise.all(Array.from({ length: Math.min(o.src === "power" ? 3 : 4, cells.length) }, async () => {
        while (next < cells.length) {
          const k = next++, c = cells[k], key = wxKey(o, c.lon, c.lat, c.elev);
          for (let t = 0; t < 2 && !wxKept.has(key); t++) {
            live(R);
            try { wxKept.set(key, await Wd.dailyWeather(c.lat, c.lon, d0, d1, o.src, c.elev ?? null)); } catch (e) {
              console.warn(`Weather cell ${k + 1}${t ? ": left blank" : ": trying once more"}`, e);
              if (t) missing.push({ n: k + 1, why: e.message || String(e) });
            }
          }
          if (wxKept.has(key)) out[k] = U.clean(wxKept.get(key));
          done++;
          tell();
        }
      })));
    } finally { Wd.gridmetBox(null); }
    missing.sort((a, b) => a.n - b.n);
    // not one cell answered: a grid with all its weather blank is no use, so the build stops and says why
    if (cells.length && missing.length === cells.length) throw new Error(`${cells.length > 1 ? `none of the ${cells.length} weather cells could be read` : "the weather cell could not be read"} from ${name} (${[...new Set(missing.map(m => m.why))].join("; ")}); try again later, or leave out the weather`);
    return { series: out, missing };
  }
  /* the columns of the weather, each with its value for every weather cell. Rain and ET0 per year, or per calendar
     month, from the days with data, scaled to whole periods; the rest as means. A cell not read is blank. */
  function wxBands(o, series) {
    const bands = [], n = series.length + 1;
    const add = (name, short2, label, unit, value, all) => {
      const lut = new Float32Array(n).fill(NO);
      series.forEach((w, a) => { const v = w || all ? value(w, a) : null; if (ok(v)) lut[a + 1] = v; });
      bands.push({ name, short: short2, label, unit, by: "wx", group: "wx", lut });
    };
    add("wx_cell", "WXCELL", "Weather cell (see weather/cells.csv)", "", (w, a) => a + 1, true);
    bands[0].cat = true;
    const cv = (q, v) => (ok(v) ? (q ? UN.conv(q, v) : v) : null);
    o.wxVars.forEach(k => {
      const d = WX.find(x => x[0] === k), q = d[3], sum = !!d[4], unit = q ? UN.sym(q) : "%";
      const meanOf = (w, month) => {
        let s = 0, c = 0;
        w.days.forEach((day, i) => { const v = w[k] && w[k][i]; if (ok(v) && (month === null || new Date(day * 864e5).getUTCMonth() === month)) { s += v; c++; } });
        return c ? s / c : null;
      };
      add(k, d[2], `${d[1]}${sum ? " per year" : ""}`, sum ? `${unit}/yr` : unit, w => { const m = meanOf(w, null); return m === null ? null : cv(q, sum ? m * 365.25 : m); });
      if (o.monthly) [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31].forEach((days, m) => {
        const tag = String(m + 1).padStart(2, "0");
        add(`${k}_m${tag}`, `${d[2].slice(0, 6)}M${tag}`, `${d[1]}, ${WG.util.MONTHS[m]}`, sum ? `${unit}/month` : unit, w => { const v = meanOf(w, m); return v === null ? null : cv(q, sum ? v * days : v); });
      });
    });
    return bands;
  }

  /* ---------- the U.S. Drought Monitor: a value per pixel of its weekly maps ----------
     NDMC's map service draws each week's map as an image of any box; there is no service that gives the classes as
     values (no WFS or WCS, and its JSON is the whole country), so the images are read back by colour. */
  const DM_SPANS = [[1, "This week's map only"], [52, "The last 52 weeks"], [104, "The last 2 years (104 weeks)"], [261, "The last 5 years (261 weeks)"]];
  const DM_RES = 10, DM_MAX = 4096; // a pixel: 0.001° (10 of 1e-4°) or more, so that a side has at most 4096
  const dmWeeks = o => (o.dmSpan > 1 ? o.dmSpan : 1);
  /* the box the maps are read for, in degrees, and its pixels: about 100 m, coarser for an area wider than about 4°. It
     holds every cell whole: a lattice's cells reach at most a cell beyond the boundary's box, and your own cells are
     taken as they are, only those the grid keeps (bySampling: the centre of the cell's box inside the boundary), so a
     statewide file used for one field asks for the field's maps, not the state's. Its edges are on whole pixels from 0°,
     so an area drawn again asks for the same images, which this browser keeps for 15 days (a past week's map does not
     change). */
  function dmGeo(o, S) {
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    const add = (lon, lat) => { if (lon < w) w = lon; if (lon > e) e = lon; if (lat < s) s = lat; if (lat > n) n = lat; };
    if (o.shape === "own") own.polys.forEach(p => { const b = A.bboxOf(p.rings.map(q => q.map(([x, y]) => S.P.fwd(x, y)))); if (S.rings.some(a => A.inRings((b[0] + b[2]) / 2, (b[1] + b[3]) / 2, a))) p.rings.forEach(r => r.forEach(([x, y]) => add(x, y))); });
    const b = A.bboxOf(S.rings.flat()), m = S.L ? S.L.size : 0, x0 = b[0] - m, y0 = b[1] - m, x1 = b[2] + m, y1 = b[3] + m;
    // a point every 1/32 of each side of the box, as a straight edge in the layout bows in degrees
    for (let t = 0; t <= 32; t++) { const f = t / 32, x = x0 + f * (x1 - x0), y = y0 + f * (y1 - y0); [[x, y0], [x, y1], [x0, y], [x1, y]].forEach(([E, N]) => add(...S.P.inv(E, N))); }
    const q = 1e4, st = Math.max(DM_RES, Math.ceil((Math.max(e - w, n - s) * q) / (DM_MAX - 8))), wi = Math.floor((w * q) / st) * st - 2 * st, si = Math.floor((s * q) / st) * st - 2 * st;
    const W = Math.ceil((e * q - wi) / st) + 2, H = Math.ceil((n * q - si) / st) + 2;
    return { box: [wi / q, si / q, (wi + W * st) / q, (si + H * st) / q], step: st / q, W, H };
  }
  // the pixel of the maps a longitude and latitude fall in, or -1 outside them
  const dmPixel = (g, lon, lat) => { const x = Math.floor((lon - g.box[0]) / g.step), y = Math.floor((g.box[3] - lat) / g.step); return x >= 0 && x < g.W && y >= 0 && y < g.H ? y * g.W + x : -1; };
  // a 16-bit array as a 32-bit one, for numbers past 65,535
  const wide32 = a => { const x = new Uint32Array(a.length); x.set(a); return x; };
  /* numbers the pixels the grid uses 1, 2, … as they are met (pix: each one's place in the images). The numbers stay in
     16 bits until there are more than 65,535, as most grids use far fewer: an image of 4096 × 4096 then takes 33 MB to
     number, not 67, and a window of 50 million cells 100 MB to index, not 200 (dmCentre widens its index the same way) */
  function dmNumbers(g) {
    let seen = new Uint16Array(g.W * g.H);
    const pix = [];
    return { pix, id: p => {
      let v = seen[p];
      if (!v) { pix.push(p); v = pix.length; if (v > 65535 && seen.BYTES_PER_ELEMENT === 2) seen = wide32(seen); seen[p] = v; }
      return v;
    } };
  }
  /* by the cell's centre: each lattice cell's pixel, its centre projected at every st-th cell along a row and in a
     straight line between, as a row of cells bows in degrees by far less than a pixel over 2 km. The pixels the grid
     uses get numbers of their own (dmIdx; dmPix: their place in the images), so only they are read from each week */
  async function dmCentre(res, g, R) {
    const { W, L, P, mask } = res, n = W.count, num = dmNumbers(g), pix = num.pix;
    let idx = new Uint16Array(n);
    const st = Math.max(1, Math.min(32, Math.floor(2000 / L.size))), na = Math.ceil((W.cols - 1) / st) + 1, alon = new Float64Array(na), alat = new Float64Array(na);
    for (let r = 0; r < W.rows; r++) {
      const j = W.j1 - r, base = r * W.cols;
      let any = false;
      for (let c = 0; c < W.cols && !any; c++) any = !!mask[base + c];
      if (!any) continue;
      for (let t = 0; t < na; t++) { const [lon, lat] = P.inv(...L.centre(W.i0 + Math.min(W.cols - 1, t * st), j)); alon[t] = lon; alat[t] = lat; }
      for (let c = 0; c < W.cols; c++) {
        if (!mask[base + c]) continue;
        const t = Math.floor(c / st), u = t + 1 < na ? t + 1 : t, ca = t * st, cb = Math.min(W.cols - 1, ca + st), f = cb > ca ? (c - ca) / (cb - ca) : 0;
        const p = dmPixel(g, alon[t] + (alon[u] - alon[t]) * f, alat[t] + (alat[u] - alat[t]) * f);
        if (p < 0) continue;
        const v = num.id(p);
        if (v > 65535 && idx.BYTES_PER_ELEMENT === 2) idx = wide32(idx);
        idx[base + c] = v;
      }
      if ((r & 255) === 255) { say(R, "cells", "Finding each cell's pixel of the Drought Monitor's maps", r, W.rows); await breathe(); live(R); }
    }
    const N = new Float64Array(pix.length + 1);
    for (let k = 0; k < n; k++) if (idx[k]) N[idx[k]]++;
    Object.assign(res, { dmIdx: idx, dmPix: Uint32Array.from(pix), dmN: N, dmWt: N });
  }
  /* the weeks' maps, read as PNGs of the box (4 at a time; 2 when they are large) and put in their place in turn, each
     pixel the grid uses classed by its colour: under half opaque is no class, else the nearest of the five colours the
     maps draw, as their class edges are smoothed. A pixel keeps counts only: the weeks in each class, its worst class,
     the latest week's class and its longest run of weeks in drought (D1 to D4). A week that does not answer is asked
     once more, then left out of every column (a share is of the weeks read; a run goes on over it). */
  async function dmRead(o, g, pix, wt, R) {
    const Wm = WG.weather, last = await until(R, Wm.usdmDate()), days = [];
    for (let d = Math.max(Wm.USDM_DAY0, last - 7 * (dmWeeks(o) - 1)); d <= last; d += 7) days.push(d);
    const n = pix.length, cnt = new Uint16Array((n + 1) * 6), worst = new Int8Array(n + 1).fill(-1), now = new Int8Array(n + 1), run = new Uint16Array(n + 1), best = new Uint16Array(n + 1);
    const RGB = Wm.DCLASS.slice().reverse().map(c => c[4]), weeks = [];
    let all = 0;
    for (let id = 1; id <= n; id++) all += wt[id];
    // 0 no class, 1 to 5 D0 to D4
    const classOf = (d, q) => {
      if (d[q + 3] < 128) return 0;
      let b = 1, e = Infinity;
      for (let c = 0; c < 5; c++) { const x = RGB[c], dr = d[q] - x[0], dg = d[q + 1] - x[1], db = d[q + 2] - x[2], v = dr * dr + dg * dg + db * db; if (v < e) { e = v; b = c + 1; } }
      return b;
    };
    const get = async d => {
      const url = Wm.usdmMapUrl(d, g.box, g.W, g.H);
      for (let t = 0; ; t++) {
        try { return await createImageBitmap(await WG.util.fetchBlob(url, 60000, /^image\/png/i), { premultiplyAlpha: "none", colorSpaceConversion: "none" }); }
        catch (e) { if (t || R.stop) throw e; }
      }
    };
    const cv = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(g.W, g.H) : Object.assign(document.createElement("canvas"), { width: g.W, height: g.H });
    const cx = cv.getContext("2d", { willReadFrequently: true }), queue = [], ahead = g.W * g.H > 4e6 ? 2 : 4;
    let next = 0, nowDay = null;
    const start = () => { if (next < days.length) { const p = get(days[next++]); p.catch(() => {}); queue.push(p); } };
    for (let t = 0; t < ahead; t++) start();
    for (let w = 0; w < days.length; w++) {
      say(R, "dm", `Reading the Drought Monitor's weekly maps (${g.W.toLocaleString()} × ${g.H.toLocaleString()} pixels each): ${w} of ${days.length}`, w, days.length);
      let bm = null, why = "";
      try { bm = await until(R, queue.shift()); } catch (e) { live(R); why = e.message || String(e); }
      start();
      live(R);
      if (bm && (bm.width !== g.W || bm.height !== g.H)) { why = `the map came as ${bm.width} × ${bm.height} pixels`; bm.close(); bm = null; }
      if (!bm) { weeks.push({ d: days[w], why }); continue; }
      cx.clearRect(0, 0, g.W, g.H);
      cx.drawImage(bm, 0, 0);
      bm.close();
      const data = cx.getImageData(0, 0, g.W, g.H).data, sh = [0, 0, 0, 0, 0, 0];
      for (let id = 1; id <= n; id++) {
        const c = classOf(data, pix[id - 1] * 4);
        cnt[id * 6 + c]++; sh[c] += wt[id];
        if (c - 1 > worst[id]) worst[id] = c - 1;
        now[id] = c - 1;
        if (c >= 2) { if (++run[id] > best[id]) best[id] = run[id]; } else run[id] = 0;
      }
      nowDay = days[w];
      weeks.push({ d: days[w], sh: sh.map(v => (all ? (100 * v) / all : null)) });
      await breathe();
    }
    const read = weeks.filter(x => x.sh).length, lost = weeks.filter(x => !x.sh);
    if (!read) throw new Error(`none of the Drought Monitor's ${days.length > 1 ? `${days.length} weekly maps` : "maps"} could be read (${[...new Set(lost.map(x => x.why))].join("; ")}); try again later, or leave out the Drought Monitor`);
    return { g, n, cnt, worst, now, best, weeks, read, lost, nowDay, last };
  }
  /* the columns of the Drought Monitor, each with its value for every pixel the grid uses: the latest week's class and,
     over more weeks, the share of them in each class or worse (as the Drought Monitor's own statistics count), the worst
     class and the longest run in drought */
  function dmBands(D) {
    const bands = [], n = D.n + 1, iso = Wd.isoDay;
    const add = (name, short2, label, unit, value, cat) => {
      const lut = new Float32Array(n).fill(NO);
      for (let id = 1; id < n; id++) { const v = value(id); if (ok(v)) lut[id] = v; }
      bands.push({ name, short: short2, label, unit, by: "dm", group: "dm", cat, lut });
    };
    add("dm_now", "DM_NOW", `Drought Monitor class, map of ${iso(D.nowDay)} (-1 none, 0-4 D0-D4)`, "", id => D.now[id], true);
    if (D.weeks.length > 1) {
      [[0, "D0-D4 (abnormally dry or worse)"], [1, "D1-D4 (in drought)"], [2, "D2-D4 (severe or worse)"], [3, "D3-D4 (extreme or worse)"], [4, "D4 (exceptional)"]].forEach(([c, t]) =>
        add(`dm_d${c}p`, `DM_D${c}P`, `Weeks in ${t}, ${iso(D.weeks[0].d)} to ${iso(D.last)}`, "%", id => { let s = 0; for (let q = c + 1; q <= 5; q++) s += D.cnt[id * 6 + q]; return (100 * s) / D.read; }));
      add("dm_max", "DM_MAX", "Worst Drought Monitor class of the weeks (-1 none, 0-4 D0-D4)", "", id => D.worst[id], true);
      add("dm_run", "DM_RUN", "Longest run of weeks in drought (D1-D4)", "weeks", id => D.best[id]);
    }
    return bands;
  }
  // a class's colour in the preview, as the maps draw it; no class a pale green
  const dmRgb = v => (v < 0 ? [214, 232, 214] : WG.weather.DCLASS.find(c => c[0] === `D${v}`)[4]);

  /* ---------- filling the cells ---------- */
  /* an index of polygons for finding what lies at a point */
  function polyIndex(items, bb) {
    const nx = 128, cw = Math.max(bb[2] - bb[0], 1) / nx, ch = Math.max(bb[3] - bb[1], 1) / nx, cells = Array.from({ length: nx * nx }, () => []), cl = (v, m) => Math.max(0, Math.min(nx - 1, Math.floor(v / m)));
    items.forEach(it => {
      const b = A.bboxOf(it.rings);
      for (let i = cl(b[0] - bb[0], cw); i <= cl(b[2] - bb[0], cw); i++) for (let j = cl(b[1] - bb[1], ch); j <= cl(b[3] - bb[1], ch); j++) cells[j * nx + i].push(it);
    });
    return (E, N) => cells[cl(N - bb[1], ch) * nx + cl(E - bb[0], cw)].find(it => A.inRings(E, N, it.rings)) || null;
  }
  /* roads as bands of their half-width in ground metres, which are sc.s of the layout's here */
  const roadBands = (ex, P, sc) => ex.roads.flatMap(r => {
    const half = A.roadHalf(r.props.MTFCC) * sc.s, p = r.line.map(([x, y]) => P.fwd(x, y)), out = [];
    for (let k = 0; k + 1 < p.length; k++) out.push(G.bandRing(p[k][0], p[k][1], p[k + 1][0], p[k + 1][1], half));
    return out;
  });
  const projPolys = (list, P) => list.map(p => p.rings.map(r => r.map(([x, y]) => P.fwd(x, y))));

  /* by the cell's centre: polygons painted on the lattice, so any number of cells costs little */
  async function byCentre(o, S, ctx, R) {
    const { W, P } = S, r = area.result, ex = r.ex, n = W.count.toLocaleString(), st = async t => { say(R, "cells", `${t} (${n} cells in the box)`); await breathe(); live(R); };
    await st("Laying out the cells");
    const mask = new Uint8Array(W.count), soilIdx = new Uint16Array(W.count), wxIdx = o.wx ? new Uint16Array(W.count) : null;
    S.rings.forEach(rg => G.paint(W, rg, k => { mask[k] = 1; }));
    const onto = v => k => { if (mask[k] === 1) mask[k] = v; };
    if (ex) {
      await st("Marking buildings, roads and water");
      projPolys(ex.water, P).forEach(rg => G.paint(W, rg, onto(4)));
      roadBands(ex, P, S.sc).forEach(q => G.paint(W, [q], onto(3)));
      projPolys(ex.buildings, P).forEach(rg => G.paint(W, rg, onto(2)));
    }
    await st("Placing the soil map units");
    const idOf = new Map(ctx.ids.map((k, a) => [k, a + 1]));
    r.soil.parts.forEach(p => {
      const rg = p.rings.map(q => q.map(([x, y]) => P.fwd(x, y))), id = idOf.get(String(p.mukey)), water = r.soil.units[p.mukey] && r.soil.units[p.mukey].water;
      G.paint(W, rg, water ? onto(4) : k => { if (mask[k] === 1) soilIdx[k] = id; });
    });
    if (o.wx && o.src === "file") {
      // your file is one weather for every cell
      for (let k = 0; k < W.count; k++) if (mask[k]) wxIdx[k] = 1;
      ctx.wxCells = [fileCell()];
    } else if (o.wx) {
      await st("Placing the weather cells");
      const g = WX_GRID[o.src], bb = area.bb, [j0, i0] = wxIndex(g, bb[0], bb[1]), [j1, i1] = wxIndex(g, bb[2], bb[3]), cells = [], ids = new Map();
      const wxId = (j, i) => { const key = `${j},${i}`; if (!ids.has(key)) { const [lon, lat] = wxCentre(g, j, i); cells.push({ j, i, lon, lat, n: 0 }); ids.set(key, cells.length); } return ids.get(key); };
      // one more all round: a straight edge of the boundary bows past its corners' box
      for (let j = Math.min(j0, j1) - 1; j <= Math.max(j0, j1) + 1; j++) for (let i = Math.min(i0, i1) - 1; i <= Math.max(i0, i1) + 1; i++) {
        const id = wxId(j, i);
        G.paint(W, [wxRing(g, j, i).map(([x, y]) => P.fwd(x, y))], k => { if (mask[k]) wxIdx[k] = id; });
      }
      // the painted edges are within a millimetre of the true ones, so only a cell beside another value can be wrong: those take the weather cell of their centre
      const { rows, cols } = W, near = [];
      for (let r = 0, k = 0; r < rows; r++) for (let c = 0; c < cols; c++, k++) {
        const v = wxIdx[k];
        if (mask[k] && (!v || (c ? wxIdx[k - 1] : 0) !== v || (c < cols - 1 ? wxIdx[k + 1] : 0) !== v || (r ? wxIdx[k - cols] : 0) !== v || (r < rows - 1 ? wxIdx[k + cols] : 0) !== v)) near.push(k);
      }
      near.forEach(k => { const r = Math.floor(k / cols), [lon, lat] = P.inv(...S.L.centre(W.i0 + k - r * cols, W.j1 - r)); wxIdx[k] = wxId(...wxIndex(g, lon, lat)); });
      for (let k = 0; k < wxIdx.length; k++) if (wxIdx[k]) cells[wxIdx[k] - 1].n++;
      // only the weather cells some grid cell falls in, south to north and west to east
      const used = cells.filter(c => c.n).sort((a, b) => a.j - b.j || a.i - b.i), renum = new Uint16Array(cells.length + 1);
      cells.forEach((c, a) => { if (c.n) renum[a + 1] = used.indexOf(c) + 1; });
      for (let k = 0; k < wxIdx.length; k++) if (wxIdx[k]) wxIdx[k] = renum[wxIdx[k]];
      ctx.wxCells = used;
    }
    let count = 0;
    const cover = [0, 0, 0, 0, 0, 0], sN = new Float64Array(ctx.ids.length + 1), wN = new Float64Array(ctx.wxCells ? ctx.wxCells.length + 1 : 1);
    // for model files: the cells of each soil with each weather cell (a pair, soil index x nw1 + weather cell), and where each soil and weather cell lies
    const mo = o.models.length > 0, nw1 = wN.length, pairN = mo ? new Float64Array(sN.length * nw1) : null, sums = mo ? { soil: new Float64Array(sN.length * 3), wx: new Float64Array(nw1 * 3) } : null;
    for (let k = 0; k < W.count; k++) {
      if (!mask[k]) continue;
      if (mask[k] === 1 && !soilIdx[k]) mask[k] = 5;
      count++; cover[mask[k]]++; sN[soilIdx[k]]++;
      if (wxIdx) wN[wxIdx[k]]++;
      if (mo) {
        const s = soilIdx[k], w = wxIdx ? wxIdx[k] : 0, r = Math.floor(k / W.cols), [E, N] = S.L.centre(W.i0 + k - r * W.cols, W.j1 - r);
        pairN[s * nw1 + w]++;
        sums.soil[s * 3] += E; sums.soil[s * 3 + 1] += N; sums.soil[s * 3 + 2]++;
        sums.wx[w * 3] += E; sums.wx[w * 3 + 1] += N; sums.wx[w * 3 + 2]++;
      }
      if (mo && (count & 0x3ffff) === 0) { await breathe(); live(R); }
    }
    return { mode: "centre", S, W, L: S.L, P, mask, soilIdx, wxIdx, count, cover, sN, wN, nw1, pairN, sums };
  }
  // the one weather cell of your file: the area's centre
  const fileCell = () => { const [lon, lat] = mid(); return { j: 0, i: 0, lon, lat, n: 0 }; };
  /* where the grid's cells of soil (or weather cell) a lie, on average, as [lon, lat]; null when none */
  const repOf = (res, which, a) => { const q = res.sums && res.sums[which]; return q && q[a * 3 + 2] ? res.P.inv(q[a * 3] / q[a * 3 + 2], q[a * 3 + 1] / q[a * 3 + 2]) : null; };
  /* by what covers the cell: points in each cell looked up one by one, for any cells, the user's own too */
  async function bySampling(o, S, ctx, R) {
    const { P } = S, r = area.result, ex = r.ex, bb = A.bboxOf(S.rings.flat()), pad = 50, box = [bb[0] - pad, bb[1] - pad, bb[2] + pad, bb[3] + pad], K = 5;
    const list = [], tooMany = n => new Error(`That is ${n.toLocaleString()} cells, and weighing what covers each works up to ${MAX.sampled.toLocaleString()}: use what lies at the centre, or larger cells`);
    say(R, "cells", "Listing the cells");
    await breathe();
    if (o.shape === "own") {
      own.polys.forEach((p, n) => {
        const rg = p.rings.map(q => q.map(([x, y]) => P.fwd(x, y))), b = A.bboxOf(rg), cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
        if (S.rings.some(a => A.inRings(cx, cy, a))) list.push({ rings: rg, cx, cy, b, n, props: p.props, lonlat: p.rings });
      });
      if (!list.length) throw new Error("None of your grid's cells has its centre inside this boundary");
    } else {
      const { W, L } = S, mask = new Uint8Array(W.count);
      let m = 0;
      S.rings.forEach(rg => G.paint(W, rg, k => { if (!mask[k]) m++; mask[k] = 1; }));
      // counted before any cell is listed, so too many is said at once
      if (m > MAX.sampled) throw tooMany(m);
      for (let j = W.j1; j >= W.j0; j--) for (let i = W.i0; i <= W.i1; i++) {
        if (!mask[G.indexOf(W, i, j)]) continue;
        const [cx, cy] = L.centre(i, j), rg = [L.ring(i, j)];
        list.push({ rings: rg, cx, cy, b: A.bboxOf(rg), i, j, k: G.indexOf(W, i, j) });
      }
    }
    if (list.length > MAX.sampled) throw tooMany(list.length);
    const idOf = new Map(ctx.ids.map((k, a) => [k, a + 1]));
    const soilAt = polyIndex(r.soil.parts.map(p => ({ rings: p.rings.map(q => q.map(([x, y]) => P.fwd(x, y))), id: idOf.get(String(p.mukey)), water: r.soil.units[p.mukey] && r.soil.units[p.mukey].water })), box);
    const exAt = ex ? polyIndex([...projPolys(ex.water, P).map(rings => ({ rings, v: 4 })), ...roadBands(ex, P, S.sc).map(q => ({ rings: [q], v: 3 })), ...projPolys(ex.buildings, P).map(rings => ({ rings, v: 2 }))], box) : null;
    const g = o.wx && o.src !== "file" ? WX_GRID[o.src] : null, wxMap = new Map(), weights = new Array(list.length), covers = new Uint8Array(list.length);
    // the Drought Monitor: the pixel of each point, numbered as for the centres (dmCentre)
    const dg = ctx.dmGeo, num = dg ? dmNumbers(dg) : null, pix = num ? num.pix : [];
    for (let c = 0; c < list.length; c++) {
      const cell = list[c], [x0, y0, x1, y1] = cell.b, soil = new Map(), wx = new Map(), dm = dg ? new Map() : null, cov = [0, 0, 0, 0, 0, 0];
      for (let a = 0; a < K; a++) for (let b = 0; b < K; b++) {
        const E = x0 + ((a + 0.5) / K) * (x1 - x0), N = y0 + ((b + 0.5) / K) * (y1 - y0);
        if (!A.inRings(E, N, cell.rings)) continue;
        const [lon, lat] = g || dg ? P.inv(E, N) : [0, 0];
        if (dg) {
          const q = dmPixel(dg, lon, lat);
          if (q >= 0) { const v = num.id(q); dm.set(v, (dm.get(v) || 0) + 1); }
        }
        if (g) {
          const [j, i] = wxIndex(g, lon, lat), key = `${j},${i}`;
          if (!wxMap.has(key)) { const [clon, clat] = wxCentre(g, j, i); wxMap.set(key, { j, i, lon: clon, lat: clat, n: 0, id: wxMap.size + 1 }); }
          const w = wxMap.get(key); w.n++;
          wx.set(w.id, (wx.get(w.id) || 0) + 1);
        }
        const hit = exAt && exAt(E, N);
        if (hit) { cov[hit.v]++; continue; }
        const s = soilAt(E, N);
        if (s && s.water) { cov[4]++; continue; }
        if (!s) { cov[5]++; continue; }
        cov[1]++;
        soil.set(s.id, (soil.get(s.id) || 0) + 1);
      }
      weights[c] = { soil, wx, dm };
      covers[c] = cov.indexOf(Math.max(...cov.slice(1)), 1);
      if (c % 2000 === 0) { say(R, "cells", `Weighing what covers each cell: ${c.toLocaleString()} of ${list.length.toLocaleString()}`, c, list.length); await breathe(); live(R); }
    }
    ctx.wxCells = null;
    if (g) {
      // a cell's weather is that of the one weather cell covering most of it, so it matches its row in weather/cells.csv; only those cells are read
      const all = [...wxMap.values()];
      weights.forEach(w => { let top = 0; w.home = null; w.wx.forEach((n, id) => { if (n > top) { top = n; w.home = all[id - 1]; } }); if (w.home) w.home.used = true; });
      ctx.wxCells = all.filter(c => c.used).sort((a, b) => a.j - b.j || a.i - b.i);
      ctx.wxCells.forEach((c, a) => { c.id = a + 1; });
      weights.forEach(w => { w.home = w.home ? w.home.id : 0; });
    }
    // your file is one weather for every cell
    if (o.wx && o.src === "file") { ctx.wxCells = [fileCell()]; weights.forEach(w => { w.home = 1; }); }
    const cover = [0, 0, 0, 0, 0, 0];
    covers.forEach(v => { cover[v]++; });
    let at = null;
    if (S.W) { at = new Int32Array(S.W.count); list.forEach((c, n) => { at[c.k] = n + 1; }); }
    const res = { mode: "area", S, W: S.W || null, L: S.L || null, P, list, weights, covers, at, count: list.length, cover };
    // each pixel's share of the cells, for drought/weeks.csv: a cell's points split it between its pixels
    if (dg) {
      const wt = new Float64Array(pix.length + 1);
      weights.forEach(w => { let t = 0; w.dm.forEach(v => { t += v; }); w.dm.forEach((v, id) => { wt[id] += v / t; }); });
      Object.assign(res, { dmPix: Uint32Array.from(pix), dmWt: wt });
    }
    if (o.models.length) {
      // for model files a cell's soil is the map unit covering most of it, as in its mukey column (none when buildings,
      // roads or water cover most of it); its pair with its weather cell, and where each soil and weather cell lies
      const nS = ctx.ids.length + 1, nw1 = (ctx.wxCells ? ctx.wxCells.length : 0) + 1, cellSoil = new Uint32Array(list.length), pairN = new Float64Array(nS * nw1), sums = { soil: new Float64Array(nS * 3), wx: new Float64Array(nw1 * 3) };
      list.forEach((cell, c) => {
        const w = weights[c], h = w.home || 0;
        let s = 0, top = 0;
        if (covers[c] === 1) w.soil.forEach((n, id) => { if (n > top) { top = n; s = id; } });
        cellSoil[c] = s;
        pairN[s * nw1 + h]++;
        sums.soil[s * 3] += cell.cx; sums.soil[s * 3 + 1] += cell.cy; sums.soil[s * 3 + 2]++;
        sums.wx[h * 3] += cell.cx; sums.wx[h * 3 + 1] += cell.cy; sums.wx[h * 3 + 2]++;
      });
      Object.assign(res, { nw1, pairN, sums, cellSoil });
    }
    return res;
  }
  /* in the weighed mode each column has one value per cell: a mean of the soils covering it, or for a code the value
     covering the most, counted by value (one group can span map units); the weather of its one weather cell. A cell
     covered mostly by buildings, roads or water has no soil values, as at a centre. */
  async function weigh(res, bands, R) {
    for (let i = 0; i < bands.length; i++) {
      const b = bands[i];
      // the link columns come weighed already (linkBands)
      if (b.by === "mask" || b.vals) continue;
      if (res.count > 20000) { say(R, "cols", `Weighing the columns: ${i} of ${bands.length}`, i, bands.length); await breathe(); live(R); }
      const vals = new Float32Array(res.count).fill(NO);
      res.weights.forEach((w, c) => {
        if (b.by === "wx") { if (w.home) vals[c] = b.lut[w.home]; return; }
        // the Drought Monitor maps the land whatever covers it, as the weather does
        if (b.by !== "dm" && res.covers[c] >= 2 && res.covers[c] <= 4) return;
        let s = 0, t = 0;
        const per = b.cat ? new Map() : null;
        (b.by === "dm" ? w.dm : w.soil).forEach((n, id) => { const v = b.lut[id]; if (v === NO) return; s += v * n; t += n; if (per) per.set(v, (per.get(v) || 0) + n); });
        if (!t) return;
        if (!per) { vals[c] = s / t; return; }
        let top = 0;
        per.forEach((n, v) => { if (n > top) { top = n; vals[c] = v; } });
      });
      b.vals = vals;
    }
  }

  /* ---------- model files: once for each soil, weather cell and run ---------- */
  const MIX_KEYS = ["sand", "silt", "clay", "om", "oc", "bd", "ll", "dul", "sat", "awc", "ksat", "ph", "cec", "caco3", "cfWt", "cfVol", "ec", "kw", "kf", "ni", "sar", "srgf"];
  const BY_MASS = ["om", "oc", "caco3", "ni"];
  // EPIC and APEX want 8.3 names: S and the map unit key, in base 36 when it has more than 7 digits
  const soilStem = id => `S${String(id).length <= 7 ? id : (+id).toString(36).toUpperCase().slice(-7)}`;
  /* a map unit's soils as one profile: each layer the mean of theirs weighted by their % (organic matter, carbon, CaCO3
     and N also by bulk density, as by mass; Ksat too, as the soils lie side by side), a soil that ends above a layer
     leaving it to the others; slope, albedo and drainage rate weighted the same way, the hydrologic group, drainage
     class and family those of the largest. ready [{ s, c }]: the soils on the bottoms B, or as horizons (B null), which
     are then put on all their bottoms */
  function mixSoil(ready, B, mode, id, unit) {
    const bots = B || [...new Set(ready.flatMap(r => U.soilRows(r.s).map(l => Math.round(l.bot))))].filter(v => v > 0).sort((a, b) => a - b);
    const lay = ready.map(r => (B ? r.s.layers : M.relayer(r.s, bots).layers)), pct = r => num(r.c.comppct_r) || 0, out = [];
    for (let i = 0; i < bots.length; i++) {
      const parts = lay.map((L, r) => [L[i], pct(ready[r])]).filter(([l, p]) => l && !l.extended && p > 0);
      if (!parts.length) break;
      const l = { top: parts[0][0].top, bot: parts[0][0].bot, hz: "", texture: "" };
      MIX_KEYS.forEach(k => {
        let s = 0, w = 0;
        parts.forEach(([x, p]) => { if (!ok(x[k])) return; const q = BY_MASS.includes(k) && ok(x.bd) && x.bd > 0 ? p * x.bd : p; s += x[k] * q; w += q; });
        l[k] = w ? s / w : null;
      });
      out.push(l);
    }
    const mean = f => { let s = 0, w = 0; ready.forEach(r => { const v = f(r.s); if (ok(v) && pct(r) > 0) { s += v * pct(r); w += pct(r); } }); return w ? s / w : null; };
    const main = ready[0].s, slope = mean(s => s.slope), t = out[0] ? WG.soil.textureClass(out[0].sand, out[0].silt, out[0].clay) : null;
    return { ...main, id: String(id), mukey: +id, cokey: null, name: (unit && unit.muname) || `Map unit ${id}`, mixed: true,
      source: `USDA-NRCS SSURGO map unit ${id} (${(unit && unit.survey) || ""}), its soils weighted by their %: ${ready.map(r => `${r.c.compname} ${pct(r)}%`).join(", ")}`,
      slope, albedo: mean(s => s.albedo), drainRate: mean(s => s.drainRate), cn: WG.soil.curveNumber(main.hydgrp, slope), u: WG.soil.slu1(t), texture: "",
      layers: out, depth: out.length ? out[out.length - 1].bot : null, layering: B ? "custom" : mode, relayer: null, notes: [] };
  }
  /* the soil the model files take for a map unit, as the point data sheet makes it (M.compSoil): its main soil, the
     largest whose layers have water retention and bulk density (not a miscellaneous area), or all such soils as one
     profile (o.comp "weighted"), on
     the layers chosen (B: custom bottoms). at: where its cells lie. { soil, used [[name, %]], main } or { why } */
  function soilProfile(o, id, unit, comps, B, at) {
    const mu = { mukey: +id, mapunit: { areasymbol: (unit && unit.survey) || "", slopegraddcp: comps[0] ? comps[0].slopegraddcp : null } }, ready = [];
    for (const c of comps) {
      // a miscellaneous area (urban land, rock outcrop, pits) is no soil to grow a crop on, even over buried horizons
      if (!c.horizons.length || /^miscellaneous/i.test(c.compkind || "")) continue;
      let s = null;
      try {
        const s0 = M.compSoil(mu, c, { lat: at[1], lon: at[0], elev: num(c.elev_r) });
        s = B ? M.relayer(s0, B) : { ...s0, layering: o.layers };
        if (!s.layers.length) s = null; else U.soilRows(s);
      } catch (e) { s = null; }
      if (!s) continue;
      ready.push({ s, c });
      if (o.comp === "dominant") break;
    }
    if (!ready.length) return { why: `none of its soils has layers with water retention and bulk density, other than miscellaneous areas (${comps.map(c => `${c.compname} ${num(c.comppct_r) || 0}%`).join(", ") || "it lists no soils"})` };
    const used = ready.map(r => [r.c.compname, num(r.c.comppct_r) || 0]);
    if (ready.length === 1) return { soil: ready[0].s, used, main: ready[0].c === comps[0] };
    return { soil: mixSoil(ready, B, o.layers, id, unit), used, main: true };
  }
  /* the elevation of each weather cell where the grid's cells lie, for its model files and the weather read for them:
     the Copernicus 90 m DEM through Open-Meteo, all the points in one request; failing that, the survey's for the main
     soils there, weighted by their cells; else unknown (null). Read once for the area (elevKept), so a later Build, with
     other cells, takes the same weather again. Sets c.at, c.elev and c.elevSrc */
  async function wxElev(o, cells, res, ids, R) {
    const need = cells.filter(c => !elevKept.has(elevKey(o, c)));
    if (need.length) {
      say(R, "wx", `Reading the elevation of ${need.length === 1 ? "the weather cell" : `the ${need.length} weather cells`}`);
      const at = need.map(c => repOf(res, "wx", cells.indexOf(c) + 1) || [c.lon, c.lat]);
      let z = null;
      try {
        const j = await until(R, WG.util.fetchJSON(`https://api.open-meteo.com/v1/elevation?latitude=${at.map(p => p[1].toFixed(5)).join(",")}&longitude=${at.map(p => p[0].toFixed(5)).join(",")}`, {}, 15000));
        if (Array.isArray(j.elevation) && j.elevation.length === need.length && j.elevation.every(v => Number.isFinite(v))) z = j.elevation;
      } catch (e) { live(R); console.warn("The elevation of the weather cells", e); }
      // a failed read is not kept, so the next Build asks again
      if (z) need.forEach((c, a) => elevKept.set(elevKey(o, c), { at: at[a], elev: +z[a].toFixed(1) }));
    }
    cells.forEach((c, a) => {
      const k = elevKept.get(elevKey(o, c));
      if (k) { c.at = k.at; c.elev = k.elev; c.elevSrc = "the Copernicus 90 m DEM (through Open-Meteo), at the middle of the grid's cells in it when first read for this area"; return; }
      c.at = repOf(res, "wx", a + 1) || [c.lon, c.lat];
      let s = 0, n = 0;
      ids.forEach((id, k) => { const m = res.pairN[(k + 1) * res.nw1 + a + 1], e = m ? num(((soilKept.get(id) || [])[0] || {}).elev_r) : null; if (e !== null) { s += e * m; n += m; } });
      c.elev = n ? +(s / n).toFixed(1) : null;
      c.elevSrc = n ? "the soil survey, the elevation of the main soils of the grid's cells in it (the elevation service did not answer)" : "";
    });
  }
  /* SWAT+ reads one set of tables for a project: each weather cell's and soil's lines are added to them, and the
     SWAT2012 stations are named w + the weather cell (w001pcp ...). true when f was taken */
  function swatMerge(B, f, n) {
    const lines = f.text.split("\n"), add = (name, head, rows) => { const x = B.swat.get(name) || { head, rows: [] }; x.rows.push(...rows.filter(Boolean)); B.swat.set(name, x); };
    if (/^(pcp|tmp|slr|hmd|wnd)\.cli$/.test(f.name) || f.name === "weather-sta.cli" || f.name === "soils.sol") { add(f.name, lines.slice(0, 2), lines.slice(2)); return true; }
    if (f.name === "weather-wgn.cli") { add(f.name, lines.slice(0, 1), lines.slice(1)); return true; }
    if (f.name === "usersoil_soilguard.csv") { add(f.name, lines.slice(0, 1), lines.slice(1)); return true; }
    const list = /^swat2012_format\/(pcp|tmp|slr|hmd|wnd)\.txt$/.test(f.name), row = list ? lines[1].split(",") : null;
    if (list) { const name = `w${pad(n)}${row[1].slice(-3)}`; B.rename.set(`swat2012_format/${row[1]}.txt`, `swat2012_format/${name}.txt`); add(f.name, lines.slice(0, 1), [[n, name, ...row.slice(2)].join(",")]); return true; }
    if (B.rename.has(f.name)) { B.files.push({ name: `models/swatplus/${B.rename.get(f.name)}`, text: f.text }); return true; }
    return false;
  }
  /* one writer's files for a weather cell, soil or run, into the model's folder (B): those with fixed names into a
     folder of their own, DSSAT's profiles into one WG.SOL and SWAT+'s tables into one each, the README into the model's
     README. Returns the link: what names these files in the index and the cells' columns */
  function putFiles(B, kind, tag, fs, n, title) {
    const m = B.m, own = (OWN_DIR[m] || []).includes(kind), dir = m === "swatplus" ? "" : `${kind}/${own ? `${tag}/` : ""}`;
    let link = "", gone = "";
    fs.forEach(f => {
      if (f.name === "README.txt") { B.parts.push(`==== ${title} ====`, f.text.trim(), ""); return; }
      // a site file's weather is its weather cell's file, written once under weather/
      if (kind === "sites" && /\.wth$/.test(f.name)) return;
      if (m === "dssat" && f.name === "WG.SOL") { B.sol.push(f.text); return; }
      if (m === "swatplus" && swatMerge(B, f, n)) return;
      if (/NOT_WRITTEN/.test(f.name)) gone = f.text.split(/\r?\n/)[0];
      const name = `${dir}${own || !/NOT_WRITTEN/.test(f.name) ? "" : `${tag}_`}${f.name}`;
      B.files.push({ name: `models/${m}/${name}`, text: f.text });
      // CENTURY's site files are named alike in site_4.0/ and site_4.5/
      const main = kind === "sites" ? (m === "century" ? /\.100$/ : null) : MAIN[kind === "weather" ? "wx" : "soil"][m];
      if (!link && main && main.test(f.name)) link = kind === "sites" ? f.name.replace(/^.*\//, "") : name;
    });
    if (gone) throw new Error(gone.replace(/^.*? could not be made: /, ""));
    if (m === "dssat") return kind === "weather" ? fs.wsta || "" : fs.soilId || "";
    // SWAT+ names a soil by its map unit key (n), a station by its coordinates
    if (m === "swatplus") return kind === "weather" ? ((fs.find(f => /\.pcp$/.test(f.name)) || {}).name || "").replace(/\.pcp$/, "") : String(n);
    return own ? `${kind}/${tag}/` : link;
  }
  // the area's name in plain letters, for the models' fixed-format files
  const plainName = () => String(area.name).normalize("NFKD").replace(/[^\x20-\x7e]+/g, "").slice(0, 40);
  /* the merged files: DSSAT's WG.SOL with every profile, and SWAT+'s tables with every station and soil */
  function mergedFiles(B) {
    const out = [];
    if (B.sol.length) {
      const body = B.sol.map(t => t.split("\r\n").slice(2).join("\r\n").replace(/(\r\n)+$/, "")).join("\r\n\r\n");
      out.push({ name: "models/dssat/soils/WG.SOL", text: `*SOILS: SoilGuard export, the area grid ${plainName()}: ${B.sol.length} profile${B.sol.length > 1 ? "s" : ""}\r\n\r\n${body}\r\n` });
    }
    B.swat.forEach((x, name) => {
      let head = x.head.slice(), rows = x.rows;
      if (name === "soils.sol") head[0] = `soils.sol: ${rows.filter(r => !/^\s/.test(r)).length} soils of the SoilGuard area grid ${plainName()} - written by SoilGuard`;
      if (name === "weather-sta.cli") head[0] = `weather-sta.cli: written by SoilGuard for the area grid ${plainName()}`;
      if (name === "usersoil_soilguard.csv") rows = rows.map((r, i) => r.replace(/^\d+/, String(i + 1)));
      out.push({ name: `models/swatplus/${name}`, text: [...head, ...rows].join("\n") + "\n" });
    });
    return out;
  }
  /* the model files' plan before any is written: each map unit's soil (worked out once: soils, an earlier plan's), the
     runs of the weather cells read (read(w), w from 1) and the limits on the files a browser is asked for. Build makes
     it before reading the weather too, as if every weather cell answers, so too many files are said at once. */
  function modelPlan(o, J, read, soils) {
    const { res, ids, units } = J, nw1 = res.nw1, P = res.pairN, nWx = (J.wxCells || []).length;
    const soilOn = soilFiles(o), wxOn = wxFiles(o) && o.wx, sitesOn = siteFiles(o) && o.wx, needW = wxLinked(o);
    const soilN = new Float64Array(ids.length + 1);
    for (let a = 0; a <= ids.length; a++) for (let w = 0; w < nw1; w++) soilN[a] += P[a * nw1 + w];
    // each map unit's soil
    let prof = soils ? soils.prof : null, why = soils ? soils.why : null;
    if (!soils) {
      prof = new Array(ids.length + 1).fill(null); why = new Array(ids.length + 1).fill("");
      const B = soilOn && o.layers === "custom" ? DS.depthsCm(o.mdepths).B : null;
      if (soilOn) for (let a = 1; a <= ids.length; a++) {
        if (!soilN[a]) continue;
        const id = ids[a - 1], r = soilProfile(o, id, units[id], soilKept.get(id) || [], B, repOf(res, "soil", a) || mid());
        if (r.soil) prof[a] = r; else why[a] = r.why;
      }
    }
    // the runs: a soil with a weather cell, or either alone when the files hold only that
    const runOf = new Float64Array(P.length), runs = [], at = new Map();
    for (let a = 0; a <= ids.length; a++) for (let w = 0; w < nw1; w++) {
      const n = P[a * nw1 + w];
      if (!n || (soilOn && !prof[a]) || (needW && !(w && read(w)))) continue;
      const k = (soilOn ? a : 0) * nw1 + (needW ? w : 0);
      if (!at.has(k)) { runs.push({ id: runs.length + 1, a: soilOn ? a : 0, w: needW ? w : 0, n: 0 }); at.set(k, runs.length); }
      runs[at.get(k) - 1].n += n;
      runOf[a * nw1 + w] = at.get(k);
    }
    const siteN = sitesOn ? runs.length * o.models.filter(m => SITES.includes(m)).length : 0;
    if (siteN > MAX.runs) throw new Error(`CENTURY's and DayCent's site files are written for each run, a soil with a weather cell, and these choices make ${siteN.toLocaleString()} of them (${MAX.runs.toLocaleString()} at most): leave those models out, or use a smaller area`);
    const wxItems = wxOn ? Array.from({ length: nWx }, (_, a) => a).filter(a => read(a + 1)) : [], soilItems = soilOn ? prof.map((p, a) => (p ? a : 0)).filter(Boolean) : [];
    const items = o.models.reduce((t, m) => t + wxItems.length + (SITES.includes(m) ? (sitesOn ? runs.length : 0) : soilItems.length), 0);
    if (items > MAX.items) throw new Error(`these choices make ${items.toLocaleString()} sets of model files (${MAX.items.toLocaleString()} at most): fewer models, or a smaller area`);
    return { soilOn, wxOn, sitesOn, soilN, prof, why, runs, runOf, wxItems, soilItems, items };
  }
  /* each model's files for the area: the soils (one profile a map unit), the weather cells' daily weather at their
     elevation, the 10 complete years a model's statistics may need, and the runs (each soil with each weather cell that
     some cell has); then the files, the index and the link columns. J: { res, ids, units, wxCells, series, soils (the
     plan made before the weather was read) } */
  async function modelData(o, J, R) {
    const { res, ids, series } = J, cells = J.wxCells || [], nw1 = res.nw1, Wr = M.writers, d0 = Wd.parseDay(o.from), d1 = Wd.parseDay(o.to);
    say(R, "models", "Listing the runs, each soil with its weather cells");
    await breathe(); live(R);
    const { soilOn, wxOn, sitesOn, soilN, prof, why, runs, runOf, wxItems, soilItems, items } = modelPlan(o, J, w => !!series[w - 1], J.soils);
    // the 10 complete years a weather cell's files may need (TAV and AMP, generator statistics, climate lines): gridMET
    // for all the cells at once, as for the weather, kept for the reads that follow
    const clim = new Array(cells.length).fill(null);
    if (wxOn || sitesOn) {
      const list = cells.map((c, a) => [series[a] ? DS.climateNeed(o.models, wxOn ? series[a] : null, sitesOn, o.src) : null, a]).filter(([n]) => n);
      if (list.length) {
        const first = list[0][0], y1 = await until(R, DS.climYear(first.cs));
        // the cells whose 10 years an earlier Build has not read
        const fresh = list.filter(([n, a]) => !climKept.has(DS.climateKey(n, { lat: cells[a].lat, lon: cells[a].lon }, cells[a].elev ?? null, y1)));
        try {
          // PRISM reads only its own temperatures when they are all it needs (some)
          if ((first.cs === "gridmet" || (first.cs === "prism" && !first.some)) && fresh.length > 1) {
            const tell = (d, t) => say(R, "models", `Reading 10 complete years of gridMET for ${fresh.length} weather cells at once, for ${first.what}: request ${d} of ${t}`, d, t);
            tell(0, 9);
            await until(R, Wd.gridmetBox(fresh.map(([, a]) => [cells[a].lat, cells[a].lon]), Wd.epochDay(y1 - 9, 0, 1), Wd.epochDay(y1, 11, 31), (d, t) => { tell(d, t); live(R); }).catch(e => { if (!R.stop) console.warn("gridMET's 10 years for all the cells at once failed: a request a cell instead", e); }));
          }
          let done = 0;
          say(R, "models", `Reading 10 complete years of ${first.src} for ${first.what}: weather cell 0 of ${list.length}`, 0, list.length);
          await until(R, pool(list, 4, async ([n, a]) => {
            live(R);
            const c = cells[a];
            clim[a] = { clim: n, ...(await DS.climateRead(n, { lat: c.lat, lon: c.lon }, c.elev ?? null, climKept)) };
            say(R, "models", `Reading 10 complete years of ${n.src} for ${n.what}: weather cell ${++done} of ${list.length}`, done, list.length);
          }));
        } finally { Wd.gridmetBox(null); }
      }
    }
    // DSSAT's station codes, one for each weather cell and none twice
    const codes = new Map(), A36 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    wxItems.forEach(a => {
      let k = U.dssatStation(cells[a]);
      for (let t = 0; t < 36 && [...codes.values()].includes(k); t++) k = k.slice(0, 3) + A36[(A36.indexOf(k[3]) + 1) % 36];
      codes.set(a, k);
    });
    // the files, model by model, with the time between batches given back to the page
    const out = [], by = {}, links = [];
    let done = 0, t0 = Date.now(), chars = 0;
    const tick = async what => {
      done++;
      if (Date.now() - t0 < 60) return;
      say(R, "models", what, done, items);
      await breathe(); live(R); t0 = Date.now();
    };
    for (const m of o.models) {
      const name = MNAME[m], B = { m, files: [], parts: [], sol: [], swat: new Map(), rename: new Map(), failed: [] }, link = { wx: new Map(), soil: new Map(), site: new Map() };
      const one = (what, fn) => {
        try { return fn(); } catch (e) {
          console.warn(`${name}, ${what}`, e);
          B.failed.push({ what, why: String(e.message || e).replace(new RegExp(`^${name.split(" ")[0].replace(/\+/g, "\\+")}: `), "") });
          return "";
        }
      };
      say(R, "models", `Writing the ${name} files`, done, items);
      for (const a of wxItems) {
        const c = cells[a], cl = clim[a] || {}, wx = c.elev === null || c.elev === undefined ? { ...series[a], elev: null } : series[a];
        const ctx = { wx, climWx: cl.climWx || null, soil: null, site: { name: `${area.name}, weather cell ${a + 1}`, lat: c.lat, lon: c.lon, elev: c.elev ?? null }, wind: null, d0, d1, wsta: m === "dssat" ? codes.get(a) : undefined };
        const l = one(`weather cell ${a + 1}`, () => putFiles(B, "weather", `wx${pad(a + 1)}`, Wr[m](ctx), a + 1, `Weather cell ${a + 1} (wx_id ${a + 1}), ${o.src === "file" ? "your file" : `its centre ${c.lat.toFixed(4)}, ${c.lon.toFixed(4)}`}`));
        if (l) link.wx.set(a + 1, l);
        await tick(`Writing the ${name} files: weather cell ${a + 1} of ${cells.length}`);
      }
      if (!SITES.includes(m)) for (const a of soilItems) {
        const id = ids[a - 1], s = prof[a].soil;
        const ctx = { wx: null, climWx: null, soil: s, site: { name: `${area.name}, map unit ${id}`, lat: s.lat, lon: s.lon, elev: s.elev ?? null }, wind: null, d0, d1, stem: soilStem(id) };
        const l = one(`soil ${id}`, () => putFiles(B, "soils", soilStem(id), Wr[m](ctx), +id, `Soil ${id} (soil_id ${id}): ${s.name}`));
        if (l) link.soil.set(+id, l);
        await tick(`Writing the ${name} files: soil ${soilItems.indexOf(a) + 1} of ${soilItems.length}`);
      }
      if (SITES.includes(m) && sitesOn) for (const r of runs) {
        const id = ids[r.a - 1], s = prof[r.a].soil, c = cells[r.w - 1], cl = clim[r.w - 1] || {}, wxl = link.wx.get(r.w);
        const wx = !wxOn ? null : c.elev === null || c.elev === undefined ? { ...series[r.w - 1], elev: null } : series[r.w - 1];
        const ctx = { wx, climWx: cl.climWx || null, soil: s, site: { name: `${area.name}, run ${r.id}`, lat: c.lat, lon: c.lon, elev: c.elev ?? null }, wind: null, d0, d1, stem: `R${pad(r.id, 4)}`, wth: wxl ? wxl.replace(/^.*\//, "") : undefined };
        const l = one(`run ${r.id} (soil ${id}, weather cell ${r.w})`, () => putFiles(B, "sites", `R${pad(r.id, 4)}`, Wr[m](ctx), r.id, `Run ${r.id} (run_id ${r.id}): soil ${id}, ${s.name}, with weather cell ${r.w}`));
        if (l) link.site.set(r.id, l);
        await tick(`Writing the ${name} files: run ${r.id} of ${runs.length}`);
      }
      const files = [...B.files, ...mergedFiles(B)];
      files.push({ name: `models/${m}/README.txt`, text: mdlReadme(m, B, link, wxItems.length, soilItems.length) });
      if (B.failed.length) files.push({ name: `models/${m}/NOT_WRITTEN.txt`, text: `${B.failed.length} of the ${name} sets of files could not be made:\r\n${B.failed.map(f => `  ${f.what}: ${f.why}`).join("\r\n")}\r\nThe others are complete; README.txt lists them.\r\n` });
      chars += files.reduce((t, f) => t + f.text.length, 0);
      if (chars > MAX.text) throw new Error(`the model files would pass ${bytes(MAX.text)}, more than a browser can safely pack: fewer models, a shorter period or a smaller area`);
      by[m] = { files, size: files.reduce((t, f) => t + f.text.length, 0), failed: B.failed, wx: link.wx.size, soil: link.soil.size, site: link.site.size };
      out.push(...files);
      const S0 = MSHORT[m], what = { dssat: ["the profile's ID_SOIL in soils/WG.SOL", "the weather station, WSTA"], swatplus: ["the soil's name in soils.sol", "the weather station's name in weather-sta.cli"] }[m] || ["the soil's file", "the weather cell's file"];
      if (link.soil.size) links.push({ name: `${m}_soil`, short: `${S0}_SOIL`, label: `${name}: ${what[0]} (models/${m}/)`, of: "soil_id", map: link.soil, group: "link", text: true });
      if (link.wx.size) links.push({ name: `${m}_wx`, short: `${S0}_WX`, label: `${name}: ${what[1]} (models/${m}/)`, of: "wx_id", map: link.wx, group: "link", text: true });
      if (link.site.size) links.push({ name: `${m}_site`, short: `${S0}_SITE`, label: `${name}: the run's site file (models/${m}/sites/)`, of: "run_id", map: link.site, group: "link", text: true });
    }
    const data = { models: o.models, files: out, by, links, prof, why, soilN, runs, runOf, nw1, cells, series, codes, clim, wxOn, soilOn, sitesOn };
    out.push(...indexFiles(o, J, data));
    return data;
  }
  /* a model's README: how its folder is laid out and linked, then the data sheet's README of each part */
  function mdlReadme(m, B, link, nw, ns) {
    const name = MNAME[m], s = n => (n === 1 ? "" : "s"), parts = [nw && `${nw} weather cell${s(nw)}`, SITES.includes(m) ? link.site.size && `${link.site.size} run${s(link.site.size)}` : ns && `${ns} soil${s(ns)}`].filter(Boolean).join(", ");
    const lay = {
      dssat: ["weather/: the .WTH files of every weather cell: copy them all into C:\\DSSAT48\\Weather.", "soils/WG.SOL: every soil profile in one file: copy it into C:\\DSSAT48\\Soil (or add its profiles to your WG.SOL).",
        "In FileX, each field's WSTA and ID_SOIL are the DSSAT_WX and DSSAT_SOIL columns of its cells, or the run's in ../runs.csv."],
      swatplus: ["Every file is for TxtInOut: a station for each weather cell (pcp.cli and the other lists, weather-sta.cli and weather-wgn.cli name them all), and soils.sol and the QSWAT+ table usersoil_soilguard.csv with a soil for each map unit, named by its soil_id.",
        "swat2012_format/: the stations in the SWAT2012 text format, named w + the wx_id (w001pcp ...), ID = wx_id."],
      epic: ["weather/: the .DLY, .WP1 and .WND of each weather cell, named W + its coordinates. soils/: S + the soil_id .SOL.", "Number them in the list files (WDLSTCOM.DAT and the others): each part below shows ID 901 as an example."],
      apex: ["weather/: the .DLY, .WP1 and .WND of each weather cell, named W + its coordinates. soils/: S + the soil_id .SOL.", "Number them in the list files (WDLSTCOM.DAT and the others): each part below shows ID 901 as an example."],
      apsim: ["weather/: a .met for each weather cell. soils/: S + the soil_id _soil.apsimx."],
      aquacrop: ["weather/: the .CLI with its .Tnx, .ETo and .PLU (and the AquaCrop-OSPy file) of each weather cell. soils/: S + the soil_id .SOL."],
      century: ["weather/: the .wth of each weather cell.", "sites/site_4.0/ and sites/site_4.5/: R + the run_id .100, the site file of each run: a soil with the climate of its weather cell, as CENTURY keeps them in one file."],
      daycent: ["weather/: the .wth of each weather cell.", "sites/R + the run_id/: the site file, soils.in and sitepar.in of each run: a soil with the climate of its weather cell, as DayCent keeps them together."],
      csv: ["weather/wx + the wx_id/: daily_weather.csv. soils/S + the soil_id/: soil_layers.csv and soil_site.csv."],
    }[m];
    const L = [`${name} files from SoilGuard for the area grid ${area.name}${parts ? `: ${parts}` : ""}. Made ${new Date().toISOString().slice(0, 10)}.`, "",
      "Each weather cell, soil and run has its files once; the grid's cells point to them with wx_id, soil_id and run_id (and the model's own columns in the shapefile, GeoJSON and CSV). ../runs.csv lists each run with its files.", ...lay.map(t => `  ${t}`), "",
      ...(B.failed.length ? ["Not written (NOT_WRITTEN.txt says why):", ...B.failed.map(f => `  ${f.what}: ${f.why}`), ""] : []),
      "Below, the README the point data sheet writes for each part, as for one location.", "", ...B.parts];
    return L.join("\r\n") + "\r\n";
  }
  /* models/: README.txt, and the index of the soils, weather cells and runs with the files of each model */
  function indexFiles(o, J, d) {
    const { ids, units, res } = J, L = res.L, cellArea = L ? L.area / (res.S.sc ? res.S.sc.ar : 1) : null, ms = d.models, out = [];
    const lk = (m, kind, key) => { const l = d.links.find(x => x.name === `${m}_${kind}`); return l ? l.map.get(key) || "" : ""; };
    const n0 = v => (v === null || v === undefined ? "" : v);
    if (d.soilOn) out.push({ name: "models/soils.csv", text: X.csv(["soil_id", "Map unit symbol", "Map unit", "Grid cells", "Profile", "Soils in it (% of the map unit)", "Layers (bottoms, cm)", "No model soil because", ...ms.filter(m => !SITES.includes(m)).map(m => `${m} soil`)],
      ids.map((id, k) => [id, k + 1]).filter(([, a]) => d.soilN[a]).map(([id, a]) => {
        const p = d.prof[a], u = units[id] || {}, s = p && p.soil, rows = s ? (() => { try { return U.soilRows(s); } catch (e) { return s.layers; } })() : [];
        return [id, u.musym || "", u.muname || "", d.soilN[a], s ? s.name : "", p ? p.used.map(x => `${x[0]} ${x[1]}%`).join("; ") : "", rows.map(l => +(+l.bot).toFixed(1)).join(" "), d.why[a], ...ms.filter(m => !SITES.includes(m)).map(m => lk(m, "soil", +id))];
      })) });
    if (d.cells.length && (d.wxOn || d.sitesOn)) out.push({ name: "models/weather.csv", text: X.csv(["wx_id", "Longitude of its centre", "Latitude of its centre", "Longitude of its grid cells", "Latitude of its grid cells", "Elevation (m)", "Elevation from", "Source", "Read", ...(d.wxOn ? ms.map(m => `${m} weather`) : [])],
      d.cells.map((c, a) => [a + 1, +c.lon.toFixed(5), +c.lat.toFixed(5), c.at ? +c.at[0].toFixed(5) : "", c.at ? +c.at[1].toFixed(5) : "", n0(c.elev), c.elevSrc || "", wxName(o), d.series[a] ? "yes" : "no: see README.txt", ...(d.wxOn ? ms.map(m => lk(m, "wx", a + 1)) : [])])) });
    out.push({ name: "models/runs.csv", text: X.csv(["run_id", "soil_id", "wx_id", "Grid cells", ...(cellArea ? ["Area (m2)"] : []), ...ms.flatMap(m => [...(d.soilOn ? [SITES.includes(m) ? `${m} site` : `${m} soil`] : []), ...(d.wxOn ? [`${m} weather`] : [])])],
      d.runs.map(r => { const id = r.a ? ids[r.a - 1] : ""; return [r.id, id, r.w || "", r.n, ...(cellArea ? [+(r.n * cellArea).toFixed(1)] : []), ...ms.flatMap(m => [...(d.soilOn ? [SITES.includes(m) ? lk(m, "site", r.id) : lk(m, "soil", +id)] : []), ...(d.wxOn ? [lk(m, "wx", r.w)] : [])])]; })) });
    const failed = ms.filter(m => d.by[m].failed.length).map(m => `${MNAME[m]}: ${d.by[m].failed.length}`);
    const noSoil = d.why.filter(Boolean).length, missing = d.series.filter(w => !w).length;
    // the weather cells whose files needed 10 complete years: those read, and those that could not be
    const got = d.clim.filter(c => c && c.climWx), lost = d.clim.filter(c => c && !c.climWx);
    out.push({ name: "models/README.txt", text: [`Model files from SoilGuard for the area grid ${area.name}: ${ms.map(m => MNAME[m]).join(", ")}.`, "",
      "They are the files of the point data sheet, written once for each soil, weather cell and run rather than for every grid cell, so a spatial run reads each one once and joins its results back to the cells:",
      ...(d.soilOn ? [`  soil_id: the cell's map unit (its key in SSURGO), whose soil is ${o.comp === "dominant" ? "its main soil, the largest with water retention and bulk density" : "its soils as one profile, each layer the mean of theirs weighted by their %"} (miscellaneous areas such as urban land and rock outcrop left out), on ${{ model: "each model's usual layers", survey: "the horizons as they are", custom: "your custom depths" }[o.layers]}. soils.csv lists them.`] : []),
      ...(d.wxOn || d.sitesOn ? [`  wx_id: the cell's weather cell (the same as wx_cell), ${wxName(o)} ${o.from} to ${o.to}, read at its elevation. weather.csv lists them.`] : []),
      "  run_id: the cell's soil with its weather cell, one model run. runs.csv lists each run, its grid cells and area, and each model's files for it.",
      "  The shapefile, GeoJSON and CSV of the cells also hold each model's file names or IDs (DSSAT_SOIL, DSSAT_WX and so on), when those columns are ticked.",
      "A cell covered mostly by buildings, roads or water, or whose map unit has no soil with water retention and bulk density (only urban land or rock outcrop, say), has no soil_id and no run.", "",
      ...ms.map(m => `${m}/: ${MNAME[m]}, ${by(d.by[m])}. Its README.txt says how the folder is laid out, then gives the data sheet's README for each part.`),
      ...(noSoil ? ["", `${noSoil} map unit${noSoil > 1 ? "s have" : " has"} no model soil: soils.csv says why.`] : []),
      ...(missing ? [`${missing} weather cell${missing > 1 ? "s" : ""} could not be read, so ${missing > 1 ? "they have" : "it has"} no weather files and no runs: see the grid's README.txt.`] : []),
      ...(failed.length ? [`Some files could not be made (${failed.join("; ")}): each model's NOT_WRITTEN.txt says why.`] : []),
      ...(got.length ? ["", `10 complete years of the source were read for ${got.length} weather cell${got.length > 1 ? "s" : ""}, for ${got[0].clim.what}, because ${got[0].clim.why}; each part's README says where.`] : []),
      ...(lost.length ? ["", `The 10 complete years the files' statistics need could not be read for ${lost.length} weather cell${lost.length > 1 ? "s" : ""} (${[...new Set(lost.map(c => c.climError))].join("; ")}): ${lost.length > 1 ? "their" : "its"} files use what the chosen dates give, and each part's README says what that is.`] : []),
      ].join("\r\n") + "\r\n" });
    return out;
    function by(b) { return [b.wx && `${b.wx} weather cell${b.wx > 1 ? "s" : ""}`, b.soil && `${b.soil} soil${b.soil > 1 ? "s" : ""}`, b.site && `${b.site} site file${b.site > 1 ? "s" : ""}`].filter(Boolean).join(", ") || "no files"; }
  }
  /* models/README.txt without the model folders left out at download, and a line that says which and that the index still names them */
  function indexReadme(text, all, off) {
    const names = l => l.map(m => MNAME[m]).join(", "), lines = text.split("\r\n").filter(l => !off.some(m => l.startsWith(`${m}/: `)));
    const head = `: ${names(all)}.`, on = all.filter(m => !off.includes(m));
    if (lines[0].endsWith(head)) lines[0] = lines[0].slice(0, -head.length) + `: ${names(on)}.`;
    lines.splice(1, 0, "", `Left out at download: ${names(off)}. runs.csv, soils.csv and weather.csv still name their files, which are not in this zip.`);
    return lines.join("\r\n");
  }
  /* the link columns: soil_id (a map unit with a model soil), wx_id (a weather cell read) and run_id, for each cell */
  function linkBands(o, d, ids, res) {
    const out = [], n = ids.length + 1;
    if (d.soilOn) { const lut = new Float32Array(n).fill(NO); d.prof.forEach((p, a) => { if (p) lut[a] = +ids[a - 1]; }); out.push({ name: "soil_id", short: "SOIL_ID", label: "Soil of the model files: its map unit key (models/soils.csv)", unit: "", by: "soil", cat: true, group: "link", lut }); }
    if (wxLinked(o)) { const lut = new Float32Array(d.nw1).fill(NO); d.series.forEach((w, a) => { if (w) lut[a + 1] = a + 1; }); out.push({ name: "wx_id", short: "WX_ID", label: "Weather cell of the model files (models/weather.csv; as wx_cell)", unit: "", by: "wx", cat: true, group: "link", lut }); }
    const lut = new Float32Array(d.runOf.length).fill(NO);
    d.runOf.forEach((r, k) => { if (r) lut[k] = r; });
    out.push({ name: "run_id", short: "RUN_ID", label: "Run of the model files: a soil with a weather cell (models/runs.csv)", unit: "", by: "pair", cat: true, group: "link", lut });
    // weighed cells: their soil is the map unit covering most of them, as for the runs
    if (res.mode === "area") out.forEach(b => { if (b.by !== "wx") b.vals = Float32Array.from(res.weights, (w, c) => b.lut[b.by === "soil" ? res.cellSoil[c] : res.cellSoil[c] * d.nw1 + (w.home || 0)]); });
    return out;
  }

  /* ---------- build ---------- */
  async function build() {
    flush();
    if (busy) return;
    const o = options(), status = t => { $("#gStatus").textContent = t; };
    if (o.shape !== "own" && !(o.size >= 0.2)) return toast("The smallest cell is 20 cm.");
    if (o.shape === "own" && !own) return toast("Choose your grid file first.");
    if (!o.depths && o.soil.length) return toast("Layer bottoms must be positive numbers separated by commas.");
    if (o.soil.length && !o.depths.length) return toast("Give the bottom of each layer, or untick the soil columns for each layer.");
    if (o.files.includes("shp") && nCols(o) > MAX.fields) return toast(`A shapefile holds ${MAX.fields} columns at most, and these choices make ${nCols(o)}.`);
    if (o.wx && !o.wxVars.length && !wxLinked(o)) return toast("Tick at least one weather column, or leave out the weather.");
    if (o.wx && !(o.from && o.to && o.from <= o.to)) return toast("Choose a first day before the last day.");
    if (!o.site.length && !o.soil.length && !o.wx && !o.dm && !o.models.length) return toast("Tick at least one soil or weather column, the Drought Monitor, or a model under 4 · Data for models.");
    if (o.wx && o.src === "file" && !wxFile) return toast("Choose your weather file under 3 · Weather.");
    if (o.wx && o.src === "file" && !(o.units.windHeight >= 0.5 && o.units.windHeight <= 50)) return toast("Give the height your file's wind was measured at, between 0.5 and 50 m.");
    if (mdlInfo(o)) return toast(mdlInfo(o));
    if (noFile()) return toast(noFile());
    const K = crsOf(o);
    if (K.err) return toast(K.err);
    if (K.outErr && (o.files.includes("shp") || o.files.includes("csv"))) return toast(K.outErr);
    // the soil is read for its columns, and for the model files
    const soilOn = o.site.length || o.soil.length || soilFiles(o), at = gen;
    const R = begin("build", [...(soilOn ? ["soil"] : []), "cells", ...(o.wx ? ["wx"] : []), ...(o.dm ? ["dm"] : []), ...(o.models.length ? ["models"] : []), "cols"]);
    try {
      // dates outside the source's record are left out, as on the data sheet; none inside it is an error
      let moved = "";
      if (o.wx) {
        const last = o.src === "power" || (o.src === "file" && !o.fill) ? null : await until(R, Wd.gridmetLast());
        const r = DS.wxRange(o.src, o.fill, o.src === "file" ? { days: wxFile.w.days, name: wxFile.name } : null, last), a = Wd.parseDay(o.from), b = Wd.parseDay(o.to), span = `${Wd.dayLabel(r.first)} – ${Wd.dayLabel(r.last)}`;
        if (b < r.first || a > r.last) throw new Error(`these dates are outside ${r.what} (${span})`);
        if (a < r.first || b > r.last) {
          o.from = Wd.isoDay(Math.max(a, r.first)); o.to = Wd.isoDay(Math.min(b, r.last));
          $("#gFrom").value = o.from; $("#gTo").value = o.to;
          moved = ` Dates outside ${r.what} (${span}) were left out: the weather covers ${o.from} to ${o.to}.`;
        }
      }
      const S = setup(o, K.P);
      if (S.W && S.W.count > MAX.window) throw new Error(`That is more cells than a browser can hold (${wordy(S.W.count)} in the area's bounding box)`);
      const units = area.result.soil.units, ids = Object.keys(units), ctx = { ids, dmGeo: o.dm ? dmGeo(o, S) : null };
      if (soilOn) await soilTables(ids, R);
      live(R);
      const res = o.rule === "area" || o.shape === "own" ? await bySampling(o, S, ctx, R) : await byCentre(o, S, ctx, R);
      live(R);
      if (o.dm && res.mode === "centre") await dmCentre(res, ctx.dmGeo, R);
      live(R);
      let series = [], missing = [], mdl = null, plan = null, dm = null;
      if (o.wx && ctx.wxCells.length > wxCap(o)) throw new Error(`The area crosses ${ctx.wxCells.length} weather cells, and ${wxCap(o)} is the most to read${o.src === "gridmet" ? "" : ` (gridMET reads up to ${MAX.wxCellsGm})`}. Turn the weather off for this area, or draw a smaller one`);
      // the model soils, and the limits on their files as if every weather cell answers, before the weather is read
      if (o.models.length) {
        say(R, "cells", "Working out each map unit's soil for the model files");
        await breathe(); live(R);
        plan = modelPlan(o, { res, ids, units, wxCells: ctx.wxCells }, () => true);
      }
      if (o.wx) {
        // model files take the weather at each weather cell's elevation
        if (wxLinked(o)) await wxElev(o, ctx.wxCells, res, ids, R);
        ({ series, missing } = await wxSeries(o, ctx.wxCells, R));
      }
      if (o.dm) dm = await dmRead(o, ctx.dmGeo, res.dmPix, res.dmWt, R);
      if (o.models.length) mdl = await modelData(o, { res, ids, units, wxCells: ctx.wxCells, series, soils: plan }, R);
      say(R, "cols", "Working out the columns");
      await breathe();
      live(R);
      const bands = [{ name: "cover", short: "COVER", label: "What covers the cell (1 open land, 2 building, 3 road, 4 water, 5 no soil data)", unit: "", by: "mask", cat: true, group: "cover", lut: Float32Array.from([NO, 1, 2, 3, 4, 5]) },
        ...(soilOn ? soilBands(o, ids, units) : []), ...(o.wx ? wxBands(o, series) : []), ...(dm ? dmBands(dm) : []), ...(mdl ? linkBands(o, mdl, ids, res) : [])];
      const seen = new Set();
      bands.forEach(b => { let s = b.short.slice(0, 10).toUpperCase(), n = 1; while (seen.has(s)) s = `${b.short.slice(0, 8).toUpperCase()}${n++}`; seen.add(s); b.short = s; });
      if (res.mode === "area") await weigh(res, bands, R);
      // a choice changed, or the sheet was opened again, while this ran: these cells are not what the sheet now says
      if (gen !== at) throw new Error("the choices changed while it was building; build it again");
      say(R, "cols", "Drawing the preview");
      await breathe();
      live(R);
      job = { o, res, bands, series, ids, units, wxCells: ctx.wxCells, missing, mdl, links: mdl ? mdl.links : [], moved, wxFileName: o.wx && o.src === "file" ? wxFile.name : null, dm };
      // every column and model folder is ticked for the download at first
      chosen = new Set(columns(job).map(b => b.name)); zipMdl = new Set(mdl ? mdl.models : []);
      colBox();
      stats();
      $("#gBand").innerHTML = bands.map((b, i) => `<option value="${i}">${esc(b.label)}${b.unit ? ` (${esc(b.unit)})` : ""}</option>`).join("");
      $("#gBand").value = bands.length > 1 ? "1" : "0";
      $("#gPvSec").hidden = $("#gDlSec").hidden = false;
      preview();
      zipList();
      $("#gPvSec").scrollIntoView({ behavior: "smooth", block: "start" });
      const c = res.cover, left = [2, 3, 4, 5].filter(k => c[k]).map(k => `${COVER[k]} ${c[k].toLocaleString()}`).join(", ");
      const nw = ctx.wxCells ? ctx.wxCells.length : 0, one = missing.length === 1, gap = missing.length ? ` Weather could not be read for weather cell${one ? "" : "s"} ${missing.map(m => m.n).join(", ")} (${missing.length} of ${nw}), even after trying twice (${[...new Set(missing.map(m => m.why))].join("; ")}): ${one ? "its" : "their"} weather columns are blank. Build again later to try ${one ? "it" : "them"} again.` : "";
      const dmGap = dm && dm.lost.length ? ` ${dm.lost.length} of the Drought Monitor's ${dm.weeks.length} weekly maps could not be read, even after trying twice (${[...new Set(dm.lost.map(x => x.why))].join("; ")}): its columns leave ${dm.lost.length > 1 ? "them" : "it"} out.` : "";
      status(`${res.count.toLocaleString()} cells, ${bands.length} columns${left ? `; ${left}` : ""}, built in ${took((Date.now() - R.t0) / 1000)}.${mdl ? ` ${mdlSummary(mdl)}` : ""} Nothing is saved yet: look over the preview, then choose the columns and Download the zip below.${moved}${gap}${dmGap}`);
    } catch (e) {
      if (R.quiet) status("");
      else if (gen !== at) status("You changed something while it was building: build it again.");
      else if (R.stop) status("Stopped: nothing was built. Your choices are kept, and the soil and weather read so far are kept for the next Build.");
      else {
        console.error(e);
        job = null;
        $("#gPvSec").hidden = $("#gDlSec").hidden = true;
        status(`Could not build it: ${e.message || e}.`);
      }
    }
    finish(R);
  }
  /* what the model files came to, for the status line */
  function mdlSummary(d) {
    const s = n => (n === 1 ? "" : "s"), ns = d.prof.filter(Boolean).length, nw = d.series.filter(Boolean).length, size = d.files.reduce((t, f) => t + f.text.length, 0);
    const fails = d.models.filter(m => d.by[m].failed.length).map(m => `${mName(m)} ${d.by[m].failed.length}`), none = d.why.filter(Boolean).length;
    return `Model files (${d.models.map(mName).join(", ")}): ${[d.soilOn && `${ns} soil${s(ns)}`, (d.wxOn || d.sitesOn) && `${nw} weather cell${s(nw)}`, `${d.runs.length.toLocaleString()} run${s(d.runs.length)}`].filter(Boolean).join(", ")}, ${bytes(size)}.`
      + (none ? ` ${none} map unit${s(none)} with cells ${none > 1 ? "have" : "has"} no soil with water retention and bulk density, so no model soil (models/soils.csv says why).` : "")
      + (fails.length ? ` Some could not be made (${fails.join(", ")}): see NOT_WRITTEN.txt in those folders.` : "");
  }
  /* one cell's value: index in the window for lattice cells, or place in the list */
  const valueAt = (J, b, k) => {
    const r = J.res;
    if (r.mode === "centre") return b.by === "pair" ? b.lut[r.soilIdx[k] * r.nw1 + (r.wxIdx ? r.wxIdx[k] : 0)] : b.lut[(b.by === "soil" ? r.soilIdx : b.by === "wx" ? r.wxIdx : b.by === "dm" ? r.dmIdx : r.mask)[k]];
    const n = r.at ? r.at[k] : k + 1;
    if (!n) return NO;
    return b.by === "mask" ? r.covers[n - 1] || NO : b.vals[n - 1];
  };
  function stats() {
    const { res, bands } = job;
    const rows = bands.map(b => {
      let lo = Infinity, hi = -Infinity, s = 0, c = 0;
      if (res.mode === "centre") {
        const N = b.by === "soil" ? res.sN : b.by === "wx" ? res.wN : b.by === "dm" ? res.dmN : b.by === "pair" ? res.pairN : res.cover;
        b.lut.forEach((v, a) => { if (v !== NO && N[a]) { if (v < lo) lo = v; if (v > hi) hi = v; s += v * N[a]; c += N[a]; } });
      } else if (b.vals) {
        b.vals.forEach(v => { if (v !== NO) { if (v < lo) lo = v; if (v > hi) hi = v; s += v; c++; } });
      } else res.covers.forEach(v => { if (v) { if (v < lo) lo = v; if (v > hi) hi = v; s += v; c++; } });
      b.lo = lo; b.hi = hi;
      const f = v => (c ? fmt(v, Math.abs(v) >= 100 ? 1 : 2) : "–");
      return `<tr><td>${esc(b.name)}</td><td class="l">${esc(b.label)}</td><td>${esc(b.unit)}</td><td>${b.cat ? "–" : f(lo)}</td><td>${b.cat ? "–" : f(s / (c || 1))}</td><td>${b.cat ? "–" : f(hi)}</td><td>${c.toLocaleString()}</td></tr>`;
    });
    $("#gStats").innerHTML = `<thead><tr><th>Column</th><th class="l">What it holds</th><th>Unit</th><th>Lowest</th><th>Mean</th><th>Highest</th><th>Cells with a value</th></tr></thead><tbody>${rows.join("")}</tbody>`;
  }

  /* ---------- preview ---------- */
  const RAMP = [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]];
  const CATS = ["#4e79a7", "#f28e2b", "#e15759", "#76b7b2", "#59a14f", "#edc948", "#b07aa1", "#ff9da7", "#9c755f", "#bab0ac", "#86bc86", "#d4a6c8"];
  const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  function preview() {
    if (!job) return;
    const b = job.bands[+$("#gBand").value], c = $("#gCanvas"), { res } = job, { P, L, W } = res;
    const w = Math.max(240, Math.min(c.parentElement.clientWidth - 2, 860)), rings = res.S.rings.flat(), bb = A.bboxOf(rings), ar = (bb[3] - bb[1]) / Math.max(bb[2] - bb[0], 1), h = Math.max(160, Math.min(480, Math.round(w * ar)));
    // a large grid is drawn at screen resolution, and many polygons as their boxes without outlines, so it stays quick
    const big = res.count > 250000, quick = !L && res.list.length > 50000, ratio = big ? 1 : window.devicePixelRatio || 1, pw = Math.round(w * ratio), ph = Math.round(h * ratio);
    c.width = pw; c.height = ph; c.style.width = `${w}px`; c.style.height = `${h}px`;
    const x = c.getContext("2d"), sc = Math.max((bb[2] - bb[0]) / pw, (bb[3] - bb[1]) / ph) * 1.02, cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2;
    const toE = px => cx + (px - pw / 2) * sc, toN = py => cy - (py - ph / 2) * sc, toPx = (E, N) => [pw / 2 + (E - cx) / sc, ph / 2 - (N - cy) / sc];
    // the colour of a value, worked out once for each value
    const cats = new Map(), seen = new Map();
    const colour = v => {
      if (b.cat) { if (!cats.has(v)) cats.set(v, b.group === "dm" ? dmRgb(v) : hexRgb(CATS[cats.size % CATS.length])); return cats.get(v); }
      let c = seen.get(v);
      if (!c) {
        const t = b.hi > b.lo ? Math.min(1, Math.max(0, (v - b.lo) / (b.hi - b.lo))) : 0.5, s = t * (RAMP.length - 1), a = Math.min(RAMP.length - 2, Math.floor(s)), f = s - a;
        seen.set(v, (c = RAMP[a].map((q, i) => Math.round(q + (RAMP[a + 1][i] - q) * f))));
      }
      return c;
    };
    x.clearRect(0, 0, pw, ph);
    if (L) {
      const img = x.createImageData(pw, ph), d = img.data, cols = W.cols;
      for (let py = 0; py < ph; py++) for (let px = 0; px < pw; px++) {
        const [u, vv] = L.toUV(toE(px + 0.5), toN(py + 0.5));
        let i, j;
        if (!L.hex) { i = Math.floor(u / L.du); j = Math.floor(vv / L.dv); } else {
          // the nearest centre of the three rows around
          let best = Infinity;
          const j0 = Math.round(vv / L.dv);
          for (let q = j0 - 1; q <= j0 + 1; q++) { const ii = Math.round(u / L.du - L.shift(q)), du = (ii + L.shift(q)) * L.du - u, dv = q * L.dv - vv, e = du * du + dv * dv; if (e < best) { best = e; i = ii; j = q; } }
        }
        if (i < W.i0 || i > W.i1 || j < W.j0 || j > W.j1) continue;
        const k = (W.j1 - j) * cols + i - W.i0;
        if (res.mode === "centre" ? !res.mask[k] : !res.at[k]) continue;
        const v = valueAt(job, b, k);
        const q = (py * pw + px) * 4;
        if (v === NO) { d[q] = d[q + 1] = d[q + 2] = 222; d[q + 3] = 255; continue; }
        const rgb = colour(v);
        d[q] = rgb[0]; d[q + 1] = rgb[1]; d[q + 2] = rgb[2]; d[q + 3] = 255;
      }
      x.putImageData(img, 0, 0);
      // the cells themselves, when they are large enough to see
      const cellPx = L.size / sc;
      if (cellPx >= 7 * ratio && res.count <= 6000) {
        x.strokeStyle = "rgba(255,255,255,.65)"; x.lineWidth = ratio * 0.6; x.beginPath();
        for (let j = W.j0; j <= W.j1; j++) for (let i = W.i0; i <= W.i1; i++) {
          const k = (W.j1 - j) * cols + i - W.i0;
          if (res.mode === "centre" ? !res.mask[k] : !res.at[k]) continue;
          L.ring(i, j).forEach(([E, N], t) => { const [a, bb2] = toPx(E, N); if (t) x.lineTo(a, bb2); else x.moveTo(a, bb2); });
        }
        x.stroke();
      }
    } else {
      const lines = res.list.length <= 5000;
      x.strokeStyle = "rgba(255,255,255,.6)"; x.lineWidth = ratio * 0.5;
      res.list.forEach((cell, n) => {
        const v = b.by === "mask" ? res.covers[n] : b.vals[n], rgb = v === NO ? [222, 222, 222] : colour(v);
        x.fillStyle = `rgb(${rgb.map(Math.round).join(",")})`;
        if (quick) { const [a0, b0] = toPx(cell.b[0], cell.b[3]), [a1, b1] = toPx(cell.b[2], cell.b[1]); x.fillRect(a0, b0, Math.max(1, a1 - a0), Math.max(1, b1 - b0)); return; }
        x.beginPath();
        cell.rings.forEach(rg => rg.forEach(([E, N], t) => { const [a, bb2] = toPx(E, N); if (t) x.lineTo(a, bb2); else x.moveTo(a, bb2); }));
        x.fill("evenodd");
        if (lines) x.stroke();
      });
    }
    const note = $("#gPvNote");
    note.hidden = !(big || quick);
    note.textContent = `A large grid: the preview is drawn ${big ? "at screen resolution" : ""}${big && quick ? ", and " : ""}${quick ? "with each of your cells as its box" : ""} to keep it quick. The files hold every cell as it is.`;
    // the boundary
    x.strokeStyle = "#111"; x.lineWidth = 1.5 * ratio; x.beginPath();
    rings.forEach(r => r.forEach(([E, N], t) => { const [a, bb2] = toPx(E, N); if (t) x.lineTo(a, bb2); else x.moveTo(a, bb2); }));
    x.stroke();
    void P;
    const bar = RAMP.map(q => `rgb(${q.join(",")})`).join(",");
    const name = v => (b.by === "mask" ? COVER[v] : b.name === "weg" && v === 41 ? "4L" : b.group === "dm" ? (v < 0 ? "no drought class" : `D${v}`) : fmt(v, 0));
    $("#gLegend").innerHTML = b.cat ? [...cats].slice(0, 24).map(([v, rgb]) => `<span><i style="background:rgb(${rgb.join(",")})"></i>${esc(name(v))}</span>`).join("") + (cats.size > 24 ? `<span>+${cats.size - 24} more</span>` : "")
      : `<span>${fmt(b.lo, 2)}</span><i class="grid-ramp" style="background:linear-gradient(90deg,${bar})"></i><span>${fmt(b.hi, 2)} ${esc(b.unit)}</span><span><i style="background:#dedede"></i>no value</span>`;
  }

  /* ---------- files ---------- */
  const NOTE = "Values are NoData (-9999) where the source has none.";
  function readme(J, Q) {
    const { o, res, bands } = J, P = res.P, L = res.L, shapeTxt = { square: "square, north up", turned: `square, turned ${o.angle}° clockwise`, hex: `hexagons, points up${o.angle ? `, turned ${o.angle}°` : ""}`, hexflat: `hexagons, flat side up${o.angle ? `, turned ${o.angle}°` : ""}`, own: `your grid, ${own ? own.name : ""}` }[o.shape];
    const sc = res.S.sc, merc = o.crs === "merc", f = o.files, ca = L ? L.area / (merc ? sc.ar : 1) : 0, sys = C => (C.epsg ? `${C.name} (EPSG:${C.epsg})` : `custom, ${C.desc}: ${C.proj4}`);
    const size = !L ? "" : !merc ? `size ${o.size} m` : o.merc === "ground" ? `size ${o.size} m on the ground at the area's centre, ${fmt(L.size, 3)} m in Web Mercator` : `size ${o.size} m in Web Mercator, about ${fmt(o.size / sc.s, 2)} m on the ground at the area's centre`;
    const lines = [`SoilGuard area grid: ${area.name}`, `Made ${new Date().toISOString().slice(0, 10)} with ${location.origin}${location.pathname}`, "",
      `Cells: ${res.count.toLocaleString()}, ${shapeTxt}${L ? `, ${size} (${fmt(ca, ca < 1 ? 3 : 1)} m2 each${merc ? " on the ground" : ""}; a hexagon's size is its width across the flats)` : ""}.`,
      `Layout: ${sys(P)}; ${L ? "the cells are true squares or hexagons in it" : "your cells are weighed in it"}. At the area's centre 1 m of it is ${fmt(1 / sc.k, 4)} m on the ground east-west and ${fmt(1 / sc.h, 4)} m north-south.${L ? ` Origin of the lattice: ${L.ox}, ${L.oy}. Rows and columns are whole steps from it, so two grids of ${o.angle ? "one size, angle" : "one size"} and origin line up.${merc && o.merc === "ground" ? " Sized on the ground, a Web Mercator cell's size in its own metres changes with latitude, so another area's grid lines up with this one only when both are sized in its own metres." : ""}` : ""}`,
      ...(f.includes("shp") || f.includes("csv") ? [`Shapefile and CSV x, y: ${Q === P ? "the layout's." : `${sys(Q)}${Q.geo ? ", longitude and latitude in degrees" : ""}; ${L ? "every corner and centre reprojected from the layout, with a point at least every 100 m along an edge so it stays within 0.3 mm of the true one" : "your cells' corners reprojected from your file's longitudes and latitudes"}.`}${Q.given ? " The .prj is the WKT you gave." : !Q.epsg && Q.shift ? " Its .prj, written from the definition, cannot hold the +towgs84 shift." : ""}`] : []),
      ...(f.includes("geojson") ? [`GeoJSON: WGS 84 longitude and latitude (EPSG:4326), as RFC 7946 asks, whatever the choice above${L ? ", with a point at least every 100 m along an edge" : ""}.`] : []),
      ...(f.includes("tif") && L && !L.hex ? [`GeoTIFF: the layout's coordinates (EPSG:${P.epsg}), as a raster cannot be reprojected without resampling its cells.`] : []),
      "Longitudes and latitudes on NAD83 and WGS 84 are taken as the same, as EPSG:1188 (NAD83 to WGS 84 (1)) does; they differ by 1-2 m in the lower 48. crs.txt gives each system's proj4 definition and WKT.",
      o.rule === "area" || o.shape === "own" ? `A cell's value: weighted by what covers it, from 25 points in the cell's box; a code (map unit, group, weather cell) is the one covering the most${o.wx ? ", and the weather columns are that weather cell's" : ""}.` : "A cell's value: what lies at its centre. A cell is in the grid when its centre is inside the boundary.", "",
      "How much detail this holds: finer cells line up with other grids but add no information. The soil survey is mapped at 1:12,000 to 1:24,000 and each map unit mixes soils without showing where each one lies; the weather comes in cells of 4 km or more.", "",
      `Soil: USDA-NRCS SSURGO through Soil Data Access; within a map unit ${o.comp === "dominant" ? "the main soil that has the value" : "all its soils, weighted by their %"}. A layer below the end of a profile is left blank.`,
      area.result.ex ? "Buildings (FEMA/ORNL USA Structures), roads (Census TIGER, widened by road class) and water (USGS NHD, and SSURGO Water map units) are marked in the cover column, and such cells have no soil values." : "Buildings and roads were not marked; SSURGO Water map units are.",
      o.wx && o.src === "file" ? `Weather: your file ${J.wxFileName}, ${o.from} to ${o.to}, one weather for every cell (wx_cell 1, at the area's centre)${o.fill ? ", its gaps filled from gridMET's cell there" : ""}, values no station reports left out. weather/cells.csv gives its means${o.daily ? " and weather/daily_cell_001.csv its days" : ""}.${J.moved}`
        : o.wx ? `Weather: ${WX_GRID[o.src].name}, ${o.from} to ${o.to}, values no station reports left out. Each grid cell gives the means of its weather cell (wx_cell); weather/cells.csv lists them${o.daily ? " and weather/ has their daily tables" : ""}.${o.src === "prism" ? ` ${Wd.prismNote((J.series || []).some(Boolean) ? J.series.find(Boolean).rest : "gridMET")}` : ""}${J.moved}` : "Weather: not asked for.",
      ...(J.dm ? dmReadme(J) : []),
      ...(o.wx && J.missing && J.missing.length ? [`Weather could not be read for weather cell${J.missing.length > 1 ? "s" : ""} ${J.missing.map(m => m.n).join(", ")} of ${J.wxCells.length}, even after trying twice (${[...new Set(J.missing.map(m => m.why))].join("; ")}): ${J.missing.length > 1 ? "their weather columns are NoData and they have" : "its weather columns are NoData and it has"} no daily table. Build again later to read ${J.missing.length > 1 ? "them" : "it"}.`] : []),
      ...(J.mdlOn && J.mdlOn.length ? ["", `Model files: models/ holds ${J.mdlOn.map(m => MNAME[m]).join(", ")} files, written once for each soil, weather cell and run as the point data sheet writes them. The columns soil_id (the map unit), wx_id (the weather cell) and run_id (the two together) link each cell to them, and models/runs.csv lists each run's files; models/README.txt says more.${J.links.length ? " The shapefile, GeoJSON and CSV also hold each model's file names or IDs (the columns in bands.csv without a band)." : ""}${J.mdlOn.length < J.mdl.models.length ? ` Left out at download: ${J.mdl.models.filter(m => !J.mdlOn.includes(m)).map(m => MNAME[m]).join(", ")} (the index still names them).` : ""}`] : []),
      "", NOTE, `bands.csv lists every column with its unit${J.links.length ? ", and the model link columns, which hold text and so are not in the GeoTIFF" : ""}; soil_units.csv lists the map units.`, "Files:", ...(o.files.includes("tif") ? ["  grid.tif: GeoTIFF, Float32, Deflate, one band per column, named as in bands.csv."] : []),
      ...(o.files.includes("shp") ? ["  cells.shp (.shx, .dbf, .prj, .cpg): one polygon per cell; field names are the short names in bands.csv."] : []),
      ...(o.files.includes("geojson") ? ["  cells.geojson: one polygon per cell, in longitude and latitude."] : []), ...(o.files.includes("csv") ? ["  cells.csv: one row per cell, with its centre: x, y as above, lon, lat on WGS 84."] : []),
      "", "Bands:", ...bands.map((b, i) => `  ${i + 1}. ${b.name} (${b.short}): ${b.label}${b.unit ? `, ${b.unit}` : ""}`),
      ...(J.links.length ? ["Model link columns (text; shapefile, GeoJSON and CSV only):", ...J.links.map(l => `  ${l.name} (${l.short}): ${l.label}`)] : [])];
    return lines.join("\r\n") + "\r\n";
  }
  /* the Drought Monitor's lines of the README: its weeks, how the maps were read and the class coding */
  function dmReadme(J) {
    const D = J.dm, g = D.g, iso = Wd.isoDay, n = D.weeks.length, f = v => +v.toFixed(4);
    return [`Drought Monitor: the U.S. Drought Monitor's ${n > 1 ? `weekly maps of ${iso(D.weeks[0].d)} to ${iso(D.last)} (${n} weeks, ${D.read} read)` : `map of ${iso(D.last)}`}, each read from NDMC's map service (WMS GetMap, ndmcgeodata.unl.edu) as a PNG of the box ${f(g.box[0])}, ${f(g.box[1])} to ${f(g.box[2])}, ${f(g.box[3])} (longitude, latitude) at ${g.step}° a pixel, ${g.W} x ${g.H} pixels (about ${Math.round(g.step * 111320 * Math.cos((((g.box[1] + g.box[3]) / 2) * Math.PI) / 180))} m east-west, ${Math.round(g.step * 110950)} m north-south). `
      + "Each pixel is classed by its colour: under half opaque is no drought class, else the nearest of the five colours the maps draw (D0 255,255,0; D1 255,211,127; D2 255,170,0; D3 230,0,0; D4 115,0,0), as the class edges are smoothed; a pixel on an edge may take either class. "
      + (J.res.mode === "centre" ? "A cell takes the pixel under its centre." : "A cell takes, for dm_now and dm_max, the class of most of its 25 points and, for the others, the mean of its points' values."),
      `  dm_now: the class on the map of ${iso(D.nowDay)}.${n > 1 ? " dm_d0p, dm_d1p, dm_d2p, dm_d3p, dm_d4p: % of the weeks read in D0-D4, D1-D4 (in drought), D2-D4, D3-D4 and D4, as the Drought Monitor's own statistics count; dm_max: the worst class of the weeks; dm_run: the longest run of weeks in D1-D4." : ""}`,
      "  Class code: -1 no drought class (normal or wet; also outside the United States, which the maps leave blank), 0 D0 abnormally dry, 1 D1 moderate, 2 D2 severe, 3 D3 extreme, 4 D4 exceptional drought.",
      `  drought/weeks.csv: each week's % of the grid's cells in each class${J.res.mode === "centre" ? "" : " (a cell split between its points' classes)"}.${D.lost.length ? ` ${D.lost.length} map${D.lost.length > 1 ? "s" : ""} could not be read, even after trying twice (${[...new Set(D.lost.map(x => x.why))].join("; ")}): left out of every column (a run goes on over ${D.lost.length > 1 ? "them" : "it"}), and blank in weeks.csv.` : ""}`,
      `  ${WG.weather.USDM_CREDIT}`];
  }
  /* each system in the files, with its proj4 definition and its WKT as in a .prj */
  function crsText(J, Q) {
    const f = J.o.files, P = J.res.P;
    const one = (what, C) => [what, `  ${C.epsg ? `EPSG:${C.epsg}, ${C.name}` : `Custom: ${C.desc}`}`, `  proj4: ${C.proj4}`, `  WKT${C.given ? ", as you gave it" : " (ESRI), as in a .prj"}: ${C.prj}`, ""];
    return [`Coordinate systems of the SoilGuard area grid: ${area.name}`, "",
      ...one(`Layout: ${J.res.L ? "the cells are laid out in this" : "your cells are weighed in this"}${f.includes("tif") && J.res.L ? "; grid.tif is in it" : ""}`, P),
      ...(f.includes("shp") || f.includes("csv") ? one(`Shapefile (cells.prj) and the x, y of cells.csv${Q === P ? ": the layout's" : ""}`, Q) : []),
      ...(f.includes("geojson") ? one("cells.geojson, as RFC 7946 asks", G.crs(4326)) : []),
      "Longitudes and latitudes on NAD83 and WGS 84 are taken as the same here, as EPSG:1188 (NAD83 to WGS 84 (1)) does."].join("\r\n") + "\r\n";
  }
  /* the cells of a polygon or table file, in order: where they are, and how to read a column */
  function cellList(J) {
    const r = J.res;
    if (r.mode === "area") return r.list.map((c, n) => ({ n, c, k: c.k }));
    const out = [], W = r.W;
    for (let k = 0; k < W.count; k++) if (r.mask[k]) { const row = Math.floor(k / W.cols); out.push({ k, i: W.i0 + (k - row * W.cols), j: W.j1 - row }); }
    return out;
  }
  /* what the zip holds for the files ticked now: [key, name, what it is, bytes, most]. Sizes are rough until the files
     are written; most: the size is the most it can be (a GeoTIFF before Deflate). key matches the files of a group, as the shapefile's five */
  const groupOf = name => (/^weather\/daily_cell_/.test(name) ? "daily" : /^cells\.(shp|shx|dbf|prj|cpg)$/.test(name) ? "shp" : /^models\/[^/]+\//.test(name) ? `models_${name.split("/")[1]}` : /^models\//.test(name) ? "models_index" : name);
  // the columns of a build, numbers and the model files' names, and those ticked for the download
  const columns = J => [...J.bands, ...J.links];
  const picked = J => ({ bands: J.bands.filter(b => chosen.has(b.name)), links: J.links.filter(l => chosen.has(l.name)), mdlOn: J.mdl ? J.mdl.models.filter(m => zipMdl.has(m)) : [] });
  function contents(J, files) {
    const { o, res, bands, links } = J, n = res.count, L = res.L, nb = bands.length, nl = links.length, out = [["README.txt", "README.txt", "what each file holds, the sources and the choices", 4500], ["crs.txt", "crs.txt", "each coordinate system's proj4 definition and WKT", 2500],
      ["bands.csv", "bands.csv", `the ${nb + nl} column${nb + nl === 1 ? "" : "s"} ticked, with their units`, 200 + (nb + nl) * 90]];
    if (J.ids.length) out.push(["soil_units.csv", "soil_units.csv", `the ${J.ids.length.toLocaleString()} soil map units`, 200 + J.ids.length * 150]);
    if (o.wx) {
      const nw = J.wxCells.length, got = J.series.filter(Boolean).length, days = Wd.parseDay(o.to) - Wd.parseDay(o.from) + 1;
      out.push(["weather/cells.csv", "weather/cells.csv", `the ${nw === 1 ? "weather cell with its" : `${nw} weather cells with their`} means`, 200 + nw * (60 + nb * 8)]);
      if (o.daily && got) out.push(["daily", `weather/daily_cell_001.csv${got > 1 ? ` … (${got} files)` : ""}`, "the daily weather of each weather cell", got * days * 62]);
    }
    if (J.dm) out.push(["drought/weeks.csv", "drought/weeks.csv", `the share of the cells in each Drought Monitor class, for each of the ${J.dm.weeks.length} week${J.dm.weeks.length > 1 ? "s" : ""}`, 200 + J.dm.weeks.length * 70]);
    if (files.includes("tif") && L && !L.hex) out.push(["grid.tif", "grid.tif", `GeoTIFF, ${nb} bands of ${res.W.cols.toLocaleString()} × ${res.W.rows.toLocaleString()} pixels, Deflate`, 1000 + res.W.count * nb * 4, true]);
    const pts = !L ? 9 : L.hex ? 7 : 5;
    const lw = links.reduce((t, l) => t + linkWidth(l), 0);
    if (files.includes("shp")) out.push(["shp", "cells.shp, .shx, .dbf, .prj, .cpg", `shapefile, ${n.toLocaleString()} polygons, ${nb + nl + (L ? 3 : 2)} fields`, 1500 + n * (68 + 16 * pts + 1 + (L ? 28 : 40) + bands.reduce((t, b) => t + (b.cat ? 10 : 14), 0) + lw)]);
    if (files.includes("geojson")) out.push(["cells.geojson", "cells.geojson", `${n.toLocaleString()} polygons in longitude and latitude`, n * (110 + pts * 30 + bands.reduce((t, b) => t + b.name.length + 10, 0) + links.reduce((t, l) => t + l.name.length + linkWidth(l) + 6, 0))]);
    if (files.includes("csv")) out.push(["cells.csv", "cells.csv", `${n.toLocaleString()} rows, one a cell, with its centre`, 200 + n * (75 + nb * 7 + lw)]);
    if (J.mdlOn && J.mdlOn.length) {
      const d = J.mdl, idx = d.files.filter(f => /^models\/[^/]+$/.test(f.name)), plural = (k, w) => `${k} ${w}${k === 1 ? "" : "s"}`;
      out.push(["models_index", `models/: ${idx.map(f => f.name.slice(7)).join(", ")}`, "how the model files link to the cells: the soils, weather cells and runs with their files", idx.reduce((t, f) => t + f.text.length, 0)]);
      J.mdlOn.forEach(m => { const b = d.by[m]; out.push([`models_${m}`, `models/${m}/ (${b.files.length} files)`, `${MNAME[m]}: ${[b.wx && plural(b.wx, "weather cell"), b.soil && plural(b.soil, "soil"), b.site && plural(b.site, "site file")].filter(Boolean).join(", ") || "no files"}${b.failed.length ? `; ${b.failed.length} not written (NOT_WRITTEN.txt)` : ""}`, b.size]); });
    }
    return out;
  }
  // the most characters of a link column, for the shapefile's text field
  const linkWidth = l => Math.min(254, Math.max(4, ...[...l.map.values()].map(v => v.length)));
  /* the Download section's choices: the columns, with presets, and the model folders */
  function colBox() {
    const J = job, box = $("#gColBox");
    if (!J || !box) return;
    const groups = [["cover", "Cover"], ["site", "Soil, one value"], ["layer", "Soil, for each layer"], ["wx", "Weather"], ["dm", "Drought Monitor"], ["link", "Model links"]];
    box.innerHTML = `<h5 class="g-h5">Columns in the files</h5>
      <div class="g-presets">${PRESETS.map(([k, n]) => `<button class="btn small" data-preset="${k}">${esc(n)}</button>`).join("")}</div>
      <details class="g-cols"><summary id="gColSum"></summary>
        ${groups.map(([g, n]) => { const list = columns(J).filter(b => b.group === g); return list.length ? `<p class="fine"><b>${esc(n)}</b></p><div class="pv-vars">${list.map(b => `<label title="${esc(b.label)}"><input type="checkbox" name="gCol" value="${esc(b.name)}" ${chosen.has(b.name) ? "checked" : ""}> ${esc(b.name)}</label>`).join("")}</div>` : ""; }).join("")}
      </details>`;
    $("#gMdlZip").innerHTML = J.mdl ? `<h5 class="g-h5">Model folders</h5><div class="pv-vars">${J.mdl.models.map(m => `<label><input type="checkbox" name="gZipMdl" value="${m}" ${zipMdl.has(m) ? "checked" : ""}> ${esc(MNAME[m])} <small class="fine">models/${m}/</small></label>`).join("")}</div>` : "";
  }
  /* the Download section: the zip's name and what it will hold, or once saved what it held */
  function zipList(saved) {
    const box = $("#gZipList");
    if (!job || !box) return;
    const files = ticks("gFile"), p = picked(job), list = contents({ ...job, ...p }, files), name = zipName(job.o), exact = saved ? new Map() : null, all = columns(job).length;
    if ($("#gColSum")) $("#gColSum").textContent = `${p.bands.length + p.links.length} of ${all} columns ticked: choose them one by one${p.links.length ? ". The model files' names are text, so they go in the shapefile, GeoJSON and CSV, not the GeoTIFF" : ""}`;
    // the presets that match the ticks
    $$("[data-preset]").forEach(b => { const want = new Set(columns(job).filter(c => inPreset(b.dataset.preset, c)).map(c => c.name)); b.classList.toggle("on", want.size === chosen.size && [...want].every(x => chosen.has(x))); });
    if (saved) saved.files.forEach(f => { const k = groupOf(f.name); exact.set(k, (exact.get(k) || 0) + (f.blob ? f.blob.size : new Blob([f.text]).size)); });
    const total = list.reduce((t, x) => t + (exact && exact.has(x[0]) ? exact.get(x[0]) : x[3]), 0);
    $("#gZipHead").innerHTML = saved ? `Saved <b>${esc(name)}</b>, ${bytes(saved.size)} (${bytes(total)} before packing), to your downloads. It holds:`
      : `<b>${esc(name)}</b> will hold these files (sizes before packing, rough until they are written; packing makes the text files smaller):`;
    box.innerHTML = list.map(([k, f, what, size, most]) => `<li><span><b>${esc(f)}</b> ${esc(what)}</span><span>${exact && exact.has(k) ? bytes(exact.get(k)) : `${most ? "up to" : "≈"} ${bytes(size)}`}</span></li>`).join("")
      + (files.length ? "" : `<li class="off"><span>${esc(noFile() || "Tick a file under 5 · Files.")}</span></li>`)
      + (p.bands.length + p.links.length ? "" : `<li class="off"><span>No column is ticked: tick some above, or a preset.</span></li>`)
      + (!saved && total > 300e6 ? `<li class="off"><span>A large download: writing and packing it takes a while, and your browser needs memory for it.</span></li>` : "");
  }
  async function save() {
    flush();
    if (!job || busy) return;
    // the files, columns and model folders ticked now
    const J0 = job, files = ticks("gFile"), J = { ...J0, ...picked(J0), o: { ...J0.o, files } }, { o, res, bands, links } = J, status = t => { $("#gStatus").textContent = t; }, out = [];
    if (!files.length) return toast(noFile() || "Tick a file under 5 · Files.");
    if (!bands.length && !links.length) return toast("Tick at least one column under 7 · Download, or a preset.");
    // the files are chosen now, so they are checked against the cells built
    const over = [["shp", MAX.shp, "A shapefile"], ["geojson", MAX.geojson, "GeoJSON"], ["csv", MAX.csv, "A CSV"]].find(([k, m]) => files.includes(k) && res.count > m);
    if (over) return toast(`${over[2]} holds ${wordy(over[1])} cells at most, and this grid has ${res.count.toLocaleString()}: untick it under 5 · Files.`);
    if (files.includes("shp") && bands.length + links.length > MAX.fields) return toast(`A shapefile holds ${MAX.fields} columns at most, and ${bands.length + links.length} are ticked: untick some under 7 · Download, or the shapefile under 5 · Files.`);
    if (files.includes("tif") && res.L && !res.L.hex && !bands.length) return toast("The GeoTIFF holds number columns only, and none is ticked: tick one under 7 · Download, or untick the GeoTIFF.");
    // the shapefile and CSV in the coordinates the sheet now asks for
    let Q = res.P;
    try { Q = outOf(options(), res.P); } catch (e) { if (files.includes("shp") || files.includes("csv")) return toast(`The coordinates of the shapefile and CSV: ${e.message}.`); }
    const L = res.L, W = res.W, P = res.P, tif = files.includes("tif") && L && !L.hex, wantPoly = files.includes("shp") || files.includes("geojson") || files.includes("csv");
    const R = begin("save", ["tables", ...(tif ? ["tif"] : []), ...(wantPoly ? ["cells"] : []), "zip"]);
    try {
      say(R, "tables", "Writing the tables");
      await breathe();
      const num4 = v => (v === NO ? "" : +v.toFixed(4));
      out.push({ name: "README.txt", text: readme(J, Q) }, { name: "crs.txt", text: crsText(J, Q) });
      out.push({ name: "bands.csv", text: X.csv(["Band", "Column", "Short name (shapefile)", "What it holds", "Unit"], [...bands.map((b, i) => [i + 1, b.name, b.short, b.label, b.unit]), ...links.map(l => ["", l.name, l.short, l.label, "text"])]) });
      if (J.ids.length) out.push({ name: "soil_units.csv", text: X.csv(["mukey", "Symbol", "Map unit", "WEG of its main soil", "Climatic factor C (used)", "Climatic factor C in SSURGO (map unit)", "Soils (% of the map unit)"], J.ids.map(k => { const u = J.units[k]; return [k, u.musym, u.muname, u.weg, u.cUsed != null ? +(+u.cUsed).toFixed(1) : u.C, u.C ? +(+u.C).toFixed(1) : "", (u.comps || []).map(c => `${c.name} ${c.pct}%`).join("; ")]; })) });
      if (o.wx) {
        // every weather column, whatever is ticked for the cells
        const wxb = J0.bands.filter(b => b.group === "wx"), src = o.src === "file" ? J0.wxFileName : WX_GRID[o.src].name;
        out.push({ name: "weather/cells.csv", text: X.csv(["wx_cell", "Longitude of its centre", "Latitude of its centre", "Source", ...wxb.slice(1).map(b => `${b.name}${b.unit ? ` (${b.unit})` : ""}`)], J.wxCells.map((c, a) => [a + 1, +c.lon.toFixed(5), +c.lat.toFixed(5), src, ...wxb.slice(1).map(b => num4(b.lut[a + 1]))])) });
        // a weather cell that could not be read has no daily table; the README names it
        if (o.daily) J.series.forEach((w, a) => {
          if (!w) return;
          const v = (q, x) => (ok(x) ? +(q ? UN.conv(q, x) : x).toFixed(2) : "");
          out.push({ name: `weather/daily_cell_${String(a + 1).padStart(3, "0")}.csv`, text: X.csv(["Date", `Rain (${UN.sym("precip")})`, `Tmax (${UN.sym("temp")})`, `Tmin (${UN.sym("temp")})`, `Solar radiation (${UN.sym("solar")})`, "Relative humidity (%)", `Wind at 10 m (${UN.sym("wind")})`, `Grass ET0 (${UN.sym("precip")})`],
            w.days.map((d, i) => [Wd.isoDay(d), v("precip", w.prcp[i]), v("temp", w.tmax[i]), v("temp", w.tmin[i]), v("solar", w.srad[i]), v(null, w.rh[i]), v("wind", w.wind10[i]), v("precip", w.et0 && w.et0[i])])) });
        });
      }
      if (J.dm) {
        const pc = v => (v === null || v === undefined ? "" : +v.toFixed(2));
        out.push({ name: "drought/weeks.csv", text: X.csv(["Week (map date, Tuesday)", "Valid to (Monday)", "Read", "% no drought class", "% D0", "% D1", "% D2", "% D3", "% D4", "% D1-D4 (in drought)"],
          J.dm.weeks.map(x => [Wd.isoDay(x.d), Wd.isoDay(x.d + 6), x.sh ? "yes" : `no: ${x.why}`, ...(x.sh ? x.sh.map(pc) : ["", "", "", "", "", ""]), x.sh ? pc(x.sh[2] + x.sh[3] + x.sh[4] + x.sh[5]) : ""])) });
      }
      live(R);
      if (tif) {
        const what = `Writing the GeoTIFF: ${bands.length} bands of ${W.cols.toLocaleString()} × ${W.rows.toLocaleString()} pixels`;
        say(R, "tif", what, 0, 1);
        await breathe();
        const [x0, y0] = L.fromUV(W.i0 * L.du, (W.j1 + 1) * L.dv);
        const arrays = bands.map(b => (res.mode === "centre" && b.by !== "pair" ? (b.by === "soil" ? res.soilIdx : b.by === "wx" ? res.wxIdx : b.by === "dm" ? res.dmIdx : res.mask) : null));
        const blob = await G.geotiff({ width: W.cols, height: W.rows, names: bands.map(b => b.name), epsg: P.epsg, geog: P.geog, citation: P.name, meta: { LAYOUT_CRS: `EPSG:${P.epsg}, ${P.name}` }, x0, y0, size: L.size, angle: L.angle,
          progress: f => say(R, "tif", what, f, 1), stop: () => R.stop,
          fill(n, row, buf) {
            const b = bands[n], s = row * W.cols;
            if (arrays[n]) { const a = arrays[n], lut = b.lut; for (let c = 0; c < W.cols; c++) buf[c] = lut[a[s + c]]; } else for (let c = 0; c < W.cols; c++) buf[c] = valueAt(J, b, s + c);
          } });
        out.push({ name: "grid.tif", blob });
      }
      live(R);
      if (wantPoly) {
        say(R, "cells", "Listing the cells");
        await breathe();
        live(R);
        const list = cellList(J), own2 = res.mode === "area" && !L, N = list.length.toLocaleString();
        // each file reports as it goes, and Cancel stops it there
        const tick = what => async (d, t) => { say(R, "cells", `${what}: ${N} cells`, d, t); await breathe(); live(R); };
        const ringsOf = c => (own2 ? c.c.rings : [L.ring(c.i ?? c.c.i, c.j ?? c.c.j)]);
        // a straight edge bows once reprojected (up to 26 mm over 1 km into degrees): a point every 100 m at most keeps it within 0.3 mm
        const dense = r => r.flatMap((p, i) => {
          if (!i) return [p];
          const q = r[i - 1], n = Math.max(1, Math.ceil(Math.hypot(p[0] - q[0], p[1] - q[1]) / 100 - 1e-9));
          return Array.from({ length: n }, (_, t) => (t === n - 1 ? p : [q[0] + ((p[0] - q[0]) * (t + 1)) / n, q[1] + ((p[1] - q[1]) * (t + 1)) / n]));
        });
        // into the output's coordinates through longitude and latitude; your own cells' corners from their file
        const conv = Q === P ? null : (E, Nn) => Q.fwd(...P.inv(E, Nn));
        const outRings = c => (!conv ? ringsOf(c) : own2 ? c.c.lonlat.map(r => r.map(([x, y]) => Q.fwd(x, y))) : ringsOf(c).map(r => dense(r).map(([E, Nn]) => conv(E, Nn))));
        const val = (c, b) => { const v = own2 ? (b.by === "mask" ? res.covers[c.n] : b.vals[c.n]) : valueAt(J, b, c.k); return v === NO || v === 0 && b.by === "mask" ? null : v; };
        const centre = c => { if (own2) return [c.c.cx, c.c.cy]; return L.centre(c.i ?? c.c.i, c.j ?? c.c.j); };
        const ownId = c => { const p = c.c && c.c.props; if (!p) return null; const key = Object.keys(p).find(x => /^(id|cell|grid_?id|gid|fid|objectid)$/i.test(x)) || Object.keys(p)[0]; return key ? p[key] : null; };
        // a model file's name for the cell, through its soil_id, wx_id or run_id (read whether or not those columns are ticked)
        const byName = new Map(J0.bands.map(b => [b.name, b])), linkOf = (c, l) => { const v = val(c, byName.get(l.of)); return v === null ? "" : l.map.get(v) || ""; };
        const quote = t => (/[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t);
        if (files.includes("shp")) {
          say(R, "cells", `Writing the shapefile: ${N} cells`, 0, 1);
          await breathe();
          const fields = [{ name: "CELL", type: "N", width: 10, dec: 0 }, ...(own2 ? [{ name: "OWN_ID", type: "C", width: 30 }] : [{ name: "COL", type: "N", width: 9, dec: 0 }, { name: "ROW", type: "N", width: 9, dec: 0 }]),
            ...bands.map(b => ({ name: b.short, type: "N", width: b.cat ? 10 : 14, dec: b.cat ? 0 : 4, band: b })), ...links.map(l => ({ name: l.short, type: "C", width: linkWidth(l), link: l }))];
          const value = (n, f) => { const c = list[n]; if (f.name === "CELL") return n + 1; if (f.name === "OWN_ID") return ownId(c); if (f.name === "COL") return c.i ?? c.c.i; if (f.name === "ROW") return c.j ?? c.c.j; return f.link ? linkOf(c, f.link) : val(c, f.band); };
          (await G.shapefile("cells", list.length, n => outRings(list[n]), fields, value, Q.prj, tick("Writing the shapefile"))).forEach(f => out.push(f));
        }
        if (files.includes("geojson")) {
          say(R, "cells", `Writing the GeoJSON: ${N} cells`, 0, 1);
          await breathe();
          const blob = await G.geojson(list.length, n => (own2 ? list[n].c.lonlat : ringsOf(list[n]).map(r => dense(r).map(([E, Nn]) => P.inv(E, Nn)))), n => {
            const c = list[n], q = { cell: n + 1 };
            if (own2) { const id = ownId(c); if (id !== null) q.own_id = id; }
            bands.forEach(b => { const v = val(c, b); q[b.name] = v === null ? null : +v.toFixed(4); });
            links.forEach(l => { q[l.name] = linkOf(c, l) || null; });
            return q;
          }, tick("Writing the GeoJSON"));
          out.push({ name: "cells.geojson", blob });
        }
        if (files.includes("csv")) {
          const parts = [`﻿${["cell", own2 ? "own_id" : "col", ...(own2 ? [] : ["row"]), "x", "y", "lon", "lat", ...bands.map(b => b.name), ...links.map(l => l.name)].join(",")}\r\n`], t = tick("Writing the CSV");
          for (let n = 0; n < list.length; n++) {
            if (n % 50000 === 0) await t(n, list.length);
            const c = list[n], [E, Nn] = centre(c), [lon, lat] = P.inv(E, Nn), [x, y] = conv ? Q.fwd(lon, lat) : [E, Nn];
            parts.push(`${[n + 1, own2 ? JSON.stringify(ownId(c) ?? "") : c.i ?? c.c.i, ...(own2 ? [] : [c.j ?? c.c.j]), +x.toFixed(Q.digits), +y.toFixed(Q.digits), +lon.toFixed(7), +lat.toFixed(7), ...bands.map(b => { const v = val(c, b); return v === null ? "" : +v.toFixed(4); }), ...links.map(l => quote(linkOf(c, l)))].join(",")}\r\n`);
          }
          out.push({ name: "cells.csv", blob: new Blob(parts, { type: "text/csv" }) });
        }
      }
      // the model folders ticked, with the index of them all; its README names only the folders in the zip
      if (J.mdlOn.length) {
        const off = J0.mdl.models.filter(m => !J.mdlOn.includes(m));
        out.push(...J0.mdl.files.filter(f => /^models\/[^/]+$/.test(f.name) || J.mdlOn.some(m => f.name.startsWith(`models/${m}/`)))
          .map(f => (f.name === "models/README.txt" && off.length ? { ...f, text: indexReadme(f.text, J0.mdl.models, off) } : f)));
      }
      say(R, "zip", `Packing ${out.length} files into the zip`, 0, 100);
      await breathe();
      live(R);
      const zip = await until(R, M.zip(out, m => say(R, "zip", `Packing ${out.length} files into the zip${m.currentFile ? `: ${m.currentFile}` : ""}`, m.percent, 100)));
      live(R);
      X.save(zip, zipName(o), "application/zip");
      status(`Saved ${zipName(o)}: ${out.length} files, ${bytes(zip.size)}, in ${took((Date.now() - R.t0) / 1000)}.${job === J0 ? "" : " You changed something since: build it again."}`);
      if (job === J0) zipList({ files: out, size: zip.size });
    } catch (e) {
      if (R.stop) status("Stopped: nothing was saved. The grid built is kept: press Download the zip to start again.");
      else { console.error(e); status(`Could not make the files: ${e.message || e}.`); }
    }
    finish(R);
  }
  return { open };
})();
