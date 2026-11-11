/* Place suggestions while typing in the search box. data/places.txt (tools/build_places.py) holds every Census place,
   county and New England town in the 48 contiguous states and DC, most people first; it is read once, the first time
   the search box is used, and matched here, so typing asks no server. "Tem" gives Temple, TX; Temple City, CA; ...;
   "Temple, ok" or "temple oklahoma" keeps one state. */
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
      loading = fetch(`data/places.txt?v=${v}`, { signal: ctrl.signal })
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

  WG.places = { load, find, loaded: () => !!rows };
})();
