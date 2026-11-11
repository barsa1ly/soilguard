/* The data sheet's preview: what a download will hold, drawn before anything is saved. It is given what the writers
   were given (weather, soil, wind series) and the files they wrote, so it shows those, not a second reading of the
   data. Charts go through WG.charts, so they can be downloaded like the others. */
WG.preview = (function () {
  const { $, esc, fmt, MONTHS } = WG.util;
  const UN = WG.units, Ch = WG.charts, D = WG.downloads, Wd = WG.wind, U = WG.writerUtil, C = Ch.C, ok = U.ok;
  const ICON = `<svg viewBox="0 0 24 24"><path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/></svg>`;
  const STEP_NAME = { day: "Day", month: "Month", year: "Year" }, MEAN_NAME = { month: "monthly mean", year: "yearly mean" };
  const FILLED = "rgba(217,119,47,.5)", GAPLESS = ["dssat", "apsim", "aquacrop"];
  /* what the weather tab can draw: sums over a step for rain and ET0 (of the days with data), means for the rest */
  const WX = [
    { id: "prcp", name: "Rain", q: "precip", sum: true, lines: [["prcp", "Rain", C.blue]] },
    { id: "temp", name: "Temperature", q: "temp", lines: [["tmax", "Tmax", C.red], ["tmin", "Tmin", C.blue]] },
    { id: "srad", name: "Solar radiation", q: "solar", zero: true, lines: [["srad", "Solar radiation", C.orange]] },
    { id: "rh", name: "Relative humidity", unit: "%", zero: true, lines: [["rh", "Relative humidity", C.green]] },
    { id: "tdew", name: "Dew point", q: "temp", lines: [["tdew", "Dew point", C.green]] },
    { id: "wind", name: "Wind", q: "wind", zero: true, lines: [["wind10", "Wind at 10 m", C.ink]] },
    { id: "et0", name: "Grass ET₀", q: "precip", sum: true, lines: [["et0", "Grass ET₀", C.orange]] },
  ];
  /* what the soil tab can draw for one model's layers, each card with the lines its file holds (title: the card's
     name from those lines) */
  const SOIL = [
    { name: "Sand, silt and clay", unit: "%", stack: true, lines: [["sand", "Sand", "#d9b36c"], ["silt", "Silt", "#a98a62"], ["clay", "Clay", "#6f4f37"]] },
    { title: ls => `Water: ${ls.map(l => l[1].toLowerCase()).join(", ")}`, unit: "cm³/cm³", d: 3,
      lines: [["ll", "Wilting point", C.orange], ["dul", "Field capacity", C.blue], ["sat", "Saturation", "#7fb0d6"], ["awc", "Available water", C.green]] },
    { title: ls => ls.map((l, i) => (i ? l[1].toLowerCase() : l[1])).join(" and "), unit: "%", lines: [["om", "Organic matter", C.green], ["oc", "Organic carbon", C.ink]] },
    { name: "Bulk density", unit: "g/cm³", lines: [["bd", "Bulk density", C.ink]] },
    { name: "Saturated conductivity", q: "ksat", per: 1 / 3.6, d: 3, lines: [["ksat", "Ksat", C.blue]] },
    { name: "pH", unit: "", lines: [["ph", "pH", C.red]] },
  ];
  const view = { tab: "weather", step: null, as: "auto", filled: false, gap: null, off: {}, model: null, file: null };
  let job = null, box = null, ids = [];

  const rd = (v, d = 2) => (Number.isFinite(v) ? +v.toFixed(d) : null);
  const inUnits = (x, v, d) => (ok(v) ? rd(x.q ? UN.conv(x.q, v * (x.per || 1)) : v, d ?? x.d ?? 2) : null);
  const unitOf = x => (x.q ? UN.sym(x.q) : x.unit);
  const seg = (set, opts, on) => `<div class="seg" data-pv-set="${set}">${opts.map(([v, n]) => `<button data-v="${v}" class="${on === v ? "on" : ""}">${esc(n)}</button>`).join("")}</div>`;
  const drawAs = () => `<span class="pv-lab">Draw as</span>${seg("as", [["auto", "Auto"], ["line", "Lines"], ["bar", "Bars"]], view.as)}`;
  const siteOf = () => {
    const s = job.ctx.site;
    return `${s.name ? `${s.name} · ` : ""}${s.lat.toFixed(4)}, ${s.lon.toFixed(4)}`;
  };

  /* a chart's card; the chart is drawn once the card is on the page */
  const pending = [];
  function card(title, build, height, fig) {
    const id = `pvChart${ids.length}`;
    ids.push(id);
    pending.push(() => { D.addFig(id, { own: true, title, file: fig.file || `preview_${ids.indexOf(id) + 1}`, x: fig.x, sub: fig.sub, table: fig.table }); Ch.draw(id, build); });
    return `<div class="pv-card"><div class="card-h"><h5>${esc(title)}</h5><button class="dl-btn" data-fig="${id}" title="Download this figure or its data" aria-label="Download ${esc(title)}">${ICON}</button></div>
      <div class="chart-box" style="height:${height}px"><canvas id="${id}"></canvas></div></div>`;
  }
  const flush = () => { pending.splice(0).forEach(f => f()); };
  const lineStyle = (color, n) => ({ borderColor: color, backgroundColor: color, borderWidth: n > 100 ? 1.25 : 1.75, pointRadius: n > 100 ? 0 : 2, pointHoverRadius: 3, tension: 0 });
  const legend = show => ({ display: show, position: "bottom" });

  /* ---------- weather ---------- */
  // the days of the series in steps: labels, and the step each day falls in
  function buckets(days, step) {
    const cut = { day: 10, month: 7, year: 4 }[step], labels = [], at = [], total = [], seen = new Map();
    days.forEach(d => {
      const k = Wd.isoDay(d).slice(0, cut);
      if (!seen.has(k)) { seen.set(k, labels.length); labels.push(k); total.push(0); }
      at.push(seen.get(k)); total[seen.get(k)]++;
    });
    return { labels, at, total };
  }
  function perStep(vals, B, how) {
    const s = new Array(B.labels.length).fill(null), n = new Array(B.labels.length).fill(0);
    (vals || []).forEach((v, i) => {
      if (!ok(v)) return;
      const k = B.at[i];
      n[k]++;
      s[k] = s[k] === null ? v : how === "max" ? Math.max(s[k], v) : s[k] + v;
    });
    return { v: how === "mean" ? s.map((x, k) => (x === null ? null : x / n[k])) : s, n };
  }
  /* the gap-free copy that the chosen one of DSSAT, APSIM and AquaCrop gets, from its writer's own function (c.holds:
     the daily variables its files hold), on the days of the series; null without one */
  const gapModels = () => job.models.filter(m => GAPLESS.includes(m));
  function gapFree(wx) {
    const ms = gapModels();
    if (!ms.length) return null;
    if (!ms.includes(view.gap)) view.gap = ms[0];
    const kept = job.gapFree || (job.gapFree = {});
    if (!(view.gap in kept)) { kept[view.gap] = null; try { kept[view.gap] = U.gapFree(view.gap, wx); } catch (e) { /* no Tmax and Tmin */ } }
    return kept[view.gap];
  }
  const onDays = (c, k, days) => {
    const ix = new Map(c.days.map((d, i) => [d, i]));
    return days.map(d => (ix.has(d) && c[k] ? c[k][ix.get(d)] : null));
  };
  function weatherTab(el) {
    const wx = job.clean || (job.clean = U.clean(job.ctx.wx)), n = wx.days.length, c = gapFree(wx);
    if (!view.step) view.step = n <= 400 ? "day" : n <= 4400 ? "month" : "year";
    // the overlay is offered when the copy differs from the series (days filled or cut at either end), or to choose between models,
    // and drawn only while it is offered
    const ms = gapModels(), done = c ? c.completed || {} : {}, anyFill = !!c && (ms.length > 1 || Object.keys(done).some(k => c.holds.includes(U.filledVar(k))) || c.cut.head + c.cut.tail > 0);
    const step = view.step, B = buckets(wx.days, step), filled = view.filled && anyFill, shown = step === "day" ? n : B.labels.length;
    const holds = k => !!c && c.holds.includes(k), gapName = c ? job.names[view.gap] : "";
    const hasAny = k => wx[k] && wx[k].some(ok);
    const vars = WX.filter(v => v.lines.some(([k]) => hasAny(k)));
    const source = wx.source === "gridmet" ? "gridMET" : wx.source === "power" ? "NASA POWER" : wx.source === "prism" ? `PRISM${wx.rest ? ` with ${wx.rest}` : ""}` : String(wx.source || "").replace(/^file /, "");
    const span = `${source} · ${Wd.dayLabel(wx.days[0])} – ${Wd.dayLabel(wx.days[n - 1])}`;
    const cards = vars.filter(v => !view.off[v.id]).map(v => {
      const how = v.sum ? "sum" : "mean", kind = view.as === "auto" ? (v.sum ? "bar" : "line") : view.as, u = unitOf(v);
      const lines = v.lines.map(([k, label, color]) => (filled && k === "wind10" && holds("wind2") ? ["wind2", "Wind at 2 m", color] : [k, label, color]));
      const axis = v.sum ? `${u} per ${step}` : step === "day" ? u : `${u}, ${MEAN_NAME[step]}`;
      const build = () => {
        const ds = [];
        lines.forEach(([k, label, color]) => {
          const p = perStep(wx[k], B, how);
          ds.push({ label, data: p.v.map(x => inUnits(v, x)), order: 1, grouped: !filled, ...lineStyle(color, shown), ...(shown > 60 && kind === "bar" ? { barPercentage: 1, categoryPercentage: 1 } : { borderRadius: 2 }), _n: p.n });
          if (filled && c[k] && holds(k)) {
            ds.push({ label: `${label}, in the ${gapName} files`, data: perStep(onDays(c, k, wx.days), B, how).v.map(x => inUnits(v, x)), order: 2, grouped: false, ...lineStyle(FILLED, shown), pointRadius: 0, borderWidth: 2, ...(shown > 60 && kind === "bar" ? { barPercentage: 1, categoryPercentage: 1 } : {}) });
          }
        });
        return { type: kind, data: { labels: B.labels, datasets: ds },
          options: { maintainAspectRatio: false, animation: false, interaction: { mode: "index", intersect: false },
            plugins: { legend: legend(ds.length > 1), tooltip: { callbacks: { afterBody: items => {
              const it = items.find(i => i.dataset._n), i = it ? it.dataIndex : -1;
              return i >= 0 && B.total[i] > 1 ? `${it.dataset._n[i]} of ${B.total[i]} days have data` : "";
            } } } },
            scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 14, maxTicksLimit: 8 } }, y: { beginAtZero: !!(v.sum || v.zero), title: { display: true, text: axis } } } } };
      };
      return card(`${v.name}, ${step === "day" ? "daily" : step === "month" ? "by month" : "by year"}`, build, 170, { x: "Date", sub: `${siteOf()} · ${span}`, file: `preview_${v.id}_${step}` });
    });
    // the same numbers as a table: days with data, gaps, range, and the days the chosen model's gap-free copy fills, of what its files hold
    const fillCount = { tmax: "tmax", tmin: "tmin", prcp: "prcp", srad: "srad", tdew: "tdew", wind10: "wind2", et0: "et0" };
    const filledOf = k => { const f = fillCount[k]; return f && holds(f) ? ((done[f] || 0) + (done[`${f}Month`] || 0)).toLocaleString() : "–"; };
    const rows = WX.flatMap(v => v.lines.map(([k, label]) => {
      const a = (wx[k] || []).filter(ok), u = unitOf(v), f = x => (a.length ? fmt(inUnits(v, x), 2) : "–"), tot = a.reduce((s, x) => s + x, 0);
      const lo = a.reduce((m, x) => Math.min(m, x), Infinity), hi = a.reduce((m, x) => Math.max(m, x), -Infinity);
      const total = v.sum && a.length ? `${fmt(inUnits(v, tot), 1)}${n >= 730 ? ` (${fmt(inUnits(v, (tot * 365.25) / a.length), 1)} a year)` : ""}` : "";
      return `<tr><td>${esc(label)}${u ? ` <small>${esc(u)}</small>` : ""}</td><td>${a.length.toLocaleString()}</td><td>${(n - a.length).toLocaleString()}</td>`
        + `<td>${f(lo)}</td><td>${f(tot / (a.length || 1))}</td><td>${f(hi)}</td><td>${total}</td>`
        + `${c ? `<td>${filledOf(k)}</td>` : ""}</tr>`;
    }));
    const gapPick = ms.length > 1 ? `<label class="pv-lab"><select id="pvGap" aria-label="Model whose gap-free copy is shown">${ms.map(m => `<option value="${m}" ${m === view.gap ? "selected" : ""}>${esc(job.names[m])}</option>`).join("")}</select></label>` : "";
    el.innerHTML = `<p class="fine">${esc(span)}: ${n.toLocaleString()} days, as they go into the files. A break in a line is a day without data.</p>
      <div class="pv-tools"><span class="pv-lab">Step</span>${seg("step", Object.entries(STEP_NAME), step)}${drawAs()}</div>
      <div class="pv-vars">${vars.map(v => `<label><input type="checkbox" data-pv-var="${v.id}" ${view.off[v.id] ? "" : "checked"}> ${esc(v.name)}</label>`).join("")}</div>
      ${anyFill ? `<div class="pv-vars"><label><input type="checkbox" id="pvFilled" ${filled ? "checked" : ""}> Also show, in orange, the gap-free copy in the ${gapPick ? "files of" : `${esc(gapName)} files`}</label>${gapPick}</div>` : ""}
      <div class="pv-grid">${cards.join("") || `<p class="fine">Tick something to draw.</p>`}</div>
      <div class="table-wrap"><table class="grid pv-table"><thead><tr><th>Daily values</th><th>Days with data</th><th>Missing</th><th>Lowest</th><th>Mean</th><th>Highest</th><th>Total</th>${c ? `<th>Filled in the ${esc(gapName)} files <small>(– not in them)</small></th>` : ""}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
  }

  /* ---------- soil ---------- */
  const depth = v => +UN.conv("depth", v).toFixed({ in: 2, cm: 1, mm: 0 }[UN.sym("depth")] ?? 1); // as in the depth box: 2.5 cm is not 3
  function soilCard(x, L, kindAuto) {
    const kind = view.as === "auto" ? kindAuto : view.as, u = unitOf(x), lines = x.lines.filter(([k]) => L.some(l => ok(l[k])));
    if (!lines.length) return "";
    const title = x.title ? x.title(lines) : x.name, du = UN.sym("depth"), labels = L.map(l => `${depth(l.top)}–${depth(l.bot)}`), xTitle = u || title;
    const build = () => {
      if (kind === "bar") {
        return { type: "bar", data: { labels, datasets: lines.map(([k, label, color]) => ({ label, data: L.map(l => inUnits(x, l[k])), backgroundColor: color, borderColor: color, ...(x.stack ? { stack: "s" } : {}) })) },
          options: { indexAxis: "y", maintainAspectRatio: false, animation: false, interaction: { mode: "index", axis: "y", intersect: false }, plugins: { legend: legend(lines.length > 1) },
            scales: { x: { stacked: !!x.stack, beginAtZero: true, ...(x.stack ? { max: 100 } : {}), position: "top", title: { display: !!xTitle, text: xTitle } }, y: { stacked: !!x.stack, grid: { display: false }, title: { display: true, text: `Depth (${du})` } } } } };
      }
      // the profile with depth to scale: each layer's value holds from its top to its bottom
      const pts = k => L.flatMap(l => (ok(l[k]) ? [{ x: inUnits(x, l[k]), y: rd(UN.conv("depth", l.top), 2) }, { x: inUnits(x, l[k]), y: rd(UN.conv("depth", l.bot), 2) }] : [{ x: null, y: null }]));
      return { type: "scatter", data: { datasets: lines.map(([k, label, color]) => ({ label, data: pts(k), showLine: true, ...lineStyle(color, 0), pointRadius: 0, spanGaps: false })) },
        options: { maintainAspectRatio: false, animation: false, interaction: { mode: "nearest", axis: "y", intersect: false },
          plugins: { legend: legend(lines.length > 1), tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.parsed.x}${u ? ` ${u}` : ""} at ${c.parsed.y} ${du}` } } },
          scales: { x: { position: "top", beginAtZero: !!x.stack, title: { display: !!xTitle, text: xTitle } }, y: { reverse: true, min: 0, title: { display: true, text: `Depth (${du})` } } } } };
    };
    const table = () => ({ header: [`Layer (${du})`, ...lines.map(([, label]) => `${label}${u ? ` (${u})` : ""}`)], rows: L.map((l, i) => [labels[i], ...lines.map(([k]) => inUnits(x, l[k]))]) });
    const name = (job.names[view.model] || "soil table").split(" ")[0];
    return card(title, build, kind === "bar" ? Math.max(170, 56 + (x.stack ? 18 : 12 * lines.length + 6) * L.length) : 200, { sub: `${siteOf()} · ${job.ctx.soil.name} · ${view.model === "table" ? "soil table" : `layers of the ${name} file`}`, table, file: `preview_soil_${view.model}` });
  }
  function soilTab(el) {
    const s = job.ctx.soil, sets = job.models.filter(m => m !== "csv").map(m => [m, job.names[m]]);
    if (job.models.includes("csv") || job.series.includes("soil")) sets.push(["table", "Plain CSV and soil table"]);
    if (!sets.some(x => x[0] === view.model)) view.model = sets[0][0];
    // a model's layers with the values its file holds, from its writer (the table: the layers as they are)
    let L = null, why = "";
    try { L = view.model === "table" ? s.layers : U.writtenLayers(view.model, s); } catch (e) { why = e.message; }
    if (!L || !L.length) { el.innerHTML = `<p class="fine">No layers to show: ${esc(why || "the soil has none")}.</p>`; return; }
    const cards = SOIL.map(x => soilCard(x, L, x.stack ? "bar" : "line")).join("");
    const du = UN.sym("depth"), cell = (x, k, l) => { const v = inUnits(x, l[k]); return v === null ? "–" : v.toLocaleString(undefined, { maximumFractionDigits: x.d ?? 2 }); };
    // the columns the file holds
    const MORE = { unit: "%", d: 1 }, cols = [...SOIL.flatMap(x => x.lines.map(([k, label]) => [x, k, label])), [MORE, "caco3", "CaCO₃"], [{ ...MORE, unit: "% volume" }, "cfVol", "Coarse fragments"],
      [{ ...MORE, unit: "% weight" }, "cfWt", "Coarse fragments"]].filter(([, k]) => L.some(l => ok(l[k])));
    const rows = L.map(l => `<tr><td>${depth(l.top)}–${depth(l.bot)}</td>${cols.map(([x, k]) => `<td>${cell(x, k, l)}</td>`).join("")}</tr>`).join("");
    el.innerHTML = `<p class="fine">${esc(s.name)}, ${esc(s.source)}.</p>
      <div class="pv-tools"><label class="pv-lab">Layers as written for <select id="pvModel">${sets.map(([k, n]) => `<option value="${k}" ${k === view.model ? "selected" : ""}>${esc(n)}</option>`).join("")}</select></label>${drawAs()}</div>
      <p class="fine">${L.length} layer${L.length > 1 ? "s" : ""}, ${depth(L[0].top)} to ${depth(L[L.length - 1].bot)} ${esc(du)}${view.model === "table" ? "" : `, with the values the ${esc(job.names[view.model])} file holds`}.</p>
      <div class="pv-grid">${cards}</div>
      <div class="table-wrap"><table class="grid pv-table"><thead><tr><th>Layer <small>${esc(du)}</small></th>${cols.map(([x, , label]) => `<th>${esc(label)}${unitOf(x) ? ` <small>${esc(unitOf(x))}</small>` : ""}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  /* ---------- wind ---------- */
  const wantsWind = () => job.series.some(k => ["hourly", "monthly", "annual"].includes(k)) || (!!job.ctx.wx && job.models.some(m => m === "epic" || m === "apex"));
  // the hourly series by local day, also the days without data
  function windDays(raw) {
    if (job.windDays) return job.windDays;
    const H = raw.hourly, P = raw.period, off = raw.offset || 0, sum = new Map(), peak = new Map(), n = new Map();
    let first = Infinity, last = -Infinity;
    H.t.forEach((t, i) => {
      if (P && (t < P.t0 || t >= P.t1)) return;
      const d = Math.floor((t + off) / 86400), v = H.ws[i];
      first = Math.min(first, d); last = Math.max(last, d);
      if (!Number.isFinite(v)) return;
      sum.set(d, (sum.get(d) || 0) + v); peak.set(d, Math.max(peak.get(d) ?? -Infinity, v)); n.set(d, (n.get(d) || 0) + 1);
    });
    const days = [];
    for (let d = first; d <= last; d++) days.push(d);
    return (job.windDays = { days, mean: days.map(d => (n.get(d) ? sum.get(d) / n.get(d) : null)), max: days.map(d => (n.has(d) ? peak.get(d) : null)), hours: [...n.values()].reduce((a, b) => a + b, 0) });
  }
  function windTab(el) {
    const raw = job.ctx.wind && job.ctx.wind.raw, a = job.ctx.analysis, W = { q: "wind" }, cards = [], ws = UN.sym("wind");
    const notes = [];
    let tools = drawAs();
    if (raw) {
      const d = windDays(raw);
      if (!view.step) view.step = d.days.length <= 400 ? "day" : d.days.length <= 4400 ? "month" : "year";
      const step = view.step, B = buckets(d.days, step), shown = B.labels.length, kind = view.as === "bar" ? "bar" : "line", mean = perStep(d.mean, B, "mean"), peak = perStep(d.max, B, "max");
      tools = `<span class="pv-lab">Step</span>${seg("step", Object.entries(STEP_NAME), step)}${tools}`;
      notes.push(`The hourly series: ${d.hours.toLocaleString()} hours, ${Wd.dayLabel(d.days[0])} – ${Wd.dayLabel(d.days[d.days.length - 1])}.`);
      cards.push(card(`Wind at 10 m from the hourly series, ${step === "day" ? "daily" : step === "month" ? "by month" : "by year"}`, () => ({ type: kind,
        data: { labels: B.labels, datasets: [{ label: `Mean (${ws})`, data: mean.v.map(x => inUnits(W, x)), order: 1, ...lineStyle(C.ink, shown), ...(kind === "bar" ? { grouped: false } : {}) },
          { label: `Highest hour (${ws})`, data: peak.v.map(x => inUnits(W, x)), order: 2, ...lineStyle(kind === "bar" ? "rgba(217,119,47,.45)" : C.orange, shown), ...(kind === "bar" ? { grouped: false } : {}) }] },
        options: { maintainAspectRatio: false, animation: false, interaction: { mode: "index", intersect: false }, plugins: { legend: legend(true) },
          scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 14, maxTicksLimit: 8 } }, y: { beginAtZero: true, title: { display: true, text: ws } } } } }), 190, { x: "Date", sub: `${siteOf()} · ${D.siteLine()}`, file: `preview_wind_${step}` }));
    } else notes.push(`No hourly series: ${job.ctx.windWhy}.`);
    if (a) {
      const lab = `hours per year ≥ ${fmt(UN.conv("wind", a.thr), ["m/s", "kn"].includes(ws) ? 1 : 0)} ${ws}`, kind = view.as === "line" ? "line" : "bar", n = v => (ok(v) ? rd(v, 1) : null);
      cards.push(card("Erosive wind hours and mean wind by month", () => ({ data: { labels: MONTHS, datasets: [
        { type: kind, label: "Erosive wind hours", data: a.months.map(m => n(m.eroHours)), ...lineStyle(view.as === "line" ? C.red : "rgba(200,55,45,.7)", 0), yAxisID: "y", order: 2 },
        { type: "line", label: `Mean wind (${ws})`, data: a.months.map(m => inUnits(W, m.mean)), ...lineStyle(C.ink, 0), yAxisID: "y1", order: 1 }] },
      options: { maintainAspectRatio: false, animation: false, interaction: { mode: "index", intersect: false }, plugins: { legend: legend(true) },
        scales: { x: { grid: { display: false } }, y: { beginAtZero: true, title: { display: true, text: lab } }, y1: { position: "right", beginAtZero: true, grid: { display: false }, title: { display: true, text: ws } } } } }), 200, { x: "Month", sub: `${siteOf()} · ${D.siteLine()}`, file: "preview_wind_monthly" }));
      if (a.annual && a.annual.length) cards.push(card("Erosive wind hours by year", () => ({ type: kind, data: { labels: a.annual.map(r => r.year), datasets: [{ label: "Erosive wind hours", data: a.annual.map(r => rd(r.eroHours, 0)), ...lineStyle(C.amber, 0), borderRadius: 3 }] },
        options: { maintainAspectRatio: false, animation: false, plugins: { legend: legend(false), tooltip: { callbacks: { afterBody: items => { const r = a.annual[items[0].dataIndex]; return r && !r.complete ? `Partial year: ${fmt(r.cov * 100, 0)}% of its hours, scaled to a year` : ""; } } } },
          scales: { x: { grid: { display: false } }, y: { beginAtZero: true, title: { display: true, text: lab } } } } }), 180, { x: "Year", sub: `${siteOf()} · ${D.siteLine()}`, file: "preview_wind_annual" }));
    } else notes.push(`No monthly or annual summary: ${job.ctx.analysisWhy}.`);
    el.innerHTML = `<p class="fine">${notes.map(esc).join(" ")} This is the series in use on the Wind tab: change its period or model there.</p>
      <div class="pv-tools">${tools}</div><div class="pv-grid">${cards.join("")}</div>`;
  }

  /* ---------- the files themselves ---------- */
  const SHOW_LINES = 60;
  const size = n => (n < 1e3 ? `${n} bytes` : n < 1e6 ? `${fmt(n / 1e3, 1)} kB` : `${fmt(n / 1e6, 1)} MB`);
  function filesTab(el) {
    const F = job.files, groups = new Map();
    F.forEach(f => { const g = f.name.includes("/") ? f.name.slice(0, f.name.lastIndexOf("/")) : "The zip's top level"; groups.set(g, [...(groups.get(g) || []), f]); });
    if (!F.some(f => f.name === view.file)) view.file = "README.txt";
    const f = F.find(x => x.name === view.file) || F[0], lines = String(f.text).replace(/^﻿/, "").split(/\r?\n/, SHOW_LINES + 1);
    const more = lines.length > SHOW_LINES;
    el.innerHTML = `<p class="fine">${F.length} files, about ${size(F.reduce((a, x) => a + String(x.text).length, 0))} before zipping.</p>
      ${job.failed.length ? `<div class="pv-list warn"><b>Will not be written</b><ul>${job.failed.map(x => `<li>${esc(x.what)}: ${esc(x.why)}</li>`).join("")}</ul></div>` : ""}
      ${job.notes.length ? `<div class="pv-list"><b>Notes from the model files</b><ul>${job.notes.map(n => `<li>${esc(n)}</li>`).join("")}</ul></div>` : ""}
      <div class="pv-tools"><label class="pv-lab">File <select id="pvFile">${[...groups].map(([g, list]) => `<optgroup label="${esc(g)}">${list.map(x => `<option value="${esc(x.name)}" ${x === f ? "selected" : ""}>${esc(x.name.split("/").pop())} (${size(String(x.text).length)})</option>`).join("")}</optgroup>`).join("")}</select></label></div>
      <pre class="pv-text" tabindex="0">${esc(lines.slice(0, SHOW_LINES).join("\n"))}</pre>
      <p class="fine">${more ? `The first ${SHOW_LINES} lines of ${esc(f.name)}.` : `All of ${esc(f.name)}.`}</p>`;
  }

  /* ---------- the tabs ---------- */
  function draw(focus) {
    const tabs = [job.ctx.wx && ["weather", "Weather"], job.ctx.soil && ["soil", "Soil"], wantsWind() && ["wind", "Wind"], ["files", `Files (${job.files.length})`]].filter(Boolean);
    if (!tabs.some(t => t[0] === view.tab)) view.tab = tabs[0][0];
    Ch.clear(ids);
    ids = [];
    pending.length = 0;
    box.innerHTML = `<div class="seg pv-tabs">${tabs.map(([k, n]) => `<button data-pv-tab="${k}" class="${view.tab === k ? "on" : ""}">${esc(n)}</button>`).join("")}</div><div id="pvBody"></div>`;
    ({ weather: weatherTab, soil: soilTab, wind: windTab, files: filesTab })[view.tab]($("#pvBody"));
    flush();
    if (focus) { const e = box.querySelector(focus); if (e) e.focus({ preventScroll: true }); }
  }
  function show(el, j) {
    if (job !== j) { view.step = null; view.file = null; }
    box = el; job = j;
    box.onclick = e => {
      const t = e.target.closest("[data-pv-tab]");
      if (t) { view.tab = t.dataset.pvTab; view.step = null; return draw(`[data-pv-tab="${view.tab}"]`); }
      const b = e.target.closest("[data-pv-set] [data-v]");
      if (b) { const k = b.parentElement.dataset.pvSet; view[k] = b.dataset.v; draw(`[data-pv-set="${k}"] [data-v="${b.dataset.v}"]`); }
    };
    box.onchange = e => {
      const t = e.target;
      if (t.dataset.pvVar) { view.off[t.dataset.pvVar] = !t.checked; draw(`[data-pv-var="${t.dataset.pvVar}"]`); }
      else if (t.id === "pvFilled") { view.filled = t.checked; draw("#pvFilled"); }
      else if (t.id === "pvGap") { view.gap = t.value; draw("#pvGap"); }
      else if (t.id === "pvModel") { view.model = t.value; draw("#pvModel"); }
      else if (t.id === "pvFile") { view.file = t.value; draw("#pvFile"); }
    };
    draw();
  }
  function clear() {
    Ch.clear(ids);
    ids = []; job = null;
    if (box) box.innerHTML = "";
  }
  return { show, clear };
})();
