/* Wind and moisture data, read from the producers first; Open-Meteo's copy is only a fallback:
   - hourly 10 m wind: NASA MERRA-2 directly from NASA POWER; ECMWF IFS 9 km (2017 on) / ERA5 0.25° (before) through
     Open-Meteo when NASA fails or is chosen (ECMWF and the Copernicus CDS need an account key and queued jobs);
   - daily precipitation, grass reference ET and temperature: gridMET 4 km from the University of Idaho THREDDS server
     (or, when it does not answer, gridMET's yearly files on the University's file server, read in place by byte ranges),
     then NASA POWER daily (Penman–Monteith ET0 computed here), then Open-Meteo;
   - airport observations: NOAA NCEI GHCNh (official archive), else the Iowa Environmental Mesonet ASOS archive;
   - West Texas Mesonet 10 m towers (off unless switched on): NWS SHEF reports in the Iowa Environmental Mesonet DCP archive.
   The gridded wind is calibrated to the nearest station, then analyzed for erosive wind climate. */
WG.wind = (function () {
  const { fetchJSON, fetchText, pool, linreg, MONTHS } = WG.util;
  const ARCHIVE = "https://archive-api.open-meteo.com/v1/archive";
  const POWER_H = "https://power.larc.nasa.gov/api/temporal/hourly/point";
  const POWER_D = "https://power.larc.nasa.gov/api/temporal/daily/point";
  const GRIDMET = "https://thredds.northwestknowledge.net/thredds/dodsC/agg_met_";
  let CST = -6 * 3600; // the local standard-time offset for days and months: the location's state's (setZone), Central until one is chosen
  const DAYS = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const GUST_EVENT = 17.9; // m/s (40 mph) daily max gust ~ blowing-dust days

  const epochDay = (y, m, d) => Date.UTC(y, m, d) / 864e5;
  const monthOf = (t, off) => new Date((t + off) * 1000).getUTCMonth();
  const dayKey = (t, off) => Math.floor((t + off) / 86400);
  const stampDay = (t, off) => Math.round((t + off) / 86400); // local-midnight stamps, robust to DST

  function yearsFor(n) {
    const end = new Date().getFullYear() - 1; // last complete year
    return { start: end - n + 1, end };
  }

  /* ---- analysis period ----
     Days are calendar days in the location's state's standard time (no daylight saving) on one fixed axis: with the
     offset UTC-h, local day k runs from k*86400 + h*3600 to (k+1)*86400 + h*3600 UTC seconds, for both models and the
     stations (Texas, Central: h = 6). A period is {n} (the last n complete
     calendar years the data reach) or {from, to} (ISO dates), resolved against the chosen model's limits. */
  const DAY = 86400;
  let CST_S = -CST;
  // the state's standard time, set when a location is chosen (its state's file gives the offset in hours, e.g. -6)
  function setZone(hours) { if (Number.isFinite(hours)) { CST = Math.round(hours) * 3600; CST_S = -CST; } }
  const zoneHours = () => CST / 3600; // e.g. -6
  const zoneLabel = () => `UTC${CST < 0 ? "−" : "+"}${Math.abs(CST / 3600)}`; // e.g. UTC−6
  const tzEtc = () => `Etc/GMT${CST <= 0 ? "+" : "-"}${Math.abs(CST / 3600)}`; // Open-Meteo's fixed-offset zone: Etc/GMT+6 is UTC−6
  const hh = k => String(((CST_S / 3600 + k) % 24 + 24) % 24).padStart(2, "0"); // UTC hour of local midnight (+k hours)
  const isoDay = d => new Date(d * 864e5).toISOString().slice(0, 10);
  const ymd = d => isoDay(d).replace(/-/g, "");
  const parseDay = s => epochDay(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  const yearOf = d => new Date(d * 864e5).getUTCFullYear();
  const today = () => Math.floor((Date.now() / 1000 - CST_S) / DAY);
  const dayLabel = d => { const x = new Date(d * 864e5); return `${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]} ${x.getUTCFullYear()}`; };
  /* Days a model can serve together with the daily moisture: NASA POWER hourly from 2001 (about 7 days behind);
     ECMWF via Open-Meteo from 1940, here from 1979 to match gridMET (a few days behind). */
  function limits(model) {
    const t = today();
    return model === "ecmwf" ? { first: epochDay(1979, 0, 1), last: t - 3 } : { first: epochDay(2001, 0, 1), last: t - 8 };
  }
  const span = (d0, d1) => ({ d0, d1, t0: d0 * DAY + CST_S, t1: (d1 + 1) * DAY + CST_S, days: d1 - d0 + 1 });
  /* the most days d0..d1 has in one calendar month (analyze() summarises a month only from 20 days or more) */
  function monthDays(d0, d1) {
    let most = 0;
    for (let a = d0; a <= d1;) {
      const x = new Date(a * 864e5), next = epochDay(x.getUTCFullYear(), x.getUTCMonth() + 1, 1);
      most = Math.max(most, Math.min(next, d1 + 1) - a);
      a = next;
    }
    return most;
  }
  /* Custom dates also give overlap, the days of the request inside the record (with fewer than 30 the period would
     be made of days not asked for, so callers refuse it), and moved, true when the dates were cut or stretched. */
  function resolvePeriod(p, model) {
    const L = limits(model), req = p && p.from && p.to ? [parseDay(p.from), parseDay(p.to)] : null;
    let d0, d1, preset = null;
    if (req) {
      d1 = Math.min(L.last, Math.max(L.first + 29, req[1]));
      d0 = Math.max(L.first, Math.min(d1 - 29, req[0])); // at least 30 days
    } else {
      preset = (p && p.n) || 10;
      let y1 = yearOf(L.last);
      if (epochDay(y1, 11, 31) > L.last) y1--;
      const y0 = Math.max(y1 - preset + 1, yearOf(L.first));
      d0 = epochDay(y0, 0, 1); d1 = epochDay(y1, 11, 31);
    }
    const w = span(d0, d1), y0 = yearOf(d0), y1 = yearOf(d1);
    return { ...w, years: w.days / 365.2425, y0, y1, preset, from: isoDay(d0), to: isoDay(d1), limits: L,
      overlap: req ? Math.min(req[1], L.last) - Math.max(req[0], L.first) + 1 : null, moved: !!req && (d0 !== req[0] || d1 !== req[1]),
      monthDays: monthDays(d0, d1), label: preset ? `${y0}–${y1}` : `${dayLabel(d0)} – ${dayLabel(d1)}` };
  }
  const trim = (h, t0, t1) => {
    const keep = h.t.map(t => t >= t0 && t < t1);
    const pick = a => a.filter((_, i) => keep[i]);
    return Object.fromEntries(Object.entries(h).map(([k, a]) => [k, Array.isArray(a) ? pick(a) : a]));
  };

  /* ---- hourly gridded wind ---- */
  /* headerMs: how long to wait for the server to start answering (fetchWind uses 20 s before switching models;
     a download that has started may still run to 90 s). */
  async function ecmwfWind(lat, lon, P, headerMs = 90000) {
    const d1 = Math.min(P.d1, today() - 1), n = d1 - P.d0 + 1, chunk = n > 2200 ? Math.ceil(n / 2) : n, spans = [];
    for (let a = P.d0; a <= d1; a += chunk) spans.push([a, Math.min(d1, a + chunk - 1)]); // parallel chunks cut wall-clock time
    const parts = await Promise.all(spans.map(([a, b]) => fetchJSON(`${ARCHIVE}?${new URLSearchParams({
      latitude: lat.toFixed(4), longitude: lon.toFixed(4), start_date: isoDay(a), end_date: isoDay(b),
      hourly: "wind_speed_10m,wind_direction_10m", daily: "wind_gusts_10m_max",
      wind_speed_unit: "ms", timezone: tzEtc(), timeformat: "unixtime", // the state's standard-time days, like MERRA-2's axis
    })}`, {}, 90000, headerMs)));
    const cat = (k, sect) => parts.flatMap(p => p[sect][k]);
    const off = parts[0].utc_offset_seconds, dt = cat("time", "daily"), g = cat("wind_gusts_10m_max", "daily");
    return {
      model: "ecmwf", lat: parts[0].latitude, lon: parts[0].longitude, elevation: parts[0].elevation, offset: off,
      hourly: trim({ t: cat("time", "hourly"), ws: cat("wind_speed_10m", "hourly"), wd: cat("wind_direction_10m", "hourly") }, P.t0, P.t1),
      gust: new Map(dt.map((t, i) => [stampDay(t, off), g[i]])),
    };
  }

  /* UTC dates a..b (epoch days) of hourly MERRA-2 */
  async function powerHourly(lat, lon, a, b, headerMs) {
    const q = new URLSearchParams({ parameters: "WS10M,WD10M", community: "AG", longitude: lon.toFixed(4), latitude: lat.toFixed(4),
      start: ymd(a), end: ymd(b), format: "CSV", "time-standard": "UTC" });
    const [head, body = ""] = (await fetchText(`${POWER_H}?${q}`, 90000, headerMs)).split("-END HEADER-");
    const elev = +((head.match(/= *(-?[\d.]+) *meters/) || [])[1]);
    const t = [], ws = [], wd = [];
    body.trim().split("\n").slice(1).forEach(l => {
      const f = l.split(",");
      if (f.length < 6) return;
      t.push(Date.UTC(+f[0], +f[1] - 1, +f[2], +f[3]) / 1000);
      ws.push(+f[4] < 0 ? null : +f[4]);
      wd.push(+f[5] < 0 ? null : +f[5]);
    });
    if (!t.length) throw new Error("NASA POWER returned no hourly data");
    return { t, ws, wd, elevation: Number.isFinite(elev) ? elev : null };
  }

  /* NASA MERRA-2 has no gust variable; gust stays empty and calibration maps daily max wind to station gusts. */
  /* The local days d0..d1 need UTC dates d0..d1+1 (the last hours of local d1 fall on the next UTC date); the
     hours are then trimmed to the period, so no stub of the previous local year enters the analysis. */
  async function merraWind(lat, lon, P, headerMs = 90000) {
    const b = P.d1 + 1, h = Math.floor((P.d0 + b) / 2);
    const spans = b - P.d0 > 3650 ? [[P.d0, h], [h + 1, b]] : [[P.d0, b]];
    const parts = await Promise.all(spans.map(([x, y]) => powerHourly(lat, lon, x, y, headerMs)));
    const cat = k => parts.flatMap(p => p[k]);
    return {
      model: "merra2", lat: Math.round(lat / 0.5) * 0.5, lon: Math.round(lon / 0.625) * 0.625, elevation: parts[0].elevation,
      offset: CST, hourly: trim({ t: cat("t"), ws: cat("ws"), wd: cat("wd") }, P.t0, P.t1), gust: null,
    };
  }

  /* ---- daily precipitation, reference ET and temperature ---- */
  const GM = {
    pr: "precipitation_amount", pet: "daily_mean_reference_evapotranspiration_grass",
    tmmx: "daily_maximum_temperature", tmmn: "daily_minimum_temperature",
    srad: "daily_mean_shortwave_radiation_at_surface", rmax: "daily_maximum_relative_humidity", rmin: "daily_minimum_relative_humidity",
    vs: "daily_mean_wind_speed", sph: "daily_mean_specific_humidity", th: "daily_mean_wind_direction",
    etr: "daily_mean_reference_evapotranspiration_alfalfa",
  };
  const GM_DAY0 = epochDay(1979, 0, 1);
  /* gridMET's own files, when THREDDS does not answer: the University of Idaho's file server keeps a NetCDF-4 file a
     variable a year (pr_2025.nc ..., 50 to 100 MB, chunks of about 60 days by 100 by 230 cells), read in place by byte
     ranges (js/h5range.js), only the chunks that hold the cells asked: about 2 to 5 MB a variable a year for one cell,
     and hardly more for a box of cells in the same chunks. Their variables are named by CF standard names, not THREDDS's.
     Values as from THREDDS: raw x scale_factor + add_offset, the fill value missing. Once THREDDS has failed in this
     visit, every read goes to the file server. */
  const MDATA = "https://www.northwestknowledge.net/metdata/data/";
  const GM_FILE = { pr: "precipitation_amount", pet: "potential_evapotranspiration", etr: "potential_evapotranspiration", tmmx: "air_temperature", tmmn: "air_temperature",
    srad: "surface_downwelling_shortwave_flux_in_air", rmax: "relative_humidity", rmin: "relative_humidity", vs: "wind_speed", sph: "specific_humidity", th: "wind_from_direction" };
  let gmDown = false;
  const gmFailed = e => { if (!gmDown) console.warn(`gridMET: THREDDS did not answer (${(e && e.message) || e || "no answer"}); reading its yearly files from the file server instead`); gmDown = true; };
  /* one variable over days a..b (epoch days) for the cells ja..jb by ia..ib, from the yearly files: put(j, i, k, value),
     k = day - a, null where the file holds its fill value */
  async function gmFileBox(v, ja, jb, ia, ib, a, b, put) {
    const years = [];
    for (let y = yearOf(a); y <= yearOf(b); y++) years.push(y);
    await pool(years, 2, y => WG.h5range.withFile(`${MDATA}${v}_${y}.nc`, async F => {
      const x = await F.dataset(GM_FILE[v]), y0 = epochDay(y, 0, 1), n = x.shape[0], A = x.attrs;
      if (x.rank !== 3 || x.shape[1] !== 585 || x.shape[2] !== 1386) throw new Error(`${v}_${y}.nc is not laid out as gridMET's grid`);
      const s = Math.max(a, y0), e = Math.min(b, y0 + n - 1);
      if (e < s) return;
      const att = (k, d) => (Number.isFinite(A[k]) ? A[k] : d), scale = att("scale_factor", 1), add = att("add_offset", 0), fill = att("_FillValue", 32767);
      const nj = jb - ja + 1, ni = ib - ia + 1, raw = await F.read(x, [s - y0, ja, ia], [e - s + 1, nj, ni]);
      for (let t = 0; t <= e - s; t++) for (let q = 0; q < nj; q++) for (let r = 0; r < ni; r++) {
        const w = raw[(t * nj + q) * ni + r];
        put(ja + q, ia + r, s - a + t, w === fill ? null : w * scale + add);
      }
    }));
  }
  // the last day in the current year's file (the year before's while the new year's file is not there yet)
  async function gmFileLast() {
    for (const y of [yearOf(today()), yearOf(today()) - 1]) {
      try { return await WG.h5range.withFile(`${MDATA}pr_${y}.nc`, async F => epochDay(y, 0, 1) + (await F.dataset("day")).shape[0] - 1); } catch (e) { /* the next year back */ }
    }
    throw new Error("gridMET's file server did not answer");
  }
  const ACIS = "https://data.rcc-acis.org/GridData", PRISM_DAY0 = epochDay(1981, 0, 1), PRISM_BOX = [24.0625, 49.9375, -125.0208333, -66.4791667];
  // what a file from PRISM must say: PRISM's terms ask for its name, address and the date read. rest: where its other variables came from
  // the credit PRISM's terms ask for: its name, address and the date read
  const prismCredit = () => `PRISM 4 km (PRISM Group, Oregon State University, https://prism.oregonstate.edu, accessed ${new Date().toISOString().slice(0, 10)}), read through ACIS (NOAA Regional Climate Centers)`;
  const prismNote = (rest = "gridMET") => `Rain, Tmax and Tmin: ${prismCredit()}. Solar radiation, humidity and wind: ${rest || "none, as neither gridMET nor NASA POWER answered"}; PRISM has no wind. PRISM's day ends at 1200 UTC on its date, so each calendar day here holds PRISM's next date, ${rest ? `to line up with ${rest}` : "which covers most of that calendar day"}: expect a one-day difference from PRISM's own files. Its last six months are provisional and can change. ${rest ? "ET0 is FAO-56 Penman-Monteith worked out here from these, or Hargreaves (FAO-56 Eq. 52) on days without them." : "ET0 is Hargreaves (FAO-56 Eq. 52), worked out here from Tmax and Tmin alone, as there is no solar radiation, humidity or wind."}`;
  // PRISM's last calendar day for certain: it holds PRISM's next date, which ACIS has about a day after that day ends at 1200 UTC.
  // ACIS can have more, up to today - 1 (its PRISM date, today, ended at 1200 UTC), so later days are asked, not refused
  const prismLast = () => today() - 3;

  /* gridMET's last day, read once from the length of its day axis (it is about two days behind): THREDDS's, waiting 8 s
     for its first answer, else the current year's file on the file server. The visit's first gridMET request, so it also
     finds out whether THREDDS answers. */
  let gmLast = null;
  function gridmetLast() {
    return gmLast || (gmLast = (async () => {
      if (!gmDown) {
        const dds = await fetchText(`${GRIDMET}pr_1979_CurrentYear_CONUS.nc.dds`, 15000, 8000).catch(e => { gmFailed(e); return ""; });
        const n = +((dds.match(/day = (\d+)\]/) || [])[1]);
        if (n > 0) return GM_DAY0 + n - 1;
        if (dds) gmFailed(new Error("no day axis in its answer"));
      }
      return gmFileLast().catch(() => today() - 4);
    })());
  }

  /* at most n requests in flight at once; the rest wait their turn, and a slot passes straight to the next */
  const gate = n => {
    let busy = 0;
    const queue = [];
    return async fn => {
      if (busy < n) busy++; else await new Promise(r => queue.push(r));
      try { return await fn(); } finally { if (queue.length) queue.shift()(); else busy--; }
    };
  };
  // THREDDS at the University of Idaho: polite, 6 requests at a time from the page
  const gmGate = gate(6);
  /* a variable's packing (scale, offset, fill) from the dataset attributes, read once for the page */
  const gmPack = new Map();
  function packOf(v) {
    if (!gmPack.has(v)) {
      const name = GM[v], p = gmGate(() => fetchText(`${GRIDMET}${v}_1979_CurrentYear_CONUS.nc.das`, 20000)).then(das => {
        const k0 = das.indexOf(`${name} {`), block = das.slice(k0, das.indexOf("}", k0));
        const att = (k, dflt) => { const m = block.match(new RegExp(`${k} (-?[\\d.eE+-]+);`)); return m ? +m[1] : dflt; };
        return { scale: att("scale_factor", 1), add: att("add_offset", 0), fill: att("_FillValue", 32767) };
      });
      // a failed read is forgotten, so the next call tries again
      p.catch(() => gmPack.delete(v));
      gmPack.set(v, p);
    }
    return gmPack.get(v);
  }
  /* One gridMET variable at one cell over OPeNDAP, or from the box read last when it holds that cell and those days. */
  async function gridmetVar(v, j, i, d0, d1) {
    const B = gmBox, kept = B && B.vals[v] && d0 >= B.a && d1 <= B.b ? B.vals[v].get(j * 2000 + i) : null;
    if (kept) return kept.slice(d0 - B.a, d1 - B.a + 1);
    if (!gmDown) {
      try {
        const name = GM[v], url = `${GRIDMET}${v}_1979_CurrentYear_CONUS.nc`;
        const [pk, txt] = await Promise.all([packOf(v),
          gmGate(() => fetchText(`${url}.ascii?${name}[${d0 - GM_DAY0}:1:${d1 - GM_DAY0}][${j}:1:${j}][${i}:1:${i}]`, 45000, 15000))]);
        const out = [];
        for (const m of txt.matchAll(/^\[(\d+)\]\[0\], (-?\d+(?:\.\d+)?)/gm)) out[+m[1]] = +m[2] === pk.fill ? null : +m[2] * pk.scale + pk.add;
        return out;
      } catch (e) { gmFailed(e); }
    }
    const out = new Array(d1 - d0 + 1).fill(null);
    await gmFileBox(v, j, j, i, i, d0, d1, (jj, ii, k, x) => { out[k] = x; });
    return out;
  }
  /* gridMET's variables for many cells at once: a box of cells in one request a variable (each row's span instead when
     the box would be mostly empty), split by years so no answer passes 2 million values; a failed request is tried
     once more, and a variable that still fails is left to gridmetVar. Kept until the next call, so dailyWeather at
     these cells reads nothing more; gridmetBox(null) forgets it. points [[lat, lon]], tick(done, total). */
  let gmBox = null;
  async function gridmetBox(points, d0, d1, tick) {
    gmBox = null;
    const cells = (points || []).map(([lat, lon]) => [Math.round((49.4 - lat) * 24), Math.round((lon + 124.7666666333) * 24)]).filter(([j, i]) => j >= 0 && j <= 584 && i >= 0 && i <= 1385);
    if (!cells.length) return 0;
    const last = await gridmetLast(), a = Math.max(d0, GM_DAY0), b = Math.min(d1, last);
    if (b < a) return 0;
    const js = cells.map(c => c[0]), is = cells.map(c => c[1]), j0 = Math.min(...js), j1 = Math.max(...js), i0 = Math.min(...is), i1 = Math.max(...is);
    const boxes = (j1 - j0 + 1) * (i1 - i0 + 1) <= 3 * cells.length + 16 ? [[j0, j1, i0, i1]]
      : [...new Set(js)].map(j => { const r = cells.filter(c => c[0] === j).map(c => c[1]); return [j, j, Math.min(...r), Math.max(...r)]; });
    const reqs = [];
    boxes.forEach(([ja, jb, ia, ib]) => { const step = Math.max(1, Math.floor(2e6 / ((jb - ja + 1) * (ib - ia + 1)))); for (let s = a; s <= b; s += step) reqs.push([ja, jb, ia, ib, s, Math.min(b, s + step - 1)]); });
    const vars = ["pr", "tmmx", "tmmn", "srad", "rmax", "rmin", "vs", "sph", "pet"], jobs = vars.flatMap(v => reqs.map(r => [v, ...r]));
    const box = { a, b, vals: {} }, bad = new Set();
    let done = 0;
    if (gmDown) {
      // the yearly files: a box (or each row's span) a variable, every year's file in turn; the chunks are what it costs
      const fjobs = vars.flatMap(v => boxes.map(x => [v, ...x]));
      await pool(fjobs, 2, async ([v, ja, jb, ia, ib]) => {
        const per = box.vals[v] || (box.vals[v] = new Map());
        try {
          await gmFileBox(v, ja, jb, ia, ib, a, b, (j, i, k, x) => { const key = j * 2000 + i; let arr = per.get(key); if (!arr) per.set(key, (arr = new Array(b - a + 1).fill(null))); arr[k] = x; });
        } catch (err) { console.warn(`gridMET ${v} from the file server for the box failed: left to a read per cell`, err); bad.add(v); }
        if (tick) tick(++done, fjobs.length);
      });
      bad.forEach(v => { delete box.vals[v]; });
      gmBox = box;
      return fjobs.length;
    }
    await pool(jobs, 6, async ([v, ja, jb, ia, ib, s, e]) => {
      if (bad.has(v)) { if (tick) tick(++done, jobs.length); return; }
      const url = `${GRIDMET}${v}_1979_CurrentYear_CONUS.nc.ascii?${GM[v]}[${s - GM_DAY0}:1:${e - GM_DAY0}][${ja}:1:${jb}][${ia}:1:${ib}]`;
      let pk, txt;
      for (let t = 0; t < 2 && !txt; t++) {
        try { pk = await packOf(v); txt = await gmGate(() => fetchText(url, 180000, 60000)); } catch (err) { if (t) { console.warn(`gridMET ${v} for the box failed: left to a request per cell`, err); bad.add(v); } }
      }
      if (txt) {
        const per = box.vals[v] || (box.vals[v] = new Map());
        for (const m of txt.matchAll(/^\[(\d+)\]\[(\d+)\], (.+)$/gm)) {
          const k = s - a + +m[1], row = (ja + +m[2]) * 2000 + ia;
          m[3].split(", ").forEach((x, q) => {
            let arr = per.get(row + q);
            if (!arr) per.set(row + q, (arr = new Array(b - a + 1)));
            arr[k] = +x === pk.fill ? null : +x * pk.scale + pk.add;
          });
        }
      }
      if (tick) tick(++done, jobs.length);
    });
    bad.forEach(v => { delete box.vals[v]; });
    gmBox = box;
    return jobs.length;
  }

  /* Day-aligned series d0..d0+n-1 from (epoch day, value) pairs. */
  function align(source, d0, n, days, cols, lat, lon) {
    const ix = new Map(days.map((d, k) => [d, k]));
    const pick = a => Array.from({ length: n }, (_, k) => { const i = ix.get(d0 + k); return i === undefined ? null : a[i] ?? null; });
    return { source, d0, p: pick(cols.p), et0: pick(cols.et0), tmean: pick(cols.tmean), lat, lon };
  }

  /* Producers first: gridMET, then NASA POWER daily; Open-Meteo's ECMWF daily only if both fail. */
  async function fetchMoisture(lat, lon, P) {
    const d0 = P.d0, n = P.days;
    try {
      const j = Math.round((49.4 - lat) * 24), i = Math.round((lon + 124.7666666333) * 24); // 1/24° grid from 49.4N, 124.767W
      if (j < 0 || j > 584 || i < 0 || i > 1385) throw new Error("outside the gridMET domain");
      if (d0 < GM_DAY0) throw new Error("gridMET starts in 1979");
      const d1 = Math.min(P.d1, await gridmetLast());
      if (d1 < d0) throw new Error("gridMET does not reach this period yet");
      const [p, et0, tx, tn] = await Promise.all(["pr", "pet", "tmmx", "tmmn"].map(v => gridmetVar(v, j, i, d0, d1)));
      const days = Array.from({ length: d1 - d0 + 1 }, (_, k) => d0 + k);
      if (p.filter(v => v !== null && v !== undefined).length < n * 0.8) throw new Error("gridMET has no data at this point");
      const tmean = days.map((_, k) => (tx[k] == null || tn[k] == null ? null : (tx[k] + tn[k]) / 2 - 273.15));
      return align("gridmet", d0, n, days, { p, et0, tmean }, 49.4 - j / 24, -124.7666666333 + i / 24);
    } catch (e) {
      console.warn("gridMET unavailable, trying NASA POWER daily", e);
    }
    try {
      return await powerDaily(lat, lon, P);
    } catch (e) {
      console.warn("NASA POWER daily unavailable, trying Open-Meteo daily", e);
    }
    const j = await fetchJSON(`${ARCHIVE}?${new URLSearchParams({
      latitude: lat.toFixed(4), longitude: lon.toFixed(4), start_date: isoDay(d0), end_date: isoDay(Math.min(P.d1, today() - 1)),
      daily: "precipitation_sum,et0_fao_evapotranspiration,temperature_2m_mean", timezone: tzEtc(), timeformat: "unixtime",
    })}`, {}, 90000);
    const D = j.daily;
    return align("open-meteo", d0, n, D.time.map(t => stampDay(t, j.utc_offset_seconds)),
      { p: D.precipitation_sum, et0: D.et0_fao_evapotranspiration, tmean: D.temperature_2m_mean }, j.latitude, j.longitude);
  }

  /* PRISM's own 4 km daily rain, Tmax and Tmin through ACIS GridData (NOAA Regional Climate Centers), grid 21. PRISM's
     day D is the 24 hours ending at 1200 UTC on D, so it is mostly calendar day D-1: for calendar day D this takes
     PRISM's label D+1, which puts it on the same days as gridMET and NASA POWER (2023 at 7 airports: Tmax r 0.99-1.00
     that way, 0.88-0.96 as labelled). ACIS answers 200 for a bad request: an empty body or an error off the grid, and
     for Honolulu a cell in North Dakota, so the returned cell is compared with the point. A range after prismLast() is
     asked from prismLast(), so days not out yet (ACIS gives -999) can be told from a place with no data; last is the
     latest day with data in the answer. Nothing after today - 1 is asked: no PRISM date for it has ended. */
  async function prismDays(lat, lon, a, b) {
    if (lat < PRISM_BOX[0] || lat > PRISM_BOX[1] || lon < PRISM_BOX[2] || lon > PRISM_BOX[3]) throw new Error("this point is outside PRISM (contiguous US only)");
    const elem = (name, units) => ({ name, units, prec: 2 }); // without prec, ACIS rounds temperatures to whole degrees
    const q0 = Math.min(a, prismLast()), q1 = Math.min(b, today() - 1);
    const res = await fetchJSON(ACIS, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ loc: `${lon.toFixed(4)},${lat.toFixed(4)}`, sdate: isoDay(q0 + 1), edate: isoDay(q1 + 1), grid: "21", meta: "ll,elev",
      elems: [elem("pcpn", "mm"), elem("maxt", "degreeC"), elem("mint", "degreeC")] }) }, 120000, 90000).catch(e => { throw new Error(`PRISM through ACIS gave no answer (${e.message || e})`); });
    if (res.error || !res.meta || !Array.isArray(res.data)) throw new Error(`PRISM through ACIS gave no data${res.error ? ` (${res.error})` : ""}`);
    if (Math.abs(res.meta.lat - lat) > 0.022 || Math.abs(res.meta.lon - lon) > 0.022) throw new Error("PRISM through ACIS answered for another place, so this point seems to be outside PRISM");
    const by = new Map(), v = x => (typeof x === "number" && x > -998 ? x : null);
    res.data.forEach(r => by.set(parseDay(r[0]) - 1, { p: v(r[1]), tx: v(r[2]), tn: v(r[3]) }));
    const got = [...by].filter(([, x]) => x.tx !== null || x.p !== null).map(([d]) => d);
    // nothing on days of the last week or so may be ACIS not having them yet; on older days it is the place
    if (!got.length) throw new Error(a > prismLast() - 7 ? "PRISM through ACIS has no data on these days at this point: its latest days may not be out yet, or the point is on open water"
      : "PRISM has no data at this point (open water or outside the US)");
    return { by, last: got.reduce((m, d) => Math.max(m, d)), lat: res.meta.lat, lon: res.meta.lon, elev: res.meta.elev > -1000 ? res.meta.elev * 0.3048 : null }; // ACIS gives elevation in feet
  }

  /* Daily weather for the model downloads, days d0..d1 (epoch days), in SI: precipitation mm, Tmax/Tmin °C, solar
     radiation MJ/m²/d, relative humidity max/min/mean %, dew point °C, vapour pressure kPa, wind m/s at 10 m and 2 m,
     grass ET0 mm. source "gridmet" (4 km, 1979 on, about 2 days behind; 10 m wind), "power" (NASA POWER, 0.5°,
     1981 on, solar from 1984, about a week behind; computed ET0) or "prism" (rain and temperature from PRISM, 4 km, 1981
     on; solar, humidity and wind from gridMET, or NASA POWER when gridMET does not answer; computed ET0). Missing values are null. */
  /* only: a subset of the gridMET variables (e.g. ["tmmx", "tmmn"] for a temperature climatology), or for PRISM just its own */
  async function dailyWeather(lat, lon, d0, d1, source = "gridmet", elev = null, only = null) {
    const days = [];
    if (source === "prism") {
      const a = Math.max(d0, PRISM_DAY0), none = last => new Error(`PRISM has no days in this range (1981 to ${isoDay(last)})`);
      if (d1 < a) throw none(prismLast());
      // from today on nothing is out yet: ACIS is asked only where its record ends, and the other sources not at all
      if (a > today() - 1) throw none(await prismDays(lat, lon, a, d1).then(P => P.last, () => prismLast()));
      const rest = async () => {
        if (only) return { from: null };
        try { return { from: "gridMET", w: await dailyWeather(lat, lon, a, d1, "gridmet", elev) }; } catch (e) { console.warn("PRISM's other variables from gridMET", e); }
        try { return { from: "NASA POWER", w: await dailyWeather(lat, lon, a, d1, "power", elev), why: "gridMET did not answer" }; } catch (e) { console.warn("PRISM's other variables from NASA POWER", e); }
        return { from: null, why: "neither gridMET nor NASA POWER answered" };
      };
      const [P, other] = await Promise.all([prismDays(lat, lon, a, d1), rest()]);
      if (P.last < a) throw none(P.last); // the place has data, only not yet on these days
      const z = elev ?? P.elev ?? 0, phi = (lat * Math.PI) / 180, w = other.w;
      const out = { source: "prism", lat: P.lat, lon: P.lon, elev: z, rest: other.from, restWhy: other.why || null, days, prcp: [], tmax: [], tmin: [], srad: [], rhmax: [], rhmin: [], rh: [], tdew: [], vp: [], wind10: [], wind2: [], et0: [] };
      for (let d = d0; d <= d1; d++) {
        const c = P.by.get(d) || { p: null, tx: null, tn: null }, k = d - a, g = key => (w && k >= 0 && w[key][k] !== undefined ? w[key][k] : null);
        days.push(d);
        out.prcp.push(c.p); out.tmax.push(c.tx); out.tmin.push(c.tn);
        ["srad", "rhmax", "rhmin", "rh", "tdew", "vp", "wind10", "wind2"].forEach(key => out[key].push(g(key)));
        out.et0.push(c.tx === null || c.tn === null ? null : fao56(d - epochDay(yearOf(d), 0, 1) + 1, phi, z, c.tx, c.tn, g("tdew"), g("wind2"), g("srad")));
      }
      return out;
    }
    if (source === "gridmet") {
      const j = Math.round((49.4 - lat) * 24), i = Math.round((lon + 124.7666666333) * 24);
      if (j < 0 || j > 584 || i < 0 || i > 1385) throw new Error("this point is outside gridMET (contiguous US only)");
      const last = await gridmetLast(), a = Math.max(d0, GM_DAY0), b = Math.min(d1, last);
      if (b < a) throw new Error("gridMET has no days in this range (1979 to " + isoDay(last) + ")");
      const vars = only || ["pr", "tmmx", "tmmn", "srad", "rmax", "rmin", "vs", "sph", "pet"];
      const got = await pool(vars, 3, v => gridmetVar(v, j, i, a, b));
      const V = Object.fromEntries(vars.map((v, k) => [v, got[k]]));
      const z = elev ?? 0, pAir = 101.3 * ((293 - 0.0065 * z) / 293) ** 5.26; // kPa, FAO-56 Eq. 7
      const out = { source: "gridmet", lat: 49.4 - j / 24, lon: -124.7666666333 + i / 24, elev: z, days, prcp: [], tmax: [], tmin: [], srad: [], rhmax: [], rhmin: [], rh: [], tdew: [], vp: [], wind10: [], wind2: [], et0: [] };
      for (let d = d0; d <= d1; d++) {
        const k = d - a, has = d >= a && d <= b, g = v => (has && V[v] && V[v][k] !== undefined ? V[v][k] : null);
        const tx = g("tmmx"), tn = g("tmmn"), q = g("sph"), u = g("vs"), sr = g("srad"), rx = g("rmax"), rn = g("rmin");
        const ea = q === null ? null : (q * pAir) / (0.622 + 0.378 * q); // kPa from specific humidity
        days.push(d);
        out.prcp.push(g("pr")); out.tmax.push(tx === null ? null : tx - 273.15); out.tmin.push(tn === null ? null : tn - 273.15);
        out.srad.push(sr === null ? null : sr * 0.0864); out.rhmax.push(rx); out.rhmin.push(rn); out.rh.push(rx === null || rn === null ? null : (rx + rn) / 2);
        out.vp.push(ea); out.tdew.push(ea === null || ea <= 0 ? null : (237.3 * Math.log(ea / 0.6108)) / (17.27 - Math.log(ea / 0.6108)));
        out.wind10.push(u); out.wind2.push(u === null ? null : u * 0.748); out.et0.push(g("pet"));
      }
      return out;
    }
    const a = Math.max(d0, epochDay(1981, 0, 1));
    const q = new URLSearchParams({ parameters: "PRECTOTCORR,T2M_MAX,T2M_MIN,T2MDEW,RH2M,WS2M,WS10M,ALLSKY_SFC_SW_DWN", community: "AG",
      longitude: lon.toFixed(4), latitude: lat.toFixed(4), start: ymd(a), end: ymd(d1), format: "JSON" });
    const res = await fetchJSON(`${POWER_D}?${q}`, {}, 90000, 30000);
    const P = res.properties.parameter, z = elev ?? ((res.geometry && res.geometry.coordinates[2]) || 0), fill = v => (v === undefined || v === -999 ? null : v);
    const phi = lat * Math.PI / 180;
    const out = { source: "power", lat, lon, elev: z, days, prcp: [], tmax: [], tmin: [], srad: [], rhmax: [], rhmin: [], rh: [], tdew: [], vp: [], wind10: [], wind2: [], et0: [] };
    for (let d = d0; d <= d1; d++) {
      const k = ymd(d), tx = fill(P.T2M_MAX[k]), tn = fill(P.T2M_MIN[k]), td = fill(P.T2MDEW[k]), u2 = fill(P.WS2M[k]), sr = fill((P.ALLSKY_SFC_SW_DWN || {})[k]);
      const ea = td === null ? null : 0.6108 * Math.exp((17.27 * td) / (td + 237.3));
      const J = d - epochDay(yearOf(d), 0, 1) + 1;
      days.push(d);
      out.prcp.push(fill(P.PRECTOTCORR[k])); out.tmax.push(tx); out.tmin.push(tn); out.srad.push(sr);
      out.rh.push(fill(P.RH2M[k])); out.rhmax.push(null); out.rhmin.push(null); out.tdew.push(td); out.vp.push(ea);
      out.wind10.push(fill(P.WS10M[k])); out.wind2.push(u2);
      out.et0.push(tx === null || tn === null ? null : fao56(J, phi, z, tx, tn, td, u2, sr));
    }
    return out;
  }

  /* FAO-56 daily grass reference ET0 (Allen et al. 1998, Eqs. 6–21, 37–40) from NASA POWER weather, which has
     no ET0 of its own. Days missing radiation, dew point or wind use Hargreaves–Samani (Eq. 52) instead. */
  function fao56(J, phi, z, tx, tn, td, u2, rs) {
    const es0 = T => 0.6108 * Math.exp((17.27 * T) / (T + 237.3));
    const dr = 1 + 0.033 * Math.cos(2 * Math.PI * J / 365), dec = 0.409 * Math.sin(2 * Math.PI * J / 365 - 1.39);
    const ws = Math.acos(Math.max(-1, Math.min(1, -Math.tan(phi) * Math.tan(dec))));
    const Ra = (24 * 60 / Math.PI) * 0.082 * dr * (ws * Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.sin(ws));
    const T = (tx + tn) / 2;
    if (td === null || u2 === null || rs === null) return Math.max(0, 0.0023 * (Ra / 2.45) * (T + 17.8) * Math.sqrt(Math.max(tx - tn, 0)));
    const delta = (4098 * es0(T)) / (T + 237.3) ** 2;
    const gamma = 0.000665 * 101.3 * ((293 - 0.0065 * z) / 293) ** 5.26;
    const es = (es0(tx) + es0(tn)) / 2, ea = Math.min(es0(td), es);
    const rso = (0.75 + 2e-5 * z) * Ra;
    const rnl = 4.903e-9 * (((tx + 273.16) ** 4 + (tn + 273.16) ** 4) / 2) * (0.34 - 0.14 * Math.sqrt(ea))
      * (1.35 * Math.min(1, rso > 0 ? rs / rso : 1) - 0.35);
    const rn = 0.77 * rs - rnl; // albedo 0.23, soil heat flux G = 0 for daily steps
    return Math.max(0, (0.408 * delta * rn + gamma * (900 / (T + 273)) * u2 * (es - ea)) / (delta + gamma * (1 + 0.34 * u2)));
  }

  async function powerDaily(lat, lon, per) {
    const d0 = per.d0, n = per.days;
    const q = new URLSearchParams({ parameters: "PRECTOTCORR,T2M,T2M_MAX,T2M_MIN,T2MDEW,WS2M,ALLSKY_SFC_SW_DWN", community: "AG",
      longitude: lon.toFixed(4), latitude: lat.toFixed(4), start: ymd(Math.max(d0, epochDay(1981, 0, 1))), end: ymd(per.d1), format: "JSON" });
    const res = await fetchJSON(`${POWER_D}?${q}`, {}, 90000, 20000);
    const P = res.properties.parameter, z = (res.geometry && res.geometry.coordinates[2]) || 0;
    const keys = Object.keys(P.T2M), fill = v => (v === undefined || v === -999 ? null : v);
    const days = keys.map(k => epochDay(+k.slice(0, 4), +k.slice(4, 6) - 1, +k.slice(6, 8)));
    const phi = lat * Math.PI / 180;
    const et0 = keys.map((k, i) => {
      const tx = fill(P.T2M_MAX[k]), tn = fill(P.T2M_MIN[k]);
      if (tx === null || tn === null) return null;
      const J = days[i] - epochDay(+k.slice(0, 4), 0, 1) + 1;
      return fao56(J, phi, z, tx, tn, fill(P.T2MDEW[k]), fill(P.WS2M[k]), fill((P.ALLSKY_SFC_SW_DWN || {})[k])); // no solar before 1984
    });
    if (et0.filter(v => v !== null).length < n * 0.8) throw new Error("NASA POWER has too few days at this point");
    return align("nasa-power", d0, n, days, { p: keys.map(k => fill(P.PRECTOTCORR[k])), et0, tmean: keys.map(k => fill(P.T2M[k])) }, lat, lon);
  }

  /* Hourly wind from the chosen model plus daily moisture, on one local-day axis. If the chosen model errors or
     has not started answering within 20 s, the other one is used (NASA direct by default, Open-Meteo as backup). */
  /* P: the period resolved for `model`. The other model keeps P when its record holds it (the stations are read for
     P); otherwise a preset is resolved again for it and custom dates are cut to its record, and when that leaves
     fewer than 30 days or no month of 20, the first model's error stands rather than analysing other dates. */
  async function fetchWind(lat, lon, P, model = "merra2") {
    const fn = { merra2: merraWind, ecmwf: ecmwfWind }, other = model === "merra2" ? "ecmwf" : "merra2";
    let moisture = fetchMoisture(lat, lon, P), per = P, w;
    moisture.catch(() => {}); // awaited below unless replaced
    try {
      w = await fn[model](lat, lon, P, 20000);
    } catch (e) {
      console.warn(`${model} wind unavailable, trying the other model`, e);
      const L = limits(other);
      if (P.d0 < L.first || P.d1 > L.last) {
        per = resolvePeriod(P.preset ? { n: P.preset } : { from: P.from, to: P.to }, other);
        if (!P.preset && (per.overlap < 30 || per.monthDays < 20)) throw e;
        moisture = fetchMoisture(lat, lon, per);
      }
      w = await fn[other](lat, lon, per);
      w.fellBack = true;
    }
    const m = await moisture;
    const off = w.offset, t = m.p.map((_, k) => (m.d0 + k) * 86400 - off);
    return {
      source: "model", model: w.model, fellBack: !!w.fellBack, period: per,
      lat: w.lat, lon: w.lon, elevation: w.elevation, offset: off, start: per.y0, end: per.y1,
      hourly: w.hourly,
      moisture: { source: m.source, lat: m.lat, lon: m.lon },
      daily: {
        t, p: m.p, et0: m.et0, tmean: m.tmean,
        gust: t.map((_, k) => (w.gust ? w.gust.get(m.d0 + k) ?? null : null)),
        wmax: dailyMaxFromHourly(w.hourly.t, w.hourly.ws, off, t),
      },
    };
  }

  /* ------------ analysis ------------ */
  /* Climate of the series over its period. Each calendar month is summarised from the hours and days it has (a
     month needs about 20 days of data), and yearly figures add the months, so a period of any length gives rates
     per month and per year; with fewer than 12 usable months the totals cover the selected months only
     (annualized false) and the months are not ranked. Without any usable month the result is {insufficient, error}
     and no numbers. Rose, DP and mean wind weight each month by its days. Annual rows mark complete years; the
     trend uses complete years only, and only with 5 or more. */
  function analyze(raw, thr) {
    const H = raw.hourly, D = raw.daily, off = raw.offset || 0, P = raw.period || null;
    const t0 = P ? P.t0 : -Infinity, t1 = P ? P.t1 : Infinity, d0 = P ? P.d0 : -Infinity, d1 = P ? P.d1 : Infinity;
    const vt = 12; // knots, Fryberger threshold
    const m = Array.from({ length: 12 }, () => ({ n: 0, sum: 0, ero: 0, energy: 0, dp: 0, fx: 0, fy: 0, dx: 0, dy: 0,
      rose: Array.from({ length: 16 }, () => [0, 0, 0, 0]), roseE: new Array(16).fill(0) }));
    const years = {};
    for (let i = 0; i < H.t.length; i++) {
      const u = H.ws[i], dir = H.wd[i], ts = H.t[i];
      if (u === null || u === undefined || ts < t0 || ts >= t1) continue;
      const dt = new Date((ts + off) * 1000);
      const mo = dt.getUTCMonth(), yr = dt.getUTCFullYear();
      const M = m[mo];
      M.n++; M.sum += u;
      const Y = years[yr] || (years[yr] = { n: 0, sum: 0, ero: 0 });
      Y.n++; Y.sum += u;
      const kn = u * 1.94384;
      if (kn > vt) {
        const q = kn * kn * (kn - vt);
        M.dp += q;
        if (dir !== null) { const r = (dir + 180) * Math.PI / 180; M.fx += q * Math.sin(r); M.fy += q * Math.cos(r); }
      }
      const sec = dir === null ? -1 : Math.round(dir / 22.5) % 16;
      if (sec >= 0) M.rose[sec][0]++;
      if (u >= thr) {
        const e = u * u * (u - thr);
        M.ero++; M.energy += e; Y.ero++;
        if (sec >= 0) {
          M.rose[sec][u < thr + 2 ? 1 : u < thr + 4 ? 2 : 3]++;
          M.roseE[sec] += e;
          // resultant transport toward the downwind direction
          const rad = (dir + 180) * Math.PI / 180;
          M.dx += e * Math.sin(rad); M.dy += e * Math.cos(rad);
        }
      }
    }

    // daily: moisture, gusts (days missing a value are left out, not counted as zero)
    const dm = Array.from({ length: 12 }, () => ({ p: 0, np: 0, et0: 0, ne: 0, t: 0, nt: 0, gustDays: 0, wmax: 0, gmax: 0, nw: 0, ng: 0 }));
    const yp = {};
    const ok = v => v !== null && v !== undefined;
    for (let i = 0; i < D.t.length; i++) {
      const day = dayKey(D.t[i], off);
      if (day < d0 || day > d1) continue;
      const dt = new Date((D.t[i] + off) * 1000);
      const mo = dt.getUTCMonth(), yr = dt.getUTCFullYear();
      const X = dm[mo];
      if (ok(D.p[i])) { X.p += D.p[i]; X.np++; }
      if (ok(D.et0[i])) { X.et0 += D.et0[i]; X.ne++; }
      if (ok(D.tmean[i])) { X.t += D.tmean[i]; X.nt++; }
      if (ok(D.wmax[i])) { X.wmax += D.wmax[i]; X.nw++; }
      if (ok(D.gust[i])) { X.gmax += D.gust[i]; X.ng++; if (D.gust[i] >= GUST_EVENT) X.gustDays++; }
      const Y = yp[yr] || (yp[yr] = { p: 0, np: 0, et0: 0, ne: 0 });
      if (ok(D.p[i])) { Y.p += D.p[i]; Y.np++; }
      if (ok(D.et0[i])) { Y.et0 += D.et0[i]; Y.ne++; }
    }

    const MIN_HOURS = 480, MIN_DAYS = 20;
    const months = m.map((M, i) => {
      const X = dm[i], nd = DAYS[i];
      const P_ = X.np >= MIN_DAYS ? (X.p / X.np) * nd : null, ET = X.ne >= MIN_DAYS ? (X.et0 / X.ne) * nd : null;
      if (M.n < MIN_HOURS) {
        return { valid: false, samples: M.n / (nd * 24), mean: null, eroHours: null, eroPct: null, energy: 0, index: 0, dry: null,
          precip: P_, et0: ET, meanDailyMax: null, meanDailyGust: null, gustDays: null, tmean: X.nt ? X.t / X.nt : null, faoC: null };
      }
      const dry = P_ !== null && ET !== null && ET > 0 ? Math.min(1, Math.max(0, (ET - P_) / ET)) : 1; // no moisture data: rank by wind energy alone
      const mean = M.sum / M.n;
      const u2 = mean * 0.748; // FAO-56 log-law 10 m -> 2 m
      const energy = (M.energy / M.n) * nd * 24; // per-year values scaled by data coverage (station records have gaps)
      return {
        valid: true, samples: M.n / (nd * 24),
        mean,
        eroHours: (M.ero / M.n) * nd * 24,
        eroPct: (100 * M.ero) / M.n,
        energy,
        index: energy * dry,
        dry, precip: P_, et0: ET,
        meanDailyMax: X.nw ? X.wmax / X.nw : null,
        meanDailyGust: X.ng ? X.gmax / X.ng : null,
        gustDays: X.ng ? (X.gustDays / X.ng) * nd : null,
        tmean: X.nt ? X.t / X.nt : null,
        faoC: (u2 ** 3 * dry * nd) / 100,
      };
    });
    const valid = months.map((M, i) => (M.valid ? i : -1)).filter(i => i >= 0);
    if (!valid.length) {
      return { thr, period: P, source: raw.source, model: raw.model, moisture: raw.moisture, station: raw.station || null, insufficient: true,
        error: P && P.monthDays < MIN_DAYS ? "the period has no calendar month with 20 or more days" : "no calendar month in the period has 20 or more days of hourly wind" };
    }
    const annualized = valid.length === 12;
    const idxSum = months.reduce((a, b) => a + b.index, 0) || 1;
    // shares of a whole year rank the months; with fewer months they are shares of the months covered, so those stay
    // "unranked" (no red, amber or high-risk months)
    months.forEach(M => {
      M.share = M.valid ? M.index / idxSum : 0;
      M.level = !M.valid ? "na" : !annualized ? "unranked" : M.share >= 0.1 ? "hi" : M.share >= 0.0667 ? "mid" : "lo";
    });

    // month-weighted combinations: each month's per-hour figure times its days
    const wSum = valid.reduce((a, i) => a + DAYS[i], 0) || 1;
    const wavg = f => valid.reduce((a, i) => a + f(m[i]) * DAYS[i], 0) / wSum;
    const roseOut = Array.from({ length: 16 }, (_, s) => ({
      dir: s * 22.5, all: 100 * wavg(M => M.rose[s][0] / M.n),
      bins: [1, 2, 3].map(b => 100 * wavg(M => M.rose[s][b] / M.n)),
    }));
    // prevailing erosive direction = sector carrying the most erosive energy, smoothed over neighbors; directions
    // are null without erosive wind (or without its direction), not north
    const roseE = Array.from({ length: 16 }, (_, s) => wavg(M => M.roseE[s] / M.n));
    let prevailing = null, best = 0;
    roseE.forEach((_, i) => {
      const e3 = roseE[(i + 15) % 16] * 0.5 + roseE[i] + roseE[(i + 1) % 16] * 0.5;
      if (e3 > best) { best = e3; prevailing = i * 22.5; }
    });
    const dx = wavg(M => M.dx / M.n), dy = wavg(M => M.dy / M.n), totalE = wavg(M => M.energy / M.n);
    const rdd = Math.hypot(dx, dy) > 0 ? (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360 : null;
    const rdpRatio = totalE > 0 ? Math.hypot(dx, dy) / totalE : 0;
    const fx = wavg(M => M.fx / M.n), fy = wavg(M => M.fy / M.n), rdp = Math.hypot(fx, fy);

    // calendar years: cov is the share of the year's hours with data in the period; a year is complete when it lies
    // wholly in the period with at least 90% of its hours (other years are scaled to a year and left out of the trend)
    const yrs = Object.keys(years).map(Number).sort((a, b) => a - b);
    const annual = yrs.map(y => {
      const whole = !P || (epochDay(y, 0, 1) >= d0 && epochDay(y, 11, 31) <= d1);
      const nDays = (Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1)) / 864e5, cov = years[y].n / (nDays * 24);
      return {
        year: y, mean: years[y].sum / years[y].n, eroHours: (years[y].ero / years[y].n) * 8766, cov, complete: whole && cov >= 0.9,
        precip: yp[y] && yp[y].np >= nDays * 0.9 ? yp[y].p : null, et0: yp[y] && yp[y].ne >= nDays * 0.9 ? yp[y].et0 : null,
      };
    });
    const full = annual.filter(a => a.complete);
    const trend = full.length >= 5 ? linreg(full.map(a => a.year), full.map(a => a.eroHours)) : null;
    const trendSpeed = full.length >= 5 ? linreg(full.map(a => a.year), full.map(a => a.mean)) : null;

    const sumOf = k => (valid.some(i => months[i][k] !== null) ? valid.reduce((a, i) => a + (months[i][k] ?? 0), 0) : null);
    const Psum = sumOf("precip"), ETsum = sumOf("et0");
    return {
      thr, nYears: P ? P.years : raw.end - raw.start + 1, start: raw.start, end: raw.end, period: P, annualized, completeYears: full.length,
      source: raw.source, model: raw.model, moisture: raw.moisture, station: raw.station || null,
      gridLat: raw.lat, gridLon: raw.lon, elevation: raw.elevation,
      months, rose: roseOut, prevailing, rdd, rdpRatio,
      annual, trend, trendSpeed,
      meanSpeed: wavg(M => M.sum / M.n),
      eroHours: valid.reduce((a, i) => a + months[i].eroHours, 0),
      gustDays: valid.some(i => months[i].gustDays !== null) ? valid.reduce((a, i) => a + (months[i].gustDays ?? 0), 0) : null,
      faoC: valid.reduce((a, i) => a + months[i].faoC, 0),
      dp: wavg(M => M.dp / M.n), // Fryberger & Dean (1979) drift potential, vector units
      rdp, rddF: rdp > 0 ? (Math.atan2(fx, fy) * 180 / Math.PI + 360) % 360 : null,
      precip: Psum, et0: ETsum, aridity: Psum !== null && ETsum ? Psum / ETsum : null,
      riskMonths: months.map((M, i) => (M.level === "hi" ? i : -1)).filter(i => i >= 0),
    };
  }

  /* ------------ calibration stations: airports (ASOS/AWOS) and West Texas Mesonet towers ------------ */
  const GHCNH = "https://www.ncei.noaa.gov/access/services/data/v1?dataset=global-historical-climatology-network-hourly";
  const IEM = "https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py";
  const HADS = "https://mesonet.agron.iastate.edu/cgi-bin/request/hads.py";
  const KT = 0.514444, MPH = 0.44704;
  const MAX_WS = 40, MAX_GUST = 55; // m/s plausibility limits for 2-min mean wind and gusts
  const BAD_QC = new Set(["2", "3", "6", "7"]); // NCEI quality codes: suspect or erroneous
  /* West Texas Mesonet (Texas Tech) towers are off: the mesonet's data policy allows public use only with its
     permission. Set ENABLE_WTM once it has agreed. For a local test, ?wtm=1 turns them on when the page is served
     from this computer (localhost or a file); the public site ignores it. */
  const ENABLE_WTM = false;
  const LOCAL = location.protocol === "file:" || /^(localhost|127\.0\.0\.1|\[::1\])$|\.localhost$/.test(location.hostname);
  const WTM_TRIAL = !ENABLE_WTM && LOCAL && new URLSearchParams(location.search).get("wtm") === "1";
  const WTM_ON = ENABLE_WTM || WTM_TRIAL;
  const TOWER_YEARS = 5; // towers train on their latest 5 complete years: the archive starts in Dec 2010 and a year takes ~11 s
  const HANDICAP = { ASOS: 0, WTM: 20, AWOS: 100 }; // km added to the distance when ranking
  // a tower recording > 15% fewer hours >= 8 m/s than the airport, each relative to the model, is taken as sheltered:
  // 7 of 16 towers surveyed in 2024 read 24-85% fewer, the other 9 between 0.89 and 1.41 times the airport's
  const EXPOSURE_MIN = 0.85, EXPOSURE_THR = 8;

  function km(la1, lo1, la2, lo2) {
    const r = Math.PI / 180;
    const a = Math.sin((la2 - la1) * r / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin((lo2 - lo1) * r / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(a));
  }

  /* The window a station is read for: the period widened to at least 3 years inside the model's record (back from
     its last day, forward where the record starts too late), so the monthly quantile mapping has thousands of hours
     even for a short custom range ("station only" and the comparison card still use the period itself). Towers read
     at most their latest TOWER_YEARS of it. */
  function trainSpan(P) {
    const L = P.limits || { first: -Infinity, last: Infinity };
    const d0 = Math.max(L.first, Math.min(P.d0, P.d1 - 1095));
    return span(d0, Math.min(L.last, Math.max(P.d1, d0 + 1095)));
  }
  /* Share of the period's hours (those inside the station's window) that the station reports: a gap over a short
     period can leave it bare while the 3-year window is still well covered. */
  function periodCoverage(obs, win, P) {
    const a = Math.max(P.t0, win.t0), b = Math.min(P.t1, win.t1);
    let n = 0;
    for (const t of obs.t) if (t >= a && t < b) n++;
    return b > a ? n / ((b - a) / 3600) : 0;
  }

  /* Candidates within maxKm with data for their window, ranked by distance plus a handicap. NWS/FAA ASOS sites
     first; West Texas Mesonet towers +20 km (an hourly value at :00 in whole mph, no gusts, no QC flags in the feed);
     AWOS +100 km (in West Texas several AWOS anemometers read 40-60% fewer erosive hours than nearby ASOS).
     Up to 6 airports and 4 towers. P: a resolved period. */
  function nearestStations(lat, lon, P, maxKm = 150) {
    const T = trainSpan(P), TW = span(Math.max(T.d0, T.d1 - Math.round(TOWER_YEARS * 365.2425) + 1), T.d1);
    const all = (window.WE_STATIONS || []).map(s => {
      const net = s[7] || (s[5] ? "AWOS" : "ASOS"), d = km(lat, lon, s[2], s[3]), win = net === "WTM" ? TW : T;
      return { id: s[0], name: s[1], lat: s[2], lon: s[3], begin: s[4], net, awos: net === "AWOS", tower: net === "WTM", ghcnh: s[6] || "",
        km: d, score: d + HANDICAP[net], win, y0: yearOf(win.d0), y1: yearOf(win.d1) };
    }).filter(s => s.km <= maxKm && s.begin <= s.y0 && (WTM_ON || !s.tower)).sort((a, b) => a.score - b.score);
    return [...all.filter(s => !s.tower).slice(0, 6), ...all.filter(s => s.tower).slice(0, 4)].sort((a, b) => a.score - b.score);
  }
  /* The tower that ranks ahead of every airport, if any (null while the mesonet is off); skip: ids already tried. */
  function towerFirst(lat, lon, P, skip = []) {
    const c = nearestStations(lat, lon, P).filter(s => !skip.includes(s.id))[0];
    return c && c.tower ? c : null;
  }
  /* calendar-year pieces of a window, newest last: [[a, b], ...] as epoch days */
  function yearChunks(win) {
    const out = [];
    for (let y = yearOf(win.d0); y <= yearOf(win.d1); y++) out.push([Math.max(win.d0, epochDay(y, 0, 1)), Math.min(win.d1, epochDay(y, 11, 31))]);
    return out;
  }

  /* Hourly series from reports [unix s, ws, wd, gust]: the routine report nearest each whole hour inside the window
     [t0, t1), after QC; coverage is measured against the window's hours. */
  function toHourly(rows, win) {
    const best = new Map();
    for (const [ts, ws, wd, gust] of rows) {
      if (!(ws >= 0 && ws <= MAX_WS)) continue; // garbled METARs (e.g. 250 kt) would swamp cubic energy sums
      const h = Math.round(ts / 3600) * 3600, dev = Math.abs(ts - h), cur = best.get(h);
      if (h < win.t0 || h >= win.t1) continue;
      if (cur && cur[0] <= dev) continue;
      best.set(h, [dev, ws, ws === 0 || wd === null || wd > 360 ? null : wd, gust !== null && (gust > MAX_GUST || gust < ws) ? null : gust]);
    }
    const t = [...best.keys()].sort((a, b) => a - b);
    const expected = (win.t1 - win.t0) / 3600;
    return { t, ws: t.map(k => best.get(k)[1]), wd: t.map(k => best.get(k)[2]), gust: t.map(k => best.get(k)[3]), coverage: t.length / expected };
  }

  /* NOAA NCEI Global Historical Climatology Network hourly: routine METARs (FM-15), one request per calendar year
     of the window, from local midnight (06:00 UTC in Central standard time). */
  async function ghcnhObs(st, win) {
    const texts = await pool(yearChunks(win), 6, ([a, b]) => fetchText(`${GHCNH}&stations=${st.ghcnh}&startDate=${isoDay(a)}T${hh(0)}:00:00&endDate=${isoDay(b + 1)}T${hh(-1)}:59:59` +
      "&dataTypes=Year,Month,Day,Hour,Minute,wind_speed,wind_direction,wind_gust,wind_speed_Quality_Code,wind_gust_Quality_Code," +
      "wind_speed_Report_Type&format=csv", 60000));
    const rows = [];
    for (const text of texts) {
      const lines = text.split("\n"), h = lines[0].replace(/"/g, "").split(",");
      const I = Object.fromEntries(h.map((k, i) => [k.trim(), i]));
      for (let k = 1; k < lines.length; k++) {
        const f = lines[k].replace(/"/g, "").split(",");
        if (f.length < h.length || f[I.wind_speed] === "" || f[I.wind_speed_Report_Type] !== "FM15" || BAD_QC.has(f[I.wind_speed_Quality_Code])) continue;
        const g = f[I.wind_gust] === "" || BAD_QC.has(f[I.wind_gust_Quality_Code]) ? null : +f[I.wind_gust];
        rows.push([Date.UTC(+f[I.Year], +f[I.Month] - 1, +f[I.Day], +f[I.Hour], +f[I.Minute]) / 1000,
          +f[I.wind_speed], f[I.wind_direction] === "" ? null : +f[I.wind_direction], g]);
      }
    }
    return { ...toHourly(rows, win), source: "ncei", hasGust: true };
  }

  /* IEM refuses a hads.py request that starts within about a second of another from the same address (HTTP 429,
     still readable cross-origin) and has throttled asos.py at times: retry twice. */
  async function iemText(url, timeoutMs) {
    for (let k = 0; ; k++) {
      try { return await fetchText(url, timeoutMs); }
      catch (e) { if (k === 2) throw e; await new Promise(r => setTimeout(r, 3000 * 2 ** k)); } // 429 (busy) or a network error
    }
  }

  /* Iowa Environmental Mesonet ASOS archive (NWS METAR feed): routine reports, knots. */
  async function iemObs(st, win) {
    const q = `station=${encodeURIComponent(st.id)}&data=sknt&data=drct&data=gust&sts=${isoDay(win.d0)}T${hh(0)}:00Z&ets=${isoDay(win.d1 + 1)}T${hh(0)}:00Z` +
      "&tz=Etc/UTC&format=onlycomma&latlon=no&missing=null&trace=null&direct=no&report_type=3";
    const rows = [];
    (await iemText(`${IEM}?${q}`, 60000)).split("\n").slice(1).forEach(l => {
      const f = l.split(",");
      if (f.length < 5 || f[2] === "null" || f[2] === "") return;
      const v = f[1];
      rows.push([Date.UTC(+v.slice(0, 4), +v.slice(5, 7) - 1, +v.slice(8, 10), +v.slice(11, 13), +v.slice(14, 16)) / 1000,
        +f[2] * KT, f[3] === "null" ? null : +f[3], f[4] && f[4].trim() !== "null" ? +f[4] * KT : null]);
    });
    return { ...toHourly(rows, win), source: "iem", hasGust: true };
  }

  /* West Texas Mesonet tower: the hourly NWS SHEF reports (WFO Lubbock product RR5LUB) archived by IEM, one request
     per year, newest first and one at a time (IEM refuses a second request from the same address within about a
     second). Speed in whole mph (USIRZZ, from Oct 2021 USIRZZZ), direction in degrees (UDIR*), stamped at :00 UTC;
     no gusts. Stops early once even complete later years could not reach minCov. */
  const hadsPart = (id, a, b) => iemText(`${HADS}?stations=${encodeURIComponent(id)}&sts=${isoDay(a)}T${hh(0)}:00Z&ets=${isoDay(b + 1)}T${hh(-1)}:59Z&what=txt`, 60000);
  async function wtmObs(st, win, minCov, live) {
    const chunks = yearChunks(win), total = (win.t1 - win.t0) / 3600;
    const rows = [];
    for (let k = chunks.length - 1; k >= 0; k--) {
      if (live && !live()) throw new Error("superseded");
      const [a, b] = chunks[k];
      const L = (await hadsPart(st.id, a, b)).split("\n"), h = L[0].trim().split(",");
      if (h[0] === "station") { // otherwise "Error, no results found for query!"
        const cols = re => h.flatMap((c, i) => (re.test(c) ? [i] : []));
        const S = cols(/^USIRZZZ?$/), D = cols(/^UDIRZZZ?$/);
        const first = (f, cc) => { for (const i of cc) if (f[i] && Number.isFinite(+f[i])) return +f[i]; return null; };
        for (let r = 1; r < L.length; r++) {
          const f = L[r].trim().split(","), v = f[1] || "";
          if (v.length < 16) continue;
          const mph = first(f, S);
          if (mph !== null) rows.push([Date.UTC(+v.slice(0, 4), +v.slice(5, 7) - 1, +v.slice(8, 10), +v.slice(11, 13), +v.slice(14, 16)) / 1000, mph * MPH, first(f, D), null]);
        }
      }
      const left = k ? (chunks[k][0] - chunks[0][0]) * 24 : 0; // hours still to read
      if ((rows.length + left) / total < minCov) break;
    }
    return { ...dropStuck(toHourly(rows, win)), source: "iemhads", hasGust: false };
  }
  /* Tower QC: drop runs of 6+ hours at the same non-zero speed (stuck sensor) and 3+ calm hours in a row (iced cups;
     the towers are calm 0.2-0.9% of hours). */
  function dropStuck(o) {
    const keep = o.t.map(() => true);
    for (let i = 0; i < o.t.length;) {
      let j = i + 1;
      while (j < o.t.length && o.ws[j] === o.ws[i] && o.t[j] - o.t[j - 1] === 3600) j++;
      if (j - i >= (o.ws[i] === 0 ? 3 : 6)) for (let k = i; k < j; k++) keep[k] = false;
      i = j;
    }
    const pick = a => a.filter((_, i) => keep[i]), t = pick(o.t);
    return { t, ws: pick(o.ws), wd: pick(o.wd), gust: pick(o.gust), coverage: o.coverage * t.length / Math.max(o.t.length, 1) };
  }

  async function fetchStationObs(st, minCov, live, P) {
    if (st.tower) return wtmObs(st, st.win, minCov, live);
    if (st.ghcnh) {
      try {
        const o = await ghcnhObs(st, st.win);
        if (o.coverage >= minCov && periodCoverage(o, st.win, P) >= minCov) return o;
        console.warn(`GHCNh ${st.ghcnh} covers ${Math.round(o.coverage * 100)}% of hours (${Math.round(periodCoverage(o, st.win, P) * 100)}% in the period), trying IEM`);
      } catch (e) {
        console.warn("GHCNh unavailable, trying IEM", st.id, e);
      }
    }
    return iemObs(st, st.win);
  }

  /* First candidate with enough data, both over its window and in the period, or the station the user picked
     (onlyId). Observations only. Airports unless towers: then only the towers that rank ahead of every airport.
     live() false stops a tower read; onTry(st) hears of each candidate as its read starts. */
  async function findStation(lat, lon, P, onlyId, { towers = false, live, skip = [], onTry } = {}) {
    const minCov = onlyId ? 0.2 : 0.6; // part-time AWOS records are too gappy unless picked
    const all = nearestStations(lat, lon, P).filter(s => !skip.includes(s.id)), lead = all.findIndex(s => !s.tower);
    const cands = onlyId ? all.filter(s => s.id === onlyId) : towers ? all.slice(0, lead < 0 ? all.length : lead) : all.filter(s => !s.tower);
    for (const st of cands) {
      if (live && !live()) return null;
      if (onTry) onTry(st);
      try {
        const obs = await fetchStationObs(st, minCov, live, P);
        if (obs.coverage < minCov || periodCoverage(obs, st.win, P) < minCov) continue;
        return { meta: { ...st, coverage: obs.coverage, obsSource: obs.source, hasGust: obs.hasGust }, obs };
      } catch (e) {
        if (!live || live()) console.warn("station skipped", st.id, e);
      }
    }
    return null;
  }

  /* The site's gridded model at the station over the station's window (clamped to the model's record), to train
     the calibration (light request). days are local epoch days; for MERRA-2 the daily "gust" is the daily max
     hourly wind. */
  async function fetchModelAt(model, lat, lon, win) {
    const L = limits(model), W = span(Math.max(win.d0, L.first), Math.min(win.d1, L.last));
    if (model === "merra2") {
      const w = await merraWind(lat, lon, W), mx = new Map();
      w.hourly.t.forEach((t, i) => {
        const u = w.hourly.ws[i];
        if (u !== null) mx.set(dayKey(t, CST), Math.max(mx.get(dayKey(t, CST)) ?? 0, u));
      });
      return { t: w.hourly.t, ws: w.hourly.ws, days: [...mx.keys()], gust: [...mx.values()] };
    }
    const j = await fetchJSON(`${ARCHIVE}?${new URLSearchParams({
      latitude: lat.toFixed(4), longitude: lon.toFixed(4), start_date: isoDay(W.d0), end_date: isoDay(Math.min(W.d1, today() - 1)),
      hourly: "wind_speed_10m", daily: "wind_gusts_10m_max", wind_speed_unit: "ms",
      timezone: tzEtc(), timeformat: "unixtime",
    })}`, {}, 90000);
    const h = trim({ t: j.hourly.time, ws: j.hourly.wind_speed_10m }, W.t0, W.t1);
    return { t: h.t, ws: h.ws, days: j.daily.time.map(t => stampDay(t, j.utc_offset_seconds)), gust: j.daily.wind_gusts_10m_max };
  }

  /* ---- monthly empirical quantile mapping: reanalysis at the station -> station observations ----
     Quantiles span 0.1-99.9% so single bad reports can't set the tails; beyond them the end ratio is used. */
  const QN = 101, QLO = 0.001, QHI = 0.999;
  function quantiles(arr) {
    const s = arr.filter(v => v !== null && v !== undefined).sort((a, b) => a - b);
    if (s.length < 50) return null;
    return Array.from({ length: QN }, (_, k) => {
      const p = (QLO + (k / (QN - 1)) * (QHI - QLO)) * (s.length - 1), i = Math.floor(p), f = p - i;
      return s[i] + (i + 1 < s.length ? (s[i + 1] - s[i]) * f : 0);
    });
  }
  function mapper(qm, qo) {
    if (!qm || !qo) return x => x;
    return x => {
      if (x === null || x === undefined) return x;
      if (x <= qm[0]) return qm[0] > 0 ? (x * qo[0]) / qm[0] : qo[0];
      if (x >= qm[QN - 1]) return qm[QN - 1] > 0 ? (x * qo[QN - 1]) / qm[QN - 1] : x;
      let lo = 0, hi = QN - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (qm[mid] <= x) lo = mid; else hi = mid; }
      const span = qm[hi] - qm[lo];
      return qo[lo] + (span > 0 ? (x - qm[lo]) / span : 0.5) * (qo[hi] - qo[lo]);
    };
  }
  /* Daily maxima of station observations keyed by local day; days with < 18 reports are skipped. */
  function stationDaily(obs, off) {
    const d = new Map();
    obs.t.forEach((t, i) => {
      const k = dayKey(t, off);
      const r = d.get(k) || { n: 0, wmax: 0, gmax: 0 };
      r.n++;
      r.wmax = Math.max(r.wmax, obs.ws[i]);
      r.gmax = Math.max(r.gmax, obs.gust[i] ?? obs.ws[i]);
      d.set(k, r);
    });
    for (const [k, r] of d) if (r.n < 18) d.delete(k);
    return d;
  }

  /* Hourly speed mapper for each month: reanalysis at the station vs. the station, same hours. */
  function hourlyMappers(st, off) {
    const modByT = new Map(st.mod.t.map((t, i) => [t, st.mod.ws[i]]));
    const mm = Array.from({ length: 12 }, () => []), mo = Array.from({ length: 12 }, () => []);
    st.obs.t.forEach((t, i) => {
      const x = modByT.get(t);
      if (x === null || x === undefined) return;
      const m = monthOf(t, off);
      mm[m].push(x);
      mo[m].push(st.obs.ws[i]);
    });
    return mm.map((a, m) => mapper(quantiles(a), quantiles(mo[m])));
  }
  /* Daily gust mapper for each month: the model's daily gust (MERRA-2: daily max wind) at an airport vs. its daily max gust. */
  function gustMappers(st, off) {
    const sd = stationDaily(st.obs, off);
    const gm = Array.from({ length: 12 }, () => []), go = Array.from({ length: 12 }, () => []);
    st.mod.days.forEach((d, i) => {
      const r = sd.get(d), x = st.mod.gust[i];
      if (!r || x === null || x === undefined) return;
      const m = new Date(d * 864e5).getUTCMonth();
      gm[m].push(x);
      go[m].push(r.gmax);
    });
    return gm.map((a, m) => mapper(quantiles(a), quantiles(go[m])));
  }

  function dailyMaxFromHourly(t, ws, off, dailyT) {
    const mx = new Map();
    t.forEach((tt, i) => {
      if (ws[i] === null || ws[i] === undefined) return;
      const k = dayKey(tt, off);
      mx.set(k, Math.max(mx.get(k) ?? 0, ws[i]));
    });
    return dailyT.map(d => mx.get(dayKey(d, off)) ?? null);
  }

  /* Site series with the station's monthly speed distribution and the reanalysis timing and direction.
     Mappers are trained on reanalysis at the station vs. the station, then applied to reanalysis at the site,
     so the model's site-vs-station difference is kept. Gusts are mapped to gst, an airport with its model series
     (towers record no gusts); without one the daily gust stays empty. */
  function calibrate(raw, st, gst = st) {
    const off = raw.offset || 0;
    const H = hourlyMappers(st, off);
    const G = gst && gst.mod && gst.meta.hasGust ? gustMappers(gst, off) : null;
    const ws = raw.hourly.ws.map((u, i) => (u === null || u === undefined ? u : H[monthOf(raw.hourly.t[i], off)](u)));
    const g0 = raw.model === "merra2" ? raw.daily.wmax : raw.daily.gust; // MERRA-2: daily max wind stands in for gusts
    return {
      ...raw, source: "calibrated", station: st.meta, gustStation: G ? gst.meta : null,
      hourly: { ...raw.hourly, ws },
      daily: {
        ...raw.daily,
        wmax: dailyMaxFromHourly(raw.hourly.t, ws, off, raw.daily.t),
        gust: G ? g0.map((g, i) => (g === null || g === undefined ? g : G[monthOf(raw.daily.t[i], off)](g))) : raw.daily.t.map(() => null),
      },
    };
  }

  /* Airport observations alone (daily moisture still from gridMET or its fallback at the site). Not for towers:
     they cover only their latest TOWER_YEARS, not the period. */
  function stationRaw(raw, st) {
    const off = raw.offset || 0, P = raw.period;
    const obs = P ? trim(st.obs, P.t0, P.t1) : st.obs;
    const sd = stationDaily(obs, off);
    return {
      ...raw, source: "station", station: st.meta, lat: st.meta.lat, lon: st.meta.lon,
      hourly: { t: obs.t, ws: obs.ws, wd: obs.wd },
      daily: {
        ...raw.daily,
        wmax: raw.daily.t.map(d => (sd.get(dayKey(d, off)) || {}).wmax ?? null),
        gust: raw.daily.t.map(d => (sd.get(dayKey(d, off)) || {}).gmax ?? null),
      },
    };
  }

  /* Exposure check over the tower's years: the tower's mean wind and hours >= 8 m/s, each relative to the model at its
     own cell, divided by the airport's. Both should stand on open ground, so far fewer erosive hours than the airport
     mean a sheltered tower (Plainview 1S: 0.51 of LBB's erosive hours, 0.79 of its mean wind). */
  function exposure(tw, ap) {
    const { t0, t1 } = tw.meta.win;
    const rel = st => {
      const mod = new Map(st.mod.t.map((t, i) => [t, st.mod.ws[i]]));
      let so = 0, sm = 0, eo = 0, em = 0, n = 0;
      st.obs.t.forEach((t, i) => {
        const x = t >= t0 && t < t1 ? mod.get(t) : null;
        if (x === null || x === undefined) return;
        const y = st.obs.ws[i];
        so += y; sm += x; n++;
        if (y >= EXPOSURE_THR) eo++;
        if (x >= EXPOSURE_THR) em++;
      });
      return n >= 2000 && sm > 0 && em > 0 ? { mean: so / sm, ero: eo / em } : null;
    };
    const a = rel(ap), b = rel(tw);
    return a && b && a.mean > 0 && a.ero > 0 ? { mean: b.mean / a.mean, ero: b.ero / a.ero } : null;
  }

  /* Reanalysis vs. station at the station location, same hours (within period P when given). */
  function compare(st, thr, P) {
    const modByT = new Map(st.mod.t.map((t, i) => [t, st.mod.ws[i]]));
    let n = 0, so = 0, sm = 0, soo = 0, smm = 0, som = 0, se = 0, eo = 0, em = 0;
    st.obs.t.forEach((t, i) => {
      if (P && (t < P.t0 || t >= P.t1)) return;
      const x = modByT.get(t);
      if (x === null || x === undefined) return;
      const y = st.obs.ws[i];
      n++; so += y; sm += x; soo += y * y; smm += x * x; som += x * y; se += (x - y) ** 2;
      if (y >= thr) eo++;
      if (x >= thr) em++;
    });
    if (!n) return null;
    const mo = so / n, mm = sm / n;
    const r = (som / n - mo * mm) / Math.sqrt((soo / n - mo * mo) * (smm / n - mm * mm));
    return { n, meanObs: mo, meanMod: mm, bias: mm - mo, rmse: Math.sqrt(se / n), r, freqObs: eo / n, freqMod: em / n };
  }

  return { fetchWind, analyze, yearsFor, findStation, fetchModelAt, calibrate, stationRaw, compare, nearestStations, towerFirst, exposure, trainSpan,
    wtmOn: WTM_ON, wtmEnabled: ENABLE_WTM, wtmTrial: WTM_TRIAL, TOWER_YEARS, EXPOSURE_MIN,
    resolvePeriod, limits, isoDay, parseDay, dayLabel, today, span, setZone, zoneHours, zoneLabel, gridmetLast, gridmetBox, gridmetFromFiles: () => gmDown, GM_DAY0, PRISM_DAY0, prismLast, prismCredit, prismNote, epochDay, dailyWeather, fao56 };
})();

