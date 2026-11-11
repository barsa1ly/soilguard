/* The data sheet: model-ready soil and weather files, tables and series for the selected location.
   Weather from gridMET, NASA POWER or the user's own daily file; soil from the survey (any component) or the
   user's own layers. Writers live in WG.models.writers. */
WG.datasheet = (function () {
  const { $, $$, esc, fmt, toast, num } = WG.util;
  const UN = WG.units, X = WG.export, Wd = WG.wind, M = WG.models, D = WG.downloads, T = WG.templates;
  const state = WG.state;
  // the user's weather file: { name, text, at: where it was loaded, n: which load }; the text is read again at Download
  // with the units chosen then, and userWx is the parse made on loading
  let userWxSrc = null, userWx = null, wxLoads = 0;
  // the user's own soil layers and the location they were made for
  let userSoilRows = null, userSoilSite = null;
  // the download in progress: its location's token and status line, shown again when the sheet is re-rendered
  let running = null;
  let gmLast = null, gmAsked = false; // gridMET's last day, once read

  // [key, name, its weather files, its soil files]
  const MODELS = [
    ["dssat", "DSSAT 4.8", "Weather .WTH, one file per year", "Soil WG.SOL"],
    ["swatplus", "SWAT+", "Station files (pcp, tmp, slr, hmd, wnd and .cli lists)", "soils.sol and a user soil table"],
    ["epic", "EPIC", "Daily .DLY, monthly statistics .WP1 and wind .WND", "Soil .SOL"],
    ["apex", "APEX", "Daily .DLY, monthly statistics .WP1 and wind .WND", "Soil .SOL"],
    ["apsim", "APSIM", "Weather .met, with CO₂", "Soil .apsimx"],
    ["aquacrop", "AquaCrop 7", "Climate .CLI with temperature, rain and ET₀ files, and an AquaCrop-OSPy file", "Soil .SOL"],
    ["century", "CENTURY 4.0 and 4.5", "Monthly weather .wth", "Site file .100 for each version, which also holds climate lines"],
    ["daycent", "DayCent (Dec 2016)", "Daily weather .wth", "Site file .100 with climate lines, soils.in and sitepar.in"],
    ["csv", "Plain CSV", "Daily weather with units, for any model", "Soil layers with units, for any model"],
  ];
  // [key, name, the tabs that have it]
  const SERIES = [
    ["hourly", "Hourly wind (the series in use)", "weather"], ["daily", "Daily weather (the range above)", "weather"], ["monthly", "Monthly summary", "weather"],
    ["annual", "Annual summary", "weather"], ["drought", "Drought Monitor, week by week (the range above, 2000 on)", "weather"], ["soil", "Soil horizons", "soil"],
  ];
  // the sheet's tabs: what a download holds
  const TABS = [["weather", "Weather files"], ["soil", "Soil files"], ["both", "Both together"]];
  const seriesOn = (k, t) => t === "both" || SERIES.find(x => x[0] === k)[2] === t;
  const modelText = (m, t) => (t === "weather" ? m[2] : t === "soil" ? m[3] : `${m[2]}; ${m[3].charAt(0).toLowerCase()}${m[3].slice(1)}`);
  const MODEL_NAME = Object.fromEntries(MODELS), SERIES_NAME = Object.fromEntries(SERIES);
  const TABLE = { hourly: "hourly_wind", daily: "daily_weather", monthly: "monthly_summary", annual: "annual_summary", drought: "drought_monitor_weekly", soil: "soil_layers" };

  // common sets of layer bottoms (cm) for the custom-depth box
  const DEPTH_SETS = [["SoilGrids", [5, 15, 30, 60, 100, 200]], ["DSSAT", [5, 15, 30, 45, 60, 90, 120, 150, 180, 210]], ["10 cm steps to 1 m", [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]]];
  // inches need 2 decimals to come back to the same 0.1 cm (78.74 in = 200.0 cm; 78.7 in would be 199.9)
  const depthDp = () => ({ in: 2, cm: 1, mm: 0 }[UN.sym("depth")] ?? 1);
  const depthOf = v => +UN.conv("depth", v).toFixed(depthDp());
  const depthText = cm => cm.map(depthOf).join(", ");
  /* the units of a weather file's columns that do not state theirs; ids p + T, P, S, W, Wh (the sheet's "u", the area grid's "gu") */
  const unitFields = p => `<p class="fine">A column whose name states its unit, like <b>tmax (F)</b> or <b>wind at 3 m (mph)</b>, is read in that unit. For the others:</p>
          <div class="form-grid">
            <label>Temperature<select id="${p}T"><option value="C">°C</option><option value="F">°F</option><option value="K">K</option></select></label>
            <label>Rain<select id="${p}P"><option value="mm">mm</option><option value="in">in</option><option value="cm">cm</option></select></label>
            <label>Solar radiation<select id="${p}S"><option value="MJ">MJ/m²/day</option><option value="W">W/m² (daily mean)</option><option value="ly">langley/day</option><option value="kWh">kWh/m²/day</option><option value="kJ">kJ/m²/day</option></select></label>
            <label>Wind<select id="${p}W"><option value="ms">m/s</option><option value="mph">mph</option><option value="kmh">km/h</option><option value="kn">kn</option></select></label>
            <label>Wind measured at (m)<input type="number" id="${p}Wh" value="2" min="0.5" max="50" step="0.5"></label>
          </div>`;
  /* the layer bottoms typed in the depth unit of the units table, as cm: { B } or { error }; text: the sheet's box, or the area grid's */
  function depthsCm(text = $("#dlDepths").value) {
    const raw = (text || "").split(/[,;\s]+/).filter(Boolean);
    if (!raw.length) return { error: "Type the bottom depth of each layer, for example 5, 15, 30, 60, 100." };
    const v = raw.map(x => UN.back("depth", +x));
    if (v.some(x => x === null || !(x > 0))) return { error: "Layer depths must be positive numbers separated by commas." };
    const B = [...new Set(v.map(x => Math.round(x * 10) / 10))].sort((a, b) => a - b);
    if (B.length > 50) return { error: "At most 50 layers." };
    if (B[B.length - 1] > 1000) return { error: "The deepest layer must end above 10 m." };
    return { B };
  }
  /* what the chosen layering gives for the chosen soil, under the layer controls */
  function layerInfo() {
    const box = $("#dlLayerInfo");
    if (!box) return;
    checkStale();
    const mode = $("#dlLayers").value;
    $("#dlDepthBox").hidden = mode !== "custom";
    let soil, L;
    try { soil = chosenSoil(); L = soil ? usableRows(soil) : []; } catch (e) { box.textContent = e.message; return; }
    const told = (soil && soil.notes ? soil.notes : []).filter(n => !(userSoilRows && userSoilRows.notes && userSoilRows.notes.includes(n))).join(" "); // the editor shows its file's notes
    if (mode === "model") { box.textContent = `DSSAT splits the horizons at 5, 15, 30, 45, 60, 90 … cm and APSIM uses 15, 15, 30, 30 … cm layers; AquaCrop merges them to 5, APEX to 10 and EPIC to 15; CENTURY averages them on its 15, 15, 15, 15, 30, 30, 30, 30 cm and DayCent on NREL's rows of 2, 3, 5, 10, 10, 15 … cm; SWAT+ and the tables keep the horizons.${told ? ` ${told}` : ""}`; return; }
    if (!L.length) { box.textContent = `No layers to write.${told ? ` ${told}` : ""}`; return; }
    const z = depthOf, u = UN.sym("depth"), rl = soil.relayer;
    box.textContent = `${L.length} layer${L.length > 1 ? "s" : ""} (${u}): ${L.map(l => `${z(l.top)}–${z(l.bot)}`).join(", ")}.`
      + (rl && rl.cut !== null ? ` The profile ends at ${z(rl.cut)} ${u} (bedrock or a cemented layer).` : "")
      + (rl && rl.extendedBelow !== null ? ` Below ${z(rl.extendedBelow)} ${u} ${soil.mukey ? "the survey has no horizons" : "your profile has no layers"}, so the deepest one is repeated.` : "")
      + (L.length > 5 ? ` AquaCrop takes at most 5 layers${L.length > 10 ? ", APEX 10" : ""}${L.length > 15 ? ", EPIC 15" : ""}${L.length > 20 ? ", DSSAT 20" : ""}; those files merge the thinnest neighbours.` : "")
      + (told ? ` ${told}` : "");
  }

  const NO_LAYER = "Your profile has no complete layer: each needs a bottom depth, sand and clay.";
  /* the layers the model files can use, or a plain message when the soil has none (urban land, rock outcrop) */
  function usableRows(soil) {
    try { return WG.writerUtil.soilRows(soil); }
    catch (e) { throw new Error(soil.mukey ? `The survey gives no water retention or bulk density for ${soil.name}, so no model soil can be made from it: choose another component, or “My own soil profile…”.` : NO_LAYER); }
  }
  // the survey has not answered yet: the page's soil panel keeps its placeholders until it does, and a point without a
  // map unit leaves state.soil null for good
  const surveyLoading = () => !state.soil && !!$("#soilSummary .skeleton");
  /* why the survey gives no soil here, or "": still loading, no map unit, a failed request or a map unit without soils */
  function surveyGap() {
    const s = state.soil, own = "choose “My own soil profile…”";
    if (surveyLoading()) return `The soil survey is still loading: try again in a moment, or ${own}.`;
    if (!s) return `The soil survey has no map unit at this point: for a soil, ${own}.`;
    if (s.error) return `The soil survey request failed (${s.error}): pick the location again to retry, or ${own}.`;
    return s.dominant ? "" : `The soil survey has no soil profile here: for a soil, ${own}.`;
  }

  /* the sheet's choices, kept when it is closed (for example to change the depth unit) and opened again */
  let form = null, tab = "weather", leftFile = false; // leftFile: the sheet left the weather file for gridMET at another location
  const siteKey = () => `${state.site.lat},${state.site.lon}`;
  function keepForm() {
    if (!$("#dlLayers") || !state.site) return;
    const d = $("#dlLayers").value === "custom" ? depthsCm() : null;
    form = { tab, site: $("#dlFrom").dataset.site || siteKey(), wx: $("#dlWx").value, from: $("#dlFrom").value, to: $("#dlTo").value,
      soil: $("#dlSoil").value, layers: $("#dlLayers").value, depths: d && d.B ? d.B : form ? form.depths : null,
      models: $$("input[name=dlModel]:checked").map(i => i.value), series: $$("input[name=dlSeries]:checked").map(i => i.value),
      u: Object.fromEntries(["uT", "uP", "uS", "uW", "uWh"].map(k => [k, $("#" + k).value])), fill: $("#uFill").checked };
  }

  /* ---------- the days each weather source can give ---------- */
  const POWER_FIRST = Wd.epochDay(1981, 0, 1);
  const span = r => `${Wd.dayLabel(r.first)} – ${Wd.dayLabel(r.last)}`;
  /* { first, last, name, what } of a source's record: gridMET from 1979 to its last day (about 2 days behind), PRISM from
     1981, NASA POWER from 1981 to about 8 days ago, a file its own days (and gridMET's too when gaps are filled from it); null without a file.
     gmDay: gridMET's last day when known (the area grid reads it), else the one read for this sheet */
  function wxRange(src, fill, file, gmDay = gmLast) {
    const gm = { first: Wd.GM_DAY0, last: gmDay ?? Wd.today() - 3, name: "gridMET", what: "gridMET's record" };
    if (src === "gridmet") return gm;
    // a calendar day holds PRISM's next date, which comes about a day after it ends; solar, humidity and wind are gridMET's
    if (src === "prism") return { first: Wd.PRISM_DAY0, last: Math.min(gm.last, Wd.prismLast()), name: "PRISM", what: "PRISM's record" };
    if (src === "power") return { first: POWER_FIRST, last: Wd.today() - 8, name: "NASA POWER", what: "NASA POWER's record" };
    if (!file) return null;
    const f = file.days[0], l = file.days[file.days.length - 1];
    return fill ? { first: Math.min(f, gm.first), last: Math.max(l, gm.last), name: `${file.name} and gridMET`, what: `${file.name} and gridMET's record` }
      : { first: f, last: l, name: file.name, what: `the days in ${file.name}` };
  }
  const loadedFile = () => (userWx ? { days: userWx.days, name: userWxSrc.name } : null);
  /* the weather file belongs to the place it was loaded at: said wherever it is used at another location, or "" */
  function wxAway() {
    if (!userWxSrc || userWxSrc.at.key === siteKey()) return "";
    const a = userWxSrc.at, b = state.site, r = Math.PI / 180;
    const h = Math.sin((b.lat - a.lat) * r / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((b.lon - a.lon) * r / 2) ** 2, km = 12742 * Math.asin(Math.sqrt(h));
    return `${userWxSrc.name} was loaded at ${a.lat.toFixed(4)}, ${a.lon.toFixed(4)}, ${UN.fmt("distance", km, km < 10 ? 1 : 0)} from this location: its weather is written under this location's name and coordinates.`;
  }
  /* CENTURY's and DayCent's site files hold climate lines as well as the soil: in the soil tab, where they come from (as
     prepare reads them: a file has no 10 years to give, so gridMET) and what Both together does instead */
  const CLIM_MODELS = ["century", "daycent"];
  function climNote() {
    const box = $("#dlClimNote"), who = CLIM_MODELS.filter(m => $(`input[name=dlModel][value=${m}]:checked`)).map(m => MODEL_NAME[m].split(" ")[0]), on = tab === "soil" && who.length > 0;
    if (!box) return;
    box.hidden = !on;
    if (!on) return;
    const v = $("#dlWx").value, src = { power: "NASA POWER", prism: "PRISM" }[v] || "gridMET";
    box.textContent = `${who.length > 1 ? "CENTURY's and DayCent's site files also hold" : `${who[0]}'s site file also holds`} climate lines: here they come from the last 10 complete years of ${src}, ${v === "file" ? "as your weather file is not used for them" : "the source chosen under Weather files"}. Both together takes them from the chosen dates instead when every month has 10 years in them, else from the same 10 years.`;
  }
  /* the date inputs take the chosen source's range; Download moves dates outside it inside and says so */
  function dateLimits() {
    const r = wxRange($("#dlWx").value, $("#uFill").checked, loadedFile());
    const prism = $("#dlWx").value === "prism" ? " Rain and temperature are PRISM's own; PRISM has no wind, so solar radiation, humidity and wind come from gridMET. Each calendar day holds PRISM's next date, to line up with them." : "";
    $("#dlRange").textContent = r ? `${r.name}: ${span(r)}.${prism}` : "";
    climNote();
    ["#dlFrom", "#dlTo"].forEach(s => { $(s).min = r ? Wd.isoDay(r.first) : ""; $(s).max = r ? Wd.isoDay(r.last) : ""; });
  }
  const fileDates = () => { $("#dlFrom").value = Wd.isoDay(userWx.days[0]); $("#dlTo").value = Wd.isoDay(userWx.days[userWx.days.length - 1]); };

  /* survey components with horizons; while the survey loads, or where it has none, a placeholder comes first so that
     "My own soil profile…" is never chosen on the user's behalf */
  function soilOptions() {
    const s = state.soil;
    const comps = s && !s.error && s.components ? s.components.filter(c => c.horizons && c.horizons.length) : [];
    const none = comps.length ? "" : `<option value="" selected>${surveyLoading() ? "Soil survey still loading…" : s && s.error ? "The soil survey could not be read" : "No survey soil here"}</option>`;
    return none + comps.map(c => `<option value="${esc(c.cokey)}" ${s.dominant && c.cokey === s.dominant.cokey ? "selected" : ""}>${esc(c.compname)} · ${fmt(c.comppct_r, 0)}% of map unit${s.dominant && c.cokey === s.dominant.cokey ? " (dominant)" : ""}</option>`).join("")
      + `<option value="user">My own soil profile…</option>`;
  }
  /* the survey can come in while the sheet is open: its soils are then offered, any choice made staying */
  let surveyWatch = null;
  function watchSurvey() {
    clearTimeout(surveyWatch);
    if (!surveyLoading()) return;
    const tok = state.token;
    surveyWatch = setTimeout(() => {
      if (tok !== state.token || !shown()) return;
      if (surveyLoading()) return watchSurvey();
      const sel = $("#dlSoil"), was = sel.value;
      sel.innerHTML = soilOptions();
      if (was && [...sel.options].some(o => o.value === was)) sel.value = was;
      keepForm();
      layerInfo();
    }, 1000);
  }
  function render() {
    noteOpened();
    const P = state.windPeriod || Wd.resolvePeriod(state.period, state.gridModel);
    $("#dataBody").innerHTML = `
      <div class="seg dl-tabs" id="dlTabs">${TABS.map(([k, n]) => `<button data-dl-tab="${k}">${esc(n)}</button>`).join("")}</div>
      <p class="fine">Files for ${esc(state.place || "this location")} (${state.site.lat.toFixed(4)}, ${state.site.lon.toFixed(4)}). Model files use each model's own units; tables use the units chosen in the units table.</p>
      <section class="data-sec" id="dlSecWx"><h4>Weather and dates</h4>
        <div class="form-grid">
          <label>Weather from<select id="dlWx">
            <option value="gridmet">gridMET, 4 km (1979 on)</option>
            <option value="prism">PRISM, 4 km (1981 on)</option>
            <option value="power">NASA POWER, 0.5° (1981 on)</option>
            <option value="file">My own daily weather file…</option></select></label>
          <label>From<input type="date" id="dlFrom" value="${P.from}" data-site="${siteKey()}"></label>
          <label>To<input type="date" id="dlTo" value="${P.to}"></label>
        </div>
        <p class="fine" id="dlRange"></p>
        <div id="dlWxFile" hidden>
          ${T.box("weather")}
          <div class="form-grid">
            <label>Your file<input type="file" id="dlWxIn" accept=".csv,.txt,.tsv,.dat,.xlsx,.xls"></label>
            <label class="check"><input type="checkbox" id="uFill" checked> Fill gaps from gridMET</label>
          </div>
          <p class="fine dl-status" id="dlWxStatus"></p>
          ${unitFields("u")}
        </div>
      </section>
      <section class="data-sec" id="dlSecSoil"><h4>Soil</h4>
        <div class="form-grid"><label>Soil profile<select id="dlSoil">${soilOptions()}</select></label>
          <label>Layers<select id="dlLayers"><option value="model">Each model's usual layers</option><option value="survey">The horizons as they are</option><option value="custom">Custom depths…</option></select></label></div>
        <div id="dlDepthBox" hidden>
          <div class="form-grid"><label>Bottom of each layer (${esc(UN.sym("depth"))})<input id="dlDepths" inputmode="decimal" value="${depthText(DEPTH_SETS[0][1])}"></label></div>
          <p class="fine">Separate the depths with commas; the last one is the profile depth. Each layer takes the thickness-weighted mean of the horizons it covers (organic matter, carbon, CaCO₃ and N by mass).
            Quick fill: ${DEPTH_SETS.map(([n, d]) => `<button class="link" data-depths="${d.join(",")}">${esc(n)} (${depthText(d)})</button>`).join(" · ")}</p>
        </div>
        <p class="fine dl-status" id="dlLayerInfo"></p>
        <div id="dlSoilEdit" hidden></div>
      </section>
      <section class="data-sec"><h4>Files</h4>
        <div class="model-grid">${MODELS.map(([k, n]) => `<label><input type="checkbox" name="dlModel" value="${k}" ${k === "dssat" ? "checked" : ""}><span>${esc(n)}<small data-model-text="${k}"></small></span></label>`).join("")}</div>
        <p class="fine dl-status" id="dlClimNote" hidden></p>
        <h4>Tables and series (CSV)</h4>
        <div class="model-grid">${SERIES.map(([k, n]) => `<label data-series-row="${k}"><input type="checkbox" name="dlSeries" value="${k}"><span>${esc(n)}</span></label>`).join("")}</div>
      </section>
      <div class="area-actions"><button class="btn" id="dlPv">Preview</button><button class="btn primary" id="dlGo">Download</button><span class="fine dl-status" id="dlStatus"></span></div>
      <section class="data-sec" id="dlPvSec" hidden><h4>Preview: what the download will hold</h4>
        <p class="fine dl-status" id="dlPvStale" hidden>You changed something since this preview: <b>Download these files</b> saves the files shown, and <b>Download</b> above the form as it is now. <button class="link" id="dlPvAgain">Preview again</button></p>
        <div id="dlPvBox"></div>
        <div class="area-actions"><button class="btn primary" id="dlGo2">Download these files</button></div>
      </section>
      <p class="fine">For a whole field or farm rather than this point: <button class="link" id="dlToArea">draw or load an area</button>, then <b>Make a grid of this area</b> gives its soil and weather in cells from 20 cm up.</p>`;
    $$("[data-dl-tab]").forEach(b => b.addEventListener("click", () => { tab = b.dataset.dlTab; showTab(); keepForm(); checkStale(); }));
    $("#dlToArea").addEventListener("click", () => { D.close(); if ($("#areaSheet").hidden) $("#areaBtn").click(); });
    // switching to the file takes its dates; the units are applied when the files are made, so they need no re-read here
    $("#dlWx").addEventListener("change", e => { const f = e.target.value === "file"; leftFile = false; $("#dlWxFile").hidden = !f; if (f && userWx) fileDates(); dateLimits(); });
    $("#uFill").addEventListener("change", dateLimits);
    T.wire("weather", $("#dlWxFile"));
    $("#dlWxIn").addEventListener("change", readWxFile);
    // the file is read again in the units chosen, so what shows is what the files will use
    ["#uT", "#uP", "#uS", "#uW", "#uWh"].forEach(s => $(s).addEventListener("change", rereadWx));
    $("#dlSoil").addEventListener("change", e => { if (e.target.value === "user") editSoil(); else $("#dlSoilEdit").hidden = true; layerInfo(); });
    $("#dlLayers").addEventListener("change", layerInfo);
    $("#dlDepths").addEventListener("input", layerInfo);
    $$("[data-depths]").forEach(b => b.addEventListener("click", () => { $("#dlDepths").value = depthText(b.dataset.depths.split(",").map(Number)); layerInfo(); keepForm(); }));
    $("#dlGo").addEventListener("click", () => run(build));
    $("#dlGo2").addEventListener("click", () => work(saveShown));
    ["#dlPv", "#dlPvAgain"].forEach(s => $(s).addEventListener("click", () => run(preview)));
    // put back what the user chose last time; dates and soil only for the same location
    const same = !!form && form.site === siteKey();
    if (form) {
      $$("input[name=dlModel]").forEach(i => { i.checked = form.models.includes(i.value); });
      $$("input[name=dlSeries]").forEach(i => { i.checked = form.series.includes(i.value); });
      Object.entries(form.u || {}).forEach(([k, v]) => { $("#" + k).value = v; });
      $("#uFill").checked = form.fill;
      $("#dlLayers").value = form.layers;
      if (form.depths) $("#dlDepths").value = depthText(form.depths);
      if (same) { $("#dlFrom").value = form.from; $("#dlTo").value = form.to; }
    }
    tab = form ? form.tab : tab;
    let wxChoice = form ? form.wx : userWx ? "file" : "gridmet";
    if (leftFile && userWx && userWxSrc.at.key === siteKey()) { wxChoice = "file"; leftFile = false; }
    // at another location the sheet goes back to gridMET; the file stays one click away, and then says where it was loaded
    const wxLeft = !same && wxChoice === "file" && !!userWx && userWxSrc.at.key !== siteKey();
    if (wxLeft) { wxChoice = "gridmet"; leftFile = true; toast("Your weather file was loaded at another location, so this one starts from gridMET: “My own daily weather file…” brings it back."); }
    $("#dlWx").value = wxChoice;
    $("#dlWxFile").hidden = wxChoice !== "file";
    if (userWx) $("#dlWxStatus").textContent = wxStatus();
    if (!same && wxChoice === "file" && userWx) fileDates();
    if (same && [...$("#dlSoil").options].some(o => o.value === form.soil)) $("#dlSoil").value = form.soil;
    if ($("#dlSoil").value === "user") editSoil();
    showTab();
    dateLimits();
    if (!gmAsked) { gmAsked = true; Wd.gridmetLast().then(v => { gmLast = v; dateLimits(); }).catch(() => {}); }
    layerInfo();
    if (wxLeft) keepForm(); // the toast once: this location's choice is gridMET now
    watchSurvey();
    if (running) {
      busy(true);
      $("#dlStatus").textContent = running.tok === state.token ? running.text : "Finishing the download for the previous location: it stops without saving.";
    }
    // the last preview stays until another location is chosen
    if (previewed && previewed.tok !== state.token) { previewed = null; WG.preview.clear(); }
    if (previewed) showPreview();
  }
  /* the sheet for the tab chosen: its sections, what each model writes in it and the tables it has */
  function showTab() {
    $$("[data-dl-tab]").forEach(b => { b.classList.toggle("on", b.dataset.dlTab === tab); });
    $("#dlSecWx").hidden = tab === "soil";
    $("#dlSecSoil").hidden = tab === "weather";
    MODELS.forEach(m => { $(`[data-model-text="${m[0]}"]`).textContent = modelText(m, tab); });
    $$("[data-series-row]").forEach(l => { l.hidden = !seriesOn(l.dataset.seriesRow, tab); });
    climNote();
  }
  // the DOWNLOAD data for models tab is on show, with the panel open
  const shown = () => !$("#tab-download").hidden && document.getElementById("app").classList.contains("has-site");
  const busy = on => ["#dlGo", "#dlGo2", "#dlPv", "#dlPvAgain"].forEach(s => { if ($(s)) $(s).disabled = on; });

  /* ---------- the preview ---------- */
  let previewed = null; // { tok, key, job } of the preview on show
  // everything that changes what a download holds
  const formKey = () => JSON.stringify([tab, $$("input[name=dlModel]:checked").map(i => i.value), $$("input[name=dlSeries]:checked").filter(i => seriesOn(i.value, tab)).map(i => i.value),
    $("#dlWx").value, $("#dlFrom").value, $("#dlTo").value, $("#dlSoil").value, $("#dlLayers").value, $("#dlLayers").value === "custom" ? $("#dlDepths").value : "",
    ...(userWxSrc && $("#dlWx").value === "file" ? [userWxSrc.name, userWxSrc.n, wxUnits(), $("#uFill").checked] : []),
    ...($("#dlSoil").value === "user" ? [userSoilRows, userSoilRows && userSoilRows.meta] : []),
    UN.all()]);
  // the wind series a preview drew, if it drew any, is still the one in use
  const sameWind = j => !(j.series.some(k => ["hourly", "monthly", "annual"].includes(k)) || (j.ctx.wx && j.models.some(m => m === "epic" || m === "apex"))) || j.ctx.analysis === windNow().analysis;
  function checkStale() {
    if (previewed && $("#dlPvStale")) $("#dlPvStale").hidden = previewed.key === formKey() && sameWind(previewed.job);
  }
  function showPreview(scroll) {
    if (!$("#dlPvSec")) return;
    $("#dlPvSec").hidden = false;
    WG.preview.show($("#dlPvBox"), previewed.job);
    checkStale();
    if (scroll) $("#dlPvSec").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ---------- the user's weather ---------- */
  /* text of a CSV/TXT file, or of the first sheet of an Excel workbook (.xlsx/.xls, recognised by content) */
  const two = n => String(n).padStart(2, "0");
  /* an Excel cell as stored, not as displayed: dates as YYYY-MM-DD, followed by the time when its format shows hours or
     it holds one (a Campbell TOA5 table is dated by its midnights), numbers in full, percentages as 0-100 */
  function xlsxCell(c, d1904) {
    if (!c || c.v === undefined || c.v === null || c.t === "e" || c.t === "z") return "";
    const f = String(c.z || ""), bare = f.replace(/"[^"]*"|\\./g, ""), noTags = bare.replace(/\[[^\]]*\]/g, "");
    const clock = s => (s > 0 || /h/i.test(noTags) ? ` ${two(Math.floor(s / 3600))}:${two(Math.floor(s / 60) % 60)}${s % 60 ? `:${two(s % 60)}` : ""}` : "");
    if (c.v instanceof Date) return `${c.v.getFullYear()}-${two(c.v.getMonth() + 1)}-${two(c.v.getDate())}${clock(c.v.getHours() * 3600 + c.v.getMinutes() * 60 + c.v.getSeconds())}`;
    if (c.t !== "n") return String(c.v);
    const isDate = XLSX.SSF && XLSX.SSF.is_date ? XLSX.SSF.is_date(f) : /[dmyh]/i.test(noTags);
    if (isDate) {
      const day = Math.floor(c.v + 1e-6);
      return Wd.isoDay(day - 25569 + (d1904 ? 1462 : 0)) + clock(Math.min(86399, Math.round(Math.max(0, c.v - day) * 86400))); // Excel day number (1900 or 1904 system) to epoch day
    }
    return String(/%/.test(bare) ? c.v * 100 : c.v);
  }
  async function fileText(f) {
    const buf = new Uint8Array(await f.arrayBuffer());
    const zipOrOle = (buf[0] === 0x50 && buf[1] === 0x4b) || (buf[0] === 0xd0 && buf[1] === 0xcf);
    if (!zipOrOle && !/\.xlsx?$/i.test(f.name)) return new TextDecoder().decode(buf);
    await M.loadXlsx();
    const wb = XLSX.read(buf, { type: "array", cellNF: true, cellText: false }), ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws || !ws["!ref"]) throw new Error("the first sheet is empty");
    const R = XLSX.utils.decode_range(ws["!ref"]), d1904 = !!(wb.Workbook && wb.Workbook.WBProps && wb.Workbook.WBProps.date1904), out = [];
    for (let r = R.s.r; r <= R.e.r; r++) {
      const row = [];
      for (let c = R.s.c; c <= R.e.c; c++) row.push(xlsxCell(ws[XLSX.utils.encode_cell({ r, c })], d1904));
      if (row.some(v => v !== "")) out.push(row.map(v => (/[",;\t\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(","));
    }
    return out.join("\n");
  }
  // the header each quantity was read from (a wrong match shows here), then what the reader noted about the file
  const COL_NAME = { date: "date", year: "year", month: "month", dom: "day", doy: "day of year", tmax: "Tmax", tmin: "Tmin", prcp: "rain", srad: "solar",
    rh: "humidity", rhmax: "RHmax", rhmin: "RHmin", tdew: "dew point", wind: "wind", et0: "ET0" };
  const UNIT_NAME = { C: "°C", F: "°F", K: "K", mm: "mm", in: "inches", cm: "cm", MJ: "MJ/m²/day", W: "W/m²", kW: "kW/m²", ly: "langley/day", kWh: "kWh/m²/day", Wh: "Wh/m²/day", kJ: "kJ/m²/day", J: "J/m²/day", ms: "m/s", mph: "mph", kmh: "km/h", kn: "kn" };
  const unitNote = (w, k) => {
    const u = w.units && w.units[k], z = k === "wind" && w.windHeight ? ` at ${w.windHeight.z} m` : "";
    return u ? ` in ${UNIT_NAME[u.u] || u.u}${z}${u.stated && (k !== "wind" || w.windHeight.stated) ? "" : " (as set below)"}` : "";
  };
  const readLines = w => {
    const c = Object.entries(w.columns || {});
    return [c.length ? `Read: ${c.map(([k, h]) => `${COL_NAME[k] || k} from ${h}${unitNote(w, k)}`).join(", ")}.` : "", ...(Array.isArray(w.notes) ? w.notes : [])].filter(Boolean);
  };
  const wxSummary = (w, name) => {
    const miss = k => w[k].filter(v => v === null).length;
    return [`${name}: ${w.days.length.toLocaleString()} days, ${Wd.dayLabel(w.days[0])} – ${Wd.dayLabel(w.days[w.days.length - 1])}. Missing: Tmax ${miss("tmax")}, Tmin ${miss("tmin")}, rain ${miss("prcp")}, solar ${miss("srad")}, humidity ${miss("rh")}, wind ${miss("wind10")} days.`,
      ...readLines(w)].join(" ");
  };
  const wxUnits = (p = "u") => ({ temp: $(`#${p}T`).value, prcp: $(`#${p}P`).value, srad: $(`#${p}S`).value, wind: $(`#${p}W`).value, windHeight: +$(`#${p}Wh`).value });
  const wxStatus = () => [wxSummary(userWx, userWxSrc.name), wxAway()].filter(Boolean).join(" ");
  async function readWxFile() {
    const f = $("#dlWxIn").files[0];
    if (!f) return;
    $("#dlWxIn").value = ""; // the same file, corrected, can then be chosen again: browsers fire no change for the same path
    try {
      const text = await fileText(f);
      userWx = M.parseWeatherCSV(text, wxUnits(), state.site.lat, state.site.lon, state.elev ? state.elev.z : null);
      userWxSrc = { name: f.name, text, at: { lat: state.site.lat, lon: state.site.lon, key: siteKey() }, n: ++wxLoads };
      fileDates();
      $("#dlWxStatus").textContent = wxStatus();
    } catch (e) { userWx = null; userWxSrc = null; $("#dlWxStatus").textContent = `Could not read ${f.name}: ${e.message}`; }
    dateLimits();
    keepForm(); // the dates were set after the input's change event saved the form
    checkStale();
  }
  function rereadWx() {
    if (!userWxSrc) return;
    try {
      userWx = M.parseWeatherCSV(userWxSrc.text, wxUnits(), state.site.lat, state.site.lon, state.elev ? state.elev.z : null);
      $("#dlWxStatus").textContent = wxStatus();
    } catch (e) { $("#dlWxStatus").textContent = `Could not read ${userWxSrc.name}: ${e.message}`; }
  }
  /* the file read again with the units chosen now, at the download's location */
  function fileWeather(site, elev) {
    if (!userWxSrc) throw new Error("Choose your weather file first.");
    const h = $("#uWh").value;
    if (h !== "" && !(+h >= 0.5 && +h <= 50)) throw new Error("Give the height the wind was measured at, between 0.5 and 50 m.");
    return M.parseWeatherCSV(userWxSrc.text, wxUnits(), site.lat, site.lon, elev);
  }

  /* ---------- the user's soil ---------- */
  /* the user's layers belong to the location they were made for: elsewhere they start again from that location's
     survey, and the name, hydrologic group, drainage class, slope, albedo, family and order always come from the same
     source as the layers. */
  const HYD_GROUPS = ["A", "B", "C", "D", "A/D", "B/D", "C/D"];
  // what a survey horizon knows beyond the table, kept on its layer until a value it rests on is changed, so a profile
  // left untouched writes as the survey does: root growth (0 below a restrictive layer), AWC, K factor, texture ...
  const SURVEY_KEPT = ["srgf", "awc", "kf", "texture", "cfWt", "noBd"];
  const REST_ON = { top: ["srgf"], bot: ["srgf"], sand: ["kf", "texture"], silt: ["kf", "texture"], clay: ["kf", "texture"], om: ["kf"], ll: ["awc"], dul: ["awc"], cfVol: ["cfWt"], bd: ["noBd"] };
  function editSoil() {
    if (userSoilRows && userSoilSite !== siteKey()) { userSoilRows = null; toast("Your own profile was made for another location, so this one starts from this location's survey."); }
    if (!userSoilRows) {
      const base = M.surveySoil(state);
      let rows = base ? base.layers : null;
      try { if (base) rows = WG.writerUtil.soilRows(base); } catch (e) { /* no horizon with water retention: all of them */ }
      // the horizons the model files would use: down to bedrock or a cemented layer, not the horizons below it
      userSoilRows = rows ? rows.map(l => ({ ...l })) : [{ top: 0, bot: 15 }, { top: 15, bot: 45 }, { top: 45, bot: 100 }];
      userSoilRows.meta = { usName: base ? base.name : "My soil", usHg: (base && base.hydgrp) || "B", usDrain: (base && base.drainage) || "Well drained",
        usSlope: base && base.slope !== null ? base.slope : 1, usAlb: base && base.albedo !== null ? base.albedo : 0.13,
        family: base ? base.family : "", order: base ? base.order : "", from: base ? `started from the survey's ${base.name}, map unit ${base.mukey}` : "" };
      userSoilSite = siteKey();
    }
    const box = $("#dlSoilEdit"), meta = userSoilRows.meta;
    box.hidden = false;
    const hg = HYD_GROUPS.includes(meta.usHg) ? meta.usHg : HYD_GROUPS.find(g => String(meta.usHg).startsWith(g)) || "B";
    const cell = (i, k) => { const v = userSoilRows[i][k]; return `<td><input data-r="${i}" data-k="${k}" inputmode="decimal" value="${v === null || v === undefined ? "" : typeof v === "number" ? +v.toFixed(["ll", "dul", "sat"].includes(k) ? 3 : 2) : esc(v)}"></td>`; };
    box.innerHTML = `${T.box("soil")}<p class="fine">Starts from the survey's dominant soil, down to any bedrock or cemented layer, with no root growth below a restrictive layer until you change that layer's depths; change any value, add or remove layers, or load your own lab results. Blank water retention, bulk density and Ksat are estimated from sand, clay and organic matter (Saxton &amp; Rawls 2006). In this table depths are in cm and Ksat in mm/h; a loaded file can be in the units its column names state. Water contents are for the whole soil, as the survey gives them: if yours are lab values for the fine earth and the layer has coarse fragments, multiply them by (1 − fragments % ÷ 100).</p>
      <div class="table-wrap"><table class="grid soil-edit"><thead><tr>${M.SOIL_COLS.map(([, l]) => `<th>${esc(l)}</th>`).join("")}<th></th></tr></thead>
      <tbody>${userSoilRows.map((_, i) => `<tr>${M.SOIL_COLS.map(([k]) => cell(i, k)).join("")}<td><button class="link" data-del="${i}" aria-label="Remove layer">✕</button></td></tr>`).join("")}</tbody></table></div>
      ${userSoilRows.notes && userSoilRows.notes.length ? `<p class="fine">${esc(userSoilRows.notes.join(" "))}</p>` : ""}
      <div class="form-grid">
        <label>Soil name<input id="usName" value="${esc(meta.usName)}"></label>
        <label>Hydrologic group<select id="usHg">${HYD_GROUPS.map(g => `<option ${g === hg ? "selected" : ""}>${g}</option>`).join("")}</select></label>
        <label>Drainage class<select id="usDrain">${Object.keys(WG.soil.DRAIN).map(k => `<option ${k === String(meta.usDrain).toLowerCase() ? "selected" : ""}>${esc(cap(k))}</option>`).join("")}</select></label>
        <label>Slope (%)<input id="usSlope" inputmode="decimal" value="${esc(meta.usSlope)}"></label>
        <label>Dry albedo<input id="usAlb" inputmode="decimal" value="${esc(meta.usAlb)}"></label>
      </div>
      <div class="area-actions"><button class="btn small" id="usAdd">Add layer</button><button class="btn small" id="usTpl">Download these layers (CSV)</button><label class="btn small">Load my soil file<input type="file" id="usIn" accept=".csv,.txt,.tsv,.xlsx,.xls" hidden></label><button class="btn small" id="usReset">Back to the survey</button></div>`;
    T.wire("soil", box);
    box.querySelectorAll("input[data-r]").forEach(inp => inp.addEventListener("change", e => {
      const row = userSoilRows[+e.target.dataset.r], k = e.target.dataset.k;
      row[k] = e.target.value;
      (REST_ON[k] || []).forEach(x => { delete row[x]; });
      layerInfo();
    }));
    ["usName", "usHg", "usDrain", "usSlope", "usAlb"].forEach(id => $("#" + id).addEventListener("change", e => { meta[id] = e.target.value; if (id === "usName") meta.named = true; }));
    box.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", e => { userSoilRows.splice(+e.target.dataset.del, 1); editSoil(); }));
    $("#usAdd").addEventListener("click", () => { const l = userSoilRows[userSoilRows.length - 1]; userSoilRows.push({ top: l ? num(l.bot) : 0, bot: l ? num(l.bot) + 30 : 30 }); editSoil(); });
    $("#usTpl").addEventListener("click", () => X.save(M.soilTemplateCSV({ layers: userSoilRows.map(x => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, num(v) ?? v]))) }), "soil_profile.csv", "text/csv;charset=utf-8"));
    $("#usIn").addEventListener("change", async e => {
      const f = e.target.files[0];
      if (!f) return;
      e.target.value = ""; // the same file, corrected, can then be chosen again
      try {
        const rows = M.parseSoilCSV(await fileText(f));
        rows.meta = { ...meta, usName: meta.named ? meta.usName : "My soil", family: "", order: "", from: "" }; // the file has layers only: the site values stay, the survey's name and class go
        userSoilRows = rows;
        editSoil();
        const whole = rows.filter(x => num(x.bot) !== null && num(x.sand) !== null && num(x.clay) !== null).length;
        toast(`${whole} layer${whole === 1 ? "" : "s"} loaded from ${f.name}${whole < rows.length ? `; ${rows.length - whole} incomplete row${rows.length - whole === 1 ? "" : "s"}, see the notes` : ""}.`);
      } catch (err) { toast(err.message); }
    });
    $("#usReset").addEventListener("click", () => { userSoilRows = null; editSoil(); });
    layerInfo();
  }
  /* the chosen soil on the chosen layers: layering "model" (each model's own), "survey" (as they are) or "custom" */
  function chosenSoil() {
    const v = $("#dlSoil").value, e = state.elev;
    let soil;
    if (v === "user") {
      const rows = userSoilRows || [], meta = rows.meta || {};
      soil = M.userSoil(rows, { name: $("#usName") ? $("#usName").value : "My soil", hydgrp: $("#usHg") ? $("#usHg").value : "B", drainage: $("#usDrain") ? $("#usDrain").value : "Well drained", slope: $("#usSlope") ? $("#usSlope").value : 1,
        albedo: $("#usAlb") ? $("#usAlb").value : 0.13, family: meta.family, texture: rows[0] && rows[0].texture, note: meta.from, lat: state.site.lat, lon: state.site.lon, elev: e ? e.z : null, id: "USER" });
      soil.order = meta.order || "";
      soil.notes = [...(rows.notes || []), ...soil.notes];
      soil.layers.forEach(l => {
        const r = rows.find(x => num(x.bot) === l.bot);
        if (!r) return;
        SURVEY_KEPT.forEach(k => { if (r[k] !== undefined) l[k] = r[k]; });
        if (r.caco3 === null) l.caco3 = null; // the survey gives none, as distinct from 0
      });
    } else {
      soil = M.surveySoil(state, v || null); // "" (the placeholder): the dominant component, if the survey has come in since
      if (!soil) throw new Error(surveyGap());
    }
    const mode = $("#dlLayers").value;
    if (mode !== "custom") return { ...soil, layering: mode };
    const d = depthsCm();
    if (d.error) throw new Error(d.error);
    return M.relayer(soil, d.B);
  }

  /* ---------- building the files ---------- */
  /* the hourly wind series in use and its analysis, each null with the reason when there is none: the hourly table and
     the EPIC/APEX .WND need only hours in the series' period (also when no month has enough of them for an analysis),
     the monthly and annual summaries an analysis with usable months. A reload (new period or model) clears both, so
     no series is used while state.wind is null. */
  function windNow() {
    const w = state.wind;
    if (!w) { const why = "the wind analysis was still loading (a new period or model)"; return { raw: null, rawWhy: why, analysis: null, why }; }
    const raw = state.windRaw, H = raw && raw.hourly, P = raw && raw.period;
    const hours = !!H && H.t.some((t, i) => Number.isFinite(H.ws[i]) && (!P || (t >= P.t0 && t < P.t1)));
    return { raw: hours ? raw : null, rawWhy: !raw ? `no hourly wind series is loaded${w.error ? ` (${w.error})` : ""}` : "the wind series has no hourly values in its period",
      analysis: w.error ? null : w, why: !w.error ? "" : w.insufficient ? `the wind analysis has no usable month (${w.error})` : `the wind analysis has no result (${w.error})` };
  }
  async function chosenWeather(job, status) {
    const { src, site, elev, d0, d1 } = job;
    if (src !== "file") {
      const yrs = Math.max(1, Math.round((d1 - d0 + 1) / 365.25)); // from the file server each year of gridMET costs about 50 MB
      status(src === "gridmet" && Wd.gridmetFromFiles() ? `Reading gridMET daily weather from its file server, as its THREDDS server is not answering: about 50 MB a year, so ${yrs} year${yrs > 1 ? "s take" : " takes"} a while…`
        : `Reading ${{ gridmet: "gridMET", prism: "PRISM", power: "NASA POWER" }[src]} daily weather…`);
      return Wd.dailyWeather(site.lat, site.lon, d0, d1, src, elev);
    }
    const u = job.file, ix = new Map(u.days.map((d, k) => [d, k])), w = { ...u, days: [] }, keys = ["prcp", "tmax", "tmin", "srad", "rh", "rhmax", "rhmin", "tdew", "vp", "wind10", "wind2", "et0"];
    keys.forEach(k => { w[k] = []; });
    for (let d = d0; d <= d1; d++) {
      const k = ix.get(d);
      w.days.push(d);
      keys.forEach(key => w[key].push(k === undefined || !u[key] ? null : u[key][k] ?? null));
    }
    if (job.fill) {
      status("Filling gaps from gridMET…");
      try {
        const g = await Wd.dailyWeather(site.lat, site.lon, d0, d1, "gridmet", elev);
        w.filled = M.fillGaps(w, g);
      } catch (e) { w.fillError = e.message; }
    }
    w.et0Made = fileEt0(w, site.lat, elev);
    w.source = `file ${job.name}`;
    return w;
  }
  /* grass ET0 by FAO-56 from a file's own columns (after any gap filling) on the days with Tmax and Tmin that the file
     gives none for, as the model writers make it: values no station reports left out first, a Tmax below Tmin swapped,
     solar radiation from the temperature range (FAO-56 Eq. 50) where it is missing, and Hargreaves (Eq. 52) on days
     without humidity or wind. Counts the file's own days, the days made, those by Hargreaves and those with Eq. 50. */
  function fileEt0(w, lat, elev) {
    const U = WG.writerUtil, c = U.clean(w), phi = (lat * Math.PI) / 180, n = { own: 0, made: 0, hs: 0, solar: 0 };
    const v = (k, i) => (U.ok(c[k][i]) ? c[k][i] : null);
    w.et0 = w.et0.map((e, i) => {
      if (U.ok(e)) { n.own++; return e; }
      const tx = v("tmax", i), tn = v("tmin", i);
      if (tx === null || tn === null) return null;
      const td = v("tdew", i), u2 = v("wind2", i), pm = td !== null && u2 !== null;
      let rs = v("srad", i);
      if (rs === null && pm) { rs = 0.16 * Math.sqrt(Math.abs(tx - tn)) * U.ra(w.days[i], lat); n.solar++; }
      n.made++;
      if (!pm) n.hs++;
      return Wd.fao56(U.doyOf(w.days[i]), phi, elev ?? 0, Math.max(tx, tn), Math.min(tx, tn), td, u2, rs);
    });
    return n;
  }

  /* ---------- the site's elevation ---------- */
  // the page's lookup started before the sheet first opened for this location, and gives up after 15 s (USGS) and 10 s (Copernicus)
  const ELEV_WAIT = 25000;
  let sheetOpened = null, elevCell = null;
  function noteOpened() { if (!sheetOpened || sheetOpened.tok !== state.token) sheetOpened = { tok: state.token, t: Date.now() }; }
  /* the elevation for the files, { z (m, null if unknown), src, fallback }: the page's lookup, waited for while it may
     still answer; if it gave none, NASA POWER's cell (read once for a location; within about 100 m at 8 Texas points
     tried), else the survey's for its main soil (off by up to 560 m at the same points) */
  async function siteElev(site, status, live) {
    noteOpened();
    if (!state.elev && Date.now() < sheetOpened.t + ELEV_WAIT) status("Waiting for this location's elevation…");
    while (!state.elev && Date.now() < sheetOpened.t + ELEV_WAIT) { await new Promise(r => setTimeout(r, 200)); live(); }
    if (state.elev) return { z: state.elev.z, src: state.elev.src };
    if (elevCell && elevCell.tok === state.token) return elevCell.e;
    status("The elevation lookup gave no answer: asking NASA POWER…");
    try {
      const d = Wd.today() - 30, w = await Wd.dailyWeather(site.lat, site.lon, d, d, "power", null);
      if (w.elev > 0) { elevCell = { tok: state.token, e: { z: w.elev, src: "NASA POWER's 0.5° grid cell", fallback: true } }; return elevCell.e; }
    } catch (e) { console.warn("elevation from NASA POWER", e); }
    const s = state.soil, z = s && s.dominant ? num(s.dominant.elev_r) : null;
    return z !== null ? { z, src: "the soil survey, for its main soil", fallback: true } : { z: null, fallback: true };
  }

  /* the last weather and climate reads: Download after Preview reads nothing twice. Writers never change them. */
  let wxKept = null, climKept = null;
  const climCache = { get: k => (climKept && climKept.key === k ? climKept.wx : null), set: (k, w) => { climKept = { key: k, wx: w }; } };
  async function keptWeather(job, status) {
    const key = JSON.stringify([job.src, job.fill, job.file ? job.units : null, job.site.lat, job.site.lon, job.elev, job.d0, job.d1]);
    if (wxKept && wxKept.key === key && wxKept.file === job.fileSrc) return wxKept.wx;
    const wx = await chosenWeather(job, status);
    wxKept = wx.fillError ? null : { key, file: job.fileSrc, wx }; // a failed fill may work next time
    return wx;
  }

  /* what 10 complete years of the source must be read for, besides the chosen weather, or null. TAV and AMP (DSSAT,
     APSIM) need Tmax and Tmin on 20 or more days of every month, and each group of weather-generator statistics (EPIC,
     APEX, SWAT+) its variables: when the weather lacks them (dates short of a month, a file without solar radiation,
     NASA POWER before its solar record), 10 complete years of the same source (gridMET for a file) are read, with every
     variable when a generator needs them. CENTURY's and DayCent's site files hold climate lines, from 10 years a month:
     the chosen dates if they have them. soil: a soil the models can use is in the files. The area grid asks it for
     each weather cell. */
  function climateNeed(models, wx, soil, src) {
    const U = WG.writerUtil, by = list => (wx ? models.filter(m => list.includes(m)).map(m => MODEL_NAME[m]) : []);
    const tavBy = by(["dssat", "apsim"]), genBy = by(["epic", "apex", "swatplus"]);
    const tav = tavBy.length > 0 && !U.tavAmp(wx, false), gaps = genBy.length ? U.statGaps(wx) : [];
    const centBy = soil && U.centuryNeedsClimate(wx) ? models.filter(m => CLIM_MODELS.includes(m)).map(m => MODEL_NAME[m]) : [];
    if (!tav && !gaps.length && !centBy.length) return null;
    const cs = src === "power" || src === "prism" ? src : "gridmet", per = new Array(12).fill(0);
    if (wx) wx.days.forEach(d => per[new Date(d * 864e5).getUTCMonth()]++);
    const short = !!wx && per.some(x => x < 20), genWhat = gaps.length ? `the weather-generator statistics${short ? "" : ` of ${and(gaps)}`}` : ""; // short: every group lacks those months
    // some: TAV and AMP need temperatures only
    return { cs, some: cs !== "power" && !gaps.length && !centBy.length, src: { power: "NASA POWER", prism: "PRISM", gridmet: "gridMET" }[cs], tav, gaps, tavBy, genBy, centBy, genWhat,
      what: and([tav && "TAV and AMP", genWhat, centBy.length && `${and(centBy.map(shortName))}'s climate lines`].filter(Boolean)),
      why: !wx ? "this download has no weather to work them out from" : short ? "the chosen dates do not cover every month" : tav || gaps.length ? `the weather has fewer than 20 days of ${and(gaps.length ? gaps : ["Tmax and Tmin"])} in some months` : "the chosen dates have fewer than 10 years in some month" };
  }
  // the last of the 10 complete years read for source cs: the year before gridMET's last day (NASA POWER's, 10 days ago)
  const climYear = async cs => new Date((cs === "power" ? Wd.today() - 10 : await Wd.gridmetLast()) * 864e5).getUTCFullYear() - 1;
  // what a read of 10 complete years is kept by, so the area grid can tell the reads it has
  const climateKey = (clim, site, elev, y1) => JSON.stringify([clim.cs, clim.some, site.lat, site.lon, elev, y1]);
  /* the 10 complete years clim asks for at site: { climWx, climError }, with clim.years set. kept: { get(key), set(key,
     wx) }, the reads made before */
  async function climateRead(clim, site, elev, kept) {
    try {
      const y1 = await climYear(clim.cs);
      clim.years = `${y1 - 9}–${y1}`;
      const key = climateKey(clim, site, elev, y1);
      const climWx = kept.get(key) || await Wd.dailyWeather(site.lat, site.lon, Wd.epochDay(y1 - 9, 0, 1), Wd.epochDay(y1, 11, 31), clim.cs, elev, clim.some ? ["tmmx", "tmmn"] : null);
      kept.set(key, climWx);
      return { climWx, climError: null };
    } catch (e) { console.warn("climate statistics", e); return { climWx: null, climError: e.message || String(e) }; }
  }

  const STOPPED = new Error("stopped");
  const notWritten = (what, why, more) => `${what} could not be made: ${String(why).replace(/\.$/, "")}.\r\n${more ? `${more}\r\n` : ""}The other files in this zip are complete; README.txt lists them.\r\n`;
  // a Preview or a Download, with the sheet's choices at this moment
  function run(action) {
    if (running) return;
    const models = $$("input[name=dlModel]:checked").map(i => i.value), series = $$("input[name=dlSeries]:checked").map(i => i.value).filter(k => seriesOn(k, tab));
    if (!models.length && !series.length) return toast("Tick at least one model or table.");
    const a = $("#dlFrom").value, b = $("#dlTo").value;
    if (tab !== "soil" && (!a || !b || a > b)) return toast("Choose a start date before the end date.");
    return work(status => action(models, series, a, b, status));
  }
  // a job with the buttons off, its status shown again if the sheet is opened again meanwhile
  async function work(job) {
    if (running) return;
    running = { tok: state.token, text: "" };
    busy(true);
    const status = t => { running.text = t; $("#dlStatus").textContent = t; };
    status("Working…"); // not the last download's result
    let msg;
    try { msg = await job(status); }
    catch (e) {
      if (e !== STOPPED) console.error(e);
      msg = e === STOPPED ? "Stopped: another location was chosen while the files were being made, so nothing was saved." : `Could not make the files: ${e.message || e}`;
    }
    running = null;
    busy(false);
    $("#dlStatus").textContent = msg;
    if (!shown()) toast(msg, 6000);
  }
  /* the soil for the files, or why there is none. A survey with no usable soil here leaves the weather and the tables,
     written without it and saying why; a survey still loading and what the user typed (own layers, custom depths) stop
     the job, to be put right. modelSoilWhy: the plain CSV and the soil table can list this soil, the models cannot use it. */
  function soilForFiles(models, series) {
    const gap = $("#dlSoil").value === "user" ? "" : surveyGap();
    if (gap && surveyLoading()) throw new Error(gap);
    if (gap) return { soil: null, soilWhy: gap, modelSoilWhy: "" };
    const soil = chosenSoil();
    if (!soil.layers.length) {
      if (!soil.mukey) throw new Error(NO_LAYER);
      return { soil: null, soilWhy: `The survey has no usable layers for ${soil.name}: choose another component, or “My own soil profile…”.`, modelSoilWhy: "" };
    }
    if (!models.some(m => m !== "csv")) return { soil, soilWhy: "", modelSoilWhy: "" };
    try { usableRows(soil); return { soil, soilWhy: "", modelSoilWhy: "" }; }
    catch (e) {
      if (!soil.mukey) throw e;
      return models.includes("csv") || series.includes("soil") ? { soil, soilWhy: "", modelSoilWhy: e.message } : { soil: null, soilWhy: e.message, modelSoilWhy: "" };
    }
  }
  /* the wind series in use, read when the wind tables are made: its source and period */
  function windSeries() {
    const w = state.wind, raw = state.windRaw, per = (raw && raw.period) || (w && w.period) || {}, st = state.windStation && state.windStation.meta, ap = state.windAirport && state.windAirport.meta;
    const model = (raw || w || {}).model === "ecmwf" ? "ECMWF" : "MERRA-2", named = s => `${s.id}${s.name ? ` (${s.name})` : ""}`, pending = state.windStationPending && state.windKey !== "cal";
    const src = state.windKey === "cal" && st ? `${model} calibrated to ${st.tower ? "the mesonet tower" : "the airport"} ${named(st)}`
      : state.windKey === "station" && ap ? `observations at the airport ${named(ap)}`
        : `${model}, not calibrated${pending ? " (the calibration to a nearby station was still running: download again once the Wind tab shows it)" : ""}`;
    return { src, pending, label: per.label || (w && w.start ? `${w.start}–${w.end}` : ""), from: per.from, to: per.to, thr: w && !w.error ? w.thr : null };
  }
  /* everything the files need, up to packing them, for a Preview and a Download alike. It is all read before the first
     await (only the elevation is waited for), so closing the sheet, opening it again or choosing another location cannot
     leak into it; another location stops it */
  async function prepare(models, series, a, b, status) {
    const tok = state.token, live = () => { if (state.token !== tok) throw STOPPED; };
    const site = { lat: state.site.lat, lon: state.site.lon, name: state.place || "SoilGuard site" }, place = state.place;
    const src = $("#dlWx").value, fill = src === "file" && $("#uFill").checked, windHeight = +$("#uWh").value || 2, which = tab;
    const needWx = which !== "soil" && (models.length > 0 || series.includes("daily")), needSoil = which !== "weather" && (models.length > 0 || series.includes("soil")), needDm = series.includes("drought");
    // the Drought Monitor's class here this week, for the README: one request, asked now so it is in by then (the Drought
    // tab's answer when it has read it); none when it does not answer in time
    const dmNow = Promise.all([WG.weather.usdmHere(site.lat, site.lon), WG.weather.usdmDate()]).catch(() => null);
    const fileSrc = needWx && src === "file" ? userWxSrc : null, units = fileSrc ? wxUnits() : null;
    const { soil, soilWhy, modelSoilWhy } = needSoil ? soilForFiles(models, series) : { soil: null, soilWhy: "", modelSoilWhy: "" };
    const file = fileSrc || (needWx && src === "file") ? fileWeather(site, null) : null, away = file ? wxAway() : "";
    // dates outside the source's record are left out; none inside it is an error
    let d0 = a ? Wd.parseDay(a) : null, d1 = b ? Wd.parseDay(b) : null, moved = null;
    if (needWx) {
      const r = wxRange(src, fill, file && { days: file.days, name: fileSrc.name });
      if (d1 < r.first || d0 > r.last) throw new Error(`These dates are outside ${r.what} (${span(r)}).`);
      if (d0 < r.first || d1 > r.last) {
        d0 = Math.max(d0, r.first); d1 = Math.min(d1, r.last);
        moved = `Dates outside ${r.what} (${span(r)}) were left out: the files cover ${Wd.dayLabel(d0)} – ${Wd.dayLabel(d1)}`;
        $("#dlFrom").value = Wd.isoDay(d0); $("#dlTo").value = Wd.isoDay(d1);
        keepForm();
      }
    }
    // the form these files are made from, its dates as moved: a preview of it is not stale for the move
    const key = formKey();
    const wind = windNow(), failed = [], noted = new Map();
    // the hourly series (hourly table, EPIC/APEX .WND) and its analysis (monthly and annual summaries), or why there is none
    const ctx = { wx: null, soil, soilWhy, climWx: null, site: { ...site, elev: null }, wind: wind.raw ? { raw: wind.raw } : null, windWhy: wind.rawWhy, analysis: wind.analysis, analysisWhy: wind.why, d0, d1 };
    // the wind tables come from the series in use now
    const windTables = series.filter(k => ["hourly", "monthly", "annual"].includes(k)).map(k => tableFile(k, ctx, failed)), windFrom = windSeries();
    // the zip's name gives the dates of what is in it: the wind tables follow the wind period, not the form's dates
    const stem = needWx || needDm ? `${Wd.isoDay(d0)}_${Wd.isoDay(d1)}` : windTables.length && windFrom.from ? `${windFrom.from}_${windFrom.to}` : needSoil ? "soil" : "wind";

    const elevAt = needWx ? await siteElev(site, status, live) : null, elev = elevAt ? elevAt.z : null;
    live();
    if (file) file.elev = elev;
    if (soil && elev !== null) soil.elev = elev;
    const read = needWx ? await keptWeather({ src, fill, file, fileSrc, units, name: fileSrc && fileSrc.name, site, elev, d0, d1 }, status) : null;
    live();
    const wx = read && elev === null ? { ...read, elev: null } : read; // the sea level gridMET's air pressure then took is not this place's elevation
    // the Drought Monitor's class at the point for each week the dates touch, within its record (4 January 2000 on)
    if (needDm) {
      try {
        const dm = await WG.weather.usdmRange(site.lat, site.lon, d0, d1, () => state.token === tok, (n, t) => status(t ? `Reading the Drought Monitor at this point: ${n} of ${t} weeks (those read before come from this browser)…` : "Reading the Drought Monitor…"));
        live();
        if (dm.days.length) ctx.dm = dm;
        else ctx.dmWhy = `The Drought Monitor's weekly maps run from ${Wd.dayLabel(WG.weather.USDM_DAY0)} to ${Wd.dayLabel(await WG.weather.usdmLast())}, and these dates hold none of them`;
      } catch (e) { if (e === STOPPED) throw e; ctx.dmWhy = `The Drought Monitor could not be read (${e.message || e}): download again later`; }
      live();
    }
    // days without Tmax and Tmin at either end: the models that cannot read gaps leave them out (their READMEs give the dates)
    let edge = null;
    if (wx) {
      const both = k => Number.isFinite(wx.tmax[k]) && Number.isFinite(wx.tmin[k]), N = wx.days.length;
      let i0 = 0, i1 = N - 1;
      while (i0 < N && !both(i0)) i0++;
      while (i1 > i0 && !both(i1)) i1--;
      if (i0 < N && (i0 > 0 || i1 < N - 1)) edge = `The weather has Tmax and Tmin only from ${Wd.dayLabel(wx.days[i0])} to ${Wd.dayLabel(wx.days[i1])}`;
    }
    const gapless = models.filter(m => ["dssat", "apsim", "aquacrop"].includes(m)).map(m => MODEL_NAME[m]);
    // 10 complete years of the same source when the weather lacks what TAV and AMP, the generator statistics or the
    // climate lines need (climateNeed)
    const clim = climateNeed(models, wx, soil && !soilWhy && !modelSoilWhy, src);
    let climWx = null, climError = null;
    if (clim) {
      status(`${cap(clim.why)}: reading 10 complete years of ${clim.src} for ${clim.what}…`);
      ({ climWx, climError } = await climateRead(clim, site, elev, climCache));
      live();
    }
    Object.assign(ctx, { wx, climWx, site: { ...site, elev } });
    const files = [];
    for (const m of models) {
      status(`Writing ${MODEL_NAME[m]} files…`);
      try {
        const w = M.writers[m];
        if (!w) throw new Error("its writer is not available yet");
        const noSoil = soilWhy || (m === "csv" ? "" : modelSoilWhy); // the plain CSV lists a soil the models cannot use
        const out = await w(noSoil ? { ...ctx, soil: null } : ctx), own = out.find(f => f.name === "README.txt");
        if (noSoil && own) own.text += `\r\nNo soil file: ${noSoil}\r\n`;
        out.forEach(f => files.push({ ...f, name: `${m}/${f.name}` }));
        (Array.isArray(out.notes) ? out.notes : []).forEach(n => noted.set(n, [...(noted.get(n) || []), MODEL_NAME[m]]));
      } catch (e) {
        console.error(e);
        // the reason without the model's own name in front ("EPIC: the .WP1 ..."), as it is filed under that name
        const why = String(e.message || e).replace(new RegExp(`^${MODEL_NAME[m].split(" ")[0].replace(/\+/g, "\\+")}: `), "");
        failed.push({ what: MODEL_NAME[m], why });
        // a generator whose missing statistics the failed climate read was to supply: a later download may get them
        const more = climError && ((clim.gaps.length && clim.genBy.includes(MODEL_NAME[m])) || clim.centBy.includes(MODEL_NAME[m])) ? `Reading 10 complete years of ${clim.src} for ${clim.what} failed (${climError}); downloading again may get them.` : "";
        files.push({ name: `${m}/NOT_WRITTEN.txt`, text: notWritten(`The ${MODEL_NAME[m]} files`, why, more) });
      }
    }
    files.push(...windTables, ...series.filter(k => k === "daily" || k === "drought" || k === "soil").map(k => tableFile(k, ctx, failed)));
    // the same reason, or note, once for all it concerns
    const whyOf = list => [...new Set(list.map(f => f.why))].map(r => `${and(list.filter(f => f.why === r).map(f => f.what))}: ${r.replace(/\.$/, "")}`).join("; "), why = whyOf(failed);
    const notes = [...noted].map(([t, ms]) => `${and(ms)}: ${t}`), n = files.filter(f => !/NOT_WRITTEN/.test(f.name)).length;
    // nothing to save: a failed climate read is then the reason a second try may work
    if (!n) throw new Error(`${why || "there was nothing to write"}${climError ? `. Reading 10 complete years of ${clim.src} for ${clim.what} failed (${climError}); downloading again may get them` : ""}`);
    const now = await Promise.race([dmNow, new Promise(r => setTimeout(() => r(null), 5000))]);
    live();
    files.push({ name: "README.txt", text: readme(ctx, { which, models, series, moved, edge, clim, climError, notes, failed, windHeight, file, away, elevAt, windFrom, now }) });
    // the status gives the missing soil once, with the soil table when it went for the same reason
    const noSoilIn = models.filter(m => soilWhy || (m !== "csv" && modelSoilWhy)).map(m => MODEL_NAME[m]), tableGone = failed.filter(f => noSoilIn.length && f.why === soilWhy), otherFails = failed.filter(f => !tableGone.includes(f));
    const warn = [moved && `${moved}.`, away, elevAt && elevAt.fallback && (elev === null ? "No elevation could be read for this location: see the README." : `The elevation lookup gave no answer, so the files use ${UN.fmt("elev", elev)} from ${elevAt.src}.`),
      noSoilIn.length && `No soil file for ${and([...noSoilIn, ...tableGone.map(f => f.what)])}: ${soilWhy || modelSoilWhy}`, windTables.length && windFrom.pending && "The wind tables hold the series not yet calibrated, as the calibration was still running.", edge && gapless.length && `${edge}: the ${and(gapless)} files leave out the other days.`,
      climWx && `${cap(clim.what)} come from 10 complete years of ${clim.src} (${clim.years}), because ${clim.why}.`,
      climError && `${cap(clim.why)}, and reading 10 complete years of ${clim.src} for ${clim.what} failed (${climError}).`,
      ctx.dm && ctx.dm.missing && `${ctx.dm.missing} week${ctx.dm.missing > 1 ? "s" : ""} of the Drought Monitor could not be read: ${ctx.dm.missing > 1 ? "they are" : "it is"} blank in its table.`,
      wx && wx.fillError && `Gaps could not be filled from gridMET (${wx.fillError}).`, wx && wx.source === "prism" && wx.rest !== "gridMET" && `PRISM has only rain and temperature: ${wx.rest ? `solar radiation, humidity and wind are from ${wx.rest}, as ${wx.restWhy}` : `there is no solar radiation, humidity or wind, as ${wx.restWhy}`}.`, otherFails.length && `Not written: ${whyOf(otherFails)}.`,
      notes.length && `${notes.length} note${notes.length > 1 ? "s" : ""} from the model files.`].filter(Boolean);
    return { tok, live, key, ctx, files, n, models, series, notes, failed, site, place, d0, d1, stem, warn, names: MODEL_NAME };
  }
  // the zip's files, README.txt and any NOT_WRITTEN.txt among them, as the preview counts them
  const fileCount = p => `${p.files.length} file${p.files.length === 1 ? "" : "s"}`;
  async function saveZip(p, status) {
    status("Packing…");
    const blob = await M.zip(p.files);
    p.live();
    X.save(blob, `${D.baseName(p.stem, p.site, p.place)}.zip`, "application/zip");
    return `Done: ${fileCount(p)}.${p.warn.length ? ` ${p.warn.join(" ")} See README.txt.` : ""}`;
  }
  async function build(models, series, a, b, status) {
    return saveZip(await prepare(models, series, a, b, status), status);
  }
  async function preview(models, series, a, b, status) {
    const p = await prepare(models, series, a, b, status);
    p.live();
    previewed = { tok: p.tok, key: p.key, job: p };
    showPreview(true);
    return `Nothing is saved yet: this is what the ${fileCount(p)} will hold.${p.warn.length ? ` ${p.warn.join(" ")}` : ""}`;
  }
  /* the files the preview drew, whatever the form says now: only for the location they were made for */
  function saveShown(status) {
    if (!previewed || previewed.tok !== state.token) throw new Error("the preview is not for this location: preview again");
    return saveZip(previewed.job, status);
  }
  const and = a => (a.length > 1 ? `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}` : a[0]);
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const shortName = n => n.split(" ")[0]; // "CENTURY 4.0 and 4.5" -> "CENTURY", as in the sentences that name it

  /* one table, or a note saying why it is missing */
  function tableFile(k, ctx, failed) {
    try { return seriesFile(k, ctx); }
    catch (e) {
      failed.push({ what: SERIES_NAME[k], why: String(e.message || e) });
      return { name: `tables/${TABLE[k]}_NOT_WRITTEN.txt`, text: notWritten(SERIES_NAME[k], e.message || e) };
    }
  }
  const rd = (v, d) => (Number.isFinite(v) ? +v.toFixed(d) : null); // null for missing, NaN or Infinity
  function seriesFile(k, ctx) {
    const ws = UN.sym("wind"), cw = v => rd(UN.conv("wind", v), 2), name = `tables/${TABLE[k]}.csv`;
    if (k === "monthly" || k === "annual") {
      if (!ctx.analysis) throw new Error(ctx.analysisWhy);
      const t = D.summary(k, ctx.analysis);
      return { name, text: X.csv(t.header, t.rows) };
    }
    if (k === "hourly") {
      if (!ctx.wind) throw new Error(ctx.windWhy);
      const raw = ctx.wind.raw, off = raw.offset || 0, P = raw.period, rows = [];
      raw.hourly.t.forEach((t, i) => { if (P && (t < P.t0 || t >= P.t1)) return; const d = new Date((t + off) * 1000); rows.push([new Date(t * 1000).toISOString().slice(0, 16) + "Z", d.toISOString().slice(0, 16).replace("T", " "), cw(raw.hourly.ws[i]), rd(raw.hourly.wd[i], 0)]); });
      return { name, text: X.csv(["Time (UTC)", `Local standard time (${Wd.zoneLabel()})`, `Wind speed at 10 m (${ws})`, "Direction from (deg)"], rows) };
    }
    if (k === "daily") {
      const w = WG.writerUtil.clean(ctx.wx), U2 = q => v => rd(UN.conv(q, v), 2); // values no station reports are blank, as in the model files
      const p = U2("precip"), t = U2("temp"), sr = U2("solar");
      // with the Drought Monitor's table, each day's class too: that of the map holding it (the Tuesday on or before it)
      const dm = ctx.dm, dmOf = d => { const i = Math.floor((d - dm.days[0]) / 7); return i >= 0 && i < dm.days.length && dm.dm[i] !== null ? dm.dm[i] : null; };
      return { name, text: X.csv(["Date", `Precipitation (${UN.sym("precip")})`, `Tmax (${UN.sym("temp")})`, `Tmin (${UN.sym("temp")})`, `Solar radiation (${UN.sym("solar")})`,
        "Relative humidity (%)", `Dew point (${UN.sym("temp")})`, `Wind at 10 m (${ws})`, `Grass ET0 (${UN.sym("precip")})`, ...(dm ? ["Drought Monitor class (-1 none, 0-4 D0-D4)"] : [])],
        w.days.map((d, i) => [Wd.isoDay(d), p(w.prcp[i]), t(w.tmax[i]), t(w.tmin[i]), sr(w.srad[i]), rd(w.rh[i], 1), t(w.tdew[i]), cw(w.wind10[i]), p(w.et0[i]), ...(dm ? [dmOf(d)] : [])])) };
    }
    if (k === "drought") {
      if (!ctx.dm) throw new Error(ctx.dmWhy);
      const t = WG.weather.usdmTable(ctx.dm.days, ctx.dm.dm);
      return { name, text: X.csv(t.header, t.rows) };
    }
    if (!ctx.soil) throw new Error(ctx.soilWhy);
    // every value rounded, and blank when missing (null, NaN): depths as in the depth box, so they read back to the same
    // 0.1 cm; Ksat mm/h to the table's unit only when present, as null / 3.6 would be 0, impermeable
    const s = ctx.soil, dz = v => rd(UN.conv("depth", v), depthDp()), ks = v => (Number.isFinite(v) ? rd(UN.conv("ksat", v / 3.6), 3) : null);
    return { name, text: X.csv([`Top (${UN.sym("depth")})`, `Bottom (${UN.sym("depth")})`, "Horizon", "Sand (%)", "Silt (%)", "Clay (%)", "Organic matter (%)", "Organic carbon (%)",
      "Bulk density (g/cm3)", "Wilting point (cm3/cm3)", "Field capacity (cm3/cm3)", "Saturation (cm3/cm3)", `Ksat (${UN.sym("ksat")})`, "pH", "CEC (cmol/kg)", "CaCO3 (%)", "Coarse fragments (% volume)", "EC (dS/m)"],
      s.layers.map(l => [dz(l.top), dz(l.bot), l.hz, rd(l.sand, 2), rd(l.silt, 2), rd(l.clay, 2), rd(l.om, 2), rd(l.oc, 2), rd(l.bd, 2), rd(l.ll, 3), rd(l.dul, 3), rd(l.sat, 3), ks(l.ksat),
        rd(l.ph, 2), rd(l.cec, 2), rd(l.caco3, 2), rd(l.cfVol, 1), rd(l.ec, 2)])) };
  }

  /* the elevation the files use and where it came from */
  function elevText(e) {
    if (e.z === null) return "Elevation: unknown, as the elevation lookup, the soil survey and NASA POWER gave none. gridMET's humidity and dew point and ET0 worked out from your file take air pressure at sea level; DSSAT's .WTH writes -99 and the SWAT+, EPIC and APEX files write 0, so set yours before running them.";
    return `Elevation: ${+e.z.toFixed(1)} m${e.fallback ? ` from ${e.src}, as the elevation lookup gave no answer` : e.src ? ` (${e.src.replace(/ \d+ m.*$/, "")})` : ""}.`;
  }
  /* how the files' wind was made, by source */
  function windText(w, o) {
    const has = a => Array.isArray(a) && a.some(v => v !== null && v !== undefined);
    const gm = w.filled && w.filled.wind10 ? ` ${w.filled.wind10} days come from gridMET's 10 m wind (2 m = 0.748 × 10 m).` : "";
    const how = w.source === "gridmet" || (w.source === "prism" && w.rest === "gridMET") ? "gridMET daily mean wind at 10 m; the 2 m wind is 0.748 × the 10 m value (FAO-56 Eq. 47)."
      : w.source === "power" || (w.source === "prism" && w.rest) ? "NASA POWER daily mean wind at 10 m (WS10M) and at 2 m (WS2M), each used as it is."
        : w.source === "prism" ? "none, as neither gridMET nor NASA POWER answered."
        : has(o.file && o.file.wind10) ? `your file's wind, measured at ${o.file.windHeight ? o.file.windHeight.z : o.windHeight} m and moved to 10 m and 2 m with the log law (roughness 0.03 m).${gm}`
          : `your file has none.${gm || " The model files leave it out or mark it missing."}`;
    return `Daily wind in the weather files: ${how} Each model file states its height.`;
  }
  /* the soil the model files start from: its horizons (or your layers, or the custom layers) with water retention and
     bulk density. The models split or merge them, so each model folder's README gives the layers its file has. */
  function soilText(s, o) {
    const lay = s.layering === "custom" ? "custom depths" : s.layering === "survey" ? "the horizons as they are" : "each model's usual layers";
    const made = o.models.some(m => !o.failed.some(f => f.what === MODEL_NAME[m])), c = v => +v.toFixed(1);
    // only tables in this zip: no model files to tell about
    if (!made) return [`Soil: ${s.name}, ${s.source}. The soil table lists its ${s.layers.length} layers, ${c(s.layers[0].top)} to ${c(s.layers[s.layers.length - 1].bot)} cm.`];
    const L = [`Soil: ${s.name}, ${s.source}. Layers: ${lay}.`];
    let use = null;
    try { use = WG.writerUtil.soilRows(s); } catch (e) { /* no layer with water retention and bulk density */ }
    if (!use) return [...L, "  No layer has water retention and bulk density; only the plain CSV and the soil table describe it."];
    const n = use.length, end = use[n - 1].bot, rest = s.layers.filter(l => l.top >= end), rl = s.relayer, pl = n > 1 ? "s" : "";
    const from = s.layering === "custom" ? `${n} layer${pl} on your depths (bottoms ${use.map(l => c(l.bot)).join(", ")} cm)`
      : `${n} ${s.mukey ? "horizon" : "layer"}${pl} with water retention and bulk density`;
    L.push(`  The model files start from ${from}, ${c(use[0].top)} to ${c(end)} cm.`
      + (rl && rl.cut !== null ? ` The profile ends at ${c(rl.cut)} cm (bedrock or a cemented layer).`
        : rest.length ? ` Below ${c(end)} cm ${s.mukey ? "the survey gives no water retention or bulk density (bedrock or a cemented layer)" : "the layers have no water retention or bulk density"}, so the profile ends there.` : "")
      + (rl && rl.extendedBelow !== null ? ` Below ${c(rl.extendedBelow)} cm ${s.mukey ? "the survey has no horizons" : "your profile has no layers"}, so the deepest one is repeated.` : "")
      + (s.layering === "model" ? " Each model splits or merges them its own way."
        : n > 5 ? ` The models that take fewer layers (AquaCrop at most 5${n > 10 ? ", APEX 10" : ""}${n > 15 ? ", EPIC 15" : ""}${n > 20 ? ", DSSAT 20" : ""}) merge the thinnest neighbours.` : "")
      + " Each model folder's README gives the layers that model's file has.");
    if (rest.length && (o.series.includes("soil") || o.models.includes("csv"))) L.push(`  The soil table and the plain CSV list all ${s.layers.length} layers, to ${c(s.layers[s.layers.length - 1].bot)} cm, as ${s.mukey ? "the survey gives" : "you entered"} them.`);
    return L;
  }
  /* where a file's grass ET0 came from, by day */
  function et0Text(w) {
    const e = w.et0Made, none = w.days.length - e.own - e.made, after = w.filled ? " after the gap filling" : "", pm = e.made - e.hs;
    const days = x => `${x.toLocaleString()} day${x === 1 ? "" : "s"}`;
    return `Grass ET0: ${and([e.own && `${days(e.own)} from your file's own column`,
      pm && `${days(pm)} by FAO-56 Penman-Monteith from the file's columns${after}${e.solar ? ` (solar radiation from the temperature range, FAO-56 Eq. 50, on ${days(e.solar)})` : ""}`,
      e.hs && `${days(e.hs)} by Hargreaves (FAO-56 Eq. 52) from Tmax and Tmin${after}, for want of humidity or wind`,
      none && `none on ${days(none)} without Tmax and Tmin`].filter(Boolean))}.`
      + (w.filled ? " gridMET's ET0 is not copied in, as it would not match your weather." : "");
  }
  /* the source of the 10 years read for the climate, named as a Weather line names it, for a README with no Weather line
     from that source: PRISM's terms ask for its name, address and the date read */
  function climCredit(cw) {
    const cell = `cell ${cw.lat.toFixed(4)}, ${cw.lon.toFixed(4)}`;
    if (cw.source === "gridmet") return `Source: gridMET 4 km daily (University of Idaho; Abatzoglou 2013), ${cell}.`;
    if (cw.source === "power") return "Source: NASA POWER daily (MERRA-2 based, 0.5°).";
    // a read of temperatures only (TAV and AMP) asks for no other variable
    const rest = cw.rest ? `; solar radiation, humidity and wind from ${cw.rest}` : cw.restWhy ? `; no solar radiation, humidity or wind, as ${cw.restWhy}` : "";
    return `Source: rain, Tmax and Tmin from PRISM 4 km (PRISM Group, Oregon State University, https://prism.oregonstate.edu, accessed ${new Date().toISOString().slice(0, 10)}), read through ACIS (NOAA Regional Climate Centers), ${cell}${rest}.`;
  }
  function readme(ctx, o) {
    const w = ctx.wx, s = ctx.soil, c = o.clim;
    const L = [`SoilGuard data for ${ctx.site.name} (${ctx.site.lat.toFixed(5)}, ${ctx.site.lon.toFixed(5)})`, `Made ${new Date().toISOString().slice(0, 10)} with ${location.origin}${location.pathname}`,
      ...(o.now ? [`Drought Monitor this week (map of ${Wd.isoDay(o.now[1])}): ${o.now[0] < 0 ? "no drought class (normal or wet)" : `D${o.now[0]} ${WG.weather.DCLASS.find(c => c[0] === `D${o.now[0]}`)[2].toLowerCase()}`} at this point.`] : []),
      ...(o.which === "both" ? [] : [`This download holds the ${o.which} files only: the other tab of the sheet makes the ${o.which === "soil" ? "weather" : "soil"} files.`]), ""];
    if (w) {
      L.push(`Weather: ${w.source === "gridmet" ? "gridMET 4 km daily (University of Idaho; Abatzoglou 2013), cell " + w.lat.toFixed(4) + ", " + w.lon.toFixed(4) : w.source === "power" ? "NASA POWER daily (MERRA-2 based, 0.5°)" : w.source === "prism" ? `PRISM 4 km daily, cell ${w.lat.toFixed(4)}, ${w.lon.toFixed(4)}. ${Wd.prismNote(w.rest)}` : w.source}`);
      if (o.file) L.push(...readLines(o.file));
      if (o.away) L.push(o.away);
      L.push(elevText(o.elevAt));
      L.push(`Dates: ${Wd.isoDay(ctx.d0)} to ${Wd.isoDay(ctx.d1)} (${w.days.length} days). DSSAT, APSIM and AquaCrop cannot read gaps: each folder's README says how their files deal with them. The other files use the model's missing-value code.`);
      if (o.moved) L.push(`${o.moved}.`);
      if (o.edge) L.push(`${o.edge}. DSSAT, APSIM and AquaCrop leave out the days without them (their READMEs give the dates).`);
      if (w.filled) L.push(`Gaps filled from gridMET: ${Object.entries(w.filled).map(([k, n]) => `${k} ${n} days`).join(", ") || "none needed"}.`);
      if (w.fillError) L.push(`Gaps could not be filled: ${w.fillError}`);
      if (w.et0Made) L.push(et0Text(w));
      L.push(windText(w, o), "");
    }
    // why 10 complete years were read, for which models' statistics, and what they did when the read failed
    if (c && ctx.climWx) L.push(`Climate statistics: ${and([c.tav && `TAV and AMP (${and(c.tavBy)})`, c.gaps.length && `${c.genWhat} (${and(c.genBy)})`, c.centBy.length && `the climate lines of ${and(c.centBy.map(shortName))}'s site file${c.centBy.length > 1 ? "s" : ""}`].filter(Boolean))} come from 10 complete years of ${c.src}, `
      + `${Wd.isoDay(ctx.climWx.days[0])} to ${Wd.isoDay(ctx.climWx.days[ctx.climWx.days.length - 1])}, because ${c.why}. Each model folder's README says which of its statistics use them.${w && w.source === ctx.climWx.source ? "" : ` ${climCredit(ctx.climWx)}`}`, "");
    else if (c && o.climError) L.push(`Climate statistics: ${c.why}, and reading 10 complete years of ${c.src} for ${c.what} failed (${o.climError}).`
      + (c.tav ? ` ${and(c.tavBy)} ${c.tavBy.length > 1 ? "take" : "takes"} TAV and AMP from the months the dates have instead, marked approximate.` : "")
      + (c.gaps.length ? ` For ${and(c.genBy)}, the folder's README says where the generator statistics came from, or a NOT_WRITTEN.txt in its place says why the files could not be made.` : "")
      + (c.centBy.length ? ` ${c.centBy.length > 1 ? "The CENTURY and DayCent READMEs say where their site files'" : `${shortName(c.centBy[0])}'s README says where its site file's`} climate lines came from, or why ${c.centBy.length > 1 ? "a site file" : "that file"} could not be made.` : ""), "");
    if (s) L.push(...soilText(s, o), ...(s.notes || []).map(n => `  ${n}`), "");
    else if (ctx.soilWhy) L.push(`Soil: none in these files. ${ctx.soilWhy}`, "");
    const made = what => !o.failed.some(f => f.what === what);
    const wnd = w ? o.models.filter(m => m === "epic" || m === "apex").map(m => MODEL_NAME[m]).filter(made) : []; // the .WND comes with the weather only
    // the wind tables and .WND follow the wind period, whatever the dates of the weather
    const summaries = o.series.filter(k => (k === "monthly" || k === "annual") && made(SERIES_NAME[k]));
    const held = [...o.series.filter(k => ["hourly", "monthly", "annual"].includes(k) && made(SERIES_NAME[k])).map(k => `tables/${TABLE[k]}.csv`), ...(ctx.wind ? wnd.map(n => `the ${n} .WND`) : [])];
    if (held.length) L.push(`Wind series in ${and(held)}: ${o.windFrom.src}, ${o.windFrom.label} (the series in use on the Wind tab${w ? ", not the dates above" : ""}).`
      + (summaries.length ? ` Erosive threshold ${fmt(UN.conv("wind", o.windFrom.thr), 1)} ${UN.sym("wind")} at 10 m.${summaries.includes("monthly") ? " The monthly summary averages that period by calendar month." : ""}` : ""), "");
    if (!ctx.wind && wnd.length) L.push(`${and(wnd)} wind file (.WND): ${ctx.windWhy}, so it uses daily mean wind, with directions spread evenly (the folder's README says from which days).`, "");
    if (ctx.dm && made(SERIES_NAME.drought)) {
      const dm = ctx.dm, n = dm.days.length;
      L.push(`Drought Monitor in tables/drought_monitor_weekly.csv: the class at this point on each weekly map that holds a day of ${Wd.isoDay(ctx.d0)} to ${Wd.isoDay(ctx.d1)}, ${Wd.isoDay(dm.days[0])} to ${Wd.isoDay(dm.days[n - 1])} (${n} week${n > 1 ? "s" : ""}; `
        + `a map, dated a Tuesday, holds that day to the next Monday; the record starts on 4 January 2000), ${WG.weather.usdmSrc(dm.src)}. Class code: -1 no drought class (normal or wet), 0 D0 abnormally dry, 1 D1 moderate, 2 D2 severe, 3 D3 extreme, 4 D4 exceptional drought; in drought: D1 to D4.`
        + `${dm.missing ? ` ${dm.missing} week${dm.missing > 1 ? "s" : ""} could not be read and ${dm.missing > 1 ? "are" : "is"} blank.` : ""}${o.series.includes("daily") && made(SERIES_NAME.daily) && w ? " tables/daily_weather.csv gives each day the class of the map holding it." : ""} ${WG.weather.USDM_CREDIT}`, "");
    }
    if (o.notes.length) L.push("Notes from the model files:", ...o.notes.map(n => `  ${n}`), "");
    if (o.failed.length) L.push("Not written (a NOT_WRITTEN.txt in its place says why):", ...o.failed.map(f => `  ${f.what}: ${f.why}`), "");
    L.push(`Models: ${o.models.filter(m => made(MODEL_NAME[m])).map(m => `${MODEL_NAME[m]} (${m}/)`).join(", ") || "none"}. Tables: ${o.series.filter(k => made(SERIES_NAME[k])).map(k => `tables/${TABLE[k]}.csv`).join(", ") || "none"}.`,
      "See the README inside each model folder, where present, for how to load the files.");
    return L.join("\r\n") + "\r\n";
  }

  // the form is saved as it is filled in, in the units of that moment, so a later change of units converts it correctly
  ["input", "change"].forEach(t => $("#dataBody").addEventListener(t, () => { keepForm(); checkStale(); climNote(); })); // climNote: the CENTURY box
  /* the sheet is the panel's DOWNLOAD data for models tab: app.js renders it whenever the tab is shown */
  function show() {
    if (!state.site) return toast("Pick a location on the map first.");
    render();
  }
  /* for the area grid, which offers the same choices for each cell: the models, layer depths, weather units and file,
     the sources' records, the weather read and the 10 complete years the files may need */
  return { render, show, MODELS, CLIM_MODELS, DEPTH_SETS, depthText, depthsCm, unitFields, wxUnits, fileText, wxRange, chosenWeather, climateNeed, climYear, climateKey, climateRead };
})();
