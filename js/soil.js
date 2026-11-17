/* Soil: SSURGO (USDA Soil Data Access) query, texture/WEG logic, pedotransfer, exports. */
WG.soil = (function () {
  const { num, fetchJSON } = WG.util;
  const SDA = "https://SDMDataAccess.sc.egov.usda.gov/Tabular/post.rest";

  const TEX = {
    COS: "coarse sand", S: "sand", FS: "fine sand", VFS: "very fine sand",
    LCOS: "loamy coarse sand", LS: "loamy sand", LFS: "loamy fine sand", LVFS: "loamy very fine sand",
    COSL: "coarse sandy loam", SL: "sandy loam", FSL: "fine sandy loam", VFSL: "very fine sandy loam",
    L: "loam", SIL: "silt loam", SI: "silt", SCL: "sandy clay loam", CL: "clay loam", SICL: "silty clay loam",
    SC: "sandy clay", SIC: "silty clay", C: "clay",
    MUCK: "muck", PEAT: "peat", MPT: "mucky peat", MUCK_: "muck",
    BR: "bedrock", WB: "weathered bedrock", UWB: "unweathered bedrock", CEM: "cemented", IND: "indurated",
    GYP: "gypsiferous material", VAR: "variable", SPM: "slightly decomposed plant material",
    HPM: "moderately decomposed plant material", MPM: "highly decomposed plant material",
  };
  const FAMILY = {
    COS: "sand", S: "sand", FS: "sand", VFS: "sand",
    LCOS: "loamy sand", LS: "loamy sand", LFS: "loamy sand", LVFS: "loamy sand",
    COSL: "sandy loam", SL: "sandy loam", FSL: "sandy loam", VFSL: "sandy loam",
    L: "L", SIL: "SIL", SI: "SI", SCL: "SCL", CL: "CL", SICL: "SICL", SC: "SC", SIC: "SIC", C: "C",
  };
  // fragment modifiers in SSURGO texture codes (GR gravelly, CB cobbly, ST stony, BY bouldery, CN channery, FL flaggy,
  // CR cherty) mean 15–35% by volume, 35–60% with V (very: STV) and 60–90% with X (extremely: CBX); NSSH 618.73
  const FRAG_MOD = /^(GR|GRF|GRM|GRC|CB|ST|BY|CN|FL|CR)(V|X)?$/;
  const modVolume = mods => mods.reduce((v, m) => { const k = FRAG_MOD.exec(m); return k ? Math.max(v, k[2] === "X" ? 75 : k[2] === "V" ? 47.5 : 25) : v; }, 0);

  /* ---------------- SDA ---------------- */
  /* One query's answer (every table in it), asked once while it is on its way: two parts that ask the same question at
     once share one request (POSTs are not shared by js/util.js). Each caller gets rows of its own (rowsOf), so no caller
     sees another's changes. */
  const flying = new Map(); // query -> promise of SDA's answer
  function answer(query) {
    let p = flying.get(query);
    if (!p) {
      p = fetchJSON(SDA, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, format: "JSON+COLUMNNAME" }),
      }, 40000);
      flying.set(query, p);
      const done = () => { if (flying.get(query) === p) flying.delete(query); };
      p.then(done, done);
    }
    return p;
  }
  const rowsOf = t => (t && t.length ? t.slice(1).map(r => Object.fromEntries(t[0].map((c, i) => [c, r[i]]))) : []);
  const sda = async query => rowsOf((await answer(query)).Table);

  /* The point's map unit and every table read from it, in one request (it took nine). SDA answers each SELECT as a table
     of its own (Table, Table1, …) but stops at the first SELECT that finds no rows (tested 15 Nov 2026), so each one is
     joined to a one-row table: when it finds nothing it answers one row with hit NULL, which hits() drops. The soil's
     horizons carry the chemistry the Soil maps tab shows (js/soilmaps.js surveyAt reads the same answer). The rows come
     in the order the nine requests gave them (checked at five Texas points). */
  const one = (cols, from, order = "") => `SELECT x.hit, ${cols.split(",").map(c => `x.${c.trim().replace(/^\w+\./, "")}`).join(", ")}
    FROM (SELECT 1 AS one) d LEFT JOIN (SELECT 1 AS hit, ${cols} FROM ${from}) x ON 1 = 1${order ? ` ORDER BY ${order}` : ""};`;
  const hits = t => rowsOf(t).filter(r => r.hit !== null).map(r => { delete r.hit; return r; });
  function batch(lat, lon) {
    const inMu = "IN (SELECT cokey FROM component WHERE mukey = @m)";
    return `~DeclareInt(@m)~
    SELECT TOP 1 @m = mukey FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('point(${lon.toFixed(6)} ${lat.toFixed(6)})');
    SELECT @m AS mukey;
    ${one(`mu.mukey, mu.musym, mu.muname, mu.mukind, l.areasymbol, l.areaname, sc.saverest,
             ma.slopegraddcp, ma.slopegradwta, ma.brockdepmin, ma.wtdepannmin, ma.flodfreqdcd, ma.drclassdcd,
             ma.hydgrpdcd, ma.aws0150wta, ma.niccdcd, ma.iccdcd, ma.wtdepaprjunmin`,
      `mapunit mu JOIN legend l ON l.lkey = mu.lkey LEFT JOIN muaggatt ma ON ma.mukey = mu.mukey
           LEFT JOIN sacatalog sc ON sc.areasymbol = l.areasymbol WHERE mu.mukey = @m`)}
    ${one(`cokey, compname, comppct_r, majcompflag, compkind, localphase, taxclname, taxorder, taxsuborder,
             taxgrtgroup, taxsubgrp, taxpartsize, taxtempregime, taxmoistscl, drainagecl, hydgrp, slope_l, slope_r,
             slope_h, slopelenusle_r, weg, wei, tfact, albedodry_r, runoff, elev_r, nirrcapcl, nirrcapscl, irrcapcl,
             irrcapscl, rsprod_r, geomdesc, map_r, airtempa_r, ffd_r, erocl, hydricrating`, "component WHERE mukey = @m", "x.comppct_r DESC")}
    ${one(`ch.cokey, ch.chkey, ch.hzname, ch.hzdept_r, ch.hzdepb_r, ch.sandtotal_r, ch.silttotal_r,
             ch.claytotal_r, ch.sandvf_r, ch.sandfine_r, ch.sandmed_r, ch.sandco_r, ch.sandvc_r, ch.om_r,
             ch.dbthirdbar_r, ch.wthirdbar_r, ch.wfifteenbar_r, ch.wsatiated_r, ch.awc_r, ch.ksat_r,
             ch.ph1to1h2o_r, ch.cec7_r, ch.ecec_r, ch.caco3_r, ch.gypsum_r, ch.ec_r, ch.sar_r, ch.kwfact, ch.kffact,
             ch.sieveno10_r, ch.frag3to10_r, ch.fraggt10_r, ch.fragvoltot_r, ch.lep_r, ch.partdensity, tg.texture, tg.texdesc,
             ch.ph01mcacl2_r, ch.esp_r, ch.sumbases_r`,
      `chorizon ch LEFT JOIN chtexturegrp tg ON tg.chkey = ch.chkey AND tg.rvindicator = 'Yes' WHERE ch.cokey ${inMu}`, "x.cokey, x.hzdept_r")}
    ${one("la.areasymbol, la.areaname, la.areatypename, mo.areaovacres", `muaoverlap mo JOIN laoverlap la ON la.lareaovkey = mo.lareaovkey WHERE mo.mukey = @m`, "x.areaovacres DESC")}
    ${one("cokey, ecoclassid, ecoclassname, ecoclasstypename", `coecoclass WHERE cokey ${inMu}`)}
    ${one("cokey, cropname, yldunits, nonirryield_r, irryield_r", `cocropyld WHERE cokey ${inMu}`)}
    ${one("cokey, plantsym, plantsciname, plantcomname, rangeprod", `coeplants WHERE cokey ${inMu}`)}
    ${one("cokey, reskind, reshard, resdept_r, resdepb_r", `corestrictions WHERE cokey ${inMu}`)}`;
  }
  // the answer for a point, kept for the last few points of the visit (a failed one is asked again)
  const asked = new Map(); // "lat,lon" -> promise of SDA's answer
  function answerAt(lat, lon) {
    const k = `${lat.toFixed(6)},${lon.toFixed(6)}`;
    let p = asked.get(k);
    if (!p) {
      p = answer(batch(lat, lon));
      asked.set(k, p);
      p.catch(() => { if (asked.get(k) === p) asked.delete(k); });
      if (asked.size > 8) asked.delete(asked.keys().next().value);
    }
    return p;
  }
  /* The survey's tables at a point as fresh rows ({ mukey, mu, comps, hz, areas, eco, ylds, plants, restr }); null where
     no map unit is found */
  /* The backup copy of the survey, read only when Soil Data Access does not answer: USDA-NRCS SSURGO (FY2027) by state on
     GitHub Pages (barsa1ly.github.io/soildata*, tools/build_ssurgo.py there): a 30 m map-unit raster in EPSG:5070 tiles
     (512 x 512 uint16 indices, zlib) and each map unit's rows as tablesAt gives them (gzipped JSON, by mukey % 1024).
     The point's state picks the copy (app.js stateAt). -> the record (with backup: true), null for no map unit there, or
     undefined where no copy covers the state. Each file is kept for the visit. */
  const BACKUP = "https://barsa1ly.github.io/", BACKUP_REPO = { TX: "soildata" }; // more states as their copies are published
  const bkFiles = new Map();
  const bkGet = (u, f) => { if (!bkFiles.has(u)) { const p = f(u); bkFiles.set(u, p); p.catch(() => bkFiles.delete(u)); while (bkFiles.size > 80) bkFiles.delete(bkFiles.keys().next().value); } return bkFiles.get(u); };
  const bkBin = async (u, kind) => { const r = await WG.util.fetchQ(u, {}, 20000); if (!r.ok) throw new Error(`the backup copy answered ${r.status}`); return new Response(r.body.pipeThrough(new DecompressionStream(kind))).arrayBuffer(); };
  async function backupAt(lat, lon, st) {
    const repo = BACKUP_REPO[st];
    if (!repo || typeof DecompressionStream === "undefined" || !WG.landcover || !WG.landcover.albers) return undefined;
    const base = `${BACKUP}${repo}/${st}/`, ix = await bkGet(`${base}r30/index.json`, u => fetchJSON(u, {}, 20000));
    const [x, y] = WG.landcover.albers(lon, lat), size = ix.res * ix.tile, col = Math.floor((x - ix.x0) / size), row = Math.floor((ix.y0 - y) / size);
    if (!ix.have.includes(`${row}/${col}`)) return null;
    const tile = await bkGet(`${base}r30/${row}/${col}.bin`, async u => new Uint16Array(await bkBin(u, "deflate")));
    const i = tile[Math.floor((ix.y0 - y - row * size) / ix.res) * ix.tile + Math.floor((x - ix.x0 - col * size) / ix.res)];
    const mk = i ? (await bkGet(`${base}mukeys.json`, u => fetchJSON(u, {}, 20000)))[i] : null;
    if (!mk) return null;
    const shard = await bkGet(`${base}mu/${mk % 1024}.json.gz`, async u => JSON.parse(new TextDecoder().decode(await bkBin(u, "gzip"))));
    const rec = shard[String(mk)];
    return rec ? { ...rec, backup: true } : null;
  }
  /* The backup copy inside a boundary (rings of [lon, lat], even-odd over all rings, so holes count): the copy's 30 m
     cells whose centres lie inside, counted by map unit in each given state that has a copy, with each map unit's record
     as tablesAt gives it. For the Basin tab's HU12 (js/basins.js soilsIn) when Soil Data Access does not answer.
     -> { units: [{ st, mukey, cells, rec }], res, cells: the boundary's area in cells }, or undefined where no copy covers
     the states */
  async function backupIn(rings, states) {
    const sts = [...new Set(states)].filter(s => BACKUP_REPO[s]);
    if (!sts.length || typeof DecompressionStream === "undefined" || !WG.landcover || !WG.landcover.albers) return undefined;
    const R = rings.map(r => r.map(([lo, la]) => WG.landcover.albers(lo, la)));
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, area = 0;
    R.forEach(r => r.forEach(([x, y], i) => { const [xb, yb] = r[(i + 1) % r.length]; area += x * yb - xb * y; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }));
    const units = [];
    let res = 30;
    for (const st of sts) {
      const base = `${BACKUP}${BACKUP_REPO[st]}/${st}/`, ix = await bkGet(`${base}r30/index.json`, u => fetchJSON(u, {}, 20000)), T = ix.tile, have = new Set(ix.have);
      res = ix.res;
      // the boundary's box in this grid's cells, and the tiles over it copied into one block
      const c0 = Math.max(0, Math.floor((x0 - ix.x0) / res)), c1 = Math.min(ix.cols * T - 1, Math.floor((x1 - ix.x0) / res));
      const k0 = Math.max(0, Math.floor((ix.y0 - y1) / res)), k1 = Math.min(ix.rows * T - 1, Math.floor((ix.y0 - y0) / res));
      if (c1 < c0 || k1 < k0) continue;
      const w = c1 - c0 + 1, h = k1 - k0 + 1, data = new Uint16Array(w * h), jobs = [];
      for (let tr = Math.floor(k0 / T); tr <= Math.floor(k1 / T); tr++) {
        for (let tc = Math.floor(c0 / T); tc <= Math.floor(c1 / T); tc++) {
          if (!have.has(`${tr}/${tc}`)) continue;
          jobs.push(bkGet(`${base}r30/${tr}/${tc}.bin`, async u => new Uint16Array(await bkBin(u, "deflate"))).then(t => {
            const ca = Math.max(c0, tc * T), cb = Math.min(c1, tc * T + T - 1);
            for (let k = Math.max(k0, tr * T), kb = Math.min(k1, tr * T + T - 1); k <= kb; k++) data.set(t.subarray((k - tr * T) * T + ca - tc * T, (k - tr * T) * T + cb - tc * T + 1), (k - k0) * w + ca - c0);
          }));
        }
      }
      const [mk] = await Promise.all([bkGet(`${base}mukeys.json`, u => fetchJSON(u, {}, 20000)), ...jobs]);
      // the cells by scanline, as js/landcover.js count(): row k's centre is at top - (k + .5) res
      const left = ix.x0 + c0 * res, top = ix.y0 - k0 * res, xs = Array.from({ length: h }, () => []), n = new Map();
      for (const r of R) {
        for (let i = 0, m = r.length; i < m; i++) {
          const [xa, ya] = r[i], [xb, yb] = r[(i + 1) % m];
          if (ya === yb) continue;
          const lo = Math.max(0, Math.ceil((top - Math.max(ya, yb)) / res - 0.5)), hi = Math.min(h - 1, Math.floor((top - Math.min(ya, yb)) / res - 0.5));
          for (let k = lo; k <= hi; k++) { const y = top - (k + 0.5) * res; if ((ya <= y) !== (yb <= y)) xs[k].push(xa + ((y - ya) * (xb - xa)) / (yb - ya)); }
        }
      }
      xs.forEach((row, k) => {
        row.sort((a, b) => a - b);
        for (let i = 0; i + 1 < row.length; i += 2) {
          for (let c = Math.max(0, Math.ceil((row[i] - left) / res - 0.5)), cb = Math.min(w - 1, Math.floor((row[i + 1] - left) / res - 0.5)); c <= cb; c++) {
            const v = data[k * w + c];
            if (v) n.set(v, (n.get(v) || 0) + 1);
          }
        }
      });
      n.forEach((cells, i) => { if (mk[i]) units.push({ st, base, mukey: mk[i], cells }); });
    }
    // each map unit's record from its file (mukey % 1024), eight files at a time
    const files = new Map();
    units.forEach(u => { const k = `${u.base}mu/${u.mukey % 1024}.json.gz`; if (!files.has(k)) files.set(k, []); files.get(k).push(u); });
    const keys = [...files.keys()];
    for (let i = 0; i < keys.length; i += 8) {
      await Promise.all(keys.slice(i, i + 8).map(async k => {
        const s = await bkGet(k, async u => JSON.parse(new TextDecoder().decode(await bkBin(u, "gzip"))));
        files.get(k).forEach(u => { u.rec = s[String(u.mukey)] || null; });
      }));
    }
    return { units: units.map(({ base, ...u }) => u), res, cells: Math.abs(area) / 2 / (res * res) };
  }
  async function tablesAt(lat, lon) {
    let j;
    try { j = await answerAt(lat, lon); }
    catch (e) {
      // Soil Data Access did not answer: the backup copy of the point's state, where there is one
      const st = WG.app && WG.app.stateAt ? (WG.app.stateAt(lat, lon) || {}).code : null;
      const b = st ? await backupAt(lat, lon, st).catch(err => { console.warn("soil backup", err); return undefined; }) : undefined;
      if (b !== undefined) return b;
      throw e;
    }
    const mk = rowsOf(j.Table);
    if (!mk.length || mk[0].mukey === null) return null;
    if (!j.Table8) throw new Error("Soil Data Access sent only part of the survey; try again");
    const [mu, comps, hz, areas, eco, ylds, plants, restr] = [1, 2, 3, 4, 5, 6, 7, 8].map(k => hits(j[`Table${k}`]));
    return { mukey: parseInt(mk[0].mukey, 10), mu: mu[0] || {}, comps, hz, areas, eco, ylds, plants, restr };
  }

  /* The county at the point (Census 2020 counties, TIGERweb) as SSURGO writes county symbols: postal code + county
     code ("KS055"); null when TIGERweb gives none within 6 s. A map unit in a multi-county survey lists several
     counties, so this tells which one the point is in. */
  const TIGER_COUNTY = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/55/query";
  const symOf = (st, cty) => { const s = window.WG_STATES.list.find(x => x.f === st); return s && cty ? s.c + cty : null; };
  async function countyAt(lat, lon) {
    try {
      const q = new URLSearchParams({ geometry: `${lon},${lat}`, geometryType: "esriGeometryPoint", inSR: "4326",
        spatialRel: "esriSpatialRelIntersects", outFields: "STATE,COUNTY", returnGeometry: "false", f: "json" });
      const j = await fetchJSON(`${TIGER_COUNTY}?${q}`, {}, 6000);
      const a = j && j.features && j.features[0] && j.features[0].attributes;
      return a ? symOf(a.STATE, a.COUNTY) : null;
    } catch (e) { return null; }
  }
  // the county whose C applies: the one at the point when the map unit lists it (or lists none), else the map unit's
  // county with the most acres (St. Louis city's soils are in St. Louis County's survey, Virginia's cities in their
  // counties', and a Connecticut point is in a 2020 county SSURGO still uses)
  const pickCounty = (counties, at) => (at && (!counties.length || counties.includes(at)) ? at : counties[0] || null);

  async function fetchSoil(lat, lon) {
    const atP = countyAt(lat, lon); // asked alongside the survey; it never throws
    const t = await tablesAt(lat, lon);
    if (!t) return null;
    return assemble({ lat, lon, ...t, countyAt: await atP });
  }

  function assemble(raw) {
    const hzBy = groupBy(raw.hz, "cokey");
    const comps = raw.comps.map(c => ({
      ...c,
      comppct_r: num(c.comppct_r),
      horizons: (hzBy[c.cokey] || []).filter(h => num(h.hzdepb_r) !== null),
      eco: raw.eco.find(e => e.cokey === c.cokey && /ecological site/i.test(e.ecoclasstypename || "Ecological Site"))
        || raw.eco.find(e => e.cokey === c.cokey) || null,
      restrictions: raw.restr.filter(r => r.cokey === c.cokey).sort((a, b) => num(a.resdept_r) - num(b.resdept_r)),
      yields: raw.ylds.filter(y => y.cokey === c.cokey),
      plants: raw.plants.filter(p => p.cokey === c.cokey && num(p.rangeprod) > 0)
        .sort((a, b) => num(b.rangeprod) - num(a.rangeprod)),
    }));
    // dominant soil = largest component that actually has horizon data
    const withHz = comps.filter(c => c.horizons.some(h => num(h.sandtotal_r) !== null || num(h.claytotal_r) !== null));
    const dom = withHz[0] || comps[0] || null;
    const area = t => raw.areas.find(a => (a.areatypename || "").toLowerCase().startsWith(t));
    const areas = t => raw.areas.filter(a => (a.areatypename || "").toLowerCase().startsWith(t)); // most acres first
    const mlra = area("mlra");
    const counties = areas("county").map(a => a.areasymbol);
    const countySym = pickCounty(counties, raw.countyAt);
    const county = areas("county").find(a => a.areasymbol === countySym) || area("county");
    // C: the map unit's climate-factor areas weighted by its acres in each (a map unit can lie in several); 0 is not a
    // rating; the county table (js/app.js tableC) decides between this and the county's value
    const cfs = areas("climate factor"), cRated = cfs.map(a => ({ c: num(a.areasymbol), w: num(a.areaovacres) || 0 })).filter(x => x.c > 0);
    const cW = cRated.reduce((s, x) => s + x.w, 0);
    const cFactor = !cRated.length ? null : cW ? cRated.reduce((s, x) => s + x.c * x.w, 0) / cW : cRated.reduce((s, x) => s + x.c, 0) / cRated.length;
    const surface = dom ? surfaceLayer(dom) : null;
    return {
      source: "SSURGO",
      lat: raw.lat, lon: raw.lon,
      mukey: raw.mukey,
      backup: !!raw.backup, // read from the backup copy (Soil Data Access did not answer)
      mapunit: raw.mu,
      county: county ? county.areaname : null,
      countySym, // e.g. "KS055": the state's county C table (js/app.js tableC)
      counties, // every county the map unit lists, most acres first
      mlra: mlra ? { sym: mlra.areasymbol, name: mlra.areaname } : null,
      cFactor, // the map unit's own NRCS C, acre-weighted (a plain mean when SSURGO gives no acres); null when none is rated
      cWeighted: cW > 0,
      cSyms: cfs.map(a => String(a.areasymbol)), // the climate-factor symbols as SSURGO writes them (0 included)
      rFactor: num((area("rainfall factor") || {}).areasymbol),
      components: comps,
      dominant: dom,
      dominantIsTop: dom && comps[0] && dom.cokey === comps[0].cokey,
      surface,
    };
  }

  function groupBy(arr, k) {
    return arr.reduce((o, r) => ((o[r[k]] = o[r[k]] || []).push(r), o), {});
  }

  function parseTexture(tex) {
    if (!tex) return { code: null, base: null, mods: [] };
    const parts = String(tex).toUpperCase().split(/[-\s]+/).filter(Boolean);
    const base = parts.reverse().find(p => TEX[p]) || parts[0];
    return { code: tex, base, mods: parts.filter(p => p !== base) };
  }

  /* Fragments > 2 mm as weight % of the whole soil: the No. 10 sieve figure covers only the < 3 in part,
     frag3to10_r and fraggt10_r (whole-soil weight %) the cobbles and stones. */
  function wholeFrag(hz) {
    const big = (num(hz.frag3to10_r) ?? 0) + (num(hz.fraggt10_r) ?? 0), pass = num(hz.sieveno10_r);
    return pass === null ? big : Math.min(100, big + Math.max(0, 100 - pass) * (100 - big) / 100);
  }

  /* the surface the app reads and edits: the first horizon with sand or clay (a forest soil's organic O horizon on top has
     none, and wind does not move it the way it moves the mineral soil); the first horizon when none has them */
  const surfaceIndex = comp => Math.max(0, comp.horizons.findIndex(h => num(h.sandtotal_r) !== null || num(h.claytotal_r) !== null));
  function surfaceLayer(comp) {
    const hz = comp.horizons[surfaceIndex(comp)];
    if (!hz) return null;
    const tex = parseTexture(hz.texture);
    const sand = num(hz.sandtotal_r), clay = num(hz.claytotal_r);
    let silt = num(hz.silttotal_r);
    if (silt === null && sand !== null && clay !== null) silt = 100 - sand - clay;
    return {
      hzname: hz.hzname,
      depthTop: num(hz.hzdept_r), depthBot: num(hz.hzdepb_r),
      sand, silt, clay,
      vfs: num(hz.sandvf_r),
      om: num(hz.om_r),
      caco3: num(hz.caco3_r) ?? 0,
      ph: num(hz.ph1to1h2o_r),
      bd: num(hz.dbthirdbar_r),
      texCode: tex.base,
      texMods: tex.mods,
      texName: hz.texdesc ? hz.texdesc.toLowerCase() : (TEX[tex.base] || null),
      weg: comp.weg ? String(comp.weg).trim() : null,
      wei: num(comp.wei),
      fragVol: num(hz.fragvoltot_r), // % by volume, whole soil
      modVol: modVolume(tex.mods),
      cf: wholeFrag(hz),
    };
  }

  /* ---------------- texture class (USDA triangle) ---------------- */
  function textureClass(sand, silt, clay) {
    if ([sand, silt, clay].some(v => v === null || isNaN(v))) return null;
    if (silt + 1.5 * clay < 15) return "S";
    if (silt + 1.5 * clay >= 15 && silt + 2 * clay < 30) return "LS";
    if ((clay >= 7 && clay < 20 && sand > 52 && silt + 2 * clay >= 30) || (clay < 7 && silt < 50 && silt + 2 * clay >= 30)) return "SL";
    if (clay >= 7 && clay < 27 && silt >= 28 && silt < 50 && sand <= 52) return "L";
    if ((silt >= 50 && clay >= 12 && clay < 27) || (silt >= 50 && silt < 80 && clay < 12)) return "SIL";
    if (silt >= 80 && clay < 12) return "SI";
    if (clay >= 20 && clay < 35 && silt < 28 && sand > 45) return "SCL";
    if (clay >= 27 && clay < 40 && sand > 20 && sand <= 45) return "CL";
    if (clay >= 27 && clay < 40 && sand <= 20) return "SICL";
    if (clay >= 35 && sand > 45) return "SC";
    if (clay >= 40 && silt >= 40) return "SIC";
    return "C";
  }

  /* Keep the sand-size modifier from the survey (e.g. FSL) when the family is unchanged. */
  function refineCode(computed, surveyCode) {
    if (!surveyCode || !computed) return computed;
    const fam = c => ({ S: "sand", LS: "loamy sand", SL: "sandy loam" }[c] || FAMILY[c]);
    return fam(computed) === FAMILY[surveyCode] ? surveyCode : computed;
  }

  /* ---------------- Wind Erodibility Group (NRCS NSSH Part 618, §618.93, amended 2024) ----------------
     Surface-layer texture classes. "Calcareous" in the NSSH means strong or violent effervescence
     with cold 1N HCl; there is no CaCO3 threshold, so CaCO3 >= 5% is used as the proxy.
     Coarse fragments (footnote 31) move the group toward less erodible. Not applied: iron-rich mineralogy, andic
     material, wetness and Folists; the survey's own group covers them for an unedited soil. Returns { weg, I, why }. */
  const WEG_I = { "1": 220, "2": 134, "3": 86, "4": 86, "4L": 86, "5": 56, "6": 48, "7": 38, "8": 0 };
  const WEG1_I = { VFS: 310, FS: 250, S: 220, COS: 160 };

  function wegFromSurface(s) {
    const code = s.texCode;
    const clay = s.clay ?? 0;
    const calc = (s.caco3 ?? 0) >= 5;
    const fam = FAMILY[code] || ({ S: "sand", LS: "loamy sand", SL: "sandy loam" }[code]);
    let weg, why;
    if ((s.om ?? 0) >= 20) { weg = "2"; why = "organic (sapric) surface"; }
    else if (fam === "sand") { weg = "1"; why = "sand textures"; }
    else if (fam === "loamy sand") { weg = "2"; why = "loamy sand textures"; }
    else if (code === "VFSL" && clay <= 5) { weg = "2"; why = "very fine sandy loam with ≤ 5% clay"; }
    else if (fam === "sandy loam") { weg = "3"; why = "sandy loam textures"; }
    else if (code === "SIL" && clay <= 5) { weg = "2"; why = "silt loam with ≤ 5% clay"; }
    else if (code === "C" || code === "SIC") { weg = "4"; why = "clay or silty clay"; }
    else if (calc && ["L", "SIL", "SI", "CL", "SICL", "SCL", "SC"].includes(code)) { weg = "4L"; why = "calcareous loamy surface (CaCO₃ ≥ 5%)"; }
    else if ((code === "CL" || code === "SICL") && clay > 35) { weg = "4"; why = "clay loam with > 35% clay"; }
    else if (code === "SIL" && clay >= 5 && clay < 12 && (s.vfs ?? 0) >= 20) { weg = "3"; why = "silt loam, 5–12% clay, high very fine sand"; }
    else if ((code === "L" || code === "SIL") && clay < 20) { weg = "5"; why = "noncalcareous loam/silt loam < 20% clay"; }
    else if (code === "SCL" || code === "SC") { weg = "5"; why = "noncalcareous sandy clay loam / sandy clay"; }
    else if ((code === "L" || code === "SIL") && clay >= 20) { weg = "6"; why = "noncalcareous loam/silt loam ≥ 20% clay"; }
    else if (code === "CL" || code === "SICL") { weg = "6"; why = "noncalcareous clay loam / silty clay loam ≤ 35% clay"; }
    else if (code === "SI") { weg = "7"; why = "noncalcareous silt"; }
    else { weg = null; why = "texture not classified"; }
    let I = weg === "1" ? (WEG1_I[code] ?? 220) : (weg ? WEG_I[weg] : null);
    // coarse-fragment adjustment, NSSH §618.93 footnote 31, by volume: SSURGO's fragment volume if given, else the sieve
    // weight % converted with the bulk density and 2.65 g/cm3 for rock (17% by weight is about 10% by volume);
    // at least the middle of the class a texture modifier gives (STV, very stony: 35–60%)
    const w = Math.min(100, s.cf ?? 0), bd = s.bd || 1.45;
    const fromWeight = w > 0 ? (100 * w / 2.65) / (w / 2.65 + (100 - w) / bd) : 0;
    const cf = Math.max(s.fragVol ?? fromWeight, s.modVol ?? 0);
    if (weg && weg !== "8" && cf >= 15) {
      const sandy = weg === "1" || weg === "2";
      const steps = cf > 60 ? (sandy ? 3 : 99) : cf >= 35 ? (sandy ? 1 : 2) : (sandy ? 0 : 1);
      if (steps > 0) {
        // one group less erodible = the next lower I (footnote 31: 160 → 134, 86 → 56), so 3, 4 and 4L all move to 5
        const ORDER = ["1", "2", "3", "5", "6", "7", "8"];
        const at = ORDER.indexOf(weg === "4" || weg === "4L" ? "3" : weg);
        const nw = ORDER[Math.min(ORDER.length - 1, at + steps)];
        why += `; ${Math.round(cf)}% rock fragments by volume → WEG ${nw}`;
        weg = nw;
        I = WEG_I[nw];
      }
    }
    return { weg, I, why };
  }

  /* The nine groups, most to least erodible, with the NSSH Part 618 §618.93 (2024) texture guide, for the class tables.
     For a named soil NRCS uses the group recorded in the survey (NAM Part 502); the guide is for unidentified soils,
     so a soil's group can differ from its texture (Pullman clay loam is WEG 7). Label a soil's group by number and I only.
     I: wind erodibility index, t/ac/yr: loss from a wide, bare, smooth field in the climate of Garden City, KS. */
  const WEG_INFO = [
    { g: "1", name: "sands", I: "160–310", def: "Very fine sand, fine sand, sand or coarse sand. I runs from 160 t/ac/yr for coarse sand to 310 for very fine sand (220 on average)." },
    { g: "2", name: "loamy sands", I: "134", def: "Loamy very fine sand, loamy fine sand, loamy sand, loamy coarse sand; very fine sandy loam and silt loam with 5% clay or less; sapric (well-decomposed) organic material." },
    { g: "3", name: "sandy loams", I: "86", def: "Very fine sandy loam with more than 5% clay, fine sandy loam, sandy loam, coarse sandy loam; noncalcareous silt loam with 20–50% very fine sand and 5–12% clay." },
    { g: "4", name: "clays", I: "86", def: "Clay, silty clay; noncalcareous clay loam and silty clay loam with more than 35% clay (except iron-rich soils)." },
    { g: "4L", name: "calcareous loams", I: "86", def: "Calcareous loam, silt loam, silt, sandy clay, sandy clay loam, clay loam and silty clay loam." },
    { g: "5", name: "noncalcareous loams", I: "56", def: "Noncalcareous loam with less than 20% clay; noncalcareous silt loam with 5–20% clay (unless group 3); noncalcareous sandy clay loam and sandy clay; hemic (partly decomposed) organic material." },
    { g: "6", name: "noncalcareous clayey loams", I: "48", def: "Noncalcareous loam and silt loam with 20% clay or more; noncalcareous clay loam and silty clay loam with 35% clay or less; iron-rich silt loam." },
    { g: "7", name: "noncalcareous silts", I: "38", def: "Noncalcareous silt; iron-rich noncalcareous silty clay, silty clay loam and clay in Oxisols or Ultisols; fibric (raw) organic material. Texas surveys also place many clays and clay loams here, such as Pullman, Randall and Lockney." },
    { g: "8", name: "rock-covered or wet", I: "0", def: "Soils that rock fragments on the surface or wetness keep from blowing; Folists (organic soils on rock)." },
  ];
  const WEG_BY = Object.fromEntries(WEG_INFO.map(w => [w.g, w]));
  const wegInfo = g => WEG_BY[g] || null;

  /* ---------------- Saxton & Rawls (2006) ----------------
     sand, clay in % (0–100), om in % (capped at 8). Returns volumetric fractions, g/cm3, mm/h. Outside the soils they
     were fitted to the equations give impossible values (nearly pure sand: a negative wilting point; much clay with
     much OM: field capacity below the wilting point), so the wilting point is at least LL_MIN, field capacity and
     saturation each at least 0.01 above the one before, and bulk density and Ksat come from those bounded values. */
  const LL_MIN = 0.01; // cm3/cm3: the least water a soil is taken to hold at 15 bar (coarse sand holds about this)
  function saxtonRawls(sandPct, clayPct, omPct) {
    if (!Number.isFinite(sandPct) || !Number.isFinite(clayPct)) return null;
    // fractions of the fine earth, at most 1 together: the equations hold only for real mixes
    const s0 = Math.max(sandPct, 0), c0 = Math.max(clayPct, 0), sum = Math.max(s0 + c0, 100), S = s0 / sum, C = c0 / sum;
    const OM = Math.min(Math.max(Number.isFinite(omPct) ? omPct : 1, 0), 8);
    const t1500t = -0.024 * S + 0.487 * C + 0.006 * OM + 0.005 * S * OM - 0.013 * C * OM + 0.068 * S * C + 0.031;
    const t1500 = t1500t + (0.14 * t1500t - 0.02);
    const t33t = -0.251 * S + 0.195 * C + 0.011 * OM + 0.006 * S * OM - 0.027 * C * OM + 0.452 * S * C + 0.299;
    const t33 = t33t + (1.283 * t33t * t33t - 0.374 * t33t - 0.015);
    const ts33t = 0.278 * S + 0.034 * C + 0.022 * OM - 0.018 * S * OM - 0.027 * C * OM - 0.584 * S * C + 0.078;
    const ts33 = ts33t + (0.636 * ts33t - 0.107);
    const ts = t33 + ts33 - 0.097 * S + 0.043;
    const ll = Math.max(t1500, LL_MIN), dul = Math.max(t33, ll + 0.01), sat = Math.max(ts, dul + 0.01);
    const bd = (1 - sat) * 2.65;
    const B = (Math.log(1500) - Math.log(33)) / (Math.log(dul) - Math.log(ll));
    const ks = 1930 * Math.pow(sat - dul, 3 - 1 / B);
    return { ll, dul, sat, bd, ksat: ks, awc: dul - ll };
  }

  /* ---------------- crop-model site parameters ---------------- */
  // drainage rate (/day) by SSURGO drainage class in lower case; subaqueous soils (under water) as very poorly drained
  const DRAIN = {
    "excessively drained": 0.85, "somewhat excessively drained": 0.75, "well drained": 0.6,
    "moderately well drained": 0.4, "somewhat poorly drained": 0.25, "poorly drained": 0.05,
    "very poorly drained": 0.01, subaqueous: 0.01,
  };
  const CN = { A: [61, 64, 68, 71], B: [73, 76, 80, 83], C: [81, 84, 88, 91], D: [84, 87, 91, 94] };

  function curveNumber(hydgrp, slope) {
    // dual groups (A/D, B/D, C/D): second letter is the undrained (natural) condition
    const g = String(hydgrp || "B").split("/").pop().trim().charAt(0).toUpperCase();
    const row = CN[g] || CN.B;
    const s = slope ?? 1;
    return row[s < 2 ? 0 : s < 5 ? 1 : s < 10 ? 2 : 3];
  }

  /* bedrock or a cemented pan: a bedrock or cemented texture code (CEM-MAT, BR), or a texture of all zeros with no organic
     matter, as the survey's CEM-MAT rows have. It holds no fine earth, so Saxton & Rawls has nothing to work on. */
  const ROCK = new Set(["BR", "WB", "UWB", "CEM", "IND"]);
  function isRock(h) {
    const zero = k => num(h[k]) === 0;
    return ROCK.has(parseTexture(h.texture).base) || (zero("sandtotal_r") && zero("claytotal_r") && !num(h.silttotal_r) && !num(h.om_r));
  }

  /* Build the layer table used in the detailed profile and exports. */
  function profileLayers(comp, surfaceOverride) {
    const restr = comp.restrictions.find(r => num(r.resdept_r) !== null);
    const resDepth = restr ? num(restr.resdept_r) : null;
    const si = surfaceIndex(comp); // the edits go to the same horizon surfaceLayer reads, not to an organic layer above it
    return comp.horizons.map((h, i) => {
      const top = num(h.hzdept_r), bot = num(h.hzdepb_r);
      let sand = num(h.sandtotal_r), clay = num(h.claytotal_r), silt = num(h.silttotal_r), om = num(h.om_r);
      let ph = num(h.ph1to1h2o_r), caco3 = num(h.caco3_r), bd = num(h.dbthirdbar_r);
      const isTop = i === si && surfaceOverride;
      // est: the surface's water retention, bulk density and Ksat become Saxton & Rawls estimates, as their inputs (sand,
      // silt, clay, OM) were edited; a pH or CaCO3 edit alone keeps the survey's (silt as the survey's surface gives it)
      let est = false;
      if (isTop) {
        const s0 = { sand, silt: silt ?? (sand !== null && clay !== null ? 100 - sand - clay : null), clay, om };
        ({ sand, silt, clay, om, ph, caco3 } = { ...{ sand, silt, clay, om, ph, caco3 }, ...surfaceOverride });
        const s1 = { sand, silt, clay, om };
        est = Object.keys(s0).some(k => (s1[k] ?? null) !== s0[k]);
      }
      const rock = !est && isRock(h);
      if (silt === null && sand !== null && clay !== null && !rock) silt = 100 - sand - clay;
      const sr = rock ? null : saxtonRawls(sand, clay, om);
      let ll = num(h.wfifteenbar_r), dul = num(h.wthirdbar_r), sat = num(h.wsatiated_r);
      // in rock a water content or bulk density of zero means none (the survey's own positive values are kept)
      if (rock) { ll = ll || null; dul = dul || null; sat = sat || null; bd = bd || null; }
      ll = ll !== null && !est ? ll / 100 : sr ? sr.ll : null;
      dul = dul !== null && !est ? dul / 100 : sr ? sr.dul : null;
      if (bd === null || est) bd = est && sr ? sr.bd : bd ?? (sr ? sr.bd : null);
      sat = sat !== null && !est ? sat / 100 : sr ? sr.sat : bd ? 1 - bd / 2.65 : null;
      if (sat !== null && dul !== null) sat = Math.max(sat, dul + 0.01); // DSSAT requires SAT > DUL
      // a surface with edited sand, silt or clay is the texture they make; the survey's code stays if the family is the same, or if only pH or OM changed
      const edited3 = isTop && (sand !== num(h.sandtotal_r) || silt !== num(h.silttotal_r) || clay !== num(h.claytotal_r));
      const base = parseTexture(h.texture).base, made = edited3 ? refineCode(textureClass(sand, silt, clay), base) : null, retextured = !!made && made !== base;
      const ksatUm = num(h.ksat_r);
      const ksat = ksatUm !== null && !est ? ksatUm * 0.36 : sr ? sr.ksat / 10 : null; // cm/h
      const mid = top !== null && bot !== null ? (top + bot) / 2 : null;
      let srgf = mid === null ? null : bot <= 15 ? 1 : Math.exp(-0.02 * mid);
      if (resDepth !== null && top !== null && top >= resDepth) srgf = 0;
      const sieve = num(h.sieveno10_r);
      const cf = sieve !== null ? Math.max(0, 100 - sieve) : (num(h.frag3to10_r) ?? 0) + (num(h.fraggt10_r) ?? 0);
      const oc = om !== null ? om / 1.724 : null;
      return {
        hz: h.hzname || "", top, bot, texture: retextured ? made : h.texture || "", texdesc: retextured ? TEX[made] || "" : h.texdesc || "",
        sand, silt, clay, vfs: isTop && sand !== num(h.sandtotal_r) ? null : num(h.sandvf_r), om, oc, bd, ll, dul, sat,
        awc: (est ? null : num(h.awc_r)) ?? (dul !== null && ll !== null ? dul - ll : null),
        ksat, ph, cec: num(h.cec7_r) ?? num(h.ecec_r), caco3, gypsum: num(h.gypsum_r), ec: num(h.ec_r), sar: num(h.sar_r),
        kw: num(h.kwfact), cf, srgf, ni: oc !== null ? Math.min(oc / 10, 0.5) : null, lep: num(h.lep_r),
        edited: !!isTop, est,
      };
    });
  }

  /* stage-1 evaporation limit (mm) by DSSAT texture class: the HC27 generic soils used for the DSSAT SoilGrids
     profiles (Han et al. 2019) give sand 4, loam 6, clay 8; CSM's own default is 6 */
  const slu1 = tex => (["S", "LS"].includes(tex) ? 4 : ["C", "SIC", "SC"].includes(tex) ? 8 : 6);

  function siteParams(soil, comp, surface) {
    const slope = num(comp.slope_r) ?? num(soil.mapunit.slopegraddcp);
    const h0 = comp.horizons[0] || {};
    const tex = textureClass(surface?.sand ?? num(h0.sandtotal_r), surface?.silt ?? num(h0.silttotal_r), surface?.clay ?? num(h0.claytotal_r));
    const restr = comp.restrictions.find(r => num(r.resdept_r) !== null);
    const layers = comp.horizons;
    const depth = layers.length ? num(layers[layers.length - 1].hzdepb_r) : null;
    return {
      albedo: num(comp.albedodry_r),
      u: slu1(tex),
      tex,
      drainRate: DRAIN[(comp.drainagecl || "").toLowerCase()] ?? null,
      cn: curveNumber(comp.hydgrp, slope),
      slope,
      slopeRange: [num(comp.slope_l), num(comp.slope_h)],
      depth,
      restriction: restr ? { kind: restr.reskind, depth: num(restr.resdept_r), hard: restr.reshard } : null,
      hydgrp: comp.hydgrp,
      drainage: comp.drainagecl,
      tfact: num(comp.tfact),
      kw: layers[0] ? num(layers[0].kwfact) : null,
      lcc: comp.nirrcapcl ? comp.nirrcapcl + (comp.nirrcapscl || "") : null,
      lccIrr: comp.irrcapcl ? comp.irrcapcl + (comp.irrcapscl || "") : null,
      runoff: comp.runoff,
      rsprod: num(comp.rsprod_r),
      map: num(comp.map_r),
      airtemp: num(comp.airtempa_r),
      ffd: num(comp.ffd_r),
      aws150: num(soil.mapunit.aws0150wta),
      family: comp.taxclname,
    };
  }

  /* ---------------- exports ---------------- */
  // cf: the C the app used (js/app.js cFactor); surf: the surface the app uses (js/app.js currentSurface), whose WEG and I
  // are the edits' when they move the group (surf.calc), as Wind erosion › Soil shows
  function toCSV(soil, layers, site, cf, surf) {
    const w = surf || soil.surface || {}, mine = !!(surf && surf.calc);
    const head = ["horizon", "top_cm", "bottom_cm", "texture", "sand_pct", "silt_pct", "clay_pct", "vfs_pct",
      "om_pct", "oc_pct", "bulk_density_g_cm3", "ll15_cm3_cm3", "dul33_cm3_cm3", "sat_cm3_cm3", "awc_cm3_cm3",
      "ksat_cm_h", "ph_h2o", "cec_cmol_kg", "caco3_pct", "gypsum_pct", "ec_dS_m", "sar", "kw", "coarse_frag_pct",
      "root_growth_factor", "total_n_pct_est", "edited_by_user"];
    const r = v => (v === null || v === undefined ? "" : typeof v === "number" ? +v.toFixed(4) : `"${String(v).replace(/"/g, '""')}"`);
    const meta = [
      `# SoilGuard soil profile export`,
      `# location,${soil.lat.toFixed(5)},${soil.lon.toFixed(5)}`,
      `# map unit,"${soil.mapunit.muname || ""}",mukey ${soil.mukey},${soil.mapunit.areasymbol || ""}`,
      `# component,"${soil.dominant.compname}",${soil.dominant.comppct_r}% of map unit,"${site.family || ""}"`,
      `# slope_pct,${site.slope ?? ""},hydrologic_group,${site.hydgrp || ""},drainage,"${site.drainage || ""}"`,
      `# albedo,${site.albedo ?? ""},evap_limit_mm,${site.u},drainage_rate,${site.drainRate ?? ""},runoff_CN,${site.cn}`,
      `# WEG,${w.weg || ""},WEI,${w.wei ?? ""}${mine ? `,WEG_note,"(from your edits)"` : surf && surf.kept ? `,WEG_note,"(the survey's: your edits keep its group)"` : ""},T,${site.tfact ?? ""},C_factor,${cf ? +cf.C.toFixed(1) : ""},C_source,"${cf ? cf.src : ""}",C_ssurgo_symbols,"${(soil.cSyms || []).join(" ")}",MLRA,${soil.mlra ? soil.mlra.sym : ""}`,
    ];
    const rows = layers.map(l => [l.hz, l.top, l.bot, l.texture, l.sand, l.silt, l.clay, l.vfs, l.om, l.oc, l.bd, l.ll,
      l.dul, l.sat, l.awc, l.ksat, l.ph, l.cec, l.caco3, l.gypsum, l.ec, l.sar, l.kw, l.cf, l.srgf, l.ni, l.edited ? "yes" : "no"].map(r).join(","));
    return meta.concat([head.join(",")], rows).join("\n");
  }

  /* RWEQ surface-soil factors (Fryrear et al. 1994, 1998): erodible fraction EF (dry aggregates < 0.84 mm) and soil
     crust factor SCF, from sand, silt, clay, OM and CaCO3 in %. inRange: inputs inside the 57 soils the equations were fitted to. */
  function rweq(sf) {
    if (!sf || sf.sand == null || sf.clay == null) return null;
    const Sa = sf.sand, Cl = sf.clay, Si = sf.silt ?? 100 - Sa - Cl, OM = sf.om ?? 1, Ca = sf.caco3 ?? 0;
    const ratio = Sa / Math.max(Cl, 0.5);
    const ef = (29.09 + 0.31 * Sa + 0.17 * Si + 0.33 * ratio - 2.59 * OM - 0.95 * Ca) / 100;
    const scf = 1 / (1 + 0.0066 * Cl * Cl + 0.021 * OM * OM);
    const inRange = Sa >= 5.5 && Sa <= 93.6 && Si >= 0.5 && Si <= 69.5 && Cl >= 5 && Cl <= 39.3 &&
      ratio >= 1.2 && ratio <= 53 && OM >= 0.18 && OM <= 4.79 && Ca <= 25.2;
    return { ef: Math.min(1, Math.max(0, ef)), scf, inRange };
  }

  return { fetchSoil, tablesAt, backupIn, sda, parseTexture, textureClass, refineCode, wegFromSurface, saxtonRawls, profileLayers, siteParams, surfaceIndex,
    rweq, toCSV, slu1, TEX, FAMILY, WEG_I, WEG_INFO, wegInfo, curveNumber, DRAIN, pickCounty, symOf };
})();
