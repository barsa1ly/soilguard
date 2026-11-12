/* WG.h5range: a small read-only HDF5 reader over HTTP Range requests, for NetCDF-4 files read in place on a plain file
   server. Written for gridMET Drought (University of Idaho): when its THREDDS server does not answer, its file server
   (www.northwestknowledge.net/metdata/data) still sends any byte range of the same 6 to 7.5 GB files, and for one 4 km
   cell only the chunks that hold that cell are fetched. gridMET's yearly weather files there are made the same way
   (superblock 2, chunked, deflate), so js/wind.js could read them like this too.
   What it reads (HDF5 File Format Specification 3.0): superblock 0 to 3; object headers 1 and 2 with their continuation
   blocks; groups as link messages, dense links (fractal heap and v2 B-tree) or old-style symbol tables; dataspace;
   fixed-point and floating-point types of any size and byte order; fill value; compact and dense attributes; the
   deflate, shuffle and Fletcher-32 filters; compact, contiguous and chunked layouts, chunks indexed by a v1 B-tree or
   by layout 4's single-chunk and implicit indexes. Anything else stops with an Error that names it.
   Bytes: metadata through a cache of 64 KB blocks, missing neighbours fetched in one request; chunk-index nodes and
   chunks as exact ranges; at most 6 requests in flight to a server (util.js's own limit), the files of the tab on show
   ahead of a background analysis's (o.pri). The server rewrites these files every few days, so every answer must carry
   the first one's Last-Modified: a read that meets a new version drops that file's cache and runs again once
   (withFile). Parsed metadata (headers, attributes, B-tree nodes) is kept per URL and Last-Modified for the visit, and
   with o.keep the layout (datasets and chunk-index nodes) for later visits too. */
