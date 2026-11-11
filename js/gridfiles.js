/* Grids for an area: map projections, the lattice of cells (square, angled or hexagonal), painting polygons onto it, and
   the files: GeoTIFF, shapefile, GeoJSON. Nothing here depends on the page; js/grid.js brings the data and the sheet. */
WG.gridfiles = (function () {
  const rad = Math.PI / 180;

  /* ---------- projections ---------- */
  /* Coordinate systems from proj4 definitions, worked out here: transverse Mercator and UTM by the Krüger series (Karney
     2011), Albers equal area, Lambert conformal conic and Mercator (Snyder 1987), and longitude and latitude, on any
     ellipsoid, with a 3 or 7 parameter +towgs84 shift (position vector, as PROJ). fwd(lon, lat) takes WGS 84 degrees,
     NAD83 taken as the same (as EPSG:1188 does), to x, y in the system's unit; inv(x, y) goes back. */
  const ELLPS = { WGS84: { a: 6378137, rf: 298.257223563, esri: "WGS_1984" }, GRS80: { a: 6378137, rf: 298.257222101, esri: "GRS_1980" },
    WGS72: { a: 6378135, rf: 298.26, esri: "WGS_1972" }, clrk66: { a: 6378206.4, b: 6356583.8, esri: "Clarke_1866" }, clrk80: { a: 6378249.145, rf: 293.4663 },
    clrk80ign: { a: 6378249.2, rf: 293.4660212936269 }, intl: { a: 6378388, rf: 297, esri: "International_1924" }, bessel: { a: 6377397.155, rf: 299.1528128, esri: "Bessel_1841" },
    airy: { a: 6377563.396, rf: 299.3249646, esri: "Airy_1830" }, mod_airy: { a: 6377340.189, b: 6356034.446 }, krass: { a: 6378245, rf: 298.3, esri: "Krasovsky_1940" },
    aust_SA: { a: 6378160, rf: 298.25 }, GRS67: { a: 6378160, rf: 298.247167427 }, sphere: { a: 6370997, rf: 0 } };
  /* linear units: metres in one, ESRI's name, and how to say it */
  const UNITS = { m: [1, "Meter", "metres"], km: [1000, "Kilometer", "kilometres"], dm: [0.1, "Decimeter", "decimetres"], cm: [0.01, "Centimeter", "centimetres"],
    mm: [0.001, "Millimeter", "millimetres"], ft: [0.3048, "Foot", "feet"], "us-ft": [1200 / 3937, "Foot_US", "US survey feet"], yd: [0.9144, "Yard", "yards"],
    "us-yd": [3600 / 3937, "Yard_US", "US survey yards"], mi: [1609.344, "Statute_Mile", "miles"], "us-mi": [6336000 / 3937, "Mile_US", "US survey miles"], kmi: [1852, "Nautical_Mile", "nautical miles"] };
  /* an ellipsoid by its semi-major axis and inverse flattening (0 for a sphere) */
  const ell = (a, rf, esri) => { const f = rf ? 1 / rf : 0; return { a, rf, f, e2: f * (2 - f), e: Math.sqrt(f * (2 - f)), esri }; };
  const W84 = ell(6378137, 298.257223563, "WGS_1984");
  const dLon = (lon, lon0) => ((((lon - lon0) % 360) + 540) % 360) - 180;

  /* transverse Mercator by the Krüger series (Karney 2011), northings from the origin's latitude */
  function tmerc(E, lon0, lat0, k0, x0, y0) {
    const n = E.f / (2 - E.f), n2 = n * n, n3 = n2 * n, n4 = n3 * n, n5 = n4 * n, n6 = n5 * n;
    const R = ((k0 * E.a) / (1 + n)) * (1 + n2 / 4 + n4 / 64 + n6 / 256), e = (2 * Math.sqrt(n)) / (1 + n);
    const AL = [n / 2 - (2 * n2) / 3 + (5 * n3) / 16 + (41 * n4) / 180 - (127 * n5) / 288 + (7891 * n6) / 37800,
      (13 * n2) / 48 - (3 * n3) / 5 + (557 * n4) / 1440 + (281 * n5) / 630 - (1983433 * n6) / 1935360,
      (61 * n3) / 240 - (103 * n4) / 140 + (15061 * n5) / 26880 + (167603 * n6) / 181440,
      (49561 * n4) / 161280 - (179 * n5) / 168 + (6601661 * n6) / 7257600,
      (34729 * n5) / 80640 - (3418889 * n6) / 1995840,
      (212378941 * n6) / 319334400];
    const BE = [n / 2 - (2 * n2) / 3 + (37 * n3) / 96 - n4 / 360 - (81 * n5) / 512 + (96199 * n6) / 604800,
      n2 / 48 + n3 / 15 - (437 * n4) / 1440 + (46 * n5) / 105 - (1118711 * n6) / 3870720,
      (17 * n3) / 480 - (37 * n4) / 840 - (209 * n5) / 4480 + (5569 * n6) / 90720,
      (4397 * n4) / 161280 - (11 * n5) / 504 - (830251 * n6) / 7257600,
      (4583 * n5) / 161280 - (108847 * n6) / 3991680,
      (20648693 * n6) / 638668800];
    const raw = (dl, lat) => {
      const s = Math.sin(lat * rad), t = Math.sinh(Math.atanh(s) - e * Math.atanh(e * s));
      const xi0 = Math.atan2(t, Math.cos(dl * rad)), eta0 = Math.atanh(Math.sin(dl * rad) / Math.sqrt(1 + t * t));
      let xi = xi0, eta = eta0;
      AL.forEach((al, j) => { const k = 2 * (j + 1); xi += al * Math.sin(k * xi0) * Math.cosh(k * eta0); eta += al * Math.cos(k * xi0) * Math.sinh(k * eta0); });
      return [R * eta, R * xi];
    };
    const m0 = raw(0, lat0)[1];
    return {
      fwd(lon, lat) { const [x, y] = raw(dLon(lon, lon0), lat); return [x0 + x, y0 + y - m0]; },
      inv(x, y) {
        const xi = (y - y0 + m0) / R, eta = (x - x0) / R;
        let xi0 = xi, eta0 = eta;
        BE.forEach((b, j) => { const k = 2 * (j + 1); xi0 -= b * Math.sin(k * xi) * Math.cosh(k * eta); eta0 -= b * Math.cos(k * xi) * Math.sinh(k * eta); });
        // latitude from the conformal latitude chi, by iteration (Snyder 1987, Eq. 7-9)
        const chi = Math.asin(Math.sin(xi0) / Math.cosh(eta0)), tc = Math.tan(Math.PI / 4 + chi / 2);
        let phi = chi;
        for (let i = 0; i < 10; i++) { const s = Math.sin(phi); phi = 2 * Math.atan(tc * ((1 + e * s) / (1 - e * s)) ** (e / 2)) - Math.PI / 2; }
        return [lon0 + Math.atan2(Math.sinh(eta0), Math.cos(xi0)) / rad, phi / rad];
      } };
  }
  /* Albers equal area (Snyder 1987, Eqs. 3-12, 14-3 to 14-11, 14-18 to 14-21; one standard parallel when both are the same) */
  function aea(E, lat1, lat2, lat0, lon0, x0, y0) {
    const { a, e2, e } = E;
    const q = s => (e ? (1 - e2) * (s / (1 - e2 * s * s) - Math.log((1 - e * s) / (1 + e * s)) / (2 * e)) : 2 * s);
    const m = p => Math.cos(p) / Math.sqrt(1 - e2 * Math.sin(p) ** 2);
    const p1 = lat1 * rad, p2 = lat2 * rad, q1 = q(Math.sin(p1)), m1 = m(p1);
    const nn = Math.abs(p1 - p2) > 1e-10 ? (m1 * m1 - m(p2) ** 2) / (q(Math.sin(p2)) - q1) : Math.sin(p1), C = m1 * m1 + nn * q1;
    const rho = s => (a * Math.sqrt(C - nn * q(s))) / nn, r0 = rho(Math.sin(lat0 * rad));
    return {
      fwd(lon, lat) { const r = rho(Math.sin(lat * rad)), th = nn * dLon(lon, lon0) * rad; return [x0 + r * Math.sin(th), y0 + r0 - r * Math.cos(th)]; },
      inv(x, y) {
        const sg = nn < 0 ? -1 : 1, X = sg * (x - x0), Y = sg * (r0 - (y - y0)), r = Math.hypot(X, Y), th = Math.atan2(X, Y), qq = (C - ((r * nn) / a) ** 2) / nn;
        let p = Math.asin(Math.max(-1, Math.min(1, qq / 2)));
        if (e) for (let i = 0; i < 8; i++) { const s = Math.sin(p), w = 1 - e2 * s * s; p += ((w * w) / (2 * Math.cos(p))) * (qq / (1 - e2) - s / w + Math.log((1 - e * s) / (1 + e * s)) / (2 * e)); }
        return [lon0 + th / nn / rad, p / rad];
      } };
  }
  /* Lambert conformal conic, one or two standard parallels (Snyder 1987, Eqs. 15-1 to 15-11, 7-9) */
  function lcc(E, lat1, lat2, lat0, lon0, k0, x0, y0) {
    const { a, e2, e } = E;
    const ts = p => { const s = Math.sin(p); return Math.tan(Math.PI / 4 - p / 2) / ((1 - e * s) / (1 + e * s)) ** (e / 2); };
    const m = p => Math.cos(p) / Math.sqrt(1 - e2 * Math.sin(p) ** 2);
    const p1 = lat1 * rad, p2 = lat2 * rad;
    const nn = Math.abs(p1 - p2) > 1e-10 ? Math.log(m(p1) / m(p2)) / Math.log(ts(p1) / ts(p2)) : Math.sin(p1), F = (a * k0 * m(p1)) / (nn * ts(p1) ** nn);
    const rho = p => F * ts(p) ** nn, r0 = rho(lat0 * rad);
    return {
      fwd(lon, lat) { const r = rho(lat * rad), th = nn * dLon(lon, lon0) * rad; return [x0 + r * Math.sin(th), y0 + r0 - r * Math.cos(th)]; },
      inv(x, y) {
        const sg = nn < 0 ? -1 : 1, X = sg * (x - x0), Y = sg * (r0 - (y - y0)), t = ((sg * Math.hypot(X, Y)) / F) ** (1 / nn);
        let p = Math.PI / 2 - 2 * Math.atan(t);
        for (let i = 0; i < 15; i++) { const s = Math.sin(p); p = Math.PI / 2 - 2 * Math.atan(t * ((1 - e * s) / (1 + e * s)) ** (e / 2)); }
        return [lon0 + Math.atan2(X, Y) / nn / rad, p / rad];
      } };
  }
  /* Mercator (Snyder 1987, Eqs. 7-6, 7-7, 7-9) */
  function merc(E, lon0, k0, x0, y0) {
    const { e } = E, R = E.a * k0;
    return {
      fwd(lon, lat) { const s = Math.sin(lat * rad); return [x0 + R * dLon(lon, lon0) * rad, y0 + R * (Math.atanh(s) - e * Math.atanh(e * s))]; },
      inv(x, y) {
        const t = Math.exp(-(y - y0) / R);
        let p = Math.PI / 2 - 2 * Math.atan(t);
        for (let i = 0; i < 15; i++) { const s = Math.sin(p); p = Math.PI / 2 - 2 * Math.atan(t * ((1 - e * s) / (1 + e * s)) ** (e / 2)); }
        return [lon0 + (x - x0) / R / rad, p / rad];
      } };
  }
  /* geodetic to geocentric and back (height 0), and a +towgs84 shift to WGS 84 or, back, from it */
  const xyz = (E, lon, lat) => { const s = Math.sin(lat * rad), c = Math.cos(lat * rad), N = E.a / Math.sqrt(1 - E.e2 * s * s); return [N * c * Math.cos(lon * rad), N * c * Math.sin(lon * rad), N * (1 - E.e2) * s]; };
  function geod(E, [X, Y, Z]) {
    const p = Math.hypot(X, Y);
    let lat = Math.atan2(Z, p * (1 - E.e2));
    for (let i = 0; i < 8; i++) { const s = Math.sin(lat); lat = Math.atan2(Z + (E.e2 * E.a * s) / Math.sqrt(1 - E.e2 * s * s), p); }
    return [Math.atan2(Y, X) / rad, lat / rad];
  }
  function helmert([X, Y, Z], t, back) {
    const [dx, dy, dz] = t, [rx, ry, rz] = (t.length > 3 ? t.slice(3, 6) : [0, 0, 0]).map(v => (v * rad) / 3600), M = 1 + (t[6] || 0) / 1e6;
    if (!back) return [M * (X - rz * Y + ry * Z) + dx, M * (rz * X + Y - rx * Z) + dy, M * (-ry * X + rx * Y + Z) + dz];
    const x = (X - dx) / M, y = (Y - dy) / M, z = (Z - dz) / M;
    return [x + rz * y - ry * z, -rz * x + y + rx * z, ry * x - rx * y + z];
  }
  const wn = v => (Number.isInteger(v) ? v.toFixed(1) : String(v));

  /* A coordinate system from its proj4 definition: { proj4, desc, geo, digits, shift, fwd, inv, prj }, prj its ESRI
     WKT for a .prj, named esri. Throws, saying why, on what it cannot do. */
  function fromProj4(def, esri = "Custom") {
    const src = String(def || "").trim().replace(/\s+/g, " ");
    if (!src) throw new Error("paste a proj4 definition");
    if (/^[A-Z_]+\s*\[/i.test(src)) throw new Error("that is WKT: paste it in the .prj box, and the system's proj4 definition here");
    if (/^(epsg|esri)\s*:?\s*\d+$/i.test(src)) throw new Error("a code cannot be looked up here: paste its proj4 definition (epsg.io gives it as PROJ.4)");
    const p = {};
    src.split(" ").forEach(t => {
      const m = t.match(/^\+?([A-Za-z_][\w-]*)(?:=(\S+))?$/);
      if (!m) throw new Error(`“${t}” is not a proj4 parameter`);
      p[m[1]] = m[2] === undefined ? true : m[2];
    });
    const has = k => p[k] !== undefined;
    const val = (k, d) => {
      if (!has(k)) { if (d === undefined) throw new Error(`it needs +${k}`); return d; }
      const v = Number(p[k]);
      if (p[k] === true || !Number.isFinite(v)) throw new Error(`+${k} must be a number (degrees as decimals)`);
      return v;
    };
    if (has("datum") && !["WGS84", "NAD83"].includes(p.datum)) throw new Error(p.datum === "NAD27" ? "NAD27 needs a grid shift that cannot be done here: use a NAD83 system, or +ellps=clrk66 +towgs84=-8,160,176 in place of +datum=NAD27 (EPSG:1173, good to about 10 m)" : `+datum=${p.datum} is not known here: give its +ellps and +towgs84 instead`);
    if (has("nadgrids") && p.nadgrids !== "@null") throw new Error("a grid shift (+nadgrids) cannot be done here: give +towgs84 instead");
    if (has("pm") && !/^(greenwich|0)$/i.test(p.pm)) throw new Error("only the Greenwich prime meridian is supported");
    if (has("axis") && p.axis !== "enu") throw new Error("only east and north axes (+axis=enu) are supported");
    if (has("geoc")) throw new Error("geocentric latitudes (+geoc) are not supported");
    // the ellipsoid: a datum's, a named one, or given; GRS 1980 when none is, as PROJ
    const key = p.datum === "NAD83" ? "GRS80" : p.datum === "WGS84" ? "WGS84" : p.ellps;
    if (key !== undefined && !ELLPS[key]) throw new Error(`+ellps=${key} is not known here: give +a and +rf instead`);
    const named = ELLPS[key || "GRS80"], rfOf = q => (q.rf !== undefined ? q.rf : q.a / (q.a - q.b));
    let E;
    if (has("R")) E = ell(val("R"), 0, "Sphere");
    else if (has("a")) {
      const a = val("a"), rf = has("b") ? (val("b") === a ? 0 : a / (a - val("b"))) : has("rf") ? val("rf") : has("f") ? (val("f") ? 1 / val("f") : 0) : key ? rfOf(named) : 0;
      E = ell(a, rf, rf ? "Custom" : "Sphere");
    } else E = ell(named.a, rfOf(named), named.esri || key);
    let tw = null;
    if (has("towgs84")) {
      tw = String(p.towgs84).split(",").map(Number);
      if (![3, 7].includes(tw.length) || tw.some(v => !Number.isFinite(v))) throw new Error("+towgs84 takes 3 or 7 numbers");
      if (tw.every(v => v === 0)) tw = null;
    }
    const dat = tw ? null : p.datum || (key === "WGS84" && !has("a") && !has("R") ? "WGS84" : null);
    const U = has("to_meter") ? [val("to_meter"), "Unit", `units of ${p.to_meter} m`] : UNITS[has("units") ? p.units : "m"];
    if (!U || !(U[0] > 0)) throw new Error(`+units=${p.units} is not known here: give +to_meter instead`);
    // the projection; x_0 and y_0 are in metres, as in PROJ
    const lon0 = val("lon_0", 0), x0 = val("x_0", 0), y0 = val("y_0", 0), k0 = val("k_0", val("k", 1));
    let kind = p.proj, par = null, aux = false, M;
    if (["longlat", "latlong", "lonlat", "latlon"].includes(kind)) { kind = "longlat"; M = { fwd: (x, y) => [x, y], inv: (x, y) => [x, y] }; }
    else if (kind === "utm") {
      const z = val("zone");
      if (!(Number.isInteger(z) && z >= 1 && z <= 60)) throw new Error("+zone must be a whole number from 1 to 60");
      par = { lon0: z * 6 - 183, lat0: 0, k0: 0.9996, x0: 500000, y0: has("south") ? 10000000 : 0 };
      kind = "tmerc";
    } else if (kind === "tmerc" || kind === "etmerc") { par = { lon0, lat0: val("lat_0", 0), k0, x0, y0 }; kind = "tmerc"; }
    else if (kind === "aea") par = { lon0, lat0: val("lat_0", 0), lat1: val("lat_1"), lat2: val("lat_2"), x0, y0 };
    // with no +lat_0 the origin is on the one parallel, or on the equator with two, as PROJ's lcc does
    else if (kind === "lcc") { const lat1 = val("lat_1"); par = { lon0, lat0: val("lat_0", has("lat_2") ? 0 : lat1), lat1, lat2: val("lat_2", lat1), k0, x0, y0 }; }
    else if (kind === "merc" || kind === "webmerc") {
      // Web Mercator: spherical formulas on the ellipsoid's semi-major axis, as ESRI's auxiliary sphere
      aux = kind === "webmerc" || (!E.rf && E.a === 6378137);
      const S = kind === "webmerc" ? ell(E.a, 0) : E, ts = has("lat_ts") && kind === "merc" ? val("lat_ts") : null;
      const k = kind === "webmerc" ? 1 : ts !== null ? Math.cos(ts * rad) / Math.sqrt(1 - S.e2 * Math.sin(ts * rad) ** 2) : k0;
      if (k > 1) throw new Error("Mercator with +k above 1 is not supported");
      par = { lon0, k0: k, x0, y0, ts: ts !== null ? ts : Math.asin(Math.sqrt((1 - k * k) / (1 - S.e2 * k * k))) / rad };
      M = merc(S, lon0, k, x0, y0);
      kind = "merc";
    } else throw new Error(has("proj") ? `+proj=${p.proj} is not supported here: longlat, utm, tmerc, aea, lcc and merc are` : "it needs +proj");
    if (kind === "tmerc") M = tmerc(E, par.lon0, par.lat0, par.k0, par.x0, par.y0);
    if (kind === "aea") M = aea(E, par.lat1, par.lat2, par.lat0, par.lon0, par.x0, par.y0);
    if (kind === "lcc") M = lcc(E, par.lat1, par.lat2, par.lat0, par.lon0, par.k0, par.x0, par.y0);
    const geo = kind === "longlat", u = geo ? 1 : U[0];
    const into = tw ? (lon, lat) => geod(E, helmert(xyz(W84, lon, lat), tw, true)) : (lon, lat) => [lon, lat];
    const back = tw ? (lon, lat) => geod(W84, helmert(xyz(E, lon, lat), tw, false)) : (lon, lat) => [lon, lat];
    // its .prj: ESRI's names for WGS 84 and NAD83, others custom; false easting and northing in the system's unit
    const g = aux || dat === "WGS84" ? ["GCS_WGS_1984", "D_WGS_1984", W84] : dat === "NAD83" ? ["GCS_North_American_1983", "D_North_American_1983", E] : ["GCS_Custom", "D_Custom", E];
    const gcs = `GEOGCS["${g[0]}",DATUM["${g[1]}",SPHEROID["${g[2].esri}",${wn(g[2].a)},${wn(g[2].rf)}]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]`;
    let prj = gcs;
    if (!geo) {
      const pm = (k, v) => `PARAMETER["${k}",${wn(v)}]`, two = kind !== "merc" && Math.abs(par.lat1 - par.lat2) > 1e-10;
      const body = kind === "tmerc" ? ["Transverse_Mercator", pm("Scale_Factor", par.k0), pm("Latitude_Of_Origin", par.lat0)]
        : kind === "aea" ? ["Albers", pm("Standard_Parallel_1", par.lat1), pm("Standard_Parallel_2", par.lat2), pm("Latitude_Of_Origin", par.lat0)]
          : kind === "lcc" ? ["Lambert_Conformal_Conic", pm("Standard_Parallel_1", par.lat1), ...(two ? [pm("Standard_Parallel_2", par.lat2)] : []), ...(two && par.k0 === 1 ? [] : [pm("Scale_Factor", par.k0)]), pm("Latitude_Of_Origin", par.lat0)]
            : [aux ? "Mercator_Auxiliary_Sphere" : "Mercator", pm("Standard_Parallel_1", par.ts), ...(aux ? [pm("Auxiliary_Sphere_Type", 0)] : [])];
      prj = `PROJCS["${esri}",${gcs},PROJECTION["${body[0]}"],${[pm("False_Easting", par.x0 / u), pm("False_Northing", par.y0 / u), pm("Central_Meridian", par.lon0), ...body.slice(1)].join(",")},UNIT["${U[1]}",${wn(U[0])}]]`;
    }
    const what = { longlat: "longitude and latitude", tmerc: p.proj === "utm" ? `UTM zone ${p.zone}${has("south") ? "S" : "N"}` : "transverse Mercator", aea: "Albers equal area", lcc: "Lambert conformal conic", merc: aux ? "Web Mercator" : "Mercator" }[kind];
    const on = dat ? (dat === "NAD83" ? "NAD83" : "WGS 84") : E.rf ? `the ${String(E.esri).replace(/_/g, " ")} ellipsoid (a ${E.a} m, 1/f ${+E.rf.toFixed(9)})` : `a sphere of ${E.a} m`;
    return { epsg: null, proj4: src, geo, digits: geo ? 9 : 3, shift: !!tw, prj,
      desc: `${what} on ${on}${tw ? `, shifted by +towgs84=${tw.join(",")}` : ""}${geo ? ", in degrees" : `, in ${U[2]}`}`,
      fwd(lon, lat) { const [x, y] = M.fwd(...into(lon, lat)); return [x / u, y / u]; },
      inv(x, y) { return back(...M.inv(x * u, y * u)); } };
  }
  /* the systems offered by code: UTM north on WGS 84 (326zz) or NAD83 (269zz), and these */
  const CODES = { 4326: ["WGS 84", "+proj=longlat +datum=WGS84 +no_defs"], 4269: ["NAD83", "+proj=longlat +datum=NAD83 +no_defs"],
    3857: ["WGS 84 / Pseudo-Mercator", "+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs", "WGS_1984_Web_Mercator_Auxiliary_Sphere"],
    5070: ["NAD83 / Conus Albers", "+proj=aea +lat_0=23 +lon_0=-96 +lat_1=29.5 +lat_2=45.5 +x_0=0 +y_0=0 +datum=NAD83 +units=m +no_defs", "NAD_1983_Contiguous_USA_Albers"] };
  const known = new Map();
  /* { epsg, name, geog (its geographic system's code), ... } as fromProj4 */
  function crs(code) {
    if (!known.has(code)) {
      const z = code % 100, w = code > 32600 && code <= 32660, d = code > 26900 && code <= 26923;
      const c = w || d ? [`${w ? "WGS 84" : "NAD83"} / UTM zone ${z}N`, `+proj=utm +zone=${z} +datum=${w ? "WGS84" : "NAD83"} +units=m +no_defs`, `${w ? "WGS_1984" : "NAD_1983"}_UTM_Zone_${z}N`] : CODES[code];
      if (!c) throw new Error(`EPSG:${code} is not one of those built in`);
      known.set(code, { ...fromProj4(c[1], c[2]), epsg: code, name: c[0], geog: d || code === 5070 || code === 4269 ? 4269 : 4326 });
    }
    return known.get(code);
  }
  /* a system's scale at a point: its units in a ground metre east-west (k) and north-south (h), and in a square metre
     (ar), by steps of 0.0001° on the WGS 84 ellipsoid; s = √ar */
  function scaleAt(P, lon, lat) {
    const d = 1e-4, s = Math.sin(lat * rad), w = 1 - W84.e2 * s * s, N = W84.a / Math.sqrt(w), Mr = (W84.a * (1 - W84.e2)) / (w * Math.sqrt(w));
    const [xa, ya] = P.fwd(lon - d / 2, lat), [xb, yb] = P.fwd(lon + d / 2, lat), [xc, yc] = P.fwd(lon, lat - d / 2), [xd, yd] = P.fwd(lon, lat + d / 2);
    const ge = N * Math.cos(lat * rad) * d * rad, gn = Mr * d * rad, ex = xb - xa, ey = yb - ya, nx = xd - xc, ny = yd - yc, ar = Math.abs(ex * ny - ey * nx) / (ge * gn);
    return { k: Math.hypot(ex, ey) / ge, h: Math.hypot(nx, ny) / gn, ar, s: Math.sqrt(ar) };
  }
  const zoneOf = lon => Math.floor((lon + 180) / 6) + 1;

  /* ---------- the lattice ---------- */
  /* Cells of a given size on the map's easting and northing, turned clockwise by angle (degrees) about the origin (ox,
     oy). Square cells have the size as their side; hexagons as the width across their flats, with their points up or,
     with flat: true, sideways. u and v are the lattice's own axes. A cell is (i, j); its centre decides what it holds. */
  function lattice({ kind = "square", size, angle = 0, ox = 0, oy = 0, flat = false }) {
    const hex = kind === "hex", th = (angle + (hex && flat ? 90 : 0)) * rad, c = Math.cos(th), s = Math.sin(th);
    const du = size, dv = hex ? (size * Math.sqrt(3)) / 2 : size;
    const L = { kind, size, angle, ox, oy, flat, du, dv, hex,
      area: hex ? (size * size * Math.sqrt(3)) / 2 : size * size,
      toUV: (E, N) => [c * (E - ox) - s * (N - oy), s * (E - ox) + c * (N - oy)],
      fromUV: (u, v) => [ox + c * u + s * v, oy - s * u + c * v],
      // the first column's centre is at shift(j) × du on row j
      shift: j => (hex ? (j & 1 ? 0.5 : 0) : 0.5),
      vOf: j => (hex ? j : j + 0.5) * dv,
      centre: (i, j) => L.fromUV((i + L.shift(j)) * du, L.vOf(j)),
      // corners, clockwise as a shapefile wants them, closed
      ring(i, j) {
        const cu = (i + L.shift(j)) * du, cv = L.vOf(j);
        if (!hex) return [[-1, -1], [-1, 1], [1, 1], [1, -1], [-1, -1]].map(([a, b]) => L.fromUV(cu + (a * du) / 2, cv + (b * dv) / 2));
        const R = size / Math.sqrt(3);
        return [270, 330, 30, 90, 150, 210, 270].map(d => L.fromUV(cu - (R * Math.cos(d * rad)), cv + R * Math.sin(d * rad)));
      } };
    return L;
  }
  /* The rows and columns a boundary needs: { L, j0, j1, i0, i1, rows, cols, count }. Row 0 is the top: the largest v. */
  function windowOf(L, rings) {
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    rings.forEach(r => r.forEach(([E, N]) => { const [u, v] = L.toUV(E, N); if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v; }));
    const pad = L.hex ? 1 : 0, j0 = Math.floor(v0 / L.dv) - pad, j1 = Math.ceil(v1 / L.dv) + pad - (L.hex ? 0 : 1), i0 = Math.floor(u0 / L.du) - pad - (L.hex ? 1 : 0), i1 = Math.ceil(u1 / L.du) + pad - (L.hex ? 0 : 1);
    const rows = j1 - j0 + 1, cols = i1 - i0 + 1;
    return { L, j0, j1, i0, i1, rows, cols, count: rows * cols };
  }
  const indexOf = (W, i, j) => (W.j1 - j) * W.cols + (i - W.i0);
  /* Set every cell whose centre lies in the polygon (rings in map metres, even-odd) with paint(index): a scanline over
     the rows the polygon crosses, so its cost goes with its edges and rows, not with the cells of the window. */
  function paint(W, rings, set) {
    const L = W.L, cross = new Map();
    rings.forEach(r => {
      let [ua, va] = L.toUV(r[0][0], r[0][1]);
      for (let k = 1; k < r.length; k++) {
        const [ub, vb] = L.toUV(r[k][0], r[k][1]);
        if (va !== vb) {
          const lo = Math.min(va, vb), hi = Math.max(va, vb);
          // rows whose centre line lo <= v < hi
          const first = Math.max(W.j0, Math.ceil(lo / L.dv - (L.hex ? 0 : 0.5))), last = Math.min(W.j1, Math.ceil(hi / L.dv - (L.hex ? 0 : 0.5)) - 1);
          for (let j = first; j <= last; j++) {
            const u = ua + ((ub - ua) * (L.vOf(j) - va)) / (vb - va);
            let a = cross.get(j);
            if (!a) cross.set(j, (a = []));
            a.push(u);
          }
        }
        ua = ub; va = vb;
      }
    });
    cross.forEach((a, j) => {
      a.sort((x, y) => x - y);
      const sh = L.shift(j), base = (W.j1 - j) * W.cols - W.i0;
      for (let k = 0; k + 1 < a.length; k += 2) {
        const c0 = Math.max(W.i0, Math.ceil(a[k] / L.du - sh)), c1 = Math.min(W.i1, Math.ceil(a[k + 1] / L.du - sh) - 1);
        for (let i = c0; i <= c1; i++) set(base + i);
      }
    });
  }
  /* a line segment widened to half on either side and at its ends, as a polygon for paint */
  function bandRing(ax, ay, bx, by, half) {
    const dx = bx - ax, dy = by - ay, d = Math.hypot(dx, dy) || 1, ux = (dx / d) * half, uy = (dy / d) * half;
    return [[ax - ux - uy, ay - uy + ux], [bx + ux - uy, by + uy + ux], [bx + ux + uy, by + uy - ux], [ax - ux + uy, ay - uy - ux], [ax - ux - uy, ay - uy + ux]];
  }

  /* ---------- GeoTIFF ---------- */
  const deflate = async u8 => new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer());
  const NODATA = -9999;
  /* A GeoTIFF of Float32 bands, one plane per band, Deflate by strips: fill(band, row, out) gives one row at a time, so
     only the compressed strips are held. North-up with pixel scale and tiepoint; turned with a transformation matrix.
     Returns a Blob. o: { width, height, names, fill, epsg, geog, citation, meta, x0, y0, size, angle, progress(0-1), stop() }
     where (x0, y0) is the outer corner of the first pixel, epsg the projected system's code, geog its geographic one's,
     citation its name and meta { name: value } items for the file as a whole. */
  async function geotiff(o) {
    const { width: w, height: h, names } = o, B = names.length, RPS = Math.max(1, Math.min(h, Math.floor(1048576 / (w * 4)) || 1));
    const nStrips = Math.ceil(h / RPS), total = B * nStrips, parts = new Array(total), counts = [], offsets = [], flight = [];
    let off = 8, done = 0;
    // a few strips are deflated at once while the next is filled; the oldest is awaited first, so at most 4 raw strips are held
    for (let b = 0; b < B; b++) {
      for (let s = 0; s < nStrips; s++) {
        const rows = Math.min(RPS, h - s * RPS), buf = new Float32Array(w * rows), at = b * nStrips + s;
        for (let r = 0; r < rows; r++) o.fill(b, s * RPS + r, buf.subarray(r * w, (r + 1) * w));
        flight.push(deflate(new Uint8Array(buf.buffer)).then(z => { parts[at] = z; done++; if (o.progress && done % 8 === 0) o.progress(done / total); }));
        if (flight.length >= 4) await flight.shift();
        if (o.stop && o.stop()) { await Promise.allSettled(flight); throw new Error("stopped"); }
      }
    }
    await Promise.all(flight);
    parts.forEach(z => { offsets.push(off); counts.push(z.length); off += z.length; });
    if (off & 1) { parts.push(new Uint8Array(1)); off++; }
    // the tags' long values follow the directory
    const th = (o.angle || 0) * rad, c = Math.cos(th), sn = Math.sin(th), sz = o.size;
    // GeoKeys, as GDAL writes them: projected, pixel is area, citation, geographic system, degrees, projected system, metres
    const cit = `${String(o.citation || "").replace(/[^ -{}~]/g, "_")}|`;
    const geo = [1, 1, 0, 7, 1024, 0, 1, 1, 1025, 0, 1, 1, 1026, 34737, cit.length, 0, 2048, 0, 1, o.geog || 4326, 2054, 0, 1, 9102, 3072, 0, 1, o.epsg, 3076, 0, 1, 9001];
    const meta = Object.entries(o.meta || {}).map(([k, v]) => `<Item name="${k}">${String(v).replace(/[<&>]/g, "_")}</Item>`).join("");
    const xml = `<GDALMetadata>${meta}${names.map((n, i) => `<Item name="DESCRIPTION" sample="${i}" role="description">${n.replace(/[<&>]/g, "_")}</Item>`).join("")}</GDALMetadata>\0`;
    const nod = `${NODATA}\0`;
    const tags = [[256, 4, [w]], [257, 4, [h]], [258, 3, new Array(B).fill(32)], [259, 3, [8]], [262, 3, [1]], [273, 4, offsets], [277, 3, [B]], [278, 4, [RPS]], [279, 4, counts], [284, 3, [2]]];
    if (B > 1) tags.push([338, 3, new Array(B - 1).fill(0)]);
    tags.push([339, 3, new Array(B).fill(3)]);
    // columns run along the lattice's u axis, rows down its v axis
    if (o.angle) tags.push([34264, 12, [c * sz, -sn * sz, 0, o.x0, -sn * sz, -c * sz, 0, o.y0, 0, 0, 0, 0, 0, 0, 0, 1]]);
    else { tags.push([33550, 12, [sz, sz, 0]]); tags.push([33922, 12, [0, 0, 0, o.x0, o.y0, 0]]); }
    tags.push([34735, 3, geo], [34737, 2, `${cit}\0`], [42112, 2, xml], [42113, 2, nod]);
    const SIZE = { 2: 1, 3: 2, 4: 4, 12: 8 }, len = t => (t[1] === 2 ? t[2].length : t[2].length), ifdSize = 2 + tags.length * 12 + 4;
    let extra = 0;
    tags.forEach(t => { const b = len(t) * SIZE[t[1]]; if (b > 4) extra += b + (b & 1); });
    const tail = new ArrayBuffer(ifdSize + extra), dv = new DataView(tail), bytes = new Uint8Array(tail);
    dv.setUint16(0, tags.length, true);
    let pos = 2, ex = ifdSize;
    const put = (p, t) => {
      if (t[1] === 2) { for (let i = 0; i < t[2].length; i++) bytes[p + i] = t[2].charCodeAt(i); return; }
      const st = SIZE[t[1]];
      t[2].forEach((v, i) => { if (t[1] === 3) dv.setUint16(p + i * st, v, true); else if (t[1] === 4) dv.setUint32(p + i * st, v, true); else dv.setFloat64(p + i * st, v, true); });
    };
    tags.forEach(t => {
      const b = len(t) * SIZE[t[1]];
      dv.setUint16(pos, t[0], true); dv.setUint16(pos + 2, t[1], true); dv.setUint32(pos + 4, len(t), true);
      if (b <= 4) put(pos + 8, t);
      else { dv.setUint32(pos + 8, off + ex, true); put(ex, t); ex += b + (b & 1); }
      pos += 12;
    });
    dv.setUint32(pos, 0, true);
    const head = new ArrayBuffer(8), hv = new DataView(head);
    hv.setUint16(0, 0x4949, true); hv.setUint16(2, 42, true); hv.setUint32(4, off, true);
    if (o.progress) o.progress(1);
    return new Blob([head, ...parts, tail], { type: "image/tiff" });
  }

  /* ---------- ring order ---------- */
  /* twice a ring's signed area, positive counter-clockwise; taken from its first point, so a 20 cm cell in degrees keeps its digits */
  function area2(r) {
    const [x0, y0] = r[0];
    let s = 0;
    for (let k = 1; k + 1 < r.length; k++) s += (r[k][0] - x0) * (r[k + 1][1] - y0) - (r[k + 1][0] - x0) * (r[k][1] - y0);
    return s;
  }
  /* a polygon's rings, the outer one first, closed and turned whichever way they came: the outer clockwise and holes
     the other way when cw (a shapefile), or the reverse (GeoJSON, RFC 7946); both formats want closed rings */
  const closed = r => (r.length && (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1]) ? [...r, r[0]] : r);
  const orient = (R, cw) => R.map(closed).map((r, i) => ((area2(r) < 0) === ((i === 0) === cw) ? r : r.slice().reverse()));

  /* ---------- shapefile ---------- */
  /* n polygons; rings(k) gives the rings of cell k, each closed, the outer one first: they are written with the outer
     ring clockwise and holes counter-clockwise, as the format wants. fields: [{ name (10 characters at most), type
     "N" | "C", width, dec }], value(k, f) the cell's value for field f (null for blank). tick(done, total), awaited
     every 20,000 cells, reports and may stop it by throwing. */
  async function shapefile(base, n, rings, fields, value, prj, tick) {
    const shapes = new Array(n), every = 20000;
    let bytes = 100;
    for (let k = 0; k < n; k++) {
      const R = orient(rings(k), true), pts = R.reduce((a, r) => a + r.length, 0);
      shapes[k] = R; bytes += 8 + 44 + 4 * R.length + 16 * pts;
      if (tick && k % every === every - 1) await tick(k + 1, 2 * n);
    }
    const shp = new ArrayBuffer(bytes), sv = new DataView(shp), shx = new ArrayBuffer(100 + 8 * n), xv = new DataView(shx);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, at = 100;
    for (let k = 0; k < n; k++) {
      const R = shapes[k], pts = R.reduce((a, r) => a + r.length, 0), words = (44 + 4 * R.length + 16 * pts) / 2;
      sv.setInt32(at, k + 1, false); sv.setInt32(at + 4, words, false);
      xv.setInt32(100 + 8 * k, at / 2, false); xv.setInt32(104 + 8 * k, words, false);
      let a = at + 8, bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
      sv.setInt32(a, 5, true);
      sv.setInt32(a + 36, R.length, true); sv.setInt32(a + 40, pts, true);
      let pa = a + 44, pp = pa + 4 * R.length, idx = 0;
      R.forEach(r => {
        sv.setInt32(pa, idx, true); pa += 4; idx += r.length;
        r.forEach(([x, y]) => { sv.setFloat64(pp, x, true); sv.setFloat64(pp + 8, y, true); pp += 16; if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; });
      });
      sv.setFloat64(a + 4, bx0, true); sv.setFloat64(a + 12, by0, true); sv.setFloat64(a + 20, bx1, true); sv.setFloat64(a + 28, by1, true);
      if (bx0 < x0) x0 = bx0; if (bx1 > x1) x1 = bx1; if (by0 < y0) y0 = by0; if (by1 > y1) y1 = by1;
      at += 8 + 2 * words;
    }
    [[sv, bytes], [xv, 100 + 8 * n]].forEach(([v, b]) => {
      v.setInt32(0, 9994, false); v.setInt32(24, b / 2, false); v.setInt32(28, 1000, true); v.setInt32(32, 5, true);
      [x0, y0, x1, y1].forEach((c, i) => v.setFloat64(36 + 8 * i, n ? c : 0, true));
    });
    // dBASE III
    const rec = 1 + fields.reduce((a, f) => a + f.width, 0), hb = 33 + 32 * fields.length, dbf = new Uint8Array(hb + rec * n + 1), dv = new DataView(dbf.buffer), now = new Date();
    dbf[0] = 3; dbf[1] = now.getUTCFullYear() - 1900; dbf[2] = now.getUTCMonth() + 1; dbf[3] = now.getUTCDate();
    dv.setUint32(4, n, true); dv.setUint16(8, hb, true); dv.setUint16(10, rec, true);
    fields.forEach((f, i) => {
      const p = 32 + 32 * i;
      for (let c = 0; c < Math.min(10, f.name.length); c++) dbf[p + c] = f.name.charCodeAt(c);
      dbf[p + 11] = f.type.charCodeAt(0); dbf[p + 16] = f.width; dbf[p + 17] = f.dec || 0;
    });
    dbf[hb - 1] = 0x0d;
    let d = hb;
    for (let k = 0; k < n; k++) {
      if (tick && k % every === every - 1) await tick(n + k + 1, 2 * n);
      dbf[d++] = 0x20;
      fields.forEach(f => {
        const v = value(k, f);
        let s = v === null || v === undefined || v === "" || (typeof v === "number" && !Number.isFinite(v)) ? "" : f.type === "N" ? Number(v).toFixed(f.dec || 0) : String(v);
        if (s.length > f.width) s = f.type === "N" ? Number(v).toPrecision(Math.max(1, f.width - 6)).slice(0, f.width) : s.slice(0, f.width);
        s = f.type === "N" ? s.padStart(f.width) : s.padEnd(f.width);
        for (let c = 0; c < f.width; c++) dbf[d + c] = s.charCodeAt(c) & 0x7f;
        d += f.width;
      });
    }
    dbf[d] = 0x1a;
    return [{ name: `${base}.shp`, blob: new Blob([shp]) }, { name: `${base}.shx`, blob: new Blob([shx]) }, { name: `${base}.dbf`, blob: new Blob([dbf]) },
      { name: `${base}.prj`, text: prj }, { name: `${base}.cpg`, text: "ASCII" }];
  }

  /* ---------- GeoJSON ---------- */
  /* lon-lat polygons with properties (RFC 7946: outer rings counter-clockwise, holes clockwise, whichever way they come),
     as a Blob built in pieces; tick(done, total) as for the shapefile */
  async function geojson(n, ringsLonLat, props, tick) {
    const parts = ['{"type":"FeatureCollection","features":['];
    for (let k = 0; k < n; k++) {
      if (tick && k % 20000 === 19999) await tick(k + 1, n);
      const R = orient(ringsLonLat(k).map(r => r.map(([x, y]) => [+x.toFixed(8), +y.toFixed(8)])), false);
      parts.push(`${k ? "," : ""}{"type":"Feature","properties":${JSON.stringify(props(k))},"geometry":{"type":"Polygon","coordinates":${JSON.stringify(R)}}}`);
    }
    parts.push("]}");
    return new Blob(parts, { type: "application/geo+json" });
  }

  return { crs, fromProj4, scaleAt, zoneOf, lattice, windowOf, indexOf, paint, bandRing, geotiff, shapefile, geojson, NODATA };
})();
