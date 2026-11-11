/* Downloads: figures at a chosen size and DPI (PNG, TIFF, JPEG, SVG), tables as CSV, and zip bundles.
   Charts are re-drawn off-screen at the requested size, so text and lines keep their on-screen proportions:
   a 6.5 in wide figure at 300 dpi is drawn on a 1950 px canvas with every font and line scaled by 300/96. */
WG.export = (function () {
  /* ---------- small binary helpers ---------- */
  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes, start = 0, end = bytes.length) {
    let c = 0xffffffff;
    for (let i = start; i < end; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  const u32be = (a, o, v) => { a[o] = v >>> 24; a[o + 1] = (v >>> 16) & 255; a[o + 2] = (v >>> 8) & 255; a[o + 3] = v & 255; };
  const r32be = (a, o) => ((a[o] << 24) | (a[o + 1] << 16) | (a[o + 2] << 8) | a[o + 3]) >>> 0;

  /* PNG: insert (or replace) a pHYs chunk right after IHDR, in pixels per metre. */
  function pngSetDpi(png, dpi) {
    const ppm = Math.round(dpi / 0.0254);
    const out = [png.subarray(0, 33)]; // signature (8) + IHDR chunk (4 + 4 + 13 + 4)
    const phys = new Uint8Array(21);
    u32be(phys, 0, 9);
    phys.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
    u32be(phys, 8, ppm); u32be(phys, 12, ppm); phys[16] = 1; // unit: metre
    u32be(phys, 17, crc32(phys, 4, 17));
    out.push(phys);
    for (let o = 33; o < png.length;) {
      const len = r32be(png, o), type = String.fromCharCode(png[o + 4], png[o + 5], png[o + 6], png[o + 7]);
      if (type !== "pHYs") out.push(png.subarray(o, o + 12 + len));
      o += 12 + len;
    }
    return concat(out);
  }

  /* JPEG: set the JFIF density to dpi (inserting a JFIF APP0 segment if the encoder wrote none). */
  function jpegSetDpi(jpg, dpi) {
    const d = Math.min(65535, Math.round(dpi));
    if (jpg[2] === 0xff && jpg[3] === 0xe0 && String.fromCharCode(...jpg.subarray(6, 10)) === "JFIF") {
      const out = jpg.slice();
      out[13] = 1; out[14] = d >> 8; out[15] = d & 255; out[16] = d >> 8; out[17] = d & 255;
      return out;
    }
    const app0 = new Uint8Array([0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 1, d >> 8, d & 255, d >> 8, d & 255, 0, 0]);
    return concat([jpg.subarray(0, 2), app0, jpg.subarray(2)]);
  }

  /* TIFF (baseline, little-endian): 8-bit RGB, PackBits-compressed strips, resolution in dots per inch. */
  function tiffEncode(rgba, w, h, dpi) {
    const rowsPerStrip = Math.max(1, Math.floor(65536 / (w * 3)));
    const strips = [];
    const row = new Uint8Array(w * 3);
    for (let y0 = 0; y0 < h; y0 += rowsPerStrip) {
      const parts = [];
      for (let y = y0; y < Math.min(h, y0 + rowsPerStrip); y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4, a = rgba[i + 3] / 255; // flatten on white
          row[x * 3] = Math.round(rgba[i] * a + 255 * (1 - a));
          row[x * 3 + 1] = Math.round(rgba[i + 1] * a + 255 * (1 - a));
          row[x * 3 + 2] = Math.round(rgba[i + 2] * a + 255 * (1 - a));
        }
        parts.push(packBits(row)); // PackBits runs never cross a row
      }
      strips.push(concat(parts));
    }
    const nTags = 13, ifdSize = 2 + nTags * 12 + 4;
    const extra = 6 /* BitsPerSample */ + 16 /* two RATIONALs */ + strips.length * 8;
    let dataOff = 8 + ifdSize + extra;
    const total = dataOff + strips.reduce((a, s) => a + s.length, 0);
    const buf = new Uint8Array(total), dv = new DataView(buf.buffer);
    buf.set([0x49, 0x49, 42, 0]); dv.setUint32(4, 8, true);
    let p = 8;
    dv.setUint16(p, nTags, true); p += 2;
    const bpsOff = 8 + ifdSize, xresOff = bpsOff + 6, yresOff = xresOff + 8, offsOff = yresOff + 8, cntOff = offsOff + strips.length * 4;
    const tag = (id, type, count, value) => {
      dv.setUint16(p, id, true); dv.setUint16(p + 2, type, true); dv.setUint32(p + 4, count, true);
      if (type === 3 && count === 1) dv.setUint16(p + 8, value, true); else dv.setUint32(p + 8, value, true);
      p += 12;
    };
    const one = strips.length === 1;
    tag(256, 4, 1, w); // ImageWidth
    tag(257, 4, 1, h); // ImageLength
    tag(258, 3, 3, bpsOff); // BitsPerSample 8,8,8
    tag(259, 3, 1, 32773); // Compression: PackBits
    tag(262, 3, 1, 2); // Photometric: RGB
    tag(273, 4, strips.length, one ? dataOff : offsOff); // StripOffsets
    tag(277, 3, 1, 3); // SamplesPerPixel
    tag(278, 4, 1, rowsPerStrip); // RowsPerStrip
    tag(279, 4, strips.length, one ? strips[0].length : cntOff); // StripByteCounts
    tag(282, 5, 1, xresOff); // XResolution
    tag(283, 5, 1, yresOff); // YResolution
    tag(284, 3, 1, 1); // PlanarConfiguration: chunky
    tag(296, 3, 1, 2); // ResolutionUnit: inch
    dv.setUint32(p, 0, true);
    [8, 8, 8].forEach((v, i) => dv.setUint16(bpsOff + i * 2, v, true));
    const r = Math.round(dpi * 1000);
    dv.setUint32(xresOff, r, true); dv.setUint32(xresOff + 4, 1000, true);
    dv.setUint32(yresOff, r, true); dv.setUint32(yresOff + 4, 1000, true);
    strips.forEach((s, i) => {
      dv.setUint32(offsOff + i * 4, dataOff, true);
      dv.setUint32(cntOff + i * 4, s.length, true);
      buf.set(s, dataOff);
      dataOff += s.length;
    });
    return buf;
  }
  function packBits(src) {
    const out = [];
    let i = 0;
    while (i < src.length) {
      let run = 1;
      while (i + run < src.length && run < 128 && src[i + run] === src[i]) run++;
      if (run > 1) { out.push(257 - run, src[i]); i += run; continue; }
      let j = i + 1;
      while (j < src.length && j - i < 128 && !(j + 1 < src.length && src[j] === src[j + 1])) j++;
      out.push(j - i - 1);
      for (let k = i; k < j; k++) out.push(src[k]);
      i = j;
    }
    return Uint8Array.from(out);
  }
  function concat(parts) {
    const out = new Uint8Array(parts.reduce((a, b) => a + b.length, 0));
    let o = 0;
    for (const b of parts) { out.set(b, o); o += b.length; }
    return out;
  }

  /* ---------- CSV ---------- */
  const cell = v => {
    if (v === null || v === undefined || (typeof v === "number" && !Number.isFinite(v))) return "";
    const s = String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  /* header: column names (units in brackets); rows: arrays. A BOM lets Excel read "°C" and "m³" correctly. */
  const csv = (header, rows) => "﻿" + [header, ...rows].map(r => r.map(cell).join(",")).join("\r\n") + "\r\n";

  /* ---------- saving ---------- */
  function save(data, filename, type) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: type || "application/octet-stream" });
    const url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = filename; a.rel = "noopener";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  /* a file-name-safe form of s (accents dropped, other characters to _), at most max characters */
  const slug = (s, max = Infinity) => String(s).normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\w.-]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").slice(0, max).replace(/_$/, "");

  return { crc32, pngSetDpi, jpegSetDpi, tiffEncode, packBits, csv, save, slug, concat };
})();
