/* Model-ready soil and weather files for one location. Every writer takes the same two structures:
   soil    { id, name, source, lat, lon, elev, slope, hydgrp, drainage, albedo, u, drainRate, cn, texture, family,
             layers: [{ top, bot (cm), sand, silt, clay, om, oc (%), bd (g/cm³), ll, dul, sat (cm³/cm³), awc (cm/cm),
                        ksat (mm/h), ph, cec (cmol/kg), caco3 (%), cfWt, cfVol (%), ec (dS/m), kw, srgf, ni (%) }] };
             both also have notes [what was done to the layers, worth saying]
   weather { source, lat, lon, elev, days (epoch days), prcp (mm), tmax, tmin (°C), srad (MJ/m²/d), rh, rhmax,
             rhmin (%), tdew (°C), vp (kPa), wind10, wind2 (m/s), et0 (mm) }; weather read from a user's file also has
             columns { quantity: the header it was read from } and notes [what was read in a way worth saying]
   Writers return [{ name, text }]; the data sheet zips them with a README. Model files always use each model's
   own units, whatever the display units are. */
WG.models = (function () {
  const { num } = WG.util;
  const S = WG.soil, Wd = WG.wind;
  const r = (v, d) => (v === null || v === undefined || !Number.isFinite(v) ? null : +v.toFixed(d));

  /* ---------- soil ---------- */
  const fragVol = (w, bd) => (w === null || w <= 0 ? 0 : (100 * w / 2.65) / (w / 2.65 + (100 - w) / (bd || 1.45)));
  /* a survey component's horizons in the common structure; edits: the edited surface, if any */
  function surveyLayers(comp, edits = null) {
    return S.profileLayers(comp, edits).map((l, i) => {
      const h = comp.horizons[i] || {}, fv = num(h.fragvoltot_r);
      // > 2 mm by weight of the whole soil: cobbles and stones (frag3to10, fraggt10) plus the gravel the No. 10 sieve holds back
      const big = (num(h.frag3to10_r) ?? 0) + (num(h.fraggt10_r) ?? 0), pass = num(h.sieveno10_r);
      const cfWt = pass === null ? big : Math.min(100, big + (100 - big) * Math.max(0, 100 - pass) / 100);
      return { top: l.top, bot: l.bot, hz: l.hz, texture: l.texture, sand: l.sand, silt: l.silt, clay: l.clay, om: l.om, oc: l.oc, bd: l.bd,
        ll: l.ll, dul: l.dul, sat: l.sat, awc: l.awc, ksat: l.ksat === null ? null : l.ksat * 10, ph: l.ph, cec: l.cec, caco3: l.caco3,
        cfWt: r(cfWt, 1), cfVol: fv !== null ? fv : r(fragVol(cfWt, l.bd), 1), ec: l.ec, kw: l.kw, kf: num(h.kffact), srgf: l.srgf, ni: l.ni, sar: l.sar,
        noBd: num(h.dbthirdbar_r) === null && !(edits && i === 0) };
    });
  }
  /* the survey's component (dominant unless cokey) as the common soil structure */
  function surveySoil(state, cokey) {
    const s = state.soil;
    if (!s || s.error || !s.dominant) return null;
    const comp = (cokey && s.components.find(c => String(c.cokey) === String(cokey))) || s.dominant;
    const isDom = comp === s.dominant, surf = isDom ? WG.currentSurface() : null;
    const edits = isDom && state.edits ? { sand: surf.sand, silt: surf.silt, clay: surf.clay, om: surf.om, ph: surf.ph, caco3: surf.caco3 } : null;
    const e = state.elev;
    return compSoil(s, comp, { lat: state.site.lat, lon: state.site.lon, elev: e ? e.z : num(comp.elev_r) }, isDom ? surf : null, edits);
  }
  /* one component of a map unit as the common soil structure: s { mukey, mapunit { areasymbol, slopegraddcp } }, comp
     with its horizons and restrictions, at { lat, lon, elev }; surf and edits: a point's edited surface, if any. The
     data sheet takes the point's map unit, the area grid each map unit of the area. */
  function compSoil(s, comp, at, surf = null, edits = null) {
    const layers = S.profileLayers(comp, edits), site = S.siteParams(s, comp, surf);
    const noOm = layers.filter(l => l.om === null && fin(l.ll) && fin(l.dul) && fin(l.bd));
    return {
      notes: noOm.length ? [`The survey gives no organic matter for ${noOm.map(l => `${l.top} to ${l.bot} cm`).join(", ")}: it stays blank where a file can leave it blank.`] : [],
      id: `${s.mukey}`, mukey: s.mukey, cokey: comp.cokey, name: comp.compname, source: `USDA-NRCS SSURGO map unit ${s.mukey} (${s.mapunit.areasymbol || ""}), component ${comp.compname} ${comp.comppct_r}%${edits ? ", surface edited" : ""}`,
      edited: !!edits, lat: at.lat, lon: at.lon, elev: at.elev, slope: site.slope, hydgrp: site.hydgrp, drainage: site.drainage,
      albedo: site.albedo, u: site.u, drainRate: site.drainRate, cn: site.cn, depth: site.depth, texture: layers[0] ? layers[0].texture : "",
      family: comp.taxclname || "", order: comp.taxorder || "", tfact: site.tfact,
      layers: surveyLayers(comp, edits),
    };
  }
  /* what a soil can hold, in the editor's units: [lowest, highest, name, unit]. Peat has bulk densities well under 0.2. */
  const SOIL_RANGE = { bd: [0.02, 2.7, "bulk density", "g/cm³"], ksat: [0, 5000, "Ksat", "mm/h"], om: [0, 100, "organic matter", "%"], caco3: [0, 100, "CaCO3", "%"], ec: [0, 300, "EC", "dS/m"],
    ll: [0, 1, "wilting point", "cm³/cm³"], dul: [0, 1, "field capacity", "cm³/cm³"], sat: [0, 1, "saturation", "cm³/cm³"] };
  const outOfRange = x => Object.keys(SOIL_RANGE).find(k => { const v = num(x[k]); return v !== null && (v < SOIL_RANGE[k][0] || v > SOIL_RANGE[k][1]); });
  /* the first thing wrong with the depths of layers in order of their bottoms, or ""; a blank top is the bottom of the
     layer above, and 0.5 cm either way is rounding (15 cm given as 5.9 in) */
  function depthFault(R) {
    let prev = 0;
    for (const x of R) {
      const bot = num(x.bot), top = num(x.top) ?? prev;
      if (top < prev - 0.5) return `${top} to ${bot} cm overlaps the layer down to ${prev} cm`;
      if (bot <= top) return `the layer ${top} to ${bot} cm has no thickness`;
      prev = bot;
    }
    return "";
  }
  // what the same layers leave out: the depths with nothing given, which the layer below then covers
  const depthGaps = R => R.flatMap((x, i) => {
    const above = i ? num(R[i - 1].bot) : 0, top = num(x.top) ?? above;
    return !i ? (top > 0 ? [`The first layer starts at ${top} cm, so the model files start there.`] : []) : top > above + 0.5 ? [`Nothing is given from ${above} to ${top} cm, so the layer below is used from ${above} cm.`] : [];
  });
  /* rows the user typed (or uploaded): missing water retention, bulk density and Ksat from Saxton & Rawls (2006).
     Water contents are for the whole soil, as the survey gives them; Saxton & Rawls estimates are for the fine earth,
     so they are scaled by the share of fine earth when coarse fragments are given. A blank top is the bottom of the
     layer above; a gap is closed by the layer below, and notes says so. A layer without sand, clay or a bottom is refused
     when layers lie below it; at the end of the profile it is left out, and so is a row with no depths at all (a Mean under
     the table). A blank organic matter stays blank (for the
     estimates, at most 1 % and at most that of the layer above), and so does a blank CaCO3: none given is not 0.
     Curve number and drainage rate follow the hydrologic group, slope and drainage class, as for the survey. */
  function userSoil(rows, site) {
    const R = rows.filter(x => num(x.bot) !== null && num(x.sand) !== null && num(x.clay) !== null).sort((a, b) => num(a.bot) - num(b.bot));
    const over = R.find(x => num(x.sand) + num(x.clay) > 101 || num(x.sand) < 0 || num(x.clay) < 0);
    if (over) throw new Error(`The layer down to ${num(over.bot)} cm has sand ${num(over.sand)} % and clay ${num(over.clay)} %: they must be in percent and add up to at most 100.`);
    const notes = depthGaps(R), deepest = R.length ? num(R[R.length - 1].bot) : null;
    const noDepth = x => num(x.bot) === null && num(x.top) === null, lacks = x => [["bot", "bottom"], ["sand", "sand"], ["clay", "clay"]].filter(([k]) => num(x[k]) === null).map(p => p[1]);
    const given = rows.filter(x => !R.includes(x) && ["bot", "sand", "clay"].some(k => num(x[k]) !== null)), part = given.filter(x => !noDepth(x));
    if (given.length > part.length) notes.push(`${given.length - part.length} row${given.length - part.length > 1 ? "s" : ""} with no depths (a mean or total?) left out.`);
    if (R.length) {
      const stop = part.find(x => (num(x.bot) ?? num(x.top)) < deepest || (num(x.bot) !== null && num(x.bot) === deepest));
      if (stop) throw new Error(`The layer ${num(stop.bot) !== null ? `down to ${num(stop.bot)} cm` : `from ${num(stop.top) ?? "?"} cm`} has no ${lacks(stop).join(" and ")}: fill it in or remove the row.`);
      if (part.length) notes.push(`The layers below ${deepest} cm have no ${[...new Set(part.flatMap(lacks))].join(" or ")}, so the profile ends at ${deepest} cm.`);
    }
    const fault = depthFault(R);
    if (fault) throw new Error(`The layers do not make one profile: ${fault}. Keep one field or sample at a time.`);
    const odd = R.find(outOfRange);
    if (odd) { const k = outOfRange(odd), [, , what, unit] = SOIL_RANGE[k]; throw new Error(`The layer down to ${num(odd.bot)} cm has ${what} ${num(odd[k])}, which no soil has: give it in ${unit}.`); }
    let omAbove = 1; // what the estimates take for a blank organic matter
    const layers = R.map((x, i) => {
      const top = i ? num(R[i - 1].bot) : num(x.top) ?? 0, bot = num(x.bot);
      const sand = num(x.sand), clay = num(x.clay), silt = num(x.silt) ?? Math.max(0, 100 - sand - clay);
      const om = num(x.om) ?? (num(x.oc) !== null ? num(x.oc) * 1.724 : null);
      omAbove = om ?? Math.min(omAbove, 1);
      const sr = S.saxtonRawls(sand, clay, omAbove) || {}, cfVol = num(x.cfVol) ?? 0, fine = 1 - Math.min(cfVol, 90) / 100;
      // an estimate that is not a finite number counts as missing
      const sv = k => (Number.isFinite(sr[k]) ? sr[k] : null), est = k => (sv(k) === null ? null : sv(k) * fine);
      const bd = num(x.bd) ?? sv("bd"), ll = num(x.ll) ?? est("ll"), dul = num(x.dul) ?? est("dul");
      let sat = num(x.sat) ?? est("sat") ?? (bd ? 1 - bd / 2.65 : null);
      if (sat !== null && dul !== null) sat = Math.max(sat, dul + 0.01);
      const mid = (top + bot) / 2;
      return { top, bot, hz: x.hz || "", sand, silt, clay, om, oc: om === null ? null : om / 1.724, bd, ll, dul, sat,
        awc: dul !== null && ll !== null ? dul - ll : null, ksat: num(x.ksat) ?? sv("ksat"), ph: num(x.ph), cec: num(x.cec),
        caco3: num(x.caco3), cfVol, cfWt: cfVol && bd ? r((100 * cfVol * 2.65) / (cfVol * 2.65 + (100 - cfVol) * bd), 1) : 0,
        ec: num(x.ec), kw: num(x.kw), srgf: bot <= 15 ? 1 : Math.exp(-0.02 * mid), ni: om === null ? null : Math.min(om / 1.724 / 10, 0.5), sar: null };
    });
    const noOm = layers.filter(l => l.om === null);
    if (noOm.length) notes.push(`No organic matter for ${noOm.length === layers.length ? "any layer" : noOm.map(l => `${l.top} to ${l.bot} cm`).join(", ")}: it stays blank where a file can leave it blank, and any water retention estimated takes at most 1 % and no more than the layer above.`);
    const slope = num(site.slope) ?? 1, hydgrp = site.hydgrp || "B", drainage = site.drainage || "Well drained", l0 = layers[0];
    return { id: site.id || "USER", name: site.name || "My soil", source: "entered by the user" + (site.note ? ` (${site.note})` : ""),
      lat: site.lat, lon: site.lon, elev: num(site.elev), slope, hydgrp, drainage, albedo: num(site.albedo) ?? 0.13,
      u: num(site.u) ?? S.slu1(l0 && S.textureClass(l0.sand, l0.silt, l0.clay)),
      // soil.js's rate for the drainage class (well drained 0.6 /day)
      drainRate: num(site.drainRate) ?? S.DRAIN?.[drainage.toLowerCase()] ?? 0.6, cn: num(site.cn) ?? S.curveNumber(hydgrp, slope),
      depth: layers.length ? layers[layers.length - 1].bot : null, texture: site.texture || "", family: site.family || "", order: "", tfact: null, layers, notes };
  }
  /* ---------- layers on chosen depths ---------- */
  const NUM_KEYS = ["sand", "silt", "clay", "om", "oc", "bd", "ll", "dul", "sat", "awc", "ksat", "ph", "cec", "caco3", "cfWt", "cfVol", "ec", "kw", "kf", "ni", "sar"];
  const fin = v => v !== null && v !== undefined && Number.isFinite(v);
  /* layers with the given bottoms (cm) from horizons H: each takes the thickness-weighted mean of the horizons it
     overlaps (harmonic mean for Ksat; organic matter, carbon, CaCO3 and N, fractions of the fine earth by mass, weighted by bulk density x thickness,
     or by thickness where no part has a bulk density) and the name list, texture and flags of the thickest; a layer that
     overlaps no horizon takes the nearest one and is marked extended */
  function relayerLayers(H, bottoms, top0 = 0) {
    const B = [...new Set(bottoms.filter(v => Number.isFinite(v) && v > top0))].sort((a, b) => a - b), out = [];
    let top = top0;
    for (const bot of B) {
      const mid = (top + bot) / 2;
      let parts = H.map(h => ({ h, w: Math.min(bot, h.bot) - Math.max(top, h.top) })).filter(p => p.w > 1e-9);
      const extended = !parts.length;
      if (extended) parts = [{ h: H.reduce((a, h) => (Math.abs((h.top + h.bot) / 2 - mid) < Math.abs((a.top + a.bot) / 2 - mid) ? h : a)), w: bot - top }];
      const dom = parts.reduce((a, p) => (p.w > a.w ? p : a)).h;
      const l = { ...dom, top, bot, hz: [...new Set(parts.map(p => p.h.hz).filter(Boolean))].join("+"), extended };
      NUM_KEYS.forEach(k => {
        let P = parts.filter(p => fin(p.h[k])), m = p => p.w;
        if ((k === "om" || k === "oc" || k === "caco3" || k === "ni") && P.some(p => fin(p.h.bd) && p.h.bd > 0)) { P = P.filter(p => fin(p.h.bd) && p.h.bd > 0); m = p => p.w * p.h.bd; }
        const w = P.reduce((a, p) => a + m(p), 0);
        l[k] = !P.length ? null : k === "ksat" ? w / P.reduce((a, p) => a + p.w / Math.max(p.h[k], 1e-6), 0) : P.reduce((a, p) => a + p.h[k] * m(p), 0) / w;
      });
      l.srgf = dom.srgf === 0 ? 0 : bot <= 15 ? 1 : Math.exp(-0.02 * mid);
      out.push(l);
      top = bot;
    }
    return out;
  }
  /* the soil on the user's layer bottoms (cm). The profile ends at the first horizon without water retention or bulk
     density (bedrock, a cemented pan), so deeper bottoms are cut there; a profile that simply stops is extended with
     its deepest horizon. */
  function relayer(soil, bottoms) {
    const all = soil.layers.filter(l => fin(l.top) && fin(l.bot) && l.bot > l.top).sort((a, b) => a.top - b.top);
    const H = [];
    for (const l of all) { if (fin(l.ll) && fin(l.dul) && fin(l.bd)) H.push(l); else if (H.length) break; }
    const B = [...new Set(bottoms.filter(v => Number.isFinite(v) && v > 0))].sort((a, b) => a - b);
    const info = { asked: B, cut: null, extendedBelow: null };
    if (!H.length || !B.length) return { ...soil, layers: [], layering: "custom", relayer: info };
    const deepest = H[H.length - 1].bot, blocked = all.indexOf(H[H.length - 1]) < all.length - 1;
    let use = B;
    if (blocked && B[B.length - 1] > deepest) { use = B.filter(v => v < deepest).concat(deepest); info.cut = deepest; }
    const layers = relayerLayers(H, use, 0);
    if (!blocked && B[B.length - 1] > deepest) info.extendedBelow = deepest;
    return { ...soil, layers, depth: layers.length ? layers[layers.length - 1].bot : null, layering: "custom", relayer: info };
  }
  const SOIL_COLS = [["top", "Top (cm)"], ["bot", "Bottom (cm)"], ["sand", "Sand (%)"], ["silt", "Silt (%)"], ["clay", "Clay (%)"], ["om", "Organic matter (%)"],
    ["bd", "Bulk density (g/cm3)"], ["ll", "Wilting point (cm3/cm3)"], ["dul", "Field capacity (cm3/cm3)"], ["sat", "Saturation (cm3/cm3)"],
    ["ksat", "Ksat (mm/h)"], ["ph", "pH (1:1 water)"], ["cec", "CEC (cmol/kg)"], ["caco3", "CaCO3 (%)"], ["cfVol", "Coarse fragments (% volume)"], ["ec", "EC (dS/m)"]];
  const soilTemplateCSV = soil => WG.export.csv(SOIL_COLS.map(c => c[1]), (soil ? soil.layers : [{ top: 0, bot: 15 }, { top: 15, bot: 30 }])
    .map(l => SOIL_COLS.map(([k]) => (l[k] === null || l[k] === undefined ? "" : typeof l[k] === "number" ? +l[k].toFixed(k === "ll" || k === "dul" || k === "sat" ? 3 : 2) : l[k]))));
  // a column header in lower case and in words ("TmaxF" reads "tmax f", "ObsDate" "obs date"), without its units and notes in brackets
  const colName = h => h.replace(/\b([A-Za-z])\.\s?(?=[A-Za-z]\b)/g, "$1").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().replace(/[([].*?[)\]]/g, " ").replace(/[^a-z0-9.]+|\.(?!\d)/g, " ").replace(/\s+/g, " ").trim();
  const inBrackets = h => (h.match(/[([].*?[)\]]/g) || []).join(" ").toLowerCase();
  /* each soil column by name: the words of the header before any bracket, run together without those that say nothing
     (units, "total", "soil" ...), must be one of these. So "Sand_pct", "Total sand" and "SandPct" are sand, but "Fine
     sand" and "Sandy" are not; "O.M." is OM; "Sat. paste EC" is EC, not saturation, and "Base saturation", "% Saturation"
     (a salinity lab's saturation percentage), "Phosphorus" and "ECEC" are none of them. "LL" is the lower limit only next
     to a DUL column; elsewhere it is the liquid limit (SSURGO ll_r). */
  const SOIL_DROP = /^(total|tot|pct|percent|perc|per|cent|cm|mm|in|inch|inches|ft|m|g|kg|cm3|m3|mg|cmol|meq|d|s|h|hr|hour|hours|day|days|sec|um|micro|ds|of|the|at|by|r|rv|soil|horizon|layer|avg|mean|average|value|val|content|weight|wt|w|v|ww|vv|gravimetric|volumetric|dry|lab|measured|basis|whole|volume|vol|water|retention)$/;
  const soilKey = h => {
    const k = colName((h.split(/[([]/)[0] || h).replace(/pH/g, "ph")).split(" ").filter(w => !SOIL_DROP.test(w)).join("").replace(/\./g, "");
    return k.replace(/(pct|percent|perc|cm|mm)$/, "") || k;
  };
  const SOIL_NAMES = {
    top: ["top", "topdepth", "depthtop", "upper", "upperdepth", "depthupper", "upperboundary", "from", "depthfrom", "hzdept"],
    bot: ["bottom", "bot", "bottomdepth", "depthbottom", "lower", "lowerdepth", "depthlower", "lowerboundary", "to", "depthto", "hzdepb"],
    sand: ["sand", "sandtotal"], silt: ["silt", "silttotal"], clay: ["clay", "claytotal"],
    om: ["organicmatter", "orgmatter", "om", "som", "loi", "lossonignition"], oc: ["organiccarbon", "organicc", "orgcarbon", "oc", "soc", "orgc", "toc"], bd: ["bulkdensity", "moistbulkdensity", "bd", "db", "sbdm", "dbthirdbar", "rhob"],
    ll: ["wiltingpoint", "wp", "pwp", "permanentwiltingpoint", "lowerlimit", "slll", "ll15", "15bar", "1500kpa", "wfifteenbar"],
    dul: ["fieldcapacity", "fc", "dul", "sdul", "drainedupperlimit", "13bar", "033bar", "33kpa", "wthirdbar"],
    sat: ["saturation", "saturated", "sat", "ssat", "thetas", "wsatiated"],
    ksat: ["ksat", "ks", "ssks", "saturatedhydraulicconductivity", "sathydraulicconductivity", "hydraulicconductivity", "sathydcond"],
    ph: ["ph", "phw", "phwater", "phh2o", "ph11", "ph12", "ph15", "ph1to1", "ph1to1h2o"], cec: ["cec", "cec7", "cecph7", "cationexchangecapacity"],
    caco3: ["caco3", "caco3e", "caco3eq", "caco3equiv", "caco3equivalent", "calciumcarbonate", "calciumcarbonateequivalent", "cce", "carbonate", "carbonates"],
    cfVol: ["coarsefragments", "coarsefragment", "rockfragments", "rockfragment", "fragments", "gravel", "cf", "fragvoltot"],
    ec: ["ec", "ece", "ecse", "ecsat", "ec11", "ec12", "ec15", "electricalconductivity", "satpasteec", "satextec", "ecsatpaste", "solublesalts", "solublesalt"],
  };
  // other measurements under the same name, by the whole header: pH in CaCl2, fragments by weight, a saturation percentage
  const SOIL_NOT = { ph: /cacl|kcl|naf|buffer|smp|bph/, cfVol: /weight|\bwt\b|mass/, ec: /ppm|mg ?\/ ?l/,
    sat: /\bbase\b/ };
  // a saturation percentage from a salinity report, unless other water columns stand beside it, where it is water by volume
  const SAT_PCT = /^(?!.*(\bvol|v ?\/ ?v|cm3|m3|water)).*((%|\bpercent|\bpct).*\bsaturation\b|\bsaturation\b.*(%|\bpercent|\bpct))/;
  /* a soil header's unit words in one spelling, so the tables below look at whole words: "Ksat (micro m/sec)" reads
     "ksat (um/s)", "OM (g kg-1)" "om (g/kg)", "cm per hour" "cm/h", "Ksat_cm_hr" "ksat cm h", "BottomIn" "bottom in",
     and abbreviations lose their dots ("in./hr." reads "in/h") */
  const unitText = h => h.replace(/([a-z])(Mm|Cm|In|Ft)$/, "$1 $2").toLowerCase().replace(/([a-z])\.(?!\d)/g, "$1 ").replace(/_/g, " ").replace(/[µμ]/g, "u").replace(/[−–]/g, "-").replace(/⁻¹/g, "-1").replace(/⁻³/g, "-3").replace(/²/g, "2").replace(/³/g, "3").replace(/\^/g, "")
    .replace(/\bmicro ?m(et(er|re)s?)?\b|\bmicrons?\b|\bmicromet(er|re)s?\b/g, "um").replace(/\bmillimet(er|re)s?\b/g, "mm").replace(/\bcentimet(er|re)s?\b/g, "cm").replace(/\bmet(er|re)s?\b/g, "m")
    .replace(/\binch(es)?\b/g, "in").replace(/\b(feet|foot)\b/g, "ft").replace(/\b(secs?|seconds?)\b/g, "s").replace(/\b(hrs?|hours?)\b/g, "h").replace(/\b(days?)\b/g, "d")
    .replace(/\b(micro ?mhos?|umhos?|micro ?siemens)\b/g, "us").replace(/\b(mmhos?|milli ?siemens)\b/g, "ms").replace(/\bmmolc?(\s?(\(\+\)|\+))?/g, "mmol")
    .replace(/\s*·\s*/g, " ").replace(/\s+per\s+/g, "/").replace(/\s*\/\s*/g, "/").replace(/([a-z]+) ([a-z0-9]+?)-1\b/g, "$1/$2").replace(/([a-z]+) ([a-z]+)-3\b/g, "$1/$23");
  const WORD = s => new RegExp(`(^|[^a-z0-9/])${s}($|[^a-z0-9/])`), RATE = (a, b) => WORD(`${a}[/ ]${b}`);
  // [unit in the header, factor to the column's own unit]: lab tables say cm/h, g/kg, inches ... Any other unit (dag/kg is %, Mg/m3 is g/cm3) needs none.
  const MASS = [[RATE("g", "kg"), 0.1], [RATE("dg", "kg"), 0.01], [RATE("mg", "kg"), 1e-4], [WORD("ppm"), 1e-4], [RATE("mg", "g"), 0.1]];
  const SOIL_UNITS = { top: [[WORD("cm"), 1], [WORD("mm"), 0.1], [WORD("m"), 100], [WORD("ft"), 30.48], [/\(\s*in\.?\s*\)|\(\s*in\.?\s+(?!situ)|\bin\.?\s*$/, 2.54]], // "in" is inches only at a bracket's start or as the last word
    sand: MASS, silt: MASS, clay: MASS, om: MASS, oc: MASS, caco3: MASS, bd: [[RATE("kg", "m3"), 0.001]],
    ksat: [["um", "s", 3.6], ["mm", "s", 3600], ["cm", "s", 36000], ["m", "s", 3.6e6], ["mm", "h", 1], ["cm", "h", 10], ["m", "h", 1000], ["in", "h", 25.4], ["ft", "h", 304.8],
      ["mm", "d", 1 / 24], ["cm", "d", 10 / 24], ["m", "d", 1000 / 24], ["in", "d", 25.4 / 24], ["ft", "d", 304.8 / 24]].map(([a, b, f]) => [RATE(a, b), f]),
    ec: [[RATE("us", "cm"), 0.001], [RATE("ms", "m"), 0.01], [RATE("s", "m"), 10]], cec: [[RATE("mmol", "kg"), 0.1], [RATE("meq", "kg"), 0.1]] };
  SOIL_UNITS.bot = SOIL_UNITS.top;
  // water contents: on the mass of dry soil, or the volume the models want
  const BY_WEIGHT = /\bweight\b|\bwt\b|w ?\/ ?w|g ?\/ ?g\b|gravimetric|\bmass\b/, BY_VOLUME = /\bvol|v ?\/ ?v|cm3|cm³|m3|m³/, SAYS_PCT = /%|\bpercent\b|\bpct\b/;
  const LAB_BAR = new Set(["15bar", "1500kpa", "13bar", "033bar", "33kpa"]); // spellings of lab reports, often by weight
  /* a lab cell's number, or null: "<0.1" is half the limit, ">200" the limit, "62%" 62; -99 and lower, 999 and 9999 are
     missing, except in a column whose unit can hold them (keep: 999 uS/cm is 0.999 dS/m) */
  const labCell = (c, keep) => {
    const t = String(c ?? "").trim(), m = t.match(/^([<>≤≥])\s*(.+)$/), n = cellNumber(m ? m[2] : t);
    if (n === null || n <= -99 || (!keep && MISSING_CODE.test(t))) return null;
    return m && /[<≤]/.test(m[1]) ? n / 2 : n;
  };
  // the unit or flag written after a cell's number ("6 in", "40°F", "62%"), or ""; a number as it stands ("3.5E-06") has none
  const cellSuffix = c => { const t = String(c ?? "").trim().replace(/^[<>≤≥]\s*/, ""), m = Number.isFinite(+t) ? null : t.match(NUM_CELL); return m ? t.slice(m[1].length).trim() : ""; };
  /* rows of strings or numbers in the units of the editor; rows.notes says what was read in a way worth saying */
  function parseSoilCSV(text) {
    const needed = keys => ["bot", "sand", "clay"].every(k => keys.some(x => SOIL_NAMES[k].includes(x)));
    const rows = rowsWith(text, R => R.slice(0, 30).some(x => needed(x.map(soilKey))));
    if (rows.length < 2) throw new Error("The soil file needs a header row and at least one layer.");
    const hi = Math.max(0, rows.slice(0, 30).findIndex(x => needed(x.map(soilKey)))), head = rows[hi], keys = head.map(soilKey), low = head.map(h => h.toLowerCase().replace(/_/g, " "));
    const idx = {}, taken = new Set(), find = (k, names) => keys.findIndex((x, i) => names.includes(x) && !taken.has(i) && !(SOIL_NOT[k] && SOIL_NOT[k].test(low[i])) && !(k === "sat" && idx.ll < 0 && idx.dul < 0 && SAT_PCT.test(low[i])));
    Object.keys(SOIL_NAMES).forEach(k => { idx[k] = find(k, SOIL_NAMES[k]); if (idx[k] >= 0) taken.add(idx[k]); });
    if (idx.ll < 0 && keys.some(x => x === "dul" || x === "sdul")) { idx.ll = find("ll", ["ll"]); if (idx.ll >= 0) taken.add(idx.ll); }
    if (idx.bot < 0 || idx.sand < 0 || idx.clay < 0) throw new Error("Columns needed: Bottom (cm), Sand (%), Clay (%) — download the template to see the layout.");
    const body = rows.slice(hi + 1).filter(x => x.some(c => c.trim() !== "")), notes = [];
    // a row of units under the header holds no number
    const unitRow = body[0] && body[0].every(c => labCell(c) === null) ? body.shift() : null;
    if (!body.length) throw new Error("The soil file needs a header row and at least one layer.");
    // a unit written in the cells ("6 in") is the column's; a mix of them cannot be read in one. A lab's flag of a letter or
    // two ("1.2 J", "0.8 B", "<0.5 U") that is no unit of the column is left off.
    const flag = (k, s) => /^([a-z]{1,2}\*?|\*+)$/.test(s) && !(SOIL_UNITS[k] || []).some(([re]) => re.test(unitText(`(${s})`)));
    const keyAt = i => Object.keys(SOIL_NAMES).find(k => idx[k] === i);
    const suffixes = i => [...new Set(body.map(x => cellSuffix(x[i])).filter(Boolean).map(s => s.toLowerCase()).filter(s => s !== "%" && !flag(keyAt(i), s)))];
    Object.keys(SOIL_UNITS).filter(k => idx[k] >= 0).forEach(k => { const s = suffixes(idx[k]); if (s.length > 1) throw new Error(`"${head[idx[k]]}" mixes units (${s.slice(0, 3).join(", ")}): give the column in one.`); });
    const flagged = Object.keys(SOIL_NAMES).filter(k => idx[k] >= 0 && body.some(x => { const s = cellSuffix(x[idx[k]]).toLowerCase(); return s && flag(k, s); }));
    if (flagged.length) notes.push(`Lab flags after the numbers (as "1.2 J") were left off: ${flagged.map(k => head[idx[k]]).join(", ")}.`);
    const unit = head.map((h, i) => { const s = suffixes(i)[0], given = unitRow && unitRow[i] ? unitRow[i] : s; return unitText(given ? `${h} (${given})` : h); });
    const col = k => (idx[k] < 0 ? [] : body.map(x => labCell(x[idx[k]], f[k] !== 1)).filter(v => v !== null));
    const factor = k => {
      if (idx[k] < 0) return 1;
      if ((k === "top" || k === "bot") && /inch/i.test(unit[idx[k]]) | /inch/i.test(head[idx[k]])) return 2.54; // spelled out, it is never anything else
      const hit = (SOIL_UNITS[k] || []).find(([re]) => re.test(unit[idx[k]]));
      if (hit) return hit[1];
      if (k === "ksat" && /^ksat r$/.test(low[idx[k]])) return 3.6; // SSURGO's ksat_r is in micrometres per second
      return k === "ksat" && keys[idx[k]] === "ssks" ? 10 : 1; // DSSAT's SSKS is in cm/h
    };
    const f = Object.fromEntries(Object.keys(SOIL_NAMES).map(k => [k, factor(k)]));
    // a unit on one depth column holds for the other, which does not say cm: "Top, Bottom (in)"
    [["top", "bot"], ["bot", "top"]].forEach(([k, o]) => { if (idx[k] >= 0 && idx[o] >= 0 && f[k] === 1 && f[o] !== 1 && !/\bcm\b/.test(unit[idx[k]])) f[k] = f[o]; });
    // water contents: percent if the name says so (SSURGO's are percent); a value above 1 can only be percent, and then so are the columns that do not say otherwise
    const WATER = ["ll", "dul", "sat"].filter(k => idx[k] >= 0), lowOf = k => `${low[idx[k]]} ${unitRow ? (unitRow[idx[k]] || "").toLowerCase() : ""}`;
    const ssurgo = k => /^w(fifteenbar|thirdbar|satiated)/.test(keys[idx[k]]), above1 = k => col(k).some(v => v > 1);
    const stated = WATER.filter(k => SAYS_PCT.test(lowOf(k)) || ssurgo(k));
    // sand and clay of at most 1 can only be fractions
    const ss = col("sand").concat(col("clay")), sandFrac = ss.length && ss.every(v => v <= 1) && ss.some(v => v > 0);
    // a column at most 1 beside percent ones may be percent too only if as fractions it would break wilting point < field capacity
    // < saturation (sand: WP 0.9, FC 6). Then each such column is read the way nearer the Saxton & Rawls estimate from the layer's
    // sand and clay: a percent taken for a fraction is 100 times off, so one layer with WP = FC does not make 0.12 into 0.0012.
    const inOrder = pct => body.every(x => { const a = WATER.map(k => { const n = labCell(x[idx[k]]); return n === null ? null : pct.includes(k) ? n / 100 : n; }).filter(v => v !== null); return a.every((v, i) => !i || v > a[i - 1]); });
    const sure = WATER.filter(k => !stated.includes(k) && above1(k)), rest = WATER.filter(k => !stated.includes(k) && !sure.includes(k) && !/cm3|cm³|m3|m³|g ?\/ ?g|fraction/.test(lowOf(k)));
    const pctOf = (x, k) => { const v = idx[k] >= 0 ? labCell(x[idx[k]]) : null; return v === null ? null : v * f[k] * (sandFrac && f[k] === 1 && k !== "om" ? 100 : 1); };
    const est = body.map(x => S.saxtonRawls(pctOf(x, "sand"), pctOf(x, "clay"), pctOf(x, "om")));
    const off = pct => body.reduce((a, x, r) => a + (!est[r] ? 0 : rest.reduce((b, k) => { const n = labCell(x[idx[k]]); return n === null || n <= 0 ? b : b + Math.abs(Math.log((pct.includes(k) ? n / 100 : n) / est[r][k])); }, 0)), 0);
    const known = [...stated, ...sure], ways = rest.reduce((W, k) => W.concat(W.map(s => [...s, k])), [[]]); // fewest columns first, so a tie stays fractions
    const pick = !est.some(Boolean) ? rest : ways.reduce((best, s) => (off(s) < off(best) ? s : best), []);
    const guessed = [...sure, ...(known.length && rest.length && !inOrder(known) ? pick : [])];
    stated.concat(guessed).forEach(k => { f[k] = 0.01; });
    if (guessed.length) notes.push(`Read as percent and divided by 100: ${guessed.map(k => head[idx[k]]).join(", ")}.`);
    const tiny = stated.filter(k => !ssurgo(k) && col(k).length && col(k).every(v => v < 1));
    if (tiny.length) notes.push(`${tiny.map(k => head[idx[k]]).join(", ")}: under 1 on every layer, read as percent as the name says. If these are fractions, take the % out of the name.`);
    const byWeight = WATER.filter(k => BY_WEIGHT.test(lowOf(k)) && !BY_VOLUME.test(lowOf(k)));
    if (byWeight.length) notes.push(`By weight, so multiplied by each layer's bulk density (its own, else estimated): ${byWeight.map(k => head[idx[k]]).join(", ")}.`);
    const bare = WATER.filter(k => LAB_BAR.has(keys[idx[k]]) && !byWeight.includes(k) && !BY_VOLUME.test(lowOf(k)));
    if (bare.length) notes.push(`${bare.map(k => head[idx[k]]).join(", ")}: taken as water by volume. If the lab gives it by weight, say so in the name ("15 bar (% by weight)") to have it multiplied by bulk density.`);
    if (sandFrac) ["sand", "silt", "clay"].forEach(k => { if (f[k] === 1) f[k] = 100; }), notes.push("Sand and clay are all 1 or less, so they were read as fractions and multiplied by 100.");
    const moved = Object.keys(f).filter(k => f[k] !== 1 && !["ll", "dul", "sat"].includes(k) && !(f[k] === 100 && ["sand", "silt", "clay"].includes(k)));
    if (moved.length) notes.push(`Converted from the units in their names: ${moved.map(k => head[idx[k]]).join(", ")}.`);
    if (unitRow && moved.length) notes.push("Those units come from the row under the header.");
    const censored = new Set(), coded = new Set();
    const out = body.map((x, r) => {
      const v = k => {
        const c = idx[k] >= 0 ? x[idx[k]] ?? "" : "", n = labCell(c, f[k] !== 1);
        if (n === null && MISSING_CODE.test(String(c).trim())) coded.add(head[idx[k]]);
        if (n === null) return MISSING_CODE.test(String(c).trim()) || num(c) !== null ? "" : c;
        if (/^[<>≤≥]/.test(String(c).trim())) censored.add(head[idx[k]]);
        return f[k] !== 1 ? +(n * f[k]).toFixed(6) : num(c) === n ? c : n;
      };
      const row = Object.fromEntries(SOIL_COLS.map(([k]) => [k, v(k)]));
      const oc = num(v("oc"));
      if (num(row.om) === null && oc !== null) row.om = +(oc * 1.724).toFixed(3);
      const sa = num(row.sand), cl = num(row.clay);
      if (sa !== null && cl !== null && (sa < 0 || cl < 0 || sa + cl > 101)) throw new Error(`Layer ${r + 1}: sand ${sa} % and clay ${cl} % do not fit. Give them in percent, or say g/kg in the header.`);
      if (byWeight.length) {
        const bd = num(row.bd) ?? (sa !== null && cl !== null ? (S.saxtonRawls(sa, cl, num(row.om) ?? 1) || {}).bd : null);
        byWeight.forEach(k => { const w = num(row[k]); if (w !== null && bd) row[k] = +(w * bd).toFixed(4); });
      }
      const bad = outOfRange(row);
      if (bad) { const [, , , un] = SOIL_RANGE[bad], h = head[idx[bad] >= 0 ? idx[bad] : idx.oc]; throw new Error(`Layer ${r + 1}: "${h}" reads as ${num(row[bad])} ${un}, which no soil has. Say its unit in the column name, or give it in ${un}.`); }
      return row;
    });
    if (censored.size) notes.push(`Values marked < are read as half the limit and those marked > as the limit: ${[...censored].join(", ")}.`);
    if (coded.size) notes.push(`A code such as 999 or 9999 is read as missing in ${[...coded].join(", ")}.`);
    const whole = out.filter(x => num(x.bot) !== null && num(x.sand) !== null && num(x.clay) !== null).sort((a, b) => num(a.bot) - num(b.bot));
    // one profile: two fields or samples in one table would make layers that overlap
    const fault = depthFault(whole);
    if (fault) {
      const id = head.findIndex((h, i) => h && !taken.has(i) && new Set(body.map(x => x[i])).size > 1 && new Set(body.map(x => x[i])).size < body.length);
      throw new Error(`The file does not make one profile: ${fault}.${id >= 0 ? ` "${head[id]}" holds ${[...new Set(body.map(x => x[id]))].slice(0, 4).join(", ")}.` : ""} Keep the rows of one field or sample.`);
    }
    notes.push(...depthGaps(whole));
    const short = out.filter(x => !whole.includes(x)).map(x => (num(x.bot) !== null ? `down to ${num(x.bot)} cm` : num(x.top) !== null ? `from ${num(x.top)} cm` : "without depths"));
    if (short.length) notes.push(`No sand, clay or bottom: the layer${short.length === 1 ? "" : "s"} ${short.slice(0, 4).join(", ")}. Fill in or remove: such a layer stops the download when layers lie below it, and is left out when none do.`);
    const noOm = whole.filter(x => num(x.om) === null).length;
    if (noOm) notes.push(`No organic matter on ${noOm === whole.length ? "any layer" : `${noOm} of ${whole.length} layers`}: left blank where a file can do without, and water retention estimates take at most 1 % and no more than the layer above.`);
    if (idx.om < 0 && idx.oc >= 0) notes.push(`Organic matter comes from ${head[idx.oc]}, × 1.724.`);
    const unused = head.filter((h, i) => h && !taken.has(i));
    if (unused.length) notes.push(`Not used: ${unused.join(", ")}.`);
    out.notes = notes;
    return out;
  }

  /* ---------- weather from a file ---------- */
  /* a cell's number, also with a unit or flag after it ("62%", "0.05s", "12 mm"), or null. MISSING_CODE: the codes above any
     value (999, 999.9, 9999, 6999), as -99 and lower are below any. */
  const NUM_CELL = /^([-+]?(?:\d+\.?\d*|\.\d+))\s*[%°*a-zµ][a-z0-9/²³^.*-]*$/i, MISSING_CODE = /^\+?(9{3,}(\.9*)?|6999(\.0*)?)$/;
  const cellNumber = c => {
    const t = (c || "").trim();
    if (t === "") return null;
    if (Number.isFinite(+t)) return +t;
    const m = t.match(NUM_CELL);
    return m ? +m[1] : null;
  };
  /* durations in a header: a day's says nothing ("Precip 24 Hour Total" is the day's rain); a shorter one makes the
     column a second choice ("Rain_60min" gives way to "Rain") */
  const DAY_SPAN = /\b(24 ?(hours?|hrs?|h)|hrs? ?24|1 ?days?|1 ?d|1440 ?(minutes?|mins?))\b/g, SHORT_SPAN = /\b\d+ ?(minutes?|mins?|hours?|hrs?|h)\b/g;
  /* a header's name for matching, with a lone extreme or mean in brackets kept ("Temp (max)", but not "Wind (min 0.5 m/s)") */
  const wxName = h => {
    const m = h.match(/[([]\s*(max|maximum|high|min|minimum|low|mean|avg|average)\s*[,;)\]]/i);
    return `${colName(h)}${m ? ` ${m[1].toLowerCase()}` : ""}`.trim().replace(DAY_SPAN, " ").replace(/\s+/g, " ").trim();
  };
  const WX_ALIASES = {
    year: ["year", "yr", "yyyy"], doy: ["doy", "jday", "julian", "julian day", "jul", "yday", "dayofyear", "day of year"], month: ["month", "mo", "mon", "mm"], dom: ["dom", "dd", "dy", "day of month"],
    prcp: ["prcp", "precip", "precipitation", "prec", "rain", "rainfall", "ppt", "pcp", "pr", "pp", "tp"],
    tmax: ["tmax", "tmx", "tx", "tx2m", "tempmax", "mx", "mx2t", "high", "hi", "max temp", "maximum temperature", "t max", "maxt", "max t", "t2m max"],
    tmin: ["tmin", "tmn", "tn", "tn2m", "tempmin", "mn", "mn2t", "low", "lo", "min temp", "minimum temperature", "t min", "mint", "min t", "t2m min"],
    srad: ["srad", "solar", "radiation", "rs", "rad", "slr", "radn", "sr", "ssrd", "atot", "allsky sfc sw dwn"],
    rh: ["rh", "rhum", "r h", "rel hum", "relative humidity", "humidity", "rhmean", "rh mean", "rh2m", "havg"], rhmax: ["rhmax", "rh max", "max rh", "hmax"], rhmin: ["rhmin", "rh min", "min rh", "hmin"],
    tdew: ["tdew", "dewpoint", "dew point", "dewp", "dew pt", "td", "tdp", "t2mdew", "d2m"],
    wind: ["wind", "wind speed", "ws", "u", "u2", "u10", "u2m", "windspeed", "wnd", "wspd", "awnd", "ua", "ws2m", "ws10m"],
    et0: ["et0", "eto", "etos", "et o", "et 0", "reference et", "ref et", "refet"],
  };
  // a word of each list anywhere in the name, in either order
  const both = (a, b) => new RegExp(`\\b(${a})\\b.*\\b(${b})\\b|\\b(${b})\\b.*\\b(${a})\\b`);
  const HI = "max|maximum|mx|high|highest|hi", LO = "min|minimum|mn|low|lowest|lo", AIR = "t|ta|tc|tf|temp|temps|temperature|tmp|air|airt|airtc|airtf|airtemp|tair|t2m|t2";
  const HUM = "rh|rhum|hum|humid|humidity", WIND = "wind|wnd|ws|wspd|windspd|windspeed|speed|ws2m|ws10m", MEAN = "avg|mean|average|ave";
  /* the patterns of a quantity, on the name: "AirTC_Max" and "Max T" are Tmax, also run together ("TmaxF", "MaxT2m") */
  const WX_PAT = {
    prcp: [/\brain|prec(ip|tot)|\bprcp|\bppt|\bpcp|\bp daily\b/], srad: [/\brad|\bsrad|solar|\bslr|short ?wave|\bsw\b|irradiance|pyrano|\bmj\b/],
    tmax: [both(AIR, HI), /\bt(a|air|2m|2)?(max|mx)|\b(max(imum)?|mx)(2m?)?(t|ta|tair|airt|air|temp|temperature|tmp)(f|c|2m|2)?\b|\b(hi|high)(temp|tmp|air)/],
    tmin: [both(AIR, LO), /\bt(a|air|2m|2)?(min(?!ute)|mn)|\b(min(imum)?|mn)(2m?)?(t|ta|tair|airt|air|temp|temperature|tmp)(f|c|2m|2)?\b|\b(lo|low)(temp|tmp|air)/],
    tdew: [/dew|\btdp?\b/], rhmax: [both(HUM, HI), /\brh ?max|\bmax ?rh/], rhmin: [both(HUM, LO), /\brh ?min|\bmin ?rh/], rh: [/\brh|humid|\brel ?hum|\bhum\b/],
    wind: [/\bwind|\bwnd\b|\bws(\d|\b)|\bwsd\b|\bwsp|\bu2\b|\bu10\b|\bu2m\b|\bawnd\b/, both(WIND, MEAN)],
    et0: [/\bet ?(0|o|os)\b|\bet0|\beto\b|\betos\b|\bref(erence)?\b.*\b(et|evapotranspiration)\b|\bgrass ref/],
  };
  const MEAN_WIND = both(WIND, MEAN);
  /* other measurements under those words, by the name (not by notes in brackets, as "Tmax (data logger)" and "Rain (since
     9 am)" are fine): battery, panel, soil and other temperatures; rain rates, intensities and other periods; net, clear-
     sky and other radiation; wind directions, gusts and extremes; alfalfa-reference, pan or potential ET */
  const NOT_AIR = /batt|volt|panel|\bp ?temp|logger|soil|water|skin|surface|\bsur\b|leaf|canopy|dew|wet|chill|heat|feel|apparent|index|press|humid|\bhum\b|\brh\b|speed|wind|solar|\brad|rain|\bin ?temp|indoor|inside|enclosure|climo|normal|record|depart|forecast|\bqc\b|flag/;
  const WX_NOT = {
    prcp: /rate\b|\bmax|maximum|peak|\bduration|\bdur\b|hour|\bhrs?\b|type|prob|chance|intens|freq|\bdays\b|count|flag|\bqc\b|normal|depart|climo|\btemp|event|storm|week|month|year|annual|season|ytd|forecast|snow/,
    srad: /\bnet\b|long|\blw\b|clear|\bclr|rso|\bmax|maximum|\bmin\b|minimum|peak|\bhi\b|high|\bpar\b|ppfd|\buv|reflect|albedo|diffuse|direct|extra|\btoa\b|\btemp|volt|panel|batt|charg|solar ?v\b|dose|index|radar|radius|radio|\bqc\b|flag|hours?\b|duration/,
    tmax: NOT_AIR, tmin: NOT_AIR, tdew: /\bmax|maximum|\bmin\b|minimum|high|low|depress|deficit|\bin\b|indoor|inside|\bqc\b|flag/,
    rhmax: /spec|abs|\bin\b|indoor|inside|\bqc\b|flag/, rhmin: /spec|abs|\bin\b|indoor|inside|\bqc\b|flag/, rh: /spec|abs|\bmax|maximum|\bmin\b|minimum|high|low|\bin\b|indoor|inside|\bqc\b|flag/,
    wind: /\bdir\b|direction|winddir|drct|gust|\bmax|maximum|\bmin\b|minimum|peak|\brun\b|\bsd\b|\bstd|\bdev\b|\bhi\b|high|\bwsf|\brange\b|chill|fastest|sustain|window|index|power|energy|\bqc\b|flag/,
    et0: /\betr|alfalfa|tall|\bpan\b|\bpet\b|potential|\betc\b|\beta\b|actual|\bkc\b|\bqc\b|flag/,
  };
  // the few notes in brackets that do change what a column is ("Temp Max (soil)", "Reference ET (tall)")
  const NOT_AIR_NOTE = /soil|panel|batt|water temp|indoor|wet.?bulb/, WX_NOTE_NOT = { tmax: NOT_AIR_NOTE, tmin: NOT_AIR_NOTE, wind: /fastest|gust|peak|sustain/, et0: /tall|alfalfa|\betr|\brs\b/ };
  const WHEN = /\btime\b|.\btm[xn]\b/; // the time of a maximum or minimum ("Time of max temp", "WS_ms_TMx")
  // a name that may hold the date; which column does is seen from the rows (dateLayout)
  const DATE_NAMES = ["date", "datetime", "date time", "timestamp", "yyyymmdd", "valid", "day", "time"];
  const DATE_LIKE = /date|time|stamp|period|\bday\b|\bdatum\b|\bfecha\b|\bdia\b/, NOT_DATE = /\bmax|maximum|\bmin\b|minimum|\btm[xn]\b|gust|peak|high|low|\bsun|duration|update/;
  /* the columns a header row names (index, or -1) and how sure each is: an exact name 4, a mean wind speed 3.5, a pattern
     3; two less for a column that may not be the day's value (a shorter duration, an accumulation). The best rank wins
     and then the first column, each column used once. dates: the columns named like a date; others: the rest. cover (a
     column's count of days with a value), when given: a column with under a fifth of the days of another for the same
     quantity gives way to it (NCEI LCD's AWND is on month-ends only, DailyAverageWindSpeed on every day), but rain is often
     blank on dry days, so its column gives way only if it holds nothing. */
  function wxColumns(row, cover) {
    const head = row.map(wxName), notes = row.map(inBrackets), C = { rank: {} }, cand = [], Q = Object.keys(WX_ALIASES);
    Q.forEach(k => head.forEach((h, i) => {
      if (!h) return;
      const bare = h.replace(SHORT_SPAN, " ").replace(/\s+/g, " ").trim();
      if ((WX_NOT[k] && WX_NOT[k].test(bare)) || (WX_NOTE_NOT[k] && WX_NOTE_NOT[k].test(notes[i])) || WHEN.test(bare)) return;
      const exact = WX_ALIASES[k].includes(bare);
      if (!exact && !(WX_PAT[k] && WX_PAT[k].some(re => re.test(bare)))) return;
      const doubt = bare !== h || (k === "prcp" && /accum|cumul|since/.test(bare));
      cand.push([(exact ? 4 : k === "wind" && MEAN_WIND.test(bare) ? 3.5 : 3) - (doubt ? 2 : 0), i, k]);
    }));
    cand.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    C.cand = cand;
    const most = {};
    if (cover) cand.forEach(([, i, k]) => { most[k] = Math.max(most[k] || 0, cover(i)); });
    const used = new Set();
    cand.filter(([, i, k]) => !cover || (k === "prcp" ? cover(i) > 0 || !most[k] : cover(i) * 5 >= most[k])).forEach(([r, i, k]) => { if (C[k] === undefined && !used.has(i)) { C[k] = i; C.rank[k] = r; used.add(i); } });
    Q.forEach(k => { if (C[k] === undefined) C[k] = -1; });
    const named = DATE_NAMES.flatMap(n => head.flatMap((h, i) => (h === n ? [i] : [])));
    const like = head.flatMap((h, i) => (DATE_LIKE.test(h) && !NOT_DATE.test(h) ? [i] : []));
    C.dates = [...new Set(named.concat(like))].filter(i => !used.has(i));
    C.others = head.flatMap((_, i) => (used.has(i) || C.dates.includes(i) ? [] : [i]));
    C.day = head.findIndex((h, i) => h === "day" && !used.has(i));
    return C;
  }
  // the day of YYYY-MM-DD, YYYYMMDD (a time may follow, also run on: YYYYMMDDHHMM) or M/D/YYYY or M/D/YY (D/M/YYYY in a
  // file that needs it; 00 to 68 are 20xx, 69 to 99 19xx), of year, month, day, or of year and day of year; null if that is not a real day
  const calDay = (y, mo, d) => (y >= 1800 && y <= 2200 && mo >= 1 && mo <= 12 && d >= 1 && new Date(Date.UTC(y, mo - 1, d)).getUTCMonth() === mo - 1 ? Wd.epochDay(y, mo - 1, d) : null);
  const yearDay = (y, j) => (y >= 1800 && y <= 2200 && j >= 1 && new Date(Date.UTC(y, 0, j)).getUTCFullYear() === y ? Wd.epochDay(y, 0, j) : null);
  const US_DATE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?!\d)/, US_DATE_YY = /^(\d{1,2})[/.](\d{1,2})[/.](\d{2})(?![\d/.:-])/;
  const usDate = t => { const m = t.match(US_DATE), s = m ? null : t.match(US_DATE_YY); return m ? [+m[1], +m[2], +m[3]] : s ? [+s[1], +s[2], +s[3] + (+s[3] < 69 ? 2000 : 1900)] : null; };
  function fullDate(s, dayFirst) {
    const t = s || "", m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/) || t.match(/^(\d{4})(\d{2})(\d{2})(\d{2}){0,3}(?!\d)/);
    if (m) return calDay(+m[1], +m[2], +m[3]);
    const u = usDate(t);
    return !u ? null : dayFirst ? calDay(u[2], u[1], u[0]) : calDay(u[2], u[0], u[1]);
  }
  const int = s => (/^\d{1,4}(\.0*)?$/.test(s || "") ? +s : null);
  /* how the rows under the header give the day, judged on the first of them: a column of full dates first, in the order
     of C.dates ("Day" holds the dates when "Time" holds clock times), else year, month and day, else year and day of
     the year, else any other column of full dates; a way counts when it gives a real day in at least half the rows that
     fill its columns. Dates read D/M/YYYY when some first number in the column is above 12. */
  function dateLayout(C, sample, all) {
    // "day" is the day of the month in a file with a month column, else the day of the year
    const dom = C.dom >= 0 ? C.dom : C.day, doy = C.doy >= 0 ? C.doy : C.month < 0 ? C.day : -1;
    const dated = i => {
      const dayFirst = all.some(x => { const u = usDate(x[i] || ""); return u && u[0] > 12; });
      // the last number of a 2-digit date running faster than the others (changing from row to row more often; a long
      // record's years can outnumber the days of a month) is a day, so this is YY/MM/DD: not a layout that can be told from D/M/YY in general, so not read
      const yy = all.map(x => (x[i] || "").match(US_DATE_YY)).filter(Boolean), kinds = n => new Set(yy.map(m => m[n])).size, runs = n => yy.filter((m, j) => j && m[n] !== yy[j - 1][n]).length;
      if (kinds(3) >= 3 && runs(3) > runs(1) && runs(3) > runs(2)) return { cols: { date: i }, dayFirst, day: () => null };
      return { cols: { date: i }, dayFirst, day: x => fullDate(x[i], dayFirst) };
    };
    const ways = C.dates.map(dated);
    if (C.year >= 0 && C.month >= 0 && dom >= 0) ways.push({ cols: { year: C.year, month: C.month, dom }, day: x => calDay(int(x[C.year]), int(x[C.month]), int(x[dom])) });
    if (C.year >= 0 && doy >= 0) ways.push({ cols: { year: C.year, doy }, day: x => yearDay(int(x[C.year]), int(x[doy])) });
    ways.push(...C.others.map(dated));
    return ways.find(w => {
      const filled = sample.filter(x => Object.values(w.cols).some(i => (x[i] || "") !== "")), good = filled.filter(x => w.day(x) !== null).length;
      return good > 0 && 2 * good >= filled.length;
    }) || null;
  }
  /* the file's delimiter: of tab, semicolon and comma the one that makes the same number of columns on the most of the
     first lines (quotes and # lines aside), then the one that makes more columns, then tab and semicolon, so one line
     with many semicolons (Daymet's "How to cite") or a semicolon inside a comma file does not decide it */
  function delimiter(text) {
    const lines = text.split(/\r?\n/, 100).filter(l => l.trim() && !/^\ufeff?#/.test(l)).map(l => l.replace(/"[^"]*"/g, "x"));
    const score = d => {
      const n = new Map();
      lines.forEach(l => { const c = l.split(d).length; if (c > 1) n.set(c, (n.get(c) || 0) + 1); });
      return [...n].reduce((a, [c, k]) => (k > a[0] || (k === a[0] && c > a[1]) ? [k, c] : a), [0, 1]);
    };
    return ["\t", ";", ","].reduce((a, d) => { const p = score(a), q = score(d); return q[0] > p[0] || (q[0] === p[0] && q[1] > p[1]) ? d : a; });
  }
  // raw: keep each cell's spaces and decimal comma
  function csvRows(text, raw, sep = delimiter(text)) {
    const out = [];
    let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; continue; }
      if (c === '"' && cell.trim() === "" && text.indexOf('"', i + 1) >= 0) q = true; // a quote opens only at a cell's start: 'gauge 8" overflowed' is text
      else if (c === sep) { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); out.push(row); row = []; cell = ""; }
      else cell += c;
    }
    if (cell !== "" || row.length) { row.push(cell); out.push(row); }
    // a decimal comma, where the comma is not the delimiter
    const dec = s => (sep !== "," && /^-?\d+,\d+$/.test(s) ? s.replace(",", ".") : s);
    return out.map(x => x.map(s => (raw ? s : dec(s.replace(/^\ufeff/, "").trim())))).filter(x => x.length && !(x.length === 1 && x[0] === "") && !/^#/.test(x[0]));
  }
  // the rows by the likeliest delimiter, or by the other ones when only they give a header row: title lines can outnumber a short table's
  function rowsWith(text, fits) {
    const best = delimiter(text), R = csvRows(text, false, best);
    if (fits(R)) return Object.assign(R, { sep: best });
    for (const d of ["\t", ";", ","].filter(x => x !== best)) { const T = csvRows(text, false, d); if (fits(T)) return Object.assign(T, { sep: d }); }
    return Object.assign(R, { sep: best });
  }
  /* the unit a column's name states, for each kind of column, or null: "tmax (F)", "Rain_mm_Tot", "SlrW_Avg", "WS_ms_Avg" */
  const unitWords = h => ` ${h.replace(/kW(?![a-z])/g, " kW").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().replace(/[^a-z0-9.]+|\.(?!\d)/g, " ").replace(/\s+/g, " ").trim()} `;
  const HEAD_UNITS = {
    temp: [["F", /\s(f|degf|fahrenheit|tf)\s|\st(max|min|mx|mn|dew|mean|avg)f\s/], ["C", /\s(c|degc|celsius|tc)\s|\st(max|min|mx|mn|dew|mean|avg)c\s/], ["K", /\s(k|kelvin)\s/]],
    rain: [["mm", /\s(mm|millimet\w*)\s/], ["cm", /\s(cm|centimet\w*)\s/], ["in", /\s(inch|inches)\s|\sin\s(tot\s|total\s)?$/]],
    srad: [["MJ", /\smj\s/], ["kWh", /\sk\s?w\s?(h|hr|hrs|hour|hours)\s/], ["Wh", /\sw\s?(h|hr|hrs|hour|hours)\s/], ["kJ", /k\s?j\s/], ["J", /\sj\s/], ["kW", /\sk\s?w\s/], ["W", /\s(w|watt|watts)\s/], ["ly", /\s(ly|lys|langleys?|cal)\s/]],
    wind: [["ms", /\s(ms|m\ss|mps|m\ssec|met(er|re)s?\s(per\s)?sec\w*)\s/], ["mph", /\s(mph|mi\sh|miles?\s(per\s)?(h|hr|hour))\s/], ["kmh", /\s(kmh|km\sh|kph|kilomet\w*)\s/], ["kn", /\s(kn|kt|kts|knots?)\s/]],
  };
  const statedUnit = (kind, h) => {
    const t = unitWords(h), hit = HEAD_UNITS[kind].find(([, re]) => re.test(t));
    return hit ? hit[0] : kind === "rain" && /[([]\s*in\b/i.test(h) ? "in" : null;
  };
  // the height of a wind column by its name, in metres, or null: "wind at 3 m", "WS10M", "wind_speed_10m_mean", "u2"
  function statedHeight(h) {
    const t = h.toLowerCase().replace(/_/g, " "), m = t.match(/(\d+(?:\.\d+)?)\s*-?\s*m(?:et(?:er|re)s?)?\b(?!\s*\/)/) || t.match(/\b(?:ws|u|wind)\s?(\d+)\b/), z = m ? +m[1] : null;
    return z >= 0.5 && z <= 50 ? z : null;
  }
  // a power (W/m², kW/m²: Campbell's SlrkW) is the day's mean, so rows through the day average; an energy adds up
  const SOLAR_MJ = { W: 0.0864, kW: 86.4, ly: 0.04184, kWh: 3.6, Wh: 0.0036, kJ: 0.001, J: 1e-6, MJ: 1 }, POWER = new Set(["W", "kW"]), WIND_MS = { ms: 1, mph: 0.44704, kmh: 1 / 3.6, kn: 0.514444 };
  /* what a station can report, in the reader's units (m/s for wind as measured): outside it a cell is a gap, to be filled
     and counted as one. Rain, solar radiation and ET0 are held to theirs by the day, as rows through the day have their
     parts (a pyranometer reads a little below 0 at night), but rain is never negative. */
  const WX_LIMITS = { tmax: [-60, 60], tmin: [-60, 60], tdew: [-60, 60], srad: [0.1, 50], prcp: [0, 1900], rh: [0, 105], rhmax: [0, 105], rhmin: [0, 105], wind: [0, 75], et0: [0, 50] };
  const BY_DAY = new Set(["prcp", "srad", "et0"]);
  const OUT_TEXT = { tmax: "Tmax outside -60 to 60 °C", tmin: "Tmin outside -60 to 60 °C", tdew: "dew point outside -60 to 60 °C", srad: "solar radiation below 0.1 or above 50 MJ/m² a day", prcp: "rain below 0 or above 1,900 mm a day",
    rh: "humidity of 0 or below, or above 105 %", rhmax: "RHmax of 0 or below, or above 105 %", rhmin: "RHmin of 0 or below, or above 105 %", wind: "wind below 0 or above 75 m/s", et0: "ET0 below 0 or above 50 mm a day", zero: "Tmax = Tmin = 0",
    zeros: "a row of zeros in every column", frac: "humidity above 1 in a column given as a fraction" };
  const STATION_NAME = /^(station|stn|stid|site|station id|stn id|station name|stn name|site name|wbanno|name)$/, CLOCK_NAME = /^(hour|hr|hh|hhmm|hhmmss|hrmn|minute)$/;
  const sumOf = a => a.reduce((x, y) => x + y, 0), meanOf = a => sumOf(a) / a.length;
  // GHCN's own daily CSV (NCEI "access"): TMAX "  333" is 33.3 °C, PRCP tenths of mm, AWND tenths of m/s, padded with spaces; re-saved, no °F or °C reads above 134
  function ghcnTenths(text, rows, hi, i) {
    const head = rows[hi];
    if (i < 0 || head[i] !== "TMAX" || !head.includes("TMAX_ATTRIBUTES")) return false;
    const cells = rows.slice(hi + 1).map(x => x[i] || "").filter(Boolean);
    return csvRows(text.slice(0, 2e5), true, rows.sep).slice(hi + 1, hi + 50).some(x => /^\s+-?\d+$/.test(x[i] || "")) || (cells.every(c => /^-?\d+$/.test(c)) && cells.some(c => Math.abs(+c) > 134 && +c > -700 && !MISSING_CODE.test(c)));
  }
  /* columns by name, each in the unit its name or the row under the header states, else in u: { temp: "C"|"F"|"K", prcp: "mm"|"in"|"cm", srad: "MJ"|"W"|"ly"|"kWh"|"kJ", wind: "ms"|"mph"|"kmh"|"kn",
     windHeight: m }. The result's units say what each column was read in. ET0 is read only from a grass-reference
     column (et0, ETo, ETos, reference ET), in a rain unit. A file with rows through the day is summarised to days. Values
     no station reports are gaps, counted in notes; when most of Tmax or Tmin are, the unit cannot be right and the file is refused. */
  function parseWeatherCSV(text, u, lat, lon, elev) {
    // the header is the first row that names a date, Tmax, Tmin and rain: NASA POWER, Open-Meteo and Campbell TOA5 files have lines above it
    const dated = C => C.dates.length > 0 || C.year >= 0, full = C => C.tmax >= 0 && C.tmin >= 0 && C.prcp >= 0;
    const rows = rowsWith(text, R => R.slice(0, 100).some(x => { const c = wxColumns(x); return dated(c) && full(c); }));
    if (rows.length < 3) throw new Error("The weather file needs a header row and daily rows.");
    const cols = rows.slice(0, 100).map(x => wxColumns(x));
    let named = cols.findIndex(c => dated(c) && full(c));
    if (named < 0) {
      // or two lines of words that do so together, cell by cell: a Davis desktop file has "Hi" over "Temp" and "Rain" over "Rate"
      const words = x => x.every(c => num(c) === null), joined = i => Array.from({ length: Math.max(rows[i].length, rows[i + 1].length) }, (_, j) => `${rows[i][j] || ""} ${rows[i + 1][j] || ""}`.trim());
      const at = rows.slice(0, 99).findIndex((x, i) => { if (!rows[i + 1] || !words(x) || !words(rows[i + 1])) return false; const c = wxColumns(joined(i)); return dated(c) && full(c); });
      if (at >= 0) { rows.splice(at, 2, joined(at)); cols.splice(at, 2, wxColumns(rows[at])); named = at; }
    }
    const hi = Math.max(0, named >= 0 ? named : cols.findIndex(full)), head = rows[hi];
    let C = cols[hi];
    if (!full(C)) throw new Error(dated(C) ? "Columns needed: tmax, tmin and prcp (rain); optional srad, rh, rhmax, rhmin, tdew, wind, et0." : "No date column found: use 'date' (YYYY-MM-DD), or 'year' with 'doy', or year, month and day.");
    const L = dateLayout(C, rows.slice(hi + 1, hi + 41), rows.slice(hi + 1));
    if (!L) throw new Error(dated(C) ? "No daily rows could be read; check the date format." : "No date column found: use 'date' (YYYY-MM-DD), or 'year' with 'doy', or year, month and day.");
    // columns that compete for a quantity, by the days each has values on
    const rivals = [...new Set(C.cand.filter(([, , k]) => C.cand.filter(c => c[2] === k).length > 1).map(c => c[1]))];
    if (rivals.length) {
      const on = new Map(rivals.map(i => [i, new Set()]));
      rows.slice(hi + 1).forEach(x => { const d = L.day(x); if (d !== null) rivals.forEach(i => { if (cellNumber(x[i]) !== null) on.get(i).add(d); }); });
      const c2 = wxColumns(head, i => (on.has(i) ? on.get(i).size : 0));
      if (full(c2)) C = c2;
    }
    // a Campbell TOA5 table stamps each record at the end of its interval: a daily record at 2024-07-02 00:00 holds 1 July
    const toa5 = /^toa5$/i.test(rows[0][0]) && L.cols.date !== undefined, midnight = s => /^\S+[ T]0?0:00(:00)?(\.0+)?(?![\d.:])/.test(s || "");
    // the rows under the header with no date and no weather numbers: TOA5, NDAWN and CoAgMet give the units there
    const under = [];
    for (const x of rows.slice(hi + 1, hi + 4)) {
      if (L.day(x) !== null || ["tmax", "tmin", "prcp"].some(k => cellNumber(x[C[k]]) !== null)) break;
      under.push(x);
    }
    const fromRow = [], fromCell = [], name = i => `"${head[i]}"`, tenths = ghcnTenths(text, rows, hi, C.tmax);
    // each column's unit: what its name states, else the row under the header, else what the sheet says
    const unitsOf = (k, kind, chosen) => {
      if (C[k] < 0) return { u: chosen, stated: false };
      const s = statedUnit(kind, head[C[k]]);
      if (s) return { u: s, stated: true };
      const c = under.map(x => x[C[k]] || "").find(t => statedUnit(kind, t));
      if (c) fromRow.push(`${name(C[k])} in ${c}`);
      if (c) return { u: statedUnit(kind, c), stated: true };
      // or the unit written in its cells ("40°F")
      const inCell = rows.slice(hi + 1, hi + 201).map(x => cellSuffix(x[C[k]])).find(t => t && statedUnit(kind, t));
      if (inCell) fromCell.push(`${name(C[k])} in ${inCell}`);
      return inCell ? { u: statedUnit(kind, inCell), stated: true } : { u: chosen, stated: false };
    };
    const UN = { tmax: unitsOf("tmax", "temp", u.temp), tmin: unitsOf("tmin", "temp", u.temp), tdew: unitsOf("tdew", "temp", u.temp), prcp: unitsOf("prcp", "rain", u.prcp),
      et0: unitsOf("et0", "rain", u.prcp), srad: unitsOf("srad", "srad", u.srad), wind: unitsOf("wind", "wind", u.wind || "ms") };
    if (tenths) { UN.tmax = UN.tmin = { u: "C", stated: true }; UN.prcp = { u: "mm", stated: true }; UN.wind = { u: "ms", stated: true }; }
    const temp = (v, k) => (v === null ? null : UN[k].u === "F" ? (v - 32) / 1.8 : UN[k].u === "K" ? v - 273.15 : v);
    const pr = (v, k) => (v === null ? null : UN[k].u === "in" ? v * 25.4 : UN[k].u === "cm" ? v * 10 : v);
    // Daymet's srad is the mean over the daylight, dayl (s) long, not over the day
    const dayl = UN.srad.u === "W" ? head.findIndex((h, i) => /^dayl\b/i.test(h) && (!/[([]/.test(h) || /[([]\s*s(ec\w*)?\b/i.test(h)) && rows.slice(hi + 1, hi + 11).some(x => cellNumber(x[i]) > 1000)) : -1;
    const sr = (v, x) => (v === null ? null : dayl >= 0 ? (cellNumber(x[dayl]) === null ? null : (v * cellNumber(x[dayl])) / 1e6) : v * (SOLAR_MJ[UN.srad.u] ?? 1));
    const wk = WIND_MS[UN.wind.u] ?? 1, zs = C.wind >= 0 ? statedHeight(head[C.wind]) : null;
    const zh = zs ?? (+u.windHeight || 2), to10 = Math.log(10 / 0.03) / Math.log(zh / 0.03), to2 = Math.log(2 / 0.03) / Math.log(zh / 0.03); // log law, open ground z0 = 0.03 m
    const seen = { moved: null, trace: new Set(), lost: 0, lostAt: "", codes: 0, marked: 0, markedAt: "", other: 0, otherAt: "", out: {}, same: 0, good: {}, bad: {}, badAt: {} };
    const KIND = { tmax: "temp", tmin: "temp", tdew: "temp", prcp: "rain", et0: "rain", srad: "srad", wind: "wind" };
    // 999 is a code only where the column's unit cannot hold it: 99.9 mm in tenths, 9999 kJ/m² and 99.9 km/h are readings
    const holds = (k, v) => (k === "srad" ? (UN.srad.u === "W" ? +v < 2000 : UN.srad.u !== "MJ" && +v * (SOLAR_MJ[UN.srad.u] ?? 1) <= 50) : tenths && ["prcp", "tmax", "tmin", "wind"].includes(k) ? +v < 9000 : false);
    // humidity given as a fraction: so its name says (a template's "rh (fraction)"), whatever the values, else every value of the column 1 or less
    const fracs = {}, FRACTION = /\bfrac(tion)?\b|[([]\s*0\s*(-|–|to)\s*1\s*[)\]]/i;
    ["rh", "rhmax", "rhmin"].forEach(k => {
      if (C[k] < 0) return;
      if (FRACTION.test(head[C[k]])) { fracs[k] = "named"; return; }
      const a = rows.slice(hi + 1).map(x => (MISSING_CODE.test((x[C[k]] || "").trim()) ? null : cellNumber(x[C[k]]))).filter(v => v !== null && v > -99);
      fracs[k] = a.length > 0 && a.some(v => v > 0) && a.every(v => v <= 1);
    });
    const hum = (v, k) => {
      if (v === null || !fracs[k]) return v;
      if (v > 1) { seen.out.frac = (seen.out.frac || 0) + 1; return null; } // only where the name says fraction: 1.02 is no humidity of 102 %
      return v * 100;
    };
    // blank, text (NA, M) and codes of -99 or below (-99.9, -996, -9999) or above any value (999, 9999; wind 99.9) are missing; "T" (a trace) of rain is 0
    const nv = (x, k) => {
      if (C[k] < 0) return null;
      const v = (x[C[k]] || "").trim();
      if (k === "prcp" && /^t(race)?$/i.test(v)) return 0;
      if ((MISSING_CODE.test(v) && !holds(k, v)) || (k === "wind" && UN.wind.u !== "kmh" && /^\+?99\.9+$/.test(v))) { seen.codes++; return null; }
      const n = cellNumber(v);
      if (n === null || n <= -99) return null;
      if (!Number.isFinite(+v)) {
        // a unit in the cell: the column was read in it, and a cell in another is a gap, not a number in the wrong unit
        const cu = KIND[k] ? statedUnit(KIND[k], cellSuffix(v)) : null;
        if (cu && cu !== UN[k].u) { seen.other++; seen.otherAt = seen.otherAt || v; return null; }
        if (!cu) { seen.marked++; seen.markedAt = seen.markedAt || v; }
      }
      return tenths && ["tmax", "tmin", "prcp", "wind"].includes(k) ? n / 10 : n;
    };
    const held = (k, v) => {
      if (v === null) return null;
      const [lo, up] = WX_LIMITS[k];
      if (BY_DAY.has(k) ? k !== "prcp" || v >= 0 : v >= lo && v <= up) return v;
      seen.out[k] = (seen.out[k] || 0) + 1;
      return null;
    };
    const rawT = { tmax: [], tmin: [] }, FIELDS = ["prcp", "tmax", "tmin", "srad", "rh", "rhmax", "rhmin", "tdew", "wind", "et0"];
    const clocks = head.flatMap((h, i) => (CLOCK_NAME.test(wxName(h)) || (C.dates.includes(i) && i !== L.cols.date) ? [i] : [])), stampOf = x => [L.cols.date, ...clocks].map(i => x[i] ?? "").join(" ");
    /* a row's time of day in minutes, or null: "13:05", "1:05 PM", "2024-03-05T13:05:00-06:00", "202403051305", or clock
       columns of digits (1305 or 0100; an hour, with a minute column beside it) */
    const ticks = clocks.filter(i => !Object.values(L.cols).includes(i));
    const minuteOf = x => {
      const m = stampOf(x).match(/(?:^|[^\d:])(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?\s*(?:([ap])\.?m\.?(?![a-z]))?/i);
      if (m) return +m[1] > 24 || +m[2] > 59 ? null : (m[3] ? (+m[1] % 12) + (/p/i.test(m[3]) ? 12 : 0) : +m[1]) * 60 + +m[2];
      const run = (L.cols.date !== undefined ? x[L.cols.date] || "" : "").match(/^\d{8}(\d{2})(\d{2})?(\d{2})?(?!\d)/);
      if (run) return +run[1] * 60 + +(run[2] || 0);
      let t = null;
      ticks.forEach(i => {
        const v = (x[i] || "").trim(), nm = wxName(head[i]);
        if (/^\d{1,4}$/.test(v)) t = (t ?? 0) + (/^minute$/.test(nm) ? +v : /^(hour|hr|hh)$/.test(nm) && +v <= 24 ? +v * 60 : Math.floor(+v / 100) * 60 + (+v % 100));
      });
      return t;
    };
    const perDay = new Map();
    let ups = 0, downs = 0, lastDay = null, order = 0, tUp = 0, tDown = 0, lastT = null;
    for (const x of rows.slice(hi + 1)) {
      let d = L.day(x);
      if (d === null) {
        // a row with weather but no readable date (units and other text lines have no numbers)
        if (["tmax", "tmin", "prcp"].some(k => nv(x, k) !== null)) { seen.lost++; seen.lostAt = seen.lostAt || Object.values(L.cols).map(i => x[i] || "").join(" "); }
        continue;
      }
      let t = minuteOf(x);
      if (toa5 && midnight(x[L.cols.date])) { d--; t = 1440; seen.moved = seen.moved || `${x[L.cols.date]} → ${Wd.isoDay(d)}`; }
      // which way the file runs, by its days: many exports put the newest first (and within a day, by its clock, for one day)
      if (lastDay !== null && d !== lastDay) { if (d > lastDay) ups++; else downs++; }
      else if (lastDay === d && t !== null && lastT !== null) { if (t > lastT) tUp++; else if (t < lastT) tDown++; }
      lastDay = d; lastT = t;
      if (!perDay.has(d)) perDay.set(d, { list: [], keys: new Set(), stamps: new Set() });
      const e = perDay.get(d), key = x.join("\u0001");
      if (e.keys.has(key)) { seen.same++; continue; } // the same row twice is one row
      e.keys.add(key);
      e.stamps.add(stampOf(x));
      if (C.prcp >= 0 && /^t(race)?$/i.test(x[C.prcp] || "")) seen.trace.add(d);
      const rv = Object.fromEntries(FIELDS.map(k => [k, nv(x, k)]));
      // a cell with digits that still reads as no number ("20,123", "33,5" in a comma file, 0.49") is a gap, counted per column
      FIELDS.forEach(k => {
        if (C[k] < 0) return;
        const c = (x[C[k]] || "").trim();
        if (cellNumber(c) !== null) seen.good[k] = (seen.good[k] || 0) + 1;
        else if (/\d/.test(c)) { seen.bad[k] = (seen.bad[k] || 0) + 1; seen.badAt[k] = seen.badAt[k] || c; }
      });
      // a logger's placeholder: every column of the row 0, in the file's own units (0 °F alone is a winter reading); on rows
      // through the day it is kept aside, as it may be a calm, dark, freezing hour among readings near it (see below)
      const real = rv.tmax === 0 && rv.tmin === 0 && FIELDS.every(k => !rv[k]) ? { ...rv } : null;
      if (real) { seen.out.zeros = (seen.out.zeros || 0) + 1; FIELDS.forEach(k => { rv[k] = null; }); }
      const rowOf = (rv, raw) => {
        const row = { prcp: held("prcp", pr(rv.prcp, "prcp")), srad: held("srad", sr(rv.srad, x)), rh: held("rh", hum(rv.rh, "rh")), rhmax: held("rhmax", hum(rv.rhmax, "rhmax")), rhmin: held("rhmin", hum(rv.rhmin, "rhmin")),
          tdew: held("tdew", temp(rv.tdew, "tdew")), wind: held("wind", rv.wind === null ? null : rv.wind * wk), et0: held("et0", pr(rv.et0, "et0")), t, n: order };
        ["tmax", "tmin"].forEach(k => { const v = temp(rv[k], k); if (raw && v !== null) rawT[k].push(v); row[k] = held(k, v); });
        return row;
      };
      const row = rowOf(rv, true);
      if (real) row.real = rowOf(real, false);
      order++;
      e.list.push(row);
    }
    if (!perDay.size) throw new Error("No daily rows could be read; check the date format.");
    /* stamped at each interval's end (as a logger's are): each midnight row ends the day before, as in TOA5 (the day's rain is
       not counted twice). The file's ends say so (it runs from about one step past midnight, or to a midnight alone on its day),
       and its midnight rows: one that goes on with the day before's last reading, above 0, while the next row breaks off (a
       daily value, or a running daily total, that changes after it) ends the day before; one that breaks off from it and goes
       on into the day, above 0, starts its day. A daily solar or ET value on each row, held through the whole day before,
       votes the same way. Both ends saying so is enough unless the midnight rows say otherwise; one end, only if they agree;
       neither, only where a whole day held the value its midnight row goes on with (a daily value) */
    const dk0 = [...perDay.keys()].sort((a, b) => a - b), inT = d => perDay.get(d).list.filter(r => r.t !== null).sort((a, b) => a.t - b.t), gaps = new Map();
    dk0.forEach(d => inT(d).forEach((r, i, a) => { if (i && r.t > a[i - 1].t) gaps.set(r.t - a[i - 1].t, (gaps.get(r.t - a[i - 1].t) || 0) + 1); }));
    const stepT = gaps.size ? [...gaps].reduce((a, b) => (b[1] > a[1] ? b : a))[0] : 0, quick = stepT > 0 && stepT < 60; // the usual minutes from row to row; rows minutes apart
    if (!toa5 && dk0.length > 1) {
      const A = inT(dk0[0]), Z = perDay.get(dk0[dk0.length - 1]).list;
      const edges = (A.length > 2 && A.length === perDay.get(dk0[0]).list.length && A[0].t > 0 && A[0].t <= 2 * stepT) + (Z.length === 1 && Z[0].t === 0 && dk0[dk0.length - 1] - dk0[dk0.length - 2] === 1);
      let votes = 0, against = 0, whole = 0;
      dk0.forEach(d => {
        if (!perDay.has(d - 1)) return;
        const p = inT(d - 1), a = inT(d), m = a.findIndex(r => r.t === 0), q = p[p.length - 1], n = a[m + 1];
        if (m < 0 || !q || !n || q.t < 1440 - 2 * stepT || n.t > 2 * stepT) return;
        if (![q, a[m], n].some(r => r.prcp === null)) {
          if (a[m].prcp === q.prcp && n.prcp !== q.prcp && q.prcp > 0) { votes++; if (p.length > 2 && p.every(r => !r.t || r.prcp === null || r.prcp === q.prcp)) whole++; }
          else if (a[m].prcp !== q.prcp && n.prcp === a[m].prcp && n.prcp > 0) { votes--; against++; }
        }
        ["srad", "et0"].forEach(k => {
          if ([q, a[m], n].some(r => r[k] === null) || !(q[k] > 0 && n[k] > 0) || p.length < 3 || !p.every(r => !r.t || r[k] === q[k])) return;
          if (a[m][k] === q[k] && n[k] !== q[k]) { votes++; whole++; } else if (a[m][k] !== q[k] && n[k] === a[m][k]) { votes--; against++; }
        });
      });
      if (stepT && (edges === 2 ? votes >= 0 : edges === 1 ? votes > 0 : whole > 0 && !against)) dk0.forEach((d, k) => {
        const e = perDay.get(d), m = e.list.filter(r => r.t === 0);
        if (!m.length || (!perDay.has(d - 1) && k)) return;
        if (!perDay.has(d - 1)) perDay.set(d - 1, { list: [], keys: new Set(), stamps: new Set() }); // the file's first row ends the day before it
        const to = perDay.get(d - 1);
        m.forEach(r => { r.t = 1440; to.list.push(r); to.stamps.add("24:00"); });
        to.list.sort((a, b) => a.n - b.n);
        e.list = e.list.filter(r => !m.includes(r));
        if (!e.list.length) perDay.delete(d);
        seen.ending = seen.ending || `${Wd.isoDay(d)} 00:00 → ${Wd.isoDay(d - 1)}`;
      });
    }
    // most of a column beyond any weather: its unit cannot be right, and leaving it as gaps would keep the part that passes for °C
    const mid = a => { const s = a.filter(x => x !== null).sort((p, q) => p - q); return s.length ? s[s.length >> 1] : null; };
    ["tmax", "tmin"].forEach(k => {
      const a = rawT[k];
      if (2 * a.filter(v => v < -60 || v > 60).length > a.length) throw new Error(`${name(C[k])} reads as ${mid(a).toFixed(0)} °C on a typical day, which no station reports, so its unit cannot be right. Choose the unit in the sheet${UN[k].stated ? ", and check the one in its name" : `, or say it in the column name ("${head[C[k]]} (F)")`}, and load the file again; tenths of a degree need dividing by 10 first.`);
    });
    // rows through the day (they differ in their time on at least half the days) are summarised; a few repeated days of a daily file keep each column's last value
    const dayKeys = [...perDay.keys()].sort((a, b) => a - b), days = dayKeys.map(d => perDay.get(d)), repeat = days.filter(e => e.list.length > 1);
    const namesIn = i => [...new Set(rows.slice(hi + 1 + under.length).map(x => x[i]).filter(Boolean))], stn = 2 * repeat.length < days.length ? -1 : head.findIndex((h, i) => STATION_NAME.test(wxName(h)) && namesIn(i).length > 1);
    if (stn >= 0) throw new Error(`${name(stn)} holds more than one station (${namesIn(stn).slice(0, 3).join(", ")}), so the days would be mixed: keep the rows of one.`);
    const sub = 2 * days.filter(e => e.stamps.size > 1).length >= days.length;
    // each day's rows in time order: by their clock where it runs one way through most days in the file's order (a 12-hour
    // clock with no AM/PM runs 12, 1 ... 11 twice and is no order), else as they come, turned round when the file runs newest first
    const back = downs > ups || downs === ups && tDown > tUp, timed = days.filter(e => e.list.length > 1 && e.list.every(r => r.t !== null));
    const oneWay = e => [1, -1].some(s => e.list.every((r, i) => !i || s * (r.t - e.list[i - 1].t) >= 0));
    const byClock = 2 * timed.filter(oneWay).length > timed.length;
    if (sub) days.forEach(e => {
      if (byClock && e.list.every(r => r.t !== null)) e.list.sort((a, b) => a.t - b.t || (back ? b.n - a.n : a.n - b.n));
      else if (back) e.list.reverse();
    });
    // a row of zeros next to readings within 3 °C of it is a calm, dark, freezing hour, not a logger's placeholder, where each
    // of its zeros can be one: not a humidity of 0 (no reading), solar radiation beside a reading above 0 (daylight), or rain
    // between two readings above 0 (a running total does not fall to 0 for an hour), unless the other rows show amounts (rain
    // that falls back to 0 between wet rows, eases from one wet row to a smaller one, and falls twice within one day somewhere:
    // a total falls once a day at most, at its reset) and the two readings' highs and lows are within half a degree, as its
    // own two zeros are
    const seqR = days.flatMap(e => e.list.filter(r => !r.real && r.prcp !== null).map(r => r.prcp));
    const twice = days.some(e => { const a = e.list.filter(r => !r.real && r.prcp !== null).map(r => r.prcp); return a.filter((v, i) => i && v < a[i - 1]).length > 1; });
    const amounts = twice && seqR.some((v, i) => i && v > 0 && v < seqR[i - 1]) && seqR.some((v, i) => i && v > 0 && !seqR[i - 1] && seqR.slice(0, i).some(x => x > 0));
    if (sub) days.forEach(e => e.list.forEach((r, i) => {
      if (!r.real) return;
      const by = s => { for (let j = i + s; j >= 0 && j < e.list.length; j += s) if (!e.list[j].real) return e.list[j]; return null; };
      const p = by(-1), q = by(1), near = x => x && x.tmax !== null && x.tmin !== null && Math.abs(x.tmax - r.real.tmax) <= 3 && Math.abs(x.tmin - r.real.tmin) <= 3;
      const cannot = ["rh", "rhmax", "rhmin"].some(k => r.real[k] === 0) || [p, q].some(x => x && x.srad > 0) || (p && q && p.prcp > 0 && q.prcp > 0 && (!amounts || [p, q].some(x => x.tmax === null || x.tmin === null || x.tmax - x.tmin > 0.5)));
      if ((near(p) || near(q)) && !cannot) { Object.assign(r, r.real); if (!--seen.out.zeros) delete seen.out.zeros; }
    }));
    days.forEach(e => e.list.forEach(r => { delete r.real; }));
    const counts = days.map(e => e.list.length).sort((a, b) => a - b), usual = counts[counts.length >> 1];
    const pool = (list, k, f) => { const a = list.map(r => r[k]).filter(v => v !== null); return a.length ? f(a) : null; };
    const top = a => a.reduce((x, y) => (y > x ? y : x)), low = a => a.reduce((x, y) => (y < x ? y : x)), lastOf = a => a[a.length - 1];
    /* rain through the day, in time order. A daily value repeated on each row stays one value. A total that keeps growing
       from day to day (since a season's start: held over midnights, and reset at most once a year) gives each day what it
       rose by. A running total that only rises within each day is at its largest at the day's end. One that resets at
       another hour (a logger's 00:00 row still holds yesterday's total; UTC stamps; "since 7 am") has drops, but its name
       says so, or it stays flat between rains and falls at one hour of the day, where amounts per row fall back to 0 when
       each rain ends (steady drizzle stays flat while it lasts): each row then adds what it rose by, and after a reset all it holds. */
    /* a day given through: from its first row to its last, its first and last readings no more than three hours' rows from
       them, on half its rows at least (a season's total is given on dry hours too, every hour or every few minutes; rain left
       blank on them is not). Where most readings within days come about a fixed number of rows apart (a total given every 4 or
       6 h, an hour now and then missing from the file), that is the step, and one reading may be missing at either end. */
    days.forEach(e => { e.got = e.list.flatMap((r, i) => (r.prcp === null ? [] : [i])); });
    const sp = new Map();
    days.forEach(e => e.got.forEach((x, i, p) => { if (i) sp.set(x - p[i - 1], (sp.get(x - p[i - 1]) || 0) + 1); }));
    const [step, often] = [...sp].reduce((a, b) => (b[1] > a[1] ? b : a), [1, 0]), spaced = [...sp.values()].reduce((a, b) => a + b, 0);
    const nearly = step < 3 ? often : (sp.get(step - 1) || 0) + often + (sp.get(step + 1) || 0);
    const every = 4 * nearly >= 3 * spaced && often >= days.length && 2 * step <= usual ? step : 1, gap = Math.max(1, Math.round(usual / 8), 2 * every - 1);
    const dense = e => 2 * every * e.got.length >= e.list.length, fromStart = e => e.got[0] < gap, atEnd = e => e.got.length > 0 && e.list.length - e.got[e.got.length - 1] <= gap;
    const through = e => dense(e) && fromStart(e) && atEnd(e);
    const thru = days.map(through);
    let drops = 0, rises = 0, flat = 0, moved = 0, carried = 0, kept = 0, climb = 0, over = false, lead = false, last = null, start = null, lift = 0, from = null, since = null, prev = null;
    // each fall { t, d, top: the reading it fell from, climb: the rises since the fall before, from: the time of the first of
    // them, over: held over a midnight since, lead: the file's first fall, of a total held from before its start, hold: minutes
    // since the last change, or since the file's first reading, lag: after rows left blank (a total blank from its reset to
    // the next tip), dated from the first of them }; cuts: the days of falls of more than a tenth that are no dips (a weighing
    // gauge's total wavers by less)
    const falls = [], cuts = [], rowAt = new Set(days.flatMap((e, j) => e.list.map(r => (r.t === null ? null : dayKeys[j] * 1440 + r.t))));
    /* a name that marks a season's total: accumulated, cumulative, or since a date ("since Oct 1", "since 1 Oct", "since
       10/1", "since 2024-10-01"), and no day, hour or other span, and no time of day ("since 7 AM", "since midnight", "Rain
       Today", "since 0700", 12Z, UTC). Season, year and YTD are no rain at all (WX_NOT) */
    const pn = (C.prcp >= 0 ? head[C.prcp] : "").toLowerCase().replace(/_/g, " "), MON = "(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t|tember)?|oct(ober)?|nov(ember)?|dec(ember)?)\\b";
    const onDate = pn.match(new RegExp(`since\\W*(${MON}|\\d{1,2}(st|nd|rd|th)?\\W*${MON}|\\d{1,2}[/-]\\d{1,2}([/-]\\d{2,4})?\\b|\\d{4}-\\d{1,2}(-\\d{1,2})?)`));
    const seasonName = (/accum|cumul/.test(pn) || !!onDate) && (!!onDate || !/since\W*\d/.test(pn)) && !/(^|\D)24(\D|$)/.test(onDate ? pn.replace(onDate[0], " ") : pn)
      && !/day|daily|midnight|hour|\bhrs?\b|minute|\bmins?\b|\d\s*(hrs?|mins?|h|z)\b|\d\s*[ap]\.?m\b|\d:\d\d|\b(utc|gmt|lst|local)\b/.test(pn)
      && !/since\W*(last|prev|previous)\b|\b(noon|sunrise|sunset|hrly)\b|\bpt?\d+[hmd]\b|(^|\W)\d+\s*[dm]\b|(^|\D)\d{1,2}:?\d{2}\s*-\s*\d{1,2}:?\d{2}(\D|$)|(^|\D)\d{1,2}\s*-\s*\d{1,2}(\D|$)/.test(onDate ? pn.replace(onDate[0], " ") : pn);
    // a dip: a fall to no less than half that is back to the reading before it within three readings (or ends the file), as a
    // gauge's total wavers, unless the name says the total is a day's ("since 7 AM", "Rain Today": it falls only to a reset)
    const comes = (a, i, v) => { const b = a.slice(i + 1, i + 4); return !b.length || b.some(x => x >= v); };
    if (sub && (seasonName || !/day|daily|today|midnight|since \d/i.test(C.prcp >= 0 ? head[C.prcp] : ""))) {
      const seq = days.flatMap(e => e.list.filter(r => r.prcp !== null)), pv = seq.map(r => r.prcp);
      seq.forEach((r, i) => { if (i && pv[i] < pv[i - 1] && 2 * pv[i] >= pv[i - 1] && comes(pv, i, pv[i - 1])) for (let k = i; k < seq.length && pv[k] < pv[i - 1]; k++) seq[k].dip = true; });
    }
    // start: the day it first rises from 0, before any of those falls (a season's total that starts in the file)
    if (sub) days.forEach((e, j) => {
      const a = e.list.filter(r => r.prcp !== null);
      if (!j && dense(e) && fromStart(e) && a[0].prcp > 0) over = lead = true; // a total held from before the file's start
      if (a.some((r, i) => i && r.prcp < a[i - 1].prcp)) drops++;
      else if (a.some((r, i) => i && r.prcp > a[i - 1].prcp)) rises++;
      // held over midnight: on adjacent days each given on half its rows, the one to its end and the next from its start, not
      // across blank hours (dry ones, where rain is left blank) or missing days; kept: from one day's last reading to the next's
      if (j && dense(e) && fromStart(e) && dense(days[j - 1]) && atEnd(days[j - 1]) && dayKeys[j] - dayKeys[j - 1] === 1 && a[0].prcp >= last && last > 0) { carried++; over = true; }
      if (j && a.length && days[j - 1].got.length && dayKeys[j] - dayKeys[j - 1] === 1 && a[0].prcp >= last && last > 0) kept++; // at any hours
      a.forEach(r => {
        const v = r.prcp, at = r.t === null ? null : dayKeys[j] * 1440 + r.t, apart = at === null || prev === null || at - prev > 2 * stepT;
        if (last !== null) {
          if (v === last && v > 0) flat++; else if (v !== last) moved++;
          if (v > last) { if (!climb) from = r.t; climb++; lift = Math.max(lift, v - last); if (!last && start === null && !cuts.length) start = dayKeys[j]; }
          else if (v < last) { const lag = apart && at !== null && prev !== null && rowAt.has(prev + stepT); falls.push({ t: lag ? (prev + stepT) % 1440 : r.t, d: dayKeys[j], top: last, lag, climb, over, lead, from, hold: at === null || since === null ? null : (apart ? prev : at) - since }); climb = 0; over = lead = false; from = null; if (10 * v < 9 * last && !r.dip) cuts.push(dayKeys[j]); }
        }
        if (last === null || v !== last && !lead || apart) since = at; // held on rows in a row, not across blank ones (one from before the file's start, from its first row)
        prev = at;
        last = v;
      });
    });
    // one value on every row of the file tells nothing of how to read it, so it stays amounts per row; rain left blank
    // through whole days (its dry days) and one value on the rest does tell
    const blank = e => e.list.every(r => r.prcp === null), blankDays = days.filter(blank).length;
    const varies = k => new Set(days.flatMap(e => e.list.map(r => r[k]).filter(v => v !== null))).size > 1;
    const yearly = D => D.every((d, i) => !i || d - D[i - 1] >= 300);
    const spread = T => { const s = T.map(t => t % 1440).sort((a, b) => a - b); return 1440 - s.reduce((g, t, i) => Math.max(g, i ? t - s[i - 1] : t + 1440 - s[s.length - 1]), 0); };
    /* a season's name decides on rows through the day where the rows allow it: in time order they fall a year apart at
       least, and a year after the total's start where it starts from 0 in the file. A fall of a step or two of the column's
       resolution, not to 0, that is back within three readings to no more than a step or two above (or is on the file's
       last three rows, or on the last three before the blank rows that end it, on the row after the reading before it), is
       a gauge's wavering, no fall. Where 0s outnumber blanks, the readings above 0 never repeat the
       one before (a total given only when it changes) and they open more than ten times above any rise between them (a
       total from well before the file), a run of 0s between two readings that goes back up past the one before it is dry
       hours written 0, no fall, and so then are the file's first and last 0s (all its 0s, where its readings above 0 make
       one run and 0s follow it); dry hours are no falls for the rows either. The rows win where they fall once a day at one hour on two days or more (a running daily total, one reset
       at 7 am or 00:00 UTC), where each day given is given from its first reading to its end, and one at least is left
       blank from the day's start, or holds its value while whole days are blank (a running daily total left blank before
       each day's first tip), or where a value held on rows in a row is then left blank (below); a reading missing (below)
       counts as given in both, but turns the first test on by itself only where the rows can then be read so (below). With
       no reading above 0 there is nothing to read by the name. */
    // dry hours written 0: more 0s than blanks (and see `repeated`, below)
    const zeroDry = days.reduce((n, e) => n + e.list.filter(r => r.prcp === 0).length - e.list.filter(r => r.prcp === null).length, 0) > 0;
    let byName = false, cutN = [], stepN = Infinity, sparse = false, blank0 = false, gapF = new Map(), heldB = new Set();
    if (sub && seasonName) {
      const seq = days.flatMap((e, j) => e.list.filter(r => r.prcp !== null).map(r => ({ r, v: r.prcp, d: dayKeys[j] })));
      sparse = !seq.some((x, i) => i && x.v > 0 && x.v === seq[i - 1].v);
      const pos = seq.filter(x => x.v > 0), lift0 = pos.reduce((m, x, i) => (i && x.v - pos[i - 1].v > m ? x.v - pos[i - 1].v : m), 0);
      if (zeroDry && lift0 > 0 && pos[0].v > 10 * lift0 && !seq.some((x, i) => i && x.v > 0 && x.v === seq[i - 1].v)) {
        let back = false, between = false;
        for (let i = 0, k; i < seq.length; i = k) {
          k = i + 1;
          if (seq[i].v) continue;
          while (k < seq.length && !seq[k].v) k++;
          if (!i || k === seq.length) continue;
          between = true;
          if (seq[k].v > seq[i - 1].v) { back = true; for (let m = i; m < k; m++) seq[m].r.dry0 = true; }
        }
        const p0 = seq.findIndex(x => x.v), p1 = seq.length - 1 - seq.slice().reverse().findIndex(x => x.v);
        if (p0 >= 0 && (back || !between && p1 < seq.length - 1)) seq.forEach((x, i) => { if (i < p0 || i > p1) x.r.dry0 = true; });
      }
      const E = seq.filter(x => !x.r.dry0);
      const ownN = UN.prcp.u === "in" ? 25.4 : UN.prcp.u === "cm" ? 10 : 1;
      stepN = ownN * ([1, 0.1, 0.01].find(s => seq.every(x => Math.abs(x.v / ownN / s - Math.round(x.v / ownN / s)) < 1e-6)) || 0.001);
      const allR = days.flatMap(e => e.list), endA = allR.map(r => r.prcp !== null).lastIndexOf(true), rowN = new Map(allR.map((r, i) => [r, i]));
      const tail = days[days.length - 1].list.slice(-3), tailE = endA >= 0 && endA + 1 < allR.length ? allR.slice(Math.max(0, endA - 2), endA + 1) : [];
      const atEndW = i => E.slice(i).every(y => tail.includes(y.r)) || E.slice(i).every(y => tailE.includes(y.r)) && rowN.get(E[i].r) - rowN.get(E[i - 1].r) === 1;
      E.forEach((x, i) => {
        const b = i ? E[i - 1].v : null, s = 2 * stepN + 1e-9;
        if (b === null || !(x.v < b && x.v > 0 && b - x.v <= s) || x.r.waver) return;
        const k = E.findIndex((y, m) => m > i && m <= i + 3 && y.v >= b);
        if (k < 0 ? !atEndW(i) : E[k].v > b + s) return; // (not back, but on the file's last rows: before the blank rows that end it, on the row after the reading before)
        for (let m = i; m < (k < 0 ? E.length : k); m++) E[m].r.waver = true;
      });
      const fall = (b, x) => x.v < b && !x.r.waver;
      const down = E.filter((x, i) => i && fall(E[i - 1].v, x)), D = down.map(x => x.d); // (dry hours written 0 are no falls)
      const daily = down.length > 1 && !yearly(D) && new Set(D).size === D.length && down.every(x => x.r.t !== null) && spread(down.map(x => x.r.t)) <= 60;
      /* a reading missing: blank rows between two readings of the same value above 0 (an hour's rows at most, or two rows
         an hour or more apart), or between a reading and a higher one (an hour's rows at most, where the column also holds
         a value on rows in a row somewhere: not one given only when it changes), in a column given on rows in a row for half
         its readings at least (not one given every few hours), where no reset seen in the file comes at a time of day within
         them (a fall to under half or by more than two steps, after blank rows or not; the blank rows that end the file).
         A total left blank while it is 0 is blank only where it would read 0, after its reset and before the next tip, so it
         does not come back from blank rows to the value it held, nor rise through them, but at its reset's hour. Where the
         file holds one value only, its blank rows tell nothing of that and stay blank. A reading missing counts as given (and a
         value held across one counts as held on rows in a row). Blank rows of less than a day between two readings of the same
         value above 0, longer or not, where no reset seen comes at a time of day within them and no higher reading follows
         within the hour (the first tips after a reset), are a value held through an outage too: no total left blank while 0 */
      const rowsT = days.flatMap(e => e.list), runs = [];
      for (let i = 0, k; i < rowsT.length; i = k) {
        k = i + 1;
        if (rowsT[i].prcp !== null) continue;
        while (k < rowsT.length && rowsT[k].prcp === null) k++;
        if (i && k < rowsT.length) runs.push([i, k, rowsT[i - 1].prcp, rowsT[k].prcp]);
      }
      const big = (a, b) => b < a && (2 * b <= a || b < a - 2 * stepN - 1e-9), endR = rowsT.map(r => r.prcp !== null).lastIndexOf(true);
      const resetT = rowsT.flatMap((r, i) => (i && r.prcp !== null && rowsT[i - 1].prcp !== null && r.t !== null && big(rowsT[i - 1].prcp, r.prcp) ? [r.t] : []))
        .concat(runs.filter(([i, k, a, b]) => big(a, b) && rowsT[i].t !== null).map(([i]) => rowsT[i].t), endR >= 0 && endR + 1 < rowsT.length && rowsT[endR + 1].t !== null ? [rowsT[endR + 1].t] : []);
      const spans = (i, k) => { const tb = rowsT[i - 1].t, ta = rowsT[k].t; if (tb === null || ta === null) return true; const L = (ta - tb + 1440) % 1440 || 1440; return resetT.some(x => { const d = (x - tb + 2880) % 1440; return d > 0 && d <= L; }); };
      const heldR = rowsT.some((r, i) => i && r.prcp > 0 && r.prcp === rowsT[i - 1].prcp);
      const nbr = rowsT.filter((r, i) => r.prcp !== null && (i && rowsT[i - 1].prcp !== null || i + 1 < rowsT.length && rowsT[i + 1].prcp !== null)).length;
      if (varies("prcp") && 2 * nbr >= rowsT.filter(r => r.prcp !== null).length) {
        runs.forEach(([i, k, a, b]) => { if (a > 0 && b === a && (k - i) * stepT <= Math.max(60, 2 * stepT) && !spans(i, k)) for (let m = i; m < k; m++) gapF.set(rowsT[m], a); });
        const heldF = heldR || gapF.size > 0;
        runs.forEach(([i, k, a, b]) => { if (a > 0 && heldF && b > a && (k - i) * stepT <= 60 && !spans(i, k)) for (let m = i; m < k; m++) gapF.set(rowsT[m], a); });
      }
      runs.forEach(([i, k, a, b]) => { if (a > 0 && b === a && (k - i) * stepT < 1440 && !spans(i, k) && !rowsT.slice(k + 1, k + 1 + Math.max(1, Math.round(60 / stepT))).some(r => r.prcp > b)) for (let m = i; m < k; m++) heldB.add(rowsT[m]); });
      const pf = r => (r.prcp === null && gapF.has(r) ? gapF.get(r) : r.prcp), gotF = e => e.list.flatMap((r, i) => (pf(r) === null ? [] : [i]));
      const given = days.filter(e => e.got.length), held = e => e.got.some((x, i) => i && e.list[x].prcp === e.list[e.got[i - 1]].prcp);
      // each day given is given from its first reading to its end, and one opens on blank rows or holds its value while
      // whole days are blank. Readings missing count as given, but they turn this on by themselves only where the rows rise
      // or fall within a day (to be read as a running total), no reading after blank rows across a midnight is at or above
      // the one before them, more than a step (a running daily total would need as much rain in its first tips as in the
      // whole day before: a season's total kept over an outage), and none after blank rows is more than ten times any rise
      // from row to row and more than 75 mm an hour could bring since the row before (more than a running total's first
      // tips: a season's total whose first rows were lost)
      const toEndD = G => given.every(e => { const g = G(e); return g[g.length - 1] === e.list.length - 1 && g[g.length - 1] - g[0] === g.length - 1; }) && given.some(e => G(e)[0] > 0 || blankDays > 0 && held(e));
      const liftF = rowsT.reduce((m, r, i) => { const v = pf(r), p = i ? pf(rowsT[i - 1]) : null; return v !== null && p !== null && v - p > m ? v - p : m; }, 0), dayOf = new Map();
      days.forEach((e, j) => e.list.forEach(r => dayOf.set(r, j)));
      let keptB = false, bigB = false;
      rowsT.reduce((q, r, i) => {
        const v = pf(r);
        if (v === null) return q;
        if (q >= 0 && i > q + 1 && pf(rowsT[q]) > stepN + 1e-9 && v >= pf(rowsT[q]) && dayOf.get(r) !== dayOf.get(rowsT[q])) keptB = true;
        if (i && pf(rowsT[i - 1]) === null && v > 10 * liftF && v > 75 * Math.max(stepT, 1) / 60) bigB = true;
        return i;
      }, -1);
      const tipped = toEndD(gotF) && (toEndD(e => e.got) || (drops > 0 || rises > 0) && !keptB && !bigB);
      let st = null;
      E.forEach((x, i) => { const b = i ? E[i - 1].v : null; if (b === null) return; if (fall(b, x)) cutN.push(x.d); else if (!b && x.v > 0 && st === null && !cutN.length) st = x.d; });
      // a value held on rows in a row (each row given, while it holds) and then left blank: a running total left blank
      // while it is 0 after its reset (a season's total is given on every row, or only when it changes, and does not go
      // back to blank), where after the blank rows it goes on well below the value held (a reset seen: under half, or more
      // than two steps), or where the file opens not far above its rises from row to row (ten times at most: a total from
      // 0) and ends on blank rows or opens on them (an outage of a season's total is neither). A dip or a 0 ends a value held
      // (a reset does not: the total held before it was a total). Blank rows then read as 0 (a reading missing, above, is no
      // blank row), but not where dry hours are written 0 (a total left blank while it is 0 writes no 0s)
      let liftA = 0, seenR = false, tailB = false, midB = false, hold = false;
      rowsT.forEach((r, i) => {
        const v = pf(r);
        if (v === null) return;
        const p = i ? pf(rowsT[i - 1]) : null;
        if (p === null) hold = false;
        else { if (v > p) liftA = Math.max(liftA, v - p); if (v < p && !big(p, v) || !v) hold = false; else if (v > 0 && v === p) hold = true; }
        if (!hold || i + 1 >= rowsT.length || pf(rowsT[i + 1]) !== null) return;
        if (i === endR) { tailB = true; return; }
        midB = true;
        if (big(v, pf(rowsT.slice(i + 2).find(x => pf(x) !== null)))) seenR = true;
      });
      blank0 = !tipped && !zeroDry && (seenR || liftA > 0 && pos[0].v <= 10 * liftA && (tailB || midB && rowsT[0].prcp === null));
      byName = pos.length > 0 && !daily && !tipped && !blank0 && yearly(st === null ? cutN : [st, ...cutN]); // (no reading above 0: nothing to read so)
    }
    /* each day's last reading (a daily file's value; the one value of a day repeated on its rows) as a season's total: it never
       falls but to a reset (a year apart at least) or by a weighing gauge's wavering now and then, is given on each day (rain
       left blank on dry days is amounts), and holds its value over dry days, twice at least. Equal amounts on two days in a row,
       three of a short file, or pairs through a wet spell say no more than that, so a value held twice is a total where the
       name says so (accumulated, since a season's start; not a day's, an hour's or one since a time of day), and otherwise where it is held five times,
       over three dry days, over two with another rise or another value held, or stays well above any day's rise (a total
       from before the file's start), or, in a daily file, is held over two dry spells with two wet days in a row between
       rises (pairs that each rise once stay amounts): in no window of a year's real daily rain do amounts do so. One rising
       on four days or more (three, held over two of them), never falling or at 0, and staying well above any day's rise is a
       total too: daily amounts never keep so close. */
    const dayRain = days.map(e => pool(e.list, "prcp", lastOf)), dayCuts = [], own = UN.prcp.u === "in" ? 25.4 : UN.prcp.u === "cm" ? 10 : 1;
    // the column's step: the coarsest of 1, 0.1 and 0.01 of its own unit that every day's value is a whole number of
    const unit = [1, 0.1, 0.01].find(s => dayRain.every(v => v === null || Math.abs(v / own / s - Math.round(v / own / s)) < 1e-6)) || 0.001;
    let stays = 0, dips = 0, wav = 0, tops = 0, peak = -Infinity, most = 0, least = Infinity, nil = 0, prior = null, spell = 1, long = 1, plats = 0, rose = 0;
    dayRain.forEach((v, j) => {
      if (v === null) return;
      if (v > 0) least = Math.min(least, v); else nil++;
      if (prior !== null) {
        // spell: days in a row on one value (rain left blank on dry days holds nothing over); long: the most; plats: how many such spells
        if (v === prior.v && v > 0 && dayKeys[j] - prior.d === 1) { stays++; if (++spell === 2) plats++; long = Math.max(long, spell); } else spell = 1;
        // a day one step low that is back within three days (or ends the file) is a gauge's wavering (wav), where the total rises
        // past its highest somewhere (tops) and wavers no more than once a week; amounts that go back to a value they held before,
        // or go up and down by a step, are not
        if (2 * v < prior.v) dayCuts.push(dayKeys[j]); else if (v < prior.v) { if ((prior.v - v) / own > 1.001 * unit || !comes(dayRain.filter((x, i) => i > j && x !== null), -1, prior.v)) dips++; else wav++; } else { most = Math.max(most, v - prior.v); if (v > prior.v) rose++; }
        if (v > peak) tops++;
      }
      peak = Math.max(peak, v);
      prior = { v, d: dayKeys[j] };
    });
    const dryBlank = dayRain.filter(v => v === null).length, given = dayRain.length - dryBlank;
    if (!tops || wav > Math.max(1, given / 7)) dips += wav;
    const totalName = seasonName || C.prcp >= 0 && /accum|cumul|season|since|year|ytd/i.test(head[C.prcp]) && !/hour|hr\b|24|day|daily|midnight|today|\d\s*[ap]\.?m\b|\d:\d\d/i.test(head[C.prcp]); // ("since 2024-10-01" too)
    const season = C.prcp >= 0 && varies("prcp") && yearly(dayCuts) && 4 * dryBlank < given && (stays >= 2 && stays > 5 * (dayCuts.length + dips)
        && (totalName || stays >= 5 || least >= 3 * most || long >= 4 || long >= 3 && (rose >= 2 || plats >= 2) || !sub && plats >= 2 && rose > plats)
      || given >= 3 && (given >= 4 || stays) && !nil && !dayCuts.length && !dips && least >= 3 * most);
    // a daily value on each row: every wet day holds one value; for rain, on most of a day's rows for one at least (steady drizzle
    // through a few rows is amounts; a solar or ET value held through the day is that day's, however few rows give it), and not
    // a season's total (by its rows, or by its name where a value is held over two days or the values stay three times
    // above any rise from day to day and never fall). Where dry hours are left blank, a blank on a wet day is a dry hour,
    // so the value must fill all the day's rows (drizzle through most of a day is amounts); where they are written 0 (zeroDry,
    // above), a blank is a missing reading, as it is in any other column.
    // a running daily total starts each day from 0, so a day's first reading is one row's rain at most: days opening far above
    // any rise from row to row hold a total from before, three times above in a file given on half its rows each day (dry hours
    // too, as a total is), ten times where hours are left blank (as amounts may be); where whole days are blank (dry days, as a
    // running daily total blank before its first tip leaves them, its first hour holding most of a day's rain), only if kept
    // over a midnight too
    const opens = days.filter(e => e.got.length && fromStart(e)).map(e => e.list[e.got[0]].prcp);
    const high = lift > 0 && (!blankDays || kept > 0) && opens.length > 0 && opens.every(v => v > (days.every(dense) ? 3 : 10) * lift);
    // (one value through each wet day that opens far above any rise and is over 300 mm, which daily rain reaches day after day
    // only in the greatest storms, is a season's total whose rises fell in a day's first hour; a solar or ET value on fewer
    // than half a day's rows is the day's only where it is more than an hour's could be, flat from morning to evening (1.5
    // MJ/m², 0.8 mm of ET), where adding them up would pass any day's (50 MJ/m², 15 mm), or where it is given at midnight:
    // hourly amounts on the daylight hours add up)
    const repeated = k => {
      const wet = sub && (varies(k) || (k === "prcp" && blankDays > 0)) ? days.filter(e => e.list.some(r => r[k] > 0) && e.list.filter(r => r[k] !== null).length >= 3) : [];
      const val = e => e.list.map(r => r[k]).filter(v => v !== null), over = k !== "prcp" && wet.some(e => val(e)[0] > (k === "et0" ? 0.8 : 1.5) || val(e).reduce((s, v) => s + v, 0) > (k === "et0" ? 15 : 50)
        || e.list.some(r => r[k] > 0 && r.t !== null && (r.t < 60 || r.t > 1380)));
      return wet.length > 0 && wet.every(e => { const a = val(e); return a.every(v => v === a[0]) && (k !== "prcp" ? over || 2 * a.length >= e.list.length : zeroDry || a.length === e.list.length); })
        && (k !== "prcp" || wet.some(e => 2 * val(e).length >= usual) && !season && !(byName && (stays > 0 || least >= 3 * most && !dayCuts.length && !dips)) && !(high && wet.every(e => val(e)[0] > 300)));
    };
    const once = { prcp: repeated("prcp"), et0: repeated("et0"), srad: !POWER.has(UN.srad.u) && repeated("srad") };
    const says = /day|daily|accum|cumul|since/i.test(C.prcp >= 0 ? head[C.prcp] : "");
    // the lowest reading above 0
    const floor = days.reduce((m, e) => e.list.reduce((m2, r) => (r.prcp > 0 && r.prcp < m2 ? r.prcp : m2), m), Infinity);
    // a season's total: given on three days in four and through half of them, held over two midnights at least, and over more
    // than two for each reset, a year apart at least and a year after its start where it starts from 0 in the file. Or never
    // falling and kept from one day's last reading to the next day's first over two midnights, and given twice a day at least
    // (but on the file's first and last days, cut short), or rising from a 0 given, or staying well above any rise, or given
    // three times on a day where the name does not say daily (every 6 h with a reading missing; given only when it changes):
    // rising amounts in one wet hour a day or over a few midnights are none of these, and a running daily total blank before
    // each day's first tip is the last but for its name. Or opening each day far above any rise and never falling (a day or
    // two of a season's total, which a running daily total cannot be). Or never falling anywhere and kept over a midnight, on
    // days given through it on either side, where the name does not say daily: a running daily total would need as much rain
    // in the hour after midnight as the whole day before (a day or two of a season's total, or of a total reset at 7 am, has
    // no more to show). Or named as one, where the rows allow it (byName, above).
    const byRows = varies("prcp") && yearly(start === null ? cuts : [start, ...cuts]) && (carried >= 2 && carried > 2 * cuts.length && 2 * thru.filter(Boolean).length >= days.length && 4 * blankDays <= days.length
      || kept >= 2 && !drops && !cuts.length && (days.every((e, j) => e.got.length > 1 || !j || j === days.length - 1) || start !== null
        || lift > 0 && floor > 3 * lift || days.some(e => e.got.length > 2) && !/day|daily|midnight/i.test(head[C.prcp])) || high && !drops && !cuts.length || carried > 0 && !falls.length && !/day|daily|today|midnight/i.test(head[C.prcp]));
    const accum = sub && !once.prcp && (byRows || byName);
    const blankR = sub && !once.prcp && !accum && blank0; // (above)
    const heldFlat = flat >= 10 && flat >= 3 * moved; // positive and unchanged through most rows: a total held between rains
    // a running daily total is given through its wet days, or to their end on their highest reading (blank before the day's
    // first tip, or out for a few hours), most of them, or only when it changes (no reading the same as the one before it, as
    // drizzle's amounts are); each to its end on its highest, for one held flat: amounts per hour that rise within each wet
    // day, their dry hours blank, stop when the rain does. On rows minutes apart, a day's last reading held three hours on
    // the rows before it is a total too, though blank after (a total since 7 am, left blank from its reset to the next tip),
    // where every wet day that stops before its end stops within one hour of the clock (at the reset; showers stop when they will)
    const heldTo = e => { const g = e.got, L = e.list; let k = g.length - 1; while (k && g[k] - g[k - 1] === 1 && L[g[k - 1]].prcp === L[g[k]].prcp) k--; return L[g[g.length - 1]].t === null || L[g[k]].t === null ? 0 : L[g[g.length - 1]].t - L[g[k]].t + stepT; };
    const wetDays = days.map((e, j) => j).filter(j => days[j].list.some(r => r.prcp > 0)), early = wetDays.filter(j => !atEnd(days[j])).map(j => days[j].list[days[j].got[days[j].got.length - 1]].t);
    const together = early.every(t => t !== null) && (early.length < 2 || spread(early) <= 60);
    const ends = j => { const a = days[j].list.map(r => r.prcp).filter(v => v !== null); return a.length > 0 && a[a.length - 1] === top(a) && (atEnd(days[j]) || quick && together && heldTo(days[j]) >= 180); };
    const wetThru = 2 * wetDays.filter(j => thru[j] || ends(j)).length > wetDays.length;
    // a wet day held from its first tip: blank before it (not from the day's start: steady drizzle through most of a day is
    // amounts; on rows minutes apart, one value held three hours is a total from wherever it starts), then given on every row
    // to the day's last (a steady amount that stops before the day ends is amounts)
    const fromTip = j => { const g = days[j].got; return g.length > 1 && (g[0] >= gap || quick && heldTo(days[j]) >= 180) && g[g.length - 1] - g[0] === g.length - 1 && g[g.length - 1] === days[j].list.length - 1; };
    // (the file's first or last day given on one row only, the day before's total or a lone midnight row, says nothing of it)
    const toEnd = wetDays.every(ends), tipDays = wetDays.filter(j => days[j].got.length > 1 || j && j < days.length - 1);
    const running = sub && !once.prcp && !accum && !blankR && !drops && ((rises >= 3 && (wetThru || !flat)) || ((rises >= 1 || tipDays.length && tipDays.every(fromTip)) && (says || (heldFlat && toEnd))));
    /* the falls at one hour, once a day, and one at least after a climb in steps (tips adding up: drizzle jumps to its rate and
       stays), or each after the total was held over a midnight (or from before the file's start), or all within one hour of
       the clock, each after a value held three hours, where the rises before them began at other hours (rain that starts when
       it will but ends at one hour each day is a reset); a single fall after a climb in steps, or of a total held from before
       the file's start (yesterday's, to a reset at 7 am or 00:00 UTC); without clock times, as they come. On rows minutes
       apart a value held three hours is a total in itself (equal amounts every few minutes for hours are a storm's, not
       drizzle's), and one held less is not, from before the file's start or not (an hour of steady rain as the file opens),
       unless the file's last reading is held three hours after a fall to blank rows, or after a climb in two steps or more, or
       in one to another value than it fell from: yesterday's total held an hour to a reset at 06:00 UTC, then climbing and
       held (amounts that ease to a steady rate to the file's end, or stop and come back at the rate they had, are no total) */
    const stood = f => f.hold !== null && f.hold >= 180, fin = days.filter(e => e.got.length).pop();
    const oneHour = falls.some(f => f.t === null) || (falls.length === 1 ? falls[0].climb >= 2 || (quick ? stood(falls[0]) || last > 0 && heldTo(fin) >= 180 && (falls[0].lag || climb > 1 || climb > 0 && last !== falls[0].top) : falls[0].lead)
      : new Set(falls.map(f => f.d)).size === falls.length && spread(falls.map(f => f.t)) <= 120 && (falls.some(f => f.climb >= 2) || falls.every(f => f.over)
        || spread(falls.map(f => f.t)) <= 60 && falls.every(stood) && (falls.some(f => f.from === null) || spread(falls.map(f => f.from)) > 60)));
    const resets = sub && !once.prcp && !accum && !blankR && !!drops && (says || (heldFlat && oneHour));
    if (resets || accum || blankR) { // in time order, across days
      let before = null, at = null;
      // (by its name, a total given only when it changes: its dry hours written 0 add nothing, and only days missing from the
      // file are gaps, not days of rows left blank)
      const missed = d => { if (!byName || !sparse) return d - at > 1; for (let x = at + 1; x < d; x++) if (!perDay.has(x)) return true; return false; };
      days.forEach((e, j) => e.list.forEach(r => {
        if (r.prcp === null) { if (blankR && !gapF.has(r) && !heldB.has(r)) before = 0; return; } // (a total left blank while it is 0; not a reading missing or a value held through an outage)
        const v = r.prcp;
        if (byName && r.dry0) { r.prcp = 0; at = dayKeys[j]; return; }
        // a season's total that rose over missing days rose by their rain, not this day's
        if (before === null || (accum && missed(dayKeys[j]))) r.prcp = 0;
        else if (v >= before) r.prcp = v - before;
        else if (accum && (byRows ? 10 * v >= 9 * before || r.dip : r.waver)) { r.prcp = 0; at = dayKeys[j]; return; } // a dip, as a weighing gauge's total wavers: rain is a rise past its highest
        else r.prcp = v;
        before = v; at = dayKeys[j];
      }));
    }
    days.forEach(e => e.list.forEach(r => { delete r.dip; delete r.dry0; delete r.waver; }));
    const accumDay = !sub && season; // daily rows of a season's total
    // NRCS SCAN and SNOTEL give the total at each day's start, so what it rose by to the next day's start fell on the day
    const sod = accumDay && /start of (the )?day/i.test(head[C.prcp]);
    if (accumDay) {
      const rain = new Map();
      let before = null, at = null;
      dayKeys.forEach((d, j) => {
        const v = dayRain[j];
        if (v === null) return;
        const dip = before !== null && v < before && 2 * v >= before;
        if (before !== null && d - at === 1) rain.set(sod ? at : d, v >= before ? v - before : dip ? 0 : v); // next to a missing day, not known
        if (!dip) before = v;
        at = d;
      });
      days.forEach((e, j) => e.list.forEach(r => { r.prcp = rain.has(dayKeys[j]) ? rain.get(dayKeys[j]) : null; }));
    }
    const energy = !POWER.has(UN.srad.u); // an energy adds up through the day; W/m² and kW/m² average
    const summary = list => (list.length === 1 ? { ...list[0] } : !sub ? Object.fromEntries(FIELDS.map(k => [k, pool(list, k, lastOf)]))
      : { tmax: pool(list, "tmax", top), tmin: pool(list, "tmin", low), rhmax: pool(list, "rhmax", top), rhmin: pool(list, "rhmin", low), rh: pool(list, "rh", meanOf), tdew: pool(list, "tdew", meanOf), wind: pool(list, "wind", meanOf),
        prcp: pool(list, "prcp", once.prcp ? lastOf : running ? top : sumOf), srad: pool(list, "srad", once.srad ? lastOf : energy ? sumOf : meanOf), et0: pool(list, "et0", once.et0 ? lastOf : sumOf) });
    const byDay = new Map(), rawDay = { srad: [], wind: [], wet: [] };
    perDay.forEach((e, d) => {
      const v = summary(e.list);
      if (v.srad !== null) rawDay.srad.push(v.srad);
      if (v.wind !== null) rawDay.wind.push(v.wind * to10);
      if (v.prcp > 0) rawDay.wet.push(v.prcp);
      BY_DAY.forEach(k => { if (v[k] !== null && (v[k] < WX_LIMITS[k][0] || v[k] > WX_LIMITS[k][1])) { seen.out[k] = (seen.out[k] || 0) + 1; v[k] = null; } });
      ["rh", "rhmax", "rhmin"].forEach(k => { if (v[k] === 0) { seen.out[k] = (seen.out[k] || 0) + 1; v[k] = null; } }); // the cell limit keeps 0, a sensor's reading at night
      // in °C, Tmax = Tmin = 0 is a placeholder too: all its zeros, as the model files take it (0 °F is a winter reading)
      if (UN.tmax.u === "C" && UN.tmin.u === "C" && v.tmax === 0 && v.tmin === 0) { seen.out.zero = (seen.out.zero || 0) + 1; FIELDS.forEach(k => { if (v[k] === 0) v[k] = null; }); }
      byDay.set(d, { ...v, wind10: v.wind === null ? null : v.wind * to10, wind2: v.wind === null ? null : v.wind * to2 });
    });
    const ds = [...byDay.keys()].sort((a, b) => a - b), d0 = ds[0], d1 = ds[ds.length - 1];
    // the header each quantity was read from, so a wrong match can be seen, and what was read in a way worth saying
    const at = { ...C, ...L.cols };
    const keys = [...Object.keys(L.cols), "tmax", "tmin", "prcp", "srad", "rh", "rhmax", "rhmin", "tdew", "wind", "et0"];
    const notes = [], plural = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
    const unread = L.cols.date === undefined ? C.dates.filter(i => /date/.test(colName(head[i]))) : [];
    if (fromRow.length) notes.push(`Units from the row under the header: ${fromRow.join(", ")}.`);
    if (fromCell.length) notes.push(`Units written in the cells: ${fromCell.join(", ")}.`);
    if (seen.other) notes.push(`${plural(seen.other, "cell gives", "cells give")} another unit than the rest of its column (first: "${seen.otherAt}"), read as missing.`);
    if (tenths) notes.push(`As in GHCN's own daily CSV, ${["tmax", "tmin", "prcp", "wind"].filter(k => C[k] >= 0).map(k => name(C[k])).join(", ")} hold tenths (of °C, mm and m/s), so they were divided by 10.`);
    if (dayl >= 0) notes.push(`${name(C.srad)} is the mean over the daylight, so it is multiplied by ${name(dayl)} to give the day's MJ/m².`);
    if (L.dayFirst) notes.push(`${name(L.cols.date)} is read as day/month/year, as it has first numbers above 12.`);
    if (unread.length) notes.push(`The ${name(unread[0])} column could not be read as dates (YYYY-MM-DD or M/D/YYYY), so the days come from ${Object.values(L.cols).map(name).join(", ")}.`);
    if (seen.moved) notes.push(`Campbell TOA5 file: each record is stamped at the end of its interval, so one stamped at midnight belongs to the day before (${seen.moved}).`);
    if (seen.ending) notes.push(`The rows are stamped at the end of their interval (as the file's ends and its midnight rows show), so one stamped at midnight belongs to the day before (${seen.ending}).`);
    if (seen.lost) notes.push(`${plural(seen.lost, "row with weather values was", "rows with weather values were")} left out for want of a readable date (first: "${seen.lostAt}").`);
    if (seen.same) notes.push(`${plural(seen.same, "row is an exact repeat", "rows are exact repeats")} of another, and counted once.`);
    if (sub && back) notes.push("The rows run newest first, so each day's rows were put in time order before the day was summarised.");
    if (repeat.length && sub) {
      const few = counts.filter(k => k < usual / 2).length;
      notes.push(`${plural(repeat.length, "day appears", "days appear")} more than once, as the rows run through the day, so each day is summarised: the highest Tmax, the lowest Tmin, the rain ${once.prcp ? "as the one value on its rows" : running ? "at its largest" : resets || accum || blankR ? "from what it rose by" : "added up"}, ${C.srad < 0 ? "" : `solar radiation ${once.srad ? "as the one value on its rows" : energy ? "added up" : "averaged"}, `}and the mean of the rest.${few ? ` ${plural(few, "day has", "days have")} under half the usual ${usual} rows, so ${few === 1 ? "it reads" : "they read"} from part of a day.` : ""}`);
      if (running) notes.push(`${name(C.prcp)} only rises within each day, so it was taken as a running daily total.`);
      if (resets || blankR) notes.push(`${name(C.prcp)} was taken as a running total that resets at some hour, so each row adds what it rose by${blankR ? " (it is left blank while it is 0, as it goes blank after holding its value, which no season's total does: the first reading after blank rows adds all it holds)" : ""}.`);
      if (accum) notes.push(`${name(C.prcp)} keeps adding up from day to day (a running total since a season's start${(byRows ? cuts : cutN).length ? ", reset once a year" : ""}${byRows ? "" : ", as its name says"}), so each day's rain is what it rose by from the day before.`);
      if (once.prcp) notes.push(`${name(C.prcp)} holds one value through each day, so it was taken as that day's rain.`);
    } else if (repeat.length) notes.push(`${plural(repeat.length, "day appears", "days appear")} more than once (is this a daily file?); each column's last value on the day is used.`);
    if (accumDay) notes.push(`${name(C.prcp)} never falls${dayCuts.length ? " but at a yearly reset" : ""} and holds its value over dry days, so it was taken as a running total since a season's start: each day's rain is what it rose by ${sod ? "to the next day's start" : "from the day before"}, and a day next to a missing one (or the file's ${sod ? "last" : "first"}) is left as a gap.`);
    // rain that may not be each day's amount: a second-choice column, or one that only ever rises (a running total)
    if (C.rank.prcp <= 2 && !sub && !accumDay) notes.push(`${name(C.prcp)} is read as each day's rain.`);
    const rain = ds.map(k => byDay.get(k).prcp).filter(v => v !== null);
    let up = 0, down = 0;
    rain.forEach((v, i) => { if (i && v > rain[i - 1]) up++; else if (i && v < rain[i - 1]) down++; });
    if (up >= 5 && !down) notes.push(`${name(C.prcp)} only ever rises, so it looks like a running total, not each day's rain: use a column of daily amounts, or the day-to-day differences.`);
    if (seen.trace.size) notes.push(`Trace rain ("T") on ${plural(seen.trace.size, "day", "days")} is read as 0.`);
    if (seen.codes) notes.push(`${plural(seen.codes, "cell holds", "cells hold")} a code such as 999 or 9999, read as missing.`);
    if (seen.marked) notes.push(`${plural(seen.marked, "cell has", "cells have")} text after the number (first: "${seen.markedAt}"), read as the number.`);
    const bad = FIELDS.filter(k => seen.bad[k]), none = bad.filter(k => !seen.good[k]);
    if (bad.length) notes.push(`Cells that do not read as a number were left as gaps: ${bad.map(k => `${name(C[k])} ${plural(seen.bad[k], "cell", "cells")} (first: "${seen.badAt[k]}")`).join(", ")}.`);
    if (none.length) notes.push(`${none.map(k => name(C[k])).join(", ")} ${none.length === 1 ? "has" : "have"} no cell that reads as a number, so ${none.length === 1 ? "it is" : "they are"} all gaps: check how the numbers are written (a decimal comma in a comma-separated file, thousands separators, a mark after the number).`);
    const outs = Object.entries(seen.out);
    if (outs.length) notes.push(`Values no station reports were left as gaps: ${outs.map(([k, n]) => `${OUT_TEXT[k]}, ${plural(n, "time", "times")}`).join("; ")}.`);
    const asFrac = Object.keys(fracs).filter(k => fracs[k] === "named");
    if (asFrac.length) notes.push(`${asFrac.map(k => name(C[k])).join(", ")} ${asFrac.length === 1 ? "gives" : "give"} humidity as a fraction, so it was multiplied by 100.`);
    if (Object.values(fracs).some(f => f === true)) notes.push("Humidity is 1 or less on every day, so it was read as a fraction and multiplied by 100.");
    const out = { source: "file", lat, lon, elev, columns: Object.fromEntries(keys.filter(k => at[k] >= 0).map(k => [k, head[at[k]]])), notes,
      units: Object.fromEntries(Object.keys(UN).filter(k => C[k] >= 0).map(k => [k, UN[k]])), windHeight: { z: zh, stated: zs !== null },
      days: [], prcp: [], tmax: [], tmin: [], srad: [], rh: [], rhmax: [], rhmin: [], tdew: [], vp: [], wind10: [], wind2: [], et0: [] };
    for (let d = d0; d <= d1; d++) {
      const v = byDay.get(d) || {};
      out.days.push(d);
      ["prcp", "tmax", "tmin", "srad", "rhmax", "rhmin", "wind10", "wind2"].forEach(k => out[k].push(v[k] ?? null));
      const has = x => x !== null && x !== undefined, es = T => 0.6108 * Math.exp((17.27 * T) / (T + 237.3));
      const esm = has(v.tmax) && has(v.tmin) ? (es(v.tmax) + es(v.tmin)) / 2 : null; // saturation vapour pressure (FAO-56 Eq. 12)
      let rh = has(v.rh) ? v.rh : has(v.rhmax) && has(v.rhmin) ? (v.rhmax + v.rhmin) / 2 : null;
      // vapour pressure (kPa) from the dew point, else from RHmax and RHmin (FAO-56 Eq. 17), else from mean RH (Eq. 19)
      let vp = has(v.tdew) ? es(v.tdew) : null;
      if (vp === null && esm !== null) {
        if (has(v.rhmax) && has(v.rhmin)) vp = (es(v.tmin) * v.rhmax / 100 + es(v.tmax) * v.rhmin / 100) / 2;
        else if (has(rh)) vp = (rh / 100) * esm;
      }
      // mean RH from the dew point when the file gives no RH (Eq. 19 the other way), at most 100 %
      if (rh === null && vp !== null && esm !== null) rh = Math.min(100, (100 * vp) / esm);
      out.rh.push(rh);
      out.vp.push(vp);
      out.tdew.push(has(v.tdew) ? v.tdew : vp > 0 ? (237.3 * Math.log(vp / 0.6108)) / (17.27 - Math.log(vp / 0.6108)) : null);
      out.et0.push(v.et0 ?? null);
    }
    // a unit that does not fit shows in the values as read, before any were left as gaps: say so, as nothing else would
    const odd = (k, val, hi2, say) => { if (val !== null && val > hi2) notes.push(`${name(C[k])} reads as ${say(val)} on a typical day: check its unit.`); };
    odd("tmax", mid(rawT.tmax), 48, v => `${v.toFixed(0)} °C`);
    odd("srad", mid(rawDay.srad), 45, v => `${v.toFixed(0)} MJ/m²`);
    odd("wind", mid(rawDay.wind), 25, v => `${v.toFixed(0)} m/s at 10 m`);
    if (rawDay.wet.length) odd("prcp", mid(rawDay.wet), 100, v => `${v.toFixed(0)} mm on a wet day`);
    return out;
  }
  /* fill gaps of a user series from another series on the same days (e.g. gridMET); counts what was filled. ET0 is
     not taken over: days without the file's own ET0 get FAO-56 from the filled series, so the user's weather sets it. */
  function fillGaps(wx, from) {
    const ix = new Map(from.days.map((d, k) => [d, k])), filled = {};
    ["prcp", "tmax", "tmin", "srad", "rh", "rhmax", "rhmin", "tdew", "vp", "wind10", "wind2"].forEach(key => {
      wx[key] = wx[key].map((v, k) => {
        if (v !== null && v !== undefined) return v;
        const j = ix.get(wx.days[k]);
        const f = j === undefined ? null : from[key][j];
        if (f !== null && f !== undefined) filled[key] = (filled[key] || 0) + 1;
        return f ?? null;
      });
    });
    return filled;
  }
  /* ---------- zip ---------- */
  const JSZIP = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
  let zipLib = null;
  function loadZip() {
    if (window.JSZip) return Promise.resolve(window.JSZip);
    return zipLib || (zipLib = new Promise((res, rej) => {
      const s = document.createElement("script");
      // a failed load is forgotten, so the next download tries the CDN again
      const fail = () => { zipLib = null; s.remove(); rej(new Error("Could not load the zip library")); };
      s.src = JSZIP; s.onload = () => (window.JSZip ? res(window.JSZip) : fail()); s.onerror = fail;
      document.head.appendChild(s);
    }));
  }
  /* onUpdate, optional: JSZip's { percent, currentFile } as it packs */
  async function zip(files, onUpdate) {
    const Z = await loadZip(), z = new Z();
    files.forEach(f => (f.blob ? z.file(f.name, f.blob, { compression: /\.tif$/.test(f.name) ? "STORE" : "DEFLATE" }) : z.file(f.name, f.text)));
    return z.generateAsync({ type: "blob", compression: "DEFLATE" }, onUpdate);
  }

  /* the Excel library, for reading and for templates; a failed load is forgotten, so the next try loads it again */
  const XLSX_LIB = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
  let xlsxLib = null;
  const loadXlsx = () => (window.XLSX ? Promise.resolve() : xlsxLib || (xlsxLib = new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = XLSX_LIB; s.onload = res;
    s.onerror = () => { xlsxLib = null; s.remove(); rej(new Error("could not load the Excel library; check the connection and try again")); };
    document.head.appendChild(s);
  })));

  return { surveySoil, compSoil, surveyLayers, userSoil, SOIL_COLS, soilTemplateCSV, parseSoilCSV, csvRows, parseWeatherCSV, fillGaps, relayer, relayerLayers, zip, loadXlsx, writers: {}, r };
})();
