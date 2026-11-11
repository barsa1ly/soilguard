/* The map on a chosen week: the U.S. Drought Monitor's map of any week since 2000 (its WMS keeps every week). The
   Drought tab sends its chosen weeks here; the bar on the map steps through them, one frame at a time. Loaded before
   weather.js, which puts this layer in its list; app.js calls init() once the map exists. Sources: docs/METHODS.md §8
   and the Methods sheet. */
WG.timemap = (function () {
  const { $, esc, MONTHS } = WG.util;
  const Wd = WG.wind;
  const USDM = map => `https://ndmcgeodata.unl.edu/cgi-bin/mapserv.exe?map=/ms4w/apps/usdm/map/${map}.map`;
  const USDM0 = Wd.epochDay(2000, 0, 4); // the Drought Monitor's first map, a Tuesday; every map since is a Tuesday
  const ymd = d => { const x = new Date(d * 864e5); return [x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()]; };
  const ep = Wd.epochDay, iso = Wd.isoDay, lastDay = () => Wd.prismLast();
  const mEnd = (y, m) => ep(y, m + 1, 0);
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const S = { usdm: { d: null } };
  function label(kind) {
    const st = S[kind];
    return kind === "usdm" && st && st.d !== null ? `Week of ${Wd.dayLabel(st.d)}` : "";
  }

  /* ---------- the layer weather.js lists ---------- */
  const layers = {};
  let active = null, map = null, hooks = {}, rseq = 0, playing = false, playId = 0, status = "";
  function usdmLayer() {
    const l = L.tileLayer.wms(USDM("usdm_current_wms"), { layers: "usdm_current", format: "image/png", transparent: true, pane: "thematic", maxZoom: 19, attribution: "U.S. Drought Monitor (NDMC, USDA, NOAA)" });
    l.on("add", () => attach("usdm")).on("remove", () => detach("usdm"));
    return (layers.usdm = l);
  }
  function attach(kind) {
    stop();
    active = kind;
    const st = S.usdm;
    if (st.d === null && usdmLatest) st.d = usdmLatest;
    if (st.d === null) { // this week's date first, so no map is drawn for a week nobody chose
      status = "Finding this week's map…"; bar();
      WG.weather.usdmDate().then(d => { usdmLatest = d; }, () => {}).then(() => { if (S.usdm.d === null) { S.usdm.d = topWeek(); if (active === "usdm") render(); } });
      return;
    }
    render();
  }
  function detach(kind) {
    if (active !== kind) return;
    active = null; stop(); rseq++;
    bar();
  }

  /* ---------- drawing a frame ---------- */
  async function render() {
    const my = ++rseq;
    if (!active) return bar();
    return renderUsdm(my);
  }
  async function renderUsdm(my) {
    if (S.usdm.d === null) return bar();
    const st = S.usdm, l = layers.usdm, w = iso(st.d).replace(/-/g, "");
    status = "Loading the Drought Monitor's map…";
    bar();
    const loaded = new Promise(r => { l.once("load", r); setTimeout(r, 20000); });
    l.setUrl(USDM(`usdm_${w}_wms`), true);
    l.setParams({ layers: `usdm${w}` });
    await loaded;
    if (my !== rseq) return;
    status = `The map valid on Tuesday ${Wd.dayLabel(st.d)}, released two days later.`;
    if (hooks.renderLegend) hooks.renderLegend();
    bar();
  }

  /* ---------- the bar on the map ---------- */
  const yearsFrom = y0 => { const out = []; for (let y = ymd(lastDay())[0]; y >= y0; y--) out.push(y); return out; };
  function bar() {
    const el = $("#timeBar");
    if (!el) return;
    if (!active) { el.hidden = true; el.innerHTML = ""; return; }
    el.hidden = false;
    const nav = (lab, canBack, canFwd) => `<div class="tb-row tb-nav"><button data-tb="prev" aria-label="Earlier" ${canBack ? "" : "disabled"}>‹</button><span class="tb-label">${esc(lab)}</span>
      <button data-tb="next" aria-label="Later" ${canFwd ? "" : "disabled"}>›</button><button data-tb="play" class="tb-play">${playing ? "■ Stop" : "▶ Play"}</button></div>`;
    const st = S.usdm, [y, m] = st.d === null ? [2000, 0] : ymd(st.d);
    el.innerHTML = `<div class="tb-top"><b>Drought Monitor, a past week</b><button class="link" data-tb="live">Live map</button></div>
      <div class="tb-row"><select data-tb="year" aria-label="Year">${yearsFrom(2000).map(v => `<option ${v === y ? "selected" : ""}>${v}</option>`).join("")}</select>
        <select data-tb="month" aria-label="Month">${MONTHS.map((n, k) => `<option value="${k}" ${k === m ? "selected" : ""}>${n}</option>`).join("")}</select></div>
      ${nav(label("usdm"), st.d > USDM0, true)}<p class="tb-note">${esc(status)}</p>`;
  }
  const stop = () => { playing = false; playId++; };
  function onBar(e) {
    const t = e.target.closest("[data-tb]");
    if (!t || !active) return;
    const k = t.dataset.tb, st = S.usdm;
    if (e.type === "click") {
      if (k === "live") { stop(); if (hooks.setLive) hooks.setLive("drought", null); return; }
      if (k === "play") return play();
      if (k === "prev" || k === "next") { stop(); stepUsdm(k === "next" ? 1 : -1); return; }
      return;
    }
    if (e.type !== "change") return;
    stop();
    const y = +$("#timeBar [data-tb=year]").value, m = +$("#timeBar [data-tb=month]").value;
    st.d = tuesdayIn(y, m);
    render();
  }
  // the last Drought Monitor week in a month (a Tuesday), kept between the first map and this week's
  const tuesday = d => d - ((((d - USDM0) % 7) + 7) % 7);
  let usdmLatest = null;
  const topWeek = () => usdmLatest || tuesday(Wd.today() - 3); // a Tuesday's map comes out on the Thursday after
  function tuesdayIn(y, m) {
    const top = topWeek();
    return Math.max(USDM0, Math.min(top, tuesday(mEnd(y, m))));
  }
  async function stepUsdm(dir) {
    const st = S.usdm, d = st.d + 7 * dir;
    if (st.d === null || d < USDM0 || d > topWeek()) return false;
    st.d = d;
    await render();
    return true;
  }
  // one frame after another, each shown for a moment once drawn: one request at a time, never a burst. Each play has
  // its own id; stopping, or any other control, ends it, so two can never run at once
  async function play() {
    if (playing) { stop(); return bar(); }
    const me = ++playId, kind = active;
    playing = true;
    bar();
    while (playId === me && active === kind) {
      const ok = await stepUsdm(1);
      if (!ok || playId !== me) break;
      await sleep(1200);
    }
    if (playId === me) { playing = false; bar(); }
  }

  /* ---------- from the Drought tab ---------- */
  // the Drought Monitor week holding day d (or the nearest one in its record)
  function showWeek(d) {
    stop();
    S.usdm.d = Math.max(USDM0, Math.min(topWeek(), tuesday(d)));
    if (hooks.setLive) hooks.setLive("drought", "usdmPast");
    if (active === "usdm") render();
  }

  function init(m, h) {
    map = m; hooks = h;
    const el = $("#timeBar");
    if (el) { el.addEventListener("click", onBar); el.addEventListener("change", onBar); L.DomEvent.disableClickPropagation(el); L.DomEvent.disableScrollPropagation(el); }
    WG.weather.usdmDate().then(d => { usdmLatest = d; }).catch(() => {});
  }
  return { usdmLayer, init, showWeek, label, get active() { return active; } };
})();
