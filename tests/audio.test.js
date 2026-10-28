/* Analyse audio : temps forts, tempo, volume, synchronisation, sur une musique synthétique. */
const { test } = require('node:test');
const assert = require('node:assert');
const A = require('../plugin/js/audio.js');

// Une « musique » : grosse caisse sur chaque temps, charleston sur les contretemps,
// nappe continue ; deuxième moitié deux fois plus forte. Graine fixe.
function song(opts) {
  opts = Object.assign({ sr: 22050, seconds: 24, bpm: 120, start: 0.5 }, opts);
  const { sr, seconds, bpm, start } = opts;
  const x = new Float32Array(Math.round(sr * seconds));
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff * 2 - 1; };
  const beat = 60 / bpm, kicks = [], hats = [];
  for (let t = start; t < seconds - 0.3; t += beat) kicks.push(t);
  for (let t = start + beat / 2; t < seconds - 0.3; t += beat) hats.push(t);
  for (let i = 0; i < x.length; i++) {
    const t = i / sr;
    x[i] = 0.05 * Math.sin(2 * Math.PI * 220 * t) * (1 + 0.3 * Math.sin(2 * Math.PI * 0.25 * t));
  }
  kicks.forEach(t0 => {
    const a = Math.round(t0 * sr);
    for (let i = 0; i < 0.25 * sr && a + i < x.length; i++) {
      const t = i / sr;
      x[a + i] += 0.8 * Math.exp(-t * 18) * Math.sin(2 * Math.PI * (55 + 60 * Math.exp(-t * 30)) * t);
    }
  });
  // Mélodie : notes de hauteur et de place irrégulières (une vraie musique ne se répète pas à l'identique).
  let tn = start + 0.1;
  while (tn < seconds - 0.5) {
    const a = Math.round(tn * sr), f = 330 * Math.pow(2, Math.floor((rnd() + 1) * 6) / 12), len = 0.12 + 0.2 * Math.abs(rnd());
    for (let i = 0; i < len * sr && a + i < x.length; i++) x[a + i] += 0.12 * Math.exp(-i / sr * 8) * Math.sin(2 * Math.PI * f * i / sr);
    tn += 0.125 * (1 + Math.floor(Math.abs(rnd()) * 4));
  }
  hats.forEach(t0 => {
    const a = Math.round(t0 * sr);
    for (let i = 0; i < 0.05 * sr && a + i < x.length; i++) x[a + i] += 0.25 * Math.exp(-i / sr * 90) * rnd();
  });
  for (let i = Math.floor(x.length / 2); i < x.length; i++) x[i] *= 2;
  return { x, sr, kicks, hats };
}

const near = (list, t, tol) => list.some(v => Math.abs(v - t) <= tol);

test('kicks mode finds every kick drum within 20 ms, and nothing else', () => {
  const s = song();
  const an = A.analyze(s.x, s.sr, 100);
  const r = A.detectBeats(an, { mode: 'kicks', sensitivity: 50 });
  const missed = s.kicks.filter(k => !near(r.times, k, 0.02));
  assert.deepStrictEqual(missed, [], 'missed kicks');
  const extra = r.times.filter(t => !near(s.kicks, t, 0.03));
  assert.ok(extra.length <= 1, 'extra hits: ' + extra.map(t => t.toFixed(3)).join(', '));
});

test('hits mode also catches the hi-hats', () => {
  const s = song();
  const an = A.analyze(s.x, s.sr, 100);
  const r = A.detectBeats(an, { mode: 'hits', sensitivity: 60 });
  const found = s.hats.filter(h => near(r.times, h, 0.025)).length;
  assert.ok(found >= s.hats.length * 0.8, found + '/' + s.hats.length + ' hats');
  // Une note de mélodie 25 ms avant un kick fusionne avec lui : l'attaque est un peu plus tôt.
  assert.ok(s.kicks.filter(k => near(r.times, k, 0.04)).length >= s.kicks.length * 0.95);
});

