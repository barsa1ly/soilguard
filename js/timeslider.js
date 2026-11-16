/* The time slider: a bar along the foot of the map whenever the map on show has dates (the Drought Monitor's weeks since
   2000, gridMET's drought indices every 5 days since 1980, SMAP's days since 2015, the land cover by year since 1985,
   PRISM's frames since 1981 in an app that has them, and any map that registers). It spans every frame its source
   keeps, the first to the latest, with year ticks; hovering or dragging shows a frame's date; play and pause loop over a
   chosen range (from and to dates; the last 52 frames of a weekly map at first) at a chosen speed; the step buttons and
   the arrow keys move one frame; and the range can be saved as an animated GIF.
   A map says it has dates with an adapter pushed onto WG.tsAdapters, which may be made before this file loads (its push
   is wrapped here, so a map may register at any time):
     { key, item, label, start, end, step, frames, show, current, dateLabel }, and optionally also, prefetch, wait
   key: unique. item: the layer item (of WG.weather.layers[theme], or app.js's soilLayers.nlcd) whose .layer on the map
   means the slider applies; also(): true while another layer the adapter drives is on instead (the Drought Monitor's
   this-week map). label: the map's name. start: its first day, an epoch day (days since 1970-01-01 UTC, as
   WG.wind.epochDay). end(): a promise of its latest day. step: "day", "week", "5day", "month" or "year". frames(a, b):
   the days it holds in [a, b], in order. show(day): the map on that day, a promise that resolves once its picture has
   loaded (or after about 8 s); it gives the item that day's tag, so the legend the adapter draws again has that frame's
   % (js/shares.js measures and keeps them). current(): the day on show. dateLabel(day): the frame's short text.
   prefetch(day): that frame's pictures asked for ahead (prefetch() below does it for a tile layer).
   One frame at a time: each is shown and waited for before the next, so none is skipped while it loads, and the next
   one's pictures are asked for while it shows. The GIF: the range's frames, at most MAX_FRAMES (one in every k of a
   longer range), each the map as js/mapimage.js draws it, at most MAX_W pixels wide, with the date and a compact legend
   (each class's % when measured within a few seconds), encoded in the browser by gifenc (MIT, from jsdelivr the first
   time). Loaded after the files that make the layers and before app.js; it starts once the page is in
   (DOMContentLoaded), when the map exists. */
