/* Charts: Chart.js for series, hand-drawn SVG for the wind rose and risk gauge.
   Each Chart.js chart keeps the function that builds its configuration, so a download can draw it again
   off-screen at any size and DPI (WG.charts.render). Units come from WG.units. */
WG.charts = (function () {
  const { MONTHS, fmt, esc } = WG.util;
  const W = WG.units;
  const C = {
    red: "#c8372d", amber: "#e7a33a", gray: "#c9cbc3", ink: "#1c2420", muted: "#69716a", line: "#ebe8df",
    blue: "#2f6f9f", sky: "#7fb0d6", orange: "#d9772f", green: "#3f8f5a",
  };
  const charts = {}, builders = {};
  const GUST_EVENT = 17.9; // m/s, the 40 mph gust day

  if (window.Chart) {
    Chart.defaults.font.family = "Inter, system-ui, sans-serif";
    Chart.defaults.font.size = 11;
    Chart.defaults.color = C.muted;
    Chart.defaults.borderColor = C.line;
    Chart.defaults.plugins.legend.labels.boxWidth = 10;
    Chart.defaults.plugins.legend.labels.boxHeight = 10;
    Chart.defaults.plugins.tooltip.backgroundColor = "rgba(28,36,32,.92)";
    Chart.defaults.plugins.tooltip.padding = 8;
    Chart.defaults.animation.duration = 350;
  }

  /* build() returns a fresh configuration each call (on screen now, off screen for a download). */
  function draw(id, build) {
    builders[id] = build;
    if (charts[id]) charts[id].destroy();
    const el = document.getElementById(id);
    if (!el || !window.Chart) return;
    charts[id] = new Chart(el, build());
  }

  const levelColor = l => (l === "hi" ? C.red : l === "mid" ? C.amber : l === "na" ? "rgba(201,203,195,.35)" : C.gray);
  const r1 = v => (v === null || v === undefined ? null : +v.toFixed(1));
  const wv = v => (v === null || v === undefined ? null : +W.conv("wind", v).toFixed(W.dp("wind")));
  const pv = v => (v === null || v === undefined ? null : +W.conv("precip", v).toFixed(W.dp("precip")));
  // speed labels with one decimal in m/s and kn, whole numbers in mph and km/h
  const wlab = v => fmt(W.conv("wind", v), ["m/s", "kn"].includes(W.sym("wind")) ? 1 : 0);
  /* width of SVG text at px font size, from em widths no smaller than Inter's (on screen) or Arial's (a downloaded
     image cannot load web fonts); other characters count as 0.65, capitals 0.78, and M, W, % and @ 0.99 */
  const EM = { " ": 0.29, ".": 0.29, ",": 0.29, "-": 0.46, "–": 0.56, "/": 0.36, ">": 0.67, "<": 0.67, 0: 0.64, 1: 0.56, 2: 0.61, 3: 0.62,
    4: 0.65, 5: 0.6, 6: 0.62, 7: 0.57, 8: 0.62, 9: 0.62, a: 0.57, c: 0.58, e: 0.59, f: 0.37, h: 0.6, i: 0.25, j: 0.25, k: 0.55, l: 0.25,
    m: 0.88, n: 0.6, o: 0.6, r: 0.38, s: 0.53, t: 0.33, u: 0.6, v: 0.57, w: 0.82, x: 0.55, y: 0.57, z: 0.56 };
  const textWidth = (t, px) => px * [...t].reduce((w, c) => w + (EM[c] || (/[MW%@]/.test(c) ? 0.99 : /[A-Z]/.test(c) ? 0.78 : 0.65)), 0);

  function season(a) {
    draw("chSeason", () => ({
      data: {
        labels: MONTHS,
        datasets: [
          { type: "bar", label: "Erosive wind hours", data: a.months.map(m => r1(m.eroHours)),
            backgroundColor: a.months.map(m => levelColor(m.level)), borderRadius: 5, yAxisID: "y", order: 2 },
          { type: "line", label: `Mean wind (${W.sym("wind")})`, data: a.months.map(m => wv(m.mean)),
            borderColor: C.ink, backgroundColor: C.ink, borderWidth: 2, pointRadius: 2.5, tension: .35, yAxisID: "y1", order: 1 },
        ],
      },
      options: {
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              afterBody: items => {
                const m = a.months[items[0].dataIndex];
                if (!m.valid) return ["No data in this period"];
                // a share of the year only when the period covers all 12 months
                return [`${a.annualized ? "Share of annual risk" : "Share of the covered months' risk"}: ${(m.share * 100).toFixed(0)}%`, `Dryness (1 − P/ET₀): ${m.dry.toFixed(2)}`, `Based on ${fmt(m.samples, m.samples < 10 ? 1 : 0)} month(s) of data`];
              },
            },
          },
        },
        scales: {
          y: { beginAtZero: true, title: { display: true, text: `hours / yr ≥ ${wlab(a.thr)} ${W.sym("wind")}` }, grid: { color: C.line } },
          y1: { position: "right", beginAtZero: true, grid: { display: false }, title: { display: true, text: `mean wind (${W.sym("wind")})` } },
          x: { grid: { display: false } },
        },
      },
    }));
  }

  function speeds(a) {
    draw("chSpeed", () => ({
      data: {
        labels: MONTHS,
        datasets: [
          { type: "line", label: `Mean daily max gust (${W.sym("wind")})`, data: a.months.map(m => wv(m.meanDailyGust)),
            borderColor: C.red, backgroundColor: C.red, borderWidth: 2, pointRadius: 2, tension: .35, yAxisID: "y" },
          { type: "line", label: `Mean daily max wind (${W.sym("wind")})`, data: a.months.map(m => wv(m.meanDailyMax)),
            borderColor: C.orange, backgroundColor: C.orange, borderWidth: 2, pointRadius: 2, tension: .35, yAxisID: "y" },
          { type: "line", label: `Mean wind (${W.sym("wind")})`, data: a.months.map(m => wv(m.mean)),
            borderColor: C.ink, backgroundColor: C.ink, borderWidth: 2, pointRadius: 2, tension: .35, yAxisID: "y" },
          { type: "bar", label: `Days with gusts ≥ ${wlab(GUST_EVENT)} ${W.sym("wind")}`, data: a.months.map(m => (m.gustDays === null ? null : +m.gustDays.toFixed(1))),
            backgroundColor: "rgba(200,55,45,.16)", borderRadius: 4, yAxisID: "y1" },
        ],
      },
      options: {
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: { legend: { position: "bottom" } },
        scales: {
          y: { beginAtZero: true, title: { display: true, text: W.sym("wind") } },
          y1: { position: "right", beginAtZero: true, grid: { display: false }, title: { display: true, text: "gust days / month" } },
          x: { grid: { display: false } },
        },
      },
    }));
  }

  function water(a) {
    const u = W.sym("precip");
    draw("chWater", () => ({
      type: "bar",
      data: {
        labels: MONTHS,
        datasets: [
          { label: `Precip (${u})`, data: a.months.map(m => pv(m.precip)), backgroundColor: C.sky, borderRadius: 3 },
          { label: `ET₀ (${u})`, data: a.months.map(m => pv(m.et0)), backgroundColor: "rgba(217,119,47,.75)", borderRadius: 3 },
        ],
      },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { position: "bottom" } },
        scales: { y: { beginAtZero: true, title: { display: true, text: `${u} / month` } }, x: { grid: { display: false }, ticks: { callback: i => MONTHS[i][0] } } },
      },
    }));
  }

  function trend(a) {
    const xs = a.annual.map(r => r.year);
    const t = a.trend;
    draw("chTrend", () => ({
      data: {
        labels: xs,
        datasets: [
          { type: "bar", label: "Erosive wind hours", data: a.annual.map(r => Math.round(r.eroHours)),
            backgroundColor: a.annual.map(r => (!r.complete ? "rgba(201,203,195,.4)" : r.eroHours >= a.eroHours * 1.15 ? C.red : r.eroHours <= a.eroHours * 0.85 ? C.gray : C.amber)),
            borderRadius: 4 },
          ...(t ? [{ type: "line", label: "Linear trend", data: xs.map(x => +(t.icpt + t.slope * x).toFixed(1)),
            borderColor: C.ink, borderDash: [5, 4], borderWidth: 2, pointRadius: 0 }] : []),
          // not drawn: marks the partial years in the chart's CSV
          { type: "line", label: "Share of the year with data (%); partial years are scaled to a year", data: a.annual.map(r => +(r.cov * 100).toFixed(1)), hidden: true },
        ],
      },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { display: false },
          tooltip: { callbacks: { afterBody: items => {
            const r = a.annual[items[0].dataIndex];
            if (!r) return [];
            return [...(r.complete ? [] : [`Partial year: ${fmt(r.cov * 100, 0)}% of its hours have data in the period, scaled to a year`]),
              ...(r.precip !== null ? [`Precip: ${W.fmt("precip", r.precip, W.sym("precip") === "in" ? 1 : 0)}`] : [])];
          } } } },
        scales: { y: { beginAtZero: true, title: { display: true, text: `hours / yr ≥ ${wlab(a.thr)} ${W.sym("wind")}` } }, x: { grid: { display: false } } },
      },
    }));
  }

  /* SVG wind rose: erosive winds by direction (where wind comes FROM), stacked by speed above threshold.
     Fonts and colours are attributes so the SVG also stands alone as a downloaded file. 300 units wide and, unless
     the legend under the S label needs more than two rows, 300 tall. */
  function roseSVG(a) {
    const size = 300, cx = 150, cy = 135, R = 112;
    const tot = a.rose.map(r => r.bins.reduce((x, y) => x + y, 0));
    const max = Math.max(...tot, 0.01);
    const nice = [0.25, 0.5, 1, 2, 2.5, 5, 10, 20].find(v => v * 4 >= max) || Math.ceil(max / 4);
    const scaleMax = nice * 4;
    const cols = ["#f0c25a", "#e0742c", "#b3261e"];
    const thr = a.thr, arrow = a.rdd !== null && a.rdpRatio > 0.05;
    let s = "";
    for (let k = 1; k <= 4; k++) {
      const r = (R * k) / 4;
      s += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#e4e1d7" stroke-width="1"/>`;
      s += `<text x="${cx + 3}" y="${cy - r + 10}" font-size="9" fill="#8a918b">${+(nice * k).toFixed(2)}%</text>`;
    }
    for (let i = 0; i < 16; i++) {
      const ang = (i * 22.5 - 90) * Math.PI / 180;
      s += `<line x1="${cx}" y1="${cy}" x2="${cx + R * Math.cos(ang)}" y2="${cy + R * Math.sin(ang)}" stroke="#efece4" stroke-width="1"/>`;
    }
    const wedge = (i, r0, r1) => {
      const a0 = (i * 22.5 - 90 - 9.5) * Math.PI / 180, a1 = (i * 22.5 - 90 + 9.5) * Math.PI / 180;
      const p = (r, t) => `${(cx + r * Math.cos(t)).toFixed(1)},${(cy + r * Math.sin(t)).toFixed(1)}`;
      return `M${p(r0, a0)} L${p(r1, a0)} A${r1},${r1} 0 0 1 ${p(r1, a1)} L${p(r0, a1)} A${r0},${r0} 0 0 0 ${p(r0, a0)} Z`;
    };
    a.rose.forEach((r, i) => {
      let acc = 0;
      r.bins.forEach((v, b) => {
        if (v <= 0) return;
        const r0 = (R * acc) / scaleMax, r1 = (R * (acc + v)) / scaleMax;
        s += `<path d="${wedge(i, r0, r1)}" fill="${cols[b]}" stroke="#fff" stroke-width=".6"><title>${WG.util.COMPASS[i]}: ${v.toFixed(2)}% of hours</title></path>`;
        acc += v;
      });
    });
    // resultant transport arrow (downwind)
    if (arrow) {
      const t = (a.rdd - 90) * Math.PI / 180, L = R * 0.92;
      const x2 = cx + L * Math.cos(t), y2 = cy + L * Math.sin(t);
      s += `<line x1="${cx}" y1="${cy}" x2="${x2}" y2="${y2}" stroke="#1c2420" stroke-width="2.5" stroke-dasharray="4 3"/>`;
      const h1 = t + 2.7, h2 = t - 2.7;
      s += `<path d="M${x2},${y2} L${x2 + 9 * Math.cos(h1)},${y2 + 9 * Math.sin(h1)} L${x2 + 9 * Math.cos(h2)},${y2 + 9 * Math.sin(h2)} Z" fill="#1c2420"/>`;
    }
    [["N", 0], ["E", 90], ["S", 180], ["W", 270]].forEach(([t, d]) => {
      const ang = (d - 90) * Math.PI / 180;
      s += `<text x="${cx + (R + 14) * Math.cos(ang)}" y="${cy + (R + 14) * Math.sin(ang) + 4}" text-anchor="middle" font-size="12" font-weight="700" fill="#39423c">${t}</text>`;
    });
    // legend: keys sized from their text, in centred rows that wrap at the width; its top is 6 below the S label
    const F = 9.5, GAP = 12, LINE = 13, y0 = cy + R + 18 + 15, u = W.sym("wind");
    const items = [`${wlab(thr)}–${wlab(thr + 2)}`, `${wlab(thr + 2)}–${wlab(thr + 4)}`, `> ${wlab(thr + 4)}`]
      .map((b, i) => ({ text: `${b} ${u}`, dx: 14, key: `<rect x="0" y="-9" width="10" height="10" rx="2" fill="${cols[i]}"/>` }));
    if (arrow) items.push({ text: "resultant soil-transport direction", dx: 22, key: `<line x1="0" y1="-3" x2="18" y2="-3" stroke="#1c2420" stroke-width="2.5" stroke-dasharray="4 3"/>` });
    const rows = [];
    items.forEach(it => {
      it.w = it.dx + textWidth(it.text, F);
      const row = rows[rows.length - 1];
      if (row && row.w + GAP + it.w <= size - 12) { row.items.push(it); row.w += GAP + it.w; } else rows.push({ items: [it], w: it.w });
    });
    s += `<g font-size="${F}" fill="#39423c">`;
    rows.forEach((row, r) => {
      let x = (size - row.w) / 2;
      row.items.forEach(it => { s += `<g transform="translate(${x.toFixed(1)},${y0 + r * LINE})">${it.key}<text x="${it.dx}" y="0">${esc(it.text)}</text></g>`; x += it.w + GAP; });
    });
    s += `</g>`;
    const H = Math.max(size, y0 + (rows.length - 1) * LINE + 7); // 7: descenders and a margin
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${H}" font-family="Inter, Arial, Helvetica, sans-serif" role="img" aria-label="Erosive wind rose">${s}</svg>`;
  }
  function rose(el, a) { el.innerHTML = roseSVG(a); }

  /* Semicircular gauge with five classes and a needle at level 1..5 (fractional allowed). */
  function gaugeSVG(level) {
    const cols = ["#3f9a66", "#9bbf55", "#efc24a", "#ef8a3c", "#d8402f"];
    const cx = 50, cy = 52, r = 38;
    let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 62">`;
    for (let i = 0; i < 5; i++) {
      const a0 = Math.PI + (i * Math.PI) / 5 + 0.03, a1 = Math.PI + ((i + 1) * Math.PI) / 5 - 0.03;
      s += `<path d="M${cx + r * Math.cos(a0)},${cy + r * Math.sin(a0)} A${r},${r} 0 0 1 ${cx + r * Math.cos(a1)},${cy + r * Math.sin(a1)}" stroke="${cols[i]}" stroke-width="10" fill="none"/>`;
    }
    if (level) {
      const t = Math.PI + ((Math.min(Math.max(level, 0.5), 5.5) - 0.5) / 5) * Math.PI;
      s += `<line x1="${cx}" y1="${cy}" x2="${cx + (r - 4) * Math.cos(t)}" y2="${cy + (r - 4) * Math.sin(t)}" stroke="#fff" stroke-width="3" stroke-linecap="round"/>`;
      s += `<circle cx="${cx}" cy="${cy}" r="4.5" fill="#fff"/>`;
    }
    return s + `</svg>`;
  }
  function gauge(el, level) { el.innerHTML = gaugeSVG(level); }

  /* Monthly erosive hours by source: airport station, raw reanalysis, calibrated (a source with too little data in
     the period has no months and is left out). */
  function calib(all, stationLabel) {
    const has = k => all[k] && !all[k].error;
    draw("chCal", () => {
      const ds = [];
      if (has("station")) ds.push({ type: "bar", label: stationLabel || "Airport station", data: all.station.months.map(m => r1(m.eroHours)), backgroundColor: "rgba(47,111,159,.35)", borderRadius: 4, order: 3 });
      if (has("cal")) ds.push({ type: "line", label: "Calibrated, this point", data: all.cal.months.map(m => r1(m.eroHours)), borderColor: C.red, backgroundColor: C.red, borderWidth: 2.5, pointRadius: 2.5, tension: .3, order: 1 });
      if (has("model")) ds.push({ type: "line", label: "Reanalysis only", data: all.model.months.map(m => r1(m.eroHours)), borderColor: C.muted, backgroundColor: C.muted, borderDash: [5, 4], borderWidth: 2, pointRadius: 0, tension: .3, order: 2 });
      return {
        data: { labels: MONTHS, datasets: ds },
        options: {
          maintainAspectRatio: false,
          interaction: { mode: "index", intersect: false },
          plugins: { legend: { position: "bottom" } },
          scales: { y: { beginAtZero: true, title: { display: true, text: "erosive hours / yr" } }, x: { grid: { display: false } } },
        },
      };
    });
  }

  /* Draw chart `id` again on `canvas` at w x h CSS pixels and pixel ratio `ratio`, on white, without animation.
     fontPx overrides the base font size; title/subtitle are added above the plot. Returns the Chart (destroy it). */
  function render(id, canvas, { w, h, ratio, fontPx, title, subtitle }) {
    if (!builders[id] || !window.Chart) return null;
    const cfg = builders[id]();
    const o = cfg.options = cfg.options || {};
    Object.assign(o, { responsive: false, maintainAspectRatio: false, animation: false, devicePixelRatio: ratio, events: [] });
    o.plugins = { ...(o.plugins || {}), tooltip: { enabled: false },
      title: { display: !!title, text: title || "", color: C.ink, font: { size: Math.round((fontPx || 11) * 1.25), weight: "600" }, padding: { top: 2, bottom: subtitle ? 2 : 10 } },
      subtitle: { display: !!subtitle, text: subtitle || "", color: C.muted, font: { size: Math.round((fontPx || 11) * 0.95) }, padding: { bottom: 10 } } };
    cfg.plugins = [...(cfg.plugins || []), { id: "whiteBg", beforeDraw: c => { const x = c.ctx; x.save(); x.globalCompositeOperation = "destination-over"; x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.restore(); } }];
    // a detached canvas: Chart.js takes its width/height as the display size and multiplies by the pixel ratio itself.
    // It keeps whole display pixels and floors their product, so the file is then set to the exact size asked for
    canvas.width = Math.round(w); canvas.height = Math.round(h);
    const keep = Chart.defaults.font.size;
    if (fontPx) Chart.defaults.font.size = fontPx;
    try {
      const chart = new Chart(canvas, cfg), px = Math.round(w * ratio), py = Math.round(h * ratio);
      if (canvas.width !== px || canvas.height !== py) {
        canvas.width = px; canvas.height = py;
        chart.ctx.setTransform(px / chart.width, 0, 0, py / chart.height, 0, 0);
        chart.draw();
      }
      return chart;
    } finally { Chart.defaults.font.size = keep; }
  }
  /* data of a chart for a CSV: { header, rows } with one row per label */
  function table(id) {
    if (!builders[id]) return null;
    const cfg = builders[id](), labels = cfg.data.labels, ds = cfg.data.datasets, sc = (cfg.options && cfg.options.scales) || {};
    const head = d => { const t = sc[d.yAxisID || "y"] && sc[d.yAxisID || "y"].title; return /\(/.test(d.label) || !t || !t.text ? d.label : `${d.label} (${t.text})`; };
    return { header: ["", ...ds.map(head)], rows: labels.map((l, i) => [l, ...ds.map(d => d.data[i])]) };
  }

  function resizeAll() { Object.values(charts).forEach(c => c.resize()); }
  /* Take charts off the page and out of the downloads (all when ids is omitted): their series no longer apply. */
  function clear(ids = Object.keys(builders)) {
    ids.forEach(id => { if (charts[id]) charts[id].destroy(); delete charts[id]; delete builders[id]; });
  }

  return { draw, season, speeds, water, trend, rose, roseSVG, gauge, gaugeSVG, calib, resizeAll, render, table, clear, has: id => !!builders[id], C };
})();
