/* Templates for the user's own files: the layout a weather or soil file should have. The user ticks the columns they
   have and picks each one's unit; the layout shows as they choose, and the template's column names state the units, so
   the filled-in file loads with nothing else to set (the readers in WG.models take these names back). */
WG.templates = (function () {
  const { esc, toast } = WG.util;
  const X = WG.export, M = WG.models;
  const same = v => v;
  /* [value, name in the list, text in the column name, from the column's base unit] */
  const TEMP = [["C", "°C", "C", same], ["F", "°F", "F", v => v * 1.8 + 32], ["K", "K", "K", v => v + 273.15]];
  const RAIN = [["mm", "mm", "mm", same], ["in", "inches", "in", v => v / 25.4], ["cm", "cm", "cm", v => v / 10]];
  const SOLAR = [["MJ", "MJ/m²/day", "MJ/m2/d", same], ["W", "W/m² (daily mean)", "W/m2", v => v / 0.0864], ["kWh", "kWh/m²/day", "kWh/m2/d", v => v / 3.6],
    ["ly", "langley/day", "langley/d", v => v / 0.04184], ["kJ", "kJ/m²/day", "kJ/m2/d", v => v * 1000]];
  const RH = [["pct", "%", "%", same], ["frac", "fraction, 0 to 1", "fraction", v => v / 100]];
  const WIND = [["ms", "m/s", "m/s", same], ["mph", "mph", "mph", v => v / 0.44704], ["kmh", "km/h", "km/h", v => v * 3.6], ["kn", "knots", "kn", v => v / 0.514444]];
  const DATE = [["iso", "YYYY-MM-DD"], ["us", "M/D/YYYY"], ["doy", "year, day of year"], ["ymd", "year, month, day"]];
  const DEPTH = [["cm", "cm", "cm", same], ["in", "inches", "in", v => v / 2.54], ["mm", "mm", "mm", v => v * 10], ["m", "m", "m", v => v / 100], ["ft", "feet", "ft", v => v / 30.48]];
  const MASS = [["pct", "%", "%", same], ["gkg", "g/kg", "g/kg", v => v * 10]];
  const WATER = [["frac", "cm³/cm³", "cm3/cm3", same], ["pct", "% by volume", "% vol", v => v * 100]];
  const BD = [["g", "g/cm³", "g/cm3", same], ["kg", "kg/m³", "kg/m3", v => v * 1000]];
  const KSAT = [["mmh", "mm/h", "mm/h", same], ["cmh", "cm/h", "cm/h", v => v / 10], ["cmd", "cm/day", "cm/d", v => v * 2.4], ["mmd", "mm/day", "mm/d", v => v * 24],
    ["md", "m/day", "m/d", v => v * 0.024], ["ums", "µm/s", "um/s", v => v / 3.6], ["inh", "in/h", "in/h", v => v / 25.4], ["ind", "in/day", "in/d", v => (v * 24) / 25.4]];
  const EC = [["ds", "dS/m", "dS/m", same], ["ms", "mS/cm", "mS/cm", same], ["us", "µS/cm", "uS/cm", v => v * 1000]];
  const one = (name, text) => [["u", name, text, same]];

  /* the columns: k, name in the file, what it holds, need: the file cannot do without it, on: ticked at first, units,
     ex: three example rows in the base unit */
  const WEATHER = [
    { k: "date", head: "date", name: "Date", what: "The day of the row", need: true, units: DATE },
    { k: "tmax", head: "tmax", name: "Tmax", what: "Highest air temperature of the day", need: true, units: TEMP, ex: [12.5, 14.2, 16] },
    { k: "tmin", head: "tmin", name: "Tmin", what: "Lowest air temperature of the day", need: true, units: TEMP, ex: [-3.1, -1, 2.4] },
    { k: "prcp", head: "prcp", name: "Rain", what: "Rain and melted snow of the day", need: true, units: RAIN, ex: [0, 2.5, 0] },
    { k: "srad", head: "srad", name: "Solar radiation", what: "Incoming solar radiation", on: true, units: SOLAR, ex: [11.8, 9.6, 13.2] },
    { k: "rh", head: "rh", name: "Humidity", what: "Mean relative humidity (or the next two)", on: true, units: RH, ex: [62, 71, 55] },
    { k: "rhmax", head: "rhmax", name: "RHmax", what: "Highest relative humidity of the day", units: RH, ex: [88, 94, 80] },
    { k: "rhmin", head: "rhmin", name: "RHmin", what: "Lowest relative humidity of the day", units: RH, ex: [38, 46, 30] },
    { k: "tdew", head: "tdew", name: "Dew point", what: "Mean dew point", units: TEMP, ex: [-4.2, -1.5, 1.2] },
    { k: "wind", head: "wind", name: "Wind", what: "Mean wind speed of the day", on: true, units: WIND, ex: [3.4, 4.1, 2.8] },
    { k: "et0", head: "et0", name: "Grass ET₀", what: "Grass reference ET, if you have it; else it is worked out", units: RAIN, ex: [1.8, 1.2, 2.2] },
  ];
  const SOIL = [
    { k: "top", head: "Top", name: "Top depth", what: "Top of the layer; if left out, the bottom of the layer above", on: true, units: DEPTH, ex: [0, 15, 30] },
    { k: "bot", head: "Bottom", name: "Bottom depth", what: "Bottom of the layer", need: true, units: DEPTH, ex: [15, 30, 60] },
    { k: "sand", head: "Sand", name: "Sand", what: "Of the fine earth", need: true, units: MASS, ex: [40, 38, 35] },
    { k: "silt", head: "Silt", name: "Silt", what: "Of the fine earth; if left out, 100 − sand − clay", on: true, units: MASS, ex: [35, 32, 30] },
    { k: "clay", head: "Clay", name: "Clay", what: "Of the fine earth", need: true, units: MASS, ex: [25, 30, 35] },
    { k: "om", head: "Organic matter", name: "Organic matter", what: "If left out, from organic carbon, else blank where the file can do without", on: true, units: MASS, ex: [1.5, 0.9, 0.5] },
    { k: "oc", head: "Organic carbon", name: "Organic carbon", what: "Instead of organic matter (× 1.724)", units: MASS, ex: [0.87, 0.52, 0.29] },
    { k: "bd", head: "Bulk density", name: "Bulk density", what: "If left out, estimated (Saxton & Rawls 2006)", units: BD, ex: [1.4, 1.45, 1.5] },
    { k: "ll", head: "Wilting point", name: "Wilting point", what: "Water at 15 bar, whole soil; if left out, estimated", units: WATER, ex: [0.12, 0.15, 0.18] },
    { k: "dul", head: "Field capacity", name: "Field capacity", what: "Water at 1/3 bar, whole soil; if left out, estimated", units: WATER, ex: [0.25, 0.27, 0.3] },
    { k: "sat", head: "Saturation", name: "Saturation", what: "Water at saturation, by volume; if left out, estimated", units: WATER, ex: [0.42, 0.41, 0.4] },
    { k: "ksat", head: "Ksat", name: "Ksat", what: "Saturated conductivity; if left out, estimated", units: KSAT, ex: [12, 8, 5] },
    { k: "ph", head: "pH", name: "pH", what: "In water, 1:1", units: one("pH", "1:1 water"), ex: [7.5, 7.8, 8] },
    { k: "cec", head: "CEC", name: "CEC", what: "Cation exchange capacity", units: one("cmol/kg", "cmol/kg"), ex: [18, 20, 22] },
    { k: "caco3", head: "CaCO3", name: "CaCO₃", what: "Calcium carbonate", units: MASS, ex: [1, 2, 5] },
    { k: "cfVol", head: "Coarse fragments", name: "Coarse fragments", what: "Larger than 2 mm", units: one("% by volume", "% volume"), ex: [2, 2, 5] },
    { k: "ec", head: "EC", name: "EC", what: "Electrical conductivity", units: EC, ex: [0.3, 0.4, 0.5] },
  ];
  const KINDS = {
    weather: { cols: WEATHER, file: "weather_template", title: "What the file should look like, and a template to fill in",
      intro: "One row per day, with the column names in the first row. CSV, text or Excel (its first sheet). Columns can be in any order and extra columns are ignored; a blank cell, text, −99 or below, 999 or 9999 means missing, and rows through the day are summarised to days. Files from NASA POWER, Open-Meteo, Campbell loggers (TOA5), GHCN, CIMIS, Davis and similar load as they come." },
    soil: { cols: SOIL, file: "soil_template", title: "What a soil file should look like, and a template to fill in",
      intro: "One row per layer, with the column names in the first row. CSV, text or Excel (its first sheet). Columns can be in any order and extra columns are ignored; a blank cell means missing, and missing water retention, bulk density and Ksat are estimated from sand, clay and organic matter." },
  };
  const state = { weather: { open: false, on: {}, unit: {}, height: 2 }, soil: { open: false, on: {}, unit: {}, rows: "example" } };

  const isOn = (kind, c) => !!c.need || (state[kind].on[c.k] ?? !!c.on);
  const unitOf = (kind, c) => c.units.find(u => u[0] === state[kind].unit[c.k]) || c.units[0];
  const rnd = v => (Number.isFinite(v) ? +v.toFixed(Math.abs(v) >= 1000 ? 1 : Math.abs(v) >= 1 ? 2 : 3) : "");
  const two = n => String(n).padStart(2, "0");

  /* the template as a table: { header, rows } */
  function weatherTable() {
    const on = WEATHER.filter(c => isOn("weather", c)), y = new Date().getUTCFullYear() - 1, S = state.weather;
    const date = unitOf("weather", WEATHER[0])[0];
    const dateHead = { iso: ["date"], us: ["date (M/D/YYYY)"], doy: ["year", "doy"], ymd: ["year", "month", "day"] }[date];
    const dateCells = i => ({ iso: [`${y}-01-${two(i + 1)}`], us: [`1/${i + 1}/${y}`], doy: [y, i + 1], ymd: [y, 1, i + 1] }[date]);
    const cols = on.filter(c => c.k !== "date");
    const head = c => `${c.k === "wind" ? `wind at ${+S.height || 2} m` : c.head} (${unitOf("weather", c)[2]})`;
    return { header: [...dateHead, ...cols.map(head)], rows: [0, 1, 2].map(i => [...dateCells(i), ...cols.map(c => rnd(unitOf("weather", c)[3](c.ex[i])))]) };
  }
  /* the soil template; survey: whether its rows are the survey's, as asked, or the examples for want of any */
  function soilTable() {
    const on = SOIL.filter(c => isOn("soil", c)), S = state.soil;
    let layers = null;
    if (S.rows === "survey") {
      // as the sheet's own profile starts: the horizons the model files use, else all of them
      let s = null;
      try { s = M.surveySoil(WG.state); layers = s ? WG.writerUtil.soilRows(s) : null; } catch (e) { layers = s ? s.layers : null; }
      if (layers && !layers.length) layers = null;
    }
    const rows = layers ? layers.map(l => on.map(c => (Number.isFinite(l[c.k]) ? rnd(unitOf("soil", c)[3](l[c.k])) : ""))) : [0, 1, 2].map(i => on.map(c => rnd(unitOf("soil", c)[3](c.ex[i]))));
    return { header: on.map(c => `${c.head} (${unitOf("soil", c)[2]})`), rows, survey: !!layers };
  }
  const tableOf = kind => (kind === "weather" ? weatherTable() : soilTable());

  /* ---------- on the page ---------- */
  const unitCell = (kind, c) => {
    const sel = c.units.length > 1 ? `<select data-tpl-unit="${c.k}" aria-label="Unit of ${esc(c.name)}">${c.units.map(u => `<option value="${u[0]}" ${unitOf(kind, c) === u ? "selected" : ""}>${esc(u[1])}</option>`).join("")}</select>` : esc(c.units[0][1]);
    return c.k === "wind" ? `${sel} <label class="tpl-h">at <input type="number" data-tpl-height min="0.5" max="50" step="0.5" value="${state.weather.height}" aria-label="Height the wind is measured at, in metres"> m</label>` : sel;
  };
  const sample = t => `<thead><tr>${t.header.map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${t.rows.map(r => `<tr>${r.map(v => `<td>${esc(v)}</td>`).join("")}</tr>`).join("")}</tbody>`;
  // what the rows shown are: the survey's only when they are
  const fillNote = (kind, t) => (kind === "weather" ? "Replace these example rows with your days." : t.survey ? "These are this location's survey layers: change them to yours."
    : state.soil.rows === "survey" ? "The survey has no soil layers here (or has not come in yet), so these are example rows: replace them with your layers." : "Replace these example rows with your layers.");
  function box(kind) {
    const K = KINDS[kind], S = state[kind], t = tableOf(kind);
    return `<details class="tpl" data-tpl="${kind}" ${S.open ? "open" : ""}><summary>${esc(K.title)}</summary>
      <p class="fine">${esc(K.intro)}</p>
      <p class="fine"><b>Tick the columns you have and choose their units.</b> The template's column names then say the units, so your file needs nothing else.</p>
      <div class="table-wrap"><table class="grid tpl-table"><thead><tr><th>Have it</th><th>Column</th><th>Unit or format</th></tr></thead><tbody>
        ${K.cols.map(c => `<tr><td><input type="checkbox" data-tpl-on="${c.k}" ${isOn(kind, c) ? "checked" : ""} ${c.need ? "disabled" : ""} aria-label="I have ${esc(c.name)}"></td>
          <td><b>${esc(c.name)}</b>${c.need ? ` <small class="tpl-need">needed</small>` : ""}<small>${esc(c.what)}</small></td><td>${unitCell(kind, c)}</td></tr>`).join("")}
      </tbody></table></div>
      ${kind === "soil" ? `<div class="pv-tools"><label class="pv-lab">Rows in the template <select data-tpl-rows><option value="example" ${S.rows === "example" ? "selected" : ""}>Examples</option><option value="survey" ${S.rows === "survey" ? "selected" : ""}>This location's survey layers, to edit</option></select></label></div>` : ""}
      <h4>Your template</h4>
      <div class="table-wrap"><table class="grid tpl-show" data-tpl-show>${sample(t)}</table></div>
      <p class="fine" data-tpl-note>${esc(fillNote(kind, t))}</p>
      <div class="area-actions"><button class="btn small" data-tpl-save="csv">Download the template (CSV)</button><button class="btn small" data-tpl-save="xlsx">Download the template (Excel)</button></div>
    </details>`;
  }
  function wire(kind, root) {
    const el = root.querySelector(`[data-tpl="${kind}"]`), S = state[kind];
    if (!el) return;
    const redraw = () => { const t = tableOf(kind); el.querySelector("[data-tpl-show]").innerHTML = sample(t); el.querySelector("[data-tpl-note]").textContent = fillNote(kind, t); };
    el.addEventListener("toggle", () => { S.open = el.open; });
    const change = e => {
      const t = e.target, d = t.dataset;
      if (d.tplOn) S.on[d.tplOn] = t.checked;
      else if (d.tplUnit) S.unit[d.tplUnit] = t.value;
      else if (d.tplHeight !== undefined) S.height = +t.value >= 0.5 && +t.value <= 50 ? +t.value : 2;
      else if (d.tplRows !== undefined) S.rows = t.value;
      else return;
      redraw();
    };
    el.addEventListener("change", change);
    el.addEventListener("input", e => { if (e.target.dataset.tplHeight !== undefined) change(e); });
    el.addEventListener("click", e => { const b = e.target.closest("[data-tpl-save]"); if (b) save(kind, b.dataset.tplSave, b); });
  }
  /* ---------- the file ---------- */
  async function save(kind, as, btn) {
    const K = KINDS[kind], t = tableOf(kind);
    if (as === "csv") return X.save(X.csv(t.header, t.rows), `${K.file}.csv`, "text/csv;charset=utf-8");
    btn.disabled = true;
    try {
      await M.loadXlsx();
      const wb = XLSX.utils.book_new(), data = XLSX.utils.aoa_to_sheet([t.header, ...t.rows]);
      data["!cols"] = t.header.map(h => ({ wch: Math.max(10, h.length + 2) }));
      XLSX.utils.book_append_sheet(wb, data, "Data");
      const on = K.cols.filter(c => isOn(kind, c)), help = [["Fill in the first sheet: one row per " + (kind === "weather" ? "day" : "layer") + ". This sheet is not read."], [], ["Column", "Holds", "Unit or format", ""],
        ...on.map(c => [c.name, c.what, unitOf(kind, c)[1], c.need ? "needed" : ""])];
      const hs = XLSX.utils.aoa_to_sheet(help);
      hs["!cols"] = [{ wch: 18 }, { wch: 58 }, { wch: 20 }, { wch: 8 }];
      XLSX.utils.book_append_sheet(wb, hs, "How to fill");
      X.save(new Blob([XLSX.write(wb, { type: "array", bookType: "xlsx" })], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${K.file}.xlsx`);
    } catch (e) { toast(`Could not make the Excel file: ${e.message || e}`); } finally { btn.disabled = false; }
  }
  return { box, wire, tableOf, state, WEATHER, SOIL };
})();
