// Generates the PlayNext icon: black canvas, white play triangle.
// Pure Node (zlib only) — writes a real PNG without any image library.
const zlib = require('zlib');
const fs = require('fs');

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
// Point in triangle (barycentric)
function inTri(px, py, a, b, c) {
  const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
  const l1 = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) / d;
  const l2 = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) / d;
  const l3 = 1 - l1 - l2;
  return l1 >= 0 && l2 >= 0 && l3 >= 0;
}
function render(size) {
  const S = size;
  const A = [S * 0.34375, S * 0.27344]; // 176,140
  const B = [S * 0.73438, S * 0.5];     // 376,256
  const C = [S * 0.34375, S * 0.72656]; // 176,372
  const SS = 4; // supersampling for clean edges
  const raw = Buffer.alloc(S * (S * 4 + 1));
  let o = 0;
  for (let y = 0; y < S; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < S; x++) {
      let hit = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          if (inTri(px, py, A, B, C)) hit++;
        }
      }
      const v = Math.round((hit / (SS * SS)) * 255);
      raw[o++] = v; raw[o++] = v; raw[o++] = v; raw[o++] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(S, 0);
  ihdr.writeUInt32BE(S, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}
const out = process.argv[2] || 'icons/logo.png';
const size = parseInt(process.argv[3] || '512', 10);
fs.writeFileSync(out, render(size));
console.log('wrote', out, size + 'x' + size, fs.statSync(out).size + ' bytes');
