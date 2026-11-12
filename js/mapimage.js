/* The map as an image (PNG), from the map tools' button; js/app.js loads this file the first time it is used.
   The map pane is drawn onto a canvas at its size on the screen, in the order the browser paints it: the base map's
   tiles, the overlays (each at its opacity, a layer's tiles faded together as on the screen), the reference lines and
   names, the outline and cover of the chosen states, the vector layers (watersheds, catchments, stations, a drawn
   field) and the pins. Under it a footer, laid out in the page off the screen and drawn the same way: the legend on
   show with its choices as text, the app's name, the place, when the image was made, a scale bar and the data
   credits. A picture from another server can go into an image only when that server allows it (a CORS header): each
   is asked for again in that mode, and a layer whose server does not allow it is left out and named in the footer and
   the message. No library: the few kinds of things the map holds (pictures, canvases, SVG, boxes and text) are drawn
   here. */
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

  /* an element's own box: shadow, background (a colour or a linear gradient), border, rounded corners; turned as the
     element is (the pin is a rounded square turned 45°) about its centre */
  function frame(g, el, cs, E, fn) {
    const r = el.getBoundingClientRect();
    g.save();
    g.translate((r.left + r.right) / 2 - E.ox, (r.top + r.bottom) / 2 - E.oy);
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
    g.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    if ("letterSpacing" in g && cs.letterSpacing && cs.letterSpacing !== "normal") g.letterSpacing = cs.letterSpacing;
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

  /* ---------- the footer ---------- */
  // Leaflet's rule: the longest round distance within the bar's length, along the map's middle
  function scaleBars(map, W, H) {
    const y = H / 2, max = Math.round(Math.min(160, Math.max(70, W * 0.3)));
    const m = map.distance(map.containerPointToLatLng([0, y]), map.containerPointToLatLng([max, y])), ft = m * 3.2808399;
    const round = n => { const p = 10 ** Math.floor(Math.log10(n)), d = n / p; return p * (d >= 10 ? 10 : d >= 5 ? 5 : d >= 3 ? 3 : d >= 2 ? 2 : 1); };
    const km = m >= 1000, met = km ? round(m / 1000) * 1000 : round(m), mi = ft >= 5280, imp = mi ? round(ft / 5280) * 5280 : round(ft);
    return [[(max * met) / m, km ? `${met / 1000} km` : `${met} m`], [(max * imp) / ft, mi ? `${imp / 5280} mi` : `${imp} ft`]];
  }
  function footer(map, W, H, info, miss, noImg) {
    const host = document.createElement("div"), f = document.createElement("div"), lg = document.getElementById("legend");
    host.className = "mi-host"; host.style.width = `${W}px`;
    f.className = "mi-foot";
    host.appendChild(f);
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
      c.querySelectorAll("button, script, [hidden]").forEach(b => b.remove());
      c.querySelectorAll("label").forEach(l => { if (!l.textContent.trim()) l.remove(); });
      c.querySelectorAll("[id]").forEach(n => n.removeAttribute("id"));
      c.querySelectorAll("img").forEach(i => { if (noImg.has(i.src)) i.replaceWith(keyNote(noImg.get(i.src))); });
      f.appendChild(c);
    }
    const m = document.createElement("div"), bars = scaleBars(map, W, H);
    m.className = "mi-meta";
    m.innerHTML = `<div class="mi-name"><b>${esc(info.app)}</b>${info.where ? ` · ${esc(info.where)}` : ""}</div>
      <div class="mi-fine">Map made ${esc(info.made)} (local time) · zoom ${map.getZoom()}</div>
      <div class="mi-scale" title="Scale along the middle of the map">${bars.map(([w, t]) => `<span style="width:${w.toFixed(1)}px">${esc(t)}</span>`).join("")}</div>
      <p class="mi-fine">Data: ${esc(info.credits.join("; ") || "see the map")}. Drawn with Leaflet.</p>
      ${miss.length ? `<p class="mi-fine mi-miss">Not in this image: ${esc(miss.join("; "))}. ${missWhy(miss)} It shows on the map in ${esc(info.app)}.</p>` : ""}`;
    f.appendChild(m);
    return host;
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
  /* o.shown: () => [{ name, layer }], the layers on show by the app's names. Resolves to { blob, name, miss, width, height }. */
  async function make(o = {}) {
    const map = WG.map, el = map.getContainer();
    await settle(map);
    try { await document.fonts.ready; } catch (e) { /* no font loading API */ }
    const box0 = el.getBoundingClientRect(), W = Math.round(box0.width), H = Math.round(box0.height);
    if (W < 20 || H < 20) throw new Error("the map is not on the screen");
    const phone = window.matchMedia("(max-width: 767px)").matches;
    // a phone's image at twice its CSS pixels, for sharp text and lines; at most about 16 million pixels in all (some phones' canvas limit)
    const k = Math.min(phone ? 2 : Math.min(2, Math.max(1, window.devicePixelRatio || 1)), Math.sqrt(16e6 / (W * (H + 420))));
    const copy = copier(), miss = new Set(), nameOf = namer(map, o.shown ? o.shown() : []);
    const mp = map.getPane("mapPane"), skip = new Set([map.getPane("tooltipPane"), map.getPane("popupPane")].filter(Boolean));
    const inView = i => { const r = i.getBoundingClientRect(); return r.right > box0.left && r.left < box0.right && r.bottom > box0.top && r.top < box0.bottom; };
    // every picture asked for at once, before the drawing waits on each in turn
    mp.querySelectorAll("img").forEach(i => { if (i.complete && i.naturalWidth && ![...skip].some(p => p.contains(i)) && inView(i)) copy(i); });
    const mg = surface(W, H, k);
    mg.fillStyle = getComputedStyle(el).backgroundColor || "#ffffff";
    mg.fillRect(0, 0, W, H);
    await paint(mg, mp, 1, { ox: box0.left, oy: box0.top, W, H, k, copy, miss, nameOf, skip });

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
    document.body.appendChild(host);
    try {
      // the footer's copies of the key laid out at their size; one that still has no picture is said in words, as above
      const imgs = [...host.querySelectorAll("img")];
      await Promise.all(imgs.map(loaded));
      imgs.forEach(i => { if (!i.naturalWidth) i.replaceWith(keyNote(KEY_GONE)); });
      const f = host.firstElementChild, fr = f.getBoundingClientRect(), FH = Math.ceil(fr.height);
      const g = surface(W, H + FH, k);
      g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(mg.canvas, 0, 0); g.restore();
      g.translate(0, H);
      await paint(g, f, 1, { ox: fr.left, oy: fr.top, W, H: FH, k, copy, miss: new Set(), nameOf: () => "the legend's colour key", skip: null });
      const slug = (site ? (st.place ? st.place.split(",")[0] : `${site.lat.toFixed(4)}_${site.lon.toFixed(4)}`) : recs.length === 1 ? recs[0].name : `${recs.length}-states`)
        .toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "map";
      const name = `${app.toLowerCase().replace(/[^a-z0-9]+/g, "")}-map-${slug}-${made.slice(0, 10)}.png`;
      const blob = await new Promise((res, rej) => {
        try { g.canvas.toBlob(b => (b ? res(b) : rej(new Error("the browser could not make the PNG (the map may be too large)"))), "image/png"); }
        catch (e) { rej(new Error(`the browser would not copy a picture into it (${e.name})`)); }
      });
      return { blob, name, miss: [...miss], width: g.canvas.width, height: g.canvas.height };
    } finally { host.remove(); }
  }

  let busy = false;
  async function save(o) {
    if (busy) return null;
    busy = true;
    U.toast("Making the map image…", 30000);
    try {
      const r = await make(o);
      U.download(r.name, r.blob, "image/png");
      U.toast(`Saved ${r.name}.${r.miss.length ? ` Not in this image: ${r.miss.join("; ")}. ${missWhy(r.miss)}` : ""}`, r.miss.length ? 9000 : 4000);
      return r;
    } finally { busy = false; }
  }

  WG.mapimage = { save, make };
})();
