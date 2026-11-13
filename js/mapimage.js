/* The map as an image, from the map tools' button; js/app.js loads this file the first time it is used. The button
   opens the save dialog (js/downloads.js), with a preview drawn here once, its footer's texts to edit there, and the
   size, resolution and format (PNG, JPEG, TIFF) chosen there; the file is drawn here again at that size.
   The map pane is drawn onto a canvas at its size on the screen, in the order the browser paints it: the base map's
   tiles, the overlays (each at its opacity, a layer's tiles faded together as on the screen), the reference lines and
   names, the outline and cover of the chosen states, the vector layers (watersheds, catchments, stations, a drawn
   field) and the pins. On it and under it, laid out in the page off the screen and drawn the same way, five items: the
   legend on show with its choices as text (and each class's share of the area, from js/shares.js), a title (the app's
   name, the place and when the image was made), a scale bar, a north arrow and the data credits. They start in a band
   under the map, the north arrow on the map; the dialog moves each anywhere on the image, hides it, and changes or
   leaves out its texts. A picture from another server can go into an image
   only when that server allows it (a CORS header): each is asked for again in that mode, and a layer whose server does
   not allow it is left out and named in the footer and the message. No library: the few kinds of things the map holds
   (pictures, canvases, SVG, boxes and text) are drawn here. */
