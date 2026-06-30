/**
 * Generates a 1024x1024 source PNG for `tauri icon` — a full-bleed blue gradient
 * with a white "data sheet" mark (rounded card + three rows). Zero dependencies:
 * raw RGBA scanlines -> zlib deflate -> hand-assembled PNG chunks.
 *
 *   node scripts/make-icon-source.mjs   ->   icons/source.png
 *
 * Replace icons/source.png with real artwork any time and re-run `npm run icons`.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const S = 1024;
const buf = Buffer.alloc(S * S * 4);

const lerp = (a, b, t) => Math.round(a + (b - a) * t);
function px(x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= S || y >= S) return;
  const i = (y * S + x) * 4;
  buf[i] = r;
  buf[i + 1] = g;
  buf[i + 2] = b;
  buf[i + 3] = a;
}

// Background: vertical gradient #4f8cff -> #2b6fe0.
for (let y = 0; y < S; y++) {
  const t = y / S;
  const r = lerp(0x4f, 0x2b, t);
  const g = lerp(0x8c, 0x6f, t);
  const b = lerp(0xff, 0xe0, t);
  for (let x = 0; x < S; x++) px(x, y, r, g, b);
}

// White rounded "card".
function roundRect(x0, y0, x1, y1, rad, r, g, b) {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const dx = Math.min(x - x0, x1 - 1 - x);
      const dy = Math.min(y - y0, y1 - 1 - y);
      if (dx < rad && dy < rad) {
        const ddx = rad - dx;
        const ddy = rad - dy;
        if (ddx * ddx + ddy * ddy > rad * rad) continue;
      }
      px(x, y, r, g, b);
    }
  }
}

roundRect(288, 232, 736, 792, 56, 0xff, 0xff, 0xff);
// Three accent rows (the "spreadsheet").
const rowY = [340, 470, 600];
for (const ry of rowY) roundRect(348, ry, 676, ry + 56, 28, 0x4f, 0x8c, 0xff);

// PNG assembly --------------------------------------------------------------
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return (bytes) => {
    let c = 0xffffffff;
    for (const b of bytes) c = t[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
})();

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(CRC(body), 0);
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type RGBA
// 10,11,12 = compression/filter/interlace = 0

// Raw image: each row prefixed with filter byte 0.
const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0;
  buf.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'icons');
mkdirSync(outDir, { recursive: true });
const out = join(outDir, 'source.png');
writeFileSync(out, png);
console.log(`wrote ${out} (${S}x${S}, ${png.length} bytes)`);
