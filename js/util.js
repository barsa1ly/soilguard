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

  /* Pacing, never a quota: at most 6 requests from this page are open to one server at the same instant; more wait in
     line, first come first served, and each is sent as soon as one before it is answered, so a visitor can ask as much
     and for as long as they like. With 50 to 75 visitors at once this keeps each page from opening dozens of
     connections to one small server (Soil Data Access, The National Map) at the same moment. A request holds its place
     from when it is sent until its answer starts (the headers), not while a long answer downloads; the time spent in
     line does not count against its time limits; a caller's stop takes a waiting request out of the line unsent. The
     app's own files (same origin) skip the line: the GitHub Pages CDN is not the bottleneck. Leaflet's map tiles and
     WMS images are <img> loads, outside this; the browser paces those itself. */
  const PER_HOST = 6, lines = new Map(); // host -> { open: sent and not yet answered, wait: in line }
  function slot(host, sig) {
    let L = lines.get(host);
    if (!L) lines.set(host, (L = { open: 0, wait: [] }));
    return new Promise((res, rej) => {
      if (sig.aborted) { rej(sig.reason); return; }
      if (L.open < PER_HOST) { L.open++; res(); return; }
      const w = {
        go: () => { sig.removeEventListener("abort", w.off); res(); },
        off: () => { const k = L.wait.indexOf(w); if (k >= 0) { L.wait.splice(k, 1); rej(sig.reason); } },
      };
      L.wait.push(w);
      sig.addEventListener("abort", w.off, { once: true });
    });
  }
  // a place let go passes straight to the first in line
  function free(host) { const L = lines.get(host), w = L.wait.shift(); if (w) w.go(); else L.open--; }

  /* Asked again, at most twice, when the server is busy or failing (HTTP 429, 502, 503, 504) or the request did not get
     through (fetch's TypeError: the network dropped, or an error page came without a CORS header): after about 1 s,
     then 3 s, each times a random 0.5 to 1.5 so that pages turned away at the same moment do not all come back at once,
     or after the server's Retry-After (seconds or a date, where the server lets pages read it), at least 0.5 s (a
     Retry-After of 0 or a past date would send the page straight back to a server that said it is busy) and at most
     20 s. The place in line is let go while it waits. A 502, a 504 or a request that did not get through is asked
     again only when it failed within 8 s: one that came later is most likely a gateway that has already waited its own
     limit for the server behind it (an NHDPlus HR query failed after 10 s on 12 Nov 2026), and two more tries would
     triple the wait for an error. Never on another 4xx (the same question gets the same answer), on the caller's stop,
     or on this module's own time limit (a 45 s wait should not become 135 s). POST is asked again too: the app's POSTs
     are read-only queries (Soil Data Access, ACIS, The National Map's query by POST), so a second ask changes nothing
     on the server. */
  const BUSY = new Set([429, 503]), GATE = new Set([502, 504]), SLOW_MS = 8000, BACK = [1000, 3000], BACK_MAX = 20000;
  const again = (r, err, ms) => (err ? err instanceof TypeError && ms < SLOW_MS : BUSY.has(r.status) || (GATE.has(r.status) && ms < SLOW_MS));
  function backoff(r, k) {
    const h = r ? (r.headers.get("Retry-After") || "").trim() : "", ms = !h ? NaN : /^\d+$/.test(h) ? h * 1000 : Date.parse(h) - Date.now();
    return Math.min(BACK_MAX, Number.isFinite(ms) ? Math.max(500, ms) : BACK[k] * (0.5 + Math.random()));
  }
  const nap = (ms, sig) => new Promise((res, rej) => {
    if (sig.aborted) { rej(sig.reason); return; }
    const off = () => { clearTimeout(t); rej(sig.reason); }, t = setTimeout(() => { sig.removeEventListener("abort", off); res(); }, ms);
    sig.addEventListener("abort", off, { once: true });
  });
  const where = url => { try { const u = new URL(url, location.href); return { host: u.host, own: u.origin === location.origin }; } catch (e) { return { host: "the server", own: false }; } };

  /* One request through its server's line, asked again as above. o.timeoutMs caps the whole answer and o.headerMs the
     wait for it to start, both counted from when it is sent (anew for each try), never while it waits. o.read(r) reads
     the answer within o.timeoutMs; without it the Response is returned, and o.timeoutMs and the caller's signal still
     cover the reading of its body. o.plain: a time limit stops the request with no message of its own (fetchText's
     way, kept). A caller's stop with no reason of its own is DOMException "Stopped", as before. */
  async function send(url, opts = {}, o = {}) {
    const { host, own } = where(url), sig = opts.signal, ctrl = new AbortController();
    const stop = () => ctrl.abort(sig.reason && sig.reason.name !== "AbortError" ? sig.reason : new DOMException("Stopped", "AbortError"));
    const late = () => (o.plain ? ctrl.abort() : ctrl.abort(new Error(`${host} did not answer in time`)));
    let timer = 0, hdr = 0, lent = false;
    if (sig) { if (sig.aborted) stop(); else sig.addEventListener("abort", stop, { once: true }); }
    try {
      for (let k = 0; ; k++) {
        if (!own) await slot(host, ctrl.signal);
        let r = null, err = null, t0 = 0;
        try {
          if (o.timeoutMs) timer = setTimeout(late, o.timeoutMs);
          if (o.headerMs) hdr = setTimeout(late, o.headerMs);
          t0 = Date.now();
          r = await fetch(url, { ...opts, signal: ctrl.signal });
        } catch (e) { err = e; } finally { clearTimeout(hdr); if (!own) free(host); }
        if (k < BACK.length && !ctrl.signal.aborted && again(r, err, Date.now() - t0)) {
          clearTimeout(timer);
          const ms = backoff(r, k);
          if (r && r.body) r.body.cancel().catch(() => {});
          await nap(ms, ctrl.signal);
          continue;
        }
        if (err) throw err;
        if (!o.read) { lent = true; return r; }
        return await o.read(r);
      }
    } finally {
      if (!lent) { clearTimeout(timer); clearTimeout(hdr); if (sig) sig.removeEventListener("abort", stop); }
    }
  }
  /* fetch(url, opts) through the server's line, asked again as above: the Response, for the modules that read it
     themselves (byte ranges, GeoTIFFs, HEAD). timeoutMs caps the whole answer, its body too (0: none), and headerMs the
     wait for it to start, both from when it is sent; opts.signal stops it in line, between tries or while its body is read. */
  const fetchQ = (url, opts = {}, timeoutMs = 0, headerMs = 0) => send(url, opts, { timeoutMs, headerMs });

  /* headerMs caps the wait for the server to start answering; timeoutMs caps the whole download; a caller's own signal
     (opts.signal) cancels the request too. */
  async function fetchJSON(url, opts = {}, timeoutMs = 45000, headerMs = timeoutMs) {
    const key = keepKey(url, opts), hit = key && (await kept(key));
    if (hit) { try { return await hit.json(); } catch (e) { /* a broken copy: asked again */ } }
    return send(url, opts, { timeoutMs, headerMs, read: async r => {
      if (!r.ok) {
        let msg = r.status + " " + r.statusText;
        try { const j = await r.json(); msg = j.reason || j.message || msg; } catch (e) { /* not json */ }
        throw new Error(msg);
      }
      if (key) keep(key, r);
      return r.json();
    } });
  }

  async function fetchText(url, timeoutMs = 45000, headerMs = timeoutMs) {
    const key = keepKey(url, {}), hit = key && (await kept(key));
    if (hit) { try { return await hit.text(); } catch (e) { /* a broken copy: asked again */ } }
    return send(url, {}, { timeoutMs, headerMs, plain: true, read: async r => {
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      if (key) keep(key, r);
      return r.text();
    } });
  }

  /* a file as a Blob; type: a pattern its Content-Type must match, as some servers answer an error with a page and
     HTTP 200 (MapServer's XML for a map it cannot draw): such an answer is an error, and is not kept */
  async function fetchBlob(url, timeoutMs = 45000, type = null) {
    const key = keepKey(url, {}), hit = key && (await kept(key));
    if (hit) { try { const b = await hit.blob(); if (!type || type.test(b.type)) return b; } catch (e) { /* a broken copy: asked again */ } }
    return send(url, {}, { timeoutMs, read: async r => {
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      const ct = r.headers.get("Content-Type") || "";
      if (type && !type.test(ct)) { const t = await r.text().catch(() => ""); throw new Error(`the server answered ${ct || "no type"}${t ? `: ${t.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160)}` : ""}`); }
      if (key) keep(key, r);
      return r.blob();
    } });
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

  return { MONTHS, MONTHS_LONG, COMPASS, $, $$, esc, num, fmt, clamp, msToMph, compass, fetchJSON, fetchText, fetchBlob, fetchQ, keptInfo, keepClear, pool, debounce,
    parseCoords, toast, download, linreg, cache };
})();
