/* Traduction des sous-titres et bruitages calés sur les mots clés. */
const { test } = require('node:test');
const assert = require('node:assert');
global.self = global;
const T = require('../plugin/js/traduction.js');
const Sp = require('../plugin/js/speech.js');

test('translation: requests for MyMemory and DeepL, answers read, errors explained', () => {
  const m = T.myMemoryRequest('Salut à tous', 'fr', 'en', 'moi@ex.fr');
  assert.strictEqual(m.url, 'https://api.mymemory.translated.net/get?q=Salut%20%C3%A0%20tous&langpair=fr%7Cen&de=moi%40ex.fr');
  assert.strictEqual(T.myMemoryParse({ responseStatus: 200, responseData: { translatedText: 'Hi &#39;all&#39; &amp; you' } }), "Hi 'all' & you");
  assert.throws(() => T.myMemoryParse({ responseStatus: 429, responseDetails: 'DAILY QUOTA EXCEEDED' }), /Quota/);
  const d = T.deeplRequest(['Bonjour', 'Merci'], 'fr', 'en', 'abc:fx');
  assert.strictEqual(d.url, 'https://api-free.deepl.com/v2/translate');
  assert.strictEqual(d.headers.Authorization, 'DeepL-Auth-Key abc:fx');
  assert.strictEqual(d.body, 'text=Bonjour&text=Merci&target_lang=EN-GB&source_lang=FR&preserve_formatting=1');
  assert.strictEqual(T.deeplRequest(['x'], 'fr', 'de', 'pro-key').url, 'https://api.deepl.com/v2/translate');
  assert.deepStrictEqual(T.deeplParse({ translations: [{ text: 'Hello' }, { text: 'Thanks' }] }, 2), ['Hello', 'Thanks']);
  assert.throws(() => T.deeplParse({ message: 'Wrong endpoint' }, 2), /Wrong endpoint/);
  assert.match(T.httpError(403, 'deepl'), /Clé DeepL/);
});

test('translation: batches, balanced two-line wrapping, same timings in the new .srt', () => {
  assert.deepStrictEqual(T.batches(['aaaa', 'bb', 'cccccc', 'd'], 2, 100), [[0, 1], [2, 3]]);
  assert.deepStrictEqual(T.batches(['aaaa', 'bb', 'cccccc'], 50, 7), [[0, 1], [2]]);
  assert.strictEqual(T.wrap('Today we are going to see how to edit a video much faster'), 'Today we are going to see how\nto edit a video much faster');
  assert.strictEqual(T.wrap('Short line'), 'Short line');
  const cues = Sp.parseSubtitles('1\n00:00:01,000 --> 00:00:02,500\nBonjour à tous\n\n2\n00:01:02,040 --> 00:01:04,000\nOn commence\ntout de suite\n');
  const out = T.toSrt(T.apply(cues, ['Hello everyone', 'Let\'s start right away']));
  assert.strictEqual(out, '1\n00:00:01,000 --> 00:00:02,500\nHello everyone\n\n2\n00:01:02,040 --> 00:01:04,000\nLet\'s start right away\n');
  assert.deepStrictEqual(Sp.parseSubtitles(out).map(c => [c.start, c.end]), cues.map(c => [c.start, c.end]));
  assert.strictEqual(T.chars(cues), 'Bonjour à tous'.length + 'On commence tout de suite'.length);
});

test('keyword sounds: each keyword gets the estimated time it is said', () => {
  const cues = [{ start: 10, end: 14, text: 'Voici une formation gratuite incroyable' }];
  const items = Sp.highlight(cues, 0, { list: ['gratuite'] });
  assert.strictEqual(items.length, 1);
  const it = items[0];
  assert.ok(it.hasKey && it.keyAt > 10 && it.keyAt < 14, JSON.stringify(it));
  const words = Sp.highlight(cues, 1, { list: ['gratuite'] });
  const key = words.find(w => /gratuite/.test(w.text));
  assert.strictEqual(key.keyAt, key.start, 'one word per text: the word starts with its text');
});