(function () {
  const U = WG.util, { esc } = U;
  const NS = "http://www.w3.org/2000/svg";
  const nap = ms => new Promise(r => setTimeout(r, ms));
  const px = v => parseFloat(v) || 0;
  const pad = n => String(n).padStart(2, "0");
  const on = c => !!c && c !== "transparent" && !/^rgba\(.*,\s*0\)$/.test(c); // a colour that shows
  const strip = h => (h ? new DOMParser().parseFromString(String(h), "text/html").body.textContent.trim() : ""); // a credit's text, without its links

  /* ---------- pictures: a copy the canvas may keep ---------- */
  /* same-origin, data: and blob: pictures are drawn as they are; another server's is asked for again with CORS, and once
     more under a new address when that fails (a copy kept from the plain request may lack the header); a server that
     refuses both is not asked again for the rest of its pictures */
  function copier() {
    const got = new Map(), bad = new Set();
    const load = src => new Promise(res => {
      const i = new Image(), t = setTimeout(() => res(null), 20000);
      i.crossOrigin = "anonymous";
      i.onload = () => { clearTimeout(t); res(i); };
      i.onerror = () => { clearTimeout(t); res(null); };
      i.src = src;
    });
    return el => {
      const src = el.currentSrc || el.src;
      let u;
      try { u = new URL(src, location.href); } catch (e) { return Promise.resolve(null); }
      if (u.protocol === "data:" || u.protocol === "blob:" || u.origin === location.origin) return Promise.resolve(el);
      if (!got.has(src)) got.set(src, (async () => {
        if (bad.has(u.host)) return null;
        const i = (await load(src)) || (bad.has(u.host) ? null : await load(`${src}${src.includes("?") ? "&" : "?"}_cors=1`));
        if (!i) bad.add(u.host);
        return i;
      })());
      return got.get(src);
    };
  }

  /* the name to give a layer left out: the app's own (o.shown), else its credit, else its server */
  function namer(map, shown) {
    const by = new Map(), seen = new Set();
    const put = (l, name) => {
      if (!l || seen.has(l)) return;
      seen.add(l);
      [l._container, l._image, l._icon].forEach(e => { if (e && !by.get(e)) by.set(e, name); });
      if (l.eachLayer) l.eachLayer(x => put(x, name));
      // a layer that keeps its picture in a layer of its own (the soil maps' one image of the view)
      Object.keys(l).forEach(k => { if (k !== "_map" && k !== "_renderer" && l[k] instanceof L.Layer) put(l[k], name); });
    };
    shown.forEach(s => put(s.layer, s.name));
    map.eachLayer(l => put(l, strip(l.getAttribution && l.getAttribution())));
    return el => {
      for (let e = el; e; e = e.parentElement) if (by.get(e)) return by.get(e);
      try { return `the layer from ${new URL(el.currentSrc || el.src).host}`; } catch (e) { return "a map layer"; }
    };
  }

  /* ---------- drawing ---------- */
  function surface(w, h, k) {
    const c = document.createElement("canvas");
    c.width = Math.round(w * k); c.height = Math.round(h * k);
    const g = c.getContext("2d");
    g.setTransform(k, 0, 0, k, 0, 0);
    return g;
  }
  // a layer of the same size and placing, for a faded or filtered group
  const layer = g => { const c = document.createElement("canvas"); c.width = g.canvas.width; c.height = g.canvas.height; const x = c.getContext("2d"); x.setTransform(g.getTransform()); return x; };
  const svgImg = s => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("svg")); i.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}`; });
  // painting order: z-index below 0, then 0 and auto in the page's order, then above 0
  const zOf = n => (n.nodeType === 1 ? parseInt(getComputedStyle(n).zIndex, 10) || 0 : 0);
  const ordered = el => [...el.childNodes].filter(n => n.nodeType === 1 || n.nodeType === 3).map((n, i) => [zOf(n), i, n]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(x => x[2]);
  const SKIP_TAGS = new Set(["script", "style", "template", "select", "input", "button", "textarea", "video", "iframe", "noscript"]);

  /* E: { ox, oy: the page position of the drawing's top left; W, H: its size; k: pixels per CSS pixel; copy, miss, nameOf, skip } */
  async function paint(g, el, a, E) {
    if (E.skip && E.skip.has(el)) return;
    const cs = getComputedStyle(el), tag = el.localName;
    if (cs.display === "none" || SKIP_TAGS.has(tag)) return;
    // a tile still fading in is drawn as it will be in a moment (a page in the background never runs the fade)
    const op = tag === "img" && el.classList.contains("leaflet-tile-loaded") ? 1 : +cs.opacity;
    const filt = cs.filter && cs.filter !== "none" ? cs.filter : "", vis = cs.visibility === "visible";
    if (!(op > 0.004)) return;
    if (tag === "img") return vis && drawImg(g, el, cs, a * op, filt, E);
    if (tag === "canvas") return vis && drawCanvas(g, el, a * op, filt, E);
    if (tag === "svg") return vis && drawSvg(g, el, cs, a * op, filt, E);
    // faded or filtered with things in it: drawn on a layer of its own and laid on as one, as the browser does, so a
    // tile layer's old and new tiles don't add up where they overlap
    const grp = (op < 1 || filt) && el.childNodes.length, c = grp ? layer(g) : g, ca = grp ? 1 : a * op;
    if (vis) { box(c, el, cs, ca, E); pseudo(c, el, cs, "::before", ca, E); }
    for (const n of ordered(el)) {
      if (n.nodeType === 3) { if (vis) text(c, n, cs, ca, E); } else await paint(c, n, ca, E);
    }
    if (vis) pseudo(c, el, cs, "::after", ca, E);
    if (grp) { g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = a * op; if (filt) g.filter = filt; g.drawImage(c.canvas, 0, 0); g.restore(); c.canvas.width = 0; } // its memory let go at once
  }

  async function drawImg(g, el, cs, a, filt, E) {
    if (!el.complete || !el.naturalWidth) return;
    const r = el.getBoundingClientRect(), x = r.left - E.ox, y = r.top - E.oy;
    if (r.width < 0.5 || r.height < 0.5 || x > E.W || y > E.H || x + r.width < 0 || y + r.height < 0) return;
    const i = await E.copy(el);
    if (!i) { E.miss.add(E.nameOf(el)); return; }
    // edges on whole pixels, so neighbouring tiles meet without a seam
    const s = v => Math.round(v * E.k) / E.k, x0 = s(x), y0 = s(y);
    g.save(); g.globalAlpha = a; if (filt) g.filter = filt;
    g.imageSmoothingEnabled = !/pixelated|crisp-edges/.test(cs.imageRendering);
    g.drawImage(i, x0, y0, s(x + r.width) - x0, s(y + r.height) - y0);
    g.restore();
  }

  function drawCanvas(g, el, a, filt, E) {
    const r = el.getBoundingClientRect();
    if (!el.width || !el.height || r.width < 0.5 || r.height < 0.5) return;
    // a canvas holding another server's picture can't be copied: tried on a 1-pixel scratch canvas, not read back from the
    // map's own (a read-back makes the browser draw that canvas more slowly from then on)
    try { const t = document.createElement("canvas"), x = t.getContext("2d"); t.width = t.height = 1; x.drawImage(el, 0, 0, 1, 1); x.getImageData(0, 0, 1, 1); } catch (e) { E.miss.add(E.nameOf(el)); return; }
    g.save(); g.globalAlpha = a; if (filt) g.filter = filt;
    g.drawImage(el, r.left - E.ox, r.top - E.oy, r.width, r.height);
    g.restore();
  }

  async function drawSvg(g, el, cs, a, filt, E) {
    const r = el.getBoundingClientRect();
    if (r.width < 0.5 || r.height < 0.5) return;
    const v0 = el.viewBox && el.viewBox.baseVal, vb = v0 && v0.width ? { x: v0.x, y: v0.y, w: v0.width, h: v0.height } : { x: 0, y: 0, w: r.width, h: r.height };
    const x = r.left - E.ox, y = r.top - E.oy, sx = r.width / vb.w, sy = r.height / vb.h;
    let b = vb;
    // drawn beyond its own box (overflow: visible, the spring wind's arrows): the box widened to what it draws
    if (cs.overflow === "visible") { try { const q = el.getBBox(); b = { x: q.x - 4 / sx, y: q.y - 4 / sy, w: q.width + 8 / sx, h: q.height + 8 / sy }; } catch (e) { /* not rendered */ } }
    // only the part on the image: the states' cover is three times the map's size
    const L0 = Math.max(x + (b.x - vb.x) * sx, 0), T0 = Math.max(y + (b.y - vb.y) * sy, 0);
    const R0 = Math.min(x + (b.x - vb.x + b.w) * sx, E.W), B0 = Math.min(y + (b.y - vb.y + b.h) * sy, E.H);
    if (R0 - L0 < 0.5 || B0 - T0 < 0.5) return;
    const c = el.cloneNode(true);
    c.setAttribute("xmlns", NS); c.removeAttribute("style"); c.removeAttribute("class");
    c.setAttribute("viewBox", `${vb.x + (L0 - x) / sx} ${vb.y + (T0 - y) / sy} ${(R0 - L0) / sx} ${(B0 - T0) / sy}`);
    c.setAttribute("preserveAspectRatio", "none");
    c.setAttribute("width", Math.ceil((R0 - L0) * E.k)); c.setAttribute("height", Math.ceil((B0 - T0) * E.k));
    let i;
    try { i = await svgImg(new XMLSerializer().serializeToString(c)); } catch (e) { E.miss.add(E.nameOf(el)); return; }
    g.save(); g.globalAlpha = a; if (filt) g.filter = filt;
    g.drawImage(i, L0, T0, R0 - L0, B0 - T0);
    g.restore();
  }

  /* an item zoomed in the dialog (js/downloads.js: style zoom on the item) is laid out bigger by the browser, but its computed
     sizes (fonts, borders, offsetWidth) stay as before the zoom: the factor of the element and its parents */
  const zoomOf = el => { let z = 1; for (let e = el; e && e.nodeType === 1; e = e.parentElement) z *= parseFloat(e.style && e.style.zoom) || 1; return z; };
  /* an element's own box: shadow, background (a colour or a linear gradient), border, rounded corners; turned as the
     element is (the pin is a rounded square turned 45°) about its centre */
  function frame(g, el, cs, E, fn) {
    const r = el.getBoundingClientRect(), Z = zoomOf(el);
    g.save();
    g.translate((r.left + r.right) / 2 - E.ox, (r.top + r.bottom) / 2 - E.oy);
    if (Z !== 1) g.scale(Z, Z);
    if (cs.transform && cs.transform !== "none") { try { const M = new DOMMatrix(cs.transform); g.transform(M.a, M.b, M.c, M.d, 0, 0); } catch (e) { /* drawn unturned */ } }
    fn();
    g.restore();
  }
  function box(g, el, cs, a, E) {
    const w = el.offsetWidth, h = el.offsetHeight;
    if (!w || !h || !shows(cs)) return;
    frame(g, el, cs, E, () => shape(g, cs, -w / 2, -h / 2, w, h, a, E));
  }
  // ::before and ::after placed absolutely in the element (the white dot in the pin)
  function pseudo(g, el, cs, which, a, E) {
    if (!el.offsetWidth) return;
    const p = getComputedStyle(el, which);
    if (!p || p.content === "none" || p.content === "normal" || p.display === "none" || p.position !== "absolute" || !shows(p)) return;
    const w = el.offsetWidth, h = el.offsetHeight, bl = px(cs.borderLeftWidth), bt = px(cs.borderTopWidth);
    const pw = w - bl - px(cs.borderRightWidth), ph = h - bt - px(cs.borderBottomWidth), l = px(p.left), t = px(p.top);
    const ww = /px$/.test(p.width) ? px(p.width) : pw - l - px(p.right), hh = /px$/.test(p.height) ? px(p.height) : ph - t - px(p.bottom);
    if (ww > 0 && hh > 0) frame(g, el, cs, E, () => shape(g, p, -w / 2 + bl + l, -h / 2 + bt + t, ww, hh, a, E));
  }
  const SIDES = ["Top", "Right", "Bottom", "Left"];
  const borders = s => SIDES.map(d => (/none|hidden/.test(s[`border${d}Style`]) ? 0 : px(s[`border${d}Width`])));
  const shows = s => on(s.backgroundColor) || /linear-gradient/.test(s.backgroundImage) || (s.boxShadow && s.boxShadow !== "none") || borders(s).some((v, i) => v && on(s[`border${SIDES[i]}Color`]));
  const shadows = s => s.split(/,(?![^(]*\))/).map(t => {
    const c = (t.match(/(rgba?|hsla?)\([^)]*\)|#[\da-f]{3,8}\b/i) || [])[0] || "rgba(0, 0, 0, 0.3)", n = (t.replace(c, "").match(/-?[\d.]+px/g) || []).map(px);
    return { c, x: n[0] || 0, y: n[1] || 0, b: n[2] || 0, s: n[3] || 0, inset: /inset/.test(t) };
  });
  function shape(g, s, x, y, w, h, a, E) {
    const bg = s.backgroundColor, gi = /linear-gradient/.test(s.backgroundImage) ? s.backgroundImage : "", bw = borders(s), bc = SIDES.map(d => s[`border${d}Color`]);
    const R = ["TopLeft", "TopRight", "BottomRight", "BottomLeft"].map(c => { const v = String(s[`border${c}Radius`] || "0").split(" ")[0]; return /%$/.test(v) ? (px(v) / 100) * Math.min(w, h) : px(v); });
    const path = d => { // the box grown (d < 0) or shrunk (d > 0) by d
      const ww = w - 2 * d, hh = h - 2 * d;
      g.beginPath();
      if (g.roundRect && R.some(v => v > 0)) g.roundRect(x + d, y + d, ww, hh, R.map(v => Math.max(0, Math.min(v - d, ww / 2, hh / 2))));
      else g.rect(x + d, y + d, ww, hh);
    };
    g.save(); g.globalAlpha = a;
    // shadows, the last first (under the others); canvas shadows are in pixels and not turned with the box
    (s.boxShadow && s.boxShadow !== "none" ? shadows(s.boxShadow) : []).reverse().forEach(z => {
      if (z.inset) return;
      if (!z.b) { if (z.s || z.x || z.y) { g.save(); g.fillStyle = z.c; g.translate(z.x, z.y); path(-z.s); g.fill(); g.restore(); } } // a hard ring
      else if (on(bg)) { g.save(); g.shadowColor = z.c; g.shadowBlur = z.b * E.k; g.shadowOffsetX = z.x * E.k; g.shadowOffsetY = z.y * E.k; g.fillStyle = bg; path(-z.s); g.fill(); g.restore(); }
    });
    if (on(bg)) { g.fillStyle = bg; path(0); g.fill(); }
    if (gi) { const gr = gradient(g, gi, x, y, w, h); if (gr) { g.fillStyle = gr; path(0); g.fill(); } }
    if (bw.every(v => v === bw[0]) && bc.every(c => c === bc[0])) { if (bw[0] && on(bc[0])) { g.lineWidth = bw[0]; g.strokeStyle = bc[0]; path(bw[0] / 2); g.stroke(); } }
    else [[x, y, w, bw[0]], [x + w - bw[1], y, bw[1], h], [x, y + h - bw[2], w, bw[2]], [x, y, bw[3], h]].forEach((q, i) => { if (bw[i] && on(bc[i])) { g.fillStyle = bc[i]; g.fillRect(...q); } });
    g.restore();
  }
  // the first linear-gradient of a background, at its angle; stops without a place spread evenly
  function gradient(g, s, x, y, w, h) {
    const m = /linear-gradient\((.*)\)/.exec(s.split(/,\s*(?=(?:repeating-)?(?:linear|radial|conic)-gradient|url\()/)[0]);
    if (!m) return null;
    const parts = m[1].split(/,(?![^(]*\))/).map(t => t.trim());
    let ang = 180;
    if (/deg$|^to /.test(parts[0])) { const p = parts.shift(); ang = /deg$/.test(p) ? px(p) : { "to right": 90, "to left": 270, "to top": 0, "to bottom": 180 }[p] ?? 180; }
    const t = (ang * Math.PI) / 180, dx = Math.sin(t), dy = -Math.cos(t), len = Math.abs(w * dx) + Math.abs(h * dy), cx = x + w / 2, cy = y + h / 2;
    const gr = g.createLinearGradient(cx - (dx * len) / 2, cy - (dy * len) / 2, cx + (dx * len) / 2, cy + (dy * len) / 2);
    const st = parts.map(p => { const c = /^(rgba?|hsla?)\(/.test(p) ? p.slice(0, p.indexOf(")") + 1) : p.split(/\s+/)[0]; return { c, at: (p.slice(c.length).match(/-?[\d.]+%/g) || []).map(v => px(v) / 100) }; });
    st.forEach((q, i) => { if (!q.at.length) q.at = [i / Math.max(1, st.length - 1)]; });
    st.forEach(q => q.at.forEach(v => { try { gr.addColorStop(Math.min(1, Math.max(0, v)), q.c); } catch (e) { /* a colour the canvas can't read */ } }));
    return gr;
  }
  // text, word by word where the page set it (its own line breaks), on the font's baseline
  function text(g, n, cs, a, E) {
    const s = n.nodeValue;
    if (!/\S/.test(s)) return;
    const tt = cs.textTransform, T = tt === "uppercase" ? w => w.toUpperCase() : tt === "lowercase" ? w => w.toLowerCase() : w => w;
    g.save(); g.globalAlpha = a; g.fillStyle = cs.color; g.textBaseline = "alphabetic";
    const Z = zoomOf(n.parentElement);
    g.font = `${cs.fontStyle} ${cs.fontWeight} ${px(cs.fontSize) * Z}px ${cs.fontFamily}`;
    if ("letterSpacing" in g && cs.letterSpacing && cs.letterSpacing !== "normal") g.letterSpacing = `${px(cs.letterSpacing) * Z}px`;
    const m = g.measureText("Hg"), A = m.fontBoundingBoxAscent, D = m.fontBoundingBoxDescent, R = document.createRange(), re = /\S+/g;
    const put = (t, b) => g.fillText(T(t), b.left - E.ox, (A !== undefined ? b.top + (b.height - A - D) / 2 + A : b.top + b.height * 0.78) - E.oy);
    const rect = (i, j) => { R.setStart(n, i); R.setEnd(n, j); return R.getClientRects(); };
    for (let w; (w = re.exec(s)); ) {
      const bs = rect(w.index, w.index + w[0].length);
      if (!bs.length || !bs[0].width) continue;
      if (bs.length === 1) { put(w[0], bs[0]); continue; }
      // a word broken over two lines (after a hyphen): each line's part where it is
      let from = 0, at = rect(w.index, w.index + 1)[0];
      if (!at) { put(w[0], bs[0]); continue; }
      for (let i = 1; i <= w[0].length; i++) {
        const end = i === w[0].length, b = end ? null : rect(w.index + i, w.index + i + 1)[0];
        if (!end && !b) continue;
        if (end || Math.abs(b.top - at.top) > at.height / 2) { put(w[0].slice(from, i), at); from = i; at = b; }
      }
    }
    g.restore();
  }

  const missWhy = miss => (miss.length > 1 ? "Their servers do not let a web page copy their map pictures." : "Its server does not let a web page copy its map pictures.");
  // a picture loaded, failed or given up after 5 s (load events: decode() can wait for ever in a page in the background)
  const loaded = i => (i.complete ? null : new Promise(r => { i.addEventListener("load", r, { once: true }); i.addEventListener("error", r, { once: true }); setTimeout(r, 5000); }));
  // a legend key picture that can't go into the image, said in words where it would be, not left as an empty space
  const KEY_HELD = "(The colour key is a picture from the map's server, which does not let it be copied into an image.)";
  const KEY_GONE = "(The colour key did not load from the map's server.)";
  const keyNote = t => { const p = document.createElement("p"); p.className = "mi-fine mi-miss"; p.textContent = t; return p; };

  /* ---------- each class's share of the area, as a column at the end of the legend's rows ---------- */
  /* A: WG.shares.forLegend's answer ({ of, rows: [{ label, color, pct }], none: { label, pct } | null, note }), for the
     map's legend or (lc) the land cover's block in it. Each share goes on the legend row of its colour (else of its
     label); a legend without such rows (the producer's picture, a colour scale) gets rows of its own, which take the
     picture's place as in the live legend. The area with no colour ("No drought") is a row of its own, white. The % texts,
     the added rows and the line saying what they are of hide together when the dialog's option is off (.mi-nopct). The
     live legend's own column (js/shares.js: .lpct...) is not copied: this one is built from the same numbers. */
  const PEND = {};
  const norm = (() => { let cx = null; return c => { cx = cx || document.createElement("canvas").getContext("2d"); cx.fillStyle = "#010203"; cx.fillStyle = String(c || ""); const v = cx.fillStyle; return v === "#010203" ? "" : v; }; })();
  // as the live legend writes them (js/shares.js), so both say the same
  const pctTxt = v => (!Number.isFinite(v) ? "–" : v === 0 ? "0%" : v < 0.05 ? "<0.1%" : `${v.toFixed(1)}%`);
  const rowLab = r => [...r.childNodes].filter(n => !(n.classList && (n.classList.contains("sw") || n.classList.contains("mi-pct")))).map(n => n.textContent).join(" ").replace(/\s+/g, " ").trim().toLowerCase();
  // what the % are of and how they were measured, short: the answer's note gives the map image's pixel size
  function pctNote(A) {
    const px = /about ([\d.,]+)\s*(km|m)\b/.exec(A.note || ""), of = A.of || "the area on the map";
    return px ? `% of ${of}, measured from the map at about ${px[1]} ${px[2]} a pixel.` : A.note ? `% of ${of}: ${A.note.replace(/[.\s]*$/, ".")}` : `% of ${of}, measured from the map.`;
  }
  function addPct(A, root, lc) {
    const top = root && root.querySelector(".legend"), lg = top && (lc ? top.querySelector(":scope > .lc") : top);
    const mine = r => lc || !r.closest(".lc"); // the map's legend leaves the land cover's block to its own answer
    if (!A || !lg || [...lg.querySelectorAll(".mi-pct")].some(mine)) return false;
    const swc = r => { const s = r.querySelector(":scope > .sw"); return s ? norm(s.style.backgroundColor) : ""; };
    const rows = [...lg.querySelectorAll(".row")].filter(r => mine(r) && r.querySelector(":scope > .sw")), used = new Set();
    const cell = (r, v) => { const s = document.createElement("span"); s.className = "mi-pct"; s.textContent = pctTxt(+v); r.appendChild(s); };
    const same = l => String(l).replace(/\s+/g, " ").trim().toLowerCase();
    const find = (c, l) => (c && norm(c) && rows.find(r => !used.has(r) && swc(r) === norm(c))) || (l && rows.find(r => !used.has(r) && rowLab(r) === same(l))) || null;
    const row = (c, l, v, cls) => { const r = document.createElement("div"); r.className = `row ${cls}`; r.innerHTML = `<i class="sw" style="background:${esc(c)}"></i><span>${esc(l)}</span>`; cell(r, v); return r; };
    const ok = x => x && Number.isFinite(+x.pct), add = [];
    (A.rows || []).filter(ok).forEach(x => { const r = find(x.color, x.label); if (r) { used.add(r); cell(r, x.pct); } else add.push(x); });
    let box = used.size ? [...used].pop().parentElement : null;
    if (!box) {
      box = document.createElement("div"); box.className = `rows mi-pcts${lc ? " lc-key" : ""}`;
      const key = lg.querySelector(":scope > .rows"), at = lg.querySelector(":scope > .lnote, :scope > .lc");
      if (key) { key.after(box); if (key.querySelector("img")) key.classList.add("mi-pctpic"); } else lg.insertBefore(box, at);
    }
    add.forEach(x => box.appendChild(row(x.color || "#fff", x.label || "", x.pct, "mi-pcts")));
    if (ok(A.none)) { const r = find(null, A.none.label); if (r) { used.add(r); cell(r, A.none.pct); } else box.appendChild(row("#fff", A.none.label || "No data", A.none.pct, "mi-none")); }
    if (!box.querySelector(".mi-pct")) { if (box.classList.contains("mi-pcts")) box.remove(); lg.querySelectorAll(".mi-pctpic").forEach(k => k.classList.remove("mi-pctpic")); return false; }
    const n = document.createElement("p");
    n.className = "mi-fine mi-pctnote"; n.textContent = pctNote(A);
    box.after(n);
    return true;
  }
  /* the legends whose live column is on show (js/shares.js current(): the map's legend, then the land cover's block in
     it), each with the layer item to ask about; else the item the map button hands over (o.item) */
  function shareAsks(o, lg) {
    const S = WG.shares;
    if (!S || typeof S.forLegend !== "function" || !lg) return [];
    let out = [];
    try { out = (typeof S.current === "function" ? S.current() : []).filter(x => x && x.item && x.el && (x.el === lg || lg.contains(x.el))).map(x => ({ lc: x.el !== lg, item: x.item })); } catch (e) { console.warn("shares", e); }
    if (!out.length) { try { const it = typeof o.item === "function" ? o.item() : o.item; if (it) out.push({ lc: false, item: it }); } catch (e) { console.warn("shares", e); } }
    return out;
  }
  // an answer kept already (ready), else measured (forLegend); null when the layer cannot be measured
  const shareOf = a => { let r = null; try { r = WG.shares.ready ? WG.shares.ready(a.item) : null; } catch (e) { r = null; } return (r ? Promise.resolve(r) : Promise.resolve().then(() => WG.shares.forLegend(a.item))).then(A => ({ lc: a.lc, A: A || null }), e => { console.warn("shares", e); return { lc: a.lc, A: null }; }); };

  /* ---------- the items: legend, title, scale bar, north arrow, credits ---------- */
  // Leaflet's rule: the longest round distance within the bar's length, along the map's middle
  function scaleBars(map, W, H) {
    const y = H / 2, max = Math.round(Math.min(160, Math.max(70, W * 0.3)));
    const m = map.distance(map.containerPointToLatLng([0, y]), map.containerPointToLatLng([max, y])), ft = m * 3.2808399;
    const round = n => { const p = 10 ** Math.floor(Math.log10(n)), d = n / p; return p * (d >= 10 ? 10 : d >= 5 ? 5 : d >= 3 ? 3 : d >= 2 ? 2 : 1); };
    const km = m >= 1000, met = km ? round(m / 1000) * 1000 : round(m), mi = ft >= 5280, imp = mi ? round(ft / 5280) * 5280 : round(ft);
    return [[(max * met) / m, km ? `${met / 1000} km` : `${met} m`], [(max * imp) / ft, mi ? `${imp / 5280} mi` : `${imp} ft`]];
  }
  /* a north arrow: on this map (Web Mercator) north is straight up everywhere, so it always points up. Its colours are
     the SVG's own attributes, which the drawing keeps (it is drawn as a picture of the SVG, without the page's CSS) */
  const NORTH = `<svg xmlns="${NS}" width="22" height="36" viewBox="0 0 22 36" role="img" aria-label="North arrow">
    <path d="M6 12V2l10 10V2" fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" opacity=".8"/>
    <path d="M6 12V2l10 10V2" fill="none" stroke="#1c2420" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M11 15l-7 19 7-5z" fill="#fff" stroke="#1c2420" stroke-width="1.3" stroke-linejoin="round"/>
    <path d="M11 15l7 19-7-5z" fill="#1c2420" stroke="#1c2420" stroke-width="1.3" stroke-linejoin="round"/></svg>`;
  const EDGE = 10; // the items' margin from the image's edges, in its own pixels (js/downloads.js snaps to it)
  /* The layout (.mi-lay, the map's size on the screen, W × H, and the band under it): the band (.mi-foot) lays out the
     legend, and beside it or under it the title, scale and credits, as the footer always was; an item moved in the dialog
     is pinned (.mi-pin) at its place on the image instead. The north arrow starts pinned at the map's top right. */
  function footer(map, W, H, info, miss, noImg) {
    const host = document.createElement("div"), lay = document.createElement("div"), f = document.createElement("div"), lg = document.getElementById("legend");
    const item = (k, html) => { const d = document.createElement("div"); d.className = "mi-it"; d.dataset.it = k; if (typeof html === "string") d.innerHTML = html; else d.appendChild(html); return d; };
    host.className = "mi-host"; host.style.width = `${W}px`;
    lay.className = "mi-lay"; lay.style.width = `${W}px`;
    f.className = "mi-foot"; f.style.top = `${H}px`;
    lay.appendChild(f);
    host.appendChild(lay);
    if (lg && !lg.hidden && lg.childElementCount) { // also while a phone's raised results hide it: it is still the map's legend
      const c = lg.cloneNode(true);
      c.removeAttribute("id"); c.removeAttribute("style"); c.hidden = false; c.classList.remove("min");
      // the legend's choices (depth, element, day) as text: its label and the value chosen in the live legend
      const live = [...lg.querySelectorAll("select, input")];
      [...c.querySelectorAll("select, input")].forEach((d, i) => {
        const s = live[i], lab = d.closest("label"), sp = document.createElement("span");
        if (!s || s.type === "hidden") { d.remove(); return; }
        const v = s.localName === "select" ? ((s.selectedOptions && s.selectedOptions[0]) || {}).text || s.value : /checkbox|radio/.test(s.type) ? (s.checked ? "yes" : "no") : s.value;
        const t = lab ? [...lab.childNodes].filter(n => n !== d && !(n.contains && n.contains(d))).map(n => n.textContent).join(" ").replace(/\s+/g, " ").trim() : "";
        sp.className = "mi-ctl"; sp.textContent = t ? `${t}: ${v}` : v;
        (lab && c.contains(lab) ? lab : d).replaceWith(sp);
      });
      // the live legend's % column (js/shares.js) left out, its picture put back: the image's own is built (addPct)
      c.querySelectorAll(".lpct-h, .lpct, .lpct-none, .lpct-list").forEach(x => x.remove());
      c.querySelectorAll("[data-lpct-hid]").forEach(x => { x.hidden = false; x.removeAttribute("data-lpct-hid"); });
      c.querySelectorAll("button, script, [hidden]").forEach(b => b.remove());
      c.querySelectorAll("label").forEach(l => { if (!l.textContent.trim()) l.remove(); });
      c.querySelectorAll("[id]").forEach(n => n.removeAttribute("id"));
      c.querySelectorAll("img").forEach(i => { if (noImg.has(i.src)) i.replaceWith(keyNote(noImg.get(i.src))); });
      f.appendChild(item("legend", c));
    }
    const m = document.createElement("div"), bars = scaleBars(map, W, H);
    m.className = "mi-meta";
    m.append(item("title", `<div class="mi-name"><b>${esc(info.app)}</b>${info.where ? ` · ${esc(info.where)}` : ""}</div>
      <div class="mi-fine">Map made ${esc(info.made)} (local time) · zoom ${map.getZoom()}</div>`),
    item("scale", `<div class="mi-scale" title="Scale along the middle of the map">${bars.map(([w, t]) => `<span style="width:${w.toFixed(1)}px">${esc(t)}</span>`).join("")}</div>`),
    item("credits", `<p class="mi-fine">Data: ${esc(info.credits.join("; ") || "see the map")}. Drawn with Leaflet.</p>
      ${miss.length ? `<p class="mi-fine mi-miss">Not in this image: ${esc(miss.join("; "))}. ${missWhy(miss)} It shows on the map in ${esc(info.app)}.</p>` : ""}`));
    f.appendChild(m);
    // its place as js/downloads.js gives it (.mi-pin: 6 px by 8 px of padding around the 22 × 36 arrow)
    const n = item("north", NORTH);
    n.classList.add("mi-pin", "mi-boxed");
    n.style.cssText = `left:${W - EDGE - 38}px;top:${EDGE}px`;
    lay.appendChild(n);
    return host;
  }
  // a layout's height when it has none of its own (the image straight away, not from the dialog): the map and the band
  function fitLay(lay, H) {
    if (lay.style.height) return;
    const f = lay.querySelector(".mi-foot");
    lay.style.height = `${H + (f && !f.hidden ? Math.ceil(f.offsetHeight) : 0)}px`;
  }

  /* ---------- the image ---------- */
  // the map at rest: no zoom or pan moving, the tiles loaded (at most 8 s), then a moment for their fade
  async function settle(map) {
    const end = Date.now() + 8000;
    const busy = () => { let b = !!map._animatingZoom || !!(map._panAnim && map._panAnim._inProgress); map.eachLayer(l => { if (l.isLoading && l.isLoading()) b = true; }); return b; };
    let waited = false;
    while (busy() && Date.now() < end) { waited = true; await nap(200); }
    if (waited) await nap(250);
  }
  /* The map drawn once for the save dialog's preview, its items built, and what makes the file later: the map drawn
     again at the scale chosen (its pictures, already copied, drawn sharper only where they are vector: the outlines and
     pins) with the items as edited and placed in the dialog. o.shown: () => [{ name, layer }], the layers on show by the
     app's names; o.item: the layer whose legend is on show, as js/shares.js takes it (or a function giving it). Resolves
     to the dialog's job (js/downloads.js openSave). */
  async function prepare(o = {}) {
    const map = WG.map, el = map.getContainer();
    await settle(map);
    try { await document.fonts.ready; } catch (e) { /* no font loading API */ }
    const box0 = el.getBoundingClientRect(), W = Math.round(box0.width), H = Math.round(box0.height);
    if (W < 20 || H < 20) throw new Error("the map is not on the screen");
    // at most about 16 million pixels on a phone (some phones' canvas limit), 40 million elsewhere
    const phone = window.matchMedia("(max-width: 767px)").matches, maxPx = phone ? 16e6 : 40e6;
    // the preview's map at the screen's sharpness: twice its CSS pixels on a phone, for sharp text and lines
    const kp = Math.min(phone ? 2 : Math.min(2, Math.max(1, window.devicePixelRatio || 1)), Math.sqrt(maxPx / (W * (H + 420))));
    const copy = copier(), miss = new Set(), nameOf = namer(map, o.shown ? o.shown() : []);
    const mp = map.getPane("mapPane"), skip = new Set([map.getPane("tooltipPane"), map.getPane("popupPane")].filter(Boolean));
    const inView = i => { const r = i.getBoundingClientRect(); return r.right > box0.left && r.left < box0.right && r.bottom > box0.top && r.top < box0.bottom; };
    // every picture asked for at once, before the drawing waits on each in turn
    mp.querySelectorAll("img").forEach(i => { if (i.complete && i.naturalWidth && ![...skip].some(p => p.contains(i)) && inView(i)) copy(i); });
    // the map at k pixels per CSS pixel, from where it is on the page now (a phone's panel may have moved it)
    const drawMap = async k => {
      const b = el.getBoundingClientRect(), g = surface(W, H, k);
      g.fillStyle = getComputedStyle(el).backgroundColor || "#ffffff";
      g.fillRect(0, 0, W, H);
      await paint(g, mp, 1, { ox: b.left, oy: b.top, W, H, k, copy, miss, nameOf, skip });
      return g.canvas;
    };
    const pv = await drawMap(kp), c0 = map.getCenter(), z0 = map.getZoom();
    // the map as it was drawn for the preview: not when the page moved or resized it since (a panel opening as it loads)
    const same = () => { const b = el.getBoundingClientRect(); return Math.abs(b.width - W) < 1 && Math.abs(b.height - H) < 1 && map.getZoom() === z0 && map.getCenter().equals(c0); };
    let moved = false;

    // the footer's facts
    const st = WG.state || {}, site = st.site, recs = WG.region ? WG.region.recs() : [], app = (WG.config && WG.config.name) || "Map";
    const now = new Date(), made = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const states = recs.length > 3 ? `${recs.length} states` : recs.map(r => r.name).join(", ");
    const where = site ? `${st.place ? `${st.place} · ` : ""}${site.lat.toFixed(5)}, ${site.lon.toFixed(5)}` : states;
    const credits = [];
    map.eachLayer(l => { const t = strip(l.getAttribution && l.getAttribution()); if (t && !credits.includes(t)) credits.push(t); });
    // the legend's key pictures, a moment more to load, then each one checked: one not loaded is not a server's refusal,
    // so it is said in the footer only, not in the list of layers left out
    const lg = document.getElementById("legend"), keys = lg && !lg.hidden ? [...lg.querySelectorAll("img")] : [], noImg = new Map();
    await Promise.all(keys.map(loaded));
    for (const i of keys) {
      if (!i.naturalWidth) noImg.set(i.src, KEY_GONE);
      else if (!(await copy(i))) { noImg.set(i.src, KEY_HELD); miss.add("the legend's colour key"); }
    }
    const host = footer(map, W, H, { app, where, made, credits }, [...miss], noImg);
    /* each class's share of the area (js/shares.js), for the legend's % column: at once when known, else measured now; a
       few seconds are waited for here, and shares that come later are added to the dialog's legend then (shares.wait).
       got: [{ lc, A }] the answers in the legend */
    const asks = host.querySelector('[data-it="legend"]') ? shareAsks(o, lg) : [], shares = { got: [], wait: null, none: !asks.length };
    if (asks.length) {
      const all = Promise.all(asks.map(shareOf)), r = await Promise.race([all, nap(2500).then(() => PEND)]);
      if (r === PEND) shares.wait = all; else shares.got = r.filter(x => x.A && addPct(x.A, host, x.lc));
      shares.none = !shares.wait && !shares.got.length;
    }
    document.body.appendChild(host);
    try {
      // the footer's copies of the key laid out at their size; one that still has no picture is said in words, as above
      const imgs = [...host.querySelectorAll("img")];
      await Promise.all(imgs.map(loaded));
      imgs.forEach(i => { if (!i.naturalWidth) i.replaceWith(keyNote(KEY_GONE)); });
    } finally { host.remove(); }
    const f0 = host.firstElementChild;
    const slug = (site ? (st.place ? st.place.split(",")[0] : `${site.lat.toFixed(4)}_${site.lon.toFixed(4)}`) : recs.length === 1 ? recs[0].name : `${recs.length}-states`)
      .toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "map";
    const stem = `${app.toLowerCase().replace(/[^a-z0-9]+/g, "")}-map-${slug}-${made.slice(0, 10)}`;

    /* the file: the map at k (the preview's own drawing when the same k, or when the map is no longer as it was then) and
       on it and under it the layout lay (as edited in the dialog: its items where they were placed, its height the map's
       and the band's), laid out off the screen at the map's width and drawn the same way, each item where it is */
    async function compose(k, lay) {
      moved = !same();
      const m = Math.abs(k - kp) < 1e-3 || moved ? pv : await drawMap(k), h = document.createElement("div");
      h.className = "mi-host"; h.style.width = `${W}px`;
      h.appendChild(lay);
      document.body.appendChild(h);
      try {
        fitLay(lay, H);
        const imgs = [...h.querySelectorAll("img")];
        await Promise.all(imgs.map(loaded));
        const r = lay.getBoundingClientRect(), HT = Math.max(H, Math.round(r.height)), g = surface(W, HT, k);
        g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(m, 0, 0, Math.round(W * k), Math.round(H * k)); g.restore();
        await paint(g, lay, 1, { ox: r.left, oy: r.top, W, H: HT, k, copy, miss: new Set(), nameOf: () => "the legend's colour key", skip: null });
        return g.canvas;
      } finally { h.remove(); if (m !== pv) m.width = 0; }
    }
    const left = [...miss];
    return { kind: "map", head: "Save the map as an image", W, H, kp, pv, maxPx, miss: left, compose, edge: EDGE,
      lay: () => f0.cloneNode(true), name: ext => `${stem}.${ext}`,
      // the legend's % column: { got: [{ lc, A }] in the legend, wait: a promise of [{ lc, A }] still measured, none: no
      // shares for this map }; addPct(list, root) puts answers into a layout's legend (the dialog's, or with no root the
      // one each new copy is made from) and returns those put in; pctNote(A) the line under them
      shares, addPct: (list, root) => list.filter(x => x.A && addPct(x.A, root || f0, x.lc)), pctNote,
      // said when the file is saved
      get note() {
        return (moved ? " The map moved on the screen while this was open, so its picture is the preview's, at the screen's sharpness." : "")
          + (left.length ? ` Not in this image: ${left.join("; ")}. ${missWhy(left)}` : "");
      },
      release: () => { pv.width = 0; } }; // its memory let go when the dialog closes
  }

  /* the map button (js/app.js): the map drawn, then the save dialog for its size, resolution, format and texts */
  let busy = false;
  async function save(o) {
    if (busy) return null;
    busy = true;
    U.toast("Making the map's preview…", 30000);
    try {
      const j = await prepare(o), t = document.getElementById("toast");
      if (t) t.hidden = true;
      WG.downloads.openSave(j, document.getElementById("saveMapBtn"));
      return j;
    } finally { busy = false; }
  }
  /* the image straight away, as on screen with its items where they start: { blob (PNG), name, miss, width, height } */
  async function make(o = {}) {
    const j = await prepare(o);
    try {
      const c = await j.compose(j.kp, j.lay());
      const blob = await new Promise((res, rej) => {
        try { c.toBlob(b => (b ? res(b) : rej(new Error("the browser could not make the PNG (the map may be too large)"))), "image/png"); }
        catch (e) { rej(new Error(`the browser would not copy a picture into it (${e.name})`)); }
      });
      return { blob, name: j.name("png"), miss: j.miss, width: c.width, height: c.height };
    } finally { j.release(); }
  }

  WG.mapimage = { save, make, prepare };
})();
