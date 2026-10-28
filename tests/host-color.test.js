/* Couleur et temps forts côté Premiere : look sur toute la séquence, zones sur des temps donnés. */
const { test } = require('node:test');
const assert = require('node:assert');
const { makeEnv } = require('./sim');

function setup() {
  const env = makeEnv(25);
  const { seq, F, media, media2, Item } = env;
  seq.videoTracks[0].add(new Item(seq, media, 0, 100 * F, 50 * F));
  seq.videoTracks[0].add(new Item(seq, media2, 100 * F, 260 * F, 20 * F));
  return env;
}

test('look on the whole sequence: one adjustment layer from the start to the last clip', () => {
  const env = setup();
  const r = env.call('resolve', { placement: 'sequence', sides: ['post'], frames: 1, target: 'adjustment' });
  assert.ok(r.ok, r.error);
  assert.deepStrictEqual(r.targets.map(t => [t.start / env.F, t.end / env.F]), [[0, 260]]);
  const res = env.call('apply', { target: 'adjustment', name: 'RR FX · Look Nuit', targets: r.targets.map(t => Object.assign({}, t, { name: 'RR FX · Look Nuit', fx: [{ type: 'lumetri', names: ['Lumetri Color'], props: [] }] })) });
  assert.ok(res.ok, res.error);
  const layer = env.seq.videoTracks[1].items[0];
  assert.deepStrictEqual([layer._s / env.F, layer._e / env.F], [0, 260]);
  assert.match(env.call('resolve', { placement: 'sequence', sides: ['post'], frames: 1 }).ok ? 'ok' : 'x', /ok/);
});

test('effects on detected beats: times given by the panel instead of markers', () => {
  const env = setup();
  env.seq._ph = 50 * env.F;
  const r = env.call('resolve', { placement: 'markers', times: [1, 2, 3.02, 3.02], sides: ['post'], frames: 5, target: 'adjustment' });
  assert.ok(r.ok, r.error);
  assert.deepStrictEqual(r.targets.map(t => t.start / env.F), [25, 50, 76], 'snapped to frames, duplicates merged');
  assert.match(env.call('resolve', { placement: 'markers', times: [], sides: ['post'], frames: 5 }).error, /temps fort/);
});
