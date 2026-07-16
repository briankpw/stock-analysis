#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Generate placeholder PWA icons in public/icons/.
// -----------------------------------------------------------------------------
// We deliberately avoid heavy image libraries (sharp/canvas) so this script
// can run in any Node.js environment without native builds. Instead we
// hand-write a minimal RGBA PNG using zlib.
//
// Design: a rounded-square with a gradient background and a stylised "K"
// letter carved out in white. Same aesthetic as the app header. Nothing
// fancy \u2014 the design is just a placeholder until a designer takes over.
// -----------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const OUT = path.resolve("public/icons");
fs.mkdirSync(OUT, { recursive: true });

function hsvToRgb(h, s, v) {
  h /= 360;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const [r, g, b] = [
    [v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q],
  ][i % 6];
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

/** Draw one icon into an RGBA buffer at the given size. */
function draw(size) {
  const buf = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.22;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;

      // Rounded-square mask (with anti-aliased edge).
      const dx = Math.max(Math.abs(x - cx) - (cx - radius), 0);
      const dy = Math.max(Math.abs(y - cy) - (cy - radius), 0);
      const d = Math.sqrt(dx * dx + dy * dy) - radius;
      if (d > 1) {
        buf[idx + 3] = 0;
        continue;
      }
      const alpha = d < 0 ? 255 : Math.max(0, Math.round((1 - d) * 255));

      // Diagonal gradient: hue rotates from indigo (246) to teal (200) to
      // magenta (320) top-left \u2192 bottom-right.
      const t = (x + y) / (2 * size);
      const hue = 246 + (t - 0.5) * 90;
      const [r, g, b] = hsvToRgb(hue, 0.85, 0.85);
      buf[idx]     = r;
      buf[idx + 1] = g;
      buf[idx + 2] = b;
      buf[idx + 3] = alpha;
    }
  }

  // Stylised "K": two diagonal strokes + a vertical.
  const strokeW = size * 0.10;
  const midX = cx - size * 0.02;
  const topY = size * 0.24;
  const botY = size * 0.76;

  function paintPixel(x, y, r, g, b, a = 255) {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const idx = (Math.floor(y) * size + Math.floor(x)) * 4;
    const bgA = buf[idx + 3] / 255;
    if (bgA === 0) return; // don't paint outside the rounded square
    const outA = a / 255 + bgA * (1 - a / 255);
    if (outA === 0) return;
    buf[idx]     = Math.round((r * (a / 255) + buf[idx]     * bgA * (1 - a / 255)) / outA);
    buf[idx + 1] = Math.round((g * (a / 255) + buf[idx + 1] * bgA * (1 - a / 255)) / outA);
    buf[idx + 2] = Math.round((b * (a / 255) + buf[idx + 2] * bgA * (1 - a / 255)) / outA);
    buf[idx + 3] = Math.round(outA * 255);
  }

  function drawLine(x0, y0, x1, y1, width) {
    const half = width / 2;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    const px = dy / len;
    const py = -dx / len;
    const steps = Math.ceil(len * 2);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const bx = x0 + dx * t;
      const by = y0 + dy * t;
      for (let w = -half; w <= half; w += 0.5) {
        paintPixel(bx + px * w, by + py * w, 255, 255, 255, 255);
      }
    }
  }

  drawLine(midX - size * 0.15, topY, midX - size * 0.15, botY, strokeW); // vertical
  drawLine(midX - size * 0.15, cy, midX + size * 0.16, topY, strokeW * 0.9);
  drawLine(midX - size * 0.15, cy, midX + size * 0.16, botY, strokeW * 0.9);

  return buf;
}

// ---- Minimal PNG writer -----------------------------------------------------

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = (table[(crc ^ b) & 0xff] ^ (crc >>> 8)) >>> 0;
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function makePng(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // 8-bit depth
  ihdr[9] = 6;   // colour type: RGBA
  ihdr[10] = 0;  // compression: deflate
  ihdr[11] = 0;  // filter: none
  ihdr[12] = 0;  // interlace: none

  const rowBytes = size * 4;
  const raw = Buffer.alloc((rowBytes + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (rowBytes + 1)] = 0; // filter type per row = None
    rgba.copy(raw, y * (rowBytes + 1) + 1, y * rowBytes, y * rowBytes + rowBytes);
  }
  const idat = zlib.deflateSync(raw);

  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const size of [192, 512]) {
  const rgba = draw(size);
  const png = makePng(size, rgba);
  const p = path.join(OUT, `icon-${size}.png`);
  fs.writeFileSync(p, png);
  console.log(`Wrote ${p} (${png.length.toLocaleString()} bytes, ${size}\u00d7${size})`);
}
