#!/usr/bin/env node
/*
 * Fabrique le pack d'installation dist/CutFX-<version>-installation.zip :
 *
 *   CutFX-<version>/
 *     CutFX/                         le panneau (dossier plugin/, sans .debug)
 *     Installer CutFX (Windows).bat
 *     Installer CutFX (Mac).command  (exécutable)
 *     LISEZMOI.txt
 *
 *   node scripts/package.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.join(__dirname, '..');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const top = 'CutFX-' + version;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function listFiles(dir, prefix) {
  const out = [];
  for (const name of fs.readdirSync(dir).sort()) {
    if (name.startsWith('.')) continue; // .debug (port de débogage), .DS_Store…
    const full = path.join(dir, name);
    const rel = prefix + '/' + name;
    if (fs.statSync(full).isDirectory()) out.push(...listFiles(full, rel));
    else out.push({ full, rel });
  }
  return out;
}

function dosDateTime(date) {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    day: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

const files = listFiles(path.join(root, 'plugin'), top + '/CutFX')
  .concat(fs.readdirSync(path.join(root, 'install')).sort().map(name => ({ full: path.join(root, 'install', name), rel: top + '/' + name })));

const locals = [];
const centrals = [];
let offset = 0;
const { time, day } = dosDateTime(new Date());

for (const { full, rel } of files) {
  const data = fs.readFileSync(full);
  const deflated = zlib.deflateRawSync(data, { level: 9 });
  const useDeflate = deflated.length < data.length;
  const body = useDeflate ? deflated : data;
  const name = Buffer.from(rel, 'utf8');
  const crc = crc32(data);
  const mode = /\.command$/.test(rel) ? 0o100755 : 0o100644;

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6); // noms en UTF-8
  local.writeUInt16LE(useDeflate ? 8 : 0, 8);
  local.writeUInt16LE(time, 10);
  local.writeUInt16LE(day, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  locals.push(local, name, body);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(0x0314, 4); // créé sous Unix : garde les droits (script Mac exécutable)
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(useDeflate ? 8 : 0, 10);
  central.writeUInt16LE(time, 12);
  central.writeUInt16LE(day, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(body.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE((mode << 16) >>> 0, 38);
  central.writeUInt32LE(offset, 42);
  centrals.push(central, name);

  offset += local.length + name.length + body.length;
}

const centralSize = centrals.reduce((n, b) => n + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralSize, 12);
end.writeUInt32LE(offset, 16);

const dist = path.join(root, 'dist');
fs.mkdirSync(dist, { recursive: true });
const out = path.join(dist, top + '-installation.zip');
fs.writeFileSync(out, Buffer.concat([...locals, ...centrals, end]));
console.log(path.relative(process.cwd(), out) + ' (' + files.length + ' fichiers)');
