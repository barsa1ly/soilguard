/* DayCent (NREL's DailyDayCent of December 2016, the download NREL calls DayCent 4.7): daily weather DNAME.wth, the
   site file NAME.100, soils.in and sitepar.in; the schedule, fix.100, outfiles.in and the other event files are the
   user's. Formats follow the model's readers (getwth.f, sitein.f, initlyrs.c, setlyrs.c, initsite_tg.c), which win
   over the manual where they differ, and NREL's Wooster, Oak Ridge, Harvard Forest and Duke runs. The site file, its
   climate lines and its soil C come from century.js, in DayCent's layout. See docs/METHODS.md. */
(function () {
  const M = WG.models, W = M.writers, Wd = WG.wind, U = WG.writerUtil, C = U.century, { ok, CRLF } = U;
  const { MISSING, num, cm } = C;
  /* ADEP(1..10) in fix.100 as NREL recommends for DayCent (its DayCent 4.5 instructions, and the fix.100 of the December
     2016 package): the model stops unless every boundary they make, down to NLAYER, is a row boundary of soils.in */
  const ADEP = [10, 20, 15, 15, 30, 30, 30, 30, 30, 30], BOUND = ADEP.map((a, i) => ADEP.slice(0, i + 1).reduce((s, x) => s + x, 0));
  const MAX_NLAYER = 9, MAX_ROWS = 20; // sitein.f sets NLAYER above 9 to 9; initlyrs.c stops on a 21st row (MAXLYR 21)
  // the rows of NREL's examples and the manual's Table 2 (bottoms, cm): 0-2, 2-5 and 5-10 cm are its advice for trace gases
  const TEMPLATE = [2, 5, 10, 20, 30, 45, 60, 75, 90, 105, 120, 150, 180, 210];
  // the root fractions of NREL's Wooster and Oak Ridge soils.in on those rows, none below 105 cm: other rows take their share by depth
  const ROOTS = [[0, 2, 0.01], [2, 5, 0.04], [5, 10, 0.25], [10, 20, 0.3], [20, 30, 0.1], [30, 45, 0.05], [45, 60, 0.04], [60, 75, 0.03], [75, 90, 0.02], [90, 105, 0.01]];
  // how far water may fall below the wilting point, Wooster's, by the row's top (cm); 0 below 20 cm
  const DELTAMIN = [[2, 0.09], [5, 0.07], [10, 0.05], [20, 0.02]];
  // cloud cover (%) by month in NREL's sitepar.in (Wooster, Ohio): placeholders, as no source gives Texas values
  const CLDCOV = [60, 59, 55, 62, 67, 72, 73, 76, 73, 75, 65, 66];
  const LANGLEY = 1e6 / 41840, MPH = 3600 / 1609.344; // MJ/m2 to langley; m/s to miles per hour
  // damping depth of the yearly soil temperature wave, cm, from the model's thermal diffusivity 0.00215 cm2/s (soiltemp.c)
  const DAMP = Math.sqrt((2 * 0.00215 * 365 * 86400) / (2 * Math.PI));
  const and = a => (a.length > 1 ? `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}` : a.join(""));
  const days = n => `${n.toLocaleString()} day${n === 1 ? "" : "s"}`;
  const fail = e => new Error(String(e.message || e).replace(/^CENTURY: /, "DayCent: "));

  /* ---------- the daily weather file ---------- */
  /* one row a day from 1 January of the first year to 31 December of the last: the model checks each row's day of the
     year and month against its own calendar and stops on a mismatch, and goes back to the file's start at its end.
     Days outside the dates are flagged; a day missing Tmax or Tmin has both flagged, and a Tmax below Tmin is swapped
     (the model would put the monthly means in place of both). The extra drivers, solar radiation, humidity and wind,
     are written only when every row has them: with usexdrvrs 1 the model stops on a flagged one. */
  function weatherOf(wx) {
    const w = U.clean(wx);
    if (!w || !w.days || !w.days.length) return null;
    const ya = U.ymdOf(w.days[0])[0], yb = U.ymdOf(w.days[w.days.length - 1])[0], at = new Map(w.days.map((d, i) => [d, i]));
    const v = (k, i) => (i !== undefined && w[k] && ok(w[k][i]) ? w[k][i] : null), n = { pad: 0, temp: 0, one: 0, rain: 0, swapped: 0, noDriver: 0 }, R = [];
    for (let d = Wd.epochDay(ya, 0, 1); d <= Wd.epochDay(yb, 11, 31); d++) {
      const i = at.get(d);
      if (i === undefined) n.pad++;
      let tx = v("tmax", i), tn = v("tmin", i);
      if (tx === null || tn === null) { if (i !== undefined) n.temp++; if ((tx === null) !== (tn === null)) n.one++; tx = tn = null; }
      else if (tx < tn) { [tx, tn] = [tn, tx]; n.swapped++; }
      const pr = v("prcp", i), sr = v("srad", i), rh = v("rh", i), u2 = v("wind2", i);
      if (pr === null && i !== undefined) n.rain++;
      if (sr === null || rh === null || u2 === null) n.noDriver++;
      R.push({ d, tx, tn, pr, sr, rh, u2 });
    }
    if (R.every(r => r.tx === null && r.pr === null)) throw new Error("DayCent: the weather has no day with rain or temperature.");
    return { R, n, ya, yb, drivers: !n.noDriver, bad: w.bad, source: wx.source };
  }
  const cell = (x, dp, wd) => num(x === null ? MISSING : x, dp).padStart(wd);
  function wthText(m) {
    const lines = m.R.map(r => {
      const [y, mo, da] = U.ymdOf(r.d);
      return `${String(da).padStart(2)} ${String(mo).padStart(2)} ${y} ${String(U.doyOf(r.d)).padStart(3)} ${cell(r.tx, 2, 7)} ${cell(r.tn, 2, 7)} ${cell(r.pr === null ? null : r.pr / 10, 3, 7)}`
        + (m.drivers ? ` ${cell(r.sr * LANGLEY, 2, 8)} ${cell(Math.min(100, r.rh), 2, 6)} ${cell(r.u2 * MPH, 2, 6)}` : "");
    });
    // read back as getwth.f does: the columns, and the day of the year and month the model expects on each row
    lines.forEach((l, i) => {
      const f = l.trim().split(/\s+/).map(Number), [, mo] = U.ymdOf(m.R[i].d);
      if (f.length !== (m.drivers ? 10 : 7) || f.some(x => !Number.isFinite(x)) || f[1] !== mo || f[3] !== U.doyOf(m.R[i].d) || (m.drivers && f.slice(7).some(x => x <= -99)))
        throw new Error(`DayCent: weather row ${i + 1} would not read as ${Wd.isoDay(m.R[i].d)}.`);
    });
    return lines.join(CRLF) + CRLF;
  }

  /* ---------- soils.in ---------- */
  const near = (H, t, b, k) => {
    const gap = h => (h.bot <= t ? t - h.bot : h.top >= b ? h.top - b : 0);
    return H.filter(h => ok(h[k])).sort((x, y) => gap(x) - gap(y))[0];
  };
  /* a row's value from the horizons it overlaps, by thickness (organic matter by mass, Ksat as a harmonic mean); a row
     that overlaps none with a value takes the nearest horizon's, as the deepest one does for depths past the profile */
  function rowMean(H, t, b, k, how) {
    let w = 0, s = 0;
    for (const h of H) {
      const o = Math.min(b, h.bot) - Math.max(t, h.top);
      if (!(o > 0) || !ok(h[k])) continue;
      const wt = how === "mass" && ok(h.bd) ? o * h.bd : o;
      w += wt; s += how === "harmonic" ? wt / Math.max(h[k], 1e-6) : wt * h[k];
    }
    if (w) return how === "harmonic" ? w / s : s / w;
    const n = near(H, t, b, k);
    return n ? n[k] : null;
  }
  // the nearest boundary to depth D, at most 9 layers; a tie goes deeper, as in CENTURY's writer
  const nearestLayers = D => {
    let best = 1, gap = Infinity;
    BOUND.slice(0, MAX_NLAYER).forEach((b, i) => { if (Math.abs(b - D) <= gap) { gap = Math.abs(b - D); best = i + 1; } });
    return best;
  };
  const rootShare = (t, b) => ROOTS.reduce((s, [a, z, f]) => s + f * Math.max(0, Math.min(b, z) - Math.max(t, a)) / (z - a), 0);
  /* the rows of soils.in, their values, and what the site file takes from them. Depths are measured from the top of the
     profile the site file uses (century.js profileOf: surface O horizons without sand and clay left out). The profile
     goes to its last horizon with water retention and bulk density, so to bedrock or a cemented layer; NLAYER is the
     nearest ADEP boundary to that depth, at most 9 (210 cm), and the rows stop there. "Each model's usual layers" are
     NREL's rows; the horizons as they are, or custom depths, are split at the 2 and 5 cm rows and the ADEP boundaries,
     with depths in whole cm (the model compares them exactly), and merged within a CENTURY layer past 20 rows. */
  function soilsOf(soil) {
    const P = C.profileOf(soil), { R, top0 } = P, H = P.H.map(h => ({ ...h, top: h.top - top0, bot: h.bot - top0 })), depth = P.bottom - top0;
    const nlayer = nearestLayers(depth), end = BOUND[nlayer - 1], keep = new Set([2, 5, ...BOUND.slice(0, nlayer)]);
    let cuts = [...keep], rounded = false, merged = 0;
    if (soil.layering === "custom" || soil.layering === "survey") H.forEach(h => [h.top, h.bot].forEach(z => { const r = Math.round(z); if (Math.abs(r - z) > 1e-6) rounded = true; cuts.push(r); }));
    else cuts.push(...TEMPLATE);
    cuts = [...new Set(cuts)].filter(b => b > 0 && b <= end).sort((a, b) => a - b);
    // past 20 rows: the thinnest pair of neighbours inside one CENTURY layer becomes one row, the top three rows kept
    while (cuts.length > MAX_ROWS) {
      let best = -1, bt = Infinity;
      cuts.forEach((b, i) => { if (keep.has(b)) return; const t = cuts[i + 1] - (i ? cuts[i - 1] : 0); if (t < bt) { bt = t; best = i; } });
      if (best < 0) break;
      cuts.splice(best, 1); merged++;
    }
    // roots stop at a root-restrictive layer, unless it is at the top: then the top stays open, as in the other models' files
    const res = R.find(l => l.srgf === 0 && l.bot > top0), rz = res ? Math.max(0, res.top - top0) : Infinity, rootsAt = rz > 0 ? rz : Infinity;
    const est = { ksat: 0, om: 0, ph: 0 };
    const rows = cuts.map((b, i) => {
      const t = i ? cuts[i - 1] : 0, m = (k, how) => rowMean(H, t, b, k, how);
      const ll = m("ll"), bd = m("bd"), sand = m("sand"), clay = m("clay");
      const omH = H.map(h => ({ ...h, om: ok(h.om) ? h.om : ok(h.oc) ? h.oc * 1.724 : null }));
      let om = rowMean(omH, t, b, "om", "mass"), ph = m("ph"), ks = m("ksat", "harmonic");
      if (!ok(om)) { om = 1; est.om++; } // NREL's examples: 0.01
      if (!ok(ph)) { ph = 6.3; est.ph++; } // as in the site file
      if (!ok(ks)) { const sr = WG.soil.saxtonRawls(sand, clay, om); ks = sr ? sr.ksat : null; est.ksat++; }
      if (!ok(ll) || !ok(bd) || !ok(sand) || !ok(clay) || !ok(ks)) throw new Error(`DayCent: no ${[!ok(ll) && "wilting point", !ok(bd) && "bulk density", !ok(sand) && "sand", !ok(clay) && "clay", !ok(ks) && "Ksat"].filter(Boolean).join(", ")} for the soils.in row ${t}-${b} cm.`);
      const wp = +ll.toFixed(5), fc = +Math.max(m("dul"), wp + 0.01).toFixed(5), dm = DELTAMIN.find(([z]) => t < z);
      return { top: t, bot: b, bd: +bd.toFixed(2), fc, wp, ec: i === 0 ? 0.8 : i === 1 ? 0.2 : 0, root: rootShare(t, Math.min(b, rootsAt)),
        sand: +(sand / 100).toFixed(3), clay: +(clay / 100).toFixed(3), om: +(om / 100).toFixed(4), dm: dm ? Math.floor(Math.min(dm[1], 0.8 * wp) * 1000) / 1000 : 0,
        ks: ks / 36000, ph: +ph.toFixed(2), past: t >= depth - 1e-6 };
    });
    // root fractions summing to 1 as printed (the model normalises them anyway): the largest takes the rounding
    const open = rows.some(r => r.root > 0) ? rows : rows.map(r => ({ ...r, root: rootShare(r.top, r.bot) })), total = open.reduce((s, r) => s + r.root, 0);
    open.forEach(r => { r.root = Math.round((r.root / total) * 1e4); });
    open.reduce((a, r) => (r.root > a.root ? r : a)).root += 1e4 - open.reduce((s, r) => s + r.root, 0);
    open.forEach(r => { r.root /= 1e4; });
    return { P, rows: open, nlayer, end, depth, merged, rounded, est, res: res ? rz : null, resTop: rz === 0, H };
  }
  const ksText = v => (v >= 1e-5 ? v.toFixed(6) : v.toExponential(3));
  function soilsText(s) {
    const f = (v, d, w) => num(v, d).padStart(w);
    const lines = s.rows.map(r => `${f(r.top, 1, 5)} ${f(r.bot, 1, 5)}  ${f(r.bd, 2, 4)}  ${f(r.fc, 5, 7)}  ${f(r.wp, 5, 7)}  ${f(r.ec, 2, 4)}  ${f(r.root, 4, 6)}  ${f(r.sand, 3, 5)}  ${f(r.clay, 3, 5)}  ${f(r.om, 4, 6)}  ${f(r.dm, 3, 5)}  ${ksText(r.ks)}  ${f(r.ph, 2, 5)}`);
    // the checks initlyrs.c and setlyrs.c make, on the numbers as printed
    const V = lines.map(l => l.trim().split(/\s+/).map(Number));
    if (V.length < 3 || V.length > MAX_ROWS) throw new Error(`DayCent: soils.in has ${V.length} rows; the model takes 3 to ${MAX_ROWS}.`);
    V.forEach((v, i) => {
      if (v.length !== 13 || v.some(x => !Number.isFinite(x))) throw new Error(`DayCent: soils.in row ${i + 1} would not read as 13 numbers.`);
      if (v[0] !== (i ? V[i - 1][1] : 0) || !(v[1] > v[0])) throw new Error(`DayCent: soils.in row ${i + 1} does not start where the row above ends.`);
      if (v[4] - v[10] < 0) throw new Error(`DayCent: soils.in row ${i + 1} would let water fall below 0.`);
      if (v[7] <= 0 && v[8] <= 0) throw new Error(`DayCent: soils.in row ${i + 1} has neither sand nor clay.`);
    });
    let j = 0;
    for (let k = 0; k < s.nlayer; k++) {
      while (j < V.length && BOUND[k] > V[j][1]) j++;
      if (j >= V.length || V[j][1] !== BOUND[k]) throw new Error(`DayCent: no soils.in row ends at ${BOUND[k]} cm, an ADEP boundary.`);
      j++;
    }
    if (j !== V.length) throw new Error("DayCent: soils.in goes deeper than NLAYER's layers.");
    return lines.join(CRLF) + CRLF;
  }
  /* what DayCent puts in the site file's place from soils.in (setlyrs.c): SAND, CLAY, BULKD and PH over the first CENTURY
     layer and AWILT, AFIEL over each, by width. The site file holds the same, so it says what the model uses. */
  function centuryFromRows(s) {
    const over = (t, b, k) => { const R = s.rows.filter(r => r.top >= t && r.bot <= b), w = R.reduce((a, r) => a + r.bot - r.top, 0); return R.reduce((a, r) => a + r[k] * (r.bot - r.top), 0) / w; };
    const layers = BOUND.slice(0, s.nlayer).map((b, k) => ({ top: k ? BOUND[k - 1] : 0, bot: b, ll: over(k ? BOUND[k - 1] : 0, b, "wp"), dul: over(k ? BOUND[k - 1] : 0, b, "fc") }));
    const sand = over(0, BOUND[0], "sand"), clay = over(0, BOUND[0], "clay");
    return { sand, clay, silt: 1 - sand - clay, bd: over(0, BOUND[0], "bd"), ph: over(0, BOUND[0], "ph"), layers, nlayer: s.nlayer, nlaypg: Math.min(4, s.nlayer) }; // 4 layers: 0-60 cm
  }

  /* ---------- sitepar.in ---------- */
  /* NREL's sitepar.in of the December 2016 package, keyword by keyword in its order; the reader finds each by its word,
     and stops on a line with a number and no word it knows. usexdrvrs follows the weather file. tbotmn and tbotmx, the
     soil temperature range at the profile's foot, have no rule in any source: here the yearly wave of monthly air
     temperature, damped to that depth (an estimate, said in the README) */
  const tbotOf = (c, z) => {
    const T = c.TMN2M.map((x, m) => (x + c.TMX2M[m]) / 2), mean = T.reduce((a, x) => a + x, 0) / 12, half = ((Math.max(...T) - Math.min(...T)) / 2) * Math.exp(-(z + 5) / DAMP);
    return { mn: mean - half, mx: mean + half, mean, half };
  };
  const siteparText = (usex, tb) => [`${usex}  usexdrvrs`, "1  sublimscale", "0.18  reflec", "0.20  albedo", "0.6  fswcinit", "0.000008  dmpflux", "12  hours_rain", "1  drainlag",
    ...CLDCOV.map((_, m) => `${m + 1} 0 watertable[${m + 1}]`), "-200  hpotdeep", "0.0003  ksatdeep", ...CLDCOV.map((v, m) => `${m + 1} ${v} cldcov[${m + 1}]`),
    `${num(tb.mn, 1)} ${num(tb.mx, 1)} tbotmn/tbotmx`, "0.003  dmp", "30.0  timlag", "0.03  Ncoeff", "0 0  jdayStart/jdayEnd", "0.90  NO3_N2O_x", "1.50  NO3_N2O_y", "2.93  NO3_N2O_step",
    "5.99  NO3_N2O_slope", "0.39  MaxNitAmt", "1  SnowFlag", "0.31  netmn_to_no3", "1.45  wfpsdnitadj", "0.62  n2n2oadj"].join(CRLF) + CRLF;

  W.daycent = ctx => {
    const { site } = ctx, name = ctx.stem || U.shortName(site), wthName = ctx.wth || `D${name.slice(1)}.wth`, siteName = `${name}.100`, files = [], info = [], notes = [];
    const say = t => { info.push(`  ${t}`); notes.push(t); };
    const wm = ctx.wx ? weatherOf(ctx.wx) : null;
    if (ctx.wx && !wm) throw new Error("DayCent: the weather has no days.");
    if (wm) files.push({ name: wthName, text: wthText(wm) });
    // the site file, soils.in and sitepar.in go together; when they cannot be made the weather file stays and
    // site_NOT_WRITTEN.txt says why (without weather, the download fails)
    const mon = ctx.wx ? C.monthlyOf(ctx.wx) : null, pick = ctx.soil ? C.pickClimate(ctx, mon) : null;
    let made = null, why = ctx.soil && !pick ? "the site file needs each calendar month's rain and temperature, and neither the chosen dates nor the 10 years read for the climate have them" : "";
    if (ctx.soil && pick) {
      try {
        const s = soilsOf(ctx.soil), ci = C.soilInfo(ctx.soil), info100 = { ...ci, ...centuryFromRows(s) };
        made = { s, ci, info100, soils: soilsText(s), site: C.siteText(ctx.soil, site, info100, pick.c, "DC"), tb: tbotOf(pick.c, s.end) };
      } catch (e) {
        if (!ctx.wx) throw fail(e);
        why = String(e.message || e).replace(/^(CENTURY|DayCent): /, "").replace(/\.$/, "");
      }
    }
    if (why && !ctx.wx) throw new Error(`DayCent: ${why}.`);
    const usex = wm && wm.drivers ? 1 : 0;
    if (wm) {
      const yrs = wm.yb - wm.ya + 1, n = wm.n;
      info.push(`${wthName}: ${yrs} calendar year${yrs > 1 ? "s" : ""}, ${wm.ya}-${wm.yb}, from ${C.srcName(ctx.wx)}, ${wm.R.length.toLocaleString()} rows, one a day: day, month, year, day of the year, Tmax and Tmin (degC), rain (cm)${wm.drivers ? ", solar radiation (langley/day), relative humidity (%) and wind at 2 m (mph)" : ""}.`);
      const sp = made ? "sitepar.in has" : "sitepar.in needs";
      info.push(wm.drivers ? `  Solar radiation, humidity and wind are on every row, so ${sp} usexdrvrs 1 and DayCent works out PET from them.`
        : `  Solar radiation, humidity or wind is missing on ${days(n.noDriver)}${n.pad ? " (the days outside the dates among them)" : ""}, and DayCent stops on a missing one when it reads them, so the file has the first 7 columns and ${sp} usexdrvrs 0: PET then comes from air temperature, and NREL asks for FWLOSS(4) 0.8 in fix.100.`);
      if (n.pad) say(`The dates do not fill ${yrs > 1 ? "their first and last calendar years" : "a calendar year"}, and DayCent reads whole years in calendar order, so the ${days(n.pad)} outside them are flagged -99.99: DayCent takes TMX2M and TMN2M from the site file for their temperature and 0 for their rain, so they are dry.`);
      if (n.temp) say(`${days(n.temp)} without Tmax or Tmin ${n.temp === 1 ? "has" : "have"} both flagged -99.99${n.one ? ` (${n.one} had one of them)` : ""}: DayCent takes TMX2M and TMN2M from the site file.`);
      if (n.rain) say(`${days(n.rain)} without rain ${n.rain === 1 ? "is" : "are"} flagged -99.99: DayCent takes them as dry, not as a random draw.`);
      if (n.swapped) say(`${days(n.swapped)} with Tmax below Tmin ${n.swapped === 1 ? "was" : "were"} swapped; DayCent would put the monthly means in place of both.`);
      const bad = C.badOf(wm);
      if (bad) say(bad);
      if (!ctx.soil) info.push("  The site file, soils.in and sitepar.in come with a soil: the sheet's Soil files or Both together tab makes them.");
    }
    if (why) {
      files.push({ name: "site_NOT_WRITTEN.txt", text: `The DayCent site file, soils.in and sitepar.in could not be made: ${why}.\r\n`
        + "The weather file is written: DayCent takes the temperature of its flagged days from TMX2M and TMN2M in a site file, so it needs a site file of your own for this place.\r\n" });
      info.push(`site_NOT_WRITTEN.txt: no site file, soils.in or sitepar.in, because ${why}.`);
      notes.push(`No site file, soils.in or sitepar.in: ${why}.`);
    }
    if (made) {
      const { s, ci, info100, tb } = made, c = pick.c, yrs = c.first === c.last ? `${c.first}` : `${c.first}-${c.last}`, dt = C.depthText(ci), rowsText = s.rows.map(r => `${r.top}-${r.bot}`).join(", ");
      files.push({ name: siteName, text: made.site.text }, { name: "soils.in", text: made.soils }, { name: "sitepar.in", text: siteparText(usex, tb) });
      info.push(`${siteName}: the site file in DayCent's layout of December 2016 (245 lines), soil ${ctx.soil.name} (${ctx.soil.source}). Monthly CENTURY's site files differ from it, and the model stops at the first label it does not expect.`,
        `  Climate lines: from ${pick.from} (${C.srcName(pick.wx)}, ${yrs}), with FILE100's formulas (population variance; skew from it). DayCent fills flagged temperature from TMN2M and TMX2M, and takes N deposition from PRECIP; PRCSTD and PRCSKW are not used.`,
        ...(pick.wx && pick.wx.source === "prism" ? [`  Rain, Tmax and Tmin: ${Wd.prismCredit()}. PRISM's day ends at 1200 UTC on its date, so each calendar day holds PRISM's next date. Its last six months are provisional and can change.`] : []),
        `  SAND ${num(info100.sand, 3)}, SILT ${num(info100.silt, 3)}, CLAY ${num(info100.clay, 3)}, BULKD ${num(info100.bd, 2)} and PH ${num(info100.ph, 2)} (the 0-10 cm rows), and AWILT and AFIEL of each CENTURY layer, are what DayCent works out from soils.in and puts in place of the site file's: they are written as it will use them.`,
        `  NLAYER ${s.nlayer}: CENTURY layers ${BOUND.slice(0, s.nlayer).map((b, k) => `${k ? BOUND[k - 1] : 0}-${b}`).join(", ")} cm, for ADEP 10, 20, 15, 15, 30, 30, 30, 30, 30, 30 in fix.100.`);
      if (pick.thin) notes.push(`The climate lines rest on as few as ${c.fewest} year${c.fewest > 1 ? "s" : ""} in some month (${yrs}), where the manual asks for 10.`);
      const st = C.startOf(info100, c), Top = dt.top[0].toUpperCase() + dt.top.slice(1);
      if (st.how === "survey") info.push(`  Soil C at the start (IVAUTO 0): ${Math.round(st.b)} g C/m2 in ${dt.top} from the soil layers' organic matter (OM/1.724 x bulk density x depth), split .03, .44, .53 among active, slow and passive pools, the Workbook's split for mineral soil${dt.split}; the slow pool is the soil one, SOM2CI(2,1). Surface active C 10 and litter 100 are the values the model itself starts from.`);
      else say(st.how === "burke" ? `${Top} lacks organic matter in part or whole, so IVAUTO is 1: DayCent starts its pools from the Burke equation for grassland (about ${Math.round(st.tcg)} g C/m2 here, with the soils.in texture).`
        : `${Top} lacks organic matter in part or whole, and the Burke equation gives only ${Math.round(st.tcg)} g C/m2 for this dry warm climate, so the pools start from 500 g C/m2 with IVAUTO 0, as DayCent's own floor would.`);
      if (ci.drain === null) say("The soil has no drainage class, so DRAIN is 1.0 (well drained).");
      info.push("  Biology and nutrient lines (live and dead plants, C/N and other ratios, deposition, mineral N, P and S) are NREL's values for its Colorado shortgrass sample (c3grs.100), and BASEF 0.3 that of its Wooster run, not measured here: review them before use. NELEM is 1 (carbon and nitrogen).");
      // soils.in
      const shortBy = s.end - s.depth, kept = s.rows.filter(r => r.past);
      info.push(`soils.in: ${s.rows.length} rows, ${rowsText} cm, ${ctx.soil.layering === "model" ? "the rows of NREL's examples" : `${ctx.soil.layering === "custom" ? "your custom depths" : "the horizons"} split at 2, 5 cm and the ADEP boundaries`}, measured from ${s.P.top0 ? `${cm(s.P.top0)} cm, the top of the soil the site file uses` : "the surface"}. Columns: top, bottom (cm), bulk density, field capacity, wilting point, evaporation coefficient, root fraction, sand, clay, organic matter (fractions), deltamin, Ksat (cm/s), pH.`,
        "  Each row is the thickness-weighted mean of the soil layers it covers (organic matter by mass, Ksat as a harmonic mean); field capacity is at least the wilting point + 0.01.",
        `  Depth: the soil goes to ${cm(s.depth)} cm${s.P.top0 ? ` below its top` : ""} (its last layer with water retention and bulk density), and DayCent's rows end on an ADEP boundary: ${s.depth > BOUND[MAX_NLAYER - 1] + 1e-6 ? `at most the 9th, ${s.end} cm, as the model sets NLAYER above 9 to 9, so soils.in leaves out the soil below` : `the nearest is ${s.end} cm${s.depth > s.end + 1e-6 ? `, so the soil's last ${cm(s.depth - s.end)} cm are left out` : ""}`}.${shortBy > 1e-6 ? ` The ${cm(shortBy)} cm below the soil's end repeat its deepest layer${kept.length ? ` (rows ${kept.map(r => `${r.top}-${r.bot}`).join(", ")})` : ""}.` : ""}`,
        "  Root fractions follow those of NREL's Wooster and Oak Ridge soils.in by depth (none below 105 cm), scaled to sum to 1: they depend on the vegetation, so set your own. Evaporation coefficients 0.8, 0.2, 0 and deltamin 0.09, 0.07, 0.05, 0.02 cm3/cm3 in the top rows (at most 0.8 x the wilting point) are Wooster's.");
      if (s.depth > BOUND[MAX_NLAYER - 1] + 1e-6) notes.push(`The soil goes to ${cm(s.depth)} cm, deeper than DayCent's 9 CENTURY layers reach (210 cm with NREL's ADEP), so soils.in stops at 210 cm.`);
      if (s.merged) say(`DayCent takes at most ${MAX_ROWS} soils.in rows (the model stops on a 21st), so ${s.merged} of the soil's boundaries inside a CENTURY layer were dropped, the thinnest rows first, to make ${s.rows.length}.`);
      if (s.rounded) say("soils.in's depths are in whole cm, as DayCent compares them exactly with ADEP: the layer boundaries were rounded to the nearest cm.");
      if (ctx.soil.layering === "custom") say("DayCent's CENTURY layers are set by ADEP in fix.100, so soils.in also has rows at its boundaries, 10, 30, 45, 60, 90 ... cm, and at 2 and 5 cm, besides your custom depths.");
      if (s.res !== null && s.res < s.end) say(s.resTop ? "The survey puts a root-restrictive layer at the top of the soil, so no row would hold roots: they are left as the template has them, so that the file can be run. Check that the soil suits the crop."
        : `The survey puts a root-restrictive layer at ${cm(s.res)} cm, so the rows below it have no roots.`);
      if (s.est.ksat) say(`${s.est.ksat} soils.in row${s.est.ksat > 1 ? "s have" : " has"} no Ksat in the soil data, so it comes from Saxton and Rawls (2006).`);
      if (s.est.om) say(`${s.est.om} soils.in row${s.est.om > 1 ? "s have" : " has"} no organic matter, so it is 0.01, as in NREL's examples; DayCent uses it only for soil temperature.`);
      if (s.est.ph) say(`${s.est.ph} soils.in row${s.est.ph > 1 ? "s have" : " has"} no pH in the soil data, so it is 6.3, the value in NREL's sample.`);
      if (s.P.top0) { const names = C.hzOf(ctx.soil.layers.filter(l => ok(l.top) && l.top < s.P.top0)); say(`The layers above ${cm(s.P.top0)} cm${names ? ` (${names})` : ""} lack water retention, bulk density, sand or clay, so soils.in starts below them and its depths are measured from there.`); }
      s.P.gaps.forEach(g => say(`No soil layer covers ${cm(g.top)} to ${cm(g.bot)} cm, so each depth there takes the values of the nearer one: ${g.above || "the one above"} down to ${cm(g.mid)} cm, ${g.below || "the one below"} below.`));
      // sitepar.in
      info.push(`sitepar.in: NREL's sitepar.in of the December 2016 package, keyword by keyword, with usexdrvrs ${usex}${wm ? "" : " (this download has no weather file: set 1 if yours has solar radiation, humidity and wind in columns 8 to 10)"}, no water table, and tbotmn ${num(tb.mn, 1)}, tbotmx ${num(tb.mx, 1)} degC.`,
        `  tbotmn and tbotmx, the soil temperature range below the profile, have no rule in any source: these are an estimate, the mean air temperature of the climate lines (${num(tb.mean, 1)} degC) plus and minus half its yearly range damped to ${s.end + 5} cm (damping depth ${num(DAMP, 0)} cm, from the model's soil thermal diffusivity). NREL's own files hold 0.0 and 12.4.`,
        "  cldcov (cloud cover by month) is NREL's Wooster, Ohio values, not this site's; the trace-gas coefficients are NREL's.");
      notes.push(`soils.in needs ADEP 10,20,15,15,30,30,30,30,30,30 in fix.100 for its ${s.nlayer} CENTURY layer${s.nlayer > 1 ? "s" : ""}, and the site file's plant and nutrient lines are NREL's Colorado shortgrass sample: review them before use.`);
    }
    files.push({ name: "README.txt", text: [`DayCent files from SoilGuard for ${site.name} (${site.lat.toFixed(5)}, ${site.lon.toFixed(5)}).`,
      "For DailyDayCent of December 2016, NREL's download (its page calls it DayCent 4.7). Older versions read sitepar.in by position, in another layout.", "", ...info, "",
      "Use them: the schedule file (.sch), fix.100, outfiles.in and the other event files (crop.100, cult.100, fert.100 and so on) are yours.",
      ...(made ? ["  fix.100 must have ADEP(1) to ADEP(10) = 10, 20, 15, 15, 30, 30, 30, 30, 30, 30, NREL's values for DayCent: the model stops if soils.in's depths do not meet them.", `  Line 3 of the schedule names the site file: ${siteName}`] : []),
      ...(wm ? ["  The first block's weather choice is F, with the file's name on the next line, from column 1:", "    F             Weather choice", `    ${wthName}`,
        `  and later blocks use C to read on, or F to start the file again. The first block should start in ${wm.ya}: DayCent checks each row's month and day of the year, and at the file's end goes back to its start.`,
        ...(usex ? [] : ["  Without the extra drivers, NREL asks for FWLOSS(4) = 0.8 in fix.100."])] : []),
      "An equilibrium block makes the starting pools matter little. Written from the model's readers and NREL's example files; not run in DayCent here."].join(CRLF) + CRLF });
    files.notes = notes;
    return files;
  };
  // the soils.in rows with their values, for the preview (Ksat in mm/h, fractions in %)
  U.daycentLayers = soil => soilsOf(soil).rows.map(r => ({ top: r.top, bot: r.bot, hz: "", bd: r.bd, ll: r.wp, dul: r.fc, sand: r.sand * 100, clay: r.clay * 100, silt: (1 - r.sand - r.clay) * 100, om: r.om * 100, ksat: r.ks * 36000, ph: r.ph }));
})();
