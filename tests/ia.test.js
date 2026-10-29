/* IA locale (Ollama) : demandes, lecture et vérification des réponses ; podcast multicam. */
const { test } = require('node:test');
const assert = require('node:assert');
const IA = require('../plugin/js/ia.js');
const Pc = require('../plugin/js/podcast.js');

test('ia: lines are sent in groups and answers must have the same count', () => {
  const texts = Array.from({ length: 60 }, (_, i) => 'Ligne ' + i);
  const g = IA.groups(texts, 25, 3000);
  assert.deepStrictEqual(g.map(x => x.length), [25, 25, 10]);
  assert.deepStrictEqual([].concat(...g), texts.map((_, i) => i));
  assert.strictEqual(IA.groups(['a'.repeat(2000), 'b'.repeat(2000)], 25, 3000).length, 2);
  assert.deepStrictEqual(IA.lines({ lines: [' Hello  world ', 'Bye'] }, 2), ['Hello world', 'Bye']);
  assert.strictEqual(IA.lines({ lines: ['only one'] }, 2), null);
  assert.strictEqual(IA.lines(null, 1), null);
  const q = IA.translate(['Bonjour', 'Merci'], 'fr', 'en');
  assert.match(q.messages[0].content, /French to English/);
  assert.match(q.messages[0].content, /exactly 2/);
  assert.deepStrictEqual(JSON.parse(q.messages[1].content), { lines: ['Bonjour', 'Merci'] });
  assert.strictEqual(q.format.properties.lines.type, 'array');
  assert.match(IA.correct(['a'], 'fr').messages[0].content, /Do not rephrase/);
});

test('ia: chapter titles, publish texts and extract picks', () => {
  const cues = [{ start: 0, end: 4, text: 'Bienvenue dans le café' }, { start: 70, end: 75, text: 'Parlons de la terrasse' }];
  const list = [{ t: 0, title: 'Bienvenue' }, { t: 65, title: 'Parlons' }];
  const q = IA.chapters(list, cues, 'fr', 80);
  const items = JSON.parse(q.messages[1].content).chapters;
  assert.deepStrictEqual(items.map(c => c.start), ['00:00', '01:05']);
  assert.match(items[1].text, /terrasse/);
  assert.doesNotMatch(items[0].text, /terrasse/);
  const out = IA.chapterTitles({ titles: ['« Le café »', 'La terrasse'] }, list);
  assert.deepStrictEqual(out.map(c => c.title), ['Le café', 'La terrasse']);
  assert.strictEqual(IA.chapterTitles({ titles: ['seul'] }, list), null);
  assert.strictEqual(IA.chapterText(out), '00:00 Le café\n01:05 La terrasse');
  assert.strictEqual(IA.stamp(3725), '1:02:05');
  const p = IA.publishResult({ titles: ['A', ' ', 'B'], description: ' Texte ', hashtags: ['café', '#café', 'Paris je t aime', '#'] });
  assert.deepStrictEqual(p.titles, ['A', 'B']);
  assert.strictEqual(p.description, 'Texte');
  assert.deepStrictEqual(p.hashtags, ['#café', '#Parisjetaime']);
  assert.strictEqual(IA.publishResult({}), null);
  assert.ok(IA.digest('x'.repeat(30000), 12000).length < 12100);
  const picks = IA.picks({ picks: [{ index: 2, title: 'Fort' }, { index: 2 }, { index: 9 }, { index: 0, title: 'Début' }, { index: 1 }] }, 3, 2);
  assert.deepStrictEqual(picks, [{ index: 2, title: 'Fort' }, { index: 0, title: 'Début' }]);
});

