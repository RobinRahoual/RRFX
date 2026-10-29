/* Visages, détection précise : YuNet (réseau de neurones d'OpenCV) recalculé en JavaScript.
   La référence (fixtures/yunet-astronaute.json) vient d'onnxruntime sur la même entrée. */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Y = require('../plugin/js/yunet.js');
const M = require('../plugin/js/vendor/yunet-model.js');
const F = require('../plugin/js/faces.js');

const W = 320, H = 180;
const photo = new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', 'astronaute-320x180.gray')));
const rgba = new Uint8ClampedArray(W * H * 4);
for (let i = 0; i < W * H; i++) { rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = photo[i]; rgba[i * 4 + 3] = 255; }

test('yunet: the network gives the same numbers as onnxruntime', () => {
  const ref = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'yunet-astronaute.json'), 'utf8')).outputs;
  // L'entrée du réseau : l'image en BGR, en haut à gauche d'un cadre 320×192.
  const input = new Float32Array(3 * 320 * 192);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = photo[y * W + x]; input[y * 320 + x] = input[320 * 192 + y * 320 + x] = input[2 * 320 * 192 + y * 320 + x] = v; }
  const out = Y.run(M, input, 192, 320);
  Object.keys(ref).forEach(k => {
    const d = out[k].data;
    assert.ok(Math.abs(d.reduce((a, v) => a + v, 0) - ref[k].sum) < 1e-3 * Math.max(1, Math.abs(ref[k].sum)), k + ' sum');
    ref[k].top.forEach(([i, v]) => assert.ok(Math.abs(d[i] - v) < 1e-4, k + '[' + i + '] ' + d[i] + ' ≠ ' + v));
  });
});

test('yunet: one face on the astronaut, eyes from the landmarks; nothing in a plain or noisy image', () => {
  const faces = Y.detect(M, rgba, W, H);
  assert.strictEqual(faces.length, 1, JSON.stringify(faces));
  assert.ok(faces[0].score > 0.8);
  const e = F.pickFace(faces, W, H, null);
  // Entre les deux yeux (repéré à la main sur l'image, comme pour la détection classique).
  assert.ok(Math.abs(e.x - 0.372) < 0.02 && Math.abs(e.y - 0.205) < 0.025, JSON.stringify(e));
  assert.ok(e.size > 0.05 && e.size < 0.2);
  assert.deepStrictEqual(Y.detect(M, new Uint8ClampedArray(W * H * 4).fill(128), W, H), []);
  let seed = 9;
  const noise = new Uint8ClampedArray(W * H * 4).map((_, i) => (i % 4 === 3 ? 255 : (seed = (seed * 16807) % 2147483647) % 256));
  assert.deepStrictEqual(Y.detect(M, noise, W, H), []);
});

test('pickFace: the face nearest the previous one wins, unless it is too far', () => {
  const face = (x, s) => ({ x, y: 20, w: 40, h: 50, score: s, eyes: [[x + 10, 40], [x + 30, 40]] });
  const faces = [face(200, 0.95), face(20, 0.8)];
  assert.ok(Math.abs(F.pickFace(faces, W, H, null).x - 220 / W) < 1e-9, 'surest first');
  assert.ok(Math.abs(F.pickFace(faces, W, H, { x: 40 / W, y: 40 / H }).x - 40 / W) < 1e-9, 'nearest the previous');
  assert.strictEqual(F.pickFace([], W, H, null), null);
});

test('yunet: the factory runs on its own (it is rebuilt inside a Worker)', () => {
  const again = new Function('return (' + Y.factory.toString() + ')();')();
  assert.strictEqual(again.detect(M, rgba, W, H).length, 1);
});
