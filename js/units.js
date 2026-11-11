/* Units: one table of quantities, each kept internally in a base unit and converted only for display and table
   exports. Model files (DSSAT, SWAT+, EPIC/APEX ...) never use these: they write each model's own units.
   Presets: "default" (US field units with the soil-laboratory table in SI, as the app has always shown),
   "metric" (SI) and "us" (US customary). Changing one row makes the choice "custom". */
WG.units = (function () {
  const { cache, fmt: fmtNum, esc } = WG.util;
  const F = (k, d) => ({ f: v => v * k, b: v => v / k, d });
  /* key: { label, use, base, units: { sym: {f, b, d} }, default, metric, us } - f converts base -> unit, b back,
     d = decimals shown by default. Base units are the units the data arrive in. */
  const Q = {
    wind: { label: "Wind speed", use: "mean wind, gusts, erosive threshold, calibration statistics", base: "m/s",
      units: { "m/s": F(1, 1), "km/h": F(3.6, 0), mph: F(2.23694, 1), kn: F(1.94384, 1) }, default: "mph", metric: "m/s", us: "mph" },
    precip: { label: "Precipitation and ET₀", use: "rain, reference evapotranspiration, irrigation", base: "mm",
      units: { mm: F(1, 0), in: F(1 / 25.4, 2) }, default: "in", metric: "mm", us: "in" },
    temp: { label: "Temperature", use: "air temperature (soil survey, weather downloads)", base: "°C",
      units: { "°C": { f: v => v, b: v => v, d: 1 }, "°F": { f: v => v * 1.8 + 32, b: v => (v - 32) / 1.8, d: 1 } }, default: "°C", metric: "°C", us: "°F" },
    elev: { label: "Elevation", use: "site and model-cell elevation", base: "m",
      units: { m: F(1, 0), ft: F(3.28084, 0) }, default: "ft", metric: "m", us: "ft" },
    depth: { label: "Soil depth", use: "horizon depths, soil and restrictive-layer depth", base: "cm",
      units: { cm: F(1, 0), mm: F(10, 0), in: F(1 / 2.54, 1) }, default: "cm", metric: "cm", us: "in" },
    waterDepth: { label: "Soil water depth", use: "available water storage, stage-1 evaporation limit", base: "mm",
      units: { mm: F(1, 0), cm: F(0.1, 1), in: F(1 / 25.4, 2) }, default: "mm", metric: "mm", us: "in" },
    awc: { label: "Available water capacity", use: "AWC of a layer", base: "cm/cm",
      units: { "cm/cm": F(1, 2), "mm/m": F(1000, 0), "in/in": F(1, 2), "in/ft": F(12, 2) }, default: "cm/cm", metric: "cm/cm", us: "in/in" },
    ksat: { label: "Saturated hydraulic conductivity", use: "Ksat of a layer", base: "µm/s",
      units: { "µm/s": F(1, 1), "mm/h": F(3.6, 1), "cm/h": F(0.36, 2), "in/h": F(0.141732, 2) }, default: "cm/h", metric: "mm/h", us: "in/h" },
    area: { label: "Area", use: "field and area analysis", base: "m²",
      units: { ha: F(1e-4, 1), "km²": F(1e-6, 2), ac: F(1 / 4046.8564, 0), "mi²": F(1 / 2589988.11, 2) }, default: "ac", metric: "ha", us: "ac" },
    distance: { label: "Distance", use: "station distance, search radius", base: "km",
      units: { km: F(1, 0), mi: F(0.621371, 0) }, default: "km", metric: "km", us: "mi" },
    length: { label: "Length", use: "barrier height and spacing, strip widths, buffers", base: "m",
      units: { m: F(1, 1), ft: F(3.28084, 0) }, default: "ft", metric: "m", us: "ft" },
    shortLength: { label: "Short length", use: "stubble height, row spacing, tillage and seeding depth", base: "cm",
      units: { cm: F(1, 0), in: F(1 / 2.54, 1) }, default: "in", metric: "cm", us: "in" },
    soilLoss: { label: "Soil loss rate", use: "bare-soil potential E, erodibility I, tolerable loss T", base: "t/ac/yr",
      units: { "t/ha/yr": F(2.24170, 0), "t/ac/yr": F(1, 0) }, default: "t/ac/yr", metric: "t/ha/yr", us: "t/ac/yr",
      edges: [10, 40, 80, 150] }, // the app's risk classes for E: Low, Moderate, High, Very high, Extreme
    massArea: { label: "Mass per area", use: "seeding rates, residue, herbicide, range production", base: "lb/ac",
      units: { "kg/ha": F(1.12085, 0), "lb/ac": F(1, 0) }, default: "lb/ac", metric: "kg/ha", us: "lb/ac" },
    massAreaHeavy: { label: "Mulch and soil mass per area", use: "straw and hay mulch, blowing soil", base: "t/ac",
      units: { "t/ha": F(2.24170, 1), "t/ac": F(1, 1) }, default: "t/ac", metric: "t/ha", us: "t/ac" },
    seedDensity: { label: "Seed density", use: "pure live seed per area", base: "PLS/ft²",
      units: { "PLS/m²": F(10.7639, 0), "PLS/ft²": F(1, 0) }, default: "PLS/ft²", metric: "PLS/m²", us: "PLS/ft²" },
    solar: { label: "Solar radiation", use: "weather downloads", base: "MJ/m²/d",
      units: { "MJ/m²/d": F(1, 1), "kWh/m²/d": F(1 / 3.6, 2), "langley/d": F(23.9006, 0) }, default: "MJ/m²/d", metric: "MJ/m²/d", us: "MJ/m²/d" },
  };
  const PRESETS = { default: "US field, soil lab in SI", metric: "All metric (SI)", us: "All US customary" };
  // names from the address, storage or the page are looked up as own keys only ("constructor" is not a preset)
  const own = (o, k) => typeof k === "string" && Object.prototype.hasOwnProperty.call(o, k);

  const saved = cache.get("units") || {};
  const fromUrl = new URLSearchParams(location.search).get("units");
  let preset = own(PRESETS, fromUrl) ? fromUrl : own(PRESETS, saved.preset) || saved.preset === "custom" ? saved.preset : "default";
  const cur = {};
  for (const k in Q) cur[k] = preset === "custom" && saved.units && own(Q[k].units, saved.units[k]) ? saved.units[k] : Q[k][preset === "custom" ? "default" : preset];
  const listeners = [];

  function persist() { cache.set("units", { preset, units: preset === "custom" ? { ...cur } : undefined }); }
  function changed() { persist(); listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); }

  function usePreset(name) {
    if (!own(PRESETS, name)) return;
    preset = name;
    for (const k in Q) cur[k] = Q[k][name];
    changed();
  }
  function set(q, sym) {
    if (!own(Q, q) || !own(Q[q].units, sym) || cur[q] === sym) return;
    cur[q] = sym;
    preset = Object.keys(PRESETS).find(p => Object.keys(Q).every(k => cur[k] === Q[k][p])) || "custom";
    changed();
  }

  const spec = q => Q[q].units[cur[q]];
  const conv = (q, v) => (v === null || v === undefined || !Number.isFinite(+v) ? null : spec(q).f(+v));
  const back = (q, v) => (v === null || v === undefined || !Number.isFinite(+v) ? null : spec(q).b(+v));
  const sym = q => cur[q];
  const dp = (q, d) => (d === undefined ? spec(q).d : d);
  /* "11.4 mph" (narrow no-break space); dash for missing values */
  const fmt = (q, v, d, dash = "—") => { const x = conv(q, v); return x === null ? dash : `${fmtNum(x, dp(q, d))} ${sym(q)}`; };
  const num = (q, v, d) => fmtNum(conv(q, v), dp(q, d)); // number only, in the chosen unit
  const html = (q, v, d) => { const x = conv(q, v); return x === null ? "—" : `${fmtNum(x, dp(q, d))} <small>${esc(sym(q))}</small>`; };
  /* a range "4–12 in" */
  const range = (q, a, b, d) => `${num(q, a, d)}–${num(q, b, d)} ${sym(q)}`;
  /* a value whose defining unit is the base (e.g. WEQ I in t/ac/yr): "193 t/ha/yr (86 t/ac/yr)" when they differ */
  // decimals of the base unit, which need not be one of the choices (area is kept in m² but offered in ha, km², ac, mi²)
  const baseD = q => (Q[q].units[Q[q].base] || { d: 0 }).d;
  const both = (q, v, d) => (cur[q] === Q[q].base || v === null || v === undefined ? fmt(q, v, d)
    : `${fmt(q, v, d)} (${fmtNum(+v, baseD(q))} ${Q[q].base})`);
  /* a value given in some other unit of the same quantity, e.g. a spec written as 1.5 ft: inUnit("length", 1.5, "ft") */
  const fromUnit = (q, v, u) => Q[q].units[u].b(v);
  const as = (q, v, u, d) => fmt(q, fromUnit(q, v, u), d);
  /* a published US value in the chosen system, keeping the original in parentheses when converted: "0.46 m (1.5 ft)" */
  const spec2 = (q, v, u, d) => (cur[q] === u ? `${fmtNum(v, d ?? Q[q].units[u].d)} ${u}` : `${as(q, v, u, d)} (${fmtNum(v, d ?? Q[q].units[u].d)} ${u})`);

  /* Classes of a quantity with edges (soil loss: the risk classes). cls: the class of the exact value (base unit),
     0 below the first edge. fmtCls: the value to d decimals, or where that rounding would carry it across an edge, to
     one more (cut toward its class if still needed), so the number shown and its class agree in every unit:
     39.56 t/ac/yr is Moderate and reads "39.6 t/ac/yr", not "40". edge: an edge as a label number, whole unless
     rounding would lower it (10 t/ac/yr = 22.417 t/ha/yr reads 22.4), so no value fmtCls shows sits on the wrong
     side of a label (with "22" a Low 22.2 t/ha/yr, shown as 22, would read as Moderate). */
  const cls = (q, v) => Q[q].edges.filter(e => v >= e).length;
  const edge = (q, e) => { const x = conv(q, e); return fmtNum(x, Math.round(x) < x - 1e-9 ? 1 : 0); };
  function fmtCls(q, v, d) {
    const x = conv(q, v);
    if (x === null) return fmt(q, v, d);
    const k = cls(q, +v), es = Q[q].edges.map(e => spec(q).f(e)), at = y => es.filter(e => y >= e).length;
    let n = dp(q, d), y = Math.round(x * 10 ** n) / 10 ** n;
    if (at(y) !== k) {
      n++; y = Math.round(x * 10 ** n) / 10 ** n;
      if (at(y) !== k) y = (at(y) > k ? Math.floor : Math.ceil)(x * 10 ** n) / 10 ** n;
    }
    return `${fmtNum(y, n)} ${sym(q)}`;
  }

  return {
    Q, PRESETS, get preset() { return preset; }, get: q => cur[q], all: () => ({ ...cur }),
    conv, back, sym, fmt, num, html, range, both, as, spec: spec2, fromUnit, dp, baseD, cls, fmtCls, edge,
    set, usePreset, on: fn => listeners.push(fn),
    query: () => (preset === "metric" || preset === "us" ? `&units=${preset}` : ""),
  };
})();
