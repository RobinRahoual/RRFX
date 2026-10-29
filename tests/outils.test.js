'use strict';
const test = require('node:test');
const assert = require('node:assert');
const O = require('../plugin/js/outils.js');

const cues = [
  { start: 0.5, end: 2, text: 'Bonjour à tous' },
  { start: 2.4, end: 4, text: 'euh je recommence' },
  { start: 4.2, end: 6, text: 'Aujourd\'hui on parle café' },
  { start: 7, end: 9, text: 'Et voilà' }
];

test('montage par le texte : la phrase barrée part avec ses blancs', () => {
  const r = O.textCuts(cues, [1]);
  assert.strictEqual(r.length, 1);
  assert.ok(Math.abs(r[0].a - 2.2) < 1e-9 && Math.abs(r[0].b - 4.1) < 1e-9, JSON.stringify(r));
  // Deux phrases voisines : un seul passage.
  const r2 = O.textCuts(cues, [1, 2]);
  assert.strictEqual(r2.length, 1);
  assert.ok(r2[0].a < 2.4 && r2[0].b > 6 && r2[0].b <= 6.2);
  // Première phrase : pas avant 0.
  assert.strictEqual(O.textCuts(cues, [0])[0].a, 0.3);
});

test('montage par le texte : les sous-titres restants sont recollés', () => {
  const ranges = O.textCuts(cues, [1]);
  const left = O.afterCuts(cues, [1], ranges);
  assert.strictEqual(left.length, 3);
  assert.strictEqual(left[0].start, 0.5);
  assert.ok(Math.abs(left[1].start - (4.2 - 1.9)) < 1e-9);
  assert.ok(Math.abs(left[2].end - (9 - 1.9)) < 1e-9);
});

test('recherche dans les sous-titres, sans accents ni majuscules', () => {
  assert.deepStrictEqual(O.findText(cues, 'CAFE'), [2]);
  assert.deepStrictEqual(O.findText(cues, 'aujourd'), [2]);
  assert.deepStrictEqual(O.findText(cues, '  '), []);
});

test('musique à la durée : un passage entre deux temps, en mesures entières', () => {
  const beats = [];
  for (let t = 0; t <= 120; t += 0.5) beats.push(t);
  const p = O.fitPlan(beats, 0, 120, 90);
  assert.ok(!p.error, JSON.stringify(p));
  assert.ok(Math.abs(p.removed - 30) < 1e-9, 'retire 30 s : ' + p.removed);
  assert.strictEqual(Math.round((p.b - p.a) / 0.5) % 4, 0, 'mesures entières');
  assert.ok(p.a >= 24 && p.b <= 120 * 0.9);
  assert.strictEqual(p.trim, 0);
  // Excédent pas multiple d'une mesure : jamais plus que l'excédent, fin coupée au bon endroit.
  const q = O.fitPlan(beats, 0, 120, 90.7);
  assert.ok(q.removed <= 29.3 + 1e-9 && q.removed > 28);
  assert.ok(q.trim === 90.7 || q.trim === 0);
});

test('musique à la durée : déjà à la bonne longueur, ou trop courte', () => {
  assert.strictEqual(O.fitPlan([1, 2], 0, 60, 60).error, 'fits');
  assert.strictEqual(O.fitPlan([1, 2], 0, 50, 60).error, 'short');
  // Sans temps forts : coupe nette à la fin de la vidéo.
  const p = O.fitPlan([], 0, 100, 80);
  assert.strictEqual(p.trim, 80);
  assert.strictEqual(p.removed, 0);
});

test('versions de séquence', () => {
  assert.strictEqual(O.versionName('Interview', []), 'Interview v02');
  assert.strictEqual(O.versionName('Interview v02', ['Interview', 'Interview v02']), 'Interview v03');
  assert.strictEqual(O.versionName('Interview', ['Interview v07 (avant musique)']), 'Interview v08');
  assert.strictEqual(O.baseName('Clip v12 (avant musique)'), 'Clip');
  const list = [{ name: 'Clip v02' }, { name: 'Clip' }, { name: 'Clip v10' }, { name: 'Autre v03' }];
  assert.deepStrictEqual(O.versionsOf('Clip', list).map(q => q.name), ['Clip v10', 'Clip v02']);
});

test('renommage en série', () => {
  assert.deepStrictEqual(O.renamePlan(['A001.mov', 'A002.mov'], 'Interview_###', 1), ['Interview_001', 'Interview_002']);
  assert.deepStrictEqual(O.renamePlan(['A001.mov'], '{nom} - plan', 5), ['A001 - plan_05']);
  assert.deepStrictEqual(O.renamePlan(['x.mp4', 'y.mp4'], '', 1), ['x_001', 'y_002']);
});

test('temps passé : seules les minutes où quelque chose bouge comptent', () => {
  let s = null, total = 0;
  const step = (sig, t) => { const r = O.activity(s, sig, t * 60000); s = r.state; total += r.add; };
  for (let t = 0; t <= 20; t++) step(t < 3 ? 'sig' + t : 'fixe', t);
  // Changements jusqu'à 3 min, compté jusqu'à 8 min (5 min sans rien), plus rien après.
  assert.strictEqual(total, 8);
  const csv = O.timeCsv({ p: { name: 'Projet "A"', path: '/x.prproj', minutes: 90, lastDay: '2026-10-29' } }, 40);
  assert.ok(/"Projet ""A""";"\/x.prproj";"1,50";"2026-10-29";"60,00"/.test(csv), csv);
});

test('temps gagné : estimation prudente et affichage', () => {
  assert.strictEqual(O.savedMinutes(0), 0.5);
  assert.strictEqual(O.savedMinutes(30), 10.5);
  assert.strictEqual(O.savedMinutes(1000), 45);
  assert.strictEqual(O.duration(42), '42 min');
  assert.strictEqual(O.duration(75), '1 h 15');
  assert.strictEqual(O.duration(120), '2 h');
  assert.strictEqual(O.monthKey(new Date(2026, 9, 3)), '2026-10');
});
