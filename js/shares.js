/* The share of the area in each class of a map's legend: % of the states on the map, or of your boundary when one is
   drawn or uploaded with the area tool. The live legend shows it in a narrow column at the right of each class, with a
   last row for the area the map leaves uncoloured (No drought, No data, ...); the saved map image's legend can take the
   same numbers (forLegend, ready). A layer says how it is measured in its item's `shares` (each file that makes layers
   writes its own, as only it knows its server):
     wms: { url, layers }       one WMS GetMap image of the whole box, EPSG:4326
     rest: { url, id }          one ArcGIS MapServer export of the box, EPSG:4326
     url(box, W, H, tag)        any other one-image request of the box (crs: 4326 or 3857)
     tiles: { url, zmin, zmax } the XYZ tiles of the box at a low zoom, put together (Web Mercator)
     png: key                   the statewide images (data/states/XX/*.png, Web Mercator rows), one per chosen state
     frames()                   images the app drew itself ([{ url, bounds }], Web Mercator rows: the past-date maps)
     exact(area)                the classes' km2 counted by their own file instead (land cover), or { km2, note }
     classes(it, tag)           the classes, when the legend is a picture: [[colour, label]] or [{ label, colors }];
                                legendJSON: { url, id } reads them from an ArcGIS service's legend; else the legend's
                                own rows, or its colour scale cut at its ticks (SMAP, temperature, SoilGrids N)
     none                       the label of the uncoloured area (a row coloured "transparent" is that area too)
     full                       the map colours all land: an image with no class at all is a failed draw, not kept
     side                       the image's long side in pixels, when the server cannot draw the usual 1,200
     tag()                      what the map shows besides its layer (a date, depth or element): part of the key;
                                its date (dateOf) when not given
   The image is drawn off screen for the whole box of the states or the boundary, about 1,200 pixels on its long side;
   the state outlines or the boundary are drawn on a mask in the same projection; each pixel inside takes the class of
   the nearest legend colour, within a tolerance (a smoothed edge, or a line or label the server draws, matches none and
   is left out: the shares are of the pixels classed). A pixel under half opaque is uncoloured. Each pixel counts by its
   true area: cos(lat) in EPSG:4326, cos2(lat) in Web Mercator, row by row. Answers are kept in memory and in the app's
   keep box (WG.util.stashPut, 15 days) under the layer, its tag, its classes, the states or the boundary and the page's
   version, so a layer shown again has its numbers at once. They are worked out one at a time, the newest asked first,
   after the legend is drawn, the requests through each server's line (WG.util.fetchBlob); the pixel loop gives the
   page back every few milliseconds, so the map never waits. Loaded after landcover.js, before app.js. */
