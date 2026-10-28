#!/usr/bin/env node
/*
 * Fabrique un dossier de ressources d'exemple (sons, LUTs, polices, overlays, titres,
 * presets) pour le test d'interface et les captures d'écran de l'onglet Ressources.
 *
 *   node scripts/demo-assets.js <dossier>
 */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const SR = 44100;

function wav(file, x) {
  const data = Buffer.alloc(x.length * 2);
  for (let i = 0; i < x.length; i++) data.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(x[i] * 32000))), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, data]));
}

function noise(seed) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff * 2 - 1; };
}

const sounds = {
  'Whoosh rapide': secs => { const n = secs * SR, x = new Float32Array(n), r = noise(3); let lp = 0; for (let i = 0; i < n; i++) { const t = i / n, env = Math.sin(Math.PI * t) ** 2, k = 0.02 + 0.3 * t; lp += k * (r() - lp); x[i] = env * lp * 2.2; } return x; },
  'Whoosh grave': secs => { const n = secs * SR, x = new Float32Array(n), r = noise(5); let lp = 0; for (let i = 0; i < n; i++) { const t = i / n, env = Math.sin(Math.PI * t) ** 3, k = 0.01 + 0.08 * t; lp += k * (r() - lp); x[i] = env * lp * 4; } return x; },
  'Impact boom': secs => { const n = secs * SR, x = new Float32Array(n), r = noise(7); for (let i = 0; i < n; i++) { const t = i / SR; x[i] = Math.exp(-t * 6) * Math.sin(2 * Math.PI * (55 - 20 * t) * t) * 0.9 + Math.exp(-t * 40) * r() * 0.5; } return x; },
  'Riser 4 temps': secs => { const n = secs * SR, x = new Float32Array(n), r = noise(9); for (let i = 0; i < n; i++) { const t = i / n; x[i] = t * t * (0.5 * Math.sin(2 * Math.PI * (200 + 1800 * t * t) * i / SR) + 0.3 * r()); } return x; },
  'Clic caméra': secs => { const n = secs * SR, x = new Float32Array(n), r = noise(11); for (let i = 0; i < n; i++) { const t = i / SR; x[i] = (Math.exp(-t * 300) + 0.6 * Math.exp(-Math.abs(t - 0.09) * 400)) * r(); } return x; }
};

function cube(file, title, size, fn) {
  const lines = ['TITLE "' + title + '"', 'LUT_3D_SIZE ' + size];
  for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) {
    const o = fn(r / (size - 1), g / (size - 1), b / (size - 1)).map(v => Math.max(0, Math.min(1, v)).toFixed(5));
    lines.push(o.join(' '));
  }
  fs.writeFileSync(file, lines.join('\n') + '\n');
}
const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const luts = {
  'Teal & Orange': (r, g, b) => { const l = luma(r, g, b), k = l * l * (3 - 2 * l); return [l * 0.5 + k * 0.55, l * 0.75 + 0.06 - (k - 0.5) * 0.08, l * 0.45 + (1 - k) * 0.38]; },
  'Film chaud': (r, g, b) => [0.06 + r * 0.95, 0.04 + g * 0.88, 0.02 + b * 0.72],
  'Noir contrasté': (r, g, b) => { const l = luma(r, g, b), c = Math.max(0, Math.min(1, (l - 0.5) * 1.5 + 0.5)); return [c, c, c * 1.02]; },
  'Nuit bleue': (r, g, b) => { const l = luma(r, g, b); return [l * 0.45, l * 0.65 + 0.03, l * 0.9 + 0.08]; }
};

function png(file, w, h, fn) {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = b => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, body) => { const len = Buffer.alloc(4), c = Buffer.alloc(4), tb = Buffer.concat([Buffer.from(type), body]); len.writeUInt32BE(body.length); c.writeUInt32BE(crc(tb)); return Buffer.concat([len, tb, c]); };
  const ih = Buffer.alloc(13);
  ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3, c = fn(x / w, y / h); raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2]; }
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

function ffmpeg(args) {
  try { execFileSync('ffmpeg', ['-v', 'error', '-y'].concat(args)); return true; } catch (e) { return false; }
}