test('tempo: 120 BPM found, grid on the kicks, every N works', () => {
  [100, 120, 140].forEach(bpm => {
    const s = song({ bpm });
    const an = A.analyze(s.x, s.sr, 100);
    const r = A.detectBeats(an, { mode: 'tempo' });
    assert.ok(Math.abs(r.bpm - bpm) < 1.5 || Math.abs(r.bpm - bpm * 2) < 3 || Math.abs(r.bpm - bpm / 2) < 1.5, bpm + ' → ' + r.bpm);
  });
  const s = song();
  const an = A.analyze(s.x, s.sr, 100);
  const r = A.detectBeats(an, { mode: 'tempo' });
  const onBeat = r.times.filter(t => near(s.kicks, t, 0.03) || near(s.hats, t, 0.03)).length;
  assert.ok(onBeat >= r.times.length * 0.9, onBeat + '/' + r.times.length);
  const every4 = A.detectBeats(an, { mode: 'kicks', every: 4 });
  const all = A.detectBeats(an, { mode: 'kicks' });
  assert.strictEqual(every4.times.length, Math.ceil(all.times.length / 4));
  const ranged = A.detectBeats(an, { mode: 'kicks', from: 5, to: 10 });
  assert.ok(ranged.times.every(t => t >= 5 && t <= 10) && ranged.times.length >= 9);
});

test('sensitivity: more sensitive = more hits, silence = none', () => {
  const s = song();
  const an = A.analyze(s.x, s.sr, 100);
  const low = A.detectBeats(an, { mode: 'hits', sensitivity: 5 }).times.length;
  const high = A.detectBeats(an, { mode: 'hits', sensitivity: 95 }).times.length;
  assert.ok(high >= low, low + ' vs ' + high);
  const silent = A.analyze(new Float32Array(22050 * 3), 22050, 100);
  assert.deepStrictEqual(A.detectBeats(silent, { mode: 'hits' }).times, []);
});

test('loudness: the loud second half reads louder, intensity factor follows', () => {
  const s = song();
  const curve = A.loudnessCurve(A.analyze(s.x, s.sr, 100));
  const quiet = A.loudnessAt(curve, 6.1), loud = A.loudnessAt(curve, 18.1);
  assert.ok(loud > quiet + 0.2, quiet + ' vs ' + loud);
  assert.strictEqual(A.intensityFactor(0.5, 1), 1);
  assert.ok(A.intensityFactor(1, 1) > 1.5 && A.intensityFactor(0, 1) < 0.5);
  assert.strictEqual(A.intensityFactor(1, 0), 1);
});

// Le son de la caméra : un extrait de la musique, filtré (petit micro), plus faible, bruité.
function cameraTake(s, from, seconds, lead) {
  const sr = s.sr, n = Math.round(seconds * sr), pad = Math.round((lead || 0) * sr);
  const out = new Float32Array(n);
  let seed = 3;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff * 2 - 1; };
  const a = Math.round(from * sr);
  for (let i = 0; i < n; i++) {
    const j = a + i - pad;
    out[i] = (j >= 0 && j < s.x.length ? 0.4 * s.x[j] : 0) + 0.03 * rnd();
  }
  return A.highpass(A.lowpass(out, sr, 4000), sr, 300);
}

test('sync: finds where the camera audio sits in the song (±5 ms)', () => {
  const s = song({ seconds: 40 });
  const music = A.syncCurve(s.x, s.sr);
  [3.0, 11.37, 21.5].forEach(from => {
    const cam = A.syncCurve(cameraTake(s, from, 10), s.sr);
    const r = A.findOffset(cam, music);
    assert.ok(Math.abs(r.offset - from) < 0.005, from + ' → ' + r.offset);
    assert.ok(r.score > 0.4, 'score ' + r.score);
  });
});

test('sync: camera rolling before the song starts (negative offset)', () => {
  const s = song({ seconds: 30 });
  const music = A.syncCurve(s.x, s.sr);
  const cam = A.syncCurve(cameraTake(s, 0, 12, 2.5), s.sr);
  const r = A.findOffset(cam, music);
  assert.ok(Math.abs(r.offset + 2.5) < 0.005, String(r.offset));
});

test('sync: an unrelated recording gets a low score', () => {
  const s = song({ seconds: 30 });
  const other = song({ seconds: 12, bpm: 97, start: 0.13 });
  const noise = new Float32Array(other.x.length);
  for (let i = 0; i < noise.length; i++) noise[i] = other.x[i] * 0.5 + 0.2 * Math.sin(i * 0.37);
  const r = A.findOffset(A.syncCurve(noise, s.sr), A.syncCurve(s.x, s.sr));
  const good = A.findOffset(A.syncCurve(cameraTake(s, 5, 10), s.sr), A.syncCurve(s.x, s.sr));
  assert.ok(r.score < good.score, r.score + ' vs ' + good.score);
});

test('fft round-trip', () => {
  const re = Float64Array.from({ length: 16 }, (_, i) => Math.sin(i)), im = new Float64Array(16), copy = re.slice();
  A.fft(re, im, false);
  A.fft(re, im, true);
  re.forEach((v, i) => assert.ok(Math.abs(v - copy[i]) < 1e-9));
});
