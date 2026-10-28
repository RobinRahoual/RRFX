/* Packs de style : ZIP lisible partout, manifeste vérifié, fichiers retrouvés. */
const { test } = require('node:test');
const assert = require('node:assert');
const zlib = require('zlib');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const P = require('../plugin/js/stylepack.js');

const deflate = b => new Uint8Array(zlib.deflateRawSync(Buffer.from(b)));
const inflate = b => new Uint8Array(zlib.inflateRawSync(Buffer.from(b)));

function sample() {
  return P.build({
    name: 'Clip été', author: 'robin.rahoual',
    items: [{ type: 'preset', name: 'Zoom drop', cat: 'zoom', data: { base: 'zoom-in', params: { frames: 6 } } }, { type: 'look', name: 'Nuit', data: { params: { exposure: -0.3 } } }],
    overlays: [{ name: 'Leak chaud', kind: 'video', file: 'Leak chaud.webm', data: new Uint8Array([1, 2, 3, 4, 5]) }, { name: 'Leak', kind: 'image', file: 'Leak chaud.webm', data: new Uint8Array(300).fill(7) }],
    titles: { anim: 'pop', inF: 6, outF: 5, params: {} }, mogrt: { file: 'Titre néon.mogrt', data: new Uint8Array([80, 75, 3, 4]) },
    look: { name: 'Été', params: { temp: 12 } }, chain: [{ builtin: 'zoom-in' }, { item: 0 }]
  });
}

test('a pack round-trips: manifest, overlays, title template, chain', () => {
  const bytes = P.zip(sample(), deflate);
  const { manifest: m, files } = P.read(bytes, inflate);
  assert.strictEqual(m.name, 'Clip été');
  assert.strictEqual(m.items.length, 2);
  assert.deepStrictEqual(m.overlays.map(o => o.file), ['overlays/Leak chaud.webm', 'overlays/1-Leak chaud.webm'], 'same file name twice stays distinct');
  assert.deepStrictEqual(Array.from(files.get(m.overlays[0].file)), [1, 2, 3, 4, 5]);
  assert.strictEqual(m.titles.mogrt, 'titres/Titre neon.mogrt');
  assert.deepStrictEqual(m.chain, [{ builtin: 'zoom-in' }, { item: 0 }]);
  assert.strictEqual(P.summary(m), '1 effet, 2 looks, 2 overlays, style de texte, enchaînement de 2 effets');
});

test('the pack is a standard ZIP (opened by the system tools)', t => {
  let unzip = true;
  try { execFileSync('unzip', ['-v'], { stdio: 'ignore' }); } catch (e) { unzip = false; }
  if (!unzip) return t.skip('unzip absent');
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rrfxpack-')), 'Clip.rrfxpack');
  fs.writeFileSync(f, P.zip(sample(), deflate));
  const out = execFileSync('unzip', ['-t', f]).toString();
  assert.match(out, /No errors detected/);
  assert.match(execFileSync('unzip', ['-l', f]).toString(), /pack\.json/);
});

test('damaged or foreign files are refused with a clear message', () => {
  const bytes = P.zip(sample());
  const bad = bytes.slice();
  bad[40] ^= 0xff; // dans pack.json
  assert.throws(() => P.read(bad), /abîmé/);
  assert.throws(() => P.read(new Uint8Array(100)), /pas un pack/);
  assert.throws(() => P.read(P.zip([{ name: 'autre.txt', data: new Uint8Array([1]) }])), /pack\.json manquant/);
  const future = P.zip([{ name: 'pack.json', data: new TextEncoder().encode(JSON.stringify({ rrfxpack: 99 })) }]);
  assert.throws(() => P.read(future), /plus récente/);
  assert.strictEqual(P.crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});
