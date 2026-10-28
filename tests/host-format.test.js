/* Format vertical en un clic : copie de la séquence en 9:16, recadrage automatique des rushs. */
const { test } = require('node:test');
const assert = require('node:assert');
const { makeEnv } = require('./sim');

function setup() {
  const env = makeEnv(25);
  const { seq, F, media, media2, adj, Item } = env;
  seq.videoTracks[0].add(new Item(seq, media, 0, 100 * F, 50 * F));
  seq.videoTracks[0].add(new Item(seq, media2, 100 * F, 260 * F, 20 * F));
  seq.videoTracks[1].add(new Item(seq, adj, 0, 260 * F, 0, 'RR FX · Look Nuit POST'));
  return env;
}
const motionScale = it => it.components.find(c => c.matchName === 'AE.ADBE Motion').properties[1].getValue();

test('9:16 copy: new 1080x1920 sequence, Auto Reframe on each rush, original untouched', () => {
  const env = setup();
  const r = env.call('formatCopy', { width: 1080, height: 1920, label: '9:16', reframe: ['Recadrage automatique', 'Auto Reframe'] });
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.reframed, 2);
  const app = env.ctx.app, ns = app.project.activeSequence;
  assert.notStrictEqual(ns, env.seq, 'the copy is opened');
  assert.strictEqual(ns.name, 'Seq 01 (9:16)');
  assert.deepStrictEqual([ns.frameSizeHorizontal, ns.frameSizeVertical], [1080, 1920]);
  assert.ok(ns.videoTracks[0].items.every(i => i.components.some(c => c.matchName === 'AE.ADBE AutoReframe')));
  assert.ok(!ns.videoTracks[1].items[0].components.some(c => c.matchName === 'AE.ADBE AutoReframe'), 'adjustment layer left alone');
  assert.deepStrictEqual([env.seq.frameSizeHorizontal, env.seq.frameSizeVertical], [1920, 1080], 'original kept');
  assert.ok(env.seq.videoTracks[0].items.every(i => i.components.length === 2), 'original clips untouched');
});

test('fill mode (or no Auto Reframe): rushes scaled up to cover the frame, centred', () => {
  const env = setup();
  const r = env.call('formatCopy', { width: 1080, height: 1350, label: '4:5', mode: 'fill', reframe: ['Auto Reframe'] });
  assert.ok(r.ok, r.error);
  assert.deepStrictEqual([r.reframed, r.filled], [0, 2]);
  const ns = env.ctx.app.project.activeSequence;
  ns.videoTracks[0].items.forEach(it => assert.ok(Math.abs(motionScale(it) - 125) < 1e-6, 'scale ' + motionScale(it)));
  const env2 = setup();
  const r2 = env2.call('formatCopy', { width: 1080, height: 1920, label: '9:16', reframe: ['Nope'] });
  assert.strictEqual(r2.filled, 2);
  assert.match(r2.warnings.join(' '), /Effet introuvable/);
  assert.ok(Math.abs(motionScale(env2.ctx.app.project.activeSequence.videoTracks[0].items[0]) - 177.777) < 0.01);
});

test('compatibility self-test: every check runs on a throwaway copy, which is then deleted', () => {
  const env = setup();
  const before = env.ctx.app.project.sequences.length;
  const r = env.call('selfTest', { lutPath: '/tmp/test.cube', folder: '/tmp', prefix: 'rrfx-test-', fxNames: ['Lumetri Color'] });
  assert.ok(r.ok, r.error);
  const by = Object.fromEntries(r.results.map(x => [x.id, x]));
  ['clone', 'adj', 'place', 'lumetri', 'lut', 'insert', 'razor', 'disable', 'markers', 'frame', 'settings', 'reframe', 'mogrt', 'cleanup'].forEach(id => assert.ok(by[id] && by[id].ok, id + ' : ' + JSON.stringify(by[id])));
  assert.strictEqual(env.ctx.app.project.activeSequence, env.seq, 'original sequence back');
  assert.strictEqual(env.ctx.app.project.sequences.length, before, 'test copy deleted');
  assert.deepStrictEqual([env.seq.frameSizeHorizontal, env.seq.videoTracks.length], [1920, 3], 'original untouched');
  assert.match(r.frame, /rrfx-test-frame$/);
});