function make(dir) {
  const put = rel => { const f = path.join(dir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); return f; };
  const lens = { 'Whoosh rapide': 1.2, 'Whoosh grave': 1.6, 'Impact boom': 2.5, 'Riser 4 temps': 4, 'Clic caméra': 0.4 };
  Object.keys(sounds).forEach(n => wav(put('SFX/' + (/Whoosh/.test(n) ? 'Whooshs/' : /Impact|Riser/.test(n) ? 'Impacts & risers/' : 'Divers/') + n + '.wav'), sounds[n](lens[n])));
  const mp3 = put('SFX/Whooshs/Swoosh aigu.mp3');
  if (!ffmpeg(['-f', 'lavfi', '-i', 'anoisesrc=d=0.9:c=pink:a=0.6', '-af', 'afade=t=in:d=0.4,afade=t=out:st=0.5:d=0.4,highpass=f=1500', mp3])) fs.rmSync(mp3, { force: true });
  Object.keys(luts).forEach(n => cube(put('LUTs/' + n + '.cube'), n, 17, luts[n]));
  const fonts = [['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 'Polices/DejaVu Sans Bold.ttf'], ['/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf', 'Polices/DejaVu Serif Bold.ttf'], ['/usr/share/fonts/opentype/inter/InterDisplay-MediumItalic.otf', 'Polices/Inter Display Italic.otf']];
  fonts.forEach(([from, to]) => { if (fs.existsSync(from)) fs.copyFileSync(from, put(to)); });
  png(put('Overlays/Images/Light leak orange.png'), 320, 180, (x, y) => { const d = Math.hypot(x - 0.85, y - 0.2); const k = Math.max(0, 1 - d * 1.4); return [Math.round(255 * k), Math.round(140 * k * k), Math.round(30 * k * k * k)]; });
  png(put('Overlays/Images/Poussière.png'), 320, 180, (x, y) => { const v = (Math.sin(x * 913 + y * 377) * 43758.5453) % 1; return Math.abs(v) > 0.995 ? [230, 230, 230] : [0, 0, 0]; });
  png(put('Logos/Logo RR.png'), 240, 240, (x, y) => { const d = Math.hypot(x - 0.5, y - 0.5); return d < 0.42 ? (d > 0.36 ? [255, 255, 255] : [24, 24, 28]) : [75, 156, 245]; });
  ffmpeg(['-f', 'lavfi', '-i', 'gradients=s=320x180:d=2:speed=0.04:c0=0xff7a00:c1=0x000000:c2=0xffc070:n=3', '-c:v', 'libvpx-vp9', '-b:v', '300k', put('Overlays/Vidéos/Light leak chaud.webm')]);
  ffmpeg(['-f', 'lavfi', '-i', 'cellauto=s=320x180:rate=25,format=yuv420p', '-t', '2', '-c:v', 'libvpx-vp9', '-b:v', '300k', put('Overlays/Vidéos/Glitch.webm')]);
  fs.writeFileSync(put('Titres/Lower third néon.mogrt'), Buffer.from('PK\u0003\u0004 demo'));
  fs.writeFileSync(put('Titres/Titre clip.mogrt'), Buffer.from('PK\u0003\u0004 demo'));
  fs.writeFileSync(put('Presets/Zoom punch.prfpset'), '<?xml version="1.0"?><PremiereData Version="3"/>\n');
  fs.writeFileSync(put('Presets/Mes transitions.rrfx.json'), JSON.stringify({ rrfx: 1, items: [{ type: 'preset', name: 'Zoom drop perso', cat: 'zoom', data: { base: 'zoom-in', params: { frames: 6, intensity: 140 } } }] }, null, 1));
  fs.writeFileSync(put('notes.txt'), 'ignoré');
  return dir;
}

if (require.main === module) {
  const dir = process.argv[2];
  if (!dir) { console.error('Usage : node scripts/demo-assets.js <dossier>'); process.exit(1); }
  make(path.resolve(dir));
  console.log('Ressources d\'exemple : ' + path.resolve(dir));
}

module.exports = { make };