WG.h5range = (function () {
  const BLOCK = 65536, FLY = 6, HEAD_MS = 20000, KEEP = 16e6, UNDEF = -1;
  const files = new Map(); // url -> the state of the version being read
  const stats = { requests: 0, bytes: 0 };
  const td = new TextDecoder();
  const fail = m => { throw new Error(`HDF5: ${m}`); };
  const stopped = sig => (sig && sig.reason) || new DOMException("Stopped", "AbortError");
  const prod = a => a.reduce((x, y) => x * y, 1);
  const strides = dims => { const s = new Array(dims.length).fill(1); for (let d = dims.length - 2; d >= 0; d--) s[d] = s[d + 1] * dims[d + 1]; return s; };
  const enc = x => Math.floor(Math.log2(x) / 8) + 1; // bytes HDF5 uses to store a count up to x (H5VM_limit_enc_size)
  // a float32 attribute as the shortest decimal that is the same float32, as ncdump and THREDDS print it (0.01, not 0.0099999998)
  const short32 = x => { if (!Number.isFinite(x)) return x; for (let p = 1; p < 10; p++) { const y = +x.toPrecision(p); if (Math.fround(y) === x) return y; } return x; };

  /* ---------- requests ---------- */
  /* a line a server: FLY in flight, the rest waiting by priority (a read's o.pri for its chunks and index nodes, the
     file's highest for its other metadata), first come first served within one. A Drought tab's read then does not
     wait behind the 40 yearly weather files the wind analysis reads from the same server at the same time (12 Nov
     2026: its whole series came some 11 s later for that alone), and its This-week values do not wait behind its
     whole series. */
  const lines = new Map(); // host -> { fly, queue }
  const slot = (S, sig, pri = S.pri) => new Promise((res, rej) => {
    let L = lines.get(S.host);
    if (!L) lines.set(S.host, (L = { fly: 0, queue: [] }));
    if (L.fly < FLY) { L.fly++; res(); return; }
    const q = { res, pri }, at = L.queue.findIndex(x => x.pri < q.pri);
    L.queue.splice(at < 0 ? L.queue.length : at, 0, q);
    if (sig) sig.addEventListener("abort", () => { const k = L.queue.indexOf(q); if (k >= 0) { L.queue.splice(k, 1); rej(stopped(sig)); } }, { once: true });
  });
  const release = S => { const L = lines.get(S.host), q = L.queue.shift(); if (q) q.res(); else L.fly--; }; // a waiting request takes the slot over
  function staleErr(S, lm) {
    S.dead = true;
    if (files.get(S.url) === S) files.delete(S.url);
    const e = new Error(`${S.host} changed the file while it was being read${lm ? ` (${S.lm}, then ${lm})` : ""}`);
    e.stale = true;
    return e;
  }

  /* bytes [a, a + n) of S's file. short: a block may end at the end of the file. A 200 to a Range request is the whole
     file (6 GB and more here), so it is stopped at once, never downloaded. Sent through util.js's line for the server
     (shared with the app's other requests to it) and asked again when the server is busy; HEAD_MS counts from when it
     is sent, not while it waits in either line. */
  async function get(S, a, n, sig, short, pri) {
    if (S.dead) throw staleErr(S);
    await slot(S, sig, pri);
    const ctrl = new AbortController(), late = () => ctrl.abort(new Error(`${S.host} did not answer in time`)), stop = () => ctrl.abort(stopped(sig));
    let t = 0;
    if (sig) sig.addEventListener("abort", stop, { once: true });
    const cut = r => { if (r.body) r.body.cancel().catch(() => {}); ctrl.abort(); };
    try {
      if (sig && sig.aborted) throw stopped(sig);
      const r = await WG.util.fetchQ(S.url, { headers: { Range: `bytes=${a}-${a + n - 1}` }, signal: ctrl.signal, cache: S.fresh ? "reload" : "default" }, 0, HEAD_MS);
      const len = +(r.headers.get("Content-Length") || 0);
      if (r.status === 200 || (r.status === 206 && len > n)) { cut(r); throw new Error(`${S.host} answered with ${r.status === 200 ? "the whole file" : `${len} bytes`}, not the ${n} bytes asked for`); }
      if (r.status !== 206) { cut(r); throw new Error(`${S.host}: ${r.status} ${r.statusText}`); }
      const lm = r.headers.get("Last-Modified") || "";
      if (S.lm === null) S.lm = lm;
      else if (lm !== S.lm) { cut(r); throw staleErr(S, lm); }
      clearTimeout(t);
      t = setTimeout(late, HEAD_MS + n / 50); // then at least 50 KB a second
      const u = new Uint8Array(await r.arrayBuffer());
      if (u.length !== n && !(short && u.length && u.length < n)) throw new Error(`${S.host} sent ${u.length} bytes, not ${n}`);
      S.requests++; S.bytes += u.length; stats.requests++; stats.bytes += u.length;
      return u;
    } finally {
      clearTimeout(t);
      if (sig) sig.removeEventListener("abort", stop);
      release(S);
    }
  }

  /* metadata: [a, a + n) through 64 KB blocks, missing neighbours in one request. These reads are not stopped by a
     caller's signal, as other reads may wait on the same blocks; they end by their own time limits. */
  async function bytes(S, a, n) {
    if (S.dead) throw staleErr(S);
    for (const e of S.ext) if (a >= e.a && a + n <= e.a + e.n) return (await e.p).subarray(a - e.a, a - e.a + n);
    if (a < 0 || a >= S.eof) fail(`address ${a} is outside the file`);
    const b0 = Math.floor(a / BLOCK), b1 = Math.floor((a + n - 1) / BLOCK);
    for (let k = b0; k <= b1;) {
      if (S.blocks.has(k)) { k++; continue; }
      let m = k;
      while (m < b1 && !S.blocks.has(m + 1)) m++;
      const k0 = k, at = k * BLOCK, p = get(S, at, Math.min((m + 1) * BLOCK, S.eof) - at, null, true);
      for (let q = k; q <= m; q++) {
        const bp = p.then(u => u.subarray((q - k0) * BLOCK, (q - k0 + 1) * BLOCK));
        S.blocks.set(q, bp);
        bp.catch(() => { if (S.blocks.get(q) === bp) S.blocks.delete(q); });
      }
      k = m + 1;
    }
    const parts = [];
    for (let k = b0; k <= b1; k++) parts.push(await S.blocks.get(k));
    let u = parts[0];
    if (parts.length > 1) { u = new Uint8Array(parts.reduce((s, x) => s + x.length, 0)); let o = 0; for (const x of parts) { u.set(x, o); o += x.length; } }
    const off = a - b0 * BLOCK;
    if (u.length < off + n) fail(`read past the end of the file at ${a + n}`);
    return u.subarray(off, off + n);
  }
  // an exact range, for chunk-index nodes deep in the file among the chunks, where a 64 KB block would be mostly chunk data;
  // pri: the priority of the read that first asks for it
  function exact(S, a, n, pri) {
    n = Math.min(n, S.eof - a);
    for (const e of S.ext) if (a >= e.a && a + n <= e.a + e.n) return e.p.then(u => u.subarray(a - e.a, a - e.a + n));
    let cached = true;
    for (let k = Math.floor(a / BLOCK); k <= Math.floor((a + n - 1) / BLOCK); k++) if (!S.blocks.has(k)) cached = false;
    if (cached) return bytes(S, a, n);
    const e = { a, n, p: get(S, a, n, null, false, pri) };
    S.ext.push(e);
    e.p.catch(() => { S.ext = S.ext.filter(x => x !== e); });
    return e.p;
  }

  /* a chunk as stored: one exact range, shared by every read that waits for it and stopped only when all of them have
     stopped; the last 16 MB of chunks are kept, so a cell's latest chunk read for one row is not fetched again for its
     whole series */
  const kept = [];
  let keptBytes = 0;
  function chunkBytes(S, a, n, sig, pri) {
    let c = S.chunks.get(a), cached = true;
    for (let k = Math.floor(a / BLOCK); k <= Math.floor((a + n - 1) / BLOCK); k++) if (!S.blocks.has(k)) cached = false;
    if (!c && cached) return bytes(S, a, n); // a small chunk among the metadata already read (a coordinate's)
    if (!c) {
      c = { users: 0, ctrl: new AbortController(), n };
      c.p = get(S, a, n, c.ctrl.signal, false, pri);
      S.chunks.set(a, c);
      c.p.then(() => {
        kept.push([S, a, c]);
        keptBytes += n;
        while (keptBytes > KEEP && kept.length) { const [S2, a2, c2] = kept.shift(); keptBytes -= c2.n; if (S2.chunks.get(a2) === c2) S2.chunks.delete(a2); }
      }, () => { if (S.chunks.get(a) === c) S.chunks.delete(a); });
    }
    if (!sig) { c.users = Infinity; return c.p; }
    c.users++;
    const off = () => { if (--c.users === 0) c.ctrl.abort(stopped(sig)); };
    if (sig.aborted) off(); else sig.addEventListener("abort", off, { once: true });
    c.p.then(() => sig.removeEventListener("abort", off), () => sig.removeEventListener("abort", off));
    return race(c.p, sig);
  }
  // a caller's signal ends its wait at once, also on metadata that other reads may still be waiting for
  const race = (p, sig) => (!sig ? p : new Promise((res, rej) => {
    const off = () => rej(stopped(sig));
    if (sig.aborted) { off(); return; }
    sig.addEventListener("abort", off, { once: true });
    p.then(v => { sig.removeEventListener("abort", off); res(v); }, e => { sig.removeEventListener("abort", off); rej(e); });
  }));
  // a parsed dataset (d:path) or chunk-index node (t + address) is noted for the layout kept between visits
  const memo = (S, k, f) => {
    if (!S.memo.has(k)) { const p = f(); S.memo.set(k, p); p.then(v => { if (S.keep && (k[0] === "t" || k.startsWith("d:"))) { S.val.set(k, v); S.dirty = true; } }, () => { if (S.memo.get(k) === p) S.memo.delete(k); }); }
    return S.memo.get(k);
  };

  /* ---------- the layout kept between visits ----------
     A file read with o.keep (gridMET's) keeps what was worked out of its metadata, the superblock's sizes, the datasets
     and the chunk-index nodes read, in the app's box in this browser (util.js stash) with the file's Last-Modified. A
     later visit then asks for the chunks at once, not first for the superblock, the headers and the index nodes, which
     are 4 to 6 requests one after another (a second each when the browser's own copy has to be checked). It is trusted
     only as far as the first answer: every byte range must carry that Last-Modified, so a file rewritten since is
     caught at its first request, and the read runs again from the file (withFile), whose new layout is then kept. */
  const LAYOUT = url => `${url}?fg-h5-layout`, LAYOUT_V = 1; // LAYOUT_V: raised when what is kept changes shape, so an older copy is not used
  const restore = S => S.restoring || (S.restoring = WG.util.stashGet(LAYOUT(S.url)).then(x => {
    if (!x || x.v !== LAYOUT_V || !x.lm || !x.sb || !Array.isArray(x.memo) || S.lm !== null || S.dead || S.fresh) return; // a read under way, or one after a rewrite, keeps its own
    Object.assign(S, x.sb);
    S.lm = x.lm;
    S.memo.set("sb", Promise.resolve());
    for (const [k, v] of x.memo) { S.memo.set(k, Promise.resolve(v)); S.val.set(k, v); }
    // its first byte is asked for at once, and F.dataset waits for it: a caller that only looks at the layout (a file's
    // last day) must not take an old version's; F.read's own requests check it as they go
    S.check = get(S, 0, 1, null, true);
    S.check.catch(() => {});
  }));
  function save(S) {
    if (!S.keep || !S.dirty || S.saving || S.dead) return;
    S.saving = setTimeout(() => { // once a few reads have added to it, not after each
      S.saving = 0;
      if (S.dead || !S.lm || S.root === UNDEF) return;
      S.dirty = false;
      const memo = [...S.val].filter(([k, v]) => k[0] === "t" || (v.layout && v.layout.cls !== 0)); // a compact dataset holds its bytes: not kept
      WG.util.stashPut(LAYOUT(S.url), { v: LAYOUT_V, lm: S.lm, sb:{ O: S.O, L: S.L, base: S.base, eof: S.eof, root: S.root }, memo });
    }, 2000);
  }

  /* ---------- a little-endian cursor; O and L are the file's sizes of offsets and lengths ---------- */
  function Cur(u, S) { this.u = u; this.dv = new DataView(u.buffer, u.byteOffset, u.byteLength); this.p = 0; this.O = S ? S.O : 8; this.L = S ? S.L : 8; this.base = S ? S.base : 0; }
  Cur.prototype = {
    u8() { return this.dv.getUint8(this.p++); },
    u16() { const v = this.dv.getUint16(this.p, true); this.p += 2; return v; },
    u32() { const v = this.dv.getUint32(this.p, true); this.p += 4; return v; },
    un(n) { if (this.p + n > this.u.length) fail("truncated metadata"); let v = 0; for (let k = n - 1; k >= 0; k--) v = v * 256 + this.u[this.p + k]; this.p += n; return v; },
    ones(n) { for (let k = 0; k < n; k++) if (this.u[this.p + k] !== 255) return false; return true; },
    addr() { if (this.ones(this.O)) { this.p += this.O; return UNDEF; } return this.un(this.O) + this.base; },
    len() { return this.un(this.L); },
    lim() { if (this.ones(this.L)) { this.p += this.L; return Infinity; } return this.un(this.L); }, // a maximum size: all ones is unlimited
    take(n) { if (this.p + n > this.u.length) fail("truncated metadata"); const v = this.u.subarray(this.p, this.p + n); this.p += n; return v; },
    str(n) { const v = this.take(n), z = v.indexOf(0); return td.decode(z >= 0 ? v.subarray(0, z) : v); },
    sig(s) { const v = String.fromCharCode(...this.take(4)); if (v !== s) fail(`expected ${s}, found ${JSON.stringify(v)}`); },
  };

  /* ---------- superblock ---------- */
  const ready = S => memo(S, "sb", async () => {
    let at = 0, u;
    for (;; at = at ? at * 2 : 512) { // the superblock may follow a user block of 512, 1024 … bytes
      if (at > 32768) fail("no HDF5 signature at the start of the file (not a NetCDF-4 file?)");
      u = await bytes(S, at, 16);
      if (u[0] === 0x89 && u[1] === 0x48 && u[2] === 0x44 && u[3] === 0x46 && u[4] === 13 && u[5] === 10 && u[6] === 26 && u[7] === 10) break;
    }
    const v = u[8];
    if (v === 2 || v === 3) {
      S.O = u[9]; S.L = u[10];
      const c = new Cur(await bytes(S, at, 12 + 4 * S.O), S);
      c.p = 12;
      S.base = c.base = c.un(S.O);
      c.addr(); // superblock extension: its B-tree K values are not needed, as nodes are read by their own counts
      S.eof = c.un(S.O) + S.base;
      S.root = c.addr();
    } else if (v === 0 || v === 1) {
      S.O = u[13]; S.L = u[14];
      const c = new Cur(await bytes(S, at, 24 + (v ? 4 : 0) + 6 * S.O), S);
      c.p = 24 + (v ? 4 : 0);
      S.base = c.base = c.un(S.O);
      c.un(S.O); // free-space info
      S.eof = c.un(S.O) + S.base;
      c.un(S.O); c.un(S.O); // driver information, the root's link name offset
      S.root = c.addr();
    } else fail(`superblock version ${v} is not supported`);
    if (![4, 8].includes(S.O) || ![4, 8].includes(S.L)) fail(`offsets of ${S.O} and lengths of ${S.L} bytes are not supported`);
  });

  /* ---------- object headers: [{ type, flags, data }] over the header and its continuation blocks ---------- */
  const header = (S, a) => memo(S, `h${a}`, async () => {
    if (a === UNDEF) fail("an undefined object header address");
    const msgs = [], conts = [];
    const parse = (u, from, to, v2, crt) => {
      const c = new Cur(u, S);
      c.p = from;
      while (c.p + (v2 ? 4 + (crt ? 2 : 0) : 8) <= to) {
        const type = v2 ? c.u8() : c.u16(), size = c.u16(), flags = c.u8();
        c.p += v2 ? (crt ? 2 : 0) : 3;
        const data = c.take(size);
        if (type === 0x10) { const d = new Cur(data, S); conts.push([d.addr(), d.len()]); }
        else if (type) msgs.push({ type, flags, data });
      }
    };
    let u = await bytes(S, a, 16);
    if (u[0] === 0x4f && u[1] === 0x48 && u[2] === 0x44 && u[3] === 0x52) { // "OHDR": version 2
      const c = new Cur(u, S);
      c.p = 4;
      if (c.u8() !== 2) fail(`object header version at ${a}`);
      const fl = c.u8();
      if (fl & 0x20) c.p += 16; // access, modification, change and birth times
      if (fl & 0x10) c.p += 4; // attribute storage phase change values
      const n = c.un(1 << (fl & 3)), h = c.p;
      u = await bytes(S, a, h + n);
      parse(u, h, h + n, true, fl & 4);
      for (let k = 0; k < conts.length; k++) {
        const [ca, cn] = conts[k], cu = await bytes(S, ca, cn), cc = new Cur(cu, S);
        cc.sig("OCHK");
        parse(cu, 4, cn - 4, true, fl & 4);
      }
    } else if (u[0] === 1) {
      const n = new Cur(u, S);
      n.p = 8;
      const size = n.u32();
      u = await bytes(S, a, 16 + size);
      parse(u, 16, 16 + size, false);
      for (let k = 0; k < conts.length; k++) { const [ca, cn] = conts[k]; parse(await bytes(S, ca, cn), 0, cn, false); }
    } else fail(`no object header at ${a}`);
    return msgs;
  });
  // a message kept in another object's header (a committed datatype): that header's message of the same type
  async function unshare(S, m) {
    if (!(m.flags & 2)) return m.data;
    const c = new Cur(m.data, S), v = c.u8(), kind = c.u8();
    if (v === 1) c.p += 6;
    if (v === 3 && kind === 1) fail("messages in the shared-message heap are not supported");
    const x = (await header(S, c.addr())).find(y => y.type === m.type);
    if (!x) fail(`shared message ${m.type} not found`);
    return x.data;
  }

  /* ---------- fractal heaps (dense attributes and links) ---------- */
  const fheap = (S, a) => memo(S, `fh${a}`, async () => {
    const O = S.O, c = new Cur(await bytes(S, a, 26 + 12 * S.L + 3 * O), S);
    c.sig("FRHP");
    c.u8();
    const idLen = c.u16(), io = c.u16();
    c.u8();
    const maxMan = c.u32();
    c.len(); c.addr(); c.len(); c.addr(); // huge objects, free space
    for (let k = 0; k < 8; k++) c.len(); // managed and allocated space, iterator, object counts and sizes
    const W = c.u16(), S0 = c.len(), MX = c.len(), maxBits = c.u16();
    c.u16();
    const root = c.addr(), rows = c.u16();
    if (io) fail("filtered fractal heaps are not supported");
    const lg = x => Math.round(Math.log2(x)), offB = Math.ceil(maxBits / 8), lenB = Math.min(Math.ceil(lg(MX) / 8), enc(maxMan)), dirRows = lg(MX) - lg(S0) + 2;
    const rowSize = r => S0 * 2 ** Math.max(0, r - 1);
    // the direct block that holds heap offset off, and that block's own offset: down the doubling tables of indirect blocks
    async function locate(off) {
      if (!rows) return [root, 0];
      let ba = root, n = rows, base = 0;
      for (;;) {
        const hd = 5 + O + offB, nd = Math.min(n, dirRows) * W, ni = Math.max(0, n - dirRows) * W, b = new Cur(await bytes(S, ba, hd + (nd + ni) * O), S);
        b.sig("FHIB");
        b.p = hd;
        const ent = [];
        for (let k = 0; k < nd + ni; k++) ent.push(b.addr());
        let pos = base, hit = null;
        for (let r = 0; r < n && !hit; r++) for (let k = 0; k < W; k++) { const sz = rowSize(r); if (off < pos + sz) { hit = [r, k, pos, sz]; break; } pos += sz; }
        if (!hit) fail(`fractal heap offset ${off} out of range`);
        const [r, k, p0, sz] = hit;
        if (r < dirRows) return [ent[r * W + k], p0];
        ba = ent[nd + (r - dirRows) * W + k];
        n = lg(sz) - lg(S0 * W) + 1;
        base = p0;
      }
    }
    return {
      get: async id => {
        const b = id[0], kind = (b >> 4) & 3;
        if (b >> 6) fail("fractal heap ID version");
        if (kind === 2) return idLen <= 18 ? id.subarray(1, 2 + (b & 15)) : id.subarray(2, 3 + (((b & 15) << 8) | id[1])); // tiny: inside the ID
        if (kind !== 0) fail("huge objects in a fractal heap are not supported");
        const c = new Cur(id, S);
        c.p = 1;
        const off = c.un(offB), n = c.un(lenB), [ba, b0] = await locate(off);
        if (ba === UNDEF) fail("fractal heap block not allocated");
        return bytes(S, ba + off - b0, n);
      },
    };
  });

  /* ---------- v2 B-trees: every record, in order ---------- */
  const btree2 = (S, a) => memo(S, `b2${a}`, async () => {
    const O = S.O, c = new Cur(await bytes(S, a, 16 + O + 2 + S.L + 4), S);
    c.sig("BTHD");
    c.u8(); c.u8();
    const size = c.u32(), rs = c.u16(), depth = c.u16();
    c.p += 2;
    const root = c.addr(), nroot = c.u16();
    // the sizes of the record counts kept with each child pointer (H5B2__hdr_init)
    const leafMax = Math.floor((size - 10) / rs), nB = enc(leafMax), cum = [leafMax], cumB = [0];
    for (let d = 1; d <= depth; d++) {
      const ps = O + nB + (d > 1 ? cumB[d - 1] : 0), mx = Math.floor((size - 10 - ps) / (rs + ps));
      cum[d] = (mx + 1) * cum[d - 1] + mx;
      cumB[d] = enc(cum[d]);
    }
    const out = [];
    const walk = async (na, n, d) => {
      if (na === UNDEF) return;
      const b = new Cur(await bytes(S, na, size), S);
      b.sig(d ? "BTIN" : "BTLF");
      b.p = 6;
      const recs = [];
      for (let k = 0; k < n; k++) recs.push(b.take(rs));
      if (!d) { out.push(...recs); return; }
      const kids = [];
      for (let k = 0; k <= n; k++) { const ca = b.addr(), cn = b.un(nB); if (d > 1) b.un(cumB[d - 1]); kids.push([ca, cn]); }
      for (let k = 0; k <= n; k++) { await walk(kids[k][0], kids[k][1], d - 1); if (k < n) out.push(recs[k]); }
    };
    if (nroot) await walk(root, nroot, depth);
    return out;
  });

  /* ---------- groups: name -> object header address (hard links only) ---------- */
  function link(u, S, out) {
    const c = new Cur(u, S);
    if (c.u8() !== 1) fail("link message version");
    const fl = c.u8(), type = fl & 8 ? c.u8() : 0;
    if (fl & 4) c.p += 8;
    if (fl & 16) c.p += 1;
    const name = td.decode(c.take(c.un(1 << (fl & 3))));
    if (type === 0) out.set(name, c.addr());
  }
  // an old-style group: a v1 B-tree of symbol-table nodes, the names in a local heap
  async function symbols(S, bt, lh, out) {
    const h = new Cur(await bytes(S, lh, 8 + 2 * S.L + S.O), S);
    h.sig("HEAP");
    h.p = 8;
    const dsize = h.len();
    h.len();
    const names = await bytes(S, h.addr(), dsize), hd = 8 + 2 * S.O;
    const walk = async a => {
      const n0 = new Cur(await bytes(S, a, hd), S);
      n0.sig("TREE");
      if (n0.u8() !== 0) fail("group B-tree node type");
      const level = n0.u8(), n = n0.u16(), c = new Cur(await bytes(S, a, hd + n * (S.L + S.O) + S.L), S), kids = [];
      c.p = hd;
      for (let k = 0; k < n; k++) { c.len(); kids.push(c.addr()); }
      for (const k of kids) {
        if (level) { await walk(k); continue; }
        const s0 = new Cur(await bytes(S, k, 8), S);
        s0.sig("SNOD");
        s0.p = 6;
        const ns = s0.u16(), s = new Cur(await bytes(S, k, 8 + ns * (2 * S.O + 24)), S);
        s.p = 8;
        for (let e = 0; e < ns; e++) { const no = s.un(S.O), oa = s.addr(), z = names.indexOf(0, no); s.p += 24; out.set(td.decode(names.subarray(no, z < 0 ? names.length : z)), oa); }
      }
    };
    if (bt !== UNDEF) await walk(bt);
  }
  const links = (S, a) => memo(S, `l${a}`, async () => {
    const msgs = await header(S, a), out = new Map();
    for (const m of msgs) if (m.type === 6) link(m.data, S, out);
    const info = msgs.find(m => m.type === 2), st = msgs.find(m => m.type === 0x11);
    if (info) {
      const c = new Cur(info.data, S);
      c.u8();
      if (c.u8() & 1) c.p += 8;
      const heap = c.addr(), names = c.addr();
      if (heap !== UNDEF) { const H = await fheap(S, heap); for (const r of await btree2(S, names)) link(await H.get(r.subarray(4)), S, out); }
    }
    if (st) { const c = new Cur(st.data, S), bt = c.addr(); await symbols(S, bt, c.addr(), out); }
    return out;
  });
  async function resolve(S, path) {
    await ready(S);
    let a = S.root;
    for (const name of path.split("/").filter(Boolean)) {
      const L = await links(S, a);
      if (!L.has(name)) fail(`no ${name} in the file (it holds ${[...L.keys()].join(", ")})`);
      a = L.get(name);
    }
    return a;
  }

  /* ---------- messages ---------- */
  function dataspace(u, S) {
    const c = new Cur(u, S), v = c.u8(), r = c.u8(), fl = c.u8();
    let kind = r ? 1 : 0;
    if (v === 1) c.p += 5;
    else if (v === 2) kind = c.u8();
    else fail(`dataspace version ${v}`);
    const dims = [], max = [];
    for (let k = 0; k < r; k++) dims.push(c.len());
    if (fl & 1) for (let k = 0; k < r; k++) max.push(c.lim());
    return { dims, max: max.length ? max : dims.slice(), n: kind === 2 ? 0 : prod(dims) };
  }
  function dtype(u) {
    const c = new Cur(u), b = c.u8(), bits = c.u8() | (c.u8() << 8) | (c.u8() << 16), t = { cls: b & 15, size: c.u32(), be: !!(bits & 1) };
    if (t.cls === 0) t.signed = !!(bits & 8);
    if (t.cls === 1 && (bits & 0x40)) t.vax = true;
    return t;
  }
  // a reader of one value: fixed-point (signed or not) of 1, 2, 4 or 8 bytes, IEEE floating point of 4 or 8, either byte order
  function getter(t) {
    const le = !t.be;
    if (t.cls === 1 && !t.vax) { if (t.size === 4) return (dv, o) => dv.getFloat32(o, le); if (t.size === 8) return (dv, o) => dv.getFloat64(o, le); }
    if (t.cls === 0) {
      if (t.size === 1) return t.signed ? (dv, o) => dv.getInt8(o) : (dv, o) => dv.getUint8(o);
      if (t.size === 2) return t.signed ? (dv, o) => dv.getInt16(o, le) : (dv, o) => dv.getUint16(o, le);
      if (t.size === 4) return t.signed ? (dv, o) => dv.getInt32(o, le) : (dv, o) => dv.getUint32(o, le);
      if (t.size === 8) return t.signed ? (dv, o) => Number(dv.getBigInt64(o, le)) : (dv, o) => Number(dv.getBigUint64(o, le));
    }
    return null;
  }
  function fillValue(m5, m4, t) {
    let v = null;
    if (m5) {
      const c = new Cur(m5.data), ver = c.u8();
      if (ver === 3) { if (c.u8() & 0x20) v = c.take(c.u32()); }
      else { c.p += 2; const def = c.u8(); if (ver === 1 || def) { const n = c.u32(); if (n) v = c.take(n); } }
    } else if (m4) { const c = new Cur(m4.data), n = c.u32(); if (n) v = c.take(n); }
    const g = getter(t);
    return v && g && v.length >= t.size ? g(new DataView(v.buffer, v.byteOffset, v.length), 0) : 0;
  }
  function layout(u, S) {
    const c = new Cur(u, S), v = c.u8();
    if (v < 3) {
      const nd = c.u8(), cls = c.u8();
      c.p += 5;
      const a = cls ? c.addr() : UNDEF, dims = [];
      for (let k = 0; k < nd; k++) dims.push(c.u32());
      if (cls === 0) return { cls, data: c.take(c.u32()) };
      return cls === 1 ? { cls, addr: a } : { cls, addr: a, index: "btree1", chunk: dims };
    }
    const cls = c.u8();
    if (cls === 0) return { cls, data: c.take(c.u16()) };
    if (cls === 1) return { cls, addr: c.addr() };
    if (cls !== 2) fail(`layout class ${cls} (virtual datasets) is not supported`);
    if (v === 3) { const nd = c.u8(), a = c.addr(), dims = []; for (let k = 0; k < nd; k++) dims.push(c.u32()); return { cls, addr: a, index: "btree1", chunk: dims }; }
    const fl = c.u8(), nd = c.u8(), w = c.u8(), dims = [];
    for (let k = 0; k < nd; k++) dims.push(c.un(w));
    const it = c.u8(), out = { cls, chunk: dims, index: ["", "single", "implicit", "fixed array", "extensible array", "v2 B-tree"][it] || `type ${it}` };
    if (it === 1 && (fl & 2)) { out.fsize = c.len(); out.fmask = c.u32(); }
    else if (it === 3) c.p += 1;
    else if (it === 4) c.p += 5;
    else if (it === 5) c.p += 6;
    out.addr = c.addr();
    return out;
  }
  function filters(u) {
    const c = new Cur(u), v = c.u8(), n = c.u8(), out = [];
    if (v === 1) c.p += 6;
    for (let k = 0; k < n; k++) {
      const id = c.u16(), nl = v === 1 || id >= 256 ? c.u16() : 0, fl = c.u16(), nv = c.u16(), name = nl ? c.str(nl) : "", cd = [];
      for (let q = 0; q < nv; q++) cd.push(c.u32());
      if (v === 1 && nv % 2) c.p += 4;
      out.push({ id, name, cd, optional: !!(fl & 1) });
    }
    return out;
  }
  function value(t, sp, u) {
    if (!sp.n) return null;
    const dv = new DataView(u.buffer, u.byteOffset, u.byteLength), g = getter(t), vals = [];
    if (t.cls === 3) for (let k = 0; k < sp.n; k++) { const s = u.subarray(k * t.size, (k + 1) * t.size), z = s.indexOf(0); vals.push(td.decode(z < 0 ? s : s.subarray(0, z)).replace(/ +$/, "")); }
    else if (g) for (let k = 0; k < sp.n && (k + 1) * t.size <= u.length; k++) { const x = g(dv, k * t.size); vals.push(t.cls === 1 && t.size === 4 ? short32(x) : x); }
    else return null; // variable-length strings and compound types are not read
    return vals.length === 1 ? vals[0] : vals;
  }
  function attr(u, S, out) {
    const c = new Cur(u, S), v = c.u8(), fl = c.u8(), nn = c.u16(), nt = c.u16(), ns = c.u16(), pad = n => (v === 1 ? ((n + 7) & ~7) - n : 0);
    if (v === 3) c.p += 1;
    const name = c.str(nn);
    c.p += pad(nn);
    const tu = c.take(nt);
    c.p += pad(nt);
    const su = c.take(ns);
    c.p += pad(ns);
    out[name] = fl & 3 ? null : value(dtype(tu), dataspace(su, S), u.subarray(c.p)); // a shared type or space is not read
  }
  // compact attributes in the header, then dense ones: the fractal heap of attribute messages, by its v2 B-tree of names
  async function attributes(S, msgs) {
    const out = {};
    for (const m of msgs) if (m.type === 12) attr(m.data, S, out);
    const info = msgs.find(m => m.type === 21);
    if (info) {
      const c = new Cur(info.data, S);
      c.u8();
      if (c.u8() & 1) c.p += 2;
      const heap = c.addr(), names = c.addr();
      if (heap !== UNDEF) { const H = await fheap(S, heap); for (const r of await btree2(S, names)) attr(await H.get(r.subarray(0, 8)), S, out); }
    }
    return out;
  }
  const dataset = (S, path) => memo(S, `d:${path}`, async () => {
    const a = await resolve(S, path), msgs = await header(S, a), m = t => msgs.find(x => x.type === t);
    if (!m(1) || !m(3) || !m(8)) fail(`${path} is not a dataset`);
    const sp = dataspace(m(1).data, S), type = dtype(await unshare(S, m(3))), lay = layout(m(8).data, S);
    const ds = { path, shape: sp.dims, maxShape: sp.max, rank: sp.dims.length, type, layout: lay, filters: m(11) ? filters(m(11).data) : [], fill: fillValue(m(5), m(4), type), attrs: await attributes(S, msgs) };
    if (lay.chunk) ds.chunk = lay.chunk.slice(0, ds.rank);
    return ds;
  });

  /* ---------- chunks ---------- */
  /* the stored chunks among want (chunk offsets in elements) by the v1 B-tree: child k of a node holds the chunks from
     key k up to, not including, key k + 1, so only the branches that can hold a wanted chunk are read */
  async function btree1(S, ds, want, pri) {
    const r = ds.rank, ks = 8 + 8 * (r + 1), hd = 8 + 2 * S.O, found = new Map();
    const cmp = (x, y) => { for (let d = 0; d < r; d++) if (x[d] !== y[d]) return x[d] - y[d]; return 0; };
    const node = a => memo(S, `t${a}`, async () => {
      let u = await exact(S, a, hd + 64 * (ks + S.O) + ks, pri); // room for 64 entries (HDF5's default K of 32); more are read when present
      const n = new Cur(u, S);
      n.sig("TREE");
      if (n.u8() !== 1) fail("chunk B-tree node type");
      const level = n.u8(), e = n.u16(), need = hd + e * (ks + S.O) + ks;
      if (u.length < need) u = await exact(S, a, need, pri);
      const c = new Cur(u, S), keys = [], kids = [];
      c.p = hd;
      for (let k = 0; k <= e; k++) {
        const size = c.u32(), mask = c.u32(), off = [];
        for (let d = 0; d < r; d++) off.push(c.un(8));
        c.p += 8;
        keys.push({ size, mask, off });
        if (k < e) kids.push(c.addr());
      }
      return { level, keys, kids };
    });
    const walk = async (a, ts) => {
      const N = await node(a);
      await Promise.all(N.kids.map((ka, k) => [ka, k]).reverse().map(async ([ka, k]) => { // newest first, as the chunks
        const lo = N.keys[k].off, hi = N.keys[k + 1].off;
        if (!N.level) { const t = ts.find(x => !cmp(x, lo)); if (t) found.set(t.join(), { addr: ka, size: N.keys[k].size, mask: N.keys[k].mask }); return; }
        const sub = ts.filter(x => cmp(x, lo) >= 0 && cmp(x, hi) < 0);
        if (sub.length) await walk(ka, sub);
      }));
    };
    if (ds.layout.addr !== UNDEF) await walk(ds.layout.addr, want);
    return found;
  }
  async function chunksAt(S, ds, want, pri) {
    const L = ds.layout, csize = prod(ds.chunk) * ds.type.size, found = new Map();
    if (L.index === "btree1") return btree1(S, ds, want, pri);
    if (L.index === "single") { if (L.addr !== UNDEF) found.set(ds.chunk.map(() => 0).join(), { addr: L.addr, size: L.fsize || csize, mask: L.fmask || 0 }); return found; }
    if (L.index === "implicit") { // every chunk allocated, unfiltered, in row-major order of chunks
      const nc = ds.shape.map((s, d) => Math.ceil(s / ds.chunk[d])), st = strides(nc);
      if (L.addr !== UNDEF) for (const o of want) found.set(o.join(), { addr: L.addr + o.reduce((s, x, d) => s + (x / ds.chunk[d]) * st[d], 0) * csize, size: csize, mask: 0 });
      return found;
    }
    fail(`${ds.path}: the ${L.index} chunk index is not supported (a v1 B-tree, single chunk or implicit index is)`);
  }
  const inflate = async u => {
    if (typeof DecompressionStream === "undefined") fail("this browser cannot inflate deflate data (no DecompressionStream)");
    return new Uint8Array(await new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer());
  };
  const unshuffle = (u, size) => {
    const n = Math.floor(u.length / size), out = new Uint8Array(u.length);
    for (let b = 0; b < size; b++) for (let k = 0; k < n; k++) out[k * size + b] = u[b * n + k];
    out.set(u.subarray(n * size), n * size);
    return out;
  };
  async function unfilter(u, ds, mask) {
    for (let k = ds.filters.length - 1; k >= 0; k--) {
      if (mask & (1 << k)) continue; // this filter was skipped for this chunk
      const f = ds.filters[k];
      if (f.id === 1) u = await inflate(u);
      else if (f.id === 2) u = unshuffle(u, f.cd[0] || ds.type.size);
      else if (f.id === 3) u = u.subarray(0, u.length - 4); // Fletcher-32: its checksum is dropped, not checked
      else fail(`${ds.path}: filter ${f.id}${f.name ? ` (${f.name})` : ""} is not supported (deflate, shuffle and Fletcher-32 are)`);
    }
    return u;
  }

  /* ---------- reads: the raw values of a hyperslab, row-major, as numbers; never-written chunks are the fill value ---------- */
  async function read(S, ds, start, count, sig, pri) {
    if (!ds.rank) { ds = { ...ds, rank: 1, shape: [1] }; start = [0]; count = [1]; }
    const r = ds.rank, n = prod(count), g = getter(ds.type), size = ds.type.size, L = ds.layout, last = r - 1, os = strides(count);
    if (!g) fail(`${ds.path}: values of type class ${ds.type.cls} and ${size} bytes are not read`);
    if (start.length !== r || count.length !== r) fail(`${ds.path}: a selection of ${r} dimensions is needed`);
    for (let d = 0; d < r; d++) if (start[d] < 0 || count[d] < 0 || start[d] + count[d] > ds.shape[d]) fail(`${ds.path}: selection outside ${ds.shape.join(" × ")}`);
    const out = new Float64Array(n).fill(ds.fill);
    if (!n) return out;
    // the selection's part of a box of values u, held from offset o with dims bd
    const copy = (u, o, bd) => {
      const dv = new DataView(u.buffer, u.byteOffset, u.byteLength), cs = strides(bd), lo = [], hi = [];
      for (let d = 0; d < r; d++) { lo[d] = Math.max(start[d], o[d]); hi[d] = Math.min(start[d] + count[d], o[d] + bd[d]); if (lo[d] >= hi[d]) return; }
      const x = lo.slice();
      for (;;) {
        let ci = 0, oi = 0;
        for (let d = 0; d < last; d++) { ci += (x[d] - o[d]) * cs[d]; oi += (x[d] - start[d]) * os[d]; }
        for (let k = lo[last]; k < hi[last]; k++) out[oi + k - start[last]] = g(dv, (ci + k - o[last]) * size);
        let d = last - 1;
        while (d >= 0 && ++x[d] === hi[d]) { x[d] = lo[d]; d--; }
        if (d < 0) return;
      }
    };
    if (L.cls === 0) { copy(L.data, ds.shape.map(() => 0), ds.shape); return out; }
    if (L.cls === 1) {
      if (L.addr === UNDEF) return out;
      // runs along the last dimension, those less than a block apart fetched as one range
      const ss = strides(ds.shape), groups = [], x = start.slice();
      let G = null;
      for (;;) {
        let e = start[last], oi = 0;
        for (let d = 0; d < last; d++) { e += x[d] * ss[d]; oi += (x[d] - start[d]) * os[d]; }
        if (G && (e - G.b) * size < BLOCK) { G.runs.push([e, oi]); G.b = e + count[last]; } else groups.push(G = { a: e, b: e + count[last], runs: [[e, oi]] });
        let d = last - 1;
        while (d >= 0 && ++x[d] === start[d] + count[d]) { x[d] = start[d]; d--; }
        if (d < 0) break;
      }
      await Promise.all(groups.map(async G => {
        const u = await get(S, L.addr + G.a * size, (G.b - G.a) * size, sig, false, pri), dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
        for (const [e, oi] of G.runs) for (let k = 0; k < count[last]; k++) out[oi + k] = g(dv, (e - G.a + k) * size);
      }));
      return out;
    }
    // chunked: every chunk the selection touches, found in the index, fetched whole and inflated
    const cd = ds.chunk, lo = start.map((s, d) => Math.floor(s / cd[d])), hi = start.map((s, d) => Math.floor((s + count[d] - 1) / cd[d])), want = [], x = lo.slice();
    for (;;) {
      want.push(x.map((v, d) => v * cd[d]));
      let d = last;
      while (d >= 0 && ++x[d] > hi[d]) { x[d] = lo[d]; d--; }
      if (d < 0) break;
    }
    const at = await chunksAt(S, ds, want, pri), csize = prod(cd) * size;
    // asked newest first: a series' last chunk is also what a read of its latest values waits for
    await Promise.all(want.slice().reverse().map(async o => {
      const c = at.get(o.join());
      if (!c) return;
      const u = await unfilter(await chunkBytes(S, c.addr, c.size, sig, pri), ds, c.mask);
      if (u.length < csize) fail(`${ds.path}: a chunk of ${u.length} bytes, not ${csize}`);
      copy(u, o, cd);
    }));
    return out;
  }

  /* ---------- the file ---------- */
  function state(url, fresh) {
    let S = files.get(url);
    if (!S || S.dead || (fresh && !S.fresh)) {
      S = { url, host: new URL(url, location.href).host, fresh: !!fresh, lm: null, dead: false, eof: Infinity, O: 8, L: 8, base: 0, root: UNDEF,
        blocks: new Map(), ext: [], memo: new Map(), chunks: new Map(), requests: 0, bytes: 0, pri: 0, keep: false, val: new Map(), dirty: false, saving: 0, restoring: null, check: null };
      files.set(url, S);
    }
    return S;
  }
  /* fn(F) reads the file at url through F: F.dataset(path) gives { shape, chunk, type, attrs, fill, … } and F.read(ds,
     start, count) the raw values of a hyperslab (a Float64Array, row-major). When the file changes on the server while it
     is read, its cache is dropped and fn runs again once on the new version (bypassing the browser's cache). o.signal
     stops the chunk fetches; o.pri (1, 2 …) puts this read's chunks, and the file's metadata, ahead of the requests of
     lower priority waiting for the same server; o.keep keeps its layout in this browser for later visits (a file that
     is rewritten in place, not one a day under a new name). */
  async function withFile(url, fn, o = {}) {
    for (let k = 0; ; k++) {
      const S = state(url, k > 0), sig = o.signal;
      if (o.pri > S.pri) S.pri = o.pri;
      if (o.keep) { S.keep = true; if (!k) await restore(S); } // not after a rewrite was met: what is kept is the old version's
      const F = { url, get lastModified() { return S.lm; }, get requests() { return S.requests; }, get bytes() { return S.bytes; },
        dataset: path => race(S.check ? S.check.then(() => dataset(S, path)) : dataset(S, path), sig), read: (ds, start, count) => race(read(S, ds, start, count, sig, o.pri || 0), sig) };
      try { const v = await fn(F); save(S); return v; }
      catch (e) { if (!e.stale || k) throw e; console.warn(`${url}: ${e.message}; read again`); }
    }
  }

  // what was read, per file version, for the console: requests and bytes
  const info = () => [...files.values()].map(S => ({ url: S.url, lastModified: S.lm, requests: S.requests, bytes: S.bytes }));
  return { withFile, stats, info };
})();
