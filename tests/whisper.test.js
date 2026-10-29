/* Transcription Whisper : lecture des résultats, sous-titres, « euh » et répétitions au mot près. */
const { test } = require('node:test');
const assert = require('node:assert');
const W = require('../plugin/js/whisper.js');

// Sortie de whisper.cpp (-ojf) : des morceaux de mots horodatés en ms.
const cpp = { transcription: [{
  offsets: { from: 0, to: 4200 }, text: ' Bonjour à tous, euh on va on va voir.',
  tokens: [
    { text: '[_BEG_]', offsets: { from: 0, to: 0 } },
    { text: ' Bon', offsets: { from: 100, to: 300 } }, { text: 'jour', offsets: { from: 300, to: 600 } },
    { text: ' à', offsets: { from: 650, to: 750 } }, { text: ' tous', offsets: { from: 750, to: 1000 } }, { text: ',', offsets: { from: 1000, to: 1000 } },
    { text: ' euh', offsets: { from: 1300, to: 1700 } },
    { text: ' on', offsets: { from: 1900, to: 2000 } }, { text: ' va', offsets: { from: 2000, to: 2200 } },
    { text: ' on', offsets: { from: 2300, to: 2400 } }, { text: ' va', offsets: { from: 2400, to: 2600 } },
    { text: ' voir', offsets: { from: 2600, to: 3000 } }, { text: '.', offsets: { from: 3000, to: 3000 } },
    { text: '[_TT_210]', offsets: { from: 4200, to: 4200 } }
  ] }] };

test('parse: whisper.cpp tokens become words with their times', () => {
  const w = W.parse(cpp);
  assert.deepStrictEqual(w.map(x => x.text), ['Bonjour', 'à', 'tous,', 'euh', 'on', 'va', 'on', 'va', 'voir.']);
  assert.deepStrictEqual([w[0].start, w[0].end], [0.1, 0.6]);
  assert.deepStrictEqual([w[8].start, w[8].end], [2.6, 3]);
});

test('parse: openai-whisper words, or a segment shared out when there are none', () => {
  const w = W.parse({ segments: [{ start: 0, end: 2, text: ' Hello there', words: [{ word: ' Hello', start: 0.1, end: 0.5 }, { word: ' there', start: 0.6, end: 1.0 }] }, { start: 3, end: 4, text: ' ab cd' }] });
  assert.deepStrictEqual(w.map(x => x.text), ['Hello', 'there', 'ab', 'cd']);
  assert.deepStrictEqual([w[2].start, w[3].end], [3, 4]);
});

test('cues: one sentence per caption, fillers out of the text, split on pauses and length', () => {
  const c = W.cues(W.parse(cpp));
  assert.deepStrictEqual(c.map(x => x.text), ['Bonjour à tous, on va on va voir.']);
  assert.deepStrictEqual([c[0].start, c[0].end], [0.1, 3]);
  const long = Array.from({ length: 30 }, (x, i) => ({ text: 'mot' + i, start: i * 0.3, end: i * 0.3 + 0.25 }));
  const lc = W.cues(long);
  assert.ok(lc.length >= 2 && lc.every(x => x.text.length <= 80 && x.end - x.start <= 6), JSON.stringify(lc));
  const gap = W.cues([{ text: 'avant', start: 0, end: 0.5 }, { text: 'après', start: 2, end: 2.4 }]);
  assert.deepStrictEqual(gap.map(x => x.text), ['Avant', 'Après']);
});

test('fillers and repeats at word precision; « eu » (the verb) is not a filler', () => {
  const w = W.parse(cpp);
  const f = W.fillers(w);
  assert.strictEqual(f.length, 1);
  assert.deepStrictEqual([f[0].a, f[0].b].map(v => Math.round(v * 100) / 100), [1.25, 1.75]);
  const r = W.repeats(w);
  assert.deepStrictEqual(r.map(x => [x.text, x.a, x.b]), [['on va', 1.9, 2.3]]);
  ['euh', 'euuuh', 'heu', 'hum', 'hmm', 'um', 'uh', 'erm', 'mmh'].forEach(x => assert.ok(W.FILLER.test(W.bare(x)), x));
  ['eu', 'ben', 'bah', 'un', 'hum-hum!'].forEach(x => assert.ok(!W.FILLER.test(W.bare(x)) || x === 'hum-hum!', x));
  assert.deepStrictEqual(W.repeats([{ text: 'a', start: 0, end: 0.1 }, { text: 'a', start: 0.2, end: 0.3 }]), [], 'one-letter words');
});

test('args, progress and 16 kHz audio', () => {
  const a = W.args('/opt/homebrew/bin/whisper-cli', { model: 'm.bin', wav: 'in.wav', out: 'o', lang: 'fr', threads: 4, prompt: W.PROMPTS.fr });
  assert.deepStrictEqual(a.slice(0, 10), ['-m', 'm.bin', '-f', 'in.wav', '-ojf', '-of', 'o', '-pp', '-l', 'fr']);
  assert.ok(a.includes('--prompt'));
  const p = W.args('C:\\Python\\Scripts\\whisper.exe', { wav: 'in.wav', dir: 'd', lang: 'auto', size: 'small' });
  assert.ok(p.includes('--word_timestamps') && !p.includes('--language') && p[2] === 'small');
  assert.strictEqual(W.progressOf('whisper_print_progress_callback: progress =  45%'), 0.45);
  assert.strictEqual(W.progressOf('[00:30.000 --> 00:32.000]  Bonjour', 60), 32 / 60);
  assert.strictEqual(W.progressOf('rien'), null);
  const x = W.to16k(new Float32Array(48000).fill(0.5), 48000);
  assert.strictEqual(x.length, 16000);
  assert.ok(Math.abs(x[100] - 0.5) < 1e-6);
  assert.match(W.modelUrl('base'), /ggml-base\.bin$/);
});
