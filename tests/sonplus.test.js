/* Son : drops, queue de réverb, respirations, clics, images clés. */
const { test } = require('node:test');
const assert = require('node:assert');
const SP = require('../plugin/js/sonplus.js');

function rng(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296 * 2 - 1; }; }

test('drops: a quiet build-up then a loud part, snapped to the nearest beat', () => {
  const rate = 100, v = new Float32Array(60 * rate);
  for (let i = 0; i < v.length; i++) { const t = i / rate; v[i] = t < 20 ? 0.25 : t < 40 ? 0.9 : t < 50 ? 0.2 : 0.95; }
  const d = SP.drops(v, rate, { beats: [19.9, 20.4, 49.8, 50.3] });
  assert.deepStrictEqual(d.map(x => x.t), [19.9, 49.8]);
  assert.ok(d.every(x => x.strength > 0.5));
  assert.deepStrictEqual(SP.drops(new Float32Array(3000).fill(0.6), rate), [], 'steady music: no drop');
});

test('reverb tail: starts at the level of the music, rings, then fades to silence', () => {
  const sr = 22050, x = new Float32Array(sr);
  for (let i = 0; i < x.length; i++) x[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / sr);
  const t = SP.reverbTail(x, sr, { length: 2 });
  assert.strictEqual(t.length, 2 * sr);
  const rms = (a, b) => { let s = 0; for (let i = a; i < b; i++) s += t[i] * t[i]; return Math.sqrt(s / (b - a)); };
  assert.ok(rms(0, 2000) > 0.1, 'audible at the cut');
  assert.ok(rms(0, 2000) > rms(sr, sr + 2000) * 1.5, 'decays');
  assert.ok(Math.abs(t[t.length - 1]) < 1e-3, 'ends in silence');
  assert.ok(t.every(v => Math.abs(v) <= 1));
  assert.strictEqual(SP.resample(new Float32Array(100), 48000, 24000).length, 50);
});

test('breaths between phrases and a mouth click are found; speech and silence are left alone', () => {
  const sr = 16000, r = rng(4), x = new Float32Array(6 * sr);
  const put = (a, b, f) => { for (let i = Math.round(a * sr); i < Math.round(b * sr); i++) x[i] = f(i / sr); };
  put(0, 6, () => 0.0005 * r());                                       // fond
  put(0.5, 2, t => 0.5 * Math.sin(2 * Math.PI * 180 * t) * (0.6 + 0.4 * Math.sin(9 * t)));  // phrase
  put(2.4, 2.8, () => 0.03 * r());                                     // respiration
  put(3, 4.5, t => 0.5 * Math.sin(2 * Math.PI * 200 * t));             // phrase
  put(5.2, 5.2006, () => 0.4);                                         // clic de bouche
  const b = SP.breaths(x, sr);
  assert.strictEqual(b.ranges.length, 1, JSON.stringify(b));
  assert.ok(b.ranges[0].a >= 2.38 && b.ranges[0].b <= 2.82);
  const c = SP.clicks(x, sr);
  assert.strictEqual(c.length, 1, JSON.stringify(c));
  assert.ok(Math.abs(c[0] - 5.2) < 0.01);
});

test('duck keys: a fade on each side, close ranges merged', () => {
  assert.deepStrictEqual(SP.duckKeys([{ a: 1, b: 1.5 }, { a: 1.52, b: 2 }, { a: 5, b: 5.2 }], 12, 0.03), [
    [0.97, 0], [1, -12], [2, -12], [2.03, 0], [4.97, 0], [5, -12], [5.2, -12], [5.23, 0]]);
});
