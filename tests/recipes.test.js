/* Styles de clip et sons fournis. */
const { test } = require('node:test');
const assert = require('node:assert');
global.self = global;
require('../plugin/js/core.js');
const Lib = require('../plugin/js/library.js');
const D = require('../plugin/js/develop.js');
const Packs = require('../plugin/js/packs.js');
const R = require('../plugin/js/recipes.js');
const S = require('../plugin/js/sons.js');

test('every clip style uses effects, overlays, looks, animations and sounds that exist', () => {
  assert.ok(R.RECIPES.length >= 6);
  R.RECIPES.forEach(r => {
    assert.ok(r.chain.length >= 1, r.id);
    r.chain.forEach(k => {
      if (k.startsWith('b:')) assert.ok(Lib.byId[k.slice(2)], r.id + ' ' + k);
      else if (k.startsWith('p:')) assert.ok(Packs.byId[k.slice(2)], r.id + ' ' + k);
      else assert.fail(r.id + ' clé inconnue ' + k);
    });
    assert.ok(r.look === null || D.LOOKS.some(l => l.name === r.look), r.id + ' look ' + r.look);
    assert.ok(r.uses.length && r.uses.every(u => Lib.DOMAINS.some(d => d.id === u)), r.id + ' domaines');
    assert.ok(['markers', 'allcuts'].includes(r.place), r.id + ' place');
    Object.keys(r.steps).forEach(k => assert.ok(R.STEPS.some(x => x.id === k), r.id + ' étape ' + k));
    if (r.format) assert.ok(['9x16', '4x5', '1x1', '16x9'].includes(r.format.id) && ['reframe', 'fill', 'blur'].includes(r.format.mode), r.id + ' format');
    if (r.steps.captions !== undefined) assert.ok(r.captions && [0, 1, 2, 3, 4, 5].includes(r.captions.words), r.id + ' sous-titres');
    assert.ok(Lib.titleById[r.title], r.id + ' titre ' + r.title);
    assert.ok(['kicks', 'hits', 'snares', 'tempo'].includes(r.beats.mode), r.id);
    assert.ok([1, 2, 4, 8].includes(r.cut.every) && ['sequence', 'random'].includes(r.cut.order) && ['start', 'middle', 'random', 'continue'].includes(r.cut.pick), r.id);
    assert.ok(r.sfx === 'none' || ['whoosh', 'impact', 'mix'].includes(r.sfx) || S.byId(r.sfx), r.id + ' son ' + r.sfx);
  });
  assert.strictEqual(new Set(R.RECIPES.map(r => r.id)).size, R.RECIPES.length);
  // Chaque domaine a au moins deux styles ; les styles « parole » marchent sans musique.
  Lib.DOMAINS.forEach(d => assert.ok(R.forDomain(d.id).length >= 2, d.id));
  ['facecam', 'corporate', 'interview', 'youtube'].forEach(id => {
    const r = R.byId(id);
    assert.ok(R.stepsOf(r).every(x => !R.needsMusic(x.id, r)), id + ' sans musique');
  });
  assert.ok(R.needsMusic('effects', R.byId('rap')) && !R.needsMusic('effects', R.byId('youtube')));
  assert.deepStrictEqual(R.stepsOf(R.byId('interview')).map(x => x.id), ['silences', 'fix', 'punch', 'effects', 'lower', 'captions', 'format'].sort((a, b) => R.STEPS.findIndex(x => x.id === a) - R.STEPS.findIndex(x => x.id === b)));
  const mine = R.fromSettings({ chain: { keys: ['b:zoom-in'], order: 'random' }, color: { params: { exposure: 1 }, name: 'Nuit' }, beats: { mode: 'hits', every: 2 } });
  assert.deepStrictEqual([mine.chain, mine.order, mine.lookName, mine.beats.mode], [['b:zoom-in'], 'random', 'Nuit', 'hits']);
});

test('generated sounds: right length, peak at -3 dBFS, no click at the edges, valid WAV', () => {
  S.SOUNDS.forEach(s => {
    const x = S.render(s.id);
    assert.strictEqual(x.length, Math.round(s.dur * S.SR), s.id);
    let peak = 0, nan = 0;
    for (const v of x) { peak = Math.max(peak, Math.abs(v)); if (!Number.isFinite(v)) nan++; }
    assert.strictEqual(nan, 0, s.id);
    assert.ok(Math.abs(peak - 0.708) < 0.01, s.id + ' crête ' + peak);
    assert.ok(Math.abs(x[x.length - 1]) < 0.01, s.id + ' fin');
    assert.ok(s.peak >= 0 && s.peak < s.dur, s.id);
    // Le moment fort du whoosh : l'énergie autour de « peak » dépasse celle du début.
    if (s.kind === 'whoosh') {
      const rms = (a, b) => { let e = 0; for (let i = a; i < b; i++) e += x[i] * x[i]; return Math.sqrt(e / (b - a)); };
      const p = Math.round(s.peak * S.SR), w = Math.round(0.05 * S.SR);
      assert.ok(rms(p - w, p + w) > 3 * rms(0, w), s.id + ' sommet');
    }
  });
  const w = S.wav(S.render('hit'));
  assert.strictEqual(String.fromCharCode(...w.slice(0, 4)), 'RIFF');
  assert.strictEqual(new DataView(w.buffer).getUint32(24, true), 48000);
  assert.strictEqual(w.length, 44 + Math.round(0.6 * 48000) * 2);
});

test('sounds on cuts: whooshs advanced so their peak hits the cut, impacts on strong cuts', () => {
  const plan = S.plan([1, 2, 3, 0.1], 'mix', [2]);
  const all = plan.flatMap(p => p.times.map(t => [p.id, t]));
  assert.strictEqual(all.length, 4);
  assert.ok(plan.find(p => p.id === 'impact').times.includes(3), 'impact exactly on the strong cut');
  const w = plan.find(p => p.id === 'whoosh');
  assert.ok(Math.abs(w.times[0] - (1 - S.byId('whoosh').peak)) < 1e-9);
  assert.ok(all.every(([, t]) => t >= 0), 'never before 0');
  assert.deepStrictEqual(S.plan([1], 'none'), []);
});
