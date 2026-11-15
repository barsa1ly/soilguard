/* Place suggestions while typing in the search box. data/places.txt (tools/build_places.py) holds every Census place,
   county and New England town in the 48 contiguous states and DC, most people first; it is read once, the first time
   the search box is used, and matched here, so typing asks no server. "Tem" gives Temple, TX; Temple City, CA; ...;
   "Temple, ok" or "temple oklahoma" keeps one state. Below: ZIP codes (data/zips, also no server) and streets and
   addresses (Photon). */
(function () {
  "use strict";
  const WG = (window.WG = window.WG || {});
  const KIND = { c: "city", w: "town", v: "village", b: "borough", p: "community (unincorporated)", k: "county", t: "town" };
  let rows = null, loading = null;

  // lower case without accents, dots or apostrophes; Saint/St., Mount/Mt., Fort/Ft. match either way
  const plain = s => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[.'’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const SHORT = [[/\bsaint\b/g, "st"], [/\bsainte\b/g, "ste"], [/\bmount\b/g, "mt"], [/\bfort\b/g, "ft"]];
  const LONG = [[/\bst\b/g, "saint"], [/\bste\b/g, "sainte"], [/\bmt\b/g, "mount"], [/\bft\b/g, "fort"]];
  function keys(name) {
    const k = plain(name), out = [k];
    for (const set of [SHORT, LONG]) {
      const v = set.reduce((s, [re, to]) => s.replace(re, to), k);
      if (v !== k) out.push(v);
    }
    return out;
  }

  function load(v) {
    if (rows) return Promise.resolve(rows);
    if (!loading) {
      const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 30000);
      // the app's own file: it skips util.js's per-server line, and is asked again after a network failure
      loading = WG.util.fetchQ(`data/places.txt?v=${v}`, { signal: ctrl.signal })
        .then(r => { if (!r.ok) throw new Error(`the place list did not load (HTTP ${r.status})`); return r.text(); })
        .then(text => {
          rows = text.split("\n").filter(Boolean).map(l => {
            const [n, st, lat, lon, k, p] = l.split("|");
            return { name: n, st, lat: +lat, lon: +lon, kind: KIND[k] || "place", county: k === "k", people: +p || 0, keys: keys(n) };
          });
          return rows;
        })
        .catch(e => { loading = null; throw e; })
        .finally(() => clearTimeout(t));
    }
    return loading;
  }

  /* The places whose name starts with what was typed (or has a word that does), best first: the whole name typed,
     then the start of a name, then a later word; within each, the most people, places in the states on the map
     counting 20 times. q may end in ", ST" or ", state name", or without the comma in a postal code or a whole state
     name. opts: here (Set of the codes on the map), states ({code: name}), limit. Each answer has exact = the whole
     name and its state were typed. */
  function find(q, opts = {}) {
    if (!rows) return [];
    const here = opts.here || new Set(), states = opts.states || {}, limit = opts.limit || 8;
    const codes = Object.keys(states), sname = Object.fromEntries(codes.map(c => [c, plain(states[c])]));
    const stateOf = s => {
      const t = plain(s);
      if (!t) return null;
      if (t.length === 2 && states[t.toUpperCase()]) return [t.toUpperCase()];
      const m = codes.filter(c => sname[c].startsWith(t));
      return m.length ? m : null;
    };
    const asks = []; // [name typed, the states it may be in or null]
    const comma = q.lastIndexOf(",");
    if (comma >= 0) asks.push([q.slice(0, comma), stateOf(q.slice(comma + 1))]);
    else {
      asks.push([q, null]);
      const t = plain(q);
      for (const c of codes) {
        for (const tail of [c.toLowerCase(), sname[c]]) {
          if (t.length > tail.length + 1 && t.endsWith(" " + tail)) asks.push([t.slice(0, -tail.length - 1), [c]]);
        }
      }
    }
    const best = new Map(); // row -> [tier, exact]
    for (const [name, sts] of asks) {
      const n = plain(name);
      if (!n) continue;
      const inSt = sts ? new Set(sts) : null, word = " " + n;
      for (const r of rows) {
        if (inSt && !inSt.has(r.st)) continue;
        let tier = 3;
        for (const k of r.keys) {
          if (k === n) { tier = 0; break; }
          if (tier > 1 && k.startsWith(n)) tier = 1;
          else if (tier > 2 && k.includes(word)) tier = 2;
        }
        if (tier === 3) continue;
        const was = best.get(r), exact = tier === 0 && !!inSt;
        if (!was || tier < was[0] || (tier === was[0] && exact && !was[1])) best.set(r, [tier, exact]);
      }
    }
    const weight = r => r.people * (here.has(r.st) ? 20 : 1);
    return [...best].sort((a, b) => a[1][0] - b[1][0] || b[1][1] - a[1][1] || weight(b[0]) - weight(a[0]))
      .slice(0, limit).map(([r, [tier, exact]]) => ({ ...r, tier, exact }));
  }

  /* ---------- ZIP codes ----------
     data/zips/D.txt (tools/build_zips.py): every 5-digit ZIP code area (the Census Bureau's ZCTA) in the 48 states and
     DC, "zip|lat|lon|ST|town", in ZIP order, one file for each first digit (about 120 kB), read the first time a ZIP
     starting with that digit is typed: "765" lists 76501, 76502, ... at once, no server asked. */
  const zipFiles = new Map(); // first digit -> promise of its rows
  function loadZips(d, v) {
    if (!zipFiles.has(d)) {
      zipFiles.set(d, WG.util.fetchQ(`data/zips/${d}.txt?v=${v}`, {}, 30000)
        .then(r => { if (!r.ok) throw new Error(`the ZIP code list did not load (HTTP ${r.status})`); return r.text(); })
        .then(text => text.split(/\r?\n/).filter(Boolean).map(l => { const [zip, lat, lon, st, town] = l.split("|"); return { zip, lat: +lat, lon: +lon, st, town }; }))
        .catch(e => { zipFiles.delete(d); throw e; })); // asked again the next time
    }
    return zipFiles.get(d);
  }
  // the digits of a ZIP code typed alone ("76502", "765", "zip 76502", "76502-1234"), else null
  const zipOf = q => { const m = /^(?:zip(?:\s*code)?\s*:?\s*)?(\d{1,5})(?:-\d{0,4})?$/i.exec(String(q).trim()); return m ? m[1] : null; };
  // the ZIP code areas starting with the digits (3 to 5), in ZIP order; exact: the whole ZIP typed
  async function zips(digits, v, limit = 8) {
    const all = await loadZips(digits[0], v);
    let lo = 0, hi = all.length; // the first at or after the digits, by halving: the rows are in order
    while (lo < hi) { const m = (lo + hi) >> 1; if (all[m].zip < digits) lo = m + 1; else hi = m; }
    const out = [];
    for (let i = lo; i < all.length && out.length < limit && all[i].zip.startsWith(digits); i++) out.push({ ...all[i], exact: all[i].zip === digits });
    return out;
  }

  /* ---------- streets and addresses ----------
     Photon (photon.komoot.io, run by komoot: OpenStreetMap's streets, house numbers and places; free, no key, and it
     answers pages on any site). Unlike Nominatim it is made for search as you type; its public server asks for fair use
     and throttles heavy use, so the box asks it only once typing pauses (js/app.js), only for 4 characters or more that
     look like a street or an address or match no town, and keeps each answer for the visit (per text asked). OpenStreetMap spells street names out
     and Photon matches words as written: "720 E Blackland Rd" found nothing, "720 East Blackland Road" found the street,
     so the usual US abbreviations are spelled out before asking. */
  const PHOTON = "https://photon.komoot.io/api/";
  const DIRS = { n: "North", s: "South", e: "East", w: "West", ne: "Northeast", nw: "Northwest", se: "Southeast", sw: "Southwest" };
  const ABBR = { rd: "Road", ave: "Avenue", av: "Avenue", blvd: "Boulevard", ln: "Lane", ct: "Court", cir: "Circle", pkwy: "Parkway", hwy: "Highway",
    fwy: "Freeway", expy: "Expressway", trl: "Trail", ter: "Terrace", sq: "Square", cv: "Cove", xing: "Crossing", pl: "Place", aly: "Alley", mt: "Mount", ft: "Fort" };
  const ROUTE = { fm: "Farm-to-Market Road", rm: "Ranch-to-Market Road", cr: "County Road", sh: "State Highway" }; // Texas road numbers as OpenStreetMap names them
  const SUFFIX = "st|street|rd|road|ave?|avenue|blvd|boulevard|dr|drive|ln|lane|ct|court|cir|circle|pl|place|pkwy|parkway|hwy|highway|fwy|freeway|expy|trl|trail|ter|terrace|way|loop|cv|cove|xing|crossing|sq|square";
  const STREET_WORD = new RegExp(`\\s(?:${SUFFIX})\\.?(?=\\s|,|$)`, "i"), ROUTE_NO = /\b(?:fm|rm|cr|sh|hwy|highway|us|loop|spur|county road|state highway)\s*-?\d/i;
  // a house number and a word ("720 E Blackland Rd", "12B Main"), a road number ("FM 2305") or a street word after a name ("Main St, Temple")
  const looksAddress = q => { const t = String(q).trim(); return /^\d+[a-z]?\s+[a-z]/i.test(t) || ROUTE_NO.test(t) || STREET_WORD.test(t); };
  const isNo = w => /^\d/.test(w || "");
  // the street (before the first comma) with its abbreviations spelled out; the town, state and ZIP after it as typed
  function spellOut(q) {
    const [street, ...rest] = q.split(","), w = street.trim().split(/\s+/), n = w.length;
    const out = w.map((x, k) => {
      const lc = x.toLowerCase().replace(/\.$/, ""), r = /^(fm|rm|cr|sh)-?(\d+)$/.exec(lc), first = k === 0 || isNo(w[k - 1]) || DIRS[w[k - 1].toLowerCase().replace(/\.$/, "")];
      if (r) return `${ROUTE[r[1]]} ${r[2]}`;
      if (ROUTE[lc] && isNo(w[k + 1])) return ROUTE[lc];
      if (DIRS[lc] && (k === 0 || isNo(w[k - 1]) || k === n - 1)) return DIRS[lc]; // before the name, or after it ("Main St NW")
      if (lc === "st") return first ? "Saint" : "Street"; // "100 St Charles Ave", "100 Main St"
      if (lc === "dr") return first ? x : "Drive";
      return ABBR[lc] || x;
    });
    return [out.join(" "), ...rest].join(",");
  }
  // words that say what kind of street, not which: a street must hold the other words typed (see streets)
  const WEAK = new Set(["north", "south", "east", "west", "northeast", "northwest", "southeast", "southwest", "street", "road", "avenue", "boulevard", "drive",
    "lane", "court", "circle", "parkway", "highway", "freeway", "expressway", "trail", "terrace", "square", "cove", "crossing", "place", "alley", "way", "loop",
    "farm", "ranch", "to", "market", "county", "state", "the", "of"]);
  const photonMemo = new Map(); // url -> promise of the answer, for the visit
  let photonStop = null;
  /* Streets, addresses and places for the text, in Photon's order: [{ title, sub, lat, lon, st, kind, zoom, town,
     refine }]. opts: states ({code: name}: only these, the 48 and DC), near ([lat, lon]: put first; the chosen states'
     middle, never where the user is), zoom (how far that preference reaches). A house number typed on a street Photon
     knows only as a street gives the street with the number in front and refine = { house, street, city, postcode }:
     the house itself is looked for when it is picked (js/app.js). */
  async function streets(q, opts = {}) {
    const text = spellOut(q.trim().replace(/\s+/g, " ")), house = (/^(\d+[a-z]?)\s/i.exec(q.trim()) || [])[1];
    const p = new URLSearchParams({ q: text, limit: "10", lang: "en", bbox: "-125.0,24.3,-66.9,49.5" }); // the 48 states and DC
    if (opts.near) { p.set("lat", opts.near[0].toFixed(2)); p.set("lon", opts.near[1].toFixed(2)); p.set("zoom", String(opts.zoom || 7)); }
    const url = `${PHOTON}?${p}`;
    if (!photonMemo.has(url)) {
      if (photonStop) photonStop.abort(); // the answer for the letters before is no longer wanted
      const stop = (photonStop = new AbortController());
      photonMemo.set(url, WG.util.fetchJSON(url, { signal: stop.signal }, 10000).catch(e => { photonMemo.delete(url); throw e; }));
    }
    const j = await photonMemo.get(url), states = opts.states || {};
    const code = s => { const t = String(s || ""), u = t.toUpperCase(); return states[u] ? u : Object.keys(states).find(c => states[c].toLowerCase() === t.toLowerCase()) || null; };
    /* Photon also answers with near spellings and other streets with the same number ("720 East Central Road" for "720
       E Blackland Rd"): each word typed (not a number, a direction or the street's kind) must start a word of the
       street, the name, the town or the state; when none does, Photon's first three stay (a misspelling it got right) */
    const core = text.toLowerCase().split(/[\s,-]+/).filter(w => w && !/^\d/.test(w) && !WEAK.has(w));
    const fits = (a, st) => { const words = [a.street, a.name, a.city, a.town, a.village, a.district, a.locality, a.county, st].join(" ").toLowerCase().split(/[^a-z0-9]+/); return core.every(c => words.some(w => w.startsWith(c))); };
    const feats = ((j && j.features) || []).map(f => [f, f.properties || {}]).map(([f, a]) => [f, a, a.countrycode === "US" && code(a.state)]);
    const good = feats.filter(([, a, st]) => st && fits(a, st));
    const seen = new Set(), out = [];
    for (const [f, a, st] of good.length ? good : feats.slice(0, 3)) {
      const [lon, lat] = (f.geometry && f.geometry.coordinates) || [];
      if (!st || !Number.isFinite(lat) || ["state", "country", "county"].includes(a.type)) continue; // counties are the place list's
      const town = a.city || a.town || a.village || a.district || a.locality || (a.county ? `${a.county.replace(/ County$/, "")} County` : "");
      const addr = a.housenumber && a.street ? `${a.housenumber} ${a.street}` : "", where = [town, `${st}${a.postcode ? ` ${a.postcode}` : ""}`];
      let title = a.name || addr, kind = a.type === "house" ? (a.name ? "" : "address") : a.type === "street" ? "street" : "place", refine = null, zoom = a.type === "house" ? 17 : a.type === "street" ? 16 : 13;
      if (!title) continue;
      if (a.type === "street" && house) {
        title = `${house} ${a.name}`; kind = "address"; zoom = 17;
        refine = { house, street: a.name, city: a.city || a.town || a.village || "", postcode: a.postcode || "" };
      }
      const key = `${title}|${town}|${st}`.toLowerCase();
      if (seen.has(key)) continue; // a street drawn in several pieces
      seen.add(key);
      const sub = [a.name && addr && addr !== title ? addr : "", where.filter(Boolean).join(", ")].filter(Boolean).join(", ");
      out.push({ title, sub: kind ? `${sub} · ${kind}` : sub, lat, lon, st, kind, zoom, town, refine });
    }
    return out;
  }

  WG.places = { load, find, loaded: () => !!rows, zips, zipOf, looksAddress, streets };
})();
