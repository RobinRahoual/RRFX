/* Codes de partage d'effets perso. */
const { test } = require('node:test');
const assert = require('node:assert');
const zlib = require('zlib');
const Share = require('../plugin/js/share.js');

const zip = { deflate: b => new Uint8Array(zlib.deflateRawSync(b)), inflate: b => new Uint8Array(zlib.inflateRawSync(b)) };
const items = [
  { id: 'x1', type: 'preset', name: 'Mon zoom ✨', cat: 'zoom', created: 1, data: { base: 'zoom-in', params: { amount: 80 } } },
  { id: 'x2', type: 'ramp', name: 'Rampe', data: { points: [{ t: 0, v: 100 }, { t: 1, v: 400 }], frames: 12 } },
  { id: 'x3', type: 'overlay', name: 'Fuite', data: { path: 'C:/secret/leak.mov' } }
];

test('round trip, compressed and plain, without local ids or file paths', () => {
  [zip, null].forEach(z => {
    const code = Share.encode(items, z);
    assert.ok(code.startsWith(z ? 'CUTFX1:' : 'CUTFX0:'));
    const back = Share.decode('  Voici mon effet : ' + code + '\n', z);
    assert.strictEqual(back.length, 2, 'overlays (local files) are not shared');
    assert.strictEqual(back[0].name, 'Mon zoom ✨');
    assert.strictEqual(back[0].id, undefined);
    assert.deepStrictEqual(back[1].data.points, items[1].data.points);
    assert.ok(!code.includes('secret'));
  });
});

test('compression makes big captured effects shorter', () => {
  const big = [{ type: 'captured', name: 'Capture', data: { frames: 120, components: [{ matchName: 'AE.ADBE Geometry2', props: [{ index: 3, values: Array.from({ length: 120 }, (_, i) => 100 + i % 7) }] }] } }];
  assert.ok(Share.encode(big, zip).length < Share.encode(big, null).length / 2);
});

test('clear errors for wrong or damaged codes', () => {
  assert.throws(() => Share.decode('hello', zip), /pas un code CutFX/);
  const code = Share.encode(items, zip);
  assert.throws(() => Share.decode(code.slice(0, 20), zip));
  assert.throws(() => Share.decode(code, null), /Décompression/);
  assert.throws(() => Share.decode(Share.encode([], null), null), /aucun effet/);
});
