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
     maxPx (the most pixels to draw), lay() (a new copy of the layout: the items in the band, the north arrow on the map),
     edge (the items' margin), shares ({ A, wait, none }: the legend's % of area) and addPct(A, root), compose(k, layout)
     (the image at k pixels per CSS pixel, the items as edited where they were placed), name(ext), note (said when saved),
     release() } */
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
    job = null; figId = null; LY = null; drag = null;
    clearTimeout(nudgeT);
    const p = $("#svLay");
    if (p) p.remove();
    $("#svHint").textContent = HINT0;
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
  // the map's height (its band grows and shrinks as its texts and items change) over its width; its height box follows the width
  const aspect = () => (job.H + footH()) / job.W;
  // the band's height under the map as the file will have it (whole pixels of the layout), not scaled by the preview
  const footH = () => (LY ? LY.B : 0);
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
      ? `${px}, ${+d.k.toFixed(2)}× the map on the screen; ${inch} at ${d.dpi} dpi, which is written into the file.${d.capped ? " That is as large as this device can draw it." : ""} The base map's and layers' pictures keep the detail they have on the screen; outlines, the pin, the legend, scale bar, north arrow and texts are drawn sharp at any size, each where it is on the preview.`
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

  /* ---------- the map's preview: its picture, and on it and under it the items to place and edit, scaled together ---------- */
  /* The items (js/mapimage.js): the legend, title, scale bar, north arrow and credits. Each starts in the band under the
     map (the north arrow on the map) and is dragged anywhere on the image by its handle, or by any part that is not a
     text (a finger only by the handle, so the preview still scrolls), or moved with the arrow keys from its handle; it
     snaps to the image's edges, corners and middles. A moved item is pinned at its place in the layout's own pixels (the
     map's size on the screen, and the band), which the file scales as a whole: it lands at the same place at any size or
     DPI. The band grows and shrinks to hold what is in it, and can be turned off, which moves what it held onto the map.
     LY: { band, box (a light box behind items on the map), pct (the legend's % column), B (the band's height), it: key ->
     { show, pin, x, y, w (its width when pinned) } } */
  const stage = $("#svStage"), pvBox = $("#svPv"), xBtn = $("#svX");
  const ITEMS = [["legend", "Legend"], ["title", "Title"], ["scale", "Scale bar"], ["north", "North arrow"], ["credits", "Credits"]];
  const ITEM_NAME = Object.fromEntries(ITEMS), FLOW = ["title", "scale", "credits"]; // the band's second column, in order
  const HINT0 = $("#svHint").textContent;
  const GRIP = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M3 12h18M12 3 9.5 5.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5"/></svg>`;
  let LY = null, drag = null, nudgeT = 0;
  const items = () => (job && job.el ? [...job.el.querySelectorAll(".mi-it")] : []);
  // an item's size in the layout's pixels (offsetWidth is as before its zoom)
  const ow = el => el.offsetWidth * LY.it[el.dataset.it].s, oh = el => el.offsetHeight * LY.it[el.dataset.it].s;
  const itemEl = k => job.el.querySelector(`.mi-it[data-it="${k}"]`);
  const fresh = () => ({ band: true, box: true, pct: !!(job.shares && job.shares.got.length), B: 0,
    it: Object.fromEntries(ITEMS.map(([k]) => [k, k === "north" ? { show: true, pin: true, x: null, y: null, w: 0, s: 1, c: 1, rw: false } : { show: true, pin: false, x: 0, y: 0, w: 0, s: 1, c: 1, rw: false }])) });
  /* per item: s (its scale, 60% to 200%, of its text and symbols), c (the legend's columns, 1 to 3) and rw (the user set its
     width: o.w, in the layout's pixels, is then its width as drawn, whatever the scale; the scale bar and the north arrow have
     no text to reflow, so their handle scales them). Widths are kept in the layout's pixels, which the file scales as a whole. */
  const SMIN = 0.6, SMAX = 2, MINW = { legend: 120, title: 100, scale: 50, credits: 100, north: 30 };
  const clampS = v => Math.min(SMAX, Math.max(SMIN, Math.round(v * 100) / 100));
  const scaleOnly = k => k === "north" || k === "scale";
  // an item's texts made editable, and its handle
  function prepItem(el) {
    [...el.children].forEach(c => { if (!/\bsv-(grip|tb|rz)\b/.test(c.className)) editTree(c); });
    if (el.querySelector(":scope > .sv-grip")) return;
    const g = document.createElement("button"), n = ITEM_NAME[el.dataset.it].toLowerCase();
    g.type = "button"; g.className = "sv-grip"; g.innerHTML = GRIP;
    g.title = `Move the ${n}: drag it, or use the arrow keys`;
    g.setAttribute("aria-label", `Move the ${n}: arrow keys move it, with Shift in larger steps`);
    el.prepend(g);
    const k = el.dataset.it, tb = document.createElement("div"), rz = document.createElement("button");
    tb.className = "sv-tb"; tb.setAttribute("role", "toolbar"); tb.setAttribute("aria-label", `${ITEM_NAME[k]}: size`);
    tb.innerHTML = `<button type="button" data-z="-1" title="Smaller text and symbols (key: -)" aria-label="Smaller">A\u2212</button><button type="button" data-z="1" title="Larger text and symbols (key: +)" aria-label="Larger">A+</button>`
      + (k === "legend" ? `<span class="sv-cols" title="Columns of the legend's classes">${[1, 2, 3].map(c => `<button type="button" data-c="${c}" aria-label="${c} column${c > 1 ? "s" : ""}">${c}</button>`).join("")}</span>` : "");
    rz.type = "button"; rz.className = "sv-rz";
    rz.title = scaleOnly(k) ? `Make the ${n} larger or smaller: drag the corner` : `Change the ${n}'s width: drag the corner (with Shift: its size), or use the left and right arrow keys`;
    rz.setAttribute("aria-label", `${scaleOnly(k) ? "Size" : "Width"} of the ${n}: left and right arrow keys change it`);
    el.append(tb, rz);
  }
  function mountMap() {
    const w = document.createElement("div"), c = job.pv;
    w.className = "sv-map"; w.style.width = `${job.W}px`;
    c.classList.add("sv-art"); c.style.cssText = `display:block;width:${job.W}px;height:${job.H}px`;
    job.el = job.lay();
    LY = fresh();
    items().forEach(prepItem);
    w.append(c, job.el);
    $("#svStage").appendChild(w);
    $("#svHint").textContent = "Drag the legend, title, scale bar, north arrow or credits by its ✥ handle to place it anywhere on the image; drag its corner square to change its width (with Shift: its size), or use A− A+ (and 1, 2, 3 columns for the legend). Click or tap a text to change it; empty it, or use its ×, to leave it out.";
    panel();
    place();
    // shares still measured when the dialog opened: added to the legend when they come, the option then offered
    const j = job;
    if (j.shares && j.shares.wait) j.shares.wait.then(list => {
      if (job !== j) return;
      const lg = itemEl("legend"), got = j.addPct(list);
      j.shares.wait = null;
      if (got.length && lg && j.addPct(got, lg).length) { j.shares.got = got; prepItem(lg); LY.pct = true; } else j.shares.none = true;
      panel(); sizeMap();
    });
  }
  // the layout's position of an item's top left (its box's border edge), whatever the preview's scale
  const posOf = el => { const a = el.getBoundingClientRect(), b = job.el.getBoundingClientRect(), s = job.sc || 1; return { x: (a.left - b.left) / s, y: (a.top - b.top) / s }; };
  // an item with nothing left in it to draw (all its texts left out) is not drawn
  const empty = el => ![...el.querySelectorAll("img, canvas, svg, .sv-in, .lscale")].some(x => !x.closest("[data-sv-gone], .sv-grip"));
  // an item back in the band's flow, at its own place there
  function dock(el) {
    const f = job.el.querySelector(".mi-foot"), meta = f.querySelector(".mi-meta"), k = el.dataset.it;
    if (k === "legend") { if (el.parentElement !== f) f.prepend(el); return; }
    if (el.parentElement === meta) return;
    meta.insertBefore(el, FLOW.slice(FLOW.indexOf(k) + 1).map(x => meta.querySelector(`:scope > [data-it="${x}"]`)).find(Boolean) || null);
  }
  /* the items where the layout says, and the band's height to hold what is in it (at least B0 while an item is moved, so
     the image does not jump under the pointer); returns it */
  function place(B0 = 0) {
    if (!LY || !job || !job.el) return 0;
    const R = job.el, f = R.querySelector(".mi-foot"), H = job.H, W = job.W;
    items().forEach(el => {
      const k = el.dataset.it, o = LY.it[k];
      el.hidden = !o.show;
      if (o.pin) {
        if (el.parentElement !== R) R.appendChild(el);
        el.classList.add("mi-pin");
        const u = o.rw ? o.w / o.s : o.w;
        el.style.width = (o.rw || k === "legend") && o.w ? `${u}px` : "";
        el.style.maxWidth = o.w ? `${u}px` : "";
      } else { dock(el); el.classList.remove("mi-pin"); el.style.cssText = ""; }
      el.style.zoom = o.s !== 1 ? String(o.s) : "";
      el.style.setProperty("--zi", String(1 / o.s));
      if (k === "legend" && o.c > 1) el.dataset.cols = o.c; else delete el.dataset.cols;
      el.classList.toggle("sv-tb-low", o.pin && o.y < 50);
      el.querySelectorAll(":scope > .sv-tb [data-c]").forEach(b => b.classList.toggle("on", +b.dataset.c === o.c));
      if (o.show && empty(el)) el.hidden = true;
    });
    // the north arrow's first place: the map's top right
    const n = LY.it.north, ne = itemEl("north");
    if (ne && n.x === null) { n.x = W - job.edge - ow(ne); n.y = job.edge; }
    items().forEach(el => {
      const o = LY.it[el.dataset.it];
      if (o.pin) { el.style.left = `${o.x}px`; el.style.top = `${o.y}px`; }
      el.classList.toggle("mi-boxed", o.pin && LY.box && o.y < H);
    });
    const lg = itemEl("legend");
    if (lg) lg.classList.toggle("mi-nopct", !LY.pct);
    f.style.minHeight = ""; f.hidden = false;
    const flow = LY.band && [...f.querySelectorAll(".mi-it")].some(e => !e.hidden);
    let B = flow ? f.offsetHeight : 0;
    if (LY.band) items().forEach(el => { const o = LY.it[el.dataset.it]; if (o.pin && !el.hidden && o.y + oh(el) > H) B = Math.max(B, o.y + oh(el) - H + job.edge); });
    B = Math.ceil(Math.max(B, LY.band ? B0 : 0));
    f.hidden = !B;
    f.style.minHeight = `${B}px`;
    R.style.height = `${H + B}px`;
    LY.B = B;
    return B;
  }
  // an item pinned where it is now (once moved); its content stays put as the pinned box's padding is added around it
  function pin(el) {
    const o = LY.it[el.dataset.it];
    if (o.pin) return o;
    const p = posOf(el), w0 = el.dataset.it === "legend" ? el.offsetWidth : el.parentElement.clientWidth;
    o.pin = true; o.x = p.x; o.y = p.y;
    place(LY.B);
    const cs = getComputedStyle(el), n = v => parseFloat(v) || 0;
    o.x = p.x - n(cs.paddingLeft) * o.s; o.y = p.y - n(cs.paddingTop) * o.s; o.w = Math.ceil(w0 + n(cs.paddingLeft) + n(cs.paddingRight));
    place(LY.B);
    return o;
  }
  /* an item moved to x, y (its top left, in the layout's pixels): kept on the image (in the band only while it is on, and
     no lower than the band at the move's start, or deep enough to hold the item), snapped to the edges, the corners and
     the middles when within 8 screen pixels (snap), with a guide line where it snapped */
  function moveTo(el, x, y, snap, B0) {
    const o = LY.it[el.dataset.it], W = job.W, H = job.H, E = job.edge, w = ow(el), h = oh(el);
    const bot = LY.band ? H + Math.max(B0, h + 2 * E) - E : H; // the lowest its bottom can go
    x = Math.min(Math.max(x, 0), Math.max(0, W - w)); y = Math.min(Math.max(y, 0), Math.max(0, bot - h));
    let gx = null, gy = null;
    if (snap) {
      // only places on the image: an item wider than the map less its margins snaps to neither side
      const T = 8 / (job.sc || 1), near = (v, cs, hi) => cs.filter(c => c[0] >= 0 && c[0] <= hi).reduce((b, c) => (Math.abs(v - c[0]) <= T && (!b || Math.abs(v - c[0]) < Math.abs(v - b[0])) ? c : b), null);
      const sx = near(x, [[E, E], [W - E - w, W - E], [(W - w) / 2, W / 2]], W - w);
      const sy = near(y, [[E, E], [H - E - h, H - E], [(H - h) / 2, H / 2], ...(LY.band ? [[H + E, H + E], [bot - h, bot]] : [])], bot - h);
      if (sx) [x, gx] = sx;
      if (sy) [y, gy] = sy;
    }
    o.x = Math.round(x * 10) / 10; o.y = Math.round(y * 10) / 10;
    place(B0);
    frame();
    guides(gx, gy);
  }
  function guides(gx, gy) {
    const st = $("#svStage"), s = job ? job.sc || 1 : 1;
    [["v", gx], ["h", gy]].forEach(([d, v]) => {
      let g = st.querySelector(`.sv-guide.${d}`);
      if (v === null) { if (g) g.remove(); return; }
      if (!g) { g = document.createElement("i"); g.className = `sv-guide ${d}`; st.appendChild(g); }
      g.style.cssText = d === "v" ? `left:${v * s}px` : `top:${v * s}px`;
    });
  }
  // the scale one step (10%) up or down, or the legend's columns, from the toolbar or the keys
  function zoomBy(el, dir) {
    LY.it[el.dataset.it].s = clampS(LY.it[el.dataset.it].s + dir * 0.1);
    sizeMap(); say(el);
  }
  stage.addEventListener("click", e => {
    const b = e.target.closest && e.target.closest(".sv-tb button");
    if (!b || !job || job.kind !== "map" || !LY) return;
    const el = b.closest(".mi-it"), o = LY.it[el.dataset.it];
    if (b.dataset.z) zoomBy(el, +b.dataset.z); else if (b.dataset.c) { o.c = +b.dataset.c; sizeMap(); say(el); }
    b.focus({ preventScroll: true });
  });
  // where an item is, said for a screen reader after it is moved
  function say(el) {
    const o = LY.it[el.dataset.it], b = $("#svLive");
    if (b) b.textContent = `${Math.round(o.s * 100)}% size${el.dataset.it === "legend" ? `, ${o.c} column${o.c > 1 ? "s" : ""}` : ""}. ` + `${ITEM_NAME[el.dataset.it]}: ${Math.round((100 * o.x) / job.W)}% from the left, ${Math.round((100 * o.y) / (job.H + LY.B))}% from the top${o.y < job.H ? ", on the map" : ", under the map"}.`;
  }
  // the preview's size for the layout as it is, at the scale it has (while an item is moved: refitted when it is let go)
  function frame() {
    const st = $("#svStage"), s = job.sc || 1, w = st.firstElementChild;
    w.style.transform = `scale(${s})`; w.style.setProperty("--inv", String(1 / s));
    st.style.width = `${job.W * s}px`; st.style.height = `${(job.H + LY.B) * s}px`;
  }
  function drawMap() {
    if (drag && drag.on) return; // not refitted under the pointer
    const B = place(), s = fitScale(job.W, job.H + B);
    job.sc = s;
    frame();
    showX(act);
  }
  // a text or the layout changed: the image's height follows
  function sizeMap() { place(); fitHeight(); update(); }

  stage.addEventListener("pointerdown", e => {
    if (!job || job.kind !== "map" || !LY || e.button > 0) return;
    const el = e.target.closest(".mi-it"), grip = e.target.closest(".sv-grip");
    if (!el || !job.el.contains(el) || e.target.closest(".sv-tb")) return;
    if (e.target.closest(".sv-rz")) {
      e.preventDefault();
      const k = el.dataset.it, o = pin(el), r = el.getBoundingClientRect();
      drag = { el, id: e.pointerId, sx: e.clientX, sy: e.clientY, B0: LY.B, on: false, rz: true, sc: scaleOnly(k) || e.shiftKey, w0: r.width / (job.sc || 1), s0: o.s };
      try { stage.setPointerCapture(e.pointerId); } catch (x) { /* a pointer already gone */ }
      e.target.closest(".sv-rz").focus({ preventScroll: true });
      return;
    }
    // a text is typed in; a finger moves an item by its handle (elsewhere it scrolls the preview), but the arrow by any part
    if (!grip && (edOf(e.target) || (e.pointerType === "touch" && el.dataset.it !== "north"))) return;
    e.preventDefault();
    drag = { el, id: e.pointerId, sx: e.clientX, sy: e.clientY, B0: LY.B, on: false };
    try { stage.setPointerCapture(e.pointerId); } catch (x) { /* a pointer already gone */ }
    el.querySelector(".sv-grip").focus({ preventScroll: true });
  });
  stage.addEventListener("pointermove", e => {
    if (!drag || e.pointerId !== drag.id) return;
    const s = job.sc || 1, dx = (e.clientX - drag.sx) / s, dy = (e.clientY - drag.sy) / s;
    if (drag.rz) {
      if (!drag.on) { if (Math.abs(dx) * s < 3) return; drag.on = true; drag.el.classList.add("sv-drag"); showX(null); }
      resizeTo(drag.el, drag, dx);
      return;
    }
    if (!drag.on) {
      if (Math.hypot(dx, dy) * s < 3) return;
      drag.on = true;
      const o = pin(drag.el);
      drag.x0 = o.x; drag.y0 = o.y;
      drag.el.classList.add("sv-drag");
      showX(null);
    }
    moveTo(drag.el, drag.x0 + dx, drag.y0 + dy, true, drag.B0);
  });
  // an item's width (or, for a scale-only item or with Shift, its scale) from the drag's start, dx layout pixels on
  function resizeTo(el, d, dx) {
    const k = el.dataset.it, o = LY.it[k], w = Math.max(MINW[k], Math.min(d.w0 + dx, Math.max(MINW[k], job.W - o.x)));
    if (d.sc) o.s = clampS(d.s0 * w / d.w0); else { o.rw = true; o.w = Math.round(w * 10) / 10; }
    place(d.B0);
    frame();
  }
  const dragEnd = e => {
    if (!drag || (e.pointerId !== undefined && e.pointerId !== drag.id)) return;
    const d = drag;
    drag = null;
    guides(null, null);
    d.el.classList.remove("sv-drag");
    if (d.on) { sizeMap(); say(d.el); }
    // the handle keeps the focus (an item taken out of the band's flow loses it as it moves), for the arrow keys next
    const g = d.el.querySelector(d.rz ? ".sv-rz" : ".sv-grip");
    if (g && document.activeElement !== g && d.el.isConnected) g.focus({ preventScroll: true });
  };
  ["pointerup", "pointercancel", "lostpointercapture"].forEach(ev => stage.addEventListener(ev, dragEnd));
  // the arrow keys on an item's handle: a step of one pixel of the layout, ten with Shift
  stage.addEventListener("keydown", e => {
    const g = e.target.closest && e.target.closest(".sv-grip"), d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!job || job.kind !== "map" || !LY) return;
    const rz = e.target.closest && e.target.closest(".sv-rz"), zk = g && { "+": 1, "=": 1, "-": -1, "_": -1 }[e.key];
    if (zk) { e.preventDefault(); zoomBy(g.closest(".mi-it"), zk); return; }
    if (rz && d && d[0]) {
      e.preventDefault();
      const el = rz.closest(".mi-it"), k = el.dataset.it, o = pin(el), w0 = el.getBoundingClientRect().width / (job.sc || 1);
      resizeTo(el, { w0, s0: o.s, sc: scaleOnly(k), B0: LY.B }, d[0] * (e.shiftKey ? 40 : 4));
      rz.focus({ preventScroll: true });
      clearTimeout(nudgeT);
      nudgeT = setTimeout(() => { if (job && job.el && job.el.contains(el)) { sizeMap(); say(el); } }, 300);
      return;
    }
    if (!g || !d) return;
    e.preventDefault();
    const el = g.closest(".mi-it"), o = pin(el), k = e.shiftKey ? 10 : 1;
    moveTo(el, o.x + d[0] * k, o.y + d[1] * k, false, LY.B);
    g.focus({ preventScroll: true });
    clearTimeout(nudgeT);
    nudgeT = setTimeout(() => { if (job && job.el && job.el.contains(el)) { sizeMap(); say(el); } }, 300);
  });

  /* the layout's options, beside the size and format: each item shown or not, the legend's % column, the light box, the
     band, and the layout as it started */
  function panel() {
    let p = $("#svLay");
    if (!p) {
      p = document.createElement("div"); p.id = "svLay"; p.className = "sv-lay";
      $("#figSheet .sv-side").appendChild(p);
      p.addEventListener("change", onPanel);
      p.addEventListener("click", e => { if (e.target.closest("#svLayReset")) resetLayout(); });
    }
    const S = job.shares || {}, ok = !!(S.got && S.got.length), why = ok ? job.pctNote(S.got[0].A).replace(/\.$/, "") : S.wait ? "Measuring each class's share of the map…" : "Not available for this map";
    p.innerHTML = `<h4>Layout</h4><div class="sv-its">${ITEMS.filter(([k]) => itemEl(k)).map(([k, n]) => `<label class="toggle"><input type="checkbox" data-show="${k}"${LY.it[k].show ? " checked" : ""}><span>${n}</span></label>`).join("")}</div>
      ${itemEl("legend") ? `<label class="toggle"><input type="checkbox" id="svPct"${ok && LY.pct ? " checked" : ""}${ok ? "" : " disabled"}><span>Show % of area for each class<small>${esc(why)}</small></span></label>` : ""}
      <label class="toggle"><input type="checkbox" id="svBox"${LY.box ? " checked" : ""}><span>Light box behind items on the map</span></label>
      <label class="toggle"><input type="checkbox" id="svBand"${LY.band ? " checked" : ""}><span>White band under the map<small>Off: everything sits on the map</small></span></label>
      <button type="button" class="btn small" id="svLayReset">Reset layout</button>
      <p class="sv-live" id="svLive" aria-live="polite"></p>`;
  }
  function onPanel(e) {
    const t = e.target;
    if (!job || job.kind !== "map" || !LY) return;
    if (t.dataset.show) LY.it[t.dataset.show].show = t.checked;
    else if (t.id === "svPct") LY.pct = t.checked;
    else if (t.id === "svBox") LY.box = t.checked;
    else if (t.id === "svBand") { if (t.checked) LY.band = true; else ontoMap(); }
    sizeMap();
  }
  /* the band turned off: what it held is placed on the map, each a little narrower than in the band, at the first place
     free of what is on the map already: the title at the top left, the legend at the bottom left, the credits and the
     scale bar at the bottom right, else another corner, else just above, under or beside an item placed */
  const PREF = { title: ["tl", "tr", "bl", "br"], legend: ["bl", "tl", "br", "tr"], credits: ["br", "bl", "tr", "tl"], scale: ["br", "bl", "tr", "tl"], north: ["tr", "tl", "br", "bl"] };
  function ontoMap() {
    const W = job.W, H = job.H, E = job.edge, keys = [];
    // pinned where they are while the band still holds them, then the band goes
    items().forEach(el => { const o = LY.it[el.dataset.it]; if (!o.pin || o.y + oh(el) > H) { keys.push(el.dataset.it); pin(el); } });
    LY.band = false;
    const cap = { legend: Math.max(220, W * 0.45), credits: Math.max(200, W * 0.5), title: W - 3 * E - 40 };
    keys.forEach(k => { const o = LY.it[k]; if (cap[k]) o.w = Math.round(Math.min(o.w, cap[k])); });
    place();
    const boxOf = el => ({ x: LY.it[el.dataset.it].x, y: LY.it[el.dataset.it].y, w: ow(el), h: oh(el) });
    const on = items().filter(el => !el.hidden && !keys.includes(el.dataset.it)).map(boxOf), G = 4;
    const hits = (a, b) => a.x < b.x + b.w + G && b.x < a.x + a.w + G && a.y < b.y + b.h + G && b.y < a.y + a.h + G;
    ["north", "title", "legend", "credits", "scale"].filter(k => keys.includes(k)).forEach(k => {
      const el = itemEl(k), o = LY.it[k], w = ow(el), h = oh(el);
      if (el.hidden) { o.x = E; o.y = Math.max(0, H - E - h); return; } // placed when shown again: moved from there
      const corner = { tl: [E, E], tr: [W - E - w, E], bl: [E, H - E - h], br: [W - E - w, H - E - h] };
      const next = on.slice().reverse().flatMap(p => [[p.x + p.w - w, p.y - G - h], [p.x, p.y - G - h], [p.x, p.y + p.h + G], [p.x + p.w + G, p.y + p.h - h], [p.x - G - w, p.y + p.h - h]]);
      const all = [...PREF[k].map(c => corner[c]), ...next], fits = ([x, y]) => x >= 0 && y >= 0 && x + w <= W && y + h <= H && !on.some(p => hits({ x, y, w, h }, p));
      const [x, y] = all.find(fits) || corner[PREF[k][0]];
      o.x = Math.max(0, x); o.y = Math.max(0, y);
      on.push({ x: o.x, y: o.y, w, h });
    });
    keys.forEach(k => { const el = itemEl(k); if (el) moveTo(el, LY.it[k].x, LY.it[k].y, false, 0); });
  }
  function resetLayout() {
    if (!job || job.kind !== "map") return;
    LY = fresh();
    panel(); sizeMap();
    $("#svLayReset").focus({ preventScroll: true });
  }
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
      // up to the item it is in, which is not drawn once nothing in it is left (place)
      for (let p = t.parentElement; p && p !== job.el && !p.classList.contains("mi-it") && !p.innerText.trim() && !p.querySelector("img, canvas, svg"); p = p.parentElement) { hide(p); hid.push(p); }
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
    // the map's items get their first texts back where they are now (the layout is reset on its own)
    if (job.kind === "map") {
      const n = job.lay();
      items().forEach(el => { const t = n.querySelector(`.mi-it[data-it="${el.dataset.it}"]`); if (t) { el.replaceChildren(...t.childNodes); prepItem(el); } });
      sizeMap();
    }
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
    place();
    const j = job, d = dims(), f = j.el.cloneNode(true);
    if (d.px[0] < 50) return toast("Choose a larger size.");
    // the layout as edited and placed, without what was left out or hidden, the handles, or the marks that make it editable
    f.querySelectorAll("[data-sv-gone], .mi-it[hidden], .sv-grip, .sv-tb, .sv-rz").forEach(e => e.remove());
    f.querySelectorAll(".sv-drag").forEach(e => e.classList.remove("sv-drag"));
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
