/* Shared helpers. All modules hang off window.WG. */
window.WG = window.WG || {};

WG.util = (function () {
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August",
    "September", "October", "November", "December"];
  const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function num(v) {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function fmt(v, d = 1, dash = "—") {
    const n = num(v);
    return n === null ? dash : n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const msToMph = v => v * 2.23694;
  const compass = deg => COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];

  /* Answers kept in this browser for 15 days (Cache Storage), so a place looked at again loads at once instead of asking
     every server again. Only sources whose answer for a place and period stays the same for days: the soil survey,
     elevation, land cover, county lines, past weather and station records, gridMET's past days, the place search and
     the Drought Monitor's map images of a dated week (the area grid's; a week's map, once out, does not change). Never
     live layers, forecasts, outlooks, the Drought Monitor's current map (usdm_current) or gridMET's day count (its newest
     day). A POST (Soil Data Access, ACIS) is kept under its URL and a hash of its body. Older answers are dropped at the
     next visit. */
  const KEEP_MS = 15 * 864e5, KEEP_BOX = "fg-keep-v1";
  const KEEP = [/^https:\/\/sdmdataaccess\.(nrcs|sc\.egov)\.usda\.gov\//i, /^https:\/\/epqs\.nationalmap\.gov\//, /^https:\/\/api\.open-meteo\.com\/v1\/elevation/,
    /^https:\/\/archive-api\.open-meteo\.com\//, /^https:\/\/www\.mrlc\.gov\/geoserver\/.*request=GetFeatureInfo/i, /^https:\/\/ic\.imagery1\.arcgis\.com\/.*\/identify\?/,
    /^https:\/\/tigerweb\.geo\.census\.gov\//, /^https:\/\/power\.larc\.nasa\.gov\/api\/temporal\//, /^https:\/\/data\.rcc-acis\.org\//,
    /^https:\/\/www\.ncei\.noaa\.gov\/access\/services\/data\//, /^https:\/\/mesonet\.agron\.iastate\.edu\/cgi-bin\/request\//,
    /^https:\/\/thredds\.northwestknowledge\.net\/.*\.ascii\?/, /^https:\/\/nominatim\.openstreetmap\.org\//,
    /^https:\/\/ndmcgeodata\.unl\.edu\/cgi-bin\/mapserv\.exe\?map=\/ms4w\/apps\/usdm\/map\/usdm_\d{8}_wms\.map&.*REQUEST=GetMap&/];
  const keepOn = (() => { try { return typeof caches !== "undefined" && window.isSecureContext; } catch (e) { return false; } })();
  let keepBox = null;
  const keepOpen = () => (keepBox = keepBox || caches.open(KEEP_BOX));
  function keepKey(url, opts) {
    if (!keepOn || !KEEP.some(re => re.test(url))) return null;
    const m = (opts.method || "GET").toUpperCase();
    if (m === "GET") return url;
    if (m !== "POST" || typeof opts.body !== "string") return null;
    let h = 0x811c9dc5, g = 7; // FNV-1a and a second hash, with the length: a collision would need all three to match
    for (let k = 0; k < opts.body.length; k++) { const c = opts.body.charCodeAt(k); h = Math.imul(h ^ c, 16777619); g = (Math.imul(g, 31) + c) | 0; }
    return `${url}${url.includes("?") ? "&" : "?"}__fgpost=${(h >>> 0).toString(36)}.${(g >>> 0).toString(36)}.${opts.body.length}`;
  }
  async function kept(key) {
    try {
      const box = await keepOpen(), r = await box.match(key);
      if (!r) return null;
      if (Date.now() - +r.headers.get("x-fg-kept") < KEEP_MS) return r;
      box.delete(key);
    } catch (e) { /* storage off */ }
    return null;
  }
  // r is cloned at once, before its body is read by the caller
  function keep(key, r) {
    const c = r.clone();
    (async () => {
      try { await (await keepOpen()).put(key, new Response(await c.blob(), { headers: { "Content-Type": c.headers.get("Content-Type") || "", "x-fg-kept": String(Date.now()) } })); }
      catch (e) { /* storage full or off: asked again next time */ }
    })();
  }
  // answers older than 15 days dropped, a little after the page has loaded
  if (keepOn) setTimeout(async () => {
    try { const box = await keepOpen(); for (const k of await box.keys()) { const r = await box.match(k); if (!r || !(Date.now() - +r.headers.get("x-fg-kept") < KEEP_MS)) await box.delete(k); } }
    catch (e) { /* storage off */ }
  }, 15000);
  const keptInfo = async () => { try { const box = await keepOpen(); return (await box.keys()).length; } catch (e) { return 0; } };
  const keepClear = () => (keepOn ? caches.delete(KEEP_BOX).then(() => { keepBox = null; }) : Promise.resolve());

  /* headerMs caps the wait for the server to start answering; timeoutMs caps the whole download. */
  async function fetchJSON(url, opts = {}, timeoutMs = 45000, headerMs = timeoutMs) {
    const key = keepKey(url, opts), hit = key && (await kept(key));
    if (hit) { try { return await hit.json(); } catch (e) { /* a broken copy: asked again */ } }
    const ctrl = new AbortController();
    const host = (() => { try { return new URL(url, location.href).host; } catch (e) { return "the server"; } })();
    const late = () => ctrl.abort(new Error(`${host} did not answer in time`));
    const timer = setTimeout(late, timeoutMs);
    const hdrTimer = setTimeout(late, headerMs);
    // a caller's own signal (opts.signal) cancels this request too
    const stop = () => ctrl.abort(new DOMException("Stopped", "AbortError"));
    if (opts.signal) { if (opts.signal.aborted) stop(); else opts.signal.addEventListener("abort", stop, { once: true }); }
    try {
      const r = await fetch(url, { ...opts, signal: ctrl.signal });
      clearTimeout(hdrTimer);
      if (!r.ok) {
        let msg = r.status + " " + r.statusText;
        try { const j = await r.json(); msg = j.reason || j.message || msg; } catch (e) { /* not json */ }
        throw new Error(msg);
      }
      if (key) keep(key, r);
      return await r.json();
    } finally {
      clearTimeout(timer);
      clearTimeout(hdrTimer);
    }
  }

  async function fetchText(url, timeoutMs = 45000, headerMs = timeoutMs) {
    const key = keepKey(url, {}), hit = key && (await kept(key));
    if (hit) { try { return await hit.text(); } catch (e) { /* a broken copy: asked again */ } }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const hdrTimer = setTimeout(() => ctrl.abort(), headerMs);
    try {
      const r = await fetch(url, { signal: ctrl.signal });
      clearTimeout(hdrTimer);
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      if (key) keep(key, r);
      return await r.text();
    } finally {
      clearTimeout(timer);
      clearTimeout(hdrTimer);
    }
  }

  /* a file as a Blob; type: a pattern its Content-Type must match, as some servers answer an error with a page and
     HTTP 200 (MapServer's XML for a map it cannot draw): such an answer is an error, and is not kept */
  async function fetchBlob(url, timeoutMs = 45000, type = null) {
    const key = keepKey(url, {}), hit = key && (await kept(key));
    if (hit) { try { const b = await hit.blob(); if (!type || type.test(b.type)) return b; } catch (e) { /* a broken copy: asked again */ } }
    const host = (() => { try { return new URL(url, location.href).host; } catch (e) { return "the server"; } })();
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(new Error(`${host} did not answer in time`)), timeoutMs);
    try {
      const r = await fetch(url, { signal: ctrl.signal });
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      const ct = r.headers.get("Content-Type") || "";
      if (type && !type.test(ct)) { const t = await r.text().catch(() => ""); throw new Error(`the server answered ${ct || "no type"}${t ? `: ${t.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160)}` : ""}`); }
      if (key) keep(key, r);
      return await r.blob();
    } finally { clearTimeout(timer); }
  }

  /* Map items through an async fn with at most n requests in flight; results keep input order. */
  async function pool(items, n, fn) {
    const out = new Array(items.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) { const k = next++; out[k] = await fn(items[k], k); }
    }));
    return out;
  }

  function debounce(fn, ms) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }

  /* Parse "32.7, -101.9", "32.7 N 101.9 W", or DMS "32°44'9\"N 101°57'18\"W". */
  function parseCoords(text) {
    if (!text) return null;
    const s = text.trim().toUpperCase().replace(/[′’']/g, "'").replace(/[″”"]/g, '"');
    const dms = /(-?\d+(?:\.\d+)?)\s*[°D\s]\s*(?:(\d+(?:\.\d+)?)\s*['M\s]\s*)?(?:(\d+(?:\.\d+)?)\s*["S]?\s*)?([NSEW])?/g;
    const parts = [];
    let m;
    while ((m = dms.exec(s)) && parts.length < 2) {
      if (m[0].trim() === "") { dms.lastIndex++; continue; }
      let v = Math.abs(parseFloat(m[1])) + (m[2] ? parseFloat(m[2]) / 60 : 0) + (m[3] ? parseFloat(m[3]) / 3600 : 0);
      if (m[1].startsWith("-")) v = -v;
      parts.push({ v, h: m[4] || null });
    }
    if (parts.length !== 2) {
      const plain = s.match(/(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)/);
      if (!plain) return null;
      parts.length = 0;
      parts.push({ v: parseFloat(plain[1]), h: null }, { v: parseFloat(plain[2]), h: null });
    }
    let [a, b] = parts;
    // hemisphere letters decide order/sign
    if (a.h === "E" || a.h === "W") [a, b] = [b, a];
    let lat = a.v, lon = b.v;
    if (a.h === "S") lat = -Math.abs(lat);
    if (b.h === "W") lon = -Math.abs(lon);
    if (b.h === "E") lon = Math.abs(lon);
    // US users often omit the minus on longitude
    if (!b.h && lon > 60 && lon < 130 && lat > 15 && lat < 50) lon = -lon;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return { lat, lon };
  }

  function toast(msg, ms = 3500) {
    const t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.hidden = true; }, ms);
  }

  function download(name, text, type = "text/plain") {
    const blob = new Blob([text], { type });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  /* Ordinary least squares with a two-sided t-test on the slope. */
  function linreg(xs, ys) {
    const n = xs.length;
    if (n < 3) return null;
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    let sxx = 0, sxy = 0, syy = 0;
    for (let i = 0; i < n; i++) {
      sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); syy += (ys[i] - my) ** 2;
    }
    const slope = sxy / sxx;
    const icpt = my - slope * mx;
    const sse = Math.max(syy - slope * sxy, 0);
    const se = Math.sqrt(sse / (n - 2) / sxx);
    const t = se > 0 ? slope / se : 0;
    const TCRIT = [0, 12.71, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179,
      2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042];
    const tc = TCRIT[Math.min(n - 2, 30)] || 2.0;
    return { slope, icpt, t, significant: Math.abs(t) > tc, r2: syy > 0 ? (slope * sxy) / syy : 0 };
  }

  /* Small JSON cache in localStorage; failures are silently ignored. */
  const cache = {
    get(key) {
      try { const s = localStorage.getItem("wg:" + key); return s ? JSON.parse(s) : null; } catch (e) { return null; }
    },
    set(key, val) {
      try { localStorage.setItem("wg:" + key, JSON.stringify(val)); } catch (e) { /* quota/private mode */ }
    },
  };

  return { MONTHS, MONTHS_LONG, COMPASS, $, $$, esc, num, fmt, clamp, msToMph, compass, fetchJSON, fetchText, fetchBlob, keptInfo, keepClear, pool, debounce,
    parseCoords, toast, download, linreg, cache };
})();
