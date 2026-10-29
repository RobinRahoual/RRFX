/* Montage : extraits viraux, plans de coupe sur les mots clés. */
const { test } = require('node:test');
const assert = require('node:assert');
const Mo = require('../plugin/js/montage.js');

test('extracts: the lively, talkative passages win; each starts and ends on a sentence', () => {
  const cues = [], speech = [];
  for (let i = 0; i < 60; i++) {
    const a = i * 5;
    // De 100 à 140 s : questions et mots forts ; de 200 à 240 s : de longs blancs.
    const hot = a >= 100 && a < 140;
    cues.push({ start: a, end: a + 4.5, text: hot ? 'Pourquoi tout le monde fait cette erreur ? 3 secrets !' : 'on continue avec la suite du programme' });
    if (!(a >= 200 && a < 240 && i % 2)) speech.push({ a, b: a + 4.6 });
  }
  const energy = { rate: 10, values: new Float32Array(3000).map((v, i) => (i >= 1000 && i < 1400 ? 0.5 + 0.4 * Math.sin(i / 3) : 0.4)) };
  const ex = Mo.extracts({ speech, energy, cues, count: 2, min: 25, max: 45 });
  assert.strictEqual(ex.length, 2);
  const best = ex.slice().sort((p, q) => q.score - p.score)[0];
  assert.ok(best.a >= 95 && best.b <= 145, JSON.stringify(best));
  assert.match(best.title, /Pourquoi/);
  ex.forEach(e => {
    assert.ok(cues.some(c => c.start === e.a) && cues.some(c => c.end === e.b));
    assert.ok(e.b - e.a >= 25 && e.b - e.a <= 45);
  });
  assert.ok(ex[0].b <= ex[1].a, 'no overlap, in order');
  assert.ok(ex.every(e => !(e.a < 240 && e.b > 200 && e.a >= 195)), 'the passage full of gaps is not picked');
  assert.deepStrictEqual(Mo.extracts({ speech: [], cues }), []);
});

test('extracts without subtitles: speech after a gap starts each candidate', () => {
  const speech = Mo.speechFromSilences(0, 120, [{ a: 30, b: 33 }, { a: 70, b: 74 }]);
  assert.deepStrictEqual(speech, [{ a: 0, b: 30 }, { a: 33, b: 70 }, { a: 74, b: 120 }]);
  const ex = Mo.extracts({ speech, count: 1, min: 20, max: 60 });
  assert.strictEqual(ex.length, 1);
  assert.ok([0, 33, 74].includes(ex[0].a) && [30, 70, 120].includes(ex[0].b));
});

test('b-roll: a word of the subtitles found in a file name, at the time it is said', () => {
  const media = [
    { name: 'Cafe_terrasse_01', folder: 'B-roll/Paris', path: '/b/cafe.mp4', type: 'video' },
    { name: 'voiture-rouge', folder: 'B-roll', path: '/b/voiture.mp4', type: 'video' },
    { name: 'IMG_2041', folder: 'Photos', path: '/b/img.jpg', type: 'image' }
  ];
  const items = [
    { start: 0, end: 4, text: 'On boit un café avant de partir' },
    { start: 4, end: 8, text: 'Puis on prend les voitures' },
    { start: 8, end: 11, text: 'Encore un café en terrasse' },
    { start: 40, end: 44, text: 'Dernier café de la journée' }
  ];
  const plan = Mo.brollPlan(items, media, { dur: 2, gap: 3, reuse: 30 });
  assert.deepStrictEqual(plan.map(p => [p.media.path, p.word]), [['/b/cafe.mp4', 'café'], ['/b/voiture.mp4', 'voitures'], ['/b/cafe.mp4', 'café']]);
  assert.ok(plan[0].t > 0 && plan[0].t < 4);
  assert.strictEqual(plan[2].t > 40, true, 'the same file is not reused within 30 s');
});
