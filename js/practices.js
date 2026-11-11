/* Practices: land-use questions → site-specific wind-erosion control plan.
   In Texas the rules and numbers come from Texas NRCS conservation practice standards (eFOTG), Texas A&M AgriLife
   and USDA-ARS research, TxDOT and University Lands seed specifications (docs/RESEARCH.md; sources in R below).
   In the other states they come from the state's profile, data/practices/XX.json (planState below). Each practice
   card cites its own sources. */
WG.practices = (function () {
  const { esc, fmt, MONTHS } = WG.util;
  const UN = WG.units;

  /* ------------------------------------------------------------------ units
     Values from published standards are written as in their sources (US customary): L("40–50 in"). Text is built
     at render time in the units table's choice; a converted value keeps the original in brackets,
     "102–127 cm (40–50 in)". Lookup tables used in calculations stay in their source units. */
  const NB = String.fromCharCode(160); // no-break space between number and unit, as WG.units writes it
  const UNIT_Q = { ft: "length", in: "shortLength", mi: "distance", ac: "area", "lb/ac": "massArea", "t/ac": "massAreaHeavy", "PLS/ft²": "seedDensity" };
  const GLYPH = { "¼": 0.25, "⅓": 1 / 3, "½": 0.5, "¾": 0.75 };
  const toNum = s => GLYPH[s] ?? +s.replace(/,/g, "");
  const cvd = (q, u) => UN.get(q) !== u; // is a value written in u shown converted?
  // about two significant figures (0.46, 4.6, 46, 457), three from 1,000 up (1,460)
  const dec = m => (m >= 10 || m === 0 ? 0 : m >= 1 ? 1 : Math.min(6, 1 - Math.floor(Math.log10(m))));
  const rnd = (v, m) => { if (m < 1000) return v; const p = 10 ** (Math.floor(Math.log10(m)) - 2); return Math.round(v / p) * p; };
  /* a (to b), written in unit u, as numbers in the chosen unit of q: "102–127"; d fixes the decimals */
  function nums(q, a, b, u, d) {
    const x = UN.conv(q, UN.fromUnit(q, a, u)), y = b === undefined ? null : UN.conv(q, UN.fromUnit(q, b, u));
    const m = Math.max(x, y ?? 0), dd = d ?? dec(m), f = v => fmt(d === undefined ? rnd(v, m) : v, dd);
    if (y !== null) return `${f(x)}–${f(y)}`;
    return d === undefined && dd > 0 ? f(x).replace(/\.?0+$/, "") : f(x);
  }
  /* A published value as its source writes it: "1.5 ft", "40–50 in", "¼–½ in", "10-in" (before a noun),
     "0.3 lb a.i./ac". q names the quantity where the unit alone does not (rain in inches: "precip").
     o.sq: square brackets, for a value already inside parentheses; o.n: numbers only, the unit being given by a
     column head or the sentence; o.mass: only the mass part of the unit ("2.0 lb"); o.d: fixed decimals. */
  const RE_VAL = /^([\d.,¼⅓½¾]+)(?:–([\d.,¼⅓½¾]+))?([ -])(.+)$/;
  function L(text, q, o = {}) {
    const p = text.match(RE_VAL);
    if (!p) return text;
    const [, a, b, sep, unit] = p, w = unit.match(/^(\S+) (\S+)\/(\S+)$/); // "lb PLS/ac" is lb/ac
    const u = w ? `${w[1]}/${w[3]}` : unit, qq = q || UNIT_Q[u];
    if (!qq) return text;
    const show = s => (o.mass ? s.split("/")[0] : w ? s.replace("/", ` ${w[2]}/`) : s);
    const orig = b === undefined ? a : `${a}–${b}`;
    if (!cvd(qq, u)) return o.n ? orig : `${orig}${sep === "-" ? "-" : NB}${show(u)}`;
    const v = nums(qq, toNum(a), b === undefined ? undefined : toNum(b), u, o.d), [l, r] = o.sq ? ["[", "]"] : ["(", ")"];
    return o.n ? `${v} ${l}${orig}${r}` : `${v}${NB}${show(UN.sym(qq))} ${l}${orig}${NB}${show(u)}${r}`;
  }
  // a unit symbol with a word inside: usym("massArea", "PLS") is "kg PLS/ha" or "lb PLS/ac"
  const usym = (q, word) => (word ? UN.sym(q).replace("/", ` ${word}/`) : UN.sym(q));
  // a table cell holding a published number (the column head gives the unit), the original in brackets when converted
  const cell = (q, v, u, d, orig = fmt(v, d)) => (cvd(q, u) ? `${UN.num(q, UN.fromUnit(q, v, u), d)} (${orig})` : orig);
  // a seeding rate: text, numbers and [from, to] ranges in lb/ac
  const rate = parts => parts.map(x => (typeof x === "string" ? x : L(`${[].concat(x).join("–")} lb/ac`, null, { n: 1 }))).join("");
  const AREA_WORD = { ac: "acre", ha: "hectare", "km²": "square kilometer", "mi²": "square mile" };

  const LU = [
    { id: "cropland", ic: "🌾", name: "Cropland", sub: "cotton, sorghum, wheat, peanuts" },
    { id: "rangeland", ic: "🌿", name: "Rangeland", sub: "native grassland grazing" },
    { id: "shrubland", ic: "🌵", name: "Shrubland", sub: "mesquite, shinnery, creosote" },
    { id: "pasture", ic: "🐄", name: "Pasture / hay", sub: "introduced or native forage" },
    { id: "crp", ic: "🌱", name: "CRP / go-back", sub: "conservation cover, old fields" },
    { id: "disturbed", ic: "🛢️", name: "Disturbed land", sub: "pads, pipelines, construction" },
    { id: "barren", ic: "🏜️", name: "Bare sand / dunes", sub: "blowouts, active sand" },
  ];

  const NLCD_TO_LU = { 82: "cropland", 81: "pasture", 71: "rangeland", 52: "shrubland", 31: "barren",
    21: "disturbed", 22: "disturbed", 23: "disturbed", 24: "disturbed" };

  const Q = {
    cropland: [
      { id: "crop", label: "Main crop", opts: [["cotton", "Cotton"], ["peanut", "Peanuts"], ["sorghum", "Grain sorghum"], ["corn", "Corn"], ["wheat", "Wheat"], ["other", "Other / silage / vegetables"]] },
      { id: "water", label: "Water", opts: [["dry", "Dryland"], ["irr", "Irrigated (pivot/drip)"]] },
      { id: "residue", label: "Field condition after harvest", opts: [["bare", "Bare / almost no residue"], ["low", "Some residue (< 30% cover)"], ["good", "Good residue or standing stubble"], ["cover", "Cover crop planted"]] },
      { id: "till", label: "Tillage", opts: [["conv", "Conventional (fall/spring tillage)"], ["reduced", "Reduced"], ["notill", "No-till / strip-till"]] },
      { id: "barrier", label: "Existing wind barriers", opts: [["none", "None"], ["some", "Some strips or trees"], ["yes", "Windbreaks on most fields"]] },
    ],
    rangeland: [
      { id: "cond", label: "Ground cover today", opts: [["good", "Good (> 60% grass/litter)"], ["fair", "Fair (30–60%)"], ["poor", "Poor (< 30%, bare patches)"]] },
      { id: "graze", label: "Grazing system", opts: [["cont", "Continuous, year-round"], ["rot", "Rotational / deferred"], ["none", "Not grazed"]] },
      { id: "drought", label: "Moisture now", opts: [["normal", "Normal"], ["drought", "In drought"]] },
      { id: "lpc", label: "Lesser prairie-chicken range?", opts: [["no", "No / not sure"], ["yes", "Yes (CCAA / WAFWA)"]] },
    ],
    shrubland: [
      { id: "shrub", label: "Main shrub", opts: [["mesquite", "Honey mesquite"], ["shinnery", "Sand shinnery oak"], ["creosote", "Creosotebush / tarbush"], ["sage", "Sand sagebrush"], ["juniper", "Redberry / Ashe juniper"], ["mixed", "Mixed brush"]] },
      { id: "under", label: "Grass understory", opts: [["good", "Good grass between shrubs"], ["sparse", "Sparse"], ["bare", "Mostly bare ground"]] },
      { id: "goal", label: "Main goal", opts: [["graze", "Livestock forage"], ["wild", "Wildlife habitat"], ["both", "Both"]] },
    ],
    pasture: [
      { id: "ptype", label: "Pasture type", opts: [["dry", "Dryland introduced grass"], ["irr", "Irrigated"], ["native", "Native hay meadow"], ["annual", "Annual forage (wheat, sorghum-sudan)"]] },
      { id: "cond", label: "Stand / cover", opts: [["good", "Good"], ["fair", "Fair"], ["poor", "Thin or bare"]] },
    ],
    crp: [
      { id: "stage", label: "Status", opts: [["est", "Established stand"], ["new", "New planting / establishing"], ["exp", "Contract expiring or converting to crops"]] },
      { id: "cond", label: "Cover", opts: [["good", "Good"], ["poor", "Thin / bare spots"]] },
    ],
    disturbed: [
      { id: "dtype", label: "Type", opts: [["pad", "Well pad / caliche site"], ["pipe", "Pipeline or utility right-of-way"], ["build", "Construction / development"], ["road", "Unpaved roads, lots"]] },
      { id: "stage", label: "When does disturbance end?", opts: [["spring", "Feb–Aug (seed now)"], ["fall", "Sep–Jan (going into windy season)"], ["old", "Already ended, still bare"]] },
    ],
    barren: [
      { id: "btype", label: "What is there?", opts: [["dune", "Active dunes / blowout"], ["sheet", "Bare sand sheet or old field"], ["caliche", "Caliche, gravel or rock"]] },
    ],
  };

  /* ------------------------------------------------------------------ sources */
  const R = {
    tx340: ["TX NRCS 340 Cover Crop standard (2025)", "https://efotg.sc.egov.usda.gov/api/CPSFile/48860/340_TX_CPS_Cover_Crop_2025"],
    tx340g: ["TX NRCS 340 Cover Crop guidance (2025)", "https://efotg.sc.egov.usda.gov/api/CPSFile/48861/340_TX_GD_Cover_Crop_2025"],
    lamesa: ["White, Lewis & Keeling 2020 — cover crops in cotton, AG-CARES Lamesa", "https://www.cotton.org/beltwide/proceedings/2005-2022/data/conferences/2020/paper/19810.pdf"],
    lubbock: ["White, Lewis & Keeling 2022 — dryland cover crops, Lubbock", "https://www.cotton.org/beltwide/proceedings/2005-2022/data/conferences/2022/paper/21366.pdf"],
    trostle: ["Trostle 2018 — terminated wheat/rye for seedling cotton (AgriLife)", "https://agrilife.org/texasrowcrops/?p=1487"],
    delaune: ["DeLaune — mature cover crops keep residue longer (AgriLife Today 2017)", "https://agrilifetoday.tamu.edu/2017/09/04/more-mature-cover-crops-help-maintain-residue-longer"],
    vanpelt: ["Van Pelt & Zobeck 2004 — small-grain covers, Southern High Plains", "https://topsoil.nserl.purdue.edu/isco/isco13/PAPERS%20R-Z/VAN%20PELT.pdf"],
    rma: ["NRCS/RMA cover crop termination guidelines", "https://www.rma.usda.gov/sites/default/files/2024-04/202002-NRCSRMA-CoverCrop-Brochure-Letter.pdf"],
    tx329: ["TX NRCS 329 No-Till implementation requirements (2023)", "https://efotg.sc.egov.usda.gov/api/CPSFile/44530/329_TX_IR_Residue_and_Tillage_Management_No-Till_10-30-2023"],
    tx345: ["TX NRCS 345 Reduced Till implementation requirements (2023)", "https://efotg.sc.egov.usda.gov/api/CPSFile/44536/345_TX_IR_Residue_and_Tillage_Management_Reduced_Till_10-30-2023"],
    neb: ["NebGuide G1537 — residue and wind erosion", "https://extensionpubs.unl.edu/publication/g1537/na/html/view"],
    fotg: ["TX FOTG wind erosion reference (NAM Part 502)", "https://efotg.sc.egov.usda.gov/references/public/TX/Wind_Erosion.pdf"],
    n609: ["NRCS 609 Surface Roughening", "https://www.nrcs.usda.gov/sites/default/files/2022-10/Surface_Roughening_609_CPS.pdf"],
    n588: ["NRCS 588 Cross Wind Ridges", "https://www.Nrcs.Usda.Gov/sites/default/files/2022-09/Cross_Wind_Ridges_588_CPS_Oct_2017.pdf"],
    ksu: ["K-State — emergency tillage for wind erosion", "https://eupdate.agronomy.ksu.edu/article/emergency-tillage-for-wind-erosion-concerns-491"],
    unl: ["UNL CropWatch — emergency tillage", "https://cropwatch.unl.edu/2022/using-emergency-tillage-control-wind-erosion"],
    n589: ["NRCS 589C Cross Wind Trap Strips", "https://www.nrcs.usda.gov/sites/default/files/2022-09/Cross_Wind_Trap_Strips_589_CPS.pdf"],
    tx603: ["TX NRCS 603 Herbaceous Wind Barriers (2023)", "https://efotg.sc.egov.usda.gov/api/CPSFile/44131/603_TX_CPS_Herbaceous_Wind_Barriers_2023"],
    tfs: ["Texas A&M Forest Service — West Texas invasive trees", "https://tfsweb.tamu.edu/?p=9723"],
    he: ["AgriLife — forage harvest efficiency and stocking rate", "https://agrilifeextension.tamu.edu/wp-content/uploads/2026/03/Rangeland-Risk-Management-for-Texans-Using-Forage-Harvest-Efficiency-to-Determine-Stocking-Rate.pdf"],
    tx528: ["TX NRCS 528 Prescribed Grazing implementation requirements", "https://efotg.sc.egov.usda.gov/api/CPSFile/49615/528_TX_IR_Prescribed_Grazing-FY25_Update_2019"],
    pmc: ["Knox City PMC release brochures (grazing heights)", "https://nrcs.usda.gov/plantmaterials/txpmcrb15090.pdf"],
    tx550: ["TX NRCS 550 Range Planting (2023)", "https://efotg.sc.egov.usda.gov/api/CPSFile/44127/550_TX_CPS_Range_Planting_2023"],
    texnat: ["AgriLife — Seeding rangeland (rates, depth, seed origin)", "https://texnat.tamu.edu/about/ranchers-reference-guide/seeding-rangeland"],
    txdot: ["TxDOT 2024 Item 164 seeding specifications", "https://ftp.dot.state.tx.us/pub/txdot-info/cmd/cserve/specs/2024/standard/s164.pdf"],
    owb: ["Old World bluestems invading native grassland", "https://okfronline.com/2017/12/grazing-oklahoma-old-world-bluestems/"],
    wafwa: ["WAFWA chemical brush management (sand sagebrush / shinnery)", "https://wafwa.org/wp-content/uploads/2024/03/WAFWA-Chemical-Brush-Mgmt-Sand-Sagebrush-03.14.2024.pdf"],
    nm314: ["NRCS New Mexico 314 brush management specification", "https://efotg.sc.egov.usda.gov/api/CPSFile/9555/___"],
    alvarez: ["Alvarez et al. 2012 — grass loss drives aeolian flux (Chihuahuan Desert)", "https://pmc.ncbi.nlm.nih.gov/articles/PMC3399202"],
    tx314: ["TX NRCS 314 Brush Management implementation requirements", "https://efotg.sc.egov.usda.gov/api/CPSFile/49601/314_TX_IR_Brush_Management-FY25_Update_2021"],
    ok511: ["NRCS Oklahoma 511 Forage Harvest Management (cutting heights)", "https://efotg.sc.egov.usda.gov/api/CPSFile/16161/511_OK_PS_Forage_Harvest_Management_2020"],
    tx512: ["TX NRCS 512 Pasture and Hay Planting implementation requirements", "https://efotg.sc.egov.usda.gov/api/CPSFile/49614/512_TX_IR_Pasture_and_Hay_Planting-FY25_Update_2022"],
    sare: ["SARE GS02-012 — Texas Tech low-water forage systems", "https://projects.sare.org/project-reports/gs02-012/"],
    ksu_pa: ["K-State — prussic acid in sorghum forages", "https://eupdate.agronomy.ksu.edu/article/managing-the-prussic-acid-hazard-in-sorghum-503-1"],
    crp: ["AgriLife / NRCS EAG-006 — converting CRP to cropland", "https://agecoext.tamu.edu/wp-content/uploads/2013/08/CRP.pdf"],
    csu: ["Colorado State — cover crops for dryland grass establishment", "https://extension.colostate.edu/resource/cover-crops-help-in-dryland-grass-establishment"],
    tx327: ["TX NRCS 327 Conservation Cover implementation requirements", "https://efotg.sc.egov.usda.gov/api/CPSFile/49481/327_TX_IR_Conservation_Cover-2025_Update_2014"],
    tx342: ["TX NRCS 342 Critical Area Planting implementation requirements", "https://efotg.sc.egov.usda.gov/api/CPSFile/49486/342_TX_IR_Critical_Area_Planting-FY25_Update_2018"],
    ul: ["University Lands — approved seed mixtures by county (Permian)", "https://universitylands.utsystem.edu/Content/Documents/Operations/SeedMixturesByCounties.pdf"],
    rrc: ["Texas Railroad Commission — SWR 8 pit rules", "https://www.rrc.texas.gov/oil-and-gas/publications-and-notices/manuals/surface-waste-management-manual/swr8-summary"],
    tns: ["Texas Native Seeds — Pipeline Prairies initiative", "https://www.ckwri.tamuk.edu/sites/default/files/publication/pdfs/2019/texas_native_seeds_pipeline_prairies_initiative-ip.pdf"],
    fulbright: ["Fulbright et al. 2006 — stabilizing migrating inland dunes in Texas", "https://bioone.org/journals/Rangeland-Ecology-and-Management/volume-59/issue-5/06-025R1.1/Establishing-Vegetation-on-Migrating-Inland-Sand-Dunes-in-Texas/10.2111/06-025R1.1.full"],
    beg: ["UT Bureau of Economic Geology — Monahans Sandhills", "https://beg.utexas.edu/texas-through-time/monahans-sandhills.html"],
    sandhills: ["Ecological Site Description — Sand Hills 16–21\" PZ (R077CY034TX)", "https://edit.jornada.nmsu.edu/catalogs/esd/077C/R077CY034TX"],
  };

  /* ------------------------------------------------------------------ context */
  function regionOf(mlra, lat, lon) {
    const m = (mlra || "").toUpperCase();
    if (/^77/.test(m)) return "hp";
    if (/^(78|80)/.test(m)) return "rp";
    if (/^(42|70)/.test(m)) return "tp";
    if (/^81/.test(m)) return "ep";
    if (/^83/.test(m)) return "st";
    if (m) return "east";
    if (lon < -103) return "tp";
    if (lat > 32 && lon < -101) return "hp";
    if (lon < -99) return "rp";
    return "east";
  }
  const REGION_NAME = { hp: "Southern High Plains", rp: "Rolling Plains", tp: "Trans-Pecos / Permian basins", ep: "Edwards Plateau", st: "South Texas Plains", east: "Central/East Texas" };

  function context(state, surface, risk, pf) {
    const s = state.soil && !state.soil.error ? state.soil : null;
    const d = s && s.dominant;
    const w = state.wind && !state.wind.error ? state.wind : null;
    const { lat, lon } = state.site;
    const preg = pf ? profileRegion(pf, s && s.mlra && s.mlra.sym) : null;
    const region = pf ? (preg ? preg.id : null) : regionOf(s && s.mlra && s.mlra.sym, lat, lon);
    const eco = d && d.eco ? d.eco.ecoclassname : "";
    const hz0 = d && d.horizons[0];
    const ec = hz0 ? +hz0.ec_r || 0 : 0, sar = hz0 ? +hz0.sar_r || 0 : 0, gyp = hz0 ? +hz0.gypsum_r || 0 : 0;
    const restr = d && d.restrictions.find(r => r.resdept_r !== null);
    const weg = surface ? surface.weg : null;
    let soilGroup = "loamy";
    if (/sal|salt|alkali/i.test(eco) || ec >= 4 || sar >= 13) soilGroup = "saline";
    else if (/gyp/i.test(eco) || gyp >= 15) soilGroup = "gyp";
    else if (/shallow|rock|igneous|limestone hill|gravel/i.test(eco) || (restr && +restr.resdept_r < 50)) soilGroup = "shallow";
    else if (weg === "1" || weg === "2" || (/sand/i.test(eco) && !/sandy loam/i.test(eco))) soilGroup = "sandy";
    else if (weg === "4L" || /limy|calcareous|draw/i.test(eco)) soilGroup = "limy";
    else if (weg === "4" || /clay/i.test(eco)) soilGroup = "clay";
    const pz = (eco.match(/(\d+)-(\d+)"\s*PZ/i) || []).slice(1).map(Number);
    const precipIn = pz.length ? (pz[0] + pz[1]) / 2 : w && w.annualized ? w.precip / 25.4 : null; // a part-year sum is not annual rain
    // the windy season from the data needs a whole year with months that stand out (riskMonths is empty otherwise);
    // else the usual spring season, said to be so
    const ranked = !!(w && w.riskMonths.length);
    const riskMonths = ranked ? w.riskMonths : [1, 2, 3, 4];
    const midMonths = ranked ? w.months.map((m, i) => (m.level === "mid" ? i : -1)).filter(i => i >= 0) : [0, 11];
    const seasonNote = ranked ? "" : `typical; ${!state.wind ? "wind history loading" : state.wind.insufficient ? "too little wind data in this period"
      : state.wind.error ? "wind history unavailable" : !w.annualized ? "the period does not cover all 12 months" : "erosive wind is spread evenly here"}`;
    const dunes = weg === "1" && /sand hills|dune/i.test(eco);
    return {
      lat, lon, region, regionName: pf ? (preg ? preg.name : pf.name) : REGION_NAME[region], soilGroup, weg, I: surface ? surface.wei : null, pf,
      sandy: weg === "1" || weg === "2", dunes,
      level: risk ? risk.level : null, E: risk ? risk.E : null, EI: risk ? risk.EI : null, C: risk ? risk.C : (s ? s.cFactor : null),
      riskMonths, midMonths, riskText: WG.monthsText(riskMonths), seasonNote,
      orient: w && w.prevailing !== null ? WG.orientation(w)
        : pf ? "rows across the prevailing wind of the windy season (the Wind tab gives it once the wind history loads)"
          : "rows across the prevailing spring wind (usually SW–W, so rows NW–SE or N–S)",
      prevailing: w && w.prevailing !== null ? WG.util.compass(w.prevailing) : "SW",
      precipIn, eco, ecoId: d && d.eco ? d.eco.ecoclassid : null, mlra: s && s.mlra ? s.mlra.sym : null,
      om: surface ? surface.om : null, dry: precipIn !== null && precipIn < 18,
      dist: pf ? null : txdotDistrict(region, lat, lon),
    };
  }

  /* ------------------------------------------------------------------ quantitative helpers */
  // Flat cover → erosion reduction (NebGuide G1537 table; RWEQ SLR = exp(-0.0438·cover) fits it)
  const COVER_RED = [[0, 0], [10, 35], [20, 60], [30, 70], [50, 85], [70, 93], [90, 98]];
  const coverReduction = pct => interp(COVER_RED, pct) / 100;
  // Flat small-grain-equivalent needed on WEG 1 by climatic factor C (USDA-ARS; lb/ac)
  const SGE_WEG1 = [[20, 1000], [40, 1500], [70, 2100], [100, 2500], [150, 2950]];
  // NAM Exhibit 502-1 E-table (wide field, I 86, C 100): fraction of bare-field loss left vs flat SGe (lb/ac)
  const SGE_RATIO = [[0, 1], [250, 0.876], [500, 0.706], [750, 0.540], [1000, 0.330], [1250, 0.195], [1500, 0.102], [1750, 0.053], [2000, 0.029], [2250, 0.013], [2500, 0.0035]];
  function interp(tbl, x) {
    if (x <= tbl[0][0]) return tbl[0][1];
    for (let i = 1; i < tbl.length; i++) if (x <= tbl[i][0]) {
      const [x0, y0] = tbl[i - 1], [x1, y1] = tbl[i];
      return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
    }
    return tbl[tbl.length - 1][1];
  }
  const coverTarget = weg => (weg === "1" || weg === "2" ? 60 : weg === "3" || weg === "4" || weg === "4L" ? 40 : 30);

  /* ------------------------------------------------------------------ species */
  // [common, scientific, releases / source (text, or a function when it holds a measurement), single-species drilled PLS lb/ac (AgriLife) or null]
  const SP = {
    sandbluestem: ["Sand bluestem", "Andropogon hallii", "southern Great Plains seed sources", 6.0],
    littleblue: ["Little bluestem", "Schizachyrium scoparium", "'Pastura', 'OK Select'", 3.4],
    sandlove: ["Sand lovegrass", "Eragrostis trichodes", "'Mason'", 1.5],
    switch: ["Switchgrass", "Panicum virgatum", () => `'Alamo' (${L("2.0 lb/ac", null, { mass: 1, sq: 1 })}), 'Blackwell'`, 3.5],
    indian: ["Indiangrass", "Sorghastrum nutans", () => `'Lometa' — needs ≥ ${L("22 in", "precip")} rain or run-on water`, 4.5],
    sandreed: ["Giant sandreed", "Calamovilfa gigantea", "local collections", null],
    giantdrop: ["Giant dropseed", "Sporobolus giganteus", "local collections", null],
    havard: ["Havard panicum", "Panicum havardii", "local collections", null],
    sideoats: ["Sideoats grama", "Bouteloua curtipendula", "'Haskell' (High & Rolling Plains), 'El Reno'", 4.5],
    sideoatsW: ["Sideoats grama", "Bouteloua curtipendula", "'Brewster Germplasm' (Permian, Trans-Pecos)", 4.5],
    bluegrama: ["Blue grama", "Bouteloua gracilis", "'Hachita'", null],
    buffalo: ["Buffalograss", "Bouteloua dactyloides", "'Texoka'", null],
    wwheat: ["Western wheatgrass", "Pascopyrum smithii", "'Barton' — Panhandle, cool season", 7.0],
    sprangle: ["Green sprangletop", "Leptochloa dubia", "'Van Horn' (Knox City PMC) — quick cover", 1.7],
    bristle: ["Plains bristlegrass", "Setaria vulpiseta", "'Catarina Blend'", 3.0],
    cottontop: ["Arizona cottontop", "Digitaria californica", "'La Salle' (South Texas source)", null],
    vinemesq: ["Vine mesquite", "Hopia obtusa", "local seed — draws, run-in sites", null],
    canebs: ["Cane bluestem", "Bothriochloa barbinodis", "local seed", null],
    silverbs: ["Silver bluestem", "Bothriochloa laguroides", "'Santiago' (West Texas Native Seeds)", null],
    blackgrama: ["Black grama", "Bouteloua eriopoda", "'Nogal'", 1.5],
    hairygrama: ["Hairy grama", "Bouteloua hirsuta", "'Chaparral'", null],
    bushmuhly: ["Bush muhly", "Muhlenbergia porteri", "no commercial release — local seed", null],
    sacaton: ["Alkali sacaton", "Sporobolus airoides", "'Saltalk' (Knox City PMC, saline sites)", 1.0],
    sanddrop: ["Sand dropseed", "Sporobolus cryptandrus", "'Taylor'", 1.0],
    whiplash: ["Whiplash pappusgrass", "Pappophorum vaginatum", "'Permian Germplasm'", null],
    windmill: ["Hooded windmillgrass", "Chloris cucullata", "'Burnet'", null],
    galleta: ["Galleta", "Pleuraphis jamesii", "'Viva'", null],
    tridens: ["White tridens", "Tridens albescens", "'Guadalupe'", null],
    wildrye: ["Canada wildrye", "Elymus canadensis", "'Lavaca' — cool season", null],
    saltbush: ["Fourwing saltbush", "Atriplex canescens", "shrub; local seed (no Texas release confirmed)", null],
  };

  const NATIVE_MIX = {
    hp: { sandy: ["sandbluestem", "littleblue", "sandlove", "switch", "sandreed", "giantdrop", "bristle", "sanddrop", "windmill"],
      loamy: ["sideoats", "bluegrama", "buffalo", "silverbs", "sprangle", "bristle", "windmill", "littleblue"],
      clay: ["sideoats", "bluegrama", "buffalo", "wwheat", "vinemesq", "tridens", "wildrye", "sprangle"],
      limy: ["sideoats", "bluegrama", "blackgrama", "hairygrama", "canebs", "silverbs", "sprangle"],
      saline: ["sacaton", "wwheat", "vinemesq", "saltbush"],
      shallow: ["sideoats", "blackgrama", "hairygrama", "canebs", "littleblue", "whiplash"],
      gyp: ["sacaton", "sideoatsW", "galleta", "saltbush"] },
    rp: { sandy: ["sandbluestem", "littleblue", "sandlove", "switch", "indian", "bristle", "sanddrop", "windmill"],
      loamy: ["sideoats", "littleblue", "bluegrama", "buffalo", "silverbs", "sprangle", "bristle", "windmill"],
      clay: ["sideoats", "buffalo", "bluegrama", "wwheat", "vinemesq", "tridens", "wildrye"],
      limy: ["sideoats", "littleblue", "canebs", "hairygrama", "silverbs", "sprangle"],
      saline: ["sacaton", "wwheat", "vinemesq", "saltbush"],
      shallow: ["sideoats", "littleblue", "canebs", "hairygrama", "whiplash"],
      gyp: ["sacaton", "sideoats", "saltbush"] },
    tp: { sandy: ["sanddrop", "giantdrop", "havard", "bristle", "sprangle", "sideoatsW", "hairygrama", "sandlove", "windmill"],
      loamy: ["blackgrama", "bluegrama", "sideoatsW", "bushmuhly", "cottontop", "bristle", "sprangle", "whiplash", "galleta"],
      clay: ["sacaton", "bluegrama", "sideoatsW", "galleta", "vinemesq", "sprangle"],
      limy: ["blackgrama", "sideoatsW", "hairygrama", "bushmuhly", "canebs", "whiplash", "sprangle"],
      saline: ["sacaton", "saltbush", "sprangle", "galleta"],
      shallow: ["sideoatsW", "blackgrama", "hairygrama", "canebs", "bushmuhly", "whiplash"],
      gyp: ["sacaton", "blackgrama", "galleta", "saltbush"] },
    ep: { sandy: ["littleblue", "sideoats", "bristle", "sprangle", "indian", "switch", "windmill"],
      loamy: ["sideoats", "littleblue", "silverbs", "bristle", "sprangle", "windmill", "cottontop"],
      clay: ["sideoats", "buffalo", "vinemesq", "tridens", "wildrye", "sprangle"],
      limy: ["sideoats", "littleblue", "canebs", "hairygrama", "whiplash", "silverbs", "sprangle"],
      saline: ["sacaton", "vinemesq", "saltbush"],
      shallow: ["sideoats", "littleblue", "canebs", "hairygrama", "whiplash", "silverbs"],
      gyp: ["sacaton", "sideoats"] },
  };
  NATIVE_MIX.st = NATIVE_MIX.rp;
  NATIVE_MIX.east = NATIVE_MIX.rp;

  function speciesRows(ctx, group) {
    const keys = (NATIVE_MIX[ctx.region] || NATIVE_MIX.rp)[group || ctx.soilGroup] || NATIVE_MIX.rp.loamy;
    return keys.map(k => SP[k]).filter(Boolean);
  }

  // TxDOT 2024 Item 164 permanent rural seed mixes, lb PLS/ac drilled (broadcast +25%)
  const TXDOT = {
    Lubbock: {
      clay: [["Sideoats grama 'Haskell'", 1.5], ["Blue grama", 0.6], ["Silver bluestem", 0.6], ["Buffalograss", 1.5], ["White tridens", 0.2], ["Green sprangletop", 0.4], ["Hooded windmillgrass", 0.1], ["Galleta", 0.3], ["Western wheatgrass", 3.0], ["Canada wildrye", 1.0]],
      sandy: [["Green sprangletop", 0.6], ["Blue grama", 0.6], ["Sideoats grama", 1.0], ["Little bluestem", 0.7], ["Hooded windmillgrass", 0.2], ["Sand dropseed", 0.2], ["Silver bluestem", 0.4], ["Arizona cottontop", 0.4], ["Sand lovegrass", 0.3]],
    },
    Odessa: {
      clay: [["Whiplash pappusgrass", 0.9], ["Green sprangletop", 0.4], ["Silver bluestem", 0.6], ["Sideoats grama 'Brewster'", 1.0], ["Sand dropseed", 0.2], ["Alkali sacaton 'Saltalk'", 0.2], ["Arizona cottontop", 0.4], ["Blue grama", 0.4], ["Galleta", 0.6]],
      sandy: [["Sand dropseed", 0.3], ["Green sprangletop", 0.4], ["Sideoats grama 'Brewster'", 1.5], ["Whiplash pappusgrass", 0.6], ["Hooded windmillgrass", 0.2], ["Blue grama", 0.4], ["Hairy grama", 0.4], ["Sand lovegrass", 0.3], ["Little bluestem 'Pastura'", 0.5], ["Galleta", 0.3]],
    },
    "El Paso": {
      clay: [["Green sprangletop", 0.4], ["Sideoats grama 'Brewster'", 1.0], ["Whiplash pappusgrass", 0.6], ["Silver bluestem", 0.4], ["Blue grama", 0.4], ["Galleta", 0.6], ["Alkali sacaton", 0.2], ["Arizona cottontop", 0.4], ["Plains bristlegrass 'Catarina'", 0.4], ["False Rhodes grass 'Kinney'", 0.2]],
      sandy: [["Sand dropseed", 0.4], ["Sideoats grama", 1.5], ["Green sprangletop", 0.6], ["Hooded windmillgrass", 0.2], ["Blue grama", 0.4], ["Hairy grama", 0.2], ["Spike dropseed 'Potter'", 0.1], ["Little bluestem 'Pastura'", 0.5], ["Galleta", 0.6]],
    },
  };
  function txdotDistrict(region, lat, lon) {
    if (lon < -104.6) return "El Paso";
    if (region === "tp" || (lat < 32.4 && lon < -101.2 && lon > -104.6)) return "Odessa";
    if (region === "hp") return "Lubbock";
    return null;
  }
  // University Lands approved Permian mix (all listed counties), lb PLS/ac
  const UL_MIX = [["Sideoats grama 'El Reno'", 0.68], ["Blue grama", 0.23], ["Plains bristlegrass", 0.45], ["Sand dropseed", 0.20],
    ["Green sprangletop 'Van Horn'", 0.34], ["Pearl millet (nurse crop)", 1.00], ["Maximilian sunflower", 0.09],
    ["Engelmann daisy 'Eldorado'", 0.60], ["Purple prairie clover 'Kaneb'", 0.12], ["Mexican hat", 0.08]];

  // [crop, scientific, notes, seeding rate: text, numbers and [from, to] ranges in lb/ac (TX 340), shown by rate()]
  const COVER = {
    rye: ["Cereal rye", "Secale cereale", "most biomass; often beats wheat on dryland; best on sands", [30, " dryland · ≤ ", 60, " irrigated"]],
    wheat: ["Winter wheat", "Triticum aestivum", "let it reach ~50% heading for longer-lasting residue (Rolling Plains)", [30, " dryland · ≤ ", 60, " irrigated"]],
    triticale: ["Triticale", "× Triticosecale", "tested at Lubbock with no cotton yield penalty", ["≈ ", 30]],
    strips: ["Bed-shoulder wheat or rye", "—", "South Plains practice: drill on bed shoulders, plant cotton on the bed top", [[10, 20]]],
    sorghum: ["Forage sorghum / sorghum-sudan", "Sorghum bicolor", "summer barrier rows or dead-litter cover for grass seeding", ["per seed label"]],
    millet: ["Pearl millet", "Cenchrus americanus", "summer cover / nurse crop on sands (TxDOT temporary: Brownton millet)", [20, " (temporary cover)"]],
    oats: ["Oats + wheat", "Avena sativa, Triticum", "TxDOT cool-season temporary cover, Sep 1–Jan 31", ["per TxDOT Table 3"]],
  };

  /* ------------------------------------------------------------------ plans */
  function plan(lu, a, ctx) {
    const P = [];
    const add = (pri, title, code, why, specs, when, months, refs) =>
      P.push({ pri, title, code, why, specs: specs.filter(Boolean), when, months, refs: refs || [] });
    const rt = ctx.riskText;
    const notes = [];
    let species = null, mix = null, coverTable = null, residueTable = null, title = "", summary = "";
    const sandy = ctx.sandy, weg = ctx.weg;
    const target = coverTarget(weg);
    const tp = ctx.region === "tp";
    const seedWindow = tp ? "mid-summer, with the monsoon (Jun–Aug)" : ctx.dist === "Lubbock" ? "Feb 15–May 15" : "Feb 1–May 15";
    const seedMonths = tp ? [5, 6, 7] : [1, 2, 3, 4];
    const mixFor = group => ctx.dist && TXDOT[ctx.dist] ? {
      title: `TxDOT 2024 permanent rural mix — ${ctx.dist} district, ${group} soils`,
      rows: TXDOT[ctx.dist][group], note: `${usym("massArea", "PLS")} drilled; add 25% if broadcast. Published for right-of-way seeding; a good starting mix for rangeland and reclamation in this district.`,
      ref: "txdot",
    } : null;
    const txGroup = weg === "1" || weg === "2" || weg === "3" ? "sandy" : "clay";

    if (lu === "cropland") {
      const crop = a.crop || "cotton", irr = a.water === "irr", res = a.residue || "bare", till = a.till || "conv";
      const lowResCrop = crop === "cotton" || crop === "peanut" || crop === "other";
      const bareAfter = res === "bare" || res === "low" || (lowResCrop && res !== "good" && res !== "cover");
      const cropName = { cotton: "cotton", peanut: "peanuts", sorghum: "grain sorghum", corn: "corn", wheat: "wheat", other: "row crop" }[crop];
      title = `Cropland — ${cropName}, ${irr ? "irrigated" : "dryland"}`;
      summary = bareAfter
        ? `Fields left bare from harvest through ${rt} are the main source of blowing soil in West Texas. The plan keeps cover or roughness on the surface for that whole window — aim for at least ${target}% surface cover on this soil.`
        : `You already leave cover after harvest. Keep it standing through ${rt} (target ≥ ${target}% cover on this soil) and add barriers on the most erodible fields.`;

      if (weg === "1") {
        add(1, "Consider retiring this field to permanent cover", "NRCS 327 / 550",
          "NRCS rates WEG 1 sands as generally unsuited to annual cropping and hard to revegetate.",
          ["If it stays in crops, every one of the following is needed: cover crop, no-till, barriers or trap strips at ≤ 10× barrier height, and ≥ 60% surface cover through the windy season.",
            "Otherwise convert to a native grass stand — see the CRP / go-back plan for establishment into a sorghum dead-litter cover."],
          "Decide before the next harvest", null, ["fotg", "tx327"]);
      }
      if (res !== "cover" && (bareAfter || sandy || res === "low")) {
        const term = irr ? "2–4 weeks" : "6–8 weeks";
        add(bareAfter || sandy ? 1 : 2, "Plant a winter small-grain cover crop", "NRCS 340",
          `Small-grain covers cut wind erosion by two to three orders of magnitude in Southern High Plains tests, and their standing residue protects through ${rt}.`,
          [`Drill cereal rye or wheat right after harvest — the South Plains window is mid-August to Thanksgiving${crop === "peanut" ? "; for peanuts, within days of threshing" : crop === "cotton" ? "" : ""}.`,
            `Seeding rate: ${irr ? `up to ${L("60 lb/ac")} irrigated` : `${L("30 lb/ac")} dryland — ${L("60 lb/ac")} produced no more biomass and no better cotton yields at Lamesa`}. Alternative: ${L("10–20 lb/ac")} in bed-shoulder strips, cotton planted on the bed top.`,
            `Orient drill rows across the windy-season wind: ${ctx.orient}.`,
            `Terminate with herbicide ${term} before planting${irr ? "" : " — cotton yields matched conventional tillage in 3–4 years of Lamesa and Lubbock trials"}. Crop-insurance termination rules: ≥ 35 days before planting in the arid zone (irrigated fields exempt).`,
            "Leave it standing — no tillage, no haying; if grazed, remove ≤ 50% per grazing cycle (TX 340).",
            `Plant ${crop === "peanut" ? "peanuts" : "the cash crop"} no-till or strip-till into the residue.`],
          `Plant mid-Aug–Nov · protects through ${rt} · terminate ${irr ? "Apr–May" : "late Mar–mid Apr"}`,
          { act: [8, 9, 10].concat(irr ? [3] : [2, 3]), on: [11, 0, 1].concat(irr ? [2] : [], [4]) },
          ["tx340", "lamesa", "lubbock", "trostle", "vanpelt", "rma"]);
        coverTable = [COVER.rye, COVER.wheat, COVER.triticale, COVER.strips];
      }
      if (till !== "notill") {
        add(bareAfter ? 2 : 1, "Switch to no-till or strip-till; keep residue standing", "NRCS 329 / 345",
          "Each tillage pass buries residue and loosens the surface. Standing residue is worth roughly 2–10× the same residue lying flat.",
          ["No full-width tillage from harvest to planting (TX 329: STIR ≤ 20; strip-till strips ≤ 30% of the row width). Reduced till: STIR ≤ 45.",
            `Cover target for this soil: ≥ ${target}% through ${rt}. Flat cover cuts erosion about ${fmt(coverReduction(30) * 100, 0)}% at 30% cover, ${fmt(coverReduction(50) * 100, 0)}% at 50% and ${fmt(coverReduction(70) * 100, 0)}% at 70%.`,
            crop === "cotton" || crop === "peanut" ? "Do not shred-and-disk cotton stalks in fall; leave them anchored. Strip-till only the planting row." : `Harvest high and leave grain sorghum, corn or wheat stubble standing — ${L("10-in")} standing wheat stubble across the wind protects like 3.5× its weight of flat straw.`,
            weg === "1" && ctx.C ? `On WEG 1 with C = ${fmt(ctx.C, 0)}, about ${fmt(Math.round(UN.conv("massArea", interp(SGE_WEG1, ctx.C)) / 50) * 50, 0)}${NB}${UN.sym("massArea")} flat small-grain-equivalent residue is needed.` : "",
            "Never till on dry, windy days."],
          `Year-round · most important ${rt}`, { on: [9, 10, 11, 0, 1, 2, 3, 4] }, ["tx329", "tx345", "neb"]);
      } else {
        add(3, "Keep the no-till residue intact", "NRCS 329",
          "No-till works only while residue stays on the surface.",
          [`Keep ≥ ${target}% cover through ${rt}.`, "Limit stalk grazing so residue isn't trampled flat or removed."],
          "Year-round", { on: [9, 10, 11, 0, 1, 2, 3, 4] }, ["tx329", "neb"]);
      }
      if (lowResCrop || crop === "wheat") {
        add(2, "Rotate with a high-residue crop", "NRCS 328",
          `${crop === "wheat" ? "Wheat protects well only if stubble stays standing and is not grazed out." : "Texas NRCS classes cotton, peanuts and silage as low-residue crops."} TX 340 requires at least one high-residue crop or high-biomass cover in the rotation.`,
          ["High-residue options: grain sorghum, wheat, corn for grain, millets, sudangrass hybrids, or a winter/summer cover crop.",
            "In Lubbock dryland trials, no-till wheat–cotton gave the highest cotton yield."],
          "Plan the rotation each year", null, ["tx340g", "lubbock"]);
      }
      add(sandy || crop === "peanut" ? 1 : 2, "Herbaceous wind barriers or cross-wind trap strips", "NRCS 603 / 589C",
        `Barriers shorten the open distance the wind works over and protect seedlings — cotton and peanuts tolerate only about ${L("1 t/ac")} of blowing soil while small.`,
        [`Barriers: annual forage sorghum or pearl millet rows ≥ ${L("1.5 ft")} tall, 40–50% porous, spaced ≤ 10× their height — e.g. a ${L("3-ft")} barrier every ≤ ${L("30 ft")}, a ${L("6-ft")} forage sorghum barrier every ≤ ${L("60 ft")}. Within-row plant spacing ≤ ${L("36 in")}; fill gaps of ${L("10–15 ft")}.`,
          `Trap strips: ≥ ${L("15 ft")} wide (measured along the wind) of vegetation ≥ ${L("1 ft")} tall during the windy season, on the windward field edge or alternating with crop strips.`,
          sandy ? `On sands, erosion-susceptible crop strips between barriers should be narrow — historically about ${L("20 ft")} on sand.` : "",
          `Orientation: ${ctx.orient}.`,
          `Sow summer barriers Jul–Aug so they stand ≥ ${L("1.5–3 ft")} by frost; leave them through April.`],
        "Sow Jul–Aug · standing through Apr", { act: [6, 7], on: [8, 9, 10, 11, 0, 1, 2, 3] }, ["tx603", "n589"]);
      if (a.barrier !== "yes") {
        add(3, "Field windbreak (long term)", "NRCS 380",
          "A tree windbreak protects about 10× its height downwind and 2× upwind, using the tallest row's height at age 20.",
          ["Species grown at the Texas A&M Forest Service West Texas Nursery (Idalou): Afghan pine, bur oak, cedar elm, lilac chastetree.",
            "Avoid Siberian elm, Russian olive and saltcedar (on the West Texas invasive list). Eastern redcedar works but spreads into rangeland.",
            "Slow to grow on the Southern High Plains — use barriers or strips until it is functional."],
          "Plant late winter", null, ["fotg", "tfs"]);
      }
      const sandSpecs = sandy
        ? [`Sands: lister bottoms ${L("40–50 in")} apart, ${L("4–12 in")} deep (first pass ≤ ${L("4–5 in", null, { sq: 1 })}, deeper on repeats) — only when the soil is moist enough to form clods.`,
          weg === "1" ? "On WEG 1 sands stable clods are hard to form, so roughening is unreliable — treat it strictly as a stop-gap." : ""]
        : [`Loams and clays: chisel with ${L("2-in")} points on ${L("24–54 in")} spacing, ${L("3–6 in")} deep (narrower spacing on bare ground).`];
      add(bareAfter ? 2 : 3, "Emergency surface roughening only if cover fails", "NRCS 609 / 588",
        "Ridges and clods trap moving soil for a short time; it is a backstop, not a plan.",
        [`Start on the windward edge, ridges across the wind (≤ 45° off perpendicular); ridge spacing ≤ 4× ridge height.`,
          ...sandSpecs,
          "Crusted loamy fine sands, sandy loams and calcareous loams shed sand grains that abrade crusts quickly — don't count on a crust.",
          `Trigger: cover below ${target}% on Feb 1 with soil moving — roughen and plan barriers.`],
        `Only when bare during ${rt}`, { act: ctx.riskMonths }, ["n609", "n588", "ksu", "unl"]);
      if (irr) {
        add(3, "Permanent cover on dry pivot corners", "NRCS 327",
          "Unirrigated corners are often left bare and feed sand onto the circle.",
          ["Seed a native mix suited to this soil (table below); mow or graze lightly, never disk."],
          `Seed ${seedWindow}`, { act: seedMonths }, ["tx327"]);
        species = speciesRows(ctx);
        mix = mixFor(txGroup);
      }
      // estimated loss with residue, from the NAM E-table ratios
      if (ctx.E) {
        residueTable = [0, 500, 1000, 1500, 2000].map(sge => [sge, ctx.E * interp(SGE_RATIO, sge)]);
      }
      if (crop === "peanut") notes.push(`Peanut digging inverts the soil and leaves almost no anchored residue, and peanuts tolerate only ~${L("1 t/ac")} of blowing soil. Drill rye or wheat immediately after harvest and add sorghum or small-grain barrier strips on WEG 1–2 soils.`);
      if (crop === "cotton" && bareAfter) {
        // "more than" a million acres: round the converted area down to two figures
        const mAc = UN.conv("area", UN.fromUnit("area", 1e6, "ac")), p = 10 ** (Math.floor(Math.log10(mAc)) - 1);
        const where = cvd("area", "ac") ? `${fmt(Math.floor(mAc / p) * p, 0)}${NB}${UN.sym("area")} [a million acres] of South Plains fields` : "a million South Plains acres";
        notes.push(`Cotton stalks are light and usually shredded and incorporated after harvest on the Southern High Plains, which leaves the field effectively bare by February. Standing stalks plus a terminated small-grain cover is the proven combination here (more than ${where} a year).`);
      }
      notes.push("Texas also has a secondary erosive period in Dec–Jan from strong north winds behind cold fronts (USDA-ARS Big Spring) — have cover in place by about Dec 1.");
    }

    else if (lu === "rangeland") {
      const cond = a.cond || "fair", drought = a.drought === "drought", lpc = a.lpc === "yes";
      const util = sandy || lpc ? "25–33%" : "about 25% harvest efficiency";
      title = "Rangeland — native grassland";
      summary = `Healthy rangeland rarely blows. Erosion starts where grazing or drought strips cover from ${sandy ? "sandy" : "erodible"} soils; the plan keeps residue on the ground from Nov 1 through ${rt}.`;
      add(1, "Prescribed grazing at 25% harvest efficiency", "NRCS 528",
        "Keeping cover is the main wind-erosion control on rangeland. \"Take half, leave half\" really means livestock eat about a quarter — the rest of the half 'taken' goes to trampling, insects, wildlife and weathering.",
        [`Set stocking from median-year forage production at ${util}${lpc ? " (WAFWA lesser prairie-chicken agreement: ≤ 33% utilization)" : ""}.`,
          `Minimum stubble: sideoats grama ≥ ${L("6 in")}; little bluestem and Indiangrass ${L("6–8 in")}; sand bluestem and giant sandreed ≈ ${L("8–10 in")}; buffalograss ≈ ${L("2 in")}; blue grama ≈ ${L("1.5 in")}.`,
          sandy ? "Sandy site: avoid heavy winter and early-spring grazing that removes standing cover before the Mar–Apr peak." : "",
          a.graze === "cont" ? "Move from continuous to a rotation or deferment so each pasture gets growing-season rest every 2–3 years." : "Keep rotating; rest to frost benefits warm-season grasses."],
        `Residue in place by Nov 1 and kept through Apr 1`, { on: [10, 11, 0, 1, 2, 3] }, ["he", "tx528", "pmc"]);
      add(drought ? 1 : 2, "Drought contingency plan with decision dates", "NRCS 528 (required in Texas)",
        "Overgrazing during drought is how rangeland becomes a dust source. Decide on dates, not on hope.",
        [`Apr 1 — check residue height and ${UN.sym("massArea")} against your target.`, "Jun 15 — estimate the year's production and adjust numbers.",
          "Jul 15 — start estimating end-of-season residue.", "Aug 15 — calculate available forage; rest to frost if you can.",
          "Nov 1 — end of growing season; less than 80% of average annual rain signals drought next season.",
          drought ? "In drought now: reduce numbers before cover drops further; feed in one sacrifice area on a non-sandy site." : ""],
        "Apr 1 · Jun 15 · Jul 15 · Aug 15 · Nov 1", { act: [3, 5, 6, 7, 10] }, ["tx528"]);
      if (cond === "poor") {
        add(1, sandy && ctx.dunes ? "Rest first; seed only where needed" : "Range planting where desirable grasses are scarce", "NRCS 550",
          "Seed only where desirable species make up less than about 10% of the vegetation; otherwise rest lets the stand recover.",
          [`Drill with double-disk openers and depth bands, rows ≤ ${L("12 in")} apart, ${L("¼–½ in")} deep (never deeper than ${L("¾ in", null, { sq: 1 })}), then press wheels or a cultipacker.`,
            "Firm, weed-free seedbed — or a dead-litter cover (e.g. last summer's forage sorghum) where blowing sand would cut seedlings.",
            `Use seed collected within ~${L("200 mi")} north–south and ~${L("100 mi")} east–west of the site.`,
            "Defer grazing at least one full growing season (planting to killing frost).",
            ctx.dunes ? "Sand Hills sites: reseeding is difficult and not usually successful — favor deferment and rest." : ""],
          `Seed ${seedWindow}`, { act: seedMonths }, ["tx550", "texnat", "sandhills"]);
        species = speciesRows(ctx);
        mix = mixFor(txGroup);
      }
      add(3, "Water, fencing and feeder placement", "NRCS 614 / 516 / 382",
        "Trails and bare ground around water, feeders and fence corners are where blowing starts.",
        ["Add water points and cross-fences so grazing spreads out and rotation is possible.", "Move feeders and mineral regularly, away from sandy knolls."],
        "Any time", null, ["tx528"]);
      notes.push("Don't seed Old World bluestems (KR, WW-B.Dahl) or Lehmann lovegrass on native rangeland — they escape, invade well-managed native grassland and cut native diversity. TX 550 requires species that fit the ecological site.");
      if (!species && cond === "fair") species = speciesRows(ctx);
    }

    else if (lu === "shrubland") {
      const shrub = a.shrub || "mesquite", under = a.under || "sparse";
      const shrubName = { mesquite: "honey mesquite", shinnery: "sand shinnery oak", creosote: "creosotebush", sage: "sand sagebrush", juniper: "juniper", mixed: "mixed brush" }[shrub];
      title = "Shrubland — " + shrubName;
      summary = sandy
        ? "On sands the shrubs are part of what holds the soil. Manage for grass between them (suppression, not eradication) and never clear dunes."
        : "Brush competes with grass, but stripping it can leave soil bare. Treat selectively and protect the grass response with deferment.";
      add(1, "No brush removal on sands unless grass cover is there or will be protected", "NRCS 314 criteria",
        "In the Chihuahuan Desert, losing grass cover — not the shrubs themselves — triggers jumps in wind erosion.",
        [sandy ? "This soil is WEG " + weg + ": aim for suppression, treat in a mosaic or strips covering ≤ 50% of the area, and use no mechanical or root-plow methods." : "Mechanical treatment only on stable, finer soils with a perennial grass seed source.",
          "Avoid dune tops and areas of poor cover (Sand Hills ESD).",
          sandy ? "No mechanical disturbance on sands Dec–May." : "",
          "Leave untreated strips or mottes, ideally across the prevailing wind."],
        "Before any brush work", null, ["alvarez", "tx314", "sandhills"]);
      if (shrub === "shinnery" || shrub === "sage") {
        add(1, `${shrub === "shinnery" ? "Shinnery oak" : "Sand sagebrush"}: low-rate tebuthiuron in a mosaic`, "NRCS 314 / WAFWA",
          "Control can release tall grasses but is controversial because it can open sandy soils to wind erosion.",
          [`Tebuthiuron about ${L("0.3 lb a.i./ac")}, aerial (WAFWA template; NRCS New Mexico ${L("0.3–0.75 lb a.i./ac", null, { mass: 1, sq: 1 })} for partial control).`,
            "Only on medium to dense stands that have grassland potential; kill can take two or more growing seasons.",
            `Treat ≤ 50% of the property in any 2-year period; no treatment within ${L("150 ft")} of dunes or blowouts; no repeat treatments.`,
            "Defer grazing ≥ 2 years, then 1–2 years of dormant-season (Nov–Mar) grazing at ≤ 33% utilization."],
          "Before the growing-season rains · defer 2 years", { act: [2, 3] }, ["wafwa", "nm314"]);
      } else if (shrub === "mesquite") {
        add(2, "Mesquite: selective treatment with grass release", "NRCS 314",
          "Dense mesquite takes water from grasses; selective control can raise grass cover.",
          ["Use herbicide or individual-plant treatment timed per Texas A&M AgriLife brush guidance (late spring–early summer when foliage is mature).",
            "Leave dead stems standing; do not chain or rake on sands or coppice dunes."],
          "Late spring–early summer", { act: [4, 5] }, ["tx314"]);
      } else if (shrub === "creosote") {
        add(2, "Creosotebush: protect cover; convert only where grassland potential exists", "NRCS 314 / 528",
          "Where creosote is the reference community in the ecological site, do not try to convert it.",
          ["Avoid off-road traffic and concentrated grazing that break biological soil crusts.",
            `Tebuthiuron (${L("0.3–0.75 lb a.i./ac", null, { sq: 1 })}, partial control) only on medium–dense stands with grassland potential and adequate rainfall.`],
          "Any time", null, ["nm314", "alvarez"]);
      } else if (shrub === "juniper") {
        add(2, "Juniper: control for forage and water; wind risk is low here", "NRCS 314",
          "Redberry and Ashe juniper usually grow on limy or shallow soils (WEG 4L/8) where water erosion matters more than wind.",
          ["Mechanical or individual-plant treatment; prescribed fire for small trees.", "Defer grazing at least one growing season afterward."],
          "Late winter", null, ["tx314"]);
      } else {
        add(2, "Selective brush management", "NRCS 314", "Target dense patches; keep scattered shrubs as cover.",
          ["Prefer chemical or individual-plant methods that leave the soil undisturbed."], "Per label season", null, ["tx314"]);
      }
      add(1, "Deferment, then prescribed grazing", "NRCS 528",
        "The grass response after brush work is what reduces wind erosion.",
        [`Defer grazing ${sandy ? "2 growing seasons (sands)" : "1 growing season"} after treatment.`,
          `Then stock at about 25% harvest efficiency with residue in place by Nov 1 through ${rt}.`],
        "After treatment", { on: [4, 5, 6, 7, 8, 9] }, ["tx528", "he"]);
      if (under !== "good") {
        add(2, "Seed grasses between shrubs where the ecological site supports it", "NRCS 550",
          "Seed only where the ecological site shows grassland potential and there is rainfall or a seed source.",
          ["Drill or broadcast-and-cover into treated areas; brush slash or mulch helps seed stay put on sand."],
          `Seed ${seedWindow}`, { act: seedMonths }, ["tx550", "texnat"]);
        species = speciesRows(ctx);
      }
    }

    else if (lu === "pasture") {
      const pt = a.ptype || "dry", cond = a.cond || "fair";
      title = "Pasture / hayland";
      summary = `Forage fields protect soil while stands are thick and stubble is left. The risk comes from low fall cutting, overgrazed winter pasture and failed stands going into ${rt}.`;
      add(1, "Leave stubble: cutting and grazing heights", "NRCS 511 / 528",
        `The last cutting or grazing should leave regrowth so ≥ ${L("4–6 in")} of stubble stands through Feb–May.`,
        [`Minimum cutting heights: bermudagrass ${L("2–3 in")}; Old World bluestem and weeping lovegrass ${L("3–4 in")}; sand bluestem and Indiangrass ${L("4–6 in")}; sudan, millet and sorghum-sudan ${L("6–10 in")}; wheat ${L("2–4 in")}.`,
          pt === "annual" ? `Sorghum-sudan: start grazing at ${L("18–24 in")} tall (prussic acid) and leave ${L("6–8 in")}. Pull cattle off wheat pasture before it is grazed bare in Feb–Mar.` : "",
          sandy ? `On sandy pasture avoid a fall cut down to ~${L("2 in")} going into winter.` : ""],
        `Last cut early enough for regrowth before frost`, { on: [10, 11, 0, 1, 2, 3, 4] }, ["ok511", "ksu_pa"]);
      if (cond !== "good") {
        add(1, "Re-establish a full stand", "NRCS 512",
          "Thin stands leave bare soil between plants.",
          [sandy ? "WEG 1–2: perennial cover is preferred. Weeping lovegrass ('Ermelo', 'Morpa') is adapted to sands but turns unpalatable without fertilizer and frequent short grazing; native sand-adapted mixes are longer-lived." : "",
            `WW-B.Dahl Old World bluestem suits low-water pastures (productive with ≤ ${L("9 in", "precip", { sq: 1 })} of irrigation a year) — keep it on fenced pasture, never next to native range.`,
            ctx.dry && pt !== "irr" ? `Under ~${L("18 in", "precip")} of rain, avoid bermudagrass and kleingrass on dryland.` : `Kleingrass: ${L("1.5 lb PLS/ac")} drilled. Bermudagrass: irrigated only.`,
            "Plant into last summer's sorghum or millet stubble to shelter seedlings; defer grazing at least one full growing season."],
          `Seed ${seedWindow}`, { act: seedMonths }, ["tx512", "sare"]);
      }
      if (pt === "annual") {
        add(2, "No-till annual forages into residue", "NRCS 340 / 329",
          "Clean-tilled wheat-pasture seedbeds are as erodible as bare cropland until the crop covers.",
          [`No-till drill wheat, rye or triticale into sorghum or millet stubble; follow summer annuals with a winter small grain, or leave ≥ ${L("8 in")} of stubble.`,
            sandy ? "On WEG 1–2, avoid clean-tilled annual forage altogether." : ""],
          "Sep–Oct (winter annuals) · May–Jun (summer annuals)", { act: [8, 9, 4, 5] }, ["tx340"]);
        coverTable = [COVER.rye, COVER.wheat, COVER.triticale, COVER.sorghum, COVER.millet];
      }
    }

    else if (lu === "crp") {
      title = "CRP / conservation cover / go-back land";
      summary = "Established grass is the most effective wind-erosion control there is — the risk comes during establishment and when contracts end.";
      if (a.stage === "new" || a.cond === "poor") {
        add(1, "Establish grass into a dead-litter sorghum cover", "NRCS 327 / 550 / 342",
          "Seedlings in open sand get cut down by blowing sand; standing dead sorghum shelters them.",
          [`Plant forage sorghum (haygrazer) the summer before; mow or hay to leave ${L("8–10 in")} of stubble; it must be dead before you seed.`,
            `Next spring, drill the native mix into the stubble with a grass drill (rows ≤ ${L("12 in", null, { sq: 1 })}), ${L("½–¾ in")} deep.`,
            "Avoid Old World bluestems and weeping lovegrass where the land may go back to native range."],
          `Sorghum cover May–Jul · grass seeding ${seedWindow}`, { act: seedMonths.concat([5, 6]), on: [9, 10, 11, 0, 1] }, ["tx342", "csu", "tx327"]);
        species = speciesRows(ctx);
        mix = mixFor(txGroup);
      }
      if (a.stage === "exp") {
        const rule = weg === "1" ? "WEG 1: do not convert — re-enroll or graze it (about 25% harvest efficiency)."
          : weg === "2" ? `WEG 2: convert in strips and keep permanent strips of the old CRP grass (≥ ${L("15 ft", null, { sq: 1 })} wide, ≤ 10× height apart) as trap strips.`
            : "Kill the sod chemically and no-till a high-residue first crop (wheat or grain sorghum).";
        add(1, "Convert expiring CRP without plowing", "NRCS 329 / 328 / 589C",
          "Clean-tilling old CRP sod leaves little residue and some of the region's worst blowing followed.",
          [rule,
            "Timeline: conversion may start no sooner than 90 days before expiration (usually July 2). Burn or bale, let the grass regrow 6–8 weeks, then glyphosate in July; no-till sorghum the following May–June.",
            "Leave wide grass buffers around playas and drainages; the original conservation plan (terraces, wind strips) may apply again.",
            "Late-winter burns in the Panhandle are high-wind, low-humidity — avoid.",
            `Never leave converted ground bare Dec–May.`],
          "Kill in July · plant next May–Jun", { act: [6, 4, 5] }, ["crp", "n589", "tx329"]);
      }
      if (a.stage === "est" && a.cond !== "poor") {
        add(1, "Maintain the stand", "NRCS 327 / 528",
          "Mid-contract management should refresh the stand without exposing soil in the windy season.",
          ["Hay or graze only under an approved plan, leaving tall stubble.", "No burning or disking just before or during " + rt + "."],
          "Manage outside " + rt, { on: [10, 11, 0, 1, 2, 3, 4] }, ["tx327"]);
      }
    }

    else if (lu === "disturbed") {
      const dt = a.dtype || "pad", stage = a.stage || "spring";
      title = "Disturbed land — " + { pad: "well pad / caliche site", pipe: "pipeline right-of-way", build: "construction site", road: "unpaved roads and lots" }[dt];
      summary = `Bladed sites lose their crust and topsoil; every bare ${AREA_WORD[UN.sym("area")] || UN.sym("area")} upwind feeds dust and sand onto neighbors and roads.`;
      if (dt === "road") {
        add(1, "Dust control on unpaved surfaces", "NRCS 373",
          "Traffic grinds caliche and soil into fine dust that blows in every wind.",
          ["Water or apply a dust suppressant on heavy-traffic routes; reduce speeds; gravel the worst sections."],
          "Before and during " + rt, { act: ctx.riskMonths }, []);
      }
      if (stage === "fall") {
        add(1, "Temporary cover plus mulch right away", "NRCS 342 / 484",
          `A site that goes into ${rt} bare will blow; temporary cover holds it until the permanent seeding window.`,
          [`Cool-season temporary cover (oats and wheat; TxDOT window Sep 1–Jan 31), or Brownton millet ${L("20 lb/ac")} Feb 1–Aug 30.`, "Mulch over it (below)."],
          "Immediately", { act: [8, 9, 10, 11, 0] }, ["txdot"]);
      }
      add(1, "Salvage and respread topsoil; keep the footprint small", "Reclamation",
        "Native topsoil carries seed, organic matter and crust organisms; caliche and subsoil revegetate poorly.",
        ["Strip topsoil separately; never salvage when wet or frozen; keep stockpiles low and seeded.",
          `At reclamation remove caliche and gravel pads, rip compacted subsoil about ${L("12–18 in")}, respread about ${L("4–6 in")} of topsoil (guideline).`,
          "Reclaim unused parts of pads as soon as drilling and completion end."],
        "At construction and immediately after", null, []);
      add(1, "Critical area planting with native seed", "NRCS 342",
        `Permanent native cover is the long-term fix${dt === "pipe" ? ` — Texas Native Seeds mixes were used on about ${L("8,000 ac")} of the Shin Oak NGL pipeline from west of Midland` : ""}.`,
        [ctx.region === "tp" || ctx.dist === "Odessa" ? `Permian: the University Lands approved mix (${L("3.79 lb PLS/ac", null, { sq: 1, d: 2 })}, below) or the TxDOT district mix.` : "Use the TxDOT district mix or the native species below.",
          `Drill ${L("¼–⅓ in")} deep; leave the seedbed somewhat rough but firm (pack before and after seeding).`,
          sandy ? "Sandy soil: mulch is mandatory; add pearl millet or sorghum nurse or barrier rows." : "Caliche or clay: rip, then use the clay mix."],
        `Seed ${seedWindow}`, { act: seedMonths }, ["tx342", "ul", "txdot", "tns"]);
      add(1, "Mulch to hold the surface while seed establishes", "NRCS 484",
        "Mulch stops blowing immediately; aim for about 70% ground cover.",
        [`Straw ${L("2–2.5 t/ac")} or hay ${L("1.5–2 t/ac")}, tacked or crimped in.`, `Hydromulch on sandy soils: ${L("2,500 lb/ac")} (slopes ≤ 3:1) or ${L("3,000 lb/ac")} on steeper slopes.`],
        "At seeding", null, ["txdot"]);
      species = speciesRows(ctx);
      mix = ctx.region === "tp" || ctx.dist === "Odessa"
        ? { title: "University Lands approved Permian seed mix (all listed counties)", rows: UL_MIX, note: `${usym("massArea", "PLS")}, total ${cell("massArea", 3.79, "lb/ac", 2)}. Includes a pearl millet nurse crop and native forbs.`, ref: "ul" }
        : mixFor(txGroup);
      notes.push("Texas Railroad Commission rules govern pit closure and site restoration after drilling (the former 16 TAC §3.8 required pits to be backfilled within one year; rules moved to Chapter 4 in 2024 — check current deadlines). Surface-use agreements often set topsoil and reseeding terms.");
    }

    else if (lu === "barren") {
      const bt = a.btype || "dune";
      title = "Bare sand, dunes and blowouts";
      summary = bt === "caliche" ? "Gravel and caliche surfaces armor themselves (often WEG 8); the dust comes from traffic and disturbed edges." : "Active sand must be stopped at the surface before plants can establish.";
      add(1, "Keep livestock and vehicles out", "NRCS 382 / 528",
        "Hoof and tire traffic keeps sand loose and breaks any crust.",
        ["Fence the blowout and a buffer around it; route trails and roads away.", "Defer grazing at least two growing seasons after stabilization."],
        "Now, until fully vegetated", { on: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] }, ["fulbright"]);
      if (bt !== "caliche") {
        add(1, "Mulch the moving sand", "NRCS 484",
          "On migrating inland Texas dunes, native prairie-hay mulch with grazing excluded stopped sand movement and let vegetation establish — seeding, fertilizer and transplants were not needed.",
          [`Organic mulch about ${L("2–3 t/ac")} (Nebraska blowout guidance); fence and mulch before February.`,
            "Cotton-bur mulch improves seedbed moisture, but heavy rates block seedling emergence.",
            `Brush slash or hay laid across the wind (${ctx.orient}) on the most active faces.`],
          "Before Feb", { act: [10, 11, 0] }, ["fulbright"]);
        add(2, "Seed sand-adapted grasses into the mulch", "NRCS 342 / 550",
          "Deep-rooted, rhizomatous grasses hold dunes once established.",
          ["Giant sandreed, sand bluestem, giant dropseed, Havard panicum and sand lovegrass; keep shinnery oak and sand sagebrush that are already there.",
            `Small blowouts (< ${L("¼ ac", null, { sq: 1 })}) recover best; out-of-state guidance uses ≥ ${L("60 PLS/ft²")} drilled or ${L("120 PLS/ft²", null, { n: 1 })} broadcast.`],
          `Seed ${seedWindow}`, { act: seedMonths }, ["tx342"]);
        species = speciesRows(ctx, "sandy");
        if (ctx.dunes || ctx.region === "tp") {
          notes.push(`Monahans-type dunes are held partly by shinnery oak roots; some are naturally active and may not be practical to restore — protect their stabilized margins instead. Do not till or treat brush here, and keep a ${L("150-ft")} no-treatment buffer around dunes for any brush work nearby.`);
        }
      } else {
        add(2, "Stabilize edges and traffic areas", "NRCS 373 / 342",
          "Fines come from disturbed edges, not the armored surface.",
          ["Limit traffic; seed and mulch the edges."], `Seed ${seedWindow}`, null, ["tx342"]);
      }
    }

    soilNotes(notes, lu, ctx);
    P.sort((x, y) => x.pri - y.pri);
    return { title, summary, practices: P, species, mix, coverTable, residueTable, notes };
  }

  // soil- and site-specific notes, the same in every state
  function soilNotes(notes, lu, ctx) {
    const weg = ctx.weg;
    // name the group by number and I: the survey's group does not always match a texture name
    if (weg === "1" || weg === "2") notes.unshift(`This surface is WEG ${weg} (I = ${UN.fmt("soilLoss", ctx.I, 0)}), among the most erodible soils. Roughness alone does not last; rely on ≥ 60% cover.`);
    else if (weg === "3") notes.unshift(`This surface is WEG 3 (I = ${UN.fmt("soilLoss", ctx.I, 0)}): highly erodible when bare and dry. Cover crops or standing sorghum/wheat stubble, with chisel or lister roughening as a backstop.`);
    else if (weg === "4L") notes.unshift(`Calcareous surface (WEG 4L, I = ${UN.fmt("soilLoss", ctx.I, 0)}): carbonates weaken clods and crusts abrade quickly, so these soils blow more than their texture suggests. Avoid pulverizing tillage; keep residue plus roughness.`);
    else if (weg === "4") notes.unshift(`Clayey surface (WEG 4, I = ${UN.fmt("soilLoss", ctx.I, 0)}): clods resist wind when moist, but drying and freeze–thaw in late winter break them into erodible aggregates — keep residue through spring.`);
    else if (["5", "6", "7"].includes(weg)) notes.unshift(`WEG ${weg} (I = ${UN.fmt("soilLoss", ctx.I, 0)}): moderately erodible; residue management and chisel roughening are usually enough, trap strips optional.`);
    if (ctx.om !== null && ctx.om < 1) notes.push(`Surface organic matter is low (${fmt(ctx.om, 1)}%). Residue, cover crops and less tillage build aggregate stability over time.`);
    if (ctx.EI !== null && ctx.EI >= 8 && (lu === "cropland" || lu === "crp")) notes.push(`Erodibility index C·I/T = ${fmt(ctx.EI, 1)} (≥ 8): likely highly erodible land under USDA conservation compliance (7 CFR 12.21) — a conservation plan is needed for farm-program eligibility.`);
  }

  /* ------------------------------------------------------------------ other states
     Outside Texas the plan takes its state-specific facts from the state's profile (data/practices/XX.json, built by
     tools/build_practices.py from research on the state's NRCS Field Office Technical Guide documents and its extension,
     forestry, DOT and other public sources, every fact checked against its source by a second reader). The national
     parts stay: the cover target by WEG, NebGuide's cover-reduction table, the NAM residue table, the WEG notes. State
     facts are shown as their sources write them (US customary units), each cited; the rest of a list is under "More". */
  const PROFILES = {}; // state code -> profile, null (none), or a promise while loading
  function loadProfile(code, v) {
    if (!(code in PROFILES)) {
      PROFILES[code] = WG.util.fetchJSON(`data/practices/${code}.json?v=${v}`, {}, 30000)
        .then(p => (PROFILES[code] = p && p.state === code ? p : null), () => (PROFILES[code] = null));
    }
    return Promise.resolve(PROFILES[code]);
  }
  // the profile when loaded; undefined while loading or not asked yet; null when there is none
  const profile = code => (PROFILES[code] instanceof Promise ? undefined : PROFILES[code]);
  const LPC_STATES = new Set(["CO", "KS", "NM", "OK", "TX"]); // lesser prairie-chicken range

  // the profile's region holding the map unit's MLRA (exact symbol first, else the longest shared start: "77" ~ "77A")
  function profileRegion(pf, mlra) {
    const m = (mlra || "").toUpperCase();
    let best = null, score = -1;
    if (m) pf.regions.forEach(r => r.mlra.forEach(c => {
      const s = m === c ? 99 : m.startsWith(c) || c.startsWith(m) ? 10 + Math.min(c.length, m.length)
        : parseInt(m, 10) === parseInt(c, 10) ? 1 : -1; // "78B" ~ "78C": the same MLRA number
      if (s > score) { score = s; best = r; }
    }));
    return best || (pf.regions.length === 1 ? pf.regions[0] : null);
  }
  const inReg = (x, ctx) => !ctx.region || !x.regions || !x.regions.length || x.regions.includes("all") || x.regions.includes(ctx.region);

  // the questions, with the state's crops and shrubs; the lesser prairie-chicken question only where the bird lives
  function stateQ(lu, pf) {
    let q = Q[lu].map(x => ({ ...x }));
    if (lu === "cropland") q[0].opts = pf.crops.map(c => [c.id, c.name]).concat([["other", pf.crops.length ? "Other crop" : "Row crop"]]);
    if (lu === "disturbed") {
      q[0].opts = q[0].opts.map(([v, t]) => [v, v === "pad" ? "Well pad or graded site" : t]);
      q[1].opts = [["spring", "In or before the seeding season"], ["fall", "Going into the windy season"], ["old", "Already ended, still bare"]];
    }
    if (lu === "barren") q[0].opts = q[0].opts.map(([v, t]) => [v, v === "caliche" ? "Gravel, caliche or rock" : t]);
    if (lu === "rangeland" && !LPC_STATES.has(pf.state)) q = q.filter(x => x.id !== "lpc");
    if (lu === "shrubland") q[0].opts = pf.shrubs.map(s => [s.id, s.name]).concat([["mixed", pf.shrubs.length ? "Mixed / other brush" : "Brush or shrubs"]]);
    return q;
  }
  const stateLU = pf => LU.map(l => (l.id === "cropland" && pf.crops.length ? { ...l, sub: pf.crops.slice(0, 4).map(c => c.name.toLowerCase()).join(", ") }
    : l.id === "shrubland" && pf.shrubs.length ? { ...l, sub: pf.shrubs.slice(0, 3).map(s => s.name.toLowerCase()).join(", ") }
      : l.id === "cropland" ? { ...l, sub: "row crops and small grains" } : l.id === "shrubland" ? { ...l, sub: "brush and shrubs" } : l));

  function planState(lu, a, ctx) {
    const pf = ctx.pf, B = pf.B, S = pf.name, P = [], notes = [];
    const add = (pri, title, code, why, specs, when, months, refs, more) =>
      P.push({ pri, title, code, why, specs: specs.filter(Boolean), when, months, refs: [...new Set(refs.filter(Boolean))], more: more || [] });
    const cps = (...codes) => codes.map(c => "cps" + c).filter(k => pf.refs[k]);
    // a field's first n state notes as bullets, their sources, and the rest for "More"
    const st = (k, n) => ({ specs: (B[k] || []).slice(0, n).map(x => x[0]), refs: (B[k] || []).slice(0, n).flatMap(x => x[1]), more: (B[k] || []).slice(n) });
    const reg = list => list.filter(x => inReg(x, ctx));
    // the region's first two date windows as bullets, the rest for "More"; "when" names their months
    const win = list => {
      const all = reg(list), w = all.slice(0, 2), months = [...new Set(w.flatMap(x => x.months))].sort((x, y) => x - y);
      const label = x => (!ctx.region && x.regions && x.regions.length && !x.regions.includes("all")
        ? `${x.regions.map(id => (pf.regions.find(r => r.id === id) || { name: id }).name).join(", ")}: ` : "");
      return { text: w.map(x => label(x) + x.text), months, refs: w.flatMap(x => x.refs), more: all.slice(2).map(x => [label(x) + x.text, x.refs]),
        when: months.length ? WG.monthsText(months) : "" };
    };
    const seedW = win(pf.seedWin), coverW = win(pf.coverPlant);
    const seedMonths = seedW.months.length ? seedW.months : null, seedWhen = seedW.when ? `Seed ${seedW.when} (dates above)` : `No seeding dates in ${S}'s sources: ask your NRCS office`;
    const wins = w => w.text.map(t => `${S}: ${t}`);
    const nativeRows = group => {
      const all = reg(pf.natives), fit = all.filter(n => !n.soils.length || n.soils.includes(group || ctx.soilGroup));
      const rows = (fit.length ? fit : all).slice(0, 14).map(n => [n.name, n.sci || "—", n.release || "—", n.rate ?? null]);
      rows.fit = fit.length > 0; // chosen for this soil group, or the region's whole list
      rows.group = group || ctx.soilGroup; // the group it was chosen for (sand for dunes)
      return rows;
    };
    const mixFor = group => {
      const m = reg(pf.mixes).find(x => !x.soils.length || x.soils.includes(group || ctx.soilGroup)) || null;
      return m && { title: m.title, rows: m.rows, note: m.note || "", refs: m.refs, unit: m.unit || "" };
    };
    const coverRows = () => { const c = reg(pf.cover); return c.length ? c.map(x => [x.name, x.sci || "—", x.note || "", x.rate]) : null; };
    const rt = ctx.riskText, weg = ctx.weg, sandy = ctx.sandy, target = coverTarget(weg);
    const windy = [...new Set(ctx.riskMonths.concat(ctx.midMonths))];
    let species = null, mix = null, coverTable = null, residueTable = null, title = "", summary = "";

    if (lu === "cropland") {
      const crop = pf.crops.find(c => c.id === a.crop) || { id: "other", name: "Row crop", residue: "low" };
      const irr = a.water === "irr", res = a.residue || "bare", till = a.till || "conv", lowRes = crop.residue === "low";
      const bareAfter = res === "bare" || res === "low" || (lowRes && res !== "good" && res !== "cover");
      title = `Cropland — ${crop.name.toLowerCase()}, ${irr ? "irrigated" : "dryland"}`;
      summary = bareAfter
        ? `Fields left with little cover from harvest through ${rt} are where soil blows. The plan keeps cover or roughness on the surface for that whole window — aim for at least ${target}% surface cover on this soil.`
        : `You already leave cover after harvest. Keep it in place through ${rt} (target ≥ ${target}% cover on this soil) and add barriers on the most erodible fields.`;
      if (weg === "1") {
        add(1, "Consider retiring this field to permanent cover", "NRCS 327 / 550",
          "WEG 1 sands are the most erodible soils (I 160–310 t/ac/yr) and the hardest to protect under annual crops.",
          ["If it stays in crops, combine a cover crop, no-till, barriers or trap strips and high surface cover through the windy season.",
            `Otherwise seed a permanent native stand (${S}'s seeding dates and species below).`],
          "Decide before the next harvest", null, cps("327", "550"));
      }
      if (res !== "cover" && (bareAfter || sandy || res === "low")) {
        const c = st("cover_rules", 3);
        coverTable = coverRows();
        add(bareAfter || sandy ? 1 : 2, "Plant a cover crop after harvest", "NRCS 340",
          `A cover crop keeps living cover and then residue on the surface through ${rt}.`,
          [...wins(coverW), coverTable ? `Species and seeding rates from ${S}'s sources: table below.` : "",
            `Orient drill rows across the windy-season wind: ${ctx.orient}.`, ...c.specs,
            "Plant the next crop no-till or strip-till into the residue."],
          coverW.when ? `Plant ${coverW.when} (dates above) · protects through ${rt}` : `After harvest · protects through ${rt}`,
          coverW.months.length ? { act: coverW.months, on: ctx.riskMonths } : { on: ctx.riskMonths },
          [...coverW.refs, ...c.refs, ...cps("340")], [...coverW.more, ...c.more]);
      }
      if (till !== "notill") {
        const r = st("residue", 4);
        add(bareAfter ? 2 : 1, "Switch to no-till or strip-till; keep residue standing", "NRCS 329 / 345",
          "Each tillage pass buries residue and loosens the surface; standing residue protects better than the same residue lying flat.",
          [`Cover target for this soil: ≥ ${target}% through ${rt}. Flat cover cuts erosion about ${fmt(coverReduction(30) * 100, 0)}% at 30% cover, ${fmt(coverReduction(50) * 100, 0)}% at 50% and ${fmt(coverReduction(70) * 100, 0)}% at 70% (NebGuide G1537).`,
            weg === "1" && ctx.C ? `On WEG 1 with C = ${fmt(ctx.C, 0)}, about ${fmt(Math.round(UN.conv("massArea", interp(SGE_WEG1, ctx.C)) / 50) * 50, 0)}${NB}${UN.sym("massArea")} flat small-grain-equivalent residue is needed.` : "",
            ...r.specs, "Never till on dry, windy days."],
          `Year-round · most important ${rt}`, { on: windy }, ["neb", ...r.refs, ...cps("329", "345")], r.more);
      } else {
        const r = st("residue", 2);
        add(3, "Keep the no-till residue intact", "NRCS 329", "No-till works only while residue stays on the surface.",
          [`Keep ≥ ${target}% cover through ${rt}.`, ...r.specs], "Year-round", { on: windy }, [...r.refs, ...cps("329")], r.more);
      }
      if (lowRes) {
        const hi = pf.crops.filter(c => c.residue === "high").map(c => c.name.toLowerCase());
        add(2, "Rotate with a high-residue crop", "NRCS 328", `${crop.name} leaves little or fragile residue.`,
          [hi.length ? `High-residue crops grown in ${S}: ${hi.join(", ")} — or a cover crop.` : "Follow it with a small grain, grain sorghum or corn for grain, or a cover crop."],
          "Plan the rotation each year", null, cps("328"));
      }
      const b = st("barriers", 4);
      add(sandy ? 1 : 2, "Wind barriers, trap strips or strip cropping", "NRCS 603 / 589 / 585",
        "Barriers and strips shorten the open distance the wind works over and catch moving soil.",
        [...b.specs, `Orientation: ${ctx.orient}.`], "In place before the windy season", { on: ctx.riskMonths },
        [...b.refs, ...cps("603", "589", "585")], b.more);
      if (a.barrier !== "yes") {
        const w = st("windbreak", 2), sp = pf.wb.species.slice(0, 10), av = pf.wb.avoid.slice(0, 6);
        add(3, "Field windbreak (long term)", "NRCS 380", "A tree windbreak shelters a band downwind several times its height; the state's 380 standard sets the design.",
          [sp.length ? `Species ${S}'s sources list for windbreaks: ${sp.join("; ")}.` : "", av.length ? `Avoid: ${av.join("; ")}.` : "", ...w.specs],
          "Plant in the tree-planting season", null, [...w.refs, ...cps("380")], w.more);
      }
      const g = st("roughening", 4);
      add(bareAfter ? 2 : 3, "Emergency surface roughening only if cover fails", "NRCS 609 / 588",
        "Ridges and clods trap moving soil for a short time; it is a backstop, not a plan.",
        [...(g.specs.length ? g.specs : ["Start on the windward edge with ridges across the wind; chisel or list only when the soil is moist enough to form clods."]),
          `Trigger: cover below ${target}% going into ${rt} with soil moving.`],
        `Only when bare during ${rt}`, { act: ctx.riskMonths }, [...g.refs, ...cps("609", "588"), ...(g.specs.length ? [] : ["n609", "n588"])], g.more);
      if (irr) {
        add(3, "Permanent cover on dry pivot corners", "NRCS 327", "Unirrigated corners are often left bare and feed soil onto the circle.",
          ["Seed a native mix suited to this soil (table below); mow or graze lightly, never disk.", ...wins(seedW)],
          seedWhen, seedMonths && { act: seedMonths }, [...seedW.refs, ...cps("327")]);
        species = nativeRows();
        mix = mixFor();
      }
      if (ctx.E) residueTable = [0, 500, 1000, 1500, 2000].map(sge => [sge, ctx.E * interp(SGE_RATIO, sge)]);
    }

    else if (lu === "rangeland") {
      const cond = a.cond || "fair", drought = a.drought === "drought";
      title = "Rangeland — native grassland";
      summary = `Healthy rangeland rarely blows. Erosion starts where grazing or drought strips cover from ${sandy ? "sandy" : "erodible"} soils; the plan keeps residue on the ground through ${rt}.`;
      const g = st("grazing", 5);
      add(1, "Prescribed grazing that leaves residue", "NRCS 528", "Keeping cover is the main wind-erosion control on rangeland.",
        [...g.specs, sandy ? "Sandy site: avoid heavy grazing that removes standing cover just before the windy season." : "",
          a.graze === "cont" ? "Move from continuous grazing to a rotation or deferment so each pasture gets growing-season rest." : "",
          a.lpc === "yes" ? "Lesser prairie-chicken range: follow the grazing terms of any conservation agreement on the land." : ""],
        `Residue in place before ${rt}`, { on: ctx.riskMonths }, [...g.refs, ...cps("528")], g.more);
      const d = st("drought", 4);
      add(drought ? 1 : 2, "Drought plan with decision dates", "NRCS 528", "Overgrazing during drought is how rangeland becomes a dust source. Decide on dates, not on hope.",
        [...(d.specs.length ? d.specs : ["Set dates to check forage and residue against targets, and cut numbers early when rain falls short."]),
          drought ? "In drought now: reduce numbers before cover drops further; feed in one sacrifice area on a non-sandy site." : ""],
        "Through the growing season", null, [...d.refs, ...cps("528")], d.more);
      if (cond === "poor") {
        const s = st("seeding", 4);
        add(1, ctx.dunes ? "Rest first; seed only where needed" : "Range planting where desirable grasses are scarce", "NRCS 550",
          "Seed only where desirable species are too scarce to recover with rest.", [...wins(seedW), ...s.specs],
          seedWhen, seedMonths && { act: seedMonths }, [...seedW.refs, ...s.refs, ...cps("550")], [...seedW.more, ...s.more]);
        species = nativeRows();
        mix = mixFor();
      }
      add(3, "Water, fencing and feeder placement", "NRCS 614 / 516 / 382",
        "Trails and bare ground around water, feeders and fence corners are where blowing starts.",
        ["Add water points and cross-fences so grazing spreads out and rotation is possible.", "Move feeders and mineral regularly, away from sandy knolls."],
        "Any time", null, cps("528"));
      (B.dont_seed || []).slice(0, 3).forEach(x => notes.push(x));
      if (!species && cond === "fair") species = nativeRows();
    }

    else if (lu === "shrubland") {
      const sh = pf.shrubs.find(s => s.id === a.shrub), under = a.under || "sparse";
      title = "Shrubland — " + (sh ? sh.name.toLowerCase() : "brush and shrubs");
      summary = sandy
        ? "On sands the shrubs are part of what holds the soil. Manage for grass between them (suppression, not eradication) and never clear dunes."
        : "Brush competes with grass, but stripping it can leave soil bare. Treat selectively and protect the grass response with deferment.";
      const desert = ["AZ", "NM"].includes(pf.state); // the Chihuahuan Desert study (alvarez) holds there
      add(1, sandy ? "No brush removal on sands unless grass cover is there or will be protected" : "Brush work that keeps the grass cover", "NRCS 314",
        desert ? "In the Chihuahuan Desert, losing grass cover — not the shrubs themselves — triggers jumps in wind erosion."
          : "Brush work that strips the grass cover leaves the soil open to the wind.",
        [sandy ? `This soil is WEG ${weg}: aim for suppression, treat in a mosaic or strips, and avoid mechanical or root-plow methods.` : "Mechanical treatment only on stable, finer soils with a perennial grass seed source.",
          "Leave untreated strips or mottes, ideally across the prevailing wind."],
        "Before any brush work", null, [desert ? "alvarez" : "", ...cps("314")]);
      if (sh && sh.advice.length) {
        add(1, `${sh.name}: what ${S}'s sources advise`, "NRCS 314", `Guidance for ${sh.name.toLowerCase()} in ${S}.`,
          sh.advice.slice(0, 5).map(x => x[0]), "Per the guidance", null, sh.advice.slice(0, 5).flatMap(x => x[1]), sh.advice.slice(5));
      }
      const g = st("grazing", 2);
      add(1, "Deferment, then prescribed grazing", "NRCS 528", "The grass response after brush work is what reduces wind erosion.",
        ["Defer grazing after treatment so the grass can respond.", ...g.specs], "After treatment", null, [...g.refs, ...cps("528")], g.more);
      if (under !== "good") {
        const s = st("seeding", 2);
        add(2, "Seed grasses between shrubs where the ecological site supports it", "NRCS 550",
          "Seed only where the ecological site shows grassland potential and there is rainfall or a seed source.",
          [...wins(seedW), ...s.specs], seedWhen, seedMonths && { act: seedMonths }, [...seedW.refs, ...s.refs, ...cps("550")], s.more);
        species = nativeRows();
      }
    }

    else if (lu === "pasture") {
      const pt = a.ptype || "dry", cond = a.cond || "fair";
      title = "Pasture / hayland";
      summary = `Forage fields protect soil while stands are thick and stubble is left. The risk comes from low fall cutting, overgrazed winter pasture and failed stands going into ${rt}.`;
      const p = st("pasture", 4);
      add(1, "Stand, cutting and grazing heights", "NRCS 511 / 512 / 528", "Stubble left standing through the windy season holds the soil.",
        [...p.specs, sandy ? "On sandy pasture avoid a low fall cut going into winter." : ""],
        "Last cut early enough for regrowth before frost", { on: ctx.riskMonths }, [...p.refs, ...cps("511", "512", "528")], p.more);
      if (cond !== "good") {
        add(1, "Re-establish a full stand", "NRCS 512", "Thin stands leave bare soil between plants.",
          [...wins(seedW), "Plant into standing stubble or a cover crop to shelter seedlings; defer grazing until the stand is established."],
          seedWhen, seedMonths && { act: seedMonths }, [...seedW.refs, ...cps("512")]);
      }
      if (pt === "annual") {
        add(2, "No-till annual forages into residue", "NRCS 340 / 329",
          "Clean-tilled annual-forage seedbeds are as erodible as bare cropland until the crop covers.",
          [...wins(coverW), sandy ? "On WEG 1–2, avoid clean-tilled annual forage altogether." : ""],
          coverW.when ? `Plant ${coverW.when} (dates above)` : "", coverW.months.length ? { act: coverW.months } : null, [...coverW.refs, ...cps("340", "329")], coverW.more);
        coverTable = coverRows();
      }
    }

    else if (lu === "crp") {
      title = "CRP / conservation cover / go-back land";
      summary = "Established grass is the most effective wind-erosion control there is — the risk comes during establishment and when contracts end.";
      if (a.stage === "new" || a.cond === "poor") {
        const s = st("seeding", 4);
        add(1, "Establish grass into standing cover or mulch", "NRCS 327 / 550 / 342",
          "Seedlings in open soil get cut down by blowing soil; standing stubble or mulch shelters them.",
          [...wins(seedW), ...s.specs], seedWhen, seedMonths && { act: seedMonths }, [...seedW.refs, ...s.refs, ...cps("327", "550")], [...seedW.more, ...s.more]);
        species = nativeRows();
        mix = mixFor();
      }
      const c = st("crp", 5), exp = a.stage === "exp";
      add(exp ? 1 : 2, exp ? "Convert expiring CRP without leaving it bare" : "Manage the stand under the CRP rules", "NRCS 327 / 528 / 329",
        exp ? "Clean-tilling old CRP sod leaves little residue going into the windy season." : "Mid-contract management should refresh the stand without exposing soil in the windy season.",
        [...c.specs, exp ? `Never leave converted ground bare through ${rt}.` : `No burning or disking just before or during ${rt}.`],
        exp ? "Plan the conversion a season ahead" : `Manage outside ${rt}`, { on: ctx.riskMonths }, [...c.refs, ...cps("327")], c.more);
    }

    else if (lu === "disturbed") {
      const dt = a.dtype || "pad", stage = a.stage || "spring";
      title = "Disturbed land — " + { pad: "well pad or graded site", pipe: "pipeline or utility right-of-way", build: "construction site", road: "unpaved roads and lots" }[dt];
      summary = "Graded sites lose their crust and topsoil; every bare acre upwind feeds dust onto neighbors and roads.";
      if (dt === "road") {
        add(1, "Dust control on unpaved surfaces", "NRCS 373", "Traffic grinds soil into fine dust that blows in every wind.",
          ["Water or apply a dust suppressant on heavy-traffic routes; reduce speeds; gravel the worst sections."],
          "Before and during " + rt, { act: ctx.riskMonths }, []);
      }
      if (stage === "fall") {
        add(1, "Temporary cover plus mulch right away", "NRCS 340 / 484",
          `A site that goes into ${rt} bare will blow; temporary cover holds it until the permanent seeding window.`,
          coverW.text.length ? wins(coverW) : ["Sow a temporary small-grain or annual cover now, then mulch."],
          "Immediately", coverW.months.length ? { act: coverW.months } : null, [...coverW.refs, ...cps("340", "484")]);
      }
      add(1, "Salvage and respread topsoil; keep the footprint small", "Reclamation",
        "Native topsoil carries seed, organic matter and crust organisms; subsoil revegetates poorly.",
        ["Strip topsoil separately; never salvage when wet or frozen; keep stockpiles low and seeded.", "Reclaim unused parts of the site as soon as the work ends."],
        "At construction and immediately after", null, []);
      const d = st("disturbed", 5);
      add(1, "Critical area planting and mulch", "NRCS 342 / 484",
        "Permanent cover is the long-term fix; mulch holds the surface while the seed establishes.",
        [...d.specs, ...wins(seedW)], seedWhen, seedMonths && { act: seedMonths }, [...d.refs, ...seedW.refs, ...cps("342", "484")], d.more);
      species = nativeRows();
      mix = mixFor();
    }

    else if (lu === "barren") {
      const bt = a.btype || "dune";
      title = "Bare sand, dunes and blowouts";
      summary = bt === "caliche" ? "Gravel and caliche surfaces armor themselves (often WEG 8); the dust comes from traffic and disturbed edges." : "Active sand must be stopped at the surface before plants can establish.";
      add(1, "Keep livestock and vehicles out", "NRCS 382 / 528", "Hoof and tire traffic keeps sand loose and breaks any crust.",
        ["Fence the blowout and a buffer around it; route trails and roads away.", "Defer grazing until the area is stabilized."],
        "Now, until fully vegetated", { on: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] }, cps("382", "528"));
      if (bt !== "caliche") {
        const d = st("dunes", 6);
        add(1, "Stabilize and seed the moving sand", "NRCS 342 / 484 / 550",
          "Mulch or a cover stops the sand at the surface; deep-rooted sand grasses hold it once established.",
          [...(d.specs.length ? d.specs : ["Mulch the active sand, then seed sand-adapted native grasses into it."]), ...wins(seedW)],
          seedWhen, seedMonths && { act: seedMonths }, [...d.refs, ...seedW.refs, ...cps("342", "484")], d.more);
        species = nativeRows("sandy");
      } else {
        add(2, "Stabilize edges and traffic areas", "NRCS 373 / 342", "Fines come from disturbed edges, not the armored surface.",
          ["Limit traffic; seed and mulch the edges.", ...wins(seedW)], seedWhen, null, [...seedW.refs, ...cps("342")]);
      }
    }

    // the national soil notes, then the state's own context
    soilNotes(notes, lu, ctx);
    (B.context || []).slice(0, 2).forEach(x => notes.push(x));
    P.sort((x, y) => x.pri - y.pri);
    return { title, summary, practices: P, species, mix, coverTable, residueTable, notes, more: [...(B.context || []).slice(2), ...(B.notes || [])] };
  }

  /* ------------------------------------------------------------------ render */
  function render(o) {
    const st = o.state;
    if (!st.site) return;
    const pf = o.profile || null, lus = pf ? stateLU(pf) : LU;
    const sugg = st.nlcd && NLCD_TO_LU[st.nlcd.code];
    o.suggestTag.textContent = st.nlcd && st.nlcd.name ? `Map shows: ${st.nlcd.name}` : "";
    o.grid.innerHTML = lus.map(l => `<button class="lu ${st.landUse === l.id ? "active" : ""}" data-lu="${l.id}">
      ${sugg === l.id ? '<span class="sugg">map</span>' : ""}<span class="ic">${l.ic}</span><b>${esc(l.name)}</b><small>${esc(l.sub)}</small></button>`).join("");
    o.grid.onclick = e => {
      const b = e.target.closest("[data-lu]");
      if (!b) return;
      if (st.landUse !== b.dataset.lu) { st.landUse = b.dataset.lu; st.answers = {}; }
      o.onChange();
      setTimeout(() => o.qWrap.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
    };
    if (!st.landUse) { o.qWrap.hidden = true; o.plan.innerHTML = ""; return; }

    const qs = pf ? stateQ(st.landUse, pf) : Q[st.landUse];
    o.qWrap.hidden = false;
    o.qBox.innerHTML = qs.map(q => `<div class="q"><span>${esc(q.label)}</span><div class="seg" data-q="${q.id}">
      ${q.opts.map(([v, t], i) => `<button data-v="${v}" class="${(q.opts.some(x => x[0] === st.answers[q.id]) ? st.answers[q.id] === v : i === 0) ? "on" : ""}">${esc(t)}</button>`).join("")}</div></div>`).join("");
    o.qBox.onclick = e => {
      const b = e.target.closest("button[data-v]");
      if (!b) return;
      st.answers[b.parentElement.dataset.q] = b.dataset.v;
      o.onChange();
    };
    // an answer from another state (a crop or shrub it does not list) falls back to the first option
    const answers = Object.fromEntries(qs.map(q => [q.id, q.opts.some(x => x[0] === st.answers[q.id]) ? st.answers[q.id] : q.opts[0][0]]));
    const ctx = context(st, o.surface, o.risk, pf);
    o.plan.innerHTML = planHTML(pf ? planState(st.landUse, answers, ctx) : plan(st.landUse, answers, ctx), ctx);
  }

  const LEVEL = ["", "Low", "Moderate", "High", "Very high", "Extreme"];
  function planHTML(p, ctx) {
    const refIdx = [];
    const pf = ctx.pf, REF = k => (pf && pf.refs[k]) || R[k];
    const cite = keys => [...new Set(keys)].filter(REF).map(k => {
      let i = refIdx.indexOf(k);
      if (i < 0) { refIdx.push(k); i = refIdx.length - 1; }
      return `<a href="${REF(k)[1]}" target="_blank" rel="noopener" title="${esc(REF(k)[0])}">[${i + 1}]</a>`;
    }).join(" ");
    const chips = [
      ctx.level ? `<span class="chip">Bare-soil risk: ${LEVEL[ctx.level]} (${UN.fmtCls("soilLoss", ctx.E, 0)})</span>` : "",
      `<span class="chip">Windy season: ${esc(ctx.riskText)}${ctx.seasonNote ? ` (${esc(ctx.seasonNote)})` : ""}</span>`,
      ctx.weg ? `<span class="chip" title="Wind Erodibility Group, 1 (most erodible) to 8 (not erodible)">WEG ${esc(ctx.weg)} · cover target ≥ ${coverTarget(ctx.weg)}%</span>` : "",
      `<span class="chip">${esc(ctx.regionName)}${ctx.mlra ? " · MLRA " + esc(ctx.mlra) : ""}</span>`,
      ctx.eco ? `<span class="chip">${esc(ctx.eco)}</span>` : "",
      `<span class="chip">Barriers: ${esc(ctx.orient)}</span>`,
    ].join("");
    const pracs = p.practices.map((x, i) => `<div class="prac pri-${x.pri}">
      <div class="prac-h"><span class="prac-n">${i + 1}</span><div><b>${esc(x.title)}</b><span class="code">${esc(x.code)}</span></div></div>
      <p>${esc(x.why)}</p>
      <ul>${x.specs.map(s => `<li>${esc(s)}</li>`).join("")}</ul>
      ${x.when ? `<div class="when">When: ${esc(x.when)}</div>` : ""}
      ${x.refs.length ? `<div class="cite">Sources ${cite(x.refs)}</div>` : ""}
      ${x.more && x.more.length ? `<details class="more"><summary>More from ${esc(pf.name)}'s sources (${x.more.length})</summary><ul>${x.more.map(([t, rs]) => `<li>${esc(t)} ${cite(rs)}</li>`).join("")}</ul></details>` : ""}</div>`).join("");

    const rows = p.practices.filter(x => x.months);
    const cal = `<div class="calendar">
      <span></span>${MONTHS.map((m, i) => `<span class="mh ${ctx.riskMonths.includes(i) ? "hi" : ""}">${m[0]}</span>`).join("")}
      <span class="lbl">Wind risk</span>${MONTHS.map((_, i) => `<i class="cell ${ctx.riskMonths.includes(i) ? "risk-hi" : ctx.midMonths.includes(i) ? "risk-mid" : ""}"></i>`).join("")}
      ${rows.map(x => `<span class="lbl" title="${esc(x.title)}">${esc(shortName(x.title))}</span>${MONTHS.map((_, i) =>
        `<i class="cell ${(x.months.act || []).includes(i) ? "act" : (x.months.on || []).includes(i) ? "on" : ""}"></i>`).join("")}`).join("")}
    </div>
    <div class="chart-legend"><span><i class="sw red"></i>High wind risk</span><span><i class="sw amber"></i>Elevated</span><span><i class="sw" style="background:var(--risk-1)"></i>Cover / protection in place</span><span><i class="sw" style="background:var(--blue)"></i>Action window</span></div>`;

    const resid = p.residueTable ? `<div class="card"><div class="card-h"><h3>How much residue is enough here?</h3></div>
      <div class="table-wrap"><table class="grid"><thead><tr><th>Flat small-grain-equivalent residue</th>${p.residueTable.map(r => `<th>${nums("massArea", r[0], undefined, "lb/ac")}<small>${esc(UN.sym("massArea"))}</small></th>`).join("")}</tr></thead>
      <tbody><tr><td>Est. annual loss, wide field (${esc(UN.sym("soilLoss"))})</td>${p.residueTable.map(r => `<td>${UN.num("soilLoss", r[1], UN.conv("soilLoss", r[1]) < 10 ? 1 : 0)}</td>`).join("")}</tr></tbody></table></div>
      <p class="fine">Scaled from the NRCS WEQ E-table (NAM Exhibit 502-1) to this site's bare-soil potential; approximate. Standing residue counts more: ${L("1,000 lb/ac")} of standing sorghum ≈ ${L("1,300 lb/ac")} flat equivalent, standing ${L("10-in")} wheat stubble ≈ ${L("3,500 lb/ac", null, { n: 1 })}, flat sorghum stalks ≈ ${L("350 lb/ac", null, { n: 1 })} (NebGuide G1537). ${cite(pf ? ["neb"] : ["fotg", "neb"])}</p></div>` : "";
    const cv = p.coverTable ? `<div class="card"><div class="card-h"><h3>Cover crop options</h3></div>
      <div class="table-wrap"><table class="grid species"><thead><tr><th>Crop</th><th>Scientific name</th><th>Notes</th><th>${esc(UN.sym("massArea"))}${cvd("massArea", "lb/ac") ? "<small>(lb/ac)</small>" : ""}</th></tr></thead>
      <tbody>${p.coverTable.map(r => `<tr><td>${esc(r[0])}</td><td class="l"><i>${esc(r[1])}</i></td><td class="l">${esc(r[2])}</td><td>${esc(typeof r[3] === "string" ? r[3] : rate(r[3]))}</td></tr>`).join("")}</tbody></table></div>
      <p class="fine">${pf ? `Rates and notes as ${esc(pf.name)}'s sources give them; check the state's current 340 guidance and termination rules with your NRCS office. ${cite([...new Set(pf.cover.filter(c => inReg(c, ctx)).flatMap(c => c.refs))])}`
        : `Plant/terminate dates must follow the Texas Cover Crop Calculator (±10 days with justification); broadcast at 150% of the drilled rate. ${cite(["tx340", "tx340g", "delaune"])}`}</p></div>` : "";
    const mixU = p.mix && (!p.mix.unit || /^lbs?\.?( PLS)?\s*\/\s*(ac|acre)$/i.test(p.mix.unit.trim())); // a state mix in another unit is shown as written
    const mx = p.mix ? `<div class="card"><div class="card-h"><h3>Ready-made seed mix</h3><span class="tag">${esc(mixU ? L(`${fmt(p.mix.rows.reduce((s, r) => s + r[1], 0), 2)} lb PLS/ac`, null, { d: 2 }) : `${fmt(p.mix.rows.reduce((s, r) => s + r[1], 0), 2)} ${p.mix.unit}`)}</span></div>
      <p class="fine" style="margin:0 0 8px">${esc(p.mix.title)}</p>
      <div class="table-wrap"><table class="grid species"><thead><tr><th>Species</th><th>${mixU ? `${esc(usym("massArea", "PLS"))}${cvd("massArea", "lb/ac") ? "<small>(lb PLS/ac)</small>" : ""}` : esc(p.mix.unit)}</th></tr></thead>
      <tbody>${p.mix.rows.map(r => `<tr><td>${esc(r[0])}</td><td>${mixU ? cell("massArea", r[1], "lb/ac", 2) : `${fmt(r[1], 2)} ${esc(p.mix.unit)}`}</td></tr>`).join("")}</tbody></table></div>
      <p class="fine">${esc(p.mix.note)} ${cite(p.mix.refs || [p.mix.ref])}</p></div>` : "";
    const sp = p.species && p.species.length ? `<div class="card"><div class="card-h"><h3>Adapted native species</h3><span class="tag">${esc(ctx.regionName)}${!pf ? ` · ${esc(ctx.soilGroup)} soils` : p.species.fit ? ` · ${esc(p.species.group)} soils` : ""}</span></div>
      <div class="table-wrap"><table class="grid species"><thead><tr><th>Species</th><th>Scientific name</th><th>Releases / sources</th><th>PLS ${esc(UN.sym("massArea"))}<small>pure stand${cvd("massArea", "lb/ac") ? " (lb/ac)" : ""}</small></th></tr></thead>
      <tbody>${p.species.map(r => `<tr><td>${esc(r[0])}</td><td class="l"><i>${esc(r[1])}</i></td><td class="l">${esc(typeof r[2] === "function" ? r[2]() : r[2])}</td><td>${r[3] === null || r[3] === undefined ? "—" : cell("massArea", r[3], "lb/ac", 1, String(r[3]))}</td></tr>`).join("")}</tbody></table></div>
      <p class="fine">${pf ? `Species, releases and rates as ${esc(pf.name)}'s sources give them${p.species.fit ? "" : " (none listed for this soil group, so the region's list)"}; confirm the mix and seed origin with your NRCS office. ${cite([...new Set(pf.natives.filter(n => inReg(n, ctx)).flatMap(n => n.refs))].slice(0, 6))}`
        : `Mix 3–6 species; each species' rate ≈ its pure-stand rate × its share of the mix. Use certified PLS collected within ~${L("200 mi")} north–south and ~${L("100 mi")} east–west of the site, and confirm with your NRCS office. ${cite(["texnat", "tx550", "txdot"])}`}</p></div>` : "";
    // a note is text, or [text, sources] from a state's profile
    const noteP = n => `<p class="note-box" style="margin:0 0 8px">${Array.isArray(n) ? `${esc(n[0])} ${cite(n[1])}` : esc(n)}</p>`;
    const notes = p.notes.length ? `<div class="card"><div class="card-h"><h3>Site notes</h3></div>${p.notes.map(noteP).join("")}</div>` : "";
    const more = p.more && p.more.length ? `<div class="card"><div class="card-h"><h3>More from ${esc(pf.name)}</h3></div>
      <details class="more"><summary>${p.more.length} more notes from ${esc(pf.name)}'s sources</summary><ul>${p.more.map(([t, rs]) => `<li>${esc(t)} ${cite(rs)}</li>`).join("")}</ul></details></div>` : "";
    const body = `<div class="card"><div class="card-h"><h3>Timing calendar</h3></div>${cal}</div>
      <div class="card"><div class="card-h"><h3>Recommended practices, in priority order</h3></div>${pracs}</div>
      ${resid}${cv}${mx}${sp}${notes}${more}`;
    return `<div class="tab" style="gap:12px">
      <div class="plan-head"><h3>${esc(p.title)}</h3><p>${esc(p.summary)}</p><div class="chips">${chips}</div>
        <button class="btn small print-btn" onclick="window.print()">Print / save PDF</button></div>
      ${body}
      <div class="card"><div class="card-h"><h3>Sources</h3></div><ol class="refs">${refIdx.map(k => `<li><a href="${REF(k)[1]}" target="_blank" rel="noopener">${esc(REF(k)[0])}</a></li>`).join("")}</ol>
      <p class="fine">${pf ? `Practice codes are USDA-NRCS conservation practice standards (${esc(pf.name)}'s eFOTG where it has them). ${esc(pf.name)}'s facts are shown as their sources write them (US customary units); the national parts (cover targets, residue table) follow the units table.`
        : "Practice codes are USDA-NRCS conservation practice standards (Texas eFOTG)."} Final designs (barrier spacing, strip widths, seeding rates) are set per field with WEPS by NRCS — contact your local NRCS field office or ${pf ? "county extension office" : "AgriLife county agent"} for design and cost-share (EQIP/CSP).</p></div>
    </div>`;
  }

  const SHORT = [
    [/retiring/i, "Retire to grass"], [/cover crop/i, "Cover crop"], [/no-till|residue/i, "Residue / no-till"],
    [/roughening/i, "Roughen if bare"], [/barriers|trap strips/i, "Barriers / strips"], [/harvest efficiency/i, "Grazing plan"],
    [/drought/i, "Drought checks"], [/range planting|rest first|seed grasses|seed sand/i, "Seeding"], [/tebuthiuron/i, "Herbicide"],
    [/mesquite/i, "Brush control"], [/deferment/i, "Deferment"], [/stubble/i, "Leave stubble"], [/re-establish|dead-litter/i, "Seeding"],
    [/annual forages/i, "Plant annuals"], [/maintain/i, "Stand care"], [/dust/i, "Dust control"], [/temporary cover/i, "Temp. cover"],
    [/critical area/i, "Seeding"], [/livestock and vehicles/i, "Exclusion"], [/mulch the moving/i, "Mulch"], [/convert/i, "Convert in strips"],
    [/pivot corners/i, "Pivot corners"],
  ];
  function shortName(t) {
    const hit = SHORT.find(([re]) => re.test(t));
    return hit ? hit[1] : t.split(/[,:—]/)[0].slice(0, 18);
  }

  return { render, context, plan, planState, loadProfile, profile, LU, coverReduction };
})();
