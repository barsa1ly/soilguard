/* Downloads and settings sheets: the units table, figure downloads (size, DPI, format), CSV tables, and the
   data sheet for a location (series and model-ready soil and weather files, built in WG.models). */
WG.downloads = (function () {
  const { $, $$, esc, fmt, toast, MONTHS, COMPASS } = WG.util;
  const UN = WG.units, X = WG.export, Ch = WG.charts;
  const state = WG.state;

  /* ---------- sheets ---------- */
  const SHEETS = ["unitsSheet", "figSheet", "gridSheet"];
  let backTo = null; // the sheet a figure was opened from, shown again when the figure sheet closes
  let opener = null; // what had the focus when the first sheet opened: it has it again when the last one closes
  function open(id) {
    if (SHEETS.every(s => $("#" + s).hidden)) opener = document.activeElement;
    if (id !== "figSheet" && !$("#figSheet").hidden) end(); // the save dialog's preview let go as another sheet takes its place
    SHEETS.forEach(s => { $("#" + s).hidden = s !== id; });
    $("#sheetBackdrop").hidden = false;
    const first = $(`#${id} select, #${id} input, #${id} button`);
    if (first) first.focus({ preventScroll: true });
  }
  function close() {
    if (SHEETS.every(s => $("#" + s).hidden)) return false;
    if (!$("#figSheet").hidden) end();
    if (backTo && !$("#figSheet").hidden) { const b = backTo; backTo = null; open(b); return true; }
    backTo = null;
    const inSheet = SHEETS.some(s => $("#" + s).contains(document.activeElement));
    SHEETS.forEach(s => { $("#" + s).hidden = true; });
    $("#sheetBackdrop").hidden = true;
    if (opener && opener !== document.body && opener.isConnected && opener.focus) opener.focus({ preventScroll: true });
    else if (inSheet) document.activeElement.blur();
    opener = null;
    return true;
  }
  $$("[data-close]").forEach(b => b.addEventListener("click", close));
  $("#sheetBackdrop").addEventListener("click", close);
  document.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
  // the save dialog keeps Tab inside it, as it covers the page
  $("#figSheet").addEventListener("keydown", e => {
    if (e.key !== "Tab") return;
    const f = [...$("#figSheet").querySelectorAll("button, select, input, [contenteditable]")].filter(x => !x.disabled && x.tabIndex >= 0 && x.getClientRects().length);
    if (!f.length) return;
    const i = f.indexOf(document.activeElement);
    if (i < 0) { if (!$("#figSheet").contains(document.activeElement)) { e.preventDefault(); f[0].focus(); } return; } // the preview's own box: Tab goes on from it
    if (e.shiftKey && i === 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
  });

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

  /* ---------- the save dialog: a figure (a chart or the wind rose) or the map, as a file ---------- */
  /* One dialog for both: size and resolution, format, and a preview of the file as it will be (its layout at the size
     chosen, drawn with fewer pixels), on which each text is changed in place or left out. A chart's texts (title,
     subtitle, legend labels, axis titles) are boxes laid over the preview where Chart.js drew them, in the same font, and
     the chart is drawn again with what is typed; the rose's are its SVG's texts; the map's footer is the HTML its image is
     drawn from (js/mapimage.js hands its part over through openSave). The file is drawn from the same texts. */
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
  const IN = { in: 1, cm: 1 / 2.54, mm: 1 / 25.4 };
  const SIZES = {
    fig: [["screen", "As on screen"], ["3.5x2.6", "Journal, 1 column (3.5 in / 89 mm)"], ["5.5x3.6", "Journal, 1.5 column (5.5 in / 140 mm)"],
      ["7.2x4.2", "Journal, 2 columns (7.2 in / 183 mm)"], ["10x5.6", "Slide (10 in / 254 mm)"], ["custom", "Custom"]],
    // the map keeps the shape it has on the screen: a multiple of its size there, or a width in print
    map: [["x1", "As on screen (1×)"], ["x2", "2× the screen, sharper"], ["x3", "3× the screen"], ["w3.5", "Print, 3.5 in wide (300 dpi)"],
      ["w6.5", "Print, 6.5 in wide (300 dpi)"], ["w10", "Slide, 10 in wide (300 dpi)"], ["custom", "Custom"]],
  };
  const FORMATS = {
    chart: [["png", "PNG image"], ["tif", "TIFF image"], ["jpg", "JPEG image"], ["csv", "CSV (the data behind it)"]],
    svg: [["svg", "SVG (vector)"], ["png", "PNG image"], ["tif", "TIFF image"], ["jpg", "JPEG image"], ["csv", "CSV (the data behind it)"]],
    map: [["png", "PNG image"], ["jpg", "JPEG image"], ["tif", "TIFF image"]],
  };
  let job = null, figId = null; // what the dialog saves ({ kind: "chart" | "svg" | "map", ... }) and, for a figure, its id
  let ed = {}, seen = {}, gone = []; // the texts typed (key -> text; null: left out), each as first drawn, and those left out ({ label, back })
  let pvChart = null, pvT = 0, zoom = "fit";
  const unitOf = { fig: "in", map: "px" }; // the size unit last chosen for each: a map's size is mostly thought of in pixels
  const grp = () => (job && job.kind === "map" ? "map" : "fig");

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
  // from: the button that opened it, which has the focus again when it closes (a browser may not focus a clicked button)
  function openFig(id, from) {
    const f = FIG[id];
    begin({ kind: f.kind, id, head: `Download: ${f.title}` }, from);
    backTo = f.back || null;
  }
  /* the map's part (js/mapimage.js): { kind: "map", head, W, H (the map's size in CSS pixels), pv (its preview canvas),
     maxPx (the most pixels to draw), foot() (a new copy of the footer), compose(k, footer) (the image at k pixels per CSS
     pixel, the footer as edited under the map), name(ext), note (said when saved), release() } */
  function openSave(j, from) { backTo = null; begin(j, from); }
  function begin(j, from) {
    end();
    job = j; figId = j.id || null; ed = {}; seen = {}; gone = [];
    $("#figTitle").textContent = j.head;
    $("#figFormat").innerHTML = FORMATS[j.kind].map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
    $("#figPreset").innerHTML = SIZES[grp()].map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join("");
    $("#figPreset").value = j.kind === "map" ? "x2" : "screen";
    $("#figUnit").value = unitOf[grp()];
    figUnitWas = $("#figUnit").value; figSize = null;
    $("#figFontBox").hidden = j.kind === "map";
    open("figSheet"); // first: the preview's box has its width once it is on the screen
    if (from && (!opener || opener === document.body)) opener = from;
    if (j.kind === "map") mountMap();
    renderGone();
    applyPreset();
  }
  // the preview let go (the chart drawn for it, the map's pictures): the dialog closed, or another file is begun
  function end() {
    clearTimeout(pvT);
    if (pvChart) { pvChart.destroy(); pvChart = null; }
    if (job && job.release) job.release();
    const st = $("#svStage");
    st.innerHTML = ""; st.removeAttribute("style");
    showX(null);
    job = null; figId = null;
  }

  /* ---------- size and resolution ---------- */
  // the unit the size boxes are in, and their size in it unrounded: the boxes show it rounded, so a size switched to
  // another unit and back is the size typed (90 mm, not 89.92)
  let figUnitWas = null, figSize = null;
  function showSize(w, h, unit) {
    figSize = { w, h };
    $("#figW").value = +w.toFixed(unit === "px" ? 0 : 2);
    $("#figH").value = +h.toFixed(unit === "px" ? 0 : 2);
  }
  function applyPreset() {
    if (!job) return;
    const p = $("#figPreset").value, unit = $("#figUnit").value, was = figUnitWas, dpi = +$("#figDpi").value, map = job.kind === "map";
    figUnitWas = unit;
    let w, h;
    if (p === "custom") {
      // the same size in the new unit: 90 x 60 mm is 3.54 x 2.36 in
      if (was && was !== unit) {
        const s = figSize || { w: +$("#figW").value, h: +$("#figH").value }, k = (was === "px" ? 1 / dpi : IN[was]) * (unit === "px" ? dpi : 1 / IN[unit]);
        showSize(s.w * k, s.h * k, unit);
      }
      if (map) fitHeight();
      return update();
    }
    if (map) { w = /^w/.test(p) ? +p.slice(1) : (+p.slice(1) * job.W) / dpi; h = w * aspect(); }
    else if (p === "screen") ({ w, h } = screenSize(figId));
    else [w, h] = p.split("x").map(Number);
    if (job.kind === "svg" && p !== "screen") h = (w * roseHeight(Ch.roseSVG(state.wind, roseLab()))) / 300 * (ed.title !== null || ed.subtitle !== null ? 1.12 : 1);
    const k = unit === "px" ? dpi : 1 / IN[unit];
    showSize(w * k, h * k, unit);
    update();
  }
  // the map's height (its footer grows and shrinks as its texts change) over its width; its height box follows the width
  const aspect = () => (job.H + footH()) / job.W;
  // the footer's height as the file will have it (js/mapimage.js: its exact height rounded up), not scaled by the preview
  const footH = () => Math.ceil(job.el.getBoundingClientRect().height / (job.sc || 1) - 0.01);
  function fitHeight() {
    if (!figSize) return;
    figSize.h = figSize.w * aspect();
    $("#figH").value = +figSize.h.toFixed($("#figUnit").value === "px" ? 0 : 2);
  }
  /* requested size in inches, the pixel size and the DPI; for the map also k, its pixels per CSS pixel on the screen,
     and capped when that was more than the device can draw */
  function dims() {
    const unit = $("#figUnit").value, dpi = +$("#figDpi").value;
    const toIn = v => (unit === "px" ? v / dpi : v * IN[unit]);
    const s = figSize || { w: +$("#figW").value, h: +$("#figH").value }, wIn = toIn(s.w || 0), hIn = toIn(s.h || 0);
    if (job && job.kind === "map") {
      const Ht = job.H + footH(), want = (wIn * dpi) / job.W, cap = Math.sqrt(job.maxPx / (job.W * Ht)), k = Math.max(0.1, Math.min(want, cap));
      const px = [Math.round(job.W * k), Math.round(Ht * k)];
      return { wIn: px[0] / dpi, hIn: px[1] / dpi, dpi, px, k, capped: want > cap * 1.001 };
    }
    return { wIn, hIn, dpi, px: [Math.round(wIn * dpi), Math.round(hIn * dpi)] };
  }
  function info() {
    if (!job) return;
    const fmtSel = $("#figFormat").value, d = dims(), mp = (d.px[0] * d.px[1]) / 1e6, csv = fmtSel === "csv";
    if (job.kind === "map") showCap(d);
    $$("#figSheet .form-grid label").forEach(l => { if (!l.querySelector("#figFormat")) l.style.opacity = csv ? 0.4 : 1; });
    $("#svPv").classList.toggle("off", csv);
    const px = `${d.px[0].toLocaleString()} × ${d.px[1].toLocaleString()} pixels (${fmt(mp, 1)} megapixels)`, inch = `${fmt(d.wIn, 2)} × ${fmt(d.hIn, 2)} in (${fmt(d.wIn * 2.54, 1)} × ${fmt(d.hIn * 2.54, 1)} cm)`;
    $("#figInfo").textContent = job.kind === "map"
      ? `${px}, ${+d.k.toFixed(2)}× the map on the screen; ${inch} at ${d.dpi} dpi, which is written into the file.${d.capped ? " That is as large as this device can draw it." : ""} The base map's and layers' pictures keep the detail they have on the screen; outlines, the pin and the footer are drawn sharp at any size.`
      : csv ? "The values plotted, in the units chosen in the units table. The texts on the preview are for the image formats."
        : fmtSel === "svg" ? `${fmt(d.wIn, 2)} × ${fmt(d.hIn, 2)} in vector drawing; it stays sharp at any size.`
          : `${px} at ${d.dpi} dpi, ${inch}. The DPI is written into the file.` + (mp > 60 ? " This is very large; your browser may run out of memory." : "");
  }
  /* a map larger than the device can draw: the size boxes show the size it will have. The size asked for is kept, so the
     note keeps saying so; a box being typed in is left alone until the typing is done (now), or a digit would be cut. */
  function showCap(d, now) {
    const a = document.activeElement, u = $("#figUnit").value, k = u === "px" ? d.dpi : 1 / IN[u];
    if (!d.capped || (!now && a && (a.id === "figW" || a.id === "figH"))) return;
    $("#figW").value = +(d.wIn * k).toFixed(u === "px" ? 0 : 2);
    $("#figH").value = +(d.hIn * k).toFixed(u === "px" ? 0 : 2);
  }
  ["#figW", "#figH"].forEach(s => $(s).addEventListener("change", () => { if (job && job.kind === "map") showCap(dims(), true); }));
  // the size, its numbers and the preview, once the size or a text has changed
  const update = () => { info(); preview(); };
  ["#figPreset", "#figUnit"].forEach(s => $(s).addEventListener("change", () => {
    if (s === "#figUnit") unitOf[grp()] = $("#figUnit").value;
    // a print size is meant at 300 dpi or more
    else if (job && job.kind === "map" && /^w/.test($("#figPreset").value) && +$("#figDpi").value < 300) $("#figDpi").value = "300";
    applyPreset();
  }));
  // a typed value is the size from now on, as typed; the other box keeps its own (the map's follows its shape)
  ["#figW", "#figH"].forEach(s => $(s).addEventListener("input", () => {
    $("#figPreset").value = "custom";
    figSize = { w: +$("#figW").value, h: +$("#figH").value, ...figSize, [s === "#figW" ? "w" : "h"]: +$(s).value };
    if (job && job.kind === "map") {
      if (s === "#figW") fitHeight();
      else { figSize.w = figSize.h / aspect(); $("#figW").value = +figSize.w.toFixed($("#figUnit").value === "px" ? 0 : 2); }
    }
    update();
  }));
  // a new DPI keeps the size in pixels when that is how it was given (and a multiple of the map's screen size)
  $("#figDpi").addEventListener("change", () => ($("#figUnit").value === "px" || grp() === "map" ? applyPreset() : info()));
  $("#figFormat").addEventListener("change", info);
  $("#figFont").addEventListener("input", update);
  // a wind analysis to draw from, or a toast saying why there is none
  const windReady = () => (state.wind && !state.wind.error ? true
    : (toast(state.wind ? `No wind analysis for this period: ${state.wind.error}.` : "Wait for the wind analysis to finish."), false));
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-fig]");
    if (b) { e.preventDefault(); if ((FIG[b.dataset.fig] && FIG[b.dataset.fig].own) || windReady()) openFig(b.dataset.fig, b); }
    const c = e.target.closest("[data-csv]");
    if (c) { e.preventDefault(); downloadTable(c.dataset.csv); }
  });

  /* ---------- the preview ---------- */
  // drawn again a moment after the last change (a timer, not a frame: a page in the background draws it too)
  function preview() {
    clearTimeout(pvT);
    pvT = setTimeout(() => { if (!job) return; try { if (job.kind === "map") drawMap(); else drawFig(); } catch (e) { console.error(e); } }, 30);
  }
  $("#svZoom").addEventListener("click", e => {
    const b = e.target.closest("[data-z]");
    if (!b) return;
    zoom = b.dataset.z === "fit" ? "fit" : 1;
    $$("#svZoom [data-z]").forEach(x => { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", String(x === b)); });
    preview();
  });
  window.addEventListener("resize", () => { if (job) preview(); });
  // screen pixels per CSS pixel of the file's layout: Fit fills the box's width and height, or, where fitting the height
  // would draw the text smaller than 0.85 of its size (too small to tap and read), as much of the width as that allows,
  // scrolling down; Actual size is 1
  function fitScale(w, h) {
    if (zoom !== "fit") return 1;
    const pv = $("#svPv"), cs = getComputedStyle(pv), n = v => parseFloat(v) || 0;
    const sw = (pv.clientWidth - n(cs.paddingLeft) - n(cs.paddingRight)) / w, sh = ((n(cs.maxHeight) || innerHeight * 0.6) - n(cs.paddingTop) - n(cs.paddingBottom)) / h;
    return Math.max(0.1, Math.min(2, sw, Math.max(sh, 0.85)));
  }
  // the title and subtitle as they will be drawn: as typed, or the figure's own ("" leaves one out)
  const texts = f => ({ title: ed.title === null ? "" : ed.title ?? f.title, sub: ed.subtitle === null ? "" : ed.subtitle ?? (f.sub || siteLine()) });
  const roseLab = () => [0, 1, 2, 3].map(i => ed[`legend:${i}`]);
  const legKey = it => `legend:${it.datasetIndex ?? it.index}`;
  /* the texts typed, put into a chart's configuration: its legend's labels (by dataset) and its axis titles. The scales
     are copied, not changed: a chart's builder may share them with the chart on the page. */
  function editCfg(cfg) {
    const o = cfg.options = cfg.options || {}, pl = o.plugins = o.plugins || {}, lg = pl.legend = { ...(pl.legend || {}) }, lb = lg.labels = { ...(lg.labels || {}) };
    const gen = lb.generateLabels || Chart.defaults.plugins.legend.labels.generateLabels, keep = lb.filter;
    lb.generateLabels = ch => gen(ch).map(it => (typeof ed[legKey(it)] === "string" ? { ...it, text: ed[legKey(it)] } : it));
    lb.filter = (it, data) => ed[legKey(it)] !== null && (!keep || keep(it, data));
    if (o.scales) o.scales = Object.fromEntries(Object.entries(o.scales).map(([id, sc]) => {
      const k = `scale:${id}`;
      return [id, sc && sc.title && k in ed ? { ...sc, title: { ...sc.title, display: ed[k] !== null, text: ed[k] ?? "" } } : sc];
    }));
  }
  /* where Chart.js drew each text the dialog can change, in the chart's own pixels: { k, text, x, y (its middle), rot, F }.
     Read in the drawing (an afterDraw), while the chart's font size is the one chosen. */
  function chartTexts(ch) {
    const H = Chart.helpers, out = [], T = ch.titleBlock, S = T && ch.boxes.find(b => b !== T && b.constructor === T.constructor);
    const put = (k, text, x, y, rot, F) => out.push({ k, text: [].concat(text).join(" "), x, y, rot, F });
    [["title", T], ["subtitle", S]].forEach(([k, b]) => {
      if (!b || !b.options.display) return;
      const F = H.toFont(b.options.font);
      put(k, b.options.text, (b.left + b.right) / 2, b.top + H.toPadding(b.options.padding).top + F.lineHeight / 2, 0, F);
    });
    // a legend label comes after its colour box: its hit box is the box, half a font size and the text
    const L = ch.legend;
    if (L && L.options.display && L.legendHitBoxes) L.legendItems.forEach((it, i) => {
      const hb = L.legendHitBoxes[i], F = H.toFont(L.options.labels.font);
      if (!hb) return;
      ch.ctx.save(); ch.ctx.font = F.string;
      const tw = ch.ctx.measureText(it.text).width;
      ch.ctx.restore();
      put(legKey(it), it.text, hb.left + hb.width - tw / 2, hb.top + hb.height / 2, 0, F);
    });
    // an axis title at Chart.js's own place: its line's middle half a line and the padding in from the scale's edge
    Object.entries(ch.scales).forEach(([id, sc]) => {
      const t = sc.options.title;
      if (!t || !t.display) return;
      const F = H.toFont(t.font), P = H.toPadding(t.padding), pos = sc.options.position, hz = sc.isHorizontal(), off = F.lineHeight / 2 + (pos === "bottom" ? P.bottom : P.top);
      put(`scale:${id}`, t.text, hz ? (sc.left + sc.right) / 2 : pos === "left" ? sc.left + off : sc.right - off,
        hz ? (pos === "top" ? sc.top + off : sc.bottom - off) : (sc.top + sc.bottom) / 2, hz ? 0 : pos === "left" ? -90 : 90, F);
    });
    return out;
  }
  // the rose's texts where the browser laid them out in the preview, in the figure's own pixels
  function svgTexts(svg, s) {
    const o = $("#svStage").getBoundingClientRect();
    return [...svg.querySelectorAll("[data-k]")].map(el => {
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el), m = el.getScreenCTM(), z = m ? Math.hypot(m.a, m.b) : 1;
      return { k: el.getAttribute("data-k"), text: el.textContent, x: ((r.left + r.right) / 2 - o.left) / s, y: ((r.top + r.bottom) / 2 - o.top) / s, rot: 0,
        F: { style: "normal", weight: cs.fontWeight, size: (parseFloat(cs.fontSize) * z) / s, lineHeight: r.height / s, family: cs.fontFamily } };
    });
  }
  function drawFig() {
    const f = FIG[figId], d = dims(), st = $("#svStage");
    if (!(d.wIn >= 0.5 && d.hIn >= 0.5)) return;
    const w = d.wIn * 96, h = d.hIn * 96, s = fitScale(w, h), fontPt = +$("#figFont").value || 8, T = texts(f), old = st.querySelector(".sv-art");
    st.style.width = `${w * s}px`; st.style.height = `${h * s}px`;
    let art, list = [];
    if (f.kind === "svg") {
      const box = document.createElement("div");
      box.innerHTML = svgFigure(+d.wIn.toFixed(3), +d.hIn.toFixed(3), T.title, T.sub, fontPt, roseLab());
      art = box.firstElementChild;
      art.setAttribute("width", w * s); art.setAttribute("height", h * s);
      if (old) old.replaceWith(art); else st.prepend(art);
      list = svgTexts(art, s);
    } else {
      // the file's layout, with only the pixels the screen shows; the texts' places read as it is drawn
      art = document.createElement("canvas");
      const ch = Ch.render(figId, art, { w, h, ratio: Math.min(s * (window.devicePixelRatio || 1), Math.sqrt(8e6 / (w * h))), fontPx: (fontPt * 96) / 72, title: T.title, subtitle: T.sub,
        edit: cfg => { editCfg(cfg); cfg.plugins.push({ id: "svTexts", afterDraw: c => { list = chartTexts(c); } }); } });
      if (!ch) { st.textContent = "Open the chart's tab once so it is drawn, then try again."; return; }
      if (pvChart) pvChart.destroy();
      pvChart = ch;
      art.style.width = `${w * s}px`; art.style.height = `${h * s}px`;
      if (old) old.replaceWith(art); else st.prepend(art);
    }
    art.classList.add("sv-art");
    placeTexts(list, s);
    showX(act);
  }
  const ED_NAME = k => (k === "title" ? "Title" : k === "subtitle" ? "Subtitle" : /^legend/.test(k) ? "Legend label" : "Axis title");
  /* the boxes laid over the preview where each text is drawn (in its font, transparent until typed in); the one being
     typed in keeps its text and caret, and moves with the drawing (but not while empty, where it has no place) */
  function placeTexts(list, s) {
    const st = $("#svStage"), old = new Map([...st.querySelectorAll(".sv-ed")].map(e => [e.dataset.k, e])), now = document.activeElement;
    list.forEach(t => {
      if (!(t.k in seen)) seen[t.k] = t.text;
      let e = old.get(t.k);
      old.delete(t.k);
      if (!e) { e = document.createElement("span"); e.dataset.k = t.k; editable(e, "sv-ed", ED_NAME(t.k)); st.appendChild(e); }
      if (e === now && !t.text.trim()) return;
      if (e !== now && e.textContent !== t.text) e.textContent = t.text;
      const F = t.F;
      e.style.cssText = `left:${t.x * s}px;top:${t.y * s}px;font:${F.style || "normal"} ${F.weight || "normal"} ${F.size * s}px/${F.lineHeight * s}px ${F.family};transform:translate(-50%,-50%)${t.rot ? ` rotate(${t.rot}deg)` : ""}`;
    });
    old.forEach(e => { if (e !== now) e.remove(); });
  }

  /* ---------- the map's preview: its picture, and under it the footer to edit, scaled together ---------- */
  function mountMap() {
    const w = document.createElement("div"), c = job.pv;
    w.className = "sv-map"; w.style.width = `${job.W}px`;
    c.classList.add("sv-art"); c.style.cssText = `display:block;width:${job.W}px;height:${job.H}px`;
    job.el = job.foot();
    editTree(job.el);
    w.append(c, job.el);
    $("#svStage").appendChild(w);
  }
  function drawMap() {
    const Ht = job.H + footH(), s = fitScale(job.W, Ht), st = $("#svStage");
    st.firstElementChild.style.transform = `scale(${s})`;
    job.sc = s;
    st.style.width = `${job.W * s}px`; st.style.height = `${Ht * s}px`;
    showX(act);
  }
  // a footer text changed: the image's height follows
  function sizeMap() { fitHeight(); update(); }
  /* the footer made editable where it holds text: an element with text of its own and only inline text in it (a line, a
     title with its unit) as one box; other text (a legend row's label beside its colour box) in a box of its own */
  const INLINE = /^(b|strong|i|em|small|sup|sub|span|a|abbr|code|u|s|mark|br)$/;
  const ownText = e => [...e.childNodes].some(n => n.nodeType === 3 && /\S/.test(n.nodeValue));
  const oneText = e => (ownText(e) || !e.children.length) && /\S/.test(e.textContent)
    && [...e.querySelectorAll("*")].every(c => INLINE.test(c.localName) && (c.localName === "br" || /\S/.test(c.textContent)));
  function editTree(root) {
    (function walk(e) {
      if (/^(img|svg|canvas|button|select|input|textarea)$/.test(e.localName)) return;
      if (oneText(e)) return editable(e, "sv-in", "Text in the image");
      [...e.childNodes].forEach(n => {
        if (n.nodeType === 1) walk(n);
        else if (n.nodeType === 3 && /\S/.test(n.nodeValue)) { const s = document.createElement("span"); n.replaceWith(s); s.appendChild(n); editable(s, "sv-in", "Text in the image"); }
      });
    })(root);
  }

  /* ---------- typing in the preview, leaving texts out and putting them back ---------- */
  function editable(e, cls, name) {
    try { e.contentEditable = "plaintext-only"; } catch (x) { e.contentEditable = "true"; } // a browser without plain-text editing
    e.spellcheck = false;
    e.classList.add(cls);
    e.setAttribute("role", "textbox");
    e.setAttribute("aria-label", name);
  }
  const stage = $("#svStage"), pvBox = $("#svPv"), xBtn = $("#svX");
  const edOf = t => (t && t.closest ? t.closest(".sv-ed, .sv-in") : null);
  let act = null, hover = null, hoverT = 0; // the text the × is on, and the one the mouse is over
  const before = new WeakMap(); // each text as it was when the caret went into it: { html, text }
  function showX(t) {
    act = t && t.isConnected ? t : null;
    xBtn.hidden = !act;
    if (!act) return;
    // just past the text's end (not over it, where a click meant for the text would land), else before its start, else
    // on its top edge at the right
    const r = act.getBoundingClientRect(), p = pvBox.getBoundingClientRect(), w = xBtn.offsetWidth, W0 = pvBox.clientWidth;
    let x = r.right - p.left + 3, y = (r.top + r.bottom) / 2 - p.top;
    if (x + w > W0) { x = r.left - p.left - w - 3; if (x < 0) { x = Math.min(r.right - p.left, W0) - w; y = r.top - p.top; } }
    xBtn.style.left = `${x - pvBox.clientLeft + pvBox.scrollLeft}px`;
    xBtn.style.top = `${y - pvBox.clientTop + pvBox.scrollTop}px`;
  }
  // the × waits a moment as the mouse goes to it from its text
  const hideSoon = () => { clearTimeout(hoverT); hoverT = setTimeout(() => { if (!edOf(document.activeElement)) showX(hover); }, 350); };
  stage.addEventListener("focusin", e => { const t = edOf(e.target); if (t) { before.set(t, { html: t.innerHTML, text: t.textContent }); clearTimeout(hoverT); showX(t); } });
  stage.addEventListener("focusout", e => {
    const t = edOf(e.target);
    if (t && t.isConnected && !t.textContent.trim()) leaveOut(t); // emptied: left out
    setTimeout(() => { if (!edOf(document.activeElement)) showX(hover); }, 0);
  });
  stage.addEventListener("input", e => {
    const t = edOf(e.target);
    if (!t || !job) return;
    // an emptied text keeps its line while the caret is in it, so the drawing does not jump as it is typed over
    if (t.classList.contains("sv-ed")) { ed[t.dataset.k] = t.textContent.replace(/\s+/g, " ") || " "; preview(); } else sizeMap();
    showX(t);
  });
  // Enter and Esc end the typing (Esc does not close the dialog from inside a text); the focus stays in the preview
  stage.addEventListener("keydown", e => {
    if (!edOf(e.target) || (e.key !== "Enter" && e.key !== "Escape")) return;
    e.preventDefault(); e.stopPropagation();
    pvBox.focus({ preventScroll: true });
  });
  // pasted or dropped text goes in as plain text on one line
  stage.addEventListener("paste", e => {
    if (!edOf(e.target)) return;
    e.preventDefault();
    document.execCommand("insertText", false, (e.clipboardData || window.clipboardData).getData("text").replace(/\s+/g, " "));
  });
  stage.addEventListener("drop", e => { if (edOf(e.target)) e.preventDefault(); });
  stage.addEventListener("pointerover", e => {
    if (e.pointerType !== "mouse") return;
    hover = edOf(e.target);
    if (hover) { clearTimeout(hoverT); if (!edOf(document.activeElement)) showX(hover); } else hideSoon();
  });
  pvBox.addEventListener("pointerleave", () => { hover = null; hideSoon(); });
  pvBox.addEventListener("scroll", () => showX(act), { passive: true });
  xBtn.addEventListener("pointerover", () => clearTimeout(hoverT));
  ["pointerdown", "mousedown"].forEach(ev => xBtn.addEventListener(ev, e => e.preventDefault())); // the text keeps the focus
  xBtn.addEventListener("click", () => { const t = act; if (t) { leaveOut(t); pvBox.focus({ preventScroll: true }); } });

  const hide = e => { e.style.setProperty("display", "none", "important"); e.dataset.svGone = ""; };
  const unhide = e => { e.style.removeProperty("display"); delete e.dataset.svGone; };
  /* a text left out: a chart's is drawn without it (its box goes); a footer's is hidden, with what held only it (a legend
     row's colour box, a line with nothing else). Each is listed under the preview, to be put back. */
  function leaveOut(t) {
    const b = before.get(t), text = t.textContent.trim() ? t.textContent : b ? b.text : "", label = text.trim() || "a blank text";
    if (t.classList.contains("sv-ed")) {
      const k = t.dataset.k, back = text.trim() ? text : seen[k];
      ed[k] = null;
      gone.push({ label, back: () => { if (back === seen[k]) delete ed[k]; else ed[k] = back; } });
      t.remove();
      preview();
    } else {
      if (!t.textContent.trim() && b) t.innerHTML = b.html; // what it said, for when it is put back
      const hid = [t];
      hide(t);
      for (let p = t.parentElement; p && p !== job.el && !p.innerText.trim() && !p.querySelector("img, canvas, svg"); p = p.parentElement) { hide(p); hid.push(p); }
      gone.push({ label, back: () => hid.forEach(unhide) });
      sizeMap();
    }
    if (act === t) showX(null);
    renderGone();
  }
  function renderGone() {
    const g = $("#svGone"), cut = t => (t.length > 34 ? `${t.slice(0, 32)}…` : t);
    g.hidden = !gone.length;
    g.innerHTML = gone.length ? `Left out:${gone.map((x, i) => `<button type="button" data-g="${i}" title="Put it back">↺ ${esc(cut(x.label.trim()))}</button>`).join("")}` : "";
  }
  $("#svGone").addEventListener("click", e => {
    const b = e.target.closest("[data-g]");
    if (!b || !job) return;
    gone.splice(+b.dataset.g, 1)[0].back();
    renderGone();
    if (job.kind === "map") sizeMap(); else preview();
    ($("#svGone [data-g]") || pvBox).focus({ preventScroll: true });
  });
  $("#svReset").addEventListener("click", () => {
    if (!job) return;
    gone = []; ed = {};
    if (job.kind === "map") { const n = job.foot(); editTree(n); job.el.replaceWith(n); job.el = n; sizeMap(); }
    else { $$("#svStage .sv-ed").forEach(e => e.remove()); applyPreset(); }
    renderGone();
  });

  /* ---------- the file ---------- */
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
     legend was laid out to fit. lab: its legend's labels as typed (Ch.roseSVG). */
  // the rose's drawing is 300 units wide; a legend on more rows makes it taller
  const roseHeight = svg => +((svg.match(/viewBox="0 0 [\d.]+ ([\d.]+)"/) || [0, 300])[1]);
  function svgFigure(wIn, hIn, title, sub, fontPt, lab) {
    const svg = Ch.roseSVG(state.wind, lab), RH = roseHeight(svg), inner = svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
    const pt = fontPt || 8, Wpt = wIn * 72, Hpt = hIn * 72;
    const headPt = (title ? 1.25 * 1.25 * pt : 0) + (sub ? 1.5 * 0.95 * pt : 0) + (title || sub ? 0.6 * pt : 0);
    const u = Math.min(Wpt / 300, Math.max(Hpt - headPt, Hpt / 4) / RH); // points per rose unit: the rose fills the width or the height left
    const W = Wpt / u, H = Hpt / u, k = Math.min(pt / (9.5 * u), 1), r2 = v => +v.toFixed(2);
    const rose = inner.replace(/font-size="([\d.]+)"/g, (m, v) => `font-size="${r2(v * k)}"`);
    const fit = (t, size) => Math.min(size, (0.96 * W) / (0.55 * Math.max(t.length, 1))); // a long line shrinks to the width
    let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${wIn}in" height="${hIn}in" viewBox="0 0 ${r2(W)} ${r2(H)}" font-family="Inter, Arial, Helvetica, sans-serif"><rect width="100%" height="100%" fill="#fff"/>`;
    let y = 0;
    if (title) { const f = fit(title, (1.25 * pt) / u); y += 1.25 * f; s += `<text x="${r2(W / 2)}" y="${r2(y)}" text-anchor="middle" font-size="${r2(f)}" font-weight="600" fill="#1c2420" data-k="title">${esc(title)}</text>`; }
    if (sub) { const f = fit(sub, (0.95 * pt) / u); y += 1.5 * f; s += `<text x="${r2(W / 2)}" y="${r2(y)}" text-anchor="middle" font-size="${r2(f)}" fill="#69716a" data-k="subtitle">${esc(sub)}</text>`; }
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
    if (!job) return;
    const fmtSel = $("#figFormat").value, btn = $("#figGo");
    btn.disabled = true;
    try { await (job.kind === "map" ? saveMap(fmtSel) : saveFig(fmtSel)); }
    catch (e) {
      console.error(e);
      toast(`Could not make the file: ${e.message || e}`);
    } finally { btn.disabled = false; }
  });
  async function saveFig(fmtSel) {
    const id = figId, f = FIG[id];
    if (!(f.own || windReady())) return; // the analysis went (a reload) or has no usable month while the sheet was open
    if (fmtSel === "csv") return downloadTable(id);
    const d = dims(), fontPt = +$("#figFont").value || 8, T = texts(f);
    if (d.wIn < 0.5 || d.hIn < 0.5) return toast("Choose a size of at least 0.5 in (13 mm) each way.");
    if (f.kind === "svg") {
      const svg = svgFigure(+d.wIn.toFixed(3), +d.hIn.toFixed(3), T.title, T.sub, fontPt, roseLab()).replace(/ data-k="[^"]*"/g, ""); // the preview's marks
      if (fmtSel === "svg") return X.save(svg, `${baseName(id)}.svg`, "image/svg+xml");
      const c = await svgToCanvas(svg, d.px[0], d.px[1]);
      return X.save(await encode(c, fmtSel, d.dpi), `${baseName(id)}_${d.dpi}dpi.${fmtSel}`);
    }
    const canvas = document.createElement("canvas");
    const chart = Ch.render(id, canvas, { w: d.wIn * 96, h: d.hIn * 96, ratio: d.dpi / 96, fontPx: fontPt * 96 / 72, title: T.title, subtitle: T.sub, edit: editCfg });
    if (!chart) return toast("Open the Wind tab once so the chart is drawn, then try again.");
    try { X.save(await encode(canvas, fmtSel, d.dpi), `${baseName(figName(id))}_${d.dpi}dpi.${fmtSel}`); } finally { chart.destroy(); }
  }
  async function saveMap(fmtSel) {
    const j = job, d = dims(), f = j.el.cloneNode(true);
    if (d.px[0] < 50) return toast("Choose a larger size.");
    // the footer as edited, without what was left out or the marks that make it editable
    f.querySelectorAll("[data-sv-gone]").forEach(e => e.remove());
    f.querySelectorAll(".sv-in").forEach(e => { ["contenteditable", "role", "aria-label", "spellcheck"].forEach(a => e.removeAttribute(a)); e.classList.remove("sv-in"); if (!e.classList.length) e.removeAttribute("class"); });
    toast("Making the map image…", 30000);
    const c = await j.compose(d.k, f);
    try {
      const name = j.name(fmtSel);
      X.save(await encode(c, fmtSel, d.dpi), name);
      toast(`Saved ${name}.${j.note || ""}`, j.note ? 9000 : 4000);
    } finally { c.width = 0; }
  }

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

  return { open, close, renderUnits, openFig, openSave, addFig, downloadTable, summary, baseName, csvSave, siteLine, encode };
})();
