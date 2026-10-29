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

test('montage par le texte : prises ratées et phrases de reprise', () => {
  const c = [
    { start: 0, end: 2, text: 'Aujourd\'hui on va parler' },
    { start: 2.3, end: 5, text: 'Aujourd\'hui on va parler de notre café' },
    { start: 5.2, end: 6, text: 'euh attends je recommence' },
    { start: 6.3, end: 9, text: 'Le café ouvre lundi' },
    { start: 9.2, end: 11, text: 'Et il y a une terrasse' },
    { start: 11.2, end: 12, text: 'Non' }
  ];
  assert.deepStrictEqual(O.retakes(c), [0, 2]);
});

test('renommage : remplacer un bout du nom', () => {
  assert.deepStrictEqual(O.renamePlan(['C0001.MP4', 'C0002.MP4'], '{nom}', 1, 'c000', 'Plan_'), ['Plan_1_01', 'Plan_2_02']);
  assert.deepStrictEqual(O.renamePlan(['IMG_4512.MOV'], '{nom}_#', 3, 'IMG_', ''), ['4512_3']);
});

test('temps passé : CSV jour par jour', () => {
  const csv = O.timeCsv({ a: { name: 'A', minutes: 120, days: { '2026-10-28': 60, '2026-10-29': 60 } }, b: { name: 'B', minutes: 30, days: { '2026-10-29': 30 } } }, 50, true);
  const lines = csv.trim().split('\r\n');
  assert.strictEqual(lines.length, 4);
  assert.strictEqual(lines[1], '"2026-10-29";"A";"1,00";"50,00"');
  assert.strictEqual(lines[3], '"2026-10-28";"A";"1,00";"50,00"');
});

test('rythme : statistiques et plans trop longs', () => {
  const r = O.rhythm([{ start: 0, end: 2 }, { start: 2, end: 5 }, { start: 5, end: 17, name: 'long' }, { start: 17, end: 19 }]);
  assert.strictEqual(r.count, 4);
  assert.strictEqual(r.avg, 19 / 4);
  assert.deepStrictEqual(r.long.map(l => l.name), ['long']);
  assert.strictEqual(O.rhythm([]).count, 0);
  assert.deepStrictEqual(O.rhythm([{ start: 0, end: 6 }, { start: 6, end: 8 }], 5).long.map(l => l.len), [6]);
});

test('coupes sur les blancs : décalage vers le point le plus calme des deux côtés', () => {
  // 11 pas, coupe au milieu (5) en plein mot ; blanc 3 pas plus tôt.
  const a = [9, 9, 1, 0.1, 1, 9, 9, 9, 9, 9, 9], b = [5, 5, 1, 0.1, 1, 5, 5, 5, 5, 5, 5];
  assert.strictEqual(O.quietOffset(a, b, 5), -2);
  // Déjà dans un blanc : on ne bouge pas.
  assert.strictEqual(O.quietOffset([1, 1, 0.1, 1, 1], [1, 1, 0.1, 1, 1], 2), 0);
  const e = O.energy(new Float32Array([1, 1, 0, 0]), 2, 1);
  assert.deepStrictEqual(Array.from(e), [1, 0]);
});

test('correcteur de sous-titres : problèmes trouvés et corrigés', () => {
  const cues = [
    { start: 0, end: 0.5, text: 'bonjour  à tous!' },
    { start: 2, end: 2.6, text: 'Une phrase beaucoup trop longue pour une seule ligne de sous-titre qui déborde' },
    { start: 4, end: 6, text: 'Ok : parfait.' }
  ];
  const issues = O.checkCues(cues);
  const kinds = i => issues.filter(x => x.i === i).map(x => x.kind).sort();
  assert.deepStrictEqual(kinds(0), ['caps', 'fast', 'punct', 'short', 'spaces']);
  assert.deepStrictEqual(kinds(1), ['fast', 'long', 'short']);
  assert.deepStrictEqual(kinds(2), []);
  const wrap = (t, m) => { const w = t.split(' '), l = []; let c = ''; w.forEach(x => { if (c && (c + ' ' + x).length > m) { l.push(c); c = x; } else c = c ? c + ' ' + x : x; }); l.push(c); return l.join('\n'); };
  const f = O.fixCues(cues, wrap);
  assert.strictEqual(f.cues[0].text, 'Bonjour à tous !');
  assert.ok(f.cues[0].end > 0.5 && f.cues[0].end <= 1.9, 'longer, without biting the next one');
  assert.ok(f.cues[1].text.split('\n').every(l => l.length <= 42));
  assert.strictEqual(f.fixed, 3, 'the 3rd one gets a non-breaking space before « : »');
  assert.deepStrictEqual(O.checkCues(f.cues).filter(x => x.kind !== 'fast' && x.kind !== 'short'), []);
});

test('export en lot : noms de fichiers', () => {
  const d = new Date(2026, 9, 29);
  assert.strictEqual(O.exportName('{client}_{projet}_{format}_v{vv}', { client: 'Nike', projet: 'Run', w: 1080, h: 1920, version: 3 }), 'Nike_Run_9x16_v03');
  assert.strictEqual(O.exportName('', { sequence: 'Clip: final?', w: 1920, h: 1080, version: 1 }), 'Clip-final-16x9_v01');
  assert.strictEqual(O.exportName('{client}_{sequence}_{date}', { sequence: 'A', date: d }), 'A_2026-10-29');
});

test('badges', () => {
  const b = O.badges({ minutes: 70, ops: 12, tools: 3 });
  assert.deepStrictEqual(b.filter(x => x.done).map(x => x.id), ['h1', 'ops10']);
  assert.ok(b.find(x => x.id === 'h5').progress > 0.2);
});
