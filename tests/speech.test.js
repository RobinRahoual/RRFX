/* Parole : silences, sous-titres. */
const { test } = require('node:test');
const assert = require('node:assert');
const Sp = require('../plugin/js/speech.js');

// Voix (bruit fort) avec des pauses aux temps donnés, fond léger.
function voice(sr, dur, pauses, floor) {
  const x = new Float32Array(Math.round(sr * dur));
  let seed = 3;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  for (let i = 0; i < x.length; i++) {
    const t = i / sr, quiet = pauses.some(([a, b]) => t >= a && t < b);
    x[i] = rnd() * (quiet ? floor : 0.4);
  }
  return x;
}

test('silences found where the voice stops, with a margin kept around the words', () => {
  const sr = 16000, x = voice(sr, 10, [[2, 3], [5, 5.3], [7, 8.5]], 0.003);
  const d = Sp.detect(x, sr, { minSilence: 0.5, pad: 0.1 });
  assert.strictEqual(d.ranges.length, 2, JSON.stringify(d.ranges));
  const [a, b] = d.ranges;
  assert.ok(Math.abs(a.a - 2.1) < 0.03 && Math.abs(a.b - 2.9) < 0.03, JSON.stringify(a));
  assert.ok(Math.abs(b.a - 7.1) < 0.03 && Math.abs(b.b - 8.4) < 0.03, JSON.stringify(b));
  // Pause courte gardée ; plus sensible + minimum court : elle est trouvée aussi.
  assert.strictEqual(Sp.detect(x, sr, { minSilence: 0.25, pad: 0.05 }).ranges.length, 3);
  // Silence au tout début / à la toute fin : coupé jusqu'au bord, sans marge.
  const y = voice(sr, 6, [[0, 1], [5, 6]], 0.002), e = Sp.detect(y, sr, { pad: 0.1 }).ranges;
  assert.strictEqual(e[0].a, 0);
  assert.ok(Math.abs(e[e.length - 1].b - 6) < 1e-9);
  // Un clic isolé dans un silence ne le coupe pas en deux.
  const z = voice(sr, 6, [[2, 4]], 0.002);
  for (let i = Math.round(3 * sr); i < Math.round(3.04 * sr); i++) z[i] = 0.5;
  assert.strictEqual(Sp.detect(z, sr, { minSilence: 0.5 }).ranges.length, 1);
  // Son sans écart net (que du bruit) : rien n'est coupé.
  assert.deepStrictEqual(Sp.detect(voice(sr, 4, [], 0), sr).ranges, []);
});

test('several clips: only cut where nobody speaks', () => {
  const r = Sp.combine([
    { start: 0, end: 10, silent: [{ a: 2, b: 4 }, { a: 6, b: 8 }] },
    { start: 0, end: 10, silent: [{ a: 3, b: 5 }, { a: 6, b: 9 }] },
    { start: 12, end: 15, silent: [{ a: 11, b: 13 }] }
  ]);
  assert.deepStrictEqual(r, [{ a: 3, b: 4 }, { a: 6, b: 8 }, { a: 12, b: 13 }]);
  assert.strictEqual(Sp.total(r), 4);
});

test('SRT / VTT read, tags removed, split into short captions, remapped after a cut', () => {
  const srt = '﻿1\r\n00:00:01,000 --> 00:00:03,000\r\n<i>Bonjour</i> à tous\r\net bienvenue\r\n\r\n2\r\n00:00:04,500 --> 00:00:05,250\r\n{\\an8}Merci\r\n\r\nbroken\r\n';
  const cues = Sp.parseSubtitles(srt);
  assert.deepStrictEqual(cues, [{ start: 1, end: 3, text: 'Bonjour à tous et bienvenue' }, { start: 4.5, end: 5.25, text: 'Merci' }]);
  const vtt = Sp.parseSubtitles('WEBVTT\n\n00:01.200 --> 00:02.000 align:start\nSalut\n\n01:00:00.000 --> 01:00:01.000\nFin');
  assert.deepStrictEqual(vtt.map(c => [c.start, c.end, c.text]), [[1.2, 2, 'Salut'], [3600, 3601, 'Fin']]);
  const one = Sp.splitCues(cues, 1);
  assert.deepStrictEqual(one.map(c => c.text), ['Bonjour', 'à', 'tous', 'et', 'bienvenue', 'Merci']);
  assert.strictEqual(one[0].start, 1);
  assert.strictEqual(one[4].end, 3);
  for (let i = 1; i < 5; i++) assert.ok(Math.abs(one[i].start - one[i - 1].end) < 1e-9 && one[i].end > one[i].start);
  assert.ok(one[4].end - one[4].start > one[1].end - one[1].start, 'long words stay longer');
  assert.strictEqual(Sp.splitCues(cues, 3).length, 3);
  assert.deepStrictEqual(Sp.offset(cues, 10)[0], { start: 11, end: 13, text: 'Bonjour à tous et bienvenue' });
  // 2 s retirées avant le 2e sous-titre ; un sous-titre tombé dans un silence disparaît.
  const re = Sp.remap(cues.concat([{ start: 6.1, end: 6.6, text: 'euh' }]), [{ a: 3.5, b: 4.5 }, { a: 6, b: 7 }]);
  assert.deepStrictEqual(re.map(c => [c.start, c.end, c.text]), [[1, 3, 'Bonjour à tous et bienvenue'], [3.5, 4.25, 'Merci']]);
});
