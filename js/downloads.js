/* Downloads and settings sheets: the units table, figure downloads (size, DPI, format), CSV tables, and the
   data sheet for a location (series and model-ready soil and weather files, built in WG.models). */
WG.downloads = (function () {
  const { $, $$, esc, fmt, toast, MONTHS, COMPASS } = WG.util;
  const UN = WG.units, X = WG.export, Ch = WG.charts;
  const state = WG.state;

  /* ---------- sheets ---------- */
  const SHEETS = ["unitsSheet", "figSheet", "gridSheet"];
  let backTo = null; // the sheet a figure was opened from, shown again when the figure sheet closes
  function open(id) {
    SHEETS.forEach(s => { $("#" + s).hidden = s !== id; });
    $("#sheetBackdrop").hidden = false;
    const first = $(`#${id} select, #${id} input, #${id} button`);
    if (first) first.focus({ preventScroll: true });
  }
  function close() {
    if (SHEETS.every(s => $("#" + s).hidden)) return false;
    if (backTo && !$("#figSheet").hidden) { const b = backTo; backTo = null; open(b); return true; }
    backTo = null;
    SHEETS.forEach(s => { $("#" + s).hidden = true; });
    $("#sheetBackdrop").hidden = true;
    return true;
  }
  $$("[data-close]").forEach(b => b.addEventListener("click", close));
  $("#sheetBackdrop").addEventListener("click", close);
  document.addEventListener("keydown", e => { if (e.key === "Escape") close(); });

  /* ---------- units table ---------- */
  function renderUnits() {
    $("#unitPresets").innerHTML = Object.entries(UN.PRESETS).map(([k, label]) =>
      `<button data-preset="${k}" class="${UN.preset === k ? "on" : ""}">${esc(label)}</button>`).join("")
      + (UN.preset === "custom" ? `<button class="on" disabled>Custom</button>` : "");
    const ex = { wind: 8, precip: 25.4, temp: 20, elev: 1000, depth: 30, waterDepth: 100, awc: 0.15, ksat: 10, area: 10000, distance: 100,
      length: 1, shortLength: 10, soilLoss: 10, massArea: 1000, massAreaHeavy: 2, seedDensity: 10, solar: 20 };
    $("#unitsTable").innerHTML = `<thead><tr><th class="l">Quantity</th><th class="l">Used for</th><th>Unit</th><th class="l">Example</th></tr></thead><tbody>`
      + Object.entries(UN.Q).map(([k, q]) => {
        const opts = Object.keys(q.units).map(u => `<option value="${esc(u)}" ${UN.get(k) === u ? "selected" : ""}>${esc(u)}</option>`).join("");
        const base = `${fmt(ex[k], UN.baseD(k))} ${q.base}`;
        const shown = UN.get(k) === q.base ? "" : ` = ${UN.fmt(k, ex[k])}`;
        return `<tr><td class="l"><b>${esc(q.label)}</b></td><td class="l">${esc(q.use)}</td><td><select data-q="${k}" aria-label="${esc(q.label)} unit">${opts}</select></td><td class="l">${esc(base + shown)}</td></tr>`;
      }).join("") + "</tbody>";
  }
  $("#unitPresets").addEventListener("click", e => { const b = e.target.closest("[data-preset]"); if (b) UN.usePreset(b.dataset.preset); });
  $("#unitsTable").addEventListener("change", e => { const s = e.target.closest("[data-q]"); if (s) UN.set(s.dataset.q, s.value); });
  $("#unitsBtn").addEventListener("click", () => { renderUnits(); open("unitsSheet"); });
  UN.on(() => { if (!$("#unitsSheet").hidden) renderUnits(); });

  /* ---------- figures ---------- */
  const FIG = {
    chSeason: { kind: "chart", title: "Seasonal erosive wind" },
    chSpeed: { kind: "chart", title: "Wind speed and gusts by month" },
    chWater: { kind: "chart", title: "Precipitation and reference ET₀ by month" },
    chTrend: { kind: "chart", title: "Erosive wind hours by year" },
    chCal: { kind: "chart", title: "Monthly erosive hours: measured, reanalysis, calibrated" },
    rose: { kind: "svg", title: "Erosive wind rose" },
  };
  /* a figure from another sheet: own: it needs no wind analysis; back: the sheet to return to; file, x, sub and table:
     its file name, the name of its first CSV column, its subtitle, and its data when not one row per label */
  const addFig = (id, f) => { FIG[id] = { kind: "chart", ...f }; };
  const figName = id => (FIG[id] && FIG[id].file) || id;
  let figId = null;
  const IN = { in: 1, cm: 1 / 2.54, mm: 1 / 25.4 };

  function siteLine() {
    const s = state.site, w = state.wind;
    if (!s) return "";
    const src = state.windKey === "cal" && state.windStation ? `calibrated to ${state.windStation.meta.id}` : state.windKey === "station" ? "airport observations" : (w && w.model === "ecmwf" ? "ECMWF" : "MERRA-2");
    const per = w && w.period ? (typeof w.period === "string" ? w.period : w.period.label) : w ? `${w.start}–${w.end}` : "";
    return `${state.place ? state.place + " · " : ""}${s.lat.toFixed(4)}, ${s.lon.toFixed(4)}${w && !w.error ? ` · ${per} · ${src}` : ""}`;
  }
  function screenSize(id) {
    const el = FIG[id].kind === "chart" ? document.getElementById(id) : $("#roseBox svg");
    const r = el ? el.getBoundingClientRect() : { width: 0, height: 0 };
    return r.width > 20 ? { w: r.width / 96, h: r.height / 96 } : { w: 6.5, h: 3.4 };
  }
  function openFig(id) {
    figId = id;
    const f = FIG[id];
    backTo = f.back || null;
    $("#figTitle").textContent = `Download: ${f.title}`;
    const formats = f.kind === "chart" ? [["png", "PNG image"], ["tif", "TIFF image"], ["jpg", "JPEG image"], ["csv", "CSV (the data behind it)"]]
      : [["svg", "SVG (vector)"], ["png", "PNG image"], ["tif", "TIFF image"], ["jpg", "JPEG image"], ["csv", "CSV (the data behind it)"]];
    $("#figFormat").innerHTML = formats.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
    $("#figPreset").value = "screen";
    figUnitWas = $("#figUnit").value;
    applyPreset();
    open("figSheet");
  }
  // the unit the size boxes are in, and their size in it unrounded: the boxes show it rounded, so a size switched to
  // another unit and back is the size typed (90 mm, not 89.92)
  let figUnitWas = null, figSize = null;
  function showSize(w, h, unit) {
    figSize = { w, h };
    $("#figW").value = +w.toFixed(unit === "px" ? 0 : 2);
    $("#figH").value = +h.toFixed(unit === "px" ? 0 : 2);
  }
  function applyPreset() {
    const p = $("#figPreset").value, unit = $("#figUnit").value, was = figUnitWas, dpi = +$("#figDpi").value;
    figUnitWas = unit;
    let w, h;
    if (p === "screen") ({ w, h } = screenSize(figId));
    else if (p !== "custom") [w, h] = p.split("x").map(Number);
    if (p === "custom") {
      // the same size in the new unit: 90 x 60 mm is 3.54 x 2.36 in
      if (was && was !== unit) {
        const s = figSize || { w: +$("#figW").value, h: +$("#figH").value }, k = (was === "px" ? 1 / dpi : IN[was]) * (unit === "px" ? dpi : 1 / IN[unit]);
        showSize(s.w * k, s.h * k, unit);
      }
      return info();
    }
    if (FIG[figId] && FIG[figId].kind === "svg" && p !== "screen") h = (w * roseHeight(Ch.roseSVG(state.wind))) / 300 * ($("#figTitleOn").checked ? 1.12 : 1);
    const k = unit === "px" ? +$("#figDpi").value : 1 / IN[unit];
    showSize(w * k, h * k, unit);
    info();
  }
  /* requested size in inches, the pixel size and the DPI */
  function dims() {
    const unit = $("#figUnit").value, dpi = +$("#figDpi").value;
    const toIn = v => (unit === "px" ? v / dpi : v * IN[unit]);
    const s = figSize || { w: +$("#figW").value, h: +$("#figH").value }, wIn = toIn(s.w || 0), hIn = toIn(s.h || 0);
    return { wIn, hIn, dpi, px: [Math.round(wIn * dpi), Math.round(hIn * dpi)] };
  }
  function info() {
    const fmtSel = $("#figFormat").value, d = dims(), mp = (d.px[0] * d.px[1]) / 1e6;
    const vector = fmtSel === "svg", csv = fmtSel === "csv";
    $$("#figSheet .form-grid label").forEach(l => { if (!l.querySelector("#figFormat")) l.style.opacity = csv ? 0.4 : 1; });
    $("#figInfo").textContent = csv ? "The values plotted, in the units chosen in the units table."
      : vector ? `${fmt(d.wIn, 2)} × ${fmt(d.hIn, 2)} in vector drawing; it stays sharp at any size.`
        : `${d.px[0].toLocaleString()} × ${d.px[1].toLocaleString()} pixels (${fmt(mp, 1)} megapixels) at ${d.dpi} dpi, ${fmt(d.wIn, 2)} × ${fmt(d.hIn, 2)} in (${fmt(d.wIn * 2.54, 1)} × ${fmt(d.hIn * 2.54, 1)} cm). The DPI is written into the file.`
          + (mp > 60 ? " This is very large; your browser may run out of memory." : "");
  }
  ["#figPreset", "#figUnit"].forEach(s => $(s).addEventListener("change", applyPreset));
  // a typed value is the size from now on, as typed; the other box keeps its own
  ["#figW", "#figH"].forEach(s => $(s).addEventListener("input", () => {
    $("#figPreset").value = "custom";
    figSize = { w: +$("#figW").value, h: +$("#figH").value, ...figSize, [s === "#figW" ? "w" : "h"]: +$(s).value };
    info();
  }));
  ["#figDpi", "#figFormat", "#figFont"].forEach(s => $(s).addEventListener("change", () => ($("#figUnit").value === "px" ? applyPreset() : info())));
  // a wind analysis to draw from, or a toast saying why there is none
  const windReady = () => (state.wind && !state.wind.error ? true
    : (toast(state.wind ? `No wind analysis for this period: ${state.wind.error}.` : "Wait for the wind analysis to finish."), false));
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-fig]");
    if (b) { e.preventDefault(); if ((FIG[b.dataset.fig] && FIG[b.dataset.fig].own) || windReady()) openFig(b.dataset.fig); }
    const c = e.target.closest("[data-csv]");
    if (c) { e.preventDefault(); downloadTable(c.dataset.csv); }
  });

  // only the place is shortened, so the coordinates, dates and table name stay whole
  const baseName = (what, site = state.site, place = state.place) => X.slug(`SoilGuard_${X.slug(place || "site", 40)}_${site ? `${site.lat.toFixed(4)}_${site.lon.toFixed(4)}` : ""}_${what}`);

  async function encode(canvas, fmtSel, dpi) {
    if (fmtSel === "tif") {
      const img = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
      return new Blob([X.tiffEncode(img.data, canvas.width, canvas.height, dpi)], { type: "image/tiff" });
    }
    const type = fmtSel === "jpg" ? "image/jpeg" : "image/png";
    const blob = await new Promise((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error("The browser could not encode the image (too large?)"))), type, 0.95));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return new Blob([fmtSel === "jpg" ? X.jpegSetDpi(bytes, dpi) : X.pngSetDpi(bytes, dpi)], { type });
  }

  /* the rose with an optional title block, as a standalone SVG of the physical size. Text is in points, as in the
     charts: the rose's legend at the chosen font size (its other labels in proportion), the title at 1.25× and the
     location line at 0.95×. The rose's labels are never drawn larger, against the rose, than on screen, where its
     legend was laid out to fit. */
  // the rose's drawing is 300 units wide; a legend on more rows makes it taller
  const roseHeight = svg => +((svg.match(/viewBox="0 0 [\d.]+ ([\d.]+)"/) || [0, 300])[1]);
  function svgFigure(wIn, hIn, title, sub, fontPt) {
    const svg = Ch.roseSVG(state.wind), RH = roseHeight(svg), inner = svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
    const pt = fontPt || 8, Wpt = wIn * 72, Hpt = hIn * 72;
    const headPt = (title ? 1.25 * 1.25 * pt : 0) + (sub ? 1.5 * 0.95 * pt : 0) + (title || sub ? 0.6 * pt : 0);
    const u = Math.min(Wpt / 300, Math.max(Hpt - headPt, Hpt / 4) / RH); // points per rose unit: the rose fills the width or the height left
    const W = Wpt / u, H = Hpt / u, k = Math.min(pt / (9.5 * u), 1), r2 = v => +v.toFixed(2);
    const rose = inner.replace(/font-size="([\d.]+)"/g, (m, v) => `font-size="${r2(v * k)}"`);
    const fit = (t, size) => Math.min(size, (0.96 * W) / (0.55 * Math.max(t.length, 1))); // a long line shrinks to the width
    let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${wIn}in" height="${hIn}in" viewBox="0 0 ${r2(W)} ${r2(H)}" font-family="Inter, Arial, Helvetica, sans-serif"><rect width="100%" height="100%" fill="#fff"/>`;
    let y = 0;
    if (title) { const f = fit(title, (1.25 * pt) / u); y += 1.25 * f; s += `<text x="${r2(W / 2)}" y="${r2(y)}" text-anchor="middle" font-size="${r2(f)}" font-weight="600" fill="#1c2420">${esc(title)}</text>`; }
    if (sub) { const f = fit(sub, (0.95 * pt) / u); y += 1.5 * f; s += `<text x="${r2(W / 2)}" y="${r2(y)}" text-anchor="middle" font-size="${r2(f)}" fill="#69716a">${esc(sub)}</text>`; }
    const top = title || sub ? y + (0.6 * pt) / u : 0;
    return s + `<g transform="translate(${r2((W - 300) / 2)},${r2(top)})">${rose}</g></svg>`;
  }
  async function svgToCanvas(svg, w, h) {
    const img = new Image();
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    await img.decode();
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const x = c.getContext("2d");
    x.fillStyle = "#fff"; x.fillRect(0, 0, w, h);
    x.drawImage(img, 0, 0, w, h);
    return c;
  }

  $("#figGo").addEventListener("click", async () => {
    const id = figId, f = FIG[id], fmtSel = $("#figFormat").value;
    if (!id || !(f.own || windReady())) return; // the analysis went (a reload) or has no usable month while the sheet was open
    const title = $("#figTitleOn").checked ? f.title : "", sub = $("#figSubOn").checked ? f.sub || siteLine() : "";
    const btn = $("#figGo");
    btn.disabled = true;
    try {
      if (fmtSel === "csv") return downloadTable(id);
      const d = dims(), fontPt = +$("#figFont").value || 8;
      if (d.wIn < 0.5 || d.hIn < 0.5) return toast("Choose a size of at least 0.5 in (13 mm) each way.");
      if (f.kind === "svg") {
        const svg = svgFigure(+d.wIn.toFixed(3), +d.hIn.toFixed(3), title, sub, fontPt);
        if (fmtSel === "svg") return X.save(svg, `${baseName(id)}.svg`, "image/svg+xml");
        const c = await svgToCanvas(svg, d.px[0], d.px[1]);
        return X.save(await encode(c, fmtSel, d.dpi), `${baseName(id)}_${d.dpi}dpi.${fmtSel}`);
      }
      const canvas = document.createElement("canvas");
      const chart = Ch.render(id, canvas, { w: d.wIn * 96, h: d.hIn * 96, ratio: d.dpi / 96, fontPx: fontPt * 96 / 72, title, subtitle: sub });
      if (!chart) return toast("Open the Wind tab once so the chart is drawn, then try again.");
      try { X.save(await encode(canvas, fmtSel, d.dpi), `${baseName(figName(id))}_${d.dpi}dpi.${fmtSel}`); } finally { chart.destroy(); }
    } catch (e) {
      console.error(e);
      toast(`Could not make the file: ${e.message || e}`);
    } finally { btn.disabled = false; }
  });

  /* ---------- CSV tables ---------- */
  const csvSave = (name, header, rows) => X.save(X.csv(header, rows), `${baseName(name)}.csv`, "text/csv;charset=utf-8");
  function kvRows(sel) {
    const ks = $$(`${sel} .k`);
    return ks.map(k => [k.textContent.trim(), (k.nextElementSibling && k.nextElementSibling.classList.contains("v") ? k.nextElementSibling.textContent : "").trim()]);
  }
  function downloadTable(key) {
    const w = state.wind;
    if (FIG[key] && FIG[key].kind === "chart") {
      const f = FIG[key], t = f.table ? f.table() : Ch.table(key);
      if (f.table) return csvSave(figName(key), t.header, t.rows);
      return t ? csvSave(figName(key), [f.x || "Month or year", ...t.header.slice(1)], t.rows) : toast("Open the Wind tab once so the chart is drawn.");
    }
    if (key === "rose") {
      if (!windReady()) return;
      const u = UN.sym("wind"), lab = v => fmt(UN.conv("wind", v), ["m/s", "kn"].includes(u) ? 1 : 0);
      return csvSave("wind_rose", ["Direction (from)", "Degrees", `% of hours ${lab(w.thr)}–${lab(w.thr + 2)} ${u}`, `% of hours ${lab(w.thr + 2)}–${lab(w.thr + 4)} ${u}`, `% of hours > ${lab(w.thr + 4)} ${u}`, "Total % of hours"],
        w.rose.map((r, i) => [COMPASS[i], i * 22.5, ...r.bins.map(v => +v.toFixed(3)), +r.bins.reduce((a, b) => a + b, 0).toFixed(3)]));
    }
    if (key === "windIdx" && !windReady()) return; // without an analysis the card holds only the reason
    if (key === "windIdx" || key === "calKv") return csvSave(key === "windIdx" ? "wind_indices" : "calibration", ["Quantity", "Value"], kvRows("#" + key));
    if (key === "weg") {
      const u = UN.sym("soilLoss");
      return csvSave("wind_erodibility_groups", ["WEG", "Name", "Texture guide (NSSH 618.93)", `I (${u})`, "I (t/ac/yr, as defined)"],
        WG.soil.WEG_INFO.map(g => [g.g, g.name, g.def, String(g.I).replace(/\d+/g, n => UN.num("soilLoss", +n, 0)), g.I]));
    }
    if (key === "monthly" || key === "annual") return downloadSummary(key);
    toast("Nothing to download yet.");
  }

  /* monthly or annual summary of a wind analysis, in the chosen units: { name, header, rows } */
  const LEVEL = { hi: "high", mid: "moderate", lo: "low", unranked: "not ranked (part of a year)", na: "no data" };
  function summary(kind, w) {
    const ws = UN.sym("wind"), pr = UN.sym("precip"), rd = (v, d) => (Number.isFinite(v) ? +v.toFixed(d) : null);
    const cv = v => rd(UN.conv("wind", v), 2), cp = v => rd(UN.conv("precip", v), pr === "in" ? 2 : 1), thr = `≥ ${fmt(UN.conv("wind", w.thr), 1)} ${ws}`;
    if (kind === "monthly") {
      // a month without enough hours (a custom period, gaps in a station record) has no wind figures. The shares are of
      // the months with data: of the year when all 12 have data (annualized), else of the months covered, which are
      // then not ranked
      const eSum = w.months.reduce((a, m) => a + (m.valid ? m.energy : 0), 0), of = w.annualized ? "% of the year" : "% of the months with data";
      return { name: "monthly_summary", header: ["Month", `Mean wind (${ws})`, `Mean daily max wind (${ws})`, `Mean daily max gust (${ws})`, `Erosive hours per year (${thr})`,
        `Erosive energy share (${of})`, `Risk share (${of})`, "Risk level", `Days with gusts ≥ ${fmt(UN.conv("wind", 17.9), ["m/s", "kn"].includes(ws) ? 1 : 0)} ${ws}`, `Precipitation (${pr})`, `ET0 (${pr})`, "Dryness 1-P/ET0"],
      rows: w.months.map((m, i) => [MONTHS[i], cv(m.mean), cv(m.meanDailyMax), cv(m.meanDailyGust), rd(m.eroHours, 2), m.valid && eSum > 0 ? rd((100 * m.energy) / eSum, 2) : null,
        m.valid ? rd(m.share * 100, 2) : null, m.valid ? LEVEL[m.level] || "" : LEVEL.na, rd(m.gustDays, 2), cp(m.precip), cp(m.et0), rd(m.dry, 3)]) };
    }
    // a partial year (the period starts or ends in it, or the record has gaps) is scaled to a full year, so it is marked,
    // with the share of the calendar year's hours that have data in the period (cov, 0-1)
    return { name: "annual_summary", header: ["Year", `Mean wind (${ws})`, `Erosive hours per year (${thr}; partial years scaled to a full year)`, `Precipitation (${pr})`, "Complete year", "Hours with data in the period (% of the year)"],
      rows: w.annual.map(r => [r.year, cv(r.mean), rd(r.eroHours, 0), cp(r.precip), r.complete ? "yes" : "no", rd(100 * r.cov, 1)]) };
  }
  function downloadSummary(kind) {
    if (!windReady()) return;
    const t = summary(kind, state.wind);
    csvSave(t.name, t.header, t.rows);
  }

  return { open, close, renderUnits, openFig, addFig, downloadTable, summary, baseName, csvSave, siteLine };
})();
