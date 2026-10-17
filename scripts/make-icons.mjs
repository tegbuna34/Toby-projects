// Generates the PWA icons (solid green tile, white ball, flag) with no dependencies.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};

const GREEN = [0x24, 0x5c, 0x46];
const OFFWHITE = [0xf8, 0xf7, 0xf3];

// Shape coverage at a point in unit coordinates; returns true when "white".
function white(x, y) {
  const dx = x - 0.5, dy = y - 0.72;
  if (dx * dx + dy * dy < 0.1 * 0.1) return true; // ball
  if (x > 0.485 && x < 0.515 && y > 0.2 && y < 0.7) return true; // pole
  // pennant triangle
  if (x >= 0.515 && x < 0.72 && y > 0.2 && y < 0.38) {
    const t = (x - 0.515) / 0.205;
    return y < 0.2 + 0.09 + (1 - t) * 0.09 && y > 0.2 + t * 0.09;
  }
  return false;
}

function png(size) {
  const ss = 3;
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let py = 0; py < size; py++) {
    raw[py * (size * 3 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      let hits = 0;
      for (let sy = 0; sy < ss; sy++)
        for (let sx = 0; sx < ss; sx++)
          if (white((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size)) hits++;
      const a = hits / (ss * ss);
      for (let ch = 0; ch < 3; ch++)
        raw[py * (size * 3 + 1) + 1 + px * 3 + ch] = Math.round(GREEN[ch] * (1 - a) + OFFWHITE[ch] * a);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

writeFileSync('public/icon-192.png', png(192));
writeFileSync('public/icon-512.png', png(512));
writeFileSync('public/apple-touch-icon.png', png(180));
console.log('icons written');
