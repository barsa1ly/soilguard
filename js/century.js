/* CENTURY 4.0 and 4.5 (Colorado State University): monthly weather NAME.wth and site file NAME.100, the only files
   that hold weather and soil; the schedule and event files are the user's. Formats follow the model's Fortran READ
   statements (wthini.f, weathr.f, sitein.f, ckdata.f), which win over the manual where they differ; NREL's FILE100
   (f_wthr.c) gives the statistics, and its Parameterization Workbook the soil rules. See docs/METHODS.md. */
(function () {
  const M = WG.models, W = M.writers, Wd = WG.wind, U = WG.writerUtil, { ok, CRLF } = U;
  const MISSING = -99.99;
  // layer thicknesses (cm) in all 9 of NREL's fix.100 files: ADEP(9) and ADEP(10) are 0, and the water routine divides by ADEP
  const ADEP = [15, 15, 15, 15, 30, 30, 30, 30], ROOT_CM = 60, MIN_DAYS = 20, WANT_YEARS = 10;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const and = a => (a.length > 1 ? `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}` : a.join(""));

  const num = (v, d) => { const t = v.toFixed(d); return /^-0\.0*$/.test(t) ? t.slice(1) : t; };

  /* ---------- months from days ---------- */
  /* per year (Jan to Dec): rain in cm and the means of Tmin and Tmax, null for a month with fewer than 20 valid days;
     rain is scaled up to the whole month, and both temperatures come from the days that have both. A Tmax below
     Tmin is swapped, as in the other writers, because CENTURY 4.5 stops on a Tmin above Tmax. */
  function monthlyOf(wx) {
    const w = U.clean(wx), tally = new Map(), row = () => Array.from({ length: 12 }, () => ({ rain: 0, nr: 0, lo: 0, hi: 0, nt: 0 }));
    let swapped = 0;
    if (!w || !w.days || !w.days.length) return null;
    w.days.forEach((d, i) => {
      const [y, m] = U.ymdOf(d), c = (tally.has(y) ? tally : tally.set(y, row())).get(y)[m - 1];
      if (w.prcp && ok(w.prcp[i])) { c.rain += w.prcp[i]; c.nr++; }
      const tn = w.tmin && w.tmin[i], tx = w.tmax && w.tmax[i];
      if (ok(tn) && ok(tx)) { if (tx < tn) swapped++; c.lo += Math.min(tn, tx); c.hi += Math.max(tn, tx); c.nt++; }
    });
    const years = [...tally.keys()], y0 = Math.min(...years), y1 = Math.max(...years), out = [];
    for (let y = y0; y <= y1; y++) {
      const cells = tally.get(y) || row();
      out.push({ y, prec: cells.map((c, m) => (c.nr >= MIN_DAYS ? (c.rain / 10) * (new Date(Date.UTC(y, m + 1, 0)).getUTCDate() / c.nr) : null)),
        tmin: cells.map(c => (c.nt >= MIN_DAYS ? c.lo / c.nt : null)), tmax: cells.map(c => (c.nt >= MIN_DAYS ? c.hi / c.nt : null)) });
    }
    return { years: out, swapped, bad: w.bad };
  }

  /* ---------- the weather file ---------- */
  // format(a4,6x,12f7.0): 94 characters. The year is never read, so a year left out would shift all later ones.
  function wthLine(label, year, vals) {
    const cells = vals.map(v => {
      const t = num(ok(v) ? v : MISSING, 2);
      if (t.length > 7) throw new Error(`CENTURY: ${label} ${year} holds ${t}, too large for the file's 7 columns.`);
      return t.padStart(7);
    }).join("");
    return `${label}  ${String(year).padStart(4)}${cells}`;
  }
  function wthText(mon) {
    const lines = mon.years.flatMap(({ y, prec, tmin, tmax }) => [wthLine("prec", y, prec), wthLine("tmin", y, tmin), wthLine("tmax", y, tmax)]);
    lines.forEach((l, i) => {
      if (l.length !== 94 || l.slice(0, 4) !== ["prec", "tmin", "tmax"][i % 3]) throw new Error(`CENTURY: weather line ${i + 1} would not read as ${["prec", "tmin", "tmax"][i % 3]}.`);
    });
    return lines.join(CRLF) + CRLF; // one line end and no more: a blank line stops the run in the file's last year
  }

  /* ---------- climate statistics, as FILE100 works them out: population variance, and skew from it ---------- */
  function moments(a) {
    const n = a.length;
    if (!n) return null;
    const mean = a.reduce((s, x) => s + x, 0) / n, s2 = a.reduce((s, x) => s + x * x, 0) / n, s3 = a.reduce((s, x) => s + x ** 3, 0) / n;
    const v = Math.max(0, s2 - mean * mean), p = v ** 1.5;
    return { mean, sd: Math.sqrt(v), skew: p > 1e-12 ? (s3 - 3 * mean * v - mean ** 3) / p : 0 };
  }
  function climateOf(mon) {
    const of = k => MONTHS.map((_, m) => mon.years.map(r => r[k][m]).filter(ok));
    const prec = of("prec"), tmin = of("tmin"), tmax = of("tmax");
    const fewest = Math.min(...prec.map(a => a.length), ...tmin.map(a => a.length));
    if (!fewest) return { fewest };
    const P = prec.map(moments);
    return { fewest, PRECIP: P.map(x => x.mean), PRCSTD: P.map(x => x.sd), PRCSKW: P.map(x => x.skew), TMN2M: tmin.map(a => moments(a).mean), TMX2M: tmax.map(a => moments(a).mean),
      first: mon.years[0].y, last: mon.years[mon.years.length - 1].y };
  }
  /* the chosen dates when each month has 10 years (the manual's minimum), else the 10 years read for the climate, else
     whatever has a value for every month, with a note */
  function pickClimate(ctx, mon) {
    const here = mon ? climateOf(mon) : null, climMon = ctx.climWx ? monthlyOf(ctx.climWx) : null, clim = climMon ? climateOf(climMon) : null;
    if (here && here.fewest >= WANT_YEARS) return { c: here, from: "the chosen dates", wx: ctx.wx };
    if (clim && clim.fewest >= WANT_YEARS) return { c: clim, from: "the 10 years read for the climate", wx: ctx.climWx };
    const best = [[here, "the chosen dates", ctx.wx], [clim, "the 10 years read for the climate", ctx.climWx]].filter(x => x[0] && x[0].fewest > 0).sort((a, b) => b[0].fewest - a[0].fewest)[0];
    return best ? { c: best[0], from: best[1], wx: best[2], thin: true } : null;
  }
  const srcName = w => ({ gridmet: "gridMET", power: "NASA POWER", prism: "PRISM", file: "your weather file" })[w && w.source] || (w && w.source) || "the weather";
  /* what a download needs read for these lines: true when the chosen dates give fewer than 10 years in some month */
  const needsClimate = wx => { const m = wx ? monthlyOf(wx) : null, c = m && climateOf(m); return !c || c.fewest < WANT_YEARS; };

  /* ---------- soil onto CENTURY's layers ---------- */
  const wmean = (H, top, bot, key) => {
    let w = 0, s = 0;
    for (const h of H) {
      const o = Math.min(bot, h.bot) - Math.max(top, h.top);
      if (o > 0 && ok(h[key])) { w += o; s += o * h[key]; }
    }
    return w ? s / w : null;
  };
  // the nearest layer boundary to depth D; a tie goes deeper, as in the Workbook's table (75 cm: 5 layers)
  const nearestLayers = D => {
    let best = 1, gap = Infinity, t = 0;
    ADEP.forEach((a, i) => { t += a; if (Math.abs(t - D) <= gap) { gap = Math.abs(t - D); best = i + 1; } });
    return best;
  };
  const drainOf = s => {
    const d = String(s || "").toLowerCase();
    if (!d) return null;
    if (/very poorly|subaqueous/.test(d)) return 0.25;
    if (/somewhat poorly/.test(d)) return 0.75;
    if (/poorly/.test(d)) return 0.5;
    return 1;
  };
  // an O horizon, or a custom layer merged from O horizons only: "Oi+Oe" is organic, "Oe+Ap" is not
  const isO = l => String(l.hz || "").split("+").every(p => /^O/.test(p.trim()));
  const cm = v => +v.toFixed(1), hzOf = R => [...new Set(R.map(l => l.hz).filter(Boolean))].join(", ");
  /* the horizons the site file takes and the depth z0 its soil starts at. Surface O horizons without sand and clay are
     left out, and a profile that starts below the surface starts where it does: the depths are measured from there,
     as the user's soil promises ("the model files start there"), so its top 20 cm is 20 cm of soil, not part of it.
     O horizons with data at its top are an organic layer over the mineral soil (SOM and texture are for its top 20 cm),
     unless they reach past 20 cm from the surface or are all there is: then the top 20 cm from z0, as the Workbook says
     for organic soils. A custom layer merged from O and mineral horizons is mineral soil, but one that starts with an O
     horizon ("Oa+Cg") under 20 cm of O carries the O past 20 cm. A depth gap between horizons takes the nearer
     horizon's values, both being extended to its middle. */
  function profileOf(soil) {
    const R = U.soilRows(soil).slice();
    while (R.length && isO(R[0]) && !(ok(R[0].sand) && ok(R[0].clay))) R.shift();
    if (!R.length) throw new Error("CENTURY: the soil has no horizons with sand and clay below its O horizons.");
    const H = R.map(h => ({ ...h })), gaps = [], top0 = R[0].top, bottom = R[R.length - 1].bot;
    for (let i = 1; i < H.length; i++) {
      const a = H[i - 1], b = H[i];
      if (b.top > a.bot) { const mid = (a.bot + b.top) / 2; gaps.push({ top: a.bot, bot: b.top, mid, above: a.hz, below: b.hz }); a.bot = mid; b.top = mid; }
    }
    // the surface the O is measured from: the top of O horizons left out for want of data, else the profile's top
    const above = soil.layers.filter(l => ok(l.top) && ok(l.bot) && l.bot > l.top && l.top < top0);
    const surface = above.length && above.every(isO) ? Math.min(top0, ...above.map(l => l.top)) : top0;
    const iMin = R.findIndex(l => !isO(l)), oBot = iMin < 0 ? bottom : iMin ? R[iMin - 1].bot : top0;
    const into = iMin > 0 && /^O/.test(String(R[iMin].hz || "").split("+")[0].trim()) ? R[iMin] : null;
    const organic = iMin < 0 || (iMin > 0 && (oBot - surface > 20 || (!!into && oBot - surface >= 20 - 1e-6)));
    const z0 = organic || !iMin ? top0 : R[iMin].top;
    return { R, H, z0, top0, surface, bottom, organic, oBot, into, oRows: iMin < 0 ? R : R.slice(0, iMin), above, gaps: gaps.filter(g => g.bot > z0) };
  }
  /* everything the site file takes from the soil */
  function soilInfo(soil) {
    const P = profileOf(soil), { R, H, z0, bottom } = P, z1 = z0 + 20, zb = Math.min(z1, bottom), top = k => wmean(H, z0, z1, k);
    const sand = top("sand"), clay = top("clay");
    if (!ok(sand) || !ok(clay)) throw new Error(`CENTURY: the soil has no sand and clay from ${cm(z0)} to ${cm(zb)} cm, the depths the site file's texture comes from.`);
    const silt = ok(top("silt")) ? top("silt") : 100 - sand - clay;
    // soil thickness, by the Workbook: the depth to a restriction, or else the greater of rooting depth and the base of the Bt.
    // A restriction above z0 lies in what was left out (Urban land's manufactured layer at 0 cm, over fill): it sets nothing.
    // One at z0 (Badland's densic bedrock from 0 cm) leaves no depth, and NLAYER is 1, the fewest
    const rTop = Math.min(...soil.layers.filter(l => l.srgf === 0 && ok(l.top)).map(l => l.top)), skipRes = rTop < z0 - 1e-6;
    const stop = !skipRes && R.find(l => l.srgf === 0 && l.bot > z0), bt = R.filter(l => /Bt/.test(String(l.hz || ""))).map(l => l.bot - z0);
    const D = Math.min(bottom - z0, stop ? Math.max(stop.top - z0, 1) : Math.max(ROOT_CM, ...bt));
    const res = skipRes ? { depth: rTop, hz: hzOf(P.above.filter(l => l.top === rTop)) } : null, resTop = !!stop && stop.top <= z0 + 1e-6;
    const nlayer = nearestLayers(D), layers = [];
    for (let k = 0, t = z0; k < nlayer; t += ADEP[k], k++) {
      const a = wmean(H, t, t + ADEP[k], "ll"), f = wmean(H, t, t + ADEP[k], "dul");
      layers.push({ top: t - z0, bot: t - z0 + ADEP[k], ll: a, dul: Math.max(f, a + 0.01) }); // the water routine divides by AFIEL - AWILT
    }
    // soil C, g C/m2 in the top 20 cm (all of it, in a shallower soil), from each horizon's organic matter; incomplete if any part lacks it
    let b = 0, seen = 0;
    H.forEach(h => {
      const o = Math.min(z1, h.bot) - Math.max(z0, h.top), c = ok(h.om) ? h.om / 1.724 : h.oc;
      if (o > 0 && ok(c)) { b += c * h.bd * o * 100; seen += o; }
    });
    const first = H.find(h => h.bot > z0), mixed = first && /\+/.test(String(first.hz || "")) && String(first.hz).split("+").some(p => /^O/.test(p.trim())) ? first : null;
    // an organic soil whose O horizons with data end above z0 + 20 (O left out above them): the rest of the 20 cm is the soil below
    const oCm = P.organic ? Math.min(P.oBot, zb) - z0 : 0, below = P.organic && oCm < zb - z0 - 1e-6 ? H.filter(h => Math.min(zb, h.bot) - Math.max(P.oBot, h.top) > 1e-6) : [];
    return { ...P, z0, zb, mixed, oCm, below, res, resTop, sand: sand / 100, silt: silt / 100, clay: clay / 100, bd: top("bd"), ph: top("ph"), rock: Math.min(0.9, (top("cfVol") || 0) / 100), D, nlayer, nlaypg: Math.min(nearestLayers(ROOT_CM), nlayer), layers,
      drain: drainOf(soil.drainage), b: seen >= zb - z0 - 1e-6 && b > 0 ? b : null };
  }
  /* what the README and the notes say about the depths soilInfo took */
  function depthText(s) {
    const span = `${cm(s.z0)}-${cm(s.zb)} cm`, short = s.zb < s.z0 + 20 - 1e-6, part = s.below.length > 0, kind = s.organic && !part ? " of organic material" : "";
    const notes = [], thick = short ? `${cm(s.zb - s.z0)} cm` : "20 cm";
    if (s.top0) {
      const n = s.above.length, names = hzOf(s.above);
      notes.push(!n ? `The soil's layers start at ${cm(s.top0)} cm, so the site file takes that as the soil's surface and measures its depths from there.`
        : s.above.every(isO) ? `The O horizon${n > 1 ? "s" : ""} above ${cm(s.top0)} cm${names ? ` (${names})` : ""} ${n > 1 ? "have" : "has"} no sand and clay, so ${n > 1 ? "they are" : "it is"} left out: the site file starts below, and its depths are measured from ${cm(s.top0)} cm.`
          : `The layers above ${cm(s.top0)} cm lack water retention, bulk density, sand or clay, so the site file takes ${cm(s.top0)} cm as the soil's surface and measures its depths from there.`);
    }
    if (s.organic) {
      const counted = s.surface < s.top0 ? `, counting the ${cm(s.top0 - s.surface)} cm left out above` : "", oHz = hzOf(s.oRows) || "O";
      const reach = s.oRows.length === s.R.length ? "The soil has only O horizons"
        : s.into ? `The soil's O horizons reach past ${cm(s.oBot)} cm${counted}, into the layer ${cm(s.into.top)}-${cm(s.into.bot)} cm (${s.into.hz}), which mixes them with mineral soil`
          : `The soil's O horizons reach ${cm(s.oBot)} cm${counted}`;
      notes.push(part ? `${reach}, so it is an organic soil: SAND, SILT, CLAY, BULKD, PH and the soil C are those of its top ${thick} (${span}) as the Workbook says for organic soils, ${cm(s.oCm)} cm of organic material (${oHz}) and ${cm(s.zb - s.z0 - s.oCm)} cm of the soil below it${hzOf(s.below) ? ` (${hzOf(s.below)})` : ""}.`
        : `${reach}, so SAND, SILT, CLAY, BULKD, PH and the soil C are those of its top ${thick} of organic material (${oHz}), as the Workbook says for organic soils: they are not values for mineral soil.`);
    } else if (s.oRows.length) notes.push(`${s.top0 ? `Below ${cm(s.top0)} cm, the` : "The"} soil's top ${cm(s.oBot - s.top0)} cm is an organic layer (${hzOf(s.oRows) || "O"}), so depths in the site file are measured from the mineral soil below it, at ${cm(s.z0)} cm.`);
    if (s.mixed) notes.push(`The layer ${cm(s.mixed.top)}-${cm(s.mixed.bot)} cm (${s.mixed.hz}) mixes O horizons with mineral soil, so it counts as mineral soil: its organic part is in the means and the soil C.`);
    if (short) notes.push(`The soil ends at ${cm(s.bottom)} cm, so the means and the soil C are over ${span}, not 20 cm.`);
    s.gaps.forEach(g => notes.push(`No horizon covers ${cm(g.top)} to ${cm(g.bot)} cm, so each depth there takes the values of the nearer horizon: ${g.above || "the one above"} down to ${cm(g.mid)} cm, ${g.below || "the one below"} below.`));
    if (s.res) notes.push(`The survey's restriction at ${cm(s.res.depth)} cm${s.res.hz ? ` (the top of ${s.res.hz}, left out)` : ""} is above ${cm(s.z0)} cm, where the site file's soil starts, so it does not set the soil thickness: that is the greater of the ${ROOT_CM} cm rooting depth and the base of any Bt horizon, within the soil there is.`);
    return {
      notes, kind,
      // the means' depths, for the README
      means: s.organic ? `the soil's top ${short ? `${cm(s.zb - s.z0)} cm, all it has` : "20 cm"}${part ? `, ${cm(s.oCm)} cm of it organic material` : ", which is organic material"}` : short ? `all ${cm(s.zb - s.z0)} cm of mineral soil there is` : "the top 20 cm of mineral soil",
      // where the soil C and the other one-value lines come from, as "the top 20 cm"
      top: short ? `the soil's ${cm(s.zb - s.z0)} cm${kind} (${span})` : `the top 20 cm${kind}${s.z0 ? ` (${span})` : ""}`,
      // the Workbook's split is for mineral soil
      split: s.organic ? `, used here for ${part ? "an organic soil" : "organic material"}` : "",
    };
  }

  /* ---------- the site file ---------- */
  const siteLine = (v, label) => `${num(v, 5).padEnd(10)}        '${label}'`;
  /* the soil C in the Workbook's split, or else the Burke equation's total (NREL's own start for grassland), with a floor:
     4.0 has none and goes negative on dry warm sites, so a total under 500 g/m2 is written as 500 */
  function startOf(info, c) {
    if (info.b !== null) return { ivauto: 0, b: info.b, split: [0.03, 0.44, 0.53], how: "survey" };
    const T = Math.min(23, c.TMN2M.reduce((s, x, m) => s + (x + c.TMX2M[m]) / 2, 0) / 12), P = Math.min(120, c.PRECIP.reduce((s, x) => s + x, 0));
    const tcg = 1000 * (-0.827 * T + 0.0224 * T * T + 0.127 * P - 0.000938 * P * P + 0.0899 * P * info.silt + 0.06 * P * info.clay + 4.09);
    return tcg < 500 ? { ivauto: 0, b: 500, split: [0.03, 0.44, 0.53], how: "floor", tcg } : { ivauto: 1, b: tcg, split: [0.02, 0.64, 0.34], how: "burke", tcg };
  }
  /* version "4.0", "4.5" or "DC" (DayCent of December 2016, js/daycent.js): DayCent's reader takes 4.5's lines with a
     surface and a soil slow pool, SOM2CI(1,*) and SOM2CI(2,*), and their RCES2 ratios, 245 lines in all (sitein.f) */
  function siteText(soil, site, info, c, version) {
    const dc = version === "DC", v45 = version === "4.5" || dc, start = startOf(info, c), [a1, a2, a3] = start.split.map(x => x * start.b), L = [];
    const line = (v, label) => { if (!ok(v)) throw new Error(`CENTURY: no value for ${label}.`); L.push(siteLine(v, label)); };
    const twelve = (name, arr) => arr.forEach((v, m) => line(v, `${name}(${m + 1})`));
    const list = (name, arr, one = true) => arr.forEach((v, i) => line(v, one ? `${name}(${i + 1})` : name));
    const zeros = (name, n) => list(name, new Array(n).fill(0));
    const clean = s => String(s || "").normalize("NFKD").replace(/[^\w]+/g, "_").replace(/^_|_$/g, "");
    const st = (WG.region && ((Number.isFinite(site.lat) && WG.region.stateAt(site.lat, site.lon)) || WG.region.site())) || { code: "TX" };
    L.push(`WG${st.code}  ${clean(`${site.name} ${soil.name}`).slice(0, 60) || "SoilGuard_site"}`);
    L.push("*** Climate parameters");
    ["PRECIP", "PRCSTD", "PRCSKW", "TMN2M", "TMX2M"].forEach(k => twelve(k, c[k]));
    L.push("*** Site and control parameters");
    line(start.ivauto, "IVAUTO"); line(1, "NELEM"); line(site.lat, "SITLAT"); line(site.lon, "SITLNG");
    line(info.sand, "SAND"); line(info.silt, "SILT"); line(info.clay, "CLAY");
    if (v45) line(info.rock, "ROCK");
    line(info.bd, "BULKD"); line(info.nlayer, "NLAYER"); line(info.nlaypg, "NLAYPG"); line(info.drain === null ? 1 : info.drain, "DRAIN");
    line(dc ? 0.3 : 0, "BASEF"); line(0, "STORMF"); // DayCent: BASEF of NREL's Wooster run; STORMF 0, as NREL's DayCent instructions ask
    if (v45) { line(8, "PRECRO"); line(0.15, "FRACRO"); }
    line(0, "SWFLAG"); // the only setting that carries the horizons' values: the others apply one texture to every layer
    const deepest = info.layers[info.layers.length - 1], at = (k, i) => (info.layers[i] || deepest)[k]; // past NLAYER: unused, and repeated so that raising NLAYER cannot divide by zero
    for (let i = 0; i < 10; i++) line(at("ll", i), `AWILT(${i + 1})`);
    for (let i = 0; i < 10; i++) line(at("dul", i), `AFIEL(${i + 1})`);
    line(ok(info.ph) ? info.ph : 6.3, "PH"); line(1, "PSLSRB"); line(2, "SORPMX");
    L.push("*** External nutrient input parameters");
    line(0.05, "EPNFA(1)"); line(0.007, "EPNFA(2)");
    line(v45 ? 30 : -0.9, "EPNFS(1)"); line(v45 ? 0.01 : 0.015, "EPNFS(2)"); // 4.5 ties fixation to annual ET: other meaning, other values
    line(0, "SATMOS(1)"); line(0, "SATMOS(2)"); line(0, "SIRRI");
    L.push("*** Organic matter initial values");
    line(10, "SOM1CI(1,1)"); line(0, "SOM1CI(1,2)"); line(a1, "SOM1CI(2,1)"); line(0, "SOM1CI(2,2)");
    // DayCent's surface slow pool starts empty, as its own Burke start leaves it (calciv.f)
    if (dc) { line(0, "SOM2CI(1,1)"); line(0, "SOM2CI(1,2)"); line(a2, "SOM2CI(2,1)"); line(0, "SOM2CI(2,2)"); }
    else { line(a2, "SOM2CI(1)"); line(0, "SOM2CI(2)"); }
    line(a3, "SOM3CI(1)"); line(0, "SOM3CI(2)");
    line(16, "RCES1(1,1)"); line(50, "RCES1(1,2)"); line(50, "RCES1(1,3)"); line(12, "RCES1(2,1)"); line(50, "RCES1(2,2)"); line(50, "RCES1(2,3)");
    if (dc) [1, 2].forEach(p => [17, 117, 117].forEach((v, e) => line(v, `RCES2(${p},${e + 1})`)));
    else list("RCES2", [17, 117, 117]);
    list("RCES3", [8, 62, 62]);
    line(100, "CLITTR(1,1)"); line(0, "CLITTR(1,2)"); line(100, "CLITTR(2,1)"); line(0, "CLITTR(2,2)"); // the model divides by these
    line(66, "RCELIT(1,1)"); line(300, "RCELIT(1,2)"); line(300, "RCELIT(1,3)"); line(66, "RCELIT(2,1)"); line(300, "RCELIT(2,2)"); line(300, "RCELIT(2,3)");
    zeros("AGLCIS", 2); zeros("AGLIVE", 3); list("BGLCIS", [150, 0]); list("BGLIVE", [3, 0.4, 0.4]); list("STDCIS", [50, 0]); list("STDEDE", [0.8, 0.2, 0.2]);
    L.push("*** Forest organic matter initial parameters");
    [["RLVCIS", 2], ["RLEAVE", 3], ["FBRCIS", 2], ["FBRCHE", 3], ["RLWCIS", 2], ["RLWODE", 3], ["FRTCIS", 2], ["FROOTE", 3], ["CRTCIS", 2], ["CROOTE", 3], ["WD1CIS", 2], ["WD2CIS", 2], ["WD3CIS", 2]].forEach(([k, n]) => zeros(k, n));
    if (!v45) { line(0.3, "W1LIG"); line(0.3, "W2LIG"); line(0.3, "W3LIG"); }
    L.push("*** Mineral initial parameters");
    for (let e = 1; e <= 3; e++) for (let k = 1; k <= 10; k++) line(k <= 2 && k <= info.nlayer ? 1 : 0, `MINERL(${k},${e})`);
    list("PARENT", [0, 50, 50]); list("SECNDY", [0, 15, 2]); line(0, "OCCLUD");
    L.push("*** Water initial parameters");
    zeros("RWCF", 10); line(0, "SNLQ"); line(0, "SNOW");
    // the reader names and counts lines, and stops at the first it does not expect: it never gets to see a wrong file
    if (L.length !== (dc ? 245 : 240)) throw new Error(`CENTURY: the ${version} site file has ${L.length} lines, not ${dc ? 245 : 240}.`);
    return { text: L.join(CRLF) + CRLF, start };
  }

  /* values the cleaner took as missing, in the columns this file holds: in writers.js's words for the other models when
     it shares them, else in the same words here */
  const BAD = { zero: "Tmax = Tmin = 0", zeroRest: "the zeros in the other columns of those rows", tmax: "Tmax outside -60 to 60 degC", tmin: "Tmin outside -60 to 60 degC", prcp: "negative rain" };
  const badOf = w => {
    const bad = Object.fromEntries(Object.entries((w && w.bad) || {}).filter(([k]) => k in BAD));
    if (!Object.keys(bad).length) return "";
    return U.badText ? U.badText({ bad }) : `Values no station reports were taken as missing: ${Object.entries(bad).map(([k, c]) => `${BAD[k]} ${c} day${c > 1 ? "s" : ""}`).join("; ")}.`;
  };

  W.century = ctx => {
    const { site } = ctx, name = ctx.stem || U.shortName(site), files = [], info = [], notes = [];
    const mon = ctx.wx ? monthlyOf(ctx.wx) : null, wthName = ctx.wth || `${name}.wth`, siteName = `${name}.100`;
    const flagged = k => (mon ? mon.years.reduce((s, r) => s + r[k].filter(v => !ok(v)).length, 0) : 0), rainGap = flagged("prec"), tempGap = flagged("tmin");
    const gapText = `${rainGap} month${rainGap === 1 ? "" : "s"} of rain and ${tempGap} of temperature are flagged -99.99`;
    if (ctx.wx) {
      if (!mon || rainGap + tempGap >= 2 * mon.years.length * 12) throw new Error(`CENTURY: the weather has no month with ${MIN_DAYS} or more days of rain or temperature, and the file holds whole months.`);
      files.push({ name: wthName, text: wthText(mon) });
    }
    // the site file; when it cannot be made, the weather file stays and site_NOT_WRITTEN.txt says why (without weather, the download fails)
    const pick = ctx.soil ? pickClimate(ctx, mon) : null;
    let made = null, why = ctx.soil && !pick ? "the site file needs each calendar month's rain and temperature, and neither the chosen dates nor the 10 years read for the climate have them" : "";
    if (ctx.soil && pick) {
      try {
        const s = soilInfo(ctx.soil);
        made = { s, one: siteText(ctx.soil, site, s, pick.c, "4.0"), two: siteText(ctx.soil, site, s, pick.c, "4.5") };
      } catch (e) {
        if (!ctx.wx) throw e;
        why = String(e.message || e).replace(/^CENTURY: /, "").replace(/\.$/, "");
      }
    }
    if (why && !ctx.wx) throw new Error(`CENTURY: ${why}.`);
    if (ctx.wx) {
      const y0 = mon.years[0].y, y1 = mon.years[mon.years.length - 1].y;
      info.push(`${wthName}: ${mon.years.length} calendar year${mon.years.length > 1 ? "s" : ""}, ${y0}-${y1}, from ${srcName(ctx.wx)}, 3 lines a year (prec, tmin, tmax), 94 characters a line, format(a4,6x,12f7.0).`,
        "  prec: monthly total, cm (the rain of the month's valid days, scaled up to the whole month). tmin and tmax: monthly means of the daily values, degC.");
      if (rainGap || tempGap) {
        const t = `${gapText}, because the dates do not cover them or they have fewer than ${MIN_DAYS} valid days: CENTURY fills temperature from TMN2M and TMX2M in ${made ? "the site file" : "a site file of your own (none is written here)"}, and draws rain at random from PRECIP, PRCSTD and PRCSKW.`;
        info.push(`  ${t}`); notes.push(t);
      }
      if (mon.swapped) { const t = `${mon.swapped} day${mon.swapped > 1 ? "s" : ""} with Tmax below Tmin were swapped for the monthly means, because CENTURY 4.5 stops on a month with tmin above tmax.`; info.push(`  ${t}`); notes.push(t); }
      const bad = badOf(mon);
      if (bad) { info.push(`  ${bad}`); notes.push(bad); }
    }
    if (why) {
      files.push({ name: "site_NOT_WRITTEN.txt", text: `The CENTURY site files could not be made: ${why}.\r\n`
        + `${rainGap || tempGap ? `The weather file is written, but ${gapText}: CENTURY fills those from the climate lines of a site file, so it needs a site file of your own for this place.` : "The weather file is written in full: no month is flagged."}\r\n` });
      info.push(`site_NOT_WRITTEN.txt: no site file, because ${why}.`);
      notes.push(`No site file: ${why}.`);
    }
    if (made) {
      const { s, one, two } = made, c = pick.c, yrs = c.first === c.last ? `${c.first}` : `${c.first}-${c.last}`, dt = depthText(s);
      files.push({ name: `site_4.0/${siteName}`, text: one.text }, { name: `site_4.5/${siteName}`, text: two.text });
      const layerText = `${s.nlayer} water layer${s.nlayer > 1 ? "s" : ""}, ${s.layers.map(l => `${l.top}-${l.bot}`).join(", ")} cm`;
      info.push(`site_4.0/${siteName} and site_4.5/${siteName}: the site file for each version, soil ${ctx.soil.name} (${ctx.soil.source}). Use the one for your version; the model stops at the first wrong label on the other.`,
        "  They differ in 6 lines and 2 values: 4.5 adds ROCK, PRECRO, FRACRO, drops W1LIG, W2LIG, W3LIG and has its own EPNFS. Century 4.6 was not tested: no format document for it was found.",
        `  Climate lines: from ${pick.from} (${srcName(pick.wx)}, ${yrs}), with FILE100's formulas (population variance; skew from it).`,
        ...(pick.wx && pick.wx.source === "prism" ? [`  Rain, Tmax and Tmin: ${Wd.prismCredit()}. PRISM's day ends at 1200 UTC on its date, so each calendar day holds PRISM's next date. Its last six months are provisional and can change.`] : []),
        `  SAND, SILT, CLAY, BULKD, PH${s.rock ? ", ROCK" : ""}: means over ${cm(s.z0)}-${cm(s.zb)} cm by thickness, as CENTURY keeps one texture for the whole soil, from ${dt.means}.`,
        `  NLAYER ${s.nlayer}: ${layerText}, ${s.resTop ? `the fewest there can be: the survey's restriction is at ${cm(s.z0)} cm, the top of the site file's soil, which leaves no soil thickness by the Workbook's rule` : `from a soil thickness of ${Math.round(s.D)} cm by the Workbook's table`}. AWILT and AFIEL per layer, thickness-weighted (SWFLAG 0). They assume ADEP 15,15,15,15,30,30,30,30,0,0 in fix.100, as in all NREL's samples; so NLAYER is at most 8. If you edit ADEP, these depths no longer hold.`);
      if (ctx.soil.layering === "custom") { const t = "CENTURY's water layers are set by ADEP in fix.100, so your custom depths were averaged onto them. To keep your own depths, set ADEP and these lines yourself."; info.push(`  ${t}`); notes.push(t); }
      dt.notes.forEach(t => { info.push(`  ${t}`); notes.push(t); });
      if (pick.thin) notes.push(`The climate lines rest on as few as ${c.fewest} year${c.fewest > 1 ? "s" : ""} in some month (${yrs}), where the manual asks for 10.`);
      const Top = dt.top[0].toUpperCase() + dt.top.slice(1);
      if (!ok(s.ph)) { const t = `${Top} has no pH, so PH is 6.3, the value in NREL's sample; pH only matters with phosphorus (NELEM 2 or more).`; info.push(`  ${t}`); notes.push(t); }
      if (s.drain === null) { const t = "The soil has no drainage class, so DRAIN is 1.0 (well drained)."; info.push(`  ${t}`); notes.push(t); }
      const st = one.start;
      if (st.how === "survey") info.push(`  Soil C at the start (IVAUTO 0): ${Math.round(st.b)} g C/m2 in ${dt.top} from the soil layers' organic matter (OM/1.724 x bulk density x depth), split .03, .44, .53 among active, slow and passive pools, the Workbook's split for mineral soil${dt.split}. Surface active C 10 and litter 100 are the values the model itself starts from.`);
      else {
        const t = st.how === "burke" ? `${Top} lacks organic matter in part or whole, so IVAUTO is 1: CENTURY starts its pools from the Burke equation for grassland (about ${Math.round(st.tcg)} g C/m2 here).`
          : `${Top} lacks organic matter in part or whole, and the Burke equation gives only ${Math.round(st.tcg)} g C/m2 for this dry warm climate (4.0 has no floor and could go negative), so the pools start from 500 g C/m2 with IVAUTO 0.`;
        info.push(`  ${t}`); notes.push(t);
      }
      info.push("  Biology and nutrient lines (live and dead plants, C/N and other ratios, deposition, mineral N, P and S) are NREL's values for its Colorado shortgrass sample (c3grs.100), not measured here: review them before use. NELEM is 1 (carbon and nitrogen).");
      notes.push(`The site files need ADEP 15,15,15,15,30,30,30,30,0,0 in fix.100 for their ${s.nlayer} water layer${s.nlayer > 1 ? "s" : ""}, and their plant and nutrient lines are NREL's Colorado shortgrass sample: review them before use.`);
    }
    const Y = mon ? mon.years[0].y : null;
    files.push({ name: "README.txt", text: [`CENTURY 4.0 and 4.5 files from SoilGuard for ${site.name} (${site.lat.toFixed(5)}, ${site.lon.toFixed(5)}).`, "", ...info, "",
      "Use them: the schedule file (.sch) and the event files (crop.100, cult.100, fert.100, fix.100 and the others) are yours. In your schedule:",
      ...(made ? [`  line 3 names the site file: ${siteName}`] : []),
      ...(ctx.wx ? ["  in the first block that uses this weather, the weather-choice line is F with the file's name on the next line, from column 1:", "    F             Weather choice", `    ${wthName}`,
        `  and later blocks use C, with no name line, to read on. The first of the blocks should start in ${Y}: the model does not read the file's years, it reads the file in order.`, "  A block longer than the file goes back to the file's start without saying so."] : []),
      "An equilibrium block makes the starting pools matter little. Written from the model's Fortran readers and NREL's documents, and read by test copies of those READ statements; not run in CENTURY here."].join(CRLF) + CRLF });
    files.notes = notes;
    return files;
  };
  // CENTURY's own water layers, for the preview
  U.centuryLayers = soil => {
    const s = soilInfo(soil);
    return s.layers.map(l => {
      const at = k => wmean(s.H, l.top + s.z0, l.bot + s.z0, k);
      return { top: l.top, bot: l.bot, hz: "", ll: l.ll, dul: l.dul, sand: s.sand * 100, silt: s.silt * 100, clay: s.clay * 100, bd: s.bd, ph: s.ph, om: at("om"), ksat: null, caco3: null, cfVol: at("cfVol") };
    });
  };
  U.centuryNeedsClimate = needsClimate;
  // what DayCent's writer shares: the months and climate lines, the soil reading and the site file
  U.century = { MISSING, MIN_DAYS, num, cm, hzOf, monthlyOf, pickClimate, srcName, badOf, profileOf, soilInfo, depthText, startOf, siteText };
})();
