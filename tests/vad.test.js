/* Détection de la voix (Silero VAD) : même résultat que le modèle d'origine, passages et blancs. */
const { test } = require('node:test');
const assert = require('node:assert');
const V = require('../plugin/js/vad.js');
const M = require('../plugin/js/vendor/silero-model.js');
const ref = require('./fixtures/silero-reference.json');

test('vad: same probabilities as onnxruntime on the original model', () => {
  const b = Buffer.from(ref.pcm16, 'base64'), pcm = new Int16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
  const x = Float32Array.from(pcm, v => v / 32767);
  const p = V.probs(M, x);
  assert.strictEqual(p.length, ref.probs.length);
  let max = 0;
  ref.probs.forEach((v, i) => { max = Math.max(max, Math.abs(v - p[i])); });
  assert.ok(max < 0.01, 'max diff ' + max);
  assert.strictEqual(M.source, 'silero_vad_16k_op15.onnx');
});

test('vad: speech segments and the silences between them', () => {
  const dt = V.CHUNK / V.SR; // 32 ms
  // 0-1 s voix, 1-2 s silence, 2-2,1 s voix trop courte, 2,1-3 s silence, 3-4 s voix.
  const p = new Float32Array(Math.round(4 / dt)).map((_, i) => { const t = i * dt; return (t < 1 || (t >= 2 && t < 2.1) || t >= 3) ? 0.9 : 0.05; });
  const s = V.speech(p);
  assert.strictEqual(s.length, 2, JSON.stringify(s));
  assert.ok(Math.abs(s[0].b - 1) < 0.05 && Math.abs(s[1].a - 3) < 0.05);
  // Un creux bref (< 100 ms) ne coupe pas un passage.
  const q = new Float32Array(60).fill(0.9);
  q[20] = 0.1; q[21] = 0.1;
  assert.strictEqual(V.speech(q).length, 1);
  const sil = V.silences(s, 4, { minSilence: 0.5, pad: 0.1 });
  assert.strictEqual(sil.length, 1);
  assert.ok(Math.abs(sil[0].a - 1.1) < 0.05 && Math.abs(sil[0].b - 2.9) < 0.05);
  // Blanc au début et à la fin du plan : coupés jusqu'au bord (sans marge côté bord).
  const edge = V.silences([{ a: 1, b: 2 }], 4, { minSilence: 0.5, pad: 0.1 });
  assert.deepStrictEqual(edge.map(r => [r.a, +r.b.toFixed(2)]), [[0, 0.9], [2.1, 4]]);
  assert.ok(V.THRESHOLDS.soft < V.THRESHOLDS.normal && V.THRESHOLDS.normal < V.THRESHOLDS.strong);
});
