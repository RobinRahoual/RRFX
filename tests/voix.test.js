/* Voix : sonie, « euh », ducking ; mots clés, répétitions, chapitres ; suivi d'objet ; stabilisation. */
const { test } = require('node:test');
const assert = require('node:assert');
global.self = global;
const Core = require('../plugin/js/core.js');
const Lib = require('../plugin/js/library.js');
const V = require('../plugin/js/voix.js');
const Sp = require('../plugin/js/speech.js');
const T = require('../plugin/js/tracker.js');

const sr = 48000;
const sine = (f, A, d) => Float32Array.from({ length: Math.round(sr * d) }, (_, i) => A * Math.sin(2 * Math.PI * f * i / sr));

test('loudness (BS.1770): reference tones, silence, gain capped by the peak', () => {
  assert.ok(Math.abs(V.loudness(sine(997, 1, 3), sr).lufs + 3.01) < 0.05);
  assert.ok(Math.abs(V.loudness(sine(997, 0.1, 3), sr).lufs + 23.01) < 0.05);
  assert.strictEqual(V.loudness(new Float32Array(sr), sr).lufs, -Infinity);
  const m = V.loudness(sine(997, 0.1, 3), sr);
  assert.ok(Math.abs(V.gainFor(m, -14).gain - 9) < 0.1);
  // Crête à -20 dBFS : +9 dB possible ; crête déjà à -3 : gain limité à +2 dB.
  const g = V.gainFor({ lufs: -23, peak: -3 }, -14, -1);
  assert.deepStrictEqual([g.gain, g.limited], [2, true]);
  assert.ok(V.gainFor({ lufs: -Infinity, peak: -100 }).silent);
  assert.ok(Math.abs(V.levelToDb(V.dbToLevel(-6)) + 6) < 1e-9 && Math.abs(V.dbToLevel(0) - 0.17783) < 1e-4);
});

test('fillers: a held « euh » between words is found, real words are not', () => {
  let seed = 5;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  const x = new Float32Array(sr * 8).map(() => rnd() * 0.002);
  const put = (a, b, fn) => { for (let i = Math.round(a * sr); i < Math.round(b * sr); i++) x[i] += fn(i / sr - a, i / sr); };
  const harm = (f0, t) => [1, 2, 3, 4, 5].reduce((s, hh) => s + Math.sin(2 * Math.PI * f0 * hh * t) / hh, 0);
  const word = (a, d, f1, f2) => put(a, a + d, (u, t) => {
    const f = f1 + (f2 - f1) * u / d, env = Math.sin(Math.PI * u / d) * (0.6 + 0.4 * Math.sin(u * 40));
    return 0.25 * env * Math.sin(2 * Math.PI * f * t) + (Math.floor(u * 8) % 3 === 0 ? rnd() * 0.2 : 0) + 0.1 * env * harm(f, t);
  });
  word(0.5, 0.8, 110, 190); word(1.5, 0.6, 180, 120); word(2.4, 0.9, 130, 200);
  put(3.6, 4.1, (u, t) => 0.2 * Math.min(1, u * 20, (0.5 - u) * 20) * harm(118, t));
  word(4.4, 0.7, 150, 110); word(5.4, 1.0, 120, 170);
  put(6.7, 7.4, (u, t) => 0.2 * Math.min(1, u * 20, (0.7 - u) * 20) * harm(105, t));
  const f = V.fillers(x, sr);
  assert.strictEqual(f.length, 2, JSON.stringify(f));
  assert.ok(Math.abs(f[0].a - 3.57) < 0.06 && Math.abs(f[0].b - 4.13) < 0.06);
  assert.ok(Math.abs(f[1].a - 6.67) < 0.06 && Math.abs(f[1].b - 7.43) < 0.06);
});

test('ducking: music down while speaking, short pauses held, clip edges respected', () => {
  const k = V.duckKeys([{ a: 1, b: 3 }, { a: 3.5, b: 5 }, { a: 9, b: 12 }], { depth: 12, from: 0, to: 11 });
  assert.deepStrictEqual(k, [[0.75, 0], [1, -12], [5, -12], [5.5, 0], [8.75, 0], [9, -12], [11, -12]]);
  const edge = V.duckKeys([{ a: 0, b: 2 }], { from: 0.5, to: 10 });
  assert.deepStrictEqual(edge[0], [0.5, -12]);
});