WG.shares = (function () {
  const U = WG.util, { esc } = U;
  const V = ((document.querySelector('script[src*="data/states.js"]') || {}).src || "").split("v=")[1] || "1"; // the page's version: a new release measures again
  const SIDE = 1200, TOL = 48, OPAQUE = 128, RAD = Math.PI / 180;
  const merc = lat => Math.log(Math.tan(Math.PI / 4 + (lat * RAD) / 2)), unmerc = y => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) / RAD;
  const canvas = (w, h) => (typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h }));
  const ctx = cv => { const c = cv.getContext("2d", { willReadFrequently: true }); c.imageSmoothingEnabled = false; return c; };
  const bitmap = blob => createImageBitmap(blob, { premultiplyAlpha: "none", colorSpaceConversion: "none" });
  const breathe = () => new Promise(r => setTimeout(r, 0));
  // NOAA's map services echo the origin in their CORS header and their CDN keeps the answer: each origin asks for its own copy (as weather.js's legendJSON)
  const forOrigin = url => (/mapservices\.weather\.noaa\.gov/.test(url) ? `${url}&for=${encodeURIComponent(location.origin)}` : url);
  const hash = s => { let h = 0x811c9dc5; for (let k = 0; k < s.length; k++) h = Math.imul(h ^ s.charCodeAt(k), 16777619); return (h >>> 0).toString(36); };

  /* ---------- the area: your boundary, else the states on the map ---------- */
  const bsig = new WeakMap(); // a boundary's polygons -> their signature, worked out once
  function areaNow() {
    const b = WG.area && WG.area.boundary ? WG.area.boundary() : null;
    if (b && b.polys && b.polys.length) {
      if (!bsig.has(b.polys)) bsig.set(b.polys, hash(JSON.stringify(b.polys)));
      const rings = b.polys.flat(), bb = WG.area.bboxOf(rings), px = (bb[2] - bb[0]) * 0.02 + 1e-4, py = (bb[3] - bb[1]) * 0.02 + 1e-4;
      return { of: "your boundary", sig: `b${bsig.get(b.polys)}`, rings, polys: b.polys, box: [bb[0] - px, bb[1] - py, bb[2] + px, bb[3] + py] };
    }
    const recs = WG.region ? WG.region.recs().filter(r => r.polys && r.box) : [];
    if (!recs.length) return null;
    const box = [Math.min(...recs.map(r => r.box[0])), Math.min(...recs.map(r => r.box[1])), Math.max(...recs.map(r => r.box[2])), Math.max(...recs.map(r => r.box[3]))];
    const of = recs.length === 1 ? recs[0].name : recs.length >= 49 ? "the 48 contiguous states and DC" : `the ${recs.length} chosen states`;
    return { of, sig: `s${recs.map(r => r.code).sort().join(",")}`, rings: recs.flatMap(r => r.polys.flatMap(p => p.rings)), recs, box };
  }

  /* ---------- the classes ---------- */
  const rgbOf = c => {
    let m = /^#([0-9a-f]{6})$/i.exec(String(c || "").trim());
    if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
    m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(String(c || ""));
    return m ? [+m[1], +m[2], +m[3]] : null;
  };
  const isNone = c => c === "transparent";
  // [colour, label] or { label, colors } -> { label, color (the swatch), rgbs, none }
  const norm = x => {
    if (Array.isArray(x)) return { label: String(x[1]), color: x[0], rgbs: isNone(x[0]) ? [] : [rgbOf(x[0])].filter(Boolean), none: isNone(x[0]) };
    const cols = (x.colors || []).filter(c => !isNone(c));
    return { label: String(x.label), color: cols.length > 1 ? `linear-gradient(90deg,${cols.join(",")})` : cols[0] || "transparent", rgbs: cols.map(rgbOf).filter(Boolean), none: !cols.length };
  };
  /* a colour scale cut at its ticks: each colour goes to the range that holds its middle; ranges with no colour are
     dropped. A tick's own sign (≥0.7) is left out of a range's label. */
  function bins(g) {
    const N = g.scale.length, t = (g.ticks || []).slice().sort((a, b) => a[0] - b[0]), bare = s => String(s).replace(/^[≥≤<>]\s*/, "");
    if (!N || !t.length) return null;
    const by = [];
    g.scale.forEach((c, i) => { const mid = (i + 0.5) / N; let b = 0; while (b < t.length && t[b][0] <= mid + 1e-9) b++; (by[b] = by[b] || []).push(c); });
    const span = (a, z) => (/^-/.test(a) || /^-/.test(z) ? `${a} to ${z}` : `${a}–${z}`); // "-18 to -7", not "-18–-7"
    return by.map((colors, b) => colors && { colors, label: b === 0 ? `< ${bare(t[0][1])}` : b === t.length ? `≥ ${bare(t[b - 1][1])}` : span(bare(t[b - 1][1]), bare(t[b][1])) }).filter(Boolean);
  }
  /* an ArcGIS service's legend: each entry's swatch read at its middle (an entry drawn clear is the uncoloured area);
     one request a service, kept */
  const arcMemo = new Map();
  async function swatch(e) {
    const bm = await bitmap(await (await fetch(`data:${e.contentType};base64,${e.imageData}`)).blob()), cv = canvas(bm.width, bm.height), cx = ctx(cv);
    cx.drawImage(bm, 0, 0);
    const p = cx.getImageData(bm.width >> 1, bm.height >> 1, 1, 1).data;
    return p[3] < OPAQUE ? "transparent" : `rgb(${p[0]},${p[1]},${p[2]})`;
  }
  function arcClasses(base, id) {
    if (!arcMemo.has(base)) arcMemo.set(base, U.fetchJSON(forOrigin(`${base}/legend?f=json`), {}, 30000).catch(e => { arcMemo.delete(base); throw e; }));
    return arcMemo.get(base).then(j => {
      const L0 = (j.layers || []).find(l => l.layerId === id);
      if (!L0 || !L0.legend || !L0.legend.length) throw new Error(`the service gives no legend for its layer ${id}`);
      return Promise.all(L0.legend.map(async e => [await swatch(e), String(e.label || "").trim()]));
    });
  }
  async function classesOf(it, tag) {
    const sh = it.shares, g = it.legend || {};
    let list = sh.classes ? await sh.classes(it, tag) : sh.legendJSON ? await arcClasses(sh.legendJSON.url, sh.legendJSON.id) : g.rows && g.rows.length ? g.rows : g.scale && g.scale.length ? bins(g) : null;
    if (sh.relabel && list) list = sh.relabel(list);
    list = (list || []).map(norm);
    return list.some(c => !c.none) ? list : null;
  }
  // the class of each colour: the nearest within the tolerance, wider for a scale whose steps are far apart (each colour stands for those between)
  function palette(C) {
    const pal = [];
    C.forEach((c, k) => { if (!c.none) c.rgbs.forEach(rgb => pal.push([rgb[0], rgb[1], rgb[2], k])); });
    let tol = TOL;
    C.forEach(c => { for (let i = 1; i < c.rgbs.length; i++) { const a = c.rgbs[i - 1], b = c.rgbs[i]; tol = Math.max(tol, 0.6 * Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) + 8); } });
    const t2 = tol * tol, memo = new Map();
    return (r, g, b) => {
      const key = (r << 16) | (g << 8) | b;
      let k = memo.get(key);
      if (k !== undefined) return k;
      let best = Infinity;
      k = -1;
      for (const p of pal) { const d = (r - p[0]) ** 2 + (g - p[1]) ** 2 + (b - p[2]) ** 2; if (d < best) { best = d; k = p[3]; } }
      if (best > t2) k = -1;
      memo.set(key, k);
      return k;
    };
  }

  /* ---------- the image of the box ---------- */
  // the box in EPSG:4326 or Web Mercator, about SIDE pixels on its long side; X, Y place a longitude and a latitude; wt is each row's true area
  function frame(box, crs, side = SIDE) {
    const [w, s, e, n] = box, mer = crs === 3857, ys = mer ? merc(s) : s * RAD, yn = mer ? merc(n) : n * RAD, dx = (e - w) * RAD, dy = yn - ys;
    const k = side / Math.max(dx, dy), W = Math.max(16, Math.round(dx * k)), H = Math.max(16, Math.round(dy * k));
    const wt = new Float64Array(H);
    for (let r = 0; r < H; r++) { const y = yn - ((r + 0.5) / H) * dy, c = Math.cos(mer ? unmerc(y) * RAD : y); wt[r] = mer ? c * c : c; }
    const km = ((e - w) * 111.32 * Math.cos(((s + n) / 2) * RAD)) / W;
    return { box, crs, W, H, wt, km, X: lon => ((lon - w) / (e - w)) * W, Y: lat => ((yn - (mer ? merc(lat) : lat * RAD)) / dy) * H };
  }
  // an image of the lon/lat box w, s, e, n (in the frame's projection) drawn in its place, only the part inside the frame read
  function place(F, cx, im, w, s, e, n) {
    const x0 = F.X(w), x1 = F.X(e), y0 = F.Y(n), y1 = F.Y(s), iw = im.width, ih = im.height;
    const a = Math.max(0, x0), b = Math.min(F.W, x1), c = Math.max(0, y0), d = Math.min(F.H, y1);
    if (b <= a || d <= c || x1 <= x0 || y1 <= y0) return;
    cx.drawImage(im, ((a - x0) / (x1 - x0)) * iw, ((c - y0) / (y1 - y0)) * ih, ((b - a) / (x1 - x0)) * iw, ((d - c) / (y1 - y0)) * ih, a, c, b - a, d - c);
  }
  const crsOf = sh => (sh.png || sh.tiles || sh.frames ? 3857 : sh.crs || 4326);
  const pick = v => (typeof v === "function" ? v() : v);
  function oneUrl(sh, F, tag) {
    const [w, s, e, n] = F.box;
    if (sh.url) return sh.url(F.box, F.W, F.H, tag);
    if (sh.wms) { const u = pick(sh.wms.url); return forOrigin(`${u}${u.includes("?") ? "&" : "?"}service=WMS&version=1.3.0&request=GetMap&layers=${encodeURIComponent(pick(sh.wms.layers))}&styles=&crs=EPSG:4326&bbox=${s},${w},${n},${e}&width=${F.W}&height=${F.H}&format=image/png&transparent=true`); }
    return forOrigin(`${sh.rest.url}/export?bbox=${w},${s},${e},${n}&bboxSR=4326&imageSR=4326&size=${F.W},${F.H}&layers=show:${sh.rest.id}&format=png32&transparent=true&f=image`);
  }
  const SRC = {
    async one(F, cx, sh, A, tag) { const bm = await bitmap(await U.fetchBlob(oneUrl(sh, F, tag), 90000, /^image\//i)); cx.drawImage(bm, 0, 0, F.W, F.H); bm.close(); },
    // the chosen states' statewide images that reach the box (a boundary's too: those of the states it lies in)
    async png(F, cx, sh) {
      const [w, s, e, n] = F.box, list = (WG.region ? WG.region.recs() : []).filter(r => r.overlays && r.overlays.files && r.overlays.files[sh.png]
        && r.overlays.bounds[0][1] < e && r.overlays.bounds[1][1] > w && r.overlays.bounds[0][0] < n && r.overlays.bounds[1][0] > s);
      if (!list.length) throw new Error("no statewide map of it here yet");
      await Promise.all(list.map(async r => {
        const [[bs, bw], [bn, be]] = r.overlays.bounds, bm = await bitmap(await U.fetchBlob(`${r.overlays.files[sh.png]}?v=${V}`, 60000, /^image\//i));
        place(F, cx, bm, bw, bs, be, bn); bm.close();
      }));
    },
    async frames(F, cx, sh) {
      const list = sh.frames();
      if (!list.length) throw new Error("the map is not drawn yet");
      for (const f of list) { const bm = await bitmap(await (await fetch(f.url)).blob()), b = f.bounds; place(F, cx, bm, b.getWest(), b.getSouth(), b.getEast(), b.getNorth()); bm.close(); }
    },
    // the tiles of the lowest zoom that gives the box about 900 pixels (at most the layer's own last zoom), 4 at a time; a missing tile is clear
    async tiles(F, cx, sh, A, tag) {
      const T = sh.tiles, [w, s, e, n] = F.box, nx = lon => (lon + 180) / 360, ny = lat => (1 - merc(lat) / Math.PI) / 2, zmax = T.zmax ?? 8;
      let z = T.zmin || 0;
      while (z < zmax && (nx(e) - nx(w)) * 256 * 2 ** z < 900) z++;
      const range = q => { const N = 2 ** q; return [Math.floor(nx(w) * N), Math.floor(nx(e) * N - 1e-9), Math.floor(ny(n) * N), Math.floor(ny(s) * N - 1e-9)]; };
      while (z > (T.zmin || 0)) { const [xa, xb, ya, yb] = range(z); if ((xb - xa + 1) * (yb - ya + 1) <= 96) break; z--; }
      const N = 2 ** z, [xa, xb, ya, yb] = range(z), list = [], tmpl = pick(typeof T.url === "function" ? () => T.url(tag) : T.url), bx = T.bounds;
      for (let x = xa; x <= xb; x++) for (let y = ya; y <= yb; y++) {
        const tw = (x / N) * 360 - 180, te = ((x + 1) / N) * 360 - 180, tn = unmerc(Math.PI * (1 - (2 * y) / N)), ts = unmerc(Math.PI * (1 - (2 * (y + 1)) / N));
        if (bx && (te < bx[1] || tw > bx[3] || tn < bx[0] || ts > bx[2])) continue; // outside the layer's own extent: nothing there
        list.push({ x, y, tw, te, tn, ts });
      }
      let bad = 0;
      await U.pool(list, 4, async t => {
        try { const bm = await bitmap(await U.fetchBlob(tmpl.replace("{z}", z).replace("{x}", t.x).replace("{y}", t.y), 30000, /^image\//i)); place(F, cx, bm, t.tw, t.ts, t.te, t.tn); bm.close(); }
        catch (err) { bad++; }
      });
      if (bad > list.length / 3) throw new Error(`${bad} of its ${list.length} tiles did not load`);
    },
  };

  /* ---------- measuring ---------- */
  async function measure(it, C, A, tag) {
    const sh = it.shares, noneC = C.find(c => c.none), cls = C.filter(c => !c.none);
    const noneLabel = sh.none === null ? null : pick(sh.none) || (noneC && noneC.label) || "No data";
    const answer = (pcts, nonePct, note) => ({ of: A.of, rows: cls.map((c, k) => ({ label: c.label, color: c.color, pct: pcts[k] })), none: noneLabel === null ? null : { label: noneLabel, pct: nonePct }, note });
    if (sh.exact) {
      const x = await sh.exact(A), km2 = Array.isArray(x) ? x : x.km2, tot = km2.reduce((a, v) => a + v, 0); // the km2 by class, or { km2, note }
      if (!(tot > 0)) throw new Error("nothing counted inside");
      return answer(km2.map(v => (100 * v) / tot), 0, (!Array.isArray(x) && x.note) || sh.note || "");
    }
    const from = sh.png ? SRC.png : sh.tiles ? SRC.tiles : sh.frames ? SRC.frames : SRC.one;
    let F = frame(A.box, crsOf(sh), sh.side), cv = canvas(F.W, F.H), cx = ctx(cv);
    try { await from(F, cx, sh, A, tag); } catch (e) {
      if (from !== SRC.one || Math.max(F.W, F.H) <= 700) throw e;
      F = frame(A.box, crsOf(sh), 700); cv = canvas(F.W, F.H); cx = ctx(cv); // some servers fail a large image (SoilGrids' at 1,200 px): once more, smaller
      await from(F, cx, sh, A, tag);
    }
    const D = cx.getImageData(0, 0, F.W, F.H).data, mv = canvas(F.W, F.H), mx = mv.getContext("2d", { willReadFrequently: true });
    // the outline drawn in the same pixels: even-odd, so holes and islands count right
    mx.fillStyle = "#000"; mx.beginPath();
    A.rings.forEach(r => { r.forEach(([lon, lat], i) => (i ? mx.lineTo(F.X(lon), F.Y(lat)) : mx.moveTo(F.X(lon), F.Y(lat)))); mx.closePath(); });
    mx.fill("evenodd");
    const M = mx.getImageData(0, 0, F.W, F.H).data, near = palette(C), acc = new Float64Array(C.length);
    let none = 0, miss = 0, n = 0, t0 = performance.now();
    for (let r = 0; r < F.H; r++) {
      const w = F.wt[r];
      for (let c = 0, o = r * F.W * 4; c < F.W; c++, o += 4) {
        if (M[o + 3] < OPAQUE) continue;
        n++;
        if (D[o + 3] < OPAQUE) { none += w; continue; }
        const k = near(D[o], D[o + 1], D[o + 2]);
        if (k < 0) miss += w; else acc[k] += w;
      }
      if (performance.now() - t0 > 12) { await breathe(); t0 = performance.now(); }
    }
    const got = acc.reduce((a, v) => a + v, 0), tot = got + none;
    if (!(n > 0) || !(tot > 0)) throw new Error(n ? "no pixel of the map inside" : "the area is too small for the map's pixels");
    if (sh.full && got === 0) throw new Error("the server sent an empty picture"); // a map that covers all land, all clear: a failed draw, not an answer to keep
    const lost = (100 * miss) / (tot + miss), pcts = C.map((c, k) => (100 * acc[k]) / tot).filter((_, k) => !C[k].none);
    const px = F.km < 1 ? `${Math.max(1, Math.round(F.km * 1000))} m` : `${F.km.toFixed(1)} km`;
    return answer(pcts, (100 * none) / tot, `Measured on the map's image of the area: ${n.toLocaleString("en-US")} pixels of about ${px} inside ${A.of} (the map's own cells may be larger), each weighted by its true area${lost >= 0.05 ? `; ${lost.toFixed(1)}% matched no colour of the legend (smoothed edges, lines) and are left out` : ""}.`);
  }

  /* ---------- answers: kept, and one measured at a time, the newest asked first ---------- */
  const done = new Map(), busy = new Map(), wants = new Map(), lastTag = new Map(), lastErr = new Map();
  // at most KEEP answers in memory, the oldest dropped first: a long session paging through weeks or days would keep them all (the keep box still has them)
  const KEEP = 200, keep = (m, k, v) => { m.delete(k); m.set(k, v); if (m.size > KEEP) m.delete(m.keys().next().value); };
  const jobs = [], DROP = "no longer on show";
  let running = false;
  // want: whether anyone still waits for the answer; a job no one wants by its turn (its legend drawn again or taken down meanwhile) is dropped unmeasured
  const later = (f, want) => new Promise((res, rej) => { jobs.push({ f, want, res, rej }); pump(); });
  async function pump() {
    if (running) return;
    running = true;
    while (jobs.length) { const j = jobs.pop(); if (!j.want()) { j.rej(new Error(DROP)); continue; } try { j.res(await j.f()); } catch (e) { j.rej(e); } }
    running = false;
  }
  const idOf = it => (it.shares && it.shares.id) || it.key;
  // the tag now: a string, or a promise of one (a date read from its server); the last one read stands in for ready()
  function tagNow(it) {
    const sh = it.shares;
    let t;
    try { t = sh.tag ? sh.tag(it) : it.dateOf ? it.dateOf() : ""; } catch (e) { t = null; }
    return t;
  }
  const tagOf = it => Promise.resolve(tagNow(it)).then(t => { const s = t === null || t === undefined ? "" : String(t); lastTag.set(idOf(it), s); return s; }, () => "");
  const sigOf = C => hash(C.map(c => `${c.label}=${c.rgbs.map(x => x.join(".")).join("/")}${c.none ? "!" : ""}`).join("|"));
  const keyOf = (it, tag, C, A) => [idOf(it), tag, sigOf(C), A.sig, V].join("|");
  const stashUrl = key => `${location.origin}/__fg_shares?k=${encodeURIComponent(key)}`; // a key of the app's in the keep box: never fetched
  const lastKey = new Map(); // id|area|tag -> the key last asked for it: what ready() answers from, so a depth or day chosen again is shown at once

  /* The shares of a layer item's legend classes, for the states on the map or your boundary: a promise of
     { of, rows: [{ label, color, pct }], none: { label, pct } | null, note } (pct in %, the rows and none summing to
     100), or of null when the layer cannot be measured (it says nothing of how, or its image could not be read).
     opts.area: another area (as areaNow gives); opts.want: () => whether this caller still waits (else always). */
  async function forLegend(it, opts = {}) {
    if (!it || !it.shares) return null;
    const A = opts.area || areaNow(), want = opts.want || (() => true);
    if (!A) return null;
    try {
      const tag = await tagOf(it), C = await classesOf(it, tag);
      if (!C) throw new Error("its legend gives no colours to match");
      const key = keyOf(it, tag, C, A);
      keep(lastKey, `${idOf(it)}|${A.sig}|${tag}`, key);
      if (done.has(key)) { const a = done.get(key); keep(done, key, a); return a; }
      if (busy.has(key)) wants.get(key).push(want);
      else {
        wants.set(key, [want]);
        busy.set(key, (async () => {
          const hit = await U.stashGet(stashUrl(key));
          if (hit && hit.rows) return hit;
          const ans = await later(() => measure(it, C, A, tag), () => wants.get(key).some(f => f()));
          if (!it.refresh) U.stashPut(stashUrl(key), ans); // a live layer (radar, the latest hour) is measured anew when it changes: not kept for later visits
          return ans;
        })().then(a => { busy.delete(key); wants.delete(key); keep(done, key, a); lastErr.delete(idOf(it)); return a; }, e => { busy.delete(key); wants.delete(key); throw e; }));
      }
      return await busy.get(key);
    } catch (e) {
      // dropped while this caller was joining it (the others had moved on): asked again if still wanted
      if (e && e.message === DROP) return want() ? forLegend(it, opts) : null;
      console.warn("legend shares", idOf(it), e);
      lastErr.set(idOf(it), e.message || String(e));
      return null;
    }
  }
  // the answer already worked out for the item as it is now (its tag, the area), or null; never starts any work
  function ready(it) {
    if (!it || !it.shares) return null;
    const A = areaNow();
    if (!A) return null;
    const t = tagNow(it), now = t && typeof t.then === "function" ? lastTag.get(idOf(it)) : t === null || t === undefined ? "" : String(t);
    const key = now === undefined ? null : lastKey.get(`${idOf(it)}|${A.sig}|${now}`);
    return key && done.has(key) ? done.get(key) : null;
  }

  /* ---------- the live legend's column ---------- */
  const fmtPct = v => (v === null || v === undefined || !Number.isFinite(v) ? "–" : v === 0 ? "0%" : v < 0.05 ? "<0.1%" : `${v.toFixed(1)}%`);
  const shown = new Map(); // a legend box -> the item its column is for, so a new boundary or other states count again
  function undo(el) {
    el.querySelectorAll(":scope > h5 > .lpct-h, :scope > .rows > .row > .lpct, :scope > .rows > .lpct-none, :scope > .lpct-list").forEach(x => x.remove());
    el.querySelectorAll(":scope > .rows[data-lpct-hid]").forEach(x => { x.hidden = false; x.removeAttribute("data-lpct-hid"); });
    delete el.dataset.shares;
  }
  // the legend's own rows, when they are the classes measured, one for one (a row coloured "transparent" is the uncoloured area)
  function ownRows(el, it) {
    const g = it.legend || {}, box = el.querySelector(":scope > .rows"), rows = box ? [...box.querySelectorAll(":scope > .row")] : [];
    return !g.img && !g.scale && g.rows && g.rows.length && rows.length === g.rows.length ? { box, rows, src: g.rows } : null;
  }
  const cell = (v, wait) => `<span class="lpct${wait ? " lpct-wait" : ""}">${wait ? "…" : fmtPct(v)}</span>`;
  const noneRow = (n, wait) => `<div class="row lpct-none"><i class="sw"></i><span class="lpct-l">${esc(n.label)}</span>${cell(n.pct, wait)}</div>`;
  function fill(el, it, ans) {
    const h = el.querySelector(":scope > h5 > .lpct-h");
    if (h) { h.textContent = `% of ${ans.of}`; h.title = ans.note || ""; }
    const own = ownRows(el, it), cls = own ? own.src.filter(r => !isNone(r[0])).length : -1;
    if (own && cls === ans.rows.length) {
      let j = 0;
      own.rows.forEach((r, k) => { r.querySelectorAll(":scope > .lpct").forEach(x => x.remove()); r.insertAdjacentHTML("beforeend", cell(isNone(own.src[k][0]) ? ans.none && ans.none.pct : ans.rows[j++].pct)); });
      own.box.querySelectorAll(":scope > .lpct-none").forEach(x => x.remove());
      if (ans.none && !own.src.some(r => isNone(r[0]))) own.box.insertAdjacentHTML("beforeend", noneRow(ans.none));
      return;
    }
    // a picture or a colour scale: the classes as rows of their own under it (the picture, the same classes, makes way)
    const box = el.querySelector(":scope > .rows");
    el.querySelectorAll(":scope > .lpct-list").forEach(x => x.remove());
    const list = `<div class="rows lpct-list">${ans.rows.map(r => `<div class="row"><i class="sw" style="background:${esc(r.color)}"></i><span class="lpct-l">${esc(r.label)}</span>${cell(r.pct)}</div>`).join("")}${ans.none ? noneRow(ans.none) : ""}</div>`;
    if (box) { box.insertAdjacentHTML("afterend", list); if (box.querySelector(":scope > img")) { box.hidden = true; box.setAttribute("data-lpct-hid", ""); } }
    else el.insertAdjacentHTML("beforeend", list);
  }
  function wait(el, it) {
    const own = ownRows(el, it);
    if (own) own.rows.forEach(r => r.insertAdjacentHTML("beforeend", cell(null, true)));
    const h = el.querySelector(":scope > h5 > .lpct-h");
    if (h) h.textContent += " · measuring…";
  }
  function fail(el, it) {
    el.querySelectorAll(":scope > .rows > .row > .lpct").forEach(x => x.remove());
    const h = el.querySelector(":scope > h5 > .lpct-h");
    if (h) { h.textContent = "% not measured"; h.title = `The share of each class could not be measured: ${lastErr.get(idOf(it)) || "unknown reason"}.`; }
  }
  /* the column on a legend just drawn (el: the legend box, or the land cover's block in it; its h5, then its .rows):
     at once when the answer is kept, else "measuring…" and the numbers when they come, if the legend still shows it */
  function attach(el, it) {
    if (!el) return;
    const my = (el._shareSeq = (el._shareSeq || 0) + 1); // the column asked for last on this box: an earlier one's answer, or queued measuring, no longer wanted
    undo(el);
    shown.delete(el);
    const g = (it && it.legend) || {};
    if (!it || !it.shares || (g.scale && !g.scale.length)) return; // no way to measure it, or its colour scale is still being read
    const A = areaNow();
    if (!A) return;
    shown.set(el, it);
    const h = el.querySelector(":scope > h5");
    el.dataset.shares = idOf(it);
    const mark = Object.assign(document.createElement("small"), { className: "lpct-h", textContent: `% of ${A.of}` });
    if (h) h.insertBefore(mark, h.querySelector(":scope > button"));
    // this column still on show: not once the legend is drawn again or emptied (its measuring, if still queued, is dropped)
    const want = (el._shareWant = () => el._shareSeq === my && el.isConnected && (!h || mark.isConnected));
    // the answer kept is shown at once; asked again all the same, as a date read from its server may have moved on since
    const hit = ready(it);
    if (hit) fill(el, it, hit); else wait(el, it);
    setTimeout(() => forLegend(it, { want }).then(ans => {
      if (!want() || (ans && ans === hit)) return;
      if (ans) fill(el, it, ans); else if (!hit) fail(el, it);
    }), 0);
  }
  // a column still on show (as attach's want): a legend emptied since (no layer on) is neither counted again nor saved
  const onShow = ([el]) => !!(el._shareWant && el._shareWant() && el.dataset.shares);
  // a boundary drawn, uploaded or cleared (js/area.js), or other states on the map (app.js): the columns on show count again
  const again = () => setTimeout(() => [...shown].forEach(([el, it]) => { if (onShow([el])) attach(el, it); else shown.delete(el); }), 0); // a copy: attach takes the box out and puts it back
  ["wg-boundary", "wg-states"].forEach(ev => document.addEventListener(ev, again));
  // the items whose column is on show now (the map's legend first, then the land cover's), for the saved image's legend
  const current = () => [...shown].filter(onShow).map(([el, item]) => ({ el, item }));
  return { forLegend, ready, attach, current, areaNow, arcClasses };
})();