test('ia: semantic search and automatic b-roll placement', () => {
  assert.ok(Math.abs(IA.cosine([1, 0], [1, 0]) - 1) < 1e-9);
  assert.strictEqual(IA.cosine([1, 0], [0, 1]), 0);
  assert.strictEqual(IA.cosine([0, 0], [1, 1]), 0);
  const rushes = [{ name: 'plage', vec: [1, 0, 0] }, { name: 'rue', vec: [0, 1, 0] }, { name: 'café', vec: [0, 0, 1] }];
  assert.strictEqual(IA.nearest([0.9, 0.1, 0], rushes, 1)[0].item.name, 'plage');
  const cues = [
    { start: 0, end: 3, vec: [1, 0, 0] }, { start: 3, end: 5, vec: [1, 0, 0] },
    { start: 9, end: 20, vec: [0.1, 1, 0] }, { start: 30, end: 32, vec: [0.2, 0.2, 0.2] }, { start: 40, end: 42, vec: [1, 0.1, 0] }
  ];
  const plan = IA.broll(cues, rushes, { min: 0.6, every: 8, maxDur: 4, reuse: 1 });
  assert.deepStrictEqual(plan.map(p => [p.t, p.rush.name, p.dur]), [[0, 'plage', 3], [9, 'rue', 4], [40, 'plage', 2]]);
  assert.match(IA.describe('fr').messages[0].content, /French/);
  assert.strictEqual(IA.description({ description: 'Une rue.', keywords: ['nuit', 'ville'] }), 'Une rue. · nuit, ville');
});

test('podcast: whoever speaks gets the camera, both or silence give the wide shot', () => {
  const mk = (n, f) => Float32Array.from({ length: n }, (_, i) => f(i * Pc.STEP));
  // A parle 0-10 s, B 10-20 s (chaque micro entend l'autre plus bas), les deux 20-23 s, blanc 23-30 s.
  const A = mk(300, t => (t < 10 || (t >= 14 && t < 14.3) || (t >= 20 && t < 23)) ? -20 : (t < 20 ? -38 : -60));
  const B = mk(300, t => (t >= 10 && t < 23) ? -22 : (t < 10 ? -40 : -62));
  const f = Pc.speakers([A, B]);
  assert.strictEqual(f[50], 0);
  assert.strictEqual(f[150], 1);
  assert.strictEqual(f[215], Pc.BOTH);
  assert.strictEqual(f[270], Pc.NOBODY);
  const shots = Pc.shots(f, { wide: true, minShot: 2 });
  assert.deepStrictEqual(shots, [{ t: 0, who: 0 }, { t: 10, who: 1 }, { t: 20, who: 'wide' }]);
  // Sans plan large : on reste sur la dernière personne.
  assert.deepStrictEqual(Pc.shots(f, { wide: false }).map(s => s.who), [0, 1]);
  assert.deepStrictEqual(Pc.camPlan(shots, [1, 0], 2, 5), [{ t: 5, cam: 1 }, { t: 15, cam: 0 }, { t: 25, cam: 2 }]);
  const talk = Pc.talkTime(f, 2);
  assert.ok(talk[0] > 9 && talk[1] > 9);
  // Aucun plan plus court que minShot.
  const quick = new Int8Array(100).map((_, i) => (i >= 40 && i < 45 ? 1 : 0));
  assert.deepStrictEqual(Pc.shots(quick, { minShot: 1 }), [{ t: 0, who: 0 }]);
  assert.strictEqual(Pc.shots(quick, { minShot: 0.3 }).length, 3);
});

test('podcast: speaker turns from diarization, numbered by first appearance', () => {
  const d = Pc.fromTurns([{ a: 0, b: 5, speaker: 3 }, { a: 5, b: 9, speaker: 1 }, { a: 8.5, b: 12, speaker: 3 }], 12);
  assert.strictEqual(d.people, 2);
  assert.strictEqual(d.frames[20], 0);
  assert.strictEqual(d.frames[60], 1);
  assert.strictEqual(d.frames[87], Pc.BOTH);
  assert.deepStrictEqual(Pc.shots(d.frames, {}), [{ t: 0, who: 0 }, { t: 5, who: 1 }, { t: 9, who: 0 }]);
  const lv = Pc.levels(new Float32Array(1600).fill(0.5), 16000);
  assert.strictEqual(lv.length, 1);
  assert.ok(Math.abs(lv[0] - 20 * Math.log10(0.5)) < 0.01);
});
