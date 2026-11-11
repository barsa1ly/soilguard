/* Field or area analysis. You draw a boundary on the map or upload one (.zip shapefile, .shp + .dbf + .prj, .kml, .kmz,
   .geojson). Soil Data Access clips the SSURGO soil polygons to it, and stratified random sample points estimate the
   share of the area in each Wind Erodibility Group and bare-soil risk class (E = I × C / 100; each map unit split by
   its component percentages). Buildings (FEMA/ORNL USA Structures), roads (Census TIGER, widened by road class) and
   water (USGS NHD water bodies, else Esri's NHD copy, plus SSURGO "Water" map units) are left out of the shares, and
   map clicks on them are refused through excludedAt(). */
WG.area = (function () {
  const { $, esc, fmt, fetchJSON, toast, download } = WG.util;
  const map = WG.map, META = window.WG_STATES.meta; // the statewide layers' legends
  const SDA = "https://SDMDataAccess.sc.egov.usda.gov/Tabular/post.rest";
  const STRUCT = "https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/USA_Structures_View/FeatureServer/0/query";
  const TIGER = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Transportation/MapServer/";
  const TIGER_LAYERS = [2, 6, 8]; // primary, secondary (most detailed), local roads
  const NHD = "https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/12/query";
  const COUNTIES = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/55/query"; // Census 2020
  const NHD_COPY = "https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Detailed_Water_Bodies/FeatureServer/0/query";
  const LIBS = {
    shp: "https://cdnjs.cloudflare.com/ajax/libs/shpjs/4.0.4/shp.min.js",
    kml: "https://cdn.jsdelivr.net/npm/@tmcw/togeojson@5.8.1/dist/togeojson.umd.js",
    zip: "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
  };
  const SAMPLES = 20000, MAX_SAMPLES = 70000, MAX_VERTS = 600;
  // large areas are read in tiles: above BIG_KM2 (below it one request, as for a field), TILE_KM on a side, a few at a time
  const BIG_KM2 = 500, TILE_KM = 20, TILES_AT_ONCE = 3, MAX_SPLIT = 2, SOIL_CHUNK = 300, REDUCE_KM2 = 1500;
  // most features kept in memory per layer for a large area; most map pieces drawn
  const BUDGET = { buildings: 150000, roads: 120000, water: 60000 }, MAX_DRAW = 15000, MAX_DRAW_EX = 30000;
  // half-widths in metres by TIGER road class (MTFCC): pavement plus shoulders
  const ROAD_HALF = { S1100: 15, S1200: 9, S1400: 5, S1500: 2, S1630: 6, S1640: 4, S1730: 3, S1740: 3, S1750: 3, S1780: 4,
    S1710: 1.5, S1720: 1.5, S1820: 1.5, S1830: 1.5 };
  // NHD water-body types left out: lake/pond, reservoir, swamp/marsh, estuary (playas, 361, stay in: most are farmed)
  const WATER_FTYPE = new Set([390, 436, 466, 493, "Lake/Pond", "Reservoir", "Swamp/Marsh", "Estuary"]);
  const WEG_ORDER = ["1", "2", "3", "4", "4L", "5", "6", "7", "8"];
  const WEG_COLOR = Object.fromEntries(WEG_ORDER.map((k, i) => [k, META.weg.legend[i].color]));
  const UN = WG.units;
  // classes defined in t/ac/yr (units.js, shared with the risk card); labels follow the soil-loss unit of the units table
  const EDGES = UN.Q.soilLoss.edges;
  const RISK = ["Low", "Moderate", "High", "Very high", "Extreme"].map((name, i) => ({ name, color: META.susceptibility.legend[i].color,
    get range() { const e = EDGES.map(v => UN.edge("soilLoss", v)); return [`< ${e[0]}`, `${e[0]}–${e[1]}`, `${e[1]}–${e[2]}`, `${e[2]}–${e[3]}`, `≥ ${e[3]}`][i]; } }));
  const riskClass = E => UN.cls("soilLoss", E); // the exact E, in every unit
  const AC = 4046.8564; // m² per acre: areas are kept in acres here and shown in the units table's area unit
  // km² and mi² by size; ha and ac to d decimals, with two significant figures at least so a small field is not "0 ha"
  const areaTxt = (acres, d) => {
    const x = UN.conv("area", acres * AC), big = ["km²", "mi²"].includes(UN.sym("area"));
    return UN.fmt("area", acres * AC, !(x > 0) ? d : big ? (x >= 100 ? 0 : x >= 10 ? 1 : x >= 0.1 ? 2 : 3) : Math.max(d, x >= 10 ? 0 : x >= 1 ? 1 : x >= 0.1 ? 2 : 3));
  };
  const iTxt = I => String(I).replace(/\d+/g, v => UN.num("soilLoss", +v, 0)); // WEG index I (t/ac/yr, may be a range) in the chosen unit

  /* ---------------- geometry ---------------- */
  const R = 6378137, rad = Math.PI / 180;
  function ringArea(r) { // m², spherical excess (as geojson-area); sign follows orientation
    let a = 0;
    for (let i = 0; i < r.length - 1; i++) a += (r[i + 1][0] - r[i][0]) * rad * (2 + Math.sin(r[i][1] * rad) + Math.sin(r[i + 1][1] * rad));
    return (a * R * R) / 2;
  }
  const polysArea = polys => polys.reduce((s, p) => s + Math.abs(ringArea(p[0])) - p.slice(1).reduce((h, r) => h + Math.abs(ringArea(r)), 0), 0);
  const bboxOf = rings => {
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    rings.forEach(r => r.forEach(([x, y]) => { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }));
    return [w, s, e, n];
  };
  function inRings(x, y, rings) { // even-odd over every ring: works for holes and multipolygons
    let inside = false;
    for (const r of rings) {
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const [xi, yi] = r[i], [xj, yj] = r[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
    }
    return inside;
  }
  function segDist2(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
    const qx = ax + t * dx - px, qy = ay + t * dy - py;
    return qx * qx + qy * qy;
  }
  function simplify(ring, tol) { // Douglas–Peucker, degrees
    if (ring.length < 5) return ring;
    const keep = new Uint8Array(ring.length);
    keep[0] = keep[ring.length - 1] = 1;
    const stack = [[0, ring.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop();
      let best = -1, at = -1;
      for (let i = a + 1; i < b; i++) {
        const d = segDist2(ring[i][0], ring[i][1], ring[a][0], ring[a][1], ring[b][0], ring[b][1]);
        if (d > best) { best = d; at = i; }
      }
      if (best > tol * tol) { keep[at] = 1; stack.push([a, at], [at, b]); }
    }
    const out = ring.filter((_, i) => keep[i]);
    return out.length >= 4 ? out : ring;
  }
  function toWKT(polys, maxVerts = MAX_VERTS) {
    let tol = 0, p = polys;
    const count = q => q.reduce((s, x) => s + x.reduce((t, r) => t + r.length, 0), 0);
    while (count(p) > maxVerts && tol < 0.01) { tol = tol ? tol * 2 : 0.00002; p = polys.map(x => x.map(r => simplify(r, tol))); }
    const ring = r => `(${r.map(([x, y]) => `${x.toFixed(6)} ${y.toFixed(6)}`).join(", ")})`;
    return `MULTIPOLYGON(${p.map(x => `(${x.map(ring).join(", ")})`).join(", ")})`;
  }
  const wktRings = wkt => [...String(wkt).matchAll(/\(([^()]+)\)/g)]
    .map(m => m[1].split(",").map(s => s.trim().split(/\s+/).map(Number)))
    .filter(r => r.length >= 4 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]);

  /* Polygons from GeoJSON (Feature, FeatureCollection, geometry, or an array of collections from shpjs). */
  function geojsonPolys(g, out = []) {
    if (!g) return out;
    if (Array.isArray(g)) g.forEach(x => geojsonPolys(x, out));
    else if (g.type === "FeatureCollection") g.features.forEach(f => geojsonPolys(f, out));
    else if (g.type === "Feature") geojsonPolys(g.geometry, out);
    else if (g.type === "GeometryCollection") g.geometries.forEach(x => geojsonPolys(x, out));
    else if (g.type === "Polygon") out.push(g.coordinates.map(r => r.map(c => [c[0], c[1]])));
    else if (g.type === "MultiPolygon") g.coordinates.forEach(p => out.push(p.map(r => r.map(c => [c[0], c[1]]))));
    return out;
  }

  /* ---------------- tiles ---------------- */
  // a ring clipped to a box (Sutherland-Hodgman); [] when nothing is left. A concave ring may keep zero-width bridges along
  // the box edge; SQL Server's MakeValid() removes them.
  function clipRing(r, box) {
    let p = r.slice(0, -1);
    for (const [ax, v, side] of [[0, box[0], 1], [0, box[2], -1], [1, box[1], 1], [1, box[3], -1]]) { // axis, edge value, kept side
      const out = [];
      for (let i = 0; i < p.length; i++) {
        const a = p[i], b = p[(i + 1) % p.length], ina = (a[ax] - v) * side >= 0, inb = (b[ax] - v) * side >= 0;
        if (ina !== inb) { const t = (v - a[ax]) / (b[ax] - a[ax]), q = [0, 0]; q[ax] = v; q[1 - ax] = a[1 - ax] + t * (b[1 - ax] - a[1 - ax]); out.push(q); }
        if (inb) out.push(b);
      }
      p = out;
      if (p.length < 3) return [];
    }
    return [...p, p[0]];
  }
  const clipPolys = (polys, box) => polys.map(pl => { const o = clipRing(pl[0], box); return o.length ? [o, ...pl.slice(1).map(h => clipRing(h, box)).filter(h => h.length)] : null; }).filter(Boolean);
  function tileBoxes(bb, edgeKm) { // boxes of about edgeKm on a side over the bounding box
    const dx = edgeKm / (111.32 * Math.cos(((bb[1] + bb[3]) / 2) * rad)), dy = edgeKm / 110.54;
    const nx = Math.max(1, Math.ceil((bb[2] - bb[0]) / dx)), ny = Math.max(1, Math.ceil((bb[3] - bb[1]) / dy));
    const tw = (bb[2] - bb[0]) / nx, th = (bb[3] - bb[1]) / ny, out = [];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) out.push([bb[0] + i * tw, bb[1] + j * th, bb[0] + (i + 1) * tw, bb[1] + (j + 1) * th]);
    return out;
  }
  const splitBox = ([w, s, e, n]) => { const x = (w + e) / 2, y = (s + n) / 2; return [[w, s, x, y], [x, s, e, y], [w, y, x, n], [x, y, e, n]]; };
  const inBoxes = (lon, lat, boxes) => boxes.some(b => lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3]);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const tick = () => new Promise(r => setTimeout(r, 0)); // lets the page draw and answer Cancel
  const STOP = new Error("stopped");

  /* Run fn on a box; a failure is tried once more, then the box is split in four (to maxDepth levels). A box that still
     fails goes to fail(box, error) and adds nothing. Throws STOP when the run was cancelled. */
  async function attempt(run, box, fn, fail, maxDepth, depth = 0) {
    let err;
    for (let a = 0; a < 2; a++) {
      if (run.stop) throw STOP;
      try { return await fn(box); } catch (e) { if (run.stop) throw STOP; err = e; if (!a) await wait(700); }
    }
    if (depth < maxDepth) {
      const out = [];
      for (const b of splitBox(box)) if (run.keep(b)) out.push(...await attempt(run, b, fn, fail, maxDepth, depth + 1));
      return out;
    }
    fail(box, err);
    return [];
  }

  /* ---------------- data ---------------- */
  async function sda(query, sig, ms = 60000) {
    const j = await fetchJSON(SDA, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, format: "JSON+COLUMNNAME" }), signal: sig }, ms);
    const t = j.Table || [];
    return t.length ? t.slice(1).map(r => Object.fromEntries(t[0].map((c, i) => [c, r[i]]))) : [];
  }

  /* The soil polygons clipped to the boundary (or to one tile of it); tol (degrees) thins the returned outlines. */
  async function soilRows(polys, sig, { tol = 0, maxVerts = MAX_VERTS, ms = 60000 } = {}) {
    const aoi = `geometry::STGeomFromText('${toWKT(polys, maxVerts)}', 4326).MakeValid()`;
    // (SDA refuses DECLARE, so the boundary text is repeated)
    const rows = await sda(`SELECT P.mukey, P.mupolygongeo.STIntersection(${aoi})${tol ? `.Reduce(${tol})` : ""}.STAsText() AS wkt
      FROM mupolygon P WHERE P.mupolygongeo.STIntersects(${aoi}) = 1`, sig, ms);
    return rows.map(r => ({ mukey: r.mukey, rings: wktRings(r.wkt) })).filter(p => p.rings.length);
  }

  /* The map units' components and climate factors, a few hundred map keys per query, two queries at a time. */
  async function soilUnits(parts, sig, step) {
    const keys = [...new Set(parts.map(r => r.mukey))];
    if (!keys.length) return {};
    const chunks = [];
    for (let i = 0; i < keys.length; i += SOIL_CHUNK) chunks.push(keys.slice(i, i + SOIL_CHUNK).map(k => +k).join(","));
    const tasks = chunks.flatMap(inList => [{ c: 1, inList }, { c: 0, inList }]);
    let done = 0;
    const out = await WG.util.pool(tasks, 2, async t => {
      const q = t.c
        ? `SELECT mu.mukey, mu.musym, mu.muname, l.areasymbol AS survey, c.compname, c.comppct_r, c.weg, c.wei FROM mapunit mu
           JOIN legend l ON l.lkey = mu.lkey LEFT JOIN component c ON c.mukey = mu.mukey WHERE mu.mukey IN (${t.inList})`
        : `SELECT mo.mukey, la.areasymbol, la.areatypename, mo.areaovacres FROM muaoverlap mo JOIN laoverlap la ON la.lareaovkey = mo.lareaovkey
           WHERE mo.mukey IN (${t.inList}) AND (la.areatypename LIKE 'Climate Factor%' OR la.areatypename = 'County or Parish')
           ORDER BY mo.areaovacres DESC`;
      let r;
      try { r = await sda(q, sig); } catch (e) { if (sig && sig.aborted) throw e; await wait(700); r = await sda(q, sig); }
      if (step) step(++done, tasks.length);
      return r;
    });
    const comps = out.filter((_, i) => tasks[i].c).flat(), cf = out.filter((_, i) => !tasks[i].c).flat();
    const units = {};
    comps.forEach(c => {
      const u = units[c.mukey] || (units[c.mukey] = { mukey: c.mukey, musym: c.musym, muname: c.muname, survey: c.survey, comps: [], C: null, counties: [], cfs: [] });
      if (c.compname) u.comps.push({ name: c.compname, pct: +c.comppct_r || 0, weg: c.weg || null, wei: c.wei === null ? null : +c.wei });
    });
    cf.forEach(r => { // most acres first
      const u = units[r.mukey];
      if (!u) return;
      if (/^county/i.test(r.areatypename || "")) u.counties.push(r.areasymbol);
      else if (+r.areasymbol > 0) u.cfs.push({ c: +r.areasymbol, w: +r.areaovacres || 0 }); // 0 is not a rating
    });
    // the map unit's own NRCS C, acre-weighted as at a point (js/soil.js); the county rule is applied per point below
    Object.values(units).forEach(u => {
      const w = u.cfs.reduce((s, x) => s + x.w, 0);
      u.C = !u.cfs.length ? null : w ? u.cfs.reduce((s, x) => s + x.c * x.w, 0) / w : u.cfs.reduce((s, x) => s + x.c, 0) / u.cfs.length;
    });
    Object.values(units).forEach(u => {
      u.water = /^water\b/i.test(u.muname || "") || (u.comps.length && u.comps.every(c => /^water$/i.test(c.name)));
      u.comps.sort((a, b) => b.pct - a.pct);
      const top = u.comps.find(c => c.weg);
      u.weg = top ? top.weg : null;
    });
    return units;
  }

  async function soils(polys) { // a field or small area: one request
    const parts = await soilRows(polys);
    return { parts, units: await soilUnits(parts) };
  }

  /* A large area, tile by tile: soil outlines clipped to each tile, a few tiles at a time. */
  async function soilsTiled(run, boxes, polys, tol, step) {
    const parts = [], gaps = [];
    let done = 0, dead = 0;
    await WG.util.pool(boxes, TILES_AT_ONCE, async box => {
      if (dead >= 4) { gaps.push(box); step(++done, boxes.length); return; } // the service is down: do not keep asking
      let failed = false;
      const rows = await attempt(run, box, async b => {
        const clipped = clipPolys(polys, b);
        return clipped.length ? soilRows(clipped, run.ctrl.signal, { tol, maxVerts: 2000, ms: 90000 }) : [];
      }, (b, e) => { failed = true; gaps.push(b); run.err.soil = e; }, MAX_SPLIT);
      dead = failed ? dead + 1 : 0;
      for (const r of rows) parts.push(r);
      step(++done, boxes.length);
    });
    return { parts, gaps };
  }

  /* ArcGIS feature query as GeoJSON over an envelope; headerMs: wait for the first answer. When the server caps a
     reply, later pages are asked for by offset (a server without paging just keeps the first page). */
  async function arcgis(url, env, fields, { pages = 10, headerMs = 15000, extra = {}, sig } = {}) {
    const base = { geometry: env.join(","), geometryType: "esriGeometryEnvelope", inSR: "4326",
      spatialRel: "esriSpatialRelIntersects", outFields: fields, returnGeometry: "true", outSR: "4326", f: "geojson", ...extra };
    const more = j => j.exceededTransferLimit || (j.properties && j.properties.exceededTransferLimit);
    let j = await fetchJSON(`${url}?${new URLSearchParams(base)}`, { signal: sig }, 45000, headerMs);
    if (j.error) throw new Error(j.error.message || "query failed");
    const out = [...(j.features || [])]; // out.truncated: not every feature was read
    let k = 1;
    for (; k < pages && more(j) && j.features && j.features.length; k++) {
      try {
        j = await fetchJSON(`${url}?${new URLSearchParams({ ...base, resultOffset: String(out.length) })}`, { signal: sig }, 45000, headerMs);
      } catch (e) { if (sig && sig.aborted) throw e; out.truncated = true; break; }
      if (j.error) { out.truncated = true; break; }
      for (const f of j.features || []) out.push(f);
    }
    if (k >= pages && more(j)) out.truncated = true; // the page limit was reached with more to read
    return out;
  }

  /* The Census 2020 counties over the area, as SSURGO county symbols ("KS055"), so each soil polygon takes the county
     it lies in (a map unit of a multi-county survey lists several); [] if TIGERweb does not answer. */
  async function countiesOver(env) {
    try {
      // outlines generalized to about 30 m (maxAllowableOffset, degrees), plenty for telling counties apart
      const f = await arcgis(COUNTIES, env, "STATE,COUNTY", { pages: 2, headerMs: 8000, extra: { maxAllowableOffset: "0.0003" } });
      return f.flatMap(x => { const sym = WG.soil.symOf((x.properties || {}).STATE, (x.properties || {}).COUNTY);
        return sym ? geojsonPolys(x.geometry).map(rings => ({ sym, rings, bb: bboxOf(rings) })) : []; });
    } catch (e) { return []; }
  }

  async function exclusions(env, quick) {
    const opt = quick ? { pages: 1, headerMs: 3000 } : {};
    // water: USGS NHD, with Esri's NHD copy asked at the same time because NHD can take several seconds to wake up.
    // A click check takes whichever answers first; an area analysis waits up to 5 s for NHD before using the copy.
    const nhd = arcgis(NHD, env, "FTYPE,GNIS_NAME", { ...opt, headerMs: quick ? 3000 : 5000 }).then(f => ({ ok: true, f, src: "USGS NHD" }));
    const copy = arcgis(NHD_COPY, env, "FTYPE,NAME", opt).then(f => ({ ok: true, f, src: "Esri copy of NHD" }));
    nhd.catch(() => {});
    copy.catch(() => {}); // the request not used may still fail later
    const [bld, roads, water] = await Promise.all([
      arcgis(STRUCT, env, "OCC_CLS", opt).then(f => ({ ok: true, f })).catch(e => ({ ok: false, f: [], e })),
      Promise.all(TIGER_LAYERS.map(l => arcgis(TIGER + l + "/query", env, "MTFCC,NAME", opt)))
        .then(a => ({ ok: true, f: a.flat() })).catch(e => ({ ok: false, f: [], e })),
      (quick ? Promise.any([nhd, copy]) : nhd.catch(() => copy)).catch(e => ({ ok: false, f: [], e })),
    ]);
    const polyFeats = fs => fs.flatMap(f => geojsonPolys(f.geometry).map(p => ({ rings: p, props: f.properties || {} })));
    const lines = f => {
      const g = f.geometry || {};
      return g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : [];
    };
    return {
      buildings: polyFeats(bld.f), roads: roads.f.flatMap(f => lines(f).map(c => ({ line: c, props: f.properties || {} }))),
      water: polyFeats(water.f.filter(f => WATER_FTYPE.has((f.properties || {}).FTYPE ?? (f.properties || {}).ftype))),
      status: { buildings: bld.ok, roads: roads.ok, water: water.ok, waterSrc: water.src },
    };
  }

  /* A large area: buildings, roads and water read tile by tile. Each layer has a budget of features (memory); once it is
     used up, or a service keeps failing, that layer is not read for the rest of the tiles and those tiles are listed in
     gaps[layer], so the panel can say for which share of the area the layer was checked. */
  async function exclusionsTiled(run, boxes, step) {
    const layers = ["buildings", "roads", "water"], pad = 0.0003, sig = run.ctrl.signal;
    const out = { buildings: [], roads: [], water: [] }, gaps = { buildings: [], roads: [], water: [] }, dead = { buildings: 0, roads: 0, water: 0 };
    const srcs = new Set(), opt = { pages: 25, headerMs: 20000, sig, extra: { geometryPrecision: "6" } };
    const polyFeats = (fs, keep) => fs.flatMap(f => geojsonPolys(f.geometry).map(p => ({ rings: p, props: keep ? f.properties || {} : {} })));
    const lines = f => { const g = f.geometry || {}; return g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : []; };
    const read = {
      buildings: async env => { const f = await arcgis(STRUCT, env, "OCC_CLS", opt), r = polyFeats(f); r.cut = f.truncated; return r; },
      roads: async env => {
        const a = await Promise.all(TIGER_LAYERS.map(l => arcgis(TIGER + l + "/query", env, "MTFCC,NAME", opt)));
        const r = a.flat().flatMap(f => lines(f).map(c => ({ line: c, props: f.properties || {} })));
        r.cut = a.some(x => x.truncated);
        return r;
      },
      water: async env => {
        let f;
        try { f = await arcgis(NHD, env, "FTYPE,GNIS_NAME", { ...opt, headerMs: 8000 }); srcs.add("USGS NHD"); } catch (e) {
          if (run.stop) throw e;
          f = await arcgis(NHD_COPY, env, "FTYPE,NAME", opt);
          srcs.add("Esri copy of NHD");
        }
        const r = polyFeats(f.filter(x => WATER_FTYPE.has((x.properties || {}).FTYPE ?? (x.properties || {}).ftype)), true);
        r.cut = f.truncated;
        return r;
      },
    };
    let done = 0;
    await WG.util.pool(boxes, 2, async box => {
      await Promise.all(layers.map(async L => {
        if (out[L].length >= BUDGET[L] || dead[L] >= 4) { gaps[L].push(box); return; }
        let failed = false;
        const items = await attempt(run, box, async b => {
          const r = await read[L]([b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad]);
          if (r.cut) gaps[L].push(b); // the service cut the answer short: this tile is only partly checked
          return r;
        }, (b, e) => { failed = true; gaps[L].push(b); run.err[L] = e; }, 1);
        dead[L] = failed ? dead[L] + 1 : 0;
        for (const x of items) out[L].push(x);
      }));
      step(++done, boxes.length, out.buildings.length);
    });
    const ok = k => !gaps[k].length;
    return { ...out, gaps, status: { buildings: ok("buildings"), roads: ok("roads"), water: ok("water"), waterSrc: [...srcs].join(" and ") || "USGS NHD" } };
  }

  /* Local metric frame and a uniform grid index over features. */
  function frame(bb) {
    const lat0 = (bb[1] + bb[3]) / 2, kx = Math.cos(lat0 * rad) * 111320, ky = 110540;
    return { x: lon => (lon - bb[0]) * kx, y: lat => (lat - bb[1]) * ky, W: (bb[2] - bb[0]) * kx, H: (bb[3] - bb[1]) * ky };
  }
  function grid(fr, n = 64) {
    const cells = Array.from({ length: n * n }, () => []);
    const cw = Math.max(fr.W, 1) / n, ch = Math.max(fr.H, 1) / n;
    const clampI = (v, m) => Math.max(0, Math.min(n - 1, Math.floor(v / m)));
    return {
      add(item, x0, y0, x1, y1) {
        for (let i = clampI(x0, cw); i <= clampI(x1, cw); i++) for (let j = clampI(y0, ch); j <= clampI(y1, ch); j++) cells[j * n + i].push(item);
      },
      at: (x, y) => cells[clampI(y, ch) * n + clampI(x, cw)],
    };
  }
  function indexPolys(list, fr, g, kind) {
    list.forEach(p => {
      const bb = bboxOf(p.rings);
      g.add({ kind, p }, fr.x(bb[0]), fr.y(bb[1]), fr.x(bb[2]), fr.y(bb[3]));
    });
  }
  function indexRoads(list, fr, g) {
    list.forEach(r => {
      const half = ROAD_HALF[r.props.MTFCC] || 4;
      const pts = r.line.map(([x, y]) => [fr.x(x), fr.y(y)]);
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
        g.add({ kind: "road", seg: [ax, ay, bx, by], half, props: r.props },
          Math.min(ax, bx) - half, Math.min(ay, by) - half, Math.max(ax, bx) + half, Math.max(ay, by) + half);
      }
    });
  }
  /* What, if anything, covers a point: building, road or water (first match wins). */
  function hitAt(lon, lat, fr, g) {
    const x = fr.x(lon), y = fr.y(lat);
    for (const it of g.at(x, y)) {
      if (it.kind === "road") {
        const [ax, ay, bx, by] = it.seg;
        if (segDist2(x, y, ax, ay, bx, by) <= it.half * it.half) return it;
      } else if (inRings(lon, lat, it.p.rings)) return it;
    }
    return null;
  }

  /* Point check used by app.js before a clicked point is analysed; null when clear or when the services are slow. */
  async function excludedAt(lat, lon) {
    const d = 0.0008; // ~90 m box: wide enough to catch the edges of large buildings
    const env = [lon - d, lat - d, lon + d, lat + d];
    const timer = new Promise(r => setTimeout(() => r(null), 3500));
    const check = exclusions(env, true).then(ex => {
      const fr = frame(env), g = grid(fr, 8);
      indexPolys(ex.buildings, fr, g, "building");
      indexPolys(ex.water, fr, g, "water");
      indexRoads(ex.roads, fr, g);
      const hit = hitAt(lon, lat, fr, g);
      if (!hit) return null;
      if (hit.kind === "road") {
        const nm = (hit.props.NAME || "").trim();
        return { kind: "road", label: `on a road${nm ? ` (${nm})` : ""}`, src: "Census TIGER" };
      }
      if (hit.kind === "water") {
        const nm = ((hit.p.props.GNIS_NAME || hit.p.props.NAME || "") + "").trim();
        return { kind: "water", label: `in water${nm ? ` (${nm})` : ""}`, src: ex.status.waterSrc };
      }
      return { kind: "building", label: "on a building", src: "USA Structures" };
    }).catch(() => null);
    return Promise.race([check, timer]);
  }

  /* Stratified random sample points over the bounding box, kept inside the boundary (seeded: same area, same answer). */
  async function samples(bb, ringsAll, acres, n, onRow) {
    let s = 1234567;
    const rnd = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const fr = frame(bb), boxArea = fr.W * fr.H, aoiArea = acres * 4046.86;
    const cells = Math.min(250000, Math.max(400, Math.round(n * boxArea / Math.max(aoiArea, 1))));
    const nx = Math.max(1, Math.round(Math.sqrt(cells * fr.W / Math.max(fr.H, 1)))), ny = Math.max(1, Math.round(cells / nx));
    const pts = [];
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const lon = bb[0] + ((i + rnd()) / nx) * (bb[2] - bb[0]), lat = bb[1] + ((j + rnd()) / ny) * (bb[3] - bb[1]);
        if (inRings(lon, lat, ringsAll)) pts.push([lon, lat]);
      }
      if (onRow && j % 25 === 24) await onRow(j / ny);
    }
    return pts;
  }

  /* ---------------- analysis ---------------- */
  let current = null, seq = 0, run = null;
  const layer = L.layerGroup().addTo(map);
  const km2Of = acres => acres / 247.105;
  const clock = ms => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
  const mins = s => (s < 45 ? "less than a minute" : s < 90 ? "a minute or two" : `up to about ${Math.round(s / 60)} minutes`);

  /* Progress panel for a large area: the step, a percent, the time so far and Cancel (the grid sheet's look). */
  function progPaint(r) {
    if (r !== run) return;
    const set = (id, t) => { const el = $(id); if (el) el.textContent = t; };
    set("#aStep", r.step);
    set("#aText", r.detail);
    set("#aPct", `${Math.round(r.pct * 100)} % · ${clock(Date.now() - r.t0)}`);
    const bar = $("#aBar");
    if (bar) { bar.style.width = `${(r.pct * 100).toFixed(1)}%`; bar.parentNode.setAttribute("aria-valuenow", Math.round(r.pct * 100)); }
  }
  function prog(r, step, detail, pct) { r.step = step; r.detail = detail || ""; r.pct = Math.max(r.pct, Math.min(1, pct)); progPaint(r); }
  function progShow(r, caution) {
    $("#areaResults").innerHTML = `<div class="g-prog"><div class="g-prog-top"><b id="aStep"></b><span id="aText"></span><span class="g-prog-pct" id="aPct"></span></div>
      <div class="g-bar" role="progressbar" aria-label="Progress" aria-valuemin="0" aria-valuemax="100"><i id="aBar"></i></div>
      <div class="g-prog-foot"><span class="fine">${esc(caution)}</span><button class="btn small" id="aStop">Cancel</button></div></div>`;
    $("#aStop").onclick = cancel;
    r.timer = setInterval(() => progPaint(r), 1000);
    progPaint(r);
  }
  function endRun(r) { if (r) { r.stop = true; r.ctrl.abort(); clearInterval(r.timer); } }
  function cancel() { // stops at once: pending requests are aborted and a new analysis starts clean
    if (!run) return;
    endRun(run);
    run = null;
    seq++;
    if (current) delete current.result;
    drawLayers();
    $("#areaResults").innerHTML = `<p class="fine area-status">Stopped. Nothing was kept.</p>
      <div class="area-actions"><button class="btn" id="areaAgain">Read this area again</button><button class="btn ghost" id="areaClear">Clear area</button></div>`;
    $("#areaAgain").onclick = () => current && analyse(current.polys, current.name);
    $("#areaClear").onclick = clear;
  }

  async function analyse(polys, name) {
    const my = ++seq;
    endRun(run);
    const acres = polysArea(polys) / 4046.86;
    if (!(acres > 0)) return fail("The boundary has no area.");
    const ringsAll = polys.flat(), bb = bboxOf(ringsAll), km = km2Of(acres), big = km > BIG_KM2;
    current = { polys, name, acres, bb };
    drawLayers();
    const sheet = $("#areaSheet"), phone = innerWidth < 768; // keep the area clear of the panel
    map.fitBounds([[bb[1], bb[0]], [bb[3], bb[2]]], { maxZoom: 16,
      paddingTopLeft: [phone ? 24 : (sheet.hidden ? 0 : sheet.offsetWidth) + 30, 80],
      paddingBottomRight: [24, phone && !sheet.hidden ? Math.round(innerHeight * 0.55) + 20 : 30] }); // the phone panel grows to 55 %
    const excl = $("#areaExclude").checked;
    const r = run = { stop: false, ctrl: new AbortController(), t0: Date.now(), step: "", detail: "", pct: 0, timer: 0, err: {}, keep: () => true };
    const nPts = km <= BIG_KM2 ? SAMPLES : Math.round(Math.min(MAX_SAMPLES, SAMPLES + 6000 * Math.log2(km / BIG_KM2)));
    // the soil outlines are thinned when the area is large: the tolerance is a fraction of the spacing of the sample points
    const spacing = Math.sqrt(acres * 4046.86 / nPts), tol = km > REDUCE_KM2 ? +(spacing / 8 / 111320).toPrecision(2) : 0;
    let boxes = [];
    if (big) {
      boxes = tileBoxes(bb, TILE_KM);
      r.keep = b => clipPolys(polys, b).length > 0;
      boxes = boxes.filter(r.keep);
      // measured, 3 tiles at a time: 9 tiles in 7.5 s, 12 in 8-41 s, 49 in 28.5 s in farm country; this is the slow end
      const secs = boxes.length * (excl ? 3.5 : 1.5);
      progShow(r, `This area is ${fmt(km, 0)} km², so it is read in ${boxes.length} tiles, which usually takes ${mins(secs)}; longer near towns or when a server is slow. Please keep this page open.`);
      prog(r, "Starting", "", 0);
    } else status(`Reading the soil survey${excl ? ", building footprints, roads and water" : ""} for ${areaTxt(acres, 0)}…`);
    try {
      const pad = 0.0003, env = [bb[0] - pad, bb[1] - pad, bb[2] + pad, bb[3] + pad];
      let soil, ex, cty, soilGaps = [];
      if (!big) {
        [soil, ex, cty] = await Promise.all([soils(polys), excl ? exclusions(env, false) : null, countiesOver(env)]);
      } else {
        const P = excl ? [0, 0.45, 0.55, 0.93] : [0, 0.8, 0.95, 0.95], T = boxes.length;
        const t = await soilsTiled(r, boxes, polys, tol, (d, n) => prog(r, "Reading the soil survey", `tile ${d} of ${n}`, P[0] + (P[1] - P[0]) * d / n));
        if (my !== seq) return;
        soilGaps = t.gaps;
        prog(r, "Reading soil details", "", P[1]);
        const units = await soilUnits(t.parts, r.ctrl.signal, (d, n) => prog(r, "Reading soil details", `${d} of ${n} requests`, P[1] + (P[2] - P[1]) * d / n));
        soil = { parts: t.parts, units };
        if (my !== seq) return;
        if (excl) {
          const exp = exclusionsTiled(r, boxes, (d, n, nb) => prog(r, "Reading buildings, roads and water", `tile ${d} of ${n} · ${nb.toLocaleString()} buildings`, P[2] + (P[3] - P[2]) * d / n));
          [ex, cty] = await Promise.all([exp, countiesBig(r, env)]);
        } else cty = await countiesBig(r, env);
        if (my !== seq) return;
      }
      if (my !== seq) return;
      // the counties each soil polygon's box touches: a point takes the one holding it, tested only where there are
      // several (a map unit of a multi-county survey can cross a county line)
      soil.parts.forEach(p => { const b = bboxOf(p.rings); p.cands = cty.filter(c => c.bb[0] <= b[2] && c.bb[2] >= b[0] && c.bb[1] <= b[3] && c.bb[3] >= b[1]); });
      const countyOf = (part, lon, lat) => (part.cands.length === 1 ? part.cands[0].sym
        : (part.cands.find(c => lon >= c.bb[0] && lon <= c.bb[2] && lat >= c.bb[1] && lat <= c.bb[3] && inRings(lon, lat, c.rings)) || {}).sym || null);
      // sample points: a large boundary is thinned for the point test (a tenth of the point spacing)
      const sampRings = big ? ringsAll.map(rg => simplify(rg, spacing / 10 / 111320)) : ringsAll;
      const pts = await samples(bb, sampRings, acres, nPts, big ? async f => { prog(r, "Placing sample points", "", (excl ? 0.93 : 0.95) + 0.03 * f); await tick(); if (my !== seq) throw STOP; } : null);
      if (my !== seq) return;
      const fr = frame(env), gn = big ? Math.max(64, Math.min(256, Math.round(Math.sqrt(soil.parts.length / 2)))) : 64, gS = grid(fr, gn), gX = grid(fr, gn);
      soil.parts.forEach(p => { const b = bboxOf(p.rings); gS.add(p, fr.x(b[0]), fr.y(b[1]), fr.x(b[2]), fr.y(b[3])); });
      if (ex) { indexPolys(ex.buildings, fr, gX, "building"); indexPolys(ex.water, fr, gX, "water"); indexRoads(ex.roads, fr, gX); }
      const count = { outside: 0, building: 0, road: 0, water: 0, nodata: 0, valid: 0 };
      const weg = {}, risk = [0, 0, 0, 0, 0], mu = {};
      let sumI = 0, sumE = 0, wI = 0, wE = 0, notRated = 0, noC = 0, cLo = Infinity, cHi = -Infinity, cEst = false;
      const muC = {}, muCn = {}; // each map unit's C over its points, for the table, the file and the grid
      // the fallback where neither the map unit nor the county table has a C (the state's file not loaded)
      const cvals = Object.values(soil.units).filter(u => !u.water).map(u => u.C).filter(Boolean);
      const cMean = cvals.length ? cvals.reduce((a, b) => a + b, 0) / cvals.length : null;
      // points that fell in a tile a service gave no answer for (or, for a layer, stopped being read): per layer
      const gapN = { soil: 0, buildings: 0, roads: 0, water: 0 }, gapB = { soil: soilGaps, ...(ex ? ex.gaps || {} : {}) };
      for (let k = 0; k < pts.length; k++) {
        if (big && k % 6000 === 5999) { prog(r, "Sorting the sample points", `${k.toLocaleString()} of ${pts.length.toLocaleString()}`, (excl ? 0.96 : 0.98) + 0.04 * k / pts.length); await tick(); if (my !== seq) return; }
        const [lon, lat] = pts[k];
        if (!WG.region.inRegion(lat, lon)) { count.outside++; continue; }
        if (big) for (const g in gapB) if (gapB[g].length && inBoxes(lon, lat, gapB[g])) gapN[g]++;
        const hit = ex ? hitAt(lon, lat, fr, gX) : null;
        if (hit) { count[hit.kind]++; continue; }
        const x = fr.x(lon), y = fr.y(lat);
        const part = gS.at(x, y).find(p => inRings(lon, lat, p.rings));
        const u = part && soil.units[part.mukey];
        if (!u) { count.nodata++; continue; }
        if (u.water) { count.water++; continue; }
        count.valid++;
        mu[u.mukey] = (mu[u.mukey] || 0) + 1;
        const rated = u.comps.filter(c => c.weg);
        const tot = u.comps.reduce((a, c) => a + c.pct, 0) || 1;
        notRated += 1 - rated.reduce((a, c) => a + c.pct, 0) / tot;
        const tc = WG.region.tableC(u.C, WG.soil.pickCounty(u.counties, countyOf(part, lon, lat)), u.survey);
        const C = tc ? tc.C : cMean;
        if (C) { cLo = Math.min(cLo, C); cHi = Math.max(cHi, C); cEst = cEst || (tc && tc.kind === "est"); muC[u.mukey] = (muC[u.mukey] || 0) + C; muCn[u.mukey] = (muCn[u.mukey] || 0) + 1; }
        rated.forEach(c => {
          const w = c.pct / tot, I = c.wei ?? WG.soil.WEG_I[c.weg] ?? 0;
          weg[c.weg] = (weg[c.weg] || 0) + w;
          sumI += w * I; wI += w;
          if (C) { const E = (I * C) / 100; risk[riskClass(E)] += w; sumE += w * E; wE += w; } else noC += w;
        });
      }
      // every map unit's C as the panel uses it, for the grid (js/grid.js): its points' mean, else the rule at its first
      // polygon's county
      Object.values(soil.units).forEach(u => {
        if (muCn[u.mukey]) { u.cUsed = muC[u.mukey] / muCn[u.mukey]; return; }
        const p = soil.parts.find(q => String(q.mukey) === String(u.mukey));
        const tc = WG.region.tableC(u.C, WG.soil.pickCounty(u.counties, p && p.cands.length === 1 ? p.cands[0].sym : null), u.survey);
        u.cUsed = tc ? tc.C : null;
      });
      const N = pts.length;
      clearInterval(r.timer);
      current.result = { N, count, weg, risk, notRated, noC, meanI: wI ? sumI / wI : null, meanE: wE ? sumE / wE : null,
        cMean, cRange: cHi >= cLo ? [cLo, cHi] : null, cEst, // over the analysed points only
        mu: Object.entries(mu).map(([k, n]) => ({ ...soil.units[k], n })).sort((a, b) => b.n - a.n),
        status: ex ? ex.status : null, soil, ex,
        // for a large area: tiles read, the outline tolerance and the share of the points each source did not cover
        big: big ? { tiles: boxes.length, tolM: Math.round(tol * 111320), seconds: Math.round((Date.now() - r.t0) / 1000),
          missed: Object.fromEntries(Object.entries(gapN).map(([g, v]) => [g, N ? v / N : 0])), err: r.err } : null };
      run = null;
      drawLayers();
      render();
    } catch (e) {
      if (my !== seq || e === STOP) return;
      clearInterval(r.timer);
      run = null;
      console.warn("area analysis failed", e);
      const mem = e instanceof RangeError || /memory|allocation/i.test(e.message || "");
      status(mem ? "The browser ran out of memory for this area. Close other tabs and try again, or read the area in smaller parts."
        : `Could not finish the analysis: ${esc(e.message || String(e))}`);
    }
  }

  /* The counties over a large area, in one request with coarser outlines (about 50 m), tried twice. */
  async function countiesBig(r, env) {
    for (let a = 0; a < 2 && !r.stop; a++) {
      try {
        const f = await arcgis(COUNTIES, env, "STATE,COUNTY", { pages: 5, headerMs: 15000, sig: r.ctrl.signal, extra: { maxAllowableOffset: "0.0005" } });
        return f.flatMap(x => { const sym = WG.soil.symOf((x.properties || {}).STATE, (x.properties || {}).COUNTY);
          return sym ? geojsonPolys(x.geometry).map(rings => ({ sym, rings, bb: bboxOf(rings) })) : []; });
      } catch (e) { if (r.stop) break; await wait(700); }
    }
    return [];
  }

  /* ---------------- map layers ---------------- */
  let cvSoil = null, cvRefs = null; // canvas renderers, used when there are many polygons
  function drawLayers() {
    layer.clearLayers();
    if (!current) return;
    const r = current.result;
    if (r) r.drawNote = "";
    if (r && $("#areaSoils").checked) {
      const n = r.soil.parts.length, many = n > 1500;
      if (n > MAX_DRAW) r.drawNote = `The ${n.toLocaleString()} soil map-unit pieces are not drawn on the map (too many); the numbers below are complete.`;
      else {
        const rend = many ? { renderer: cvSoil || (cvSoil = L.canvas({ pane: "thematic" })) } : {};
        r.soil.parts.forEach(p => {
          const u = r.soil.units[p.mukey] || {};
          const color = u.water ? "#2563eb" : WEG_COLOR[u.weg] || "#9aa5b1";
          const pg = L.polygon(p.rings.map(rg => rg.map(([x, y]) => [y, x])), { pane: "thematic", color: "#ffffff", weight: many ? 0.4 : 0.8, fillColor: color,
            fillOpacity: 0.6, interactive: n <= 4000, ...rend });
          if (n <= 4000) pg.bindTooltip(`${esc(u.musym || "")} · ${esc(u.muname || "")}${u.weg ? ` · WEG ${esc(u.weg)}${WG.soil.wegInfo(u.weg) ? `, I ${iTxt(WG.soil.wegInfo(u.weg).I)} ${esc(UN.sym("soilLoss"))}` : ""}` : ""}`, { sticky: true });
          pg.addTo(layer);
        });
      }
    }
    if (r && r.ex) {
      const ll = rg => rg.map(([x, y]) => [y, x]), skipped = [];
      const rend = r.ex.buildings.length + r.ex.roads.length + r.ex.water.length > 1500 ? { renderer: cvRefs || (cvRefs = L.canvas({ pane: "refs" })) } : {};
      const ok = (name, list) => list.length <= MAX_DRAW_EX || (skipped.push(name), false);
      if (ok("water", r.ex.water)) r.ex.water.forEach(w => L.polygon(w.rings.map(ll), { pane: "refs", color: "#1d4ed8", weight: 1, fillColor: "#3b82f6", fillOpacity: 0.55, interactive: false, ...rend }).addTo(layer));
      if (ok("buildings", r.ex.buildings)) r.ex.buildings.forEach(b => L.polygon(b.rings.map(ll), { pane: "refs", color: "#111827", weight: 0.6, fillColor: "#111827", fillOpacity: 0.75, interactive: false, ...rend }).addTo(layer));
      if (ok("roads", r.ex.roads)) r.ex.roads.forEach(rd => L.polyline(ll(rd.line), { pane: "refs", color: "#374151", weight: 3, opacity: 0.8, interactive: false, ...rend }).addTo(layer));
      if (skipped.length) r.drawNote = `${r.drawNote ? r.drawNote + " " : ""}The ${skipped.join(", ")} are not drawn on the map (too many); they are still left out of the numbers.`;
    }
    L.polygon(current.polys.map(p => p.map(rg => rg.map(([x, y]) => [y, x]))), { pane: "refs", color: "#facc15", weight: 3,
      dashArray: "6 4", fill: false, interactive: false }).addTo(layer);
  }

  /* ---------------- results panel ---------------- */
  const pct = v => `${fmt(v * 100, v < 0.1 ? 1 : 0)} %`;
  function bars(rows) {
    return `<div class="abars">${rows.map(r => `<div class="abar"><span class="sw" style="background:${r.color}"></span>
      <span class="al">${r.label}</span><span class="track"><i style="width:${Math.min(100, r.share * 100).toFixed(1)}%;background:${r.color}"></i></span>
      <span class="av">${pct(r.share)}</span><span class="aa">${areaTxt(r.acres, r.acres * AC < 1e5 ? 1 : 0)}</span></div>`).join("")}</div>`;
  }
  function render() {
    const c = current, r = c.result, n = r.N || 1;
    const share = k => r.count[k] / n, validAc = c.acres * share("valid");
    const left = ["building", "road", "water"].filter(k => r.count[k]).map(k => `${{ building: "buildings", road: "roads", water: "water" }[k]} ${areaTxt(c.acres * share(k), 1)}`);
    const ratedAc = validAc * (1 - r.notRated / Math.max(r.count.valid, 1)); // open land in components with a WEG
    const wegTot = Object.values(r.weg).reduce((a, b) => a + b, 0) || 1;
    const wegRows = WEG_ORDER.filter(k => r.weg[k]).map(k => ({ label: `WEG ${k} <small>I ${iTxt(WG.soil.wegInfo(k).I)}</small>`, color: WEG_COLOR[k],
      share: r.weg[k] / wegTot, acres: ratedAc * (r.weg[k] / wegTot) }));
    const riskTot = r.risk.reduce((a, b) => a + b, 0);
    const riskRows = riskTot ? RISK.map((k, i) => ({ label: `${k.name} <small>${k.range}</small>`, color: k.color, share: r.risk[i] / riskTot,
      acres: ratedAc * (r.risk[i] / riskTot) })).filter(x => x.share > 0) : [];
    const meanE = r.meanE, meanK = meanE !== null ? riskClass(meanE) : 0; // shown with UN.fmtCls, so the number agrees with the class
    const fC = WG.fmtC || (v => fmt(v, 0));
    const cTxt = r.cRange ? (fC(r.cRange[0]) === fC(r.cRange[1]) ? `C = ${fC(r.cRange[0])}` : `C = ${fC(r.cRange[0])}–${fC(r.cRange[1])}`) + (r.cEst ? " (estimated where SSURGO gives the county no usable value)" : "") : "no climatic factor in SSURGO";
    const st = r.status;
    const bg = r.big, miss = k => (bg ? bg.missed[k] || 0 : 0); // the share of the area a source did not cover
    const part = (k, text, bad) => !st[k] && bg && miss(k) < 0.995 ? `${text} <b>(read for ${pct(1 - miss(k))} of the area only; the rest is not removed)</b>` : st[k] ? text : bad;
    const srcBits = [
      "soils: USDA-NRCS SSURGO (Soil Data Access)",
      st && part("buildings", "buildings: FEMA/ORNL USA Structures", "buildings: <b>service did not answer, not removed</b>"),
      st && part("roads", "roads: Census TIGER, widened by road class", "roads: <b>service did not answer, not removed</b>"),
      st && part("water", `water: ${st.waterSrc} and SSURGO Water map units`, "water: SSURGO Water map units only (NHD did not answer)"),
    ].filter(Boolean);
    const bigNote = !bg ? "" : `<p class="fine">Large area: read in ${bg.tiles} tiles of about ${TILE_KM} km in ${clock(bg.seconds * 1000)}${bg.tolM ? `; the soil outlines were thinned to about ${bg.tolM} m` : ""}.
      ${miss("soil") > 0.0005 ? `<b>${pct(miss("soil"))} of the area had no soil read (a service did not answer${bg.err.soil ? `: ${esc(bg.err.soil.message || "")}` : ""})</b>; it is counted as without soil data. ` : ""}${r.drawNote ? esc(r.drawNote) : ""}</p>`;
    $("#areaResults").innerHTML = `
      <div class="area-sum"><b>${esc(c.name)}</b><span>${areaTxt(c.acres, 0)}</span></div>
      <p class="fine">Analysed: <b>${areaTxt(validAc, 0)}</b> of open land${left.length ? `; left out ${left.join(", ")}` : ""}${r.count.outside ? `; ${areaTxt(c.acres * share("outside"), 0)} outside the chosen states` : ""}${r.count.nodata ? `; ${areaTxt(c.acres * share("nodata"), 1)} without soil data` : ""}.</p>
      ${meanE !== null ? `<div class="area-kpi"><div><small>Mean bare-soil potential</small><b>${UN.fmtCls("soilLoss", meanE, 0)}</b><span>${RISK[meanK].name} (${RISK[meanK].range})</span></div>
        <div><small>Mean erodibility I (${UN.range("soilLoss", 0, 310, 0)})</small><b>${UN.fmt("soilLoss", r.meanI, 0)}</b><span>${cTxt}</span></div></div>` : ""}
      <h4>Wind Erodibility Group (share of rated soil)</h4>
      <p class="fine">WEG 1 is the most erodible and 8 is not erodible; I is each group's erodibility index in ${UN.sym("soilLoss")} (${UN.range("soilLoss", 0, 310, 0)}). <button class="link" data-methods="m-scales">All nine groups →</button></p>
      ${wegRows.length ? bars(wegRows) : '<p class="fine">No rated soils in this area.</p>'}
      ${r.notRated > 0.005 * r.count.valid ? `<p class="fine">${pct(r.notRated / r.count.valid)} of the open land is in components without a WEG (rock outcrop, urban land, pits); it is not in the shares.</p>` : ""}
      <h4>Bare-soil erosion potential, E = I × C / 100</h4>${riskRows.length ? bars(riskRows) : '<p class="fine">No climatic factor C for these map units.</p>'}
      <h4>Soil map units</h4>
      <div class="mtable-wrap"><table class="mtable area-mu"><thead><tr><th>Symbol</th><th>Map unit</th><th>WEG</th><th>Share</th></tr></thead><tbody>
        ${r.mu.slice(0, 12).map(u => `<tr><td>${esc(u.musym || "")}</td><td>${esc(u.muname || "")}</td><td>${esc(u.weg || "—")}</td><td>${pct(u.n / Math.max(r.count.valid, 1))}</td></tr>`).join("")}
      </tbody></table></div>
      ${r.mu.length > 12 ? `<p class="fine">${r.mu.length - 12} smaller map units not listed (all are in the CSV).</p>` : ""}
      <p class="fine">Estimated from ${fmt(r.N, 0)} stratified random sample points; each map unit is split by its component percentages. Sources: ${srcBits.join("; ")}.</p>
      ${bigNote}${!bg && r.drawNote ? `<p class="fine">${esc(r.drawNote)}</p>` : ""}
      <div class="area-actions"><button class="btn primary" id="areaGrid">Make a grid of this area…</button><button class="btn" id="areaCsv">Download CSV</button><button class="btn ghost" id="areaClear">Clear area</button></div>`;
    $("#areaGrid").onclick = () => WG.grid.open(current);
    $("#areaCsv").onclick = csv;
    $("#areaClear").onclick = clear;
  }
  function status(html) { $("#areaResults").innerHTML = `<p class="fine area-status">${html}</p>`; }
  function fail(msg) { status(esc(msg)); toast(msg, 6000); }

  function csv() {
    const c = current, r = c.result, n = r.N || 1, validAc = c.acres * r.count.valid / n;
    const wegTot = Object.values(r.weg).reduce((a, b) => a + b, 0) || 1, riskTot = r.risk.reduce((a, b) => a + b, 0) || 1;
    const lines = [`# SoilGuard area analysis: ${c.name}`, `# total_acres,${c.acres.toFixed(1)}`, `# total_hectares,${(c.acres / 2.47105).toFixed(1)}`,
      `# analysed_acres,${validAc.toFixed(1)}`, `# analysed_hectares,${(validAc / 2.47105).toFixed(1)}`,
      ...["building", "road", "water", "outside", "nodata"].map(k => `# ${k}_acres,${(c.acres * r.count[k] / n).toFixed(2)}`),
      `# sample_points,${r.N}`, "", "category,class,share_pct",
      ...WEG_ORDER.filter(k => r.weg[k]).map(k => `WEG,${k},${(100 * r.weg[k] / wegTot).toFixed(2)}`),
      ...RISK.map((k, i) => `E class,${k.name} (${["< 10", "10–40", "40–80", "80–150", "≥ 150"][i]} t/ac/yr),${(100 * r.risk[i] / riskTot).toFixed(2)}`),
      "", "mukey,musym,muname,weg_dominant,climatic_factor_C_ssurgo,climatic_factor_C_used,share_of_analysed_pct",
      ...r.mu.map(u => [u.mukey, u.musym, `"${(u.muname || "").replace(/"/g, '""')}"`, u.weg || "", u.C ? +u.C.toFixed(1) : "",
        u.cUsed ? +u.cUsed.toFixed(1) : "", (100 * u.n / Math.max(r.count.valid, 1)).toFixed(2)].join(","))];
    download(`soilguard-area-${c.name.replace(/[^\w-]+/g, "_").slice(0, 40)}.csv`, lines.join("\n"), "text/csv");
  }

  function clear() {
    endRun(run); // a read still going stops too
    run = null;
    seq++;
    current = null;
    layer.clearLayers();
    $("#areaResults").innerHTML = "";
  }

  /* ---------------- drawing ---------------- */
  let drawing = false, verts = [], drawLayer = null, rubber = null;
  function startDraw() {
    drawing = true;
    verts = [];
    drawLayer = L.layerGroup().addTo(map);
    map.doubleClickZoom.disable();
    map.getContainer().classList.add("drawing");
    $("#areaSheet").hidden = true;
    $("#drawBar").hidden = false;
    updateDraw();
  }
  function endDraw() {
    drawing = false;
    verts = [];
    if (drawLayer) map.removeLayer(drawLayer);
    drawLayer = rubber = null;
    map.doubleClickZoom.enable();
    map.getContainer().classList.remove("drawing");
    $("#drawBar").hidden = true;
    $("#areaSheet").hidden = false;
  }
  function updateDraw() {
    drawLayer.clearLayers();
    rubber = null;
    if (verts.length) L.polyline(verts, { color: "#facc15", weight: 3 }).addTo(drawLayer);
    if (verts.length > 2) L.polygon(verts, { color: "#facc15", weight: 0, fillOpacity: 0.15, interactive: false }).addTo(drawLayer);
    verts.forEach((v, i) => L.circleMarker(v, { radius: i ? 4 : 6, color: "#111", weight: 1.5, fillColor: "#facc15", fillOpacity: 1 }).addTo(drawLayer));
    $("#drawMsg").textContent = verts.length < 3 ? `Tap the map to add corners (${verts.length} so far)` : `${verts.length} corners · tap the first corner or Finish`;
    $("#drawFinish").disabled = verts.length < 3;
    $("#drawUndo").disabled = !verts.length;
  }
  function finishDraw() {
    if (!drawing || verts.length < 3) return;
    const ring = verts.map(v => [v.lng, v.lat]);
    ring.push(ring[0]);
    endDraw();
    analyse([[ring]], "Drawn area");
  }
  map.on("click", e => {
    if (!drawing) return;
    if (verts.length > 2) {
      const p0 = map.latLngToContainerPoint(verts[0]), p = map.latLngToContainerPoint(e.latlng);
      if (p0.distanceTo(p) < 14) return finishDraw();
    }
    verts.push(e.latlng);
    updateDraw();
  });
  map.on("dblclick", () => { if (drawing) finishDraw(); });
  map.on("mousemove", e => {
    if (!drawing || !verts.length) return;
    if (rubber) rubber.setLatLngs([verts[verts.length - 1], e.latlng]);
    else rubber = L.polyline([verts[verts.length - 1], e.latlng], { color: "#facc15", weight: 2, dashArray: "4 4", interactive: false }).addTo(drawLayer);
  });

  /* ---------------- uploads ---------------- */
  const loaded = {};
  const loadScript = url => loaded[url] || (loaded[url] = new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = url; s.onload = res; s.onerror = () => rej(new Error("could not load " + url));
    document.head.appendChild(s);
  }));
  const readText = f => f.text();
  const readBuf = f => f.arrayBuffer();
  async function parseFiles(files) {
    const by = ext => files.find(f => f.name.toLowerCase().endsWith(ext));
    const name = files[0].name.replace(/\.[^.]+$/, "");
    if (by(".geojson") || by(".json")) return { gj: JSON.parse(await readText(by(".geojson") || by(".json"))), name };
    if (by(".kml")) {
      await loadScript(LIBS.kml);
      return { gj: toGeoJSON.kml(new DOMParser().parseFromString(await readText(by(".kml")), "text/xml")), name };
    }
    if (by(".kmz")) {
      await Promise.all([loadScript(LIBS.zip), loadScript(LIBS.kml)]);
      const z = await JSZip.loadAsync(await readBuf(by(".kmz")));
      const k = Object.values(z.files).find(f => /\.kml$/i.test(f.name));
      if (!k) throw new Error("the .kmz has no .kml inside");
      return { gj: toGeoJSON.kml(new DOMParser().parseFromString(await k.async("text"), "text/xml")), name };
    }
    if (by(".zip")) {
      await loadScript(LIBS.shp);
      return { gj: await shp(await readBuf(by(".zip"))), name };
    }
    if (by(".shp")) {
      await loadScript(LIBS.shp);
      const prj = by(".prj") ? await readText(by(".prj")) : undefined;
      const geoms = shp.parseShp(await readBuf(by(".shp")), prj);
      const gj = by(".dbf") ? shp.combine([geoms, shp.parseDbf(await readBuf(by(".dbf")))])
        : { type: "FeatureCollection", features: geoms.map(g => ({ type: "Feature", geometry: g, properties: {} })) };
      return { gj, name, noPrj: !prj };
    }
    throw new Error("use a .zip shapefile, .shp (+ .dbf, .prj), .kml, .kmz or .geojson file");
  }
  async function upload(fileList) {
    const files = [...fileList];
    if (!files.length) return;
    status("Reading the boundary file…");
    try {
      const { gj, name, noPrj } = await parseFiles(files);
      const polys = geojsonPolys(gj);
      if (!polys.length) throw new Error("no polygons found in the file (lines and points can't bound an area)");
      const bb = bboxOf(polys.flat());
      if (!bb.every(Number.isFinite) || Math.max(Math.abs(bb[0]), Math.abs(bb[2])) > 180 || Math.max(Math.abs(bb[1]), Math.abs(bb[3])) > 90) {
        throw new Error(noPrj ? "the coordinates are projected; add the .prj file (or upload the whole .zip)" : "the coordinates are not latitude/longitude");
      }
      analyse(polys, name);
    } catch (e) {
      fail(`Could not read the boundary: ${e.message || e}`);
    }
  }

  /* ---------------- wiring ---------------- */
  const show = on => { $("#areaSheet").hidden = !on; document.body.classList.toggle("area-open", on); };
  const open = () => show(true);
  $("#areaBtn").addEventListener("click", () => show($("#areaSheet").hidden));
  $("#areaClose").addEventListener("click", () => show(false));
  $("#areaDraw").addEventListener("click", startDraw);
  $("#areaUpload").addEventListener("click", () => $("#areaFile").click());
  $("#areaFile").addEventListener("change", e => { upload(e.target.files); e.target.value = ""; });
  $("#drawUndo").addEventListener("click", () => { verts.pop(); updateDraw(); });
  $("#drawFinish").addEventListener("click", finishDraw);
  $("#drawCancel").addEventListener("click", endDraw);
  $("#areaSoils").addEventListener("change", drawLayers);
  $("#areaExclude").addEventListener("change", () => { if (current) analyse(current.polys, current.name); });
  document.addEventListener("keydown", e => {
    if (!drawing) return;
    if (e.key === "Escape") endDraw();
    else if (e.key === "Enter") finishDraw();
  });

  // the units table changed: draw the results and the map's tooltips again in the new units
  const rerender = () => { if (current && current.result) { render(); drawLayers(); } };
  UN.on(rerender);
  return { excludedAt, drawing: () => drawing, open, analyse, rerender, sda, parseFiles, geojsonPolys, bboxOf, inRings, roadHalf: mtfcc => ROAD_HALF[mtfcc] || 4 };
})();