WG.timeslider = (function () {
  const U = WG.util, { esc } = U;
  const V = ((document.currentScript || {}).src || "").split("v=")[1] || "1"; // this file's cache tag, for js/mapimage.js
  const GIFENC = "https://cdn.jsdelivr.net/npm/gifenc@1.0.3/dist/gifenc.esm.js";
  const MAX_FRAMES = 120, MAX_W = 640, CAP = 45000; // CAP: the longest a frame is waited for, should an adapter never answer
  const SPEEDS = [[250, "Fast"], [600, "Normal"], [1200, "Slow"], [2500, "Slower"]];
  const SPAN = { day: 30, "5day": 36, week: 52, month: 24, year: 20 }; // the range played at first: the last frames (a year of weekly maps)
  const list = (WG.tsAdapters = WG.tsAdapters || []), byKey = new Map(), order = []; // order: adapters' keys as their layers came on, the latest last
  const nap = ms => new Promise(r => setTimeout(r, ms));
  const iso = d => new Date(d * 864e5).toISOString().slice(0, 10);
  const parse = s => (/^\d{4}-\d\d-\d\d$/.test(s || "") ? Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 864e5 : null);
  const yearOf = d => new Date(d * 864e5).getUTCFullYear();
  const slug = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const safe = (f, dflt) => { try { return f(); } catch (e) { console.warn("time slider", e); return dflt; } };
  const svg = (d, line) => `<svg viewBox="0 0 24 24" aria-hidden="true"${line ? ' class="st"' : ""}><path d="${d}"/></svg>`;
  const ICON = { play: svg("M8 5.5v13l10.5-6.5z"), pause: svg("M7 5h3.6v14H7zm6.4 0H17v14h-3.6z"), prev: svg("M14.5 6 8.5 12l6 6", 1), next: svg("m9.5 6 6 6-6 6", 1),
    more: svg("M5 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm7 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm7 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z") };

  let map = null, el = null, A = null; // the map, the bar, the adapter on show
  let F = [], lo = 0, hi = 0, pos = null, from = null, to = null; // A's frames (days, in order), its span, the frame on show, the range played
  const ranges = new Map(); // key -> [from, to] chosen, kept for each map while the page is open
  let speed = 600, playing = false, playId = 0, openId = 0, busy = null, want = null, loading = false, drag = false, dragT = null, job = null;
  let guess = false; // A's latest day could not be read (its server is down): its frames run to today, which the bar says

  /* ---------- the adapters ---------- */
  function add(a) { if (a && a.key && typeof a.show === "function") { byKey.set(a.key, a); if (map) later(); } }
  const push0 = list.push;
  list.push = function (...xs) { const n = push0.apply(list, xs); xs.forEach(add); return n; };
  list.forEach(add);
  const onMap = a => !!(map && a.item && a.item.layer && map.hasLayer(a.item.layer)) || !!(a.also && safe(() => a.also(), false));
  // the adapter whose layer came on last (the land cover over a theme's map, say), of those that apply
  function pick() { let best = null, at = -2; byKey.forEach(a => { const k = order.indexOf(a.key); if (k > at && onMap(a)) { best = a; at = k; } }); return best; }
  let laterT = null;
  const later = () => { clearTimeout(laterT); laterT = setTimeout(check, 0); }; // once a theme or layer switch has taken off and put on all it does
  function check() {
    const a = pick();
    if (a === A) return;
    if (job) job.cancel = true;
    stop();
    const old = A;
    A = a; want = null; busy = null; loading = false;
    // a map whose layer went off goes back to its own date (its latest, or NLCD 2021) for when it is next turned on
    if (old && old.reset && !onMap(old)) safe(() => old.reset());
    if (A) open(); else show(false);
  }

  /* ---------- frames ---------- */
  // the index of the frame nearest day d
  function near(d) {
    let a = 0, b = F.length - 1;
    while (a < b) { const m = (a + b) >> 1; if (F[m] < d) a = m + 1; else b = m; }
    return a > 0 && d - F[a - 1] <= F[a] - d ? a - 1 : a;
  }
  function span() { if (!F.length || from === null) return []; const i = near(from), j = near(to); return F.slice(Math.min(i, j), Math.max(i, j) + 1); }
  const count = () => (!F.length || from === null ? 0 : Math.abs(near(to) - near(from)) + 1);
  function defRange() { to = F[F.length - 1]; from = F[Math.max(0, F.length - (SPAN[A.step] || 52))]; }
  // a frame shown and waited for (an adapter that never answers does not hold the slider for ever)
  const showAt = (a, d) => Promise.race([Promise.resolve().then(() => a.show(d)).catch(e => console.warn("time slider", a.key, e)), nap(CAP)]);
  // the frame asked for last is shown once the one loading is in: frames asked for meanwhile (a drag) are passed over
  function go(d) {
    want = d;
    if (busy) return busy;
    const a = A;
    loading = true; paint();
    const p = (async () => { while (want !== null && A === a) { const x = want; want = null; await showAt(a, x); } })()
      .finally(() => { if (busy === p) { busy = null; loading = false; paint(); } });
    return (busy = p);
  }
  function stepBy(n) {
    if (!F.length) return;
    const d = F[Math.min(F.length - 1, Math.max(0, near(pos) + n))];
    if (d === pos) return;
    pos = d; paint(); tipHide(); go(d);
  }
  // play: the range's frames one after another, from the one after the frame on show (the first after the last), looping
  async function play() {
    if (playing) { stop(); return; }
    const a = A, me = ++playId;
    playing = true; paint();
    if (busy) await busy; // a frame still loading from a drag is waited for first
    while (playId === me && A === a) {
      const R = span();
      if (!R.length) break;
      const k = R.indexOf(pos), i = k < 0 || k >= R.length - 1 ? 0 : k + 1, d = R[i];
      pos = d; loading = true; paint();
      await showAt(a, d);
      if (playId !== me || A !== a) break;
      loading = false; paint();
      if (a.prefetch) safe(() => a.prefetch(R[(i + 1) % R.length])); // the next frame's pictures load while this one shows
      await nap(speed);
    }
    if (playId === me) { playing = false; loading = false; paint(); }
  }
  function stop() { if (!playing) return; playing = false; playId++; loading = !!busy; paint(); }

  /* ---------- the bar ---------- */
  function show(v) {
    el.hidden = !v;
    if (el.parentElement) el.parentElement.classList.toggle("ts-on", v);
    if (!v) { el.innerHTML = ""; el.classList.remove("open", "busy", "loading"); }
    size();
  }
  // the bar's height, for the legend, the past-date bar and the zoom buttons that move up clear of it (css "time slider")
  function size() { const p = el && el.parentElement; if (p) p.style.setProperty("--ts-h", `${el.hidden ? 0 : Math.ceil(el.offsetHeight)}px`); }
  // the adapter's span and frames read (again: soft keeps the bar on show while they are read), then the bar drawn
  async function open(soft) {
    const a = A, my = ++openId;
    show(true);
    if (!soft || !el.querySelector(".ts-track")) { el.innerHTML = `<div class="ts-row"><div class="ts-now"><b>${esc(a.label)}</b><small>Reading its dates…</small></div></div>`; size(); }
    let end = null;
    try { end = await a.end(); } catch (e) { console.warn("time slider", a.key, e); }
    if (my !== openId || A !== a) return;
    guess = !Number.isFinite(end);
    const top = guess ? Math.floor(Date.now() / 864e5) : end;
    F = safe(() => a.frames(a.start, top), []) || [];
    if (!F.length) { el.innerHTML = `<div class="ts-row"><div class="ts-now"><b>${esc(a.label)}</b><small>No dates could be read for this map.</small></div></div>`; size(); return; }
    lo = Math.min(a.start, F[0]); hi = Math.max(top, F[F.length - 1]);
    const c = safe(() => a.current(), null), r = ranges.get(a.key);
    pos = F[near(Number.isFinite(c) ? c : F[F.length - 1])];
    if (r) { from = F[near(r[0])]; to = F[near(r[1])]; } else defRange();
    draw();
  }
  function draw() {
    const a = A, sp = SPEEDS.map(([v, n]) => `<option value="${v}" ${v === speed ? "selected" : ""}>${n}</option>`).join("");
    el.innerHTML = `<div class="ts-row">
      <div class="ts-btns"><button type="button" class="ts-b ts-play" data-ts="play"></button><button type="button" class="ts-b" data-ts="prev" aria-label="Previous frame (left arrow)">${ICON.prev}</button><button type="button" class="ts-b" data-ts="next" aria-label="Next frame (right arrow)">${ICON.next}</button></div>
      <div class="ts-now"><b></b><small${guess ? ' title="Its latest date could not be read (its server did not answer), so the frames run to today; the last ones may be empty."' : ""}>${esc(a.label)}${guess ? " · latest date not read" : ""}</small></div>
      <button type="button" class="ts-b ts-more" data-ts="more" aria-expanded="${el.classList.contains("open")}" aria-label="Range, speed and GIF">${ICON.more}</button>
      <div class="ts-opts"><label>From<input type="date" data-ts="from" min="${iso(lo)}" max="${iso(hi)}"></label><label>to<input type="date" data-ts="to" min="${iso(lo)}" max="${iso(hi)}"></label>
        <span class="ts-n"></span><button type="button" class="link ts-reset" data-ts="reset">Reset</button>
        <label>Speed<select data-ts="speed">${sp}</select></label>
        <button type="button" class="ts-gif" data-ts="gif" title="An animated GIF of the range: at most ${MAX_FRAMES} frames, ${MAX_W} px wide">Download GIF</button></div></div>
      <div class="ts-track"><div class="ts-rail"><i class="ts-band"></i></div><div class="ts-ticks"></div>
        <input type="range" data-ts="pos" min="${lo}" max="${hi}" step="1" aria-label="Date of the map, ${esc(a.label)}: arrow keys step a frame, Page Up and Down a year">
        <span class="ts-tip" hidden></span></div>
      <div class="ts-job" hidden><div class="ts-prog"><i></i></div><span class="ts-jt"></span><button type="button" class="link" data-ts="cancel">Cancel</button></div>`;
    ticks(); paint(); size();
  }
  function paint() {
    const r = el && el.querySelector('[data-ts="pos"]');
    if (!A || !r || !F.length) return;
    const q = s => el.querySelector(s), lab = safe(() => A.dateLabel(pos), iso(pos)), f = x => (100 * (x - lo)) / Math.max(1, hi - lo);
    q(".ts-now b").textContent = lab;
    if (+r.value !== pos) r.value = pos;
    r.setAttribute("aria-valuetext", lab);
    const band = q(".ts-band");
    band.style.left = `${f(from).toFixed(2)}%`; band.style.width = `${Math.max(0.5, f(to) - f(from)).toFixed(2)}%`;
    const fi = q('[data-ts="from"]'), ti = q('[data-ts="to"]'), n = count();
    if (document.activeElement !== fi) fi.value = iso(from);
    if (document.activeElement !== ti) ti.value = iso(to);
    q(".ts-n").textContent = `${n} ${n === 1 ? "frame" : "frames"}`;
    const p = q(".ts-play");
    p.innerHTML = playing ? ICON.pause : ICON.play;
    p.setAttribute("aria-label", playing ? "Pause" : "Play the range (loops)");
    q('[data-ts="prev"]').disabled = pos <= F[0];
    q('[data-ts="next"]').disabled = pos >= F[F.length - 1];
    el.classList.toggle("loading", loading);
  }
  // a tick each year (Jan 1) and its year written where there is room, the span's first and last years at its ends
  function ticks() {
    const t = el.querySelector(".ts-ticks");
    if (!t) return;
    const w = t.clientWidth || 300, per = w / Math.max(1, (hi - lo) / 365.25), every = [1, 2, 5, 10, 20, 25, 50].find(s => per * s >= 40) || 100;
    const y0 = yearOf(lo), y1 = yearOf(hi);
    let h = `<span class="e0">${y0}</span><span class="e1">${y1}</span>`;
    for (let y = y0 + 1; y <= y1; y++) {
      const d = Date.UTC(y, 0, 1) / 864e5, x = ((d - lo) / Math.max(1, hi - lo)) * w, lab = y % every === 0 && x > 46 && x < w - 46; // clear of the end years
      if (!lab && per < 4) continue;
      h += `<i${y % every === 0 ? ' class="y"' : ""} style="left:${x.toFixed(1)}px"></i>${lab ? `<span style="left:${x.toFixed(1)}px">${y}</span>` : ""}`;
    }
    t.innerHTML = h;
  }
  function tipAt(d) {
    const tip = el.querySelector(".ts-tip"), tr = el.querySelector(".ts-track");
    if (!tip || !tr) return;
    tip.textContent = safe(() => A.dateLabel(d), iso(d));
    tip.hidden = false;
    const w = tr.clientWidth, x = 8 + ((d - lo) / Math.max(1, hi - lo)) * (w - 16), tw = tip.offsetWidth;
    tip.style.left = `${Math.min(w - tw / 2, Math.max(tw / 2, x)).toFixed(1)}px`;
  }
  const tipHide = () => { const t = el && el.querySelector(".ts-tip"); if (t) t.hidden = true; };

  /* ---------- the controls ---------- */
  function onClick(e) {
    const b = e.target.closest("[data-ts]");
    if (!b || !A) return;
    const k = b.dataset.ts;
    if (k === "cancel") { if (job) job.cancel = true; return; }
    if (job) return;
    if (k === "play") play();
    else if (k === "prev" || k === "next") { stop(); stepBy(k === "next" ? 1 : -1); }
    else if (k === "more") { b.setAttribute("aria-expanded", String(el.classList.toggle("open"))); size(); }
    else if (k === "reset") { ranges.delete(A.key); defRange(); keepIn(); paint(); }
    else if (k === "gif") gif();
  }
  function onInput(e) {
    const r = e.target;
    if (r.dataset.ts !== "pos" || !F.length || job) return;
    const d = F[near(+r.value)];
    stop();
    pos = d; paint(); tipAt(d);
    clearTimeout(dragT);
    dragT = setTimeout(() => go(d), drag ? 160 : 0); // while dragging, a frame is asked for once the hand rests a moment
  }
  function onChange(e) {
    const t = e.target, k = t.dataset.ts;
    if (k === "speed") { speed = +t.value || 600; return; }
    if (k !== "from" && k !== "to") return;
    const d = parse(t.value);
    if (d === null || !F.length) return; // a date still being typed
    let a = k === "from" ? F[near(d)] : from, b = k === "to" ? F[near(d)] : to;
    if (a > b) [a, b] = [b, a];
    from = a; to = b; ranges.set(A.key, [a, b]);
    keepIn(); paint();
  }
  // a frame on show outside a new range: the range's nearer end is shown, so the date written and a GIF of the range
  // agree (while playing, the next step starts the range anyway)
  function keepIn() {
    if (playing || job || !F.length || pos === null || (pos >= from && pos <= to)) return;
    const d = pos < from ? from : to;
    pos = d; tipHide(); go(d);
  }
  function onKey(e) {
    if (!A || !F.length || job || (e.target.matches && e.target.matches('input[type="date"], select'))) return;
    const yr = Math.max(1, Math.round(F.length / Math.max(1, (hi - lo) / 365.25)));
    const by = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -yr, PageUp: yr, Home: -F.length, End: F.length }[e.key];
    if (by) { e.preventDefault(); stop(); stepBy(by); return; }
    if (e.key === " " && e.target.dataset && e.target.dataset.ts === "pos") { e.preventDefault(); play(); }
  }
  function onMove(e) {
    const tr = el.querySelector(".ts-track");
    if (!A || !F.length || drag || e.pointerType === "touch" || !tr || !tr.contains(e.target)) return;
    const b = tr.getBoundingClientRect(), f = Math.min(1, Math.max(0, (e.clientX - b.left - 8) / Math.max(1, b.width - 16)));
    tipAt(F[near(lo + f * (hi - lo))]);
  }
  function dragEnd() {
    if (!drag) return;
    drag = false;
    clearTimeout(dragT);
    if (pos !== null) go(pos);
    setTimeout(() => { if (!drag) tipHide(); }, 900);
  }

  /* ---------- sync: the map's own controls (SMAP's day picker, PRISM's bar, the Drought tab's charts) moved it ---------- */
  function sync() {
    if (!A || !F.length || playing || busy || drag || job) return;
    const c = safe(() => A.current(), null);
    if (!Number.isFinite(c) || c === pos) return;
    if (c > F[F.length - 1]) { open(true); return; } // a newer frame than the list holds (this week's map came out)
    pos = F[near(c)]; paint();
  }
  // the adapter's frames read again (PRISM's step or date changed on its bar)
  function refresh() { if (A && !job) { stop(); open(true); } }

  /* ---------- prefetch: a tile layer's next frame ---------- */
  const pre = new Map(); // address -> picture: the last 300 asked for ahead, held so the browser keeps them until the layer asks
  // the tiles on show, each asked for under its next frame's address (rewrite) in the layer's own CORS mode, so the
  // layer's new tiles find them already loaded (a page's pictures are kept by address and mode)
  function prefetch(layer, rewrite) {
    if (!layer || !layer._map || !layer._tiles) return;
    const co = layer.options.crossOrigin, mode = co === true ? "" : co;
    Object.values(layer._tiles).forEach(t => {
      const s = t.current && t.el && t.el.src, u = s && safe(() => rewrite(s), null);
      if (!u || u === s || pre.has(u)) return;
      const i = new Image();
      if (typeof mode === "string") i.crossOrigin = mode;
      i.src = u;
      pre.set(u, i);
      if (pre.size > 300) pre.delete(pre.keys().next().value);
    });
  }

  /* ---------- the GIF ---------- */
  let encP = null, imgP = null;
  const encoder = () => (encP = encP || import(GIFENC).catch(() => { encP = null; throw new Error("the GIF encoder could not be loaded; check the connection and try again"); }));
  const mapImage = () => (WG.mapimage && WG.mapimage.still ? Promise.resolve() : (imgP = imgP || new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = `js/mapimage.js?v=${V}`; s.onload = res; s.onerror = () => { imgP = null; s.remove(); rej(new Error("its drawing script could not be loaded")); };
    document.head.appendChild(s);
  })));
  // the map held still while the frames are drawn: a pan or zoom would move the picture between frames
  function hold() {
    const hs = ["dragging", "touchZoom", "doubleClickZoom", "scrollWheelZoom", "boxZoom", "keyboard"].filter(h => map[h] && map[h].enabled && map[h].enabled());
    hs.forEach(h => map[h].disable());
    return () => hs.forEach(h => map[h].enable());
  }
  function progress(i, n, text) {
    const j = el.querySelector(".ts-job");
    if (!j) return;
    if (j.hidden !== (i === null)) { j.hidden = i === null; size(); } // the bar's height changed: here as well as by the ResizeObserver, which a page in the background does not run
    if (i === null) return;
    j.querySelector(".ts-prog i").style.width = `${n ? (100 * i) / n : 0}%`;
    if (text) j.querySelector(".ts-jt").textContent = text;
  }
  // the frame's %, when measured within a few seconds (a kept answer comes at once), else null: the frame goes without them
  function sharesOf(a, d, me) {
    const S = WG.shares;
    if (!S || !a.item || !a.item.shares) return Promise.resolve(null);
    const r = safe(() => S.ready(a.item), null);
    if (r) return Promise.resolve(r);
    return Promise.race([S.forLegend(a.item, { want: () => !me.cancel && pos === d }), nap(8000).then(() => null)]).catch(() => null);
  }
  async function gif() {
    const a = A, all = span();
    if (!a || !all.length || job) return;
    const k = Math.ceil(all.length / MAX_FRAMES), R = all.filter((_, i) => i % k === 0), back = pos, me = (job = { cancel: false });
    stop();
    const free = hold(), sz = map.getSize(), sc = Math.min(1, MAX_W / Math.max(1, sz.x)), W = Math.round(sz.x * sc), H = Math.round(sz.y * sc);
    const gone = () => me.cancel || A !== a;
    el.classList.add("busy");
    progress(0, R.length, "Loading the GIF encoder…");
    try {
      const [enc] = await Promise.all([encoder(), mapImage()]);
      const G = enc.GIFEncoder(), copy = WG.mapimage.copier ? WG.mapimage.copier() : undefined;
      let last = null;
      for (let i = 0; i < R.length; i++) {
        if (gone()) throw new Error("cancelled");
        const d = R[i];
        pos = d; loading = true; paint();
        progress(i, R.length, `Frame ${i + 1} of ${R.length}: ${safe(() => a.dateLabel(d), iso(d))}…`);
        await showAt(a, d);
        if (gone()) throw new Error("cancelled");
        const ans = await sharesOf(a, d, me);
        if (ans) last = ans;
        const shot = await WG.mapimage.still({ k: sc, copy });
        if (gone()) throw new Error("cancelled");
        const c = compose(shot.canvas, W, H, a, d, ans || (last && { ...last, stale: true }));
        shot.canvas.width = 0;
        // each frame its own palette of up to 256 colours (the classes' colours, the base and the text's edges)
        const px = c.getContext("2d").getImageData(0, 0, W, H).data, pal = enc.quantize(px, 256);
        G.writeFrame(enc.applyPalette(px, pal), W, H, { palette: pal, delay: i === R.length - 1 ? speed * 2 : speed });
        c.width = 0;
        progress(i + 1, R.length);
        await nap(0);
      }
      G.finish();
      const name = `${slug(WG.config && WG.config.name) || "map"}-${slug(a.label)}-${iso(R[0])}_to_${iso(R[R.length - 1])}.gif`;
      WG.util.download(name, G.bytes(), "image/gif");
      U.toast(`Saved ${name}: ${R.length} frames${k > 1 ? ` (one in every ${k} of the range's ${all.length}: at most ${MAX_FRAMES})` : ""}, ${W} × ${H} px.`, 8000);
    } catch (e) {
      if (e.message !== "cancelled") { console.warn("GIF", e); U.toast(`The GIF could not be made: ${e.message || e}`, 8000); }
    } finally {
      job = null; free();
      el.classList.remove("busy");
      progress(null);
      loading = false;
      if (A === a && back !== null) { pos = back; paint(); go(back); } // the frame on show before
    }
  }
  /* one frame: the map, its date at the top left, a compact legend (each class's %, of the states or the boundary, when
     measured) at the bottom left and the data's credit along the foot */
  const FONT = (w, s) => `${w} ${s}px Inter, "Segoe UI", Roboto, system-ui, sans-serif`;
  const solid = c => { const s = String(c || ""); return /gradient/.test(s) ? (s.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/i) || ["#cccccc"])[0] : !s || s === "transparent" ? "#ffffff" : s; };
  const pctTxt = v => (!Number.isFinite(v) ? "–" : v === 0 ? "0%" : v < 0.05 ? "<0.1%" : `${v.toFixed(1)}%`); // as the live legend writes them (js/shares.js)
  const strip = h => (h ? new DOMParser().parseFromString(String(h), "text/html").body.textContent.trim() : "");
  function plate(g, x, y, w, h) {
    g.save(); g.fillStyle = "rgba(255,255,255,0.92)"; g.strokeStyle = "rgba(0,0,0,0.14)"; g.lineWidth = 1;
    g.beginPath(); if (g.roundRect) g.roundRect(x + 0.5, y + 0.5, w, h, 6); else g.rect(x + 0.5, y + 0.5, w, h);
    g.fill(); g.stroke(); g.restore();
  }
  function compose(shot, W, H, a, d, ans) {
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d", { willReadFrequently: true }), f = Math.max(10, Math.min(14, Math.round(W / 46)));
    g.fillStyle = "#ffffff"; g.fillRect(0, 0, W, H);
    g.drawImage(shot, 0, 0, W, H);
    const t1 = safe(() => a.dateLabel(d), iso(d)), t2 = [a.label, WG.config && WG.config.name].filter(Boolean).join(" · ");
    g.font = FONT(700, f + 3); const w1 = g.measureText(t1).width;
    g.font = FONT(400, f - 1); const w2 = g.measureText(t2).width;
    const bw = Math.min(W - 16, Math.max(w1, w2) + 16);
    plate(g, 8, 8, bw, 2 * f + 14);
    g.fillStyle = "#1c2420"; g.font = FONT(700, f + 3); g.fillText(t1, 16, 8 + f + 6, bw - 16);
    g.fillStyle = "#5b635d"; g.font = FONT(400, f - 1); g.fillText(t2, 16, 8 + 2 * f + 8, bw - 16);
    const cr = strip(a.item && a.item.layer && a.item.layer.getAttribution && a.item.layer.getAttribution()), fs = f - 2;
    let foot = 0;
    if (cr) { foot = fs + 7; g.fillStyle = "rgba(255,255,255,0.85)"; g.fillRect(0, H - foot, W, foot); g.fillStyle = "#5b635d"; g.font = FONT(400, fs); g.fillText(`Data: ${cr}`, 6, H - 5, W - 12); }
    legend(g, W, H - foot, f, a, ans);
    return c;
  }
  function legend(g, W, B, f, a, ans) {
    const lg = (a.item && a.item.legend) || {}, fs = f - 1, rh = fs + 5, pad = 7;
    const rows = ans ? ans.rows.map(r => [r.color, r.label, ans.stale ? null : r.pct]).concat(ans.none ? [["#ffffff", ans.none.label, ans.stale ? null : ans.none.pct]] : [])
      : (lg.rows || []).map(([c, l]) => [c, l, undefined]);
    g.font = FONT(400, fs);
    if (!rows.length) { // a colour scale and its ticks
      const S = lg.scale || [], T = lg.ticks || [], w = Math.min(W * 0.5, 220), h = fs * 2 + 18, x = 8, y = B - 8 - h;
      if (!S.length) return;
      plate(g, x, y, w + 16, h);
      S.forEach((col, i) => { g.fillStyle = col; g.fillRect(x + 8 + (i * w) / S.length, y + 7, w / S.length + 0.6, 9); });
      g.fillStyle = "#1c2420"; g.textAlign = "center";
      T.forEach(([at, t], i) => { if (T.length <= 5 || i % 2 === 0) g.fillText(String(t), x + 8 + at * w, y + 16 + fs + 2); });
      g.textAlign = "left";
      return;
    }
    const head = ans ? (ans.stale ? "% not measured for this frame" : `% of ${ans.of}`) : "", pw = ans ? g.measureText("100.0%").width + 8 : 0;
    const lw = Math.min(W * 0.45, Math.max(...rows.map(r => g.measureText(String(r[1])).width)));
    const bw = Math.max(pad * 2 + 18 + lw + pw, head ? g.measureText(head).width + 2 * pad : 0), bh = pad * 2 + (rows.length + (head ? 1 : 0)) * rh - 4, x = 8, y = Math.max(2 * f + 30, B - 8 - bh);
    plate(g, x, y, bw, bh);
    let yy = y + pad + fs - 1;
    if (head) { g.fillStyle = "#5b635d"; g.fillText(head, x + pad, yy, bw - 2 * pad); yy += rh; }
    rows.forEach(([col, l, v]) => {
      g.fillStyle = solid(col); g.fillRect(x + pad, yy - fs + 2, 12, fs - 2);
      g.strokeStyle = "rgba(0,0,0,0.3)"; g.lineWidth = 1; g.strokeRect(x + pad + 0.5, yy - fs + 2.5, 11, fs - 3);
      g.fillStyle = "#1c2420"; g.fillText(String(l), x + pad + 18, yy, lw);
      if (pw) { g.textAlign = "right"; g.fillText(pctTxt(v), x + bw - pad, yy); g.textAlign = "left"; }
      yy += rh;
    });
  }

  /* ---------- start ---------- */
  function init() {
    map = WG.map; el = document.getElementById("tsBar");
    if (!map || !el) return;
    el.addEventListener("click", onClick);
    el.addEventListener("input", onInput);
    el.addEventListener("change", onChange);
    el.addEventListener("keydown", onKey);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", () => { if (!drag) tipHide(); });
    el.addEventListener("pointerdown", e => { if (e.target.dataset && e.target.dataset.ts === "pos" && !job) { drag = true; stop(); } });
    ["pointerup", "pointercancel"].forEach(t => window.addEventListener(t, dragEnd));
    L.DomEvent.disableClickPropagation(el);
    L.DomEvent.disableScrollPropagation(el);
    map.on("layeradd", e => { byKey.forEach(a => { if (a.item && a.item.layer === e.layer) { const k = order.indexOf(a.key); if (k >= 0) order.splice(k, 1); order.push(a.key); } }); later(); });
    map.on("layerremove", later);
    // each legend drawn again (a frame's, or the map's own controls'): the slider follows the day the map shows
    const lg = document.getElementById("legend");
    if (lg) new MutationObserver(() => setTimeout(sync, 0)).observe(lg, { childList: true });
    if (window.ResizeObserver) new ResizeObserver(() => { size(); ticks(); }).observe(el);
    check();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true }); else setTimeout(init, 0);

  return { prefetch, refresh, sync, play, stop, gif, step: stepBy, go: d => { if (F.length) { stop(); pos = F[near(d)]; paint(); return go(pos); } return null; },
    setRange(a, b) { if (!F.length || !A) return; from = F[near(Math.min(a, b))]; to = F[near(Math.max(a, b))]; ranges.set(A.key, [from, to]); paint(); },
    get adapter() { return A; }, get frames() { return F; }, get pos() { return pos; }, get range() { return [from, to]; }, get busy() { return !!(busy || job || playing); }, get playing() { return playing || !!job; }, MAX_FRAMES, MAX_W };
})();