test('keywords: numbers, strong words, your list, emoji; repetitions and false starts', () => {
  const text = 'Je vais te montrer comment gagner 500 euros en 3 minutes !';
  const w = text.split(' ');
  assert.deepStrictEqual(Sp.keywords(text).map(i => w[i]), ['500', '3', 'minutes']);
  assert.ok(Sp.keywords('on parle de Robin aujourd hui', { list: ['robin'] }).length === 1);
  const cues = [{ start: 0, end: 4, text }];
  const one = Sp.highlight(cues, 1, { emoji: true });
  assert.strictEqual(one.length, w.length);
  assert.deepStrictEqual(one.filter(x => x.key).map(x => x.text), ['500', '3', 'minutes ⏱️']);
  assert.strictEqual(one[one.length - 1].end, 4);
  assert.ok(Sp.highlight(cues, 0, {}).every(x => x.key));
  assert.strictEqual(Sp.emojiFor('Argent'), '💰');
  const rep = Sp.repeats([{ start: 5, end: 7, text: 'On va on va regarder ça' }, { start: 8, end: 9, text: 'je' }, { start: 9.1, end: 9.4, text: 'je pense' }, { start: 10, end: 11, text: 'c\'est- c\'est vrai' }]);
  assert.deepStrictEqual(rep.map(r => [r.text, r.exact]), [['On va on va', false], ['je je', true], ['c\'est- c\'est', false]]);
  assert.ok(Math.abs(rep[0].a - 5) < 1e-9 && rep[0].b < 6);
  assert.deepStrictEqual(Sp.repeats([{ start: 0, end: 1, text: 'très très bien' }]), []);
});

test('YouTube chapters: from named markers or from long gaps in the subtitles, YouTube rules kept', () => {
  const a = Sp.chapters({ markers: [{ t: 65, name: 'Le matériel' }, { t: 3720, name: 'RR FX · Conclusion' }, { t: 70, name: 'trop près' }] });
  assert.strictEqual(a.text, '00:00 Introduction\n01:05 Le matériel\n1:02:00 Conclusion');
  assert.ok(a.ok);
  const cues = [{ start: 0.5, end: 4, text: 'bienvenue dans cette vidéo' }, { start: 4.2, end: 20, text: 'suite' }, { start: 23, end: 40, text: 'Deuxième partie : le montage, enfin' }, { start: 40.5, end: 44, text: 'x' }, { start: 47, end: 60, text: 'pour finir' }];
  const b = Sp.chapters({ cues });
  assert.deepStrictEqual(b.list.map(c => [c.t, c.title]), [[0, 'Bienvenue dans cette vidéo'], [23, 'Deuxième partie : le montage, enfin'], [47, 'Pour finir']]);
  const few = Sp.chapters({ markers: [{ t: 0, name: 'Début' }] });
  assert.ok(!few.ok && few.why);
});

test('object tracking: a pattern followed across frames, lost when it disappears', () => {
  const w = 320, h = 180;
  let seed = 3;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const bg = new Uint8Array(w * h).map(() => 60 + rnd() * 80);
  const frames = [];
  for (let k = 0; k < 10; k++) {
    const g = bg.slice(), ox = 60 + k * 12, oy = 50 + Math.round(8 * Math.sin(k));
    if (k < 9) for (let y = 0; y < 30; y++) for (let x = 0; x < 40; x++) g[(oy + y) * w + ox + x] = ((x >> 3) + (y >> 3)) % 2 ? 230 : 20;
    frames.push({ g, w, h, truth: [(ox + 20) / w, (oy + 15) / h] });
  }
  const r = T.track(frames, { x: 60 / w, y: 50 / h, w: 40 / w, h: 30 / h });
  for (let k = 0; k < 9; k++) assert.ok(Math.hypot((r[k].x - frames[k].truth[0]) * w, (r[k].y - frames[k].truth[1]) * h) < 1.5, 'frame ' + k);
  assert.ok(r[9].score < 0.5 && Math.abs(r[9].x - r[8].x) < 1e-9, 'lost: last position kept');
});

test('Stabiliser le visage holds the eyes still on screen; Zoom suivi (objet) and key colour compile', () => {
  const face = Array.from({ length: 50 }, (_, i) => [0.45 + 0.02 * Math.sin(i / 3), 0.4 + 0.01 * Math.cos(i / 4)]);
  const v = Core.compileEffect(Lib.byId['face-stab'], { face }, 'post', 50, 25)[0].props.find(p => p.key === 'position').values;
  const screen = v.map((p, i) => [p[0] + (face[i][0] - 0.5) * 1.08, p[1] + (face[i][1] - 0.5) * 1.08]);
  screen.forEach(s => assert.ok(Math.abs(s[0] - screen[0][0]) < 2e-3 && Math.abs(s[1] - screen[0][1]) < 2e-3));
  assert.ok(Lib.byId['object-zoom'].face && Lib.byId['object-zoom'].track === 'object');
  const tint = Core.compileEffect({ params: [], build: () => [{ type: 'tint', props: { black: [0, 0, 0], white: [255, 210, 30], amount: 100 } }] }, {}, 'post', 1, 25);
  assert.deepStrictEqual(tint[0].props.map(p => [p.key, !!p.color, p.static]), [['black', true, [0, 0, 0]], ['white', true, [255, 210, 30]], ['amount', false, 100]]);
});
