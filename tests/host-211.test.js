/* Côté Premiere, 2.11 : effet glissé dans la timeline ou posé à un endroit précis, et calque de
   réglage importé d'un projet modèle quand le projet n'en a pas. */
const { test } = require('node:test');
const assert = require('node:assert');
const { makeEnv } = require('./sim');

function setup() {
  const env = makeEnv(25);
  const { seq, F, media, Item } = env;
  env.v = [0, 1].map(i => seq.videoTracks[0].add(new Item(seq, media, i * 250 * F, (i + 1) * 250 * F, 0)));
  return env;
}

test('takeDrop: the carrier file dropped on V2 is found, removed from the timeline and the project', () => {
  const env = setup(), F = env.F;
  const carrier = env.projItem('RRFX-glisser-k3x.png', 1, 125 * F);
  env.root.children.push(carrier);
  env.seq.videoTracks[1].add(new env.Item(env.seq, carrier, 300 * F, 425 * F, 0));
  assert.deepStrictEqual(env.call('takeDrop', { tag: 'RRFX-glisser-zzz' }), { ok: true, found: false, inProject: false });
  const r = env.call('takeDrop', { tag: 'RRFX-glisser-k3x' });
  assert.ok(r.ok && r.found, JSON.stringify(r));
  assert.deepStrictEqual([r.at / F, r.track], [300, 1]);
  assert.strictEqual(env.seq.videoTracks[1].items.length, 0, 'carrier removed from the timeline');
  assert.ok(!JSON.stringify(env.root.children.map(c => c.name)).includes('RRFX-glisser'), 'carrier removed from the project');
});

test('takeDrop: dropped in the Project panel instead, cleaned up on the last try', () => {
  const env = setup(), F = env.F;
  env.root.children.push(env.projItem('RRFX-glisser-p1.png', 1, 125 * F));
  assert.strictEqual(env.call('takeDrop', { tag: 'RRFX-glisser-p1' }).inProject, false, 'not yet: Premiere may still be placing it');
  const r = env.call('takeDrop', { tag: 'RRFX-glisser-p1', last: true });
  assert.deepStrictEqual([r.found, r.inProject], [false, true]);
});

test('resolve: playhead placement at a given time and track (double-click, drop)', () => {
  const env = setup(), F = env.F;
  const r = env.call('resolve', { placement: 'playhead', at: 300 * F, track: 2, sides: ['pre', 'post'], frames: 8, target: 'adjustment' });
  assert.ok(r.ok, r.error);
  assert.deepStrictEqual(r.targets.map(t => [t.side, t.start / F, t.end / F, t.track]), [['pre', 292, 300, 1], ['post', 300, 308, 1]]);
  const a = env.call('apply', { target: 'adjustment', name: 'RR FX · Test', targets: r.targets.map(t => Object.assign({}, t, { fx: [] })) });
  assert.ok(a.ok, a.error);
  assert.deepStrictEqual(a.created.map(c => c.track), [2, 2], 'adjustment layers on the track it was dropped on (V3)');
});

test('adjustment layer missing: imported from the template project, refused if the file is gone', () => {
  const env = setup();
  env.root.children.splice(env.root.children.indexOf(env.adj), 1);
  const r = env.call('resolve', { placement: 'playhead', at: 100 * env.F, sides: ['post'], frames: 8, target: 'adjustment' });
  const go = () => env.call('apply', { target: 'adjustment', name: 'RR FX · Test', refreshAdj: true, targets: r.targets.map(t => Object.assign({}, t, { fx: [] })) });
  assert.match(go().error, /projet mod/);
  assert.match(env.call('setAdjTemplate', { path: '/modeles/Calque.prproj' }).error, /introuvable/);
  env.disk.add('/modeles/Calque.prproj');
  assert.ok(env.call('setAdjTemplate', { path: '/modeles/Calque.prproj' }).ok);
  const a = go();
  assert.ok(a.ok, a.error);
  assert.deepStrictEqual(env.imports.map(i => i.paths[0]), ['/modeles/Calque.prproj']);
  assert.ok(go().ok);
  assert.strictEqual(env.imports.length, 1, 'imported once, then found in the project');
});
