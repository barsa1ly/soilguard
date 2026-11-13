/* Drought: the map's theme besides wind erosion, its live overlays (the U.S. Drought Monitor and NOAA CPC's drought
   outlooks) and the Drought tab. Every source and formula here is listed in the
   Methods sheet (js/methods.js) and docs/METHODS.md §8. Loaded before app.js, which builds the map from WG.weather.layers
   and calls WG.weather.show when a tab is shown. */
WG.weather = (function () {
  const { $, esc, fmt, MONTHS } = WG.util;
  const UN = WG.units, Wd = WG.wind, TM = WG.timemap;
  const ok = v => v !== null && v !== undefined && Number.isFinite(v);

  /* ---------- themes ---------- */
  const ICON = {
    erosion: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9h11a3 3 0 1 0-3-3M3 14h15a3 3 0 1 1-3 3M3 19h7"/></svg>`,
    drought: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="9" r="3.5"/><path d="M12 2v1.5M5 9H3.5M20.5 9H19M6.8 3.8l1 1M17.2 3.8l-1 1M3 21h18M6 17.5l2.5 2M11 16.5l1 2.5M16 17.5l-1.5 2"/></svg>`,
  };
  const THEMES = [
    { key: "erosion", name: "Wind erosion", short: "Erosion", title: "Wind erosion: bare-soil susceptibility, erodibility groups, wind climate and spring wind", icon: ICON.erosion,
      hint: "to see wind-erosion risk, seasonal wind, soil profile and control practices. Shaded colors show statewide bare-soil susceptibility.",
      note: "Statewide 1 km overlays from the soil survey, NRCS climatic factors and NASA POWER's 2001–2025 wind climatology. The panel shows Overview, Wind, Soil and Practices." },
    { key: "drought", name: "Drought", short: "Drought", title: "Drought: the U.S. Drought Monitor, and drought between years", icon: ICON.drought, layersTitle: "Drought",
      hint: "to see this week's drought and how drought has come and gone between years.",
      note: "The Drought Monitor of this week or any week since 2000. The panel shows Drought: this week at the point, and drought indices between chosen years since 1980." },
  ];
  THEMES.forEach(t => { if (!t.layersNote) t.layersNote = ""; });

  /* ---------- live overlays ---------- */
  /* WMS overlays, each from the agency that makes it (methods: docs/METHODS.md §8). One is on the map at a time; the
     live ones are asked again every few minutes while shown, as their producers update them. */
  const NOAA = "https://mapservices.weather.noaa.gov/";
  const DRO = `${NOAA}vector/services/outlooks/cpc_drought_outlk/MapServer/WMSServer`;
  const USDM = map => `https://ndmcgeodata.unl.edu/cgi-bin/mapserv.exe?map=/ms4w/apps/usdm/map/${map}.map`;
  const USDM_CREDIT = "The U.S. Drought Monitor is jointly produced by the National Drought Mitigation Center at the University of Nebraska-Lincoln, the U.S. Department of Agriculture, the National Oceanic and Atmospheric Administration and NASA. Map courtesy of NDMC, via https://droughtmonitor.unl.edu.";
  const legendImg = (url, layer) => `${url}${url.includes("?") ? "&" : "?"}service=WMS&version=1.3.0&request=GetLegendGraphic&sld_version=1.1.0&format=image/png&layer=${encodeURIComponent(layer)}`; // MapServer needs sld_version; the others accept it
  function wms(url, name, o = {}) {
    const l = L.tileLayer.wms(url, { layers: name, format: "image/png", transparent: true, pane: "thematic", maxZoom: 19, attribution: o.attribution, ...(o.params || {}) });
    if (o.refresh) setInterval(() => { if (l._map) l.setParams({ _t: Date.now() }); }, o.refresh * 60e3); // a fresh image while on the map
    return l;
  }
  /* how each layer's classes are measured for the legend's % column (js/shares.js): the colours from the code's own
     table (the Drought Monitor's classes) or from the service's legend (ArcGIS legend JSON: the outlooks); the image of
     the whole box from the same service as the map */
  const DRO_REST = `${NOAA}vector/rest/services/outlooks/cpc_drought_outlk/MapServer`;
  const DRO_NAMES = { persistence: "Drought persists", improvement: "Drought remains but improves", removal: "Drought removal likely", development: "Drought development likely", "no drought": "No drought" };
  const droShares = (name, id) => ({ id: `dro${id}`, wms: { url: DRO, layers: name }, legendJSON: { url: DRO_REST, id }, relabel: L => L.map(([c, l]) => [c, DRO_NAMES[l.toLowerCase()] || l]), none: "No drought" });
  // the Drought Monitor's classes, D0 first as its own legend
  const dmClasses = () => DCLASS.slice().reverse().map(c => [c[3], `${c[0]} ${c[2]}`]);

  /* ---------- the date a layer shows ----------
     A layer of "this week", "the latest" or "now" gives the date or time it shows (dateOf: a string, or a promise of
     one), which the legend writes in brackets after its title, so a map saved or printed still says when it was. Each is
     read from the producer's own service in one small request, kept until the source's next update (fresh), so a legend
     drawn again and its note ask nothing twice. */
  const memo = new Map();
  const fresh = (key, min, f) => {
    const m = memo.get(key);
    if (m && Date.now() - m.t < min * 60e3) return m.p;
    const p = f();
    memo.set(key, { t: Date.now(), p });
    p.catch(() => { if ((memo.get(key) || {}).p === p) memo.delete(key); }); // a failed read is asked again next time
    return p;
  };
  // a time on the viewer's own clock, with its zone: "12 Nov 2026, 3 pm CST"; with to, a span: "12 Nov 2026, 6 pm – 13 Nov, 6 pm CST"
  const CLOCK = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  function timeLabel(t, to) {
    const p = ms => { const o = {}; CLOCK.formatToParts(new Date(ms)).forEach(x => { o[x.type] = x.value; }); return { d: `${o.day} ${o.month}`, y: o.year, h: `${o.hour}${o.minute === "00" ? "" : `:${o.minute}`} ${(o.dayPeriod || "").toLowerCase()}`, z: o.timeZoneName }; };
    const a = p(t), b = to === undefined ? null : p(to);
    return b ? `${a.d} ${a.y}, ${a.h}${a.z === b.z ? "" : ` ${a.z}`} – ${b.d}${b.y === a.y ? "" : ` ${b.y}`}, ${b.h} ${b.z}` : `${a.d} ${a.y}, ${a.h} ${a.z}`;
  }
  // the first feature's fields in a layer of NOAA's map services, whose footprints hold the times their images show
  const restAt = (path, fields, min, where = "1=1") => fresh(`${path}|${fields}|${where}`, min, () => WG.util.fetchJSON(`${NOAA}${path}/query?where=${encodeURIComponent(where)}&outFields=${fields}&returnGeometry=false&f=json`, {}, 20000)
    .then(j => { const a = ((j.features || [])[0] || {}).attributes; if (!a) throw new Error(`no features in ${path}`); return a; }));
  /* the REST layer behind each WMS name (the service numbers the two the other way round): the drought outlooks'
     footprints hold the month or day they run to and their issue date */
  const droTo = id => () => restAt(`vector/rest/services/outlooks/cpc_drought_outlk/MapServer/${id}`, "fcst_date,target", 360).then(a => {
    const [m, d, y] = String(a.fcst_date).split("/").map(Number), t = /^([A-Za-z]+) (\d{1,2})$/.exec(a.target || ""), k = t ? MONTHS.findIndex(x => t[1].startsWith(x)) : -1;
    return `${k >= 0 ? `to ${Wd.dayLabel(Date.UTC(k < m - 1 ? y + 1 : y, k, +t[2]) / 864e5)}` : a.target}, issued ${Wd.dayLabel(Date.UTC(y, m - 1, d) / 864e5)}`; // the seasonal outlook runs to a day with no year ("January 31")
  });

  // the U.S. Drought Monitor: its week from the map's own title; a year ago and five years ago are the same week then
  let usdmWeek = null;
  const usdmDate = () => (usdmWeek = usdmWeek || WG.util.fetchText(`${USDM("usdm_current_wms")}&SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities`, 20000).then(t => {
    const m = /Drought Monitor (\d\d)\/(\d\d)\/(\d{4})/.exec(t);
    if (!m) throw new Error("no date in the Drought Monitor's capabilities");
    return Date.UTC(+m[3], +m[1] - 1, +m[2]) / 864e5;
  }).catch(e => { usdmWeek = null; throw e; })); // a failed read is asked again next time
  const ymdStr = d => Wd.isoDay(d).replace(/-/g, "");
  const usdmLayer = (key, name, weeksBack, def) => {
    const layer = wms(USDM("usdm_current_wms"), "usdm_current", { attribution: "U.S. Drought Monitor (NDMC, USDA, NOAA)" });
    if (weeksBack) layer.on("add", () => usdmDate().then(d => { const w = ymdStr(d - weeksBack * 7); layer.setUrl(USDM(`usdm_${w}_wms`)); layer.setParams({ layers: `usdm${w}` }); }).catch(() => {}));
    return { key, name, def, layer, sub: weeksBack ? `the same week ${weeksBack === 52 ? "a year" : "five years"} before this week's map` : "this week's map, released Thursdays",
      note: `D0 abnormally dry, D1 moderate, D2 severe, D3 extreme, D4 exceptional drought. ${USDM_DATED} ${USDM_CREDIT}`,
      legend: { title: name, img: legendImg(USDM("usdm_current_wms"), "usdm_current") },
      dateOf: () => usdmDate().then(d => Wd.dayLabel(d - (weeksBack || 0) * 7)),
      // the week's own dated map (the same as usdm_current for this week; kept in the browser as a dated week)
      shares: { id: key, tag: () => usdmDate().then(d => d - (weeksBack || 0) * 7), url: (b, W, H, t) => usdmMapUrl(+t, b, W, H), classes: dmClasses, none: "No drought" } };
  };
  // the week chosen on the bar is in the past-week layer's name (usdm20261104); this week's until one is chosen
  const usdmPast = TM.usdmLayer();
  const pastWeek = () => { const m = /^usdm(\d{4})(\d\d)(\d\d)$/.exec(usdmPast.wmsParams.layers || ""); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5 : usdmDate(); };
  const USDM_DATED = "The date is the Tuesday the map is valid for; it comes out two days later.";
  const layers = {
    drought: [
      usdmLayer("usdm", "Drought Monitor, this week", 0, true),
      usdmLayer("usdm1", "Drought Monitor, a year ago", 52),
      usdmLayer("usdm5", "Drought Monitor, five years ago", 261),
      { key: "usdmPast", name: "Drought Monitor, a past week", sub: "any week since January 2000: choose the year and month", layer: usdmPast,
        note: `D0 abnormally dry, D1 moderate, D2 severe, D3 extreme, D4 exceptional drought. ${USDM_DATED} ${USDM_CREDIT}`,
        legend: { title: "Drought Monitor, a past week", img: legendImg(USDM("usdm_current_wms"), "usdm_current") }, dateOf: () => TM.label("usdm").replace(/^Week of /, "") || null, // the week chosen on the bar
        shares: { id: "usdmPast", tag: pastWeek, url: (b, W, H, t) => usdmMapUrl(+t, b, W, H), classes: dmClasses, none: "No drought" } },
      { key: "dro1", name: "Drought outlook, this month", sub: "NOAA Climate Prediction Center", layer: wms(DRO, "5", { attribution: "NOAA CPC" }), dateOf: droTo(1),
        note: "Where drought is expected to persist, improve, end or develop by the end of the month: NOAA Climate Prediction Center's monthly drought outlook, issued on the month's last day.",
        legend: { title: "Monthly drought outlook", img: legendImg(DRO, "5") }, shares: droShares("5", 1) },
      { key: "dro3", name: "Drought outlook, this season", sub: "NOAA Climate Prediction Center, three months", layer: wms(DRO, "2", { attribution: "NOAA CPC" }), dateOf: droTo(4),
        note: "The same over the next three months: NOAA Climate Prediction Center's seasonal drought outlook, issued on the third Thursday of the month.",
        legend: { title: "Seasonal drought outlook", img: legendImg(DRO, "2") }, shares: droShares("2", 4) },
    ],
  };


  /* ---------- legend ---------- */
  /* a live overlay's legend: colour rows, a continuous scale with ticks, or the producer's own legend image. Its title
     carries the date the layer shows (dateOf): at once when known, else as soon as it is read (a read already made
     answers before the page is painted); a layer that updates reads it again at its own interval while its legend is up. */
  // a date after a title, in brackets; a title that ends in its source's brackets takes it inside them: "(NWM, 12 Nov 2026, 2 pm CST)"
  const dated = (t, d) => (!d ? t : /\)$/.test(t) ? `${t.slice(0, -1)}, ${d})` : `${t} (${d})`);
  let dseq = 0, dateT = null; // the legend drawn last, and the timer that dates it again
  function legend(el, it, min, toggle) {
    const g = it.legend || {}, my = ++dseq;
    clearInterval(dateT);
    const dateNow = () => { try { return it.dateOf ? it.dateOf() : null; } catch (e) { console.warn("legend date", e); return null; } };
    const head = d => `${esc(dated(g.title || it.name, d))}${g.unit ? ` <small style="font-weight:400;color:#69716a">(${esc(typeof g.unit === "function" ? g.unit() : g.unit)})</small>` : ""}`;
    const put = d => Promise.resolve(d).then(t => { const s = el.querySelector("h5 > span"); if (my === dseq && it.on && t && s) s.innerHTML = head(t); }, () => {}); // not once another legend is drawn
    if (it.prep && !it.prepped) it.prepped = it.prep(it).then(() => { g.failed = false; if (it.on) legend(el, it, min, toggle); }, e => { console.warn("legend", e); it.prepped = null; g.failed = true; if (it.on) legend(el, it, min, toggle); });
    el.hidden = false;
    el.classList.toggle("min", min);
    const body = g.img ? `<div class="rows"><img src="${esc(g.img)}" alt="Legend: ${esc(it.name)}"></div>`
      : g.scale && !g.scale.length ? `<p class="lnote">${g.failed ? "The colour scale could not be read from the NWS map service; choose the layer again to retry." : "Reading the colour scale…"}</p>`
      : g.scale ? `<div class="rows"><div class="lscale">${g.scale.map(c => `<i style="background:${c}"></i>`).join("")}</div><div class="lticks">${g.ticks.map(([at, t]) => `<span style="left:${(100 * at).toFixed(1)}%">${esc(t)}</span>`).join("")}</div></div>`
        : `<div class="rows">${(g.rows || []).map(([c, l]) => `<div class="row"><i class="sw" style="background:${c}"></i>${esc(l)}</div>`).join("")}</div>`;
    const d0 = dateNow();
    el.innerHTML = `<h5><span>${head(typeof d0 === "string" ? d0 : null)}</span>
      <button id="legendMin">${min ? "show" : "hide"}</button></h5>${body}<p class="lnote" id="legendNote">${esc(it.note || "")}</p>`;
    $("#legendMin").onclick = toggle;
    if (d0 && typeof d0 !== "string") put(d0);
    // a layer that updates: its date read again at its own interval, and its % column (a new image is measured anew)
    if (it.dateOf && it.refresh) dateT = setInterval(() => { if (!it.on) { clearInterval(dateT); return; } put(dateNow()); if (WG.shares && my === dseq) WG.shares.attach(el, it); }, it.refresh * 60e3);
    if (it.when) it.when().then(t => { const n = $("#legendNote"); if (n && t && el.contains(n)) n.textContent = `${it.note || ""} ${t}`.trim(); }).catch(() => {});
    if (WG.shares) WG.shares.attach(el, it); // each class's % of the states or your boundary (js/shares.js)
  }

  /* ---------- the panel's tabs ---------- */
  const cache = new Map(); // token:what -> promise, so a tab shown again reads nothing twice for the same location
  const once = (what, f) => { const k = `${WG.state.token}:${what}`; if (!cache.has(k)) cache.set(k, f().catch(e => { cache.delete(k); throw e; })); return cache.get(k); };
  const DL = `<svg viewBox="0 0 24 24"><path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/></svg>`;
  function card(id, title, height, fig) {
    const f = { own: true, title, file: fig.file, x: fig.x, sub: fig.sub, table: fig.table };
    if (WG.downloads) WG.downloads.addFig(id, f); else document.addEventListener("DOMContentLoaded", () => WG.downloads.addFig(id, f), { once: true }); // a link with a location draws the tab before downloads.js has loaded
    return `<div class="card"><div class="card-h"><h3>${esc(title)}</h3><button class="dl-btn" data-fig="${id}" title="Download this figure or its data" aria-label="Download ${esc(title)}">${DL}</button></div>
      <div class="chart-box" style="height:${height}px"><canvas id="${id}"></canvas></div>${fig.foot ? `<p class="fine">${fig.foot}</p>` : ""}</div>`;
  }
  const siteLine = () => { const s = WG.state; return `${s.place ? `${s.place} · ` : ""}${s.site.lat.toFixed(4)}, ${s.site.lon.toFixed(4)}`; };
  const wait = what => `<div class="card"><p class="fine"><span class="skeleton" style="width:60%"></span></p><p class="fine">Reading ${esc(what)}…</p></div>`;
  const failed = (what, e) => `<div class="card"><p class="fine">Could not read ${esc(what)}: ${esc(e.message || String(e))}. <button type="button" class="link wx-retry" data-wx-retry>Reload</button></p></div>`;
  /* Reload on a part that could not be read: its tab is drawn again for this location. What was read is kept (once() and
     the keep cache), so only the failed parts are asked again; the Soil maps tabs draw each other, so all four are redrawn. */
  document.addEventListener("click", e => {
    const b = e.target.closest && e.target.closest("[data-wx-retry]"), sec = b && b.closest("section.tab");
    if (!sec || !WG.state.site) return;
    const name = sec.id.replace(/^tab-/, "");
    if (!RENDER[name]) return;
    e.preventDefault();
    (name.startsWith("soil") ? ["soiloverview", "soilmaps", "soilbasin", "soilmoist"] : [name]).forEach(n => { const s = document.getElementById(`tab-${n}`); if (s) s.dataset.key = ""; });
    show(name, sec);
  });

  const RENDER = {}; // tab -> async (el, live) => void, below
  const C = WG.charts.C, Ch = WG.charts;
  const sum = a => a.reduce((s, x) => s + x, 0), mean = a => (a.length ? sum(a) / a.length : null);
  const ymd = d => { const x = new Date(d * 864e5); return [x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()]; };
  const axis = (text, extra = {}) => ({ title: { display: true, text }, ...extra });

  const YEAR_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"]; // the Drought tab's year lines: a validated categorical order, by slot

  const CPC = "https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/"; // NOAA CPC's outlooks, queried at the point
  const outlook = (product, layer, lat, lon) => WG.util.fetchJSON(`${CPC}${product}/MapServer/${layer}/query?${new URLSearchParams({ geometry: `${lon},${lat}`, geometryType: "esriGeometryPoint", inSR: "4326", spatialRel: "esriSpatialRelIntersects", outFields: "*", returnGeometry: "false", f: "json" })}`, {}, 20000)
    .then(j => (j.features && j.features[0] ? j.features[0].attributes : null));

  /* ---------- drought ----------
     This week: the U.S. Drought Monitor's class at the point (its WMS GetFeatureInfo) and NOAA CPC's drought outlooks.
     Between years: gridMET Drought (University of Idaho) at the 4 km cell, every 5 days since 1980, read over OPeNDAP as
     the app reads gridMET's weather: SPI and SPEI over several windows, and the Palmer Drought Severity Index. When its
     THREDDS server does not answer (js/wind.js keeps which server answered), the same NetCDF-4 files are read on the
     University's file server by byte ranges (js/h5range.js), only the chunks that hold the cell. The tab says which in a
     few words; docs/METHODS.md §8 has the rest. SPI and SPEI take the U.S. Drought Monitor's classes for them
     (droughtmonitor.unl.edu, Drought Classification); PDSI has none there, so it is shown as values only. */
  const MET = "https://thredds.northwestknowledge.net/thredds/dodsC/agg_met_", MDATA = "https://www.northwestknowledge.net/metdata/data/", DAY1900 = Date.UTC(1900, 0, 1) / 864e5;
  const DRI = [ // dataset, label, variable on THREDDS, USDM classes apply, variable in the file on the file server
    ["spei90d", "SPEI, 90 days", "spei", true, "spei"], ["spei30d", "SPEI, 30 days", "spei", true, "spei"], ["spei180d", "SPEI, 180 days", "spei", true, "spei"], ["spei1y", "SPEI, 1 year", "spei", true, "spei"], ["spei2y", "SPEI, 2 years", "spei", true, "spei"], ["spei5y", "SPEI, 5 years", "spei", true, "spei"],
    ["spi30d", "SPI, 30 days", "spi", true, "spi"], ["spi90d", "SPI, 90 days", "spi", true, "spi"], ["spi180d", "SPI, 180 days", "spi", true, "spi"], ["spi1y", "SPI, 1 year", "spi", true, "spi"], ["spi2y", "SPI, 2 years", "spi", true, "spi"],
    ["pdsi", "Palmer Drought Severity Index", "daily_mean_palmer_drought_severity_index", false, "pdsi"],
  ];
  // the Drought Monitor's classes for SPI and SPEI, and the colours of its maps
  // [class, SPI/SPEI upper bound, name, chart colour, the RGB NDMC's map images draw it in (read back from them)]
  const DCLASS = [["D4", -2.0, "Exceptional drought", "#730000", [115, 0, 0]], ["D3", -1.6, "Extreme drought", "#e60000", [230, 0, 0]], ["D2", -1.3, "Severe drought", "#ffaa00", [255, 170, 0]],
    ["D1", -0.8, "Moderate drought", "#fcd37f", [255, 211, 127]], ["D0", -0.5, "Abnormally dry", "#ffff00", [255, 255, 0]]];
  const dclass = v => (ok(v) ? DCLASS.find(c => v <= c[1] + 1e-9) || null : null);
  /* THREDDS: the cell's values and dates in one OPeNDAP request after the variable's .dds and .das (head, kept an hour
     for each index), which get 3 s to start answering before the file server is read instead. latest: only the last 73
     steps (a year), for This week. */
  const metHead = ds => fresh(`head:${ds}`, 60, () => { const url = `${MET}${ds}_1979_CurrentYear_CONUS.nc`; return Promise.all([WG.util.fetchText(`${url}.dds`, 20000, 3000), WG.util.fetchText(`${url}.das`, 20000, 3000)]); });
  const metThredds = async (ds, v, j, i, latest) => {
    const url = `${MET}${ds}_1979_CurrentYear_CONUS.nc`, [dds, das] = await metHead(ds);
    const N = +((dds.match(/day = (\d+)\]/) || [])[1]);
    if (!(N > 0)) throw new Error(`no time axis in ${ds}`);
    const k0 = das.indexOf(`${v} {`), block = das.slice(k0, das.indexOf("}", k0)), att = (k, d) => { const m = block.match(new RegExp(`${k} (-?[\\d.eE+-]+);`)); return m ? +m[1] : d; };
    const scale = att("scale_factor", 1), add = att("add_offset", 0), fill = att("_FillValue", 32767), a = latest ? Math.max(0, N - 73) : 0, n = N - a;
    const txt = await WG.util.fetchText(`${url}.ascii?day[${a}:1:${N - 1}],${v}[${a}:1:${N - 1}][${j}:1:${j}][${i}:1:${i}]`, 60000);
    const vals = new Array(n).fill(null);
    for (const m of txt.matchAll(/^\[(\d+)\]\[0\], (-?\d+(?:\.\d+)?)/gm)) vals[+m[1]] = +m[2] === fill ? null : +(+m[2] * scale + add).toFixed(2);
    const dayLine = txt.split("\n").filter(l => (l.match(/,/g) || []).length > n / 2 && !/^\[/.test(l)).pop() || "";
    const days = dayLine.split(",").map(x => Math.round(+x) + DAY1900);
    if (days.length !== n) throw new Error(`could not read the dates of ${ds}`);
    return { days, vals, src: "thredds" };
  };
  /* the file server: the same NetCDF-4 file (6 to 7.5 GB) read in place by byte ranges, only the chunks that hold the
     cell, each 311 five-day steps of a 49 × 116 block: about 0.6 MB for SPI and SPEI, 1.9 MB for PDSI. The whole series
     is all of them (11 or 12 since 1980); latest: only the last, and the one before when the last holds no value here yet.
     Values as from THREDDS: raw × scale_factor + add_offset, the fill value missing. The dates are read with the values,
     not after them. The tab's reads go ahead of the wind analysis's on the same server, This week's ahead of the series
     (o.pri), and the files' layout is kept for later visits (o.keep). signal: stops the chunks' download. */
  const metFiles = (ds, v, j, i, latest, signal) => WG.h5range.withFile(`${MDATA}${ds}.nc`, async F => {
    const [day, x] = await Promise.all([F.dataset("day"), F.dataset(v)]), N = x.shape[0], A = x.attrs, T = x.chunk ? x.chunk[0] : N;
    if (x.rank !== 3 || x.shape[1] !== 585 || x.shape[2] !== 1386 || day.shape[0] !== N) throw new Error(`${ds}.nc is not laid out as gridMET's grid`);
    const att = (k, d) => (Number.isFinite(A[k]) ? A[k] : d), scale = att("scale_factor", 1), add = att("add_offset", 0), fill = att("_FillValue", 32767);
    for (let a = latest ? Math.floor((N - 1) / T) * T : 0; ; a = Math.max(0, a - T)) {
      const [raw, d] = await Promise.all([F.read(x, [a, j, i], [N - a, 1, 1]), F.read(day, [a], [N - a])]);
      if (!latest || !a || raw.some(r => r !== fill)) return { days: Array.from(d, t => Math.round(t) + DAY1900), vals: Array.from(raw, r => (r === fill ? null : +(r * scale + add).toFixed(2))), src: "files" };
    }
  }, { pri: latest ? 3 : 2, keep: true, signal });
  /* THREDDS or the file server, as gridMET's weather is read (js/wind.js: the server that answered last is kept in this
     browser, THREDDS is checked in 2.5 s at most, and a read that fails goes to the other at once). While THREDDS is
     being checked the file server is read already: taken if it is in first, stopped if THREDDS answers first.
     A cell's answer is kept in this browser for 6 hours (util.js stash): gridMET Drought adds a step every 5 days, so a
     visit within hours of another at the same cell asks no server at all for it. */
  const CELL_MS = 6 * 36e5;
  const metRead = async (key, latest, onFiles) => {
    const [ds, , v, , fv] = DRI.find(x => x[0] === key), { lat, lon } = WG.state.site;
    const j = Math.round((49.4 - lat) * 24), i = Math.round((lon + 124.7666666333) * 24); // gridMET's 1/24° grid from 49.4 N, 124.767 W
    if (j < 0 || j > 584 || i < 0 || i > 1385) throw new Error("this point is outside gridMET (contiguous US only)");
    const ck = `${MDATA}${ds}.nc?fg-cell=${j},${i}${latest ? ",latest" : ""}`, kept = await WG.util.stashGet(ck, CELL_MS);
    if (kept && Array.isArray(kept.days) && kept.days.length && Array.isArray(kept.vals) && kept.vals.length === kept.days.length) return kept;
    let early = null, took = false;
    if (Wd.gridmetServer() === null) { const stop = new AbortController(); early = { stop, p: metFiles(ds, fv, j, i, latest, stop.signal) }; early.p.catch(() => {}); }
    const read = Wd.gridmetRead(thredds => {
      if (thredds) { if (took) return null; if (early) { early.stop.abort(); early = null; } return metThredds(ds, v, j, i, latest); }
      if (onFiles) onFiles();
      const p = early ? early.p : metFiles(ds, fv, j, i, latest);
      early = null;
      return p;
    });
    // a file read done before THREDDS's check has answered is taken at once: THREDDS cannot be the faster then
    const r = await (early ? Promise.race([read, early.p.then(x => { took = true; return x; }, () => new Promise(() => {}))]) : read);
    WG.util.stashPut(ck, r);
    return r;
  };
  const metSeries = (key, onFiles) => once(`dri:${key}`, () => metRead(key, false, onFiles));
  /* This week needs only the latest values, read on their own so that a row does not wait for a whole series: from the
     file server their chunk is the series' last, fetched once for both (js/h5range.js) */
  const metLatest = key => once(`driL:${key}`, () => metRead(key, true));
  /* The Drought Monitor's class at a point (-1 none, 0 to 4 D0 to D4) on this week's map, or on the map of week d (its
     date, a Tuesday): MapServer's GetFeatureInfo on a box of ±0.0001°, 3 × 3 pixels of about 7 m. A wider box lets the
     query's tolerance reach the class next door, and the worse of the two was then taken (±0.01° did so in about one
     week in ten at Austin). */
  const usdmInfo = (map, layer, lat, lon) => `${USDM(map)}&SERVICE=WMS&VERSION=1.3.0&REQUEST=GetFeatureInfo&LAYERS=${layer}&QUERY_LAYERS=${layer}&STYLES=&CRS=EPSG:4326&BBOX=${(lat - 1e-4).toFixed(6)},${(lon - 1e-4).toFixed(6)},${(lat + 1e-4).toFixed(6)},${(lon + 1e-4).toFixed(6)}&WIDTH=3&HEIGHT=3&I=1&J=1&FEATURE_COUNT=10&INFO_FORMAT=text/plain`;
  async function usdmAt(lat, lon, d) {
    const w = d === undefined || d === null ? null : ymdStr(d);
    const t = await WG.util.fetchText(w ? usdmInfo(`usdm_${w}_wms`, `usdm${w}`, lat, lon) : usdmInfo("usdm_current_wms", "usdm_current", lat, lon), 20000);
    if (!t.startsWith("GetFeatureInfo results")) throw new Error(`no Drought Monitor map for ${w ? Wd.isoDay(d) : "this week"}`);
    const dm = [...t.matchAll(/DM = '(\d)'/g)].map(m => +m[1]);
    return dm.length ? Math.max(...dm) : -1;
  }
  /* this week at the location, once a location, on the map of the week usdmDate names: the class and the date it is shown
     with are then of one map, even when a new map comes out while the page is open (the current map when that date
     cannot be read) */
  const usdmHere = (lat, lon) => once("usdmAt", () => usdmDate().then(d => usdmAt(lat, lon, d), () => usdmAt(lat, lon)));
  /* The Drought Monitor at the point, week by week, from 4 January 2000, a map every Tuesday. It needs no gridMET server,
     so the tab keeps a drought record when the University of Idaho's servers are down. The weeks come from Esri's Living
     Atlas copy of the weekly maps (US_Drought_Intensity_v1, layer 2: each week's classes as polygons), asked at the
     point: one answer gives up to 260 weeks, those with a class there, so a week left out has none (about 0.5 s for a
     year, 10 s since 2000). Weeks after the Living Atlas's last (it may follow NDMC's map by a day), or all of them when
     it does not answer, are asked of NDMC's own map of each week (usdm_YYYYMMDD) as This week asks the current one, four
     at a time, about half a second each. Both are asked at the point itself, as This week is. A past week's map does
     not change, so the weeks read are kept in this browser for the location (rounded to 0.0001°, about 10 m, so a week
     kept differs from the point's own only within metres of a class's edge; the last 60 locations) and a later visit
     reads only the weeks it lacks. fg.usdm2: the weeks kept under fg.usdm: were read with the wider box, so they are
     dropped and read again. When NDMC does not answer, the weeks run to the Living Atlas's last. */
  const USDM_DAY0 = Date.UTC(2000, 0, 4) / 864e5;
  const USDM_SPANS = [[2, "the last 2 years"], [5, "the last 5 years"], [10, "the last 10 years"], [0, "since 2000 (about 1,400 weeks)"]];
  let usdmSpan = 2, usdmVer = 0;
  const usdmKey = (lat, lon) => `fg.usdm2:${lat.toFixed(4)},${lon.toFixed(4)}`;
  // one character a week from 4 January 2000: "n" no drought class, "0" to "4" D0 to D4, "?" not read
  function usdmKept(key) { try { return localStorage.getItem(key) || ""; } catch (e) { return ""; } }
  function usdmKeep(key, s) {
    // merged with what is kept, so an older read finishing late never undoes a newer one's weeks
    const old = usdmKept(key), m = s.split("").map((c, k) => (c === "?" && old[k] && old[k] !== "?" ? old[k] : c)).join("") + old.slice(s.length);
    try {
      const was = localStorage.getItem("fg.usdm.keys");
      if (was) { JSON.parse(was).forEach(k => localStorage.removeItem(k)); localStorage.removeItem("fg.usdm.keys"); }
      const all = JSON.parse(localStorage.getItem("fg.usdm2.keys") || "[]").filter(k => k !== key).concat(key);
      while (all.length > 60) localStorage.removeItem(all.shift());
      localStorage.setItem(key, m);
      localStorage.setItem("fg.usdm2.keys", JSON.stringify(all));
    } catch (e) { /* storage full or off: the weeks are read again next visit */ }
  }
  const usdmWeekAt = (d, lat, lon) => usdmAt(lat, lon, d).then(v => (v < 0 ? "n" : String(v)));
  const LA = "https://services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/rest/services/US_Drought_Intensity_v1/FeatureServer/2/query";
  const LA_CREDIT = "Esri Living Atlas, U.S. Drought Intensity (US_Drought_Intensity_v1), a copy of the weekly maps";
  // the Living Atlas's last week (a day number), once a visit; a failed read is asked again next time
  let laLast = null;
  const laLastWeek = () => (laLast = laLast || WG.util.fetchJSON(`${LA}?${new URLSearchParams({ where: "1=1", outStatistics: JSON.stringify([{ statisticType: "max", onStatisticField: "ddate", outStatisticFieldName: "last" }]), f: "json" })}`, {}, 20000).then(j => {
    const v = j && j.features && j.features[0] && j.features[0].attributes && j.features[0].attributes.last;
    if (!Number.isFinite(v)) throw new Error((j && j.error && j.error.message) || "the Living Atlas gave no last week");
    return Math.round(v / 864e5);
  }).catch(e => { laLast = null; throw e; }));
  // this week's map (a day number): NDMC's, or the Living Atlas's last week when NDMC does not answer
  const usdmLast = () => usdmDate().catch(e => laLastWeek().catch(() => { throw e; }));
  /* weeks ka to kb (counted from 4 January 2000) at the point from the Living Atlas: "n" or "0" to "4" each. page(k, out)
     as each page comes, k the last week it reached: the weeks before k are then whole in out, so they can be kept when a
     later page fails. The pages are in order of date and then of the service's own number, an order that does not
     change between pages, so a week's two classes on a line are never one asked twice and the other lost. */
  async function laWeeks(lat, lon, ka, kb, alive, page) {
    const iso = k => Wd.isoDay(USDM_DAY0 + k * 7), out = new Array(kb - ka + 1).fill("n");
    for (let off = 0; ;) {
      if (!alive()) throw new Error("stopped");
      const q = new URLSearchParams({ where: `ddate >= DATE '${iso(ka)}' AND ddate <= DATE '${iso(kb)}'`, geometry: `${lon},${lat}`, geometryType: "esriGeometryPoint", inSR: "4326", spatialRel: "esriSpatialRelIntersects",
        outFields: "dm,ddate", returnGeometry: "false", orderByFields: "ddate,OBJECTID", resultOffset: String(off), resultRecordCount: "260", maxRecordCountFactor: "5", f: "json" });
      const j = await WG.util.fetchJSON(`${LA}?${q}`, {}, 30000), f = j && j.features;
      if (!Array.isArray(f)) throw new Error((j && j.error && j.error.message) || "the Living Atlas gave no weeks");
      // a point on the line between two classes lies in both: the worse is taken, as NDMC's own query does
      f.forEach(x => { const a = x.attributes || {}, k = Math.round((a.ddate / 864e5 - USDM_DAY0) / 7) - ka, v = a.dm; if (k >= 0 && k < out.length && v >= 0 && v <= 4 && (out[k] === "n" || v > +out[k])) out[k] = String(v); });
      off += f.length;
      if (f.length && page) page(Math.round((f[f.length - 1].attributes.ddate / 864e5 - USDM_DAY0) / 7), out);
      // the next page while the service says there is more (a page holds 52 to 260, as the service allows)
      if (!f.length || !(j.exceededTransferLimit || f.length >= 260)) break;
    }
    return out;
  }
  /* the weeks whose maps hold days d0 to d1 (a map, dated a Tuesday, holds that day to the next Monday), within 4 January
     2000 to this week's map: { days (each map's date), dm (-1 none, 0 to 4 D0 to D4, null not read), missing, src (of
     "kept", "la", "ndmc") }. tick(done, total) as they come; once alive() is false no more weeks are asked. */
  async function usdmRange(lat, lon, d0, d1, alive = () => true, tick = () => {}) {
    const last = await usdmLast(), kLast = Math.round((last - USDM_DAY0) / 7), key = usdmKey(lat, lon);
    const k0 = Math.max(0, Math.floor((d0 - USDM_DAY0) / 7)), k1 = Math.min(kLast, Math.floor((d1 - USDM_DAY0) / 7));
    if (k1 < k0) return { days: [], dm: [], missing: 0, src: [] };
    const s = usdmKept(key).padEnd(kLast + 1, "?").split(""), src = new Set();
    let need = [];
    for (let k = k0; k <= k1; k++) if (!/[n0-4]/.test(s[k])) need.push(k);
    if (need.length < k1 - k0 + 1) src.add("kept");
    const total = need.length;
    tick(0, total);
    if (need.length) {
      try {
        const lk = Math.min(need[need.length - 1], Math.round((await laLastWeek() - USDM_DAY0) / 7));
        // the weeks lacking, in runs; runs less than a year apart are asked together, as a page holds up to 5 years
        const runs = [];
        need.filter(k => k <= lk).forEach(k => { const r = runs[runs.length - 1]; if (r && k - r[1] <= 52) r[1] = k; else runs.push([k, k]); });
        for (const [a, b] of runs) {
          const got = await laWeeks(lat, lon, a, b, alive, (kk, out) => {
            for (let k = a; k < kk; k++) s[k] = out[k - a];
            if (kk > a) src.add("la");
            tick(need.filter(k => k <= kk).length, total);
          });
          got.forEach((c, i) => { s[a + i] = c; });
          src.add("la");
          usdmKeep(key, s.join(""));
          tick(need.filter(k => k <= b).length, total);
        }
      } catch (e) { if (alive()) console.warn(`Drought Monitor: the Living Atlas did not answer (${e.message || e}); reading NDMC's weekly maps instead`); }
      // after the catch, so the weeks the Living Atlas gave before it failed (earlier runs, earlier pages) are not asked again
      need = need.filter(k => !/[n0-4]/.test(s[k]));
    }
    let done = total - need.length, since = 0;
    await WG.util.pool(need, 4, async k => {
      if (!alive()) return;
      const d = USDM_DAY0 + k * 7;
      try { s[k] = await usdmWeekAt(d, lat, lon); } catch (e) { try { s[k] = await usdmWeekAt(d, lat, lon); } catch (e2) { s[k] = "?"; } }
      if (s[k] !== "?") src.add("ndmc");
      done++;
      if (++since >= 26) { since = 0; usdmKeep(key, s.join("")); } // kept as it goes, so a visit cut short is not read again
      tick(done, total);
    });
    usdmKeep(key, s.join(""));
    const part = s.slice(k0, k1 + 1);
    return { days: part.map((c, i) => USDM_DAY0 + (k0 + i) * 7), dm: part.map(c => (c === "n" ? -1 : /[0-4]/.test(c) ? +c : null)), missing: part.filter(c => !/[n0-4]/.test(c)).length, src: [...src] };
  }
  // the weeks from the span's start (years; 0 = since 2000) to this week's map
  const usdmWeeks = async (lat, lon, span, alive, tick) => { const last = await usdmLast(); return usdmRange(lat, lon, span ? last - span * 364 : USDM_DAY0, last, alive, tick); };
  // where the weeks came from, for a credit line
  const usdmSrc = src => (src.includes("la") && src.includes("ndmc") ? `read from the ${LA_CREDIT}, and the weeks it lacks from NDMC's own weekly maps` : src.includes("la") ? `read from the ${LA_CREDIT}` : src.includes("ndmc") ? "read from NDMC's own weekly maps" : `read from the ${LA_CREDIT}, or from NDMC's own weekly maps`)
    + (src.includes("kept") ? " (the weeks read before at this point come from this browser)" : "");
  // the weeks as a table: each map's date and the last day it holds, and its class at the point (blank: not read)
  function usdmTable(days, dm) {
    return { header: ["Week (map date, Tuesday)", "Valid to (Monday)", "Class code (-1 none, 0-4 D0-D4)", "Class", "Class name", "In drought (D1-D4)"],
      rows: days.map((d, i) => {
        const v = dm[i], c = v === null || v === undefined || v < 0 ? null : DCLASS.find(x => x[0] === `D${v}`);
        return v === null || v === undefined ? [Wd.isoDay(d), Wd.isoDay(d + 6), "", "", "not read", ""] : [Wd.isoDay(d), Wd.isoDay(d + 6), v, c ? c[0] : "none", c ? c[2] : "No drought class", v >= 1 ? "yes" : "no"];
      }) };
  }
  // a week's map (d its date, a Tuesday) as a PNG of the box [west, south, east, north], width × height pixels in EPSG:4326
  const usdmMapUrl = (d, b, width, height) => { const w = ymdStr(d); return `${USDM(`usdm_${w}_wms`)}&SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=usdm${w}&STYLES=&CRS=EPSG:4326&BBOX=${b[1]},${b[0]},${b[3]},${b[2]}&WIDTH=${width}&HEIGHT=${height}&FORMAT=image/png&TRANSPARENT=true`; };
  const droughtOutlook = (lat, lon) => Promise.all([1, 4].map(l => outlook("cpc_drought_outlk", l, lat, lon).catch(() => undefined)));
  let driKey = "spei90d", driYears = null, driFrom = null, driTo = null, driVer = 0;
  // Between years, while waiting (the file server sends some 7 MB for a series, 20 MB for PDSI's)
  const yearsWait = () => wait(`gridMET's drought index since 1980${Wd.gridmetServer() === "files" ? `, about ${driKey === "pdsi" ? "20" : "7"} MB from its file server` : ""}`);
  // the server a part was read from, in a few words
  const viaText = srcs => (srcs.has("files") && srcs.has("thredds") ? "via THREDDS and its file server" : srcs.has("files") ? "via its file server" : "via THREDDS");

  /* the tab in two parts, each drawn as its sources answer: this week (the Drought Monitor, the latest indices one by
     one, CPC's outlooks) and between years (the chosen index's whole series, from and to the chosen years) */
  RENDER.drought = async (el, live) => {
    const { lat, lon } = WG.state.site;
    el.innerHTML = `<div class="card"><div class="card-h"><h3>This week</h3><span class="tag" id="drDate"></span></div>
        <div class="usdm-now" id="drNow"><span class="skeleton" style="width:50%"></span></div>
        <div class="wx-kv" style="margin-top:10px" id="drLatest">${["spi30d", "spei90d", "spei1y", "pdsi"].map(k => `<div id="drL_${k}"><span>${esc(DRI.find(x => x[0] === k)[1])}</span><b>…</b><span></span></div>`).join("")}</div>
        <div class="wx-kv" style="margin-top:8px" id="drOutl"><div><span>Drought outlook, this month</span><b style="font-size:14px">…</b></div><div><span>Drought outlook, this season</span><b style="font-size:14px">…</b></div></div>
        <p class="fine">Indices below 0 are drier than usual for the time of year. Sources: U.S. Drought Monitor; gridMET Drought (University of Idaho, 4 km)<span id="drLSrc"></span>; NOAA CPC outlooks. ${esc(USDM_CREDIT)}</p></div>
      <div id="drUsdm"></div>
      <div id="drYears">${yearsWait()}</div>`;
    const at = id => (live() ? el.querySelector(`#${id}`) : null);
    // each row and part drawn as its own answer comes; This week's values asked first (js/h5range.js also puts them first)
    const latest = ["spi30d", "spei90d", "spei1y", "pdsi"].map(k => [k, metLatest(k)]);
    const series = metSeries(driKey, () => { const x = at("drYears"); if (x && x.querySelector(".skeleton")) x.innerHTML = yearsWait(); });
    const srcs = new Set(), srcNote = () => { const x = at("drLSrc"); if (x) x.textContent = `, ${viaText(srcs)}`; };
    const latestRow = ([k, v, d]) => { const c = DRI.find(x => x[0] === k), cl = c[3] ? dclass(v) : null; return `<span>${esc(c[1])}</span><b>${ok(v) ? fmt(v, 2) : "—"}</b><span>${cl ? `${cl[0]} ${cl[2].toLowerCase()}` : c[3] && ok(v) ? "no drought class" : ""}${d ? ` · ${Wd.dayLabel(d)}` : ""}</span>`; };
    const outl = a => (a === undefined ? "could not be read" : !a ? "none issued here" : `${String(a.outlook || "—").replace(/_/g, " ")}${a.target ? ` (${a.target})` : ""}`); // CPC writes No_Drought
    const jobs = [
      usdmDate().then(d => { const x = at("drDate"); if (x) x.textContent = `Drought Monitor of ${Wd.dayLabel(d)}`; }).catch(() => {}),
      usdmHere(lat, lon).then(dm => { const x = at("drNow"), c = dm < 0 ? null : DCLASS.find(c => c[0] === `D${dm}`); if (x) x.innerHTML = c ? `<i style="background:${c[3]}"></i><b>${c[0]} · ${esc(c[2])}</b>` : `<i style="background:#fff"></i><b>No drought class: normal or wet</b>`; },
        () => { const x = at("drNow"); if (x) x.innerHTML = "<span>The Drought Monitor could not be read.</span>"; }),
      droughtOutlook(lat, lon).then(([om, os]) => { const x = at("drOutl"); if (x) x.innerHTML = `<div><span>Drought outlook, this month</span><b style="font-size:14px">${esc(outl(om))}</b></div><div><span>Drought outlook, this season</span><b style="font-size:14px">${esc(outl(os))}</b></div>`; }),
      ...latest.map(([k, p]) => p.then(x => { let n = x.vals.length - 1; while (n > 0 && !ok(x.vals[n])) n--; srcs.add(x.src); srcNote(); return [k, x.vals[n], x.days[n]]; }).catch(() => [k, null, null])
        .then(r => { const x = at(`drL_${k}`); if (x) x.innerHTML = latestRow(r); })),
      series.then(S => { if (live()) drawYears(S); }, e => { const x = at("drYears"); if (x) x.innerHTML = failed("gridMET's drought index", e); }),
      usdmHistory(),
    ];

    /* the Drought Monitor here, week by week: a record of its own, drawn whatever gridMET's servers do; a new span stops
       the older read and starts again, the weeks already read coming from the browser */
    async function usdmHistory() {
      const my = ++usdmVer, alive = () => live() && my === usdmVer;
      const sel = `<div class="form-grid"><label>Weeks<select id="wxUsdmSpan">${USDM_SPANS.map(([y, n]) => `<option value="${y}" ${y === usdmSpan ? "selected" : ""}>${esc(n)}</option>`).join("")}</select></label></div>`;
      const top = note => `<div class="card"><div class="card-h"><h3>Drought Monitor here, week by week</h3></div>${sel}<p class="fine" id="drUsdmNote">${note}</p></div>`;
      const wire = () => { const x = $("#wxUsdmSpan"); if (x) x.onchange = e => { usdmSpan = +e.target.value; usdmHistory(); }; };
      let box = at("drUsdm");
      if (!box) return;
      box.innerHTML = top(`<span class="skeleton" style="width:40%"></span>`);
      wire();
      let R;
      try {
        R = await usdmWeeks(lat, lon, usdmSpan, alive, (n, t) => { const x = alive() && at("drUsdmNote"); if (x) x.textContent = t ? `Reading the Drought Monitor at this point: ${n} of ${t} weeks (those read before come from this browser)…` : "From this browser…"; });
      } catch (e) { if (alive() && (box = at("drUsdm"))) { box.innerHTML = top(esc(`The Drought Monitor could not be read: ${e.message || e}.`) + ` <button type="button" class="link wx-retry" data-wx-retry>Reload</button>`); wire(); } return; }
      if (!alive() || !(box = at("drUsdm"))) return;
      const { days, dm } = R, n = dm.filter(v => v !== null).length, dry = dm.filter(v => v !== null && v >= 1).length, d0 = dm.filter(v => v === 0).length;
      const cls = v => DCLASS.find(c => c[0] === `D${v}`), col = v => (v === null || v < 0 ? "rgba(0,0,0,0)" : cls(v)[3]);
      const yrs = [...new Set(days.map(d => ymd(d)[0]))], short = days.length <= 160;
      const sub = `${siteLine()} · U.S. Drought Monitor`;
      box.innerHTML = top(`${dry} of ${n} weeks in drought (D1 to D4) and ${d0} abnormally dry (D0), ${Wd.dayLabel(days[0])} to ${Wd.dayLabel(days[days.length - 1])}.${R.missing ? ` ${R.missing} week${R.missing > 1 ? "s" : ""} did not answer; pick the location again to read ${R.missing > 1 ? "them" : "it"}.` : ""}`)
        + card("wxUsdmHist", "Drought Monitor class, week by week", 200, { file: "drought_monitor_weekly", x: "Week", sub, table: () => usdmTable(days, dm), foot: `${DCLASS.slice().reverse().map(c => `<span style="display:inline-block;width:10px;height:10px;background:${c[3]};border:1px solid #0002;margin-right:3px"></span>${c[0]}`).join(" &nbsp; ")} &nbsp; No bar: no drought class. The class of each week's map at this point (its record starts in January 2000), ${esc(usdmSrc(R.src))}. Click a week to see its map. ${esc(USDM_CREDIT)}` })
        + card("wxUsdmShare", "Share of each year in each class", 200, { file: "drought_monitor_by_year", x: "Year", sub, foot: `Weeks in D0 to D4 as a share of the weeks read in each year${yrs.length > 1 && days.length < 52 * yrs.length ? "; the first and last years may be partial" : ""}.` });
      wire();
      Ch.draw("wxUsdmHist", () => ({ type: "bar", data: { labels: days.map(d => Wd.isoDay(d)), datasets: [{ label: "Drought Monitor class", data: dm.map(v => (v === null || v < 0 ? null : v + 1)), backgroundColor: dm.map(col), barPercentage: 1, categoryPercentage: 1 }] },
        options: { maintainAspectRatio: false, animation: false, onClick: (e, els) => { if (els && els.length) TM.showWeek(days[els[0].index]); },
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => { const v = dm[c.dataIndex]; return v === null ? "not read" : v < 0 ? "No drought class" : `D${v} ${cls(v)[2]}`; } } } },
          scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: false, callback: (v, k) => { const [y, m, d] = ymd(days[k]); return d > 7 ? "" : m === 0 ? y : short && m % 3 === 0 ? MONTHS[m] : ""; } } },
            y: { min: 0, max: 5, ticks: { stepSize: 1, callback: v => (v ? `D${v - 1}` : "") } } } } }));
      Ch.draw("wxUsdmShare", () => ({ type: "bar", data: { labels: yrs, datasets: DCLASS.slice().reverse().map(c => ({ label: `${c[0]} ${c[2].toLowerCase()}`, data: yrs.map(y => { const a = dm.filter((v, k) => v !== null && ymd(days[k])[0] === y); return a.length ? +((100 * a.filter(v => `D${v}` === c[0]).length) / a.length).toFixed(1) : null; }), backgroundColor: c[3], stack: "s" })) },
        options: { maintainAspectRatio: false, animation: false, interaction: { mode: "index", intersect: false }, plugins: { legend: { position: "bottom" } }, scales: { x: { stacked: true, grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 10 } }, y: { stacked: true, beginAtZero: true, max: 100, title: { display: true, text: "% of the weeks" } } } } }));
    }

    function drawYears(S) {
      const [, label, , classed] = DRI.find(x => x[0] === driKey), all = S;
      const yrs = [...new Set(all.days.map(d => ymd(d)[0]))], y1 = yrs[yrs.length - 1];
      if (driFrom === null || !yrs.includes(driFrom)) driFrom = yrs[0];
      if (driTo === null || !yrs.includes(driTo) || driTo < driFrom) driTo = y1;
      // the chosen years only: the history, the year lines to choose from, and each year's share
      const keep = all.days.map((d, k) => k).filter(k => { const y = ymd(all.days[k])[0]; return y >= driFrom && y <= driTo; });
      const days = keep.map(k => all.days[k]), vals = keep.map(k => all.vals[k]), years = yrs.filter(y => y >= driFrom && y <= driTo);
      const byYear = new Map(yrs.map(y => [y, []]));
      all.days.forEach((d, k) => { if (ok(all.vals[k])) byYear.get(ymd(d)[0]).push(all.vals[k]); });
      const full = years.filter(y => byYear.get(y).length >= 70), meanOf = y => mean(byYear.get(y)), fullAll = yrs.filter(y => byYear.get(y).length >= 70);
      const driest = fullAll.slice().sort((a, b) => meanOf(a) - meanOf(b))[0], wettest = fullAll.slice().sort((a, b) => meanOf(b) - meanOf(a))[0];
      if (!driYears || !driYears.every(y => yrs.includes(y))) driYears = [...new Set([y1, y1 - 1, driest].filter(y => yrs.includes(y)))];
      const colorOf = v => (!ok(v) ? "rgba(0,0,0,0)" : classed ? (dclass(v) ? dclass(v)[3] : v >= 0 ? "#7fb0d6" : "#d8d6cc") : v < 0 ? C.orange : "#7fb0d6");
      // a click on a date shows the Drought Monitor's map of that week (its record starts in 2000)
      const toMap = (e, els) => { if (els && els.length) { const d = days[els[0].index]; if (d >= Wd.epochDay(2000, 0, 4)) TM.showWeek(d); else WG.util.toast("The Drought Monitor's maps start in January 2000."); } };
      const history = () => ({ type: "bar", data: { labels: days.map(d => Wd.isoDay(d)), datasets: [{ label, data: vals, backgroundColor: vals.map(colorOf), barPercentage: 1, categoryPercentage: 1 }] },
        options: { maintainAspectRatio: false, animation: false, onClick: toMap, plugins: { legend: { display: false }, tooltip: { callbacks: { afterLabel: c => { const cl = classed ? dclass(c.parsed.y) : null; return cl ? `${cl[0]} ${cl[2]}` : ""; } } } },
          scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 18, maxTicksLimit: 10, callback: (v, k) => days[k] && ymd(days[k])[1] === 0 && ymd(days[k])[2] <= 5 ? ymd(days[k])[0] : "" } }, y: axis(label) } } });
      const doyLabels = Array.from({ length: 73 }, (_, k) => { const d = Date.UTC(2001, 0, 1) / 864e5 + k * 5; return `${ymd(d)[2]} ${MONTHS[ymd(d)[1]]}`; });
      const slotOf = new Map(driYears.map((y, k) => [y, k]));
      const yearLine = y => { const pts = new Array(73).fill(null); all.days.forEach((d, i) => { if (ymd(d)[0] === y && ok(all.vals[i])) { const doy = d - Date.UTC(y, 0, 1) / 864e5; pts[Math.min(72, Math.floor(doy / 5))] = all.vals[i]; } });
        const c = YEAR_COLORS[slotOf.get(y) % YEAR_COLORS.length];
        return { label: `${y}${y === driest ? " (driest year)" : y === wettest ? " (wettest year)" : ""}`, data: pts, borderColor: c, backgroundColor: c, pointRadius: 0, borderWidth: y === y1 ? 2.5 : 1.75, spanGaps: true }; };
      const onYear = (e, els) => { if (els && els.length) { const y = driYears[els[0].datasetIndex], d = Wd.epochDay(y, 0, 1) + els[0].index * 5; if (d >= Wd.epochDay(2000, 0, 4)) TM.showWeek(d); } };
      const compare = () => ({ type: "line", data: { labels: doyLabels, datasets: driYears.map(yearLine) },
        options: { maintainAspectRatio: false, animation: false, onClick: onYear, interaction: { mode: "nearest", intersect: false }, plugins: { legend: { position: "bottom" } }, scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 18, maxTicksLimit: 12 } }, y: axis(label) } } });
      const share = () => classed ? { type: "bar", data: { labels: full, datasets: DCLASS.slice().reverse().filter(c => c[0] !== "D0").map(c => ({ label: `${c[0]} ${c[2].toLowerCase()}`, data: full.map(y => { const a = byYear.get(y); return +((100 * a.filter(v => dclass(v) && dclass(v)[0] === c[0]).length) / a.length).toFixed(1); }), backgroundColor: c[3], stack: "s" })) },
        options: { maintainAspectRatio: false, animation: false, interaction: { mode: "index", intersect: false }, plugins: { legend: { position: "bottom" } }, scales: { x: { stacked: true, grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 10 } }, y: { stacked: true, beginAtZero: true, max: 100, title: { display: true, text: "% of the year" } } } } }
        : { type: "bar", data: { labels: full, datasets: [{ label: `Mean ${label}`, data: full.map(y => +meanOf(y).toFixed(2)), backgroundColor: full.map(y => (meanOf(y) < 0 ? C.orange : "#7fb0d6")) }] },
          options: { maintainAspectRatio: false, animation: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 10 } }, y: axis(`mean ${label}`) } } };
      const sub = `${siteLine()} · gridMET Drought`, yOpt = sel => yrs.slice().reverse().map(y => `<option ${y === sel ? "selected" : ""}>${y}</option>`).join("");
      const box = at("drYears");
      if (!box) return;
      box.innerHTML = `<div class="card"><div class="card-h"><h3>Between years</h3></div>
          <div class="form-grid"><label>Index<select id="wxDri">${DRI.map(([k, n]) => `<option value="${k}" ${k === driKey ? "selected" : ""}>${esc(n)}</option>`).join("")}</select></label>
            <label>From<select id="wxDriFrom">${yOpt(driFrom)}</select></label><label>To<select id="wxDriTo">${yOpt(driTo)}</select></label>
            <label>Add a year<select id="wxDriYear" ${driYears.length >= YEAR_COLORS.length ? "disabled" : ""}><option value="">Choose…</option>${yrs.slice().reverse().filter(y => !driYears.includes(y)).map(y => `<option>${y}</option>`).join("")}</select></label></div>
          <div class="chips">${driYears.map((y, k) => `<span class="chip"><i class="yr-sw" style="background:${YEAR_COLORS[k % YEAR_COLORS.length]}"></i>${y}${byYear.get(y).length ? ` · mean ${fmt(meanOf(y), 2)}` : ""} <button class="link" data-dri-drop="${y}" title="Take ${y} off the chart" aria-label="Take ${y} off the chart">✕</button></span>`).join("")}</div></div>
        ${card("wxDriHist", `${label}, ${driFrom}–${driTo}`, 220, { file: `drought_${driKey}_history`, x: "Date", sub, foot: (classed ? DCLASS.slice().reverse().map(c => `<span style="display:inline-block;width:10px;height:10px;background:${c[3]};border:1px solid #0002;margin-right:3px"></span>${c[0]} ≤ ${c[1]}`).join(" &nbsp; ") + " &nbsp; Blue: wetter than usual." : "PDSI below 0 is drier than usual (orange), above 0 wetter (blue); the Drought Monitor's classification gives no PDSI ranges, so none are drawn.") + " Click a date to see that week's Drought Monitor map (2000 on)." })}
        ${card("wxDriYears", `${label}, year against year`, 230, { file: `drought_${driKey}_years`, x: "Day of the year", sub, foot: "Click a line to see that week's Drought Monitor map (2000 on)." })}
        ${card("wxDriShare", classed ? `Share of each year in drought (${label})` : `Mean ${label} by year`, 220, { file: `drought_${driKey}_by_year`, x: "Year", sub, foot: classed ? `Each 5-day value in D1 to D4 by the Drought Monitor's SPI and SPEI ranges, as a share of the year; years with 70 or more values${full.length ? ` (${full[0]}–${full[full.length - 1]})` : ""}.` : "" })}
        <p class="fine">Source: gridMET Drought (University of Idaho; Abatzoglou 2013, doi:10.1002/joc.3413), 4 km, every 5 days since 1980, ${viaText(new Set([all.src]))}; the latest values are provisional. SPI: Standardized Precipitation Index; SPEI: Standardized Precipitation-Evapotranspiration Index, over the window named. Classes: U.S. Drought Monitor (droughtmonitor.unl.edu).</p>`;
      Ch.draw("wxDriHist", history);
      Ch.draw("wxDriYears", compare);
      Ch.draw("wxDriShare", share);
      const redo = () => { driVer++; el.dataset.key = ""; show("drought", el); };
      $("#wxDri").onchange = e => { driKey = e.target.value; redo(); };
      $("#wxDriFrom").onchange = e => { driFrom = +e.target.value; if (driTo < driFrom) driTo = driFrom; drawYears(all); };
      $("#wxDriTo").onchange = e => { driTo = +e.target.value; if (driFrom > driTo) driFrom = driTo; drawYears(all); };
      $("#wxDriYear").onchange = e => { if (e.target.value) { driYears.push(+e.target.value); drawYears(all); } };
      box.querySelectorAll("[data-dri-drop]").forEach(b => { b.onclick = () => { driYears = driYears.filter(y => y !== +b.dataset.driDrop); drawYears(all); }; });
    }
    await Promise.allSettled(jobs);
  };

  async function show(tab, el) {
    const tok = WG.state.token, key = `${tok}|${UN.query()}|${tab === "drought" ? driVer : ""}`;
    if (el.dataset.key === key) { setTimeout(() => WG.charts.resizeAll(), 0); return; } // drawn for this location, units and period
    el.dataset.key = key;
    try { await RENDER[tab](el, () => tok === WG.state.token && el.dataset.key === key); }
    catch (e) { console.warn(tab, e); if (tok === WG.state.token && el.dataset.key === key) el.innerHTML = failed(`the ${tab} data`, e); }
  }

  return { THEMES, layers, legend, fresh, timeLabel, show, RENDER, card, once, siteLine, wait, failed, ok, usdmDate, usdmLast, usdmAt, usdmHere, usdmRange, usdmTable, usdmSrc, usdmMapUrl, DCLASS, USDM_CREDIT, USDM_DAY0, LA_CREDIT };
})();
