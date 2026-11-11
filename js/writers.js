/* File writers for WG.models: each takes ctx = { wx, soil, site, wind, d0, d1, climWx } (structures in models.js;
   climWx = 10 complete years of the same source, read when the chosen dates lack a month or a variable; the area grid
   also gives stem, a file name to use instead of the one made from the coordinates, DSSAT's wsta, and for CENTURY and
   DayCent wth, the name of a weather file written once for many site files) and returns
   [{ name, text }] with .notes, one sentence each on what the user must know about that model's files (the data
   sheet lists them in its README). Formats follow the models' manuals, official example files and the Fortran READ
   statements of their source code; see docs/METHODS.md. */
(function () {
  const M = WG.models, W = M.writers, Wd = WG.wind;
  const CRLF = "\r\n";
  const ymdOf = d => { const x = new Date(d * 864e5); return [x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate()]; };
  // the state a point is in (one of the states on the map), else the chosen location's: its code and name for the files
  const stateOf = (lat, lon) => (WG.region && ((Number.isFinite(lat) && Number.isFinite(lon) && WG.region.stateAt(lat, lon)) || WG.region.site())) || { code: "TX", name: "Texas" };
  const doyOf = d => d - Wd.epochDay(ymdOf(d)[0], 0, 1) + 1;
  const ok = v => v !== null && v !== undefined && Number.isFinite(v);
  /* right-justify v in a field of `width`, always with a decimal point and a leading blank (fewer decimals if needed) */
  function fit(v, width, dec) {
    for (let d = dec; d >= 0; d--) {
      const t = d > 0 ? v.toFixed(d) : `${Math.round(v)}.`;
      if (t.length <= width - 1) return t.padStart(width);
    }
    return v.toExponential(1).padStart(width).slice(-width);
  }
  const pad = (s, n) => String(s).padStart(n);
  const short = (s, n) => String(s).normalize("NFKD").replace(/[^\w ]+/g, "").trim().slice(0, n);
  // FNV-1a 32-bit hash of a string
  const hash32 = (s, h = 0x811c9dc5) => { for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0; return h; };
  /* file base names from the coordinates to 0.001° (about 100 m), so nearby sites do not overwrite each other's files:
     APSIM and AquaCrop take long names (WG33578N101855W); EPIC and APEX want 8.3 names, so theirs is W plus the
     latitude and longitude packed into 7 letters and digits */
  const baseName = site => `WG${Math.round(Math.abs(site.lat) * 1000)}${site.lat < 0 ? "S" : "N"}${Math.round(Math.abs(site.lon) * 1000)}${site.lon < 0 ? "W" : "E"}`;
  const shortName = site => `W${((Math.round(site.lat * 1000) + 90000) * 360001 + Math.round(site.lon * 1000) + 180000).toString(36).toUpperCase().padStart(7, "0")}`;

  /* ======================= weather checks and generator statistics ======================= */
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const MONTH_DAYS = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const months = d => new Date(d * 864e5).getUTCMonth();
  const isoSpan = wx => `${Wd.isoDay(wx.days[0])} to ${Wd.isoDay(wx.days[wx.days.length - 1])}`;
  /* values no station reports are taken as missing in every model file: an undeclared missing-value code (-99.9,
     -996 ...) shows up as negative rain, radiation, humidity, vapour pressure or wind, radiation above 50 MJ/m2 or a
     temperature outside -60...60 degC; a stuck sensor as radiation below 0.1 MJ/m2 (the floor CSM resets it to) or
     humidity or vapour pressure of 0; and a day with Tmax = Tmin = 0 is an empty row, so the zeros in its other columns
     go too. w.bad counts them by variable (2 m wind with the 10 m wind it comes from). */
  const LIMITS = [["tmax", -60, 60], ["tmin", -60, 60], ["tdew", -60, 60], ["srad", 0.1, 50], ["prcp", 0, Infinity], ["rh", 1e-9, Infinity], ["vp", 1e-9, Infinity],
    ["wind10", 0, Infinity], ["wind2", 0, Infinity]];
  const EMPTY_ROW = ["srad", "prcp", "rh", "rhmax", "rhmin", "tdew", "vp", "wind10", "wind2", "et0"];
  function clean(wx) {
    if (!wx || wx.bad) return wx;
    const w = { ...wx }, bad = {}, count = k => { bad[k] = (bad[k] || 0) + 1; };
    [...LIMITS.map(x => x[0]), ...EMPTY_ROW].forEach(k => { if (Array.isArray(wx[k])) w[k] = wx[k].slice(); });
    w.days.forEach((_, i) => {
      if (w.tmax && w.tmin && w.tmax[i] === 0 && w.tmin[i] === 0) {
        w.tmax[i] = w.tmin[i] = null; count("zero");
        const zeros = EMPTY_ROW.filter(k => w[k] && w[k][i] === 0);
        zeros.forEach(k => { w[k][i] = null; });
        if (zeros.length) count("zeroRest");
      }
      LIMITS.forEach(([k, lo, hi]) => { const v = w[k] && w[k][i]; if (ok(v) && (v < lo || v > hi)) { w[k][i] = null; if (k !== "wind2") count(k); } });
    });
    w.bad = bad;
    return w;
  }
  const BAD = { zero: "Tmax = Tmin = 0", zeroRest: "the zeros in the other columns of those rows", tmax: "Tmax outside -60 to 60 degC", tmin: "Tmin outside -60 to 60 degC", tdew: "dew point outside -60 to 60 degC",
    srad: "solar radiation below 0.1 or above 50 MJ/m2", prcp: "negative rain", rh: "humidity of 0 or below", vp: "vapour pressure of 0 or below", wind10: "negative wind" };
  const badText = w => {
    const e = Object.entries((w && w.bad) || {});
    return e.length ? `Values no station reports were taken as missing: ${e.map(([k, c]) => `${BAD[k] || k} ${c} day${c > 1 ? "s" : ""}`).join("; ")}.` : "";
  };
  const sum = a => a.reduce((x, y) => x + y, 0);
  const mean = a => (a.length ? sum(a) / a.length : 0);
  const sd = a => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };
  const skew = a => { const n = a.length; if (n < 3) return 0; const m = mean(a), s = sd(a); return s ? (n * a.reduce((x, y) => x + (y - m) ** 3, 0)) / ((n - 1) * (n - 2) * s ** 3) : 0; };
  // the valid values of one variable by calendar month
  const byMonth = (wx, k) => { const a = Array.from({ length: 12 }, () => []); wx.days.forEach((d, i) => { const v = wx[k] && wx[k][i]; if (ok(v)) a[months(d)].push(v); }); return a; };
  /* monthly rain statistics for a wet-day test. Totals and wet days are per whole month from the days with data, so a
     month split between two years or with gaps counts in full; wet-after-dry and wet-after-wet days (the day before
     may be in the month before) over the dry and wet days whose day before has data, so gaps do not lower them (with
     no such day, the month's share of wet days); each year's largest daily rain from the years in which the month is
     complete (all years with the month when none is) */
  function rainStats(wx, wet) {
    const acc = Array.from({ length: 12 }, () => ({ all: [], wets: [], nwd: 0, nww: 0, gapDry: 0, gapWet: 0, n: new Map(), max: new Map() }));
    wx.days.forEach((d, i) => {
      const p = wx.prcp[i], q = i ? wx.prcp[i - 1] : null;
      if (!ok(p)) return;
      const [y, mo] = ymdOf(d), a = acc[mo - 1], w = wet(p);
      a.all.push(p);
      if (w) a.wets.push(p);
      if (ok(q)) { if (w) a[wet(q) ? "nww" : "nwd"]++; } else if (i) a[w ? "gapWet" : "gapDry"]++;
      a.n.set(y, (a.n.get(y) || 0) + 1); a.max.set(y, Math.max(a.max.get(y) ?? 0, p));
    });
    return acc.map((a, m) => {
      const n = a.all.length, per = n ? MONTH_DAYS[m] / n : 0, ndry = n - a.wets.length, nwet = a.wets.length;
      const dk = ndry - a.gapDry, wk = nwet - a.gapWet, share = n ? nwet / n : 0;
      const full = [...a.n].filter(([y, c]) => c === new Date(Date.UTC(y, m + 1, 0)).getUTCDate()).map(([y]) => a.max.get(y));
      return { all: a.all, wets: a.wets, total: sum(a.all) * per, wetDays: nwet * per, pwd: dk ? Math.min(1, a.nwd / dk) : ndry ? share : 0, pww: wk ? Math.min(1, a.nww / wk) : nwet ? share : 0,
        maxima: full.length ? full : [...a.max.values()], years: full.length || a.max.size };
    });
  }
  /* The generator statistics come in groups, each from one daily series: the chosen dates when every calendar month
     has 20 or more valid days of the group's variables, else the 10 complete years read for the climate (climWx);
     failing both, the chosen dates, else climWx, with 10 or more days in every month (src.thin lists those groups and
     their short months). With fewer the model's files are not written (an Error), rather than written with zeros. */
  const GROUPS = [["temp", ["tmax", "tmin"], "Tmax and Tmin"], ["prcp", ["prcp"], "rain"], ["srad", ["srad"], "solar radiation"], ["rh", ["rh"], "relative humidity"],
    ["wind", ["wind10"], "wind"]];
  // days with all of a group's variables, by calendar month
  const monthDays = (wx, keys) => {
    const n = new Array(12).fill(0);
    if (wx) wx.days.forEach((d, i) => { if (keys.every(k => wx[k] && ok(wx[k][i]))) n[months(d)]++; });
    return n;
  };
  const shortMonths = (wx, keys, min = 20) => { const n = monthDays(wx, keys); return MON.filter((_, m) => n[m] < min); };
  const and = a => (a.length > 1 ? `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}` : a.join(""));
  function statSources(wx, climWx, model, what) {
    const cl = clean(climWx), src = { thin: [] }, miss = new Map(); // missing months -> variables
    GROUPS.forEach(([g, keys, label]) => {
      const [s, min] = [[wx, 20], [cl, 20], [wx, 10], [cl, 10]].find(([x, n]) => x && !shortMonths(x, keys, n).length) || [];
      if (!s) {
        const gap = shortMonths(wx, keys, 10), k = gap.length === 12 ? "every month" : and(gap);
        miss.set(k, [...(miss.get(k) || []), label]);
        return;
      }
      src[g] = s;
      if (min < 20) { const n = monthDays(s, keys); src.thin.push({ g, label, months: MON.map((m, i) => [m, n[i]]).filter(([, c]) => c < 20) }); }
    });
    if (miss.size) throw new Error(`${model}: ${what} need 10 or more days of each weather variable in every month. The chosen dates have too little `
      + `${[...miss].map(([k, labels]) => `${and(labels)} in ${k}`).join("; ")}, ${climWx ? "and the 10 years read for the climate do not have them either" : "and no 10-year climate series was read to make up for them"}.`);
    return src;
  }
  /* notes on statistics not from 20 or more days of the chosen dates in every month: the groups from climWx (when
     the others are from the chosen dates) and the groups with fewer than 20 days in some months */
  function statNotes(src, wx, what) {
    const W = what.charAt(0).toUpperCase() + what.slice(1), thin = src.thin.map(t => t.g), notes = [];
    const few = keys => { const s = shortMonths(wx, keys); return s.length === 12 ? "every month" : and(s); };
    const cg = GROUPS.filter(([g]) => src[g] !== wx && !thin.includes(g));
    if (cg.length && GROUPS.some(([g]) => src[g] === wx))
      notes.push(`${W} for ${and(cg.map(x => x[2]))} come from the 10 years read for the climate (${isoSpan(src[cg[0][0]])}), because the chosen dates have fewer than 20 days of ${and(cg.map(([, keys, label]) => `${label} in ${few(keys)}`))}.`);
    src.thin.forEach(t => notes.push(`${W} for ${t.label} rest on fewer than 20 days of data in ${and(t.months.map(([m, n]) => `${m} (${n} days)`))}`
      + `${src[t.g] === wx ? "" : ` of the 10 years read for the climate (${isoSpan(src[t.g])})`}, because no series read has 20 or more in every month.`));
    return notes;
  }
  // where the statistics came from, for the READMEs
  function statText(src, wx) {
    const other = GROUPS.filter(([g]) => src[g] !== wx);
    if (!other.length) return "the same days";
    const span = isoSpan(src[other[0][0]]), covered = new Set(wx.days.map(months)).size === 12;
    return other.length === GROUPS.length ? `${span}, because the chosen dates ${covered ? "have too few days of every variable in some months" : "do not cover every month"}`
      : `the same days, except ${and(other.map(x => x[2]))} from ${span}, which the chosen dates do not have on 20 or more days of every month`;
  }
  // the groups a series cannot give for every month (the data sheet reads 10 complete years for them)
  const statGaps = wx => GROUPS.filter(([, keys]) => shortMonths(clean(wx), keys).length).map(x => x[2]);
  // one series for every group, when the statistics are asked for directly
  const groupsOf = src => { if (!src.days) return src; const c = clean(src); return Object.fromEntries(GROUPS.map(([g]) => [g, c])); };
  // the daily variables a series has on no day
  const DAILY = [["srad", "solar radiation"], ["tmax", "Tmax"], ["tmin", "Tmin"], ["prcp", "rain"], ["rh", "relative humidity"], ["wind10", "wind"]];
  const noneOf = wx => DAILY.filter(([k]) => !(Array.isArray(wx[k]) && wx[k].some(ok))).map(x => x[1]);

  /* ======================= EPIC and APEX ======================= */
  /* WXPM3020 monthly statistics (pooled over years; sample SD with n-1; wet day > 0 mm), each group from the series
     statSources picked */
  function wp1Stats(src) {
    const S = groupsOf(src), R = rainStats(S.prcp, p => p > 0);
    const tx = byMonth(S.temp, "tmax"), tn = byMonth(S.temp, "tmin"), sr = byMonth(S.srad, "srad"), rh = byMonth(S.rh, "rh"), ws = byMonth(S.wind, "wind10");
    const out = { TMX: [], TMN: [], SDMX: [], SDMN: [], PRCP: [], SDRF: [], SKRF: [], PWD: [], PWW: [], DAYP: [], WI: [], RAD: [], RHUM: [], WSPD: [] };
    R.forEach((r, m) => {
      out.TMX.push(mean(tx[m])); out.TMN.push(mean(tn[m])); out.SDMX.push(sd(tx[m])); out.SDMN.push(sd(tn[m]));
      out.PRCP.push(r.total); out.SDRF.push(sd(r.wets)); out.SKRF.push(skew(r.wets));
      out.PWD.push(r.pwd); out.PWW.push(r.pww); out.DAYP.push(r.wetDays); out.WI.push(0);
      out.RAD.push(mean(sr[m])); out.RHUM.push(mean(rh[m]) / 100); out.WSPD.push(mean(ws[m]));
    });
    return out;
  }
  const WP1_ORDER = [["TMX", "TMX"], ["TMN", "TMN"], ["SDMX", "SDMX"], ["SDMN", "SDMN"], ["PRCP", "PRCP"], ["SDRF", "SDRF"], ["SKRF", "SKRF"], ["PWD", "PW|D"],
    ["PWW", "PW|W"], ["DAYP", "DAYP"], ["WI", "WI"], ["RAD", "RAD"], ["RHUM", "RHUM"], ["WSPD", "WSPD"]];
  function wp1Text(st, title, line2, width) {
    const L = [title, line2];
    WP1_ORDER.forEach(([k, lab]) => {
      const dec = width >= 10 && ["SKRF", "PWD", "PWW"].includes(k) ? 3 : 2;
      L.push(st[k].map(v => fit(v, width, dec)).join("") + (width >= 10 ? `  ${lab}` : ""));
    });
    return L.join(CRLF) + CRLF;
  }
  /* monthly 10 m wind speed and % of hours from each of 16 sectors (N, NNE ... NNW; N = 348.75-11.25°): from the
     app's hourly wind (calibrated where available) in the months its period covers for 10 days or more, the other
     months from the daily mean 10 m wind of `daily` (called `dailyName`) with uniform directions; floored at 0.1 so
     no row is zero in January */
  function windMonthly(ctx, daily, dailyName = "the weather source") {
    const spd = Array.from({ length: 12 }, () => []), cnt = Array.from({ length: 12 }, () => new Array(16).fill(0));
    const raw = ctx.wind && ctx.wind.raw;
    if (raw && raw.hourly) {
      const off = raw.offset || 0, P = raw.period;
      raw.hourly.t.forEach((t, i) => {
        const u = raw.hourly.ws[i], th = raw.hourly.wd[i];
        if (!ok(u) || (P && (t < P.t0 || t >= P.t1))) return;
        const m = new Date((t + off) * 1000).getUTCMonth();
        spd[m].push(u);
        if (ok(th) && u >= 0.5) cnt[m][Math.floor((((th % 360) + 360) % 360 + 11.25) / 22.5) % 16]++;
      });
    }
    const hourly = spd.map(a => a.length >= 240), day = daily ? byMonth(daily, "wind10") : null;
    const uav = spd.map((a, m) => (hourly[m] ? mean(a) : day && day[m].length ? mean(day[m]) : null));
    const none = MON.filter((_, m) => uav[m] === null);
    if (none.length) throw new Error(`the .WND needs wind in every month, and there is none in ${and(none)}`);
    const dirs = Array.from({ length: 16 }, (_, k) => cnt.map((c, m) => { const tot = c.reduce((a, b) => a + b, 0); return Math.max(0.1, hourly[m] && tot ? (100 * c[k]) / tot : 6.25); }));
    const hm = MON.filter((_, m) => hourly[m]);
    const hs = hm.length ? `the hourly 10 m wind used by SoilGuard (${raw.source === "calibrated" ? "calibrated" : raw.source}${raw.period ? `, ${raw.period.label}` : ""})` : "";
    const src = hm.length === 12 ? hs : !hm.length ? `the daily mean 10 m wind of ${dailyName} (no hourly directions: directions are uniform)`
      : `${hs} for ${and(hm)}; the other months from the daily mean 10 m wind of ${dailyName}, with uniform directions`;
    return { uav, dirs, src };
  }
  function wndText(wm, title, line2, width) {
    const L = [title, line2, wm.uav.map(v => fit(v, width, 2)).join("")];
    wm.dirs.forEach(row => L.push(row.map(v => fit(v, width, width === 6 ? 1 : 2)).join("")));
    return L.join(CRLF) + CRLF;
  }
  /* daily rows: 2X,3I4 then SRAD TMAX TMIN PRCP RH(fraction) WIND(10 m) as F6.2; missing as each model wants */
  function dlyText(wx, kind) {
    const miss = kind === "epic" ? { srad: "999.0", tmax: "999.0", tmin: "999.0", prcp: "999.0", rh: "999.0", wind: "999.0" }
      : { srad: "", tmax: "9999.0", tmin: "9999.0", prcp: "9999.0", rh: "", wind: "" };
    const f = (v, k, scale = 1) => (ok(v) ? fit(v * scale, 6, 2) : miss[k].padStart(6));
    return wx.days.map((d, k) => {
      const [y, mo, da] = ymdOf(d);
      return `  ${pad(y, 4)}${pad(mo, 4)}${pad(da, 4)}${f(wx.srad[k], "srad")}${f(wx.tmax[k], "tmax")}${f(wx.tmin[k], "tmin")}${f(wx.prcp[k], "prcp")}${f(wx.rh[k], "rh", 0.01)}${f(wx.wind10[k], "wind")}`;
    }).join(CRLF) + CRLF;
  }
  /* soil: one row per property, one F8 column per layer (EPIC up to 15 layers, APEX up to 10) */
  function mergeLayers(layers, max) {
    const L = layers.map(l => ({ ...l }));
    while (L.length > max) { // merge the thinnest adjacent pair below the surface layer, thickness-weighted (Ksat harmonic;
      // organic matter, carbon, CaCO3 and N, fractions of the fine earth by mass, by bulk density x thickness where both have one)
      let best = 1, bt = Infinity;
      for (let i = 1; i < L.length - 1; i++) { const t = (L[i].bot - L[i].top) + (L[i + 1].bot - L[i + 1].top); if (t < bt) { bt = t; best = i; } }
      const a = L[best], b = L[best + 1], wa = a.bot - a.top, wb = b.bot - b.top;
      const byMass = ok(a.bd) && ok(b.bd) && a.bd > 0 && b.bd > 0, ma = byMass ? wa * a.bd : wa, mb = byMass ? wb * b.bd : wb;
      const mix = k => (ok(a[k]) && ok(b[k]) ? (k === "ksat" ? (wa + wb) / (wa / Math.max(a[k], 1e-6) + wb / Math.max(b[k], 1e-6))
        : ["om", "oc", "caco3", "ni"].includes(k) ? (a[k] * ma + b[k] * mb) / (ma + mb) : (a[k] * wa + b[k] * wb) / (wa + wb)) : ok(a[k]) ? a[k] : b[k]);
      const m = { ...a, bot: b.bot, hz: [...new Set([a.hz, b.hz].join("+").split("+").filter(Boolean))].join("+") };
      // every property either layer has (a value only the deeper layer has is kept too)
      new Set([...Object.keys(a), ...Object.keys(b)]).forEach(k => { if ((ok(a[k]) || ok(b[k])) && !["top", "bot"].includes(k)) m[k] = mix(k); });
      L.splice(best, 2, m);
    }
    return L;
  }
  const fine = (v, l) => (ok(v) ? v / Math.max(0.05, 1 - (l.cfVol || 0) / 100) : 0); // whole-soil water content to fine earth
  /* both models take clay as 100 - sand - silt, so a layer written without them would be all clay. What is missing is
     what its clay leaves, split between sand and silt as in the nearest layer with both (evenly if none has them); a
     layer without clay takes that layer's sand and silt too (loam, 40 and 40, if none has them) */
  function sandSilt(L) {
    const both = L.map((l, i) => [l, i]).filter(([l]) => ok(l.sand) && ok(l.silt));
    return L.map((l, i) => {
      if (ok(l.sand) && ok(l.silt)) return l;
      const n = both.length ? both.reduce((a, b) => (Math.abs(b[1] - i) < Math.abs(a[1] - i) ? b : a))[0] : { sand: 40, silt: 40 };
      const rest = Math.max(0, ok(l.clay) ? 100 - l.clay : n.sand + n.silt);
      if (ok(l.sand)) return { ...l, silt: Math.max(0, rest - l.sand) };
      if (ok(l.silt)) return { ...l, sand: Math.max(0, rest - l.silt) };
      const part = n.sand + n.silt > 0 ? n.sand / (n.sand + n.silt) : 0.5;
      return { ...l, sand: rest * part, silt: rest * (1 - part) };
    });
  }
  // what solText changed in the soil's values, for the README and the data sheet
  function solNotes(L, model) {
    const at = a => `${and(a.map(l => `${cm1(l.top)}-${cm1(l.bot)}`))} cm layer${a.length > 1 ? "s" : ""}`;
    const noTex = L.filter(l => !ok(l.sand) || !ok(l.silt)), tight = L.filter(l => fine(l.dul, l) < fine(l.ll, l) + 0.01);
    return [noTex.length ? `The ${at(noTex)} ${noTex.length > 1 ? "have" : "has"} no sand and silt in the data, and ${model} takes clay as 100 - sand - silt, which would make ${noTex.length > 1 ? "them" : "it"} all clay. So they come from the nearest layer with both: in its proportions after the layer's own clay, or as they are where the clay is missing too.` : "",
      tight.length ? `The ${at(tight)} ${tight.length > 1 ? "have" : "has"} a field capacity less than 0.01 above the wilting point. ${model} divides by the difference, so it is written as the wilting point + 0.01.` : ""];
  }
  /* each layer's values as solText writes them (missing stays null: the file has 0), also for the data sheet's
     preview; clay is not written, as the model takes it as 100 - sand - silt */
  const epicLayers = (soil, kind) => sandSilt(mergeLayers(soilRows(soil), kind === "epic" ? 15 : 10)).map(l => ({ top: l.top, bot: l.bot, hz: l.hz, bd: l.bd,
    ll: fine(l.ll, l), dul: Math.max(fine(l.dul, l), fine(l.ll, l) + 0.01), sand: l.sand, silt: l.silt, clay: 100 - l.sand - l.silt, ph: ok(l.ph) ? l.ph : 7,
    oc: ok(l.om) ? l.om / 1.72 : l.oc, caco3: l.caco3, cec: l.cec, cfVol: l.cfVol, ksat: l.ksat, ec: l.ec }));
  function solText(soil, kind) {
    const L = epicLayers(soil, kind);
    const f8 = v => fit(ok(v) ? v : 0, 8, ok(v) && Math.abs(v) < 10 ? 3 : 2);
    const hsg = { A: 1, B: 2, C: 3, D: 4 }[(soil.hydgrp || "C")[0]] || 3;
    const salb = Math.max(0.01, (ok(soil.albedo) ? soil.albedo : 0.15) * 0.625); // moist albedo from SSURGO's dry albedo (GeoEPIC)
    const rows = [
      L.map(l => l.bot / 100), L.map(l => l.bd), L.map(l => l.ll), L.map(l => l.dul), L.map(l => l.sand), L.map(l => l.silt),
      L.map(() => 0), L.map(l => l.ph), L.map(() => 0), L.map(l => l.oc), L.map(l => l.caco3), L.map(l => l.cec),
      L.map(l => l.cfVol), L.map(() => 0), L.map(() => 0), L.map(() => 0), L.map(() => 0), L.map(() => 0), L.map(l => l.ksat), L.map(() => 0),
      L.map(() => 0), L.map(() => 0), L.map(l => l.ec),
    ]; // lines 4-26: Z BD U FC SAN SIL WON PH SMB WOC CAC CEC ROK CNDS PKRZ RSD BDD PSP SATC HCL WP EXCK ECND
    const out = [];
    if (kind === "epic") out.push(`${short(soil.name, 24).replace(/ /g, "_") || "Soil"}    ${(soil.order || "Unknown").replace(/ /g, "_")}`);
    else out.push(short(`${soil.name} ${soil.order || ""}`, 20));
    out.push([salb, hsg, 0, 0, 0, 0, 0, 0, 0, 0].map(f8).join(""));
    out.push([10, 0, 50, 2, 0, 0, 0, 0, 0, 0].map(f8).join("")); // TSLA 10, XIDP 0, RTN 50 yr, XIDK 2 (mixed mineralogy)
    rows.forEach(r => out.push(r.map(f8).join("")));
    for (let i = 27; i <= 45; i++) out.push(L.map(() => f8(0)).join("")); // 27-45 pools: estimated by the model
    if (kind === "epic") {
      out.push(L.map(() => f8(0)).join(""), L.map(() => f8(0)).join("")); // 46 FE26, 47 SULF
      out.push(L.map(l => { const c = (l.hz || "").replace(/^[^A-Za-z]+/, "").charAt(0).toUpperCase(); return pad(["A", "B", "C"].includes(c) ? c : "A", 8); }).join("")); // 48 ASHZ: master letter (2Btk -> B)
      for (let i = 49; i <= 51; i++) out.push(L.map(() => f8(0)).join(""));
    } else for (let i = 46; i <= 51; i++) out.push("");
    return out.join(CRLF) + CRLF;
  }
  function epicApex(kind) {
    return ctx => {
      const { soil, site } = ctx, wx = clean(ctx.wx), E = kind === "epic", model = E ? "EPIC" : "APEX", b = ctx.stem || shortName(site), width = E ? 10 : 6;
      const title = `${short(site.name, 30)} SoilGuard`.slice(0, E ? 80 : 20);
      const line2 = `  LAT = ${site.lat.toFixed(2)}  LON = ${site.lon.toFixed(2)}  ELEV = ${(site.elev ?? 0).toFixed(1)}`;
      const files = [], notes = [];
      let statSrc = "the same days", wndSrc = "the weather source", sn = [], gone = "", lay = null;
      if (wx) {
        // generator statistics need every month: each group from the chosen dates, or from 10 complete years when they lack it
        const what = "the .WP1 and .WND statistics", src = statSources(wx, ctx.climWx, model, what), none = noneOf(wx);
        files.push({ name: `${b}.DLY`, text: dlyText(wx, kind) });
        files.push({ name: `${b}.WP1`, text: wp1Text(wp1Stats(src), title, line2, width) });
        const wm = windMonthly(ctx, src.wind, src.wind === wx ? "the weather source" : `the weather source over ${isoSpan(src.wind)}`);
        files.push({ name: `${b}.WND`, text: wndText(wm, title, line2, width) });
        statSrc = statText(src, wx); wndSrc = wm.src; sn = statNotes(src, wx, what);
        if (none.length) gone = `The .DLY has no ${and(none)} on any day, so ${model} generates ${none.length > 1 ? "them" : "it"} every day.`;
        notes.push(...[gone, badText(wx)].filter(Boolean), ...sn);
      }
      if (soil) {
        const H = soilRows(soil), max = E ? 15 : 10, L = mergeLayers(H, max);
        files.push({ name: `${b}.SOL`, text: solText(soil, kind) });
        lay = layering(soil, `${b}.SOL`, L, hzOf(soil), [H.length > max ? mergedText(model, max, H.length) : "", ...solNotes(L, model), omBlank(soil, `WOC is 0, which ${model} works out for itself`)]);
        notes.push(...lay.notes);
      }
      // the README names only the files in this zip: the weather files, the soil file, or both
      const ll = `${site.lat.toFixed(2).padStart(8)}${site.lon.toFixed(2).padStart(8)}${(site.elev ?? 0).toFixed(1).padStart(8)}`;
      const sub = and([soil ? "INPS = 901 (soil)" : "", wx ? "IWTH = 901 (daily weather)" : ""].filter(Boolean));
      files.push({ name: "README.txt", text: [
        `${E ? "EPIC 1102" : "APEX 1501"} files from SoilGuard for ${site.name} (${site.lat.toFixed(5)}, ${site.lon.toFixed(5)}).`,
        `File names: W + the latitude and longitude (to 0.001 degree) packed into 7 letters and digits, because ${model} wants 8.3 file names.`,
        "", wx ? `${b}.DLY  daily weather: year month day, solar MJ/m2, Tmax and Tmin degC, precipitation mm, RH fraction, wind m/s at 10 m (2X,3I4,6F6.2; no header).` : "",
        wx ? `        Feb 29 is included: set LPYR = 0 (${E ? "EPICCONT" : "APEXCONT"} line 1 field 9). NGN = 2345 reads every variable (line 1 field 6).` : "",
        wx ? `        Missing values: ${E ? "999.0 (generated by the model)" : "blank for solar, RH and wind; 9999.0 for Tmax, Tmin and rain (generated by the model)"}.` : "",
        gone ? `        ${gone}` : "",
        wx && badText(wx) ? `        ${badText(wx)}` : "",
        wx ? `${b}.WP1  monthly weather-generator statistics computed like WXPM3020 from ${statSrc} (${E ? "12F10.2" : "12F6.2"}); rain totals and wet days are per whole month`
          + " from the days with data, PW|D and PW|W from the days whose day before has data; WI (row 13) is 0, so the model estimates it." : "",
        ...sn.map(s => `        ${s}`),
        wx ? `${b}.WND  monthly 10 m wind speed and % of time from 16 directions (${E ? "12F10.2" : "12F6.1"}), from ${wndSrc}.` : "",
        soil ? `${b}.SOL  soil ${soil.name}: ${soil.source}. Field capacity and wilting point are written for the fine earth; use them with ISW = ${E ? "6 (EPICCONT line 2 field 6)" : "3 (APEXCONT line 2 field 8)"}, otherwise the model re-estimates them.` : "",
        soil ? "        Left 0, so the model estimates them: organic N, sum of bases, NO3, labile P, residue, oven-dry bulk density, P sorption, lateral K, organic P, exchangeable K. Mineralogy is set to mixed (XIDK = 2), years of cultivation to 50." : "",
        soil ? `        ${lay.text}` : "",
        "", wx || soil ? `Add ${wx ? "these lines" : "this line"} to the list file${wx ? "s" : ""} (ID 901 is an example):` : "",
        wx ? `  WDLSTCOM.DAT:  '  901 ${b}.DLY${ll}   ${short(site.name, 20)}'` : "",
        wx ? `  ${E ? "WPM1USEL.DAT" : "WPM1.DAT (the FWPM file in APEXFILE.DAT)"}:  '  901 ${b}.WP1${ll}   ${short(site.name, 20)}'` : "",
        wx ? `  ${E ? "WINDUSEL.DAT" : "WIND.DAT (the FWIND file in APEXFILE.DAT)"}:  '  901 ${b}.WND${ll}   ${short(site.name, 20)}'` : "",
        soil ? `  SOILCOM.DAT:  '  901 ${b}.SOL'` : "",
        !wx && !soil ? "" : E ? `Then point EPICRUN.DAT at ${wx ? "them" : "it"} (ISIT, ${[wx ? "IWP1 = 901, IWND = 901" : "", soil ? "INPS = 901" : "", wx ? "IWTH = 901" : ""].filter(Boolean).join(", ")}).`
          : `Then use ${wx ? "IWPM = 901 and IWND = 901 in APEXRUN.DAT, and " : ""}${sub} on line 2 of the .SUB file.`,
      ].filter(x => x !== "").join(CRLF) + CRLF });
      files.notes = notes;
      return files;
    };
  }
  W.epic = epicApex("epic");
  W.apex = epicApex("apex");

  /* ======================= SWAT+ ======================= */
  /* USLE K from texture and organic carbon when the survey gives none (Williams 1995; SWAT theory eqs. 4:1.1.5-9) */
  function williamsK(l) {
    const s = ok(l.sand) ? l.sand : 0, c = ok(l.clay) ? l.clay : 0, si = ok(l.silt) ? l.silt : Math.max(0, 100 - s - c);
    const oc = ok(l.oc) ? l.oc : ok(l.om) ? l.om / 1.72 : 1, sn = 1 - s / 100;
    const fcs = 0.2 + 0.3 * Math.exp(-0.256 * s * (1 - si / 100)), fcl = c + si > 0 ? (si / (c + si)) ** 0.3 : 1;
    const forg = 1 - (0.25 * oc) / (oc + Math.exp(3.72 - 2.95 * oc)), fhs = 1 - (0.7 * sn) / (sn + Math.exp(-5.51 + 22.9 * sn));
    return fcs * fcl * forg * fhs;
  }
  /* printf-style helpers matching the SWAT+ Editor's writer */
  const F = (v, w, d) => (ok(v) ? v.toFixed(d) : (-99).toFixed(d)).padStart(w);
  const I = (v, w) => String(v).padStart(w);
  const SWAT_MISS = -99;
  // SWAT+ assumes wind measured at 1.7 m: u1.7 = u10 (170/1000)^0.2 (SWAT theory eq. 1:1.4.2)
  const TO_17 = (170 / 1000) ** 0.2;
  function swatStationName(site) {
    const a = Math.round(Math.abs(site.lat) * 1000), b = Math.round(Math.abs(site.lon) * 1000);
    return `s${a}${site.lat >= 0 ? "n" : "s"}${b}${site.lon >= 0 ? "e" : "w"}`;
  }
  function swatData(wx, name, kind, site) {
    const first = ymdOf(wx.days[0])[0], last = ymdOf(wx.days[wx.days.length - 1])[0];
    const label = { pcp: "Precipitation", tem: "Temperature", slr: "Solar radiation", hmd: "Relative humidity", wnd: "Wind speed (at 1.7 m)", pet: "Potential ET (grass ET0)" }[kind];
    const L = [`${name}.${kind}: ${label} data - file written by SoilGuard`, `${"nbyr".padStart(4)}${"tstep".padStart(10)}${"lat".padStart(10)}${"lon".padStart(10)}${"elev".padStart(10)}`,
      `${I(last - first + 1, 4)}${I(0, 10)}${F(site.lat, 10, 3)}${F(site.lon, 10, 3)}${F(site.elev ?? 0, 10, 3)}`];
    wx.days.forEach((d, k) => {
      const y = ymdOf(d)[0], j = doyOf(d), v = x => (ok(x) ? x : SWAT_MISS);
      if (kind === "tem") L.push(`${I(y, 4)}${I(j, 5)} ${F(v(wx.tmax[k]), 10, 5)}  ${F(v(wx.tmin[k]), 10, 5)}  `);
      else {
        const x = kind === "pcp" ? wx.prcp[k] : kind === "slr" ? wx.srad[k] : kind === "hmd" ? (ok(wx.rh[k]) ? Math.min(0.99, Math.max(0.01, wx.rh[k] / 100)) : null)
          : kind === "wnd" ? (ok(wx.wind10[k]) ? wx.wind10[k] * TO_17 : null) : wx.et0[k];
        L.push(`${I(y, 4)}${I(j, 5)} ${F(v(x), 10, 5)}  `);
      }
    });
    return L.join("\n") + "\n";
  }
  /* weather generator statistics (SWAT2012 IO ch. 12, SWAT+ weather-wgn.cli), each group from the series statSources
     picked: daily values incl. dry days for the rain SD and skew; a wet day has at least 0.1 mm (gridded data carry
     trace amounts on many days). */
  function swatWgn(src) {
    const S = groupsOf(src), R = rainStats(S.prcp, p => p >= 0.1);
    const tx = byMonth(S.temp, "tmax"), tn = byMonth(S.temp, "tmin"), sr = byMonth(S.srad, "srad"), rh = byMonth(S.rh, "rh"), ws = byMonth(S.wind, "wind10");
    const out = R.map((r, m) => [mean(tx[m]), mean(tn[m]), sd(tx[m]), sd(tn[m]), r.total, sd(r.all), skew(r.all), r.pwd, r.pww, r.wetDays,
      mean(r.maxima.map(x => x / 3)), // max 0.5-h rain: a third of each year's largest daily rain (no sub-daily data)
      mean(sr[m]), mean(rh[m]) / 100, mean(ws[m]) * TO_17]);
    return { months: out, years: Math.max(...R.map(r => r.years)) };
  }
  /* a layer's soils.sol values, dp to ph (the QSWAT+ table takes the first 12, to ec), also for the data sheet's
     preview; usle_k is the rock-free K (SWAT+ applies its own coarse-fragment factor) */
  const swatLay = soil => {
    const alb = ok(soil.albedo) ? soil.albedo : 0.13, kOf = l => (ok(l.kf) ? l.kf : ok(l.kw) ? l.kw : williamsK(l));
    return l => [l.bot * 10, l.bd, ok(l.awc) ? l.awc : (ok(l.dul) && ok(l.ll) ? l.dul - l.ll : 0), l.ksat, ok(l.om) ? l.om / 1.72 : l.oc, l.clay, l.silt, l.sand,
      Math.min(98, l.cfWt || 0), alb, kOf(l), l.ec || 0, l.caco3 || 0, ok(l.ph) ? l.ph : 7];
  };
  const WGN_COLS = ["tmp_max_ave", "tmp_min_ave", "tmp_max_sd", "tmp_min_sd", "pcp_ave", "pcp_sd", "pcp_skew", "wet_dry", "wet_wet", "pcp_days", "pcp_hhr", "slr_ave", "dew_ave", "wnd_ave"];
  W.swatplus = ctx => {
    const { soil, site } = ctx, wx = clean(ctx.wx), files = [], notes = [], st = swatStationName(site), wgn = `wgn${st.slice(1)}`;
    let wgnSrc = "the same days", sn = [], gone = "", soilNote = null, uLine = "", noK = false, noPh = false;
    if (wx) {
      // generator statistics need every month: each group from the chosen dates, or from 10 complete years when they lack it
      const what = "the weather-wgn.cli statistics", src = statSources(wx, ctx.climWx, "SWAT+", what), none = noneOf(wx);
      if (none.length) gone = `The station files have no ${and(none)} on any day (-99), so SWAT+ generates ${none.length > 1 ? "them" : "it"} from weather-wgn.cli.`;
      sn = statNotes(src, wx, what);
      notes.push(...[gone, badText(wx)].filter(Boolean), ...sn);
      const kinds = ["pcp", "tem", "slr", "hmd", "wnd"];
      kinds.forEach(k => files.push({ name: `${st}.${k}`, text: swatData(wx, st, k, site) }));
      const list = (cli, k, desc) => files.push({ name: cli, text: `${cli}: ${desc} file names - file written by SoilGuard\nfilename\n${st}.${k}\n` });
      list("pcp.cli", "pcp", "Precipitation"); list("tmp.cli", "tem", "Temperature"); list("slr.cli", "slr", "Solar radiation");
      list("hmd.cli", "hmd", "Relative humidity"); list("wnd.cli", "wnd", "Wind speed");
      const sta = (a, b, c, d, e, f, g, h, i) => `${a.padEnd(16)}  ${b.padStart(16)}  ${c.padStart(25)}  ${d.padStart(25)}  ${e.padStart(25)}  ${f.padStart(25)}  ${g.padStart(25)}  ${h.padStart(25)}  ${i.padStart(16)}  `;
      files.push({ name: "weather-sta.cli", text: [`weather-sta.cli: written by SoilGuard for ${short(site.name, 40)}`,
        sta("name", "wgn", "pcp", "tmp", "slr", "hmd", "wnd", "pet", "atmo_dep"),
        sta(st, wgn, `${st}.pcp`, `${st}.tem`, `${st}.slr`, `${st}.hmd`, `${st}.wnd`, "null", "null")].join("\n") + "\n" });
      wgnSrc = statText(src, wx);
      const g = swatWgn(src);
      files.push({ name: "weather-wgn.cli", text: [`weather-wgn.cli: written by SoilGuard from daily ${wx.source} weather`,
        `${wgn.padEnd(25)}  ${F(site.lat, 12, 5)}  ${F(site.lon, 12, 5)}  ${F(site.elev ?? 0, 12, 5)}  ${I(g.years, 8)}  `,
        WGN_COLS.map(c => c.padStart(12) + "  ").join(""),
        ...g.months.map(r => r.map(v => F(v, 12, 5) + "  ").join(""))].join("\n") + "\n" });
      // the SWAT2012 / ArcSWAT text format (also imported by the SWAT+ Editor)
      const id = "1", nm = st.slice(0, 8);
      const s12 = (list, suffix, val) => {
        files.push({ name: `swat2012_format/${list}`, text: `ID,NAME,LAT,LONG,ELEVATION\n${id},${nm}${suffix},${site.lat.toFixed(4)},${site.lon.toFixed(4)},${(site.elev ?? 0).toFixed(1)}\n` });
        const [y, mo, da] = ymdOf(wx.days[0]);
        files.push({ name: `swat2012_format/${nm}${suffix}.txt`, text: [`${y}${String(mo).padStart(2, "0")}${String(da).padStart(2, "0")}`, ...wx.days.map((_, k) => val(k))].join("\n") });
      };
      const n3 = v => (ok(v) ? v.toFixed(3) : "-99");
      s12("pcp.txt", "pcp", k => n3(wx.prcp[k])); s12("tmp.txt", "tmp", k => `${n3(wx.tmax[k])},${n3(wx.tmin[k])}`); s12("slr.txt", "slr", k => n3(wx.srad[k]));
      s12("hmd.txt", "hmd", k => n3(ok(wx.rh[k]) ? wx.rh[k] / 100 : null)); s12("wnd.txt", "wnd", k => n3(ok(wx.wind10[k]) ? wx.wind10[k] * TO_17 : null));
    }
    if (soil) {
      const { L, noBd } = swatLayers(soil);
      if (!L.length) throw new Error(`SWAT+: the survey gives no bulk density for any horizon of ${soil.name}, and SWAT+ soils leave out horizons without one`);
      const name = short(soil.id === "USER" ? `USER_${soil.name}` : soil.id, 20).replace(/ /g, "_") || "WGSOIL";
      const hg = ((soil.hydgrp || "B").trim()[0] || "B").toUpperCase();
      const tex = (L.map(l => (l.texture || texOf(l) || "").replace(/\s+/g, "")).filter(Boolean).join("-") || "UNK").slice(0, 16).replace(/-+$/, ""); // SWAT+ reads 16 characters
      const head = ["name", "nly", "hyd_grp", "dp_tot", "anion_excl", "perc_crk", "texture", "dp", "bd", "awc", "soil_k", "carbon", "clay", "silt", "sand", "rock", "alb", "usle_k", "ec", "caco3", "ph"];
      const lay = swatLay(soil);
      files.push({ name: "soils.sol", text: [`soils.sol: ${soil.name} - ${soil.source} - written by SoilGuard`,
        `${"name".padEnd(25)}  ${"nly".padStart(8)}  ${"hyd_grp".padStart(16)}  ${"dp_tot".padStart(12)}  ${"anion_excl".padStart(12)}  ${"perc_crk".padStart(12)}  ${"texture".padEnd(25)}  ` + head.slice(7).map(h => h.padStart(12) + "  ").join(""),
        `${name.padEnd(25)}  ${I(L.length, 8)}  ${hg.padStart(16)}  ${F(L[L.length - 1].bot * 10, 12, 5)}  ${F(0.5, 12, 5)}  ${F(0.5, 12, 5)}  ${tex.padEnd(25)}  `,
        ...L.map(l => " ".repeat(124) + lay(l).map(v => F(ok(v) ? v : 0, 12, 5) + "  ").join(""))].join("\n") + "\n" });
      // QSWAT+ user soil table (single table, 152 columns, by position; at most 10 layers)
      const L10 = mergeLayers(L, 10), cols = ["OBJECTID", "MUID", "SEQN", "SNAM", "S5ID", "CMPPCT", "NLAYERS", "HYDGRP", "SOL_ZMX", "ANION_EXCL", "SOL_CRK", "TEXTURE"];
      for (let i = 1; i <= 10; i++) cols.push(...["SOL_Z", "SOL_BD", "SOL_AWC", "SOL_K", "SOL_CBN", "CLAY", "SILT", "SAND", "ROCK", "SOL_ALB", "USLE_K", "SOL_EC"].map(c => c + i));
      for (let i = 1; i <= 10; i++) cols.push("SOL_CAL" + i);
      for (let i = 1; i <= 10; i++) cols.push("SOL_PH" + i);
      const row = [1, soil.id, soil.id, name, "WG", 100, L10.length, hg, L10[L10.length - 1].bot * 10, 0.5, 0.5, tex];
      for (let i = 0; i < 10; i++) { const l = L10[i]; row.push(...(l ? lay(l).slice(0, 12).map(v => +(+v || 0).toFixed(4)) : new Array(12).fill(0))); }
      for (let i = 0; i < 10; i++) row.push(L10[i] ? +(L10[i].caco3 || 0).toFixed(2) : 0);
      for (let i = 0; i < 10; i++) row.push(L10[i] ? +(ok(L10[i].ph) ? L10[i].ph : 7).toFixed(2) : 0);
      files.push({ name: "usersoil_soilguard.csv", text: cols.join(",") + "\n" + row.join(",") + "\n" });
      noK = L.some(l => !ok(l.kf) && !ok(l.kw)); noPh = L.some(l => !ok(l.ph));
      soilNote = layering(soil, "soils.sol", L, hzOf(soil), [omBlank(soil, "carbon is 0 in soils.sol and the user soil table"),
        noBd.length ? `soils.sol and the QSWAT+ table leave out the ${and(noBd.map(l => `${cm1(l.top)}-${cm1(l.bot)} cm`))} horizon${noBd.length > 1 ? "s, which have" : ", which has"} no survey bulk density, as the official SWAT+ soil database does.` : "",
        L.length > 10 ? `The QSWAT+ user soil table takes at most 10 layers, so the ${L.length} layers of soils.sol were merged to 10 there (the thinnest neighbours, thickness-weighted, organic matter, carbon, CaCO3 and N by mass; Ksat as a harmonic mean).` : ""]);
      if (L.length > 10) uLine = `  ${layersLine("usersoil_soilguard.csv", L10)}.`;
      notes.push(...soilNote.notes);
    }
    files.push({ name: "README.txt", text: [
      `SWAT+ files from SoilGuard for ${site.name} (${site.lat.toFixed(5)}, ${site.lon.toFixed(5)}). SWAT+ rev 60.5 to 62 (Editor 2.x to 4.1).`,
      "", wx ? `Weather station ${st}: ${st}.pcp (mm), ${st}.tem (Tmax, Tmin degC), ${st}.slr (MJ/m2/day), ${st}.hmd (relative humidity as a fraction), ${st}.wnd (m/s at 1.7 m,`
        + " converted from 10 m with SWAT's power law, x0.7015), one row per day, missing values -99 (generated by the model)." : "",
      gone ? `  ${gone}` : "",
      wx && badText(wx) ? `  ${badText(wx)}` : "",
      wx ? "  Import: SWAT+ Editor > Weather generator / Observed weather > import 'SWAT+ format' from this folder; or copy the files into TxtInOut, list them in file.cio" : "",
      wx ? "  ('climate weather-sta.cli weather-wgn.cli null pcp.cli tmp.cli slr.cli hmd.cli wnd.cli null') and name the station in the 'wst' column of the .con files." : "",
      wx ? `  weather-wgn.cli: monthly generator statistics from ${wgnSrc} (wet day >= 0.1 mm; rain totals and wet days per whole month from the days with data, wet_dry and wet_wet from the days whose day before has data;`
        + " pcp_hhr is a third of the largest daily rain of each month, averaged over the years in which the month is complete, because no sub-daily rain is available)." : "",
      ...sn.map(s => `    ${s}`),
      wx ? "  swat2012_format/: the same data in the ArcSWAT / SWAT2012 text format (ID,NAME,LAT,LONG,ELEVATION lists plus one file per station)." : "",
      soil ? `Soil ${soil.name} (${soil.source}): soils.sol (TxtInOut) and usersoil_soilguard.csv (QSWAT+ user soil table, 152 columns).` : "",
      soil ? "  Units: dp mm, bd g/cm3, awc mm/mm, soil_k mm/h, carbon % (OM/1.72), rock % by weight > 2 mm, alb = dry albedo (as in the official SWAT+ SSURGO database), usle_k = rock-free K (kffact)." : "",
      soil ? `  ${soil.mukey && soil.layering !== "custom" ? "Horizons without bulk density (bedrock, cemented pans) are left out, as in the official database; a" : "A"} dual hydrologic group keeps its first letter.` : "",
      noK ? "  Layers without a survey K factor get one from texture and organic carbon (Williams 1995, the SWAT method)." : "",
      noPh ? "  A blank pH is written as 7.0 in soils.sol and the QSWAT+ table." : "",
      soil ? `  ${soilNote.text}` : "",
      uLine,
    ].filter(Boolean).join("\r\n") + "\r\n" });
    files.notes = notes;
    return files;
  };

  /* ======================= shared by DSSAT, APSIM and AquaCrop ======================= */
  const ascii = s => String(s ?? "").normalize("NFKD").replace(/[^\x20-\x7e]/g, "");
  const r1 = v => (Math.round(v * 10) / 10 + 0).toFixed(1); // one decimal, never "-0.0"
  const r3 = v => Math.round(v * 1000) / 1000;
  const srcLabel = wx => (wx.source === "gridmet" ? "gridMET 4-km daily (Abatzoglou 2013)" : wx.source === "power" ? "NASA POWER daily (MERRA-2 based)"
    : wx.source === "prism" ? `PRISM 4-km rain and temperature (PRISM Group, Oregon State University, accessed ${new Date().toISOString().slice(0, 10)})${wx.rest ? ` with ${wx.rest} solar, humidity and wind` : ""}` : ascii(wx.source || "own daily file"));
  /* where a series' grass reference ET0 comes from. The data sheet fills a file's ET0 before the writers run;
     wx.et0Made, when there, counts the file's own days, the days worked out, those by Hargreaves and those with solar
     radiation from the temperature range. */
  function et0Text(wx) {
    if (wx.source === "gridmet") return "gridMET's grass reference ET (ASCE standardized Penman-Monteith, the FAO-56 constants)";
    // without another source there is no solar radiation, humidity or wind, so fao56 takes Hargreaves on every day
    if (wx.source === "prism") return wx.rest ? `FAO-56 Penman-Monteith worked out by SoilGuard from PRISM's temperature and ${wx.rest} solar radiation, humidity and wind, or Hargreaves (FAO-56 Eq. 52) on days without them`
      : `Hargreaves (FAO-56 Eq. 52) worked out by SoilGuard from PRISM's Tmax and Tmin on every day, as there is no solar radiation, humidity or wind${wx.restWhy ? ` (${wx.restWhy})` : ""}`;
    if (wx.source === "power") return "FAO-56 Penman-Monteith worked out by SoilGuard from NASA POWER's daily weather, or Hargreaves (FAO-56 Eq. 52) on days without solar radiation, dew point or wind";
    const n = wx.et0Made, days = x => `${x} day${x === 1 ? "" : "s"}`, how = "from the file's columns after any gap filling: FAO-56 Penman-Monteith";
    const hs = which => `, or Hargreaves (FAO-56 Eq. 52) on ${which} without humidity or wind`;
    if (!n) return `the file's own ET0 column where it has one, else worked out by SoilGuard ${how}${hs("days")}`;
    return [n.own ? `the file's own ET0 column on ${days(n.own)}` : "",
      n.made ? `worked out by SoilGuard on ${days(n.made)} ${how}${n.solar ? ` (solar radiation from the temperature range, FAO-56 Eq. 50, on ${days(n.solar)})` : ""}${n.hs ? hs(`the ${n.hs}`) : ""}` : ""].filter(Boolean).join("; ") || "none";
  }
  /* extraterrestrial radiation, MJ/m2/day (FAO-56 Eqs. 21-25) */
  function ra(d, lat) {
    const J = doyOf(d), phi = (lat * Math.PI) / 180, dr = 1 + 0.033 * Math.cos((2 * Math.PI * J) / 365), dec = 0.409 * Math.sin((2 * Math.PI * J) / 365 - 1.39);
    const ws = Math.acos(Math.max(-1, Math.min(1, -Math.tan(phi) * Math.tan(dec))));
    return ((24 * 60) / Math.PI) * 0.082 * dr * (ws * Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.sin(ws));
  }
  /* a gap-free copy for models that refuse missing values. It runs from the first to the last day with both Tmax and
     Tmin (w.cut counts the days left out at either end), after values no station reports are taken as missing
     (clean). Tmax, Tmin (and 2 m wind) are linear between the nearest days with data; at either end a run of up to
     3 days takes the first or last value, and a longer one (wind only: Tmax and Tmin have data on the first and last
     day) the column's mean for that calendar month over the series, or its overall mean when the month has none.
     Solar radiation comes from Hargreaves (FAO-56 Eq. 50, kRs 0.16), rain is 0, vapour pressure comes from the dew
     point or Tmin and ET0 from FAO-56 with what there is; a Tmax below Tmin is swapped. A column with no data at all
     becomes null (left out). w.completed counts the days changed. */
  function complete(wx, keys) {
    const c = clean(wx), N = c.days.length, both = k => ok(c.tmax[k]) && ok(c.tmin[k]);
    let i0 = 0, i1 = N - 1;
    while (i0 < N && !both(i0)) i0++;
    while (i1 > i0 && !both(i1)) i1--;
    if (i0 === N) throw new Error("the weather has no daily Tmax and Tmin");
    const t = { ...c }, n = {}, count = (k, x) => { if (x) n[k] = (n[k] || 0) + x; };
    Object.keys(c).forEach(k => { if (Array.isArray(c[k]) && c[k].length === N) t[k] = c[k].slice(i0, i1 + 1); });
    const w = { ...t, cut: { head: i0, tail: N - 1 - i1 } };
    const has = k => Array.isArray(t[k]) && t[k].some(ok);
    // a column with some data, filled: [values, days from neighbouring days, days from the calendar-month mean]
    const fill = a => {
      const o = a.slice(), at = [], bm = byMonth({ days: t.days, v: a }, "v"), all = mean(bm.flat());
      a.forEach((v, i) => { if (ok(v)) at.push(i); });
      const mm = bm.map(x => (x.length ? mean(x) : all)), first = at[0], last = at[at.length - 1];
      let near = 0, monthly = 0;
      for (let q = 1; q < at.length; q++) {
        const p = at[q - 1], i = at[q];
        for (let j = p + 1; j < i; j++, near++) o[j] = a[p] + ((a[i] - a[p]) * (j - p)) / (i - p);
      }
      [[0, first, a[first]], [last + 1, a.length, a[last]]].forEach(([j0, j1, v]) => {
        for (let j = j0; j < j1; j++) {
          if (j1 - j0 <= 3) { o[j] = v; near++; } else { o[j] = mm[months(t.days[j])]; monthly++; }
        }
      });
      return [o, near, monthly];
    };
    ["tmax", "tmin", "wind2"].forEach(k => {
      if (k === "wind2" && !keys.includes(k)) return;
      if (!has(k)) { w[k] = null; return; }
      const [o, x, xm] = fill(t[k]);
      w[k] = o; count(k, x); count(`${k}Month`, xm);
    });
    let s = 0;
    w.tmax.forEach((tx, k) => { if (tx < w.tmin[k]) { w.tmax[k] = w.tmin[k]; w.tmin[k] = tx; s++; } });
    count("swap", s);
    if (keys.includes("srad")) {
      let x = 0;
      w.srad = t.days.map((d, k) => { const v = t.srad ? t.srad[k] : null; if (ok(v)) return v; x++; return 0.16 * Math.sqrt(Math.max(w.tmax[k] - w.tmin[k], 0)) * ra(d, t.lat); });
      count("srad", x);
    }
    if (keys.includes("prcp")) { let x = 0; w.prcp = t.prcp.map(v => (ok(v) ? v : (x++, 0))); count("prcp", x); }
    if (keys.includes("vp")) {
      if (!has("vp")) w.vp = null;
      else {
        let x = 0;
        const es = T => 0.6108 * Math.exp((17.27 * T) / (T + 237.3));
        w.vp = t.vp.map((v, k) => (ok(v) ? v : (x++, t.tdew && ok(t.tdew[k]) ? es(t.tdew[k]) : es(w.tmin[k]))));
        count("vp", x);
      }
    }
    if (keys.includes("et0")) {
      let x = 0, xs = 0; // xs: days whose Penman-Monteith ET0 takes the solar radiation filled above
      const phi = (t.lat * Math.PI) / 180, z = t.elev ?? 0, u2 = w.wind2 || t.wind2 || [], rs = w.srad || t.srad || [];
      w.et0 = t.days.map((d, k) => {
        const v = t.et0 ? t.et0[k] : null;
        if (ok(v)) return v;
        x++;
        const td = t.tdew && ok(t.tdew[k]) ? t.tdew[k] : null, u = ok(u2[k]) ? u2[k] : null;
        if (td !== null && u !== null && ok(rs[k]) && !(t.srad && ok(t.srad[k]))) xs++;
        return Wd.fao56(doyOf(d), phi, z, w.tmax[k], w.tmin[k], td, u, ok(rs[k]) ? rs[k] : null);
      });
      count("et0", x); count("et0Srad", xs);
    }
    w.completed = n;
    return w;
  }
  /* the gap-free copy each model gets: what complete fills, and the daily variables its files hold (AquaCrop's solar
     radiation only feeds the ET0 of days without one). For the writers and the data sheet's preview. */
  const GAP_FREE = { dssat: { keys: ["srad", "prcp"], holds: ["srad", "tmax", "tmin", "prcp", "tdew", "wind2"] },
    apsim: { keys: ["srad", "prcp", "vp", "wind2"], holds: ["srad", "tmax", "tmin", "prcp", "vp", "wind2"] },
    aquacrop: { keys: ["srad", "prcp", "et0"], holds: ["tmax", "tmin", "prcp", "et0"] } };
  const gapFree = (model, wx) => Object.assign(complete(wx, GAP_FREE[model].keys), { holds: GAP_FREE[model].holds });
  // the variable a count of w.completed is for (wind2Month: wind2; swap: Tmax and Tmin; et0Srad: ET0)
  const filledVar = k => (k === "swap" ? "tmax" : k === "et0Srad" ? "et0" : k.replace(/Month$/, ""));
  const FILLED = { tmax: "Tmax (linear between neighbouring days)", tmin: "Tmin (linear)", wind2: "wind (linear)", wind2Month: "wind (monthly mean, more than 3 days at the start or end)", swap: "Tmax below Tmin (swapped)",
    srad: "solar radiation (Hargreaves, FAO-56 Eq. 50)", prcp: "rain (set to 0)", vp: "vapour pressure (from dew point or Tmin)", et0: "ET0 (FAO-56 from the other columns)",
    et0Srad: "solar radiation for that ET0 (Hargreaves, FAO-56 Eq. 50)" };
  // the days filled in what the files hold
  const filledText = w => {
    const e = Object.entries(w.completed || {}).filter(([k]) => !w.holds || w.holds.includes(filledVar(k)));
    return [badText(w), e.length ? `Missing days filled, because this model cannot read gaps: ${e.map(([k, c]) => `${FILLED[k] || k} ${c} day${c > 1 ? "s" : ""}`).join("; ")}.`
      : "No missing values needed filling."].filter(Boolean).join(" ");
  };
  // when the weather has no Tmax and Tmin at the start or end of the chosen dates, so the files are shorter
  const cutText = (w, ctx) => {
    const a = ctx.d0 ?? ctx.wx.days[0], b = ctx.d1 ?? ctx.wx.days[ctx.wx.days.length - 1], f = w.days[0], l = w.days[w.days.length - 1];
    if (f <= a && l >= b) return "";
    return `The weather has no Tmax and Tmin ${[f > a ? `before ${Wd.isoDay(f)}` : "", l < b ? `after ${Wd.isoDay(l)}` : ""].filter(Boolean).join(" or ")}, `
      + `so these files run from ${Wd.isoDay(f)} to ${Wd.isoDay(l)} instead of the chosen ${Wd.isoDay(a)} to ${Wd.isoDay(b)}.`;
  };
  /* TAV and AMP from monthly means of the daily mean temperature; every month needs 20+ days. Pooled over all years
     (DSSAT: TAV = mean of the 12 means, AMP = warmest minus coldest month, as CSM and its official files do), or
     averaged over complete calendar years (APSIM's tav_amp). rough: without a full set of months, the same from the
     months there are, marked approx. */
  function tavAmp(wx, perYear, rough) {
    if (!wx || !wx.days || !wx.days.length) return null;
    const w = clean(wx), acc = new Map(), span = [];
    w.days.forEach((d, k) => {
      const tx = w.tmax[k], tn = w.tmin[k];
      if (!ok(tx) || !ok(tn)) return;
      if (!span.length) span[0] = d;
      span[1] = d;
      const [y, m] = ymdOf(d), key = perYear ? y : 0;
      if (!acc.has(key)) acc.set(key, Array.from({ length: 12 }, () => [0, 0]));
      const c = acc.get(key)[m - 1];
      c[0] += (tx + tn) / 2; c[1]++;
    });
    const res = [...acc.entries()].filter(([, ms]) => ms.every(c => c[1] >= 20)).map(([y, ms]) => {
      const mm = ms.map(c => c[0] / c[1]);
      return { y, tav: mm.reduce((a, b) => a + b, 0) / 12, amp: Math.max(...mm) - Math.min(...mm) };
    });
    const days = span.length ? isoSpan({ days: span }) : ""; // the days with temperatures
    if (!res.length) {
      if (perYear) return tavAmp(wx, false, rough);
      const mm = rough && acc.has(0) ? acc.get(0).filter(c => c[1]).map(c => c[0] / c[1]) : [];
      return mm.length ? { tav: mean(mm), amp: Math.max(...mm) - Math.min(...mm), approx: true, label: mm.length < 12 ? `${mm.length} month${mm.length > 1 ? "s" : ""} only, ${days}` : days } : null;
    }
    const yrs = res.map(r => r.y);
    return { tav: res.reduce((a, r) => a + r.tav, 0) / res.length, amp: res.reduce((a, r) => a + r.amp, 0) / res.length,
      label: perYear ? `${res.length} complete year${res.length > 1 ? "s" : ""}, ${Math.min(...yrs)}-${Math.max(...yrs)}` : days };
  }
  // from the chosen dates, else the 10 years read for the climate, else roughly from the months the dates have
  const climOf = (ctx, perYear) => tavAmp(ctx.wx, perYear) || tavAmp(ctx.climWx, perYear) || tavAmp(ctx.wx, perYear, true);
  // why TAV and AMP do not come from the chosen dates alone
  const tavWhy = wx => (new Set(wx.days.map(months)).size === 12 ? "the dates have fewer than 20 days of Tmax and Tmin in some months" : "the dates do not cover every month");
  // NOAA GML Mauna Loa annual mean CO2 (ppm), 1979-2025 and 1959-1978 (gml.noaa.gov/ccgg/trends); later years +2.5 ppm a year, as AquaCrop's MaunaLoa.CO2; earlier years the 1959 value
  const CO2_Y0 = 1979, CO2 = [336.84, 338.76, 340.12, 341.48, 343.15, 344.87, 346.35, 347.61, 349.31, 351.69, 353.20, 354.45, 355.70, 356.54, 357.21,
    358.96, 360.97, 362.74, 363.88, 366.84, 368.54, 369.71, 371.32, 373.45, 375.98, 377.70, 379.98, 382.09, 384.02, 385.83, 387.64, 390.10, 391.85,
    394.06, 396.74, 398.81, 401.01, 404.41, 406.76, 408.72, 411.65, 414.21, 416.41, 418.53, 421.08, 424.61, 427.35];
  const CO2_OLD_Y0 = 1959, CO2_OLD = [315.98, 316.91, 317.64, 318.45, 318.99, 319.62, 320.04, 321.37, 322.18, 323.05, 324.62, 325.68, 326.32, 327.46, 329.68, 330.19, 331.13, 332.03, 333.84, 335.41];
  const co2Of = y => (y < CO2_Y0 ? CO2_OLD[Math.max(0, y - CO2_OLD_Y0)] : y - CO2_Y0 < CO2.length ? CO2[y - CO2_Y0] : CO2[CO2.length - 1] + 2.5 * (y - CO2_Y0 - CO2.length + 1));
  /* horizons the crop models can use: water retention and bulk density present, from the first such horizon down to
     the first without (bedrock or a cemented pan ends the profile) */
  function soilRows(soil) {
    const H = [];
    for (const l of soil.layers) {
      if (ok(l.top) && ok(l.bot) && l.bot > l.top && ok(l.ll) && ok(l.dul) && ok(l.bd)) H.push(l);
      else if (H.length) break;
    }
    if (!H.length) throw new Error("the soil has no layers with water retention and bulk density");
    return H;
  }
  // horizons without a survey bulk density are left out, as in the official SWAT+ database; custom layers are the
  // user's own depths, and always have a thickness-weighted bulk density
  function swatLayers(soil) {
    const all = soilRows(soil), noBd = soil.layering === "custom" ? [] : all.filter(l => l.noBd);
    return { L: all.filter(l => !noBd.includes(l)), noBd };
  }
  /* each layer of a model's soil file with the values it holds, for the data sheet's preview, by the functions its
     writer uses: what the writer changed shows (fine earth, the LL < DUL < SAT caps, defaults), what the file does not
     hold is left out, and a missing value stays null. The plain CSV and the soil table list the layers as they are. */
  function writtenLayers(model, soil) {
    if (model === "dssat") return dssatValues(dssatLayers(soil));
    if (model === "epic" || model === "apex") return epicLayers(soil, model);
    if (model === "apsim") {
      const L = apsimLayers(soil), v = apsimValues(L);
      return L.map((l, i) => ({ top: l.top, bot: l.bot, hz: l.hz, bd: v.BD[i], ll: v.LL[i], dul: v.DUL[i], sat: v.SAT[i], ksat: v.KS[i] / 24, sand: v.sand[i], silt: v.silt[i], clay: v.clay[i],
        oc: v.carbon[i], ph: v.ph[i], cec: v.cec ? v.cec[i] : null, cfVol: v.rocks ? v.rocks[i] : null }));
    }
    if (model === "aquacrop") return aquaValues(aquaLayers(soil)).map(x => ({ top: x.l.top, bot: x.l.bot, hz: x.l.hz, ll: x.wp / 100, dul: x.fc / 100, sat: x.sat / 100, ksat: x.ks / 24 }));
    if (model === "swatplus") {
      const lay = swatLay(soil);
      return swatLayers(soil).L.map(l => { const v = lay(l); return { top: l.top, bot: l.bot, hz: l.hz, bd: v[1], awc: v[2], ksat: v[3], oc: v[4], clay: v[5], silt: v[6], sand: v[7], cfWt: v[8], ec: v[11], caco3: v[12], ph: v[13] }; });
    }
    if (model === "century") return WG.writerUtil.centuryLayers(soil);
    if (model === "daycent") return WG.writerUtil.daycentLayers(soil);
    return soil.layers;
  }
  // what a file holds where the soil has no organic matter, for its README
  const omBlank = (soil, what) => (soil.layers.some(l => !ok(l.om) && ok(l.ll)) ? `Layers without organic matter: ${what}.` : "");
  // "model": each model's usual layering; "survey" and "custom": the layers as given (merged only past a model's limit)
  const ownLayers = soil => soil.layering === "custom" || soil.layering === "survey";
  const texOf = l => WG.soil.textureClass(l.sand, ok(l.silt) ? l.silt : 100 - l.sand - l.clay, l.clay);
  const cm1 = v => +v.toFixed(1);
  // "WG.SOL: 13 layers, 0-203 cm, bottoms 5, 15, 26, ... 203 cm"
  const layersLine = (file, L) => `${file}: ${L.length} layer${L.length > 1 ? "s" : ""}, ${cm1(L[0].top)}-${cm1(L[L.length - 1].bot)} cm, bottoms ${L.map(l => cm1(l.bot)).join(", ")} cm`;
  const hzOf = soil => (soil.mukey ? "the survey's horizons" : "your layers");
  const mergedText = (model, max, n) => `${model} takes at most ${max} layers, so the profile's ${n} layers were merged to ${max} (the thinnest neighbours, thickness-weighted, organic matter, carbon, CaCO3 and N by mass; Ksat as a harmonic mean).`;
  /* a restriction at the surface would leave no layer open to roots: APSIM refuses that soil, and DSSAT and AquaCrop
     grow no roots on it. So the first layer stays open, and a note says so. */
  const rootsOpen = (l, i) => i === 0 || l.srgf !== 0;
  const rootNote = (L, what) => (L[0].srgf === 0 ? `The survey puts a root-restrictive layer at the top of this soil, so no layer would be open to roots. The first layer (${cm1(L[0].top)}-${cm1(L[0].bot)} cm) is left open (${what}) so that the file can be run${L.length > 1 ? ", and the layers below stay closed" : ""}: check that this soil suits the crop.` : "");
  /* the README text on a soil file's layers: count, depth range and bottoms, how they were made (usual: the model's
     own layering), where bedrock or the end of the profile left its mark, and fit: what was merged or cut to fit the
     model, which are also the notes for the data sheet */
  function layering(soil, file, L, usual, fit = []) {
    const rl = soil.relayer, f = [].concat(fit).filter(Boolean);
    const s = [`${layersLine(file, L)}: ${soil.layering === "custom" ? "on the depths you chose" : ownLayers(soil) ? `${hzOf(soil)} as they are` : usual}.`];
    if (rl && rl.cut !== null) s.push(`The profile ends at ${rl.cut} cm (bedrock or a cemented layer), so deeper depths were left out.`);
    if (rl && rl.extendedBelow !== null) s.push(`Below ${rl.extendedBelow} cm ${soil.mukey ? "the survey has no horizons" : "your profile has no layers"}; the deepest one's values are repeated.`);
    return { text: [...s, ...f].join(" "), notes: f };
  }

  /* ======================= DSSAT 4.8 ======================= */
  /* DSSAT reads each value from the columns under its '@' header name: at most 5 characters, right-aligned in a
     6-character slot. fx drops decimals until the value fits, as CSM's own writer does; -99 = missing. */
  const fx = (v, w, d) => {
    if (!ok(v)) return "-99".padStart(w);
    for (let k = d; k >= 0; k--) { const s = (Math.round(v * 10 ** k) / 10 ** k + 0).toFixed(k); if (s.length <= w - 1) return s.padStart(w); }
    return String(Math.round(v)).padStart(w);
  };
  const MISS6 = "   -99";
  /* '!' comment lines of at most 119 characters (CSM reads a .WTH line into 120), broken between words; only a word
     longer than a line is cut */
  function comments(text, max = 119) {
    const L = [];
    text.split(" ").forEach(word => { const k = L.length - 1; if (k >= 0 && L[k].length + 1 + word.length <= max) L[k] += ` ${word}`; else L.push(`! ${word}`.slice(0, max)); });
    return L;
  }
  const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  /* 4-character station code from a hash of the coordinates (to 0.001°): a letter, a digit, then two letters or
     digits, 336,960 codes, so nearby places rarely share file names; the digit sets it apart from nearly all of the
     station codes that come with DSSAT (213 of its 215 have none there: UFGA, TXCH ...) */
  function dssatStation(site) {
    const h = hash32(`${site.lat.toFixed(3)},${site.lon.toFixed(3)}`), A = LETTERS + "0123456789";
    return `${LETTERS[h % 26]}${Math.floor(h / 26) % 10}${A[Math.floor(h / 260) % 36]}${A[Math.floor(h / 9360) % 36]}`;
  }
  /* soil ID, 10 characters starting WG (DSSAT looks for it in WG.SOL): WG + the 8-digit survey component key for an
     unedited survey soil on DSSAT's usual layers; any other layering, an edited surface (soil.edited, or a source
     that says so) or the user's own soil gets WG + a letter + 7 letters and digits from a hash of the written soil
     table, so a profile with other layers or values never takes the ID of an earlier one */
  const asSurveyed = soil => !!soil.cokey && !ownLayers(soil) && !(soil.edited === true || /surface edited/.test(soil.source || ""));
  function dssatSoilId(soil) {
    if (asSurveyed(soil)) return `WG${String(soil.cokey).replace(/\D/g, "").slice(-8).padStart(8, "0")}`;
    const t = dssatTable(soil).join("\n"), h = hash32(t), h2 = hash32(t, h);
    return `WG${LETTERS[h % 26]}${(Math.floor(h / 26) * 65536 + (h2 >>> 16)).toString(36).toUpperCase().padStart(7, "0").slice(-7)}`;
  }
  const DSSAT_STD = [5, 15, 30, 45, 60, 90, 120, 150, 180, 210];
  const stdInProfile = H => DSSAT_STD.filter(d => d > H[0].top && d < H[H.length - 1].bot);
  // the standard depths used: not one less than 1 cm from a horizon bottom (15 beside a table's 15.24 cm, 6 in), which would be a sliver of a layer
  const stdDepths = H => stdInProfile(H).filter(d => !H.some(l => l.bot !== d && Math.abs(l.bot - d) < 1));
  /* the horizons split at DSSAT's standard depths (CSM keeps the file's layers apart, so the root growth factor
     decreases smoothly), at most 20 layers; or the chosen layers as they are */
  function dssatLayers(soil) {
    const H = soilRows(soil);
    if (ownLayers(soil)) return H.length > 20 ? mergeLayers(H, 20) : H;
    const hb = H.map(l => l.bot);
    let B = [...new Set([...hb, ...stdDepths(H)])].sort((a, b) => a - b);
    for (let i = B.length - 1; B.length > 20 && i >= 0; i--) if (!hb.includes(B[i])) B.splice(i, 1);
    const src = B.length > 20 ? mergeLayers(H, 20) : H;
    if (B.length > 20) B = src.map(l => l.bot);
    return B.map((bot, k) => {
      const top = k ? B[k - 1] : src[0].top, mid = (top + bot) / 2, h = src.find(l => mid > l.top && mid < l.bot) || src[src.length - 1];
      return { ...h, top, bot, srgf: h.srgf === 0 ? 0 : mid <= 15 ? 1 : Math.exp(-0.02 * mid) };
    });
  }
  // SLB: whole centimetres, as DSSAT's own files, or one decimal for a bottom that is not (CSM reads it list-directed)
  const slb = v => fx(v, 6, Number.isInteger(+v.toFixed(1)) ? 0 : 1);
  function dssatSol(soil, place) {
    const L = dssatLayers(soil), id = dssatSoilId(soil), tex = texOf(L[0]) || "-99", depth = L[L.length - 1].bot;
    const survey = !!soil.mukey;
    const desc = ascii(`${soil.name}${survey ? ` SSURGO mukey ${soil.mukey}` : " (own data)"}`).slice(0, 50);
    return ["*SOILS: SoilGuard export", "",
      `*${id}  ${(survey ? "SSURGO" : "USER").padEnd(11)} ${tex.padEnd(5)} ${String(Math.round(depth)).padStart(5)} ${desc}`,
      "@SITE        COUNTRY          LAT     LONG SCS FAMILY",
      ` ${(ascii(short(place || stateOf(soil.lat, soil.lon).name, 11)) || stateOf(soil.lat, soil.lon).code).padEnd(11)} ${"USA".padEnd(11)} ${soil.lat.toFixed(3).padStart(8)} ${soil.lon.toFixed(3).padStart(8)} ${ascii(soil.family || "").slice(0, 50)}`,
      ...dssatTable(soil)].join(CRLF) + CRLF;
  }
  /* each layer's values as dssatTable writes them (missing stays null: the file has -99), also for the data sheet's
     preview. CSM: LL < DUL < SAT; the first layer stays open to roots. Sand is not written: 100 - clay - silt */
  const dssatValues = L => L.map((l, i) => {
    const ll = r3(l.ll), dul = Math.max(r3(l.dul), ll + 0.01), sat = Math.max(r3(ok(l.sat) ? l.sat : 1 - l.bd / 2.65), dul + 0.01);
    const silt = ok(l.silt) ? l.silt : ok(l.sand) && ok(l.clay) ? 100 - l.sand - l.clay : null;
    return { top: l.top, bot: l.bot, hz: l.hz, ll, dul, sat, srgf: i === 0 && l.srgf === 0 ? 1 : l.srgf, ksat: l.ksat, bd: l.bd, oc: ok(l.oc) ? l.oc : ok(l.om) ? l.om / 1.724 : null,
      clay: l.clay, silt, sand: ok(l.clay) && ok(silt) ? 100 - l.clay - silt : null, cfWt: ok(l.cfWt) ? l.cfWt : 0, ni: l.ni, ph: l.ph, cec: l.cec, caco3: l.caco3 };
  });
  // the soil table of a profile: the surface line and the layer tiers (the soil ID is made from it)
  function dssatTable(soil) {
    const L = dssatLayers(soil), V = dssatValues(L), tex = texOf(L[0]) || "-99";
    const salb = ok(soil.albedo) && soil.albedo > 0 ? soil.albedo : 0.13, sldr = ok(soil.drainRate) ? soil.drainRate : 0.4, cn = ok(soil.cn) ? soil.cn : 73;
    const out = ["@ SCOM  SALB  SLU1  SLDR  SLRO  SLNF  SLPF  SMHB  SMPX  SMKE",
      `${MISS6}${fx(salb, 6, 2)}${fx(WG.soil.slu1(tex), 6, 1)}${fx(sldr, 6, 2)}${fx(cn, 6, 0)}${fx(1, 6, 2)}${fx(1, 6, 2)}${MISS6.repeat(3)}`,
      "@  SLB  SLMH  SLLL  SDUL  SSAT  SRGF  SSKS  SBDM  SLOC  SLCL  SLSI  SLCF  SLNI  SLHW  SLHB  SCEC  SADC"];
    V.forEach(l => {
      const mh = ascii(l.hz).replace(/[\s,/+]/g, "").slice(0, 5) || "-99";
      out.push(`${slb(l.bot)}${mh.padStart(6)}${fx(l.ll, 6, 3)}${fx(l.dul, 6, 3)}${fx(l.sat, 6, 3)}${fx(l.srgf, 6, 3)}${fx(ok(l.ksat) ? l.ksat / 10 : null, 6, 3)}${fx(l.bd, 6, 2)}${fx(l.oc, 6, 2)}`
        + `${fx(l.clay, 6, 1)}${fx(l.silt, 6, 1)}${fx(l.cfWt, 6, 1)}${fx(l.ni, 6, 3)}${fx(l.ph, 6, 1)}${MISS6}${fx(l.cec, 6, 1)}${MISS6}`);
    });
    if (V.some(l => ok(l.caco3))) { // second tier: the same rows in the same order (CSM matches them by row)
      out.push("@  SLB  SLPX  SLPT  SLPO CACO3  SLAL  SLFE  SLMN  SLBS  SLPA  SLPB  SLKE  SLMG  SLNA  SLSU  SLEC  SLCA");
      V.forEach(l => out.push(`${slb(l.bot)}${MISS6.repeat(3)}${fx(ok(l.caco3) ? l.caco3 * 10 : null, 6, 1)}${MISS6.repeat(12)}`));
    }
    return out;
  }
  W.dssatSol = soil => dssatSol(soil, stateOf(soil.lat, soil.lon).name);
  /* a FileX *FIELDS line, FORMAT (I3,A8,1X,2A4,1X,F5.0,1X,F5.0,1X,A5,2(1X,F5.0),2(1X,A5),1X,F5.0,1X,A10) */
  function fieldLine(code, soil) {
    const L = soil ? dssatLayers(soil) : null;
    const tex = L ? texOf(L[0]) || "-99" : "-99", dep = L ? String(Math.round(L[L.length - 1].bot)) : "-99", id = soil ? dssatSoilId(soil) : "-99";
    return `  1WG${(soil ? stateOf(soil.lat, soil.lon) : stateOf()).code}0001 ${code.padEnd(8)} ${"-99".padStart(5)} ${"0".padStart(5)} DR000 ${"0".padStart(5)} ${"0".padStart(5)} 00000 ${tex.padEnd(5)} ${dep.padStart(5)} ${id.padEnd(10)} SoilGuard`;
  }
  W.dssat = ctx => {
    const { site } = ctx, files = [], code = ctx.wsta || dssatStation(site), info = [], notes = [];
    let wsta = code;
    if (ctx.wx) {
      const w = gapFree("dssat", ctx.wx), c = climOf(ctx, false), cut = cutText(w, ctx);
      const byYear = new Map();
      w.days.forEach((d, k) => { const y = ymdOf(d)[0]; if (!byYear.has(y)) byYear.set(y, []); byYear.get(y).push(k); });
      const years = [...byYear.keys()], yy = y => String(y % 100).padStart(2, "0"), nn = n => String(n).padStart(2, "0");
      /* 2-digit years can only be 1941-2040 (FileX reads YY <= 40 as 20YY), and yearly names repeat after 100 years: such
         dates take the 4-digit layout of DSSAT 4.8, in files of at most 99 years (a FileX date must fall within 99 years of
         the file's first date) */
      const y4 = years[0] < 1941 || years[years.length - 1] > 2040 || years.length > 99;
      const head = [`${y4 ? "$" : "*"}WEATHER DATA : ${ascii(short(site.name, 40)) || "SoilGuard"}`, "",
        ...comments(`${srcLabel(ctx.wx)} at ${site.lat.toFixed(4)}, ${site.lon.toFixed(4)}; written by SoilGuard`),
        ...comments(`WIND: 2 m daily mean wind, km/day. DEWP: dew point. TAV, AMP: ${c ? `${c.approx ? "approximate, " : ""}${c.label}` : "not enough months (DSSAT defaults)"}`),
        "@ INSI      LAT     LONG  ELEV   TAV   AMP REFHT WNDHT",
        `  ${code}${fx(site.lat, 9, 3)}${fx(site.lon, 9, 3)}${fx(site.elev ?? ctx.wx.elev, 6, 0)}${fx(c ? c.tav : null, 6, 1)}${fx(c ? c.amp : null, 6, 1)}${fx(2, 6, 1)}${fx(2, 6, 1)}`,
        `${y4 ? "@  DATE" : "@DATE"}  SRAD  TMAX  TMIN  RAIN  DEWP  WIND`];
      const u2 = w.wind2 || [], td = w.tdew || [];
      const line = k => {
        const d = w.days[k], y = ymdOf(d)[0];
        return `${y4 ? y : yy(y)}${String(doyOf(d)).padStart(3, "0")}${fx(w.srad[k], 6, 1)}${fx(w.tmax[k], 6, 1)}${fx(w.tmin[k], 6, 1)}${fx(w.prcp[k], 6, 1)}`
          + `${fx(td[k], 6, 1)}${fx(ok(u2[k]) ? u2[k] * 86.4 : null, 6, 0)}`;
      };
      const wth = (stem, ks) => files.push({ name: `${stem}.WTH`, text: [...head, ...ks.map(line)].join(CRLF) + CRLF });
      const span = ys => `${ys[0]}${ys.length > 1 ? `-${ys[ys.length - 1]}` : ""}`;
      let whatFiles;
      if (y4) {
        const parts = [];
        for (let j = 0; j < years.length; j += 99) parts.push(years.slice(j, j + 99));
        const stem = ys => `${code}${yy(ys[0])}${nn(ys.length)}`;
        parts.forEach(ys => wth(stem(ys), ys.flatMap(y => byYear.get(y))));
        wsta = stem(parts[0]);
        whatFiles = `${and(parts.map(ys => `${stem(ys)}.WTH for ${span(ys)}`))}, with 4-digit years ($WEATHER, dates YYYYDDD), because 2-digit years can only be 1941-2040${years.length > 99 ? " and one file serves at most 99 years" : ""}. Only DSSAT 4.8 reads this layout.`
          + ` Use the 8-character name as WSTA${parts.length > 1 ? ", from the file that holds the run's start date" : ""}.`;
        notes.push(`The DSSAT weather reaches outside 1941-2040 or spans over 99 years, so it is written with 4-digit years, which only DSSAT 4.8 reads, in ${parts.length > 1 ? `${parts.length} files of at most 99 years` : "one file"} instead of yearly files.`);
      } else {
        byYear.forEach((ks, y) => wth(`${code}${yy(y)}01`, ks));
        if (years.length > 1) wth(`${code}${yy(years[0])}${nn(years.length)}`, w.days.map((_, k) => k));
        whatFiles = `one file per year, ${code}YY01.WTH (DSSAT's own naming), for ${span(years)}`
          + (years.length > 1 ? `; and all years in one file, ${code}${yy(years[0])}${nn(years.length)}.WTH (use the 8-character name as WSTA).` : ".");
      }
      const gone = [td.some(ok) ? "" : "DEWP is -99 on every day (the weather has no humidity), so DSSAT estimates humidity from Tmin.",
        u2.some(ok) ? "" : "WIND is -99 on every day (the weather has no wind), so DSSAT uses 86.4 km/day (1 m/s)."].filter(Boolean);
      notes.push(...[badText(w), !c ? "TAV and AMP are -99 (too few months), so DSSAT uses its defaults of 20 and 5 degC."
        : c.approx ? `TAV and AMP in the .WTH header are approximate, from the monthly means of ${c.label}, because ${tavWhy(ctx.wx)}.` : ""].filter(Boolean), ...gone);
      info.push(`Weather station ${code}: ${whatFiles}`,
        `  ${srcLabel(ctx.wx)}. SRAD MJ/m2/day, TMAX and TMIN degC, RAIN mm, DEWP degC, WIND km/day at 2 m (REFHT and WNDHT 2 m); -99 = missing`
          + " (allowed for DEWP and WIND only: DSSAT then estimates humidity from Tmin and uses a wind of 86.4 km/day).",
        ...gone.map(s => `  ${s}`),
        ...(cut ? [`  ${cut}`] : []),
        `  TAV and AMP (header): ${c ? `${c.tav.toFixed(1)} and ${c.amp.toFixed(1)} degC, from the monthly means of ${c.label}${c.approx ? `, approximate because ${tavWhy(ctx.wx)}` : ctx.climWx && !tavAmp(ctx.wx, false) ? ` (10 years read for this, because ${tavWhy(ctx.wx)})` : ""}; AMP is the full range between the warmest and coldest month, as CSM uses it${c.tav <= 0 || c.amp <= 0 ? " (DSSAT replaces a TAV or AMP of 0 or below with 20 or 5 degC)" : ""}` : "-99, DSSAT then uses its defaults (20 and 5 degC)"}.`,
        `  ${filledText(w)}`);
    }
    const sid = ctx.soil ? dssatSoilId(ctx.soil) : null;
    if (ctx.soil) {
      const L = dssatLayers(ctx.soil), tex = texOf(L[0]) || "-99", H = soilRows(ctx.soil), merged = H.length > 20, own = ownLayers(ctx.soil);
      // standard depths left unsplit to keep within 20 layers (dssatLayers drops the deepest first), and those beside a horizon bottom
      const std = stdDepths(H), near = stdInProfile(H).filter(d => !std.includes(d)), skip = own || merged ? [] : std.filter(d => !L.some(l => l.bot === d));
      const alb = ctx.soil.albedo, hasAlb = ok(alb) && alb > 0;
      const lay = layering(ctx.soil, "WG.SOL", L, merged ? hzOf(ctx.soil) : `${hzOf(ctx.soil)} split at DSSAT's standard depths 5, 15, 30, 45, 60, 90, 120, 150, 180 and 210 cm${near.length ? ` (not at ${and(near.map(String))} cm, less than 1 cm from a bottom)` : ""}`,
        [merged ? mergedText("DSSAT", 20, H.length) : skip.length ? `DSSAT takes at most 20 layers, so the layers are not split at ${and(skip.map(String))} cm.` : "", rootNote(L, "SRGF 1"), omBlank(ctx.soil, "SLOC is -99, which DSSAT fills in itself")]);
      files.push({ name: "WG.SOL", text: dssatSol(ctx.soil, site.name) });
      notes.push(...lay.notes);
      info.push(`WG.SOL: soil ${sid}, ${ctx.soil.name} (${ctx.soil.source}). The ID is WG + ${asSurveyed(ctx.soil) ? "the survey component key" : "a code from the soil table, so other layers or values give another ID"}.`,
        `  ${lay.text}`,
        `  Surface: texture ${tex}; albedo ${!ctx.soil.mukey ? `${(hasAlb ? alb : 0.13).toFixed(2)} (the one you gave, or 0.13 if you gave none)` : hasAlb ? "= SSURGO dry albedo" : "0.13 (no survey value)"}; SLU1 ${WG.soil.slu1(tex)} mm by texture (HC27 generic soils); SLDR from the drainage class; SLRO = curve number from the hydrologic group and slope.`,
        "  Layers: SLLL, SDUL, SSAT = 15-bar, 1/3-bar and saturated water content; SSKS cm/h; SLOC = OM / 1.724; SLNI = SLOC / 10 for each horizon, at most 0.5, and for a merged or custom layer its horizons' mean by mass; SRGF = exp(-0.02 x mid-depth) below 15 cm, 0 below a restrictive layer; CACO3 g/kg.");
    }
    // the steps name only the files in this zip: without weather, FileX keeps the user's own WSTA
    const hasWx = !!ctx.wx, steps = [
      ...(hasWx ? [["Copy the .WTH files into C:\\DSSAT48\\Weather (or the experiment's folder)."]] : []),
      ...(sid ? [["Copy WG.SOL into C:\\DSSAT48\\Soil. If a WG.SOL is already there from an earlier download, open both files and paste this profile",
        `(from the line starting with '*${sid}' to the end) at the end of the old one instead of replacing the file. If the old file already has`,
        `a profile *${sid}, delete that profile first: DSSAT uses the first profile with a matching ID.`]] : []),
      ...(hasWx || sid ? [[`In the experiment file (FileX), *FIELDS section: ${[hasWx ? `WSTA = ${wsta}` : "", sid ? `ID_SOIL = ${sid}` : ""].filter(Boolean).join(", ")}${hasWx ? "" : " (keep your own weather station as WSTA: it is -99 below)"}. For example:`]] : []),
    ];
    files.push({ name: "README.txt", text: [`DSSAT 4.8 files from SoilGuard for ${site.name} (${site.lat.toFixed(5)}, ${site.lon.toFixed(5)}).`, "", ...info, "",
      ...(steps.length ? [`How to use ${hasWx ? "them" : "it"}:`, ...steps.flatMap((s, i) => s.map((l, j) => `  ${j ? "   " : `${i + 1}. `}${l}`)),
        "@L ID_FIELD WSTA....  FLSA  FLOB  FLDT  FLDD  FLDS  FLST SLTX  SLDP  ID_SOIL    FLNAME",
        fieldLine(hasWx ? wsta : "-99", ctx.soil),
        `Checked against the column rules of the DSSAT-CSM 4.8.6 Fortran reader${hasWx && sid ? "s" : ""} (${[hasWx ? "IPWTH" : "", sid ? "IPSOIL" : ""].filter(Boolean).join(", ")}); not run in DSSAT here.`] : []),
    ].join(CRLF) + CRLF });
    files.notes = notes;
    // the names a FileX takes, for the area grid's index
    files.wsta = ctx.wx ? wsta : null; files.soilId = sid;
    return files;
  };

  /* ======================= APSIM (Next Gen and 7.10) ======================= */
  function metText(ctx) {
    const w = gapFree("apsim", ctx.wx), c = climOf(ctx, true), site = ctx.site;
    const cols = [["year", "()", (k, d) => String(ymdOf(d)[0])], ["day", "()", (k, d) => String(doyOf(d))], ["radn", "(MJ/m^2)", k => r1(w.srad[k])],
      ["maxt", "(oC)", k => r1(w.tmax[k])], ["mint", "(oC)", k => r1(w.tmin[k])], ["rain", "(mm)", k => r1(w.prcp[k])]];
    if (w.vp) cols.push(["vp", "(hPa)", k => r1(w.vp[k] * 10)]);
    if (w.wind2) cols.push(["wind", "(m/s)", k => r1(w.wind2[k])]);
    cols.push(["co2", "(ppm)", (k, d) => co2Of(ymdOf(d)[0]).toFixed(1)]);
    const wd = cols.map(([h, u]) => Math.max(h.length, u.length, 5) + 1), row = vals => vals.map((v, i) => v.padStart(wd[i])).join("");
    const L = ["[weather.met.weather]", `!${srcLabel(ctx.wx)} at ${site.lat.toFixed(4)}, ${site.lon.toFixed(4)}; written by SoilGuard`,
      "!radn MJ/m2/day; vp from the source's humidity; wind = 2 m daily mean; co2 = NOAA Mauna Loa annual mean",
      `latitude = ${site.lat.toFixed(4)}  (DECIMAL DEGREES)`, `longitude = ${site.lon.toFixed(4)}  (DECIMAL DEGREES)`];
    const from = c ? `${c.approx ? "approximate, " : ""}${c.label}` : "";
    if (c) L.push(`tav = ${c.tav.toFixed(2)} (oC) ! annual average ambient temperature, ${from}`, `amp = ${c.amp.toFixed(2)} (oC) ! annual amplitude in mean monthly temperature, ${from}`);
    L.push(row(cols.map(x => x[0])), row(cols.map(x => x[1])));
    w.days.forEach((d, k) => L.push(row(cols.map(x => x[2](k, d)))));
    return { text: L.join(CRLF) + CRLF, w, c, cols: cols.map(x => x[0]) };
  }
  const APSIM_STD = [150, 150, 300, 300, 300, 300, 300, 300, 300, 300, 300]; // mm, the usual APSoil layering
  function apsimLayers(soil) {
    const H = soilRows(soil);
    if (ownLayers(soil)) return H;
    const bottom = H[H.length - 1].bot * 10, B = [];
    let z = H[0].top * 10, i = 0;
    while (z < bottom - 1e-6) { z = Math.min(z + APSIM_STD[Math.min(i++, APSIM_STD.length - 1)], bottom); B.push(z); }
    if (B.length > 1 && B[B.length - 1] - B[B.length - 2] < 50) B.splice(B.length - 2, 1); // no thin sliver at the bottom
    return M.relayerLayers(H, B.map(v => v / 10), H[0].top);
  }
  // defaults by depth (mm) as in APSoil profiles: crop KL; FBiom, FInert; fresh organic matter per mm of soil
  const BREAKS = [150, 300, 600, 900, 1200, 1500, 1800];
  const byDepth = (arr, mid) => { let i = BREAKS.findIndex(b => mid <= b); if (i < 0) i = BREAKS.length; return arr[Math.min(i, arr.length - 1)]; };
  const KL_D = [0.06, 0.06, 0.06, 0.05, 0.04, 0.03, 0.02, 0.01], FBIOM_D = [0.04, 0.02, 0.02, 0.02, 0.01, 0.01, 0.01, 0.01],
    FINERT_D = [0.4, 0.6, 0.8, 1, 1, 1, 1, 1], FOM_MM = [1, 0.8, 0.3, 0.2, 0.133, 0.083, 0.05, 0.033];
  const APSIM_CROPS = ["Maize", "Sorghum", "Wheat", "Cotton"];
  // the values apsimSoil writes for its layers L, by layer, also for the data sheet's preview
  function apsimValues(L) {
    const BD = L.map(l => Math.min(2.65, Math.max(0.1, +l.bd.toFixed(2)))), LL = [], DUL = [], SAT = [], AIR = [];
    L.forEach((l, i) => { // APSIM's checks: AirDry <= LL15 <= DUL <= SAT <= 1 - BD/2.65
      const maxSat = r3(r3(1 - BD[i] / 2.65) - 0.001);
      const s = Math.min(r3(ok(l.sat) ? l.sat : maxSat), maxSat);
      let d = r3(l.dul), w = r3(l.ll);
      if (d > s) d = r3(s - 0.005);
      if (w > d) w = r3(d - 0.01);
      SAT.push(s); DUL.push(d); LL.push(w); AIR.push(i === 0 ? r3(0.5 * w) : w);
    });
    const KS = L.map(l => +Math.max(ok(l.ksat) ? l.ksat * 24 : 1, 0.1).toFixed(1));
    const sand = L.map(l => +(ok(l.sand) ? l.sand : 100 - l.clay - (l.silt ?? 0)).toFixed(1)), clay = L.map(l => +(l.clay ?? 0).toFixed(1));
    const silt = L.map((l, i) => +(ok(l.silt) ? l.silt : 100 - sand[i] - clay[i]).toFixed(1));
    let lastC = 0.1, lastPh = 7;
    const carbon = L.map(l => { const v = ok(l.oc) ? l.oc : ok(l.om) ? l.om / 1.724 : lastC * 0.5; lastC = Math.max(v, 0.01); return +lastC.toFixed(3); });
    const ph = L.map(l => { const v = ok(l.ph) ? l.ph : lastPh; lastPh = v; return +Math.min(11, Math.max(3.5, v)).toFixed(1); });
    const cec = L.every(l => ok(l.cec)) ? L.map(l => +l.cec.toFixed(1)) : null;
    const rocks = L.some(l => ok(l.cfVol) && l.cfVol > 0) ? L.map(l => +(ok(l.cfVol) ? l.cfVol : 0).toFixed(1)) : null;
    return { BD, LL, DUL, SAT, AIR, KS, sand, clay, silt, carbon, ph, cec, rocks };
  }
  function apsimSoil(soil, site) {
    const L = apsimLayers(soil), T = L.map(l => Math.round((l.bot - l.top) * 10)), mids = L.map(l => ((l.top + l.bot) / 2) * 10);
    const { BD, LL, DUL, SAT, AIR, KS, sand, clay, silt, carbon, ph, cec, rocks } = apsimValues(L);
    const tex = texOf(L[0]), u = WG.soil.slu1(tex), north = site.lat >= 0, node = (type, name, extra) => ({ $type: `${type}, Models`, ...extra, Name: name, Children: extra.Children || [], Enabled: true, ReadOnly: false });
    const solute = (name, init, units) => node("Models.Soils.Solute", name, { Thickness: T, InitialValues: L.map(() => init), InitialValuesUnits: units, WaterTableConcentration: 0, D0: 0,
      Exco: null, FIP: null, DepthConstant: 0, MaxDepthSoluteAccessible: 0, RunoffEffectivenessAtMovingSolute: 0, MaxEffectiveRunoff: 0 });
    const crops = APSIM_CROPS.map(c => node("Models.Soils.SoilCrop", `${c}Soil`, { LL, KL: mids.map(m => byDepth(KL_D, m)), XF: L.map((l, i) => (rootsOpen(l, i) ? 1 : 0)) }));
    const name = ascii(soil.name).replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "") || "SoilGuard_soil";
    const soilNode = node("Models.Soils.Soil", name, {
      RecordNumber: 0, ASCOrder: null, ASCSubOrder: null, SoilType: ascii(`${soil.name}${tex ? ` (${(WG.soil.TEX[tex] || tex)})` : ""}`), LocalName: null,
      Site: soil.mukey ? `SSURGO mukey ${soil.mukey}, cokey ${soil.cokey}` : "own data", NearestTown: ascii(site.name) || null, Region: null, State: stateOf(site.lat, site.lon).name, Country: "USA",
      NaturalVegetation: null, ApsoilNumber: null, Latitude: +site.lat.toFixed(5), Longitude: +site.lon.toFixed(5), LocationAccuracy: null, YearOfSampling: null,
      DataSource: ascii(`${soil.source}; SoilGuard export`),
      Comments: "LL15, DUL, SAT = 15-bar, 1/3-bar and saturated water content (SAT capped at 1 - BD/2.65); KS = Ksat mm/day; Carbon = OM/1.724; pH 1:1 water (SSURGO), "
        + "entered as APSIM's 1:5 water; crop KL, XF, SWCON, FBiom, FInert, FOM and initial N are generic defaults to check.",
      Children: [
        node("Models.Soils.Physical", "Physical", { Thickness: T, ParticleSizeClay: clay, ParticleSizeSand: sand, ParticleSizeSilt: silt, Rocks: rocks, Texture: null, BD,
          AirDry: AIR, LL15: LL, DUL, SAT, KS, Children: crops }),
        node("Models.WaterModel.WaterBalance", "SoilWater", { SummerDate: north ? "1-Apr" : "1-Nov", SummerU: u, SummerCona: 3.5, WinterDate: north ? "1-Nov" : "1-Apr", WinterU: u,
          WinterCona: 2.5, DiffusConst: 40, DiffusSlope: 16, Salb: +(ok(soil.albedo) && soil.albedo > 0 ? soil.albedo : 0.13).toFixed(2), CN2Bare: ok(soil.cn) ? soil.cn : 73, CNRed: 20, CNCov: 0.8,
          DischargeWidth: "NaN", CatchmentArea: "NaN", PSIDul: -100, Thickness: T, SWCON: L.map(() => 0.3), KLAT: null, ResourceName: "WaterBalance" }),
        node("Models.Soils.Organic", "Organic", { FOMCNRatio: 40, Thickness: T, Carbon: carbon, CarbonUnits: 0, SoilCNRatio: L.map(() => 12),
          FBiom: mids.map(m => byDepth(FBIOM_D, m)), FInert: mids.map(m => byDepth(FINERT_D, m)), FOM: mids.map((m, i) => +(byDepth(FOM_MM, m) * T[i]).toFixed(1)) }),
        node("Models.Soils.Chemical", "Chemical", { Thickness: T, PH: ph, PHUnits: 0, EC: null, ESP: null, CEC: cec }),
        node("Models.Soils.Water", "Water", { Thickness: T, InitialValues: DUL.slice(), InitialPAWmm: null, RelativeTo: "LL15", FilledFromTop: false }),
        node("Models.Soils.CERESSoilTemperature", "Temperature", {}),
        node("Models.Soils.Nutrients.Nutrient", "Nutrient", { ResourceName: "Nutrient" }),
        solute("NO3", 1, 0), solute("NH4", 0.1, 0), solute("Urea", 0, 1),
      ],
    });
    const root = { $type: "Models.Core.Simulations, Models", Version: 168, Name: "Simulations",
      Children: [{ $type: "Models.Core.Folder, Models", Name: "Soils", Children: [soilNode], Enabled: true, ReadOnly: false }], Enabled: true, ReadOnly: false };
    return { text: JSON.stringify(root, null, 2) + "\n", name, L };
  }
  W.apsim = ctx => {
    const { site } = ctx, b = ctx.stem || baseName(site), files = [], info = [], notes = [];
    if (ctx.wx) {
      const m = metText(ctx), cut = cutText(m.w, ctx);
      const gone = [m.w.vp ? "" : "No vp column (the weather has no humidity), so APSIM works out vapour pressure from Tmin.",
        m.w.wind2 ? "" : "No wind column (the weather has no wind), so APSIM uses its default of 3 m/s."].filter(Boolean);
      notes.push(...[badText(m.w), !m.c ? "The .met has no tav and amp (too few months): APSIM 7.10 needs them, and APSIM Next Gen works them out only from two years of data or more."
        : m.c.approx ? `tav and amp in the .met are approximate, from the monthly means of ${m.c.label}, because ${tavWhy(ctx.wx)}.` : ""].filter(Boolean), ...gone);
      files.push({ name: `${b}.met`, text: m.text });
      info.push(`${b}.met: daily weather, ${srcLabel(ctx.wx)}. Columns: ${m.cols.join(", ")} (radn MJ/m2, maxt and mint degC, rain mm${m.cols.includes("vp") ? ", vp hPa" : ""}${m.cols.includes("wind") ? ", wind m/s at 2 m" : ""}, co2 ppm).`,
        ...(cut ? [`  ${cut}`] : []),
        ...gone.map(s => `  ${s}`),
        `  co2: NOAA Mauna Loa annual means (${CO2_OLD_Y0}-${CO2_Y0 + CO2.length - 1}; later years +2.5 ppm a year${ymdOf(m.w.days[0])[0] < CO2_OLD_Y0 ? `; earlier years have the ${CO2_OLD_Y0} value, ${CO2_OLD[0].toFixed(1)} ppm, as the record starts then` : ""}). Without it APSIM Next Gen assumes 350 ppm.`,
        `  tav and amp: ${m.c ? `${m.c.tav.toFixed(2)} and ${m.c.amp.toFixed(2)} degC, from the monthly means of ${m.c.label}${m.c.approx ? `, approximate because ${tavWhy(ctx.wx)}` : ""}` : "not written"}.`
          + " APSIM 7.10 (Classic) needs them, and APSIM Next Gen works them out itself only from two years of data or more.",
        `  ${filledText(m.w)}`);
    }
    if (ctx.soil) {
      const s = apsimSoil(ctx.soil, site), lay = layering(ctx.soil, `${b}_soil.apsimx`, s.L, `${hzOf(ctx.soil)} on APSoil's usual 150, 150, 300, 300 ... mm layers (thickness-weighted)`, [rootNote(s.L, "XF 1"), omBlank(ctx.soil, "Carbon is half that of the layer above, as APSIM needs a value")]);
      files.push({ name: `${b}_soil.apsimx`, text: s.text });
      notes.push(...lay.notes);
      info.push(`${b}_soil.apsimx: soil '${s.name}' (${ctx.soil.source}), file version 168 (APSIM Next Gen from 2023 on opens and upgrades it).`,
        `  ${lay.text}`,
        `  Crops set up: ${APSIM_CROPS.join(", ")} (LL = LL15, KL 0.06 down to 0.01 with depth, XF 1, or 0 below a restrictive layer). For another crop, copy a SoilCrop node and rename it <Crop>Soil.`,
        "  Use it: File > Open the .apsimx, then copy the soil (Soils > the soil) and paste it onto your simulation's field; or copy the whole file's text and press Ctrl+V on the field node.",
        "  Initial water is at the drained upper limit (DUL); initial NO3 1 ppm and NH4 0.1 ppm. Check these and the other defaults for your field.");
    }
    files.push({ name: "README.txt", text: [`APSIM files from SoilGuard for ${site.name} (${site.lat.toFixed(5)}, ${site.lon.toFixed(5)}).`, "", ...info, "",
      ...(ctx.wx || ctx.soil ? [`Checked against ${and([ctx.wx ? "the rules of APSIM's own reader (ApsimTextFile, Weather)" : "", ctx.soil ? `${ctx.wx ? "" : "APSIM's "}soil checks (Soil.Check)` : ""].filter(Boolean))}; not run in APSIM here.`] : [])].join(CRLF) + CRLF });
    files.notes = notes;
    return files;
  };

  /* ======================= AquaCrop 7 ======================= */
  /* soil class (Table 2.24s-3) and capillary-rise parameters a, b (Table 2.24s-5) of the AquaCrop 7.3 manual */
  function aquaClass(sat, fc, wp, ks) {
    if (sat > 55) return 4;
    if (wp >= 20) return sat >= 49 && fc >= 40 ? 4 : 3;
    if (fc < 23) return 1;
    if (wp > 16 && ks < 100) return 3;
    if (wp < 6 && fc < 28 && ks > 750) return 1;
    return 2;
  }
  const aquaCR = (c, ks) => ({ 1: [-0.3112 - ks / 1e5, -1.4936 + 0.2416 * Math.log(ks)], 2: [-0.4986 + (9 * ks) / 1e5, -2.132 + 0.4778 * Math.log(ks)],
    3: [-0.5677 - (4 * ks) / 1e5, -3.7189 + 0.5922 * Math.log(ks)], 4: [-0.6366 + (8 * ks) / 1e4, -1.9165 + 0.7063 * Math.log(ks)] })[c];
  // the horizons (at most 5) and the values aquaSol writes for each, also for the data sheet's preview
  const aquaLayers = soil => { const H = soilRows(soil); return H.length > 5 ? mergeLayers(H, 5) : H; };
  const aquaValues = L => L.map(l => {
    const wp = +(100 * l.ll).toFixed(1), fc = Math.max(+(100 * l.dul).toFixed(1), +(wp + 0.1).toFixed(1));
    const sat = Math.max(+(100 * (ok(l.sat) ? l.sat : 1 - l.bd / 2.65)).toFixed(1), fc), ks = +Math.max(ok(l.ksat) ? l.ksat * 24 : 1, 0.1).toFixed(1);
    const [a, b] = aquaCR(aquaClass(sat, fc, wp, ks), ks);
    return { l, wp, fc, sat, ks, a, b };
  });
  function aquaSol(soil) {
    const L = aquaLayers(soil), v = aquaValues(L);
    const g = String(soil.hydgrp || "").split("/").pop().trim().charAt(0).toUpperCase(), ksTop = v[0].ks;
    const cn = { A: 46, B: 61, C: 72, D: 77 }[g] ?? (ksTop > 864 ? 46 : ksTop >= 347 ? 61 : ksTop >= 36 ? 72 : 77); // Table 2.14d (5% initial abstraction)
    const rew = Math.max(0, Math.min(15, Math.round(10 * (v[0].fc - v[0].wp / 2) * 0.04)));
    const lines = [ascii(`${soil.name}, ${soil.source}`).replace(/\s+/g, " ").slice(0, 120), "        7.1                 : AquaCrop Version (August 2023)",
      `${String(cn).padStart(9)}                   : CN (Curve Number)`, `${String(rew).padStart(9)}                   : Readily evaporable water from top layer (mm)`,
      `${String(L.length).padStart(9)}                   : number of soil horizons`, "       -9                   : variable no longer applicable",
      "  Thickness  Sat   FC    WP     Ksat   Penetrability  Gravel  CRa       CRb           description",
      "  ---(m)-   ----(vol %)-----  (mm/day)      (%)        (%)    -----------------------------------------",
      ...v.map((x, i) => `${((x.l.bot - x.l.top) / 100).toFixed(2).padStart(8)} ${x.sat.toFixed(1).padStart(7)} ${x.fc.toFixed(1).padStart(5)} ${x.wp.toFixed(1).padStart(5)} ${x.ks.toFixed(1).padStart(8)} `
        + `${String(rootsOpen(x.l, i) ? 100 : 0).padStart(10)} ${"0".padStart(9)} ${x.a.toFixed(6).padStart(11)} ${x.b.toFixed(6).padStart(10)}   ${(ascii(x.l.hz).replace(/[^A-Za-z0-9+_-]/g, "") || "layer").slice(0, 24)}`)];
    return { text: lines.join(CRLF) + CRLF, L, cn, rew, g };
  }
  W.aquacrop = ctx => {
    const { site } = ctx, b = ctx.stem || baseName(site), files = [], info = [], notes = [];
    if (ctx.wx) {
      const w = gapFree("aquacrop", ctx.wx), [y, m, d] = ymdOf(w.days[0]);
      if (badText(w)) notes.push(badText(w));
      const desc = ascii(`${srcLabel(ctx.wx)} at ${site.lat.toFixed(4)}, ${site.lon.toFixed(4)} (SoilGuard)`);
      const head = title => [desc, `${String(1).padStart(6)}  : Daily records (1=daily, 2=10-daily and 3=monthly data)`, `${String(d).padStart(6)}  : First day of record (1, 11 or 21 for 10-day or 1 for months)`,
        `${String(m).padStart(6)}  : First month of record`, `${String(y).padStart(6)}  : First year of record (1901 if not linked to a specific year)`, "", title, "======================="];
      const file = (ext, title, val) => files.push({ name: `${b}.${ext}`, text: [...head(title), ...w.days.map((_, k) => val(k))].join(CRLF) + CRLF });
      file("Tnx", "  Tmin (C)   TMax (C)", k => `${r1(w.tmin[k]).padStart(8)}${r1(w.tmax[k]).padStart(10)}`);
      file("ETo", "  Average ETo (mm/day)", k => r1(Math.max(0, w.et0[k])).padStart(10));
      file("PLU", "  Total Rain (mm)", k => r1(Math.max(0, w.prcp[k])).padStart(10));
      files.push({ name: `${b}.CLI`, text: [desc, " 7.1  : AquaCrop Version (August 2023)", `${b}.Tnx`, `${b}.ETo`, `${b}.PLU`, "MaunaLoa.CO2"].join(CRLF) + CRLF });
      files.push({ name: `${b}_aquacrop_ospy.txt`, text: ["Day\tMonth\tYear\tTmin(C)\tTmax(C)\tPrcp(mm)\tEt0(mm)",
        ...w.days.map((dd, k) => { const [yy, mm, da] = ymdOf(dd); return [da, mm, yy, r1(w.tmin[k]), r1(w.tmax[k]), r1(Math.max(0, w.prcp[k])), r1(Math.max(0.1, w.et0[k]))].join("\t"); })].join("\n") + "\n" });
      const cut = cutText(w, ctx);
      info.push(`${b}.CLI names the climate files: ${b}.Tnx (Tmin, Tmax degC), ${b}.ETo (grass reference ET0, mm/day) and ${b}.PLU (rain, mm), one line per day from ${Wd.isoDay(w.days[0])},`,
        "  and MaunaLoa.CO2, which comes with AquaCrop (in its SIMUL folder).",
        ...(cut ? [`  ${cut}`] : []),
        `  ET0: ${et0Text(ctx.wx)}. ${filledText(w)}`,
        `${b}_aquacrop_ospy.txt: the same days for AquaCrop-OSPy (Python; prepare_weather reads Day Month Year Tmin Tmax Prcp Et0).`);
    }
    if (ctx.soil) {
      const s = aquaSol(ctx.soil), H = soilRows(ctx.soil), lay = layering(ctx.soil, `${b}.SOL`, s.L, hzOf(ctx.soil), [H.length > 5 ? mergedText("AquaCrop", 5, H.length) : "", rootNote(s.L, "penetrability 100%")]);
      files.push({ name: `${b}.SOL`, text: s.text });
      notes.push(...lay.notes);
      info.push(`${b}.SOL: soil ${ctx.soil.name} (${ctx.soil.source}).`, `  ${lay.text}`,
        `  SAT, FC, WP in vol % (saturated, 1/3-bar and 15-bar water); Ksat mm/day; CN ${s.cn} from ${s.g ? `hydrologic group ${s.g}` : "the top layer's Ksat"} (AquaCrop's own table, 5% initial abstraction); REW ${s.rew} mm;`,
        "  CRa and CRb from AquaCrop's soil classes; gravel 0 because the survey's water contents are for the whole soil; penetrability 100%, or 0 below a restrictive layer.");
    }
    const use = and([ctx.wx ? "the .CLI as the climate file" : "", ctx.soil ? "the .SOL as the soil file" : ""].filter(Boolean)), readers = [ctx.wx ? "LoadClim" : "", ctx.soil ? "LoadProfile" : ""].filter(Boolean);
    files.push({ name: "README.txt", text: [`AquaCrop 7 files from SoilGuard for ${site.name} (${site.lat.toFixed(5)}, ${site.lon.toFixed(5)}).`, "", ...info, "",
      ...(use ? [`Use ${ctx.wx ? "them: copy the files" : "it: copy the file"} into AquaCrop's DATA folder, then choose ${use}.`,
        `File names have no spaces, as AquaCrop needs. Checked against ${ctx.soil ? "the AquaCrop 7.3 manual tables and its" : "AquaCrop 7.3's"} Fortran reader${readers.length > 1 ? "s" : ""} (${readers.join(", ")}); not run in AquaCrop here.`] : [])].join(CRLF) + CRLF });
    files.notes = notes;
    return files;
  };

  /* ======================= plain CSV ======================= */
  W.csv = ctx => {
    const X = WG.export, { site } = ctx, files = [], info = [], notes = [], r = (v, d) => (ok(v) ? +v.toFixed(d) : null);
    if (ctx.wx) {
      const w = clean(ctx.wx); // values no station reports are blank, as in the model files
      files.push({ name: "daily_weather.csv", text: X.csv(["date", "year", "doy", "prcp_mm", "tmax_C", "tmin_C", "srad_MJ_m2_d", "rh_mean_pct", "rh_max_pct", "rh_min_pct", "tdew_C", "vp_kPa", "wind10_m_s", "wind2_m_s", "et0_grass_mm"],
        w.days.map((d, k) => [Wd.isoDay(d), ymdOf(d)[0], doyOf(d), r(w.prcp[k], 2), r(w.tmax[k], 2), r(w.tmin[k], 2), r(w.srad[k], 2), r(w.rh[k], 1), r(w.rhmax[k], 1), r(w.rhmin[k], 1), r(w.tdew[k], 2), r(w.vp[k], 3), r(w.wind10[k], 2), r(w.wind2[k], 2), r(w.et0[k], 2)])) });
      info.push(`daily_weather.csv: one row per day from ${isoSpan(w)} (${w.days.length} days), ${srcLabel(ctx.wx)}; a blank cell is a missing value.`,
        "  Columns: date (YYYY-MM-DD), year, doy (day of year), prcp_mm (precipitation), tmax_C and tmin_C, srad_MJ_m2_d (solar radiation, MJ/m2/day), rh_mean_pct, rh_max_pct and rh_min_pct",
        "  (relative humidity, %), tdew_C (dew point), vp_kPa (vapour pressure), wind10_m_s and wind2_m_s (daily mean wind at 10 and 2 m), et0_grass_mm (grass reference ET0, mm/day).",
        `  ET0: ${w.et0 && w.et0.some(ok) ? et0Text(ctx.wx) : "blank on every day (the weather has none and too little to work it out)"}.`);
      if (badText(w)) { info.push(`  ${badText(w)}`); notes.push(badText(w)); }
    }
    if (ctx.soil) {
      const s = ctx.soil, L = s.layers.filter(l => ok(l.top) && ok(l.bot));
      files.push({ name: "soil_layers.csv", text: X.csv(["top_cm", "bottom_cm", "horizon", "sand_pct", "silt_pct", "clay_pct", "om_pct", "oc_pct", "bulk_density_g_cm3", "wilting_point_cm3_cm3", "field_capacity_cm3_cm3", "saturation_cm3_cm3",
        "awc_cm_cm", "ksat_mm_h", "ph_water", "cec_cmol_kg", "caco3_pct", "coarse_frag_vol_pct", "coarse_frag_wt_pct", "ec_dS_m", "usle_kw", "root_growth_factor", "total_n_pct"],
        s.layers.map(l => [l.top, l.bot, l.hz, l.sand, l.silt, l.clay, r(l.om, 2), r(l.oc, 2), r(l.bd, 2), r(l.ll, 3), r(l.dul, 3), r(l.sat, 3), r(l.awc, 3), r(l.ksat, 2), l.ph, l.cec, l.caco3, r(l.cfVol, 1), r(l.cfWt, 1), l.ec, l.kw, r(l.srgf, 3), r(l.ni, 3)])) });
      files.push({ name: "soil_site.csv", text: X.csv(["name", "source", "lat", "lon", "elevation_m", "slope_pct", "hydrologic_group", "drainage_class", "dry_albedo", "stage1_evap_limit_mm", "drainage_rate_per_day", "runoff_curve_number", "texture", "family"],
        [[s.name, s.source, s.lat, s.lon, s.elev, s.slope, s.hydgrp, s.drainage, s.albedo, s.u, s.drainRate, s.cn, s.texture, s.family]]) });
      info.push(L.length ? `${layersLine("soil_layers.csv", L)}: ${s.layering === "custom" ? "on the depths you chose" : s.mukey ? "the survey's horizons as they are, also any below bedrock" : "your layers as you entered them"}.`
        : "soil_layers.csv: no layer has both depths.", `  Soil ${s.name}, ${s.source}. Units are in the column names; a blank cell is a missing value.`,
        "soil_site.csv: the profile's site values (slope, hydrologic group, drainage class, dry albedo, stage-1 evaporation limit, drainage rate, curve number, texture, family).");
    }
    files.push({ name: "README.txt", text: [`Plain CSV files from SoilGuard for ${site.name} (${site.lat.toFixed(5)}, ${site.lon.toFixed(5)}), for any model.`, "", ...info].join(CRLF) + CRLF });
    files.notes = notes;
    return files;
  };

  WG.writerUtil = { badText, fit, fx, baseName, shortName, ymdOf, doyOf, short, ra, wp1Stats, swatWgn, windMonthly, mergeLayers, ok, CRLF, clean, complete, tavAmp, statGaps,
    co2Of, CO2, soilRows, writtenLayers, gapFree, filledVar, dssatStation, dssatSoilId, dssatLayers, apsimLayers, aquaClass, aquaCR, fieldLine, williamsK };
})();
